// Rivets from Vectorworks' Fasteners tool set, in 2D: Large Rivet (inch, ASME B18.1.2), Small
// Rivet (inch, ASME B18.1.1), Rivet (DIN 660/661/662/674) and Tubular Rivet (DIN 7340). A solid
// rivet stands head up as VW's pictures show it, the head's bearing face on the origin (a
// countersunk head's top face, flush with the plate), its shank running down the length; a second
// head, if any, bears on the plate's far face. A tubular rivet lies along x, its head's bearing
// face on the origin. Sizes are mm.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";

/** A fastener drawing with its hidden (dashed) lines. */
export type FastenerDrawing = HoleDrawing & { readonly hidden: Pt[][] };
type Drawing = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: HoleDrawing["arcs"][number][]; hidden: Pt[][] };

const INCH = 25.4;
const ARC_STEPS = 16;
const empty = (): Drawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });
const rad = (deg: number): number => (deg * Math.PI) / 180;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function arc(c: Pt, r: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

export type HeadType =
  | "button"
  | "highbutton"
  | "cone"
  | "pan"
  | "smallpan"
  | "flat"
  | "truss"
  | "countersunk"
  | "oval"
  | "round"
  | "flatround"
  | "mushroom";

/** A head's sizes: across, high (a countersunk head's cone below the bearing face), and what its shape needs. */
export interface Head {
  readonly type: HeadType;
  readonly across: number;
  readonly height: number;
  /** a dome's radius (button, round, flat round, truss, mushroom; the acorn's sides; an oval head's crown) */
  readonly radius?: number;
  /** the flat top across (cone, pan) */
  readonly top?: number;
  /** the acorn's top radius, a small pan head's corner radius */
  readonly small?: number;
  /** a mushroom head's dome rise, an oval head's crown rise */
  readonly rise?: number;
}

const countersunk = (h: Head): boolean => h.type === "countersunk" || h.type === "oval";

/** A large rivet's head (ASME B18.1.2) on a shank `d` across, from the standard's proportions. */
export function largeHead(type: HeadType, d: number): Head {
  const D = d / INCH;
  const inch = (n: number): number => n * INCH;
  switch (type) {
    case "highbutton":
      return { type, across: inch(1.5 * D + 0.031), height: inch(0.75 * D + 0.125), radius: inch(0.75 * D + 0.281), small: inch(Math.max(0.75 * D - 0.281, 0.02)) };
    case "cone":
      return { type, across: 1.75 * d, height: 0.875 * d, top: 0.938 * d };
    case "pan":
      return { type, across: 1.6 * d, height: 0.7 * d, top: d };
    case "countersunk":
    case "oval": {
      const across = 1.81 * d;
      const height = (across - d) / 2 / Math.tan(rad(39));
      return type === "oval" ? { type, across, height, radius: 2.25 * d, rise: 2.25 * d - Math.sqrt((2.25 * d) ** 2 - (across / 2) ** 2) } : { type, across, height };
    }
    default:
      return { type: "button", across: 1.75 * d, height: 0.75 * d, radius: 0.885 * d };
  }
}

/** A small rivet's head (ASME B18.1.1) on a shank `d` across, from the standard's tables' proportions. */
export function smallHead(type: HeadType, d: number): Head {
  switch (type) {
    case "flat":
      return { type, across: 2 * d, height: 0.33 * d };
    case "smallpan":
      return { type, across: 1.72 * d, height: 0.57 * d, radius: 3.4 * d, small: 0.31 * d };
    case "truss":
      return { type, across: 2.3 * d, height: 0.33 * d, radius: 2.5 * d };
    case "countersunk":
      return { type, across: 1.81 * d, height: (1.81 * d - d) / 2 };
    default:
      return { type: "button", across: 1.8 * d, height: 0.75 * d, radius: 0.885 * d };
  }
}

/** DIN 660 round, 661 countersunk (75°), 662 mushroom and 674 flat round heads: d, dk, k (and r1, w), mm. */
const DIN_660: readonly (readonly [number, number, number])[] = [
  [1, 1.8, 0.6],
  [1.2, 2.1, 0.7],
  [1.4, 2.4, 0.8],
  [1.6, 2.8, 1],
  [2, 3.5, 1.2],
  [2.5, 4.4, 1.5],
  [3, 5.2, 1.8],
  [3.5, 6.2, 2.1],
  [4, 7, 2.4],
  [5, 8.8, 3],
  [6, 10.5, 3.6],
  [7, 12.2, 4.2],
  [8, 14, 4.8],
];
const DIN_661: readonly (readonly [number, number, number])[] = [
  [1, 1.8, 0.5],
  [1.2, 2.1, 0.6],
  [1.4, 2.4, 0.7],
  [1.6, 2.8, 0.8],
  [2, 3.5, 1],
  [2.5, 4.4, 1.2],
  [3, 5.2, 1.4],
  [3.5, 6.2, 1.8],
  [4, 7, 2],
  [5, 8.8, 2.5],
  [6, 10.5, 3],
  [7, 12.2, 3.5],
  [8, 14, 4],
];
const DIN_662: readonly (readonly [number, number, number, number, number])[] = [
  [1.6, 3.2, 0.9, 0.6, 2.8],
  [2, 4, 1, 0.7, 3.3],
  [2.5, 5, 1.2, 0.8, 4.2],
  [3, 6, 1.5, 1, 5],
  [3.5, 7, 1.8, 1.2, 6],
  [4, 8, 2.1, 1.4, 6.5],
  [5, 10, 2.5, 1.7, 8.2],
  [6, 12, 3, 2, 10],
];
const DIN_674: readonly (readonly [number, number, number, number])[] = [
  [1.4, 3.2, 0.82, 2.8],
  [1.6, 3.6, 0.92, 3],
  [2, 4.5, 1.12, 3.6],
  [2.5, 5.6, 1.42, 4.2],
  [3, 6.8, 1.62, 5.4],
  [3.5, 7.8, 1.92, 6.1],
  [4, 9, 2.12, 7.1],
  [5, 11.2, 2.62, 8.8],
  [6, 13.5, 3.15, 10.7],
];

/** The DIN rivets' diameters, mm. */
export const DIN_RIVET_SIZES: readonly number[] = DIN_660.map(([d]) => d);

/** A DIN rivet's head on a shank `d` across, or null when its standard has no such size. */
export function dinHead(type: HeadType, d: number): Head | null {
  const at = <T extends readonly number[]>(rows: readonly T[]): T | undefined => rows.find((r) => r[0] === d);
  if (type === "countersunk") {
    const r = at(DIN_661);
    return r ? { type, across: r[1], height: r[2] } : null;
  }
  if (type === "mushroom") {
    const r = at(DIN_662);
    return r ? { type, across: r[1], height: r[2], rise: r[3], radius: r[4] } : null;
  }
  if (type === "flatround") {
    const r = at(DIN_674);
    return r ? { type, across: r[1], height: r[2], radius: r[3] } : null;
  }
  const r = at(DIN_660);
  return r ? { type: "round", across: r[1], height: r[2] } : null;
}

/** The DIN standard each head comes from and the diameters it covers. */
export const DIN_HEAD_STANDARD: Record<"round" | "flatround" | "mushroom" | "countersunk", { readonly name: string; readonly from: number; readonly to: number }> = {
  round: { name: "DIN 660", from: 1, to: 8 },
  flatround: { name: "DIN 674", from: 1.4, to: 6 },
  mushroom: { name: "DIN 662", from: 1.6, to: 6 },
  countersunk: { name: "DIN 661", from: 1, to: 8 },
};

/** A line across a head at height `y`, `half` either side of the axis. */
type Across = { readonly y: number; readonly half: number };

/**
 * A head's right half, from its top on the axis out and down to where it meets the shank, with
 * the bearing face at y = 0 (a countersunk head's cone below it), and the lines across it.
 */
function headProfile(h: Head, d: number): { pts: Pt[]; lines: Across[] } {
  const R = h.across / 2;
  const r = d / 2;
  const k = h.height;
  const lines: Across[] = [];
  let pts: Pt[];
  switch (h.type) {
    case "countersunk":
      pts = [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: r, y: -k }];
      break;
    case "oval":
      pts = [...dome(h.radius!, h.rise!, R), { x: r, y: -k }];
      lines.push({ y: 0, half: R });
      break;
    case "cone":
    case "pan":
      pts = [{ x: 0, y: k }, { x: h.top! / 2, y: k }, { x: R, y: 0 }];
      break;
    case "flat": {
      // its rim rounded through the head's height
      const c = { x: R - k / 2, y: k / 2 };
      pts = [{ x: 0, y: k }, ...arc(c, k / 2, Math.PI / 2, -Math.PI / 2, 8)];
      break;
    }
    case "mushroom":
      pts = dome(h.radius!, k, R);
      lines.push({ y: k - h.rise!, half: R });
      break;
    case "highbutton":
      pts = acorn(R, k, h.radius!, h.small!);
      break;
    case "smallpan":
      pts = pan(R, k, h.radius!, h.small!);
      break;
    case "round":
      pts = dome((R * R + k * k) / (2 * k), k, R);
      break;
    case "truss": {
      // the low dome's band shows as a line where it meets it
      pts = dome(h.radius!, k, R);
      const s = Math.max(h.radius!, R);
      const rim = k - s + Math.sqrt(s * s - R * R);
      if (rim > 1e-9) lines.push({ y: rim, half: R });
      break;
    }
    default:
      // button and flat round: a dome of the head's radius, banded at the rim where it falls short
      pts = dome(h.radius ?? (R * R + k * k) / (2 * k), k, R);
  }
  if (!countersunk(h)) pts.push({ x: r, y: 0 });
  return { pts, lines };
}

