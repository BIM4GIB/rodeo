// Makes a share link's preview pictures from the drawing in front and uploads them: a still of
// 1200 × 630 (the size Slack, X and LinkedIn show a card at) and, for an embed that starts in 3D, a
// turning GIF of one slow turn. The pictures are drawn from the editor as it is, so the 3D view is
// opened for them and the editor goes back to 2D afterwards. A small rodeo.build mark sits in the
// still's corner.

// view3d.ts is loaded on demand (app.ts imports it dynamically), so this module takes only its types
// from it and never its values: the Share dialog must not pull in three.js.
import { nextTask } from "../../app/dom.ts";
import { type AppContext, appContext, documentSource } from "../../app/ext.ts";
import { thumbnailPng } from "../../app/pngExport.ts";
import { store } from "../../app/state.ts";
import type { CameraState, PaneLook, View3D } from "../../app/view3d.ts";
import type { Vec3 } from "../../core/index.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { embedApi } from "./api.ts";
import type { EmbedOptions } from "./options.ts";
import { spinDirections, towardOf, turntableStates } from "./turntable.ts";

/** The share link whose preview is made, and the cloud drawing it shows. */
export interface PreviewTarget {
  readonly token: string;
  readonly fileId: string;
}

/** A turning picture's size, frame count and the time each frame stays up. */
interface TurnSize {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly delay: number;
}

const NOT_OPEN = "Open this drawing to make its preview.";
const MB = 1048576;
/** The still's size: the card size the big social sites show. */
const STILL = { width: 1200, height: 630 } as const;
/** The first turning picture, and the smaller one tried when the first is too large to keep. */
const TURNING: readonly [TurnSize, TurnSize] = [
  { width: 480, height: 270, frames: 40, delay: 80 },
  { width: 360, height: 202, frames: 30, delay: 100 },
];
/** Above this the first turning picture is made again smaller. */
const RETRY_ABOVE = 3.8 * MB;
/** The largest turning picture the server keeps. */
const MAX_GIF = 4 * MB;
/** The largest JPEG kept at the first quality; a larger one is made again at a lower quality. */
const JPEG_KEEP = 900 * 1024;

/** Whether the drawing in front is this cloud drawing, so its preview can be made from it. */
export function canMakePreview(fileId: string): boolean {
  const s = documentSource();
  return isCloudSource(s) && s.id === fileId && store.session !== null;
}

/**
 * Makes a share link's preview from the drawing as it is on screen and uploads it: a still 1200 × 630
 * (in 3D from the embed's start view when it starts in 3D and the drawing has a model, else the 2D
 * drawing) and, in 3D, a turning GIF. `say` hears each step. Throws with a message to show.
 */
export async function makePreview(target: PreviewTarget, o: EmbedOptions, say: (text: string) => void): Promise<void> {
  const ctx = canMakePreview(target.fileId) ? appContext() : null;
  if (!ctx) throw new Error(NOT_OPEN);
  let threeD: View3D | null = null;
  if (o.view === "3d") {
    say("Building the 3D model…");
    const was = store.view3d;
    threeD = await ctx.show3d();
    // the pictures are drawn while the view is hidden, so the editor goes back to where it was
    if (!was) ctx.show2d();
    // a drawing with no model has nothing to turn, so its preview is the 2D drawing
    if (threeD && threeD.modelFaces().length === 0 && threeD.visibleContent().length === 0) threeD = null;
  }

  if (threeD) {
    // Realistic and Path Traced need the render feature, so the pictures are drawn as Shaded
    const current = ctx.renderMode();
    const mode = o.render ?? (current === "realistic" || current === "pathtraced" ? "shaded" : current);
    const look: PaneLook = { mode, projection: store.viz3d.projection };
    if (mode === "textured") await threeD.ensureTextures();
    say("Making the preview…");
    const canvas = document.createElement("canvas");
    threeD.picture(startState(threeD, o, STILL.width, STILL.height), canvas, look, STILL);
    brand(canvas);
    say("Uploading the preview…");
    await embedApi.putPoster(target.token, await jpeg(canvas), STILL.width, STILL.height);
    await turning(target, o, threeD, look, say);
  } else {
    say("Making the preview…");
    const canvas = await flatPicture(ctx);
    brand(canvas);
    say("Uploading the preview…");
    await embedApi.putPoster(target.token, await jpeg(canvas), STILL.width, STILL.height);
  }
  say("Preview made.");
}

/** Where the camera starts for a picture `width` × `height`: the embed's own camera when it has one, else its standard view framed. */
function startState(view: View3D, o: EmbedOptions, width: number, height: number): CameraState {
  if (o.cam) {
    const framed = view.framedState(towardOf(o.cam.position, o.cam.target), width, height);
    return { ...framed, position: o.cam.position, target: o.cam.target };
  }
  return view.presetState(o.preset ?? "iso", width, height);
}

