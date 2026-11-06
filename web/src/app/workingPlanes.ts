// Working planes, as Vectorworks' Working Planes palette and the View bar's active plane keep
// them. The active plane is the layer plane (level, the active layer's own) or a working plane
// set on a face of the 3D view, drawn there as a grid with its x axis red and its y axis green.
// Working planes can be saved by name, made active again, renamed, deleted and looked at square
// on. Saved planes are kept per file name in this browser, as saved views are (the planes a
// drawing saves in Vectorworks aren't read yet). Drawing on a working plane isn't there yet: the
// 2D tools draw on the layer plane.
//
// Modify > Working Plane has Vectorworks' commands: set, look at and save the plane, go back and
// forward through the last ten planes made active, align it with the view or the layer plane, and
// turn it 90° or flip it about its own axes, its origin kept. "Left" is counter-clockwise looking
// from the axis's positive end toward the origin. A plane changed so is unsaved until saved.

import type { Vec3 } from "../core/index.ts";
import "./workingPlanes.css";
import { editInline, h } from "./dom.ts";
import { appContext, on3d } from "./ext.ts";
import type { Row } from "./menu.ts";
import { whyIn } from "./menuReasons.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLength } from "./units.ts";
import type { FaceHit, View3D } from "./view3d.ts";

export interface WorkingPlane {
  name: string;
  readonly origin: Vec3;
  /** its x and y axes, unit and square; x × y is up from it */
  readonly x: Vec3;
  readonly y: Vec3;
}

const STORAGE_PREFIX = "openvwx.workingPlanes.";

/** the active working plane; null is the layer plane */
let active: WorkingPlane | null = null;
/** the drawing's saved planes */
let saved: WorkingPlane[] = [];
/** the file name they are kept under, and the drawing they were loaded for */
let loadedName = "";
let loadedFor: unknown = null;
/** waiting for a click on a face of the 3D view */
let choosing = false;
/** the planes active before the active one (Previous Working Plane) and after it (Next), nearest last */
let back: (WorkingPlane | null)[] = [];
let ahead: (WorkingPlane | null)[] = [];
const KEPT = 10;
const listeners = new Set<() => void>();

function changed(): void {
  show3d(appContext()?.view3d() ?? null);
  for (const fn of listeners) fn();
}

/** Shows the active plane in the 3D view, and whether it waits for a face. */
function show3d(v: View3D | null): void {
  if (!v) return;
  v.setPlaneGrid(active);
  // the 3D Modeling set's edit tools take these clicks too, so leave them theirs
  if (choosing) v.onFacePick = chooser;
  else if (v.onFacePick === chooser) v.onFacePick = null;
}

const chooser = (hit: FaceHit | null): void => chose(hit);

on3d(show3d);

/** Calls `fn` whenever the active plane, the saved planes or the choosing of a face change; returns a function that stops it. */
export function onWorkingPlanes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function activePlane(): WorkingPlane | null {
  return active;
}

export function savedPlanes(): readonly WorkingPlane[] {
  return saved;
}

export function isChoosingFace(): boolean {
  return choosing;
}

/** Makes `plane` the active one (null: the layer plane), keeping the one it replaces for Previous Working Plane. */
export function setActivePlane(plane: WorkingPlane | null): void {
  if (plane !== active) {
    back = [...back, active].slice(-KEPT);
    ahead = [];
  }
  active = plane;
  choosing = false;
  changed();
}

/**
 * The plane through `hit` square to its face: its x axis the drawing's x laid on it (its y where
 * the face is square to x), its y axis square to that on the face.
 */
export function planeOnFace(hit: FaceHit, name = "Working Plane"): WorkingPlane {
  const n = unit(hit.normal);
  const along = (a: Vec3): Vec3 => {
    const d = dot(a, n);
    return [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d];
  };
  const fromX = along([1, 0, 0]);
  const x = unit(length(fromX) > 0.1 ? fromX : along([0, 1, 0]));
  return { name, origin: hit.point, x, y: cross(n, x) };
}