/** A cap of `radius` whose top is at `top`, out to the rim `R` (down to y = 0 as a band if it reaches the rim above it), or to y = 0 if it meets that first. */
export function dome(radius: number, top: number, R: number): Pt[] {
  const s = Math.max(radius, R);
  const c = { x: 0, y: top - s };
  const rim = c.y + Math.sqrt(s * s - R * R);
  // the cap reaching the bearing face inside the rim ends there
  if (rim < 0) return arc(c, s, Math.PI / 2, Math.atan2(-c.y, Math.sqrt(s * s - c.y * c.y)));
  const out = arc(c, s, Math.PI / 2, Math.PI / 2 - Math.asin(R / s));
  if (rim > 1e-9) out.push({ x: R, y: 0 });
  return out;
}

/** The high button (acorn) head, and an acorn nut's crown: a small top round, its sides arcs of the larger radius down to the rim. */
export function acorn(R: number, k: number, big: number, small: number): Pt[] {
  const top = { x: 0, y: k - small };
  const foot = { x: R, y: 0 };
  const side = circleMeeting(foot, big, top, big - small);
  if (!side) return dome((R * R + k * k) / (2 * k), k, R);
  const a = Math.atan2(top.y - side.y, top.x - side.x);
  return [...arc(top, small, Math.PI / 2, a, 6), ...arc(side, big, a, Math.atan2(foot.y - side.y, foot.x - side.x), 10)];
}

