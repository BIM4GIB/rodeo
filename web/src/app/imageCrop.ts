// Modify > Edit Crop… (and the drawing's right-click menu on an image), Vectorworks' crop of an
// imported image with Delete Outside Crop done at once: the picture keeps only what lies inside the
// crop, and the image object shrinks to it, its scale unchanged. As in Vectorworks, the crop is a 2D
// object drawn over the image: select the image and one rectangle, circle, polygon or closed
// polyline, and the picture is cut to it (to its outline, the rest clear, when it isn't a level
// rectangle); the shape goes, or stays as a frame. With the image alone selected, a dialog trims it
// by a length off each side. One undo step. Vectorworks keeps the crop object with the image and
// can change it later; this cuts the pixels for good (undo brings them back).

import { imageBytes, type BBox, type ObjectInfo, type Pt, type Shape } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** points round a circle or ellipse used as the crop */
const ROUND = 96;

/** The selected image and the closed shape selected with it (null when the image is alone); null when the selection is neither. */
function cropSelection(): { readonly image: ObjectInfo; readonly shape: ObjectInfo | null } | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size < 1 || store.selection.size > 2) return null;
  const objects = [...store.selection].map((id) => doc.object(id));
  const image = objects.find((o) => o?.shape?.kind === "image" && (o.shape.image || o.shape.heldImage) && o.shape.bbox) ?? null;
  if (!image) return null;
  const other = objects.find((o) => o !== image) ?? null;
  if (store.selection.size === 2 && (!other || !outlineOf(other.shape))) return null;
  return { image, shape: other };
}

/** True when Edit Crop has an image to crop (alone, or with a closed shape to crop it to). */
export function canEditCrop(): boolean {
  return cropSelection() !== null;
}

/** True when the object is an image with its picture, so the right-click menu offers Edit Crop. */
export function isCroppableImage(id: string | null): id is string {
  const s = id ? store.session?.doc.object(id)?.shape : null;
  return s?.kind === "image" && !!(s.image || s.heldImage) && !!s.bbox;
}

/** The area a shape closes, as points: a rectangle, a closed polygon or polyline, a whole circle or ellipse; null for anything else. */
function outlineOf(s: Shape | null): Pt[] | null {
  if (!s) return null;
  if (s.kind === "rect" && s.points.length === 4) return s.points;
  if ((s.kind === "polygon" || s.kind === "polyline") && s.points.length >= 3) return s.points;
  if (s.kind === "arc" && s.center && s.rx && Math.abs(s.sweepAngle ?? 0) >= 359.999) {
    const c = s.center;
    const rx = s.rx;
    const ry = s.ry ?? rx;
    return Array.from({ length: ROUND }, (_, i) => {
      const a = (2 * Math.PI * i) / ROUND;
      return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
    });
  }
  return null;
}

/** True when the points are a rectangle square to the axes. */
function isLevelRect(points: readonly Pt[]): boolean {
  if (points.length !== 4) return false;
  const xs = new Set(points.map((p) => Math.round(p.x * 1e6)));
  const ys = new Set(points.map((p) => Math.round(p.y * 1e6)));
  return xs.size === 2 && ys.size === 2;
}

/** The picture cut to `keep` (a box in the drawing), masked to `mask` (points in the drawing) when given; the new picture and where it lies. */
async function cut(image: ObjectInfo, keep: BBox, mask: readonly Pt[] | null): Promise<{ bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number; box: BBox }> {
  const s = image.shape!;
  const b = s.bbox!;
  // a big drawing's picture is read back from its file (imageBytes)
  const bytes = await imageBytes(s);
  if (!bytes) throw new Error("the picture could not be read");
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: s.imageMime ?? "image/png" }));
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const kx = W / (b.x1 - b.x0);
    const ky = H / (b.y1 - b.y0);
    // the kept box in pixels, out to whole pixels, inside the picture
    const px0 = Math.max(0, Math.floor((keep.x0 - b.x0) * kx + 1e-6));
    const px1 = Math.min(W, Math.ceil((keep.x1 - b.x0) * kx - 1e-6));
    const py0 = Math.max(0, Math.floor((b.y1 - keep.y1) * ky + 1e-6));
    const py1 = Math.min(H, Math.ceil((b.y1 - keep.y0) * ky - 1e-6));
    if (px1 <= px0 || py1 <= py0) throw new Error("the crop doesn't cover any of the picture");
    const width = px1 - px0;
    const height = py1 - py0;
    const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
    const g = canvas.getContext("2d");
    if (!g) throw new Error("this browser can't draw the picture");
    g.drawImage(bitmap, px0, py0, width, height, 0, 0, width, height);
    if (mask) {
      // what lies outside the outline is cleared
      g.globalCompositeOperation = "destination-in";
      g.beginPath();
      mask.forEach((p, i) => {
        const x = (p.x - b.x0) * kx - px0;
        const y = (b.y1 - p.y) * ky - py0;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
    }
    // a JPEG cut square stays a JPEG; a mask needs clear pixels, which only a PNG holds
    const mime: "image/png" | "image/jpeg" = !mask && s.imageMime === "image/jpeg" ? "image/jpeg" : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92));
    if (!blob) throw new Error("this browser couldn't save the picture");
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime,
      width,
      height,
      box: { x0: b.x0 + px0 / kx, x1: b.x0 + px1 / kx, y0: b.y1 - py1 / ky, y1: b.y1 - py0 / ky },
    };
  } finally {
    bitmap.close();
  }
}

