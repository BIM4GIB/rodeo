// Retaining rings and washers from Vectorworks' Fasteners tool set, in 2D: Retaining Ring (ASME) in
// the metric types of ANSI B27.7 and B27.8M, Retaining Ring (DIN) for shafts (DIN 471) and bores
// (DIN 472), regular and heavy, and Retaining Washer (DIN 6799). A ring lies flat, centred on the
// origin with its gap at the bottom: Front shows it so, Side-Section and Side-Solid edge on, a
// section also marking where the cut through its centre leaves the ring. Sizes are mm.

import type { Pt } from "../core/index.ts";
import { arc, type FastenerDrawing } from "./rivetShapes.ts";

export type RingView = "front" | "section" | "solid";

/** A circlip: pliers' lugs either side of its gap, its section tapering from the top down to them. */
export interface Circlip {
  readonly form: "circlip";
  /** an internal (bore) ring's lugs point in and its free diameter is outside */
  readonly internal: boolean;
  /** the free diameter: an external ring's inside, an internal ring's outside */
  readonly free: number;
  readonly thickness: number;
  /** the section opposite the gap, and where it meets the lugs */
  readonly widest: number;
  readonly narrowest: number;
  /** a lug's height from the free diameter, and its hole */
  readonly lug: number;
  readonly hole: number;
}

/** An E-ring or retaining washer, pushed on from the side: three prongs sit in the groove. */
export interface ERing {
  readonly form: "e";
  /** the diameter the prongs reach, and the outside */
  readonly inside: number;
  readonly outside: number;
  readonly thickness: number;
  /** the band outside the cut-outs */
  readonly band: number;
  /** across the two lower prongs; a reinforced ring's arms run straight down from its sides instead */
  readonly opening: number;
  readonly reinforced: boolean;
}

/** A C-ring (crescent): an even band round past the shaft's middle, its ends tapered. */
export interface CRing {
  readonly form: "c";
  readonly inside: number;
  readonly outside: number;
  readonly thickness: number;
}

export type Ring = Circlip | ERing | CRing;

export interface RingSize {
  readonly id: string;
  readonly label: string;
  readonly ring: Ring;
}

const empty = (): FastenerDrawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });
const mirror = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y }));
/** the point `r` from the centre, `t` radians round from straight down towards +x */
const polar = (r: number, t: number): Pt => ({ x: r * Math.sin(t), y: -r * Math.cos(t) });
/** the angles from `a` to `b`, `n` steps apart */
const span = (a: number, b: number, n: number): number[] => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
/** an E-ring's top prong reaches across this much of the prongs' radius either side */
const TOP_PRONG = 0.3;

/** Why the ring can't be drawn, or null. */
export function ringProblem(r: Ring): string | null {
  if (r.form === "circlip") {
    if (!(r.lug > r.widest * 0.5 && r.widest >= r.narrowest)) return "its lugs must stand out of its band";
    if (!(r.hole < r.lug)) return "its lug holes must fit in its lugs";
    if (r.internal && !(r.lug < r.free / 2)) return "its lugs must fit inside it";
    return null;
  }
  if (!(r.outside > r.inside)) return "its outside must be wider than its inside";
  if (r.form === "e") {
    const a = eArms(r);
    if (!(a.x + a.flare + r.band * 1.2 < r.outside / 2)) return "its arms don't fit outside its prongs";
  }
  return null;
}

/** A circlip from the front: its outline, the free circle one side and the tapering band and lugs the other, and its holes' centres. */
function circlipFront(c: Circlip): { outline: Pt[]; holes: Pt[] } {
  const free = c.free / 2;
  const mid = c.internal ? free - c.lug / 2 : free + c.lug / 2;
  const tip = c.internal ? free - c.lug : free + c.lug;
  // a bore ring's gap must close as it's squeezed in; a shaft ring's opens
  const gapHalf = c.internal ? 0.13 * c.free : Math.max(0.3 * c.lug, 0.1);
  let gap = gapHalf / mid;
  let lugs = Math.max(c.lug, c.hole * 1.8) / mid;
  let fall = (0.9 * c.lug) / mid;
  // a small ring's lugs keep to its lower half
  const k = Math.min(1, (Math.PI * 0.55) / (gap + lugs + fall));
  gap *= k;
  lugs *= k;
  fall *= k;
  const root = gap + lugs + fall;
  const corner = Math.min(0.35 * c.lug, 0.45 * lugs * tip);
  /** the band's width, lugs included, `t` round from the bottom */
  const width = (t: number): number => {
    const u = Math.min(t, 2 * Math.PI - t);
    if (u >= root) return c.narrowest + ((c.widest - c.narrowest) * (Math.cos(root) - Math.cos(u))) / (Math.cos(root) + 1);
    if (u >= gap + lugs) return c.narrowest + ((c.lug - c.narrowest) * (1 + Math.cos((Math.PI * (u - gap - lugs)) / fall))) / 2;
    // the lug's corner at the gap, rounded
    const along = (u - gap) * tip;
    return along >= corner ? c.lug : c.lug - corner + Math.sqrt(Math.max(0, corner * corner - (corner - along) ** 2));
  };
  const ts = [...span(gap, root, 40), ...span(root, 2 * Math.PI - root, 120).slice(1), ...span(2 * Math.PI - root, 2 * Math.PI - gap, 40).slice(1)];
  const fixed = ts.map((t) => polar(free, t));
  const moving = ts.map((t) => polar(c.internal ? free - width(t) : free + width(t), t));
  const hole = gap + lugs / 2;
  return { outline: [...fixed, ...moving.reverse()], holes: [polar(mid, hole), polar(mid, 2 * Math.PI - hole)] };
}

/** Where an E-ring's lower prongs touch the groove (right one), and its arms' inner edge at the bottom. */
function eArms(e: ERing): { x: number; y: number; flare: number } {
  const r = e.inside / 2;
  const x = e.reinforced ? r : Math.min(e.opening / 2, r * 0.95);
  return { x, y: -Math.sqrt(Math.max(0, r * r - x * x)), flare: e.reinforced ? 0 : 0.25 * e.band };
}

