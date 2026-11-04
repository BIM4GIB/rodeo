// Edit Image Effects… (an image's right-click menu, and Object Info's Image Effects… button):
// Vectorworks' Image Effects dialog for the selected images: Exposure, Contrast, Highlights, Shadows,
// Saturation, Temperature, Blur and Sharpness, Sepia and Soft Edges sliders, Auto-Level, Invert
// Colors and Reset, the first image previewed as they move. Apply works them into each image's
// pixels (imageAdjust.ts), one undo step. Vectorworks keeps the effects with the image, to turn off
// (Apply Image Effects) or change later, and keeps saved sets of them; Rodeo changes the pixels for
// good, as Edit Crop does (undo brings them back), and has no saved sets. Image resources, textures,
// backgrounds and viewports aren't offered.

import { imageBytes, type ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h, nextPaint } from "./dom.ts";
import { applyEffects, autoLevel, isPlain, needsAlpha, NO_EFFECTS, type ImageEffects } from "./imageAdjust.ts";
import "./imageEffects.css";
import { showLoading } from "./loading.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

const LABEL = "Edit Image Effects";
/** the preview's largest size, CSS pixels */
const PREVIEW_W = 360;
const PREVIEW_H = 200;

type Slider = Exclude<keyof ImageEffects, "invert">;
const SLIDERS: readonly { key: Slider; label: string; min: number }[] = [
  { key: "exposure", label: "Exposure", min: -100 },
  { key: "contrast", label: "Contrast", min: -100 },
  { key: "highlights", label: "Highlights", min: -100 },
  { key: "shadows", label: "Shadows", min: -100 },
  { key: "saturation", label: "Saturation", min: -100 },
  { key: "temperature", label: "Temperature", min: -100 },
  { key: "sharpness", label: "Blur and Sharpness", min: -100 },
  { key: "sepia", label: "Sepia", min: 0 },
  { key: "softEdges", label: "Soft Edges", min: 0 },
];

/** True when the object is an image with its picture. */
function isImage(o: ObjectInfo | null): o is ObjectInfo {
  const s = o?.shape;
  return s?.kind === "image" && !!(s.image || s.heldImage) && !!s.bbox;
}

/** True when the object is an image whose picture the effects can change, so its menus offer them. */
export function hasImageEffects(id: string | null): id is string {
  return !!id && isImage(store.session?.doc.object(id) ?? null);
}

/** The picture of an image, decoded. */
async function decode(o: ObjectInfo): Promise<ImageBitmap> {
  const s = o.shape!;
  // a big drawing's picture is read back from its file (imageBytes)
  const bytes = await imageBytes(s);
  if (!bytes) throw new Error("the picture could not be read");
  return createImageBitmap(new Blob([bytes as BlobPart], { type: s.imageMime ?? "image/png" }));
}

/** The image's picture with the effects worked in, as a file's bytes. */
async function withEffects(o: ObjectInfo, e: ImageEffects): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number }> {
  const bitmap = await decode(o);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("this browser can't draw the picture");
    g.drawImage(bitmap, 0, 0);
    const data = g.getImageData(0, 0, width, height);
    applyEffects(data.data, width, height, e);
    g.putImageData(data, 0, 0);
    // a JPEG stays a JPEG unless soft edges need clear pixels, which only a PNG holds
    const mime: "image/png" | "image/jpeg" = o.shape!.imageMime === "image/jpeg" && !needsAlpha(e) ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!blob) throw new Error("this browser couldn't save the picture");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height };
  } finally {
    bitmap.close();
  }
}