/** Waits for a click on a face of the 3D view (showing it first) to set the working plane there; again, stops waiting. */
export async function chooseFace(): Promise<void> {
  if (choosing) {
    choosing = false;
    changed();
    return;
  }
  const ctx = appContext();
  if (!ctx || !store.session) return;
  const v = await ctx.show3d();
  if (!v) return;
  choosing = true;
  changed();
  toast("Click a face in the 3D view to set the working plane on it.", "info");
}

function chose(hit: FaceHit | null): void {
  if (!hit) {
    toast("That click met no face: click a face of the model.", "info");
    return;
  }
  setActivePlane(planeOnFace(hit, freeName()));
}

/** Looks square on at the active plane in the 3D view (the layer plane from above). */
export async function lookAtPlane(): Promise<void> {
  const ctx = appContext();
  if (!ctx || !store.session) return;
  const v = await ctx.show3d();
  if (!v) return;
  v.lookAlong(active ? cross(active.x, active.y) : [0, 0, 1]);
}

/** Keeps the active working plane among the drawing's saved planes under `name`; false when the layer plane is active. */
export function savePlane(name: string): boolean {
  if (!active) return false;
  const plane = saved.includes(active) ? { ...active } : active;
  plane.name = name.trim() || freeName();
  saved.push(plane);
  active = plane;
  persist();
  changed();
  return true;
}

export function renamePlane(plane: WorkingPlane, name: string): void {
  if (!name.trim()) return;
  plane.name = name.trim();
  persist();
  changed();
}

export function deletePlane(plane: WorkingPlane): void {
  saved = saved.filter((p) => p !== plane);
  persist();
  changed();
}

/** "Working Plane 1", "Working Plane 2", ...: the first not already saved. */
function freeName(): string {
  const taken = new Set(saved.map((p) => p.name));
  let n = 1;
  while (taken.has(`Working Plane ${n}`)) n++;
  return `Working Plane ${n}`;
}

/** The View bar's Active Plane pop-up: the layer plane, the saved planes and an unsaved working plane, then what sets and shows them. */
export function workingPlaneRows(openPalette: () => void): Row[] {
  const plane = (p: WorkingPlane): Row => ({ label: p.name, checked: () => active === p, run: () => setActivePlane(p) });
  const loose = active && !saved.includes(active) ? active : null;
  return [
    { label: "Layer Plane", checked: () => active === null, run: () => setActivePlane(null) },
    ...saved.map(plane),
    ...(loose ? [{ label: `${loose.name} (unsaved)`, checked: () => active === loose, run: () => setActivePlane(loose) }] : []),
    "-",
    { label: "Set on a Face", checked: () => choosing, enabled: () => !!store.session, run: () => void chooseFace() },
    { label: "Look at Plane", enabled: () => !!store.session, run: () => void lookAtPlane() },
    { label: "Working Planes Palette", run: openPalette },
  ];
}

export function canPreviousPlane(): boolean {
  return back.length > 0;
}

export function canNextPlane(): boolean {
  return ahead.length > 0;
}

/** Previous Working Plane and Next Working Plane: back or forward through the planes made active. */
export function stepPlane(forward: boolean): void {
  const from = forward ? ahead : back;
  if (!from.length) return;
  const plane = from[from.length - 1];
  if (forward) {
    ahead = ahead.slice(0, -1);
    back = [...back, active].slice(-KEPT);
  } else {
    back = back.slice(0, -1);
    ahead = [...ahead, active];
  }
  active = plane;
  choosing = false;
  changed();
}

/** The layer plane as a working plane: level at the active layer's elevation, its axes the drawing's. */
function layerPlane(): WorkingPlane {
  const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
  return { name: "Layer Plane", origin: [0, 0, layer?.kind === "design" ? (layer.elevation ?? 0) : 0], x: [1, 0, 0], y: [0, 1, 0] };
}

