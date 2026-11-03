// Geometry writers: move records and re-encode their coordinates.
//
// Conventions are those of geometry.ts: points (y, x), boxes (top, left,
// bottom, right) with y up, arc angles in QuickDraw degrees. Every function
// here either mutates a buffer the caller owns or returns a new buffer.

import { concat, encodeUtf16, f64, readUtf16, setF64, setI32, setU16, setU64, u16, u32, setU32 } from "./bytes.ts";
import {
  LIGHT,
  LIGHT_AT,
  LIGHT_END,
  LIGHT_KIND,
  LIGHT_KINDS,
  LIGHT_ON,
  lightAim,
  type RectFrame,
  type TextFrame,
  TEXT_LINE_HEIGHT,
  VIEWPORT,
  VIEWPORT_BOX,
  VERTEX_CODE,
  VIEWPORT_SHIFT,
  WALL,
  WALL_HEIGHTS,
  WALL_LINE,
  bboxOfPoints,
  circumradius,
  cubicControls,
  decodeShape,
  rectFrameOf,
  readTextFrame,
  rectCorners,
  textCorners,
  TEXT_BOLD,
  TEXT_ITALIC,
  TEXT_UNDERLINE,
  textFaceAt,
  textSizeAt,
  TEXT_STYLE_BY_CLASS,
  textStyleAt,
  textTop,
  viewportScale,
} from "./geometry.ts";
import { Rec } from "./records.ts";
import { IMAGE_FRAME, WORKSHEET_IMAGE } from "./worksheet.ts";
import type { Affine, BBox, NewShape, Pt, TextStyle, VertexKind } from "./types.ts";

const NO_BOUNDS = 1e300;

export function readBBox(d: Uint8Array, off = 0x68): BBox | null {
  if (off === 0x68 && d[0x19] === LOCUS3D && d.length >= LOCUS3D_LENGTH) {
    const [x, y] = [f64(d, LOCUS3D_AT), f64(d, LOCUS3D_AT + 8)];
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < NO_BOUNDS && Math.abs(y) < NO_BOUNDS ? { x0: x, y0: y, x1: x, y1: y } : null;
  }
  // a locus has no bounds field: its point is all of it
  if (off === 0x68 && d[0x19] === LOCUS && d.length >= LOCUS_LENGTH) {
    const p = { x: f64(d, 0x70), y: f64(d, 0x68) };
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < NO_BOUNDS && Math.abs(p.y) < NO_BOUNDS ? { x0: p.x, y0: p.y, x1: p.x, y1: p.y } : null;
  }
  if (d.length < off + 32) return null;
  const top = f64(d, off);
  const left = f64(d, off + 8);
  const bottom = f64(d, off + 16);
  const right = f64(d, off + 24);
  if (![top, left, bottom, right].every((v) => Number.isFinite(v) && Math.abs(v) < NO_BOUNDS)) return null;
  return {
    x0: Math.min(left, right),
    y0: Math.min(top, bottom),
    x1: Math.max(left, right),
    y1: Math.max(top, bottom),
  };
}

export function writeBBox(d: Uint8Array, b: BBox, off = 0x68): void {
  // its point is all it has
  if (d[0x19] === LOCUS3D) return;
  setF64(d, off, b.y1);
  setF64(d, off + 8, b.x0);
  setF64(d, off + 16, b.y0);
  setF64(d, off + 24, b.x1);
}

function writePt(d: Uint8Array, off: number, p: Pt): void {
  setF64(d, off, p.y);
  setF64(d, off + 8, p.x);
}

