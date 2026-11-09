// Modify > Hatch…, as Vectorworks has it: with one closed object selected, choose one of the
// drawing's hatches, then click where the hatch starts and click again to turn it (the Hatch tool,
// tools/hatch.ts). The hatch's lines fill the object out to its edge, as a group of lines in each
// line family's colour and weight, just above the object, which stays. It is drawn once, not tied
// to the object or the hatch (Vectorworks' non-associative hatch). A hatch sized on the page is
// drawn at the layer's scale. One undo step.

import type { HatchFill, Pt, Shape } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { ellipsePoints } from "./geom.ts";
import { hatchPreviews } from "./hatchEditor.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { isFullArc } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** the most lines one hatch may draw */
export const MAX_HATCH_LINES = 20000;
/** points round a circle or oval's outline */
const ROUND_STEPS = 180;

/** One drawn piece of a hatch line, with its family's colour index and weight (mils). */
export interface HatchSegment {
  readonly a: Pt;
  readonly b: Pt;
  readonly color: number;
  readonly weight: number;
}

/** The object being hatched and the hatch chosen, between the dialog and the clicks. */
export interface HatchJob {
  readonly id: string;
  readonly outline: readonly Pt[];
  readonly hatch: HatchFill;
  readonly name: string;
  /** what one hatch millimetre is in the drawing: the layer's scale for a hatch sized on the page */
  readonly scale: number;
}

let job: HatchJob | null = null;

/** The hatch the Hatch tool places, once Modify > Hatch… has chosen one. */
export function hatchJob(): HatchJob | null {
  return job;
}

export function endHatchJob(): void {
  job = null;
}

/** The closed outline of `shape`, or null when it isn't closed. */
function outlineOf(shape: Shape): Pt[] | null {
  if (shape.kind === "arc") {
    if (!isFullArc(shape) || !shape.center || !shape.rx) return null;
    return ellipsePoints(shape.center, shape.rx, shape.ry ?? shape.rx, shape.startAngle ?? 0, 360, ROUND_STEPS);
  }
  const closed = shape.kind === "rect" || ((shape.kind === "polygon" || shape.kind === "polyline") && shape.closed);
  return closed && shape.points.length >= 3 ? shape.points : null;
}

/** The one selected closed object of the edit scope, with its outline. */
function target(): { id: string; outline: Pt[]; layerId: string } | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1 || store.symbolEdit !== null) return null;
  const [id] = store.selection;
  const o = doc.object(id);
  if (!o?.shape || isDerivedId(id) || o.parentId !== store.editGroupId) return null;
  const outline = outlineOf(o.shape);
  return outline ? { id, outline, layerId: o.layerId } : null;
}

export function canHatch(): boolean {
  return target() !== null;
}

/**
 * The hatch's lines over `outline` (one closed loop), its origin at `origin`, turned `angle`
 * degrees, each hatch millimetre `scale` drawing units: every line cut to the outline (even-odd),
 * then to its dashes. Null when there would be more than `max` pieces.
 */
export function hatchSegments(outline: readonly Pt[], hatch: HatchFill, origin: Pt, angle: number, scale: number, max: number): HatchSegment[] | null {
  const t = (angle * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const turn = (p: Pt): Pt => ({ x: (p.x * cos - p.y * sin) * scale, y: (p.x * sin + p.y * cos) * scale });
  const out: HatchSegment[] = [];
  const m = outline.length;
  for (const fam of hatch.lines) {
    const along = turn(fam.period);
    const period = Math.hypot(along.x, along.y);
    if (!(period > 0) || !(fam.dash > 0)) continue;
    const u = { x: along.x / period, y: along.y / period };
    const n = { x: -u.y, y: u.x };
    const off = turn(fam.offset);
    // how far apart the lines lie, across them
    const step = off.x * n.x + off.y * n.y;
    if (!(Math.abs(step) > 1e-9)) continue;
    const base = turn(fam.base);
    const p0 = { x: origin.x + base.x, y: origin.y + base.y };
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of outline) {
      const k = ((q.x - p0.x) * n.x + (q.y - p0.y) * n.y) / step;
      lo = Math.min(lo, k);
      hi = Math.max(hi, k);
    }
    if (Math.floor(hi) - Math.ceil(lo) > max) return null;
    const dash = Math.min(1, fam.dash) * period;
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
      // line k runs through q along u; its dashes start at q
      const q = { x: p0.x + k * off.x, y: p0.y + k * off.y };
      const at: number[] = [];
      for (let i = 0; i < m; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % m];
        const sa = (a.x - q.x) * n.x + (a.y - q.y) * n.y;
        const sb = (b.x - q.x) * n.x + (b.y - q.y) * n.y;
        // an edge crosses when its ends lie on different sides (a point on the line counts as below it)
        if (sa > 0 === sb > 0) continue;
        const f = sa / (sa - sb);
        at.push((a.x + (b.x - a.x) * f - q.x) * u.x + (a.y + (b.y - a.y) * f - q.y) * u.y);
      }
      at.sort((x, y) => x - y);
      const piece = (s0: number, s1: number): boolean => {
        if (!(s1 - s0 > 1e-9)) return true;
        if (out.length >= max) return false;
        out.push({ a: { x: q.x + u.x * s0, y: q.y + u.y * s0 }, b: { x: q.x + u.x * s1, y: q.y + u.y * s1 }, color: fam.color, weight: fam.weight });
        return true;
      };
      for (let j = 0; j + 1 < at.length; j += 2) {
        const [s0, s1] = [at[j], at[j + 1]];
        if (fam.dash >= 1) {
          if (!piece(s0, s1)) return null;
          continue;
        }
        for (let c = Math.floor(s0 / period); c * period < s1; c++) {
          if (!piece(Math.max(s0, c * period), Math.min(s1, c * period + dash))) return null;
        }
      }
    }
  }
  return out;
}

