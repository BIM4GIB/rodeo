// SVG export of design layers. Document coordinates are y-up and SVG is y-down,
// so every y is negated. Geometry stays in world millimetres, whatever the document's units.

import { drawsPen } from "../core/attrs.ts";
import { textBaselines } from "../core/geometry.ts";
import { markerPaths } from "../core/markers.ts";
import { composeAffine } from "../core/encode.ts";
import { mapShape, withContainers } from "../core/model.ts";
import { shadowOffset } from "../core/shadow.ts";
import type { BBox, ClassInfo, Clip, DropShadow, LayerInfo, LineType, ObjectInfo, Pt, Shape, VwxDocument } from "../core/types.ts";

const DEFAULT_STROKE = "#1d1d1f";
const GRAYED_OPACITY = "0.3";
const STROKE_WIDTH = "0.6";
const FONT_FAMILY = "Arial, Helvetica, sans-serif";
const NON_SCALING = ' vector-effect="non-scaling-stroke"';
const ARC_SAMPLES = 64;
const PAPER_INCH_MM = 25.4;

/**
 * Standalone SVG document of the given layers, in the order given. Each layer is an
 * Inkscape layer group holding one <g data-class> per class. Objects of hidden classes
 * are skipped; grayed classes are drawn at 30% opacity. Dashed line types become explicit
 * dash geometry in document units (see dashPattern), and line markers keep their paper size
 * the same way. Objects inside a viewport are cropped to its box with a clipPath; a plan
 * viewport's design layers are carried onto the sheet. Drop shadows are blurred copies of
 * what the export draws (outlines and text), made by a filter on the objects that cast one.
 */
export function exportSvg(doc: VwxDocument, layerIds: string[]): string {
  const layers = doc.layers();
  const classes = new Map(doc.classes().map((c): [number, ClassInfo] => [c.index, c]));
  const lineTypes = new Map(doc.lineTypes().map((t): [number, LineType] => [t.style, t]));
  const usedIds = new Set<string>();
  const boxes: BBox[] = [];
  const clips = new Map<string, ClipDef>();
  const filters: string[] = [];
  const groups: string[] = [];

  for (const layerId of layerIds) {
    const layer = findLayer(layers, layerId);
    const id = uniqueId(sanitizeId(layer.name), usedIds);
    const label = layer.title ? `${layer.name} (${layer.title})` : layer.name;
    const body = renderLayer(doc, layer, classes, lineTypes, boxes, clips, filters, usedIds);
    groups.push(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(label)}">${body}</g>`);
  }

  const bounds = unionBounds(boxes) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `viewBox="${viewBox(bounds)}" fill="none" stroke-width="${STROKE_WIDTH}">\n` +
    clipDefs(clips) +
    (filters.length > 0 ? `<defs>${filters.join("")}</defs>\n` : "") +
    groups.map((g) => `${g}\n`).join("") +
    `</svg>\n`
  );
}

/** Layer by stable id; throws for an unknown id. */
export function findLayer(layers: LayerInfo[], id: string): LayerInfo {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`unknown layer id: ${id}`);
  return layer;
}

/** Point on an axis-aligned ellipse; angle in degrees, counter-clockwise from +x. */
export function arcPoint(c: Pt, rx: number, ry: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
}

/** Bounds of a shape in document coordinates, or null when it has no geometry. */
export function shapeBounds(s: Shape): BBox | null {
  if (s.bbox) return s.bbox;
  const pts: Pt[] = [...s.points];
  if (s.kind === "arc" && s.center && s.rx !== undefined && s.ry !== undefined) {
    const a0 = s.startAngle ?? 0;
    const sweep = s.sweepAngle ?? 0;
    for (let i = 0; i <= ARC_SAMPLES; i++) {
      pts.push(arcPoint(s.center, Math.abs(s.rx), Math.abs(s.ry), a0 + (sweep * i) / ARC_SAMPLES));
    }
  }
  return unionBounds(pts.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })));
}

