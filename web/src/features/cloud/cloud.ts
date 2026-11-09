// Cloud drawings in the editor: opening one from the server, saving it back as a
// new version, and the state the cloud features share (the head version each open
// cloud drawing was last opened or saved at, and whether the server offers cloud
// drawings at all). The browser, versions, sharing and autosave all build on this.

import { nextPaint } from "../../app/dom.ts";
import { appContext, documentSource, type DocumentSource } from "../../app/ext.ts";
import { showLoading, type Loading } from "../../app/loading.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { thumbnailPng } from "../../app/pngExport.ts";
import { note, reportFailure, reportSlow } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { documentBytes } from "../../app/writeOut.ts";
import { ApiError, files, serverConfig, type Progress } from "../../platform/api.ts";
import { type CloudSource, isCloudSource } from "../../platform/cloudSource.ts";
import { BIG_DRAWING, type CloudFile, type Role } from "../../platform/protocol.ts";
import { requireSignIn } from "../account/signin.ts";
import { openSupporterDialog } from "../account/supporter.ts";
import { collab, type WrittenOut } from "../collab/engine.ts";

/** A version of a cloud drawing opened to look at: read only, and it saves nowhere. */
export interface VersionSource extends DocumentSource {
  readonly kind: "version";
  /** the cloud drawing it is a version of */
  readonly id: string;
  readonly versionId: string;
  /** the signed-in user's role in that drawing; restoring and labelling need an editor's */
  readonly role: Role;
  readonly readOnly: true;
}

/** The cloud drawing the open drawing is, or is a version of. */
export interface OpenDrawing {
  readonly id: string;
  readonly role: Role;
}

/** A cloud drawing's thumbnail, at the size the browser shows it (the server takes up to 512 KB). */
const THUMB = { width: 480, height: 320 } as const;
/**
 * Above this many bytes a drawing's thumbnail is a snapshot of the 2D view, not drawn afresh: an
 * SVG of a large drawing takes seconds to build before the upload can start, and past a few
 * hundred MB it is longer than the browser's longest string.
 */
const SNAPSHOT_ABOVE = 20 * 1024 * 1024;
/** a File > Save larger than this shows its upload's progress over the drawing */
const SHOW_UPLOAD_ABOVE = 8 * 1024 * 1024;
/** a save that takes longer than this is reported (reports.ts), with what it spent the time on */
const SLOW_SAVE_MS = 30_000;

/** Megabytes to one decimal place, for progress and reports. */
function mb(bytes: number): number {
  return Math.round((bytes / 1048576) * 10) / 10;
}

/** The overlay's label and bar follow an upload: "Saving to the cloud… 45 of 230 MB". */
function showUpload(loading: Loading, label: string): Progress {
  return (sent, total) => {
    if (total <= SHOW_UPLOAD_ABOVE) return;
    loading.label(`${label}… ${Math.round(mb(sent))} of ${Math.round(mb(total))} MB`);
    loading.progress(sent / total);
  };
}

/** A failure the user expects or chose (a plan limit, a newer version, too large) isn't a fault to report. */
function isFault(err: unknown): boolean {
  if (err instanceof NotSaved) return false;
  return !(err instanceof ApiError && ["limit", "conflict", "auth", "too_large", "plan", "forbidden"].includes(err.code ?? ""));
}

/** The user chose not to overwrite a newer version. */
class NotSaved extends Error {}

/** The head version each open cloud drawing was opened at or last saved as; a save is checked against it. */
const heads = new Map<string, string>();
/** The size of each open cloud drawing when it was opened or last saved, and when that was. */
const lastSaves = new Map<string, { size: number; at: number }>();
const changedListeners = new Set<() => void>();

/** Whether the server offers cloud drawings; null until /api/config has answered. */
let offered: boolean | null = null;
void serverConfig().then((cfg) => {
  offered = cfg !== null;
});

/** True when the server offers cloud drawings (false before it has answered). */
export function cloudOffered(): boolean {
  return offered === true;
}

/** Calls `fn` after a cloud drawing's versions change: a save, a restore or a new label. */
export function onCloudChanged(fn: () => void): void {
  changedListeners.add(fn);
}

/** Tells the listeners that a cloud drawing's versions changed. */
export function cloudChanged(): void {
  for (const fn of [...changedListeners]) fn();
}

