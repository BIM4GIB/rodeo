// Dimension Exterior Walls' geometry (AEC > Dimension Exterior Walls; dimensionExteriorWalls.ts runs
// it). The walls' areas are joined (wallPolys.ts) and each joined area's outline is a building.
// Each building is dimensioned along its own two directions (its longest side's and square to it),
// on all four sides, by up to three chains stacked outward: the openings (the doors and windows in
// the walls that face that side, at their edges or centres, between the corners, with the walls
// meeting them from inside when T-joins are asked for), the walls (every corner and jog seen from
// that side) and the overall size. A chain that would say no more than the next one out is left
// out. Measured to the outer faces, or to the walls' centrelines (their control lines' ends).

import type { Pt } from "../core/index.ts";
import { ringArea, wallPolys } from "./wallPolys.ts";

export interface ExteriorWall {
  readonly start: Pt;
  readonly end: Pt;
  /** the area its plan drawing covers */
  readonly footprint: readonly Pt[];
  /** where what's set in it reaches along it from its start */
  readonly openings: readonly { readonly a0: number; readonly a1: number }[];
}

export interface ExteriorOptions {
  /** the walls' outer faces, or their centrelines */
  readonly to: "faces" | "centerlines";
  /** an opening's two edges, or its centre */
  readonly openings: "edges" | "centers";
  /** dimension the walls that meet the exterior walls from inside */
  readonly tees: boolean;
  /** each chain's distance out from the building's furthest point on its side */
  readonly offsets: { readonly openings: number; readonly walls: number; readonly overall: number };
  /** a span shorter than this is small: dropped, or marked to draw in red */
  readonly small: number;
  readonly smallMode: "red" | "skip";
}

export type Side = "bottom" | "right" | "top" | "left";
export type ChainKind = "openings" | "walls" | "overall";

/** One chain: the points it measures in order along `u`, its line through `at`, and which of its spans are small. */
export interface ExteriorChain {
  readonly side: Side;
  readonly kind: ChainKind;
  readonly points: Pt[];
  readonly at: Pt;
  readonly u: Pt;
  readonly small: boolean[];
}

/** how near a point must be to a building's outline to lie on it, mm */
const ON = 1;
/** two places along a side this near are one, mm */
const SAME = 0.5;
const SIDES: readonly Side[] = ["bottom", "right", "top", "left"];

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;

/** The distance from `p` to the segment `a`–`b`. */
function toSegment(p: Pt, a: Pt, b: Pt): number {
  const d = { x: b.x - a.x, y: b.y - a.y };
  const len2 = dot(d, d);
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2)) : 0;
  return Math.hypot(p.x - a.x - d.x * t, p.y - a.y - d.y * t);
}

/** A ring without the hairline notches and steps joining turned walls can leave: each point within ON of the line between its neighbours goes. */
function unNotched(ring: Pt[]): Pt[] {
  let out = ring;
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[(i + 1) % out.length];
      if (toSegment(out[i], a, b) <= ON) {
        out = [...out.slice(0, i), ...out.slice(i + 1)];
        changed = true;
        i--;
      }
    }
  }
  return out;
}

/** Counter-clockwise. */
function ccw(ring: Pt[]): Pt[] {
  const signed = ring.reduce((a, p, i) => a + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0);
  return signed < 0 ? [...ring].reverse() : ring;
}

/** The chains dimensioning each building the walls make; a reason when they make none. */
export function exteriorChains(walls: readonly ExteriorWall[], o: ExteriorOptions): ExteriorChain[] | string {
  const footprints = walls.map((w) => [...w.footprint]).filter((f) => f.length >= 3);
  if (!footprints.length) return "there are no straight walls to dimension";
  const buildings = wallPolys(footprints, false).map(unNotched).filter((r) => r.length >= 3 && ringArea(r) > 1).map(ccw);
  const out: ExteriorChain[] = [];
  for (const ring of buildings) out.push(...buildingChains(ring, walls, o));
  return out.length ? out : "the walls make no outline to dimension";
}

