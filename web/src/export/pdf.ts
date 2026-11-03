// PDF export of layers: one page per layer, drawn as vector graphics. Written by hand as
// PDF 1.4 with no dependencies: uncompressed content streams and the standard Helvetica font.
// Images (a viewport's cached render among them) are image XObjects, each written once.
//
// World coordinates are millimetres with y up, the orientation PDF user space also uses. A page
// shows the layer's drawing bounds at paper scale (world mm / layer scale) plus a margin, so every
// point is a scale and an offset. With a paper size, the drawing is scaled again to fit the paper
// and centred; without one, a sheet layer with a page (Page Setup) is drawn on that page, 1:1
// about its centre. Line weights and dash lengths are paper units and are never scaled. Line markers
// are paper sized too, but drawn as geometry (world mm = paper mm x the layer's scale), so a page
// fitted to paper scales them with the drawing, as it does text. A saved view's page draws the
// layers and classes the view shows, cropped to the area it shows.

import { drawsPen, fillPatternBits } from "../core/attrs.ts";
import { isNarrowFont } from "../core/fonts.ts";
import { textBaselines } from "../core/geometry.ts";
import { type MarkerPath, markerPaths } from "../core/markers.ts";
import { composeAffine } from "../core/encode.ts";
import { mapShape, withContainers } from "../core/model.ts";
import { shadowOffset } from "../core/shadow.ts";
import type {
  Attributes,
  BBox,
  ClassInfo,
  Clip,
  DropShadow,
  LayerInfo,
  LineType,
  ObjectInfo,
  Pt,
  Shape,
  StyleOverride,
  Visibility,
  VwxDocument,
} from "../core/types.ts";
import { type PdfImage, pdfImage } from "./pdfImage.ts";
import { arcPoint, findLayer, shownBounds, unionBounds } from "./svg.ts";

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;
/** largest page side most viewers accept, in user units (200 in) */
const MAX_PAGE_PT = 14400;
const PT_PER_INCH = 72;
const PT_PER_MIL = 0.072; // 1 mil = 0.001 in
const MIN_LINE_PT = 0.1;
const MIN_FONT_PT = 0.001;
/** Horizontal scaling (Tz, percent) a narrow font is set at in Helvetica: Arial Narrow's width over Arial's. */
const NARROW_SCALE = 82;
/** Helvetica's underline: its top below the baseline and its thickness, in ems. */
const UNDERLINE_AT = 0.1;
const UNDERLINE_WEIGHT = 0.05;
const MARGIN_MM = 10;
const A4_MM = { w: 210, h: 297 };
const GRAYED_ALPHA = 0.3;
const ARC_MAX_DEG = 90; // each Bezier segment spans at most this many degrees
const TEXT_SIZE = 0.8; // font size as a fraction of one line's share of the text box height
const BLACK = "0 0 0";
/** copies of its casters' outlines a drop shadow's blur is built from */
const SHADOW_LAYERS = 6;

/** A paper size in millimetres. The orientation is set by the drawing when the size is used. */
export interface PaperMm {
  width: number;
  height: number;
}

/** Paper sizes for fitting a page, in millimetres; the export dialog lists them by name. */
export const PAPER_SIZES: readonly (PaperMm & { name: string })[] = [
  { name: "A4", width: 210, height: 297 },
  { name: "A3", width: 297, height: 420 },
  { name: "A1", width: 594, height: 841 },
  { name: "A0", width: 841, height: 1189 },
  { name: "Letter", width: 215.9, height: 279.4 },
  { name: "Tabloid", width: 279.4, height: 431.8 },
];

/** Options for exportPdf. Every field is optional, and the defaults give the drawing as it has always been exported. */
export interface PdfOptions {
  /** layers to export, in this order (duplicates dropped); without it, every layer that is not hidden */
  layerIds?: string[];
  /** true also draws objects of hidden classes; the default skips them */
  includeHiddenClasses?: boolean;
  /**
   * Fits each page to this paper, centred with a 10 mm margin. The page is portrait only when the drawing
   * is taller than it is wide. Without it, a sheet layer with a page (Page Setup) is drawn on that page,
   * and any other layer's page is its drawing's size at the layer's scale.
   */
  pageSize?: PaperMm;
  /** saved views to draw, a page each after the layers' pages */
  views?: readonly PdfView[];
}

/** A saved view as a page: the layers it draws, how its classes draw, and the area it shows. */
export interface PdfView {
  /** the layers drawn, bottom first; a ghosted one draws faded, as a grayed layer does */
  layers: readonly { readonly id: string; readonly ghosted: boolean }[];
  /** how each class draws in the view, by index; one left out draws as the drawing has it */
  classes: ReadonlyMap<number, Visibility>;
  /** the area shown, world mm: the page shows it and nothing outside it */
  box: BBox;
  /** the scale (1:n) the page is drawn at without a paper size: the view's active layer's */
  scale: number;
}

/** A shape reduced to what gets drawn, in world coordinates. `fills`: open polygons and polylines fill as if closed. */
type Geom =
  | { kind: "path"; pts: Pt[]; closed: boolean; fills: boolean }
  | { kind: "arc"; c: Pt; rx: number; ry: number; a0: number; sweep: number; closed: boolean }
  | {
      kind: "text";
      lines: { x: number; y: number; text: string }[];
      size: number;
      angle: number;
      hAlign: number;
      /** the font's place in the document's font list, and the style */
      fontIndex?: number;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
    }
  | { kind: "image"; box: BBox; bytes: Uint8Array };

type ArcGeom = Extract<Geom, { kind: "arc" }>;
/** geometry drawn as a path */
type Outline = Extract<Geom, { kind: "path" }> | ArcGeom;

