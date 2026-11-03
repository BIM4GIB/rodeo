// File > Import DXF… and Import DWG…: reads a DXF or DWG drawing and places its objects on the
// active layer, as one undo step. Each DXF or DWG layer becomes a class of the same name (an
// existing one is reused; a new one is hidden when its layer is off or frozen), the objects are
// grouped and the group is selected and zoomed to. Objects keep their colour (the palette's
// nearest), weight and, in a drawing that has a line type to copy, their line type; solid hatches
// are filled and patterned ones are their strokes. The parsing and the geometry are in
// import/dxf.ts and import/dwg.ts (which hands its objects to the same walker); this module does
// the session work and the summary.

import type { Attributes, EditSession, NewShape } from "../core/index.ts";
import { parseDwg, type DwgDrawing } from "../import/dwg.ts";
import { dxfPlacements, paperDashes, parseDxf, type DxfDrawing, type DxfLineType, type DxfPlacement } from "../import/dxf.ts";
import { attempt, setEditGroup, zoomToSelection } from "./commands.ts";
import { fileIn } from "./ext.ts";
import { pickDwg, pickDxf, readDxfText, type PickedDxf, type PickedFile } from "./fileio.ts";
import { lineTypePreviews } from "./lineTypeEditor.ts";
import { colorMatcher, fillShapes } from "./pdfImport.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

/** Pen weight units (mils) per millimetre. */
const MILS_PER_MM = 1000 / 25.4;
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
  if (picked) importDxfText(picked.file, picked.text, picked.name, scene, view);
}

/** A .dxf file dropped on the window: imported into the active layer like File > Import DXF…. */
export async function importDroppedDxf(file: File, scene: Scene, view: View): Promise<void> {
  if (!readyToImport("DXF")) return;
  let text: string;
  try {
    text = await readDxfText(file);
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    return;
  }
  importDxfText(file, text, file.name, scene, view);
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
  importDwgBytes(bytes, picked.name, scene, view);
}

/** A .dwg file dropped on the window: imported into the active layer like File > Import DWG…. */
export async function importDroppedDwg(file: File, scene: Scene, view: View): Promise<void> {
  if (!readyToImport("DWG")) return;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    return;
  }
  importDwgBytes(bytes, file.name, scene, view);
}

/** Imports a DWG file's bytes into the active layer; the outcome is shown in the selection and a toast. */
export function importDwgBytes(bytes: Uint8Array, name: string, scene: Scene, view: View): void {
  if (!readyToImport("DWG")) return;
  const drawing = readDwg(bytes, name);
  if (drawing) placeDwg(drawing, bytes, name, scene, view);
}

/**
 * File > Open of a .dwg, or one dropped with no drawing open: read first, so a file that cannot be
 * read leaves no empty drawing behind, then imported into the new drawing `fresh` opens.
 */
export async function openDwgBytes(bytes: Uint8Array, name: string, fresh: () => Promise<void>, scene: Scene, view: View): Promise<void> {
  const drawing = readDwg(bytes, name);
  if (!drawing) return;
  const before = store.session;
  await fresh();
  if (!store.session || store.session === before) return;
  if (readyToImport("DWG")) placeDwg(drawing, bytes, name, scene, view);
}

/** A DWG file's bytes read, or null when they cannot be (and a toast says why). */
function readDwg(bytes: Uint8Array, name: string): DwgDrawing | null {
  try {
    return parseDwg(bytes);
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    fileIn(bytes, name, errorMessage(err));
    return null;
  }
}

function placeDwg(drawing: DwgDrawing, bytes: Uint8Array, name: string, scene: Scene, view: View): void {
  // a sheet with nothing in model space is read from its paper space, and the toast says so
  if (placeDrawing(drawing, name, "Import DWG", scene, view, drawing.space === "paper" ? " from its paper space" : "")) fileIn(bytes, name);
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

/** Imports DXF text (read from `file`) into the active layer; the outcome is shown in the selection and a toast. */
function importDxfText(file: Blob, text: string, name: string, scene: Scene, view: View): void {
  let drawing: DxfDrawing;
  try {
    drawing = parseDxf(text);
  } catch (err) {
    toast(`Could not read ${name}: ${errorMessage(err)}`);
    fileIn(file, name, errorMessage(err));
    return;
  }
  if (placeDrawing(drawing, name, "Import DXF", scene, view, "")) fileIn(file, name);
}

/**
 * Places a read drawing's objects on the active layer as one undo step called `undo`; `from` ends
 * the toast's first words. False when there was nowhere to place them or the step failed.
 */
function placeDrawing(drawing: DxfDrawing, name: string, undo: string, scene: Scene, view: View, from: string): boolean {
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
      const one = (p: DxfPlacement, shape: NewShape, cls: number, attrs: Partial<Attributes>): void => {
        try {
          const id = s.addObject(layerId, shape, cls, attrs);
          if (p.text) {
            // turning or justifying text moves its origin, so it goes back on the anchor after
            s.setTextStyle([id], p.text);
            s.setGeometry(id, shape);
          }
          ids.push(id);
          added(p, 1);
        } catch {
          leftOut(p);
        }
      };
      // each add rebuilds the document, so a run of objects in one class goes in as one add; a run
      // holding an object the document cannot hold goes in one by one to leave out just that one
      let run: { cls: number; items: { p: DxfPlacement; shape: NewShape; attrs: Partial<Attributes> }[] } | null = null;
      const flush = (): void => {
        if (!run) return;
        const { cls, items } = run;
        run = null;
        try {
          ids.push(...s.addObjects(layerId, items.map((it) => it.shape), cls, items.map((it) => it.attrs)));
          for (const it of items) added(it.p, 1);
        } catch {
          for (const it of items) one(it.p, it.shape, cls, it.attrs);
        }
      };
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
        // a fill with holes is one polygon a ring, each joined to the holes inside it
        const shapes: NewShape[] = p.rings ? fillShapes(p.rings).map((f) => ({ kind: "polygon", points: f.points, closed: true })) : [p.shape];
        if (p.text) {
          flush();
          for (const shape of shapes) one(p, shape, cls, attrs);
          continue;
        }
        if (run && run.cls !== cls) flush();
        run ??= { cls, items: [] };
        for (const shape of shapes) run.items.push({ p, shape, attrs });
      }
      flush();
      if (ids.length < 2) return { count: ids.length, hidden: hiddenCount, group: ids[0] ?? null };
      return { count: ids.length, hidden: hiddenCount, group: s.groupObjects(ids) };
    }),
  );
  if (!r) return false;

  const { count, hidden, group } = r.value;
  if (group !== null) {
    setEditGroup(null, [group]);
    zoomToSelection(scene, view);
  }
  const kinds = Object.keys(skipped)
    .filter((k) => skipped[k] > 0)
    .sort();
  const left = kinds.reduce((n, k) => n + skipped[k], 0);
  const shown = hidden > 0 ? ` (${hidden} on layers that are off or frozen, in hidden classes)` : "";
  const head = count === 0 ? `Nothing imported from ${name}${from}` : `Imported ${count} ${count === 1 ? "object" : "objects"}${from}${shown}`;
  toast(left > 0 ? `${head}; skipped ${left} (${kinds.join(", ")})` : head, "info");
  return true;
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
