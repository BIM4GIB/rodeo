// File > Publish…: Vectorworks' batch export of sheets, layers and saved views. Pick the layers
// (sheets first) and any saved views, and a format: one PDF with a page per layer and view, or a
// PDF per layer and view, or an SVG or DXF file per layer. A view's page shows what opening it
// would: its layers and classes, cropped to its area. Several files go into a folder chosen once
// (where the browser can write to one), else download in turn.
// Publishing sets keep a choice of layers and options under a name, per drawing, in this browser.

import { withHeldImages } from "../core/index.ts";
import type { LayerInfo, VwxDocument } from "../core/types.ts";
import { exportDxf } from "../export/dxf.ts";
import { exportPdf, PAPER_SIZES, type PdfOptions, type PdfView } from "../export/pdf.ts";
import { exportSvg } from "../export/svg.ts";
import { h } from "./dom.ts";
import { layerLabel, layerMeta, listOrder } from "./exportDialog.ts";
import { downloadBlob } from "./fileio.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { errorMessage, toast } from "./toast.ts";

const STORAGE_KEY = "openvwx.publish.v1";

export type PublishFormat = "pdf" | "pdf-each" | "svg-each" | "dxf-each";

const FORMATS: readonly { readonly id: PublishFormat; readonly label: string }[] = [
  { id: "pdf", label: "PDF, one file (a page per layer or view)" },
  { id: "pdf-each", label: "PDF, a file per layer or view" },
  { id: "svg-each", label: "SVG, a file per layer" },
  { id: "dxf-each", label: "DXF, a file per layer" },
];

export interface PublishOptions {
  layerIds: string[];
  /** saved views by name, each a page after the layers' (PDF only) */
  views: string[];
  format: PublishFormat;
  /** a paper size's name from PAPER_SIZES, "" for each layer's own size (PDF only) */
  paper: string;
  /** draw objects of hidden classes too (PDF only) */
  hiddenClasses: boolean;
}

/** A publishing set: options kept under a name. */
interface PublishSet extends PublishOptions {
  name: string;
}

export interface PublishedFile {
  name: string;
  blob: Blob;
}

/** A name a file system accepts. */
function safe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Layer";
}

/** A saved view as Publish draws it. */
export interface PublishView {
  readonly name: string;
  readonly view: PdfView;
}

/** The files a publish makes, in layer order, then the views' (`views`: the drawing's saved views, of which `o` names some). */
export function publishFiles(doc: VwxDocument, base: string, o: PublishOptions, views: readonly PublishView[] = []): PublishedFile[] {
  const layers = doc.layers();
  const picked = o.layerIds.map((id) => layers.find((l) => l.id === id)).filter((l): l is LayerInfo => l !== undefined);
  const pdfFormat = o.format === "pdf" || o.format === "pdf-each";
  const pickedViews = pdfFormat ? o.views.map((n) => views.find((v) => v.name === n)).filter((v): v is PublishView => v !== undefined) : [];
  const size = PAPER_SIZES.find((p) => p.name === o.paper);
  const pdf = (layerIds: string[], shown: readonly PublishView[]): Blob => {
    const opts: PdfOptions = {
      layerIds,
      includeHiddenClasses: o.hiddenClasses,
      pageSize: size ? { width: size.width, height: size.height } : undefined,
      views: shown.map((v) => v.view),
    };
    return new Blob([new Uint8Array(exportPdf(doc, opts))], { type: "application/pdf" });
  };
  if (o.format === "pdf") return picked.length || pickedViews.length ? [{ name: `${safe(base)}.pdf`, blob: pdf(picked.map((l) => l.id), pickedViews) }] : [];
  const taken = new Set<string>();
  const stemOf = (name: string): string => {
    let stem = safe(`${base} ${name}`);
    for (let n = 2; taken.has(stem.toLowerCase()); n++) stem = `${stem} ${n}`;
    taken.add(stem.toLowerCase());
    return stem;
  };
  return [
    ...picked.map((layer) => {
      const ext = o.format === "pdf-each" ? "pdf" : o.format === "svg-each" ? "svg" : "dxf";
      const stem = stemOf(layer.title ? `${layer.name} ${layer.title}` : layer.name);
      const blob =
        o.format === "pdf-each"
          ? pdf([layer.id], [])
          : o.format === "svg-each"
            ? new Blob([exportSvg(doc, [layer.id])], { type: "image/svg+xml" })
            : new Blob([exportDxf(doc, { layerIds: [layer.id] })], { type: "application/dxf" });
      return { name: `${stem}.${ext}`, blob };
    }),
    ...pickedViews.map((v) => ({ name: `${stemOf(v.name)}.pdf`, blob: pdf([], [v]) })),
  ];
}

