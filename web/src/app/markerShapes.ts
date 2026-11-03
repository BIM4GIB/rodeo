// What the Dims/Notes markers draw (tools/markers.ts, tools/sectionLine.ts), as plain geometry: a
// section line or an elevation's look, a section-elevation line, an interior elevation's four looks, a detail's boundary and its callout, a
// drawing label, a reference marker with its leader and an elevation benchmark, each built round a
// bubble (a circle split level across its middle, the drawing's number above and its sheet's
// below); and a north arrow, a scale bar, a data tag, a legend's layout, a symmetry label and a
// centre mark. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { Drawing } from "./detailShapes.ts";
import { dist } from "./geom.ts";

/** Text as a marker places it: centred on `at`, or starting or ending there. */
export interface MarkerText {
  readonly at: Pt;
  readonly text: string;
  readonly height: number;
  readonly justify: "left" | "centre" | "right";
  /** turned this many degrees counter-clockwise; level when absent */
  readonly angle?: number;
}

export interface MarkerDrawing extends Drawing {
  /** closed outlines filled solid in the pen's colour: the arrows and a benchmark's quarters */
  readonly filled: Pt[][];
  readonly texts: MarkerText[];
}

/** a bubble's arrow reaches this many radii from its centre */
const ARROW_REACH = 1.6;
/** points along the arc an arrow wraps round its bubble */
const ARROW_STEPS = 12;
/** a text's height against its bubble's radius */
const TEXT_SHARE = 0.45;
/** average width of a character as a share of the text height, for sizing what runs past text */
export const CHAR_WIDTH = 0.6;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dir = (angle: number): Pt => ({ x: Math.cos(angle), y: Math.sin(angle) });

function empty(): { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[] } {
  return { outlines: [], lines: [], circles: [], filled: [], texts: [] };
}

/** A bubble at `c` of radius `r`: the circle, its level divider, `top` above it and `bottom` below. */
function bubble(into: ReturnType<typeof empty>, c: Pt, r: number, top: string, bottom: string): void {
  into.circles.push({ center: c, radius: r });
  into.lines.push([{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }]);
  const h = r * TEXT_SHARE;
  if (top) into.texts.push({ at: { x: c.x, y: c.y + r * 0.45 }, text: top, height: h, justify: "centre" });
  if (bottom) into.texts.push({ at: { x: c.x, y: c.y - r * 0.45 }, text: bottom, height: h, justify: "centre" });
}

/**
 * The arrow on a bubble at `c` of radius `r` pointing at `angle`: the outline from its point along
 * the lines touching the circle and round the circle's near side between them, so it fills only
 * what lies outside the bubble.
 */
export function bubbleArrow(c: Pt, r: number, angle: number): Pt[] {
  const reach = ARROW_REACH * r;
  const spread = Math.acos(r / reach);
  const pts: Pt[] = [add(c, dir(angle), reach)];
  for (let i = 0; i <= ARROW_STEPS; i++) pts.push(add(c, dir(angle - spread + (2 * spread * i) / ARROW_STEPS), r));
  return pts;
}

export type Look = "left" | "right";

/**
 * A section line from `a` to `b` with a bubble past each end, both arrows looking to the line's
 * left or right. Null when the line is shorter than a bubble.
 */
export function sectionMarker(a: Pt, b: Pt, look: Look, r: number, number: string, sheet: string): MarkerDrawing | null {
  const len = dist(a, b);
  if (!(r > 0) || len < 2 * r) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const along = Math.atan2(u.y, u.x);
  const angle = along + (look === "left" ? Math.PI / 2 : -Math.PI / 2);
  const d = empty();
  d.lines.push([a, b]);
  for (const c of [add(a, u, -r), add(b, u, r)]) {
    bubble(d, c, r, number, sheet);
    d.filled.push(bubbleArrow(c, r, angle));
  }
  return d;
}

export type SectionConfig = "section" | "partial" | "elevation";

export interface SectionLine {
  /** a bubble past each end, past its start only, or on its middle */
  readonly config: SectionConfig;
  readonly look: Look;
  /** a section's solid line kept at each end, the middle left out; null for the whole line */
  readonly gap: number | null;
}

/** Each corner's distance along `pts` from its start. */
function along(pts: readonly Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
  return out;
}

