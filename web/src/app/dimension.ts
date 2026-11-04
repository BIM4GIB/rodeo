// Dimension layout: the geometry of dimensions as plain points. Pure: no session or
// canvas access, so the tool's preview and the objects it creates come from the same
// numbers. Sizes given in paper millimetres are multiplied by the layer scale, because
// world units are millimetres at full size. The second half holds the measurements
// Object Info shows (length, area, perimeter, arc length), which are plain maths too.

import type { Pt, Shape } from "../core/index.ts";
import { degToRad, dist, intersectLines, signedArea, unitVector, type LineSeg } from "./geom.ts";
import { formatLength, unitLabel } from "./units.ts";

/** clearance between a measured point and its extension line, paper mm */
export const EXTENSION_GAP_MM = 1;
/** how far an extension line runs past the dimension line, paper mm */
export const EXTENSION_OVERSHOOT_MM = 1.5;
/** clearance between the dimension line and the value text, paper mm */
export const TEXT_GAP_MM = 1;
/** whole length of an architectural tick (a 45-degree slash), paper mm */
export const TICK_MM = 2;
/** height of the value text, paper mm */
export const DIMENSION_TEXT_MM = 2.5;
/** how far a radius leader runs past the circle it measures, paper mm */
const LEADER_OVERSHOOT_MM = 1.5;
/** average width of a character of the value text, as a share of its height */
const CHAR_WIDTH = 0.6;

const MIN_WORLD = 1e-9;
const TAU = 2 * Math.PI;

export type DimensionAxis = "horizontal" | "vertical" | "aligned";

export interface DimensionLayout {
  readonly axis: DimensionAxis;
  /** measured length, in world units */
  readonly length: number;
  /** extension lines: each runs from a gap off a measured point to past the dimension line */
  readonly extensions: readonly LineSeg[];
  /** the dimension line between the two extension lines; null when it has no length */
  readonly line: LineSeg | null;
  /** architectural ticks: a 45-degree slash centred on each end of the dimension line */
  readonly ticks: readonly LineSeg[];
  /** the value text: its origin (bottom baseline, centred) and the angle it is turned to */
  readonly text: { readonly at: Pt; readonly angle: number; readonly height: number };
  /** the points it measures, and the way its line runs */
  readonly measured: readonly [Pt, Pt];
  readonly u: Pt;
}

/** A circle or circular arc: its centre and radius in world units. */
export interface CircleGeom {
  readonly centre: Pt;
  readonly radius: number;
}

/** An arc to draw around `centre`; angles in degrees, counter-clockwise from +x, sweep positive. */
export interface DimensionArc {
  readonly centre: Pt;
  readonly radius: number;
  readonly startAngle: number;
  readonly sweepAngle: number;
}

/** The value text: what it says, its bottom baseline centre (`at`), the angle it is turned to, and its height. */
export interface DimensionText {
  readonly value: string;
  readonly at: Pt;
  readonly angle: number;
  readonly height: number;
}

/** A dimension of any kind as plain pieces: lines (extension lines, dimension lines, leaders, ticks), arcs and the value. */
export interface DimensionDrawing {
  readonly lines: readonly LineSeg[];
  readonly arcs: readonly DimensionArc[];
  readonly text: DimensionText;
  /** a linear one's measured points, a point on its line and the way the line runs: what a dimension object keeps; and its kind */
  readonly linear?: { readonly a: Pt; readonly b: Pt; readonly at: Pt; readonly u: Pt; readonly axis?: DimensionAxis };
}

/**
 * Which way a constrained dimension runs for the cursor. Horizontal when the
 * cursor lies further out above or below the two points than beside them,
 * vertical when further out beside them. Level on both, the cursor's offset from
 * the middle of the points, relative to their half-size, decides.
 */