/** Modify > Hatch…: picks the hatch for the selected closed object; the Hatch tool then takes the clicks. False when given up. */
export async function chooseHatch(): Promise<boolean> {
  const doc = store.session?.doc;
  const t = target();
  if (!doc || !t) {
    toast("Hatch fills one closed object: select a rectangle, polygon, closed polyline, circle or oval.", "info");
    return false;
  }
  const hatches = doc.resources().filter((r) => r.kind === "hatch" && r.hatch);
  if (!hatches.length) {
    toast("The drawing has no hatches: make one in the Resource Manager first.", "info");
    return false;
  }
  const list = h(
    "select",
    { cls: "menu-dialog-input hatch-pick", attrs: { size: String(Math.min(10, Math.max(4, hatches.length))), "aria-label": "Hatches" } },
    ...hatches.map((r) => h("option", { attrs: { translate: "no" }, value: String(r.index), text: r.name })),
  );
  list.value = String(hatches[0].index);
  const preview = h("img", { cls: "hatch-preview", attrs: { alt: "" } });
  let url: string | null = null;
  const show = (): void => {
    const r = hatches.find((x) => String(x.index) === list.value);
    if (url) URL.revokeObjectURL(url);
    url = null;
    if (!r?.hatch) return;
    const pngs = hatchPreviews(doc, r.hatch, r);
    const biggest = [...pngs.keys()].sort((a, b) => b - a)[0];
    const png = biggest === undefined ? undefined : pngs.get(biggest);
    if (png) preview.src = url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  };
  list.addEventListener("change", show);
  show();
  const index = await showDialog<number>({
    title: "Hatches",
    okLabel: "OK",
    body: [
      h("p", { cls: "muted", text: "Choose the hatch, then click in the drawing where it starts and click again to turn it." }),
      h("div", { cls: "hatch-top" }, list, preview),
    ],
    check: () => {
      const v = Number(list.value);
      return Number.isFinite(v) && list.value !== "" ? { value: v } : { error: "Choose a hatch.", focus: list };
    },
  });
  if (url) URL.revokeObjectURL(url);
  if (index === null) return false;
  const r = hatches.find((x) => x.index === index)!;
  const layer = doc.layers().find((l) => l.id === t.layerId);
  const scale = r.hatch!.page && layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
  job = { id: t.id, outline: t.outline, hatch: r.hatch!, name: r.name, scale };
  return true;
}

/** Draws the chosen hatch from `origin`, turned `angle` degrees; the new group is selected. False when it couldn't. */
export function placeHatch(origin: Pt, angle: number): boolean {
  const j = job;
  if (!j) return false;
  const segments = hatchSegments(j.outline, j.hatch, origin, angle, j.scale, MAX_HATCH_LINES);
  if (segments === null) {
    toast(`That hatch would draw more than ${MAX_HATCH_LINES} lines in this object: choose a coarser one.`, "error");
    return false;
  }
  if (segments.length === 0) {
    toast("The hatch draws no lines in this object.", "info");
    return false;
  }
  const r = attempt("Hatch", (s) =>
    s.batch(() => {
      // the lines take the object's place in the stacking, just above it, as a copy of it would
      const ids = s.replaceObjects(s.duplicateObjects([j.id], 0, 0), segments.map((g) => ({ kind: "line", a: g.a, b: g.b })));
      // each line family in its own colour and weight
      const byPen = new Map<string, string[]>();
      segments.forEach((g, i) => {
        const key = `${g.color}:${g.weight}`;
        const family = byPen.get(key);
        if (family) family.push(ids[i]);
        else byPen.set(key, [ids[i]]);
      });
      for (const [key, family] of byPen) {
        const [color, weight] = key.split(":").map(Number);
        s.setAttributes(family, { penFore: color, lineWeight: weight, lineStyle: 2 });
      }
      return ids.length > 1 ? s.groupObjects(ids) : ids[0];
    }),
  );
  if (!r) return false;
  setSelection([r.value]);
  toast(`Hatched with ${j.name}: ${segments.length} line${segments.length === 1 ? "" : "s"} in a group.`, "info");
  return true;
}
