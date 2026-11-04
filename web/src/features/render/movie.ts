// Model > Create Animation, as Vectorworks has it: Create Walkthrough Path from Selection, Create
// Walkthrough Path from Saved Views…, Create Orbit Path… and Create Spin Path, each making an animation
// path object (animationPathObject.ts) on the active design layer, its keyframes placed for it, to play in the 3D view, edit and make movies from;
// and Create Movie…, which records the movie of one, the 3D view drawing each frame from the camera's
// place along the path (the progress window shows them as they go). The browser records it: an .mp4
// where it can make one, else a .webm.
//
// Orbit: round a centre at the 3D view's eye height and distance from it, looking at it, by the
// rotation angle (counter-clockwise seen from above), in perspective or orthogonal. Spin: once round
// the selection, framed, from above it to below and back again so every side shows. Walkthrough:
// along a selected line, arc, polyline or polygon the way it was drawn, which it replaces, the camera
// its Camera Height above the active layer, looking ahead along the path. From saved views: straight
// from each view's camera to the next's, in the order listed (views saved in the 3D view, in
// perspective, as Rodeo's saved views keep a camera only then).

import { attempt, setEditGroup } from "../../app/commands.ts";
import { pathOf } from "../../app/cutting.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { showDialog } from "../../app/menubar.ts";
import { savedViews, type ViewCamera } from "../../app/panels/views.ts";
import { reportFailure } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../../app/toolPrefs.ts";
import type { CameraState, PaneLook, RenderMode, View3D } from "../../app/view3d.ts";
import { RENDER_MODES } from "../../app/viewbar.ts";
import { activePlane } from "../../app/workingPlanes.ts";
import type { Pt, Vec3 } from "../../core/index.ts";
import { MAX_ANGLE, MIN_ANGLE, orbitPath, spinPath, viewsPath, walkPath, type CameraPath, type V3 } from "./animationPath.ts";
import { addAnimationPath, keepMovieSettings, movieSource, type MovieSettings } from "./animationPathObject.ts";
import { showProgress } from "./progress.ts";
import "./savedViewsPath.css";

export type AnimationKind = "orbit" | "spin" | "walkthrough" | "views";

/** the camera's eye, the point it looks at and (when it changes) its vertical field of view, for a moment along the path from 0 to 1 */
type Path = (t: number) => { readonly eye: Vec3; readonly target: Vec3; readonly fov?: number };

/** A movie to record: its path and how it is drawn. */
export interface Movie {
  readonly path: Path;
  /** a full turn: the last frame stops short of the first, so a looped movie doesn't stutter */
  readonly loops: boolean;
  readonly projection: PaneLook["projection"];
  /** the orthogonal view's half height (mm), as the 3D view keeps it */
  readonly half: number;
  readonly fov: number;
  /** sets the scene for frame `i` of `frames` before it is drawn (Animate Scenes' lighting) */
  readonly frame?: (i: number, frames: number) => Promise<void>;
}

export const FPS = [24, 25, 30, 60] as const;
/** frame sizes; Screen is the 3D view's own */
export const SIZES = [
  { value: "screen", label: "Screen" },
  { value: "640x480", label: "640 × 480" },
  { value: "1280x720", label: "1280 × 720 (HD)" },
  { value: "1920x1080", label: "1920 × 1080 (Full HD)" },
  { value: "3840x2160", label: "3840 × 2160 (4K UHD)" },
] as const;
/** bits a pixel a frame each quality is recorded at */
export const QUALITIES = [
  { value: "low", label: "Low", bits: 0.04 },
  { value: "medium", label: "Medium", bits: 0.08 },
  { value: "high", label: "High", bits: 0.15 },
  { value: "veryhigh", label: "Very High", bits: 0.3 },
] as const;
const MAX_BITRATE = 80e6;
/** the containers tried, best first: H.264 in an .mp4 as Vectorworks makes, else a .webm */
const MOVIE_TYPES = ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
/** the walkthrough camera's height above the active layer, mm, as Set 3D View stands it */
const EYE_HEIGHT = 1600;
/** a walkthrough's pace for its first duration, mm a second */
const WALKING_PACE = 1400;
/** an orbit's and a spin's first duration, seconds */
const TURN_DURATION = 10;
/** a walkthrough from saved views' first duration, seconds from one view to the next */
const VIEW_LEG_DURATION = 4;
/** the spin's frame: this much room round the selection */
const SPIN_MARGIN = 1.15;
/** degrees between points along an arc path */
const ARC_STEP = 5;
/** a walkthrough's path turning more than this at a vertex has a keyframe there, degrees */
const CORNER_DEG = 15;
/** Create Movie's Custom frame size, pixels each way, as Vectorworks limits it */
const MIN_FRAME = 240;
const MAX_FRAME = 4096;
/** the progress window's picture every this many frames */
const THUMB_EVERY = 10;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const v3 = (p: Vec3): V3 => ({ x: p[0], y: p[1], z: p[2] });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const even = (n: number): number => Math.max(2, 2 * Math.floor(n / 2));

