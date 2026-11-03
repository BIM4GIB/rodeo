// The sums behind AEC > Terrain's grading commands: grade limits around a pad, a pad balanced inside grade limits,
// a section's profiles and the cut and fill of each triangle. Plain data in and out (siteCommands.ts draws them).

import type { Pt } from "../core/index.ts";
import { pointInPolygon } from "./geom.ts";
import { along, boxOf, heightLookup, padHeight, surfaceOf, type HeightAt, type Pt3, type SiteModifier, type Surface } from "./siteModelShapes.ts";

export const SLOPE_METHODS = ["Angular", "Rise-over-run", "Percent"] as const;
export type SlopeMethod = (typeof SLOPE_METHODS)[number];

/** A slope as typed, as rise over run; null when it isn't one a batter can take: over nothing, and short of a wall. */
export function readSlope(text: string, method: SlopeMethod): number | null {
  const t = text.trim();
  if (method === "Rise-over-run") {
    const ratio = /^([0-9.]+)\s*:\s*([0-9.]+)$/.exec(t);
    const value = ratio ? Number(ratio[1]) / Number(ratio[2]) : Number(t);
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const value = Number(t.replace(/[°%]\s*$/, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (method === "Percent") return value / 100;
  return value < 90 ? Math.tan((value * Math.PI) / 180) : null;
}

const brief = (n: number): string => String(Math.round(n * 100) / 100);

export function slopeText(slope: number, method: SlopeMethod): string {
  if (method === "Percent") return `${brief(slope * 100)}%`;
  if (method === "Rise-over-run") return `1:${brief(1 / slope)}`;
  return `${brief((Math.atan(slope) * 180) / Math.PI)}°`;
}

const ringArea = (ring: readonly Pt[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % ring.length]];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

const turn = (a: Pt, b: Pt, c: Pt): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Whether any two sides of a ring that don't share a corner cross. */
export function ringCrosses(ring: readonly Pt[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % n]];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [c, d] = [ring[j], ring[(j + 1) % n]];
      if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** A ring's corners without doubled points or its first repeated at the end. */
function corners(ring: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 0.01) out.pop();
  return out;
}

export interface LimitOptions {
  /** the fixed distance, or the furthest a slope may reach */
  readonly offset: number;
  /** the batter's rise over run, or null for the fixed distance */
  readonly slope: number | null;
  /** how far apart the points tested along each side are, or null for the corners alone */
  readonly increment: number | null;
}

/** How far out from a pad's edge a batter meets the ground: at the first place the slope from the pad gets there. */
function batterReach(from: Pt, out: Pt, z: number, slope: number, offset: number, heightAt: HeightAt): number {
  const steps = 120;
  const step = offset / steps;
  let was = Math.abs((heightAt(from.x, from.y) ?? z) - z);
  for (let k = 1; k <= steps; k++) {
    const d = k * step;
    const ground = heightAt(from.x + out.x * d, from.y + out.y * d);
    // stops at the site's edge
    if (ground === null) return Math.max(step, d - step);
    const gap = Math.abs(ground - z) - slope * d;
    if (gap <= 0) return Math.max(step, d - step + (step * was) / (was - gap || 1));
    was = gap;
  }
  return offset;
}

/**
 * The outline of grade limits around a pad, at a fixed distance or where a slope from the pad meets the ground;
 * null when it would cross itself. Corners go out on their mitre, so that the sides stay that far off.
 */
export function limitsAround(pad: SiteModifier, heightAt: HeightAt, o: LimitOptions): Pt[] | null {
  const ring = corners(pad.ring);
  if (ring.length < 3) return null;
  const sign = ringArea(ring) >= 0 ? 1 : -1;
  const n = ring.length;
  const normal = (i: number): Pt => {
    const [a, b] = [ring[i % n], ring[(i + 1) % n]];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // out of the ring: to the right of a counter-clockwise side
    return { x: (sign * (b.y - a.y)) / len, y: (-sign * (b.x - a.x)) / len };
  };
  const out: Pt[] = [];
  const test = (from: Pt, dir: Pt, mitre: number): void => {
    const z = padHeight(pad, from);
    const mitred = { x: dir.x * mitre, y: dir.y * mitre };
    const d = o.slope === null ? o.offset : batterReach(from, mitred, z, o.slope, o.offset, heightAt);
    out.push({ x: from.x + mitred.x * d, y: from.y + mitred.y * d });
  };
  for (let i = 0; i < n; i++) {
    const [was, now] = [normal(i + n - 1), normal(i)];
    const [bx, by] = [was.x + now.x, was.y + now.y];
    const len = Math.hypot(bx, by);
    const dir = len > 1e-6 ? { x: bx / len, y: by / len } : now;
    // a sharp corner isn't taken out as far as its mitre would go
    test(ring[i], dir, 1 / Math.max(0.5, dir.x * now.x + dir.y * now.y));
    if (o.slope === null || o.increment === null || !(o.increment > 0)) continue;
    const [a, b] = [ring[i], ring[(i + 1) % n]];
    const parts = Math.min(400, Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / o.increment)));
    for (let k = 1; k < parts; k++) test({ x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts }, now, 1);
  }
  return ringCrosses(out) ? null : out;
}

