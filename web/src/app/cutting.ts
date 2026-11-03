// Cutting geometry for the Trim, Split and Connect tools. Pure: no DOM, no store.
//
// A shape is read as a path (pathOf): a chain of straight pieces (a line, a polyline
// or a polygon; a closed chain also has its closing edge, and a rectangle is a closed
// polygon) or one circular arc. A position on a path is a parameter: a chain runs from
// 0 to its segment count (segment i covers i to i + 1), an arc from 0 at its start
// angle to 1 at the end of its sweep. A closed path wraps at its span. Arc angles are
// degrees, counter-clockwise from +x; coordinates are document units, y up.

import type { BBox, NewShape, Pt, Shape } from "../core/index.ts";
import { bboxOfPoints, clamp, degToRad, dist, ellipsePoints } from "./geom.ts";

/** A shape read as a path. */
export type CutPath = ChainPath | ArcPath;

/** Straight pieces through `pts`; a closed chain also runs from its last point back to its first. */
export interface ChainPath {
  readonly kind: "chain";
  /** the shape kind that open pieces are made as: a line stays a line */
  readonly source: "line" | "polyline" | "polygon";
  readonly pts: readonly Pt[];
  readonly closed: boolean;
}

/** A circular arc; `closed` marks a full circle. */
export interface ArcPath {
  readonly kind: "arc";
  readonly centre: Pt;
  readonly radius: number;
  /** start angle in degrees */
  readonly start: number;
  /** signed sweep in degrees; negative runs clockwise */
  readonly sweep: number;
  readonly closed: boolean;
}

/** A polyline to draw; `closed` joins the last point back to the first. */
export interface Outline {
  readonly pts: readonly Pt[];
  readonly closed: boolean;
}

/**
 * One piece of a path. `base` is where it starts on the path's parameter. A
 * `whole` piece is the infinite line or the full circle it lies on, not just the piece.
 */
type Piece =
  | { readonly kind: "seg"; readonly a: Pt; readonly b: Pt; readonly base: number; readonly whole: boolean }
  | { readonly kind: "arc"; readonly arc: ArcPath; readonly base: number; readonly whole: boolean };

type Seg = Extract<Piece, { kind: "seg" }>;

/** A crossing of two pieces: the point, and its local parameter on each piece. */
interface Hit {
  readonly p: Pt;
  readonly ta: number;
  readonly tb: number;
}

/** Parameters closer than this are the same place. */
const TOL = 1e-7;
/** Lengths below this (document units) count as zero. */
const LEN_TOL = 1e-9;
/** Angles this close (degrees) to the end of a sweep count as the end. */
const ANG_TOL = 1e-7;
/** Local parameters this far outside a segment still count as on it. */
const EDGE_TOL = 1e-9;
/** Relative slack on a circle's squared distance, so tangent circles and lines still cross. */
const TANGENT_TOL = 1e-10;
/** Bounding boxes this close still count as touching. */
const BOX_TOL = 1e-6;

const paths = new WeakMap<Shape, CutPath | null>();

/**
 * The path of a line, polyline, polygon, rectangle or circular arc (rx === ry);
 * null for anything else (text, images, ellipses). Memoised per shape object.
 */
export function pathOf(shape: Shape): CutPath | null {
  const known = paths.get(shape);
  if (known !== undefined) return known;
  const path = readPath(shape);
  paths.set(shape, path);
  return path;
}

function readPath(shape: Shape): CutPath | null {
  switch (shape.kind) {
    case "line":
    case "polyline":
    case "polygon":
    case "rect": {
      const wraps = shape.kind === "rect" || (shape.kind !== "line" && shape.closed);
      const pts = distinctPoints(shape.points, wraps);
      if (pts.length < 2) return null;
      const closed = wraps && pts.length >= 3;
      const source = shape.kind === "line" ? "line" : shape.kind === "polyline" ? "polyline" : "polygon";
      return { kind: "chain", source, pts, closed };
    }
    case "arc": {
      const rx = shape.rx;
      const c = shape.center;
      if (!c || rx === undefined || !(rx > 0) || (shape.ry ?? rx) !== rx) return null;
      const sweep = shape.sweepAngle ?? 360;
      if (!(Math.abs(sweep) > 0)) return null;
      return {
        kind: "arc",
        centre: c,
        radius: rx,
        start: shape.startAngle ?? 0,
        sweep,
        closed: Math.abs(sweep) >= 360,
      };
    }
    default:
      return null;
  }
}

