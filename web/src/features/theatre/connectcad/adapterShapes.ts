// The sums behind ConnectCAD's Adapter tool (tools.ts) and its adapters (schematic.ts): an adapter sits
// on a device's socket, just outside the device, and gives circuits sockets of its own on its far side
// (another connector, or several, as a splitter's), of the socket's signal and way. Where it goes for a
// socket on the device's left or right, and which socket a dragged adapter is dropped on. Kept apart
// so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import type { Box, Side, Socket } from "./ccadShapes.ts";

/** an adapter's width, in pitches */
export const ADAPTER_WIDTH = 3;
export const MAX_ADAPTER_SOCKETS = 16;

/** An adapter's socket names from a list ("L, R"): one socket of no name for an empty list. */
export function adapterNames(text: string): string[] {
  const names = text
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length ? names.slice(0, MAX_ADAPTER_SOCKETS) : [""];
}

/**
 * An adapter's sockets on a host socket: one for each name, down the side away from the host (the
 * host socket's own side), of its signal and way, of the adapter's connector. Sockets it has already
 * keep their ids by place, so circuits stay joined.
 */
export function adapterSockets(names: readonly string[], host: Socket, connector: string, existing: readonly Socket[] = []): Socket[] {
  const ordered = [...existing].sort((a, b) => a.slot - b.slot || a.id - b.id);
  let id = Math.max(0, ...existing.map((k) => k.id));
  return names.map((name, i): Socket => ({ id: ordered[i]?.id ?? ++id, name, tag: name, type: host.type, side: host.side, slot: i, signal: host.signal, connector, terminated: false }));
}

/** Whether a socket can take an adapter: one on a device's left or right, not looped or terminated. */
export function adapterRefusal(k: Socket): string | null {
  if (k.side !== "L" && k.side !== "R") return "An adapter goes on a socket on a device's left or right side.";
  if (k.loop !== undefined) return `${k.name} is looped: take its loop off to put an adapter on it.`;
  if (k.terminated) return `${k.name} is terminated: take its terminator off to put an adapter on it.`;
  return null;
}

/**
 * Where an adapter of `box` goes on a host socket whose tip is at `tip` (in the host's frame): its top
 * left, its first row level with the socket, its near edge on the device's edge, out on the socket's side.
 */
export function adapterCorner(tip: Pt, side: Side, box: Box, pitch: number): Pt {
  const y = tip.y + 1.5 * pitch;
  return side === "L" ? { x: tip.x - box.width, y } : { x: tip.x, y };
}

/** The point of an adapter (in its own frame, top left at the origin) that goes on its host socket's tip. */
export const adapterNear = (side: Side, box: Box, pitch: number): Pt => ({ x: side === "L" ? box.width : 0, y: -1.5 * pitch });
