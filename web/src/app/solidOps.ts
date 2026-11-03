// The sums behind the 3D Modeling set's Chamfer Edge, Fillet Edge, Shell Solid and Taper Face. Rodeo has no
// solid-modeling kernel, so these work on a solid's triangles and give a mesh back: a chamfer or fillet is
// a prism cut away along each edge, a shell the solid less a copy of it moved in along its faces' normals,
// and a taper turns one face's plane about a line and slides its corners along their other faces to it.
// Push/Pull's Extrude Face builds a slab on a face to add or take away, its Move Face slides a face's
// corners along their other faces, and Offset Edge offsets a face's loop in its plane. World mm, z up; triangles are 9 numbers each. Kept apart from the page so a check can run it.

import { outward } from "../core/csg.ts";
import type { Vec3 } from "../core/index.ts";
import { capTriangles, type Point3 } from "./loftShapes.ts";

export type { Vec3 };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
};

/** two faces meet at a crease past this angle, and a chain of edges turns by no more than this to stay tangent */
const CREASE = (20 * Math.PI) / 180;
const TANGENT = (35 * Math.PI) / 180;
/** points along a quarter circle of a fillet */
const FILLET_STEPS = 12;

/** How close two points are to count as one in this mesh: a millionth of its size. */
function toleranceOf(tris: ArrayLike<number>): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], tris[i]);
    hi[i % 3] = Math.max(hi[i % 3], tris[i]);
  }
  return Math.max(1e-6, Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-6);
}

/** A solid as numbered points and triangles of them, each facing out. */
export interface Indexed {
  readonly points: Vec3[];
  readonly triangles: (readonly [number, number, number])[];
  readonly tol: number;
}

/**
 * The mesh with its corners welded and its triangles facing out, its sides shared wherever they can be.
 * The booleans leave a corner of one triangle partway along another's side; that side is split there,
 * or the mesh would read as open along it. An open mesh's rim is left alone.
 */
export function stitched(flat: ArrayLike<number>): Indexed {
  const tol = toleranceOf(flat);
  const points: Vec3[] = [];
  const cells = new Map<string, number[]>();
  const pointAt = (p: Vec3): number => {
    const [cx, cy, cz] = [Math.floor(p[0] / (2 * tol)), Math.floor(p[1] / (2 * tol)), Math.floor(p[2] / (2 * tol))];
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (const i of cells.get(`${x},${y},${z}`) ?? []) if (length(sub(points[i], p)) <= tol) return i;
        }
      }
    }
    points.push(p);
    const key = `${cx},${cy},${cz}`;
    const cell = cells.get(key);
    if (cell) cell.push(points.length - 1);
    else cells.set(key, [points.length - 1]);
    return points.length - 1;
  };
  const whole: [number, number, number][] = [];
  for (let i = 0; i + 8 < flat.length; i += 9) {
    const t: [number, number, number] = [pointAt([flat[i], flat[i + 1], flat[i + 2]]), pointAt([flat[i + 3], flat[i + 4], flat[i + 5]]), pointAt([flat[i + 6], flat[i + 7], flat[i + 8]])];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
    // one with no height is a side, which its neighbours' sides are split to meet
    const [ab, ac] = [sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]])];
    if (length(cross(ab, ac)) > tol * Math.max(length(ab), length(ac))) whole.push(t);
  }
  const triangles: [number, number, number][] = [];
  // whether point p lies on the side from a to b, short of its ends
  const onSide = (p: number, a: number, b: number): boolean => {
    if (p === a || p === b) return false;
    const ab = sub(points[b], points[a]);
    const t = dot(sub(points[p], points[a]), ab) / dot(ab, ab);
    return t > 0 && t < 1 && length(sub(points[p], add(points[a], scale(ab, t)))) <= tol;
  };
  const divide = (t: readonly [number, number, number], near: readonly number[]): void => {
    for (let k = 0; k < 3; k++) {
      const [a, b, c] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
      const p = near.find((q) => onSide(q, a, b));
      if (p !== undefined) {
        divide([a, p, c], near);
        divide([p, b, c], near);
        return;
      }
    }
    triangles.push([t[0], t[1], t[2]]);
  };
  for (const t of whole) {
    const [a, b, c] = t.map((i) => points[i]);
    const near: number[] = [];
    points.forEach((p, i) => {
      for (let k = 0; k < 3; k++) if (p[k] < Math.min(a[k], b[k], c[k]) - tol || p[k] > Math.max(a[k], b[k], c[k]) + tol) return;
      if (onSide(i, t[0], t[1]) || onSide(i, t[1], t[2]) || onSide(i, t[2], t[0])) near.push(i);
    });
    divide(t, near);
  }
  // the same points now share exact numbers, so outward's welding can't split them
  const flatAgain = triangles.flatMap(([a, b, c]) => [...points[a], ...points[b], ...points[c]]);
  const out = outward(flatAgain, tol / 4);
  const facing = triangles.map((t, i): readonly [number, number, number] => (out[9 * i + 3] === flatAgain[9 * i + 3] && out[9 * i + 4] === flatAgain[9 * i + 4] && out[9 * i + 5] === flatAgain[9 * i + 5] ? t : [t[0], t[2], t[1]]));
  return { points, triangles: facing, tol };
}

/** The solid as `stitched` has it, less the corners that shape nothing. */
function indexed(flat: ArrayLike<number>): Indexed {
  const { points, triangles, tol } = stitched(flat);
  return { points, triangles: withoutSpareCorners(points, triangles, tol), tol };
}

/**
 * The triangles with the corners that shape nothing taken out: those partway along a crease or within
 * a flat face, each merged into a neighbour on the same faces. The booleans leave many, and a shell or
 * taper must move only true corners: one partway along a side would stay put as the side's ends move.
 */
