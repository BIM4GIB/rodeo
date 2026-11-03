// Decoders for drawable object records (port of the decoders in openvwx/geometry.py).
//
// Coordinates keep Vectorworks' MiniCAD/QuickDraw conventions, converted here
// to world coordinates with y pointing up:
//   * points are stored (y, x)
//   * bounding boxes are stored (top, left, bottom, right)
//   * arc angles are QuickDraw angles (0 = 12 o'clock, clockwise)

import { readAttrs } from "./attrs.ts";
import { crc32, f64, i32, setU32be, u16, u32, u32be, readUtf16 } from "./bytes.ts";
import { heldEntry, heldPart, loadedImage, mimeName } from "./held.ts";
import type { Rec } from "./records.ts";
import type { Affine, BBox, Pt, Shape, VertexKind } from "./types.ts";

/** Vectorworks writes +/-DBL_MAX for "no bounds". */
const NO_BOUNDS = 1e300;
/** Sheet viewport record (see model.ts): crop box, shift and scale. */
export const VIEWPORT = 122;
export const VIEWPORT_BOX = 0x68;
export const VIEWPORT_SHIFT = 0xd4;
/** where the scale sits in 2023/2024, 2025 and 2026 files; the first plausible value wins */
const VIEWPORT_SCALE_AT = [0x2cc, 0x2de, 0x2e4];

/**
 * A light object (FORMAT.md §7): its plan box, then its position (x, y, z) f64, u8 1 when on, a u16
 * kind (LIGHT_KINDS' order, as Vectorscript numbers them) and unit directions, a directional
 * light's and a spot's; the fields up to LIGHT_END are known.
 */
export const LIGHT = 81;
export const LIGHT_AT = 0x8c;
export const LIGHT_ON = 0xa4;
export const LIGHT_KIND = 0xe2;
export const LIGHT_KINDS = ["directional", "point", "spot"] as const;
const LIGHT_DIRECTION = 0xe4;
const LIGHT_SPOT_DIRECTION = 0xfe;
export const LIGHT_END = 0x126;

/**
 * A wall (FORMAT.md §7): its plan box, then the two ends of its control line stored (y, x), as a
 * dimension's measured points are, its thickness, and three (top, bottom) pairs of z above its
 * layer (the first the wall's own; the others nearly always the same), then the name index of its
 * wall style (a type-127 resource), all packed at odd offsets.
 */
export const WALL = 68;
export const WALL_LINE = 0x9e;
const WALL_THICKNESS = 0xbf;
export const WALL_HEIGHTS = [0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef] as const;
export const WALL_STYLE = 0xf7;
export const WALL_STYLE_RESOURCE = 127;

/** A wall's control line, thickness and heights (mm), or null when its record is too short or they don't read. */
export function readWall(d: Uint8Array): { start: Pt; end: Pt; thickness: number; top: number; bottom: number } | null {
  if (d.length < WALL_STYLE + 4) return null;
  const [y0, x0, y1, x1] = [0, 8, 16, 24].map((k) => f64(d, WALL_LINE + k));
  const thickness = f64(d, WALL_THICKNESS);
  const [top, bottom] = [f64(d, WALL_HEIGHTS[0]), f64(d, WALL_HEIGHTS[1])];
  if (![x0, y0, x1, y1, thickness, top, bottom].every(Number.isFinite) || !(thickness >= 0)) return null;
  return { start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness, top, bottom };
}

/** Where a light object's record holds the direction it shines: a spot its own, the others a directional light's. */
export function lightAim(d: Uint8Array): number {
  return u16(d, LIGHT_KIND) === 2 ? LIGHT_SPOT_DIRECTION : LIGHT_DIRECTION;
}

/** Where a viewport's scale sits, or null when the record has none. */
export function viewportScaleAt(d: Uint8Array): number | null {
  for (const at of VIEWPORT_SCALE_AT) {
    if (at + 8 > d.length) break;
    const s = f64(d, at);
    if (s >= 1e-3 && s <= 1e6) return at;
  }
  return null;
}

/** A viewport's scale (48 for 1:48), or null when the record has none. */
export function viewportScale(d: Uint8Array): number | null {
  const at = viewportScaleAt(d);
  return at === null ? null : f64(d, at);
}

/** Aux record that tags what a group inside a viewport holds: four letters at +0x50, stored reversed. */
const GROUP_TAG = 76;
/** Tags of the groups whose points are on the sheet: annotations, crop, an interior elevation's marker. */
const ON_SHEET_TAGS = new Set(["onna", "porc", "vlei"]);
/** Tag of the group holding a viewport's crop object */
const CROP_TAG = "porc";
/** Tag of the group holding a viewport's annotations */
const ANNOTATIONS_TAG = "onna";
/** Tag of the group holding a viewport's cached render: an image, which its line work draws over */
const RENDER_TAG = "hcac";
/** an image object */
const IMAGE = 14;
/** Tags of the groups a viewport keeps but does not print: its crop, and a detail viewport's callout */
const UNDRAWN_TAGS = new Set([CROP_TAG, "lted"]);

function groupTags(g: Rec): string[] {
  if (g.type !== 11) return [];
  return g.children.filter((c) => c.type === GROUP_TAG && c.data.length >= 0x54).map((c) => String.fromCharCode(...c.data.subarray(0x50, 0x54)));
}

/**
 * True for a group inside a viewport whose points are sheet coordinates times the scale, with no
 * shift: its annotations ("anno"), its crop ("crop") and the like. The cached drawing ("bcch",
 * "cach", "pscn", "csch") is in view coordinates and goes through the shift.
 */
export function onViewportSheet(g: Rec): boolean {
  return groupTags(g).some((t) => ON_SHEET_TAGS.has(t));
}

/** True for the group holding a viewport's crop object. */
export function isViewportCrop(g: Rec): boolean {
  return groupTags(g).includes(CROP_TAG);
}

/** True for the group holding a viewport's annotations. */
export function isViewportAnnotations(g: Rec): boolean {
  return groupTags(g).includes(ANNOTATIONS_TAG);
}

/**
 * False for the groups a viewport holds but published sheets never print: its crop, which only
 * bounds what it shows (neither its fill, often solid white, nor its outline prints), and the
 * detail callout ("detl") a detail viewport was made from, whose boundary would ring the drawing.
 */
export function viewportGroupDrawn(g: Rec): boolean {
  return !groupTags(g).some((t) => UNDRAWN_TAGS.has(t));
}

/**
 * True for a viewport whose cached render is line work alone (Hidden Line, Dashed Hidden Line): its
 * drawing as published sheets print it, hidden lines gone and grayed layers left out. A plan
 * viewport like it isn't drawn again from its layers, as a wireframe one is.
 */
