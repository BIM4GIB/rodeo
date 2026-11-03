// The 3D Modeling set's Deform, working in the 3D view: Twist Solid, Twist Face, Taper Solid, Bulge Solid and
// Bend Solid. A click chooses a solid (Shift-click for more), the next sets the centre on the working plane if
// there is one, or else on the face clicked or the layer's plane, the next the reference line (or the end of the bend's spine), and the pointer then
// shows the angle or ratio until a click sets it; or it's typed. Rodeo has no solid-modeling kernel, so the solid
// comes back a mesh of many small faces (deformShapes.ts has the sums).

import type { Vec3 } from "../../core/index.ts";
import { anyAcross, bendMap, bendTooTight, bulgeMap, deformed, deformedAround, farHeight, mappedLines, pointsOf, sizeOfPoints, taperMap, twistFaceMap, twistMap, type Bend, type Frame, type PointMap } from "../deformShapes.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { faceAndNeighbours, solidEdges, solidFace, stitched, type SolidFace } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { activePlane, onWorkingPlanes } from "../workingPlanes.ts";
import { requestShow3d } from "./navigate3d.ts";

type Mode = "twist" | "twistface" | "taper" | "bulge" | "bend";

const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: "twist", label: "Twist Solid" },
  { id: "twistface", label: "Twist Face" },
  { id: "taper", label: "Taper Solid" },
  { id: "bulge", label: "Bulge Solid" },
  { id: "bend", label: "Bend Solid" },
];

const settings = { mode: "twist" as Mode, symmetric: true, finite: true };
/** last values, shown in the box */
const lastValue: Record<Mode, number> = { twist: 45, twistface: 45, taper: 1.5, bulge: 1.5, bend: 45 };

interface Chosen {
  readonly id: string;
  readonly tris: number[];
}

let active = false;
let chosen: Chosen[] = [];
/** 0 choosing what to deform, 1 the centre's placed, 2 the reference line (or the spine's end) too */
let step = 0;
let center: Vec3 = [0, 0, 0];
let normal: Vec3 = [0, 0, 1];
let reference: Vec3 | null = null;
/** Twist Face's face and what goes with it */
let face: { readonly face: SolidFace; readonly around: ReadonlySet<number> } | null = null;
/** the pointer on the plane */
let pointer: Vec3 | null = null;
/** the value the pointer has set; null until it's moved */
let tracked: number | null = null;
/** the pointer's way round the centre, for a twist past a full turn */
let lastTurn: number | null = null;

const isAngle = (): boolean => settings.mode === "twist" || settings.mode === "twistface" || settings.mode === "bend";
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lengthOf = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function status(): string {
  const bend = settings.mode === "bend";
  if (settings.mode === "twistface") {
    if (step === 0) return "Click the face to twist";
    return step === 1 ? "Click to set the reference line" : "Move to set the angle, then click. Or type it and press Enter";
  }
  if (step === 0) {
    if (!chosen.length) return "Click a solid. Shift-click for more";
    return `${chosen.length} chosen. ${bend ? "Click the bend's start" : "Click the centre"}, on a face or on the layer's plane. Shift-click for more`;
  }
  if (step === 1) return bend ? "Click the end of the bend's spine" : "Click to set the reference line";
  return isAngle() ? "Move to set the angle, then click. Or type it and press Enter" : "Move to set the ratio, then click. Or type it and press Enter";
}

const hint = (): string => `${status()} · Drag to orbit`;

function allPoints(): Vec3[] {
  return chosen.flatMap((c) => pointsOf(c.tris));
}

/** The frame the deformation's set out on, with what's been clicked or where the pointer is. */
function frameOf(): Frame {
  const to = reference ?? pointer;
  const off = to ? sub(to, center) : null;
  return { center, axis: normal, across: off && lengthOf(off) > 1e-6 ? unit(off) : anyAcross(normal) };
}

function bendOf(degrees: number): Bend | null {
  if (!reference) return null;
  const off = sub(reference, center);
  const length = lengthOf(off);
  if (length < 1e-6) return null;
  const along = unit(off);
  return { start: center, along, toward: unit(cross(normal, along)), length, degrees, symmetric: settings.symmetric, finite: settings.finite };
}

