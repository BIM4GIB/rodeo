// Model > Create Animation, as Vectorworks has it: Create Orbit Path…, Create Spin Path… and Create
// Walkthrough Path from Selection…, each going on to Create Movie. Vectorworks makes an animation path
// object to edit, play and make movies from; how a drawing saves one isn't known, so Rodeo keeps none:
// each command asks for its path's settings and the movie's together, then records the movie at once,
// the 3D view drawing each frame from the camera's place along the path (the progress window shows
// them as they go). The browser records it: an .mp4 where it can make one, else a .webm.
//
// Orbit: round a centre at the 3D view's eye height and distance from it, looking at it, by the
// rotation angle (counter-clockwise seen from above), in perspective or orthogonal. Spin: once round
// the selection, framed, from above it to below and back again so every side shows. Walkthrough:
// along a selected line, arc, polyline or polygon the way it was drawn, the camera its height above
// the active layer, looking ahead along the path.

import { pathOf } from "../../app/cutting.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { reportFailure } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../../app/toolPrefs.ts";
import type { CameraState, PaneLook, RenderMode, View3D } from "../../app/view3d.ts";
import { RENDER_MODES } from "../../app/viewbar.ts";
import { activePlane } from "../../app/workingPlanes.ts";
import type { Pt, Vec3 } from "../../core/index.ts";
import { showProgress } from "./progress.ts";

export type AnimationKind = "orbit" | "spin" | "walkthrough";

/** the camera's eye and the point it looks at, for a moment along the path from 0 to 1 */
type Path = (t: number) => { readonly eye: Vec3; readonly target: Vec3 };

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
/** how far ahead along the path a walkthrough looks, mm (at most a third of the path) */
const LOOK_AHEAD = 2000;
/** a walkthrough's pace for its first duration, mm a second */
const WALKING_PACE = 1400;
/** the spin's frame: this much room round the selection */
const SPIN_MARGIN = 1.15;
/** degrees between points along an arc path */
const ARC_STEP = 5;
/** the progress window's picture every this many frames */
const THUMB_EVERY = 10;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const rad = (deg: number): number => (deg * Math.PI) / 180;

export async function createAnimation(kind: AnimationKind): Promise<void> {
  if (!store.session) return;
  // the walkthrough's path is read before the 3D view takes the window
  const route = kind === "walkthrough" ? selectedRoute() : null;
  if (kind === "walkthrough" && !route) {
    toast("Select one line, arc, polyline or polygon for the walkthrough's camera to follow.", "info");
    return;
  }
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is no movie to make.");
    return;
  }
  const selected = selectionBounds(view);
  if (kind === "spin" && !selected) {
    toast("Select the objects to spin: Create Spin Path turns the camera round what's selected.", "info");
    return;
  }
  const fields: PrefField[] = [];
  if (kind === "orbit") {
    fields.push(
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
    );
  }
  if (kind === "walkthrough") fields.push({ kind: "length", key: "height", label: "Camera Height", value: EYE_HEIGHT, zero: true });
  const firstDuration = route ? Math.min(600, Math.max(5, Math.round(route.length / WALKING_PACE))) : 10;
  const now = ctx?.renderMode();
  fields.push(
    { kind: "number", key: "duration", label: "Duration (in seconds)", value: firstDuration, min: 1, max: 600 },
    { kind: "choice", key: "fps", label: "Frames per second", value: "30", options: FPS.map((n) => ({ value: String(n), label: String(n) })) },
    {
      kind: "choice",
      key: "mode",
      label: "Rendering",
      value: now && !isRealisticMode(now) ? now : "shaded",
      options: RENDER_MODES.filter(([m]) => !isRealisticMode(m)).map(([value, label]) => ({ value, label })),
    },
    { kind: "choice", key: "quality", label: "Quality", value: "high", options: QUALITIES.map(({ value, label }) => ({ value, label })) },
    { kind: "choice", key: "size", label: "Frame Size", value: "1280x720", options: SIZES.map(({ value, label }) => ({ value, label })) },
  );
  const v = await toolPrefs("Create Movie", fields, NOTES[kind]);
  if (!v) return;
  if (kind === "orbit" && v.num("angle") === 0) {
    toast("Enter a rotation angle other than 0.", "info");
    return;
  }
  const size = frameSize(v.choice("size"), view);
  const movie =
    kind === "orbit" ? orbitMovie(view, v, selected, size) : kind === "spin" && selected ? spinMovie(view, selected, size) : route ? walkMovie(view, route, v.num("height")) : null;
  if (typeof movie === "string" || !movie) {
    toast(movie ?? "There is no path to make a movie along.", "info");
    return;
  }
  const mode = (RENDER_MODES.find(([m]) => m === v.choice("mode"))?.[0] ?? "shaded") as RenderMode;
  const fps = FPS.find((n) => String(n) === v.choice("fps")) ?? 30;
  const quality = QUALITIES.find((q) => q.value === v.choice("quality")) ?? QUALITIES[2];
  await record(view, movie, { duration: v.num("duration"), fps, mode, bits: quality.bits, size, name: kind });
}