export function viewportDrawsCache(r: Rec): boolean {
  const cache = r.children.find((g) => groupTags(g).includes(RENDER_TAG));
  return !!cache && cache.children.some((c) => c.type !== GROUP_TAG && c.type !== 0) && !cache.children.some((c) => c.type === IMAGE);
}

/**
 * Where a text in a viewport's cached line work goes. The cache keeps each text as a polygon, its
 * box where the sheet prints it, holding the text in the frame of the object it came from (a
 * projector's notes in the projector's, turned with it); published sheets print it level in that
 * box. The map from the text's frame to the cache's, or null for a text that isn't one.
 */
export function cachedTextPlacement(r: Rec): Affine | null {
  const box = r.parent;
  if (r.type !== 10 || box?.type !== 5 || !box.parent || !groupTags(box.parent).includes(RENDER_TAG)) return null;
  const n = u16(r.data, TEXT_CHARS);
  const at = bboxAt(box.data);
  if (!n || 2 * n > r.data.length - 0xf8 || !at) return null;
  const f = readTextFrame(r.data, readUtf16(r.data, r.data.length - 2 * n, 2 * n));
  const corners = textCorners(f);
  const c = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
  // turned back level about the text's middle, which goes to the box's middle
  const cos = f.u.x;
  const sin = -f.u.y;
  const to = { x: (at.x0 + at.x1) / 2, y: (at.y0 + at.y1) / 2 };
  return { a: cos, b: sin, c: -sin, d: cos, e: to.x - (cos * c.x - sin * c.y), f: to.y - (sin * c.x + cos * c.y) };
}

/**
 * A viewport's groups in drawing order: its cached render ("cach") first, then the rest as stored.
 * The render is stored after the cached lines it lies under: published sheets paint it first.
 */
export function viewportDrawOrder(groups: readonly Rec[]): Rec[] {
  const renders = groups.filter((g) => groupTags(g).includes(RENDER_TAG));
  return renders.length === 0 ? [...groups] : [...renders, ...groups.filter((g) => !renders.includes(g))];
}

/** where the view matrix (3x3 f64, row-major; identity for a plan) starts: 2023-2025, then 2026 files */
const VIEWPORT_VIEW_AT = [0x238, 0x23e];
/** where the layer and class list starts in 2023, 2024, 2025 and 2026 files */
const VIEWPORT_LIST_AT = [0x338, 0x33c, 0x34e, 0x354];
/** the list's header: u16 0, u16 layers, u16 classes */
const VIEWPORT_LIST_HEAD = 6;
/** a list entry: u16 name index, i16 0, i16 visibility, u16 flags */
export const VIEWPORT_ENTRY_SIZE = 8;
/** the plan's rotation, a 3x3 f64 2D transform (row-major, last row 0 0 1) */
export const VIEWPORT_ROTATION = 0x8c;

/** True when a viewport looks straight down (a plan), false for elevations, sections and 3D views. */
export function viewportIsPlan(d: Uint8Array): boolean {
  for (const at of VIEWPORT_VIEW_AT) {
    if (at + 72 > d.length) break;
    const m = Array.from({ length: 9 }, (_, i) => f64(d, at + 8 * i));
    // the matrix is a rotation; anything else at this offset is a different layout
    let rotation = m.every(Number.isFinite);
    for (let i = 0; i < 3 && rotation; i++) {
      for (let j = 0; j < 3 && rotation; j++) {
        const dot = m[3 * i] * m[3 * j] + m[3 * i + 1] * m[3 * j + 1] + m[3 * i + 2] * m[3 * j + 2];
        if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-6) rotation = false;
      }
    }
    if (rotation) return m.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-9);
  }
  return false;
}

/** One entry of a viewport's layer or class list: the name index and its raw visibility code. */
export interface ViewportEntry {
  name: number;
  visibility: number;
}

/**
 * Where a viewport's layer and class list starts and how many entries of each it has, or null
 * when the record has no list. The list is a header (u16 0, u16 layers, u16 classes) and then
 * one 8-byte entry per layer and per class, ending at the end of the record.
 */
export function viewportListAt(d: Uint8Array): { at: number; layers: number; classes: number } | null {
  for (const at of VIEWPORT_LIST_AT) {
    if (at + VIEWPORT_LIST_HEAD > d.length || u16(d, at) !== 0) continue;
    const layers = u16(d, at + 2);
    const classes = u16(d, at + 4);
    if (at + VIEWPORT_LIST_HEAD + (layers + classes) * VIEWPORT_ENTRY_SIZE === d.length) return { at, layers, classes };
  }
  return null;
}

/** Offset of entry i (layers first, then classes) in a list at `at`. */
export function viewportEntryAt(at: number, i: number): number {
  return at + VIEWPORT_LIST_HEAD + i * VIEWPORT_ENTRY_SIZE;
}

/** Offsets within a list entry. */
export const VIEWPORT_ENTRY_NAME = 0;
export const VIEWPORT_ENTRY_VISIBILITY = 4;
export const VIEWPORT_ENTRY_FLAGS = 6;

/** The design layers a viewport lists and the class visibility it sets, or null when the record has no list. */
export function viewportLists(d: Uint8Array): { layers: ViewportEntry[]; classes: ViewportEntry[] } | null {
  const list = viewportListAt(d);
  if (!list) return null;
  const entry = (i: number): ViewportEntry => {
    const o = viewportEntryAt(list.at, i);
    return { name: u16(d, o + VIEWPORT_ENTRY_NAME), visibility: (u16(d, o + VIEWPORT_ENTRY_VISIBILITY) << 16) >> 16 };
  };
  return {
    layers: Array.from({ length: list.layers }, (_, i) => entry(i)),
    classes: Array.from({ length: list.classes }, (_, i) => entry(list.layers + i)),
  };
}

/** polyline vertex word: the edge from this vertex to the next is drawn (clear on hidden edges) */
const POLYLINE_EDGE_VISIBLE = 0x80;
/** polyline vertex kinds (byte 1 of the word); 0 is a corner */
const BEZIER = 1;
const CUBIC = 2;
const FILLET = 3;
const THROUGH = 4;

