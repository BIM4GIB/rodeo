// What Spotlight's Cable Path and Cable tools (tools/cables.ts) draw in Top/Plan, as plain geometry
// in the drawing's coordinates: a path's clicked corners rounded by a fillet radius (kept to what
// fits between its neighbours), the stretch of another path a cable follows, the run of stock cable
// parts that covers a cable's length, and a cable's connector markers where those parts meet, its
// start and end markers and its middle label. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";
import { CHAR_WIDTH, type MarkerDrawing, type MarkerText } from "./markerShapes.ts";

export type CableType = "feeder" | "multi" | "jumper" | "data";
export type ConnectorMarker = "none" | "chevron" | "tick" | "dot";
export type EndMarker = "none" | "arrow" | "dot";

/** most cable parts in one run, so a slip of the units can't hang the page */
export const MAX_PARTS = 500;
/** the longest cable sized into parts, mm (10 km) */
const MAX_RUN = 10_000_000;
/** cable parts are matched to the nearest this many mm */
const PART_STEP = 10;
/** points along a rounded corner's arc, per quarter turn */
const ARC_STEPS = 8;
/** corners straighter or sharper than this (radians from straight on, or from doubling back) aren't rounded */
const FLAT = 1e-3;

const at = (x: number, y: number): Pt => ({ x, y });

type Draft = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[] };
const empty = (): Draft => ({ outlines: [], lines: [], circles: [], filled: [], texts: [] });

export interface Rounded {
  /** each point's rounding radius, 0 where it stays a corner */
  readonly radii: number[];
  /** the path with its rounded corners flattened to points */
  readonly outline: Pt[];
}

/**
 * `points` with the corners marked in `round` rounded to `radius`, each kept to what fits: its arc
 * meets each edge beside it no further than halfway along. An open path's ends stay corners; a
 * closed one's outline ends back on its first point.
 */
export function roundCorners(points: readonly Pt[], closed: boolean, round: readonly boolean[], radius: number): Rounded {
  const n = points.length;
  const radii = points.map(() => 0);
  const outline: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const b = points[i];
    const inner = closed ? n >= 3 : i > 0 && i < n - 1;
    if (!inner || !round[i] || !(radius > 0)) {
      outline.push(b);
      continue;
    }
    const a = points[(i - 1 + n) % n];
    const c = points[(i + 1) % n];
    const lu = dist(a, b);
    const lv = dist(c, b);
    const u = lu > 0 ? at((a.x - b.x) / lu, (a.y - b.y) / lu) : at(0, 0);
    const v = lv > 0 ? at((c.x - b.x) / lv, (c.y - b.y) / lv) : at(0, 0);
    // the angle between the two edges at the corner: π running straight on, 0 doubling back
    const inside = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)));
    if (!(lu > 0) || !(lv > 0) || inside > Math.PI - FLAT || inside < FLAT) {
      outline.push(b);
      continue;
    }
    const tan = Math.tan(inside / 2);
    const r = Math.min(radius, (Math.min(lu, lv) / 2) * tan);
    const reach = r / tan;
    const p = at(b.x + u.x * reach, b.y + u.y * reach);
    const q = at(b.x + v.x * reach, b.y + v.y * reach);
    // the arc's centre lies along the corner's bisector
    const bis = at(u.x + v.x, u.y + v.y);
    const lb = Math.hypot(bis.x, bis.y);
    const off = r / Math.sin(inside / 2);
    const o = at(b.x + (bis.x / lb) * off, b.y + (bis.y / lb) * off);
    const a0 = Math.atan2(p.y - o.y, p.x - o.x);
    let sweep = Math.atan2(q.y - o.y, q.x - o.x) - a0;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil((ARC_STEPS * Math.abs(sweep)) / (Math.PI / 2)));
    for (let k = 0; k <= steps; k++) outline.push(at(o.x + r * Math.cos(a0 + (sweep * k) / steps), o.y + r * Math.sin(a0 + (sweep * k) / steps)));
    radii[i] = r;
  }
  if (closed && outline.length) outline.push(outline[0]);
  return { radii, outline };
}

