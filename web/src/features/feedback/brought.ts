// The files the user brought in (opened or imported, ext.ts onFileIn), the latest for each
// drawing, so a bug report can carry the one it is about if the sender chooses (report.ts), and
// the check after a file comes in (check.ts) can offer to report it. A File is a handle on the
// disk's copy, so keeping one costs nothing; bytes read from elsewhere are kept as they were.

import type { EditSession } from "../../core/index.ts";
import { onFileIn } from "../../app/ext.ts";
import { store } from "../../app/state.ts";

export interface Brought {
  readonly file: Blob | Uint8Array;
  readonly name: string;
  readonly size: number;
  /** what went wrong, as the user was told; null when it came in */
  readonly error: string | null;
  /** the drawing it came into (null when it could not be read) */
  readonly session: EditSession | null;
}

const bySession = new WeakMap<EditSession, Brought>();
const listeners: ((b: Brought) => void)[] = [];

onFileIn(({ file, name, error }) => {
  const session = error ? null : store.session;
  const b: Brought = { file, name, size: file instanceof Blob ? file.size : file.length, error, session };
  if (session) bySession.set(session, b);
  for (const fn of listeners) fn(b);
});

/** Hears of each file as it comes in, or fails to. */
export function onBrought(fn: (b: Brought) => void): void {
  listeners.push(fn);
}

/** The file last brought into `session`, if any. */
export function broughtInto(session: EditSession | null): Brought | null {
  return session ? (bySession.get(session) ?? null) : null;
}

/** "DWG": a file's kind, from its name. */
export function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "file";
}

/** "2.4 MB" */
export function sizeText(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
