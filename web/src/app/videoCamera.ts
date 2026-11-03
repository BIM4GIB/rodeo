// Spotlight's Video Camera as a Rodeo plug-in object ('Rodeo Video Camera'): a camera on a stand
// with a lens, a body and a format, panned, tilted and rolled on its head, that draws its stand, body
// and lens and its field of view in plan and as solids in 3D (videoCameraShapes.ts has the sums).
// Activate Camera (Object Info, or a double-click) shows the 3D view through it, the picture its lens
// and body make in its format; Aim Camera pans it toward the next click. The lenses and bodies are
// Rodeo's generic ones: Vectorworks' come from its library's symbols and their records.

import type { Attributes, EditSession, NewShape, PluginFieldSpec, Pt, RecordValue } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { appContext, registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { colorMatcher } from "./pdfImport.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { setViz, store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { mapSolid, type Solid } from "./solids3d.ts";
import {
  aspectOf,
  BODIES,
  bodyNamed,
  cameraPlan,
  cameraSolids,
  diagonalAngle,
  focalForDiagonal,
  focalOn,
  FORMATS,
  LENSES,
  lensFront,
  lensNamed,
  lookOf,
  PAN_LIMIT,
  panToward,
  picture,
  ROLL_LIMIT,
  STANDS,
  TILT_LIMIT,
  type Aim,
  type Stand,
} from "./videoCameraShapes.ts";

export const VIDEO_CAMERA = "Rodeo Video Camera";

const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  position: "Position",
  name: "Name",
  showField: "Show Field of View",
  reach: "Field of View Length",
  format: "Format",
  custom: "Custom Format",
  pan: "Pan Left/Right",
  tilt: "Tilt Up/Down",
  roll: "Rotate Camera L/R",
  lens: "Lens",
  focal: "Focal Length",
  diagonal: "Diagonal Angle of View",
  body: "Camera Body",
  sensor: "CCD/Sensor Format",
  stand: "Stand Type",
  showStand: "Use symbol for stand",
  height: "Height",
} as const;

const FIELD_SHOWN = ["None", "Lines", "Filled"] as const;

/** what the tool places next */
export const videoCameraSettings = {
  lens: LENSES[1].name,
  focal: 25,
  body: BODIES[0].name,
  format: "16:9",
  stand: "Tripod" as Stand,
  height: 1500,
  showField: "Lines" as (typeof FIELD_SHOWN)[number],
  reach: 10000,
};

const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;
const num = (v: RecordValue | undefined): number => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const sensorText = (name: string): string => {
  const b = bodyNamed(name);
  return `${b.width} × ${b.height} mm`;
};

function specs(): PluginFieldSpec[] {
  const k = videoCameraSettings;
  const body = bodyNamed(k.body);
  const focal = focalOn(lensNamed(k.lens), k.focal);
  return [
    { name: FIELD.position, type: TEXT, value: "" },
    { name: FIELD.name, type: TEXT, value: "" },
    { name: FIELD.showField, type: POPUP, value: k.showField },
    { name: FIELD.reach, type: DIMENSION, value: k.reach },
    { name: FIELD.format, type: POPUP, value: k.format },
    { name: FIELD.custom, type: NUMBER, value: round(body.width / body.height, 3) },
    { name: FIELD.pan, type: NUMBER, value: 0 },
    { name: FIELD.tilt, type: NUMBER, value: 0 },
    { name: FIELD.roll, type: NUMBER, value: 0 },
    { name: FIELD.lens, type: POPUP, value: k.lens },
    { name: FIELD.focal, type: NUMBER, value: focal },
    { name: FIELD.diagonal, type: NUMBER, value: round(diagonalAngle(body, focal), 2) },
    { name: FIELD.body, type: POPUP, value: body.name },
    { name: FIELD.sensor, type: TEXT, value: sensorText(body.name) },
    { name: FIELD.stand, type: POPUP, value: k.stand },
    { name: FIELD.showStand, type: BOOL, value: true },
    { name: FIELD.height, type: DIMENSION, value: k.height },
  ];
}

function recordOf(s: EditSession, id: string): { format: number; value(field: string): RecordValue | undefined } {
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === VIDEO_CAMERA);
  if (!rec) throw new Error("That isn't a video camera.");
  return { format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value };
}

/** The camera's settings as its record holds them. */
function settingsOf(s: EditSession, id: string) {
  const rec = recordOf(s, id);
  const body = bodyNamed(str(rec.value(FIELD.body)));
  const lens = lensNamed(str(rec.value(FIELD.lens)));
  const focal = focalOn(lens, num(rec.value(FIELD.focal)));
  const aspect = aspectOf(str(rec.value(FIELD.format)), body, num(rec.value(FIELD.custom)));
  const stand = (STANDS as readonly string[]).includes(str(rec.value(FIELD.stand))) ? (str(rec.value(FIELD.stand)) as Stand) : "Tripod";
  const aim: Aim = { pan: num(rec.value(FIELD.pan)), tilt: num(rec.value(FIELD.tilt)), roll: num(rec.value(FIELD.roll)), height: num(rec.value(FIELD.height)) };
  return { rec, body, lens, focal, aspect, stand, aim, picture: picture(body, focal, aspect) };
}

