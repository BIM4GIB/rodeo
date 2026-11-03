// Patch planning for the Stage's lighting paperwork: the DMX universe and address each instrument takes, unit
// and channel numbers, the addresses two instruments share, and each universe's map. Pure: it reads the
// instruments (fixture.ts) and the stage's frame (stage.ts) and changes nothing, so the Patch window applies
// what it plans in one edit. A universe is 512 addresses; an instrument takes its footprint in them (0 counts
// as 1), and the gap is spare addresses left after each one. Left out: DMX merges, a console's own cue
// numbering and remote devices.

import { naturalCompare, type Fixture } from "../fixture.ts";
import { DEFAULT_STAGE, toStage, type StageFrame } from "../stage.ts";

/** Addresses in one DMX universe. */
export const UNIVERSE_SIZE = 512;

/** The order a patch or a numbering runs in. */
export type PatchOrder = "position" | "channel" | "unit";

/** How a patch is planned: where it starts, the spare addresses after each instrument, and the order. */
export interface PatchPlan {
  /** the first universe, from 1 */
  readonly universe: number;
  /** the first address, 1 to 512 */
  readonly address: number;
  /** spare addresses after each instrument */
  readonly gap: number;
  readonly order: PatchOrder;
  /** the stage's frame, which stage left to right is read by (the drawing's own when left out) */
  readonly frame?: StageFrame;
}

/** An instrument's proposed universe and start address. */
export interface Patched {
  readonly id: string;
  readonly universe: number;
  readonly address: number;
}

export interface UnitNumber {
  readonly id: string;
  readonly unit: string;
}

export interface ChannelNumber {
  readonly id: string;
  readonly channel: string;
}

/** Two instruments whose addresses overlap: from `from` to `to` in `universe`, both take them. */
export interface Conflict {
  readonly a: string;
  readonly b: string;
  readonly universe: number;
  readonly from: number;
  readonly to: number;
}

/** One instrument's addresses in a universe, first to last. */
export interface UniverseBlock {
  readonly start: number;
  readonly end: number;
  readonly fixtureId: string;
  readonly label: string;
}

/** A universe's blocks in address order, and how many of its addresses are used and free. */
export interface UniverseInfo {
  readonly universe: number;
  readonly blocks: readonly UniverseBlock[];
  readonly used: number;
  readonly free: number;
}

/** A count with its noun: "1 instrument", "24 instruments". */
export function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Addresses an instrument takes: its footprint, and 1 where it has none. */
export function spanOf(f: Pick<Fixture, "footprint">): number {
  return Math.max(1, Math.round(f.footprint));
}

/** Whether an instrument is patched: a universe and an address, neither 0. */
export function isPatched(f: Pick<Fixture, "universe" | "address">): boolean {
  return f.universe > 0 && f.address > 0;
}

/** The absolute DMX address of a universe and address: universe 2 address 10 is 522. */
export function absoluteOf(universe: number, address: number): number {
  return (universe - 1) * UNIVERSE_SIZE + address;
}

/** The universe an absolute DMX address falls in, from 1. */
export function universeOf(absolute: number): number {
  return Math.floor((absolute - 1) / UNIVERSE_SIZE) + 1;
}

/** The address within its universe, 1 to 512, of an absolute DMX address. */
export function addressOf(absolute: number): number {
  return ((absolute - 1) % UNIVERSE_SIZE) + 1;
}

/** Natural order of two texts, with a blank one after any other: unnamed things go last. */
export function compareText(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (x === "" || y === "") return x === y ? 0 : x === "" ? 1 : -1;
  return naturalCompare(x, y);
}

/** What an instrument is called on paper: "Ch 12 · 1st Electric · Unit 3 · Profile 26°". */
export function describeFixture(f: Pick<Fixture, "channel" | "position" | "unit" | "label">): string {
  const text = [f.channel && `Ch ${f.channel}`, f.position, f.unit && `Unit ${f.unit}`, f.label].filter(Boolean).join(" · ");
  return text || "Instrument";
}

/**
 * The instruments in order: by position, then stage left to right (across ascending, so stage right comes
 * first); or by channel or unit, then by position and stage. Ties keep the list's order.
 */
export function inOrder(list: readonly Fixture[], order: PatchOrder, frame: StageFrame = DEFAULT_STAGE): Fixture[] {
  const across = (f: Fixture): number => toStage(frame, f.at).across;
  const byPosition = (a: Fixture, b: Fixture): number => compareText(a.position, b.position) || across(a) - across(b);
  const by =
    order === "channel"
      ? (a: Fixture, b: Fixture) => compareText(a.channel, b.channel) || byPosition(a, b)
      : order === "unit"
        ? (a: Fixture, b: Fixture) => compareText(a.unit, b.unit) || byPosition(a, b)
        : byPosition;
  return [...list].sort(by);
}