/** Drops repeated neighbours (and, when `closed`, a last point equal to the first). */
function distinctPoints(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > LEN_TOL) out.push(p);
  }
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) <= LEN_TOL) out.pop();
  return out;
}

/** Length of a path's parameter range: the segment count (a closed chain's closing edge included), or 1 for an arc. */
export function spanOf(path: CutPath): number {
  if (path.kind === "arc") return 1;
  return path.closed ? path.pts.length : path.pts.length - 1;
}

/** True for the objects Connect extends: straight lines and open arcs. */
export function isLineOrArc(path: CutPath): boolean {
  return path.kind === "arc" ? !path.closed : path.source === "line";
}

/** The point at parameter t. Closed paths wrap; open ones are clamped to their ends. */
export function pointAt(path: CutPath, t: number): Pt {
  if (path.kind === "arc") {
    const a = degToRad(path.start + t * path.sweep);
    return { x: path.centre.x + path.radius * Math.cos(a), y: path.centre.y + path.radius * Math.sin(a) };
  }
  const n = path.pts.length;
  const u = path.closed ? mod(t, n) : clamp(t, 0, n - 1);
  const seg = Math.min(Math.floor(u), path.closed ? n - 1 : n - 2);
  return segPoint(path.pts[seg], path.pts[(seg + 1) % n], u - seg);
}

/** Parameter of the point of `path` nearest to `p`. */
export function nearestParam(path: CutPath, p: Pt): number {
  if (path.kind === "arc") {
    const f = arcFraction(path, angleOf(path.centre, p), false);
    if (f !== null) return f;
    // off the sweep: the nearer end
    return dist(p, pointAt(path, 0)) <= dist(p, pointAt(path, 1)) ? 0 : 1;
  }
  const n = path.pts.length;
  const span = spanOf(path);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < span; i++) {
    const a = path.pts[i];
    const b = path.pts[(i + 1) % n];
    const t = clamp(projection(p, a, b), 0, 1);
    const d = dist(p, segPoint(a, b, t));
    if (d < bestDist) {
      bestDist = d;
      best = i + t;
    }
  }
  return path.closed ? mod(best, span) : best;
}

/**
 * Parameters on `path` where it meets any of `others`, sorted. Places within TOL
 * count once; on a closed path the wrap point counts once too.
 */
export function intersections(path: CutPath, others: readonly CutPath[]): number[] {
  const mine = piecesOf(path);
  const box = boxOf(path);
  const found: number[] = [];
  for (const other of others) {
    if (!overlaps(box, boxOf(other))) continue;
    const theirs = piecesOf(other);
    for (const a of mine) {
      for (const b of theirs) {
        for (const h of pieceHits(a, b)) found.push(a.base + h.ta);
      }
    }
  }
  return normalise(found, spanOf(path), path.closed);
}

/**
 * The stretch a trim click at parameter t removes: from the nearest crossing on
 * each side of t to the next one (on a closed path the ring wraps). Null when a
 * closed path has fewer than two crossings. On an open path the stretch runs to
 * the end where nothing crosses on that side. `hits` must be sorted.
 */
export function trimRange(
  path: CutPath,
  t: number,
  hits: readonly number[],
): { readonly t0: number; readonly t1: number } | null {
  if (path.closed && hits.length < 2) return null;
  let t0: number | undefined;
  let t1: number | undefined;
  for (const h of hits) {
    if (h <= t + TOL) t0 = h;
    else if (t1 === undefined) t1 = h;
  }
  if (path.closed) {
    return { t0: t0 ?? hits[hits.length - 1] - spanOf(path), t1: t1 ?? hits[0] + spanOf(path) };
  }
  return { t0: t0 ?? 0, t1: t1 ?? spanOf(path) };
}

/**
 * The part of `path` from parameter t0 to t1 (t0 < t1) as new shapes: one shape,
 * or none when the stretch is empty. Closed paths accept parameters outside their
 * span, as long as t1 - t0 is at most one span. A piece of an arc is an arc.
 */
