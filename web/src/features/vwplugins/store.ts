// Where installed Vectorworks plug-ins are kept: IndexedDB ("openvwx-vwplugins"), or memory for
// this visit when the browser blocks storage. Each record is a plug-in file as it was installed
// (read again with readVwPlugin when loaded) and the Python files that came with it.

export interface InstalledFile {
  /** the plug-in's kind and name: installing one of the same kind and name replaces it */
  readonly id: string;
  /** the file's name, as installed */
  readonly file: string;
  readonly bytes: Uint8Array;
  /** the Python files that came with it, by path from its folder */
  readonly modules: Readonly<Record<string, string>>;
  readonly installed: number;
}

const DB_NAME = "openvwx-vwplugins";
const STORE = "files";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

let db: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, InstalledFile>();

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return db;
}

export async function listFiles(): Promise<InstalledFile[]> {
  const d = await open();
  if (!d) return [...memory.values()];
  return (await request(d.transaction(STORE, "readonly").objectStore(STORE).getAll())) as InstalledFile[];
}

export async function putFile(f: InstalledFile): Promise<void> {
  const d = await open();
  if (!d) memory.set(f.id, f);
  else await request(d.transaction(STORE, "readwrite").objectStore(STORE).put(f));
}

export async function removeFile(id: string): Promise<void> {
  const d = await open();
  if (!d) memory.delete(id);
  else await request(d.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
}
