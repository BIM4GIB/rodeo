// A straight wall seen face on, with its openings cut through it, for walls an import makes whole
// (EditSession.addPlainWalls): its elevation, `length` along its line by `height` up from its foot,
// less each opening's outline; the rings of what is left, which the wall's cached 3D extrudes
// across its thickness as edges (FORMAT.md §7, Walls in 3D: faces are rebuilt from edges, a ring
// inside another a hole); and where it stands along its line at the height a plan is cut, which its
// plan drawing shows, broken where doors and windows are.

import polygonClipping, { type Pair, type Polygon } from "polygon-clipping";
import type { Pt } from "./types.ts";

/** How high above its foot a wall's plan is cut, as Revit's plan views cut by default (mm); half its height when lower. */
export const PLAN_CUT = 1200;

/** Plan pieces shorter than this along the line are left out (mm). */
const MIN_PIECE = 0.5;

export interface WallProfile {
  /** the rings of the wall's elevation, (along its line, up from its foot), each without its first point repeated */
  rings: Pt[][];
  /** where it stands along its line at the plan's cut height, from and to */
  plan: [number, number][];
}

/** The wall's elevation less `openings` (outlines in the same frame), or null when nothing is left of it. */
export function wallProfile(length: number, height: number, openings: readonly (readonly Pt[])[]): WallProfile | null {
  if (!(length > 0 && height > 0)) return null;
  const whole: Polygon = [
    [
      [0, 0],
      [length, 0],
      [length, height],
      [0, height],
      [0, 0],
    ],
  ];
  const holes: Polygon[] = openings
    .filter((o) => o.length >= 3 && o.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    .map((o) => [[...o.map((p): Pair => [p.x, p.y]), [o[0].x, o[0].y]]]);
  const left = holes.length ? polygonClipping.difference(whole, ...holes) : [whole];
  const rings = left.flatMap((poly) => poly.map((ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }))));
  if (!rings.length) return null;
  return { rings, plan: crossings(rings, Math.min(PLAN_CUT, height / 2)) };
}

/** The runs along x where the rings (holes inside them) cover height `z`. */
function crossings(rings: readonly Pt[][], z: number): [number, number][] {
  const xs: number[] = [];
  for (const ring of rings)
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      // half-open, so a corner exactly at z counts once
      if (a.y <= z !== b.y <= z) xs.push(a.x + ((z - a.y) * (b.x - a.x)) / (b.y - a.y));
    });
  xs.sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > MIN_PIECE) runs.push([xs[i], xs[i + 1]]);
  return runs;
}
