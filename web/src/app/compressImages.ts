// Tools > Compress Images…, as Vectorworks has it: bitmap images saved again with JPEG compression so
// the file gets smaller, either the selected ones (with those in selected groups) or every one on the
// drawing's layers. Each image keeps its record, place, size, class and attributes; only its picture
// becomes a JPEG, which can lose fine detail. One that is a JPEG already, one with clear parts (a JPEG
// has none: the clear white of an 8-bit plant picture, say) and one whose JPEG wouldn't be smaller
// stay as they are. Image resources (image fills and textures) aren't compressed. One undo step.

import { imageBytes, type ObjectInfo, type Shape } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

/** JPEG quality, near the normal quality Vectorworks' image records name */
const QUALITY = 0.8;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An image object, its shape (imageBytes reads its picture) and the picture's kind and size as stored. */
interface Found {
  readonly o: ObjectInfo;
  readonly shape: Shape;
  readonly mime: string;
  readonly length: number;
}

/** A picture compressed, or why it stays. */
type Outcome = { readonly bytes: Uint8Array; readonly width: number; readonly height: number } | "jpeg" | "clear" | "larger";

export async function compressImagesDialog(): Promise<void> {
  if (!store.session) return;
  const selected = imagesOf(false);
  const v = await toolPrefs(
    "Compress Images",
    [
      {
        kind: "choice",
        key: "apply",
        label: "Apply JPEG Compression to",
        value: selected.length ? "selected" : "all",
        options: [
          { value: "selected", label: "Selected Bitmaps" },
          { value: "all", label: "All Bitmaps" },
        ],
      },
    ],
    "Bitmap images are saved again as JPEGs to make the file smaller; fine detail can be lost. Images that are JPEGs already, have clear parts or wouldn't get smaller stay as they are. Image resources (image fills and textures) aren't compressed.",
  );
  if (!v) return;
  const all = v.choice("apply") === "all";
  const found = all ? imagesOf(true) : selected;
  if (!found.length) {
    toast(all ? "The drawing has no bitmap images to compress." : "Select the bitmap images to compress, or apply it to all of them.", "info");
    return;
  }
  const done: { readonly f: Found; readonly to: Exclude<Outcome, string> }[] = [];
  const kept = { jpeg: 0, clear: 0, larger: 0 };
  try {
    for (const f of found) {
      const r = await compressed(f);
      if (typeof r === "string") kept[r]++;
      else done.push({ f, to: r });
    }
  } catch (err) {
    toast(`Compress Images failed: ${errorMessage(err)}`);
    return;
  }
  const changed = done.length
    ? attempt("Compress Images", (s) =>
        s.batch(() => {
          for (const { f, to } of done) {
            const b = f.o.shape?.bbox;
            if (!b) continue;
            s.setGeometry(f.o.id, { kind: "image", x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, bytes: to.bytes, mime: "image/jpeg", width: to.width, height: to.height });
          }
        }),
      )
    : null;
  if (done.length && !changed) return;
  const before = done.reduce((n, d) => n + d.f.length, 0);
  const after = done.reduce((n, d) => n + d.to.bytes.length, 0);
  const why = [
    kept.jpeg ? `${kept.jpeg} a JPEG already` : "",
    kept.clear ? `${kept.clear} with clear parts` : "",
    kept.larger ? `${kept.larger} no smaller as a JPEG` : "",
  ].filter(Boolean);
  const left = why.length ? ` Left as ${found.length - done.length === 1 ? "it was" : "they were"}: ${why.join(", ")}.` : "";
  toast(
    done.length
      ? `Compressed ${count(done.length)}: ${size(before)} down to ${size(after)}.${left}`
      : `No image was compressed.${left}`,
    "info",
  );
}

const count = (n: number): string => `${n} ${n === 1 ? "image" : "images"}`;

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The image objects on the drawing's layers: all of them, or the selected ones and those inside selected groups. */
function imagesOf(all: boolean): Found[] {
  const s = store.session;
  if (!s) return [];
  const objects = s.doc.layers().flatMap((l) => s.doc.objects(l.id));
  const picked = new Set(store.selection);
  if (!all) {
    for (let grew = true; grew; ) {
      grew = false;
      for (const o of objects) {
        if (o.parentId !== null && picked.has(o.parentId) && !picked.has(o.id)) {
          picked.add(o.id);
          grew = true;
        }
      }
    }
  }
  return objects.flatMap((o) => {
    const sh = o.shape;
    const length = sh?.heldImage?.length ?? sh?.image?.length ?? 0;
    if (sh?.kind !== "image" || !length || !sh.imageMime || !(all || picked.has(o.id))) return [];
    return [{ o, shape: sh, mime: sh.imageMime, length }];
  });
}

/** `f`'s picture as a JPEG, or why it stays as it is. */
async function compressed(f: Found): Promise<Outcome> {
  if (f.mime === "image/jpeg") return "jpeg";
  // a big drawing's picture is read back from its file (imageBytes)
  const bytes = await imageBytes(f.shape);
  if (!bytes) throw new Error("an image's picture could not be read.");
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: f.mime }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("the browser could not draw the image.");
    g.drawImage(bitmap, 0, 0);
    if (mayBeClear(bytes) && hasClear(g, canvas.width, canvas.height)) return "clear";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob) throw new Error("the browser could not make a JPEG.");
    if (blob.size >= bytes.length) return "larger";
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Whether a PNG can hold clear pixels: an alpha channel (colour types 4 and 6) or a tRNS chunk. Anything else is read pixel by pixel. */
function mayBeClear(b: Uint8Array): boolean {
  if (b.length < 33 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return true;
  const colourType = b[25];
  if (colourType === 4 || colourType === 6) return true;
  for (let at = 8; at + 8 <= b.length; ) {
    const length = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (type === "tRNS") return true;
    if (type === "IDAT" || type === "IEND") return false;
    at += 12 + length;
  }
  return false;
}

/** Whether any pixel drawn on `g` is less than opaque, read a band of rows at a time. */
function hasClear(g: CanvasRenderingContext2D, width: number, height: number): boolean {
  const band = Math.max(1, Math.floor(4_000_000 / Math.max(1, width)));
  for (let y = 0; y < height; y += band) {
    const px = g.getImageData(0, y, width, Math.min(band, height - y)).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  }
  return false;
}