/** The head version this window holds for a cloud drawing it has opened or saved. */
export function headVersion(fileId: string): string | undefined {
  return heads.get(fileId);
}

/** The size of a cloud drawing when this window last opened or saved it, and when (Date.now()). */
export function lastSaveOf(fileId: string): { size: number; at: number } | undefined {
  return lastSaves.get(fileId);
}

/** A file name that ends in .vwx. */
export function withVwx(name: string): string {
  const trimmed = name.trim();
  return /\.vwx$/i.test(trimmed) ? trimmed : `${trimmed}.vwx`;
}

export function isVersionSource(s: DocumentSource | null): s is VersionSource {
  return !!s && s.kind === "version" && typeof s.id === "string" && typeof (s as VersionSource).versionId === "string";
}

/** The cloud drawing the open drawing is, or is a version of; null for any other drawing. */
export function openCloudDrawing(): OpenDrawing | null {
  const s = documentSource();
  if (isCloudSource(s) || isVersionSource(s)) return { id: s.id, role: s.role };
  return null;
}

export function versionSourceOf(fileId: string, versionId: string, role: Role): VersionSource {
  return { kind: "version", label: "Version", id: fileId, versionId, role, readOnly: true };
}

function sourceOf(file: Pick<CloudFile, "id" | "role">, versionId: string, collabSeq: number): CloudSource {
  return {
    kind: "cloud",
    label: "Cloud",
    id: file.id,
    versionId,
    collabSeq,
    role: file.role,
    readOnly: file.role === "viewer" || file.role === "reviewer",
    save: (bytes) => saveCloud(file.id, bytes, true),
  };
}

/** Tells the user why a cloud call failed: a plan limit offers the supporter plan, anything else is a toast. */
export async function explainFailure(action: string, err: unknown): Promise<void> {
  if (err instanceof ApiError && err.code === "limit") {
    await offerPlan(err.message);
    return;
  }
  toast(`${action} failed: ${errorMessage(err)}`);
}

/** Says a plan limit has been reached, and offers the supporter plan. */
export async function offerPlan(message: string): Promise<void> {
  const reason = message.replace(/\.?$/, ".");
  if (await confirmDialog("Plan limit reached", `${reason} Rodeo Plus keeps more drawings and versions.`, "See Rodeo Plus")) {
    openSupporterDialog();
  }
}

/**
 * Runs a cloud call behind the loading overlay. A failure is explained to the user and gives null;
 * it is explained after the overlay has gone, so a dialog it opens is not hidden behind it.
 */
export async function cloudCall<T>(label: string, action: string, run: () => Promise<T>): Promise<T | null> {
  const done = showLoading(label);
  let value: T | null = null;
  let failure: { readonly err: unknown } | null = null;
  try {
    value = await run();
  } catch (err) {
    failure = { err };
  } finally {
    done();
  }
  if (failure) {
    if (isFault(failure.err)) reportFailure("cloud", failure.err, { action });
    await explainFailure(action, failure.err);
    return null;
  }
  return value;
}

/**
 * Opens a cloud drawing at its head version. Resolves true when it is open (not when the open was
 * refused, as when unsaved changes are kept). Its head is remembered only then, so a refused open
 * cannot make a later save skip the check against a newer version. With `replace` it takes the place
 * of the drawing in front rather than a tab of its own.
 */
export async function openCloudFile(fileId: string, options?: { readonly replace?: boolean }): Promise<boolean> {
  const ctx = appContext();
  if (!ctx) return false;
  const fetched = await cloudCall("Fetching the drawing…", "Open", async () => {
    const [{ file }, content] = await Promise.all([files.get(fileId), files.content(fileId)]);
    return { file, content };
  });
  if (!fetched) return false;
  const { file, content } = fetched;
  const source = sourceOf(file, content.versionId, content.collabSeq);
  await ctx.openDocument(content.bytes, file.name, { source, replace: options?.replace });
  if (documentSource() !== source) return false;
  heads.set(file.id, content.versionId);
  lastSaves.set(file.id, { size: content.bytes.length, at: Date.now() });
  return true;
}

/** Opens a version of a cloud drawing, read only. */
export async function openCloudVersion(open: OpenDrawing, versionId: string, name: string, bytes: Uint8Array): Promise<void> {
  await appContext()?.openDocument(bytes, name, { source: versionSourceOf(open.id, versionId, open.role) });
}

