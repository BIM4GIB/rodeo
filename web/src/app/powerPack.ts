// Model > 3D Power Pack's commands past the Helix-Spiral, on the selection. Rodeo has no NURBS surfaces: each
// makes a mesh of flat pieces (Unfold Surfaces, polygons), from solids and meshes, and from curves that are
// 3D polygons or 2D shapes; Extend and Rebuild NURBS change 3D polygons and meshes.

import { MAX_CSG_TRIANGLES } from "../core/csg.ts";
import type { ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { SOLID_OPERANDS } from "./compose.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { loftFaces, loftWires, type LoftCurve, type Point3 } from "./loftShapes.ts";
import { showDialog } from "./menubar.ts";
import {
  drapeFaces,
  extendedCurve,
  filletSurface,
  openSurface,
  planarCaps,
  railedRevolve,
  rebuiltCurve,
  rebuiltSurface,
  stitchAndTrim,
  surfaceExtension,
  surfaceFromCurves,
  unfolded,
  type ExtendKind,
  type FilletOptions,
  type FilletSection,
} from "./powerPackShapes.ts";
import { isDerivedId } from "./scene.ts";
import { isClosedMesh } from "./solidOps.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** a mesh's and a 3D polygon's record types */
const MESH = 40;
const POLY3D = 25;
/** past this many triangles the sums take too long to run in a menu command */
const MAX_TRIANGLES = 20000;
/** the most points a drape can have each way */
const MAX_DRAPE_POINTS = 200;
/** the most points to a rebuilt curve, or each way of a rebuilt surface */
const MAX_REBUILD_POINTS = 100;

/** The dialog's last point counts, kept for the next time. */
const drape = { u: 25, v: 25 };

/** The selected objects at the level being edited. */
function selectedObjects(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  const objects = s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id));
  // in the order they were selected, which Revolve with Rail goes by
  const order = [...store.selection];
  return objects.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

const isSolid = (o: ObjectInfo): boolean => SOLID_OPERANDS.has(o.type) || o.type === MESH;

/** The active layer's elevation: curves and faces read in the model, and a mesh is added by its height above the layer. */
function layerBase(): number {
  return store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
}

/** Faces (flat x y z lists) in the model, as heights above the active layer. */
function aboveLayer(faces: readonly (readonly number[])[]): number[][] {
  const base = layerBase();
  return faces.map((f) => f.map((v, i) => (i % 3 === 2 ? v - base : v)));
}

/** The selected curves' points, in the order they were selected; those that aren't curves are left out. */
function selectedCurves(): { readonly id: string; readonly curve: LoftCurve }[] {
  const s = store.session;
  if (!s) return [];
  return selectedObjects().flatMap((o) => {
    const c = s.curvePoints(o.id);
    return c && c.points.length > 1 ? [{ id: o.id, curve: { points: c.points as unknown as Point3[], closed: c.closed } }] : [];
  });
}

// ---- Create Planar Caps -----------------------------------------------------

export function canPlanarCaps(): boolean {
  return selectedObjects().some(isSolid);
}

/** Model > 3D Power Pack > Create Planar Caps: a flat mesh over each open end of the selected solids, left selected with them for Add Solids. */
export function planarCapsSelection(): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const solids = selectedObjects().filter(isSolid);
  let notFlat = 0;
  const made = attempt("Create Planar Caps", (s) =>
    s.batch(() => {
      const ids: string[] = [];
      for (const o of solids) {
        const tris = s.solidTriangles(o.id);
        if (tris.length / 9 > MAX_TRIANGLES) throw new Error(`this solid has more than ${MAX_TRIANGLES.toLocaleString("en")} faces, too many to cap`);
        const r = planarCaps(tris);
        notFlat += r.notFlat;
        for (const cap of r.caps) {
          const faces: number[][] = [];
          for (let i = 0; i + 8 < cap.length; i += 9) faces.push(cap.slice(i, i + 9));
          ids.push(...s.addMeshes(layerId, [aboveLayer(faces)], o.classIndex, o.attrs ?? undefined));
        }
      }
      return ids;
    }),
  );
  if (!made) return;
  const skipped = notFlat ? ` ${notFlat} open end${notFlat === 1 ? " isn't" : "s aren't"} in a plane and got no cap.` : "";
  if (!made.value.length) {
    toast(notFlat ? `No caps made.${skipped}` : "The selected solids have no open ends.", "info");
    return;
  }
  setSelection([...solids.map((o) => o.id), ...made.value]);
  toast(`${made.value.length} planar cap${made.value.length === 1 ? "" : "s"} made: Add Solids joins them to the solid.${skipped}`, "info");
}

