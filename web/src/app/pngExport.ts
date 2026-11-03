// File > Export > Export Image File…, as Vectorworks has it: the drawing (the layers Export SVG
// writes), all of it or the part the window shows, drawn at the active layer's scale and a typed
// resolution, saved as PNG, JPEG, TIFF or BMP, in full colour, greyscale or black and white, with
// PNG and TIFF keeping a transparent background when Save Alpha Channel is ticked. The 3D view
// isn't exported here (Render Image… saves it), nor is a marquee's part. The dialog is the shell
// from menubar.ts.

import { exportSvg as toSvg } from "../export/svg.ts";
import { encodeBmp, encodeTiff, recolor, type ImageColor } from "../export/image.ts";
import { canvasBlob, MAX_PNG_SIDE, pngPixelSize, svgPaperMm, svgToCanvas, svgToPng, svgViewing, type PaperSize } from "../export/png.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";
import "./pngExport.css";

type ImageType = "png" | "jpeg" | "tiff" | "bmp";
type Area = "all" | "view";

const TYPES: readonly (readonly [ImageType, string, string])[] = [
  ["png", "PNG", "png"],
  ["jpeg", "JPEG", "jpg"],
  ["tiff", "TIFF", "tif"],
  ["bmp", "BMP", "bmp"],
];

const COLORS: readonly (readonly [ImageColor, string])[] = [
  ["full", "Full color"],
  ["gray", "Grayscale"],
  ["bw", "Black and white"],
];

const QUALITIES: readonly (readonly [number, string])[] = [
  [1, "Maximum"],
  [0.9, "High"],
  [0.75, "Medium"],
  [0.5, "Low"],
];

const MIN_DPI = 10;
const MAX_DPI = 2400;

interface Settings {
  area: Area;
  dpi: number;
  type: ImageType;
  color: ImageColor;
  alpha: boolean;
  quality: number;
}

/** the dialog's last settings, kept for the next time */
let last: Settings = { area: "all", dpi: 150, type: "png", color: "full", alpha: false, quality: 0.9 };

/** File > Export > Export Image File…: downloads the drawing as an image file the dialog sets up. */
export async function exportImageFile(scene: Scene, view: View): Promise<void> {
  const session = store.session;
  if (!session) return;
  try {
    const layerIds = scene.drawnLayers(store.activeLayerId).map((l) => l.id);
    if (layerIds.length === 0) {
      toast("There is no visible layer to export.", "info");
      return;
    }
    const svg = toSvg(withoutHidden(session.doc), layerIds);
    // the SVG is at full size; on paper it is that over the active layer's scale, as Vectorworks
    // sizes image exports
    // world coordinates are millimetres whatever the document's units
    const layer = store.activeLayerId ? scene.layer(store.activeLayerId) : undefined;
    const scale = layer && layer.scale > 0 ? layer.scale : 1;
    const full = svgPaperMm(svg, 1);
    const shown = store.view3d ? null : view.visibleRect();
    const paperOf = (area: Area): PaperSize =>
      area === "view" && shown ? { width: (shown.x1 - shown.x0) / scale, height: (shown.y1 - shown.y0) / scale } : { width: full.width / scale, height: full.height / scale };
    const s = await askSettings(paperOf, scale, shown !== null);
    if (s === null) return;
    const px = pngPixelSize(paperOf(s.area), s.dpi);
    const alpha = s.alpha && canAlpha(s.type, s.color);
    const canvas = await svgToCanvas(s.area === "view" && shown ? svgViewing(svg, shown) : svg, px.width, px.height, alpha ? "" : "#ffffff");
    const blob = await encode(canvas, s, alpha);
    const ext = TYPES.find(([t]) => t === s.type)![2];
    downloadBlob(`${baseName(store.fileName)}.${ext}`, blob);
  } catch (err) {
    toast(`Image export failed: ${errorMessage(err)}`);
  }
}

/** Only PNG and TIFF keep transparency, and only in full colour. */
function canAlpha(type: ImageType, color: ImageColor): boolean {
  return (type === "png" || type === "tiff") && color === "full";
}

async function encode(canvas: HTMLCanvasElement, s: Settings, alpha: boolean): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("the browser has no 2D canvas");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolor(pixels.data, s.color);
  if (s.type === "tiff") return new Blob([encodeTiff(pixels, { alpha, gray: s.color !== "full", dpi: s.dpi })], { type: "image/tiff" });
  if (s.type === "bmp") return new Blob([encodeBmp(pixels, s.dpi)], { type: "image/bmp" });
  if (s.color !== "full") ctx.putImageData(pixels, 0, 0);
  return s.type === "jpeg" ? canvasBlob(canvas, "image/jpeg", s.quality) : canvasBlob(canvas, "image/png");
}

