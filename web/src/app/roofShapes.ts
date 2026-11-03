// AEC > Create Roof's geometry. A roof over a closed outline has a slope rising from each of its
// edges at one pitch, so where the slopes meet is the outline's straight skeleton: the edges move
// inward together, and the bands they sweep before they vanish are the slopes in plan. A gable edge
// stands still, the neighbouring slopes running along it. The roof is that surface and one a
// thickness below it, closed at the eaves by the eave profile's cut and at gables by a plumb end.
//
// Vectorworks' help draws the levels without saying where each is measured. Here the Eave Height is
// the eave's lowest point, and the Bearing Height is the roof's underside over the Bearing Inset, the
// Eave Overhang and the Bearing Inset both being measured from the outline.

import type { Pt } from "../core/index.ts";
import { pointInPolygon } from "./geom.ts";
import { prism, type Solid } from "./solids3d.ts";

export type EaveProfile = "square" | "vertical" | "horizontal" | "double";

/** What the four levels depend on, past themselves. */
export interface RoofSection {
  eave: EaveProfile;
  /** a double cut's vertical fascia */
  vertical: number;
  thickness: number;
  bearingInset: number;
}

export interface RoofSpec extends RoofSection {
  /** where the walls' outer faces are */
  outline: readonly Pt[];
  /** which of the outline's edges, each from its point to the next, are gables */
  gables: ReadonlySet<number>;
  /** radians */
  pitch: number;
  bearingHeight: number;
  overhang: number;
  /** 0 for no wall under a gable */
  gableWall: number;
}

export interface Roof {
  /** the roof's edge in plan */
  eaves: Pt[];
  /** hips, valleys and ridges in plan */
  lines: [Pt, Pt][];
  solid: Solid;
}

/** A band of the slope an edge sweeps between two times. */
interface Sweep {
  edge: number;
  a0: Pt;
  b0: Pt;
  a1: Pt;
  b1: Pt;
  t0: number;
  t1: number;
  /** the edges before and after this one when it swept */
  before: number;
  after: number;
}

interface Corner {
  p: Pt;
  /** the edges either side of it, into it and out of it */
  into: number;
  out: number;
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const along = (p: Pt, v: Pt, t: number): Pt => ({ x: p.x + v.x * t, y: p.y + v.y * t });

function signedArea(pts: readonly Pt[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    a += cross(p, pts[(i + 1) % pts.length]);
  });
  return a / 2;
}

/** The outline without repeated or collinear points, anticlockwise. */
export function roofOutline(outline: readonly Pt[]): Pt[] {
  const pts = signedArea(outline) < 0 ? [...outline].reverse() : [...outline];
  return pts.filter((p, i) => {
    const before = pts[(i + pts.length - 1) % pts.length];
    const after = pts[(i + 1) % pts.length];
    const a = sub(p, before);
    const b = sub(after, p);
    const la = Math.hypot(a.x, a.y);
    const lb = Math.hypot(b.x, b.y);
    return la > 1e-6 && lb > 1e-6 && (Math.abs(cross(a, b)) / (la * lb) > 1e-6 || dot(a, b) < 0);
  });
}

function edgeFrames(outline: readonly Pt[]): { dir: Pt[]; inward: Pt[] } {
  const dir = outline.map((p, i) => {
    const d = sub(outline[(i + 1) % outline.length], p);
    const l = Math.hypot(d.x, d.y);
    return { x: d.x / l, y: d.y / l };
  });
  return { dir, inward: dir.map((d) => ({ x: -d.y, y: d.x })) };
}

/** How fast the corner between two edges moves, each edge moving inward at its speed. */
function cornerSpeed(inward: readonly Pt[], speed: readonly number[], into: number, out: number): Pt {
  const a = inward[into];
  const b = inward[out];
  const det = cross(a, b);
  if (Math.abs(det) < 1e-9) return dot(a, b) > 0 ? { x: a.x * speed[into], y: a.y * speed[into] } : { x: 0, y: 0 };
  return { x: (speed[into] * b.y - speed[out] * a.y) / det, y: (a.x * speed[out] - b.x * speed[into]) / det };
}

