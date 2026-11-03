// The 3D Modeling set's Project: a 2D object or 3D polygon projected along the normal of its plane onto a solid
// or surface. It works in the 3D view, showing it when picked: click the curve, then the object. Split leaves
// the pieces in a group. Trim then asks which side to take away. Add stands a rib on the solid, the closed
// curve swept Upward, Downward or both ways until it meets the first face. The curve is left where it was. Sums
// in projectShapes.ts; the results are meshes, as Rodeo has no solid-modeling kernel.

import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { curveNormal, isOnPlane, ribOn, ringOf, splitBy, trimBy, type ProjectedCurve } from "../projectShapes.ts";
import { healed, isClosedMesh, type Vec3 } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { errorMessage, toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { curveUnder, findCandidates, segmentsOf, type Candidate } from "./loftSurface.ts";
import { requestShow3d } from "./navigate3d.ts";

type Mode = "split" | "trim" | "add";
type Way = "up" | "down" | "both";

const settings = { mode: "split" as Mode, way: "down" as Way };

let active = false;
let candidates: readonly Candidate[] = [];
/** the curve chosen */
let curve: Candidate | null = null;
/** the object being trimmed, while Trim waits for the side to take away */
let target: { id: string; tris: number[]; ring: readonly Vec3[]; normal: Vec3 } | null = null;

const asCurve = (c: Candidate): ProjectedCurve => ({ points: c.curve.points as unknown as readonly Vec3[], closed: c.curve.closed });

function status(): string {
  if (target) return "Click the side of the curve to take away";
  return curve ? "Click the solid or surface to project it onto" : "Click the curve to project: a 2D object or 3D polygon";
}

const hintText = (): string => `${status()} · Esc starts over · Drag to orbit`;

function reset(): void {
  curve = null;
  target = null;
}

const statusLabel = h("span", { cls: "symbol-bar-label" });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Project" }), statusLabel, clearBtn);

function show(): void {
  bar.hidden = !active || !store.view3d;
  const v = appContext()?.view3d();
  if (!active) {
    return;
  }
  statusLabel.textContent = status();
  clearBtn.disabled = !curve;
  store.setHint(hintText());
  if (!v) return;
  const lines = curve ? [...segmentsOf(curve.curve)] : [];
  // the way it will go, from the middle of the curve
  if (curve && settings.mode === "add") {
    const points = asCurve(curve).points;
    const normal = curveNormal(asCurve(curve));
    const middle = points.reduce<[number, number, number]>((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length, sum[2] + p[2] / points.length], [0, 0, 0]);
    let reach = 0;
    for (const p of points) reach = Math.max(reach, Math.hypot(p[0] - middle[0], p[1] - middle[1], p[2] - middle[2]));
    for (const w of settings.way === "both" ? [1, -1] : settings.way === "up" ? [1] : [-1]) lines.push(...middle, middle[0] + normal[0] * reach * w, middle[1] + normal[1] * reach * w, middle[2] + normal[2] * reach * w);
  }
  v.setHighlightLines(lines, curve ? [] : candidates.flatMap((c) => segmentsOf(c.curve)));
}

/** The object's triangles, or null having said why it won't do. */
function solidAt(id: string | null): number[] | null {
  const s = store.session;
  if (!id || !s) {
    toast("That isn't a solid or surface: click an extrude, multiple extrude, sweep, solid or mesh.", "info");
    return null;
  }
  try {
    const raw = s.solidTriangles(id);
    return isClosedMesh(raw) ? healed(raw) : Array.from(raw);
  } catch (err) {
    toast(`${errorMessage(err)[0].toUpperCase()}${errorMessage(err).slice(1)}.`, "info");
    return null;
  }
}

/** Puts `pieces` in the object's place, grouped when there are several. */
function replaceWith(id: string, pieces: readonly (readonly number[])[], label: string): void {
  const s = store.session;
  const o = s?.doc.object(id);
  if (!s || !o) return;
  const base = s.doc.layers().find((l) => l.id === o.layerId)?.elevation ?? 0;
  const done = attempt(label, (e) =>
    e.batch(() => {
      if (pieces.length === 1) return e.replaceSolid(id, pieces[0]);
      const parts = pieces.map((flat) => {
        const faces: number[][] = [];
        for (let i = 0; i + 8 < flat.length; i += 9) faces.push(flat.slice(i, i + 9).map((v, k) => (k % 3 === 2 ? v - base : v)));
        return faces;
      });
      const made = e.addMeshes(o.layerId, parts, o.classIndex, o.attrs ?? undefined);
      e.deleteObjects([id]);
      return e.groupObjects(made);
    }),
  );
  reset();
  candidates = findCandidates();
  if (done) setSelection([done.value]);
}

function onObject(hit: FaceHit): void {
  if (!curve) return;
  const id = hit.objectId;
  if (id === curve.id) return;
  const tris = solidAt(id);
  if (!id || !tris) return;
  const o = store.session?.doc.object(id);
  if (o && o.layerId !== store.activeLayerId) setActiveLayer(o.layerId);
  const projected = asCurve(curve);
  const normal = curveNormal(projected);
  if (settings.mode === "add") {
    if (!projected.closed || !isOnPlane(projected, normal)) {
      toast("Add needs a curve that's closed and lies on one plane.", "info");
      return;
    }
    const ring = ringOf(projected, normal, tris);
    if (typeof ring === "string") return void toast(ring, "info");
    const made = ribOn(tris, ring, normal, settings.way === "both" ? [1, -1] : settings.way === "up" ? [1] : [-1]);
    if (typeof made === "string") return void toast(made, "info");
    replaceWith(id, [made], "Project");
    return;
  }
  const ring = ringOf(projected, normal, tris);
  if (typeof ring === "string") return void toast(ring, "info");
  if (settings.mode === "trim") {
    target = { id, tris, ring, normal };
    return;
  }
  const pieces = splitBy(tris, ring, normal);
  if (typeof pieces === "string") return void toast(pieces, "info");
  replaceWith(id, pieces, "Project");
}

function clicked(hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  if (target) {
    if (!hit || hit.objectId !== target.id) {
      toast("Click on the object, on the side of the curve to take away.", "info");
      return;
    }
    const pieces = trimBy(target.tris, target.ring, target.normal, hit.point);
    if (typeof pieces === "string") toast(pieces, "info");
    else replaceWith(target.id, pieces, "Project");
    target = null;
  } else if (!curve) {
    const under = curveUnder(e, candidates);
    if (under) curve = under.candidate;
    else toast("Click nearer a curve: a 3D polygon, or a 2D shape on the active layer.", "info");
  } else if (!hit) {
    toast("Click on a solid or surface.", "info");
  } else {
    onObject(hit);
  }
  show();
}

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountProjectBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  clearBtn.addEventListener("click", () => {
    reset();
    show();
  });
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "project";
    if (now === active) return;
    active = now;
    reset();
    candidates = now ? findCandidates() : [];
    if (!now) appContext()?.view3d()?.setHighlightLines(null);
    claim();
    show();
  });
  store.on("view3d", () => {
    if (active) candidates = findCandidates();
    show();
  });
  store.on("session", () => {
    if (!active) return;
    candidates = findCandidates();
    if (curve && !candidates.some((c) => c.id === curve?.id)) reset();
    show();
  });
  on3d(() => {
    claim();
    show();
  });
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d || e.key !== "Escape" || !curve) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      reset();
      show();
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

export class ProjectTool extends BaseTool {
  readonly id = "project";
  readonly cursor = "crosshair";

  hint(): string {
    return hintText();
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    const groups: ToolModes[] = [{ label: "Project", options: [{ id: "split", label: "Split", key: "1" }, { id: "trim", label: "Trim", key: "2" }, { id: "add", label: "Add", key: "3" }], active: settings.mode }];
    if (settings.mode === "add") {
      groups.push({ label: "Direction", options: [{ id: "up", label: "Add Upward", key: "4" }, { id: "down", label: "Add Downward", key: "5" }, { id: "both", label: "Add Both Directions", key: "6" }], active: settings.way });
    }
    return groups;
  }

  setMode(id: string): void {
    if (id === "split" || id === "trim" || id === "add") {
      if (settings.mode === id) return;
      settings.mode = id;
      target = null;
    } else if (id === "up" || id === "down" || id === "both") {
      settings.way = id;
    }
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
