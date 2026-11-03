// A piping run's figures and path, as MEP's Piping Run and Create Piping Runs work them out: its length,
// the sections and couplings that length takes, and its turns. Kept apart from the tool so it runs
// without the page. Sizes are in mm.

import type { Pt } from "../core/index.ts";

export type PipingTurns = "bends" | "elbows";

export interface PipingRun {
  /** the conduit's diameter */
  readonly size: number;
  readonly material: string;
  readonly remarks: string;
  readonly showTag: boolean;
  /** only shown with the tag */
  readonly showRemarks: boolean;
  /** how long a section of conduit comes */
  readonly sectionLength: number;
  /** how many runs like this one to count material for */
  readonly runs: number;
  readonly turns: PipingTurns;
  /** the bends' radius */
  readonly radius: number;
}

export interface PipingFigures {
  /** the run's own length, its bends included */
  readonly length: number;
  /** sections and couplings for all the runs */
  readonly sections: number;
  readonly couplings: number;
  /** elbows for all the runs; 0 when bending */
  readonly elbows45: number;
  readonly elbows90: number;
}

/** a turn under this is the run going on, not a corner: half of the smallest elbow */
const MIN_TURN = Math.PI / 8;
const NEAR = 1e-6;

/** The path's corners, without a repeated last point. */
function corners(points: readonly Pt[], closed: boolean): Pt[] {
  const out = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > NEAR);
  if (closed && out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= NEAR) out.pop();
  return out;
}

/** The turn at each point, radians, 0 at an open path's ends. */
function turnsOf(pts: readonly Pt[], closed: boolean): number[] {
  const n = pts.length;
  return pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return 0;
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const d = Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x);
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  });
}

/**
 * The radius each point bends at: the run's at a corner, less where its segments are too short to
 * hold it, and 0 for no bend. A U-turn can't be bent, so it stays a corner.
 */
export function bendRadii(points: readonly Pt[], closed: boolean, radius: number): number[] {
  const pts = corners(points, closed);
  const n = pts.length;
  const turns = turnsOf(pts, closed);
  const seg = (i: number): number => Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
  return turns.map((turn, i) => {
    if (turn < MIN_TURN || Math.PI - turn < 1e-3 || radius <= 0) return 0;
    const tan = Math.tan(turn / 2);
    return Math.min(radius, Math.min(seg((i + n - 1) % n), seg(i)) / 2 / tan);
  });
}

/** A run's length, its bends' arcs in place of their corners when it bends. */
export function runLength(points: readonly Pt[], closed: boolean, run: Pick<PipingRun, "turns" | "radius">): number {
  const pts = corners(points, closed);
  const n = pts.length;
  let length = 0;
  for (let i = 0; i < (closed ? n : n - 1); i++) length += Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
  if (run.turns !== "bends") return length;
  const turns = turnsOf(pts, closed);
  bendRadii(pts, closed, run.radius).forEach((r, i) => {
    if (r > 0) length += r * turns[i] - 2 * r * Math.tan(turns[i] / 2);
  });
  return length;
}

/** What the run takes. A turn counts as the elbows nearest it: 135° is a 90 and a 45. */
export function pipingFigures(points: readonly Pt[], closed: boolean, run: PipingRun): PipingFigures {
  const pts = corners(points, closed);
  const length = runLength(pts, closed, run);
  const perRun = Math.max(1, Math.ceil(length / run.sectionLength - 1e-9));
  let elbows45 = 0;
  let elbows90 = 0;
  if (run.turns === "elbows") {
    for (const turn of turnsOf(pts, closed)) {
      if (turn < MIN_TURN) continue;
      const fortyFives = Math.round(turn / (Math.PI / 4));
      elbows90 += Math.floor(fortyFives / 2);
      elbows45 += fortyFives % 2;
    }
  }
  return { length, sections: perRun * run.runs, couplings: (perRun - 1) * run.runs, elbows45: elbows45 * run.runs, elbows90: elbows90 * run.runs };
}

/** Where a tag goes: the middle of the longest straight, and the angle along it, kept upright, radians. */
export function tagPlace(points: readonly Pt[], closed: boolean): { readonly at: Pt; readonly angle: number } | null {
  const pts = corners(points, closed);
  const n = pts.length;
  if (n < 2) return null;
  let best = 0;
  let longest = -1;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const l = Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
    if (l > longest) {
      longest = l;
      best = i;
    }
  }
  const a = pts[best];
  const b = pts[(best + 1) % n];
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2 + NEAR) angle -= Math.PI;
  else if (angle <= -Math.PI / 2 + NEAR) angle += Math.PI;
  return { at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle };
}

/** The same path with no repeats, for drawing. */
export const runPoints = corners;