/** Saves the bytes as the new head of a cloud drawing and returns that version's id. An autosave never asks, so it is sent once. */
async function putVersion(fileId: string, bytes: Uint8Array, interactive: boolean, onProgress?: Progress): Promise<string> {
  const autosave = interactive ? undefined : bytes.length > BIG_DRAWING ? "replace" : "keep";
  try {
    return (await files.save(fileId, bytes, { baseVersion: heads.get(fileId), autosave, onProgress })).version.id;
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "conflict" || !interactive) throw err;
    const anyway = await confirmDialog(
      "Newer version",
      "Someone saved a newer version. Save yours as a new version anyway?",
      "Save Anyway",
    );
    if (!anyway) throw new NotSaved("Not saved: the cloud drawing has a newer version.");
    return (await files.save(fileId, bytes, { onProgress })).version.id;
  }
}

/**
 * Captures the open drawing's thumbnail now, so the picture is of what is being saved, and draws it
 * in the background. The SVG is built before the first wait; a drawing of more than SNAPSHOT_ABOVE
 * bytes gets a snapshot of the 2D view instead.
 */
function thumbnailOf(size: number): Promise<Blob | null> {
  const ctx = appContext();
  if (!ctx) return Promise.resolve(null);
  const picture = size > SNAPSHOT_ABOVE ? viewSnapshot(ctx.canvas) : thumbnailPng(ctx.scene, THUMB.width, THUMB.height);
  return picture.catch((err: unknown) => {
    console.warn("openvwx: no thumbnail", err);
    return null;
  });
}

/** The 2D view as it is on screen, scaled down into the thumbnail's size. */
function viewSnapshot(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (canvas.width === 0 || canvas.height === 0) return Promise.resolve(null);
  const fit = Math.min(THUMB.width / canvas.width, THUMB.height / canvas.height, 1);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * fit));
  out.height = Math.max(1, Math.round(canvas.height * fit));
  const g = out.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

/** Uploads a captured thumbnail for a cloud drawing; a failure only goes to the console. */
function uploadThumbnail(fileId: string, picture: Promise<Blob | null>): void {
  picture
    .then((png) => (png ? files.putThumbnail(fileId, png) : undefined))
    .catch((err: unknown) => console.warn("openvwx: thumbnail not saved", err));
}

/** The last save queued for each drawing: saves run one after another (autosave and File > Save can overlap). */
const saves = new Map<string, Promise<void>>();

/**
 * Saves a cloud drawing as a new version: through the live session when there is one, else checked
 * against the head this window holds. `interactive` asks before overwriting a newer version (File >
 * Save); autosave passes false and fails instead. A plan limit offers the supporter plan. A save
 * waits for the ones queued before it, so each checks against the head the last one left.
 */
export function saveCloud(fileId: string, bytes: Uint8Array, interactive: boolean): Promise<void> {
  // the bytes were written out just now: this is what they hold, however long the save waits its turn
  const live = collab();
  const seq = live?.fileId === fileId ? live.heldSeq() : null;
  const run = (saves.get(fileId) ?? Promise.resolve()).then(() => saveNow(fileId, { bytes, seq }, interactive));
  saves.set(fileId, run.catch(() => undefined));
  return run;
}

async function saveNow(fileId: string, written: WrittenOut, interactive: boolean): Promise<void> {
  const { bytes } = written;
  const started = performance.now();
  const picture = thumbnailOf(bytes.length);
  const thumbMs = Math.round(performance.now() - started);
  const live = collab();
  const area = interactive ? "cloud-save" : "autosave";
  note(`${area}: ${mb(bytes.length)} MB${live?.fileId === fileId ? " through the live session" : ""}, thumbnail ${thumbMs} ms`);
  // a File > Save of a large drawing shows how far its upload has got
  const loading = interactive && bytes.length > SHOW_UPLOAD_ABOVE ? showLoading("Saving to the cloud…") : null;
  const progress = loading ? showUpload(loading, "Saving to the cloud") : undefined;
  const sending = performance.now();
  try {
    if (live?.fileId === fileId) await live.saveVersion(undefined, progress, written);
    else heads.set(fileId, await putVersion(fileId, bytes, interactive, progress));
  } catch (err) {
    loading?.();
    if (isFault(err)) reportFailure(area, err, { mb: mb(bytes.length), thumbMs, uploadMs: Math.round(performance.now() - sending) });
    if (interactive && err instanceof ApiError && err.code === "limit") await offerPlan(err.message);
    throw err;
  }
  loading?.();
  lastSaves.set(fileId, { size: bytes.length, at: Date.now() });
  const uploadMs = Math.round(performance.now() - sending);
  if (performance.now() - started > SLOW_SAVE_MS) {
    const seconds = Math.round((performance.now() - started) / 1000);
    reportSlow(area, `A ${Math.round(mb(bytes.length))} MB save took ${seconds} s`, {
      mb: mb(bytes.length),
      thumbMs,
      uploadMs,
      mbPerSecond: uploadMs > 0 ? mb((bytes.length / uploadMs) * 1000) : null,
      live: live?.fileId === fileId,
    });
  }
  uploadThumbnail(fileId, picture);
  cloudChanged();
}