export function constrainedAxis(a: Pt, b: Pt, cursor: Pt): "horizontal" | "vertical" {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  // how far the cursor lies outside the box of the points on each axis (0 inside it)
  const outX = cursor.x < x0 ? x0 - cursor.x : cursor.x > x1 ? cursor.x - x1 : 0;
  const outY = cursor.y < y0 ? y0 - cursor.y : cursor.y > y1 ? cursor.y - y1 : 0;
  if (outX !== outY) return outY > outX ? "horizontal" : "vertical";
  const rx = Math.abs(cursor.x - (x0 + x1) / 2) / Math.max((x1 - x0) / 2, MIN_WORLD);
  const ry = Math.abs(cursor.y - (y0 + y1) / 2) / Math.max((y1 - y0) / 2, MIN_WORLD);
  return ry >= rx ? "horizontal" : "vertical";
}

/**
 * Layout of the dimension between the measured points `a` and `b` with the
 * dimension line placed through `cursor`. `aligned` makes it parallel to the
 * points; otherwise it is horizontal or vertical (see constrainedAxis). `scale`
 * is the layer scale (world units per paper mm). Null when the points coincide.
 */
export function dimensionLayout(a: Pt, b: Pt, cursor: Pt, aligned: boolean, scale: number): DimensionLayout | null {
  const frame = dimensionFrame(a, b, cursor, aligned);
  return frame ? frameLayout(a, b, cursor, frame, scale) : null;
}

/** Which way a dimension runs: its kind and the unit direction along its line. */
export interface DimensionFrame {
  readonly axis: DimensionAxis;
  readonly u: Pt;
}

/** The frame dimensionLayout gives the points `a` and `b` for `cursor`; null when the points coincide. */
export function dimensionFrame(a: Pt, b: Pt, cursor: Pt, aligned: boolean): DimensionFrame | null {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(span > MIN_WORLD)) return null;
  if (aligned) return { axis: "aligned", u: { x: (b.x - a.x) / span, y: (b.y - a.y) / span } };
  return constrainedAxis(a, b, cursor) === "horizontal" ? { axis: "horizontal", u: { x: 1, y: 0 } } : { axis: "vertical", u: { x: 0, y: 1 } };
}

/** The way a frame's dimension line is offset from the points it measures. */
export function normalOf(frame: DimensionFrame): Pt {
  return frame.axis === "vertical" ? { x: 1, y: 0 } : { x: -frame.u.y, y: frame.u.x };
}

/**
 * Layout of the dimension between `a` and `b` along `frame`, its line placed through `cursor`: what
 * dimensionLayout makes, and what a chain or baseline dimension makes with its first one's frame.
 */
export function frameLayout(a: Pt, b: Pt, cursor: Pt, frame: DimensionFrame, scale: number): DimensionLayout | null {
  if (!(scale > 0)) return null;
  const { axis, u } = frame;
  const n = normalOf(frame);

  const gap = EXTENSION_GAP_MM * scale;
  const overshoot = EXTENSION_OVERSHOOT_MM * scale;
  const extensions: LineSeg[] = [];
  const feet: Pt[] = [];
  for (const p of [a, b]) {
    // signed distance from the point to the dimension line, along n
    const off = (cursor.x - p.x) * n.x + (cursor.y - p.y) * n.y;
    const foot = { x: p.x + n.x * off, y: p.y + n.y * off };
    feet.push(foot);
    // a point already on the dimension line, or within the gap of it, gets no extension line
    if (Math.abs(off) > gap) {
      const s = off < 0 ? -1 : 1;
      extensions.push({
        a: { x: p.x + n.x * s * gap, y: p.y + n.y * s * gap },
        b: { x: foot.x + n.x * s * overshoot, y: foot.y + n.y * s * overshoot },
      });
    }
  }
  const [f1, f2] = feet;
  const length = Math.abs((b.x - a.x) * u.x + (b.y - a.y) * u.y);

  const line = length > MIN_WORLD ? { a: f1, b: f2 } : null;

  // ticks are 45 degrees to the dimension line: u and n together make that direction
  const half = (TICK_MM / 2) * scale;
  const t = { x: (u.x + n.x) / Math.SQRT2, y: (u.y + n.y) / Math.SQRT2 };
  const ticks = [f1, f2].map((f) => ({
    a: { x: f.x - t.x * half, y: f.y - t.y * half },
    b: { x: f.x + t.x * half, y: f.y + t.y * half },
  }));

  // the text reads along the line, and sits on the side its own up direction points to
  const angle = readableDeg(u);
  const rad = (angle * Math.PI) / 180;
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const mid = { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 };
  const textGap = TEXT_GAP_MM * scale;
  return {
    axis,
    length,
    extensions,
    line,
    ticks,
    text: {
      at: { x: mid.x + up.x * textGap, y: mid.y + up.y * textGap },
      angle,
      height: DIMENSION_TEXT_MM * scale,
    },
    measured: [a, b],
    u,
  };
}

