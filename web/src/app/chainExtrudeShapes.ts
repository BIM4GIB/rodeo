// The sums behind the Building Shell's Chain Extrude: a continuous profile run along a path with mitred
// corners, and a repeating profile given a thickness and set along it. The sections read x out from the
// path and y up from the reference point. Kept apart from the page (tools/chainExtrude.ts) so a check can
// run it. Lengths in mm, in the plan's own frame; triangles are 9 numbers each.

import { outward } from "../core/csg.ts";
import type { Pt } from "../core/index.ts";
import { capTriangles, type Point3 } from "./loftShapes.ts";

/** The shapes as they were drawn: the back one continuous, those in front of it repeating, and a locus if the reference is set by one. */
export interface ChainProfile {
  readonly continuous: readonly Pt[];
  readonly repeating: readonly (readonly Pt[])[];
  readonly locus: Pt | null;
}

export type ChainDatum = "top" | "bottom";

export interface ChainOptions {
  /** to the path's right as it's walked, rather than its left */
  readonly flip: boolean;
  readonly centerRibs: boolean;
  readonly cornerRibs: boolean;
  readonly datum: ChainDatum;
  readonly thickness: number;
  readonly spacing: number;
  /** the reference point's height */
  readonly elevation: number;
}

export interface ChainFrame {
  readonly at: Pt;
  /** what moving a point out by one takes it by: longer than one at a corner, so it stays on the mitre */
  readonly miter: Pt;
}

export interface ChainSide {
  readonly from: Pt;
  readonly along: Pt;
  readonly out: Pt;
  readonly length: number;
}

export interface ChainPath {
  readonly frames: readonly ChainFrame[];
  readonly sides: readonly ChainSide[];
  readonly closed: boolean;
}

/** Where a rib stands: `at`, running out along `out` (longer than one on a corner's bisector), `across` its thickness. */
export interface ChainRib {
  readonly at: Pt;
  readonly out: Pt;
  readonly across: Pt;
}

const TOL = 1e-6;

/** The sections, x out from the path and y up from the reference: a locus, or the top or bottom right of the continuous shape's box. */
export function chainSections(profile: ChainProfile, datum: ChainDatum): { continuous: Pt[]; repeating: Pt[][] } {
  const xs = profile.continuous.map((p) => p.x);
  const ys = profile.continuous.map((p) => p.y);
  const ref = profile.locus ?? { x: Math.max(...xs), y: datum === "top" ? Math.max(...ys) : Math.min(...ys) };
  const section = (shape: readonly Pt[]): Pt[] => shape.map((p) => ({ x: ref.x - p.x, y: p.y - ref.y }));
  return { continuous: section(profile.continuous), repeating: profile.repeating.map(section) };
}

/** The path's corners with their mitres and its sides, or a string saying why it won't do. */
export function chainPath(points: readonly Pt[], closed: boolean, flip: boolean): ChainPath | string {
  const clean: Pt[] = [];
  for (const p of points) if (!clean.length || Math.hypot(p.x - clean[clean.length - 1].x, p.y - clean[clean.length - 1].y) > TOL) clean.push(p);
  if (closed && clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) <= TOL) clean.pop();
  if (clean.length < (closed ? 3 : 2)) return "The path needs at least two corners.";
  const n = clean.length;
  const count = closed ? n : n - 1;
  const sign = flip ? -1 : 1;
  const sides: ChainSide[] = [];
  for (let i = 0; i < count; i++) {
    const [a, b] = [clean[i], clean[(i + 1) % n]];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    sides.push({ from: a, along, length, out: { x: -along.y * sign, y: along.x * sign } });
  }
  const frames: ChainFrame[] = [];
  for (let i = 0; i < n; i++) {
    const before = sides[closed ? (i + n - 1) % n : Math.max(i - 1, 0)];
    const after = sides[closed ? i : Math.min(i, count - 1)];
    const meet = 1 + before.out.x * after.out.x + before.out.y * after.out.y;
    if (meet < 1e-4) return "The path doubles back on itself, so it can't turn that corner.";
    frames.push({ at: clean[i], miter: { x: (before.out.x + after.out.x) / meet, y: (before.out.y + after.out.y) / meet } });
  }
  return { frames, sides, closed };
}

/** Triangles from a closed run of rings, or an open one with its ends capped, facing out. */
function skinned(rings: readonly (readonly Point3[])[], joined: boolean): number[] {
  const out: number[] = [];
  const steps = joined ? rings.length : rings.length - 1;
  for (let i = 0; i < steps; i++) {
    const [p, q] = [rings[i], rings[(i + 1) % rings.length]];
    for (let j = 0; j < p.length; j++) {
      const k = (j + 1) % p.length;
      out.push(...p[j], ...p[k], ...q[k], ...p[j], ...q[k], ...q[j]);
    }
  }
  if (!joined) for (const ring of [rings[0], rings[rings.length - 1]]) out.push(...capTriangles(ring as Point3[]).flatMap(([a, b, c]) => [...ring[a], ...ring[b], ...ring[c]]));
  return Array.from(outward(out, 1e-4));
}

/** The continuous part: the section along the path, mitred at its corners. */
export function chainContinuous(path: ChainPath, section: readonly Pt[], elevation: number): number[] {
  const rings = path.frames.map((f) => section.map((p): Point3 => [f.at.x + f.miter.x * p.x, f.at.y + f.miter.y * p.x, elevation + p.y]));
  return skinned(rings, path.closed);
}

