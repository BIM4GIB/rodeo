// File > Import DXF… and Import DWG…: reads a DXF or DWG drawing and places its objects on the
// active layer, as one undo step. Each DXF or DWG layer becomes a class of the same name (an
// existing one is reused; a new one is hidden when its layer is off or frozen), the objects are
// grouped and the group is selected and zoomed to (the 3D surfaces in a group of their own, so plan
// shows them too). Objects keep their colour (the palette's
// nearest), weight and, in a drawing that has a line type to copy, their line type; solid hatches
// are filled and patterned ones are their strokes; 3D faces and meshes are filled meshes, and so
// are 3D solids, regions and bodies, which OpenCascade meshes (import/solids.ts). The parsing and
// the geometry are in import/dxf.ts and import/dwg.ts (which hands its objects to the same walker);
// this module does the session work and the summary. A drawing's external references
// (xrefs) are drawn from the files given for them: when one is not found, the user is asked for the
// files first (withXrefs).

import type { Attributes, EditSession, NewShape } from "../core/index.ts";
import { dwgSource, parseDwg, type DwgDrawing } from "../import/dwg.ts";
import { occtLib } from "../import/occt.ts";
import { meshSolids } from "../import/solids.ts";
import {
  dxfPlacements,
  dxfSource,
  type DxfXref,
  paperDashes,
  parseDxf,
  type DxfDrawing,
  type DxfLineType,
  type DxfMesh,
  type DxfPlacement,
  type XrefSource,
} from "../import/dxf.ts";
import { attempt, setEditGroup, zoomToSelection } from "./commands.ts";
import { h, nextPaint } from "./dom.ts";
import { fileIn } from "./ext.ts";
import { pickDrawingFiles, pickDwg, pickDxf, readDxfText, type PickedDxf, type PickedFile } from "./fileio.ts";
import { lineTypePreviews } from "./lineTypeEditor.ts";
import { showLoading } from "./loading.ts";
import { showDialog } from "./menubar.ts";
import { colorMatcher, fillShapes } from "./pdfImport.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

/** Pen weight units (mils) per millimetre. */
const MILS_PER_MM = 1000 / 25.4;

/** How an import may find the files of the external references a drawing needs. */
export interface ImportOptions {
  /** the other drawing files dropped with this one: a reference one of them is the file of is taken from it, without asking */
  readonly siblings?: readonly File[];
  /** false for an import that cannot ask (an agent's): the references not found are left out, and the toast names them */
  readonly ask?: boolean;
}

/** An external reference as its drawing names it, which is what a file is matched to. */
type XrefRef = Pick<DxfXref, "name" | "path">;

/** File > Import DXF…: asks for a .dxf file and imports it into the active layer. */
export async function importDxfFile(scene: Scene, view: View): Promise<void> {
  if (!readyToImport("DXF")) return;
  let picked: PickedDxf | null;
  try {
    picked = await pickDxf();
  } catch (err) {
    toast(`Could not open the file: ${errorMessage(err)}`);
    return;
  }
  if (picked) await importDxfText(picked.file, picked.text, picked.name, scene, view, {});
}

/** A .dxf file dropped on the window: imported into the active layer like File > Import DXF…. */
export async function importDroppedDxf(file: File, scene: Scene, view: View, options: ImportOptions = {}): Promise<void> {
  if (!readyToImport("DXF")) return;
  let text: string;
  try {
    text = await readDxfText(file);
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    return;
  }
  await importDxfText(file, text, file.name, scene, view, options);
}

/** File > Import DWG…: asks for a .dwg file and imports it into the active layer. */
export async function importDwgFile(scene: Scene, view: View): Promise<void> {
  if (!readyToImport("DWG")) return;
  let picked: PickedFile | null;
  let bytes: Uint8Array;
  try {
    picked = await pickDwg();
    if (!picked) return;
    bytes = new Uint8Array(await picked.file.arrayBuffer());
  } catch (err) {
    toast(`Could not open the file: ${errorMessage(err)}`);
    return;
  }
  await importDwgBytes(bytes, picked.name, scene, view, {});
}