/** The point `s` along `pts` (with `at` their distances along) and the way its segment runs. */
function pointAlong(pts: readonly Pt[], at: readonly number[], s: number): { p: Pt; u: Pt } {
  let i = 1;
  while (i < pts.length - 1 && at[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const len = at[i] - at[i - 1];
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { p: add(a, u, s - at[i - 1]), u };
}

/** The part of `pts` from `s0` to `s1` along it. */
function subPath(pts: readonly Pt[], at: readonly number[], s0: number, s1: number): Pt[] {
  const out = [pointAlong(pts, at, s0).p];
  for (let i = 1; i < pts.length - 1; i++) if (at[i] > s0 && at[i] < s1) out.push(pts[i]);
  out.push(pointAlong(pts, at, s1).p);
  return out;
}

/**
 * A section-elevation line through `pts`: the line (a gapped section only `gap` of it at each end)
 * with a bubble of radius `r` past each end (a section), past its start (a partial section) or on
 * its middle, the line stopping at its circle (an elevation). Each arrow looks square to its own
 * segment, to the left or right of the way the line was drawn. Null when a bubble won't fit.
 */
export function sectionLine(pts: readonly Pt[], line: SectionLine, r: number, number: string, sheet: string): MarkerDrawing | null {
  const path = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0);
  if (!(r > 0) || path.length < 2) return null;
  const at = along(path);
  const total = at[at.length - 1];
  const side = line.look === "left" ? Math.PI / 2 : -Math.PI / 2;
  const look = (u: Pt): number => Math.atan2(u.y, u.x) + side;
  const d = empty();
  if (line.config === "elevation") {
    if (total < 2 * r) return null;
    const { p, u } = pointAlong(path, at, total / 2);
    d.lines.push(subPath(path, at, 0, total / 2 - r), subPath(path, at, total / 2 + r, total));
    bubble(d, p, r, number, sheet);
    d.filled.push(bubbleArrow(p, r, look(u)));
    return d;
  }
  if (line.gap !== null && line.gap > 0 && 2 * line.gap < total) d.lines.push(subPath(path, at, 0, line.gap), subPath(path, at, total - line.gap, total));
  else d.lines.push(path);
  const first = pointAlong(path, at, 0).u;
  const last = pointAlong(path, at, total).u;
  const ends = [{ c: add(path[0], first, -r), u: first }];
  if (line.config === "section") ends.push({ c: add(path[path.length - 1], last, r), u: last });
  for (const e of ends) {
    bubble(d, e.c, r, number, sheet);
    d.filled.push(bubbleArrow(e.c, r, look(e.u)));
  }
  return d;
}

/** An elevation's bubble at `c`, its arrow toward `to`. Null when `to` is on the bubble's centre. */
export function elevationMarker(c: Pt, to: Pt, r: number, number: string, sheet: string): MarkerDrawing | null {
  if (!(r > 0) || dist(c, to) === 0) return null;
  const d = empty();
  bubble(d, c, r, number, sheet);
  d.filled.push(bubbleArrow(c, r, Math.atan2(to.y - c.y, to.x - c.x)));
  return d;
}

/**
 * An interior elevation's mark at `c`, turned by `angle`: a circle with an arrow each way round, the
 * drawing number of each look inside the circle by its arrow, the sheet's at the centre.
 */
export function interiorElevation(c: Pt, angle: number, r: number, numbers: readonly string[], sheet: string): MarkerDrawing | null {
  if (!(r > 0)) return null;
  const d = empty();
  d.circles.push({ center: c, radius: r });
  for (let k = 0; k < 4; k++) {
    const a = angle + (k * Math.PI) / 2;
    d.filled.push(bubbleArrow(c, r, a));
    if (numbers[k]) d.texts.push({ at: add(c, dir(a), 0.62 * r), text: numbers[k], height: 0.35 * r, justify: "centre" });
  }
  if (sheet) d.texts.push({ at: c, text: sheet, height: 0.25 * r, justify: "centre" });
  return d;
}

/**
 * A detail's boundary, the circle round `centre` through `edge`, and its callout: a leader on from
 * the boundary in the same direction to a bubble. Null for a boundary smaller than the bubble.
 */
export function detailCallout(centre: Pt, edge: Pt, r: number, number: string, sheet: string): MarkerDrawing | null {
  const R = dist(centre, edge);
  if (!(r > 0) || R < r) return null;
  const d = detailLeader(edge, { x: (edge.x - centre.x) / R, y: (edge.y - centre.y) / R }, r, number, sheet);
  d.circles.unshift({ center: centre, radius: R });
  return d;
}

/**
 * A detail callout's leader alone, for a boundary already drawn: from `edge` on along the unit
 * direction `u` to a bubble of radius `r` (View > Create Detail Viewport's, round its crop).
 */
export function detailLeader(edge: Pt, u: Pt, r: number, number: string, sheet: string): ReturnType<typeof empty> {
  const d = empty();
  d.lines.push([edge, add(edge, u, 2 * r)]);
  bubble(d, add(edge, u, 3 * r), r, number, sheet);
  return d;
}

/**
 * A drawing label at `at`: the bubble, the title on a line running right from it (at least
 * `minLine` long, longer for a long title) and the scale under the line.
 */
export function drawingLabel(at: Pt, r: number, number: string, sheet: string, title: string, scale: string, minLine: number): MarkerDrawing | null {
  if (!(r > 0)) return null;
  const d = empty();
  bubble(d, at, r, number, sheet);
  const titleHeight = 0.7 * r;
  const scaleHeight = 0.4 * r;
  const gap = 0.4 * r;
  const x0 = at.x + r;
  const len = Math.max(minLine, 2 * gap + CHAR_WIDTH * Math.max(titleHeight * title.length, scaleHeight * scale.length));
  d.lines.push([{ x: x0, y: at.y }, { x: x0 + len, y: at.y }]);
  if (title) d.texts.push({ at: { x: x0 + gap, y: at.y + gap + titleHeight / 2 }, text: title, height: titleHeight, justify: "left" });
  if (scale) d.texts.push({ at: { x: x0 + gap, y: at.y - gap - scaleHeight / 2 }, text: scale, height: scaleHeight, justify: "left" });
  return d;
}

export type LeaderKind = "line" | "arc" | "bezier";

/** A reference marker's leader, in drawing units and radians. */
export interface ReferenceLeader {
  /** what the marker refers to, where the leader's arrow points */
  readonly target: Pt;
  readonly kind: LeaderKind;
  /** an arc leader's radius; one too small for the leader's span draws a half circle */
  readonly radius: number;
  /** the shoulder from where the leader meets it to the bubble */
  readonly shoulder: number;
  /** the shoulder's angle from level */
  readonly angle: number;
  /** which way the shoulder runs from the leader: 1 right, -1 left, 0 away from the target */
  readonly side: -1 | 0 | 1;
  readonly arrowLength: number;
  readonly arrowWidth: number;
}

/** points along a curved leader */
const LEADER_STEPS = 24;

/**
 * An arc of radius `radius` from `t` to `j`, curving the way that arrives at `j` nearest the
 * direction `u`.
 */
function arcLeader(t: Pt, j: Pt, radius: number, u: Pt): Pt[] {
  const len = dist(t, j);
  const r = Math.max(radius, len / 2);
  const m = { x: (t.x + j.x) / 2, y: (t.y + j.y) / 2 };
  const n = { x: -(j.y - t.y) / len, y: (j.x - t.x) / len };
  const h = Math.sqrt(Math.max(0, r * r - (len / 2) ** 2));
  let best: Pt[] = [t, j];
  let score = -Infinity;
  for (const side of [1, -1]) {
    const c = add(m, n, side * h);
    const a0 = Math.atan2(t.y - c.y, t.x - c.x);
    let sweep = Math.atan2(j.y - c.y, j.x - c.x) - a0;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const end = a0 + sweep;
    // the way the arc runs at `j`: along its tangent, turning as it sweeps
    const tangent = { x: -Math.sin(end) * Math.sign(sweep), y: Math.cos(end) * Math.sign(sweep) };
    const s = tangent.x * u.x + tangent.y * u.y;
    if (s > score) {
      score = s;
      best = Array.from({ length: LEADER_STEPS + 1 }, (_, i) => add(c, dir(a0 + (sweep * i) / LEADER_STEPS), r));
    }
  }
  return best;
}

/** A curve from `t` to `j` that runs into `j` along `u`, as a Bézier leader eases into its shoulder. */
function bezierLeader(t: Pt, j: Pt, u: Pt): Pt[] {
  const k = add(j, u, -dist(t, j) / 2);
  return Array.from({ length: LEADER_STEPS + 1 }, (_, i) => {
    const s = i / LEADER_STEPS;
    const a = (1 - s) * (1 - s);
    const b = 2 * (1 - s) * s;
    const c = s * s;
    return { x: a * t.x + b * k.x + c * j.x, y: a * t.y + b * k.y + c * j.y };
  });
}

/**
 * A reference marker: the bubble at `c` with the referenced drawing's number above and its sheet's
 * below, the note under it, an arrow on the bubble pointing at `arrow` (radians) if asked, and a
 * leader if asked: from an arrowhead at the target, straight, as an arc or as a curve, to a shoulder
 * that runs on to the bubble's edge. Null when the target lies inside the bubble and shoulder.
 */
export function referenceMarker(c: Pt, r: number, number: string, sheet: string, note: string, arrow: number | null, leader: ReferenceLeader | null): MarkerDrawing | null {
  if (!(r > 0)) return null;
  const d = empty();
  bubble(d, c, r, number, sheet);
  if (arrow !== null) d.filled.push(bubbleArrow(c, r, arrow));
  if (note) {
    const h = 0.8 * r * TEXT_SHARE;
    d.texts.push({ at: { x: c.x, y: c.y - r - (arrow === null ? 0.4 * r : (ARROW_REACH - 1) * r) - h / 2 }, text: note, height: h, justify: "centre" });
  }
  if (!leader) return d;
  const { target } = leader;
  const side = leader.side || (c.x >= target.x ? 1 : -1);
  const u = { x: side * Math.cos(leader.angle), y: side * Math.sin(leader.angle) };
  const edge = add(c, u, -r);
  const join = add(edge, u, -Math.max(0, leader.shoulder));
  if (dist(target, join) <= 0 || dist(target, c) <= r + Math.max(0, leader.shoulder)) return null;
  if (leader.shoulder > 0) d.lines.push([join, edge]);
  const path = leader.kind === "arc" ? arcLeader(target, join, leader.radius, u) : leader.kind === "bezier" ? bezierLeader(target, join, u) : [target, join];
  d.lines.push(path);
  // the arrowhead lies along the leader's first stretch, back from the target
  const back = path.find((p) => dist(p, target) >= leader.arrowLength) ?? path[path.length - 1];
  const a = { x: (back.x - target.x) / dist(back, target), y: (back.y - target.y) / dist(back, target) };
  const n = { x: -a.y, y: a.x };
  const base = add(target, a, leader.arrowLength);
  d.filled.push([target, add(base, n, leader.arrowWidth / 2), add(base, n, -leader.arrowWidth / 2)]);
  return d;
}

/** quarter-circle steps for a benchmark's filled quarters */
const QUARTER_STEPS = 8;

/**
 * An elevation benchmark at `at`: a circle quartered with two opposite quarters filled, a leader
 * running right to a shoulder, the elevation over it and the label under it.
 */
export function elevationBenchmark(at: Pt, r: number, value: string, label: string): MarkerDrawing | null {
  if (!(r > 0)) return null;
  const d = empty();
  d.circles.push({ center: at, radius: r });
  d.lines.push([{ x: at.x - r, y: at.y }, { x: at.x + 8 * r, y: at.y }], [{ x: at.x, y: at.y - r }, { x: at.x, y: at.y + r }]);
  for (const from of [0, Math.PI]) {
    const quarter: Pt[] = [at];
    for (let i = 0; i <= QUARTER_STEPS; i++) quarter.push(add(at, dir(from + (Math.PI / 2) * (i / QUARTER_STEPS)), r));
    d.filled.push(quarter);
  }
  const h = 1.2 * r;
  if (value) d.texts.push({ at: { x: at.x + 1.6 * r, y: at.y + 0.5 * r + h / 2 }, text: value, height: h, justify: "left" });
  if (label) d.texts.push({ at: { x: at.x + 1.6 * r, y: at.y - 0.5 * r - h / 2 }, text: label, height: 0.8 * h, justify: "left" });
  return d;
}

/**
 * A north arrow at `c`, its circle `r` across the middle and its needle pointing at `north`
 * (radians): the needle a diamond with its right half filled, and an upright N past its point.
 */
export function northArrow(c: Pt, north: number, r: number): MarkerDrawing | null {
  if (!(r > 0)) return null;
  const d = empty();
  const u = dir(north);
  const n = { x: -u.y, y: u.x };
  const tip = add(c, u, 0.9 * r);
  const tail = add(c, u, -0.9 * r);
  const left = add(c, n, 0.28 * r);
  const right = add(c, n, -0.28 * r);
  d.circles.push({ center: c, radius: r });
  d.outlines.push([tip, left, tail, right]);
  d.filled.push([tip, tail, right]);
  d.texts.push({ at: add(c, u, 1.45 * r), text: "N", height: 0.5 * r, justify: "centre" });
  return d;
}

/** Round lengths a scale bar's segments take, in mm: metric, and feet and inches. */
const METRIC_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000];
const IMPERIAL_STEPS = [25.4, 50.8, 76.2, 152.4, 304.8, 609.6, 1524, 3048, 6096, 7620, 15240, 30480, 60960, 152400, 304800];

