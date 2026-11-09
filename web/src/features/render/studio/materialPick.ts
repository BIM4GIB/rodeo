// Pick, for the Render palette's Materials tab: which face group a point on the model belongs to. The
// 3D view reports the point a click lands on (FaceHit, world mm); the face group whose triangle lies
// under that point is the material (the nearest one when several share the spot). The geometry is read
// from its buffers, so no three.js is loaded here: the types are for the compiler only.

import type { ModelFace } from "../../../app/view3d.ts";
import type { Vec3 } from "../../../core/index.ts";

/** How far outside a triangle a point may lie, as a share of the triangle's own size (barycentric). */
const INSIDE = 1e-3;
/** Triangles this close (mm) to the point's plane are the same spot: the face group drawn on top wins. */
const SAME_SPOT = 0.01;
/** A point further than this (mm) from a triangle's plane is not on the face (a click lands on one, to float error). */
const ON_FACE = 0.5;
/** Triangles with less area (squared twice over, mm²) than this are slivers with no plane to test. */
const SLIVER = 1e-12;

/** A position attribute: its corners' xyz, from its own buffer when it has one (else copied out of an interleaved one). */
function xyzOf(pos: { readonly count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } & object): ArrayLike<number> {
  if ("array" in pos) return (pos as { readonly array: ArrayLike<number> }).array;
  const out = new Float64Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i);
    out[i * 3 + 1] = pos.getY(i);
    out[i * 3 + 2] = pos.getZ(i);
  }
  return out;
}

/**
 * The face group under the point `p` (world mm): the one whose triangle contains the point's foot on
 * the triangle's plane, nearest the point. A face group's triangles are the first `drawRange.count`
 * indices of its geometry (view3d.ts modelFaces). Null over no face.
 */
export function faceUnder(faces: readonly ModelFace[], p: Vec3): ModelFace | null {
  let best: { readonly face: ModelFace; readonly gap: number } | null = null;
  for (const face of faces) {
    const g = face.geometry;
    const pos = g.getAttribute("position");
    const index = g.index;
    if (!pos || !index) continue;
    const xyz = xyzOf(pos);
    const idx = index.array;
    const corners = Math.min(g.drawRange.count, idx.length);
    for (let i = 0; i + 2 < corners; i += 3) {
      const a = idx[i] * 3;
      const b = idx[i + 1] * 3;
      const c = idx[i + 2] * 3;
      const ax = xyz[a];
      const ay = xyz[a + 1];
      const az = xyz[a + 2];
      // the triangle's two edges from a, and their normal
      const e1x = xyz[b] - ax;
      const e1y = xyz[b + 1] - ay;
      const e1z = xyz[b + 2] - az;
      const e2x = xyz[c] - ax;
      const e2y = xyz[c + 1] - ay;
      const e2z = xyz[c + 2] - az;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      const nn = nx * nx + ny * ny + nz * nz;
      if (nn < SLIVER) continue;
      // the point's offset from a: its distance from the plane, then its place on the plane
      const apx = p[0] - ax;
      const apy = p[1] - ay;
      const apz = p[2] - az;
      const gap = Math.abs(apx * nx + apy * ny + apz * nz) / Math.sqrt(nn);
      if (gap > ON_FACE || (best && gap > best.gap + SAME_SPOT)) continue;
      const e1e1 = e1x * e1x + e1y * e1y + e1z * e1z;
      const e2e2 = e2x * e2x + e2y * e2y + e2z * e2z;
      const e1e2 = e1x * e2x + e1y * e2y + e1z * e2z;
      const ape1 = apx * e1x + apy * e1y + apz * e1z;
      const ape2 = apx * e2x + apy * e2y + apz * e2z;
      const det = e1e1 * e2e2 - e1e2 * e1e2;
      const s = (e2e2 * ape1 - e1e2 * ape2) / det;
      const t = (e1e1 * ape2 - e1e2 * ape1) / det;
      if (s < -INSIDE || t < -INSIDE || s + t > 1 + INSIDE) continue;
      if (!best || gap < best.gap - SAME_SPOT || (gap <= best.gap + SAME_SPOT && best.face.recessed && !face.recessed)) best = { face, gap };
    }
  }
  return best?.face ?? null;
}