/** Where points go for this value, with what's been chosen. */
function mapFor(value: number): PointMap | null {
  const frame = frameOf();
  switch (settings.mode) {
    case "twist":
      return twistMap(frame, farHeight(allPoints(), frame), value);
    case "twistface": {
      if (!face) return null;
      const { mesh } = face.face;
      let low = 0;
      for (const i of face.around) for (const v of mesh.triangles[i]) low = Math.min(low, dot(sub(mesh.points[v], center), normal));
      return twistFaceMap(frame, low || -1, value);
    }
    case "taper":
      return taperMap(frame, farHeight(allPoints(), frame), value, settings.symmetric);
    case "bulge":
      return bulgeMap(frame, farHeight(allPoints(), frame), value, settings.symmetric);
    case "bend": {
      const b = bendOf(value);
      return b && bendMap(b);
    }
  }
}

/** The longest a triangle's side may be for this value. */
function longestFor(value: number): number {
  const size = sizeOfPoints(allPoints());
  return size / Math.max(24, isAngle() ? Math.abs(value) / 15 : 24);
}

function apply(value: number): void {
  if (!active || step === 0) return;
  if (settings.mode === "bend" && step < 2) return;
  if (isAngle() ? value === 0 : !(value > 0)) {
    toast(isAngle() ? "The angle can't be 0." : "The ratio must be more than 0.", "info");
    return;
  }
  const bend = settings.mode === "bend" ? bendOf(value) : null;
  if (bend && bendTooTight(allPoints(), bend)) {
    toast("That bend's too tight for this solid: its inside would pass through the bend's centre.", "info");
    return;
  }
  const map = mapFor(value);
  if (!map) return;
  const longest = longestFor(value);
  const done = attempt("Deform", (s) => {
    const around = face;
    return s.batch(() => chosen.map((c) => s.replaceSolid(c.id, settings.mode === "twistface" && around ? deformedAround(around.face, around.around, map, longest) : deformed(c.tris, map, longest))));
  });
  if (!done) return;
  lastValue[settings.mode] = value;
  reset();
  setSelection(done.value);
  show();
}

function reset(): void {
  chosen = [];
  step = 0;
  reference = null;
  face = null;
  pointer = null;
  tracked = null;
  lastTurn = null;
  valueInput.blur();
}

function trianglesOf(id: string | null): number[] | null {
  const s = store.session;
  if (!id || !s) return null;
  try {
    const { points, triangles } = stitched(s.solidTriangles(id));
    const flat: number[] = [];
    for (const [a, b, c] of triangles) flat.push(...points[a], ...points[b], ...points[c]);
    return flat;
  } catch {
    return null;
  }
}

function placeCenter(hit: FaceHit | null, e: MouseEvent): boolean {
  const v = appContext()?.view3d();
  if (!v) return false;
  // a working plane says where it goes, as an active plane does in Vectorworks
  const plane = activePlane();
  if (plane) {
    const up = cross(plane.x, plane.y);
    const at = v.pointOnPlane(e, plane.origin, up);
    if (!at) {
      toast("That click met nothing: the view looks along the working plane.", "info");
      return false;
    }
    center = at;
    normal = unit(up);
    return true;
  }
  if (hit) {
    center = hit.point;
    normal = unit(hit.normal);
    return true;
  }
  const elevation = store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
  const at = v.pointAtHeight(e, elevation);
  if (!at) {
    toast("Click on a face, or on the layer's plane.", "info");
    return false;
  }
  center = at;
  normal = [0, 0, 1];
  return true;
}

function clicked(hit: FaceHit | null, shift: boolean, e: MouseEvent): void {
  if (!active) return;
  const v = appContext()?.view3d();
  if (step === 2) {
    if (tracked !== null) apply(tracked);
    return;
  }
  if (step === 1) {
    const on = v?.pointOnPlane(e, center, normal);
    if (on && lengthOf(sub(on, center)) > 1e-6) {
      reference = on;
      step = 2;
      tracked = null;
      lastTurn = null;
    }
    show();
    return;
  }
  if (settings.mode === "twistface") {
    const tris = hit ? trianglesOf(hit.objectId) : null;
    if (!hit || !tris) {
      toast("Click a face of a solid.", "info");
      return;
    }
    const found = solidFace(tris, { point: hit.point, normal: hit.normal });
    if (typeof found === "string") {
      toast(found, "info");
      return;
    }
    chosen = [{ id: hit.objectId!, tris }];
    face = { face: found, around: faceAndNeighbours(found) };
    center = hit.point;
    normal = unit(found.normal);
    step = 1;
    choose();
    show();
    return;
  }
  if (shift || !chosen.length) {
    const tris = hit ? trianglesOf(hit.objectId) : null;
    if (!hit || !tris) {
      if (!shift) toast("That isn't a solid: click an extrude, multiple extrude, sweep, solid or mesh.", "info");
      return;
    }
    const had = chosen.some((c) => c.id === hit.objectId);
    chosen = had ? chosen.filter((c) => c.id !== hit.objectId) : [...chosen, { id: hit.objectId!, tris }];
    choose();
    show();
    return;
  }
  if (placeCenter(hit, e)) step = 1;
  show();
}

