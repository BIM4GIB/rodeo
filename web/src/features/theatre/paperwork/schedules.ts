// The worksheets Generate Paperwork (generatePaperwork.ts) puts in a drawing, as Vectorworks' Spotlight makes
// them: the Instrument Schedule (by position and unit), Channel Hookup (by channel) and Dimmer Hookup (by
// dimmer), one row per lighting instrument in the columns Schedule Formatting chose; the Color Cut List, by
// position or for the whole plot; and the Shop Order and Gobo Pull reports (reports.ts has their sums). Each
// is laid out for a page: the header line (designer, event name and date where Header Configuration puts
// them), the printed name and the column heads at the top of every page's worth of rows, and the columns
// sharing the page's width by their Wide, Medium or Narrow. Pure, so Node can check it.

import type { NewSheetCell, NewWorksheet } from "../../../core/index.ts";
import { naturalCompare, patchText, type Fixture } from "../fixture.ts";
import { colorCuts, goboPull, shopOrder } from "./reports.ts";

export type FieldId = "position" | "unit" | "type" | "watts" | "purpose" | "color" | "gobo" | "channel" | "dimmer" | "circuit" | "patch" | "accessory" | "notes" | "weight";

export type ColumnWidth = "wide" | "medium" | "narrow";

export interface Field {
  readonly id: FieldId;
  readonly label: string;
  readonly value: (f: Fixture) => string | number;
  readonly width: ColumnWidth;
}

/** The lighting instruments' fields a schedule can show, in Available Fields' order. */
export const FIELDS: readonly Field[] = [
  { id: "position", label: "Position", value: (f) => f.position, width: "wide" },
  { id: "unit", label: "Unit Number", value: (f) => f.unit, width: "narrow" },
  { id: "type", label: "Instrument Type", value: (f) => f.label, width: "wide" },
  { id: "watts", label: "Wattage", value: (f) => f.watts, width: "narrow" },
  { id: "purpose", label: "Purpose", value: (f) => f.purpose, width: "medium" },
  { id: "color", label: "Color", value: (f) => f.color, width: "medium" },
  { id: "gobo", label: "Gobo", value: (f) => f.gobo, width: "medium" },
  { id: "channel", label: "Channel", value: (f) => f.channel, width: "narrow" },
  { id: "dimmer", label: "Dimmer", value: (f) => f.dimmer, width: "narrow" },
  { id: "circuit", label: "Circuit Number", value: (f) => f.circuit, width: "narrow" },
  { id: "patch", label: "DMX Address", value: (f) => patchText(f), width: "narrow" },
  { id: "accessory", label: "Accessories", value: (f) => f.accessory, width: "medium" },
  { id: "notes", label: "Notes", value: (f) => f.notes, width: "wide" },
  { id: "weight", label: "Weight (kg)", value: (f) => f.weightKg, width: "narrow" },
];

export const fieldOf = (id: FieldId): Field => FIELDS.find((f) => f.id === id)!;

export type ScheduleId = "instrument" | "channel" | "dimmer";

export interface ScheduleColumn {
  readonly field: FieldId;
  readonly width: ColumnWidth;
}

/** A schedule's Schedule Formatting: its printed name, its columns in order, and which text is bold. */
export interface ScheduleFormat {
  readonly printed: string;
  readonly columns: readonly ScheduleColumn[];
  readonly headBold: boolean;
  readonly bodyBold: boolean;
}

export interface Schedule {
  readonly id: ScheduleId;
  /** the worksheet's name and the printed name to start with */
  readonly name: string;
  readonly columns: readonly FieldId[];
}

/** Vectorworks' schedules, with the columns electricians' paperwork usually has. */
export const SCHEDULES: readonly Schedule[] = [
  { id: "instrument", name: "Instrument Schedule", columns: ["position", "unit", "type", "watts", "purpose", "color", "gobo", "channel", "dimmer", "circuit"] },
  { id: "channel", name: "Channel Hookup", columns: ["channel", "dimmer", "circuit", "position", "unit", "type", "watts", "purpose", "color", "notes"] },
  { id: "dimmer", name: "Dimmer Hookup", columns: ["dimmer", "channel", "circuit", "position", "unit", "type", "watts", "purpose", "color"] },
];

export const scheduleOf = (id: ScheduleId): Schedule => SCHEDULES.find((s) => s.id === id)!;

