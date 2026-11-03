// What Event Design's Soft Goods tool draws (tools/softGoods.ts) in Top/Plan, as plain geometry: a
// curtain's or border's pleats along a path of straight runs (a wave the Pleat Width long and the
// Pleat Depth deep, about the path for a curtain, to one side of it for a border), its opening
// with the open stretch as a ghost, the pipe and track it hangs from, markers at its ends and
// where its stock drapes break and overlap; or a pipe-and-drape run: uprights on base plates at
// slider lengths along the path, the sliders between them and the drape (doubled for a double
// wall). Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

export type SoftGoodsFunction = "curtain" | "border" | "pipeDrape";
export type CurtainOpening = "none" | "left" | "right" | "centre";
export type EndMarks = "none" | "start" | "end" | "both";

export interface SoftGoods {
  readonly fn: SoftGoodsFunction;
  readonly centreline: boolean;
  readonly markers: EndMarks;
  readonly pipe: boolean;
  readonly track: boolean;
  readonly trackWidth: number;
  readonly opening: CurtainOpening;
  readonly openingWidth: number;
  readonly centreOverlap: number;
  readonly ghost: boolean;
  /** a border hangs to the path's right instead of its left */
  readonly reverse: boolean;
  readonly adjustStart: number;
  readonly adjustEnd: number;
  readonly stockWidth: number;
  readonly minOverlap: number;
  /** vertical tied fullness, percent */
  readonly fullness: number;
  readonly breaks: boolean;
  readonly overlaps: boolean;
  readonly simple: boolean;
  readonly pleatWidth: number;
  readonly pleatDepth: number;
  readonly flip: boolean;
  readonly doubleWall: boolean;
  readonly sliders: boolean;
  /** about how long each slider is between uprights */
  readonly sliderLength: number;
  readonly baseSize: number;
  readonly baseRound: boolean;
  readonly endHardware: EndMarks;
}

/** What soft goods draw, with their drapes and uprights counted. */
export interface SoftGoodsPlan extends MarkerDrawing {
  /** drawn dashed: the centre line and a ghost of the open stretch */
  readonly hidden: Pt[][];
  readonly drapes: number;
  readonly uprights: number;
}

/** a pipe's diameter, mm: 1½" schedule 40 */
export const PIPE_DIAMETER = 48;
/** an upright's diameter, mm */
export const UPRIGHT_DIAMETER = 50;
/** most points the pleats of one object take, and most uprights */
const MAX_POINTS = 40000;
export const MAX_UPRIGHTS = 2000;
/** points along each pleat */
const PLEAT_STEPS = 8;
/** points round a round base or marker */
const ROUND_STEPS = 24;
const EPS = 1e-9;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b);
  return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 1, y: 0 };
};
const left = (u: Pt): Pt => ({ x: -u.y, y: u.x });

/** A path to walk along: its corners, and how far along it each one is. */
interface Run {
  readonly pts: Pt[];
  readonly cum: number[];
  readonly length: number;
}