function withoutSpareCorners(points: readonly Vec3[], triangles: readonly (readonly [number, number, number])[], tol: number): (readonly [number, number, number])[] {
  let list = [...triangles];
  const normalOf = (t: readonly [number, number, number]): Vec3 => cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]]));
  const spare = (normals: readonly Vec3[]): boolean => {
    for (let i = 0; i < normals.length; i++) {
      for (let j = i + 1; j < normals.length; j++) {
        const c = cross(normals[i], normals[j]);
        for (let k = j + 1; k < normals.length; k++) if (Math.abs(dot(c, normals[k])) > 1e-6) return false;
      }
    }
    return true;
  };
  for (let changed = true; changed; ) {
    changed = false;
    const around = new Map<number, number[]>();
    list.forEach((t, i) => {
      for (const v of t) around.set(v, [...(around.get(v) ?? []), i]);
    });
    const touched = new Set<number>();
    const gone = new Set<number>();
    const next = [...list];
    for (const [v, tris] of around) {
      if (tris.some((i) => touched.has(i))) continue;
      const normals = tris.map((i) => unit(normalOf(list[i])));
      if (!spare(normals)) continue;
      const neighbours = new Set(tris.flatMap((i) => list[i].filter((u) => u !== v)));
      for (const w of neighbours) {
        const away = sub(points[w], points[v]);
        if (!normals.every((n) => Math.abs(dot(n, away)) <= tol)) continue;
        const moved = tris.flatMap((i) => (list[i].includes(w) ? [] : [{ i, t: list[i].map((u) => (u === v ? w : u)) as unknown as readonly [number, number, number] }]));
        const fine = moved.every(({ i, t }) => {
          const was = unit(normalOf(list[i]));
          const now = normalOf(t);
          const [ab, ac] = [sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]])];
          return dot(now, was) > 0 && length(now) > tol * Math.max(length(ab), length(ac));
        });
        if (!fine) continue;
        for (const i of tris) {
          touched.add(i);
          if (list[i].includes(w)) gone.add(i);
        }
        for (const { i, t } of moved) next[i] = t;
        changed = true;
        break;
      }
    }
    list = next.filter((_, i) => !gone.has(i));
  }
  return list;
}

/** Whether every side of the mesh is shared by two triangles. */
export function isClosedMesh(triangles: ArrayLike<number>): boolean {
  const { triangles: list } = stitched(triangles);
  const sides = new Map<string, number>();
  for (const t of list) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      sides.set(key, (sides.get(key) ?? 0) + 1);
    }
  }
  return [...sides.values()].every((n) => n === 2);
}

/** The solid's triangles with its sides all shared and its faces all facing out, as the booleans need them. */
export function healed(triangles: ArrayLike<number>): number[] {
  const { points, triangles: list } = indexed(triangles);
  return list.flatMap(([a, b, c]) => [...points[a], ...points[b], ...points[c]]);
}

export interface SolidEdge {
  readonly a: Vec3;
  readonly b: Vec3;
  /** the two faces' outward normals */
  readonly n1: Vec3;
  readonly n2: Vec3;
  /** the way each face runs from the edge, across it and along the face */
  readonly d1: Vec3;
  readonly d2: Vec3;
  /** whether the faces fold away from each other (an outside corner) */
  readonly convex: boolean;
}

/** The solid's creases, one to a straight run. Sides with other than two faces, as a mesh that isn't closed has, aren't edges. */
export function solidEdges(triangles: ArrayLike<number>): SolidEdge[] {
  const { points, triangles: list } = indexed(triangles);
  const sides = new Map<string, { p: number; q: number; n: Vec3[]; third: number[] }>();
  for (const t of list) {
    const n = unit(cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]])));
    if (!length(n)) continue;
    for (let k = 0; k < 3; k++) {
      const [p, q, o] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const side = sides.get(key) ?? { p, q, n: [], third: [] };
      side.n.push(n);
      side.third.push(o);
      sides.set(key, side);
    }
  }
  const pieces: (SolidEdge & { readonly p: number; readonly q: number })[] = [];
  for (const { p, q, n, third } of sides.values()) {
    if (n.length !== 2 || dot(n[0], n[1]) > Math.cos(CREASE)) continue;
    const [a, b] = [points[p], points[q]];
    const e = unit(sub(b, a));
    // across the edge in each face, toward that triangle's third corner
    const across = (normal: Vec3, corner: number): Vec3 => {
      const d = unit(cross(normal, e));
      return dot(d, sub(points[corner], a)) >= 0 ? d : scale(d, -1);
    };
    const d1 = across(n[0], third[0]);
    const d2 = across(n[1], third[1]);
    pieces.push({ a, b, p, q, n1: n[0], n2: n[1], d1, d2, convex: dot(d1, n[1]) < -1e-9 });
  }
  // pieces running straight on between the same two faces are one edge
  const at = new Map<number, number[]>();
  pieces.forEach((e, i) => {
    for (const v of [e.p, e.q]) at.set(v, [...(at.get(v) ?? []), i]);
  });
  const sameFaces = (e: SolidEdge, o: SolidEdge): boolean => {
    const same = (u: Vec3, v: Vec3): boolean => dot(u, v) > 0.99999;
    return (same(e.n1, o.n1) && same(e.n2, o.n2)) || (same(e.n1, o.n2) && same(e.n2, o.n1));
  };
  const used = new Set<number>();
  const out: SolidEdge[] = [];
  pieces.forEach((e, i) => {
    if (used.has(i)) return;
    used.add(i);
    const grow = (from: number): number => {
      let tip = from;
      for (;;) {
        const next = (at.get(tip) ?? []).find((j) => !used.has(j) && sameFaces(e, pieces[j]));
        if (next === undefined) return tip;
        used.add(next);
        tip = pieces[next].p === tip ? pieces[next].q : pieces[next].p;
      }
    };
    const q = grow(e.q);
    const p = grow(e.p);
    out.push({ a: points[p], b: points[q], n1: e.n1, n2: e.n2, d1: e.d1, d2: e.d2, convex: e.convex });
  });
  return out;
}

const distanceToSegment = (p: Vec3, a: Vec3, b: Vec3): number => {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12)));
  return length(sub(p, add(a, scale(ab, t))));
};

/** Whether the edge bounds the face at `point` facing `normal`. */
function onFace(e: SolidEdge, point: Vec3, normal: Vec3, tol: number): boolean {
  const same = (n: Vec3): boolean => dot(n, normal) > 0.999 && Math.abs(dot(n, sub(e.a, point))) < tol;
  return same(e.n1) || same(e.n2);
}

