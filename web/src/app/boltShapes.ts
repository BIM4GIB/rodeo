// Bolts from Vectorworks' Fasteners tool set, in 2D: Eye Bolt (plain, shoulder or bent), Swing
// Bolt, Swing Eye Bolt, T-Bolt, U-Bolt, J-Bolt and Thumb Screw (Inch). Most stand head up, the head's bearing face
// centred on the origin and the shank hanging down -y; a U-bolt's bend is centred on the origin,
// its legs down; a J-bolt hangs from its threaded end's centre on the origin, its anchor at the
// bottom running left (or right), a nut and washers on its thread if asked. Front and Side look
// across the shank, Top down on the bolt and Bottom up at it, both centred on the shank's axis;
// what's nearer the viewer hides what's behind. A threaded shank is a shaft (shaftShapes.ts)
// turned axis down, its thread in any of its displays, its end chamfered 45° to the root. Sizes
// are mm.

import type { Pt } from "../core/index.ts";
import { hexSide, hexTop } from "./nutShapes.ts";
import { axisProfile, circleOutline, clipOutline, lathe, onEdge, polygonBody, prism, tube, type Point3, type Solid } from "./solids3d.ts";
import { arc, type FastenerDrawing } from "./rivetShapes.ts";
import { INCH_THREADS, METRIC_THREADS, shaftDrawing, threadDepth, type SegmentEnd, type ShaftSegment, type ThreadDisplay, type ThreadForm } from "./shaftShapes.ts";

type Drawing = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: FastenerDrawing["arcs"][number][]; hidden: Pt[][] };
/** a bolt drawn, and where its locus goes: its eye's or bend's centre */
export type BoltDrawing = FastenerDrawing & { readonly locus: Pt };

const INCH = 25.4;
const ARC_STEPS = 24;
/** steps a hidden edge's crossing is looked for in, along each segment */
const CLIP_STEPS = 24;
const empty = (): Drawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });
const round2 = (n: number): number => Math.round(n * 100) / 100;
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const inCircle = (c: Pt, r: number) => (p: Pt): boolean => Math.hypot(p.x - c.x, p.y - c.y) < r + 1e-6;
export const inBox = (x0: number, y0: number, x1: number, y1: number) => (p: Pt): boolean => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1;
export const either = (covers: readonly ((p: Pt) => boolean)[]) => (p: Pt): boolean => covers.some((c) => c(p));
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

export type BoltView = "front" | "side" | "top" | "bottom";

/** A bolt's thread: a UNC or ISO coarse size. */
export interface BoltThread {
  readonly id: string;
  readonly diameter: number;
  readonly pitch: number;
  readonly inch: boolean;
}

/** UNC from 1/4 in and ISO coarse from M5: the sizes the bolt tools offer. */
export const BOLT_THREADS: readonly BoltThread[] = [
  ...INCH_THREADS.filter((t) => t.name.endsWith(" UNC") && t.diameter >= INCH / 4 - 1e-9).map((t) => ({ id: t.name, diameter: t.diameter, pitch: t.pitch, inch: true })),
  ...METRIC_THREADS.filter((t, i, all) => t.diameter >= 5 && all.findIndex((u) => u.diameter === t.diameter) === i).map((t) => ({ id: t.name, diameter: t.diameter, pitch: t.pitch, inch: false })),
];

/** A threaded shank: its length from where it joins the head, its thread's length at the far end. */
export interface Shank {
  readonly thread: BoltThread;
  readonly length: number;
  readonly threadLength: number;
  readonly display: ThreadDisplay;
}

const threadForm = (t: BoltThread): ThreadForm => ({ outside: t.diameter, pitch: t.pitch, angle: 60, flatTop: 0.125, flatBottom: 0.25, starts: 1, leftHand: false, relief: "none" });

/** How long the 45° chamfer at a thread's end is: down to its root. */
export const endChamfer = (t: BoltThread): number => threadDepth(threadForm(t));

/** The usual thread length: ISO 4014's 2d + 6 mm, or ASME B18.2.1's 2D + 1/4 in, at most `length`. */
export function boltThreadLength(t: BoltThread, length: number): number {
  return Math.min(length, 2 * t.diameter + (t.inch ? INCH / 4 : 6));
}

function shankProblem(s: Shank): string | null {
  const c = endChamfer(s.thread);
  if (!(s.threadLength > c)) return `the thread length must be more than its end's chamfer (${round2(c)} mm)`;
  if (!(s.length >= s.threadLength)) return "the thread can't be longer than the shank";
  return null;
}

const end = (diameter: number, chamfer = 0): SegmentEnd => ({ diameter, style: chamfer > 0 ? "chamfer" : "plain", chamferLength: chamfer, chamferAngle: 45, filletRadius: 0 });

/** The shank from its joined end (along +x from 0) to its threaded end, put in place by `place`: its edge, open across the joined end, from the side at +y round the threaded end to the other, and its lines. */
function shank(s: Shank, place: (p: Pt) => Pt): { edge: Pt[]; lines: Pt[][]; hidden: Pt[][] } {
  const D = s.thread.diameter;
  const plain = s.length - s.threadLength;
  return shaftAlong([...(plain > 1e-9 ? [straight(plain, D)] : []), threaded(s.thread, s.threadLength, endChamfer(s.thread))], s.display, place);
}

export const straight = (length: number, diameter: number, chamfer = 0): ShaftSegment => ({ type: "straight", length, left: end(diameter), right: end(diameter, chamfer), thread: null, keyway: null, groove: null, flats: null });
export const threaded = (t: BoltThread, length: number, chamfer: number): ShaftSegment => ({ type: "threaded", length, left: end(t.diameter), right: end(t.diameter, chamfer), thread: threadForm(t), keyway: null, groove: null, flats: null });
/** a plain cone `length` long from `from` across down to `to` */
const tapered = (length: number, from: number, to: number): ShaftSegment => ({ type: "tapered", length, left: end(from), right: end(to), thread: null, keyway: null, groove: null, flats: null });

/** `segments` as a shaft put in place by `place`, as shank() gives them. */
export function shaftAlong(segments: ShaftSegment[], display: ThreadDisplay, place: (p: Pt) => Pt): { edge: Pt[]; lines: Pt[][]; hidden: Pt[][] } {
  const d = shaftDrawing({ segments, threads: display, centreDrill: null }, null);
  return { edge: d.outlines[0].map(place), lines: d.lines.map((l) => l.map(place)), hidden: d.hidden.map((l) => l.map(place)) };
}

/** a shank hanging from y = `top`, its edge starting at the top on the right */
export const hanging = (top: number) => (p: Pt): Pt => ({ x: p.y, y: top - p.x });
/** a shank rising from y = `bottom` to its thread, its edge starting at the bottom on the left */
const rising = (bottom: number) => (p: Pt): Pt => ({ x: -p.y, y: bottom + p.x });

/** The threaded end seen end on, at `at`: its crest and the chamfer's inner edge. */
function threadEnd(d: Drawing, t: BoltThread, at: Pt): void {
  d.circles.push({ center: at, radius: t.diameter / 2 }, { center: at, radius: t.diameter / 2 - endChamfer(t) });
}