/** The vertex kind word's kind byte for each VertexKind. */
export const VERTEX_CODE: Readonly<Record<VertexKind, number>> = { corner: 0, bezier: BEZIER, cubic: CUBIC, arc: FILLET, through: THROUGH };
/** Each kind byte's VertexKind. */
const KIND_OF_CODE: Readonly<Record<number, VertexKind>> = { 0: "corner", [BEZIER]: "bezier", [CUBIC]: "cubic", [FILLET]: "arc", [THROUGH]: "through" };
/**
 * Rounds of the solve that places cubic vertices' control points: each round moves every control
 * point by 4/3 of the gap between its vertex and where the curve passes, which leaves a third of
 * the gap. Five rounds give the controls Vectorworks stores (they leave 1/243 of the gap, as every
 * cubic vertex in the demos does).
 */
const CUBIC_ROUNDS = 5;
/** points per radian along a polyline's arcs (32 to the turn) */
const ARC_POINTS_PER_RADIAN = 16 / Math.PI;

interface Vertex {
  p: Pt;
  kind: number;
  /** the edge to the next vertex is drawn */
  visible: boolean;
  /** a fillet's radius (0: as large as fits); a through vertex keeps its arc's */
  radius: number;
  /** a cubic vertex's control point, as stored (+20 y, +28 x) */
  control?: Pt;
}

/** The points a curved polyline vertex is drawn as; the first `lead` lie on the half nearer the previous vertex. */
interface Bend {
  points: Pt[];
  lead: number;
}

function pointAt(d: Uint8Array, off: number): Pt {
  return { x: f64(d, off + 8), y: f64(d, off) };
}

function bboxAt(d: Uint8Array, off = 0x68): BBox | null {
  const top = f64(d, off);
  const left = f64(d, off + 8);
  const bottom = f64(d, off + 16);
  const right = f64(d, off + 24);
  // "no bounds", or never filled in (NaN)
  if (!(Math.abs(top) <= NO_BOUNDS) || ![left, bottom, right].every(Number.isFinite)) return null;
  return {
    x0: Math.min(left, right),
    y0: Math.min(top, bottom),
    x1: Math.max(left, right),
    y1: Math.max(top, bottom),
  };
}

/** A group's (11) cached 3D bounds, after its plan bounds at +0x68: f64 x1, y1, z1, x0, y0, z0. */
const GROUP_BOUNDS_3D = 0x9c;
const GROUP_Z1 = GROUP_BOUNDS_3D + 16;
const GROUP_Z0 = GROUP_BOUNDS_3D + 40;
/** extents up to this (document units) count as none */
const FLAT = 1e-6;
/** how far, as a share of a group's plan bounds, its parts may stray outside them (rounding) */
const PLAN_SLACK = 1e-3;

/**
 * A group's (11) cached plan bounds when it holds part of a 3D model: its cached 3D bounds rise.
 * Null for any other record; groups of plan drawing have no 3D bounds, or flat ones.
 */
export function modelGroupPlan(d: Uint8Array): BBox | null {
  if (d[0x19] !== 11 || d.length < GROUP_Z0 + 8) return null;
  const z1 = f64(d, GROUP_Z1);
  const z0 = f64(d, GROUP_Z0);
  if (!(Math.abs(z1) <= NO_BOUNDS && Math.abs(z0) <= NO_BOUNDS) || z1 - z0 <= FLAT) return null;
  return bboxAt(d);
}

/**
 * Whether a 2D object in a group of a 3D model (modelGroupPlan gives its plan bounds) lies on a
 * vertical plane, which Top/Plan sees edge on. Its coordinates are then in that plane and reach
 * outside the group's plan bounds (a door's hinge markers, drawn on the leaf for elevations), or
 * it is an area flattened to a line (a cabinet door's markers, on its front). Plan parts lie
 * within the bounds, as the bounds are their union.
 */
export function standsUp(s: Shape, plan: BBox): boolean {
  const b = s.bbox ?? bboxOfPoints(s.points);
  if (!b) return false;
  const slack = PLAN_SLACK * Math.max(1, plan.x1 - plan.x0, plan.y1 - plan.y0);
  const outside = b.x0 < plan.x0 - slack || b.y0 < plan.y0 - slack || b.x1 > plan.x1 + slack || b.y1 > plan.y1 + slack;
  const flat = (s.kind === "polygon" || s.kind === "rect") && (b.x1 - b.x0 <= FLAT || b.y1 - b.y0 <= FLAT);
  return outside || flat;
}

