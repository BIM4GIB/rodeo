// Stage > Venue > Linesets…: the fly lines as an editable table (height, batten, capacity, trims, kind, what's
// hung, its weight, cloth) with each one's load and flags, and a hang plot of them in the same window. Add
// One and Add Many… make linesets; Draw on Plan draws each batten across the stage at its height, replacing
// what it drew before; a clicked row lights its batten in the plan. Saved in the drawing as Linesets.

import { appContext, onDocument, registerOverlay } from "../../../app/ext.ts";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { parseLength } from "../../../app/units.ts";
import type { Pt } from "../../../core/index.ts";
import { fixtures } from "../instrument.ts";
import { readShow, writeShow, writeShowIn } from "../show.ts";
import { fromStage, type StageFrame } from "../stage.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { LINESETS_KEY, VENUE_KEY, type Lineset, type LinesetKind, type VenueInfo } from "../showTypes.ts";
import { csvOf, dataTable, downloadText, openPanel, tabs, type Column } from "../ui.ts";
import { kindOf, LINESET_KINDS, linesetProblems, newLinesets, type LinesetCheck } from "./linesets.ts";
import { activeScale, LABEL_PAPER_MM } from "./venueDraw.ts";
import "./venue.css";

/** the show key of the battens drawn on the plan (object ids), and the window's key */
const DRAWING_KEY = "venue.linesetDrawing";
const WINDOW = "venue.linesets";

/** each kind's colour in the hang plot: solid and distinct */
const KIND_COLOUR: Readonly<Record<LinesetKind, string>> = {
  empty: "#8c8c8c",
  electric: "#e0a100",
  border: "#2b7fe0",
  leg: "#8e44d8",
  drop: "#2a9d5c",
  scenery: "#d9534f",
  truss: "#00a3a3",
};

/** the highlight of a clicked lineset in the plan */
const HIGHLIGHT = "rgba(255, 122, 0, 0.95)";

/** what the Add dialogs start from, kept for the session */
const addDefaults = { count: 5, firstUp: 500, spacing: 200, batten: 12000, capacity: 500 };

interface Row {
  readonly ls: Lineset;
  readonly check: LinesetCheck;
}

let selected: string | null = null;
let shown: ReturnType<typeof tabs> | null = null;
let table: { readonly element: HTMLElement; refresh(): void } | null = null;
let plotHolder: HTMLElement | null = null;

const units = (): string | undefined => store.session?.doc.info.units;
const linesets = (): Lineset[] => readShow<Lineset[]>(LINESETS_KEY, []);
const venueInfo = (): VenueInfo | null => readShow<VenueInfo | null>(VENUE_KEY, null);

function rowsNow(): Row[] {
  const list = linesets();
  const checks = linesetProblems(list, fixtures(), venueInfo());
  return list.map((ls, i) => ({ ls, check: checks[i] }));
}

/** Brings the open window's table and hang plot up to date with the drawing. */
function refreshAll(): void {
  table?.refresh();
  if (plotHolder?.isConnected) plotHolder.replaceChildren(hangPlot(linesets(), venueInfo()));
  appContext()?.requestDraw();
}

/** Changes one lineset's fields as one undo step. */
function change(id: string, label: string, patch: Partial<Lineset>): void {
  writeShow(label, LINESETS_KEY, linesets().map((l) => (l.id === id ? { ...l, ...patch } : l)));
  refreshAll();
}

/** A length cell, shown and typed in the drawing's units, kept in mm. */
function lengthColumn(label: string, pick: (l: Lineset) => number, set: (mm: number) => Partial<Lineset>, width = 92): Column<Row> {
  return {
    label,
    width,
    value: (r) => lengthText(pick(r.ls)),
    edit: (r, text) => {
      const mm = parseLength(text, units());
      if (mm === null || mm < 0) {
        toast(`"${text}" isn't a length.`, "info");
        refreshAll();
        return;
      }
      change(r.ls.id, `Edit ${label}`, set(mm));
    },
  };
}

