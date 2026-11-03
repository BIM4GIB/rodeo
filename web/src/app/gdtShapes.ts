// Feature control frame (GD&T, as ASME Y14.5 and ISO 1101 draw it): a row of boxes holding the
// geometric characteristic's symbol, the tolerance with its modifiers, and up to three datum
// references. Pure geometry: the symbols are drawn as lines, circles and filled arrowheads rather
// than font glyphs, so they look the same whatever fonts a drawing has. Sizes are in text heights;
// the tool passes the height on paper times the layer scale.

import type { Pt } from "../core/index.ts";
import { placed } from "./detailShapes.ts";
import { CHAR_WIDTH, type MarkerDrawing, type MarkerText } from "./markerShapes.ts";

export type Characteristic =
  | "none"
  | "straightness"
  | "flatness"
  | "circularity"
  | "cylindricity"
  | "lineprofile"
  | "surfaceprofile"
  | "angularity"
  | "perpendicularity"
  | "parallelism"
  | "position"
  | "concentricity"
  | "symmetry"
  | "circularrunout"
  | "totalrunout";

export const CHARACTERISTICS: readonly { readonly id: Characteristic; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "straightness", label: "Straightness" },
  { id: "flatness", label: "Flatness" },
  { id: "circularity", label: "Circularity" },
  { id: "cylindricity", label: "Cylindricity" },
  { id: "lineprofile", label: "Profile of a line" },
  { id: "surfaceprofile", label: "Profile of a surface" },
  { id: "angularity", label: "Angularity" },
  { id: "perpendicularity", label: "Perpendicularity" },
  { id: "parallelism", label: "Parallelism" },
  { id: "position", label: "Position" },
  { id: "concentricity", label: "Concentricity" },
  { id: "symmetry", label: "Symmetry" },
  { id: "circularrunout", label: "Circular runout" },
  { id: "totalrunout", label: "Total runout" },
];

/** A material condition modifier: maximum (M), least (L), regardless of feature size (S), or none. */
export type MaterialCondition = "none" | "M" | "L" | "S";

export interface DatumReference {
  readonly letter: string;
  readonly condition: MaterialCondition;
}

export interface FeatureControl {
  readonly characteristic: Characteristic;
  /** the characteristic's box two rows high, for a second frame placed under this one */
  readonly composite: boolean;
  /** the tolerance's value; empty leaves its box out unless a modifier needs it */
  readonly tolerance: string;
  readonly diameter: boolean;
  readonly condition: MaterialCondition;
  readonly statistical: boolean;
  readonly projected: boolean;
  readonly zoneHeight: string;
  /** the projected tolerance zone's symbol and height under the frame rather than in it */
  readonly projectedOutside: boolean;
  /** primary, secondary and tertiary, those with a letter */
  readonly datums: readonly DatumReference[];
}

/** a box's height, in text heights */
const BOX = 2;
/** space either side of a box's contents, and between items in a box, in text heights */
const PAD = 0.5;
const SPACE = 0.3;
/** a characteristic symbol's size, in text heights */
const SYMBOL = 1.2;
/** a circled modifier's radius, and its letter's height, in text heights */
const RING = 0.62;
const RING_TEXT = 0.8;
/** points along a profile symbol's half circle */
const PROFILE_STEPS = 16;

/** A drawing being built in the frame's own terms: x along the frame, y up, its left end's middle at the origin. */
interface Sketch {
  readonly lines: Pt[][];
  readonly circles: { center: Pt; radius: number }[];
  readonly filled: Pt[][];
  readonly texts: MarkerText[];
}

/** A text's rough width. */
function width(text: string, h: number): number {
  return [...text].length * CHAR_WIDTH * h;
}

