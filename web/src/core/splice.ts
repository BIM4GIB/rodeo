// Splices on the record list, and how two made at the same time combine.
//
// A document is a list of records and every change replaces one span of it
// (EditSession steps). Collaborators' changes are put in one order by the
// server; a change made against an older list is rewritten to apply after
// the ones ordered before it. Changes that touch the same records cannot be
// combined: the later one is refused (its author's editor turns it back).
//
// Pure and dependency-free: the collaboration server imports this file as is.

/** `del` records from `start` replaced by `add` new ones. */
export interface Splice {
  readonly start: number;
  readonly del: number;
  readonly add: number;
}

/**
 * Rewrites `op` so it applies after `prior`, both having been made against the
 * same list, or null when they touch the same records. Two insertions at one
 * index go in priority order: `opFirst` puts `op`'s records before `prior`'s.
 */
export function transformSplice(op: Splice, prior: Splice, opFirst: boolean): Splice | null {
  const oEnd = op.start + op.del;
  const pEnd = prior.start + prior.del;
  // overlapping spans, or an insertion strictly inside the other's span
  if (Math.max(op.start, prior.start) < Math.min(oEnd, pEnd)) return null;
  if (op.del === 0 && prior.start < op.start && op.start < pEnd) return null;
  if (prior.del === 0 && op.start < prior.start && prior.start < oEnd) return null;
  const shift = prior.add - prior.del;
  if (op.start === prior.start) {
    if (op.del === 0 && prior.del === 0) return opFirst ? op : { ...op, start: op.start + prior.add };
    // a pure insertion at the start of a span goes before it
    if (prior.del === 0) return { ...op, start: op.start + prior.add };
    return op;
  }
  return prior.start < op.start ? { ...op, start: op.start + shift } : op;
}

/** Applies a splice to a list in place (records are whatever the list holds). */
export function applySplice<T>(list: T[], start: number, del: number, add: readonly T[]): void {
  list.splice(start, del, ...add);
}