/** An E-ring or retaining washer from the front. */
function eFront(e: ERing): Pt[] {
  const R = e.outside / 2;
  const r = e.inside / 2;
  const prong = eArms(e);
  const tP = Math.atan2(prong.x, -prong.y);
  const tTop = Math.atan(TOP_PRONG);
  const shoulder = 0.2;
  // the arms end where they're 1.2 bands wide, below the prongs
  const xA = prong.x + prong.flare;
  const xO = xA + 1.2 * e.band;
  const yEnd = Math.min(-Math.sqrt(Math.max(0, R * R - xO * xO)), prong.y - e.band);
  const outerEnd = { x: Math.sqrt(Math.max(0, R * R - yEnd * yEnd)), y: yEnd };
  const inEnd = { x: xA, y: yEnd };
  // the right half's inside, from its arm's end up to the top prong's middle
  const face = Math.min(0.12, (0.6 * e.band) / r);
  const right: Pt[] = [inEnd, prong];
  if (e.reinforced) {
    // round the groove from the side up to small notches beside the top prong
    const cut = r + 0.45 * (R - r);
    const notch = Math.PI - tTop - shoulder;
    right.push(...span(tP, notch - 0.5 - shoulder, 12).slice(1).map((t) => polar(r, t)), ...span(notch - 0.5, notch, 6).map((t) => polar(cut, t)));
  } else {
    const cut = R - e.band;
    right.push(polar(r, tP + face), ...span(tP + face + shoulder, Math.PI - tTop - shoulder, 24).map((t) => polar(cut, t)));
  }
  right.push({ x: TOP_PRONG * r, y: r }, { x: 0, y: r });
  const left = mirror(right);
  const cap = (from: Pt, to: Pt): Pt[] => arc({ x: (from.x + to.x) / 2, y: from.y }, Math.abs(to.x - from.x) / 2, Math.PI, 2 * Math.PI, 8);
  const a0 = Math.atan2(outerEnd.y, outerEnd.x);
  const outer = span(a0, Math.PI - a0, 96).map((a) => ({ x: R * Math.cos(a), y: R * Math.sin(a) }));
  const leftOuter = { x: -outerEnd.x, y: yEnd };
  const leftIn = { x: -inEnd.x, y: yEnd };
  return [
    ...outer,
    ...cap(leftOuter, leftIn).slice(1, -1),
    ...left,
    ...right.slice(0, -1).reverse(),
    ...cap(inEnd, outerEnd).slice(1, -1),
  ];
}

/** A C-ring from the front: the band's ends 58° either side of the bottom, tapered over 22°. */
function cFront(c: CRing): Pt[] {
  const R = c.outside / 2;
  const r = c.inside / 2;
  const end = (58 * Math.PI) / 180;
  const taper = (22 * Math.PI) / 180;
  const inside = (t: number): number => {
    const u = Math.min(t, 2 * Math.PI - t);
    return u < end + taper ? r + (R - r) * 0.6 * (1 - (u - end) / taper) : r;
  };
  const ts = [...span(end, end + taper, 12), ...span(end + taper, 2 * Math.PI - end - taper, 96).slice(1), ...span(2 * Math.PI - end - taper, 2 * Math.PI - end, 12).slice(1)];
  return [...ts.map((t) => polar(R, t)), ...[...ts].reverse().map((t) => polar(inside(t), t))];
}

/** Where the line x = 0 crosses the outline. */
function centreCuts(outline: readonly Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    if ((p.x <= 0 && q.x > 0) || (q.x <= 0 && p.x > 0)) out.push(p.y + ((q.y - p.y) * -p.x) / (q.x - p.x));
  }
  return out;
}

/** A retaining ring or washer in `view`. */
export function retainingRing(r: Ring, view: RingView): FastenerDrawing {
  const d = empty();
  const front = r.form === "circlip" ? circlipFront(r) : { outline: r.form === "e" ? eFront(r) : cFront(r), holes: [] };
  if (view === "front") {
    d.outlines.push(front.outline);
    if (r.form === "circlip") for (const h of front.holes) d.circles.push({ center: h, radius: r.hole / 2 });
    return d;
  }
  const ys = front.outline.map((p) => p.y);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  const t = r.thickness / 2;
  d.outlines.push([{ x: -t, y: low }, { x: t, y: low }, { x: t, y: high }, { x: -t, y: high }]);
  if (view === "section") {
    const near = (high - low) * 1e-6;
    for (const y of centreCuts(front.outline)) if (y - low > near && high - y > near) d.lines.push([{ x: -t, y }, { x: t, y }]);
  }
  return d;
}

