// A drawing's history for timelapses: the changes it went through, as the core reports them
// (SpliceOp), each with the time it was made. Pure data and functions, shared by the recorder,
// the replay and check.ts.

import type { ChangeEvent, ChangeKind, SpliceOp } from "../../core/index.ts";

/** One change to a drawing's record list: records [start, start + del) are replaced by `add`. */
export interface HistoryOp {
  /** when it was made, ms since the epoch */
  readonly t: number;
  readonly start: number;
  readonly del: number;
  /** immutable record bytes, shared with the document: never copied while recording */
  readonly add: readonly Uint8Array[];
  readonly kind: ChangeKind;
  readonly ids: readonly string[];
  /** header bytes the change set too (document settings such as units) */
  readonly header?: { readonly at: number; readonly bytes: Uint8Array };
}

export function historyOp(op: SpliceOp, t: number): HistoryOp {
  const header = op.header && { at: op.header.at, bytes: op.header.bytes };
  return { t, start: op.start, del: op.del, add: op.add, kind: op.kind, ids: op.ids, header };
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
  for (const a of op.add) n += a.length;
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
