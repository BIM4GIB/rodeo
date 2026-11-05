// Reads any file Rodeo reads into a drawing, without the editor. The format is taken from the file's
// extension, or sniffed from its first bytes when the name says none it reads, and read by the same
// readers the editor uses. Its objects are then placed on a blank drawing (place.ts), or, for a .vwx,
// a Revit and an Archicad file, the drawing is opened or built whole. The result is what the writers,
// the summary and the command line all take. No DOM.

import { archicadDrawing } from "../app/archicadImport.ts";
import { revitDrawing } from "../app/revitImport.ts";
import { blankDrawing } from "../core/blank.ts";
import { type EditSession, openVwx } from "../core/index.ts";
import { isCompoundFile } from "../import/cfb.ts";
import { type DxfDrawing, parseDxf } from "../import/dxf.ts";
import { parseDwg } from "../import/dwg.ts";
import { readEmf } from "../import/emf.ts";
import { parseIfc } from "../import/ifc.ts";
import { type MeshFile, parse3ds, parseGltf, parseObj, parseStl } from "../import/mesh.ts";
import { openPdf, type PdfPage } from "../import/pdf.ts";
import { readWith } from "../import/rvtModel.ts";
import { parseUsd, type UsdFile } from "../import/usd.ts";
import { formatById, formatInfo, formatOfName } from "./formats.ts";
import { libraries } from "./libs.ts";
import { placeDxf, placeMesh, placePage } from "./place.ts";
import type { HeadlessDrawing, ReadOptions, Unit } from "./types.ts";

/** Receives each step of a read, as a short phrase without its dots. */
type Progress = (step: string) => void;

/** The millimetres in one of each unit, for the units a file that doesn't say its own is read in. */
const UNIT_MM: Record<Unit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/** Reads a file the converter reads as a drawing without the editor; throws with a plain reason when it can't. */
export async function readAny(bytes: Uint8Array, name: string, options: ReadOptions = {}): Promise<HeadlessDrawing> {
  const progress: Progress = options.progress ?? (() => {});
  // a Revit family or template has no project geometry to read, so it is refused by its name
  if (/\.(rfa|rte|rft)$/i.test(name)) throw new Error("it's a Revit family or template, whose geometry Rodeo doesn't read: convert a project (.rvt)");
  const id = formatOfName(name) ?? sniff(bytes) ?? refuse(name);
  switch (id) {
    case "vwx":
      return { session: openVwx(bytes, name), name, from: id, skipped: {}, notes: [] };
    case "rvt":
      return revit(bytes, name, progress);
    case "pln":
      return archicad(bytes, name, progress);
    case "dwg":
    case "dxf":
      return cad(id, bytes, name, progress);
    case "pdf":
      return pdf(bytes, name, options, progress);
    case "emf":
      return metafile(bytes, name, options, progress);
    default:
      return mesh(id, bytes, name, options, progress);
  }
}

/** The format of bytes whose name says none the converter reads: a PDF, a DWG or a glTF by its first bytes, else null. */
function sniff(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("AC10")) return "dwg";
  if (head.startsWith("glTF")) return "glb";
  return null;
}

/** Throws the refusal for a file whose format the converter doesn't read, naming the extensions it does. */
function refuse(name: string): never {
  const dot = name.lastIndexOf(".");
  const kind = dot >= 0 ? `.${name.slice(dot + 1)} files` : "this kind of file";
  const list = formatInfo()
    .flatMap((f) => f.readExtensions)
    .map((e) => `.${e}`)
    .join(", ");
  throw new Error(`Rodeo doesn't read ${kind} (it reads ${list})`);
}

/** A Revit project, read through rvt-rs and built into a drawing as the editor builds one (revitImport.ts). */
async function revit(bytes: Uint8Array, name: string, progress: Progress): Promise<HeadlessDrawing> {
  if (!isCompoundFile(bytes)) throw new Error("this isn't a Revit file");
  progress("Loading the Revit reader");
  const rvt = await libraries().revit();
  const d = revitDrawing(readWith(rvt, bytes, progress), name, progress);
  return { session: openVwx(d.bytes, name), name, from: "rvt", skipped: withFailed(d.skipped, d.written.failed), notes: [...d.notes] };
}