/** The runs of `line` that `covered` doesn't hide, cut where it crosses the hiding region's edge. */
export function outside(line: readonly Pt[], covered: (p: Pt) => boolean): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  let prev = line[0];
  let hidden = covered(prev);
  if (!hidden) run.push(prev);
  for (let i = 1; i < line.length; i++) {
    for (let k = 1; k <= CLIP_STEPS; k++) {
      const p = lerp(line[i - 1], line[i], k / CLIP_STEPS);
      const now = covered(p);
      if (now !== hidden) {
        let [lo, hi] = [prev, p];
        for (let j = 0; j < 40; j++) {
          const m = lerp(lo, hi, 0.5);
          if (covered(m) === hidden) lo = m;
          else hi = m;
        }
        const cut = lerp(lo, hi, 0.5);
        if (hidden) run = [cut];
        else {
          run.push(cut);
          if (run.length > 1) out.push(run);
          run = [];
        }
      }
      if (!now && k === CLIP_STEPS) run.push(p);
      prev = p;
      hidden = now;
    }
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** `outline` closed, or the runs of it `covered` leaves showing. */
function visible(d: Drawing, outline: readonly Pt[], covered: ((p: Pt) => boolean) | null): void {
  const runs = covered ? outside([...outline, outline[0]], covered) : null;
  if (!runs || (runs.length === 1 && runs[0].length === outline.length + 1)) d.outlines.push([...outline]);
  else d.lines.push(...runs);
}

/** A circle, or the arcs of it `covered` leaves showing. */
function visibleCircle(d: Drawing, center: Pt, radius: number, covered: ((p: Pt) => boolean) | null): void {
  const ring = arc(center, radius, 0, 2 * Math.PI, ARC_STEPS * 4);
  const runs = covered ? outside(ring, covered) : null;
  if (!runs || (runs.length === 1 && runs[0].length === ring.length)) d.circles.push({ center, radius });
  else d.lines.push(...runs);
}

/** A stadium round `c`, reaching `half` each way along x and `r` each way across, its ends round. */
function stadium(c: Pt, half: number, r: number): Pt[] {
  const k = Math.max(0, half - r);
  return [...arc({ x: c.x + k, y: c.y }, r, -Math.PI / 2, Math.PI / 2, ARC_STEPS / 2), ...arc({ x: c.x - k, y: c.y }, r, Math.PI / 2, 1.5 * Math.PI, ARC_STEPS / 2)];
}

/** A circle `R` round `c` from where x = -w meets it below, over the top, to where x = w does. */
function overTop(c: Pt, R: number, w: number): Pt[] {
  const a = Math.asin(Math.min(1, w / R));
  return arc(c, R, -Math.PI / 2 - a, -Math.PI / 2 + a - 2 * Math.PI, ARC_STEPS * 2);
}

/** A vertical centre line at x from y0 to y1, and a horizontal one at y from x0 to x1. */
const vertical = (x: number, y0: number, y1: number): Pt[] => [{ x, y: y0 }, { x, y: y1 }];
const horizontal = (y: number, x0: number, x1: number): Pt[] => [{ x: x0, y }, { x: x1, y }];

/** The parts of a bolt seen from the top or bottom: a head outline and the threaded end, with its centre lines. */
function endView(d: Drawing, view: "top" | "bottom", head: Pt[], t: BoltThread, half: { x: number; y: number }, beyond: number | null): void {
  const r = t.diameter / 2;
  if (view === "top") d.outlines.push(head);
  else {
    visible(d, head, inCircle({ x: 0, y: 0 }, r));
    threadEnd(d, t, { x: 0, y: 0 });
  }
  if (beyond !== null) d.lines.push(horizontal(0, -half.x - beyond, half.x + beyond), vertical(0, -Math.max(half.y, r) - beyond, Math.max(half.y, r) + beyond));
}

// ---- eye bolts ----------------------------------------------------------------------------

export type EyeType = "plain" | "shoulder" | "bent";

/** A forged eye bolt, plain or with a shoulder under its eye, or one bent from rod. */
export interface EyeBolt {
  readonly type: EyeType;
  readonly shank: Shank;
  readonly inside: number;
  /** the eye's round section; a bent eye's is the rod's */
  readonly section: number;
  readonly shoulder: number;
  readonly shoulderHeight: number;
}

/** ASME B18.15 forged eye bolts, Style A, mid-tolerance: D, C (eye inside), eye outside, E (eye section), B (shank), G (full thread, min), and a shoulder bolt's K (shoulder across) and L (high), inches. */
const ASME_EYE: readonly (readonly number[])[] = [
  [0.25, 0.75, 1.19, 0.22, 1.03, 0.75, 0.53, 0.155],
  [0.3125, 0.875, 1.44, 0.28, 1.155, 0.81, 0.59, 0.155],
  [0.375, 1, 1.69, 0.345, 1.315, 0.88, 0.655, 0.155],
  [0.4375, 1.06, 1.81, 0.375, 1.44, 1, 0.78, 0.22],
  [0.5, 1.185, 2.12, 0.47, 1.56, 1.12, 0.91, 0.22],
  [0.5625, 1.25, 2.25, 0.5, 1.685, 1.25, 0.97, 0.25],
  [0.625, 1.375, 2.56, 0.59, 1.815, 1.38, 1.03, 0.28],
  [0.75, 1.5, 2.81, 0.655, 2.06, 1.62, 1.185, 0.28],
  [0.875, 1.625, 3.19, 0.78, 2.315, 1.81, 1.375, 0.345],
  [1, 1.75, 3.56, 0.91, 2.56, 2.06, 1.56, 0.41],
  [1.125, 2, 4.06, 1.03, 2.815, 2.31, 1.75, 0.47],
  [1.25, 2.185, 4.44, 1.125, 3.06, 2.5, 1.94, 0.53],
  [1.5, 2.5, 5.19, 1.345, 3.56, 3, 2.185, 0.56],
  [1.75, 2.875, 6, 1.56, 3.815, 3.19, 2.56, 0.56],
  [2, 3.25, 6.88, 1.815, 4.125, 3.38, 2.94, 0.685],
];

/** Column `i` of `rows` at diameter `d` (column 0): between rows interpolated, past either end in proportion to the end row. */
function across(rows: readonly (readonly number[])[], i: number, d: number): number {
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (d <= first[0]) return (first[i] * d) / first[0];
  if (d >= last[0]) return (last[i] * d) / last[0];
  const k = rows.findIndex((r) => r[0] >= d);
  const [a, b] = [rows[k - 1], rows[k]];
  return a[i] + ((b[i] - a[i]) * (d - a[0])) / (b[0] - a[0]);
}

/** The sizes ASME B18.15 lists, and ISO's from M6 to M48. */
export const EYE_THREADS: readonly BoltThread[] = BOLT_THREADS.filter((t) => (t.inch ? ASME_EYE.some((r) => Math.abs(r[0] * INCH - t.diameter) < 1e-6) : t.diameter >= 6));

/** An eye bolt's sizes for thread `t`: ASME B18.15's for an inch size, interpolated by diameter for a metric one. */
export function eyeSizes(t: BoltThread): { inside: number; section: number; length: number; threadLength: number; shoulder: number; shoulderHeight: number } {
  const at = (i: number): number => across(ASME_EYE, i, t.diameter / INCH) * INCH;
  return { inside: at(1), section: at(3), length: at(4), threadLength: at(5), shoulder: at(6), shoulderHeight: at(7) };
}

export function eyeProblem(e: EyeBolt): string | null {
  const D = e.shank.thread.diameter;
  if (!(e.inside > 0)) return "the eye needs an inside diameter";
  if (e.type !== "bent" && !(e.section > 0)) return "the eye needs a section";
  if (e.type === "shoulder" && !(e.shoulder > D && e.shoulderHeight > 0)) return "the shoulder must be wider than the shank and have a height";
  if (e.type !== "bent" && !(e.inside + 2 * e.section > D)) return "the eye must be wider than the shank";
  return shankProblem(e.shank);
}

/** A bent eye's rod along its middle: an S-bend from the shank's top up and left to the loop's side, then round over the top, ending short of the shank. */
function bentPath(c: Pt, Rc: number): Pt[] {
  const [p0, p1, p2, p3] = [{ x: 0, y: 0 }, { x: 0, y: c.y / 2 }, { x: -Rc, y: c.y / 2 }, { x: -Rc, y: c.y }];
  const s: Pt[] = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const u = 1 - t;
    s.push({ x: u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x, y: u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y });
  }
  return [...s, ...arc(c, Rc, Math.PI, (-7 * Math.PI) / 18, ARC_STEPS * 2).slice(1)];
}