/** The shortest round segment length (mm) at least `least` long; the longest when none is. */
export function scaleBarStep(least: number, imperial: boolean): number {
  const steps = imperial ? IMPERIAL_STEPS : METRIC_STEPS;
  return steps.find((s) => s >= least) ?? steps[steps.length - 1];
}

/**
 * A scale bar from `at` running right: `labels.length - 1` segments `step` long and `height` high,
 * every other one filled, a label over each division.
 */
export function scaleBar(at: Pt, step: number, height: number, labels: readonly string[]): MarkerDrawing | null {
  const count = labels.length - 1;
  if (!(step > 0) || !(height > 0) || count < 1) return null;
  const d = empty();
  for (let k = 0; k < count; k++) {
    const x0 = at.x + k * step;
    const seg = [{ x: x0, y: at.y }, { x: x0 + step, y: at.y }, { x: x0 + step, y: at.y + height }, { x: x0, y: at.y + height }];
    (k % 2 === 0 ? d.filled : d.outlines).push(seg);
  }
  const h = height;
  labels.forEach((text, k) => d.texts.push({ at: { x: at.x + k * step, y: at.y + height + 0.9 * h }, text, height: h, justify: "centre" }));
  return d;
}

/**
 * A data tag: the leader from `from` (on the object) to the tag's box, centred on `at`, round its
 * text `height` high. Null when the box would cover the point.
 */
