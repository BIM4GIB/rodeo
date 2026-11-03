// Scene changes for a set, as geometry: each piece's pose (its reference point and turn) in each scene,
// the poses on the way from one scene to the next, where pieces would hit each other on the way, what
// moves in each change, and where the tape goes. Pieces are taken as their footprint rectangles (the
// bounding box a piece had when it was added). Pure: no drawing, no store; scenesData.ts does the edits.

import type { Affine, Pt } from "../../../core/index.ts";
import { toStage, type StageFrame, type StagePoint, stageText } from "../stage.ts";

/** Where a piece is in a scene: its reference point and turn (degrees, counter-clockwise), and whether it is flown out. */
export interface Pose {
  x: number;
  y: number;
  deg: number;
  out?: boolean;
}

/** A piece of the set: its footprint at the base pose (w along its own x, h along y), the base pose itself. */
export interface Piece {
  id: string;
  name: string;
  w: number;
  h: number;
  x0: number;
  y0: number;
  deg0: number;
}

/** A scene: each piece's pose in it, and its spike colour ("#rrggbb"). */
export interface Scene {
  id: string;
  name: string;
  note: string;
  color: string;
  poses: Record<string, Pose>;
}

export interface SceneData {
  pieces: Piece[];
  scenes: Scene[];
  current: string | null;
}

/** Two pieces that collide on the way from one scene to the other: the first sample they touch, 0 to 1. */
export interface Clash {
  a: string;
  b: string;
  t: number;
}

/** One piece's change between two scenes, as the shift plot lists it. */
export interface DiffRow {
  id: string;
  piece: string;
  from: string;
  to: string;
  distanceMm: number;
  turnDeg: number;
  action: string;
  crew: number;
  seconds: number;
}

/** A piece's footprint corners on stage, counter-clockwise from its bottom-left. */
export interface Spike {
  id: string;
  name: string;
  corners: StagePoint[];
}

/** Samples along a change for the collision test. */
export const SAMPLES = 24;
/** A move shorter than this is not reported, mm. */
const MOVE_MM = 1;
/** A stage leg of a move shorter than this is not named, mm. */
const LEG_MM = 0.5;
/** A turn smaller than this is not reported, degrees. */
const TURN_DEG = 0.5;
/** Walking speed of a piece being moved, mm per second (0.8 m/s). */
const WALK_MM_PER_S = 800;
/** Time to get a piece moving and stopped again, seconds. */
const HANDLING_S = 3;
/** Separating-axis slack, mm: edges that only touch are not overlapping. */
const EPS = 1e-6;

/** The angle `deg` as 0 to 360. */
export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The turn from angle `a` to `b` the short way round, degrees in [-180, 180). */
export function turnBetween(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** sine and cosine of an angle in degrees, exact at the quarter turns. */
function trig(deg: number): { s: number; c: number } {
  const r = normDeg(deg);
  if (r === 0) return { s: 0, c: 1 };
  if (r === 90) return { s: 1, c: 0 };
  if (r === 180) return { s: 0, c: -1 };
  if (r === 270) return { s: -1, c: 0 };
  const t = (r * Math.PI) / 180;
  return { s: Math.sin(t), c: Math.cos(t) };
}

/** Whether a piece is flown out at fraction `t` of a change from `oa` (at the start) to `ob` (at the end): it changes at the middle. */
function flownAt(oa: boolean, ob: boolean, t: number): boolean {
  if (oa === ob) return oa;
  return t < 0.5 ? oa : ob;
}

/** A piece's pose in `scene`, or its base pose when the scene has none for it. */
export function poseIn(scene: Scene, piece: Piece): Pose {
  return scene.poses[piece.id] ?? { x: piece.x0, y: piece.y0, deg: piece.deg0 };
}

/**
 * Every piece's pose at fraction `t` (0 to 1) from scene `a` to scene `b`: position linear, turn the
 * short way round, and flown out by flownAt. A piece in only one scene keeps its pose there.
 */
export function posesAt(a: Scene, b: Scene, t: number): Record<string, Pose> {
  const out: Record<string, Pose> = {};
  for (const id of new Set([...Object.keys(a.poses), ...Object.keys(b.poses)])) {
    const pa = a.poses[id];
    const pb = b.poses[id];
    if (!pa || !pb) {
      out[id] = { ...(pa ?? pb)! };
      continue;
    }
    out[id] = {
      x: pa.x + (pb.x - pa.x) * t,
      y: pa.y + (pb.y - pa.y) * t,
      deg: normDeg(pa.deg + turnBetween(pa.deg, pb.deg) * t),
      out: flownAt(!!pa.out, !!pb.out, t),
    };
  }
  return out;
}

/** A piece's footprint corners at `pose`: its rectangle about the reference point, turned to the pose's angle, counter-clockwise from its bottom-left. */
export function footprint(piece: Piece, pose: Pose): Pt[] {
  const { s, c } = trig(pose.deg);
  const hw = piece.w / 2;
  const hh = piece.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: pose.x + c * x - s * y, y: pose.y + s * x + c * y }));
}

