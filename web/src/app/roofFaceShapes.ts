// AEC > Roof Face's geometry: one sloping slab over a closed outline, rising at one pitch away from
// its axis line. Worked in the slab's own plane ("plate" coordinates: along the axis, up the slope
// in true length, and depth below the top), every edge is cut by a plane through its top edge, so
// at each depth an edge's side is the top edge moved over by some distance; the corners at that
// depth are where neighbouring edges' moved lines meet. A double cut bends once, at the depth its
// vertical fascia ends, so the rings are made at the top, there, and at the bottom.
//
// Vectorworks' help says the Eave Cut is for "the lower edge" and that other edges are cut
// vertically. Here an eave is an edge whose outside faces down the slope within 45° of square to
// it; a hole's edges take the Hole Cut, Splayed being horizontal on the hole's upper edges (those
// facing down the slope) and vertical on the rest. Axis Z is the roof's underside at the axis.

import type { Pt } from "../core/index.ts";

export type EaveCut = "vertical" | "horizontal" | "double" | "square";
export type HoleCut = "vertical" | "splayed" | "square";
type Cut = "vertical" | "horizontal" | "square";

export interface RoofFaceSpec {
  /** the slab's edge in plan; either way round */
  outline: readonly Pt[];
  holes: readonly (readonly Pt[])[];
  /** the axis line in plan, from its first click to its second */
  axis: readonly [Pt, Pt];
  /** 1: the roof rises to the left of the axis, going from its first point to its second; -1: to the right */
  side: 1 | -1;
  /** radians, more than 0 and less than 90° */
  pitch: number;
  /** the underside's height at the axis */
  axisZ: number;
  /** square to the slope */
  thickness: number;
  eave: EaveCut;
  /** a double cut's fascia, plumb */
  vertical: number;
  hole: HoleCut;
}

export interface RoofFace {
  /** each face's points, x y z after one another, its outside the side it's seen anticlockwise from */
  faces: number[][];
  /** the top's area, in its slope */
  area: number;
  /** the top's area in plan */
  planArea: number;
}

/** An eave is within this of square to the slope. */
const EAVE_COS = Math.cos(Math.PI / 4);

const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;

function signedArea(pts: readonly Pt[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    a += cross(p, pts[(i + 1) % pts.length]);
  });
  return a / 2;
}

/** Without repeated points or a last that repeats the first. */
export function cleanRing(pts: readonly Pt[], tolerance = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tolerance) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= tolerance) out.pop();
  return out;
}

/**
 * A polygon with its holes joined in (surfaces.ts' joinHoles) taken apart again: wherever an edge
 * runs back along an earlier one, the loop between is a hole.
 */
export function splitHoles(ring: readonly Pt[], tolerance = 1e-6): { outer: Pt[]; holes: Pt[][] } {
  const same = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
  let outer = cleanRing(ring, tolerance);
  const holes: Pt[][] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const n = outer.length;
    let found: [number, number] | null = null;
    for (let i = 0; i < n && !found; i++) {
      const p = outer[i];
      const q = outer[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (same(outer[j], q) && same(outer[(j + 1) % n], p)) {
          found = [i, j];
          break;
        }
      }
    }
    if (!found) break;
    const [i, j] = found;
    // the ring runs P (i), M (i+1), round the hole, M (j), P (j+1): the hole is from i+1 to before j
    const loop = cleanRing(outer.slice(i + 1, j), tolerance);
    if (loop.length >= 3) holes.push(loop);
    outer = cleanRing([...outer.slice(0, i + 1), ...outer.slice(j + 2)], tolerance);
  }
  return { outer, holes };
}

export function roofFaceProblem(s: RoofFaceSpec): string | null {
  if (!(s.pitch > 0) || s.pitch >= Math.PI / 2) return "The roof's angle must be more than 0° and less than 90°.";
  if (!(s.thickness > 0)) return "The roof needs a thickness.";
  if (s.eave === "double" && !(s.vertical >= 0)) return "A double cut's vertical can't be less than 0.";
  if (cleanRing(s.outline).length < 3) return "A roof face needs an outline of three sides or more.";
  if (Math.hypot(s.axis[1].x - s.axis[0].x, s.axis[1].y - s.axis[0].y) < 1e-6) return "The roof's axis needs two different points.";
  return null;
}

/** The pitch, radians, that makes the top `height` above the axis' underside at `at`; null where it can't. */
export function pitchThrough(axis: readonly [Pt, Pt], at: Pt, rise: number): { pitch: number; side: 1 | -1 } | null {
  const d = { x: axis[1].x - axis[0].x, y: axis[1].y - axis[0].y };
  const length = Math.hypot(d.x, d.y);
  if (length < 1e-9) return null;
  const across = cross(d, { x: at.x - axis[0].x, y: at.y - axis[0].y }) / length;
  if (Math.abs(across) < 1e-6 || Math.abs(rise) < 1e-6) return null;
  const pitch = Math.atan(Math.abs(rise) / Math.abs(across));
  // a click below the axis' height is on the low side
  const left: 1 | -1 = across > 0 ? 1 : -1;
  return { pitch, side: rise > 0 ? left : left === 1 ? -1 : 1 };
}