/** Angle of a direction in degrees, turned into (-90, 90] so text along it reads left to right. */
function readableDeg(u: Pt): number {
  let deg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg <= -90) deg += 180;
  return deg;
}

/** The turn a text reads along direction `u` at, and the up direction it sits on. */
function readable(u: Pt): { angle: number; up: Pt } {
  const angle = readableDeg(u);
  const rad = (angle * Math.PI) / 180;
  return { angle, up: { x: -Math.sin(rad), y: Math.cos(rad) } };
}

/**
 * The value a dimension shows, from a length in world millimetres: whole millimetres with no unit
 * for a millimetre document (the default, as Vectorworks writes them), otherwise the length in the
 * document's units, as 12'-0" in a feet document.
 */
export function dimensionValue(length: number, units?: string): string {
  if (unitLabel(units) === "mm") return String(Math.round(length));
  return formatLength(length, units);
}

/** The pieces of a linear dimension, in the order they are made: extension lines, dimension line, ticks. */
export function linearDrawing(layout: DimensionLayout, value: string): DimensionDrawing {
  const lines: LineSeg[] = [...layout.extensions];
  if (layout.line) lines.push(layout.line);
  lines.push(...layout.ticks);
  const [a, b] = layout.measured;
  return {
    lines,
    arcs: [],
    text: { value, at: layout.text.at, angle: layout.text.angle, height: layout.text.height },
    ...(layout.line ? { linear: { a, b, at: layout.line.a, u: layout.u, axis: layout.axis } } : {}),
  };
}

/** Spacing between the lines of a baseline dimension's stack, paper mm. */
export const BASELINE_STEP_MM = 7;

/**
 * A chain (each point to the next, every line through `cursor`) or a baseline (the first point to
 * each of the others, their lines stacked outwards from `cursor` by BASELINE_STEP_MM): one layout
 * per measured span, all along `frame`.
 */
export function seriesLayouts(
  points: readonly Pt[],
  kind: "chain" | "baseline",
  cursor: Pt,
  frame: DimensionFrame,
  scale: number,
): DimensionLayout[] {
  const out: DimensionLayout[] = [];
  const first = points[0];
  if (!first) return out;
  const n = normalOf(frame);
  // a baseline stacks away from the points, on the side of them the cursor is
  const side = (cursor.x - first.x) * n.x + (cursor.y - first.y) * n.y < 0 ? -1 : 1;
  const step = BASELINE_STEP_MM * scale * side;
  for (let i = 1; i < points.length; i++) {
    const chain = kind === "chain";
    const at = chain ? cursor : { x: cursor.x + n.x * step * (i - 1), y: cursor.y + n.y * step * (i - 1) };
    const layout = frameLayout(chain ? points[i - 1] : first, points[i], at, frame, scale);
    if (layout) out.push(layout);
  }
  return out;
}

/**
 * Which way an ordinate dimension measures from its datum: dragged further up or down than across,
 * its extension lines stand upright and it measures across (horizontal); otherwise it measures up.
 */
export function ordinateFrame(origin: Pt, cursor: Pt): DimensionFrame {
  return Math.abs(cursor.y - origin.y) >= Math.abs(cursor.x - origin.x)
    ? { axis: "horizontal", u: { x: 1, y: 0 } }
    : { axis: "vertical", u: { x: 0, y: 1 } };
}

