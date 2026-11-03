// What Rigging's Straight Truss, Curved Truss, Lighting Pipe, Lighting Pipe Ladder, House Rigging
// Point, Hoist, Bridle and Mother Grid draw (tools/rigging.ts) in Top/Plan, as plain geometry seen
// from above: a truss's top chords, ladder bars and lacing in its sections, a short last section
// apart (drawn red when highlighted); a pipe as a line or a tube along its path with its end
// markers and tick marks; a ladder lying flat or standing up; the schematic circle a rigging point
// or hoist shows without its library symbol, with their labels; a bridle's legs, measured from its
// heights; and a load's circle or line with its weights. Kept apart from the tools so it runs
// without the page.

import type { Pt } from "../core/index.ts";
import { dist, offsetPolyline } from "./geom.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";
import { millimetresPerUnit, parseLength } from "./units.ts";

export type TrussProfile = "box" | "triangle" | "ladder";
export type PipeEnds = "none" | "start" | "end" | "both";
export type TickKind = "none" | "line" | "dot";
export type TickOrigin = "centre" | "split";
export type LadderVerticals = "both" | "left" | "right" | "none";
export type LadderGuide = "centre" | "inside" | "outside";
export type HoistPosition = "up" | "down" | "none";

/** What a truss draws: its parts, and its short last section's apart (red when highlighted). */
export interface TrussPlan extends MarkerDrawing {
  readonly odd: { readonly outlines: Pt[][]; readonly lines: Pt[][] };
}

/** most sections, ladder bars and tick marks drawn, so a slip of the units can't hang the page */
export const MAX_SECTIONS = 2000;
export const MAX_BARS = 20000;
export const MAX_TICKS = 5000;
/** degrees an arc is drawn in steps of, at most */
const ARC_STEP = 2;

const at = (x: number, y: number): Pt => ({ x, y });
const rad = (deg: number): number => (deg * Math.PI) / 180;

type Draft = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[] };
const empty = (): Draft => ({ outlines: [], lines: [], circles: [], filled: [], texts: [] });

/** A truss's section through its top: the same for straight and curved ones. */
export interface TrussSection {
  readonly profile: TrussProfile;
  /** outside to outside, mm */
  readonly width: number;
  /** the chords' diameter or width */
  readonly chord: number;
  /** the top ladder bars' and lacing's diameters: 0 draws none */
  readonly ladderBar: number;
  readonly lacing: number;
  readonly folding: boolean;
  readonly highlight: boolean;
}

export interface StraightTruss extends TrussSection {
  readonly interval: number;
  readonly ladderSpacing: number;
  readonly direction: boolean;
}

export interface CurvedTruss extends TrussSection {
  /** outside to outside, mm */
  readonly diameter: number;
  /** degrees: the whole arc, each section's and the ladder bars' spacing */
  readonly totalArc: number;
  readonly segmentArc: number;
  readonly ladderArc: number;
}

/** Why a truss's section can't be drawn, or null: the configuration rules Vectorworks gives. */
function sectionProblem(t: TrussSection): string | null {
  if (!(t.chord > 0)) return "Set a Chord Width over 0.";
  if (!(t.width > 3 * t.chord)) return "The truss must be wider than three chord widths.";
  if (t.ladderBar > t.chord || t.lacing > t.chord) return "The ladder bars and lacing can't be thicker than the chords.";
  if (t.folding && t.lacing > 0) return "A folding truss can't have top lacing: set the Top Lacing Diameter to 0.";
  return null;
}

/**
 * The chords, ladder bars and lacing across one section, through `frame(s, d)`: the point `s`
 * along the section (0 to `length`) and `d` across it from its middle (positive to the left).
 * Its end bars stand in half a chord, so sections meet with two bars side by side; the bays
 * between bars are as near `spacing` as divides the section evenly, laced corner to corner.
 */
