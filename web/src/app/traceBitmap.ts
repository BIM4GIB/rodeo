// Modify > Trace Bitmap…: turns the selected image into vector objects, as Vectorworks' Trace
// Bitmap does. The picture is read in black and white at a brightness threshold, the dark or the
// light parts being ink, and traced (trace.ts) as filled outlines, each patch of ink a polygon
// with its holes, or as centrelines down the middles of its strokes, for line work such as a
// scanned drawing. The result is grouped over the image, on its layer, in one undo step; the
// image stays. Large pictures are traced at up to MAX_SIDE pixels across.

import { imageBytes, type NewShape, type Pt } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { joinHoles } from "./surfaces.ts";
import { toast } from "./toast.ts";
import { traceCentrelines, traceOutlines, type Mask } from "./trace.ts";

/** pictures are traced at up to this many pixels on their longer side */
const MAX_SIDE = 2000;
/** a trace that would make more objects than this is refused */
const MAX_OBJECTS = 4000;
const PREFS_KEY = "openvwx.traceBitmap.v1";

interface TracePrefs {
  readonly as: "outlines" | "centrelines";
  readonly ink: "dark" | "light";
  /** brightness, 1 to 99 percent, below which (dark ink) or from which (light ink) a pixel is ink */
  readonly threshold: number;
  /** how far, in pixels, the traced paths may stray to use fewer vertices */
  readonly tolerance: number;
  /** patches smaller than this many square pixels, and centrelines shorter than this many pixels, are dropped */
  readonly speck: number;
}

const DEFAULTS: TracePrefs = { as: "outlines", ink: "dark", threshold: 50, tolerance: 1, speck: 4 };

function loadPrefs(): TracePrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<TracePrefs> | null;
    return {
      as: p?.as === "centrelines" ? "centrelines" : "outlines",
      ink: p?.ink === "light" ? "light" : "dark",
      threshold: typeof p?.threshold === "number" ? p.threshold : DEFAULTS.threshold,
      tolerance: typeof p?.tolerance === "number" ? p.tolerance : DEFAULTS.tolerance,
      speck: typeof p?.speck === "number" ? p.speck : DEFAULTS.speck,
    };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(p: TracePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage blocked: the settings last for this dialog
  }
}

/** The one selected image object's id, or null. */
function selectedImage(): string | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id)?.shape?.kind === "image" ? id : null;
}

/** True when Trace Bitmap has an image to trace. */
export function canTraceBitmap(): boolean {
  return selectedImage() !== null;
}

/** The picture's pixels in black and white, ink as 1, at up to MAX_SIDE across; clear pixels are paper. */
async function maskOf(bytes: Uint8Array, mime: string, p: TracePrefs): Promise<Mask> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * k));
  const height = Math.max(1, Math.round(bmp.height * k));
  const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("this browser can't read the picture's pixels");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const ink = new Uint8Array(width * height);
  const cut = (p.threshold / 100) * 255;
  for (let i = 0; i < ink.length; i++) {
    const lum = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
    ink[i] = (p.ink === "dark" ? lum < cut : lum >= cut) ? 1 : 0;
  }
  return { width, height, ink };
}

/** A labelled field for the dialog. */
function field(label: string, control: HTMLElement, unit = ""): HTMLElement {
  return h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: label }),
    control,
    unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
  );
}

function choice(label: string, value: string, options: readonly [string, string][]): HTMLSelectElement {
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
    ...options.map(([v, text]) => h("option", { value: v, text })),
  );
  select.value = value;
  return select;
}