/** Lines, circles and arrowheads of a characteristic's symbol, `s` across, centred on `c`. */
function symbol(k: Characteristic, c: Pt, s: number, out: Sketch): void {
  const p = (x: number, y: number): Pt => ({ x: c.x + x * s, y: c.y + y * s });
  const circle = (r: number): void => void out.circles.push({ center: c, radius: r * s });
  const halfCircle = (): Pt[] =>
    Array.from({ length: PROFILE_STEPS + 1 }, (_, i) => {
      const t = (Math.PI * i) / PROFILE_STEPS;
      return p(0.45 * Math.cos(t), -0.2 + 0.45 * Math.sin(t));
    });
  const arrow = (tail: Pt, tip: Pt): void => {
    const len = Math.hypot(tip.x - tail.x, tip.y - tail.y);
    const u = { x: (tip.x - tail.x) / len, y: (tip.y - tail.y) / len };
    const back = 0.3 * s;
    const side = 0.1 * s;
    const base = { x: tip.x - u.x * back, y: tip.y - u.y * back };
    out.lines.push([tail, base]);
    out.filled.push([tip, { x: base.x - u.y * side, y: base.y + u.x * side }, { x: base.x + u.y * side, y: base.y - u.x * side }]);
  };
  switch (k) {
    case "none":
      return;
    case "straightness":
      out.lines.push([p(-0.5, 0), p(0.5, 0)]);
      return;
    case "flatness":
      out.lines.push([p(-0.5, -0.25), p(0.25, -0.25), p(0.5, 0.25), p(-0.25, 0.25), p(-0.5, -0.25)]);
      return;
    case "circularity":
      circle(0.4);
      return;
    case "cylindricity":
      circle(0.3);
      out.lines.push([p(-0.5, -0.45), p(-0.2, 0.45)], [p(0.2, -0.45), p(0.5, 0.45)]);
      return;
    case "lineprofile":
      out.lines.push(halfCircle());
      return;
    case "surfaceprofile": {
      const arc = halfCircle();
      out.lines.push([...arc, arc[0]]);
      return;
    }
    case "angularity":
      out.lines.push([p(0.45, 0.25), p(-0.5, -0.35), p(0.5, -0.35)]);
      return;
    case "perpendicularity":
      out.lines.push([p(-0.45, -0.4), p(0.45, -0.4)], [p(0, -0.4), p(0, 0.5)]);
      return;
    case "parallelism":
      out.lines.push([p(-0.4, -0.45), p(-0.05, 0.45)], [p(0.05, -0.45), p(0.4, 0.45)]);
      return;
    case "position":
      circle(0.3);
      out.lines.push([p(-0.5, 0), p(0.5, 0)], [p(0, -0.5), p(0, 0.5)]);
      return;
    case "concentricity":
      circle(0.2);
      circle(0.42);
      return;
    case "symmetry":
      out.lines.push([p(-0.5, 0), p(0.5, 0)], [p(-0.3, 0.25), p(0.3, 0.25)], [p(-0.3, -0.25), p(0.3, -0.25)]);
      return;
    case "circularrunout":
      arrow(p(-0.35, -0.4), p(0.4, 0.45));
      return;
    case "totalrunout":
      out.lines.push([p(-0.5, -0.45), p(0.05, -0.45)]);
      arrow(p(-0.5, -0.45), p(-0.05, 0.45));
      arrow(p(0.05, -0.45), p(0.5, 0.45));
      return;
  }
}

/** A circled letter (a material condition, or P for a projected zone) centred on `c`. */
function ringed(letter: string, c: Pt, h: number, out: Sketch): void {
  out.circles.push({ center: c, radius: RING * h });
  out.texts.push({ at: c, text: letter, height: RING_TEXT * h, justify: "centre" });
}

/** How wide a circled letter is. */
const RING_WIDTH = 2 * RING;

/** A projected tolerance zone: P in a circle, then the zone's height, from `x` along the line at height `y`; returns where it ends. */
function projectedZone(zone: string, x: number, y: number, h: number, out: Sketch): number {
  ringed("P", { x: x + RING * h, y }, h, out);
  let end = x + RING_WIDTH * h;
  if (zone) {
    out.texts.push({ at: { x: end + SPACE * h, y }, text: zone, height: h, justify: "left" });
    end += SPACE * h + width(zone, h);
  }
  return end;
}

/**
 * A feature control frame at `at`, its left end's middle there, turned `angle` radians, its text
 * `h` high; boxes `BOX` text heights tall. Null when it would hold nothing.
 */
