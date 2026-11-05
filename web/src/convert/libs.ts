// Where the converter's WebAssembly readers come from: web-ifc (IFC), rhino3dm (Rhino) and rvt-rs
// (Revit) load differently in Node (node.ts) and in a page's worker (page/worker.ts), so whichever
// runs the converter hands its loaders over once with useLibraries.

import type { IfcReader } from "../import/ifc.ts";
import type { Rhino } from "../import/rhino.ts";

/** rvt-rs's module, initialised. */
export type RvtModule = typeof import("../../vendor/rvt-rs/rvt.js");

/** Loaders for the WebAssembly readers, each loading once and handing back the same thing after. */
export interface Libraries {
  ifc(): Promise<IfcReader>;
  rhino(): Promise<Rhino>;
  revit(): Promise<RvtModule>;
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
