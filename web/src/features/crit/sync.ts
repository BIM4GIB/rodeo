// Keeps the drawing's comments in step with the server: loaded when a cloud
// drawing opens, updated from the live session's comment events (when there
// is one), and re-read now and then without one, so a reviewer sees the others'.

import { collab, onCollab } from "../collab/engine.ts";
import { comments as api } from "../../platform/api.ts";
import type { Comment } from "../../platform/protocol.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { crit } from "./state.ts";

const POLL_MS = 30_000;

let stopLive: (() => void) | null = null;
let poll = 0;
let loads = 0;

function apply(c: Comment | { readonly id: string; readonly deleted: true }): void {
  if ("deleted" in c) {
    crit.remove(c.id);
    return;
  }
  if (c.fileId === crit.fileId) crit.upsert(c);
}

/** Listens to the live session's comments, whichever session is open (call once at start-up). */
export function initSync(): void {
  onCollab((session) => {
    stopLive?.();
    stopLive = session ? session.onComment(apply) : null;
  });
}

/** Reads the drawing's comments from the server. `quiet` keeps a failed read from a toast (for the timer). */
export async function loadComments(fileId: string, quiet = false): Promise<void> {
  const token = ++loads;
  try {
    const list = await api.list(fileId);
    if (token === loads && crit.fileId === fileId) crit.replace(list);
  } catch (err) {
    if (!quiet && token === loads) toast(`The comments could not be loaded: ${errorMessage(err)}`);
  }
}

/** While crit mode is on and there is no live session, the comments are re-read every half minute. */
export function setPolling(on: boolean): void {
  window.clearInterval(poll);
  poll = 0;
  if (!on) return;
  poll = window.setInterval(() => {
    const fileId = crit.fileId;
    if (fileId && !collab() && !document.hidden) void loadComments(fileId, true);
  }, POLL_MS);
}