export function featureControlFrame(f: FeatureControl, at: Pt, angle: number, h: number): MarkerDrawing | null {
  if (!(h > 0)) return null;
  const out: Sketch = { lines: [], circles: [], filled: [], texts: [] };
  const box = BOX * h;
  const top = box / 2;
  const bottom = -box / 2;
  /** where each box ends along the frame */
  const walls: number[] = [];
  let x = 0;

  if (f.characteristic !== "none") {
    const low = f.composite ? bottom - box : bottom;
    symbol(f.characteristic, { x: box / 2, y: (top + low) / 2 }, SYMBOL * h, out);
    if (f.composite) out.lines.push([{ x: 0, y: bottom }, { x: 0, y: low }, { x: box, y: low }, { x: box, y: bottom }]);
    x = box;
    walls.push(x);
  }

  const inside = f.projected && !f.projectedOutside;
  if (f.tolerance || f.diameter || f.condition !== "none" || f.statistical || inside) {
    const start = x;
    let pen = x + PAD * h;
    const next = (w: number): number => {
      const from = pen;
      pen += w + SPACE * h;
      return from;
    };
    if (f.diameter) {
      const from = next(1.1 * h);
      const c = { x: from + 0.55 * h, y: 0 };
      out.circles.push({ center: c, radius: 0.4 * h });
      out.lines.push([
        { x: c.x - 0.5 * h, y: -0.5 * h },
        { x: c.x + 0.5 * h, y: 0.5 * h },
      ]);
    }
    if (f.tolerance) out.texts.push({ at: { x: next(width(f.tolerance, h)), y: 0 }, text: f.tolerance, height: h, justify: "left" });
    if (f.condition !== "none") ringed(f.condition, { x: next(RING_WIDTH * h) + RING * h, y: 0 }, h, out);
    if (f.statistical) {
      const c = { x: next(2.2 * h) + 1.1 * h, y: 0 };
      const hex = [
        [-1.1, 0],
        [-0.75, 0.65],
        [0.75, 0.65],
        [1.1, 0],
        [0.75, -0.65],
        [-0.75, -0.65],
        [-1.1, 0],
      ].map(([px, py]) => ({ x: c.x + px * h, y: c.y + py * h }));
      out.lines.push(hex);
      out.texts.push({ at: c, text: "ST", height: RING_TEXT * h, justify: "centre" });
    }
    if (inside) pen = projectedZone(f.zoneHeight, pen, 0, h, out) + SPACE * h;
    // the last item's trailing space gives way to the box's padding
    x = Math.max(pen - SPACE * h + PAD * h, start + box);
    walls.push(x);
    if (f.projected && f.projectedOutside) projectedZone(f.zoneHeight, start + PAD * h, bottom - box / 2, h, out);
  }

  for (const d of f.datums) {
    if (!d.letter) continue;
    const lettered = width(d.letter, h);
    const content = lettered + (d.condition === "none" ? 0 : SPACE * h + RING_WIDTH * h);
    const w = Math.max(box, content + 2 * PAD * h);
    const from = x + (w - content) / 2;
    out.texts.push({ at: { x: from, y: 0 }, text: d.letter, height: h, justify: "left" });
    if (d.condition !== "none") ringed(d.condition, { x: from + lettered + SPACE * h + RING * h, y: 0 }, h, out);
    x += w;
    walls.push(x);
  }

  if (walls.length === 0) return null;
  out.lines.push([
    { x: 0, y: bottom },
    { x, y: bottom },
    { x, y: top },
    { x: 0, y: top },
    { x: 0, y: bottom },
  ]);
  for (const w of walls.slice(0, -1)) out.lines.push([{ x: w, y: bottom }, { x: w, y: top }]);

  const deg = (angle * 180) / Math.PI;
  const move = (p: Pt): Pt => placed([p], at, angle)[0];
  return {
    outlines: [],
    lines: out.lines.map((l) => placed(l, at, angle)),
    circles: out.circles.map((c) => ({ center: move(c.center), radius: c.radius })),
    filled: out.filled.map((l) => placed(l, at, angle)),
    texts: out.texts.map((t) => ({ ...t, at: move(t.at), angle: deg })),
  };
}

/** What a geometric dimensioning and tolerancing note gives the size of. */
export type HoleNoteType = "round" | "square" | "counterbore" | "countersink" | "conical" | "flat" | "depth";

export const HOLE_NOTE_TYPES: readonly { readonly id: HoleNoteType; readonly label: string }[] = [
  { id: "round", label: "Round Hole (and Depth)" },
  { id: "square", label: "Square Hole (and Depth)" },
  { id: "counterbore", label: "Counterbore (and Depth)" },
  { id: "countersink", label: "Countersink" },
  { id: "conical", label: "Conical Taper" },
  { id: "flat", label: "Flat Taper" },
  { id: "depth", label: "Depth" },
];

/** How a value's tolerance is written: not at all, ±, + over −, or as its upper and lower limits stacked or in a line. */
export type ToleranceStyle = "none" | "single" | "double" | "limit1" | "limit2";

export const TOLERANCE_STYLES: readonly { readonly id: ToleranceStyle; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "single", label: "Single" },
  { id: "double", label: "Double" },
  { id: "limit1", label: "Limit (1)" },
  { id: "limit2", label: "Limit (2)" },
];

