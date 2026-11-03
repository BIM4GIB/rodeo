// Tracing a black-and-white bitmap into vector paths, for Modify > Trace Bitmap. A mask holds one
// byte per pixel, rows from the top, 1 where the pixel is ink. Outlines follow the cracks between
// ink and paper round each patch of ink (patches touching only at a corner stay apart) and give
// each patch its outer ring and its holes. Centrelines thin the ink to one-pixel lines first and
// follow those, for line work such as a scanned drawing. Points are in pixels, y down, on pixel
// corners (outlines) or pixel centres (centrelines), simplified to within a tolerance.

import type { Pt } from "../core/index.ts";

export interface Mask {
  readonly width: number;
  readonly height: number;
  /** width × height bytes, row by row from the top: 1 ink, 0 paper */
  readonly ink: Uint8Array;
}

/** A patch of ink: its outer ring and the rings of its holes, each closed (no repeated end point). */
export interface Patch {
  readonly outer: Pt[];
  readonly holes: Pt[][];
}

// crack directions, turning clockwise on screen: right, down, left, up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Twice the signed area of a ring; positive when it runs clockwise on screen (y down). */
function area2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return a;
}

function inside(p: Pt, ring: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Distance from p to the segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Douglas–Peucker: the points of an open path that keep it within `tol` of the original. */
export function simplifyPath(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length <= 2 || !(tol > 0)) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1;
    let worst = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > worst) {
        worst = d;
        far = k;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([i, far], [far, j]);
  }
  return pts.filter((_, k) => keep[k]);
}

/** A closed ring simplified: split at its first point and the point farthest from it. */
export function simplifyRing(ring: readonly Pt[], tol: number): Pt[] {
  if (ring.length <= 4 || !(tol > 0)) return ring.slice();
  let far = 0;
  let best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k].x - ring[0].x, ring[k].y - ring[0].y);
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const a = simplifyPath(ring.slice(0, far + 1), tol);
  const b = simplifyPath([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/**
 * The cracks round the ink, chained into rings: each runs with the ink on its right on screen,
 * so outer rings run clockwise and holes anticlockwise. Only the corners of each ring are kept.
 */
function rings(m: Mask): Pt[][] {
  const { width: w, height: h, ink } = m;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1;
  const stride = w + 1;
  // each pixel corner starts at most two cracks (two where ink touches ink only at that corner)
  const first = new Int8Array(stride * (h + 1)).fill(-1);
  const second = new Int8Array(stride * (h + 1)).fill(-1);
  const start = (x: number, y: number, dir: number): void => {
    const v = y * stride + x;
    if (first[v] < 0) first[v] = dir;
    else second[v] = dir;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) start(x, y, 0);
      if (!at(x + 1, y)) start(x + 1, y, 1);
      if (!at(x, y + 1)) start(x + 1, y + 1, 2);
      if (!at(x - 1, y)) start(x, y + 1, 3);
    }
  }
  const out: Pt[][] = [];
  for (let v0 = 0; v0 < first.length; v0++) {
    while (first[v0] >= 0) {
      const ring: Pt[] = [];
      let v = v0;
      let dir = -1;
      for (;;) {
        // take the crack that turns right (keeping ink touching at a corner apart), else the only one
        let next: number;
        if (second[v] >= 0 && dir >= 0 && second[v] === (dir + 1) % 4) {
          next = second[v];
          second[v] = -1;
        } else if (first[v] >= 0) {
          next = first[v];
          first[v] = second[v];
          second[v] = -1;
        } else break;
        if (next !== dir) ring.push({ x: v % stride, y: Math.floor(v / stride) });
        dir = next;
        v += DY[dir] * stride + DX[dir];
      }
      if (ring.length >= 3) out.push(ring);
    }
  }
  return out;
}

/**
 * The patches of ink, outer rings with their holes, simplified to within `tol` pixels. Rings
 * enclosing less than `minArea` square pixels are left out.
 */
export function traceOutlines(m: Mask, tol: number, minArea: number): Patch[] {
  const outers: { ring: Pt[]; area: number; box: [number, number, number, number]; holes: Pt[][] }[] = [];
  const holes: Pt[][] = [];
  for (const ring of rings(m)) {
    const a = area2(ring) / 2;
    if (Math.abs(a) < minArea) continue;
    if (a > 0) {
      const xs = ring.map((p) => p.x);
      const ys = ring.map((p) => p.y);
      outers.push({ ring, area: a, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], holes: [] });
    } else holes.push(ring);
  }
  // a hole belongs to the smallest patch holding the ink just beside its first crack
  for (const hole of holes) {
    const a = hole[0];
    const b = hole[1];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    // the ink is on the right of travel on screen: (dx, dy) turned clockwise is (-dy, dx)
    const p = { x: a.x + dx * 0.5 - dy * 0.25, y: a.y + dy * 0.5 + dx * 0.25 };
    let owner: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if (p.x < o.box[0] || p.x > o.box[2] || p.y < o.box[1] || p.y > o.box[3]) continue;
      if ((!owner || o.area < owner.area) && inside(p, o.ring)) owner = o;
    }
    owner?.holes.push(hole);
  }
  return outers.map((o) => ({ outer: simplifyRing(o.ring, tol), holes: o.holes.map((r) => simplifyRing(r, tol)) }));
}