/** `path` offset `r` to its left (or right, with r < 0). */
function offset(path: readonly Pt[], r: number): Pt[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: p.x - ((b.y - a.y) / len) * r, y: p.y + ((b.x - a.x) / len) * r };
  });
}

/** An eye bolt from the front (looking through its eye), side, top or bottom. */
export function eyeBolt(e: EyeBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const t = e.shank.thread;
  const r = t.diameter / 2;
  const section = e.type === "bent" ? t.diameter : e.section;
  const half = section / 2;
  const Ri = e.inside / 2;
  const Ro = Ri + section;
  const K = e.shoulder / 2;
  const L = e.shoulderHeight;
  const chamfer = Math.min(L / 3, (K - r) / 2);
  // the eye's centre: on the bearing face, a shoulder, or a bent eye's S-bend rising three rod radii past the loop's inside
  const cy = e.type === "bent" ? Ri + 3 * r : (e.type === "shoulder" ? L : 0) + Ro;
  const c = { x: 0, y: cy };
  const top = cy + Ro;
  const O = { x: 0, y: 0 };
  if (view === "top" || view === "bottom") {
    const eye = stadium(O, Ro, half);
    if (view === "top") {
      d.outlines.push(eye);
      if (e.type === "shoulder") {
        const a = Math.asin(Math.min(1, half / K));
        d.lines.push(arc(O, K, a, Math.PI - a, ARC_STEPS), arc(O, K, Math.PI + a, 2 * Math.PI - a, ARC_STEPS));
      }
    } else {
      visible(d, eye, inCircle(O, e.type === "shoulder" ? K : r));
      if (e.type === "shoulder") d.circles.push({ center: O, radius: K });
      threadEnd(d, t, O);
    }
    if (beyond !== null) {
      const h = Math.max(half, r, e.type === "shoulder" ? K : 0) + beyond;
      d.lines.push(horizontal(0, -Ro - beyond, Ro + beyond), vertical(0, -h, h));
    }
    return { ...d, locus: O };
  }
  const s = shank(e.shank, hanging(0));
  d.lines.push(...s.lines);
  d.hidden.push(...s.hidden);
  const shoulderLeft = [{ x: -K, y: 0 }, { x: -K, y: L - chamfer }, { x: -K + chamfer, y: L }];
  const shoulderRight = [{ x: K - chamfer, y: L }, { x: K, y: L - chamfer }, { x: K, y: 0 }];
  if (e.type === "shoulder") d.lines.push(horizontal(L - chamfer, -K, K));
  if (view === "front") {
    if (e.type === "bent") {
      const path = bentPath(c, Ri + r);
      d.outlines.push([...s.edge, ...offset(path, r), ...offset(path, -r).reverse().slice(0, -1)]);
    } else {
      const eye = overTop(c, Ro, r);
      d.outlines.push(e.type === "shoulder" ? [...s.edge, ...shoulderLeft, { x: -r, y: L }, ...eye, { x: r, y: L }, ...shoulderRight] : [...s.edge, ...eye]);
    }
    if (e.type !== "bent") d.circles.push({ center: c, radius: Ri });
    if (beyond !== null) d.lines.push(vertical(0, top + beyond, -e.shank.length - beyond), horizontal(cy, -Ro - beyond, Ro + beyond));
    return { ...d, locus: c };
  }
  // the side: the eye edge on, round at the top, its bottom's curve where it meets the stem or shoulder
  const cap = arc({ x: 0, y: top - half }, half, Math.PI, 0, ARC_STEPS);
  if (e.type === "bent") d.outlines.push([...s.edge, { x: -r, y: top - r }, ...cap.slice(1, -1), { x: r, y: top - r }]);
  else {
    const low = e.type === "shoulder" ? L : cy - Ro + half;
    const stem = e.type === "shoulder" ? shoulderLeft : [{ x: -r, y: low }];
    const back = e.type === "shoulder" ? shoulderRight : [{ x: r, y: low }];
    d.outlines.push([...s.edge, ...stem, { x: -half, y: low }, ...cap, { x: half, y: low }, ...back]);
    d.lines.push(arc({ x: 0, y: cy - Ro + half }, half, Math.PI, 2 * Math.PI, ARC_STEPS));
  }
  if (beyond !== null) d.lines.push(vertical(0, top + beyond, -e.shank.length - beyond), horizontal(cy, -half - beyond, half + beyond));
  return { ...d, locus: c };
}

// ---- swing bolts and swing eye bolts ------------------------------------------------------------

/** A swing bolt: a flat head `width` across and `thickness` thick, round over its pin hole (half its width across) `shoulder` above the bearing face. */
export interface SwingBolt {
  readonly shank: Shank;
  readonly width: number;
  readonly shoulder: number;
  readonly thickness: number;
}

export function swingProblem(s: SwingBolt): string | null {
  if (!(s.width > s.shank.thread.diameter)) return "the head must be wider than the shank";
  if (!(s.thickness > 0)) return "the head needs a thickness";
  if (!(s.shoulder > s.width / 4)) return `the shoulder must be longer than the pin hole's radius (${round2(s.width / 4)} mm)`;
  return shankProblem(s.shank);
}

/** A swing bolt from the front (through its pin hole), side, top or bottom. */
export function swingBolt(s: SwingBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const W = s.width / 2;
  const T = s.thickness / 2;
  const hole = { x: 0, y: s.shoulder };
  if (view === "top" || view === "bottom") {
    endView(d, view, box(-W, -T, W, T), s.shank.thread, { x: W, y: T }, beyond);
    return { ...d, locus: { x: 0, y: 0 } };
  }
  const sh = shank(s.shank, hanging(0));
  d.lines.push(...sh.lines);
  d.hidden.push(...sh.hidden);
  const top = s.shoulder + W;
  if (view === "front") {
    d.outlines.push([...sh.edge, { x: -W, y: 0 }, ...arc(hole, W, Math.PI, 0, ARC_STEPS * 2), { x: W, y: 0 }]);
    d.circles.push({ center: hole, radius: W / 2 });
  } else d.outlines.push([...sh.edge, { x: -T, y: 0 }, { x: -T, y: top }, { x: T, y: top }, { x: T, y: 0 }]);
  if (beyond !== null) {
    const h = (view === "front" ? W : T) + beyond;
    d.lines.push(vertical(0, top + beyond, -s.shank.length - beyond), horizontal(s.shoulder, -h, h));
  }
  return { ...d, locus: hole };
}

/** A swing eye bolt (DIN 444): a flat round eye `outside` across and `thickness` thick, its hole `inside`, on the shank. */
export interface SwingEyeBolt {
  readonly shank: Shank;
  readonly inside: number;
  readonly outside: number;
  readonly thickness: number;
}

