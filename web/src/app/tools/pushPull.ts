// The 3D Modeling set's Push/Pull and Offset Edge, working in the 3D view. Push/Pull's Extrude Face adds a
// slab with square sides on a face or cuts one in, and raises a flat closed curve into a solid; Move Face
// moves a flat face, its neighbours running on to meet it and what stands on it going with it; Sub-Face does
// Extrude Face's work on the part of a face a curve marks out. Offset Edge offsets a face's edge or loop in
// the face's plane as a 3D polygon, and its Push/Pull mode goes straight on to push or pull what that marks
// out. A click chooses, the pointer then sets the distance (out above 0, in below it), and a click or Enter
// makes the change; or the distance is typed. Rodeo has no solid-modeling kernel, so a solid's result is a mesh
// in its place (solidOps.ts has the sums), and it keeps no history of the push.

import { MAX_CSG_TRIANGLES, subtractMeshes, unionMeshes } from "../../core/csg.ts";
import type { Vec3 } from "../../core/index.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { appContext, on3d } from "../ext.ts";
import { isFlatRing } from "../powerPackShapes.ts";
import { faceSlab, faceSlabLines, healed, inwardOfSide, meshVolume, movedFace, movedFaceLines, nestedRings, offsetRim, onFacePlane, rimSideAt, ringSlab, solidFace, splitFaceRing, type SolidFace } from "../solidOps.ts";
import { store } from "../state.ts";
import { editBars } from "../symbolEdit.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLengthValue, parseLength } from "../units.ts";
import type { FaceHit } from "../view3d.ts";
import { onWorkingPlanes } from "../workingPlanes.ts";
import { curveUnder, findCandidates, segmentsOf, type Candidate } from "./loftSurface.ts";
import { requestShow3d } from "./navigate3d.ts";

type Tool = "pushpull" | "offsetedge";
type PushMode = "extrude" | "move" | "subface";

const TITLES: Record<Tool, string> = { pushpull: "Push/Pull", offsetedge: "Offset Edge" };
const PUSH_MODES: readonly { readonly id: PushMode; readonly label: string }[] = [
  { id: "extrude", label: "Extrude Face" },
  { id: "move", label: "Move Face" },
  { id: "subface", label: "Sub-Face" },
];
/** a 3D polygon's record type */
const POLY3D = 25;

/** lengths in mm */
const settings = { mode: "extrude" as PushMode, distance: 100, offset: 100, loop: false, pushPull: false, combine: true };

/** A change waiting for its distance. */
interface Armed {
  /** the object it changes */
  readonly id: string;
  /** where the pointer's distance is measured from, and which way */
  readonly at: Vec3;
  readonly along: Vec3;
  readonly lines: (distance: number) => readonly number[];
  /** makes the change, giving the new object's id */
  readonly make: (distance: number) => string;
}

/** An edge or loop of a face waiting for Offset Edge's distance. */
interface Offsetting {
  readonly id: string;
  readonly face: SolidFace;
  readonly ring: number;
  readonly sides: ReadonlySet<number>;
  /** the side the distance is measured from */
  readonly side: number;
}

let current: Tool | null = null;
let armed: Armed | null = null;
let offsetting: Offsetting | null = null;
/** the distance the pointer has set; null until it's moved */
let tracked: number | null = null;
/** Sub-Face's curves */
let curves: Candidate[] = [];
/** curves to take away once they've been used: Offset Edge's own */
let spent: string | null = null;
let candidates: Candidate[] = [];
/** what Offset Edge hands on to Push/Pull's Sub-Face */
let handedOn: { readonly curve: Candidate } | null = null;

const units = (): string | undefined => store.session?.doc.info.units;
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dotOf = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function status(tool: Tool): string {
  if (tool === "offsetedge") {
    if (offsetting) return "Move onto the face or off it, then click. Or type the offset and press Enter";
    return settings.loop ? "Click a flat face near the loop of edges to offset" : "Click a flat face near the edge to offset";
  }
  if (armed) return "Move to set the distance, then click. Or type it and press Enter";
  switch (settings.mode) {
    case "extrude":
      return "Click a face of a solid, or a flat closed curve";
    case "move":
      return "Click a flat face of a solid";
    case "subface":
      if (!curves.length) return "Click a curve on a face. Shift-click for more";
      return curves.length === 1 ? "Click the face of the solid on the side to push or pull" : `${curves.length} curves. Click the face of the solid to push or pull`;
  }
}