/**
 * The patch: each instrument in `plan`'s order takes the next free addresses of its footprint, then the gap.
 * An instrument whose footprint would run past address 512 starts the next universe at address 1. An
 * instrument wider than a universe can't be patched and is left out. Returns the patched instruments in order.
 */
export function planPatch(list: readonly Fixture[], plan: PatchPlan): Patched[] {
  const gap = Math.max(0, Math.floor(plan.gap));
  let universe = Math.max(1, Math.floor(plan.universe));
  let address = Math.min(UNIVERSE_SIZE, Math.max(1, Math.floor(plan.address)));
  const out: Patched[] = [];
  for (const f of inOrder(list, plan.order, plan.frame)) {
    const span = spanOf(f);
    if (span > UNIVERSE_SIZE) continue;
    if (address + span - 1 > UNIVERSE_SIZE) {
      universe += 1;
      address = 1;
    }
    out.push({ id: f.id, universe, address });
    address += span + gap;
  }
  return out;
}

/** Unit numbers: each position's instruments numbered 1, 2, 3 from stage right to stage left, from `options.start`. */
export function numberUnits(list: readonly Fixture[], frame: StageFrame, options: { readonly start: number }): UnitNumber[] {
  const first = Math.floor(options.start);
  const out: UnitNumber[] = [];
  let at = 0;
  let previous: Fixture | null = null;
  for (const f of inOrder(list, "position", frame)) {
    at = previous !== null && compareText(previous.position, f.position) === 0 ? at + 1 : 0;
    out.push({ id: f.id, unit: String(first + at) });
    previous = f;
  }
  return out;
}

/**
 * Channel numbers from `options.start`: "each" gives every instrument its own, in position order; "purpose"
 * gives all those sharing a purpose and a colour one channel, numbered in the order they first come (an instrument
 * with neither keeps one of its own).
 */
export function numberChannels(list: readonly Fixture[], options: { readonly start: number; readonly by: "each" | "purpose"; readonly frame?: StageFrame }): ChannelNumber[] {
  const first = Math.floor(options.start);
  const ordered = inOrder(list, "position", options.frame);
  if (options.by === "each") return ordered.map((f, i) => ({ id: f.id, channel: String(first + i) }));
  const slots = new Map<string, number>();
  return ordered.map((f) => {
    const purpose = f.purpose.trim().toLowerCase();
    const colour = f.color.trim().toUpperCase();
    // with neither purpose nor colour there's nothing to share, so such an instrument keeps a channel of its own
    const key = purpose === "" && colour === "" ? `instrument ${f.id}` : `${purpose}|${colour}`;
    if (!slots.has(key)) slots.set(key, slots.size);
    return { id: f.id, channel: String(first + (slots.get(key) ?? 0)) };
  });
}

/** Every pair of patched instruments whose addresses overlap in a universe, with the addresses they share. */
export function conflicts(list: readonly Fixture[]): Conflict[] {
  const spans = list
    .filter(isPatched)
    .map((f) => ({ id: f.id, universe: f.universe, from: f.address, to: f.address + spanOf(f) - 1 }))
    .sort((a, b) => a.universe - b.universe || a.from - b.from);
  const out: Conflict[] = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length && spans[j].universe === spans[i].universe && spans[j].from <= spans[i].to; j++) {
      out.push({ a: spans[i].id, b: spans[j].id, universe: spans[i].universe, from: spans[j].from, to: Math.min(spans[i].to, spans[j].to) });
    }
  }
  return out;
}

/** Each universe in use: its instruments' blocks in address order, and its used and free addresses. */
export function universeMap(list: readonly Fixture[]): UniverseInfo[] {
  const byUniverse = new Map<number, UniverseBlock[]>();
  for (const f of list) {
    if (!isPatched(f)) continue;
    const blocks = byUniverse.get(f.universe) ?? [];
    blocks.push({ start: f.address, end: f.address + spanOf(f) - 1, fixtureId: f.id, label: describeFixture(f) });
    byUniverse.set(f.universe, blocks);
  }
  return [...byUniverse.keys()]
    .sort((a, b) => a - b)
    .map((universe) => {
      const blocks = (byUniverse.get(universe) ?? []).sort((a, b) => a.start - b.start || a.end - b.end);
      const taken = new Uint8Array(UNIVERSE_SIZE + 1);
      for (const b of blocks) for (let a = b.start; a <= Math.min(b.end, UNIVERSE_SIZE); a++) taken[a] = 1;
      const used = taken.reduce((n, t) => n + t, 0);
      return { universe, blocks, used, free: UNIVERSE_SIZE - used };
    });
}