function bboxOf(pts: Pt[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function checkPts(pts: Pt[], min: number): void {
  if (pts.length < min) throw new Error(`need at least ${min} points`);
  if (pts.length > 0xffff) throw new Error("too many points");
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("point is not a finite number");
  }
}

/** Plug-in object (parametric); placement and drawing below at PLUGIN_MATRIX. */
export const PLUGIN = 86;

/** a 2D locus: the common header and attributes, then its point `(y, x)` at +0x68 */
export const LOCUS = 17;
/** a 3D locus: its point (x, y, z), f64 each, ends the record */
export const LOCUS3D = 9;
const LOCUS3D_AT = 0x66;
export const LOCUS3D_LENGTH = LOCUS3D_AT + 24;
export const LOCUS_LENGTH = 0x78;

/**
 * 3D objects placed by a frame of their own: extrudes, sweeps, multiple extrudes and solid
 * additions. Three rows at +0xcc (the images of the x, y and z axes) and an offset (x, y, z) at
 * +0x114 place them; their profile or operands and their 3D box are in that frame, and their 2D
 * bounds are that box's as the frame places it. The demo files' frames are all turns and mirrors.
 */
export const OWN_FRAME: ReadonlySet<number> = new Set([24, 34, 38, 84]);
const FRAME_ROWS = 0xcc;
const FRAME_OFFSET = 0x114;
/** a 3D box (x1, y1, z1, x0, y0, z0): groups', 3D polygons' and meshes' in their layer's frame, OWN_FRAME objects' in their own */
const BOX3D = 0x9c;
/** 3D polygon: u16 count at +0xd0, then (x, y, z) f64 from +0xd2, in its layer's or group's frame */
const POLY3D = 25;
const POLY3D_COUNT = 0xd0;
const POLY3D_VERTS = 0xd2;
/** mesh: u32 count at +0xd0, then a point every 28 bytes from +0xd4, (x, y, z) f64 first; its faces (41) number them */
const MESH = 40;
const MESH_COUNT = 0xd0;
const MESH_VERTS = 0xd4;
const MESH_VERT_SIZE = 28;
/** 3D objects translateRecord and transformRecord know. */
export const MOVABLE_3D: ReadonlySet<number> = new Set([...OWN_FRAME, POLY3D, MESH, LOCUS3D]);

/** a rectangle's frame (readRectFrame), then f64 corner diameters across (+0xbc) and along (+0xc4) it */
export const ROUNDED_RECT = 13;
const ROUNDED_ACROSS = 0xbc;
const ROUNDED_ALONG = 0xc4;
/** Types whose coordinates translateRecord and transformRecord know. */
export const MOVABLE = new Set([2, 3, ROUNDED_RECT, 5, 6, 10, 11, 14, 15, LOCUS, 21, ...MOVABLE_3D]);
const DIMENSION = 63;
/** a 3D body: a group holding one (a wall's 3D) caches its points in the group's coordinates */
const BODY = 114;
/**
 * A slab or roof face (FORMAT.md §4): its plan box, then three plan points stored (y, x) from
 * SLAB_POINTS (a roof face's eave line and a point up its slope), its thickness, and two heights
 * (z above its layer) at SLAB_HEIGHTS. Its body (114) is an aux child, in its parent's coordinates.
 */
export const SLAB = 71;
const SLAB_POINTS = [0x9c, 0xac, 0xbc] as const;
export const SLAB_THICKNESS = 0xcc;
const SLAB_HEIGHTS = [0xd4, 0xf8] as const;
export const SLAB_END = 0x100;
/** Types a move can also take: their coordinates are known to translateRecord only. */
export const TRANSLATABLE = new Set([...MOVABLE, DIMENSION, PLUGIN, VIEWPORT, WORKSHEET_IMAGE, LIGHT, WALL, BODY, SLAB]);
/**
 * Types transformRecord also takes under a turn or mirror (keepsFrame), not a scale: walls, with
 * the bodies their groups cache, plug-in objects (a mirror flips their matrix, as Vectorworks
 * saves mirrored doors, windows and tags) and slabs.
 */
export const TURNABLE: ReadonlySet<number> = new Set([WALL, BODY, PLUGIN, SLAB]);

/** False where a record's children are in its own coordinates, so moving it leaves them as they are. */
export function childrenMoveWith(type: number): boolean {
  // a mesh's faces only number its points
  return type !== VIEWPORT && type !== PLUGIN && !OWN_FRAME.has(type) && type !== MESH;
}

const EXTRUDE = 24;

/**
 * An OWN_FRAME object's frame as plan sees it: where the points of its own z = 0 plane land, or
 * for an extrude, those of the plane its body starts from, where its profile is in 3D. Exact for an
 * upright frame; a tilted one's profile comes out squashed, in its place. Null when unreadable.
 */
export function planFrame(d: Uint8Array, type: number): Affine | null {
  if (!OWN_FRAME.has(type) || d.length < FRAME_OFFSET + 24) return null;
  const v = (at: number): number => f64(d, at);
  const start = type === EXTRUDE ? v(BOX3D + 40) : 0;
  const z = Number.isFinite(start) && Math.abs(start) < NO_BOUNDS ? start : 0;
  const m = {
    a: v(FRAME_ROWS),
    b: v(FRAME_ROWS + 8),
    c: v(FRAME_ROWS + 24),
    d: v(FRAME_ROWS + 32),
    e: v(FRAME_OFFSET) + z * v(FRAME_ROWS + 48),
    f: v(FRAME_OFFSET + 8) + z * v(FRAME_ROWS + 56),
  };
  return Object.values(m).every(Number.isFinite) ? m : null;
}

/** Where a 3D polygon's, mesh's or 3D locus's points start, how many there are and how far apart; null when they don't fit the record. */
function points3d(d: Uint8Array, type: number): { at: number; n: number; size: number } | null {
  if (type === LOCUS3D) return d.length >= LOCUS3D_LENGTH ? { at: LOCUS3D_AT, n: 1, size: 24 } : null;
  const [n, at, size] = type === POLY3D ? [d.length >= POLY3D_VERTS ? u16(d, POLY3D_COUNT) : 0, POLY3D_VERTS, 24] : [d.length >= MESH_VERTS ? u32(d, MESH_COUNT) : 0, MESH_VERTS, MESH_VERT_SIZE];
  return d.length >= at && at + size * n <= d.length ? { at, n, size } : null;
}

/**
 * Raises one record by dz (mm) in 3D: an extrude's or solid's frame, a 3D polygon's or mesh's
 * points and 3D box, a group's 3D box, a symbol instance's or plug-in's z offset, a light's height. What a record
 * holds in its own frame or coordinates goes up with it; 2D objects have no height and stay.
 * A `bareSolid` (a solid addition holding nothing, its frame bare, as a wall's are) keeps its frame,
 * as transformBareSolid does, and raises its 3D box; its body goes up with its parent's points.
 */
export function liftRecord(d: Uint8Array, type: number, dz: number, bareSolid = false): void {
  const tz = (off: number): void => setF64(d, off, f64(d, off) + dz);
  const box3d = (): void => {
    if (d.length < BOX3D + 48 || Math.abs(f64(d, BOX3D + 16)) >= NO_BOUNDS) return;
    tz(BOX3D + 16);
    tz(BOX3D + 40);
  };
  if (bareSolid) {
    box3d();
  } else if (OWN_FRAME.has(type)) {
    if (d.length >= FRAME_OFFSET + 24) tz(FRAME_OFFSET + 16);
  } else if (type === POLY3D || type === MESH || type === LOCUS3D) {
    const pts = points3d(d, type);
    if (!pts) return;
    for (let i = 0; i < pts.n; i++) tz(pts.at + pts.size * i + 16);
    box3d();
  } else if (type === 11) {
    box3d();
  } else if (type === 15) {
    if (d.length >= SYMBOL_MATRIX + 96) tz(SYMBOL_MATRIX + 88);
  } else if (type === PLUGIN) {
    if (d.length >= PLUGIN_MATRIX + 96) tz(PLUGIN_MATRIX + 88);
  } else if (type === LIGHT) {
    if (d.length >= LIGHT_AT + 24) tz(LIGHT_AT + 16);
  } else if (type === WALL) {
    if (d.length >= WALL_HEIGHTS[WALL_HEIGHTS.length - 1] + 8) for (const off of WALL_HEIGHTS) tz(off);
  } else if (type === SLAB) {
    if (d.length >= SLAB_END) for (const off of SLAB_HEIGHTS) tz(off);
  } else if (type === BODY) {
    const at = bodySections(d)?.get(BODY_POINTS);
    if (at) for (let o = at[0]; o + 24 <= at[1]; o += 24) tz(o + 16);
  }
}

/**
 * Maps every height a wall's records store through f, for a wall given a new bottom and top: the
 * wall's six heights, the 3D boxes of its group of bodies and of its bare solid additions (84), and
 * its bodies' points. False for other kinds, which store none (its plan drawing) or aren't known.
 */
export function reheightRecord(d: Uint8Array, type: number, f: (z: number) => number): boolean {
  const map = (off: number): void => setF64(d, off, f(f64(d, off)));
  switch (type) {
    case WALL:
      if (d.length >= WALL_HEIGHTS[WALL_HEIGHTS.length - 1] + 8) for (const off of WALL_HEIGHTS) map(off);
      return true;
    case 11:
    case 84:
      if (d.length >= BOX3D + 48 && Math.abs(f64(d, BOX3D + 16)) < NO_BOUNDS) {
        map(BOX3D + 16);
        map(BOX3D + 40);
      }
      return true;
    case BODY: {
      const at = bodySections(d)?.get(BODY_POINTS);
      if (at) for (let o = at[0]; o + 24 <= at[1]; o += 24) map(o + 16);
      return true;
    }
    default:
      return false;
  }
}

/** Shift every stored coordinate of one record. Returns false for unknown types. */
export function translateRecord(d: Uint8Array, type: number, dx: number, dy: number): boolean {
  const ty = (off: number) => setF64(d, off, f64(d, off) + dy);
  const tx = (off: number) => setF64(d, off, f64(d, off) + dx);
  const box = (off = 0x68) => {
    if (Math.abs(f64(d, off)) >= NO_BOUNDS) return;
    ty(off);
    tx(off + 8);
    ty(off + 16);
    tx(off + 24);
  };
  const box3d = () => {
    if (Math.abs(f64(d, BOX3D)) >= NO_BOUNDS) return;
    tx(BOX3D);
    ty(BOX3D + 8);
    tx(BOX3D + 24);
    ty(BOX3D + 32);
  };
  switch (type) {
    case 2: // line: two points
      ty(0x68);
      tx(0x70);
      ty(0x78);
      tx(0x80);
      return true;
    case LOCUS: // its point
      ty(0x68);
      tx(0x70);
      return true;
    case LOCUS3D:
      tx(LOCUS3D_AT);
      ty(LOCUS3D_AT + 8);
      return true;
    case 3: // rectangle: bbox + bottom-left origin
    case ROUNDED_RECT: // laid out as a rectangle, corner sizes after
      box();
      ty(0x8c);
      tx(0x94);
      return true;
    case DIMENSION: // bbox and its two measured points; the drawing is its children
      box();
      ty(0x9e);
      tx(0xa6);
      ty(0xae);
      tx(0xb6);
      return true;
    case WALL: // bbox and its control line, laid out as a dimension's points; its drawing and 3D are its children
      if (d.length < WALL_LINE + 32) return false;
      box();
      ty(WALL_LINE);
      tx(WALL_LINE + 8);
      ty(WALL_LINE + 16);
      tx(WALL_LINE + 24);
      return true;
    case BODY: // a body in a group: its points, in the group's coordinates
      moveBodyPoints(d, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
      return true;
    case SLAB: // bbox and its plan points; its outline and components are its children, its body goes with it (BODY_IN_PARENT)
      if (d.length < SLAB_END) return false;
      box();
      for (const off of SLAB_POINTS) {
        ty(off);
        tx(off + 8);
      }
      return true;
    case WORKSHEET_IMAGE: // its bounds and the worksheet's frame
      box();
      box(IMAGE_FRAME);
      return true;
    case LIGHT: // bbox and its position; where it shines doesn't change
      if (d.length < LIGHT_AT + 24) return false;
      box();
      tx(LIGHT_AT);
      ty(LIGHT_AT + 8);
      return true;
    case PLUGIN: // bbox and the matrix translation; the drawing inside is in its own coordinates
      box();
      tx(PLUGIN_MATRIX + 72);
      ty(PLUGIN_MATRIX + 80);
      return true;
    case 5:
    case 21: {
      const stride = type === 5 ? 16 : 36;
      box();
      const n = u16(d, 0x8e);
      for (let i = 0; i < n; i++) {
        ty(0x90 + stride * i);
        tx(0x98 + stride * i);
        // a cubic vertex's control point (y, x) at +20
        if (type === 21 && isCubicAt(d, 0x90 + stride * i)) {
          ty(0x90 + stride * i + 20);
          tx(0x90 + stride * i + 28);
        }
      }
      return true;
    }
    case 6: // arc: bbox, start, end, centre
      box();
      for (const off of [0x90, 0xa0, 0xb0]) {
        ty(off);
        tx(off + 8);
      }
      return true;
    case 10: // text: bbox + origin
      box();
      ty(0xa8);
      tx(0xb0);
      return true;
    case 14: // image: bbox + top-left origin stored (x, y)
      box();
      tx(0xd4);
      ty(0xdc);
      return true;
    case 11: // group: cached 2D bbox and a 3D bbox stored (x, y, z) x 2
      box();
      box3d();
      return true;
    case 24:
    case 34:
    case 38:
    case 84: // OWN_FRAME: its 2D bounds and its frame's offset; what it holds is in the frame
      if (d.length < FRAME_OFFSET + 24) return false;
      box();
      tx(FRAME_OFFSET);
      ty(FRAME_OFFSET + 8);
      return true;
    case POLY3D:
    case MESH: {
      // their points (x, y, z) and both boxes
      const pts = points3d(d, type);
      if (!pts) return false;
      box();
      box3d();
      for (let i = 0; i < pts.n; i++) {
        tx(pts.at + pts.size * i);
        ty(pts.at + pts.size * i + 8);
      }
      return true;
    }
    case 15: // symbol instance: cached bbox plus the matrix translation
      box();
      tx(SYMBOL_MATRIX + 72);
      ty(SYMBOL_MATRIX + 80);
      return true;
    case VIEWPORT: {
      // crop box on the sheet, and the shift that places the drawing (in view units)
      const s = viewportScale(d);
      if (s === null) return false;
      box(VIEWPORT_BOX);
      setF64(d, VIEWPORT_SHIFT, f64(d, VIEWPORT_SHIFT) + dx * s);
      setF64(d, VIEWPORT_SHIFT + 8, f64(d, VIEWPORT_SHIFT + 8) + dy * s);
      return true;
    }
    default:
      return false;
  }
}

// ---- affine transforms ---------------------------------------------------

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/**
 * How an object lays its hatch, tile or gradient (a type-121 child): three points stored (y, x)
 * at +0x50, +0x60, +0x70, in the object's coordinates, and at +0x86 a u16 gradient shape.
 */
export const FILL_MAPPING = 121;
const FILL_MAPPING_POINTS = [0x50, 0x60, 0x70];
const FILL_MAPPING_SHAPE = 0x86;

/** The mapping's origin and axis ends (x, y) and its gradient shape, or null when it isn't finite. */
export function readFillMapping(d: Uint8Array): { points: Pt[]; shape: number } | null {
  if (d.length < FILL_MAPPING_SHAPE + 2) return null;
  const points = FILL_MAPPING_POINTS.map((o) => ({ x: f64(d, o + 8), y: f64(d, o) }));
  if (!points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return null;
  return { points, shape: u16(d, FILL_MAPPING_SHAPE) };
}

/** Writes a mapping record's origin and axis ends (object coordinates) and, when given, its gradient shape. */
export function writeFillMapping(d: Uint8Array, points: readonly Pt[], shape?: number): void {
  points.forEach((q, i) => {
    setF64(d, FILL_MAPPING_POINTS[i], q.y);
    setF64(d, FILL_MAPPING_POINTS[i] + 8, q.x);
  });
  if (shape !== undefined) setU16(d, FILL_MAPPING_SHAPE, shape);
}

/** Carry a mapping record through m with its object, in place. */
export function transformFillMapping(d: Uint8Array, m: Affine): void {
  const map = readFillMapping(d);
  if (!map) return;
  map.points.forEach((q, i) => {
    const t = applyAffine(m, q);
    setF64(d, FILL_MAPPING_POINTS[i], t.y);
    setF64(d, FILL_MAPPING_POINTS[i] + 8, t.x);
  });
}

/** `outer` after `inner`. */
export function composeAffine(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function isIdentity(m: Affine): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/**
 * Symbol instance placement (type 15): a 4 x 3 matrix of f64 rows at +0x96,
 * the 3 x 3 linear part (row vectors: x' = x·m00 + y·m10) then the
 * translation (x, y, z). Identity with zero translation in the sample, where
 * definitions sit at their world position.
 */
export const SYMBOL_MATRIX = 0x96;

export function readInstanceMatrix(d: Uint8Array): Affine {
  const at = (row: number, col: number) => f64(d, SYMBOL_MATRIX + 24 * row + 8 * col);
  return { a: at(0, 0), b: at(0, 1), c: at(1, 0), d: at(1, 1), e: at(3, 0), f: at(3, 1) };
}

/**
 * How a symbol instance is scaled, apart from its matrix: +0xfe u16 (1 not at all, 2 symmetric, 3
 * asymmetric), then its x, y and z factors (f64, 1 in nearly all the demos' instances) at +0x100,
 * in the symbol's own frame. A Spotlight fixture key holds its fixture's symbol at 0.05 with the
 * matrix left as it was.
 */
const SCALE_KIND = 0xfe;
const SYMBOL_SCALE = 0x100;

/** A symbol instance's x, y and z scale factors: [1, 1, 1] when it isn't scaled. */
export function instanceScale(d: Uint8Array): [number, number, number] {
  if (d.length < SYMBOL_SCALE + 24) return [1, 1, 1];
  const kind = u16(d, SCALE_KIND);
  const s: [number, number, number] = [f64(d, SYMBOL_SCALE), f64(d, SYMBOL_SCALE + 8), f64(d, SYMBOL_SCALE + 16)];
  return (kind === 2 || kind === 3) && s.every((v) => Number.isFinite(v) && v !== 0) ? s : [1, 1, 1];
}

/** Where a symbol instance draws its definition: its scale, then its matrix (readInstanceMatrix is the matrix alone, as edits write it back). */
export function readInstancePlacement(d: Uint8Array): Affine {
  const m = readInstanceMatrix(d);
  const [sx, sy] = instanceScale(d);
  return sx === 1 && sy === 1 ? m : { ...m, a: m.a * sx, b: m.b * sx, c: m.c * sy, d: m.d * sy };
}

/**
 * Plug-in object placement (type 86): the same 4 x 3 matrix as a symbol
 * instance's, at +0xf0 in 2023-2026 files. The plug-in's cached drawing (its
 * child objects) is in the plug-in's own coordinates; its 3D body is not.
 */
export const PLUGIN_MATRIX = 0xf0;

/** A plug-in object's placement, or the identity when the record holds none. */
export function readPluginMatrix(d: Uint8Array): Affine {
  if (PLUGIN_MATRIX + 96 > d.length) return IDENTITY;
  const at = (row: number, col: number) => f64(d, PLUGIN_MATRIX + 24 * row + 8 * col);
  const m = { a: at(0, 0), b: at(0, 1), c: at(1, 0), d: at(1, 1), e: at(3, 0), f: at(3, 1) };
  const det = m.a * m.d - m.b * m.c;
  return Object.values(m).every(Number.isFinite) && Math.abs(det) > 1e-9 ? m : IDENTITY;
}

export function writeInstanceMatrix(d: Uint8Array, m: Affine): void {
  const put = (row: number, col: number, v: number) => setF64(d, SYMBOL_MATRIX + 24 * row + 8 * col, clean(v));
  put(0, 0, m.a);
  put(0, 1, m.b);
  put(1, 0, m.c);
  put(1, 1, m.d);
  put(3, 0, m.e);
  put(3, 1, m.f);
}

/**
 * A new symbol instance's whole placement: unturned at `at`, at z 0 on its layer and at full size.
 * An instance copied from the drawing's may be raised, tilted or scaled in z, which
 * writeInstanceMatrix (plan only) would leave as it was.
 */
export function writePlacement(d: Uint8Array, at: Pt): void {
  [1, 0, 0, 0, 1, 0, 0, 0, 1, at.x, at.y, 0].forEach((v, i) => setF64(d, SYMBOL_MATRIX + 8 * i, v));
  if (d.length >= SYMBOL_SCALE + 24) for (let i = 0; i < 3; i++) setF64(d, SYMBOL_SCALE + 8 * i, 1);
}

/** Linear part only (directions and offsets). */
function applyLinear(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y };
}

/** True when the transform keeps angles: rotation, mirror and uniform scale. */
export function isSimilarity(m: Affine): boolean {
  const n1 = m.a * m.a + m.b * m.b;
  const n2 = m.c * m.c + m.d * m.d;
  const eps = 1e-9 * Math.max(n1, n2);
  return Math.abs(n1 - n2) <= eps && Math.abs(m.a * m.c + m.b * m.d) <= eps;
}

/** Snap values a hair away from 0 or ±1 (cos 90° = 6e-17) to the exact value. */
function clean(v: number): number {
  for (const t of [0, 1, -1]) if (Math.abs(v - t) < 1e-12) return t;
  return v;
}

/**
 * An OWN_FRAME object carried through m: its frame turned and moved, its 2D bounds those of its
 * 3D box as the new frame places it. Only turns and mirrors keep a frame one.
 */
function transformFramed(d: Uint8Array, m: Affine): Uint8Array {
  if (!keepsFrame(m)) throw new Error("scaling solids isn't supported yet");
  if (d.length < FRAME_OFFSET + 24) throw new Error("this 3D object's placement isn't known");
  for (let i = 0; i < 3; i++) {
    const at = FRAME_ROWS + 24 * i;
    const q = applyLinear(m, { x: f64(d, at), y: f64(d, at + 8) });
    setF64(d, at, clean(q.x));
    setF64(d, at + 8, clean(q.y));
  }
  const t = applyAffine(m, { x: f64(d, FRAME_OFFSET), y: f64(d, FRAME_OFFSET + 8) });
  setF64(d, FRAME_OFFSET, t.x);
  setF64(d, FRAME_OFFSET + 8, t.y);
  const placed = framedBox(d);
  if (placed) {
    writeBBox(d, placed);
  } else {
    const b = readBBox(d);
    if (b) writeBBox(d, bboxOf([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].map((p) => applyAffine(m, p))));
  }
  return d;
}

/** Three rows of a 3x3 matrix at `at` in d: when they are a turn (unit rows at right angles, not a mirror) and not the identity, the rows; else null. */
function turnRows(d: Uint8Array, at: number): number[][] | null {
  const rows = [0, 1, 2].map((i) => [0, 1, 2].map((k) => f64(d, at + 24 * i + 8 * k)));
  if (!rows.flat().every(Number.isFinite)) return null;
  const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(dot(rows[i], rows[j]) - (i === j ? 1 : 0)) > 1e-6) return null;
  const [x, y, z] = rows;
  if (dot(x, [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]) < 0) return null;
  return rows.every((r, i) => r.every((v, k) => Math.abs(v - (i === k ? 1 : 0)) <= 1e-12)) ? null : rows;
}

const UNTURNED = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Unrotate 3D Objects: an OWN_FRAME object's frame turned back to the layer's axes, the middle of
 * its 3D box staying where it was, and its plan box following. Returns how a point in its
 * layer's frame moves with it (for a body cached there), or null, d untouched, when the frame
 * isn't turned, is mirrored or scaled, or isn't readable.
 */
export function unturnFrame(d: Uint8Array): ((p: readonly number[]) => number[]) | null {
  if (d.length < FRAME_OFFSET + 24) return null;
  const rows = turnRows(d, FRAME_ROWS);
  const t = [0, 1, 2].map((k) => f64(d, FRAME_OFFSET + 8 * k));
  const own = [0, 1, 2, 3, 4, 5].map((k) => f64(d, BOX3D + 8 * k));
  if (!rows || !t.every(Number.isFinite) || !own.every((v) => Number.isFinite(v) && Math.abs(v) < NO_BOUNDS)) return null;
  const mid = [0, 1, 2].map((k) => (own[k] + own[k + 3]) / 2);
  const placed = [0, 1, 2].map((k) => mid[0] * rows[0][k] + mid[1] * rows[1][k] + mid[2] * rows[2][k] + t[k]);
  const moved = placed.map((v, k) => v - mid[k]);
  UNTURNED.forEach((v, i) => setF64(d, FRAME_ROWS + 8 * i, v));
  moved.forEach((v, k) => setF64(d, FRAME_OFFSET + 8 * k, v));
  const box = framedBox(d);
  if (box) writeBBox(d, box);
  // back into its own frame (the rows are at right angles), then out through the new one
  return (p) => [0, 1, 2].map((j) => (p[0] - t[0]) * rows[j][0] + (p[1] - t[1]) * rows[j][1] + (p[2] - t[2]) * rows[j][2] + moved[j]);
}

/**
 * Unrotate 3D Objects: a symbol instance's turn (in plan and in 3D) taken off about its insertion
 * point, its scale kept. False, d untouched, when it isn't turned or is mirrored or stretched.
 */
export function unturnInstance(d: Uint8Array): boolean {
  if (d.length < SYMBOL_MATRIX + 96 || !turnRows(d, SYMBOL_MATRIX)) return false;
  UNTURNED.forEach((v, i) => setF64(d, SYMBOL_MATRIX + 8 * i, v));
  return true;
}

/** A body's cached points (x, y, z) each carried through f, as unturnFrame's move. */
export function turnBodyPoints(d: Uint8Array, f: (p: readonly number[]) => number[]): void {
  const at = bodySections(d)?.get(BODY_POINTS);
  if (!at) return;
  for (let o = at[0]; o + 24 <= at[1]; o += 24) f([f64(d, o), f64(d, o + 8), f64(d, o + 16)]).forEach((v, k) => setF64(d, o + 8 * k, v));
}

/** A turn in 3D, as Rotate 3D gives it: `rows` the 3 × 3 matrix (unit rows at right angles), about the point `centre`. */
export interface Turn3D {
  readonly rows: readonly (readonly number[])[];
  readonly centre: readonly number[];
}

/** A direction (x, y, z) turned by t. */
function turnDirection(t: Turn3D, v: readonly number[]): number[] {
  return t.rows.map((r) => clean(r[0] * v[0] + r[1] * v[1] + r[2] * v[2]));
}

/** A point (x, y, z) carried round t's centre. */
export function turnPoint3D(t: Turn3D, p: readonly number[]): number[] {
  const c = t.centre;
  const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  return t.rows.map((r, i) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2] + c[i]);
}

/** The three axis rows and the offset of a placement at `rows` and `offset` turned by t; false, d untouched, when they aren't readable. */
function turnPlacement(d: Uint8Array, rows: number, offset: number, t: Turn3D): boolean {
  const axes = [0, 1, 2].map((i) => [0, 1, 2].map((k) => f64(d, rows + 24 * i + 8 * k)));
  const at = [0, 1, 2].map((k) => f64(d, offset + 8 * k));
  if (![...axes.flat(), ...at].every(Number.isFinite)) return false;
  axes.forEach((axis, i) => turnDirection(t, axis).forEach((v, k) => setF64(d, rows + 24 * i + 8 * k, v)));
  turnPoint3D(t, at).forEach((v, k) => setF64(d, offset + 8 * k, v));
  return true;
}

/**
 * Rotate 3D: an OWN_FRAME object's frame turned by t, its plan bounds following. Returns how a
 * point in its layer's frame moves (for a body cached there), or null, d untouched, when its
 * placement isn't readable.
 */
export function turnFrame3D(d: Uint8Array, t: Turn3D): ((p: readonly number[]) => number[]) | null {
  if (d.length < FRAME_OFFSET + 24 || !turnPlacement(d, FRAME_ROWS, FRAME_OFFSET, t)) return null;
  const box = framedBox(d);
  if (box) writeBBox(d, box);
  return (p) => turnPoint3D(t, p);
}

/** Rotate 3D: a symbol instance's placement (in plan and in 3D) turned by t, its scale kept; false, d untouched, when it isn't readable. Its plan bounds are the caller's. */
export function turnInstance3D(d: Uint8Array, t: Turn3D): boolean {
  return d.length >= SYMBOL_MATRIX + 96 && turnPlacement(d, SYMBOL_MATRIX, SYMBOL_MATRIX + 72, t);
}

/** Rotate 3D: a 3D polygon's or mesh's points turned by t, its 3D box and plan bounds following; false, d untouched, when they aren't readable. */
export function turnPoints3D(d: Uint8Array, type: number, t: Turn3D): boolean {
  const pts = points3d(d, type);
  if (!pts?.n) return false;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.n; i++) {
    const at = pts.at + pts.size * i;
    turnPoint3D(t, [f64(d, at), f64(d, at + 8), f64(d, at + 16)]).forEach((v, k) => {
      setF64(d, at + 8 * k, v);
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    });
  }
  if (d.length >= BOX3D + 48 && Math.abs(f64(d, BOX3D + 16)) < NO_BOUNDS) [...hi, ...lo].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
  const box = planBounds(d, type);
  if (box) writeBBox(d, box);
  return true;
}