// ---- Create Surface from Curves ---------------------------------------------

export function canSurfaceFromCurves(): boolean {
  return selectedCurves().length > 0;
}

/** Model > 3D Power Pack > Create Surface from Curves: a mesh across the region the selected curves enclose. */
export function surfaceFromCurvesSelection(): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const faces = surfaceFromCurves(selectedCurves().map((c) => c.curve));
  if (typeof faces === "string") {
    toast(faces, "info");
    return;
  }
  const made = attempt("Create Surface from Curves", (s) => s.addMeshes(layerId, [aboveLayer(faces)], store.activeClassIndex, store.drawAttrs));
  if (made) setSelection(made.value);
}

// ---- Create Drape Surface ---------------------------------------------------

export function canDrapeSurface(): boolean {
  return selectedObjects().length > 0;
}

/** Model > 3D Power Pack > Create Drape Surface…: a rectangular mesh over the selected objects, hanging down to the Plane Z Value. */
export async function drapeSurfaceDialog(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return;
  const parts = selectedObjects().map((o) => s.faceTriangles(o.id));
  const triangles = new Float64Array(parts.reduce((n, t) => n + t.length, 0));
  parts.reduce((at, t) => (triangles.set(t, at), at + t.length), 0);
  if (!triangles.length) {
    toast("Create Drape Surface needs objects that show 3D faces.", "info");
    return;
  }
  let [low, high] = [Infinity, -Infinity];
  for (let i = 2; i < triangles.length; i += 3) [low, high] = [Math.min(low, triangles[i]), Math.max(high, triangles[i])];
  const units = s.doc.info.units;
  const input = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const field = (label: string, control: HTMLInputElement, unit: string): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const u = input("U Direction", String(drape.u));
  const v = input("V Direction", String(drape.v));
  const plane = input("Plane Z Value", formatLengthValue(low, units));
  const count = (el: HTMLInputElement, label: string): number | { error: string; focus: HTMLElement } => {
    const n = Number(el.value.trim());
    return Number.isInteger(n) && n > 3 && n <= MAX_DRAPE_POINTS ? n : { error: `${label}: enter a whole number more than 3, up to ${MAX_DRAPE_POINTS}.`, focus: el };
  };
  const r = await showDialog<{ u: number; v: number; planeZ: number }>({
    title: "Create Drape Surface",
    okLabel: "OK",
    body: [
      field("U Direction", u, "points"),
      field("V Direction", v, "points"),
      field("Plane Z Value", plane, lengthSuffix(units)),
      h("p", { cls: "muted", text: `The objects run from ${formatLengthValue(low, units)} to ${formatLengthValue(high, units)} high. More points follow them more closely; the surface hangs straight down from them to the Plane Z Value, and doesn't fold under anything.` }),
    ],
    check: () => {
      const nu = count(u, "U Direction");
      if (typeof nu !== "number") return nu;
      const nv = count(v, "V Direction");
      if (typeof nv !== "number") return nv;
      const z = parseLength(plane.value, units);
      if (z === null) return { error: "Plane Z Value: enter a length.", focus: plane };
      if (z >= high) return { error: "Plane Z Value must be lower than the objects' highest point.", focus: plane };
      return { value: { u: nu, v: nv, planeZ: z } };
    },
  });
  if (!r) return;
  Object.assign(drape, { u: r.u, v: r.v });
  const made = attempt("Create Drape Surface", (session) => session.addMeshes(layerId, [aboveLayer(drapeFaces(triangles, r))], store.activeClassIndex, store.drawAttrs));
  if (made) setSelection(made.value);
}

