// Tools > Origin: Locate Internal Origin and Center Drawing on Internal Origin, as Vectorworks has
// them. The internal origin is where the file's coordinates are 0, 0, and Rodeo reads coordinates
// from it (a user origin isn't read). Locate brings the window to it, in Top/Plan, zoomed out as far
// as the drawing needs to stay in sight, and marks it for a few seconds. Center moves the whole
// drawing (every design layer, hidden ones too) so its middle is on the origin, after saying how far
// its farthest object is and will be; the sheets' plan viewports follow it.

import type { BBox } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { confirmDialog } from "./menubar.ts";
import { appContext } from "./ext.ts";
import { unionBBox } from "./geom.ts";
import { glide } from "./glide.ts";
import { ACCENT } from "./renderer.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import type { Painter } from "./tools.ts";
import { formatLength } from "./units.ts";
import type { View } from "./view.ts";

/** how long the origin stays marked, ms */
const MARK_MS = 4000;
/** the marker's arms and ring, CSS px */
const ARM_PX = 18;
const RING_PX = 7;
/** a drawing whose middle is this close to the origin, as a share of its size, is centred already */
const CENTRED = 1e-9;

let markedUntil = 0;

/** True when the active layer is a design layer, whose coordinates are the drawing's. */
export function canLocateOrigin(scene: Scene): boolean {
  const layer = store.activeLayerId ? scene.layer(store.activeLayerId) : undefined;
  return layer?.kind === "design";
}

/** Tools > Origin > Locate Internal Origin: the window centred on it in Top/Plan, the drawing kept in sight, and the origin marked. */
export function locateInternalOrigin(scene: Scene, view: View): void {
  const ctx = appContext();
  if (!ctx || !canLocateOrigin(scene)) return;
  if (store.view3d) ctx.show2d();
  const box = scene.drawnBounds(store.activeLayerId);
  glide(view, () => {
    const scale = view.scale;
    if (box) {
      // as far out as a window centred on the origin needs to hold the drawing, never further in
      const hx = Math.max(Math.abs(box.x0), Math.abs(box.x1));
      const hy = Math.max(Math.abs(box.y0), Math.abs(box.y1));
      view.fit({ x0: -hx, y0: -hy, x1: hx, y1: hy });
    }
    view.setCenterAndScale(0, 0, Math.min(scale, box ? view.scale : scale));
  });
  markedUntil = performance.now() + MARK_MS;
  ctx.requestDraw();
  setTimeout(() => ctx.requestDraw(), MARK_MS + 50);
}

/** Draws the origin's marker while it is marked: a cross and a ring at 0, 0 on a design layer. */
export function drawOriginMarker(p: Painter): void {
  if (performance.now() > markedUntil || store.view3d) return;
  const o = p.toScreen({ x: 0, y: 0 });
  const { ctx } = p;
  ctx.save();
  ctx.lineCap = "round";
  for (const [colour, width] of [["rgba(255,255,255,0.85)", 4], [ACCENT, 1.5]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(o.x - ARM_PX, o.y);
    ctx.lineTo(o.x + ARM_PX, o.y);
    ctx.moveTo(o.x, o.y - ARM_PX);
    ctx.lineTo(o.x, o.y + ARM_PX);
    ctx.moveTo(o.x + RING_PX, o.y);
    ctx.arc(o.x, o.y, RING_PX, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The design layers' objects: each one's bounds, hidden layers and classes included. */
function drawingBoxes(scene: Scene): BBox[] {
  return scene
    .layers()
    .filter((l) => l.kind === "design")
    .flatMap((l) => scene.topLevelEntries(l.id).flatMap((e) => (e.bbox ? [e.bbox] : [])));
}

/** How far the farthest corner of any of `boxes` is from the origin, once moved by (dx, dy). */
function farthest(boxes: readonly BBox[], dx: number, dy: number): number {
  let far = 0;
  for (const b of boxes) {
    const x = Math.max(Math.abs(b.x0 + dx), Math.abs(b.x1 + dx));
    const y = Math.max(Math.abs(b.y0 + dy), Math.abs(b.y1 + dy));
    far = Math.max(far, Math.hypot(x, y));
  }
  return far;
}

/** True when the drawing has something on its design layers to move. */
export function canCenterDrawing(scene: Scene): boolean {
  return store.session !== null && drawingBoxes(scene).length > 0;
}

/**
 * Tools > Origin > Center Drawing on Internal Origin: says how far the farthest object is from the
 * origin and will be, then moves the drawing so its middle is on the origin, in one undo step. The
 * window moves with it, so the drawing stays where it was on screen.
 */
export async function centerDrawingOnOrigin(scene: Scene, view: View): Promise<void> {
  const s = store.session;
  if (!s) return;
  const boxes = drawingBoxes(scene);
  let box: BBox | null = null;
  for (const b of boxes) box = unionBBox(box, b);
  if (!box) return;
  const blockers = s.drawingMoveBlockers();
  const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
  const views = [
    blockers.views ? `${plural(blockers.views, "viewport")} looking from the side or in 3D` : "",
    blockers.designLayerViewports ? plural(blockers.designLayerViewports, "design-layer viewport") : "",
  ].filter(Boolean);
  const stuck = [...blockers.unmovable].map(([kind, n]) => `${n} ${kind}`);
  const stuckCount = [...blockers.unmovable.values()].reduce((a, n) => a + n, 0);
  if (views.length || stuck.length) {
    const why = [
      views.length ? `${views.join(" and ")}, whose views can't follow it yet` : "",
      stuck.length ? `${stuck.join(", ")} ${stuckCount === 1 ? "object" : "objects"} that can't be moved yet` : "",
    ].filter(Boolean);
    toast(`The drawing stays where it is: it has ${why.join("; and ")}.`, "info");
    return;
  }
  const dx = -(box.x0 + box.x1) / 2;
  const dy = -(box.y0 + box.y1) / 2;
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1);
  if (Math.hypot(dx, dy) <= size * CENTRED) {
    toast("The drawing is already centred on the internal origin.", "info");
    return;
  }
  const units = s.doc.info.units;
  const ok = await confirmDialog(
    "Center Drawing on Internal Origin",
    `The farthest object is ${formatLength(farthest(boxes, 0, 0), units)} from the internal origin; ` +
      `centred, it will be ${formatLength(farthest(boxes, dx, dy), units)}. Every object on the design layers moves, ` +
      `hidden ones too, and the sheets' viewports go on showing the same parts. Coordinates are read from the internal origin, so they change.`,
    "Center",
  );
  if (!ok || store.session !== s) return;
  if (!attempt("Center Drawing on Internal Origin", (t) => t.moveDrawing(dx, dy))) return;
  view.setCenterAndScale(view.cx + dx, view.cy + dy, view.scale);
  store.emit("view");
  toast(`Drawing moved ${formatLength(Math.hypot(dx, dy), units)}, its middle now on the internal origin.`, "info");
}