export interface BalancedPad {
  readonly ring: Pt[];
  readonly elevation: number;
  readonly cut: number;
  readonly fill: number;
}

/**
 * A level pad inside grade limits at the height that balances cut and fill, each side back from the limit by what
 * its batter slope takes to come down from the pad to the ground along that side. "outside" when the limits leave
 * the surface; "too low" when the slopes leave no room for the pad at that height. Slopes are per side of the ring
 * as given, rise over run. `step` is how the update will sample the outlines.
 */
export function balancedPad(limit: readonly Pt[], heightAt: HeightAt, slopes: readonly number[], step: number): BalancedPad | "outside" | "too low" {
  const ring = corners(limit);
  const n = ring.length;
  if (n < 3) return "outside";
  const sign = ringArea(ring) >= 0 ? 1 : -1;
  const samples = along(ring, step);
  const outline: Pt3[] = [];
  for (const q of samples) {
    const z = heightAt(q.x, q.y);
    if (z === null) return "outside";
    outline.push([q.x, q.y, z]);
  }
  const grounds: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % n]];
    const parts = Math.min(60, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)));
    const list: number[] = [];
    for (let k = 0; k <= parts; k++) {
      const z = heightAt(a.x + ((b.x - a.x) * k) / parts, a.y + ((b.y - a.y) * k) / parts);
      if (z === null) return "outside";
      list.push(z);
    }
    grounds.push(list);
  }
  const sides = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { a, u, inward: { x: -sign * u.y, y: sign * u.x } };
  });
  /** The pad's outline at a height, or null when it no longer fits. */
  const padAt = (elevation: number): Pt[] | null => {
    const lines = sides.map((side, i) => {
      // always a little way in, to stay off the limit's own outline
      const back = Math.max(0.5, Math.max(...grounds[i].map((z) => Math.abs(elevation - z))) / (slopes[i] || 1e-9));
      return { x: side.a.x + side.inward.x * back, y: side.a.y + side.inward.y * back, u: side.u };
    });
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const [p, q] = [lines[(i + n - 1) % n], lines[i]];
      const cross = p.u.x * q.u.y - p.u.y * q.u.x;
      if (Math.abs(cross) < 1e-6) out.push({ x: q.x, y: q.y });
      else {
        const t = ((q.x - p.x) * q.u.y - (q.y - p.y) * q.u.x) / cross;
        out.push({ x: p.x + p.u.x * t, y: p.y + p.u.y * t });
      }
    }
    for (let i = 0; i < n; i++) {
      const [a, b] = [out[i], out[(i + 1) % n]];
      if ((b.x - a.x) * sides[i].u.x + (b.y - a.y) * sides[i].u.y <= 0) return null;
    }
    if (ringCrosses(out) || ringArea(out) * sign <= 0) return null;
    return out.every((p) => pointInPolygon(p, ring)) ? out : null;
  };
  // the ground inside, on a grid, to weigh the two against
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const across = 96;
  const [w, h] = [(x1 - x0) / across, (y1 - y0) / across];
  const inside: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < across; j++) {
      const p = { x: x0 + (i + 0.5) * w, y: y0 + (j + 0.5) * h };
      if (!pointInPolygon(p, ring)) continue;
      const z = heightAt(p.x, p.y);
      if (z !== null) inside.push({ x: p.x, y: p.y, z });
    }
  }
  if (!inside.length) return "outside";
  const mean = inside.reduce((sum, p) => sum + p.z, 0) / inside.length;
  const weigh = (elevation: number, pad: readonly Pt[]): { cut: number; fill: number } => {
    const padPoints = along(pad, step).map((q): Pt3 => [q.x, q.y, elevation]);
    const surface = surfaceOf([...padPoints, ...outline], ring);
    const at = surface ? heightLookup(surface) : null;
    let [cut, fill] = [0, 0];
    for (const p of inside) {
      const now = at?.(p.x, p.y) ?? p.z;
      if (now > p.z) fill += (now - p.z) * w * h;
      else cut += (p.z - now) * w * h;
    }
    return { cut, fill };
  };
  let lo = Math.min(...inside.map((p) => p.z), ...outline.map((p) => p[2]));
  let hi = Math.max(...inside.map((p) => p.z), ...outline.map((p) => p[2]));
  for (let k = 0; k < 40 && hi - lo > 0.5; k++) {
    const mid = (lo + hi) / 2;
    const pad = padAt(mid);
    // beyond where it fits, the way back is towards the ground's middle
    const net = pad ? (({ cut, fill }) => fill - cut)(weigh(mid, pad)) : mid - mean;
    if (net > 0) hi = mid;
    else lo = mid;
  }
  const elevation = (lo + hi) / 2;
  const pad = padAt(elevation);
  if (!pad) return "too low";
  const { cut, fill } = weigh(elevation, pad);
  // cornered at the edge of where it fits, it isn't balanced at all
  if (Math.abs(fill - cut) > Math.max(cut + fill, 1) * 0.1) return "too low";
  return { ring: pad, elevation, cut, fill };
}