/** The small pan head: a flat dome of the large radius rounding through the corner radius onto a side drafting in from the rim. */
function pan(R: number, k: number, big: number, corner: number): Pt[] {
  const top = { x: 0, y: k - big };
  // the corner's centre at 0.4 of the head's height, on the circle that keeps it inside the dome
  const cy = 0.4 * k;
  const cx = Math.sqrt(Math.max(0, (big - corner) ** 2 - (cy - top.y) ** 2));
  const cc = { x: Math.min(cx, R - corner), y: cy };
  const a = Math.atan2(cc.y - top.y, cc.x - top.x);
  // where a line from the rim's foot touches the corner
  const to = Math.hypot(R - cc.x, -cc.y);
  const phi = Math.atan2(-cc.y, R - cc.x);
  const touch = to > corner ? phi + Math.acos(corner / to) : 0;
  return [...arc(top, big, Math.PI / 2, a, 8), ...arc(cc, corner, a, touch, 6), { x: R, y: 0 }];
}

/** The centre of a circle of radius `ra` through `a` that touches, inside, a circle of radius `rb` about `b`; the one nearer the axis. */
function circleMeeting(a: Pt, ra: number, b: Pt, rb: number): Pt | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist > ra + rb || dist < Math.abs(ra - rb) || dist === 0) return null;
  const along = (ra * ra - rb * rb + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, ra * ra - along * along));
  const mx = a.x + (along * dx) / dist;
  const my = a.y + (along * dy) / dist;
  const one = { x: mx + (h * dy) / dist, y: my - (h * dx) / dist };
  const two = { x: mx - (h * dy) / dist, y: my + (h * dx) / dist };
  return one.x < two.x ? one : two;
}