/** How far `p` lies from the datum `origin` along an ordinate frame. */
export function ordinateLength(origin: Pt, p: Pt, frame: DimensionFrame): number {
  return Math.abs((p.x - origin.x) * frame.u.x + (p.y - origin.y) * frame.u.y);
}

/**
 * An ordinate: an extension line from `p` across the frame to the line through `cursor`, and the
 * value (`value`) reading along it just past its end.
 */
export function ordinateDrawing(p: Pt, cursor: Pt, frame: DimensionFrame, scale: number, value: string): DimensionDrawing {
  const n = normalOf(frame);
  const off = (cursor.x - p.x) * n.x + (cursor.y - p.y) * n.y;
  const s = off < 0 ? -1 : 1;
  const gap = EXTENSION_GAP_MM * scale;
  const foot = { x: p.x + n.x * off, y: p.y + n.y * off };
  const lines: LineSeg[] = Math.abs(off) > gap ? [{ a: { x: p.x + n.x * s * gap, y: p.y + n.y * s * gap }, b: foot }] : [];
  const height = DIMENSION_TEXT_MM * scale;
  const { angle, up } = readable(n);
  const reach = TEXT_GAP_MM * scale + textWidth(value, height) / 2;
  // the text's middle on the extension line: its baseline sits about a third of its height below
  const drop = height * 0.35;
  const at = { x: foot.x + n.x * s * reach - up.x * drop, y: foot.y + n.y * s * reach - up.y * drop };
  return { lines, arcs: [], text: { value, at, angle, height } };
}

/**
 * Lines with any that another covers left out: a chain's shared extension lines, and a baseline's
 * extension lines at its first point, which each longer one runs along.
 */
export function withoutCovered(lines: readonly LineSeg[]): LineSeg[] {
  const covers = (big: LineSeg, small: LineSeg): boolean => {
    const len = dist(big.a, big.b);
    if (!(len > MIN_WORLD)) return false;
    const ux = (big.b.x - big.a.x) / len;
    const uy = (big.b.y - big.a.y) / len;
    const tol = len * 1e-9 + 1e-6;
    return [small.a, small.b].every((q) => {
      const along = (q.x - big.a.x) * ux + (q.y - big.a.y) * uy;
      const across = (q.x - big.a.x) * -uy + (q.y - big.a.y) * ux;
      return Math.abs(across) <= tol && along >= -tol && along <= len + tol;
    });
  };
  // of two equal lines the first stays
  return lines.filter((l, i) => !lines.some((o, j) => j !== i && covers(o, l) && !(covers(l, o) && j > i)));
}

/** An architectural tick: a slash 45 degrees to a line running along `u`, centred on `p`. */
function tickAt(p: Pt, u: Pt, scale: number): LineSeg {
  const half = (TICK_MM / 2) * scale;
  // u plus u turned by a right angle points 45 degrees off the line
  const t = { x: (u.x - u.y) / Math.SQRT2, y: (u.y + u.x) / Math.SQRT2 };
  return {
    a: { x: p.x - t.x * half, y: p.y - t.y * half },
    b: { x: p.x + t.x * half, y: p.y + t.y * half },
  };
}

/** Rough width of a value text, to set it clear of the end of a leader. */
function textWidth(value: string, height: number): number {
  return [...value].length * height * CHAR_WIDTH;
}

/** Unit vector of `v`, or null when it has no length. */
function direction(v: Pt): Pt | null {
  const len = Math.hypot(v.x, v.y);
  return len > MIN_WORLD ? { x: v.x / len, y: v.y / len } : null;
}

/**
 * Radius: a leader from the centre of `circle` through the direction of `cursor`,
 * to just past the circle when the cursor lies inside it or to the cursor when it
 * lies outside, with an architectural tick where it meets the circle. The value
 * text (`value`, e.g. "R50") sits beyond the end of the leader. Null when the cursor
 * is at the centre.
 */
