// The 3D Modeling set's edit tools: Chamfer Edge, Fillet Edge, Shell Solid and Taper Face. Each works in
// the 3D view, showing it when picked: a click chooses an edge or face of a solid, Shift-click adds to or
// takes from the choice, a drag still orbits, and Apply or Enter makes the change. Rodeo has no
// solid-modeling kernel, so the sums (solidOps.ts) work on the solid's triangles and the result is a
// mesh in the solid's place: it can be edited again with these tools, but its setback, radius or
// thickness can't be changed afterward as in Vectorworks. Shell Solid also thickens open surfaces, and
// flat closed shapes, which the 3D view doesn't draw so the tool draws their lines to click.

import { subtractMeshes, MAX_CSG_TRIANGLES } from "../../core/csg.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { pieces } from "../extractShapes.ts";
import type { Point3 } from "../loftShapes.ts";
import { isFlatRing, ringSheet, thickenedSurface } from "../powerPackShapes.ts";
import { edgeCuts, edgeProblem, faceEdges, faceOutline, healed, isClosedMesh, meshVolume, nearestEdge, shellCopies, solidEdges, tangentChain, tangentFaces, taperedFace, type FacePick, type SolidEdge } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { errorMessage, toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLengthValue, parseLength } from "../units.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { curveUnder, findCandidates, segmentsOf, type Candidate } from "./loftSurface.ts";
import { requestShow3d } from "./navigate3d.ts";

type SolidTool = "chamferedge" | "filletedge" | "shellsolid" | "taperface";
type EdgeSelect = "edge" | "tangent" | "faces" | "all";

const TITLES: Record<SolidTool, string> = {
  chamferedge: "Chamfer Edge",
  filletedge: "Fillet Edge",
  shellsolid: "Shell Solid",
  taperface: "Taper Face",
};
const VALUE_LABELS: Record<SolidTool, string> = {
  chamferedge: "Setback",
  filletedge: "Radius",
  shellsolid: "Thickness",
  taperface: "Angle",
};
const EDGE_SELECTS: readonly { readonly id: EdgeSelect; readonly label: string }[] = [
  { id: "tangent", label: "Tangent Entities" },
  { id: "edge", label: "Single Edge" },
  { id: "faces", label: "Faces" },
  { id: "all", label: "All Edges" },
];

/** the tools' settings: lengths in mm, the angle in degrees */
const settings = {
  chamferedge: 25.4,
  filletedge: 25.4,
  shellsolid: 25.4,
  taperface: 5,
  select: "tangent" as EdgeSelect,
  outside: false,
  tangentFaces: false,
};

/** A surface, or a flat closed shape, for Shell Solid to thicken. */
interface Sheet {
  readonly id: string;
  /** its triangles, in the model */
  readonly tris: number[];
  /** whether it's a shape with no faces of its own, so the shell is a new mesh rather than this one changed */
  readonly shape: boolean;
}

/** What the tool in use has chosen so far. */
interface Picking {
  /** the solid being changed */
  readonly id: string | null;
  readonly tris: number[];
  readonly edges: SolidEdge[];
  /** Chamfer Edge's and Fillet Edge's edges */
  readonly chosen: ReadonlySet<number>;
  /** Shell Solid's open faces, or Taper Face's face */
  readonly faces: readonly FacePick[];
  /** Taper Face's plane to turn about, with the lines that show it */
  readonly reference: FacePick | null;
  readonly referenceLines: readonly number[];
  /** Shell Solid's surfaces to thicken */
  readonly sheets: readonly Sheet[];
}

const NOTHING: Picking = { id: null, tris: [], edges: [], chosen: new Set(), faces: [], reference: null, referenceLines: [], sheets: [] };

let current: SolidTool | null = null;
let picking = NOTHING;
/** whether lines of ours are showing in the 3D view */
let drawn = false;

const toolOf = (id: string): SolidTool | null => (id in TITLES ? (id as SolidTool) : null);
const units = (): string | undefined => store.session?.doc.info.units;

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