export function cutPieces(path: CutPath, t0: number, t1: number): NewShape[] {
  if (!(t1 - t0 > TOL)) return [];
  if (path.kind === "arc") {
    const startAngle = mod(path.start + t0 * path.sweep, 360);
    return [{ kind: "arc", center: path.centre, radius: path.radius, startAngle, sweepAngle: (t1 - t0) * path.sweep }];
  }
  const n = path.pts.length;
  const pts: Pt[] = [pointAt(path, t0)];
  for (let k = Math.floor(t0); k <= Math.ceil(t1); k++) {
    if (k > t0 + TOL && k < t1 - TOL) pts.push(path.pts[path.closed ? mod(k, n) : k]);
  }
  pts.push(pointAt(path, t1));
  const kept = distinctPoints(pts, false);
  if (kept.length < 2) return [];
  if (path.source === "line") return [{ kind: "line", a: kept[0], b: kept[1] }];
  if (path.source === "polyline") return [{ kind: "polyline", points: kept, closed: false }];
  return [{ kind: "polygon", points: kept, closed: false }];
}

/**
 * What is left of `path` when the stretch t0 to t1 is cut away: the two outer
 * stretches of an open path, or one open shape for a closed path.
 */
export function keepOutside(path: CutPath, t0: number, t1: number): NewShape[] {
  const span = spanOf(path);
  if (path.closed) return cutPieces(path, t1, t0 + span);
  return [...cutPieces(path, 0, t0), ...cutPieces(path, t1, span)];
}

/**
 * `path` cut at parameter t: two shapes for an open path, or one open shape that
 * starts and ends at t for a closed one. An open path cut at its end gives one shape.
 */
export function splitAt(path: CutPath, t: number): NewShape[] {
  const span = spanOf(path);
  if (path.closed) return cutPieces(path, t, t + span);
  return [...cutPieces(path, 0, t), ...cutPieces(path, t, span)];
}

/**
 * `path` cut at each of the sorted parameters `hits` (the Split tool's Line Split): the pieces
 * between them for an open path. A closed polygon cut twice becomes two closed polygons that
 * share the cut; a closed path cut once opens there, as splitAt does; any other closed path falls
 * into the open pieces between the cuts (a circle cut twice, two arcs).
 */
export function splitAtAll(path: CutPath, hits: readonly number[]): NewShape[] {
  if (hits.length === 0) return [];
  const span = spanOf(path);
  if (!path.closed) {
    const ts = [0, ...hits, span];
    return ts.slice(1).flatMap((t, i) => cutPieces(path, ts[i], t));
  }
  if (hits.length === 1) return splitAt(path, hits[0]);
  const pieces = hits.flatMap((t, i) => cutPieces(path, t, i + 1 < hits.length ? hits[i + 1] : hits[0] + span));
  if (hits.length !== 2 || path.kind !== "chain") return pieces;
  return pieces.map((s) => ((s.kind === "polygon" || s.kind === "polyline") && s.points.length >= 3 ? { ...s, closed: true } : s));
}

/**
 * Where `first` (a line, or an arc's circle) meets `second`: the crossing nearest
 * `near`, or null when they never meet.
 */
export function meetPoint(first: CutPath, second: CutPath, near: Pt): Pt | null {
  const whole = wholeOf(first);
  if (!whole) return null;
  let best: Pt | null = null;
  let bestDist = Infinity;
  for (const b of piecesOf(second)) {
    for (const h of pieceHits(whole, b)) {
      const d = dist(h.p, near);
      if (d < bestDist) {
        best = h.p;
        bestDist = d;
      }
    }
  }
  return best;
}

/**
 * Where two lines or arcs would meet if both ran on (each along its line or circle), nearest
 * `near`; null when they never do (parallel lines, circles apart) or one is not a line or arc.
 */
export function meetExtended(first: CutPath, second: CutPath, near: Pt): Pt | null {
  const a = wholeOf(first);
  const b = wholeOf(second);
  if (!a || !b) return null;
  let best: Pt | null = null;
  for (const h of pieceHits(a, b)) if (!best || dist(h.p, near) < dist(best, near)) best = h.p;
  return best;
}

/**
 * `path` (a line or an open arc) with one end moved to `to`: `end` 0 is the start,
 * 1 the end. An arc keeps its direction and its other end. Null when nothing would
 * be left.
 */