interface Item {
  geom: Geom;
  attrs: Attributes | null;
  grayed: boolean;
  /** viewport crop (world mm) the object is cropped to */
  clip?: Clip;
  /** what the viewport's data visualisations change about how it draws */
  style?: StyleOverride;
  /** what its line markers draw (world mm), when it has any */
  markers?: MarkerPath[];
  /** the drop shadow it casts; consecutive items with the same one cast it together */
  shadow?: DropShadow;
}

/** Maps world coordinates to page points: x_pt = x * k + ox, y_pt = y * k + oy. */
interface Frame {
  k: number;
  ox: number;
  oy: number;
}

interface Page {
  width: number;
  height: number;
  content: string;
  /** ExtGState resources the content uses: name -> dictionary */
  states: Map<string, string>;
  /** image XObjects the content uses, by name */
  images: Set<string>;
}

/** Caches shared by all pages while drawing. */
interface Ctx {
  doc: VwxDocument;
  lineTypes: Map<number, LineType>;
  /** hatch name index -> its ground colour index */
  hatchGrounds: Map<number, number>;
  rgbs: Map<number, string>;
  /** alpha pair -> index; the index names the ExtGState, so names are unique across pages */
  stateIndex: Map<string, number>;
  /** ExtGStates used by the page being drawn */
  states: Map<string, string>;
  /** each image's XObject name by its bytes, or null when it can't be written; names are unique across pages */
  imageNames: Map<Uint8Array, string | null>;
  /** the images seen by content (length and hash), so copies of one picture are written once */
  imageContents: Map<string, { bytes: Uint8Array; name: string | null }[]>;
  /** the images written, in name order (Im1, Im2, …) */
  images: PdfImage[];
  /** images used by the page being drawn */
  pageImages: Set<string>;
  /** false leaves drop shadows out (their see-through copies need transparency) */
  shadows: boolean;
}

/**
 * PDF bytes with one page per layer, in the order given. Without layerIds, every layer that is
 * not hidden and has drawable objects is exported, in document order. Objects of hidden classes
 * are skipped unless includeHiddenClasses is set; grayed classes are drawn at 30% opacity. Images
 * are drawn where their format allows (pdfImage.ts); others are left out. A selection with no pages gets one blank page, since a PDF must have at least
 * one: A4, or the paper size when one is given.
 */
export function exportPdf(doc: VwxDocument, opts: PdfOptions = {}): Uint8Array {
  const classes = new Map(doc.classes().map((c): [number, ClassInfo] => [c.index, c]));
  const ctx = newCtx(doc, true);
  const explicit = opts.layerIds !== undefined;
  const includeHidden = opts.includeHiddenClasses === true;
  const pages: Page[] = [];
  for (const layer of pickLayers(doc.layers(), opts.layerIds)) {
    const { items, box } = collect(doc, layer, classes, includeHidden);
    if (items.length === 0 && !explicit) continue;
    pages.push(layerPage(layer, items, box, ctx, opts.pageSize));
  }
  for (const view of opts.views ?? []) pages.push(viewPage(doc, view, classes, includeHidden, ctx, opts.pageSize));
  if (pages.length === 0) pages.push(blankPage(opts.pageSize));
  return writePdf(pages, ctx.images, doc.info.fileName);
}

function newCtx(doc: VwxDocument, shadows: boolean): Ctx {
  return {
    doc,
    lineTypes: new Map(doc.lineTypes().map((t): [number, LineType] => [t.style, t])),
    hatchGrounds: new Map(doc.resources().flatMap((r): [number, number][] => (r.hatch ? [[r.index, r.hatch.background]] : []))),
    rgbs: new Map(),
    stateIndex: new Map(),
    states: new Map(),
    imageNames: new Map(),
    imageContents: new Map(),
    images: [],
    pageImages: new Set(),
    shadows,
  };
}

/** One page of content operators, for a writer of another format (eps.ts) to translate. */
export interface DrawnPage {
  /** points */
  width: number;
  height: number;
  content: string;
  /** the ExtGState dictionaries the content names (its opacities), by name */
  states: ReadonlyMap<string, string>;
  /** images the content draws (with Do) */
  images: number;
}

/**
 * The given layers drawn together on one page, bottom first, at 1:`scale` (the active layer's):
 * the area their drawings cover plus the margin, as Export EPSF takes it. A grayed layer draws
 * faded; objects of hidden classes are left out, as are drop shadows. Null when nothing is drawn.
 */
export function layersPage(doc: VwxDocument, layerIds: readonly string[], scale: number): DrawnPage | null {
  const classes = new Map(doc.classes().map((c): [number, ClassInfo] => [c.index, c]));
  const layers = doc.layers();
  const boxes: BBox[] = [];
  const drawn: { id: string; ghosted: boolean }[] = [];
  for (const id of layerIds) {
    const layer = layers.find((l) => l.id === id);
    if (!layer) continue;
    const { items, box } = collect(doc, layer, classes, false);
    if (box && items.length > 0) boxes.push(box);
    drawn.push({ id, ghosted: layer.visibility === "grayed" });
  }
  const box = unionBounds(boxes);
  if (!box) return null;
  const ctx = newCtx(doc, false);
  const page = viewPage(doc, { layers: drawn, classes: new Map(), box, scale }, classes, false, ctx);
  return { width: page.width, height: page.height, content: page.content, states: page.states, images: page.images.size };
}

/** The requested layers in the requested order (duplicates dropped), or every visible-ish layer. */
function pickLayers(layers: LayerInfo[], ids: string[] | undefined): LayerInfo[] {
  if (!ids) return layers.filter((l) => l.visibility !== "hidden");
  const picked = ids.map((id) => findLayer(layers, id));
  return [...new Map(picked.map((l): [string, LayerInfo] => [l.id, l])).values()];
}

