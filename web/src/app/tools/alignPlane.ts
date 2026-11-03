// The 3D Modeling set's Align Plane: lays the selected 3D objects on the active working plane (the
// layer plane when none is active), in the 3D view. Surface mode takes a click on a face of one of
// them and turns them the least way that lays that face on the plane, the objects standing on its
// upper side, the clicked point keeping its place along the plane. Three Points mode takes three
// clicks on them: the first goes to the plane's origin, the second along its x axis and the third
// to its y side, as Vectorworks has it (Mirror flips them to the other side). A click near a corner
// of a solid takes the corner. With nothing selected the object clicked is taken. 2D objects, walls
// and plug-ins don't turn out of plan, so they stay where they are unless the turn is one in plan.
// One undo step.

import type { Vec3 } from "../../core/index.ts";
import { alignFrames, faceOnPlane, frameOfPoints, upOf, type Alignment, type Frame } from "../alignPlaneShapes.ts";
import { attempt, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { activePlane, onWorkingPlanes } from "../workingPlanes.ts";
import { requestShow3d } from "./navigate3d.ts";

type Mode = "surface" | "points";
const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: "surface", label: "Surface" },
  { id: "points", label: "Three Points" },
];
/** how near a corner of a solid a click takes the corner, in screen pixels */
const CORNER_PX = 12;

const settings = { mode: "surface" as Mode };

let active = false;
/** Three Points: the points clicked so far, and the objects the first was clicked on, which are aligned */
let points: Vec3[] = [];
let pointIds: string[] = [];

const layerElevation = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

/** the plane objects are laid on: the active working plane, or the layer plane */
function target(): Frame {
  const plane = activePlane();
  return plane ?? { origin: [0, 0, layerElevation()], x: [1, 0, 0], y: [0, 1, 0] };
}

const planeName = (): string => (activePlane() ? "the working plane" : "the layer plane");

/** The objects a click on `objectId` aligns: the selection it's in, or with none selected the object itself (as it is in the group being edited). */
function objectsFor(objectId: string | null): string[] | null {
  const doc = store.session?.doc;
  if (!doc || !objectId) return null;
  const selected = [...store.selection].filter((id) => !isDerivedId(id));
  let o = doc.object(objectId) ?? null;
  if (selected.length) {
    for (; o; o = o.parentId ? (doc.object(o.parentId) ?? null) : null) if (store.selection.has(o.id)) return selected;
    return null;
  }
  while (o && o.parentId && o.parentId !== store.editGroupId) o = doc.object(o.parentId) ?? null;
  return o ? [o.id] : null;
}

/** The corner of the solid clicked nearest the click when it's within CORNER_PX on screen, else the point clicked. */
function snapped(hit: FaceHit, e: MouseEvent): Vec3 {
  const v = appContext()?.view3d();
  const s = store.session;
  if (!v || !s || !hit.objectId) return hit.point;
  let tris: Float64Array;
  try {
    tris = s.solidTriangles(hit.objectId);
  } catch {
    return hit.point;
  }
  let best: Vec3 = hit.point;
  let near = CORNER_PX;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const p: Vec3 = [tris[i], tris[i + 1], tris[i + 2]];
    const at = v.screenOf(p);
    if (!at) continue;
    const d = Math.hypot(at.x - e.clientX, at.y - e.clientY);
    if (d < near) [best, near] = [p, d];
  }
  return best;
}

