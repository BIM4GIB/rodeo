// The Agents panel's conversations, kept in this browser (IndexedDB "rodeo-agents"; for the
// visit alone where it is blocked). A conversation is its model messages, so it can go on where
// it stopped; older pictures in it are dropped when it is saved, as the agent drops them.

import { PLANNER_PICTURES, prunePictures } from "./history.ts";
import type { ChatMessage } from "./llm.ts";

export interface Thread {
  readonly id: string;
  title: string;
  readonly created: number;
  updated: number;
  messages: ChatMessage[];
  /** dollars spent on it, where the provider says */
  cost: number;
  /** the file name of the drawing it worked in, as its last message was sent */
  drawing?: string;
}

const DB = "rodeo-agents";
const STORE = "threads";
const KEEP_THREADS = 60;

let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, Thread>();

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("storage failed"));
  });
}

export function newThread(): Thread {
  const now = Date.now();
  return { id: `t${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, title: "New chat", created: now, updated: now, messages: [], cost: 0 };
}

/** Every saved conversation, the latest first. */
export async function listThreads(): Promise<Thread[]> {
  const db = await open();
  const all = db ? await run<Thread[]>(db, "readonly", (s) => s.getAll() as IDBRequest<Thread[]>).catch(() => [...memory.values()]) : [...memory.values()];
  return all.sort((a, b) => b.updated - a.updated);
}

export async function saveThread(t: Thread): Promise<void> {
  // pruned as the agent sends it, so the next message's first request reads the cache
  const slim: Thread = { ...t, messages: prunePictures(t.messages, PLANNER_PICTURES) };
  memory.set(t.id, slim);
  const db = await open();
  if (!db) return;
  await run(db, "readwrite", (s) => s.put(slim)).catch(() => {});
  const all = await listThreads();
  for (const old of all.slice(KEEP_THREADS)) await deleteThread(old.id);
}

export async function deleteThread(id: string): Promise<void> {
  memory.delete(id);
  const db = await open();
  if (db) await run(db, "readwrite", (s) => s.delete(id)).catch(() => {});
}

/** A conversation's title from its first message: its first words. */
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 46).trimEnd()}…` : t || "New chat";
}