export function moveEnd(path: CutPath, end: 0 | 1, to: Pt): NewShape | null {
  if (path.kind === "arc") {
    const s = path.sweep < 0 ? -1 : 1;
    const theta = angleOf(path.centre, to);
    const far = path.start + path.sweep;
    const [start, sweep] =
      end === 1
        ? [path.start, s * mod(s * (theta - path.start), 360)]
        : [theta, s * mod(s * (far - theta), 360)];
    if (Math.abs(sweep) <= ANG_TOL) return null;
    return { kind: "arc", center: path.centre, radius: path.radius, startAngle: mod(start, 360), sweepAngle: sweep };
  }
  if (path.source !== "line" || path.pts.length !== 2) return null;
  const [a, b] = path.pts;
  if (dist(to, end === 0 ? b : a) <= LEN_TOL) return null;
  return end === 0 ? { kind: "line", a: to, b } : { kind: "line", a, b: to };
}

/** Which end of a line or arc lies nearer `p`: 0 for the start, 1 for the end. */
export function nearerEnd(path: CutPath, p: Pt): 0 | 1 {
  return dist(p, pointAt(path, 0)) <= dist(p, pointAt(path, spanOf(path))) ? 0 : 1;
}

/** Distance from `p` to the nearest point of `path`. */
export function distanceToPath(path: CutPath, p: Pt): number {
  return dist(p, pointAt(path, nearestParam(path, p)));
}

/** The outline of a path to draw; arcs are sampled. */
export function pathOutline(path: CutPath): Outline {
  if (path.kind === "chain") return { pts: path.pts, closed: path.closed };
  return {
    pts: ellipsePoints(path.centre, path.radius, path.radius, path.start, path.sweep, arcSteps(path.sweep)),
    closed: false,
  };
}

/** The outline of a new shape to draw; null for text. */
export function shapeOutline(shape: NewShape): Outline | null {
  switch (shape.kind) {
    case "line":
      return { pts: [shape.a, shape.b], closed: false };
    case "polygon":
    case "polyline":
      return { pts: shape.points, closed: shape.closed };
    case "arc":
      return {
        pts: ellipsePoints(
          shape.center,
          shape.radius,
          shape.radius,
          shape.startAngle,
          shape.sweepAngle,
          arcSteps(shape.sweepAngle),
        ),
        closed: false,
      };
    default:
      return null;
  }
}

function arcSteps(sweepDeg: number): number {
  return Math.max(16, Math.ceil(Math.abs(sweepDeg) / 2));
}

/** x modulo m, in [0, m). */
function mod(x: number, m: number): number {
  return ((x % m) + m) % m;
}

/** Angle of p seen from c, in degrees. */
function angleOf(c: Pt, p: Pt): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

