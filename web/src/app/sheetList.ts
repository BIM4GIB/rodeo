// Tools > Reports > Create Sheet List…, as Vectorworks has it: the drawing's title block borders
// listed by sheet number and title, those wanted moved to the Proposed Sheet List (Add >, < Remove,
// New… for an entry of one's own, Move Up and Move Dn) and edited there, and Format… choosing a
// text block or a worksheet. A text block is placed by clicking the top left and bottom right
// corners of its area, its entries wrapped to that width as the text is drawn, a long title's
// continued lines indented under it; a worksheet is made from one the drawing has and opened in
// the worksheet editor. Vectorworks doesn't say what else Format sets, so it takes a heading and
// the text's size; Rodeo can't place a worksheet on the drawing itself.

import type { NewSheetCell, Pt, VwxDocument } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { CHAR_WIDTH } from "./markerShapes.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { store } from "./state.ts";
import { FONT } from "./textPaint.ts";
import { mmPerPt } from "./textMenu.ts";
import { dataRecord, findTitleBlocks, SHEET_DATA } from "./titleBlockData.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import "./sheetList.css";

/** A line of the list: a sheet's number and title, and the title block it came from (none for a New one). */
export interface SheetEntry {
  no: string;
  title: string;
  readonly from: string | null;
}

export interface SheetListFormat {
  /** a text block placed by two clicks, or a worksheet */
  as: "text" | "worksheet";
  /** over the entries; empty for none */
  heading: string;
  /** points */
  size: number;
}

/** the Format settings last chosen, kept for the next time */
const format: SheetListFormat = { as: "text", heading: "SHEET INDEX", size: 10 };

export const sheetListFormat = (): Readonly<SheetListFormat> => format;

/** between a sheet's number and its title in a text block */
const GAP = "   ";
const NAME = "Sheet List";
/** the size lines are measured at, scaled to the text's */
const SAMPLE_PX = 100;

const text = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** The drawing's title blocks as entries, sheets first in their order: their sheet data's number and title, or their layer's. */
export function titleBlockEntries(doc: VwxDocument): SheetEntry[] {
  const layers = new Map(doc.layers().map((l) => [l.id, l]));
  return findTitleBlocks(doc).map((b) => {
    const data = dataRecord(doc, b.id, SHEET_DATA);
    const field = (name: string): string => text(data?.fields.find((f) => f.name === name)?.value);
    const layer = layers.get(b.layerId);
    return {
      no: field("Sheet Number") || (b.sheet ? (layer?.name ?? "") : ""),
      title: field("Sheet Title") || (b.sheet ? (layer?.title ?? "") : (layer?.name ?? "")),
      from: b.id,
    };
  });
}

/** how far a line of the list runs, in drawing units, at its text size */
export type Measure = (line: string) => number;

