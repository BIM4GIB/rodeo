// Hands a converted drawing from the converter page to the editor. The page stores the .vwx bytes in
// IndexedDB and opens /?convert=<id> in a new tab; the editor takes the record, deletes it and opens
// the drawing. The bytes stay on this computer, and a record nobody took is removed an hour after it
// was left, so an abandoned tab leaves nothing behind for long.

const DATABASE = "openvwx-convert";
const STORE = "handoff";
/** How long a record nobody took is kept, in milliseconds. */
const KEEP_MS = 3600_000;

/** A converted drawing waiting for the editor. */
interface Handoff {
  id: string;
  /** the .vwx file's name */
  name: string;
  /** the file it was converted from */
  source: string;
  bytes: Uint8Array;
  /** when it was left, in milliseconds since 1970 */
  at: number;
}

/** Opens the hand-off database, creating its store the first time. */
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("the browser's storage is unavailable"));
  });
}

/** Leaves a converted drawing for the editor and returns its id; records left over an hour ago are removed in the same step. */
export async function handOff(name: string, source: string, bytes: Uint8Array): Promise<string> {
  const db = await open();
  const record: Handoff = { id: crypto.randomUUID(), name, source, bytes, at: Date.now() };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const stale = record.at - KEEP_MS;
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          // the scan is done: the new record goes in last, in the same transaction
          store.put(record);
          return;
        }
        if ((c.value as Handoff).at < stale) c.delete();
        c.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("the drawing could not be stored"));
      tx.onabort = () => reject(tx.error ?? new Error("the drawing could not be stored"));
    });
  } finally {
    db.close();
  }
  return record.id;
}