export interface ProfilePoint {
  readonly station: number;
  readonly z: number | null;
}

/** How long a line is up to each of its corners. */
export function stationsOf(line: readonly Pt[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  return out;
}

/** The surface's height along a line: at its corners, and evenly between. */
export function sectionProfile(line: readonly Pt[], heightAt: HeightAt, samples = 800): ProfilePoint[] {
  const at = stationsOf(line);
  const total = at[at.length - 1];
  const step = total / samples || 1;
  const out: ProfilePoint[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    const len = at[i + 1] - at[i];
    const parts = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < parts; k++) {
      const t = k / parts;
      out.push({ station: at[i] + len * t, z: heightAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) });
    }
  }
  const end = line[line.length - 1];
  out.push({ station: total, z: heightAt(end.x, end.y) });
  return out;
}

/** Where a station is on a line. */
export function pointAtStation(line: readonly Pt[], station: number): Pt {
  const at = stationsOf(line);
  for (let i = 0; i + 1 < line.length; i++) {
    if (station > at[i + 1] && i + 2 < line.length) continue;
    const t = at[i + 1] > at[i] ? (station - at[i]) / (at[i + 1] - at[i]) : 0;
    return { x: line[i].x + (line[i + 1].x - line[i].x) * t, y: line[i].y + (line[i + 1].y - line[i].y) * t };
  }
  return line[0];
}

