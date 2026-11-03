// Measuring along a path, for Duplicate Along Path: a point and the path's direction
// at any distance from its start, and the distances copies go to. Pure: no DOM, no
// store. Paths are read as cutting.ts reads them; lengths are document units.

import type { Pt } from "../core/index.ts";
import type { CutPath } from "./cutting.ts";
import { degToRad, dist } from "./geom.ts";

/** More copies than this in one go are refused. */
export const MAX_COPIES = 1000;

/** Where a distance along a path lands, and the path's direction there (degrees from +x). */
export interface Spot {
  readonly p: Pt;
  readonly angle: number;
}

/** A path measured along its length. */
export interface Walk {
  readonly length: number;
  readonly closed: boolean;
  at(d: number): Spot;
}

export function walkOf(path: CutPath): Walk {
  if (path.kind === "arc") {
    const r = path.radius;
    const sign = Math.sign(path.sweep);
    return {
      length: (Math.abs(path.sweep) * Math.PI * r) / 180,
      closed: path.closed,
      at: (d) => {
        const deg = path.start + (sign * d * 180) / (Math.PI * r);
        const a = degToRad(deg);
        return { p: { x: path.centre.x + r * Math.cos(a), y: path.centre.y + r * Math.sin(a) }, angle: deg + sign * 90 };
      },
    };
  }
  const pts = path.closed ? [...path.pts, path.pts[0]] : path.pts;
  const ends = [0];
  for (let i = 1; i < pts.length; i++) ends.push(ends[i - 1] + dist(pts[i - 1], pts[i]));
  const length = ends[ends.length - 1];
  return {
    length,
    closed: path.closed,
    at: (d) => {
      let i = 1;
      while (i < pts.length - 1 && ends[i] < d) i++;
      // a zero-length piece takes its direction from the next piece that has one
      let j = i;
      while (j < pts.length - 1 && dist(pts[j - 1], pts[j]) === 0) j++;
      const a = pts[i - 1];
      const b = pts[i];
      const span = ends[i] - ends[i - 1];
      const t = span > 0 ? Math.min(1, Math.max(0, (d - ends[i - 1]) / span)) : 0;
      const dir = Math.atan2(pts[j].y - pts[j - 1].y, pts[j].x - pts[j - 1].x);
      return { p: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, angle: (dir * 180) / Math.PI };
    },
  };
}

/** How the copies are spaced. */
export interface Spacing {
  readonly by: "number" | "distance";
  /** the number of copies, or the distance between them (mm) */
  readonly value: number;
  /** where the first copy goes, as a distance from the path's start (mm) */
  readonly offset: number;
}

/** The distances along the path the copies go to. */
export function spotsAlong(length: number, closed: boolean, s: Spacing): number[] {
  const out: number[] = [];
  if (s.by === "number") {
    const n = Math.round(s.value);
    if (closed) for (let i = 0; i < n; i++) out.push((s.offset + (i * length) / n) % length);
    else if (n === 1) out.push(s.offset);
    else for (let i = 0; i < n; i++) out.push(s.offset + (i * (length - s.offset)) / (n - 1));
    return out;
  }
  // a closed path goes round once, stopping short of the first spot again (which it always has)
  const end = closed ? s.offset + length - s.value / 2 : length + 1e-9;
  for (let d = s.offset; (d <= end || out.length === 0) && out.length <= MAX_COPIES; d += s.value) out.push(closed ? d % length : d);
  return out;
}