export function radialLayout(circle: CircleGeom, cursor: Pt, scale: number, value: string): DimensionDrawing | null {
  const c = circle.centre;
  const r = circle.radius;
  if (!(r > MIN_WORLD) || !(scale > 0)) return null;
  const u = direction({ x: cursor.x - c.x, y: cursor.y - c.y });
  if (!u) return null;
  // outside the circle the leader ends on the cursor; inside, it runs just past the circle
  const reach = dist(cursor, c) > r ? dist(cursor, c) : r + LEADER_OVERSHOOT_MM * scale;
  const end = { x: c.x + u.x * reach, y: c.y + u.y * reach };
  const onCircle = { x: c.x + u.x * r, y: c.y + u.y * r };
  const { angle, up } = readable(u);
  const gap = TEXT_GAP_MM * scale;
  // the text is centred beyond the end, its bottom a gap above the leader
  const along = gap + textWidth(value, DIMENSION_TEXT_MM * scale) / 2;
  return {
    lines: [{ a: c, b: end }, tickAt(onCircle, u, scale)],
    arcs: [],
    text: {
      value,
      at: { x: end.x + u.x * along + up.x * gap, y: end.y + u.y * along + up.y * gap },
      angle,
      height: DIMENSION_TEXT_MM * scale,
    },
  };
}

/**
 * Diameter: a line across the whole circle through its centre, in the direction of
 * `cursor`, with an architectural tick at each end. The value text (`value`, e.g.
 * "⌀100") sits on the line at the centre, as a linear dimension's does at its middle.
 * Null when the cursor is at the centre.
 */
export function diameterLayout(circle: CircleGeom, cursor: Pt, scale: number, value: string): DimensionDrawing | null {
  const c = circle.centre;
  const r = circle.radius;
  if (!(r > MIN_WORLD) || !(scale > 0)) return null;
  const u = direction({ x: cursor.x - c.x, y: cursor.y - c.y });
  if (!u) return null;
  const a = { x: c.x - u.x * r, y: c.y - u.y * r };
  const b = { x: c.x + u.x * r, y: c.y + u.y * r };
  const { angle, up } = readable(u);
  const gap = TEXT_GAP_MM * scale;
  return {
    lines: [{ a, b }, tickAt(a, u, scale), tickAt(b, u, scale)],
    arcs: [],
    text: { value, at: { x: c.x + up.x * gap, y: c.y + up.y * gap }, angle, height: DIMENSION_TEXT_MM * scale },
  };
}

/** One of the four rays from where two lines meet: its unit direction, its angle in [0, 2 pi), and the line it lies on. */
interface Ray {
  readonly dir: Pt;
  readonly angle: number;
  readonly seg: LineSeg;
}

/** Angle in [0, 2 pi). */
function turned(rad: number): number {
  return ((rad % TAU) + TAU) % TAU;
}

function rayOf(dir: Pt, seg: LineSeg): Ray {
  return { dir, angle: turned(Math.atan2(dir.y, dir.x)), seg };
}

/**
 * Extension line for one arm of an angle, from the end of `seg` nearest the arc
 * point at `radius` along `dir` from `o`, out past that point. Null when the
 * segment reaches the arc, so nothing needs connecting.
 */
function armExtension(o: Pt, dir: Pt, seg: LineSeg, radius: number, gap: number, over: number): LineSeg | null {
  const ta = (seg.a.x - o.x) * dir.x + (seg.a.y - o.y) * dir.y;
  const tb = (seg.b.x - o.x) * dir.x + (seg.b.y - o.y) * dir.y;
  const lo = Math.min(ta, tb);
  const hi = Math.max(ta, tb);
  let from: number;
  let to: number;
  if (radius > hi + MIN_WORLD) {
    // the arc lies beyond the far end: run from that end (a gap off it) past the arc
    from = Math.min(hi + gap, radius);
    to = radius + over;
  } else if (radius < lo - MIN_WORLD) {
    from = Math.max(lo - gap, radius);
    to = radius - over;
  } else {
    return null;
  }
  return {
    a: { x: o.x + dir.x * from, y: o.y + dir.y * from },
    b: { x: o.x + dir.x * to, y: o.y + dir.y * to },
  };
}

