// What Building Shell's Elevator, Escalator, Ramp and Simple Stair tools (tools/circulation.ts)
// draw in plan, as plain geometry in each one's own frame: an elevator's hoistway, cab and door
// leaves; an escalator's truss, steps, handrails and balustrades, its pit and the headroom opening
// above it; and the flights and landings of a ramp or a stair with their treads, stringers, rails
// and path-of-travel arrow. A section cut ends what's drawn at a slanted break line. Kept apart
// from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { breakLine } from "./detailShapes.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

/** The rectangle from (x0, y0) to (x1, y1), anticlockwise. */
function box(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const mirrorY = (p: Pt): Pt => ({ x: p.x, y: -p.y });

/** a door leaf's thickness, mm */
export const LEAF = 25;

export type ElevatorDoors = "none" | "cab" | "both";
export type ElevatorDoorType = "single" | "bipass" | "bipart" | "bipart2";

/** An elevator's settings, in millimetres. */
export interface Elevator {
  readonly hoistwayWidth: number;
  readonly hoistwayDepth: number;
  /** the front's doors: the cab's alone, or the cab's and the hoistway wall's */
  readonly front: Exclude<ElevatorDoors, "none">;
  readonly rear: ElevatorDoors;
  readonly doorType: ElevatorDoorType;
  readonly doorWidth: number;
  /** the opening's offset to the right of the cab's middle */
  readonly doorOffset: number;
  readonly cab: boolean;
  readonly cabWidth: number;
  readonly cabDepth: number;
  readonly cabWall: number;
  /** the cab's offset to the right of the hoistway's middle */
  readonly cabOffset: number;
  /** from the hoistway's front to the cab's */
  readonly clearance: number;
}

/** Each side's leaves (the layers stacked behind each other) and how wide each leaf is, as a share of the opening. */
const DOOR_TYPES: Record<ElevatorDoorType, { readonly sides: readonly (-1 | 1)[]; readonly layers: number; readonly share: number }> = {
  single: { sides: [-1], layers: 1, share: 1 },
  bipass: { sides: [-1], layers: 2, share: 1 / 2 },
  bipart: { sides: [-1, 1], layers: 1, share: 1 / 2 },
  bipart2: { sides: [-1, 1], layers: 2, share: 1 / 4 },
};

/** Why an elevator can't be drawn, or null when it can. */
export function elevatorProblem(e: Elevator): string | null {
  const sizes = [e.hoistwayWidth, e.hoistwayDepth, e.doorWidth, e.cabWidth, e.cabDepth, e.cabWall];
  if (!sizes.every((v) => v > 0) || !(e.clearance >= 0)) return "The hoistway, cab and door need sizes more than 0.";
  const w = e.hoistwayWidth / 2;
  if (Math.abs(e.cabOffset) + e.cabWidth / 2 + e.cabWall > w || e.clearance + e.cabDepth + 2 * e.cabWall > e.hoistwayDepth) return "The cab doesn't fit in the hoistway: make the hoistway larger or the cab smaller.";
  if (Math.abs(e.doorOffset) + e.doorWidth / 2 > e.cabWidth / 2) return "The door opening is wider than the cab's inside, or offset past it.";
  const t = DOOR_TYPES[e.doorType];
  const c = e.cabOffset + e.doorOffset;
  const leaf = t.share * e.doorWidth;
  const reach = Math.max(...t.sides.map((s) => Math.abs(c + s * (e.doorWidth / 2 + leaf))));
  if (reach > w) return "The doors open past the hoistway's side: make the hoistway wider, the door narrower or offset it.";
  if (e.cab && e.clearance < t.layers * LEAF) return `The front cab clearance must leave room for the cab door's leaves (${t.layers * LEAF} mm).`;
  if (e.cab && e.rear !== "none" && e.hoistwayDepth - e.clearance - e.cabDepth - 2 * e.cabWall < t.layers * LEAF) return `The space behind the cab must leave room for the rear cab door's leaves (${t.layers * LEAF} mm).`;
  return null;
}

/**
 * An elevator in plan with the middle of its hoistway's front on the origin and the hoistway to −y:
 * the hoistway; the cab's walls with the openings its doors leave, crossed inside, when shown; and
 * each door's leaves standing open beside its opening, the cab's in front of the cab and the wall's
 * just outside the hoistway. Null when elevatorProblem finds a problem.
 */
export function elevator(e: Elevator): MarkerDrawing | null {
  if (elevatorProblem(e)) return null;
  const w = e.hoistwayWidth / 2;
  const t = DOOR_TYPES[e.doorType];
  const c = e.cabOffset + e.doorOffset;
  const half = e.doorWidth / 2;
  const leaf = t.share * e.doorWidth;
  const outlines: Pt[][] = [box(-w, -e.hoistwayDepth, w, 0)];
  const lines: Pt[][] = [];
  /** the leaves standing open beside the opening, stacked from `face` toward `dir` */
  const leaves = (face: number, dir: 1 | -1): Pt[][] =>
    t.sides.flatMap((s) =>
      Array.from({ length: t.layers }, (_, k) => {
        const x0 = c + s * half;
        const y0 = face + dir * k * LEAF;
        return box(Math.min(x0, x0 + s * leaf), Math.min(y0, y0 + dir * LEAF), Math.max(x0, x0 + s * leaf), Math.max(y0, y0 + dir * LEAF));
      }),
    );
  // the cab, its outside from xo0 to xo1 and yb (back) to yf (front), its inside xi0 to xi1, yib to yif
  const xi0 = e.cabOffset - e.cabWidth / 2;
  const xi1 = e.cabOffset + e.cabWidth / 2;
  const xo0 = xi0 - e.cabWall;
  const xo1 = xi1 + e.cabWall;
  const yf = -e.clearance;
  const yif = yf - e.cabWall;
  const yib = yif - e.cabDepth;
  const yb = yib - e.cabWall;
  if (e.cab) {
    const l = c - half;
    const r = c + half;
    if (e.rear === "none") {
      outlines.push([
        { x: r, y: yf },
        { x: xo1, y: yf },
        { x: xo1, y: yb },
        { x: xo0, y: yb },
        { x: xo0, y: yf },
        { x: l, y: yf },
        { x: l, y: yif },
        { x: xi0, y: yif },
        { x: xi0, y: yib },
        { x: xi1, y: yib },
        { x: xi1, y: yif },
        { x: r, y: yif },
      ]);
    } else {
      // openings front and back split the walls in two
      outlines.push(
        [
          { x: r, y: yf },
          { x: xo1, y: yf },
          { x: xo1, y: yb },
          { x: r, y: yb },
          { x: r, y: yib },
          { x: xi1, y: yib },
          { x: xi1, y: yif },
          { x: r, y: yif },
        ],
        [
          { x: l, y: yf },
          { x: l, y: yif },
          { x: xi0, y: yif },
          { x: xi0, y: yib },
          { x: l, y: yib },
          { x: l, y: yb },
          { x: xo0, y: yb },
          { x: xo0, y: yf },
        ],
      );
    }
    lines.push(
      [
        { x: xi0, y: yib },
        { x: xi1, y: yif },
      ],
      [
        { x: xi0, y: yif },
        { x: xi1, y: yib },
      ],
    );
    outlines.push(...leaves(yf, 1));
    if (e.rear !== "none") outlines.push(...leaves(yb, -1));
  }
  if (e.front === "both") outlines.push(...leaves(0, 1));
  if (e.rear === "both") outlines.push(...leaves(-e.hoistwayDepth, -1));
  return { outlines, lines, circles: [], filled: [], texts: [] };
}

// A slanted section cut: in a run's frame (s along it from `start`, t across it to the left) the
// cut line crosses at s = at + CUT_SLANT · t, a break line drawn along it.

/** the cut line's run along the flight for each unit across it: a 60° cut */
const CUT_SLANT = Math.tan(Math.PI / 6);
/** where plans cut stairs, ramps and escalators, mm above the floor */
export const CUT_HEIGHT = 1200;

/** A run's frame: where it starts, its direction and the normal to its left. */
interface Frame {
  readonly start: Pt;
  readonly u: Pt;
}

const frameAt = (f: Frame, s: number, t: number): Pt => ({ x: f.start.x + f.u.x * s - f.u.y * t, y: f.start.y + f.u.y * s + f.u.x * t });

/** How far past the cut a point lies (positive beyond it), in `f`'s frame cut at `at`. */
function beyondCut(f: Frame, at: number, p: Pt): number {
  const dx = p.x - f.start.x;
  const dy = p.y - f.start.y;
  const s = dx * f.u.x + dy * f.u.y;
  const t = -dx * f.u.y + dy * f.u.x;
  return s - at - CUT_SLANT * t;
}

/** The part of a closed outline where `side` is at most 0 (Sutherland–Hodgman); null when none is. */
function clipOutline(pts: readonly Pt[], side: (p: Pt) => number): Pt[] | null {
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const a = side(p);
    const b = side(q);
    if (a <= 0) out.push(p);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const k = a / (a - b);
      out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    }
  });
  return out.length >= 3 ? out : null;
}

