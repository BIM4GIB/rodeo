// File > Export > Export Panorama…: a 360° picture from the 3D view's eye. Six square pictures round
// it, a cube of them 90° across each (Shaded by the view itself, Realistic and Path Traced by the
// render engines), are unrolled into one picture twice as wide as it is high: the way round across
// it, the view's heading in the middle, straight up along its top and straight down along its foot.
// It is saved as a .jpg, or as an .html page with the picture inside it to look around in (drag,
// wheel or pinch to zoom), which opens from a folder in any browser. This file loads with the
// renderers, not the editor.

import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { reportFailure } from "../../app/reports.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { toolPrefs } from "../../app/toolPrefs.ts";
import type { Vec3 } from "../../core/index.ts";
import type { Shot } from "./camera.ts";
import { showProgress } from "./progress.ts";
import { prepareLibrary } from "./library.ts";
import { buildScene, type RenderScene } from "./sceneBuilder.ts";
import { renderSettings, type RenderSettings } from "./settings.ts";
import { renderStill, yieldTask, type Engine, type Job } from "./still.ts";

type Mode = "shaded" | Engine;
type Save = "html" | "jpg";

/** A side of the cube: where it looks and its picture's up and right (world, z up). */
export interface Face {
  readonly dir: Vec3;
  readonly up: Vec3;
  readonly right: Vec3;
}

/**
 * The cube's sides. Straight up and down are as a camera kept upright (three's lookAt, up the z axis)
 * aims there a hair towards +y: +x to the picture's right, so the render engines' cameras match them.
 */
export const FACES: readonly Face[] = [
  { dir: [1, 0, 0], up: [0, 0, 1], right: [0, -1, 0] },
  { dir: [-1, 0, 0], up: [0, 0, 1], right: [0, 1, 0] },
  { dir: [0, 1, 0], up: [0, 0, 1], right: [1, 0, 0] },
  { dir: [0, -1, 0], up: [0, 0, 1], right: [-1, 0, 0] },
  { dir: [0, 0, 1], up: [0, -1, 0], right: [1, 0, 0] },
  { dir: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0] },
];

/** the panorama's widths (twice its height), each cube side a quarter of it */
const WIDTHS = [2048, 4096, 8192] as const;
const SAMPLES = [64, 256, 1024] as const;
const JPEG_QUALITY = 0.9;
/** how far up or down a straight-up or straight-down side leans towards +y (radians), to fix its turn */
const LEAN = 1e-4;
/** rows unrolled between yields, so the progress window stays live */
const ROWS_PER_SLICE = 64;

export async function exportPanoramaDialog(): Promise<void> {
  const v = await toolPrefs(
    "Export Panorama",
    [
      {
        kind: "choice",
        key: "mode",
        label: "Render Mode",
        value: "realistic",
        options: [
          { value: "shaded", label: "Shaded" },
          { value: "realistic", label: "Realistic" },
          { value: "pathtraced", label: "Path Traced" },
        ],
      },
      { kind: "choice", key: "width", label: "Resolution", value: "4096", options: WIDTHS.map((w) => ({ value: String(w), label: `${w} × ${w / 2}` })) },
      { kind: "choice", key: "samples", label: "Path Traced samples", value: "256", options: SAMPLES.map((n) => ({ value: String(n), label: String(n) })) },
      {
        kind: "choice",
        key: "save",
        label: "Save as",
        value: "html",
        options: [
          { value: "html", label: "Viewer page (.html)" },
          { value: "jpg", label: "Panorama image (.jpg)" },
        ],
      },
    ],
    "A 360° view from the 3D view's eye, its heading in the middle, with the Render palette's settings. The page shows it to look around in (drag, wheel or pinch to zoom), the picture inside it.",
  );
  if (!v) return;
  const mode = (["shaded", "realistic", "pathtraced"] as const).find((m) => m === v.choice("mode")) ?? "realistic";
  const width = WIDTHS.find((w) => String(w) === v.choice("width")) ?? 4096;
  const samples = SAMPLES.find((n) => String(n) === v.choice("samples")) ?? 256;
  const save: Save = v.choice("save") === "jpg" ? "jpg" : "html";
  await exportPanorama(mode, width, samples, save);
}

