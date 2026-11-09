// Making a change of ours again on top of someone else's that came first, when the two touched the
// same records only in the drawing's name table (type 55): the table every class, symbol, texture
// and named object takes its name from. Adding a class there changes the table, so two people
// adding classes at once, or two agents' steps, would otherwise clash wherever they draw.
//
// The table is merged entry by entry, as a branch merge does (branches/merge.ts mergeNames): names
// ours added go in, one under an index theirs took meanwhile gets a fresh index (and every record of
// ours that names it is renumbered, branches/units.ts renumberNames). A class both added under one
// name is one class, theirs (ours is dropped and what ours put in it goes in theirs): two agents
// both making "Trees" share it. Another name theirs took gets a suffix. Names ours renamed or
// removed follow if theirs left them alone; both changing one entry is a real clash. Only the
// change's own records and the table are read: never the whole drawing.
// DOM-free, for the simulation in check.ts.

import { u16, u32 } from "../../core/bytes.ts";
import { readNameTable, writeNameTable } from "../../core/names.ts";
import { Rec } from "../../core/records.ts";
import { renumberNames, UNSAFE_RENUMBER_TYPES } from "../branches/units.ts";
import type { Run } from "../../core/splice.ts";

const CLASS_TYPE = 94;

/** Whether a record is the name table. */
export function isNameTable(d: Uint8Array): boolean {
  return d.length > 0x19 && d[0x19] === 55;
}

/** Whether a run puts one name table in for one taken out: the run a change of the table is cut to. */
export function isNamesRun(add: readonly Uint8Array[], removed: readonly Uint8Array[]): boolean {
  return add.length === 1 && removed.length === 1 && isNameTable(add[0]) && isNameTable(removed[0]);
}

/**
 * The runs with a change of the name table cut out as a run of its own (one record for one), so it
 * can be merged with someone else's; the others as they were. `removed[i]` is what run i took out.
 */
export function isolateNames(
  runs: readonly Run<Uint8Array>[],
  removed: readonly (readonly Uint8Array[])[],
): { runs: Run<Uint8Array>[]; removed: (readonly Uint8Array[])[] } {
  const out: Run<Uint8Array>[] = [];
  const took: (readonly Uint8Array[])[] = [];
  runs.forEach((r, i) => {
    const gone = removed[i];
    const a = gone.findIndex(isNameTable);
    const b = r.add.findIndex(isNameTable);
    if (a < 0 || b < 0 || isNamesRun(r.add, gone)) {
      out.push(r);
      took.push(gone);
      return;
    }
    // the records before the table, the table, the records after it: each its own run, in order
    const parts: [number, number, number, number][] = [
      [0, a, 0, b],
      [a, a + 1, b, b + 1],
      [a + 1, gone.length, b + 1, r.add.length],
    ];
    for (const [g0, g1, a0, a1] of parts) {
      if (g1 === g0 && a1 === a0) continue;
      out.push({ start: r.start + a0, del: g1 - g0, add: r.add.slice(a0, a1) });
      took.push(gone.slice(g0, g1));
    }
  });
  return { runs: out, removed: took };
}

/** A name table's entries. */
export function namesOf(d: Uint8Array): Map<number, string> {
  return readNameTable(new Rec(d));
}

/** A copy of a name table record holding `names`. */
export function withNames(d: Uint8Array, names: Map<number, string>): Uint8Array {
  const rec = new Rec(d.slice());
  writeNameTable(rec, names);
  return rec.data;
}

/** A merged table: what to write, the indices ours added that move (old to new), and ours' classes that theirs stands for. */
export interface MergedNames {
  readonly names: Map<number, string>;
  readonly renumber: Map<number, number>;
  readonly dropped: Set<number>;
}

/**
 * Our change of the table, `was` to `ours`, made again on `theirs` (the table as it now is). Null
 * when both changed the same entry. `fresh` hands out indices no record or table uses; `alike`
 * says whether an index ours added and one theirs holds under the same name are one class.
 */