const NOTES: Record<AnimationKind, string> = {
  orbit:
    "The camera goes round the centre at the 3D view's eye height and distance from it, looking at it, by the rotation angle (counter-clockwise from above). The movie is made now; no animation path is kept in the drawing.",
  spin: "The camera goes once round the selection, framing it, from above to below and back so every side shows. The movie is made now; no animation path is kept in the drawing.",
  walkthrough:
    "The camera follows the selected path the way it was drawn, its height above the active layer, looking ahead along it. The path stays as it is, and no animation path is kept in the drawing.",
};

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

/** A walkthrough's route: points along the selected path, the way it was drawn, and its length. */
interface Route {
  readonly pts: readonly Pt[];
  readonly closed: boolean;
  readonly length: number;
}

function selectedRoute(): Route | null {
  const s = store.session;
  const [id] = store.selection;
  if (!s || store.selection.size !== 1 || id === undefined) return null;
  const o = s.doc.object(id);
  const path = o?.shape ? pathOf(o.shape) : null;
  if (!path) return null;
  let pts: Pt[];
  if (path.kind === "chain") {
    // a closed chain runs on from its last point back to its first
    pts = path.closed ? [...path.pts, path.pts[0]] : [...path.pts];
  } else if (path.kind === "arc") {
    const steps = Math.max(2, Math.ceil(Math.abs(path.sweep) / ARC_STEP));
    pts = Array.from({ length: steps + 1 }, (_, i) => {
      const a = rad(path.start + (path.sweep * i) / steps);
      return { x: path.centre.x + path.radius * Math.cos(a), y: path.centre.y + path.radius * Math.sin(a) };
    });
  } else return null;
  const closed = path.closed;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return length > 0 ? { pts, closed, length } : null;
}

/** The point `d` along the route (wrapping round a closed one; past an open one's end, on along its last piece). */
function along(route: Route, d: number): Pt {
  const { pts, length } = route;
  let left = route.closed ? ((d % length) + length) % length : d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const piece = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= piece || i === pts.length - 1) {
      const f = piece > 0 ? left / piece : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= piece;
  }
  return pts[pts.length - 1];
}

export function frameSize(choice: string, view: View3D): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(choice);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  // the screen's, kept even for the video codecs
  const el = view.domElement;
  const even = (n: number): number => Math.max(2, 2 * Math.floor(n / 2));
  return { width: even(el.clientWidth || 1280), height: even(el.clientHeight || 720) };
}