const hintFor = (tool: Tool): string => `${status(tool)} · Drag to orbit`;

/** The solid's clean triangles, and it selected and its layer active; null when it isn't one, having said so. */
function solidTriangles(id: string | null): number[] | null {
  const s = store.session;
  if (!id || !s) return null;
  try {
    const tris = healed(s.solidTriangles(id));
    const obj = s.doc.object(id);
    if (obj && obj.layerId !== store.activeLayerId) setActiveLayer(obj.layerId);
    setSelection([id]);
    return tris;
  } catch {
    return null;
  }
}

const tooMany = `this has more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces, too many to change`;

/** The solid with a slab added (distance above 0) or cut away. */
function withSlab(tris: readonly number[], slabs: readonly (readonly number[])[], distance: number): ArrayLike<number> {
  const found = distance > 0 ? unionMeshes([tris, ...slabs]) : subtractMeshes(tris, [...slabs]);
  if (!found) throw new Error(tooMany);
  if (meshVolume(found.triangles) < 1e-6) throw new Error("nothing would be left of this object");
  return found.triangles;
}

function armFace(id: string, tris: number[], face: SolidFace): void {
  armed =
    settings.mode === "move"
      ? {
          id,
          at: face.point,
          along: face.normal,
          lines: (d) => movedFaceLines(face, d),
          make: (d) => {
            const result = movedFace(face, d);
            if (typeof result === "string") throw new Error(result);
            return store.session!.replaceSolid(id, healed(result));
          },
        }
      : {
          id,
          at: face.point,
          along: face.normal,
          lines: (d) => faceSlabLines(face, d),
          make: (d) => store.session!.replaceSolid(id, healed(withSlab(tris, [faceSlab(face, d)], d))),
        };
}

/** The slabs a set of closed rings on a face make, holes cut out. */
function ringSlabs(rings: readonly (readonly Vec3[])[], normal: Vec3, distance: number): number[][] {
  const out: number[][] = [];
  for (const { outer, holes } of nestedRings(rings, normal)) {
    const made = (ring: readonly Vec3[]): number[] => {
      const slab = ringSlab(ring, normal, distance);
      if (typeof slab === "string") throw new Error(slab);
      return slab;
    };
    if (!holes.length) out.push(made(outer));
    else {
      const cut = subtractMeshes(made(outer), holes.map(made));
      if (!cut) throw new Error(tooMany);
      out.push([...cut.triangles]);
    }
  }
  return out;
}

/** Lines of a ring and its copy `distance` along the normal. */
function ringLines(rings: readonly (readonly Vec3[])[], normal: Vec3, distance: number): number[] {
  const off = (p: Vec3): Vec3 => [p[0] + normal[0] * distance, p[1] + normal[1] * distance, p[2] + normal[2] * distance];
  const out: number[] = [];
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      out.push(...p, ...q, ...off(p), ...off(q));
      if (ring.length <= 8 || i % Math.ceil(ring.length / 8) === 0) out.push(...p, ...off(p));
    });
  }
  return out;
}

/** Sub-Face's click on a solid: the curves, laid on the face, mark out what's pushed or pulled. */
function armSubFace(id: string, tris: number[], face: SolidFace): void {
  if (!face.flat) {
    toast("Sub-Face works on a flat face. Use Extrude Face for a curved one.", "info");
    return;
  }
  const open = curves.filter((c) => !c.curve.closed);
  if (open.length && curves.length > 1) {
    toast("An open curve splits a face by itself: choose it alone.", "info");
    return;
  }
  let rings: readonly (readonly Vec3[])[];
  if (open.length) {
    const ring = splitFaceRing(face, open[0].curve.points as unknown as Vec3[], face.point);
    if (typeof ring === "string") {
      toast(ring, "info");
      return;
    }
    rings = [ring];
  } else rings = curves.map((c) => onFacePlane(face, c.curve.points as unknown as Vec3[]));
  const consumed = spent;
  armed = {
    id,
    at: face.point,
    along: face.normal,
    lines: (d) => ringLines(rings, face.normal, d),
    make: (d) => {
      const s = store.session!;
      const slabs = ringSlabs(rings, face.normal, d);
      return s.batch(() => {
        const made = settings.combine ? s.replaceSolid(id, healed(withSlab(tris, slabs, d))) : addSeparate(id, slabs);
        if (consumed && s.doc.object(consumed)) s.deleteObjects([consumed]);
        return made;
      });
    },
  };
}

