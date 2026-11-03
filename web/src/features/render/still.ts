// One still picture of a built scene, as Render Image makes it on this computer and the cloud
// worker (cloudWorker.ts) makes it on a server's GPU: Fast draws it once with the Realistic engine,
// Photoreal samples the path tracer in short slices, yielding on a timer between them so the page
// stays live. No editor windows here: the caller shows progress through StillBox.

import * as THREE from "three";
import type { Shot } from "./camera.ts";
import { renderCamera } from "./camera.ts";
import { HdrWriter } from "./hdr.ts";
import { PathEngine } from "./pathtrace.ts";
import { RasterEngine } from "./raster.ts";
import type { RenderScene } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";

export type Engine = "realistic" | "pathtraced";
/** a picture's file: PNG or JPEG finished, or Radiance HDR linear (Export HDRI) */
export type Format = "png" | "jpeg" | "hdr";

/** What a picture is to be. */
export interface StillPlan {
  readonly width: number;
  readonly height: number;
  readonly engine: Engine;
  /** samples a Photoreal picture takes */
  readonly samples: number;
  /** minutes it may take, 0 for no limit */
  readonly minutes: number;
  readonly format: Format;
}

/** Cancel discards everything; Finish now keeps the picture in hand and stops. */
export interface Job {
  cancelled: boolean;
  finishNow: boolean;
}

/** Where a picture's progress shows. */
export interface StillBox {
  label(text: string): void;
  /** the bar's fill from 0 to 1, or null for a bar that only shows work is under way */
  bar(fraction: number | null): void;
  /** the picture so far */
  picture(source: HTMLCanvasElement): void;
}

/** A picture made. */
export interface Still {
  readonly blob: Blob;
  /** samples taken (Photoreal), or null */
  readonly samples: number | null;
  readonly seconds: number;
}

/** Where a picture stands among the job's, for its progress line. */
export interface StillPlace {
  /** "Shot 1 of 3 · ", or "" */
  readonly prefix: string;
  /** pictures still to come after this one */
  readonly laterShots: number;
}

/** The timing of one picture, for its progress line. */
interface Pace extends StillPlace {
  readonly started: number;
  readonly target: number;
  readonly minutes: number;
}

export const FAST_SAMPLES = 16;
const JPEG_QUALITY = 0.92;
/** the work between two yields of the path tracer, so the window stays live */
const SLICE_MS = 30;
/** how often the progress line moves, and how often the picture so far is finished for it (which costs a large picture more) */
const UPDATE_MS = 250;
const PICTURE_MS = 2000;
/**
 * How the path tracer splits a picture into tiles. macOS resets a GPU kept busy too long (a 3M-triangle
 * model's 4K tiles of 180 and 650 ms were reset now and then, and the reset lost the picture), so
 * slower tiles are split. Each tile also costs a few ms however small (its pass loads and stores the
 * whole picture), so pictures start at `pixels` a tile and stop at MAX_TILES a side.
 */
export interface Tiling {
  /** the GPU time one tile may take */
  readonly ms: number;
  /** the pixels a tile starts with, before one has been timed */
  readonly pixels: number;
}

/** This computer's tiling, for a GPU that also drives the display */
export const LOCAL_TILING: Tiling = { ms: 50, pixels: 100_000 };
const MAX_TILES = 16;

/**
 * Makes one picture of `scene` from `shot`. Null when Cancel stopped it; throws when the picture is
 * larger than this browser can draw, or when the GPU lost it part way.
 */
