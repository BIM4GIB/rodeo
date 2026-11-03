// Tools > Reports > Edit Worksheet…: a worksheet's cells as a grid, as Vectorworks' worksheet
// window shows them, for editing its plain cells. A cell is picked by clicking it or with the
// arrow keys from the entry bar above the grid, which edits it; Enter (down), Tab (right) or an
// up or down arrow keeps the change. A number entered makes a number cell, anything else a text
// cell, and an empty entry clears the cell. Formula cells show their last results and database
// rows their headers, read-only: neither is edited here yet. The changes go into the drawing
// together on Done, as one undo step, and the sheets' worksheet images redraw from them.

import type { SheetCell, WorksheetContents } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import "./worksheetEditor.css";

/** what a cell's entry may be: a plain number makes a number cell */
const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;

/** The column's letters: A to Z, then AA, AB and on. */
export function columnName(col: number): string {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** An entry as the cell it makes: a number, or text ("" clears it); an error for a formula. */
export function parseEntry(raw: string): { value: string | number } | { error: string } {
  const t = raw.trim();
  if (t.startsWith("=")) return { error: "Formulas can't be entered here yet: enter a number or text." };
  if (t === "") return { value: "" };
  return NUMBER.test(t) ? { value: Number(t) } : { value: raw };
}

/** The drawing's worksheets, by name, as [name index, name]. */
function worksheets(): [number, string][] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .map((r): [number, string] => [r.index, r.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

/** The worksheet of the one selected worksheet image, if any. */
function selectedWorksheet(): number | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id)?.worksheet ?? null;
}

/** True when the drawing has a worksheet to edit. */
export function canEditWorksheet(): boolean {
  return worksheets().length > 0;
}

/** Opens the editor on worksheet `index` (a name index), or on the selected worksheet image's or the first one's. */
export async function editWorksheet(index?: number): Promise<void> {
  const doc = store.session?.doc;
  const sheets = worksheets();
  if (!doc || sheets.length === 0) return;
  let at = index ?? selectedWorksheet() ?? sheets[0][0];
  /** edits not yet in the drawing, by worksheet then "row,col" */
  const pending = new Map<number, Map<string, string | number>>();
  const edits = (): Map<string, string | number> => {
    let m = pending.get(at);
    if (!m) pending.set(at, (m = new Map()));
    return m;
  };

  const picker = h(
    "select",
    { cls: "ws-picker", attrs: { "aria-label": "Worksheet" } },
    ...sheets.map(([i, name]) => h("option", { value: String(i), text: name })),
  );
  const ref = h("span", { cls: "ws-ref", attrs: { "aria-live": "polite" } });
  const entry = h("input", { cls: "ws-entry", attrs: { type: "text", "aria-label": "Cell contents", spellcheck: "false", autocomplete: "off" } });
  const hint = h("p", { cls: "ws-hint muted" });
  const scroll = h("div", { cls: "ws-scroll" });

  let sheet: WorksheetContents | null = null;
  let cells = new Map<string, SheetCell>();
  let tds: HTMLTableCellElement[][] = [];
  let row = 0;
  let col = 0;

  /** What a cell's entry bar starts with: its text, its number's full value, or a formula's result. */
  const entryOf = (r: number, c: number): string => {
    const key = `${r},${c}`;
    const p = edits().get(key);
    if (p !== undefined) return String(p);
    const cell = cells.get(key);
    if (!cell) return "";
    return cell.kind === "number" && cell.value !== null ? String(cell.value) : cell.display;
  };

  /** Why a cell can't be edited, or null when it can. */
  const lockedWhy = (r: number, c: number): string | null => {
    if (sheet?.database[r]) return "Database row: its cells are column formulas over the objects it lists, and can't be edited here yet.";
    if (cells.get(`${r},${c}`)?.kind === "formula") return "Formula cell: it shows its last result; formulas can't be edited here yet.";
    return null;
  };

  const pickCell = (r: number, c: number): void => {
    if (!sheet) return;
    row = Math.max(0, Math.min(sheet.rows - 1, r));
    col = Math.max(0, Math.min(sheet.cols - 1, c));
    for (const line of tds) for (const td of line) td.classList.remove("on");
    const td = tds[row]?.[col];
    td?.classList.add("on");
    td?.scrollIntoView({ block: "nearest", inline: "nearest" });
    ref.textContent = `${columnName(col)}${row + 1}`;
    entry.value = entryOf(row, col);
    const why = lockedWhy(row, col);
    entry.readOnly = why !== null;
    hint.textContent = why ?? "Enter a number or text; Enter or Tab keeps it. Changes go into the drawing on Done.";
    hint.classList.remove("error");
  };

  /** Keeps the entry bar's change in the picked cell; false when it was refused. */
  const keep = (): boolean => {
    if (!sheet || entry.readOnly || entry.value === entryOf(row, col)) return true;
    const parsed = parseEntry(entry.value);
    if ("error" in parsed) {
      hint.textContent = parsed.error;
      hint.classList.add("error");
      return false;
    }
    const key = `${row},${col}`;
    const old = cells.get(key);
    const same = old ? (old.kind === "number" ? old.value === parsed.value : old.display === parsed.value) : parsed.value === "";
    if (same) edits().delete(key);
    else edits().set(key, parsed.value);
    const td = tds[row][col];
    td.textContent = same ? (old?.display ?? "") : String(parsed.value);
    td.classList.toggle("edited", !same);
    td.classList.toggle("num", same ? old !== undefined && old.kind !== "text" : typeof parsed.value === "number");
    return true;
  };

  const build = (): void => {
    sheet = doc.worksheetContents(at);
    picker.value = String(at);
    if (!sheet || sheet.rows === 0 || sheet.cols === 0) {
      sheet = null;
      tds = [];
      scroll.replaceChildren(h("p", { cls: "ws-empty muted", text: "This worksheet can't be read." }));
      ref.textContent = "";
      entry.value = "";
      entry.readOnly = true;
      hint.textContent = "";
      return;
    }
    cells = new Map(sheet.cells.map((c) => [`${c.row},${c.col}`, c]));
    const mine = edits();
    const head = h(
      "tr",
      {},
      h("th", { cls: "ws-corner" }),
      ...Array.from({ length: sheet.cols }, (_, c) => h("th", { cls: "ws-col", text: columnName(c), attrs: { scope: "col" } })),
    );
    tds = [];
    const body = h("tbody");
    for (let r = 0; r < sheet.rows; r++) {
      const db = sheet.database[r];
      const line: HTMLTableCellElement[] = [];
      for (let c = 0; c < sheet.cols; c++) {
        const cell = cells.get(`${r},${c}`);
        const p = mine.get(`${r},${c}`);
        const td = h("td", { text: p !== undefined ? String(p) : (cell?.display ?? "") });
        if (p !== undefined) td.classList.add("edited");
        if (p !== undefined ? typeof p === "number" : cell && cell.kind !== "text") td.classList.add("num");
        if (cell?.kind === "formula") td.classList.add("formula");
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        line.push(td);
      }
      tds.push(line);
      body.append(h("tr", { cls: db ? "db" : "" }, h("th", { cls: "ws-row", text: db ? `${r + 1} ▸` : String(r + 1), attrs: { scope: "row" } }), ...line));
    }
    const table = h("table", { cls: "ws-grid" }, h("thead", {}, head), body);
    table.addEventListener("pointerdown", (e) => {
      const td = (e.target as HTMLElement).closest("td");
      if (!td?.dataset.row) return;
      // a click keeps the entry first, as Enter would; a refused entry keeps its cell
      e.preventDefault();
      if (keep()) pickCell(Number(td.dataset.row), Number(td.dataset.col));
      entry.focus();
    });
    scroll.replaceChildren(table);
    pickCell(Math.min(row, sheet.rows - 1), Math.min(col, sheet.cols - 1));
  };

  picker.addEventListener("change", () => {
    if (!keep()) {
      picker.value = String(at);
      return;
    }
    at = Number(picker.value);
    row = 0;
    col = 0;
    build();
    entry.focus();
  });

  entry.addEventListener("keydown", (e) => {
    const step = (dr: number, dc: number): void => {
      e.preventDefault();
      if (keep()) pickCell(row + dr, col + dc);
    };
    if (e.key === "Enter") step(e.shiftKey ? -1 : 1, 0);
    else if (e.key === "Tab") step(0, e.shiftKey ? -1 : 1);
    else if (e.key === "ArrowUp") step(-1, 0);
    else if (e.key === "ArrowDown") step(1, 0);
    else if (e.key === "Escape" && entry.value !== entryOf(row, col)) {
      // the first Esc drops the entry's change; the next closes the editor
      e.preventDefault();
      e.stopPropagation();
      pickCell(row, col);
    }
  });

  build();
  const shown = showDialog<true>({
    title: "Edit Worksheet",
    okLabel: "Done",
    cls: "ws-dialog",
    body: [
      sheets.length > 1 ? h("div", { cls: "ws-top" }, picker) : h("p", { cls: "ws-name", text: sheets.find(([i]) => i === at)?.[1] ?? "" }),
      h("div", { cls: "ws-bar" }, ref, entry),
      scroll,
      hint,
    ],
    check: () => (keep() ? { value: true } : { error: "That cell's entry can't be kept: change it or press Esc.", focus: entry }),
  });
  // the dialog focuses its first control, the picker; editing starts in the entry bar
  entry.focus();
  entry.select();
  const done = await shown;
  if (!done || ![...pending.values()].some((m) => m.size > 0)) return;
  attempt("Edit worksheet", (s) =>
    s.batch(() => {
      for (const [index, m] of pending) {
        for (const [key, value] of m) {
          const [r, c] = key.split(",").map(Number);
          s.setWorksheetCell(index, r, c, value);
        }
      }
    }),
  );
}