export function dataTag(from: Pt, at: Pt, text: string, height: number): MarkerDrawing | null {
  if (!(height > 0) || !text) return null;
  const pad = 0.4 * height;
  const w = CHAR_WIDTH * height * text.length + 2 * pad;
  const hh = height + 2 * pad;
  const dx = from.x - at.x;
  const dy = from.y - at.y;
  // where the line toward the point leaves the box
  const t = Math.min(dx !== 0 ? w / 2 / Math.abs(dx) : Infinity, dy !== 0 ? hh / 2 / Math.abs(dy) : Infinity);
  if (!(t < 1)) return null;
  const d = empty();
  d.outlines.push([
    { x: at.x - w / 2, y: at.y - hh / 2 },
    { x: at.x + w / 2, y: at.y - hh / 2 },
    { x: at.x + w / 2, y: at.y + hh / 2 },
    { x: at.x - w / 2, y: at.y + hh / 2 },
  ]);
  d.lines.push([from, { x: at.x + dx * t, y: at.y + dy * t }]);
  d.texts.push({ at, text, height, justify: "centre" });
  return d;
}

/** A legend's rows from `at` down: the title, then per entry a swatch `size` high (1.6 × as wide) and its name beside it. */
export function legendLayout(at: Pt, title: string, names: readonly string[], size: number): { swatches: Pt[][]; texts: MarkerText[] } {
  const pitch = 1.6 * size;
  const texts: MarkerText[] = [];
  if (title) texts.push({ at: { x: at.x, y: at.y - size / 2 }, text: title, height: 0.9 * size, justify: "left" });
  const swatches: Pt[][] = [];
  names.forEach((name, i) => {
    const top = at.y - (title ? 1.5 * size : 0) - i * pitch;
    const w = 1.6 * size;
    swatches.push([{ x: at.x, y: top - size }, { x: at.x + w, y: top - size }, { x: at.x + w, y: top }, { x: at.x, y: top }]);
    texts.push({ at: { x: at.x + w + 0.6 * size, y: top - size / 2 }, text: name, height: 0.7 * size, justify: "left" });
  });
  return { swatches, texts };
}