/** A value with its tolerance: `top` is added to it for the upper limit, `bottom` taken from it for the lower. */
export interface Toleranced {
  readonly value: number;
  readonly style: ToleranceStyle;
  readonly top: number;
  readonly bottom: number;
}

export interface HoleNote {
  readonly type: HoleNoteType;
  /** the hole's size, or a taper's ratio to 1 */
  readonly size: Toleranced;
  /** the hole's depth (not shown when 0 or less), or a countersink's angle in degrees */
  readonly depth: Toleranced;
  /** text before the note and after it */
  readonly leader: string;
  readonly trailer: string;
}

/** A note's leader: from `point`, where its arrow points, to a shoulder `shoulder` long leaving the note's left or right end. */
export interface NoteLeader {
  readonly point: Pt;
  readonly side: "left" | "right";
  readonly shoulder: number;
}

/** stacked tolerances' and limits' height, and how far each sits off the line, in text heights */
const STACK_TEXT = 0.7;
const STACK_OFF = 0.42;
/** the gap between a diameter sign or a value and what follows it closely, in text heights */
const TIGHT = 0.05;
/** a leader's arrowhead length and half width, and the gap between a shoulder and the note, in text heights */
const NOTE_ARROW = 1;
const NOTE_ARROW_SIDE = 0.3;
const SHOULDER_GAP = 0.3;

/** Degrees as a note writes them: to two places at most, with no trailing zeros. */
function degrees(v: number): string {
  return `${Number(v.toFixed(2))}°`;
}

/**
 * A geometric dimensioning and tolerancing note at `at`, turned `angle` radians, its text `h` high:
 * the type's symbol (drawn as lines), the size with its tolerance, and the depth or a countersink's
 * angle, each number written by `fmt`, between the leader and trailer texts. Without a leader its
 * left end's middle is at `at`; with one, `at` is where the leader meets the shoulder. Null when
 * `h` isn't more than 0.
 */
