// Three-way merge of two versions of a drawing that share an ancestor, unit by unit (units.ts): a
// unit only one side changed takes that side; one both changed alike is kept; one changed
// differently on both is a conflict the user settles (ours or theirs). Lists keep the order of the
// side that reordered them, with the other side's additions after their neighbours. Names added on
// both sides that clash are renumbered in the incoming records. A container one side removed, while
// the other side kept something in it, is one conflict on the container. DOM-free.

import { u16 } from "../../core/bytes.ts";
import type { BBox } from "../../core/types.ts";
import { type ChangeKind, describeUnit, unitLabel } from "./diff.ts";
import { holdsUnsafe, NAMES_KEY, type Placed, readUnits, RESOURCE_TYPES, stateOf, type UnitKind, type Units, whatOf, writeDocument } from "./units.ts";

/** The side a conflict is settled to: Main's ("ours") or the branch's ("theirs"). */
export type Choice = "ours" | "theirs";

/** A unit or name that needs the user's choice: changed on both sides, or removed on one and changed on the other. */
export interface Conflict {
  /** the unit key, or "name:<index>" for a name renamed differently on both sides */
  readonly key: string;
  readonly what: UnitKind | "name";
  /** plain words for it (unitLabel), e.g. 'Rectangle on Ground Floor' or 'Name "Doors"' */
  readonly label: string;
  /** what each side did since the ancestor */
  readonly ours: ChangeKind;
  readonly theirs: ChangeKind;
  /** objects: the layer, and bounds (ours' when it has them, else theirs') */
  readonly layerId: string | null;
  readonly bounds: BBox | null;
}

/** The outcome of a merge. */
export interface MergeResult {
  /** the merged drawing; null while a conflict has no choice in `choices` */
  readonly bytes: Uint8Array | null;
  readonly conflicts: readonly Conflict[];
  /** things merged without asking that the user should know of, in plain sentences */
  readonly notes: readonly string[];
  /** units taken from theirs (changed or added there), units removed because theirs removed them */
  readonly taken: number;
  readonly removed: number;
}

/** What a unit becomes: Main's version, the branch's version, or nothing. */
type Decision = "ours" | "theirs" | "gone";

/** Merges `theirs` into `ours`, both descended from `base`. */
export function mergeDocuments(base: Uint8Array, ours: Uint8Array, theirs: Uint8Array, choices?: ReadonlyMap<string, Choice>): MergeResult {
  return mergeUnits(readUnits(base), readUnits(ours), readUnits(theirs), choices);
}

