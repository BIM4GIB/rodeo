// File > Import > Import Worksheet…, as Vectorworks' command does: a tab-delimited (.txt), CSV,
// DIF, SYLK or Excel (.xlsx) file becomes a new worksheet resource named after the file, which
// opens in the worksheet editor. A workbook of several sheets asks which, as Vectorworks' Excel
// Import Options do (keeping a reference to the file isn't offered: Rodeo can't save one). Plain
// numbers become number cells with the decimals they're written with, the rest text; a workbook's
// values are the ones it last calculated, with its bold, alignment and column widths. Like Create
// Report, the worksheet takes its settings and font from one the drawing has, so a drawing with
// none can't import one yet. A dropped .csv, .dif, .slk or .xlsx imports the same way.

import { readWorksheetFile, type ImportedSheet } from "../import/worksheet.ts";
import { attempt } from "./commands.ts";
import { fileIn } from "./ext.ts";
import { h } from "./dom.ts";
import { newWorksheet } from "./importedSheet.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { editWorksheet } from "./worksheetEditor.ts";

const ACCEPT = ".txt,.tsv,.csv,.dif,.slk,.sylk,.xlsx,.xlsm,.xls,text/plain,text/csv,text/tab-separated-values";

/** A file a drop imports as a worksheet (tab-delimited .txt aside, which might be anything). */
export function isWorksheetFile(name: string): boolean {
  return /\.(csv|tsv|dif|slk|sylk|xlsx|xlsm)$/i.test(name);
}

/** The drawing has a worksheet to copy settings from; says why not when it hasn't. */
function ready(): boolean {
  const doc = store.session?.doc;
  if (!doc) return false;
  if (!doc.resources().some((r) => r.kind === "worksheet")) {
    toast("Import Worksheet makes its worksheet from one the drawing has, and this drawing has none yet.", "info");
    return false;
  }
  return true;
}

/** File > Import > Import Worksheet…: asks for the file, then imports it. */
export function importWorksheetFile(): void {
  if (!ready()) return;
  const input = h("input", { attrs: { type: "file", accept: ACCEPT }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void importWorksheet(file);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/** Imports `file` as a new worksheet and opens it. */
export async function importWorksheet(file: File): Promise<void> {
  if (!ready()) return;
  let sheets: ImportedSheet[];
  try {
    sheets = readWorksheetFile(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    fileIn(file, file.name, errorMessage(err));
    return;
  }
  const doc = store.session?.doc;
  if (!doc) return;
  let chosen = sheets[0];
  if (sheets.length > 1) {
    const select = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Sheet" } },
      ...sheets.map((s, i) => h("option", { value: String(i), text: s.name })),
    );
    // the first sheet holding values
    select.value = String(Math.max(0, sheets.findIndex((s) => s.rows.some((r) => r.some(Boolean)))));
    const picked = await showDialog<number>({
      title: "Excel Import Options",
      okLabel: "Import",
      body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Sheet" }), select)],
      check: () => ({ value: Number(select.value) }),
    });
    if (picked === null) return;
    chosen = sheets[picked];
  }
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.layers().map((l) => l.name)]);
  const base = file.name.replace(/\.[^.]+$/, "").trim() || "Worksheet";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  const sheet = newWorksheet(name, chosen);
  if (typeof sheet === "string") {
    toast(`Could not import ${file.name}: ${sheet}`);
    fileIn(file, file.name, sheet);
    return;
  }
  const made = attempt("Import Worksheet", (s) => s.createWorksheet(sheet));
  if (!made) return;
  const rows = sheet.rows.length;
  const cols = sheet.widths.length;
  const f = chosen.uncalculated ?? 0;
  const empty = f ? ` ${f} ${f === 1 ? "formula" : "formulas"} the file holds with no value calculated ${f === 1 ? "was" : "were"} left empty: open it in a spreadsheet and save it again to keep ${f === 1 ? "its value" : "their values"}.` : "";
  toast(`${name}: ${rows} ${rows === 1 ? "row" : "rows"} and ${cols} ${cols === 1 ? "column" : "columns"} imported.${empty}`, "info");
  fileIn(file, file.name);
  await editWorksheet(made.value);
}
