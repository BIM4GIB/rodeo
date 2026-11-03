// What Event Design's Stage Deck, Stage Plug, Stage Steps, Stage Ramp and Rope and Stanchion draw
// (tools/stage.ts) in Top/Plan, as plain geometry: a deck's top, the railings along its sides and
// its legs (out of sight under it, or as loci for a deck-only structure); steps' treads, stringers,
// railings and travel arrow; a ramp's run; and stanchions along a path with the belts, ropes or
// chains between them. Steps and ramps lie in their own frame, the stage's edge along x = 0 and the
// run coming down along +x; a deck lies round the origin, its front toward −y. Kept apart from the
// tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist, distToPolyline, offsetPolyline, pointInPolygon } from "./geom.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

export type StageStructure = "simple" | "border" | "deckOnly" | "legsBasic" | "legsBraced";
export type LegProfile = "round" | "square" | "octagon";
export type DeckRail = "none" | "straight" | "toe" | "straightToe";
export type StepStructure = "simple" | "solid" | "open" | "frame" | "selfAdjusting";
export type StringerType = "inside" | "outside";
export type TravelArrow = "none" | "up" | "down";
export type RampBasis = "rampLength" | "floorLength" | "angle" | "ratio" | "percent";
export type StringerKind = "belt" | "rope" | "chain";
export type EndStanchions = "both" | "start" | "end" | "none";

/** a top rail's width seen from above, mm */
export const RAIL_WIDTH = 40;
/** a toe board's thickness, mm */
export const TOE_THICKNESS = 25;
/** most legs a deck, plug or ramp draws, and most stanchions a barrier does */
export const MAX_LEGS = 2000;
export const MAX_STANCHIONS = 2000;
/** most chain links one barrier draws */
const MAX_LINKS = 5000;
/** points round a round leg */
const ROUND_STEPS = 24;
/** points round a whole circle's arc */
const ARC_STEPS = 96;
/** a deck's outline turning more than this (radians) at a vertex has a corner there, where a leg stands */
const CORNER_TURN = (20 * Math.PI) / 180;
const EPS = 1e-9;

/** What a stage object draws, and how many legs or stanchions. */
export interface StagePlan extends MarkerDrawing {
  /** outlines out of sight under the deck, drawn dashed: its legs, braces and inside stringers */
  readonly hidden: Pt[][];
  /** where a deck-only structure's legs stand */
  readonly loci: Pt[];
  readonly count: number;
}

/** How a deck, plug or ramp stands. */
export interface Legs {
  readonly structure: StageStructure;
  readonly diameter: number;
  readonly profile: LegProfile;
  /** about how far apart the legs stand */
  readonly spacing: number;
  /** a legs-braced deck shown by its legs and braces alone */
  readonly hideDeck: boolean;
}

export interface StageDeck extends Legs {
  readonly shape: "rect" | "round";
  readonly width: number;
  readonly depth: number;
  readonly radius: number;
  /** degrees a round deck sweeps, centred on its front */
  readonly sweep: number;
  /** a rectangular deck's front, right, back and left; a round one's start radius, arc and end radius */
  readonly rails: readonly DeckRail[];
}

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b);
  return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 1, y: 0 };
};
const left = (u: Pt): Pt => ({ x: -u.y, y: u.x });
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const empty = (): StagePlan => ({ outlines: [], lines: [], circles: [], filled: [], texts: [], hidden: [], loci: [], count: 0 });

/** Twice the outline's area, positive counter-clockwise. */
function area2(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - a.y * b.x;
  }
  return s;
}

/** A leg's outline at `p`, its flats square to `u`. */
function legOutline(profile: LegProfile, d: number, p: Pt, u: Pt): Pt[] {
  const sides = profile === "square" ? 4 : profile === "octagon" ? 8 : ROUND_STEPS;
  // a square's or octagon's size is across its flats
  const r = profile === "round" ? d / 2 : d / 2 / Math.cos(Math.PI / sides);
  const turn = Math.atan2(u.y, u.x) + (profile === "round" ? 0 : Math.PI / sides);
  return Array.from({ length: sides }, (_, k) => {
    const t = turn + (2 * Math.PI * k) / sides;
    return { x: p.x + r * Math.cos(t), y: p.y + r * Math.sin(t) };
  });
}