/** Modify > Edit Crop…: crops the selected image to the shape selected with it, or by a length off each side; `under` (a right-clicked image) is selected first when it isn't. */
export async function editCropDialog(under?: string): Promise<void> {
  if (under && !store.selection.has(under)) setSelection([under]);
  const sel = cropSelection();
  const doc = store.session?.doc;
  if (!sel || !doc) {
    toast("Select an image, and a rectangle, circle or closed polygon over it to crop it to.", "info");
    return;
  }
  const { image, shape } = sel;
  const b = image.shape!.bbox!;
  const units = doc.info.units;
  let keep: BBox;
  let mask: Pt[] | null = null;
  let keepShape = false;
  if (shape) {
    const outline = outlineOf(shape.shape)!;
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    keep = { x0: Math.max(b.x0, Math.min(...xs)), x1: Math.min(b.x1, Math.max(...xs)), y0: Math.max(b.y0, Math.min(...ys)), y1: Math.min(b.y1, Math.max(...ys)) };
    if (keep.x1 <= keep.x0 || keep.y1 <= keep.y0) {
      toast("The shape doesn't overlap the image.", "info");
      return;
    }
    if (!isLevelRect(outline)) mask = outline;
    const frame = h("input", { attrs: { type: "checkbox", "aria-label": "Keep the shape as a frame" } });
    const v = await showDialog<boolean>({
      title: "Edit Crop",
      okLabel: "Crop",
      body: [
        h("p", {
          cls: "muted",
          text: mask
            ? "The picture keeps only what lies inside the shape; the rest becomes clear. This can't be changed later (Undo brings it back)."
            : "The picture keeps only what lies inside the rectangle. This can't be changed later (Undo brings it back).",
        }),
        h("label", { cls: "menu-dialog-check" }, frame, "Keep the shape as a frame"),
      ],
      check: () => ({ value: frame.checked }),
    });
    if (v === null) return;
    keepShape = v;
  } else {
    const suffix = lengthSuffix(units);
    const input = (label: string): HTMLInputElement =>
      h("input", { cls: "menu-dialog-input", value: formatLengthValue(0, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
    const sides = { left: input("Left"), right: input("Right"), top: input("Top"), bottom: input("Bottom") };
    const row = (label: string, el: HTMLInputElement): HTMLElement =>
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null);
    const v = await showDialog<BBox>({
      title: "Edit Crop",
      okLabel: "Crop",
      body: [
        h("p", { cls: "muted", text: `The image is ${formatLengthValue(b.x1 - b.x0, units)} × ${formatLengthValue(b.y1 - b.y0, units)}${suffix ? ` ${suffix}` : ""}. Trim it by:` }),
        row("Left", sides.left),
        row("Right", sides.right),
        row("Top", sides.top),
        row("Bottom", sides.bottom),
        h("p", { cls: "muted", text: "To crop to a shape, draw a rectangle, circle or polygon over the image and select both." }),
      ],
      check: () => {
        const read = (el: HTMLInputElement): number | null => {
          const mm = parseLength(el.value, units);
          return mm !== null && mm >= 0 ? mm : null;
        };
        const l = read(sides.left);
        if (l === null) return { error: "Left: a length of 0 or more.", focus: sides.left };
        const r = read(sides.right);
        if (r === null) return { error: "Right: a length of 0 or more.", focus: sides.right };
        const t = read(sides.top);
        if (t === null) return { error: "Top: a length of 0 or more.", focus: sides.top };
        const d = read(sides.bottom);
        if (d === null) return { error: "Bottom: a length of 0 or more.", focus: sides.bottom };
        if (l + r >= b.x1 - b.x0 || t + d >= b.y1 - b.y0) return { error: "That would trim the whole image away.", focus: sides.left };
        if (l + r + t + d === 0) return { error: "Trim at least one side.", focus: sides.left };
        return { value: { x0: b.x0 + l, x1: b.x1 - r, y0: b.y0 + d, y1: b.y1 - t } };
      },
    });
    if (!v) return;
    keep = v;
  }
  let out: Awaited<ReturnType<typeof cut>>;
  try {
    out = await cut(image, keep, mask);
  } catch (err) {
    toast(`Edit Crop failed: ${errorMessage(err)}`);
    return;
  }
  const done = attempt("Edit Crop", (s) =>
    s.batch(() => {
      s.setGeometry(image.id, { kind: "image", ...out.box, bytes: out.bytes, mime: out.mime, width: out.width, height: out.height });
      if (shape && !keepShape) s.deleteObjects([shape.id]);
    }),
  );
  if (!done) return;
  setSelection([image.id]);
  toast(`Image cropped to ${out.width} × ${out.height} pixels.`, "info");
}
