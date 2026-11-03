// Wing nuts from Vectorworks' Fasteners tool set, in 2D: Wing Nut (DIN 315) and Wing Nut - Type A
// to D (inch, ASME B18.6.9). A wing nut stands wings up on its bearing face, whose centre is on the
// origin: from the front its wings spread left and right, from the side one stands edge on, from
// the top it's centred on the origin with the wings along x. Solid nuts (DIN, Types A and B) have
// a boss and two lobed wings; die cast ones (Type C) have hollow wings; stamped ones (Type D) are
// a bent strip on a flat base. Sizes are mm.

import type { Pt } from "../core/index.ts";
import { arc, type FastenerDrawing } from "./rivetShapes.ts";
import { clipOutline, lathe, onEdge, prism, type Solid } from "./solids3d.ts";

const INCH = 25.4;
const empty = (): FastenerDrawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });
const rad = (deg: number): number => (deg * Math.PI) / 180;
const mirror = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y }));

/** Points along the quadratic Bézier from a through control c to b, a excluded. */
function bezier(a: Pt, c: Pt, b: Pt, steps = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
  }
  return out;
}

export type WingForm = "solid" | "hollow" | "stamped";
export type WingView = "front" | "side" | "top";

/** A wing nut's sizes, mm: ASME's A (spread), B (height), C (wing thickness), D (between wings), E (boss), G (boss height). */
export interface Wing {
  readonly spread: number;
  readonly height: number;
  readonly thickness: number;
  readonly between: number;
  readonly boss: number;
  readonly bossHeight: number;
  /** the thread's major diameter */
  readonly thread: number;
  readonly form: WingForm;
}

/** Why the wing nut can't be drawn, or null. */
export function wingProblem(w: Wing): string | null {
  if (!(w.height > w.bossHeight)) return "its wings must stand higher than its boss";
  if (!(w.spread > w.boss)) return "its wings must spread wider than its boss";
  return null;
}

/** The right wing of a solid or die cast nut from the front: its outline from where it leaves the boss's side, round its tip, down to the boss's top between the wings. */
function frontWing(w: Wing): { pts: Pt[]; tip: Pt; radius: number; root: Pt } {
  const top = (w.boss / 2) * 0.85;
  const radius = Math.min((w.height - w.bossHeight) * 0.45, (w.spread / 2 - top) * 0.45);
  const tip = { x: w.spread / 2 - radius, y: w.height - radius };
  const root = { x: w.boss / 2 - (w.boss / 2 - top) * 0.5, y: w.bossHeight * 0.5 };
  const lowAngle = rad(-100);
  const highAngle = rad(135);
  const low = { x: tip.x + radius * Math.cos(lowAngle), y: tip.y + radius * Math.sin(lowAngle) };
  const high = { x: tip.x + radius * Math.cos(highAngle), y: tip.y + radius * Math.sin(highAngle) };
  const inner = { x: Math.min(w.between / 2, top), y: w.bossHeight };
  const pts = [
    root,
    ...bezier(root, { x: root.x + (low.x - root.x) * 0.7, y: root.y + (low.y - root.y) * 0.1 }, low),
    ...arc(tip, radius, lowAngle, highAngle, 14).slice(1),
    ...bezier(high, { x: inner.x + (high.x - inner.x) * 0.2, y: high.y }, inner),
  ];
  return { pts, tip, radius, root };
}

/** A stamped nut's strip from the front: its centre line's right half, from the axis out along the base and up to the tip. */
function stampedPath(w: Wing): Pt[] {
  const t = w.thickness;
  const base = w.boss / 2;
  const tip = { x: w.spread / 2 - t / 2, y: w.height - t / 2 };
  // the wing sweeps up and out from the base, its end curling outward
  const curl = { x: tip.x - (tip.x - base) * 0.15, y: tip.y - t };
  return [
    { x: 0, y: t / 2 },
    { x: base, y: t / 2 },
    ...bezier({ x: base, y: t / 2 }, { x: base + (curl.x - base) * 0.45, y: t / 2 }, curl),
    ...bezier(curl, { x: curl.x + (tip.x - curl.x) * 0.3, y: tip.y }, tip, 4),
  ];
}

