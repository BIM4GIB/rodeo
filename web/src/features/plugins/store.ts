// Where installed plug-ins are kept: IndexedDB ("openvwx-plugins"), falling back to
// localStorage, and to memory for this visit when storage is blocked. Each record
// holds the code and the origins the user let it reach. Nothing here touches the
// drawing; this is the browser's copy of the plug-ins only.

export interface PluginRecord {
  id: string;
  code: string;
  enabled: boolean;
  name: string;
  description: string;
  version: string;
  author: string;
  created: number;
  updated: number;
  /** origins the plug-in may reach (true) or may not (false); an origin not listed is asked about */
  grants: Record<string, boolean>;
}

interface Backend {
  readonly kind: "indexeddb" | "localstorage" | "memory";
  list(): Promise<PluginRecord[]>;
  put(record: PluginRecord): Promise<void>;
  remove(id: string): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
}

const DB_NAME = "openvwx-plugins";
const DB_VERSION = 1;
const LS_KEY = "openvwx-plugins";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no IndexedDB"));
      return;
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("plugins")) db.createObjectStore("plugins", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("cannot open IndexedDB"));
    open.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

function indexedBackend(db: IDBDatabase): Backend {
  const tx = (names: string | string[], mode: IDBTransactionMode): IDBTransaction => db.transaction(names, mode);
  return {
    kind: "indexeddb",
    async list() {
      return (await request(tx("plugins", "readonly").objectStore("plugins").getAll())) as PluginRecord[];
    },
    async put(record) {
      await request(tx("plugins", "readwrite").objectStore("plugins").put(record));
    },
    async remove(id) {
      await request(tx("plugins", "readwrite").objectStore("plugins").delete(id));
    },
    async getMeta(key) {
      const v = await request(tx("meta", "readonly").objectStore("meta").get(key));
      return typeof v === "string" ? v : null;
    },
    async setMeta(key, value) {
      await request(tx("meta", "readwrite").objectStore("meta").put(value, key));
    },
  };
}

interface Stored {
  plugins: PluginRecord[];
  meta: Record<string, string>;
}

/** A store in one object: the localStorage fallback and the memory fallback share it. */
function objectBackend(kind: "localstorage" | "memory", read: () => Stored, write: (b: Stored) => void): Backend {
  return {
    kind,
    async list() {
      return read().plugins;
    },
    async put(record) {
      const b = read();
      write({ ...b, plugins: [...b.plugins.filter((p) => p.id !== record.id), record] });
    },
    async remove(id) {
      const b = read();
      write({ ...b, plugins: b.plugins.filter((p) => p.id !== id) });
    },
    async getMeta(key) {
      return read().meta[key] ?? null;
    },
    async setMeta(key, value) {
      const b = read();
      write({ ...b, meta: { ...b.meta, [key]: value } });
    },
  };
}

function localBackend(): Backend | null {
  try {
    const probe = "openvwx.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
  } catch {
    return null;
  }
  const read = (): Stored => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as Partial<Stored> | null;
      return { plugins: Array.isArray(v?.plugins) ? v.plugins : [], meta: v?.meta ?? {} };
    } catch {
      return { plugins: [], meta: {} };
    }
  };
  const write = (b: Stored): void => localStorage.setItem(LS_KEY, JSON.stringify(b));
  return objectBackend("localstorage", read, write);
}

function memoryBackend(): Backend {
  let blob: Stored = { plugins: [], meta: {} };
  return objectBackend(
    "memory",
    () => blob,
    (b: Stored) => {
      blob = b;
    },
  );
}

let backend: Promise<Backend> | null = null;

function store(): Promise<Backend> {
  backend ??= openIndexedDb()
    .then((db) => indexedBackend(db))
    .catch(() => localBackend() ?? memoryBackend());
  return backend;
}

/** Which storage the plug-ins are kept in, for the Manager's footer. */
export async function storageKind(): Promise<Backend["kind"]> {
  return (await store()).kind;
}

/** Every installed plug-in, oldest first. */
export async function listPlugins(): Promise<PluginRecord[]> {
  const all = await (await store()).list();
  return all.sort((a, b) => a.created - b.created);
}

export async function savePlugin(record: PluginRecord): Promise<void> {
  await (await store()).put(record);
}

export async function deletePlugin(id: string): Promise<void> {
  await (await store()).remove(id);
}

/** A stored flag or text, or null. */
export async function getMeta(key: string): Promise<string | null> {
  return (await store()).getMeta(key);
}

export async function setMeta(key: string, value: string): Promise<void> {
  await (await store()).setMeta(key, value);
}

/** A new id for a plug-in. */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