/** The outline's edges moved out by a distance; null where that turns an edge back on itself. */
function grown(outline: readonly Pt[], by: number): Pt[] | null {
  if (by <= 0) return [...outline];
  const n = outline.length;
  const { dir, inward } = edgeFrames(outline);
  const speed = outline.map(() => 1);
  const out = outline.map((p, i) => along(p, cornerSpeed(inward, speed, (i + n - 1) % n, i), -by));
  return out.every((p, i) => dot(sub(out[(i + 1) % n], p), dir[i]) > 0) ? out : null;
}

/**
 * The straight skeleton: the edges move inward, each at its speed, from event to event. An edge
 * shrinking to nothing joins its neighbours, and a corner turning inward that reaches an edge across
 * the outline splits the outline in two; an outline with no area left is finished. `stops` are
 * times the bands are cut at as well.
 */
function sweepEdges(outline: readonly Pt[], speed: readonly number[], stops: readonly number[]): { sweeps: Sweep[]; ridges: [Pt, Pt][] } | null {
  const { dir, inward } = edgeFrames(outline);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const EPS = size * 1e-7;
  const n = outline.length;
  let loops: Corner[][] = [outline.map((p, i) => ({ p, into: (i + n - 1) % n, out: i }))];
  const sweeps: Sweep[] = [];
  const ridges: [Pt, Pt][] = [];
  const left = [...stops].filter((t) => t > 0).sort((a, b) => a - b);
  let now = 0;
  for (let guard = 0; loops.length; guard++) {
    if (guard > 40 * n + 200) return null;
    let soonest = Infinity;
    let split: { loop: number; corner: number; edge: number } | null = null;
    loops.forEach((loop, l) => {
      const m = loop.length;
      const v = loop.map((c) => cornerSpeed(inward, speed, c.into, c.out));
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const e = loop[i].out;
        const closing = dot(sub(v[j], v[i]), dir[e]);
        if (closing < -1e-12) soonest = Math.min(soonest, Math.max(0, -dot(sub(loop[j].p, loop[i].p), dir[e]) / closing));
      }
      for (let r = 0; r < m; r++) {
        const c = loop[r];
        if (cross(dir[c.into], dir[c.out]) > -1e-9) continue;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          if (i === r || j === r) continue;
          const e = loop[i].out;
          const rate = dot(v[r], inward[e]) - speed[e];
          if (rate > -1e-12) continue;
          const gap = dot(sub(c.p, loop[i].p), inward[e]);
          const dt = -gap / rate;
          if (dt < -EPS / Math.abs(rate) || dt >= soonest) continue;
          const t = Math.max(0, dt);
          const hit = along(c.p, v[r], t);
          const from = dot(sub(hit, along(loop[i].p, v[i], t)), dir[e]);
          const to = dot(sub(along(loop[j].p, v[j], t), hit), dir[e]);
          if (from < -EPS || to < -EPS) continue;
          soonest = t;
          split = { loop: l, corner: r, edge: i };
        }
      }
    });
    if (!Number.isFinite(soonest)) return null;
    // a stop before the event comes first, and cuts the bands there with nothing else happening
    const stop = left[0];
    const stopped = stop !== undefined && now + soonest >= stop;
    const dt = stopped ? stop - now : soonest;
    if (stopped) left.shift();
    loops = loops.map((loop) => {
      const m = loop.length;
      const moved = loop.map((c) => ({ ...c, p: along(c.p, cornerSpeed(inward, speed, c.into, c.out), dt) }));
      if (dt > 0) {
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          const e = loop[i].out;
          if (speed[e] > 0) sweeps.push({ edge: e, a0: loop[i].p, b0: loop[j].p, a1: moved[i].p, b1: moved[j].p, t0: now, t1: now + dt, before: loop[i].into, after: loop[j].out });
        }
      }
      return moved;
    });
    now += dt;
    const event = stopped ? null : (split as { loop: number; corner: number; edge: number } | null);
    if (event) {
      const loop = loops[event.loop];
      const m = loop.length;
      const r = loop[event.corner];
      const e = loop[event.edge].out;
      const run = (from: number, to: number): Corner[] => {
        const out: Corner[] = [];
        for (let i = from; i !== to; i = (i + 1) % m) out.push(loop[i]);
        return out;
      };
      const next = (event.edge + 1) % m;
      const after = (event.corner + 1) % m;
      loops = [...loops.slice(0, event.loop), ...loops.slice(event.loop + 1), [{ p: r.p, into: r.into, out: e }, ...run(next, event.corner)], [{ p: r.p, into: e, out: r.out }, ...run(after, next)]];
    }
    loops = loops.flatMap((loop) => {
      // corners that have met are one, keeping the edges either side of them
      const kept: Corner[] = [];
      for (const c of loop) {
        const last = kept[kept.length - 1];
        if (last && Math.hypot(last.p.x - c.p.x, last.p.y - c.p.y) < EPS) kept[kept.length - 1] = { ...last, out: c.out };
        else kept.push(c);
      }
      if (kept.length > 1) {
        const first = kept[0];
        const last = kept[kept.length - 1];
        if (Math.hypot(last.p.x - first.p.x, last.p.y - first.p.y) < EPS) {
          kept[0] = { ...first, into: last.into };
          kept.pop();
        }
      }
      if (kept.length >= 3 && Math.abs(signedArea(kept.map((c) => c.p))) > size * size * 1e-9) return [kept];
      kept.forEach((c, i) => {
        const d = kept[(i + 1) % kept.length];
        if (kept.length > 1 && Math.hypot(c.p.x - d.p.x, c.p.y - d.p.y) > EPS) ridges.push([c.p, d.p]);
      });
      return [];
    });
  }
  return { sweeps, ridges };
}