function section(into: { outlines: Pt[][]; lines: Pt[][] }, t: TrussSection, length: number, spacing: number, frame: (s: number, d: number) => Pt, steps: number): void {
  const c = t.chord;
  const yc = t.width / 2 - c / 2;
  const yi = yc - c / 2;
  const along = (d: number): Pt[] => Array.from({ length: steps + 1 }, (_, i) => frame((length * i) / steps, d));
  const chord = (y: number): Pt[] => [...along(y - c / 2), ...along(y + c / 2).reverse()];
  into.outlines.push(chord(-yc), chord(yc));
  if (t.profile === "triangle") into.outlines.push(chord(0));
  const bays = Math.max(1, Math.round((length - c) / spacing));
  const xs = Array.from({ length: bays + 1 }, (_, i) => c / 2 + ((length - c) * i) / bays);
  if (t.ladderBar > 0) for (const x of xs) into.lines.push([frame(x, -yi), frame(x, yi)]);
  if (t.lacing <= 0) return;
  for (let i = 0; i < bays; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    if (t.profile === "triangle") {
      into.lines.push([frame(xs[i], (s * c) / 2), frame(xs[i + 1], s * yi)]);
      into.lines.push([frame(xs[i], (-s * c) / 2), frame(xs[i + 1], -s * yi)]);
    } else into.lines.push([frame(xs[i], s * yi), frame(xs[i + 1], -s * yi)]);
  }
}

/** Why a straight truss `length` long can't be drawn, or null. */
export function straightTrussProblem(t: StraightTruss, length: number): string | null {
  const problem = sectionProblem(t);
  if (problem) return problem;
  if (t.ladderBar > 0 && !(t.ladderSpacing > 3 * t.ladderBar)) return "Space the ladder bars more than three times their diameter apart.";
  if (!(t.ladderSpacing > 0) || !(t.interval > t.ladderSpacing)) return "The Connection Interval must be longer than the Ladder Bar Spacing, both over 0.";
  if (!(length > 0)) return "Drag a longer truss.";
  if (length / t.interval > MAX_SECTIONS || length / t.ladderSpacing > MAX_BARS) return "The truss has too many sections to draw: set a longer Connection Interval or Ladder Bar Spacing.";
  return null;
}

/**
 * A straight truss `length` long from the origin along +x, centred across it: sections a
 * Connection Interval long, the last one shorter when the length doesn't divide (apart in `odd`);
 * with Show Direction, an arrowhead pointing along it at its middle.
 */
export function straightTruss(t: StraightTruss, length: number): TrussPlan | string {
  const problem = straightTrussProblem(t, length);
  if (problem) return problem;
  const d = empty();
  const odd = { outlines: [] as Pt[][], lines: [] as Pt[][] };
  const full = Math.floor(length / t.interval + 1e-9);
  const rest = length - full * t.interval;
  const starts = Array.from({ length: full }, (_, i) => i * t.interval);
  for (const x0 of starts) section(d, t, t.interval, t.ladderSpacing, (s, y) => at(x0 + s, y), 1);
  if (rest > t.chord) section(t.highlight ? odd : d, t, rest, t.ladderSpacing, (s, y) => at(full * t.interval + s, y), 1);
  if (t.direction) {
    const h = t.width / 4;
    d.filled.push([at(length / 2 + h, 0), at(length / 2 - h, h * 0.6), at(length / 2 - h, -h * 0.6)]);
  }
  return { ...d, odd };
}

/**
 * A curved truss round the origin, its arc's middle on +y: sections a Segment Arc long (the
 * last one shorter, apart in `odd`), the ladder bars spaced by the Ladder Spacing Arc.
 */