/** DIN 444 form B: d, d1 (eye hole), d2 (eye, max), s (thick, max), b (thread, l ≤ 125, or the next where none), mm. */
const DIN_444: readonly (readonly number[])[] = [
  [5, 5, 12, 6, 16],
  [6, 6, 14, 7, 18],
  [8, 8, 18, 9, 22],
  [10, 10, 20, 12, 26],
  [12, 12, 25, 14, 30],
  [16, 16, 32, 17, 38],
  [20, 18, 40, 22, 46],
  [24, 22, 45, 25, 54],
  [27, 24, 50, 27, 60],
  [30, 27, 55, 30, 66],
  [33, 30, 60, 34, 78],
  [36, 32, 65, 38, 84],
];

/** DIN 444's sizes, and UNC's from 1/4 to 1-1/2 in. */
export const SWING_EYE_THREADS: readonly BoltThread[] = BOLT_THREADS.filter((t) => (t.inch ? t.diameter <= 1.5 * INCH + 1e-6 : t.diameter <= 36));

/** A swing eye bolt's sizes for thread `t`: DIN 444's, interpolated by diameter for an inch size. */
export function swingEyeSizes(t: BoltThread): { inside: number; outside: number; thickness: number; threadLength: number } {
  const at = (i: number): number => across(DIN_444, i, t.diameter);
  return { inside: at(1), outside: at(2), thickness: at(3), threadLength: at(4) };
}

export function swingEyeProblem(s: SwingEyeBolt): string | null {
  if (!(s.inside > 0)) return "the eye needs an inside diameter";
  if (!(s.outside > s.inside)) return "the outside diameter must be more than the eye's inside";
  if (!(s.outside > s.shank.thread.diameter)) return "the eye must be wider than the shank";
  if (!(s.thickness > 0)) return "the eye needs a thickness";
  return shankProblem(s.shank);
}

/** A swing eye bolt from the front (through its eye), side, top or bottom. */
export function swingEyeBolt(s: SwingEyeBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const r = s.shank.thread.diameter / 2;
  const Ro = s.outside / 2;
  const T = s.thickness / 2;
  const c = { x: 0, y: Ro };
  if (view === "top" || view === "bottom") {
    endView(d, view, box(-Ro, -T, Ro, T), s.shank.thread, { x: Ro, y: T }, beyond);
    return { ...d, locus: { x: 0, y: 0 } };
  }
  const sh = shank(s.shank, hanging(0));
  d.lines.push(...sh.lines);
  d.hidden.push(...sh.hidden);
  if (view === "front") {
    d.outlines.push([...sh.edge, ...overTop(c, Ro, r)]);
    d.circles.push({ center: c, radius: s.inside / 2 });
  } else {
    // edge on, its top corners rounded; the curve where the stem runs into the eye's rim
    const k = Math.min(T, Ro) / 2;
    d.outlines.push([...sh.edge, { x: -T, y: 0 }, ...arc({ x: -T + k, y: 2 * Ro - k }, k, Math.PI, Math.PI / 2, 6), ...arc({ x: T - k, y: 2 * Ro - k }, k, Math.PI / 2, 0, 6), { x: T, y: 0 }]);
    const w = Math.min(r, T);
    d.lines.push(Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
      const z = -w + (2 * w * i) / ARC_STEPS;
      return { x: z, y: Ro - Math.sqrt(Ro * Ro - r * r + z * z) };
    }));
  }
  if (beyond !== null) {
    const h = (view === "front" ? Ro : T) + beyond;
    d.lines.push(vertical(0, 2 * Ro + beyond, -s.shank.length - beyond), horizontal(Ro, -h, h));
  }
  return { ...d, locus: c };
}

// ---- T-bolts --------------------------------------------------------------------------------

/** A T-bolt: a square head `head` across and `thickness` high. */
export interface TBolt {
  readonly shank: Shank;
  readonly head: number;
  readonly thickness: number;
}

export function tBoltProblem(b: TBolt): string | null {
  if (!(b.head > b.shank.thread.diameter)) return "the head must be wider than the shank";
  if (!(b.thickness > 0)) return "the head needs a thickness";
  return shankProblem(b.shank);
}

/** A T-bolt from the front (or side, the same), top or bottom. */
export function tBolt(b: TBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const H = b.head / 2;
  if (view === "top" || view === "bottom") endView(d, view, box(-H, -H, H, H), b.shank.thread, { x: H, y: H }, beyond);
  else {
    const sh = shank(b.shank, hanging(0));
    d.lines.push(...sh.lines);
    d.hidden.push(...sh.hidden);
    d.outlines.push([...sh.edge, { x: -H, y: 0 }, { x: -H, y: b.thickness }, { x: H, y: b.thickness }, { x: H, y: 0 }]);
    if (beyond !== null) d.lines.push(vertical(0, b.thickness + beyond, -b.shank.length - beyond));
  }
  return { ...d, locus: { x: 0, y: 0 } };
}

// ---- U-bolts --------------------------------------------------------------------------------

/** A U-bolt: two legs `inside` apart, `length` from the inside of the bend to their ends, threaded `threadLength`. */
export interface UBolt {
  readonly thread: BoltThread;
  readonly inside: number;
  readonly length: number;
  readonly threadLength: number;
  readonly display: ThreadDisplay;
}

/** each leg below the bend's centre */
const uLeg = (u: UBolt): Shank => ({ thread: u.thread, length: u.length - u.inside / 2, threadLength: u.threadLength, display: u.display });

export function uBoltProblem(u: UBolt): string | null {
  if (!(u.inside > 0)) return "the legs need an inside distance";
  if (!(u.length - u.inside / 2 >= u.threadLength)) return `the length must reach the thread past the bend (at least ${round2(u.threadLength + u.inside / 2)} mm)`;
  return shankProblem(uLeg(u));
}

/** A U-bolt from the front (both legs, the bend over them), side, top or bottom. */
export function uBolt(u: UBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const O = { x: 0, y: 0 };
  const r = u.thread.diameter / 2;
  const c = u.inside / 2 + r;
  const leg = uLeg(u);
  if (view === "top" || view === "bottom") {
    const bend = stadium(O, c + r, r);
    if (view === "top") d.outlines.push(bend);
    else {
      visible(d, bend, either([inCircle({ x: -c, y: 0 }, r), inCircle({ x: c, y: 0 }, r)]));
      threadEnd(d, u.thread, { x: -c, y: 0 });
      threadEnd(d, u.thread, { x: c, y: 0 });
    }
    if (beyond !== null) d.lines.push(horizontal(0, -c - r - beyond, c + r + beyond), vertical(-c, -r - beyond, r + beyond), vertical(c, -r - beyond, r + beyond));
    return { ...d, locus: O };
  }
  if (view === "front") {
    const [left, right] = [-c, c].map((x) => shank(leg, (p) => ({ x: x + p.y, y: -p.x })));
    for (const s of [left, right]) {
      d.lines.push(...s.lines);
      d.hidden.push(...s.hidden);
    }
    d.outlines.push([...left.edge, ...arc(O, c + r, Math.PI, 0, ARC_STEPS * 2).slice(1, -1), ...right.edge, ...arc(O, c - r, 0, Math.PI, ARC_STEPS * 2).slice(1, -1)]);
    if (beyond !== null) d.lines.push(vertical(-c, -leg.length - beyond, 0), arc(O, c, Math.PI, 0, ARC_STEPS * 2), vertical(c, 0, -leg.length - beyond));
    return { ...d, locus: O };
  }
  const s = shank({ ...leg, length: leg.length + c }, hanging(c));
  d.lines.push(...s.lines);
  d.hidden.push(...s.hidden);
  d.outlines.push([...s.edge, ...arc({ x: 0, y: c }, r, Math.PI, 0, ARC_STEPS).slice(1, -1)]);
  if (beyond !== null) d.lines.push(vertical(0, c + r + beyond, -leg.length - beyond));
  return { ...d, locus: O };
}