/** Each line once, and those running on from each other as one. */
function joinedLines(raw: readonly [Pt, Pt][], tiny: number): [Pt, Pt][] {
  const same = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) < tiny;
  const lines: [Pt, Pt][] = [];
  for (const [a, b] of raw) {
    if (same(a, b)) continue;
    if (!lines.some(([p, q]) => (same(p, a) && same(q, b)) || (same(p, b) && same(q, a)))) lines.push([a, b]);
  }
  // overlapping lines, such as a ridge found from both of its sides at different lengths, are one
  for (let joined = true; joined; ) {
    joined = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const [a, b] = lines[i];
        const [c, d] = lines[j];
        const u = sub(b, a);
        const lu = Math.hypot(u.x, u.y);
        const off = (p: Pt): number => Math.abs(cross(u, sub(p, a))) / lu;
        if (off(c) > tiny || off(d) > tiny) continue;
        const pos = (p: Pt): number => dot(sub(p, a), u) / lu;
        const ends = [{ p: a, s: 0 }, { p: b, s: lu }, { p: c, s: pos(c) }, { p: d, s: pos(d) }].sort((x, y) => x.s - y.s);
        // in line, they must also touch
        if (Math.max(pos(c), pos(d)) < -tiny || Math.min(pos(c), pos(d)) > lu + tiny) continue;
        lines[i] = [ends[0].p, ends[3].p];
        lines.splice(j, 1);
        joined = true;
        break outer;
      }
    }
  }
  return lines;
}

/** How high the top of the roof is at the eave edge, above the Eave Height. */
function eaveRise(s: RoofSection, pitch: number): number {
  const plumb = s.thickness / Math.cos(pitch);
  if (s.eave === "vertical") return plumb;
  if (s.eave === "square") return s.thickness * Math.cos(pitch);
  if (s.eave === "horizontal") return 0;
  return Math.min(s.vertical, plumb);
}

/** A double cut's soffit, for its vertical fascia. */
export function doubleCutHorizontal(s: RoofSection, pitch: number): number {
  return Math.max(0, (s.thickness / Math.cos(pitch) - s.vertical) / Math.tan(pitch));
}

/** A double cut's fascia, for its soffit. */
export function doubleCutVertical(s: RoofSection, pitch: number, horizontal: number): number {
  return Math.max(0, s.thickness / Math.cos(pitch) - horizontal * Math.tan(pitch));
}

/** The underside's height at a distance in from the eave edge, above the top of the eave edge. */
function undersideDrop(s: RoofSection, pitch: number, t: number): number {
  return t * Math.tan(pitch) - s.thickness / Math.cos(pitch);
}

export function eaveHeightFor(s: RoofSection, pitch: number, bearing: number, overhang: number): number {
  return bearing - undersideDrop(s, pitch, overhang + s.bearingInset) - eaveRise(s, pitch);
}

