// Pins from Vectorworks' Fasteners tool set, in 2D: clevis pins (ASME B18.8.1 inch, ISO 2341
// metric, DIN 1444), cotter pins (ASME B18.8.1), dowel pins (ASME B18.8.2), parallel pins (DIN 7)
// and taper pins (ASME B18.8.2 inch, DIN 1 / ISO 2339). Side views put the pin's left end (a clevis
// pin's head, a cotter pin's eye, a taper pin's large end) at the origin with its axis running
// right; end views are centred on the axis. Sizes are mm; the inch tables are kept in inches and
// converted as they're read.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";

type Drawing = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: HoleDrawing["arcs"] };

const INCH = 25.4;
const ARC_STEPS = 16;
const empty = (): Drawing => ({ outlines: [], lines: [], circles: [], arcs: [] });
const rad = (deg: number): number => (deg * Math.PI) / 180;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Points round the arc about `c` of radius `r` from angle `a0` to `a1`, both ends included. */
function arc(c: Pt, r: number, a0: number, a1: number, steps = ARC_STEPS): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/** A closed outline from the upper half of a pin's profile, running left to right from the axis to the axis. */
function mirrored(top: readonly Pt[]): Pt[] {
  const below = top.slice(1, -1).reverse().map((p) => ({ x: p.x, y: -p.y }));
  return [...top, ...below];
}

/** A line straight across the pin at `x`, `r` each side of the axis. */
const across = (x: number, r: number): Pt[] => [{ x, y: -r }, { x, y: r }];

/** Centre lines: along the axis `beyond` past both ends, for a side view `length` long. */
function axis(d: Drawing, length: number, beyond: number | null): void {
  if (beyond !== null) d.lines.push([{ x: -beyond, y: 0 }, { x: length + beyond, y: 0 }]);
}

/** Centre lines crossing at the origin, `beyond` past a circle of radius `r`. */
function cross(d: Drawing, r: number, beyond: number | null, at: Pt = { x: 0, y: 0 }): void {
  if (beyond === null) return;
  d.lines.push([{ x: at.x - r - beyond, y: at.y }, { x: at.x + r + beyond, y: at.y }], [{ x: at.x, y: at.y - r - beyond }, { x: at.x, y: at.y + r + beyond }]);
}

/** A domed end's points on the profile's upper half: the sphere `s` across meeting a cylinder of radius `r` whose end is at `x`, bulging `dir` (−1 left, 1 right); and how far it bulges. */
function dome(x: number, r: number, s: number, dir: 1 | -1): { pts: Pt[]; rise: number } {
  const rise = s - Math.sqrt(Math.max(0, s * s - r * r));
  const theta = Math.asin(Math.min(1, r / s));
  const c = { x: x + dir * (rise - s), y: 0 };
  // left: from the axis tip up to the cylinder; right: from the cylinder down to the axis tip
  const pts = dir === -1 ? arc(c, s, Math.PI, Math.PI - theta) : arc(c, s, theta, 0);
  return { pts, rise };
}

// ---- clevis pins -------------------------------------------------------------------------

export type ClevisHead = "chamfered" | "rounded" | "headless";
export type ClevisView = "top" | "side" | "head" | "body";

export interface ClevisSize {
  readonly id: string;
  readonly label: string;
  readonly diameter: number;
  readonly head: number;
  readonly headHeight: number;
  /** the head's edge chamfer */
  readonly headChamfer: number;
  readonly hole: number;
  /** the hole's centre from the pin's end */
  readonly holeFromEnd: number;
  /** the end's chamfer: along the axis and in from the surface */
  readonly pointLength: number;
  readonly pointDepth: number;
  /** ASME's standard length under the head (inch only) */
  readonly standardLength: number | null;
}

