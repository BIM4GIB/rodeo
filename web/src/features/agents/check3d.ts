// Whether a solid is closed, from the triangles the 3D view shows of it. A closed solid's every
// edge borders two faces; an edge with a face on one side only is the rim of a hole, and one with
// three or more is faces overlapping or solids touching along a line. Which way round the faces
// are wound isn't read: the 3D model doesn't wind them all one way (an extrude's cap can face in),
// and the view draws both sides. Edges are first split where another corner lies on them, so
// faces meeting a longer edge part way along (a T junction) still close it. The rims are gathered
// into holes, each with where it is, its size and its edges.

import type { Mesh3D } from "../../core/types.ts";

type V3 = [number, number, number];

export interface Hole {
  /** the middle of its rim, world mm */
  readonly at: V3;
  /** the longest side of the box round its rim, mm */
  readonly across: number;
  readonly edges: number;
  /** its rim, 6 numbers (two corners) an edge */
  readonly rim: readonly number[];
}

export interface Closure {
  readonly triangles: number;
  /** edges between corners, after welding and splitting */
  readonly edges: number;
  /** edges with a face on one side only: hole rims */
  readonly open: number;
  /** edges with three or more faces */
  readonly overlaps: number;
  /** the holes, largest first */
  readonly holes: readonly Hole[];
}

/** corners closer than this (mm) are one corner, and a corner this near an edge splits it, at most */
const WELD = 0.5;
/** a corner nearer an edge than this share of its length lies on it (more is a curve's chord cutting a corner off) */
const ON_EDGE = 0.02;

/** The rounding of 32-bit coordinates (the 3D view's) at the size of `tris`, a few times over. */
function noiseOf(tris: ArrayLike<number>): number {
  let size = 0;
  for (let i = 0; i < tris.length; i++) size = Math.max(size, Math.abs(tris[i]));
  return Math.max(1e-4, size * 3e-7);
}

/**
 * The loose weld: WELD, or a quarter of the solid's shortest side when that is less (a small
 * part's round holes have sides far under a millimetre), for drawings whose corners miss a little.
 */
function looseWeld(tris: ArrayLike<number>, noise: number): number {
  let shortest = Infinity;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    for (const [p, q] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]]) {
      const d = Math.hypot(tris[p] - tris[q], tris[p + 1] - tris[q + 1], tris[p + 2] - tris[q + 2]);
      if (d > 8 * noise && d < shortest) shortest = d;
    }
  }
  return Math.min(WELD, Math.max(4 * noise, shortest / 4));
}

/**
 * How closed the solid made of `tris` (9 numbers a triangle, world mm) is. Corners are first taken
 * as one only where rounding parts them, as a solid Rodeo cut or extruded has them; one that isn't
 * closed that way is checked again with corners a little apart taken as one (WELD at most), as
 * drawn ones may be, and the better reading kept. A `weld` given is used alone.
 */
export function closureOf(tris: ArrayLike<number>, weld?: number): Closure {
  if (weld !== undefined) return closureAt(tris, weld);
  const noise = noiseOf(tris);
  const tight = closureAt(tris, 4 * noise);
  if (tight.open === 0) return tight;
  const loose = closureAt(tris, looseWeld(tris, noise));
  return loose.open < tight.open ? loose : tight;
}