/** A .dwg file dropped on the window: imported into the active layer like File > Import DWG…. */
export async function importDroppedDwg(file: File, scene: Scene, view: View, options: ImportOptions = {}): Promise<void> {
  if (!readyToImport("DWG")) return;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    return;
  }
  await importDwgBytes(bytes, file.name, scene, view, options);
}

/** Imports a DWG file's bytes into the active layer, with the external references it needs; the outcome is shown in the selection and a toast. */
export async function importDwgBytes(bytes: Uint8Array, name: string, scene: Scene, view: View, options: ImportOptions = {}): Promise<void> {
  if (!readyToImport("DWG")) return;
  const drawing = await readDwg(bytes, name);
  if (!drawing) return;
  const read = await withXrefs(drawing, name, (xrefs) => parseDwg(bytes, xrefs), options);
  if (read) await placeDwg(await withSolids(read.drawing, name), bytes, name, scene, view, read.missing);
}

/**
 * File > Open of a .dwg, or one dropped with no drawing open: read first, so a file that cannot be
 * read leaves no empty drawing behind, then imported into the new drawing `fresh` opens.
 */
export async function openDwgBytes(bytes: Uint8Array, name: string, fresh: () => Promise<void>, scene: Scene, view: View, options: ImportOptions = {}): Promise<void> {
  const drawing = await readDwg(bytes, name);
  if (!drawing) return;
  // the references are asked for before the new drawing opens, so Cancel opens nothing
  const read = await withXrefs(drawing, name, (xrefs) => parseDwg(bytes, xrefs), options);
  if (!read) return;
  const meshed = await withSolids(read.drawing, name);
  const before = store.session;
  await fresh();
  if (!store.session || store.session === before) return;
  if (readyToImport("DWG")) await placeDwg(meshed, bytes, name, scene, view, read.missing);
}

/** A DWG file's bytes read, or null when they cannot be (and a toast says why). */
async function readDwg(bytes: Uint8Array, name: string): Promise<DwgDrawing | null> {
  try {
    return await whileShown(name, bytes.length, () => parseDwg(bytes));
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    fileIn(bytes, name, errorMessage(err));
    return null;
  }
}

async function placeDwg(drawing: DwgDrawing, bytes: Uint8Array, name: string, scene: Scene, view: View, missing: readonly string[]): Promise<void> {
  // a sheet with nothing in model space is read from its paper space, and the toast says so
  const from = drawing.space === "paper" ? " from its paper space" : "";
  if (await whileShown(name, bytes.length, () => placeDrawing(drawing, name, "Import DWG", scene, view, from, missing))) fileIn(bytes, name);
}

/** Files from this many bytes up show the loading bar while they are read and while they are placed. */
const SLOW_BYTES = 2_000_000;

/**
 * `work`'s result, the loading bar showing over the drawing meanwhile when the file of `bytes` is
 * big enough for the wait to be noticed. The work is synchronous, so the bar is painted first.
 */
async function whileShown<T>(name: string, bytes: number, work: () => T): Promise<T> {
  if (bytes < SLOW_BYTES) return work();
  const done = showLoading(`Reading ${name}…`);
  try {
    await nextPaint();
    return work();
  } finally {
    done();
  }
}

/** True when there is a drawing and an active layer to import into; otherwise says why. */
function readyToImport(kind: "DXF" | "DWG"): boolean {
  if (!store.session) {
    toast(`Open a drawing before importing a ${kind} file.`, "info");
    return false;
  }
  if (store.activeLayerId === null) {
    toast(`Choose a layer to import the ${kind} file into.`, "info");
    return false;
  }
  return true;
}

/** Imports DXF text (read from `file`) into the active layer, with the external references it needs; the outcome is shown in the selection and a toast. */
async function importDxfText(file: Blob, text: string, name: string, scene: Scene, view: View, options: ImportOptions): Promise<void> {
  let drawing: DxfDrawing;
  try {
    drawing = await whileShown(name, file.size, () => parseDxf(text));
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    fileIn(file, name, errorMessage(err));
    return;
  }
  const read = await withXrefs(drawing, name, (xrefs) => parseDxf(text, xrefs), options);
  if (!read) return;
  const meshed = await withSolids(read.drawing, name);
  if (await whileShown(name, file.size, () => placeDrawing(meshed, name, "Import DXF", scene, view, "", read.missing))) fileIn(file, name);
}