/** ASME B18.8.1 clevis pins: basic diameter, head diameter and height (mid-tolerance), head chamfer, hole (mid), point diameter (mid), standard length G and end to hole centre J, inches. */
const ASME_CLEVIS: readonly (readonly [string, number, number, number, number, number, number, number, number])[] = [
  ["3/16", 0.188, 0.31, 0.06, 0.02, 0.0805, 0.145, 0.58, 0.09],
  ["1/4", 0.25, 0.37, 0.09, 0.03, 0.0805, 0.205, 0.77, 0.09],
  ["5/16", 0.312, 0.43, 0.09, 0.03, 0.1115, 0.255, 0.94, 0.12],
  ["3/8", 0.375, 0.5, 0.12, 0.03, 0.1115, 0.325, 1.06, 0.12],
  ["7/16", 0.438, 0.56, 0.15, 0.04, 0.1115, 0.385, 1.19, 0.12],
  ["1/2", 0.5, 0.62, 0.15, 0.04, 0.1435, 0.435, 1.36, 0.15],
  ["5/8", 0.625, 0.81, 0.2, 0.06, 0.1435, 0.555, 1.61, 0.15],
  ["3/4", 0.75, 0.93, 0.25, 0.07, 0.1745, 0.675, 1.91, 0.18],
  ["7/8", 0.875, 1.03, 0.31, 0.09, 0.1745, 0.795, 2.16, 0.18],
  ["1", 1, 1.18, 0.34, 0.1, 0.1745, 0.925, 2.41, 0.18],
];

export const CLEVIS_INCH: readonly ClevisSize[] = ASME_CLEVIS.map(([name, d, dk, k, e, hole, point, g, j]) => ({
  id: name,
  label: `${name} in`,
  diameter: d * INCH,
  head: dk * INCH,
  headHeight: k * INCH,
  headChamfer: e * INCH,
  hole: hole * INCH,
  holeFromEnd: j * INCH,
  pointLength: ((d - point) / 2) * INCH,
  pointDepth: ((d - point) / 2) * INCH,
  standardLength: g * INCH,
}));

/** ISO 2341 (and DIN EN 22341, after DIN 1444) clevis pins: d, dk, k, e (head chamfer), c (end chamfer, max), d1 (hole), le (end to hole centre, min), mm. */
const ISO_2341: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [3, 5, 1, 0.5, 1, 0.8, 1.6],
  [4, 6, 1, 0.5, 1, 1, 2.2],
  [5, 8, 1.6, 1, 2, 1.2, 2.9],
  [6, 10, 2, 1, 2, 1.6, 3.2],
  [8, 14, 3, 1, 2, 2, 3.5],
  [10, 18, 4, 1, 2, 3.2, 4.5],
  [12, 20, 4, 1.6, 3, 3.2, 5.5],
  [14, 22, 4, 1.6, 3, 4, 6],
  [16, 25, 4.5, 1.6, 3, 4, 6],
  [18, 28, 5, 1.6, 3, 5, 7],
  [20, 30, 5, 2, 4, 5, 8],
  [22, 33, 5, 2, 4, 5, 8],
  [24, 36, 6.3, 2, 4, 6.3, 9],
  [27, 40, 6.3, 2, 4, 6.3, 9],
  [30, 44, 8, 2, 4, 8, 10],
  [33, 47, 8, 2, 4, 8, 10],
  [36, 50, 8, 2, 4, 8, 10],
  [40, 55, 8, 2, 4, 8, 10],
  [45, 60, 9, 2, 4, 10, 12],
  [50, 66, 9, 3, 4, 10, 12],
  [55, 72, 11, 3, 6, 10, 14],
  [60, 78, 12, 3, 6, 10, 14],
  [70, 90, 13, 3, 6, 13, 16],
  [80, 100, 13, 3, 6, 13, 16],
  [90, 110, 13, 3, 6, 13, 16],
  [100, 120, 13, 3, 6, 13, 16],
];

export const CLEVIS_METRIC: readonly ClevisSize[] = ISO_2341.map(([d, dk, k, e, c, d1, le]) => {
  // the end's chamfer: half its greatest length, at 45°, no deeper than a tenth of the diameter
  const depth = Math.min(c / 2, d / 10);
  return { id: String(d), label: `${d} mm`, diameter: d, head: dk, headHeight: k, headChamfer: e, hole: d1, holeFromEnd: le, pointLength: depth, pointDepth: depth, standardLength: null };
});

/** ISO 4753-style preferred lengths that metric pins come in, mm. */
export const METRIC_LENGTHS: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 120, 140, 160, 180, 200];

