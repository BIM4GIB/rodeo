// Create Labels (Stage > ConnectCAD, and Lighting Paperwork): ready-to-print labels from a worksheet,
// a label for each of its rows, as a label format object ('Rodeo Label Format') on a sheet layer.
// The format lays the labels out on pages side by side; its Object Info sets the page, the layout
// and the label, Update reads the worksheet again, Export to PDF saves the pages, and Edit Label (or
// a double-click) edits what each label shows: text linked to the worksheet's columns ({n} for column
// n), linked QR codes and colour-coded numbers. The Color-Coded Linked Text and Linked QR Code tools
// (labelTools.ts) add those where a label is clicked. Page and label outlines are drawn in the class
// Label Outlines, which the PDF leaves out. labelShapes.ts has the sums.

import type { Attributes, BBox, EditSession, NewShape, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { firstFree, NEW_SHEET } from "../../../app/createViewport.ts";
import { h } from "../../../app/dom.ts";
import { appContext, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { downloadBlob } from "../../../app/fileio.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { exportPdf } from "../../../export/pdf.ts";
import "./connectcad.css";
import {
  ALIGNS,
  CUSTOM_PAGE,
  labelMarks,
  labelPlaces,
  labelRows,
  LABEL_FORMATS,
  LABEL_TYPES,
  PAGE_SIZES,
  pagesFor,
  sheetProblems,
  typeFor,
  type Align,
  type LabelFormat,
  type LabelItem,
  type LabelMark,
  type LabelSheet,
} from "./labelShapes.ts";

export const LABEL_FORMAT = "Rodeo Label Format";
export const OUTLINE_CLASS = "Label Outlines";
/** the gap between pages side by side, mm */
const PAGE_GAP = 20;

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const F = {
  worksheet: "Worksheet",
  skip: "Skip Top Rows",
  type: "Type",
  format: "Format",
  description: "Description",
  pageSize: "Page Size",
  pageWidth: "Page Width",
  pageHeight: "Page Height",
  across: "Labels Across",
  down: "Labels Down",
  offsetX: "Offset X",
  offsetY: "Offset Y",
  left: "Left Margin",
  top: "Top Margin",
  center: "Center on Page",
  labelWidth: "Label Width",
  labelHeight: "Label Height",
  hPitch: "Horizontal Pitch",
  vPitch: "Vertical Pitch",
  copies: "Number of Copies",
  /** what each label shows, as JSON: kept out of Object Info */
  items: "Label Items",
} as const;

interface Rec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function recOf(doc: VwxDocument, id: string): Rec | null {
  const o = doc.object(id);
  const rec = o?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === LABEL_FORMAT) : undefined;
  return rec && o ? { id, layerId: o.layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const num = (v: RecordValue | undefined, or = 0): number => (typeof v === "number" ? v : Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : or);
const ink = (hex: string): number => colorMatcher()({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** Items read from their JSON, anything malformed left out. */
function readItems(text: string): LabelItem[] {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((r): LabelItem[] => {
      if (!r || typeof r !== "object") return [];
      const o = r as Record<string, unknown>;
      const n = (k: string, or = 0): number => (Number.isFinite(Number(o[k])) ? Number(o[k]) : or);
      const at = { x: n("x"), y: n("y") };
      if (o.kind === "text") return [{ kind: "text", ...at, size: n("size", 3), text: String(o.text ?? ""), align: ALIGNS.includes(o.align as Align) ? (o.align as Align) : "left", bold: o.bold === true }];
      if (o.kind === "qr") return [{ kind: "qr", ...at, size: n("size", 15), column: Math.max(1, Math.round(n("column", 1))) }];
      if (o.kind === "color") return [{ kind: "color", ...at, width: n("width", 15), height: n("height", 5), column: Math.max(1, Math.round(n("column", 1))), digits: Math.max(1, Math.round(n("digits", 3))) }];
      return [];
    });
  } catch {
    return [];
  }
}
const itemsText = (items: readonly LabelItem[]): string => JSON.stringify(items.map((it) => Object.fromEntries(Object.entries(it).map(([k, v]) => [k, typeof v === "number" ? round(v) : v]))));

/** A label format object as its fields have it. */
interface Labels {
  readonly rec: Rec;
  readonly worksheet: string;
  readonly skip: number;
  readonly format: string;
  readonly center: boolean;
  readonly sheet: LabelSheet;
  readonly items: LabelItem[];
}

function labelsOf(doc: VwxDocument, id: string): Labels | null {
  const rec = recOf(doc, id);
  if (!rec) return null;
  const v = (f: string, or = 0): number => num(rec.value(f), or);
  return {
    rec,
    worksheet: str(rec.value(F.worksheet)),
    skip: Math.max(0, Math.round(v(F.skip, 1))),
    format: str(rec.value(F.format)),
    center: rec.value(F.center) === true,
    sheet: {
      pageWidth: Math.max(1, v(F.pageWidth, 215.9)),
      pageHeight: Math.max(1, v(F.pageHeight, 279.4)),
      across: Math.max(1, Math.round(v(F.across, 1))),
      down: Math.max(1, Math.round(v(F.down, 1))),
      offsetX: v(F.offsetX),
      offsetY: v(F.offsetY),
      left: v(F.left),
      top: v(F.top),
      labelWidth: Math.max(1, v(F.labelWidth, 50)),
      labelHeight: Math.max(1, v(F.labelHeight, 25)),
      hPitch: v(F.hPitch, 50),
      vPitch: v(F.vPitch, 25),
      copies: Math.max(1, Math.round(v(F.copies, 1))),
    },
    items: readItems(str(rec.value(F.items))),
  };
}

const specsFor = (v: Partial<Record<string, RecordValue>>): PluginFieldSpec[] => [
  { name: F.worksheet, type: TEXT, value: v[F.worksheet] ?? "" },
  { name: F.skip, type: NUMBER, value: v[F.skip] ?? 1 },
  { name: F.type, type: POPUP, value: v[F.type] ?? "Cable" },
  { name: F.format, type: TEXT, value: v[F.format] ?? "" },
  { name: F.description, type: TEXT, value: v[F.description] ?? "" },
  { name: F.pageSize, type: POPUP, value: v[F.pageSize] ?? "Letter" },
  { name: F.pageWidth, type: DIMENSION, value: v[F.pageWidth] ?? 215.9 },
  { name: F.pageHeight, type: DIMENSION, value: v[F.pageHeight] ?? 279.4 },
  { name: F.across, type: NUMBER, value: v[F.across] ?? 3 },
  { name: F.down, type: NUMBER, value: v[F.down] ?? 10 },
  { name: F.offsetX, type: DIMENSION, value: v[F.offsetX] ?? 0 },
  { name: F.offsetY, type: DIMENSION, value: v[F.offsetY] ?? 0 },
  { name: F.left, type: DIMENSION, value: v[F.left] ?? 5 },
  { name: F.top, type: DIMENSION, value: v[F.top] ?? 12 },
  { name: F.center, type: BOOL, value: v[F.center] ?? false },
  { name: F.labelWidth, type: DIMENSION, value: v[F.labelWidth] ?? 66.675 },
  { name: F.labelHeight, type: DIMENSION, value: v[F.labelHeight] ?? 25.4 },
  { name: F.hPitch, type: DIMENSION, value: v[F.hPitch] ?? 69.85 },
  { name: F.vPitch, type: DIMENSION, value: v[F.vPitch] ?? 25.4 },
  { name: F.copies, type: NUMBER, value: v[F.copies] ?? 1 },
  { name: F.items, type: TEXT, value: v[F.items] ?? "[]" },
];

/** A format's fields. */
const formatValues = (f: LabelFormat, worksheet: string): Record<string, RecordValue> => ({
  [F.worksheet]: worksheet,
  [F.type]: f.type,
  [F.format]: f.name,
  [F.description]: f.description,
  [F.pageSize]: f.page,
  [F.pageWidth]: f.pageWidth,
  [F.pageHeight]: f.pageHeight,
  [F.across]: f.across,
  [F.down]: f.down,
  [F.offsetX]: f.offsetX,
  [F.offsetY]: f.offsetY,
  [F.left]: f.left,
  [F.top]: f.top,
  [F.labelWidth]: f.labelWidth,
  [F.labelHeight]: f.labelHeight,
  [F.hPitch]: f.hPitch,
  [F.vPitch]: f.vPitch,
  [F.copies]: f.copies,
  [F.items]: itemsText(f.items),
});

// ---- the worksheet

/** The drawing's worksheets, by name. */
export const worksheetsIn = (doc: VwxDocument): { index: number; name: string }[] => doc.resources().flatMap((r) => (r.kind === "worksheet" ? [{ index: r.index, name: r.name }] : []));

/** A worksheet's rows as they show, its database rows (which list objects and aren't read) left empty; null when there's none of that name. */
export function worksheetRows(doc: VwxDocument, name: string): { rows: string[][]; databaseRows: number } | null {
  const sheet = worksheetsIn(doc).find((w) => w.name === name);
  if (!sheet) return null;
  const c = doc.worksheetContents(sheet.index);
  if (!c) return { rows: [], databaseRows: 0 };
  const rows = Array.from({ length: c.rows }, () => Array.from({ length: c.cols }, () => ""));
  for (const cell of c.cells) {
    if (c.database[cell.row] || cell.row >= c.rows || cell.col >= c.cols) continue;
    rows[cell.row][cell.col] = cell.display || (cell.value === null ? "" : String(cell.value));
  }
  return { rows, databaseRows: c.database.filter(Boolean).length };
}

// ---- drawing

/** Page `k`'s top left in a label object's frame: side by side from its insertion (its top centre, when centred on it). */
const pageOrigin = (l: Labels, k: number): Pt => ({ x: (l.center ? -l.sheet.pageWidth / 2 : 0) + k * (l.sheet.pageWidth + PAGE_GAP), y: 0 });

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The labels' rows now: the worksheet's, past its top rows; and how many pages they take. */
function rowsOf(doc: VwxDocument, l: Labels): { rows: string[][]; pages: number; missing: boolean; databaseRows: number } {
  const data = worksheetRows(doc, l.worksheet);
  const rows = data ? labelRows(data.rows, l.skip) : [];
  return { rows, pages: pagesFor(l.sheet, rows.length), missing: !data, databaseRows: data?.databaseRows ?? 0 };
}

function outlineClass(s: EditSession): number {
  return s.doc.classes().find((c) => c.name === OUTLINE_CLASS)?.index ?? s.createClass(OUTLINE_CLASS);
}

/** Draws label format `id` from its worksheet, in the session's open batch: its pages, labels and what they show. */
function drawLabels(s: EditSession, id: string): { labels: number; pages: number } {
  const l = labelsOf(s.doc, id);
  if (!l) throw new Error("That isn't a label format.");
  const { rows, pages, missing } = rowsOf(s.doc, l);
  const sh = l.sheet;
  const grey = ink("#9a9a9a");
  const black = ink("#000000");
  // outlines: each page, and every label place on it
  const outlines: NewShape[] = [];
  const outlineLooks: Partial<Attributes>[] = [];
  for (let k = 0; k < pages; k++) {
    const o = pageOrigin(l, k);
    outlines.push({ kind: "polygon", points: rect(o.x, o.y, o.x + sh.pageWidth, o.y - sh.pageHeight), closed: true } as NewShape);
    outlineLooks.push({ penFore: grey, fillPattern: 0, lineWeight: 5 });
    for (let j = 0; j < sh.across * sh.down; j++) {
      const x = o.x + sh.left + sh.offsetX + (j % sh.across) * sh.hPitch;
      const y = o.y - (sh.top + sh.offsetY + Math.floor(j / sh.across) * sh.vPitch);
      outlines.push({ kind: "polygon", points: rect(x, y, x + sh.labelWidth, y - sh.labelHeight), closed: true } as NewShape);
      outlineLooks.push({ penFore: grey, fillPattern: 0, lineWeight: 2, lineStyle: 2 });
    }
  }
  if (missing) {
    const o = pageOrigin(l, 0);
    outlines.push({ kind: "text", at: { x: o.x + sh.pageWidth / 2, y: o.y + 4 }, text: `No worksheet named ${l.worksheet || "(none)"}`, height: 4, hAlign: 2, vAlign: 4, angle: 0 } as NewShape);
    outlineLooks.push({ penFore: ink("#cf222e"), fillPattern: 0 });
  }
  // the labels
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  const bold: number[] = [];
  for (const p of labelPlaces(sh, rows.length)) {
    const o = pageOrigin(l, p.page);
    const at = (x: number, y: number): Pt => ({ x: o.x + p.x + x, y: o.y - p.y - y });
    for (const m of labelMarks(l.items, rows[p.row])) {
      if (m.kind === "text") {
        if (m.bold) bold.push(shapes.length);
        shapes.push({ kind: "text", at: at(m.x, m.y), text: m.text, height: m.size, hAlign: m.align === "center" ? 2 : m.align === "right" ? 3 : 1, vAlign: 1, angle: 0 } as NewShape);
        looks.push({ penFore: ink(m.ink), fillPattern: 0 });
      } else if (m.kind === "box") {
        shapes.push({ kind: "polygon", points: rect(at(m.x0, 0).x, at(0, m.y0).y, at(m.x1, 0).x, at(0, m.y1).y), closed: true } as NewShape);
        looks.push({ penFore: black, lineWeight: 2, fillPattern: 1, fillFore: ink(m.fill), fillBack: ink(m.fill), fillOpacity: 100 });
      } else {
        shapes.push({ kind: "polygon", points: m.back.map((q) => at(q.x, q.y)), closed: true } as NewShape);
        looks.push({ penFore: ink("#ffffff"), lineWeight: 0, fillPattern: 1, fillFore: ink("#ffffff"), fillBack: ink("#ffffff"), fillOpacity: 100 });
        shapes.push({ kind: "polygon", points: m.dark.map((q) => at(q.x, q.y)), closed: true } as NewShape);
        looks.push({ penFore: black, lineWeight: 0, fillPattern: 1, fillFore: black, fillBack: black, fillOpacity: 100 });
      }
    }
  }
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const drawnOutlines = s.addObjects(l.rec.layerId, outlines, outlineClass(s), outlineLooks);
  const drawn = shapes.length ? s.addObjects(l.rec.layerId, shapes, classIndex, looks) : [];
  const boldIds = bold.map((i) => drawn[i]).filter(Boolean);
  if (boldIds.length) s.setTextStyle(boldIds, { bold: true });
  s.setPluginDrawing(id, [...drawnOutlines, ...drawn]);
  return { labels: labelPlaces(sh, rows.length).length, pages };
}

/** Sets the fields that differ, in the session's open batch. */
function write(s: EditSession, r: Rec, values: Readonly<Record<string, RecordValue>>): void {
  for (const [field, value] of Object.entries(values)) if (r.value(field) !== value) s.setRecordField(r.id, r.format, field, value);
}

/** A new label format on a sheet layer, a page's top left at `at`, drawn from `worksheet`; as part of a batch, its id. */
export function addLabels(s: EditSession, layerId: string, at: Pt, format: LabelFormat, worksheet: string): string {
  s.growPluginFields(LABEL_FORMAT, specsFor({}));
  const specs = specsFor(formatValues(format, worksheet));
  const id = s.addPluginObject(layerId, LABEL_FORMAT, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  drawLabels(s, id);
  return id;
}

/** The label formats on a layer, and where a point falls in one of their labels: its id and the point from the label's top left (y down). */
export function labelCellAt(doc: VwxDocument, layerId: string, p: Pt): { id: string; x: number; y: number; width: number; height: number } | null {
  for (const o of doc.objects(layerId)) {
    const l = o.type === PLUGIN ? labelsOf(doc, o.id) : null;
    if (!l) continue;
    const at = o.insertion ?? { x: 0, y: 0 };
    const sh = l.sheet;
    const { pages } = rowsOf(doc, l);
    for (let k = 0; k < pages; k++) {
      const pg = pageOrigin(l, k);
      for (let j = 0; j < sh.across * sh.down; j++) {
        const x = p.x - (at.x + pg.x + sh.left + sh.offsetX + (j % sh.across) * sh.hPitch);
        const y = at.y + pg.y - (sh.top + sh.offsetY + Math.floor(j / sh.across) * sh.vPitch) - p.y;
        if (x >= 0 && y >= 0 && x <= sh.labelWidth && y <= sh.labelHeight) return { id: o.id, x, y, width: sh.labelWidth, height: sh.labelHeight };
      }
    }
  }
  return null;
}

/** Adds an item to label format `id` and draws it again, as one undo step. */
export function addLabelItem(id: string, item: LabelItem): boolean {
  return !!attempt("Add Label Item", (s) =>
    s.batch(() => {
      const l = labelsOf(s.doc, id);
      if (!l) throw new Error("That isn't a label format.");
      write(s, l.rec, { [F.items]: itemsText([...l.items, item]) });
      drawLabels(s, id);
    }),
  );
}

/** The worksheet's header names of label format `id`, for choosing columns: "1 Number"… */
export function columnNamesOf(doc: VwxDocument, id: string): string[] {
  const l = labelsOf(doc, id);
  const data = l ? worksheetRows(doc, l.worksheet) : null;
  const head = data?.rows[Math.max(0, (l?.skip ?? 1) - 1)] ?? [];
  return head.map((c, i) => `${i + 1} ${c.trim()}`.trim());
}

// ---- Export to PDF

/** Saves label format `id`'s pages as a PDF, a page each, without their outlines. */
export function exportLabelsPdf(id: string): void {
  const s = store.session;
  const l = s ? labelsOf(s.doc, id) : null;
  const o = s?.doc.object(id);
  if (!s || !l || !o) return;
  const { pages } = rowsOf(s.doc, l);
  const at = o.insertion ?? { x: 0, y: 0 };
  const outline = s.doc.classes().find((c) => c.name === OUTLINE_CLASS)?.index;
  const views = Array.from({ length: pages }, (_, k) => {
    const pg = pageOrigin(l, k);
    const box: BBox = { x0: at.x + pg.x, y0: at.y + pg.y - l.sheet.pageHeight, x1: at.x + pg.x + l.sheet.pageWidth, y1: at.y + pg.y };
    return { layers: [{ id: o.layerId, ghosted: false }], classes: new Map(outline === undefined ? [] : [[outline, "hidden" as const]]), box, scale: 1 };
  });
  const bytes = exportPdf(s.doc, { layerIds: [], views });
  downloadBlob(`${(l.format || "Labels").replace(/[\\/:*?"<>|]+/g, "-")} labels.pdf`, new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
  toast(`Export to PDF: ${pages} page${pages > 1 ? "s" : ""} of labels saved.`, "info");
}

// ---- the preview, as SVG

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A label drawn as SVG markup, `px` wide, for the Create Labels preview. */
export function previewSvg(f: Pick<LabelFormat, "labelWidth" | "labelHeight" | "items">, row: readonly string[], px = 280): string {
  const k = px / f.labelWidth;
  const pts = (list: readonly Pt[]): string => list.map((p) => `${(p.x * k).toFixed(1)},${(p.y * k).toFixed(1)}`).join(" ");
  const mark = (m: LabelMark): string => {
    if (m.kind === "text") {
      const anchor = m.align === "center" ? "middle" : m.align === "right" ? "end" : "start";
      return `<text x="${(m.x * k).toFixed(1)}" y="${((m.y + m.size * 0.8) * k).toFixed(1)}" font-size="${(m.size * k).toFixed(1)}" font-family="Helvetica, Arial, sans-serif" font-weight="${m.bold ? 700 : 400}" fill="${m.ink}" text-anchor="${anchor}">${esc(m.text)}</text>`;
    }
    if (m.kind === "box") return `<rect x="${(m.x0 * k).toFixed(1)}" y="${(m.y0 * k).toFixed(1)}" width="${((m.x1 - m.x0) * k).toFixed(1)}" height="${((m.y1 - m.y0) * k).toFixed(1)}" fill="${m.fill}" stroke="#000" stroke-width="0.5"/>`;
    return `<polygon points="${pts(m.back)}" fill="#fff"/><polygon points="${pts(m.dark)}" fill="#000" fill-rule="nonzero"/>`;
  };
  const w = (f.labelWidth * k).toFixed(1);
  const hgt = (f.labelHeight * k).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><rect x="0.5" y="0.5" width="${Number(w) - 1}" height="${Number(hgt) - 1}" rx="4" fill="#fff" stroke="#999"/>${labelMarks(f.items, row).map(mark).join("")}</svg>`;
}

// ---- Create Labels

/** Create Labels: a worksheet, the label formats to use and a sheet layer; a label format object for each format, drawn from the worksheet's rows. */
export async function createLabels(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const sheets = worksheetsIn(doc);
  if (!sheets.length) {
    toast("This drawing has no worksheet: make one with a report command (Stage > ConnectCAD's reports, say) first.", "info");
    return;
  }
  const sheetLayers = doc.layers().filter((l) => l.kind === "sheet");
  const worksheet = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Worksheet" } }, ...sheets.map((w) => h("option", { value: w.name, text: w.name })));
  // the newest worksheet, a report just run say
  worksheet.value = sheets.reduce((a, b) => (b.index > a.index ? b : a)).name;
  const uses = LABEL_FORMATS.map((f) => h("input", { attrs: { type: "checkbox", "aria-label": `Use ${f.name}` } }) as HTMLInputElement);
  const preview = h("div", { cls: "ccad-label-preview" });
  const note = h("p", { cls: "muted" });
  const output = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Sheet Layer" } },
    ...sheetLayers.map((l) => h("option", { value: l.id, text: l.name })),
    h("option", { value: NEW_SHEET, text: "New Sheet Layer" }),
  );
  output.value = NEW_SHEET;
  const pdf = h("input", { attrs: { type: "checkbox", "aria-label": "Save as PDF too" } }) as HTMLInputElement;
  let touched = false;
  const data = (): string[][] => worksheetRows(doc, worksheet.value)?.rows ?? [];
  const pickDefault = (): void => {
    if (touched) return;
    const type = typeFor(data()[0] ?? []);
    const first = LABEL_FORMATS.findIndex((f) => f.type === type);
    uses.forEach((u, i) => (u.checked = i === first));
  };
  const show = (): void => {
    const i = uses.findIndex((u) => u.checked);
    const rows = labelRows(data(), 1);
    preview.innerHTML = i >= 0 ? previewSvg(LABEL_FORMATS[i], rows[0] ?? []) : "";
    const f = LABEL_FORMATS[i];
    const db = worksheetRows(doc, worksheet.value)?.databaseRows ?? 0;
    note.textContent = f
      ? `${rows.length} row${rows.length === 1 ? "" : "s"} below the header: ${rows.length * f.copies} ${f.name} label${rows.length * f.copies === 1 ? "" : "s"} on ${pagesFor(f, rows.length)} page${pagesFor(f, rows.length) === 1 ? "" : "s"}.${db ? ` Its ${db} database row${db > 1 ? "s" : ""}, which list objects, can't be read yet.` : ""}`
      : "Choose a label format.";
  };
  pickDefault();
  show();
  worksheet.addEventListener("change", () => {
    pickDefault();
    show();
  });
  for (const u of uses)
    u.addEventListener("change", () => {
      touched = true;
      show();
    });
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const chosen = await showDialog<{ worksheet: string; formats: LabelFormat[]; sheet: string; pdf: boolean }>({
    title: "Cable Labels",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      field("Worksheet", worksheet),
      h(
        "div",
        { cls: "ccad-scroll" },
        h(
          "table",
          { cls: "ccad-table" },
          h("thead", {}, h("tr", {}, ...["Use", "Format", "Description", "Type"].map((t) => h("th", { text: t })))),
          h("tbody", {}, ...LABEL_FORMATS.map((f, i) => h("tr", {}, h("td", {}, uses[i]), h("td", { text: f.name }), h("td", { text: f.description }), h("td", { text: f.type })))),
        ),
      ),
      preview,
      note,
      field("Sheet Layer", output),
      h("label", { cls: "menu-dialog-check" }, pdf, "Save as PDF too"),
      h("p", { cls: "muted", text: "Each format used becomes a label format object on the sheet layer, a label for each of the worksheet's rows below its header. Edit its page and labels in the Object Info palette, and what each label shows with Edit Label." }),
    ],
    check: () => {
      const formats = LABEL_FORMATS.filter((_, i) => uses[i].checked);
      if (!formats.length) return { error: "Choose a label format to use.", focus: uses[0] };
      return { value: { worksheet: worksheet.value, formats, sheet: output.value, pdf: pdf.checked } };
    },
  });
  if (!chosen) return;
  const r = attempt("Create Labels", (s) =>
    s.batch(() => {
      const layerId = chosen.sheet === NEW_SHEET ? s.createLayer(firstFree("Labels", new Set(s.doc.layers().map((l) => l.name))), "sheet") : chosen.sheet;
      let y = 0;
      const ids = chosen.formats.map((f) => {
        const id = addLabels(s, layerId, { x: 0, y }, f, chosen.worksheet);
        y -= f.pageHeight + 2 * PAGE_GAP;
        return id;
      });
      return { layerId, ids };
    }),
  );
  if (!r) return;
  const s = store.session!;
  setActiveLayer(r.value.layerId);
  setSelection(r.value.ids);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  const counts = r.value.ids.map((id) => {
    const l = labelsOf(s.doc, id)!;
    const { rows, pages } = rowsOf(s.doc, l);
    return `${rows.length * l.sheet.copies} ${l.format} label${rows.length * l.sheet.copies === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}`;
  });
  toast(`Create Labels: ${counts.join("; ")}, on ${s.doc.layers().find((l) => l.id === r.value.layerId)?.name ?? "the sheet layer"}.`, "info");
  if (chosen.pdf) for (const id of r.value.ids) exportLabelsPdf(id);
}

// ---- Edit Label

interface ItemRow {
  readonly el: HTMLTableRowElement;
  read(): LabelItem | null;
}

/** Edit Label: what each label of format `id` shows, a row an item. */
export async function editLabel(id: string): Promise<void> {
  const s = store.session;
  const l = s ? labelsOf(s.doc, id) : null;
  if (!s || !l) return;
  const rows: ItemRow[] = [];
  const body = h("tbody");
  const input = (value: string | number, label: string, wide = false): HTMLInputElement => h("input", { cls: `menu-dialog-input${wide ? "" : " ccad-num"}`, value: String(value), attrs: { type: "text", "aria-label": label } }) as HTMLInputElement;
  const cell = (el: HTMLElement | null): HTMLTableCellElement => h("td", {}, el ?? h("span", { text: "" }));
  const addRow = (it: LabelItem): void => {
    const n = rows.length + 1;
    const content = input(it.kind === "text" ? it.text : it.column, `Content of item ${n}`, it.kind === "text");
    const x = input(round(it.x), `X of item ${n}`);
    const y = input(round(it.y), `Y of item ${n}`);
    const size = input(round(it.kind === "color" ? it.height : it.size), `Size of item ${n}`);
    const width = it.kind === "color" ? input(round(it.width), `Width of item ${n}`) : null;
    const digits = it.kind === "color" ? input(it.digits, `Digits of item ${n}`) : null;
    const bold = it.kind === "text" ? (h("input", { checked: it.bold, attrs: { type: "checkbox", "aria-label": `Bold item ${n}` } }) as HTMLInputElement) : null;
    const align = it.kind === "text" ? (h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Align item ${n}` } }, ...ALIGNS.map((a) => h("option", { value: a, text: a }))) as HTMLSelectElement) : null;
    if (align && it.kind === "text") align.value = it.align;
    const gone = h("input", { attrs: { type: "checkbox", "aria-label": `Delete item ${n}` } }) as HTMLInputElement;
    const kind = it.kind === "text" ? "Text" : it.kind === "qr" ? "QR Code" : "Color Code";
    const el = h("tr", {}, h("td", { text: kind }), cell(content), cell(x), cell(y), cell(size), cell(width), cell(digits), cell(bold), cell(align), cell(gone)) as HTMLTableRowElement;
    body.append(el);
    const f = (i: HTMLInputElement | null, or: number): number => (i && Number.isFinite(parseFloat(i.value)) ? parseFloat(i.value) : or);
    rows.push({
      el,
      read: () => {
        if (gone.checked) return null;
        const at = { x: f(x, 0), y: f(y, 0) };
        if (it.kind === "text") return { kind: "text", ...at, size: Math.max(0.5, f(size, it.size)), text: content.value, align: (align?.value as Align) ?? "left", bold: !!bold?.checked };
        const column = Math.max(1, Math.round(f(content, it.column)));
        if (it.kind === "qr") return { kind: "qr", ...at, size: Math.max(2, f(size, it.size)), column };
        return { kind: "color", ...at, height: Math.max(0.5, f(size, it.height)), width: Math.max(1, f(width, it.width)), digits: Math.max(1, Math.round(f(digits, it.digits))), column };
      },
    });
  };
  l.items.forEach(addRow);
  const w = l.sheet.labelWidth;
  const add = (label: string, make: () => LabelItem): HTMLElement => {
    const b = h("button", { cls: "menu-dialog-button", text: label, attrs: { type: "button" } });
    b.addEventListener("click", () => addRow(make()));
    return b;
  };
  const columns = columnNamesOf(s.doc, id);
  const items = await showDialog<LabelItem[]>({
    title: `Edit Label: ${l.format || "Label Format"}`,
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h(
        "div",
        { cls: "ccad-scroll" },
        h(
          "table",
          { cls: "ccad-table" },
          h("thead", {}, h("tr", {}, ...["Item", "Text / Column", "X", "Y", "Size", "Width", "Digits", "Bold", "Align", "Delete"].map((t) => h("th", { text: t })))),
          body,
        ),
      ),
      h(
        "div",
        { cls: "ccad-actions" },
        add("Add Text", () => ({ kind: "text", x: 2.5, y: 2.5, size: 3, text: "{1}", align: "left", bold: false })),
        add("Add QR Code", () => ({ kind: "qr", x: Math.max(0, w - 2.5 - 15), y: 2.5, size: 15, column: 1 })),
        add("Add Color Code", () => ({ kind: "color", x: 2.5, y: 2.5, width: 15, height: 5, column: 1, digits: 3 })),
      ),
      h("p", { cls: "muted", text: `In mm from the label's top left (${round(l.sheet.labelWidth)} × ${round(l.sheet.labelHeight)}). A text's {n} shows column n of the row; a QR code and a color code show a column's value.${columns.length ? ` Columns: ${columns.join(", ")}.` : ""}` }),
    ],
    check: () => ({ value: rows.map((r) => r.read()).filter((it): it is LabelItem => it !== null) }),
  });
  if (!items) return;
  attempt("Edit Label", (session) =>
    session.batch(() => {
      write(session, l.rec, { [F.items]: itemsText(items) });
      drawLabels(session, id);
    }),
  );
}