/**
 * The layer's drawable objects and the union of their bounds (world mm), or null when none. On a
 * sheet, plan viewports' design layers come first, carried onto the sheet, so annotations draw over them.
 */
function collect(
  doc: VwxDocument,
  layer: LayerInfo,
  classes: Map<number, ClassInfo>,
  includeHidden: boolean,
): { items: Item[]; box: BBox | null } {
  const items: Item[] = [];
  const boxes: BBox[] = [];
  // markers are paper sized: world mm per paper inch on this page (plan viewports' drawings are carried onto the sheet first)
  const perInch = MM_PER_INCH * paperScale(layer);
  // design-layer viewports draw the layers they show on their design layer the same way, uncropped
  for (const vp of doc.viewports(layer.id)) {
    const host = vp.uncropped ? doc.object(vp.id) : null;
    const hostVisibility = host ? withContainers(classes.get(host.classIndex)?.visibility ?? "visible", host, (i) => classes.get(i)?.visibility) : "visible";
    if (hostVisibility === "hidden" && !includeHidden) continue;
    const crop = vp.uncropped ? undefined : vp.clip;
    for (const shown of vp.layers) {
      if (shown.visibility === "hidden") continue;
      const vpClasses = shown.via?.classes ?? vp.classes;
      const m = shown.via ? composeAffine(vp.m, shown.via.m) : vp.m;
      for (const obj of doc.objects(shown.id)) {
        if (!obj.shape) continue;
        const own = vpClasses.get(obj.classIndex) ?? classes.get(obj.classIndex)?.visibility ?? "visible";
        const visibility = withContainers(own, obj, (i) => vpClasses.get(i) ?? classes.get(i)?.visibility);
        if (visibility === "hidden" && !includeHidden) continue;
        const shape = mapShape(obj.shape, m);
        const geom = geometryOf(shape);
        const box = geom ? shownBounds(shape, crop) : null;
        if (!geom || !box || !isFiniteBox(box)) continue;
        const grayed = visibility === "grayed" || shown.visibility === "grayed" || hostVisibility === "grayed";
        const style = vp.styles?.get(obj.id);
        items.push({
          geom,
          attrs: drawnAttrs(obj, style),
          grayed,
          ...(crop ? { clip: crop } : {}),
          ...(style ? { style } : {}),
          ...(obj.shadow ? { shadow: obj.shadow } : {}),
          ...markersOf(obj, shape, perInch),
        });
        boxes.push(box);
      }
    }
  }
  // sections and details draw from their caches, which their data visualisations can restyle
  const styles = layer.kind === "sheet" ? doc.viewportStyles(layer.id) : null;
  for (const obj of doc.objects(layer.id)) {
    if (!obj.shape) continue;
    const visibility = withContainers(classes.get(obj.classIndex)?.visibility ?? "visible", obj, (i) => classes.get(i)?.visibility);
    if (visibility === "hidden" && !includeHidden) continue;
    const geom = geometryOf(obj.shape);
    const box = geom ? shownBounds(obj.shape, obj.clip) : null;
    if (!geom || !box || !isFiniteBox(box)) continue;
    const style = styles?.get(obj.id);
    items.push({
      geom,
      attrs: drawnAttrs(obj, style),
      grayed: visibility === "grayed",
      clip: obj.clip,
      ...(style ? { style } : {}),
      ...(obj.shadow ? { shadow: obj.shadow } : {}),
      ...markersOf(obj, obj.shape, perInch),
    });
    boxes.push(box);
  }
  return { items, box: unionBounds(boxes) };
}

/** Item.markers for an object drawn as `shape`, `perInch` world mm to the paper inch; nothing when it has none. */
function markersOf(obj: ObjectInfo, shape: Shape, perInch: number): { markers?: MarkerPath[] } {
  const markers = obj.markers ? markerPaths(shape, obj.markers, perInch) : [];
  return markers.length > 0 ? { markers } : {};
}

/** Attributes as drawn: a data visualisation's fill and pen, and no fill for part of a 3D solid. */
function drawnAttrs(obj: ObjectInfo, style?: StyleOverride): Attributes | null {
  const a = obj.attrs;
  if (!a || (!style && !obj.wireframe)) return a;
  const fillPattern = obj.wireframe ? 0 : (style?.fillPattern ?? a.fillPattern);
  return { ...a, fillPattern, lineStyle: style?.lineStyle ?? a.lineStyle };
}

/** The scale a layer is drawn at on paper: its own for a design layer, 1 for sheets (drawn 1:1) and bad values. */
export function paperScale(layer: LayerInfo): number {
  return layer.kind === "design" && layer.scale > 0 && Number.isFinite(layer.scale) ? layer.scale : 1;
}

function layerPage(layer: LayerInfo, items: Item[], box: BBox | null, ctx: Ctx, paper?: PaperMm): Page {
  if (!paper && layer.kind === "sheet" && layer.page) return sheetPage(layer.page, items, ctx);
  if (!box) return blankPage(paper);
  const { width, height, frame } = layout(box, paperScale(layer), paper);
  ctx.states = new Map();
  ctx.pageImages = new Set();
  return { width, height, content: drawItems(items, MM_PER_INCH * paperScale(layer), frame, ctx), states: ctx.states, images: ctx.pageImages };
}

/** A sheet layer on its own page (Page Setup): drawn 1:1, its origin at the page's centre, and cropped to the page. */
function sheetPage(page: PaperMm, items: Item[], ctx: Ctx): Page {
  const width = mm(page.width);
  const height = mm(page.height);
  const frame: Frame = { k: PT_PER_MM, ox: width / 2, oy: height / 2 };
  const crop = clipOps({ x0: -page.width / 2, y0: -page.height / 2, x1: page.width / 2, y1: page.height / 2 }, frame).join("\n");
  ctx.states = new Map();
  ctx.pageImages = new Set();
  const content = `q\n${crop}\n${drawItems(items, MM_PER_INCH, frame, ctx)}\nQ`;
  return { width, height, content, states: ctx.states, images: ctx.pageImages };
}