/** What the tool waits for, shown over the 3D view and in the status bar. */
function status(tool: SolidTool): string {
  const p = picking;
  switch (tool) {
    case "chamferedge":
    case "filletedge":
      return p.chosen.size ? `${plural(p.chosen.size, "edge")} chosen. Shift-click for more, then Apply` : "Click an edge of a solid";
    case "shellsolid":
      if (p.sheets.length) return `${plural(p.sheets.length, "surface")} to thicken. Shift-click for more, then Apply`;
      return p.id ? `${plural(p.faces.length, "face")} left open. Shift-click for more, then Apply` : "Click a face of a solid to leave open, or a surface or flat shape to thicken";
    case "taperface":
      if (!p.reference) return "Click the face or plane to turn about";
      return p.faces.length ? "Set the angle, then Apply" : "Click the face to taper";
  }
}

function hintFor(tool: SolidTool): string {
  return `${status(tool)} · Enter applies · Drag to orbit`;
}

function ready(tool: SolidTool): boolean {
  const p = picking;
  if (tool === "taperface") return p.reference !== null && p.faces.length > 0;
  return tool === "shellsolid" ? p.id !== null || p.sheets.length > 0 : p.chosen.size > 0;
}

/** Makes `id` the solid being changed; false when it can't be, having said why. */
function load(id: string | null): boolean {
  if (id === picking.id && id !== null) return true;
  const s = store.session;
  if (!id || !s) {
    toast("That isn't a solid: click an extrude, multiple extrude, sweep, solid or mesh.", "info");
    return false;
  }
  try {
    const tris = healed(s.solidTriangles(id));
    picking = { ...NOTHING, id, tris, edges: solidEdges(tris), reference: picking.reference, referenceLines: picking.referenceLines };
  } catch (err) {
    toast(`${errorMessage(err)[0].toUpperCase()}${errorMessage(err).slice(1)}.`, "info");
    return false;
  }
  const obj = s.doc.object(id);
  if (obj && obj.layerId !== store.activeLayerId) setActiveLayer(obj.layerId);
  setSelection([id]);
  return true;
}

function edgesAt(hit: FaceHit): number[] {
  const { edges } = picking;
  switch (settings.select) {
    case "all":
      return edges.flatMap((e, i) => (e.convex ? [i] : []));
    case "faces":
      return faceEdges(edges, hit.point, hit.normal);
    default: {
      const i = nearestEdge(edges, hit.point, hit.normal);
      if (i === null) return [];
      return settings.select === "tangent" ? tangentChain(edges, i) : [i];
    }
  }
}

function clickEdges(hit: FaceHit, shift: boolean): void {
  const found = edgesAt(hit);
  const usable = found.filter((i) => !edgeProblem(picking.edges[i]));
  if (!usable.length) {
    toast(found.length ? edgeProblem(picking.edges[found[0]])! : "That face has no edge to cut.", "info");
    return;
  }
  const chosen = new Set(shift ? picking.chosen : []);
  // Shift-click on what's chosen takes it back
  if (shift && usable.every((i) => chosen.has(i))) for (const i of usable) chosen.delete(i);
  else for (const i of usable) chosen.add(i);
  picking = { ...picking, chosen };
}

function clickShell(hit: FaceHit, shift: boolean): void {
  const pick: FacePick = { point: hit.point, normal: hit.normal };
  const picks = settings.tangentFaces ? tangentFaces(picking.tris, pick) : [pick];
  const same = (a: FacePick, b: FacePick): boolean => faceOutlineKey(a) === faceOutlineKey(b);
  // the same face clicked again takes it back; a click on another without Shift starts over
  const had = picking.faces.some((f) => picks.some((p) => same(f, p)));
  const kept = shift || had ? picking.faces.filter((f) => !picks.some((p) => same(f, p))) : [];
  picking = { ...picking, faces: had ? kept : [...kept, ...picks] };
}

/** The closed flat shapes Shell Solid can thicken, looked for once for each time they're needed. */
function flatShapes(): Candidate[] {
  return findCandidates().filter((c) => c.curve.closed && c.curve.points.length >= 3 && isFlatRing(c.curve.points));
}

/** The way a flat shape looks: up, or for an upright 3D polygon along the plan's next axis. */
function shapeUp(points: readonly Point3[]): Point3 {
  let n: Point3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    n = [n[0] + a[1] * b[2] - a[2] * b[1], n[1] + a[2] * b[0] - a[0] * b[2], n[2] + a[0] * b[1] - a[1] * b[0]];
  }
  const size = Math.hypot(n[0], n[1], n[2]);
  if (Math.abs(n[2]) > size * 1e-6) return n[2] < 0 ? [-n[0], -n[1], -n[2]] : n;
  return n[1] < 0 || (Math.abs(n[1]) <= size * 1e-6 && n[0] < 0) ? [-n[0], -n[1], -n[2]] : n;
}