/**
 * A symmetry label (ISO 128): the axis from `a` to `b`, crossed near each end by two short bars
 * `bar` long, a quarter of that apart, the outer one half its length in from the end. Null when the
 * axis is too short to keep its bars apart.
 */
export function symmetryLabel(a: Pt, b: Pt, bar: number): Pt[][] | null {
  const len = dist(a, b);
  const gap = bar / 4;
  const inset = bar / 2;
  if (!(bar > 0 && len > 2 * (inset + gap) + gap)) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const cross = (s: number): Pt[] => {
    const c = { x: a.x + u.x * s, y: a.y + u.y * s };
    return [
      { x: c.x + (u.y * bar) / 2, y: c.y - (u.x * bar) / 2 },
      { x: c.x - (u.y * bar) / 2, y: c.y + (u.x * bar) / 2 },
    ];
  };
  return [[a, b], cross(inset), cross(inset + gap), cross(len - inset - gap), cross(len - inset)];
}

/**
 * A centre mark: two lines crossing at `centre`, one along `u` (a unit vector) and one square to
 * it, each reaching its half-size either side and `beyond` further.
 */
export function centreMark(centre: Pt, u: Pt, halfU: number, halfV: number, beyond: number): Pt[][] {
  const along = (d: Pt, half: number): Pt[] => [
    { x: centre.x - d.x * (half + beyond), y: centre.y - d.y * (half + beyond) },
    { x: centre.x + d.x * (half + beyond), y: centre.y + d.y * (half + beyond) },
  ];
  return [along(u, halfU), along({ x: -u.y, y: u.x }, halfV)];
}