/** The preferred length nearest `length` (within `min` to `max` when given). */
export function nearestLength(length: number, min = 0, max = Infinity): number {
  const options = METRIC_LENGTHS.filter((l) => l >= min - 1e-9 && l <= max + 1e-9);
  if (options.length === 0) return Math.min(Math.max(length, min), max);
  return options.reduce((best, l) => (Math.abs(l - length) < Math.abs(best - length) ? l : best));
}

export interface ClevisPin {
  readonly size: ClevisSize;
  /** under the head; a headless pin's overall length */
  readonly length: number;
  readonly head: ClevisHead;
  readonly holes: boolean;
}

/** Why the clevis pin can't be drawn, or null. */
export function clevisProblem(p: ClevisPin): string | null {
  const s = p.size;
  if (!(p.length > 0)) return "the length must be more than 0";
  const ends = p.head === "headless" ? 2 : 1;
  if (!(p.length > ends * s.pointLength)) return `the pin must be longer than its chamfer${ends > 1 ? "s" : ""} (${round2(ends * s.pointLength)} mm)`;
  if (p.holes) {
    const need = p.head === "headless" ? 2 * s.holeFromEnd + s.hole : s.holeFromEnd + s.hole / 2;
    if (!(p.length > need)) return `the pin must be longer than ${round2(need)} mm to take its split pin hole${ends > 1 ? "s" : ""}`;
  }
  return null;
}

/**
 * A clevis pin in `view`: from the top (looking down its split pin hole) or the side, its head at
 * the left; or end on, at its head or its body's end. `beyond` draws centre lines that far past it.
 */
export function clevisPin(p: ClevisPin, view: ClevisView, beyond: number | null): Drawing {
  const d = empty();
  const s = p.size;
  const r = s.diameter / 2;
  const headless = p.head === "headless";
  const R = headless ? r : s.head / 2;
  // how far in from the head's rim its chamfer or rounding reaches
  const rim = p.head === "chamfered" ? s.headChamfer : Math.min(s.headHeight, R - r);
  if (view === "head" || view === "body") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: R });
    if (headless) d.circles.push({ center: { x: 0, y: 0 }, radius: r - s.pointDepth });
    else if (view === "head") d.circles.push({ center: { x: 0, y: 0 }, radius: R - rim });
    else d.circles.push({ center: { x: 0, y: 0 }, radius: r }, { center: { x: 0, y: 0 }, radius: r - s.pointDepth });
    cross(d, R, beyond);
    return d;
  }
  const k = headless ? 0 : s.headHeight;
  const end = k + p.length;
  const top: Pt[] = [{ x: 0, y: 0 }];
  if (headless) top.push({ x: 0, y: r - s.pointDepth }, { x: s.pointLength, y: r });
  else if (p.head === "chamfered") top.push({ x: 0, y: R - rim }, { x: rim, y: R }, { x: k, y: R }, { x: k, y: r });
  else top.push(...arc({ x: rim, y: R - rim }, rim, Math.PI, Math.PI / 2), { x: k, y: R }, { x: k, y: r });
  top.push({ x: end - s.pointLength, y: r }, { x: end, y: r - s.pointDepth }, { x: end, y: 0 });
  d.outlines.push(mirrored(top));
  if (headless) d.lines.push(across(s.pointLength, r));
  else if (p.head === "chamfered") d.lines.push(across(rim, R));
  d.lines.push(across(end - s.pointLength, r));
  if (p.holes && view === "top") {
    const at = [end - s.holeFromEnd, ...(headless ? [s.holeFromEnd] : [])];
    for (const x of at) {
      d.circles.push({ center: { x, y: 0 }, radius: s.hole / 2 });
      if (beyond !== null) d.lines.push([{ x, y: -r - beyond }, { x, y: r + beyond }]);
    }
  }
  axis(d, end, beyond);
  return d;
}

// ---- cotter pins -------------------------------------------------------------------------

export type CotterType = "square" | "hammer";
export type CotterView = "front" | "left" | "right" | "top" | "bottom";

