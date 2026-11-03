// The sums behind ConnectCAD's Adapter Slot tool (adapterSlots.ts): an adapter slot is a place on an
// equipment item's front or rear for a plug-in module, kept in the item (equipmentItem.ts). Named as a
// socket in the device of the item's name, it stands for that socket, and shows the adapter on it;
// otherwise it shows the Adapter Type given, or crossed lines for none. Where a click, a row or a block
// of slots go on the face, their names numbered on, and whether they fit. Kept apart so it runs without
// the page.

import type { Pt } from "../../../core/index.ts";
import type { FaceRect, Mounting } from "./rackShapes.ts";

export type SlotMode = "single" | "linear" | "rect";
export const SLOT_MODES: readonly { readonly id: SlotMode; readonly label: string }[] = [
  { id: "single", label: "Single Click" },
  { id: "linear", label: "Linear Array" },
  { id: "rect", label: "Rectangular Array" },
];

/** An adapter slot on one side of an equipment item: its middle across (from the face's middle, to the right seen from that side) and up (from the item's foot), and its size, mm. */
export interface AdapterSlot {
  readonly name: string;
  /** the Adapter Type given, shown while its socket has no adapter */
  readonly type: string;
  readonly side: Mounting;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
}

/** the most slots an array makes at once */
export const MOST_SLOTS = 200;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** An item's slots as kept in its field; none for an empty or unreadable one. */
export function readSlots(text: string): AdapterSlot[] {
  if (!text.trim()) return [];
  try {
    const list: unknown = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.flatMap((k: Record<string, unknown>) => {
      const width = num(k?.w);
      const height = num(k?.h);
      if (!(width > 0 && height > 0)) return [];
      return [{ name: String(k.n ?? ""), type: String(k.t ?? ""), side: k.s === "Rear" ? "Rear" : "Front", x: num(k.x), z: num(k.z), width, height }];
    });
  } catch {
    return [];
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Slots as kept in an item's field. */
export const slotsText = (slots: readonly AdapterSlot[]): string => (slots.length ? JSON.stringify(slots.map((k) => ({ n: k.name, t: k.type, s: k.side, x: r2(k.x), z: r2(k.z), w: r2(k.width), h: r2(k.height) }))) : "");

/** A slot's rectangle on its face. */
export const slotRect = (k: AdapterSlot): FaceRect => ({ x0: k.x - k.width / 2, x1: k.x + k.width / 2, z0: k.z - k.height / 2, z1: k.z + k.height / 2 });

/** `count` names from `name` with incrementing suffixes (IN1, IN2…; CARD gives CARD1, CARD2…), past those `taken`; a single slot keeps the name as it is when it's free. */
export function slotNames(name: string, count: number, taken: ReadonlySet<string> = new Set()): string[] {
  const base = name.trim();
  if (count === 1 && base && !taken.has(base)) return [base];
  const m = /^(.*?)(\d+)$/.exec(base);
  const stem = m ? m[1] : base;
  const width = m ? m[2].length : 1;
  let n = m ? Number(m[2]) : 1;
  const out: string[] = [];
  while (out.length < count) {
    const next = stem + String(n).padStart(width, "0");
    if (!taken.has(next)) out.push(next);
    n++;
  }
  return out;
}

/**
 * Where slots `width` × `height` go for a mode, their middles on the face (x across, y up): a click's
 * one; a row from `from` toward `to`, level or plumb whichever it's nearer, as many as reach it side by
 * side; or a block from `from` toward `to`, as many across and up as reach it. Left to right in each
 * row, the rows from the top.
 */
export function slotPlaces(mode: SlotMode, from: Pt, to: Pt, width: number, height: number): Pt[] {
  const count = (d: number, pitch: number): number => Math.min(MOST_SLOTS, Math.round(Math.abs(d) / pitch) + 1);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let out: Pt[] = [];
  if (mode === "single") out = [from];
  else if (mode === "linear") {
    const level = Math.abs(dx) >= Math.abs(dy);
    const n = level ? count(dx, width) : count(dy, height);
    const step = level ? { x: Math.sign(dx) * width, y: 0 } : { x: 0, y: Math.sign(dy) * height };
    out = Array.from({ length: n }, (_, k) => ({ x: from.x + k * step.x, y: from.y + k * step.y }));
  } else {
    const across = count(dx, width);
    const up = Math.min(count(dy, height), Math.floor(MOST_SLOTS / across) || 1);
    for (let j = 0; j < up; j++) for (let i = 0; i < across; i++) out.push({ x: from.x + i * Math.sign(dx) * width, y: from.y + j * Math.sign(dy) * height });
  }
  return out.sort((a, b) => b.y - a.y || a.x - b.x);
}

const overlap = (a: FaceRect, b: FaceRect): boolean => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01;

/** Why a slot can't go on a face (`face` the room on it) beside slots `others` on that side, or null when it fits. */
export function slotProblem(k: AdapterSlot, face: FaceRect, others: readonly AdapterSlot[]): string | null {
  const r = slotRect(k);
  if (r.x0 < face.x0 - 0.01 || r.x1 > face.x1 + 0.01 || r.z0 < face.z0 - 0.01 || r.z1 > face.z1 + 0.01) return `runs off the ${k.side === "Rear" ? "rear" : "front"}`;
  const hit = others.find((o) => o.side === k.side && overlap(r, slotRect(o)));
  return hit ? `overlaps ${hit.name || "another slot"}` : null;
}

/**
 * What a slot shows: with an adapter on the socket it stands for (`adapter` its make and model), the
 * adapter, <Unknown> when it has none; otherwise its Adapter Type, or crossed lines for none.
 */
export function slotLabel(k: AdapterSlot, adapter: string | null | undefined): { text: string; cross: boolean } {
  if (typeof adapter === "string") return { text: adapter.trim() || "<Unknown>", cross: false };
  const type = k.type.trim();
  return type ? { text: type, cross: false } : { text: "", cross: true };
}