export function curvedTruss(t: CurvedTruss): TrussPlan | string {
  const problem = sectionProblem(t);
  if (problem) return problem;
  if (!(t.diameter > 2 * t.width)) return "The Diameter must be more than twice the truss width.";
  if (!(t.totalArc > 0 && t.totalArc <= 360)) return "Set a Total Arc over 0° and up to 360°.";
  if (!(t.ladderArc > 0) || !(t.segmentArc > t.ladderArc)) return "The Segment Arc must be more than the Ladder Spacing Arc, both over 0°.";
  if (t.totalArc / t.segmentArc > MAX_SECTIONS || t.totalArc / t.ladderArc > MAX_BARS) return "The truss has too many sections to draw: set a larger Segment Arc or Ladder Spacing Arc.";
  const d = empty();
  const odd = { outlines: [] as Pt[][], lines: [] as Pt[][] };
  // the section's middle line, and the length along it that a degree spans
  const mid = t.diameter / 2 - t.width / 2;
  const perDeg = rad(mid);
  const start = 90 - t.totalArc / 2;
  const sectionAt = (from: number, sweep: number, into: { outlines: Pt[][]; lines: Pt[][] }) =>
    section(
      into,
      t,
      sweep * perDeg,
      t.ladderArc * perDeg,
      (s, y) => {
        const a = rad(from + s / perDeg);
        const r = mid + y;
        return at(r * Math.cos(a), r * Math.sin(a));
      },
      Math.max(2, Math.ceil(sweep / ARC_STEP)),
    );
  const full = Math.floor(t.totalArc / t.segmentArc + 1e-9);
  for (let i = 0; i < full; i++) sectionAt(start + i * t.segmentArc, t.segmentArc, d);
  const rest = t.totalArc - full * t.segmentArc;
  if (rest * perDeg > t.chord) sectionAt(start + full * t.segmentArc, rest, t.highlight ? odd : d);
  return { ...d, odd };
}

export interface Pipe {
  readonly double: boolean;
  readonly diameter: number;
  readonly ends: PipeEnds;
  readonly centreline: boolean;
  readonly direction: boolean;
  readonly ticks: TickKind;
  /** between tick centres, a tick's length or dot's diameter, and the shift along the pipe */
  readonly centers: number;
  readonly tickSize: number;
  readonly offset: number;
  readonly origin: TickOrigin;
}

/** What a pipe draws: its parts, and its centre line apart (dashed). */
export interface PipePlan extends MarkerDrawing {
  readonly hidden: Pt[][];
}

/** The point `s` along a path, and the direction it runs there. */
function walk(pts: readonly Pt[], s: number): { p: Pt; dir: Pt } {
  let left = s;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = dist(a, b);
    if (len === 0) continue;
    const dir = at((b.x - a.x) / len, (b.y - a.y) / len);
    if (left <= len || i === pts.length - 1) return { p: at(a.x + dir.x * left, a.y + dir.y * left), dir };
    left -= len;
  }
  return { p: pts[0], dir: at(1, 0) };
}

const pathLength = (pts: readonly Pt[]): number => pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);

/**
 * A lighting pipe along a clicked path: a single line, or a tube its diameter across (capped at
 * open ends, its centre line apart when shown); an end marker at an open end, a bar across it
 * four diameters long; tick marks every Centers from the middle of the run (or split either side
 * of it), shifted by the Offset, as lines across it or dots; with Show Direction, an arrowhead at
 * its middle pointing along it.
 */
export function lightingPipe(path: readonly Pt[], closed: boolean, p: Pipe): PipePlan | string {
  if (path.length < 2) return "Click at least two points for the pipe.";
  if (!(p.diameter > 0)) return "Set a pipe Diameter over 0.";
  const pts = closed ? [...path, path[0]] : [...path];
  const total = pathLength(pts);
  if (!(total > 0)) return "Click points apart for the pipe.";
  if (p.ticks !== "none") {
    if (!(p.centers > 0 && p.tickSize > 0)) return "Set the tick marks' Centers and Size over 0.";
    if (total / p.centers > MAX_TICKS) return "The pipe has too many tick marks to draw: set wider Centers.";
  }
  const d = { ...empty(), hidden: [] as Pt[][] };
  if (p.double) {
    const l = offsetPolyline(path, closed, p.diameter / 2);
    const r = offsetPolyline(path, closed, -p.diameter / 2);
    if (!l || !r) return "The pipe turns too tightly for its diameter.";
    if (closed) d.outlines.push(l, r);
    else d.outlines.push([...l, ...r.reverse()]);
    if (p.centreline) d.hidden.push(pts);
  } else d.lines.push(pts);
  const across = (q: Pt, dir: Pt, len: number): Pt[] => [at(q.x - (dir.y * len) / 2, q.y + (dir.x * len) / 2), at(q.x + (dir.y * len) / 2, q.y - (dir.x * len) / 2)];
  if (!closed) {
    if (p.ends === "start" || p.ends === "both") {
      const w = walk(pts, 0);
      d.lines.push(across(w.p, w.dir, 4 * p.diameter));
    }
    if (p.ends === "end" || p.ends === "both") {
      const w = walk(pts, total);
      d.lines.push(across(w.p, w.dir, 4 * p.diameter));
    }
  }
  if (p.ticks !== "none") {
    const first = total / 2 + p.offset + (p.origin === "split" ? p.centers / 2 : 0);
    const k0 = Math.ceil((0 - first) / p.centers - 1e-9);
    for (let k = k0; first + k * p.centers <= total + 1e-9; k++) {
      const w = walk(pts, first + k * p.centers);
      if (p.ticks === "line") d.lines.push(across(w.p, w.dir, p.tickSize));
      else d.filled.push(Array.from({ length: 16 }, (_, i) => at(w.p.x + (p.tickSize / 2) * Math.cos((i * Math.PI) / 8), w.p.y + (p.tickSize / 2) * Math.sin((i * Math.PI) / 8))));
    }
  }
  if (p.direction) {
    const w = walk(pts, total / 2);
    const h = Math.max(p.diameter, 50) * 2;
    const back = at(w.p.x - w.dir.x * h, w.p.y - w.dir.y * h);
    d.filled.push([at(w.p.x + w.dir.x * h, w.p.y + w.dir.y * h), ...across(back, w.dir, h * 1.2)]);
  }
  return d;
}

