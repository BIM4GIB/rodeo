// IFC import, the reading side: a building model's elements as mesh parts, read with web-ifc
// (MPL-2.0; its script and WebAssembly load only when a file is imported). Each element with
// geometry becomes a part, split by colour where its pieces differ, named as the element (or its
// IFC class when it has none) and tagged with the building storey that holds it, directly, through
// the element it is a part of, or through a space. web-ifc places the geometry in metres, y up.
// Spaces are left out and counted; openings are voids already cut from what they open. It reads
// what export/ifc.ts writes.

import type { IfcAPI } from "web-ifc";
import { MAX_FACES, type MeshFile, type MeshPart } from "./mesh.ts";

type WebIfc = typeof import("web-ifc");

/** web-ifc's module and an IfcAPI it has initialised. */
export interface IfcReader {
  lib: WebIfc;
  api: IfcAPI;
}

let loading: Promise<IfcReader> | null = null;

/** web-ifc, loaded and initialised once; a failed load is tried again next time. */
export function ifcReader(): Promise<IfcReader> {
  loading ??= (async () => {
    const lib = await import("web-ifc");
    const api = new lib.IfcAPI();
    const wasm = new URL("../../node_modules/web-ifc/web-ifc.wasm", import.meta.url).href;
    // one thread: the page isn't cross-origin isolated, and a model is read once
    await api.Init(() => wasm, true);
    return { lib, api };
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** A STEP reference's line id, or null. */
function ref(v: unknown): number | null {
  const id = (v as { value?: unknown } | null)?.value;
  return typeof id === "number" ? id : null;
}

function text(v: unknown): string {
  const s = (v as { value?: unknown } | null)?.value;
  return typeof s === "string" ? s.trim() : "";
}

/** True for a triangle without area (or with a corner that isn't a number), which a mesh can't hold. */
function flat(f: readonly number[]): boolean {
  if (!f.every(Number.isFinite)) return true;
  const u = [f[3] - f[0], f[4] - f[1], f[5] - f[2]];
  const v = [f[6] - f[0], f[7] - f[1], f[8] - f[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) === 0;
}

/** The IFC file's elements as parts, in metres and y up as web-ifc places them. */
export function parseIfc(bytes: Uint8Array, { lib, api }: IfcReader): MeshFile {
  // a STEP file, as IFC is, opens with its standard's number (after a byte order mark, maybe)
  if (!/^(\uFEFF)?\s*ISO-10303-21;/.test(new TextDecoder().decode(bytes.subarray(0, 64)))) {
    throw new Error(/^PK/.test(String.fromCharCode(...bytes.subarray(0, 2))) ? "it is compressed (.ifczip); unzip it first" : "it isn't an IFC file");
  }
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  try {
    if (!/^IFC/i.test(api.GetModelSchema(model) ?? "") || api.GetLineIDsWithType(model, lib.IFCPROJECT).size() === 0) {
      throw new Error("it isn't an IFC file");
    }
    const ids = (type: number): number[] => {
      const v = api.GetLineIDsWithType(model, type);
      const out: number[] = [];
      for (let i = 0; i < v.size(); i++) out.push(v.get(i));
      return out;
    };
    // what holds what: an element's spatial container, and a part's whole
    const container = new Map<number, number>();
    for (const id of ids(lib.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = api.GetLine(model, id);
      const at = ref(rel.RelatingStructure);
      if (at === null) continue;
      for (const e of rel.RelatedElements ?? []) {
        const k = ref(e);
        if (k !== null) container.set(k, at);
      }
    }
    const whole = new Map<number, number>();
    for (const id of ids(lib.IFCRELAGGREGATES)) {
      const rel = api.GetLine(model, id);
      const at = ref(rel.RelatingObject);
      if (at === null) continue;
      for (const e of rel.RelatedObjects ?? []) {
        const k = ref(e);
        if (k !== null) whole.set(k, at);
      }
    }
    const storeys = new Map<number, string>();
    for (const id of ids(lib.IFCBUILDINGSTOREY)) storeys.set(id, text(api.GetLine(model, id).Name) || `Storey ${storeys.size + 1}`);
    const storeyOf = (id: number): string | undefined => {
      const seen = new Set<number>();
      for (let at: number | undefined = id; at !== undefined && !seen.has(at); at = container.get(at) ?? whole.get(at)) {
        seen.add(at);
        const name = storeys.get(at);
        if (name !== undefined) return name;
      }
      return undefined;
    };

    const parts: MeshPart[] = [];
    let faces = 0;
    let over = false;
    api.StreamAllMeshes(model, (mesh) => {
      if (over) return;
      const line = api.GetLine(model, mesh.expressID);
      const name = text(line?.Name) || api.GetNameFromTypeCode(api.GetLineType(model, mesh.expressID));
      const group = storeyOf(mesh.expressID);
      const byColour = new Map<string, MeshPart>();
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size() && !over; i++) {
        const pg = placed.get(i);
        const geo = api.GetGeometry(model, pg.geometryExpressID);
        try {
          const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
          const index = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
          if (index.length < 3) continue;
          if (faces + index.length / 3 > MAX_FACES) {
            over = true;
            break;
          }
          const c = pg.color;
          const key = [c.x, c.y, c.z].map((n) => Math.round(n * 255)).join(",");
          let part = byColour.get(key);
          if (!part) {
            part = { name, faces: [], color: { r: c.x, g: c.y, b: c.z }, ...(group !== undefined ? { group } : {}) };
            byColour.set(key, part);
            parts.push(part);
          }
          // column-major 4×4, vertices x, y, z then the normal
          const m = pg.flatTransformation;
          const at = (k: number, out: number[]): void => {
            const x = v[6 * k];
            const y = v[6 * k + 1];
            const z = v[6 * k + 2];
            out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          };
          for (let t = 0; t + 2 < index.length; t += 3) {
            const f: number[] = [];
            at(index[t], f);
            at(index[t + 1], f);
            at(index[t + 2], f);
            if (!flat(f)) part.faces.push(f);
          }
          faces += Math.floor(index.length / 3);
        } finally {
          geo.delete();
        }
      }
    });
    // storey by storey as the file lists them (web-ifc streams by kind), then the rest; a part
    // whose triangles were all slivers goes
    const rank = new Map([...storeys.values()].map((name, i) => [name, i]));
    const kept = parts.filter((p) => p.faces.length).sort((a, b) => (rank.get(a.group ?? "") ?? rank.size) - (rank.get(b.group ?? "") ?? rank.size));
    if (over) throw new Error(`it has more than ${MAX_FACES.toLocaleString("en")} faces, more than can come in at once`);
    const skipped: Record<string, number> = {};
    const spaces = ids(lib.IFCSPACE).length;
    if (spaces) skipped.space = spaces;
    return { parts: kept, skipped };
  } finally {
    api.CloseModel(model);
  }
}
