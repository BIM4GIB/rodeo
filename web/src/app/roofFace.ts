// AEC > Roof Face…, Vectorworks' command of that name: the selected closed 2D shape becomes a roof
// face, one sloping slab over it. Its dialog takes how the slope is given (an angle, a rise over a
// run, or the height at a third click), the eave and hole cuts, the axis' height and the thickness;
// then the axis is clicked across the shape (the Roof Face tool, tools/roofFaceAxis.ts) and a third
// click picks the side that rises. It's a plug-in with Rodeo's own name, placed at the axis' start:
// Object Info edits its angle, cuts and levels, Reshape moves its corners, and Clip Surface cuts holes
// in it. Vectorworks makes a roof face object of its own; Rodeo can't write one (FORMAT.md: its body
// is Parasolid data), so Vectorworks sees this plug-in's plan and 3D as drawn.

import polygonClipping, { type Pair, type Polygon } from "polygon-clipping";
import type { Attributes, EditSession, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { buildRoofFace, cleanRing, pitchThrough, sideOf, splitHoles, type EaveCut, type HoleCut, type RoofFaceSpec } from "./roofFaceShapes.ts";
import { store } from "./state.ts";
import { closedOutline, joinHoles, registerClipTarget } from "./surfaces.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { formatArea } from "./units.ts";

export const ROOF_FACE = "Rodeo Roof Face";

const PLUGIN = 86;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const F = {
  angle: "Angle",
  rise: "Rise",
  run: "Run",
  axisZ: "Axis Z",
  thickness: "Thickness",
  eave: "Eave Cut",
  vertical: "Vertical",
  horizontal: "Horizontal",
  hole: "Hole Cut",
  area: "Area",
  planArea: "Projected Area",
  /** kept out of Object Info: the outline, its holes and the axis, local to the axis' start */
  path: "Path Points",
  holes: "Holes",
  axis: "Axis",
} as const;

const EAVES: readonly (readonly [string, EaveCut])[] = [
  ["Vertical", "vertical"],
  ["Horizontal", "horizontal"],
  ["Double", "double"],
  ["Square", "square"],
];
const HOLES: readonly (readonly [string, HoleCut])[] = [
  ["Vertical", "vertical"],
  ["Splayed", "splayed"],
  ["Square", "square"],
];
const SLOPES = ["Angle", "Rise over Run", "2nd Click Height"] as const;
const MAX_ANGLE = 85;

interface Settings {
  slope: string;
  angle: number;
  rise: number;
  run: number;
  height: number;
  eave: string;
  hole: string;
  axisZ: number;
  thickness: number;
  vertical: number;
}

/** the last settings, mm and degrees */
const last: Settings = { slope: SLOPES[0], angle: 30, rise: 500, run: 1000, height: 4000, eave: "Square", hole: "Vertical", axisZ: 2700, thickness: 200, vertical: 100 };

interface Job {
  readonly sourceId: string;
  readonly layerId: string;
  readonly outline: Pt[];
  readonly holes: Pt[][];
  readonly classIndex: number;
  readonly attrs: Attributes | null;
  readonly settings: Settings;
}

let pending: Job | null = null;

/** The roof face waiting for its axis, while the Roof Face tool takes the clicks. */
export function roofFaceJob(): Job | null {
  return pending;
}

export function endRoofFaceJob(): void {
  pending = null;
}

/** The selected closed shapes that a roof face can be made from. */
function selectedShapes(): { obj: ObjectInfo; ring: Pt[] }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const out: { obj: ObjectInfo; ring: Pt[] }[] = [];
  for (const id of store.selection) {
    const obj = doc.object(id);
    const ring = obj?.shape ? closedOutline(obj.shape) : null;
    if (obj && ring) out.push({ obj, ring });
  }
  return out;
}

export function canMakeRoofFace(): boolean {
  const doc = store.session?.doc;
  if (!doc || store.view3d) return false;
  for (const id of store.selection) if (doc.object(id)?.shape) return true;
  return false;
}

