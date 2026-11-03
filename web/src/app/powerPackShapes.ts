// The sums behind Model > 3D Power Pack's Create Planar Caps, Create Drape Surface, Revolve with Rail,
// Create Surface from Curves and Unfold Surfaces. Rodeo has no NURBS surfaces, so each works on triangles
// or on the points of curves, and gives flat pieces back. World mm, z up; triangles are 9 numbers each.
// Kept apart from the page so a check can run it.

import { outward } from "../core/csg.ts";
import { capTriangles, type LoftCurve, type Point3 } from "./loftShapes.ts";
import { stitched, type Indexed } from "./solidOps.ts";

export type Point2 = readonly [number, number];

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Point3, k: number): Point3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Point3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Point3): Point3 => {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
};
const mix = (a: Point3, b: Point3, t: number): Point3 => add(scale(a, 1 - t), scale(b, t));

/** The size of the points' box, the longest way. */
function sizeOf(points: readonly Point3[]): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/** The way a ring of points faces, by Newell's sum: its area doubled, in length. */
function ringNormal(ring: readonly Point3[]): Point3 {
  let n: Point3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) n = add(n, cross(ring[i], ring[(i + 1) % ring.length]));
  return n;
}

/** Whether the ring lies in one plane, to a thousandth of its size. */
export function isFlatRing(ring: readonly Point3[]): boolean {
  const n = unit(ringNormal(ring));
  if (length(n) === 0) return false;
  const size = sizeOf(ring);
  return ring.every((p) => Math.abs(dot(n, sub(p, ring[0]))) <= size * 1e-3);
}

// ---- Create Planar Caps ----------------------------------------------------

/** The loops of sides with a triangle on one side only, each of point numbers. */
export function openLoops(mesh: Indexed): number[][] {
  const sides = new Map<string, { a: number; b: number; count: number }>();
  for (const t of mesh.triangles) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const side = sides.get(key);
      if (side) side.count++;
      else sides.set(key, { a, b, count: 1 });
    }
  }
  const next = new Map<number, number[]>();
  for (const { a, b, count } of sides.values()) {
    if (count !== 1) continue;
    // a face over the side runs against the triangle's
    const from = next.get(b);
    if (from) from.push(a);
    else next.set(b, [a]);
  }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      for (let at = next.get(start)!.pop()!; ; ) {
        if (at === start) {
          if (loop.length >= 3) loops.push(loop);
          break;
        }
        loop.push(at);
        const out = next.get(at);
        if (!out?.length) break;
        at = out.pop()!;
      }
    }
  }
  return loops;
}

export interface PlanarCaps {
  /** one list of triangles, flat, for each open end that lies in a plane */
  readonly caps: number[][];
  /** the open ends that don't */
  readonly notFlat: number;
}

/** Flat faces closing the mesh's open ends, turned to face out with it. */
export function planarCaps(triangles: ArrayLike<number>): PlanarCaps {
  const mesh = stitched(triangles);
  const flat = mesh.triangles.flatMap(([a, b, c]) => [...mesh.points[a], ...mesh.points[b], ...mesh.points[c]]);
  const caps: number[][] = [];
  let notFlat = 0;
  for (const loop of openLoops(mesh)) {
    const ring = loop.map((i) => mesh.points[i]);
    if (!isFlatRing(ring)) {
      notFlat++;
      continue;
    }
    const cap = capTriangles(ring).flatMap(([a, b, c]) => [...ring[a], ...ring[b], ...ring[c]]);
    if (cap.length) caps.push(cap);
    else notFlat++;
  }
  // turned as the whole they make faces
  const whole = outward([...flat, ...caps.flat()], mesh.tol / 4);
  let at = flat.length;
  return {
    notFlat,
    caps: caps.map((c) => {
      const out = Array.from(whole.subarray(at, at + c.length));
      at += c.length;
      return out;
    }),
  };
}

// ---- Create Drape Surface --------------------------------------------------

export interface DrapeOptions {
  /** points each way, more than 3 */
  readonly u: number;
  readonly v: number;
  /** how far down it hangs */
  readonly planeZ: number;
}

/**
 * A rectangle of points over the triangles, each at the highest face below it or at the plane, one step
 * past their box all round so it comes down around them. The faces between, triangles of 9 numbers,
 * facing up. A height field seen from above: it doesn't fold under anything, as cloth would.
 */
export function drapeFaces(triangles: ArrayLike<number>, o: DrapeOptions): number[][] {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    for (let k = 0; k < 2; k++) {
      lo[k] = Math.min(lo[k], triangles[i + k]);
      hi[k] = Math.max(hi[k], triangles[i + k]);
    }
  }
  const stepX = (hi[0] - lo[0]) / (o.u - 3) || 1;
  const stepY = (hi[1] - lo[1]) / (o.v - 3) || 1;
  const [x0, y0] = [lo[0] - stepX, lo[1] - stepY];
  const z = new Float64Array(o.u * o.v).fill(o.planeZ);
  const raise = (i: number, j: number, h: number): void => {
    if (i >= 0 && j >= 0 && i < o.u && j < o.v && h > z[j * o.u + i]) z[j * o.u + i] = h;
  };
  for (let t = 0; t + 8 < triangles.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => triangles[t + k]);
    // a corner lifts the point nearest it, so nothing thin slips between the points
    for (const [px, py, pz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) raise(Math.round((px - x0) / stepX), Math.round((py - y0) / stepY), pz);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    const [i0, i1] = [Math.ceil((Math.min(ax, bx, cx) - x0) / stepX - 1e-9), Math.floor((Math.max(ax, bx, cx) - x0) / stepX + 1e-9)];
    const [j0, j1] = [Math.ceil((Math.min(ay, by, cy) - y0) / stepY - 1e-9), Math.floor((Math.max(ay, by, cy) - y0) / stepY + 1e-9)];
    for (let j = j0; j <= j1; j++) {
      const y = y0 + j * stepY;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * stepX;
        const b = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / area;
        const c = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
        if (b >= -1e-9 && c >= -1e-9 && b + c <= 1 + 1e-9) raise(i, j, az + b * (bz - az) + c * (cz - az));
      }
    }
  }
  const at = (i: number, j: number): number[] => [x0 + i * stepX, y0 + j * stepY, z[j * o.u + i]];
  const faces: number[][] = [];
  for (let j = 0; j + 1 < o.v; j++) {
    for (let i = 0; i + 1 < o.u; i++) {
      faces.push([...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1)]);
      faces.push([...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1)]);
    }
  }
  return faces;
}

// ---- Revolve with Rail -----------------------------------------------------

export interface RailedRevolve {
  readonly rings: readonly (readonly Point3[])[];
  /** the profile is closed, so each ring runs on into its start */
  readonly closedRing: boolean;
}

/**
 * The rings of a profile turned about an axis, growing and shrinking so its farthest point follows the
 * rail, one ring to each of the rail's points, or a sentence saying what's wrong with the three curves.
 */