/**
 * The drawing with its 3D solids, regions and bodies meshed, the loading bar showing meanwhile.
 * OpenCascade loads the first time a drawing has solids; when it cannot, they are counted as left out.
 */
async function withSolids<T extends DxfDrawing>(drawing: T, name: string): Promise<T> {
  if (drawing.solids.length === 0) return drawing;
  const done = showLoading(`Meshing the 3D solids of ${name}…`);
  try {
    return await meshSolids(drawing, occtLib, (fraction) => done.progress(fraction));
  } catch {
    const skipped = { ...drawing.skipped };
    for (const solid of drawing.solids) skipped[solid.type] = (skipped[solid.type] ?? 0) + 1;
    return { ...drawing, skipped, solids: [] };
  } finally {
    done();
  }
}

/**
 * Places a read drawing's objects on the active layer as one undo step called `undo`; `from` ends
 * the toast's first words, and `missing` names the external references not found. False when there
 * was nowhere to place them or the step failed.
 */
function placeDrawing(drawing: DxfDrawing, name: string, undo: string, scene: Scene, view: View, from: string, missing: readonly string[] = []): boolean {
  const session = store.session;
  // the picker is open while the user chooses, so the layer is read again here
  const layerId = store.activeLayerId;
  if (!session || !layerId) return false;
  // file units to millimetres, which are the world units whatever the document's units are
  const scale = drawing.mmPerUnit;
  const placements = dxfPlacements(drawing, scale);
  const skipped: Record<string, number> = { ...drawing.skipped };
  const base: Partial<Attributes> = { ...store.drawAttrs };
  const colorOf = colorMatcher();
  const paletteOf = (rgb: number): number => colorOf({ r: ((rgb >> 16) & 255) / 255, g: ((rgb >> 8) & 255) / 255, b: (rgb & 255) / 255 });
  const layerScale = session.doc.layers().find((l) => l.id === layerId)?.scale ?? 1;

  const r = attempt(undo, (s) =>
    s.batch(() => {
      const classes = new Map<string, number>();
      let hiddenCount = 0;
      // a DXF or DWG layer is a class of the same name: an existing one is reused, otherwise one is made
      const classOf = (layer: string): number => {
        const known = classes.get(layer);
        if (known !== undefined) return known;
        const existing = s.doc.classes().find((c) => c.name.toLowerCase() === layer.toLowerCase());
        let index = existing?.index;
        if (index === undefined) {
          try {
            index = s.createClass(layer);
            // what is on a layer that is off or frozen stays out of sight, as in AutoCAD
            if (drawing.hiddenLayers.has(layer.toUpperCase())) s.setClassVisibility(index, "hidden");
          } catch {
            // the name is taken by a layer, symbol or line type: the objects use the active class
            index = store.activeClassIndex;
          }
        }
        classes.set(layer, index);
        return index;
      };
      const lineStyleOf = lineStyles(s, scale, layerScale);
      const attrsOf = (p: DxfPlacement): Partial<Attributes> => {
        const color = paletteOf(p.style.color);
        if (p.filled) return { ...base, lineStyle: 0, fillPattern: 1, fillFore: color, fillBack: color, fillOpacity: 100 };
        const weight = p.style.weight !== null ? { lineWeight: Math.max(1, Math.round(p.style.weight * MILS_PER_MM)) } : {};
        const pen = p.text ? {} : { lineStyle: lineStyleOf(p.style.lineType), ...weight };
        return { ...base, ...pen, penFore: color, penOpacity: 100, fillPattern: 0 };
      };
      const ids: string[] = [];
      const added = (p: DxfPlacement, n: number): void => {
        if (drawing.hiddenLayers.has(p.layer.toUpperCase())) hiddenCount += n;
      };
      // an object the document cannot hold is left out, like one the parser skipped
      const leftOut = (p: DxfPlacement): void => {
        skipped[p.type] = (skipped[p.type] ?? 0) + 1;
      };
      type Item = { p: DxfPlacement; shape: NewShape; cls: number; attrs: Partial<Attributes> };
      // each add rebuilds the document, so the objects go in as one add, each with its class and
      // attributes, in the file's order; when the document refuses an add, its two halves go in
      // apart, down to the one object it cannot hold, which is left out
      const place = (items: readonly Item[]): void => {
        if (items.length === 0) return;
        try {
          // one at a time: a drawing's ids can be too many arguments for a spread
          for (const id of s.addObjects(layerId, items.map((it) => it.shape), items.map((it) => it.cls), items.map((it) => it.attrs))) ids.push(id);
          for (const it of items) added(it.p, 1);
        } catch {
          if (items.length === 1) {
            leftOut(items[0].p);
            return;
          }
          const half = items.length >> 1;
          place(items.slice(0, half));
          place(items.slice(half));
        }
      };
      const items: Item[] = [];
      for (const p of placements) {
        let cls: number;
        let attrs: Partial<Attributes>;
        try {
          cls = classOf(p.layer);
          attrs = attrsOf(p);
        } catch {
          leftOut(p);
          continue;
        }
        // a text is made turned and justified about its anchor
        if (p.shape.kind === "text" && p.text) {
          items.push({ p, shape: { ...p.shape, hAlign: p.text.hAlign, vAlign: p.text.vAlign, angle: p.text.angle }, cls, attrs });
          continue;
        }
        // a fill with holes is one polygon a ring, each joined to the holes inside it
        const shapes: NewShape[] = p.rings ? fillShapes(p.rings).map((f) => ({ kind: "polygon", points: f.points, closed: true })) : [p.shape];
        for (const shape of shapes) items.push({ p, shape, cls, attrs });
      }
      place(items);
      // the 3D surfaces (3DFACE, polyface and polygon meshes, MESH, solids) are meshes, one per entity, filled in
      // their colour; they go in as one add, as the objects do, and a surface the document cannot hold
      // is left out
      const attrsByColor = new Map<number, Partial<Attributes>>();
      const surfaces: { m: DxfMesh; cls: number; attrs: Partial<Attributes> }[] = [];
      for (const m of drawing.meshes) {
        try {
          const color = paletteOf(m.style.color);
          let attrs = attrsByColor.get(color);
          if (!attrs) {
            // the pen draws its outline from above in Top/Plan
            attrs = { ...base, penFore: color, penOpacity: 100, fillPattern: 1, fillFore: color, fillBack: color, fillOpacity: 100 };
            attrsByColor.set(color, attrs);
          }
          surfaces.push({ m, cls: classOf(m.layer), attrs });
        } catch {
          skipped[m.type] = (skipped[m.type] ?? 0) + 1;
        }
      }
      const meshIds: string[] = [];
      if (surfaces.length > 0) {
        const parts = surfaces.map((it) => it.m.faces.map((f) => f.map((v) => v * scale)));
        try {
          for (const id of s.addMeshes(layerId, parts, surfaces.map((it) => it.cls), surfaces.map((it) => it.attrs))) meshIds.push(id);
          for (const it of surfaces) if (drawing.hiddenLayers.has(it.m.layer.toUpperCase())) hiddenCount++;
        } catch {
          // a batch the document refuses goes one surface at a time, to leave out just the ones it cannot hold
          surfaces.forEach((it, i) => {
            try {
              for (const id of s.addMeshes(layerId, [parts[i]], it.cls, it.attrs)) meshIds.push(id);
              if (drawing.hiddenLayers.has(it.m.layer.toUpperCase())) hiddenCount++;
            } catch {
              skipped[it.m.type] = (skipped[it.m.type] ?? 0) + 1;
            }
          });
        }
      }
      // a group that holds plan drawing shows only that in Top/Plan, as a hybrid does, so the 3D surfaces
      // go in a group of their own beside the 2D objects' and are seen from above in plan too
      const groups = [ids, meshIds].filter((list) => list.length > 0).map((list) => (list.length < 2 ? list[0] : s.groupObjects(list)));
      return { count: ids.length + meshIds.length, hidden: hiddenCount, groups };
    }),
  );
  if (!r) return false;

  const { count, hidden, groups } = r.value;
  if (groups.length > 0) {
    setEditGroup(null, groups);
    zoomToSelection(scene, view);
  }
  const kinds = Object.keys(skipped)
    .filter((k) => skipped[k] > 0)
    .sort();
  const left = kinds.reduce((n, k) => n + skipped[k], 0);
  const shown = hidden > 0 ? ` (${hidden} on layers that are off or frozen, in hidden classes)` : "";
  const head = count === 0 ? `Nothing imported from ${name}${from}` : `Imported ${count} ${count === 1 ? "object" : "objects"}${from}${shown}`;
  toast(left > 0 ? `${head}; skipped ${left} (${kinds.join(", ")})` : head, "info");
  if (missing.length > 0) toast(`${missing.length === 1 ? "External reference" : "External references"} not found: ${missing.join(", ")}`, "info");
  return true;
}