/** An Archicad project, read by ranges and built into a drawing as the editor builds one (archicadImport.ts). */
async function archicad(bytes: Uint8Array, name: string, progress: Progress): Promise<HeadlessDrawing> {
  const d = await archicadDrawing((offset, length) => Promise.resolve(bytes.subarray(offset, offset + length)), bytes.length, name, progress);
  return { session: openVwx(d.bytes, name), name, from: "pln", skipped: withFailed(d.skipped, d.written.failed), notes: [...d.notes] };
}

/** A DWG or DXF drawing: its objects placed on a blank drawing, in millimetres or feet and inches. */
async function cad(id: "dwg" | "dxf", bytes: Uint8Array, name: string, progress: Progress): Promise<HeadlessDrawing> {
  progress("Reading the drawing");
  const notes: string[] = [];
  const unreadable: Record<string, number> = {};
  let drawing: DxfDrawing;
  if (id === "dwg") {
    const dwg = parseDwg(bytes);
    notes.push(`saved by AutoCAD ${dwg.release}`);
    if (dwg.space === "paper") notes.push("read from its paper space, as its model space is empty");
    for (const [type, n] of Object.entries(dwg.unreadable)) unreadable[`unreadable ${type}`] = n;
    drawing = dwg;
  } else {
    drawing = parseDxf(utf8OrWindows1252(bytes));
  }
  notes.push("each AutoCAD layer is a class");
  // a drawing in feet or inches gets the same units, as the editor's import gives it a new drawing
  const units: "mm" | "ftin" = drawing.mmPerUnit === 25.4 || drawing.mmPerUnit === 304.8 ? "ftin" : "mm";
  const s = openVwx(blankDrawing(units));
  progress("Placing the objects");
  const placed = placeDxf(s, designLayer(s), drawing);
  const skipped = { ...placed.skipped, ...unreadable };
  if (placed.count === 0) throw nothingDrawn(skipped);
  return { session: s, name, from: id, skipped, notes };
}

/** A PDF's chosen page, placed at its scale on a blank millimetre drawing. */
async function pdf(bytes: Uint8Array, name: string, options: ReadOptions, progress: Progress): Promise<HeadlessDrawing> {
  progress("Reading the PDF");
  const file = await openPdf(bytes);
  const n = options.page ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > file.pages) throw new Error(`the PDF has pages 1 to ${file.pages}`);
  const page = await file.page(n - 1);
  return fromPage(page, name, "pdf", options.scale ?? 1, file.pages > 1 ? [`page ${n} of ${file.pages}`] : [], progress);
}

/** An enhanced metafile's page, placed at its scale on a blank millimetre drawing. */
function metafile(bytes: Uint8Array, name: string, options: ReadOptions, progress: Progress): HeadlessDrawing {
  progress("Reading the drawing");
  return fromPage(readEmf(bytes), name, "emf", options.scale ?? 1, [], progress);
}

/** A page of lines, fills and text placed on a blank millimetre drawing, or refused when nothing in it can be drawn. */
function fromPage(page: PdfPage, name: string, from: string, scale: number, notes: string[], progress: Progress): HeadlessDrawing {
  const s = openVwx(blankDrawing("mm"));
  progress("Placing the objects");
  const placed = placePage(s, designLayer(s), page, scale);
  if (placed.count === 0) throw nothingDrawn(placed.skipped);
  return { session: s, name, from, skipped: placed.skipped, notes };
}

/** A 3D model read by its format's reader and placed on a blank millimetre drawing as one model. */
async function mesh(id: string, bytes: Uint8Array, name: string, options: ReadOptions, progress: Progress): Promise<HeadlessDrawing> {
  const base = name.replace(/\.[^.]+$/, "") || (formatById(id)?.name ?? id);
  progress("Reading the model");
  const model = await readModel(id, name, base, bytes, progress);
  const s = openVwx(blankDrawing("mm"));
  progress("Placing the objects");
  const placed = placeMesh(s, designLayer(s), model, settingsOf(id, model, options), base, id !== "skp");
  if (placed.count === 0) throw nothingDrawn(placed.skipped);
  return { session: s, name, from: id, skipped: placed.skipped, notes: [] };
}