/** Which side of the axis a point is on, as RoofFaceSpec.side has it; 1 on the line. */
export function sideOf(axis: readonly [Pt, Pt], at: Pt): 1 | -1 {
  const d = { x: axis[1].x - axis[0].x, y: axis[1].y - axis[0].y };
  return cross(d, { x: at.x - axis[0].x, y: at.y - axis[0].y }) < 0 ? -1 : 1;
}

/** Where two lines meet, each a point and a direction; null if they're parallel. */
function meet(p: Pt, u: Pt, q: Pt, v: Pt): Pt | null {
  const det = cross(u, v);
  if (Math.abs(det) < 1e-12) return null;
  const t = cross({ x: q.x - p.x, y: q.y - p.y }, v) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/** The roof face; null where it's too small for its thickness and cuts, or the spec has a problem. */
export function buildRoofFace(s: RoofFaceSpec): RoofFace | null {
  if (roofFaceProblem(s)) return null;
  const [a, b] = s.axis;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const up = s.side === 1 ? { x: -along.y, y: along.x } : { x: along.y, y: -along.x };
  const cos = Math.cos(s.pitch);
  const sin = Math.sin(s.pitch);
  const top0 = s.axisZ + s.thickness / cos;
  const toPlate = (p: Pt): Pt => {
    const r = { x: p.x - a.x, y: p.y - a.y };
    return { x: r.x * along.x + r.y * along.y, y: (r.x * up.x + r.y * up.y) / cos };
  };
  const toWorld = (p: Pt, depth: number): [number, number, number] => {
    const across = p.y * cos + depth * sin;
    return [a.x + along.x * p.x + up.x * across, a.y + along.y * p.x + up.y * across, top0 + p.y * sin - depth * cos];
  };
  // the material on each edge's left: the outline anticlockwise in the plate, holes clockwise
  const orient = (ring: readonly Pt[], ccw: boolean): Pt[] => {
    const pts = cleanRing(ring).map(toPlate);
    return signedArea(pts) > 0 === ccw ? pts : pts.reverse();
  };
  const outer = orient(s.outline, true);
  const holes = s.holes.map((h) => orient(h, false)).filter((h) => h.length >= 3);
  const rings = [outer, ...holes];
  const fascia = Math.min(s.thickness, Math.max(0, s.vertical) * cos);
  const doubled = s.eave === "double" && fascia > 1e-9 && fascia < s.thickness - 1e-9;
  const depths = doubled ? [0, fascia, s.thickness] : [0, s.thickness];

  /** How far an edge's side has moved out at each depth: a world direction into the slab, per unit of depth. */
  const rate = (dir: readonly [number, number, number], normal: Pt): number => {
    const [wx, wy, wz] = dir;
    const across = wx * up.x + wy * up.y;
    const inPlate = { x: wx * along.x + wy * along.y, y: across * cos + wz * sin };
    const deeper = across * sin - wz * cos;
    return (inPlate.x * normal.x + inPlate.y * normal.y) / deeper;
  };
  const offsets = rings.map((ring, r) =>
    ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const d = { x: q.x - p.x, y: q.y - p.y };
      const plateLength = Math.hypot(d.x, d.y);
      const normal = { x: d.y / plateLength, y: -d.x / plateLength };
      // the edge's outside in plan, and how much it faces down the slope
      const planD = { x: d.x, y: d.y * cos };
      const planLength = Math.hypot(planD.x, planD.y);
      const downhill = planD.x / planLength;
      const out = { x: (along.x * planD.y - up.x * planD.x) / planLength, y: (along.y * planD.y - up.y * planD.x) / planLength };
      const eave = downhill >= EAVE_COS;
      const cut = (k: "fascia" | "soffit"): Cut => {
        if (r === 0) {
          if (!eave || s.eave === "vertical") return "vertical";
          if (s.eave !== "double") return s.eave;
          // no fascia is a horizontal cut, one past the underside a vertical one
          if (fascia <= 1e-9) return "horizontal";
          return doubled && k === "soffit" ? "horizontal" : "vertical";
        }
        if (s.hole === "square") return "square";
        return s.hole === "splayed" && eave ? "horizontal" : "vertical";
      };
      const per = (c: Cut): number => (c === "square" ? 0 : c === "vertical" ? rate([0, 0, -1], normal) : rate([-out.x, -out.y, 0], normal));
      return depths.map((depth) => {
        if (!doubled || depth <= fascia) return depth * per(cut("fascia"));
        return fascia * per(cut("fascia")) + (depth - fascia) * per(cut("soffit"));
      });
    }),
  );
  // each ring at each depth
  const levels: Pt[][][] = depths.map((_, k) =>
    rings.map((ring, r) =>
      ring.map((p, i) => {
        const n = ring.length;
        const lineOf = (e: number): { at: Pt; dir: Pt } => {
          const p0 = ring[e];
          const p1 = ring[(e + 1) % n];
          const d = { x: p1.x - p0.x, y: p1.y - p0.y };
          const l = Math.hypot(d.x, d.y);
          const o = offsets[r][e][k];
          return { at: { x: p0.x + (d.y / l) * o, y: p0.y - (d.x / l) * o }, dir: d };
        };
        const before = lineOf((i - 1 + n) % n);
        const after = lineOf(i);
        const met = meet(before.at, before.dir, after.at, after.dir);
        if (met) return met;
        // in line: the corner moves out with them
        const l = Math.hypot(after.dir.x, after.dir.y);
        const o = (offsets[r][(i - 1 + n) % n][k] + offsets[r][i][k]) / 2;
        return { x: p.x + (after.dir.y / l) * o, y: p.y - (after.dir.x / l) * o };
      }),
    ),
  );
  // a ring whose edges turn round, or whose corners went far past them, is too small for its cuts
  const reach = Math.max(...outer.map((p) => Math.hypot(p.x - outer[0].x, p.y - outer[0].y))) + 1;
  for (const level of levels.slice(1)) {
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const moved = level[r];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const d0 = { x: ring[j].x - ring[i].x, y: ring[j].y - ring[i].y };
        const d1 = { x: moved[j].x - moved[i].x, y: moved[j].y - moved[i].y };
        if (d0.x * d1.x + d0.y * d1.y <= 0) return null;
        if (Math.hypot(moved[i].x - ring[i].x, moved[i].y - ring[i].y) > 4 * reach) return null;
      }
      if (Math.sign(signedArea(moved)) !== Math.sign(signedArea(ring))) return null;
    }
  }
  const faces: number[][] = [];
  /** A face, turned so its outside is the side `outward` points to. */
  const add = (pts: readonly [number, number, number][], outward: readonly [number, number, number]): void => {
    if (pts.length < 3) return;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const ordered = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0 ? [...pts].reverse() : pts;
    faces.push(ordered.flat());
  };
  const normal: [number, number, number] = [-up.x * sin, -up.y * sin, cos];
  const withHoles = (level: Pt[][], depth: number): [number, number, number][] => joinedRing(level[0], level.slice(1)).map((p) => toWorld(p, depth));
  add(withHoles(levels[0], 0), normal);
  add(withHoles(levels[levels.length - 1], s.thickness), [-normal[0], -normal[1], -normal[2]]);
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const d = { x: ring[j].x - ring[i].x, y: ring[j].y - ring[i].y };
      const l = Math.hypot(d.x, d.y);
      const plateOut = { x: d.y / l, y: -d.x / l };
      const out: [number, number, number] = [along.x * plateOut.x + up.x * plateOut.y * cos, along.y * plateOut.x + up.y * plateOut.y * cos, -0.5];
      for (let k = 0; k + 1 < depths.length; k++) {
        add(
          [toWorld(levels[k][r][i], depths[k]), toWorld(levels[k][r][j], depths[k]), toWorld(levels[k + 1][r][j], depths[k + 1]), toWorld(levels[k + 1][r][i], depths[k + 1])].filter(
            (p, n, all) => n === 0 || Math.hypot(p[0] - all[n - 1][0], p[1] - all[n - 1][1], p[2] - all[n - 1][2]) > 1e-6,
          ),
          out,
        );
      }
    }
  });
  const plateArea = Math.abs(signedArea(outer)) - holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
  return { faces, area: plateArea, planArea: plateArea * cos };
}