const choice = (key: string, label: string, value: string, options: readonly string[]): PrefField => ({ kind: "choice", key, label, value, options: options.map((o) => ({ value: o, label: o })) });

/**
 * AEC > Roof Face…: the dialog, then the axis' clicks. Resolves true once the job is set, so the
 * caller hands the clicks to the Roof Face tool.
 */
export async function roofFaceDialog(): Promise<boolean> {
  const shapes = selectedShapes();
  if (shapes.length !== 1) {
    toast(shapes.length ? "Select one closed shape to make a roof face from." : "Select a closed 2D shape (a polygon, rectangle, circle or closed polyline) to make a roof face from.", "info");
    return false;
  }
  const [{ obj, ring }] = shapes;
  const { outer, holes } = splitHoles(ring);
  if (outer.length < 3) {
    toast("That shape has no area to make a roof face of.", "info");
    return false;
  }
  const v = await toolPrefs(
    "Create Roof Face",
    [
      { kind: "heading", key: "", label: "Roof Slope" },
      choice("slope", "Slope by", last.slope, SLOPES),
      { kind: "number", key: "angle", label: "Angle", value: last.angle, min: 0.1, max: MAX_ANGLE, unit: "°" },
      { kind: "length", key: "rise", label: "Rise", value: last.rise },
      { kind: "length", key: "run", label: "Run", value: last.run },
      { kind: "length", key: "height", label: "Height at 2nd click", value: last.height, signed: true },
      { kind: "heading", key: "", label: "Cuts" },
      choice("eave", "Eave Cut", last.eave, EAVES.map(([name]) => name)),
      { kind: "length", key: "vertical", label: "Double's Vertical", value: last.vertical, zero: true },
      choice("hole", "Hole Cut", last.hole, HOLES.map(([name]) => name)),
      { kind: "heading", key: "", label: "Roof" },
      { kind: "length", key: "axisZ", label: "Axis Z", value: last.axisZ, signed: true },
      { kind: "length", key: "thickness", label: "Thickness", value: last.thickness },
    ],
    "Then click across the shape for the roof's axis, and click the side it rises to. Axis Z is the underside's height at the axis.",
  );
  if (!v || !store.session) return false;
  const settings: Settings = {
    slope: v.choice("slope"),
    angle: v.num("angle"),
    rise: v.num("rise"),
    run: v.num("run"),
    height: v.num("height"),
    eave: v.choice("eave"),
    hole: v.choice("hole"),
    axisZ: v.num("axisZ"),
    thickness: v.num("thickness"),
    vertical: v.num("vertical"),
  };
  if (settings.slope === "Rise over Run" && (Math.atan(settings.rise / settings.run) * 180) / Math.PI > MAX_ANGLE) {
    toast(`The rise over the run makes an angle over ${MAX_ANGLE}°.`, "error");
    return false;
  }
  if (settings.slope === "2nd Click Height" && Math.abs(settings.height - settings.axisZ) < 1e-6) {
    toast("The 2nd click's height must differ from Axis Z.", "error");
    return false;
  }
  Object.assign(last, settings);
  pending = { sourceId: obj.id, layerId: obj.layerId, outline: outer, holes, classIndex: obj.classIndex, attrs: obj.attrs, settings };
  return true;
}

/** The pitch (radians) and rising side the clicks make; null where the third click can't set them. */
export function slopeOf(job: Job, a: Pt, b: Pt, c: Pt): { pitch: number; side: 1 | -1 } | null {
  const k = job.settings;
  if (k.slope === "2nd Click Height") return pitchThrough([a, b], c, k.height - k.axisZ);
  const pitch = k.slope === "Rise over Run" ? Math.atan(k.rise / k.run) : (k.angle * Math.PI) / 180;
  return { pitch, side: sideOf([a, b], c) };
}