export interface CotterSize {
  readonly id: string;
  /** both legs together across, and the wire's width */
  readonly shank: number;
  readonly width: number;
  readonly eye: number;
  /** how much longer the extended prong is */
  readonly prong: number;
  readonly hole: number;
}

/** ASME B18.8.1 cotter pins: total shank diameter (mid), wire width (max), head diameter (min), extended prong (min), gage hole, inches. */
const ASME_COTTER: readonly (readonly [string, number, number, number, number, number])[] = [
  ["1/32", 0.03, 0.032, 0.06, 0.01, 0.047],
  ["3/64", 0.046, 0.048, 0.09, 0.02, 0.062],
  ["1/16", 0.058, 0.06, 0.12, 0.03, 0.078],
  ["5/64", 0.074, 0.076, 0.16, 0.04, 0.094],
  ["3/32", 0.088, 0.09, 0.19, 0.04, 0.109],
  ["7/64", 0.102, 0.104, 0.22, 0.05, 0.125],
  ["1/8", 0.118, 0.12, 0.25, 0.06, 0.141],
  ["9/64", 0.132, 0.134, 0.28, 0.06, 0.156],
  ["5/32", 0.148, 0.15, 0.31, 0.07, 0.172],
  ["3/16", 0.174, 0.176, 0.38, 0.09, 0.203],
  ["7/32", 0.2045, 0.207, 0.44, 0.1, 0.234],
  ["1/4", 0.2225, 0.225, 0.5, 0.11, 0.266],
  ["5/16", 0.2775, 0.28, 0.62, 0.14, 0.312],
  ["3/8", 0.332, 0.335, 0.75, 0.16, 0.375],
  ["7/16", 0.403, 0.406, 0.88, 0.2, 0.438],
  ["1/2", 0.47, 0.473, 1, 0.23, 0.5],
  ["5/8", 0.594, 0.598, 1.25, 0.3, 0.625],
  ["3/4", 0.719, 0.723, 1.5, 0.36, 0.75],
];

export const COTTER_INCH: readonly CotterSize[] = ASME_COTTER.map(([id, a, b, c, dp, hole]) => ({ id, shank: a * INCH, width: b * INCH, eye: c * INCH, prong: dp * INCH, hole: hole * INCH }));

export interface CotterPin {
  readonly type: CotterType;
  readonly size: CotterSize;
  /** under the eye to the shorter prong's end */
  readonly length: number;
  /** under the eye to where the prongs are bent */
  readonly grip: number;
  /** degrees the upper and lower prongs are bent away from each other */
  readonly bendTop: number;
  readonly bendBottom: number;
}

/** Why the cotter pin can't be drawn, or null. */
export function cotterProblem(p: CotterPin): string | null {
  if (!(p.length > 0)) return "the length must be more than 0";
  for (const a of [p.bendTop, p.bendBottom]) if (!(a >= 0 && a <= 180)) return "bend angles run from 0° to 180°";
  if ((p.bendTop > 0 || p.bendBottom > 0) && !(p.grip > 0 && p.grip < p.length)) return "the grip length must be more than 0 and shorter than the pin";
  return null;
}

/** The eye's length along the pin: Rodeo's proportion, twice the head's diameter. */
const eyeLength = (s: CotterSize): number => 2 * s.eye;

/**
 * A cotter pin in `view`: from the front (the eye's face, the legs one above the other, bent at
 * the grip length), from either end, or from above or below. The extended prong is the lower leg
 * of a square cut pin and the upper of a hammer lock, whose end is turned down.
 */
