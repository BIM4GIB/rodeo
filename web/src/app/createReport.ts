// Tools > Reports > Create Report…: a new worksheet listing objects and the columns chosen of
// them, as Vectorworks' Create Report makes one. The objects are the selection, the active
// layer's (the group being edited's), the visible design layers' or every design layer's top-level
// objects, optionally only those meeting Custom Selection's criteria. The columns are Type, Name,
// Class, Layer, Area, Perimeter and Length, and the fields of the records and plug-in parameters
// those objects hold. Rows can be sorted by the columns in order and summarized (reportRows.ts).
//
// Vectorworks writes a database row whose formulas recalculate; Rodeo can't write formulas yet,
// so the report holds the values as they are now. The worksheet is made from one the drawing
// has (its settings and a plain cell's font: core createWorksheet), so a drawing with no
// worksheet can't have a report yet. The report opens in the worksheet editor once made.

import type { ObjectInfo, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { criteriaEditor, scopeObjects, type CriteriaEditor } from "./customSelection.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { MAX_REPORT_ROWS, reportColumns, reportSheet, type ReportColumn } from "./reportRows.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { editWorksheet } from "./worksheetEditor.ts";
import "./createReport.css";

type Scope = "selection" | "layer" | "visible" | "all";

/** the built-in columns a report starts with */
const STARTING = new Set(["type", "class", "layer", "area"]);

/** The objects of `scope`, top-level ones of design layers but for the selection. */
function objectsOf(doc: VwxDocument, scope: Scope): ObjectInfo[] {
  if (scope === "selection") return [...store.selection].filter((id) => !isDerivedId(id)).flatMap((id) => doc.object(id) ?? []);
  if (scope === "layer") return scopeObjects(doc);
  return doc
    .layers()
    .filter((l) => l.kind === "design" && (scope === "all" || l.visibility === "visible"))
    .flatMap((l) => doc.objects(l.id).filter((o) => o.parentId === null && !isDerivedId(o.id)));
}

/** The record and plug-in fields `objects` hold, by format then field, in the order first met. */
function fieldsOf(doc: VwxDocument, objects: readonly ObjectInfo[]): { format: string; field: string }[] {
  const seen = new Map<string, { format: string; field: string }>();
  for (const o of objects) {
    for (const r of doc.records(o.id)) {
      for (const f of r.fields) {
        const key = `${r.name}\n${f.name}`;
        if (!seen.has(key)) seen.set(key, { format: r.name, field: f.name });
      }
    }
  }
  return [...seen.values()];
}

/** "Report-1", or the first of Report-2, Report-3 … that nothing in the drawing is called. */
function freeName(taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`Report-${n}`)) n++;
  return `Report-${n}`;
}

function check(label: string, on: boolean): { box: HTMLInputElement; row: HTMLLabelElement } {
  const box = h("input", { attrs: { type: "checkbox" }, checked: on });
  return { box, row: h("label", { cls: "menu-dialog-check" }, box, h("span", { text: label })) };
}

