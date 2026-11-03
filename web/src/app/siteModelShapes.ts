// The sums behind the site model: a triangulated surface through source points, its heights, contours, areas
// and volumes, and the proposed surface that site modifiers make of it.

import type { Pt } from "../core/index.ts";
import { offsetPolyline, pointInPolygon } from "./geom.ts";

export type Pt3 = readonly [number, number, number];

export interface Surface {
  readonly points: readonly Pt3[];
  /** three indices into points to a triangle, counter-clockwise from above */
  readonly triangles: readonly number[];
}

/** what's nearer than this in plan (mm) is one point, the first */
const SAME_PLACE = 1;

function distinct(points: readonly Pt3[]): Pt3[] {
  const seen = new Set<string>();
  const out: Pt3[] = [];
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue;
    const key = `${Math.round(p[0] / SAME_PLACE)},${Math.round(p[1] / SAME_PLACE)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** A small, repeatable amount for each point, to part points that lie exactly on one circle, as a grid's do. */
const nudge = (i: number): number => {
  const v = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return v - Math.floor(v) - 0.5;
};

/** The Delaunay triangles of points in plan (Bowyer and Watson's way, going across them from the left). */
export function triangulate(points: readonly Pt3[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...sampleOf(xs));
  const x1 = Math.max(...sampleOf(xs));
  const y0 = Math.min(...sampleOf(ys));
  const y1 = Math.max(...sampleOf(ys));
  const reach = Math.max(x1 - x0, y1 - y0, 1);
  const amount = reach * 1e-6;
  const x = new Float64Array(n + 3);
  const y = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) {
    x[i] = xs[i] + nudge(i) * amount;
    y[i] = ys[i] + nudge(i + n) * amount;
  }
  // a triangle round them all
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const far = reach * 1000;
  x[n] = mx - 2 * far;
  y[n] = my - far;
  x[n + 1] = mx;
  y[n + 1] = my + 2 * far;
  x[n + 2] = mx + 2 * far;
  y[n + 2] = my - far;
  interface Tri {
    a: number;
    b: number;
    c: number;
    turn: number;
    cx: number;
    cy: number;
    r2: number;
  }
  const circle = (a: number, b: number, c: number): Tri => {
    const bx = x[b] - x[a];
    const by = y[b] - y[a];
    const cx = x[c] - x[a];
    const cy = y[c] - y[a];
    const d = 2 * (bx * cy - by * cx) || 1e-12;
    const b2 = bx * bx + by * by;
    const c2 = cx * cx + cy * cy;
    const ux = (cy * b2 - by * c2) / d;
    const uy = (bx * c2 - cx * b2) / d;
    return { a, b, c, turn: bx * cy - by * cx, cx: x[a] + ux, cy: y[a] + uy, r2: ux * ux + uy * uy };
  };
  // the sum from where the point is, as a stored centre isn't good enough for three points nearly in line
  const inCircle = (t: Tri, p: number): boolean => {
    const ax = x[t.a] - x[p];
    const ay = y[t.a] - y[p];
    const bx = x[t.b] - x[p];
    const by = y[t.b] - y[p];
    const cx = x[t.c] - x[p];
    const cy = y[t.c] - y[p];
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
    return t.turn > 0 ? det > 0 : det < 0;
  };
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => x[p] - x[q]);
  const open: Tri[] = [circle(n, n + 1, n + 2)];
  const closed: Tri[] = [];
  for (const p of order) {
    const edges: number[] = [];
    for (let k = open.length - 1; k >= 0; k--) {
      const t = open[k];
      const dx = x[p] - t.cx;
      // the circle is all to the left: no later point can fall in it
      if (dx > 0 && dx * dx > t.r2 * 1.000001) {
        closed.push(t);
        open[k] = open[open.length - 1];
        open.pop();
        continue;
      }
      if (!inCircle(t, p)) continue;
      edges.push(t.a, t.b, t.b, t.c, t.c, t.a);
      open[k] = open[open.length - 1];
      open.pop();
    }
    // an edge two of them shared is inside the hole
    const count = new Map<string, number[]>();
    for (let e = 0; e < edges.length; e += 2) {
      const key = edges[e] < edges[e + 1] ? `${edges[e]},${edges[e + 1]}` : `${edges[e + 1]},${edges[e]}`;
      const had = count.get(key);
      if (had) had.push(e);
      else count.set(key, [e]);
    }
    for (const list of count.values()) if (list.length === 1) open.push(circle(edges[list[0]], edges[list[0] + 1], p));
  }
  const out: number[] = [];
  const tiny = reach * reach * 1e-11;
  for (const t of [...closed, ...open]) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    const area = (points[t.b][0] - points[t.a][0]) * (points[t.c][1] - points[t.a][1]) - (points[t.b][1] - points[t.a][1]) * (points[t.c][0] - points[t.a][0]);
    if (Math.abs(area) <= tiny) continue;
    if (area > 0) out.push(t.a, t.b, t.c);
    else out.push(t.a, t.c, t.b);
  }
  return out;
}

/** Math.min and max take only so many arguments: every value when they're few, else the two ends. */
function sampleOf(values: readonly number[]): number[] {
  if (values.length < 50000) return [...values];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** The surface through these points, cut to a border if there is one; null with too few to make one. */
export function surfaceOf(raw: readonly Pt3[], border?: readonly Pt[] | null): Surface | null {
  const points = distinct(raw);
  let triangles = triangulate(points);
  if (border && border.length >= 3) {
    const kept: number[] = [];
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const [a, b, c] = [points[triangles[i]], points[triangles[i + 1]], points[triangles[i + 2]]];
      if (pointInPolygon({ x: (a[0] + b[0] + c[0]) / 3, y: (a[1] + b[1] + c[1]) / 3 }, border)) kept.push(triangles[i], triangles[i + 1], triangles[i + 2]);
    }
    triangles = kept;
  }
  return triangles.length ? { points, triangles } : null;
}

export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function boxOf(surface: Surface): Box {
  let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const p of surface.points) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

export function heightRange(surface: Surface): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < surface.triangles.length; i++) {
    const z = surface.points[surface.triangles[i]][2];
    if (z < min) min = z;
    if (z > max) max = z;
  }
  return { min, max };
}

export type HeightAt = (x: number, y: number) => number | null;

/** How high a surface is at a place in plan, null off its edge; quick to ask often. */
export function heightLookup(surface: Surface): HeightAt {
  const box = boxOf(surface);
  const count = surface.triangles.length / 3;
  const across = Math.max(1, Math.ceil(Math.sqrt(count)));
  const w = Math.max(box.x1 - box.x0, 1e-6) / across;
  const h = Math.max(box.y1 - box.y0, 1e-6) / across;
  const cells = new Map<number, number[]>();
  const clamp = (v: number): number => Math.min(across - 1, Math.max(0, v));
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const i0 = clamp(Math.floor((Math.min(a[0], b[0], c[0]) - box.x0) / w));
    const i1 = clamp(Math.floor((Math.max(a[0], b[0], c[0]) - box.x0) / w));
    const j0 = clamp(Math.floor((Math.min(a[1], b[1], c[1]) - box.y0) / h));
    const j1 = clamp(Math.floor((Math.max(a[1], b[1], c[1]) - box.y0) / h));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = i * across + j;
        const list = cells.get(key);
        if (list) list.push(t);
        else cells.set(key, [t]);
      }
    }
  }
  return (x, y) => {
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) return null;
    for (const t of cells.get(clamp(Math.floor((x - box.x0) / w)) * across + clamp(Math.floor((y - box.y0) / h))) ?? []) {
      const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (d === 0) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      return u * a[2] + v * b[2] + (1 - u - v) * c[2];
    }
    return null;
  };
}

export interface ContourLine {
  readonly points: readonly Pt[];
  readonly closed: boolean;
}

/** Where a surface crosses a level, as lines (a point exactly on the level counts as below it). */
export function contourLines(surface: Surface, level: number): ContourLine[] {
  const { points, triangles } = surface;
  const n = points.length;
  const crossing = new Map<number, Pt>();
  const next = new Map<number, number[]>();
  const keyOf = (i: number, j: number): number => {
    const key = i < j ? i * n + j : j * n + i;
    if (!crossing.has(key)) {
      const [lo, hi] = points[i][2] <= points[j][2] ? [points[i], points[j]] : [points[j], points[i]];
      const t = (level - lo[2]) / (hi[2] - lo[2]);
      crossing.set(key, { x: lo[0] + (hi[0] - lo[0]) * t, y: lo[1] + (hi[1] - lo[1]) * t });
    }
    return key;
  };
  const join = (a: number, b: number): void => {
    for (const [p, q] of [[a, b], [b, a]]) {
      const list = next.get(p);
      if (list) list.push(q);
      else next.set(p, [q]);
    }
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const ends: number[] = [];
    for (let e = 0; e < 3; e++) {
      const i = tri[e];
      const j = tri[(e + 1) % 3];
      if (points[i][2] > level !== points[j][2] > level) ends.push(keyOf(i, j));
    }
    if (ends.length === 2) join(ends[0], ends[1]);
  }
  const used = new Set<number>();
  const walk = (start: number): ContourLine => {
    const line: number[] = [start];
    used.add(start);
    let at = start;
    for (;;) {
      const to = next.get(at)?.find((k) => !used.has(k));
      if (to === undefined) break;
      used.add(to);
      line.push(to);
      at = to;
    }
    const closed = line.length > 2 && (next.get(at)?.includes(start) ?? false);
    return { points: line.map((k) => crossing.get(k) as Pt), closed };
  };
  const out: ContourLine[] = [];
  // those that end at the edge first, the loops after
  for (const [k, list] of next) if (list.length === 1 && !used.has(k)) out.push(walk(k));
  for (const k of next.keys()) if (!used.has(k)) out.push(walk(k));
  return out;
}

export interface Level {
  readonly z: number;
  /** a major contour, drawn heavier */
  readonly major: boolean;
}

/** The contour levels in a range: every interval, counted from the offset, each `multiple`th a major one. */
export function contourLevels(min: number, max: number, interval: number, multiple: number, offset: number): Level[] {
  if (!(interval > 0) || max < min) return [];
  const first = Math.ceil((min - offset) / interval);
  const last = Math.floor((max - offset) / interval);
  const out: Level[] = [];
  for (let k = first; k <= last; k++) out.push({ z: offset + k * interval, major: multiple > 0 && ((k % multiple) + multiple) % multiple === 0 });
  return out;
}

/** A line with its corners rounded by cutting them, twice: for looks only. */
export function smoothed(line: ContourLine): ContourLine {
  let points: readonly Pt[] = line.points;
  for (let pass = 0; pass < 2; pass++) {
    const out: Pt[] = [];
    const count = points.length;
    if (!line.closed) out.push(points[0]);
    for (let i = 0; i < (line.closed ? count : count - 1); i++) {
      const a = points[i];
      const b = points[(i + 1) % count];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    if (!line.closed) out.push(points[count - 1]);
    points = out;
  }
  return { points, closed: line.closed };
}

export const lineLength = (line: ContourLine): number => {
  let sum = 0;
  const n = line.points.length;
  for (let i = 0; i < (line.closed ? n : n - 1); i++) sum += Math.hypot(line.points[(i + 1) % n].x - line.points[i].x, line.points[(i + 1) % n].y - line.points[i].y);
  return sum;
};

/** How far along a line `count` labels go, evenly. */
export const labelStations = (line: ContourLine, count: number): number[] => {
  const length = lineLength(line);
  return Array.from({ length: count }, (_, k) => ((k + 0.5) * length) / count);
};

/** The piece of a line between two distances along it. */
function sliced(points: readonly Pt[], from: number, to: number): Pt[] {
  const out: Pt[] = [];
  let gone = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    const at = (d: number): Pt => (run > 0 ? { x: a.x + ((b.x - a.x) * (d - gone)) / run, y: a.y + ((b.y - a.y) * (d - gone)) / run } : a);
    if (gone + run >= from && gone <= to) {
      if (!out.length) out.push(at(Math.max(from, gone)));
      out.push(at(Math.min(to, gone + run)));
    }
    gone += run;
  }
  return out;
}

/** A line with gaps at these distances along it, for its labels. */
export function gappedLine(line: ContourLine, stations: readonly number[], gap: number): ContourLine[] {
  if (!stations.length) return [line];
  const points = line.closed ? [...line.points, line.points[0]] : line.points;
  const length = lineLength(line);
  const pieces: Pt[][] = [];
  let from = 0;
  for (const at of stations) {
    if (at - gap / 2 > from) pieces.push(sliced(points, from, at - gap / 2));
    from = at + gap / 2;
  }
  if (from < length) pieces.push(sliced(points, from, length));
  // a loop's first and last pieces meet where it starts
  if (line.closed && pieces.length > 1) pieces[0] = [...(pieces.pop() as Pt[]), ...pieces[0].slice(1)];
  return pieces.filter((p) => p.length >= 2).map((p) => ({ points: p, closed: false }));
}

/** Where a contour's label at a distance along it goes: reading along the line with its top uphill. */
export function labelPlace(line: ContourLine, distance: number, heightAt: HeightAt): { at: Pt; angle: number } {
  const n = line.points.length;
  const last = line.closed ? n : n - 1;
  let gone = 0;
  for (let i = 0; i < last; i++) {
    const a = line.points[i];
    const b = line.points[(i + 1) % n];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    if (gone + run < distance && i < last - 1) {
      gone += run;
      continue;
    }
    const t = run > 0 ? Math.min(1, (distance - gone) / run) : 0;
    const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    const d = Math.max(run, 1);
    const up = heightAt(at.x - Math.sin(angle) * d, at.y + Math.cos(angle) * d);
    const down = heightAt(at.x + Math.sin(angle) * d, at.y - Math.cos(angle) * d);
    if (up !== null && down !== null && up < down) angle += Math.PI;
    return { at, angle: (angle * 180) / Math.PI };
  }
  return { at: line.points[0], angle: 0 };
}

/** A contour label put by hand: where it goes, and its contour's height. */
export interface PlacedLabel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where a line of clicks crosses a surface's contours at these heights. */
export function labelsAlong(surface: Surface, levels: readonly number[], clicks: readonly Pt[]): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const z of levels) {
    for (const line of contourLines(surface, z)) {
      const points = line.closed ? [...line.points, line.points[0]] : line.points;
      for (let i = 0; i + 1 < points.length; i++) {
        const [a, b] = [points[i], points[i + 1]];
        for (let j = 0; j + 1 < clicks.length; j++) {
          const [c, d] = [clicks[j], clicks[j + 1]];
          const across = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
          if (across === 0) continue;
          const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / across;
          const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / across;
          // a contour's corner is the end of one piece and the start of the next: count it once
          if (t >= 0 && t < 1 && u >= 0 && u <= 1) out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z });
        }
      }
    }
  }
  return out;
}

/** For each of a height's contour lines, how far along it the labels of that height go: each on the line nearest it. */
export function placedStations(lines: readonly ContourLine[], labels: readonly Pt[]): number[][] {
  const out: number[][] = lines.map(() => []);
  for (const label of labels) {
    let best = -1;
    let least = Infinity;
    let run = 0;
    lines.forEach((line, i) => {
      const near = nearestOn(label, line.points, line.closed);
      if (near.off < least) [best, least, run] = [i, near.off, near.run];
    });
    if (best >= 0) out[best].push(run);
  }
  return out.map((stations) => stations.sort((a, b) => a - b));
}

/** The nearest place on these contour lines. */
export function nearestOnContours(lines: readonly ContourLine[], p: Pt): { at: Pt; off: number } | null {
  let best: { at: Pt; off: number } | null = null;
  for (const line of lines) {
    const near = nearestOn(p, line.points, line.closed);
    if (best && near.off >= best.off) continue;
    const [a, b] = [line.points[near.segment], line.points[(near.segment + 1) % line.points.length]];
    best = { at: { x: a.x + (b.x - a.x) * near.t, y: a.y + (b.y - a.y) * near.t }, off: near.off };
  }
  return best;
}

export interface SurfaceFigures {
  /** in plan, mm² */
  readonly projected: number;
  /** on the slope, mm² */
  readonly area: number;
}

export function surfaceFigures(surface: Surface): SurfaceFigures {
  let projected = 0;
  let area = 0;
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    projected += Math.abs(nz) / 2;
    area += Math.hypot(nx, ny, nz) / 2;
  }
  return { projected, area };
}

/** How much lies under a surface and over a datum, mm³ (a triangle part below the datum counts by its corners' heights over it). */
export function volumeAbove(surface: Surface, datum: number): number {
  let sum = 0;
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const plan = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    sum += (plan * (Math.max(0, a[2] - datum) + Math.max(0, b[2] - datum) + Math.max(0, c[2] - datum))) / 3;
  }
  return sum;
}

/** What going from existing to proposed cuts away and fills in, mm³, by height differences on a grid. */
export function cutAndFill(existing: HeightAt, proposed: HeightAt, box: Box, across = 256): { cut: number; fill: number } {
  const w = (box.x1 - box.x0) / across;
  const h = (box.y1 - box.y0) / across;
  let cut = 0;
  let fill = 0;
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < across; j++) {
      const x = box.x0 + (i + 0.5) * w;
      const y = box.y0 + (j + 0.5) * h;
      const was = existing(x, y);
      const now = proposed(x, y);
      if (was === null || now === null) continue;
      if (now > was) fill += (now - was) * w * h;
      else cut += (was - now) * w * h;
    }
  }
  return { cut, fill };
}

export type ModifierKind = "limits" | "pad" | "line" | "aligned" | "spoil" | "bed" | "path" | "crop" | "contour" | "sculpt" | "swale" | "vertex";

/** How a sculpt reaches round its middle, or else the surface's own vertices it moves. */
export interface SculptReach {
  readonly centre: Pt;
  readonly radius: number;
  /** how much of the radius shades off, 0 to 1; null when it all moves alike */
  readonly soft: number | null;
  /** how close new vertices go; null for none */
  readonly spacing: number | null;
  readonly elements?: readonly Pt[];
}

export type SwaleProfile = "Flat" | "Rounded" | "Sharp";

export interface SwaleShape {
  readonly width: number;
  readonly profile: SwaleProfile;
  readonly follow: boolean;
}

export interface SiteModifier {
  readonly kind: ModifierKind;
  readonly ring: readonly Pt[];
  /** at the outline's centre */
  readonly elevation: number;
  /** rise over run, up towards slopeAngle */
  readonly slope: number;
  /** degrees, counter-clockwise from +x */
  readonly slopeAngle: number;
  /** a line's height at its last point, going evenly from `elevation` at its first */
  readonly end?: number;
  /** it changes the existing surface, not the proposed one */
  readonly existing?: boolean;
  /** grade limits at this one height, in place of the ground's */
  readonly level?: number;
  /** an aligned modifier's height at each corner of its ring */
  readonly heights?: readonly number[];
  /** a sculpt's reach */
  readonly sculpt?: SculptReach;
  /** a swale's or berm's shape */
  readonly swale?: SwaleShape;
  /** a contour's line before it was edited */
  readonly old?: readonly Pt[];
  /** a path's points, its heights all worked out */
  readonly samples?: readonly Pt3[];
  /** a texture bed's class and colour */
  readonly classIndex?: number;
  readonly colour?: number;
}

function ringCentre(ring: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** How high a pad is at a place. */
export function padHeight(m: SiteModifier, p: Pt): number {
  const c = ringCentre(m.ring);
  const a = (m.slopeAngle * Math.PI) / 180;
  return m.elevation + m.slope * ((p.x - c.x) * Math.cos(a) + (p.y - c.y) * Math.sin(a));
}

/** Points along a ring, no further apart than `step`, without its corners doubled. */
export function along(ring: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const parts = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < parts; k++) out.push({ x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts });
  }
  return out;
}

function againstRing(p: Pt, ring: readonly Pt[], reach: number): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < reach) return true;
  }
  return false;
}

function againstLine(p: Pt, line: readonly Pt[], reach: number): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < reach) return true;
  }
  return false;
}

/** What an edited contour leaves behind: the ground along its old line, and between that and its new one. */
function replacedBy(m: SiteModifier, at: Pt, step: number): boolean {
  if (!m.old) return false;
  if (againstLine(at, m.old, step)) return true;
  const [first, last] = [m.ring[0], m.ring[m.ring.length - 1]];
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < 1;
  return closed ? pointInPolygon(at, m.ring) !== pointInPolygon(at, m.old) : pointInPolygon(at, [...m.old, ...[...m.ring].reverse()]);
}

const signedArea = (ring: readonly Pt[]): number => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;

/** How high a line modifier is, this far along it: from one height to the other when it has two, or on its plane. */
function lineHeightAt(m: SiteModifier, p: Pt, run: number, whole: number): number {
  return m.end === undefined ? padHeight(m, p) : m.elevation + (whole > 0 ? ((m.end - m.elevation) * run) / whole : 0);
}

const pathLength = (line: readonly Pt[]): number => line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - line[i].x, p.y - line[i].y), 0);

/** Points along a line modifier with their heights. */
function lineHeights(m: SiteModifier, step: number): Pt3[] {
  const line = m.ring;
  const whole = pathLength(line);
  const out: Pt3[] = [];
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const parts = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < parts; k++) {
      const q = { x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts };
      out.push([q.x, q.y, lineHeightAt(m, q, run + (len * k) / parts, whole)]);
    }
    run += len;
  }
  const last = line[line.length - 1];
  out.push([last.x, last.y, lineHeightAt(m, last, whole, whole)]);
  return out;
}

/** Where a point falls nearest on a line of points: the distance along it, how far off, and the segment. */
function nearestOn(p: Pt, line: readonly Pt[], closed: boolean): { run: number; off: number; segment: number; t: number } {
  let best = { run: 0, off: Infinity, segment: 0, t: 0 };
  let run = 0;
  const count = closed ? line.length : line.length - 1;
  for (let i = 0; i < count; i++) {
    const [a, b] = [line[i], line[(i + 1) % line.length]];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const len = Math.hypot(dx, dy);
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const off = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
    if (off < best.off) best = { run: run + len * t, off, segment: i, t };
    run += len;
  }
  return best;
}

const nearestSample = (samples: readonly Pt3[], p: Pt): number => {
  let [best, far] = [0, Infinity];
  for (const q of samples) {
    const d = (q[0] - p.x) ** 2 + (q[1] - p.y) ** 2;
    if (d < far) [best, far] = [q[2], d];
  }
  return best;
};

/** How high the top of a pad or an aligned modifier is at a place: its plane, or along its ring's corners. */
function topHeight(m: SiteModifier, p: Pt): number {
  if (m.samples) return nearestSample(m.samples, p);
  if (!m.heights) return padHeight(m, p);
  const near = nearestOn(p, m.ring, true);
  const [a, b] = [m.heights[near.segment], m.heights[(near.segment + 1) % m.ring.length]];
  return a + (b - a) * near.t;
}

/** An aligned modifier's corners take the height of what they touch, the last drawn first, or else its own elevation. */
export function alignedHeights(ring: readonly Pt[], others: readonly SiteModifier[], own: number, reach: number): number[] {
  return ring.map((v) => {
    for (const m of [...others].reverse()) {
      if (m.kind === "pad" && (pointInPolygon(v, m.ring) || againstRing(v, m.ring, reach))) return padHeight(m, v);
      if (m.samples && (pointInPolygon(v, m.ring) || againstRing(v, m.ring, reach))) return nearestSample(m.samples, v);
      if (m.kind === "line") {
        const near = nearestOn(v, m.ring, false);
        if (near.off <= reach) return lineHeightAt(m, v, near.run, pathLength(m.ring));
      }
    }
    return own;
  });
}

/** A surface's part within an outline, with new points along the outline so that it ends there. */
export function clippedSurface(surface: Surface, heightAt: HeightAt, ring: readonly Pt[]): Surface | null {
  const points: Pt3[] = [];
  for (const q of along(ring, modifierStep(surface))) {
    const z = heightAt(q.x, q.y);
    if (z !== null) points.push([q.x, q.y, z]);
  }
  for (const p of surface.points) if (pointInPolygon({ x: p[0], y: p[1] }, ring)) points.push(p);
  return surfaceOf(points, ring);
}

/** How much of a swale's or berm's height reaches `t` of the way out from its middle to its edge. */
function swaleWeight(profile: SwaleProfile, t: number): number {
  if (t >= 1) return 0;
  if (profile === "Sharp") return 1 - t;
  if (profile === "Flat") return t <= 0.5 ? 1 : (1 - t) * 2;
  return Math.cos((t * Math.PI) / 2) ** 2;
}

/** How much a sculpt or a swale moves the ground at a place. */
function editDelta(m: SiteModifier, heightAt: HeightAt, p: Pt, ground: number): number {
  const sculpt = m.sculpt;
  if (sculpt?.elements) return sculpt.elements.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 1) ? m.elevation : 0;
  if (sculpt) {
    const r = Math.hypot(p.x - sculpt.centre.x, p.y - sculpt.centre.y);
    if (r >= sculpt.radius) return 0;
    if (sculpt.soft === null) return m.elevation;
    const inner = sculpt.radius * (1 - sculpt.soft);
    return r <= inner ? m.elevation : m.elevation * Math.cos((((r - inner) / (sculpt.radius - inner)) * Math.PI) / 2) ** 2;
  }
  const swale = m.swale;
  if (swale) {
    const near = nearestOn(p, m.ring, false);
    const weight = swaleWeight(swale.profile, near.off / (swale.width / 2));
    if (weight === 0) return 0;
    if (swale.follow) return m.elevation * weight;
    const [first, last] = [m.ring[0], m.ring[m.ring.length - 1]];
    const [a, b] = [heightAt(first.x, first.y) ?? ground, heightAt(last.x, last.y) ?? ground];
    const whole = pathLength(m.ring);
    return (a + (whole > 0 ? ((b - a) * near.run) / whole : 0) + m.elevation - ground) * weight;
  }
  return 0;
}

/** The new points a surface edit wants, so that the ground has the detail to take its shape. */
function editExtras(m: SiteModifier): Pt[] {
  if (m.kind === "vertex") return [...m.ring];
  const sculpt = m.sculpt;
  if (sculpt?.elements) return [...sculpt.elements];
  if (sculpt) {
    const { centre, radius, spacing } = sculpt;
    const out: Pt[] = [centre];
    for (let i = 0; i < 32; i++) out.push({ x: centre.x + radius * Math.cos((i * Math.PI) / 16), y: centre.y + radius * Math.sin((i * Math.PI) / 16) });
    if (spacing) {
      // in rows, every other one shifted by half
      const gap = Math.max(spacing, radius / 40);
      const rows = Math.floor(radius / (gap * 0.866));
      for (let j = -rows; j <= rows; j++) {
        const y = j * gap * 0.866;
        const across = Math.floor(radius / gap) + 1;
        for (let i = -across; i <= across; i++) {
          const x = (i + (j % 2 ? 0.5 : 0)) * gap;
          if (Math.hypot(x, y) < radius) out.push({ x: centre.x + x, y: centre.y + y });
        }
      }
    }
    return out;
  }
  const swale = m.swale;
  if (!swale) return [];
  const out: Pt[] = [];
  const half = swale.width / 2;
  const gap = half / 2;
  for (let i = 0; i + 1 < m.ring.length; i++) {
    const [a, b] = [m.ring[i], m.ring[i + 1]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 0) continue;
    const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
    const parts = Math.max(1, Math.ceil(len / gap));
    for (let k = 0; k <= parts; k++) {
      const c = { x: a.x + ux * ((len * k) / parts), y: a.y + uy * ((len * k) / parts) };
      for (const share of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) out.push({ x: c.x - uy * half * share, y: c.y + ux * half * share });
    }
  }
  return out;
}

/** The kinds that change a surface where it stands, before the other modifiers act on it. */
export const SURFACE_EDITS: ReadonlySet<ModifierKind> = new Set<ModifierKind>(["sculpt", "swale", "vertex"]);

/** A surface's points with its sculpts, swales and new vertices in them. */
export function editedPoints(surface: Surface, heightAt: HeightAt, edits: readonly SiteModifier[]): Pt3[] {
  const moved = (x: number, y: number, ground: number): Pt3 => [x, y, edits.reduce((z, m) => z + editDelta(m, heightAt, { x, y }, ground), ground)];
  const out = surface.points.map((p) => moved(p[0], p[1], p[2]));
  for (const m of edits) {
    for (const q of editExtras(m)) {
      const ground = heightAt(q.x, q.y);
      if (ground !== null) out.push(moved(q.x, q.y, ground));
    }
  }
  return out;
}

/** The vertices nearest a place: one close by, the two ends of an edge, or else the triangle's three. */
export function surfaceElement(surface: Surface, p: Pt, near: number): Pt[] {
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]].map((q) => ({ x: q[0], y: q[1] }));
    if (!pointInPolygon(p, corners) && !corners.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= near)) continue;
    const close = corners.find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= near);
    if (close) return [close];
    for (let i = 0; i < 3; i++) {
      const [a, b] = [corners[i], corners[(i + 1) % 3]];
      if (nearestOn(p, [a, b], false).off <= near / 2) return [a, b];
    }
    return corners;
  }
  return [];
}

/** A surface's part within an outline, as flat x,y,z triangles raised by `lift`: a texture bed's ground. */
export function drapedFaces(surface: Surface, heightAt: HeightAt, ring: readonly Pt[], lift: number): number[][] {
  const bed = clippedSurface(surface, heightAt, ring);
  if (!bed) return [];
  const out: number[][] = [];
  for (let t = 0; t < bed.triangles.length; t += 3) out.push([0, 1, 2].flatMap((c) => {
    const p = bed.points[bed.triangles[t + c]];
    return [p[0], p[1], p[2] + lift];
  }));
  return out;
}

/** The surface's edge, as lines of indices into its points: each edge only one triangle has. */
function edgeLoops(surface: Surface): number[][] {
  const { triangles } = surface;
  const seen = new Set<string>();
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = triangles[t + e];
      const b = triangles[t + (e + 1) % 3];
      const back = `${b},${a}`;
      if (seen.has(back)) seen.delete(back);
      else seen.add(`${a},${b}`);
    }
  }
  const next = new Map<number, number>();
  for (const key of seen) {
    const [a, b] = key.split(",").map(Number);
    next.set(a, b);
  }
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let at: number | undefined = start;
    while (at !== undefined && !used.has(at)) {
      used.add(at);
      loop.push(at);
      at = next.get(at);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** The site's border in plan: each ring of the surface's edge. */
export const borderRings = (surface: Surface): Pt[][] => edgeLoops(surface).map((loop) => loop.map((i) => ({ x: surface.points[i][0], y: surface.points[i][1] })));

/** How far apart the points on a modifier's outline are. */
export const modifierStep = (existing: Surface): number => {
  const box = boxOf(existing);
  return Math.max(Math.max(box.x1 - box.x0, box.y1 - box.y0) / 300, 1);
};

/**
 * The points of the proposed surface. Grade limits take out what's inside them and hold their outline at the
 * existing surface, so the ground between them and what they enclose is sloped afresh; pads take out what's
 * inside them and bring their outline to their own height. The site's edge stays where it is.
 */
export function proposedPoints(existing: Surface, heightAt: HeightAt, modifiers: readonly SiteModifier[]): Pt3[] {
  const step = modifierStep(existing);
  const edge = new Set(edgeLoops(existing).flat());
  const limits = modifiers.filter((m) => m.kind === "limits");
  const pads = modifiers.filter((m) => m.kind === "pad" || m.kind === "aligned" || m.kind === "path");
  const lines = modifiers.filter((m) => m.kind === "line" || m.kind === "contour");
  const spoils = modifiers.filter((m) => m.kind === "spoil");
  const working = modifiers.filter((m) => m.kind !== "bed");
  const out: Pt3[] = [];
  existing.points.forEach((p, i) => {
    const at = { x: p[0], y: p[1] };
    // the last drawn on top
    const pad = [...pads].reverse().find((m) => pointInPolygon(at, m.ring));
    const spoil = spoils.find((m) => pointInPolygon(at, m.ring));
    const raised: Pt3 = spoil ? [p[0], p[1], p[2] + spoil.elevation] : p;
    if (edge.has(i)) {
      out.push(pad ? [p[0], p[1], topHeight(pad, at)] : raised);
      return;
    }
    // what stands on or against an outline would pull that outline's height about
    if (!pad && !limits.some((m) => pointInPolygon(at, m.ring)) && !working.some((m) => (m.kind === "line" || m.kind === "contour" ? againstLine(at, m.ring, step) || replacedBy(m, at, step) : againstRing(at, m.ring, step)))) out.push(raised);
  });
  const pending: Pt3[] = [];
  for (const m of pads) {
    if (m.samples) pending.push(...m.samples.filter((q) => heightAt(q[0], q[1]) !== null));
    else for (const q of along(m.ring, step)) if (heightAt(q.x, q.y) !== null) pending.push([q.x, q.y, topHeight(m, q)]);
  }
  for (const m of limits) {
    for (const q of along(m.ring, step)) {
      const z = heightAt(q.x, q.y);
      // a pad reaching over the limit keeps its own height
      if (z !== null && !pads.some((pad) => pointInPolygon(q, pad.ring))) pending.push([q.x, q.y, m.level ?? z]);
    }
  }
  for (const m of spoils) {
    for (const q of along(m.ring, step)) {
      const z = heightAt(q.x, q.y);
      if (z !== null) pending.push([q.x, q.y, z + m.elevation]);
    }
    // the ground meets it again just outside
    const around = offsetPolyline(m.ring, true, signedArea(m.ring) > 0 ? -step : step);
    for (const q of around ? along(around, step) : []) {
      const z = heightAt(q.x, q.y);
      if (z !== null && !pointInPolygon(q, m.ring)) pending.push([q.x, q.y, z]);
    }
  }
  for (const m of lines) pending.unshift(...lineHeights(m, step).filter((q) => heightAt(q[0], q[1]) !== null));
  // before the others, so that the outlines win where a point stood already
  return [...pending, ...out];
}

/** The flat points inside a boundary and along it, on a grid of this spacing from an origin. */
export function boundaryPoints(ring: readonly Pt[], spacing: number, origin: Pt, z = 0): Pt3[] {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  // the outline twice as close as the grid, and the grid kept off it, so that the triangles keep to it
  const out: Pt3[] = along(ring, spacing / 2).map((p): Pt3 => [p.x, p.y, z]);
  const i0 = Math.ceil((Math.min(...xs) - origin.x) / spacing);
  const i1 = Math.floor((Math.max(...xs) - origin.x) / spacing);
  const j0 = Math.ceil((Math.min(...ys) - origin.y) / spacing);
  const j1 = Math.floor((Math.max(...ys) - origin.y) / spacing);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const p = { x: origin.x + i * spacing, y: origin.y + j * spacing };
      if (pointInPolygon(p, ring) && !againstRing(p, ring, spacing / 2)) out.push([p.x, p.y, z]);
    }
  }
  return out;
}

/** A triangle as a face for a mesh, in plan and height. */
const faceOf = (a: Pt3, b: Pt3, c: Pt3, lift: number): number[] => [a[0], a[1], a[2] + lift, b[0], b[1], b[2] + lift, c[0], c[1], c[2] + lift];

/** The surface's faces, grouped by a band each triangle falls in. */
export function facesByBand(surface: Surface, bandOf: (a: Pt3, b: Pt3, c: Pt3) => number, lift = 0): Map<number, number[][]> {
  const out = new Map<number, number[][]>();
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const band = bandOf(a, b, c);
    const face = faceOf(a, b, c, lift);
    const list = out.get(band);
    if (list) list.push(face);
    else out.set(band, [face]);
  }
  return out;
}

/** Sides down to `base` and a bottom, to close a surface into a solid. */
export function skirtFaces(surface: Surface, base: number, lift = 0): number[][] {
  const faces: number[][] = [];
  for (const loop of edgeLoops(surface)) {
    loop.forEach((i, k) => {
      const a = surface.points[i];
      const b = surface.points[loop[(k + 1) % loop.length]];
      faces.push([a[0], a[1], a[2] + lift, a[0], a[1], base + lift, b[0], b[1], base + lift, b[0], b[1], b[2] + lift]);
    });
  }
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    faces.push([a[0], a[1], base + lift, c[0], c[1], base + lift, b[0], b[1], base + lift]);
  }
  return faces;
}

function clippedAt(ring: readonly Pt3[], level: number, above: boolean): Pt3[] {
  const out: Pt3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const pIn = above ? p[2] >= level : p[2] <= level;
    const qIn = above ? q[2] >= level : q[2] <= level;
    if (pIn) out.push(p);
    if (pIn !== qIn) {
      const t = (level - p[2]) / (q[2] - p[2]);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, level]);
    }
  }
  return out;
}

export interface BandPiece {
  /** 0 below the first level, 1 from it to the next, and so on */
  readonly band: number;
  readonly ring: readonly Pt3[];
}

/** The surface cut along levels (rising) into pieces, each in one band between two of them. */
export function bandPieces(surface: Surface, levels: readonly number[]): BandPiece[] {
  const out: BandPiece[] = [];
  const { points, triangles } = surface;
  for (let t = 0; t < triangles.length; t += 3) {
    let rest: Pt3[] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const low = Math.min(rest[0][2], rest[1][2], rest[2][2]);
    const high = Math.max(rest[0][2], rest[1][2], rest[2][2]);
    for (let band = 0; band <= levels.length; band++) {
      const top = levels[band];
      if (top === undefined || high <= top) {
        out.push({ band, ring: rest });
        break;
      }
      if (low >= top) continue;
      const below = clippedAt(rest, top, false);
      if (below.length >= 3) out.push({ band, ring: below });
      rest = clippedAt(rest, top, true);
      if (rest.length < 3) break;
    }
  }
  return out;
}

const flatFace = (ring: readonly Pt3[], z: number, lift: number): number[] => ring.flatMap((p) => [p[0], p[1], z + lift]);

/** A layer cake: flat tops at each level, walls rising along the contours, and sides down to the base. */
export function terracedFaces(surface: Surface, levels: readonly number[], base: number, lift = 0): { band: number; face: number[] }[] {
  const out: { band: number; face: number[] }[] = [];
  const topOf = (band: number): number => (band > 0 ? levels[band - 1] : base);
  for (const piece of bandPieces(surface, levels)) out.push({ band: piece.band, face: flatFace(piece.ring, topOf(piece.band), lift) });
  levels.forEach((level, i) => {
    for (const line of contourLines(surface, level)) {
      const n = line.points.length;
      for (let k = 0; k < (line.closed ? n : n - 1); k++) {
        const a = line.points[k];
        const b = line.points[(k + 1) % n];
        out.push({ band: i, face: [a.x, a.y, topOf(i) + lift, b.x, b.y, topOf(i) + lift, b.x, b.y, level + lift, a.x, a.y, level + lift] });
      }
    }
  });
  for (const loop of edgeLoops(surface)) {
    loop.forEach((index, k) => {
      const a = surface.points[index];
      const b = surface.points[loop[(k + 1) % loop.length]];
      // along the edge, a step at each level it crosses
      const crossings = levels.filter((l) => (a[2] - l) * (b[2] - l) < 0).map((l) => (l - a[2]) / (b[2] - a[2]));
      const stops = [0, ...crossings.sort((x, y) => x - y), 1];
      for (let i = 0; i + 1 < stops.length; i++) {
        const mid = a[2] + (b[2] - a[2]) * ((stops[i] + stops[i + 1]) / 2);
        const band = levels.filter((l) => l <= mid).length;
        const top = topOf(band);
        if (top <= base) continue;
        const [x0, y0] = [a[0] + (b[0] - a[0]) * stops[i], a[1] + (b[1] - a[1]) * stops[i]];
        const [x1, y1] = [a[0] + (b[0] - a[0]) * stops[i + 1], a[1] + (b[1] - a[1]) * stops[i + 1]];
        out.push({ band, face: [x0, y0, base + lift, x1, y1, base + lift, x1, y1, top + lift, x0, y0, top + lift] });
      }
    });
  }
  return out;
}

export interface GridCell {
  /** its corners at the surface's height, counter-clockwise from above */
  readonly corners: readonly [Pt3, Pt3, Pt3, Pt3];
}

/** The square cells of a grid whose corners are all on the surface. */
export function gridCells(heightAt: HeightAt, box: Box, spacing: number): GridCell[] {
  const nx = Math.max(1, Math.ceil((box.x1 - box.x0) / spacing));
  const ny = Math.max(1, Math.ceil((box.y1 - box.y0) / spacing));
  const out: GridCell[] = [];
  const corner = (i: number, j: number): Pt3 | null => {
    const x = Math.min(box.x1, box.x0 + i * spacing);
    const y = Math.min(box.y1, box.y0 + j * spacing);
    const z = heightAt(x, y);
    return z === null ? null : [x, y, z];
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const [a, b, c, d] = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
      if (a && b && c && d) out.push({ corners: [a, b, c, d] });
    }
  }
  return out;
}

export const cellHeight = (cell: GridCell): number => (cell.corners[0][2] + cell.corners[1][2] + cell.corners[2][2] + cell.corners[3][2]) / 4;

/** A cell's surface, as it is. */
export const cellFace = (cell: GridCell, lift = 0): number[] => cell.corners.flatMap((p) => [p[0], p[1], p[2] + lift]);

/** A cell as a column from the base up to a flat top at its middle height. */
export function columnFaces(cell: GridCell, base: number, lift = 0): number[][] {
  const top = cellHeight(cell) + lift;
  const low = base + lift;
  const c = cell.corners;
  const faces = [c.flatMap((p) => [p[0], p[1], top])];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    faces.push([a[0], a[1], low, b[0], b[1], low, b[0], b[1], top, a[0], a[1], top]);
  }
  return faces;
}

/** The most arrows flowArrows draws: past this they go further apart. */
const MAX_ARROWS = 2500;

/** Arrows pointing down the slope, on a grid; as line segments. */
export function flowArrows(heightAt: HeightAt, box: Box, wanted: number, scaled: boolean): [Pt, Pt][] {
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  const spacing = Math.max(wanted, Math.sqrt(area / MAX_ARROWS));
  const out: [Pt, Pt][] = [];
  const reach = spacing / 4;
  for (let x = box.x0 + spacing / 2; x < box.x1; x += spacing) {
    for (let y = box.y0 + spacing / 2; y < box.y1; y += spacing) {
      const [e, w, n, s] = [heightAt(x + reach, y), heightAt(x - reach, y), heightAt(x, y + reach), heightAt(x, y - reach)];
      if (e === null || w === null || n === null || s === null) continue;
      const dx = (w - e) / (2 * reach);
      const dy = (s - n) / (2 * reach);
      const slope = Math.hypot(dx, dy);
      if (slope < 0.001) continue;
      const length = spacing * (scaled ? 0.2 + 0.5 * Math.min(1, slope / 0.33) : 0.5);
      const ux = dx / slope;
      const uy = dy / slope;
      const from = { x: x - (ux * length) / 2, y: y - (uy * length) / 2 };
      const to = { x: x + (ux * length) / 2, y: y + (uy * length) / 2 };
      const head = Math.min(length * 0.35, spacing * 0.12);
      out.push([from, to]);
      out.push([to, { x: to.x + head * (-ux * 0.87 - uy * 0.5), y: to.y + head * (-uy * 0.87 + ux * 0.5) }]);
      out.push([to, { x: to.x + head * (-ux * 0.87 + uy * 0.5), y: to.y + head * (-uy * 0.87 - ux * 0.5) }]);
    }
  }
  return out;
}

/** A surface of how far proposed stands above existing, over every point of either. */
export function differenceSurface(existing: Surface, proposed: Surface, existingAt: HeightAt, proposedAt: HeightAt, border?: readonly Pt[] | null): Surface | null {
  const points: Pt3[] = [];
  for (const p of [...proposed.points, ...existing.points]) {
    const was = existingAt(p[0], p[1]);
    const now = proposedAt(p[0], p[1]);
    if (was !== null && now !== null) points.push([p[0], p[1], now - was]);
  }
  return surfaceOf(points, border);
}

export const slopePercent = (a: Pt3, b: Pt3, c: Pt3): number => {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const nz = ux * vy - uy * vx;
  return nz === 0 ? Number.POSITIVE_INFINITY : (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz) / Math.abs(nz)) * 100;
};

/** the slope analysis' categories' top slopes, percent; steeper is one more */
export const SLOPE_CATEGORIES: readonly number[] = [5, 10, 20, 33];

export const slopeBand = (a: Pt3, b: Pt3, c: Pt3): number => {
  const percent = slopePercent(a, b, c);
  const i = SLOPE_CATEGORIES.findIndex((top) => percent <= top);
  return i < 0 ? SLOPE_CATEGORIES.length : i;
};

/** the elevation analysis' number of bands */
export const ELEVATION_BANDS = 8;

export const elevationBand = (z: number, min: number, max: number): number => (max > min ? Math.min(ELEVATION_BANDS - 1, Math.max(0, Math.floor(((z - min) / (max - min)) * ELEVATION_BANDS))) : 0);

/** A contour interval of 1, 2 or 5 of a unit (mm) times a power of ten that gives about ten contours. */
export function niceInterval(range: number, unit: number): number {
  if (!(range > 0)) return unit;
  const want = range / unit / 10;
  const power = 10 ** Math.floor(Math.log10(want));
  const steps = [1, 2, 5, 10].map((k) => k * power);
  return (steps.find((k) => k >= want) ?? steps[3]) * unit;
}

/** Points as text, a tenth of a mm enough, to keep in a text field. */
export const packPoints = (points: readonly (readonly number[])[]): string => points.map((p) => p.map((v) => Math.round(v * 10) / 10).join(" ")).join("\n");

export const unpackPoints = (text: string): number[][] =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ").map(Number));
