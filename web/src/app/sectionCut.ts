// What a section viewport draws (View > Create Section Viewport, sectionViewport.ts): the 3D model cut
// by an upright plane standing on a line on plan, looked at square to it from the line's left or right
// (or, for a horizontal section, by a level plane looked down on: sectionView takes any plane).
// What the plane cuts is filled: each object's faces crossing the plane chained into outlines, an
// outline inside another a hole in it. Beyond the plane, the edges the 3D view draws and the outlines
// curved surfaces show against what's behind them are drawn where nothing nearer hides them; that is
// Vectorworks' hidden-line section worked out as lines, not pixels. Nothing in front of the plane is
// drawn, and only what lies across the line's length (and between the heights given). Faces on the
// plane are neither cut nor drawn, so what only touches it, from either side, isn't cut. Pure, so its
// Node check runs it.

import earcut from "earcut";
import type { BBox, Pt } from "../core/index.ts";

/** One piece of an object's 3D faces, as Mesh3D has them. */
export interface CutMesh {
  /** the object the piece belongs to: its cut and lines come out together */
  readonly id: string;
  /** 9 floats a triangle, wound either way */
  readonly triangles: Float32Array;
  /** 6 floats a segment: the edges the 3D view draws */
  readonly edges: Float32Array;
  readonly color: string;
}

export interface SectionPlane {
  /** the line on plan the plane stands on, as drawn */
  readonly a: Pt;
  readonly b: Pt;
  /** which side of the line, as drawn, the view looks to */
  readonly look: "left" | "right";
  /** how far beyond the plane to draw: Infinity for all of it, 0 for the cut alone */
  readonly depth: number;
  /** the heights the view is cut to, when it is */
  readonly bottom?: number;
  readonly top?: number;
}

/** An object's cut and lines, in the section's frame: x across the view left to right, y up (the model's z). */
export interface SectionPiece {
  readonly id: string;
  /** each cut outline, the holes in it, and the colour of the faces cut */
  readonly cuts: { readonly outer: Pt[]; readonly holes: Pt[][]; readonly color: string }[];
  /** cut lines that don't close round (an open surface's) */
  readonly cutLines: Pt[][];
  /** its edges seen beyond the plane */
  readonly lines: Pt[][];
}

export interface SectionDrawing {
  readonly pieces: SectionPiece[];
  readonly box: BBox | null;
}

/** faces meeting at more than 25° make a crease that's drawn: the cosine */
const CREASE = Math.cos((25 * Math.PI) / 180);

/** a point in the view: across, up, and how far beyond the plane */
type V = readonly [number, number, number];