/** The pieces of an open line where `side` is at most 0. */
function clipLine(pts: readonly Pt[], side: (p: Pt) => number): Pt[][] {
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  pts.forEach((p, i) => {
    const a = side(p);
    if (i > 0) {
      const q = pts[i - 1];
      const b = side(q);
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
        const k = b / (b - a);
        const x = { x: q.x + (p.x - q.x) * k, y: q.y + (p.y - q.y) * k };
        cur.push(x);
        if (b <= 0) {
          pieces.push(cur);
          cur = [];
        } else cur = [x];
      }
    }
    if (a <= 0) cur.push(p);
    else if (cur.length) {
      if (cur.length >= 2) pieces.push(cur);
      cur = [];
    }
  });
  if (cur.length >= 2) pieces.push(cur);
  return pieces.filter((piece) => piece.length >= 2);
}

/** A drawing cut by `side` (its outlines and lines kept where side ≤ 0; filled shapes and texts kept whole when on that side). */
function clipDrawing(d: MarkerDrawing, side: (p: Pt) => number): MarkerDrawing {
  return {
    outlines: d.outlines.map((o) => clipOutline(o, side)).filter((o): o is Pt[] => o !== null),
    lines: d.lines.flatMap((l) => clipLine(l, side)),
    circles: d.circles.filter((c) => side(c.center) <= 0),
    filled: d.filled.filter((f) => f.every((p) => side(p) <= 0)),
    texts: d.texts.filter((t) => side(t.at) <= 0),
  };
}