/**
 * Where legs stand under an outline (counter-clockwise), `diameter / 2` in from its edge: at its
 * corners and evenly along each side between them, no further apart than `spacing`; then on a grid
 * `spacing` apart, square to its first side, across the inside, kept at least half a spacing in
 * from the edge legs. The edge legs come first, in order round the outline. Null when no leg fits.
 */
function legPoints(outline: readonly Pt[], diameter: number, spacing: number): { edge: Pt[]; inside: Pt[]; tooMany: boolean } | null {
  const ring = offsetPolyline(outline, true, diameter / 2);
  if (!ring || ring.length < 3 || area2(ring) <= EPS) return null;
  const n = ring.length;
  const turnAt = (i: number): number => {
    const d0 = sub(ring[i], ring[(i - 1 + n) % n]);
    const d1 = sub(ring[(i + 1) % n], ring[i]);
    return Math.abs(Math.atan2(d0.x * d1.y - d0.y * d1.x, d0.x * d1.x + d0.y * d1.y));
  };
  const corners = ring.map((_, i) => i).filter((i) => turnAt(i) > CORNER_TURN);
  // a whole circle has no corner: walk it from its first point
  const stops = corners.length ? corners : [0];
  const edge: Pt[] = [];
  for (let c = 0; c < stops.length; c++) {
    const from = stops[c];
    const to = stops[(c + 1) % stops.length];
    const run: Pt[] = [ring[from]];
    for (let i = (from + 1) % n; ; i = (i + 1) % n) {
      run.push(ring[i]);
      if (i === to) break;
    }
    let len = 0;
    for (let i = 1; i < run.length; i++) len += dist(run[i - 1], run[i]);
    const k = Math.max(1, Math.ceil(len / spacing - EPS));
    if (edge.length + k > MAX_LEGS) return { edge, inside: [], tooMany: true };
    for (let m = 0; m < k; m++) edge.push(along(run, (len * m) / k));
  }
  const u = unit(ring[0], ring[1]);
  const v = left(u);
  const local = ring.map((p) => ({ s: (p.x - ring[0].x) * u.x + (p.y - ring[0].y) * u.y, t: (p.x - ring[0].x) * v.x + (p.y - ring[0].y) * v.y }));
  const [s0, s1] = [Math.min(...local.map((q) => q.s)), Math.max(...local.map((q) => q.s))];
  const [t0, t1] = [Math.min(...local.map((q) => q.t)), Math.max(...local.map((q) => q.t))];
  const inside: Pt[] = [];
  // a grid far finer than the outline would take too long to walk, and hold too many legs anyway
  if (((s1 - s0) / spacing) * ((t1 - t0) / spacing) > 1e6) return { edge, inside, tooMany: true };
  for (let i = Math.ceil(s0 / spacing); i * spacing <= s1; i++) {
    for (let j = Math.ceil(t0 / spacing); j * spacing <= t1; j++) {
      const q = add(add(ring[0], u, i * spacing), v, j * spacing);
      if (!pointInPolygon(q, ring) || distToPolyline(q, ring, true) < spacing / 2 - EPS) continue;
      inside.push(q);
      if (edge.length + inside.length > MAX_LEGS) return { edge, inside, tooMany: true };
    }
  }
  return { edge, inside, tooMany: false };
}

/** The point `s` along a polyline. */
function along(pts: readonly Pt[], s: number): Pt {
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (s <= l || i === pts.length - 1) return add(pts[i - 1], unit(pts[i - 1], pts[i]), Math.min(s, l));
    s -= l;
  }
  return pts[0];
}

/** A strip `width` wide inside the side from `a` to `b` (the outline's inside on its left). */
function strip(a: Pt, b: Pt, width: number): Pt[] {
  const n = left(unit(a, b));
  return [a, b, add(b, n, width), add(a, n, width)];
}

/** How wide a rail looks from above: a top rail hides a toe board under it. */
const railWidth = (r: DeckRail): number => (r === "toe" ? TOE_THICKNESS : r === "none" ? 0 : RAIL_WIDTH);

/** Arc points from `a0` to `a1` radians at radius `r` round the origin. */
function arc(r: number, a0: number, a1: number): Pt[] {
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (2 * Math.PI)) * ARC_STEPS));
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = a0 + ((a1 - a0) * k) / steps;
    return { x: r * Math.cos(t), y: r * Math.sin(t) };
  });
}