export function bearingHeightFor(s: RoofSection, pitch: number, eave: number, overhang: number): number {
  return eave + eaveRise(s, pitch) + undersideDrop(s, pitch, overhang + s.bearingInset);
}

/** Null where no overhang makes those levels, or one less than none. */
export function overhangFor(s: RoofSection, pitch: number, eave: number, bearing: number): number | null {
  const o = (bearing - eave - eaveRise(s, pitch) + s.thickness / Math.cos(pitch)) / Math.tan(pitch) - s.bearingInset;
  return o >= 0 ? o : null;
}

/** The pitch, radians, that makes those levels; null where none does. */
export function pitchFor(s: RoofSection, eave: number, bearing: number, overhang: number): number | null {
  const miss = (p: number): number => bearingHeightFor(s, p, eave, overhang) - bearing;
  let lo = (0.5 * Math.PI) / 180;
  let hi = (85 * Math.PI) / 180;
  if (miss(lo) > 0 || miss(hi) < 0) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (miss(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function roofProblem(s: RoofSpec): string | null {
  if (!(s.pitch > 0) || s.pitch >= Math.PI / 2) return "The pitch must be more than 0° and less than 90°.";
  if (!(s.thickness > 0)) return "The roof needs a thickness.";
  if (s.overhang < 0 || s.bearingInset < 0) return "The overhang and bearing inset can't be less than 0.";
  if (s.eave === "double" && s.vertical < 0) return "A double cut's vertical can't be less than 0.";
  if (s.outline.length < 3) return "A roof needs an outline of three sides or more.";
  if (s.gables.size >= s.outline.length) return "A roof needs at least one edge that isn't a gable.";
  return null;
}

function face(points: readonly (readonly [Pt, number])[]): number[] | null {
  const out: (readonly [Pt, number])[] = [];
  for (const q of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0].x - q[0].x, last[0].y - q[0].y) > 1e-6 || Math.abs(last[1] - q[1]) > 1e-6) out.push(q);
  }
  while (out.length > 1 && Math.hypot(out[0][0].x - out[out.length - 1][0].x, out[0][0].y - out[out.length - 1][0].y) < 1e-6 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out.length >= 3 ? out.flatMap(([p, z]) => [p.x, p.y, z]) : null;
}

/** The roof, its levels from its pitch, Bearing Height and Eave Overhang; null where the outline is too tangled for its overhang or to work out. */
export function buildRoof(s: RoofSpec): Roof | null {
  if (roofProblem(s)) return null;
  const eaves = grown(s.outline, s.overhang);
  if (!eaves) return null;
  const tan = Math.tan(s.pitch);
  const plumb = s.thickness / Math.cos(s.pitch);
  const eaveZ = eaveHeightFor(s, s.pitch, s.bearingHeight, s.overhang);
  const rise = eaveRise(s, s.pitch);
  const top0 = eaveZ + rise;
  // where the underside starts, the eave's cut running to it from the eave edge
  const start = s.eave === "square" ? s.thickness * Math.sin(s.pitch) : s.eave === "horizontal" ? s.thickness / Math.sin(s.pitch) : s.eave === "double" ? (plumb - rise) / tan : 0;
  const fascia = s.eave === "square" ? 0 : s.eave === "horizontal" ? 0 : s.eave === "vertical" ? plumb : rise;
  const cutSlope = s.eave === "square" ? -Math.cos(s.pitch) / Math.sin(s.pitch) : 0;
  const speed = eaves.map((_, i) => (s.gables.has(i) ? 0 : 1));
  const swept = sweepEdges(eaves, speed, start > 0 ? [start] : []);
  if (!swept) return null;
  const top = (t: number): number => top0 + t * tan;
  const under = (t: number): number => (t < start - 1e-6 ? top0 - fascia + cutSlope * t : top0 - plumb + t * tan);
  const solid: Solid = [];
  const add = (points: readonly (readonly [Pt, number])[]): void => {
    const f = face(points);
    if (f) solid.push(f);
  };
  /** The plumb side of the roof going from p to q, the roof on its left. */
  const side = (p: Pt, q: Pt, tp: number, tq: number): void =>
    add([
      [p, top(tp)],
      [p, under(tp)],
      [q, under(tq)],
      [q, top(tq)],
    ]);
  for (const b of swept.sweeps) {
    add([
      [b.a0, top(b.t0)],
      [b.b0, top(b.t0)],
      [b.b1, top(b.t1)],
      [b.a1, top(b.t1)],
    ]);
    add([
      [b.a1, under(b.t1)],
      [b.b1, under(b.t1)],
      [b.b0, under(b.t0)],
      [b.a0, under(b.t0)],
    ]);
    if (b.t0 === 0 && fascia > 0) side(b.a0, b.b0, 0, 0);
    if (s.gables.has(b.before)) side(b.a1, b.a0, b.t1, b.t0);
    if (s.gables.has(b.after)) side(b.b0, b.b1, b.t0, b.t1);
  }
  if (s.gableWall > 0) for (const i of s.gables) solid.push(...gableWall(s, swept.sweeps, eaves, i, under));
  const raw: [Pt, Pt][] = [...swept.ridges];
  for (const b of swept.sweeps) {
    if (!s.gables.has(b.before)) raw.push([b.a0, b.a1]);
    if (!s.gables.has(b.after)) raw.push([b.b0, b.b1]);
  }
  const xs = eaves.map((p) => p.x);
  return { eaves, lines: joinedLines(raw, (Math.max(...xs) - Math.min(...xs)) * 1e-5 + 1e-6), solid };
}

/** The wall under a gable, from the underside's lowest point along the wall up to the underside, its outer face on the outline. */
function gableWall(s: RoofSpec, sweeps: readonly Sweep[], eaves: readonly Pt[], i: number, under: (t: number) => number): Solid {
  const n = s.outline.length;
  const a = s.outline[i];
  const b = s.outline[(i + 1) % n];
  const d = sub(b, a);
  const length = Math.hypot(d.x, d.y);
  const u = { x: d.x / length, y: d.y / length };
  const { inward } = edgeFrames(eaves);
  const at = (t: number): Pt => along(a, u, t);
  const cuts = [0, length];
  for (const w of sweeps) {
    const ring = [w.a0, w.b0, w.b1, w.a1];
    ring.forEach((p, k) => {
      const e = sub(ring[(k + 1) % 4], p);
      const det = cross(u, e);
      if (Math.abs(det) < 1e-9) return;
      const o = sub(p, a);
      const t = cross(o, e) / det;
      const r = cross(o, u) / det;
      if (t > 0 && t < length && r >= 0 && r <= 1) cuts.push(t);
    });
  }
  cuts.sort((x, y) => x - y);
  const profile: Pt[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const [t0, t1] = [cuts[k], cuts[k + 1]];
    if (t1 - t0 < 1e-3) continue;
    // just inside the wall's face, which with no overhang is on the roof's edge
    const mid = along(at((t0 + t1) / 2), { x: -u.y, y: u.x }, 0.5);
    const over = sweeps.find((w) => pointInPolygon(mid, [w.a0, w.b0, w.b1, w.a1]));
    if (!over) continue;
    const height = (t: number): number => under(Math.max(0, dot(sub(at(t), eaves[over.edge]), inward[over.edge])));
    profile.push({ x: t0, y: height(t0) }, { x: t1, y: height(t1) });
  }
  if (profile.length < 2) return [];
  const base = Math.min(...profile.map((p) => p.y));
  const tops = profile.filter((p, k) => k === 0 || Math.hypot(p.x - profile[k - 1].x, p.y - profile[k - 1].y) > 1e-3).reverse();
  const ends = [{ x: profile[0].x, y: base }, { x: profile[profile.length - 1].x, y: base }];
  const ring = [...ends, ...tops].filter((p, k, all) => {
    const q = all[(k + 1) % all.length];
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-3;
  });
  if (ring.length < 3) return [];
  // the profile's x along the wall, y up, and z outward: right-handed, so its faces stay facing out
  const out = { x: u.y, y: -u.x };
  return prism([ring], -s.gableWall, 0).map((f) => {
    const q: number[] = [];
    for (let k = 0; k < f.length; k += 3) {
      const p = along(along(a, u, f[k]), out, f[k + 2]);
      q.push(p.x, p.y, f[k + 1]);
    }
    return q;
  });
}
