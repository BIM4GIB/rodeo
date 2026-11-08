// File access: File System Access API when available, otherwise <input> and
// download fallbacks. Also installs window-wide drag and drop.

import { h } from "./dom.ts";

export interface PickedFile {
  readonly name: string;
  /** the file itself, read a slice at a time as it opens (a large one could not be read whole) */
  readonly file: Blob;
  readonly handle: FileSystemFileHandle | null;
}

export type SaveTarget = { readonly kind: "handle"; readonly handle: FileSystemFileHandle } | { readonly kind: "download" };

interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FileSystemPickers {
  showOpenFilePicker?: (options?: { types?: FilePickerType[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: FilePickerType[] }) => Promise<FileSystemFileHandle>;
}

const VWX_TYPES: FilePickerType[] = [
  { description: "Vectorworks drawing", accept: { "application/octet-stream": [".vwx"] } },
  { description: "Vectorworks template", accept: { "application/octet-stream": [".sta"] } },
];

/** A template is a drawing saved for starting others from: the same format, offered first. */
const TEMPLATE_TYPES: FilePickerType[] = [VWX_TYPES[1], VWX_TYPES[0]];

const DWG_TYPES: FilePickerType[] = [{ description: "AutoCAD drawing", accept: { "application/acad": [".dwg"] } }];
/** File > Open also takes Revit files (revitFile.ts) and Archicad projects (plnImport.ts). */
const REVIT_TYPES: FilePickerType[] = [
  { description: "Revit project or family", accept: { "application/octet-stream": [".rvt", ".rfa", ".rte", ".rft"] } },
  { description: "Archicad project", accept: { "application/octet-stream": [".pln", ".pla", ".tpl"] } },
];
/** File > Open also takes STEP and IGES models, which come in as a drop of one does (meshImport.ts). */
const MODEL_TYPES: FilePickerType[] = [
  { description: "STEP or IGES model", accept: { "model/step": [".stp", ".step"], "model/iges": [".igs", ".iges"] } },
];

function pickers(): FileSystemPickers {
  return window as unknown as FileSystemPickers;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function pickWithInput(accept: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ name: file.name, file, handle: null });
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/**
 * Asks the user for a .vwx (or .sta template) file, templates first when `template`; File > Open
 * takes a .dwg too, which opens as a new drawing, and a Revit, Archicad, STEP or IGES file (`revit`).
 * Resolves null when the picker is cancelled.
 */
export async function pickFile(template = false, revit = false): Promise<PickedFile | null> {
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickWithInput(template ? ".sta,.vwx" : revit ? ".vwx,.sta,.dwg,.rvt,.rfa,.rte,.rft,.pln,.pla,.tpl,.stp,.step,.igs,.iges" : ".vwx,.sta,.dwg");
  try {
    const [handle] = await open({ types: template ? TEMPLATE_TYPES : [...VWX_TYPES, ...DWG_TYPES, ...(revit ? [...REVIT_TYPES, ...MODEL_TYPES] : [])], multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, file, handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Asks the user for a .dwg file. Resolves null when the picker is cancelled. */
export async function pickDwg(): Promise<PickedFile | null> {
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickWithInput(".dwg");
  try {
    const [handle] = await open({ types: DWG_TYPES, multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, file, handle: null };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** A DXF file read as text. */
export interface PickedDxf {
  readonly name: string;
  readonly text: string;
  readonly file: Blob;
}

const DXF_TYPES: FilePickerType[] = [{ description: "AutoCAD DXF drawing", accept: { "application/dxf": [".dxf"] } }];

/** Reads a DXF file as UTF-8, or as Windows-1252 when it is not UTF-8 (older files often are). */
export async function readDxfText(file: Blob): Promise<string> {
  const bytes = await readBytes(file);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function pickDxfWithInput(): Promise<PickedDxf | null> {
  return new Promise((resolve, reject) => {
    const input = h("input", { attrs: { type: "file", accept: ".dxf" }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      finish();
      if (!file) {
        resolve(null);
        return;
      }
      readDxfText(file).then((text) => resolve({ name: file.name, text, file }), reject);
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/** Asks the user for a .dxf file. Resolves null when the picker is cancelled. */
export async function pickDxf(): Promise<PickedDxf | null> {
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickDxfWithInput();
  try {
    const [handle] = await open({ types: DXF_TYPES, multiple: false });
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, text: await readDxfText(file), file };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

function pickFilesWithInput(accept: string): Promise<PickedFile[] | null> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept, multiple: "" }, hidden: true });
    document.body.append(input);
    const finish = (): void => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      finish();
      resolve(files.length > 0 ? files.map((file) => ({ name: file.name, file, handle: null })) : null);
    });
    input.addEventListener("cancel", () => {
      finish();
      resolve(null);
    });
    input.click();
  });
}

/** Asks the user for several .dwg or .dxf files at once, such as the external references a drawing needs. Resolves null when the picker is cancelled. */
export async function pickDrawingFiles(): Promise<PickedFile[] | null> {
  const open = pickers().showOpenFilePicker?.bind(window);
  if (!open) return pickFilesWithInput(".dwg,.dxf");
  try {
    const handles = await open({ types: [...DWG_TYPES, ...DXF_TYPES], multiple: true });
    if (handles.length === 0) return null;
    return await Promise.all(
      handles.map(async (handle) => {
        const file = await handle.getFile();
        return { name: file.name, file, handle: null };
      }),
    );
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

/** Chooses where Save As writes, templates first when `template`. Falls back to a download when the picker is unavailable. */
export async function chooseSaveTarget(suggestedName: string, template = false): Promise<SaveTarget | null> {
  const save = pickers().showSaveFilePicker?.bind(window);
  if (!save) return { kind: "download" };
  try {
    const handle = await save({ suggestedName, types: template ? TEMPLATE_TYPES : VWX_TYPES });
    return { kind: "handle", handle };
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const out = await handle.createWritable();
  try {
    await out.write(new Uint8Array(bytes));
    await out.close();
  } catch (err) {
    await out.abort().catch(() => undefined);
    throw err;
  }
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { attrs: { href: url, download: name }, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A drop's file handle, in browsers that hand one over (it is asked for during the drop). */
interface HandleItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

/**
 * Calls onFile for the first file dropped anywhere in the window, with its handle
 * where the browser offers one (null otherwise) and every file dropped with it. Shows the drop
 * overlay while dragging.
 */
export function installFileDrop(onFile: (file: File, handle: Promise<FileSystemFileHandle | null>, all: readonly File[]) => void): void {
  const overlay = document.getElementById("drop-overlay");
  let depth = 0;
  const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const setOverlay = (on: boolean): void => {
    overlay?.classList.toggle("on", on);
  };
  window.addEventListener("dragenter", (e) => {
    if (!carriesFiles(e)) return;
    depth++;
    setOverlay(true);
  });
  window.addEventListener("dragleave", (e) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setOverlay(false);
  });
  window.addEventListener("dragover", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth = 0;
    setOverlay(false);
    const item = e.dataTransfer?.items[0] as (DataTransferItem & HandleItem) | undefined;
    const handle = (item?.getAsFileSystemHandle?.() ?? Promise.resolve(null)).then(
      (h) => (h?.kind === "file" ? (h as FileSystemFileHandle) : null),
      () => null,
    );
    const all = [...(e.dataTransfer?.files ?? [])];
    if (all[0]) onFile(all[0], handle, all);
  });
}
