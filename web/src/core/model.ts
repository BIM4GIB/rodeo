// The open document: record buffers in stream order plus indices derived from
// them (tree, layers, classes, names, objects). Implements VwxDocument.
//
// Record buffers are treated as immutable once they are part of `datas`:
// edits copy a buffer, change the copy and swap it in (see edit.ts). That
// makes undo a matter of swapping buffer references back, and lets decoded
// shapes, GUIDs and Rec wrappers be cached per buffer.

import { ATTR_END, BY_CLASS, CLASS_TEXT_STYLE, CLASS_TEXTURE, byClassGroups, colorOf, readAttrs, readClassAttrs, readColorNames, readColorTable, readLineTypes, readPalette, resolveAttrs } from "./attrs.ts";
import { f64, i16, i32, readAscii, readUtf16, u16, u32 } from "./bytes.ts";
import { findUnits, type OpenedContainer, readContainer, type VwxSink, type WriteOptions, type Written, writeContainer, writeVwx } from "./container.ts";
import { anyHeld } from "./held.ts";
import {
  FILL_MAPPING,
  IDENTITY,
  MOVABLE_3D,
  OWN_FRAME,
  PLUGIN,
  SLAB_END,
  SLAB_THICKNESS,
  applyAffine,
  childrenMoveWith,
  planBounds,
  planFrame,
  composeAffine,
  isIdentity,
  readFillMapping,
  readInstanceMatrix,
  readInstancePlacement,
  readPluginMatrix,
  transformRecord,
} from "./encode.ts";
import {
  VIEWPORT,
  VIEWPORT_BOX,
  VIEWPORT_ENTRY_NAME,
  VIEWPORT_ENTRY_SIZE,
  VIEWPORT_ENTRY_VISIBILITY,
  VIEWPORT_ROTATION,
  VIEWPORT_SHIFT,
  LIGHT,
  WALL,
  WALL_STYLE,
  WALL_STYLE_RESOURCE,
  bboxOfPoints,
  decodeShape,
  isViewportAnnotations,
  isViewportCrop,
  modelGroupPlan,
  onViewportSheet,
  readTextFrame,
  readWall,
  standsUp,
  textCorners,
  viewportIsPlan,
  viewportDrawOrder,
  viewportDrawsCache,
  cachedTextPlacement,
  viewportGroupDrawn,
  viewportLists,
  viewportScale,
} from "./geometry.ts";
import { ALL_OBJECTS, type DataViz, MATERIAL, OBJECT_STYLE, type VizStyle, readDataViz, viewportDataViz, vizMatches } from "./dataviz.ts";
import { FONT_LIST, readFontList } from "./fonts.ts";
import { mirrorMarkers, readMarkers } from "./markers.ts";
import { readLayerView } from "./layerView.ts";
import { readDropShadow } from "./shadow.ts";
import { buildLights3d, buildModel3d, buildModelTree, buildSymbolModel3d, isPathGroup, isProfileGroup, isSelectionGroup, objectTriangles, turnStepsGeneration } from "./model3d.ts";
import { readNameTable } from "./names.ts";
import { type AddObject, type Index, ObjectIndex } from "./objectIndex.ts";
import { type FormatDef, RECORD, RECORD_FORMAT, readFormat, readValues, recordFormat } from "./params.ts";
import { readResources } from "./resources.ts";
import { isStory, readStory } from "./stories.ts";
import { HELIODON, readHeliodonSun } from "./sun.ts";
import { Rec, buildTree, joinRecords, splitRecords } from "./records.ts";
import { TAKES_TEXTURE, readTextureParts, textureDict } from "./texmap.ts";
import {
  MM_PER_POINT,
  WORKSHEET,
  WORKSHEET_IMAGE,
  type WorksheetCell,
  readWorksheet,
  readWorksheetContents,
  readWorksheetImage,
} from "./worksheet.ts";
import type {
  Affine,
  Attributes,
  BBox,
  CameraInfo,
  ClassInfo,
  Clip,
  ColorInfo,
  Mesh3D,
  ModelTree,
  SymbolMember,
  ObjectRecord,
  ResourceInfo,
  DocumentInfo,
  DropShadow,
  LayerInfo,
  LayerView,
  Light3D,
  LineType,
  ObjectInfo,
  Pt,
  Shape,
  StyleOverride,
  SymbolInfo,
  SlabInfo,
  HeliodonSun,
  ViewportInfo,
  WallInfo,
  ViewportLayer,
  ViewportView,
  Visibility,
  VwxDocument,
  WorksheetContents,
  RecordField,
  StoryInfo,
  TexturePart,
} from "./types.ts";

export const LAYER_VIS = 0xd8;
/** u16 name index of the story a design layer belongs to (the story's type-76 record), 0 for none */
export const LAYER_STORY = 0xf4;
export const LAYER_SCALE = 0xf8;
export const CLASS_VIS = 0xb6;

// Layer kind (u8: 1 design, 2 sheet, 3 viewport annotations) and the name and
// title strings sit after a block that grew in later versions: by 18 bytes in
// Vectorworks 2025 (VW30) and 16 in 2026 (VW31), 0 before. The shift is found
// per record: the first even offset where the kind byte is valid and the name
// and title strings fit inside the record.
const LAYER_KIND_BASE = 0x23c;
const LAYER_NAME_BASE = 0x292;
const MAX_LAYER_SHIFT = 64;

const layerShiftCache = new WeakMap<Uint8Array, number>();

function layerTailFits(d: Uint8Array, s: number): boolean {
  const kind = d[LAYER_KIND_BASE + s];
  if (kind < 1 || kind > 3) return false;
  const a = LAYER_NAME_BASE + s;
  if (a + 8 > d.length) return false;
  const n = u32(d, a);
  if (n === 0 || n % 2 !== 0 || a + 8 + n > d.length) return false;
  const t = u32(d, a + 4 + n);
  return t % 2 === 0 && a + 8 + n + t <= d.length;
}

function layerShift(d: Uint8Array): number {
  let s = layerShiftCache.get(d);
  if (s === undefined) {
    s = 0;
    for (let k = 0; k <= MAX_LAYER_SHIFT; k += 2) {
      if (layerTailFits(d, k)) {
        s = k;
        break;
      }
    }
    layerShiftCache.set(d, s);
  }
  return s;
}

/** Offset of a layer record's kind byte. */
export function layerKindAt(d: Uint8Array): number {
  return LAYER_KIND_BASE + layerShift(d);
}

/** Offset of a layer record's name string (u32 byte length + UTF-16), followed by its title. */
export function layerNameAt(d: Uint8Array): number {
  return LAYER_NAME_BASE + layerShift(d);
}

/** Design layer elevation (f64, mm) at +0x1fc; 18 bytes later in 2025 and 2026 files, before the kind byte's own shift. */
const LAYER_ELEVATION_BASE = 0x1fc;
const LAYER_ELEVATION_SHIFT = 18;

export function layerElevationAt(d: Uint8Array): number {
  return LAYER_ELEVATION_BASE + (layerShift(d) > 0 ? LAYER_ELEVATION_SHIFT : 0);
}

/**
 * The elevation (mm) of the design layer `r` is, or is on through its groups, which its heights
 * include (FORMAT.md §5); 0 on a sheet layer and in a symbol definition, plug-in object or other
 * frame of its own, whose heights are above that frame. Heights shown and set "above its layer"
 * are the stored ones less this.
 */
export function layerElevationOf(r: Rec): number {
  for (let q: Rec | null = r; q; q = q.parent) {
    if (q.type === LAYER) {
      const z = q.data[layerKindAt(q.data)] === 1 ? f64(q.data, layerElevationAt(q.data)) : 0;
      return Number.isFinite(z) ? z : 0;
    }
    if (q.type === 16 || (q !== r && !childrenMoveWith(q.type))) return 0;
  }
  return 0;
}

/**
 * A sheet layer's page (Page Setup): f64 width, then height, in inches at +0x246, moving with the
 * kind byte. The page is centred on the sheet's origin.
 */
const LAYER_PAGE_BASE = 0x246;
/** inches a page side may span, at most (Vectorworks allows up to 10,000) */
export const MAX_PAGE_INCHES = 10000;

export function layerPageAt(d: Uint8Array): number {
  return LAYER_PAGE_BASE + layerShift(d);
}

function pageOf(d: Uint8Array): { page?: { width: number; height: number } } {
  const at = layerPageAt(d);
  if (at + 16 > d.length) return {};
  const w = f64(d, at);
  const h = f64(d, at + 8);
  const fits = (v: number) => v > 0 && v <= MAX_PAGE_INCHES;
  return fits(w) && fits(h) ? { page: { width: w * 25.4, height: h * 25.4 } } : {};
}

export const VIS_CODE: Record<Visibility, number> = { visible: 0, hidden: -1, grayed: 2 };

function viewOf(d: Uint8Array): { view?: LayerView } {
  const view = readLayerView(d);
  return view ? { view } : {};
}

function visibility(code: number): Visibility {
  return code === -1 ? "hidden" : code === 2 ? "grayed" : "visible";
}

/** Groups (11) and walls (68): their class leaves what is inside them to its own classes (a wall
 *  in a hidden class still draws its components and the doors in it). */
const OPEN_CONTAINERS: ReadonlySet<number> = new Set([11, 68]);

/**
 * Types whose u32 at +0x88 names their material, by the material resource's name index (0 for
 * none): rectangles, arcs, polygons, polylines (a wall's component pieces among them), extrudes,
 * 3D polygons, solids and plug-ins. Lines, text and bodies use the slot for other things.
 */
export const MATERIAL_TYPES: ReadonlySet<number> = new Set([3, 5, 6, 21, 24, 25, 84, 86, 113]);
export const MATERIAL_AT = 0x88;
/** A slab (71): a sloped roof, fascia or ceiling, or a piece of a slab plug-in. */
const SLAB = 71;
/** u32 name index of a slab's style (a type-102 resource), 0 for none */
const SLAB_STYLE_AT = 0x104;
/** material resource */
const MATERIAL_RESOURCE = 19;

/** a design or sheet layer */
const LAYER = 31;
/** a sheet layer's kind byte (layerKindAt) */
const SHEET_KIND = 2;
/** the plug-in (format name of its parameters) Renderworks cameras are */
export const CAMERA_PLUGIN = "RenderWorks Camera";
/** Landmark's plant, whose path shows as its Poly Display says */
const LANDMARK_PLANT = "Plant";

/** The class every document has; geometry in it inside a symbol or plug-in takes the container's class. */
const NONE_CLASS = "None";

/** Attributes.lineStyle for a solid pen. */
const SOLID_PEN = 2;

/** 3D solids: extrudes (24), 3D polygons (25), sweeps (34), multiple extrudes (38), meshes (40),
 *  solid additions and subtractions (84) and generic solids (113). */
const SOLIDS: ReadonlySet<number> = new Set([24, 25, 34, 38, 40, 84, 113]);

