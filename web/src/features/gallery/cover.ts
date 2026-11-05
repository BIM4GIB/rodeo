// A gallery entry's cover, 1200 × 630 (the size link previews use): the 2D drawing on paper, or
// the 3D view as it is on screen, cropped to fill. Under 1 MB: PNG when it fits, else JPEG.

import { appContext } from "../../app/ext.ts";
import { thumbnailPng } from "../../app/pngExport.ts";
import { store } from "../../app/state.ts";
import { COVER, MAX_COVER_BYTES } from "./rules.ts";

/** Where the cover's picture is taken from: the drawing, or the 3D view as it is on screen. */
export type CoverSource = "drawing" | "view3d";

/** The paper colour of tokens.css, behind a drawing that does not fill its frame. */
const PAPER = "#fcfcfb";

/** The drawing is drawn afresh at this size (inside the frame, with a margin), up to SNAPSHOT_ABOVE bytes. */
const DRAWN = { width: 1120, height: 550 } as const;

/** Above this many bytes a drawing's cover is a snapshot of the 2D view, not drawn afresh (as the cloud thumbnail is). */
const SNAPSHOT_ABOVE = 20 * 1024 * 1024;

/** The JPEG qualities tried, in order, when the PNG is over the size limit. */
const JPEG_QUALITIES = [0.85, 0.7] as const;

/** Whether the 3D view is showing, so it can be the cover. */
export function canCapture3d(): boolean {
  return store.view3d && appContext()?.view3d() != null;
}

/** The cover from `source`; null when there is nothing to draw. `drawingBytes` (the drawing's size) picks a snapshot for a big one. */
export async function captureCover(source: CoverSource, drawingBytes: number): Promise<Blob | null> {
  try {
    // the 3D view is read before any wait: its canvas keeps no picture between frames
    const frameCanvas = source === "view3d" ? await view3dFrame() : await drawingFrame(drawingBytes);
    return frameCanvas ? await encode(frameCanvas) : null;
  } catch (err) {
    console.warn("openvwx: no gallery cover", err);
    return null;
  }
}

/** The 3D view as it is now, cropped to fill the cover. */
async function view3dFrame(): Promise<HTMLCanvasElement | null> {
  const view = appContext()?.view3d();
  if (!view) return null;
  // drawn once more and read in this same task, as the feedback screenshot does
  view.renderNow();
  const picture = await loadImage(view.domElement.toDataURL("image/png"));
  return frame(picture, picture.naturalWidth, picture.naturalHeight, true);
}

/** The open drawing: drawn afresh on paper, fitted and centred; a big one is the 2D view as it is, cropped to fill. */
async function drawingFrame(bytes: number): Promise<HTMLCanvasElement | null> {
  const ctx = appContext();
  if (!ctx) return null;
  if (bytes > SNAPSHOT_ABOVE) {
    if (ctx.canvas.width === 0 || ctx.canvas.height === 0) return null;
    return frame(ctx.canvas, ctx.canvas.width, ctx.canvas.height, true);
  }
  const png = await thumbnailPng(ctx.scene, DRAWN.width, DRAWN.height);
  if (!png) return null;
  const picture = await createImageBitmap(png);
  const out = frame(picture, picture.width, picture.height, false);
  picture.close();
  return out;
}

/** A 1200 × 630 canvas on paper with `picture` drawn over it: cropped to fill it, or fitted and centred. */
function frame(picture: CanvasImageSource, width: number, height: number, fill: boolean): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = COVER.width;
  out.height = COVER.height;
  const g = out.getContext("2d");
  if (!g) throw new Error("the browser has no 2D canvas");
  g.fillStyle = PAPER;
  g.fillRect(0, 0, out.width, out.height);
  // a fitted picture is centred at its own size: it is never enlarged to the frame
  const scale = fill
    ? Math.max(out.width / width, out.height / height)
    : Math.min(1, out.width / width, out.height / height);
  const w = width * scale;
  const h = height * scale;
  g.drawImage(picture, (out.width - w) / 2, (out.height - h) / 2, w, h);
  return out;
}

/** The frame as a PNG when that is under the size limit, else a JPEG at the first quality that is; null when none is. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const png = await toBlob(canvas, "image/png");
  if (png && png.size <= MAX_COVER_BYTES) return png;
  for (const quality of JPEG_QUALITIES) {
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg && jpeg.size <= MAX_COVER_BYTES) return jpeg;
  }
  return null;
}

/** A canvas's picture as a Blob (null when the browser can't make one). */
function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A picture from a data address, once it has loaded. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("the 3D view's picture did not load"));
    img.src = url;
  });
}
