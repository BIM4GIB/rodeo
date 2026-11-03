// What Site Planning's Roadway (Straight), Roadway (Curved), Roadway (Tee) and Roadway (Poly)
// draw in plan (tools/roads.ts), as plain geometry: the paving, its curbs, the edges without a curb, the joints
// where a section meets the next, and a curved section's or a tee's arc centres. Kept apart from
// the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { offsetPolyline } from "./geom.ts";

export interface RoadPlan {
  /** the paving, filled without a pen */
  readonly paving: Pt[];
  /** the curbs, outlined */
  readonly curbs: Pt[][];
  /** a ring road's curbs, filled without a pen (their edges are among `edges`) */
  readonly bands: Pt[][];
  /** paving edges without a curb */
  readonly edges: Pt[][];
  /** where the paving meets the next section (with Show Joints) */
  readonly joints: Pt[][];
  /** where a curved section's or a tee's arcs centre */
  readonly loci: Pt[];
}

/** degrees an arc's points step at most */
const ARC_STEP_DEG = 3;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Points round `c` at radius `r` from angle `a0` to `a1` (degrees), both ends included. */
function arc(c: Pt, r: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / ARC_STEP_DEG));
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = rad(a0 + ((a1 - a0) * k) / n);
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** The band between radii `r0` and `r1` round `c` from `a0` to `a1` degrees, as an outline. */
function sector(c: Pt, r0: number, r1: number, a0: number, a1: number): Pt[] {
  return [...arc(c, r1, a0, a1), ...arc(c, r0, a1, a0)];
}

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const seg = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

/**
 * A straight section `length` long from the origin along +x, its paving `paving` wide across the
 * x axis with a curb `curb` wide (0: none) outside each side, and its ends as joints.
 */
export function straightRoad(length: number, paving: number, curb: number, joints: boolean): RoadPlan | null {
  if (!(length > 0 && paving > 0 && curb >= 0)) return null;
  const h = paving / 2;
  const curbs = curb > 0 ? [box(0, h, length, h + curb), box(0, -h - curb, length, -h)] : [];
  const edges = curb > 0 ? [] : [seg(0, h, length, h), seg(0, -h, length, -h)];
  const ends = joints ? [seg(0, -h, 0, h), seg(length, -h, length, h)] : [];
  return { paving: box(0, -h, length, h), curbs, bands: [], edges, joints: ends, loci: [] };
}

/**
 * A curved section whose centre line leaves the origin along +x and turns `sweep` degrees about a
 * centre `radius` to its left (a negative sweep turns right), its paving `width` wide with a curb
 * outside each side. Null when the inner curb would pass the centre or the sweep isn't less than a
 * whole turn.
 */
export function curvedRoad(radius: number, width: number, curb: number, sweep: number, joints: boolean): RoadPlan | null {
  const turn = Math.abs(sweep);
  if (!(width > 0 && curb >= 0 && turn > 0 && turn < 360 && radius - width / 2 - curb > 0)) return null;
  const s = Math.sign(sweep);
  const c = { x: 0, y: s * radius };
  // angles round the centre: the start lies straight across from it
  const a0 = -s * 90;
  const a1 = a0 + sweep;
  const ri = radius - width / 2;
  const ro = radius + width / 2;
  const curbs = curb > 0 ? [sector(c, ro, ro + curb, a0, a1), sector(c, ri - curb, ri, a0, a1)] : [];
  const edges = curb > 0 ? [] : [arc(c, ro, a0, a1), arc(c, ri, a0, a1)];
  const ends = joints ? [a0, a1].map((a) => [arc(c, ri, a, a)[0], arc(c, ro, a, a)[0]]) : [];
  return { paving: sector(c, ri, ro, a0, a1), curbs, bands: [], edges, joints: ends, loci: [c] };
}

/**
 * A tee: a throat `throat` wide entering along +x from the origin (the middle of its open end),
 * turning out through fillets of `radius` either side into a road `gutter` wide running across it,
 * with a curb along the fillets and (with `gutterCurb`) along the road's far side. Null when the
 * curb is wider than the fillets' radius or a width isn't more than 0.
 */
export function teeRoad(radius: number, throat: number, gutter: number, curb: number, gutterCurb: boolean, joints: boolean): RoadPlan | null {
  if (!(radius > 0 && throat > 0 && gutter > 0 && curb >= 0 && curb < radius)) return null;
  const h = throat / 2;
  const left = { x: 0, y: h + radius };
  const right = { x: 0, y: -h - radius };
  const far = radius + gutter;
  const paving = [{ x: 0, y: -h }, ...arc(left, radius, -90, 0), { x: far, y: h + radius }, { x: far, y: -h - radius }, ...arc(right, radius, 0, 90)];
  const curbs: Pt[][] = [];
  const edges: Pt[][] = [];
  if (curb > 0) curbs.push(sector(left, radius - curb, radius, -90, 0), sector(right, radius - curb, radius, 0, 90));
  else edges.push(arc(left, radius, -90, 0), arc(right, radius, 0, 90));
  if (gutterCurb && curb > 0) curbs.push(box(far, -h - radius, far + curb, h + radius));
  else edges.push(seg(far, -h - radius, far, h + radius));
  const ends = joints ? [seg(0, -h, 0, h), seg(radius, h + radius, far, h + radius), seg(radius, -h - radius, far, -h - radius)] : [];
  return { paving, curbs, bands: [], edges, joints: ends, loci: [left, right] };
}

/** The band between two rings that run the same way round, as one outline: round `a`, across to `b` and back round it the other way. */
const keyhole = (a: Pt[], b: Pt[]): Pt[] => [...a, a[0], b[0], ...b.slice(1).reverse(), b[0]];

/**
 * A road along a path of straight runs (closed: a ring back to its start), its paving `paving`
 * wide centred on the path with a curb `curb` wide outside each side, mitred at the corners, and
 * an open path's ends as joints. Null when a width isn't more than 0 or the path turns too tightly
 * for them.
 */
export function polyRoad(path: readonly Pt[], closed: boolean, paving: number, curb: number, joints: boolean): RoadPlan | null {
  if (!(paving > 0 && curb >= 0) || path.length < (closed ? 3 : 2)) return null;
  const h = paving / 2;
  const left = offsetPolyline(path, closed, h);
  const right = offsetPolyline(path, closed, -h);
  const leftCurb = curb > 0 ? offsetPolyline(path, closed, h + curb) : left;
  const rightCurb = curb > 0 ? offsetPolyline(path, closed, -h - curb) : right;
  if (!left || !right || !leftCurb || !rightCurb) return null;
  if (closed) {
    const ring = (l: Pt[]): Pt[] => [...l, l[0]];
    return {
      paving: keyhole(left, right),
      curbs: [],
      bands: curb > 0 ? [keyhole(leftCurb, left), keyhole(right, rightCurb)] : [],
      edges: curb > 0 ? [left, leftCurb, right, rightCurb].map(ring) : [ring(left), ring(right)],
      joints: [],
      loci: [],
    };
  }
  const band = (a: Pt[], b: Pt[]): Pt[] => [...a, ...[...b].reverse()];
  return {
    paving: band(left, right),
    curbs: curb > 0 ? [band(leftCurb, left), band(right, rightCurb)] : [],
    bands: [],
    edges: curb > 0 ? [] : [left, right],
    joints: joints ? [[left[0], right[0]], [left.at(-1)!, right.at(-1)!]] : [],
    loci: [],
  };
}