const POLY3D = 25;
const LOCUS3D = 9;
const MESH = 40;
const MESH_FACE = 41;
/** a symbol definition, instance and plug-in: what holds its own idea of how it looks in plan */
const SHOWS_ITS_OWN_PLAN: ReadonlySet<number> = new Set([16, 15, 86]);
/** folds sharper than this between a mesh's faces show in Top/Plan: cos 20° */
const MESH_PLAN_CREASE = Math.cos((20 * Math.PI) / 180);

/** A 3D object's plan bounds, placed by m, for picking and moving it where plan draws little or nothing of it. */
function placedBounds(r: Rec, m: Affine): { bounds?: BBox } {
  const b = planBounds(r.data, r.type);
  if (!b) return {};
  const corners = [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ].map((q) => applyAffine(m, q));
  return { bounds: bboxOfPoints(corners) ?? b };
}

/** Part of a 3D solid (an extrude's profile, say), which Top/Plan draws as wireframe. */
function inSolid(r: Rec): boolean {
  for (let p = r.parent; p; p = p.parent) if (SOLIDS.has(p.type)) return true;
  return false;
}

// ---- per-buffer caches ----------------------------------------------------

const recCache = new WeakMap<Uint8Array, Rec>();
const guidCache = new WeakMap<Uint8Array, string>();
const shapeCache = new WeakMap<Uint8Array, Shape | null>();

export function recOf(d: Uint8Array): Rec {
  let r = recCache.get(d);
  if (!r) {
    r = new Rec(d);
    recCache.set(d, r);
  }
  return r;
}

export function guidOf(r: Rec): string {
  let g = guidCache.get(r.data);
  if (g === undefined) {
    g = r.guid;
    guidCache.set(r.data, g);
  }
  return g;
}

const meshPlanCache = new WeakMap<Uint8Array, readonly Pt[] | null>();

/** A mesh as Top/Plan shows it, from above, in pairs of points: its rims, sharp folds and the edges where it turns away. */
function meshPlan(r: Rec): readonly Pt[] | null {
  const cached = meshPlanCache.get(r.data);
  if (cached !== undefined) return cached;
  const d = r.data;
  const n = d.length >= 0xd4 ? u32(d, 0xd0) : 0;
  let lines: Pt[] | null = null;
  if (n > 0 && 0xd4 + 28 * n <= d.length) {
    const at = (i: number): [number, number, number] => {
      const o = 0xd4 + 28 * i;
      return [f64(d, o), f64(d, o + 8), f64(d, o + 16)];
    };
    // points at one place are one point, or a seam in a smooth mesh would read as its rim
    const places = new Map<string, number>();
    const placeOf = (i: number): number => {
      const [x, y, z] = at(i);
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      const known = places.get(key);
      if (known !== undefined) return known;
      places.set(key, i);
      return i;
    };
    const sides = new Map<string, { p: number; q: number; normals: [number, number, number][] }>();
    for (const f of r.children) {
      if (f.type !== MESH_FACE || f.data.length < 0xce) continue;
      const k = u16(f.data, 0xcc);
      if (k < 3 || 0xce + 4 * k > f.data.length) continue;
      const stored: number[] = [];
      for (let i = 0; i < k; i++) stored.push(u32(f.data, 0xce + 4 * i) - 1);
      if (stored.some((c) => c < 0 || c >= n)) continue;
      const corners = stored.map(placeOf);
      // its normal, by Newell's method
      let [nx, ny, nz] = [0, 0, 0];
      for (let i = 0; i < k; i++) {
        const [a, b] = [at(corners[i]), at(corners[(i + 1) % k])];
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const size = Math.hypot(nx, ny, nz) || 1;
      const normal: [number, number, number] = [nx / size, ny / size, nz / size];
      for (let i = 0; i < k; i++) {
        const [p, q] = [corners[i], corners[(i + 1) % k]];
        if (p === q) continue;
        const key = p < q ? `${p},${q}` : `${q},${p}`;
        const side = sides.get(key);
        if (side) side.normals.push(normal);
        else sides.set(key, { p, q, normals: [normal] });
      }
    }
    lines = [];
    for (const { p, q, normals } of sides.values()) {
      if (normals.length === 2) {
        const [a, b] = normals;
        const sharp = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) < MESH_PLAN_CREASE;
        if (!sharp && a[2] * b[2] > 0) continue;
      }
      const [from, to] = [at(p), at(q)];
      lines.push({ x: from[0], y: from[1] }, { x: to[0], y: to[1] });
    }
  }
  meshPlanCache.set(r.data, lines);
  return lines;
}

/** Whether what holds a mesh leaves Top/Plan to show it: not a symbol or plug-in, or a group with a plan drawing of its own. */
function meshShowsInPlan(r: Rec): boolean {
  for (let p = r.parent; p; p = p.parent) {
    if (SHOWS_ITS_OWN_PLAN.has(p.type)) return false;
    if (p.type === 11 && drawsPlan(p)) return false;
  }
  return true;
}

const drawsPlan = (group: Rec): boolean => group.children.some((c) => (c.type === 11 ? drawsPlan(c) : !SOLIDS.has(c.type) && shapeOf(c) !== null));

export function shapeOf(r: Rec): Shape | null {
  let s = shapeCache.get(r.data);
  if (s === undefined) {
    try {
      s = decodeShape(r);
    } catch {
      s = null;
    }
    shapeCache.set(r.data, s);
  }
  return s;
}

/**
 * Shape of a record placed by `m` (symbol contents). Rectangles and arcs that
 * `m` would skew are traced as polygons.
 */
function placedShape(r: Rec, m: Affine, upright = false): Shape | null {
  const s = shapeOf(r);
  if (!s || isIdentity(m)) return s;
  if (s.kind === "text") return upright ? uprightText(placedText(s, m), r, m) : placedText(s, m);
  try {
    const d = transformRecord(r.data, r.type, m);
    if (d) return decodeShape(new Rec(d));
  } catch {
    // unknown layout: fall back to mapping the outline
  }
  return outlineThrough(s, m);
}

/** A shape's outline (an arc sampled) carried through m, as a polygon. */
function outlineThrough(s: Shape, m: Affine): Shape {
  let pts = s.points;
  if (s.kind === "arc" && s.center) {
    const sweep = s.sweepAngle ?? 360;
    pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (((s.startAngle ?? 0) + (sweep * i) / 48) * Math.PI) / 180;
      pts.push({ x: s.center.x + (s.rx ?? 0) * Math.cos(a), y: s.center.y + (s.ry ?? 0) * Math.sin(a) });
    }
  }
  const points = pts.map((p) => applyAffine(m, p));
  return { kind: "polygon", points, closed: s.closed || s.kind === "rect", bbox: bboxOfPoints(points) };
}

/**
 * How an object shows, from `own` (its class's visibility): a plug-in, symbol or viewport it sits in
 * whose class `vis` hides hides it too, and one it grays grays it. Inside one, an object in the None
 * class goes by the container alone.
 */
/**
 * What the containers an object sits in give it: a drop shadow it casts together with the rest of
 * their drawing, and the share of its fill and pen opacity a plug-in's own opacity leaves (a
 * plug-in at 65 % draws its cached drawing at 65 %, as the published sheets show).
 */
interface Held {
  readonly shadow?: DropShadow;
  readonly fill: number;
  readonly pen: number;
}

const HELD_NONE: Held = { fill: 1, pen: 1 };

function hold(info: ObjectInfo, held: Held): void {
  if (held.shadow) info.shadow = held.shadow;
  const a = info.attrs;
  if (a && (held.fill < 1 || held.pen < 1)) {
    info.attrs = { ...a, fillOpacity: a.fillOpacity * held.fill, penOpacity: a.penOpacity * held.pen };
  }
}

export function withContainers(own: Visibility, obj: ObjectInfo, vis: (index: number) => Visibility | undefined): Visibility {
  if (!obj.inClasses) return own;
  return strictest([obj.className === NONE_CLASS ? "visible" : own, ...obj.inClasses.map(vis)]);
}

/** Hidden if any is, else grayed if any is, else visible. */
function strictest(vs: readonly (Visibility | undefined)[]): Visibility {
  return vs.includes("hidden") ? "hidden" : vs.includes("grayed") ? "grayed" : "visible";
}

/**
 * A decoded shape carried through m (a plan viewport's placement, for export). Arcs stay arcs
 * when m turns, scales evenly and keeps their axes upright (or they are circles); otherwise
 * they become polygons.
 */
export function mapShape(s: Shape, m: Affine): Shape {
  if (isIdentity(m)) return s;
  if (s.kind === "text") return placedText(s, m);
  const mapBox = (b: BBox | null) =>
    b && bboxOfPoints([applyAffine(m, { x: b.x0, y: b.y0 }), applyAffine(m, { x: b.x1, y: b.y1 }), applyAffine(m, { x: b.x0, y: b.y1 }), applyAffine(m, { x: b.x1, y: b.y0 })]);
  if (s.kind === "arc" && s.center && s.rx !== undefined) {
    const k = Math.hypot(m.a, m.b);
    const even = m.a * m.d - m.b * m.c > 0 && Math.abs(m.a - m.d) <= 1e-9 * k && Math.abs(m.b + m.c) <= 1e-9 * k;
    const ry = s.ry ?? s.rx;
    if (!even || (Math.abs(m.b) > 1e-9 * k && Math.abs(Math.abs(s.rx) - Math.abs(ry)) > 1e-9 * Math.abs(s.rx))) return outlineThrough(s, m);
    const turn = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    return { ...s, center: applyAffine(m, s.center), rx: s.rx * k, ry: ry * k, startAngle: (s.startAngle ?? 0) + turn, bbox: mapBox(s.bbox) };
  }
  const points = s.points.map((p) => applyAffine(m, p));
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const vertices = s.vertices?.map((v) => ({ ...v, p: applyAffine(m, v.p), radius: v.radius * k }));
  return { ...s, points, ...(vertices ? { vertices } : {}), bbox: points.length ? bboxOfPoints(points) : mapBox(s.bbox) };
}

/**
 * Text placed by `m`: unlike the Scale command, which keeps text sizes, a scaled
 * symbol or a viewport's drawing shows its text scaled with it.
 */
function placedText(s: Shape, m: Affine): Shape {
  const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const b = s.bbox;
  const corners = b
    ? [
        { x: b.x0, y: b.y0 },
        { x: b.x1, y: b.y0 },
        { x: b.x1, y: b.y1 },
        { x: b.x0, y: b.y1 },
      ].map((p) => applyAffine(m, p))
    : [];
  return {
    ...s,
    anchor: s.anchor && applyAffine(m, s.anchor),
    textSize: s.textSize !== undefined ? s.textSize * k : undefined,
    textAngle: (s.textAngle ?? 0) + (Math.atan2(m.b, m.a) * 180) / Math.PI,
    bbox: corners.length ? bboxOfPoints(corners) : s.bbox,
  };
}

/**
 * Text in a plug-in reads the right way up, as Vectorworks draws it: placed turned past 90° (up to
 * 270°), as a tag on a plug-in turned half a turn is, it turns half a turn about its box's centre.
 */