// ---- Revolve with Rail ------------------------------------------------------

export function canRevolveWithRail(): boolean {
  return selectedCurves().length === 3;
}

/** Each way of giving three curves the three parts, those in the order they were selected first. */
const PARTS: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Model > 3D Power Pack > Revolve with Rail: the selected curves taken as the axis, profile and rail in the
 * order they were selected, or otherwise in whichever order they fit. A mesh of the profile turned about
 * the axis, its farthest point following the rail.
 */
export function revolveWithRailSelection(): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const curves = selectedCurves();
  if (curves.length !== 3) {
    toast("Select three curves for Revolve with Rail: the axis, the profile and the rail, in that order.", "info");
    return;
  }
  let first: string | null = null;
  for (const [a, p, r] of PARTS) {
    const found = railedRevolve(curves[a].curve, curves[p].curve, curves[r].curve);
    if (typeof found === "string") {
      first ??= found;
      continue;
    }
    const made = attempt("Revolve with Rail", (s) => s.addMeshes(layerId, [aboveLayer(loftFaces(found.rings, found.closedRing, false))], store.activeClassIndex, store.drawAttrs));
    if (made) setSelection(made.value);
    return;
  }
  toast(first ?? "These curves can't be revolved.", "info");
}

// ---- Unfold Surfaces --------------------------------------------------------

export function canUnfoldSurfaces(): boolean {
  return selectedObjects().some(isSolid);
}

/**
 * Model > 3D Power Pack > Unfold Surfaces: a polygon on the active layer for each flattened surface of the
 * selected solids and meshes, in its class and with its attributes, in a row beside them. A hole is a
 * polygon of its own.
 */
export function unfoldSurfacesSelection(): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const solids = selectedObjects().filter(isSolid);
  const made = attempt("Unfold Surfaces", (s) =>
    s.batch(() => {
      const ids: string[] = [];
      let [right, bottom] = [-Infinity, Infinity];
      const flats = solids.map((o) => {
        const tris = s.solidTriangles(o.id);
        if (tris.length / 9 > MAX_TRIANGLES) throw new Error(`this solid has more than ${MAX_TRIANGLES.toLocaleString("en")} faces, too many to unfold`);
        for (let i = 0; i + 2 < tris.length; i += 3) [right, bottom] = [Math.max(right, tris[i]), Math.min(bottom, tris[i + 1])];
        const pieces = unfolded(tris);
        if (typeof pieces === "string") throw new Error(pieces);
        return { o, pieces };
      });
      const widest = Math.max(...flats.flatMap((f) => f.pieces.map((p) => p.width)));
      const gap = Math.max(widest * 0.1, 1);
      let x = right + gap;
      for (const { o, pieces } of flats) {
        for (const piece of pieces) {
          for (const loop of [piece.outline, ...piece.holes]) {
            const points = loop.map((p) => ({ x: x + p[0], y: bottom + p[1] }));
            ids.push(s.addObject(layerId, { kind: "polygon", points, closed: true }, o.classIndex, o.attrs ?? undefined));
          }
          x += piece.width + gap;
        }
      }
      return ids;
    }),
  );
  if (made) setSelection(made.value);
}

// ---- Stitch and Trim Surfaces -----------------------------------------------

export function canStitchAndTrim(): boolean {
  return selectedObjects().filter(isSolid).length > 1;
}

/** Model > 3D Power Pack > Stitch and Trim Surfaces: the selected surfaces and solids replaced by a mesh of each volume they enclose. */
export function stitchAndTrimSelection(): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const solids = selectedObjects().filter(isSolid);
  const made = attempt("Stitch and Trim Surfaces", (s) =>
    s.batch(() => {
      const parts = solids.map((o) => s.solidTriangles(o.id));
      if (parts.reduce((n, t) => n + t.length / 9, 0) > MAX_CSG_TRIANGLES) throw new Error(`these objects have more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces between them, too many to trim`);
      const cells = stitchAndTrim(parts);
      if (typeof cells === "string") throw new Error(cells);
      const [first] = solids;
      const ids = s.addMeshes(
        layerId,
        cells.map((flat) => {
          const faces: number[][] = [];
          for (let i = 0; i + 8 < flat.length; i += 9) faces.push(flat.slice(i, i + 9));
          return aboveLayer(faces);
        }),
        first.classIndex,
        first.attrs ?? undefined,
      );
      s.deleteObjects(solids.map((o) => o.id));
      return ids;
    }),
  );
  if (made) setSelection(made.value);
}