export function railedRevolve(axis: LoftCurve, profile: LoftCurve, rail: LoftCurve): RailedRevolve | string {
  const size = sizeOf([...axis.points, ...profile.points, ...rail.points]);
  const tol = Math.max(size * 1e-3, 1e-6);
  const a = axis.points[0];
  const b = axis.points[axis.points.length - 1];
  const along = unit(sub(b, a));
  if (axis.closed || length(along) === 0) return "The axis must be a straight line.";
  const radial = (p: Point3): Point3 => {
    const w = sub(p, a);
    return sub(w, scale(along, dot(w, along)));
  };
  if (axis.points.some((p) => length(radial(p)) > tol)) return "The axis must be a straight line.";
  const arms = profile.points.map(radial);
  const reach = Math.max(...arms.map(length));
  if (profile.points.length < 2 || reach <= tol) return "The profile must reach away from the axis.";
  const e = unit(arms[arms.findIndex((w) => length(w) === reach)]);
  for (const w of arms) {
    if (length(sub(w, scale(e, dot(w, e)))) > tol) return "The profile must lie in one plane with the axis.";
    if (dot(w, e) < -tol) return "The profile can touch the axis but not cross it.";
  }
  const spokes = rail.points.map(radial);
  if (rail.points.length < 2) return "The rail must have two points or more.";
  if (spokes.some((w) => length(w) <= tol)) return "The rail can't touch the axis.";
  const railNormal = rail.points.length > 2 ? unit(ringNormal(rail.points)) : null;
  if (railNormal && length(railNormal) > 0) {
    if (rail.points.some((p) => Math.abs(dot(railNormal, sub(p, rail.points[0]))) > tol)) return "The rail must lie in one plane.";
    // square to the plane of the axis and profile, and not one holding the axis
    if (Math.abs(dot(railNormal, cross(along, e))) > 0.02 || Math.abs(dot(railNormal, along)) < 0.02) return "The rail must lie in a plane square to the plane of the axis and profile, going round the axis.";
  }
  const turn = (w: Point3): number => Math.atan2(dot(w, cross(along, e)), dot(w, e));
  if (spokes.every((w) => Math.abs(turn(w) - turn(spokes[0])) < 1e-6)) return "The rail must go round the axis.";
  const ring = (w: Point3): Point3[] => profile.points.map((p, i) => add(add(a, scale(along, dot(sub(p, a), along))), scale(w, length(arms[i]) / reach)));
  const rings: Point3[][] = spokes.map(ring);
  if (rail.closed) rings.push(rings[0]);
  return { rings, closedRing: profile.closed };
}

// ---- Create Surface from Curves --------------------------------------------

/** Points of the curves as sides of one loop, end to end, or a sentence saying what's wrong. */
export function joinedSides(curves: readonly LoftCurve[]): Point3[][] | string {
  const size = sizeOf(curves.flatMap((c) => c.points));
  const tol = Math.max(size * 1e-3, 1e-6);
  const near = (p: Point3, q: Point3): boolean => length(sub(p, q)) <= tol;
  const enclosed = "The curves don't enclose a region: select one closed curve, or open curves meeting end to end.";
  if (curves.length === 1) {
    const [c] = curves;
    const first = c.points[0];
    const last = c.points[c.points.length - 1];
    if (!c.closed && !near(first, last)) return enclosed;
    return [near(first, last) ? c.points.slice(0, -1) : [...c.points]];
  }
  if (curves.some((c) => c.closed)) return "A surface takes one closed curve, or open curves meeting end to end, not more than one region.";
  const left = curves.map((c) => [...c.points]);
  const sides: Point3[][] = [left.shift()!];
  const end = (): Point3 => {
    const s = sides[sides.length - 1];
    return s[s.length - 1];
  };
  while (left.length) {
    const i = left.findIndex((c) => near(c[0], end()) || near(c[c.length - 1], end()));
    if (i < 0) return enclosed;
    const [c] = left.splice(i, 1);
    sides.push(near(c[0], end()) ? c : [...c].reverse());
  }
  return near(end(), sides[0][0]) ? sides : enclosed;
}

/** Shares of a side's length at each of its points. */
function sharesOf(side: readonly Point3[]): number[] {
  const at = [0];
  for (let i = 1; i < side.length; i++) at.push(at[i - 1] + length(sub(side[i], side[i - 1])));
  const total = at[at.length - 1] || 1;
  return at.map((v) => v / total);
}

function pointOn(side: readonly Point3[], shares: readonly number[], t: number): Point3 {
  let i = 0;
  while (i + 2 < side.length && shares[i + 1] < t) i++;
  const span = shares[i + 1] - shares[i];
  return mix(side[i], side[i + 1], span > 0 ? Math.min(1, Math.max(0, (t - shares[i]) / span)) : 0);
}

/** Every share in the lists and some more, so a patch keeps its sides' points and has some inside. */
function patchSteps(lists: readonly (readonly number[])[]): number[] {
  const all = [...lists.flat(), ...Array.from({ length: 25 }, (_, i) => i / 24)].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of all) if (!out.length || t - out[out.length - 1] > 1e-5) out.push(t);
  return out;
}

/** The surface four sides bound, each side's shape fading across to the opposite one (a Coons patch). */
function patchFaces(sides: readonly (readonly Point3[])[]): number[][] {
  const shares = sides.map(sharesOf);
  // s0 from A to B, s1 from B to C, s2 from C to D, s3 from D to A
  const [A, B, C, D] = sides.map((s) => s[0]);
  const us = patchSteps([shares[0], shares[2].map((t) => 1 - t)]);
  const vs = patchSteps([shares[1], shares[3].map((t) => 1 - t)]);
  const at = (u: number, v: number): Point3 => {
    const bottom = pointOn(sides[0], shares[0], u);
    const top = pointOn(sides[2], shares[2], 1 - u);
    const left = pointOn(sides[3], shares[3], 1 - v);
    const right = pointOn(sides[1], shares[1], v);
    const corners = mix(mix(A, B, u), mix(D, C, u), v);
    return sub(add(mix(bottom, top, v), mix(left, right, u)), corners);
  };
  const faces: number[][] = [];
  for (let j = 0; j + 1 < vs.length; j++) {
    for (let i = 0; i + 1 < us.length; i++) {
      const [p, q, r, s] = [at(us[i], vs[j]), at(us[i + 1], vs[j]), at(us[i + 1], vs[j + 1]), at(us[i], vs[j + 1])];
      faces.push([...p, ...q, ...r], [...p, ...r, ...s]);
    }
  }
  return faces;
}

/** rings inside a curve that isn't flat, and how often they're smoothed toward their neighbours */
const FILM_RINGS = 10;
const FILM_PASSES = 60;

/** A surface stretched across a ring that isn't flat: rings of points inside it, evened out as a soap film is. */
function filmFaces(ring: readonly Point3[]): number[][] {
  const centre = scale(ring.reduce<Point3>((s, p) => add(s, p), [0, 0, 0]), 1 / ring.length);
  const rings: Point3[][] = Array.from({ length: FILM_RINGS }, (_, k) => ring.map((p) => mix(p, centre, k / FILM_RINGS)));
  let middle = centre;
  const n = ring.length;
  for (let pass = 0; pass < FILM_PASSES; pass++) {
    const was = rings.map((r) => [...r]);
    for (let k = 1; k < FILM_RINGS; k++) {
      for (let i = 0; i < n; i++) {
        const inner = k + 1 < FILM_RINGS ? was[k + 1][i] : middle;
        const sum = add(add(was[k][(i + 1) % n], was[k][(i + n - 1) % n]), add(was[k - 1][i], inner));
        rings[k][i] = scale(sum, 1 / 4);
      }
    }
    middle = scale(was[FILM_RINGS - 1].reduce<Point3>((s, p) => add(s, p), [0, 0, 0]), 1 / n);
  }
  const faces: number[][] = [];
  for (let k = 0; k + 1 < FILM_RINGS; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push([...rings[k][i], ...rings[k][j], ...rings[k + 1][j]], [...rings[k][i], ...rings[k + 1][j], ...rings[k + 1][i]]);
    }
  }
  for (let i = 0; i < n; i++) faces.push([...rings[FILM_RINGS - 1][i], ...rings[FILM_RINGS - 1][(i + 1) % n], ...middle]);
  return faces;
}

