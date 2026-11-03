// Line markers: arrowheads, dots and slashes at the ends of lines, arcs, polygons and polylines.
//
// A drawable's markers are an aux child of type 125, always 100 bytes: the common header, then
// two 10-byte markers, the start's (first point) at +0x50 and the end's (last point) at +0x5a.
// No such child, no markers. Each marker:
//   +0  u8   style: 0 filled closed arrow, 2 filled dot, 3 slash (others not drawn)
//   +1  u8   unknown
//   +2  u16  size, 1/16384 inch on paper: an arrow's length tip to base along the line, a
//            slash's whole length (centred on the end), a dot's diameter
//   +4  u8   angle, degrees: each side of an arrow against the line (its base is
//            2·size·tan(angle) wide); a slash's turn from the line, counter-clockwise
//   +5  u8   unknown
//   +6  u8   unknown
//   +7  u8   1 = drawn; any other value (0, 0xff, 0x6d, ...) hides it
//   +8  u16  width, 1/16384 inch: a dot's equals its size, 0 for the others
// An arrow's tip sits on the end, pointing out of the shape; dots and slashes are centred on it.
// They draw in the pen colour, arrows and dots filled.

import { setU16, u16 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { LineMarker, LineMarkers, MarkerStyle, Pt, Shape } from "./types.ts";

/** The aux record (a child of the object) that holds its line markers. */
export const LINE_MARKERS = 125;
/** Lines, polygons, arcs and polylines: the types seen with markers. */
export const MARKED_TYPES: ReadonlySet<number> = new Set([2, 5, 6, 21]);

const MARKER_START = 0x50;
const MARKER_END = 0x5a;
const MARKER_BYTES = 10;
/** marker sizes and widths are u16s in 1/16384 inch */
const UNITS_PER_INCH = 16384;
const STYLES: ReadonlyMap<number, MarkerStyle> = new Map([
  [0, "arrow"],
  [2, "dot"],
  [3, "slash"],
]);
const DRAWN = 1;
const DEG = Math.PI / 180;
const STYLE_CODES: Readonly<Record<MarkerStyle, number>> = { arrow: 0, dot: 2, slash: 3 };
/** the largest size a u16 of 1/16384 inch holds */
const MAX_SIZE = 0xffff / UNITS_PER_INCH;

/**
 * The body of a new type-125 record: both ends hold Vectorworks' default arrow (1/8 inch at 15°,
 * the two unknown bytes as it writes them) and are hidden.
 */
export const NEW_MARKERS: Uint8Array = Uint8Array.of(0, 0, 0x00, 0x08, 15, 2, 2, 0, 0, 0, 0, 0, 0x00, 0x08, 15, 2, 2, 0, 0, 0);

/** One marker of a type-125 record at `off`, or null when it is hidden or of a style not drawn. */
function readMarker(d: Uint8Array, off: number): LineMarker | null {
  if (off + MARKER_BYTES > d.length || d[off + 7] !== DRAWN) return null;
  const style = STYLES.get(d[off]);
  const size = u16(d, off + 2) / UNITS_PER_INCH;
  if (!style || size <= 0) return null;
  return { style, size, angle: d[off + 4], width: u16(d, off + 8) / UNITS_PER_INCH };
}

/** Writes one marker into a type-125 record at `off`; null hides it and keeps its settings. */
function writeMarker(d: Uint8Array, off: number, m: LineMarker | null): void {
  if (!m) {
    d[off + 7] = 0;
    return;
  }
  const size = Math.round(Math.min(Math.max(m.size, 1 / UNITS_PER_INCH), MAX_SIZE) * UNITS_PER_INCH);
  d[off] = STYLE_CODES[m.style];
  setU16(d, off + 2, size);
  d[off + 4] = Math.round(Math.min(Math.max(m.angle, 0), 255));
  d[off + 7] = DRAWN;
  setU16(d, off + 8, m.style === "dot" ? size : 0);
}

/** Sets the markers of a type-125 record: a marker shows, null hides one, an end left out stays. */
export function writeMarkers(d: Uint8Array, ends: { readonly start?: LineMarker | null; readonly end?: LineMarker | null }): void {
  if (ends.start !== undefined) writeMarker(d, MARKER_START, ends.start);
  if (ends.end !== undefined) writeMarker(d, MARKER_END, ends.end);
}

/**
 * The markers an object draws at its ends, from its type-125 aux child; null when it has none
 * that show. Only the aux part of the child list is looked at, and only for the types that
 * carry markers.
 */
export function readMarkers(r: Rec): LineMarkers | null {
  if (!MARKED_TYPES.has(r.type)) return null;
  for (const c of r.children) {
    if (c.type === LINE_MARKERS) {
      const start = readMarker(c.data, MARKER_START);
      const end = readMarker(c.data, MARKER_END);
      if (!start && !end) return null;
      return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
    }
    // the last aux record; objects follow
    if (!c.hasNext) break;
  }
  return null;
}

/** One end of a shape: the point, and the unit direction out of the shape there. */
interface End {
  at: Pt;
  out: Pt;
}

/** The unit vector from b to a, or null when they coincide. */
function away(a: Pt, b: Pt): Pt | null {
  const len = Math.hypot(a.x - b.x, a.y - b.y);
  return len > 0 && Number.isFinite(len) ? { x: (a.x - b.x) / len, y: (a.y - b.y) / len } : null;
}

/** The end of a point list at `i`, its direction from the nearest other point inward (`step` is +1 or -1). */
function pointEnd(pts: readonly Pt[], i: number, step: number): End | null {
  for (let j = i + step; j >= 0 && j < pts.length; j += step) {
    const out = away(pts[i], pts[j]);
    if (out) return { at: pts[i], out };
  }
  return null;
}

/**
 * The first and last points of a line, polygon, polyline or arc (a closed polygon's too), each
 * with the direction out of the shape: along its first or last segment, or an arc's tangent.
 * Null for other shapes, whole circles and shapes too small to have a direction.
 */
function shapeEnds(s: Shape): { start: End | null; end: End | null } | null {
  if (s.kind === "arc") {
    const c = s.center;
    const sweep = s.sweepAngle ?? 360;
    if (!c || s.rx === undefined || sweep === 0 || Math.abs(sweep) >= 360) return null;
    const rx = Math.abs(s.rx);
    const ry = Math.abs(s.ry ?? s.rx);
    // angles are parametric; the tangent along the sweep at t is (−rx sin t, ry cos t), signed by its sense
    const end = (deg: number, sense: number): End | null => {
      const t = deg * DEG;
      const at = { x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) };
      const out = away({ x: -rx * Math.sin(t) * sense, y: ry * Math.cos(t) * sense }, { x: 0, y: 0 });
      return out && { at, out };
    };
    const a0 = s.startAngle ?? 0;
    return { start: end(a0, -Math.sign(sweep)), end: end(a0 + sweep, Math.sign(sweep)) };
  }
  if (s.kind !== "line" && s.kind !== "polygon" && s.kind !== "polyline") return null;
  const pts = s.points;
  if (pts.length < 2) return null;
  return { start: pointEnd(pts, 0, 1), end: pointEnd(pts, pts.length - 1, -1) };
}

