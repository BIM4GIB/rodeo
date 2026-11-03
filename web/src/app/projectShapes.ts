// The sums behind the 3D Modeling set's Project tool: a curve projected along the normal of its plane through a
// solid or surface, to split it, trim it or stand a rib on it. A closed curve makes a prism; an open one
// is run on past the object at both ends and closed round one side, so its two sides are inside and outside
// that ring. Kept apart from the tool so it runs without the page.

import { intersectMeshes, MAX_CSG_TRIANGLES, subtractMeshes, trimmedMesh, unionMeshes } from "../core/csg.ts";
import { healed, insideRing, isClosedMesh, ringSlab, stitched, type Vec3 } from "./solidOps.ts";

export interface ProjectedCurve {
  readonly points: readonly Vec3[];
  readonly closed: boolean;
}

/** the most triangles facing a rib's profile that are worked through */
const MOST_FACING = 150;
/** how much a curve's points can leave its plane, as a share of its size, and still count as on it */
const FLAT_SHARE = 1e-4;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const n = length(a);
  return n ? scale(a, 1 / n) : [0, 0, 0];
};

const pointsOf = (tris: ArrayLike<number>): Vec3[] => {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < tris.length; i += 3) out.push([tris[i], tris[i + 1], tris[i + 2]]);
  return out;
};

const centreOf = (points: readonly Vec3[]): Vec3 => scale(points.reduce<Vec3>((sum, p) => add(sum, p), [0, 0, 0]), 1 / Math.max(points.length, 1));

/** How far the points reach from the origin of their bounding box's centre. */
function reachOf(points: readonly Vec3[]): { centre: Vec3; reach: number } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return { centre, reach: Math.max(length(sub(hi, lo)) / 2, 1) };
}

/**
 * The normal of the plane a curve lies on, turned to face up (or, on a wall, toward +y, then +x), so Add
 * Upward means the same however it was drawn. A straight curve has no plane of its own, so it's projected
 * straight down, or along x when it stands upright.
 */
