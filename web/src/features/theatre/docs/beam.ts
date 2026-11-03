// The beam of a focused instrument, worked from its lens height, its focus and its beam and field
// angles: the throw, the beam's angle above the horizontal at the focus, and the diameters of its pools
// on the focus plane (a beam is a cone, so its pool is the cone's cut across its angle). It leaves out
// the beam's shape past the focus and any shutter or gobo edge. Pure: lengths in mm, angles in degrees.

import type { Fixture } from "../fixture.ts";

export interface Beam {
  /** the lens to the focus, across the plan, mm */
  readonly planMm: number;
  /** the lens to the focus, mm */
  readonly throwMm: number;
  /** the beam's angle above the horizontal at the focus; negative when the focus is above the lens */
  readonly elevationDeg: number;
  /** the field (10%) pool's diameter at the focus, mm */
  readonly fieldMm: number;
  /** the beam (50%) pool's diameter at the focus, mm */
  readonly beamMm: number;
}

type Optics = Pick<Fixture, "at" | "heightMm" | "focus" | "beamDeg" | "fieldDeg">;

const DEG = Math.PI / 180;

/** The diameter of a beam's cut at `throwMm` from the lens, across its full angle `angleDeg`: 2·throw·tan(angle/2). */
export function poolMm(throwMm: number, angleDeg: number): number {
  return 2 * throwMm * Math.tan((angleDeg / 2) * DEG);
}

/** The throw and pools of an instrument, or null when it has no focus. */
export function beamOf(f: Optics): Beam | null {
  if (!f.focus) return null;
  const planMm = Math.hypot(f.focus.x - f.at.x, f.focus.y - f.at.y);
  const drop = f.heightMm - f.focus.z;
  const throwMm = Math.hypot(planMm, drop);
  const elevationDeg = Math.atan2(drop, planMm) / DEG;
  return { planMm, throwMm, elevationDeg, fieldMm: poolMm(throwMm, f.fieldDeg), beamMm: poolMm(throwMm, f.beamDeg) };
}
