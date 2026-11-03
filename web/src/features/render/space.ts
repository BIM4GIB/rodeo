// Render space, shared by every render module: metres, y up. The model's world is millimetres, z up;
// the path tracer's ray offsets and the sky's equirectangular maps expect metres and y up.

import * as THREE from "three";

/** Metres a world millimetre is. */
export const MM = 0.001;

/** From the model's world (millimetres, z up) to render space (metres, y up): (x, y, z) mm → (x, z, −y) m. */
export const RENDER_SPACE = new THREE.Matrix4().makeRotationX(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(MM, MM, MM));

/** A world point (mm, z up) in render space. */
export function toRender(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x * MM, z * MM, -y * MM);
}

/** A world direction (z up) in render space, unit length. */
export function dirToRender(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, z, -y).normalize();
}
