// The worksheet Import Worksheet (worksheetImport.ts) makes of a sheet read from a file: its
// rows to the last holding a value, each as wide as the file sets it or as its widest value, and
// plain numbers as number cells with the decimals they're written with. Kept apart from the
// dialog so it runs without the page.

import type { NewSheetCell, NewWorksheet } from "../core/index.ts";
import type { ImportedSheet } from "../import/worksheet.ts";
import { widthOf } from "./reportRows.ts";

/** points, as reports' rows */
const ROW_HEIGHT = 18;
/** a row's place and a column's are u16 points */
const MAX_ROWS = Math.floor(0xffff / ROW_HEIGHT);
const MAX_POINTS = 0xffff;

/** Decimal places a number is written with (0.125: 3), at most 10. */
function decimals(n: number): number {
  const s = String(n);
  const places = (/\.(\d+)/.exec(s)?.[1].length ?? 0) + Number(/e-(\d+)/.exec(s)?.[1] ?? 0);
  return Math.min(10, places);
}

/** The worksheet to make of `sheet`, or why it can't be made. */
export function newWorksheet(name: string, sheet: ImportedSheet): NewWorksheet | string {
  const lines = sheet.rows.map((r) => {
    let end = r.length;
    while (end > 0 && !r[end - 1]) end--;
    return r.slice(0, end);
  });
  while (lines.length && lines[lines.length - 1].length === 0) lines.pop();
  if (lines.length === 0) return `"${sheet.name}" holds no values.`;
  if (lines.length > MAX_ROWS) return `a worksheet holds at most ${MAX_ROWS.toLocaleString()} rows, and this one has ${lines.length.toLocaleString()}.`;
  const cols = Math.max(...lines.map((l) => l.length));
  const widths = Array.from({ length: cols }, (_, c) => {
    const set = sheet.widths[c];
    if (set !== undefined) return Math.max(8, Math.min(600, set));
    return widthOf(lines.map((l) => (l[c] ? String(l[c].value) : "")));
  });
  if (widths.reduce((a, b) => a + b, 0) > MAX_POINTS) return `its ${cols.toLocaleString()} columns are too wide for a worksheet.`;
  const rows = lines.map((l) =>
    l.map((cell): NewSheetCell | null => {
      if (!cell) return null;
      const out: NewSheetCell = { value: cell.value };
      if (cell.bold) out.bold = true;
      if (cell.align) out.align = cell.align;
      if (typeof cell.value === "number") {
        out.format = 0;
        out.accuracy = decimals(cell.value);
      }
      return out;
    }),
  );
  return { name, widths, rowHeight: ROW_HEIGHT, rows };
}