/** How far ribs stay from a corner along each side, for ribs reaching `reach` out: the mitre zone. */
function miterZone(frame: ChainFrame, reach: number): number {
  return reach * Math.sqrt(Math.max(0, frame.miter.x * frame.miter.x + frame.miter.y * frame.miter.y - 1));
}

/** Where the ribs stand: along the sides, clear of the mitre zones and centred on what's left, and on the corners' bisectors. */
export function chainRibs(path: ChainPath, reach: number, o: ChainOptions): ChainRib[] {
  const ribs: ChainRib[] = [];
  const n = path.frames.length;
  if (o.centerRibs) {
    path.sides.forEach((side, i) => {
      const start = path.closed || i > 0 ? miterZone(path.frames[i], reach) : 0;
      const end = path.closed || i < path.sides.length - 1 ? miterZone(path.frames[(i + 1) % n], reach) : 0;
      const room = side.length - start - end;
      if (room < o.thickness) return;
      const count = Math.floor((room - o.thickness) / o.spacing + 1e-9) + 1;
      const first = start + room / 2 - ((count - 1) * o.spacing) / 2;
      for (let k = 0; k < count; k++) {
        const s = first + k * o.spacing;
        ribs.push({ at: { x: side.from.x + side.along.x * s, y: side.from.y + side.along.y * s }, out: side.out, across: side.along });
      }
    });
  }
  if (o.cornerRibs) {
    path.frames.forEach((f, i) => {
      if (!path.closed && (i === 0 || i === n - 1)) return;
      const size = Math.hypot(f.miter.x, f.miter.y);
      ribs.push({ at: f.at, out: f.miter, across: { x: -f.miter.y / size, y: f.miter.x / size } });
    });
  }
  return ribs;
}

/** One rib's solid: the section given its thickness. */
export function ribTriangles(rib: ChainRib, section: readonly Pt[], o: ChainOptions): number[] {
  const ring = (side: number): Point3[] =>
    section.map((p): Point3 => [
      rib.at.x + rib.out.x * p.x + (rib.across.x * side * o.thickness) / 2,
      rib.at.y + rib.out.y * p.x + (rib.across.y * side * o.thickness) / 2,
      o.elevation + p.y,
    ]);
  return skinned([ring(-1), ring(1)], false);
}

export interface ChainPlan {
  /** the continuous part's edges, seen from above */
  readonly lines: readonly Pt[][];
  /** the ribs' outlines */
  readonly ribs: readonly Pt[][];
}

const spanOf = (section: readonly Pt[]): [number, number] => [Math.min(...section.map((p) => p.x)), Math.max(...section.map((p) => p.x))];

/** The drawing for Top/Plan: the continuous part's inner and outer edges, and the ribs in outline. */
export function chainPlan(path: ChainPath, sections: { continuous: readonly Pt[]; repeating: readonly (readonly Pt[])[] }, o: ChainOptions): ChainPlan {
  const [lo, hi] = spanOf(sections.continuous);
  const offset = (u: number): Pt[] => path.frames.map((f) => ({ x: f.at.x + f.miter.x * u, y: f.at.y + f.miter.y * u }));
  const [inner, outer] = [offset(lo), offset(hi)];
  const lines: Pt[][] = [path.closed ? [...inner, inner[0]] : inner, path.closed ? [...outer, outer[0]] : outer];
  if (!path.closed) lines.push([inner[0], outer[0]], [inner[inner.length - 1], outer[outer.length - 1]]);
  const reach = chainReach(sections.repeating);
  const ribs: Pt[][] = [];
  for (const section of sections.repeating) {
    const [a, b] = spanOf(section);
    for (const rib of chainRibs(path, reach, o)) {
      const corner = (u: number, side: number): Pt => ({
        x: rib.at.x + rib.out.x * u + (rib.across.x * side * o.thickness) / 2,
        y: rib.at.y + rib.out.y * u + (rib.across.y * side * o.thickness) / 2,
      });
      ribs.push([corner(a, -1), corner(b, -1), corner(b, 1), corner(a, 1), corner(a, -1)]);
    }
  }
  return { lines, ribs };
}

/** How far the repeating sections reach from the path. */
export function chainReach(repeating: readonly (readonly Pt[])[]): number {
  return Math.max(0, ...repeating.flatMap((s) => s.map((p) => Math.abs(p.x))));
}

/** The whole object's solids: the continuous part's triangles, and the ribs' together, or a string saying why not. */
export function chainSolids(path: ChainPath, sections: { continuous: readonly Pt[]; repeating: readonly (readonly Pt[])[] }, o: ChainOptions): { continuous: number[]; ribs: number[] } | string {
  if (sections.repeating.length && (o.centerRibs || o.cornerRibs) && !(o.thickness > 0)) return "The thickness must be more than 0.";
  if (sections.repeating.length && o.centerRibs && !(o.spacing > 0)) return "The spacing must be more than 0.";
  const continuous = chainContinuous(path, sections.continuous, o.elevation);
  const standing = sections.repeating.length ? chainRibs(path, chainReach(sections.repeating), o) : [];
  const ribs = sections.repeating.flatMap((section) => standing.flatMap((rib) => ribTriangles(rib, section, o)));
  return { continuous, ribs };
}