/**
 * The surface the curves enclose, triangles of 9 numbers: flat when they lie in a plane, a patch between
 * four sides when they don't, and otherwise stretched across them. Or a sentence saying what's wrong.
 */
export function surfaceFromCurves(curves: readonly LoftCurve[]): number[][] | string {
  if (!curves.length) return "Select the curves to make the surface from.";
  const sides = joinedSides(curves);
  if (typeof sides === "string") return sides;
  const ring: Point3[] = sides.length === 1 ? sides[0] : sides.flatMap((s) => s.slice(0, -1));
  if (ring.length < 3) return "The curves don't enclose a region: they need three corners or more.";
  if (isFlatRing(ring)) {
    const flat = capTriangles(ring).map(([a, b, c]) => [...ring[a], ...ring[b], ...ring[c]]);
    return flat.length ? flat : "The curves don't enclose a region: it has no area.";
  }
  return sides.length === 4 ? patchFaces(sides) : filmFaces(ring);
}

// ---- Unfold Surfaces -------------------------------------------------------

/** two faces meeting at more than this are separate surfaces of a solid */
const CREASE = (20 * Math.PI) / 180;
/** the most curvature, added over a surface's points in radians, it can have and still count as developable */
const CURVED = (3 * Math.PI) / 180;

export interface FlatPiece {
  /** its outline, anticlockwise, with its longest side along x and its box's corner at 0, 0 */
  readonly outline: Point2[];
  /** holes in it, in the same frame */
  readonly holes: Point2[][];
  readonly width: number;
  readonly height: number;
}

interface Side {
  readonly a: number;
  readonly b: number;
  readonly tris: number[];
}

function sidesOfMesh(mesh: Indexed): Side[] {
  const sides = new Map<string, Side>();
  mesh.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const side = sides.get(key);
      if (side) side.tris.push(i);
      else sides.set(key, { a, b, tris: [i] });
    }
  });
  return [...sides.values()];
}

/** The triangles in pieces, joined across any side where the faces turn by no more than `most`. */
function groupsBy(count: number, sides: readonly Side[], turnOf: (s: Side) => number, most: number): number[][] {
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const s of sides) if (s.tris.length === 2 && turnOf(s) <= most) parent[find(s.tris[0])] = find(s.tris[1]);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const g = groups.get(find(i));
    if (g) g.push(i);
    else groups.set(find(i), [i]);
  }
  return [...groups.values()];
}

/** Whether the triangles flatten without stretching: no point inside them curved, but for a cone's one tip. */
function developable(mesh: Indexed, group: readonly number[], sides: readonly Side[]): boolean {
  const inside = new Set(group);
  const rim = new Set<number>();
  for (const s of sides) {
    const here = s.tris.filter((t) => inside.has(t)).length;
    if (here === 1 || here > 2) {
      rim.add(s.a);
      rim.add(s.b);
    }
  }
  const angles = new Map<number, number>();
  for (const i of group) {
    const t = mesh.triangles[i];
    for (let k = 0; k < 3; k++) {
      if (rim.has(t[k])) continue;
      const u = unit(sub(mesh.points[t[(k + 1) % 3]], mesh.points[t[k]]));
      const v = unit(sub(mesh.points[t[(k + 2) % 3]], mesh.points[t[k]]));
      angles.set(t[k], (angles.get(t[k]) ?? 0) + Math.acos(Math.min(1, Math.max(-1, dot(u, v)))));
    }
  }
  const curved = [...angles.values()].map((a) => Math.abs(2 * Math.PI - a)).sort((a, b) => b - a);
  return curved.slice(1).reduce((n, c) => n + c, 0) <= CURVED;
}

/** The triangles laid out flat, each hinged to a neighbour across its flattest side; each triangle's corners in the plane. */
function laidOut(mesh: Indexed, group: readonly number[], sides: readonly Side[], turnOf: (s: Side) => number): Map<number, Point2[]> {
  const inside = new Set(group);
  const hinges = sides.filter((s) => s.tris.length === 2 && inside.has(s.tris[0]) && inside.has(s.tris[1])).sort((p, q) => turnOf(p) - turnOf(q));
  const parent = new Map(group.map((t) => [t, t]));
  const find = (i: number): number => {
    while (parent.get(i) !== i) {
      parent.set(i, parent.get(parent.get(i)!)!);
      i = parent.get(i)!;
    }
    return i;
  };
  const tree = new Map<number, Side[]>();
  for (const s of hinges) {
    const [x, y] = [find(s.tris[0]), find(s.tris[1])];
    if (x === y) continue;
    parent.set(x, y);
    for (const t of s.tris) tree.set(t, [...(tree.get(t) ?? []), s]);
  }
  const placed = new Map<number, Point2[]>();
  const start = group[0];
  const [p, q, r] = mesh.triangles[start].map((i) => mesh.points[i]);
  const ab = sub(q, p);
  const along = length(ab);
  const s0 = dot(sub(r, p), ab) / (along * along);
  placed.set(start, [[0, 0], [along, 0], [s0 * along, length(sub(sub(r, p), scale(ab, s0)))]]);
  const queue = [start];
  while (queue.length) {
    const t = queue.pop()!;
    const flat = placed.get(t)!;
    const corners = mesh.triangles[t];
    for (const side of tree.get(t) ?? []) {
      const other = side.tris[0] === t ? side.tris[1] : side.tris[0];
      if (placed.has(other)) continue;
      const P = flat[corners.indexOf(side.a)];
      const Q = flat[corners.indexOf(side.b)];
      const third = flat[[0, 1, 2].find((k) => corners[k] !== side.a && corners[k] !== side.b)!];
      const its = mesh.triangles[other];
      const far = its.find((v) => v !== side.a && v !== side.b)!;
      const d = sub(mesh.points[side.b], mesh.points[side.a]);
      const w = sub(mesh.points[far], mesh.points[side.a]);
      const s = dot(w, d) / dot(d, d);
      const h = length(sub(w, scale(d, s)));
      const [qx, qy] = [Q[0] - P[0], Q[1] - P[1]];
      const n = Math.hypot(qx, qy) || 1;
      // across the hinge from its neighbour
      const away = qx * (third[1] - P[1]) - qy * (third[0] - P[0]) > 0 ? -1 : 1;
      const R: Point2 = [P[0] + s * qx + (away * h * -qy) / n, P[1] + s * qy + (away * h * qx) / n];
      placed.set(other, its.map((v) => (v === side.a ? P : v === side.b ? Q : R)));
      queue.push(other);
    }
  }
  return placed;
}

/** The outlines of triangles in the plane, as loops running anticlockwise round what they hold. */
function outlinesOf(placed: ReadonlyMap<number, readonly Point2[]>, tol: number): Point2[][] {
  const points: Point2[] = [];
  const cells = new Map<string, number[]>();
  const idOf = (p: Point2): number => {
    const [cx, cy] = [Math.floor(p[0] / (2 * tol)), Math.floor(p[1] / (2 * tol))];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const i of cells.get(`${x},${y}`) ?? []) if (Math.hypot(points[i][0] - p[0], points[i][1] - p[1]) <= tol) return i;
      }
    }
    points.push(p);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), points.length - 1]);
    return points.length - 1;
  };
  const directed = new Set<string>();
  const all: [number, number][] = [];
  for (const c of placed.values()) {
    const area = (c[1][0] - c[0][0]) * (c[2][1] - c[0][1]) - (c[2][0] - c[0][0]) * (c[1][1] - c[0][1]);
    const ids = (area >= 0 ? [c[0], c[1], c[2]] : [c[0], c[2], c[1]]).map(idOf);
    for (let k = 0; k < 3; k++) {
      all.push([ids[k], ids[(k + 1) % 3]]);
      directed.add(`${ids[k]},${ids[(k + 1) % 3]}`);
    }
  }
  const next = new Map<number, number[]>();
  for (const [a, b] of all) {
    if (a === b || directed.has(`${b},${a}`)) continue;
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  const loops: Point2[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      for (let at = next.get(start)!.pop()!; at !== start; ) {
        loop.push(at);
        const out = next.get(at);
        if (!out?.length) break;
        at = out.pop()!;
      }
      if (loop.length >= 3) loops.push(loop.map((i) => points[i]));
    }
  }
  return loops;
}

