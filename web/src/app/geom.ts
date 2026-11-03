// Pure 2D helpers in document units (y up). No DOM access.

import type { BBox, Pt } from "../core/index.ts";

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1) : 0;
  return Math.hypot(a.x + vx * t - p.x, a.y + vy * t - p.y);
}

/** Distance from p to a polyline; `closed` adds the segment back to the first point. */
export function distToPolyline(p: Pt, pts: readonly Pt[], closed: boolean): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  if (closed) best = Math.min(best, distToSegment(p, pts[last], pts[0]));
  return best;
}

export function pointInPolygon(p: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function bboxOfPoints(pts: readonly Pt[]): BBox | null {
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

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

export function bboxInside(inner: BBox, outer: BBox): boolean {
  return inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
}

/** Whether segment a–b touches `box` (Liang–Barsky clipping). */
export function segmentTouchesBBox(a: Pt, b: Pt, box: BBox): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // each pair: p·t <= q keeps the segment on the inner side of one box edge
  for (const [p, q] of [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function normalizeRect(a: Pt, b: Pt): BBox {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

/** Points on an ellipse arc; angles in degrees, counter-clockwise from +x. */
export function ellipsePoints(
  c: Pt,
  rx: number,
  ry: number,
  startDeg: number,
  sweepDeg: number,
  steps: number,
): Pt[] {
  const out: Pt[] = [];
  const a0 = degToRad(startDeg);
  const total = degToRad(sweepDeg);
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (total * i) / steps;
    out.push({ x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) });
  }
  return out;
}

/** where angle steps start, radians: 0, or in a rotated plan the screen's horizontal (see setAngleBase) */
let angleBase = 0;

/** Starts constrainAngle's and snapAngle's steps at `rad` (a rotated plan's screen horizontal), 0 for the drawing's x axis. */
export function setAngleBase(rad: number): void {
  angleBase = rad;
}

/** Projects `to` onto the nearest 45-degree direction from `from`, keeping its length. */
export function constrainAngle(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const a = Math.round((Math.atan2(dy, dx) - angleBase) / step) * step + angleBase;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

/** Angle step, in degrees, that Shift constrains lines and polyline segments to. */
export const ANGLE_STEP_DEG = 15;

/** Projects `to` onto the nearest `stepDeg` direction from `from`, keeping its length. */
export function snapAngle(from: Pt, to: Pt, stepDeg: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = degToRad(stepDeg);
  const a = Math.round((Math.atan2(dy, dx) - angleBase) / step) * step + angleBase;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

/** Length and angle (degrees, counter-clockwise from +x, y up) of `to` as seen from `from`. */
export function polarOf(from: Pt, to: Pt): { length: number; angle: number } {
  return {
    length: Math.hypot(to.x - from.x, to.y - from.y),
    angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
  };
}

/** The point `length` away from `from` in direction `angle` (degrees, counter-clockwise from +x). */
export function polar(from: Pt, length: number, angle: number): Pt {
  const a = degToRad(angle);
  return { x: from.x + length * Math.cos(a), y: from.y + length * Math.sin(a) };
}

/**
 * Grid spacing in document units: the smallest 1/2/5 x 10^n step that is at
 * least `minPx` CSS pixels apart at the given zoom (so it lands in ~20-50 px).
 */
export function niceStep(pxPerUnit: number, minPx = 20): number {
  if (!(pxPerUnit > 0)) return 1;
  let exp = Math.floor(Math.log10(minPx / pxPerUnit)) - 1;
  for (let guard = 0; guard < 60; guard++, exp++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** exp;
      if (step * pxPerUnit >= minPx) return Number(step.toPrecision(12));
    }
  }
  return 1;
}

// ---- offset and fillet ----------------------------------------------------

/** Lengths below this (document units) count as zero. */
const EPS = 1e-9;

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scaleBy(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

/** z component of the cross product: positive when b is counter-clockwise from a (y up). */
function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

function normalized(v: Pt): Pt {
  const len = Math.hypot(v.x, v.y);
  return len > EPS ? scaleBy(v, 1 / len) : { x: 0, y: 0 };
}

/** Unit vector from a towards b; the zero vector when they are (nearly) the same point. */
export function unitVector(a: Pt, b: Pt): Pt {
  return normalized(sub(b, a));
}

/** +1 when p is left of the directed line a -> b (y up), -1 when right, 0 when on it or when a == b. */
export function sideOf(p: Pt, a: Pt, b: Pt): number {
  const len = dist(a, b);
  if (len <= EPS) return 0;
  const offset = cross(sub(b, a), sub(p, a)) / len;
  return offset > EPS ? 1 : offset < -EPS ? -1 : 0;
}

/** Signed area of a closed outline (shoelace formula): positive when counter-clockwise, y up. */
export function signedArea(pts: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return sum / 2;
}

/**
 * Intersection of the infinite lines p + s·pd and q + t·qd, or null when they
 * are parallel. Near-zero directions count as parallel.
 */
export function intersectLines(p: Pt, pd: Pt, q: Pt, qd: Pt): Pt | null {
  const den = cross(pd, qd);
  const scale = Math.hypot(pd.x, pd.y) * Math.hypot(qd.x, qd.y);
  if (!(Math.abs(den) > 1e-12 * scale)) return null;
  const s = cross(sub(q, p), qd) / den;
  return add(p, scaleBy(pd, s));
}

/** True when two segments are parallel (or one has no length), so their lines never meet. */
export function linesParallel(a1: Pt, b1: Pt, a2: Pt, b2: Pt): boolean {
  return intersectLines(a1, unitVector(a1, b1), a2, unitVector(a2, b2)) === null;
}

/** Index of the segment nearest p: edge i runs from pts[i] to pts[i + 1] (wrapping when closed); null when there is none. */
export function nearestSegment(p: Pt, pts: readonly Pt[], closed: boolean): number | null {
  const count = closed ? pts.length : pts.length - 1;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Multiplier for an offset that goes towards p, with offsetPolyline's sign
 * convention (+1 = left of travel). Closed outlines offset inwards when p is
 * inside them and outwards otherwise; open ones to the side of the nearest edge.
 */
export function offsetSide(p: Pt, pts: readonly Pt[], closed: boolean): number {
  if (closed) {
    // the left of a counter-clockwise outline is its inside
    const ccw = signedArea(pts) >= 0;
    return pointInPolygon(p, pts) === ccw ? 1 : -1;
  }
  const i = nearestSegment(p, pts, false);
  if (i === null) return 1;
  return sideOf(p, pts[i], pts[i + 1]) < 0 ? -1 : 1;
}

/** Radius of a circle or arc moved by `d` (outwards positive), or null when that is not a positive radius. */
export function offsetRadius(radius: number, d: number): number | null {
  const r = radius + d;
  return Number.isFinite(r) && r > EPS ? r : null;
}

/**
 * Offsets an open or closed polyline by `d` along the left normal of each edge
 * (negative = right). Neighbouring offset edges meet at a mitre; parallel
 * neighbours use the shifted vertex. Returns the offset vertices in order, or
 * null when the offset collapses an edge (it turns back on itself or vanishes).
 */
export function offsetPolyline(pts: readonly Pt[], closed: boolean, d: number): Pt[] | null {
  if (!Number.isFinite(d)) return null;
  // repeated points have no direction; a closed outline may repeat its first point at the end
  const src: Pt[] = [];
  for (const p of pts) {
    const last = src[src.length - 1];
    if (!last || dist(last, p) > EPS) src.push(p);
  }
  if (closed && src.length > 1 && dist(src[0], src[src.length - 1]) <= EPS) src.pop();
  const n = src.length;
  if (n < (closed ? 3 : 2)) return null;

  const edges = closed ? n : n - 1;
  const dirs: Pt[] = [];
  const normals: Pt[] = [];
  for (let e = 0; e < edges; e++) {
    const u = unitVector(src[e], src[(e + 1) % n]);
    dirs.push(u);
    normals.push({ x: -u.y, y: u.x });
  }
  // where edge e starts on its offset line
  const start = (e: number): Pt => add(src[e], scaleBy(normals[e], d));

  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const inEdge = closed ? (i - 1 + n) % n : i - 1; // -1 at the open start
    const outEdge = i < edges ? i : -1; // -1 at the open end
    if (inEdge < 0) {
      out.push(start(outEdge));
    } else if (outEdge < 0) {
      out.push(add(src[i], scaleBy(normals[inEdge], d)));
    } else {
      out.push(intersectLines(start(inEdge), dirs[inEdge], start(outEdge), dirs[outEdge]) ?? start(outEdge));
    }
  }

  // an offset edge that turns back on itself or shrinks to nothing means the offset has collapsed
  for (let e = 0; e < edges; e++) {
    const a = out[e];
    const b = out[(e + 1) % n];
    if (dist(a, b) <= EPS || dot(sub(b, a), dirs[e]) <= 0) return null;
  }
  return out;
}

/** A straight segment by its end points. */
export interface LineSeg {
  readonly a: Pt;
  readonly b: Pt;
}

/** A fillet between two lines: its arc and both lines trimmed to the tangent points. */
export interface Fillet {
  readonly centre: Pt;
  readonly radius: number;
  /** arc start and sweep in degrees, counter-clockwise positive from +x; the sweep is under 180 */
  readonly startAngle: number;
  readonly sweepAngle: number;
  /** each line with one end moved to its tangent point, the far end kept (see trimEnd); a and b keep their roles */
  readonly line1: LineSeg;
  readonly line2: LineSeg;
}

/**
 * `seg` trimmed to the tangent point at `reach` along `dir` from `corner`. The
 * end on the far side from the corner stays. When the segment reaches past the
 * tangent point on that side, the end nearer the corner is the one replaced;
 * otherwise (the segment lies between the corner and the tangent point, or
 * beyond the corner) the end nearer the tangent point is replaced, so the line
 * is extended to it.
 */
function trimEnd(seg: LineSeg, corner: Pt, dir: Pt, reach: number): LineSeg {
  const tangent = add(corner, scaleBy(dir, reach));
  const sa = dot(sub(seg.a, corner), dir);
  const sb = dot(sub(seg.b, corner), dir);
  const aIsLow = sa < sb;
  const hi = aIsLow ? sb : sa;
  const replaceA = hi >= reach ? aIsLow : !aIsLow;
  return replaceA ? { a: tangent, b: seg.b } : { a: seg.a, b: tangent };
}

/**
 * Fillet of `radius` tangent to two straight lines. The corner is where the
 * infinite lines meet; `click1` and `click2` (points on each line) choose the
 * part of each line the corner sits on. Null when the lines are parallel, the
 * radius is not positive, or a line would be trimmed to nothing.
 */
export function filletLines(l1: LineSeg, click1: Pt, l2: LineSeg, click2: Pt, radius: number): Fillet | null {
  if (!(radius > 0) || linesParallel(l1.a, l1.b, l2.a, l2.b)) return null;
  const u1 = unitVector(l1.a, l1.b);
  const u2 = unitVector(l2.a, l2.b);
  const corner = intersectLines(l1.a, u1, l2.a, u2);
  if (!corner) return null;
  // unit rays from the corner along each line, towards the clicked part
  const d1 = scaleBy(u1, dot(sub(click1, corner), u1) < 0 ? -1 : 1);
  const d2 = scaleBy(u2, dot(sub(click2, corner), u2) < 0 ? -1 : 1);
  // angle between the rays, in (0, pi) since the lines are not parallel
  const theta = Math.atan2(Math.abs(cross(d1, d2)), dot(d1, d2));
  const half = theta / 2;
  const bis = normalized(add(d1, d2));
  if (bis.x === 0 && bis.y === 0) return null;
  const reach = radius / Math.tan(half); // corner to tangent point
  const centre = add(corner, scaleBy(bis, radius / Math.sin(half)));
  const t1 = add(corner, scaleBy(d1, reach));
  const t2 = add(corner, scaleBy(d2, reach));
  const line1 = trimEnd(l1, corner, d1, reach);
  const line2 = trimEnd(l2, corner, d2, reach);
  if (dist(line1.a, line1.b) <= EPS || dist(line2.a, line2.b) <= EPS) return null;
  // the short arc from t1 to t2 subtends pi - theta; it runs counter-clockwise from whichever end is first
  const v1 = sub(t1, centre);
  const v2 = sub(t2, centre);
  const first = cross(v1, v2) > 0 ? v1 : v2;
  const startDeg = (Math.atan2(first.y, first.x) * 180) / Math.PI;
  return {
    centre,
    radius,
    startAngle: ((startDeg % 360) + 360) % 360,
    sweepAngle: ((Math.PI - theta) * 180) / Math.PI,
    line1,
    line2,
  };
}