const eaveOf = (label: RecordValue | undefined): EaveCut => EAVES.find(([name]) => name === label)?.[1] ?? "vertical";
const holeOf = (label: RecordValue | undefined): HoleCut => HOLES.find(([name]) => name === label)?.[1] ?? "vertical";

/** The axis' clicks end the job: the shape becomes the roof face, selected. */
export function finishRoofFace(a: Pt, b: Pt, c: Pt): void {
  const job = pending;
  pending = null;
  if (!job) return;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) {
    toast("The roof's axis needs two different points.", "error");
    return;
  }
  const slope = slopeOf(job, a, b, c);
  if (!slope) {
    toast("Click off the axis, on the side the roof rises to.", "error");
    return;
  }
  const k = job.settings;
  const local = (p: Pt): Pt => ({ x: p.x - a.x, y: p.y - a.y });
  const degrees = (slope.pitch * 180) / Math.PI;
  const run = k.slope === "Rise over Run" ? k.run : 1000;
  const specs: PluginFieldSpec[] = [
    { name: F.angle, type: NUMBER, value: Number(degrees.toFixed(6)) },
    { name: F.rise, type: DIMENSION, value: run * Math.tan(slope.pitch) },
    { name: F.run, type: DIMENSION, value: run },
    { name: F.axisZ, type: DIMENSION, value: k.axisZ },
    { name: F.thickness, type: DIMENSION, value: k.thickness },
    { name: F.eave, type: POPUP, value: k.eave },
    { name: F.vertical, type: DIMENSION, value: k.vertical },
    { name: F.horizontal, type: DIMENSION, value: 0 },
    { name: F.hole, type: POPUP, value: k.hole },
    { name: F.area, type: TEXT, value: "" },
    { name: F.planArea, type: TEXT, value: "" },
    { name: F.path, type: TEXT, value: JSON.stringify(job.outline.map(local)) },
    { name: F.holes, type: TEXT, value: JSON.stringify(job.holes.map((h) => h.map(local))) },
    { name: F.axis, type: TEXT, value: JSON.stringify({ end: local(b), side: slope.side }) },
  ];
  const r = attempt("Roof Face", (s) =>
    s.batch(() => {
      const id = s.addPluginObject(job.layerId, ROOF_FACE, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), a, 0, job.classIndex);
      if (job.attrs) s.setAttributes([id], job.attrs);
      redraw(s, id);
      s.deleteObjects([job.sourceId]);
      return id;
    }),
  );
  if (r) setSelection([r.value]);
}

interface Face {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function faceOf(doc: VwxDocument, id: string): Face | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === ROOF_FACE && r.fields.some((f) => f.name === F.path));
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

export const isRoofFace = (doc: VwxDocument, id: string): boolean => doc.object(id)?.type === PLUGIN && faceOf(doc, id) !== null;

const numberOf = (f: Face, field: string): number => Number(f.value(field)) || 0;

function parse<T>(f: Face, field: string, fallback: T): T {
  try {
    return JSON.parse(String(f.value(field) ?? "")) as T;
  } catch {
    return fallback;
  }
}

/** Its geometry's settings, local to the axis' start, z above the layer. */
function specOf(f: Face): RoofFaceSpec {
  const axis = parse<{ end: Pt; side: 1 | -1 }>(f, F.axis, { end: { x: 1, y: 0 }, side: 1 });
  return {
    outline: parse<Pt[]>(f, F.path, []),
    holes: parse<Pt[][]>(f, F.holes, []),
    axis: [{ x: 0, y: 0 }, axis.end],
    side: axis.side === -1 ? -1 : 1,
    pitch: (numberOf(f, F.angle) * Math.PI) / 180,
    axisZ: numberOf(f, F.axisZ),
    thickness: numberOf(f, F.thickness),
    eave: eaveOf(f.value(F.eave)),
    vertical: numberOf(f, F.vertical),
    hole: holeOf(f.value(F.hole)),
  };
}

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

