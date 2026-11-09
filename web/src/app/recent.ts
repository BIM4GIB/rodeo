// File > Open Recent and the start hub's Recent list: the drawings opened or saved here
// lately, as Vectorworks lists them. A browser reopens a file only through the handle its file
// picker (or a drop, in browsers that hand one over) gave, so a drawing is listed once it is
// opened with Open…, dropped in such a browser, or saved with Save As. The handles are kept in
// this browser (IndexedDB), never the drawings; reopening one asks for permission to read it
// again when the browser wants that. The hub reads the same list through recentList and
// onRecentChange, and the app reads a listed drawing through openRecentEntry.

import type { Row } from "./menu.ts";
import { toast } from "./toast.ts";

const DB_NAME = "openvwx-recent";
const DB_STORE = "files";
const LIST_KEY = "list";
const MAX_RECENT = 10;

/** A drawing on the list: its name, when it was last opened or saved, and the handle that reopens it. */
export interface RecentEntry {
  readonly name: string;
  readonly handle: FileSystemFileHandle;
  /** when it was last opened or saved, ms since the epoch */
  readonly openedAt: number;
}

/** The permission calls of a file handle, which not every browser (or the DOM typings) has. */
interface PermissionHandle {
  queryPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

/** The list as last read or written; the menu is built from it, since building it cannot wait. */
let recent: RecentEntry[] = [];

/** Called whenever the list changes (see onRecentChange). */
const changeListeners: (() => void)[] = [];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB is not available"));
  });
}

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

/** Replaces the list in memory and tells the listeners. */
function setRecent(list: RecentEntry[]): void {
  recent = list;
  for (const fn of changeListeners) fn();
}

async function store(list: RecentEntry[]): Promise<void> {
  setRecent(list);
  try {
    await request("readwrite", (s) => s.put(list, LIST_KEY));
  } catch {
    // storage blocked: the list lasts for this visit only
  }
}

/** Reads the kept list, at start. */
export async function loadRecent(): Promise<void> {
  let list: RecentEntry[] = [];
  try {
    const kept = (await request("readonly", (s) => s.get(LIST_KEY))) as RecentEntry[] | undefined;
    if (Array.isArray(kept)) list = kept.filter((r) => r && typeof r.name === "string" && r.handle?.kind === "file");
  } catch {
    // no list kept: it starts empty
  }
  setRecent(list);
}

/** The list, newest first, as last read or written. */
export function recentList(): readonly RecentEntry[] {
  return recent;
}

/** Calls fn whenever the list changes: when it is read at start, when a drawing is added and when the menu is cleared. */
export function onRecentChange(fn: () => void): void {
  changeListeners.push(fn);
}

/** Puts a drawing at the top of the list (once: an earlier entry for the same file goes). */
export async function rememberRecent(handle: FileSystemFileHandle): Promise<void> {
  const others: RecentEntry[] = [];
  for (const r of recent) {
    if (!(await r.handle.isSameEntry(handle).catch(() => false))) others.push(r);
  }
  await store([{ name: handle.name, handle, openedAt: Date.now() }, ...others].slice(0, MAX_RECENT));
}

/** Reads a listed drawing, asking for permission first when the browser wants it. Null when it cannot be read. */
async function readRecent(r: RecentEntry): Promise<{ file: Blob; name: string } | null> {
  const h = r.handle as FileSystemFileHandle & PermissionHandle;
  try {
    const state = (await h.queryPermission?.({ mode: "read" })) ?? "granted";
    if (state !== "granted" && (await h.requestPermission?.({ mode: "read" })) !== "granted") {
      toast(`Rodeo was not allowed to read ${r.name}.`, "info");
      return null;
    }
    const file = await h.getFile();
    return { file, name: file.name };
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotFoundError") {
      toast(`${r.name} was moved or deleted, so it is off the list.`, "info");
      await store(recent.filter((x) => x !== r));
    } else {
      toast(`Could not open ${r.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Finds a drawing from the list (see readRecent): its file, name and handle, or null when it cannot be read. */
export async function openRecentEntry(entry: RecentEntry): Promise<{ file: Blob; name: string; handle: FileSystemFileHandle } | null> {
  const read = await readRecent(entry);
  return read ? { ...read, handle: entry.handle } : null;
}

/** The Open Recent submenu: each listed drawing, newest first, then Clear Menu. */
export function recentRows(open: (entry: RecentEntry) => void): Row[] {
  if (recent.length === 0) return [{ label: "No recent drawings", why: () => "Open or save a drawing to list it here", enabled: () => false }];
  return [
    ...recent.map((r): Row => ({ label: r.name, run: () => open(r) })),
    "-",
    { label: "Clear Menu", run: () => void store([]) },
  ];
}
