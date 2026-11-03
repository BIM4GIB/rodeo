// A light object's commands on its right-click menu, as Vectorworks has them: Turn On or Turn Off,
// and for a directional or spot light Set Light to View (the light turned to shine the way the view
// looks: the 3D view's camera while it shows, else straight down, as Top/Plan looks) and Set View
// to Light (the 3D view, shown when the plan was, turned to look the way the light shines, framing
// the visible model). Object Info's light section has the last two as buttons too. A light in a
// symbol or a plug-in isn't aimed from here: it changes in its definition or its parameters, except a
// lighting device's, which these switch and aim through its parameters (Light3D.device).

import type { Light3D, Vec3 } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { appContext } from "./ext.ts";
import { store } from "./state.ts";

/** The light object `id`, or a lighting device's light when `id` is the device's. */
export function lightOf(id: string): Light3D | null {
  const lights = store.session?.doc.lights3d() ?? [];
  return lights.find((l) => l.id === id) ?? lights.find((l) => l.device && l.objectId === id) ?? null;
}

/** Turn On or Turn Off: a light the drawing, a symbol or a lighting device places (another plug-in's follows its parameters). */
export function canSwitchLight(id: string): boolean {
  const l = lightOf(id);
  return !!l && (l.placedBy !== "plugin" || !!l.device);
}

export function switchLight(id: string): void {
  const l = lightOf(id);
  if (!l) return;
  attempt(l.on ? "Turn Light Off" : "Turn Light On", (s) => s.setLight(id, { on: !l.on }));
}

/** A directional or spot light the drawing or a lighting device places: one with a direction these can set. */
export function canAimLight(id: string): boolean {
  const l = lightOf(id);
  return !!l && l.kind !== "point" && (l.placedBy === "drawing" || !!l.device);
}

/** The way the view looks: the 3D view's camera while it shows, else straight down. */
function viewDirection(): Vec3 {
  const v = appContext()?.view3d();
  if (!v?.visible) return [0, 0, -1];
  const { position: p, target: t } = v.cameraState();
  const d: Vec3 = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
  const n = Math.hypot(...d);
  return n > 0 ? [d[0] / n, d[1] / n, d[2] / n] : [0, 0, -1];
}

/** Set Light to View: the light shines the way the view looks. */
export function setLightToView(id: string): void {
  if (!canAimLight(id)) return;
  attempt("Set Light to View", (s) => s.setLight(id, { direction: viewDirection() }));
}

/** Set View to Light: the 3D view looks the way the light shines. */
export async function setViewToLight(id: string): Promise<void> {
  const l = lightOf(id);
  if (!l || l.kind === "point") return;
  const v = await appContext()?.show3d();
  const [x, y, z] = l.direction;
  v?.lookAlong([-x, -y, -z]);
}