const areaOf = (loop: readonly Point2[]): number => loop.reduce((n, p, i) => n + p[0] * loop[(i + 1) % loop.length][1] - loop[(i + 1) % loop.length][0] * p[1], 0) / 2;

/** The loop without the points along a straight run. */
function withoutStraights(loop: readonly Point2[]): Point2[] {
  const n = loop.length;
  return loop.filter((p, i) => {
    const [a, b] = [loop[(i + n - 1) % n], loop[(i + 1) % n]];
    const [ux, uy, vx, vy] = [p[0] - a[0], p[1] - a[1], b[0] - p[0], b[1] - p[1]];
    return Math.abs(ux * vy - uy * vx) > 1e-5 * Math.hypot(ux, uy) * Math.hypot(vx, vy);
  });
}

/**
 * The surface flattened: one piece for a developable mesh, or one to each smooth surface of a solid (a
 * cylinder gives a rectangle and two circles). Or a sentence, when one is curved two ways, as a sphere is.
 */
export function unfolded(triangles: ArrayLike<number>): FlatPiece[] | string {
  const mesh = stitched(triangles);
  if (!mesh.triangles.length) return "This object shows no faces to unfold.";
  const sides = sidesOfMesh(mesh);
  const normals = mesh.triangles.map((t) => unit(cross(sub(mesh.points[t[1]], mesh.points[t[0]]), sub(mesh.points[t[2]], mesh.points[t[0]]))));
  const turnOf = (s: Side): number => (s.tris.length === 2 ? Math.acos(Math.min(1, Math.max(-1, dot(normals[s.tris[0]], normals[s.tris[1]])))) : Math.PI);
  const count = mesh.triangles.length;
  const whole = groupsBy(count, sides, turnOf, Math.PI);
  const groups = whole.every((g) => developable(mesh, g, sides)) ? whole : groupsBy(count, sides, turnOf, CREASE);
  if (!groups.every((g) => developable(mesh, g, sides))) return "This surface is curved two ways, as a sphere is, and won't flatten without stretching.";
  const pieces: FlatPiece[] = [];
  for (const g of groups) {
    const loops = outlinesOf(laidOut(mesh, g, sides, turnOf), mesh.tol * 4)
      .map(withoutStraights)
      .filter((l) => l.length >= 3);
    if (!loops.length) continue;
    const [outer, ...holes] = [...loops].sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));
    // square to the page by its longest side
    let best = 0;
    let turn = 0;
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > best + 1e-9) {
        best = d;
        turn = Math.atan2(q[1] - p[1], q[0] - p[0]);
      }
    });
    const [c, s] = [Math.cos(-turn), Math.sin(-turn)];
    const round = (p: Point2): Point2 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
    const [o, ...h] = [outer, ...holes].map((l) => l.map(round));
    const [x0, y0] = [Math.min(...o.map((p) => p[0])), Math.min(...o.map((p) => p[1]))];
    const placed = (l: readonly Point2[]): Point2[] => l.map((p) => [p[0] - x0, p[1] - y0]);
    pieces.push({
      outline: placed(o),
      holes: h.map(placed),
      width: Math.max(...o.map((p) => p[0])) - x0,
      height: Math.max(...o.map((p) => p[1])) - y0,
    });
  }
  return pieces.length ? pieces : "This object shows no faces to unfold.";
}

// ---- Stitch and Trim Surfaces ----------------------------------------------

export type Tri = readonly [Point3, Point3, Point3];

export function trianglesOf(flat: ArrayLike<number>): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i + 8 < flat.length; i += 9) out.push([[flat[i], flat[i + 1], flat[i + 2]], [flat[i + 3], flat[i + 4], flat[i + 5]], [flat[i + 6], flat[i + 7], flat[i + 8]]]);
  return out;
}

const normalOf = (t: Tri): Point3 => cross(sub(t[1], t[0]), sub(t[2], t[0]));

/** Whether two triangles' boxes come within `tol` of each other. */
export function boxesMeet(a: Tri, b: Tri, tol: number): boolean {
  for (let k = 0; k < 3; k++) {
    if (Math.max(a[0][k], a[1][k], a[2][k]) < Math.min(b[0][k], b[1][k], b[2][k]) - tol) return false;
    if (Math.max(b[0][k], b[1][k], b[2][k]) < Math.min(a[0][k], a[1][k], a[2][k]) - tol) return false;
  }
  return true;
}

/** Where a triangle crosses a plane: the two points on its sides, or null when it doesn't. */
export function crossingOfPlane(t: Tri, n: Point3, at: Point3, tol: number): [Point3, Point3] | null {
  const d = t.map((p) => dot(n, sub(p, at)));
  const hits: Point3[] = [];
  for (let k = 0; k < 3; k++) {
    const [i, j] = [k, (k + 1) % 3];
    if (Math.abs(d[i]) <= tol) hits.push(t[i]);
    else if (Math.abs(d[j]) > tol && d[i] * d[j] < 0) hits.push(mix(t[i], t[j], d[i] / (d[i] - d[j])));
  }
  return hits.length >= 2 ? [hits[0], hits[hits.length - 1]] : null;
}

/** The line two triangles share, when they cross. */
export function crossingOf(a: Tri, b: Tri, tol: number): [Point3, Point3] | null {
  const [na, nb] = [unit(normalOf(a)), unit(normalOf(b))];
  const line = cross(na, nb);
  if (length(line) < 1e-9) return null;
  const sa = crossingOfPlane(a, nb, b[0], tol);
  const sb = crossingOfPlane(b, na, a[0], tol);
  if (!sa || !sb) return null;
  const along = (p: Point3): number => dot(p, line);
  const [a0, a1] = along(sa[0]) <= along(sa[1]) ? sa : [sa[1], sa[0]];
  const [b0, b1] = along(sb[0]) <= along(sb[1]) ? sb : [sb[1], sb[0]];
  const start = along(a0) > along(b0) ? a0 : b0;
  const end = along(a1) < along(b1) ? a1 : b1;
  return along(end) - along(start) > tol ? [start, end] : null;
}

/** The triangle in pieces on each side of a plane. */
function splitByPlane(t: Tri, n: Point3, at: Point3, tol: number): Tri[] {
  const d = t.map((p) => dot(n, sub(p, at)));
  if (d.every((v) => v >= -tol) || d.every((v) => v <= tol)) return [t];
  // the corner alone on its side, or the two that are, as the triangle's corners run
  for (let k = 0; k < 3; k++) {
    const [i, j, m] = [k, (k + 1) % 3, (k + 2) % 3];
    const [di, dj, dm] = [d[i], d[j], d[m]];
    if (Math.abs(di) <= tol) {
      // through a corner, across the side opposite
      const p = mix(t[j], t[m], dj / (dj - dm));
      return [[t[i], t[j], p], [t[i], p, t[m]]];
    }
    if (di * dj < 0 && di * dm < 0) {
      const p = mix(t[i], t[j], di / (di - dj));
      const q = mix(t[i], t[m], di / (di - dm));
      return [[t[i], p, q], [p, t[j], t[m]], [p, t[m], q]];
    }
  }
  return [t];
}