/** The break line along the cut across a run `width` wide, reaching a tenth of it past each side. */
function cutBreak(f: Frame, at: number, width: number): Pt[] | null {
  const t = 0.6 * width;
  return breakLine(frameAt(f, at - CUT_SLANT * t, -t), frameAt(f, at + CUT_SLANT * t, t), width / 5);
}

const merge = (...ds: MarkerDrawing[]): MarkerDrawing => ({
  outlines: ds.flatMap((d) => d.outlines),
  lines: ds.flatMap((d) => d.lines),
  circles: ds.flatMap((d) => d.circles),
  filled: ds.flatMap((d) => d.filled),
  texts: ds.flatMap((d) => d.texts),
});

const empty = (): MarkerDrawing => ({ outlines: [], lines: [], circles: [], filled: [], texts: [] });

export type EscalatorCut = "up" | "down" | "none";
export type Balustrade = "glass" | "solid";

/** An escalator's settings, in millimetres and degrees. */
export interface Escalator {
  /** floor to floor */
  readonly height: number;
  readonly slope: number;
  readonly stepWidth: number;
  /** level steps at each end before the incline */
  readonly leadIn: number;
  readonly balustrade: Balustrade;
  readonly cut: EscalatorCut;
  /** the upper floor's depth, floor to ceiling below it */
  readonly floorDepth: number;
  readonly pit: boolean;
  readonly headroom: boolean;
}

/** a step's depth, mm */
export const STEP_DEPTH = 400;
/** each end's landing (comb) plate before the first step, mm */
export const LANDING_PLATE = 900;
/** the clear height wanted over the steps, mm */
export const HEADROOM = 2300;
/** the truss's depth below the steps, for how far its pit reaches, mm */
const TRUSS_DEPTH = 1000;
/** how far the pit reaches past the truss's sides and end, mm */
const PIT_MARGIN = 100;
/** a balustrade's width beside the steps, where its handrail's middle runs, and the balustrade's own thickness, mm */
const BALUSTRADES: Record<Balustrade, { readonly side: number; readonly rail: number; readonly thickness: number }> = {
  glass: { side: 300, rail: 120, thickness: 12 },
  solid: { side: 350, rail: 160, thickness: 150 },
};
/** a handrail's width, and how far it runs past the landing plate's inner edge, mm */
const HANDRAIL = 80;
const HANDRAIL_PAST = 300;
/** points round each end of a handrail */
const RAIL_END_STEPS = 8;