/**
 * Reads a drawing `name` with the files of its external references (xrefs). The dropped files in
 * `options.siblings` that the references name are used without asking; any others are asked for,
 * unless `ask` is false. Choose Files… reads the files picked and reads the drawing with them,
 * Import Without Them reads it without the rest, and Cancel stops the import (null). Resolves the
 * drawing read, and the names of the references still not found. A read that fails says so, as
 * a plain read does, and is null.
 */
async function withXrefs<T extends DxfDrawing>(
  first: T,
  name: string,
  read: (xrefs: ReadonlyMap<string, XrefSource>) => T,
  options: ImportOptions,
): Promise<{ drawing: T; missing: string[] } | null> {
  try {
    let files = siblingFiles(options.siblings);
    let sources = await sourcesFor(first.xrefs, files);
    let drawing = sources.size > 0 ? read(sources) : first;
    if (options.ask !== false) {
      while (drawing.xrefs.some((x) => !x.found)) {
        const choice = await askForXrefs(drawing.xrefs.filter((x) => !x.found));
        if (choice === null) return null;
        if (choice === "skip") break;
        const picked = await pickDrawingFiles();
        // a picker that is cancelled asks again
        if (!picked) continue;
        files = [...files, ...picked];
        sources = await sourcesFor(first.xrefs, files);
        drawing = read(sources);
        break;
      }
    }
    return { drawing, missing: missingXrefs(drawing, sources) };
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    return null;
  }
}

