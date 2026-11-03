// Where an anchor sits on screen: a 2D point on the active layer is seen on the
// drawing; a 3D point is seen in the 3D view (or, with the 2D drawing shown,
// the middle of the drawing, so its thread can still be read).

import { appContext } from "../../app/ext.ts";
import type { Pt } from "../../core/index.ts";
import { store } from "../../app/state.ts";
import type { Anchor } from "../../platform/protocol.ts";
import { drawingFrame } from "./popover.ts";
import { project3d } from "./view3d.ts";

/** Screen px in the drawing's frame for `a`, or null when it is not seen now. */
export function anchorScreen(a: Anchor | null): Pt | null {
  const ctx = appContext();
  if (!ctx || !a) return null;
  if (a.kind === "2d") {
    if (store.view3d || a.layerId !== store.activeLayerId) return null;
    return ctx.view.toScreen({ x: a.x, y: a.y });
  }
  if (store.view3d) return project3d(a);
  const frame = drawingFrame();
  return frame ? { x: frame.clientWidth / 2, y: frame.clientHeight / 2 } : null;
}