export async function renderStill(
  scene: RenderScene,
  shot: Shot,
  plan: StillPlan,
  settings: RenderSettings,
  job: Job,
  box: StillBox,
  place: StillPlace,
  tiling: Tiling = LOCAL_TILING,
): Promise<Still | null> {
  const renderer = makeRenderer(plan.width, plan.height);
  // an HDR file takes the linear picture, in floats (the finish leaves a float target linear)
  let linear: THREE.WebGLRenderTarget | null = null;
  // a GPU reset or too little memory takes the context: the engines then draw nothing and say nothing
  let lost = false;
  const onLost = (): void => {
    lost = true;
  };
  renderer.domElement.addEventListener("webglcontextlost", onLost);
  let engine: RasterEngine | PathEngine | null = null;
  try {
    const limit = renderer.capabilities.maxTextureSize;
    if (plan.width > limit || plan.height > limit) {
      throw new Error(`A ${plan.width} × ${plan.height} px picture is larger than this browser can draw (${limit} px a side): choose a smaller size.`);
    }
    if (plan.format === "hdr") {
      if (!renderer.extensions.has("EXT_color_buffer_float")) throw new Error("this browser can't draw a picture in floating point, which an HDR file needs: choose PNG or JPEG");
      linear = new THREE.WebGLRenderTarget(plan.width, plan.height, { type: THREE.FloatType, depthBuffer: false });
    }
    const camera = renderCamera(shot, plan.width / plan.height, settings.camera, null, null);
    const started = performance.now();
    const canvas = renderer.domElement;
    let samples: number | null = null;
    if (plan.engine === "realistic") {
      box.label(`${place.prefix}Rendering…`);
      box.bar(null);
      // a timer, not a frame (frames stop in a hidden tab): the label paints before the blocking call
      await yieldTask();
      if (job.cancelled) return null;
      const raster = new RasterEngine(renderer);
      engine = raster;
      raster.renderStill(scene, camera, settings, FAST_SAMPLES, linear);
    } else {
      const tracer = new PathEngine(renderer);
      engine = tracer;
      tracer.tiles = tilesFor(plan.width * plan.height, tiling);
      box.label(`${place.prefix}Building…`);
      await tracer.setScene(scene, camera, (fraction) => box.bar(fraction));
      if (job.cancelled) return null;
      const pace = { ...place, started, target: plan.samples, minutes: plan.minutes };
      samples = await samplePicture(tracer, canvas, settings, job, box, pace, tiling.ms, () => lost);
      if (job.cancelled) return null;
      if (linear) tracer.show(settings, linear);
    }
    if (linear) {
      box.label(`${place.prefix}Writing the HDR file…`);
      box.bar(null);
      return { blob: readHdr(renderer, linear, lost), samples, seconds: (performance.now() - started) / 1000 };
    }
    const picture = readPicture(renderer, lost);
    box.label(`${place.prefix}Encoding the picture…`);
    box.bar(null);
    const blob = await encode(picture, plan.format === "jpeg" ? "jpeg" : "png");
    return { blob, samples, seconds: (performance.now() - started) / 1000 };
  } finally {
    linear?.dispose();
    renderer.domElement.removeEventListener("webglcontextlost", onLost);
    engine?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/**
 * Takes samples in slices of about SLICE_MS, yielding on a timer between them (frames stop in a hidden
 * tab), until the target, the time limit, Finish now, Cancel or a lost context. Keeps the progress
 * window up to date, finishing the picture only for it and at the end. When two samples running each
 * had a tile slower than `tileMs`, the samples after are split into more tiles, and into fewer when
 * every tile was quick.
 * Resolves with the samples taken.
 */
async function samplePicture(
  tracer: PathEngine,
  canvas: HTMLCanvasElement,
  settings: RenderSettings,
  job: Job,
  box: StillBox,
  pace: Pace,
  tileMs: number,
  lost: () => boolean,
): Promise<number> {
  const limit = pace.minutes > 0 ? pace.minutes * 60_000 : Infinity;
  const sampling = performance.now();
  // on a lost context the tiles cost nothing and the count races to the target: stop at once
  const finished = (): boolean =>
    job.cancelled || job.finishNow || lost() || tracer.samples >= pace.target || performance.now() - pace.started >= limit;
  let shown = -Infinity;
  let pictured = -Infinity;
  // the slowest tile of the sample under way, and of the sample before at the same tiling (0: none)
  let slowest = 0;
  let slowestBefore = 0;
  let sample = Math.floor(tracer.samples);
  // the tile after the picture so far was shown waits for that picture's GPU work too, so it is not timed
  let timed = true;
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS;
    do {
      const before = tracer.samples;
      const start = performance.now();
      tracer.accumulate(settings, null);
      const ms = performance.now() - start;
      // the first tile drawn also uploads the scene to the GPU, and a tile may not be drawn (the shader compiling)
      if (timed && before > 0 && tracer.samples > before) slowest = Math.max(slowest, ms);
      timed = true;
      if (tracer.samples >= sample + 1) {
        // a sample is in: split the next ones when this one and the one before both had a tile over
        // tileMs, by the lesser (one slow sample may be another app's GPU work); merge a step when
        // both were well under, as each tile costs a few ms more
        sample = Math.floor(tracer.samples);
        const n = tracer.tiles;
        const over = Math.min(slowest, slowestBefore);
        const under = Math.max(slowest, slowestBefore);
        if (over > tileMs && n < MAX_TILES) {
          tracer.tiles = Math.min(MAX_TILES, Math.max(n + 1, Math.ceil(n * Math.sqrt(over / tileMs))));
          slowestBefore = 0;
        } else if (slowestBefore > 0 && under < tileMs / 4 && n > 1) {
          tracer.tiles = n - 1;
          slowestBefore = 0;
        } else {
          slowestBefore = slowest;
        }
        slowest = 0;
      }
    } while (!finished() && performance.now() < sliceEnd);
    if (finished()) {
      tracer.show(settings, null);
      return tracer.samples;
    }
    const now = performance.now();
    if (now - pictured >= PICTURE_MS) {
      pictured = now;
      tracer.show(settings, null);
      timed = false;
      box.picture(canvas);
    }
    if (now - shown >= UPDATE_MS) {
      shown = now;
      box.label(progressLine(tracer.samples, pace, now, sampling));
      box.bar(tracer.samples / pace.target);
    }
    await yieldTask();
  }
}

/**
 * "Shot 1 of 3 · 128 of 256 samples · 1 min 5 s · about 1 min left": the time left counts the pictures
 * after this one. A tiled sample counts once all its tiles are in.
 */
function progressLine(taken: number, pace: Pace, now: number, sampling: number): string {
  const elapsed = (now - pace.started) / 1000;
  const line = `${pace.prefix}${Math.floor(taken)} of ${pace.target} samples · ${formatSeconds(elapsed)}`;
  if (taken <= 0) return line;
  let left = ((pace.target - taken) * (now - sampling)) / 1000 / taken;
  if (pace.minutes > 0) left = Math.min(left, pace.minutes * 60 - elapsed);
  left = Math.max(0, left);
  const remaining = left + pace.laterShots * (elapsed + left);
  return `${line} · ${aboutLeft(remaining)}`;
}

/** "2 min", "45 s": how long is left, rounded for the progress line. */
function aboutLeft(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  return s < 60 ? `about ${s} s left` : `about ${Math.round(s / 60)} min left`;
}

/** A WebGL renderer on a canvas of the picture's size. The buffer is kept, since the picture is read back from it. */
function makeRenderer(width: number, height: number): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: document.createElement("canvas"),
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    // after the graphics card has been reset, the browser blocks WebGL for the page until it reloads
    throw new Error("the browser would not start WebGL for the picture, as it does after the graphics card has been reset: reload the page and try again");
  }
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  return renderer;
}