/**
 * File > Save to Cloud…: saves the open drawing as a new cloud drawing, then reopens it from the
 * cloud, so File > Save writes there from then on. Changes made while it uploads are sent again
 * first, so the reopened drawing is the one that was open.
 */
export async function saveDrawingToCloud(): Promise<void> {
  const ctx = appContext();
  const session = store.session;
  if (!ctx || !session) return;
  if (!(await requireSignIn("Sign in to save drawings to the cloud."))) return;
  // writing out a large drawing takes seconds: the overlay is up first, so the wait shows
  const loading = showLoading("Getting the drawing ready…");
  await nextPaint();
  const started = performance.now();
  const first = await ctx.documentBytes();
  const bytesMs = Math.round(performance.now() - started);
  if (!first) {
    loading();
    return;
  }
  const name = withVwx(store.fileName);
  note(`save to cloud: ${mb(first.length)} MB written in ${bytesMs} ms`);

  // a change made while the copy goes up is not in it: noted here, and sent before the reopen
  let edited = false;
  const stop = session.onChange(() => {
    edited = true;
  });
  loading.label("Saving to the cloud…");
  const sending = performance.now();
  let created: CloudFile;
  try {
    created = await files.create(first, name, showUpload(loading, "Saving to the cloud"));
  } catch (err) {
    loading();
    stop();
    if (isFault(err)) reportFailure("save-to-cloud", err, { mb: mb(first.length), bytesMs, uploadMs: Math.round(performance.now() - sending) });
    await explainFailure("Save to Cloud", err);
    return;
  }
  loading();
  if (performance.now() - started > SLOW_SAVE_MS) {
    const uploadMs = Math.round(performance.now() - sending);
    reportSlow("save-to-cloud", `Saving ${Math.round(mb(first.length))} MB to the cloud took ${Math.round((performance.now() - started) / 1000)} s`, {
      mb: mb(first.length),
      bytesMs,
      uploadMs,
      mbPerSecond: uploadMs > 0 ? mb((first.length / uploadMs) * 1000) : null,
    });
  }
  // the session's own bytes, not documentBytes(): another drawing may have been opened meanwhile
  let sent = first;
  let head = created.headVersionId;
  try {
    for (let round = 0; edited && round < 3 && store.session === session; round++) {
      edited = false;
      sent = await documentBytes(session);
      head = (await files.save(created.id, sent, { baseVersion: head })).version.id;
    }
  } catch (err) {
    stop();
    if (isFault(err)) reportFailure("save-to-cloud", err, { mb: mb(sent.length), round: "changes made while it uploaded" });
    await explainFailure("Save to Cloud", err);
    return;
  }
  const stillEditing = edited;
  stop();
  if (store.session !== session) {
    toast(`Saved to the cloud as “${created.name}”.`, "info");
    return;
  }
  if (stillEditing) {
    toast(`Saved to the cloud as “${created.name}”, but the drawing is still changing, so it is not reopened from there.`, "info");
    return;
  }

  // the cloud holds what is open now, so the reopen does not ask about unsaved changes
  session.markSaved();
  const source = sourceOf(created, head, 0);
  await ctx.openDocument(sent, created.name, { source, replace: true });
  if (documentSource() !== source) return;
  heads.set(created.id, head);
  lastSaves.set(created.id, { size: sent.length, at: Date.now() });
  uploadThumbnail(created.id, thumbnailOf(sent.length));
  cloudChanged();
}
