// The sums behind the 3D Modeling set's Analysis tool: how near two objects come or where they cross, and how a
// curve or surface bends at a point. Rodeo's curves are polylines and its surfaces triangles, so curvature is
// the circle through neighbouring points, or fitted to how the neighbouring faces turn. Kept apart from the
// tool so it runs without the page.

import { joined, type Curve, type Point } from "./extractShapes.ts";
import { boxesMeet, crossingOf, nearestOnTriangle, trianglesOf, type Tri } from "./powerPackShapes.ts";
import { stitched } from "./solidOps.ts";

export type Thing =
  | { readonly kind: "point"; readonly point: Point }
  | { readonly kind: "curve"; readonly points: readonly Point[]; readonly closed: boolean }
  | { readonly kind: "mesh"; readonly tris: ArrayLike<number> };

/** how far apart two faces' normals can be and still count as one smooth surface */
const SMOOTH = Math.cos((20 * Math.PI) / 180);
/** how little a surface can bend and still have a circle to show, as curvature × its size */
const FLAT = 1e-3;
/** the fit isn't sure of a bend this small beside the other, which a mesh's facets alone can give */
const FLAT_BESIDE = 0.02;
/** past this many faces of one thing times faces of the other, comparing them is too slow to wait for */
const MAX_COMPARED = 16e6;

const sub = (a: readonly number[], b: readonly number[]): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: readonly number[], b: readonly number[]): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: readonly number[], k: number): Point => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): Point => {
  const n = length(a);
  return n ? scale(a, 1 / n) : [0, 0, 0];
};

type Segment = readonly [Point, Point];

interface Parts {
  readonly segments: readonly Segment[];
  readonly points: readonly Point[];
  readonly tris: readonly Tri[];
}

function partsOf(thing: Thing): Parts {
  if (thing.kind === "point") return { segments: [[thing.point, thing.point]], points: [thing.point], tris: [] };
  if (thing.kind === "curve") {
    const { points, closed } = thing;
    const n = points.length;
    const segments: Segment[] = [];
    for (let i = 0; i < (closed ? n : n - 1); i++) segments.push([points[i], points[(i + 1) % n]]);
    return { segments, points, tris: [] };
  }
  const mesh = stitched(thing.tris);
  const seen = new Set<string>();
  const segments: Segment[] = [];
  for (const t of mesh.triangles) {
    for (let k = 0; k < 3; k++) {
      const [p, q] = [t[k], t[(k + 1) % 3]];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push([mesh.points[p], mesh.points[q]]);
    }
  }
  return { segments, points: mesh.points, tris: trianglesOf(thing.tris) };
}

/** The nearest points of two straight pieces, either of which may be a single point. */
function nearestOfSegments(a: Segment, b: Segment): [Point, Point] {
  const [d1, d2, r] = [sub(a[1], a[0]), sub(b[1], b[0]), sub(a[0], b[0])];
  const [aa, ee, f] = [dot(d1, d1), dot(d2, d2), dot(d2, r)];
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  let [s, t] = [0, 0];
  if (aa <= 1e-12 && ee <= 1e-12) return [a[0], b[0]];
  if (aa <= 1e-12) t = clamp(f / ee);
  else {
    const c = dot(d1, r);
    if (ee <= 1e-12) s = clamp(-c / aa);
    else {
      const bb = dot(d1, d2);
      const denom = aa * ee - bb * bb;
      s = denom > 1e-12 ? clamp((bb * f - c * ee) / denom) : 0;
      t = (bb * s + f) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-c / aa);
      } else if (t > 1) {
        t = 1;
        s = clamp((bb - c) / aa);
      }
    }
  }
  return [add(a[0], scale(d1, s)), add(b[0], scale(d2, t))];
}

export interface Closest {
  readonly distance: number;
  /** on the first thing */
  readonly a: Point;
  /** on the second */
  readonly b: Point;
}

const boxOf = (points: readonly (readonly number[])[]): number[] => {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      out[k] = Math.min(out[k], p[k]);
      out[k + 3] = Math.max(out[k + 3], p[k]);
    }
  }
  return out;
};

const boxGap = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(Math.max(0, a[0] - b[3], b[0] - a[3]), Math.max(0, a[1] - b[4], b[1] - a[4]), Math.max(0, a[2] - b[5], b[2] - a[5]));

