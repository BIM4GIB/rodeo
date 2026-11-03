// The timelapse histories in IndexedDB ("openvwx-timelapse"). Three stores:
//   histories  one record per history: its id, start hash, the saved states (ends), its op count
//              and the storage it takes;
//   starts     the opening bytes of each history, replayed from;
//   ops        the changes, keyed by [history id, position], so a range is one history.
// Every call may fail (private windows, blocked storage, full quota); callers treat that as "not
// recorded".

import { opBytes, type HistoryOp } from "./history.ts";

const DB_NAME = "openvwx-timelapse";
const DB_VERSION = 1;
/** total storage for all histories; the oldest go first */
export const STORAGE_CAP = 200 * 1024 * 1024;

/** a saved state of a history: the drawing's bytes hash, and how many ops it is after */
export interface SavedState {
  readonly hash: string;
  readonly at: number;
}

export interface HistoryMeta {
  readonly id: string;
  readonly startHash: string;
  readonly fileName: string;
  readonly created: number;
  updated: number;
  /** ops stored: positions 0 to ops - 1 */
  ops: number;
  /** saved states, by position, the latest last */
  ends: SavedState[];
  /** storage taken: the opening bytes and the ops */
  bytes: number;
}

/** an op as stored: its position and size are kept beside it */
interface StoredOp {
  readonly hid: string;
  readonly seq: number;
  readonly t: number;
  readonly start: number;
  readonly del: number;
  readonly add: Uint8Array[];
  readonly kind: HistoryOp["kind"];
  readonly ids: string[];
  readonly size: number;
  readonly header?: HistoryOp["header"];
}

const ENDS_KEPT = 20;

let dbPromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("histories", { keyPath: "id" });
      db.createObjectStore("starts", { keyPath: "id" });
      db.createObjectStore("ops", { keyPath: ["hid", "seq"] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // a database that failed to open is retried on the next call, not kept failing
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("the timelapse store transaction was aborted"));
  });
}

/** Every history's metadata. */
export async function listHistories(): Promise<HistoryMeta[]> {
  const db = await database();
  const tx = db.transaction("histories", "readonly");
  return request(tx.objectStore("histories").getAll() as IDBRequest<HistoryMeta[]>);
}

function range(id: string, from: number): IDBKeyRange {
  return IDBKeyRange.bound([id, from], [id, Infinity]);
}

/**
 * Finds where a drawing that opens with `hash` continues: the history that saved that state (the
 * newest, if several), at the position it was saved at, and the ops after that are cut away. With
 * none, a history that has never been saved and starts from these bytes starts over, or a new
 * history is made from them. Returns the history's id and the position the drawing is at.
 */
export async function openHistory(hash: string, startBytes: Uint8Array, fileName: string): Promise<{ id: string; base: number }> {
  const metas = await listHistories();
  let found: { meta: HistoryMeta; at: number } | null = null;
  for (const meta of metas) {
    for (const end of meta.ends) {
      if (end.hash === hash && (!found || meta.updated > found.meta.updated)) found = { meta, at: end.at };
    }
  }
  if (found) {
    const { meta, at } = found;
    await updateHistory(meta.id, (m) => cut(m, at));
    return { id: meta.id, base: at };
  }
  const same = metas.find((m) => m.startHash === hash && m.ends.length === 0);
  if (same) {
    await updateHistory(same.id, (m) => cut(m, 0));
    return { id: same.id, base: 0 };
  }
  const now = Date.now();
  const id = metas.some((m) => m.id === hash) ? `${hash}-${now.toString(36)}` : hash;
  const meta: HistoryMeta = { id, startHash: hash, fileName, created: now, updated: now, ops: 0, ends: [], bytes: startBytes.length };
  const db = await database();
  const tx = db.transaction(["histories", "starts"], "readwrite");
  tx.objectStore("histories").put(meta);
  tx.objectStore("starts").put({ id, bytes: startBytes });
  await finished(tx);
  return { id, base: 0 };
}

/** Cuts a history back to `at` ops: its later saved states go too. Its storage is re-counted by updateHistory. */
function cut(meta: HistoryMeta, at: number): void {
  meta.ops = Math.min(meta.ops, at);
  meta.ends = meta.ends.filter((e) => e.at <= at);
}

