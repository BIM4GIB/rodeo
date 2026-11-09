// The open cloud drawing's family: Main and its branches, read from the server when a cloud
// drawing opens and after its versions change, for the branch chip and the Branches menu. A read
// that answers after a newer one has started is dropped. A failed read only hides the chip, and
// is logged to the console.

import { documentSource, onDocument } from "../../app/ext.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { isVersionSource, onCloudChanged, openCloudDrawing } from "../cloud/cloud.ts";
import { branches } from "./api.ts";
import type { BranchInfo, Family } from "./wire.ts";

/** A family as read, and which of its drawings is open. */
export interface FamilyState {
  readonly family: Family;
  /** the open drawing's file id (Main's or a branch's) */
  readonly fileId: string;
  /** the open drawing's entry in the family */
  readonly current: BranchInfo;
}

let state: FamilyState | null = null;
/** counts the reads, so a late answer does not replace a newer one */
let reads = 0;
const listeners = new Set<() => void>();

/** The open drawing's family as last read; null when the open drawing is not a cloud drawing or it isn't read yet. */
export function familyState(): FamilyState | null {
  // a family read for another drawing (before the open one was read) is not the open drawing's
  const open = openCloudDrawing();
  return state && open?.id === state.fileId ? state : null;
}

/** Calls fn after the family changes (read, branch made or deleted, drawing switched). */
export function onFamily(fn: () => void): void {
  listeners.add(fn);
}

/** True when the open drawing is a branch. */
export function onBranch(): boolean {
  const s = familyState();
  return s !== null && !s.current.main;
}

/** Reads the family again (force) or returns the cached one for the open drawing. */
export async function loadFamily(force = false): Promise<FamilyState | null> {
  const open = openCloudDrawing();
  if (!open) {
    reads++;
    replace(null);
    return null;
  }
  if (!force && state?.fileId === open.id) return state;
  const mine = ++reads;
  try {
    const family = await branches.family(open.id);
    if (mine !== reads) return state;
    const current = [family.main, ...family.branches].find((b) => b.fileId === open.id);
    replace(current ? { family, fileId: open.id, current } : null);
  } catch (err) {
    console.warn("openvwx: the branches were not read", err);
    if (mine === reads) replace(null);
  }
  return state;
}

/** Sets the family and tells the listeners. */
function replace(next: FamilyState | null): void {
  state = next;
  for (const fn of [...listeners]) fn();
}

// A drawing opened from the cloud reads its family; a version of one keeps the family it had,
// since it is the same drawing. Anything else clears it.
onDocument(() => {
  if (isCloudSource(documentSource())) {
    void loadFamily(true);
  } else if (!isVersionSource(documentSource())) {
    reads++;
    replace(null);
  }
});

onCloudChanged(() => void loadFamily(true));