/** `text` broken at spaces into lines no wider than `width`; a word longer than a line stands alone. */
function wrap(text: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

/** The text block's lines: the heading, a blank line, then each entry wrapped to `width`. */
export function sheetListLines(entries: readonly SheetEntry[], heading: string, width: number, measure: Measure): string[] {
  const lines = heading ? [heading, ""] : [];
  const space = measure(" ") || 1;
  for (const e of entries) {
    // the title wraps beside its number, continued lines indented by spaces as wide as the number
    const lead = e.no && e.title ? `${e.no}${GAP}` : "";
    const pad = " ".repeat(Math.round(measure(lead) / space));
    wrap(e.title || e.no, width - measure(lead), measure).forEach((l, i) => lines.push((i ? pad : lead) + l));
  }
  return lines;
}

/** Measures lines as the renderer draws a text in no font of its own at `height`, or estimates from their length without a canvas. */
function measurer(height: number): Measure {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (line) => line.length * CHAR_WIDTH * height;
  ctx.font = `${SAMPLE_PX}px ${FONT}`;
  return (line) => (ctx.measureText(line).width * height) / SAMPLE_PX;
}

/** The worksheet: a heading row, Sheet No. and Title, then a row an entry. */
export function sheetListRows(entries: readonly SheetEntry[], heading: string): (NewSheetCell | null)[][] {
  return [
    ...(heading ? [[{ value: heading, bold: true }, null]] : []),
    [
      { value: "Sheet No.", bold: true },
      { value: "Title", bold: true },
    ],
    ...entries.map((e) => [{ value: e.no }, { value: e.title }]),
  ];
}

/** The Sheet List Index Preferences: Format… in the dialog. */
async function formatDialog(canSheet: boolean): Promise<void> {
  const v = await toolPrefs(
    "Sheet List Index Preferences",
    [
      {
        kind: "choice",
        key: "as",
        label: "Create as",
        value: canSheet ? format.as : "text",
        options: [
          { value: "text", label: "Text Block" },
          ...(canSheet ? [{ value: "worksheet", label: "Worksheet" }] : []),
        ],
      },
      { kind: "text", key: "heading", label: "Heading", value: format.heading },
      { kind: "number", key: "size", label: "Text Size", value: format.size, min: 1, max: 200, unit: "pt" },
    ],
    canSheet ? "A text block is placed by two clicks; a worksheet opens in the worksheet editor." : "A worksheet is made from one the drawing has, and this drawing has none yet.",
  );
  if (!v) return;
  format.as = v.choice("as") === "worksheet" ? "worksheet" : "text";
  format.heading = v.choice("heading").trim();
  format.size = v.num("size");
}

/** The New List Entry dialog: a sheet number and title of one's own. */
async function newEntry(): Promise<SheetEntry | null> {
  const v = await toolPrefs("New List Entry", [
    { kind: "text", key: "no", label: "Sheet No.", value: "" },
    { kind: "text", key: "title", label: "Title", value: "" },
  ]);
  if (!v) return null;
  const e = { no: v.choice("no").trim(), title: v.choice("title").trim(), from: null };
  return e.no || e.title ? e : null;
}

/** The Create Sheet List dialog; the proposed entries, or null when cancelled. */
async function sheetListDialog(doc: VwxDocument, canSheet: boolean): Promise<SheetEntry[] | null> {
  const available = titleBlockEntries(doc);
  const proposed: SheetEntry[] = [];
  const label = (e: SheetEntry): string => [e.no, e.title].filter(Boolean).join("  ") || "(blank)";
  const list = (name: string): HTMLSelectElement => h("select", { cls: "sl-list", attrs: { size: "10", "aria-label": name } });
  const left = list("Title Block Entries");
  const right = list("Proposed Sheet List");
  // the whole of the title block entry picked, which the list may cut off
  const shown = h("span", { cls: "sl-shown muted" });
  const no = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "Sheet No." } });
  const title = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "Title" } });
  const fill = (sel: HTMLSelectElement, entries: readonly SheetEntry[], at: number): void => {
    sel.replaceChildren(...entries.map((e, i) => h("option", { text: label(e), attrs: { value: String(i) } })));
    if (entries.length) sel.selectedIndex = Math.max(0, Math.min(at, entries.length - 1));
  };
  const picked = (): SheetEntry | undefined => proposed[right.selectedIndex];
  const refresh = (): void => {
    const a = available[left.selectedIndex];
    shown.textContent = a ? label(a) : "";
    const p = picked();
    no.value = p?.no ?? "";
    title.value = p?.title ?? "";
    no.disabled = title.disabled = !p;
  };
  const redraw = (l: number, r: number): void => {
    fill(left, available, l);
    fill(right, proposed, r);
    refresh();
  };
  const button = (text: string, run: () => void | Promise<void>): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text, attrs: { type: "button" } });
    b.addEventListener("click", () => void run());
    return b;
  };
  const add = (): void => {
    const i = left.selectedIndex;
    if (i < 0) return;
    proposed.push(...available.splice(i, 1));
    redraw(i, proposed.length - 1);
  };
  const remove = (): void => {
    const i = right.selectedIndex;
    if (i < 0) return;
    const [e] = proposed.splice(i, 1);
    // back to the title blocks' list in their order; a New one goes
    if (e.from) {
      const order = titleBlockEntries(doc).map((x) => x.from);
      const at = available.findIndex((x) => order.indexOf(x.from) > order.indexOf(e.from));
      available.splice(at < 0 ? available.length : at, 0, e);
    }
    redraw(left.selectedIndex, i);
  };
  const move = (by: -1 | 1): void => {
    const i = right.selectedIndex;
    const j = i + by;
    if (i < 0 || j < 0 || j >= proposed.length) return;
    [proposed[i], proposed[j]] = [proposed[j], proposed[i]];
    redraw(left.selectedIndex, j);
  };
  const edit = (): void => {
    const p = picked();
    if (!p) return;
    p.no = no.value;
    p.title = title.value;
    const o = right.options[right.selectedIndex];
    if (o) o.textContent = label(p);
  };
  left.addEventListener("change", refresh);
  left.addEventListener("dblclick", add);
  right.addEventListener("change", refresh);
  no.addEventListener("input", edit);
  title.addEventListener("input", edit);
  redraw(0, 0);
  const buttons = h(
    "div",
    { cls: "sl-buttons" },
    button("Add >", add),
    button("< Remove", remove),
    button("New…", async () => {
      const e = await newEntry();
      if (!e) return;
      proposed.push(e);
      redraw(left.selectedIndex, proposed.length - 1);
    }),
    button("Move Up", () => move(-1)),
    button("Move Dn", () => move(1)),
    button("Format…", () => formatDialog(canSheet)),
  );
  return showDialog<SheetEntry[]>({
    title: "Create Sheet List",
    cls: "sl-dialog",
    okLabel: "OK",
    body: [
      h(
        "div",
        { cls: "sl-lists" },
        h("label", { cls: "sl-col" }, "Title Block Entries", left, shown),
        buttons,
        h(
          "div",
          { cls: "sl-col" },
          h("label", { cls: "sl-col" }, "Proposed Sheet List", right),
          h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Sheet No." }), no),
          h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Title" }), title),
        ),
      ),
    ],
    check: () => (proposed.length ? { value: proposed.map((e) => ({ ...e })) } : { error: "Add a title block or a New entry to the Proposed Sheet List.", focus: left }),
  });
}

