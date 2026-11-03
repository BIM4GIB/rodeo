// What this client tells the others: the mode, the active layer, the cursor, the selection, the
// 2D view, the 3D camera and the point under the 3D pointer. Each change is merged into the
// presence the engine sends (it throttles them), so only what changed is given.

import type { AppContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import type { View3D } from "../../app/view3d.ts";
import type { Presence } from "../../platform/protocol.ts";
import { collab, type CollabSession } from "./engine.ts";
import { view3d } from "./live.ts";

type Camera = NonNullable<Presence["camera"]>;

let app: AppContext | null = null;

function cameraOf(v: View3D): Camera {
  const p = v.activeCamera.position;
  const t = v.orbitTarget;
  return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
}

function viewOf(ctx: AppContext): NonNullable<Presence["view"]> {
  return { cx: ctx.view.cx, cy: ctx.view.cy, scale: ctx.view.scale };
}

function publish(p: Partial<Presence>): void {
  collab()?.setPresence(p);
}

/** The whole of this client's presence, given when a session starts. */
export function publishAll(s: CollabSession): void {
  const v = view3d();
  s.setPresence({
    mode: store.view3d ? "3d" : "2d",
    layerId: store.activeLayerId,
    cursor: null,
    selection: [...store.selection],
    view: app ? viewOf(app) : null,
    camera: v ? cameraOf(v) : null,
    pointer3d: null,
  });
}

/** The 3D camera as it is now (the 3D view's first frame, before the user moves it). */
export function publishCamera(v: View3D): void {
  publish({ camera: cameraOf(v) });
}

/** The 2D side: the pointer's cursor, and the layer, selection, view and mode as the editor changes them. */
export function listenPresence(ctx: AppContext): void {
  app = ctx;
  const canvas = ctx.canvas;
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    const w = ctx.view.toWorld(e.clientX - r.left, e.clientY - r.top);
    publish({ cursor: { x: w.x, y: w.y } });
  });
  canvas.addEventListener("pointerleave", () => publish({ cursor: null }));
  store.on("layer", () => publish({ layerId: store.activeLayerId }));
  store.on("selection", () => publish({ selection: [...store.selection] }));
  store.on("view", () => publish({ view: viewOf(ctx) }));
  store.on("view3d", () => {
    const v = view3d();
    publish({ mode: store.view3d ? "3d" : "2d", camera: v ? cameraOf(v) : null });
  });
}

/** how long the pointer rests before the point under it is found (a pick tests every triangle) */
const POINTER_REST_MS = 120;

/** Whether someone else in the drawing has its 3D view open: only they are shown the point under this pointer (markers3d.ts). */
function watchedIn3d(s: CollabSession): boolean {
  return s.peers().some((p) => s.presence(p.clientId)?.mode === "3d");
}

/**
 * The 3D side: the camera as the user moves it, and the point under the pointer once it rests, in
 * a session only. Finding that point tests every triangle of the model (a tenth of a second in a
 * large one, which halts orbiting after every drag), so it isn't done while the pointer moves, nor
 * while a drag turns or pans the view, nor when no one else is in 3D to be shown it (alone in a
 * cloud drawing's session, most often).
 */
export function listen3d(v: View3D): void {
  const canvas = v.domElement;
  let pending: PointerEvent | null = null;
  let timer = 0;
  let shown = false;
  const hide = (): void => {
    pending = null;
    clearTimeout(timer);
    timer = 0;
    if (shown) publish({ pointer3d: null });
    shown = false;
  };
  v.onCameraChange(() => publish({ camera: cameraOf(v) }));
  canvas.addEventListener("pointermove", (e) => {
    const s = collab();
    if (!s || e.buttons !== 0 || !watchedIn3d(s)) {
      hide();
      return;
    }
    pending = e;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      const last = pending;
      pending = null;
      const now = collab();
      if (!last || !now || !watchedIn3d(now)) return;
      const p = v.pointAt(last);
      publish({ pointer3d: p ? [p.x, p.y, p.z] : null });
      shown = true;
    }, POINTER_REST_MS);
  });
  canvas.addEventListener("pointerleave", hide);
}
