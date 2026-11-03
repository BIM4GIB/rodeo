// The sums behind ConnectCAD's layout objects (layoutRoom.ts): a layout room's area, and the Room ID
// of a point inside rooms, from the outermost in, as Vectorworks joins nested rooms' names; and where
// Create Equipment (createEquipment.ts) puts equipment round a room's walls or round the drawing.
// Kept apart so it runs without the page.

import type { BBox, Pt } from "../../../core/index.ts";

/** The area a ring of corners closes, whichever way round it runs. */
export const ringArea = (ring: readonly Pt[]): number =>
  Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length];
      return sum + p.x * q.y - q.x * p.y;
    }, 0),
  ) / 2;

/** Whether `p` is inside a ring of corners (even-odd). */
export function insideRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A room as the Room ID sums see it: its ID and its corners on the drawing. */
export interface RoomRing {
  readonly id: string;
  readonly ring: readonly Pt[];
}

/** The Room ID of a point: the IDs of the rooms round it joined by dots, the largest (outermost) first, as MAIN.AV1; "" when it's in none. A room with no ID is passed over. */
export function roomPath(rooms: readonly RoomRing[], p: Pt): string {
  return rooms
    .filter((r) => r.id && r.ring.length >= 3 && insideRing(p, r.ring))
    .map((r) => ({ id: r.id, area: ringArea(r.ring) }))
    .sort((a, b) => b.area - a.area)
    .map((r) => r.id)
    .join(".");
}

/** Where a room's Room ID goes: its outline's top left, `inset` in from each side. */
export function roomLabelAt(ring: readonly Pt[], inset: number): Pt {
  return { x: Math.min(...ring.map((p) => p.x)) + inset, y: Math.max(...ring.map((p) => p.y)) - inset };
}

/** A room's walls as open 3D polylines (x, y, z triples): round its foot at `z0`, round its top at `z1`, and up each corner. */
export function roomWireframe(ring: readonly Pt[], z0: number, z1: number): { points: number[]; closed: false }[] {
  const loop = (z: number): number[] => [...ring, ring[0]].flatMap((p) => [p.x, p.y, z]);
  return [{ points: loop(z0), closed: false }, { points: loop(z1), closed: false }, ...ring.map((p) => ({ points: [p.x, p.y, z0, p.x, p.y, z1], closed: false as const }))];
}

/** Where a piece of equipment stands: its front's middle, and how far it's turned (its back toward +y in its own frame). */
export interface Spot {
  readonly at: Pt;
  readonly angle: number;
}

/**
 * Equipment round the inside of a room, backs to its walls: along each wall from its first corner in
 * turn, `gap` apart and clear of the corners by the deepest piece; a piece too wide for what's left of
 * a wall goes on to the next, and when every wall is full they start round again over the first.
 */
export function roundRoom(ring: readonly Pt[], sizes: readonly { readonly width: number; readonly depth: number }[], gap: number): Spot[] {
  const signed = ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0);
  const corners = signed < 0 ? [...ring].reverse() : [...ring];
  const n = corners.length;
  const deepest = Math.max(0, ...sizes.map((z) => z.depth));
  const start = gap + deepest;
  let wall = 0;
  let along = start;
  return sizes.map(({ width, depth }) => {
    const length = (k: number): number => Math.hypot(corners[(k + 1) % n].x - corners[k].x, corners[(k + 1) % n].y - corners[k].y);
    for (let tried = 0; along + width > length(wall) - start && tried < n; tried++) {
      wall = (wall + 1) % n;
      along = start;
    }
    const a = corners[wall];
    const b = corners[(wall + 1) % n];
    const l = length(wall) || 1;
    const e = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    const middle = along + width / 2;
    along += width + gap;
    // inside is to the left of a wall running anticlockwise; the front faces in, the back on the wall
    return { at: { x: a.x + e.x * middle - e.y * depth, y: a.y + e.y * middle + e.x * depth }, angle: (Math.atan2(-e.y, -e.x) * 180) / Math.PI };
  });
}

/** Equipment round a drawing's bounds, facing down the page: rack equipment stacked down its left, the rest in a row along its top, `gap` apart. */
export function roundDrawing(box: BBox, sizes: readonly { readonly width: number; readonly depth: number; readonly rack: boolean }[], gap: number): Spot[] {
  let down = box.y1;
  let across = box.x0;
  return sizes.map(({ width, depth, rack }) => {
    if (rack) {
      const at = { x: box.x0 - gap - width / 2, y: down - depth };
      down = at.y - gap;
      return { at, angle: 0 };
    }
    const at = { x: across + width / 2, y: box.y1 + gap };
    across += width + gap;
    return { at, angle: 0 };
  });
}