/** Focal length and angle of view in step after an edit (the angle given wins when it was the one set), within the lens's range; pan, tilt and roll within theirs. */
function settle(s: EditSession, id: string, changed: ReadonlySet<string>): void {
  const rec = recordOf(s, id);
  const body = bodyNamed(str(rec.value(FIELD.body)));
  const lens = lensNamed(str(rec.value(FIELD.lens)));
  const asked = changed.has(FIELD.diagonal) && !changed.has(FIELD.focal) ? focalForDiagonal(body, num(rec.value(FIELD.diagonal))) : num(rec.value(FIELD.focal));
  const focal = round(focalOn(lens, asked), 2);
  const set = (field: string, value: RecordValue): void => {
    if (rec.value(field) !== value) s.setRecordField(id, rec.format, field, value);
  };
  set(FIELD.focal, focal);
  set(FIELD.diagonal, round(diagonalAngle(body, focal), 2));
  set(FIELD.sensor, sensorText(body.name));
  for (const [field, limit] of [
    [FIELD.pan, PAN_LIMIT],
    [FIELD.tilt, TILT_LIMIT],
    [FIELD.roll, ROLL_LIMIT],
  ] as const) {
    set(field, Math.min(limit, Math.max(-limit, num(rec.value(field)))));
  }
  if (num(rec.value(FIELD.height)) < 0) set(FIELD.height, 0);
  if (num(rec.value(FIELD.reach)) < 0) set(FIELD.reach, 0);
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** Draws video camera `id` from its parameters, in the session's open batch. */
function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  if (!obj) throw new Error("That isn't a video camera.");
  const k = settingsOf(s, id);
  const shown = str(k.rec.value(FIELD.showField));
  const plan = cameraPlan(k.aim, k.stand, k.picture.across, shown === "None" ? 0 : num(k.rec.value(FIELD.reach)));
  const match = colorMatcher();
  const ink = (hex: string): number => match(hexToRgb(hex));
  const line = ink("#1f2933");
  const fieldInk = ink("#2f80ed");
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  const add = (shape: NewShape, look: Partial<Attributes>): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const outlined: Partial<Attributes> = { penFore: line, fillPattern: 0 };
  const solid = (hex: string): Partial<Attributes> => ({ penFore: line, fillPattern: 1, fillFore: ink(hex), fillBack: ink(hex), fillOpacity: 100 });
  if (plan.field) add({ kind: "polygon", points: [...plan.field], closed: true }, shown === "Filled" ? { penFore: fieldInk, fillPattern: 1, fillFore: fieldInk, fillBack: fieldInk, fillOpacity: 18 } : { penFore: fieldInk, fillPattern: 0 });
  if (k.rec.value(FIELD.showStand) !== false) {
    for (const ring of plan.stand) add({ kind: "polygon", points: [...ring], closed: true }, outlined);
    for (const [a, b] of plan.standLines) add({ kind: "line", a, b }, outlined);
  }
  add({ kind: "polygon", points: [...plan.body], closed: true }, solid("#9aa3ad"));
  add({ kind: "polygon", points: [...plan.lens], closed: true }, solid("#4b5563"));
  const ids = s.addObjects(obj.layerId, shapes, obj.classIndex, looks);
  // addMeshes lifts them by the layer's elevation, and a plug-in object's drawing is lifted by it again when shown
  const base = s.doc.layers().find((l) => l.id === obj.layerId)?.elevation ?? 0;
  const lowered = (solidFaces: Solid): Solid => mapSolid(solidFaces, ([x, y, z]) => [x, y, z - base]);
  const parts = cameraSolids(k.aim, k.stand);
  const meshes = [parts.head, parts.lens, ...(k.rec.value(FIELD.showStand) !== false && parts.stand.length ? [parts.stand] : [])].map(lowered);
  ids.push(...s.addMeshes(obj.layerId, meshes, obj.classIndex, solid("#6b7280")));
  s.setPluginDrawing(id, ids);
}

