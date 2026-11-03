// What Tools > Reports > Create Report (createReport.ts) puts in its worksheet: a header row of
// the chosen columns' names, then a row per object, or with Summarize a row per set of objects
// whose text columns agree, with a Count column first and their numbers added up. Lengths are
// dimension cells in the document's units and areas area cells (square metres, or square feet in
// an imperial drawing), as Vectorworks' worksheets keep them. Kept apart from the dialog so it
// runs without the page.

import type { NewSheetCell, NewWorksheet, ObjectInfo, RecordValue } from "../core/index.ts";
import { measureShape } from "./dimension.ts";
import { millimetresPerUnit } from "./units.ts";

/** rows of objects a report holds, its header row aside (a row's place on the sheet is a u16 of points) */
export const MAX_REPORT_ROWS = 3000;
/** points */
const ROW_HEIGHT = 18;
/** worksheet number formats */
const GENERAL = 0;
const DIMENSION = 5;
const AREA = 11;
/** points per character of a column's widest entry, and its margins */
const CHAR_POINTS = 6.2;
const MIN_WIDTH = 44;
const MAX_WIDTH = 240;

export interface ReportColumn {
  readonly id: string;
  readonly label: string;
  /** the object's entry: text, a number, or null when it has none */
  value(o: ObjectInfo): string | number | null;
  /** how a number shows: a worksheet number format and its accuracy */
  readonly format?: number;
  readonly accuracy?: number;
}

/** "rounded-rectangle" → "Rounded rectangle", "3d-polygon" → "3D polygon". */
export function typeLabel(typeName: string): string {
  const words = typeName.replace(/-/g, " ").replace(/\b3d\b/g, "3D");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function imperial(units: string | undefined): boolean {
  const u = (units ?? "").toLowerCase();
  return u.includes("feet") || u.includes("foot") || u.includes("inch");
}

/** A record field's value as a cell holds it. */
function fieldValue(v: RecordValue): string | number {
  return typeof v === "boolean" ? (v ? "True" : "False") : v;
}

/**
 * The columns a report can have: Type, Name, Class, Layer, Area, Perimeter and Length, then each
 * record field in `fields` (format and field names) read with `record`.
 */
export function reportColumns(
  units: string | undefined,
  layerName: (id: string) => string,
  fields: readonly { readonly format: string; readonly field: string }[],
  record: (o: ObjectInfo, format: string, field: string) => RecordValue | null,
): ReportColumn[] {
  const perUnit = millimetresPerUnit(units);
  const lengthAccuracy = imperial(units) ? 4 : Math.min(10, Math.max(0, Math.round(Math.log10(perUnit))));
  const area = (mm2: number): number => mm2 / (imperial(units) ? 304.8 * 304.8 : 1e6);
  const measure = (o: ObjectInfo) => (o.shape ? measureShape(o.shape) : null);
  return [
    { id: "type", label: "Type", value: (o) => typeLabel(o.typeName) },
    { id: "name", label: "Name", value: (o) => o.name || null },
    { id: "class", label: "Class", value: (o) => o.className || "None" },
    { id: "layer", label: "Layer", value: (o) => layerName(o.layerId) },
    {
      id: "area",
      label: "Area",
      format: AREA,
      accuracy: 2,
      value: (o) => {
        const m = measure(o);
        return m?.kind === "closed" ? area(m.area) : null;
      },
    },
    {
      id: "perimeter",
      label: "Perimeter",
      format: DIMENSION,
      accuracy: lengthAccuracy,
      value: (o) => {
        const m = measure(o);
        return m?.kind === "closed" ? m.perimeter / perUnit : null;
      },
    },
    {
      id: "length",
      label: "Length",
      format: DIMENSION,
      accuracy: lengthAccuracy,
      value: (o) => {
        const m = measure(o);
        return m?.kind === "length" || m?.kind === "arc" ? m.length / perUnit : null;
      },
    },
    ...fields.map(
      (f): ReportColumn => ({
        id: `field:${f.format}\n${f.field}`,
        label: `${f.format}.${f.field}`,
        format: GENERAL,
        accuracy: 3,
        value: (o) => {
          const v = record(o, f.format, f.field);
          return v === null ? null : fieldValue(v);
        },
      }),
    ),
  ];
}

/** Compares two entries: numbers before text, numbers by size, text as people sort it. */
function compare(a: string | number | null, b: string | number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** A column's width in points from its entries' lengths. */
export function widthOf(texts: readonly string[]): number {
  const longest = Math.max(...texts.map((t) => [...t].length));
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest * CHAR_POINTS + 14)));
}

/**
 * The report's worksheet: `columns` over `objects`, sorted by the columns in order when `sort`,
 * and with `summarize` one row per set of objects whose text entries agree, a Count column
 * first and each number column the sum of theirs. Null when it would have more than
 * MAX_REPORT_ROWS rows.
 */
export function reportSheet(
  name: string,
  objects: readonly ObjectInfo[],
  columns: readonly ReportColumn[],
  options: { readonly sort: boolean; readonly summarize: boolean },
): NewWorksheet | null {
  let lines: (string | number | null)[][] = objects.map((o) => columns.map((c) => c.value(o)));
  let counts: number[] | null = null;
  if (options.summarize) {
    const groups = new Map<string, { line: (string | number | null)[]; count: number }>();
    for (const line of lines) {
      // the text entries are the set's key; its numbers add up
      const key = JSON.stringify(line.map((v) => (typeof v === "number" ? 0 : v)));
      const g = groups.get(key);
      if (!g) groups.set(key, { line: [...line], count: 1 });
      else {
        g.count++;
        line.forEach((v, i) => {
          if (typeof v !== "number") return;
          const sum = g.line[i];
          g.line[i] = typeof sum === "number" ? sum + v : v;
        });
      }
    }
    lines = [...groups.values()].map((g) => g.line);
    counts = [...groups.values()].map((g) => g.count);
  }
  if (lines.length > MAX_REPORT_ROWS) return null;
  const order = lines.map((_, i) => i);
  if (options.sort) {
    order.sort((a, b) => {
      for (let c = 0; c < columns.length; c++) {
        const d = compare(lines[a][c], lines[b][c]);
        if (d) return d;
      }
      return a - b;
    });
  }
  const numeric = columns.map((c, i) => c.format !== undefined && lines.some((l) => typeof l[i] === "number"));
  const cellOf = (c: ReportColumn, v: string | number | null): NewSheetCell | null =>
    v === null || v === "" ? null : typeof v === "number" ? { value: v, format: c.format ?? GENERAL, accuracy: c.accuracy ?? 3 } : { value: v };
  const head: (NewSheetCell | null)[] = columns.map((c, i) => ({ value: c.label, bold: true, align: numeric[i] ? "right" : undefined }));
  const body = order.map((i) => columns.map((c, k) => cellOf(c, lines[i][k])));
  const texts = columns.map((c, k) => [c.label, ...lines.map((l) => (typeof l[k] === "number" ? (l[k] as number).toFixed(2) : String(l[k] ?? "")))]);
  const widths = texts.map(widthOf);
  if (counts) {
    const n = counts;
    head.unshift({ value: "Count", bold: true, align: "right" });
    order.forEach((i, r) => body[r].unshift({ value: n[i], format: GENERAL, accuracy: 0 }));
    widths.unshift(widthOf(["Count", ...n.map(String)]));
  }
  return { name, widths, rowHeight: ROW_HEIGHT, rows: [head, ...body] };
}