function uprightText(t: Shape, r: Rec, m: Affine): Shape {
  const turn = (((t.textAngle ?? 0) % 360) + 360) % 360;
  if (turn <= 90 + 1e-6 || turn > 270 + 1e-6 || !t.anchor) return t;
  const corners = textCorners(readTextFrame(r.data, t.text ?? "")).map((p) => applyAffine(m, p));
  const c = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
  return { ...t, anchor: { x: 2 * c.x - t.anchor.x, y: 2 * c.y - t.anchor.y }, textAngle: (t.textAngle ?? 0) - 180 };
}

/** The centre of a text's box when, in a plug-in, it would be drawn turned half a turn about it to read the right way up (see uprightText); null otherwise. */
export function upsideDownText(r: Rec): { x: number; y: number } | null {
  const t = r.type === 10 ? shapeOf(r) : null;
  const u = t && uprightText(t, r, IDENTITY);
  if (!t?.anchor || !u?.anchor || u === t) return null;
  return { x: (t.anchor.x + u.anchor.x) / 2, y: (t.anchor.y + u.anchor.y) / 2 };
}

function unionShapeBox(box: BBox | null, s: Shape): BBox | null {
  const b = s.bbox ?? bboxOfPoints(s.points);
  if (!b) return box;
  if (!box) return { ...b };
  return { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) };
}

// ---- worksheet images -------------------------------------------------------

/** A worksheet image's ObjectInfo.worksheet, when its record can be read. */
function worksheetOf(r: Rec): { worksheet?: number } {
  const placed = readWorksheetImage(r.data);
  return placed ? { worksheet: placed.worksheet } : {};
}

/** How a worksheet image's cell fills draw: solid, with no pen. */
const WORKSHEET_FILL: Attributes = {
  lineStyle: 2,
  lineWeight: 0,
  fillPattern: 1,
  fillFore: 0,
  fillBack: 0,
  penFore: 0,
  penBack: 0,
  fillOpacity: 100,
  penOpacity: 0,
};
/** Palette index of black, which cell texts are drawn in (their own colour isn't decoded). */
const BLACK = 255;
const WORKSHEET_TEXT: Attributes = { ...WORKSHEET_FILL, fillPattern: 0, penFore: BLACK, penOpacity: 100 };
/** Space between a cell's edge and its text, points. */
const CELL_PAD = 3;
/** Average character width of the worksheet font in ems, for wrapping text to a cell. */
const CHAR_WIDTH = 0.5;

function mapBox(m: Affine, b: BBox): BBox | null {
  return bboxOfPoints([applyAffine(m, { x: b.x0, y: b.y0 }), applyAffine(m, { x: b.x1, y: b.y1 })]);
}

function rectShape(x0: number, y0: number, x1: number, y1: number, m: Affine): Shape {
  const points = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ].map((p) => applyAffine(m, p));
  return { kind: "rect", points, closed: true, bbox: bboxOfPoints(points) };
}

/** Words of `text` in lines of at most `width` characters (a longer word gets a line to itself). */
function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

/** A cell's text, justified in the cell (x0..x1, y0..y1 on the sheet before `m`) as its format says. */
function worksheetText(cell: WorksheetCell, x0: number, y0: number, x1: number, y1: number, k: number, m: Affine): Shape {
  const size = cell.size * k;
  const pad = CELL_PAD * k;
  const hAlign = cell.align === "center" ? 2 : cell.align === "right" ? 3 : 1;
  const x = hAlign === 2 ? (x0 + x1) / 2 : hAlign === 3 ? x1 - pad : x0 + pad;
  const lines = cell.wrap ? wrapText(cell.text, Math.max(1, (x1 - x0 - 2 * pad) / (CHAR_WIDTH * size))) : undefined;
  const cellBox = rectShape(x0, y0, x1, y1, m).bbox;
  return {
    kind: "text",
    points: [],
    closed: false,
    bbox: cellBox,
    text: cell.text,
    ...(lines ? { lines } : {}),
    anchor: applyAffine(m, { x, y: (y0 + y1) / 2 }),
    textSize: size * Math.hypot(m.a, m.b),
    textAngle: (Math.atan2(m.b, m.a) * 180) / Math.PI,
    hAlign,
    vAlign: 3,
    ...(cell.bold ? { bold: true } : {}),
    ...(cell.italic ? { italic: true } : {}),
  };
}

// ---- viewports --------------------------------------------------------------
//
// A viewport (122) on a sheet layer caches its drawing as groups of ordinary
// objects in the coordinates of its view (design-layer coordinates for a plan,
// the section plane's for a section or elevation, rotation already applied).
// Its annotations and crop are groups too, in sheet coordinates times the
// scale, with no shift; an aux record in each group says which it is
// (geometry.ts onViewportSheet). The record holds:
//   +0x68  f64 x 4  its box on the sheet: top, left, bottom, right (mm)
//   +0x8c  f64 x 4  rotation of the view (cos, -sin, sin, cos at +0x8c/94/a4/ac)
//   +0xd4  f64 x 2  shift: view point p lands on the sheet at (p + shift) / scale
//   +0x2cc f64      scale (48 for 1:48); +0x2de in 2025 files, +0x2e4 in 2026
// so the objects inside are drawn shifted, at 1/scale, and cropped to the box
// (layout constants in geometry.ts). Moving a viewport moves its box and its
// shift, and its annotations and crop by the move times the scale; the drawing
// inside stays in view coordinates.
//
// A plan viewport (identity view matrix) caches only its annotations: the
// drawing itself is its design layers, drawn live. Near the end of the record
// it lists the layers it shows and the classes whose visibility it sets, by
// name index, with the usual visibility codes (geometry.ts viewportLists). The
// plan can be turned: +0x8c holds a 3x3 2D transform, design -> view, in row
// vectors as symbol matrices are.

/** A viewport's box on the sheet. */
function viewportBox(d: Uint8Array): BBox | null {
  if (d.length < VIEWPORT_BOX + 32) return null;
  const [top, left, bottom, right] = [0, 8, 16, 24].map((k) => f64(d, VIEWPORT_BOX + k));
  if (![top, left, bottom, right].every(Number.isFinite)) return null;
  return { x0: Math.min(left, right), y0: Math.min(top, bottom), x1: Math.max(left, right), y1: Math.max(top, bottom) };
}

/** How a viewport places its drawing (m) and its annotations and crop (sheet), and its box. */
function viewportPlacement(r: Rec): { m: Affine; sheet: Affine; clip: BBox } | null {
  const d = r.data;
  const scale = viewportScale(d);
  const clip = viewportBox(d);
  if (scale === null || !clip || d.length < VIEWPORT_SHIFT + 16) return null;
  const sx = f64(d, VIEWPORT_SHIFT);
  const sy = f64(d, VIEWPORT_SHIFT + 8);
  return {
    m: { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: Number.isFinite(sx) ? sx / scale : 0, f: Number.isFinite(sy) ? sy / scale : 0 },
    sheet: { a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: 0, f: 0 },
    clip,
  };
}

/**
 * What a viewport's drawing is cropped to: its box, narrowed to the outline of its crop object
 * (placed on the sheet by `sheet`) when it has one.
 */
function viewportCrop(r: Rec, sheet: Affine, box: BBox): Clip {
  for (const g of objectChildren(r)) {
    if (!isViewportCrop(g)) continue;
    for (const c of objectChildren(g)) {
      const outline = placedShape(c, sheet)?.points ?? [];
      const b = outline.length >= 3 ? bboxOfPoints(outline) : null;
      if (!b) continue;
      return { x0: Math.max(box.x0, b.x0), y0: Math.max(box.y0, b.y0), x1: Math.min(box.x1, b.x1), y1: Math.min(box.y1, b.y1), outline };
    }
  }
  return box;
}

/**
 * A plan viewport's rotation, design -> view coordinates (identity when unreadable). Row vectors,
 * as symbol matrices: x' = x·m00 + y·m10 + m20.
 */
export function viewportRotation(d: Uint8Array): Affine {
  if (VIEWPORT_ROTATION + 72 > d.length) return IDENTITY;
  const at = (row: number, col: number) => f64(d, VIEWPORT_ROTATION + 24 * row + 8 * col);
  const m = { a: at(0, 0), b: at(0, 1), c: at(1, 0), d: at(1, 1), e: at(2, 0), f: at(2, 1) };
  const ok = Object.values(m).every(Number.isFinite) && Math.abs(m.a * m.d - m.b * m.c - 1) < 1e-6;
  return ok ? m : IDENTITY;
}

// ---- design-layer viewports -------------------------------------------------
//
// A design-layer viewport (DLVP) is a plug-in object (86) whose parameters are
// of the format "NNA_DesignLayerViewport": it shows layers on a design layer,
// placed by its matrix (+0xf0, as any plug-in places its drawing, z included).
// The layers are another file's, copied into this one as hidden layers of kind
// 3 named "NNA#<n>_<layer>", or this file's own. After its aux records it holds
// one type-29 record per layer it shows, which names the layer at +0xec (u32
// name index). Its aux record tagged "TVLD" lists the layers and classes it
// sets: u16 layer and class counts at +0x5a and +0x5c, then from +0x72 one
// 8-byte entry each as a plan viewport's list has them (u32 name index, i16
// visibility, u16 flags).

/** a design-layer viewport's entry for one layer it shows */
const DLVP_LAYER = 29;
/** u32 name index of the layer, in a DLVP_LAYER record */
const DLVP_LAYER_NAME = 0xec;
/** the aux record listing a design-layer viewport's layers and classes, by its tag at +0x50 */
const DLVP_LIST_TAG = "TVLD";
const DLVP_LIST_LAYERS = 0x5a;
const DLVP_LIST_CLASSES = 0x5c;
const DLVP_LIST_ENTRIES = 0x72;
/** design-layer viewports showing layers that hold more of them, at most */
const MAX_DLVP_DEPTH = 4;
const AUX = 76;
const GROUP = 11;

/** Whether `r` is a design-layer viewport: a plug-in object holding layer entries. */
export function isDesignLayerViewport(r: Rec): boolean {
  return r.type === PLUGIN && r.children.some((c) => c.type === DLVP_LAYER);
}

/** The name indexes of the layers a design-layer viewport has entries for. */
function dlvpLayerNames(r: Rec): number[] {
  return r.children.filter((c) => c.type === DLVP_LAYER && c.data.length >= DLVP_LAYER_NAME + 4).map((c) => u32(c.data, DLVP_LAYER_NAME));
}

/** A design-layer viewport's layer and class list, by name index (raw visibility codes); empty when it has none. */
function dlvpList(r: Rec): { layers: Map<number, number>; classes: Map<number, number> } {
  const out = { layers: new Map<number, number>(), classes: new Map<number, number>() };
  const d = r.children.find((c) => c.type === AUX && readAscii(c.data, 0x50, 0x54) === DLVP_LIST_TAG)?.data;
  if (!d || d.length < DLVP_LIST_ENTRIES) return out;
  const layers = u16(d, DLVP_LIST_LAYERS);
  const classes = u16(d, DLVP_LIST_CLASSES);
  if (DLVP_LIST_ENTRIES + (layers + classes) * VIEWPORT_ENTRY_SIZE !== d.length) return out;
  for (let i = 0; i < layers + classes; i++) {
    const o = DLVP_LIST_ENTRIES + i * VIEWPORT_ENTRY_SIZE;
    (i < layers ? out.layers : out.classes).set(u32(d, o + VIEWPORT_ENTRY_NAME), i16(d, o + VIEWPORT_ENTRY_VISIBILITY));
  }
  return out;
}