function buildingChains(ring: readonly Pt[], walls: readonly ExteriorWall[], o: ExteriorOptions): ExteriorChain[] {
  const n = ring.length;
  const edges = ring.map((a, i) => ({ a, b: ring[(i + 1) % n] }));
  // the building's frame: along its longest side, kept within a quarter turn of the page's x
  const longest = edges.reduce((m, e) => (Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) > Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) ? e : m));
  let theta = Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x);
  theta = ((theta % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  if (theta > Math.PI / 4) theta -= Math.PI / 2;
  if (Math.abs(theta) < 1e-9) theta = 0;
  const X: Pt = { x: Math.cos(theta), y: Math.sin(theta) };
  const Y: Pt = { x: -X.y, y: X.x };
  const local = (p: Pt): Pt => ({ x: dot(p, X), y: dot(p, Y) });
  const world = (q: Pt): Pt => ({ x: q.x * X.x + q.y * Y.x, y: q.x * X.y + q.y * Y.y });
  const lr = ring.map(local);
  const box = { x0: Math.min(...lr.map((p) => p.x)), x1: Math.max(...lr.map((p) => p.x)), y0: Math.min(...lr.map((p) => p.y)), y1: Math.max(...lr.map((p) => p.y)) };
  // which side each edge faces, by its outward normal (right of it, round a counter-clockwise ring)
  const facing = (a: Pt, b: Pt): Side => {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const nn = { x: d.y, y: -d.x };
    return Math.abs(nn.y) >= Math.abs(nn.x) ? (nn.y < 0 ? "bottom" : "top") : nn.x > 0 ? "right" : "left";
  };
  const localEdges = lr.map((a, i) => ({ a, b: lr[(i + 1) % n], side: facing(a, lr[(i + 1) % n]) }));
  const onRing = (p: Pt): boolean => localEdges.some((e) => toSegment(p, e.a, e.b) <= ON);
  // the walls of this building: a side on its outline, or (for T-joins) inside it
  const lw = walls.map((w) => ({ w, s: local(w.start), e: local(w.end), f: w.footprint.map(local) }));
  const exterior = lw.filter((x) => x.f.filter(onRing).length >= 2);
  const inside = (p: Pt): boolean => {
    let hit = false;
    for (const e of localEdges) if (e.a.y > p.y !== e.b.y > p.y && p.x < e.a.x + ((p.y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y)) hit = !hit;
    return hit;
  };
  const chains: ExteriorChain[] = [];
  for (const side of SIDES) {
    const across = side === "bottom" || side === "top";
    // along the side (x for bottom and top, y for the others); out is the way away from the building
    const pos = (p: Pt): number => (across ? p.x : p.y);
    const out = side === "bottom" || side === "left" ? -1 : 1;
    const far = side === "bottom" ? box.y0 : side === "top" ? box.y1 : side === "left" ? box.x0 : box.x1;
    const facingEdges = localEdges.filter((e) => e.side === side);
    if (!facingEdges.length) continue;
    // where the side's corners are, each with the point nearest the chains to start its witness line
    const wallPts: Pt[] = [];
    if (o.to === "faces") for (const e of facingEdges) wallPts.push(e.a, e.b);
    // the walls along this side: parallel to it, a face on one of its edges
    const along = exterior.filter((x) => {
      const d = { x: x.e.x - x.s.x, y: x.e.y - x.s.y };
      const len = Math.hypot(d.x, d.y);
      if (!(len > 0) || Math.abs(across ? d.y : d.x) > len * 1e-3) return false;
      return x.f.some((p) => facingEdges.some((e) => toSegment(p, e.a, e.b) <= ON));
    });
    // an outer face's line: where the side's edge nearest a wall lies
    const faceOf = (x: (typeof along)[number]): number => {
      const mid = { x: (x.s.x + x.e.x) / 2, y: (x.s.y + x.e.y) / 2 };
      const e = facingEdges.reduce((m, f) => (toSegment(mid, f.a, f.b) < toSegment(mid, m.a, m.b) ? f : m));
      return across ? e.a.y : e.a.x;
    };
    const put = (p: number, line: number): Pt => (across ? { x: p, y: line } : { x: line, y: p });
    if (o.to === "centerlines") {
      for (const x of along) {
        const line = faceOf(x);
        wallPts.push(put(pos(x.s), line), put(pos(x.e), line));
      }
    }
    const openPts: Pt[] = [];
    for (const x of along) {
      const line = faceOf(x);
      const len = Math.hypot(x.e.x - x.s.x, x.e.y - x.s.y);
      const at = (a: number): number => pos(x.s) + ((pos(x.e) - pos(x.s)) * a) / len;
      for (const op of x.w.openings) {
        if (op.a1 <= 0 || op.a0 >= len) continue;
        if (o.openings === "edges") openPts.push(put(at(op.a0), line), put(at(op.a1), line));
        else openPts.push(put(at((op.a0 + op.a1) / 2), line));
      }
    }
    if (o.tees) {
      // walls inside square to this side, an end on one of its walls
      for (const x of lw) {
        if (exterior.includes(x)) continue;
        const d = { x: x.e.x - x.s.x, y: x.e.y - x.s.y };
        const len = Math.hypot(d.x, d.y);
        if (!(len > 0) || Math.abs(across ? d.x : d.y) > len * 1e-3 || !inside({ x: (x.s.x + x.e.x) / 2, y: (x.s.y + x.e.y) / 2 })) continue;
        const meets = along.find((a) => [x.s, x.e].some((p) => a.f.length >= 3 && inPolygon(p, a.f, ON)));
        if (!meets) continue;
        const line = faceOf(meets);
        if (o.to === "faces") {
          const ps = x.f.map(pos);
          openPts.push(put(Math.min(...ps), line), put(Math.max(...ps), line));
        } else openPts.push(put(pos(x.s), line));
      }
    }
    const rows: { kind: ChainKind; pts: Pt[] }[] = [];
    const corners = settle(wallPts, pos, out, across);
    if (corners.length < 2) continue;
    const ends = [corners[0], corners[corners.length - 1]];
    if (openPts.length) rows.push({ kind: "openings", pts: settle([...wallPts, ...openPts], pos, out, across) });
    rows.push({ kind: "walls", pts: corners });
    rows.push({ kind: "overall", pts: ends });
    const offset: Record<ChainKind, number> = o.offsets;
    for (let i = 0; i < rows.length; i++) {
      const { kind } = rows[i];
      // one that says no more than the next out is left out
      const next = rows[i + 1];
      if (next && next.pts.length === rows[i].pts.length) continue;
      const { pts, small } = smallSpans(rows[i].pts, pos, o);
      if (pts.length < 2) continue;
      const line = far + out * offset[kind];
      chains.push({ side, kind, points: pts.map(world), at: world(put(pos(pts[0]), line)), u: across ? X : Y, small });
    }
  }
  return chains;
}

/** Whether `p` lies in `poly` or within `tol` of its edges. */
function inPolygon(p: Pt, poly: readonly Pt[], tol: number): boolean {
  let hit = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (toSegment(p, a, b) <= tol) return true;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) hit = !hit;
  }
  return hit;
}

