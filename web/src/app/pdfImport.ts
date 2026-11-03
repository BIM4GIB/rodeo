// File > Import PDF…: places one page of a PDF on the active layer as vector objects, as
// Vectorworks' Import PDF gives once its page is ungrouped. The page's line work and fills become
// lines and polygons (holes and all) in the drawing's nearest colours at their line weights, and
// its text becomes text objects, grouped and centred in the view at the page's paper size at the
// chosen scale, in one undo step. The reading is in import/pdf.ts; pictures, shadings and
// clipping are left out, as the summary says. File > Import > Import Metafile… (emfImport.ts) places
// what it reads the same way.

import type { Attributes, NewShape, Pt } from "../core/index.ts";
import { MAX_NESTED_SUBPATHS, openPdf, type PdfColor, type PdfFile, type PdfPage } from "../import/pdf.ts";
import { attempt, setEditGroup, zoomToSelection } from "./commands.ts";
import { fileIn } from "./ext.ts";
import { h, nextPaint } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { layerInfo, store } from "./state.ts";
import { joinHoles } from "./surfaces.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

const MM_PER_POINT = 25.4 / 72;
const MILS_PER_POINT = 1000 / 72;
/** the thinnest pen a PDF line gets, mils (a width of 0 is the device's thinnest line) */
const MIN_WEIGHT = 2;
/** a page that would make more objects than this is refused */
const MAX_OBJECTS = 100_000;

/** True when there is a drawing and an active layer to import a `noun` ("PDF") into; otherwise says why. */
export function ready(noun = "PDF"): boolean {
  const s = store.session;
  if (!s) {
    toast(`Open a drawing before importing a ${noun}.`, "info");
    return false;
  }
  if (store.activeLayerId === null) {
    toast(`Choose a layer to import the ${noun} into.`, "info");
    return false;
  }
  if (!s.canAdd("polygon")) {
    toast(`This drawing has no polygon to copy settings from yet, so a ${noun} can't be imported into it.`, "info");
    return false;
  }
  return true;
}

/** File > Import PDF…: asks for a PDF file and imports a page of it. */
export function importPdfFile(scene: Scene, view: View): void {
  if (!ready()) return;
  const input = h("input", { attrs: { type: "file", accept: "application/pdf,.pdf" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void importPdf(file, scene, view);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/**
 * A PDF dropped on the window, or chosen: asks which page and at what scale, then imports it.
 * `answer`, when given, is used instead of asking (the Agents panel); what it leaves out is the
 * question's default.
 */
export async function importPdf(file: File, scene: Scene, view: View, answer?: Partial<PdfChoice>): Promise<void> {
  if (!ready()) return;
  let pdf: PdfFile;
  try {
    pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    fileIn(file, file.name, errorMessage(err));
    return;
  }
  const scale = layerScale();
  const choice = answer
    ? answered(answer, pdf.pages, scale)
    : await askPage(pdf.pages, scale, "Import PDF", "The page is placed at its paper size at this scale, centred in the view, as a group. Pictures, shadings and clipping are left out.");
  if (!choice) return;
  let page: PdfPage;
  try {
    await nextPaint();
    page = await pdf.page(choice.page);
  } catch (err) {
    toast(`Could not read page ${choice.page + 1} of ${file.name}: ${errorMessage(err)}`);
    fileIn(file, file.name, `page ${choice.page + 1}: ${errorMessage(err)}`);
    return;
  }
  place(page, choice, `page ${choice.page + 1} of ${file.name}`, "Import PDF", scene, view);
  fileIn(file, file.name);
}

/** The active design layer's scale, the scale a picture is placed at unless another is chosen. */
export function layerScale(): number {
  const layer = store.activeLayerId ? layerInfo(store.activeLayerId) : null;
  return layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
}

export interface PdfChoice {
  /** 0-based */
  readonly page: number;
  readonly scale: number;
  readonly lines: boolean;
  readonly text: boolean;
}

/** An answer given in advance, checked as the dialog checks it; a bad one is said and refused. */
function answered(a: Partial<PdfChoice>, pages: number, scale: number): PdfChoice | null {
  const page = a.page ?? 0;
  if (!(Number.isInteger(page) && page >= 0 && page < pages)) {
    toast(`Page: the PDF has pages 1 to ${pages}.`);
    return null;
  }
  const s = a.scale ?? scale;
  if (!(Number.isFinite(s) && s > 0 && s <= 100000)) {
    toast("Scale: a positive number.");
    return null;
  }
  const lines = a.lines ?? true;
  const text = (a.text ?? true) && !!store.session?.canAdd("text");
  if (!lines && !text) {
    toast("Choose line work, text or both.");
    return null;
  }
  return { page, scale: s, lines, text };
}

/** The import dialog: the page (when there are several), the scale, and line work, text or both. */
export function askPage(pages: number, scale: number, title: string, note: string): Promise<PdfChoice | null> {
  const field = (label: string, control: HTMLElement, unit = ""): HTMLElement =>
    h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: label }),
      control,
      unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
    );
  const check = (label: string): [HTMLElement, HTMLInputElement] => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: true });
    return [h("label", { cls: "menu-dialog-check" }, box, h("span", { text: label })), box];
  };
  const page = h("input", { cls: "menu-dialog-input", value: "1", attrs: { type: "text", inputmode: "numeric", "aria-label": "Page" } });
  const ratio = h("input", { cls: "menu-dialog-input", value: String(scale), attrs: { type: "text", inputmode: "decimal", "aria-label": "Scale" } });
  const [linesRow, lines] = check("Line work and fills");
  const [textRow, text] = check("Text");
  if (!store.session?.canAdd("text")) {
    text.checked = false;
    text.disabled = true;
  }
  return showDialog<PdfChoice>({
    title,
    okLabel: "Import",
    body: [
      pages > 1 ? field("Page", page, `of ${pages}`) : null,
      field("Scale 1:", ratio),
      linesRow,
      textRow,
      h("p", { cls: "muted", text: note }),
    ].filter((n): n is HTMLElement => n !== null),
    check: () => {
      const n = Number(page.value.trim());
      if (!(Number.isInteger(n) && n >= 1 && n <= pages)) return { error: `Page: enter a page from 1 to ${pages}.`, focus: page };
      const s = Number(ratio.value.trim().replace(",", "."));
      if (!(Number.isFinite(s) && s > 0 && s <= 100000)) return { error: "Scale: enter a positive number.", focus: ratio };
      if (!lines.checked && !text.checked) return { error: "Choose line work, text or both.", focus: lines };
      return { value: { page: n - 1, scale: s, lines: lines.checked, text: text.checked } };
    },
  });
}