export interface Ladder {
  readonly rungs: number;
  readonly double: boolean;
  readonly rungDiameter: number;
  readonly sideDiameter: number;
  readonly verticals: LadderVerticals;
  readonly guides: LadderGuide;
}

/** most rungs a ladder takes */
export const MAX_RUNGS = 500;

/** A pipe from `a` to `b`: a line, or a tube `diameter` across. */
function pipe(into: Draft, a: Pt, b: Pt, diameter: number, double: boolean): void {
  const len = dist(a, b);
  if (!double || len === 0) {
    into.lines.push([a, b]);
    return;
  }
  const n = at((-(b.y - a.y) / len) * (diameter / 2), ((b.x - a.x) / len) * (diameter / 2));
  into.outlines.push([at(a.x + n.x, a.y + n.y), at(b.x + n.x, b.y + n.y), at(b.x - n.x, b.y - n.y), at(a.x - n.x, a.y - n.y)]);
}

/** Why a ladder can't be drawn, or null. */
function ladderProblem(l: Ladder, width: number, height: number): string | null {
  if (!(l.rungs >= 1 && l.rungs <= MAX_RUNGS)) return `Set from 1 to ${MAX_RUNGS} rungs.`;
  if (!(l.rungDiameter > 0 && l.sideDiameter > 0)) return "Set the rung and side Diameters over 0.";
  if (!(width > 2 * l.sideDiameter) || !(height > 0)) return "Drag a larger ladder: wider than two side diameters.";
  return null;
}

/**
 * A ladder lying flat in the rectangle from `a` to `b`: its sides along the rectangle's height
 * (both, either or none) and its rungs across it, evenly spaced from the bottom to the top (a
 * single rung at the top), their centre lines on the rectangle, inside it or outside it by the
 * Guides.
 */
export function flatLadder(a: Pt, b: Pt, l: Ladder): MarkerDrawing | string {
  const shift = l.guides === "inside" ? -1 : l.guides === "outside" ? 1 : 0;
  const x0 = Math.min(a.x, b.x) - (shift * l.sideDiameter) / 2;
  const x1 = Math.max(a.x, b.x) + (shift * l.sideDiameter) / 2;
  const y0 = Math.min(a.y, b.y) - (shift * l.rungDiameter) / 2;
  const y1 = Math.max(a.y, b.y) + (shift * l.rungDiameter) / 2;
  const problem = ladderProblem(l, x1 - x0, y1 - y0);
  if (problem) return problem;
  const d = empty();
  if (l.verticals === "both" || l.verticals === "left") pipe(d, at(x0, y0), at(x0, y1), l.sideDiameter, l.double);
  if (l.verticals === "both" || l.verticals === "right") pipe(d, at(x1, y0), at(x1, y1), l.sideDiameter, l.double);
  for (let i = 0; i < l.rungs; i++) {
    const y = l.rungs === 1 ? y1 : y0 + ((y1 - y0) * i) / (l.rungs - 1);
    pipe(d, at(x0, y), at(x1, y), l.rungDiameter, l.double);
  }
  return d;
}