/** Makes the active plane (the layer plane when none is) take axes `x` and `y`, its origin kept: unsaved, under its own name when it was unsaved already. */
function reorient(x: Vec3, y: Vec3): void {
  const from = active ?? layerPlane();
  const name = active && !saved.includes(active) ? active.name : freeName();
  setActivePlane({ name, origin: from.origin, x: tidy(x), y: tidy(y) });
}

/**
 * Turns the active plane `deg` degrees about its own x (0), y (1) or z (2) axis, counter-clockwise
 * looking from that axis's positive end toward the origin; 180° flips it about that axis.
 */
export function turnPlane(axis: 0 | 1 | 2, deg: number): void {
  const p = active ?? layerPlane();
  const k = [p.x, p.y, cross(p.x, p.y)][axis];
  const a = (deg * Math.PI) / 180;
  reorient(turn(p.x, k, a), turn(p.y, k, a));
}

/** Align Working Plane with Layer Plane: the drawing's axes, the origin kept. */
export function alignPlaneWithLayer(): void {
  reorient([1, 0, 0], [0, 1, 0]);
}

/** Align Working Plane X Axis with Layer Plane: turned about its z axis till its x axis lies level (the drawing's x on a level plane). */
export function alignPlaneXWithLayer(): void {
  const p = active;
  if (!p) return;
  const n = cross(p.x, p.y);
  const level = cross([0, 0, 1], n);
  let x: Vec3 = length(level) > 1e-9 ? unit(level) : [1, 0, 0];
  if (length(level) > 1e-9 && dot(x, p.x) < 0) x = [-x[0], -x[1], -x[2]];
  reorient(x, cross(n, x));
}

/** Align Working Plane with Current View: its z axis toward the viewer, its x the screen's right (the plan looks straight down). */
export function alignPlaneWithView(): void {
  const v = store.view3d ? appContext()?.view3d() : null;
  if (!v) return reorient([1, 0, 0], [0, 1, 0]);
  const { right, up } = v.currentView();
  reorient(right, up);
}

/** Save Working Plane…: the active plane kept among the drawing's planes under a name typed. */
export async function savePlaneDialog(): Promise<void> {
  if (!active) return;
  const input = h("input", {
    cls: "menu-dialog-input",
    value: saved.includes(active) ? freeName() : active.name,
    attrs: { type: "text", "aria-label": "Name" },
  });
  const name = await showDialog<string>({
    title: "Save Working Plane",
    okLabel: "Save",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
    check: () => {
      const n = input.value.trim();
      if (!n) return { error: "Enter a name for the working plane.", focus: input };
      if (saved.some((p) => p.name === n)) return { error: `A working plane named ${n} is saved already.`, focus: input };
      return { value: n };
    },
  });
  if (name) savePlane(name);
}

/** Modify > Working Plane. */
export function workingPlaneMenuRows(): Row[] {
  const doc = (): boolean => !!store.session;
  const turnRow = (axis: 0 | 1 | 2, left: boolean): Row => ({
    label: `Rotate About ${"XYZ"[axis]}' ${left ? "Left" : "Right"} 90°`,
    enabled: doc,
    run: () => turnPlane(axis, left ? 90 : -90),
  });
  const flipRow = (axis: 0 | 1 | 2): Row => ({ label: `Flip ${"XYZ"[axis]}'`, enabled: doc, run: () => turnPlane(axis, 180) });
  return [
    { label: "Set Working Plane", checked: () => choosing, enabled: doc, run: () => void chooseFace() },
    { label: "Look at Working Plane", enabled: doc, run: () => void lookAtPlane() },
    { label: "Save Working Plane…", why: whyIn("Set a working plane first: Modify › Working Plane › Set Working Plane"), enabled: () => doc() && active !== null, run: () => void savePlaneDialog() },
    { label: "Previous Working Plane", why: whyIn("There's no earlier working plane"), enabled: () => doc() && canPreviousPlane(), run: () => stepPlane(false) },
    { label: "Next Working Plane", why: whyIn("There's no later working plane"), enabled: () => doc() && canNextPlane(), run: () => stepPlane(true) },
    "-",
    { label: "Align Working Plane with Current View", enabled: doc, run: alignPlaneWithView },
    { label: "Align Working Plane with Layer Plane", why: whyIn("Set a working plane first: Modify › Working Plane › Set Working Plane"), enabled: () => doc() && active !== null, run: alignPlaneWithLayer },
    { label: "Align Working Plane X Axis with Layer Plane", why: whyIn("Set a working plane first: Modify › Working Plane › Set Working Plane"), enabled: () => doc() && active !== null, run: alignPlaneXWithLayer },
    "-",
    turnRow(0, true),
    turnRow(0, false),
    turnRow(1, true),
    turnRow(1, false),
    turnRow(2, true),
    turnRow(2, false),
    "-",
    flipRow(0),
    flipRow(1),
    flipRow(2),
  ];
}

