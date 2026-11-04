// File > Import > Import Image File(s)…, as Vectorworks 2026 has it, and image files dropped on an open
// drawing: one picture or several, and the Image Import Options dialog once for all of them. Import as
// Bitmap; Image Information (the file's name and type, its pixels and its size uncompressed, or
// <multiple images>); Compression Method, JPEG or PNG, each with the size it makes; Import as black and
// white (PNG: each pixel black or white); Import alpha channel (PNG, when a picture has transparency:
// kept, or else laid on white, as JPEG always is). The pictures are placed by images.ts, several in a
// row, in one undo step. Not offered: Import as Image resource (how a drawing keeps one isn't known),
// referencing and georeferencing.

import { size } from "./compressImages.ts";
import { h } from "./dom.ts";
import { pictureOf, placeRow, ready, type Picture } from "./images.ts";
import { showDialog } from "./menubar.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp";

/** True for a file name Import Image File(s) takes. */
export const isImageName = (name: string): boolean => /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);

/** JPEG quality, as Compress Images uses */
const QUALITY = 0.8;
/** a pixel at least this light (0 to 255) is white in black and white */
const THRESHOLD = 128;

interface Source {
  readonly name: string;
  /** the picture as it is read, PNG or JPEG */
  readonly picture: Picture;
  readonly pixels: ImageData;
  /** some pixel isn't opaque */
  readonly alpha: boolean;
}

export interface ImportOptions {
  method: "jpeg" | "png";
  bw: boolean;
  alpha: boolean;
}

async function readSource(file: File): Promise<Source> {
  const picture = await pictureOf(file);
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = h("canvas", { attrs: { width: String(bitmap.width), height: String(bitmap.height) } });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("the picture could not be drawn");
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let alpha = false;
    for (let i = 3; i < pixels.data.length && !alpha; i += 4) alpha = pixels.data[i] < 255;
    return { name: file.name, picture, pixels, alpha };
  } finally {
    bitmap.close();
  }
}

/** The picture as the options make it: its own bytes when they already are what was asked for. */
export async function encodePicture(src: Source, o: ImportOptions): Promise<Picture> {
  const { picture, pixels } = src;
  const mime = o.method === "jpeg" ? "image/jpeg" : "image/png";
  const bw = o.bw && o.method === "png";
  const keepAlpha = o.alpha && o.method === "png";
  if (!bw && picture.mime === mime && (keepAlpha || !src.alpha)) return picture;
  const { width, height } = pixels;
  const out = new ImageData(new Uint8ClampedArray(pixels.data), width, height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!keepAlpha) {
      // laid on white
      const a = d[i + 3] / 255;
      for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * a + 255 * (1 - a);
      d[i + 3] = 255;
    }
    if (bw) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= THRESHOLD ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
  canvas.getContext("2d")?.putImageData(out, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, o.method === "jpeg" ? QUALITY : undefined));
  if (!blob) throw new Error(`the picture could not be made ${o.method.toUpperCase()}`);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height };
}

/** The Image Import Options dialog for `sources`; the options chosen, or null when cancelled. */
async function optionsDialog(sources: readonly Source[]): Promise<ImportOptions | null> {
  const one = sources.length === 1 ? sources[0] : null;
  const anyAlpha = sources.some((s) => s.alpha);
  const o: ImportOptions = { method: sources.every((s) => s.picture.mime === "image/jpeg") ? "jpeg" : "png", bw: false, alpha: true };
  const method = h(
    "select",
    { cls: "menu-dialog-input", attrs: { "aria-label": "Compression Method" } },
    h("option", { text: "JPEG", attrs: { value: "jpeg" } }),
    h("option", { text: "PNG", attrs: { value: "png" } }),
  );
  method.value = o.method;
  const check = (label: string, on: boolean): HTMLInputElement => {
    const input = h("input", { attrs: { type: "checkbox", "aria-label": label } });
    input.checked = on;
    return input;
  };
  const bw = check("Import as black and white", false);
  const alpha = check("Import alpha channel", true);
  const sizes = h("p", { cls: "menu-dialog-text muted", attrs: { "aria-live": "polite" } });
  // what each method makes, worked out again as the options change; the last asked wins
  let asked = 0;
  const measure = async (): Promise<void> => {
    const n = ++asked;
    const total = async (m: ImportOptions["method"]): Promise<number> => {
      let sum = 0;
      for (const s of sources) sum += (await encodePicture(s, { ...o, method: m })).bytes.length;
      return sum;
    };
    const [jpeg, png] = [await total("jpeg"), await total("png")];
    if (n === asked) sizes.textContent = `JPEG makes ${size(jpeg)}, PNG ${size(png)}.`;
  };
  const sync = (): void => {
    o.method = method.value === "jpeg" ? "jpeg" : "png";
    bw.disabled = o.method !== "png";
    alpha.disabled = o.method !== "png" || !anyAlpha;
    o.bw = bw.checked;
    o.alpha = alpha.checked;
    void measure();
  };
  for (const c of [method, bw, alpha]) c.addEventListener("change", sync);
  sync();
  const info = one
    ? `${one.name}: ${one.picture.mime === "image/jpeg" ? "JPEG" : one.name.split(".").pop()?.toUpperCase() ?? "PNG"}, ${one.pixels.width} × ${one.pixels.height} pixels, ${size(one.pixels.data.length)} uncompressed`
    : "<multiple images>";
  const row = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  return showDialog<ImportOptions>({
    title: "Image Import Options",
    okLabel: "OK",
    body: [
      row("Import as", h("span", { text: "Bitmap" })),
      h("p", { cls: "menu-dialog-text", text: info }),
      row("Compression Method", method),
      sizes,
      h("label", { cls: "menu-dialog-check" }, bw, "Import as black and white"),
      h("label", { cls: "menu-dialog-check" }, alpha, "Import alpha channel"),
    ],
    check: () => ({ value: { ...o } }),
  });
}

/** Reads `files`, asks the Image Import Options once, and places them. */
export async function importImages(files: readonly File[], view: View): Promise<void> {
  if (!files.length || !ready("importing an image")) return;
  const sources: Source[] = [];
  for (const file of files) {
    try {
      sources.push(await readSource(file));
    } catch (err) {
      toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    }
  }
  if (!sources.length) return;
  const o = await optionsDialog(sources);
  if (!o) return;
  try {
    const pictures: Picture[] = [];
    for (const s of sources) pictures.push(await encodePicture(s, o));
    placeRow(pictures, view, sources.length === 1 ? "Import image" : "Import images");
  } catch (err) {
    toast(`Import Image File(s) failed: ${errorMessage(err)}`);
  }
}

/** File > Import > Import Image File(s)…: asks for one picture or several and imports them. */
export function importImageFiles(view: View): void {
  if (!ready("importing an image")) return;
  const input = h("input", { attrs: { type: "file", accept: IMAGE_ACCEPT, multiple: "" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.remove();
    void importImages(files, view);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}
