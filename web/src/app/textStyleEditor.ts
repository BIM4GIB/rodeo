// Resources > Edit Text Style, New Text Style and Duplicate Text Style: a text style's name, font,
// size in points and alignment, as Vectorworks' Text Style dialog sets them. A sample line follows
// every change, and the style's own previews (its font's "ABCD", "abcd" and "0123", as Vectorworks
// draws them) are drawn anew on OK. Editing a style restyles the texts that follow it, in the same
// undo step.

import type { ResourceInfo, TextStyleSpec, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { type PreviewSize, previewPngs, previewSizes } from "./resourcePreview.ts";
import { store } from "./state.ts";
import { H_ALIGN, V_ALIGN, fontChoices } from "./textMenu.ts";
import "./resourceEditor.css";

/** the lines a text style's previews show */
const SAMPLE_LINES = ["ABCD", "abcd", "0123"];
/** share of a preview's width the widest sample line spans, of its height a line's pitch, and of the pitch the font's size */
const PREVIEW_FILL = 0.85;
const PREVIEW_PITCH = 0.32;
const PREVIEW_EM = 0.8;

function cssFont(px: number, font: string): string {
  return `${px}px "${font.replace(/"/g, "")}", Arial, sans-serif`;
}

/** Paints the sample lines centred in `font`, as large as the canvas holds them. */
function paintSample(canvas: HTMLCanvasElement, font: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.font = cssFont(100, font);
  const widest = Math.max(...SAMPLE_LINES.map((l) => ctx.measureText(l).width));
  const pitch = height * PREVIEW_PITCH;
  const px = Math.min((width * PREVIEW_FILL * 100) / Math.max(widest, 1), pitch * PREVIEW_EM);
  ctx.font = cssFont(px, font);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  SAMPLE_LINES.forEach((line, i) => ctx.fillText(line, width / 2, height / 2 + (i - 1) * pitch));
}

/** The preview sizes: the style's own or the drawing's text styles', else those of the hatches and gradients a first one is built on. */
function sizesFor(doc: VwxDocument, own?: ResourceInfo): readonly PreviewSize[] {
  if (own || doc.resources().some((r) => r.kind === "text-style")) return previewSizes(doc, "text-style", own);
  const byWidth = new Map<number, PreviewSize>();
  for (const z of [...previewSizes(doc, "hatch"), ...previewSizes(doc, "gradient")]) if (!byWidth.has(z.width)) byWidth.set(z.width, z);
  return [...byWidth.values()];
}

/** A text style's previews in `font`. */
export function textStylePreviews(doc: VwxDocument, font: string, own?: ResourceInfo): Map<number, Uint8Array> {
  return previewPngs(sizesFor(doc, own), (c) => paintSample(c, font));
}

/** New Text Style…: the drawing's first font at 12 points, top left. */
export function newTextStyle(): Promise<void> {
  const font = store.session?.doc.fonts().find((f) => f !== "") ?? "Arial";
  return openEditor(null, "Text Style", { font, points: 12, hAlign: 1, vAlign: 1 });
}

/** Edit Text Style…: the text style with name index `index`. */
export function editTextStyle(index: number): Promise<void> {
  const res = textStyle(index);
  const spec = res && specOf(res);
  return spec ? openEditor(index, res.name, spec) : Promise.resolve();
}

/** Duplicate…: a copy of the text style to change. */
export function duplicateTextStyle(index: number): Promise<void> {
  const res = textStyle(index);
  const spec = res && specOf(res);
  return spec ? openEditor(null, res.name, spec, index) : Promise.resolve();
}

/** True when the text style's record can be read, so it can be edited here. */
export function canEditTextStyle(index: number): boolean {
  const res = textStyle(index);
  return !!res && !!specOf(res);
}

function textStyle(index: number): ResourceInfo | undefined {
  return store.session?.doc.resources().find((r) => r.kind === "text-style" && r.index === index);
}

function specOf(res: ResourceInfo): TextStyleSpec | null {
  const def = res.textStyle;
  const font = def && store.session?.doc.fonts()[def.fontIndex];
  return def && font ? { font, points: def.points, hAlign: def.hAlign, vAlign: def.vAlign } : null;
}

/** The dialog: `index` is the text style edited (null for a new one); `like`, the one a duplicate copies. */
async function openEditor(index: number | null, name: string, start: TextStyleSpec, like?: number): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const taken = new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.stories().map((s) => s.name),
    ...doc.resources().filter((r) => r.index !== index).map((r) => r.name),
  ]);
  let firstName = name;
  if (index === null) {
    const base = like === undefined ? name : name.replace(/-\d+$/, "");
    let n = like === undefined ? 1 : 2;
    while (taken.has(`${base}-${n}`)) n++;
    firstName = `${base}-${n}`;
  }
  const spec = { ...start };

  const select = (label: string, options: readonly { value: string; label: string }[], value: string): HTMLSelectElement => {
    const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
    el.value = value;
    return el;
  };
  const field = (label: string, input: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const { own, common } = fontChoices();
  const fonts = [...new Set([...own, ...common, start.font])];
  const nameInput = h("input", { cls: "menu-dialog-input re-name", value: firstName, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const fontSelect = select("Font", fonts.map((f) => ({ value: f, label: f })), start.font);
  const shownSize = String(Math.round(start.points * 100) / 100);
  const sizeInput = h("input", { cls: "menu-dialog-input", value: shownSize, attrs: { type: "text", inputmode: "decimal", "aria-label": "Size (pt)", spellcheck: "false" } });
  const hSelect = select("Horizontal alignment", H_ALIGN, String(start.hAlign));
  const vSelect = select("Vertical alignment", V_ALIGN, String(start.vAlign));
  const bar = h("canvas", { cls: "re-bar re-line ts-sample", attrs: { "aria-label": "Sample", role: "img" } });

  const redraw = (): void => {
    const dpr = window.devicePixelRatio || 1;
    bar.width = Math.max(1, Math.round(bar.clientWidth * dpr));
    bar.height = Math.max(1, Math.round(bar.clientHeight * dpr));
    const ctx = bar.getContext("2d");
    if (!ctx) return;
    const pad = 8 * dpr;
    ctx.clearRect(0, 0, bar.width, bar.height);
    ctx.font = cssFont(Math.round(bar.height * 0.5), spec.font);
    ctx.fillStyle = getComputedStyle(bar).color || "#000000";
    ctx.textBaseline = "middle";
    ctx.textAlign = spec.hAlign === 2 ? "center" : spec.hAlign === 3 ? "right" : "left";
    const x = spec.hAlign === 2 ? bar.width / 2 : spec.hAlign === 3 ? bar.width - pad : pad;
    ctx.fillText(SAMPLE_LINES.join(" "), x, bar.height / 2);
  };
  fontSelect.addEventListener("change", () => {
    spec.font = fontSelect.value;
    redraw();
  });
  hSelect.addEventListener("change", () => {
    spec.hAlign = Number(hSelect.value);
    redraw();
  });
  vSelect.addEventListener("change", () => {
    spec.vAlign = Number(vSelect.value);
  });

  const result = showDialog<{ name: string; spec: TextStyleSpec }>({
    title: index === null ? (like === undefined ? "New Text Style" : "Duplicate Text Style") : `Edit Text Style: ${name}`,
    okLabel: "OK",
    cls: "re-dialog",
    body: [
      field("Name", nameInput),
      bar,
      field("Font", fontSelect),
      field("Size (pt)", sizeInput),
      field("Horizontal", hSelect),
      field("Vertical", vSelect),
      h("p", { cls: "muted", text: index === null ? "Texts follow it from the Text menu or Object Info." : "Texts that follow it take the changes; a size scales theirs." }),
    ],
    check: () => {
      const n = nameInput.value.trim();
      if (!n) return { error: "Enter a name for the text style.", focus: nameInput };
      if ((index === null || n !== name) && taken.has(n)) return { error: `"${n}" is already used in this drawing.`, focus: nameInput };
      // a size left as shown keeps its exact value
      const points = sizeInput.value === shownSize ? start.points : Number(sizeInput.value.trim().replace(",", "."));
      if (!(points > 0 && points < 7200)) return { error: "The size takes a number of points above 0.", focus: sizeInput };
      return { value: { name: n, spec: { ...spec, points } } };
    },
  });
  requestAnimationFrame(redraw);
  nameInput.focus();
  nameInput.select();
  const value = await result;
  if (!value) return;
  const ownRes = doc.resources().find((r) => r.kind === "text-style" && r.index === (index ?? like));
  const pngs = textStylePreviews(doc, value.spec.font, ownRes);
  if (index === null) {
    attempt(like === undefined ? "New text style" : "Duplicate text style", (s) => s.createTextStyle(value.name, value.spec, pngs, like));
    return;
  }
  attempt("Edit text style", (s) =>
    s.batch(() => {
      s.editTextStyle(index, value.spec, pngs);
      if (value.name !== name) s.renameResource(index, value.name);
    }),
  );
}