export function pathLength(pts: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** The point `d` along `pts` (kept to its ends) and the direction it runs there. */
export function pointAlong(pts: readonly Pt[], d: number): { at: Pt; dir: Pt } {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const len = dist(pts[i - 1], pts[i]);
    if (len === 0) continue;
    const dir = at((pts[i].x - pts[i - 1].x) / len, (pts[i].y - pts[i - 1].y) / len);
    if (left <= len || i === pts.length - 1) {
      const t = Math.min(left, len);
      return { at: at(pts[i - 1].x + dir.x * t, pts[i - 1].y + dir.y * t), dir };
    }
    left -= len;
  }
  return { at: pts[0] ?? at(0, 0), dir: at(1, 0) };
}

/** `pts` as walked: a closed path ends back on its first point. */
const walked = (pts: readonly Pt[], closed: boolean): readonly Pt[] => (closed && pts.length > 2 ? [...pts, pts[0]] : pts);

/** The point on `pts` nearest `p`, and how far along `pts` it is. */
export function nearestAlong(pts: readonly Pt[], closed: boolean, p: Pt): { d: number; at: Pt } {
  const w = walked(pts, closed);
  let best = { d: 0, at: w[0], gap: Infinity };
  let run = 0;
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1];
    const b = w[i];
    const len = dist(a, b);
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const q = at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const gap = dist(p, q);
    if (gap < best.gap) best = { d: run + t * len, at: q, gap };
    run += len;
  }
  return { d: best.d, at: best.at };
}

/** `w`'s points from `from` along it up to `to` (from ≤ to), both ends included. */
function stretch(w: readonly Pt[], from: number, to: number): Pt[] {
  const out = [pointAlong(w, from).at];
  let run = 0;
  for (let i = 1; i < w.length; i++) {
    run += dist(w[i - 1], w[i]);
    if (run > from && run < to) out.push(w[i]);
  }
  out.push(pointAlong(w, to).at);
  return out;
}

/** The stretch of `pts` from `from` along it to `to`, both ends included; round a closed path, the shorter way. */
export function between(pts: readonly Pt[], closed: boolean, from: number, to: number): Pt[] {
  const w = walked(pts, closed);
  if (!closed || w.length < 3) return from <= to ? stretch(w, from, to) : stretch(w, to, from).reverse();
  const total = pathLength(w);
  const ahead = to >= from ? to - from : total - from + to;
  const forward = (s: number, e: number): Pt[] => (e >= s ? stretch(w, s, e) : [...stretch(w, s, total), ...stretch(w, 0, e).slice(1)]);
  return ahead <= total - ahead ? forward(from, to) : forward(to, from).reverse();
}

/**
 * The stock parts that make up a run at least `length` long, longest first: the fewest, and of
 * those the least spare; a message when there are no parts or too many would be needed.
 */
export function cableParts(length: number, stock: readonly number[]): number[] | string {
  const sizes = [...new Set(stock.filter((s) => s > 0 && Number.isFinite(s)))].sort((a, b) => b - a);
  if (!sizes.length) return "Give the cable parts' lengths.";
  if (!(length > 0)) return "Click points apart for the cable.";
  // one part long enough: the shortest of those
  const one = sizes.filter((s) => s >= length).at(-1);
  if (one !== undefined) return [one];
  if (length > MAX_RUN || length / sizes[0] > MAX_PARTS) return `The cable needs over ${MAX_PARTS} parts: add longer parts.`;
  // fewest parts reaching each length (in steps), then the least spare past the cable's length
  const units = sizes.map((s) => Math.max(1, Math.round(s / PART_STEP)));
  const need = Math.ceil(length / PART_STEP);
  const top = need + units[0];
  const count = new Int32Array(top + 1).fill(-1);
  const last = new Int32Array(top + 1).fill(-1);
  count[0] = 0;
  for (let t = 1; t <= top; t++) {
    for (let k = 0; k < units.length; k++) {
      const from = t - units[k];
      if (from < 0 || count[from] < 0) continue;
      if (count[t] < 0 || count[from] + 1 < count[t]) {
        count[t] = count[from] + 1;
        last[t] = k;
      }
    }
  }
  let best = -1;
  for (let t = need; t <= top; t++) if (count[t] >= 0 && (best < 0 || count[t] < count[best])) best = t;
  if (best < 0) return "No run of the cable parts covers the cable: add other lengths.";
  const parts: number[] = [];
  for (let t = best; t > 0; t -= units[last[t]]) parts.push(sizes[last[t]]);
  return parts.sort((a, b) => b - a);
}