/** The range of a convex polygon's corners projected on a unit axis. */
function span(poly: readonly Pt[], nx: number, ny: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = p.x * nx + p.y * ny;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/** Whether two convex quadrilaterals (or polygons) overlap: no edge's normal separates them. Edges that only touch don't count. */
export function overlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      let nx = -(q.y - p.y);
      let ny = q.x - p.x;
      const len = Math.hypot(nx, ny);
      if (len < 1e-12) continue;
      nx /= len;
      ny /= len;
      const [a0, a1] = span(a, nx, ny);
      const [b0, b1] = span(b, nx, ny);
      if (a1 <= b0 + EPS || b1 <= a0 + EPS) return false;
    }
  }
  return true;
}

/** Whether two pieces are on stage at both ends of the change and already overlap in both scenes (a piece sitting on a platform). */
function stacked(a: Scene, b: Scene, pi: Piece, pj: Piece): boolean {
  const ends = [a, b].map((s) => [poseIn(s, pi), poseIn(s, pj)]);
  if (ends.some(([x, y]) => x.out || y.out)) return false;
  return ends.every(([x, y]) => overlap(footprint(pi, x), footprint(pj, y)));
}

/**
 * The pairs of pieces that overlap at fraction `t` of the change from `a` to `b`, in the pieces' order.
 * A piece out at this point doesn't count, nor a pair already stacked in both scenes.
 */
export function clashesAt(a: Scene, b: Scene, pieces: readonly Piece[], t: number): Clash[] {
  const at = posesAt(a, b, t);
  const out: Clash[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const pi = pieces[i];
      const pj = pieces[j];
      const xi = at[pi.id] ?? poseIn(a, pi);
      const xj = at[pj.id] ?? poseIn(a, pj);
      if (xi.out || xj.out) continue;
      if (!overlap(footprint(pi, xi), footprint(pj, xj))) continue;
      if (stacked(a, b, pi, pj)) continue;
      out.push({ a: pi.id, b: pj.id, t });
    }
  }
  return out;
}

/**
 * The pairs of pieces that collide on the way from `a` to `b`: each once, at the first of `steps`
 * samples (0 to 1 inclusive) where they overlap. Pieces flown out at both ends are skipped.
 */
export function sweep(a: Scene, b: Scene, pieces: readonly Piece[], steps = SAMPLES): Clash[] {
  const first = new Map<string, Clash>();
  for (let k = 0; k <= steps; k++) {
    for (const c of clashesAt(a, b, pieces, k / steps)) {
      const key = `${c.a}|${c.b}`;
      if (!first.has(key)) first.set(key, c);
    }
  }
  return [...first.values()];
}

/** A length as the shift plot writes it: "3.20 m US", or the two legs of a diagonal move. */
function moveText(sa: StagePoint, sb: StagePoint, format: (mm: number) => string): string {
  const across = sb.across - sa.across;
  const up = sb.up - sa.up;
  const legs: [number, string][] = [];
  if (Math.abs(up) >= LEG_MM) legs.push([up, up > 0 ? "US" : "DS"]);
  if (Math.abs(across) >= LEG_MM) legs.push([across, across > 0 ? "SL" : "SR"]);
  const total = format(Math.hypot(across, up));
  if (legs.length === 1) return `${total} ${legs[0][1]}`;
  return `${total} (${legs.map(([v, word]) => `${format(Math.abs(v))} ${word}`).join(" and ")})`;
}

/** A turn in whole degrees, or to a tenth when it isn't whole. */
function turnText(deg: number): string {
  return `${Math.round(deg * 10) / 10}°`;
}

/** Crew for a piece by its footprint's area: a starting guess. */
export function crewEstimate(piece: Piece): number {
  const m2 = (piece.w * piece.h) / 1e6;
  return m2 < 2 ? 1 : m2 < 6 ? 2 : 4;
}

/** Seconds to move a piece this far at walking pace, plus handling. */
export function shiftSeconds(distanceMm: number): number {
  return HANDLING_S + distanceMm / WALK_MM_PER_S;
}

/**
 * What changes for each piece on the way from `a` to `b`: a row for every piece that moves, turns or
 * flies in or out (pieces that don't are left out). A flown piece is "Flown" on stage, and its
 * distance is not counted.
 */