/** The index of the edge nearest a clicked point, among those bounding the clicked face; null with none. */
export function nearestEdge(edges: readonly SolidEdge[], point: Vec3, normal: Vec3): number | null {
  const tol = Math.max(1, length(point) * 1e-5);
  let best: number | null = null;
  let bestD = Infinity;
  edges.forEach((e, i) => {
    if (!onFace(e, point, normal, tol)) return;
    const d = distanceToSegment(point, e.a, e.b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The edges round the clicked face. */
export function faceEdges(edges: readonly SolidEdge[], point: Vec3, normal: Vec3): number[] {
  const tol = Math.max(1, length(point) * 1e-5);
  return edges.flatMap((e, i) => (onFace(e, point, normal, tol) ? [i] : []));
}

/** The chain of edges running on smoothly from edge `start`: all of a cylinder's rim from one of its pieces. */
export function tangentChain(edges: readonly SolidEdge[], start: number): number[] {
  const tol = Math.max(1e-3, length(edges[start].a) * 1e-6);
  const near = (p: Vec3, q: Vec3): boolean => length(sub(p, q)) <= tol;
  const chain = new Set([start]);
  const stack = [start];
  const cos = Math.cos(TANGENT);
  while (stack.length) {
    const e = edges[stack.pop()!];
    const dir = unit(sub(e.b, e.a));
    edges.forEach((o, i) => {
      if (chain.has(i)) return;
      const other = unit(sub(o.b, o.a));
      const joined = near(o.a, e.b) || near(o.b, e.a) ? 1 : near(o.a, e.a) || near(o.b, e.b) ? -1 : 0;
      if (joined !== 0 && dot(dir, other) * joined >= cos) {
        chain.add(i);
        stack.push(i);
      }
    });
  }
  return [...chain];
}

/** A closed prism between two copies of a polygon, a fan about its first point at each end. */
function prism(start: readonly Vec3[], end: readonly Vec3[]): number[] {
  const out: number[] = [];
  const tri = (p: Vec3, q: Vec3, r: Vec3): void => {
    out.push(...p, ...q, ...r);
  };
  const n = start.length;
  for (let i = 1; i + 1 < n; i++) {
    tri(start[0], start[i], start[i + 1]);
    tri(end[0], end[i + 1], end[i]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(start[i], start[j], end[j]);
    tri(start[i], end[j], end[i]);
  }
  return out;
}

/** Why the edge can't be cut, or null: only an outside corner has anything to take off. */
export function edgeProblem(e: SolidEdge): string | null {
  return e.convex ? null : "This only cuts outside corners, and that edge is an inside corner.";
}

/** Whether a point is inside the mesh, by how many of its faces a ray from there crosses. */
function insideMesh(tris: ArrayLike<number>, p: Vec3): boolean {
  // not along an axis, where a ray runs through a mesh's edges
  const ray: Vec3 = [0.3713, 0.5281, 0.7637];
  let crossings = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a: Vec3 = [tris[i], tris[i + 1], tris[i + 2]];
    const e1 = sub([tris[i + 3], tris[i + 4], tris[i + 5]], a);
    const e2 = sub([tris[i + 6], tris[i + 7], tris[i + 8]], a);
    const h = cross(ray, e2);
    const det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(p, a);
    const u = dot(s, h) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(ray, q) / det;
    if (v < 0 || u + v > 1) continue;
    if (dot(e2, q) / det > 0) crossings++;
  }
  return crossings % 2 === 1;
}

export type EdgeCut = "chamfer" | "fillet";

/** The polygon of what `kind` takes off an edge, in the plane through its first end, and how far the cut could need to reach past an end. */
function section(e: SolidEdge, kind: EdgeCut, size: number): { readonly points: Vec3[]; readonly reach: number } {
  if (kind === "chamfer") {
    return { points: [add(e.a, scale(add(e.n1, e.n2), size)), add(e.a, scale(e.d1, size)), add(e.a, scale(e.d2, size))], reach: size * 2 };
  }
  // the circle touching both faces, and what lies between it and the corner
  const halfAngle = Math.acos(Math.min(1, Math.max(-1, dot(e.d1, e.d2)))) / 2;
  const tangent = size / Math.tan(halfAngle);
  const centre = add(e.a, scale(unit(add(e.d1, e.d2)), size / Math.sin(halfAngle)));
  const t1 = add(e.a, scale(e.d1, tangent));
  const t2 = add(e.a, scale(e.d2, tangent));
  const u = unit(sub(t1, centre));
  const v = unit(sub(sub(t2, centre), scale(u, dot(sub(t2, centre), u))));
  const sweep = Math.atan2(dot(sub(t2, centre), v), dot(sub(t2, centre), u));
  const steps = Math.max(3, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * FILLET_STEPS));
  const arc: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (sweep * i) / steps;
    arc.push(add(add(centre, scale(u, size * Math.cos(a))), scale(v, size * Math.sin(a))));
  }
  const reach = Math.max(tangent, size);
  return { points: [add(e.a, scale(add(e.n1, e.n2), reach)), ...arc], reach: reach * 2 };
}

/**
 * What to take from the solid for the chosen edges, one closed prism each. A cut runs on past an end
 * with nothing beyond it, so no end of it lies in a face; it stops at one running into more of the
 * solid; and where the chain of chosen edges goes on, it meets the next cut at the angle between them.
 */
export function edgeCuts(triangles: ArrayLike<number>, edges: readonly SolidEdge[], chosen: Iterable<number>, kind: EdgeCut, size: number): number[][] {
  const picked = [...chosen].map((i) => edges[i]);
  const tol = Math.max(1e-3, toleranceOf(triangles) * 10);
  const near = (p: Vec3, q: Vec3): boolean => length(sub(p, q)) <= tol;
  return picked.map((e) => {
    const { points, reach } = section(e, kind, size);
    const end = (at: Vec3, far: Vec3): Vec3[] => {
      // out past this end, along the edge
      const u = unit(sub(at, far));
      const base = points.map((p) => add(p, sub(at, e.a)));
      let onward: Vec3 | null = null;
      let best = Math.cos(TANGENT);
      for (const o of picked) {
        if (o === e) continue;
        const other = near(o.a, at) ? o.b : near(o.b, at) ? o.a : null;
        if (!other) continue;
        const v = unit(sub(other, at));
        if (dot(u, v) >= best) {
          best = dot(u, v);
          onward = v;
        }
      }
      if (onward) {
        const m = unit(add(u, onward));
        return base.map((p) => add(p, scale(u, -dot(sub(p, at), m) / dot(u, m))));
      }
      const beyond = add(add(at, scale(u, size * 0.05)), scale(unit(add(e.d1, e.d2)), size * 0.25));
      return insideMesh(triangles, beyond) ? base : base.map((p) => add(p, scale(u, reach)));
    };
    return prism(end(e.a, e.b), end(e.b, e.a));
  });
}

interface Plane {
  readonly n: Vec3;
  readonly d: number;
}

/** A mesh with its triangles' planes known, flat neighbours sharing a plane. */
interface WeldedMesh {
  readonly points: Vec3[];
  readonly triangles: (readonly [number, number, number])[];
  readonly planes: Plane[];
  /** the plane of each triangle */
  readonly planeOf: number[];
  /** the planes at each point */
  readonly planesAt: Set<number>[];
  readonly tol: number;
}

function welded(triangles: ArrayLike<number>): WeldedMesh {
  const { points, triangles: list, tol } = indexed(triangles);
  const planes: Plane[] = [];
  const planeIndex = new Map<string, number>();
  const kept: (readonly [number, number, number])[] = [];
  const planeOf: number[] = [];
  const planesAt: Set<number>[] = [];
  for (const t of list) {
    const n = unit(cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]])));
    if (!length(n)) continue;
    const d = dot(n, points[t[0]]);
    const k = `${Math.round(n[0] * 1e4)},${Math.round(n[1] * 1e4)},${Math.round(n[2] * 1e4)},${Math.round(d / (tol * 10))}`;
    let p = planeIndex.get(k);
    if (p === undefined) {
      p = planes.length;
      planes.push({ n, d });
      planeIndex.set(k, p);
    }
    kept.push(t);
    planeOf.push(p);
    for (const v of t) (planesAt[v] ??= new Set()).add(p);
  }
  return { points, triangles: kept, planes, planeOf, planesAt, tol };
}

