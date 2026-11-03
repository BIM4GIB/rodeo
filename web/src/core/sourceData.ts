// AEC > Terrain > Validate 3D Data: what Vectorworks warns of in a site model's 3D source data,
// looked for in 3D polygons: copies of one polygon, polygons of fewer than two points, points one
// above another (one place in plan at different heights, which a site model's surface can't
// pass through) and points that turn up in more than one place in the data. Points are the same
// within SOURCE_TOLERANCE in each of x, y and z, on a grid of that size (so two a hair apart
// across a grid line count as apart). Points repeated in a row are counted by the caller with
// Simplify Polys' own rule, which is also how they are taken out.

import type { SourceDataReport } from "./types.ts";

/** What sourceDataProblems finds: all of Validate 3D Data's report but the points repeated in a row. */
export type SourceDataProblems = Omit<SourceDataReport, "repeated">;

/** A 3D polygon of the source data: its points (x, y, z) as stored. */
export interface SourcePoly {
  readonly id: string;
  readonly points: readonly (readonly number[])[];
  readonly closed: boolean;
}

/** points this close (mm) in each of x, y and z are the same */
export const SOURCE_TOLERANCE = 0.001;

/** The problems in `polys` (backmost first). */
export function sourceDataProblems(polys: readonly SourcePoly[], tol = SOURCE_TOLERANCE): SourceDataProblems {
  const grid = (v: number): number => Math.round(v / tol);
  const same = (a: readonly number[], b: readonly number[]): boolean => [0, 1, 2].every((k) => grid(a[k]) === grid(b[k]));
  let points = 0;
  const degenerate: string[] = [];
  // each polygon's points without repeats in a row, nor a closing point that repeats the first
  const runs: { id: string; pts: (readonly number[])[] }[] = [];
  for (const p of polys) {
    points += p.points.length;
    const pts: (readonly number[])[] = [];
    for (const q of p.points) if (!pts.length || !same(pts[pts.length - 1], q)) pts.push(q);
    if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
    if (pts.length < 2) degenerate.push(p.id);
    else runs.push({ id: p.id, pts });
  }
  // copies: the same set of points
  const byPoints = new Map<string, string[]>();
  for (const r of runs) {
    const key = r.pts
      .map((q) => `${grid(q[0])},${grid(q[1])},${grid(q[2])}`)
      .sort()
      .join(";");
    byPoints.set(key, [...(byPoints.get(key) ?? []), r.id]);
  }
  const duplicates = [...byPoints.values()].filter((ids) => ids.length > 1);
  const copies = new Set(duplicates.flatMap((ids) => ids.slice(1)));
  // the points of each place in plan, a copy's left out (it is reported as a copy)
  const places = new Map<string, { x: number; y: number; hits: { z: number; id: string }[] }>();
  for (const r of runs) {
    if (copies.has(r.id)) continue;
    for (const q of r.pts) {
      const key = `${grid(q[0])},${grid(q[1])}`;
      const place = places.get(key) ?? { x: q[0], y: q[1], hits: [] };
      place.hits.push({ z: q[2], id: r.id });
      places.set(key, place);
    }
  }
  const vertical: SourceDataProblems["vertical"] = [];
  const coincident: SourceDataProblems["coincident"] = [];
  for (const { x, y, hits } of places.values()) {
    if (hits.length < 2) continue;
    const ids = [...new Set(hits.map((h) => h.id))];
    const heights = [...new Map(hits.map((h) => [grid(h.z), h.z])).values()].sort((a, b) => a - b);
    if (heights.length > 1) vertical.push({ x, y, z: heights, ids });
    else coincident.push({ x, y, z: heights[0], ids });
  }
  return { polygons: polys.length, points, duplicates, degenerate, vertical, coincident };
}