/** A strip `t` thick along `path`, as a closed outline. */
function strip(path: readonly Pt[], t: number): Pt[] {
  const side = (s: 1 | -1): Pt[] =>
    path.map((p, i) => {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - (s * (b.y - a.y) * t) / (2 * len), y: p.y + (s * (b.x - a.x) * t) / (2 * len) };
    });
  return [...side(1), ...side(-1).reverse()];
}

/** The thread's hole, hidden in the boss from the front or side. */
function hiddenHole(d: FastenerDrawing, w: Wing, up: number): void {
  for (const x of [-w.thread / 2, w.thread / 2]) d.hidden.push([{ x, y: 0 }, { x, y: up }]);
}

/** A wing nut from the front, side or top, with centre lines `beyond` past it. */
export function wingNut(w: Wing, view: WingView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const t = w.thickness;
  if (view === "top") {
    // the wings as a strip along x past the boss, rounded at their tips
    const half = w.form === "stamped" ? (w.boss * 0.45) / 2 : (t / 2) * 1.2;
    const from = Math.sqrt(Math.max(0, (w.boss / 2) ** 2 - half * half));
    const tip = { x: w.spread / 2 - half, y: 0 };
    const right = [{ x: from, y: half }, { x: tip.x, y: half }, ...arc(tip, half, Math.PI / 2, -Math.PI / 2, 10).slice(1), { x: from, y: -half }];
    d.lines.push(right, mirror(right));
    d.circles.push({ center: { x: 0, y: 0 }, radius: w.boss / 2 }, { center: { x: 0, y: 0 }, radius: w.thread / 2 }, { center: { x: 0, y: 0 }, radius: w.thread * 0.42 });
    if (w.form === "hollow") d.circles.push({ center: { x: 0, y: 0 }, radius: w.boss * 0.38 + w.thread * 0.12 });
    if (beyond !== null) {
      const R = w.spread / 2 + beyond;
      d.lines.push([{ x: -R, y: 0 }, { x: R, y: 0 }], [{ x: 0, y: -w.boss / 2 - beyond }, { x: 0, y: w.boss / 2 + beyond }]);
    }
    return d;
  }
  if (w.form === "stamped") {
    if (view === "front") {
      const path = stampedPath(w);
      const whole = [...mirror(path).reverse(), ...path.slice(1)];
      d.outlines.push(strip(whole, t));
      // the collar drawn up round the hole
      const c = w.thread * 0.75;
      d.lines.push([{ x: -c, y: t }, { x: -c, y: t + w.bossHeight * 0.4 }, { x: c, y: t + w.bossHeight * 0.4 }, { x: c, y: t }]);
      hiddenHole(d, w, t + w.bossHeight * 0.4);
    } else {
      // the strip edge on: its base, and the wing standing up as wide as the strip
      const s = w.boss * 0.45;
      d.outlines.push([{ x: -w.boss / 2, y: 0 }, { x: w.boss / 2, y: 0 }, { x: w.boss / 2, y: t }, { x: s / 2, y: t }, { x: s / 2, y: w.height }, { x: -s / 2, y: w.height }, { x: -s / 2, y: t }, { x: -w.boss / 2, y: t }]);
      hiddenHole(d, w, t);
    }
  } else if (view === "front") {
    const wing = frontWing(w);
    const right = [{ x: w.boss / 2, y: 0 }, ...wing.pts];
    d.outlines.push([...mirror(right).reverse(), ...right]);
    // the boss's sides and top behind the wings
    const top = (w.boss / 2) * 0.85;
    const inner = Math.min(w.between / 2, top);
    d.lines.push([wing.root, { x: top, y: w.bossHeight }, { x: inner, y: w.bossHeight }], mirror([wing.root, { x: top, y: w.bossHeight }, { x: inner, y: w.bossHeight }]));
    if (w.form === "hollow") {
      // a die cast wing's hollow, inside its rim
      const r = wing.radius * 0.55;
      const into = { x: wing.root.x + (wing.tip.x - wing.root.x) * 0.35, y: wing.root.y + (wing.tip.y - wing.root.y) * 0.35 + w.bossHeight * 0.3 };
      const hollow = [...arc(wing.tip, r, rad(-110), rad(150), 12), into];
      d.outlines.push(hollow, mirror(hollow));
    }
    hiddenHole(d, w, w.bossHeight);
  } else {
    // a wing edge on, tapering from its root to its rounded top, on the boss
    const top = (w.boss / 2) * 0.85;
    const r = t / 2;
    const root = Math.min(t * 0.8, top);
    d.outlines.push([
      { x: -w.boss / 2, y: 0 },
      { x: w.boss / 2, y: 0 },
      { x: top, y: w.bossHeight },
      { x: root, y: w.bossHeight },
      ...arc({ x: 0, y: w.height - r }, r, 0, Math.PI, 10),
      { x: -root, y: w.bossHeight },
      { x: -top, y: w.bossHeight },
    ]);
    if (w.form === "hollow") d.lines.push([{ x: 0, y: w.bossHeight }, { x: 0, y: w.height - r }]);
    hiddenHole(d, w, w.bossHeight);
  }
  if (beyond !== null) d.lines.push([{ x: 0, y: -beyond }, { x: 0, y: w.height + beyond }]);
  return d;
}

