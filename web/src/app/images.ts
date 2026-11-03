// File > Import Image… and Edit > Paste as Bitmap: a PNG or JPEG (or any picture the browser can
// read, kept as PNG) placed on the active layer as an image object, centred in the view and
// sized at 72 pixels to the paper inch at the layer's scale, as Vectorworks places a picture.
// Paste as Bitmap takes the picture on the system clipboard, or else the objects last copied
// here drawn as one picture their own size (copyPicture.ts), as sharp as the view shows them or
// 150 pixels to the paper inch, whichever is finer.
// The new image takes its other settings from an image already in the drawing.

import type { NewShape } from "../core/index.ts";
import { canvasBlob, MAX_PNG_SIDE, svgToCanvas, svgViewing } from "../export/png.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { copiedBounds, copiedPicture, type CopyPicture } from "./copyPicture.ts";
import { h } from "./dom.ts";
import { layerInfo, store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

const MM_PER_INCH = 25.4;
/** pixels to the paper inch a placed picture is sized at */
const PLACE_DPI = 72;
/** pixels to the paper inch copied objects are drawn at, pasted as a bitmap */
const BITMAP_DPI = 150;

interface Picture {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** The picture in `blob`: PNG and JPEG as they are, anything else the browser reads redrawn as PNG. */
async function pictureOf(blob: Blob): Promise<Picture> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  try {
    if (blob.type === "image/png" || blob.type === "image/jpeg") {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, width, height };
    }
    const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("the picture could not be converted to PNG");
    return { bytes: new Uint8Array(await png.arrayBuffer()), mime: "image/png", width, height };
  } finally {
    bitmap.close();
  }
}

/** True when a picture can go on the active layer now; otherwise says why. */
function ready(what: string): boolean {
  const s = store.session;
  if (!s) {
    toast(`Open a drawing before ${what}.`, "info");
    return false;
  }
  if (store.activeLayerId === null) {
    toast(`Choose a layer for the picture first.`, "info");
    return false;
  }
  if (!s.canAdd("image")) {
    toast("This drawing has no image to copy settings from yet, so pictures can't be added to it.", "info");
    return false;
  }
  return true;
}

/** Places the picture on the active layer, centred in the view, and selects it: `size` in the drawing, or 72 dpi on paper. */
function place(picture: Picture, view: View, label: string, size?: { readonly w: number; readonly h: number }): void {
  const layerId = store.activeLayerId;
  const doc = store.session?.doc;
  if (!layerId || !doc) return;
  const layer = layerInfo(layerId);
  const scale = layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
  const w = size?.w ?? (picture.width / PLACE_DPI) * MM_PER_INCH * scale;
  const hgt = size?.h ?? (picture.height / PLACE_DPI) * MM_PER_INCH * scale;
  const shape: NewShape = {
    kind: "image",
    x0: view.cx - w / 2,
    y0: view.cy - hgt / 2,
    x1: view.cx + w / 2,
    y1: view.cy + hgt / 2,
    bytes: picture.bytes,
    mime: picture.mime,
    width: picture.width,
    height: picture.height,
  };
  const r = attempt(label, (s) => s.addObject(layerId, shape, store.activeClassIndex));
  if (r) setEditGroup(null, [r.value]);
}

/** A PNG `width` by `height` pixels placed on the active layer as Import Image places a picture, or a message saying why it can't go there. */
export function placePng(bytes: Uint8Array, width: number, height: number, view: View, label: string): void {
  if (ready("placing a picture")) place({ bytes, mime: "image/png", width, height }, view, label);
}

/** File > Import Image…: asks for a picture file and places it. */
export function importImageFile(view: View): void {
  if (!ready("importing an image")) return;
  const input = h("input", { attrs: { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void pictureOf(file).then(
      (picture) => place(picture, view, "Import image"),
      (err) => toast(`Could not read ${file.name}: ${errorMessage(err)}`),
    );
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/**
 * Edit > Paste as Bitmap: the picture on the system clipboard, or else the objects last copied or
 * cut here drawn as one picture their own size, placed as an image object.
 */
export async function pasteAsBitmap(view: View): Promise<void> {
  if (!ready("pasting a bitmap")) return;
  let blob: Blob | null = null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) {
        blob = await item.getType(type);
        break;
      }
    }
  } catch {
    // denied, or nothing the browser reads: the copy made here is used
  }
  try {
    if (blob) {
      place(await pictureOf(blob), view, "Paste as bitmap");
      return;
    }
    const copied = copiedPicture();
    if (copied === null) {
      toast("The clipboard holds no picture, and nothing has been copied here.", "info");
      return;
    }
    if (copied === "changed") {
      toast("The drawing changed after the copy: copy the objects again to paste them as a bitmap.", "info");
      return;
    }
    const drawn = await drawnPicture(copied, view);
    place(drawn.picture, view, "Paste as bitmap", drawn.size);
  } catch (err) {
    toast(`Paste as bitmap failed: ${errorMessage(err)}`);
  }
}

/**
 * The copied objects drawn on a clear background, as sharp as `view` shows them or at 150 dpi on
 * paper, whichever is finer (8000 pixels a side at most), and their size in the drawing.
 */
async function drawnPicture(copied: CopyPicture, view: View): Promise<{ picture: Picture; size: { w: number; h: number } }> {
  const box = copiedBounds(copied);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const perMm = Math.max(BITMAP_DPI / MM_PER_INCH / copied.scale, view.scale * (window.devicePixelRatio || 1));
  const fit = Math.min(1, MAX_PNG_SIDE / Math.max(w * perMm, h * perMm));
  const width = Math.max(1, Math.round(w * perMm * fit));
  const height = Math.max(1, Math.round(h * perMm * fit));
  const canvas = await svgToCanvas(svgViewing(copied.svg, box), width, height, "");
  const png = await canvasBlob(canvas, "image/png");
  return { picture: { bytes: new Uint8Array(await png.arrayBuffer()), mime: "image/png", width, height }, size: { w, h } };
}