/** ANSI B27.7 3AM1, basic external: shaft, free diameter D, thickness T, hole P, lug B, sections E and J. */
const ASME_3AM1: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [4, 3.6, 0.25, 0.6, 1.35, 0.65, 0.4],
  [5, 4.55, 0.4, 0.6, 1.4, 0.65, 0.4],
  [6, 5.45, 0.4, 0.6, 1.4, 0.75, 0.5],
  [7, 6.35, 0.6, 1, 2.05, 0.9, 0.6],
  [8, 7.15, 0.6, 1, 2.2, 1, 0.65],
  [9, 8.15, 0.6, 1, 2.2, 1.15, 0.75],
  [10, 9, 0.6, 1, 2.2, 1.3, 0.8],
  [11, 10, 0.6, 1, 2.2, 1.4, 0.85],
  [12, 10.85, 0.6, 1, 2.2, 1.5, 0.9],
  [13, 11.9, 0.9, 1.2, 2.8, 1.6, 0.95],
  [14, 12.9, 0.9, 1.2, 2.8, 1.7, 1],
  [15, 13.8, 0.9, 1.2, 2.8, 1.8, 1.05],
  [16, 14.7, 0.9, 1.2, 2.8, 2.05, 1.15],
  [17, 15.75, 0.9, 1.2, 2.8, 2.1, 1.15],
  [18, 16.65, 1.1, 1.3, 3.45, 2.25, 1.25],
  [19, 17.6, 1.1, 1.3, 3.45, 2.35, 1.3],
  [20, 18.35, 1.1, 1.3, 3.45, 2.4, 1.35],
  [21, 19.4, 1.1, 1.3, 3.45, 2.5, 1.4],
  [22, 20.3, 1.1, 1.3, 3.45, 2.7, 1.5],
  [23, 21.25, 1.1, 1.3, 3.45, 2.8, 1.6],
  [24, 22.2, 1.1, 1.9, 4.2, 2.9, 1.6],
  [25, 23.1, 1.1, 1.9, 4.2, 2.9, 1.7],
  [26, 24.05, 1.1, 1.9, 4.2, 3, 1.7],
  [27, 24.95, 1.3, 1.9, 4.6, 3.1, 1.8],
  [28, 25.8, 1.3, 1.9, 4.6, 3.2, 1.8],
  [30, 27.9, 1.3, 1.9, 4.6, 3.3, 1.8],
  [32, 29.6, 1.3, 1.9, 4.6, 3.6, 1.9],
  [34, 31.4, 1.3, 1.9, 4.6, 3.8, 2],
  [35, 32.3, 1.3, 1.9, 4.6, 3.9, 2.1],
  [36, 33.25, 1.3, 1.9, 5.4, 4.1, 2.2],
  [38, 35.2, 1.3, 3.1, 5.4, 4.3, 2.3],
  [40, 36.75, 1.6, 3.1, 6, 4.4, 2.3],
  [42, 38.8, 1.6, 3.1, 6, 4.6, 2.4],
  [43, 39.65, 1.6, 3.1, 6, 4.7, 2.5],
  [45, 41.6, 1.6, 3.1, 6, 4.8, 2.6],
  [46, 42.55, 1.6, 3.1, 6, 4.9, 2.6],
  [48, 44.4, 1.6, 3.1, 6.2, 5, 2.6],
  [50, 46.2, 1.6, 3.1, 6.2, 5.1, 2.7],
  [52, 48.4, 2, 3.1, 6.8, 5.3, 2.8],
  [54, 49.9, 2, 3.1, 6.8, 5.4, 2.9],
  [55, 50.6, 2, 3.1, 6.8, 5.4, 2.9],
  [57, 52.9, 2, 3.1, 6.8, 5.6, 3],
  [58, 53.6, 2, 3.1, 6.8, 5.6, 3],
  [60, 55.8, 2, 3.1, 6.8, 5.7, 3],
  [62, 57.3, 2, 3.1, 6.8, 5.8, 3],
  [65, 60.4, 2, 3.1, 6.8, 6, 3.1],
  [68, 63.1, 2, 3.1, 6.8, 6.2, 3.3],
  [70, 64.6, 2.4, 3.1, 7.8, 6.3, 3.3],
  [72, 66.6, 2.4, 3.1, 7.8, 6.4, 3.3],
  [75, 69, 2.4, 3.1, 7.8, 6.6, 3.4],
  [78, 72, 2.4, 3.1, 7.8, 6.6, 3.4],
  [80, 74.2, 2.4, 3.1, 7.8, 7, 3.6],
  [82, 76.4, 2.4, 3.1, 7.8, 7.1, 3.7],
  [85, 78.6, 2.4, 3.1, 7.8, 7.3, 3.8],
  [88, 81.4, 2.8, 3.1, 8.4, 7.5, 3.9],
  [90, 83.2, 2.8, 3.1, 8.4, 7.5, 3.9],
  [95, 88.1, 2.8, 3.1, 8.4, 7.9, 4.1],
  [100, 92.5, 2.8, 3.1, 8.7, 8, 4.1],
];