/** Twice the signed area of a ring. */
function area2(ring: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return s;
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

/** A ring cut to a box (its sides may be infinite). */
function clipRing(ring: readonly Pt[], box: BBox): Pt[] {
  const half = (pts: readonly Pt[], keep: (p: Pt) => number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const fp = keep(p);
      const fq = keep(q);
      if (fp >= 0) out.push(p);
      if (fp >= 0 !== fq >= 0) {
        const t = fp / (fp - fq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
    return out;
  };
  let out = [...ring];
  if (Number.isFinite(box.x0)) out = half(out, (p) => p.x - box.x0);
  if (Number.isFinite(box.x1)) out = half(out, (p) => box.x1 - p.x);
  if (Number.isFinite(box.y0)) out = half(out, (p) => p.y - box.y0);
  if (Number.isFinite(box.y1)) out = half(out, (p) => box.y1 - p.y);
  return out;
}

/** Where along p→q (0..1) lies within the box, or null. */
function within(p: Pt, q: Pt, box: BBox): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (const [fp, fq] of [
    [p.x - box.x0, q.x - box.x0],
    [box.x1 - p.x, box.x1 - q.x],
    [p.y - box.y0, q.y - box.y0],
    [box.y1 - p.y, box.y1 - q.y],
  ]) {
    if (fp < 0 && fq < 0) return null;
    if (fp < 0) t0 = Math.max(t0, fp / (fp - fq));
    else if (fq < 0) t1 = Math.min(t1, fp / (fp - fq));
  }
  return t1 > t0 ? [t0, t1] : null;
}

/** A line's pieces within a box. */
function clipLine(line: readonly Pt[], box: BBox): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const at = (p: Pt, q: Pt, t: number): Pt => (t === 0 ? p : t === 1 ? q : { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i];
    const q = line[i + 1];
    const s = within(p, q, box);
    if (!s) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    if (s[0] > 0 || !cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [at(p, q, s[0])];
    }
    cur.push(at(p, q, s[1]));
    if (s[1] < 1) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Points along a line or ring with those on a straight run between their neighbours (or doubled) left out. */
function straighten(pts: readonly Pt[], closed: boolean, tol: number): Pt[] {
  let out = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > tol);
  if (closed && out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= tol) out.pop();
  for (let changed = true; changed && out.length > 2; ) {
    changed = false;
    const keep: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const end = !closed && (i === 0 || i === out.length - 1);
      const p = out[(i - 1 + out.length) % out.length];
      const q = out[i];
      const r = out[(i + 1) % out.length];
      const len = Math.hypot(r.x - p.x, r.y - p.y);
      const off = len > 0 ? Math.abs((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / len : 0;
      const between = (q.x - p.x) * (r.x - p.x) + (q.y - p.y) * (r.y - p.y) >= 0 && (q.x - r.x) * (p.x - r.x) + (q.y - r.y) * (p.y - r.y) >= 0;
      if (!end && len > 0 && off <= tol && between && keep.length + (out.length - i) > (closed ? 3 : 2)) {
        changed = true;
        continue;
      }
      keep.push(q);
    }
    out = keep;
  }
  return out;
}

/**
 * Chains segments meeting end to end (each a pair of end keys, `at` a key's point) into lines,
 * each closed one a ring.
 */
function chain(segs: readonly (readonly [string, string])[], at: ReadonlyMap<string, Pt>): { keys: string[]; pts: Pt[]; closed: boolean }[] {
  const by = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    if (a === b) return;
    by.set(a, [...(by.get(a) ?? []), i]);
    by.set(b, [...(by.get(b) ?? []), i]);
  });
  const used = new Uint8Array(segs.length);
  const out: { keys: string[]; pts: Pt[]; closed: boolean }[] = [];
  const walk = (start: string): void => {
    const keys = [start];
    let k = start;
    for (;;) {
      const next = (by.get(k) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next];
      k = a === k ? b : a;
      keys.push(k);
      if (k === start) break;
    }
    if (keys.length < 2) return;
    const closed = keys.length > 2 && keys[keys.length - 1] === start;
    const ring = closed ? keys.slice(0, -1) : keys;
    out.push({ keys: ring, pts: ring.map((key) => at.get(key)!), closed });
  };
  // open runs from their ends first, then what's left goes round
  for (const [k, list] of by) if (list.length % 2 === 1 && list.some((i) => !used[i])) walk(k);
  for (const [k, list] of by) while (list.some((i) => !used[i])) walk(k);
  return out;
}

/** The section the plane makes of the meshes. */
export function sectionDrawing(meshes: readonly CutMesh[], plane: SectionPlane): SectionDrawing {
  const ux = plane.b.x - plane.a.x;
  const uy = plane.b.y - plane.a.y;
  const length = Math.hypot(ux, uy);
  if (!(length > 0)) return { pieces: [], box: null };
  // looking to the line's left it runs left to right across the view; to its right, right to left
  const nx = plane.look === "left" ? -uy / length : uy / length;
  const ny = plane.look === "left" ? ux / length : -ux / length;
  return sectionView(meshes, {
    origin: [plane.a.x, plane.a.y, 0],
    right: [ny, -nx, 0],
    up: [0, 0, 1],
    toward: [nx, ny, 0],
    depth: plane.depth,
    across: { x0: plane.look === "left" ? 0 : -length, x1: plane.look === "left" ? length : 0, y0: plane.bottom ?? -Infinity, y1: plane.top ?? Infinity },
  });
}

/** A cut plane in any direction and the view square to it: what Create Horizontal Section Viewport looks down with. */
export interface SectionFrame {
  /** a point on the plane, and the view's unit axes: across it, up it, and away from the viewer through the plane */
  readonly origin: V;
  readonly right: V;
  readonly up: V;
  readonly toward: V;
  /** how far beyond the plane to draw: Infinity for all of it, 0 for the cut alone */
  readonly depth: number;
  /** what's drawn, in the view's across and up (sides may be infinite) */
  readonly across: BBox;
}

/** The section a plane makes of the meshes, in the view's own across and up. */
export function sectionView(meshes: readonly CutMesh[], frame: SectionFrame): SectionDrawing {
  const { x0, y0, x1, y1 } = frame.across;
  const far = Math.max(0, frame.depth);
  const [ox, oy, oz] = frame.origin;
  const [rx, ry, rz] = frame.right;
  const [vx, vy, vz] = frame.up;
  const [nx, ny, nz] = frame.toward;
  const view = (f: Float32Array, i: number): V => {
    const dx = f[i] - ox;
    const dy = f[i + 1] - oy;
    const dz = f[i + 2] - oz;
    return [dx * rx + dy * ry + dz * rz, dx * vx + dy * vy + dz * vz, dx * nx + dy * ny + dz * nz];
  };

  // how near counts as the same: the model's size in float precision, or a twentieth of a millimetre
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of meshes)
    for (let i = 0; i < m.triangles.length; i++) {
      lo = Math.min(lo, m.triangles[i]);
      hi = Math.max(hi, m.triangles[i]);
    }
  const size = Number.isFinite(lo) ? Math.max(hi - lo, Math.abs(hi), Math.abs(lo)) : 0;
  const tol = Math.max(0.05, size * 2e-6);
  // what's drawn: the line's length and the heights given
  const exact: BBox = { x0, y0, x1, y1 };
  const snap = (v: number, lo: number, hi: number): number => (v < lo && v >= lo - tol ? lo : v > hi && v <= hi + tol ? hi : v);
  const q = (v: number): number => Math.round(v / (tol / 4));
  const keyOf = (p: V): string => `${q(p[0])},${q(p[1])},${q(p[2])}`;

  const byObject = new Map<string, CutMesh[]>();
  for (const m of meshes) byObject.set(m.id, [...(byObject.get(m.id) ?? []), m]);

  // what can hide things: the faces beyond the plane, 9 numbers a triangle (x, y, depth at each corner)
  const occ: number[] = [];
  const addOcc = (a: V, b: V, c: V): void => {
    occ.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  const clipDepth = (poly: V[], keep: (p: V) => number): V[] => {
    const out: V[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const r = poly[(i + 1) % poly.length];
      const fp = keep(p);
      const fr = keep(r);
      if (fp >= 0) out.push(p);
      if (fp >= 0 !== fr >= 0) {
        const t = fp / (fp - fr);
        out.push([p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t, p[2] + (r[2] - p[2]) * t]);
      }
    }
    return out;
  };

  interface Work {
    id: string;
    piece: SectionPiece;
    /** edges to draw where they're seen */
    edges: [V, V][];
  }
  const work: Work[] = [];

  for (const [id, parts] of byObject) {
    const cutSegs: [string, string][] = [];
    const onPlane = new Map<string, { a: string; b: string; pa: Pt; pb: Pt; sides: number; color: string }>();
    const cutAt = new Map<string, Pt>();
    const cutColor = new Map<string, string>();
    /** each edge between corners: the far corner and the facing of each face on it */
    const sides = new Map<string, { a: V; b: V; c: V[]; n: V[] }>();
    const edges: [V, V][] = [];
    const seen = new Set<string>();
    const addEdge = (a: V, b: V): void => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka === kb) return;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(k)) return;
      seen.add(k);
      edges.push([a, b]);
    };

    for (const m of parts) {
      const t = m.triangles;
      for (let i = 0; i + 8 < t.length; i += 9) {
        const v: V[] = [view(t, i), view(t, i + 3), view(t, i + 6)];
        // each corner beyond the plane (1), in front of it (-1) or on it (0)
        const side = v.map((p) => (p[2] > tol ? 1 : p[2] < -tol ? -1 : 0));
        const on = side.filter((s) => s === 0).length;
        const crosses = side.includes(1) && side.includes(-1);
        // wholly on or in front of the plane, or past as far as the view goes: neither cut nor seen
        const seen = side.includes(1) && Math.min(v[0][2], v[1][2], v[2][2]) <= far;
        if (!crosses && !seen && on !== 2) continue;
        const keys = v.map(keyOf);
        if (crosses) {
          // the plane's cut: where the triangle's edges cross from in front of it to beyond, or a corner on it
          const ends: string[] = [];
          for (let k = 0; k < 3; k++) {
            const j = (k + 1) % 3;
            if (side[k] === 0) {
              const vk = `v${keys[k]}`;
              if (!cutAt.has(vk)) cutAt.set(vk, { x: v[k][0], y: v[k][1] });
              ends.push(vk);
            } else if (side[k] * side[j] === -1) {
              const ek = keys[k] < keys[j] ? `${keys[k]}|${keys[j]}` : `${keys[j]}|${keys[k]}`;
              if (!cutAt.has(ek)) {
                const s = v[k][2] / (v[k][2] - v[j][2]);
                cutAt.set(ek, { x: v[k][0] + (v[j][0] - v[k][0]) * s, y: v[k][1] + (v[j][1] - v[k][1]) * s });
              }
              ends.push(ek);
            }
          }
          cutSegs.push([ends[0], ends[1]]);
          for (const ek of ends) cutColor.set(ek, m.color);
        } else if (on === 2 && !side.every((s) => s === 0)) {
          // an edge on the plane is cut where faces either side of it lie in front and beyond (touching isn't cutting)
          const k = side.findIndex((s) => s !== 0);
          const [p0, p1] = [(k + 1) % 3, (k + 2) % 3];
          const ek = keys[p0] < keys[p1] ? `${keys[p0]}|${keys[p1]}` : `${keys[p1]}|${keys[p0]}`;
          const e = onPlane.get(ek);
          if (e) e.sides |= side[k] > 0 ? 2 : 1;
          else onPlane.set(ek, { a: `v${keys[p0]}`, b: `v${keys[p1]}`, pa: { x: v[p0][0], y: v[p0][1] }, pb: { x: v[p1][0], y: v[p1][1] }, sides: side[k] > 0 ? 2 : 1, color: m.color });
        }
        if (!seen) continue;
        // off the line's length it's only cut, and the cut clipped
        if (Math.max(v[0][0], v[1][0], v[2][0]) < x0 - tol || Math.min(v[0][0], v[1][0], v[2][0]) > x1 + tol) continue;
        if (Math.max(v[0][1], v[1][1], v[2][1]) < y0 - tol || Math.min(v[0][1], v[1][1], v[2][1]) > y1 + tol) continue;
        // its edges, for creases and the outlines curved surfaces show
        const ux1 = v[1][0] - v[0][0];
        const uy1 = v[1][1] - v[0][1];
        const ud1 = v[1][2] - v[0][2];
        const ux2 = v[2][0] - v[0][0];
        const uy2 = v[2][1] - v[0][1];
        const ud2 = v[2][2] - v[0][2];
        const cn: V = [uy1 * ud2 - ud1 * uy2, ud1 * ux2 - ux1 * ud2, ux1 * uy2 - uy1 * ux2];
        const nl = Math.hypot(cn[0], cn[1], cn[2]);
        const facing: V = nl > 0 ? [cn[0] / nl, cn[1] / nl, cn[2] / nl] : [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const j = (k + 1) % 3;
          if (keys[k] === keys[j]) continue;
          const ek = keys[k] < keys[j] ? `${keys[k]}|${keys[j]}` : `${keys[j]}|${keys[k]}`;
          const s = sides.get(ek);
          if (s) {
            s.c.push(v[3 - k - j]);
            s.n.push(facing);
          } else sides.set(ek, { a: v[k], b: v[j], c: [v[3 - k - j]], n: [facing] });
        }
        // what it hides: its part beyond the plane, as far as the view goes
        let poly = clipDepth(v, (p) => p[2] - tol);
        if (Number.isFinite(far) && poly.length) poly = clipDepth(poly, (p) => far - p[2]);
        for (let k = 1; k + 1 < poly.length; k++) addOcc(poly[0], poly[k], poly[k + 1]);
      }
      const e = m.edges;
      for (let i = 0; i + 5 < e.length; i += 6) addEdge(view(e, i), view(e, i + 3));
    }
    for (const s of sides.values()) {
      // an open surface's border, and a crease the faces meet at more than CREASE
      if (s.c.length === 1) {
        addEdge(s.a, s.b);
        continue;
      }
      if (s.c.length !== 2) continue;
      const [m1, m2] = s.n;
      if (Math.abs(m1[0] * m2[0] + m1[1] * m2[1] + m1[2] * m2[2]) < CREASE) {
        addEdge(s.a, s.b);
        continue;
      }
      // a curved surface's outline: an edge whose two faces lie on the same side of it as seen
      const ex = s.b[0] - s.a[0];
      const ey = s.b[1] - s.a[1];
      const el = Math.hypot(ex, ey);
      if (!(el > tol)) continue;
      const side = (c: V): number => (ex * (c[1] - s.a[1]) - ey * (c[0] - s.a[0])) / el;
      const s1 = side(s.c[0]);
      const s2 = side(s.c[1]);
      if (Math.abs(s1) > tol * 1e-2 && Math.abs(s2) > tol * 1e-2 && s1 > 0 === s2 > 0) addEdge(s.a, s.b);
    }

    // the cut's outlines, each with the holes inside it, across the line's length
    const rings: Pt[][] = [];
    const cutLines: Pt[][] = [];
    // each ring the colour of the faces its first crossing was cut from
    const colorOf = new Map<Pt[], string>();
    for (const e of onPlane.values())
      if (e.sides === 3) {
        if (!cutAt.has(e.a)) cutAt.set(e.a, e.pa);
        if (!cutAt.has(e.b)) cutAt.set(e.b, e.pb);
        cutSegs.push([e.a, e.b]);
        cutColor.set(e.a, e.color);
      }
    for (const c of chain(cutSegs, cutAt)) {
      if (c.closed) {
        const ring = straighten(c.pts, true, tol);
        if (ring.length >= 3 && Math.abs(area2(ring)) > tol * tol) {
          rings.push(ring);
          colorOf.set(ring, cutColor.get(c.keys[0]) ?? parts[0].color);
        }
      } else {
        for (const l of clipLine(straighten(c.pts, false, tol), exact)) if (l.length > 1) cutLines.push(l);
      }
    }
    const depthIn = rings.map((r, i) => rings.filter((o, j) => j !== i && Math.abs(area2(o)) > Math.abs(area2(r)) && inside(r[0], o)).length);
    const cuts: { outer: Pt[]; holes: Pt[][]; color: string }[] = [];
    rings.forEach((r, i) => {
      if (depthIn[i] % 2 === 1) return;
      const outer = clipRing(area2(r) < 0 ? [...r].reverse() : r, exact);
      if (outer.length < 3 || !(Math.abs(area2(outer)) > tol * tol)) return;
      const holes = rings
        .filter((h, j) => depthIn[j] === depthIn[i] + 1 && Math.abs(area2(h)) < Math.abs(area2(r)) && inside(h[0], r))
        .map((h) => clipRing(area2(h) > 0 ? [...h].reverse() : h, exact))
        .filter((h) => h.length >= 3 && Math.abs(area2(h)) > tol * tol);
      cuts.push({ outer, holes, color: colorOf.get(r) ?? parts[0].color });
    });
    // the cut hides what's beyond it
    for (const c of cuts) {
      const flat: number[] = [];
      const holeAt: number[] = [];
      for (const p of c.outer) flat.push(p.x, p.y);
      for (const h of c.holes) {
        holeAt.push(flat.length / 2);
        for (const p of h) flat.push(p.x, p.y);
      }
      const tri = earcut(flat, holeAt);
      for (let k = 0; k + 2 < tri.length; k += 3) addOcc([flat[tri[k] * 2], flat[tri[k] * 2 + 1], 0], [flat[tri[k + 1] * 2], flat[tri[k + 1] * 2 + 1], 0], [flat[tri[k + 2] * 2], flat[tri[k + 2] * 2 + 1], 0]);
    }
    work.push({ id, piece: { id, cuts, cutLines, lines: [] }, edges });
  }

  // the faces that hide, in a grid over the view so each edge tries only those near it
  const n = occ.length / 9;
  const tri = new Float64Array(occ);
  const plane3 = new Float64Array(n * 3);
  const minD = new Float64Array(n);
  const usable = new Uint8Array(n);
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const o = k * 9;
    const [ax, ay, ad, bx, by, bd, cx, cy, cd] = [tri[o], tri[o + 1], tri[o + 2], tri[o + 3], tri[o + 4], tri[o + 5], tri[o + 6], tri[o + 7], tri[o + 8]];
    const e1x = bx - ax;
    const e1y = by - ay;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const s = e1x * e2y - e1y * e2x;
    const longest = Math.max(Math.hypot(e1x, e1y), Math.hypot(e2x, e2y), Math.hypot(cx - bx, cy - by));
    // seen edge on it hides nothing
    if (!(Math.abs(s) > tol * longest)) continue;
    usable[k] = 1;
    const al = ((bd - ad) * e2y - (cd - ad) * e1y) / s;
    const be = (e1x * (cd - ad) - e2x * (bd - ad)) / s;
    plane3[k * 3] = al;
    plane3[k * 3 + 1] = be;
    plane3[k * 3 + 2] = ad - al * ax - be * ay;
    minD[k] = Math.min(ad, bd, cd);
    gx0 = Math.min(gx0, ax, bx, cx);
    gx1 = Math.max(gx1, ax, bx, cx);
    gy0 = Math.min(gy0, ay, by, cy);
    gy1 = Math.max(gy1, ay, by, cy);
  }
  const cells = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n / 2))));
  const cw = (gx1 - gx0) / cells || 1;
  const ch = (gy1 - gy0) / cells || 1;
  const col = (x: number): number => Math.max(0, Math.min(cells - 1, Math.floor((x - gx0) / cw)));
  const row = (y: number): number => Math.max(0, Math.min(cells - 1, Math.floor((y - gy0) / ch)));
  const count = new Int32Array(cells * cells + 1);
  const span = (k: number): [number, number, number, number] => {
    const o = k * 9;
    return [col(Math.min(tri[o], tri[o + 3], tri[o + 6])), col(Math.max(tri[o], tri[o + 3], tri[o + 6])), row(Math.min(tri[o + 1], tri[o + 4], tri[o + 7])), row(Math.max(tri[o + 1], tri[o + 4], tri[o + 7]))];
  };
  for (let k = 0; k < n; k++) {
    if (!usable[k]) continue;
    const [c0, c1, r0, r1] = span(k);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * cells + c + 1]++;
  }
  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  const fill = count.slice(0, cells * cells);
  const list = new Int32Array(count[cells * cells]);
  for (let k = 0; k < n; k++) {
    if (!usable[k]) continue;
    const [c0, c1, r0, r1] = span(k);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list[fill[r * cells + c]++] = k;
  }
  // nearest first in each cell, so an edge hidden whole is found so soon
  for (let c = 0; c < cells * cells; c++) list.subarray(count[c], count[c + 1]).sort((a, b) => minD[a] - minD[b]);
  const stamp = new Int32Array(n).fill(-1);
  let pass = 0;

  /** Where along p→q (0..1) triangle k hides it, or null. */
  const hiddenBy = (k: number, p: V, r: V): [number, number] | null => {
    const o = k * 9;
    const s = (tri[o + 3] - tri[o]) * (tri[o + 7] - tri[o + 1]) - (tri[o + 4] - tri[o + 1]) * (tri[o + 6] - tri[o]) > 0 ? 1 : -1;
    let t0 = 0;
    let t1 = 1;
    for (let e = 0; e < 3; e++) {
      const ax = tri[o + e * 3];
      const ay = tri[o + e * 3 + 1];
      const f = ((e + 1) % 3) * 3;
      const ex = tri[o + f] - ax;
      const ey = tri[o + f + 1] - ay;
      // within tol of it counts, so no crack shows between faces side by side; an edge along its side
      // is as far as the face there, which the depth's tolerance leaves seen
      const margin = tol * Math.hypot(ex, ey);
      const f0 = s * (ex * (p[1] - ay) - ey * (p[0] - ax)) + margin;
      const f1 = s * (ex * (r[1] - ay) - ey * (r[0] - ax)) + margin;
      if (f0 <= 0 && f1 <= 0) return null;
      if (f0 < 0) t0 = Math.max(t0, f0 / (f0 - f1));
      else if (f1 < 0) t1 = Math.min(t1, f0 / (f0 - f1));
      if (t0 >= t1) return null;
    }
    // hidden where the edge lies further than the face over it
    const g = (t: number): number => {
      const x = p[0] + (r[0] - p[0]) * t;
      const y = p[1] + (r[1] - p[1]) * t;
      const d = p[2] + (r[2] - p[2]) * t;
      return d - (plane3[k * 3] * x + plane3[k * 3 + 1] * y + plane3[k * 3 + 2]) - tol;
    };
    const g0 = g(t0);
    const g1 = g(t1);
    if (g0 <= 0 && g1 <= 0) return null;
    if (g0 > 0 && g1 > 0) return [t0, t1];
    const tm = t0 + ((t1 - t0) * g0) / (g0 - g1);
    return g0 > 0 ? [t0, tm] : [tm, t1];
  };

  /** The parts of p→r nothing hides, as 0..1 spans. */
  const seenParts = (p: V, r: V): [number, number][] => {
    pass++;
    const hidden: [number, number][] = [];
    /** whether what's hidden so far covers it all */
    const whole = (): boolean => {
      hidden.sort((a, b) => a[0] - b[0]);
      let at = 0;
      for (const [a, b] of hidden) {
        if (a > at) return false;
        at = Math.max(at, b);
        if (at >= 1) return true;
      }
      return false;
    };
    const deepest = Math.max(p[2], r[2]);
    const c0 = col(Math.min(p[0], r[0]));
    const c1 = col(Math.max(p[0], r[0]));
    const dx = r[0] - p[0];
    for (let c = c0; c <= c1; c++) {
      // the rows the line passes through in this column
      let ya = Math.min(p[1], r[1]);
      let yb = Math.max(p[1], r[1]);
      if (Math.abs(dx) > 1e-12 && c0 !== c1) {
        const ta = Math.max(0, Math.min(1, (gx0 + c * cw - p[0]) / dx));
        const tb = Math.max(0, Math.min(1, (gx0 + (c + 1) * cw - p[0]) / dx));
        const ys = [p[1] + (r[1] - p[1]) * ta, p[1] + (r[1] - p[1]) * tb];
        ya = Math.min(...ys);
        yb = Math.max(...ys);
      }
      for (let rr = row(ya - tol); rr <= row(yb + tol); rr++) {
        const cell = rr * cells + c;
        for (let i = count[cell]; i < count[cell + 1]; i++) {
          const k = list[i];
          if (stamp[k] === pass) continue;
          stamp[k] = pass;
          if (minD[k] >= deepest - tol) continue;
          const h = hiddenBy(k, p, r);
          if (h) {
            hidden.push(h);
            if (whole()) return [];
          }
        }
      }
    }
    hidden.sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let at = 0;
    for (const [a, b] of hidden) {
      if (a > at) out.push([at, a]);
      at = Math.max(at, b);
      if (at >= 1) break;
    }
    if (at < 1) out.push([at, 1]);
    return out;
  };

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  const grow = (pts: readonly Pt[]): void => {
    for (const p of pts) {
      bx0 = Math.min(bx0, p.x);
      bx1 = Math.max(bx1, p.x);
      by0 = Math.min(by0, p.y);
      by1 = Math.max(by1, p.y);
    }
  };
  const pieces: SectionPiece[] = [];
  for (const w of work) {
    const segs: [string, string][] = [];
    const at = new Map<string, Pt>();
    const ptKey = (x: number, y: number): string => {
      const k = `${q(x)},${q(y)}`;
      if (!at.has(k)) at.set(k, { x, y });
      return k;
    };
    if (far > 0)
      for (const edge of w.edges) {
        // an end just off a bound counts as on it, so an edge along it isn't lost to rounding
        const [a, b] = edge.map((p): V => [snap(p[0], x0, x1), snap(p[1], y0, y1), p[2]]);
        // the part of the edge beyond the plane, as far as the view goes and across the line's length
        let t0 = 0;
        let t1 = 1;
        const keep = (fa: number, fb: number): void => {
          if (fa < 0 && fb < 0) t1 = -1;
          else if (fa < 0) t0 = Math.max(t0, fa / (fa - fb));
          else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
        };
        keep(a[2] - tol, b[2] - tol);
        if (Number.isFinite(far)) keep(far - a[2], far - b[2]);
        keep(a[0] - x0, b[0] - x0);
        keep(x1 - a[0], x1 - b[0]);
        if (Number.isFinite(y0)) keep(a[1] - y0, b[1] - y0);
        if (Number.isFinite(y1)) keep(y1 - a[1], y1 - b[1]);
        if (!(t1 > t0)) continue;
        const lerp = (t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const p = lerp(t0);
        const r = lerp(t1);
        if (Math.hypot(r[0] - p[0], r[1] - p[1]) <= tol) continue;
        for (const [s0, s1] of seenParts(p, r)) {
          const sa = { x: p[0] + (r[0] - p[0]) * s0, y: p[1] + (r[1] - p[1]) * s0 };
          const sb = { x: p[0] + (r[0] - p[0]) * s1, y: p[1] + (r[1] - p[1]) * s1 };
          if (Math.hypot(sb.x - sa.x, sb.y - sa.y) > tol) segs.push([ptKey(sa.x, sa.y), ptKey(sb.x, sb.y)]);
        }
      }
    const lines = chain(segs, at)
      .map((c) => {
        const pts = straighten(c.pts, c.closed, tol);
        return c.closed && pts.length > 2 ? [...pts, pts[0]] : pts;
      })
      .filter((l) => l.length > 1);
    const piece: SectionPiece = { ...w.piece, lines };
    if (!piece.cuts.length && !piece.cutLines.length && !lines.length) continue;
    for (const c of piece.cuts) grow(c.outer);
    for (const l of [...piece.cutLines, ...lines]) grow(l);
    pieces.push(piece);
  }
  return { pieces, box: pieces.length ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null };
}

/** How far from `from` along `dir` (a unit vector) the nearest of the meshes' faces lies, or null when it meets none. */
export function nearestHit(meshes: readonly CutMesh[], from: readonly [number, number, number], dir: readonly [number, number, number]): number | null {
  let best = Infinity;
  const [ox, oy, oz] = from;
  const [dx, dy, dz] = dir;
  for (const m of meshes) {
    const t = m.triangles;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const e1x = t[i + 3] - t[i];
      const e1y = t[i + 4] - t[i + 1];
      const e1z = t[i + 5] - t[i + 2];
      const e2x = t[i + 6] - t[i];
      const e2y = t[i + 7] - t[i + 1];
      const e2z = t[i + 8] - t[i + 2];
      const px = dy * e2z - dz * e2y;
      const py = dz * e2x - dx * e2z;
      const pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const sx = ox - t[i];
      const sy = oy - t[i + 1];
      const sz = oz - t[i + 2];
      const u = (sx * px + sy * py + sz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const d = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (d > 1e-6 && d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : null;
}