/**
 * True when an OWN_FRAME object's frame is the layer's own (no turn, at the origin), as a wall's
 * solid additions' are: they hold nothing in it, their bodies being in the wall's coordinates.
 */
export function bareFrame(d: Uint8Array): boolean {
  if (d.length < FRAME_OFFSET + 24) return false;
  const rows = [1, 0, 0, 0, 1, 0, 0, 0, 1].every((v, i) => f64(d, FRAME_ROWS + 8 * i) === v);
  return rows && [0, 1, 2].every((i) => f64(d, FRAME_OFFSET + 8 * i) === 0);
}

/**
 * A solid addition with a bare frame and nothing in it carried through any m in plan, a stretch
 * included: the frame stays bare and its 3D box takes m by its corners (its body moves as its
 * parent's points do). Null for any other.
 */
export function transformBareSolid(src: Uint8Array, m: Affine): Uint8Array | null {
  if (!bareFrame(src) || src.length < BOX3D + 48) return null;
  const d = src.slice();
  if (Math.abs(f64(d, BOX3D)) < NO_BOUNDS) {
    const c = mapCorners({ x0: f64(d, BOX3D + 24), y0: f64(d, BOX3D + 32), x1: f64(d, BOX3D), y1: f64(d, BOX3D + 8) }, m);
    [c.x1, c.y1].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
    [c.x0, c.y0].forEach((v, k) => setF64(d, BOX3D + 24 + 8 * k, v));
  }
  const b = readBBox(d);
  if (b) writeBBox(d, mapCorners(b, m));
  return d;
}