/** A handrail's outline from x0 to x1 along y = yc: straight sides with half-round ends. */
function handrail(x0: number, x1: number, yc: number): Pt[] {
  const r = HANDRAIL / 2;
  const pts: Pt[] = [];
  for (let k = 0; k <= RAIL_END_STEPS; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / RAIL_END_STEPS;
    pts.push({ x: x1 + r * Math.cos(a), y: yc + r * Math.sin(a) });
  }
  for (let k = 0; k <= RAIL_END_STEPS; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / RAIL_END_STEPS;
    pts.push({ x: x0 + r * Math.cos(a), y: yc + r * Math.sin(a) });
  }
  return pts;
}

/**
 * An escalator in plan with the middle of its bottom end on the origin, rising toward +x: its truss,
 * the landing plates' edges, a line across the steps at each step's front, the step band's sides,
 * each side's balustrade and handrail; cut Up (the part below the cut height, as the lower floor's
 * plan shows it) or Down (the part above it) at a break line. Show Pit adds the pit under its
 * bottom end, Show Headroom the opening the upper floor needs over it (where the steps come within
 * HEADROOM of the upper floor's underside). Null when it has no height or its slope is out of range.
 */
export function escalator(e: Escalator): MarkerDrawing | null {
  if (!(e.height > 0) || !(e.slope > 0 && e.slope < 90) || !(e.stepWidth > 0) || !(e.leadIn >= 0) || !(e.floorDepth >= 0)) return null;
  const tan = Math.tan((e.slope * Math.PI) / 180);
  const sin = Math.sin((e.slope * Math.PI) / 180);
  const b = BALUSTRADES[e.balustrade];
  const sw = e.stepWidth / 2;
  const half = sw + b.side;
  const lower = LANDING_PLATE + e.leadIn * STEP_DEPTH;
  const run = e.height / tan;
  const length = 2 * lower + run;
  const end = length - LANDING_PLATE;
  const lines: Pt[][] = [];
  for (let x = LANDING_PLATE; x <= end + 1e-6; x += STEP_DEPTH)
    lines.push([
      { x, y: -sw },
      { x, y: sw },
    ]);
  if (Math.abs(lines[lines.length - 1][0].x - end) > 1e-6)
    lines.push([
      { x: end, y: -sw },
      { x: end, y: sw },
    ]);
  for (const s of [-1, 1])
    lines.push([
      { x: LANDING_PLATE, y: s * sw },
      { x: end, y: s * sw },
    ]);
  const outlines: Pt[][] = [box(0, -half, length, half)];
  for (const s of [-1, 1]) {
    const rail = s * (sw + b.rail);
    outlines.push(box(LANDING_PLATE - HANDRAIL_PAST, rail - b.thickness / 2, end + HANDRAIL_PAST, rail + b.thickness / 2));
    outlines.push(handrail(LANDING_PLATE - HANDRAIL_PAST, end + HANDRAIL_PAST, rail));
  }
  let d: MarkerDrawing = { outlines, lines, circles: [], filled: [], texts: [] };
  const cutAt = lower + CUT_HEIGHT / tan;
  if (e.cut !== "none" && cutAt < lower + run) {
    const f: Frame = { start: { x: 0, y: 0 }, u: { x: 1, y: 0 } };
    const side = (p: Pt): number => (e.cut === "up" ? 1 : -1) * beyondCut(f, cutAt, p);
    d = clipDrawing(d, side);
    const brk = cutBreak(f, cutAt, 2 * half);
    if (brk) d.lines.push(brk);
  }
  if (e.pit) d.outlines.unshift(box(-PIT_MARGIN, -half - PIT_MARGIN, lower + TRUSS_DEPTH / sin, half + PIT_MARGIN));
  const opening = lower + Math.max(0, e.height - e.floorDepth - HEADROOM) / tan;
  if (e.headroom && opening < lower + run) d.outlines.unshift(box(opening, -half - PIT_MARGIN, lower + run, half + PIT_MARGIN));
  return d;
}