/** Follows the open drawing: a newly opened one shows the layer plane and the planes saved under its file name. */
function sync(): void {
  const session = store.session;
  const name = session ? store.fileName : "";
  if (session === loadedFor && name === loadedName) return;
  if (session && session === loadedFor) {
    // Save As: the planes go with the drawing to its new name
    loadedName = name;
    persist();
    return;
  }
  loadedFor = session;
  loadedName = name;
  saved = name ? load(name) : [];
  active = null;
  back = [];
  ahead = [];
  choosing = false;
  changed();
}

store.on(["session", "file"], sync);

function persist(): void {
  if (!loadedName) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + loadedName, JSON.stringify(saved));
  } catch {
    // storage full or blocked: the planes last for this visit
  }
}

function load(name: string): WorkingPlane[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + name) ?? "[]");
    return Array.isArray(data) ? data.flatMap((r) => parsePlane(r) ?? []) : [];
  } catch {
    return [];
  }
}

function parsePlane(raw: unknown): WorkingPlane | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));
  if (typeof r.name !== "string" || !vec(r.origin) || !vec(r.x) || !vec(r.y)) return null;
  // axes unit and square, or not a plane
  if (Math.abs(length(r.x) - 1) > 1e-6 || Math.abs(length(r.y) - 1) > 1e-6 || Math.abs(dot(r.x, r.y)) > 1e-6) return null;
  return { name: r.name, origin: r.origin, x: r.x, y: r.y };
}