/** Why the legs' settings can't stand a deck, or null. */
function legsProblem(l: Legs): string | null {
  const legged = l.structure !== "simple" && l.structure !== "border";
  return legged && !(l.diameter > 0 && l.spacing > 0) ? "Set the legs' Diameter and Reference Spacing over 0." : null;
}

/** A deck's top `outline` (counter-clockwise), its rails (`strips`, drawn on it) and its legs as its structure shows them. */
function deckPlan(outline: Pt[], strips: Pt[][], l: Legs): StagePlan | string {
  const plan = empty();
  const hideDeck = l.hideDeck && l.structure === "legsBraced";
  if (!hideDeck) plan.outlines.push(outline, ...strips);
  if (l.structure === "simple" || l.structure === "border") return plan;
  const legs = legPoints(outline, l.diameter, l.spacing);
  if (!legs) return "The deck is too small for its legs: make it larger, or set a smaller leg Diameter.";
  const all = [...legs.edge, ...legs.inside];
  if (legs.tooMany) return `This deck would stand on more than ${MAX_LEGS} legs: set a longer Reference Spacing.`;
  if (l.structure === "deckOnly") plan.loci.push(...all);
  else {
    const u = unit(outline[0], outline[1]);
    const shown = hideDeck ? plan.outlines : plan.hidden;
    shown.push(...all.map((p) => legOutline(l.profile, l.diameter, p, u)));
    // braces run between neighbouring edge legs, seen edge on from above
    if (l.structure === "legsBraced") {
      const braces = legs.edge.map((p, i) => [p, legs.edge[(i + 1) % legs.edge.length]]).filter(([a, b]) => dist(a, b) > l.diameter);
      if (hideDeck) plan.lines.push(...braces);
      else plan.hidden.push(...braces);
    }
  }
  return { ...plan, count: all.length };
}

/** A stage deck round the origin, its front toward −y. A message when its settings can't draw. */
export function stageDeck(d: StageDeck): StagePlan | string {
  const problem = legsProblem(d);
  if (problem) return problem;
  if (d.shape === "rect") {
    if (!(d.width > 0 && d.depth > 0)) return "Set the deck's Width and Depth over 0.";
    const outline = box(-d.width / 2, -d.depth / 2, d.width / 2, d.depth / 2);
    const strips = outline.flatMap((a, i) => {
      const w = railWidth(d.rails[i] ?? "none");
      return w > 0 ? [strip(a, outline[(i + 1) % 4], Math.min(w, d.width / 2, d.depth / 2))] : [];
    });
    return deckPlan(outline, strips, d);
  }
  if (!(d.radius > 0 && d.sweep > 0 && d.sweep <= 360)) return "Set the deck's Radius over 0 and its Sweep Angle over 0° and up to 360°.";
  const sweep = (d.sweep * Math.PI) / 180;
  const whole = d.sweep >= 360;
  const a0 = -Math.PI / 2 - sweep / 2;
  const a1 = a0 + sweep;
  const rim = arc(d.radius, a0, a1);
  const outline = whole ? rim.slice(0, -1) : [{ x: 0, y: 0 }, ...rim];
  const [start, arcRail, end] = [d.rails[0] ?? "none", d.rails[1] ?? "none", d.rails[2] ?? "none"];
  const strips: Pt[][] = [];
  const wArc = Math.min(railWidth(arcRail), d.radius / 2);
  // a whole circle's rail shows as its inside edge, a circle within the deck's
  if (wArc > 0) strips.push(whole ? arc(d.radius - wArc, a0, a1).slice(0, -1) : [...rim, ...arc(d.radius - wArc, a1, a0)]);
  if (!whole) {
    const ws = railWidth(start);
    const we = railWidth(end);
    if (ws > 0) strips.push(strip({ x: 0, y: 0 }, rim[0], ws));
    if (we > 0) strips.push(strip(rim[rim.length - 1], { x: 0, y: 0 }, we));
  }
  return deckPlan(outline, strips, d);
}

/** A stage plug filling the outline clicked. */
export function stagePlug(outline: readonly Pt[], l: Legs): StagePlan | string {
  const pts = outline.filter((q, i) => i === 0 || dist(q, outline[i - 1]) > EPS);
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  if (pts.length < 3 || Math.abs(area2(pts)) <= EPS) return "Click three corners or more for the stage plug's outline.";
  const problem = legsProblem(l);
  if (problem) return problem;
  return deckPlan(area2(pts) < 0 ? pts.reverse() : pts, [], l);
}