/** Asks for the files of the external references that are missing: Choose Files… picks them, Import Without Them leaves them out, and Cancel stops the import. */
function askForXrefs(missing: readonly DxfXref[]): Promise<"choose" | "skip" | null> {
  let skip = false;
  const without = h("button", { cls: "btn", text: "Import Without Them", attrs: { type: "button" } });
  without.addEventListener("click", () => {
    skip = true;
    without.form?.requestSubmit();
  });
  return showDialog<"choose" | "skip">({
    title: "External References",
    okLabel: "Choose Files…",
    body: [
      h("p", { cls: "menu-dialog-text", text: "This drawing uses drawings that are not open here. Choose their files to bring them in, or import without them." }),
      // the names as the drawing has them, and "no file given" on its own so it is translated
      h("ul", {}, ...missing.map((x) => {
        const file = fileNameOf(x.path);
        return h("li", {}, h("span", { text: x.name, attrs: { translate: "no" } }), " (", file ? h("span", { text: file, attrs: { translate: "no" } }) : "no file given", ")");
      })),
      without,
    ],
    check: () => ({ value: skip ? "skip" : "choose" }),
  });
}

/** The dropped files that are drawings, as picked files: the candidates for a reference. */
function siblingFiles(files: readonly File[] | undefined): PickedFile[] {
  return (files ?? []).filter((f) => /\.(dwg|dxf)$/i.test(f.name)).map((file) => ({ name: file.name, file, handle: null }));
}

/**
 * The xref sources for the references: each one (and those the files it names use, in turn) is given
 * the file that its path ends with, or else one named as the reference is, with a drawing's extension.
 * A file that cannot be read is said so, and its references stay not found.
 */