const TITLES: Record<AnimationKind, string> = {
  orbit: "Create Orbit Path",
  spin: "Create Spin Path",
  walkthrough: "Create Walkthrough Path from Selection",
  views: "Create Walkthrough Path from Saved Views",
};

type Made = { readonly path: CameraPath; readonly half: number; readonly duration: number };

export async function createAnimation(kind: AnimationKind): Promise<void> {
  const s = store.session;
  if (!s) return;
  const layer = s.doc.layers().find((l) => l.id === store.activeLayerId);
  if (layer?.kind !== "design") {
    toast("Make a design layer active: the animation path goes on it.", "info");
    return;
  }
  if (kind === "views") {
    const cameras = await pickSavedViews();
    if (!cameras) return;
    const path = viewsPath(cameras.map((c) => ({ eye: v3(c.eye), target: v3(c.target), angle: c.angle })));
    place(kind, layer.id, { path, half: 5000, duration: VIEW_LEG_DURATION * (cameras.length - 1) }, null);
    return;
  }
  // the walkthrough's path is read before the 3D view takes the window
  const route = kind === "walkthrough" ? selectedRoute() : null;
  if (kind === "walkthrough" && !route) {
    toast("Select one line, arc, polyline or polygon for the walkthrough's camera to follow.", "info");
    return;
  }
  const ctx = appContext();
  // the 3D view's camera is where the path starts from; the 2D view comes back after, if it showed
  const was3d = store.view3d;
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is no camera to start from.");
    return;
  }
  const back = (): void => {
    if (!was3d) ctx?.show2d();
  };
  const selected = selectionBounds(view);
  if (kind === "spin" && !selected) {
    back();
    toast("Select the objects to spin: Create Spin Path turns the camera round what's selected.", "info");
    return;
  }
  const start = view.cameraState();
  const el = view.domElement;
  const aspect = (el.clientWidth || 4) / (el.clientHeight || 3);
  // the 3D view's angle across, as the camera's View Angle
  const angle = Math.round(clamp(2 * deg(Math.atan(Math.tan(rad(start.fov / 2)) * aspect)), MIN_ANGLE, MAX_ANGLE) * 100) / 100;
  let made: Made | string;
  if (kind === "orbit") {
    const v = await toolPrefs(
      "Orbit Options",
      [
        { kind: "check", key: "ortho", label: "Orthogonal Projection", value: false },
        { kind: "number", key: "angle", label: "Rotation angle", value: 360, min: -3600, max: 3600, unit: "°" },
        {
          kind: "choice",
          key: "about",
          label: "Rotate about center of",
          value: selected ? "selection" : "layer",
          options: [
            { value: "layer", label: "Active Layer Plane" },
            { value: "plane", label: "Working Plane" },
            { value: "selection", label: "Selection" },
          ],
        },
      ],
      "The camera goes round the centre at the 3D view's eye height and distance from it, looking at it, counter-clockwise from above.",
    );
    if (!v || v.num("angle") === 0) {
      back();
      if (v) toast("Enter a rotation angle other than 0.", "info");
      return;
    }
    made = orbitOf(view, v, selected, angle, aspect);
  } else if (kind === "spin" && selected) made = spinOf(view, selected, angle, aspect);
  else if (route) {
    const points = route.pts.map((p): V3 => ({ x: p.x, y: p.y, z: 0 }));
    made = { path: walkPath(points, route.corners, "walk", angle), half: start.half, duration: Math.min(600, Math.max(5, Math.round(route.length / WALKING_PACE))) };
  } else return;
  back();
  if (typeof made === "string") {
    toast(made, "info");
    return;
  }
  place(kind, layer.id, made, route?.id ?? null);
}

