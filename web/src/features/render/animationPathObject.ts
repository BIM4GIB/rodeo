// Model › Create Animation's animation path as a Rodeo plug-in object ('Rodeo Animation Path'), made
// by the commands in movie.ts: the camera's path with a ring on each keyframe (the selected one
// filled) and the camera where Time puts it, in plan; the path in 3D. Vectorworks keeps an animation
// path object of its own, and how a drawing saves one isn't known, so Vectorworks sees this one as a
// plug-in it doesn't have. Object Info, as Vectorworks lays it out: Length, Path Type, Duration and a
// walk's Camera Height; Preview: Play and Pause (the 3D view through the camera, from Time on), Skip
// Backward and Skip Forward (the first and last keyframes), Time (0–100%), Activate and Deactivate
// Camera View (any other move of the 3D view deactivates it); Keyframe: Previous and Next, Add Keyframe
// (where the camera is) and Delete Keyframe, the keyframe's Speed and View Angle, Display Frames (a tick
// at each of the movie's frames) and how many there are; Animation: Create Movie (also on its
// right-click menu). Reshape moves its vertices, which makes it Fly Freely, as Vectorworks does.
// animationPath.ts has the sums.

import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../core/index.ts";
import { attempt } from "../../app/commands.ts";
import { appContext, registerContextRows, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../app/ext.ts";
import { colorMatcher } from "../../app/pdfImport.ts";
import { layerScaleOf } from "../../app/spaces.ts";
import { setViz, store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { View3D } from "../../app/view3d.ts";
import { addKeyframe, cameraAt, deleteKeyframe, keyAt, keyTime, pathLength, readPath, setKeyframe, writePath, type Camera, type CameraPath, type PathType, type V3 } from "./animationPath.ts";

export const ANIMATION_PATH = "Rodeo Animation Path";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;

const F = {
  name: "Name",
  length: "Length",
  type: "Path Type",
  duration: "Duration",
  height: "Camera Height",
  time: "Time",
  keyframe: "Keyframe",
  speed: "Speed",
  angle: "View Angle",
  frames: "Display Frames",
  count: "Keyframes",
  /** its points from its insertion and above its layer, and its keyframes (writePath): kept out of Object Info */
  path: "Path",
  /** the keyframe Previous, Next, Speed and View Angle work on, from 0 */
  selected: "Selected Keyframe",
  /** an orthographic orbit's half height on the screen, mm */
  half: "Half Height",
  /** Create Movie's other settings, as JSON */
  movie: "Movie Settings",
} as const;

const TYPE_NAMES: Readonly<Record<PathType, string>> = { fly: "Fly Freely", walk: "Walk", orbit: "Orthographic Orbit" };

/** the path's colour, so it reads apart from the drawing */
const PATH_INK = "#e8590c";
const PATH_MILS = 14;
/** a keyframe's ring across, the camera's length and a frame tick's, on paper, mm */
const KEY_MM = 2;
const CAMERA_MM = 8;
const TICK_MM = 1.2;
/** at most this many frame ticks are drawn */
const MAX_TICKS = 3000;
/** Duration's limits, seconds */
const MIN_DURATION = 1;
const MAX_DURATION = 3600;

/** Create Movie's settings, as an animation path keeps them (movie.ts reads them) */
export interface MovieSettings {
  readonly fps: number;
  readonly mode: string;
  readonly quality: string;
  readonly size: string;
  readonly width: number;
  readonly height: number;
  readonly range: "full" | "limited";
  readonly start: number;
  readonly end: number;
}

const FIRST_MOVIE: MovieSettings = { fps: 30, mode: "shaded", quality: "high", size: "1280x720", width: 1280, height: 720, range: "full", start: 0, end: 0 };

interface Rec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function recOf(doc: VwxDocument, id: string): Rec | null {
  const o = doc.object(id);
  const rec = o?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === ANIMATION_PATH) : undefined;
  return rec && o ? { id, layerId: o.layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

function mustRec(doc: VwxDocument, id: string): Rec {
  const r = recOf(doc, id);
  if (!r) throw new Error("That isn't an animation path.");
  return r;
}

export function isAnimationPath(id: string | null): boolean {
  const s = store.session;
  return !!(s && id !== null && s.doc.hasPluginFormat(ANIMATION_PATH) && recOf(s.doc, id));
}

const num = (v: RecordValue | undefined, or = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : or);
const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Its path as it keeps it: from its insertion, above its layer (a walk's at 0, its Camera Height added when it's followed). */
function localPath(r: Rec): CameraPath {
  const p = readPath(str(r.value(F.path)));
  if (!p || p.keys.length < 2) throw new Error("That animation path has no path for its camera.");
  return p;
}

function selectedOf(r: Rec, p: CameraPath): number {
  return clamp(Math.round(num(r.value(F.selected))), 0, p.keys.length - 1);
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

function elevationOf(doc: VwxDocument, layerId: string): number {
  return doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
}

/** The camera at `t` (0 to 1) on the drawing: heights above the model's 0. */
function worldCamera(doc: VwxDocument, r: Rec, t: number): Camera {
  const o = doc.object(r.id);
  if (!o) throw new Error("That isn't an animation path.");
  const p = localPath(r);
  const { toWorld } = placeOf(o);
  const lift = elevationOf(doc, r.layerId) + (p.type === "walk" ? num(r.value(F.height)) : 0);
  const cam = cameraAt(p, t);
  const out = (q: V3): V3 => ({ ...toWorld(q), z: q.z + lift });
  return { eye: out(cam.eye), target: out(cam.target), angle: cam.angle };
}

/** What Create Movie needs from animation path `id`. */
export function movieSource(id: string): {
  readonly camera: (t: number) => Camera;
  readonly orthographic: boolean;
  readonly half: number;
  readonly duration: number;
  readonly loops: boolean;
  readonly settings: MovieSettings;
  readonly name: string;
} | null {
  const s = store.session;
  const r = s ? recOf(s.doc, id) : null;
  if (!s || !r) return null;
  const p = localPath(r);
  const first = p.points[0];
  const last = p.points[p.points.length - 1];
  let settings = FIRST_MOVIE;
  try {
    settings = { ...FIRST_MOVIE, ...(JSON.parse(str(r.value(F.movie)) || "{}") as Partial<MovieSettings>) };
  } catch {
    // its first settings
  }
  const doc = s.doc;
  return {
    camera: (t) => worldCamera(doc, r, t),
    orthographic: p.type === "orbit",
    half: num(r.value(F.half), 5000),
    duration: num(r.value(F.duration), 10),
    // a path that ends where it began loops, its last frame stopping short of its first
    loops: Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < 1e-3,
    settings,
    name: str(r.value(F.name)).trim() || "animation",
  };
}

/** Create Movie's settings kept with animation path `id`, its Duration with them, as one undo step. */
export function keepMovieSettings(id: string, duration: number, settings: MovieSettings): void {
  edit(id, "Create Movie", { [F.duration]: duration, [F.movie]: JSON.stringify(settings) });
}

const ink = (hex: string): number => colorMatcher()({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

const ring = (c: Pt, r: number): Pt[] => Array.from({ length: 16 }, (_, k) => ({ x: c.x + r * Math.cos((k * Math.PI) / 8), y: c.y + r * Math.sin((k * Math.PI) / 8) }));

/** Which way the path runs in plan at `t`, or null where it runs straight up or down. */
function planHeading(p: CameraPath, t: number): Pt | null {
  const a = cameraAt(p, Math.max(0, t - 1e-3)).eye;
  const b = cameraAt(p, Math.min(1, t + 1e-3)).eye;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return l > 1e-9 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : null;
}

/** Draws animation path `r` from its parameters, in the session's open batch; its Length, keyframe count and the selected keyframe's settings brought up to date. */
function drawInto(s: EditSession, r: Rec): void {
  const o = s.doc.object(r.id);
  if (!o) throw new Error("That isn't an animation path.");
  const p = localPath(r);
  const scale = layerScaleOf(r.layerId);
  const paper = (mm: number): number => mm * scale;
  const pen = ink(PATH_INK);
  const line: Partial<Attributes> = { penFore: pen, lineWeight: PATH_MILS, fillPattern: 0 };
  const filled: Partial<Attributes> = { penFore: pen, lineWeight: PATH_MILS, fillPattern: 1, fillFore: pen, fillBack: pen, fillOpacity: 100 };
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  const add = (shape: NewShape, look: Partial<Attributes>): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const plan: Pt[] = [];
  for (const q of p.points) {
    const last = plan[plan.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-6) plan.push({ x: q.x, y: q.y });
  }
  if (plan.length >= 2) add({ kind: "polyline", points: plan, closed: false }, line);
  const selected = selectedOf(r, p);
  p.keys.forEach((k, i) => add({ kind: "polygon", points: ring(p.points[k.at], paper(KEY_MM / 2)), closed: true }, i === selected ? filled : line));
  const duration = clamp(num(r.value(F.duration), 10), MIN_DURATION, MAX_DURATION);
  if (r.value(F.frames) === true) {
    const fps = movieSource(r.id)?.settings.fps ?? FIRST_MOVIE.fps;
    const frames = Math.min(MAX_TICKS, Math.max(2, Math.round(duration * fps)));
    const half = paper(TICK_MM / 2);
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1);
      const at = cameraAt(p, t).eye;
      const h = planHeading(p, t);
      if (h) add({ kind: "line", a: { x: at.x - h.y * half, y: at.y + h.x * half }, b: { x: at.x + h.y * half, y: at.y - h.x * half } }, line);
    }
  }
  // the camera where Time puts it: a wedge its view angle wide, toward what it looks at
  const t = clamp(num(r.value(F.time)), 0, 100) / 100;
  const cam = cameraAt(p, t);
  const lookLen = Math.hypot(cam.target.x - cam.eye.x, cam.target.y - cam.eye.y);
  const dir = lookLen > 1e-9 ? { x: (cam.target.x - cam.eye.x) / lookLen, y: (cam.target.y - cam.eye.y) / lookLen } : (planHeading(p, t) ?? { x: 1, y: 0 });
  const reach = paper(CAMERA_MM);
  const half = (Math.min(cam.angle, 120) * Math.PI) / 360;
  const side = (sign: number): Pt => ({
    x: cam.eye.x + reach * (dir.x * Math.cos(half) - sign * dir.y * Math.sin(half)),
    y: cam.eye.y + reach * (dir.y * Math.cos(half) + sign * dir.x * Math.sin(half)),
  });
  add({ kind: "polygon", points: [{ x: cam.eye.x, y: cam.eye.y }, side(1), side(-1)], closed: true }, { ...filled, fillOpacity: 35 });
  const ids = s.addObjects(r.layerId, shapes, o.classIndex, looks);
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const elevation = elevationOf(s.doc, r.layerId);
  const lift = (p.type === "walk" ? num(r.value(F.height)) : 0) - elevation;
  ids.push(s.add3DPolygons(r.layerId, [{ points: p.points.flatMap((q) => [q.x, q.y, q.z + lift]), closed: false }], o.classIndex));
  const key = p.keys[selected];
  const set = (field: string, value: RecordValue): void => {
    if (r.value(field) !== value) s.setRecordField(r.id, r.format, field, value);
  };
  set(F.length, Math.round(pathLength(p) * 1e4) / 1e4);
  set(F.count, p.keys.length);
  set(F.keyframe, `${selected + 1} of ${p.keys.length}`);
  set(F.speed, key.speed);
  set(F.angle, Math.round(key.angle * 100) / 100);
  set(F.type, TYPE_NAMES[p.type]);
  set(F.duration, duration);
  s.setPluginDrawing(r.id, ids);
}

const specs = (path: CameraPath, o: { duration: number; height: number; half: number }): PluginFieldSpec[] => [
  { name: F.name, type: TEXT, value: "" },
  { name: F.length, type: DIMENSION, value: 0 },
  { name: F.type, type: TEXT, value: TYPE_NAMES[path.type] },
  { name: F.duration, type: NUMBER, value: o.duration },
  { name: F.height, type: DIMENSION, value: o.height },
  { name: F.time, type: NUMBER, value: 0 },
  { name: F.keyframe, type: TEXT, value: "" },
  { name: F.speed, type: NUMBER, value: 0 },
  { name: F.angle, type: NUMBER, value: path.keys[0]?.angle ?? 0 },
  { name: F.frames, type: BOOL, value: false },
  { name: F.count, type: NUMBER, value: path.keys.length },
  { name: F.path, type: TEXT, value: writePath(path) },
  { name: F.selected, type: NUMBER, value: 0 },
  { name: F.half, type: NUMBER, value: o.half },
  { name: F.movie, type: TEXT, value: JSON.stringify({ ...FIRST_MOVIE, end: o.duration }) },
];

/**
 * A new animation path on `layerId` along `path` (on the drawing, heights above the model's 0; a
 * walk's points at the layer, its camera `height` above them), as part of a batch; its id.
 */
export function addAnimationPath(s: EditSession, layerId: string, path: CameraPath, o: { duration: number; height: number; half: number }): string {
  const at = { x: path.points[0].x, y: path.points[0].y };
  const elevation = elevationOf(s.doc, layerId);
  const local = (q: V3): V3 => ({ x: q.x - at.x, y: q.y - at.y, z: path.type === "walk" ? 0 : q.z - elevation });
  const kept: CameraPath = { ...path, points: path.points.map(local), keys: path.keys.map((k) => ({ ...k, target: k.target && local(k.target) })) };
  const list = specs(kept, o);
  const id = s.addPluginObject(layerId, ANIMATION_PATH, list, Object.fromEntries(list.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  drawInto(s, mustRec(s.doc, id));
  return id;
}

/** A keyframe edit: the path it leaves, the keyframe selected, and Time (0 to 1) when it moves the camera. */
interface KeyChange {
  readonly path: CameraPath;
  readonly selected: number;
  readonly time?: number;
}

/** Sets fields of animation path `id` and draws it again, as one undo step: a keyframe's Speed and View Angle go into its path. */
function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>, change?: (p: CameraPath, selected: number) => KeyChange | string): void {
  const r = attempt(label, (s) =>
    s.batch(() => {
      const rec = mustRec(s.doc, id);
      let p = localPath(rec);
      let selected = selectedOf(rec, p);
      let time = values[F.time] ?? rec.value(F.time);
      if (change) {
        const next = change(p, selected);
        if (typeof next === "string") throw new Error(next);
        ({ path: p, selected } = next);
        if (next.time !== undefined) time = Math.round(next.time * 1e5) / 1e3;
      }
      const angle = values[F.angle];
      const speed = values[F.speed];
      if (angle !== undefined || speed !== undefined) p = setKeyframe(p, selected, { angle: angle === undefined ? undefined : num(angle), speed: speed === undefined ? undefined : num(speed) });
      const set = (field: string, value: RecordValue): void => {
        if (rec.value(field) !== value) s.setRecordField(id, rec.format, field, value);
      };
      for (const [field, value] of Object.entries(values)) if (field !== F.angle && field !== F.speed) set(field, value);
      set(F.duration, clamp(num(values[F.duration] ?? rec.value(F.duration), 10), MIN_DURATION, MAX_DURATION));
      set(F.time, clamp(num(time), 0, 100));
      set(F.height, Math.max(0, num(values[F.height] ?? rec.value(F.height))));
      set(F.selected, selected);
      set(F.path, writePath(p));
      drawInto(s, mustRec(s.doc, id));
    }),
  );
  if (r && viewing?.id === id) void aim(id);
}

// ── the camera view ──────────────────────────────────────────────────────────

/** the animation path the 3D view looks through, and how to stop hearing its moves */
let viewing: { readonly id: string; readonly off: () => void } | null = null;
/** the path playing, and how to stop it */
let playing: { readonly id: string; readonly stop: () => number } | null = null;
/** set while the 3D view is moved for the camera, so the move doesn't deactivate it */
let steering = false;

const refresh = (): void => store.emit("selection");

/** Puts the 3D view where animation path `id`'s camera is at `t` (0 to 1; its Time when not given). */
async function aim(id: string, t?: number): Promise<View3D | null> {
  const s = store.session;
  const r = s ? recOf(s.doc, id) : null;
  const view = appContext()?.view3d() ?? null;
  if (!s || !r || !view) return null;
  const src = movieSource(id);
  if (!src) return null;
  const cam = src.camera(t ?? clamp(num(r.value(F.time)), 0, 100) / 100);
  steering = true;
  try {
    const projection = src.orthographic ? "orthogonal" : "perspective";
    if (store.viz3d.projection !== projection) setViz({ projection });
    const el = view.domElement;
    const aspect = (el.clientWidth || 4) / (el.clientHeight || 3);
    if (src.orthographic) view.setCameraState({ ...view.cameraState(), position: [cam.eye.x, cam.eye.y, cam.eye.z], target: [cam.target.x, cam.target.y, cam.target.z], zoom: 1, half: src.half });
    else view.lookThrough([cam.eye.x, cam.eye.y, cam.eye.z], [cam.target.x, cam.target.y, cam.target.z], cam.angle, aspect);
  } finally {
    steering = false;
  }
  return view;
}

/** Activate Camera View: the 3D view through animation path `id`'s camera, till the view is moved otherwise. */
async function activate(id: string): Promise<View3D | null> {
  const view = await appContext()?.show3d();
  if (!view) {
    toast("The 3D view is not available here.");
    return null;
  }
  if (viewing?.id !== id) {
    deactivate();
    const off = view.onCameraChange(() => {
      if (!steering) deactivate();
    });
    viewing = { id, off };
  }
  await aim(id);
  refresh();
  return view;
}

/** Deactivate Camera View: the 3D view stays where it is, no longer following the camera. */
function deactivate(): void {
  playing?.stop();
  playing = null;
  if (!viewing) return;
  viewing.off();
  viewing = null;
  refresh();
}

/** Play: the camera along the path in the 3D view from Time on, at the pace of its Duration. */
async function play(id: string): Promise<void> {
  const s = store.session;
  const r = s ? recOf(s.doc, id) : null;
  if (!s || !r) return;
  const view = await activate(id);
  if (!view) return;
  const duration = clamp(num(r.value(F.duration), 10), MIN_DURATION, MAX_DURATION);
  let from = clamp(num(r.value(F.time)), 0, 100) / 100;
  if (from >= 1) from = 0;
  const begun = performance.now();
  let now = from;
  let frame = 0;
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    now = Math.min(1, from + (performance.now() - begun) / 1000 / duration);
    void aim(id, now);
    if (now >= 1) {
      playing = null;
      refresh();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  playing = {
    id,
    stop: () => {
      stopped = true;
      cancelAnimationFrame(frame);
      return now;
    },
  };
  refresh();
  frame = requestAnimationFrame(tick);
}

/** Pause: stops playing, Time where the camera got to. */
function pause(id: string): void {
  if (playing?.id !== id) return;
  const t = playing.stop();
  playing = null;
  edit(id, "Pause Animation", { [F.time]: Math.round(t * 1000) / 10 });
}

/** Goes to the keyframe `pick` gives: it's selected and Time put on it. */
function toKeyframe(id: string, label: string, pick: (selected: number, count: number) => number): void {
  edit(id, label, {}, (p, selected) => {
    const k = clamp(pick(selected, p.keys.length), 0, p.keys.length - 1);
    return { path: p, selected: k, time: keyTime(p, k) };
  });
}

/** Create Movie for animation path `id` (movie.ts). */
function createMovie(id: string): void {
  playing?.stop();
  playing = null;
  import("./movie.ts")
    .then((m) => m.createMovie(id))
    .catch((err: unknown) => toast(`Create Movie failed: ${errorMessage(err)}`));
}

// ── Object Info ──────────────────────────────────────────────────────────────

const PLAY = 30;
const PAUSE = 31;
const BACK = 32;
const FORWARD = 33;
const ACTIVATE = 34;
const DEACTIVATE = 35;
const PREVIOUS = 36;
const NEXT = 37;
const ADD_KEY = 38;
const DELETE_KEY = 39;
const MOVIE = 40;
const HEIGHT = 5;

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const button = (id: number, label: string): PluginWidget => ({ id, kind: "button", label, level: 0 });

const LAYOUT: readonly PluginWidget[] = [
  param(1, F.name),
  param(2, F.length),
  param(3, F.type),
  param(4, F.duration),
  param(HEIGHT, F.height),
  { id: 50, kind: "divider", label: "Preview", level: 0 },
  button(PLAY, "Play"),
  button(PAUSE, "Pause"),
  button(BACK, "Skip Backward"),
  button(FORWARD, "Skip Forward"),
  param(6, F.time),
  button(ACTIVATE, "Activate Camera View"),
  button(DEACTIVATE, "Deactivate Camera View"),
  { id: 51, kind: "divider", label: "Keyframe", level: 0 },
  param(7, F.keyframe),
  button(PREVIOUS, "Previous Keyframe"),
  button(NEXT, "Next Keyframe"),
  button(ADD_KEY, "Add Keyframe"),
  button(DELETE_KEY, "Delete Keyframe"),
  param(8, F.speed),
  param(9, F.angle),
  param(10, F.frames),
  param(11, F.count),
  { id: 52, kind: "divider", label: "Animation", level: 0 },
  button(MOVIE, "Create Movie…"),
];

const LABELS: Readonly<Record<string, string>> = {
  [F.duration]: "Duration (seconds)",
  [F.time]: "Time (0%–100%)",
  [F.speed]: "Speed (−99%–100%)",
  [F.angle]: "View Angle (12°–130°)",
};

const driver: PluginDriver = {
  name: ANIMATION_PATH,
  shape: "linear",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: (field) => field === F.length || field === F.type || field === F.keyframe || field === F.count,
  choices: () => undefined,
  place: () => toast("Make one with Model › Create Animation.", "info"),
  edit: (id, values) => edit(id, "Edit Animation Path", values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, mustRec(s.doc, id)));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    const r = s ? recOf(s.doc, id) : null;
    if (!r) return;
    let p: CameraPath;
    try {
      p = localPath(r);
    } catch {
      return;
    }
    const selected = selectedOf(r, p);
    const on = keyAt(p, clamp(num(r.value(F.time)), 0, 100) / 100) !== null;
    const isPlaying = playing?.id === id;
    const isViewing = viewing?.id === id;
    apply(
      new Map([
        [HEIGHT, { enabled: true, visible: p.type === "walk" }],
        [PLAY, { enabled: true, visible: !isPlaying }],
        [PAUSE, { enabled: true, visible: isPlaying }],
        [ACTIVATE, { enabled: true, visible: !isViewing }],
        [DEACTIVATE, { enabled: true, visible: isViewing }],
        [PREVIOUS, { enabled: selected > 0, visible: true }],
        [NEXT, { enabled: selected < p.keys.length - 1, visible: true }],
        [ADD_KEY, { enabled: !on, visible: true }],
        [DELETE_KEY, { enabled: selected > 0 && selected < p.keys.length - 1, visible: true }],
      ]),
    );
  },
  press(id, widget) {
    if (widget === PLAY) void play(id);
    else if (widget === PAUSE) pause(id);
    else if (widget === BACK) toKeyframe(id, "Skip Backward", () => 0);
    else if (widget === FORWARD) toKeyframe(id, "Skip Forward", (_, n) => n - 1);
    else if (widget === ACTIVATE) void activate(id);
    else if (widget === DEACTIVATE) deactivate();
    else if (widget === PREVIOUS) toKeyframe(id, "Previous Keyframe", (k) => k - 1);
    else if (widget === NEXT) toKeyframe(id, "Next Keyframe", (k) => k + 1);
    else if (widget === ADD_KEY) {
      edit(id, "Add Keyframe", {}, (p, selected) => {
        const s = store.session;
        const r = s ? recOf(s.doc, id) : null;
        const t = r ? clamp(num(r.value(F.time)), 0, 100) / 100 : 0;
        const q = addKeyframe(p, t);
        if (!q) return "The camera is on a keyframe: move Time to where the new one goes.";
        return { path: q, selected: keyAt(q, t) ?? selected };
      });
    } else if (widget === DELETE_KEY) {
      edit(id, "Delete Keyframe", {}, (p, selected) => {
        const q = deleteKeyframe(p, selected);
        return q ? { path: q, selected: selected - 1 } : "The first and last keyframes stay.";
      });
    } else if (widget === MOVIE) createMovie(id);
  },
  open: (id) => void activate(id),
  path(id) {
    const s = store.session;
    const r = s ? recOf(s.doc, id) : null;
    const o = s?.doc.object(id);
    if (!r || !o) return null;
    const { toWorld } = placeOf(o);
    return { points: localPath(r).points.map((q) => toWorld(q)), closed: false };
  },
  setPath(s, id, corners) {
    const r = mustRec(s.doc, id);
    const o = s.doc.object(id);
    const p = localPath(r);
    if (!o || corners.length !== p.points.length) throw new Error("Reshape moves an animation path's vertices; add or delete keyframes in Object Info.");
    const { toLocal } = placeOf(o);
    // reshaped, it flies freely, as Vectorworks makes it: a walk at its camera height
    const rise = p.type === "walk" ? num(r.value(F.height)) : 0;
    const points = corners.map((c, i) => ({ ...toLocal(c), z: p.points[i].z + rise }));
    const keys = p.keys.map((k) => ({ ...k, target: k.target && { ...k.target, z: k.target.z + rise } }));
    s.setRecordField(id, r.format, F.path, writePath({ type: "fly", points, keys }));
    drawInto(s, mustRec(s.doc, id));
  },
};

registerPluginDrivers(() => [driver]);

registerContextRows((under) => (isAnimationPath(under) && under !== null ? [{ label: "Create Movie…", run: () => createMovie(under) }] : []));