/** ANSI B27.7 3BM1, basic internal: bore, free diameter D, thickness h, hole d1, lug a, sections b and s. */
const ASME_3BM1: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [8, 8.8, 0.4, 0.8, 1.7, 0.85, 0.45],
  [9, 10, 0.6, 1, 2.1, 1.25, 0.65],
  [10, 11.1, 0.6, 1, 2.1, 1.3, 0.7],
  [11, 12.2, 0.6, 1, 2.5, 1.3, 0.7],
  [12, 13.3, 0.6, 1, 2.5, 1.35, 0.75],
  [13, 14.25, 0.9, 1.2, 2.9, 1.35, 0.9],
  [14, 15.45, 0.9, 1.2, 3.3, 1.6, 0.9],
  [15, 16.6, 0.9, 1.5, 3.3, 1.65, 0.95],
  [16, 17.7, 0.9, 1.5, 3.4, 1.7, 0.95],
  [17, 18.9, 0.9, 1.5, 3.4, 1.7, 0.95],
  [18, 20.05, 0.9, 1.5, 3.6, 1.8, 1],
  [19, 21.1, 0.9, 1.5, 3.6, 1.8, 1],
  [20, 22.25, 0.9, 1.5, 4, 2, 1.1],
  [21, 23.3, 0.9, 1.5, 4, 2.1, 1.2],
  [22, 24.4, 1.1, 1.5, 4, 2.1, 1.2],
  [23, 25.45, 1.1, 1.5, 4, 2.2, 1.2],
  [24, 26.55, 1.1, 1.5, 4, 2.3, 1.3],
  [25, 27.75, 1.1, 1.5, 4, 2.6, 1.3],
  [26, 28.85, 1.1, 1.5, 4, 2.7, 1.4],
  [27, 29.95, 1.3, 1.9, 4.6, 2.8, 1.4],
  [28, 31.1, 1.3, 1.9, 4.6, 2.9, 1.5],
  [30, 33.4, 1.3, 1.9, 4.6, 3, 1.5],
  [32, 35.35, 1.3, 1.9, 4.6, 3.1, 1.6],
  [34, 37.75, 1.3, 1.9, 4.6, 3.2, 1.6],
  [35, 38.75, 1.3, 1.9, 4.6, 3.3, 1.6],
  [36, 40, 1.3, 1.9, 4.6, 3.4, 1.7],
  [37, 41.05, 1.3, 1.9, 4.6, 3.4, 1.7],
  [38, 42.15, 1.3, 1.9, 4.6, 3.4, 1.7],
  [40, 44.25, 1.6, 1.9, 5.1, 4, 2],
  [42, 46.6, 1.6, 1.9, 5.8, 4.2, 2.1],
  [45, 49.95, 1.6, 1.9, 6, 4.3, 2.1],
  [46, 51.05, 1.6, 2.3, 6, 4.3, 2.1],
  [47, 52.15, 1.6, 2.3, 6, 4.3, 2.2],
  [48, 53.3, 1.6, 2.3, 6, 4.5, 2.3],
  [50, 55.35, 1.6, 2.3, 6, 4.6, 2.3],
  [52, 57.9, 2, 2.3, 6.4, 4.7, 2.3],
  [55, 61.1, 2, 2.3, 6.7, 5.1, 2.5],
  [57, 63.25, 2, 2.3, 6.9, 5.2, 2.5],
  [58, 64.4, 2, 2.3, 6.9, 5.3, 2.6],
  [60, 66.8, 2, 2.3, 6.9, 5.3, 2.6],
  [62, 68.6, 2, 2.7, 7.1, 5.3, 2.6],
  [63, 69.9, 2, 2.7, 7.1, 5.4, 2.7],
  [65, 72.2, 2.4, 2.7, 7.4, 5.6, 2.8],
  [68, 75.7, 2.4, 2.7, 7.6, 5.8, 2.9],
  [70, 77.5, 2.4, 2.7, 7.6, 5.8, 2.9],
  [72, 79.6, 2.4, 2.7, 7.6, 5.8, 2.9],
  [75, 83.3, 2.4, 2.7, 7.9, 6.2, 3.1],
  [78, 86.8, 2.8, 3.1, 7.9, 6.5, 3.2],
  [80, 89.1, 2.8, 3.1, 7.9, 6.7, 3.3],
  [82, 91.1, 2.8, 3.1, 8.7, 6.9, 3.4],
  [85, 94.4, 2.8, 3.1, 8.7, 7, 3.6],
  [88, 97.9, 2.8, 3.1, 8.7, 7.3, 3.6],
  [90, 100, 2.8, 3.1, 8.7, 7.4, 3.6],
  [92, 102.2, 2.8, 3.1, 8.7, 7.6, 3.8],
  [95, 105.6, 2.8, 3.1, 8.7, 7.8, 3.9],
  [98, 109, 2.8, 3.1, 9.4, 8.1, 4.1],
  [100, 110.7, 2.8, 3.1, 9.4, 8.2, 4.1],
  [102, 112.4, 2.8, 3.1, 9.4, 8.4, 4.2],
  [105, 115.8, 2.8, 3.1, 9.4, 8.4, 4.3],
  [108, 119.2, 2.8, 3.1, 9.4, 8.5, 4.6],
  [110, 120.8, 2.8, 3.8, 10.3, 8.7, 4.6],
  [115, 126, 2.8, 3.8, 10.3, 8.9, 4.6],
  [120, 132.4, 2.8, 3.8, 10.3, 9.4, 4.6],
  [125, 137.1, 2.8, 3.8, 10.3, 9.5, 4.7],
  [130, 142.5, 2.8, 3.8, 10.3, 9.8, 4.9],
  [135, 148.5, 3.2, 3.8, 11.6, 10.4, 5],
  [140, 154.1, 3.2, 3.8, 11.6, 10.4, 5],
  [145, 159.5, 3.2, 3.8, 11.6, 10.6, 5.3],
  [150, 164.5, 3.2, 3.8, 11.6, 10.8, 5.4],
  [155, 168.8, 3.2, 3.8, 11.6, 10.8, 5.4],
  [160, 175.1, 4, 4.6, 12.3, 10.9, 5.4],
  [165, 180.3, 4, 4.6, 12.3, 11.1, 5.6],
  [170, 185.6, 4, 4.6, 12.3, 11.4, 5.6],
  [175, 191.3, 4, 4.6, 13.5, 11.6, 5.7],
  [180, 196.6, 4, 4.6, 13.5, 12, 5.9],
  [185, 202.7, 4.8, 4.6, 14.2, 12.4, 6],
  [190, 207.7, 4.8, 4.6, 14.2, 12.9, 6.3],
  [200, 217.8, 4.8, 4.6, 14.2, 13.3, 6.5],
  [210, 230.3, 4.8, 4.6, 15.2, 14.2, 6.9],
  [220, 240.5, 4.8, 4.6, 16.8, 15, 7.3],
  [230, 251.4, 4.8, 4.6, 16.8, 15.5, 7.5],
  [240, 262.3, 4.8, 4.6, 18.7, 16.3, 7.7],
  [250, 273.3, 4.8, 4.6, 18.7, 16.7, 7.8],
];

/** B27.8M 3DM1, heavy duty external (Rotor Clip MSR): shaft, free diameter, thickness, lug, sections, hole. */
const ASME_3DM1: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [10, 9.2, 0.9, 2.6, 1.7, 1.0, 1.0],
  [11, 10.0, 0.9, 2.6, 1.9, 1.1, 1.0],
  [12, 11.05, 1.1, 2.6, 2.2, 1.3, 1.0],
  [13, 11.8, 1.3, 3.0, 2.3, 1.3, 1.2],
  [14, 12.8, 1.3, 3.0, 2.4, 1.4, 1.2],
  [15, 13.8, 1.3, 3.3, 2.6, 1.4, 1.2],
  [16, 14.7, 1.3, 3.3, 2.7, 1.5, 1.2],
  [17, 15.65, 1.3, 3.3, 2.8, 1.6, 1.2],
  [18, 16.55, 1.6, 4.1, 3.0, 1.8, 1.9],
  [19, 17.5, 2.0, 4.6, 3.2, 2.0, 1.9],
  [20, 18.45, 2.0, 4.6, 3.4, 2.0, 1.9],
  [22, 20.4, 2.0, 4.6, 3.8, 2.1, 1.9],
  [25, 23.1, 2.0, 4.6, 3.8, 2.1, 1.9],
  [27, 24.85, 2.4, 5.6, 4.1, 2.3, 2.3],
  [28, 25.7, 2.4, 5.6, 4.3, 2.4, 2.3],
  [30, 27.6, 2.4, 5.6, 4.5, 2.5, 2.3],
  [32, 29.35, 2.4, 5.6, 4.7, 2.6, 2.3],
  [35, 32.2, 2.4, 5.6, 5.1, 2.8, 2.3],
  [38, 35.05, 2.8, 7.1, 5.5, 3.1, 2.7],
  [40, 36.7, 2.8, 7.1, 5.8, 3.2, 2.7],
  [45, 41.1, 2.8, 7.4, 6.5, 3.6, 2.7],
  [50, 45.5, 3.2, 8.0, 7.1, 3.9, 3.1],
];