/**
 * Reads a history's record, applies `change` to it and writes it back, in one transaction. The
 * ops past the record's new length are deleted, and the storage they took is taken off the record.
 */
async function updateHistory(id: string, change: (meta: HistoryMeta) => void): Promise<HistoryMeta> {
  const db = await database();
  const tx = db.transaction(["histories", "ops"], "readwrite");
  const histories = tx.objectStore("histories");
  const meta = (await request(histories.get(id))) as HistoryMeta | undefined;
  if (!meta) throw new Error(`no timelapse history ${id}`);
  const before = meta.ops;
  change(meta);
  let removed = 0;
  if (meta.ops < before) {
    const cursor = tx.objectStore("ops").openCursor(range(id, meta.ops));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      removed += (c.value as StoredOp).size;
      c.delete();
      c.continue();
    };
  }
  meta.bytes = Math.max(0, meta.bytes - removed);
  meta.updated = Date.now();
  histories.put(meta);
  await finished(tx);
  return meta;
}

/** One history's record, or null. */
export async function getHistory(id: string): Promise<HistoryMeta | null> {
  const db = await database();
  const tx = db.transaction("histories", "readonly");
  return ((await request(tx.objectStore("histories").get(id))) as HistoryMeta | undefined) ?? null;
}

/** Stores ops at positions from `from` on, and counts them into the history's record. */
export async function writeOps(id: string, from: number, ops: readonly HistoryOp[]): Promise<void> {
  if (ops.length === 0) return;
  const db = await database();
  const tx = db.transaction(["histories", "ops"], "readwrite");
  const rows = tx.objectStore("ops");
  const histories = tx.objectStore("histories");
  const meta = (await request(histories.get(id))) as HistoryMeta | undefined;
  if (!meta) throw new Error(`no timelapse history ${id}`);
  let bytes = 0;
  ops.forEach((op, i) => {
    const size = opBytes(op);
    bytes += size;
    const row: StoredOp = { hid: id, seq: from + i, t: op.t, start: op.start, del: op.del, add: [...op.add], kind: op.kind, ids: [...op.ids], size, header: op.header };
    rows.put(row);
  });
  meta.ops = Math.max(meta.ops, from + ops.length);
  meta.bytes += bytes;
  meta.updated = Date.now();
  histories.put(meta);
  await finished(tx);
}

/** Records a saved state of the history (the newest kept). */
export async function addSavedState(id: string, state: SavedState): Promise<void> {
  await updateHistory(id, (meta) => {
    meta.ends = [...meta.ends.filter((e) => e.at !== state.at), state].sort((a, b) => a.at - b.at).slice(-ENDS_KEPT);
  });
}

/** A history's opening bytes and its ops from position 0 up to `upTo` (all of them when omitted). */
export async function readHistory(id: string, upTo = Infinity): Promise<{ start: Uint8Array; ops: HistoryOp[]; meta: HistoryMeta } | null> {
  const db = await database();
  const tx = db.transaction(["histories", "starts", "ops"], "readonly");
  const meta = (await request(tx.objectStore("histories").get(id))) as HistoryMeta | undefined;
  const start = (await request(tx.objectStore("starts").get(id))) as { bytes: Uint8Array } | undefined;
  if (!meta || !start) return null;
  const rows = (await request(tx.objectStore("ops").getAll(range(id, 0)))) as StoredOp[];
  const ops = rows
    .filter((r) => r.seq < upTo)
    .map((r): HistoryOp => ({ t: r.t, start: r.start, del: r.del, add: r.add, kind: r.kind, ids: r.ids, header: r.header }));
  return { start: start.bytes, ops, meta };
}

/** Deletes histories, oldest first, until all of them fit the cap; `keep` is never deleted. */
export async function evict(keep: string, cap = STORAGE_CAP): Promise<void> {
  const metas = (await listHistories()).sort((a, b) => a.updated - b.updated);
  let total = metas.reduce((n, m) => n + m.bytes, 0);
  for (const meta of metas) {
    if (total <= cap) break;
    if (meta.id === keep) continue;
    const db = await database();
    const tx = db.transaction(["histories", "starts", "ops"], "readwrite");
    tx.objectStore("histories").delete(meta.id);
    tx.objectStore("starts").delete(meta.id);
    tx.objectStore("ops").delete(range(meta.id, 0));
    await finished(tx);
    total -= meta.bytes;
  }
}
