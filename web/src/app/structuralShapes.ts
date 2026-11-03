// What Detailing's Bulb Flat and Shaft Break tools (tools/structural.ts) draw, as plain geometry: a
// hot-rolled bulb flat's section from EN 10067's sizes, and a round shaft's conventional break, an
// S-curve over a loop, solid or hollow, once or at both ends of a shortened length. Kept apart from
// the tools so it runs without the page.

import type { Pt } from "../core/index.ts";

/**
 * A bulb flat's size, mm, named as Corus and Vectorworks name them: `b` the width (the web's height
 * as drawn), `t` the web's thickness, `c` the bulb height (how far it stands out past the web), `d`
 * the bulb width (how far down the web its underside meets it), `r` the bulb radius round its tip
 * and its root, and `r1` the fillet radius rounding the square corners.
 */
export interface BulbFlat {
  readonly id: string;
  readonly b: number;
  readonly t: number;
  readonly c: number;
  readonly d: number;
  readonly r: number;
  readonly r1: number;
}

// Corus Special Profiles' "Bulb flats" (to BS EN 10067:1997): each width's bulb height, width and
// radius, then the thicknesses it is rolled in.
const ROWS: readonly (readonly [b: number, c: number, d: number, r: number, thicknesses: readonly number[]])[] = [
  [120, 17, 17.7, 5, [6, 7, 8]],
  [140, 19, 19.7, 5.5, [6.5, 7, 8, 10]],
  [160, 22, 22.2, 6, [7, 8, 9, 11.5]],
  [180, 25, 25.5, 7, [8, 9, 10, 11.5]],
  [200, 28, 28.8, 8, [8.5, 9, 10, 11, 12]],
  [220, 31, 32.1, 9, [9, 10, 11, 12]],
  [240, 34, 35.4, 10, [9.5, 10, 11, 12]],
  [260, 37, 38.7, 11, [10, 11, 12]],
  [280, 40, 42, 12, [10.5, 11, 12, 13]],
  [300, 43, 45.3, 13, [11, 12, 13]],
  [320, 46, 48.6, 14, [11.5, 12, 13, 14]],
  [340, 49, 52, 15, [12, 13, 14, 15]],
  [370, 53.5, 56.9, 16.5, [12.5, 13, 14, 15, 16]],
  [400, 58, 61.9, 18, [13, 14, 15, 16]],
  [430, 62.5, 66.8, 19.5, [14, 15, 17, 20]],
];

/** EN 10067's largest radius for a bulb flat's square corners, by its thickness. */
export function cornerRadius(t: number): number {
  return t <= 5 ? 1.5 : t <= 9 ? 2 : t <= 13 ? 3 : 4;
}

export const BULB_FLATS: readonly BulbFlat[] = ROWS.flatMap(([b, c, d, r, ts]) => ts.map((t) => ({ id: `HP ${b} x ${t}`, b, t, c, d, r, r1: cornerRadius(t) })));

/** points along each quarter turn of a rounded corner */
const CORNER_STEPS = 8;

