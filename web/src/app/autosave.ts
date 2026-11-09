// Autosave: while the drawing has changes that are not saved, a copy of it is
// kept in this browser (IndexedDB) every few minutes, once the edits pause, as
// Vectorworks keeps a backup. Starting openvwx again after a crash or a closed
// tab offers the copy back. Saving the drawing (or undoing back to the saved
// state) removes it. Drawings larger than AUTOSAVE_MAX_BYTES are not copied:
// writing one out takes as much memory again as the drawing holds.
// Edit > Preferences… (prefs.ts) turns it on or off and sets how often.

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { AUTOSAVE_MAX_BYTES, prefs } from "./prefs.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

const DB_NAME = "openvwx-autosave";
const DB_STORE = "backups";
const BACKUP_KEY = "latest";
/** how often the timer looks */
const TICK_MS = 15_000;
/** how long the edits must pause before a copy is written */
const IDLE_MS = 5_000;

interface Backup {
  name: string;
  bytes: Uint8Array;
  /** when it was written, ms since the epoch */
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is not available"));
  });
}

/** Runs one request on the backups store and closes the database. */
async function request<T>(mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = make(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

async function readBackup(): Promise<Backup | null> {
  try {
    const b = (await request("readonly", (s) => s.get(BACKUP_KEY))) as Backup | undefined;
    return b && typeof b.name === "string" && b.bytes instanceof Uint8Array ? b : null;
  } catch {
    return null;
  }
}

async function writeBackup(b: Backup): Promise<void> {
  await request("readwrite", (s) => s.put(b, BACKUP_KEY));
}

async function deleteBackup(): Promise<void> {
  try {
    await request("readwrite", (s) => s.delete(BACKUP_KEY));
  } catch {
    // nothing kept, or storage blocked
  }
}

export interface AutosaveDeps {
  openDocument(bytes: Uint8Array, name: string): Promise<void>;
}

/** Starts keeping copies of the drawing, and offers back a copy an earlier visit left. */
export function installAutosave(deps: AutosaveDeps): void {
  let session = store.session;
  let wasDirty = false;
  /** edits since the last copy */
  let pending = false;
  let lastEdit = 0;
  let lastCopy = 0;
  let writing = false;

  store.on("session", () => {
    const s = store.session;
    if (s !== session) {
      // another drawing: copies start with its first edits
      session = s;
      wasDirty = !!s?.dirty;
      pending = false;
      lastCopy = Date.now();
      return;
    }
    if (!s) return;
    if (s.dirty) {
      pending = true;
      lastEdit = Date.now();
    } else if (wasDirty) {
      // saved, or undone back to the saved state: the copy is no longer needed
      pending = false;
      void deleteBackup();
    }
    wasDirty = s.dirty;
  });

  const tick = async (): Promise<void> => {
    const p = prefs();
    const s = store.session;
    if (!p.autosave || !s?.dirty || !pending || writing) return;
    const now = Date.now();
    if (now - lastCopy < p.autosaveMinutes * 60_000 || now - lastEdit < IDLE_MS) return;
    // a big drawing isn't copied, nor one holding parts of a big one (pasted from it), which only a save can write
    if (store.fileSize > AUTOSAVE_MAX_BYTES || s.doc.holdsParts()) return;
    writing = true;
    try {
      await writeBackup({ name: store.fileName, bytes: s.doc.toBytes(), savedAt: now });
      lastCopy = now;
      pending = false;
    } catch {
      // storage full or blocked: tried again at the next interval
      lastCopy = now;
    } finally {
      writing = false;
    }
  };
  window.setInterval(() => void tick(), TICK_MS);
  // an embed (?embed) shows someone else's drawing: a copy this browser's editor left waits for the editor
  if (!new URLSearchParams(location.search).has("embed")) void offerRecovery(deps);
}

/** At start: when a copy with unsaved changes was left, offers to open it. */
async function offerRecovery(deps: AutosaveDeps): Promise<void> {
  const b = await readBackup();
  if (!b) return;
  const when = new Date(b.savedAt).toLocaleString();
  const discard = h("input", { attrs: { type: "checkbox" } });
  const open = await showDialog<true>({
    title: "Recover Drawing",
    okLabel: "Open Copy",
    body: [
      h("p", { cls: "menu-dialog-text", text: `Rodeo kept a copy of "${b.name}" with changes that were not saved (${when}).` }),
      h("p", { cls: "muted", text: "Open it, then save it to keep the changes." }),
      h("label", { cls: "menu-dialog-check" }, discard, "Delete the copy"),
    ],
    check: () => ({ value: true }),
  });
  if (open) {
    await deps.openDocument(b.bytes, b.name);
    toast(`Opened the kept copy of ${b.name}. Save it to keep its changes.`, "info");
  } else if (discard.checked) {
    await deleteBackup();
  }
}