/** The stations a section marks: the two ends, the line's corners if asked and every interval if asked. */
export function sectionStations(line: readonly Pt[], atCorners: boolean, interval: number | null): number[] {
  const at = stationsOf(line);
  const total = at[at.length - 1];
  const all = [0, total, ...(atCorners ? at : [])];
  if (interval !== null && interval > 0) for (let d = interval, k = 0; d < total && k < 2000; d += interval, k++) all.push(d);
  const close = Math.max(total / 1e5, 0.01);
  return all.sort((a, b) => a - b).filter((d, i, list) => i === 0 || d - list[i - 1] > close);
}

export interface TriangleFigures {
  readonly index: number;
  readonly corners: readonly [Pt3, Pt3, Pt3];
  readonly centre: Pt;
  readonly projected: number;
  readonly existingArea: number;
  readonly proposedArea: number;
  readonly existingVolume: number;
  readonly proposedVolume: number;
  /** ground taken away, mm³ */
  readonly cut: number;
  /** ground brought in, mm³ */
  readonly fill: number;
}

const area3 = (a: Pt3, b: Pt3, c: Pt3): number => {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
};

/**
 * Each triangle of the proposed surface and what's under it. The existing surface doesn't share its triangles, so
 * it's read at a grid of points in each one, as fine as the site's size asks for: the pieces of a big triangle are
 * no bigger than a small one's. Volumes run down to the datum, as the model's own figures do.
 */