// ---- Shared by the dialogs that show what they'll do ------------------------

/** The latest lines asked for, as the 3D view may take a while to show. */
let linesAsked = 0;

/** The orange lines in the 3D view, shown first if the plan is; null clears them. */
function showLines(lines: readonly number[] | null): void {
  const asked = ++linesAsked;
  const context = appContext();
  if (!lines) {
    context?.view3d()?.setHighlightLines(null);
    return;
  }
  void context?.show3d().then((v) => {
    if (asked === linesAsked) v?.setHighlightLines(lines);
  });
}

const dialogInput = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
const dialogField = (label: string, control: HTMLElement, unit: string): HTMLElement =>
  h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
const dialogCheck = (label: string, on: boolean): HTMLInputElement => {
  const input = h("input", { attrs: { type: "checkbox", "aria-label": label } });
  input.checked = on;
  return input;
};
const dialogSelect = (label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement => {
  const select = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([v, text]) => h("option", { text, attrs: { value: v } })));
  select.value = value;
  return select;
};

/** A curve redrawn with these points, in its class and with its attributes, in place of the old one unless it's kept. */
function replaceCurve(s: NonNullable<typeof store.session>, o: ObjectInfo, points: readonly Point3[], closed: boolean, keep = false): string {
  const base = layerBase();
  const id = s.add3DPolygons(o.layerId, [{ points: points.flatMap((p) => [p[0], p[1], p[2] - base]), closed }], o.classIndex);
  if (o.attrs) s.setAttributes([id], o.attrs);
  if (!keep) s.deleteObjects([o.id]);
  return id;
}

// ---- Extend NURBS -----------------------------------------------------------

/** The one selected open 3D polygon or mesh Extend NURBS can take. */
function extendable(): ObjectInfo | null {
  const list = selectedObjects();
  return list.length === 1 && (list[0].type === POLY3D || list[0].type === MESH) ? list[0] : null;
}

export function canExtendNurbs(): boolean {
  return extendable() !== null;
}

const extend = { kind: "linear" as ExtendKind, distance: 500 };

