// The sums for a retaining wall site modifier: a run along connected walls or an extrude, the heights it starts with, and
// what a site model takes from it: a thin band whose left and right edges each hold their own height, with the pad between
// them at the bottom of the wall. Plain data in and out (retainingWall.ts draws it).

import type { Pt } from "../core/index.ts";
import type { Pt3 } from "./siteModelShapes.ts";
import { lineLength, pathOutline, pathwaySections, type Section } from "./sitePathShapes.ts";

/** A wall or an extrude as a run: its heights are above its layer. */
export interface RunSource {
  readonly start: Pt;
  readonly end: Pt;
  readonly top: number;
  readonly bottom: number;
  readonly thickness: number;
}

/** Connected runs as one line, each corner with its heights. */
export interface Run {
  readonly line: readonly Pt[];
  readonly tops: readonly number[];
  readonly bottoms: readonly number[];
  readonly width: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const flipped = (r: RunSource): RunSource => ({ ...r, start: r.end, end: r.start });

/** Runs in any order and either way round, as one line going the way the first was drawn; null if they don't all connect. */
export function chainRuns(sources: readonly RunSource[]): Run | null {
  if (!sources.length) return null;
  const width = Math.max(...sources.map((r) => r.thickness));
  // joined walls' lines needn't quite meet at a corner
  const reach = width * 2 + 1;
  const left = sources.slice(1);
  const chain: RunSource[] = [sources[0]];
  for (let found = true; found && left.length; ) {
    found = false;
    for (let i = 0; i < left.length; i++) {
      const r = left[i];
      const [head, tail] = [chain[0].start, chain[chain.length - 1].end];
      if (dist(tail, r.start) <= reach) chain.push(r);
      else if (dist(tail, r.end) <= reach) chain.push(flipped(r));
      else if (dist(head, r.end) <= reach) chain.unshift(r);
      else if (dist(head, r.start) <= reach) chain.unshift(flipped(r));
      else continue;
      left.splice(i, 1);
      found = true;
      break;
    }
  }
  if (left.length) return null;
  const inner = chain.slice(1).map((r, i) => ({ at: mix(chain[i].end, r.start, 0.5), top: (chain[i].top + r.top) / 2, bottom: (chain[i].bottom + r.bottom) / 2 }));
  const [first, last] = [chain[0], chain[chain.length - 1]];
  return {
    line: [first.start, ...inner.map((q) => q.at), last.end],
    tops: [first.top, ...inner.map((q) => q.top), last.top],
    bottoms: [first.bottom, ...inner.map((q) => q.bottom), last.bottom],
    width,
  };
}

const hullOf = (points: readonly Pt[]): Pt[] => {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (from: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of from) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
};

/** What an extrude stands on as a straight run: the long way along its tightest box, the short way its thickness. */
export function thinRun(points: readonly Pt[], top: number, bottom: number): RunSource | null {
  const hull = hullOf(points);
  if (hull.length < 3) return null;
  let best: { area: number; run: RunSource } | null = null;
  hull.forEach((p, i) => {
    const q = hull[(i + 1) % hull.length];
    const len = dist(p, q);
    if (!(len > 0)) return;
    const [ux, uy] = [(q.x - p.x) / len, (q.y - p.y) / len];
    const along = hull.map((h) => h.x * ux + h.y * uy);
    const across = hull.map((h) => -h.x * uy + h.y * ux);
    const [a0, a1, c0, c1] = [Math.min(...along), Math.max(...along), Math.min(...across), Math.max(...across)];
    const [long, short] = [a1 - a0, c1 - c0];
    const area = long * short;
    if (best && area >= best.area) return;
    const box = (a: number, c: number): Pt => ({ x: a * ux - c * uy, y: a * uy + c * ux });
    const middle = (c0 + c1) / 2;
    const run: RunSource = long >= short
      ? { start: box(a0, middle), end: box(a1, middle), top, bottom, thickness: short }
      : { start: box((a0 + a1) / 2, c0), end: box((a0 + a1) / 2, c1), top, bottom, thickness: long };
    best = { area, run };
  });
  return (best as { area: number; run: RunSource } | null)?.run ?? null;
}

export type HeightMode = "top" | "bottom" | "terrain";

/** Where a part of the modifier starts: under the wall's top, over its bottom, or on the ground if there's any. */
export function heightBy(mode: HeightMode, offset: number, top: number, bottom: number, ground: number | null): number {
  if (mode === "top") return top - offset;
  if (mode === "bottom") return bottom + offset;
  return ground ?? bottom;
}

export interface RetainingVertex {
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly right: number;
  readonly pad: number;
}

export interface RetainingOptions {
  readonly width: number;
  readonly left: boolean;
  readonly right: boolean;
  readonly start: boolean;
  readonly end: boolean;
  readonly padOffset: number;
}

/** How far a side that's left out still reaches, of its half: enough of an outline to hold the pad's points. */
const SLIVER = 0.02;
/** The most points along any one line. */
const MOST_ALONG = 300;

/** The band's sections, thin on a side left out. */
export function bandSections(v: readonly RetainingVertex[], o: RetainingOptions): Section[] {
  return pathwaySections(v.map((q) => ({ x: q.x, y: q.y })), o.width).map((c) => ({
    ...c,
    left: o.left ? c.left : mix(c.c, c.left, SLIVER),
    right: o.right ? c.right : mix(c.c, c.right, SLIVER),
  }));
}

/** What a site model takes: the outline, and the heights along each edge that's in. */
export function retainingBand(v: readonly RetainingVertex[], o: RetainingOptions): { ring: Pt[]; samples: Pt3[] } | null {
  const sections = bandSections(v, o);
  const length = lineLength(v);
  if (sections.length < 2 || !(length > 0) || !(o.width > 0)) return null;
  const samples: Pt3[] = [];
  const put = (p: Pt, z: number): void => {
    samples.push([p.x, p.y, z]);
  };
  // close enough together to keep the ground from cutting across the band
  const step = Math.max(o.width, length / MOST_ALONG);
  // without an end edge the pad stops short, and the ground runs round the wall's end
  const clear = Math.min(o.width, length / 4);
  for (let i = 0; i + 1 < sections.length; i++) {
    const [a, b, p, q] = [sections[i], sections[i + 1], v[i], v[i + 1]];
    const count = Math.max(1, Math.ceil((b.at - a.at) / step));
    for (let k = i === 0 ? 0 : 1; k <= count; k++) {
      const t = k / count;
      if (o.left) put(mix(a.left, b.left, t), lerp(p.left, q.left, t));
      if (o.right) put(mix(a.right, b.right, t), lerp(p.right, q.right, t));
      const at = lerp(a.at, b.at, t);
      if ((o.start || at >= clear) && (o.end || at <= length - clear)) put(mix(a.c, b.c, t), lerp(p.pad, q.pad, t) + o.padOffset);
    }
  }
  const across = (c: Section, q: RetainingVertex): void => {
    const pad = q.pad + o.padOffset;
    if (o.left) put(mix(c.c, c.left, 0.5), (pad + q.left) / 2);
    if (o.right) put(mix(c.c, c.right, 0.5), (pad + q.right) / 2);
  };
  if (o.start) across(sections[0], v[0]);
  if (o.end) across(sections[sections.length - 1], v[v.length - 1]);
  return { ring: pathOutline(sections), samples };
}

export const RETAINING_PARTS = ["Left Edge", "Right Edge", "Start Edge", "End Edge"] as const;
export type RetainingPart = (typeof RETAINING_PARTS)[number];

/** A part's height as Object Info shows it: at its start, or its higher side at a wall's end. */
export function partHeight(v: readonly RetainingVertex[], part: RetainingPart): number {
  if (part === "Left Edge") return v[0].left;
  if (part === "Right Edge") return v[0].right;
  const end = part === "Start Edge" ? v[0] : v[v.length - 1];
  return Math.max(end.left, end.right);
}

/** The whole part moved up or down so that its height is this. */
export function movedPart(v: readonly RetainingVertex[], part: RetainingPart, z: number): RetainingVertex[] {
  const by = z - partHeight(v, part);
  const last = v.length - 1;
  return v.map((q, i) => {
    if (part === "Left Edge") return { ...q, left: q.left + by };
    if (part === "Right Edge") return { ...q, right: q.right + by };
    return (part === "Start Edge" ? i === 0 : i === last) ? { ...q, left: q.left + by, right: q.right + by } : q;
  });
}

/** One corner of an edge at this height. */
export function withVertexHeight(v: readonly RetainingVertex[], part: RetainingPart, index: number, z: number): RetainingVertex[] {
  return v.map((q, i) => (i !== index ? q : part === "Right Edge" ? { ...q, right: z } : part === "Left Edge" ? { ...q, left: z } : q));
}

/** New corners, keeping heights: by order if there are as many, or else from the nearest place along the old line. */
export function carriedHeights(old: readonly RetainingVertex[], line: readonly Pt[]): RetainingVertex[] {
  if (old.length === line.length) return line.map((p, i) => ({ ...old[i], x: p.x, y: p.y }));
  return line.map((p) => {
    let best: RetainingVertex = old[0];
    let far = Infinity;
    for (let i = 0; i + 1 < old.length; i++) {
      const [a, b] = [old[i], old[i + 1]];
      const [dx, dy] = [b.x - a.x, b.y - a.y];
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const off = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (off < far) {
        far = off;
        best = { x: p.x, y: p.y, left: lerp(a.left, b.left, t), right: lerp(a.right, b.right, t), pad: lerp(a.pad, b.pad, t) };
      }
    }
    return { ...best, x: p.x, y: p.y };
  });
}
