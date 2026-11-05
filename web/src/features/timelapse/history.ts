// A drawing's history for timelapses: the changes it went through, as the core reports them
// (SpliceOp), each with the time it was made. Pure data and functions, shared by the recorder,
// the replay and check.ts.

import type { ChangeEvent, ChangeKind, SpliceOp } from "../../core/index.ts";

/** Records [start, start + del) of a record list replaced by `add`. */
export interface HistoryRun {
  readonly start: number;
  readonly del: number;
  /** immutable record bytes, shared with the document: never copied while recording */
  readonly add: readonly Uint8Array[];
}

/** One change to a drawing's record list: records [start, start + del) are replaced by `add`, then each of `more` in turn. */
export interface HistoryOp extends HistoryRun {
  /** when it was made, ms since the epoch */
  readonly t: number;
  readonly kind: ChangeKind;
  readonly ids: readonly string[];
  /** header bytes the change set too (document settings such as units) */
  readonly header?: { readonly at: number; readonly bytes: Uint8Array };
  /**
   * the change's further runs, each at the positions the runs before it left. The core reports a
   * change as one splice from its first changed record to its last, so a class added near the top
   * of the file and an object at its end span the whole drawing; the history keeps only the runs
   * that changed.
   */
  readonly more?: readonly HistoryRun[];
}

/** splices spanning at least this many records are cut down to the runs that changed */
const RUNS_FROM = 1024;

export function historyOp(op: SpliceOp, t: number): HistoryOp {
  const header = op.header && { at: op.header.at, bytes: op.header.bytes };
  const runs = op.removed && op.del + op.add.length >= RUNS_FROM ? changedRuns(op.start, op.removed, op.add) : null;
  if (!runs?.length) return { t, start: op.start, del: op.del, add: op.add, kind: op.kind, ids: op.ids, header };
  const [first, ...more] = runs;
  return { t, ...first, kind: op.kind, ids: op.ids, header, ...(more.length ? { more } : {}) };
}

/**
 * The runs that turn `removed` (records from `start` on) into `added`, matching records by identity
 * (the editor keeps an unchanged record's bytes): each run's start is where it applies once the
 * runs before it are in. Null when they would hold no fewer records than the one splice.
 */
export function changedRuns(start: number, removed: readonly Uint8Array[], added: readonly Uint8Array[]): HistoryRun[] | null {
  /** where each added record is, built only when the two don't line up again nearby */
  let at: Map<Uint8Array, number> | null = null;
  const runs: HistoryRun[] = [];
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
function lineUp(removed: readonly Uint8Array[], added: readonly Uint8Array[], i: number, j: number): [number, number] | null {
  for (let d = 1; d <= 2 * LINE_UP; d++) {
    for (let a = Math.max(0, d - LINE_UP); a <= Math.min(d, LINE_UP); a++) {
      const r = i + a;
      const k = j + d - a;
      if (r < removed.length && k < added.length && removed[r] === added[k]) return [r, k];
    }
  }
  return null;
}

/** Each of the op's runs, in the order they apply. */
export function runsOf(op: HistoryOp): readonly HistoryRun[] {
  return op.more ? [op, ...op.more] : [op];
}

/** Applies the op to a record list in place. No spread: a run can span most of a drawing. */
export function applyOp(list: Uint8Array[], op: HistoryOp): void {
  for (const r of runsOf(op)) {
    if (r.add.length < 4096) {
      list.splice(r.start, r.del, ...r.add);
      continue;
    }
    const tail = list.slice(r.start + r.del);
    list.length = r.start;
    for (const d of r.add) list.push(d);
    for (const d of tail) list.push(d);
  }
}

/**
 * What ops[from, to) changed, for the scene's caches: the objects they named, or everything when an
 * op did not name its objects (or was not about objects). Null when there is nothing in between.
 */
export function changesOf(ops: readonly HistoryOp[], from: number, to: number): ChangeEvent | null {
  if (to <= from) return null;
  const ids = new Set<string>();
  for (let i = from; i < to; i++) {
    const op = ops[i];
    if (op.kind !== "objects" || op.ids.length === 0) return { kind: "all", ids: [] };
    for (const id of op.ids) ids.add(id);
  }
  return { kind: "objects", ids: [...ids] };
}

/** Storage an op takes, roughly: its record bytes and a fixed overhead. */
export function opBytes(op: HistoryOp): number {
  let n = 64 + (op.header?.bytes.length ?? 0);
  for (const r of runsOf(op)) for (const a of r.add) n += a.length;
  return n;
}

/**
 * The position (0 to `last`) that frame `frame` of `frames` shows: spread evenly, so the first
 * frame is at 0 and the last at `last`. With `last` steps and fewer frames than steps, every step
 * is shown in at least one frame when the steps are fewer than the frames.
 */
export function positionOf(frame: number, frames: number, last: number): number {
  if (last <= 0) return 0;
  if (frames <= 1) return last;
  return Math.round((Math.min(frame, frames - 1) * last) / (frames - 1));
}

/** SHA-256 of bytes as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}