/** Railings either side of a run `length` long and `width` wide (centred on y = 0), and as many more between when both show. */
interface Rails {
  readonly left: boolean;
  readonly right: boolean;
  readonly extraRails: number;
}

/** Rail strips along x from 0 to `length`, their outer faces `outer` from the middle; left is −y (the left going up, toward x = 0). */
function railStrips(r: Rails, length: number, width: number, outer: number): Pt[][] {
  const out: Pt[][] = [];
  if (r.left) out.push(box(0, -outer, length, -outer + RAIL_WIDTH));
  if (r.right) out.push(box(0, outer - RAIL_WIDTH, length, outer));
  if (r.left && r.right) {
    const n = Math.min(50, Math.max(0, Math.round(r.extraRails)));
    for (let k = 1; k <= n; k++) {
      const y = -width / 2 + (width * k) / (n + 1);
      out.push(box(0, y - RAIL_WIDTH / 2, length, y + RAIL_WIDTH / 2));
    }
  }
  return out;
}

/** The travel arrow along the middle of a run `length` long, its head toward the stage (up) or the floor (down), with "UP" or "DN" past its tail. */
function travelArrow(plan: StagePlan, arrow: TravelArrow, length: number, inset: number, size: number, h: number): void {
  if (arrow === "none" || !(size > 0)) return;
  const [tail, head] = arrow === "up" ? [length - inset, inset] : [inset, length - inset];
  const way = Math.sign(head - tail);
  if (way === 0) return;
  plan.lines.push([{ x: tail, y: 0 }, { x: head - way * size, y: 0 }]);
  plan.filled.push([{ x: head, y: 0 }, { x: head - way * size, y: size / 3 }, { x: head - way * size, y: -size / 3 }]);
  // centred, so it stays past the tail when the text is turned to read the right way up
  plan.texts.push({ at: { x: tail - way * 1.1 * h, y: 0 }, text: arrow === "up" ? "UP" : "DN", height: h, justify: "centre", angle: 0 });
}

export interface StageSteps extends Rails {
  readonly structure: StepStructure;
  readonly stageHeight: number;
  /** each step's width */
  readonly width: number;
  readonly steps: number;
  readonly topStep: boolean;
  readonly depth: number;
  /** self-adjusting steps' stringers, of fixed length */
  readonly stringerLength: number;
  readonly stringerWidth: number;
  /** an open free-standing flight's stringers: under its treads or beside them */
  readonly stringerType: StringerType;
  readonly extraStringers: number;
  readonly indent: number;
  readonly arrow: TravelArrow;
  readonly arrowSize: number;
  readonly textHeight: number;
}

/** Stage steps coming down from the stage's edge (x = 0) along +x, centred on y = 0. */
export function stageSteps(s: StageSteps): StagePlan | string {
  const n = Math.round(s.steps);
  if (!(s.width > 0 && n >= 1 && n <= 200)) return "Set Step Unit Width over 0 and Number of Steps from 1 to 200.";
  let depth = s.depth;
  if (s.structure === "selfAdjusting") {
    if (!(s.stageHeight > 0 && s.stringerLength > s.stageHeight)) return "Self-adjusting steps need a Stringer Length longer than the Stage Height, both over 0.";
    depth = Math.sqrt(s.stringerLength ** 2 - s.stageHeight ** 2) / n;
  } else if (!(depth > 0)) return "Set Single Step Depth over 0.";
  const treads = n + (s.topStep ? 1 : 0);
  const length = treads * depth;
  const plan = empty();
  plan.outlines.push(box(0, -s.width / 2, length, s.width / 2));
  for (let k = 1; k < treads; k++) plan.lines.push([{ x: k * depth, y: -s.width / 2 }, { x: k * depth, y: s.width / 2 }]);
  const sw = s.stringerWidth;
  const stringers = s.structure === "selfAdjusting" || s.structure === "open";
  const outside = stringers && (s.structure === "selfAdjusting" || s.stringerType === "outside");
  if (stringers && !(sw > 0)) return "Set Stringer Width over 0.";
  if (outside) plan.outlines.push(box(0, -s.width / 2 - sw, length, -s.width / 2), box(0, s.width / 2, length, s.width / 2 + sw));
  else if (stringers) {
    // inside stringers stand under the treads, the outer two moved in by the indent
    const edge = s.width / 2 - Math.max(0, s.indent);
    if (edge - sw < -edge) return "The stringers don't fit under the steps: set a narrower Stringer Width or a smaller Side Stringer Indent.";
    const extra = Math.min(50, Math.max(0, Math.round(s.extraStringers)));
    for (let k = 0; k <= extra + 1; k++) {
      const y = -edge + sw / 2 + ((2 * edge - sw) * k) / (extra + 1);
      plan.hidden.push(box(0, y - sw / 2, length, y + sw / 2));
    }
  }
  const outer = s.width / 2 + (outside ? sw / 2 + RAIL_WIDTH / 2 : 0);
  plan.outlines.push(...railStrips(s, length, s.width, Math.max(outer, RAIL_WIDTH)));
  travelArrow(plan, s.arrow, length, depth / 2, s.arrowSize, s.textHeight);
  return plan;
}