export function cotterPin(p: CotterPin, view: CotterView): Drawing {
  const d = empty();
  const s = p.size;
  const t = s.shank / 2;
  const xe = eyeLength(s);
  const hammer = p.type === "hammer";
  const upper = p.length + (hammer ? Math.max(s.prong, 2 * t) : 0);
  const lower = p.length + (hammer ? 0 : s.prong);
  if (view === "left") {
    // the eye's bend end on: the wire's width across, the eye's height up
    const h = s.eye / 2;
    const w = s.width / 2;
    d.outlines.push([...arc({ x: 0, y: h - w }, w, 0, Math.PI), ...arc({ x: 0, y: -h + w }, w, Math.PI, 2 * Math.PI)]);
    for (const y of [h - t, -h + t]) d.lines.push([{ x: -w, y }, { x: w, y }]);
    return d;
  }
  if (view === "right") {
    // the two half-round legs end on
    d.outlines.push(arc({ x: 0, y: 0 }, s.width / 2, 0, 2 * Math.PI, 2 * ARC_STEPS).slice(0, -1));
    d.lines.push([{ x: -s.width / 2, y: 0 }, { x: s.width / 2, y: 0 }]);
    return d;
  }
  if (view === "top" || view === "bottom") {
    // seen from above, the upper leg hides the lower until it ends; the eye's end is round
    const w = s.width / 2;
    const reach = (len: number, bend: number): number => (p.grip < len && bend > 0 ? xe + p.grip + (len - p.grip) * Math.cos(rad(bend)) : xe + len);
    const near = view === "top" ? reach(upper, p.bendTop) : reach(lower, p.bendBottom);
    const far = view === "top" ? reach(lower, p.bendBottom) : reach(upper, p.bendTop);
    const right = Math.max(near, far);
    d.outlines.push([...arc({ x: w, y: 0 }, w, Math.PI / 2, (3 * Math.PI) / 2), { x: right, y: -w }, { x: right, y: w }]);
    if (far > near + 1e-9) d.lines.push(across(near, w));
    return d;
  }
  // the front: the eye's outline, tangent from each leg's outer edge to its round end
  const ro = s.eye / 2;
  const o = { x: ro, y: 0 };
  const from = { x: xe, y: t };
  const dist = Math.hypot(o.x - from.x, o.y - from.y);
  const u = Math.atan2(o.y - from.y, o.x - from.x) - Math.asin(Math.min(1, ro / dist));
  const reachT = Math.sqrt(Math.max(0, dist * dist - ro * ro));
  const tu = { x: from.x + reachT * Math.cos(u), y: from.y + reachT * Math.sin(u) };
  const au = Math.atan2(tu.y, tu.x - o.x);
  // the eye's hole: the same outline moved in by the wire's thickness, closing on the legs' joint
  const ri = ro - t;
  const ti = { x: o.x + (ri * (tu.x - o.x)) / ro, y: (ri * tu.y) / ro };
  const q = { x: ti.x - (ti.y / Math.sin(u)) * Math.cos(u), y: 0 };
  d.outlines.push([q, ti, ...arc(o, ri, au, 2 * Math.PI - au).slice(1, -1), { x: ti.x, y: -ti.y }]);
  // the legs, each bent at the grip about its inner corner (a straight pin "bends" where the shorter ends)
  const bent = p.bendTop > 0 || p.bendBottom > 0;
  const g = bent ? p.grip : Math.min(upper, lower);
  const leg = (sign: 1 | -1, len: number, bend: number): { outer: Pt[]; inner: Pt[]; end: Pt[] } => {
    const a = sign * rad(bend);
    const pivot = { x: xe + g, y: sign * t };
    const at = (along: number, off: number): Pt => ({ x: pivot.x + along * Math.cos(a) - off * Math.sin(a), y: pivot.y + along * Math.sin(a) + off * Math.cos(a) });
    const rest = len - g;
    // the outer edge's corner turns round the pivot; the inner edge's sweeps a quarter of the wire round it;
    // `end` runs round the prong's end from its outer corner to its inner one
    const inner = bend > 0 ? arc(pivot, t, -sign * (Math.PI / 2), -sign * (Math.PI / 2) + a, 8) : [{ x: pivot.x, y: 0 }];
    let end = [at(rest, 0), at(rest, -sign * t)];
    if (hammer && sign === 1) {
      // the hammer lock's prong turns down across the joint
      const c = at(rest, -t);
      end = [...arc(c, t, a + Math.PI / 2, a, 6), at(rest + t, -2 * t), at(rest, -2 * t), at(rest, -t)];
    }
    return { outer: [pivot, at(rest, 0)], inner: [...inner, at(rest, -sign * t)], end };
  };
  const up = leg(1, upper, p.bendTop);
  const down = leg(-1, lower, p.bendBottom);
  const outline: Pt[] = [
    ...up.end.slice(0, 1),
    ...up.outer.slice().reverse(),
    from,
    tu,
    ...arc(o, ro, au, 2 * Math.PI - au).slice(1, -1),
    { x: tu.x, y: -tu.y },
    { x: xe, y: -t },
    ...down.outer,
    ...down.end.slice(1),
    ...down.inner.slice().reverse(),
    ...up.inner,
    // round the upper prong's end from its inner corner back to the outer one the outline began at
    ...up.end.slice(1, -1).reverse(),
  ];
  d.outlines.push(outline);
  d.lines.push([q, { x: xe + g, y: 0 }]);
  return d;
}