/** The nut as a solid: a boss with the thread's hole through it, and a flat wing each side. A die cast wing's hollow isn't cut. */
export function wingNutSolid(w: Wing): Solid {
  const r = w.thread / 2;
  const R = w.boss / 2;
  const wings = (wing: readonly Pt[], width: number): Solid => [wing, mirror(wing)].flatMap((o) => onEdge(prism([o], -width / 2, width / 2)));
  if (w.form === "stamped") {
    const t = w.thickness;
    const collar = w.thread * 0.75;
    const ring = (out: number, y0: number, y1: number): Solid => lathe([{ x: r, y: y0 }, { x: out, y: y0 }, { x: out, y: y1 }, { x: r, y: y1 }]);
    return [...ring(R, 0, t), ...ring(collar, t, t + w.bossHeight * 0.4), ...wings(strip(stampedPath(w).slice(1), t), w.boss * 0.45)];
  }
  const top = R * 0.85;
  const right = [{ x: R, y: 0 }, ...frontWing(w).pts];
  return [
    ...lathe([{ x: r, y: 0 }, { x: R, y: 0 }, { x: top, y: w.bossHeight }, { x: r, y: w.bossHeight }]),
    ...wings(clipOutline([...mirror(right).reverse(), ...right], (p) => p.x - top), w.thickness),
  ];
}

// ---- sizes -------------------------------------------------------------------------------

export interface WingSize {
  readonly id: string;
  readonly label: string;
  readonly wing: Omit<Wing, "form">;
}

/** DIN 315 wing nuts (rounded wings): d, P, D1 (boss), e (spread), h (height), g (wing), m (boss height), mm; maxima. */
const DIN_315: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [4, 0.7, 8, 20, 10.5, 1.9, 4.6],
  [5, 0.8, 11, 26, 13, 2.3, 6.5],
  [6, 1, 13, 33, 17, 2.3, 8],
  [8, 1.25, 16, 39, 20, 2.8, 10],
  [10, 1.5, 20, 51, 25, 4.4, 12],
  [12, 1.75, 23, 65, 35.5, 4.9, 14],
  [16, 2, 29, 73, 37.5, 6.4, 17],
  [20, 2.5, 35, 90, 46.5, 6.9, 21],
  [24, 3, 44, 110, 56.5, 9.4, 25],
];

export const WING_DIN: readonly WingSize[] = DIN_315.map(([d, P, D1, e, h, g, m]) => ({
  id: `M${d}`,
  label: `M${d} × ${P}`,
  // DIN 315 gives no width between the wings; Rodeo takes 0.7 of the boss
  wing: { spread: e, height: h, thickness: g, between: 0.7 * D1, boss: D1, bossHeight: m, thread: d },
}));

