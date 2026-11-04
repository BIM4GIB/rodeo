// Stage > Lighting Paperwork > Generate Paperwork… (Spotlight > Lighting Reports in Vectorworks): the Generate
// Paperwork dialog. Schedules (Instrument Schedule, Channel Hookup, Dimmer Hookup) with Setup… for Schedule
// Formatting (each one's Printed Name, its columns from Available Fields with Move >, Move <, Move Up and Move
// Down, each Wide, Medium or Narrow, and whether the column headers and body are bold); Reports (Shop Order,
// Gobo Pull); Magic Sheets with Setup… (summarized by Color or Area); the Color Cut List, optionally broken
// down by position; Header Configuration; Event Information; and the Page Height and Width the columns are
// fitted to. OK writes the chosen ones as worksheets (schedules.ts lays them out), replacing those made before
// unless a sheet shows them, and draws a magic sheet on a new design layer, Magic Sheet-Color or Magic
// Sheet-Area, all in one undo step. The settings are kept in this browser.

import "./generatePaperwork.css";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import type { NewWorksheet } from "../../../core/index.ts";
import { freeName } from "../connectcad/ccadReports.ts";
import { addMagicSheet, magicSheetParts } from "../docs/magicSheetDialog.ts";
import { fixtures } from "../instrument.ts";
import {
  colorCutSheet,
  defaultFormat,
  FIELDS,
  fieldOf,
  goboPullSheet,
  POINTS_PER_MM,
  scheduleSheet,
  SCHEDULES,
  shopOrderSheet,
  type ColumnWidth,
  type EventInfo,
  type FieldId,
  type HeaderConfig,
  type HeaderItem,
  type PaperworkPage,
  type ScheduleColumn,
  type ScheduleFormat,
  type ScheduleId,
} from "./schedules.ts";

type MagicBy = "color" | "area";

interface Settings {
  readonly schedules: Readonly<Record<ScheduleId, boolean>>;
  readonly formats: Readonly<Record<ScheduleId, ScheduleFormat>>;
  readonly shopOrder: boolean;
  readonly goboPull: boolean;
  readonly magic: boolean;
  readonly magicBy: MagicBy;
  readonly cuts: boolean;
  readonly cutsByPosition: boolean;
  readonly header: HeaderConfig;
  readonly info: EventInfo;
  /** the print area, mm; null until set, for the drawing's units to choose */
  readonly pageMm: { readonly width: number; readonly height: number } | null;
}

const STORAGE_KEY = "openvwx.generatePaperwork.v1";
const SHOP_ORDER = "Shop Order";
const GOBO_PULL = "Gobo Pull";
const COLOR_CUT_LIST = "Color Cut List";
/** a magic sheet bubble's diameter on paper, mm, as the Magic Sheet command starts with */
const BUBBLE_MM = 8;
/** the print area to start with: 7.5 by 10 inches in feet and inches, else A4 inside 10 mm margins */
const IMPERIAL_PAGE = { width: 190.5, height: 254 };
const METRIC_PAGE = { width: 190, height: 277 };

const WIDTHS: readonly { readonly value: ColumnWidth; readonly label: string }[] = [
  { value: "wide", label: "Wide" },
  { value: "medium", label: "Medium" },
  { value: "narrow", label: "Narrow" },
];
const HEADER_ITEMS: readonly { readonly value: HeaderItem; readonly label: string }[] = [
  { value: "", label: "None" },
  { value: "designer", label: "Designer" },
  { value: "event", label: "Event Name" },
  { value: "date", label: "Date" },
];

const DEFAULTS: Settings = {
  schedules: { instrument: true, channel: true, dimmer: false },
  formats: { instrument: defaultFormat("instrument"), channel: defaultFormat("channel"), dimmer: defaultFormat("dimmer") },
  shopOrder: false,
  goboPull: false,
  magic: false,
  magicBy: "color",
  cuts: false,
  cutsByPosition: false,
  header: { left: "designer", center: "event", right: "date" },
  info: { designer: "", event: "", date: "" },
  pageMm: null,
};