/**
 * The start camera for a turn of `width` × `height`. Without the embed's own camera the eye stands
 * as far out, and the lens is as wide, as the framing needs on the side that needs most, so the
 * model stays in the frame all the way round.
 */
function spinStart(view: View3D, o: EmbedOptions, width: number, height: number): CameraState {
  const first = startState(view, o, width, height);
  if (o.cam) return first;
  const toward = towardOf(first.position, first.target);
  const sides = spinDirections(toward, 8).map((dir) => view.framedState(dir, width, height));
  const reach = Math.max(...sides.map((s) => Math.hypot(...towardOf(s.position, s.target))));
  const half = Math.max(...sides.map((s) => s.half));
  const along = Math.hypot(...toward);
  // the eye moves out along the first direction, from the same target
  const at = (i: 0 | 1 | 2): number => first.target[i] + (toward[i] / along) * reach;
  const position: Vec3 = [at(0), at(1), at(2)];
  return { ...first, position, half };
}

/** The turning picture: a GIF of one slow turn, uploaded, or left out when it stays too large even when made smaller. */
async function turning(target: PreviewTarget, o: EmbedOptions, view: View3D, look: PaneLook, say: (text: string) => void): Promise<void> {
  let size = TURNING[0];
  let gif = await turningGif(view, o, look, size, say);
  if (gif.size > RETRY_ABOVE) {
    size = TURNING[1];
    gif = await turningGif(view, o, look, size, say);
  }
  if (gif.size > MAX_GIF) {
    say("The turning picture is too large, so only the still was saved.");
    return;
  }
  say("Uploading the turning picture…");
  await embedApi.putTurntable(target.token, gif, size.width, size.height);
}

/** One turn of the view, drawn frame by frame and encoded as a GIF that loops. */
async function turningGif(view: View3D, o: EmbedOptions, look: PaneLook, size: TurnSize, say: (text: string) => void): Promise<Blob> {
  const { width, height, frames, delay } = size;
  const states = turntableStates(spinStart(view, o, width, height), frames);
  // gifenc loads only here, when a GIF is made
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();
  const canvas = document.createElement("canvas");
  // asked for before the first frame, since the picture's own getContext would keep the faster, GPU-backed one
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("the browser cannot read the frames");
  for (let i = 0; i < frames; i++) {
    view.picture(states[i], canvas, look, { width, height });
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
    say(`Making the turning picture… ${i + 1} of ${frames}`);
    // a frame at a time, so the page stays live and the steps show
    await nextTask();
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
}

/** The 2D drawing as a still on white: the drawing fitted in the middle, or the editor's canvas when nothing is visible. */
async function flatPicture(ctx: AppContext): Promise<HTMLCanvasElement> {
  const { width, height } = STILL;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const out = canvas.getContext("2d");
  if (!out) throw new Error("the browser has no 2D canvas");
  out.fillStyle = "#ffffff";
  out.fillRect(0, 0, width, height);
  const png = await thumbnailPng(ctx.scene, width, height);
  if (png) {
    const bitmap = await createImageBitmap(png);
    out.drawImage(bitmap, (width - bitmap.width) / 2, (height - bitmap.height) / 2);
    bitmap.close();
  } else {
    // nothing visible to fit: the editor's own canvas, covering the picture, stands in
    const src = ctx.canvas;
    if (src.width > 0 && src.height > 0) {
      const scale = Math.max(width / src.width, height / src.height);
      const w = src.width * scale;
      const h = src.height * scale;
      out.drawImage(src, (width - w) / 2, (height - h) / 2, w, h);
    }
  }
  return canvas;
}

/** The rodeo.build mark in the bottom-right corner: a solid box with its name, scaled to the picture. */
function brand(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = Math.round(canvas.height / 32);
  ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  const pad = size * 0.6;
  const edge = size * 0.8;
  const boxW = ctx.measureText("rodeo.build").width + pad * 2;
  const boxH = size + pad * 2;
  const x = canvas.width - edge - boxW;
  const y = canvas.height - edge - boxH;
  ctx.fillStyle = "#1d1d1d";
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 6);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText("rodeo.build", x + pad, y + boxH / 2);
}

/** A picture as a JPEG: at the first quality, and again at a lower one when that comes out large. */
async function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const first = await encodeJpeg(canvas, 0.88);
  if (first.size <= JPEG_KEEP) return first;
  return encodeJpeg(canvas, 0.75);
}

/** One JPEG of the canvas at `quality`; the browser refusing to make one is an error to show. */
function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not make the picture"))), "image/jpeg", quality);
  });
}