/**
 * A record of the kinds a wall a new one copies is drawn with (lines, loci, polygons, polylines and
 * bodies) with each point moved by f in plan, for what no one transform does (a mitre moves only
 * the points at one end); a polygon's or polyline's box follows its points. Null for other kinds.
 */
export function reshapeRecord(src: Uint8Array, type: number, f: (p: Pt) => Pt): Uint8Array | null {
  const d = src.slice();
  const move = (off: number): void => writePt(d, off, f({ x: f64(d, off + 8), y: f64(d, off) }));
  switch (type) {
    case 2:
      move(0x68);
      move(0x78);
      return d;
    case LOCUS:
      move(0x68);
      return d;
    case LOCUS3D: {
      const q = f({ x: f64(d, LOCUS3D_AT), y: f64(d, LOCUS3D_AT + 8) });
      setF64(d, LOCUS3D_AT, q.x);
      setF64(d, LOCUS3D_AT + 8, q.y);
      return d;
    }
    case 5:
    case 21: {
      const stride = type === 5 ? 16 : 36;
      const n = u16(d, 0x8e);
      for (let i = 0; i < n; i++) {
        move(0x90 + stride * i);
        if (type === 21 && isCubicAt(d, 0x90 + 36 * i)) move(0x90 + 36 * i + 20);
      }
      const pts = decodeShape(new Rec(d))?.points ?? [];
      if (pts.length) writeBBox(d, bboxOf(pts));
      return d;
    }
    case BODY: {
      const at = bodySections(d)?.get(BODY_POINTS);
      if (!at) return d;
      for (let o = at[0]; o + 24 <= at[1]; o += 24) {
        const q = f({ x: f64(d, o), y: f64(d, o + 8) });
        setF64(d, o, q.x);
        setF64(d, o + 8, q.y);
      }
      return d;
    }
    default:
      return null;
  }
}

/** The plan box of a body's cached points, or null when it has none. */
export function bodyPlanBox(d: Uint8Array): BBox | null {
  const at = bodySections(d)?.get(BODY_POINTS);
  const pts: Pt[] = [];
  if (at) for (let o = at[0]; o + 24 <= at[1]; o += 24) pts.push({ x: f64(d, o), y: f64(d, o + 8) });
  return pts.length ? bboxOf(pts) : null;
}

/**
 * Fits a group's or bare solid addition's plan box, and its 3D box in plan, to `b`, their heights
 * as they are: a wall's group of bodies and its solid additions, once their bodies have moved.
 */
export function fitPlanBoxes(d: Uint8Array, b: BBox): void {
  writeBBox(d, b);
  if (d.length < BOX3D + 48 || !(Math.abs(f64(d, BOX3D)) < NO_BOUNDS)) return;
  [b.x1, b.y1].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
  [b.x0, b.y0].forEach((v, k) => setF64(d, BOX3D + 24 + 8 * k, v));
}

/**
 * Types whose body (114) caches its points in their parent's coordinates rather than their own
 * frame, so moving them moves their body too: multiple extrudes, solid additions and slabs.
 * Extrudes' and sweeps' bodies are in their own frame (FORMAT.md §3D).
 */
export const BODY_IN_PARENT: ReadonlySet<number> = new Set([38, 84, SLAB]);

const BODY_SECTIONS = 0x5a;
const BODY_BASE = 0x60;
const BODY_SLOTS = 16;
const BODY_POINTS = 0;

/**
 * A body record's sections, id to [start, end): +0x5a holds 16 (u16 id, u32 offset) slots, offsets
 * counted from +0x60; slot 0 is (number of sections, end offset), unused slots have id 0xffff.
 * Null when they don't read.
 */