export function bboxOfPoints(pts: Pt[]): BBox | null {
  if (pts.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Rectangle frame (type 3): bottom-left origin (y, x) at +0x8c, unit x axis
 * stored (sin, cos) at +0x9c / +0xa4, width +0xac, height +0xb4. The bbox at
 * +0x68 is the axis-aligned bounds of the turned rectangle.
 */
export interface RectFrame {
  o: Pt;
  u: Pt;
  w: number;
  h: number;
}

export function readRectFrame(d: Uint8Array): RectFrame {
  return {
    o: pointAt(d, 0x8c),
    u: { x: f64(d, 0xa4), y: f64(d, 0x9c) },
    w: f64(d, 0xac),
    h: f64(d, 0xb4),
  };
}

/** Corners counter-clockwise from the frame's origin. */
export function rectCorners(r: RectFrame): Pt[] {
  const v = { x: -r.u.y, y: r.u.x };
  const at = (s: number, t: number): Pt => ({ x: r.o.x + s * r.u.x + t * v.x, y: r.o.y + s * r.u.y + t * v.y });
  return [at(0, 0), at(r.w, 0), at(r.w, r.h), at(0, r.h)];
}

/** Points per rounded corner of a type-13 rectangle's outline. */
const CORNER_STEPS = 8;

/**
 * A rounded rectangle's outline counter-clockwise: the frame's corners swapped for quarter
 * ellipses of the given radii (each at most half the side).
 */
export function roundedRectPoints(r: RectFrame, rx: number, ry: number): Pt[] {
  const a = Math.max(0, Math.min(rx, r.w / 2));
  const b = Math.max(0, Math.min(ry, r.h / 2));
  if (!(a > 0 && b > 0)) return rectCorners(r);
  const v = { x: -r.u.y, y: r.u.x };
  const at = (s: number, t: number): Pt => ({ x: r.o.x + s * r.u.x + t * v.x, y: r.o.y + s * r.u.y + t * v.y });
  const corners: [number, number, number][] = [
    [r.w - a, b, -90],
    [r.w - a, r.h - b, 0],
    [a, r.h - b, 90],
    [a, b, 180],
  ];
  const out: Pt[] = [];
  for (const [s, t, start] of corners) {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const ang = ((start + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
      out.push(at(s + a * Math.cos(ang), t + b * Math.sin(ang)));
    }
  }
  return out;
}

/** True when a frame is well formed and its corners span the cached bbox. */
function frameMatches(r: RectFrame, b: BBox): boolean {
  if (!(r.w > 0 && r.h > 0) || Math.abs(Math.hypot(r.u.x, r.u.y) - 1) > 1e-6) return false;
  const fb = bboxOfPoints(rectCorners(r));
  const tol = 1e-6 * Math.max(1, b.x1 - b.x0, b.y1 - b.y0);
  return !!fb && [fb.x0 - b.x0, fb.y0 - b.y0, fb.x1 - b.x1, fb.y1 - b.y1].every((e) => Math.abs(e) <= tol);
}

/**
 * A rectangle's frame as drawn: the stored one when it agrees with the cached bbox, else the
 * bbox's own (some plug-ins leave a stale frame, sized in other units). Null without a bbox.
 */
export function rectFrameOf(d: Uint8Array): RectFrame | null {
  const b = bboxAt(d);
  if (!b) return null;
  const r = readRectFrame(d);
  return frameMatches(r, b) ? r : { o: { x: b.x0, y: b.y0 }, u: { x: 1, y: 0 }, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

const EXTRUDE = 24;

/**
 * A rectangle's frame as drawn, as rectFrameOf reads it, except in an extrude's profile: there
 * the extrude's own 3D box (Vectorworks', from its body, in the frame the profile is in) settles
 * a frame that doesn't span the cached bbox. In 3 of the 27 such profiles in the 2023 demo the 3D
 * box fits the frame and not the bbox, which is then the stale one.
 */
export function rectFrameIn(rec: Rec): RectFrame | null {
  const d = rec.data;
  const drawn = rectFrameOf(d);
  const owner = rec.parent;
  const b = bboxAt(d);
  if (!b || owner?.type !== EXTRUDE || owner.data.length < GROUP_BOUNDS_3D + 48) return drawn;
  const r = readRectFrame(d);
  if (frameMatches(r, b)) return drawn;
  const v = (k: number): number => f64(owner.data, GROUP_BOUNDS_3D + 8 * k);
  const own = { x0: v(3), y0: v(4), x1: v(0), y1: v(1) };
  return frameMatches(r, own) && !frameMatches(drawn!, own) ? r : drawn;
}

/** The bounds of a rectangle's frame where rectFrameIn finds its cached bbox stale; else null. */
export function staleRectBounds(rec: Rec): BBox | null {
  const b = rec.type === 3 ? bboxAt(rec.data) : null;
  const r = b && rectFrameIn(rec);
  return b && r && !frameMatches(r, b) ? bboxOfPoints(rectCorners(r)) : null;
}

/**
 * Text frame (type 10): origin (y, x) at +0xa8, baseline direction stored
 * (sin, cos) at +0xb8 / +0xc0, vertical alignment u8 +0xe8 (1 top, 2 top
 * baseline, 3 centre, 4 bottom baseline, 5 bottom), horizontal u8 +0xe9
 * (1 left, 2 centre, 3 right). The layout Vectorworks last made follows: u16
 * line count at +0x100 and, from +0x108, the u16 index where each line after
 * the first starts (wrapped paragraphs included); the size f64 comes right after
 * that table, at +0x11e + 2 x (lines - 1). The bbox is the axis-aligned bounds
 * of the turned box, height = lines x 1.14 x size.
 */
export interface TextFrame {
  o: Pt;
  /** unit baseline direction */
  u: Pt;
  hAlign: number;
  vAlign: number;
  size: number;
  lines: number;
  w: number;
  h: number;
}

const TEXT_CHARS = 0xf6;
const TEXT_LINE_COUNT = 0x100;
const TEXT_LINE_STARTS = 0x108;
const TEXT_SIZE_BASE = 0x11e;

/** Lines in the stored layout, 1 when the table does not look right. */
function textLineCount(d: Uint8Array): number {
  if (d.length < TEXT_SIZE_BASE + 8) return 1;
  const n = u16(d, TEXT_LINE_COUNT);
  return n >= 1 && n <= u16(d, TEXT_CHARS) + 1 && TEXT_SIZE_BASE + 2 * n + 6 <= d.length ? n : 1;
}

/** Offset of a text record's size, which moves with its line table. */
export function textSizeAt(d: Uint8Array): number {
  return TEXT_SIZE_BASE + 2 * (textLineCount(d) - 1);
}

/** Text style bits (the u16 at textFaceAt + 2), as worksheet cells keep theirs. */
export const TEXT_BOLD = 1;
export const TEXT_ITALIC = 2;
export const TEXT_UNDERLINE = 4;

/**
 * Offset of a text record's face, 6 bytes before its size (so it moves with the line table too):
 * u16 index into the document's font list, then u16 style bits (TEXT_BOLD, …). Two f64 point
 * sizes come before it, right after the line table.
 */
export function textFaceAt(d: Uint8Array): number {
  return textSizeAt(d) - 6;
}

/**
 * A text's style link when it follows its class's text style (likely: the 3 texts with it in the
 * 2026 demo are in a class that names a text style, and no other negative value is seen).
 */
export const TEXT_STYLE_BY_CLASS = -2;

/**
 * Offset of the i32 that names a text's text style, 8 bytes after its size: the style's name index,
 * 0 for none, or TEXT_STYLE_BY_CLASS.
 */
export function textStyleAt(d: Uint8Array): number {
  return textSizeAt(d) + 8;
}

/** The lines as Vectorworks laid them out (wrapped paragraphs split where it wrapped them), or null. */
function storedLines(d: Uint8Array, text: string): string[] | null {
  const n = textLineCount(d);
  if (n < 2) return null;
  const starts = [0];
  for (let i = 0; i < n - 1; i++) {
    const s = u16(d, TEXT_LINE_STARTS + 2 * i);
    if (s <= starts[starts.length - 1] || s > text.length) return null;
    // a wrap falls after a space, hyphen or line break; one that does not is left over from text edited since
    if (!/[\s\-]/.test(text[s - 1]) && text[s] !== "\r") return null;
    starts.push(s);
  }
  starts.push(text.length);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(text.slice(starts[i], starts[i + 1]).replace(/^[\r\n]|[\r\n]$/g, ""));
  return lines;
}

export const TEXT_LINE_HEIGHT = 1.14;
/** baseline of a line below its top, as a fraction of the size (Arial-like ascent) */
export const TEXT_ASCENT = 0.92;

export function readTextFrame(d: Uint8Array, text: string): TextFrame {
  let u = { x: f64(d, 0xc0), y: f64(d, 0xb8) };
  if (!(Math.abs(Math.hypot(u.x, u.y) - 1) < 1e-6)) u = { x: 1, y: 0 };
  const hAlign = d[0xe9] >= 1 && d[0xe9] <= 3 ? d[0xe9] : 1;
  const vAlign = d[0xe8] >= 1 && d[0xe8] <= 5 ? d[0xe8] : 1;
  const size = f64(d, textSizeAt(d));
  const stored = textLineCount(d);
  const lines = stored > 1 ? stored : text.split("\r").length;
  const h = lines * TEXT_LINE_HEIGHT * (size > 0 ? size : 0);
  // the width comes from the cached bounds, which Vectorworks laid out with the real font
  let w = 0;
  const b = bboxAt(d);
  if (b) {
    const c = Math.abs(u.x);
    const s = Math.abs(u.y);
    w = c >= s ? (b.x1 - b.x0 - h * s) / c : (b.y1 - b.y0 - h * c) / s;
  }
  return { o: pointAt(d, 0xa8), u, hAlign, vAlign, size, lines, w: Math.max(0, w), h };
}

/** Top of the text box above the origin, along the box's up direction. */
export function textTop(f: Pick<TextFrame, "vAlign" | "size" | "lines" | "h">): number {
  const line = TEXT_LINE_HEIGHT * f.size;
  switch (f.vAlign) {
    case 2:
      return TEXT_ASCENT * f.size;
    case 3:
      return f.h / 2;
    case 4:
      return (f.lines - 1) * line + TEXT_ASCENT * f.size;
    case 5:
      return f.h;
    default:
      return 0;
  }
}

/** Box corners counter-clockwise from the bottom-left (in the text's own frame). */
export function textCorners(f: TextFrame): Pt[] {
  const fx = f.hAlign === 2 ? 0.5 : f.hAlign === 3 ? 1 : 0;
  const top = textTop(f);
  const v = { x: -f.u.y, y: f.u.x };
  const at = (s: number, t: number): Pt => ({ x: f.o.x + s * f.u.x + t * v.x, y: f.o.y + s * f.u.y + t * v.y });
  return [at(-fx * f.w, top - f.h), at((1 - fx) * f.w, top - f.h), at((1 - fx) * f.w, top), at(-fx * f.w, top)];
}

/** One line of laid-out text: its characters and the baseline point the justification is measured from. */
export interface TextLine {
  text: string;
  at: Pt;
}

/**
 * Lay a decoded text shape out line by line, the way Vectorworks does: lines
 * 1.14 x size apart, each justified about the anchor along the baseline.
 * Null when the shape has no frame (older decoders, empty text).
 */
export function textBaselines(s: Shape): { size: number; angle: number; hAlign: number; lines: TextLine[] } | null {
  const size = s.textSize;
  if (!s.anchor || !s.text || !(size !== undefined && size > 0)) return null;
  const texts = s.text.split(/\r\n|\r|\n/);
  const angle = s.textAngle ?? 0;
  const rad = (angle * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const down = { x: u.y, y: -u.x };
  const h = texts.length * TEXT_LINE_HEIGHT * size;
  const top = -textTop({ size, lines: texts.length, h, vAlign: s.vAlign ?? 1 });
  const o = s.anchor;
  const lines = texts.map((text, i) => {
    const t = top + (i * TEXT_LINE_HEIGHT + TEXT_ASCENT) * size;
    return { text, at: { x: o.x + t * down.x, y: o.y + t * down.y } };
  });
  return { size, angle, hAlign: s.hAlign ?? 1, lines };
}

function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Flatten a Vectorworks polyline. A bezier vertex is a quadratic control point between the
 * midpoints of its neighbours, sampled at 8 steps. A cubic vertex draws as a bezier vertex at its
 * control point, placed so the curve passes (all but) through the vertex: the one it keeps, or
 * one worked out as Vectorworks does (cubicControls). A fillet vertex rounds its corner with an arc
 * tangent to both edges, of the radius it keeps or, at 0, the largest that fits: one reaching
 * the nearer neighbour, or half way to one that bends too. A through vertex lies on an arc from
 * the previous vertex to the next. The ends of an open polyline are corners whatever their kind.
 */
function flattenPolyline(verts: Vertex[], closed: boolean): { points: Pt[]; hidden: number[] } {
  const pts: Pt[] = [];
  const hidden: number[] = [];
  const n = verts.length;
  const end = (i: number) => !closed && (i === 0 || i === n - 1);
  const bends = (i: number) => !end(i) && (verts[i].kind === BEZIER || verts[i].kind === CUBIC || verts[i].kind === FILLET);
  // cubic vertices draw from their control points: all as stored, or else all worked out
  const stored = verts.every((v, i) => v.kind !== CUBIC || end(i) || v.control);
  const controls = stored ? verts.map((v) => v.control ?? null) : solveCubic(verts, closed);
  const ctrl = (i: number): Pt => (verts[i].kind === CUBIC ? (controls[i] ?? verts[i].p) : verts[i].p);
  for (let i = 0; i < n; i++) {
    const v = verts[i];
    const ip = (i - 1 + n) % n;
    const inx = (i + 1) % n;
    const prev = verts[ip];
    const next = verts[inx];
    const bend = end(i)
      ? null
      : v.kind === BEZIER || v.kind === CUBIC
        ? bezierBend(smooth(prev) ? midpoint(ctrl(ip), ctrl(i)) : prev.p, ctrl(i), smooth(next) ? midpoint(ctrl(inx), ctrl(i)) : next.p)
        : v.kind === FILLET
          ? filletBend(prev, v, next, bends((i - 1 + n) % n), bends((i + 1) % n))
          : v.kind === THROUGH
            ? throughBend(prev.p, v.p, next.p)
            : null;
    if (!bend) {
      if (!v.visible) hidden.push(pts.length);
      pts.push(v.p);
      continue;
    }
    // the bend's first half lies along the edge from the previous vertex
    bend.points.forEach((p, k) => {
      if (!(k < bend.lead ? prev.visible : v.visible)) hidden.push(pts.length);
      pts.push(p);
    });
  }
  return { points: pts, hidden };
}

/**
 * The outline a polyline with these vertex kinds is drawn as (what decoding it once written
 * gives), for previews; arcs are as large as fits.
 */
export function polylineOutline(points: readonly Pt[], kinds: readonly VertexKind[] | undefined, closed: boolean): Pt[] {
  const verts = points.map((p, i) => ({ p, kind: VERTEX_CODE[kinds?.[i] ?? "corner"], visible: true, radius: 0 }));
  return flattenPolyline(verts, closed).points;
}

/** The radius of the circle through a, b and c, or 0 when they are in line. */
export function circumradius(a: Pt, b: Pt, c: Pt): number {
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return cross > 1e-12 ? (ab * bc * ca) / (2 * cross) : 0;
}

/** A bezier or cubic vertex's neighbour is joined to it at their controls' midpoint. */
function smooth(v: Vertex): boolean {
  return v.kind === BEZIER || v.kind === CUBIC;
}

/** The quadratic from m0 to m1 pulled towards control c, without its start. */
function bezierBend(m0: Pt, c: Pt, m1: Pt): Bend {
  const points: Pt[] = [];
  for (let s = 1; s <= 8; s++) {
    const t = s / 8;
    const u = 1 - t;
    points.push({ x: u * u * m0.x + 2 * u * t * c.x + t * t * m1.x, y: u * u * m0.y + 2 * u * t * c.y + t * t * m1.y });
  }
  return { points, lead: 3 };
}

/**
 * Control points for a polyline's cubic vertices (null for the others, and for an open
 * polyline's ends), as Vectorworks places them: each starts on its vertex, then CUBIC_ROUNDS
 * rounds move them all at once by 4/3 of the gap between the vertex and the point the curve
 * passes at the middle of its bend. Bezier neighbours stay where they are.
 */
function solveCubic(verts: readonly Vertex[], closed: boolean): (Pt | null)[] {
  const n = verts.length;
  const end = (i: number) => !closed && (i === 0 || i === n - 1);
  let c: (Pt | null)[] = verts.map((v, i) => (v.kind === CUBIC && !end(i) ? v.p : null));
  const at = (i: number): Pt => c[i] ?? verts[i].p;
  for (let round = 0; round < CUBIC_ROUNDS; round++) {
    c = c.map((ci, i) => {
      if (!ci) return null;
      const ip = (i - 1 + n) % n;
      const inx = (i + 1) % n;
      const m0 = smooth(verts[ip]) ? midpoint(at(ip), ci) : verts[ip].p;
      const m1 = smooth(verts[inx]) ? midpoint(at(inx), ci) : verts[inx].p;
      const v = verts[i].p;
      const k = 4 / 3;
      return { x: ci.x + k * (v.x - (m0.x + 2 * ci.x + m1.x) / 4), y: ci.y + k * (v.y - (m0.y + 2 * ci.y + m1.y) / 4) };
    });
  }
  return c;
}

/** The control points cubic vertices get when written (null for other vertices and open ends). */
export function cubicControls(points: readonly Pt[], kinds: readonly VertexKind[], closed: boolean): (Pt | null)[] {
  return solveCubic(points.map((p, i) => ({ p, kind: VERTEX_CODE[kinds[i] ?? "corner"], visible: true, radius: 0 })), closed);
}

/** A fillet's arc as drawn: from where it leaves the edge before its vertex to where it meets the edge after, about `centre`. */
export interface FilletArc {
  from: Pt;
  to: Pt;
  centre: Pt;
  r: number;
  /** radians, counterclockwise positive */
  sweep: number;
}

/** The fillet at v, or null when its edges run straight on or double back. `prevBends`/`nextBends` halve the room on that edge. */
function filletArc(prev: Vertex, v: Vertex, next: Vertex, prevBends: boolean, nextBends: boolean): FilletArc | null {
  const la = Math.hypot(prev.p.x - v.p.x, prev.p.y - v.p.y);
  const lb = Math.hypot(next.p.x - v.p.x, next.p.y - v.p.y);
  if (!(la > 0 && lb > 0)) return null;
  const ua = { x: (prev.p.x - v.p.x) / la, y: (prev.p.y - v.p.y) / la };
  const ub = { x: (next.p.x - v.p.x) / lb, y: (next.p.y - v.p.y) / lb };
  // half the angle between the edges at the corner
  const half = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y))) / 2;
  if (!(half > 1e-6 && half < Math.PI / 2 - 1e-6)) return null;
  const room = Math.min(prevBends ? la / 2 : la, nextBends ? lb / 2 : lb);
  // how far back along each edge the arc meets it
  const t = Math.min(room, v.radius > 0 ? v.radius / Math.tan(half) : room);
  const r = t * Math.tan(half);
  const bis = { x: ua.x + ub.x, y: ua.y + ub.y };
  const lbis = Math.hypot(bis.x, bis.y);
  const d = r / Math.sin(half);
  const centre = { x: v.p.x + (bis.x / lbis) * d, y: v.p.y + (bis.y / lbis) * d };
  // the arc turns the short way, through the angle the corner cuts off
  const turn = ua.x * ub.y - ua.y * ub.x > 0 ? -1 : 1;
  return {
    from: { x: v.p.x + ua.x * t, y: v.p.y + ua.y * t },
    to: { x: v.p.x + ub.x * t, y: v.p.y + ub.y * t },
    centre,
    r,
    sweep: turn * (Math.PI - 2 * half),
  };
}

/** A fillet at v drawn as points, or null when it isn't drawn. */
function filletBend(prev: Vertex, v: Vertex, next: Vertex, prevBends: boolean, nextBends: boolean): Bend | null {
  const f = filletArc(prev, v, next, prevBends, nextBends);
  if (!f) return null;
  const { centre: c, r, sweep } = f;
  const a0 = Math.atan2(f.from.y - c.y, f.from.x - c.x);
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) * ARC_POINTS_PER_RADIAN));
  const points: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a0 + (sweep * k) / steps;
    points.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return { points, lead: Math.ceil(steps / 2) };
}

