// Tools > Records > Change One Field… and Change All Fields…, as Vectorworks has them: values of a
// data record attached to symbol definitions, set for every definition in a symbol folder (and the
// folders in it), at the top level (None) or in the whole drawing (All). Change One Field sets one
// field; Change All Fields lists the format's fields in a second dialog, named for the record, and
// sets those ticked. Both say how many definitions will change and ask first. Only definitions with
// the record attached change, and instances already placed keep their own records. One undo step.

import type { FieldKind, RecordField, RecordValue, SymbolInfo, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { parseLength } from "./units.ts";
import "./symbolFields.css";

/** Field kinds a value can be typed for; areas and volumes are worked out, and "other" isn't readable. */
const EDITABLE: ReadonlySet<FieldKind> = new Set(["integer", "boolean", "number", "angle", "dimension", "color", "text", "choice", "class", "layer"]);

const ALL = "\u0000all";
const NONE = "\u0000none";

export function canChangeSymbolFields(): boolean {
  const doc = store.session?.doc;
  return !!doc && doc.symbolDefs().length > 0 && doc.recordFormats().length > 0;
}

/** The Symbol Folder and Record Format lists both dialogs open with. */
function scopeControls(doc: VwxDocument): { folder: HTMLSelectElement; format: HTMLSelectElement; body: Node[] } {
  const folders = [...new Set(doc.symbolDefs().flatMap((d) => d.folders ?? (d.folder ? [d.folder] : [])))].sort((a, b) => a.localeCompare(b));
  const folder = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Symbol Folder" } },
    h("option", { value: NONE, text: "None" }),
    h("option", { value: ALL, text: "All" }),
    ...folders.map((f) => h("option", { attrs: { translate: "no" }, value: f, text: f })),
  );
  folder.value = ALL;
  const format = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Record Format" } },
    ...doc.recordFormats().map((f) => h("option", { attrs: { translate: "no" }, value: String(f.format), text: f.name })),
  );
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  return { folder, format, body: [field("Symbol Folder", folder), field("Record Format", format)] };
}

/** The definitions in the scope chosen that have a record of `format`. */
function targets(doc: VwxDocument, scope: string, format: number): SymbolInfo[] {
  return doc.symbolDefs().filter((d) => {
    const chain = d.folders ?? (d.folder ? [d.folder] : []);
    const inScope = scope === ALL || (scope === NONE ? chain.length === 0 : chain.includes(scope));
    return inScope && doc.symbolRecords(d.index).some((r) => r.format === format);
  });
}

/** A control for a field's new value, and a reader that gives the value or an error. */
function valueControl(doc: VwxDocument, f: RecordField): { el: HTMLElement; read: () => RecordValue | { error: string } } {
  if (f.kind === "boolean") {
    const box = h("input", { attrs: { type: "checkbox", "aria-label": f.name } });
    box.checked = f.value === true;
    return { el: box, read: () => box.checked };
  }
  if (f.kind === "class" || f.kind === "layer") {
    const names = f.kind === "class" ? doc.classes().map((c) => c.name) : doc.layers().map((l) => l.name);
    const sel = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": f.name } }, ...names.map((n) => h("option", { attrs: { translate: "no" }, value: n, text: n })));
    sel.value = names.includes(String(f.value)) ? String(f.value) : (names[0] ?? "");
    return { el: sel, read: () => sel.value };
  }
  const input = h("input", { cls: "menu-dialog-input", value: String(f.value), attrs: { type: "text", "aria-label": f.name } });
  const read = (): RecordValue | { error: string } => {
    const t = input.value.trim();
    if (f.kind === "text" || f.kind === "choice") return input.value;
    if (f.kind === "dimension") return parseLength(t, doc.info.units) ?? { error: `${f.name} takes a length.` };
    const n = Number(t);
    if (t === "" || !Number.isFinite(n)) return { error: `${f.name} takes a number.` };
    if ((f.kind === "integer" || f.kind === "color") && !Number.isInteger(n)) return { error: `${f.name} takes a whole number.` };
    return n;
  };
  return { el: input, read };
}

/** Asks before changing, then sets the fields on every definition; one undo step. */
async function apply(doc: VwxDocument, defs: readonly SymbolInfo[], format: number, fields: Record<string, RecordValue>): Promise<void> {
  const name = doc.recordFormats().find((f) => f.format === format)?.name ?? "";
  const n = defs.length;
  if (!(await confirmDialog("Change Fields", `Change the "${name}" record of ${n} symbol definition${n === 1 ? "" : "s"}? Symbols already placed keep their own values.`, "Change"))) return;
  const done = attempt("Change Fields", (s) => s.setSymbolRecordFields(format, defs.map((d) => ({ symbol: d.index, fields }))));
  if (done) toast(`${n} symbol definition${n === 1 ? "" : "s"} changed.`, "info");
}