/** The drawing's colour nearest each PDF colour (channels 0..1), by palette index. */
export function colorMatcher(): (c: PdfColor) => number {
  const doc = store.session?.doc;
  const palette = (doc?.colors() ?? [])
    .map((c) => {
      const n = /^#([0-9a-f]{6})/i.exec(c.css);
      return n ? { index: c.index, r: parseInt(n[1].slice(0, 2), 16), g: parseInt(n[1].slice(2, 4), 16), b: parseInt(n[1].slice(4, 6), 16) } : null;
    })
    .filter((c) => c !== null);
  const seen = new Map<string, number>();
  return (c) => {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    const key = `${r},${g},${b}`;
    let best = seen.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 0;
      for (const p of palette) {
        const e = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2;
        if (e < d) {
          d = e;
          best = p.index;
        }
      }
      seen.set(key, best);
    }
    return best;
  };
}

/** Twice a ring's signed area. */
function area2(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a;
}

function inside(p: Pt, ring: readonly Pt[]): boolean {
  let on = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) on = !on;
  }
  return on;
}

/** The points without repeats, and without the closing point a closed ring repeats. */
function tidy(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) out.push(p);
  }
  if (closed && out.length > 2) {
    const a = out[0];
    const z = out[out.length - 1];
    if (Math.abs(a.x - z.x) < 1e-9 && Math.abs(a.y - z.y) < 1e-9) out.pop();
  }
  return out;
}

/** Filled rings as polygons: each outer ring with the holes directly inside it. */
export function fillShapes(rings: Pt[][]): { points: Pt[]; holes: boolean }[] {
  if (rings.length === 1 || rings.length > MAX_NESTED_SUBPATHS) return rings.map((points) => ({ points, holes: false }));
  const sized = rings.map((points) => ({ points, size: Math.abs(area2(points)), depth: 0, parent: -1 })).sort((a, b) => b.size - a.size);
  for (let i = 0; i < sized.length; i++) {
    // the smallest ring holding this one is the one checked last
    for (let j = i - 1; j >= 0; j--) {
      if (inside(sized[i].points[0], sized[j].points)) {
        sized[i].parent = j;
        sized[i].depth = sized[j].depth + 1;
        break;
      }
    }
  }
  const out: { points: Pt[]; holes: boolean }[] = [];
  sized.forEach((r, i) => {
    if (r.depth % 2 === 1) return;
    const holes = sized.filter((x) => x.parent === i && x.depth % 2 === 1).map((x) => x.points);
    out.push({ points: holes.length ? joinHoles(r.points, holes) : r.points, holes: holes.length > 0 });
  });
  return out;
}

