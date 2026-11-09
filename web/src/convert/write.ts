// Writes a drawing read by readAny in any format Rodeo writes (writeAs): the layers chosen, or the
// layers the format draws by default, then the writer's bytes and what the writer left out. Each 3D
// writer loads on first use, so a page's worker fetches only what the format needs. No DOM.

import { exportDxf } from "../export/dxf.ts";
import { pageEmf } from "../export/emf.ts";
import { pageEps } from "../export/eps.ts";
import { layersPage, exportPdf, paperScale } from "../export/pdf.ts";
import { exportSvg } from "../export/svg.ts";
import type { VwxDocument } from "../core/types.ts";
import { cancelXt, drainXt, waitingXt } from "../core/parasolid.ts";
import { formatById, formats, outputFormat } from "./formats.ts";
import { libraries } from "./libs.ts";
import type { HeadlessDrawing, WrittenFile, WriteOptions } from "./types.ts";

const ENCODER = new TextEncoder();

/** A file of `format` made from `drawing`: the bytes, the name (base name and extension), the mime type and the notes. */
export async function writeAs(drawing: HeadlessDrawing, format: string, options: WriteOptions = {}): Promise<WrittenFile> {
  const id = outputFormat(format);
  const info = id ? formatById(id) : undefined;
  if (!id || !info) throw new Error(`Rodeo doesn't write ${format} (it writes ${formats().write.join(", ")})`);

  const base = (options.baseName ?? drawing.name.replace(/\.[^.]+$/, "")).replace(/[\\/:*?"<>|]+/g, "-") || "drawing";
  const name = `${base}.${info.writeExtensions[0]}`;
  const doc = drawing.session.doc;
  const ids = options.layers ? resolveLayers(doc, options.layers) : undefined;
  const notes: string[] = [];
  const bytes = await writeBytes(id, drawing, ids, options, base, name, notes);
  return { bytes, name, mime: info.mime, notes };
}

/** The layers the keys name: by id, then name, then sheet title, then name ignoring case. Throws for one that isn't a layer. */
function resolveLayers(doc: VwxDocument, keys: readonly string[]): string[] {
  const layers = doc.layers();
  return keys.map((key) => {
    const hit =
      layers.find((l) => l.id === key) ??
      layers.find((l) => l.name === key) ??
      layers.find((l) => l.title !== "" && l.title === key) ??
      layers.find((l) => l.name.toLowerCase() === key.toLowerCase());
    if (!hit) throw new Error(`no layer is called "${key}" (the layers are ${layers.map((l) => l.name).join(", ")})`);
    return hit.id;
  });
}

/** The design layers not hidden, or every design layer when none is shown: what a format draws by default. */
function designShown(doc: VwxDocument): string[] {
  const design = doc.layers().filter((l) => l.kind === "design");
  const shown = design.filter((l) => l.visibility !== "hidden");
  return (shown.length ? shown : design).map((l) => l.id);
}

/** Pluralises a count of things for a note: "1 image", "2 images". */
function counted(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

/** The bytes of the format `id`; `ids` are the layers chosen (undefined for the default); notes gets what was left out. */
async function writeBytes(
  id: string,
  drawing: HeadlessDrawing,
  ids: string[] | undefined,
  options: WriteOptions,
  base: string,
  name: string,
  notes: string[],
): Promise<Uint8Array> {
  const doc = drawing.session.doc;
  switch (id) {
    case "vwx":
      return doc.toBytes();
    case "pdf":
      return exportPdf(doc, ids ? { layerIds: ids } : {});
    case "svg":
      return ENCODER.encode(exportSvg(doc, ids ?? designShown(doc)));
    case "dxf": {
      const fromCad = drawing.from === "dwg" || drawing.from === "dxf";
      const layersFrom = options.dxfLayers ?? (fromCad ? "classes" : "layers");
      return ENCODER.encode(exportDxf(doc, { layerIds: ids, layersFrom }));
    }
    case "eps":
    case "emf": {
      // a page at the scale of the first layer, as Export EPSF takes it
      const shown = ids ?? designShown(doc);
      const first = doc.layers().find((l) => l.id === shown[0]);
      const page = layersPage(doc, shown, first ? paperScale(first) : 1);
      if (!page) throw new Error("nothing is drawn on the layers chosen");
      if (id === "eps") {
        const eps = pageEps(page, base);
        if (eps.imagesLeftOut > 0) notes.push(`${counted(eps.imagesLeftOut, "image")} left out`);
        return ENCODER.encode(eps.text);
      }
      const emf = pageEmf(page, base);
      if (emf.imagesLeftOut > 0) notes.push(`${counted(emf.imagesLeftOut, "image")} left out`);
      return emf.bytes;
    }
    default:
      return model3dBytes(id, drawing, ids ?? designShown(doc), name, base, notes);
  }
}

/**
 * Gives the solids whose edges don't make their faces the faces of their Parasolid data, where the
 * reader has cadmpeg (the command line and a page's converter do). Without it they keep the faces
 * their edges make, and notes says how many.
 */
async function parasolidFaces(doc: VwxDocument, notes: string[]): Promise<void> {
  // building the 3D is what finds the solids waiting
  doc.model3d();
  const waiting = waitingXt();
  if (!waiting) return;
  const solids = (n: number): string => `${n} ${n === 1 ? "solid shows" : "solids show"} the faces their edges make`;
  const load = libraries().xt;
  if (!load) {
    cancelXt();
    notes.push(`${solids(waiting)}: the Parasolid reader is not available`);
    return;
  }
  try {
    drainXt(await load());
  } catch (err) {
    // cadmpeg failed to load, or trapped on a body and can't go on: the bodies not yet meshed keep their edges' faces
    const left = waitingXt() || waiting;
    cancelXt();
    notes.push(`${solids(left)}: the Parasolid reader stopped (${err instanceof Error ? err.message : String(err)})`);
  }
}

/** The bytes of a 3D format's file, from the model on the layers `layers`; notes gets what was left out. */
async function model3dBytes(id: string, drawing: HeadlessDrawing, layers: readonly string[], name: string, base: string, notes: string[]): Promise<Uint8Array> {
  const doc = drawing.session.doc;
  const set = new Set(layers);
  const scene3d = await import("../export/scene3d.ts");
  await parasolidFaces(doc, notes);
  // 2D linework goes to a Rhino file as curves; every other 3D format needs a solid or a mesh
  const flat = id === "3dm" ? scene3d.flatOf(doc, set) : [];
  const has3d = doc.model3d().some((m) => set.has(m.layerId) && m.triangles.length >= 9);
  if (!has3d && flat.length === 0) throw new Error("there are no 3D objects on the design layers chosen");

  switch (id) {
    case "ifc": {
      const { exportIfc } = await import("../export/ifc.ts");
      return ENCODER.encode(exportIfc(doc, set, name));
    }
    case "glb": {
      const { exportGlb } = await import("../export/model3d.ts");
      return new Uint8Array(await exportGlb(doc, set));
    }
    case "obj": {
      const { exportObj } = await import("../export/model3d.ts");
      return ENCODER.encode(exportObj(doc, set));
    }
    case "stl": {
      const { exportStlBinary, stlMeshes } = await import("../export/stl.ts");
      return exportStlBinary(stlMeshes(doc, set));
    }
    case "ply": {
      const { exportPly } = await import("../export/ply.ts");
      return exportPly(scene3d.modelOf(doc, set));
    }
    case "3ds": {
      const { export3ds } = await import("../export/threeds.ts");
      return export3ds(doc, set);
    }
    case "fbx": {
      const { exportFbx } = await import("../export/fbx.ts");
      return exportFbx(scene3d.modelOf(doc, set, true));
    }
    case "dae": {
      const { exportCollada } = await import("../export/collada.ts");
      return ENCODER.encode(exportCollada(scene3d.modelOf(doc, set, true)));
    }
    case "3dm": {
      const { export3dm } = await import("../export/rhino.ts");
      const layerNames = new Map(doc.layers().map((l): [string, string] => [l.id, l.name]));
      return export3dm(scene3d.modelOf(doc, set, true), flat, layerNames, await libraries().rhino());
    }
    case "skp": {
      const { exportSkp } = await import("../export/skp.ts");
      const skp = exportSkp(doc, set);
      if (skp.texturesLeftOut > 0) notes.push(`${counted(skp.texturesLeftOut, "texture")} written as colour`);
      return skp.bytes;
    }
    case "step": {
      const { exportStep } = await import("../export/step.ts");
      return ENCODER.encode(exportStep(scene3d.modelOf(doc, set), false, name).text);
    }
    case "iges": {
      const { exportIges } = await import("../export/iges.ts");
      return ENCODER.encode(exportIges(scene3d.modelOf(doc, set), false, name).text);
    }
    case "usdz": {
      const { usdScene, usdzPackage } = await import("../export/usd.ts");
      const scene = usdScene(doc, doc.model3d().filter((m) => set.has(m.layerId)), { organization: "layer", combine: false, records: true, textures: true }, base);
      if (scene.texturesLeftOut > 0) notes.push(`${counted(scene.texturesLeftOut, "texture")} written as colour`);
      const files: (readonly [string, Uint8Array])[] = [[`${base}.usda`, ENCODER.encode(scene.text)], ...scene.files];
      return usdzPackage(files);
    }
    default:
      throw new Error(`Rodeo doesn't write ${id}`);
  }
}