/** Where two things come nearest each other. */
export function closest(first: Thing, second: Thing): Closest {
  const [a, b] = [partsOf(first), partsOf(second)];
  let best: Closest = { distance: Infinity, a: [0, 0, 0], b: [0, 0, 0] };
  const offer = (p: Point, q: Point): void => {
    const distance = length(sub(p, q));
    if (distance < best.distance) best = { distance, a: p, b: q };
  };
  // each point against the other's faces
  const boxedA = a.tris.map((t) => ({ t, box: boxOf(t) }));
  const boxedB = b.tris.map((t) => ({ t, box: boxOf(t) }));
  for (const p of a.points) {
    const box = [p[0], p[1], p[2], p[0], p[1], p[2]];
    for (const o of boxedB) if (boxGap(box, o.box) < best.distance) offer(p, nearestOnTriangle(p, o.t));
  }
  for (const p of b.points) {
    const box = [p[0], p[1], p[2], p[0], p[1], p[2]];
    for (const o of boxedA) if (boxGap(box, o.box) < best.distance) offer(nearestOnTriangle(p, o.t), p);
  }
  // each piece against the other's
  const segsB = b.segments.map((s) => ({ s, box: boxOf(s) }));
  for (const s of a.segments) {
    const box = boxOf(s);
    for (const o of segsB) {
      if (boxGap(box, o.box) >= best.distance) continue;
      const [p, q] = nearestOfSegments(s, o.s);
      offer(p, q);
    }
  }
  return best;
}

/** Whether comparing two things would take too long to wait for. */
export function tooMany(a: Thing, b: Thing): boolean {
  const count = (t: Thing): number => (t.kind === "mesh" ? t.tris.length / 9 : t.kind === "curve" ? t.points.length : 1);
  return count(a) * count(b) > MAX_COMPARED;
}

/** The size of what a thing spans. */
function sizeOf(thing: Thing): number {
  const { points } = partsOf(thing);
  const box = boxOf(points);
  return Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1);
}

/** Where two meshes cross, as curves; none when they don't. */
export function meshCrossing(a: ArrayLike<number>, b: ArrayLike<number>): Curve[] {
  const [ta, tb] = [trianglesOf(a), trianglesOf(b)];
  const size = Math.max(sizeOf({ kind: "mesh", tris: a }), sizeOf({ kind: "mesh", tris: b }));
  const tol = size * 1e-7;
  const segments: Segment[] = [];
  for (const p of ta) {
    for (const q of tb) {
      if (!boxesMeet(p, q, tol)) continue;
      const hit = crossingOf(p, q, tol);
      if (hit && length(sub(hit[0], hit[1])) > tol) segments.push(hit);
    }
  }
  return joined(segments, size);
}

/** The points given, once each. */
function onceEach(points: readonly Point[], tol: number): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.some((q) => length(sub(p, q)) <= tol)) out.push(p);
  return out;
}

/** Where two curves meet. */
export function curvesMeet(a: Thing, b: Thing): Point[] {
  const tol = Math.max(sizeOf(a), sizeOf(b)) * 1e-7;
  const out: Point[] = [];
  const others = partsOf(b).segments;
  for (const s of partsOf(a).segments) {
    for (const o of others) {
      const [p, q] = nearestOfSegments(s, o);
      if (length(sub(p, q)) <= tol) out.push(p);
    }
  }
  return onceEach(out, tol * 10);
}

/** Where a curve passes through a mesh's faces. */
export function curveCrossings(curve: Thing, tris: ArrayLike<number>): Point[] {
  const { segments } = partsOf(curve);
  const out: Point[] = [];
  const list = trianglesOf(tris);
  for (const [p, q] of segments) {
    const dir = sub(q, p);
    for (const t of list) {
      const [e1, e2] = [sub(t[1], t[0]), sub(t[2], t[0])];
      const h = cross(dir, e2);
      const det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(p, t[0]);
      const u = dot(s, h) / det;
      if (u < 0 || u > 1) continue;
      const o = cross(s, e1);
      const v = dot(dir, o) / det;
      if (v < 0 || u + v > 1) continue;
      const w = dot(e2, o) / det;
      if (w >= 0 && w <= 1) out.push(add(p, scale(dir, w)));
    }
  }
  // through a line two faces share, it meets both
  return onceEach(out, Math.max(sizeOf(curve), sizeOf({ kind: "mesh", tris })) * 1e-6);
}

