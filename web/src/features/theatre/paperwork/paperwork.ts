// Stage > Lighting Paperwork > Paperwork…: the paperwork a lighting designer would otherwise take from a
// separate program, read live from the plot: the instrument list (cells typed in and written back, one undo
// step each), the channel and dimmer hookups, colour cuts, gobo pull, shop order and the problems to fix.
// The figures are reports.ts's. The window follows the drawing while it is open, and waits while a cell or
// the filter is being typed in. Each tab exports its CSV; Export All (zip) gives every tab at once.

import type { Pt } from "../../../core/index.ts";
import { setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { downloadBlob } from "../../../app/fileio.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { zipFiles } from "../../../export/zip.ts";
import { patchText, type Fixture, type FixtureEdit } from "../fixture.ts";
import { editFixtures, fixture, fixtures } from "../instrument.ts";
import { csvOf, csvText, dataTable, downloadText, noteLine, openPanel, tabs, type Column, type OpenPanel } from "../ui.ts";
import {
  channelHookup,
  colorCuts,
  dimmerHookup,
  goboPull,
  problems,
  shopOrder,
  type ChannelRow,
  type ColorCutRow,
  type DimmerRow,
  type GoboRow,
  type Problem,
  type ShopRow,
  type ShopTotal,
} from "./reports.ts";
import "./paperwork.css";

const KEY = "lighting-paperwork";
const TITLE = "Lighting Paperwork";
/** a dimmer's load limit until the Limit field says otherwise, in watts */
const DEFAULT_LIMIT_W = 2400;
const NOTHING = "Nothing to show yet: place some lighting instruments first.";

/** The window while it is open, and what it keeps across a close and a reopen. */
let shown: OpenPanel | null = null;
let stopFollowing: (() => void) | null = null;
let redraw: (() => void) | null = null;
let filter = "";
let limitWatts = DEFAULT_LIMIT_W;

/** A text cell: what's typed becomes that field of the instrument, one undo step. */
function textColumn(label: string, width: number, read: (f: Fixture) => string, field: (text: string) => FixtureEdit): Column<Fixture> {
  return {
    label,
    width,
    value: read,
    edit: (f, text) => {
      editFixtures(`Edit ${label}`, [{ id: f.id, edit: field(text.trim()) }]);
    },
  };
}

/** A number cell: it takes 0 or more; anything else is refused and the cell shows its figure again. */
function numberColumn(label: string, width: number, read: (f: Fixture) => number, field: (n: number) => FixtureEdit): Column<Fixture> {
  return {
    label,
    width,
    numeric: true,
    value: read,
    edit: (f, text) => {
      const n = Number(text);
      if (text.trim() === "" || !Number.isFinite(n) || n < 0) {
        toast(`${label} takes a number, 0 or more.`, "info");
        redraw?.();
        return;
      }
      editFixtures(`Edit ${label}`, [{ id: f.id, edit: field(n) }]);
    },
  };
}

const INSTRUMENT_COLUMNS: readonly Column<Fixture>[] = [
  textColumn("Position", 112, (f) => f.position, (t) => ({ position: t })),
  textColumn("Unit", 50, (f) => f.unit, (t) => ({ unit: t })),
  textColumn("Channel", 66, (f) => f.channel, (t) => ({ channel: t })),
  textColumn("Dimmer", 66, (f) => f.dimmer, (t) => ({ dimmer: t })),
  textColumn("Circuit", 64, (f) => f.circuit, (t) => ({ circuit: t })),
  textColumn("Color", 100, (f) => f.color, (t) => ({ color: t })),
  textColumn("Gobo", 80, (f) => f.gobo, (t) => ({ gobo: t })),
  textColumn("Purpose", 70, (f) => f.purpose, (t) => ({ purpose: t })),
  numberColumn("Wattage (W)", 84, (f) => f.watts, (n) => ({ watts: n })),
  numberColumn("Weight (kg)", 76, (f) => f.weightKg, (n) => ({ weightKg: n })),
  { label: "Type", width: 120, value: (f) => f.label },
  { label: "Patch", width: 50, value: (f) => patchText(f) },
];

const CHANNEL_COLUMNS: readonly Column<ChannelRow>[] = [
  { label: "Channel", value: (r) => r.channel || "(none)" },
  { label: "Count", value: (r) => r.count, numeric: true },
  { label: "Units", value: (r) => r.units },
  { label: "Dimmers", value: (r) => r.dimmers },
  { label: "Types", value: (r) => r.types },
  { label: "Colours", value: (r) => r.colours },
  { label: "Purposes", value: (r) => r.purposes },
  { label: "Watts", value: (r) => r.watts, numeric: true },
];

const DIMMER_COLUMNS: readonly Column<DimmerRow>[] = [
  { label: "Dimmer", value: (r) => r.dimmer },
  { label: "Channels", value: (r) => r.channels },
  { label: "Units", value: (r) => r.units },
  { label: "Load (W)", value: (r) => r.watts, numeric: true },
  { label: "Over limit", value: (r) => (r.over ? "Yes" : "") },
];

const CUT_COLUMNS: readonly Column<ColorCutRow>[] = [
  { label: "Code", value: (r) => r.code },
  { label: "Gel", value: (r) => r.name || "(not in the list)" },
  { label: "Frame (in)", value: (r) => r.frameIn, numeric: true },
  { label: "Cuts", value: (r) => r.cuts, numeric: true },
  { label: "Sheets", value: (r) => r.sheets, numeric: true },
];

const GOBO_COLUMNS: readonly Column<GoboRow>[] = [
  { label: "Gobo", value: (r) => r.gobo },
  { label: "Count", value: (r) => r.count, numeric: true },
  { label: "Units", value: (r) => r.units },
  { label: "Types", value: (r) => r.types },
];

const SHOP_COLUMNS: readonly Column<ShopRow>[] = [
  { label: "Type", value: (r) => r.type || "(none)" },
  { label: "Count", value: (r) => r.count, numeric: true },
  { label: "Watts each", value: (r) => r.wattsEach, numeric: true },
  { label: "Total watts", value: (r) => r.watts, numeric: true },
  { label: "Weight each (kg)", value: (r) => r.weightEach, numeric: true },
  { label: "Total weight (kg)", value: (r) => r.weightKg, numeric: true },
];

const PROBLEM_COLUMNS: readonly Column<Problem>[] = [
  { label: "Severity", value: (p) => (p.severity === "error" ? "Error" : "Warning") },
  { label: "Problem", value: (p) => p.text },
  { label: "Instruments", value: (p) => p.ids.length, numeric: true },
];

/** Whether an instrument's shown fields hold every word of the filter. */
function matches(f: Fixture, words: readonly string[]): boolean {
  const text = [f.position, f.unit, f.channel, f.dimmer, f.circuit, f.color, f.gobo, f.purpose, f.label, String(f.watts), String(f.weightKg), patchText(f)]
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Centres the drawing on a point, at the scale it has. */
function centreOn(at: Pt): void {
  const ctx = appContext();
  if (!ctx) return;
  ctx.view.setCenterAndScale(at.x, at.y, ctx.view.scale);
  ctx.requestDraw();
}

/** Selects an instrument, and centres the drawing on it. */
function focusOn(f: Fixture): void {
  setEditGroup(null, [f.id]);
  centreOn(f.at);
}

/** Selects a problem's instruments, and centres the drawing on the first. */
function selectProblem(p: Problem): void {
  setEditGroup(null, p.ids);
  const first = p.ids.length ? fixture(p.ids[0]) : undefined;
  if (first) centreOn(first.at);
}

/** A table's rows as CSV, or null when there are none to export. */
function csvIfAny<R>(columns: readonly Column<R>[], rows: readonly R[]): string | null {
  return rows.length ? csvOf(columns, rows) : null;
}

/** The shop order as CSV: the rows, then the totals. */
function shopCsv(rows: readonly ShopRow[], total: ShopTotal): string {
  return csvText(
    SHOP_COLUMNS.map((c) => c.label),
    [...rows.map((r) => SHOP_COLUMNS.map((c) => c.value(r))), ["Total", total.count, "", total.watts, "", total.weightKg]],
  );
}

/** A tab's Export CSV button, in a foot under its table; `csv` gives the text, or null when there's nothing to export. */
function exportFoot(name: string, csv: () => string | null): HTMLElement {
  const button = h("button", { cls: "btn", text: "Export CSV", attrs: { type: "button" } });
  button.addEventListener("click", () => {
    const text = csv();
    if (text === null) toast(`Nothing to export in ${name}.`, "info");
    else downloadText(`${name}.csv`, text, "text/csv");
  });
  return h("div", { cls: "paperwork-foot" }, button);
}

/** A tab's content, stacked. */
function tabBody(...children: HTMLElement[]): HTMLElement {
  return h("div", { cls: "paperwork-tab" }, ...children);
}

interface ReportOptions<R> {
  readonly notes?: readonly HTMLElement[];
  readonly empty?: string;
  readonly csv?: () => string | null;
  readonly onRow?: (row: R) => void;
  readonly rowClass?: (row: R) => string | undefined;
}

/** A report's table, its notes above it and Export CSV at the foot. */
function reportTab<R>(name: string, columns: readonly Column<R>[], rows: readonly R[], o: ReportOptions<R> = {}): HTMLElement {
  const table = dataTable(columns, () => rows, { empty: o.empty ?? NOTHING, onRow: o.onRow, rowClass: o.rowClass });
  return tabBody(...(o.notes ?? []), table.element, exportFoot(name, o.csv ?? (() => csvIfAny(columns, rows))));
}

function instrumentsTab(): HTMLElement {
  const words = (): string[] => filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (): Fixture[] => fixtures().filter((f) => matches(f, words()));
  const count = noteLine("");
  const search = h("input", {
    cls: "paperwork-filter",
    value: filter,
    attrs: { type: "search", placeholder: "Filter by any field", "aria-label": "Filter instruments" },
  });
  const table = dataTable(INSTRUMENT_COLUMNS, visible, { empty: "No instruments to show. Clear the filter, or place some first.", onRow: focusOn });
  const tally = (): void => {
    count.textContent = `${visible().length} of ${fixtures().length} instruments`;
  };
  search.addEventListener("input", () => {
    filter = search.value;
    table.refresh();
    tally();
  });
  tally();
  return tabBody(h("div", { cls: "th-toolbar" }, search, count), table.element, exportFoot("Instruments", () => csvIfAny(INSTRUMENT_COLUMNS, visible())));
}

function channelsTab(): HTMLElement {
  return reportTab("Channel Hookup", CHANNEL_COLUMNS, channelHookup(fixtures()));
}

function dimmersTab(): HTMLElement {
  const list = fixtures();
  const rows = dimmerHookup(list, limitWatts);
  const limit = h("input", {
    cls: "paperwork-number",
    value: String(limitWatts),
    attrs: { type: "number", min: "1", step: "100", "aria-label": "Limit in watts" },
  });
  limit.addEventListener("keydown", (e) => {
    if (e.key === "Enter") limit.blur();
  });
  limit.addEventListener("change", () => {
    const n = Number(limit.value);
    if (Number.isFinite(n) && n > 0) limitWatts = n;
    else toast("The limit takes watts, above 0.", "info");
    redraw?.();
  });
  const over = rows.filter((r) => r.over).length;
  const bare = list.filter((f) => !f.dimmer.trim()).length;
  const overText = over ? `${over} ${over === 1 ? "dimmer is" : "dimmers are"} over the limit.` : "No dimmer is over the limit.";
  const bar = h("div", { cls: "th-toolbar" }, h("label", { cls: "paperwork-limit" }, "Limit (W)", limit), noteLine(overText, over ? "th-bad" : undefined));
  const notes: HTMLElement[] = [bar];
  if (bare) {
    const verb = bare === 1 ? "instrument has" : "instruments have";
    notes.push(noteLine(`${bare} ${verb} no dimmer, so ${bare === 1 ? "it isn't" : "they aren't"} on a row.`));
  }
  return reportTab("Dimmer Hookup", DIMMER_COLUMNS, rows, { notes, rowClass: (r) => (r.over ? "th-bad" : undefined) });
}

function cutsTab(): HTMLElement {
  return reportTab("Colour Cuts", CUT_COLUMNS, colorCuts(fixtures()), {
    notes: [
      noteLine(
        "Each filter an instrument names is one cut. Frames are about 6.25 in for an ellipsoidal, 8 in for a fresnel, 10 in for a par and 12 in for a wash. " +
          "A sheet is 20 by 24 in. Moving lights take no gel and are left out.",
      ),
    ],
  });
}

function goboTab(): HTMLElement {
  return reportTab("Gobo Pull", GOBO_COLUMNS, goboPull(fixtures()));
}

function shopTab(): HTMLElement {
  const { rows, total } = shopOrder(fixtures());
  return reportTab("Shop Order", SHOP_COLUMNS, rows, {
    notes: [
      noteLine(
        `In all: ${total.count} ${total.count === 1 ? "instrument" : "instruments"}, ${total.watts} W and ${total.weightKg} kg. ` +
          "Each figure is the instrument's own, or its type's typical one.",
      ),
    ],
    csv: () => (rows.length ? shopCsv(rows, total) : null),
  });
}

function problemsTab(): HTMLElement {
  return reportTab("Problems", PROBLEM_COLUMNS, problems(fixtures()), {
    empty: "No problems found.",
    rowClass: (p) => (p.severity === "error" ? "th-bad" : "th-warn"),
    onRow: selectProblem,
  });
}

/** Every tab's CSV in one zip; the instrument list is unfiltered. */
function exportAll(): void {
  const list = fixtures();
  if (list.length === 0) {
    toast("Nothing to export: the drawing has no lighting instruments yet.", "info");
    return;
  }
  const shop = shopOrder(list);
  const sheets: [string, string][] = [
    ["Instruments", csvOf(INSTRUMENT_COLUMNS, list)],
    ["Channel Hookup", csvOf(CHANNEL_COLUMNS, channelHookup(list))],
    ["Dimmer Hookup", csvOf(DIMMER_COLUMNS, dimmerHookup(list, limitWatts))],
    ["Colour Cuts", csvOf(CUT_COLUMNS, colorCuts(list))],
    ["Gobo Pull", csvOf(GOBO_COLUMNS, goboPull(list))],
    ["Shop Order", shopCsv(shop.rows, shop.total)],
    ["Problems", csvOf(PROBLEM_COLUMNS, problems(list))],
  ];
  const encoder = new TextEncoder();
  const files = sheets.map(([name, text]) => [`${name}.csv`, encoder.encode(text)] as const);
  downloadBlob(`${TITLE}.zip`, new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }));
}