export function bodySections(d: Uint8Array): Map<number, [number, number]> | null {
  if (d.length < BODY_SECTIONS + 6 * BODY_SLOTS) return null;
  const count = u16(d, BODY_SECTIONS);
  const end = BODY_BASE + u32(d, BODY_SECTIONS + 2);
  if (count === 0 || count >= BODY_SLOTS || end > d.length) return null;
  const list: [number, number][] = [];
  for (let i = 1; i <= count; i++) {
    const id = u16(d, BODY_SECTIONS + 6 * i);
    if (id !== 0xffff) list.push([id, BODY_BASE + u32(d, BODY_SECTIONS + 6 * i + 2)]);
  }
  list.sort((a, b) => a[1] - b[1]);
  const out = new Map<number, [number, number]>();
  list.forEach(([id, at], i) => out.set(id, [at, i + 1 < list.length ? list[i + 1][1] : end]));
  return out;
}

/** A body's cached points (x, y, z) carried through m in plan and raised by dz; its other sections only number them. */
export function moveBodyPoints(d: Uint8Array, m: Affine, dz = 0): void {
  const at = bodySections(d)?.get(BODY_POINTS);
  if (!at) return;
  for (let o = at[0]; o + 24 <= at[1]; o += 24) {
    const q = applyAffine(m, { x: f64(d, o), y: f64(d, o + 8) });
    setF64(d, o, q.x);
    setF64(d, o + 8, q.y);
    if (dz) setF64(d, o + 16, f64(d, o + 16) + dz);
  }
}

/** True when m only turns, mirrors and moves, which an OWN_FRAME object's frame can take as it is. */
export function keepsFrame(m: Affine): boolean {
  return isSimilarity(m) && Math.abs(Math.abs(m.a * m.d - m.b * m.c) - 1) <= 1e-9;
}

/**
 * What a scale in plan does to an extrude in its own frame, which keeps its turn: the linear
 * map its profile takes in its own plane, and the factor its heights take along its axis. Null
 * when the scale would shear it (an extrude tilted against the scale's axes) or its frame isn't
 * a turn. Upright extrudes always qualify, and those lying on their side under an even scale.
 */
export function extrudeScale(d: Uint8Array, m: Affine): { profile: Affine; height: number } | null {
  if (d.length < FRAME_OFFSET + 24) return null;
  if (![0, 1, 2, 3, 4, 5].every((k) => Math.abs(f64(d, BOX3D + 8 * k)) < NO_BOUNDS)) return null;
  const f = [0, 1, 2].map((i) => [0, 1, 2].map((k) => f64(d, FRAME_ROWS + 24 * i + 8 * k)));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (Math.abs(f[i][0] * f[j][0] + f[i][1] * f[j][1] + f[i][2] * f[j][2] - (i === j ? 1 : 0)) > 1e-9) return null;
    }
  }
  // the plan transform's linear part in 3D, z kept, seen in the frame: rows are the axes' images,
  // so the frame's inverse is its transpose
  const plan = [
    [m.a, m.c, 0],
    [m.b, m.d, 0],
    [0, 0, 1],
  ];
  const g = (a: number, b: number): number => {
    let v = 0;
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) v += f[a][j] * plan[j][k] * f[b][k];
    return v;
  };
  const tol = 1e-9 * Math.max(1, Math.abs(m.a), Math.abs(m.b), Math.abs(m.c), Math.abs(m.d));
  if ([g(0, 2), g(1, 2), g(2, 0), g(2, 1)].some((v) => Math.abs(v) > tol)) return null;
  return { profile: { a: clean(g(0, 0)), b: clean(g(1, 0)), c: clean(g(0, 1)), d: clean(g(1, 1)), e: 0, f: 0 }, height: clean(g(2, 2)) };
}

/**
 * An extrude scaled through m (see extrudeScale), once its profile has taken the scale and has
 * the bounds `profile`: its frame's offset moves, its 3D box takes those bounds and its heights
 * the factor, and its plan box follows.
 */
export function placeScaledExtrude(d: Uint8Array, m: Affine, profile: BBox, height: number): void {
  const t = applyAffine(m, { x: f64(d, FRAME_OFFSET), y: f64(d, FRAME_OFFSET + 8) });
  setF64(d, FRAME_OFFSET, t.x);
  setF64(d, FRAME_OFFSET + 8, t.y);
  const z = [f64(d, BOX3D + 16), f64(d, BOX3D + 40)].map((v) => v * height);
  [profile.x1, profile.y1, Math.max(...z), profile.x0, profile.y0, Math.min(...z)].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
  const placed = framedBox(d);
  if (placed) writeBBox(d, placed);
}

/**
 * A sweep scaled through m (see extrudeScale), once its profile has taken the scale: `across` its
 * axis (its own x and z) and `along` it (its own y). Its frame's offset moves, its 3D box takes
 * the factors and its plan box follows.
 */
export function placeScaledSweep(d: Uint8Array, m: Affine, across: number, along: number): void {
  const t = applyAffine(m, { x: f64(d, FRAME_OFFSET), y: f64(d, FRAME_OFFSET + 8) });
  setF64(d, FRAME_OFFSET, t.x);
  setF64(d, FRAME_OFFSET + 8, t.y);
  const box = [0, 1, 2, 3, 4, 5].map((k) => f64(d, BOX3D + 8 * k));
  const [x, y, z] = [0, 1, 2].map((k) => [box[k], box[k + 3]].map((v) => v * (k === 1 ? along : across)));
  [Math.max(...x), Math.max(...y), Math.max(...z), Math.min(...x), Math.min(...y), Math.min(...z)].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
  const placed = framedBox(d);
  if (placed) writeBBox(d, placed);
}

/** An OWN_FRAME object's 3D box as its frame places it, seen from above; null when either isn't readable. */
function framedBox(d: Uint8Array): BBox | null {
  if (d.length < FRAME_OFFSET + 24) return null;
  const v = (at: number): number => f64(d, at);
  const own = [0, 1, 2, 3, 4, 5].map((k) => v(BOX3D + 8 * k));
  if (!own.every((x) => Number.isFinite(x) && Math.abs(x) < NO_BOUNDS)) return null;
  const corners: Pt[] = [];
  for (let k = 0; k < 8; k++) {
    const [x, y, z] = [k & 1 ? own[0] : own[3], k & 2 ? own[1] : own[4], k & 4 ? own[2] : own[5]];
    corners.push({
      x: x * v(FRAME_ROWS) + y * v(FRAME_ROWS + 24) + z * v(FRAME_ROWS + 48) + v(FRAME_OFFSET),
      y: x * v(FRAME_ROWS + 8) + y * v(FRAME_ROWS + 32) + z * v(FRAME_ROWS + 56) + v(FRAME_OFFSET + 8),
    });
  }
  return corners.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)) ? bboxOf(corners) : null;
}

/**
 * Where a 3D object lies in plan, from its geometry: an OWN_FRAME object's 3D box through its
 * frame, a 3D polygon's or mesh's points. A few objects' stored plan bounds are stale (30
 * extrudes on the 2023 demo's layers keep bounds metres from their body), so these go first.
 */
export function planBounds(d: Uint8Array, type: number): BBox | null {
  if (OWN_FRAME.has(type)) return framedBox(d) ?? readBBox(d);
  if (type !== POLY3D && type !== MESH && type !== LOCUS3D) return readBBox(d);
  const pts = points3d(d, type);
  if (!pts?.n) return readBBox(d);
  const q: Pt[] = [];
  for (let i = 0; i < pts.n; i++) q.push({ x: f64(d, pts.at + pts.size * i), y: f64(d, pts.at + pts.size * i + 8) });
  return q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ? bboxOf(q) : readBBox(d);
}

/** The box round a box's four corners through m. */
function mapCorners(b: BBox, m: Affine): BBox {
  return bboxOf([
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ].map((p) => applyAffine(m, p)));
}

function transformPt(d: Uint8Array, off: number, m: Affine): void {
  writePt(d, off, applyAffine(m, { x: f64(d, off + 8), y: f64(d, off) }));
}

function writeRectFrame(d: Uint8Array, r: RectFrame): void {
  writeBBox(d, bboxOf(rectCorners(r)));
  writePt(d, 0x8c, r.o);
  setF64(d, 0x9c, clean(r.u.y));
  setF64(d, 0xa4, clean(r.u.x));
  setF64(d, 0xac, r.w);
  setF64(d, 0xb4, r.h);
}

/**
 * Apply an affine transform to one record, returning a new buffer, or null
 * when the shape can't keep its type under `m` (a rectangle that would be
 * skewed, an arc that would become elliptical). Text turns but keeps its
 * size; images stay upright and scale; symbol instances compose the
 * transform into their matrix, and extrudes and solids into their frame
 * (turns and mirrors only); 3D polygons and meshes move their points in plan.
 * Group bounds are left to the caller (they follow the children).
 */