export interface CurveBend {
  /** the point on the curve */
  readonly point: Point;
  readonly tangent: Point;
  /** the circle through the points about it; null where the curve runs straight */
  readonly radius: number | null;
  readonly centre: Point | null;
  /** square to the circle's plane */
  readonly axis: Point | null;
}

/** How a polyline bends near a point on it. */
export function curveBend(points: readonly Point[], closed: boolean, at: Point): CurveBend {
  const n = points.length;
  let best = 0;
  let bestD = Infinity;
  let nearest = at;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [p, q] = nearestOfSegments([at, at], [points[i], points[(i + 1) % n]]);
    const d = length(sub(p, q));
    if (d < bestD) {
      bestD = d;
      best = i;
      nearest = q;
    }
  }
  const tangent = unit(sub(points[(best + 1) % n], points[best]));
  // the corner nearest the point, with one each side
  const near = length(sub(nearest, points[best])) <= length(sub(nearest, points[(best + 1) % n])) ? best : (best + 1) % n;
  const middle = closed ? near : Math.min(n - 2, Math.max(1, near));
  if (n < 3) return { point: nearest, tangent, radius: null, centre: null, axis: null };
  const [a, b, c] = [points[(middle + n - 1) % n], points[middle], points[(middle + 1) % n]];
  const [u, v] = [sub(a, b), sub(c, b)];
  const normal = cross(u, v);
  const nn = dot(normal, normal);
  const span = Math.max(length(u), length(v));
  if (nn <= (span * span * 1e-5) ** 2) return { point: nearest, tangent, radius: null, centre: null, axis: null };
  const centre = add(b, scale(add(scale(cross(v, normal), dot(u, u)), scale(cross(normal, u), dot(v, v))), 1 / (2 * nn)));
  const radius = length(sub(b, centre));
  // through the point on the curve itself, so it touches where the pointer is
  const toCentre = unit(sub(centre, nearest));
  return { point: nearest, tangent, radius, centre: add(nearest, scale(toCentre, radius)), axis: unit(normal) };
}

export interface SurfaceData {
  readonly points: readonly Point[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly normals: readonly Point[];
  /** the triangles at each point */
  readonly atPoint: readonly (readonly number[])[];
  readonly size: number;
}

/** What's worked out once for a surface, so following the pointer stays quick. */
export function surfaceData(tris: ArrayLike<number>): SurfaceData {
  const mesh = stitched(tris);
  const { points, triangles } = mesh;
  const atPoint: number[][] = points.map(() => []);
  const normals: Point[] = [];
  triangles.forEach((t, i) => {
    for (const v of t) atPoint[v].push(i);
    normals.push(unit(cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]]))));
  });
  const box = boxOf(points);
  return { points, triangles, normals, atPoint, size: Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2], 1) };
}

export interface PrincipalBend {
  readonly curvature: number;
  /** the way across the surface it's measured */
  readonly along: Point;
  /** null where it's flat that way */
  readonly radius: number | null;
  readonly centre: Point | null;
}

export interface SurfaceBend {
  readonly point: Point;
  readonly normal: Point;
  readonly bends: readonly [PrincipalBend, PrincipalBend];
}