function closureAt(tris: ArrayLike<number>, weld: number): Closure {
  // weld the corners: a grid of cells `weld` wide, searched with their neighbours
  const pts: number[] = [];
  const cells = new Map<string, number[]>();
  const cell = (x: number, y: number, z: number): string => `${Math.floor(x / weld)},${Math.floor(y / weld)},${Math.floor(z / weld)}`;
  const point = (x: number, y: number, z: number): number => {
    const [cx, cy, cz] = [Math.floor(x / weld), Math.floor(y / weld), Math.floor(z / weld)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const n of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (Math.hypot(pts[n * 3] - x, pts[n * 3 + 1] - y, pts[n * 3 + 2] - z) <= weld) return n;
          }
        }
    const n = pts.length / 3;
    pts.push(x, y, z);
    const key = cell(x, y, z);
    const list = cells.get(key);
    if (list) list.push(n);
    else cells.set(key, [n]);
    return n;
  };
  const sides: [number, number][] = [];
  let triangles = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = point(tris[i], tris[i + 1], tris[i + 2]);
    const b = point(tris[i + 3], tris[i + 4], tris[i + 5]);
    const c = point(tris[i + 6], tris[i + 7], tris[i + 8]);
    if (a === b || b === c || c === a) continue;
    triangles++;
    sides.push([a, b], [b, c], [c, a]);
  }

  // corners lying on an edge part way along split it; the candidates are found among the corners
  // sorted along the axis the edge runs furthest on, between its two ends
  const count = pts.length / 3;
  const sorted = [0, 1, 2].map((k) => {
    const order = Array.from({ length: count }, (_, i) => i).sort((p, q) => pts[p * 3 + k] - pts[q * 3 + k]);
    return { order, at: order.map((i) => pts[i * 3 + k]) };
  });
  const firstAtLeast = (at: readonly number[], x: number): number => {
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const splitCache = new Map<string, number[]>();
  /** the corners from a to b along the edge, a and b included */
  const along = (a: number, b: number): number[] => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let chain = splitCache.get(key);
    if (!chain) {
      const [p, q] = a < b ? [a, b] : [b, a];
      const P = [pts[p * 3], pts[p * 3 + 1], pts[p * 3 + 2]];
      const D = [pts[q * 3] - P[0], pts[q * 3 + 1] - P[1], pts[q * 3 + 2] - P[2]];
      const len2 = D[0] * D[0] + D[1] * D[1] + D[2] * D[2];
      const near = Math.min(weld, ON_EDGE * Math.sqrt(len2));
      const lo = P.map((c, k) => Math.min(c, c + D[k]) - weld);
      const hi = P.map((c, k) => Math.max(c, c + D[k]) + weld);
      const axis = [0, 1, 2].reduce((m, k) => (Math.abs(D[k]) > Math.abs(D[m]) ? k : m), 0);
      const { order, at } = sorted[axis];
      const inside: { n: number; t: number }[] = [];
      for (let i = firstAtLeast(at, lo[axis]); i < order.length && at[i] <= hi[axis]; i++) {
        const n = order[i];
        if (n === p || n === q) continue;
        const x = pts[n * 3];
        const y = pts[n * 3 + 1];
        const z = pts[n * 3 + 2];
        if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) continue;
        const t = ((x - P[0]) * D[0] + (y - P[1]) * D[1] + (z - P[2]) * D[2]) / len2;
        if (t <= 0 || t >= 1) continue;
        const off = Math.hypot(P[0] + D[0] * t - x, P[1] + D[1] * t - y, P[2] + D[2] * t - z);
        if (off <= near) inside.push({ n, t });
      }
      inside.sort((u, v) => u.t - v.t);
      chain = [p, ...inside.map((s) => s.n), q];
      splitCache.set(key, chain);
    }
    return a < b ? chain : [...chain].reverse();
  };

  // the faces on each piece of edge
  const runs = new Map<string, { a: number; b: number; faces: number }>();
  for (const [a, b] of sides) {
    const chain = along(a, b);
    for (let k = 0; k + 1 < chain.length; k++) {
      const [u, v] = [Math.min(chain[k], chain[k + 1]), Math.max(chain[k], chain[k + 1])];
      const key = `${u},${v}`;
      const r = runs.get(key);
      if (r) r.faces++;
      else runs.set(key, { a: u, b: v, faces: 1 });
    }
  }
  let open = 0;
  let overlaps = 0;
  const rims: [number, number][] = [];
  for (const r of runs.values()) {
    if (r.faces === 1) {
      open++;
      rims.push([r.a, r.b]);
    } else if (r.faces >= 3) overlaps++;
  }

  // rims joined where they share a corner are one hole
  const parent = new Map<number, number>();
  const root = (n: number): number => {
    let r = n;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  for (const [a, b] of rims) {
    const [ra, rb] = [root(a), root(b)];
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<number, { min: V3; max: V3; edges: number; rim: number[] }>();
  for (const [a, b] of rims) {
    const g = root(a);
    let h = groups.get(g);
    if (!h) groups.set(g, (h = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], edges: 0, rim: [] }));
    h.edges++;
    h.rim.push(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2], pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2]);
    for (const n of [a, b]) {
      for (let k = 0; k < 3; k++) {
        h.min[k] = Math.min(h.min[k], pts[n * 3 + k]);
        h.max[k] = Math.max(h.max[k], pts[n * 3 + k]);
      }
    }
  }
  const holes = [...groups.values()]
    .map((h) => ({
      at: [0, 1, 2].map((k) => Math.round((h.min[k] + h.max[k]) / 2)) as V3,
      across: tenth(Math.max(h.max[0] - h.min[0], h.max[1] - h.min[1], h.max[2] - h.min[2])),
      edges: h.edges,
      rim: h.rim,
    }))
    .sort((p, q) => q.across - p.across);
  return { triangles, edges: runs.size, open, overlaps, holes };
}

