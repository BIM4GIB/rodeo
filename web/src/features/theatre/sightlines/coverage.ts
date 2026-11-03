// The sightline coverage of the stage, in plan: whether a seat can see a point of the stage past the
// occluders (the proscenium, masking, any walls), each given as a segment in the stage's frame. A seat
// sees a point when the straight line between them meets no occluder. Heights and the audience's rake
// aren't tested. Seats past MAX_SEATS are sampled evenly so the map stays quick. Pure: it draws nothing.

import type { Pt, Shape } from "../../../core/index.ts";
import { toStage, type StageFrame, type StagePoint } from "../stage.ts";
import type { Seat } from "./seats.ts";

/** An occluder's segment, in stage terms. */
export interface Wall {
  readonly a: StagePoint;
  readonly b: StagePoint;
}

/** A rectangle of the stage, in stage terms. */
export interface StageRect {
  readonly across0: number;
  readonly across1: number;
  readonly up0: number;
  readonly up1: number;
}

/** The most seats a map counts; a longer audience is sampled evenly down to this. */
export const MAX_SEATS = 300;

/**
 * A map's grid: `percent` is the share of the counted seats that see each cell's centre (0 to 100), cells
 * row by row from the upstage row; `seatScores` each counted seat's share of the cells it sees (0 to 100).
 */
export interface Coverage {
  readonly cols: number;
  readonly rows: number;
  readonly rect: StageRect;
  readonly percent: Float32Array;
  readonly seatScores: Float32Array;
  /** the seats counted, in the order of seatScores */
  readonly counted: readonly Seat[];
  /** how many seats the audience has */
  readonly total: number;
}

export interface CoverageStats {
  /** the average seat's share of the stage it sees, 0 to 100 */
  readonly average: number;
  /** the worst counted seat's share */
  readonly worst: number;
  /** the share of the stage every counted seat sees */
  readonly everyone: number;
  /** the share of the stage fewer than half the counted seats see */
  readonly underHalf: number;
}

const EPS = 1e-6;

/** The turn of the path p to r through q: positive when r is anticlockwise of the direction p to q. */
function turn(p: StagePoint, q: StagePoint, r: StagePoint): number {
  return (q.across - p.across) * (r.up - p.up) - (q.up - p.up) * (r.across - p.across);
}

const sign = (v: number): number => (v > EPS ? 1 : v < -EPS ? -1 : 0);

/** Whether r lies within the box of the segment pq (used once it is known to be on its line). */
function within(p: StagePoint, q: StagePoint, r: StagePoint): boolean {
  return Math.min(p.across, q.across) - EPS <= r.across && r.across <= Math.max(p.across, q.across) + EPS && Math.min(p.up, q.up) - EPS <= r.up && r.up <= Math.max(p.up, q.up) + EPS;
}

/** Whether the segments ab and cd meet, touching at an end or lying along one another included. */
export function segmentsMeet(a: StagePoint, b: StagePoint, c: StagePoint, d: StagePoint): boolean {
  const d1 = sign(turn(c, d, a));
  const d2 = sign(turn(c, d, b));
  const d3 = sign(turn(a, b, c));
  const d4 = sign(turn(a, b, d));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d));
}

/** Whether a seat at `seat` sees `point` in plan: no occluder meets the straight line between them. */
export function seesPoint(seat: StagePoint, point: StagePoint, occluders: readonly Wall[]): boolean {
  return !occluders.some((w) => segmentsMeet(seat, point, w.a, w.b));
}

/** The seats to count: all of them, or `max` spread evenly along the list. */
export function sampleSeats(seats: readonly Seat[], max = MAX_SEATS): Seat[] {
  if (seats.length <= max) return [...seats];
  const step = seats.length / max;
  return Array.from({ length: max }, (_, i) => seats[Math.floor(i * step)]);
}

/** The centre of each cell of a grid, row by row from the upstage row. */
export function cellCentres(rect: StageRect, cols: number, rows: number): StagePoint[] {
  const dA = (rect.across1 - rect.across0) / cols;
  const dU = (rect.up1 - rect.up0) / rows;
  const out: StagePoint[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ across: rect.across0 + (c + 0.5) * dA, up: rect.up1 - (r + 0.5) * dU });
  return out;
}

/** Each counted seat's and each cell's view of the stage, as coverage (see Coverage). */
export function coverageGrid(seats: readonly Seat[], rect: StageRect, cols: number, rows: number, occluders: readonly Wall[]): Coverage {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const counted = sampleSeats(seats);
  const points = cellCentres(rect, c, r);
  const cells = points.length;
  const seen = new Uint32Array(cells);
  const seatScores = new Float32Array(counted.length);
  counted.forEach((seat, i) => {
    let n = 0;
    const from = { across: seat.across, up: seat.up };
    for (let k = 0; k < cells; k++) {
      if (seesPoint(from, points[k], occluders)) {
        n++;
        seen[k]++;
      }
    }
    seatScores[i] = (100 * n) / cells;
  });
  const percent = new Float32Array(cells);
  for (let k = 0; k < cells; k++) percent[k] = counted.length ? (100 * seen[k]) / counted.length : 0;
  return { cols: c, rows: r, rect, percent, seatScores, counted, total: seats.length };
}

/** The overall figures of a coverage: a seat's average and worst share, and the stage every seat or under half of them see. */
export function coverageStats(cov: Coverage): CoverageStats {
  const n = cov.seatScores.length;
  const cells = cov.percent.length;
  let sum = 0;
  let worst = Infinity;
  for (const v of cov.seatScores) {
    sum += v;
    worst = Math.min(worst, v);
  }
  let all = 0;
  let under = 0;
  for (const v of cov.percent) {
    if (v >= 100 - EPS) all++;
    if (v < 50) under++;
  }
  return {
    average: n ? sum / n : 0,
    worst: n ? worst : 0,
    everyone: cells ? (100 * all) / cells : 0,
    underHalf: cells ? (100 * under) / cells : 0,
  };
}

/** The edges of a drawn shape as walls in the stage's frame: a line's, a rectangle's, a polygon's or polyline's sides, an arc's as short chords. */
export function wallsOf(shape: Shape, frame: StageFrame): Wall[] {
  const chain = (pts: readonly Pt[], closed: boolean): Wall[] => {
    const s = pts.map((p) => toStage(frame, p));
    const out: Wall[] = [];
    for (let i = 0; i + 1 < s.length; i++) out.push({ a: s[i], b: s[i + 1] });
    if (closed && s.length > 2) out.push({ a: s[s.length - 1], b: s[0] });
    return out;
  };
  switch (shape.kind) {
    case "line":
      return chain(shape.points, false);
    case "rect":
    case "polygon":
      return chain(shape.points, true);
    case "polyline":
      return chain(shape.points, shape.closed);
    case "arc": {
      const rx = shape.rx ?? 0;
      if (!shape.center || rx <= 0) return [];
      const ry = shape.ry ?? rx;
      const sweep = shape.sweepAngle ?? 360;
      const full = Math.abs(sweep) >= 360;
      const steps = Math.max(8, Math.ceil(Math.abs(sweep) / 6));
      const pts: Pt[] = [];
      for (let k = 0; k < (full ? steps : steps + 1); k++) {
        const t = ((shape.startAngle ?? 0) + (sweep * k) / steps) * (Math.PI / 180);
        pts.push({ x: shape.center.x + rx * Math.cos(t), y: shape.center.y + ry * Math.sin(t) });
      }
      return chain(pts, full);
    }
    default:
      return [];
  }
}