/**
 * Places `page` on the active layer as `choice` says, grouped, in one undo step named `command`;
 * `source` names what was read in the summary ("page 2 of plan.pdf").
 */
export function place(page: PdfPage, choice: PdfChoice, source: string, command: string, scene: Scene, view: View): void {
  const layerId = store.activeLayerId;
  const session = store.session;
  if (!layerId || !session) return;
  const k = MM_PER_POINT * choice.scale;
  const ox = view.cx - (page.width * k) / 2;
  const oy = view.cy - (page.height * k) / 2;
  const world = (p: Pt): Pt => ({ x: ox + p.x * k, y: oy + p.y * k });
  const colorOf = colorMatcher();
  const shapes: NewShape[] = [];
  const attrs: Partial<Attributes>[] = [];
  const add = (shape: NewShape, a: Partial<Attributes>): void => {
    shapes.push(shape);
    attrs.push(a);
  };
  const noPen: Partial<Attributes> = { lineStyle: 0 };
  const noFill: Partial<Attributes> = { fillPattern: 0 };

  if (choice.lines) {
    for (const path of page.paths) {
      const pen: Partial<Attributes> = path.stroke
        ? { lineStyle: 2, lineWeight: Math.max(MIN_WEIGHT, Math.round(path.width * MILS_PER_POINT)), penFore: colorOf(path.stroke), penOpacity: 100 }
        : noPen;
      const fill: Partial<Attributes> = path.fill ? { fillPattern: 1, fillFore: colorOf(path.fill), fillBack: colorOf(path.fill), fillOpacity: 100 } : noFill;
      const strokes = (): void => {
        for (const s of path.subpaths) {
          const pts = tidy(s.points.map(world), s.closed);
          if (pts.length === 2 && !s.closed) add({ kind: "line", a: pts[0], b: pts[1] }, { ...pen, ...noFill });
          else if (pts.length >= 2) add({ kind: "polygon", points: pts, closed: s.closed && pts.length >= 3 }, { ...pen, ...noFill });
        }
      };
      if (!path.fill) {
        strokes();
        continue;
      }
      const rings = path.subpaths.map((s) => tidy(s.points.map(world), true)).filter((r) => r.length >= 3);
      const polys = fillShapes(rings);
      // a pen would draw the cuts that join a hole to its outline, so holed fills take their outlines apart
      const holed = path.stroke !== null && polys.some((p) => p.holes);
      for (const p of polys) add({ kind: "polygon", points: p.points, closed: true }, holed ? { ...noPen, ...fill } : { ...pen, ...fill });
      if (holed) strokes();
    }
  }
  if (choice.text && session.canAdd("text")) {
    for (const t of page.texts) {
      const text = t.text.trim();
      if (!text) continue;
      const lead = t.text.length - t.text.trimStart().length;
      // leading spaces move the start along the baseline
      const shift = lead * 0.25 * t.size;
      const u = { x: Math.cos((t.angle * Math.PI) / 180), y: Math.sin((t.angle * Math.PI) / 180) };
      add(
        {
          kind: "text",
          at: world({ x: t.at.x + u.x * shift, y: t.at.y + u.y * shift }),
          text,
          height: t.size * k,
          hAlign: 1,
          vAlign: 2,
          angle: Math.round(t.angle * 100) / 100,
        },
        { penFore: colorOf(t.color), penOpacity: 100, ...noFill },
      );
    }
  }

  const left = Object.entries(page.skipped).filter(([, n]) => n > 0);
  const leftOut = left.length ? `; left out ${left.map(([kind, n]) => `${n} ${kind}`).join(", ")}` : "";
  if (shapes.length === 0) {
    toast(`Nothing to import in ${source}${leftOut}.`, "info");
    return;
  }
  if (shapes.length > MAX_OBJECTS) {
    toast(`Too many objects: ${source} would make ${shapes.length} (at most ${MAX_OBJECTS}); import its line work or its text alone.`);
    return;
  }
  const r = attempt(command, (s) =>
    s.batch(() => {
      const ids = s.addObjects(layerId, shapes, store.activeClassIndex, attrs);
      return ids.length < 2 ? ids[0] : s.groupObjects(ids);
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  zoomToSelection(scene, view);
  toast(`Imported ${source}: ${shapes.length} ${shapes.length === 1 ? "object" : "objects"}${leftOut}.`, "info");
}