/** The x nearest to satisfying n·x = b for every (n, b): exact for up to three independent planes. */
function solve(rows: readonly (readonly [Vec3, number])[]): Vec3 {
  const m = [
    [1e-9, 0, 0, 0],
    [0, 1e-9, 0, 0],
    [0, 0, 1e-9, 0],
  ];
  for (const [n, b] of rows) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += n[i] * n[j];
      m[i][3] += n[i] * b;
    }
  }
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** The mesh with its points moved, as flat triangles; null when a face or a side turned over, so it would cross itself. */
function moved(mesh: WeldedMesh, points: readonly Vec3[]): number[] | null {
  const out: number[] = [];
  const side = (p: number, q: number): boolean => dot(sub(points[q], points[p]), sub(mesh.points[q], mesh.points[p])) > 0;
  for (let i = 0; i < mesh.triangles.length; i++) {
    const [a, b, c] = mesh.triangles[i];
    const n = cross(sub(points[b], points[a]), sub(points[c], points[a]));
    const was = cross(sub(mesh.points[b], mesh.points[a]), sub(mesh.points[c], mesh.points[a]));
    if (dot(n, was) <= 0 || !side(a, b) || !side(b, c) || !side(c, a)) return null;
    out.push(...points[a], ...points[b], ...points[c]);
  }
  return out;
}

export interface FacePick {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/** Which of the mesh's planes each picked face is. */
function planesPicked(mesh: WeldedMesh, picks: readonly FacePick[]): Set<number> {
  const tol = Math.max(1, mesh.points.reduce((m, p) => Math.max(m, length(p)), 0) * 1e-5);
  const out = new Set<number>();
  for (const pick of picks) {
    mesh.planes.forEach((p, i) => {
      if (dot(p.n, pick.normal) > 0.9999 && Math.abs(dot(p.n, pick.point) - p.d) < tol) out.add(i);
    });
  }
  return out;
}

/** Every flat piece running smoothly on from the clicked one: all the facets of a cylinder's side. */
export function tangentFaces(triangles: ArrayLike<number>, pick: FacePick): FacePick[] {
  const mesh = welded(triangles);
  const start = [...planesPicked(mesh, [pick])];
  // planes meeting along a side
  const beside = new Map<number, Set<number>>();
  const bySide = new Map<string, number[]>();
  mesh.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const [p, q] = [t[k], t[(k + 1) % 3]];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      bySide.set(key, [...(bySide.get(key) ?? []), mesh.planeOf[i]]);
    }
  });
  for (const list of bySide.values()) {
    if (list.length !== 2 || list[0] === list[1]) continue;
    for (const [a, b] of [[list[0], list[1]], [list[1], list[0]]]) {
      const set = beside.get(a) ?? new Set();
      set.add(b);
      beside.set(a, set);
    }
  }
  const cos = Math.cos(TANGENT);
  const seen = new Set(start);
  const stack = [...start];
  while (stack.length) {
    const a = stack.pop()!;
    for (const b of beside.get(a) ?? []) {
      if (!seen.has(b) && dot(mesh.planes[a].n, mesh.planes[b].n) >= cos) {
        seen.add(b);
        stack.push(b);
      }
    }
  }
  return [...seen].map((k) => {
    const i = mesh.planeOf.indexOf(k);
    const [a, b, c] = mesh.triangles[i];
    return { point: scale(add(add(mesh.points[a], mesh.points[b]), mesh.points[c]), 1 / 3), normal: mesh.planes[k].n };
  });
}

/** The line segments round the picked faces, 6 numbers each. */
export function faceOutline(triangles: ArrayLike<number>, picks: readonly FacePick[]): number[] {
  const mesh = welded(triangles);
  const picked = planesPicked(mesh, picks);
  const seen = new Map<string, [number, number, boolean]>();
  mesh.triangles.forEach((t, i) => {
    const mine = picked.has(mesh.planeOf[i]);
    for (let k = 0; k < 3; k++) {
      const [p, q] = [t[k], t[(k + 1) % 3]];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const was = seen.get(key);
      // a side with the face on just one of its two triangles
      seen.set(key, was ? [p, q, was[2] !== mine] : [p, q, mine]);
    }
  });
  return [...seen.values()].flatMap(([p, q, keep]) => (keep ? [...mesh.points[p], ...mesh.points[q]] : []));
}