/** A name for the worksheet no resource or layer has. */
function freeName(doc: VwxDocument): string {
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.layers().map((l) => l.name)]);
  if (!taken.has(NAME)) return NAME;
  for (let n = 2; ; n++) if (!taken.has(`${NAME} ${n}`)) return `${NAME} ${n}`;
}

/** The text block over the area two corners span, on the active layer, selected. */
function placeText(entries: readonly SheetEntry[], a: Pt, b: Pt): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const height = format.size * mmPerPt(layerId);
  const width = Math.abs(b.x - a.x);
  const lines = sheetListLines(entries, format.heading, width, measurer(height));
  const at = { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) };
  const r = attempt("Create Sheet List", (s) => s.addObject(layerId, { kind: "text", at, text: lines.join("\n"), height, hAlign: 1, vAlign: 1 }, store.activeClassIndex));
  if (r) setEditGroup(null, [r.value]);
}

/** The corners' rectangle, drawn while the second is chosen. */
const box = (a: Pt, b: Pt): Pt[] => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];

/** Tools > Reports > Create Sheet List…: the dialog, then the text block's two clicks or the worksheet. */
export async function createSheetList(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc || !store.activeLayerId) return;
  const canSheet = doc.resources().some((r) => r.kind === "worksheet");
  const entries = await sheetListDialog(doc, canSheet);
  if (!entries) return;
  if (format.as === "worksheet" && canSheet) {
    const made = attempt("Create Sheet List", (s) => s.createWorksheet({ name: freeName(s.doc), widths: [72, 288], rowHeight: 14, rows: sheetListRows(entries, format.heading) }));
    if (!made) return;
    toast(`Sheet list: ${entries.length} ${entries.length === 1 ? "sheet" : "sheets"} in a worksheet.`, "info");
    const { editWorksheet } = await import("./worksheetEditor.ts");
    await editWorksheet(made.value);
    return;
  }
  const what = "Sheet List";
  placeAtNextClick({
    what,
    hint: "Create Sheet List: click the top left corner of the sheet list's area · Esc cancels",
    place: (a) => {
      placeAtNextClick({
        what,
        hint: "Create Sheet List: click the bottom right corner; the entries wrap to its width · Esc cancels",
        preview: (b) => [{ kind: "polyline", points: box(a, b), closed: true }],
        place: (b) => {
          if (Math.abs(b.x - a.x) < 1e-6) {
            toast("Click the second corner across from the first: the sheet list wraps to the width between them.", "info");
            return;
          }
          placeText(entries, a, b);
        },
      });
    },
  });
}

/** True when the drawing has a layer to put a sheet list on. */
export const canCreateSheetList = (): boolean => !!store.session && !!store.activeLayerId;