// ---- dowel, parallel and taper pins ------------------------------------------------------

export type DowelType = "machine" | "production" | "unhardened";
export type PinSideView = "side" | "left" | "right";

export interface DowelSize {
  readonly id: string;
  readonly diameter: number;
  readonly point: number;
  readonly crownHeight: number;
}

/** ASME B18.8.2 hardened ground machine dowel pins: nominal diameter, point diameter (mid), crown height (max), inches. */
const ASME_DOWEL: readonly (readonly [string, number, number, number])[] = [
  ["1/16", 0.0625, 0.053, 0.02],
  ["5/64", 0.0781, 0.069, 0.026],
  ["3/32", 0.0938, 0.084, 0.031],
  ["1/8", 0.125, 0.115, 0.041],
  ["5/32", 0.1562, 0.145, 0.052],
  ["3/16", 0.1875, 0.175, 0.062],
  ["1/4", 0.25, 0.235, 0.083],
  ["5/16", 0.3125, 0.296, 0.104],
  ["3/8", 0.375, 0.3575, 0.125],
  ["7/16", 0.4375, 0.4165, 0.146],
  ["1/2", 0.5, 0.4785, 0.167],
  ["5/8", 0.625, 0.603, 0.208],
  ["3/4", 0.75, 0.725, 0.25],
  ["7/8", 0.875, 0.85, 0.293],
  ["1", 1, 0.97, 0.333],
];

export const DOWEL_INCH: readonly DowelSize[] = ASME_DOWEL.map(([id, d, point, crown]) => ({ id, diameter: d * INCH, point: point * INCH, crownHeight: crown * INCH }));

export interface DowelPin {
  readonly type: DowelType;
  readonly size: DowelSize;
  readonly length: number;
}

/** A dowel pin's ends: the left's dome (machine pins) or corner, the right's chamfer, along the axis and in from the surface. */
function dowelEnds(p: DowelPin): { crown: number; corner: number; chamferLength: number; chamferDepth: number } {
  const r = p.size.diameter / 2;
  if (p.type === "machine") {
    const depth = r - p.size.point / 2;
    return { crown: p.size.crownHeight, corner: 0, chamferLength: 2 * depth, chamferDepth: depth };
  }
  // Rodeo's proportions: production pins' corners rounded, unhardened pins' chamfered, a tenth of the diameter
  return p.type === "production" ? { crown: 0, corner: r / 5, chamferLength: 0, chamferDepth: 0 } : { crown: 0, corner: 0, chamferLength: r / 5, chamferDepth: r / 5 };
}

export function dowelProblem(p: DowelPin): string | null {
  const e = dowelEnds(p);
  const ends = p.type === "machine" ? e.crown + e.chamferLength : p.type === "production" ? 2 * e.corner : 2 * e.chamferLength;
  return p.length > ends ? null : `the pin must be longer than its ends (${round2(ends)} mm)`;
}