/** A ladder standing up, `width` wide, centred on the origin along x: from above, its top rung and its sides' tops. */
export function standingLadder(width: number, l: Ladder): MarkerDrawing | string {
  const problem = ladderProblem(l, width, 1);
  if (problem) return problem;
  const d = empty();
  pipe(d, at(-width / 2, 0), at(width / 2, 0), l.rungDiameter, l.double);
  if (l.verticals === "both" || l.verticals === "left") d.circles.push({ center: at(-width / 2, 0), radius: l.sideDiameter / 2 });
  if (l.verticals === "both" || l.verticals === "right") d.circles.push({ center: at(width / 2, 0), radius: l.sideDiameter / 2 });
  return d;
}

/** a label's height against the symbol's size, and its gap from it */
const LABEL_SHARE = 0.3;
const LABEL_GAP = 0.15;

/** `lines` of text stacked down from `top`, left-justified at `x`. */
function stack(into: Draft, lines: readonly string[], x: number, top: number, height: number): void {
  lines.forEach((text, i) => into.texts.push({ at: at(x, top - height * 1.4 * i - height / 2), text, height, justify: "left" }));
}

/**
 * A house rigging point's schematic `size` across: a square round a circle, crossed through its
 * middle; its name and ID stacked beside it.
 */
export function riggingPoint(size: number, label: readonly string[]): MarkerDrawing | string {
  if (!(size > 0)) return "Set a Size over 0.";
  const d = empty();
  const h = size / 2;
  d.outlines.push([at(-h, -h), at(h, -h), at(h, h), at(-h, h)]);
  d.circles.push({ center: at(0, 0), radius: h * 0.7 });
  d.lines.push([at(-h, 0), at(h, 0)], [at(0, -h), at(0, h)]);
  stack(d, label.filter((t) => t.trim()), h + size * LABEL_GAP, h, size * LABEL_SHARE);
  return d;
}

/**
 * A hoist's schematic `size` across: its motor a circle in quarters, the upper left and lower
 * right filled (none when its position isn't shown: a cross on the hook point instead); its ID
 * above to the right and the measurement label's X and Y below to the left.
 */
export function hoist(size: number, position: HoistPosition, id: string, measure: readonly string[]): MarkerDrawing | string {
  if (!(size > 0)) return "Set a Hoist Symbol Scale over 0.";
  const d = empty();
  const r = size / 2;
  if (position === "none") d.lines.push([at(-r / 3, 0), at(r / 3, 0)], [at(0, -r / 3), at(0, r / 3)]);
  else {
    d.circles.push({ center: at(0, 0), radius: r });
    d.lines.push([at(-r, 0), at(r, 0)], [at(0, -r), at(0, r)]);
    const quarter = (from: number): Pt[] => [at(0, 0), ...Array.from({ length: 13 }, (_, i) => at(r * Math.cos(rad(from + 7.5 * i)), r * Math.sin(rad(from + 7.5 * i))))];
    d.filled.push(quarter(90), quarter(270));
  }
  const h = size * LABEL_SHARE;
  if (id.trim()) d.texts.push({ at: at(r + size * LABEL_GAP, r), text: id.trim(), height: h, justify: "left" });
  measure.forEach((text, i) => d.texts.push({ at: at(-r, -r - size * LABEL_GAP - h / 2 - h * 1.4 * i), text, height: h, justify: "right" }));
  return d;
}

/**
 * A hoist origin's schematic `size` across: a square round a circle, crossed by lines the full size
 * through its middle on the point (the origin); its name centred on `labelAt`.
 */
