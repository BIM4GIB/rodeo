// The sums behind the Site Modifiers tool's Pathway and Boundary paths: a centre line with a section across it at each
// station, one profile along it, any number across it, and the heights those make. Plain data in and out (sitePath.ts
// draws them).

import type { Pt } from "../core/index.ts";
import type { Pt3 } from "./siteModelShapes.ts";

/** A height this far along the centre line. */
export interface ProfilePoint {
  readonly at: number;
  readonly z: number;
}

/** A height change this far to the left of the centre line (right is negative). */
export interface CrossPoint {
  readonly off: number;
  readonly rise: number;
}

/** A transverse profile: how the path's width rises and falls at one station. */
export interface CrossProfile {
  readonly name: string;
  readonly at: number;
  readonly points: readonly CrossPoint[];
}

/** The path's width at one station. */
export interface Section {
  readonly at: number;
  readonly c: Pt;
  readonly left: Pt;
  readonly right: Pt;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const lineLength = (line: readonly Pt[]): number => line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0);

/** The place this far along a line; past its ends, its ends. */
function pointAlong(line: readonly Pt[], at: number): Pt {
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const len = dist(line[i], line[i + 1]);
    if (at <= run + len) return mix(line[i], line[i + 1], len > 0 ? Math.max(0, at - run) / len : 0);
    run += len;
  }
  return line[line.length - 1];
}

/** The most a mitred corner stretches the width; past that a sharp corner would throw its point far out. */
const MITRE_LIMIT = 3;

/** A section at each corner of a centre line, its sides `width` apart and mitred at the corners. */
export function pathwaySections(line: readonly Pt[], width: number): Section[] {
  const out: Section[] = [];
  let at = 0;
  line.forEach((p, i) => {
    const before = line[Math.max(0, i - 1)];
    const after = line[Math.min(line.length - 1, i + 1)];
    const inLen = dist(before, p) || 1;
    const outLen = dist(p, after) || 1;
    const [ax, ay] = i > 0 ? [(p.x - before.x) / inLen, (p.y - before.y) / inLen] : [(after.x - p.x) / outLen, (after.y - p.y) / outLen];
    const [bx, by] = i + 1 < line.length ? [(after.x - p.x) / outLen, (after.y - p.y) / outLen] : [ax, ay];
    const [nx, ny] = [-(ay + by), ax + bx];
    const norm = Math.hypot(nx, ny) || 1;
    // half the corner's angle: the normal of one side against the mitre
    const stretch = Math.min(MITRE_LIMIT, 1 / Math.max(1e-6, Math.abs((nx / norm) * -ay + (ny / norm) * ax)));
    const half = (width / 2) * stretch;
    if (i > 0) at += inLen;
    out.push({ at, c: p, left: { x: p.x + (nx / norm) * half, y: p.y + (ny / norm) * half }, right: { x: p.x - (nx / norm) * half, y: p.y - (ny / norm) * half } });
  });
  return out;
}

/** The two sides of a boundary, from the end edge farthest from the other end edge round to it: the first on the left. */
function boundarySides(ring: readonly Pt[]): { readonly left: Pt[]; readonly right: Pt[] } {
  const n = ring.length;
  const mid = (i: number): Pt => mix(ring[i], ring[(i + 1) % n], 0.5);
  // opposite edges where there are any; a triangle has only neighbours
  let [from, to, far] = [0, Math.min(1, n - 1), -1];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (n > 3 && (j === i + 1 || (i === 0 && j === n - 1))) continue;
      const d = dist(mid(i), mid(j));
      if (d > far) [from, to, far] = [i, j, d];
    }
  }
  const walk = (start: number, stop: number): Pt[] => {
    const out: Pt[] = [];
    for (let k = start; ; k = (k + 1) % n) {
      out.push(ring[k]);
      if (k === stop) return out;
    }
  };
  // round one way from the end of the first edge to the start of the second, and back the other
  const one = walk((from + 1) % n, to);
  const other = walk((to + 1) % n, from).reverse();
  const [a, b] = [mix(one[0], other[0], 0.5), mix(one[one.length - 1], other[other.length - 1], 0.5)];
  const cross = (b.x - a.x) * (other[0].y - a.y) - (b.y - a.y) * (other[0].x - a.x);
  return cross >= 0 ? { left: other, right: one } : { left: one, right: other };
}

