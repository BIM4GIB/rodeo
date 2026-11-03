// Checks the Visibility Grid's core calls against real drawings, under Node. Run from web/:
//   npx tsx src/features/visgrid/check.ts ../samples/sample.vwx [more.vwx ...]
// Reads each file into memory and never writes one: edits are made to the in-memory session and
// checked through doc.viewport(), undo, redo and a save to bytes that is re-opened.
//
// Bulk writes are bounded: each setter in a batch rebuilds the drawing's index, which takes seconds
// on the large demo drawings, so a whole-grid paint runs only on small grids (MAX_FULL_CELLS).

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { openVwx } from "../../core/index.ts";
import type { VwxDocument, Visibility } from "../../core/index.ts";
import { applyCells, cellAt, gridData, nextVisibility, type CellWrite, type GridData } from "./grid.ts";

const MAX_FULL_CELLS = 200;
const ROW_SAMPLE = 3;

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

/** Every viewport's listed classes and layers, as the document reports them: the state an undo must restore. */
function snapshot(doc: VwxDocument): string {
  const out: unknown[] = [];
  for (const l of doc.layers()) if (l.kind === "sheet") for (const id of doc.viewportIds(l.id)) out.push(doc.viewport(id));
  return JSON.stringify(out);
}

/** The grid's values as text, one line per row, for comparing two states. */
function matrix(data: GridData): string {
  return data.rows.map((_, r) => data.columns.map((_, c) => cellAt(data, r, c).value[0]).join("")).join("\n");
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t };
}

function runFile(file: string): void {
  const t0 = performance.now();
  const s = openVwx(new Uint8Array(readFileSync(file)), basename(file));
  const doc = s.doc;
  const sheets = doc.layers().filter((l) => l.kind === "sheet");
  const viewportCount = sheets.reduce((n, l) => n + doc.viewportIds(l.id).length, 0);
  console.log(`  ${doc.info.records} records, ${sheets.length} sheet layers, ${viewportCount} viewports, ${doc.classes().length} classes (opened in ${Math.round(performance.now() - t0)} ms)`);
  if (viewportCount === 0) {
    check(gridData(doc, "classes").columns.length === 0, "no viewports: the grid has no columns (it says so)");
    return;
  }

  for (const tab of ["classes", "layers"] as const) {
    const data = gridData(doc, tab);
    console.log(`  ${tab}: ${data.rows.length} rows x ${data.columns.length} columns in ${data.sheets.length} sheets`);
    check(data.columns.length === viewportCount, `${tab}: every viewport on a sheet is a column`);
    if (data.rows.length === 0 || data.columns.length === 0) continue;

    const before = snapshot(doc);
    const beforeMatrix = matrix(data);
    const undoable = s.canUndo();

    // one cell: cycle it, read it back through the grid and doc.viewport(), undo it
    const row = 0;
    const col = data.columns.length - 1;
    const first = cellAt(data, row, col);
    const next = nextVisibility(first.value);
    const single = timed(() => applyCells(s, data, [{ row, col, value: next }]));
    check(single.value === 1, `${tab}: one cell changes (${Math.round(single.ms)} ms)`);
    const after = gridData(s.doc, tab);
    check(cellAt(after, row, col).value === next, `${tab}: the grid reads ${next} back`);
    const vp = s.doc.viewport(data.columns[col].id)!;
    const key = data.rows[row].key;
    const seen = tab === "classes" ? vp.classes.find((c) => c.index === key)?.visibility : vp.layers.find((l) => l.id === key)?.visibility;
    check(seen === next, `${tab}: doc.viewport() reflects ${next}`);
    s.undo();
    check(snapshot(s.doc) === before, `${tab}: undo restores every viewport`);
    check(s.canUndo() === undoable, `${tab}: that cell edit was a single undo step`);

    // a write that changes nothing is left out and makes no undo step
    const same = applyCells(s, data, [{ row, col, value: first.value }]);
    check(same === 0 && snapshot(s.doc) === before, `${tab}: writing the value a cell shows changes nothing`);

    // a row, several viewports at once: one batch, one undo step, and redo brings it back
    const cols = Math.min(ROW_SAMPLE, data.columns.length);
    const target: Visibility = cellAt(data, row, 0).value === "hidden" ? "visible" : "hidden";
    const rowWrites: CellWrite[] = Array.from({ length: cols }, (_, c) => ({ row, col: c, value: target }));
    const rowRun = timed(() => applyCells(s, data, rowWrites));
    check(rowRun.value >= 1, `${tab}: a row write across ${cols} viewports changes cells`);
    const rowAfter = matrix(gridData(s.doc, tab));
    console.log(`  ${tab}: ${rowRun.value} of ${cols} cells set to ${target} in one batch (${Math.round(rowRun.ms)} ms)`);
    // a saved copy of the edited drawing re-opens with the row as written
    const reopened = openVwx(s.doc.toBytes(), basename(file));
    check(matrix(gridData(reopened.doc, tab)) === rowAfter, `${tab}: a saved copy re-opens with the row`);
    s.undo();
    check(matrix(gridData(s.doc, tab)) === beforeMatrix, `${tab}: one undo restores the row`);
    s.redo();
    check(matrix(gridData(s.doc, tab)) === rowAfter, `${tab}: redo brings the row back`);
    s.undo();

    // a whole grid in one step, only where it is small enough to run here
    const cells = data.rows.length * data.columns.length;
    if (cells <= MAX_FULL_CELLS) {
      const all: CellWrite[] = data.rows.flatMap((_, r) => data.columns.map((_, c) => ({ row: r, col: c, value: "grayed" as Visibility })));
      const paint = timed(() => applyCells(s, data, all));
      console.log(`  ${tab}: ${paint.value} of ${cells} cells grayed in one batch (${Math.round(paint.ms)} ms)`);
      const grayed = matrix(gridData(s.doc, tab));
      s.undo();
      check(snapshot(s.doc) === before, `${tab}: undo restores the whole grid`);
      applyCells(s, data, all);
      const reopened = openVwx(s.doc.toBytes(), basename(file));
      check(matrix(gridData(reopened.doc, tab)) === grayed, `${tab}: a saved copy re-opens with the same cells`);
      s.undo();
    } else {
      console.log(`  ${tab}: whole-grid paint skipped here (${cells} cells; see the batch cost in the report)`);
    }
  }
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: npx tsx src/features/visgrid/check.ts <file.vwx> [...]");
  process.exit(2);
}
for (const file of files) {
  console.log(`\n${file}`);
  runFile(file);
}
console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