function orbitMovie(view: View3D, v: PrefValues, selected: { min: Vec3; max: Vec3 } | null, size: { width: number; height: number }): Movie | string {
  const about = v.choice("about");
  let centre: Vec3;
  const layerZ = activeLayerElevation();
  if (about === "selection") {
    if (!selected) return "Select the objects to orbit, or rotate about the active layer plane or the working plane.";
    centre = selected.min.map((lo, i) => (lo + selected.max[i]) / 2) as unknown as Vec3;
  } else if (about === "plane") centre = activePlane()?.origin ?? [0, 0, layerZ];
  else centre = [0, 0, layerZ];
  const start = view.cameraState();
  let eye = start.position;
  // looking straight down on the centre there is no way round: start from the isometric view instead
  if (Math.hypot(eye[0] - centre[0], eye[1] - centre[1]) < 1) eye = view.presetState("iso", size.width, size.height).position;
  const r = Math.hypot(eye[0] - centre[0], eye[1] - centre[1]);
  if (r < 1) return "The camera stands over the centre, so there is no way round it: turn the 3D view first.";
  const a0 = Math.atan2(eye[1] - centre[1], eye[0] - centre[0]);
  const sweep = rad(v.num("angle"));
  const z = eye[2];
  const ortho = v.flag("ortho");
  // an orthogonal orbit keeps one scale: the largest that frames the model from any side
  let half = start.half;
  if (ortho) {
    const rise = z - centre[2];
    half = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      half = Math.max(half, view.framedState([r * Math.cos(a), r * Math.sin(a), rise], size.width, size.height).half);
    }
  }
  return {
    path: (t) => {
      const a = a0 + sweep * t;
      return { eye: [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a), z], target: centre };
    },
    loops: Math.abs(v.num("angle")) % 360 === 0,
    projection: ortho ? "orthogonal" : "perspective",
    half,
    fov: start.fov,
  };
}

function spinMovie(view: View3D, box: { min: Vec3; max: Vec3 }, size: { width: number; height: number }): Movie {
  const centre = box.min.map((lo, i) => (lo + box.max[i]) / 2) as unknown as Vec3;
  const radius = Math.max(Math.hypot(...sub(box.max, box.min)) / 2, 1);
  const start = view.cameraState();
  // far enough off that the selection's sphere fits the narrower way across the picture
  const halfV = rad(start.fov / 2);
  const halfH = Math.atan(Math.tan(halfV) * (size.width / size.height));
  const distance = (radius / Math.sin(Math.min(halfV, halfH))) * SPIN_MARGIN;
  const off = sub(start.position, centre);
  const flat = Math.hypot(off[0], off[1]);
  const a0 = flat > 1e-6 ? Math.atan2(off[1], off[0]) : -Math.PI / 2;
  // from the view's height above it (between 15° and 60°), down to as far below and back
  const e0 = Math.min(rad(60), Math.max(rad(15), Math.atan2(off[2], flat)));
  return {
    path: (t) => {
      const a = a0 + 2 * Math.PI * t;
      const e = e0 * Math.cos(2 * Math.PI * t);
      const eye: Vec3 = [
        centre[0] + distance * Math.cos(e) * Math.cos(a),
        centre[1] + distance * Math.cos(e) * Math.sin(a),
        centre[2] + distance * Math.sin(e),
      ];
      return { eye, target: centre };
    },
    loops: true,
    projection: "perspective",
    half: start.half,
    fov: start.fov,
  };
}

function walkMovie(view: View3D, route: Route, height: number): Movie {
  const z = activeLayerElevation() + height;
  const ahead = Math.min(LOOK_AHEAD, route.length / 3);
  const start = view.cameraState();
  return {
    path: (t) => {
      const d = route.length * t;
      const at = along(route, d);
      const to = along(route, d + ahead);
      return { eye: [at.x, at.y, z], target: [to.x, to.y, z] };
    },
    loops: route.closed,
    projection: "perspective",
    half: start.half,
    fov: start.fov,
  };
}

function activeLayerElevation(): number {
  const s = store.session;
  const layer = s?.doc.layers().find((l) => l.id === store.activeLayerId);
  return layer?.elevation ?? 0;
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
      const { eye, target } = movie.path(i / last);
      await movie.frame?.(i, frames);
      if (cancelled) break;
      const state: CameraState = { position: eye, target, zoom: 1, half: movie.half, fov: movie.fov };
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