/** Faces in the model as heights above the active layer. */
function aboveLayer(triangles: ArrayLike<number>): number[][] {
  const base = store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
  const faces: number[][] = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const f: number[] = [];
    for (let k = 0; k < 9; k++) f.push(triangles[i + k] - (k % 3 === 2 ? base : 0));
    faces.push(f);
  }
  return faces;
}

/** The slabs as their own object beside the solid, in its class and look. */
function addSeparate(id: string, slabs: readonly (readonly number[])[]): string {
  const s = store.session!;
  const obj = s.doc.object(id)!;
  const faces = aboveLayer(slabs.flat());
  return s.addMeshes(obj.layerId, [faces], obj.classIndex, obj.attrs ?? undefined)[0];
}

/** A flat closed curve under the pointer: near a line of it, or inside it on the screen. */
function flatCurveUnder(e: MouseEvent): Candidate | null {
  const closed = candidates.filter((c) => c.curve.closed && c.curve.points.length >= 3);
  const near = curveUnder(e, closed);
  if (near) return near.candidate;
  const v = appContext()?.view3d();
  if (!v) return null;
  for (const c of closed) {
    const screen = c.curve.points.map((p) => v.screenOf(p as unknown as Vec3));
    if (screen.some((q) => !q)) continue;
    let inside = false;
    for (let i = 0, j = screen.length - 1; i < screen.length; j = i++) {
      const [a, b] = [screen[i]!, screen[j]!];
      if (a.y > e.clientY !== b.y > e.clientY && e.clientX < ((b.x - a.x) * (e.clientY - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (inside) return c;
  }
  return null;
}

/** Extrude Face on a curve that's no solid's: a 2D shape lying flat becomes a real extrude, anything else a mesh. */
function armCurve(c: Candidate): void {
  const ring = c.curve.points as unknown as Vec3[];
  if (!isFlatRing(c.curve.points)) {
    toast("That curve isn't flat, so it can't be extruded.", "info");
    return;
  }
  let turning: Vec3 = [0, 0, 0];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    turning = [turning[0] + p[1] * q[2] - p[2] * q[1], turning[1] + p[2] * q[0] - p[0] * q[2], turning[2] + p[0] * q[1] - p[1] * q[0]];
  });
  const toward = unit(turning);
  // up, or facing the viewer's way as well as it can
  const along: Vec3 = toward[2] < 0 || (toward[2] === 0 && toward[1] < 0) ? [-toward[0], -toward[1], -toward[2]] : toward;
  const middle = ring.reduce<Vec3>((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length, a[2] + p[2] / ring.length], [0, 0, 0]);
  armed = {
    id: c.id,
    at: middle,
    along,
    lines: (d) => ringLines([ring], along, d),
    make: (d) => {
      const s = store.session!;
      const obj = s.doc.object(c.id);
      if (!obj) throw new Error("that curve is gone");
      return s.batch(() => {
        if (obj.type !== POLY3D && Math.abs(along[2]) > 1 - 1e-9) {
          const made = s.extrudeObjects([c.id], Math.abs(d))[0];
          if (d < 0) s.moveObjects3D([made], 0, 0, d);
          return made;
        }
        const slab = ringSlab(ring, along, d);
        if (typeof slab === "string") throw new Error(slab);
        const made = s.addMeshes(obj.layerId, [aboveLayer(slab)], obj.classIndex, obj.attrs ?? undefined)[0];
        s.deleteObjects([c.id]);
        return made;
      });
    },
  };
}

function clickPush(hit: FaceHit | null, shift: boolean, e: MouseEvent): void {
  if (settings.mode === "subface") {
    const near = curveUnder(e, candidates);
    if (near && !(curves.length && spent)) {
      const had = curves.some((c) => c.id === near.candidate.id);
      curves = shift ? (had ? curves.filter((c) => c.id !== near.candidate.id) : [...curves, near.candidate]) : had ? [] : [near.candidate];
      return;
    }
    if (!curves.length) {
      toast("Click a curve first: a 3D polygon, or a 2D shape on the active layer.", "info");
      return;
    }
  }
  const tris = hit ? solidTriangles(hit.objectId) : null;
  if (hit && tris) {
    const face = solidFace(tris, { point: hit.point, normal: hit.normal });
    if (typeof face === "string") toast(face, "info");
    else if (settings.mode === "subface") armSubFace(hit.objectId!, tris, face);
    else if (settings.mode === "move" && !face.flat) toast("Move Face takes a flat face. Use Extrude Face for a curved one.", "info");
    else armFace(hit.objectId!, tris, face);
    return;
  }
  if (settings.mode === "extrude") {
    const c = flatCurveUnder(e);
    if (c) {
      armCurve(c);
      return;
    }
  }
  toast(hit ? "That isn't a solid: click an extrude, multiple extrude, sweep, solid or mesh." : "Click a face of a solid.", "info");
}

function clickOffset(hit: FaceHit | null, shift: boolean): void {
  if (!hit) return;
  const tris = solidTriangles(hit.objectId);
  if (!tris) {
    toast("That isn't a solid: click an extrude, multiple extrude, sweep, solid or mesh.", "info");
    return;
  }
  const face = solidFace(tris, { point: hit.point, normal: hit.normal });
  if (typeof face === "string" || !face.flat) {
    toast(typeof face === "string" ? face : "Offset Edge works on the edges of a flat face.", "info");
    return;
  }
  const { ring, side } = rimSideAt(face, hit.point);
  const count = face.rings[ring].length;
  if (settings.loop) {
    offsetting = { id: hit.objectId!, face, ring, sides: new Set(Array(count).keys()), side };
    return;
  }
  const had = offsetting;
  if (shift && had && had.id === hit.objectId && had.ring === ring && had.face.plane === face.plane) {
    const sides = new Set(had.sides);
    if (sides.has(side) && sides.size > 1) sides.delete(side);
    else sides.add(side);
    offsetting = { ...had, sides };
    return;
  }
  offsetting = { id: hit.objectId!, face, ring, sides: new Set([side]), side };
}

/** Makes the 3D polygon, and goes on to Push/Pull when that mode's on. */
function placeOffset(distance: number): void {
  const o = offsetting;
  const s = store.session;
  if (!o || !s) return;
  const found = offsetRim(o.face, o.ring, o.sides, distance);
  if (typeof found === "string") {
    toast(found, "info");
    return;
  }
  const obj = s.doc.object(o.id);
  if (!obj) return;
  const base = s.doc.layers().find((l) => l.id === obj.layerId)?.elevation ?? 0;
  const made = attempt("Offset Edge", (session) => session.add3DPolygons(obj.layerId, [{ points: found.points.flatMap((p) => [p[0], p[1], p[2] - base]), closed: found.closed }], obj.classIndex));
  if (!made) return;
  settings.offset = Math.abs(distance);
  offsetting = null;
  tracked = null;
  valueInput.blur();
  if (settings.pushPull) {
    handedOn = { curve: { id: made.value, curve: { points: found.points as unknown as Candidate["curve"]["points"], closed: found.closed } } };
    settings.mode = "subface";
    appContext()?.controller.setTool("pushpull");
  } else {
    setSelection([made.value]);
    candidates = findCandidates();
    show();
  }
}

function clicked(hit: FaceHit | null, shift: boolean, e: MouseEvent): void {
  if (!current) return;
  if (current === "offsetedge") {
    if (offsetting && !shift && tracked !== null) placeOffset(tracked);
    else clickOffset(hit, shift);
  } else if (armed) {
    if (tracked !== null) apply(tracked);
    return;
  } else clickPush(hit, shift, e);
  show();
}

function apply(distance: number): void {
  const a = armed;
  if (!a) return;
  if (Math.abs(distance) < 1e-6) {
    toast("The distance can't be 0.", "info");
    return;
  }
  const done = attempt("Push/Pull", () => a.make(distance));
  if (!done) return;
  settings.distance = Math.abs(distance);
  armed = null;
  tracked = null;
  curves = [];
  spent = null;
  valueInput.blur();
  setSelection([done.value]);
  candidates = findCandidates();
  show();
}

const valueInput = h("input", { cls: "menu-dialog-input solid-edit-value", attrs: { type: "text", "aria-label": "Distance" } });
const statusLabel = h("span", { cls: "symbol-bar-label" });
const titleLabel = h("span", { cls: "symbol-bar-name" });
const valueLabel = h("span", { cls: "symbol-bar-label" });
const applyBtn = h("button", { cls: "btn small primary", text: "Apply", attrs: { type: "button" } });
const clearBtn = h("button", { cls: "btn small", text: "Clear", attrs: { type: "button" } });
const bar = h("div", { cls: "symbol-bar solid-edit-bar", hidden: true, attrs: { role: "status" } }, titleLabel, statusLabel, valueLabel, valueInput, applyBtn, clearBtn);

function clear(): void {
  armed = null;
  offsetting = null;
  tracked = null;
  curves = [];
  if (spent && store.session?.doc.object(spent)) {
    // Offset Edge's curve stays, as it would have without Push/Pull mode
    setSelection([spent]);
  }
  spent = null;
  valueInput.blur();
  show();
}

const ready = (): boolean => armed !== null || offsetting !== null;

/** Applies the distance in the box. */
function applyTyped(): void {
  if (!current || !ready()) return;
  const mm = parseLength(valueInput.value, units());
  if (mm === null) {
    toast("The distance must be a length.", "info");
    return;
  }
  if (current === "offsetedge") placeOffset(mm);
  else apply(mm);
}

function shownDistance(tool: Tool): number {
  if (tracked !== null) return tracked;
  return tool === "offsetedge" ? settings.offset : settings.distance;
}

/** Brings the bar and the lines over the 3D view up to date. */
function show(): void {
  const tool = current;
  bar.hidden = !tool || !store.view3d;
  if (tool) {
    titleLabel.textContent = TITLES[tool];
    statusLabel.textContent = status(tool);
    valueLabel.textContent = tool === "offsetedge" ? "Offset" : "Distance";
    if (document.activeElement !== valueInput) valueInput.value = formatLengthValue(shownDistance(tool), units());
    applyBtn.disabled = !ready();
    clearBtn.disabled = !ready() && !curves.length;
    store.setHint(hintFor(tool));
  }
  drawLines();
}

let drawn = false;

function drawLines(): void {
  const v = appContext()?.view3d();
  if (!v) return;
  if (!current) {
    if (drawn) v.setHighlightLines(null);
    drawn = false;
    return;
  }
  drawn = true;
  const distance = tracked ?? 0;
  const lines: number[] = curves.flatMap((c) => segmentsOf(c.curve));
  if (armed) lines.push(...armed.lines(distance));
  if (offsetting) {
    const { face, ring, sides } = offsetting;
    const r = face.rings[ring];
    for (const side of sides) lines.push(...face.mesh.points[r[side]], ...face.mesh.points[r[(side + 1) % r.length]]);
    if (tracked !== null && tracked !== 0) {
      const found = offsetRim(face, ring, sides, tracked);
      if (typeof found !== "string") lines.push(...segmentsOf({ points: found.points as unknown as Candidate["curve"]["points"], closed: found.closed }));
    }
  }
  const showOthers = current === "pushpull" && !armed && settings.mode !== "move";
  const others = showOthers ? candidates.filter((c) => !curves.some((p) => p.id === c.id) && (settings.mode === "subface" || c.curve.closed)).flatMap((c) => segmentsOf(c.curve)) : [];
  v.setHighlightLines(lines.length || others.length ? lines : null, others);
}

/** The pointer sets the distance once something's chosen. */
function follow(e: PointerEvent): void {
  if (!current || !ready() || e.buttons || !(e.target instanceof HTMLCanvasElement)) return;
  if (document.activeElement === valueInput) return;
  const v = appContext()?.view3d();
  if (!v) return;
  if (armed) {
    const t = v.alongLine(e, armed.at, armed.along);
    if (t === null) return;
    tracked = t;
  } else if (offsetting) {
    const { face, ring, side } = offsetting;
    const on = v.pointOnPlane(e, face.point, face.normal);
    if (!on) return;
    const r = face.rings[ring];
    const a = face.mesh.points[r[side]];
    tracked = dotOf([on[0] - a[0], on[1] - a[1], on[2] - a[2]], inwardOfSide(face, ring, side));
  }
  valueInput.value = formatLengthValue(tracked ?? 0, units());
  drawLines();
}

/** Puts the bar over the drawing, and has the tools take the 3D view's clicks while one's in use. */
export function mountPushPullBar(wrap: HTMLElement): void {
  editBars(wrap).append(bar);
  applyBtn.addEventListener("click", applyTyped);
  clearBtn.addEventListener("click", clear);
  window.addEventListener("pointermove", follow);
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (current) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const tool: Tool | null = store.tool === "pushpull" || store.tool === "offsetedge" ? store.tool : null;
    if (tool !== current) {
      current = tool;
      armed = null;
      offsetting = null;
      tracked = null;
      curves = [];
      spent = null;
      valueInput.blur();
      candidates = tool ? findCandidates() : [];
      if (tool === "pushpull" && handedOn) {
        curves = [handedOn.curve];
        spent = handedOn.curve.id;
      }
      handedOn = null;
    }
    claim();
    show();
  });
  store.on("view3d", show);
  // a drawing opened, or an undo: what was chosen may be gone
  store.on("session", () => {
    if (!current) return;
    candidates = findCandidates();
    const gone = (id: string): boolean => !store.session?.doc.object(id);
    if ((armed && gone(armed.id)) || (offsetting && gone(offsetting.id))) {
      armed = null;
      offsetting = null;
      tracked = null;
    }
    curves = curves.filter((c) => !gone(c.id));
    show();
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
      if (e.key === "Enter" && ready()) {
        e.preventDefault();
        e.stopPropagation();
        applyTyped();
      } else if (e.key === "Escape" && (ready() || curves.length)) {
        e.preventDefault();
        e.stopPropagation();
        clear();
      }
    },
    true,
  );
}