function run(path: readonly Pt[], closed: boolean): Run {
  const pts = closed ? [...path, path[0]] : [...path];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** The point `s` along the run, and the way it runs there. */
function at(r: Run, s: number): { p: Pt; u: Pt } {
  let i = 0;
  while (i < r.pts.length - 2 && r.cum[i + 1] < s) i++;
  const u = unit(r.pts[i], r.pts[i + 1]);
  return { p: add(r.pts[i], u, s - r.cum[i]), u };
}

/** How far along the run its corners between `s0` and `s1` are. */
const cornersBetween = (r: Run, s0: number, s1: number): number[] => r.cum.filter((c) => c > s0 + EPS && c < s1 - EPS);

/** The run from `s0` to `s1`, its corners included, moved `off` to its left. */
function stretch(r: Run, s0: number, s1: number, off = 0): Pt[] {
  const out: Pt[] = [];
  for (const s of [s0, ...cornersBetween(r, s0, s1), s1]) {
    const { p, u } = at(r, s);
    out.push(add(p, left(u), off));
  }
  return out;
}

/** A band `width` wide centred on the run from `s0` to `s1`, as one outline. */
function band(r: Run, s0: number, s1: number, width: number): Pt[] {
  return [...stretch(r, s0, s1, width / 2), ...stretch(r, s0, s1, -width / 2).reverse()];
}

/** A line square to the run at `s`, `half` either side of it (moved `off` to its left). */
function tick(r: Run, s: number, half: number, off = 0): Pt[] {
  const { p, u } = at(r, s);
  const n = left(u);
  return [add(p, n, off - half), add(p, n, off + half)];
}

/** A round outline of radius `rad` round `c`. */
function round(c: Pt, rad: number): Pt[] {
  return Array.from({ length: ROUND_STEPS }, (_, k) => ({ x: c.x + rad * Math.cos((2 * Math.PI * k) / ROUND_STEPS), y: c.y + rad * Math.sin((2 * Math.PI * k) / ROUND_STEPS) }));
}

/** A square `size` across round `c`, its sides along `u`. */
function square(c: Pt, u: Pt, size: number): Pt[] {
  const n = left(u);
  const h = size / 2;
  return [add(add(c, u, -h), n, -h), add(add(c, u, h), n, -h), add(add(c, u, h), n, h), add(add(c, u, -h), n, h)];
}

/**
 * The pleats from `s0` to `s1`: a wave a Pleat Width long and the Pleat Depth deep, about the
 * line `off` to its left (`side` 0), or wholly to its left (`side` 1) or right (−1). Flip swaps
 * the wave's halves. Points are taken a few to each pleat and at each corner.
 */
function pleats(r: Run, s0: number, s1: number, g: SoftGoods, off: number, side: 0 | 1 | -1): Pt[] {
  const step = g.pleatWidth / PLEAT_STEPS;
  const ss = [s0, ...cornersBetween(r, s0, s1), s1];
  for (let s = s0 + step; s < s1 - EPS; s += step) ss.push(s);
  ss.sort((a, b) => a - b);
  const sign = g.flip ? -1 : 1;
  return ss.map((s) => {
    const phase = (2 * Math.PI * (s - s0)) / g.pleatWidth;
    const wave = side === 0 ? (sign * g.pleatDepth * Math.sin(phase)) / 2 : (side * g.pleatDepth * (1 - sign * Math.cos(phase))) / 2;
    const { p, u } = at(r, s);
    return add(p, left(u), off + wave);
  });
}

/** How many stock drapes hang along `length`, and where each starts, each covering `cover` of it at the fullness and overlapping its neighbours by at least the minimum. */
function drapesAlong(length: number, cover: number, overlap: number): number[] {
  if (length <= cover) return [0];
  const n = Math.ceil((length - overlap) / (cover - overlap) - EPS);
  return Array.from({ length: n }, (_, k) => (k * (length - cover)) / (n - 1));
}

/** Why the settings can't draw, or null. */
export function softGoodsProblem(g: SoftGoods): string | null {
  if (!g.simple && !(g.pleatWidth > 0 && g.pleatDepth > 0)) return "Set Pleat Width and Pleat Depth over 0, or choose Simple 2D.";
  if (!(g.stockWidth > 0 && g.fullness >= 0 && g.minOverlap >= 0)) return "Set Stock Drape Width over 0, with a Minimum Overlap and Vertical Tied Fullness of 0 or more.";
  if (g.stockWidth / (1 + g.fullness / 100) <= g.minOverlap) return "Each stock drape is narrower at this fullness than the Minimum Overlap: set a wider Stock Drape Width, a smaller overlap or less fullness.";
  if (g.fn === "pipeDrape" && !(g.sliderLength > 0 && g.baseSize > 0)) return "Set the slider Target Length and the base's size over 0.";
  if (g.track && !(g.trackWidth > 0)) return "Set the track's Width over 0.";
  return null;
}

/**
 * Soft goods along a path of straight runs (closed: back round to its start). A message when the
 * path or settings can't draw.
 */
export function softGoods(path: readonly Pt[], closed: boolean, g: SoftGoods): SoftGoodsPlan | string {
  const pts = path.filter((q, i) => i === 0 || dist(q, path[i - 1]) > EPS);
  if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  if (pts.length < 2) return "Click two points or more for the soft goods' path.";
  const problem = softGoodsProblem(g);
  if (problem) return problem;
  const r = run(pts, closed && pts.length > 2);
  const L = r.length;
  if (!g.simple && L / (g.pleatWidth / PLEAT_STEPS) > MAX_POINTS) return "The pleats would be too many to draw: set a wider Pleat Width, or choose Simple 2D.";
  const plan: SoftGoodsPlan = { outlines: [], lines: [], circles: [], filled: [], texts: [], hidden: [], drapes: 0, uprights: 0 };
  const drawPleats = (s0: number, s1: number, off: number, side: 0 | 1 | -1): void => {
    if (s1 - s0 <= EPS) return;
    if (g.simple) plan.lines.push(stretch(r, s0, s1, off));
    else plan.lines.push(pleats(r, s0, s1, g, off, side));
  };
  const cover = g.stockWidth / (1 + g.fullness / 100);
  let drapes = 0;
  /** stock drapes hung from `s0` to `s1`, with their breaks and overlaps marked */
  const hang = (s0: number, s1: number, off: number): void => {
    if (s1 - s0 <= EPS) return;
    const starts = drapesAlong(s1 - s0, cover, g.minOverlap).map((s) => s0 + s);
    drapes += starts.length;
    const half = Math.max(g.pleatDepth, PIPE_DIAMETER);
    for (let k = 0; k + 1 < starts.length; k++) {
      const [from, to] = [starts[k + 1], Math.min(starts[k] + cover, s1)];
      if (g.breaks) plan.lines.push(tick(r, (from + to) / 2, half, off));
      if (g.overlaps) plan.lines.push(tick(r, from, half / 2, off), tick(r, to, half / 2, off));
    }
  };

  if (g.fn === "pipeDrape") {
    const off = g.doubleWall ? g.pleatDepth / 2 + UPRIGHT_DIAMETER / 2 : 0;
    for (const o of g.doubleWall ? [off, -off] : [0]) {
      drawPleats(0, L, o, 0);
      hang(0, L, o);
    }
    // uprights at each corner and evenly between, slider lengths apart
    const stops: { s: number; u: Pt }[] = [];
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const seg = r.cum[i + 1] - r.cum[i];
      const k = Math.max(1, Math.round(seg / g.sliderLength));
      if (stops.length + k > MAX_UPRIGHTS) return `This run would stand on more than ${MAX_UPRIGHTS} uprights: set a longer slider Target Length.`;
      for (let m = 0; m < k; m++) stops.push({ s: r.cum[i] + (seg * m) / k, u: unit(r.pts[i], r.pts[i + 1]) });
    }
    if (!closed) stops.push({ s: L, u: unit(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]) });
    const shown = stops.filter((_, i) => closed || !((i === 0 && (g.endHardware === "end" || g.endHardware === "none")) || (i === stops.length - 1 && (g.endHardware === "start" || g.endHardware === "none"))));
    for (const s of shown) {
      const p = at(r, s.s).p;
      plan.outlines.push(g.baseRound ? round(p, g.baseSize / 2) : square(p, s.u, g.baseSize));
      plan.circles.push({ center: p, radius: UPRIGHT_DIAMETER / 2 });
    }
    if (g.sliders) {
      const ends = [...stops.map((s) => s.s), ...(closed ? [L] : [])];
      for (let i = 0; i + 1 < ends.length; i++) plan.lines.push(stretch(r, ends[i], ends[i + 1]));
    }
    if (g.centreline) plan.hidden.push(stretch(r, 0, L));
    return { ...plan, drapes, uprights: shown.length };
  }

  // the curtain or border itself: where it hangs, and the stretch left open
  const hung: [number, number][] = [];
  const open: [number, number][] = [];
  if (g.fn === "border") hung.push([Math.max(0, g.adjustStart), L - Math.max(0, g.adjustEnd)]);
  else {
    const w = Math.min(L, Math.max(0, g.openingWidth));
    if (g.opening === "none" || w <= EPS) hung.push([0, L]);
    else if (g.opening === "left") {
      hung.push([w, L]);
      open.push([0, w]);
    } else if (g.opening === "right") {
      hung.push([0, L - w]);
      open.push([L - w, L]);
    } else {
      const ov = Math.min(w, Math.max(0, g.centreOverlap)) / 2;
      hung.push([0, (L - w) / 2 + ov], [(L + w) / 2 - ov, L]);
      open.push([(L - w) / 2, (L + w) / 2]);
    }
  }
  const side: 0 | 1 | -1 = g.fn === "border" ? (g.reverse ? -1 : 1) : 0;
  for (const [s0, s1] of hung) {
    drawPleats(s0, s1, 0, side);
    hang(s0, s1, side * (g.pleatDepth / 2));
  }
  if (g.ghost) for (const [s0, s1] of open) plan.hidden.push(g.simple ? stretch(r, s0, s1) : pleats(r, s0, s1, g, 0, side));
  if (g.pipe) plan.outlines.push(band(r, 0, L, PIPE_DIAMETER));
  if (g.track) plan.outlines.push(band(r, 0, L, g.trackWidth));
  if (g.centreline) plan.hidden.push(stretch(r, 0, L));
  if (!closed) {
    const rad = Math.max(g.pleatDepth / 2, PIPE_DIAMETER);
    if (g.markers === "start" || g.markers === "both") plan.filled.push(round(r.pts[0], rad));
    if (g.markers === "end" || g.markers === "both") plan.filled.push(round(r.pts[r.pts.length - 1], rad));
  }
  return { ...plan, drapes, uprights: 0 };
}
