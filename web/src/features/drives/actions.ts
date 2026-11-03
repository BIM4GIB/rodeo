// The drives' operations: open a drawing from Google Drive or OneDrive, and save
// the open drawing as a new copy in either. A saved copy becomes the drawing's
// save target, so File > Save writes back to the drive. One operation runs at a
// time, and a failure is shown as a message.

import { appContext, type AppContext, type DocumentSource } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { showLoading } from "../../app/loading.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { documentBytes } from "../../app/writeOut.ts";
import type { GoogleConfig, MicrosoftConfig } from "./config.ts";
import { drawingName, isDrawing } from "./names.ts";
import * as google from "./google.ts";
import * as onedrive from "./onedrive.ts";
import { chooseDrawing, chooseFolder } from "./browser.ts";

let busy = false;

/** Runs one drive operation; a second one asked for while it runs is turned away. */
async function run(job: () => Promise<void>): Promise<void> {
  if (busy) {
    toast("Finish the drive operation in progress first.", "info");
    return;
  }
  busy = true;
  try {
    await job();
  } catch (err) {
    toast(errorMessage(err));
  } finally {
    busy = false;
  }
}

function context(): AppContext {
  const c = appContext();
  if (!c) throw new Error("The editor is still starting. Try again in a moment.");
  return c;
}

function requireDrawing(): void {
  if (!store.session) throw new Error("Open a drawing first.");
}

/** The name a drawing is saved as by default: its own, with .vwx. */
function defaultName(): string {
  const base = store.fileName.replace(/\.(vwx|sta)$/i, "").trim();
  return `${base || "Drawing"}.vwx`;
}

/** Asks for the name of a new file in Google Drive; resolves with it (".vwx" added), or null. */
function askName(title: string): Promise<string | null> {
  const input = h("input", {
    cls: "menu-dialog-input drives-name",
    value: defaultName(),
    attrs: { type: "text", "aria-label": "File name", spellcheck: "false" },
  });
  return showDialog<string>({
    title,
    okLabel: "Save",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "File name" }), input)],
    check: () => {
      const named = drawingName(input.value);
      return "name" in named ? { value: named.name } : { error: named.error, focus: input };
    },
  });
}

/**
 * Saves a copy of the open drawing with `write`, then reopens the drawing from that copy so
 * File > Save writes to it. The reopen happens only when the drawing did not change while the copy
 * was written; otherwise the copy is kept, and the changes made meanwhile stay unsaved.
 */
async function saveCopy(label: string, name: string, write: (bytes: Uint8Array) => Promise<DocumentSource>): Promise<void> {
  const session = store.session;
  if (!session) throw new Error("Open a drawing first.");
  let edited = false;
  const stop = session.onStep(() => {
    edited = true;
  });
  const done = showLoading(`Saving ${name}…`);
  let bytes: Uint8Array;
  let source: DocumentSource;
  try {
    bytes = await documentBytes(session);
    source = await write(bytes);
  } finally {
    stop();
    done();
  }
  if (store.session !== session || edited) {
    toast(`Saved a copy to ${label} as ${name}. Changes made while it saved are not in that copy.`, "info");
    return;
  }
  session.markSaved();
  store.emit("session", "file");
  // the same drawing, now kept there: it stays in its tab
  await context().openDocument(bytes, name, { source, replace: true });
}

// ---- Google Drive -------------------------------------------------------------------

/** File > Open from Google Drive…: the Picker, then the drawing picked. */
export function openFromGoogle(cfg: GoogleConfig): void {
  void run(async () => {
    const file = await google.pickDrawing(cfg);
    if (!file) return;
    if (!isDrawing(file.name)) throw new Error(`${file.name} is not a Vectorworks drawing. Pick a file that ends in .vwx.`);
    const done = showLoading(`Opening ${file.name}…`);
    let bytes: Uint8Array;
    try {
      bytes = await google.download(cfg, file.id);
    } finally {
      done();
    }
    await context().openDocument(bytes, file.name, {
      source: {
        kind: "gdrive",
        label: "Google Drive",
        id: file.id,
        save: (data) => google.saveBack(cfg, file.id, data),
      },
    });
  });
}

/** File > Save to Google Drive…: a new drawing in My Drive, named by the person. */
export function saveToGoogle(cfg: GoogleConfig): void {
  void run(async () => {
    requireDrawing();
    const name = await askName("Save to Google Drive");
    if (!name) return;
    await saveCopy("Google Drive", name, async (bytes) => {
      const file = await google.createDrawing(cfg, name, bytes);
      return { kind: "gdrive", label: "Google Drive", id: file.id, save: (data) => google.saveBack(cfg, file.id, data) };
    });
  });
}

// ---- OneDrive -----------------------------------------------------------------------

/** File > Open from OneDrive…: sign in, then the browser, then the drawing picked. */
export function openFromOneDrive(cfg: MicrosoftConfig): void {
  void run(async () => {
    await onedrive.signInOneDrive(cfg.clientId);
    const item = await chooseDrawing(cfg.clientId);
    if (!item) return;
    const done = showLoading(`Opening ${item.name}…`);
    let bytes: Uint8Array;
    try {
      bytes = await onedrive.download(cfg.clientId, item.id);
    } finally {
      done();
    }
    await context().openDocument(bytes, item.name, {
      source: {
        kind: "onedrive",
        label: "OneDrive",
        id: item.id,
        save: (data) => onedrive.saveBack(cfg.clientId, item.id, data),
      },
    });
  });
}

/** File > Save to OneDrive…: sign in, pick a folder and a name, then save a copy there. */
export function saveToOneDrive(cfg: MicrosoftConfig): void {
  void run(async () => {
    requireDrawing();
    await onedrive.signInOneDrive(cfg.clientId);
    const target = await chooseFolder(cfg.clientId, defaultName());
    if (!target) return;
    const existing = await onedrive.findInFolder(cfg.clientId, target.folderId, target.name);
    if (existing && !(await confirmDialog("Replace file", `${target.name} is already in ${target.folderPath}. Replace it?`, "Replace"))) {
      return;
    }
    await saveCopy("OneDrive", target.name, async (bytes) => {
      const item = await onedrive.createIn(cfg.clientId, target.folderId, target.name, bytes);
      return { kind: "onedrive", label: "OneDrive", id: item.id, save: (data) => onedrive.saveBack(cfg.clientId, item.id, data) };
    });
  });
}