// ---- J-bolts --------------------------------------------------------------------------------

export type JNut = "none" | "hex" | "square";
export type JWasher = "none" | "narrow" | "regular" | "wide";

/** A J-bolt: `length` from its threaded end to the bottom of its bend, `bend` the bend's inside radius, its anchor reaching `anchor` from the shank's back; a nut and washers sit on the thread, the lowest's face `bearing` below the end. */
export interface JBolt {
  readonly thread: BoltThread;
  readonly length: number;
  readonly threadLength: number;
  readonly bend: number;
  readonly anchor: number;
  readonly display: ThreadDisplay;
  readonly right: boolean;
  readonly nut: JNut;
  readonly lockWasher: boolean;
  readonly washer: JWasher;
  readonly bearing: number;
}

/** Nuts and washers in proportion to the thread's diameter: hex nuts 1.5 across their flats and square ones 1.625 (ASME B18.2.2's), both 0.875 high; plain washers 2 (narrow), 2.5 (regular) or 3 (wide) across and 0.2 thick; spring lock washers 1.75 across and 0.25 thick. */
const NUT_FLATS: Record<"hex" | "square", number> = { hex: 1.5, square: 1.625 };
const NUT_HIGH = 0.875;
const WASHER_ACROSS: Record<"narrow" | "regular" | "wide", number> = { narrow: 2, regular: 2.5, wide: 3 };
const WASHER_THICK = 0.2;
const LOCK_ACROSS = 1.75;
const LOCK_THICK = 0.25;

/** One of a J-bolt's nut and washers: its kind, its bearing face's height, how high and across (flats for a nut). */
interface StackPart {
  readonly kind: "washer" | "hex" | "square";
  readonly bottom: number;
  readonly height: number;
  readonly across: number;
}

/** The washer, lock washer and nut from the bearing face up. */
function jStack(j: JBolt): StackPart[] {
  const D = j.thread.diameter;
  const parts: StackPart[] = [];
  let y = -j.bearing;
  const add = (kind: StackPart["kind"], height: number, across: number): void => {
    parts.push({ kind, bottom: y, height, across });
    y += height;
  };
  if (j.washer !== "none") add("washer", WASHER_THICK * D, WASHER_ACROSS[j.washer] * D);
  if (j.lockWasher) add("washer", LOCK_THICK * D, LOCK_ACROSS * D);
  if (j.nut !== "none") add(j.nut, NUT_HIGH * D, NUT_FLATS[j.nut] * D);
  return parts;
}

/** how far the shank runs straight from the threaded end to the bend */
const jStraight = (j: JBolt): number => j.length - j.thread.diameter - j.bend;

export function jBoltProblem(j: JBolt): string | null {
  const D = j.thread.diameter;
  if (!(j.bend > 0)) return "the bend radius must be more than 0";
  if (!(jStraight(j) >= j.threadLength)) return `the length must leave room for the thread above the bend (at least ${round2(j.threadLength + D + j.bend)} mm)`;
  if (!(j.anchor > j.bend + D)) return `the anchor must reach past the bend (more than ${round2(j.bend + D)} mm)`;
  const parts = jStack(j);
  if (parts.length) {
    const last = parts[parts.length - 1];
    if (!(last.bottom + last.height <= 1e-9)) return "the nut and washers stand above the bolt's end: lengthen Bearing Length";
    if (!(j.bearing <= jStraight(j))) return "the nut and washers sit on the bend: shorten Bearing Length";
    if (j.nut !== "none" && !(last.bottom >= -j.threadLength - 1e-9)) return "the nut must sit on the thread: shorten Bearing Length";
  }
  return shankProblem({ thread: j.thread, length: jStraight(j), threadLength: j.threadLength, display: j.display });
}

/** A nut or washer from the front or side, on the shank's axis. */
function partSide(p: StackPart, view: "front" | "side"): { outline: Pt[]; lines: Pt[][]; half: number } {
  if (p.kind === "hex") {
    const h = hexSide({ flats: p.across, height: p.height }, view);
    return { outline: h.outline.map((q) => ({ x: q.x, y: q.y + p.bottom })), lines: h.lines.map((l) => l.map((q) => ({ x: q.x, y: q.y + p.bottom }))), half: h.half };
  }
  return { outline: box(-p.across / 2, p.bottom, p.across / 2, p.bottom + p.height), lines: [], half: p.across / 2 };
}

/** A nut or washer from above or below: its outline and what it hides. */
function partEnd(p: StackPart): { outline: Pt[] | null; radius: number; covers: (q: Pt) => boolean } {
  const O = { x: 0, y: 0 };
  if (p.kind === "washer") return { outline: null, radius: p.across / 2, covers: inCircle(O, p.across / 2) };
  const outline = p.kind === "hex" ? hexTop({ flats: p.across, height: p.height }) : box(-p.across / 2, -p.across / 2, p.across / 2, p.across / 2);
  return { outline, radius: 0, covers: (q) => inPolygon(outline, q) };
}

export function inPolygon(pts: readonly Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [a, b] = [pts[i], pts[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A J-bolt from the front (the anchor across), side (the anchor end on), top or bottom, with its nut and washers. */
export function jBolt(j: JBolt, view: BoltView, beyond: number | null): BoltDrawing {
  const d = empty();
  const t = j.thread;
  const r = t.diameter / 2;
  const Rc = j.bend + r;
  const xe = r - j.anchor;
  const O = { x: 0, y: 0 };
  const parts = jStack(j);
  const straight: Shank = { thread: t, length: jStraight(j), threadLength: j.threadLength, display: j.display };
  if (view === "front" || view === "side") {
    const yc = -j.length + r + (view === "front" ? Rc : 0);
    const s = shank(view === "front" ? straight : { ...straight, length: j.length - r }, rising(yc));
    const drawn = parts.map((p) => partSide(p, view));
    const covered = parts.length ? either(parts.map((p, i) => inBox(-drawn[i].half, p.bottom, drawn[i].half, p.bottom + p.height))) : null;
    const bc = { x: -Rc, y: yc };
    const outline =
      view === "front"
        ? [...s.edge, ...arc(bc, Rc + r, 0, -Math.PI / 2, ARC_STEPS).slice(1), { x: xe, y: -j.length }, { x: xe, y: -j.length + 2 * r }, ...arc(bc, Rc - r, -Math.PI / 2, 0, ARC_STEPS).slice(0, -1)]
        : [...s.edge, ...arc({ x: 0, y: yc }, r, 0, -Math.PI, ARC_STEPS).slice(1, -1)];
    visible(d, outline, covered);
    for (const l of s.lines) d.lines.push(...(covered ? outside(l, covered) : [l]));
    for (const l of s.hidden) d.hidden.push(...(covered ? outside(l, covered) : [l]));
    for (const p of drawn) {
      d.outlines.push(p.outline);
      d.lines.push(...p.lines);
    }
    if (beyond !== null) {
      if (view === "front") d.lines.push(vertical(0, beyond, yc), arc(bc, Rc, 0, -Math.PI / 2, ARC_STEPS), horizontal(-j.length + r, -Rc, xe - beyond));
      else d.lines.push(vertical(0, beyond, -j.length - beyond), horizontal(yc, -r - beyond, r + beyond));
    }
  } else {
    const ends = parts.map(partEnd);
    const reach = Math.max(r, ...parts.map((p, i) => ends[i].radius || (p.kind === "hex" ? p.across / Math.sqrt(3) : (p.across / 2) * Math.SQRT2)));
    // what's nearer the viewer first: from the top the bolt's end, the nut, then the washers and the anchor; from below the anchor and up
    const order = view === "top" ? [...ends].reverse() : ends;
    const shapes: ((q: Pt) => boolean)[] = [];
    if (view === "top") {
      threadEnd(d, t, O);
      shapes.push(inCircle(O, r));
    } else {
      const bar = [{ x: xe, y: -r }, { x: 0, y: -r }, ...arc(O, r, -Math.PI / 2, Math.PI / 2, ARC_STEPS / 2).slice(1, -1), { x: 0, y: r }, { x: xe, y: r }];
      d.outlines.push(bar);
      shapes.push((q) => inPolygon(bar, q));
    }
    for (const p of order) {
      const covered = either([...shapes]);
      if (p.outline) visible(d, p.outline, covered);
      else visibleCircle(d, O, p.radius, covered);
      shapes.push(p.covers);
    }
    if (view === "top") d.lines.push(...outside([{ x: 0, y: r }, { x: xe, y: r }, { x: xe, y: -r }, { x: 0, y: -r }], either(shapes)));
    if (beyond !== null) d.lines.push(horizontal(0, xe - beyond, reach + beyond), vertical(0, -reach - beyond, reach + beyond));
  }
  if (!j.right) return { ...d, locus: O };
  const flip = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y }));
  return {
    outlines: d.outlines.map(flip),
    lines: d.lines.map(flip),
    circles: d.circles.map((c) => ({ center: { x: -c.center.x, y: c.center.y }, radius: c.radius })),
    arcs: [],
    hidden: d.hidden.map(flip),
    locus: O,
  };
}