export function triangleFigures(proposed: Surface, existingAt: HeightAt, datum: number): TriangleFigures[] {
  const out: TriangleFigures[] = [];
  const { points, triangles } = proposed;
  const box = boxOf(proposed);
  const reach = Math.max(box.x1 - box.x0, box.y1 - box.y0) / 128 || 1;
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [points[triangles[t]], points[triangles[t + 1]], points[triangles[t + 2]]];
    const plan = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    const longest = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
    const parts = Math.min(48, Math.max(2, Math.ceil(longest / reach)));
    // the grid's points, row by row: both surfaces' heights at each
    const grid: { was: Pt3; now: number }[][] = [];
    for (let i = 0; i <= parts; i++) {
      const row: { was: Pt3; now: number }[] = [];
      for (let j = 0; j <= parts - i; j++) {
        const [u, v] = [i / parts, j / parts];
        const w = 1 - u - v;
        const x = a[0] * w + b[0] * u + c[0] * v;
        const y = a[1] * w + b[1] * u + c[1] * v;
        const now = a[2] * w + b[2] * u + c[2] * v;
        row.push({ was: [x, y, existingAt(x, y) ?? now], now });
      }
      grid.push(row);
    }
    const piece = plan / (parts * parts);
    let [existingArea, existingVolume, cut, fill] = [0, 0, 0, 0];
    const take = (p: { was: Pt3; now: number }, q: { was: Pt3; now: number }, r: { was: Pt3; now: number }): void => {
      existingArea += area3(p.was, q.was, r.was);
      existingVolume += (piece * (Math.max(0, p.was[2] - datum) + Math.max(0, q.was[2] - datum) + Math.max(0, r.was[2] - datum))) / 3;
      const change = (p.now - p.was[2] + q.now - q.was[2] + r.now - r.was[2]) / 3;
      if (change > 0) fill += change * piece;
      else cut -= change * piece;
    };
    for (let i = 0; i < parts; i++) {
      for (let j = 0; j < parts - i; j++) {
        take(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
        if (j + 1 < parts - i) take(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
    }
    out.push({
      index: t / 3 + 1,
      corners: [a, b, c],
      centre: { x: (a[0] + b[0] + c[0]) / 3, y: (a[1] + b[1] + c[1]) / 3 },
      projected: plan,
      existingArea,
      proposedArea: area3(a, b, c),
      existingVolume,
      proposedVolume: (plan * (Math.max(0, a[2] - datum) + Math.max(0, b[2] - datum) + Math.max(0, c[2] - datum))) / 3,
      cut,
      fill,
    });
  }
  return out;
}

export interface ViewField {
  readonly x0: number;
  readonly y0: number;
  readonly cell: number;
  readonly across: number;
  readonly down: number;
  /** the surface at each cell's corners, row by row, NaN off it */
  readonly heights: Float64Array;
  /** each cell: 0 off the surface, 1 seen, 2 hidden */
  readonly cells: Uint8Array;
  readonly seen: number;
  readonly hidden: number;
}

/**
 * What can be seen from a point above a surface. For each cell, the view from the eye runs over the ground on the
 * way: a cell is hidden if the ground before it stands above the line to it.
 */
export function viewField(heightAt: HeightAt, box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }, eye: Pt, eyeHeight: number, most = 200): ViewField | null {
  const ground = heightAt(eye.x, eye.y);
  if (ground === null) return null;
  const eyeZ = ground + eyeHeight;
  const cell = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1e-6) / most;
  const across = Math.max(1, Math.ceil((box.x1 - box.x0) / cell - 1e-9));
  const down = Math.max(1, Math.ceil((box.y1 - box.y0) / cell - 1e-9));
  const columns = across + 1;
  const heights = new Float64Array(columns * (down + 1));
  for (let j = 0; j <= down; j++) {
    for (let i = 0; i <= across; i++) heights[j * columns + i] = heightAt(box.x0 + i * cell, box.y0 + j * cell) ?? NaN;
  }
  const at = (x: number, y: number): number => {
    const u = (x - box.x0) / cell;
    const v = (y - box.y0) / cell;
    const i = Math.min(across - 1, Math.max(0, Math.floor(u)));
    const j = Math.min(down - 1, Math.max(0, Math.floor(v)));
    const [s, t] = [u - i, v - j];
    const k = j * columns + i;
    return (heights[k] * (1 - s) + heights[k + 1] * s) * (1 - t) + (heights[k + columns] * (1 - s) + heights[k + columns + 1] * s) * t;
  };
  const cells = new Uint8Array(across * down);
  let [seen, hidden] = [0, 0];
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      const [x, y] = [box.x0 + (i + 0.5) * cell, box.y0 + (j + 0.5) * cell];
      const z = heightAt(x, y);
      if (z === null) continue;
      const dist = Math.hypot(x - eye.x, y - eye.y);
      const steps = Math.ceil(dist / (cell / 2));
      let highest = -Infinity;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const h = at(eye.x + (x - eye.x) * t, eye.y + (y - eye.y) * t);
        if (!Number.isNaN(h)) highest = Math.max(highest, (h - eyeZ) / (dist * t));
      }
      const blocked = dist > 0 && (z - eyeZ) / dist < highest - 1e-9;
      cells[j * across + i] = blocked ? 2 : 1;
      if (blocked) hidden++;
      else seen++;
    }
  }
  return { x0: box.x0, y0: box.y0, cell, across, down, heights, cells, seen, hidden };
}

/**
 * The hidden cells as closed outlines, which fill without seams: one for each patch, with the holes in it joined to
 * its outline by a line there and back, from their left side to the first edge found going left.
 */