/** The tiles a side a picture starts with: about `tiling.pixels` each, until a tile has been timed. */
function tilesFor(pixels: number, tiling: Tiling): number {
  return Math.min(MAX_TILES, Math.max(1, Math.ceil(Math.sqrt(pixels / tiling.pixels))));
}

/**
 * The finished picture, read into memory. Throws when it was lost: the context went (`lost`, or found
 * lost now), the GPU had stopped doing the page's work (macOS drops a reset GPU's work for some seconds
 * before the browser sees the loss, and a read then gives old memory), or it reads back black, as a lost
 * or restored context's does. Any of these would otherwise save an empty picture.
 */
function readPicture(renderer: THREE.WebGLRenderer, lost: boolean): ImageData {
  const gl = renderer.getContext();
  const { width, height } = renderer.domElement;
  const pixels = new Uint8Array(width * height * 4);
  // a pixel cleared to a new colour before the picture is read: when it reads back so, the GPU did the read too
  const mark = 1 + Math.floor(Math.random() * 254);
  const probe = new Uint8Array(4);
  if (!gl.isContextLost()) {
    renderer.resetState();
    const buffer = gl.createRenderbuffer();
    const frame = gl.createFramebuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, buffer);
    gl.clearColor(mark / 255, 0, 1 - mark / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
    gl.deleteFramebuffer(frame);
    gl.deleteRenderbuffer(buffer);
    renderer.resetState();
  }
  if (lost || gl.isContextLost() || probe[0] !== mark || probe[2] !== 255 - mark) {
    throw new Error("the graphics card stopped part way through (the browser lost its WebGL context), so there is no picture: try a smaller size, fewer samples or Fast");
  }
  let drawn = false;
  for (let i = 0; i < pixels.length && !drawn; i += 4) drawn = pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0;
  if (!drawn) throw new Error("the picture came out black, as if nothing was drawn, so it was not kept");
  // WebGL reads from the bottom row up
  const stride = width * 4;
  const row = new Uint8Array(stride);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    row.set(pixels.subarray(top * stride, (top + 1) * stride));
    pixels.copyWithin(top * stride, bottom * stride, (bottom + 1) * stride);
    pixels.set(row, bottom * stride);
  }
  return new ImageData(new Uint8ClampedArray(pixels.buffer), width, height);
}

