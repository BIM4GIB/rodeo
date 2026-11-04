// Recovery storage and per-session scheduling, independent of the active drawing and UI.
import type { EditSession } from "../core/index.ts";

export interface Backup { name: string; bytes: Uint8Array; savedAt: number }
const DB = "openvwx-autosave";
const STORE = "backups";
export const RECOVERY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

async function request<T>(mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = make(tx.objectStore(STORE));
      // A request can succeed before its transaction aborts, for example at the quota limit.
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? new Error("Recovery transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Recovery transaction failed"));
    });
  } finally {
    db.close();
  }
}

export const backupKeys = (): Promise<IDBValidKey[]> => request("readonly", s => s.getAllKeys());
export async function readBackup(key: IDBValidKey): Promise<Backup | null> {
  const b = await request("readonly", s => s.get(key)) as Backup | undefined;
  return b && typeof b.name === "string" && b.bytes instanceof Uint8Array ? b : null;
}
export const writeBackup = (key: IDBValidKey, b: Backup): Promise<IDBValidKey> => request("readwrite", s => s.put(b, key));
export const deleteBackup = (key: IDBValidKey): Promise<undefined> => request("readwrite", s => s.delete(key));
const lockName = (key: IDBValidKey): string => `rodeo-recovery:${String(key)}`;

/** Active windows hold a lock per drawing, so another window won't offer or delete its backup. */
export async function withRecovery(key: IDBValidKey, use: (b: Backup, exclusive: boolean) => Promise<void>): Promise<void> {
  const read = async (exclusive: boolean): Promise<void> => {
    const b = await readBackup(key);
    if (b) await use(b, exclusive);
  };
  if (!navigator.locks) return read(false); // cleanup compares the offered snapshot atomically
  await navigator.locks.request(lockName(key), { ifAvailable: true }, async lock => { if (lock) await read(true); });
}

interface Entry {
  key: string;
  session: EditSession;
  info: () => { name: string; size: number };
  off: () => void;
  release: () => void;
  ready: Promise<void>;
  chain: Promise<unknown>;
  active: boolean;
  pending: boolean;
  wasDirty: boolean;
  writing: boolean;
  revision: number;
  lastEdit: number;
  lastCopy: number;
}

export class Recovery {
  private readonly entries = new Map<EditSession, Entry>();
  constructor(
    private readonly settings: () => { enabled: boolean; minutes: number; maxBytes: number },
    private readonly now: () => number = Date.now,
  ) {}

  track(session: EditSession, info: Entry["info"]): void {
    if (this.entries.has(session)) return;
    let release = (): void => {};
    const key = crypto.randomUUID();
    const ready = navigator.locks ? new Promise<void>((resolve, reject) => {
      const held = new Promise<void>(done => release = done);
      void navigator.locks.request(lockName(key), async () => { resolve(); await held; }).catch(reject);
    }) : Promise.resolve();
    const e: Entry = { key, session, info, ready, release, chain: Promise.resolve(), active: true, pending: session.dirty,
      wasDirty: session.dirty, writing: false, revision: 0, lastEdit: this.now(), lastCopy: this.now(), off: () => {} };
    this.entries.set(session, e);
    e.off = session.onChange(() => {
      e.revision++;
      e.pending = session.dirty;
      e.lastEdit = this.now();
      if (e.wasDirty && !session.dirty) void this.queue(e, () => deleteBackup(e.key)).catch(() => {});
      e.wasDirty = session.dirty;
    });
  }

  /** Only after a drawing is closed/replaced, including any discard confirmation. */
  async forget(session: EditSession): Promise<void> {
    const e = this.entries.get(session);
    if (!e) return;
    e.active = false;
    e.off();
    this.entries.delete(session);
    await this.queue(e, () => deleteBackup(e.key)).catch(() => {}).finally(e.release);
  }

  private queue<T>(e: Entry, job: () => Promise<T>): Promise<T> {
    const run = e.chain.then(() => e.ready).then(job);
    e.chain = run.catch(() => {});
    return run;
  }

  /** Immediate copy, also transferring an opened recovery into its new session. */
  async copy(session: EditSession): Promise<boolean> {
    const e = this.entries.get(session);
    if (!e || !e.active || !session.dirty || e.writing) return false;
    const info = e.info();
    if (info.size > this.settings().maxBytes || session.doc.holdsParts()) return false;
    e.writing = true;
    const revision = e.revision;
    const now = this.now();
    try {
      const bytes = session.doc.toBytes();
      const written = await this.queue(e, async () => {
        if (!e.active || !session.dirty) return false;
        await writeBackup(e.key, { name: info.name, bytes, savedAt: now });
        return true;
      });
      if (written && revision === e.revision) e.pending = false;
      return written;
    } catch {
      // Storage full/blocked: retain pending and retry next interval.
      return false;
    } finally {
      e.lastCopy = now;
      e.writing = false;
    }
  }

  async tick(): Promise<void> {
    const p = this.settings();
    if (!p.enabled) return;
    for (const e of this.entries.values()) {
      if (!e.writing && e.pending && this.now() - e.lastCopy >= p.minutes * 60_000 && this.now() - e.lastEdit >= 5_000) {
        // Rotate candidates so excluded or continuously edited drawings cannot starve others.
        this.entries.delete(e.session);
        this.entries.set(e.session, e);
        await this.copy(e.session);
        return;
      }
    }
  }

  async settled(): Promise<void> {
    await Promise.all([...this.entries.values()].map(e => e.chain));
  }
}

/** Compare and delete in one transaction, including on browsers without Web Locks.
 * A copy updated while its dialog was open must survive recovery or dismissal.
 */
export async function deleteBackupIfUnchanged(key: IDBValidKey, offered: Backup): Promise<void> {
  await request("readwrite", store => {
    const req = store.get(key);
    req.onsuccess = () => {
      const current = req.result as Backup | undefined;
      if (current?.savedAt === offered.savedAt && current.name === offered.name &&
          current.bytes.length === offered.bytes.length &&
          current.bytes.every((byte, i) => byte === offered.bytes[i])) store.delete(key);
    };
    return req;
  });
}

/** Active windows remain protected by their locks; old abandoned copies expire at startup. */
export async function expireBackups(now = Date.now()): Promise<void> {
  for (const key of await backupKeys()) {
    await withRecovery(key, async backup => {
      if (backup.savedAt < now - RECOVERY_MAX_AGE) await deleteBackupIfUnchanged(key, backup);
    });
  }
}