export function transformRecord(src: Uint8Array, type: number, m: Affine): Uint8Array | null {
  const d = src.slice();
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error("transform would flatten the objects");
  switch (type) {
    case 2:
      transformPt(d, 0x68, m);
      transformPt(d, 0x78, m);
      return d;
    case LOCUS:
      transformPt(d, 0x68, m);
      return d;
    case LOCUS3D: {
      const q = applyAffine(m, { x: f64(d, LOCUS3D_AT), y: f64(d, LOCUS3D_AT + 8) });
      setF64(d, LOCUS3D_AT, q.x);
      setF64(d, LOCUS3D_AT + 8, q.y);
      return d;
    }
    case 3:
    case ROUNDED_RECT: {
      const r = rectFrameOf(d);
      if (!r || (type === ROUNDED_RECT && d.length < ROUNDED_ALONG + 8)) return null;
      const v = { x: -r.u.y, y: r.u.x };
      const U = applyLinear(m, { x: r.u.x * r.w, y: r.u.y * r.w });
      const V = applyLinear(m, { x: v.x * r.h, y: v.y * r.h });
      const w = Math.hypot(U.x, U.y);
      const h = Math.hypot(V.x, V.y);
      if (Math.abs(U.x * V.x + U.y * V.y) > 1e-9 * w * h) return null;
      const u = { x: U.x / w, y: U.y / w };
      const o0 = applyAffine(m, r.o);
      // a mirrored frame turns the other way: start from the other side
      const flipped = -u.y * V.x + u.x * V.y < 0;
      writeRectFrame(d, { o: flipped ? { x: o0.x + V.x, y: o0.y + V.y } : o0, u, w, h });
      // its corners stretch with the sides they lie along
      if (type === ROUNDED_RECT) {
        setF64(d, ROUNDED_ALONG, f64(d, ROUNDED_ALONG) * (w / r.w));
        setF64(d, ROUNDED_ACROSS, f64(d, ROUNDED_ACROSS) * (h / r.h));
      }
      return d;
    }
    case 5:
    case 21: {
      const stride = type === 5 ? 16 : 36;
      const n = u16(d, 0x8e);
      for (let i = 0; i < n; i++) transformPt(d, 0x90 + stride * i, m);
      if (type === 21) {
        // arc vertices keep a radius, scaled by the mean factor; cubic vertices a control point,
        // carried with the vertices (the controls are an affine mix of the vertices)
        const s = Math.sqrt(Math.abs(det));
        for (let i = 0; i < n; i++) {
          const off = 0x90 + 36 * i;
          if (isCubicAt(d, off)) transformPt(d, off + 20, m);
          else setF64(d, off + 20, f64(d, off + 20) * s);
        }
      }
      const pts = decodeShape(new Rec(d))?.points ?? [];
      if (pts.length) writeBBox(d, bboxOf(pts));
      return d;
    }
    case 6: {
      const s = decodeShape(new Rec(d));
      if (!s?.center || s.rx === undefined || s.ry === undefined) return null;
      const start = s.startAngle ?? 0;
      const sweep = s.sweepAngle ?? 360;
      const rad = (start * Math.PI) / 180;
      if (Math.abs(s.rx - s.ry) <= 1e-9 * Math.max(s.rx, s.ry)) {
        if (!isSimilarity(m)) return null;
        const dir = applyLinear(m, { x: Math.cos(rad), y: Math.sin(rad) });
        return writeGeometry(d, {
          kind: "arc",
          center: applyAffine(m, s.center),
          radius: s.rx * Math.sqrt(Math.abs(det)),
          startAngle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
          sweepAngle: det < 0 ? -sweep : sweep,
        });
      }
      // an ellipse stays one while its axes stay on x and y: scaling, mirroring, quarter turns
      const tol = 1e-12 * (Math.abs(m.a) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d));
      const keepsAxes = Math.abs(m.b) <= tol && Math.abs(m.c) <= tol;
      const swapsAxes = Math.abs(m.a) <= tol && Math.abs(m.d) <= tol;
      if (!keepsAxes && !swapsAxes) return null;
      const rx = keepsAxes ? Math.abs(m.a) * s.rx : Math.abs(m.c) * s.ry;
      const ry = keepsAxes ? Math.abs(m.d) * s.ry : Math.abs(m.b) * s.rx;
      // the start point's image, read back as a parametric angle on the new ellipse
      const v = applyLinear(m, { x: s.rx * Math.cos(rad), y: s.ry * Math.sin(rad) });
      return writeGeometry(d, {
        kind: "arc",
        center: applyAffine(m, s.center),
        radius: rx,
        radiusY: ry,
        startAngle: (Math.atan2(v.y / ry, v.x / rx) * 180) / Math.PI,
        sweepAngle: det < 0 ? -sweep : sweep,
      });
    }
    case 10: {
      // text turns with the transform but keeps its size; mirrored text stays readable
      const f = readTextFrame(d, readText(d));
      let u = applyLinear(m, f.u);
      const len = Math.hypot(u.x, u.y);
      u = { x: u.x / len, y: u.y / len };
      if (det < 0 && u.x < -1e-9) u = { x: -u.x, y: -u.y };
      writeTextFrame(d, { ...f, o: applyAffine(m, f.o), u: { x: clean(u.x), y: clean(u.y) } });
      return d;
    }
    case 11: {
      // a group's boxes are fitted to what it holds afterwards (refitGroups), but for one holding
      // only bodies (a wall's 3D), which have no plan box: its boxes' corners go through m
      const b = readBBox(d);
      if (b) writeBBox(d, mapCorners(b, m));
      if (d.length >= BOX3D + 48 && Math.abs(f64(d, BOX3D)) < NO_BOUNDS) {
        const c = mapCorners({ x0: f64(d, BOX3D + 24), y0: f64(d, BOX3D + 32), x1: f64(d, BOX3D), y1: f64(d, BOX3D + 8) }, m);
        [c.x1, c.y1].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
        [c.x0, c.y0].forEach((v, k) => setF64(d, BOX3D + 24 + 8 * k, v));
      }
      return d;
    }
    case WALL: {
      // its control line's ends; mirrored, they swap, so its components stay on the side its
      // drawing and 3D now show them
      if (d.length < WALL_LINE + 32) return null;
      const ends = [WALL_LINE, WALL_LINE + 16].map((off) => applyAffine(m, { x: f64(d, off + 8), y: f64(d, off) }));
      if (det < 0) ends.reverse();
      ends.forEach((q, i) => writePt(d, WALL_LINE + 16 * i, q));
      const b = readBBox(d);
      if (b) writeBBox(d, mapCorners(b, m));
      return d;
    }
    case BODY: // a body in a group: its points, in the group's coordinates
      moveBodyPoints(d, m);
      return d;
    case SLAB: {
      if (d.length < SLAB_END) return null;
      for (const off of SLAB_POINTS) transformPt(d, off, m);
      const b = readBBox(d);
      if (b) writeBBox(d, mapCorners(b, m));
      return d;
    }
    case PLUGIN: {
      // its matrix: each axis's and the origin's plan part through m; what it draws is in its own frame
      if (d.length < PLUGIN_MATRIX + 96) return null;
      for (let row = 0; row < 4; row++) {
        const at = PLUGIN_MATRIX + 24 * row;
        const v = { x: f64(d, at), y: f64(d, at + 8) };
        const q = row === 3 ? applyAffine(m, v) : applyLinear(m, v);
        setF64(d, at, clean(q.x));
        setF64(d, at + 8, clean(q.y));
      }
      const b = readBBox(d);
      if (b) writeBBox(d, mapCorners(b, m));
      return d;
    }
    case 14: {
      // images stay upright: a transform that keeps the axes (scales and flips) maps their frame,
      // anything else moves their centre and scales them evenly about it
      const b = readBBox(d);
      if (!b || d.length < 0xfc) return d;
      const axisAligned = Math.abs(m.b) < 1e-12 && Math.abs(m.c) < 1e-12;
      const c = applyAffine(m, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
      const k = Math.sqrt(Math.abs(det));
      const map = (p: Pt): Pt =>
        axisAligned ? applyAffine(m, p) : { x: c.x + (p.x - (b.x0 + b.x1) / 2) * k, y: c.y + (p.y - (b.y0 + b.y1) / 2) * k };
      const mapBox = (x0: number, y0: number, x1: number, y1: number): BBox => bboxOf([map({ x: x0, y: y0 }), map({ x: x1, y: y1 })]);
      writeBBox(d, mapBox(b.x0, b.y0, b.x1, b.y1));
      // the stored top-left corner and size, which a few images keep apart from their bounds
      const ox = f64(d, 0xd4);
      const oy = f64(d, 0xdc);
      const f = mapBox(ox, oy - f64(d, 0xf4), ox + f64(d, 0xec), oy);
      setF64(d, 0xd4, f.x0);
      setF64(d, 0xdc, f.y1);
      setF64(d, 0xec, f.x1 - f.x0);
      setF64(d, 0xf4, f.y1 - f.y0);
      return d;
    }
    case 15: {
      writeInstanceMatrix(d, composeAffine(m, readInstanceMatrix(d)));
      const b = readBBox(d);
      if (b) {
        const corners = [
          { x: b.x0, y: b.y0 },
          { x: b.x1, y: b.y0 },
          { x: b.x1, y: b.y1 },
          { x: b.x0, y: b.y1 },
        ];
        writeBBox(d, bboxOf(corners.map((p) => applyAffine(m, p))));
      }
      return d;
    }
    case 24:
    case 34:
    case 38:
    case 84:
      return transformFramed(d, m);
    case POLY3D:
    case MESH: {
      const pts = points3d(d, type);
      if (!pts) return null;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pts.n; i++) {
        const at = pts.at + pts.size * i;
        const q = applyAffine(m, { x: f64(d, at), y: f64(d, at + 8) });
        setF64(d, at, q.x);
        setF64(d, at + 8, q.y);
        [q.x, q.y, f64(d, at + 16)].forEach((v, k) => {
          lo[k] = Math.min(lo[k], v);
          hi[k] = Math.max(hi[k], v);
        });
      }
      if (pts.n) {
        writeBBox(d, { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] });
        if (Math.abs(f64(d, BOX3D)) < NO_BOUNDS) [...hi, ...lo].forEach((v, k) => setF64(d, BOX3D + 8 * k, v));
      }
      return d;
    }
    default:
      throw new Error(`transforming type-${type} objects isn't supported yet`);
  }
}

/** VW record type for a NewShape kind. */
export const TYPE_OF_KIND: Record<NewShape["kind"], number> = {
  line: 2,
  rect: 3,
  roundrect: ROUNDED_RECT,
  polygon: 5,
  polyline: 21,
  arc: 6,
  text: 10,
  image: 14,
  locus: LOCUS,
  light: LIGHT,
};

/** where an image record's PNG or JPEG stream starts after a plain image description */
const IMAGE_DATA = 0x190;
/** an image description's pixel depth and colour table id (-1: none) */
const IMAGE_DEPTH = 0x18c;
const IMAGE_CLUT = 0x18e;