/** An inch row: size, major diameter, threads per inch, series, then A, B, C, D, E, G maxima in inches. */
type InchRow = readonly [string, number, number, string, number, number, number, number, number, number];

const inchSizes = (rows: readonly InchRow[]): readonly WingSize[] =>
  rows.map(([size, D, tpi, series, A, B, C, Dw, E, G]) => ({
    id: `${size}-${tpi}${series ? ` ${series}` : ""}`,
    label: `${size}-${tpi}${series ? ` ${series}` : ""}`,
    wing: { spread: A * INCH, height: B * INCH, thickness: C * INCH, between: Dw * INCH, boss: E * INCH, bossHeight: G * INCH, thread: D * INCH },
  }));

/** ASME B18.6.9 Type A (cold forged), each size in the series it comes in. */
export const WING_A: readonly WingSize[] = inchSizes([
  ["#3", 0.099, 48, "Heavy", 0.72, 0.41, 0.11, 0.21, 0.33, 0.14],
  ["#4", 0.112, 40, "Heavy", 0.72, 0.41, 0.11, 0.21, 0.33, 0.14],
  ["#5", 0.125, 40, "Light", 0.72, 0.41, 0.11, 0.21, 0.33, 0.14],
  ["#5", 0.125, 40, "Heavy", 0.91, 0.47, 0.14, 0.27, 0.43, 0.18],
  ["#6", 0.138, 32, "Light", 0.72, 0.41, 0.11, 0.21, 0.33, 0.14],
  ["#6", 0.138, 32, "Heavy", 0.91, 0.47, 0.14, 0.27, 0.43, 0.18],
  ["#8", 0.164, 32, "Light", 0.91, 0.47, 0.14, 0.27, 0.43, 0.18],
  ["#8", 0.164, 32, "Heavy", 1.1, 0.57, 0.18, 0.33, 0.5, 0.22],
  ["#10", 0.19, 24, "Light", 0.91, 0.47, 0.14, 0.27, 0.43, 0.18],
  ["#10", 0.19, 24, "Heavy", 1.1, 0.57, 0.18, 0.33, 0.5, 0.22],
  ["#12", 0.216, 24, "Light", 1.1, 0.57, 0.18, 0.33, 0.5, 0.22],
  ["#12", 0.216, 24, "Heavy", 1.25, 0.66, 0.21, 0.39, 0.58, 0.25],
  ["1/4", 0.25, 20, "Light", 1.1, 0.57, 0.18, 0.33, 0.5, 0.22],
  ["1/4", 0.25, 20, "Regular", 1.25, 0.66, 0.21, 0.39, 0.58, 0.25],
  ["1/4", 0.25, 20, "Heavy", 1.44, 0.79, 0.24, 0.48, 0.7, 0.3],
  ["5/16", 0.3125, 18, "Light", 1.25, 0.66, 0.21, 0.39, 0.58, 0.25],
  ["5/16", 0.3125, 18, "Regular", 1.44, 0.79, 0.24, 0.48, 0.7, 0.3],
  ["5/16", 0.3125, 18, "Heavy", 1.94, 1.0, 0.33, 0.65, 0.93, 0.39],
  ["3/8", 0.375, 16, "Light", 1.44, 0.79, 0.24, 0.48, 0.7, 0.3],
  ["3/8", 0.375, 16, "Regular", 1.94, 1.0, 0.33, 0.65, 0.93, 0.39],
  ["7/16", 0.4375, 14, "Light", 1.94, 1.0, 0.33, 0.65, 0.93, 0.39],
  ["7/16", 0.4375, 14, "Heavy", 2.76, 1.44, 0.4, 0.9, 1.19, 0.55],
  ["1/2", 0.5, 13, "Light", 1.94, 1.0, 0.33, 0.65, 0.93, 0.39],
  ["1/2", 0.5, 13, "Heavy", 2.76, 1.44, 0.4, 0.9, 1.19, 0.55],
  ["9/16", 0.5625, 12, "Heavy", 2.76, 1.44, 0.4, 0.9, 1.19, 0.55],
  ["5/8", 0.625, 11, "Heavy", 2.76, 1.44, 0.4, 0.9, 1.19, 0.55],
  ["3/4", 0.75, 10, "Heavy", 2.76, 1.44, 0.4, 0.9, 1.19, 0.55],
]);

