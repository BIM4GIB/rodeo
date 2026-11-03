// Site Planning's Hedgerow in plan (tools/hedgerow.ts): a band its width wide along a clicked path,
// centred on it or lying to its left or right, the outside of each corner rounded when Smooth
// corners is set; its edge a single line, a plant cloud of billows (bulging out or in, varying in
// size) or a rough plant line; and how many plants it takes, by its length or its area, shared
// among up to seven plants by percentage.

import type { Pt } from "../core/index.ts";
import { dist, intersectLines, signedArea } from "./geom.ts";

export type HedgeAlign = "centre" | "left" | "right";
export type HedgeBorder = "standard" | "cloud" | "line";
export type HedgeDensity = "length" | "area";

export interface HedgePlant {
  readonly name: string;
  /** its share of the hedge, 0..100 */
  readonly percent: number;
}

export interface Hedgerow {
  readonly smooth: boolean;
  readonly align: HedgeAlign;
  readonly width: number;
  readonly densityBy: HedgeDensity;
  /** plants per unit of length, or per square unit of area */
  readonly density: number;
  readonly border: HedgeBorder;
  /** a plant cloud's billows bulge into the hedge instead of out of it */
  readonly concave: boolean;
  /** a billow's length along the edge and how far it rises from it, mm */
  readonly billowSize: number;
  readonly billowHeight: number;
  /** 0..100: how much billows differ in size, the largest up to this much bigger than the smallest */
  readonly variability: number;
  /** a plant line's segment length, and how far its corners stray either side of the edge in all, mm */
  readonly segment: number;
  readonly thickness: number;
  readonly plants: readonly HedgePlant[];
}

export interface HedgerowPlan {
  /** closed outlines: one for a hedge along an open path; outside then inside for one round a closed path */
  readonly outlines: Pt[][];
  /** the path's length, mm */
  readonly length: number;
  /** the band's area before its edge is drawn as a cloud or plant line, mm² */
  readonly area: number;
}

/** most plants a hedgerow takes, and most points its edges draw */
export const MAX_HEDGE_PLANTS = 7;
const MAX_POINTS = 50000;
const EPS = 1e-6;
/** a rounded corner's step, radians, kept under SHARP so its cloud runs on round it */
const ARC_STEP = Math.PI / 18;
/** an edge turning more than this at a corner starts a new run of billows or plant line there */
const SHARP = (25 * Math.PI) / 180;
/** points of a billow's arc (its end is the next billow's start) */
const BILLOW_STEPS = 6;
/** a mitre reaching further than this many times its offset is cut square */
const MITRE_LIMIT = 4;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Pt, b: Pt): Pt => {
  const d = dist(a, b);
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};
const left = (u: Pt): Pt => ({ x: -u.y, y: u.x });

/** Why the hedgerow can't be drawn as set, or null. */
export function hedgerowProblem(h: Hedgerow): string | null {
  if (!(h.width > 0)) return "Set the hedgerow's width more than 0.";
  if (!(h.density > 0)) return "Set a density of more than 0 plants.";
  if (h.border === "cloud" && !(h.billowSize > 0 && h.billowHeight > 0)) return "Set the billows' size and height more than 0.";
  if (h.border === "line" && !(h.segment > 0 && h.thickness >= 0)) return "Set the plant line's segment length more than 0 and its thickness 0 or more.";
  return plantsProblem(h.plants);
}

function plantsProblem(plants: readonly HedgePlant[]): string | null {
  if (plants.length === 0) return "A hedgerow needs at least one plant.";
  if (plants.length > MAX_HEDGE_PLANTS) return `A hedgerow takes at most ${MAX_HEDGE_PLANTS} plants.`;
  if (plants.some((p) => !(p.percent > 0))) return "Give each plant a percentage more than 0.";
  if (plants.reduce((s, p) => s + p.percent, 0) > 100 + EPS) return "The plants' percentages can't add up to more than 100%.";
  return null;
}

/** "Beech 60%, Hornbeam 40%": plants and their percentages, a lone plant without one taking 100%; or why they can't be read. */
export function parsePlants(text: string): HedgePlant[] | string {
  const items = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const plants: HedgePlant[] = [];
  for (const item of items) {
    const m = /^(.*?)\s*(\d+(?:\.\d+)?)\s*%$/.exec(item);
    if (m && m[1]) plants.push({ name: m[1], percent: Number(m[2]) });
    else if (items.length === 1) plants.push({ name: item, percent: 100 });
    else return `Give "${item}" a percentage, as in "${item} 50%".`;
  }
  return plantsProblem(plants) ?? plants;
}

export function plantsText(plants: readonly HedgePlant[]): string {
  return plants.map((p) => `${p.name} ${p.percent}%`).join(", ");
}