export function curveNormal(curve: ProjectedCurve): Vec3 {
  const { points } = curve;
  const n = points.length;
  const c = centreOf(points);
  let sum: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) sum = add(sum, cross(sub(points[i], c), sub(points[(i + 1) % n], c)));
  let normal = unit(sum);
  if (length(sum) < reachOf(points).reach ** 2 * 1e-9) {
    const along = unit(sub(points[n - 1], points[0]));
    normal = Math.abs(along[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  }
  const facing = normal[2] < -1e-9 || (Math.abs(normal[2]) <= 1e-9 && (normal[1] < -1e-9 || (Math.abs(normal[1]) <= 1e-9 && normal[0] < 0)));
  return facing ? scale(normal, -1) : normal;
}

/** Whether a curve's points lie on one plane. */
export function isOnPlane(curve: ProjectedCurve, normal: Vec3): boolean {
  const c = centreOf(curve.points);
  const off = reachOf(curve.points).reach * FLAT_SHARE;
  return curve.points.every((p) => Math.abs(dot(sub(p, c), normal)) <= off);
}

const flattened = (points: readonly Vec3[], normal: Vec3): Vec3[] => {
  const c = centreOf(points);
  return points.map((p) => sub(p, scale(normal, dot(sub(p, c), normal))));
};

/** Two ways across a normal. */
function acrossOf(normal: Vec3): [Vec3, Vec3] {
  const u = unit(cross(normal, Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [u, cross(normal, u)];
}

/** Whether the line through `p` along `normal` meets the mesh. */
function lineMeets(p: Vec3, normal: Vec3, tris: ArrayLike<number>): boolean {
  const [u, v] = acrossOf(normal);
  const at = (q: Vec3): [number, number] => [dot(sub(q, p), u), dot(sub(q, p), v)];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [a, b, c] = [at([tris[i], tris[i + 1], tris[i + 2]]), at([tris[i + 3], tris[i + 4], tris[i + 5]]), at([tris[i + 6], tris[i + 7], tris[i + 8]])];
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const s = (a[1] * c[0] - a[0] * c[1]) / area;
    const t = (b[1] * a[0] - b[0] * a[1]) / area;
    if (s >= 0 && t >= 0 && s + t <= 1) return true;
  }
  return false;
}

/**
 * The ring a curve makes: the closed curve itself on its plane, or an open one run on straight past the object
 * at both ends and closed round one side. A message when an end of it lies over the object.
 */
export function ringOf(curve: ProjectedCurve, normal: Vec3, tris: ArrayLike<number>): Vec3[] | string {
  const points = flattened(curve.points, normal);
  if (curve.closed) return points.length >= 3 ? points : "That curve has too few points to enclose anything.";
  if (points.length < 2) return "That curve has too few points.";
  const [first, last] = [points[0], points[points.length - 1]];
  if (lineMeets(first, normal, tris) || lineMeets(last, normal, tris)) return "Both ends of an open curve must lie outside the object, seen along the curve's plane.";
  const { centre, reach } = reachOf(pointsOf(tris));
  const span = 2 * reach + length(sub(first, centre)) + length(sub(last, centre));
  const start = sub(first, scale(unit(sub(points[1], first)), span));
  const end = add(last, scale(unit(sub(last, points[points.length - 2])), span));
  const side = scale(unit(cross(normal, sub(end, start))), 2 * span);
  return [start, ...points, end, add(end, side), add(start, side)];
}

/** A prism on the ring along the normal, running through and past the whole mesh. */
function prismThrough(ring: readonly Vec3[], normal: Vec3, tris: ArrayLike<number>): number[] | string {
  const [origin] = ring;
  let [lo, hi] = [Infinity, -Infinity];
  for (const p of pointsOf(tris)) {
    const d = dot(sub(p, origin), normal);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  const margin = Math.max((hi - lo) * 0.1, 1);
  return ringSlab(ring.map((p) => add(p, scale(normal, lo - margin))), normal, hi - lo + 2 * margin);
}

/** A mesh in the pieces that share no corner. */
export function connectedParts(tris: ArrayLike<number>): number[][] {
  const { points, triangles } = stitched(tris);
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    for (let j = i; parent[j] !== r; ) [parent[j], j] = [r, parent[j]];
    return r;
  };
  for (const t of triangles) {
    parent[find(t[1])] = find(t[0]);
    parent[find(t[2])] = find(t[0]);
  }
  const parts = new Map<number, number[]>();
  for (const t of triangles) {
    const r = find(t[0]);
    const list = parts.get(r) ?? [];
    for (const v of t) list.push(...points[v]);
    parts.set(r, list);
  }
  return [...parts.values()];
}

const TOO_MANY = `this has more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces, too many to change`;

/** The solid or surface's part inside the prism, and outside it. */
function sides(tris: ArrayLike<number>, prism: readonly number[]): { inside: ArrayLike<number>; outside: ArrayLike<number> } | string {
  if (isClosedMesh(tris)) {
    const inside = intersectMeshes([tris, prism]);
    const outside = subtractMeshes(tris, [prism]);
    if (!inside || !outside) return TOO_MANY;
    return { inside: inside.triangles.length ? healed(inside.triangles) : [], outside: outside.triangles.length ? healed(outside.triangles) : [] };
  }
  const inside = trimmedMesh(tris, prism, true);
  const outside = trimmedMesh(tris, prism, false);
  if (!inside || !outside) return TOO_MANY;
  return { inside: inside.triangles, outside: outside.triangles };
}

/** The object cut along the projected curve, in pieces. */
export function splitBy(tris: ArrayLike<number>, ring: readonly Vec3[], normal: Vec3): number[][] | string {
  const prism = prismThrough(ring, normal, tris);
  if (typeof prism === "string") return prism;
  const found = sides(tris, prism);
  if (typeof found === "string") return found;
  const parts = [...connectedParts(found.inside), ...connectedParts(found.outside)];
  return parts.length >= 2 ? parts : "That curve doesn't cross this object along its plane.";
}

/** What's left of the object once the side of the projected curve holding `point` is taken away, in pieces. */
export function trimBy(tris: ArrayLike<number>, ring: readonly Vec3[], normal: Vec3, point: Vec3): number[][] | string {
  const prism = prismThrough(ring, normal, tris);
  if (typeof prism === "string") return prism;
  const found = sides(tris, prism);
  if (typeof found === "string") return found;
  if (!found.inside.length || !found.outside.length) return "That curve doesn't cross this object along its plane.";
  const kept = connectedParts(insideRing(point, ring, normal) ? found.outside : found.inside);
  return kept.length ? kept : "Nothing would be left of this object.";
}

/** The prism under a triangle, from `near` of each corner to `far` along the way, measured from the plane through `origin`. */
function triangleColumn(t: readonly [Vec3, Vec3, Vec3], origin: Vec3, way: Vec3, near: (height: number) => number, far: number): number[] {
  const place = (p: Vec3, at: number): Vec3 => add(p, scale(way, at - dot(sub(p, origin), way)));
  const low = t.map((p) => place(p, near(dot(sub(p, origin), way))));
  const high = t.map((p) => place(p, far));
  const out: number[] = [...low[0], ...low[2], ...low[1], ...high[0], ...high[1], ...high[2]];
  for (let k = 0; k < 3; k++) {
    const j = (k + 1) % 3;
    out.push(...low[k], ...low[j], ...high[j], ...low[k], ...high[j], ...high[k]);
  }
  return out;
}

/** The object with a rib stood on it: the closed ring swept along the way until it meets the object. Null when it never does. */
function ribOneWay(tris: ArrayLike<number>, ring: readonly Vec3[], way: Vec3): number[] | string | null {
  const [origin] = ring;
  let far = -Infinity;
  for (const p of pointsOf(tris)) far = Math.max(far, dot(sub(p, origin), way));
  if (far <= 0) return null;
  far += Math.max(far * 0.1, 1);
  const [u, v] = acrossOf(way);
  const [lo, hi] = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const p of ring) {
    const q = [dot(sub(p, origin), u), dot(sub(p, origin), v)];
    for (const k of [0, 1]) {
      lo[k] = Math.min(lo[k], q[k]);
      hi[k] = Math.max(hi[k], q[k]);
    }
  }
  const facing: (readonly [Vec3, Vec3, Vec3])[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const t: [Vec3, Vec3, Vec3] = [[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]];
    // back at the profile, ahead of it, and over it
    if (dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), way) >= -1e-6) continue;
    if (t.every((p) => dot(sub(p, origin), way) <= 0)) continue;
    const across = t.map((p) => [dot(sub(p, origin), u), dot(sub(p, origin), v)]);
    if (across.every((q) => q[0] < lo[0]) || across.every((q) => q[0] > hi[0]) || across.every((q) => q[1] < lo[1]) || across.every((q) => q[1] > hi[1])) continue;
    facing.push(t);
  }
  if (!facing.length) return null;
  if (facing.length > MOST_FACING) return `The part of this object facing that curve has more than ${MOST_FACING} faces, too many to work through.`;
  const whole = ringSlab(ring, way, far);
  if (typeof whole === "string") return whole;
  // over the triangles, from the profile to past the object
  const over = unionMeshes(facing.map((t) => triangleColumn(t, origin, way, () => 0, far)));
  if (!over) return TOO_MANY;
  const reaching = intersectMeshes([whole, over.triangles]);
  if (!reaching) return TOO_MANY;
  if (!reaching.triangles.length) return null;
  // less what lies past the first face met
  const rib = subtractMeshes(reaching.triangles, facing.map((t) => triangleColumn(t, origin, way, (height) => height, far)));
  if (!rib) return TOO_MANY;
  return rib.triangles.length ? healed(rib.triangles) : null;
}

/** The object with the closed curve projected onto it and added, in the directions asked for. */
export function ribOn(tris: ArrayLike<number>, ring: readonly Vec3[], normal: Vec3, ways: readonly (1 | -1)[]): number[] | string {
  if (!isClosedMesh(tris)) return "Add takes a closed solid, not an open surface.";
  const made: ArrayLike<number>[] = [];
  for (const w of ways) {
    const rib = ribOneWay(tris, ring, scale(normal, w));
    if (typeof rib === "string") return rib;
    if (rib) made.push(rib);
  }
  if (!made.length) return "The projection doesn't meet the object in that direction.";
  const joined = unionMeshes([tris, ...made]);
  if (!joined) return TOO_MANY;
  return healed(joined.triangles);
}
