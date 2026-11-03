// Version History palette: the versions of the open cloud drawing, newest first, with
// their time, author, size and label. A click on a version opens its menu: open it to
// look at (read only), restore it as the head, label it, or download it. The list is
// read only while the palette is on screen, and again after each change.

import type { PaletteSpec } from "../../app/dock.ts";
import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { appContext, onDocument } from "../../app/ext.ts";
import { PALETTE_ICON } from "../../app/icons.ts";
import { openContextMenu, type Row } from "../../app/menu.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { files } from "../../platform/api.ts";
import { CAN_EDIT, type Version } from "../../platform/protocol.ts";
import {
  cloudCall,
  cloudChanged,
  cloudOffered,
  headVersion,
  onCloudChanged,
  type OpenDrawing,
  openCloudDrawing,
  openCloudFile,
  openCloudVersion,
} from "./cloud.ts";
import { field, note, sizeText, timeAgo } from "./ui.ts";

export const HISTORY_PALETTE_ID = "cloud-history";

const body = h("div", { cls: "cloud-history" });
/** true while the palette is on screen: the list is read only then */
let shown = false;
/** counts the reads, so a slow one that ends late does not replace a newer list */
let reads = 0;

export const historyPalette: PaletteSpec = {
  id: HISTORY_PALETTE_ID,
  title: "Version History",
  body,
  side: "right",
  icon: PALETTE_ICON.history,
  hidden: true,
};

// the palette's body is on screen when it intersects the window (a rolled-up or hidden one does not)
new IntersectionObserver((entries) => {
  shown = entries.some((e) => e.isIntersecting);
  if (shown) void render();
}).observe(body);

onCloudChanged(() => void render());
onDocument(() => void render());

/** Reads the open drawing's versions into the palette, when it is on screen. */
export async function render(): Promise<void> {
  if (!shown) return;
  const mine = ++reads;
  const open = openCloudDrawing();
  if (!cloudOffered()) {
    body.replaceChildren(note("Cloud drawings are not offered on this site."));
    return;
  }
  if (!open) {
    body.replaceChildren(note("Save the drawing to the cloud to keep its versions."));
    return;
  }
  body.replaceChildren(note("Loading the versions…"));
  let versions: Version[];
  try {
    versions = await files.versions(open.id);
  } catch (err) {
    if (mine === reads) body.replaceChildren(note(`Could not load the versions: ${errorMessage(err)}`));
    return;
  }
  if (mine !== reads) return;
  const head = headVersion(open.id);
  body.replaceChildren(
    versions.length > 0
      ? h("ol", { cls: "ver-list" }, ...versions.map((v) => h("li", {}, versionButton(open, v, v.id === head))))
      : note("No versions yet."),
  );
}

function versionButton(open: OpenDrawing, v: Version, current: boolean): HTMLButtonElement {
  const btn = h(
    "button",
    { cls: "ver-row", attrs: { type: "button", title: new Date(v.createdAt).toLocaleString("en-GB") } },
    h("span", { cls: "ver-when", text: timeAgo(v.createdAt) }),
    h("span", { cls: "ver-who", text: `${v.authorName} · ${sizeText(v.size)}${v.autosave ? " · autosave" : ""}` }),
    current ? h("span", { cls: "ver-tag", text: "Current" }) : null,
    v.label ? h("span", { cls: "ver-label", text: v.label }) : null,
  );
  btn.addEventListener("click", () => {
    const r = btn.getBoundingClientRect();
    openContextMenu(versionRows(open, v, current), r.left, r.bottom, btn);
  });
  return btn;
}

function versionRows(open: OpenDrawing, v: Version, current: boolean): Row[] {
  const canEdit = CAN_EDIT.includes(open.role);
  return [
    { label: "Open This Version", run: () => void openVersion(open, v) },
    { label: "Restore", enabled: () => canEdit && !current, run: () => void restoreVersion(open.id, v) },
    { label: "Label…", enabled: () => canEdit, run: () => void labelVersion(open.id, v) },
    { label: "Download (.vwx)", run: () => void downloadVersion(open.id, v) },
  ];
}

async function openVersion(open: OpenDrawing, v: Version): Promise<void> {
  const name = store.fileName;
  const content = await cloudCall("Fetching the version…", "Open version", () => files.content(open.id, v.id));
  if (content) await openCloudVersion(open, v.id, name, content.bytes);
}

async function restoreVersion(fileId: string, v: Version): Promise<void> {
  const ok = await confirmDialog(
    "Restore Version",
    `Make the version saved ${timeAgo(v.createdAt)} the current one? Newer versions stay in the history.`,
    "Restore",
  );
  if (!ok) return;
  const restored = await cloudCall("Restoring…", "Restore", () => files.restore(fileId, v.id).then(() => true));
  if (!restored) return;
  // the drawing reopens at its new head (a drawing with unsaved changes asks first)
  await openCloudFile(fileId);
  cloudChanged();
}

async function labelVersion(fileId: string, v: Version): Promise<void> {
  const input = h("input", {
    cls: "menu-dialog-input cloud-wide-input",
    value: v.label ?? "",
    attrs: { type: "text", "aria-label": "Label" },
  });
  const label = await showDialog<string>({
    title: "Label Version",
    okLabel: "Save Label",
    body: [field("Label", input)],
    check: () => ({ value: input.value.trim() }),
  });
  if (label === null || label === (v.label ?? "")) return;
  const labelled = await cloudCall("Saving the label…", "Label", () => files.labelVersion(fileId, v.id, label).then(() => true));
  if (labelled) cloudChanged();
}

async function downloadVersion(fileId: string, v: Version): Promise<void> {
  const content = await cloudCall("Fetching the version…", "Download", () => files.content(fileId, v.id));
  if (!content) return;
  const base = store.fileName.replace(/\.vwx$/i, "");
  downloadBlob(`${base} ${stamp(v.createdAt)}.vwx`, new Blob([content.bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
}

/** A version's time as "2026-10-30 0310", for a download's name (no colons: they are not allowed in some file names). */
function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Opens the palette, unrolling it if need be (File > Version History). */
export function showHistory(): void {
  appContext()?.palettes.show(HISTORY_PALETTE_ID);
}