/** Bounds of what a shape shows: its bounds cropped to the viewport box it sits in, or null when nothing shows. */
export function shownBounds(s: Shape, clip: BBox | undefined): BBox | null {
  const b = shapeBounds(s);
  if (!b || !clip) return b;
  const x0 = Math.max(b.x0, clip.x0);
  const y0 = Math.max(b.y0, clip.y0);
  const x1 = Math.min(b.x1, clip.x1);
  const y1 = Math.min(b.y1, clip.y1);
  return x0 <= x1 && y0 <= y1 ? { x0, y0, x1, y1 } : null;
}

/** Union of boxes, or null when there are none. */
export function unionBounds(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  return { x0, y0, x1, y1 };
}

/** One object's drawing in its class group, with the shadow it casts there. */
interface Frag {
  svg: string;
  shadow?: DropShadow;
  /** world millimetres to the paper inch where it is drawn: shadows are paper sized */
  perInch: number;
  box: BBox | null;
}

/** A viewport crop written as a clipPath; objects with the same crop share one. */
interface ClipDef {
  id: string;
  box: Clip;
}

function renderLayer(
  doc: VwxDocument,
  layer: LayerInfo,
  classes: Map<number, ClassInfo>,
  lineTypes: Map<number, LineType>,
  boxes: BBox[],
  clips: Map<string, ClipDef>,
  filters: string[],
  usedIds: Set<string>,
): string {
  const byClass = new Map<number, { name: string; grayed: boolean; frags: Frag[] }>();
  // sections and details draw from their caches, which their data visualisations can restyle
  const styles = layer.kind === "sheet" ? doc.viewportStyles(layer.id) : null;
  for (const obj of doc.objects(layer.id)) {
    const shape = obj.shape;
    if (!shape) continue;
    const style = styles?.get(obj.id);
    const lineStyle = style?.lineStyle ?? obj.attrs?.lineStyle;
    const cls = classes.get(obj.classIndex);
    if (withContainers(cls?.visibility ?? "visible", obj, (i) => classes.get(i)?.visibility) === "hidden" || penless(obj, lineStyle)) continue;
    const stroke = xmlEscape(style?.pen ?? (obj.attrs ? doc.color(obj.attrs.penFore) : DEFAULT_STROKE));
    const dash = dashPattern(lineStyle, lineTypes, layer.scale);
    const outline = shapeSvg(shape, stroke, dash, doc.fonts());
    if (outline === null) continue;
    const frag = outline + markersSvg(obj, shape, stroke, layer.scale);
    let group = byClass.get(obj.classIndex);
    if (!group) {
      group = { name: cls?.name ?? obj.className, grayed: cls?.visibility === "grayed", frags: [] };
      byClass.set(obj.classIndex, group);
    }
    const b = shownBounds(shape, obj.clip);
    if (b) boxes.push(b);
    const svg = obj.clip ? cropped(frag, obj.clip, clips, usedIds) : frag;
    group.frags.push({ svg, shadow: obj.shadow, perInch: PAPER_INCH_MM * layer.scale, box: b });
  }
  // plan viewports draw the design layers they list, and design-layer viewports the layers they
  // show, with their own class visibility
  for (const vp of doc.viewports(layer.id)) {
    const host = vp.uncropped ? doc.object(vp.id) : null;
    const hostVisibility = host ? withContainers(classes.get(host.classIndex)?.visibility ?? "visible", host, (i) => classes.get(i)?.visibility) : "visible";
    if (hostVisibility === "hidden") continue;
    // a plan viewport's shapes land on the sheet, so dashes and markers are paper sized
    const paper = vp.uncropped ? layer.scale : 1;
    const crop = vp.uncropped ? undefined : vp.clip;
    for (const shown of vp.layers) {
      if (shown.visibility === "hidden") continue;
      const vpClasses = shown.via?.classes ?? vp.classes;
      const m = shown.via ? composeAffine(vp.m, shown.via.m) : vp.m;
      for (const obj of doc.objects(shown.id)) {
        // a data visualisation can change the pen
        const style = vp.styles?.get(obj.id);
        const lineStyle = style?.lineStyle ?? obj.attrs?.lineStyle;
        if (!obj.shape || penless(obj, lineStyle)) continue;
        const cls = classes.get(obj.classIndex);
        const own = vpClasses.get(obj.classIndex) ?? cls?.visibility ?? "visible";
        const visibility = withContainers(own, obj, (i) => vpClasses.get(i) ?? classes.get(i)?.visibility);
        if (visibility === "hidden") continue;
        const shape = mapShape(obj.shape, m);
        const stroke = xmlEscape(style?.pen ?? (obj.attrs ? doc.color(obj.attrs.penFore) : DEFAULT_STROKE));
        const outline = shapeSvg(shape, stroke, dashPattern(lineStyle, lineTypes, paper), doc.fonts());
        if (outline === null) continue;
        const frag = outline + markersSvg(obj, shape, stroke, paper);
        let group = byClass.get(obj.classIndex);
        if (!group) {
          group = { name: cls?.name ?? obj.className, grayed: cls?.visibility === "grayed", frags: [] };
          byClass.set(obj.classIndex, group);
        }
        const grayed = (visibility === "grayed" || shown.visibility === "grayed" || hostVisibility === "grayed") && !group.grayed;
        const faded = grayed ? `<g opacity="${GRAYED_OPACITY}">${frag}</g>` : frag;
        const svg = crop ? cropped(faded, crop, clips, usedIds) : faded;
        const b = shownBounds(shape, crop);
        if (b) boxes.push(b);
        group.frags.push({ svg, shadow: obj.shadow, perInch: PAPER_INCH_MM * paper, box: b });
      }
    }
  }
  let out = "";
  for (const g of byClass.values()) {
    const opacity = g.grayed ? ` opacity="${GRAYED_OPACITY}"` : "";
    out += `<g data-class="${xmlEscape(g.name)}"${opacity}>${shadowed(doc, g.frags, filters, usedIds)}</g>`;
  }
  return out;
}

