// An Archicad project made into a Rodeo drawing: the file read by ranges and decoded
// (import/archicad/read.ts), turned into a building model (import/archicad/building.ts) and written
// into a blank millimetre drawing (buildingWrite.ts), handed back as a .vwx file's bytes. Drafting
// in views that aren't a story's plan goes on a layer per view after that: a hidden design layer
// for each detail, worksheet, section and elevation, a sheet layer for each layout. No DOM,
// so the worker that runs a whole import off the page (archicadImport.worker.ts, started by
// plnImport.ts) and the checks share it.

import { blankDrawing } from "../core/blank.ts";
import { openVwx, type EditSession } from "../core/index.ts";
import { archicadBuilding, type ArchicadView, type PaletteOf } from "../import/archicad/building.ts";
import { readArchicad } from "../import/archicad/read.ts";
import { isRof, type ReadRange } from "../import/pln.ts";
import { type BuildingWritten, writeBuilding } from "./buildingWrite.ts";

export interface ArchicadDrawing {
  /** the drawing, as a .vwx file */
  bytes: Uint8Array;
  /** the project's name */
  name: string;
  written: BuildingWritten;
  /** what was left out, by kind, with how many */
  skipped: Record<string, number>;
  /** what was approximated */
  notes: string[];
}

/** What the worker is sent and answers. */
export type ArchicadRequest = { file: Blob; name: string };
export type ArchicadReply = { type: "progress"; step: string } | { type: "done"; drawing: ArchicadDrawing } | { type: "error"; message: string };

/** The drawing of the Archicad file `fileName` of `size` bytes, read by `read`; `progress` hears each step. */
export async function archicadDrawing(read: ReadRange, size: number, fileName: string, progress?: (step: string) => void): Promise<ArchicadDrawing> {
  if (!isRof(await read(0, 8))) throw new Error("it isn't an Archicad 17 or later file");
  let shown = -1;
  const r = await readArchicad(
    read,
    size,
    (fraction) => {
      const percent = Math.floor(fraction * 100);
      if (percent !== shown) progress?.(`Reading the project (${(shown = percent)}%)`);
    },
    progress,
  );
  progress?.("Sorting the elements");
  const s = openVwx(blankDrawing("mm"));
  const model = archicadBuilding(r, fileName, paletteOf(s));
  const written = writeBuilding(s, model, progress);
  if (model.views.length) {
    progress?.("Drawing the views");
    written.drawing += writeViews(s, model.views, model.categories, written.failed);
  }
  progress?.("Saving the drawing");
  return { bytes: s.doc.toBytes(), name: model.name, written, skipped: model.skipped, notes: model.notes };
}

/** Each view's drafting on a layer of its own, in its categories' classes, as one change; how many objects were made. */
function writeViews(s: EditSession, views: readonly ArchicadView[], categories: readonly { name: string }[], failed: Record<string, number>): number {
  const classes = new Map(s.doc.classes().map((c) => [c.name, c.index]));
  const taken = new Set(s.doc.layers().map((l) => l.name));
  const scale = s.doc.layers().find((l) => l.kind === "design")?.scale ?? 100;
  let made = 0;
  s.batch(() => {
    for (const view of views) {
      let name = view.name;
      for (let n = 2; taken.has(name); n++) name = `${view.name} (${n})`;
      taken.add(name);
      const layer = s.createLayer(name, view.sheet ? "sheet" : "design", view.sheet ? 1 : scale);
      // the model stays in view; a detail or section is there to turn on
      if (!view.sheet) s.setLayerVisibility(layer, "hidden");
      const byCategory = new Map<number, ArchicadView["items"]>();
      for (const item of view.items) (byCategory.get(item.category) ?? byCategory.set(item.category, []).get(item.category)!).push(item);
      for (const [category, items] of byCategory) {
        const cls = classes.get(categories[category]?.name ?? "");
        try {
          made += s.addObjects(
            layer,
            items.map((i) => i.shape),
            cls,
            items.map((i) => i.attrs),
          ).length;
        } catch {
          for (const i of items) {
            try {
              s.addObject(layer, i.shape, cls, i.attrs);
              made++;
            } catch {
              failed["2D objects"] = (failed["2D objects"] ?? 0) + 1;
            }
          }
        }
      }
    }
  });
  return made;
}

/** The drawing's palette colour nearest each colour asked for (0..255 channels). */
function paletteOf(s: EditSession): PaletteOf {
  const palette = s.doc
    .colors()
    .map((c) => {
      const m = /^#([0-9a-f]{6})/i.exec(c.css);
      return m ? { index: c.index, r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null;
    })
    .filter((c) => c !== null);
  const seen = new Map<number, number>();
  return (c) => {
    const key = (c.r << 16) | (c.g << 8) | c.b;
    let best = seen.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 0;
      for (const p of palette) {
        const e = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
        if (e < d) [d, best] = [e, p.index];
      }
      seen.set(key, best);
    }
    return best;
  };
}