export type FlightConfig = "straight" | "landing" | "left" | "right" | "backLeft" | "backRight";

/** A flight: its frame (its middle line's start and direction) and its length. */
export interface Flight extends Frame {
  readonly length: number;
}

/** Flights and the landing between them, with the path of travel along their middles. */
export interface FlightLayout {
  readonly flights: Flight[];
  readonly landing: Pt[] | null;
  readonly path: Pt[];
}

/** points along a curved landing's arc */
const LANDING_ARC_STEPS = 16;

const arcPoints = (c: Pt, r: number, from: number, to: number): Pt[] =>
  Array.from({ length: LANDING_ARC_STEPS + 1 }, (_, k) => {
    const a = from + ((to - from) * k) / LANDING_ARC_STEPS;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });

/**
 * The flights of a run `width` wide from the origin toward +x: one flight `run1 + run2` long
 * (straight), or `run1`, a landing and `run2`: straight on, turning left or right (the second
 * flight flush with the landing's far side), or doubling back left or right beside the first,
 * `separation` apart. The landing is as long as the width plus `offset1` along the first flight;
 * a turning one reaches `offset2` further toward the turn. A curved landing rounds its outer side:
 * a quarter circle the width in radius on a turn, a half circle doubling back.
 */
export function layoutFlights(
  config: FlightConfig,
  width: number,
  run1: number,
  run2: number,
  offset1: number,
  offset2: number,
  separation: number,
  curved: boolean,
): FlightLayout {
  const h = width / 2;
  const x = { x: 1, y: 0 };
  if (config === "straight")
    return {
      flights: [{ start: { x: 0, y: 0 }, u: x, length: run1 + run2 }],
      landing: null,
      path: [
        { x: 0, y: 0 },
        { x: run1 + run2, y: 0 },
      ],
    };
  const far = run1 + width + offset1;
  if (config === "landing")
    return {
      flights: [
        { start: { x: 0, y: 0 }, u: x, length: run1 },
        { start: { x: far, y: 0 }, u: x, length: run2 },
      ],
      landing: box(run1, -h, far, h),
      path: [
        { x: 0, y: 0 },
        { x: far + run2, y: 0 },
      ],
    };
  const mirror = config === "right" || config === "backRight";
  let layout: FlightLayout;
  if (config === "left" || config === "right") {
    const x2 = far - h;
    const top = h + offset2;
    // the arc is the width in radius unless the landing is shorter
    const r = Math.min(width, far - run1);
    const landing = curved
      ? [{ x: run1, y: top }, { x: run1, y: -h }, ...arcPoints({ x: far - r, y: -h + r }, r, -Math.PI / 2, 0), { x: far, y: top }]
      : box(run1, -h, far, top);
    layout = {
      flights: [
        { start: { x: 0, y: 0 }, u: x, length: run1 },
        { start: { x: x2, y: top }, u: { x: 0, y: 1 }, length: run2 },
      ],
      landing,
      path: [
        { x: 0, y: 0 },
        { x: x2, y: 0 },
        { x: x2, y: top + run2 },
      ],
    };
  } else {
    const y2 = width + separation;
    const turn = run1 + (width + offset1) / 2;
    const landing = curved
      ? [{ x: run1, y: y2 + h }, { x: run1, y: -h }, ...arcPoints({ x: run1 + Math.max(0, offset1), y: y2 / 2 }, y2 / 2 + h, -Math.PI / 2, Math.PI / 2)]
      : box(run1, -h, far, y2 + h);
    layout = {
      flights: [
        { start: { x: 0, y: 0 }, u: x, length: run1 },
        { start: { x: run1, y: y2 }, u: { x: -1, y: 0 }, length: run2 },
      ],
      landing,
      path: [
        { x: 0, y: 0 },
        { x: turn, y: 0 },
        { x: turn, y: y2 },
        { x: run1 - run2, y: y2 },
      ],
    };
  }
  if (!mirror) return layout;
  return {
    flights: layout.flights.map((f) => ({ start: mirrorY(f.start), u: mirrorY(f.u), length: f.length })),
    landing: layout.landing && layout.landing.map(mirrorY).reverse(),
    path: layout.path.map(mirrorY),
  };
}

