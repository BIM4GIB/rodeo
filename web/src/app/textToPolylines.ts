// Text > Convert Text to Polylines, as Vectorworks has it: each selected text becomes a group of
// polylines, one for each piece of ink in its characters (holes joined in, so a polyline fills as
// its character does), on the text's layer and in its class, filled in the colour the text is
// drawn in and with no pen. The characters are drawn as the drawing shows them (textPaint.ts), at
// about 256 pixels to the em, and traced (trace.ts): the outlines are straight runs within a
// fraction of a percent of the text's size, not the font's own curves. Texts inside groups aren't
// converted. One undo step.

import type { Attributes, BBox, NewShape, ObjectInfo, Pt } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { joinHoles } from "./surfaces.ts";
import { fontOf, selectedTexts } from "./textMenu.ts";
import { paintText } from "./textPaint.ts";
import { toast } from "./toast.ts";
import { traceOutlines } from "./trace.ts";

/** pixels to the em the characters are drawn at to be traced */
const PX_PER_EM = 256;
/** the largest canvas drawn on, in pixels and along a side; a longer text is drawn smaller */
const MAX_PIXELS = 40e6;
const MAX_SIDE = 16384;
/** how far, in pixels, a traced outline may stray to use fewer vertices */
const TOLERANCE = 0.4;
/** pieces of ink smaller than this many square pixels are dropped */
const MIN_AREA = 2;
/** a conversion that would make more polylines than this is refused */
const MAX_OBJECTS = 4000;

/** The selected texts Convert Text to Polylines converts: those not inside a group. */
function convertible(): ObjectInfo[] {
  return selectedTexts().filter((o) => !o.parentId && o.shape?.bbox && o.shape.text?.trim());
}

export function canConvertTextToPolylines(): boolean {
  return convertible().length > 0;
}

/** A text's characters traced: a closed polyline per piece of ink, in world coordinates. */
function traceText(o: ObjectInfo): NewShape[] {
  const shape = o.shape!;
  const box = shape.bbox!;
  const size = shape.textSize && shape.textSize > 0 ? shape.textSize : Math.max(box.y1 - box.y0, 1e-3);
  return traceDrawn(box, size, (ctx) => paintText(ctx, shape, box, fontOf(o)));
}

/**
 * What `paint` inks in world coordinates (y up) within `box`, traced: a closed polyline per piece
 * of ink. `size` is the text size, which sets how finely it is drawn and the room left round the box.
 */
export function traceDrawn(box: BBox, size: number, paint: (ctx: CanvasRenderingContext2D) => void): NewShape[] {
  // room round the box for overhanging italics, accents and underlines
  const pad = size;
  const x0 = box.x0 - pad;
  const y1 = box.y1 + pad;
  const w = box.x1 - box.x0 + 2 * pad;
  const h = box.y1 - box.y0 + 2 * pad;
  const k = Math.min(PX_PER_EM / size, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / w, MAX_SIDE / h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * k));
  canvas.height = Math.max(1, Math.ceil(h * k));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("the browser has no 2D canvas");
  // world to pixels: y down from the padded box's top
  ctx.setTransform(k, 0, 0, -k, -x0 * k, y1 * k);
  ctx.fillStyle = "#000";
  paint(ctx);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const ink = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < ink.length; i++) ink[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
  const world = (p: Pt): Pt => ({ x: x0 + p.x / k, y: y1 - p.y / k });
  return traceOutlines({ width: canvas.width, height: canvas.height, ink }, TOLERANCE, MIN_AREA)
    .filter((patch) => patch.outer.length >= 3)
    .map((patch) => ({
      kind: "polyline",
      points: joinHoles(patch.outer.map(world), patch.holes.filter((r) => r.length >= 3).map((r) => r.map(world))),
      closed: true,
    }));
}

/** Text > Convert Text to Polylines: the selected texts replaced by groups of polylines, selected. */
export function convertTextToPolylines(): void {
  const texts = convertible();
  if (texts.length === 0) {
    toast(selectedTexts().length > 0 ? "Texts inside groups aren't converted: open the group first, or ungroup it." : "Select text to convert.", "info");
    return;
  }
  let traced: { text: ObjectInfo; shapes: NewShape[] }[];
  try {
    traced = texts.map((text) => ({ text, shapes: traceText(text) })).filter((t) => t.shapes.length > 0);
  } catch (err) {
    toast(`Convert Text to Polylines failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const count = traced.reduce((n, t) => n + t.shapes.length, 0);
  if (count === 0) {
    toast("The selected text draws nothing to convert.", "info");
    return;
  }
  if (count > MAX_OBJECTS) {
    toast(`Converting would make ${count} polylines (at most ${MAX_OBJECTS}): convert fewer texts at a time.`);
    return;
  }
  const r = attempt("Convert Text to Polylines", (s) =>
    s.batch(() => {
      const made = traced.map(({ text, shapes }) => {
        // filled as the text is drawn, in its pen colour (a solid fill shows the background
        // colour); no pen, so the joins into holes don't show
        const pen = text.attrs ? { fillFore: text.attrs.penFore, fillBack: text.attrs.penFore, fillOpacity: text.attrs.penOpacity } : {};
        const attrs: Partial<Attributes> = { fillPattern: 1, lineStyle: 0, ...pen };
        const ids = s.addObjects(text.layerId, shapes, text.classIndex, attrs);
        return ids.length < 2 ? ids[0] : s.groupObjects(ids);
      });
      s.deleteObjects(traced.map((t) => t.text.id));
      return made;
    }),
  );
  if (!r) return;
  setEditGroup(null, r.value);
  toast(`Converted ${traced.length === 1 ? "the text" : `${traced.length} texts`} to ${count} ${count === 1 ? "polyline" : "polylines"}.`, "info");
}