/**
 * True when the polyline vertex at `off` is a cubic spline vertex (kind byte 2 of its word) that
 * holds its control point (y, x) at +20: one that is set (not 0, 0), as decoding reads it.
 */
function isCubicAt(d: Uint8Array, off: number): boolean {
  if (off + 36 > d.length || ((u32(d, off + 16) >>> 8) & 0xff) !== VERTEX_CODE.cubic) return false;
  const y = f64(d, off + 20);
  const x = f64(d, off + 28);
  return Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);
}

/** Re-encode geometry into a copy of `d` (a record of the matching type). */
export function writeGeometry(d: Uint8Array, s: NewShape): Uint8Array {
  switch (s.kind) {
    case "locus": {
      checkPts([s.at], 1);
      if (d.length < LOCUS_LENGTH) throw new Error("not a locus record");
      const out = d.slice();
      writePt(out, 0x68, s.at);
      return out;
    }
    case "light": {
      checkPts([s.at], 1);
      if (d.length < LIGHT_END) throw new Error("not a light record");
      const kind = LIGHT_KINDS.indexOf(s.light);
      if (kind < 0) throw new Error(`no light kind ${s.light}`);
      const aim = s.direction ?? [0, 0, -1];
      const length = Math.hypot(...aim);
      if (!Number.isFinite(s.z) || !aim.every(Number.isFinite) || !(length > 0)) throw new Error("a light's height and direction are finite numbers");
      const out = d.slice();
      // the copied light's plan box goes with it, as a move takes it
      translateRecord(out, LIGHT, s.at.x - f64(out, LIGHT_AT), s.at.y - f64(out, LIGHT_AT + 8));
      setF64(out, LIGHT_AT + 16, s.z);
      out[LIGHT_ON] = 1;
      setU16(out, LIGHT_KIND, kind);
      aim.forEach((v, i) => setF64(out, lightAim(out) + 8 * i, v / length));
      return out;
    }
    case "line": {
      checkPts([s.a, s.b], 2);
      const out = d.slice();
      writePt(out, 0x68, s.a);
      writePt(out, 0x78, s.b);
      return out;
    }
    case "rect":
    case "roundrect": {
      const b: BBox = {
        x0: Math.min(s.x0, s.x1),
        y0: Math.min(s.y0, s.y1),
        x1: Math.max(s.x0, s.x1),
        y1: Math.max(s.y0, s.y1),
      };
      checkPts([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }], 2);
      const out = d.slice();
      writeBBox(out, b);
      setU32(out, 0x88, 0);
      writePt(out, 0x8c, { x: b.x0, y: b.y0 });
      setF64(out, 0x9c, 0); // rotation vector (sin, cos)
      setF64(out, 0xa4, 1);
      setF64(out, 0xac, b.x1 - b.x0);
      setF64(out, 0xb4, b.y1 - b.y0);
      if (s.kind === "roundrect") {
        if (out.length < 0xcc) throw new Error("not a rounded rectangle record");
        // corner diameters, y then x, no larger than the sides
        setF64(out, 0xbc, Math.min(2 * Math.abs(s.ry), b.y1 - b.y0));
        setF64(out, 0xc4, Math.min(2 * Math.abs(s.rx), b.x1 - b.x0));
      }
      return out;
    }
    case "polygon":
    case "polyline": {
      checkPts(s.points, 2);
      const poly = s.kind === "polyline";
      const stride = poly ? 36 : 16;
      const n = s.points.length;
      const out = new Uint8Array(0x90 + stride * n);
      out.set(d.subarray(0, 0x90));
      setU64(out, 0, BigInt(out.length));
      out[0x8d] = s.closed ? 1 : 0;
      setU16(out, 0x8e, n);
      // corner vertex word: the template's first vertex word with the kind byte cleared and
      // the edge to the next vertex shown (0x80, which Vectorworks clears on hidden edges)
      const word = ((poly && u16(d, 0x8e) > 0 ? u32(d, 0x90 + 16) & ~0xff00 : 0) | 0x80) >>> 0;
      // a smooth polyline's inner vertices are bezier control points (kind 1); otherwise each
      // takes its own kind, and an open polyline's ends stay corners
      const inner = (i: number): boolean => s.closed || (i > 0 && i < n - 1);
      const kind = (i: number): VertexKind =>
        s.kind !== "polyline" || !inner(i) ? "corner" : s.smooth ? "bezier" : (s.vertices?.[i] ?? "corner");
      const kinds = s.points.map((_, i) => kind(i));
      // cubic vertices keep the control point they draw from, worked out as Vectorworks does
      const controls = poly && kinds.includes("cubic") ? cubicControls(s.points, kinds, s.closed) : [];
      const hidden = new Set(s.kind === "polyline" ? (s.hidden ?? []) : []);
      s.points.forEach((p, i) => {
        const off = 0x90 + stride * i;
        writePt(out, off, p);
        if (!poly) return;
        const k = kinds[i];
        setU32(out, off + 16, ((hidden.has(i) ? word & ~0x80 : word) | (VERTEX_CODE[k] << 8)) >>> 0);
        const control = controls[i];
        if (control) writePt(out, off + 20, control);
        // a through vertex caches the radius of its arc (+20); an arc vertex's 0 is as large as fits
        if (k === "through") {
          setF64(out, off + 20, circumradius(s.points[(i - 1 + n) % n], p, s.points[(i + 1) % n]));
        } else if (k === "arc" && (s.radii?.[i] ?? 0) > 0) {
          setF64(out, off + 20, s.radii?.[i] ?? 0);
        }
      });
      writeBBox(out, bboxOf(s.points));
      return out;
    }
    case "arc": {
      const rx = Math.abs(s.radius);
      const ry = s.radiusY === undefined ? rx : Math.abs(s.radiusY);
      if (!(rx > 0) || !(ry > 0) || !Number.isFinite(rx) || !Number.isFinite(ry)) {
        throw new Error("radius must be positive");
      }
      checkPts([s.center], 1);
      const out = d.slice();
      const c = s.center;
      // the bbox is the whole ellipse's, so its half-sizes are the radii; QuickDraw angles are
      // relative to that box (45° points at its corner), which is the parametric angle
      const at = (deg: number): Pt => ({
        x: c.x + rx * Math.cos((deg * Math.PI) / 180),
        y: c.y + ry * Math.sin((deg * Math.PI) / 180),
      });
      const sweep = Math.max(-360, Math.min(360, s.sweepAngle));
      writeBBox(out, { x0: c.x - rx, y0: c.y - ry, x1: c.x + rx, y1: c.y + ry });
      writePt(out, 0x90, at(s.startAngle));
      writePt(out, 0xa0, at(s.startAngle + sweep));
      writePt(out, 0xb0, c);
      setF64(out, 0xc0, 90 - s.startAngle);
      setF64(out, 0xc8, -sweep);
      return out;
    }
    case "text": {
      const out = encodeText(d, s.text, s.at, s.height);
      if (s.hAlign === undefined && s.vAlign === undefined && s.angle === undefined) return out;
      const f = readTextFrame(out, readText(out));
      const hAlign = s.hAlign ?? f.hAlign;
      const vAlign = s.vAlign ?? f.vAlign;
      if (![1, 2, 3].includes(hAlign) || ![1, 2, 3, 4, 5].includes(vAlign)) throw new Error("unknown text alignment");
      if (s.angle !== undefined && !Number.isFinite(s.angle)) throw new Error("angle must be a number");
      const rad = ((s.angle ?? 0) * Math.PI) / 180;
      const u = s.angle === undefined ? f.u : { x: clean(Math.cos(rad)), y: clean(Math.sin(rad)) };
      writeTextFrame(out, { ...f, hAlign, vAlign, u });
      return out;
    }
    case "image":
      return encodeImage(d, s);
  }
}

/**
 * An image record (type 14) holding `s`'s picture. The record keeps its bounds, its top-left
 * corner, its size in world units and its pixel size, then a QuickTime image description
 * (little-endian: its length 0x56, the codec, the pixel size, the data length and the codec's
 * name) and the PNG or JPEG stream, padded to an even length. An 8-bit template's colour table
 * isn't copied, so the new picture says it has none and is 32-bit. The template's other fields stay.
 */
function encodeImage(d: Uint8Array, s: Extract<NewShape, { kind: "image" }>): Uint8Array {
  const b: BBox = { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
  checkPts([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }], 2);
  if (d.length < IMAGE_DATA) throw new Error("not an image record");
  const png = s.mime === "image/png";
  const w = Math.max(1, Math.round(s.width));
  const h = Math.max(1, Math.round(s.height));
  const out = new Uint8Array(IMAGE_DATA + s.bytes.length + (s.bytes.length & 1));
  out.set(d.subarray(0, IMAGE_DATA));
  out.set(s.bytes, IMAGE_DATA);
  writeBBox(out, b);
  setF64(out, 0xd4, b.x0);
  setF64(out, 0xdc, b.y1);
  setF64(out, 0xec, b.x1 - b.x0);
  setF64(out, 0xf4, b.y1 - b.y0);
  setU32(out, 0x128, w);
  setU32(out, 0x12c, h);
  setU32(out, 0x13a, 0x56);
  // the codec's four-character code, stored back to front: "jpeg", "png "
  out.set(png ? [0x20, 0x67, 0x6e, 0x70] : [0x67, 0x65, 0x70, 0x6a], 0x13e);
  setU16(out, 0x15a, Math.min(w, 0xffff));
  setU16(out, 0x15c, Math.min(h, 0xffff));
  setU32(out, 0x166, s.bytes.length);
  if (u16(d, IMAGE_CLUT) !== 0xffff) {
    setU16(out, IMAGE_DEPTH, 32);
    setU16(out, IMAGE_CLUT, 0xffff);
  }
  const name = png ? "PNG" : "Photo - JPEG";
  out.fill(0, 0x16c, 0x18c);
  out[0x16c] = name.length;
  for (let i = 0; i < name.length; i++) out[0x16d + i] = name.charCodeAt(i);
  return out;
}