/**
 * The arc each of a polyline's fillet vertices is drawn with, as flattenPolyline draws it: null for
 * its other vertices, an open polyline's ends, and fillets whose edges run straight on.
 */
export function filletArcs(vertices: readonly { p: Pt; kind: VertexKind; radius?: number }[], closed: boolean): (FilletArc | null)[] {
  const verts = vertices.map((v) => ({ p: v.p, kind: VERTEX_CODE[v.kind], visible: true, radius: v.radius ?? 0 }));
  const n = verts.length;
  const end = (i: number) => !closed && (i === 0 || i === n - 1);
  const bends = (i: number) => !end(i) && (verts[i].kind === BEZIER || verts[i].kind === CUBIC || verts[i].kind === FILLET);
  return verts.map((v, i) =>
    v.kind === FILLET && !end(i) ? filletArc(verts[(i - 1 + n) % n], v, verts[(i + 1) % n], bends((i - 1 + n) % n), bends((i + 1) % n)) : null,
  );
}

/** The arc from a through b to c, without its ends, or null when the three are in line. */
function throughBend(a: Pt, b: Pt, c: Pt): Bend | null {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  // the circumcentre
  const det = 2 * cross;
  const span = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
  if (!(Math.abs(cross) > 1e-9 * span * span)) return null;
  const centre = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / det,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / det,
  };
  const r = Math.hypot(a.x - centre.x, a.y - centre.y);
  const angle = (p: Pt) => Math.atan2(p.y - centre.y, p.x - centre.x);
  // counterclockwise when a, b, c turn left
  const dir = cross > 0 ? 1 : -1;
  const around = (from: number, to: number) => {
    const s = ((to - from) * dir) % (2 * Math.PI);
    return s < 0 ? s + 2 * Math.PI : s;
  };
  const a0 = angle(a);
  const total = around(a0, angle(c));
  const atB = around(a0, angle(b));
  const steps = Math.max(2, Math.ceil(total * ARC_POINTS_PER_RADIAN));
  const points: Pt[] = [];
  let lead = 0;
  for (let k = 1; k < steps; k++) {
    const s = (total * k) / steps;
    if (s < atB) lead++;
    points.push({ x: centre.x + r * Math.cos(a0 + dir * s), y: centre.y + r * Math.sin(a0 + dir * s) });
  }
  return { points, lead };
}