/** How a slope dimension shows its slope: a rise-over-run triangle, a ratio, a percentage or an angle. */
export type SlopeStyle = "riserun" | "ratio" | "percent" | "degrees";

/** The slope a slope dimension shows: rise over run, its sides labelled; or a value along the line. */
export interface SlopeSizes {
  readonly style: SlopeStyle;
  /** Rise over Run: the run its triangle is labelled with (12 gives 6 for a half pitch); Ratio: the rise it starts with */
  readonly base: number;
  /** Rise over Run: the triangle's level side, world units */
  readonly run: number;
  /** the labels' height, world units */
  readonly text: number;
}

/** A label's number: at most two decimal places, without trailing zeros. */
function slopeNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * A slope dimension of the line from `a` to `b`, its slope taken against the drawing's level.
 * Rise over Run: a right triangle over the line's middle, its slanted side on the line, its level
 * side `run` long toward where the line falls and labelled with the base above, its upright side
 * labelled with the rise beside it (the base times the slope). The others: the value along the
 * line, over its middle: Ratio as base:run ("1:2"), Percent as a percentage, Degrees as an angle.
 * Null for an upright line (no run), a level one in Ratio (no rise), or one with no length.
 */
export function slopeDimension(a: Pt, b: Pt, s: SlopeSizes): MarkerDrawing | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || !(s.text > 0) || Math.abs(dx) <= len * 1e-9) return null;
  const slope = Math.abs(dy / dx);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const gap = s.text / 2;
  const empty = { outlines: [], circles: [], filled: [] };
  if (s.style === "riserun") {
    if (!(s.run > 0 && s.base > 0)) return null;
    // the level side runs toward the line's fall, so the triangle sits over the line
    const fall = dy / dx > 0 ? -1 : 1;
    const start = { x: mid.x - (fall * s.run) / 2, y: mid.y + (slope * s.run) / 2 };
    const elbow = { x: start.x + fall * s.run, y: start.y };
    const foot = { x: elbow.x, y: start.y - slope * s.run };
    return {
      ...empty,
      lines: [[start, elbow, foot, start]],
      texts: [
        { at: { x: mid.x, y: start.y + gap + s.text / 2 }, text: slopeNumber(s.base), height: s.text, justify: "centre" },
        {
          at: { x: elbow.x + fall * gap, y: (elbow.y + foot.y) / 2 },
          text: slopeNumber(s.base * slope),
          height: s.text,
          justify: fall > 0 ? "left" : "right",
        },
      ],
    };
  }
  let value: string;
  if (s.style === "ratio") {
    if (!(slope > 0) || !(s.base > 0)) return null;
    value = `${slopeNumber(s.base)}:${slopeNumber(s.base / slope)}`;
  } else if (s.style === "percent") {
    value = `${(slope * 100).toFixed(1)}%`;
  } else {
    value = `${((Math.atan(slope) * 180) / Math.PI).toFixed(1)}°`;
  }
  // read left to right, set just over the line
  const angle = (Math.atan(dy / dx) * 180) / Math.PI;
  const rad = (angle * Math.PI) / 180;
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const off = gap + s.text / 2;
  return { ...empty, lines: [], texts: [{ at: { x: mid.x + up.x * off, y: mid.y + up.y * off }, text: value, height: s.text, justify: "centre", angle }] };
}