export class PushPullTool extends BaseTool {
  readonly id = "pushpull";
  readonly cursor = "crosshair";

  hint(): string {
    return hintFor("pushpull");
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    return [{ label: "Mode", options: PUSH_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: settings.mode }];
  }

  setMode(id: string): void {
    const m = PUSH_MODES.find((x) => x.id === id);
    if (!m) return;
    settings.mode = m.id;
    armed = null;
    tracked = null;
    curves = [];
    spent = null;
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Push/Pull Preferences", [{ kind: "length", key: "distance", label: "Distance", value: settings.distance }]);
    if (v) {
      settings.distance = v.num("distance");
      show();
    }
  }
}

export class OffsetEdgeTool extends BaseTool {
  readonly id = "offsetedge";
  readonly cursor = "crosshair";

  hint(): string {
    return hintFor("offsetedge");
  }

  down(p: PointerInfo): void {
    if (p.button === 0 && !store.view3d) requestShow3d();
  }

  modes(): readonly ToolModes[] {
    return [
      { label: "Select", options: [{ id: "edge", label: "Edge", key: "1" }, { id: "loop", label: "Edge Loop", key: "2" }], active: settings.loop ? "loop" : "edge" },
      { label: "Push/Pull", options: [{ id: "off", label: "Curve Only", key: "3" }, { id: "on", label: "Push/Pull", key: "4" }], active: settings.pushPull ? "on" : "off" },
      { label: "Combine", options: [{ id: "combine", label: "Push/Pull Combine", key: "5" }, { id: "separate", label: "Separate Object", key: "6" }], active: settings.combine ? "combine" : "separate" },
    ];
  }

  setMode(id: string): void {
    if (id === "edge" || id === "loop") {
      settings.loop = id === "loop";
      offsetting = null;
      tracked = null;
    } else if (id === "on" || id === "off") settings.pushPull = id === "on";
    else settings.combine = id === "combine";
    show();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Offset Edge Preferences", [{ kind: "length", key: "offset", label: "Offset", value: settings.offset }]);
    if (v) {
      settings.offset = v.num("offset");
      show();
    }
  }
}

