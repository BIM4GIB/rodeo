// The Gel and Paint Matrix (Stage > Lighting): what scenic paint looks like under each gel the plot uses, as a grid
// of swatches, each paint on top and its lit colour below. Paints are the solid fills of the selected objects plus
// any added here (those are kept in the drawing); gels are the colours the instruments use plus any added here.
// gelMatrix.ts works out each cell. These are RGB estimates, not spectral figures.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { naturalCompare } from "../fixture.ts";
import { colorOf, GELS, gelOf, hexOf, type Rgb } from "../gels.ts";
import { fixtures } from "../instrument.ts";
import { readShow, writeShow } from "../show.ts";
import { csvText, downloadText, noteLine, openPanel, type OpenPanel } from "../ui.ts";
import { matrix, type Cell, type Paint } from "./gelMatrix.ts";

/** the show key the paints added here are kept under */
const PAINTS_KEY = "looks.paints";

/** a paint added here: its name and colour as "#rrggbb" */
interface AddedPaint {
  readonly name: string;
  readonly hex: string;
}

/** a paint to list: from the selection (added: null) or from the show (added: its place in the show's list) */
interface Row {
  readonly paint: Paint;
  readonly added: number | null;
}

/** gels added in this window, beyond the plot's own */
let extraGels: string[] = [];
let panel: OpenPanel | null = null;
let grid: HTMLElement | null = null;

/** The solid fills of the selected objects, one paint per colour. */
function selectionPaints(): Paint[] {
  const s = store.session;
  if (!s) return [];
  const byIndex = new Map(s.doc.colors().map((c) => [c.index, c] as const));
  const seen = new Map<string, Paint>();
  for (const id of store.selection) {
    const obj = s.doc.object(id);
    const a = obj?.attrs;
    if (!obj || !a || a.fillPattern !== 1) continue;
    const colour = byIndex.get(a.fillFore);
    if (!colour) continue;
    const hex = colour.css.toLowerCase();
    if (!seen.has(hex)) seen.set(hex, { name: colour.name || obj.name || hex, rgb: colorOf(hex) });
  }
  return [...seen.values()];
}