/**
 * The open drawing as a PNG fitted inside a width × height box (the cloud's thumbnail). The SVG is
 * built before the first wait, so the picture is of the drawing as it is when this is called.
 * Resolves null when no layer is visible.
 */
export async function thumbnailPng(scene: Scene, width: number, height: number): Promise<Blob | null> {
  const session = store.session;
  if (!session) return null;
  const layerIds = scene.drawnLayers(store.activeLayerId).map((l) => l.id);
  if (layerIds.length === 0) return null;
  const svg = toSvg(session.doc, layerIds);
  const paper = svgPaperMm(svg, 1);
  const fit = Math.min(width / paper.width, height / paper.height);
  return svgToPng(svg, paper.width * fit, paper.height * fit);
}

function baseName(fileName: string): string {
  return fileName.replace(/\.vwx$/i, "");
}

/** A length in millimetres to one decimal place. */
function mm(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** Megabytes to one decimal place. */
function mb(bytes: number): string {
  return String(Math.round((bytes / 1048576) * 10) / 10);
}

function select<T extends string | number>(label: string, choices: readonly (readonly [T, string, ...unknown[]])[], value: T): HTMLSelectElement {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...choices.map(([v, text]) => h("option", { value: String(v), text })));
  el.value = String(value);
  return el;
}

/**
 * The dialog. The hints under the choices give the pixel size it makes and the memory it takes;
 * the longer side is capped, and the hint says so. Resolves with the settings, or null when cancelled.
 */
function askSettings(paperOf: (area: Area) => PaperSize, scale: number, viewOk: boolean): Promise<Settings | null> {
  const area = select<Area>("Export area", [["all", "All visible objects"], ["view", "Current view"]], viewOk ? last.area : "all");
  area.querySelector<HTMLOptionElement>("option[value=view]")!.disabled = !viewOk;
  const dpi = h("input", { cls: "menu-dialog-input", value: String(last.dpi), attrs: { type: "text", inputmode: "decimal", "aria-label": "Resolution" } });
  const type = select<ImageType>("File type", TYPES, last.type);
  const color = select<ImageColor>("Color", COLORS, last.color);
  const quality = select<number>("JPEG quality", QUALITIES, last.quality);
  const alpha = h("input", { checked: last.alpha, attrs: { type: "checkbox", "aria-label": "Save Alpha Channel" } });
  const size = h("p", { cls: "png-hint" });
  const cap = h("p", { cls: "png-hint" });
  const typedDpi = (): number | null => {
    const v = Number(dpi.value.trim().replace(/\s*dpi$/i, ""));
    return v >= MIN_DPI && v <= MAX_DPI ? v : null;
  };
  const update = (): void => {
    alpha.disabled = !canAlpha(type.value as ImageType, color.value as ImageColor);
    quality.disabled = type.value !== "jpeg";
    const d = typedDpi();
    if (d === null) {
      size.textContent = `Type a resolution of ${MIN_DPI} to ${MAX_DPI} dpi.`;
      cap.textContent = "";
      return;
    }
    const paper = paperOf(area.value as Area);
    const px = pngPixelSize(paper, d);
    size.textContent = `${px.width} × ${px.height} px for ${mm(paper.width)} × ${mm(paper.height)} mm of paper at 1:${scale}, about ${mb(px.width * px.height * 4)} MB while it is made.`;
    cap.textContent = `The longer side is capped at ${MAX_PNG_SIDE} px` + (px.capped ? ", so this size is smaller than the resolution asks for." : ".");
  };
  for (const el of [area, type, color]) el.addEventListener("change", update);
  dpi.addEventListener("input", update);
  update();
  const field = (label: string, el: HTMLElement, unit?: string): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  return showDialog<Settings>({
    title: "Export Image File",
    okLabel: "Export",
    cls: "png-dialog",
    body: [
      field("Export area", area),
      field("Resolution", dpi, "dpi"),
      field("File type", type),
      field("Color", color),
      field("JPEG quality", quality),
      h("label", { cls: "menu-dialog-check" }, alpha, "Save Alpha Channel"),
      size,
      cap,
    ],
    check: () => {
      const d = typedDpi();
      if (d === null) return { error: `Resolution: enter ${MIN_DPI} to ${MAX_DPI} dpi.`, focus: dpi };
      last = {
        area: area.value as Area,
        dpi: d,
        type: type.value as ImageType,
        color: color.value as ImageColor,
        alpha: alpha.checked,
        quality: Number(quality.value),
      };
      return { value: last };
    },
  });
}