/** How far along `path` its nearest point to `p` lies. */
function alongPath(path: readonly Pt[], p: Pt): number {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const k = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const d = Math.hypot(a.x + (b.x - a.x) * k - p.x, a.y + (b.y - a.y) * k - p.y);
    if (d < best) {
      best = d;
      at = walked + k * len;
    }
    walked += len;
  }
  return at;
}

/** `path` from its start to `length` along it. */
function pathUntil(path: readonly Pt[], length: number): Pt[] {
  const out: Pt[] = [path[0]];
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (walked + len >= length) {
      const k = len > 0 ? (length - walked) / len : 0;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      return out;
    }
    out.push(b);
    walked += len;
  }
  return out;
}

export type TravelArrow = "none" | "up" | "down";

/** a rail's inset from a flight's side, mm */
const RAIL_INSET = 50;

/** What a ramp's or stair's run draws besides its flights' outlines, sizes in drawing units. */
interface RunLook {
  readonly width: number;
  /** each flight's tread depth and its tread count, or null for a ramp */
  readonly treads: readonly { readonly depth: number; readonly count: number }[] | null;
  readonly stringerWidth: number;
  readonly stringerOffset: number;
  readonly leftRail: boolean;
  readonly rightRail: boolean;
  readonly railWidth: number;
  readonly arrow: TravelArrow;
  /** each flight's label along its middle, or none */
  readonly labels: readonly string[];
  readonly textHeight: number;
  /** where the cut crosses: the flight and how far along it; null for no break */
  readonly cut: { readonly flight: number; readonly at: number } | null;
}

/** A filled arrowhead with its tip at `tip`, pointing from `from`. */
function arrowhead(from: Pt, tip: Pt, length: number): Pt[] {
  const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const u = { x: (tip.x - from.x) / d, y: (tip.y - from.y) / d };
  const base = { x: tip.x - u.x * length, y: tip.y - u.y * length };
  const w = length / 3;
  return [tip, { x: base.x - u.y * w, y: base.y + u.x * w }, { x: base.x + u.y * w, y: base.y - u.x * w }];
}

/** A run's flights drawn: outlines, treads, stringers, rails, the landing, the arrow and labels, cut at its break. */
function drawRun(layout: FlightLayout, look: RunLook): MarkerDrawing {
  const h = look.width / 2;
  const cut = look.cut;
  const parts: MarkerDrawing[] = [];
  layout.flights.forEach((f, i) => {
    if (cut && i > cut.flight) return;
    const d = empty();
    if (f.length > 0) {
      const rect = (s0: number, t0: number, s1: number, t1: number): Pt[] => [frameAt(f, s0, t0), frameAt(f, s1, t0), frameAt(f, s1, t1), frameAt(f, s0, t1)];
      d.outlines.push(rect(0, -h, f.length, h));
      const treads = look.treads?.[i];
      if (treads) for (let k = 1; k < treads.count; k++) d.lines.push([frameAt(f, k * treads.depth, -h), frameAt(f, k * treads.depth, h)]);
      if (look.stringerWidth > 0)
        for (const s of [-1, 1]) {
          const outer = h + look.stringerOffset;
          d.outlines.push(rect(0, s * outer, f.length, s * (outer - look.stringerWidth)));
        }
      const rails = [look.rightRail ? -1 : 0, look.leftRail ? 1 : 0].filter((s) => s !== 0);
      for (const s of rails) d.outlines.push(rect(0, s * (h - RAIL_INSET), f.length, s * (h - RAIL_INSET - look.railWidth)));
      const label = look.labels[i];
      if (label) {
        const deg = (Math.atan2(f.u.y, f.u.x) * 180) / Math.PI;
        d.texts.push({ at: frameAt(f, f.length / 2, 0.9 * look.textHeight), text: label, height: look.textHeight, justify: "centre", angle: deg });
      }
    }
    if (cut && i === cut.flight) {
      parts.push(clipDrawing(d, (p) => beyondCut(f, cut.at, p)));
      const brk = cutBreak(f, cut.at, look.width);
      if (brk) parts.push({ ...empty(), lines: [brk] });
    } else parts.push(d);
  });
  if (layout.landing && !(cut && cut.flight === 0)) parts.unshift({ ...empty(), outlines: [layout.landing] });
  if (look.arrow !== "none") {
    const cf = cut && layout.flights[cut.flight];
    const path = cut && cf ? pathUntil(layout.path, alongPath(layout.path, frameAt(cf, cut.at, 0))) : layout.path;
    if (path.length >= 2) {
      const head = 1.5 * look.textHeight;
      const tip = look.arrow === "up" ? path.length - 1 : 0;
      const from = look.arrow === "up" ? path.length - 2 : 1;
      parts.push({ ...empty(), lines: [path], filled: [arrowhead(path[from], path[tip], head)] });
    }
  }
  return merge(...parts);
}

