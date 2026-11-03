// AEC > Roads > Station on Polyline's geometry: the stations along a road's line, their names (full
// stations 100 feet apart, "1+50" for 50 feet past the first), and each circular curve's data: the
// point of curvature and of tangency, where its tangents meet, its included angle, tangent distance,
// radius, length and chord, as Vectorworks' help draws them. All lengths in mm.

import { filletArcs, type FilletArc, type Pt, type Shape } from "../core/index.ts";

/** A full station: 100 feet, or as Vectorworks gives it for metric drawings, 30.48 m. */
export const STATION_MM = 30480;
/** closer than this along the line, two stations are one */
const SAME_MM = 0.01;
/** past this included angle the tangents meet too far off to draw */
const MAX_PI_ANGLE = (170 * Math.PI) / 180;
/** a curve's steps when it's measured, radians: a quarter degree, under a part in a million short */
const TRUE_STEP = (0.25 * Math.PI) / 180;

export interface Station {
  readonly at: Pt;
  /** how far along the line, mm */
  readonly along: number;
  /** on a whole 100 feet */
  readonly full: boolean;
}

const run = (points: readonly Pt[], closed: boolean): readonly Pt[] => (closed && points.length > 2 ? [...points, points[0]] : points);

export function pathLength(points: readonly Pt[], closed: boolean): number {
  const pts = run(points, closed);
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

/** How many stations the line takes: every 100 feet, every `partial` (0 for none) and its end. */
export function stationSpots(total: number, partial: number): number[] {
  const spots: number[] = [];
  for (let k = 0; k * STATION_MM <= total + SAME_MM; k++) spots.push(k * STATION_MM);
  if (partial > 0) for (let k = 1; k * partial <= total + SAME_MM; k++) spots.push(k * partial);
  spots.push(total);
  spots.sort((a, b) => a - b);
  return spots.filter((d, i) => i === 0 || d - spots[i - 1] > SAME_MM);
}

/** The stations along the line from its first point. */
export function stationsAlong(points: readonly Pt[], closed: boolean, partial: number): Station[] {
  const pts = run(points, closed);
  const spots = stationSpots(pathLength(points, closed), partial);
  const out: Station[] = [];
  let i = 1;
  let before = 0;
  for (const along of spots) {
    let len = i < pts.length ? Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) : 0;
    while (i < pts.length - 1 && before + len < along) {
      before += len;
      i++;
      len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    const t = len > 0 ? Math.min(1, Math.max(0, (along - before) / len)) : 0;
    const a = pts[i - 1];
    const b = pts[Math.min(i, pts.length - 1)];
    const off = along % STATION_MM;
    out.push({ at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, along, full: off < SAME_MM || STATION_MM - off < SAME_MM });
  }
  return out;
}

/** A station's name: whole stations, "+", and what's past them in feet (metres in a metric drawing): 1+50, 2+07.25. */
export function stationName(along: number, metric: boolean): string {
  const unit = metric ? 1000 : 304.8;
  const per = STATION_MM / unit;
  let whole = Math.floor((along + SAME_MM) / STATION_MM);
  let past = Math.round(((along - whole * STATION_MM) / unit) * 100) / 100;
  // rounding up to the next station
  if (past >= per) {
    whole++;
    past = 0;
  }
  const [int, frac] = String(Math.max(0, past)).split(".");
  return `${whole}+${int.padStart(2, "0")}${frac ? `.${frac}` : ""}`;
}

export interface Curve extends FilletArc {
  /** PC and PT's distances along the line */
  readonly fromAlong: number;
  readonly toAlong: number;
  /** where the tangents meet; null when the curve nearly doubles back */
  readonly pi: Pt | null;
  /** included angle, radians */
  readonly angle: number;
  /** tangent distance, PC or PT to PI */
  readonly tangent: number;
  readonly length: number;
  readonly chord: number;
}

/** The arc from a through b to c, as a polyline's through vertex draws it. */
function throughArc(a: Pt, b: Pt, c: Pt): FilletArc | null {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const span = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
  if (!(Math.abs(cross) > 1e-9 * span * span)) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const centre = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / (2 * cross),
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / (2 * cross),
  };
  const r = Math.hypot(a.x - centre.x, a.y - centre.y);
  const at = (p: Pt): number => Math.atan2(p.y - centre.y, p.x - centre.x);
  let sweep = at(c) - at(a);
  if (cross > 0 && sweep < 0) sweep += 2 * Math.PI;
  if (cross < 0 && sweep > 0) sweep -= 2 * Math.PI;
  return { from: a, to: c, centre, r, sweep };
}