/** Sections across a boundary: its two sides taken at the same share of their lengths, the centre line between them. */
export function boundarySections(ring: readonly Pt[]): Section[] {
  const { left, right } = boundarySides(ring);
  const [lenLeft, lenRight] = [lineLength(left), lineLength(right)];
  const shares = new Set<number>([0, 1]);
  const addCorners = (side: readonly Pt[], whole: number): void => {
    let run = 0;
    for (let i = 0; i + 1 < side.length; i++) {
      run += dist(side[i], side[i + 1]);
      if (whole > 0) shares.add(Math.min(1, run / whole));
    }
  };
  addCorners(left, lenLeft);
  addCorners(right, lenRight);
  const out: Section[] = [];
  let at = 0;
  let last: Pt | null = null;
  for (const share of [...shares].sort((a, b) => a - b)) {
    const [l, r] = [pointAlong(left, share * lenLeft), pointAlong(right, share * lenRight)];
    const c = mix(l, r, 0.5);
    if (last) {
      const step = dist(last, c);
      if (step < 1e-6) continue;
      at += step;
    }
    out.push({ at, c, left: l, right: r });
    last = c;
  }
  return out;
}

export const sectionsLength = (sections: readonly Section[]): number => sections[sections.length - 1]?.at ?? 0;

/** The section this far along. */
export function sectionAt(sections: readonly Section[], at: number): Section {
  for (let i = 0; i + 1 < sections.length; i++) {
    const [a, b] = [sections[i], sections[i + 1]];
    if (at <= b.at) {
      const t = b.at > a.at ? Math.max(0, (at - a.at) / (b.at - a.at)) : 0;
      return { at, c: mix(a.c, b.c, t), left: mix(a.left, b.left, t), right: mix(a.right, b.right, t) };
    }
  }
  return sections[sections.length - 1];
}

/** Sections at the corners and these stations, and evenly along it at no more than `spacing`. */
export function stationed(sections: readonly Section[], stations: readonly number[], spacing: number): Section[] {
  const length = sectionsLength(sections);
  const ats = new Set<number>([...sections.map((s) => s.at), ...stations.filter((a) => a > 0 && a < length)]);
  const sorted = [...ats].sort((a, b) => a - b);
  const every = Math.max(spacing, length / 400);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const parts = Math.ceil((sorted[i + 1] - sorted[i]) / every);
    for (let k = 1; k < parts; k++) ats.add(sorted[i] + ((sorted[i + 1] - sorted[i]) * k) / parts);
  }
  return [...ats].sort((a, b) => a - b).map((a) => sectionAt(sections, a));
}

/** The path's outline: up its left side, back down its right. */
export function pathOutline(sections: readonly Section[]): Pt[] {
  const out: Pt[] = [];
  for (const p of [...sections.map((s) => s.left), ...[...sections].reverse().map((s) => s.right)]) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-6) out.pop();
  return out;
}

/** How high the profile along the path is here, going straight between its points. */
export function profileHeight(profile: readonly ProfilePoint[], at: number): number {
  if (profile.length === 0) return 0;
  if (at <= profile[0].at) return profile[0].z;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [a, b] = [profile[i], profile[i + 1]];
    if (at <= b.at) return b.at > a.at ? a.z + ((b.z - a.z) * (at - a.at)) / (b.at - a.at) : b.z;
  }
  return profile[profile.length - 1].z;
}

/** A transverse profile's rise this far off the centre line; past its ends, its ends. */
function crossRise(points: readonly CrossPoint[], off: number): number {
  const sorted = [...points].sort((a, b) => a.off - b.off);
  if (sorted.length === 0) return 0;
  if (off <= sorted[0].off) return sorted[0].rise;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    if (off <= b.off) return b.off > a.off ? a.rise + ((b.rise - a.rise) * (off - a.off)) / (b.off - a.off) : b.rise;
  }
  return sorted[sorted.length - 1].rise;
}

/**
 * The rise across the path at a station, `u` of the way from the centre line to a side (1 the left, -1 the right).
 * The transverse profiles shade into each other between their stations and each holds on past the last, so a width
 * that changes along a boundary keeps its shape across it.
 */
export function riseAcross(sections: readonly Section[], crosses: readonly CrossProfile[], at: number, u: number): number {
  if (crosses.length === 0) return 0;
  const sorted = [...crosses].sort((a, b) => a.at - b.at);
  const rise = (c: CrossProfile): number => {
    const s = sectionAt(sections, c.at);
    return crossRise(c.points, u >= 0 ? u * dist(s.c, s.left) : u * dist(s.c, s.right));
  };
  if (at <= sorted[0].at) return rise(sorted[0]);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    if (at <= b.at) return rise(a) + ((rise(b) - rise(a)) * (b.at > a.at ? (at - a.at) / (b.at - a.at) : 0));
  }
  return rise(sorted[sorted.length - 1]);
}

