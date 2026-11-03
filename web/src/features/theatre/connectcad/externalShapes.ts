// The sums behind ConnectCAD's External tool (tools.ts) and its objects (schematic.ts): an external's
// pointed outline, its sockets after an Object Info edit, and where and under what names a linear
// array of them goes. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import type { Box, Side, Socket, SocketType } from "./ccadShapes.ts";

/** A left external points out of the drawing to the left, its sockets on its right facing in; a right one the other way. */
export type Facing = "Left" | "Right";
export const FACINGS: readonly Facing[] = ["Left", "Right"];
/** a new external's width, in pitches */
export const EXTERNAL_WIDTH = 6;
export const MAX_CIRCUITS = 64;
/** externals a linear array places at most */
export const MAX_ARRAY = 100;

export const socketSide = (f: Facing): Side => (f === "Left" ? "R" : "L");

/** An external's outline in its own frame (top left at the origin): its box, the end away from its sockets pointed. */
export function externalOutline(box: Box, facing: Facing, pitch: number): Pt[] {
  const { width: w, height: h } = box;
  const point = Math.min(pitch, w / 3);
  return facing === "Left"
    ? [
        { x: point, y: 0 },
        { x: w, y: 0 },
        { x: w, y: -h },
        { x: point, y: -h },
        { x: 0, y: -h / 2 },
      ]
    : [
        { x: 0, y: 0 },
        { x: w - point, y: 0 },
        { x: w, y: -h / 2 },
        { x: w - point, y: -h },
        { x: 0, y: -h },
      ];
}

export interface ExternalFields {
  readonly type: SocketType;
  readonly signal: string;
  readonly connector: string;
  readonly facing: Facing;
  readonly circuits: number;
}
export type ExternalField = "type" | "signal" | "connector" | "facing";

/** How many circuits an external has: a whole number from 1 to MAX_CIRCUITS. */
export const circuitCount = (n: number): number => Math.max(1, Math.min(MAX_CIRCUITS, Math.round(Number.isFinite(n) ? n : 1)));

/**
 * An external's sockets after an edit: the fields `changed` given to every socket (the facing moving them
 * to its side), then the last cut or new ones added, numbered on, to make `fields.circuits`. Each socket
 * keeps its id, name and terminator, so circuits stay joined.
 */
export function externalSockets(existing: readonly Socket[], fields: ExternalFields, changed: ReadonlySet<ExternalField>): Socket[] {
  const side = socketSide(fields.facing);
  const ordered = [...existing].sort((a, b) => a.slot - b.slot || a.id - b.id);
  const kept = ordered.slice(0, circuitCount(fields.circuits)).map(
    (k): Socket => ({
      ...k,
      side: changed.has("facing") ? side : k.side,
      type: changed.has("type") ? fields.type : k.type,
      signal: changed.has("signal") ? fields.signal : k.signal,
      connector: changed.has("connector") || changed.has("signal") ? fields.connector : k.connector,
    }),
  );
  const names = new Set(kept.map((k) => k.name));
  let id = Math.max(0, ...existing.map((k) => k.id));
  let slot = Math.max(-1, ...kept.filter((k) => k.side === side).map((k) => k.slot));
  let n = 0;
  while (kept.length < circuitCount(fields.circuits)) {
    do n++;
    while (names.has(String(n)));
    names.add(String(n));
    kept.push({ id: ++id, name: String(n), tag: String(n), type: fields.type, side, slot: ++slot, signal: fields.signal, connector: fields.connector, terminated: false });
  }
  return kept;
}

/**
 * Where a linear array of externals goes, from a click at `a` toward `b`: their top-left corners, a
 * box and a pitch apart along the line, as many as fit its length (at least one).
 */
export function arrayPlaces(a: Pt, b: Pt, box: Box, pitch: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return [a];
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const step = Math.abs(u.x) * (box.width + pitch) + Math.abs(u.y) * (box.height + pitch);
  const count = Math.min(MAX_ARRAY, Math.floor(len / step + 1e-9) + 1);
  return Array.from({ length: count }, (_, i) => ({ x: a.x + u.x * step * i, y: a.y + u.y * step * i }));
}

/** The names of an array of `count` externals: the name asked with a number after it, counting on from its own and skipping names taken. */
export function arrayNames(asked: string, count: number, taken: ReadonlySet<string>, digits = 1): string[] {
  const m = /^(.*?)(\d+)$/.exec(asked.trim());
  const stem = m ? m[1] : asked.trim() || "EXT";
  const width = Math.max(m ? m[2].length : 1, digits);
  let n = m ? Number(m[2]) : 1;
  const out: string[] = [];
  while (out.length < count) {
    const name = stem + String(n++).padStart(width, "0");
    if (!taken.has(name)) out.push(name);
  }
  return out;
}