/** Rows of a linear picture read off the GPU at a time, for its HDR file. */
const HDR_STRIP = 128;

/**
 * The linear picture in `target` as a Radiance HDR file, read a strip of rows at a time from the top.
 * Throws when the context was lost or the picture reads back black, as readPicture does.
 */
function readHdr(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, lost: boolean): Blob {
  const { width, height } = target;
  const writer = new HdrWriter(width, height);
  const strip = new Float32Array(width * Math.min(HDR_STRIP, height) * 4);
  let drawn = false;
  for (let top = 0; top < height; top += HDR_STRIP) {
    const rows = Math.min(HDR_STRIP, height - top);
    // WebGL counts rows from the bottom
    renderer.readRenderTargetPixels(target, 0, height - top - rows, width, rows, strip);
    if (lost || renderer.getContext().isContextLost()) {
      throw new Error("the graphics card stopped part way through (the browser lost its WebGL context), so there is no picture: try a smaller size, fewer samples or Fast");
    }
    for (let i = 0; i < rows * width * 4 && !drawn; i += 4) drawn = strip[i] > 0 || strip[i + 1] > 0 || strip[i + 2] > 0;
    for (let r = rows - 1; r >= 0; r--) writer.row(strip, r * width * 4);
  }
  if (!drawn) throw new Error("the picture came out black, as if nothing was drawn, so it was not kept");
  return writer.finish();
}

/** Encodes on a canvas kept in memory, so the GPU, which may go at any time, has no part in it. */
function encode(picture: ImageData, format: Exclude<Format, "hdr">): Promise<Blob> {
  const type = format === "jpeg" ? "image/jpeg" : "image/png";
  const canvas = document.createElement("canvas");
  canvas.width = picture.width;
  canvas.height = picture.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return Promise.reject(new Error("the picture could not be encoded"));
  context.putImageData(picture, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("the picture could not be encoded"));
      },
      type,
      format === "jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}

/** A duration as the render windows show it: "42 s", "1 min 5 s", "2 h 3 min". */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${total % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function yieldTask(): Promise<void> {
  // a hidden tab runs timers once a second at most (once a minute after five), which all but stops a
  // render left to run behind another tab; a message isn't held back
  if (document.hidden) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