/** An image shape's picture: its bytes, or (for one left in its file as a big drawing opened) read back from there. */
export async function imageBytes(shape: Shape): Promise<Uint8Array | null> {
  if (!shape.heldImage) return shape.image ?? null;
  const bytes = await heldEntry(shape.heldImage).read();
  return shape.heldImage.clear ? clearWhite(bytes) : bytes;
}

/** image record: where the QuickTime image description starts, and where a plain one ends */
const IMAGE_DESC = 0x13a;
const IMAGE_DATA = 0x190;
/** the description's pixel depth (32, or 8 for a picture with a colour table) */
const IMAGE_DEPTH = 0x18c;

/**
 * `png` with its palette's white entries clear (a tRNS chunk after its PLTE), as Vectorworks draws an
 * 8-bit picture whose fill is none; unchanged when it isn't a palette PNG, already says what is clear
 * or has no white.
 */
function clearWhite(png: Uint8Array): Uint8Array {
  if (png.length < 33 || png[25] !== 3) return png;
  let plte = -1;
  for (let at = 8; at + 12 <= png.length; ) {
    const len = u32be(png, at);
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    if (type === "tRNS") return png;
    if (type === "PLTE") plte = at;
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + len;
  }
  if (plte < 0) return png;
  const entries = Math.floor(u32be(png, plte) / 3);
  const alpha: number[] = [];
  for (let k = 0; k < entries; k++) {
    const c = plte + 8 + 3 * k;
    alpha.push(png[c] === 255 && png[c + 1] === 255 && png[c + 2] === 255 ? 0 : 255);
  }
  const last = alpha.lastIndexOf(0);
  if (last < 0) return png;
  // length, "tRNS", an alpha per entry up to the last clear one (the rest stay opaque), CRC
  const chunk = new Uint8Array(12 + last + 1);
  setU32be(chunk, 0, last + 1);
  chunk.set([0x74, 0x52, 0x4e, 0x53], 4);
  chunk.set(alpha.slice(0, last + 1), 8);
  setU32be(chunk, 8 + last + 1, crc32(chunk.subarray(4, 8 + last + 1)));
  const end = plte + 12 + u32be(png, plte);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, end));
  out.set(chunk, end);
  out.set(png.subarray(end), end + chunk.length);
  return out;
}