/** Holes joined into the ring by a bridge from each one's first point to the ring's nearest corner it can see. */
function joinedRing(outer: readonly Pt[], holes: readonly Pt[][]): Pt[] {
  let ring = [...outer];
  for (const hole of holes) {
    const m = hole.reduce((best, p, i) => (p.x < hole[best].x ? i : best), 0);
    const from = hole[m];
    let at = 0;
    let best = Infinity;
    ring.forEach((p, i) => {
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d >= best) return;
      // the bridge mustn't cross the ring or another hole
      const blocked = [ring, ...holes].some((other) =>
        other.some((q, k) => {
          const r = other[(k + 1) % other.length];
          return crosses(from, p, q, r);
        }),
      );
      if (!blocked) {
        best = d;
        at = i;
      }
    });
    const loop = [...hole.slice(m), ...hole.slice(0, m), hole[m]];
    ring = [...ring.slice(0, at + 1), ...loop, ring[at], ...ring.slice(at + 1)];
  }
  return ring;
}

/** Whether segments pq and rs cross at a point inside both (touching at an end doesn't count). */
function crosses(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d1 = cross({ x: q.x - p.x, y: q.y - p.y }, { x: r.x - p.x, y: r.y - p.y });
  const d2 = cross({ x: q.x - p.x, y: q.y - p.y }, { x: s.x - p.x, y: s.y - p.y });
  const d3 = cross({ x: s.x - r.x, y: s.y - r.y }, { x: p.x - r.x, y: p.y - r.y });
  const d4 = cross({ x: s.x - r.x, y: s.y - r.y }, { x: q.x - r.x, y: q.y - r.y });
  const e = 1e-9;
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}