/**
 * Frags joined, each run of consecutive ones with the same shadow (the parts of one plug-in or
 * group) in a group that casts it once, so overlapping parts don't darken it twice.
 */
function shadowed(doc: VwxDocument, frags: Frag[], filters: string[], usedIds: Set<string>): string {
  let out = "";
  for (let i = 0; i < frags.length; ) {
    const { shadow, perInch } = frags[i];
    let j = i;
    let body = "";
    const boxes: BBox[] = [];
    do {
      body += frags[j].svg;
      const b = frags[j].box;
      if (b) boxes.push(b);
      j++;
    } while (shadow && j < frags.length && frags[j].shadow === shadow && frags[j].perInch === perInch);
    const box = unionBounds(boxes);
    out += shadow && box ? `<g filter="url(#${shadowFilter(doc, shadow, perInch, box, filters, usedIds)})">${body}</g>` : body;
    i = j;
  }
  return out;
}

/**
 * Adds a filter that draws a shadow under its source and returns its id. The blur is a
 * Gaussian of half the blur radius, as a canvas draws it, and the filter region is the
 * source's bounds grown by as far as the shadow reaches. Y is negated, as the drawing is.
 */
function shadowFilter(doc: VwxDocument, s: DropShadow, perInch: number, box: BBox, filters: string[], usedIds: Set<string>): string {
  const id = uniqueId("shadow", usedIds);
  const v = shadowOffset(s, perInch);
  const sigma = (s.blur * perInch) / 2;
  const reach = Math.hypot(v.x, v.y) + 3 * sigma;
  const region = `x="${num(box.x0 - reach)}" y="${num(-box.y1 - reach)}" width="${num(box.x1 - box.x0 + 2 * reach)}" height="${num(box.y1 - box.y0 + 2 * reach)}"`;
  filters.push(
    `<filter id="${id}" filterUnits="userSpaceOnUse" ${region} color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(sigma)}"/>` +
      `<feOffset dx="${num(v.x)}" dy="${num(-v.y)}" result="blur"/>` +
      `<feFlood flood-color="${xmlEscape(doc.color(s.color))}" flood-opacity="${num(s.opacity / 100)}"/>` +
      `<feComposite in2="blur" operator="in"/>` +
      `<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>` +
      `</filter>`,
  );
  return id;
}

