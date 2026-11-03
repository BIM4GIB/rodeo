// The sums behind Stage > Lighting > DMX Patch…, Spotlight's patch dialog (dmxPatchDialog.ts is the dialog).
// Each lighting device's patch problems as Vectorworks names them: an overlap (another device takes some of
// the same addresses from a different start), an identical patch (another starts at the same address with
// the same channel, which isn't always wrong), a patch conflict (the same start, a different channel), and
// out of universe (running past address 512). What each address of a universe holds for the diagnostic
// diagram, Find Next Conflict's order, Patch's run down the selected rows (the channel by the increment, the
// address by each device's footprint, the next universe when one won't fit), the devices that run lands on,
// Unpatch, and the first free addresses a device fits. Pure.

import { compareText, isPatched, spanOf, UNIVERSE_SIZE } from "./patch.ts";

export type PatchIssue = "overlap" | "identical" | "multi" | "outside";

/** The problems in the order the dialog's legend gives them, with their names. */
export const PATCH_ISSUES: readonly { readonly id: PatchIssue; readonly label: string }[] = [
  { id: "overlap", label: "Patch overlap" },
  { id: "identical", label: "Identical patch" },
  { id: "multi", label: "Patch conflict" },
  { id: "outside", label: "Out of universe" },
];

/** A row of the dialog: one device's patch. Channel is text, as the device holds it; 0 is unpatched. */
export interface PatchRow {
  readonly id: string;
  readonly channel: string;
  readonly universe: number;
  readonly address: number;
  readonly footprint: number;
}

/** What Patch and Unpatch change: the channel, the universe and address, or all three. */
export type PatchFields = "channel" | "address" | "all";

export interface PatchSettings {
  readonly fields: PatchFields;
  /** the first device's channel, and each next one's more by the increment */
  readonly channel: number;
  readonly increment: number;
  /** the first device's universe and start address */
  readonly universe: number;
  readonly address: number;
}

/** A Patch run: the selected rows with their new patch, the other devices it lands on, and those too wide to patch. */
export interface PatchRun {
  readonly rows: readonly PatchRow[];
  readonly hits: readonly string[];
  readonly left: readonly string[];
}

/** What a diagram cell shows: nothing there, one device, a problem, more than one problem. */
export type CellState = "free" | "ok" | PatchIssue | "several";

/** A universe's addresses for the diagram, from 1 (index 0 unused): each one's state and the devices on it. */
export interface UniverseCells {
  readonly universe: number;
  readonly state: readonly CellState[];
  readonly ids: readonly (readonly string[])[];
}

const lastOf = (r: PatchRow): number => r.address + spanOf(r) - 1;
const sameChannel = (a: PatchRow, b: PatchRow): boolean => a.channel.trim() === b.channel.trim();

/** What two devices sharing addresses are to each other. */
function pairIssue(a: PatchRow, b: PatchRow): PatchIssue {
  if (a.address !== b.address) return "overlap";
  return sameChannel(a, b) ? "identical" : "multi";
}

/** Each patched device's problems; a device without any isn't in the map. */
export function patchIssues(rows: readonly PatchRow[]): Map<string, Set<PatchIssue>> {
  const out = new Map<string, Set<PatchIssue>>();
  const add = (id: string, issue: PatchIssue): void => {
    const set = out.get(id) ?? new Set<PatchIssue>();
    set.add(issue);
    out.set(id, set);
  };
  const spans = rows.filter(isPatched).sort((a, b) => a.universe - b.universe || a.address - b.address);
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i];
    if (lastOf(a) > UNIVERSE_SIZE) add(a.id, "outside");
    for (let j = i + 1; j < spans.length && spans[j].universe === a.universe && spans[j].address <= lastOf(a); j++) {
      const issue = pairIssue(a, spans[j]);
      add(a.id, issue);
      add(spans[j].id, issue);
    }
  }
  return out;
}

/**
 * A universe's addresses as the diagnostic diagram colours them: free, one device, or the problem between the
 * devices sharing it ("several" when they have more than one). Addresses past 512 that a device runs into are
 * there too, out of universe.
 */
export function universeCells(rows: readonly PatchRow[], universe: number): UniverseCells {
  const here = rows.filter((r) => isPatched(r) && r.universe === universe);
  const end = Math.max(UNIVERSE_SIZE, ...here.map(lastOf));
  const ids: string[][] = Array.from({ length: end + 1 }, () => []);
  for (const r of here) for (let a = r.address; a <= lastOf(r); a++) ids[a].push(r.id);
  const byId = new Map(here.map((r) => [r.id, r] as const));
  const state = ids.map((on, a): CellState => {
    if (a === 0 || on.length === 0) return "free";
    if (a > UNIVERSE_SIZE) return "outside";
    if (on.length === 1) return "ok";
    const kinds = new Set<PatchIssue>();
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) kinds.add(pairIssue(byId.get(on[i])!, byId.get(on[j])!));
    return kinds.size > 1 ? "several" : [...kinds][0];
  });
  return { universe, state, ids };
}

