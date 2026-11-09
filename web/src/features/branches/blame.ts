// Who last changed each object, from a drawing's saved versions: a version changed an object when
// its print (units.ts prints) differs from the version before. DOM-free.

/** One saved version of a drawing, with the print of each of its objects (units.ts prints). */
export interface VersionPrints {
  readonly versionId: string;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly at: string;
  readonly label: string | null;
  readonly prints: ReadonlyMap<string, string>;
}

/** The version that last changed an object, and who made it. */
export interface BlameEntry {
  readonly id: string;
  readonly versionId: string;
  readonly authorId: string | null;
  readonly authorName: string;
  readonly at: string;
  readonly label: string | null;
  /** unchanged since the oldest version read: changed then or earlier */
  readonly orEarlier: boolean;
}

/**
 * Blame for every object of the newest state, `versions` oldest first; `complete` says the oldest is
 * the drawing's first version (so nothing is "or earlier"). `now`, when given, is the unsaved state.
 */
export function blameFrom(versions: readonly VersionPrints[], complete: boolean, now?: VersionPrints): Map<string, BlameEntry> {
  const states = now ? [...versions, now] : [...versions];
  const out = new Map<string, BlameEntry>();
  if (states.length === 0) return out;
  let prev: ReadonlyMap<string, string> | null = null;
  for (const s of states) {
    // the oldest version has no version before it, so every object in it counts as changed then
    const oldest = s === versions[0];
    for (const [id, p] of s.prints) {
      if (prev?.get(id) === p) continue;
      out.set(id, { id, versionId: s.versionId, authorId: s.authorId, authorName: s.authorName, at: s.at, label: s.label, orEarlier: oldest && !complete });
    }
    prev = s.prints;
  }
  // an object removed since its last change has no blame: only what the newest state holds
  const newest = states[states.length - 1].prints;
  for (const id of [...out.keys()]) if (!newest.has(id)) out.delete(id);
  return out;
}