/** A schedule's formatting before Schedule Formatting changes it. */
export function defaultFormat(id: ScheduleId): ScheduleFormat {
  const s = scheduleOf(id);
  return { printed: s.name, columns: s.columns.map((field) => ({ field, width: fieldOf(field).width })), headBold: true, bodyBold: false };
}

export type HeaderItem = "" | "designer" | "event" | "date";

/** What the left, centre and right of the header line show. */
export interface HeaderConfig {
  readonly left: HeaderItem;
  readonly center: HeaderItem;
  readonly right: HeaderItem;
}

export interface EventInfo {
  readonly designer: string;
  readonly event: string;
  readonly date: string;
}

/** The print area, in points. */
export interface PageArea {
  readonly widthPt: number;
  readonly heightPt: number;
}

/** A row's height, points, as the other generated worksheets have */
export const ROW_HEIGHT = 14;
/** how much of the page each width takes against the others */
const SHARE: Readonly<Record<ColumnWidth, number>> = { wide: 3, medium: 2, narrow: 1 };
export const POINTS_PER_MM = 72 / 25.4;

/** Natural order, with blanks last. */
function blankLast(a: string, b: string): number {
  const [x, y] = [a.trim(), b.trim()];
  if (x === y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return naturalCompare(x, y);
}

const byKeys =
  (...keys: ((f: Fixture) => string)[]) =>
  (a: Fixture, b: Fixture): number => {
    for (const k of keys) {
      const d = blankLast(k(a), k(b));
      if (d) return d;
    }
    return 0;
  };

const SORTS: Readonly<Record<ScheduleId, (a: Fixture, b: Fixture) => number>> = {
  instrument: byKeys(
    (f) => f.position,
    (f) => f.unit,
    (f) => f.channel,
  ),
  channel: byKeys(
    (f) => f.channel,
    (f) => f.position,
    (f) => f.unit,
  ),
  dimmer: byKeys(
    (f) => f.dimmer,
    (f) => f.channel,
    (f) => f.position,
    (f) => f.unit,
  ),
};

/** The instruments a schedule lists, in its order: a Dimmer Hookup leaves out those with no dimmer. */
export function scheduleOrder(id: ScheduleId, list: readonly Fixture[]): Fixture[] {
  return list.filter((f) => id !== "dimmer" || f.dimmer.trim()).sort(SORTS[id]);
}

/** The text Header Configuration puts in a place, "" for nothing. */
function headerText(item: HeaderItem, info: EventInfo): string {
  return item === "designer" ? info.designer.trim() : item === "event" ? info.event.trim() : item === "date" ? info.date.trim() : "";
}

/** The header line across `columns` columns: left in the first, centre in the middle and right in the last; null when it says nothing. */
export function headerRow(columns: number, header: HeaderConfig, info: EventInfo): (NewSheetCell | null)[] | null {
  const n = Math.max(1, columns);
  const row: (NewSheetCell | null)[] = Array.from({ length: n }, () => null);
  const put = (col: number, text: string, align: NewSheetCell["align"]): void => {
    if (!text) return;
    const was = row[col];
    // two in one cell (a schedule of one or two columns) share it
    row[col] = was ? { value: `${String(was.value)}   ${text}`, align: was.align } : { value: text, align };
  };
  put(0, headerText(header.left, info), "left");
  put(Math.floor((n - 1) / 2), headerText(header.center, info), "center");
  put(n - 1, headerText(header.right, info), "right");
  return row.some(Boolean) ? row : null;
}

/** The columns' widths in points: the page's width shared out by Wide, Medium and Narrow. */
export function columnWidths(widths: readonly ColumnWidth[], pageWidthPt: number): number[] {
  const total = widths.reduce((sum, w) => sum + SHARE[w], 0);
  return widths.map((w) => Math.round(((pageWidthPt * SHARE[w]) / Math.max(1, total)) * 10) / 10);
}

export interface PaperworkPage {
  readonly header: HeaderConfig;
  readonly info: EventInfo;
  readonly page: PageArea;
}

/**
 * A worksheet named `name` of `body` under `heads`: the header line, `title` in bold and a blank row, then
 * the heads, at the top of every page's worth of rows.
 */
export function paperSheet(
  name: string,
  title: string,
  heads: readonly NewSheetCell[],
  body: readonly (NewSheetCell | null)[][],
  widths: readonly ColumnWidth[],
  paper: PaperworkPage,
): NewWorksheet {
  const header = headerRow(heads.length, paper.header, paper.info);
  const top: (NewSheetCell | null)[][] = [...(header ? [header] : []), [{ value: title, bold: true }], [], [...heads]];
  const perPage = Math.max(1, Math.floor(paper.page.heightPt / ROW_HEIGHT) - top.length);
  const rows: (NewSheetCell | null)[][] = [];
  for (let i = 0; i === 0 || i < body.length; i += perPage) rows.push(...top.map((r) => [...r]), ...body.slice(i, i + perPage));
  return { name, widths: columnWidths(widths, paper.page.widthPt), rowHeight: ROW_HEIGHT, rows };
}

const text = (value: string, bold: boolean, align?: NewSheetCell["align"]): NewSheetCell | null => (value === "" ? null : { value, bold: bold || undefined, align });
const figure = (value: number, bold = false): NewSheetCell | null => (value === 0 ? null : { value, format: 0, accuracy: Number.isInteger(value) ? 0 : 2, bold: bold || undefined, align: "right" });

/** A schedule's worksheet: one row per instrument it lists, in the format's columns. */
export function scheduleSheet(name: string, id: ScheduleId, list: readonly Fixture[], format: ScheduleFormat, paper: PaperworkPage): NewWorksheet {
  const fields = format.columns.map((c) => fieldOf(c.field));
  const heads = fields.map((f): NewSheetCell => ({ value: f.label, bold: format.headBold || undefined }));
  const body = scheduleOrder(id, list).map((fx) =>
    fields.map((f) => {
      const v = f.value(fx);
      return typeof v === "number" ? figure(v, format.bodyBold) : text(v.trim(), format.bodyBold);
    }),
  );
  return paperSheet(
    name,
    format.printed.trim() || scheduleOf(id).name,
    heads,
    body,
    format.columns.map((c) => c.width),
    paper,
  );
}

const bold = (value: string, align?: NewSheetCell["align"]): NewSheetCell => ({ value, bold: true, align });

/** The Color Cut List: each gel and frame size with its cuts and the sheets they take, for each position when `byPosition`. */
export function colorCutSheet(name: string, list: readonly Fixture[], byPosition: boolean, paper: PaperworkPage): NewWorksheet {
  const heads = [bold("Color"), bold("Name"), bold("Frame Size", "right"), bold("Cuts", "right"), bold("Sheets", "right")];
  const lines = (group: readonly Fixture[]): (NewSheetCell | null)[][] =>
    colorCuts(group).map((r) => [text(r.code, false), text(r.name, false), { value: `${r.frameIn}"`, align: "right" }, figure(r.cuts), figure(r.sheets)]);
  let body: (NewSheetCell | null)[][];
  if (!byPosition) body = lines(list);
  else {
    const positions = [...new Set(list.map((f) => f.position.trim()))].sort(blankLast);
    body = positions.flatMap((p) => {
      const rows = lines(list.filter((f) => f.position.trim() === p));
      return rows.length ? [[bold(p || "(no position)")], ...rows, []] : [];
    });
    if (body.length) body.pop();
  }
  return paperSheet(name, name, heads, body, ["medium", "wide", "narrow", "narrow", "narrow"], paper);
}

/** The Shop Order: each instrument type's count, wattage and weight, then the totals. */
export function shopOrderSheet(name: string, list: readonly Fixture[], paper: PaperworkPage): NewWorksheet {
  const heads = [bold("Instrument Type"), bold("Count", "right"), bold("Wattage", "right"), bold("Total Wattage", "right"), bold("Weight (kg)", "right"), bold("Total Weight (kg)", "right")];
  const { rows, total } = shopOrder(list);
  const body = rows.map((r) => [text(r.type || "(no type)", false), figure(r.count), figure(r.wattsEach), figure(r.watts), figure(r.weightEach), figure(r.weightKg)]);
  body.push([], [bold("Total"), figure(total.count, true), null, figure(total.watts, true), null, figure(total.weightKg, true)]);
  return paperSheet(name, name, heads, body, ["wide", "narrow", "narrow", "medium", "narrow", "medium"], paper);
}

/** The Gobo Pull: each gobo, how many, which units and types. */
export function goboPullSheet(name: string, list: readonly Fixture[], paper: PaperworkPage): NewWorksheet {
  const heads = [bold("Gobo"), bold("Count", "right"), bold("Units"), bold("Instrument Types")];
  const body = goboPull(list).map((r) => [text(r.gobo, false), figure(r.count), text(r.units, false), text(r.types, false)]);
  return paperSheet(name, name, heads, body, ["medium", "narrow", "wide", "wide"], paper);
}