/** The rows in patch order: by universe and address, unpatched ones last, then by channel. */
export function patchOrder(rows: readonly PatchRow[]): PatchRow[] {
  const key = (r: PatchRow): number => (isPatched(r) ? r.universe * (UNIVERSE_SIZE + 1) + r.address : Infinity);
  return [...rows].sort((a, b) => key(a) - key(b) || compareText(a.channel, b.channel));
}

/** Find Next Conflict: the first device with a problem after `after` in patch order, round to the start; null when none has one. */
export function nextConflict(rows: readonly PatchRow[], issues: ReadonlyMap<string, ReadonlySet<PatchIssue>>, after: string | null): string | null {
  const order = patchOrder(rows);
  const from = after === null ? -1 : order.findIndex((r) => r.id === after);
  for (let k = 1; k <= order.length; k++) {
    const r = order[(from + k + order.length) % order.length];
    if (issues.has(r.id)) return r.id;
  }
  return null;
}

/**
 * Patch: the rows `ids` names, in that order, given channels from `s.channel` up by the increment and
 * addresses from `s.universe`/`s.address` along by each footprint, a device that won't fit before 512 starting
 * the next universe. Only the fields `s.fields` names change. `hits` are the other devices whose addresses the
 * new ones land on, which the dialog asks about before unpatching them; a device wider than a universe is left.
 */
export function patchRun(all: readonly PatchRow[], ids: readonly string[], s: PatchSettings): PatchRun {
  const byId = new Map(all.map((r) => [r.id, r] as const));
  const channels = s.fields !== "address";
  const addresses = s.fields !== "channel";
  let universe = Math.max(1, Math.floor(s.universe));
  let address = Math.min(UNIVERSE_SIZE, Math.max(1, Math.floor(s.address)));
  const rows: PatchRow[] = [];
  const left: string[] = [];
  let n = 0;
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const span = spanOf(r);
    if (addresses && span > UNIVERSE_SIZE) {
      left.push(id);
      continue;
    }
    let next: PatchRow = channels ? { ...r, channel: String(Math.floor(s.channel) + n * Math.floor(s.increment)) } : r;
    if (addresses) {
      if (address + span - 1 > UNIVERSE_SIZE) {
        universe += 1;
        address = 1;
      }
      next = { ...next, universe, address };
      address += span;
    }
    rows.push(next);
    n++;
  }
  const moving = new Set(rows.map((r) => r.id));
  const hits = addresses
    ? all.filter((o) => !moving.has(o.id) && isPatched(o) && rows.some((r) => r.universe === o.universe && r.address <= lastOf(o) && o.address <= lastOf(r))).map((o) => o.id)
    : [];
  return { rows, hits, left };
}

/** Unpatch: the row without its channel, its universe and address, or all three. */
export function unpatched(r: PatchRow, fields: PatchFields): PatchRow {
  const noChannel = fields === "address" ? r : { ...r, channel: "" };
  return fields === "channel" ? noChannel : { ...noChannel, universe: 0, address: 0 };
}

/** The first addresses a footprint of `span` fits in, universe by universe from 1, the rows `skip` names left out. */
export function freeStart(rows: readonly PatchRow[], span: number, skip: ReadonlySet<string> = new Set()): { universe: number; address: number } {
  const need = Math.min(UNIVERSE_SIZE, Math.max(1, Math.round(span)));
  const patched = rows.filter((r) => isPatched(r) && !skip.has(r.id));
  const top = Math.max(0, ...patched.map((r) => r.universe));
  for (let universe = 1; universe <= top + 1; universe++) {
    const taken = new Uint8Array(UNIVERSE_SIZE + 2);
    for (const r of patched) if (r.universe === universe) for (let a = r.address; a <= Math.min(lastOf(r), UNIVERSE_SIZE); a++) taken[a] = 1;
    let run = 0;
    for (let a = 1; a <= UNIVERSE_SIZE; a++) {
      run = taken[a] ? 0 : run + 1;
      if (run === need) return { universe, address: a - need + 1 };
    }
  }
  return { universe: top + 1, address: 1 };
}

/** The channel after the highest numbered one, 1 when none is a number. */
export function nextChannel(rows: readonly PatchRow[], skip: ReadonlySet<string> = new Set()): number {
  const numbers = rows.filter((r) => !skip.has(r.id) && /^\d+$/.test(r.channel.trim())).map((r) => Number(r.channel.trim()));
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}