/** ANSI B18.17 / ASME B18.6.9 Type B (hot forged), Style 1 (moderate wings) and Style 2 (high wings). */
export const WING_B: Readonly<Record<"1" | "2", readonly WingSize[]>> = {
  "1": inchSizes([
    ["#5", 0.125, 40, "", 0.78, 0.36, 0.13, 0.28, 0.31, 0.22],
    ["#10", 0.19, 24, "", 0.97, 0.45, 0.15, 0.34, 0.39, 0.28],
    ["1/4", 0.25, 20, "", 1.16, 0.56, 0.17, 0.41, 0.47, 0.34],
    ["5/16", 0.3125, 18, "", 1.44, 0.67, 0.18, 0.5, 0.55, 0.41],
    ["3/8", 0.375, 16, "", 1.72, 0.8, 0.2, 0.59, 0.63, 0.47],
    ["7/16", 0.4375, 14, "", 2.0, 0.91, 0.21, 0.69, 0.71, 0.53],
    ["1/2", 0.5, 13, "", 2.31, 1.06, 0.23, 0.78, 0.79, 0.62],
    ["9/16", 0.5625, 12, "", 2.59, 1.17, 0.25, 0.88, 0.88, 0.69],
    ["5/8", 0.625, 11, "", 2.84, 1.31, 0.27, 0.94, 0.96, 0.75],
    ["3/4", 0.75, 10, "", 3.31, 1.52, 0.29, 1.1, 1.12, 0.88],
  ]),
  "2": inchSizes([
    ["#5", 0.125, 40, "", 0.81, 0.62, 0.12, 0.28, 0.31, 0.22],
    ["#10", 0.19, 24, "", 1.01, 0.78, 0.14, 0.35, 0.39, 0.28],
    ["1/4", 0.25, 20, "", 1.22, 0.94, 0.16, 0.41, 0.47, 0.34],
    ["5/16", 0.3125, 18, "", 1.43, 1.09, 0.17, 0.48, 0.55, 0.41],
    ["3/8", 0.375, 16, "", 1.63, 1.25, 0.18, 0.55, 0.63, 0.47],
    ["7/16", 0.4375, 14, "", 1.9, 1.42, 0.19, 0.62, 0.71, 0.53],
    ["1/2", 0.5, 13, "", 2.13, 1.58, 0.2, 0.69, 0.79, 0.62],
    ["9/16", 0.5625, 12, "", 2.4, 1.75, 0.22, 0.76, 0.88, 0.69],
    ["5/8", 0.625, 11, "", 2.6, 1.91, 0.23, 0.83, 0.96, 0.75],
    ["3/4", 0.75, 10, "", 3.02, 2.22, 0.24, 0.97, 1.12, 0.88],
  ]),
};

/**
 * Types C (die cast: Style 1 regular, 2 low and 3 high wings) and D (stamped: Style 1 regular, 2
 * low wings, 3 a large base), whose ASME tables aren't published freely: Type B Style 1's sizes
 * scaled for each style (Rodeo's reading); a stamped strip is a tenth of the wing height thick.
 */
export function scaledWing(s: WingSize, type: "C" | "D", style: "1" | "2" | "3"): Wing {
  const w = s.wing;
  if (type === "C") {
    const height = style === "2" ? w.bossHeight + (w.height - w.bossHeight) * 0.6 : style === "3" ? w.height * 1.6 : w.height;
    return { ...w, height, spread: style === "3" ? w.spread * 0.9 : w.spread, thickness: w.thickness * 1.2, form: "hollow" };
  }
  const grow = style === "3" ? 1.3 : 1;
  const height = (style === "2" ? w.height * 0.55 : w.height) * grow;
  return { ...w, spread: w.spread * grow, height, boss: w.boss * (style === "3" ? 2 : 1.2), bossHeight: w.bossHeight * 0.5, thickness: Math.max(w.height * 0.1, 0.5), form: "stamped" };
}