/** The file read as `id` by the reader the editor uses for it (meshImport.ts readModel); the WebAssembly readers load when first needed. */
async function readModel(id: string, name: string, base: string, bytes: Uint8Array, progress: Progress): Promise<MeshFile> {
  switch (id) {
    case "obj":
      return parseObj(new TextDecoder().decode(bytes));
    case "glb":
      return parseGltf(bytes);
    case "3ds":
      return parse3ds(bytes);
    case "stl":
      return parseStl(bytes, base);
    case "ifc":
      progress("Loading the IFC reader");
      return parseIfc(bytes, await libraries().ifc());
    case "usdz":
      return parseUsd(bytes);
    case "3dm": {
      progress("Loading the Rhino reader");
      const [{ parse3dm }, rhino] = await Promise.all([import("../import/rhino.ts"), libraries().rhino()]);
      return parse3dm(bytes, rhino);
    }
    case "fbx":
      return (await import("../import/fbx.ts")).parseFbx(bytes);
    case "dae": {
      const { parseCollada, parseKmz } = await import("../import/collada.ts");
      return /\.kmz$/i.test(name) ? parseKmz(bytes) : parseCollada(new TextDecoder().decode(bytes));
    }
    case "blend":
      return (await import("../import/blend.ts")).parseBlend(bytes);
    case "ply":
      return (await import("../import/ply.ts")).parsePly(bytes, base);
    case "skp":
      return (await import("../import/skp.ts")).parseSkp(bytes);
    default:
      throw new Error(`Rodeo doesn't read ${id}`);
  }
}

/**
 * The units and up axis a 3D file is placed with. OBJ, 3DS, STL and PLY don't say theirs, so the
 * options give them (OBJ is metres with y up, STL millimetres with z up, 3DS and PLY metres with z up);
 * a USD file says its own; the rest say theirs, or are glTF's metres with y up.
 */
function settingsOf(id: string, model: MeshFile, options: ReadOptions): { mm: number; yUp: boolean } {
  switch (id) {
    case "obj":
      return { mm: UNIT_MM[options.units ?? "m"], yUp: options.yUp ?? true };
    case "3ds":
    case "ply":
      return { mm: UNIT_MM[options.units ?? "m"], yUp: options.yUp ?? false };
    case "stl":
      return { mm: UNIT_MM[options.units ?? "mm"], yUp: options.yUp ?? false };
    case "usdz": {
      const usd = model as UsdFile;
      return { mm: usd.metersPerUnit * 1000, yUp: usd.upAxis === "Y" };
    }
    default:
      return model.frame ?? { mm: 1000, yUp: true };
  }
}

/** The id of the drawing's first design layer, where the readers put what they read. */
function designLayer(s: EditSession): string {
  const layer = s.doc.layers().find((l) => l.kind === "design");
  if (!layer) throw new Error("the drawing has no design layer");
  return layer.id;
}

/** A DXF file's text: UTF-8, else Windows-1252, as the editor reads it (app/fileio.ts). */
function utf8OrWindows1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** A reader's skipped counts with what the writer couldn't make, each as "couldn't make <kind>". */
function withFailed(skipped: Record<string, number>, failed: Record<string, number>): Record<string, number> {
  const out = { ...skipped };
  for (const [kind, n] of Object.entries(failed)) out[`couldn't make ${kind}`] = n;
  return out;
}

/** The error for a file whose drawing holds nothing Rodeo can draw, naming what the reader left out. */
function nothingDrawn(skipped: Record<string, number>): Error {
  const left = Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind} ${n}`);
  return new Error(`there's nothing in it Rodeo can draw${left.length ? ` (left out: ${left.join(", ")})` : ""}`);
}