function numberInput(label: string, value: number): HTMLInputElement {
  return h("input", { cls: "menu-dialog-input", value: String(value), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
}

/** Asks how to trace the selected image, then traces it. */
export async function traceBitmapDialog(): Promise<void> {
  const id = selectedImage();
  const doc = store.session?.doc;
  const obj = id && doc ? doc.object(id) : null;
  const shape = obj?.shape;
  const box = shape?.bbox;
  if (!id || !obj || shape?.kind !== "image" || !(shape.image || shape.heldImage) || !shape.imageMime || !box) return;
  // a big drawing's picture is read back from its file (imageBytes)
  const bytes = await imageBytes(shape);
  if (!bytes) return;
  const mime = shape.imageMime;
  const prefs = loadPrefs();
  const as = choice("Trace", prefs.as, [
    ["outlines", "Filled outlines"],
    ["centrelines", "Centrelines"],
  ]);
  const ink = choice("Ink", prefs.ink, [
    ["dark", "Dark parts"],
    ["light", "Light parts"],
  ]);
  const threshold = numberInput("Threshold", prefs.threshold);
  const tolerance = numberInput("Simplify", prefs.tolerance);
  const speck = numberInput("Ignore specks under", prefs.speck);
  const read = (input: HTMLInputElement, label: string, min: number, max: number): { value: number } | { error: string; focus: HTMLElement } => {
    const n = Number(input.value.trim().replace(",", "."));
    return input.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max
      ? { value: n }
      : { error: `${label}: enter a number from ${min} to ${max}.`, focus: input };
  };
  const chosen = await showDialog<TracePrefs>({
    title: "Trace Bitmap",
    okLabel: "Trace",
    body: [
      field("Trace", as),
      field("Ink", ink),
      field("Threshold", threshold, "% brightness"),
      field("Simplify", tolerance, "pixels"),
      field("Ignore specks under", speck, "pixels"),
      h("p", {
        cls: "muted",
        text: `Outlines fill each patch of ink, holes and all; centrelines follow the middles of its lines. The traced objects are grouped over the image, which stays. Pictures over ${MAX_SIDE} pixels across are traced at that size.`,
      }),
    ],
    check: () => {
      const t = read(threshold, "Threshold", 1, 99);
      if ("error" in t) return t;
      const s = read(tolerance, "Simplify", 0, 50);
      if ("error" in s) return s;
      const sp = read(speck, "Ignore specks under", 0, 100000);
      if ("error" in sp) return sp;
      return {
        value: {
          as: as.value === "centrelines" ? "centrelines" : "outlines",
          ink: ink.value === "light" ? "light" : "dark",
          threshold: t.value,
          tolerance: s.value,
          speck: sp.value,
        },
      };
    },
  });
  if (!chosen) return;
  savePrefs(chosen);

  let mask: Mask;
  try {
    mask = await maskOf(bytes, mime, chosen);
  } catch (err) {
    toast(`Trace Bitmap failed: couldn't read the picture (${err instanceof Error ? err.message : String(err)})`);
    return;
  }
  // pixel corners to the drawing: the picture spans its rectangle, its top row at the top
  const sx = (box.x1 - box.x0) / mask.width;
  const sy = (box.y1 - box.y0) / mask.height;
  const world = (p: Pt): Pt => ({ x: box.x0 + p.x * sx, y: box.y1 - p.y * sy });
  const shapes: NewShape[] =
    chosen.as === "outlines"
      ? traceOutlines(mask, chosen.tolerance, chosen.speck)
          .filter((patch) => patch.outer.length >= 3)
          .map((patch) => ({ kind: "polygon", points: joinHoles(patch.outer.map(world), patch.holes.filter((r) => r.length >= 3).map((r) => r.map(world))), closed: true }))
      : traceCentrelines(mask, chosen.tolerance, chosen.speck)
          .filter((path) => path.points.length >= 2)
          .map((path) => ({ kind: "polygon", points: path.points.map(world), closed: path.closed }));
  if (shapes.length === 0) {
    toast("Trace Bitmap found nothing to trace at that threshold.", "info");
    return;
  }
  if (shapes.length > MAX_OBJECTS) {
    toast(`Trace Bitmap would make ${shapes.length} objects (at most ${MAX_OBJECTS}): raise the speck size or change the threshold.`);
    return;
  }
  const layerId = obj.layerId;
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const r = attempt("Trace Bitmap", (s) =>
    s.batch(() => {
      const ids = s.addObjects(layerId, shapes, store.activeClassIndex, attrs);
      return ids.length < 2 ? ids[0] : s.groupObjects(ids);
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  toast(`Traced ${shapes.length} ${shapes.length === 1 ? "object" : "objects"}.`, "info");
}
