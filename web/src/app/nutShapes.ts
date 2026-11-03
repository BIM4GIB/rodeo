// Nuts from Vectorworks' Fasteners tool set, in 2D: Acorn Nut (inch, SAE J483 low and high crown),
// Hex Cap Nut (DIN 1587) and Knurled Thumb Nut (DIN 466, and inch sizes in its proportions). A nut
// stands crown or head up as VW's pictures show it, its bearing face's centre on the origin; from
// the front a hex nut shows three faces (across its corners), from the side two (across its
// flats), each face's chamfered ends drawn as arcs; from the top it's centred on the origin, two
// corners left and right. Sizes are mm.

import type { Pt } from "../core/index.ts";
import { acorn, arc, dome, type FastenerDrawing } from "./rivetShapes.ts";
import { lathe, type Solid } from "./solids3d.ts";

const INCH = 25.4;
const empty = (): FastenerDrawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });

/** Points along the circular arc through a, m and b (a straight line if they're in line). */
function arcThrough(a: Pt, m: Pt, b: Pt, steps = 8): Pt[] {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12) return [a, b];
  const sq = (p: Pt): number => p.x * p.x + p.y * p.y;
  const c = { x: (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d, y: (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  let a1 = Math.atan2(b.y - c.y, b.x - c.x);
  const am = Math.atan2(m.y - c.y, m.x - c.x);
  // sweep the way that passes m
  const norm = (t: number): number => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0);
  a1 = ccw ? a0 + norm(a1 - a0) : a0 - norm(a0 - a1);
  return arc(c, r, a0, a1, steps);
}

export type HexView = "front" | "side" | "top";

/** A hex nut's body: across its flats, high, and how far its 30° chamfers drop its corners. */
export interface HexBody {
  readonly flats: number;
  readonly height: number;
}

const corners = (h: HexBody): number => h.flats / Math.cos(Math.PI / 6);
/** how far the chamfers (to a circle 0.95 of the flats) drop a corner below the face */
const drop = (h: HexBody): number => Math.min(((corners(h) - 0.95 * h.flats) / 2) * Math.tan(Math.PI / 6), h.height / 4);

/** Which ends of a body its 30° chamfers drop the corners at. */
export type Chamfered = "both" | "top" | "none";

/** A prism's faces seen across it at x0 < x1 < …, its bearing face on y = 0, chamfered ends dropping its corners by `c`: its bottom and top edges, left to right, and the edges between faces. */
export function prismFaces(xs: readonly number[], height: number, c: number, chamfered: Chamfered): { bottom: Pt[]; top: Pt[]; lines: Pt[][] } {
  const bottom: Pt[] = [];
  const top: Pt[] = [];
  const cb = chamfered === "both" ? c : 0;
  const ct = chamfered === "none" ? 0 : c;
  for (let i = 0; i + 1 < xs.length; i++) {
    const [x0, x1] = [xs[i], xs[i + 1]];
    const mid = (x0 + x1) / 2;
    const lo = arcThrough({ x: x0, y: cb }, { x: mid, y: 0 }, { x: x1, y: cb });
    const hi = arcThrough({ x: x0, y: height - ct }, { x: mid, y: height }, { x: x1, y: height - ct });
    bottom.push(...(i === 0 ? lo : lo.slice(1)));
    top.push(...(i === 0 ? hi : hi.slice(1)));
  }
  return { bottom, top, lines: xs.slice(1, -1).map((x) => [{ x, y: cb }, { x, y: height - ct }]) };
}

/** The hex body from the front (three faces) or side (two), its bearing face on y = 0: the outline and the edges between faces. */
export function hexSide(h: HexBody, view: "front" | "side", chamfered: Chamfered = "both"): { outline: Pt[]; lines: Pt[][]; half: number } {
  const G = corners(h);
  const xs = view === "front" ? [-G / 2, -G / 4, G / 4, G / 2] : [-h.flats / 2, 0, h.flats / 2];
  const f = prismFaces(xs, h.height, drop(h), chamfered);
  return { outline: [...f.bottom, ...f.top.reverse()], lines: f.lines, half: xs[xs.length - 1] };
}

/** The hex body from the top: the hexagon, two corners left and right. */
export function hexTop(h: HexBody): Pt[] {
  const R = corners(h) / 2;
  return Array.from({ length: 6 }, (_, i) => ({ x: R * Math.cos((i * Math.PI) / 3), y: R * Math.sin((i * Math.PI) / 3) }));
}

/** Centre lines: the axis from below the bearing face to above `top`, or across the top view. */
function axis(d: FastenerDrawing, view: HexView, top: number, half: number, beyond: number | null): void {
  if (beyond === null) return;
  if (view === "top") d.lines.push([{ x: -half - beyond, y: 0 }, { x: half + beyond, y: 0 }], [{ x: 0, y: -half - beyond }, { x: 0, y: half + beyond }]);
  else d.lines.push([{ x: 0, y: -beyond }, { x: 0, y: top + beyond }]);
}

// ---- acorn and hex cap nuts -----------------------------------------------------------------

export type CrownStyle = "low" | "high";

/** SAE J483 acorn nuts, inch: size, thread, F (flats), A (crown across), and per crown H (overall), Q (hex), R (nose), S (body radius). */
const ACORN_ROWS: readonly (readonly [string, string, number, number, readonly [number, number, number, number], readonly [number, number, number, number]])[] = [
  ["#6", "#6-32", 0.3125, 0.3, [0.34, 0.16, 0.08, 0.17], [0.42, 0.17, 0.05, 0.25]],
  ["#8", "#8-32", 0.3125, 0.3, [0.34, 0.16, 0.08, 0.17], [0.42, 0.17, 0.05, 0.25]],
  ["#10", "#10-24", 0.375, 0.36, [0.41, 0.19, 0.09, 0.22], [0.52, 0.2, 0.06, 0.3]],
  ["#12", "#12-24", 0.375, 0.36, [0.41, 0.19, 0.09, 0.22], [0.52, 0.2, 0.06, 0.3]],
  ["1/4", "1/4-20", 0.4375, 0.41, [0.47, 0.22, 0.11, 0.25], [0.59, 0.23, 0.06, 0.34]],
  ["5/16", "5/16-18", 0.5, 0.47, [0.53, 0.25, 0.12, 0.28], [0.69, 0.28, 0.08, 0.41]],
  ["3/8", "3/8-16", 0.5625, 0.53, [0.62, 0.28, 0.14, 0.33], [0.78, 0.31, 0.09, 0.44]],
  ["7/16", "7/16-14", 0.625, 0.59, [0.69, 0.31, 0.16, 0.36], [0.88, 0.34, 0.09, 0.5]],
  ["1/2", "1/2-13", 0.75, 0.72, [0.81, 0.38, 0.19, 0.42], [1.03, 0.42, 0.12, 0.59]],
  ["9/16", "9/16-12", 0.875, 0.84, [0.94, 0.44, 0.22, 0.5], [1.19, 0.48, 0.16, 0.69]],
  ["5/8", "5/8-11", 0.9375, 0.91, [1.0, 0.47, 0.23, 0.53], [1.28, 0.53, 0.16, 0.75]],
  ["3/4", "3/4-10", 1.0625, 1.03, [1.16, 0.53, 0.27, 0.59], [1.45, 0.59, 0.17, 0.84]],
  ["7/8", "7/8-9", 1.25, 1.22, [1.36, 0.62, 0.31, 0.7], [1.72, 0.7, 0.2, 0.98]],
  ["1", "1-8", 1.4375, 1.41, [1.55, 0.72, 0.36, 0.81], [1.97, 0.81, 0.23, 1.14]],
  ["1-1/8", "1-1/8-7", 1.625, 1.59, [1.75, 0.81, 0.41, 0.92], [2.22, 0.92, 0.27, 1.28]],
  ["1-1/4", "1-1/4-7", 1.8125, 1.78, [1.95, 0.91, 0.45, 1.03], [2.47, 1.03, 0.28, 1.44]],
];

export interface AcornSize {
  readonly id: string;
  readonly label: string;
  readonly flats: number;
  readonly crown: number;
  readonly low: { readonly height: number; readonly hex: number; readonly nose: number; readonly body: number };
  readonly high: { readonly height: number; readonly hex: number; readonly nose: number; readonly body: number };
}

export const ACORN_INCH: readonly AcornSize[] = ACORN_ROWS.map(([id, label, F, A, low, high]) => {
  const crown = ([H, Q, R, S]: readonly [number, number, number, number]) => ({ height: H * INCH, hex: Q * INCH, nose: R * INCH, body: S * INCH });
  return { id, label, flats: F * INCH, crown: A * INCH, low: crown(low), high: crown(high) };
});

/** DIN 1587 hexagon domed cap nuts: d, P, dk (dome), h (overall), m (hex), s (flats), mm. */
const DIN_1587: readonly (readonly [number, number, number, number, number, number])[] = [
  [4, 0.7, 6.5, 8, 4.1, 7],
  [5, 0.8, 7.5, 10, 5.4, 8],
  [6, 1, 9.5, 12, 6, 10],
  [8, 1.25, 12.5, 15, 8.5, 13],
  [10, 1.5, 15, 18, 10, 16],
  [12, 1.75, 17, 22, 11.7, 18],
  [14, 2, 20, 25, 13, 21],
  [16, 2, 23, 28, 16, 24],
  [18, 2.5, 26, 32, 18.7, 27],
  [20, 2.5, 28, 34, 19.7, 30],
  [22, 2.5, 33, 39, 22.7, 32],
  [24, 3, 34, 42, 23.5, 36],
];

export interface CapNutSize {
  readonly id: string;
  readonly label: string;
  readonly dome: number;
  readonly height: number;
  readonly hex: number;
  readonly flats: number;
}

export const HEX_CAP_DIN: readonly CapNutSize[] = DIN_1587.map(([d, P, dk, h, m, s]) => ({ id: `M${d}`, label: `M${d} × ${P}`, dome: dk, height: h, hex: m, flats: s }));

/** A crowned hex nut: its hex body and the crown's profile (right half, from its top on the axis down to its base at the hex's top). */
interface CrownedNut {
  readonly body: HexBody;
  readonly across: number;
  readonly crown: Pt[];
  readonly height: number;
}

export function acornNut(s: AcornSize, style: CrownStyle): CrownedNut {
  const c = s[style];
  const profile = acorn(s.crown / 2, c.height - c.hex, c.body, c.nose);
  return { body: { flats: s.flats, height: c.hex }, across: s.crown, crown: profile.map((p) => ({ x: p.x, y: p.y + c.hex })), height: c.height };
}

export function hexCapNut(s: CapNutSize): CrownedNut {
  const R = s.dome / 2;
  const rise = s.height - s.hex;
  // a hemisphere on a short band, or a flatter cap where the dome is lower than its radius
  const profile = rise >= R ? [...arc({ x: 0, y: rise - R }, R, Math.PI / 2, 0), { x: R, y: 0 }] : dome((R * R + rise * rise) / (2 * rise), rise, R);
  return { body: { flats: s.flats, height: s.hex }, across: s.dome, crown: profile.map((p) => ({ x: p.x, y: p.y + s.hex })), height: s.height };
}

/** An acorn or hex cap nut from the front, side or top. */
export function crownedNut(n: CrownedNut, view: HexView, beyond: number | null): FastenerDrawing {
  const d = empty();
  if (view === "top") {
    d.outlines.push(hexTop(n.body));
    d.circles.push({ center: { x: 0, y: 0 }, radius: n.across / 2 });
    axis(d, view, 0, corners(n.body) / 2, beyond);
    return d;
  }
  const hex = hexSide(n.body, view);
  d.outlines.push(hex.outline);
  d.lines.push(...hex.lines);
  // the crown, open at its base where it sits on the hex
  d.lines.push([...n.crown.slice().reverse().map((p) => ({ x: -p.x, y: p.y })), ...n.crown.slice(1)]);
  axis(d, view, n.height, hex.half, beyond);
  return d;
}

/** An acorn or hex cap nut standing on its bearing face: closed underneath, without its threaded hole, the crown turned on a chamfered hex. */
export function crownedNutSolid(n: CrownedNut): Solid {
  const G = corners(n.body);
  const c = drop(n.body);
  const profile: Pt[] = [{ x: 0, y: 0 }, { x: (0.95 * n.body.flats) / 2, y: 0 }, { x: G / 2, y: c }, { x: G / 2, y: n.body.height - c }, { x: (0.95 * n.body.flats) / 2, y: n.body.height }];
  return [...lathe(profile.concat({ x: 0, y: n.body.height }), hexTop(n.body)), ...lathe([{ x: 0, y: n.body.height }, ...n.crown.slice().reverse()].reverse())];
}

// ---- knurled thumb nuts ------------------------------------------------------------------

/** DIN 466 knurled nuts, high type: d, P, dk (knurl), ds (collar), h (overall), k (knurl height), mm. */
const DIN_466: readonly (readonly [number, number, number, number, number, number])[] = [
  [1, 0.25, 5.5, 2.8, 3.5, 1.5],
  [1.2, 0.25, 6, 3, 4, 1.5],
  [1.4, 0.3, 7, 3.5, 4.7, 2],
  [1.6, 0.35, 7.5, 3.8, 5, 2],
  [2, 0.4, 9, 4.5, 5.3, 2],
  [2.5, 0.45, 11, 5, 6.5, 2.5],
  [3, 0.5, 12, 6, 7.5, 2.5],
  [4, 0.7, 16, 8, 9.5, 3.5],
  [5, 0.8, 20, 10, 11.5, 4],
  [6, 1, 24, 12, 15, 5],
  [8, 1.25, 30, 16, 18, 6],
  [10, 1.5, 36, 20, 23, 8],
];

export interface KnurledSize {
  readonly id: string;
  readonly label: string;
  /** the thread's major diameter and pitch */
  readonly thread: number;
  readonly pitch: number;
  readonly knurl: number;
  readonly collar: number;
  readonly height: number;
  readonly head: number;
}

export const KNURLED_DIN: readonly KnurledSize[] = DIN_466.map(([d, P, dk, ds, h, k]) => ({ id: `M${d}`, label: `M${d} × ${P}`, thread: d, pitch: P, knurl: dk, collar: ds, height: h, head: k }));

/** Inch knurled thumb nuts, which no free standard tabulates: DIN 466's sizes interpolated by diameter (Rodeo's reading). */
const INCH_THREADS: readonly (readonly [string, number, number])[] = [
  ["#4-40 UNC", 0.112, 40],
  ["#6-32 UNC", 0.138, 32],
  ["#8-32 UNC", 0.164, 32],
  ["#10-24 UNC", 0.19, 24],
  ["#10-32 UNF", 0.19, 32],
  ["1/4-20 UNC", 0.25, 20],
  ["1/4-28 UNF", 0.25, 28],
  ["5/16-18 UNC", 0.3125, 18],
  ["5/16-24 UNF", 0.3125, 24],
  ["3/8-16 UNC", 0.375, 16],
  ["3/8-24 UNF", 0.375, 24],
  ["1/2-13 UNC", 0.5, 13],
  ["1/2-20 UNF", 0.5, 20],
];

/** DIN 466's column `i` at diameter `d` mm, interpolated between its rows (and carried on past its last two). */
function din466At(d: number, i: 2 | 3 | 4 | 5): number {
  const rows = DIN_466;
  let j = rows.findIndex((r) => r[0] >= d);
  if (j <= 0) j = j === 0 ? 1 : rows.length - 1;
  const [a, b] = [rows[j - 1], rows[j]];
  return a[i] + ((b[i] - a[i]) * (d - a[0])) / (b[0] - a[0]);
}

export const KNURLED_INCH: readonly KnurledSize[] = INCH_THREADS.map(([label, D, tpi]) => {
  const d = D * INCH;
  return { id: label, label, thread: d, pitch: INCH / tpi, knurl: din466At(d, 2), collar: din466At(d, 3), height: din466At(d, 4), head: din466At(d, 5) };
});

/** The knurl's pitch along the head's rim, mm (Rodeo's reading of DIN 82's fine knurls). */
const KNURL_PITCH = 0.8;

/** A knurled thumb nut from the front, head up on its collar, or from the top; `detail` draws the knurl. */
export function knurledNut(s: KnurledSize, view: "front" | "top", detail: boolean, beyond: number | null): FastenerDrawing {
  const d = empty();
  const R = s.knurl / 2;
  const ch = s.head * 0.1;
  if (view === "top") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: R }, { center: { x: 0, y: 0 }, radius: R - ch });
    // the threaded hole: its major diameter and its minor
    d.circles.push({ center: { x: 0, y: 0 }, radius: s.thread / 2 }, { center: { x: 0, y: 0 }, radius: s.thread / 2 - 0.6134 * s.pitch });
    axis(d, view, 0, R, beyond);
    return d;
  }
  const r = s.collar / 2;
  const base = s.height - s.head;
  // the fillet where the collar meets the head's underside
  const f = Math.min((R - r) * 0.25, base * 0.3);
  const right: Pt[] = [
    { x: r, y: 0 },
    ...arc({ x: r + f, y: base - f }, f, Math.PI, Math.PI / 2, 6),
    { x: R - ch, y: base },
    { x: R, y: base + ch },
    { x: R, y: s.height - ch },
    { x: R - ch, y: s.height },
  ];
  d.outlines.push([...right, ...right.slice().reverse().map((p) => ({ x: -p.x, y: p.y }))]);
  d.lines.push([{ x: -R, y: base + ch }, { x: R, y: base + ch }], [{ x: -R, y: s.height - ch }, { x: R, y: s.height - ch }]);
  if (detail) {
    // the knurl's straight ridges, seen round the rim's front half, and running out across the chamfers
    const n = Math.max(12, Math.round((Math.PI * s.knurl) / KNURL_PITCH / 2) * 2);
    for (let i = 0; i < n / 2; i++) {
      const x = R * Math.sin(-Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / n);
      const inner = (x * (R - ch)) / R;
      d.lines.push([{ x: inner, y: base }, { x, y: base + ch }, { x, y: s.height - ch }, { x: inner, y: s.height }]);
    }
  }
  axis(d, view, s.height, R, beyond);
  return d;
}