/** A fragment wrapped in a group clipped to a viewport box. */
function cropped(frag: string, box: Clip, clips: Map<string, ClipDef>, usedIds: Set<string>): string {
  const key = [box.x0, box.y0, box.x1, box.y1, ...(box.outline ?? []).flatMap((p) => [p.x, p.y])].join(" ");
  let clip = clips.get(key);
  if (!clip) {
    clip = { id: uniqueId("clip", usedIds), box };
    clips.set(key, clip);
  }
  return `<g clip-path="url(#${clip.id})">${frag}</g>`;
}

/** The clipPath elements, in <defs>, or nothing when no object is cropped. Y is negated, as the drawing is. */
function clipDefs(clips: Map<string, ClipDef>): string {
  if (clips.size === 0) return "";
  const paths = [...clips.values()].map(({ id, box: { x0, y0, x1, y1, outline } }) => {
    const rect = `x="${num(x0)}" y="${num(-y1)}" width="${num(x1 - x0)}" height="${num(y1 - y0)}"`;
    // the box, narrowed to the crop object's outline: a clip-path on the clipPath intersects them
    if (!outline || outline.length < 3) return `<clipPath id="${id}"><rect ${rect}/></clipPath>`;
    const pts = outline.map((p) => `${num(p.x)},${num(-p.y)}`).join(" ");
    return `<clipPath id="${id}-box"><rect ${rect}/></clipPath><clipPath id="${id}" clip-path="url(#${id}-box)"><polygon points="${pts}"/></clipPath>`;
  });
  return `<defs>${paths.join("")}</defs>\n`;
}

/**
 * The export draws outlines only, so a shape without one (drawsPen) leaves nothing; text and images have no pen.
 * `lineStyle` replaces the object's own when a data visualisation sets it.
 */
function penless(obj: ObjectInfo, lineStyle = obj.attrs?.lineStyle): boolean {
  const kind = obj.shape?.kind;
  const attrs = obj.attrs && lineStyle !== undefined ? { ...obj.attrs, lineStyle } : obj.attrs;
  return !drawsPen(attrs) && kind !== "text" && kind !== "image";
}

function shapeSvg(s: Shape, stroke: string, dash: number[] | null, fonts: readonly string[] = []): string | null {
  switch (s.kind) {
    case "line":
    case "rect":
    case "polygon":
    case "polyline": {
      if (s.hidden) {
        const d = visiblePathData(s.points, s.hidden, s.closed);
        return d === null ? null : `<path d="${d}" stroke="${stroke}"${NON_SCALING}/>`;
      }
      if (dash) return dashedSvg(s.points, s.closed, dash, stroke);
      const d = pathData(s.points, s.closed);
      return d === null ? null : `<path d="${d}" stroke="${stroke}"${NON_SCALING}/>`;
    }
    case "arc":
      return arcSvg(s, stroke, dash);
    case "text":
      return textSvg(s, stroke, fonts);
    case "image":
      return imageSvg(s);
    default:
      return null;
  }
}

/**
 * An object's line markers, drawn at the ends of `shape` in the pen colour: arrows and dots
 * filled, slashes stroked. Their sizes are paper inches, `scale` times larger in the drawing.
 */
function markersSvg(obj: ObjectInfo, shape: Shape, stroke: string, scale: number): string {
  if (!obj.markers) return "";
  const at = (p: Pt) => `${num(p.x)} ${num(-p.y)}`;
  return markerPaths(shape, obj.markers, PAPER_INCH_MM * scale)
    .map((m) => {
      if (m.kind === "polygon") return `<path d="M${m.points.map(at).join(" L")} Z" fill="${stroke}" stroke="none"/>`;
      if (m.kind === "circle") return `<circle cx="${num(m.center.x)}" cy="${num(-m.center.y)}" r="${num(m.r)}" fill="${stroke}" stroke="none"/>`;
      return `<path d="M${at(m.a)} L${at(m.b)}" stroke="${stroke}"${NON_SCALING}/>`;
    })
    .join("");
}

function pathData(points: Pt[], closed: boolean): string | null {
  if (points.length < 2) return null;
  const d = "M" + points.map((p) => `${num(p.x)} ${num(-p.y)}`).join(" L");
  return closed ? `${d} Z` : d;
}

