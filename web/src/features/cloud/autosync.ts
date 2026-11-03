// Autosave for cloud drawings outside a live session (in one, the server asks for saves at the
// same pace): every two minutes, a drawing the user can edit that has unsaved changes is saved
// as a new version. A drawing over BIG_DRAWING is saved every fifteen minutes instead, and each
// of its autosaves replaces the one before (cloud.ts): writing one out freezes the editor for
// seconds and each copy counts against the plan's storage. File > Save always keeps a version.
// Nothing is saved while the browser is offline. Only a failure is reported, and the same
// failure is not reported twice in a row. A drawing found too large for the cloud is left alone
// after that: writing it out freezes the editor for seconds each time, to no end. File > Save
// still tries, and says why it can't. One the owner's plan has no room for is tried less often.

import { documentSource } from "../../app/ext.ts";
import { note } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { documentBytes } from "../../app/writeOut.ts";
import { ApiError } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { collab } from "../collab/engine.ts";
import { BIG_DRAWING, SAVE_BIG_EVERY_MS, SAVE_EVERY_MS } from "../../platform/protocol.ts";
import { lastSaveOf, saveCloud } from "./cloud.ts";

let busy = false;
let lastFailure = "";
/** drawings autosave has found too large for the cloud */
const tooLarge = new Set<string>();
/** drawings their owner's plan has no room for, and when to try again: writing one out and sending it is no small thing */
const noRoom = new Map<string, number>();

/** Starts the timer that autosaves the open cloud drawing. */
export function startAutosync(): void {
  window.setInterval(() => void autosyncNow(), SAVE_EVERY_MS);
}

async function autosyncNow(): Promise<void> {
  const session = store.session;
  const source = documentSource();
  if (busy || !session || !isCloudSource(source) || source.readOnly || !session.dirty || tooLarge.has(source.id)) return;
  if (navigator.onLine === false || collab() !== null) return;
  if (Date.now() < (noRoom.get(source.id) ?? 0)) return;
  const last = lastSaveOf(source.id);
  if (last && last.size > BIG_DRAWING && Date.now() - last.at < SAVE_BIG_EVERY_MS) return;
  busy = true;
  // an edit made while the copy uploads is not in it, so the drawing stays unsaved for the next round
  let edited = false;
  const stop = session.onChange(() => {
    edited = true;
  });
  try {
    const started = performance.now();
    const bytes = await documentBytes(session);
    const ms = performance.now() - started;
    if (ms > 1000) note(`autosave: writing the drawing out took ${(ms / 1000).toFixed(1)} s`);
    await saveCloud(source.id, bytes, false);
    if (!edited && store.session === session) {
      session.markSaved();
      store.emit("session", "file");
    }
    lastFailure = "";
  } catch (err) {
    const message = errorMessage(err);
    if (err instanceof ApiError && err.code === "too_large") {
      tooLarge.add(source.id);
      toast(`Autosave is off for this drawing: ${message}.`);
    } else if (message !== lastFailure) {
      toast(`Autosave failed: ${message}`);
    }
    if (err instanceof ApiError && err.code === "limit") noRoom.set(source.id, Date.now() + SAVE_BIG_EVERY_MS);
    lastFailure = message;
  } finally {
    stop();
    busy = false;
  }
}
