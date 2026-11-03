// STL, the 3D printing format, as Vectorworks' Export STL writes it: the shaded triangles of the 3D
// model (the meshes the 3D view shows), in millimetres and z up as the drawing holds them, binary
// (an 80-byte header, a count and 50 bytes a triangle) or ASCII text (one solid, a facet a
// triangle). STL keeps no units, colours or names; slicers and most readers take millimetres.
// Triangles squashed to a line or a point are left out.

import type { Mesh3D, VwxDocument } from "../core/types.ts";

/** The meshes of `layerIds` with faces, in model order; only those of `objectIds` when given. */
export function stlMeshes(doc: VwxDocument, layerIds: ReadonlySet<string>, objectIds?: ReadonlySet<string>): Mesh3D[] {
  return doc.model3d().filter((m) => layerIds.has(m.layerId) && m.triangles.length >= 9 && (!objectIds || objectIds.has(m.objectId)));
}

/** Each triangle with area, as its unit normal and three corners. */
function* facets(meshes: readonly Mesh3D[]): Generator<[number, number, number, Float32Array, number]> {
  for (const m of meshes) {
    const t = m.triangles;
    for (let i = 0; i + 9 <= t.length; i += 9) {
      const ux = t[i + 3] - t[i];
      const uy = t[i + 4] - t[i + 1];
      const uz = t[i + 5] - t[i + 2];
      const vx = t[i + 6] - t[i];
      const vy = t[i + 7] - t[i + 1];
      const vz = t[i + 8] - t[i + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const n = Math.hypot(nx, ny, nz);
      if (!(n > 1e-9)) continue;
      yield [nx / n, ny / n, nz / n, t, i];
    }
  }
}

/** How many triangles the file will hold. */
export function stlTriangleCount(meshes: readonly Mesh3D[]): number {
  let n = 0;
  for (const _ of facets(meshes)) n++;
  return n;
}

/** Binary STL. The header names the units; it doesn't start "solid", which readers take for ASCII. */
export function exportStlBinary(meshes: readonly Mesh3D[]): Uint8Array {
  const count = stlTriangleCount(meshes);
  const out = new Uint8Array(84 + 50 * count);
  const header = "Rodeo STL export, millimetres, z up";
  out.fill(0x20, 0, 80);
  for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, count, true);
  let at = 84;
  for (const [nx, ny, nz, t, i] of facets(meshes)) {
    dv.setFloat32(at, nx, true);
    dv.setFloat32(at + 4, ny, true);
    dv.setFloat32(at + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(at + 12 + 4 * k, t[i + k], true);
    // the attribute byte count, 0
    at += 50;
  }
  return out;
}

const num = (v: number): string => (Math.abs(v) < 5e-10 ? "0" : String(Math.round(v * 1e4) / 1e4));

/** ASCII STL: one solid named `name`, a facet per triangle, corners to a ten-thousandth of a millimetre. */
export function exportStlAscii(meshes: readonly Mesh3D[], name: string): string {
  const solid = name.replace(/\s+/g, "_") || "Rodeo";
  const out: string[] = [`solid ${solid}`];
  for (const [nx, ny, nz, t, i] of facets(meshes)) {
    out.push(`  facet normal ${num(nx)} ${num(ny)} ${num(nz)}`, "    outer loop");
    for (let k = 0; k < 9; k += 3) out.push(`      vertex ${num(t[i + k])} ${num(t[i + k + 1])} ${num(t[i + k + 2])}`);
    out.push("    endloop", "  endfacet");
  }
  out.push(`endsolid ${solid}`, "");
  return out.join("\n");
}