async function exportPanorama(mode: Mode, width: number, samples: number, save: Save): Promise<void> {
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is no panorama to make.");
    return;
  }
  const job: Job = { cancelled: false, finishNow: false };
  const box = showProgress({
    title: "Export Panorama",
    finishable: false,
    onFinish: () => {},
    onCancel: () => {
      job.cancelled = true;
    },
  });
  const size = width / 4;
  const cam = view.activeCamera;
  const eye: Vec3 = [cam.position.x, cam.position.y, cam.position.z];
  const look = view.orbitTarget.clone().sub(cam.position);
  // the heading the panorama is centred on; straight down (Top) faces north
  const heading = Math.hypot(look.x, look.y) > 1e-9 * look.length() ? Math.atan2(look.y, look.x) : Math.PI / 2;
  let scene: RenderScene | null = null;
  try {
    box.label("Preparing…");
    box.bar(null);
    await view.ensureTextures();
    if (job.cancelled) return;
    const faces: ImageData[] = [];
    if (mode === "shaded") {
      for (const c of view.cubePictures(eye, FACES, size)) faces.push(pixels(c));
    } else {
      const settings = panoramaSettings(samples);
      await prepareLibrary(settings);
      if (job.cancelled) return;
      scene = buildScene({ faces: view.modelFaces(), content: view.visibleContent(), lights: view.visibleLights() }, settings, store.viz3d);
      const plan = { width: size, height: size, engine: mode, samples, minutes: 0, format: "png" as const };
      for (const [i, f] of FACES.entries()) {
        const still = await renderStill(scene, faceShot(eye, f), plan, settings, job, box, { prefix: `Side ${i + 1} of 6 · `, laterShots: FACES.length - i - 1 });
        if (!still || job.cancelled) return;
        const bitmap = await createImageBitmap(still.blob);
        faces.push(pixels(bitmap));
        bitmap.close();
      }
    }
    if (faces.length !== FACES.length) throw new Error("the 3D view could not draw the pictures.");
    box.label("Unrolling the panorama…");
    const pano = new ImageData(width, width / 2);
    for (let row = 0; row < pano.height; row += ROWS_PER_SLICE) {
      if (job.cancelled) return;
      unroll(faces, size, pano, heading, row, Math.min(pano.height, row + ROWS_PER_SLICE));
      box.bar(Math.min(1, (row + ROWS_PER_SLICE) / pano.height));
      await yieldTask();
    }
    const canvas = document.createElement("canvas");
    canvas.width = pano.width;
    canvas.height = pano.height;
    canvas.getContext("2d")?.putImageData(pano, 0, 0);
    box.picture(canvas);
    box.label("Encoding the picture…");
    box.bar(null);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!jpeg) throw new Error("the browser could not encode the picture.");
    if (job.cancelled) return;
    const name = `${(store.fileName || "Untitled").replace(/\.(vwx|sta)$/i, "")} panorama`;
    if (save === "jpg") downloadBlob(`${name}.jpg`, jpeg);
    else downloadBlob(`${name}.html`, new Blob([viewerPage(name, await dataUrl(jpeg))], { type: "text/html" }));
    toast(`Exported ${name}.${save} (${width} × ${width / 2}).`, "info");
  } catch (err) {
    toast(`Export Panorama failed: ${errorMessage(err)}`);
    reportFailure("panorama", err, { width });
  } finally {
    scene?.dispose();
    box.close();
  }
}

/** The Render palette's settings for the cube's sides: the lens kept plain (no blur, no two-point shift) and no vignette, so the sides meet. */
function panoramaSettings(samples: number): RenderSettings {
  const base = renderSettings();
  return {
    ...base,
    camera: { ...base.camera, twoPoint: false, dof: false },
    effects: { ...base.effects, vignette: 0 },
    quality: { ...base.quality, previewSamples: samples },
  };
}

/** A side's shot from `eye`: straight up and down lean a hair towards +y, so the camera's turn is the one FACES gives. */
function faceShot(eye: Vec3, f: Face): Shot {
  const d = 1000;
  const lean = f.dir[2] !== 0 ? LEAN * d : 0;
  return {
    name: "Panorama",
    perspective: true,
    eye,
    target: [eye[0] + f.dir[0] * d, eye[1] + f.dir[1] * d + lean, eye[2] + f.dir[2] * d],
    fov: 90,
    halfHeight: d,
  };
}

function pixels(source: HTMLCanvasElement | ImageBitmap): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("the browser could not read the pictures.");
  g.drawImage(source, 0, 0);
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Fills rows `from` to `to` of `out` (an equirectangular picture, twice as wide as high) from the
 * cube's sides (`faces`, in FACES' order, `size` px square): across, the way round from behind on
 * the left to behind on the right with `heading` (radians from +x, world z up) in the middle;
 * down, from straight up to straight down. Each pixel is the side it looks through, sampled between
 * its four nearest pixels.
 */
export function unroll(faces: readonly ImageData[], size: number, out: ImageData, heading: number, from = 0, to = out.height): void {
  const w = out.width;
  const h = out.height;
  const o = out.data;
  for (let y = from; y < to; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat);
    const dz = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      // turning right is clockwise seen from above
      const t = heading - ((x + 0.5) / w - 0.5) * 2 * Math.PI;
      const d: Vec3 = [cl * Math.cos(t), cl * Math.sin(t), dz];
      const ax = Math.abs(d[0]);
      const ay = Math.abs(d[1]);
      const az = Math.abs(d[2]);
      const i = ax >= ay && ax >= az ? (d[0] > 0 ? 0 : 1) : ay >= az ? (d[1] > 0 ? 2 : 3) : d[2] > 0 ? 4 : 5;
      const f = FACES[i];
      const along = dot(d, f.dir);
      const px = ((dot(d, f.right) / along + 1) / 2) * size - 0.5;
      const py = ((1 - dot(d, f.up) / along) / 2) * size - 0.5;
      sample(faces[i], size, px, py, o, (y * w + x) * 4);
    }
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The colour at (`px`, `py`) of a `size` px square picture, between its four nearest pixels, into `o` at `at`. */
function sample(img: ImageData, size: number, px: number, py: number, o: Uint8ClampedArray, at: number): void {
  const x = Math.min(size - 1, Math.max(0, px));
  const y = Math.min(size - 1, Math.max(0, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const s = img.data;
  const a = (y0 * size + x0) * 4;
  const b = (y0 * size + x1) * 4;
  const c = (y1 * size + x0) * 4;
  const e = (y1 * size + x1) * 4;
  for (let k = 0; k < 3; k++) {
    const top = s[a + k] + (s[b + k] - s[a + k]) * fx;
    const bottom = s[c + k] + (s[e + k] - s[c + k]) * fx;
    o[at + k] = top + (bottom - top) * fy;
  }
  o[at + 3] = 255;
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("the picture could not be read."));
    reader.readAsDataURL(blob);
  });
}

