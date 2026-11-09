// A Revit model as rvt-rs reads it (web/vendor/rvt-rs, Apache-2.0): its levels, elements with their
// geometry, materials and parameters, and a glTF of every element's body as rvt-rs draws it. The
// reader is WebAssembly (9.3 MB), loaded only when a Revit model is imported; in
// the browser it runs in the worker that makes the drawing (app/revitImport.worker.ts), as a big
// model takes many seconds; the checks load it under Node (rvtBuilding.check.ts). Lengths are feet,
// z up, as rvt-rs keeps them; rvtBuilding.ts turns the model into Rodeo's.

/** A parameter value as rvt-rs gives it. */
export interface RvtValue {
  kind: string;
  value: string | number | boolean;
}

export interface RvtPropertySet {
  name: string;
  properties: { name: string; value: RvtValue }[];
}

export type RvtProfile =
  | { Rectangle: { width_feet: number; depth_feet: number } }
  | { Circle: { radius_feet: number } }
  | { ArbitraryClosed: { points: [number, number][] } }
  | Record<string, unknown>;

export interface RvtExtrusion {
  width_feet: number;
  depth_feet: number;
  height_feet: number;
  profile_override?: RvtProfile | null;
}

/** One of rvt-rs's entities; `kind` says which, and only the fields Rodeo reads are typed. */
export interface RvtEntity {
  kind: string;
  ifc_type?: string;
  name?: string;
  type_guid?: string | null;
  predefined_type?: string | null;
  storey_index?: number | null;
  material_index?: number | null;
  material_layer_set_index?: number | null;
  property_set?: RvtPropertySet | null;
  location_feet?: [number, number, number] | null;
  rotation_radians?: number | null;
  extrusion?: RvtExtrusion | null;
  host_element_index?: number | null;
  solid_shape?: unknown;
  representation_map_index?: number | null;
  /** an ElementPropertySet's element and set */
  element?: number;
  set?: RvtPropertySet;
  /** a VoidOpening's, HostedCutOpening's or WallProfileOpening's host, and its host's ElementId */
  host?: number;
  tag?: string;
  outline_feet?: [number, number][];
  depth_feet?: number;
  thickness_feet?: number;
  axis_turn_radians?: number;
  plane_offset_feet?: number;
}

export interface RvtModel {
  project_name?: string | null;
  entities: RvtEntity[];
  building_storeys: { name: string; elevation_feet: number }[];
  materials: { name: string; color_packed?: number | null; transparency?: number | null }[];
  material_layer_sets: { name: string; layers: { material_index: number; thickness_feet: number }[] }[];
}

export interface RvtDiagnostics {
  warnings?: string[];
  skipped?: { reason: string; count: number }[];
  [key: string]: unknown;
}

export interface RvtRead {
  model: RvtModel;
  diagnostics: RvtDiagnostics;
  /** every element's body, a node per element carrying its entity index in `extras` */
  glb: Uint8Array;
}

type Rvt = typeof import("../../vendor/rvt-rs/rvt.js");

/** Reads a Revit model with an initialised rvt-rs. */
export function readWith(rvt: Rvt, bytes: Uint8Array, progress?: (step: string) => void): RvtRead {
  progress?.("Reading the Revit model");
  // every element rvt-rs knows only by its box drawn from the mesh Revit saved for display (Revit 2023
  // to 2027: roofs, stair flights, furniture, mullions and the rest), else that box
  const result = rvt.openRvtBytesWithDiagnosticsModeAndOpenLimits(bytes, "scaffold", { savedMeshes: "all", largeModel: bytes.length > 256 * 1024 * 1024 }) as {
    model: RvtModel;
    diagnostics: RvtDiagnostics;
  };
  progress?.("Building the elements' geometry");
  const glb = rvt.modelToGlb(result.model);
  return { model: result.model, diagnostics: result.diagnostics, glb };
}

/**
 * `read` with the elements rvt-rs could draw in full only by its slow last pass (a spiral railing,
 * an appliance, a door) in place of the boxes it gave them, or null when there are none. `rvt` is
 * the build with that pass (vendor/rvt-rs-detail), which reads the file `bytes` again, so it runs
 * after the drawing is open; a model too large to read twice isn't.
 */
export function readDetailWith(rvt: Rvt, bytes: Uint8Array, read: RvtRead): { read: RvtRead; count: number } | null {
  if (bytes.length > 256 * 1024 * 1024) return null;
  const result = rvt.openRvtBytesWithDiagnosticsModeAndOpenLimits(bytes, "scaffold", { savedMeshes: "all", thirdPass: "only" }) as {
    replaced: { element_id: string; entity: RvtEntity }[];
  };
  const better = new Map(result.replaced.map((r) => [r.element_id, r.entity]));
  let count = 0;
  const entities = read.model.entities.map((e) => {
    // only in place of a box: an element the opening build already drew in full keeps its body
    const boxed = /box/.test(String(e.property_set?.properties.find((p) => p.name === "BodySource")?.value.value ?? ""));
    const b = e.type_guid && boxed ? better.get(e.type_guid) : undefined;
    if (b) count++;
    return b ?? e;
  });
  if (!count) return null;
  const model = { ...read.model, entities };
  return { read: { model, diagnostics: read.diagnostics, glb: rvt.modelToGlb(model) }, count };
}