export interface ShellCopies {
  /** the solid to cut from */
  readonly outer: number[];
  /** the copy to take away */
  readonly inner: number[];
}

/**
 * A shell's two solids: Inside keeps the solid's own faces as the outer ones and moves a copy in by the
 * thickness, Outside moves them out. A picked face stays open: the copy to take away runs through it.
 * A string says why it can't be done.
 */
export function shellCopies(triangles: ArrayLike<number>, thickness: number, inside: boolean, open: readonly FacePick[]): ShellCopies | string {
  const mesh = welded(triangles);
  if (!mesh.triangles.length) return "That object has no faces to shell.";
  const opened = planesPicked(mesh, open);
  if (opened.size === mesh.planes.length) return "Leave at least one face closed.";
  // each corner moves by the thickness along its faces' normals; the open faces' copies stand off the solid
  const shifted = (amount: number, standOff: number): Vec3[] =>
    mesh.points.map((p, i) => add(p, solve([...(mesh.planesAt[i] ?? [])].map((k): [Vec3, number] => [mesh.planes[k].n, opened.has(k) ? standOff : amount]))));
  const flat = (points: readonly Vec3[]): number[] | null => moved(mesh, points);
  const original = flat(mesh.points)!;
  const tooThick = "The shell's too thick for this solid: its faces would cross.";
  if (inside) {
    const inner = flat(shifted(-thickness, thickness));
    return inner ? { outer: original, inner } : tooThick;
  }
  const outer = flat(shifted(thickness, 0));
  if (!outer) return tooThick;
  if (!opened.size) return { outer, inner: original };
  const inner = flat(shifted(0, thickness * 2));
  return inner ? { outer, inner } : tooThick;
}

/**
 * The solid with one face turned by `angle` degrees about the line where it meets the reference plane:
 * positive leans it in, farther from that plane. Its corners slide along their other faces. A string
 * says why it can't be done.
 */
export function taperedFace(triangles: ArrayLike<number>, face: FacePick, reference: FacePick, angle: number): number[] | string {
  const mesh = welded(triangles);
  const picked = planesPicked(mesh, [face]);
  const k = [...picked][0];
  if (k === undefined) return "Click a flat face of the solid to taper.";
  const n = mesh.planes[k].n;
  // the reference's direction square to the face, from that plane toward the face's middle
  let across = sub(reference.normal, scale(n, dot(reference.normal, n)));
  if (length(across) < 1e-6) return "The reference plane is parallel to that face, so there's no line to turn it about.";
  across = unit(across);
  const facePoints = mesh.points.flatMap((p, i) => (mesh.planesAt[i]?.has(k) ? [p] : []));
  const middle = scale(facePoints.reduce<Vec3>((a, p) => add(a, p), [0, 0, 0]), 1 / facePoints.length);
  const off = dot(reference.normal, sub(middle, reference.point));
  if (off * dot(reference.normal, across) < 0) across = scale(across, -1);
  const a = (angle * Math.PI) / 180;
  const turned = add(scale(n, Math.cos(a)), scale(across, Math.sin(a)));
  // a point on the line the face turns about: in the face, in the reference plane
  const line = solve([
    [n, mesh.planes[k].d],
    [reference.normal, dot(reference.normal, reference.point)],
    [unit(cross(n, reference.normal)), dot(unit(cross(n, reference.normal)), middle)],
  ]);
  const plane: Plane = { n: turned, d: dot(turned, line) };
  const points = mesh.points.map((p, i): Vec3 => {
    const at = mesh.planesAt[i];
    if (!at?.has(k)) return p;
    // from where it is, so a corner partway along a side stays on that side
    const others = [...at].filter((o) => o !== k).map((o): [Vec3, number] => [mesh.planes[o].n, mesh.planes[o].d - dot(mesh.planes[o].n, p)]);
    return add(p, solve([[plane.n, plane.d - dot(plane.n, p)], ...others]));
  });
  return moved(mesh, points) ?? "That taper's too steep for this solid: its faces would cross.";
}

// ---- Push/Pull and Offset Edge ---------------------------------------------

const distanceToTriangle = (p: Vec3, a: Vec3, b: Vec3, c: Vec3): number => {
  const n = cross(sub(b, a), sub(c, a));
  const on = dot(cross(sub(b, a), sub(p, a)), n) >= 0 && dot(cross(sub(c, b), sub(p, b)), n) >= 0 && dot(cross(sub(a, c), sub(p, c)), n) >= 0;
  if (on) return Math.abs(dot(n, sub(p, a))) / Math.max(length(n), 1e-12);
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a));
};

/** A ring's normal with the length of twice its area, along the way it turns. */
const turningOf = (ring: readonly Vec3[]): Vec3 => ring.reduce<Vec3>((sum, p, i) => add(sum, cross(p, ring[(i + 1) % ring.length])), [0, 0, 0]);

/** One face of a solid, as Push/Pull and Offset Edge take it: flat, or a smooth run of facets. */
export interface SolidFace {
  readonly mesh: WeldedMesh;
  /** the triangles it's made of */
  readonly triangles: ReadonlySet<number>;
  /** whether it's all on one plane */
  readonly flat: boolean;
  /** the plane of the triangle clicked */
  readonly plane: number;
  readonly normal: Vec3;
  /** the click */
  readonly point: Vec3;
  /** the loops round it with the face on their left, the outer one first */
  readonly rings: readonly (readonly number[])[];
  /** points that travel with the face when it moves: a boss standing on it, a pocket sunk in it */
  readonly carried: ReadonlySet<number>;
}