export function hoistOrigin(size: number, name: string, labelAt: Pt): MarkerDrawing | string {
  if (!(size > 0)) return "Set a Size over 0.";
  const d = empty();
  const h = size / 2;
  const s = size * 0.3;
  d.outlines.push([at(-s, -s), at(s, -s), at(s, s), at(-s, s)]);
  d.circles.push({ center: at(0, 0), radius: s * 0.7 });
  d.lines.push([at(-h, 0), at(h, 0)], [at(0, -h), at(0, h)]);
  if (name.trim()) d.texts.push({ at: labelAt, text: name.trim(), height: size * LABEL_SHARE, justify: "centre" });
  return d;
}

export type BridleType = "two" | "three" | "reversed";

/** how many legs each bridle type has */
export const BRIDLE_LEGS: Readonly<Record<BridleType, number>> = { two: 2, three: 3, reversed: 2 };

/**
 * A bridle's heights: the rigging point its legs hang from (a reversed bridle's one point), its
 * apex where the legs meet, and its trim, where its down leg meets the truss (a reversed bridle's
 * legs reach the truss there).
 */
export interface BridleHeights {
  readonly rigging: number;
  readonly apex: number;
  readonly trim: number;
}

export interface BridleLeg {
  /** where the leg reaches, in plan */
  readonly to: Pt;
  readonly length: number;
  /** from vertical, degrees */
  readonly angle: number;
}

export interface BridlePlan {
  readonly legs: BridleLeg[];
  /** the one leg straight up or down from the apex: a bridle's down leg to the truss, a reversed one's to its rigging point */
  readonly single: number;
}

/**
 * A bridle whose apex stands over `apex` in plan (a bridle's connection to the truss, a reversed
 * one's rigging point), its legs reaching `legs`: each leg's length and angle from vertical, from
 * how far it reaches across and how far it rises (from the apex to the rigging points, or from the
 * truss to a reversed bridle's apex). A message when the heights or points can't make one.
 */
export function bridle(type: BridleType, apex: Pt, legs: readonly Pt[], h: BridleHeights): BridlePlan | string {
  if (legs.length !== BRIDLE_LEGS[type]) return `A ${type === "three" ? "three" : "two"} leg bridle needs ${BRIDLE_LEGS[type]} leg points.`;
  if (!(h.trim < h.apex && h.apex < h.rigging)) return "Set the Trim Height under the Apex Height, under the Rigging Point Height.";
  const rise = type === "reversed" ? h.apex - h.trim : h.rigging - h.apex;
  const out: BridleLeg[] = [];
  for (const to of legs) {
    const across = dist(apex, to);
    if (!(across > 1)) return "Click each leg's point away from the apex.";
    out.push({ to, length: Math.hypot(across, rise), angle: (Math.atan2(across, rise) * 180) / Math.PI });
  }
  return { legs: out, single: type === "reversed" ? h.rigging - h.apex : h.apex - h.trim };
}

/** Where along the line from `a` to `b` (0 at `a`, 1 at `b`) the point nearest `p` lies. */
export function alongLine(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  return len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
}

/** pounds in a kilogram's weight */
const KG_PER_LB = 0.45359237;
/** a load's weight per length is shown per foot in an imperial drawing, per metre otherwise, mm */
const FOOT = 304.8;
const METRE = 1000;

/** Whether the drawing's `units` are imperial, its loads weighed in pounds. */
export function imperialUnits(units: string | undefined): boolean {
  return [25.4, 304.8, 914.4, 1609344].includes(millimetresPerUnit(units));
}