export function holeNote(n: HoleNote, at: Pt, angle: number, h: number, fmt: (v: number) => string, leader: NoteLeader | null): MarkerDrawing | null {
  if (!(h > 0)) return null;
  const out: Sketch = { lines: [], circles: [], filled: [], texts: [] };
  /** what goes along the note, each placed at a pen position and returning its width */
  const items: { gap: number; width: number; draw: (x: number) => void }[] = [];
  const put = (width: number, draw: (x: number) => void, gap = SPACE * h): void => void items.push({ gap: items.length ? gap : 0, width, draw });
  const text = (s: string, gap?: number): void => put(width(s, h), (x) => void out.texts.push({ at: { x, y: 0 }, text: s, height: h, justify: "left" }), gap);
  const stacked = (upper: string, lower: string, gap?: number): void =>
    put(
      Math.max(width(upper, STACK_TEXT * h), width(lower, STACK_TEXT * h)),
      (x) => {
        out.texts.push({ at: { x, y: STACK_OFF * h }, text: upper, height: STACK_TEXT * h, justify: "left" });
        out.texts.push({ at: { x, y: -STACK_OFF * h }, text: lower, height: STACK_TEXT * h, justify: "left" });
      },
      gap,
    );
  const lines = (w: number, pts: (x: number) => Pt[][]): void => put(w * h, (x) => void out.lines.push(...pts(x)));
  const at0 = (x: number, px: number, py: number): Pt => ({ x: x + px * h, y: py * h });

  const diameter = (): void =>
    put(1.1 * h, (x) => {
      const c = { x: x + 0.55 * h, y: 0 };
      out.circles.push({ center: c, radius: 0.4 * h });
      out.lines.push([at0(c.x, -0.5, -0.5), at0(c.x, 0.5, 0.5)]);
    });
  const depthSymbol = (): void =>
    lines(0.8, (x) => [
      [at0(x, 0, 0.45), at0(x, 0.8, 0.45)],
      [at0(x, 0.4, 0.45), at0(x, 0.4, -0.45)],
      [at0(x, 0.15, -0.1), at0(x, 0.4, -0.45), at0(x, 0.65, -0.1)],
    ]);
  /** a value with its tolerance, each number written by `write`, then `suffix`; `closely` sets it against what comes before */
  const toleranced = (v: Toleranced, write: (v: number) => string, closely: boolean, suffix = ""): void => {
    const gap = closely ? TIGHT * h : undefined;
    const signed = (t: number): string => (t >= 0 ? `+${write(t)}` : write(t));
    switch (v.style) {
      case "none":
        return text(`${write(v.value)}${suffix}`, gap);
      case "single":
        return text(`${write(v.value)}±${write(v.top)}${suffix}`, gap);
      case "double":
        text(write(v.value), gap);
        stacked(signed(v.top), signed(-v.bottom), TIGHT * h);
        break;
      case "limit1":
        stacked(write(v.value + v.top), write(v.value - v.bottom), gap);
        break;
      case "limit2":
        return text(`${write(v.value - v.bottom)} - ${write(v.value + v.top)}${suffix}`, gap);
    }
    if (suffix) text(suffix, TIGHT * h);
  };
  const depthPart = (): void => {
    if (!(n.depth.value > 0)) return;
    depthSymbol();
    toleranced(n.depth, fmt, false);
  };

  if (n.leader) text(n.leader);
  switch (n.type) {
    case "round":
      diameter();
      toleranced(n.size, fmt, true);
      depthPart();
      break;
    case "square":
      lines(0.8, (x) => [[at0(x, 0, -0.4), at0(x, 0.8, -0.4), at0(x, 0.8, 0.4), at0(x, 0, 0.4), at0(x, 0, -0.4)]]);
      toleranced(n.size, fmt, false);
      depthPart();
      break;
    case "counterbore":
      lines(1.3, (x) => [[at0(x, 0, 0.3), at0(x, 0, -0.35), at0(x, 1.3, -0.35), at0(x, 1.3, 0.3)]]);
      diameter();
      toleranced(n.size, fmt, true);
      depthPart();
      break;
    case "countersink":
      lines(1.3, (x) => [[at0(x, 0, 0.35), at0(x, 0.65, -0.35), at0(x, 1.3, 0.35)]]);
      diameter();
      toleranced(n.size, fmt, true);
      text("X");
      toleranced(n.depth, degrees, false);
      break;
    case "conical":
      lines(2, (x) => [
        [at0(x, 0, 0), at0(x, 2, 0)],
        [at0(x, 0.3, 0.4), at0(x, 1.85, 0), at0(x, 0.3, -0.4), at0(x, 0.3, 0.4)],
      ]);
      toleranced(n.size, fmt, false, ":1");
      break;
    case "flat":
      lines(1.8, (x) => [[at0(x, 0, 0.3), at0(x, 0, -0.3), at0(x, 1.8, -0.3), at0(x, 0, 0.3)]]);
      toleranced(n.size, fmt, false, ":1");
      break;
    case "depth":
      depthSymbol();
      toleranced(n.depth, fmt, false);
      break;
  }
  if (n.trailer) text(n.trailer);

  const total = items.reduce((w, it) => w + it.gap + it.width, 0);
  // with a leader the note sits past its shoulder, `at` being where the shoulder meets the leader
  const start = !leader ? 0 : leader.side === "left" ? leader.shoulder + SHOULDER_GAP * h : -(leader.shoulder + SHOULDER_GAP * h + total);
  let x = start;
  for (const it of items) {
    x += it.gap;
    it.draw(x);
    x += it.width;
  }
  if (leader) {
    // the arrow's point in the note's own terms
    const d = { x: leader.point.x - at.x, y: leader.point.y - at.y };
    const tip = { x: d.x * Math.cos(-angle) - d.y * Math.sin(-angle), y: d.x * Math.sin(-angle) + d.y * Math.cos(-angle) };
    const end = leader.side === "left" ? leader.shoulder : -leader.shoulder;
    out.lines.push([{ x: end, y: 0 }, { x: 0, y: 0 }]);
    const len = Math.hypot(tip.x, tip.y);
    if (len > 0) {
      const u = { x: tip.x / len, y: tip.y / len };
      const back = Math.min(NOTE_ARROW * h, len);
      const base = { x: tip.x - u.x * back, y: tip.y - u.y * back };
      const side = NOTE_ARROW_SIDE * h * (back / (NOTE_ARROW * h));
      out.lines.push([{ x: 0, y: 0 }, base]);
      out.filled.push([tip, { x: base.x - u.y * side, y: base.y + u.x * side }, { x: base.x + u.y * side, y: base.y - u.x * side }]);
    }
  }

  const deg = (angle * 180) / Math.PI;
  const move = (p: Pt): Pt => placed([p], at, angle)[0];
  return {
    outlines: [],
    lines: out.lines.map((l) => placed(l, at, angle)),
    circles: out.circles.map((c) => ({ center: move(c.center), radius: c.radius })),
    filled: out.filled.map((l) => placed(l, at, angle)),
    texts: out.texts.map((t) => ({ ...t, at: move(t.at), angle: deg })),
  };
}