/** A number cell (kg). */
function numberColumn(label: string, pick: (l: Lineset) => number, set: (n: number) => Partial<Lineset>, width = 80): Column<Row> {
  return {
    label,
    width,
    numeric: true,
    value: (r) => pick(r.ls),
    edit: (r, text) => {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n) || n < 0) {
        toast(`"${text}" isn't a weight.`, "info");
        refreshAll();
        return;
      }
      change(r.ls.id, `Edit ${label}`, set(n));
    },
  };
}

/** A weight to one decimal place, as the table shows it. */
const kg = (n: number): string => `${Math.round(n * 10) / 10}`;

const COLUMNS: Column<Row>[] = [
  {
    label: "Name",
    width: 100,
    value: (r) => r.ls.name,
    edit: (r, text) => {
      const name = text.trim();
      if (!name) {
        toast("A lineset needs a name.", "info");
        refreshAll();
        return;
      }
      change(r.ls.id, "Rename Lineset", { name });
    },
  },
  lengthColumn("Up", (l) => l.upMm, (upMm) => ({ upMm })),
  lengthColumn("Batten", (l) => l.battenMm, (battenMm) => ({ battenMm })),
  numberColumn("Capacity (kg)", (l) => l.capacityKg, (capacityKg) => ({ capacityKg })),
  lengthColumn("In Trim", (l) => l.inTrimMm, (inTrimMm) => ({ inTrimMm })),
  lengthColumn("Out Trim", (l) => l.outTrimMm, (outTrimMm) => ({ outTrimMm })),
  { label: "Kind", width: 76, value: (r) => r.ls.kind, edit: (r, text) => change(r.ls.id, "Change Kind", { kind: kindOf(text) }) },
  { label: "Hung", width: 76, value: (r) => r.ls.hung, edit: (r, text) => change(r.ls.id, "Edit Hung", { hung: text.trim() }) },
  numberColumn("Weight (kg)", (l) => l.weightKg, (weightKg) => ({ weightKg })),
  lengthColumn("Cloth Height", (l) => l.clothMm, (clothMm) => ({ clothMm })),
  { label: "Instruments", numeric: true, width: 84, value: (r) => r.check.instruments },
  {
    label: "Load (kg)",
    width: 104,
    value: (r) => (r.check.capacityKg > 0 ? `${kg(r.check.usedKg)} of ${kg(r.check.capacityKg)}` : kg(r.check.usedKg)),
    cellClass: (r) => (r.check.overweight ? "th-bad" : undefined),
  },
  {
    label: "Flags",
    width: 150,
    value: (r) => r.check.flags.join("; "),
    cellClass: (r) => (r.check.flags.length ? "th-warn" : undefined),
  },
];

/** One more than the highest lineset number used, so new names don't repeat. */
function nextNumber(list: readonly Lineset[]): number {
  const used = list.map((l) => parseInt(l.name, 10)).filter(Number.isFinite);
  return used.length ? Math.max(...used) + 1 : list.length + 1;
}

/** Ups from the highest lineset up by a step; 500 mm for the first. */
function nextUp(list: readonly Lineset[]): number {
  return list.length ? Math.max(...list.map((l) => l.upMm)) + 500 : 500;
}

function addOne(): void {
  const list = linesets();
  const added = newLinesets(1, nextUp(list), 0, addDefaults.batten, addDefaults.capacity, nextNumber(list));
  writeShow("Add Lineset", LINESETS_KEY, [...list, ...added]);
  refreshAll();
}

