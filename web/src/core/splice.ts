// Splices on the record list, and how two made at the same time combine.
//
// A document is a list of records and every change replaces spans of it: one
// or more runs, each at the positions the runs before it left and after them
// (EditSession steps, cut to the records they changed). Collaborators' changes
// are put in one order by the server; a change made against an older list is
// rewritten to apply after the ones ordered before it. Changes that touch the
// same records cannot be combined: the later one is refused (its author's
// editor turns it back).
//
// Pure and dependency-free: the collaboration server imports this file as is.

/** `del` records from `start` replaced by `add` new ones. */
export interface Splice {
  readonly start: number;
  readonly del: number;
  readonly add: number;
}

/** `del` records from `start` replaced by the records `add`. */
export interface Run<T> {
  readonly start: number;
  readonly del: number;
  readonly add: readonly T[];
}

/**
 * Whether `prior` goes before `op` (moving it by its records' difference), both made against the
 * same list; null when they touch the same records. Two insertions at one index go in priority
 * order: `opFirst` puts `op`'s records before `prior`'s.
 */
function priorFirst(op: Splice, prior: Splice, opFirst: boolean): boolean | null {
  const oEnd = op.start + op.del;
  const pEnd = prior.start + prior.del;
  // overlapping spans, or an insertion strictly inside the other's span
  if (Math.max(op.start, prior.start) < Math.min(oEnd, pEnd)) return null;
  if (op.del === 0 && prior.start < op.start && op.start < pEnd) return null;
  if (prior.del === 0 && op.start < prior.start && prior.start < oEnd) return null;
  if (op.start === prior.start) {
    if (op.del === 0 && prior.del === 0) return !opFirst;
    // a pure insertion at the start of a span goes before it
    return prior.del === 0;
  }
  return prior.start < op.start;
}

/**
 * Rewrites `op` so it applies after `prior`, both having been made against the
 * same list, or null when they touch the same records. Two insertions at one
 * index go in priority order: `opFirst` puts `op`'s records before `prior`'s.
 */
export function transformSplice(op: Splice, prior: Splice, opFirst: boolean): Splice | null {
  const first = priorFirst(op, prior, opFirst);
  if (first === null) return null;
  return first ? { ...op, start: op.start + prior.add - prior.del } : op;
}

/**
 * Whether runs are in order: each starts at or after the records the one before it put in. A
 * change's runs always are; the server refuses others.
 */
export function inOrder(runs: readonly Splice[]): boolean {
  for (let i = 1; i < runs.length; i++) if (runs[i].start < runs[i - 1].start + runs[i - 1].add) return false;
  return true;
}

/** In-order runs with each start where it is in the list before any of them applies. */
function based(runs: readonly Splice[]): Splice[] {
  let net = 0;
  return runs.map((r) => {
    const b = { start: r.start - net, del: r.del, add: r.add };
    net += r.add - r.del;
    return b;
  });
}

/**
 * Rewrites the in-order runs of `op` so they apply after those of `prior`, both made against the
 * same list, or null when a run of one touches the records of a run of the other. With one run
 * each it is transformSplice.
 */
export function transformRuns(op: readonly Splice[], prior: readonly Splice[], opFirst: boolean): Splice[] | null {
  const o = based(op);
  const p = based(prior);
  const out: Splice[] = [];
  // the prior runs before the current one of op (a prefix, as both are in order) and what they add
  let k = 0;
  let shift = 0;
  let net = 0;
  for (const x of o) {
    // a prior run after x leaves every later one after it too, untouched
    for (; k < p.length; k++) {
      const first = priorFirst(x, p[k], opFirst);
      if (first === null) return null;
      if (!first) break;
      shift += p[k].add - p[k].del;
    }
    out.push({ start: x.start + shift + net, del: x.del, add: x.add });
    net += x.add - x.del;
  }
  return out;
}

/** The runs that turn a list after `runs` back into the list before them: each run's records replaced by what it removed (`removed[i]` for run i). */
export function invertRuns<T>(runs: readonly Run<T>[], removed: readonly (readonly T[])[]): Run<T>[] {
  let net = 0;
  return runs.map((r, i) => {
    const back = { start: r.start - net, del: r.add.length, add: removed[i] };
    net += r.add.length - r.del;
    return back;
  });
}

/** The list with in-order runs applied, as a new array: one pass and no spread, as a run can span most of a drawing. */
export function applyRuns<T>(list: readonly T[], runs: readonly Run<T>[]): T[] {
  const out: T[] = [];
  let at = 0;
  let net = 0;
  for (const r of runs) {
    const start = r.start - net;
    for (; at < start; at++) out.push(list[at]);
    for (const d of r.add) out.push(d);
    at = start + r.del;
    net += r.add.length - r.del;
  }
  for (; at < list.length; at++) out.push(list[at]);
  return out;
}

/**
 * The runs that turn `removed` (records from `start` on) into `added`, matching records by identity
 * (the editor keeps an unchanged record's bytes): in order, each run's start where it applies once
 * the runs before it are in. Null when they would hold no fewer records than the one splice.
 */
export function changedRuns<T>(start: number, removed: readonly T[], added: readonly T[]): Run<T>[] | null {
  /** where each added record is, built only when the two don't line up again nearby */
  let at: Map<T, number> | null = null;
  const runs: Run<T>[] = [];
  let kept = 0;
  let i = 0;
  let j = 0;
  while (i < removed.length || j < added.length) {
    if (i < removed.length && j < added.length && removed[i] === added[j]) {
      i++;
      j++;
      continue;
    }
    // where the two line up again: within a few records (most changes), else the next removed
    // record still found ahead in `added`
    let r = removed.length;
    let k = added.length;
    const near = i < removed.length && j < added.length ? lineUp(removed, added, i, j) : null;
    if (near) [r, k] = near;
    else if (i < removed.length && j < added.length) {
      if (!at) {
        at = new Map();
        for (let n = added.length - 1; n >= 0; n--) at.set(added[n], n);
      }
      for (r = i; r < removed.length; r++) {
        const found = at.get(removed[r]);
        if (found !== undefined && found >= j) {
          k = found;
          break;
        }
      }
    }
    runs.push({ start: start + j, del: r - i, add: added.slice(j, k) });
    kept += k - j;
    i = r;
    j = k;
  }
  return kept < added.length ? runs : null;
}

/** how far ahead changedRuns looks for the two lists to line up before it indexes them */
const LINE_UP = 64;

/** The nearest positions from i in `removed` and j in `added` holding the same record, if within LINE_UP of both. */
function lineUp<T>(removed: readonly T[], added: readonly T[], i: number, j: number): [number, number] | null {
  for (let d = 1; d <= 2 * LINE_UP; d++) {
    for (let a = Math.max(0, d - LINE_UP); a <= Math.min(d, LINE_UP); a++) {
      const r = i + a;
      const k = j + d - a;
      if (r < removed.length && k < added.length && removed[r] === added[k]) return [r, k];
    }
  }
  return null;
}