/** What Shell Solid would thicken at a click: the lines of a flat shape, or an open surface. */
function sheetAt(hit: FaceHit | null, e: MouseEvent): Sheet | null {
  const s = store.session;
  if (!s) return null;
  const under = curveUnder(e, flatShapes());
  if (under) {
    const { points } = under.candidate.curve;
    return { id: under.candidate.id, tris: ringSheet(points, shapeUp(points)), shape: true };
  }
  if (!hit?.objectId) return null;
  try {
    const tris = s.solidTriangles(hit.objectId);
    return isClosedMesh(tris) ? null : { id: hit.objectId, tris: Array.from(tris), shape: false };
  } catch {
    return null;
  }
}

function clickSheet(sheet: Sheet, shift: boolean): void {
  const had = picking.sheets.some((x) => x.id === sheet.id);
  const kept = shift ? picking.sheets.filter((x) => x.id !== sheet.id) : [];
  // the same one clicked again takes it back
  const sheets = had && (shift || picking.sheets.length === 1) ? kept : [...kept, sheet];
  picking = { ...NOTHING, sheets };
  const layerId = store.session?.doc.object(sheet.id)?.layerId;
  if (sheets.length === 1 && layerId && layerId !== store.activeLayerId) setActiveLayer(layerId);
  setSelection(sheets.map((x) => x.id));
}

/** Which plane a pick lies on, near enough to tell two clicks on one face. */
function faceOutlineKey(p: FacePick): string {
  const d = p.normal[0] * p.point[0] + p.normal[1] * p.point[1] + p.normal[2] * p.point[2];
  return `${p.normal.map((v) => Math.round(v * 1000)).join()},${Math.round(d)}`;
}

function clickTaper(hit: FaceHit): void {
  const pick: FacePick = { point: hit.point, normal: hit.normal };
  if (!picking.reference) {
    // the plane may be another object's; its outline is shown when it's a solid
    let referenceLines: number[] = [];
    try {
      if (hit.objectId && store.session) referenceLines = faceOutline(healed(store.session.solidTriangles(hit.objectId)), [pick]);
    } catch {
      // any face will do to turn about, solid or not
    }
    picking = { ...NOTHING, reference: pick, referenceLines };
    return;
  }
  if (load(hit.objectId)) picking = { ...picking, faces: [pick] };
}

function clicked(hit: FaceHit | null, shift: boolean, e: MouseEvent): void {
  if (!current) return;
  const sheet = current === "shellsolid" ? sheetAt(hit, e) : null;
  if (sheet) clickSheet(sheet, shift);
  else if (!hit) {
    if (!shift) picking = NOTHING;
  } else if (current === "taperface") clickTaper(hit);
  else if (load(hit.objectId)) {
    if (current === "shellsolid") clickShell(hit, shift);
    else clickEdges(hit, shift);
  }
  show();
}

/** The change made of what's chosen, as the solid's new triangles. */
function changed(tool: SolidTool, value: number): ArrayLike<number> {
  const p = picking;
  const tooMany = `this has more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces, too many to change`;
  if (tool === "taperface") {
    const t = taperedFace(p.tris, p.faces[0], p.reference!, value);
    if (typeof t === "string") throw new Error(t);
    return t;
  }
  if (tool === "shellsolid") {
    const copies = shellCopies(p.tris, value, !settings.outside, p.faces);
    if (typeof copies === "string") throw new Error(copies);
    const found = subtractMeshes(copies.outer, [copies.inner]);
    if (!found) throw new Error(tooMany);
    return found.triangles;
  }
  const found = subtractMeshes(p.tris, edgeCuts(p.tris, p.edges, p.chosen, tool === "chamferedge" ? "chamfer" : "fillet", value));
  if (!found) throw new Error(tooMany);
  return found.triangles;
}