/** ANSI B27.7 3CM1, basic E-ring: shaft, free inside d, thickness h, outside dc, band b. */
const ASME_3CM1: readonly (readonly [number, number, number, number, number])[] = [
  [1, 0.64, 0.25, 2, 0.3],
  [2, 1.3, 0.25, 4, 0.55],
  [3, 2.1, 0.4, 5.6, 0.65],
  [4, 2.9, 0.6, 7.2, 0.85],
  [5, 3.7, 0.6, 8.5, 0.9],
  [6, 4.7, 0.6, 11.1, 1.15],
  [7, 5.25, 0.6, 13.4, 1.4],
  [8, 6.15, 0.6, 14.6, 1.4],
  [9, 6.8, 0.9, 15.8, 1.5],
  [10, 7.6, 0.9, 16.8, 1.5],
  [11, 8.55, 0.9, 17.4, 1.6],
  [12, 9.2, 1.1, 18.6, 1.8],
  [13, 9.95, 1.1, 20.3, 2],
  [15, 11.4, 1.1, 22.8, 2.1],
  [16, 12.15, 1.1, 23.8, 2.3],
  [18, 13.9, 1.3, 27.2, 2.5],
  [20, 15.6, 1.3, 30, 2.8],
  [22, 17, 1.3, 33, 3],
  [25, 19.5, 1.3, 37.1, 3.3],
];

/** B27.8M 3EM1, reinforced E-ring (Rotor Clip MRE), and 3FM1, C-ring (Rotor Clip MC): shaft, free inside, thickness, outside. */
const ASME_3EM1: readonly (readonly [number, number, number, number])[] = [
  [4, 2.9, 0.6, 8.5],
  [5, 3.65, 0.6, 9.5],
  [6, 4.65, 0.6, 11.35],
  [7, 5.2, 0.6, 13.1],
  [8, 6.15, 0.6, 14.95],
  [9, 6.75, 0.9, 15.7],
  [10, 7.45, 0.9, 16.75],
  [11, 8.45, 0.9, 18.95],
  [12, 9.1, 1.1, 19.6],
  [13, 9.8, 1.1, 20.55],
  [14, 10.9, 1.1, 22.1],
  [15, 11.5, 1.1, 23.2],
];
const ASME_3FM1: readonly (readonly [number, number, number, number])[] = [
  [3, 2.18, 0.4, 3.98],
  [4, 3.0, 0.4, 5.0],
  [5, 3.8, 0.6, 6.2],
  [6, 4.8, 0.6, 7.4],
  [7, 5.8, 0.6, 8.6],
  [8, 6.8, 0.6, 10.0],
  [9, 7.8, 0.6, 11.2],
  [10, 8.75, 0.6, 12.15],
  [11, 9.65, 0.6, 13.2],
  [12, 10.55, 0.6, 14.35],
  [13, 11.4, 1.0, 15.4],
  [14, 12.3, 1.0, 16.3],
  [15, 13.2, 1.0, 17.4],
  [16, 14.1, 1.0, 18.5],
  [17, 14.9, 1.0, 19.4],
  [18, 15.8, 1.2, 20.4],
  [19, 16.7, 1.2, 21.5],
  [20, 17.55, 1.2, 22.65],
  [22, 19.4, 1.2, 25.0],
  [23, 20.2, 1.2, 26.0],
  [24, 21.1, 1.2, 27.1],
  [25, 22.0, 1.2, 28.3],
  [26, 22.9, 1.2, 29.4],
  [28, 24.6, 1.6, 31.6],
  [30, 26.3, 1.6, 33.7],
  [32, 28.1, 1.6, 36.1],
  [35, 30.8, 1.6, 39.4],
  [36, 31.7, 1.6, 40.5],
  [38, 33.4, 1.6, 42.6],
  [40, 35.2, 1.6, 45.0],
  [42, 37.0, 1.6, 47.2],
  [45, 39.6, 1.6, 50.6],
  [48, 42.3, 1.6, 54.1],
  [50, 44.0, 2.0, 56.4],
  [52, 46.0, 2.0, 58.6],
  [55, 48.5, 2.0, 61.5],
];

const mm = (n: number): string => String(Math.round(n * 1000) / 1000);
const sized = (n: number, ring: Ring): RingSize => ({ id: mm(n), label: mm(n), ring });

export type AsmeRingType = "internal" | "external" | "heavy" | "e" | "reinforced" | "c";

/** Retaining Ring (ASME)'s types, VW's names, the standard each comes from and its sizes (by shaft or bore diameter). */
export const ASME_RINGS: readonly { readonly id: AsmeRingType; readonly label: string; readonly source: string; readonly sizes: readonly RingSize[] }[] = [
  {
    id: "internal",
    label: "Basic Internal Ring",
    source: "ANSI B27.7 3BM1",
    sizes: ASME_3BM1.map(([n, D, h, d1, a, b, s]) => sized(n, { form: "circlip", internal: true, free: D, thickness: h, widest: b, narrowest: s, lug: a, hole: d1 })),
  },
  {
    id: "external",
    label: "Basic External Ring",
    source: "ANSI B27.7 3AM1",
    sizes: ASME_3AM1.map(([n, D, T, P, B, E, J]) => sized(n, { form: "circlip", internal: false, free: D, thickness: T, widest: E, narrowest: J, lug: B, hole: P })),
  },
  {
    id: "heavy",
    label: "Heavy Duty External",
    source: "ANSI B27.8M 3DM1, as Rotor Clip's MSR",
    sizes: ASME_3DM1.map(([n, Df, T, H, Smax, Smin, R]) => sized(n, { form: "circlip", internal: false, free: Df, thickness: T, widest: Smax, narrowest: Smin, lug: H, hole: R })),
  },
  {
    id: "e",
    label: "Basic E-Ring",
    source: "ANSI B27.7 3CM1",
    sizes: ASME_3CM1.map(([n, d, h, dc, b]) => sized(n, { form: "e", inside: d, outside: dc, thickness: h, band: b, opening: 0.82 * d, reinforced: false })),
  },
  {
    id: "reinforced",
    label: "Reinforced E-Ring",
    source: "ANSI B27.8M 3EM1, as Rotor Clip's MRE",
    sizes: ASME_3EM1.map(([n, Df, T, G]) => sized(n, { form: "e", inside: Df, outside: G, thickness: T, band: 0.55 * ((G - Df) / 2), opening: Df, reinforced: true })),
  },
  {
    id: "c",
    label: "C-Ring",
    source: "ANSI B27.8M 3FM1, as Rotor Clip's MC",
    sizes: ASME_3FM1.map(([n, Df, T, G]) => sized(n, { form: "c", inside: Df, outside: G, thickness: T })),
  },
];

/** DIN 471 and 472, regular and heavy: d1 (shaft or bore), lug a, section b, free diameter d3, thickness s, hole d5. */
type DinRow = readonly [number, number, number, number, number, number];