async function sourcesFor(refs: readonly XrefRef[], files: readonly PickedFile[]): Promise<Map<string, XrefSource>> {
  const out = new Map<string, XrefSource>();
  const queue = [...refs];
  for (let ref = queue.pop(); ref !== undefined; ref = queue.pop()) {
    const key = ref.name.toUpperCase();
    const file = out.has(key) ? undefined : fileFor(files, ref);
    if (!file) continue;
    try {
      const source = await sourceOf(file);
      out.set(key, source);
      queue.push(...source.xrefs);
    } catch (err) {
      toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    }
  }
  return out;
}

/** The picked file an external reference is for: the one its path ends with, else one named as the reference is, with a drawing's extension. */
function fileFor(files: readonly PickedFile[], ref: XrefRef): PickedFile | undefined {
  const named = fileNameOf(ref.path).toLowerCase();
  const byPath = named === "" ? undefined : files.find((f) => f.name.toLowerCase() === named);
  if (byPath) return byPath;
  const stem = ref.name.toLowerCase();
  return files.find((f) => /\.(dwg|dxf)$/i.test(f.name) && f.name.replace(/\.(dwg|dxf)$/i, "").toLowerCase() === stem);
}

/** A picked file read as an xref's source: a DXF as text, anything else as a DWG. */
async function sourceOf(picked: PickedFile): Promise<XrefSource> {
  if (/\.dxf$/i.test(picked.name)) return dxfSource(await readDxfText(picked.file));
  return dwgSource(new Uint8Array(await picked.file.arrayBuffer()));
}

/** The file name at the end of a path, which may use either slash. */
function fileNameOf(path: string): string {
  return path.trim().split(/[\\/]/).pop() ?? "";
}

/** The external references not found: the drawing's own, and those that the files it uses name and were not given. */
function missingXrefs(drawing: DxfDrawing, sources: ReadonlyMap<string, XrefSource>): string[] {
  const names = new Map<string, string>();
  for (const x of drawing.xrefs) if (!x.found) names.set(x.name.toUpperCase(), x.name);
  for (const s of sources.values()) {
    for (const x of s.xrefs) if (!x.overlay && !sources.has(x.name.toUpperCase())) names.set(x.name.toUpperCase(), x.name);
  }
  return [...names.values()];
}

/**
 * The line style each DXF line type draws with: one of the drawing's line types with the same
 * dashes, or a new one named after it. Rodeo makes a line type by copying one, so in a drawing
 * that has none (a new one) the lines are solid. `mmPerUnit` and `layerScale` turn the file's
 * dashes into paper inches.
 */
function lineStyles(s: EditSession, mmPerUnit: number, layerScale: number): (lt: DxfLineType | null) => number {
  const made = new Map<string, number>();
  return (lt) => {
    const dashes = lt ? paperDashes(lt.dashes, mmPerUnit / 25.4 / (layerScale > 0 ? layerScale : 1)) : null;
    if (!lt || !dashes) return 2;
    const key = `${lt.name}|${dashes.join(",")}`;
    const known = made.get(key);
    if (known !== undefined) return known;
    const types = s.doc.lineTypes();
    const same = types.find((t) => t.dashes.length === dashes.length && t.dashes.every((v, i) => Math.abs(v - dashes[i]) <= 1e-6 * Math.max(1, v)));
    let style = same?.style ?? 2;
    if (!same && types.length > 0) {
      const taken = (n: string): boolean =>
        s.doc.classes().some((c) => c.name === n) || s.doc.layers().some((l) => l.name === n) || s.doc.resources().some((r) => r.name === n);
      const name = [lt.name, ...[2, 3, 4, 5, 6, 7, 8, 9].map((k) => `${lt.name} ${k}`)].find((n) => !taken(n));
      try {
        if (name) style = -s.createLineType(name, dashes, lineTypePreviews(s.doc, dashes));
      } catch {
        // a line type that cannot be made draws solid
      }
    }
    made.set(key, style);
    return style;
  };
}
