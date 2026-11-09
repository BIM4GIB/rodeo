// Agent calls using the editor's window (looking in 3D, rendering, running a menu command): the
// drawing in front stays in front while there are any, so what they see and change is their own
// drawing's. Apart from agent.ts so that the leave guard (index.ts) doesn't load the engine.

import type { DrawingRef } from "../../app/ext.ts";

const using = new Map<string, { readonly label: string; readonly drawing: DrawingRef }>();

/** Call `id` (shown as `label`) works in the window, in front, until freeWindow. */
export function useWindow(id: string, label: string, drawing: DrawingRef): void {
  using.set(id, { label, drawing });
}

export function freeWindow(id: string): void {
  using.delete(id);
}

/** Why the drawing in front can't be left now: an agent is using the window; null when none is. */
export function windowBusy(): string | null {
  const use = using.values().next().value;
  if (!use) return null;
  const name = use.drawing.name().replace(/\.[^.]+$/, "");
  return `The agent in ${name} is using the window (${use.label}): wait for it to finish, or stop it.`;
}