/** A saved view's page: its layers' objects as its classes show them, cropped to its area. */
function viewPage(doc: VwxDocument, view: PdfView, classes: Map<number, ClassInfo>, includeHidden: boolean, ctx: Ctx, paper?: PaperMm): Page {
  const box = view.box;
  if (!isFiniteBox(box) || !(box.x1 > box.x0 && box.y1 > box.y0)) return blankPage(paper);
  const shown = new Map(classes);
  for (const [index, visibility] of view.classes) {
    const c = shown.get(index);
    if (c) shown.set(index, { ...c, visibility });
  }
  const layers = doc.layers();
  const items: Item[] = [];
  for (const { id, ghosted } of view.layers) {
    const layer = layers.find((l) => l.id === id);
    if (!layer) continue;
    for (const item of collect(doc, layer, shown, includeHidden).items) items.push(ghosted ? { ...item, grayed: true } : item);
  }
  const scale = view.scale > 0 && Number.isFinite(view.scale) ? view.scale : 1;
  const { width, height, frame } = layout(box, scale, paper);
  ctx.states = new Map();
  ctx.pageImages = new Set();
  const crop = clipOps(box, frame).join("\n");
  const content = `q\n${crop}\n${drawItems(items, MM_PER_INCH * scale, frame, ctx)}\nQ`;
  return { width, height, content, states: ctx.states, images: ctx.pageImages };
}

/** Content operators for `items`, `perInch` world mm to the paper inch. */
function drawItems(items: Item[], perInch: number, frame: Frame, ctx: Ctx): string {
  // each shadow is drawn once, under the first of the items that cast it
  return items
    .map((item, i) => (ctx.shadows && item.shadow && item.shadow !== items[i - 1]?.shadow ? `${shadowOps(items, i, perInch, frame, ctx)}\n` : "") + drawItem(item, frame, ctx))
    .join("\n");
}

/**
 * Page size and frame for a drawing. Without a paper size the page is the drawing at the layer's
 * scale plus the margin. With one, the page is that paper, turned landscape or portrait to suit the
 * drawing, and the drawing is scaled by the largest factor that keeps it inside the margins, then
 * centred. Only geometry and text scale; line weights stay in paper units.
 */
function layout(box: BBox, scale: number, paper: PaperMm | undefined): { width: number; height: number; frame: Frame } {
  const k0 = PT_PER_MM / scale; // world mm to points at the layer's scale
  const margin = mm(MARGIN_MM);
  const drawW = (box.x1 - box.x0) * k0;
  const drawH = (box.y1 - box.y0) * k0;
  if (!paper) {
    return {
      width: drawW + 2 * margin,
      height: drawH + 2 * margin,
      frame: { k: k0, ox: margin - box.x0 * k0, oy: margin - box.y0 * k0 },
    };
  }
  const landscape = box.x1 - box.x0 >= box.y1 - box.y0;
  const long = mm(Math.max(paper.width, paper.height));
  const short = mm(Math.min(paper.width, paper.height));
  const width = landscape ? long : short;
  const height = landscape ? short : long;
  // A zero extent (a straight horizontal line, say) does not limit the factor.
  const fit = Math.min(
    drawW > 0 ? (width - 2 * margin) / drawW : Infinity,
    drawH > 0 ? (height - 2 * margin) / drawH : Infinity,
  );
  const s = Number.isFinite(fit) ? Math.max(fit, 0) : 1;
  const k = k0 * s;
  return {
    width,
    height,
    frame: {
      k,
      ox: (width - (box.x1 - box.x0) * k) / 2 - box.x0 * k,
      oy: (height - (box.y1 - box.y0) * k) / 2 - box.y0 * k,
    },
  };
}

function blankPage(paper?: PaperMm): Page {
  // no drawing to turn for, so a blank page is portrait
  const w = paper ? Math.min(paper.width, paper.height) : A4_MM.w;
  const h = paper ? Math.max(paper.width, paper.height) : A4_MM.h;
  return { width: mm(w), height: mm(h), content: "", states: new Map(), images: new Set() };
}

/** Geometry in world coordinates, or null when the shape draws nothing. */
function geometryOf(s: Shape): Geom | null {
  switch (s.kind) {
    case "line":
    case "rect":
    case "polygon":
    case "polyline":
      if (s.points.length < 2) return null;
      return {
        kind: "path",
        pts: s.points,
        closed: s.kind === "rect" || s.closed,
        fills: s.kind === "rect" || s.closed || (s.kind !== "line" && s.points.length > 2),
      };
    case "arc": {
      const c = s.center;
      const sweep = Math.max(-360, Math.min(360, s.sweepAngle ?? 0));
      if (!c || s.rx === undefined || s.ry === undefined) return null;
      if (!(Math.abs(s.rx) > 0 && Math.abs(s.ry) > 0 && Math.abs(sweep) > 0)) return null;
      return {
        kind: "arc",
        c,
        rx: Math.abs(s.rx),
        ry: Math.abs(s.ry),
        a0: s.startAngle ?? 0,
        sweep,
        closed: Math.abs(sweep) >= 360,
      };
    }
    case "image":
      return s.image && s.bbox && isFiniteBox(s.bbox) && s.bbox.x1 > s.bbox.x0 && s.bbox.y1 > s.bbox.y0 ? { kind: "image", box: s.bbox, bytes: s.image } : null;
    case "text": {
      const laid = textBaselines(s);
      if (laid) {
        const out = laid.lines.filter((l) => l.text !== "").map((l) => ({ x: l.at.x, y: l.at.y, text: l.text }));
        if (out.length === 0) return null;
        const { fontIndex, bold, italic, underline } = s;
        return { kind: "text", lines: out, size: laid.size, angle: laid.angle, hAlign: laid.hAlign, fontIndex, bold, italic, underline };
      }
      const b = s.bbox;
      if (!b || !s.text) return null;
      // Same placement as svg.ts: the first baseline sits one size below the top of the box.
      const lines = s.text.split(/\r\n|\r|\n/);
      const size = (((b.y1 - b.y0) || 1) / Math.max(1, lines.length)) * TEXT_SIZE;
      const out: { x: number; y: number; text: string }[] = [];
      lines.forEach((text, i) => {
        if (text !== "") out.push({ x: b.x0, y: b.y1 - size * (i + 1), text });
      });
      return out.length > 0 ? { kind: "text", lines: out, size, angle: 0, hAlign: 1 } : null;
    }
    default:
      return null;
  }
}

