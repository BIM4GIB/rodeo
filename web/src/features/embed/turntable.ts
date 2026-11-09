// The camera maths of an embed's turning picture: the eye's direction from its target, a turn of
// the eye about the vertical line through the target, and the directions the framing is tested
// from. DOM-free, so the check runs in node. preview.ts draws the frames.

import type { CameraState } from "../../app/view3d.ts";
import type { Vec3 } from "../../core/index.ts";

/** From the target to the eye. */
export function towardOf(position: Vec3, target: Vec3): Vec3 {
  return [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
}

/** `v` turned `degrees` about the vertical (z) axis, counter-clockwise seen from above. */
export function turnAboutZ(v: Vec3, degrees: number): Vec3 {
  // a turn about z keeps the height, so the picture's horizon stays level through the whole turn
  const radians = (degrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/** `count` directions: `toward` turned by 360/count degrees at a time, starting with itself. */
export function spinDirections(toward: Vec3, count: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) out.push(turnAboutZ(toward, (360 * i) / count));
  return out;
}

/** One turn of the camera about the vertical line through its target, in `frames` steps; target, zoom, half and fov kept. */
export function turntableStates(start: CameraState, frames: number): CameraState[] {
  // the eye keeps its distance from the target and its height, so only its bearing changes
  const offset = towardOf(start.position, start.target);
  const out: CameraState[] = [];
  for (let i = 0; i < frames; i++) {
    const [x, y, z] = turnAboutZ(offset, (360 * i) / frames);
    const position: Vec3 = [start.target[0] + x, start.target[1] + y, start.target[2] + z];
    out.push({ ...start, position });
  }
  return out;
}
