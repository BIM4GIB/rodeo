// Where the converter's WebAssembly readers come from: web-ifc (IFC), rhino3dm (Rhino), OpenCascade (STEP
// and IGES), cadmpeg (SolidWorks, Inventor, FreeCAD, Fusion 360, NX and Creo parts) and rvt-rs (Revit) load
// differently in Node (node.ts) and in a page's worker (page/worker.ts), so whichever runs the converter
// hands its loaders over once with useLibraries.

import type { IfcReader } from "../import/ifc.ts";
import type { CadConvert } from "../import/native.ts";
import type { Occt } from "../import/occt.ts";
import type { Rhino } from "../import/rhino.ts";
import type { XtMesher } from "../core/parasolid.ts";

/** rvt-rs's module, initialised. */
export type RvtModule = typeof import("../../vendor/rvt-rs/rvt.js");

/** Loaders for the WebAssembly readers, each loading once and handing back the same thing after. */
export interface Libraries {
  ifc(): Promise<IfcReader>;
  rhino(): Promise<Rhino>;
  occt(): Promise<Occt>;
  /** converts a CAD part with its format's reader: in Node directly, in a page through a worker */
  convertCad: CadConvert;
  revit(): Promise<RvtModule>;
  /** cadmpeg, which meshes the Parasolid data of solids whose edges don't make their faces; absent where it can't run */
  xt?(): Promise<XtMesher>;
}

let current: Libraries | null = null;

/** Sets where the WebAssembly readers come from. */
export function useLibraries(libraries: Libraries): void {
  current = libraries;
}

/** The loaders set with useLibraries; throws when none were. */
export function libraries(): Libraries {
  if (!current) throw new Error("the converter's readers aren't set up: import convert/node.ts in Node, or call useLibraries in a page");
  return current;
}