export interface StageRamp extends Rails {
  readonly structure: "simple" | "legsBasic";
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  /** what `value` gives: the ramp's sloping length, its length on the floor, or its pitch */
  readonly basis: RampBasis;
  /** a length; an angle in degrees; a run for each unit of rise (12 for 1:12); a percent */
  readonly value: number;
  readonly legs: Legs;
  readonly arrow: TravelArrow;
  readonly arrowSize: number;
  readonly textHeight: number;
}

/** A ramp's length on the floor from its rise and basis, or a message. */
export function rampFloorLength(r: StageRamp): number | string {
  const rise = r.top - r.bottom;
  if (!(rise > 0)) return "Set a Top Height above the Bottom Height.";
  const v = r.value;
  switch (r.basis) {
    case "rampLength":
      return v > rise ? Math.sqrt(v * v - rise * rise) : "Set a Ramp Length longer than its rise (Top Height less Bottom Height).";
    case "floorLength":
      return v > 0 ? v : "Set Floor Length over 0.";
    case "angle":
      return v > 0 && v < 90 ? rise / Math.tan((v * Math.PI) / 180) : "Set a pitch Angle over 0° and under 90°.";
    case "ratio":
      return v > 0 ? rise * v : "Set the pitch Ratio's run over 0.";
    case "percent":
      return v > 0 ? (rise * 100) / v : "Set the pitch Percent over 0.";
  }
}

/** A stage ramp coming down from the stage's edge (x = 0) along +x, centred on y = 0. */
export function stageRamp(r: StageRamp): StagePlan | string {
  if (!(r.width > 0)) return "Set the ramp's Width over 0.";
  const length = rampFloorLength(r);
  if (typeof length === "string") return length;
  const outline = box(0, -r.width / 2, length, r.width / 2);
  const legs: Legs = { ...r.legs, structure: r.structure, hideDeck: false };
  const deck = deckPlan(outline, railStrips(r, length, r.width, r.width / 2), legs);
  if (typeof deck === "string") return deck;
  travelArrow(deck, r.arrow, length, Math.min(length / 4, r.arrowSize), r.arrowSize, r.textHeight);
  return deck;
}

export interface RopeStanchion {
  readonly postDiameter: number;
  readonly base: "round" | "square";
  readonly baseWidth: number;
  readonly stringer: StringerKind;
  /** the belt's, rope's or chain's length: the furthest it reaches between stanchions */
  readonly stringerLength: number;
  readonly ropeDiameter: number;
  readonly linkLength: number;
  /** the furthest apart stanchions stand */
  readonly idealSpacing: number;
  readonly ends: EndStanchions;
}

/** A chain link lying flat: a slot `length` long and 0.4 of that wide, centred at `c` along `u`. */
function flatLink(c: Pt, u: Pt, length: number): Pt[] {
  const r = length * 0.2;
  const half = length / 2 - r;
  const out: Pt[] = [];
  for (const end of [1, -1]) {
    const o = add(c, u, end * half);
    const base = Math.atan2(u.y, u.x) + (end === 1 ? -Math.PI / 2 : Math.PI / 2);
    for (let k = 0; k <= 8; k++) {
      const t = base + (Math.PI * k) / 8;
      out.push({ x: o.x + r * Math.cos(t), y: o.y + r * Math.sin(t) });
    }
  }
  return out;
}