/** Model > 3D Power Pack > Extend NURBS…: a 3D polygon carried on past one end, or a mesh past one edge of its rim. */
export async function extendNurbsDialog(): Promise<void> {
  const s = store.session;
  const o = extendable();
  if (!s || !o) return;
  const units = s.doc.info.units;
  const curve = o.type === POLY3D ? s.curvePoints(o.id) : null;
  const surface = o.type === MESH ? openSurface(s.solidTriangles(o.id)) : null;
  if (curve?.closed) return toast("A closed curve can't be extended.", "info");
  if (surface && !surface.edges.length) return toast("This mesh has no open edge to extend.", "info");
  const options: readonly (readonly [string, string])[] = surface ? surface.edges.map((_, i) => [String(i), `Edge ${i + 1}`]) : [["end", "End Point"], ["start", "Start Point"]];
  const which = dialogSelect("Select End Point/Edge", options, options[0][0]);
  const kind = dialogSelect("Type of extension", [["linear", "Linear Extension"], ["smooth", "Smooth Extension"]], extend.kind);
  const distance = dialogInput("Distance", formatLengthValue(extend.distance, units));
  const length = (): number | null => {
    const mm = parseLength(distance.value, units);
    return mm !== null && mm > 0 ? mm : null;
  };
  const asCurve = (): LoftCurve => ({ points: (curve?.points ?? []) as unknown as Point3[], closed: false });
  const preview = (): void => {
    const mm = length() ?? 0;
    const way = kind.value as ExtendKind;
    if (surface) {
      const out = surfaceExtension(surface, surface.edges[Number(which.value)], Math.max(mm, 1e-3), way);
      showLines([...out.edge, ...loftWires(out.rings, out.closed)]);
      return;
    }
    const atStart = which.value === "start";
    const all = extendedCurve(asCurve(), atStart, Math.max(mm, 1e-3), way);
    if (typeof all === "string") return;
    const old = curve?.points.length ?? 0;
    const fresh = atStart ? all.slice(0, all.length - old + 1) : all.slice(old - 1);
    showLines(fresh.flatMap((p, i) => (i + 1 < fresh.length ? [...p, ...fresh[i + 1]] : [])));
  };
  for (const el of [which, kind, distance]) el.addEventListener("input", preview);
  preview();
  const r = await showDialog<{ mm: number }>({
    title: "Extend NURBS",
    okLabel: "OK",
    body: [
      dialogField(surface ? "Select Edge" : "Select End Point", which, ""),
      dialogField("Type", kind, ""),
      dialogField("Distance", distance, lengthSuffix(units)),
      h("p", { cls: "muted", text: "The 3D view shows the extension in orange. A Smooth Extension carries on round the curve the last points make; a Linear one, straight on." }),
    ],
    check: () => {
      const mm = length();
      return mm === null ? { error: "Distance: enter a length greater than 0.", focus: distance } : { value: { mm } };
    },
  });
  showLines(null);
  if (!r) return;
  Object.assign(extend, { kind: kind.value, distance: r.mm });
  const way = kind.value as ExtendKind;
  const made = attempt("Extend NURBS", (session) =>
    session.batch(() => {
      if (surface) {
        const out = surfaceExtension(surface, surface.edges[Number(which.value)], r.mm, way);
        const old = session.solidTriangles(o.id);
        const more = loftFaces(out.rings, out.closed, false).flat();
        return session.replaceSolid(o.id, [...old, ...more]);
      }
      const all = extendedCurve(asCurve(), which.value === "start", r.mm, way);
      if (typeof all === "string") throw new Error(all);
      return replaceCurve(session, o, all, false);
    }),
  );
  if (made) setSelection([made.value]);
}

// ---- Rebuild NURBS ----------------------------------------------------------

const rebuild = { points: 12, u: 12, v: 12, keep: false };

function rebuildable(): ObjectInfo[] {
  return selectedObjects().filter((o) => o.type === POLY3D || o.type === MESH);
}

export function canRebuildNurbs(): boolean {
  return rebuildable().length > 0;
}