/** The paints added in this drawing. */
function addedPaints(): AddedPaint[] {
  const v = readShow<AddedPaint[]>(PAINTS_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** Every paint to list: the selection's, then those added. */
function rows(): Row[] {
  return [
    ...selectionPaints().map((paint): Row => ({ paint, added: null })),
    ...addedPaints().map((p, i): Row => ({ paint: { name: p.name, rgb: colorOf(p.hex) }, added: i })),
  ];
}

/** The Color fields the plot uses (blank for open white first), then the gels added here. */
function gelsNow(): string[] {
  const used = [...new Set(fixtures().map((f) => f.color))].sort((a, b) => Number(a !== "") - Number(b !== "") || naturalCompare(a, b));
  return [...used, ...extraGels.filter((g) => !used.includes(g))];
}

/** A Color field as a heading reads: each gel by its number and name. */
function gelLabel(code: string): string {
  if (!code) return "Open white";
  return code
    .split("+")
    .map((part) => {
      const g = gelOf(part);
      return g ? `${g.code} ${g.name}` : part.trim();
    })
    .join(" + ");
}

function chip(rgb: Rgb): HTMLElement {
  const el = h("span", { cls: "looks-chip" });
  el.style.background = hexOf(rgb);
  return el;
}

function removeButton(label: string, run: () => void): HTMLButtonElement {
  const b = h("button", { cls: "btn looks-x", text: "×", title: label, attrs: { type: "button", "aria-label": label } });
  b.addEventListener("click", run);
  return b;
}

function cellTd(paint: Paint, gel: string, cell: Cell): HTMLElement {
  const top = h("span");
  top.style.background = hexOf(paint.rgb);
  const bottom = h("span");
  bottom.style.background = hexOf(cell.lit);
  const title = `${paint.name} under ${gelLabel(gel)}: lit ${hexOf(cell.lit)}. Brightness lost ${Math.round(cell.loss * 100)}%. Hue turns ${Math.round(cell.hueShift)} degrees.`;
  return h(
    "td",
    { cls: cell.flag ? `looks-cell ${cell.flag}` : "looks-cell", title },
    h("span", { cls: "looks-split" }, top, bottom),
    cell.flag ? h("span", { cls: "looks-tag", text: cell.flag }) : null,
  );
}

/** Draws the grid: a row per paint, a column per gel. */
function renderGrid(box: HTMLElement): void {
  if (!store.session) {
    box.replaceChildren(noteLine("Open a drawing to see its paints and gels."));
    return;
  }
  const paints = rows();
  if (!paints.length) {
    box.replaceChildren(noteLine("Select objects with a solid fill to use their colours as paints, or add a paint below."));
    return;
  }
  const gels = gelsNow();
  const cells = matrix(
    paints.map((r) => r.paint),
    gels,
  );
  const head = h(
    "tr",
    {},
    h("th", { attrs: { scope: "col" }, text: "Paint" }),
    ...gels.map((code) =>
      h("th", { attrs: { scope: "col" } }, gelLabel(code), extraGels.includes(code) ? removeButton(`Remove ${gelLabel(code)}`, () => removeGel(code)) : null),
    ),
  );
  const lines = paints.map((row, i) =>
    h(
      "tr",
      {},
      h("th", { attrs: { scope: "row" } }, chip(row.paint.rgb), h("span", { cls: "looks-paint-name", text: row.paint.name }), row.added !== null ? removeButton(`Remove ${row.paint.name}`, () => removePaint(row.added!)) : null),
      ...gels.map((gel, j) => cellTd(row.paint, gel, cells[i][j])),
    ),
  );
  const note = gels.length ? null : noteLine("The plot has no coloured instruments yet. Add a gel below to see the paints under it.", "th-warn");
  box.replaceChildren(
    ...[note, h("div", { cls: "looks-grid-wrap" }, h("table", { cls: "looks-grid" }, h("thead", {}, head), h("tbody", {}, ...lines)))].filter((n): n is HTMLElement => n !== null),
  );
}

function redraw(): void {
  if (grid) renderGrid(grid);
}

let redrawQueued = false;
/** The selection or drawing changed: the grid is drawn once the drawing's own listeners have cleared their reads. */
function onChange(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  queueMicrotask(() => {
    redrawQueued = false;
    redraw();
  });
}

function addPaint(colour: HTMLInputElement, name: HTMLInputElement): void {
  if (!store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  const hex = colour.value.toLowerCase();
  const label = name.value.trim() || hex;
  if (writeShow("Add Paint", PAINTS_KEY, [...addedPaints(), { name: label, hex }])) name.value = "";
}

function removePaint(index: number): void {
  writeShow(
    "Remove Paint",
    PAINTS_KEY,
    addedPaints().filter((_, i) => i !== index),
  );
}

function addGel(code: string): void {
  if (gelsNow().some((g) => g === code || gelOf(g)?.code === code)) {
    toast(`${code} is already a column.`, "info");
    return;
  }
  extraGels = [...extraGels, code];
  redraw();
}

function removeGel(code: string): void {
  extraGels = extraGels.filter((g) => g !== code);
  redraw();
}

/** Export CSV: one line per paint under each gel. */
function exportCsv(): void {
  const paints = rows();
  const gels = gelsNow();
  if (!store.session || !paints.length || !gels.length) {
    toast("There are no paints and gels to export yet.", "info");
    return;
  }
  const cells = matrix(
    paints.map((r) => r.paint),
    gels,
  );
  const lines: (string | number)[][] = [];
  paints.forEach((row, i) =>
    gels.forEach((gel, j) => {
      const cell = cells[i][j];
      lines.push([row.paint.name, hexOf(row.paint.rgb), gelLabel(gel), hexOf(cell.lit), Math.round(cell.loss * 100), Math.round(cell.hueShift), cell.flag]);
    }),
  );
  downloadText("gel-and-paint-matrix.csv", csvText(["Paint", "Paint colour", "Gel", "Lit colour", "Brightness lost (%)", "Hue turn (degrees)", "Flag"], lines), "text/csv");
}

function button(label: string, run: () => void): HTMLButtonElement {
  const b = h("button", { cls: "btn", text: label, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
}

/** Stage > Lighting > Gel and Paint Matrix…: opens the matrix in a window, or brings the open one forward. */
export function openGelMatrix(): void {
  if (panel) {
    document.body.append(panel.element);
    return;
  }
  if (!store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  grid = h("div", { cls: "looks-grid-box" });
  const colour = h("input", { cls: "looks-colour", value: "#cc8844", attrs: { type: "color", "aria-label": "Paint colour" } });
  const paintName = h("input", { cls: "th-cell looks-paint-name-input", attrs: { type: "text", placeholder: "Paint name", "aria-label": "Paint name" } });
  const gelPick = h(
    "select",
    { cls: "looks-gel-pick", attrs: { "aria-label": "Gel" } },
    ...GELS.map((g) => h("option", { text: `${g.code} ${g.name}`, attrs: { value: g.code } })),
  );
  const content = h(
    "div",
    { cls: "looks-matrix" },
    noteLine("These are RGB estimates, not spectral figures. Test swatches under the real light before you commit to a paint."),
    grid,
    h("div", { cls: "th-toolbar looks-add" }, h("span", { cls: "looks-add-label", text: "Add paint" }), colour, paintName, button("Add", () => addPaint(colour, paintName))),
    h("div", { cls: "th-toolbar looks-add" }, h("span", { cls: "looks-add-label", text: "Add gel" }), gelPick, button("Add", () => addGel(gelPick.value))),
  );
  const stop = store.on(["selection", "session"], onChange);
  panel = openPanel({
    key: "looksGelMatrix",
    title: "Gel and Paint Matrix",
    body: content,
    width: 760,
    height: 540,
    actions: [{ label: "Export CSV", run: exportCsv }],
    onClose: () => {
      stop();
      panel = null;
      grid = null;
    },
  });
  redraw();
}