/** A ramp's settings, in millimetres; its slope is rise over run. */
export interface Ramp {
  readonly width: number;
  readonly height: number;
  readonly slope: number;
  readonly config: FlightConfig;
  readonly landingHeight: number;
  readonly offset1: number;
  readonly offset2: number;
  readonly curved: boolean;
  readonly stairBreak: boolean;
  readonly leftRail: boolean;
  readonly rightRail: boolean;
  readonly railWidth: number;
  readonly arrow: TravelArrow;
  readonly textHeight: number;
}

/** Why a ramp can't be drawn, or null when it can. */
export function rampProblem(r: Ramp): string | null {
  if (!(r.width > 0) || !(r.height > 0) || !(r.slope > 0 && r.slope <= 1)) return "The ramp needs a width and height more than 0 and a rise over run more than 0 and at most 1.";
  if (r.config !== "straight" && !(r.landingHeight > 0 && r.landingHeight < r.height)) return "The landing's height must be between the floor and the ramp's top.";
  if (r.offset1 < -r.width / 2 || r.offset2 < 0) return "Offset 1 can shorten the landing by half the width at most, and Offset 2 can't be negative.";
  if ((r.leftRail || r.rightRail) && !(r.railWidth > 0 && r.railWidth + RAIL_INSET < r.width / 2)) return "The rails must fit inside half the ramp's width.";
  return null;
}

/**
 * A ramp in plan with the middle of its bottom on the origin, rising toward +x: its flights (their
 * runs the heights each climbs over the slope) and landing, its rails, and the path-of-travel arrow;
 * with a stair break, it ends at a break line where it rises past the cut height. Null when
 * rampProblem finds a problem.
 */
export function ramp(r: Ramp): MarkerDrawing | null {
  if (rampProblem(r)) return null;
  const straight = r.config === "straight";
  const run1 = (straight ? r.height : r.landingHeight) / r.slope;
  const run2 = straight ? 0 : (r.height - r.landingHeight) / r.slope;
  const layout = layoutFlights(r.config, r.width, run1, run2, r.offset1, r.offset2, 0, r.curved);
  let cut: RunLook["cut"] = null;
  if (r.stairBreak && r.height > CUT_HEIGHT) {
    const first = straight ? r.height : r.landingHeight;
    cut = first > CUT_HEIGHT ? { flight: 0, at: CUT_HEIGHT / r.slope } : { flight: 1, at: (CUT_HEIGHT - first) / r.slope };
  }
  return drawRun(layout, {
    width: r.width,
    treads: null,
    stringerWidth: 0,
    stringerOffset: 0,
    leftRail: r.leftRail,
    rightRail: r.rightRail,
    railWidth: r.railWidth,
    arrow: r.arrow,
    labels: [],
    textHeight: r.textHeight,
    cut,
  });
}

export type StairConfig = FlightConfig | "backLeftOdd" | "backRightOdd";

/** A simple stair's settings, in millimetres. */
export interface SimpleStair {
  readonly width: number;
  readonly height: number;
  readonly maxRiser: number;
  readonly tread: number;
  readonly config: StairConfig;
  /** the risers before the landing, except doubling back evenly */
  readonly landingTread: number;
  readonly separation: number;
  readonly offset1: number;
  readonly offset2: number;
  readonly curved: boolean;
  readonly stringerWidth: number;
  readonly stringerOffset: number;
  readonly lowerBreak: boolean;
  readonly showData: boolean;
  readonly topTread: boolean;
  readonly leftRail: boolean;
  readonly rightRail: boolean;
  readonly railWidth: number;
  readonly arrow: TravelArrow;
  readonly textHeight: number;
}

