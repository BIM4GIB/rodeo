// Modify > Drafting Aids > Simplify Polys: fewer corner vertices in polygons (5), polylines (21)
// and 3D polygons (25), as Vectorworks' command takes them away.
//
// By maximum deviation, corner vertices go while the outline stays within the deviation of the
// one it had (0 takes collinear vertices only); by minimum distance, those at or within the
// distance of the vertex before or after them go (0 takes coincident ones only). A start and end
// vertex always stay, and so do a polyline's curve vertices (bezier, cubic, arc, through) and the
// corners either side of one, which shape its curve; a corner between a shown and a hidden edge
// stays, so each edge keeps its own. A textured 3D polygon keeps its second vertex too: its
// texture is laid along its first edge. What stays is copied as it was, byte for byte, each
// vertex's entry with it, and the boxes follow the vertices (every sample's box is its vertices').

import { setF64, setU16, setU64, u16, u32, f64 } from "./bytes.ts";
import { writeBBox } from "./encode.ts";
import { VERTEX_CODE } from "./geometry.ts";
import type { Rec } from "./records.ts";
import { textureDict } from "./texmap.ts";
import type { SimplifyBy } from "./types.ts";

const POLYGON = 5;
const POLYLINE = 21;
const POLY3D = 25;
/** the object types Simplify Polys works on */
export const SIMPLIFIABLE: ReadonlySet<number> = new Set([POLYGON, POLYLINE, POLY3D]);

/** a 2D polygon's or polyline's closed flag, vertex count and first vertex */
const CLOSED = 0x8d;
const COUNT = 0x8e;
const VERTS = 0x90;
/** a 3D polygon's vertex count and first vertex (24 bytes each: x, y, z), and its 3D box */
const POLY3D_COUNT = 0xd0;
const POLY3D_VERTS = 0xd2;
const POLY3D_BOX = 0x9c;
/** a polyline vertex word's edge bit: the edge to the next vertex is shown */
const EDGE_SHOWN = 0x80;

/** Lengths this close are the same (mm): collinear and coincident vertices go at 0. */
const EPS = 1e-6;

type Vec = readonly number[];

function dist(a: Vec, b: Vec): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) ** 2;
  return Math.sqrt(s);
}

/** The distance from `p` to the segment from `a` to `b`. */
function segmentDist(p: Vec, a: Vec, b: Vec): number {
  let ab2 = 0;
  let t = 0;
  for (let k = 0; k < a.length; k++) {
    ab2 += (b[k] - a[k]) ** 2;
    t += (p[k] - a[k]) * (b[k] - a[k]);
  }
  t = ab2 > 0 ? Math.max(0, Math.min(1, t / ab2)) : 0;
  let s = 0;
  for (let k = 0; k < a.length; k++) s += (p[k] - (a[k] + t * (b[k] - a[k]))) ** 2;
  return Math.sqrt(s);
}

/**
 * The vertices of an outline that stay, in order, or null when none would go or what would stay is
 * no outline (fewer than three of a closed one). `fixed` marks the vertices that must stay; the
 * start (and an open outline's end) always do.
 */
export function keptVertices(pts: readonly Vec[], closed: boolean, fixed: readonly boolean[], by: SimplifyBy, tolerance: number): number[] | null {
  const n = pts.length;
  if (n < (closed ? 4 : 3)) return null;
  const pinned = (i: number): boolean => i === 0 || (!closed && i === n - 1) || fixed[i];
  const keep = by === "deviation" ? byDeviation(pts, closed, pinned, tolerance) : byDistance(pts, closed, pinned, tolerance);
  if (keep.length === n || keep.length < (closed ? 3 : 2)) return null;
  return keep;
}

