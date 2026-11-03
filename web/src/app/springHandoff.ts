// The spring AEC > Machine Design > Spring Calculator hands to the Compression Spring 2 tools (tools/machine.ts),
// kept apart so the calculator needn't import the tools. A tool takes it the next time it works out its coils.

import type { SpringEnds } from "./springShapes.ts";

export interface HandedSpring {
  readonly ends: SpringEnds;
  readonly wire: number;
  readonly mean: number;
  readonly active: number;
  readonly solid: number;
}

const handed = new Map<string, HandedSpring>();

/** Gives the tool `id` the spring to draw next. */
export function handSpring(id: "compspring2" | "compspring23d", spring: HandedSpring): void {
  handed.set(id, spring);
}

/** The spring handed to tool `id`, once. */
export function takeHandedSpring(id: string): HandedSpring | null {
  const s = handed.get(id) ?? null;
  handed.delete(id);
  return s;
}