/** A dowel pin from the side (a machine pin's crowned end at the left, its pointed end at the right), or end on at either end. */
export function dowelPin(p: DowelPin, view: PinSideView, beyond: number | null): Drawing {
  const d = empty();
  const r = p.size.diameter / 2;
  const e = dowelEnds(p);
  const O = { x: 0, y: 0 };
  if (view !== "side") {
    d.circles.push({ center: O, radius: r });
    const inner = p.type === "machine" ? (view === "right" ? r - e.chamferDepth : 0) : p.type === "unhardened" ? r - e.chamferDepth : r - e.corner;
    if (inner > 0) d.circles.push({ center: O, radius: inner });
    cross(d, r, beyond);
    return d;
  }
  const L = p.length;
  const top: Pt[] = [];
  if (p.type === "machine") {
    // the crown: a sphere through the tip meeting the pin's surface the crown's height in
    const s = (e.crown * e.crown + r * r) / (2 * e.crown);
    top.push(...dome(e.crown, r, s, -1).pts);
    top.push({ x: L - e.chamferLength, y: r }, { x: L, y: r - e.chamferDepth }, { x: L, y: 0 });
    d.lines.push(across(L - e.chamferLength, r));
  } else if (p.type === "production") {
    top.push({ x: 0, y: 0 }, ...arc({ x: e.corner, y: r - e.corner }, e.corner, Math.PI, Math.PI / 2, 6), ...arc({ x: L - e.corner, y: r - e.corner }, e.corner, Math.PI / 2, 0, 6), { x: L, y: 0 });
  } else {
    top.push({ x: 0, y: 0 }, { x: 0, y: r - e.chamferDepth }, { x: e.chamferLength, y: r }, { x: L - e.chamferLength, y: r }, { x: L, y: r - e.chamferDepth }, { x: L, y: 0 });
    d.lines.push(across(e.chamferLength, r), across(L - e.chamferLength, r));
  }
  d.outlines.push(mirrored(top));
  axis(d, L, beyond);
  return d;
}

export type ParallelForm = "a" | "b";
export type PinEndView = "side" | "end";

/** DIN 7 / ISO 2338 parallel pins: d and the ends' chamfer c, mm. */
export const PARALLEL_DIN: readonly { readonly diameter: number; readonly chamfer: number }[] = [
  [0.6, 0.12],
  [0.8, 0.16],
  [1, 0.2],
  [1.2, 0.25],
  [1.5, 0.3],
  [2, 0.35],
  [2.5, 0.4],
  [3, 0.5],
  [4, 0.63],
  [5, 0.8],
  [6, 1.2],
  [8, 1.6],
  [10, 2],
  [12, 2.5],
  [16, 3],
  [20, 3.5],
  [25, 4],
  [30, 5],
  [40, 6.3],
  [50, 8],
].map(([diameter, chamfer]) => ({ diameter, chamfer }));

/** A chamfer `c` long on a pin's end, at 15° to the axis: how far it reaches in. */
const chamferDepth = (c: number): number => c * Math.tan(rad(15));

export interface ParallelPin {
  readonly diameter: number;
  readonly chamfer: number;
  readonly form: ParallelForm;
  readonly length: number;
}

/** DIN 7 form A's domed end: a sphere as wide as the pin is across. */
const parallelDome = (p: ParallelPin): number => dome(0, p.diameter / 2, p.diameter, -1).rise;

export function parallelProblem(p: ParallelPin): string | null {
  const ends = p.chamfer + (p.form === "a" ? parallelDome(p) : p.chamfer);
  return p.length > ends ? null : `the pin must be longer than its ends (${round2(ends)} mm)`;
}

/** A parallel pin from the side (form A domed at the left, both chamfered on form B) or end on. */
export function parallelPin(p: ParallelPin, view: PinEndView, beyond: number | null): Drawing {
  const d = empty();
  const r = p.diameter / 2;
  const depth = chamferDepth(p.chamfer);
  if (view === "end") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: r }, { center: { x: 0, y: 0 }, radius: r - depth });
    cross(d, r, beyond);
    return d;
  }
  const L = p.length;
  const top: Pt[] = p.form === "a" ? dome(parallelDome(p), r, p.diameter, -1).pts : [{ x: 0, y: 0 }, { x: 0, y: r - depth }, { x: p.chamfer, y: r }];
  top.push({ x: L - p.chamfer, y: r }, { x: L, y: r - depth }, { x: L, y: 0 });
  d.outlines.push(mirrored(top));
  if (p.form === "b") d.lines.push(across(p.chamfer, r));
  d.lines.push(across(L - p.chamfer, r));
  axis(d, L, beyond);
  return d;
}