/** Douglas–Peucker between the vertices that must stay: a vertex stays when the outline would pass farther than `tolerance` from it. */
function byDeviation(pts: readonly Vec[], closed: boolean, pinned: (i: number) => boolean, tolerance: number): number[] {
  const n = pts.length;
  const keep = new Set<number>();
  for (let i = 0; i < n; i++) if (pinned(i)) keep.add(i);
  // a closed outline held at its start alone is split at the vertex farthest from it
  if (closed && keep.size === 1) {
    let far = 0;
    for (let i = 1; i < n; i++) if (dist(pts[i], pts[0]) > dist(pts[far], pts[0])) far = i;
    if (far > 0) keep.add(far);
  }
  const anchors = [...keep].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let k = 0; k + 1 < anchors.length; k++) runs.push([anchors[k], anchors[k + 1]]);
  if (closed) runs.push([anchors[anchors.length - 1], anchors[0] + n]);
  const at = (i: number): Vec => pts[i % n];
  while (runs.length) {
    const [a, b] = runs.pop()!;
    let worst = -1;
    let far = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDist(at(i), at(a), at(b));
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst < 0 || far <= tolerance + EPS) continue;
    keep.add(worst % n);
    runs.push([a, worst], [worst, b]);
  }
  return [...keep].sort((a, b) => a - b);
}

/** A vertex goes when it lies at or within `tolerance` of the vertex kept before it or after it. */
function byDistance(pts: readonly Vec[], closed: boolean, pinned: (i: number) => boolean, tolerance: number): number[] {
  const n = pts.length;
  const kept = [0];
  for (let i = 1; i < n; i++) if (pinned(i) || dist(pts[i], pts[kept[kept.length - 1]]) > tolerance + EPS) kept.push(i);
  // one left near the vertex after it (the end's included; a closed outline's last wraps to its start)
  for (let k = kept.length - 1; k >= 1; k--) {
    const i = kept[k];
    if (pinned(i)) continue;
    const next = k + 1 < kept.length ? kept[k + 1] : closed ? 0 : -1;
    if (next >= 0 && dist(pts[i], pts[next]) <= tolerance + EPS) kept.splice(k, 1);
  }
  return kept;
}

/**
 * The record of a polygon, polyline or 3D polygon `r` simplified, and how many vertices went; null
 * when none would go.
 */
export function simplifiedRecord(r: Rec, by: SimplifyBy, tolerance: number): { data: Uint8Array; removed: number } | null {
  const d = r.data;
  const three = r.type === POLY3D;
  const stride = three ? 24 : r.type === POLYLINE ? 36 : 16;
  const at = three ? POLY3D_VERTS : VERTS;
  if (!SIMPLIFIABLE.has(r.type) || d.length < at) return null;
  const n = u16(d, three ? POLY3D_COUNT : COUNT);
  if (at + stride * n > d.length) return null;
  const closed = d[CLOSED] === 1;
  const off = (i: number): number => at + stride * i;
  // a 2D vertex is stored y then x; a 3D one x, y, z
  const pts: Vec[] = Array.from({ length: n }, (_, i) =>
    three ? [f64(d, off(i)), f64(d, off(i) + 8), f64(d, off(i) + 16)] : [f64(d, off(i) + 8), f64(d, off(i))],
  );
  const fixed: boolean[] = new Array(n).fill(false);
  if (r.type === POLYLINE) {
    const word = (i: number): number => u32(d, off(i) + 16);
    const curve = (i: number): boolean => ((word(i) >>> 8) & 0xff) !== VERTEX_CODE.corner;
    const shown = (i: number): number => word(i) & EDGE_SHOWN;
    const before = (i: number): number => (closed ? (i - 1 + n) % n : i - 1);
    const after = (i: number): number => (closed ? (i + 1) % n : i + 1 < n ? i + 1 : -1);
    for (let i = 0; i < n; i++) {
      const b = before(i);
      const a = after(i);
      fixed[i] = curve(i) || (b >= 0 && curve(b)) || (a >= 0 && curve(a)) || (b >= 0 && a >= 0 && shown(b) !== shown(i));
    }
  }
  if (three && textureDict(r)) fixed[1] = true;
  const keep = keptVertices(pts, closed, fixed, by, tolerance);
  if (!keep) return null;
  const out = new Uint8Array(at + stride * keep.length);
  out.set(d.subarray(0, at));
  setU64(out, 0, BigInt(out.length));
  setU16(out, three ? POLY3D_COUNT : COUNT, keep.length);
  keep.forEach((i, k) => out.set(d.subarray(off(i), off(i) + stride), at + stride * k));
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const i of keep) {
    pts[i].forEach((v, k) => {
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    });
  }
  writeBBox(out, { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] });
  if (three) [...hi, ...lo].forEach((v, k) => setF64(out, POLY3D_BOX + 8 * k, v));
  return { data: out, removed: n - keep.length };
}