/** Asks what to report, then makes the worksheet and opens it. */
export async function createReportDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const sheets = doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .sort((a, b) => a.index - b.index);
  if (sheets.length === 0) {
    toast("Create Report makes its worksheet from one the drawing has, and this drawing has none yet.", "info");
    return;
  }
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.layers().map((l) => l.name)]);
  const layerNames = new Map(doc.layers().map((l) => [l.id, l.name]));

  const name = h("input", { cls: "menu-dialog-input cr-name", value: freeName(taken), attrs: { type: "text", "aria-label": "Report name", spellcheck: "false" } });
  const scopes: { id: Scope; label: string }[] = [
    ...(store.selection.size ? [{ id: "selection" as const, label: `Selected objects (${store.selection.size})` }] : []),
    { id: "layer", label: store.editGroupId ? "The group being edited" : "The active layer" },
    { id: "visible", label: "Visible design layers" },
    { id: "all", label: "All design layers" },
  ];
  const scope = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cr-scope", attrs: { "aria-label": "Objects" } },
    ...scopes.map((s) => h("option", { value: s.id, text: s.label })),
  );
  const only = check("Only objects that meet these criteria:", false);
  const criteriaBox = h("div", { cls: "cr-criteria", hidden: true });
  const builtIn = reportColumns(doc.info.units, (id) => layerNames.get(id) ?? "", [], () => null);
  const builtInChecks = builtIn.map((c) => ({ column: c.id, ...check(c.label, STARTING.has(c.id)) }));
  const fieldList = h("div", { cls: "cr-fields", attrs: { role: "group", "aria-label": "Record fields" } });
  let fieldChecks: { field: { format: string; field: string }; box: HTMLInputElement; row: HTMLLabelElement }[] = [];
  const sort = check("Sort by the columns in order", true);
  const summarize = check("Summarize: one row per set of objects alike, with a count and their numbers added up", false);
  const from = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cr-from", attrs: { "aria-label": "Format from" } },
    ...sheets.map((s) => h("option", { value: String(s.index), text: s.name })),
  );

  let objects: ObjectInfo[] = [];
  let criteria: CriteriaEditor | null = null;
  /** Reads the scope's objects again, with criteria and fields to match. */
  const refresh = (): void => {
    objects = objectsOf(doc, scope.value as Scope);
    criteria = objects.length ? criteriaEditor(doc, objects) : null;
    criteriaBox.replaceChildren(...(criteria?.body ?? [h("p", { cls: "muted", text: "No objects here." })]));
    const kept = new Set(fieldChecks.filter((f) => f.box.checked).map((f) => `${f.field.format}\n${f.field.field}`));
    fieldChecks = fieldsOf(doc, objects).map((field) => ({ field, ...check(`${field.format}.${field.field}`, kept.has(`${field.format}\n${field.field}`)) }));
    fieldList.replaceChildren(...(fieldChecks.length ? fieldChecks.map((f) => f.row) : [h("p", { cls: "muted", text: "These objects hold no records." })]));
  };
  scope.addEventListener("change", refresh);
  only.box.addEventListener("change", () => (criteriaBox.hidden = !only.box.checked));
  refresh();

  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const result = await showDialog<{ sheet: NonNullable<ReturnType<typeof reportSheet>>; from: number; count: number }>({
    title: "Create Report",
    okLabel: "Create",
    cls: "cs-dialog cr-dialog",
    body: [
      field("Name", name),
      field("Objects", scope),
      only.row,
      criteriaBox,
      h("p", { cls: "cr-head", text: "Columns" }),
      h("div", { cls: "cr-columns" }, ...builtInChecks.map((c) => c.row)),
      h("p", { cls: "cr-head", text: "Record and plug-in fields" }),
      fieldList,
      sort.row,
      summarize.row,
      ...(sheets.length > 1 ? [field("Format from", from)] : []),
      h("p", {
        cls: "muted",
        text: "The report holds the values as they are now: it doesn't recalculate as the drawing changes, since Rodeo can't write worksheet formulas yet. Its font and settings come from a worksheet the drawing has.",
      }),
    ],
    check: () => {
      const title = name.value.trim();
      if (!title) return { error: "Name the report.", focus: name };
      if (taken.has(title)) return { error: `"${title}" is already used in this drawing.`, focus: name };
      let chosen = objects;
      if (only.box.checked) {
        if (!criteria) return { error: "There are no objects here to report.", focus: scope };
        const found = criteria.matches();
        if ("error" in found) return found;
        const ids = new Set(found.ids);
        chosen = objects.filter((o) => ids.has(o.id));
      }
      if (chosen.length === 0) return { error: "No objects to report: choose others, or other criteria.", focus: scope };
      const records = new Map<string, ReturnType<VwxDocument["records"]>>();
      const recordOf = (o: ObjectInfo, format: string, fieldName: string): RecordValue | null => {
        let rs = records.get(o.id);
        if (!rs) records.set(o.id, (rs = doc.records(o.id)));
        return rs.find((r) => r.name === format)?.fields.find((f) => f.name === fieldName)?.value ?? null;
      };
      const fields = fieldChecks.filter((f) => f.box.checked).map((f) => f.field);
      const wanted = new Set(builtInChecks.filter((c) => c.box.checked).map((c) => c.column));
      const columns: ReportColumn[] = reportColumns(doc.info.units, (id) => layerNames.get(id) ?? "", fields, recordOf).filter(
        (c) => wanted.has(c.id) || c.id.startsWith("field:"),
      );
      if (columns.length === 0) return { error: "Choose a column to report.", focus: builtInChecks[0].box };
      const sheet = reportSheet(title, chosen, columns, { sort: sort.box.checked, summarize: summarize.box.checked });
      if (!sheet) return { error: `A report holds at most ${MAX_REPORT_ROWS.toLocaleString()} rows: narrow the objects, or summarize them.`, focus: scope };
      return { value: { sheet, from: Number(from.value), count: chosen.length } };
    },
  });
  if (!result) return;
  const made = attempt("Create Report", (s) => s.createWorksheet(result.sheet, result.from));
  if (!made) return;
  const rows = result.sheet.rows.length - 1;
  const n = result.count;
  toast(`${result.sheet.name}: ${n} ${n === 1 ? "object" : "objects"} in ${rows} ${rows === 1 ? "row" : "rows"}.`, "info");
  await editWorksheet(made.value);
}