/** Opens the window, or brings it forward when it's already open. */
export function openPaperwork(): void {
  if (shown) {
    document.body.append(shown.element);
    return;
  }
  const body = tabs([
    { id: "instruments", label: "Instruments", build: instrumentsTab },
    { id: "channels", label: "Channel Hookup", build: channelsTab },
    { id: "dimmers", label: "Dimmer Hookup", build: dimmersTab },
    { id: "cuts", label: "Colour Cuts", build: cutsTab },
    { id: "gobos", label: "Gobo Pull", build: goboTab },
    { id: "shop", label: "Shop Order", build: shopTab },
    { id: "problems", label: `Problems (${problems(fixtures()).length})`, build: problemsTab },
  ]);
  const countProblems = (): void => {
    const tab = body.element.querySelector<HTMLElement>('[data-tab="problems"]');
    if (tab) tab.textContent = `Problems (${problems(fixtures()).length})`;
  };
  // a redraw waits while a cell or the filter is being typed in, and runs once focus leaves it
  let pending = false;
  const requestRedraw = (): void => {
    if (!shown) return;
    countProblems();
    if (document.activeElement instanceof HTMLInputElement && shown.element.contains(document.activeElement)) {
      pending = true;
      return;
    }
    pending = false;
    body.refresh();
  };
  // a drawing change is read after the session's own listeners have dropped the cached instruments
  let scheduled = false;
  const followDrawing = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      requestRedraw();
    }, 0);
  };
  const panel = openPanel({
    key: KEY,
    title: TITLE,
    body: body.element,
    width: 1000,
    height: 620,
    actions: [{ label: "Export All (zip)", run: exportAll }],
    onClose: () => {
      stopFollowing?.();
      stopFollowing = null;
      redraw = null;
      shown = null;
    },
  });
  shown = panel;
  redraw = requestRedraw;
  panel.element.addEventListener("focusout", () => {
    setTimeout(() => {
      if (pending) requestRedraw();
    }, 0);
  });
  stopFollowing = store.on("session", followDrawing);
}