const DIN_471: readonly DinRow[] = [
  [3, 1.9, 0.8, 2.7, 0.4, 1],
  [4, 2.2, 0.9, 3.7, 0.4, 1],
  [5, 2.5, 1.1, 4.7, 0.6, 1],
  [6, 2.7, 1.3, 5.6, 0.7, 1.2],
  [7, 3.1, 1.4, 6.5, 0.8, 1.2],
  [8, 3.2, 1.5, 7.4, 0.8, 1.2],
  [9, 3.3, 1.7, 8.4, 1, 1.2],
  [10, 3.3, 1.8, 9.3, 1, 1.5],
  [11, 3.3, 1.8, 10.2, 1, 1.5],
  [12, 3.3, 1.8, 11, 1, 1.7],
  [13, 3.4, 2, 11.9, 1, 1.7],
  [14, 3.5, 2.1, 12.9, 1, 1.7],
  [15, 3.6, 2.2, 13.8, 1, 1.7],
  [16, 3.7, 2.2, 14.7, 1, 1.7],
  [17, 3.8, 2.3, 15.7, 1, 1.7],
  [18, 3.9, 2.4, 16.5, 1.2, 2],
  [19, 3.9, 2.5, 17.5, 1.2, 2],
  [20, 4, 2.6, 18.5, 1.2, 2],
  [21, 4.1, 2.7, 19.5, 1.2, 2],
  [22, 4.2, 2.8, 20.5, 1.2, 2],
  [24, 4.4, 3, 22.2, 1.2, 2],
  [25, 4.4, 3, 23.2, 1.2, 2],
  [26, 4.5, 3.1, 24.2, 1.2, 2],
  [28, 4.7, 3.2, 25.9, 1.5, 2],
  [29, 4.8, 3.4, 26.9, 1.5, 2],
  [30, 5, 3.5, 27.9, 1.5, 2],
  [32, 5.2, 3.6, 29.6, 1.5, 2.5],
  [34, 5.4, 3.8, 31.5, 1.5, 2.5],
  [35, 5.6, 3.9, 32.2, 1.5, 2.5],
  [36, 5.6, 4, 33.2, 1.75, 2.5],
  [38, 5.8, 4.2, 35.2, 1.75, 2.5],
  [40, 6, 4.4, 36.5, 1.75, 2.5],
  [42, 6.2, 4.5, 38.5, 1.75, 2.5],
  [45, 6.7, 4.7, 41.5, 1.75, 2.5],
  [48, 6.9, 5, 44.5, 1.75, 2.5],
  [50, 6.9, 5.1, 45.8, 2, 2.5],
  [52, 7, 5.2, 47.8, 2, 2.5],
  [55, 7.2, 5.4, 50.8, 2, 2.5],
  [56, 7.3, 5.5, 51.8, 2, 2.5],
  [58, 7.3, 5.6, 53.8, 2, 2.5],
  [60, 7.4, 5.8, 55.8, 2, 2.5],
  [62, 7.5, 6, 57.8, 2, 2.5],
  [63, 7.6, 6.2, 58.8, 2, 2.5],
  [65, 7.8, 6.3, 60.8, 2.5, 3],
  [68, 8, 6.5, 63.5, 2.5, 3],
  [70, 8.1, 6.6, 65.5, 2.5, 3],
  [72, 8.2, 6.8, 67.5, 2.5, 3],
  [75, 8.4, 7, 70.5, 2.5, 3],
  [78, 8.6, 7.3, 73.5, 2.5, 3],
  [80, 8.6, 7.4, 74.5, 2.5, 3],
  [82, 8.7, 7.6, 76.5, 2.5, 3],
  [85, 8.7, 7.8, 79.5, 3, 3.5],
  [88, 8.8, 8, 82.5, 3, 3.5],
  [90, 8.8, 8.2, 84.5, 3, 3.5],
  [92, 9, 8.4, 86.5, 3, 3.5],
  [95, 9.4, 8.6, 89.5, 3, 3.5],
  [100, 9.6, 9, 94.5, 3, 3.5],
  [105, 9.9, 9.3, 98, 4, 3.5],
  [110, 10.1, 9.6, 103, 4, 3.5],
  [115, 10.6, 9.8, 108, 4, 3.5],
  [120, 11, 10.2, 113, 4, 3.5],
  [125, 11.4, 10.4, 118, 4, 4],
  [130, 11.6, 10.7, 123, 4, 4],
  [135, 11.8, 11, 128, 4, 4],
  [140, 12, 11.2, 133, 4, 4],
  [145, 12.2, 11.5, 138, 4, 4],
  [150, 13, 11.8, 142, 4, 4],
  [155, 13, 12, 146, 4, 4],
  [160, 13.3, 12.2, 151, 4, 4],
  [165, 13.5, 12.5, 155.5, 4, 4],
  [170, 13.5, 12.9, 160.5, 4, 4],
  [175, 13.5, 12.9, 165.5, 4, 4],
  [180, 14.2, 14, 170.5, 4, 4],
  [185, 14.2, 14, 175.5, 4, 4],
  [190, 14.2, 14, 180.5, 4, 4],
  [195, 14.2, 14, 185.5, 4, 4],
  [200, 14.2, 14, 190.5, 4, 4],
  [210, 14.2, 14, 198, 5, 4],
  [220, 14.2, 14, 208, 5, 4],
  [230, 14.2, 14, 218, 5, 4],
  [240, 14.2, 14, 228, 5, 4],
  [250, 14.2, 14, 238, 5, 4],
  [260, 16.2, 16, 245, 5, 5],
  [270, 16.2, 16, 255, 5, 5],
  [280, 16.2, 16, 265, 5, 5],
  [290, 16.2, 16, 275, 5, 5],
  [300, 16.2, 16, 285, 5, 5],
];