/** Points along the arc round `c` of radius `r` from `from` to `to` radians, ends included. */
function arc(c: Pt, r: number, from: number, to: number): Pt[] {
  const n = Math.max(2, Math.ceil((Math.abs(to - from) / (Math.PI / 2)) * CORNER_STEPS));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/**
 * The angle the bulb's underside rises at from the web, radians: the line that meets the web the
 * bulb width down from the top and touches the tip's circle. Every EN 10067 size comes out at 30°.
 * NaN when no such line exists.
 */
export function bulbAngle(s: BulbFlat): number {
  // the underside through (t, b − d) touching the circle round (t + c − r, b − r):
  // (d − r)·cos θ − (c − r)·sin θ = r
  const along = s.d - s.r;
  const out = s.c - s.r;
  return Math.acos(s.r / Math.hypot(along, out)) - Math.atan2(out, along);
}

/** Why a bulb flat's size doesn't make one, or null when it does. */
export function bulbFlatProblem(s: BulbFlat): string | null {
  const { b, t, c, d, r, r1 } = s;
  if (!(b > 0 && t > 0 && c > 0 && d > 0)) return "the width, thickness, bulb height and bulb width must be more than 0";
  if (!(r > 0 && r1 >= 0)) return "the bulb radius must be more than 0 and the fillet radius at least 0";
  if (!(r1 <= t / 2)) return "the fillet radius must be at most half the thickness";
  if (!(c > r && d > 2 * r)) return "the bulb height must be more than the bulb radius and the bulb width more than twice it";
  const angle = bulbAngle(s);
  if (!(angle > 0 && angle < Math.PI / 2)) return "the bulb's underside must rise from the web: make the bulb width larger for its height";
  // the root fillet must clear the bottom corner and meet the underside before the tip's arc does
  const root = b - d - (r * (1 - Math.sin(angle))) / Math.cos(angle);
  if (!(root > r1)) return "the bulb width must leave some of the web below the bulb";
  if (!(c > 2 * r * (1 - Math.sin(angle)))) return "the bulb height is too small for its radius";
  return null;
}

/**
 * A bulb flat's section, anticlockwise, standing on the bottom of its web with the origin at the
 * bottom's middle and the bulb at the top to the right: the square corners rounded to the fillet
 * radius, the bulb's tip and the foot of its underside to the bulb radius. Null when the size
 * doesn't make one.
 */
export function bulbFlatOutline(s: BulbFlat): Pt[] | null {
  if (bulbFlatProblem(s)) return null;
  const { b, t, c, d, r, r1 } = s;
  const angle = bulbAngle(s);
  // the fillet's centre in the corner the web and the underside make
  const q = { x: t + r, y: b - d - (r * (1 - Math.sin(angle))) / Math.cos(angle) };
  const tip = { x: t + c - r, y: b - r };
  const pts = [
    ...arc({ x: r1, y: r1 }, r1, Math.PI, 1.5 * Math.PI),
    ...arc({ x: t - r1, y: r1 }, r1, 1.5 * Math.PI, 2 * Math.PI),
    // the fillet turns from the web up onto the underside, which runs to the tip's circle
    ...arc(q, r, Math.PI, Math.PI / 2 + angle),
    ...arc(tip, r, angle - Math.PI / 2, Math.PI / 2),
    ...arc({ x: r1, y: b - r1 }, r1, Math.PI / 2, Math.PI),
  ];
  // arcs meet end to end, and a fillet radius of 0 leaves a corner's arc all one point
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 1e-9).map((p) => ({ x: p.x - t / 2, y: p.y }));
}

export type ShaftBreakKind = "solid" | "hollow";

/** A shaft break's size, mm. */
export interface ShaftBreak {
  readonly diameter: number;
  /** how wide the break's loop and its S stand across the cut */
  readonly width: number;
  readonly kind: ShaftBreakKind;
  /** a hollow shaft's wall */
  readonly wall: number;
}

/** points along each curve */
const CURVE_STEPS = 24;

/** A cubic Bézier's points from `a` to `d`. */
function bezier(a: Pt, b: Pt, c: Pt, d: Pt): Pt[] {
  return Array.from({ length: CURVE_STEPS + 1 }, (_, i) => {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    const k0 = u * u * u;
    const k1 = 3 * u * u * t;
    const k2 = 3 * u * t * t;
    const k3 = t * t * t;
    return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y };
  });
}

/** Why a shaft break's size doesn't make one, or null when it does. */
export function shaftBreakProblem(s: ShaftBreak): string | null {
  if (!(s.diameter > 0)) return "the shaft diameter must be more than 0";
  if (!(s.width > 0)) return "the width of break must be more than 0";
  if (s.kind === "hollow" && !(s.wall > 0 && s.wall < s.diameter / 2)) return "a hollow shaft's wall must be thicker than 0 and thinner than half its diameter";
  return null;
}

/**
 * A shaft break across a shaft whose axis runs along x through the origin, the shaft's end it
 * breaks off toward +x, as Vectorworks' help pictures draw it: from the top an S-curve out toward +x
 * and back to the axis, flowing on into a drop-shaped loop down to the bottom, pointed at the axis
 * and round at the bottom; a hollow shaft's bore a smaller drop inside it, its bottom the wall
 * thickness above the outer one. The S and the loop stand out half the width of break either side.
 * Null when the size doesn't make one.
 */
export function shaftBreakLines(s: ShaftBreak): Pt[][] | null {
  if (shaftBreakProblem(s)) return null;
  const R = s.diameter / 2;
  // a Bézier whose two middle points stand out `a` bulges out three quarters of that
  const a = ((4 / 3) * s.width) / 2;
  const o = { x: 0, y: 0 };
  // the S leaves the axis along the loop's left side, so the two run on smoothly
  const drop = (depth: number, out: number): Pt[][] => [-out, out].map((x) => bezier(o, { x, y: -0.3 * depth }, { x, y: -depth }, { x: 0, y: -depth }));
  const lines = [bezier({ x: 0, y: R }, { x: a, y: R }, { x: a, y: 0.3 * R }, o), ...drop(R, a)];
  if (s.kind === "hollow") lines.push(...drop(R - s.wall, (a * (R - s.wall)) / R));
  return lines;
}