/** Tools > Records > Change One Field…: one field of a record on symbol definitions. */
export async function changeOneFieldDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const { folder, format, body } = scopeControls(doc);
  const fieldList = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Field Name" } });
  const valueSlot = h("span", { cls: "menu-dialog-value" });
  let control: ReturnType<typeof valueControl> | null = null;
  const fields = (): RecordField[] => (doc.recordFormatFields(Number(format.value)) ?? []).filter((f) => EDITABLE.has(f.kind) && !f.name.startsWith("__"));
  const showValue = (): void => {
    const f = fields().find((x) => x.name === fieldList.value);
    control = f ? valueControl(doc, f) : null;
    valueSlot.replaceChildren(...(control ? [control.el] : []));
  };
  const showFields = (): void => {
    fieldList.replaceChildren(...fields().map((f) => h("option", { attrs: { translate: "no" }, value: f.name, text: f.name })));
    showValue();
  };
  format.addEventListener("change", showFields);
  fieldList.addEventListener("change", showValue);
  showFields();
  const r = await showDialog<{ scope: string; format: number; field: string; value: RecordValue }>({
    title: "Change One Field",
    okLabel: "OK",
    body: [
      ...body,
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Field Name" }), fieldList),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "New Value" }), valueSlot),
      h("p", { cls: "muted", text: "Symbol definitions with this record change; symbols already placed keep their own values." }),
    ],
    check: () => {
      if (!control) return { error: "The record format has no field to change.", focus: format };
      const v = control.read();
      if (typeof v === "object") return { error: v.error, focus: control.el };
      return { value: { scope: folder.value, format: Number(format.value), field: fieldList.value, value: v } };
    },
  });
  if (!r) return;
  const defs = targets(doc, r.scope, r.format);
  if (!defs.length) {
    toast("No symbol definition there has that record.", "info");
    return;
  }
  await apply(doc, defs, r.format, { [r.field]: r.value });
}

/** Tools > Records > Change All Fields…: the scope and format, then the record's fields to set. */
export async function changeAllFieldsDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const { folder, format, body } = scopeControls(doc);
  const first = await showDialog<{ scope: string; format: number }>({
    title: "Change All Fields",
    okLabel: "OK",
    body,
    check: () => ({ value: { scope: folder.value, format: Number(format.value) } }),
  });
  if (!first) return;
  const defs = targets(doc, first.scope, first.format);
  if (!defs.length) {
    toast("No symbol definition there has that record.", "info");
    return;
  }
  const rows = (doc.recordFormatFields(first.format) ?? [])
    .filter((f) => EDITABLE.has(f.kind) && !f.name.startsWith("__"))
    .map((f) => ({ f, tick: h("input", { attrs: { type: "checkbox", "aria-label": `Change ${f.name}` } }), control: valueControl(doc, f) }));
  if (!rows.length) {
    toast("That record format has no field to change.", "info");
    return;
  }
  // a value edited ticks its field
  for (const row of rows) row.control.el.addEventListener("input", () => (row.tick.checked = true));
  const name = doc.recordFormats().find((f) => f.format === first.format)?.name ?? "";
  const values = await showDialog<Record<string, RecordValue>>({
    title: `Change Fields: ${name}`,
    okLabel: "OK",
    cls: "change-fields-dialog",
    body: [
      h("p", { cls: "muted", text: "Tick the fields to change and give their new values." }),
      h("div", { cls: "change-fields" }, ...rows.map((r) => h("label", { cls: "menu-dialog-field" }, r.tick, h("span", { cls: "menu-dialog-label", text: r.f.name }), r.control.el))),
    ],
    check: () => {
      const out: Record<string, RecordValue> = {};
      for (const r of rows) {
        if (!r.tick.checked) continue;
        const v = r.control.read();
        if (typeof v === "object") return { error: v.error, focus: r.control.el };
        out[r.f.name] = v;
      }
      return Object.keys(out).length ? { value: out } : { error: "Tick a field to change.", focus: rows[0].tick };
    },
  });
  if (!values) return;
  await apply(doc, defs, first.format, values);
}