/** Selects what's chosen, and makes its layer the active one. */
function choose(): void {
  const s = store.session;
  const first = chosen[0];
  const obj = first ? s?.doc.object(first.id) : null;
  if (obj && obj.layerId !== store.activeLayerId) setActiveLayer(obj.layerId);
  setSelection(chosen.map((c) => c.id));
}

const valueInput = h("input", { cls: "menu-dialog-input solid-edit-value", attrs: { type: "text" } });
const statusLabel = h("span", { cls: "symbol-bar-label" });
const valueLabel = h("span", { cls: "symbol-bar-label" });
const applyBtn = h("button", { cls: "btn small primary", text: "Apply", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-name", text: "Deform" }), statusLabel, valueLabel, valueInput, applyBtn, clearBtn);

const ready = (): boolean => step === 2 || (step === 1 && settings.mode !== "bend");

function shownValue(value: number): string {
  return isAngle() ? `${Math.round(value * 100) / 100}°` : String(Math.round(value * 1000) / 1000);
}

function typedValue(): number | null {
  const n = Number(valueInput.value.replace("°", "").trim());
  return Number.isFinite(n) ? n : null;
}

function applyTyped(): void {
  if (!ready()) return;
  const value = typedValue();
  if (value === null) {
    toast(isAngle() ? "The angle must be a number of degrees." : "The ratio must be a number.", "info");
    return;
  }
  apply(value);
}

/** Lines to preview on: what's creased, and across a smooth object some sides of its triangles too. */
function previewBase(): [Vec3, Vec3][] {
  if (face) {
    const { mesh } = face.face;
    const seen = new Set<string>();
    const out: [Vec3, Vec3][] = [];
    for (const i of face.around) {
      const t = mesh.triangles[i];
      if (mesh.planeOf[i] === undefined) continue;
      for (let k = 0; k < 3; k++) {
        const [p, q] = [t[k], t[(k + 1) % 3]];
        const key = p < q ? `${p},${q}` : `${q},${p}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([mesh.points[p], mesh.points[q]]);
      }
    }
    return out;
  }
  return chosen.flatMap((c) => {
    const edges = solidEdges(c.tris);
    if (edges.length >= 6) return edges.map((e): [Vec3, Vec3] => [e.a, e.b]);
    const points = pointsOf(c.tris);
    const out: [Vec3, Vec3][] = [];
    const every = Math.max(1, Math.ceil(points.length / 3 / 300));
    for (let i = 0; i + 2 < points.length; i += 3 * every) out.push([points[i], points[i + 1]], [points[i + 1], points[i + 2]]);
    return out;
  });
}

let previewFrom: [Vec3, Vec3][] = [];

/** A protractor: a ring on the plane, the axis through it and the lines from the centre. */
function protractor(): number[] {
  const size = sizeOfPoints(allPoints()) / 3;
  const across = anyAcross(normal);
  const other = cross(normal, across);
  const out: number[] = [];
  const at = (a: number): Vec3 => [center[0] + (across[0] * Math.cos(a) + other[0] * Math.sin(a)) * size, center[1] + (across[1] * Math.cos(a) + other[1] * Math.sin(a)) * size, center[2] + (across[2] * Math.cos(a) + other[2] * Math.sin(a)) * size];
  for (let i = 0; i < 48; i++) out.push(...at((i * Math.PI) / 24), ...at(((i + 1) * Math.PI) / 24));
  out.push(center[0] - normal[0] * size, center[1] - normal[1] * size, center[2] - normal[2] * size, center[0] + normal[0] * size, center[1] + normal[1] * size, center[2] + normal[2] * size);
  if (reference) out.push(...center, ...reference);
  if (pointer) out.push(...center, ...pointer);
  return out;
}

function drawLines(): void {
  const v = appContext()?.view3d();
  if (!v) return;
  if (!active) return;
  const lines: number[] = [];
  if (chosen.length && step > 0) lines.push(...protractor());
  if (chosen.length) {
    const value = step === 2 ? tracked : null;
    const map = value !== null ? mapFor(value) : null;
    const size = sizeOfPoints(allPoints());
    lines.push(...mappedLines(previewFrom, map ?? ((p) => p), map ? size / 16 : Infinity));
  }
  v.setHighlightLines(lines.length ? lines : null);
}

/** Brings the bar and the lines over the 3D view up to date. */
function show(): void {
  bar.hidden = !active || !store.view3d;
  if (active) {
    statusLabel.textContent = status();
    valueLabel.textContent = isAngle() ? "Angle" : "Ratio";
    valueInput.setAttribute("aria-label", isAngle() ? "Angle" : "Ratio");
    if (document.activeElement !== valueInput) valueInput.value = shownValue(tracked ?? lastValue[settings.mode]);
    applyBtn.disabled = !ready();
    clearBtn.disabled = !chosen.length;
    store.setHint(hint());
    previewFrom = chosen.length ? previewBase() : [];
  }
  drawLines();
}

function follow(e: PointerEvent): void {
  if (!active || step === 0 || e.buttons || !(e.target instanceof HTMLCanvasElement) || document.activeElement === valueInput) return;
  const v = appContext()?.view3d();
  if (!v) return;
  const on = v.pointOnPlane(e, center, normal);
  if (!on) return;
  pointer = on;
  if (step === 2 && reference) {
    const from = sub(reference, center);
    const off = sub(on, center);
    if (isAngle() && settings.mode !== "bend") {
      const turn = Math.atan2(dot(cross(from, off), normal), dot(from, off));
      if (lastTurn === null) tracked = (turn * 180) / Math.PI;
      else {
        let step_ = turn - lastTurn;
        if (step_ > Math.PI) step_ -= 2 * Math.PI;
        else if (step_ < -Math.PI) step_ += 2 * Math.PI;
        tracked = (tracked ?? 0) + (step_ * 180) / Math.PI;
      }
      lastTurn = turn;
    } else if (settings.mode === "bend") {
      // the spine's end stays on the line from its start to the pointer, which is half the bend's turn
      const along = unit(from);
      const toward = cross(normal, along);
      tracked = (2 * Math.atan2(dot(off, toward), dot(off, along)) * 180) / Math.PI;
    } else tracked = Math.max(0.01, lengthOf(off) / Math.max(lengthOf(from), 1e-6));
    valueInput.value = shownValue(tracked ?? 0);
  }
  drawLines();
}

/** Puts the bar over the drawing, and has the tool take the 3D view's clicks while it's in use. */
export function mountDeformBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  applyBtn.addEventListener("click", applyTyped);
  clearBtn.addEventListener("click", () => {
    reset();
    show();
  });
  window.addEventListener("pointermove", follow);
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "deform";
    if (now !== active) {
      const was = active;
      active = now;
      reset();
      if (was) {
        bar.hidden = true;
        appContext()?.view3d()?.setHighlightLines(null);
      }
    }
    claim();
    if (active) show();
  });
  store.on("view3d", () => {
    if (active) show();
    else bar.hidden = true;
  });
  // a drawing opened, or an undo: what was chosen may be gone
  store.on("session", () => {
    if (!active || !chosen.length) return;
    if (chosen.some((c) => !store.session?.doc.object(c.id))) {
      reset();
      show();
    }
  });
  on3d(claim);
  // not while a working plane waits for a face, but once it's had it
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!active || !store.view3d) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing && e.target !== valueInput) return;
      if (e.key === "Enter" && ready()) {
        e.preventDefault();
        e.stopPropagation();
        applyTyped();
      } else if (e.key === "Escape" && chosen.length) {
        e.preventDefault();
        e.stopPropagation();
        reset();
        show();
      }
    },
    true,
  );
}

export class DeformTool extends BaseTool {
  readonly id = "deform";
  readonly cursor = "crosshair";

  hint(): string {
    return hint();
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    const groups: ToolModes[] = [{ label: "Deform", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.mode }];
    if (settings.mode === "taper" || settings.mode === "bulge" || settings.mode === "bend") {
      groups.push({ label: "Symmetric", options: [{ id: "symmetric", label: "Symmetric", key: "6" }, { id: "oneway", label: "One Way", key: "7" }], active: settings.symmetric ? "symmetric" : "oneway" });
    }
    if (settings.mode === "bend") groups.push({ label: "Length", options: [{ id: "finite", label: "Finite Length", key: "8" }, { id: "whole", label: "Whole Object", key: "9" }], active: settings.finite ? "finite" : "whole" });
    return groups;
  }

  setMode(id: string): void {
    const m = MODES.find((x) => x.id === id);
    if (m) {
      settings.mode = m.id;
      reset();
    } else if (id === "symmetric" || id === "oneway") settings.symmetric = id === "symmetric";
    else if (id === "finite" || id === "whole") settings.finite = id === "finite";
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
