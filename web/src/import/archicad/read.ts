// An Archicad 17+ file read whole. The objects of every class a decoder reads are gathered in one
// walk of the file (objects.ts), then each decoder reads its own: stories and attributes
// (attributes.ts), walls, slabs, roofs, meshes, morphs and shells (construction.ts), beams,
// columns, curtain walls, stairs and railings (structure.ts), floor plan and view drafting and
// zones (drafting.ts), and doors, windows, skylights, objects and lamps with their GDL parameters
// (libparts.ts). building.ts makes a building model of the result. The library parts' packed GDL
// files and the views' generated drawings (geometry.ts) aren't gathered: they run to hundreds of
// megabytes and the model doesn't use them yet.

import type { ReadRange } from "../pln.ts";
import { ATTRIBUTE_CLASSES, readAttributes, type ArchicadAttributes } from "./attributes.ts";
import { CONSTRUCTION_CLASSES, readConstruction, type Construction } from "./construction.ts";
import { DRAFTING_CLASSES, readDrafting, type Drafting } from "./drafting.ts";
import { LIBPART_CLASSES, readLibParts, type LibParts } from "./libparts.ts";
import { readObjects, type ObjectsByClass } from "./objects.ts";
import { STRUCTURE_CLASSES, readStructure, type Structure } from "./structure.ts";

/** Every class a decoder reads. */
export const ARCHICAD_CLASSES: ReadonlySet<string> = new Set([...ATTRIBUTE_CLASSES, ...CONSTRUCTION_CLASSES, ...STRUCTURE_CLASSES, ...DRAFTING_CLASSES, ...LIBPART_CLASSES]);

/** What the decoders read of a file. */
export interface ArchicadRead {
  readonly attributes: ArchicadAttributes;
  readonly construction: Construction;
  readonly structure: Structure;
  readonly drafting: Drafting;
  readonly libparts: LibParts;
}

/** Each decoder's reading of the gathered objects; `step` hears each one start. */
export function decodeArchicad(objects: ObjectsByClass, step?: (what: string) => void): ArchicadRead {
  step?.("Reading the stories and attributes");
  const attributes = readAttributes(objects);
  step?.("Reading the walls, slabs and roofs");
  const construction = readConstruction(objects);
  step?.("Reading the beams, columns and curtain walls");
  const structure = readStructure(objects);
  step?.("Reading the doors, windows and objects");
  const libparts = readLibParts(objects);
  step?.("Reading the drafting");
  const drafting = readDrafting(objects);
  return { attributes, construction, structure, drafting, libparts };
}

/** Reads a file of `size` bytes by ranges; `progress` hears how far the walk is (0..1), `step` each decoder. */
export async function readArchicad(read: ReadRange, size: number, progress?: (fraction: number) => void, step?: (what: string) => void): Promise<ArchicadRead> {
  const objects = await readObjects(read, size, ARCHICAD_CLASSES, progress);
  return decodeArchicad(objects, step);
}