export function hiddenOutlines(f: ViewField): Pt[][] {
  const { across, down, cells } = f;
  const hidden = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < across && j < down && cells[j * across + i] === 2;
  const key = (i: number, j: number): number => j * (across + 1) + i;
  // each edge runs with the hidden side on its left
  const outgoing = new Map<number, number[]>();
  const add = (a: number, b: number): void => {
    const list = outgoing.get(a);
    if (list) list.push(b);
    else outgoing.set(a, [b]);
  };
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      if (!hidden(i, j)) continue;
      if (!hidden(i, j - 1)) add(key(i, j), key(i + 1, j));
      if (!hidden(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
      if (!hidden(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1));
      if (!hidden(i - 1, j)) add(key(i, j + 1), key(i, j));
    }
  }
  const atOf = (k: number): [number, number] => [k % (across + 1), Math.floor(k / (across + 1))];
  const rings: number[][] = [];
  for (const start of outgoing.keys()) {
    while (outgoing.get(start)?.length) {
      const ring: number[] = [];
      let at = start;
      let from = start;
      do {
        ring.push(at);
        const list = outgoing.get(at) as number[];
        // where two patches touch at a corner, keep to this one: the left turn
        let pick = 0;
        if (list.length > 1 && from !== at) {
          const [fi, fj] = atOf(from);
          const [ai, aj] = atOf(at);
          pick = list.findIndex((n) => {
            const [ni, nj] = atOf(n);
            return (ai - fi) * (nj - aj) - (aj - fj) * (ni - ai) > 0;
          });
          if (pick < 0) pick = 0;
        }
        const next = list.splice(pick, 1)[0];
        from = at;
        at = next;
      } while (at !== start);
      rings.push(ring);
    }
  }
  const areaOf = (ring: readonly number[]): number => {
    let sum = 0;
    ring.forEach((k, n) => {
      const [x0, y0] = atOf(k);
      const [x1, y1] = atOf(ring[(n + 1) % ring.length]);
      sum += x0 * y1 - x1 * y0;
    });
    return sum / 2;
  };
  const outer = rings.filter((r) => areaOf(r) > 0);
  const leftOf = (ring: readonly number[]): number => {
    let best = ring[0];
    for (const k of ring) {
      const [i, j] = atOf(k);
      const [bi, bj] = atOf(best);
      if (i < bi || (i === bi && j < bj)) best = k;
    }
    return best;
  };
  const holes = rings.filter((r) => areaOf(r) < 0).map((ring) => ({ ring, left: leftOf(ring) })).sort((a, b) => atOf(a.left)[0] - atOf(b.left)[0] || atOf(a.left)[1] - atOf(b.left)[1]);
  for (const { ring, left } of holes) {
    const [hi, hj] = atOf(left);
    let k = hi - 1;
    while (hidden(k - 1, hj)) k--;
    // the edge up that side comes down into this corner
    const target = key(k, hj);
    const above = key(k, hj + 1);
    let host: number[] | undefined;
    let place = -1;
    for (const candidate of outer) {
      place = candidate.findIndex((v, n) => v === target && candidate[(n + candidate.length - 1) % candidate.length] === above);
      if (place >= 0) {
        host = candidate;
        break;
      }
    }
    if (!host) continue;
    const from = ring.indexOf(left);
    const round = [...ring.slice(from), ...ring.slice(0, from), left];
    host.splice(place + 1, 0, ...round, target);
  }
  return outer.map((ring) => {
    const out: Pt[] = [];
    ring.forEach((k, n) => {
      const [i0, j0] = atOf(ring[(n + ring.length - 1) % ring.length]);
      const [i, j] = atOf(k);
      const [i1, j1] = atOf(ring[(n + 1) % ring.length]);
      // only what turns stays
      if ((i - i0) * (j1 - j) - (j - j0) * (i1 - i) !== 0 || (i - i0) * (i1 - i) + (j - j0) * (j1 - j) < 0) out.push({ x: f.x0 + i * f.cell, y: f.y0 + j * f.cell });
    });
    return out;
  });
}

/** The hidden ground as flat x,y,z faces lying on the surface, at one for every `every` cells each way. */
export function hiddenFaces(f: ViewField, every: number, lift: number): number[][] {
  const columns = f.across + 1;
  const out: number[][] = [];
  for (let j = 0; j + every <= f.down; j += every) {
    for (let i = 0; i + every <= f.across; i += every) {
      let count = 0;
      for (let b = 0; b < every; b++) for (let a = 0; a < every; a++) if (f.cells[(j + b) * f.across + i + a] === 2) count++;
      if (count * 2 < every * every) continue;
      const corners = [[i, j], [i + every, j], [i + every, j + every], [i, j + every]].map(([u, v]) => [f.x0 + u * f.cell, f.y0 + v * f.cell, f.heights[v * columns + u] + lift]);
      if (corners.some((c) => Number.isNaN(c[2]))) continue;
      out.push(corners.flat());
    }
  }
  return out;
}