async function addMany(): Promise<void> {
  const v = await toolPrefs(
    "Add Linesets",
    [
      { kind: "number", key: "count", label: "How Many", value: addDefaults.count, min: 1, max: 200, integer: true },
      { kind: "length", key: "firstUp", label: "First Up", value: addDefaults.firstUp, zero: true },
      { kind: "length", key: "spacing", label: "Spacing", value: addDefaults.spacing },
      { kind: "length", key: "batten", label: "Batten Length", value: addDefaults.batten },
      { kind: "number", key: "capacity", label: "Capacity", value: addDefaults.capacity, min: 0, max: 100000, unit: "kg" },
    ],
    "Adds linesets numbered on from the highest one, the first at First Up and each the spacing above the one before. They start hung in at 6 m and flown out to 13 m; change any of it in the table.",
  );
  if (!v) return;
  addDefaults.count = v.num("count");
  addDefaults.firstUp = v.num("firstUp");
  addDefaults.spacing = v.num("spacing");
  addDefaults.batten = v.num("batten");
  addDefaults.capacity = v.num("capacity");
  const list = linesets();
  const added = newLinesets(addDefaults.count, addDefaults.firstUp, addDefaults.spacing, addDefaults.batten, addDefaults.capacity, nextNumber(list));
  writeShow("Add Linesets", LINESETS_KEY, [...list, ...added]);
  refreshAll();
}

function deleteSelected(): void {
  const id = selected;
  if (!id) {
    toast("Click a lineset in the list to select it first.", "info");
    return;
  }
  selected = null;
  writeShow("Delete Lineset", LINESETS_KEY, linesets().filter((l) => l.id !== id));
  refreshAll();
}

/** Draws each batten across the stage at its height, its name at the stage-left end, replacing the last drawing's pieces. */
function drawOnPlan(): void {
  const list = linesets();
  if (list.length === 0) {
    toast("No linesets to draw yet.", "info");
    return;
  }
  const scale = activeScale();
  const layerId = store.activeLayerId;
  if (scale === null || !layerId) {
    toast("Make a design layer active to draw the battens.", "info");
    return;
  }
  const frame = stageFrame();
  const textMm = LABEL_PAPER_MM * scale;
  const cls = store.activeClassIndex;
  const drawn = attempt("Draw Linesets", (s) =>
    s.batch(() => {
      const old = readShow<string[]>(DRAWING_KEY, []);
      const stale = old.filter((id) => s.doc.object(id) !== null);
      if (stale.length) s.deleteObjects(stale);
      const ids: string[] = [];
      for (const ls of list) {
        const a: Pt = fromStage(frame, { across: ls.battenMm / 2, up: ls.upMm });
        const b: Pt = fromStage(frame, { across: -ls.battenMm / 2, up: ls.upMm });
        ids.push(s.addObject(layerId, { kind: "line", a, b }, cls));
        const at = fromStage(frame, { across: ls.battenMm / 2 + textMm, up: ls.upMm });
        ids.push(s.addObject(layerId, { kind: "text", at, text: ls.name, height: textMm, hAlign: 1, vAlign: 3 }, cls));
      }
      writeShowIn(s, DRAWING_KEY, ids);
      return ids.length;
    }),
  );
  if (drawn) toast(`${list.length} battens drawn on the plan.`, "info");
  appContext()?.requestDraw();
}

function exportCsv(): void {
  downloadText("linesets.csv", csvOf(COLUMNS, rowsNow()), "text/csv");
}