// ---- as solids -----------------------------------------------------------------------------

/** a shank turned about its axis, hanging from y = 0 */
const shankSolid = (s: Shank): Solid => lathe(axisProfile(shank(s, hanging(0)).edge, "y"));
/** a point of the front view in the plane the solid stands in */
const inPlane = (p: Pt): Point3 => [p.x, 0, p.y];
/** an outline of the front view as a plate `thickness` thick, its middle in the view's plane */
const plate = (outlines: readonly (readonly Pt[])[], thickness: number): Solid => onEdge(prism(outlines, -thickness / 2, thickness / 2));

/** An eye bolt, the shank hanging from y = 0: a forged eye a ring of round section, a bent one the rod bent round. */
export function eyeBoltSolid(e: EyeBolt): Solid {
  const r = e.shank.thread.diameter / 2;
  const Ri = e.inside / 2;
  if (e.type === "bent") return [...shankSolid(e.shank), ...tube(bentPath({ x: 0, y: Ri + 3 * r }, Ri + r).map(inPlane), r, false, 16)];
  const half = e.section / 2;
  const Rc = Ri + half;
  const L = e.type === "shoulder" ? e.shoulderHeight : 0;
  const K = e.shoulder / 2;
  const chamfer = Math.min(L / 3, (K - r) / 2);
  const cy = L + Ri + e.section;
  const ring = Array.from({ length: 48 }, (_, i): Point3 => [Rc * Math.cos((i * Math.PI) / 24), 0, cy + Rc * Math.sin((i * Math.PI) / 24)]);
  return [
    ...shankSolid(e.shank),
    ...(L > 0 ? lathe([{ x: 0, y: 0 }, { x: K, y: 0 }, { x: K, y: L - chamfer }, { x: K - chamfer, y: L }, { x: 0, y: L }]) : []),
    // into the ring's section, where it joins
    ...lathe(box(0, L, r, cy - Rc)),
    ...tube(ring, half, true, 16),
  ];
}

export function swingBoltSolid(s: SwingBolt): Solid {
  const W = s.width / 2;
  const hole = { x: 0, y: s.shoulder };
  return [...shankSolid(s.shank), ...plate([[{ x: -W, y: 0 }, ...arc(hole, W, Math.PI, 0, ARC_STEPS * 2), { x: W, y: 0 }], circleOutline(hole, W / 2)], s.thickness)];
}

export function swingEyeSolid(s: SwingEyeBolt): Solid {
  const r = s.shank.thread.diameter / 2;
  const c = { x: 0, y: s.outside / 2 };
  return [...shankSolid(s.shank), ...plate([[{ x: -r, y: 0 }, ...overTop(c, s.outside / 2, r), { x: r, y: 0 }], circleOutline(c, s.inside / 2)], s.thickness)];
}

export function tBoltSolid(b: TBolt): Solid {
  const H = b.head / 2;
  return [...shankSolid(b.shank), ...prism([box(-H, -H, H, H)], 0, b.thickness)];
}

export function uBoltSolid(u: UBolt): Solid {
  const r = u.thread.diameter / 2;
  const c = u.inside / 2 + r;
  const down = -uLeg(u).length;
  return tube([{ x: -c, y: down }, ...arc({ x: 0, y: 0 }, c, Math.PI, 0, ARC_STEPS * 2), { x: c, y: down }].map(inPlane), r, false, 16);
}

/** A J-bolt: its rod along the shank, the bend and the anchor in the plane of the front view, its nut and washers on it. */
export function jBoltSolid(j: JBolt): Solid {
  const r = j.thread.diameter / 2;
  const Rc = j.bend + r;
  const yc = -j.length + r + Rc;
  const hand = j.right ? -1 : 1;
  const path = [{ x: 0, y: 0 }, ...arc({ x: -Rc, y: yc }, Rc, 0, -Math.PI / 2, ARC_STEPS), { x: r - j.anchor, y: -j.length + r }];
  return [
    ...tube(path.map((p) => inPlane({ x: hand * p.x, y: p.y })), r, false, 16),
    ...jStack(j).flatMap((p) => (p.kind === "washer" ? lathe(box(r, p.bottom, p.across / 2, p.bottom + p.height)) : polygonBody(p.kind === "square" ? 4 : 6, p.across, p.bottom, p.bottom + p.height, true, true))),
  ];
}

// ---- thumb screws ----------------------------------------------------------------------------

export type ThumbType = "aRegular" | "aHeavy" | "bRegular" | "bHeavy";
export type ThumbPoint = "plain" | "cup" | "dog" | "oval" | "cone";
export type ThumbView = "front" | "side" | "top";

/** A thumb screw size: its thread, the head's width, height and thickness at its rim, mid-section and shoulder (Type A's), and its practical lengths, mm. */
export interface ThumbSize {
  readonly thread: BoltThread;
  readonly head: number;
  readonly height: number;
  readonly thickness: number;
  readonly middle: number | null;
  readonly shoulder: number | null;
  readonly shortest: number;
  readonly longest: number;
}

