// The capture layer. While Pin or Redline is the crit tool, a transparent layer
// over the drawing takes the pointer, so the editor's tools get none of it; the
// wheel is passed on to the canvas (or the 3D view), so zooming still works.
// In Select, a press on a pin opens its thread: a capture-phase listener on the
// drawing's frame takes the press before the editor's canvas does.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import type { Pt } from "../../core/index.ts";
import { openPinComposer } from "./composer.ts";
import { threadAt } from "./paint.ts";
import { popoverKind } from "./popover.ts";
import { pinAt3d } from "./view3d.ts";
import { crit, STROKE_WIDTH_PX } from "./state.ts";
import { openThread } from "./thread.ts";

/** a redline takes a point every this many screen px, so near points are thinned out */
const MIN_STEP_PX = 2;

let layer: HTMLElement | null = null;
/** the pointer of a press taken for a pin (in Select); its release is taken too */
let swallowed: number | null = null;
let lastScreen: Pt | null = null;

/** The pointer position in CSS px over the drawing canvas. */
function canvasLocal(e: { clientX: number; clientY: number }): Pt {
  const rect = appContext()?.canvas.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
}

function capturing(): boolean {
  return crit.active && (crit.tool === "pin" || crit.tool === "redline") && !(store.view3d && crit.tool === "redline");
}

function refresh(): void {
  if (!layer) return;
  const on = capturing();
  layer.hidden = !on;
  layer.dataset.tool = crit.tool;
  if (!on) {
    crit.stroke = null;
    lastScreen = null;
  }
}

/** Adds the capture layer to the drawing's frame and listens for the crit tool (called once the editor runs). */
export function mountCapture(frame: HTMLElement): void {
  layer = h("div", { cls: "crit-capture", hidden: true, attrs: { "aria-hidden": "true" } });
  frame.append(layer);
  layer.addEventListener("pointerdown", onDown);
  layer.addEventListener("pointermove", onMove);
  layer.addEventListener("pointerup", onUp);
  layer.addEventListener("pointercancel", onUp);
  layer.addEventListener("wheel", onWheel, { passive: false });
  frame.addEventListener("pointerdown", onFrameDown, true);
  frame.addEventListener("pointerup", onFrameUp, true);
  crit.subscribe(refresh);
  store.on(["view3d"], refresh);
  refresh();
}

/** Select: a press on a pin opens its thread, before the editor's tool sees it. */
function onFrameDown(e: PointerEvent): void {
  if (!crit.active || crit.tool !== "select" || e.button !== 0 || store.view3d) return;
  if (!(e.target instanceof HTMLCanvasElement)) return;
  const hit = threadAt(canvasLocal(e));
  if (!hit) return;
  e.stopPropagation();
  swallowed = e.pointerId;
  openThread(hit.root.id);
}

function onFrameUp(e: PointerEvent): void {
  if (swallowed === null || e.pointerId !== swallowed) return;
  swallowed = null;
  e.stopPropagation();
}

function onDown(e: PointerEvent): void {
  const ctx = appContext();
  if (!ctx || e.button !== 0 || !crit.canComment) return;
  if (store.view3d) {
    // a pin on the model: where the 3D view's ray meets it
    const anchor = pinAt3d(e);
    if (!anchor) {
      toast("Click on the model to pin a comment.", "info");
      return;
    }
    crit.pinDraft = anchor;
    if (popoverKind() !== "pin") openPinComposer();
    ctx.requestDraw();
    return;
  }
  const screen = canvasLocal(e);
  if (crit.tool === "pin") {
    const hit = threadAt(screen);
    if (hit) {
      openThread(hit.root.id);
      return;
    }
    const layerId = store.activeLayerId;
    if (!layerId) {
      toast("Choose a layer to comment on.", "info");
      return;
    }
    const w = ctx.view.toWorld(screen.x, screen.y);
    // a pin already being written moves with the click, and keeps its text
    crit.pinDraft = { kind: "2d", layerId, x: w.x, y: w.y };
    if (popoverKind() !== "pin") openPinComposer();
    ctx.requestDraw();
    return;
  }
  if (crit.tool === "redline") {
    const layerId = store.activeLayerId;
    if (!layerId || !layer) {
      toast("Choose a layer to draw on.", "info");
      return;
    }
    layer.setPointerCapture(e.pointerId);
    const w = ctx.view.toWorld(screen.x, screen.y);
    crit.stroke = { layerId, colour: crit.colour, points: [[w.x, w.y]] };
    lastScreen = screen;
    ctx.requestDraw();
  }
}

function onMove(e: PointerEvent): void {
  const ctx = appContext();
  if (!ctx || store.view3d) return;
  const screen = canvasLocal(e);
  const w = ctx.view.toWorld(screen.x, screen.y);
  store.cursor = w;
  store.emit("cursor");
  const drawing = crit.stroke;
  if (!drawing || !lastScreen) return;
  if (Math.hypot(screen.x - lastScreen.x, screen.y - lastScreen.y) < MIN_STEP_PX) return;
  drawing.points.push([w.x, w.y]);
  lastScreen = screen;
  ctx.requestDraw();
}

function onUp(e: PointerEvent): void {
  const drawing = crit.stroke;
  if (!drawing) return;
  if (layer?.hasPointerCapture(e.pointerId)) layer.releasePointerCapture(e.pointerId);
  crit.stroke = null;
  lastScreen = null;
  // a click with no drag is a dot
  const pts = drawing.points.length === 1 ? [drawing.points[0], drawing.points[0]] : drawing.points;
  crit.strokes = [
    ...crit.strokes,
    { layerId: drawing.layerId, points: pts.map((p) => [p[0], p[1]] as [number, number]), color: drawing.colour, width: STROKE_WIDTH_PX },
  ];
  crit.changed();
  appContext()?.requestDraw();
}

/** The wheel goes to the view it is over: the 2D canvas, or the 3D view. */
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const ctx = appContext();
  if (!ctx) return;
  const target = store.view3d ? ctx.view3d()?.domElement : ctx.canvas;
  target?.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    }),
  );
}