function startsWith(b: Uint8Array, sig: number[]): boolean {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (b[i] !== sig[i]) return false;
  }
  return true;
}

/** Decode a drawable record into a Shape, or null for anything else. */
export function decodeShape(rec: Rec): Shape | null {
  const d = rec.data;
  switch (rec.type) {
    case 2: {
      // line: (y1, x1) at +0x68, (y2, x2) at +0x78
      const points = [pointAt(d, 0x68), pointAt(d, 0x78)];
      return { kind: "line", points, closed: false, bbox: bboxOfPoints(points) };
    }
    case 17: {
      // 2D locus: (y, x) at +0x68, laid out as a line's first point
      if (d.length < 0x78) return null;
      const points = [pointAt(d, 0x68)];
      return { kind: "locus", points, closed: false, bbox: bboxOfPoints(points) };
    }
    case LIGHT: {
      // light object: at its position (x, y), drawn at a fixed screen size, pointing where it shines in plan
      if (d.length < LIGHT_END) return null;
      const kind = LIGHT_KINDS[u16(d, LIGHT_KIND)];
      const at = { x: f64(d, LIGHT_AT), y: f64(d, LIGHT_AT + 8) };
      const a = lightAim(d);
      const aim = [f64(d, a), f64(d, a + 8), f64(d, a + 16)];
      if (!kind || ![at.x, at.y, ...aim].every(Number.isFinite)) return null;
      const length = Math.hypot(...aim);
      // seen from above: shorter the steeper it shines, nothing straight down
      const plan = length > 0 ? { x: aim[0] / length, y: aim[1] / length } : { x: 0, y: 0 };
      const points = [at];
      return { kind: "light", points, closed: false, bbox: bboxOfPoints(points), light: { kind, on: d[LIGHT_ON] !== 0, aim: plan } };
    }
    case 3: {
      // rectangle: frame (origin, rotation, size), see readRectFrame
      const b = bboxAt(d);
      const r = rectFrameIn(rec);
      if (!b || !r) return null;
      const points = rectCorners(r);
      // a stale bbox (see rectFrameIn) gives way to the frame's
      return { kind: "rect", points, closed: true, bbox: frameMatches(r, b) ? b : (bboxOfPoints(points) ?? b) };
    }
    case 13: {
      // rounded rectangle: a rectangle's frame, then f64 corner diameters (y, x) at +0xbc / +0xc4.
      // Drawn as its outline; editing its geometry stays with the type-3 rectangle.
      const b = bboxAt(d);
      const r = rectFrameOf(d);
      if (!b || !r || d.length < 0xcc) return null;
      const rx = Math.max(0, Math.min(f64(d, 0xc4) / 2, r.w / 2));
      const ry = Math.max(0, Math.min(f64(d, 0xbc) / 2, r.h / 2));
      return { kind: "polygon", points: roundedRectPoints(r, rx, ry), closed: true, bbox: b, roundRect: { corners: rectCorners(r), rx, ry } };
    }
    case 5: {
      // polygon: u8 closed at +0x8d, u16 n at +0x8e, n x (y, x) at +0x90. Bounds come from the
      // vertices, as for polylines: the stored ones can lie elsewhere (a sloped slab's faces)
      const n = u16(d, 0x8e);
      const points: Pt[] = [];
      for (let i = 0; i < n; i++) points.push(pointAt(d, 0x90 + 16 * i));
      return { kind: "polygon", points, closed: d[0x8d] !== 0, bbox: bboxOfPoints(points) ?? bboxAt(d) };
    }
    case 9: {
      // 3D locus, as plan sees it: (x, y, z) at +0x66, ending the record
      if (d.length < 0x7e) return null;
      const points = [{ x: f64(d, 0x66), y: f64(d, 0x6e) }];
      return { kind: "locus", points, closed: false, bbox: bboxOfPoints(points) };
    }
    case 25: {
      // 3D polygon, as plan sees it: u8 closed at +0x8d, u16 n at +0xd0, n x (x, y, z) at +0xd2
      if (d.length < 0xd2) return null;
      const n = u16(d, 0xd0);
      if (n < 2 || 0xd2 + 24 * n > d.length) return null;
      const points: Pt[] = [];
      for (let i = 0; i < n; i++) points.push({ x: f64(d, 0xd2 + 24 * i), y: f64(d, 0xd2 + 24 * i + 8) });
      if (!points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return null;
      return { kind: "polygon", points, closed: d[0x8d] !== 0 && n >= 3, bbox: bboxOfPoints(points) ?? bboxAt(d) };
    }
    case 21: {
      // polyline: 36-byte vertices (y, x, u32 kind word, f64 radius, f64)
      const n = u16(d, 0x8e);
      const verts: Vertex[] = [];
      for (let i = 0; i < n; i++) {
        const off = 0x90 + 36 * i;
        const word = u32(d, off + 16);
        const kind = (word >>> 8) & 0xff;
        const v: Vertex = { p: pointAt(d, off), kind, visible: (word & POLYLINE_EDGE_VISIBLE) !== 0, radius: kind === CUBIC ? 0 : f64(d, off + 20) };
        if (kind === CUBIC) {
          const c = pointAt(d, off + 20);
          if (Number.isFinite(c.x) && Number.isFinite(c.y) && (c.x !== 0 || c.y !== 0)) v.control = c;
        }
        verts.push(v);
      }
      const closed = d[0x8d] !== 0;
      const { points, hidden } = flattenPolyline(verts, closed);
      return {
        kind: "polyline",
        points,
        closed,
        bbox: bboxOfPoints(points) ?? bboxAt(d),
        ...(hidden.length ? { hidden } : {}),
        vertices: verts.map((v) => ({ p: v.p, kind: KIND_OF_CODE[v.kind] ?? "corner", radius: v.radius })),
      };
    }
    case 6: {
      // arc / circle: centre (y, x) at +0xb0, QuickDraw start and sweep at +0xc0 / +0xc8
      const b = bboxAt(d);
      if (!b) return null;
      const qdStart = f64(d, 0xc0);
      const qdSweep = f64(d, 0xc8);
      return {
        kind: "arc",
        points: [],
        closed: false,
        bbox: b,
        center: pointAt(d, 0xb0),
        rx: (b.x1 - b.x0) / 2,
        ry: (b.y1 - b.y0) / 2,
        startAngle: 90 - qdStart,
        sweepAngle: -qdSweep,
      };
    }
    case 10: {
      // text: u16 character count at +0xf6, UTF-16LE characters at the end of the record
      const n = u16(d, 0xf6);
      if (!n || 2 * n > d.length - 0xf8) return null;
      const text = readUtf16(d, d.length - 2 * n, 2 * n);
      const f = readTextFrame(d, text);
      const face = textFaceAt(d);
      const style = u16(d, face + 2);
      const textStyle = textStyleAt(d) + 4 <= d.length ? i32(d, textStyleAt(d)) : 0;
      return {
        kind: "text",
        points: [],
        closed: false,
        bbox: bboxAt(d),
        text,
        lines: storedLines(d, text) ?? undefined,
        anchor: f.o,
        textSize: f.size,
        textAngle: (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI,
        hAlign: f.hAlign,
        vAlign: f.vAlign,
        fontIndex: u16(d, face),
        ...(textStyle ? { textStyle } : {}),
        ...(style & TEXT_BOLD ? { bold: true } : {}),
        ...(style & TEXT_ITALIC ? { italic: true } : {}),
        ...(style & TEXT_UNDERLINE ? { underline: true } : {}),
      };
    }
    case 14: {
      // image: a QuickTime image description at +0x13a (its u32 size first), then the PNG or
      // JPEG stream to the end of the record. The description is 0x56 bytes, so the stream
      // starts at +0x190, unless an 8-bit picture's colour table follows it (size 0x85e)
      const desc = d.length >= IMAGE_DESC + 4 ? IMAGE_DESC + u32(d, IMAGE_DESC) : 0;
      const start = desc > IMAGE_DATA && desc < d.length ? desc : IMAGE_DATA;
      const shape: Shape = { kind: "image", points: [], closed: false, bbox: bboxAt(d) };
      // an 8-bit picture with no fill shows its white as clear
      const clear = (): boolean => d.length >= IMAGE_DEPTH + 2 && u16(d, IMAGE_DEPTH) <= 8 && readAttrs(d)?.fillPattern === 0;
      const held = heldPart(d);
      if (held?.at === start) {
        // left in the file (held.ts): imageBytes() reads it, and `image` has it while withHeldImages runs
        const mime = mimeName(held.ref.mime);
        if (!mime) return shape;
        const ref = { ...held.ref, clear: mime === "image/png" && clear() };
        let memo: [Uint8Array, Uint8Array] | null = null;
        shape.heldImage = ref;
        shape.imageMime = mime;
        Object.defineProperty(shape, "image", {
          enumerable: true,
          configurable: true,
          get(): Uint8Array | undefined {
            const bytes = loadedImage(ref);
            if (!bytes || !ref.clear) return bytes;
            if (memo?.[0] !== bytes) memo = [bytes, clearWhite(bytes)];
            return memo[1];
          },
          set(value: Uint8Array | undefined): void {
            Object.defineProperty(shape, "image", { value, enumerable: true, configurable: true, writable: true });
          },
        });
        return shape;
      }
      // a view of the record's bytes, not a copy: a record is never changed in place
      const blob = d.subarray(start);
      if (startsWith(blob, [0x89, 0x50, 0x4e, 0x47])) {
        shape.image = clear() ? clearWhite(blob) : blob;
        shape.imageMime = "image/png";
      } else if (startsWith(blob, [0xff, 0xd8])) {
        shape.image = blob;
        shape.imageMime = "image/jpeg";
      }
      return shape;
    }
    default:
      return null;
  }
}