/** ASME B18.17 (IFI 156) thumb screws, mid-tolerance, inches: thread, dc (head width), k (head height), h (thickness), c1 (mid-section, or 0), dk or ds (shoulder, or 0), L min and max. */
const THUMB_ROWS: Record<ThumbType, readonly (readonly [string, number, number, number, number, number, number, number])[]> = {
  aRegular: [
    ["#6-32 UNC", 0.3, 0.32, 0.045, 0, 0.24, 0.25, 0.75],
    ["#8-32 UNC", 0.35, 0.37, 0.055, 0, 0.3, 0.38, 0.75],
    ["#10-24 UNC", 0.41, 0.47, 0.055, 0, 0.335, 0.38, 1],
    ["#12-24 UNC", 0.47, 0.53, 0.055, 0, 0.39, 0.38, 1],
    ["1/4-20 UNC", 0.535, 0.625, 0.06, 0, 0.455, 0.5, 1.5],
    ["5/16-18 UNC", 0.685, 0.765, 0.08, 0, 0.575, 0.5, 1.5],
    ["3/8-16 UNC", 0.815, 0.935, 0.1, 0, 0.735, 0.75, 2],
  ],
  aHeavy: [
    ["#10-24 UNC", 0.86, 0.78, 0.17, 0.09, 0.32, 0.5, 2],
    ["1/4-20 UNC", 1.02, 0.875, 0.23, 0.09, 0.39, 0.5, 3],
    ["5/16-18 UNC", 1.18, 0.94, 0.26, 0.1, 0.45, 0.5, 4],
    ["3/8-16 UNC", 1.375, 1.095, 0.29, 0.1, 0.54, 0.5, 4],
    ["7/16-14 UNC", 1.56, 1.155, 0.35, 0.12, 0.7, 1, 2.5],
    ["1/2-13 UNC", 1.765, 1.22, 0.39, 0.13, 0.82, 1, 3],
  ],
  bRegular: [
    ["#6-32 UNC", 0.44, 0.27, 0.07, 0.025, 0, 0.25, 1],
    ["#8-32 UNC", 0.5, 0.31, 0.08, 0.03, 0, 0.38, 1],
    ["#10-24 UNC", 0.56, 0.375, 0.09, 0.04, 0, 0.38, 2],
    ["#12-24 UNC", 0.69, 0.44, 0.1, 0.04, 0, 0.38, 2],
    ["1/4-20 UNC", 0.815, 0.5, 0.15, 0.045, 0, 0.5, 2.5],
    ["5/16-18 UNC", 0.935, 0.62, 0.155, 0.075, 0, 0.5, 3],
    ["3/8-16 UNC", 1.06, 0.69, 0.2, 0.095, 0, 0.75, 3],
    ["7/16-14 UNC", 1.375, 0.935, 0.255, 0.125, 0, 1, 4],
    ["1/2-13 UNC", 1.5, 1.06, 0.31, 0.13, 0, 1, 4],
  ],
  bHeavy: [
    ["#10-24 UNC", 0.86, 0.72, 0.17, 0.07, 0, 0.5, 2],
    ["1/4-20 UNC", 1.02, 0.765, 0.23, 0.1, 0, 0.5, 3],
    ["5/16-18 UNC", 1.18, 0.83, 0.26, 0.1, 0, 0.5, 4],
    ["3/8-16 UNC", 1.375, 0.89, 0.29, 0.13, 0, 0.5, 4],
    ["7/16-14 UNC", 1.56, 0.955, 0.35, 0.13, 0, 1, 3],
    ["1/2-13 UNC", 1.765, 1.03, 0.39, 0.17, 0, 1, 3],
  ],
};

const thumbSize = ([id, dc, k, h, c1, shoulder, lo, hi]: (typeof THUMB_ROWS)[ThumbType][number]): ThumbSize => {
  const t = INCH_THREADS.find((u) => u.name === id)!;
  return {
    thread: { id, diameter: t.diameter, pitch: t.pitch, inch: true },
    head: dc * INCH,
    height: k * INCH,
    thickness: h * INCH,
    middle: c1 ? c1 * INCH : null,
    shoulder: shoulder ? shoulder * INCH : null,
    shortest: lo * INCH,
    longest: hi * INCH,
  };
};

export const THUMB_SIZES: Record<ThumbType, readonly ThumbSize[]> = {
  aRegular: THUMB_ROWS.aRegular.map(thumbSize),
  aHeavy: THUMB_ROWS.aHeavy.map(thumbSize),
  bRegular: THUMB_ROWS.bRegular.map(thumbSize),
  bHeavy: THUMB_ROWS.bHeavy.map(thumbSize),
};

/** Points in proportion to the diameter, as ASME B18.3's set screws': cup or flat 0.54 across, dog 0.62 across and 0.5 long, oval a 0.75 radius, cone 90°. */
const CUP = 0.54;
const DOG = 0.62;
const DOG_LONG = 0.5;
const OVAL = 0.75;

/** Machine screw length increments (ASME B18.6.3): 1/16 in to 1/4 in, 1/8 in to 1 in, 1/4 in to 4 in, 1/2 in past. */
export function thumbLength(s: ThumbSize, length: number): number {
  const inches = length / INCH;
  const step = inches < 0.25 ? 1 / 16 : inches < 1 ? 1 / 8 : inches < 4 ? 1 / 4 : 1 / 2;
  return Math.min(s.longest, Math.max(s.shortest, Math.round(inches / step) * step * INCH));
}

/** A point's own sizes where a standard's table gives them (a set screw's): across a flat or cup end or a dog, a dog's length, an oval's radius, a cone's tip and included angle (degrees). What's left out is in proportion, as above. */
export interface PointSize {
  readonly diameter?: number;
  readonly length?: number;
  readonly radius?: number;
  readonly tip?: number;
  readonly angle?: number;
}

/** how far a point reaches past where the thread's full diameter ends */
export function pointLength(t: BoltThread, point: ThumbPoint, size: PointSize = {}): number {
  const D = t.diameter;
  if (point === "dog") return size.length ?? DOG_LONG * D;
  if (point === "cone") return (D - (size.tip ?? 0)) / 2 / Math.tan(((size.angle ?? 90) * Math.PI) / 360);
  if (point === "oval") {
    const R = Math.max(size.radius ?? OVAL * D, D / 2);
    return R - Math.sqrt(R * R - (D / 2) ** 2);
  }
  return 0;
}

/** the chamfer the thread ends in: down to a flat or cup point's end, or (plain, dog) its own depth */
export function pointChamfer(t: BoltThread, point: ThumbPoint, size: PointSize = {}): number {
  const D = t.diameter;
  if (point === "plain") return size.diameter === undefined ? endChamfer(t) : (D - size.diameter) / 2;
  if (point === "cup") return (D - (size.diameter ?? CUP * D)) / 2;
  return point === "dog" ? endChamfer(t) : 0;
}

/** Seen from its end, a point's end face (its radius, 0 for none) and a cup's recess. */
export function pointFace(t: BoltThread, point: ThumbPoint, size: PointSize = {}): { end: number; recess: number } {
  const D = t.diameter;
  if (point === "plain" || point === "cup") {
    const end = D / 2 - pointChamfer(t, point, size);
    return { end, recess: point === "cup" ? 0.75 * end : 0 };
  }
  if (point === "dog") return { end: (size.diameter ?? DOG * D) / 2, recess: 0 };
  return { end: point === "cone" ? (size.tip ?? 0) / 2 : 0, recess: 0 };
}

export function thumbProblem(s: ThumbSize, length: number, point: ThumbPoint): string | null {
  const least = pointLength(s.thread, point) + 2 * endChamfer(s.thread);
  if (!(length > least)) return `the length must be more than its point takes (${round2(least)} mm)`;
  return null;
}

