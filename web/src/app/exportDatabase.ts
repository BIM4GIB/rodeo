// File > Export > Export Database…, as Vectorworks has it: every record of one data record format
// the drawing's objects hold (on every layer, in groups too) as a file a database or spreadsheet
// reads, a row per object and a column per field, tab- or comma-delimited, with the field names in
// the first row when ticked. Lengths are in the document's units as Object Info shows them, areas
// as Rodeo shows them and volumes in cubic metres. Vectorworks' Merge, DIF and SYLK files aren't
// written.

import type { RecordField, VwxDocument } from "../core/index.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatArea, formatLengthValue } from "./units.ts";

/** The drawing's data record formats whose fields can be read. */
function formats(doc: VwxDocument): { format: number; name: string }[] {
  return doc.recordFormats().filter((f) => doc.recordFormatFields(f.format) !== null);
}

export function canExportDatabase(): boolean {
  const doc = store.session?.doc;
  return !!doc && formats(doc).length > 0;
}

/** Each object's fields of record format `format`, in the format's field order. */
export function databaseRows(doc: VwxDocument, format: number): RecordField[][] {
  const rows: RecordField[][] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (isDerivedId(o.id)) continue;
      const r = doc.records(o.id).find((x) => x.format === format && !x.parametric);
      if (r) rows.push(r.fields);
    }
  }
  return rows;
}

function cellText(f: RecordField, units: string | undefined): string {
  if (typeof f.value === "boolean") return f.value ? "True" : "False";
  if (typeof f.value === "string") return f.value;
  if (f.kind === "dimension") return formatLengthValue(f.value, units);
  if (f.kind === "area") return formatArea(f.value, units);
  if (f.kind === "volume") return `${Number((f.value / 1e9).toPrecision(9))} m³`;
  return String(f.value);
}

/** The file's text: tab-delimited (tabs and line breaks in values made spaces) or comma-delimited (quoted where needed). */
export function databaseText(names: readonly string[] | null, rows: readonly RecordField[][], comma: boolean, units: string | undefined): string {
  const cell = (s: string): string => (comma ? (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s) : s.replace(/[\t\r\n]+/g, " "));
  const lines = [...(names ? [names.map(cell)] : []), ...rows.map((fields) => fields.map((f) => cell(cellText(f, units))))];
  return lines.map((l) => l.join(comma ? "," : "\t")).join("\r\n") + "\r\n";
}

export async function exportDatabaseDialog(): Promise<void> {
  const doc = store.session?.doc;
  const list = doc ? formats(doc) : [];
  if (!doc || !list.length) {
    toast("This drawing has no record formats to export.", "info");
    return;
  }
  const format = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Record format" } },
    ...list.map((f) => h("option", { attrs: { translate: "no" }, value: String(f.format), text: f.name })),
  );
  const kind = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "File format" } },
    h("option", { value: "tab", text: "Tab-delimited" }),
    h("option", { value: "comma", text: "Comma-delimited" }),
  );
  const header = h("input", { checked: true, attrs: { type: "checkbox", "aria-label": "Field names in the first row" } });
  const count = h("p", { cls: "muted" });
  const recount = (): void => {
    const n = databaseRows(doc, Number(format.value)).length;
    count.textContent = `${n} object${n === 1 ? " holds" : "s hold"} this record.`;
  };
  format.addEventListener("change", recount);
  recount();
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const r = await showDialog<{ format: number; comma: boolean; header: boolean }>({
    title: "Export Database",
    okLabel: "Export",
    body: [field("Record format", format), field("File format", kind), h("label", { cls: "menu-dialog-check" }, header, "Field names in the first row"), count],
    check: () => {
      const f = Number(format.value);
      if (!databaseRows(doc, f).length) return { error: "No object holds a record of this format.", focus: format };
      return { value: { format: f, comma: kind.value === "comma", header: header.checked } };
    },
  });
  if (!r) return;
  const names = r.header ? (doc.recordFormatFields(r.format) ?? []).map((f) => f.name) : null;
  const text = databaseText(names, databaseRows(doc, r.format), r.comma, doc.info.units);
  const formatName = list.find((f) => f.format === r.format)?.name ?? "records";
  const base = store.fileName.replace(/\.vwx$/i, "");
  downloadBlob(`${base} ${formatName}.${r.comma ? "csv" : "txt"}`, new Blob([text], { type: r.comma ? "text/csv" : "text/plain" }));
}