const valueInput = h("input", { cls: "menu-dialog-input solid-edit-value", attrs: { type: "text" } });
const statusLabel = h("span", { cls: "symbol-bar-label" });
const titleLabel = h("span", { cls: "symbol-bar-name" });
const valueLabel = h("span", { cls: "symbol-bar-label" });
const applyBtn = h("button", { cls: "btn small primary", text: "Apply", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, titleLabel, statusLabel, valueLabel, valueInput, applyBtn, clearBtn);

function shownValue(tool: SolidTool): string {
  return tool === "taperface" ? String(settings.taperface) : formatLengthValue(settings[tool], units());
}

/** The value typed, kept for next time; null when it won't do, having said why. */
function readValue(tool: SolidTool): number | null {
  if (tool === "taperface") {
    const a = Number(valueInput.value.replace("°", "").trim());
    if (!Number.isFinite(a) || a === 0 || Math.abs(a) >= 90) {
      toast("The angle must be between -90° and 90°, and not 0.", "info");
      return null;
    }
    settings.taperface = a;
    return a;
  }
  const mm = parseLength(valueInput.value, units());
  if (mm === null || !(mm > 0)) {
    toast(`The ${VALUE_LABELS[tool].toLowerCase()} must be a length of more than 0.`, "info");
    return null;
  }
  settings[tool] = mm;
  return mm;
}

/** A shape's shell, as a new mesh in its place. */
function shapeShell(s: NonNullable<typeof store.session>, id: string, triangles: readonly number[]): string {
  const o = s.doc.object(id);
  if (!o) throw new Error("that shape has gone");
  const base = s.doc.layers().find((l) => l.id === o.layerId)?.elevation ?? 0;
  const faces: number[][] = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) faces.push(triangles.slice(i, i + 9).map((v, k) => (k % 3 === 2 ? v - base : v)));
  const [made] = s.addMeshes(o.layerId, [faces], o.classIndex, o.attrs ?? undefined);
  s.deleteObjects([id]);
  return made;
}

function applySheets(value: number): void {
  const done = attempt(TITLES.shellsolid, (s) =>
    s.batch(() =>
      picking.sheets.map((sheet) => {
        const thick = thickenedSurface(sheet.tris, value, !settings.outside);
        if (typeof thick === "string") throw new Error(thick);
        return sheet.shape ? shapeShell(s, sheet.id, healed(thick)) : s.replaceSolid(sheet.id, healed(thick));
      }),
    ),
  );
  if (!done) return;
  picking = NOTHING;
  setSelection(done.value);
  show();
}

function apply(): void {
  const tool = current;
  const id = picking.id;
  if (!tool || !ready(tool)) return;
  const value = readValue(tool);
  if (value === null) return;
  if (picking.sheets.length) {
    applySheets(value);
    return;
  }
  if (!id) return;
  const done = attempt(TITLES[tool], (s) => {
    const result = changed(tool, value);
    if (meshVolume(result) < 1e-6) throw new Error("nothing would be left of this object");
    return s.replaceSolid(id, healed(result));
  });
  if (!done) return;
  picking = NOTHING;
  setSelection([done.value]);
  show();
}

/** Brings the bar and the highlighted lines up to date. */
function show(): void {
  const tool = current;
  bar.hidden = !tool || !store.view3d;
  if (tool) {
    titleLabel.textContent = TITLES[tool];
    statusLabel.textContent = status(tool);
    valueLabel.textContent = VALUE_LABELS[tool];
    valueInput.setAttribute("aria-label", VALUE_LABELS[tool]);
    if (document.activeElement !== valueInput) valueInput.value = shownValue(tool);
    applyBtn.disabled = !ready(tool);
    clearBtn.disabled = picking === NOTHING;
    store.setHint(hintFor(tool));
  }
  const p = picking;
  // other tools draw their own lines while they're in use
  if (!tool && !drawn) return;
  const lines = [...p.chosen].flatMap((i) => [...p.edges[i].a, ...p.edges[i].b]);
  if (p.faces.length) lines.push(...faceOutline(p.tris, p.faces));
  lines.push(...p.referenceLines);
  for (const sheet of p.sheets) lines.push(...sheetLines(sheet));
  const shapes = tool === "shellsolid" && store.view3d ? flatShapes().flatMap((c) => segmentsOf(c.curve)) : [];
  drawn = lines.length > 0 || shapes.length > 0;
  appContext()?.view3d()?.setHighlightLines(tool && drawn ? lines : null, shapes);
}