/** How far along the line a point on it lies. */
function locate(points: readonly Pt[], closed: boolean, p: Pt): number {
  const pts = run(points, closed);
  let best = Infinity;
  let along = 0;
  let before = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const dx = pts[i].x - a.x;
    const dy = pts[i].y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
    if (d < best - 1e-9) {
      best = d;
      along = before + t * Math.sqrt(len2);
    }
    before += Math.sqrt(len2);
  }
  return along;
}

const near = (a: Pt, b: Pt, tol: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/** A polyline's circular arcs, in vertex order; arcs on one circle that run on from each other are one. Other shapes have none. */
function circularArcs(shape: Shape): FilletArc[] {
  const verts = shape.kind === "polyline" ? shape.vertices : undefined;
  if (!verts) return [];
  const fillets = filletArcs(verts, shape.closed);
  const n = verts.length;
  const arcs: FilletArc[] = [];
  verts.forEach((v, i) => {
    const end = !shape.closed && (i === 0 || i === n - 1);
    const arc = fillets[i] ?? (v.kind === "through" && !end ? throughArc(verts[(i - 1 + n) % n].p, v.p, verts[(i + 1) % n].p) : null);
    if (!arc) return;
    const was = arcs[arcs.length - 1];
    const tol = Math.max(1e-6, arc.r * 1e-6);
    if (was && near(was.to, arc.from, tol) && near(was.centre, arc.centre, tol) && Math.abs(was.r - arc.r) <= tol && was.sweep > 0 === arc.sweep > 0) {
      arcs[arcs.length - 1] = { ...was, to: arc.to, sweep: was.sweep + arc.sweep };
    } else arcs.push(arc);
  });
  return arcs;
}

/** The line with its circular curves taken finely, as the points they're drawn with cut a road's length short by a part in a thousand. */
export function truePath(shape: Shape): readonly Pt[] {
  const arcs = circularArcs(shape);
  const pts = shape.points;
  const out: Pt[] = [];
  let i = 0;
  for (const arc of arcs) {
    const tol = Math.max(1e-6, arc.r * 1e-6);
    while (i < pts.length && !near(pts[i], arc.from, tol)) out.push(pts[i++]);
    const at = i;
    while (i < pts.length && !near(pts[i], arc.to, tol)) i++;
    // through vertices sharing their arcs' ends don't come apart in order: the points as drawn stand
    if (at === pts.length || i === pts.length) return pts;
    i++;
    const start = Math.atan2(arc.from.y - arc.centre.y, arc.from.x - arc.centre.x);
    const steps = Math.max(1, Math.ceil(Math.abs(arc.sweep) / TRUE_STEP));
    for (let k = 0; k <= steps; k++) {
      const a = start + (arc.sweep * k) / steps;
      out.push({ x: arc.centre.x + arc.r * Math.cos(a), y: arc.centre.y + arc.r * Math.sin(a) });
    }
  }
  while (i < pts.length) out.push(pts[i++]);
  return out;
}

/** The circular curves of a polyline, in vertex order, with their stations along `path` (its truePath). */
export function curvesOf(shape: Shape, path: readonly Pt[] = truePath(shape)): Curve[] {
  return circularArcs(shape).map((arc) => {
    const angle = Math.abs(arc.sweep);
    const start = Math.atan2(arc.from.y - arc.centre.y, arc.from.x - arc.centre.x);
    const middle = start + arc.sweep / 2;
    const reach = arc.r / Math.cos(angle / 2);
    const fromAlong = locate(path, shape.closed, arc.from);
    const toAlong = locate(path, shape.closed, arc.to);
    return {
      ...arc,
      fromAlong,
      // a closed line's curve can end on its first point
      toAlong: toAlong < fromAlong ? pathLength(path, shape.closed) : toAlong,
      pi: angle < MAX_PI_ANGLE ? { x: arc.centre.x + reach * Math.cos(middle), y: arc.centre.y + reach * Math.sin(middle) } : null,
      angle,
      tangent: arc.r * Math.tan(angle / 2),
      length: arc.r * angle,
      chord: 2 * arc.r * Math.sin(angle / 2),
    };
  });
}

/** An angle in radians as degrees, minutes and seconds: 36°12'30". */
export function dms(angle: number): string {
  const seconds = Math.round((angle * 180 * 3600) / Math.PI);
  return `${Math.floor(seconds / 3600)}°${Math.floor(seconds / 60) % 60}'${seconds % 60}"`;
}