// ---- text ---------------------------------------------------------------
//
// Text record layout (type 10):
//   +0x68  bbox; +0xa8 origin (y, x), placed by the justification
//   +0xb8 / +0xc0 baseline direction (sin, cos); +0xe8 / +0xe9 vertical /
//          horizontal alignment (see readTextFrame in geometry.ts)
//   +0xf6  u16 character count n (some files repeat it at +0xea, +0x102 and +0x104)
//   +0x100 line table; then the f64 text size in world units (point size x
//          layer scale) at textSizeAt(d), +0x11e for one line
//   +0x132 ... 10-byte entries (tab stops / style data), kept as-is
//   end - 10n: n x f64 per-character advance, then n x UTF-16LE characters

const TEXT_COUNT = 0xf6;

/** Rough advance of one character as a fraction of the text size (Arial-like). */
function charWidth(ch: string): number {
  if (ch === "\r") return 0;
  if (ch === " ") return 0.28;
  if ("il.,:;|!'`".includes(ch)) return 0.23;
  if ("fjtrI()[]".includes(ch)) return 0.33;
  if ("mwMW@".includes(ch)) return 0.85;
  if (ch >= "A" && ch <= "Z") return 0.67;
  if (ch >= "0" && ch <= "9") return 0.56;
  return 0.53;
}

export function readText(d: Uint8Array): string {
  const n = u16(d, TEXT_COUNT);
  return readUtf16(d, d.length - 2 * n, 2 * n);
}

/** Write a text frame's origin, direction, alignment and size, and its bounds. */
function writeTextFrame(d: Uint8Array, f: TextFrame): void {
  writePt(d, 0xa8, f.o);
  setF64(d, 0xb8, f.u.y);
  setF64(d, 0xc0, f.u.x);
  d[0xe8] = f.vAlign;
  d[0xe9] = f.hAlign;
  setF64(d, textSizeAt(d), f.size);
  const b = bboxOfPoints(textCorners(f));
  if (b) writeBBox(d, b);
}

/** Rebuild a text record with new characters (and optionally a new origin and size). */
export function encodeText(d: Uint8Array, text: string, at?: Pt, size?: number): Uint8Array {
  const t = text.replace(/\r\n|\n/g, "\r");
  if (t.length === 0) throw new Error("text cannot be empty");
  if (t.length > 0xffff) throw new Error("text is too long");
  const nOld = u16(d, TEXT_COUNT);
  const head = d.slice(0, d.length - 10 * nOld);
  const oldText = readUtf16(d, d.length - 2 * nOld, 2 * nOld);
  const frame = readTextFrame(d, oldText);
  let oldAdvance = 0;
  for (let i = 0; i < nOld; i++) oldAdvance += f64(d, d.length - 10 * nOld + 8 * i);

  const oldSize = frame.size;
  const fs = size !== undefined && size > 0 ? size : oldSize > 0 ? oldSize : 1;

  // calibrate the width table against the template's own advances (its font)
  let k = 1;
  const est = [...oldText].reduce((s, ch) => s + charWidth(ch), 0) * oldSize;
  if (oldAdvance > 0 && est > 0) k = Math.min(2, Math.max(0.5, oldAdvance / est));

  const adv = new Uint8Array(8 * t.length);
  const widths: number[] = [0];
  for (let i = 0; i < t.length; i++) {
    const w = k * fs * charWidth(t[i]);
    setF64(adv, 8 * i, w);
    if (t[i] === "\r") widths.push(0);
    else widths[widths.length - 1] += w;
  }
  writeTextFrame(head, {
    ...frame,
    o: at ?? frame.o,
    size: fs,
    lines: widths.length,
    w: Math.max(...widths),
    h: widths.length * TEXT_LINE_HEIGHT * fs,
  });

  setU16(head, TEXT_COUNT, t.length);
  // +0x100 is the number of laid-out lines, which the size's place follows: it stays as it is
  if (nOld > 1) {
    for (const off of [0xea, 0x102, 0x104]) {
      if (u16(head, off) === nOld) setU16(head, off, t.length);
    }
  }
  const out = concat([head, adv, encodeUtf16(t)]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** A text's face as encodeTextStyle sets it: its font's place in the font list, and whether that font is a narrow one. */
export interface TextFace {
  index: number;
  narrow: boolean;
  /** whether the font it had was narrow */
  wasNarrow: boolean;
}

/** Arial Bold's advances over Arial's, for the characters where they differ. */
const BOLD_WIDTH: Readonly<Record<string, number>> = {
  ...Object.fromEntries([..."bdghnopqu"].map((c) => [c, 611 / 556])),
  ...Object.fromEntries([..."ckvxys"].map((c) => [c, 556 / 500])),
  ...Object.fromEntries([..."ft"].map((c) => [c, 333 / 278])),
  ...Object.fromEntries([..."ijl"].map((c) => [c, 278 / 222])),
  r: 389 / 333,
  m: 889 / 833,
  w: 778 / 722,
  A: 722 / 667,
  B: 722 / 667,
  K: 722 / 667,
  L: 611 / 556,
};
/** Arial Narrow's advances over Arial's. */
const NARROW_WIDTH = 0.82;

/** A character's advance in a face, as a share of its advance in Arial. */
function faceWidth(ch: string, narrow: boolean, bold: boolean): number {
  // digits, spaces and most punctuation keep their width in bold; other letters widen a little
  return (narrow ? NARROW_WIDTH : 1) * (bold ? (BOLD_WIDTH[ch] ?? (/[\s\d.,:;'"\-]/.test(ch) ? 1 : 1.04)) : 1);
}

/**
 * Change a text's size, justification, angle, font or style. The origin stays put for a new size,
 * angle or face; a new justification moves the origin instead, so the text doesn't jump. A new
 * font (`face`) or bold changes the advances by how much wider or narrower the face is.
 */
export function encodeTextStyle(src: Uint8Array, style: TextStyle, face?: TextFace): Uint8Array {
  const d = src.slice();
  const n = u16(d, TEXT_COUNT);
  const text = readText(d);
  let f = readTextFrame(d, text);
  const at = textFaceAt(d);
  const bits = u16(d, at + 2);
  if (style.size !== undefined) {
    if (!(style.size > 0 && Number.isFinite(style.size))) throw new Error("text size must be a positive number");
    const k = f.size > 0 ? style.size / f.size : 1;
    for (let i = 0; i < n; i++) {
      const off = d.length - 10 * n + 8 * i;
      setF64(d, off, f64(d, off) * k);
    }
    // the point sizes before the face follow (their ratio to the size is the layer scale)
    for (const off of [at - 16, at - 8]) setF64(d, off, f64(d, off) * k);
    f = { ...f, size: style.size, w: f.w * k, h: f.lines * TEXT_LINE_HEIGHT * style.size };
  }
  const bold = style.bold ?? (bits & TEXT_BOLD) !== 0;
  const flag = (on: boolean | undefined, bit: number, now: number): number => (on === undefined ? now : on ? now | bit : now & ~bit);
  const next = flag(style.underline, TEXT_UNDERLINE, flag(style.italic, TEXT_ITALIC, flag(style.bold, TEXT_BOLD, bits)));
  if (next !== bits) setU16(d, at + 2, next);
  if (face) setU16(d, at, face.index);
  if (style.textStyle !== undefined) {
    if (!(Number.isInteger(style.textStyle) && (style.textStyle >= 0 || style.textStyle === TEXT_STYLE_BY_CLASS))) throw new Error("unknown text style");
    setI32(d, textStyleAt(d), style.textStyle);
  }
  const narrowFrom = face?.wasNarrow ?? false;
  const narrowTo = face?.narrow ?? narrowFrom;
  const boldFrom = (bits & TEXT_BOLD) !== 0;
  if (narrowFrom !== narrowTo || boldFrom !== bold) {
    // the advances of the face it gets, from those of the face it had
    let before = 0;
    let after = 0;
    for (let i = 0; i < n; i++) {
      const off = d.length - 10 * n + 8 * i;
      const a = f64(d, off);
      const k = faceWidth(text[i], narrowTo, bold) / faceWidth(text[i], narrowFrom, boldFrom);
      setF64(d, off, a * k);
      before += a;
      after += a * k;
    }
    if (before > 0) f = { ...f, w: (f.w * after) / before };
  }
  if (style.hAlign !== undefined || style.vAlign !== undefined) {
    const h = style.hAlign ?? f.hAlign;
    const v = style.vAlign ?? f.vAlign;
    if (![1, 2, 3].includes(h) || ![1, 2, 3, 4, 5].includes(v)) throw new Error("unknown text alignment");
    const fx = (a: number) => (a === 2 ? 0.5 : a === 3 ? 1 : 0);
    const next = { ...f, hAlign: h, vAlign: v };
    const ds = (fx(h) - fx(f.hAlign)) * f.w;
    const dt = textTop(f) - textTop(next);
    const up = { x: -f.u.y, y: f.u.x };
    f = { ...next, o: { x: f.o.x + ds * f.u.x + dt * up.x, y: f.o.y + ds * f.u.y + dt * up.y } };
  }
  if (style.angle !== undefined) {
    if (!Number.isFinite(style.angle)) throw new Error("angle must be a number");
    const rad = (style.angle * Math.PI) / 180;
    f = { ...f, u: { x: clean(Math.cos(rad)), y: clean(Math.sin(rad)) } };
  }
  writeTextFrame(d, f);
  return d;
}
