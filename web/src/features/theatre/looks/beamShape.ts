// The shape of one instrument's beam in the 3D view, from its lens, its focus and its field angle. The
// beam is a cone with its point at the lens and its axis from the lens to the focus. Each edge of the cone
// runs on until it meets the stage floor (z = 0), so the light lands on the floor as it does on a stage;
// an edge that never comes down (a beam aimed level or up) stops at a length set by the focus. Pure: plain
// numbers in mm and degrees, so it runs in Node; beams3d.ts builds the meshes from it.

import type { FocusPoint } from "../fixture.ts";

/** How many points go round a beam's edge. */
export const BEAM_SEGMENTS = 36;

export interface BeamShape {
  /** the lens */
  readonly apex: FocusPoint;
  /** one point per segment round the edge, in order: on the floor, or where an edge that never comes down stops */
  readonly rim: readonly FocusPoint[];
  /** where the axis meets the floor, or null when it doesn't come down to it */
  readonly spot: FocusPoint | null;
  /** whether every rim point is on the floor, so the light pools there as one closed shape around `spot` */
  readonly pools: boolean;
}

type Vec = readonly [number, number, number];

/**
 * The beam of a lens at `lens`, aimed at `focus`, with its field angle `fieldDeg` (the full angle, so the
 * cone's half-angle is half of it). Without a distance to the focus the beam points straight down.
 */
export function beamShape(lens: FocusPoint, focus: FocusPoint, fieldDeg: number, segments = BEAM_SEGMENTS): BeamShape {
  const d: Vec = [focus.x - lens.x, focus.y - lens.y, focus.z - lens.z];
  const len = Math.hypot(...d);
  const u: Vec = len > 1e-9 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, -1];
  const half = (Math.PI * Math.max(0, fieldDeg)) / 360;
  const cosA = Math.cos(half);
  const sinA = Math.sin(half);
  // v1 is across the axis in its vertical plane, pointing up; v2 is across both
  const up: Vec = [-u[2] * u[0], -u[2] * u[1], 1 - u[2] * u[2]];
  const n = Math.hypot(...up);
  const v1: Vec = n > 1e-9 ? [up[0] / n, up[1] / n, up[2] / n] : [1, 0, 0];
  const v2: Vec = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]];
  // an edge that never reaches the floor stops this far from the lens
  const cap = Math.max(2 * len, 2 * lens.z, 1000);
  const rim: FocusPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const phi = (2 * Math.PI * i) / segments;
    const across = sinA * Math.cos(phi);
    const round = sinA * Math.sin(phi);
    const g: Vec = [cosA * u[0] + across * v1[0] + round * v2[0], cosA * u[1] + across * v1[1] + round * v2[1], cosA * u[2] + across * v1[2] + round * v2[2]];
    const down = g[2] < -1e-9 && lens.z > 0;
    const k = down ? -lens.z / g[2] : cap;
    rim.push({ x: lens.x + k * g[0], y: lens.y + k * g[1], z: down ? 0 : lens.z + k * g[2] });
  }
  const axisDown = u[2] < -1e-9 && lens.z > 0;
  const spot: FocusPoint | null = axisDown ? { x: lens.x + (-lens.z / u[2]) * u[0], y: lens.y + (-lens.z / u[2]) * u[1], z: 0 } : null;
  return { apex: { x: lens.x, y: lens.y, z: lens.z }, rim, spot, pools: spot !== null && rim.every((p) => p.z === 0) };
}