/**
 * Operators for one object, wrapped in q/Q so its colour, width, dash and alpha do not leak into
 * the next object. Closed shapes with a solid fill are filled and stroked; the rest are stroked.
 * A shape that draws no outline (drawsPen) is only filled, or paints nothing.
 */
function drawItem(item: Item, f: Frame, ctx: Ctx): string {
  const { geom: g, attrs: a } = item;
  const shade = item.grayed ? GRAYED_ALPHA : 1;
  const penAlpha = opacity(a?.penOpacity) * shade;

  if (g.kind === "image") {
    // the image's unit square stretched over its box; grayed as everything else is
    const name = imageName(g.bytes, ctx);
    if (!name) return "";
    ctx.pageImages.add(name);
    const ops = ["q", ...clipOps(item.clip, f)];
    if (shade < 1) ops.push(`/${stateName(ctx, shade, shade)} gs`);
    const b = g.box;
    ops.push(`${num((b.x1 - b.x0) * f.k)} 0 0 ${num((b.y1 - b.y0) * f.k)} ${px(f, b.x0)} ${py(f, b.y0)} cm`, `/${name} Do`, "Q");
    return ops.join("\n");
  }

  if (g.kind === "text") {
    // Text is drawn in the pen colour, as svg.ts does.
    const ops = ["q", ...clipOps(item.clip, f)];
    if (penAlpha < 1) ops.push(`/${stateName(ctx, penAlpha, penAlpha)} gs`);
    ops.push(`${item.style?.pen ? rgbOperands(item.style.pen) : a ? rgb(ctx, a.penFore) : BLACK} rg`, ...textOps(g, f, ctx), "Q");
    return ops.join("\n");
  }

  const pen = drawsPen(a);
  let paint = pen ? "S" : "n";
  let fillAlpha = 1;
  let fillColour: string | null = null;
  if (a && a.fillPattern !== 0 && (g.kind === "path" ? g.fills : g.closed)) {
    // solid fills paint the fill background colour (see core/attrs.ts); a hatch its own ground,
    // without its lines; a bitmap pattern the mix of its two colours its bits make
    paint = pen ? "B" : "f";
    fillAlpha = opacity(a.fillOpacity) * shade;
    const ground = ctx.hatchGrounds.get(-a.fillPattern);
    const back = item.style?.fillBack;
    const bits = a.fillPattern > 1 ? fillPatternBits(a.fillPattern) : null;
    const colour =
      ground !== undefined
        ? rgb(ctx, ground)
        : bits
          ? rgbOperands(mixByBits(item.style?.fillFore ?? ctx.doc.color(a.fillFore), back ?? ctx.doc.color(a.fillBack), bits))
          : back
            ? rgbOperands(back)
            : rgb(ctx, a.fillBack);
    fillColour = `${colour} rg`;
  }
  const width = a ? Math.max(MIN_LINE_PT, a.lineWeight * PT_PER_MIL) : MIN_LINE_PT;
  const dash = a ? dashPattern(a.lineStyle, ctx.lineTypes) : null;
  const penColour = item.style?.pen ? rgbOperands(item.style.pen) : a ? rgb(ctx, a.penFore) : BLACK;

  const ops = ["q", ...clipOps(item.clip, f)];
  if (penAlpha < 1 || fillAlpha < 1) ops.push(`/${stateName(ctx, penAlpha, fillAlpha)} gs`);
  ops.push(`${num(width)} w`, `${penColour} RG`);
  if (fillColour) ops.push(fillColour);
  if (dash) ops.push(`[${dash.map((d) => num(d)).join(" ")}] 0 d`);
  ops.push(...pathOps(g, f), paint, "Q");
  if (pen && item.markers) ops.push(...markerOps(item.markers, item.clip, f, ctx, penColour, width, penAlpha));
  return ops.join("\n");
}

/**
 * A text object for a text geometry, in the current colour and rendering mode: in Helvetica, bold
 * or oblique as the text is, a narrow font (isNarrowFont) set NARROW_SCALE % as wide, and each
 * line underlined (a filled bar, as Helvetica places one) when the text is.
 */