export type RivetView = "front" | "top";

export interface Rivet {
  readonly diameter: number;
  /** between the plates' outer faces: under a protruding head, or overall from a countersunk head's top */
  readonly length: number;
  readonly head: Head;
  readonly second: Head | null;
}

/** Why the rivet can't be drawn, or null. */
export function rivetProblem(r: Rivet): string | null {
  if (!(r.length > 0)) return "the length must be more than 0";
  const sunk = (countersunk(r.head) ? r.head.height : 0) + (r.second && countersunk(r.second) ? r.second.height : 0);
  if (!(r.length > sunk)) return `the length must be more than its countersunk heads take (${round2(sunk)} mm)`;
  for (const h of [r.head, r.second]) if (h && !(h.across > r.diameter)) return "a head must be wider than the shank";
  return null;
}

/** A solid rivet from the front, head up, or from the top, looking down on its head. */
export function rivet(r: Rivet, view: RivetView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const O = { x: 0, y: 0 };
  if (view === "top") {
    d.circles.push({ center: O, radius: r.head.across / 2 });
    if (r.head.top) d.circles.push({ center: O, radius: r.head.top / 2 });
    if (beyond !== null) {
      const R = r.head.across / 2 + beyond;
      d.lines.push([{ x: -R, y: 0 }, { x: R, y: 0 }], [{ x: 0, y: -R }, { x: 0, y: R }]);
    }
    return d;
  }
  const first = headProfile(r.head, r.diameter);
  const right = [...first.pts];
  const across = (l: Across, at: (y: number) => number): Pt[] => [{ x: -l.half, y: at(l.y) }, { x: l.half, y: at(l.y) }];
  for (const l of first.lines) d.lines.push(across(l, (y) => y));
  let bottom = -r.length;
  if (r.second) {
    const second = headProfile(r.second, r.diameter);
    // the far head mirrored about the far face
    right.push(...second.pts.slice().reverse().map((p) => ({ x: p.x, y: -r.length - p.y })));
    for (const l of second.lines) d.lines.push(across(l, (y) => -r.length - y));
    bottom = -r.length - (countersunk(r.second) ? 0 : r.second.height);
  } else {
    right.push({ x: r.diameter / 2, y: -r.length }, { x: 0, y: -r.length });
  }
  const left = right.slice(1, -1).reverse().map((p) => ({ x: -p.x, y: p.y }));
  d.outlines.push([...right, ...left]);
  if (beyond !== null) {
    const top = Math.max(...right.map((p) => p.y));
    d.lines.push([{ x: 0, y: top + beyond }, { x: 0, y: bottom - beyond }]);
  }
  return d;
}

// ---- tubular rivets ----------------------------------------------------------------------