const DIN_471_HEAVY: readonly DinRow[] = [
  [15, 4.8, 2.4, 13.8, 1.5, 2],
  [16, 5, 2.5, 14.7, 1.5, 2],
  [17, 5, 2.6, 15.7, 1.5, 2],
  [18, 5.1, 2.7, 16.5, 1.5, 2],
  [20, 5.5, 3, 18.5, 1.75, 2],
  [22, 6, 3.1, 20.5, 1.75, 2],
  [24, 6.3, 3.2, 22.2, 1.75, 2],
  [25, 6.4, 3.4, 23.2, 2, 2],
  [28, 6.5, 3.5, 25.9, 2, 2],
  [30, 6.5, 4.1, 27.9, 2, 2],
  [32, 6.5, 4.1, 29.6, 2, 2.5],
  [34, 6.6, 4.2, 31.5, 2.5, 2.5],
  [35, 6.7, 4.2, 32.2, 2.5, 2.5],
  [38, 6.8, 4.3, 35.2, 2.5, 2.5],
  [40, 7, 4.4, 36.5, 2.5, 2.5],
  [42, 7.2, 4.5, 38.5, 2.5, 2.5],
  [45, 7.5, 4.7, 41.5, 2.5, 2.5],
  [48, 7.8, 5, 44.5, 2.5, 2.5],
  [50, 8, 5.1, 45.8, 3, 2.5],
  [52, 8.2, 5.2, 47.8, 3, 2.5],
  [55, 8.5, 5.4, 50.8, 3, 2.5],
  [58, 8.8, 5.6, 53.8, 3, 2.5],
  [60, 9, 5.8, 55.8, 3, 2.5],
  [65, 9.3, 6.3, 60.8, 4, 3],
  [70, 9.5, 6.6, 65.5, 4, 3],
  [75, 9.7, 7, 70.5, 4, 3],
  [80, 9.8, 7.4, 74.5, 4, 3],
  [85, 10, 7.8, 79.5, 4, 3.5],
  [90, 10.2, 8.2, 84.5, 4, 3.5],
  [100, 10.5, 9, 94.5, 4, 3.5],
];

const DIN_472: readonly DinRow[] = [
  [8, 2.4, 1.1, 8.7, 0.8, 1],
  [9, 2.5, 1.3, 9.8, 0.8, 1],
  [10, 3.2, 1.4, 10.8, 1, 1.2],
  [11, 3.3, 1.5, 11.8, 1, 1.2],
  [12, 3.4, 1.7, 13, 1, 1.5],
  [13, 3.6, 1.8, 14.1, 1, 1.5],
  [14, 3.7, 1.9, 15.1, 1, 1.7],
  [15, 3.7, 2, 16.2, 1, 1.7],
  [16, 3.8, 2, 17.3, 1, 1.7],
  [17, 3.9, 2.1, 18.3, 1, 1.7],
  [18, 4.1, 2.2, 19.5, 1, 2],
  [19, 4.1, 2.2, 20.5, 1, 2],
  [20, 4.2, 2.3, 21.5, 1, 2],
  [21, 4.2, 2.4, 22.5, 1, 2],
  [22, 4.2, 2.5, 23.5, 1, 2],
  [24, 4.4, 2.6, 25.9, 1.2, 2],
  [25, 4.5, 2.7, 26.9, 1.2, 2],
  [26, 4.7, 2.8, 27.9, 1.2, 2],
  [28, 4.8, 2.9, 30.1, 1.2, 2],
  [30, 4.8, 3, 32.1, 1.2, 2],
  [31, 5.2, 3.2, 33.4, 1.2, 2.5],
  [32, 5.4, 3.2, 34.4, 1.2, 2.5],
  [34, 5.4, 3.3, 36.5, 1.5, 2.5],
  [35, 5.4, 3.4, 37.8, 1.5, 2.5],
  [36, 5.4, 3.5, 38.8, 1.5, 2.5],
  [37, 5.5, 3.7, 39.8, 1.5, 2.5],
  [38, 5.5, 3.7, 40.8, 1.5, 2.5],
  [40, 5.8, 3.9, 43.5, 1.75, 2.5],
  [42, 5.9, 4.1, 45.5, 1.75, 2.5],
  [45, 6.2, 4.3, 48.5, 1.75, 2.5],
  [47, 6.4, 4.4, 50.5, 1.75, 2.5],
  [48, 6.4, 4.5, 51.5, 1.75, 2.5],
  [50, 6.5, 4.6, 54.2, 2, 2.5],
  [52, 6.7, 4.7, 56.2, 2, 2.5],
  [55, 6.8, 5, 59.2, 2, 2.5],
  [56, 6.8, 5.1, 60.2, 2, 2.5],
  [58, 6.9, 5.2, 62.2, 2, 2.5],
  [60, 7.3, 5.4, 64.2, 2, 2.5],
  [62, 7.3, 5.5, 66.2, 2, 2.5],
  [63, 7.3, 5.6, 67.2, 2, 2.5],
  [65, 7.6, 5.8, 69.2, 2.5, 3],
  [68, 7.8, 6.1, 72.5, 2.5, 3],
  [70, 7.8, 6.2, 74.5, 2.5, 3],
  [72, 7.8, 6.4, 76.5, 2.5, 3],
  [75, 7.8, 6.6, 79.5, 2.5, 3],
  [78, 7.9, 6.8, 82.5, 2.5, 3],
  [80, 8.5, 7, 85.5, 2.5, 3],
  [82, 8.5, 7, 87.5, 2.5, 3],
  [85, 8.6, 7.2, 90.5, 3, 3.5],
  [88, 8.6, 7.4, 93.5, 3, 3.5],
  [90, 8.6, 7.6, 95.5, 3, 3.5],
  [92, 8.7, 7.8, 97.5, 3, 3.5],
  [95, 8.8, 8.1, 100.5, 3, 3.5],
  [98, 9, 8.3, 103.5, 3, 3.5],
  [100, 9.2, 8.4, 105.5, 3, 3.5],
  [102, 9.5, 8.5, 108, 4, 3.5],
  [105, 9.5, 8.7, 112, 4, 3.5],
  [108, 9.5, 8.9, 115, 4, 3.5],
  [110, 10.4, 9, 117, 4, 3.5],
  [112, 10.5, 9.1, 119, 4, 3.5],
  [115, 10.5, 9.3, 122, 4, 3.5],
  [120, 11, 9.7, 127, 4, 3.5],
  [125, 11, 10, 132, 4, 4],
  [130, 11, 10.2, 137, 4, 4],
  [135, 11.2, 10.5, 142, 4, 4],
  [140, 11.2, 10.7, 147, 4, 4],
  [145, 11.4, 10.9, 152, 4, 4],
  [150, 12, 11.2, 158, 4, 4],
  [155, 12, 11.4, 164, 4, 4],
  [160, 13, 11.6, 169, 4, 4],
  [165, 13, 11.8, 174.5, 4, 4],
  [170, 13.5, 12.2, 179.5, 4, 4],
  [175, 13.5, 12.7, 184.5, 4, 4],
  [180, 14.2, 13.2, 189.5, 4, 4],
  [185, 14.2, 13.7, 194.5, 4, 4],
  [190, 14.2, 13.8, 199.5, 4, 4],
  [195, 14.2, 13.8, 204.5, 4, 4],
  [200, 14.2, 14, 209.5, 4, 4],
  [210, 14.2, 14, 222, 5, 4],
  [220, 14.2, 14, 232, 5, 4],
  [230, 14.2, 14, 242, 5, 4],
  [240, 14.2, 14, 252, 5, 4],
  [250, 14.2, 14, 262, 5, 4],
  [260, 16.2, 16, 275, 5, 5],
  [270, 16.2, 16, 285, 5, 5],
  [280, 16.2, 16, 295, 5, 5],
  [290, 16.2, 16, 305, 5, 5],
  [300, 16.2, 16, 315, 5, 5],
];