/** The face a click landed on; a string says why there's none. */
export function solidFace(triangles: ArrayLike<number>, pick: FacePick): SolidFace | string {
  const mesh = welded(triangles);
  const planes = planesPicked(mesh, [pick]);
  let start = -1;
  let nearest = Infinity;
  mesh.triangles.forEach((t, i) => {
    if (planes.size && !planes.has(mesh.planeOf[i])) return;
    const d = distanceToTriangle(pick.point, mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]);
    if (d < nearest) {
      nearest = d;
      start = i;
    }
  });
  if (start < 0) return "That object has no face there.";
  const bySide = new Map<string, number[]>();
  const sideKey = (p: number, q: number): string => (p < q ? `${p},${q}` : `${q},${p}`);
  mesh.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = sideKey(t[k], t[(k + 1) % 3]);
      bySide.set(key, [...(bySide.get(key) ?? []), i]);
    }
  });
  const smooth = Math.cos(CREASE);
  const chosen = new Set([start]);
  const stack = [start];
  let flat = true;
  while (stack.length) {
    const i = stack.pop()!;
    const t = mesh.triangles[i];
    for (let k = 0; k < 3; k++) {
      for (const o of bySide.get(sideKey(t[k], t[(k + 1) % 3])) ?? []) {
        if (chosen.has(o)) continue;
        const same = mesh.planeOf[o] === mesh.planeOf[i];
        if (!same && dot(mesh.planes[mesh.planeOf[o]].n, mesh.planes[mesh.planeOf[i]].n) < smooth) continue;
        if (!same) flat = false;
        chosen.add(o);
        stack.push(o);
      }
    }
  }
  // the sides with the face on one of their two triangles, each way round it
  const rim = new Map<string, readonly [number, number]>();
  for (const i of chosen) {
    const t = mesh.triangles[i];
    for (let k = 0; k < 3; k++) {
      const [p, q] = [t[k], t[(k + 1) % 3]];
      if (!rim.delete(`${q},${p}`)) rim.set(`${p},${q}`, [p, q]);
    }
  }
  const from = new Map<number, number[]>();
  for (const [p, q] of rim.values()) from.set(p, [...(from.get(p) ?? []), q]);
  const rings: number[][] = [];
  for (const [p] of rim.values()) {
    if (!from.get(p)?.length) continue;
    const ring = [p];
    let at = from.get(p)!.pop()!;
    while (at !== p) {
      ring.push(at);
      const next = from.get(at)?.pop();
      if (next === undefined) break;
      at = next;
    }
    rings.push(ring);
  }
  const ringSize = (ring: readonly number[]): number => length(turningOf(ring.map((v) => mesh.points[v])));
  rings.sort((a, b) => ringSize(b) - ringSize(a));
  // the rest of the solid in connected pieces: one that doesn't reach the outer loop stands on the face or is sunk in it
  const outerSides = new Set((rings[0] ?? []).map((v, i, r) => sideKey(v, r[(i + 1) % r.length])));
  const carried = new Set<number>();
  const seen = new Set(chosen);
  for (let i = 0; i < mesh.triangles.length; i++) {
    if (seen.has(i)) continue;
    const piece = [i];
    seen.add(i);
    let reaches = false;
    for (let j = 0; j < piece.length; j++) {
      const t = mesh.triangles[piece[j]];
      for (let k = 0; k < 3; k++) {
        const key = sideKey(t[k], t[(k + 1) % 3]);
        if (outerSides.has(key)) reaches = true;
        for (const o of bySide.get(key) ?? []) {
          if (seen.has(o)) continue;
          seen.add(o);
          piece.push(o);
        }
      }
    }
    if (!reaches) for (const j of piece) for (const v of mesh.triangles[j]) carried.add(v);
  }
  const plane = mesh.planeOf[start];
  return { mesh, triangles: chosen, flat, plane, normal: mesh.planes[plane].n, point: pick.point, rings, carried };
}

function planesOfFace(face: SolidFace): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const i of face.triangles) {
    for (const v of face.mesh.triangles[i]) {
      const set = out.get(v) ?? new Set<number>();
      set.add(face.mesh.planeOf[i]);
      out.set(v, set);
    }
  }
  return out;
}

/** Where a corner of the face goes when the face stands off by `distance`, square to its own planes. */
function offCorner(face: SolidFace, planesOf: ReadonlyMap<number, ReadonlySet<number>>, v: number, distance: number): Vec3 {
  const { mesh } = face;
  return add(mesh.points[v], solve([...(planesOf.get(v) ?? [face.plane])].map((k): [Vec3, number] => [mesh.planes[k].n, distance])));
}

/** Each triangle facing the other way. */
function turnedOver(triangles: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) out.push(...triangles.slice(i + 6, i + 9), ...triangles.slice(i + 3, i + 6), ...triangles.slice(i, i + 3));
  return out;
}

/**
 * The closed solid between a face and its copy `distance` out (or in, below 0), with square sides:
 * Extrude Face adds it to the solid or takes it away.
 */
export function faceSlab(face: SolidFace, distance: number): number[] {
  const { mesh } = face;
  const planes = planesOfFace(face);
  const top = (v: number): Vec3 => offCorner(face, planes, v, distance);
  const out: number[] = [];
  for (const i of face.triangles) {
    const [a, b, c] = mesh.triangles[i];
    out.push(...mesh.points[c], ...mesh.points[b], ...mesh.points[a], ...top(a), ...top(b), ...top(c));
  }
  for (const ring of face.rings) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      out.push(...mesh.points[p], ...mesh.points[q], ...top(q), ...mesh.points[p], ...top(q), ...top(p));
    });
  }
  return distance < 0 ? turnedOver(out) : out;
}

/** A few of a ring's points to join with lines in a preview: its corners, or four round a smooth one. */
function ringCorners(points: readonly Vec3[]): number[] {
  const n = points.length;
  const sharp = points.flatMap((p, i) => {
    const [a, b] = [unit(sub(p, points[(i + n - 1) % n])), unit(sub(points[(i + 1) % n], p))];
    return dot(a, b) < Math.cos(CREASE) ? [i] : [];
  });
  return sharp.length ? sharp : [0, 1, 2, 3].map((k) => Math.floor((k * n) / 4));
}

/** The lines of a face and where its corners go: its loops, their copies and lines between. */
function travelLines(face: SolidFace, to: (v: number) => Vec3): number[] {
  const { mesh } = face;
  const out: number[] = [];
  for (const ring of face.rings) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      out.push(...mesh.points[p], ...mesh.points[q], ...to(p), ...to(q));
    });
    for (const i of ringCorners(ring.map((v) => mesh.points[v]))) out.push(...mesh.points[ring[i]], ...to(ring[i]));
  }
  return out;
}