const isField = (v: unknown): v is FieldId => FIELDS.some((f) => f.id === v);
const isWidth = (v: unknown): v is ColumnWidth => WIDTHS.some((w) => w.value === v);
const isHeaderItem = (v: unknown): v is HeaderItem => HEADER_ITEMS.some((i) => i.value === v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A kept format, or the schedule's own where it can't be read. */
function formatFrom(raw: unknown, id: ScheduleId): ScheduleFormat {
  const d = defaultFormat(id);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const columns = Array.isArray(r.columns)
    ? (r.columns as unknown[]).flatMap((c): ScheduleColumn[] => {
        const { field, width } = (c ?? {}) as Record<string, unknown>;
        return isField(field) ? [{ field, width: isWidth(width) ? width : fieldOf(field).width }] : [];
      })
    : d.columns;
  return {
    printed: typeof r.printed === "string" ? r.printed : d.printed,
    columns: columns.length ? columns.filter((c, i) => columns.findIndex((x) => x.field === c.field) === i) : d.columns,
    headBold: typeof r.headBold === "boolean" ? r.headBold : d.headBold,
    bodyBold: typeof r.bodyBold === "boolean" ? r.bodyBold : d.bodyBold,
  };
}

function load(): Settings {
  try {
    const r = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return DEFAULTS;
    const flag = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
    const sch = (r.schedules ?? {}) as Record<string, unknown>;
    const fmt = (r.formats ?? {}) as Record<string, unknown>;
    const head = (r.header ?? {}) as Record<string, unknown>;
    const info = (r.info ?? {}) as Record<string, unknown>;
    const page = (r.pageMm ?? null) as Record<string, unknown> | null;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
    return {
      schedules: { instrument: flag(sch.instrument, true), channel: flag(sch.channel, true), dimmer: flag(sch.dimmer, false) },
      formats: { instrument: formatFrom(fmt.instrument, "instrument"), channel: formatFrom(fmt.channel, "channel"), dimmer: formatFrom(fmt.dimmer, "dimmer") },
      shopOrder: flag(r.shopOrder, false),
      goboPull: flag(r.goboPull, false),
      magic: flag(r.magic, false),
      magicBy: r.magicBy === "area" ? "area" : "color",
      cuts: flag(r.cuts, false),
      cutsByPosition: flag(r.cutsByPosition, false),
      header: {
        left: isHeaderItem(head.left) ? head.left : DEFAULTS.header.left,
        center: isHeaderItem(head.center) ? head.center : DEFAULTS.header.center,
        right: isHeaderItem(head.right) ? head.right : DEFAULTS.header.right,
      },
      info: { designer: str(info.designer), event: str(info.event), date: str(info.date) },
      pageMm: page && ok(page.width) && ok(page.height) ? { width: page.width, height: page.height } : null,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage blocked: the settings last for this visit only
  }
}

const isImperial = (units: string | undefined): boolean => /inch|feet|foot/i.test(units ?? "");

const check = (label: string, on: boolean): HTMLInputElement => {
  const input = h("input", { attrs: { type: "checkbox", "aria-label": label } });
  input.checked = on;
  return input;
};
const checkRow = (input: HTMLInputElement, label: string): HTMLElement => h("label", { cls: "menu-dialog-check" }, input, label);
const field = (label: string, control: HTMLElement, suffix = ""): HTMLElement =>
  h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, ...(suffix ? [h("span", { cls: "menu-dialog-unit", text: suffix })] : []));
const button = (text: string, run: () => void): HTMLButtonElement => {
  const b = h("button", { cls: "btn small", text, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
};
const heading = (text: string): HTMLElement => h("div", { cls: "menu-dialog-title menu-dialog-heading", text });

/** The Schedule Formatting dialog over all three schedules' formats; the new formats, or null when cancelled. */
async function scheduleFormatting(start: Readonly<Record<ScheduleId, ScheduleFormat>>, first: ScheduleId): Promise<Record<ScheduleId, ScheduleFormat> | null> {
  const formats: Record<ScheduleId, ScheduleFormat> = { ...start };
  let current: ScheduleId = first;
  const schedule = h("select", { cls: "menu-dialog-input", attrs: { "aria-label": "Schedule" } }, ...SCHEDULES.map((s) => h("option", { value: s.id, text: s.name })));
  schedule.value = current;
  const printed = h("input", { cls: "menu-dialog-input", attrs: { type: "text", "aria-label": "Printed Name" } });
  const list = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input gp-list", attrs: { multiple: "", size: "10", "aria-label": label } });
  const available = list("Available Fields");
  const columns = list("Schedule Columns");
  const width = h("select", { cls: "menu-dialog-input", attrs: { "aria-label": "Width" } }, ...WIDTHS.map((w) => h("option", { value: w.value, text: w.label })));
  const headBold = check("Column Headers bold", true);
  const bodyBold = check("Body bold", false);

  const now = (): ScheduleFormat => formats[current];
  const set = (next: Partial<ScheduleFormat>): void => {
    formats[current] = { ...now(), ...next };
  };
  const chosen = (sel: HTMLSelectElement): string[] => [...sel.selectedOptions].map((o) => o.value);
  const widthLabel = (w: ColumnWidth): string => WIDTHS.find((x) => x.value === w)!.label;
  const draw = (keepAvailable: readonly string[] = [], keepColumns: readonly string[] = []): void => {
    const f = now();
    printed.value = f.printed;
    available.replaceChildren(
      ...FIELDS.filter((x) => !f.columns.some((c) => c.field === x.id)).map((x) => {
        const o = h("option", { value: x.id, text: x.label });
        o.selected = keepAvailable.includes(x.id);
        return o;
      }),
    );
    columns.replaceChildren(
      ...f.columns.map((c) => {
        const o = h("option", { value: c.field, text: `${fieldOf(c.field).label} (${widthLabel(c.width)})` });
        o.selected = keepColumns.includes(c.field);
        return o;
      }),
    );
    const sel = f.columns.find((c) => keepColumns.includes(c.field));
    width.value = sel?.width ?? "medium";
    width.disabled = !sel;
    headBold.checked = f.headBold;
    bodyBold.checked = f.bodyBold;
  };
  schedule.addEventListener("change", () => {
    current = schedule.value as ScheduleId;
    draw();
  });
  printed.addEventListener("input", () => set({ printed: printed.value }));
  headBold.addEventListener("change", () => set({ headBold: headBold.checked }));
  bodyBold.addEventListener("change", () => set({ bodyBold: bodyBold.checked }));
  columns.addEventListener("change", () => draw([], chosen(columns)));
  width.addEventListener("change", () => {
    const pick = chosen(columns);
    set({ columns: now().columns.map((c) => (pick.includes(c.field) ? { ...c, width: width.value as ColumnWidth } : c)) });
    draw([], pick);
  });
  const moveIn = (): void => {
    const pick = chosen(available) as FieldId[];
    set({ columns: [...now().columns, ...pick.map((field) => ({ field, width: fieldOf(field).width }))] });
    draw([], pick);
  };
  const moveOut = (): void => {
    const pick = chosen(columns);
    set({ columns: now().columns.filter((c) => !pick.includes(c.field)) });
    draw(pick);
  };
  const shift = (by: -1 | 1): void => {
    const pick = chosen(columns);
    const cols = [...now().columns];
    const order = by < 0 ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i);
    for (const i of order) {
      const j = i + by;
      // a selected column steps past an unselected neighbour; selected ones keep their order
      if (pick.includes(cols[i].field) && j >= 0 && j < cols.length && !pick.includes(cols[j].field)) [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    set({ columns: cols });
    draw([], pick);
  };
  available.addEventListener("dblclick", moveIn);
  columns.addEventListener("dblclick", moveOut);
  draw();

  const ok = await showDialog<boolean>({
    title: "Schedule Formatting",
    okLabel: "OK",
    cls: "gp-dialog",
    body: [
      field("Schedule", schedule),
      field("Printed Name", printed),
      h(
        "div",
        { cls: "gp-columns" },
        h("div", { cls: "gp-col" }, h("span", { cls: "menu-dialog-label", text: "Available Fields" }), available),
        h("div", { cls: "gp-moves" }, button("Move >", moveIn), button("Move <", moveOut)),
        h("div", { cls: "gp-col" }, h("span", { cls: "menu-dialog-label", text: "Schedule Columns" }), columns),
        h("div", { cls: "gp-moves" }, button("Move Up", () => shift(-1)), button("Move Down", () => shift(1))),
      ),
      field("Width", width),
      heading("Page Formatting"),
      checkRow(headBold, "Column Headers bold"),
      checkRow(bodyBold, "Body bold"),
      h("p", { cls: "menu-dialog-text muted", text: "The font and its size are those of the worksheets the drawing has." }),
    ],
    check: () => {
      const empty = SCHEDULES.find((s) => formats[s.id].columns.length === 0);
      if (empty) {
        schedule.value = current = empty.id;
        draw();
        return { error: `Give the ${empty.name} at least one column.`, focus: available };
      }
      return { value: true };
    },
  });
  return ok ? formats : null;
}

/** The Generate Paperwork dialog; the settings chosen, or null when cancelled. */
async function generateDialog(start: Settings): Promise<Settings | null> {
  const units = store.session?.doc.info.units;
  let formats = start.formats;
  let magicBy = start.magicBy;
  const schedules = Object.fromEntries(SCHEDULES.map((s) => [s.id, check(s.name, start.schedules[s.id])])) as Record<ScheduleId, HTMLInputElement>;
  const shop = check(SHOP_ORDER, start.shopOrder);
  const gobo = check(GOBO_PULL, start.goboPull);
  const magic = check("Magic Sheets", start.magic);
  const cuts = check(COLOR_CUT_LIST, start.cuts);
  const byPosition = check("Break Down by Position", start.cutsByPosition);
  const syncCuts = (): void => {
    byPosition.disabled = !cuts.checked;
  };
  cuts.addEventListener("change", syncCuts);
  syncCuts();
  const place = (label: string, value: HeaderItem): HTMLSelectElement => {
    const s = h("select", { cls: "menu-dialog-input", attrs: { "aria-label": label } }, ...HEADER_ITEMS.map((i) => h("option", { value: i.value, text: i.label })));
    s.value = value;
    return s;
  };
  const left = place("Left", start.header.left);
  const center = place("Center", start.header.center);
  const right = place("Right", start.header.right);
  const text = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } });
  const designer = text("Designer", start.info.designer);
  const event = text("Event Name", start.info.event);
  const date = text("Date", start.info.date);
  const page = start.pageMm ?? (isImperial(units) ? IMPERIAL_PAGE : METRIC_PAGE);
  const length = (label: string, mm: number): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const height = length("Page Height", page.height);
  const width = length("Page Width", page.width);
  const suffix = lengthSuffix(units);
  const magicNote = h("span", { cls: "muted gp-by" });
  const showMagicBy = (): void => {
    magicNote.textContent = magicBy === "area" ? "by Area" : "by Color";
  };
  showMagicBy();

  const setupSchedules = async (): Promise<void> => {
    const first = SCHEDULES.find((s) => schedules[s.id].checked)?.id ?? "instrument";
    const next = await scheduleFormatting(formats, first);
    if (next) formats = next;
  };
  const setupMagic = async (): Promise<void> => {
    const v = await toolPrefs(
      "Magic Sheet Setup",
      [
        {
          kind: "choice",
          key: "by",
          label: "Summarize By",
          value: magicBy,
          options: [
            { value: "color", label: "Color" },
            { value: "area", label: "Area" },
          ],
        },
      ],
      "Color: a box for each colour, its lighting devices' channels in it. Area: the lighting devices that have a focus point, a box for each purpose and colour.",
    );
    if (!v) return;
    magicBy = v.choice("by") === "area" ? "area" : "color";
    showMagicBy();
  };
  const today = (): void => {
    date.value = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  };

  return showDialog<Settings>({
    title: "Generate Paperwork",
    okLabel: "OK",
    cls: "gp-dialog",
    body: [
      heading("Schedules"),
      h("div", { cls: "gp-row" }, h("div", { cls: "gp-checks" }, ...SCHEDULES.map((s) => checkRow(schedules[s.id], s.name))), button("Setup…", () => void setupSchedules())),
      heading("Reports"),
      h("div", { cls: "gp-checks" }, checkRow(shop, SHOP_ORDER), checkRow(gobo, GOBO_PULL)),
      h("div", { cls: "gp-row" }, checkRow(magic, "Magic Sheets"), magicNote, button("Setup…", () => void setupMagic())),
      h("div", { cls: "gp-row" }, checkRow(cuts, COLOR_CUT_LIST), checkRow(byPosition, "Break Down by Position")),
      heading("Header Configuration"),
      field("Left", left),
      field("Center", center),
      field("Right", right),
      heading("Event Information"),
      field("Designer", designer),
      field("Event Name", event),
      h("div", { cls: "gp-row" }, field("Date", date), button("Date", today)),
      field("Page Height", height, suffix),
      field("Page Width", width, suffix),
    ],
    check: () => {
      const chosen = SCHEDULES.some((s) => schedules[s.id].checked) || shop.checked || gobo.checked || magic.checked || cuts.checked;
      if (!chosen) return { error: "Choose a schedule, a report, the magic sheets or the color cut list.", focus: schedules.instrument };
      const read = (input: HTMLInputElement, label: string): number | { error: string; focus: HTMLElement } => {
        const mm = parseLength(input.value, units);
        return mm !== null && mm > 0 ? mm : { error: `${label}: enter a length greater than 0.`, focus: input };
      };
      const hMm = read(height, "Page Height");
      if (typeof hMm !== "number") return hMm;
      const wMm = read(width, "Page Width");
      if (typeof wMm !== "number") return wMm;
      return {
        value: {
          schedules: { instrument: schedules.instrument.checked, channel: schedules.channel.checked, dimmer: schedules.dimmer.checked },
          formats,
          shopOrder: shop.checked,
          goboPull: gobo.checked,
          magic: magic.checked,
          magicBy,
          cuts: cuts.checked,
          cutsByPosition: byPosition.checked,
          header: { left: left.value as HeaderItem, center: center.value as HeaderItem, right: right.value as HeaderItem },
          info: { designer: designer.value.trim(), event: event.value.trim(), date: date.value.trim() },
          pageMm: { width: wMm, height: hMm },
        },
      };
    },
  });
}

/** "Magic Sheet-Color", or with " 2", " 3"… when a layer, or an object, has the name or its drawing's. */
function magicLayerName(by: MagicBy): string {
  const taken = new Set((store.session?.doc.layers() ?? []).map((l) => l.name.toLowerCase()));
  const free = (name: string): boolean => !taken.has(name.toLowerCase()) && !taken.has(`${name} Drawing`.toLowerCase());
  const base = by === "area" ? "Magic Sheet-Area" : "Magic Sheet-Color";
  let name = base;
  for (let n = 2; !free(name); n++) name = `${base} ${n}`;
  return name;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function generatePaperwork(): Promise<void> {
  const session = store.session;
  if (!session) return;
  if (fixtures().length === 0) {
    toast("This drawing has no lighting instruments to make paperwork of.", "info");
    return;
  }
  const settings = await generateDialog(load());
  if (!settings) return;
  save(settings);
  const list = fixtures();
  const paper: PaperworkPage = {
    header: settings.header,
    info: settings.info,
    page: { widthPt: settings.pageMm!.width * POINTS_PER_MM, heightPt: settings.pageMm!.height * POINTS_PER_MM },
  };
  const sheets: NewWorksheet[] = [
    ...SCHEDULES.filter((s) => settings.schedules[s.id]).map((s) => scheduleSheet(s.name, s.id, list, settings.formats[s.id], paper)),
    ...(settings.shopOrder ? [shopOrderSheet(SHOP_ORDER, list, paper)] : []),
    ...(settings.goboPull ? [goboPullSheet(GOBO_PULL, list, paper)] : []),
    ...(settings.cuts ? [colorCutSheet(COLOR_CUT_LIST, list, settings.cutsByPosition, paper)] : []),
  ];
  const notes: string[] = [];
  const canSheets = session.doc.resources().some((r) => r.kind === "worksheet");
  if (sheets.length && !canSheets) {
    notes.push("This drawing has no worksheet to make others from, so the schedules and reports aren't made: Paperwork… shows them and exports them as CSV.");
    sheets.length = 0;
  }
  let magic: { name: string; parts: ReturnType<typeof magicSheetParts>["parts"] } | null = null;
  if (settings.magic) {
    const members = settings.magicBy === "area" ? list.filter((f) => f.focus !== null) : list;
    const made = magicSheetParts(members, { pageMm: settings.pageMm!.width, bubbleMm: BUBBLE_MM, group: settings.magicBy === "area" ? "purposeColour" : "colour" });
    if (made.sheet.channels === 0)
      notes.push(settings.magicBy === "area" ? "No lighting device with a focus point has a channel, so there is no magic sheet." : "No lighting device has a channel yet, so there is no magic sheet.");
    else magic = { name: magicLayerName(settings.magicBy), parts: made.parts };
  }
  if (!sheets.length && !magic) {
    toast(notes.join(" ") || "Nothing to make.", "info");
    return;
  }
  const made = attempt("Generate Paperwork", (s) =>
    s.batch(() => {
      const names: string[] = [];
      let kept = 0;
      for (const sheet of sheets) {
        const was = s.doc.resources().find((r) => r.kind === "worksheet" && r.name === sheet.name);
        let name = sheet.name;
        if (was) {
          try {
            s.deleteWorksheet(was.index);
          } catch {
            // on a sheet: that one stays, and the new one takes the next free name
            name = freeName(sheet.name, new Set(s.doc.resources().map((r) => r.name)));
            kept++;
          }
        }
        s.createWorksheet({ ...sheet, name });
        names.push(name);
      }
      if (magic) addMagicSheet(s, s.createLayer(magic.name, "design", 1), magic.parts, `${magic.name} Drawing`);
      return { names, kept };
    }),
  );
  if (!made) return;
  const parts = [
    ...(made.value.names.length ? [`${plural(made.value.names.length, "worksheet")} in the Resource Manager (${made.value.names.join(", ")})`] : []),
    ...(magic ? [`a magic sheet on design layer ${magic.name}`] : []),
  ];
  const kept = made.value.kept ? ` ${plural(made.value.kept, "worksheet")} on a sheet kept, the new one named after it.` : "";
  toast(`Generate Paperwork: ${parts.join(" and ")}.${kept}${notes.length ? ` ${notes.join(" ")}` : ""}`, "info");
}