/** The shares of the way across the path that show every transverse profile's breaks. */
function acrossShares(sections: readonly Section[], crosses: readonly CrossProfile[]): number[] {
  const out = new Set<number>([-1, -0.5, 0, 0.5, 1]);
  for (const c of crosses) {
    const s = sectionAt(sections, c.at);
    const [l, r] = [dist(s.c, s.left), dist(s.c, s.right)];
    for (const p of c.points) {
      const u = p.off >= 0 ? (l > 0 ? p.off / l : 0) : r > 0 ? p.off / r : 0;
      if (Math.abs(u) < 1) out.add(Math.round(u * 1000) / 1000);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const across = (s: Section, u: number): Pt => mix(s.c, u >= 0 ? s.left : s.right, Math.abs(u));

/** How far apart its sections are, for a path this wide. */
export const sectionSpacing = (sections: readonly Section[]): number => {
  const widest = Math.max(...sections.map((s) => dist(s.left, s.right)), 1);
  return widest / 2;
};

/** The points a path gives a site model, row by row across each section. */
export function pathGrid(sections: readonly Section[], profile: readonly ProfilePoint[], crosses: readonly CrossProfile[]): Pt3[][] {
  const stations = [...profile.map((p) => p.at), ...crosses.map((c) => c.at)];
  const shares = acrossShares(sections, crosses);
  return stationed(sections, stations, sectionSpacing(sections)).map((s) => shares.map((u): Pt3 => {
    const p = across(s, u);
    return [p.x, p.y, profileHeight(profile, s.at) + riseAcross(sections, crosses, s.at, u)];
  }));
}

/** A path's grid as flat x,y,z quads, raised by `lift`. */
export function gridFaces(grid: readonly (readonly Pt3[])[], lift: number): number[][] {
  const out: number[][] = [];
  const flat = (p: Pt3): number[] => [p[0], p[1], p[2] + lift];
  for (let i = 0; i + 1 < grid.length; i++) {
    for (let j = 0; j + 1 < grid[i].length; j++) out.push([...flat(grid[i][j]), ...flat(grid[i][j + 1]), ...flat(grid[i + 1][j + 1]), ...flat(grid[i + 1][j])]);
  }
  return out;
}

/** A profile running straight from its first height to its last, keeping its stations. */
export function realigned(profile: readonly ProfilePoint[]): ProfilePoint[] {
  const [first, last] = [profile[0], profile[profile.length - 1]];
  return profile.map((p) => ({ at: p.at, z: profileHeight([first, last], p.at) }));
}

/** A profile on the ground, at the corners and this many stations in between; a stretch off the ground keeps out. */
export function fittedProfile(sections: readonly Section[], heightAt: (x: number, y: number) => number | null, spacing: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (const s of stationed(sections, [], spacing)) {
    const z = heightAt(s.c.x, s.c.y);
    if (z !== null) out.push({ at: s.at, z });
  }
  return out;
}

/** The points of a profile worth a label: where its slope changes, at least `gap` apart, and its ends. */
export function profileBreaks(profile: readonly ProfilePoint[], gap: number): ProfilePoint[] {
  if (profile.length <= 2) return [...profile];
  const slope = (a: ProfilePoint, b: ProfilePoint): number => (b.z - a.z) / (b.at - a.at || 1);
  const last = profile[profile.length - 1];
  const out = [profile[0]];
  for (let i = 1; i + 1 < profile.length; i++) {
    const p = profile[i];
    if (Math.abs(slope(profile[i - 1], p) - slope(p, profile[i + 1])) < 0.001) continue;
    if (p.at - out[out.length - 1].at >= gap && last.at - p.at >= gap) out.push(p);
  }
  out.push(last);
  return out;
}

/** Stretches what's along a path when its length changes. */
export const scaledProfile = (profile: readonly ProfilePoint[], by: number): ProfilePoint[] => profile.map((p) => ({ at: p.at * by, z: p.z }));
export const scaledCrosses = (crosses: readonly CrossProfile[], by: number): CrossProfile[] => crosses.map((c) => ({ ...c, at: c.at * by }));

/** How far along the path a place falls: the nearest place on its centre line. */
export function stationOf(sections: readonly Section[], p: Pt): number {
  let best = { at: 0, off: Infinity };
  for (let i = 0; i + 1 < sections.length; i++) {
    const [a, b] = [sections[i], sections[i + 1]];
    const [dx, dy] = [b.c.x - a.c.x, b.c.y - a.c.y];
    const t = Math.min(1, Math.max(0, ((p.x - a.c.x) * dx + (p.y - a.c.y) * dy) / (dx * dx + dy * dy || 1)));
    const off = Math.hypot(p.x - a.c.x - dx * t, p.y - a.c.y - dy * t);
    if (off < best.off) best = { at: a.at + (b.at - a.at) * t, off };
  }
  return best.at;
}

/** A section's half widths: to its left and to its right. */
export const halves = (s: Section): { readonly left: number; readonly right: number } => ({ left: dist(s.c, s.left), right: dist(s.c, s.right) });
