// What the drawing area shows, for the commands that work on one kind of view: the 3D-only ones
// (View › Rendering, Renderworks Style, Clip Cube, the render mode pop-up, Export Panorama) are
// enabled while a 3D view is on screen, alone or in a pane among several, and the plan-only ones
// (Normal Scale, the zoom field) while the plan is; with several panes they act on the live view
// of their kind, making its pane the active one first.

import { store } from "./state.ts";
import { livePane, livePlanPane, multiPane } from "./viewPanes.ts";

/** True while a 3D view is on screen: the 3D view alone, or a 3D pane among several. */
export function threeDOnScreen(): boolean {
  return store.session !== null && (multiPane() ? livePane() >= 0 : store.view3d);
}

/** True while the 2D plan is on screen: the plan alone, or a plan pane among several. */
export function planOnScreen(): boolean {
  return store.session !== null && (multiPane() ? livePlanPane() >= 0 : !store.view3d);
}