function redraw(s: EditSession, id: string): void {
  const f = faceOf(s.doc, id);
  const o = s.doc.object(id);
  if (!f || !o) return;
  const spec = specOf(f);
  const elevation = s.doc.layers().find((l) => l.id === f.layerId)?.elevation ?? 0;
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const built = buildRoofFace({ ...spec, axisZ: spec.axisZ - elevation });
  if (!built) throw new Error("The roof face is too small for its thickness and cuts, or its angle isn't between 0° and 90°.");
  const units = s.doc.info.units;
  s.setRecordField(id, f.format, F.area, formatArea(built.area, units));
  s.setRecordField(id, f.format, F.planArea, formatArea(built.planArea, units));
  const plumb = spec.thickness / Math.cos(spec.pitch);
  s.setRecordField(id, f.format, F.horizontal, Math.max(0, (plumb - Math.min(plumb, spec.vertical)) / Math.tan(spec.pitch)));
  const look: Partial<Attributes> = { ...(o.attrs ?? store.drawAttrs) };
  const plan = joinHoles(cleanRing(spec.outline), spec.holes.map((h) => cleanRing(h)));
  const ids = s.addObjects(f.layerId, [{ kind: "polygon", points: plan, closed: true }], o.classIndex, [look]);
  ids.push(...s.addMeshes(f.layerId, [built.faces], o.classIndex, look));
  s.setPluginDrawing(id, ids);
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const f = faceOf(s.doc, id);
  if (!f) throw new Error("That isn't a roof face.");
  const set = (field: string, value: RecordValue): void => s.setRecordField(id, f.format, field, value);
  for (const [field, value] of Object.entries(values)) {
    const n = Number(value);
    if (field === F.angle) {
      if (!(n > 0 && n <= MAX_ANGLE)) throw new Error(`The angle must be more than 0° and ${MAX_ANGLE}° or less.`);
      set(F.angle, n);
      set(F.rise, numberOf(f, F.run) * Math.tan((n * Math.PI) / 180));
    } else if (field === F.rise || field === F.run) {
      if (!(n > 0)) throw new Error(`The ${field.toLowerCase()} must be more than 0.`);
      const rise = field === F.rise ? n : numberOf(f, F.rise);
      const run = field === F.run ? n : numberOf(f, F.run);
      const angle = (Math.atan(rise / run) * 180) / Math.PI;
      if (angle > MAX_ANGLE) throw new Error(`That makes an angle over ${MAX_ANGLE}°.`);
      set(field, n);
      set(F.angle, angle);
    } else if (field === F.thickness) {
      if (!(n > 0)) throw new Error("The roof needs a thickness.");
      set(field, n);
    } else if (field === F.vertical) {
      set(field, Math.max(0, n));
    } else if (field === F.horizontal) {
      // the fascia that leaves that soffit
      const pitch = (numberOf(f, F.angle) * Math.PI) / 180;
      set(F.vertical, Math.max(0, numberOf(f, F.thickness) / Math.cos(pitch) - Math.max(0, n) * Math.tan(pitch)));
    } else set(field, value);
  }
  redraw(s, id);
}

async function openSettings(id: string): Promise<void> {
  const session = store.session;
  const f = session ? faceOf(session.doc, id) : null;
  if (!session || !f) return;
  const v = await toolPrefs("Roof Face", [
    { kind: "number", key: F.angle, label: F.angle, value: numberOf(f, F.angle), min: 0.1, max: MAX_ANGLE, unit: "°" },
    choice(F.eave, F.eave, String(f.value(F.eave)), EAVES.map(([name]) => name)),
    { kind: "length", key: F.vertical, label: "Double's Vertical", value: numberOf(f, F.vertical), zero: true },
    choice(F.hole, F.hole, String(f.value(F.hole)), HOLES.map(([name]) => name)),
    { kind: "length", key: F.axisZ, label: F.axisZ, value: numberOf(f, F.axisZ), signed: true },
    { kind: "length", key: F.thickness, label: F.thickness, value: numberOf(f, F.thickness) },
  ]);
  if (!v || store.session !== session) return;
  attempt("Roof Face", (s) =>
    s.batch(() =>
      write(s, id, {
        [F.angle]: v.num(F.angle),
        [F.eave]: v.choice(F.eave),
        [F.vertical]: v.num(F.vertical),
        [F.hole]: v.choice(F.hole),
        [F.axisZ]: v.num(F.axisZ),
        [F.thickness]: v.num(F.thickness),
      }),
    ),
  );
}