/**
 * Angle between two straight lines: an arc centred where their lines meet, through
 * `cursor`, spanning the sector between the lines that holds the cursor. Each arm
 * gets an extension line from its end nearest the arc when the arc lies beyond that
 * end, the arc has an architectural tick at each end, and its angle (one decimal,
 * in degrees) sits at its middle, turned to read along it. Null when the lines are
 * parallel or the cursor is at their meeting point.
 */
export function angularLayout(l1: LineSeg, l2: LineSeg, cursor: Pt, scale: number): DimensionDrawing | null {
  if (!(scale > 0)) return null;
  const u1 = unitVector(l1.a, l1.b);
  const u2 = unitVector(l2.a, l2.b);
  const o = intersectLines(l1.a, u1, l2.a, u2);
  if (!o) return null;
  const radius = dist(cursor, o);
  if (!(radius > MIN_WORLD)) return null;

  // each line is two rays from where the lines meet; the four, in counter-clockwise order
  const rays = [rayOf(u1, l1), rayOf({ x: -u1.x, y: -u1.y }, l1), rayOf(u2, l2), rayOf({ x: -u2.x, y: -u2.y }, l2)].sort(
    (p, q) => p.angle - q.angle,
  );
  // the sector holding the cursor runs counter-clockwise from one ray to the next, under a half turn
  const psi = turned(Math.atan2(cursor.y - o.y, cursor.x - o.x));
  let start: Ray | null = null;
  let end: Ray | null = null;
  let sweep = 0;
  for (let i = 0; i < rays.length && !start; i++) {
    const from = rays[i];
    const to = rays[(i + 1) % rays.length];
    const span = turned(to.angle - from.angle);
    if (turned(psi - from.angle) <= span) {
      start = from;
      end = to;
      sweep = span;
    }
  }
  if (!start || !end) return null;

  const gap = EXTENSION_GAP_MM * scale;
  const over = EXTENSION_OVERSHOOT_MM * scale;
  const lines: LineSeg[] = [];
  for (const r of [start, end]) {
    const ext = armExtension(o, r.dir, r.seg, radius, gap, over);
    if (ext) lines.push(ext);
  }
  const arc = angleArc(o, radius, start.angle, sweep, scale);
  return { ...arc, lines: [...lines, ...arc.lines] };
}

/**
 * The arc of an angular dimension and what sits on it: the arc of `radius` about `o` from `start`
 * counter-clockwise through `sweep` (radians, under a whole turn), an architectural tick at each
 * end and the angle at its middle, turned to read along it.
 */
export function angleArc(o: Pt, radius: number, start: number, sweep: number, scale: number): DimensionDrawing {
  // ticks sit where the arc meets each arm, slanted 45 degrees to the arc's tangent
  const lines = [start, start + sweep].map((t) => {
    const dir = { x: Math.cos(t), y: Math.sin(t) };
    return tickAt({ x: o.x + dir.x * radius, y: o.y + dir.y * radius }, { x: -dir.y, y: dir.x }, scale);
  });
  const mid = start + sweep / 2;
  const radial = { x: Math.cos(mid), y: Math.sin(mid) };
  const middle = { x: o.x + radial.x * radius, y: o.y + radial.y * radius };
  const { angle, up } = readable({ x: -radial.y, y: radial.x });
  const textGap = TEXT_GAP_MM * scale;
  return {
    lines,
    arcs: [
      {
        centre: o,
        radius,
        startAngle: (start * 180) / Math.PI,
        sweepAngle: (sweep * 180) / Math.PI,
      },
    ],
    text: {
      value: angleValue((sweep * 180) / Math.PI),
      at: { x: middle.x + up.x * textGap, y: middle.y + up.y * textGap },
      angle,
      height: DIMENSION_TEXT_MM * scale,
    },
  };
}

/** Which way an arc length dimension's witness lines run: square to the measured stretch's chord, or along its radii (square to the arc). */
export type WitnessLines = "chord" | "tangent";