/**
 * The volumes the surfaces enclose: each surface split where another crosses it, the flaps with a free
 * edge taken away until none is left, and the rest sorted into closed shells round each volume, by which
 * face follows which about each line where more than two meet. One list of triangles, facing out, to each.
 */
export function stitchAndTrim(surfaces: readonly ArrayLike<number>[]): number[][] | string {
  const lists = surfaces.map(trianglesOf);
  const size = sizeOf(lists.flat().flat());
  const tol = Math.max(size * 1e-7, 1e-7);
  const pieces: number[] = [];
  lists.forEach((list, s) => {
    for (const t of list) {
      let parts: Tri[] = [t];
      lists.forEach((other, o) => {
        if (o === s) return;
        for (const u of other) {
          if (!boxesMeet(t, u, tol) || !crossingOf(t, u, tol)) continue;
          const n = unit(normalOf(u));
          parts = parts.flatMap((p) => splitByPlane(p, n, u[0], tol));
        }
      });
      for (const p of parts) pieces.push(...p[0], ...p[1], ...p[2]);
    }
  });
  const mesh = stitched(pieces);
  const sides = sidesOfMesh(mesh);
  // the flaps: a triangle with a side no other shares goes, and takes its neighbours' share of it
  const bySide = new Map<number, Side[]>();
  for (const s of sides) for (const t of s.tris) bySide.set(t, [...(bySide.get(t) ?? []), s]);
  const live = new Map(sides.map((s) => [s, s.tris.length]));
  const gone = new Set<number>();
  const queue = mesh.triangles.map((_, i) => i);
  while (queue.length) {
    const t = queue.pop()!;
    if (gone.has(t) || !(bySide.get(t) ?? []).some((s) => live.get(s) === 1)) continue;
    gone.add(t);
    for (const s of bySide.get(t) ?? []) {
      live.set(s, live.get(s)! - 1);
      for (const u of s.tris) if (!gone.has(u)) queue.push(u);
    }
  }
  if (gone.size === mesh.triangles.length) return "These surfaces don't enclose a volume.";
  // both faces of each triangle: 2t its front, 2t + 1 its back; those round one volume join up
  const parent = Array.from({ length: mesh.triangles.length * 2 }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const faceNormal = (t: number): Point3 => {
    const [a, b, c] = mesh.triangles[t].map((i) => mesh.points[i]);
    return cross(sub(b, a), sub(c, a));
  };
  for (const s of sides) {
    const here = s.tris.filter((t) => !gone.has(t));
    if (here.length < 2) continue;
    const [p, q] = [mesh.points[s.a], mesh.points[s.b]];
    const axis = unit(sub(q, p));
    const spokeOf = (t: number): Point3 => {
      const far = mesh.triangles[t].find((v) => v !== s.a && v !== s.b)!;
      const w = sub(mesh.points[far], p);
      return unit(sub(w, scale(axis, dot(w, axis))));
    };
    const e = spokeOf(here[0]);
    const f = cross(axis, e);
    const round = here.map((t) => ({ t, angle: Math.atan2(dot(spokeOf(t), f), dot(spokeOf(t), e)) })).sort((x, y) => x.angle - y.angle);
    round.forEach(({ t }, i) => {
      const next = round[(i + 1) % round.length].t;
      // the face of each toward the wedge between them, which runs on from t and back from next
      const facing = (tri: number, way: number): number => (dot(faceNormal(tri), scale(cross(axis, spokeOf(tri)), way)) > 0 ? 2 * tri : 2 * tri + 1);
      parent[find(facing(t, 1))] = find(facing(next, -1));
    });
  }
  const shells = new Map<number, number[]>();
  mesh.triangles.forEach((_, t) => {
    if (gone.has(t)) return;
    for (const h of [2 * t, 2 * t + 1]) {
      const root = find(h);
      shells.set(root, [...(shells.get(root) ?? []), h]);
    }
  });
  const out: number[][] = [];
  for (const shell of shells.values()) {
    // each face turned away from the volume it's on: a shell round the outside comes out negative
    const flat = shell.flatMap((h) => {
      const [a, b, c] = mesh.triangles[h >> 1].map((i) => mesh.points[i]);
      return h & 1 ? [...a, ...b, ...c] : [...a, ...c, ...b];
    });
    let volume = 0;
    for (let i = 0; i + 8 < flat.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => flat[i + k] - flat[k % 3]);
      volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    if (volume / 6 > size * size * size * 1e-9) out.push(flat);
  }
  return out.length ? out : "These surfaces don't enclose a volume.";
}

// ---- Extend NURBS ----------------------------------------------------------

export type ExtendKind = "linear" | "smooth";

/** points a smooth extension adds */
const SMOOTH_STEPS = 8;
/** a surface's rim turning by more than this is a corner between two of its edges */
const RIM_CORNER = (30 * Math.PI) / 180;

/** Turned by `angle` about the unit axis `n`. */
function turned(v: Point3, n: Point3, angle: number): Point3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return add(add(scale(v, c), scale(cross(n, v), s)), scale(n, dot(n, v) * (1 - c)));
}

/** Points carrying on from the end of `trail`, by `distance`: straight along `straight`, or round the circle through its last three points. */
function continuing(trail: readonly Point3[], distance: number, kind: ExtendKind, straight?: Point3): Point3[] {
  const end = trail[trail.length - 1];
  const before = trail[trail.length - 2];
  const way = straight ?? unit(sub(end, before));
  const steps = kind === "smooth" ? SMOOTH_STEPS : 1;
  const ahead = (): Point3[] => Array.from({ length: steps }, (_, i) => add(end, scale(way, (distance * (i + 1)) / steps)));
  if (kind === "linear" || trail.length < 3) return ahead();
  const earlier = trail[trail.length - 3];
  const [u, v] = [sub(before, earlier), sub(end, before)];
  const normal = cross(u, v);
  const area = length(normal);
  if (area <= 1e-9 * length(u) * length(v)) return ahead();
  const n = unit(normal);
  // the circle's centre, from the triangle of the three points
  const [ab, ac] = [sub(before, earlier), sub(end, earlier)];
  const across = cross(ab, ac);
  const centre = add(earlier, scale(add(scale(cross(ac, across), dot(ab, ab)), scale(cross(across, ab), dot(ac, ac))), 1 / (2 * dot(across, across))));
  const radius = length(sub(end, centre));
  const from = sub(end, centre);
  return Array.from({ length: steps }, (_, i) => add(centre, turned(from, n, (distance * (i + 1)) / steps / radius)));
}

/** The curve carried on past one end by `distance`, or a sentence saying why it can't be. */
export function extendedCurve(c: LoftCurve, atStart: boolean, distance: number, kind: ExtendKind): Point3[] | string {
  if (c.closed) return "A closed curve can't be extended.";
  const points = atStart ? [...c.points].reverse() : [...c.points];
  const out: Point3[] = [];
  for (const p of points) if (!out.length || length(sub(p, out[out.length - 1])) > 1e-6) out.push(p);
  if (out.length < 2) return "This curve has no length to carry on from.";
  const all = [...out, ...continuing(out.slice(-3), distance, kind)];
  return atStart ? all.reverse() : all;
}

/** One edge of a surface's rim, between corners or all the way round. */
export interface RimEdge {
  /** point numbers along it */
  readonly points: readonly number[];
  readonly closed: boolean;
}

