// File > Export > Export Worksheet…, as Vectorworks' command does: one of the drawing's worksheets
// saved where the browser saves downloads, in the format chosen: tab-delimited text (.txt), CSV
// with commas or with semicolons between the values, DIF, SYLK, or an Excel workbook (.xlsx, plain
// numbers as numbers; export/xlsx.ts). The cells hold what they
// show, as last calculated (Rodeo doesn't recalculate worksheets yet), with database rows given as
// their rows on a sheet show them: the objects' rows in place of the header row. A merged cell's
// text is in its first cell. Delimited text is UTF-8, marked so spreadsheets read it as such; DIF
// and SYLK are Windows-1252, as Excel reads them.

import { delimitedText, difText, sylkText, windows1252, type DelimitedFormat } from "../export/delimited.ts";
import { xlsxWorkbook } from "../export/xlsx.ts";
import { downloadBlob } from "./fileio.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

type Format = DelimitedFormat | "dif" | "sylk" | "xlsx";

const FORMATS: readonly { readonly value: Format; readonly label: string }[] = [
  { value: "tab", label: "Tab-delimited (.txt)" },
  { value: "comma", label: "CSV, commas (.csv)" },
  { value: "semicolon", label: "CSV, semicolons (.csv)" },
  { value: "dif", label: "DIF (.dif)" },
  { value: "sylk", label: "SYLK (.slk)" },
  { value: "xlsx", label: "Excel workbook (.xlsx)" },
];
/** the byte order mark that tells spreadsheets the file is UTF-8 */
const BOM = "﻿";

let lastFormat: Format = "tab";

/** The drawing's worksheets, by name, as [name index, name]. */
function worksheets(): [number, string][] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .map((r): [number, string] => [r.index, r.name])
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: "base" }));
}

/** True when the drawing has a worksheet to export. */
export function canExportWorksheet(): boolean {
  return worksheets().length > 0;
}

/** The one selected worksheet image's worksheet, if any. */
function selectedWorksheet(): number | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id)?.worksheet ?? null;
}

/** Opens Export Worksheet and saves the file. */
export async function exportWorksheetDialog(): Promise<void> {
  const doc = store.session?.doc;
  const sheets = worksheets();
  if (!doc || sheets.length === 0) {
    toast("This drawing has no worksheet to export.", "info");
    return;
  }
  const select = (label: string): HTMLSelectElement => h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } });
  const sheet = select("Worksheet");
  for (const [index, name] of sheets) sheet.append(h("option", { attrs: { translate: "no" }, value: String(index), text: name }));
  const picked = selectedWorksheet();
  sheet.value = String(picked !== null && sheets.some(([i]) => i === picked) ? picked : sheets[0][0]);
  const format = select("Format");
  for (const f of FORMATS) format.append(h("option", { value: f.value, text: f.label }));
  format.value = lastFormat;
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const v = await showDialog<{ index: number; format: Format; rows: string[][] }>({
    title: "Export Worksheet",
    okLabel: "Export",
    body: [
      field("Worksheet", sheet),
      field("Format", format),
      h("p", {
        cls: "muted",
        text: "The values are the ones last calculated; database rows give the objects' rows, as on a sheet.",
      }),
    ],
    check: () => {
      const index = Number(sheet.value);
      const rows = doc.worksheetRows(index);
      if (!rows) return { error: "This worksheet can't be read.", focus: sheet };
      return { value: { index, format: format.value as Format, rows } };
    },
  });
  if (!v) return;
  lastFormat = v.format;
  const name = sheets.find(([i]) => i === v.index)?.[1] ?? "Worksheet";
  const file = name.replace(/[\\/:*?"<>|]+/g, "-");
  if (v.format === "xlsx") {
    const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    downloadBlob(`${file}.xlsx`, new Blob([xlsxWorkbook(name, v.rows) as BlobPart], { type }));
    return;
  }
  if (v.format === "dif" || v.format === "sylk") {
    const text = v.format === "dif" ? difText(v.rows, name) : sylkText(v.rows);
    const { bytes, lost } = windows1252(text);
    downloadBlob(`${file}.${v.format === "dif" ? "dif" : "slk"}`, new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
    if (lost) toast(`${lost} ${lost === 1 ? "character" : "characters"} ${v.format === "dif" ? "DIF" : "SYLK"} can't hold became "?": export as CSV or Excel to keep them.`, "info");
    return;
  }
  const ext = v.format === "tab" ? "txt" : "csv";
  const type = v.format === "tab" ? "text/plain" : "text/csv";
  downloadBlob(`${file}.${ext}`, new Blob([BOM + delimitedText(v.rows, v.format)], { type: `${type};charset=utf-8` }));
}