/** most risers a simple stair takes */
export const MAX_RISERS = 200;

/** The stair's risers and each flight's share of them. */
export function stairRisers(s: SimpleStair): { readonly risers: number; readonly flights: number[] } {
  const risers = Math.ceil(s.height / s.maxRiser - 1e-9);
  if (s.config === "straight") return { risers, flights: [risers] };
  if (s.config === "backLeft" || s.config === "backRight") return { risers, flights: [Math.ceil(risers / 2), Math.floor(risers / 2)] };
  return { risers, flights: [s.landingTread, risers - s.landingTread] };
}

/** Why a simple stair can't be drawn, or null when it can. */
export function simpleStairProblem(s: SimpleStair): string | null {
  if (!(s.width > 0) || !(s.height > 0) || !(s.maxRiser > 0) || !(s.tread > 0)) return "The stair needs a width, height, maximum riser and tread depth more than 0.";
  const { risers, flights } = stairRisers(s);
  if (risers > MAX_RISERS) return `That makes ${risers} risers; a simple stair takes ${MAX_RISERS} at most.`;
  if (flights.length > 1 && !flights.every((n) => n >= 1)) return `The landing must come after 1 to ${risers - 1} risers (Landing Tread).`;
  if (s.separation < 0 || s.offset1 < -s.width / 2 || s.offset2 < 0) return "The separation and Offset 2 can't be negative, and Offset 1 can shorten the landing by half the width at most.";
  if (s.stringerWidth < 0 || s.stringerOffset < 0 || s.stringerWidth > s.width / 2 + s.stringerOffset) return "The stringers must fit the stair: a width and offset of at least 0, the width within half the stair's.";
  if ((s.leftRail || s.rightRail) && !(s.railWidth > 0 && s.railWidth + RAIL_INSET < s.width / 2)) return "The rails must fit inside half the stair's width.";
  return null;
}

/**
 * A simple stair in plan with the middle of its first riser on the origin, rising toward +x: the
 * risers its height takes at the maximum riser, each flight's treads (one fewer than its risers, the
 * last flight's top tread drawn when asked), its landing, stringers and rails, and the path-of-travel
 * arrow with each flight's risers and riser height ("UP 9 R at 175") when Show Data is on. A lower
 * stair break ends it at a break line on the tread the cut height reaches. Null when
 * simpleStairProblem finds a problem.
 */
export function simpleStair(s: SimpleStair, riserText: (mm: number) => string): MarkerDrawing | null {
  if (simpleStairProblem(s)) return null;
  const { risers, flights } = stairRisers(s);
  const riser = s.height / risers;
  const treads = flights.map((n, i) => ({ depth: s.tread, count: n - 1 + (i === flights.length - 1 && s.topTread ? 1 : 0) }));
  const runs = treads.map((t) => t.count * t.depth);
  const config: FlightConfig = s.config === "backLeftOdd" ? "backLeft" : s.config === "backRightOdd" ? "backRight" : s.config;
  const layout = layoutFlights(config, s.width, runs[0], runs[1] ?? 0, s.offset1, s.offset2, s.separation, s.curved);
  // the break crosses the middle of the tread the cut height reaches: on the first flight, or past
  // the landing on the second
  let cut: RunLook["cut"] = null;
  const cutRiser = Math.ceil(CUT_HEIGHT / riser);
  if (s.lowerBreak && cutRiser < risers) {
    const first = flights[0];
    cut = cutRiser < first || config === "straight" ? { flight: 0, at: (cutRiser - 0.5) * s.tread } : { flight: 1, at: Math.max(cutRiser - first - 0.5, 0.5) * s.tread };
  }
  const dir = s.arrow === "down" ? "DN" : "UP";
  const labels = s.showData && s.arrow !== "none" ? (config === "straight" ? [`${dir} ${risers} R at ${riserText(riser)}`] : flights.map((n) => `${dir} ${n} R at ${riserText(riser)}`)) : [];
  return drawRun(layout, {
    width: s.width,
    treads,
    stringerWidth: s.stringerWidth,
    stringerOffset: s.stringerOffset,
    leftRail: s.leftRail,
    rightRail: s.rightRail,
    railWidth: s.railWidth,
    arrow: s.arrow,
    labels,
    textHeight: s.textHeight,
    cut,
  });
}