/** The rim's open loops, each cut at its corners into edges. */
function rimEdges(mesh: Indexed): RimEdge[] {
  const edges: RimEdge[] = [];
  for (const loop of openLoops(mesh)) {
    const n = loop.length;
    const turnAt = (i: number): number => {
      const [a, b] = [unit(sub(mesh.points[loop[i]], mesh.points[loop[(i + n - 1) % n]])), unit(sub(mesh.points[loop[(i + 1) % n]], mesh.points[loop[i]]))];
      return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    };
    const corners = loop.map((_, i) => i).filter((i) => turnAt(i) > RIM_CORNER);
    if (!corners.length) {
      edges.push({ points: loop, closed: true });
      continue;
    }
    corners.forEach((c, k) => {
      const next = corners[(k + 1) % corners.length];
      const points = [loop[c]];
      for (let i = c; i !== next || points.length === 1; ) {
        i = (i + 1) % n;
        points.push(loop[i]);
        if (i === next) break;
      }
      edges.push({ points, closed: false });
    });
  }
  return edges;
}

export interface SurfaceExtension {
  /** the edge, as lines of 6 numbers each, to show which it is */
  readonly edge: number[];
  /** the rings out from the edge */
  readonly rings: Point3[][];
  readonly closed: boolean;
}

export interface OpenSurface {
  readonly mesh: Indexed;
  readonly edges: readonly RimEdge[];
}

/** A surface's mesh and its edges; none when it has no open rim. */
export function openSurface(triangles: ArrayLike<number>): OpenSurface {
  const mesh = stitched(triangles);
  return { mesh, edges: rimEdges(mesh) };
}

/** The rings carrying the surface on past one of its edges by `distance`. */
export function surfaceExtension(surface: OpenSurface, edge: RimEdge, distance: number, kind: ExtendKind): SurfaceExtension {
  const { mesh } = surface;
  const neighbours = new Map<number, Set<number>>();
  const thirdOf = new Map<string, number>();
  for (const t of mesh.triangles) {
    for (let k = 0; k < 3; k++) {
      const [a, b, c] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b).add(c));
      thirdOf.set(`${a},${b}`, c);
      thirdOf.set(`${b},${a}`, c);
    }
  }
  const { points } = edge;
  const count = points.length;
  const sidesAt = (i: number): [number, number][] => {
    const out: [number, number][] = [];
    if (edge.closed || i > 0) out.push([points[(i + count - 1) % count], points[i]]);
    if (edge.closed || i + 1 < count) out.push([points[i], points[(i + 1) % count]]);
    return out;
  };
  const rings: Point3[][] = [points.map((p) => mesh.points[p])];
  const away = points.map((_, i) => {
    let sum: Point3 = [0, 0, 0];
    for (const [a, b] of sidesAt(i)) {
      const [pa, pb] = [mesh.points[a], mesh.points[b]];
      const third = thirdOf.get(`${a},${b}`);
      if (third === undefined) continue;
      const across = sub(mesh.points[third], pa);
      const along = unit(sub(pb, pa));
      sum = add(sum, unit(sub(scale(along, dot(across, along)), across)));
    }
    return unit(sum);
  });
  // up the surface from each point of the edge, the way it runs on inward
  const trailOf = (i: number): Point3[] => {
    const v0 = points[i];
    const best = (from: number, way: Point3): number | null => {
      let pick: number | null = null;
      let most = 0.5;
      for (const u of neighbours.get(from) ?? []) {
        const c = dot(unit(sub(mesh.points[from], mesh.points[u])), way);
        if (c > most) [pick, most] = [u, c];
      }
      return pick;
    };
    const v1 = best(v0, away[i]);
    if (v1 === null) return [sub(mesh.points[v0], away[i]), mesh.points[v0]];
    const v2 = best(v1, unit(sub(mesh.points[v0], mesh.points[v1])));
    return v2 === null ? [mesh.points[v1], mesh.points[v0]] : [mesh.points[v2], mesh.points[v1], mesh.points[v0]];
  };
  const carried = points.map((_, i) => continuing(trailOf(i), distance, kind, kind === "linear" ? away[i] : undefined));
  for (let k = 0; k < carried[0].length; k++) rings.push(carried.map((c) => c[k]));
  const lines: number[] = [];
  for (let i = 0; i + 1 < count + (edge.closed ? 1 : 0); i++) lines.push(...mesh.points[points[i]], ...mesh.points[points[(i + 1) % count]]);
  return { edge: lines, rings, closed: edge.closed };
}

// ---- Rebuild NURBS ---------------------------------------------------------

/** The ring or line resampled to `count` points, evenly along its length. */
function evenPoints(points: readonly Point3[], closed: boolean, count: number): Point3[] {
  const path = closed ? [...points, points[0]] : [...points];
  const shares = sharesOf(path);
  return Array.from({ length: count }, (_, i) => pointOn(path, shares, closed ? i / count : i / (count - 1)));
}

const distanceToSegment = (p: Point3, a: Point3, b: Point3): number => {
  const ab = sub(b, a);
  const span = dot(ab, ab);
  const t = span > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / span)) : 0;
  return length(sub(p, add(a, scale(ab, t))));
};

export interface RebuiltCurve {
  readonly points: Point3[];
  /** the farthest any of the old points is from the new curve */
  readonly deviation: number;
}

/** The curve with `count` points, evenly along it. */
export function rebuiltCurve(c: LoftCurve, count: number): RebuiltCurve {
  const points = evenPoints(c.points, c.closed, count);
  const n = c.closed ? count : count - 1;
  let deviation = 0;
  for (const p of c.points) {
    let near = Infinity;
    for (let i = 0; i < n; i++) near = Math.min(near, distanceToSegment(p, points[i], points[(i + 1) % count]));
    deviation = Math.max(deviation, near);
  }
  return { points, deviation };
}

/** The nearest point to `p` on a triangle. */
export function nearestOnTriangle(p: Point3, t: Tri): Point3 {
  const [a, b, c] = t;
  const [ab, ac, ap] = [sub(b, a), sub(c, a), sub(p, a)];
  const [d1, d2] = [dot(ab, ap), dot(ac, ap)];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const [d3, d4] = [dot(ab, bp), dot(ac, bp)];
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const [d5, d6] = [dot(ab, cp), dot(ac, cp)];
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + d5 - d6)));
  const k = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * k), scale(ac, vc * k)));
}

function nearestOnMesh(p: Point3, tris: readonly Tri[]): { point: Point3; tri: number } {
  let best: Point3 = tris[0][0];
  let tri = 0;
  let bestD = Infinity;
  tris.forEach((t, i) => {
    const q = nearestOnTriangle(p, t);
    const d = length(sub(q, p));
    if (d < bestD) [best, tri, bestD] = [q, i, d];
  });
  return { point: best, tri };
}

export interface RebuiltSurface {
  readonly rings: Point3[][];
  readonly closedRing: boolean;
  /** the farthest any of the old points is from the new surface */
  readonly deviation: number;
}

/**
 * The surface as a grid of `u` by `v` points on it: four-sided, from its edges, or a tube, from its two
 * open ends. Or a sentence, for one of another shape.
 */