/** how high the arc indicator over an arc length rises, as a share of the text's height */
const INDICATOR_RISE = 0.35;
/** clearance between the top of an arc length's value and its arc indicator, as a share of the text's height */
const INDICATOR_GAP = 0.25;

/**
 * Arc length: the stretch of `circle` from `start` counter-clockwise through `sweep` (radians, above
 * 0 and under a whole turn), dimensioned by an arc about the same centre through `cursor`. Each end
 * of the stretch gets a witness line from a gap off it to past the dimension arc, along its radius
 * ("tangent") or parallel to the stretch's middle radius ("chord"; a stretch over a half turn takes
 * radii, as its chord no longer lies between its ends). Ticks end the dimension arc and `value` sits
 * at its middle on the side away from the stretch, turned to read along it, under a small arc when
 * `indicator` is set. Null when the cursor is at the centre, or nearer it than half the chord with
 * chord witness lines, which then miss the dimension arc.
 */
export function arcLengthLayout(
  circle: CircleGeom,
  start: number,
  sweep: number,
  cursor: Pt,
  witness: WitnessLines,
  indicator: boolean,
  scale: number,
  value: string,
): DimensionDrawing | null {
  if (!(scale > 0) || !(sweep > 0) || !(sweep < TAU)) return null;
  const { centre: o, radius: r } = circle;
  const radius = dist(cursor, o);
  if (!(radius > MIN_WORLD)) return null;
  const mid = start + sweep / 2;
  const m = { x: Math.cos(mid), y: Math.sin(mid) };
  const chord = witness === "chord" && sweep <= Math.PI;
  // chord witness lines run parallel to the middle radius: each end, r cos(sweep/2) along it and
  // r sin(sweep/2) across, travels along it to the dimension arc, which it meets that far across
  const along = r * Math.cos(sweep / 2);
  const across = r * Math.sin(sweep / 2);
  const reach = radius * radius - across * across;
  if (chord && reach < 0) return null;
  const half = chord ? Math.atan2(across, Math.sqrt(reach)) : sweep / 2;

  const gap = EXTENSION_GAP_MM * scale;
  const over = EXTENSION_OVERSHOOT_MM * scale;
  const lines: LineSeg[] = [];
  for (const side of [-1, 1]) {
    const t = mid + (side * sweep) / 2;
    const p = { x: o.x + r * Math.cos(t), y: o.y + r * Math.sin(t) };
    const dir = chord ? m : { x: Math.cos(t), y: Math.sin(t) };
    const travel = chord ? Math.sqrt(reach) - along : radius - r;
    // a dimension arc on (or within a gap of) the stretch needs no witness lines
    if (!(Math.abs(travel) > gap)) continue;
    const sense = Math.sign(travel);
    lines.push({
      a: { x: p.x + dir.x * gap * sense, y: p.y + dir.y * gap * sense },
      b: { x: p.x + dir.x * (travel + over * sense), y: p.y + dir.y * (travel + over * sense) },
    });
  }
  const arc = angleArc(o, radius, mid - half, 2 * half, scale);
  // the value reads upright, so on some sides it would sit toward the measured arc; it goes on
  // the far side then, its top (and its indicator's) a gap off the dimension arc
  const h = arc.text.height;
  const rad = (arc.text.angle * Math.PI) / 180;
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const away = radius >= r ? 1 : -1;
  let at = arc.text.at;
  if ((up.x * m.x + up.y * m.y) * away < 0) {
    const drop = TEXT_GAP_MM * scale + h * (1 + (indicator ? INDICATOR_GAP + INDICATOR_RISE : 0));
    at = { x: o.x + m.x * radius - up.x * drop, y: o.y + m.y * radius - up.y * drop };
  }
  const text = { ...arc.text, at, value };
  const arcs = indicator ? [...arc.arcs, arcIndicator(text)] : arc.arcs;
  return { lines: [...lines, ...arc.lines], arcs, text };
}