/** Edit Image Effects…: the dialog for the selected images; `under` (a right-clicked image) is selected first when it isn't. */
export async function editImageEffectsDialog(under?: string): Promise<void> {
  const session = store.session;
  if (!session) return;
  if (under && !store.selection.has(under)) setSelection([under]);
  const images = [...store.selection].map((id) => session.doc.object(id)).filter(isImage);
  if (!images.length) {
    toast("Select an image to change its effects.", "info");
    return;
  }
  // the first image, small, as the preview's starting point
  let base: ImageData;
  const preview = h("canvas", { cls: "fx-preview", attrs: { "aria-label": "Preview" } });
  try {
    const bitmap = await decode(images[0]);
    try {
      const k = Math.min(1, PREVIEW_W / bitmap.width, PREVIEW_H / bitmap.height);
      preview.width = Math.max(1, Math.round(bitmap.width * k));
      preview.height = Math.max(1, Math.round(bitmap.height * k));
      const g = preview.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0, preview.width, preview.height);
      base = g.getImageData(0, 0, preview.width, preview.height);
    } finally {
      bitmap.close();
    }
  } catch (err) {
    toast(`The image couldn't be read: ${errorMessage(err)}`);
    return;
  }
  if (store.session !== session) return;

  const inputs = new Map<Slider, HTMLInputElement>();
  const readouts = new Map<Slider, HTMLElement>();
  const invert = h("input", { attrs: { type: "checkbox", "aria-label": "Invert Colors" } });
  const read = (): ImageEffects => {
    const e: Record<string, number | boolean> = { invert: invert.checked };
    for (const { key } of SLIDERS) e[key] = Number(inputs.get(key)!.value);
    return e as unknown as ImageEffects;
  };
  let queued = false;
  const redraw = (): void => {
    for (const { key } of SLIDERS) readouts.get(key)!.textContent = inputs.get(key)!.value;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const px = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      applyEffects(px.data, px.width, px.height, read());
      preview.getContext("2d")!.putImageData(px, 0, 0);
    });
  };
  const set = (e: ImageEffects): void => {
    for (const { key } of SLIDERS) inputs.get(key)!.value = String(e[key]);
    invert.checked = e.invert;
    redraw();
  };
  const rows = SLIDERS.map(({ key, label, min }) => {
    const input = h("input", { cls: "prefs-range", attrs: { type: "range", min: String(min), max: "100", step: "1", "aria-label": label } });
    input.value = "0";
    input.addEventListener("input", redraw);
    // a double-click puts one slider back
    input.addEventListener("dblclick", () => {
      input.value = "0";
      redraw();
    });
    inputs.set(key, input);
    const readout = h("span", { cls: "prefs-readout", text: "0" });
    readouts.set(key, readout);
    return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, readout);
  });
  invert.addEventListener("change", redraw);
  const auto = h("button", { cls: "btn", text: "Auto-Level", attrs: { type: "button" } });
  auto.addEventListener("click", () => set({ ...read(), highlights: 0, shadows: 0, ...autoLevel(base.data) }));
  const reset = h("button", { cls: "btn", text: "Reset", attrs: { type: "button" } });
  reset.addEventListener("click", () => set(NO_EFFECTS));
  const n = images.length;
  const e = await showDialog<ImageEffects>({
    title: "Image Effects",
    okLabel: "Apply",
    cls: "fx-dialog",
    body: [
      h("div", { cls: "fx-stage" }, preview),
      ...rows,
      h("div", { cls: "fx-buttons" }, h("label", { cls: "menu-dialog-check" }, invert, "Invert Colors"), auto, reset),
      h("p", {
        cls: "muted",
        text: `${n > 1 ? `The ${n} images selected take the same effects; the first is previewed. ` : ""}The effects are worked into the pictures and can't be turned off later (Undo brings them back).`,
      }),
    ],
    check: () => {
      const v = read();
      return isPlain(v) ? { error: "Move a slider, or tick Invert Colors, to change the image." } : { value: v };
    },
  });
  if (!e || store.session !== session) return;
  const done = showLoading(n > 1 ? `Applying the effects to ${n} images…` : "Applying the effects…");
  const out: { image: ObjectInfo; picture: Awaited<ReturnType<typeof withEffects>> }[] = [];
  try {
    for (const [i, image] of images.entries()) {
      done.progress(i / n);
      await nextPaint();
      out.push({ image, picture: await withEffects(image, e) });
    }
  } catch (err) {
    toast(`The effects couldn't be applied: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  if (store.session !== session) return;
  const r = attempt(LABEL, (s) =>
    s.batch(() => {
      for (const { image, picture } of out) {
        const b = image.shape!.bbox!;
        s.setGeometry(image.id, { kind: "image", x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ...picture });
      }
    }),
  );
  if (!r) return;
  toast(n > 1 ? `Image effects applied to ${n} images.` : "Image effects applied.", "info");
}
