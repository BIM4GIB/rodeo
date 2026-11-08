// The 3D solids, regions and bodies of a DWG or DXF drawing, meshed. The walk in dxf.ts gathers each
// one's ACIS data with the transform its inserts place it by (DxfDrawing.solids); here the data is read
// into the B-rep model (acis.ts), written as STEP and meshed by OpenCascade (brepStep.ts), and the
// triangles are placed as meshes like the drawing's other 3D objects. Data that several inserts place
// (one block's solid) is read and meshed once. A solid that gives no triangles is counted as skipped.

import { parseAcis } from "./acis.ts";
import { meshBreps } from "./brepStep.ts";
import { MAX_MESH_FACES, placeFlat, type DxfDrawing, type DxfMesh } from "./dxf.ts";
import type { Occt } from "./occt.ts";

/** How long meshing runs before it lets the page draw (and a progress bar move), in milliseconds. */
const SLICE_MS = 50;

/**
 * The drawing with its solids, regions and bodies as meshes, and none left in `solids`. `occt` loads
 * OpenCascade, and is called only when there are solids; `progress` hears the share done, 0 to 1.
 */
export async function meshSolids<T extends DxfDrawing>(d: T, occt: () => Promise<Occt>, progress: (fraction: number) => void = () => {}): Promise<T> {
  if (d.solids.length === 0) return d;
  const lib = await occt();
  const meshes: DxfMesh[] = [...d.meshes];
  const skipped: Record<string, number> = { ...d.skipped };
  let faces = meshes.reduce((n, m) => n + m.faces.length, 0);
  const meshed = new Map<Uint8Array, Float32Array | null>();
  let slice = performance.now();
  for (const [i, solid] of d.solids.entries()) {
    let triangles = meshed.get(solid.data);
    if (triangles === undefined) {
      triangles = meshOne(lib, solid.data);
      meshed.set(solid.data, triangles);
    }
    const count = triangles ? triangles.length / 9 : 0;
    if (!triangles || count === 0 || faces + count > MAX_MESH_FACES) {
      skipped[solid.type] = (skipped[solid.type] ?? 0) + 1;
    } else {
      faces += count;
      meshes.push({ type: solid.type, layer: solid.layer, style: solid.style, faces: placed(triangles, solid.m3) });
    }
    if (performance.now() - slice > SLICE_MS) {
      progress((i + 1) / d.solids.length);
      await new Promise((resolve) => setTimeout(resolve));
      slice = performance.now();
    }
  }
  return { ...d, meshes, skipped, solids: [] };
}

/** One solid's triangles, or null when its data does not read or mesh. */
function meshOne(occt: Occt, data: Uint8Array): Float32Array | null {
  try {
    return meshBreps(occt, [parseAcis(data)])[0];
  } catch {
    return null;
  }
}

/** The triangles as faces moved by the transform; a mirroring one turns each round, so they still face out. */
function placed(triangles: Float32Array, m: readonly number[]): number[][] {
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  const out: number[][] = [];
  for (let k = 0; k < triangles.length; k += 9) {
    const f = placeFlat(m, triangles.subarray(k, k + 9));
    out.push(det < 0 ? [...f.slice(0, 3), ...f.slice(6, 9), ...f.slice(3, 6)] : f);
  }
  return out;
}
