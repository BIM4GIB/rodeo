// Visualization's Render Bitmap, as Vectorworks has it: a marquee round part of the drawing is drawn
// in the Render Bitmap Options' render mode, at their resolution (dots per inch on paper, at the
// active layer's scale) and with an alpha channel if asked, and placed on the active layer as an
// image where the marquee was, selected. In the 3D view the area is drawn from the view's camera and
// the image goes where the same part of the screen is in Top/Plan (Rodeo has no screen plane), which
// is then shown; in Top/Plan the plan drawing is drawn as it shows, the render mode not applying.
// A click without dragging takes the whole window.

import { exportSvg as toSvg } from "../export/svg.ts";
import { canvasBlob, svgToCanvas, svgViewing } from "../export/png.ts";
import { showProgress } from "../features/render/progress.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { appContext } from "./ext.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import type { RenderMode } from "./view3d.ts";
import { RENDER_MODES } from "./viewbar.ts";

const MM_PER_INCH = 25.4;
const MIN_DPI = 10;
const MAX_DPI = 2400;
/** the most pixels a side of the 3D view's whole picture, the area cut from it */
const MAX_FRAME = 8192;
/** the most pixels a side of the bitmap */
const MAX_SIDE = 8000;
/** a path-traced area takes at most this long, seconds, unless stopped sooner */
const TRACE_SECONDS = 60;
/** modes whose pictures are photographs, kept as JPEG without an alpha channel */
const PHOTO: ReadonlySet<RenderMode> = new Set(["shaded", "textured", "realistic", "pathtraced"]);
const JPEG_QUALITY = 0.92;

export interface BitmapSettings {
  mode: RenderMode;
  dpi: number;
  alpha: boolean;
}

/** the options last set, kept for the next time */
const settings: BitmapSettings = { mode: "shaded", dpi: 72, alpha: false };

export const bitmapSettings = (): Readonly<BitmapSettings> => settings;