/** The small arc an arc length's value sits under: about as wide as the value, just above it. */
function arcIndicator(text: DimensionText): DimensionArc {
  const h = text.height;
  const rad = (text.angle * Math.PI) / 180;
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const halfWidth = Math.max(textWidth(text.value, h), h) / 2;
  const rise = h * INDICATOR_RISE;
  // a circle through the indicator's two ends and its top, the top centred over the value
  const radius = (halfWidth * halfWidth + rise * rise) / (2 * rise);
  const top = h * (1 + INDICATOR_GAP) + rise;
  const centre = { x: text.at.x + up.x * (top - radius), y: text.at.y + up.y * (top - radius) };
  const halfDeg = (Math.asin(Math.min(1, halfWidth / radius)) * 180) / Math.PI;
  return { centre, radius, startAngle: text.angle + 90 - halfDeg, sweepAngle: 2 * halfDeg };
}

/** An angle as an angular dimension shows it: degrees to one decimal place, with the degree sign. */
export function angleValue(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}

// ---- measurements (Object Info) -------------------------------------------

/** What Object Info measures on an object's geometry, in world units (millimetres). */
export type Measurement =
  /** a line, or an open polyline or polygon */
  | { readonly kind: "length"; readonly length: number }
  /** a closed polygon, polyline or rectangle, or a full circle or ellipse */
  | { readonly kind: "closed"; readonly area: number; readonly perimeter: number }
  /** a partial arc; `radius` is null for an elliptical arc, which has two radii */
  | { readonly kind: "arc"; readonly length: number; readonly radius: number | null };

/** The measurements of a shape, or null for shapes with no geometry to measure (text, images). */
export function measureShape(shape: Shape): Measurement | null {
  switch (shape.kind) {
    case "line":
      return { kind: "length", length: pathLength(shape.points, false) };
    case "polyline":
    case "polygon":
      return shape.closed ? closedMeasure(shape.points) : { kind: "length", length: pathLength(shape.points, false) };
    case "rect":
      return closedMeasure(shape.points);
    case "arc":
      return arcMeasure(shape);
    default:
      return null;
  }
}

/** Length of the chain through `pts`; `closed` adds the edge back from the last point to the first. */
export function pathLength(pts: readonly Pt[], closed: boolean): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 1) sum += dist(pts[pts.length - 1], pts[0]);
  return sum;
}

function closedMeasure(pts: readonly Pt[]): Measurement {
  return { kind: "closed", area: Math.abs(signedArea(pts)), perimeter: pathLength(pts, true) };
}

function arcMeasure(shape: Shape): Measurement | null {
  const c = shape.center;
  const rx = shape.rx;
  if (!c || rx === undefined || !(rx > 0)) return null;
  const ry = shape.ry ?? rx;
  if (!(ry > 0)) return null;
  const start = shape.startAngle ?? 0;
  const sweep = shape.sweepAngle ?? 360;
  if (Math.abs(sweep) >= 360) {
    return { kind: "closed", area: Math.PI * rx * ry, perimeter: ellipsePerimeter(rx, ry) };
  }
  const span = degToRad(Math.abs(sweep));
  if (rx === ry) return { kind: "arc", length: rx * span, radius: rx };
  // an arc of an ellipse runs from the start angle back over the sweep when the sweep is negative
  const from = degToRad(sweep < 0 ? start + sweep : start);
  return { kind: "arc", length: ellipseArcLength(rx, ry, from, span), radius: null };
}

/** Perimeter of an ellipse with semi-axes a and b: Ramanujan's approximation, exact for a circle. */
export function ellipsePerimeter(a: number, b: number): number {
  if (a === b) return 2 * Math.PI * a;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** Length of the arc of an ellipse (semi-axes a, b) from angle `start` over `span` radians, by Simpson's rule. */
function ellipseArcLength(a: number, b: number, start: number, span: number): number {
  const n = 512;
  const h = span / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = start + i * h;
    // speed along the curve (a cos t, b sin t) at parameter t
    const speed = Math.hypot(a * Math.sin(t), b * Math.cos(t));
    sum += (i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2) * speed;
  }
  return (sum * h) / 3;
}