// Clip Surface: the top-most closed shape cuts a hole in it, or takes a piece off its edge
registerClipTarget({
  is: (doc, id) => isRoofFace(doc, id),
  cut(s, id, cutter) {
    const f = faceOf(s.doc, id);
    const o = s.doc.object(id);
    if (!f || !o) return false;
    const { toLocal } = placeOf(o);
    const spec = specOf(f);
    const pair = (ring: readonly Pt[]): Pair[] => ring.map((p): Pair => [p.x, p.y]);
    const face: Polygon = [pair(spec.outline), ...spec.holes.map(pair)];
    const knife: Polygon = [pair(cutter.map(toLocal))];
    if (polygonClipping.intersection(face, knife).length === 0) return false;
    const left = polygonClipping.difference(face, knife);
    if (left.length === 0) throw new Error("That would leave nothing of the roof face.");
    if (left.length > 1) throw new Error("That would cut the roof face in two.");
    const [outer, ...holes] = left[0].map((r) => cleanRing(r.map(([x, y]): Pt => ({ x, y }))));
    write(s, id, { [F.path]: JSON.stringify(outer), [F.holes]: JSON.stringify(holes.filter((h) => h.length >= 3)) });
    return true;
  },
});

const WIDGETS: readonly PluginWidget[] = (() => {
  const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
  return [
    { id: 1, kind: "button", label: "Roof Face Settings", level: 0 },
    param(10, F.angle),
    param(11, F.rise),
    param(12, F.run),
    param(13, F.axisZ),
    param(14, F.thickness),
    { id: 15, kind: "divider", label: "Cuts", level: 0 },
    param(16, F.eave),
    param(17, F.vertical),
    param(18, F.horizontal),
    param(19, F.hole),
    { id: 20, kind: "divider", label: "Areas", level: 0 },
    param(21, F.area),
    param(22, F.planArea),
  ];
})();

const driver: PluginDriver = {
  name: ROOF_FACE,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === F.area || field === F.planArea,
  choices(field) {
    if (field === F.eave) return EAVES.map(([value]) => ({ value, label: value }));
    if (field === F.hole) return HOLES.map(([value]) => ({ value, label: value }));
    return undefined;
  },
  place: () => toast("Select a closed 2D shape and choose AEC > Roof Face… to make a roof face.", "info"),
  edit(id, values) {
    attempt("Edit Roof Face", (s) => s.batch(() => write(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => redraw(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const f = store.session ? faceOf(store.session.doc, id) : null;
    if (!f) return;
    const double = f.value(F.eave) === "Double";
    apply(
      new Map([
        [17, { enabled: true, visible: double }],
        [18, { enabled: true, visible: double }],
      ]),
    );
  },
  open: (id) => void openSettings(id),
  press(id, widget) {
    if (widget === 1) void openSettings(id);
  },
  path(id) {
    const s = store.session;
    const f = s ? faceOf(s.doc, id) : null;
    const o = s?.doc.object(id);
    return f && o ? { points: specOf(f).outline.map(placeOf(o).toWorld), closed: true } : null;
  },
  setPath(s, id, corners) {
    const o = s.doc.object(id);
    if (!o) return;
    const local = cleanRing(corners.map(placeOf(o).toLocal), 1);
    if (local.length < 3) throw new Error("A roof face takes an outline of three corners or more.");
    write(s, id, { [F.path]: JSON.stringify(local) });
  },
};
registerPluginDrivers(() => [driver]);