/** ASME B18.8.2 taper pins: size number and large end diameter, inches; they taper 1/4 in per foot on the diameter. */
export const TAPER_INCH: readonly { readonly id: string; readonly large: number }[] = [
  ["7/0", 0.0625],
  ["6/0", 0.078],
  ["5/0", 0.094],
  ["4/0", 0.109],
  ["3/0", 0.125],
  ["2/0", 0.141],
  ["0", 0.156],
  ["1", 0.172],
  ["2", 0.193],
  ["3", 0.219],
  ["4", 0.25],
  ["5", 0.289],
  ["6", 0.341],
  ["7", 0.409],
  ["8", 0.492],
  ["9", 0.591],
  ["10", 0.706],
  ["11", 0.86],
  ["12", 1.032],
  ["13", 1.241],
  ["14", 1.521],
].map(([id, large]) => ({ id: String(id), large: Number(large) * INCH }));

/** ISO 2339 / DIN 1 taper pins (1:50): small end d, a, and the lengths they're usually made in, mm. */
export const TAPER_DIN: readonly { readonly diameter: number; readonly a: number; readonly min: number; readonly max: number }[] = [
  [0.6, 0.08, 4, 8],
  [0.8, 0.1, 5, 12],
  [1, 0.12, 6, 16],
  [1.2, 0.16, 6, 20],
  [1.5, 0.2, 8, 24],
  [2, 0.25, 10, 35],
  [2.5, 0.3, 10, 35],
  [3, 0.4, 12, 45],
  [4, 0.5, 14, 55],
  [5, 0.63, 18, 60],
  [6, 0.8, 22, 90],
  [8, 1, 22, 120],
  [10, 1.2, 26, 160],
  [12, 1.6, 32, 180],
  [16, 2, 40, 200],
  [20, 2.5, 45, 200],
  [25, 3, 50, 200],
  [30, 4, 55, 200],
  [40, 5, 60, 200],
  [50, 6.3, 65, 200],
].map(([diameter, a, min, max]) => ({ diameter, a, min, max }));

export interface TaperPin {
  readonly large: number;
  readonly small: number;
  readonly length: number;
  /** the ends' sphere radii, large end then small */
  readonly domes: readonly [number, number];
}

/** An inch taper pin of large end `large` and `length`: 1/48 taper on the diameter; Rodeo crowns each end with a sphere as wide as the end. */
export function inchTaper(large: number, length: number): TaperPin {
  const small = large - length / 48;
  return { large, small, length, domes: [large, Math.max(small, 1e-6)] };
}

/** An ISO 2339 taper pin: 1:50, its ends crowned r1 ≈ d (small) and r2 ≈ a/2 + d + (0.02 l)² / 8a (large). */
export function dinTaper(diameter: number, a: number, length: number): TaperPin {
  return { large: diameter + length / 50, small: diameter, length, domes: [a / 2 + diameter + (0.02 * length) ** 2 / (8 * a), diameter] };
}

export function taperProblem(p: TaperPin): string | null {
  if (!(p.length > 0)) return "the length must be more than 0";
  if (!(p.small > p.large / 2)) return `the pin is too long for its size: its small end would be under half its large end (at most ${round2(24 * p.large)} mm)`;
  const rise = dome(0, p.large / 2, p.domes[0], -1).rise + dome(0, p.small / 2, p.domes[1], 1).rise;
  return p.length > rise ? null : `the pin must be longer than its crowned ends (${round2(rise)} mm)`;
}

/** A taper pin from the side, its large end at the left, or end on: the large end alone, or the small end within the large. */
export function taperPin(p: TaperPin, view: PinSideView, beyond: number | null): Drawing {
  const d = empty();
  const R = p.large / 2;
  const r = p.small / 2;
  if (view !== "side") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: R });
    if (view === "right") d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    cross(d, R, beyond);
    return d;
  }
  const left = dome(0, R, p.domes[0], -1);
  const right = dome(0, r, p.domes[1], 1);
  // the domes sit inside the length: the left from 0, the right ending at the length
  const top = [...left.pts.map((q) => ({ x: q.x + left.rise, y: q.y })), ...right.pts.map((q) => ({ x: q.x + p.length - right.rise, y: q.y }))];
  d.outlines.push(mirrored(top));
  axis(d, p.length, beyond);
  return d;
}