/** Each plant's count: its share of the density times the hedge's length or area in `unit` (mm per unit). */
export function plantCounts(h: Hedgerow, plan: HedgerowPlan, unit: number): { readonly name: string; readonly count: number }[] {
  const amount = h.densityBy === "length" ? plan.length / unit : plan.area / (unit * unit);
  return h.plants.map((p) => ({ name: p.name, count: Math.round((h.density * amount * p.percent) / 100) }));
}

/**
 * The hedgerow along `path` (closed: round it) in plan, or why it can't be drawn: a band the
 * width wide, centred on the path or to its left or right, its corners mitred (cut square past
 * MITRE_LIMIT) or, with Smooth corners, rounded on their outside; its edge as set.
 */
export function hedgerow(path: readonly Pt[], closed: boolean, h: Hedgerow): HedgerowPlan | string {
  const problem = hedgerowProblem(h);
  if (problem) return problem;
  const pts = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > EPS);
  if (closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= EPS) pts.pop();
  if (pts.length < (closed ? 3 : 2)) return "Click a longer path for the hedgerow.";
  const [l, r] = h.align === "left" ? [h.width, 0] : h.align === "right" ? [0, -h.width] : [h.width / 2, -h.width / 2];
  const a = side(pts, closed, l, h.smooth);
  const b = side(pts, closed, r, h.smooth);
  if (!a || !b) return "The hedgerow is too wide for its path's tightest corner; narrow it or widen the corner.";
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  if (closed) length += dist(pts[pts.length - 1], pts[0]);
  let bands: Pt[][];
  let area: number;
  if (closed) {
    bands = Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? [a, b] : [b, a];
    area = Math.abs(signedArea(bands[0])) - Math.abs(signedArea(bands[1]));
  } else {
    bands = [[...a, ...b.reverse()]];
    area = Math.abs(signedArea(bands[0]));
  }
  if (!(area > EPS)) return "Click a longer path for the hedgerow.";
  // a closed hedge's outside is out of its outer outline and into its inner one
  const outlines = bands.map((ring, i) => edge(ring, i === 0, h, i));
  if (outlines.some((o) => o === null)) return "That makes too many billows or plant line segments; set them longer.";
  return { outlines: outlines as Pt[][], length, area };
}

/**
 * `pts` offset `d` to its left (negative: its right), each corner where its offset sides meet,
 * cut square past MITRE_LIMIT, or with `smooth` rounded about the corner where it is the turn's
 * outside. Null when an offset side turns back on itself (too wide for a corner).
 */
function side(pts: readonly Pt[], closed: boolean, d: number, smooth: boolean): Pt[] | null {
  if (Math.abs(d) <= EPS) return [...pts];
  const n = pts.length;
  const edges = closed ? n : n - 1;
  const dirs = Array.from({ length: edges }, (_, e) => unit(pts[e], pts[(e + 1) % n]));
  const corners: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    const inE = closed ? (i - 1 + n) % n : i - 1;
    const outE = i < edges ? i : -1;
    if (inE < 0 || outE < 0) {
      corners.push([add(v, left(dirs[inE < 0 ? outE : inE]), d)]);
      continue;
    }
    const u = dirs[inE];
    const w = dirs[outE];
    const cross = u.x * w.y - u.y * w.x;
    const dot = u.x * w.x + u.y * w.y;
    const turn = Math.atan2(cross, dot);
    const a = add(v, left(u), d);
    const b = add(v, left(w), d);
    if (Math.abs(turn) < EPS) corners.push([b]);
    else if (d * cross < 0 && smooth) {
      // the turn's outside, rounded about the corner
      const from = Math.atan2(a.y - v.y, a.x - v.x);
      const steps = Math.max(1, Math.ceil(Math.abs(turn) / ARC_STEP));
      corners.push(Array.from({ length: steps + 1 }, (_, k) => add(v, { x: Math.cos(from + (turn * k) / steps), y: Math.sin(from + (turn * k) / steps) }, Math.abs(d))));
    } else {
      const m = intersectLines(a, u, b, w);
      corners.push(m && dist(m, v) <= MITRE_LIMIT * Math.abs(d) ? [m] : [a, b]);
    }
  }
  // each offset side runs forwards, from its start corner's last point to its end corner's first
  for (let e = 0; e < edges; e++) {
    const p = corners[e][corners[e].length - 1];
    const q = corners[(e + 1) % n][0];
    const s = sub(q, p);
    if (s.x * dirs[e].x + s.y * dirs[e].y <= EPS) return null;
  }
  return corners.flat();
}

