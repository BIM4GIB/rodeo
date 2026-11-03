// Create Polys from Walls' geometry: the walls' areas joined (polygon-clipping), and the outline of
// each joined area or the holes in it as rings.

import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";
import type { Pt } from "../core/index.ts";

/** A ring's area. */
export const ringArea = (ring: readonly Pt[]): number => Math.abs(ring.reduce((a, p, i) => a + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0)) / 2;

/** grids (mm) the walls' points are snapped to before they are joined, finer first: polygon-clipping can fail on edges a hair from meeting */
const SNAPS = [1e-3, 1e-2, 0.1, 1];

/** The outlines (gross) or rooms (net) that wall areas make when joined. */
export function wallPolys(footprints: readonly Pt[][], net: boolean): Pt[][] {
  if (!footprints.length) return [];
  let joined: MultiPolygon | null = null;
  for (const grid of SNAPS) {
    const snap = (v: number): number => Math.round(v / grid) * grid;
    const [first, ...rest] = footprints.map((f): Polygon => [f.map((q): Pair => [snap(q.x), snap(q.y)])]);
    try {
      joined = polygonClipping.union(first, ...rest);
      break;
    } catch {
      // a coarser grid next
    }
  }
  if (!joined) throw new Error("these walls' outlines couldn't be joined");
  // each joined area: its outline, then its holes
  return joined
    .flatMap((rings) => (net ? rings.slice(1) : rings.slice(0, 1)))
    .map((ring) => withoutInLine(ring.slice(0, -1).map(([x, y]): Pt => ({ x, y }))))
    .filter((ring) => ring.length >= 3 && ringArea(ring) > 1e-6);
}

/**
 * A ring without the points where two walls' areas met: a corner the join repeats a hair away
 * (within 0.001 mm of the point before it), and points in line between their neighbours.
 */
function withoutInLine(ring: Pt[]): Pt[] {
  let out = ring.filter((p, i) => {
    const before = ring[(i - 1 + ring.length) % ring.length];
    return i === 0 || Math.hypot(p.x - before.x, p.y - before.y) > 1e-3;
  });
  // the last against the first
  while (out.length > 3 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-3) out = out.slice(0, -1);
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const p = out[i];
      const b = out[(i + 1) % out.length];
      const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
      // straight on: no turn, and not doubling back
      if (Math.abs(ux * vy - uy * vx) <= 1e-7 * Math.hypot(ux, uy) * Math.hypot(vx, vy) + 1e-12 && ux * vx + uy * vy >= 0) {
        out = [...out.slice(0, i), ...out.slice(i + 1)];
        changed = true;
        i--;
      }
    }
  }
  return out;
}
