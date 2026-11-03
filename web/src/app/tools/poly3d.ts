// The 3D Modeling set's 3D Polygon: corners clicked one by one, ending as the Polygon tool does. In
// Top/Plan they lie at the Elevation in its Preferences above the layer's plane. In the 3D view a click on
// a face of the model puts a corner on that face, and a click on nothing puts one at that Elevation; a
// bar over the view finishes it, and a click on the first corner closes it.

import type { Vec3 } from "../../core/index.ts";
import type { Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import type { Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

/** how near the first corner a click closes the polygon, in screen pixels */
const CLOSE_PX = 10;

const settings = { elevation: 0 };

let active = false;
/** the corners clicked in the 3D view, in the model */
let corners: Vec3[] = [];

const layerElevation = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

function add(points: readonly number[], closed: boolean): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const made = attempt("3D Polygon", (s) => s.add3DPolygons(layerId, [{ points, closed }], store.activeClassIndex));
  if (made) setSelection([made.value]);
}

const statusLabel = h("span", { cls: "symbol-bar-label" });
const finishBtn = h("button", { cls: "btn small primary", text: "Finish", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "3D Polygon" }), statusLabel, finishBtn, clearBtn);

function show(): void {
  bar.hidden = !active || !store.view3d;
  statusLabel.textContent = corners.length ? `${corners.length} corner${corners.length === 1 ? "" : "s"}. Click the next, or the first to close it` : "Click the first corner, on a face or at the Elevation";
  finishBtn.disabled = corners.length < 2;
  clearBtn.disabled = !corners.length;
  const lines: number[] = [];
  for (let i = 0; i + 1 < corners.length; i++) lines.push(...corners[i], ...corners[i + 1]);
  // a lone corner shows as a short mark
  if (corners.length === 1) lines.push(...corners[0], corners[0][0], corners[0][1], corners[0][2] + 100);
  appContext()?.view3d()?.setHighlightLines(lines.length ? lines : null);
}

function finish(closed: boolean): void {
  if (corners.length < (closed ? 3 : 2)) return;
  const base = layerElevation();
  // above the layer, as add3DPolygons takes them
  add(corners.flatMap((p) => [p[0], p[1], p[2] - base]), closed);
  corners = [];
  show();
}

function clicked(hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  const v = appContext()?.view3d();
  if (!v) return;
  // the second click of a double-click ends it, adding nothing
  if (e.detail >= 2) {
    finish(false);
    return;
  }
  const first = corners[0] ? v.screenOf(corners[0]) : null;
  if (first && corners.length >= 3 && Math.hypot(e.clientX - first.x, e.clientY - first.y) <= CLOSE_PX) {
    finish(true);
    return;
  }
  const at = hit?.point ?? v.pointAtHeight(e, layerElevation() + settings.elevation);
  if (!at) {
    toast("That click met nothing to put a corner on: the view looks away from the Elevation's plane.", "info");
    return;
  }
  corners = [...corners, at];
  show();
}

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountPoly3dBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  finishBtn.addEventListener("click", () => finish(false));
  clearBtn.addEventListener("click", () => {
    corners = [];
    show();
  });
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "poly3d";
    if (now === active) return;
    active = now;
    corners = [];
    claim();
    show();
  });
  store.on("view3d", () => {
    corners = [];
    if (active) show();
    else bar.hidden = true;
  });
  on3d(claim);
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d || !corners.length) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Enter") finish(false);
      else if (e.key === "Escape") {
        corners = [];
        show();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

export class Poly3DTool extends PathTool {
  readonly id = "poly3d";
  protected readonly label = "3D Polygon";

  protected startHint(): string {
    return `Click the first corner, ${settings.elevation ? "at the Elevation in Preferences" : "on the layer's plane (Elevation in Preferences)"}`;
  }

  protected parts(points: Pt[], closed: boolean): Part[] {
    return [{ kind: "polygon", points, closed }];
  }

  protected finish(points: Pt[], closed: boolean): void {
    add(points.flatMap((p) => [p.x, p.y, settings.elevation]), closed);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("3D Polygon Preferences", [{ kind: "length", key: "elevation", label: "Elevation", value: settings.elevation, zero: true, signed: true }], "How far above the layer's plane corners clicked in Top/Plan lie, and those clicked on nothing in the 3D view.");
    if (v) settings.elevation = v.num("elevation");
  }
}
