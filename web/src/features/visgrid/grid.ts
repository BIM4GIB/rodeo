// The Visibility Grid's table, read from an open drawing and written through its edit session.
// Nothing here touches the DOM, so check.ts can run it under Node.
//
// A viewport lists the classes and design layers it sets. A class it doesn't list shows the class's
// own visibility (the renderer's rule), so such a cell is "inherited": it shows that visibility, and a
// click sets an explicit one. A design layer it doesn't list is hidden, as ViewportInfo reports it.

import type { EditSession, VwxDocument, Visibility } from "../../core/index.ts";

export type GridTab = "classes" | "layers";

/** One viewport on a sheet layer: a column of the grid. */
export interface GridColumn {
  readonly id: string;
  /** its name, "" when it has none */
  readonly name: string;
  /** what the grid calls it: its name, or "Viewport n" by its place on the sheet */
  readonly label: string;
  /** a plan, drawn live from its design layers; else a section, elevation or detail drawn from the file's copy */
  readonly plan: boolean;
  /** drawing scale (48 for 1:48) */
  readonly scale: number;
  /** index into GridData.sheets */
  readonly sheet: number;
}

/** A sheet layer that holds viewports: a group of columns. */
export interface GridSheet {
  readonly id: string;
  /** the sheet number (the layer's name) */
  readonly number: string;
  readonly title: string;
  /** index of its first column, and how many it has */
  readonly first: number;
  readonly count: number;
}

/** A class or a design layer: a row of the grid. */
export interface GridRow {
  /** the class index, or the design layer's id */
  readonly key: number | string;
  readonly name: string;
  /** a class's own visibility, what a viewport shows for a class it doesn't list; null for a design layer */
  readonly base: Visibility | null;
}

export interface GridData {
  readonly tab: GridTab;
  readonly sheets: readonly GridSheet[];
  readonly columns: readonly GridColumn[];
  readonly rows: readonly GridRow[];
  /** per column: what the viewport lists, by row key */
  readonly listed: readonly ReadonlyMap<number | string, Visibility>[];
}

export interface Cell {
  readonly value: Visibility;
  /** true when the viewport doesn't list the class, so the cell shows the class's own visibility */
  readonly inherited: boolean;
}

/** A change to one cell: row and column are indices into the GridData. */
export interface CellWrite {
  readonly row: number;
  readonly col: number;
  readonly value: Visibility;
}

/** The state a click gives: visible, then grayed, then hidden, then visible again. */
export function nextVisibility(v: Visibility): Visibility {
  return v === "visible" ? "grayed" : v === "grayed" ? "hidden" : "visible";
}

/** Reads the grid for the drawing: the sheet layers that hold viewports, their viewports, and the classes or design layers. */
export function gridData(doc: VwxDocument, tab: GridTab): GridData {
  const layers = doc.layers();
  const sheets: GridSheet[] = [];
  const columns: GridColumn[] = [];
  const listed: Map<number | string, Visibility>[] = [];
  for (const sheet of layers) {
    if (sheet.kind !== "sheet") continue;
    const cols: { column: Omit<GridColumn, "sheet">; listed: Map<number | string, Visibility> }[] = [];
    doc.viewportIds(sheet.id).forEach((id, i) => {
      const v = doc.viewport(id);
      if (!v) return;
      const map =
        tab === "classes"
          ? new Map<number | string, Visibility>(v.classes.map((c) => [c.index, c.visibility]))
          : new Map<number | string, Visibility>(v.layers.map((l) => [l.id, l.visibility]));
      cols.push({
        column: { id, name: v.name, label: v.name || `Viewport ${i + 1}`, plan: v.plan, scale: v.scale },
        listed: map,
      });
    });
    if (cols.length === 0) continue;
    const sheetIndex = sheets.length;
    sheets.push({ id: sheet.id, number: sheet.name, title: sheet.title, first: columns.length, count: cols.length });
    for (const c of cols) {
      columns.push({ ...c.column, sheet: sheetIndex });
      listed.push(c.listed);
    }
  }
  const rows: GridRow[] =
    tab === "classes"
      ? doc.classes().map((c) => ({ key: c.index, name: c.name, base: c.visibility }))
      : layers.filter((l) => l.kind === "design").map((l) => ({ key: l.id, name: l.name, base: null }));
  return { tab, sheets, columns, rows, listed };
}

/** What a cell shows now. */
export function cellAt(data: GridData, row: number, col: number): Cell {
  const r = data.rows[row];
  const hit = data.listed[col].get(r.key);
  if (hit !== undefined) return { value: hit, inherited: false };
  return { value: r.base ?? "hidden", inherited: r.base !== null };
}

/**
 * Sets cells as one undo step, through the session's setters. A write that changes nothing is left
 * out (a cell already showing its value keeps its inheritance), and a cell written twice takes its
 * last value. Returns how many cells changed.
 */
export function applyCells(session: EditSession, data: GridData, writes: readonly CellWrite[]): number {
  const last = new Map<string, CellWrite>();
  for (const w of writes) last.set(`${w.row},${w.col}`, w);
  const todo = [...last.values()].filter((w) => cellAt(data, w.row, w.col).value !== w.value);
  if (todo.length === 0) return 0;
  session.batch(() => {
    for (const w of todo) {
      const viewport = data.columns[w.col].id;
      const key = data.rows[w.row].key;
      if (data.tab === "classes") session.setViewportClass(viewport, key as number, w.value);
      else session.setViewportLayer(viewport, key as string, w.value);
    }
  });
  return todo.length;
}