export function rebuiltSurface(triangles: ArrayLike<number>, u: number, v: number): RebuiltSurface | string {
  const { mesh, edges } = openSurface(triangles);
  const tris: Tri[] = mesh.triangles.map((t) => [mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]]);
  const on = (p: Point3): Point3 => nearestOnMesh(p, tris).point;
  const line = (e: RimEdge): Point3[] => e.points.map((i) => mesh.points[i]);
  let rings: Point3[][];
  let closedRing = false;
  if (edges.length === 2 && edges.every((e) => e.closed)) {
    closedRing = true;
    const [a, b] = edges.map((e) => evenPoints(line(e), true, u));
    // the second run the same way as the first, from the nearest point
    const fit = (list: readonly Point3[]): { list: Point3[]; cost: number } => {
      let bestAt = 0;
      let cost = Infinity;
      for (let s = 0; s < u; s++) {
        let sum = 0;
        for (let i = 0; i < u; i++) sum += length(sub(a[i], list[(i + s) % u]));
        if (sum < cost) [bestAt, cost] = [s, sum];
      }
      return { list: list.map((_, i) => list[(i + bestAt) % u]), cost };
    };
    const [same, other] = [fit(b), fit([...b].reverse())];
    const c = same.cost <= other.cost ? same.list : other.list;
    rings = Array.from({ length: v }, (_, j) => a.map((p, i) => (j === 0 ? p : j === v - 1 ? c[i] : on(mix(p, c[i], j / (v - 1))))));
  } else if (edges.length === 4 && edges.every((e) => !e.closed)) {
    const sides = edges.map(line);
    const shares = sides.map(sharesOf);
    const [A, B, C, D] = sides.map((s) => s[0]);
    const at = (s: number, t: number): Point3 => {
      const bottom = pointOn(sides[0], shares[0], s);
      const top = pointOn(sides[2], shares[2], 1 - s);
      const left = pointOn(sides[3], shares[3], 1 - t);
      const right = pointOn(sides[1], shares[1], t);
      return sub(add(mix(bottom, top, t), mix(left, right, s)), mix(mix(A, B, s), mix(D, C, s), t));
    };
    rings = Array.from({ length: v }, (_, j) => Array.from({ length: u }, (_, i) => on(at(i / (u - 1), j / (v - 1)))));
  } else return "Rebuild NURBS takes a surface with four sides, or a tube with two open ends.";
  const made: Tri[] = [];
  for (let j = 0; j + 1 < v; j++) {
    for (let i = 0; i < (closedRing ? u : u - 1); i++) {
      const k = (i + 1) % u;
      made.push([rings[j][i], rings[j][k], rings[j + 1][k]], [rings[j][i], rings[j + 1][k], rings[j + 1][i]]);
    }
  }
  let deviation = 0;
  for (const p of mesh.points) deviation = Math.max(deviation, length(sub(p, nearestOnMesh(p, made).point)));
  return { rings, closedRing, deviation };
}

// ---- Create Fillet Surface -------------------------------------------------

export type FilletSection = "circular" | "linear" | "tangent" | "curvature";

export interface FilletOptions {
  readonly radius: number;
  readonly section: FilletSection;
  /** turn each surface's normal over, so the fillet goes on its other side */
  readonly flipA: boolean;
  readonly flipB: boolean;
}

export interface FilletFit {
  readonly rings: Point3[][];
  /** the centre line runs round on itself */
  readonly closedChain: boolean;
  /** the surfaces with what the fillet replaces cut away */
  readonly trimmedA: number[];
  readonly trimmedB: number[];
}

/** points across the fillet */
const FILLET_ACROSS = 12;

/** The surface moved along its normals, each point by the average of the faces at it, as a mesh still joined up. */
function offsetMesh(mesh: Indexed, distance: number, flip: boolean): { tris: Tri[]; normals: Point3[] } {
  const sign = flip ? -1 : 1;
  const sum: Point3[] = mesh.points.map(() => [0, 0, 0]);
  const normals = mesh.triangles.map((t) => scale(unit(normalOf([mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]])), sign));
  mesh.triangles.forEach((t, i) => {
    for (const v of t) sum[v] = add(sum[v], normals[i]);
  });
  const moved = mesh.points.map((p, i) => add(p, scale(unit(sum[i]), distance)));
  return { tris: mesh.triangles.map((t) => [moved[t[0]], moved[t[1]], moved[t[2]]]), normals };
}

/** The longest run of segments that join end to end, and whether it comes round to its start. */
function longestChain(segments: readonly [Point3, Point3][], tol: number): { points: Point3[]; closed: boolean } | null {
  const points: Point3[] = [];
  const idOf = (p: Point3): number => {
    const i = points.findIndex((q) => length(sub(q, p)) <= tol);
    if (i >= 0) return i;
    points.push(p);
    return points.length - 1;
  };
  const next = new Map<number, Set<number>>();
  for (const [p, q] of segments) {
    const [a, b] = [idOf(p), idOf(q)];
    if (a === b) continue;
    next.set(a, (next.get(a) ?? new Set()).add(b));
    next.set(b, (next.get(b) ?? new Set()).add(a));
  }
  const seen = new Set<number>();
  let best: { points: Point3[]; closed: boolean; run: number } | null = null;
  const starts = [...next.keys()].sort((a, b) => next.get(a)!.size - next.get(b)!.size);
  for (const start of starts) {
    if (seen.has(start)) continue;
    const chain = [start];
    seen.add(start);
    for (let at = start; ; ) {
      const on = [...next.get(at)!].find((n) => !seen.has(n));
      if (on === undefined) break;
      chain.push(on);
      seen.add(on);
      at = on;
    }
    const closed = chain.length > 2 && next.get(chain[chain.length - 1])!.has(start);
    let run = 0;
    for (let i = 1; i < chain.length; i++) run += length(sub(points[chain[i]], points[chain[i - 1]]));
    if (!best || run > best.run) best = { points: chain.map((i) => points[i]), closed, run };
  }
  return best;
}

/** One cross section from foot to foot about the ball's centre. */
function filletSection(centre: Point3, a: Point3, b: Point3, o: FilletOptions): Point3[] {
  const [ua, ub] = [sub(a, centre), sub(b, centre)];
  const angle = Math.acos(Math.min(1, Math.max(-1, dot(unit(ua), unit(ub)))));
  const axis = unit(cross(ua, ub));
  const arc = (t: number): Point3 => add(centre, turned(ua, axis, angle * t));
  const steps = Array.from({ length: FILLET_ACROSS + 1 }, (_, i) => i / FILLET_ACROSS);
  if (o.section === "linear") return steps.map((t) => mix(a, b, t));
  if (o.section === "circular" || length(axis) === 0) return steps.map(arc);
  // leaving each surface along it, as the arc does
  const ta = unit(cross(axis, ua));
  const tb = unit(cross(axis, ub));
  const reach = length(sub(b, a));
  if (o.section === "tangent") {
    const [p1, p2] = [add(a, scale(ta, reach / 3)), sub(b, scale(tb, reach / 3))];
    return steps.map((t) => mix(mix(mix(a, p1, t), mix(p1, p2, t), t), mix(mix(p1, p2, t), mix(p2, b, t), t), t));
  }
  // no bend at either end: the first and last three control points in a line
  const control = [a, add(a, scale(ta, reach / 5)), add(a, scale(ta, (2 * reach) / 5)), sub(b, scale(tb, (2 * reach) / 5)), sub(b, scale(tb, reach / 5)), b];
  return steps.map((t) => {
    let row = control;
    while (row.length > 1) row = row.slice(1).map((p, i) => mix(row[i], p, t));
    return row[0];
  });
}