/** `ring`'s edge as the hedgerow draws it, its outside away from the hedge when `outside`; null when that makes too many points. */
function edge(ring: Pt[], outside: boolean, h: Hedgerow, seed: number): Pt[] | null {
  if (h.border === "standard") return ring;
  // counter-clockwise, so the right of travel is out of the ring
  const ccw = signedArea(ring) > 0 ? ring : [...ring].reverse();
  const out: Pt[] = [];
  const runs = runsOf(ccw);
  for (const [r, run] of runs.entries()) {
    const len = run.reduce((s, p, i) => (i ? s + dist(run[i - 1], p) : 0), 0);
    if (!(len > EPS)) continue;
    const size = h.border === "cloud" ? h.billowSize : h.segment;
    const count = Math.max(1, Math.round(len / size));
    if (out.length + count * BILLOW_STEPS > MAX_POINTS) return null;
    if (h.border === "cloud") {
      // billows' lengths vary about the set size, fitted to the run
      const weights = Array.from({ length: count }, (_, k) => 1 + (h.variability / 100) * (random(seed, r, k) - 0.5));
      const total = weights.reduce((s, w) => s + w, 0);
      // out of the hedge is out of the ring for its outside outline, into the ring for its inside one
      const sign = outside !== h.concave ? 1 : -1;
      let at = 0;
      for (const w of weights) {
        const p = pointAt(run, at);
        at += (len * w) / total;
        const q = pointAt(run, Math.min(at, len));
        const chord = dist(p, q);
        out.push(...billow(p, q, sign * Math.min(chord / 2, (h.billowHeight * chord) / h.billowSize)));
      }
    } else {
      for (let k = 0; k < count; k++) {
        const t = (len * k) / count;
        const p = pointAt(run, t);
        if (k === 0) {
          out.push(p);
          continue;
        }
        const n = right(tangentAt(run, t));
        out.push(add(p, n, (random(seed, r, k) - 0.5) * h.thickness));
      }
    }
  }
  return out.length >= 3 ? out : null;
}

/**
 * The closed ring cut at its sharp corners into runs, each from one sharp corner to the next (its
 * end the next run's start); a ring without one is one run round from its first point back to it.
 */
function runsOf(ring: readonly Pt[]): Pt[][] {
  const n = ring.length;
  const sharp: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = unit(ring[(i - 1 + n) % n], ring[i]);
    const w = unit(ring[i], ring[(i + 1) % n]);
    if (Math.abs(Math.atan2(u.x * w.y - u.y * w.x, u.x * w.x + u.y * w.y)) > SHARP) sharp.push(i);
  }
  if (sharp.length === 0) return [[...ring, ring[0]]];
  return sharp.map((s, j) => {
    const end = sharp[(j + 1) % sharp.length];
    const run: Pt[] = [];
    for (let i = s; ; i = (i + 1) % n) {
      run.push(ring[i]);
      if (i === end && run.length > 1) break;
    }
    return run;
  });
}

/** The point `t` along the polyline `run`. */
function pointAt(run: readonly Pt[], t: number): Pt {
  for (let i = 1; i < run.length; i++) {
    const len = dist(run[i - 1], run[i]);
    if (t <= len || i === run.length - 1) return len > 0 ? add(run[i - 1], unit(run[i - 1], run[i]), Math.min(t, len)) : run[i];
    t -= len;
  }
  return run[0];
}

/** The polyline's direction `t` along it. */
function tangentAt(run: readonly Pt[], t: number): Pt {
  for (let i = 1; i < run.length; i++) {
    const len = dist(run[i - 1], run[i]);
    if ((t <= len || i === run.length - 1) && len > 0) return unit(run[i - 1], run[i]);
    t -= len;
  }
  return { x: 1, y: 0 };
}

const right = (u: Pt): Pt => ({ x: u.y, y: -u.x });

/** Points of an arc from `p` towards `q` (q left for the next one) rising `rise` to the right of p→q (negative: to its left). */
function billow(p: Pt, q: Pt, rise: number): Pt[] {
  const c = dist(p, q);
  if (!(c > EPS) || Math.abs(rise) <= EPS) return [p];
  const u = unit(p, q);
  const n = right(u);
  const s = Math.min(Math.abs(rise), c / 2);
  const sign = Math.sign(rise);
  const r = (c * c) / 4 / (2 * s) + s / 2;
  const mid = add(p, u, c / 2);
  const centre = add(mid, n, -sign * (r - s));
  // the rise is at most a semicircle's, so the arc is its circle's short way round
  const half = Math.asin(Math.min(1, c / 2 / r));
  const out: Pt[] = [];
  for (let i = 0; i < BILLOW_STEPS; i++) {
    const phi = -half + (2 * half * i) / BILLOW_STEPS;
    out.push(add(add(centre, n, sign * r * Math.cos(phi)), u, r * Math.sin(phi)));
  }
  return out;
}

/** A repeatable number from 0 to 1 for billow or segment `k` of run `r` of outline `seed`. */
function random(seed: number, r: number, k: number): number {
  const x = Math.sin(k * 12.9898 + r * 78.233 + seed * 37.719) * 43758.5453;
  return x - Math.floor(x);
}