export function faceSlabLines(face: SolidFace, distance: number): number[] {
  const planes = planesOfFace(face);
  return travelLines(face, (v) => offCorner(face, planes, v, distance));
}

/** Where a point of the solid goes when Move Face moves the face: its corners slide along their other faces, what stands on it goes with it. */
function movedCorner(face: SolidFace, onFace: ReadonlyMap<number, ReadonlySet<number>>, v: number, distance: number): Vec3 {
  const { mesh, normal, plane } = face;
  const p = mesh.points[v];
  if (face.carried.has(v)) return add(p, scale(normal, distance));
  if (!onFace.has(v)) return p;
  const others = [...(mesh.planesAt[v] ?? [])].filter((k) => k !== plane).map((k): [Vec3, number] => [mesh.planes[k].n, 0]);
  return add(p, solve([[normal, distance], ...others]));
}

/** The solid with a flat face moved by `distance`, its neighbours running on to meet it. A string says why it can't be done. */
export function movedFace(face: SolidFace, distance: number): number[] | string {
  if (!face.flat) return "Move Face takes a flat face. Use Extrude Face for a curved one.";
  const onFace = planesOfFace(face);
  const points = face.mesh.points.map((_, v) => movedCorner(face, onFace, v, distance));
  const result = moved(face.mesh, points);
  // all the way down to the far side leaves nothing, though no face has turned over
  if (!result || meshVolume(result) < 1e-6 * meshVolume(moved(face.mesh, face.mesh.points)!)) return "That's too far for this solid: its faces would cross.";
  return result;
}

export function movedFaceLines(face: SolidFace, distance: number): number[] {
  const onFace = planesOfFace(face);
  return travelLines(face, (v) => movedCorner(face, onFace, v, distance));
}

/** A curve laid on a face's plane, along the face's normal. */
export function onFacePlane(face: SolidFace, points: readonly Vec3[]): Vec3[] {
  return points.map((p) => sub(p, scale(face.normal, dot(face.normal, sub(p, face.point)))));
}

/** The closed solid on a flat ring, `distance` along `normal`; a string says why there's none. */
export function ringSlab(ring: readonly Vec3[], normal: Vec3, distance: number): number[] | string {
  const way = dot(turningOf(ring), normal);
  if (Math.abs(way) < 1e-6) return "That curve has no area on this face.";
  const round = way > 0 ? ring : [...ring].reverse();
  const caps = capTriangles(round as Point3[]);
  if (!caps.length) return "That curve crosses itself.";
  const off = (p: Vec3): Vec3 => add(p, scale(normal, distance));
  const out: number[] = [];
  for (const [a, b, c] of caps) out.push(...round[c], ...round[b], ...round[a], ...off(round[a]), ...off(round[b]), ...off(round[c]));
  round.forEach((p, i) => {
    const q = round[(i + 1) % round.length];
    out.push(...p, ...q, ...off(q), ...p, ...off(q), ...off(p));
  });
  return distance < 0 ? turnedOver(out) : out;
}

export const insideRing = (p: Vec3, ring: readonly Vec3[], normal: Vec3): boolean => {
  // the ring seen along the normal, in two axes across it
  const axis = Math.abs(normal[2]) >= Math.abs(normal[0]) && Math.abs(normal[2]) >= Math.abs(normal[1]) ? 2 : Math.abs(normal[1]) >= Math.abs(normal[0]) ? 1 : 0;
  const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a[v] > p[v] !== b[v] > p[v] && p[u] < ((b[u] - a[u]) * (p[v] - a[v])) / (b[v] - a[v]) + a[u]) inside = !inside;
  }
  return inside;
};

/** Closed rings on one plane, sorted into shapes: a ring inside another is that one's hole, and one inside that a shape again. */
export function nestedRings(rings: readonly (readonly Vec3[])[], normal: Vec3): { readonly outer: readonly Vec3[]; readonly holes: readonly (readonly Vec3[])[] }[] {
  const depth = rings.map((r, i) => rings.filter((o, j) => j !== i && insideRing(r[0], o, normal)).length);
  return rings.flatMap((outer, i) => (depth[i] % 2 ? [] : [{ outer, holes: rings.filter((r, j) => depth[j] === depth[i] + 1 && insideRing(r[0], outer, normal)) }]));
}

/** Nearest place on a face's ring to `p`: the side, how far along it, and how far off. */
function nearestOnRing(ring: readonly Vec3[], p: Vec3): { side: number; along: number; point: Vec3; off: number } {
  let best = { side: 0, along: 0, point: ring[0], off: Infinity };
  ring.forEach((a, side) => {
    const b = ring[(side + 1) % ring.length];
    const ab = sub(b, a);
    const along = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12)));
    const point = add(a, scale(ab, along));
    const off = length(sub(p, point));
    if (off < best.off) best = { side, along, point, off };
  });
  return best;
}

/** The part of a face on the clicked side of an open curve running from edge to edge, as a ring; a string says why there's none. */
export function splitFaceRing(face: SolidFace, curve: readonly Vec3[], at: Vec3): Vec3[] | string {
  const ring = (face.rings[0] ?? []).map((v) => face.mesh.points[v]);
  const c = onFacePlane(face, curve);
  if (ring.length < 3 || c.length < 2) return "That face has no edge to split from.";
  const [s, e] = [nearestOnRing(ring, c[0]), nearestOnRing(ring, c[c.length - 1])];
  const reach = Math.max(1, ring.reduce((m, p) => Math.max(m, length(sub(p, ring[0]))), 0) * 2e-3);
  if (s.off > reach || e.off > reach) return "An open curve must run from edge to edge of the face. Close it, or draw it to the edges.";
  const walk = (from: typeof s, to: typeof s): Vec3[] => {
    if (from.side === to.side && to.along >= from.along) return [];
    const out: Vec3[] = [];
    let i = from.side;
    do {
      i = (i + 1) % ring.length;
      out.push(ring[i]);
    } while (i !== to.side);
    return out;
  };
  const line = [s.point, ...c.slice(1, -1), e.point];
  const one = [...line, ...walk(e, s)];
  return insideRing(at, one, face.normal) ? one : [...[...line].reverse(), ...walk(s, e)];
}