/** Places a video camera at `at`, facing `angle`°, and selects it. */
export function placeVideoCamera(layerId: string, at: Pt, angle: number): void {
  const r = attempt("Video Camera", (s) =>
    s.batch(() => {
      const list = specs();
      const id = s.addPluginObject(layerId, VIDEO_CAMERA, list, Object.fromEntries(list.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(label, (s) =>
    s.batch(() => {
      const rec = recordOf(s, id);
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      settle(s, id, new Set(Object.keys(values)));
      drawInto(s, id);
    }),
  );
}

/** A point of the camera's own frame on the drawing (x, y) and above its layer's plane (z). */
function placed(s: EditSession, id: string, p: readonly [number, number, number]): [number, number, number] {
  const obj = s.doc.object(id);
  const at = obj?.insertion ?? { x: 0, y: 0 };
  const t = (s.pluginAngle(id) * Math.PI) / 180;
  const elevation = s.doc.layers().find((l) => l.id === obj?.layerId)?.elevation ?? 0;
  return [at.x + p[0] * Math.cos(t) - p[1] * Math.sin(t), at.y + p[0] * Math.sin(t) + p[1] * Math.cos(t), elevation + p[2]];
}

/** Activate Camera: the 3D view in perspective through the camera's lens, the picture its format makes. */
export async function activateVideoCamera(id: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  let eye: [number, number, number];
  let target: [number, number, number];
  let k: ReturnType<typeof settingsOf>;
  try {
    k = settingsOf(s, id);
    const front = lensFront(k.aim);
    const look = lookOf(k.aim);
    eye = placed(s, id, front);
    target = placed(s, id, [front[0] + look[0] * 5000, front[1] + look[1] * 5000, front[2] + look[2] * 5000]);
  } catch (err) {
    toast(errorMessage(err));
    return;
  }
  const view = await appContext()?.show3d();
  if (!view) return;
  if (store.viz3d.projection !== "perspective") setViz({ projection: "perspective" });
  view.lookThrough(eye, target, k.picture.across, k.aspect);
  const name = str(k.rec.value(FIELD.name)).trim();
  toast(`${name || "Video camera"}: ${k.focal} mm on ${k.body.name}, ${round(k.picture.across, 1)}° across.`, "info");
}

/** Aim Camera: the next click on the drawing pans the camera toward it. */
function aimVideoCamera(id: string): void {
  placeAtNextClick({
    what: "the point to aim the camera at",
    place(at) {
      const s = store.session;
      const obj = s?.doc.object(id);
      if (!s || !obj?.insertion) return;
      const t = (-s.pluginAngle(id) * Math.PI) / 180;
      const dx = at.x - obj.insertion.x;
      const dy = at.y - obj.insertion.y;
      const pan = panToward({ x: dx * Math.cos(t) - dy * Math.sin(t), y: dx * Math.sin(t) + dy * Math.cos(t) });
      if (pan === null) {
        toast(`That's behind the camera: it pans ${PAN_LIMIT}° either way. Turn the camera first.`, "info");
        return;
      }
      edit(id, "Aim Camera", { [FIELD.pan]: round(pan, 2) });
    },
  });
}

const LABELS: Readonly<Record<string, string>> = {
  [FIELD.pan]: "Pan Left/Right (°)",
  [FIELD.tilt]: "Tilt Up/Down (°)",
  [FIELD.roll]: "Rotate Camera L/R (°)",
  [FIELD.focal]: "Focal Length (mm)",
  [FIELD.diagonal]: "Diagonal Angle of View (°)",
  [FIELD.custom]: "Custom Format (width ÷ height)",
};

const param = (id: number, field: string, level = 0): PluginWidget => ({ id, kind: "param", field, label: "", level });
const ACTIVATE = 30;
const AIM = 31;
const CUSTOM = 7;
const LAYOUT: readonly PluginWidget[] = [
  param(1, FIELD.position),
  param(2, FIELD.name),
  { id: ACTIVATE, kind: "button", label: "Activate Camera", level: 0 },
  param(3, FIELD.showField),
  param(4, FIELD.reach),
  param(5, FIELD.format),
  param(CUSTOM, FIELD.custom, 1),
  { id: 40, kind: "divider", label: "Fine Tune Camera", level: 0 },
  { id: AIM, kind: "button", label: "Aim Camera", level: 0 },
  param(8, FIELD.pan),
  param(9, FIELD.tilt),
  param(10, FIELD.roll),
  { id: 41, kind: "divider", label: "Lens", level: 0 },
  param(11, FIELD.lens),
  param(12, FIELD.focal),
  param(13, FIELD.diagonal),
  { id: 42, kind: "divider", label: "Camera Body", level: 0 },
  param(14, FIELD.body),
  param(15, FIELD.sensor),
  { id: 43, kind: "divider", label: "Stand Type", level: 0 },
  param(16, FIELD.stand),
  param(17, FIELD.showStand),
  param(18, FIELD.height),
];

const CHOICES: Readonly<Record<string, readonly string[]>> = {
  [FIELD.showField]: FIELD_SHOWN,
  [FIELD.format]: FORMATS.map((f) => f.name),
  [FIELD.lens]: LENSES.map((l) => l.name),
  [FIELD.body]: BODIES.map((b) => b.name),
  [FIELD.stand]: STANDS,
};

const driver: PluginDriver = {
  name: VIDEO_CAMERA,
  shape: "point",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: (field) => field === FIELD.sensor,
  choices: (field) => CHOICES[field]?.map((value) => ({ value, label: value })),
  place: (layerId, at, angle) => placeVideoCamera(layerId, at, angle),
  edit: (id, values) => edit(id, "Edit Video Camera", values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    if (!s) return;
    const custom = recordOf(s, id).value(FIELD.format) === "Custom Aspect";
    apply(new Map([[CUSTOM, { enabled: custom, visible: true }]]));
  },
  press(id, widget) {
    if (widget === ACTIVATE) void activateVideoCamera(id);
    else if (widget === AIM) aimVideoCamera(id);
  },
  open: (id) => void activateVideoCamera(id),
};

registerPluginDrivers(() => [driver]);
