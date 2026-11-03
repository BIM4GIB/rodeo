// PLY, the polygon file format Blender, MeshLab, CloudCompare and 3D scanners read, as the drawing's 3D
// model writes it: binary little endian 1.0, in metres with z up (which Blender's PLY import takes by
// default). Each vertex is a float position and a red, green and blue byte, its piece's colour; each
// face is a triangle of vertex indices. A piece's vertices are shared where their positions are exactly
// the same, so a piece keeps its own colour. Triangles squashed to a line or a point are left out, as
// in STL. Opacity, names and layers are left out: PLY holds none of them.

import type { Model3D } from "./scene3d.ts";

/** The model as a binary little endian PLY file: metres, z up, each vertex in its piece's colour. */
export function exportPly(model: Model3D): Uint8Array {
  // metres, the vertices' positions; 0..255 bytes, their colours; vertex indices, three to a triangle
  const xyz: number[] = [];
  const rgb: number[] = [];
  const tri: number[] = [];
  for (const layer of model.layers) {
    for (const obj of layer.objects) {
      for (const piece of obj.pieces) {
        const t = piece.triangles;
        const colour = bytesOf(piece.color);
        const index = new Map<string, number>();
        const vertex = (i: number): number => {
          const key = `${t[i]},${t[i + 1]},${t[i + 2]}`;
          let v = index.get(key);
          if (v === undefined) {
            v = xyz.length / 3;
            index.set(key, v);
            xyz.push(t[i] / 1000, t[i + 1] / 1000, t[i + 2] / 1000);
            rgb.push(...colour);
          }
          return v;
        };
        for (let i = 0; i + 9 <= t.length; i += 9) {
          if (squashed(t, i)) continue;
          tri.push(vertex(i), vertex(i + 3), vertex(i + 6));
        }
      }
    }
  }
  const nv = xyz.length / 3;
  const nf = tri.length / 3;
  const head = new TextEncoder().encode(
    [
      "ply",
      "format binary_little_endian 1.0",
      "comment Rodeo 3D model, metres, z up",
      `element vertex ${nv}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      `element face ${nf}`,
      "property list uchar int vertex_indices",
      "end_header",
      "",
    ].join("\n"),
  );
  // a vertex is 15 bytes (three floats, three bytes); a triangle 13 (a count of 3, three ints)
  const out = new Uint8Array(head.length + 15 * nv + 13 * nf);
  out.set(head);
  const dv = new DataView(out.buffer);
  let at = head.length;
  for (let v = 0; v < nv; v++, at += 15) {
    dv.setFloat32(at, xyz[3 * v], true);
    dv.setFloat32(at + 4, xyz[3 * v + 1], true);
    dv.setFloat32(at + 8, xyz[3 * v + 2], true);
    dv.setUint8(at + 12, rgb[3 * v]);
    dv.setUint8(at + 13, rgb[3 * v + 1]);
    dv.setUint8(at + 14, rgb[3 * v + 2]);
  }
  for (let f = 0; f < nf; f++, at += 13) {
    dv.setUint8(at, 3);
    for (let k = 0; k < 3; k++) dv.setInt32(at + 1 + 4 * k, tri[3 * f + k], true);
  }
  return out;
}

/** A piece's "#rrggbb" as 0..255 bytes; black when it is not one. */
function bytesOf(css: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

/** True when triangle `i` of `t` is squashed to a line or a point (its normal has no length). */
function squashed(t: Float32Array, i: number): boolean {
  const ux = t[i + 3] - t[i];
  const uy = t[i + 4] - t[i + 1];
  const uz = t[i + 5] - t[i + 2];
  const vx = t[i + 6] - t[i];
  const vy = t[i + 7] - t[i + 1];
  const vz = t[i + 8] - t[i + 2];
  return !(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-9);
}