/**
 * A page that shows the panorama (`src`, a data URL) to look around in: WebGL draws the part in
 * view, each pixel's ray turned into the way round and up it looks; drag to look, wheel or pinch to
 * zoom, the arrow keys too. Without WebGL (or its shader) it shows the picture flat.
 */
export function viewerPage(title: string, src: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc}</title>
<style>
html, body { margin: 0; height: 100%; background: #111; overflow: hidden; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
canvas.dragging { cursor: grabbing; }
p { position: fixed; left: 12px; bottom: 10px; margin: 0; font: 12px system-ui, sans-serif; color: rgba(255, 255, 255, 0.6); pointer-events: none; }
img { width: 100%; }
</style>
</head>
<body>
<canvas></canvas>
<p>Drag to look around · wheel or pinch to zoom</p>
<script>
const SRC = "${src}";
const canvas = document.querySelector("canvas");
const gl = canvas.getContext("webgl");
const view = { yaw: 0, pitch: 0, fov: 75 };
const flat = () => { document.body.innerHTML = '<img alt="${esc}" src="' + SRC + '">'; };
const program = gl && gl.createProgram();
if (program) {
  const shader = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 q; void main() { q = p; gl_Position = vec4(p, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, [
    "precision highp float;",
    "varying vec2 q; uniform sampler2D pano; uniform float yaw, pitch, spread, aspect;",
    "void main() {",
    "  vec3 r = normalize(vec3(q.x * spread * aspect, q.y * spread, 1.0));",
    "  r = vec3(r.x, r.y * cos(pitch) + r.z * sin(pitch), -r.y * sin(pitch) + r.z * cos(pitch));",
    "  r = vec3(r.x * cos(yaw) + r.z * sin(yaw), r.y, -r.x * sin(yaw) + r.z * cos(yaw));",
    "  float lon = atan(r.x, r.z), lat = asin(clamp(r.y, -1.0, 1.0));",
    "  gl_FragColor = texture2D(pano, vec2(0.5 + lon / 6.2831853, 0.5 - lat / 3.1415927));",
    "}",
  ].join("\\n")));
  gl.linkProgram(program);
}
if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
  flat();
} else {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(program, name);
  let ready = false;
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    if (!ready) return;
    gl.uniform1f(u("yaw"), view.yaw);
    gl.uniform1f(u("pitch"), view.pitch);
    gl.uniform1f(u("spread"), Math.tan((view.fov * Math.PI) / 360));
    gl.uniform1f(u("aspect"), w / Math.max(1, h));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const image = new Image();
  image.onload = () => {
    // a picture wider than the graphics card takes is drawn smaller first
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let source = image;
    if (image.width > max) {
      source = document.createElement("canvas");
      source.width = max;
      source.height = max / 2;
      source.getContext("2d").drawImage(image, 0, 0, max, max / 2);
    }
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
    draw();
  };
  image.src = SRC;
  const limit = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const turn = (dx, dy) => {
    const per = (view.fov * Math.PI) / 180 / Math.max(1, canvas.clientHeight);
    view.yaw -= dx * per;
    view.pitch = limit(view.pitch + dy * per, -1.55, 1.55);
    draw();
  };
  const zoom = (factor) => { view.fov = limit(view.fov * factor, 20, 110); draw(); };
  const pointers = new Map();
  let pinch = 0;
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.classList.add("dragging"); });
  canvas.addEventListener("pointermove", (e) => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) turn(e.clientX - was.x, e.clientY - was.y);
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom(pinch / d);
      pinch = d;
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); pinch = 0; if (pointers.size === 0) canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001)); }, { passive: false });
  window.addEventListener("keydown", (e) => {
    const step = 40;
    if (e.key === "ArrowLeft") turn(step, 0);
    else if (e.key === "ArrowRight") turn(-step, 0);
    else if (e.key === "ArrowUp") turn(0, step);
    else if (e.key === "ArrowDown") turn(0, -step);
    else if (e.key === "+" || e.key === "=") zoom(0.9);
    else if (e.key === "-") zoom(1 / 0.9);
  });
  window.addEventListener("resize", draw);
  window.panorama = view;
}
</script>
</body>
</html>
`;
}