// ---- the driver

const UPDATE = 30;
const PDF = 31;
const EDIT = 32;
const param = (id: number, field: string, level = 0): PluginWidget => ({ id, kind: "param", field, label: "", level });

const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "divider", label: "General", level: 0 },
  param(2, F.worksheet),
  param(3, F.skip),
  { id: UPDATE, kind: "button", label: "Update", level: 0 },
  { id: PDF, kind: "button", label: "Export to PDF…", level: 0 },
  { id: EDIT, kind: "button", label: "Edit Label…", level: 0 },
  param(4, F.type),
  param(5, F.format),
  param(6, F.description),
  { id: 10, kind: "divider", label: "Page", level: 0 },
  param(11, F.pageSize),
  param(12, F.pageWidth, 1),
  param(13, F.pageHeight, 1),
  { id: 20, kind: "divider", label: "Layout", level: 0 },
  param(21, F.across),
  param(22, F.down),
  param(23, F.offsetX),
  param(24, F.offsetY),
  param(25, F.left),
  param(26, F.top),
  param(27, F.center),
  { id: 40, kind: "divider", label: "Label", level: 0 },
  param(41, F.labelWidth),
  param(42, F.labelHeight),
  param(43, F.hPitch),
  param(44, F.vPitch),
  param(45, F.copies),
];