const DIN_472_HEAVY: readonly DinRow[] = [
  [20, 4.5, 2.4, 21.5, 1.5, 2],
  [22, 4.7, 2.8, 23.5, 1.5, 2],
  [24, 4.9, 3, 25.9, 1.5, 2],
  [25, 5, 3.1, 26.9, 1.5, 2],
  [26, 5.1, 3.1, 27.9, 1.5, 2],
  [28, 5.3, 3.2, 30.1, 1.5, 2],
  [30, 5.5, 3.3, 32.1, 1.5, 2],
  [32, 5.7, 3.4, 34.4, 1.5, 2],
  [34, 5.9, 3.7, 36.5, 1.75, 2.5],
  [35, 6, 3.8, 37.8, 1.75, 2.5],
  [37, 6.2, 3.9, 39.8, 1.75, 2.5],
  [38, 6.3, 3.9, 40.8, 1.75, 2.5],
  [40, 6.5, 3.9, 43.5, 2, 2.5],
  [42, 6.7, 4.1, 45.5, 2, 2.5],
  [45, 7, 4.3, 48.5, 2, 2.5],
  [47, 7.2, 4.4, 50.5, 2, 2.5],
  [50, 7.5, 4.6, 54.2, 2.5, 2.5],
  [52, 7.7, 4.7, 56.2, 2.5, 2.5],
  [55, 8, 5, 59.2, 2.5, 2.5],
  [60, 8.5, 5.4, 64.2, 3, 2.5],
  [62, 8.6, 5.5, 66.2, 3, 2.5],
  [65, 8.7, 5.8, 69.2, 3, 3],
  [68, 8.8, 6.1, 72.5, 3, 3],
  [70, 9, 6.2, 74.5, 3, 3],
  [72, 9.2, 6.4, 76.5, 3, 3],
  [75, 9.3, 6.6, 79.5, 3, 3],
  [80, 9.5, 7, 85.5, 4, 3],
  [85, 9.7, 7.2, 90.5, 4, 3.5],
  [90, 10, 7.6, 95.5, 4, 3.5],
  [95, 10.3, 8.1, 100.5, 4, 3.5],
  [100, 10.5, 8.4, 105.5, 4, 3.5],
];

/**
 * DIN gives a circlip's widest section (b) and lug (a) but not where the band is narrowest; Rodeo
 * takes 0.58 of b, as ANSI's tapered rings run.
 */
const NARROWEST = "; its narrowest section, which DIN doesn't give, is 0.58 of its widest";
const dinSizes = (rows: readonly DinRow[], internal: boolean): readonly RingSize[] =>
  rows.map(([d1, a, b, d3, s, d5]) => sized(d1, { form: "circlip", internal, free: d3, thickness: s, widest: b, narrowest: 0.58 * b, lug: a, hole: d5 }));

export type DinRingType = "bores" | "boresHeavy" | "shafts" | "shaftsHeavy";

/** Retaining Ring (DIN)'s types, VW's names. */
export const DIN_RINGS: readonly { readonly id: DinRingType; readonly label: string; readonly source: string; readonly sizes: readonly RingSize[] }[] = [
  { id: "bores", label: "Bores, Regular", source: `DIN 472${NARROWEST}`, sizes: dinSizes(DIN_472, true) },
  { id: "boresHeavy", label: "Bores, Heavy", source: `DIN 472, heavy type${NARROWEST}`, sizes: dinSizes(DIN_472_HEAVY, true) },
  { id: "shafts", label: "Shafts, Regular", source: `DIN 471${NARROWEST}`, sizes: dinSizes(DIN_471, false) },
  { id: "shaftsHeavy", label: "Shafts, Heavy", source: `DIN 471, heavy type${NARROWEST}`, sizes: dinSizes(DIN_471_HEAVY, false) },
];

/** DIN 6799 retaining washers: groove d2, thickness s, opening a, outside d3. */
const DIN_6799: readonly (readonly [number, number, number, number])[] = [
  [0.8, 0.2, 0.58, 2.25],
  [1.2, 0.3, 1.01, 3.25],
  [1.5, 0.4, 1.28, 4.25],
  [1.9, 0.5, 1.61, 4.8],
  [2.3, 0.6, 1.94, 6.3],
  [3.2, 0.6, 2.7, 7.3],
  [4, 0.7, 3.34, 9.3],
  [5, 0.7, 4.11, 11.3],
  [6, 0.7, 5.26, 12.3],
  [7, 0.9, 5.84, 14.3],
  [8, 1, 6.52, 16.3],
  [9, 1.1, 7.63, 18.8],
  [10, 1.2, 8.32, 20.4],
  [12, 1.3, 10.45, 23.4],
  [15, 1.5, 12.61, 29.4],
  [19, 1.75, 15.92, 37.6],
  [24, 2, 21.88, 44.6],
  [30, 2.5, 25.8, 52.6],
];

/**
 * Retaining Washer (DIN)'s sizes by groove diameter: its prongs drawn on the groove, a across the
 * lower two; DIN 6799 gives no band, so Rodeo takes a tenth of the outside.
 */
export const RETAINING_WASHERS: readonly RingSize[] = DIN_6799.map(([d2, s, a, d3]) =>
  sized(d2, { form: "e", inside: d2, outside: d3, thickness: s, band: 0.1 * d3, opening: a, reinforced: false }),
);