function textOps(g: Extract<Geom, { kind: "text" }>, f: Frame, ctx: Ctx): string[] {
  const fontPt = Math.max(MIN_FONT_PT, g.size * f.k);
  const face = g.bold ? (g.italic ? "F4" : "F2") : g.italic ? "F3" : "F1";
  const narrow = isNarrowFont(g.fontIndex === undefined ? undefined : ctx.doc.fonts()[g.fontIndex]);
  const wide = narrow ? NARROW_SCALE / 100 : 1;
  const ops = ["BT", `/${face} ${num(fontPt)} Tf`, ...(narrow ? [`${NARROW_SCALE} Tz`] : [])];
  const rad = (g.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const share = g.hAlign === 2 ? 0.5 : g.hAlign === 3 ? 1 : 0;
  const bars: string[] = [];
  for (const line of g.lines) {
    // justified lines start back along the baseline by their share of the Helvetica width
    const w = helveticaWidth(line.text, g.bold) * fontPt * wide;
    const back = share * w;
    const x = line.x * f.k + f.ox - back * cos;
    const y = line.y * f.k + f.oy - back * sin;
    const at = `${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(x)} ${num(y)}`;
    ops.push(`${at} Tm ${pdfString(line.text)} Tj`);
    if (g.underline) bars.push("q", `${at} cm`, `0 ${num(-UNDERLINE_AT * fontPt)} ${num(w)} ${num(-UNDERLINE_WEIGHT * fontPt)} re f`, "Q");
  }
  ops.push("ET", ...bars);
  return ops;
}

/**
 * The drop shadow that the items from `i` sharing items[i].shadow cast, drawn once under all of
 * them. PDF has no blur, so it is built from SHADOW_LAYERS copies of their outlines, moved by the
 * shadow's offset and each stroked wider, with round joins, out to the blur radius, at an alpha
 * that adds up to the shadow's opacity where they all overlap: solid under the casters, fading
 * over the blur radius beyond them. Filled outlines go in one path per copy, wound the same way,
 * so overlapping casters don't darken it twice; text strokes its glyphs. Sizes are paper inches,
 * `perInch` world mm each, cropped as the first caster is.
 */
function shadowOps(items: readonly Item[], i: number, perInch: number, f: Frame, ctx: Ctx): string {
  const s = items[i].shadow!;
  const run: Item[] = [];
  for (let j = i; j < items.length && items[j].shadow === s; j++) run.push(items[j]);
  const alpha = 1 - Math.pow(1 - s.opacity / 100, 1 / SHADOW_LAYERS);
  if (!(alpha > 0)) return "";
  const v = shadowOffset(s, perInch);
  const reach = s.blur * perInch * f.k;
  const colour = rgbOperands(ctx.doc.color(s.color));
  const pen = Math.max(MIN_LINE_PT, ...run.map((item) => (item.attrs && drawsPen(item.attrs) ? item.attrs.lineWeight * PT_PER_MIL : 0)));
  const filled: string[] = [];
  const outlined: string[] = [];
  const texts: string[] = [];
  for (const item of run) {
    const g = item.geom;
    if (g.kind === "text") texts.push(...textOps(g, f, ctx));
    else if (g.kind === "image") filled.push(...pathOps(boxOutline(g.box), f));
    else if (item.attrs && item.attrs.fillPattern !== 0 && (g.kind === "path" ? g.fills : g.closed)) filled.push(...pathOps(counterClockwise(g), f));
    else if (drawsPen(item.attrs)) outlined.push(...pathOps(g, f));
  }
  const ops = ["q", ...clipOps(items[i].clip, f)];
  ops.push(`1 0 0 1 ${num(v.x * f.k)} ${num(v.y * f.k)} cm`, `/${stateName(ctx, alpha, alpha)} gs`, `${colour} rg`, `${colour} RG`, "1 j", "1 J", "2 Tr");
  for (let k = 1; k <= SHADOW_LAYERS; k++) {
    const spread = (2 * reach * k) / SHADOW_LAYERS;
    if (filled.length) ops.push(`${num(spread)} w`, ...filled, "B");
    if (outlined.length) ops.push(`${num(spread + pen)} w`, ...outlined, "S");
    if (texts.length) ops.push(`${num(spread)} w`, ...texts);
  }
  ops.push("Q");
  return ops.join("\n");
}

/** The outline wound counter-clockwise, so that filled in one path with others it adds to them. */
function counterClockwise(g: Outline): Outline {
  if (g.kind === "arc") return g.sweep < 0 ? { ...g, a0: g.a0 + g.sweep, sweep: -g.sweep } : g;
  let area = 0;
  for (let i = 0; i < g.pts.length; i++) {
    const p = g.pts[i];
    const q = g.pts[(i + 1) % g.pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area < 0 ? { ...g, pts: [...g.pts].reverse() } : g;
}

/**
 * Line markers over an object, in their own q/Q: arrows and dots filled, slashes stroked solid,
 * all in the pen colour (`colour`, "r g b") at the pen's width and alpha.
 */
function markerOps(markers: MarkerPath[], clip: Clip | undefined, f: Frame, ctx: Ctx, colour: string, width: number, alpha: number): string[] {
  const ops = ["q", ...clipOps(clip, f)];
  if (alpha < 1) ops.push(`/${stateName(ctx, alpha, alpha)} gs`);
  ops.push(`${num(width)} w`, `${colour} RG`, `${colour} rg`);
  for (const m of markers) {
    if (m.kind === "polygon") {
      ops.push(...m.points.map((p, i) => `${px(f, p.x)} ${py(f, p.y)} ${i === 0 ? "m" : "l"}`), "h", "f");
    } else if (m.kind === "circle") {
      ops.push(...arcOps({ kind: "arc", c: m.center, rx: m.r, ry: m.r, a0: 0, sweep: 360, closed: true }, f), "f");
    } else {
      ops.push(`${px(f, m.a.x)} ${py(f, m.a.y)} m`, `${px(f, m.b.x)} ${py(f, m.b.y)} l`, "S");
    }
  }
  ops.push("Q");
  return ops;
}

/**
 * Clip operators for a viewport box: a rectangle in page points, mapped like the drawing, that the
 * operators after it are cropped to. The frame has no flip, so the box's corner and size scale directly.
 */
/** Clips to a viewport's box, then to its crop object's outline when it has one. */
function clipOps(clip: Clip | undefined, f: Frame): string[] {
  if (!clip) return [];
  const w = num((clip.x1 - clip.x0) * f.k);
  const h = num((clip.y1 - clip.y0) * f.k);
  const ops = [`${px(f, clip.x0)} ${py(f, clip.y0)} ${w} ${h} re`, "W n"];
  const pts = clip.outline;
  if (pts && pts.length >= 3) ops.push(...pts.map((p, i) => `${px(f, p.x)} ${py(f, p.y)} ${i === 0 ? "m" : "l"}`), "h", "W n");
  return ops;
}

/** Path construction operators in page points. */
/** A box as a closed outline, counter-clockwise. */
function boxOutline(b: BBox): Outline {
  const pts = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  return { kind: "path", pts, closed: true, fills: true };
}

/** The XObject name of an image, written into ctx.images the first time; null when it can't be written. */
function imageName(bytes: Uint8Array, ctx: Ctx): string | null {
  let name = ctx.imageNames.get(bytes);
  if (name !== undefined) return name;
  // records holding the same picture (a logo on every title block) share one image
  const key = `${bytes.length}:${fnv1a(bytes)}`;
  const same = ctx.imageContents.get(key) ?? [];
  const copy = same.find((s) => s.bytes.every((v, i) => v === bytes[i]));
  if (copy) name = copy.name;
  else {
    const image = pdfImage(bytes);
    name = image ? `Im${ctx.images.push(image)}` : null;
    ctx.imageContents.set(key, [...same, { bytes, name }]);
  }
  ctx.imageNames.set(bytes, name);
  return name;
}

/** 32-bit FNV-1a hash of some bytes. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

function pathOps(g: Outline, f: Frame): string[] {
  if (g.kind === "arc") return arcOps(g, f);
  const ops = g.pts.map((p, i) => `${px(f, p.x)} ${py(f, p.y)} ${i === 0 ? "m" : "l"}`);
  if (g.closed) ops.push("h");
  return ops;
}

/** Cubic Bezier approximation of an elliptical arc, at most ARC_MAX_DEG per segment. */
function arcOps(g: ArcGeom, f: Frame): string[] {
  const { c, rx, ry } = g;
  const n = Math.max(1, Math.ceil(Math.abs(g.sweep) / ARC_MAX_DEG));
  const step = g.sweep / n; // degrees per segment, signed
  // Handle length for a segment of angle `step`: 4/3 tan(step / 4), with step in radians.
  const k = (4 / 3) * Math.tan((step * Math.PI) / 720);
  const ops: string[] = [];
  const start = arcPoint(c, rx, ry, g.a0);
  ops.push(`${px(f, start.x)} ${py(f, start.y)} m`);
  for (let i = 0; i < n; i++) {
    const a = ((g.a0 + step * i) * Math.PI) / 180;
    const b = ((g.a0 + step * (i + 1)) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    // The control points lie along the tangents at the two ends of the segment.
    const x1 = c.x + rx * ca - k * rx * sa;
    const y1 = c.y + ry * sa + k * ry * ca;
    const x2 = c.x + rx * cb + k * rx * sb;
    const y2 = c.y + ry * sb - k * ry * cb;
    const x3 = c.x + rx * cb;
    const y3 = c.y + ry * sb;
    ops.push(`${px(f, x1)} ${py(f, y1)} ${px(f, x2)} ${py(f, y2)} ${px(f, x3)} ${py(f, y3)} c`);
  }
  if (g.closed) ops.push("h");
  return ops;
}

/**
 * Dash pattern of a line type in points, or null for a solid line. Dash lengths are paper inches,
 * so they are not scaled by the layer. An odd-length list is repeated, as svg.ts does, so the
 * dash and gap alternation stays exact.
 */
function dashPattern(lineStyle: number, lineTypes: Map<number, LineType>): number[] | null {
  if (lineStyle >= 0) return null;
  const dashes = lineTypes.get(lineStyle)?.dashes ?? [];
  const list = dashes.length % 2 === 1 ? [...dashes, ...dashes] : dashes;
  const pattern = list.map((d) => d * PT_PER_INCH);
  if (!pattern.every((d) => Number.isFinite(d) && d >= 0) || !pattern.some((d) => d > 0)) return null;
  return pattern;
}

/** Opacity from a Vectorworks percentage, as 0..1. */
function opacity(percent: number | undefined): number {
  if (percent === undefined || !Number.isFinite(percent)) return 1;
  return Math.min(1, Math.max(0, percent / 100));
}

/** Name of the ExtGState with these stroke and fill alphas, registered for the page being drawn. */
function stateName(ctx: Ctx, stroke: number, fill: number): string {
  const key = `${num(stroke)} ${num(fill)}`;
  let index = ctx.stateIndex.get(key);
  if (index === undefined) {
    index = ctx.stateIndex.size;
    ctx.stateIndex.set(key, index);
  }
  const name = `GS${index + 1}`;
  ctx.states.set(name, `<< /Type /ExtGState /CA ${num(stroke)} /ca ${num(fill)} >>`);
  return name;
}

/** "r g b" operands in 0..1 for a document colour; cached per palette index. */
function rgb(ctx: Ctx, index: number): string {
  let value = ctx.rgbs.get(index);
  if (value === undefined) {
    value = rgbOperands(ctx.doc.color(index));
    ctx.rgbs.set(index, value);
  }
  return value;
}

/** "r g b" operands in 0..1 for a "#rrggbb" colour; black when malformed. */
/** The colour a bitmap pattern averages to: `fore` where its bits are set, `back` elsewhere. */
function mixByBits(fore: string, back: string, bits: readonly number[]): string {
  if (!/^#[0-9a-f]{6}$/i.test(fore) || !/^#[0-9a-f]{6}$/i.test(back)) return back;
  const share = bits.reduce((n, row) => n + row.toString(2).replace(/0/g, "").length, 0) / 64;
  const f = parseInt(fore.slice(1), 16);
  const b = parseInt(back.slice(1), 16);
  const channel = (shift: number) => Math.round(((f >> shift) & 255) * share + ((b >> shift) & 255) * (1 - share));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

function rgbOperands(css: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) return BLACK;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => num(c / 255)).join(" ");
}

/** Helvetica advance widths (1/1000 em) for ASCII 32-126, from the standard AFM. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
];

/** Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126, from the standard AFM. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

/** Width of a line set in Helvetica (or Helvetica-Bold), in ems. */
export function helveticaWidth(text: string, bold = false): number {
  const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let w = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? widths[c - 32] : 556;
  }
  return w / 1000;
}

/**
 * PDF literal string for WinAnsi text. Latin-1 characters (WinAnsi agrees with Latin-1 on
 * 0xA0-0xFF) become octal escapes, which keeps the file ASCII; any other character becomes "?".
 * Tabs become spaces and other control characters are dropped.
 */
function pdfString(s: string): string {
  const out: string[] = ["("];
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x09) out.push(" ");
    else if (c < 0x20 || c === 0x7f) continue;
    else if (c < 0x7f) out.push(c === 0x28 || c === 0x29 || c === 0x5c ? `\\${ch}` : ch);
    else if (c >= 0xa0 && c <= 0xff) out.push(`\\${c.toString(8).padStart(3, "0")}`);
    else out.push("?");
  }
  out.push(")");
  return out.join("");
}

/** Assembles the file: header, objects, cross-reference table and trailer. */
function writePdf(pages: Page[], images: readonly PdfImage[], fileName: string): Uint8Array {
  const enc = new TextEncoder();
  // Object numbers: 1 catalog, 2 page tree, 3 font, then page and content for each page, then each
  // image and its soft mask, then the bold, oblique and bold oblique fonts, then info.
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ");
  const imageIds: number[] = [];
  let nextId = 4 + 2 * pages.length;
  for (const image of images) {
    imageIds.push(nextId);
    nextId += image.smask ? 2 : 1;
  }
  const faces = ["Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"];
  const fonts = `/F1 3 0 R ${faces.map((_, i) => `/F${i + 2} ${nextId + i} 0 R`).join(" ")}`;
  const objects: (string | { data: string } | { dict: string; bytes: Uint8Array })[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((page, i) => {
    const states = [...page.states].map(([name, dict]) => `/${name} ${dict}`).join(" ");
    const ext = states ? ` /ExtGState << ${states} >>` : "";
    const xobjects = [...page.images].map((name) => `/${name} ${imageIds[Number(name.slice(2)) - 1]} 0 R`).join(" ");
    const xo = xobjects ? ` /XObject << ${xobjects} >>` : "";
    // viewers cap pages at 14,400 units; larger drawings use a bigger user unit
    const unit = Math.max(1, Math.ceil(Math.max(page.width, page.height) / MAX_PAGE_PT));
    const userUnit = unit > 1 ? ` /UserUnit ${unit}` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width / unit)} ${num(page.height / unit)}]${userUnit} ` +
        `/Resources << /Font << ${fonts} >>${ext}${xo} >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    objects.push({ data: unit > 1 ? `q\n${+(1 / unit).toFixed(8)} 0 0 ${+(1 / unit).toFixed(8)} 0 0 cm\n${page.content}\nQ` : page.content });
  });
  images.forEach((image, i) => {
    objects.push({ dict: image.smask ? `${image.dict} /SMask ${imageIds[i] + 1} 0 R` : image.dict, bytes: image.data });
    if (image.smask) objects.push({ dict: image.smask.dict, bytes: image.smask.data });
  });
  for (const face of faces) objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${face} /Encoding /WinAnsiEncoding >>`);
  const title = fileName.replace(/\.vwx$/i, "");
  objects.push(`<< /Producer (Rodeo)${title ? ` /Title ${pdfString(title)}` : ""} >>`);
  const infoId = objects.length;

  const chunks: Uint8Array[] = [];
  let pos = 0;
  const put = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    pos += bytes.length;
  };
  const text = (s: string): void => put(enc.encode(s));

  text("%PDF-1.6\n%"); // 1.6 for /UserUnit
  put(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3])); // binary marker: keeps transfer tools from treating the file as text
  text("\n");
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pos);
    if (typeof obj === "string") {
      text(`${i + 1} 0 obj\n${obj}\nendobj\n`);
    } else if ("bytes" in obj) {
      text(`${i + 1} 0 obj\n<< ${obj.dict} /Length ${obj.bytes.length} >>\nstream\n`);
      put(obj.bytes);
      text("\nendstream\nendobj\n");
    } else {
      const data = enc.encode(obj.data);
      text(`${i + 1} 0 obj\n<< /Length ${data.length} >>\nstream\n`);
      put(data);
      text("\nendstream\nendobj\n");
    }
  });

  const xref = pos;
  const table = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (const off of offsets) table.push(`${String(off).padStart(10, "0")} 00000 n `);
  table.push(
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>`,
    "startxref",
    String(xref),
    "%%EOF",
    "",
  );
  text(table.join("\n"));

  const out = new Uint8Array(pos);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function isFiniteBox(b: BBox): boolean {
  return [b.x0, b.y0, b.x1, b.y1].every((v) => Number.isFinite(v));
}

/** Millimetres to points. */
function mm(v: number): number {
  return v * PT_PER_MM;
}

/** Number for PDF syntax: up to 3 decimals, trailing zeros stripped. */
function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  let s = v.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

function px(f: Frame, x: number): string {
  return num(x * f.k + f.ox);
}

function py(f: Frame, y: number): string {
  return num(y * f.k + f.oy);
}