/** Model > 3D Power Pack > Rebuild NURBS…: the selected 3D polygons and meshes with other numbers of points, evenly along them. */
export async function rebuildNurbsDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const objects = rebuildable();
  const curves = objects.filter((o) => o.type === POLY3D).map((o) => ({ o, curve: s.curvePoints(o.id)! }));
  const meshes = objects.filter((o) => o.type === MESH).map((o) => ({ o, triangles: s.solidTriangles(o.id) }));
  if (meshes.some((m) => m.triangles.length / 9 > MAX_CSG_TRIANGLES)) return toast(`This mesh has more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces, too many to rebuild.`, "info");
  const units = s.doc.info.units;
  const points = dialogInput("Number of Points", String(rebuild.points));
  const u = dialogInput("U Direction", String(rebuild.u));
  const v = dialogInput("V Direction", String(rebuild.v));
  const keep = dialogCheck("Keep Original", rebuild.keep);
  const deviation = h("p", { cls: "muted" });
  const count = (el: HTMLInputElement, least: number): number | null => {
    const n = Number(el.value.trim());
    return Number.isInteger(n) && n >= least && n <= MAX_REBUILD_POINTS ? n : null;
  };
  const results = (): { curves: { o: ObjectInfo; points: Point3[]; closed: boolean }[]; meshes: { o: ObjectInfo; rings: Point3[][]; closedRing: boolean }[]; most: number; problem: string | null } | null => {
    const n = count(points, 3);
    const [nu, nv] = [count(u, 4), count(v, 4)];
    if ((curves.length && n === null) || (meshes.length && (nu === null || nv === null))) return null;
    const out = { curves: [] as { o: ObjectInfo; points: Point3[]; closed: boolean }[], meshes: [] as { o: ObjectInfo; rings: Point3[][]; closedRing: boolean }[], most: 0, problem: null as string | null };
    for (const c of curves) {
      const made = rebuiltCurve({ points: c.curve.points as unknown as Point3[], closed: c.curve.closed }, n!);
      out.curves.push({ o: c.o, points: made.points, closed: c.curve.closed });
      out.most = Math.max(out.most, made.deviation);
    }
    for (const m of meshes) {
      const made = rebuiltSurface(m.triangles, nu!, nv!);
      if (typeof made === "string") {
        out.problem = made;
        continue;
      }
      out.meshes.push({ o: m.o, rings: made.rings, closedRing: made.closedRing });
      out.most = Math.max(out.most, made.deviation);
    }
    return out;
  };
  const preview = (): void => {
    const r = results();
    if (!r) {
      deviation.textContent = "";
      return;
    }
    deviation.textContent = r.problem ?? `Maximum Deviation: ${formatLengthValue(r.most, units)}${lengthSuffix(units) ? ` ${lengthSuffix(units)}` : ""}`;
    const lines = [...r.curves.flatMap((c) => c.points.flatMap((p, i) => (i + 1 < c.points.length || c.closed ? [...p, ...c.points[(i + 1) % c.points.length]] : []))), ...r.meshes.flatMap((m) => loftWires(m.rings, m.closedRing))];
    showLines(lines);
  };
  for (const el of [points, u, v]) el.addEventListener("change", preview);
  preview();
  const body: HTMLElement[] = [];
  if (curves.length) body.push(dialogField("Number of Points", points, ""));
  if (meshes.length) body.push(dialogField("U Direction", u, "points"), dialogField("V Direction", v, "points"));
  body.push(h("label", { cls: "menu-dialog-check" }, keep, "Keep Original"), deviation, h("p", { cls: "muted", text: "Fewer points simplify it, but it moves further from the original; the 3D view shows the rebuilt shape in orange." }));
  const r = await showDialog<NonNullable<ReturnType<typeof results>>>({
    title: "Rebuild NURBS",
    okLabel: "OK",
    body,
    check: () => {
      const found = results();
      if (!found) return { error: `Enter at least 3 points for a curve and 4 each way for a surface, up to ${MAX_REBUILD_POINTS}.`, focus: curves.length ? points : u };
      if (found.problem) return { error: found.problem, focus: u };
      return { value: found };
    },
  });
  showLines(null);
  if (!r) return;
  Object.assign(rebuild, { points: Number(points.value), u: Number(u.value), v: Number(v.value), keep: keep.checked });
  const made = attempt("Rebuild NURBS", (session) =>
    session.batch(() => {
      const ids = r.curves.map((c) => replaceCurve(session, c.o, c.points, c.closed, keep.checked));
      for (const m of r.meshes) {
        const faces = loftFaces(m.rings, m.closedRing, false);
        if (keep.checked) ids.push(...session.addMeshes(m.o.layerId, [aboveLayer(faces)], m.o.classIndex, m.o.attrs ?? undefined));
        else ids.push(session.replaceSolid(m.o.id, faces.flat()));
      }
      return ids;
    }),
  );
  if (made) setSelection(made.value);
}

// ---- Create Fillet Surface --------------------------------------------------

const fillet = { radius: 100, section: "circular" as FilletSection, trim: true };

function filletPair(): ObjectInfo[] {
  const list = selectedObjects();
  return list.length === 2 && list.every((o) => o.type === MESH) ? list : [];
}

export function canFilletSurface(): boolean {
  return filletPair().length === 2;
}