function unionBox(a: BBox, b: BBox): BBox {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** What two viewports, one inside the other, make of a layer they both show. */
function bothShow(a: Visibility, b: Visibility): Visibility {
  return a === "hidden" || b === "hidden" ? "hidden" : a === "grayed" || b === "grayed" ? "grayed" : "visible";
}

// ---- tree helpers -----------------------------------------------------------

/** Number of leading children that are attached data rather than objects.
 *  A child list is: aux records (the last one has next=0), then objects (all
 *  next != 0), then a terminator (type 0, next=0) for containers. */
export function auxCount(parent: Rec): number {
  const ch = parent.children;
  for (let i = 0; i < ch.length; i++) {
    if (!ch[i].hasNext) return ch[i].type === 0 ? 0 : i + 1;
  }
  return 0;
}

/** Types that are drawn or hold drawn children. Symbol definitions and
 *  plug-in objects keep some of their geometry (groups) in the aux part of
 *  their child list, so these count as objects wherever they appear. */
const DRAWN = new Set([2, 3, 5, 6, 10, 11, 14, 15, 21, 86]);

/** Child objects of a record (no aux data, no terminator). */
export function objectChildren(parent: Rec): Rec[] {
  const k = auxCount(parent);
  return parent.children.filter((c, i) => c.type !== 0 && (i >= k || DRAWN.has(c.type)));
}

/** The record and its object descendants (skipping aux data and terminators). */
export function* objectWalk(rec: Rec): Generator<Rec> {
  yield rec;
  for (const c of objectChildren(rec)) yield* objectWalk(c);
}

/** Stream index of the last record in `rec`'s subtree. */
export function subtreeEnd(rec: Rec): number {
  let r = rec;
  while (r.children.length) r = r.children[r.children.length - 1];
  return r.index;
}

export function readStr(d: Uint8Array, off: number): [string, number] {
  const n = u32(d, off);
  return [readUtf16(d, off + 4, n), off + 4 + n];
}

/** How far a plug-in object is turned, degrees. */
function turnOf(r: Rec): number {
  const own = r.type === PLUGIN ? readPluginMatrix(r.data) : readInstanceMatrix(r.data);
  return (Math.atan2(own.b, own.a) * 180) / Math.PI;
}

/** Where a symbol instance's or plug-in object's insertion point lies, its matrix's offset placed by `m`. */
function insertionOf(r: Rec, m: Affine): Pt {
  const own = r.type === PLUGIN ? readPluginMatrix(r.data) : readInstanceMatrix(r.data);
  return applyAffine(m, { x: own.e, y: own.f });
}

function kindOf(type: number, shape: Shape | null): ObjectInfo["kind"] {
  // a 3D polygon's plan outline isn't a 2D polygon to edit as one
  if (shape && !SOLIDS.has(type)) return shape.kind;
  if (type === 11) return "group";
  if (type === 15) return "symbol";
  return "other";
}

export class Model implements VwxDocument {
  /** the file header (settings block included): replaced, never changed in place, by patchHeader */
  header: Uint8Array;
  readonly fileName: string;
  private meta: Omit<DocumentInfo, "records" | "fileName">;
  datas: Uint8Array[];
  recs: Rec[] = [];
  roots: Rec[] = [];
  layerRecs: Rec[] = [];
  names = new Map<number, string>();
  private lineTypeList: LineType[] | null = null;
  private resourceList: ResourceInfo[] | null = null;
  /** the symbol definition open for editing (openSymbol), indexed as a layer */
  private openDef: number | null = null;
  /** the viewport whose annotations are open for editing (openAnnotations); its annotation group is indexed as a layer */
  private openAnno: string | null = null;
  /** data visualisations by GUID, read when a viewport first needs them */
  private vizs: Map<string, DataViz> | null = null;
  /** name indexes of the material resources (type 19), read when a visualisation first needs them */
  private materials: Set<number> | null = null;
  /** the name indexes of the drawing's wall styles */
  private wallStyles: Set<number> | null = null;
  private meshes: Mesh3D[] | null = null;
  /** the 3D conversion resolution the meshes were built at (turnStepsGeneration) */
  private meshesAt = 0;
  private lights: Light3D[] | null = null;
  nameTable: Rec | null = null;
  classList: Rec | null = null;
  classRecs = new Map<number, Rec>();
  symbols = new Map<number, Rec>();
  /** worksheets (type 18) by name index */
  worksheets = new Map<number, Rec>();
  private palette: string[] = [];
  private colorTable: string[] = [];
  private colorNames: string[] = [];
  private idx: Index | null = null;
  /** builds idx, keeping what an edit left alone */
  private readonly objectIndex = new ObjectIndex();
  /** plan viewports by sheet layer id, design-layer viewports by design layer id, read when first drawn */
  private planViews = new Map<string, ViewportView[]>();
  /** the design-layer viewports on each layer (dlvpsOn), found when first asked for */
  private dlvps: Map<Rec, Rec[]> | null = null;
  /** how data visualisations redraw the other viewports' cached drawings, by sheet layer id */
  private cachedViewStyles = new Map<string, ReadonlyMap<string, StyleOverride> | null>();
  /** whether a plug-in or symbol definition has 2D geometry (hasPlanGeometry), by its data */
  private planParts = new WeakMap<Uint8Array, boolean>();
  /** plug-ins that draw in plan besides their selection group (notInPlan) */
  private planBesides = new WeakMap<Uint8Array, boolean>();
  /** record formats by name index, read when first asked for */
  private formatDefs: Map<number, FormatDef> | null = null;
  /** the font list's names, read when first asked for */
  private fontNames: string[] | null = null;

  /** A drawing from its file's bytes, or from its container already read (readContainerStream). */
  constructor(file: Uint8Array | OpenedContainer, fileName: string) {
    const c = file instanceof Uint8Array ? readContainer(file) : file;
    this.header = c.header;
    this.fileName = fileName;
    this.meta = { createdWith: c.createdWith, savedWith: c.savedWith, build: c.build, units: c.units };
    if ("raw" in c) {
      const recs = splitRecords(c.raw);
      for (const r of recs) recCache.set(r.data, r);
      this.datas = recs.map((r) => r.data);
    } else {
      this.datas = c.records;
    }
    this.rebuild();
  }

  /** Re-derive the tree and indices after `datas` changed. */
  rebuild(): void {
    this.recs = this.datas.map(recOf);
    this.roots = buildTree(this.recs);
    this.layerRecs = this.roots.filter((r) => r.type === LAYER);
    this.nameTable = this.roots.find((r) => r.type === 55) ?? null;
    this.names = this.nameTable ? readNameTable(this.nameTable) : new Map();
    this.classList = this.roots.find((r) => r.type === 57) ?? null;
    this.classRecs = new Map();
    for (const c of this.classList?.children ?? []) {
      if (c.type === 94) this.classRecs.set(c.nameIndex, c);
    }
    this.symbols = new Map();
    this.worksheets = new Map();
    for (const r of this.recs) {
      if (r.type === 16) this.symbols.set(r.nameIndex, r);
      else if (r.type === WORKSHEET) this.worksheets.set(r.nameIndex, r);
    }
    this.palette = readPalette(this.roots.find((r) => r.type === 80));
    this.colorTable = readColorTable(this.roots);
    this.colorNames = readColorNames(this.roots);
    this.lineTypeList = null;
    this.resourceList = null;
    this.vizs = null;
    this.materials = null;
    this.wallStyles = null;
    this.meshes = null;
    this.lights = null;
    this.idx = null;
    this.planViews.clear();
    this.dlvps = null;
    this.cachedViewStyles.clear();
    this.planParts = new WeakMap();
    this.planBesides = new WeakMap();
    this.formatDefs = null;
    this.fontNames = null;
  }

  // ---- VwxDocument --------------------------------------------------------

  get info(): DocumentInfo {
    return { fileName: this.fileName, records: this.datas.length, ...this.meta };
  }

  layers(): LayerInfo[] {
    const idx = this.index();
    return this.layerRecs.map((r) => {
      const id = guidOf(r);
      const [name, off] = readStr(r.data, layerNameAt(r.data));
      const [title] = readStr(r.data, off);
      const design = r.data[layerKindAt(r.data)] !== 2;
      return {
        id,
        name,
        title,
        kind: design ? "design" : "sheet",
        scale: f64(r.data, LAYER_SCALE),
        visibility: visibility(i16(r.data, LAYER_VIS)),
        objectCount: idx.byLayer.get(id)?.length ?? 0,
        ...(design ? { elevation: f64(r.data, layerElevationAt(r.data)), story: u16(r.data, LAYER_STORY) } : {}),
        ...(design ? viewOf(r.data) : pageOf(r.data)),
      };
    });
  }

  classes(): ClassInfo[] {
    const idx = this.index();
    return [...this.classRecs.values()].map((r) => ({
      index: r.nameIndex,
      name: this.names.get(r.nameIndex) ?? `#${r.nameIndex}`,
      visibility: visibility(i16(r.data, CLASS_VIS)),
      objectCount: idx.classCounts.get(r.nameIndex) ?? 0,
      attrs: readClassAttrs(r.data),
      texture: r.data.length >= CLASS_TEXTURE + 4 ? Math.max(0, i32(r.data, CLASS_TEXTURE)) : 0,
      textStyle: r.data.length >= CLASS_TEXT_STYLE + 4 ? Math.max(0, i32(r.data, CLASS_TEXT_STYLE)) : 0,
    }));
  }

  objects(layerId: string): ObjectInfo[] {
    return this.index().byLayer.get(layerId) ?? [];
  }

  object(id: string): ObjectInfo | null {
    return this.index().objects.get(id) ?? null;
  }

  color(index: number): string {
    return colorOf(this.colorTable, this.palette, index);
  }

  colors(): ColorInfo[] {
    return this.colorTable.map((css, index) => ({ index, css, name: this.colorNames[index] ?? "" }));
  }

  fonts(): string[] {
    this.fontNames ??= ((r) => (r ? readFontList(r.data) : []))(this.roots.find((r) => r.type === FONT_LIST));
    return this.fontNames;
  }

  lineTypes(): LineType[] {
    // they sit beside the classes (under the type-57 list) in the sample; search everywhere
    this.lineTypeList ??= readLineTypes(this.recs, this.names);
    return this.lineTypeList.map((t) => ({ ...t, dashes: [...t.dashes] }));
  }

  toBytes(): Uint8Array {
    if (this.holdsParts()) throw new Error("this drawing is too large to write out at once: parts of it are still in its file");
    return writeContainer(this.header, joinRecords(this.recs));
  }

  holdsParts(): boolean {
    return anyHeld(this.datas);
  }

  write(sink: VwxSink, options?: WriteOptions): Promise<Written> {
    return writeVwx(this.header, this.recs.map((r) => r.data), sink, options);
  }

  /** Sets header bytes [at, at + bytes.length) to `bytes` and re-reads the units; returns what they were. */
  patchHeader(at: number, bytes: Uint8Array): Uint8Array {
    if (at < 0 || at + bytes.length > this.header.length) throw new Error("header patch out of range");
    const before = this.header.slice(at, at + bytes.length);
    const h = this.header.slice();
    h.set(bytes, at);
    this.header = h;
    this.meta = { ...this.meta, units: findUnits(h) };
    return before;
  }

  // ---- lookups for the editor ---------------------------------------------

  /** Record behind an object or layer id (not symbol-expanded geometry). */
  rec(id: string): Rec | null {
    return this.index().recs.get(id) ?? null;
  }

  layerRec(id: string): Rec | null {
    return this.layerRecs.find((r) => guidOf(r) === id) ?? null;
  }

  openSymbol(index: number | null): string | null {
    const def = index === null ? undefined : this.symbols.get(index);
    const next = def ? index : null;
    if (next !== this.openDef) {
      this.openDef = next;
      this.idx = null;
    }
    return def ? guidOf(def) : null;
  }

  /** The open symbol definition (openSymbol) when `id` is its id. */
  openSymbolRec(id: string): Rec | null {
    const def = this.openDef === null ? undefined : this.symbols.get(this.openDef);
    return def && guidOf(def) === id ? def : null;
  }

  openAnnotations(viewportId: string | null): string | null {
    const group = viewportId === null ? null : this.annotationsOf(viewportId);
    const next = group ? viewportId : null;
    if (next !== this.openAnno) {
      this.openAnno = next;
      this.idx = null;
    }
    return group ? guidOf(group) : null;
  }

  /** The open viewport annotations (openAnnotations) when `id` is their group's id. */
  openAnnotationsRec(id: string): Rec | null {
    const group = this.openAnno === null ? null : this.annotationsOf(this.openAnno);
    return group && guidOf(group) === id ? group : null;
  }

  /** The annotation group of sheet viewport `viewportId`, found among the records (the index may hold it as a layer). */
  private annotationsOf(viewportId: string): Rec | null {
    const vp = this.recs.find((r) => r.type === VIEWPORT && guidOf(r) === viewportId);
    return (vp && viewportScale(vp.data) !== null && vp.children.find((g) => g.type === 11 && isViewportAnnotations(g))) || null;
  }

  className(index: number): string {
    return this.names.get(index) ?? "";
  }

  classIndexByName(name: string): number | null {
    for (const [i, r] of this.classRecs) if (this.names.get(r.nameIndex) === name) return i;
    return null;
  }

  layerName(r: Rec): string {
    return readStr(r.data, layerNameAt(r.data))[0];
  }

  // ---- object index ---------------------------------------------------------

  private index(): Index {
    if (this.idx) return this.idx;
    // an open symbol definition is indexed as one more layer; its objects don't count towards classes
    const open = this.openDef === null ? undefined : this.symbols.get(this.openDef);
    const layers = this.layerRecs.map((rec) => ({ rec, id: guidOf(rec), counted: true }));
    if (open) layers.push({ rec: open, id: guidOf(open), counted: false });
    // so are a viewport's open annotations, in their own coordinates (sheet × scale), and left out of their sheet
    const notes = this.openAnno === null ? null : this.annotationsOf(this.openAnno);
    if (notes) layers.push({ rec: notes, id: guidOf(notes), counted: true });
    const visitor = (layer: Rec, layerId: string, add: AddObject) => {
      // m places the objects (viewport contents are drawn at the viewport's scale), clip crops them;
      // a viewport's annotations and crop take `sheet` instead, as they sit on the sheet without its
      // shift, and are cropped to its box only, where its drawing is cropped to its crop object
      // `outer` lists the classes of the containers on the way down that hide what they hold (one in None
      // inside another goes by that one); `upright` is set inside plug-ins, `plan` inside one that has a
      // 2D part, which leaves out its 3D solids; `held` is what the containers on the way down give
      // their drawing (see Held)
      const visit = (
        parent: Rec,
        parentId: string | null,
        inView: Affine,
        crop: Clip | undefined,
        sheet: { m: Affine; clip: Clip } | undefined,
        outer: readonly number[],
        upright: boolean,
        plan: boolean,
        held: Held,
        only?: Rec,
      ) => {
        const kids = only ? [only] : parent.type === VIEWPORT ? viewportDrawOrder(objectChildren(parent)) : objectChildren(parent);
        for (const c of kids) {
          // a design-layer viewport's layer entries are data; what it shows is drawn as a viewport (viewports)
          if (c.type === DLVP_LAYER || c === notes) continue;
          if (this.notInPlan(parent, c)) continue;
          if (plan && !this.isPlanPart(c)) continue;
          const onSheet = sheet && onViewportSheet(c);
          const cached = cachedTextPlacement(c);
          const m = onSheet ? sheet.m : cached ? composeAffine(inView, cached) : inView;
          const clip = onSheet ? sheet.clip : crop;
          const k = Math.hypot(m.a, m.b);
          const id = guidOf(c);
          // a plug-in's light objects are its 3D part (a Heliodon's sun): only its own drawing shows in plan
          const shape = upright && c.type === LIGHT ? null : isIdentity(m) ? shapeOf(c) : placedShape(c, m, upright);
          const info = this.info_(c, id, layerId, parentId, shape, m);
          if (c.type === MESH && isIdentity(m) && meshShowsInPlan(c)) {
            const planLines = meshPlan(c);
            if (planLines?.length) info.planLines = planLines;
          }
          if (clip) info.clip = clip;
          if (k !== 1) info.patternScale = k;
          if (outer.length > 0) info.inClasses = outer;
          hold(info, held);
          // a plug-in's opacity fades its whole drawing, which casts its shadow; a group's shadow is cast by its parts
          const fade = c.type === PLUGIN && info.attrs ? { fill: info.attrs.fillOpacity / 100, pen: info.attrs.penOpacity / 100 } : held;
          const gives: Held = { shadow: info.shadow, fill: fade.fill, pen: fade.pen };
          const follows = OPEN_CONTAINERS.has(c.type) || (outer.length > 0 && this.names.get(c.classIndex) === NONE_CLASS);
          const inner = follows ? outer : [...outer, c.classIndex];
          add(info, c);
          if (c.type === 15 || c.type === WORKSHEET_IMAGE) {
            const parts = c.type === 15 ? this.expandSymbol(c, id, layerId, m) : this.expandWorksheet(c, id, layerId, m);
            for (const s of parts) {
              if (clip && !s.clip) s.clip = clip;
              if (k !== 1) s.patternScale = k;
              s.inClasses = inner;
              hold(s, gives);
              add(s, null);
            }
          } else if (c.type === VIEWPORT) {
            const vp = viewportPlacement(c);
            const onIt = vp && composeAffine(m, vp.sheet);
            if (vp && onIt) visit(c, id, composeAffine(m, vp.m), viewportCrop(c, onIt, vp.clip), { m: onIt, clip: vp.clip }, inner, upright, plan, held);
            else visit(c, id, m, clip, undefined, inner, upright, plan, held);
          } else if (c.type === PLUGIN) {
            // a plug-in object's drawing is in its own coordinates, placed by its matrix
            visit(c, id, composeAffine(m, readPluginMatrix(c.data)), clip, undefined, inner, true, plan || this.hasPlanGeometry(c), gives);
          } else if (OWN_FRAME.has(c.type)) {
            // an extrude's profile and a solid's operands are in its own frame
            const f = planFrame(c.data, c.type);
            visit(c, id, f ? composeAffine(m, f) : m, clip, undefined, inner, upright, plan, gives);
          } else if (parent.type !== VIEWPORT || viewportGroupDrawn(c)) {
            visit(c, id, m, clip, undefined, inner, upright, plan, gives);
          }
        }
      };
      return (top: Rec) => visit(layer, null, IDENTITY, undefined, undefined, [], false, false, HELD_NONE, top);
    };
    const context = turnStepsGeneration();
    this.idx = this.objectIndex.update({ recs: this.recs, header: this.header, context, layers, kids: objectChildren, visitor });
    return this.idx;
  }

  /** Attributes as drawn: the groups its BY_CLASS flags name come from its class. */
  attrsOf(r: Rec): Attributes | null {
    const a = readAttrs(r.data);
    return a && resolveAttrs(a, u16(r.data, BY_CLASS), this.classRecs.get(r.classIndex)?.data);
  }

  private info_(r: Rec, id: string, layerId: string, parentId: string | null, shape: Shape | null, m: Affine): ObjectInfo {
    const map = r.children.find((c) => c.type === FILL_MAPPING);
    const fill = map && readFillMapping(map.data);
    const marks = readMarkers(r);
    const shadow = readDropShadow(r);
    return {
      id,
      type: r.type,
      typeName: r.typeName,
      kind: kindOf(r.type, shape),
      layerId,
      parentId,
      classIndex: r.classIndex,
      className: this.names.get(r.classIndex) ?? "",
      ...(r.nameIndex && this.names.get(r.nameIndex) ? { name: this.names.get(r.nameIndex) } : {}),
      shape,
      attrs: this.attrsOf(r),
      ...(r.data.length >= ATTR_END ? { byClass: byClassGroups(u16(r.data, BY_CLASS)) } : {}),
      ...(r.type === 15 ? { symbol: u16(r.data, 0x8e) } : {}),
      ...(r.type === 15 || r.type === PLUGIN ? { insertion: insertionOf(r, m) } : {}),
      ...(r.type === 15 || r.type === PLUGIN ? { turned: turnOf(r) } : {}),
      ...(r.type === WORKSHEET_IMAGE ? worksheetOf(r) : {}),
      ...(inSolid(r) || r.type === POLY3D || r.type === LOCUS3D ? { wireframe: true } : {}),
      ...(MOVABLE_3D.has(r.type) ? placedBounds(r, m) : {}),
      // a viewport covers its box, whatever annotations it holds
      ...(r.type === VIEWPORT && viewportBox(r.data) ? { bounds: viewportBox(r.data)! } : {}),
      ...(fill ? { fillMap: { origin: applyAffine(m, fill.points[0]), u: applyAffine(m, fill.points[1]), v: applyAffine(m, fill.points[2]), shape: fill.shape } } : {}),
      // a mirroring placement (a flipped symbol) turns slashes the other way
      ...(marks ? { markers: m.a * m.d - m.b * m.c < 0 ? mirrorMarkers(marks) : marks } : {}),
      ...(shadow ? { shadow } : {}),
    };
  }

  /** Drawables of a symbol definition placed by the instance's matrix.
   *  Ids are "<instance id>/<n>" and read-only. */
  private expandSymbol(inst: Rec, instId: string, layerId: string, outer: Affine = IDENTITY): ObjectInfo[] {
    const sym = this.symbols.get(u16(inst.data, 0x8e));
    if (!sym) return [];
    return this.symbolDrawables(sym, composeAffine(outer, readInstancePlacement(inst.data)), 0).map(({ rec, shape, m }, n) =>
      this.info_(rec, `${instId}/${n}`, layerId, instId, shape, m),
    );
  }

  /**
   * A worksheet image (type 56) as the cells it shows: a filled rectangle per filled cell and a
   * text per cell with a value, cropped to the image's bounds. Ids are "<image id>/<n>" and
   * read-only.
   */
  private expandWorksheet(img: Rec, imgId: string, layerId: string, m: Affine): ObjectInfo[] {
    const placed = readWorksheetImage(img.data);
    const sheet = placed && this.worksheets.get(placed.worksheet);
    const grid = sheet && readWorksheet(sheet, this.names, this.meta.units);
    if (!placed || !grid) return [];
    const k = MM_PER_POINT * placed.scale;
    const xs = [placed.box.x0];
    for (const w of grid.colWidths) xs.push(xs[xs.length - 1] + w * k);
    const ys = [placed.box.y1];
    for (const h of grid.rowHeights) ys.push(ys[ys.length - 1] - h * k);
    const clip = mapBox(m, placed.bounds);
    const out: ObjectInfo[] = [];
    const add = (shape: Shape, attrs: Attributes) =>
      out.push({ ...this.info_(img, `${imgId}/${out.length}`, layerId, imgId, shape, m), kind: shape.kind, attrs, ...(clip ? { clip } : {}) });
    for (const cell of grid.cells) {
      const x0 = xs[cell.col];
      const x1 = xs[Math.min(cell.col + cell.colSpan, grid.colWidths.length)];
      const y1 = ys[cell.row];
      const y0 = ys[Math.min(cell.row + cell.rowSpan, grid.rowHeights.length)];
      if (cell.fill !== null) {
        const rect = rectShape(x0, y0, x1, y1, m);
        add(rect, { ...WORKSHEET_FILL, fillFore: cell.fill, fillBack: cell.fill });
      }
      if (cell.text) {
        const text = worksheetText(cell, x0, y0, x1, y1, k, m);
        add(text, WORKSHEET_TEXT);
      }
    }
    return out;
  }

  /** Drawables of definition `sym` under `m`, nested instances expanded. */
  private symbolDrawables(sym: Rec, m: Affine, depth: number): Array<{ rec: Rec; shape: Shape; m: Affine }> {
    const found: Array<{ rec: Rec; shape: Shape; m: Affine }> = [];
    if (depth > 8) return found;
    const collect = (parent: Rec, m: Affine, plan: boolean) => {
      for (const c of objectChildren(parent)) {
        if (this.notInPlan(parent, c)) continue;
        if (plan && !this.isPlanPart(c)) continue;
        // a symbol's light objects are part of its 3D model (a light fixture's): Edit Symbol shows them
        if (c.type === LIGHT) continue;
        if (c.type === 15) {
          const inner = this.symbols.get(u16(c.data, 0x8e));
          if (inner) {
            for (const s of this.symbolDrawables(inner, composeAffine(m, readInstancePlacement(c.data)), depth + 1)) {
              found.push({ rec: c, shape: s.shape, m: s.m });
            }
          }
          continue;
        }
        const s = placedShape(c, m);
        if (s) found.push({ rec: c, shape: s, m });
        if (c.type === PLUGIN) collect(c, composeAffine(m, readPluginMatrix(c.data)), plan || this.hasPlanGeometry(c));
        else if (OWN_FRAME.has(c.type)) collect(c, composeAffine(m, planFrame(c.data, c.type) ?? IDENTITY), plan);
        else collect(c, m, plan);
      }
    };
    collect(sym, m, this.hasPlanGeometry(sym));
    return found;
  }

  /**
   * Whether a plug-in or symbol definition has 2D geometry besides its 3D parts. Top/Plan shows only
   * that part of one that has it (a cabinet's footprint, not the profiles of the panels its 3D model
   * is built from, nor a door's 3D hardware symbols).
   */
  private hasPlanGeometry(r: Rec): boolean {
    let has = this.planParts.get(r.data);
    if (has === undefined) {
      // a symbol that holds an instance of itself counts as 3D while it is being looked at
      this.planParts.set(r.data, false);
      // a plug-in's profile group isn't drawn, so 2D in it doesn't count
      has = objectChildren(r).some((c) => !(r.type === PLUGIN && isProfileGroup(c)) && this.isPlanPart(c) && (c.type === 15 || shapeOf(c) !== null || this.hasPlanGeometry(c)));
      this.planParts.set(r.data, has);
    }
    return has;
  }

  /**
   * Whether `c`, a child of `parent`, is a plug-in's group plan leaves out: its profile group, its
   * selection group when it draws something else in plan (a wall feature draws only that), or a
   * Landmark plant's path (the line its plants are spread along) unless its Poly Display shows it.
   */
  private notInPlan(parent: Rec, c: Rec): boolean {
    if (parent.type !== PLUGIN) return false;
    if (isProfileGroup(c)) return true;
    if (isPathGroup(c) && this.pluginName(parent) === LANDMARK_PLANT) {
      const shown = this.recordsOf(parent).find((r) => r.parametric)?.fields.find((f) => f.name === "poly display")?.value;
      return shown === undefined || shown === "None";
    }
    if (!isSelectionGroup(c)) return false;
    let besides = this.planBesides.get(parent.data);
    if (besides === undefined) {
      besides = objectChildren(parent).some((k) => !isProfileGroup(k) && !isSelectionGroup(k) && this.isPlanPart(k) && (k.type === 15 || shapeOf(k) !== null || this.hasPlanGeometry(k)));
      this.planBesides.set(parent.data, besides);
    }
    return besides;
  }

  /**
   * False for a 3D part of a plug-in or symbol: a solid, a light object, an instance of a symbol that is all 3D,
   * or a 2D object of its 3D model on a vertical plane (standsUp).
   */
  private isPlanPart(c: Rec): boolean {
    if (SOLIDS.has(c.type) || c.type === LIGHT) return false;
    const model = c.parent && c.type !== 15 && c.type !== PLUGIN ? modelGroupPlan(c.parent.data) : null;
    const s = model && shapeOf(c);
    if (s && standsUp(s, model)) return false;
    const def = c.type === 15 ? this.symbols.get(u16(c.data, 0x8e)) : undefined;
    return !def || this.hasPlanGeometry(def);
  }

  // ---- symbol definitions (resources) ---------------------------------------

  symbolDefs(): SymbolInfo[] {
    const out: SymbolInfo[] = [];
    for (const [index, r] of this.symbols) {
      let bbox: BBox | null = null;
      for (const { shape } of this.symbolDrawables(r, IDENTITY, 0)) bbox = unionShapeBox(bbox, shape);
      const folder = r.parent?.type === 92 ? (this.names.get(r.parent.nameIndex) ?? "") : "";
      const folders: string[] = [];
      for (let p = r.parent; p?.type === 92; p = p.parent) folders.unshift(this.names.get(p.nameIndex) ?? "");
      out.push({ index, name: this.names.get(index) ?? `Symbol ${index}`, folder, folders, bbox });
    }
    return out.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  }

  symbolShapes(index: number): Shape[] {
    const r = this.symbols.get(index);
    return r ? this.symbolDrawables(r, IDENTITY, 0).map((f) => f.shape) : [];
  }

  viewports(layerId: string): ViewportView[] {
    const cached = this.planViews.get(layerId);
    if (cached) return cached;
    const layer = this.layerRec(layerId);
    const out = !layer ? [] : layer.data[layerKindAt(layer.data)] === SHEET_KIND ? this.sheetViews(layer) : this.designViews(layer);
    this.planViews.set(layerId, out);
    return out;
  }

  /** A sheet's plan viewports. */
  private sheetViews(sheet: Rec): ViewportView[] {
    const out: ViewportView[] = [];
    const order = new Map(this.layerRecs.map((r, i) => [r.nameIndex, i] as const));
    for (const r of objectWalk(sheet)) {
      if (r.type !== VIEWPORT || !viewportIsPlan(r.data)) continue;
      // a Hidden Line viewport prints its cached line work, drawn as one of its groups
      if (viewportDrawsCache(r)) continue;
      const place = viewportPlacement(r);
      const lists = viewportLists(r.data);
      const scale = viewportScale(r.data);
      if (!place || !lists || scale === null) continue;
      const shown = lists.layers.filter((e) => order.has(e.name));
      if (shown.length === 0) continue;
      shown.sort((x, y) => order.get(x.name)! - order.get(y.name)!);
      const classes = new Map(lists.classes.map((e) => [e.name, visibility(e.visibility)]));
      const layers = shown.flatMap((e) => this.viewportLayers(this.layerRecs[order.get(e.name)!], visibility(e.visibility), classes, undefined, []));
      const styles = this.vizStyles(viewportDataViz(r), layers.map((l) => l.rec));
      out.push({
        id: guidOf(r),
        m: composeAffine(place.m, viewportRotation(r.data)),
        clip: viewportCrop(r, place.sheet, place.clip),
        scale,
        layers: layers.map((l) => l.entry),
        classes,
        ...(styles ? { styles } : {}),
      });
    }
    return out;
  }

  /** The design-layer viewports on a design layer; their layer's scale sets their dashes and markers. */
  private designViews(layer: Rec): ViewportView[] {
    const out: ViewportView[] = [];
    for (const r of this.dlvpsOn(layer)) {
      const shows = this.dlvpShows(r)!;
      const layers = shows.layers.flatMap((l) => this.viewportLayers(l.rec, l.visibility, shows.classes, undefined, [r]));
      const m = readPluginMatrix(r.data);
      out.push({
        id: guidOf(r),
        m,
        clip: this.drawnBox(m, layers) ?? { x0: m.e, y0: m.f, x1: m.e, y1: m.f },
        uncropped: true,
        scale: f64(layer.data, LAYER_SCALE),
        layers: layers.map((l) => l.entry),
        classes: shows.classes,
      });
    }
    return out;
  }

  /**
   * How a viewport whose class visibility is `classes` draws `layer`: what the design-layer
   * viewports on the layer show (each placed by `via` and its own matrix, its class visibility
   * over `classes`), then the layer itself. `path` is the design-layer viewports it is inside.
   */
  private viewportLayers(
    layer: Rec,
    shown: Visibility,
    classes: ReadonlyMap<number, Visibility>,
    via: ViewportLayer["via"],
    path: readonly Rec[],
  ): { rec: Rec; entry: ViewportLayer }[] {
    const out: { rec: Rec; entry: ViewportLayer }[] = [];
    for (const r of path.length < MAX_DLVP_DEPTH ? this.dlvpsOn(layer) : []) {
      const own = classes.get(r.classIndex) ?? this.classVisibility(r.classIndex);
      if (path.includes(r) || own === "hidden") continue;
      const shows = this.dlvpShows(r)!;
      const m = readPluginMatrix(r.data);
      const inner = { m: via ? composeAffine(via.m, m) : m, classes: new Map([...classes, ...shows.classes]) };
      for (const l of shows.layers) out.push(...this.viewportLayers(l.rec, bothShow(bothShow(shown, own), l.visibility), inner.classes, inner, [...path, r]));
    }
    out.push({ rec: layer, entry: { id: guidOf(layer), visibility: shown, ...(via ? { via } : {}) } });
    return out;
  }

  /** The box round what a viewport placed by m draws of its layers (their objects' bounds), or null when they hold nothing. */
  private drawnBox(m: Affine, layers: readonly { entry: ViewportLayer }[]): BBox | null {
    const idx = this.index();
    let box: BBox | null = null;
    for (const { entry } of layers) {
      let b: BBox | null = null;
      for (const o of idx.byLayer.get(entry.id) ?? []) {
        const ob = o.bounds ?? o.shape?.bbox;
        if (ob && [ob.x0, ob.y0, ob.x1, ob.y1].every(Number.isFinite)) b = b ? unionBox(b, ob) : ob;
      }
      if (!b) continue;
      const placed = entry.via ? composeAffine(m, entry.via.m) : m;
      const corners = bboxOfPoints([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].map((p) => applyAffine(placed, p)));
      if (corners) box = box ? unionBox(box, corners) : corners;
    }
    return box;
  }

  /** The design-layer viewports on a layer, at its top level or in its groups, in stacking order. */
  private dlvpsOn(layer: Rec): Rec[] {
    if (!this.dlvps) {
      this.dlvps = new Map();
      for (const r of this.recs) {
        if (!isDesignLayerViewport(r)) continue;
        let p = r.parent;
        while (p && p.type === GROUP) p = p.parent;
        if (p?.type !== LAYER) continue;
        const list = this.dlvps.get(p);
        if (list) list.push(r);
        else this.dlvps.set(p, [r]);
      }
    }
    return this.dlvps.get(layer) ?? [];
  }

  /**
   * What a design-layer viewport shows: the layers it has entries for, in stacking order, with the
   * visibility its list gives them (those it hides left out), and the class visibility it sets.
   * Null when `r` is not one.
   */
  dlvpShows(r: Rec): { layers: { rec: Rec; visibility: Visibility }[]; classes: ReadonlyMap<number, Visibility> } | null {
    if (!isDesignLayerViewport(r)) return null;
    const list = dlvpList(r);
    const order = new Map(this.layerRecs.map((l, i) => [l.nameIndex, i] as const));
    const names = [...new Set(dlvpLayerNames(r))].filter((n) => order.has(n)).sort((x, y) => order.get(x)! - order.get(y)!);
    return {
      layers: names
        .map((n) => ({ rec: this.layerRecs[order.get(n)!], visibility: visibility(list.layers.get(n) ?? 0) }))
        .filter((l) => l.visibility !== "hidden"),
      classes: new Map([...list.classes].map(([n, v]) => [n, visibility(v)])),
    };
  }

  /** A class's own visibility (visible when the drawing has no such class). */
  private classVisibility(index: number): Visibility {
    const c = this.classRecs.get(index);
    return c ? visibility(i16(c.data, CLASS_VIS)) : "visible";
  }

  /**
   * How data visualisations redraw what a sheet's sections, elevations and details draw from the
   * copy they cache, by object id, or null when none of them applies one. Each cached piece is
   * tested on its own class and material (a cut wall's components keep their materials). The cache
   * doesn't say which layer a piece came from, so a test on layer or story never matches it, and
   * the viewport's annotations are left as they are.
   */
  viewportStyles(layerId: string): ReadonlyMap<string, StyleOverride> | null {
    if (this.cachedViewStyles.has(layerId)) return this.cachedViewStyles.get(layerId)!;
    this.vizs ??= readDataViz(this.recs);
    const idx = this.index();
    const out = new Map<string, StyleOverride>();
    const sheet = this.layerRec(layerId);
    const unknown = { layer: "", story: null };
    for (const r of sheet ? objectWalk(sheet) : []) {
      if (r.type !== VIEWPORT || viewportIsPlan(r.data)) continue;
      const vizs = viewportDataViz(r)
        .map((g) => this.vizs!.get(g))
        .filter((v): v is DataViz => !!v);
      if (vizs.length === 0) continue;
      const visit = (parent: Rec): void => {
        for (const c of objectChildren(parent)) {
          if (onViewportSheet(c)) continue;
          const o = idx.objects.get(guidOf(c));
          const s = o?.shape ? this.vizStyle(vizs, o, unknown) : null;
          if (s) out.set(o!.id, s);
          visit(c);
        }
      };
      visit(r);
    }
    const styles = out.size > 0 ? out : null;
    this.cachedViewStyles.set(layerId, styles);
    return styles;
  }

  worksheetContents(index: number): WorksheetContents | null {
    const rec = this.worksheets.get(index);
    return rec ? readWorksheetContents(rec, this.names, this.meta.units) : null;
  }

  worksheetRows(index: number): string[][] | null {
    const rec = this.worksheets.get(index);
    const grid = rec && readWorksheet(rec, this.names, this.meta.units);
    if (!grid) return null;
    const rows = grid.rowHeights.map(() => grid.colWidths.map(() => ""));
    for (const c of grid.cells) if (rows[c.row] && c.col < grid.colWidths.length) rows[c.row][c.col] = c.text;
    return rows;
  }

  resources(): ResourceInfo[] {
    this.resourceList ??= readResources(this.recs, this.names);
    return this.resourceList;
  }

  /**
   * How the data visualisations `guids` (in a viewport's order) redraw the objects of `layers`, or
   * null when none of them changes anything. Each object goes by the first of them that it matches
   * and has a value for. A plug-in or symbol is tested before what it holds, and decides for
   * everything inside it when it matches; what a plug-in draws is never tested on its own. A wall's
   * component pieces are tested one by one, each by its own material.
   */
  private vizStyles(guids: readonly string[], layers: readonly Rec[]): Map<string, StyleOverride> | null {
    this.vizs ??= readDataViz(this.recs);
    const vizs = guids.map((g) => this.vizs!.get(g)).filter((v): v is DataViz => !!v);
    if (vizs.length === 0) return null;
    const idx = this.index();
    const out = new Map<string, StyleOverride>();
    for (const layer of layers) {
      const on = { layer: this.layerName(layer), story: this.names.get(u16(layer.data, LAYER_STORY)) ?? null };
      const own = new Map<string, StyleOverride | null>();
      // what an object decides for what it holds: a group or wall passes on what it was handed
      const handed = (o: ObjectInfo | undefined): StyleOverride | null => {
        if (!o) return null;
        if (!OPEN_CONTAINERS.has(o.type)) return styleOf(o);
        return handed(o.parentId ? idx.objects.get(o.parentId) : undefined);
      };
      const styleOf = (o: ObjectInfo): StyleOverride | null => {
        let s = own.get(o.id);
        if (s !== undefined) return s;
        const parent = o.parentId ? idx.objects.get(o.parentId) : undefined;
        s = handed(parent) ?? (parent && this.insidePlugin(parent) ? null : this.vizStyle(vizs, o, on));
        own.set(o.id, s);
        return s;
      };
      for (const o of idx.byLayer.get(guidOf(layer)) ?? []) {
        const s = styleOf(o);
        if (s && o.shape) out.set(o.id, s);
      }
    }
    return out.size > 0 ? out : null;
  }

  /** A plug-in, or anything a plug-in draws. */
  private insidePlugin(o: ObjectInfo): boolean {
    for (let p: ObjectInfo | undefined = o; p; p = p.parentId ? this.index().objects.get(p.parentId) : undefined) {
      if (p.type === PLUGIN) return true;
    }
    return false;
  }

  /** What the first of `vizs` that `o` itself matches does to it; `on` names its layer and story. */
  private vizStyle(vizs: readonly DataViz[], o: ObjectInfo, on: { layer: string; story: string | null }): StyleOverride | null {
    const r = this.index().recs.get(o.id);
    const subject = { plugin: r ? this.pluginName(r) : null, ...on, className: o.className, type: o.type };
    for (const v of vizs) {
      if (!vizMatches(v.criteria, subject)) continue;
      const key =
        v.by === "C" ? o.className : v.by === OBJECT_STYLE ? r && this.objectStyle(o.id) : v.by === MATERIAL ? r && this.materialOf(r) : ALL_OBJECTS;
      const style = key ? v.values.get(key) : undefined;
      const change = style && this.overrideOf(style, o.attrs?.fillPattern ?? 0);
      // one that changes nothing openvwx draws leaves the object to the next
      if (change && Object.keys(change).length > 0) return change;
    }
    return null;
  }

  /**
   * The material an object is made of: its own, or for a plug-in without one the material all its
   * pieces share (a structural member's 2D fill names it), else null.
   */
  private materialOf(r: Rec): string | null {
    const own = this.ownMaterial(r);
    if (own || r.type !== PLUGIN) return own;
    let shared: string | null = null;
    for (const c of objectWalk(r)) {
      const m = c === r ? null : this.ownMaterial(c);
      if (!m) continue;
      if (shared && m !== shared) return null;
      shared = m;
    }
    return shared;
  }

  /** An object's material: the u32 at +0x88 of the types that have one, a material resource's name index (0 for none). */
  private ownMaterial(r: Rec): string | null {
    if (!MATERIAL_TYPES.has(r.type) || r.data.length < MATERIAL_AT + 4) return null;
    this.materials ??= new Set(this.recs.filter((x) => x.type === MATERIAL_RESOURCE).map((x) => x.nameIndex));
    const n = u32(r.data, MATERIAL_AT);
    return n !== 0 && this.materials.has(n) ? (this.names.get(n) ?? null) : null;
  }

  /**
   * The style an object follows: a slab's (71) is named at +0x104, a wall's (68) at +0xf7; a
   * plug-in's (a slab plug-in's slab style) by its parameters' Style field.
   */
  private objectStyle(id: string): string | null {
    const r = this.index().recs.get(id);
    if (r?.type === SLAB) return r.data.length >= SLAB_STYLE_AT + 4 ? (this.names.get(u32(r.data, SLAB_STYLE_AT)) ?? null) : null;
    if (r?.type === WALL) return r.data.length >= WALL_STYLE + 4 ? this.wallStyle(r) : null;
    const field = this.records(id)
      .find((r) => r.parametric)
      ?.fields.find((f) => f.name === "Style" && f.kind === "integer");
    return typeof field?.value === "number" ? (this.names.get(field.value) ?? null) : null;
  }

  hasPluginFormat(name: string): boolean {
    for (const [index, n] of this.names) if (n === name && this.formatDef(index)?.parametric) return true;
    return false;
  }

  /** The plug-in an object is (the format name of its parameter record), or null. */
  pluginName(r: Rec): string | null {
    if (r.type !== PLUGIN) return null;
    for (const c of r.children) {
      if (c.type !== RECORD) continue;
      const format = recordFormat(c.data);
      if (this.formatDef(format)?.parametric) return this.names.get(format) ?? null;
    }
    return null;
  }

  /**
   * A visualisation's value as Attributes take it, for an object filled with `fillPattern`; a hatch
   * or line type the file lacks is left as it was. A solid colour given to a tile-filled object is
   * the ground its tile draws on: the published detail sheets show the batt insulation's tile over
   * the visualisation's grey.
   */
  private overrideOf(style: VizStyle, fillPattern: number): StyleOverride {
    const o: StyleOverride = {};
    const f = style.fill;
    if (f?.kind === "none") o.fillPattern = 0;
    else if (f?.kind === "solid" && fillPattern < 0 && this.resources().some((x) => x.kind === "tile" && x.index === -fillPattern)) o.fillBack = f.color;
    else if (f?.kind === "solid") Object.assign(o, { fillPattern: 1, fillBack: f.color });
    else if (f?.kind === "pattern" && f.index > 1) Object.assign(o, { fillPattern: f.index, fillFore: f.fore, fillBack: f.back });
    else if (f?.kind === "hatch") {
      const hatch = this.resources().find((x) => x.kind === "hatch" && x.name === f.name);
      // a hatch draws in its own colours
      if (hatch) o.fillPattern = -hatch.index;
    }
    const p = style.pen;
    if (p?.kind === "none") o.lineStyle = 0;
    else if (p?.kind === "solid") Object.assign(o, { lineStyle: SOLID_PEN, pen: p.color });
    else if (p?.kind === "line-type") {
      const lt = this.lineTypes().find((x) => x.name === p.name);
      if (lt) Object.assign(o, { lineStyle: lt.style, pen: p.color });
    }
    return o;
  }

  viewportIds(layerId: string): string[] {
    const sheet = this.layerRec(layerId);
    return sheet ? [...objectWalk(sheet)].filter((r) => r.type === VIEWPORT).map(guidOf) : [];
  }

  wall(id: string): WallInfo | null {
    const r = this.rec(id);
    const w = r?.type === WALL ? readWall(r.data) : null;
    if (!r || !w) return null;
    // its heights as stored less its layer's elevation
    const z = layerElevationOf(r);
    return { ...w, bottom: w.bottom - z, top: w.top - z, style: this.wallStyle(r) };
  }

  slab(id: string): SlabInfo | null {
    const r = this.rec(id);
    if (r?.type !== SLAB || r.data.length < SLAB_END) return null;
    const thickness = f64(r.data, SLAB_THICKNESS);
    return Number.isFinite(thickness) ? { thickness, style: this.objectStyle(id) } : null;
  }

  heliodon(id: string): HeliodonSun | null {
    const r = this.rec(id);
    if (!r || this.pluginName(r) !== HELIODON) return null;
    const fields = this.records(id).find((x) => x.parametric)?.fields;
    return fields ? readHeliodonSun(new Map(fields.map((f) => [f.name, f.value]))) : null;
  }

  /** The wall style a wall follows, named at +0xf7 when that names one of the drawing's (type 127). */
  private wallStyle(r: Rec): string | null {
    this.wallStyles ??= new Set(this.recs.filter((x) => x.type === WALL_STYLE_RESOURCE).map((x) => x.nameIndex));
    const n = u32(r.data, WALL_STYLE);
    return n !== 0 && this.wallStyles.has(n) ? (this.names.get(n) ?? null) : null;
  }

  viewport(id: string): ViewportInfo | null {
    const r = this.rec(id);
    const scale = r?.type === VIEWPORT ? viewportScale(r.data) : null;
    if (!r || scale === null) return null;
    const box = viewportBox(r.data);
    if (!box) return null;
    const lists = viewportLists(r.data);
    const listed = new Map(lists?.layers.map((e) => [e.name, visibility(e.visibility)] as const));
    const layers = this.layers();
    return {
      id,
      name: this.names.get(r.nameIndex) ?? "",
      plan: viewportIsPlan(r.data),
      scale,
      box,
      layers: layers
        .map((l, i) => ({ l, name: this.layerRecs[i].nameIndex }))
        .filter(({ l }) => l.kind === "design")
        .map(({ l, name }) => ({ id: l.id, name: l.name, visibility: listed.get(name) ?? "hidden" })),
      classes: (lists?.classes ?? []).map((e) => ({ index: e.name, visibility: visibility(e.visibility) })),
    };
  }

  objectTextures(id: string): TexturePart[] | null {
    const r = this.rec(id);
    if (!r) return null;
    const dict = textureDict(r);
    if (dict) return readTextureParts(dict.data);
    return TAKES_TEXTURE.has(r.type) ? [] : null;
  }

  records(id: string): ObjectRecord[] {
    const r = this.rec(id);
    return r ? this.recordsOf(r) : [];
  }

  pluginPath(id: string): string | null {
    const r = this.rec(id);
    const group = r?.type === PLUGIN ? objectChildren(r).find(isPathGroup) : undefined;
    const path = group && objectChildren(group).find((c) => c.type === 5 || c.type === 21);
    return path ? guidOf(path) : null;
  }

  heightsOf(id: string): { min: number; max: number } | null {
    const r = this.rec(id);
    if (!r) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const { triangles: t } of objectTriangles(this, r)) {
      for (let i = 2; i < t.length; i += 3) {
        if (t[i] < min) min = t[i];
        if (t[i] > max) max = t[i];
      }
    }
    return min <= max ? { min, max } : null;
  }

  symbolRecords(index: number): ObjectRecord[] {
    const r = this.symbols.get(index);
    return r ? this.recordsOf(r) : [];
  }

  /** The records attached to a record: an object's, or a symbol definition's (as placed instances start with them). */
  private recordsOf(r: Rec): ObjectRecord[] {
    const out: ObjectRecord[] = [];
    for (const c of r.children) {
      if (c.type !== RECORD) continue;
      const format = recordFormat(c.data);
      const fmt = this.formatDef(format);
      const fields = fmt && readValues(c.data, fmt);
      if (fmt && fields) out.push({ format, name: this.names.get(format) ?? `#${format}`, parametric: fmt.parametric, fields });
    }
    return out;
  }

  cameras(): CameraInfo[] {
    const out: CameraInfo[] = [];
    for (const r of this.recs) {
      if (this.pluginName(r) !== CAMERA_PLUGIN) continue;
      let layer: Rec | null = null;
      let viewport: Rec | null = null;
      for (let p = r.parent; p && !layer; p = p.parent) {
        if (p.type === VIEWPORT) viewport ??= p;
        else if (p.type === LAYER) layer = p;
      }
      // a camera in a symbol definition isn't placed anywhere
      if (!layer) continue;
      const fields = this.records(guidOf(r)).find((x) => x.parametric)?.fields ?? [];
      const value = (name: string): RecordField["value"] | undefined => fields.find((f) => f.name === name)?.value;
      const num = (name: string): number => {
        const v = value(name);
        return typeof v === "number" && Number.isFinite(v) ? v : NaN;
      };
      const eye = [num("__Point3DCameraX"), num("__Point3DCameraY"), num("__Point3DCameraZ")] as const;
      const target = [num("__Point3DLookToX"), num("__Point3DLookToY"), num("__Point3DLookToZ")] as const;
      const angle = num("ViewAngle");
      if (![...eye, ...target, angle].every(Number.isFinite) || eye.every((v, i) => v === target[i])) continue;
      const name = value("Name");
      const aspect = num("AspectCustom");
      out.push({
        id: guidOf(r),
        name: typeof name === "string" && name ? name : "Camera",
        layerId: guidOf(layer),
        viewportId: viewport ? guidOf(viewport) : undefined,
        eye,
        target,
        viewAngle: angle,
        aspect: aspect > 0 ? aspect : 4 / 3,
        perspective: value("Projection") !== "Orthogonal",
      });
    }
    return out;
  }

  stories(): StoryInfo[] {
    const out: StoryInfo[] = [];
    for (const r of this.recs) {
      const story = isStory(r) ? readStory(r.data) : null;
      const name = this.names.get(r.nameIndex);
      if (!story || name === undefined) continue;
      out.push({
        index: r.nameIndex,
        name,
        suffix: story.suffix,
        elevation: story.elevation,
        levels: story.levels.map((l) => ({ ...l })),
        layers: this.layerRecs.filter((l) => l.data[layerKindAt(l.data)] !== 2 && u16(l.data, LAYER_STORY) === r.nameIndex).map(guidOf),
      });
    }
    // the top story first, as Vectorworks lists them
    return out.sort((a, b) => b.elevation - a.elevation);
  }

  /** The record of the story with name index `index`, or null. */
  storyRec(index: number): Rec | null {
    return this.recs.find((r) => r.nameIndex === index && isStory(r)) ?? null;
  }

  recordFormats(): { format: number; name: string }[] {
    const out: { format: number; name: string }[] = [];
    for (const r of this.recs) {
      if (r.type !== RECORD_FORMAT || !r.nameIndex || this.formatDef(r.nameIndex)?.parametric !== false) continue;
      out.push({ format: r.nameIndex, name: this.names.get(r.nameIndex) ?? `#${r.nameIndex}` });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  recordFormatFields(format: number): RecordField[] | null {
    const fmt = this.formatDef(format);
    if (!fmt || fmt.parametric) return null;
    const defaults = this.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format)?.children.find((c) => c.type === RECORD);
    return defaults ? readValues(defaults.data, fmt) : null;
  }

  /** Field layout of the record format with this name index. */
  formatDef(index: number): FormatDef | null {
    if (!this.formatDefs) {
      this.formatDefs = new Map();
      for (const r of this.recs) if (r.type === RECORD_FORMAT && r.nameIndex) this.formatDefs.set(r.nameIndex, readFormat(r.data));
    }
    return this.formatDefs.get(index) ?? null;
  }

  model3d(): Mesh3D[] {
    // built again when Preferences change the 3D conversion resolution
    if (this.meshesAt !== turnStepsGeneration()) this.meshes = null;
    this.meshesAt = turnStepsGeneration();
    this.meshes ??= buildModel3d(this);
    return this.meshes;
  }

  model3dTree(): ModelTree {
    return buildModelTree(this);
  }

  symbolModel3d(index: number): { meshes: Mesh3D[]; members: ReadonlyMap<string, SymbolMember> } | null {
    const def = this.symbols.get(index);
    if (!def) return null;
    const members = new Map<string, SymbolMember>();
    const visit = (parent: Rec, parentId: string | null): void => {
      for (const c of objectChildren(parent)) {
        const id = guidOf(c);
        const name = c.nameIndex ? this.names.get(c.nameIndex) : undefined;
        members.set(id, { ...(name ? { name } : {}), typeName: c.typeName, className: this.names.get(c.classIndex) ?? "", parentId });
        if (c.type === GROUP) visit(c, id);
      }
    };
    visit(def, null);
    return { meshes: buildSymbolModel3d(this, def), members };
  }

  lights3d(): Light3D[] {
    this.lights ??= buildLights3d(this);
    return this.lights;
  }
}