// ---- publishing sets ----------------------------------------------------------

function loadSets(): Record<string, PublishSet[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, PublishSet[]>) : {};
  } catch {
    return {};
  }
}

function setsOf(file: string): PublishSet[] {
  const list = loadSets()[file];
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.name === "string" && Array.isArray(s.layerIds) && FORMATS.some((f) => f.id === s.format))
    .map((s) => ({ ...s, views: Array.isArray(s.views) ? s.views.filter((n) => typeof n === "string") : [] }));
}

function storeSets(file: string, sets: PublishSet[]): void {
  const all = loadSets();
  if (sets.length) all[file] = sets;
  else delete all[file];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the sets last for this visit only
  }
}

// ---- writing ------------------------------------------------------------------

interface DirectoryPicker {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}

/** Writes the files into a folder the user picks; false when the browser can't or the user cancelled. */
async function writeToFolder(files: readonly PublishedFile[]): Promise<boolean | null> {
  const pick = (window as unknown as DirectoryPicker).showDirectoryPicker?.bind(window);
  if (!pick) return false;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await pick({ id: "openvwx-publish", mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
  const existing: string[] = [];
  for (const f of files) {
    try {
      await dir.getFileHandle(f.name);
      existing.push(f.name);
    } catch {
      // not there yet
    }
  }
  if (existing.length) {
    const what = existing.length === 1 ? `"${existing[0]}" is` : `${existing.length} of the files are`;
    if (!(await confirmDialog("Publish", `${what} already in that folder. Replace?`, "Replace"))) return null;
  }
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const out = await handle.createWritable();
    await out.write(f.blob);
    await out.close();
  }
  return true;
}

/** Puts the files where the user wants them: one downloads, several go into a folder or download in turn. */
async function deliver(files: readonly PublishedFile[]): Promise<void> {
  if (files.length === 1) {
    downloadBlob(files[0].name, files[0].blob);
    return;
  }
  const written = await writeToFolder(files);
  if (written === null) return;
  if (written) {
    toast(`Published ${files.length} files.`, "info");
    return;
  }
  for (const f of files) downloadBlob(f.name, f.blob);
}

// ---- dialog -------------------------------------------------------------------

/** File > Publish…: asks for the layers, saved views (`views`), format and options, then writes the files. */
export async function publishDialog(doc: VwxDocument, fileName: string, base: string, activeLayerId: string | null, views: readonly PublishView[] = []): Promise<void> {
  const layers = listOrder(doc.layers());
  let sets = setsOf(fileName);
  const boxes = new Map<string, HTMLInputElement>();
  const count = h("span", { cls: "export-count" });
  const updateCount = (): void => {
    count.textContent = `${layers.filter((l) => boxes.get(l.id)?.checked).length} of ${layers.length} selected`;
  };
  const rows = layers.map((layer) => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: layer.kind === "sheet" || (!layers.some((l) => l.kind === "sheet") && layer.id === activeLayerId) });
    boxes.set(layer.id, box);
    box.addEventListener("change", updateCount);
    return h(
      "label",
      { cls: "export-layer" },
      box,
      h("span", { cls: "export-layer-name", text: layerLabel(layer) }),
      h("span", { cls: "export-layer-meta", text: layerMeta(layer) }),
    );
  });
  const viewBoxes = new Map<string, HTMLInputElement>();
  const viewCount = h("span", { cls: "export-count" });
  const updateViewCount = (): void => {
    viewCount.textContent = `${views.filter((v) => viewBoxes.get(v.name)?.checked).length} of ${views.length} selected`;
  };
  const viewRows = views.map((v) => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: false });
    viewBoxes.set(v.name, box);
    box.addEventListener("change", updateViewCount);
    return h("label", { cls: "export-layer" }, box, h("span", { cls: "export-layer-name", text: v.name }), h("span", { cls: "export-layer-meta", text: `${v.view.layers.length} layer${v.view.layers.length === 1 ? "" : "s"}` }));
  });
  const viewSection = h(
    "div",
    { hidden: views.length === 0 },
    h("div", { cls: "export-head" }, h("span", { cls: "export-heading", text: "Saved views" }), viewCount),
    h("div", { cls: "export-layers", attrs: { role: "group", "aria-label": "Saved views" } }, ...viewRows),
  );
  const format = h(
    "select",
    { cls: "export-select", attrs: { "aria-label": "Format" } },
    ...FORMATS.map((f) => h("option", { text: f.label, value: f.id })),
  );
  const paper = h(
    "select",
    { cls: "export-select", attrs: { "aria-label": "Fit to page" } },
    h("option", { text: "Layer size (sheets: their page)", value: "" }),
    ...PAPER_SIZES.map((p) => h("option", { text: p.name, value: p.name })),
  );
  const classes = h("input", { attrs: { type: "checkbox" }, checked: true });
  const pdfOnly = [
    h("label", { cls: "export-field" }, h("span", { cls: "export-label", text: "Fit to page" }), paper),
    h("label", { cls: "export-check" }, classes, h("span", { text: "Use visible classes only" })),
  ];
  const syncFormat = (): void => {
    for (const el of pdfOnly) el.hidden = !format.value.startsWith("pdf");
    viewSection.hidden = views.length === 0 || !format.value.startsWith("pdf");
  };
  format.addEventListener("change", syncFormat);

  const current = (): PublishOptions => ({
    layerIds: layers.filter((l) => boxes.get(l.id)?.checked).map((l) => l.id),
    views: views.filter((v) => viewBoxes.get(v.name)?.checked).map((v) => v.name),
    format: format.value as PublishFormat,
    paper: paper.value,
    hiddenClasses: !classes.checked,
  });
  const apply = (o: PublishOptions): void => {
    const ids = new Set(o.layerIds);
    for (const [id, box] of boxes) box.checked = ids.has(id);
    const names = new Set(o.views);
    for (const [name, box] of viewBoxes) box.checked = names.has(name);
    format.value = o.format;
    paper.value = PAPER_SIZES.some((p) => p.name === o.paper) ? o.paper : "";
    classes.checked = !o.hiddenClasses;
    syncFormat();
    updateCount();
    updateViewCount();
  };

  const setSelect = h("select", { cls: "export-select", attrs: { "aria-label": "Publishing set" } });
  const deleteSet = h("button", { cls: "btn small", text: "Delete", attrs: { type: "button" } });
  const fillSets = (chosen = ""): void => {
    setSelect.replaceChildren(
      h("option", { text: sets.length ? "Choose a set…" : "No saved sets", value: "" }),
      ...sets.map((s) => h("option", { attrs: { translate: "no" }, text: s.name, value: s.name })),
    );
    setSelect.value = chosen;
    setSelect.disabled = sets.length === 0;
    deleteSet.disabled = chosen === "";
  };
  setSelect.addEventListener("change", () => {
    const set = sets.find((s) => s.name === setSelect.value);
    if (set) apply(set);
    deleteSet.disabled = !set;
  });
  const saveSet = h("button", { cls: "btn small", text: "Save Set…", attrs: { type: "button" } });
  saveSet.addEventListener("click", () => {
    void (async () => {
      const input = h("input", { cls: "menu-dialog-input", value: setSelect.value || `Set ${sets.length + 1}`, attrs: { type: "text", "aria-label": "Set name", spellcheck: "false" } });
      const name = await showDialog<string>({
        title: "Save Publishing Set",
        okLabel: "Save",
        body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
        check: () => (input.value.trim() ? { value: input.value.trim() } : { error: "Give the set a name.", focus: input }),
      });
      if (!name) return;
      sets = [...sets.filter((s) => s.name !== name), { name, ...current() }].sort((a, b) => a.name.localeCompare(b.name));
      storeSets(fileName, sets);
      fillSets(name);
    })();
  });
  deleteSet.addEventListener("click", () => {
    sets = sets.filter((s) => s.name !== setSelect.value);
    storeSets(fileName, sets);
    fillSets();
  });
  fillSets();
  syncFormat();
  updateCount();
  updateViewCount();

  const options = await showDialog<PublishOptions>({
    title: "Publish",
    okLabel: "Publish",
    cls: "export-dialog",
    body: [
      h("label", { cls: "export-field" }, h("span", { cls: "export-label", text: "Publishing set" }), setSelect),
      h("div", { cls: "export-quick" }, saveSet, deleteSet),
      h("div", { cls: "export-head" }, h("span", { cls: "export-heading", text: "Layers" }), count),
      layers.length > 0
        ? h("div", { cls: "export-layers", attrs: { role: "group", "aria-label": "Layers" } }, ...rows)
        : h("p", { cls: "export-hint", text: "This drawing has no layers." }),
      viewSection,
      h("div", { cls: "export-options" }, h("label", { cls: "export-field" }, h("span", { cls: "export-label", text: "Format" }), format), ...pdfOnly),
    ],
    check: () => {
      const o = current();
      if (o.layerIds.length || (o.views.length && o.format.startsWith("pdf"))) return { value: o };
      return { error: views.length && o.format.startsWith("pdf") ? "Choose at least one layer or saved view." : "Choose at least one layer." };
    },
  });
  if (!options) return;
  try {
    await deliver(await withHeldImages(doc, () => publishFiles(doc, base, options, views)));
  } catch (err) {
    toast(`Publish failed: ${errorMessage(err)}`);
  }
}
