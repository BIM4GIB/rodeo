// The sums behind ConnectCAD's Distribution Amplifier tool (tools.ts) and its devices (schematic.ts):
// a DA's sockets (an input on its left, looped to a second when it has a loop-thru, and its outputs
// down its right), kept through an Object Info edit, and the point of a circuit a click falls on,
// where a DA placed on the circuit splits it. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { PASSIVE, signalNamed, UNKNOWN, type Socket } from "./ccadShapes.ts";

export const DA_TYPES = ["Video", "Audio"] as const;
export type DaType = (typeof DA_TYPES)[number];
/** a new DA's width, in pitches */
export const DA_WIDTH = 6;
export const MAX_OUTPUTS = 32;

/** what each type of DA starts with: its signal, its name and its Device Type */
export const DA_DEFAULTS: Readonly<Record<DaType, { readonly signal: string; readonly name: string; readonly device: string }>> = {
  Video: { signal: "SDI", name: "VDA1", device: "Video DA" },
  Audio: { signal: "Analog Audio", name: "ADA1", device: "Audio DA" },
};

/** The type a Device Type names, or null for a device that isn't a DA. */
export const daTypeOf = (device: string): DaType | null => DA_TYPES.find((t) => DA_DEFAULTS[t].device === device) ?? null;

/** Whether a DA of a type can carry a signal: its own category's, or a passive or unknown one. */
export const daCarries = (type: DaType, signal: string): boolean => [PASSIVE, UNKNOWN].includes(signal) || signalNamed(signal)?.category === type;

/** How many outputs a DA has: a whole number from 1 to MAX_OUTPUTS. */
export const outputCount = (n: number): number => Math.max(1, Math.min(MAX_OUTPUTS, Math.round(Number.isFinite(n) ? n : 1)));

/** The description a DA writes in its first row while it isn't given another: "1×4 Video DA". */
export const daDescription = (type: DaType, outputs: number): string => `1×${outputCount(outputs)} ${type} DA`;

export interface DaFields {
  readonly outputs: number;
  readonly loop: boolean;
  readonly signal: string;
  readonly connector: string;
}

/**
 * A DA's sockets: its input (the first that takes a signal in on its left), looped to the socket below
 * it when it has a loop-thru, and `outputs` outputs down its right, the last cut or new ones added in
 * the free rows. Sockets kept keep their ids, names and signals, so circuits stay joined; any others
 * it was given are left as they are. Why not, when the row below the input is taken.
 */
export function daSockets(existing: readonly Socket[], fields: DaFields): Socket[] | string {
  let id = Math.max(0, ...existing.map((k) => k.id));
  const names = new Set(existing.map((k) => k.name));
  const named = (stem: string): string => {
    let n = 1;
    while (names.has(`${stem}${n}`)) n++;
    names.add(`${stem}${n}`);
    return `${stem}${n}`;
  };
  const make = (type: "IN" | "OUT", side: "L" | "R", slot: number): Socket => {
    const name = named(type);
    return { id: ++id, name, tag: name, type, side, slot, signal: fields.signal, connector: fields.connector, terminated: false };
  };
  const bySlot = (a: Socket, b: Socket): number => a.slot - b.slot || a.id - b.id;
  const lefts = existing.filter((k) => k.side === "L" && k.type !== "OUT").sort(bySlot);
  const input = lefts[0] ?? make("IN", "L", 0);
  const partner = input.loop === undefined ? undefined : existing.find((k) => k.id === input.loop);
  let through: Socket | undefined;
  if (fields.loop) {
    through = partner;
    if (!through) {
      const below = existing.find((k) => k.side === "L" && k.slot === input.slot + 1);
      if (below) return `${below.name} is in the row below the input: move it to loop the input.`;
      through = make("IN", "L", input.slot + 1);
    }
  }
  const outs = existing.filter((k) => k.side === "R" && k.type === "OUT").sort(bySlot);
  const kept = outs.slice(0, outputCount(fields.outputs));
  const managed = new Set([input.id, ...(partner ? [partner.id] : []), ...outs.map((k) => k.id)]);
  const others = existing.filter((k) => !managed.has(k.id));
  const taken = new Set([...others, ...kept].filter((k) => k.side === "R").map((k) => k.slot));
  let slot = 0;
  while (kept.length < outputCount(fields.outputs)) {
    while (taken.has(slot)) slot++;
    taken.add(slot);
    kept.push(make("OUT", "R", slot));
  }
  const { loop: _gone, ...plain } = input;
  const ins: Socket[] = through ? [{ ...plain, loop: through.id }, { ...through, loop: input.id }] : [plain];
  return [...ins, ...kept.sort(bySlot), ...others];
}

/** The point of a run of lines nearest `p`, and how far it is; null for a run of fewer than two points. */
export function nearestOnPath(points: readonly Pt[], p: Pt): { at: Pt; distance: number } | null {
  let best: { at: Pt; distance: number } | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const at = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(p.x - at.x, p.y - at.y);
    if (!best || distance < best.distance) best = { at, distance };
  }
  return best;
}