/**
 * What a marker draws, in the shape's coordinates: a filled polygon (an arrowhead: its tip, then
 * the corners of its base), a filled circle (a dot) or a stroked segment (a slash).
 */
export type MarkerPath =
  | { kind: "polygon"; points: Pt[] }
  | { kind: "circle"; center: Pt; r: number }
  | { kind: "segment"; a: Pt; b: Pt };

/** The marker `m` drawn at an end, `k` shape units to the paper inch; null when it can't be drawn. */
function markerPath(m: LineMarker, { at, out }: End, k: number): MarkerPath | null {
  const len = m.size * k;
  if (!(len > 0) || !Number.isFinite(len)) return null;
  switch (m.style) {
    case "arrow": {
      if (!(m.angle > 0 && m.angle < 90)) return null;
      const half = len * Math.tan(m.angle * DEG);
      const bx = at.x - out.x * len;
      const by = at.y - out.y * len;
      return {
        kind: "polygon",
        points: [at, { x: bx - out.y * half, y: by + out.x * half }, { x: bx + out.y * half, y: by - out.x * half }],
      };
    }
    case "dot":
      return { kind: "circle", center: at, r: len / 2 };
    case "slash": {
      // the line's direction turned counter-clockwise by the angle; either way along the line
      // gives the same slash, as it is centred on the end
      const cos = Math.cos(m.angle * DEG);
      const sin = Math.sin(m.angle * DEG);
      const dx = ((out.x * cos - out.y * sin) * len) / 2;
      const dy = ((out.x * sin + out.y * cos) * len) / 2;
      return { kind: "segment", a: { x: at.x - dx, y: at.y - dy }, b: { x: at.x + dx, y: at.y + dy } };
    }
  }
}

/**
 * What an object's markers draw at the ends of its shape, `k` shape units to the paper inch
 * (25.4 × the layer's scale in millimetres: markers keep their size on paper, as dashes do).
 */
export function markerPaths(s: Shape, markers: LineMarkers, k: number): MarkerPath[] {
  const ends = shapeEnds(s);
  if (!ends) return [];
  const out: MarkerPath[] = [];
  const start = markers.start && ends.start && markerPath(markers.start, ends.start, k);
  const end = markers.end && ends.end && markerPath(markers.end, ends.end, k);
  if (start) out.push(start);
  if (end) out.push(end);
  return out;
}

/** Markers as an object placed by a mirroring transform draws them: a slash turns the other way. */
export function mirrorMarkers(markers: LineMarkers): LineMarkers {
  const flip = (m: LineMarker | undefined) => m && (m.style === "slash" ? { ...m, angle: -m.angle } : m);
  const start = flip(markers.start);
  const end = flip(markers.end);
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}