/** Model > 3D Power Pack > Create Fillet Surface…: a mesh rounding the corner between two selected open meshes. */
export async function filletSurfaceDialog(): Promise<void> {
  const s = store.session;
  const pair = filletPair();
  if (!s || pair.length !== 2) return;
  const [a, b] = [s.solidTriangles(pair[0].id), s.solidTriangles(pair[1].id)];
  if (isClosedMesh(a) || isClosedMesh(b)) return toast("Create Fillet Surface takes two open surfaces: Fillet Edge rounds a solid's edges.", "info");
  if ((a.length + b.length) / 9 > MAX_CSG_TRIANGLES) return toast(`These meshes have more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces between them, too many to fillet.`, "info");
  const units = s.doc.info.units;
  const radius = dialogInput("Fillet Radius", formatLengthValue(fillet.radius, units));
  const section = dialogSelect(
    "Cross Section Type",
    [
      ["circular", "Circular"],
      ["linear", "Linear"],
      ["tangent", "Tangent Continuous Blend"],
      ["curvature", "Curvature Continuous Blend"],
    ],
    fillet.section,
  );
  const flipA = dialogCheck("Reverse first surface's normal", false);
  const flipB = dialogCheck("Reverse second surface's normal", false);
  const trim = dialogCheck("Trim Original Surfaces", fillet.trim);
  const status = h("p", { cls: "muted" });
  const options = (): FilletOptions | null => {
    const mm = parseLength(radius.value, units);
    return mm !== null && mm > 0 ? { radius: mm, section: section.value as FilletSection, flipA: flipA.checked, flipB: flipB.checked } : null;
  };
  // a normal is only a side to be on: start on the first side of them it fits
  const first = options();
  if (first) {
    for (const [p, q] of [[false, false], [true, false], [false, true], [true, true]]) {
      if (typeof filletSurface(a, b, { ...first, flipA: p, flipB: q }) === "string") continue;
      flipA.checked = p;
      flipB.checked = q;
      break;
    }
  }
  const fit = (): ReturnType<typeof filletSurface> | null => {
    const o = options();
    return o ? filletSurface(a, b, o) : null;
  };
  const preview = (): void => {
    const found = fit();
    if (found === null || typeof found === "string") {
      status.textContent = found ?? "";
      showLines([]);
      return;
    }
    status.textContent = "The 3D view shows the fillet in orange. Reversing a normal moves it into another corner between the surfaces.";
    showLines(loftWires(found.rings, false));
  };
  for (const el of [radius, section, flipA, flipB]) el.addEventListener("change", preview);
  preview();
  const r = await showDialog<Exclude<ReturnType<typeof filletSurface>, string>>({
    title: "Fillet Surface Preferences",
    okLabel: "OK",
    body: [
      dialogField("Fillet Radius", radius, lengthSuffix(units)),
      dialogField("Cross Section", section, ""),
      h("label", { cls: "menu-dialog-check" }, flipA, "Reverse first surface's normal"),
      h("label", { cls: "menu-dialog-check" }, flipB, "Reverse second surface's normal"),
      h("label", { cls: "menu-dialog-check" }, trim, "Trim Original Surfaces"),
      status,
    ],
    check: () => {
      const found = fit();
      if (found === null) return { error: "Fillet Radius: enter a length greater than 0.", focus: radius };
      return typeof found === "string" ? { error: found, focus: radius } : { value: found };
    },
  });
  showLines(null);
  if (!r) return;
  Object.assign(fillet, { radius: parseLength(radius.value, units) ?? fillet.radius, section: section.value, trim: trim.checked });
  const layerId = pair[0].layerId;
  const made = attempt("Create Fillet Surface", (session) =>
    session.batch(() => {
      const ids = session.addMeshes(layerId, [aboveLayer(loftFaces(r.rings, false, false))], pair[0].classIndex, pair[0].attrs ?? undefined);
      if (trim.checked) {
        if (r.trimmedA.length) session.replaceSolid(pair[0].id, r.trimmedA);
        else session.deleteObjects([pair[0].id]);
        if (r.trimmedB.length) session.replaceSolid(pair[1].id, r.trimmedB);
        else session.deleteObjects([pair[1].id]);
      }
      return ids;
    }),
  );
  if (made) setSelection(made.value);
}