/** Path data for the edges of a polyline that are not hidden, one subpath per run. */
function visiblePathData(points: Pt[], hidden: number[], closed: boolean): string | null {
  const skip = new Set(hidden);
  const n = points.length;
  const segs = closed ? n : n - 1;
  let d = "";
  let open = false;
  for (let i = 0; i < segs; i++) {
    if (skip.has(i)) {
      open = false;
      continue;
    }
    const a = points[i];
    const b = points[(i + 1) % n];
    if (!open) d += `M${num(a.x)} ${num(-a.y)}`;
    d += ` L${num(b.x)} ${num(-b.y)}`;
    open = true;
  }
  return d || null;
}

/**
 * Dash pattern of the object's line type in document units: paper inches times the layer
 * scale (1 paper inch on a 1:50 layer is 1270 mm). Null when the object draws solid.
 * Dashes are written as geometry rather than stroke-dasharray: with vector-effect
 * non-scaling-stroke, Chrome reads the dash array in screen pixels, ignoring the scale.
 */
function dashPattern(
  lineStyle: number | undefined,
  lineTypes: Map<number, LineType>,
  scale: number,
): number[] | null {
  if (lineStyle === undefined || lineStyle >= 0) return null;
  const dashes = lineTypes.get(lineStyle)?.dashes ?? [];
  // An odd-length list is repeated, as SVG does, so the dash and gap alternation stays exact.
  const list = dashes.length % 2 === 1 ? [...dashes, ...dashes] : dashes;
  const pattern = list.map((d) => d * PAPER_INCH_MM * scale);
  if (!pattern.every((d) => Number.isFinite(d) && d >= 0) || !pattern.some((d) => d > 0)) return null;
  return pattern;
}

/** Splits an open polyline into the runs drawn by a dash, gap, dash, ... pattern starting on. */
function dashPolyline(pts: Pt[], pattern: number[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [pts[0]];
  let on = true;
  let i = 0;
  let left = pattern[0];
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s];
    const b = pts[s + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (len - t > left) {
      t += left;
      const p = { x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len };
      if (on) {
        run.push(p);
        runs.push(run);
        run = [];
      } else {
        run = [p];
      }
      on = !on;
      i = (i + 1) % pattern.length;
      left = pattern[i];
    }
    left -= len - t;
    if (on) run.push(b);
  }
  if (on && run.length > 1) runs.push(run);
  return runs;
}

/** The dash runs of a polyline as one path. A closed shape repeats its first point. */
function dashedSvg(points: Pt[], closed: boolean, pattern: number[], stroke: string): string | null {
  if (points.length < 2) return null;
  const pts = closed ? [...points, points[0]] : points;
  const d = dashPolyline(pts, pattern)
    .map((run) => pathData(run, false))
    .filter((part): part is string => part !== null)
    .join(" ");
  return d === "" ? null : `<path d="${d}" stroke="${stroke}"${NON_SCALING}/>`;
}

/** Points along an arc or full ellipse, at most half a degree apart. */
function arcSamples(c: Pt, rx: number, ry: number, a0: number, sweep: number): Pt[] {
  const n = Math.max(ARC_SAMPLES, Math.ceil(Math.abs(sweep) * 2));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) pts.push(arcPoint(c, rx, ry, a0 + (sweep * i) / n));
  return pts;
}

function arcSvg(s: Shape, stroke: string, dash: number[] | null): string | null {
  const c = s.center;
  if (!c || s.rx === undefined || s.ry === undefined) return null;
  const rx = Math.abs(s.rx);
  const ry = Math.abs(s.ry);
  const a0 = s.startAngle ?? 0;
  const sweep = s.sweepAngle ?? 0;
  if (dash) return dashedSvg(arcSamples(c, rx, ry, a0, sweep), false, dash, stroke);
  if (Math.abs(sweep) >= 360) {
    return `<ellipse cx="${num(c.x)}" cy="${num(-c.y)}" rx="${num(rx)}" ry="${num(ry)}" stroke="${stroke}"${NON_SCALING}/>`;
  }
  if (sweep === 0) return null;
  const start = arcPoint(c, rx, ry, a0);
  const end = arcPoint(c, rx, ry, a0 + sweep);
  // Negating y mirrors the sense of rotation: a positive (counter-clockwise) world sweep
  // is a negative-angle sweep in SVG, hence sweep-flag 0. large-arc = |sweep| > 180.
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 0 : 1;
  const d =
    `M${num(start.x)} ${num(-start.y)} A${num(rx)} ${num(ry)} 0 ${largeArc} ${sweepFlag} ` +
    `${num(end.x)} ${num(-end.y)}`;
  return `<path d="${d}" stroke="${stroke}"${NON_SCALING}/>`;
}