/** How a surface bends at a point on it: the two ways it bends most and least, from how the faces round it turn. */
export function surfaceBend(data: SurfaceData, point: Point, clickNormal: Point): SurfaceBend {
  const { points, triangles, normals, atPoint, size } = data;
  let start = 0;
  let bestD = Infinity;
  let bestAlign = -1;
  // nearest the point; where it's on a line two faces share, the one facing as the click did
  triangles.forEach((t, i) => {
    const d = length(sub(nearestOnTriangle(point, [points[t[0]], points[t[1]], points[t[2]]]), point));
    const align = Math.abs(dot(normals[i], clickNormal));
    if (d < bestD - size * 1e-6 || (d <= bestD + size * 1e-6 && align > bestAlign)) [start, bestD, bestAlign] = [i, d, align];
  });
  // the faces round it, across smooth folds only: those touching its corners, then those touching theirs
  const flip = dot(normals[start], clickNormal) < 0 ? -1 : 1;
  const grown = (from: ReadonlySet<number>): Set<number> => {
    const out = new Set(from);
    for (const i of from) {
      for (const v of triangles[i]) {
        for (const o of atPoint[v]) if (Math.abs(dot(normals[o], normals[i])) > SMOOTH) out.add(o);
      }
    }
    return out;
  };
  const ring = grown(new Set([start]));
  const round = grown(ring);
  // the surface's normal at each point: its faces', weighted by the angle each has there, so how a quad was
  // split into triangles doesn't lean it
  const facing = new Map<number, Point>();
  for (const i of round) {
    const t = triangles[i];
    const n = scale(normals[i], dot(normals[i], normals[start]) < 0 ? -flip : flip);
    for (let k = 0; k < 3; k++) {
      const [u, v] = [sub(points[t[(k + 1) % 3]], points[t[k]]), sub(points[t[(k + 2) % 3]], points[t[k]])];
      facing.set(t[k], add(facing.get(t[k]) ?? [0, 0, 0], scale(n, Math.atan2(length(cross(u, v)), dot(u, v)))));
    }
  }
  const normalAt = (v: number): Point => unit(facing.get(v) ?? scale(normals[start], flip));
  // and where the click is, from its face's corners
  const [ta, tb, tc] = triangles[start];
  const [e0, e1v, ep] = [sub(points[tb], points[ta]), sub(points[tc], points[ta]), sub(point, points[ta])];
  const [d00, d01, d11, d20, d21] = [dot(e0, e0), dot(e0, e1v), dot(e1v, e1v), dot(ep, e0), dot(ep, e1v)];
  const area = d00 * d11 - d01 * d01 || 1;
  const [wb, wc] = [(d11 * d20 - d01 * d21) / area, (d00 * d21 - d01 * d20) / area];
  const normal = unit(add(add(scale(normalAt(ta), 1 - wb - wc), scale(normalAt(tb), wb)), scale(normalAt(tc), wc)));
  const across = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = unit(cross(normal, across));
  const e2 = cross(normal, e1);
  // the least squares fit of a symmetric map from moves across the surface to turns of its normal
  let [a11, a12, a22, a23, a33, b1, b2, b3] = [0, 0, 0, 0, 0, 0, 0, 0];
  const corners = new Set<number>();
  for (const i of ring) for (const v of triangles[i]) corners.add(v);
  for (const c of corners) {
    const dp = sub(points[c], point);
    const dn = sub(normalAt(c), normal);
    const [x, y] = [dot(dp, e1), dot(dp, e2)];
    const [u, v] = [dot(dn, e1), dot(dn, e2)];
    // u = s11 x + s12 y; v = s12 x + s22 y
    a11 += x * x;
    a12 += x * y;
    a22 += x * x + y * y;
    a23 += x * y;
    a33 += y * y;
    b1 += u * x;
    b2 += u * y + v * x;
    b3 += v * y;
  }
  // by Cramer's rule; too few faces round it to tell reads as flat
  const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33);
  let [s11, s12, s22] = [0, 0, 0];
  if (Math.abs(det) > 1e-9) {
    s11 = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3)) / det;
    s12 = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33)) / det;
    s22 = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3) + b1 * (a12 * a23)) / det;
  }
  // its two axes
  const mean = (s11 + s22) / 2;
  const diff = Math.hypot((s11 - s22) / 2, s12);
  const [k1, k2] = [mean + diff, mean - diff];
  const angle = 0.5 * Math.atan2(2 * s12, s11 - s22);
  const d1: Point = unit(add(scale(e1, Math.cos(angle)), scale(e2, Math.sin(angle))));
  const d2: Point = cross(normal, d1);
  const bend = (curvature: number, along: Point): PrincipalBend => {
    if (Math.abs(curvature) * size < FLAT || Math.abs(curvature) < FLAT_BESIDE * Math.max(Math.abs(k1), Math.abs(k2))) return { curvature: 0, along, radius: null, centre: null };
    return { curvature, along, radius: 1 / Math.abs(curvature), centre: add(point, scale(normal, -1 / curvature)) };
  };
  return { point, normal, bends: Math.abs(k1) >= Math.abs(k2) ? [bend(k1, d1), bend(k2, d2)] : [bend(k2, d2), bend(k1, d1)] };
}

/** The points of a circle. */
export function circlePoints(centre: Point, radius: number, axis: Point, n = 72): Point[] {
  const u = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const v = cross(axis, u);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return add(centre, add(scale(u, radius * Math.cos(t)), scale(v, radius * Math.sin(t))));
  });
}