export interface Cable {
  readonly connector: ConnectorMarker;
  readonly start: EndMarker;
  readonly end: EndMarker;
  /** its middle label (the cable run ID and length), shown when not blank */
  readonly label: string;
  /** a solid box behind the middle label, the cable stopping at it */
  readonly labelFill: boolean;
}

export interface CableDrawing {
  readonly drawing: MarkerDrawing;
  /** the box behind the middle label, when it has one */
  readonly box: Pt[] | null;
}

/** A dot of radius `r` round `c`. */
const dot = (c: Pt, r: number): Pt[] => Array.from({ length: 16 }, (_, i) => at(c.x + r * Math.cos((i * Math.PI) / 8), c.y + r * Math.sin((i * Math.PI) / 8)));

/**
 * What a cable along `outline` (its rounded path) draws besides the line itself: a connector
 * marker where each of its `parts` meets the next and its start and end markers, `size` across,
 * and its label at its middle, reading along it, `textSize` high.
 */
export function cable(outline: readonly Pt[], parts: readonly number[], c: Cable, size: number, textSize: number): CableDrawing {
  const d = empty();
  const total = pathLength(outline);
  let joint = 0;
  for (const part of parts.slice(0, -1)) {
    joint += part;
    if (joint >= total || c.connector === "none") continue;
    const { at: p, dir } = pointAlong(outline, joint);
    const n = at(-dir.y, dir.x);
    const h = size / 2;
    if (c.connector === "chevron") d.lines.push([at(p.x - dir.x * h + n.x * h, p.y - dir.y * h + n.y * h), p, at(p.x - dir.x * h - n.x * h, p.y - dir.y * h - n.y * h)]);
    else if (c.connector === "tick") d.lines.push([at(p.x + n.x * h, p.y + n.y * h), at(p.x - n.x * h, p.y - n.y * h)]);
    else d.filled.push(dot(p, size * 0.3));
  }
  const ends: [EndMarker, number, number][] = [
    [c.start, 0, -1],
    [c.end, total, 1],
  ];
  for (const [marker, along, out] of ends) {
    if (marker === "none") continue;
    const { at: p, dir } = pointAlong(outline, along);
    if (marker === "dot") d.filled.push(dot(p, size * 0.4));
    else {
      // the arrow's tip on the end, pointing out of the cable
      const u = at(dir.x * out, dir.y * out);
      const n = at(-u.y, u.x);
      const base = at(p.x - u.x * size * 1.2, p.y - u.y * size * 1.2);
      d.filled.push([p, at(base.x + n.x * size * 0.4, base.y + n.y * size * 0.4), at(base.x - n.x * size * 0.4, base.y - n.y * size * 0.4)]);
    }
  }
  const text = c.label.trim();
  let box: Pt[] | null = null;
  if (text && total > 0) {
    const { at: mid, dir } = pointAlong(outline, total / 2);
    // reading left to right, or upward
    let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle <= -90) angle += 180;
    const along = at(Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180));
    const up = at(-along.y, along.x);
    // on the cable over its box, else above it
    const c0 = c.labelFill ? mid : at(mid.x + up.x * textSize * 1.1, mid.y + up.y * textSize * 1.1);
    d.texts.push({ at: c0, text, height: textSize, justify: "centre", angle });
    if (c.labelFill) {
      const w = (text.length * CHAR_WIDTH * textSize) / 2 + textSize * 0.4;
      const h = textSize * 0.8;
      box = [
        at(mid.x - along.x * w - up.x * h, mid.y - along.y * w - up.y * h),
        at(mid.x + along.x * w - up.x * h, mid.y + along.y * w - up.y * h),
        at(mid.x + along.x * w + up.x * h, mid.y + along.y * w + up.y * h),
        at(mid.x - along.x * w + up.x * h, mid.y - along.y * w + up.y * h),
      ];
    }
  }
  return { drawing: d, box };
}
