// OpenCascade, through occt-import-js (OpenCascade compiled to WebAssembly, LGPL-2.1), which reads STEP and
// IGES files into triangles for import/step.ts. Its script and WebAssembly (7.6 MB) load only when such a
// file is first read, once. occtLib() is that loader for the editor and the converter's page; loadOcct
// takes where the WebAssembly is, or finds it beside the script when none is given (Node, and the bundled
// command line, which copies it there).

/** The triangulation settings: the units the output comes in, and how far a triangle may stray from its surface. */
export interface OcctParams {
  linearUnit: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
  /** "bounding_box_ratio": linearDeflection is a fraction of the shape's average bounding box */
  linearDeflectionType: "bounding_box_ratio" | "absolute_value";
  linearDeflection: number;
  /** the most an angle between a triangle and its surface may be, in radians */
  angularDeflection: number;
}

/** A brep face's triangles, from `first` to `last` (indices into its mesh's triangles, both included), and its colour (0..1) where the file gives one. */
export interface OcctFace {
  first: number;
  last: number;
  color: [number, number, number] | null;
}

/** A mesh: one shape's triangles, with its name, its colour (0..1) where the file gives one, and its brep faces. */
export interface OcctMesh {
  name: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  /** three vertex indices per triangle */
  index: { array: number[] };
  brep_faces: OcctFace[];
}

/** A node of the file's assembly: its own meshes (indices into the result's `meshes`) and the nodes under it. */
export interface OcctNode {
  name: string;
  meshes: number[];
  children: OcctNode[];
}

/** One read: whether it succeeded, the assembly's root and every mesh in it. */
export interface OcctResult {
  success: boolean;
  root: OcctNode;
  meshes: OcctMesh[];
}

/** The reading functions of occt-import-js: each takes a file's bytes and its settings (null for the defaults). */
export interface Occt {
  ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
}

/**
 * occt-import-js, initialised; `wasm` is where its WebAssembly file is (a URL or a path), else the one beside its
 * script. Its "entities loaded" lines are left out; what it cannot read it reports on the console.
 */
export async function loadOcct(wasm?: string): Promise<Occt> {
  const { default: factory } = await import("occt-import-js");
  return (await factory({ print: () => {}, ...(wasm === undefined ? {} : { locateFile: () => wasm }) })) as Occt;
}

let loading: Promise<Occt> | null = null;

/** occt-import-js, loaded and initialised once, its WebAssembly beside the editor's bundle; a failed load is tried again next time. */
export function occtLib(): Promise<Occt> {
  loading ??= loadOcct(new URL("../../node_modules/occt-import-js/dist/occt-import-js.wasm", import.meta.url).href).catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