/** A weight typed as a number with lb or kg after it if wished (else pounds when `imperial`), in kg; null when it isn't one or is negative. */
export function parseWeight(text: string, imperial: boolean): number | null {
  const m = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(lbs?|#|kgs?)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const unit = (m[2] ?? (imperial ? "lb" : "kg")).toLowerCase();
  return unit.startsWith("kg") ? n : n * KG_PER_LB;
}

/** A weight in kg, as the drawing shows it: "150.00 lb" or "68.04 kg". */
export function formatWeight(kg: number, imperial: boolean): string {
  return imperial ? `${(kg / KG_PER_LB).toFixed(2)} lb` : `${kg.toFixed(2)} kg`;
}

/** A weight per length in kg per mm, as the drawing shows it: "100.00 lb/ft" or "148.82 kg/m". */
export function formatPerLength(kgPerMm: number, imperial: boolean): string {
  return imperial ? `${((kgPerMm * FOOT) / KG_PER_LB).toFixed(2)} lb/ft` : `${(kgPerMm * METRE).toFixed(2)} kg/m`;
}

/**
 * A distributed load's weights along `length` mm: `text` its weight per length (500/10 is 500 per
 * 10 of the drawing's units, a bare weight per foot or metre) or, `total`, its whole weight. Its
 * whole weight in kg and its weight per mm, or why it can't be read.
 */
export function distributedWeights(text: string, total: boolean, length: number, units: string | undefined): { total: number; perMm: number } | string {
  const imperial = imperialUnits(units);
  if (!(length > 0)) return "Click points apart for the load.";
  if (total) {
    const kg = parseWeight(text, imperial);
    return kg === null ? "Set the load's Total Weight: a number, lb or kg after it if you like." : { total: kg, perMm: kg / length };
  }
  const [w, per, extra] = text.split("/");
  const kg = parseWeight(w ?? "", imperial);
  const over = per === undefined ? (imperial ? FOOT : METRE) : parseLength(per, units);
  if (kg === null || extra !== undefined || over === null || !(over > 0)) return "Set the load's Distributed Weight: a weight, or a weight / the length it's spread over (500/10).";
  return { total: (kg / over) * length, perMm: kg / over };
}

/**
 * A point load's generic schematic `size` across on the origin: a circle with its legend over it,
 * and its label's lines (`textSize` high) stacked beside it to the right, the block turned
 * `labelAngle` degrees about the circle's centre.
 */
export function pointLoad(size: number, legend: string, label: readonly string[], textSize: number, labelAngle: number): MarkerDrawing {
  const d = empty();
  const r = size / 2;
  d.circles.push({ center: at(0, 0), radius: r });
  if (legend.trim()) d.texts.push({ at: at(0, 0), text: legend.trim(), height: textSize * 0.6, justify: "centre" });
  const lines = label.filter((t) => t.trim());
  const c = Math.cos(rad(labelAngle));
  const s = Math.sin(rad(labelAngle));
  lines.forEach((text, i) => {
    // the block centred on the circle's middle, each line under the last
    const x = r + textSize * 0.6;
    const y = textSize * 0.7 * (lines.length - 1) - textSize * 1.4 * i;
    d.texts.push({ at: at(x * c - y * s, x * s + y * c), text: text.trim(), height: textSize, justify: "left", angle: labelAngle });
  });
  return d;
}

/**
 * A distributed load along `path`: the path, and its label's lines (`textSize` high) stacked level
 * beside its middle, on its left (above a path drawn left to right).
 */
export function distributedLoad(path: readonly Pt[], label: readonly string[], textSize: number): MarkerDrawing | string {
  if (path.length < 2) return "Click at least two points for the load.";
  const lens = path.slice(1).map((q, i) => dist(path[i], q));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return "Click points apart for the load.";
  const d = empty();
  d.lines.push([...path]);
  let left = total / 2;
  let i = 0;
  while (i < lens.length - 1 && left > lens[i]) left -= lens[i++];
  const u = at((path[i + 1].x - path[i].x) / lens[i], (path[i + 1].y - path[i].y) / lens[i]);
  const mid = at(path[i].x + u.x * left, path[i].y + u.y * left);
  // the block on the path's left: centred beside a steep path, else above or below its middle
  const n = at(-u.y, u.x);
  const lines = label.filter((t) => t.trim());
  const pitch = textSize * 1.4;
  const steep = Math.abs(n.y) < 0.5;
  const top = steep ? mid.y + (pitch * (lines.length - 1)) / 2 : n.y > 0 ? mid.y + textSize + pitch * (lines.length - 1) : mid.y - textSize;
  const x = steep ? mid.x + Math.sign(n.x) * textSize * 0.6 : mid.x;
  const justify = steep ? (n.x < 0 ? "right" : "left") : "centre";
  lines.forEach((text, k) => d.texts.push({ at: at(x, top - pitch * k), text: text.trim(), height: textSize, justify }));
  return d;
}
