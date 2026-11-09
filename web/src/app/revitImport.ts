// A Revit model made into a Rodeo drawing: what rvt-rs reads (import/rvtModel.ts) turned into a
// building model (import/rvtBuilding.ts) and written into a blank drawing in the project's units
// (buildingWrite.ts), handed back as a .vwx file's bytes. No DOM, so the worker that runs a whole
// import off the page (revitImport.worker.ts, started by revitFile.ts) and the checks share it.

import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import { revitBuilding } from "../import/rvtBuilding.ts";
import type { RvtRead } from "../import/rvtModel.ts";
import { type BuildingWritten, writeBuilding } from "./buildingWrite.ts";

export interface RevitDrawing {
  /** the drawing, as a .vwx file */
  bytes: Uint8Array;
  /** the project's name, or the file's */
  name: string;
  units: "mm" | "ftin";
  written: BuildingWritten;
  /** what was left out, by kind, with how many */
  skipped: Record<string, number>;
  /** what was approximated */
  notes: string[];
}

/** What the worker is sent and answers. */
export type RevitRequest = { bytes: Uint8Array; name: string };
export type RevitReply =
  | { type: "progress"; step: string }
  | { type: "done"; drawing: RevitDrawing }
  /** after "done": the drawing again with `count` more elements drawn in full, or null when none were */
  | { type: "detail"; drawing: RevitDrawing | null; count: number }
  | { type: "error"; message: string };

/** The drawing of the Revit model `read` from the file `fileName`; `progress` hears each step. */
export function revitDrawing(read: RvtRead, fileName: string, progress?: (step: string) => void): RevitDrawing {
  progress?.("Sorting the elements");
  const model = revitBuilding(read, fileName);
  const s = openVwx(blankDrawing(model.units));
  const written = writeBuilding(s, model, progress);
  progress?.("Saving the drawing");
  return { bytes: s.doc.toBytes(), name: model.name, units: model.units, written, skipped: model.skipped, notes: model.notes };
}
