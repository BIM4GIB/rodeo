// The lighting state being looked at: each channel's level, 0 to 1, which beam pools, 3D beams and the
// coverage map all draw by. With none set, every channel is at full. It isn't saved: Looks (looks/) sets it.

import { appContext } from "../../app/ext.ts";

let levels: ReadonlyMap<string, number> | null = null;
const listeners = new Set<() => void>();

/** A channel's level now, 0 to 1. A channel a look leaves out is off. */
export function levelOf(channel: string): number {
  return levels ? (levels.get(channel) ?? 0) : 1;
}

/** Whether a look is being shown (else everything shows at full). */
export function hasLevels(): boolean {
  return levels !== null;
}

/** Sets the state shown (null for everything at full) and redraws. */
export function setLevels(next: ReadonlyMap<string, number> | null): void {
  levels = next;
  for (const fn of listeners) fn();
  appContext()?.requestDraw();
}

/** Calls `fn` whenever the state shown changes; the result stops that. */
export function onLevels(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