/** The animation path `made` on `layerId`, selected; the object `replaces` (a walkthrough's path) deleted. */
function place(kind: AnimationKind, layerId: string, made: Made, replaces: string | null): void {
  const { path, half, duration } = made;
  const r = attempt(TITLES[kind], (s) =>
    s.batch(() => {
      const id = addAnimationPath(s, layerId, path, { duration, height: EYE_HEIGHT, half });
      // the walkthrough's path becomes the animation path, as in Vectorworks
      if (replaces) s.deleteObjects([replaces]);
      return id;
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  toast("Animation path made: play it, edit its keyframes or make its movie in Object Info.", "info");
}

/** Create Walkthrough Path's dialog: the saved views to go through, in order; null when cancelled or there are too few. */
async function pickSavedViews(): Promise<ViewCamera[] | null> {
  const all = savedViews()?.cameras() ?? [];
  if (all.length < 2) {
    toast("Save two views or more in the 3D view, in perspective, first: Navigation › Views, or the View bar's Saved Views.", "info");
    return null;
  }
  const option = (i: number): HTMLOptionElement => h("option", { text: all[i].name, attrs: { value: String(i) } });
  const list = (label: string): HTMLSelectElement => h("select", { cls: "wv-list", attrs: { multiple: "", size: "10", "aria-label": label } });
  const available = list("Saved Views Available");
  available.append(...all.map((_, i) => option(i)));
  const chosen = list("Walkthrough Path to Create");
  const button = (label: string, run: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text: label, attrs: { type: "button" } });
    b.addEventListener("click", run);
    return b;
  };
  const add = (from: readonly HTMLOptionElement[]): void => chosen.append(...from.map((o) => option(Number(o.value))));
  // the order the camera goes in: the picked rows move one place up or down together
  const shift = (up: boolean): void => {
    const rows = [...chosen.options];
    const order = up ? rows : rows.reverse();
    for (const o of order) {
      const by = up ? o.previousElementSibling : o.nextElementSibling;
      if (o.selected && by instanceof HTMLOptionElement && !by.selected) {
        if (up) by.before(o);
        else by.after(o);
      }
    }
  };
  const buttons = h(
    "div",
    { cls: "wv-buttons" },
    button("Add", () => add([...available.selectedOptions])),
    button("Add All", () => add([...available.options])),
    button("Remove", () => [...chosen.selectedOptions].forEach((o) => o.remove())),
    button("Remove All", () => chosen.replaceChildren()),
    button("Move Up", () => shift(true)),
    button("Move Down", () => shift(false)),
  );
  available.addEventListener("dblclick", () => add([...available.selectedOptions]));
  return showDialog<ViewCamera[]>({
    title: "Create Walkthrough Path",
    cls: "wv-dialog",
    okLabel: "OK",
    body: [
      h("div", { cls: "wv-lists" }, h("label", { cls: "wv-col" }, "Saved Views Available", available), buttons, h("label", { cls: "wv-col" }, "Walkthrough Path to Create", chosen)),
      h("p", { cls: "muted", text: "The camera goes from each view to the next in this order. Only views saved in the 3D view, in perspective, are listed." }),
    ],
    check: () => {
      const picked = [...chosen.options].map((o) => all[Number(o.value)]);
      return picked.length >= 2 ? { value: picked } : { error: "Add two saved views or more to the path.", focus: available };
    },
  });
}

export function isRealisticMode(mode: RenderMode): boolean {
  return mode === "realistic" || mode === "pathtraced";
}

/** The selected objects' 3D box (with all they hold), or null when nothing selected is drawn in 3D. */
function selectionBounds(view: View3D): { readonly min: Vec3; readonly max: Vec3 } | null {
  const s = store.session;
  if (!s || !store.selection.size) return null;
  const ids = new Set(store.selection);
  const objects = s.doc.layers().flatMap((l) => s.doc.objects(l.id));
  // what the selected objects hold, however deep
  for (let grew = true; grew; ) {
    grew = false;
    for (const o of objects) {
      if (o.parentId !== null && ids.has(o.parentId) && !ids.has(o.id)) {
        ids.add(o.id);
        grew = true;
      }
    }
  }
  return view.boundsOf(ids);
}

/** A walkthrough's route: points along the selected path, the way it was drawn, its length, and the vertices that get keyframes. */
interface Route {
  readonly id: string;
  readonly pts: readonly Pt[];
  readonly length: number;
  readonly corners: readonly number[];
}

function selectedRoute(): Route | null {
  const s = store.session;
  const [id] = store.selection;
  if (!s || store.selection.size !== 1 || id === undefined) return null;
  const o = s.doc.object(id);
  const path = o?.shape ? pathOf(o.shape) : null;
  if (!path) return null;
  let pts: Pt[];
  let corners: number[];
  if (path.kind === "chain") {
    // a closed chain runs on from its last point back to its first
    pts = path.closed ? [...path.pts, path.pts[0]] : [...path.pts];
    // keyframes where it turns: its corners, not the many small turns of a curve drawn in pieces
    corners = pts.flatMap((p, i) => {
      if (i === 0 || i === pts.length - 1) return [];
      const a = Math.atan2(p.y - pts[i - 1].y, p.x - pts[i - 1].x);
      const b = Math.atan2(pts[i + 1].y - p.y, pts[i + 1].x - p.x);
      const turn = Math.abs(deg(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
      return turn > CORNER_DEG ? [i] : [];
    });
  } else if (path.kind === "arc") {
    const steps = 2 * Math.max(1, Math.ceil(Math.abs(path.sweep) / ARC_STEP / 2));
    pts = Array.from({ length: steps + 1 }, (_, i) => {
      const a = rad(path.start + (path.sweep * i) / steps);
      return { x: path.centre.x + path.radius * Math.cos(a), y: path.centre.y + path.radius * Math.sin(a) };
    });
    // and its apex
    corners = [steps / 2];
  } else return null;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return length > 0 ? { id, pts, length, corners } : null;
}

export function frameSize(choice: string, view: View3D): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(choice);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  // the screen's, kept even for the video codecs
  const el = view.domElement;
  return { width: even(el.clientWidth || 1280), height: even(el.clientHeight || 720) };
}

function orbitOf(view: View3D, v: PrefValues, selected: { min: Vec3; max: Vec3 } | null, angle: number, aspect: number): { path: CameraPath; half: number; duration: number } | string {
  const about = v.choice("about");
  let centre: Vec3;
  const layerZ = activeLayerElevation();
  if (about === "selection") {
    if (!selected) return "Select the objects to orbit, or rotate about the active layer plane or the working plane.";
    centre = selected.min.map((lo, i) => (lo + selected.max[i]) / 2) as unknown as Vec3;
  } else if (about === "plane") centre = activePlane()?.origin ?? [0, 0, layerZ];
  else centre = [0, 0, layerZ];
  const el = view.domElement;
  const [w, h] = [el.clientWidth || 1280, el.clientHeight || 720];
  const start = view.cameraState();
  let eye = start.position;
  // looking straight down on the centre there is no way round: start from the isometric view instead
  if (Math.hypot(eye[0] - centre[0], eye[1] - centre[1]) < 1) eye = view.presetState("iso", w, h).position;
  const r = Math.hypot(eye[0] - centre[0], eye[1] - centre[1]);
  if (r < 1) return "The camera stands over the centre, so there is no way round it: turn the 3D view first.";
  const ortho = v.flag("ortho");
  // an orthogonal orbit keeps one scale: the largest that frames the model from any side
  let half = start.half;
  if (ortho) {
    const rise = eye[2] - centre[2];
    half = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      half = Math.max(half, view.framedState([r * Math.cos(a), r * Math.sin(a), rise], Math.round(h * aspect), h).half);
    }
  }
  return { path: orbitPath(v3(centre), v3(eye), v.num("angle"), angle, ortho ? "orbit" : "fly"), half, duration: TURN_DURATION };
}

function spinOf(view: View3D, box: { min: Vec3; max: Vec3 }, angle: number, aspect: number): { path: CameraPath; half: number; duration: number } {
  const centre = box.min.map((lo, i) => (lo + box.max[i]) / 2) as unknown as Vec3;
  const radius = Math.max(Math.hypot(...sub(box.max, box.min)) / 2, 1);
  const start = view.cameraState();
  // far enough off that the selection's sphere fits the narrower way across the picture
  const halfV = rad(start.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const distance = (radius / Math.sin(Math.min(halfV, halfH))) * SPIN_MARGIN;
  const off = sub(start.position, centre);
  const flat = Math.hypot(off[0], off[1]);
  const from = flat > 1e-6 ? Math.atan2(off[1], off[0]) : -Math.PI / 2;
  // from the view's height above it (between 15° and 60°), down to as far below and back
  const rise = Math.min(rad(60), Math.max(rad(15), Math.atan2(off[2], flat)));
  return { path: spinPath(v3(centre), distance, deg(from), deg(rise), angle), half: start.half, duration: TURN_DURATION };
}

function activeLayerElevation(): number {
  const s = store.session;
  const layer = s?.doc.layers().find((l) => l.id === store.activeLayerId);
  return layer?.elevation ?? 0;
}

/** Create Movie: animation path `id`'s movie, with Vectorworks' settings, kept with the path for next time. */
export async function createMovie(id: string): Promise<void> {
  const first = movieSource(id);
  if (!first) return;
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is no movie to make.");
    return;
  }
  const k = first.settings;
  const modes = RENDER_MODES.filter(([m]) => !isRealisticMode(m));
  const fields: PrefField[] = [
    { kind: "heading", key: "settings", label: "Settings" },
    { kind: "number", key: "duration", label: "Duration (in seconds)", value: first.duration, min: 1, max: 3600 },
    { kind: "choice", key: "fps", label: "Frames per second", value: String(k.fps), options: FPS.map((n) => ({ value: String(n), label: String(n) })) },
    { kind: "choice", key: "mode", label: "Rendering", value: modes.some(([m]) => m === k.mode) ? k.mode : "shaded", options: modes.map(([value, label]) => ({ value, label })) },
    { kind: "choice", key: "quality", label: "Quality", value: k.quality, options: QUALITIES.map(({ value, label }) => ({ value, label })) },
    { kind: "heading", key: "range-heading", label: "Time Range" },
    {
      kind: "choice",
      key: "range",
      label: "Time Range",
      value: k.range,
      options: [
        { value: "full", label: "Full Duration" },
        { value: "limited", label: "Limited Duration" },
      ],
    },
    { kind: "number", key: "start", label: "Start Time (seconds)", value: k.start, min: 0, max: 3600 },
    { kind: "number", key: "end", label: "End Time (seconds)", value: k.end > 0 ? k.end : first.duration, min: 0, max: 3600 },
    { kind: "heading", key: "size-heading", label: "Frame Size" },
    { kind: "choice", key: "size", label: "Frame Size", value: k.size, options: [...SIZES.map(({ value, label }) => ({ value, label })), { value: "custom", label: "Custom" }] },
    { kind: "number", key: "width", label: "Custom Width (pixels)", value: k.width, min: MIN_FRAME, max: MAX_FRAME, integer: true },
    { kind: "number", key: "height", label: "Custom Height (pixels)", value: k.height, min: MIN_FRAME, max: MAX_FRAME, integer: true },
  ];
  const v = await toolPrefs("Create Movie", fields, "Set the class and layer visibilities the movie should show before making it.");
  if (!v) return;
  const duration = v.num("duration");
  const limited = v.choice("range") === "limited";
  const [from, to] = limited ? [v.num("start"), v.num("end")] : [0, duration];
  if (limited && !(from >= 0 && to > from && to <= duration)) {
    toast(`Enter a Start Time before the End Time, both between 0 and the Duration (${duration} s).`, "info");
    return;
  }
  const fps = FPS.find((n) => String(n) === v.choice("fps")) ?? 30;
  const quality = QUALITIES.find((q) => q.value === v.choice("quality")) ?? QUALITIES[2];
  const mode = (modes.find(([m]) => m === v.choice("mode"))?.[0] ?? "shaded") as RenderMode;
  const sizeChoice = v.choice("size");
  const settings: MovieSettings = {
    fps,
    mode,
    quality: quality.value,
    size: sizeChoice,
    width: v.num("width"),
    height: v.num("height"),
    range: limited ? "limited" : "full",
    start: from,
    end: to,
  };
  keepMovieSettings(id, duration, settings);
  const src = movieSource(id);
  if (!src) return;
  const size = sizeChoice === "custom" ? { width: even(settings.width), height: even(settings.height) } : frameSize(sizeChoice, view);
  const across = size.width / size.height;
  const [a, b] = [from / duration, to / duration];
  const movie: Movie = {
    path: (t) => {
      const c = src.camera(a + (b - a) * t);
      // the camera's View Angle is across the picture; the 3D view takes the angle up it
      return { eye: [c.eye.x, c.eye.y, c.eye.z], target: [c.target.x, c.target.y, c.target.z], fov: 2 * deg(Math.atan(Math.tan(rad(c.angle / 2)) / across)) };
    },
    loops: !limited && src.loops,
    projection: src.orthographic ? "orthogonal" : "perspective",
    half: src.half,
    fov: view.cameraState().fov,
  };
  await record(view, movie, { duration: to - from, fps, mode, bits: quality.bits, size, name: src.name });
}

export interface Recording {
  readonly duration: number;
  readonly fps: number;
  readonly mode: RenderMode;
  readonly bits: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly name: string;
  /** the progress window's title, Create Movie unless given */
  readonly title?: string;
}

/** Records `movie`: each frame drawn by the 3D view, the recorder running only while a frame is shown, so a slow frame doesn't slow the movie. */
export async function record(view: View3D, movie: Movie, r: Recording): Promise<void> {
  const type = typeof MediaRecorder === "undefined" ? undefined : MOVIE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) {
    toast("This browser can't record movies.");
    return;
  }
  const { width, height } = r.size;
  const frames = Math.max(2, Math.round(r.duration * r.fps));
  const last = movie.loops ? frames : frames - 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track) {
    toast("This browser can't record movies.");
    return;
  }
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.min(MAX_BITRATE, Math.round(width * height * r.fps * r.bits)) });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  let cancelled = false;
  const box = showProgress({
    title: r.title ?? "Create Movie",
    finishable: false,
    onFinish: () => {},
    onCancel: () => {
      cancelled = true;
    },
  });
  const look: PaneLook = { mode: r.mode, projection: movie.projection };
  const frameMs = 1000 / r.fps;
  /** how long the recorder has run, ms: each frame's wait makes up what the last one overran */
  let recorded = 0;
  try {
    box.label("Preparing…");
    box.bar(null);
    await view.ensureTextures();
    recorder.start();
    recorder.pause();
    for (let i = 0; i < frames; i++) {
      if (cancelled) break;
      const { eye, target, fov } = movie.path(i / last);
      await movie.frame?.(i, frames);
      if (cancelled) break;
      const state: CameraState = { position: eye, target, zoom: 1, half: movie.half, fov: fov ?? movie.fov };
      view.picture(state, canvas, look, r.size);
      recorder.resume();
      const shown = performance.now();
      track.requestFrame();
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, (i + 1) * frameMs - recorded)));
      recorder.pause();
      recorded += performance.now() - shown;
      box.label(`Frame ${i + 1} of ${frames}`);
      box.bar((i + 1) / frames);
      if (i % THUMB_EVERY === 0) box.picture(canvas);
    }
    recorder.stop();
    await stopped;
    if (cancelled) return;
    const blob = new Blob(chunks, { type: type.split(";")[0] });
    const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
    const name = `${(store.fileName || "Untitled").replace(/\.(vwx|sta)$/i, "")} ${r.name}`;
    downloadBlob(`${name}.${ext}`, blob);
    toast(`Saved ${name}.${ext} (${width} × ${height}, ${frames} frames at ${r.fps} fps).`, "info");
  } catch (err) {
    toast(`${r.title ?? "Create Movie"} failed: ${errorMessage(err)}`);
    reportFailure("movie", err, { width, height, frames, fps: r.fps });
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    track.stop();
    box.close();
  }
}
