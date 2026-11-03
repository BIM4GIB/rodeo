// The sums behind ConnectCAD's Calculate Cable Lengths (cableLengths.ts): which racks stand side by
// side, the way along a row of them from one to another, and a cable's length between equipment in
// racks, with the allowances the Cable Length Options dialog asks for. Kept apart so it runs without
// the page.

import type { Pt } from "../../../core/index.ts";
import { insideRing } from "./layoutShapes.ts";

/** how near racks' outlines come to count as side by side, mm */
export const SIDE_BY_SIDE = 100;

/** A rack on the drawing, by object: its outline and its middle. */
export interface RackFoot {
  readonly id: string;
  readonly ring: readonly Pt[];
  readonly middle: Pt;
}

/** Where a cable's end is: the rack it's in (by object) and its middle's height above the floor, mm, and whether it's a patch panel. */
export interface CableEnd {
  readonly rack: string;
  readonly height: number;
  readonly panel: boolean;
}

/** The Cable Length Options dialog's allowances, mm: a patch panel's swan-neck, other equipment's tail, and the false floor's depth. */
export interface LengthOptions {
  readonly swanNeck: number;
  readonly tail: number;
  readonly floor: number;
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** How near two outlines come: 0 when they meet or one's inside the other. */
export function gapBetween(a: readonly Pt[], b: readonly Pt[]): number {
  if (!a.length || !b.length) return Infinity;
  if (insideRing(a[0], b) || insideRing(b[0], a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const [p, q] = [a[i], a[(i + 1) % a.length]];
    for (let j = 0; j < b.length; j++) {
      const [r, t] = [b[j], b[(j + 1) % b.length]];
      if (cross(p, q, r) * cross(p, q, t) < 0 && cross(r, t, p) * cross(r, t, q) < 0) return 0;
      best = Math.min(best, toSegment(p, r, t), toSegment(q, r, t), toSegment(r, p, q), toSegment(t, p, q));
    }
  }
  return best;
}

/**
 * The way along racks standing side by side from rack `from` to rack `to`, middle to middle through
 * the racks between: its length, or null when they aren't in one row (or group) of racks.
 */
export function alongRacks(racks: readonly RackFoot[], from: string, to: string, near = SIDE_BY_SIDE): number | null {
  const byId = new Map(racks.map((r) => [r.id, r]));
  if (!byId.has(from) || !byId.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let here: string | null = null;
    for (const [id, d] of dist) if (!done.has(id) && (here === null || d < dist.get(here)!)) here = id;
    if (here === null) return null;
    const so = dist.get(here)!;
    if (here === to) return so;
    done.add(here);
    const r = byId.get(here)!;
    for (const o of racks) {
      if (done.has(o.id) || gapBetween(r.ring, o.ring) > near) continue;
      const d = so + Math.hypot(o.middle.x - r.middle.x, o.middle.y - r.middle.y);
      if (d < (dist.get(o.id) ?? Infinity)) dist.set(o.id, d);
    }
  }
}

/**
 * A cable's length between equipment in racks, mm: in one rack the height between them; in racks
 * side by side `along` apart, down from each to the floor, under the false floor and up again, and
 * along the row; with a tail at each end, a swan-neck at a patch panel. Null when the racks aren't
 * side by side (`along` null).
 */
/** What a cable's end takes past the equipment: a patch panel's swan-neck, other equipment's tail. */
export const endAllowance = (panel: boolean, o: LengthOptions): number => (panel ? o.swanNeck : o.tail);

export function cableLength(a: CableEnd, b: CableEnd, along: number | null, o: LengthOptions): number | null {
  const ends = endAllowance(a.panel, o) + endAllowance(b.panel, o);
  if (a.rack === b.rack) return Math.abs(a.height - b.height) + ends;
  if (along === null) return null;
  return a.height + b.height + 2 * o.floor + along + ends;
}