/** Turns and moves `ids` by `a` in one undo step, and says what stayed. */
function apply(ids: string[], a: Alignment, label: string): void {
  const r = attempt(label, (s) =>
    s.batch(() => {
      let left = 0;
      let moving = ids;
      if (a.axis) {
        const turned = s.rotateObjects3D(ids, a.axis, a.deg, a.centre);
        left = turned.left;
        // what can't turn out of plan stays where it is too
        if (a.axis[0] !== 0 || a.axis[1] !== 0) moving = turned.turned;
      }
      if (moving.length && Math.hypot(...a.move) > 1e-9) s.moveObjects3D(moving, a.move[0], a.move[1], a.move[2]);
      return { left, moved: moving.length };
    }),
  );
  if (!r) return;
  setSelection(ids);
  const { left, moved } = r.value;
  if (!moved) toast(`Nothing was aligned: only extrudes, sweeps, solids, 3D polygons, meshes and symbols holding only 3D turn out of plan.`, "info");
  else if (left) toast(`${label}: ${left === 1 ? "1 object that isn't" : `${left} objects that aren't`} a 3D object (2D objects, plug-in objects, walls, doors and windows) stayed where ${left === 1 ? "it was" : "they were"}.`, "info");
}

function show(): void {
  const v = appContext()?.view3d();
  if (!v || !active) return;
  store.setHint(status());
  const lines: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) lines.push(...points[i], ...points[i + 1]);
  // a lone point shows as a short mark square to the plane it's laid on
  if (points.length === 1) {
    const up = upOf(target());
    lines.push(...points[0], ...points[0].map((c, k) => c + up[k] * 100));
  }
  v.setHighlightLines(lines.length ? lines : null);
  bar.hidden = !store.view3d;
  statusLabel.textContent = status();
  clearBtn.hidden = settings.mode !== "points";
  clearBtn.disabled = !points.length;
}

function status(): string {
  const plane = planeName();
  if (settings.mode === "surface") return `Click a face of a selected 3D object to lay it on ${plane}`;
  return ["Click the point that goes to the plane's origin", "Click the point that sets its x axis", "Click the point that sets its y axis"][points.length] + ` (${plane})`;
}

function clear(): void {
  points = [];
  pointIds = [];
  show();
}

function clicked(hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  if (!hit) {
    toast("That click met no face: click a face of the object to align.", "info");
    return;
  }
  const ids = objectsFor(hit.objectId);
  if (!ids) {
    toast("Click a face of one of the selected objects, or select nothing to align the object clicked.", "info");
    return;
  }
  if (settings.mode === "surface") {
    apply(ids, faceOnPlane(hit.point, hit.normal, target()), "Align Plane");
    return;
  }
  points = [...points, snapped(hit, e)];
  if (points.length === 1) pointIds = ids;
  if (points.length < 3) {
    show();
    return;
  }
  const [a, b, c] = points;
  const from = frameOfPoints(a, b, c);
  points = [];
  const objects = pointIds;
  pointIds = [];
  show();
  if (!from) {
    toast("Those points lie in a line, so they set no plane: click three points that don't.", "info");
    return;
  }
  apply(objects, alignFrames(from, target()), "Align Plane");
}

const statusLabel = h("span", { cls: "symbol-bar-label" });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Align Plane" }), statusLabel, clearBtn);

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountAlignPlaneBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  clearBtn.addEventListener("click", clear);
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "alignplane";
    if (now === active) return;
    active = now;
    points = [];
    pointIds = [];
    claim();
    if (active) show();
    else {
      bar.hidden = true;
      appContext()?.view3d()?.setHighlightLines(null);
    }
  });
  store.on("view3d", () => {
    points = [];
    pointIds = [];
    if (active) show();
    else bar.hidden = true;
  });
  on3d(claim);
  // not while a working plane waits for a face, but once it's had it
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
    if (active) show();
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d || !points.length || e.key !== "Escape") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      clear();
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

export class AlignPlaneTool extends BaseTool {
  readonly id = "alignplane";
  readonly cursor = "crosshair";

  hint(): string {
    return store.view3d ? `${status()} · Drag to orbit` : "Align Plane works in the 3D view: click to show it";
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    return [{ label: "Mode", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.mode }];
  }

  setMode(id: string): void {
    const m = MODES.find((x) => x.id === id);
    if (!m) return;
    settings.mode = m.id;
    clear();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