/**
 * Stanchions along a path of straight runs, at each corner and evenly between, no further apart
 * than the Ideal Spacing or the stringer's length, with the ends left off as `ends` says; and the
 * belts (a line), ropes (a band the rope's diameter wide) or chains (links lying flat and on edge
 * by turns) from post to post. A message when it can't draw.
 */
export function ropeAndStanchion(path: readonly Pt[], closed: boolean, r: RopeStanchion): StagePlan | string {
  const pts = path.filter((q, i) => i === 0 || dist(q, path[i - 1]) > EPS);
  if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  if (pts.length < 2) return "Click two points or more for the barrier's path.";
  if (!(r.postDiameter > 0 && r.baseWidth > 0 && r.stringerLength > 0 && r.idealSpacing > 0)) return "Set Post Diameter, Base Width, the stringer's length and Ideal Spacing over 0.";
  if (r.stringer === "rope" && !(r.ropeDiameter > 0)) return "Set Rope Diameter over 0.";
  if (r.stringer === "chain" && !(r.linkLength > 0)) return "Set Single Link Length over 0.";
  const spacing = Math.min(r.idealSpacing, r.stringerLength);
  const runs = closed ? pts.length : pts.length - 1;
  const stops: { p: Pt; u: Pt; post: boolean }[] = [];
  for (let i = 0; i < runs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const u = unit(a, b);
    const k = Math.max(1, Math.ceil(dist(a, b) / spacing - EPS));
    if (stops.length + k > MAX_STANCHIONS) return `This barrier would have more than ${MAX_STANCHIONS} stanchions: set a longer Ideal Spacing.`;
    for (let m = 0; m < k; m++) stops.push({ p: add(a, u, (dist(a, b) * m) / k), u, post: true });
  }
  if (closed) stops.push({ ...stops[0] });
  else {
    stops.push({ p: pts[pts.length - 1], u: unit(pts[pts.length - 2], pts[pts.length - 1]), post: true });
    if (r.ends === "end" || r.ends === "none") stops[0].post = false;
    if (r.ends === "start" || r.ends === "none") stops[stops.length - 1].post = false;
  }
  const plan = empty();
  const posts = closed ? stops.slice(0, -1) : stops;
  for (const s of posts.filter((s) => s.post)) {
    plan.outlines.push(r.base === "square" ? legOutline("square", r.baseWidth, s.p, s.u) : legOutline("round", r.baseWidth, s.p, s.u));
    plan.circles.push({ center: s.p, radius: r.postDiameter / 2 });
  }
  let links = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const [s, e] = [stops[i], stops[i + 1]];
    const u = unit(s.p, e.p);
    const a = add(s.p, u, s.post ? r.postDiameter / 2 : 0);
    const b = add(e.p, u, e.post ? -r.postDiameter / 2 : 0);
    const span = dist(s.p, e.p) - (s.post ? r.postDiameter / 2 : 0) - (e.post ? r.postDiameter / 2 : 0);
    if (span <= EPS) continue;
    if (r.stringer === "belt") plan.lines.push([a, b]);
    else if (r.stringer === "rope") plan.outlines.push(strip(add(a, left(u), -r.ropeDiameter / 2), add(b, left(u), -r.ropeDiameter / 2), r.ropeDiameter));
    else {
      // links overlap by a fifth of their length each end, flat and on edge by turns
      const pitch = r.linkLength * 0.6;
      const n = Math.max(1, Math.round((span - r.linkLength * 0.4) / pitch));
      links += n;
      if (links > MAX_LINKS) return `This barrier would draw more than ${MAX_LINKS} chain links: set a longer Single Link Length.`;
      const step = (span - r.linkLength * 0.4) / n;
      for (let m = 0; m < n; m++) {
        const c = add(a, u, r.linkLength * 0.2 + step * (m + 0.5));
        const half = Math.min(r.linkLength, step + r.linkLength * 0.4) / 2;
        if (m % 2 === 0) plan.outlines.push(flatLink(c, u, half * 2));
        else plan.lines.push([add(c, u, -half), add(c, u, half)]);
      }
    }
  }
  return { ...plan, count: posts.filter((s) => s.post).length };
}