export function mergeNames(
  was: ReadonlyMap<number, string>,
  theirs: ReadonlyMap<number, string>,
  ours: ReadonlyMap<number, string>,
  fresh: () => number,
  alike: (ours: number, theirs: number) => boolean,
): MergedNames | null {
  const names = new Map(theirs);
  const renumber = new Map<number, number>();
  const dropped = new Set<number>();
  const byName = new Map<string, number>();
  for (const [i, n] of theirs) byName.set(n, i);
  const name = (i: number, n: string): void => {
    names.set(i, n);
    byName.set(n, i);
  };
  // entries the table had: ours renamed or removed them, which stands when theirs left them alone
  for (const [i, w] of was) {
    const o = ours.get(i);
    if (o === w) continue;
    const t = theirs.get(i);
    if (t !== w) {
      if (t === o) continue;
      return null;
    }
    if (byName.get(w) === i) byName.delete(w);
    if (o === undefined) names.delete(i);
    else if (byName.has(o)) return null;
    else name(i, o);
  }
  // entries ours added: one class with theirs of its name, under a fresh index if theirs took the
  // index, with a suffix if theirs took the name for something else
  for (const [i, o] of ours) {
    if (was.has(i)) continue;
    const same = byName.get(o);
    if (same !== undefined && alike(i, same)) {
      if (same !== i) renumber.set(i, same);
      dropped.add(i);
      continue;
    }
    let label = o;
    for (let n = 2; byName.has(label); n++) label = `${o} (${n})`;
    let j = i;
    if (names.has(i)) {
      j = fresh();
      renumber.set(i, j);
    }
    name(j, label);
  }
  return { names, renumber, dropped };
}

/** Where the one class record named `index` is among a change's runs (run, place in it); null when there is none or more than one. */
export function classAt(adds: readonly (readonly Uint8Array[])[], index: number): [number, number] | null {
  let at: [number, number] | null = null;
  for (let k = 0; k < adds.length; k++) {
    for (let n = 0; n < adds[k].length; n++) {
      const d = adds[k][n];
      if (d.length < 0x24 || d[0x19] !== CLASS_TYPE || u16(d, 0x1a) !== index) continue;
      if (at) return null;
      at = [k, n];
    }
  }
  return at;
}

/** A table's entries with indices moved by `renumber`. */
export function renumbered(names: ReadonlyMap<number, string>, renumber: ReadonlyMap<number, number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [i, n] of names) out.set(renumber.get(i) ?? i, n);
  return out;
}

/** Copies of records with their name indices moved by `renumber`; null when one holds names at places Rodeo can't renumber. */
export function renumberRecords(recs: readonly Uint8Array[], renumber: ReadonlyMap<number, number>): Uint8Array[] | null {
  if (!renumber.size) return recs as Uint8Array[];
  const out: Uint8Array[] = [];
  for (const d of recs) {
    if (d.length > 0x19 && UNSAFE_RENUMBER_TYPES.has(d[0x19])) return null;
    const c = d.slice();
    renumberNames(c, renumber);
    out.push(c);
  }
  return out;
}

/** Whether the drawing has a class named `index`: a class record (type 94) with it at +0x1a. */
export function hasClass(recs: readonly Uint8Array[], index: number): boolean {
  for (const d of recs) if (d.length >= 0x24 && d[0x19] === CLASS_TYPE && u16(d, 0x1a) === index) return true;
  return false;
}

/** The highest name index records or tables use: a table's keys, every record's +0x1a, and +0x20 below 0x1000000 (as branches/units.ts reads them). */
export function topName(recs: Iterable<Uint8Array>, tables: Iterable<ReadonlyMap<number, string>>): number {
  let top = 0;
  for (const d of recs) {
    if (d.length < 0x24) continue;
    const ni = u16(d, 0x1a);
    if (ni > top) top = ni;
    const ci = u32(d, 0x20);
    if (ci < 0x1000000 && ci > top) top = ci;
  }
  for (const t of tables) for (const i of t.keys()) if (i > top) top = i;
  return top;
}