/** mergeDocuments on drawings already split into units (the editor reuses them across retries). */
export function mergeUnits(B: Units, O: Units, T: Units, choices: ReadonlyMap<string, Choice> = new Map()): MergeResult {
  const notes: string[] = [];
  const conflicts: Conflict[] = [];
  const conflictAt = new Map<string, Conflict>();
  const addConflict = (c: Conflict): void => {
    conflicts.push(c);
    conflictAt.set(c.key, c);
  };

  // 1. names: entry by entry, with the renumbering the incoming records need
  const { names, renumber, nameConflicts } = mergeNames(B, O, T, choices);
  for (const c of nameConflicts) addConflict(c);

  // 2. each unit's decision, from its state in the three drawings
  const keys = unitKeys(O, T, B);
  const decision = new Map<string, Decision>();
  // the name table is never compared as bytes; it is written from Main's record, or the branch's
  if (O.units.has(NAMES_KEY)) decision.set(NAMES_KEY, "ours");
  else if (T.units.has(NAMES_KEY)) decision.set(NAMES_KEY, "theirs");

  for (const k of keys) {
    const sb = stateOf(B, k);
    const so = stateOf(O, k);
    const st = stateOf(T, k);
    if (so === st || st === sb) {
      decision.set(k, so === "-" ? "gone" : "ours");
    } else if (so === sb) {
      decision.set(k, st === "-" ? "gone" : "theirs");
    } else if (so !== "-" && st !== "-" && (whatOf(O, k) === "settings" || O.units.get(k)?.split)) {
      // document settings and shells (layer settings, class list, library) changed on both: Main's stands
      decision.set(k, "ours");
      notes.push(`${unitLabel(describeUnit(O, k, "changed"))} changed on both sides: kept Main's.`);
    } else {
      // one side removed the unit and the other changed it. If the side removed the container it sat
      // in too, the container's conflict (step 3) covers this unit, so it is kept from the other side
      const lacking = so === "-" ? O : st === "-" ? T : null;
      const container = B.units.get(k)?.parent ?? "";
      if (lacking && container !== "" && !lacking.units.has(container)) {
        decision.set(k, so === "-" ? "theirs" : "ours");
        continue;
      }
      addConflict(conflictOf(k, O.units.has(k) ? O : T, kindOf(sb, so), kindOf(sb, st)));
      const pick = choices.get(k) ?? "ours";
      decision.set(k, pick === "theirs" ? (st === "-" ? "gone" : "theirs") : so === "-" ? "gone" : "ours");
    }
  }

  // The unit a decision keeps sits in its container on the side it was taken from; a gone unit sits
  // where the drawing that still has it puts it.
  const parentOf = (k: string): string => {
    const d = decision.get(k);
    const u = d === "theirs" ? T.units.get(k) : d === "ours" ? O.units.get(k) : (O.units.get(k) ?? T.units.get(k) ?? B.units.get(k));
    return u?.parent ?? "";
  };

  // 3. a container one side removed, with units the other side kept inside it, is one conflict on the
  //    container (the highest such one). Keeping it keeps those units; removing it removes them.
  const under = new Map<string, string[]>();
  for (const k of keys) {
    if (decision.get(k) === "gone") continue;
    let top = "";
    for (let p = parentOf(k); p !== ""; p = parentOf(p)) if (decision.get(p) === "gone") top = p;
    if (top !== "") {
      const list = under.get(top);
      if (list) list.push(k);
      else under.set(top, [k]);
    }
  }
  for (const [top, kids] of under) {
    const hasO = O.units.has(top);
    if (!conflictAt.has(top)) addConflict(conflictOf(top, hasO ? O : T, hasO ? "changed" : "removed", T.units.has(top) ? "changed" : "removed"));
    // undecided: keep it for now, as the step-2 choice does
    const keep: Decision = hasO ? "ours" : "theirs";
    if (choices.get(top) === keep || !choices.has(top)) decision.set(top, keep);
    else for (const k of kids) decision.set(k, "gone");
  }

  // 3b. a container kept from one side, which the other side lacks, takes that side's contents: the
  //     ones the other side removed along with it come back. Conflicts keep their own choice.
  const revive = (parent: string, from: Units, side: "ours" | "theirs"): void => {
    for (const c of from.lists.get(parent) ?? []) {
      if (decision.get(c) === "gone" && !conflictAt.has(c)) decision.set(c, side);
      if (decision.get(c) === side && from.units.get(c)?.split) revive(c, from, side);
    }
  };
  for (const k of keys) {
    const d = decision.get(k);
    if (d !== "ours" && d !== "theirs") continue;
    const from = d === "theirs" ? T : O;
    const other = d === "theirs" ? O : T;
    if (from.units.get(k)?.split && !other.units.has(k)) revive(k, from, d);
  }

  // 4. a resource both sides added under the same name: Main's stands
  const oResources = new Map<string, string>();
  for (const [j, x] of O.units) {
    if (decision.get(j) === "ours" && RESOURCE_TYPES.has(x.type)) oResources.set(`${x.parent}|${x.type}|${nameIndexOf(O, j)}`, j);
  }
  for (const k of keys) {
    const u = T.units.get(k);
    if (decision.get(k) !== "theirs" || B.units.has(k) || O.units.has(k) || !u || !RESOURCE_TYPES.has(u.type)) continue;
    let ni = nameIndexOf(T, k);
    ni = renumber.get(ni) ?? ni;
    if (ni !== 0 && oResources.has(`${u.parent}|${u.type}|${ni}`)) {
      decision.set(k, "gone");
      notes.push(`${unitLabel(describeUnit(T, k, "added"))} was added on both sides: kept Main's.`);
    }
  }

  // 5. renumbering Rodeo can't do safely yet: what the branch holds of those types is not carried over
  if (renumber.size > 0) {
    for (const k of keys) {
      if (decision.get(k) !== "theirs" || !holdsUnsafe(T, k)) continue;
      decision.set(k, O.units.has(k) ? "ours" : "gone");
      notes.push(`${unitLabel(describeUnit(T, k, "changed"))} wasn't carried over: both sides added names it uses. Redo it after merging.`);
    }
  }
  // a unit whose container is gone is gone too (step 5 can remove a container)
  for (let changed = true; changed; ) {
    changed = false;
    for (const k of keys) {
      const d = decision.get(k);
      if ((d === "ours" || d === "theirs") && decision.get(parentOf(k)) === "gone") {
        decision.set(k, "gone");
        changed = true;
      }
    }
  }

  /** The units of list L, merged: the order of whichever side reordered what all three hold, with the other side's additions after their neighbours. */
  const mergeList = (L: string): Placed[] => {
    const bL = B.lists.get(L) ?? [];
    const oL = O.lists.get(L) ?? [];
    const tL = T.lists.get(L) ?? [];
    const keep = (k: string): boolean => {
      const d = decision.get(k);
      if (d !== "ours" && d !== "theirs") return false;
      return (d === "theirs" ? T : O).units.get(k)?.parent === L;
    };
    const fromOf = (k: string): Units => (decision.get(k) === "theirs" ? T : O);
    const bSet = new Set(bL);
    const oSet = new Set(oL);
    const tSet = new Set(tL);
    const inAll = (k: string): boolean => bSet.has(k) && oSet.has(k) && tSet.has(k);
    // the side that reordered what all three hold sets the order
    const oursKeptOrder = sameArray(bL.filter(inAll), oL.filter(inAll));
    const primary = oursKeptOrder ? tL : oL;
    const secondary = oursKeptOrder ? oL : tL;
    const inPrimary = new Set(primary.filter(keep));
    // additions from the secondary side go after the kept unit they followed ("" = the start)
    const after = new Map<string, string[]>();
    let anchor = "";
    for (const k of secondary) {
      if (inPrimary.has(k)) {
        anchor = k;
        continue;
      }
      if (!keep(k)) continue;
      const list = after.get(anchor);
      if (list) list.push(k);
      else after.set(anchor, [k]);
    }
    const order: string[] = [...(after.get("") ?? [])];
    for (const k of primary) {
      if (!keep(k)) continue;
      order.push(k, ...(after.get(k) ?? []));
    }
    return order.map((key) => ({ key, from: fromOf(key) }));
  };

  // 6. the lists: the top level, then every split container kept
  const listKeys = [""];
  for (const k of keys) {
    const d = decision.get(k);
    if ((d === "ours" || d === "theirs") && (d === "theirs" ? T : O).units.get(k)?.split) listKeys.push(k);
  }
  const lists = new Map<string, Placed[]>();
  for (const L of listKeys) lists.set(L, mergeList(L));

  // 7. the result
  const undecided = conflicts.some((c) => !choices.has(c.key));
  let taken = 0;
  let removed = 0;
  for (const k of keys) {
    const d = decision.get(k);
    if (d === "theirs" && stateOf(O, k) !== stateOf(T, k)) taken++;
    else if (d === "gone" && O.units.has(k)) removed++;
  }
  const bytes = undecided ? null : writeDocument({ home: O, lists, names, renumber });
  return { bytes, conflicts, notes, taken, removed };
}