/** The surface less what lies toward the fillet from the line of its feet. */
function trimmedBy(tris: readonly Tri[], feet: readonly Point3[], towards: readonly Point3[], closed: boolean, tol: number): number[] {
  const n = feet.length;
  const walls = Array.from({ length: closed ? n : n - 1 }, (_, i) => {
    const j = (i + 1) % n;
    const along = unit(sub(feet[j], feet[i]));
    const way = add(towards[i], towards[j]);
    return { a: feet[i], b: feet[j], m: unit(sub(way, scale(along, dot(way, along)))) };
  });
  const out: number[] = [];
  const reach = tol * 4;
  for (const t of tris) {
    let parts: Tri[] = [t];
    for (const w of walls) {
      // only where the foot line passes over this triangle
      const q = nearestOnTriangle(mix(w.a, w.b, 0.5), t);
      if (Math.min(distanceToSegment(q, w.a, w.b), length(sub(nearestOnTriangle(w.a, t), w.a)), length(sub(nearestOnTriangle(w.b, t), w.b))) > reach) continue;
      parts = parts.flatMap((p) => splitByPlane(p, w.m, w.a, tol));
    }
    for (const p of parts) {
      const c = scale(add(add(p[0], p[1]), p[2]), 1 / 3);
      let near = walls[0];
      let d = Infinity;
      for (const w of walls) {
        const e = distanceToSegment(c, w.a, w.b);
        if (e < d) [near, d] = [w, e];
      }
      if (dot(sub(c, near.a), near.m) <= tol) out.push(...p[0], ...p[1], ...p[2]);
    }
  }
  return out;
}

/** A rolling-ball fillet between two surfaces, on the side of each its normal points to. Or a sentence saying why not. */
export function filletSurface(a: ArrayLike<number>, b: ArrayLike<number>, o: FilletOptions): FilletFit | string {
  const [ma, mb] = [stitched(a), stitched(b)];
  const trisOf = (m: Indexed): Tri[] => m.triangles.map((t) => [m.points[t[0]], m.points[t[1]], m.points[t[2]]]);
  const [ta, tb] = [trisOf(ma), trisOf(mb)];
  const size = sizeOf([...ma.points, ...mb.points]);
  const tol = Math.max(size * 1e-6, 1e-6);
  const [oa, ob] = [offsetMesh(ma, o.radius, o.flipA), offsetMesh(mb, o.radius, o.flipB)];
  const segments: [Point3, Point3][] = [];
  for (const u of oa.tris) {
    for (const w of ob.tris) {
      if (!boxesMeet(u, w, tol)) continue;
      const s = crossingOf(u, w, tol * 1e-2);
      if (s) segments.push(s);
    }
  }
  const chain = longestChain(segments, tol * 10);
  if (!chain || chain.points.length < 2) return "The fillet doesn't fit: the surfaces don't come within its radius of each other on these sides. Try a smaller radius or reverse a normal.";
  const feetA = chain.points.map((c) => nearestOnMesh(c, ta).point);
  const feetB = chain.points.map((c) => nearestOnMesh(c, tb).point);
  const sections = chain.points.map((c, i) => filletSection(c, feetA[i], feetB[i], o));
  const rings: Point3[][] = sections;
  if (chain.closed) rings.push(rings[0]);
  const towardsA = chain.points.map((c, i) => {
    const arm = sub(feetB[i], feetA[i]);
    const face = unit(sub(c, feetA[i]));
    return sub(arm, scale(face, dot(arm, face)));
  });
  const towardsB = chain.points.map((c, i) => {
    const arm = sub(feetA[i], feetB[i]);
    const face = unit(sub(c, feetB[i]));
    return sub(arm, scale(face, dot(arm, face)));
  });
  return {
    rings,
    closedChain: chain.closed,
    trimmedA: trimmedBy(ta, feetA, towardsA, chain.closed, tol),
    trimmedB: trimmedBy(tb, feetB, towardsB, chain.closed, tol),
  };
}

// ---- Shell Solid on a surface ------------------------------------------------

/** The triangles turned to face the same way as those they share a side with, each piece as most of it faces; null if a side has three. */
function facingOneWay(mesh: Indexed): [number, number, number][] | null {
  const sides = new Map<string, number[]>();
  mesh.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const on = sides.get(key);
      if (on) on.push(i);
      else sides.set(key, [i]);
    }
  });
  for (const on of sides.values()) if (on.length > 2) return null;
  const list = mesh.triangles.map((t): [number, number, number] => [t[0], t[1], t[2]]);
  const seen = new Set<number>();
  for (let start = 0; start < list.length; start++) {
    if (seen.has(start)) continue;
    seen.add(start);
    const piece = [start];
    const turned = new Set<number>();
    for (let n = 0; n < piece.length; n++) {
      const t = list[piece[n]];
      for (let k = 0; k < 3; k++) {
        const [a, b] = [t[k], t[(k + 1) % 3]];
        for (const j of sides.get(a < b ? `${a},${b}` : `${b},${a}`)!) {
          if (seen.has(j)) continue;
          seen.add(j);
          const other = list[j];
          // sides shared the same way round mean the faces fold over each other
          if ([0, 1, 2].some((m) => other[m] === a && other[(m + 1) % 3] === b)) {
            list[j] = [other[0], other[2], other[1]];
            turned.add(j);
          }
          piece.push(j);
        }
      }
    }
    if (turned.size * 2 > piece.length) for (const i of piece) list[i] = [list[i][0], list[i][2], list[i][1]];
  }
  return list;
}

/**
 * An open surface with a thickness, as a closed mesh: Inside grows against its faces' normals and Outside
 * along them. Each point moves along the average of the different ways its faces look, far enough that
 * flat faces stay the thickness apart, so a fold keeps its corners square. A string says why it can't be done.
 */
export function thickenedSurface(triangles: ArrayLike<number>, thickness: number, inside: boolean): number[] | string {
  const mesh = stitched(triangles);
  if (!mesh.triangles.length) return "That surface has no faces to thicken.";
  const list = facingOneWay(mesh);
  if (!list) return "That surface has a side shared by more than two faces, so it can't be thickened.";
  const ways: Point3[][] = mesh.points.map(() => []);
  for (const t of list) {
    const n = unit(normalOf([mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]]));
    for (const v of t) if (!ways[v].some((w) => dot(w, n) > 1 - 1e-9)) ways[v].push(n);
  }
  const moved = mesh.points.map((p, i): Point3 => {
    const along = unit(ways[i].reduce<Point3>((a, w) => add(a, w), [0, 0, 0]));
    // sharper than this and the corner would run far past the fold
    const stretch = 1 / Math.max(0.25, Math.min(...ways[i].map((w) => dot(along, w))));
    return add(p, scale(along, (inside ? -thickness : thickness) * stretch));
  });
  for (const t of list) {
    const before = normalOf([mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]]);
    const after = normalOf([moved[t[0]], moved[t[1]], moved[t[2]]]);
    if (dot(before, after) <= 0) return "The shell's too thick for this surface: its faces would cross.";
  }
  const [over, under] = inside ? [mesh.points, moved] : [moved, mesh.points];
  const out: number[] = [];
  const open = new Map<string, [number, number] | null>();
  for (const t of list) {
    out.push(...over[t[0]], ...over[t[1]], ...over[t[2]], ...under[t[2]], ...under[t[1]], ...under[t[0]]);
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      open.set(key, open.has(key) ? null : [a, b]);
    }
  }
  for (const side of open.values()) {
    if (!side) continue;
    const [a, b] = side;
    out.push(...over[b], ...over[a], ...under[a], ...over[b], ...under[a], ...under[b]);
  }
  return out;
}

/** A flat closed ring as triangles looking toward `up`'s side. */
export function ringSheet(ring: readonly Point3[], up: Point3): number[] {
  const round = dot(ringNormal(ring), up) < 0 ? [...ring].reverse() : [...ring];
  return capTriangles(round).flatMap(([a, b, c]) => [...round[a], ...round[b], ...round[c]]);
}