function segPoint(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Position of p along a-b as a fraction (0 at a, 1 at b, unclamped); 0 when a equals b. */
function projection(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  return len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
}

/**
 * Fraction (0 to 1) of an arc's sweep at angle `theta` (degrees). Null when the
 * angle is off the sweep, unless `whole` (then the fraction is taken modulo a turn).
 */
function arcFraction(arc: ArcPath, theta: number, whole: boolean): number | null {
  const len = Math.abs(arc.sweep);
  const d = mod(arc.sweep > 0 ? theta - arc.start : arc.start - theta, 360);
  if (whole || d <= len + ANG_TOL) return Math.min(d / len, 1);
  return 360 - d <= ANG_TOL ? 0 : null;
}

/** The pieces of a path, in parameter order. */
function piecesOf(path: CutPath): Piece[] {
  if (path.kind === "arc") return [{ kind: "arc", arc: path, base: 0, whole: false }];
  const n = path.pts.length;
  const out: Piece[] = [];
  for (let i = 0; i < spanOf(path); i++) {
    out.push({ kind: "seg", a: path.pts[i], b: path.pts[(i + 1) % n], base: i, whole: false });
  }
  return out;
}

/** The line or circle a path lies on, as an unbounded piece; null for a chain that is not one segment. */
function wholeOf(path: CutPath): Piece | null {
  if (path.kind === "arc") return { kind: "arc", arc: path, base: 0, whole: true };
  if (path.pts.length !== 2 || path.closed) return null;
  const [a, b] = path.pts;
  return dist(a, b) > LEN_TOL ? { kind: "seg", a, b, base: 0, whole: true } : null;
}

/** Local parameter of p on a piece (a segment or sweep fraction), or null when p is off a bounded piece. */
function localOn(pc: Piece, p: Pt): number | null {
  if (pc.kind === "arc") return arcFraction(pc.arc, angleOf(pc.arc.centre, p), pc.whole);
  const t = projection(p, pc.a, pc.b);
  return pc.whole || (t >= -EDGE_TOL && t <= 1 + EDGE_TOL) ? t : null;
}

/** Crossings of two pieces, with the local parameter on each. */
function pieceHits(a: Piece, b: Piece): Hit[] {
  const out: Hit[] = [];
  for (const p of crossings(a, b)) {
    const ta = localOn(a, p);
    const tb = ta === null ? null : localOn(b, p);
    if (ta !== null && tb !== null) out.push({ p, ta, tb });
  }
  return out;
}

/** Where the lines or circles of two pieces cross. The caller checks each piece's own extent. */
function crossings(a: Piece, b: Piece): Pt[] {
  if (a.kind === "seg") return b.kind === "seg" ? linesCross(a, b) : lineCircle(a, b.arc);
  return b.kind === "seg" ? lineCircle(b, a.arc) : circlesCross(a.arc, b.arc);
}

/** Where the infinite lines through two segments cross; none when they are parallel. */
function linesCross(s: Seg, t: Seg): Pt[] {
  const ux = s.b.x - s.a.x;
  const uy = s.b.y - s.a.y;
  const vx = t.b.x - t.a.x;
  const vy = t.b.y - t.a.y;
  const den = ux * vy - uy * vx;
  if (!(Math.abs(den) > 1e-12 * Math.hypot(ux, uy) * Math.hypot(vx, vy))) return [];
  const wx = t.a.x - s.a.x;
  const wy = t.a.y - s.a.y;
  const k = (wx * vy - wy * vx) / den;
  return [{ x: s.a.x + ux * k, y: s.a.y + uy * k }];
}

/** Where the infinite line through a segment crosses an arc's circle (up to two points). */
function lineCircle(s: Seg, arc: ArcPath): Pt[] {
  const len = dist(s.a, s.b);
  if (!(len > LEN_TOL)) return [];
  const ux = (s.b.x - s.a.x) / len;
  const uy = (s.b.y - s.a.y) / len;
  const wx = arc.centre.x - s.a.x;
  const wy = arc.centre.y - s.a.y;
  const along = wx * ux + wy * uy;
  const off = ux * wy - uy * wx;
  const r2 = arc.radius * arc.radius;
  const k2 = r2 - off * off;
  if (k2 < -TANGENT_TOL * r2) return [];
  const k = Math.sqrt(Math.max(k2, 0));
  const us = k > 0 ? [along - k, along + k] : [along];
  return us.map((u) => ({ x: s.a.x + ux * u, y: s.a.y + uy * u }));
}

/** Where two circles cross (up to two points). */
function circlesCross(A: ArcPath, B: ArcPath): Pt[] {
  const dx = B.centre.x - A.centre.x;
  const dy = B.centre.y - A.centre.y;
  const d = Math.hypot(dx, dy);
  const r1 = A.radius;
  const r2 = B.radius;
  if (!(d > LEN_TOL)) return [];
  const slack = 1e-9 * Math.max(1, r1 + r2);
  if (d > r1 + r2 + slack || d < Math.abs(r1 - r2) - slack) return [];
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - along * along, 0));
  const ux = dx / d;
  const uy = dy / d;
  const mx = A.centre.x + ux * along;
  const my = A.centre.y + uy * along;
  return [
    { x: mx - uy * h, y: my + ux * h },
    { x: mx + uy * h, y: my - ux * h },
  ];
}

function boxOf(path: CutPath): BBox {
  if (path.kind === "arc") {
    const { x, y } = path.centre;
    return { x0: x - path.radius, y0: y - path.radius, x1: x + path.radius, y1: y + path.radius };
  }
  return bboxOfPoints(path.pts) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.x0 <= b.x1 + BOX_TOL && b.x0 <= a.x1 + BOX_TOL && a.y0 <= b.y1 + BOX_TOL && b.y0 <= a.y1 + BOX_TOL;
}

/** Sorts parameters, wraps them into [0, span) on a closed path (clamps on an open one), merges places within TOL. */
function normalise(ts: readonly number[], span: number, closed: boolean): number[] {
  const sorted = ts.map((t) => (closed ? mod(t, span) : clamp(t, 0, span))).sort((x, y) => x - y);
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] > TOL) out.push(t);
  }
  // the last place may be the first one again, one span later
  if (closed && out.length > 1 && out[0] + span - out[out.length - 1] <= TOL) out.pop();
  return out;
}