/** A text's lines, in its own font (then Arial) and style. */
function textSvg(s: Shape, fill: string, fonts: readonly string[]): string | null {
  const laid = textBaselines(s);
  if (laid) {
    const anchor = laid.hAlign === 2 ? "middle" : laid.hAlign === 3 ? "end" : "start";
    const turn = (p: Pt) => (laid.angle ? ` transform="rotate(${num(-laid.angle)} ${num(p.x)} ${num(-p.y)})"` : "");
    const name = s.fontIndex === undefined ? undefined : fonts[s.fontIndex];
    const family = name ? `'${xmlEscape(name.replace(/'/g, ""))}', ${FONT_FAMILY}` : FONT_FAMILY;
    const style =
      (s.bold ? ` font-weight="bold"` : "") + (s.italic ? ` font-style="italic"` : "") + (s.underline ? ` text-decoration="underline"` : "");
    return laid.lines
      .map(
        ({ text, at }) =>
          `<text x="${num(at.x)}" y="${num(-at.y)}"${turn(at)} font-size="${num(laid.size)}" ` +
          `font-family="${family}"${style} text-anchor="${anchor}" fill="${fill}" stroke="none">${xmlEscape(text)}</text>`,
      )
      .join("");
  }
  const b = s.bbox;
  if (!b) return null;
  const h = (b.y1 - b.y0) || 1;
  const lines = (s.text ?? "").split(/\r\n|\r|\n/);
  const size = (h / Math.max(1, lines.length)) * 0.8;
  const tspans = lines
    .map((line, i) => `<tspan x="${num(b.x0)}" y="${num(-b.y1 + size * (i + 1))}">${xmlEscape(line)}</tspan>`)
    .join("");
  return `<text font-size="${num(size)}" font-family="${FONT_FAMILY}" fill="${fill}" stroke="none">${tspans}</text>`;
}

function imageSvg(s: Shape): string | null {
  const b = s.bbox;
  if (!b || !s.image || s.image.length === 0) return null;
  const mime = xmlEscape(s.imageMime ?? sniffMime(s.image));
  return (
    `<image x="${num(b.x0)}" y="${num(-b.y1)}" width="${num(b.x1 - b.x0)}" height="${num(b.y1 - b.y0)}" ` +
    `preserveAspectRatio="none" href="data:${mime};base64,${toBase64(s.image)}"/>`
  );
}

function sniffMime(b: Uint8Array): string {
  return b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg" : "image/png";
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 without Buffer or btoa; output is built in chunks to keep string ropes small. */
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  const full = bytes.length - (bytes.length % 3);
  for (let i = 0; i < full; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    if (chunk.length >= 0x10000) {
      parts.push(chunk);
      chunk = "";
    }
  }
  const rest = bytes.length - full;
  if (rest === 1) {
    const v = bytes[full] << 16;
    chunk += B64[v >> 18] + B64[(v >> 12) & 63] + "==";
  } else if (rest === 2) {
    const v = (bytes[full] << 16) | (bytes[full + 1] << 8);
    chunk += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + "=";
  }
  parts.push(chunk);
  return parts.join("");
}

function viewBox(b: BBox): string {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const pad = Math.max(w, h, 1) * 0.02;
  return [b.x0 - pad, -b.y1 - pad, w + 2 * pad, h + 2 * pad].map((v) => num(v)).join(" ");
}

/** Up to 3 decimals, trailing zeros stripped. */
function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  let s = v.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

// XML 1.0 forbids these control characters even as character references.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function xmlEscape(s: string): string {
  return s
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_") || "layer";
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}