/** The Working Planes palette: the layer plane and the saved planes, the active one marked, and Set on Face, Look At and Save. */
export function workingPlanesPalette(): HTMLElement {
  const root = h("div", { cls: "working-planes" });
  const btnFace = h("button", { cls: "btn", text: "Set on Face", title: "Click a face in the 3D view to set the working plane on it" });
  const btnLook = h("button", { cls: "btn", text: "Look At", title: "Look square on at the active plane in the 3D view" });
  const btnSave = h("button", { cls: "btn", text: "Save", title: "Keep the working plane under a name" });
  const nameInput = h("input", { cls: "search", attrs: { type: "text", "aria-label": "Name of the working plane" } });
  const btnOk = h("button", { cls: "btn", text: "Save" });
  const btnCancel = h("button", { cls: "btn", text: "Cancel" });
  const addRow = h("div", { cls: "toolbar sub", hidden: true }, nameInput, btnOk, btnCancel);
  const info = h("div", { cls: "muted working-plane-info" });
  const list = h("div", { cls: "list" });
  root.append(h("div", { cls: "toolbar" }, btnFace, btnLook, btnSave), addRow, info, list);

  const closeAdd = (): void => {
    addRow.hidden = true;
  };
  const commitAdd = (): void => {
    savePlane(nameInput.value);
    closeAdd();
  };
  btnFace.addEventListener("click", () => void chooseFace());
  btnLook.addEventListener("click", () => void lookAtPlane());
  btnSave.addEventListener("click", () => {
    if (!active) return;
    nameInput.value = saved.includes(active) ? freeName() : active.name;
    addRow.hidden = false;
    nameInput.focus();
    nameInput.select();
  });
  btnOk.addEventListener("click", commitAdd);
  btnCancel.addEventListener("click", closeAdd);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAdd();
    }
  });

  const row = (label: string, sub: string, isActive: boolean, activate: () => void, plane: WorkingPlane | null): HTMLElement => {
    const nameText = h("div", { cls: "name", text: label, title: plane ? "Double-click to rename" : "" });
    const names = h("div", { cls: "names" }, nameText, h("div", { cls: "sub", text: sub }));
    const el = h("div", { cls: `row${isActive ? " active" : ""}`, title: "Click to make it the active plane" }, names);
    el.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("input, button")) return;
      activate();
    });
    if (plane) {
      const del = h("button", { cls: "icon-btn view-del", text: "×", title: "Delete this working plane", attrs: { "aria-label": `Delete ${plane.name}` } });
      del.addEventListener("click", () => deletePlane(plane));
      el.append(del);
      nameText.addEventListener("dblclick", () =>
        editInline(nameText, [plane.name], (vals) => {
          if (vals?.[0]?.trim()) renamePlane(plane, vals[0]);
          else render();
        }),
      );
    }
    return el;
  };

  function render(): void {
    const doc = store.session?.doc;
    const units = doc?.info.units;
    for (const b of [btnFace, btnLook]) b.disabled = !doc;
    btnSave.disabled = !doc || !active;
    btnFace.classList.toggle("active", choosing);
    btnFace.setAttribute("aria-pressed", String(choosing));
    if (!doc) {
      info.textContent = "";
      list.replaceChildren(h("div", { cls: "empty", text: "No drawing open" }));
      return;
    }
    info.textContent = choosing ? "Click a face in the 3D view…" : describe(active, units);
    const loose = active && !saved.includes(active) ? active : null;
    list.replaceChildren(
      row("Layer Plane", "Level, on the active layer", active === null, () => setActivePlane(null), null),
      ...saved.map((p) => row(p.name, facing(p), active === p, () => setActivePlane(p), p)),
      ...(loose ? [row(`${loose.name} (unsaved)`, facing(loose), true, () => setActivePlane(loose), null)] : []),
    );
  }
  onWorkingPlanes(render);
  store.on(["session"], render);
  render();
  return root;
}

/** Where a plane lies, in the drawing's units: its origin and the way it faces. */
function describe(p: WorkingPlane | null, units: string | undefined): string {
  if (!p) return "Active: the layer plane";
  const [x, y, z] = p.origin;
  return `Active: ${p.name} · origin ${formatLength(x, units)}, ${formatLength(y, units)}, ${formatLength(z, units)} · ${facing(p)}`;
}

/** Which way a plane faces: level, upright (and its bearing) or tilted (by how far from level). */
function facing(p: WorkingPlane): string {
  const n = cross(p.x, p.y);
  const tilt = (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;
  if (tilt < 0.05) return n[2] > 0 ? "Level, facing up" : "Level, facing down";
  if (Math.abs(tilt - 90) < 0.05) return `Upright, facing ${Math.round(((Math.atan2(n[0], n[1]) * 180) / Math.PI + 360) % 360)}°`;
  return `Tilted ${Math.round(tilt * 10) / 10}° from level`;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function unit(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** `v` turned `a` radians about the unit axis `k` (Rodrigues), counter-clockwise looking down `k` toward the origin. */
function turn(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = cross(k, v);
  const d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** A unit axis without the float dust a right-angle turn leaves (cos 90° is 6e-17). */
function tidy(a: Vec3): Vec3 {
  const c = (n: number): number => (Math.abs(n) < 1e-12 ? 0 : n);
  return unit([c(a[0]), c(a[1]), c(a[2])]);
}
