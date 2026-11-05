// The converter's shared types: a drawing read without the editor, what a read and a write take,
// a written file, a format, and the summary describe() gives. The command line (cli.ts), the
// converter page (page/) and the MCP server's headless mode all speak these.

import type { EditSession } from "../core/index.ts";

/** The units a file that doesn't say its own (OBJ, STL, PLY, 3DS) is read in. */
export type Unit = "mm" | "cm" | "m" | "in" | "ft";

/** A drawing read without the editor. */
export interface HeadlessDrawing {
  /** the drawing: the writers read session.doc, and a caller may edit through it */
  readonly session: EditSession;
  /** the name of the file it was read from */
  readonly name: string;
  /** the format it was read as, a formats().read id ("vwx", "dwg", "rvt"…) */
  readonly from: string;
  /** what the reader left out, by kind, with how many */
  readonly skipped: Readonly<Record<string, number>>;
  /** what was approximated or is worth knowing, plain sentences without a full stop */
  readonly notes: readonly string[];
}

export interface ReadOptions {
  /** OBJ, STL, PLY, 3DS: the file's units; default m, mm for STL */
  readonly units?: Unit;
  /** OBJ, STL, PLY, 3DS: whether y is up; default true for OBJ, false for the others */
  readonly yUp?: boolean;
  /** PDF: the page, 1-based; default 1 */
  readonly page?: number;
  /** PDF and EMF: placed at 1:scale; default 1 */
  readonly scale?: number;
  /** hears each step of a long read ("Loading the Revit reader") */
  readonly progress?: (step: string) => void;
}

export interface WriteOptions {
  /** the layers to write, each by id, name or sheet title; default as the format chooses */
  readonly layers?: readonly string[];
  /** DXF: what becomes a DXF layer; default "classes" for a drawing read from DWG or DXF, else "layers" */
  readonly dxfLayers?: "layers" | "classes";
  /** the written file's name without its extension; default the input's */
  readonly baseName?: string;
}

/** A file writeAs made. */
export interface WrittenFile {
  readonly bytes: Uint8Array;
  /** base name and extension, no folder */
  readonly name: string;
  readonly mime: string;
  /** what the writer left out or approximated, plain sentences without a full stop */
  readonly notes: readonly string[];
}

/** A format the converter knows. */
export interface FormatInfo {
  /** "ifc", "glb", "step": what readAny reports, writeAs and --to take */
  readonly id: string;
  /** short display name: "IFC", "glTF", "STEP" */
  readonly name: string;
  /** a longer one: "IFC (BIM)", "glTF binary" */
  readonly long: string;
  /** extensions it is read from, without the dot; empty when it isn't read */
  readonly readExtensions: readonly string[];
  /** extensions it is written as, the first the default; empty when it isn't written */
  readonly writeExtensions: readonly string[];
  /** what a writer takes: the whole drawing, its 2D drawing, or its 3D model */
  readonly kind: "drawing" | "2d" | "3d";
  readonly mime: string;
}

export interface LayerSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: "design" | "sheet";
  readonly visible: boolean;
  /** 100 for 1:100 */
  readonly scale: number;
  readonly objects: number;
}

/** What describe() says of a drawing. Lengths are millimetres. */
export interface DrawingSummary {
  readonly name: string;
  readonly from: string;
  /** the from format's display name ("Revit") */
  readonly fromName: string;
  /** as the drawing names its units ("Millimeters", "Feet & Inches") */
  readonly units: string;
  readonly layers: readonly LayerSummary[];
  readonly classes: number;
  readonly symbols: number;
  /** objects by type name, most first; groups are counted through, not as objects */
  readonly objects: Readonly<Record<string, number>>;
  readonly totalObjects: number;
  /** the plan extent of the design layers' objects, or null */
  readonly bounds2d: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  /** the 3D model's extent, or null when it has none */
  readonly bounds3d: { readonly x0: number; readonly y0: number; readonly z0: number; readonly x1: number; readonly y1: number; readonly z1: number } | null;
  readonly triangles: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}