/** A toolbar button that runs `run` when clicked. */
function button(label: string, run: () => void): HTMLElement {
  const b = h("button", { cls: "btn", text: label, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
}

/** The list tab: its toolbar and the table. */
function listTab(): HTMLElement {
  const toolbar = h(
    "div",
    { cls: "th-toolbar" },
    button("Add One", addOne),
    button("Add Many…", () => void addMany()),
    button("Delete Selected", deleteSelected),
    h("span", { cls: "th-spacer" }),
    button("Draw on Plan", drawOnPlan),
    button("Export CSV", exportCsv),
  );
  const made = dataTable(COLUMNS, rowsNow, {
    empty: "No linesets yet. Add One or Add Many… makes some.",
    onRow: (r) => {
      selected = r.ls.id;
      table?.refresh();
      appContext()?.requestDraw();
    },
    rowClass: (r) => (r.ls.id === selected ? "venue-row-on" : undefined),
  });
  table = made;
  return h("div", { cls: "th-tab-body" }, toolbar, made.element);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** An SVG element with its attributes, and text if given. */
function svgEl(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A label's start (screen y runs down, so a label rises to the right) and its length along the run. */
interface Start {
  readonly x: number;
  readonly y: number;
  readonly len: number;
}

/** Whether label b runs into label a: the two lie within a text's height across the run and overlap along it. */
function clashes(a: Start, b: Start): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const across = 0.71 * (dx + dy);
  const along = 0.71 * (dx - dy);
  return Math.abs(across) < 12 && along < a.len && along + b.len > 0;
}

/**
 * The hang plot: the up axis along the bottom, each lineset a tick at its up position reaching its in trim,
 * coloured by kind. Labels angle up to the right, each raised a level where it would overlap one before it.
 */
function hangPlot(list: readonly Lineset[], venue: VenueInfo | null): HTMLElement {
  const W = 760;
  const padL = 40;
  const padR = 40;
  const plotH = 240;
  const bottom = 56;
  const LEVEL = 18;
  const xs = [0, ...list.map((l) => l.upMm), ...(venue ? [venue.stageDepthMm, venue.ironUpMm] : [])];
  const x0 = Math.min(...xs) - 1000;
  const x1 = Math.max(...xs) + 1000;
  const px = (mm: number): number => padL + ((mm - x0) / (x1 - x0)) * (W - padL - padR);
  const maxH = Math.max(venue?.gridHeightMm ?? 0, 1000, ...list.map((l) => l.inTrimMm));
  const ordered = list.map((l) => ({ l, x: px(l.upMm), text: `${l.name}, in ${lengthText(l.inTrimMm)}` })).sort((a, b) => a.x - b.x);
  // Each label starts at its lineset's in trim and runs up to the right at 45 degrees. It takes the lowest level
  // where no label before it runs into it, and the band above the plot is tall enough for the highest label.
  const starts: Start[] = [];
  const placed = new Map<string, Start>();
  for (const it of ordered) {
    const len = it.text.length * 6.2;
    const base = -(it.l.inTrimMm / maxH) * plotH - 7;
    let L = 0;
    while (starts.some((s) => clashes(s, { x: it.x, y: base - L * LEVEL, len }))) L++;
    const start = { x: it.x, y: base - L * LEVEL, len };
    starts.push(start);
    placed.set(it.l.id, start);
  }
  const top = Math.min(0, ...starts.map((s) => s.y - s.len * 0.71 - 12));
  const labelBand = -top + 8;
  const baseY = labelBand + plotH;
  const H = baseY + bottom;
  const y = (mm: number): number => baseY - (mm / maxH) * plotH;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Hang plot of the linesets, up from the plaster line" });
  svg.append(svgEl("line", { x1: padL, y1: baseY, x2: W - padR, y2: baseY, class: "venue-axis" }));
  const span = x1 - x0;
  const step = [500, 1000, 2000, 5000, 10000].find((n) => span / n <= 7) ?? 10000;
  for (let mm = Math.ceil(x0 / step) * step; mm <= x1; mm += step) {
    svg.append(svgEl("line", { x1: px(mm), y1: baseY, x2: px(mm), y2: baseY + 4, class: "venue-axis" }));
    svg.append(svgEl("text", { x: px(mm), y: baseY + 16, "text-anchor": "middle", class: "venue-small" }, lengthText(mm)));
  }
  svg.append(svgEl("text", { x: padL, y: baseY + 38, "text-anchor": "start", class: "venue-small" }, "House"));
  svg.append(svgEl("text", { x: W - padR, y: baseY + 38, "text-anchor": "end", class: "venue-small" }, "Upstage"));
  if (venue) {
    svg.append(svgEl("line", { x1: px(0), y1: labelBand, x2: px(0), y2: baseY, class: "venue-marker" }));
    svg.append(svgEl("text", { x: px(0) - 4, y: baseY + 38, "text-anchor": "end", class: "venue-small" }, "PL"));
    svg.append(svgEl("line", { x1: px(venue.ironUpMm), y1: labelBand, x2: px(venue.ironUpMm), y2: baseY, class: "venue-marker venue-dotted" }));
    svg.append(svgEl("text", { x: px(venue.ironUpMm) + 4, y: baseY + 38, "text-anchor": "start", class: "venue-small" }, "Iron"));
  }
  for (const l of list) {
    const x = px(l.upMm);
    const top = y(l.inTrimMm);
    svg.append(svgEl("line", { x1: x, y1: baseY, x2: x, y2: top, stroke: KIND_COLOUR[l.kind], "stroke-width": 3 }));
    svg.append(svgEl("circle", { cx: x, cy: top, r: 3.5, fill: KIND_COLOUR[l.kind] }));
  }
  for (const it of ordered) {
    const ty = baseY + (placed.get(it.l.id)?.y ?? 0);
    svg.append(svgEl("text", { x: it.x, y: ty, "font-size": 11, transform: `rotate(-45 ${it.x} ${ty})`, class: "venue-label" }, it.text));
  }
  const legend = h("div", { cls: "venue-legend" }, ...LINESET_KINDS.map((k) => h("span", {}, h("i", { cls: "venue-swatch", attrs: { style: `background:${KIND_COLOUR[k.value]}` } }), k.label)));
  const note = list.length ? [] : [h("p", { cls: "th-note", text: "No linesets yet: the plot fills in as you add them." })];
  return h("div", { cls: "venue-plot" }, svg, legend, ...note);
}

/** The hang plot tab: drawn each time it shows, and redrawn while the window is open. */
function plotTab(): HTMLElement {
  const holder = h("div", { cls: "venue-plot-holder" }, hangPlot(linesets(), venueInfo()));
  plotHolder = holder;
  return holder;
}

/** Lights the selected lineset's batten across the stage in the plan, while the window is open. */
function highlight(p: { readonly ctx: CanvasRenderingContext2D; toScreen(pt: Pt): Pt }): void {
  if (!shown || !selected) return;
  const ls = linesets().find((l) => l.id === selected);
  if (!ls) return;
  const frame: StageFrame = stageFrame();
  const half = Math.max(ls.battenMm, 2000) / 2;
  const a = p.toScreen(fromStage(frame, { across: half, up: ls.upMm }));
  const b = p.toScreen(fromStage(frame, { across: -half, up: ls.upMm }));
  p.ctx.save();
  p.ctx.strokeStyle = HIGHLIGHT;
  p.ctx.lineWidth = 3;
  p.ctx.beginPath();
  p.ctx.moveTo(a.x, a.y);
  p.ctx.lineTo(b.x, b.y);
  p.ctx.stroke();
  p.ctx.restore();
}

/** Stage > Venue > Linesets…: the window with its list and hang plot tabs. */
export function openLinesets(): void {
  shown ??= tabs([
    { id: "list", label: "Linesets", build: listTab },
    { id: "plot", label: "Hang Plot", build: plotTab },
  ]);
  openPanel({
    key: WINDOW,
    title: "Linesets",
    body: shown.element,
    width: 1240,
    height: 700,
    onClose: () => {
      shown = null;
      table = null;
      plotHolder = null;
      selected = null;
      appContext()?.requestDraw();
    },
  });
  refreshAll();
}

registerOverlay(highlight);
// an undo, a redo or a change from elsewhere brings the open window up to date
onDocument((session) => {
  session?.onChange(() => {
    if (shown) refreshAll();
  });
});
