// Records how each open drawing is made. A sitting is one opening of a drawing: its opening bytes
// (the file as the editor re-serialises it) and every change to its records, from EditSession.onStep
// and from applyRemote (collaboration's changes, which onStep does not report), each with the time
// it was made. The changes are kept in memory for the sitting and written to IndexedDB (store.ts)
// as a history keyed by the opening bytes. A save (dirty goes false) hashes the saved bytes when
// the editor is idle, and records that hash as a saved state of the history; a drawing that opens
// with the bytes of a saved state continues that history from there.

import type { EditSession, SpliceOp } from "../../core/index.ts";
import { store } from "../../app/state.ts";
import { historyOp, sha256Hex, type HistoryOp } from "./history.ts";
import * as db from "./store.ts";

const MB = 1024 * 1024;
/** drawings over this are not recorded at all (their opening bytes would be too much memory) */
export const RECORD_LIMIT = 100 * MB;
/** saved bytes over this get no saved state, so the history is not continued from them */
export const SAVED_STATE_LIMIT = 60 * MB;
const FLUSH_MS = 3000;

/**
 * All database work of all sittings runs one item at a time, in the order it was asked for: a
 * drawing closed before the next one opens finishes its writes before the next one's history is
 * matched.
 */
let chain: Promise<void> = Promise.resolve();

function serial(work: () => Promise<void>): Promise<void> {
  chain = chain.then(work).catch((err: unknown) => {
    console.warn("openvwx: timelapse history not stored", err);
  });
  return chain;
}

/** One opening of a drawing, recorded. */
class Sitting {
  readonly started = Date.now();
  /** every change this sitting made, in order: ops[i] is the history's op base + i */
  readonly ops: HistoryOp[] = [];
  /** the stored history, once the opening bytes are matched to it */
  private historyId: string | null = null;
  /** the history's position of ops[0] */
  private base = 0;
  /** ops before this index are stored */
  private stored = 0;
  /** the session's dirty flag at the last session event (a save is dirty going false) */
  lastDirty = false;
  private closed = false;
  private readonly unlisten: () => void;
  private readonly restoreApply: () => void;

  constructor(
    readonly session: EditSession,
    readonly startBytes: Uint8Array,
  ) {
    this.unlisten = session.onStep((op) => this.push(op));
    const apply = session.applyRemote;
    session.applyRemote = (op: SpliceOp): void => {
      apply.call(session, op);
      this.push(op);
    };
    this.restoreApply = () => {
      session.applyRemote = apply;
    };
  }

  private push(op: SpliceOp): void {
    if (!this.closed) this.ops.push(historyOp(op, Date.now()));
  }

  /** Matches the opening bytes to a history; from then on the ops are stored as they come. */
  attach(): void {
    void serial(async () => {
      const hash = await sha256Hex(this.startBytes);
      const found = await db.openHistory(hash, this.startBytes, store.fileName);
      this.historyId = found.id;
      this.base = found.base;
      await this.store();
    });
  }

  /** Writes the ops not stored yet (call inside the serial queue). */
  private async store(): Promise<void> {
    const id = this.historyId;
    const from = this.stored;
    // ops made while the write runs are stored by the next call
    const to = this.ops.length;
    if (id === null || to <= from) return;
    await db.writeOps(id, this.base + from, this.ops.slice(from, to));
    this.stored = to;
    await db.evict(id);
  }

  /** Resolves once everything recorded so far is stored. */
  idle(): Promise<void> {
    return serial(() => this.store());
  }

  /** The editor saved. Once it is idle, the saved bytes are hashed, unless a change came after the save. */
  saved(): void {
    const at = this.ops.length;
    const whenIdle = (fn: () => void): void => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(fn, { timeout: 2000 });
      else setTimeout(fn, 0);
    };
    whenIdle(() => {
      if (this.closed || this.ops.length !== at || this.session.dirty) return;
      let bytes: Uint8Array;
      try {
        bytes = this.session.doc.toBytes();
      } catch {
        return;
      }
      if (bytes.length > SAVED_STATE_LIMIT) return;
      void sha256Hex(bytes).then((hash) =>
        serial(async () => {
          await this.store();
          if (this.historyId !== null) await db.addSavedState(this.historyId, { hash, at: this.base + at });
        }),
      );
    });
  }

  /** The stored history's record once the ops are stored (null while unknown, or when storage is unavailable). */
  async history(): Promise<db.HistoryMeta | null> {
    await this.idle();
    return this.historyId === null ? null : db.getHistory(this.historyId);
  }

  close(): Promise<void> {
    this.closed = true;
    this.unlisten();
    this.restoreApply();
    return this.idle();
  }
}

let current: Sitting | null = null;

/** The changes made to the open drawing since it was opened, and its opening bytes (null: not recorded). */
export function sessionRecording(): { readonly start: Uint8Array; readonly ops: readonly HistoryOp[]; readonly created: number } | null {
  const s = current;
  return s ? { start: s.startBytes, ops: s.ops.slice(), created: s.started } : null;
}

/**
 * The open drawing's saved history: its changes up to the last state it was saved at, from the
 * first opening that was recorded. Null when the drawing has not been saved since recording began.
 */
export async function savedRecording(): Promise<{ readonly start: Uint8Array; readonly ops: HistoryOp[]; readonly created: number } | null> {
  const meta = await current?.history();
  if (!meta || meta.ends.length === 0) return null;
  const upTo = meta.ends[meta.ends.length - 1].at;
  const stored = await db.readHistory(meta.id, upTo);
  return stored ? { start: stored.start, ops: stored.ops, created: stored.meta.created } : null;
}

/** Whether the open drawing has a saved state in its stored history. */
export async function hasSavedState(): Promise<boolean> {
  const meta = await current?.history();
  return !!meta && meta.ends.length > 0;
}

/** each open drawing's sitting, by its edit session, kept while another drawing is in front (document tabs) */
const sittings = new WeakMap<EditSession, Sitting>();

/**
 * Records the drawing in front, `session` (null: none open). The drawing left stays open in its
 * tab, so its sitting is stored and kept: it carries on when that drawing is back in front.
 */
export function attach(session: EditSession | null): void {
  const previous = current;
  current = null;
  if (previous) void previous.idle();
  if (!session) return;
  const kept = sittings.get(session);
  if (kept) {
    current = kept;
    return;
  }
  if (store.fileSize > RECORD_LIMIT) return;
  let startBytes: Uint8Array;
  try {
    startBytes = session.doc.toBytes();
  } catch {
    return;
  }
  if (startBytes.length > RECORD_LIMIT) return;
  const s = new Sitting(session, startBytes);
  s.lastDirty = session.dirty;
  sittings.set(session, s);
  current = s;
  s.attach();
}

// File > Save: the editor emits "session" after markSaved(), so dirty going false is a save
store.on("session", () => {
  const s = current;
  if (!s || store.session !== s.session) return;
  const dirty = s.session.dirty;
  if (s.lastDirty && !dirty) s.saved();
  s.lastDirty = dirty;
});

// the stored history catches up every few seconds, and when the page is left
setInterval(() => {
  void current?.idle();
}, FLUSH_MS);
window.addEventListener("pagehide", () => {
  void current?.idle();
});