/** A screw's shank hanging from `top` (its bearing face), `length` long, plain for its first `plain` (`plainDiameter` across, a thread undercut's) and threaded on to its end, ending in `point` (in the standard's sizes where `size` gives them). A cup's recess is hidden. */
export function pointedShank(t: BoltThread, length: number, point: ThumbPoint, display: ThreadDisplay, plain = 0, top = 0, size: PointSize = {}, plainDiameter = t.diameter): { edge: Pt[]; lines: Pt[][]; hidden: Pt[][] } {
  const D = t.diameter;
  const tip = pointLength(t, point, size);
  const body = length - tip - plain;
  // a thread's chamfer stops at its root: what a flat or cup point's takes past that is a plain cone
  const chamfer = pointChamfer(t, point, size);
  const depth = endChamfer(t);
  const cone = chamfer > depth + 1e-9 ? chamfer - depth : 0;
  const segments = [
    ...(plain > 1e-9 ? [straight(plain, plainDiameter)] : []),
    threaded(t, body - cone, Math.min(chamfer, depth)),
    ...(cone > 0 ? [tapered(cone, D - 2 * depth, D - 2 * chamfer)] : []),
    ...(point === "dog" ? [straight(tip, size.diameter ?? DOG * D, 0.06 * D)] : []),
  ];
  const s = shaftAlong(segments, display, hanging(top));
  if (point === "oval" || point === "cone") {
    // the end across where the point starts gives way to its arc or cone
    const y = top - plain - body;
    const i = s.edge.findIndex((p, k) => k > 0 && Math.abs(p.y - y) < 1e-6 && Math.abs(s.edge[k - 1].y - y) < 1e-6 && s.edge[k - 1].x > p.x);
    const R = Math.max(size.radius ?? OVAL * D, D / 2);
    const a = Math.asin(D / 2 / R);
    const w = (size.tip ?? 0) / 2;
    const cap = point === "oval" ? arc({ x: 0, y: top - length + R }, R, -Math.PI / 2 + a, -Math.PI / 2 - a, ARC_STEPS).slice(1, -1) : w > 1e-9 ? [{ x: w, y: top - length }, { x: -w, y: top - length }] : [{ x: 0, y: top - length }];
    if (i > 0) s.edge.splice(i, 0, ...cap);
    s.lines.push(horizontal(y, -D / 2, D / 2));
  }
  if (point === "cup") {
    // the cup's 118° recess, from three quarters of its end across
    const r = pointFace(t, point, size).recess;
    s.hidden.push([{ x: -r, y: top - length }, { x: 0, y: top - length + r * Math.tan((31 * Math.PI) / 180) }, { x: r, y: top - length }]);
  }
  return s;
}

/** a quadratic curve from a through control c to b, a excluded */
function quad(a: Pt, c: Pt, b: Pt, steps = 10): Pt[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  });
}

/** points round an ellipse `ax` by `ay` about c, from angle t0 to t1 */
const ellipse = (c: Pt, ax: number, ay: number, t0: number, t1: number, steps = ARC_STEPS * 2): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / steps;
    return { x: c.x + ax * Math.cos(t), y: c.y + ay * Math.sin(t) };
  });

/** An oval head `H` across each way, its top at k, cut where it meets a neck `w` across each way at height y0: the ellipse runs on below the cut. */
function ovalHead(H: number, k: number, w: number, y0: number): { over: Pt[]; foot: Pt } {
  const q = Math.sqrt(1 - Math.min(0.81, (w / H) ** 2));
  const ay = (k - y0) / (1 + q);
  const a = Math.asin(q);
  const over = ellipse({ x: 0, y: k - ay }, H, ay, -a, Math.PI + a);
  return { over, foot: over[0] };
}

/** A thumb screw from the front (its head's face), side (edge on) or top, its bearing face on the origin, the head up. Type A regular's round head pinches to a waist that flares to a thin shoulder plate; Type A heavy's oval head sits on a round collar a fifth of its height; a Type B oval head meets the thread on a neck as wide, an eighth of its height. Edge on, a heavy or Type B head is dished to its mid-section between rims its thickness. */
export function thumbScrew(type: ThumbType, s: ThumbSize, length: number, point: ThumbPoint, display: ThreadDisplay, view: ThumbView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const r = s.thread.diameter / 2;
  const k = s.height;
  const H = s.head / 2;
  const h = s.thickness / 2;
  const S = (s.shoulder ?? s.thread.diameter) / 2;
  if (view === "top") {
    const under = Math.max(S, r);
    d.outlines.push(stadium({ x: 0, y: 0 }, H, h));
    if (under > h) {
      const a = Math.asin(h / under);
      d.lines.push(arc({ x: 0, y: 0 }, under, a, Math.PI - a, ARC_STEPS), arc({ x: 0, y: 0 }, under, Math.PI + a, 2 * Math.PI - a, ARC_STEPS));
    }
    if (beyond !== null) d.lines.push(horizontal(0, -H - beyond, H + beyond), vertical(0, -Math.max(under, h) - beyond, Math.max(under, h) + beyond));
    return d;
  }
  const sh = pointedShank(s.thread, length, point, display);
  d.lines.push(...sh.lines);
  d.hidden.push(...sh.hidden);
  // up: the head's right side from its foot; over: its top, right to left
  let up: Pt[];
  let over: Pt[] = [];
  // edge on, a dished head from its foot `w` across at y0 in to its mid-section and out to its rim
  const dished = (w: number, y0: number): Pt[] => {
    const m = (s.middle ?? s.thickness) / 2;
    return quad({ x: w, y: y0 }, { x: 2 * m - (w + h) / 2, y: (y0 + k) / 2 }, { x: h, y: k });
  };
  if (type === "aRegular") {
    const lip = 0.03 * k;
    const waist = 0.2 * k;
    if (view === "front") {
      const c = { x: 0, y: k - H };
      const cut = Math.min(0.3 * k, c.y - 0.3 * H);
      const J = { x: Math.sqrt(H * H - (c.y - cut) ** 2), y: cut };
      const neck = Math.min(0.75 * r, 0.6 * J.x);
      const a = Math.atan2(J.y - c.y, J.x);
      up = [{ x: S, y: 0 }, { x: S, y: lip }, { x: neck, y: waist }, ...quad({ x: neck, y: waist }, { x: neck, y: J.y }, J).slice(0, -1)];
      over = arc(c, H, a, Math.PI - a, ARC_STEPS * 2);
    } else {
      up = [{ x: S, y: 0 }, { x: S, y: lip }, { x: h, y: waist }];
      over = arc({ x: 0, y: k - h }, h, 0, Math.PI, ARC_STEPS / 2);
    }
    d.lines.push(horizontal(lip, -S, S));
  } else {
    // a heavy Type A's collar, or a Type B's neck as wide as its thread
    const foot = type === "aHeavy" ? 0.2 * k : 0.125 * k;
    const w = type === "aHeavy" ? S : r;
    if (view === "front") {
      const head = ovalHead(H, k, type === "aHeavy" ? Math.min(1.1 * S, 0.9 * H) : r, foot);
      up = [{ x: w, y: 0 }, { x: w, y: foot }, ...(head.foot.x > w + 1e-9 ? [{ x: head.foot.x, y: foot }] : [])];
      over = head.over.slice(head.foot.x > w + 1e-9 ? 1 : 0);
    } else up = [{ x: w, y: 0 }, { x: w, y: foot }, ...dished(w, foot)];
    d.lines.push(horizontal(type === "aHeavy" ? foot : 0, -w, w));
  }
  const mirror = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y }));
  d.outlines.push([...sh.edge, ...mirror(up), ...[...over].reverse(), ...[...up].reverse()]);
  if (beyond !== null) d.lines.push(vertical(0, k + beyond, -length - beyond));
  return d;
}

/** A thumb screw: its head the front view's as a plate as thick as the head, its shank turned. */
export function thumbScrewSolid(type: ThumbType, s: ThumbSize, length: number, point: ThumbPoint, display: ThreadDisplay): Solid {
  const front = thumbScrew(type, s, length, point, display, "front", null).outlines[0];
  return [...lathe(axisProfile(pointedShank(s.thread, length, point, display).edge, "y")), ...plate([clipOutline(front, (p) => p.y)], s.thickness)];
}