/** Zhang–Suen thinning: the ink worn down to lines one pixel wide, in place. */
function thin(m: Mask): Uint8Array {
  const { width: w, height: h } = m;
  const px = m.ink.slice();
  const p = (x: number, y: number): number => (x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : 0);
  const gone: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (const pass of [0, 1]) {
      gone.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!px[y * w + x]) continue;
          // the eight neighbours clockwise from the one above
          const n = [p(x, y - 1), p(x + 1, y - 1), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1), p(x - 1, y + 1), p(x - 1, y), p(x - 1, y - 1)];
          const count = n[0] + n[1] + n[2] + n[3] + n[4] + n[5] + n[6] + n[7];
          if (count < 2 || count > 6) continue;
          let rises = 0;
          for (let k = 0; k < 8; k++) if (!n[k] && n[(k + 1) % 8]) rises++;
          if (rises !== 1) continue;
          if (pass === 0 ? n[0] * n[2] * n[4] || n[2] * n[4] * n[6] : n[0] * n[2] * n[6] || n[0] * n[4] * n[6]) continue;
          gone.push(y * w + x);
        }
      }
      for (const i of gone) px[i] = 0;
      if (gone.length) changed = true;
    }
  }
  return px;
}

/**
 * The ink as centrelines: open paths through the middles of its strokes, from end to end or
 * junction to junction, and closed loops; simplified to within `tol` pixels. Paths shorter than
 * `minLength` pixels are left out.
 */
export function traceCentrelines(m: Mask, tol: number, minLength: number): { points: Pt[]; closed: boolean }[] {
  const { width: w, height: h } = m;
  const px = thin(m);
  const NX = [0, 1, 1, 1, 0, -1, -1, -1];
  const NY = [-1, -1, 0, 1, 1, 1, 0, -1];
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && px[y * w + x] === 1;
  // a diagonal step counts only where no pixel beside both ends links them already, so a
  // staircase reads as one line rather than a chain of little triangles
  const neighbours = (i: number): number[] => {
    const x = i % w;
    const y = (i - x) / w;
    const out: number[] = [];
    for (let k = 0; k < 8; k++) {
      if (!on(x + NX[k], y + NY[k])) continue;
      if (k % 2 === 1 && (on(x + NX[k - 1], y + NY[k - 1]) || on(x + NX[(k + 1) % 8], y + NY[(k + 1) % 8]))) continue;
      out.push((y + NY[k]) * w + x + NX[k]);
    }
    return out;
  };
  // a step is walked once, from either end
  const walked = new Set<number>();
  const key = (a: number, b: number): number => (a < b ? a * w * h + b : b * w * h + a);
  const centre = (i: number): Pt => ({ x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5 });
  const out: { points: Pt[]; closed: boolean }[] = [];
  const walk = (from: number, to: number): void => {
    const path = [from];
    walked.add(key(from, to));
    let prev = from;
    let cur = to;
    for (;;) {
      path.push(cur);
      const next = neighbours(cur);
      if (next.length !== 2 || cur === from) break;
      const ahead = next[0] === prev ? next[1] : next[0];
      if (walked.has(key(cur, ahead))) break;
      walked.add(key(cur, ahead));
      prev = cur;
      cur = ahead;
    }
    const closed = path.length > 3 && path[path.length - 1] === path[0];
    const pts = (closed ? path.slice(0, -1) : path).map(centre);
    let length = 0;
    for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    if (length < minLength) return;
    out.push(closed ? { points: simplifyRing(pts, tol), closed } : { points: simplifyPath(pts, tol), closed });
  };
  // paths run between ends and junctions; what is left over is loops
  const nodes: number[] = [];
  for (let i = 0; i < px.length; i++) if (px[i] && neighbours(i).length !== 2) nodes.push(i);
  for (const n of nodes) for (const next of neighbours(n)) if (!walked.has(key(n, next))) walk(n, next);
  for (let i = 0; i < px.length; i++) {
    if (!px[i]) continue;
    for (const next of neighbours(i)) if (!walked.has(key(i, next))) walk(i, next);
  }
  return out;
}