/** An Object Info edit: a named page size brings its width and height, then the labels are drawn again. */
function editLabels(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Label Format", (s) =>
    s.batch(() => {
      const l = labelsOf(s.doc, id);
      if (!l) throw new Error("That isn't a label format.");
      const next: Record<string, RecordValue> = { ...values };
      const size = F.pageSize in values ? PAGE_SIZES.find((p) => p.name === str(values[F.pageSize])) : undefined;
      if (size) Object.assign(next, { [F.pageWidth]: size.width, [F.pageHeight]: size.height });
      else if ((F.pageWidth in values || F.pageHeight in values) && !(F.pageSize in values)) next[F.pageSize] = CUSTOM_PAGE;
      write(s, l.rec, next);
      drawLabels(s, id);
      const problems = sheetProblems(labelsOf(s.doc, id)!.sheet);
      if (problems.length) toast(`${problems.join("; ")}.`, "info");
    }),
  );
}

function update(id: string): void {
  const r = attempt("Update Labels", (s) => s.batch(() => drawLabels(s, id)));
  if (r) toast(`Update: ${r.value.labels} label${r.value.labels === 1 ? "" : "s"} on ${r.value.pages} page${r.value.pages === 1 ? "" : "s"}.`, "info");
}

const driver: PluginDriver = {
  name: LABEL_FORMAT,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: () => false,
  choices: (field) =>
    field === F.type ? LABEL_TYPES.map((value) => ({ value, label: value })) : field === F.pageSize ? [...PAGE_SIZES.map((p) => p.name), CUSTOM_PAGE].map((value) => ({ value, label: value })) : undefined,
  place: () => toast("Make labels with Create Labels, in Stage > ConnectCAD or Lighting Paperwork.", "info"),
  edit: (id, values) => editLabels(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawLabels(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const s = store.session;
    const l = s ? labelsOf(s.doc, id) : null;
    if (!l) return;
    const custom = str(l.rec.value(F.pageSize)) === CUSTOM_PAGE;
    apply(
      new Map([
        [12, { enabled: custom, visible: true }],
        [13, { enabled: custom, visible: true }],
      ]),
    );
  },
  press(id, widget) {
    if (widget === UPDATE) update(id);
    else if (widget === PDF) exportLabelsPdf(id);
    else if (widget === EDIT) void editLabel(id);
  },
  open: (id) => void editLabel(id),
};

registerPluginDrivers(() => [driver]);