export function sceneDiff(a: Scene, b: Scene, frame: StageFrame, format: (mm: number) => string, pieces: readonly Piece[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const piece of pieces) {
    const pa = poseIn(a, piece);
    const pb = poseIn(b, piece);
    const oa = !!pa.out;
    const ob = !!pb.out;
    if (oa && ob) continue;
    let action: string;
    let distance = 0;
    let turn = 0;
    if (oa !== ob) {
      action = ob ? "Flies out" : "Flies in";
    } else {
      distance = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      turn = Math.abs(turnBetween(pa.deg, pb.deg));
      const words: string[] = [];
      if (distance >= MOVE_MM) words.push(`Moves ${moveText(toStage(frame, pa), toStage(frame, pb), format)}`);
      if (turn >= TURN_DEG) words.push(`Turns ${turnText(turn)}`);
      if (words.length === 0) continue;
      action = words.join("; ");
    }
    rows.push({
      id: piece.id,
      piece: piece.name,
      from: oa ? "Flown" : stageText(toStage(frame, pa), format),
      to: ob ? "Flown" : stageText(toStage(frame, pb), format),
      distanceMm: distance,
      turnDeg: turn,
      action,
      crew: crewEstimate(piece),
      seconds: shiftSeconds(distance),
    });
  }
  return rows;
}

/** Each piece on stage in `scene` (not flown out): its footprint corners as stage points. */
export function spikes(scene: Scene, pieces: readonly Piece[], frame: StageFrame): Spike[] {
  return pieces.flatMap((piece) => {
    const pose = poseIn(scene, piece);
    if (pose.out) return [];
    return [{ id: piece.id, name: piece.name, corners: footprint(piece, pose).map((c) => toStage(frame, c)) }];
  });
}

/**
 * The spike marks of a footprint's corners (in order, as footprint gives them): each an L of two arms
 * of `arm` length running on from the corner along its two edges, outside the piece, as [arm, corner, arm].
 */
export function spikeLegs(corners: readonly Pt[], arm: number): Pt[][] {
  const n = corners.length;
  const outward = (from: Pt, c: Pt): Pt => {
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-12 ? c : { x: c.x + (dx / len) * arm, y: c.y + (dy / len) * arm };
  };
  return corners.map((c, i) => [outward(corners[(i + 1) % n], c), c, outward(corners[(i - 1 + n) % n], c)]);
}

/** The matrix that turns each point of a piece `deg` degrees about `p` and then moves `p` to `q`. */
export function moveMatrix(p: Pose, q: Pose): Affine {
  const turn = q.deg - p.deg;
  const { s, c } = trig(turn);
  return {
    a: c,
    b: s,
    c: -s,
    d: c,
    e: q.x - (c * p.x - s * p.y),
    f: q.y - (s * p.x + c * p.y),
  };
}

/** Whether a move takes nothing: same place and same turn, to a hundredth of a millimetre and degree. */
export function isStill(p: Pose, q: Pose): boolean {
  return Math.hypot(q.x - p.x, q.y - p.y) < 0.01 && Math.abs(turnBetween(p.deg, q.deg)) < 0.01;
}

/**
 * A rectangle read from its four corners (in order round it): its centre, its size and its turn. Its
 * width is the edge nearest `wantW` when given (else the first edge), and its turn is that edge's angle,
 * so a piece turned by hand reads back the turn it has. Null unless the corners are a rectangle.
 */
export function rectangleOf(points: readonly Pt[], wantW?: number): { x: number; y: number; deg: number; w: number; h: number } | null {
  if (points.length !== 4) return null;
  const edges = points.map((p, i) => ({ x: points[(i + 1) % 4].x - p.x, y: points[(i + 1) % 4].y - p.y }));
  const len = edges.map((e) => Math.hypot(e.x, e.y));
  if (len.some((l) => l < 1e-6)) return null;
  const cos = (edges[0].x * edges[1].x + edges[0].y * edges[1].y) / (len[0] * len[1]);
  // opposite sides equal and the corners square, to a half millimetre and a thousandth of a radian
  if (Math.abs(cos) > 1e-3 || Math.abs(len[0] - len[2]) > 0.5 || Math.abs(len[1] - len[3]) > 0.5) return null;
  const k = wantW !== undefined && Math.abs(len[1] - wantW) < Math.abs(len[0] - wantW) ? 1 : 0;
  const e = edges[k];
  return {
    x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
    y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
    deg: normDeg((Math.atan2(e.y, e.x) * 180) / Math.PI),
    w: len[k],
    h: len[(k + 1) % 2],
  };
}