/** DIN 7340 tubular rivets made from tube: d1 (outside), d2 (flange), s (wall), k (flange), mm. */
export const TUBULAR_DIN: readonly { readonly id: string; readonly outside: number; readonly flange: number; readonly wall: number; readonly height: number }[] = [
  [1, 1.6, 0.2, 0.25],
  [1.2, 2, 0.2, 0.3],
  [1.5, 2.5, 0.2, 0.35],
  [1.5, 2.5, 0.25, 0.4],
  [2, 3.2, 0.2, 0.4],
  [2, 3.2, 0.3, 0.45],
  [2.5, 4, 0.25, 0.4],
  [2.5, 4, 0.3, 0.5],
  [2.5, 4, 0.4, 0.6],
  [3, 4.5, 0.25, 0.5],
  [3, 4.5, 0.3, 0.5],
  [3, 4.5, 0.5, 0.6],
  [4, 6, 0.3, 0.65],
  [4, 6, 0.4, 0.7],
  [4, 6, 0.5, 0.8],
  [5, 7.5, 0.3, 0.75],
  [5, 7.5, 0.5, 0.9],
  [5, 7.5, 0.75, 1],
  [6, 9, 0.4, 0.95],
  [6, 9, 0.5, 1],
  [6, 9, 0.75, 1.1],
  [6, 9, 1, 1.3],
  [8, 12, 0.4, 1.2],
  [8, 12, 0.5, 1.3],
  [8, 12, 0.75, 1.4],
  [8, 12, 1, 1.5],
  [10, 15, 0.5, 1.5],
  [10, 15, 0.75, 1.6],
  [10, 15, 1, 1.7],
].map(([outside, flange, wall, height]) => ({ id: `${outside}x${wall}`, outside, flange, wall, height }));

export type TubularForm = "a" | "b";
export type TubularView = "side" | "top";

export interface TubularRivet {
  readonly size: (typeof TUBULAR_DIN)[number];
  /** the tube's length under the head before it's set */
  readonly length: number;
  readonly form: TubularForm;
  readonly uncompressed: boolean;
}

/** How much of the tube setting its end into a flange like the head takes: the flange's volume as tube (Rodeo's reading). */
export function setAllowance(s: TubularRivet["size"]): number {
  return ((s.flange ** 2 - s.outside ** 2) * s.height) / (4 * s.outside * s.wall);
}

export function tubularProblem(t: TubularRivet): string | null {
  const take = setAllowance(t.size);
  return t.length > take ? null : `the length must be more than setting its end takes (${round2(take)} mm)`;
}

/** A tubular rivet set, from the side (its head at the left, the tube's unset length dashed past the set end) or from the top. */
export function tubularRivet(t: TubularRivet, view: TubularView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const s = t.size;
  const R = s.flange / 2;
  const r = s.outside / 2;
  const k = s.height;
  if (view === "top") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: R }, { center: { x: 0, y: 0 }, radius: r - s.wall });
    if (beyond !== null) d.lines.push([{ x: -R - beyond, y: 0 }, { x: R + beyond, y: 0 }], [{ x: 0, y: -R - beyond }, { x: 0, y: R + beyond }]);
    return d;
  }
  const grip = t.length - setAllowance(s);
  // form B's flanges are rounded on their outer faces
  const round = t.form === "b" ? Math.min(k * 0.9, R - r) : 0;
  const flange = (x0: number, outward: 1 | -1): Pt[] => {
    // the upper half of a flange from its inner face at x0 out to its outer face
    const x1 = x0 + outward * k;
    if (round <= 0) return [{ x: x0, y: R }, { x: x1, y: R }, { x: x1, y: 0 }];
    const c = { x: x1 - outward * round, y: R - round };
    const pts = outward === -1 ? arc(c, round, Math.PI / 2, Math.PI, 6) : arc(c, round, Math.PI / 2, 0, 6);
    return [{ x: x0, y: R }, ...pts, { x: x1, y: 0 }];
  };
  const head = flange(0, -1).reverse();
  const set = flange(grip, 1);
  const top = [...head, { x: 0, y: r }, { x: grip, y: r }, ...set];
  d.outlines.push([...top, ...top.slice(1, -1).reverse().map((p) => ({ x: p.x, y: -p.y }))]);
  const end = grip + k;
  if (t.uncompressed && t.length > end) {
    for (const y of [r, -r]) d.hidden.push([{ x: end, y }, { x: t.length, y }]);
    d.hidden.push([{ x: t.length, y: r }, { x: t.length, y: -r }]);
  }
  if (beyond !== null) d.lines.push([{ x: -k - beyond, y: 0 }, { x: Math.max(end, t.uncompressed ? t.length : end) + beyond, y: 0 }]);
  return d;
}