/** The shell a surface would make, to show which way it grows; the surface's own edges if it won't. */
function sheetLines(sheet: Sheet): number[] {
  const thick = thickenedSurface(sheet.tris, settings.shellsolid, !settings.outside);
  try {
    return pieces(typeof thick === "string" ? sheet.tris : healed(thick)).flatMap((e) => [...e.a, ...e.b]);
  } catch {
    return [];
  }
}

/** Puts the bar over the drawing, and has the tools take the 3D view's clicks while one's in use. */
export function mountSolidEditBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  applyBtn.addEventListener("click", apply);
  // kept as typed, or the next click on the model would show the old one again
  valueInput.addEventListener("change", () => {
    if (current && readValue(current) !== null) show();
  });
  clearBtn.addEventListener("click", () => {
    picking = NOTHING;
    show();
  });
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (current) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const tool = toolOf(store.tool);
    if (tool !== current) {
      current = tool;
      picking = NOTHING;
      valueInput.blur();
    }
    claim();
    show();
  });
  store.on("view3d", show);
  // a drawing opened, or an undo: what was chosen may be gone
  store.on("session", () => {
    if (picking === NOTHING) return;
    const has = (id: string | null): boolean => id !== null && !!store.session?.doc.object(id);
    if (picking.sheets.length ? !picking.sheets.every((x) => has(x.id)) : !has(picking.id)) {
      picking = NOTHING;
      show();
    }
  });
  on3d(claim);
  // not while a working plane waits for a face, but once it's had it
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && current) v.onFacePick ??= clicked;
  });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!current || !store.view3d) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing && e.target !== valueInput) return;
      if (e.key === "Enter" && ready(current)) {
        e.preventDefault();
        e.stopPropagation();
        apply();
      } else if (e.key === "Escape" && picking !== NOTHING) {
        e.preventDefault();
        e.stopPropagation();
        picking = NOTHING;
        valueInput.blur();
        show();
      }
    },
    true,
  );
}

abstract class SolidEditTool extends BaseTool {
  readonly cursor = "crosshair";
  abstract readonly id: SolidTool;

  hint(): string {
    return hintFor(this.id);
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  abstract modes(): readonly ToolModes[];
  abstract setMode(id: string): void;

  async preferences(): Promise<void> {
    const tool = this.id;
    const v = await toolPrefs(`${TITLES[tool]} Preferences`, [{ kind: "length", key: "value", label: VALUE_LABELS[tool], value: settings[tool] }]);
    if (v) {
      settings[tool] = v.num("value");
      show();
    }
  }
}

abstract class EdgeTool extends SolidEditTool {
  modes(): readonly ToolModes[] {
    return [{ label: "Select", options: EDGE_SELECTS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.select }];
  }

  setMode(id: string): void {
    const m = EDGE_SELECTS.find((x) => x.id === id);
    if (m) settings.select = m.id;
  }
}

export class ChamferEdgeTool extends EdgeTool {
  readonly id = "chamferedge";
}

export class FilletEdgeTool extends EdgeTool {
  readonly id = "filletedge";
}

export class ShellSolidTool extends SolidEditTool {
  readonly id = "shellsolid";

  modes(): readonly ToolModes[] {
    return [
      { label: "Shell", options: [{ id: "inside", label: "Inside", key: "1" }, { id: "outside", label: "Outside", key: "2" }], active: settings.outside ? "outside" : "inside" },
      { label: "Select", options: [{ id: "picked", label: "Picked Face", key: "3" }, { id: "tangent", label: "Tangent Faces", key: "4" }], active: settings.tangentFaces ? "tangent" : "picked" },
    ];
  }

  setMode(id: string): void {
    if (id === "inside" || id === "outside") settings.outside = id === "outside";
    else settings.tangentFaces = id === "tangent";
    show();
  }
}

export class TaperFaceTool extends SolidEditTool {
  readonly id = "taperface";

  modes(): readonly ToolModes[] {
    return [];
  }

  setMode(): void {}

  async preferences(): Promise<void> {
    const v = await toolPrefs("Taper Face Preferences", [{ kind: "number", key: "angle", label: "Angle", value: settings.taperface, min: -89, max: 89, unit: "°" }], "Positive angles lean the face in, away from the plane it turns about.");
    if (v) {
      settings.taperface = v.num("angle");
      show();
    }
  }
}