/** The points in order along the side, one for each place (the one furthest out, so its witness line is shortest). */
function settle(pts: readonly Pt[], pos: (p: Pt) => number, out: number, across: boolean): Pt[] {
  const sorted = [...pts].sort((a, b) => pos(a) - pos(b));
  const kept: Pt[] = [];
  for (const p of sorted) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(pos(p) - pos(last)) <= SAME) {
      const reach = (q: Pt): number => out * (across ? q.y : q.x);
      if (reach(p) > reach(last)) kept[kept.length - 1] = p;
    } else kept.push(p);
  }
  return kept;
}

/** The chain's small spans: dropped (a point at the far end of one, the last one's near end), or marked. */
function smallSpans(pts: readonly Pt[], pos: (p: Pt) => number, o: ExteriorOptions): { pts: Pt[]; small: boolean[] } {
  if (!(o.small > 0)) return { pts: [...pts], small: pts.slice(1).map(() => false) };
  if (o.smallMode === "red") return { pts: [...pts], small: pts.slice(1).map((p, i) => pos(p) - pos(pts[i]) < o.small) };
  const kept = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pos(pts[i]) - pos(kept[kept.length - 1]) >= o.small) kept.push(pts[i]);
    else if (i === pts.length - 1 && kept.length > 1) kept[kept.length - 1] = pts[i];
  }
  return { pts: kept, small: kept.slice(1).map(() => false) };
}