/** A rectangle in the drawing, mm. */
interface Area {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The Render Bitmap Options dialog: the tool's Preferences. */
export async function renderBitmapOptions(): Promise<void> {
  const v = await toolPrefs(
    "Render Bitmap Options",
    [
      { kind: "choice", key: "mode", label: "Mode", value: settings.mode, options: RENDER_MODES.map(([value, label]) => ({ value, label })) },
      { kind: "number", key: "dpi", label: "Resolution (DPI)", value: settings.dpi, min: MIN_DPI, max: MAX_DPI, integer: true },
      { kind: "check", key: "alpha", label: "Enable Alpha Transparency", value: settings.alpha },
    ],
    "The resolution is in dots per inch on paper, at the active layer's scale. Top/Plan draws the plan as it shows, whatever the mode.",
  );
  if (!v) return;
  settings.mode = v.choice("mode") as RenderMode;
  settings.dpi = v.num("dpi");
  settings.alpha = v.flag("alpha");
}

/** The active layer's scale, 1 for a sheet. */
function layerScale(): number {
  const ctx = appContext();
  const layer = store.activeLayerId ? ctx?.scene.layer(store.activeLayerId) : undefined;
  return layer && layer.scale > 0 ? layer.scale : 1;
}

/** The bitmap's pixels for `area` at `dpi` on paper, and the dpi it takes once kept to MAX_SIDE. */
export function bitmapPixels(area: Area, scale: number, dpi: number): { width: number; height: number; dpi: number } {
  const w = Math.abs(area.x1 - area.x0) / scale / MM_PER_INCH;
  const h = Math.abs(area.y1 - area.y0) / scale / MM_PER_INCH;
  const kept = Math.min(dpi, MAX_SIDE / Math.max(w, h, 1e-9));
  return { width: Math.max(1, Math.round(w * kept)), height: Math.max(1, Math.round(h * kept)), dpi: kept };
}

/** True when a bitmap can go on the active layer now; otherwise says why. */
function ready(): boolean {
  const s = store.session;
  if (!s || !store.activeLayerId) {
    toast("Open a drawing and choose a layer before rendering a bitmap.", "info");
    return false;
  }
  if (!s.canAdd("image")) {
    toast("This drawing has no image to copy settings from yet, so a bitmap can't be added to it.", "info");
    return false;
  }
  return true;
}

/** The picture on the active layer over `area`, selected. */
async function place(canvas: HTMLCanvasElement, area: Area, keepAlpha: boolean, photo: boolean): Promise<void> {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const mime = photo && !keepAlpha ? "image/jpeg" : "image/png";
  const blob = await canvasBlob(canvas, mime, mime === "image/jpeg" ? JPEG_QUALITY : undefined);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const r = attempt("Render Bitmap", (s) =>
    s.addObject(
      layerId,
      {
        kind: "image",
        x0: Math.min(area.x0, area.x1),
        y0: Math.min(area.y0, area.y1),
        x1: Math.max(area.x0, area.x1),
        y1: Math.max(area.y0, area.y1),
        bytes,
        mime,
        width: canvas.width,
        height: canvas.height,
      },
      store.activeClassIndex,
    ),
  );
  if (r) setEditGroup(null, [r.value]);
}

/** Top/Plan: the visible layers' drawing over `area`. */
export async function renderPlanArea(area: Area): Promise<void> {
  const ctx = appContext();
  const session = store.session;
  if (!ctx || !session || !ready()) return;
  try {
    const layerIds = ctx.scene.drawnLayers(store.activeLayerId).map((l) => l.id);
    const px = bitmapPixels(area, layerScale(), settings.dpi);
    const svg = svgViewing(toSvg(withoutHidden(session.doc), layerIds), {
      x0: Math.min(area.x0, area.x1),
      y0: Math.min(area.y0, area.y1),
      x1: Math.max(area.x0, area.x1),
      y1: Math.max(area.y0, area.y1),
    });
    const canvas = await svgToCanvas(svg, px.width, px.height, settings.alpha ? "" : "#ffffff");
    await place(canvas, area, settings.alpha, false);
    if (px.dpi < settings.dpi - 0.5) toast(`Rendered at ${Math.floor(px.dpi)} dpi, the most ${MAX_SIDE} pixels a side allows.`, "info");
  } catch (err) {
    toast(`Render Bitmap failed: ${errorMessage(err)}`);
  }
}

/**
 * The 3D view: the part of it from `box` (CSS pixels across the view, `width` by `height`) drawn in
 * the options' mode, placed where the same part of the screen is in Top/Plan, which is then shown.
 */
export async function renderViewArea(box: { left: number; top: number; right: number; bottom: number }, width: number, height: number): Promise<void> {
  const ctx = appContext();
  const view = ctx?.view3d();
  if (!ctx || !view || !ready()) return;
  const plan = ctx.view;
  // where the box is in the drawing, as Top/Plan shows the same part of the screen
  const sx = plan.width / width;
  const sy = plan.height / height;
  const a = plan.toWorld(box.left * sx, box.bottom * sy);
  const b = plan.toWorld(box.right * sx, box.top * sy);
  const area: Area = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  const px = bitmapPixels(area, layerScale(), settings.dpi);
  // the whole view drawn at the size that gives the box those pixels, kept to MAX_FRAME a side
  let k = Math.max(px.width / Math.max(1, box.right - box.left), px.height / Math.max(1, box.bottom - box.top));
  k = Math.min(k, MAX_FRAME / Math.max(width, height));
  const frame = { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
  const cut = {
    x: Math.round(box.left * k),
    y: Math.round(box.top * k),
    w: Math.max(1, Math.round((box.right - box.left) * k)),
    h: Math.max(1, Math.round((box.bottom - box.top) * k)),
  };
  const mode = settings.mode;
  const look = { mode, projection: store.viz3d.projection };
  const state = view.cameraState();
  // Finish now keeps a path-traced picture so far; Cancel drops it
  let stopped = false;
  let cancelled = false;
  const progress = showProgress({
    title: "Render Bitmap",
    finishable: mode === "pathtraced",
    onFinish: () => (stopped = true),
    onCancel: () => (cancelled = stopped = true),
  });
  progress.label("Preparing…");
  progress.bar(null);
  try {
    await view.ensureTextures();
    /** The view's picture on `clear` (or its own background), refined until done for Path Traced. */
    const draw = async (clear?: number): Promise<HTMLCanvasElement> => {
      const canvas = document.createElement("canvas");
      const started = performance.now();
      let passes = 0;
      while (view.picture(state, canvas, look, frame, clear)) {
        passes++;
        const seconds = (performance.now() - started) / 1000;
        progress.label(`Rendering · pass ${passes}`);
        progress.bar(Math.min(1, seconds / TRACE_SECONDS));
        if (passes % 8 === 0) progress.picture(canvas);
        if (stopped || seconds > TRACE_SECONDS) break;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      return canvas;
    };
    progress.label("Rendering…");
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const keepAlpha = settings.alpha;
    const onBlack = await draw(keepAlpha ? 0x000000 : undefined);
    if (cancelled) return;
    const out = document.createElement("canvas");
    out.width = cut.w;
    out.height = cut.h;
    const g = out.getContext("2d");
    if (!g) throw new Error("this browser can't draw the bitmap");
    g.drawImage(onBlack, cut.x, cut.y, cut.w, cut.h, 0, 0, cut.w, cut.h);
    if (keepAlpha) {
      // the same picture on white: where they differ is how much of the background shows
      stopped = false;
      const onWhite = await draw(0xffffff);
      if (cancelled) return;
      const w = document.createElement("canvas");
      w.width = cut.w;
      w.height = cut.h;
      w.getContext("2d")?.drawImage(onWhite, cut.x, cut.y, cut.w, cut.h, 0, 0, cut.w, cut.h);
      const black = g.getImageData(0, 0, cut.w, cut.h);
      const white = w.getContext("2d")?.getImageData(0, 0, cut.w, cut.h);
      if (white) g.putImageData(unmixed(black, white), 0, 0);
    }
    await place(out, area, keepAlpha, PHOTO.has(mode));
    ctx.show2d();
    toast(px.dpi < settings.dpi - 0.5 ? `Rendered at ${Math.floor(px.dpi)} dpi, the most ${MAX_SIDE} pixels a side allows; it's placed in Top/Plan.` : "The bitmap is placed in Top/Plan, where the area was on screen.", "info");
  } catch (err) {
    toast(`Render Bitmap failed: ${errorMessage(err)}`);
  } finally {
    progress.close();
  }
}

/** A picture's colours and alpha from it drawn on black and on white. */
export function unmixed(black: ImageData, white: ImageData): ImageData {
  const out = new ImageData(black.width, black.height);
  const b = black.data;
  const w = white.data;
  const o = out.data;
  for (let i = 0; i < b.length; i += 4) {
    // a pixel shows a part `1 - alpha` of the background: white less black is that part of 255
    const shown = (w[i] - b[i] + w[i + 1] - b[i + 1] + w[i + 2] - b[i + 2]) / 3;
    const alpha = Math.max(0, Math.min(255, 255 - shown));
    o[i + 3] = Math.round(alpha);
    if (alpha < 1) continue;
    for (let c = 0; c < 3; c++) o[i + c] = Math.max(0, Math.min(255, Math.round((b[i + c] * 255) / alpha)));
  }
  return out;
}