/** The triangles of a face, of the faces next to it, and of the faces running smoothly on from those. */
export function faceAndNeighbours(face: SolidFace): Set<number> {
  const { mesh } = face;
  const sideKey = (p: number, q: number): string => (p < q ? `${p},${q}` : `${q},${p}`);
  const bySide = new Map<string, number[]>();
  mesh.triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const key = sideKey(t[k], t[(k + 1) % 3]);
      bySide.set(key, [...(bySide.get(key) ?? []), i]);
    }
  });
  const next = (i: number): number[] => {
    const t = mesh.triangles[i];
    return [0, 1, 2].flatMap((k) => bySide.get(sideKey(t[k], t[(k + 1) % 3])) ?? []);
  };
  const smooth = Math.cos(CREASE);
  const out = new Set(face.triangles);
  const stack: number[] = [];
  for (const i of face.triangles) {
    for (const o of next(i)) {
      if (out.has(o)) continue;
      out.add(o);
      stack.push(o);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    for (const o of next(i)) {
      if (out.has(o)) continue;
      const same = mesh.planeOf[o] === mesh.planeOf[i];
      if (!same && dot(mesh.planes[mesh.planeOf[o]].n, mesh.planes[mesh.planeOf[i]].n) < smooth) continue;
      out.add(o);
      stack.push(o);
    }
  }
  return out;
}

/** The side of a loop round a face nearest `p`: which loop, which side. */
export function rimSideAt(face: SolidFace, p: Vec3): { readonly ring: number; readonly side: number } {
  let best = { ring: 0, side: 0 };
  let off = Infinity;
  face.rings.forEach((ring, r) => {
    const found = nearestOnRing(ring.map((v) => face.mesh.points[v]), p);
    if (found.off < off) {
      off = found.off;
      best = { ring: r, side: found.side };
    }
  });
  return best;
}

/** The sides of a loop in order round it, when they run on from one another. */
function runOf(sides: ReadonlySet<number>, count: number): number[] | null {
  if (sides.size === count) return [...Array(count).keys()];
  const start = [...sides].filter((i) => !sides.has((i + count - 1) % count));
  if (start.length !== 1) return null;
  return [...Array(sides.size).keys()].map((k) => (start[0] + k) % count);
}

/** Which way into the face a side of its loop looks. */
export function inwardOfSide(face: SolidFace, ring: number, side: number): Vec3 {
  const r = face.rings[ring];
  return unit(cross(face.normal, sub(face.mesh.points[r[(side + 1) % r.length]], face.mesh.points[r[side]])));
}

/**
 * Sides of a face's loop offset in the face's plane: into the face above 0, off it below. All of a loop
 * makes a closed curve, some of it an open one whose ends run on to the face's edge. A string says why
 * it can't be done.
 */
export function offsetRim(face: SolidFace, ring: number, sides: ReadonlySet<number>, distance: number): { readonly points: Vec3[]; readonly closed: boolean } | string {
  const { mesh, normal } = face;
  const points = face.rings[ring].map((v) => mesh.points[v]);
  const n = points.length;
  const run = runOf(sides, n);
  if (!run) return "Only edges that run on from one another can be offset together.";
  const look = (i: number): Vec3 => inwardOfSide(face, ring, i);
  const joined = (a: number, b: number, p: Vec3): Vec3 => add(p, solve([[look(a), distance], [look(b), distance], [normal, 0]]));
  const tooFar = "That's too far for this face: the curve would cross itself.";
  const keepsWay = (out: readonly Vec3[], was: readonly Vec3[]): boolean => out.every((p, i) => i + 1 >= out.length || dot(sub(out[i + 1], p), sub(was[i + 1], was[i])) > 0);
  if (run.length === n) {
    const out = points.map((p, i) => joined((i + n - 1) % n, i, p));
    return keepsWay([...out, out[0]], [...points, points[0]]) ? { points: out, closed: true } : tooFar;
  }
  const was = [...run.map((i) => points[i]), points[(run[run.length - 1] + 1) % n]];
  const out = was.map((p, k) => {
    if (k === 0) return add(p, scale(look(run[0]), distance));
    if (k === run.length) return add(p, scale(look(run[k - 1]), distance));
    return joined(run[k - 1], run[k], p);
  });
  if (!keepsWay(out, was)) return tooFar;
  if (distance <= 0) return { points: out, closed: false };
  // into the face, its ends run on to the edge
  const toEdge = (from: Vec3, along: Vec3): Vec3 | null => {
    let best: Vec3 | null = null;
    let nearest = Infinity;
    for (const r of face.rings) {
      r.forEach((v, i) => {
        const [a, b] = [mesh.points[v], mesh.points[r[(i + 1) % r.length]]];
        const across = dot(normal, cross(along, sub(b, a)));
        if (Math.abs(across) < 1e-9) return;
        const t = dot(normal, cross(sub(a, from), sub(b, a))) / across;
        const s = dot(normal, cross(sub(a, from), along)) / across;
        if (s < -1e-9 || s > 1 + 1e-9 || Math.abs(t) >= nearest) return;
        nearest = Math.abs(t);
        best = add(from, scale(along, t));
      });
    }
    return best;
  };
  const start = toEdge(out[0], unit(sub(out[0], out[1])));
  const end = toEdge(out[out.length - 1], unit(sub(out[out.length - 1], out[out.length - 2])));
  if (!start || !end) return "That's farther than this face reaches.";
  out[0] = start;
  out[out.length - 1] = end;
  return keepsWay(out, was) ? { points: out, closed: false } : tooFar;
}

/** A closed mesh's volume. */
export function meshVolume(triangles: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const a: Vec3 = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const b: Vec3 = [triangles[i + 3], triangles[i + 4], triangles[i + 5]];
    const c: Vec3 = [triangles[i + 6], triangles[i + 7], triangles[i + 8]];
    v += dot(a, cross(b, c)) / 6;
  }
  return Math.abs(v);
}