/** The unit keys of the three drawings, Main's first, then the branch's, then the base's, each once. The name table is left out. */
function unitKeys(O: Units, T: Units, B: Units): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const u of [O, T, B]) {
    for (const k of u.units.keys()) {
      if (k === NAMES_KEY || seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

/** How a unit changed from the base: added when the base lacks it, removed when this side does, changed otherwise. */
function kindOf(sb: string, s: string): ChangeKind {
  return sb === "-" ? "added" : s === "-" ? "removed" : "changed";
}

/** A conflict on a unit, described from the drawing that holds it (Main's when both do). */
function conflictOf(key: string, side: Units, ours: ChangeKind, theirs: ChangeKind): Conflict {
  const item = describeUnit(side, key, "changed");
  return { key, what: item.what, label: unitLabel(item), ours, theirs, layerId: item.layerId, bounds: item.bounds };
}

/** A unit's name index: the u16 at +0x1a of its root record, 0 when unnamed. */
function nameIndexOf(u: Units, key: string): number {
  const x = u.units.get(key);
  if (!x) throw new Error(`unit ${key} is missing`);
  return u16(u.recs[x.start].data, 0x1a);
}

/** True when two lists hold the same keys in the same order. */
function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The name table merged entry by entry. A name added on both sides that clashes is given a fresh
 * index for the branch's record (renumber). A name renamed differently on both sides is a conflict.
 */
function mergeNames(B: Units, O: Units, T: Units, choices: ReadonlyMap<string, Choice>): { names: Map<number, string>; renumber: Map<number, number>; nameConflicts: Conflict[] } {
  const names = new Map(O.names);
  const renumber = new Map<number, number>();
  const nameConflicts: Conflict[] = [];
  const byName = new Map<string, number>();
  for (const [i, n] of names) byName.set(n, i);
  // above every index any of the three drawings uses, so a fresh one clashes with nothing
  let next = Math.max(B.topName, O.topName, T.topName) + 1;
  const rename = (i: number, t: string): void => {
    const old = names.get(i);
    if (old !== undefined && byName.get(old) === i) byName.delete(old);
    names.set(i, t);
    byName.set(t, i);
  };
  // which unit names each index, built only when a name clashes
  const namers = new Map<Units, Map<number, string>>();
  const namedBy = (U: Units, i: number): string | undefined => {
    let m = namers.get(U);
    if (!m) {
      m = new Map<number, string>();
      for (const k of U.units.keys()) {
        if (k === NAMES_KEY) continue;
        const ni = nameIndexOf(U, k);
        if (ni !== 0) m.set(ni, k);
      }
      namers.set(U, m);
    }
    return m.get(i);
  };

  for (const [i, t] of T.names) {
    const b = B.names.get(i);
    const o = O.names.get(i);
    if (b !== undefined) {
      // theirs did not rename it, both did alike, or ours removed it
      if (t === b || o === t || o === undefined) continue;
      if (o === b) {
        rename(i, t);
        continue;
      }
      nameConflicts.push({ key: `name:${i}`, what: "name", label: `Name "${b}"`, ours: "changed", theirs: "changed", layerId: null, bounds: null });
      if (choices.get(`name:${i}`) === "theirs") rename(i, t);
      continue;
    }
    // added on theirs. Both sides naming the same index is one entry only when it is one unit (or a
    // resource, one by name): two objects can't share a name, so the branch's gets a suffix below.
    const onlyResources = [...(T.nameTypes.get(i) ?? [])].every((type) => RESOURCE_TYPES.has(type));
    if (o !== undefined && o !== t) {
      const owner = namedBy(O, i);
      if (owner !== undefined && owner === namedBy(T, i)) {
        // one object given two names on the two sides: a conflict on its name
        nameConflicts.push({ ...conflictOf(owner, O, "added", "added"), key: `name:${i}`, what: "name" });
        if (choices.get(`name:${i}`) === "theirs") rename(i, t);
        continue;
      }
    } else if (o === t) {
      const ownerT = namedBy(T, i);
      const ownerO = namedBy(O, i);
      if (onlyResources || ownerO === undefined || ownerT === undefined || ownerO === ownerT) continue;
    }
    const j = byName.get(t);
    if (j !== undefined && onlyResources) {
      if (j !== i) renumber.set(i, j);
      continue;
    }
    // Main already names something else this; an object name must stay unique, so the branch's gets a suffix
    let label = t;
    if (j !== undefined) {
      let n = 2;
      while (byName.has(`${t} (${n})`)) n++;
      label = `${t} (${n})`;
    }
    if (!O.used.has(i) && label === t) {
      rename(i, t);
      continue;
    }
    const n = next++;
    names.set(n, label);
    byName.set(label, n);
    renumber.set(i, n);
  }
  // names theirs removed are kept: something kept may still use them, and an unused entry is harmless
  return { names, renumber, nameConflicts };
}