/** whole millimetres from 10 up, tenths below: a screw hole's gap is under a millimetre */
const tenth = (v: number): number => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

export interface SolidCheck {
  /** the top-level object */
  readonly id: string;
  readonly layerId: string;
  readonly closure: Closure;
}

/**
 * Each top-level object's faces in `meshes` (the 3D view's model) checked as one solid, worst
 * first, and the objects that show only lines in 3D (3D polygons, loci).
 */
export function checkSolids(meshes: readonly Mesh3D[]): { solids: SolidCheck[]; linesOnly: string[] } {
  const byObject = new Map<string, { layerId: string; parts: Float32Array[]; lines: boolean }>();
  for (const m of meshes) {
    let o = byObject.get(m.objectId);
    if (!o) byObject.set(m.objectId, (o = { layerId: m.layerId, parts: [], lines: false }));
    if (m.triangles.length) o.parts.push(m.triangles);
    if (m.edges.length) o.lines = true;
  }
  const solids: SolidCheck[] = [];
  const linesOnly: string[] = [];
  for (const [id, o] of byObject) {
    if (!o.parts.length) {
      if (o.lines) linesOnly.push(id);
      continue;
    }
    const all = new Float32Array(o.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of o.parts) {
      all.set(p, at);
      at += p.length;
    }
    solids.push({ id, layerId: o.layerId, closure: closureOf(all) });
  }
  const badness = (c: Closure): number => c.open * 4 + c.overlaps;
  solids.sort((p, q) => badness(q.closure) - badness(p.closure));
  return { solids, linesOnly };
}

/** In a sentence: how many of `solids` are closed (no holes), and what else was found. */
export function closureVerdict(solids: readonly SolidCheck[]): string {
  if (!solids.length) return "There are no solids to check.";
  const closed = solids.filter((s) => s.closure.open === 0).length;
  const open = solids.reduce((n, s) => n + s.closure.open, 0);
  const overlaps = solids.reduce((n, s) => n + s.closure.overlaps, 0);
  const holes = solids.reduce((n, s) => n + s.closure.holes.length, 0);
  const edges = solids.reduce((n, s) => n + s.closure.edges, 0);
  const found = [
    holes ? `${holes} hole${holes === 1 ? "" : "s"} (${open} of ${edges} edges have a face on one side only)` : "",
    overlaps ? `${overlaps} edges where three or more faces meet (parts of one object touching along a line, or overlapping faces)` : "",
  ].filter(Boolean);
  return `${closed} of ${solids.length} solid${solids.length === 1 ? " is" : "s are"} closed${found.length ? `; ${found.join("; ")}` : ""}.`;
}
