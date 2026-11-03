// Tools > Records > New Record Format… and Edit Record Format: a data record format's name and
// fields, as Vectorworks' Edit Record Format dialog sets them. Each field has a name, a type
// (integer, boolean, number, text or dimension for a new one; a kept field keeps its own, a
// choice or area too) and a default value, which a record starts with when it is attached. Fields
// can be added, removed and moved. Objects that have a record of the format keep their values in
// the fields kept, and new fields start at their defaults there. The change is one undo step.

import type { FieldKind, RecordField, RecordFieldSpec, RecordValue } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import type { Row } from "./menu.ts";
import { showDialog, type DialogCheck } from "./menubar.ts";
import { store } from "./state.ts";
import { formatLength, parseLength } from "./units.ts";
import "./recordFormatEditor.css";

/** the most UTF-16 units a field name takes (core/params.ts MAX_FIELD_NAME) */
const MAX_FIELD_NAME = 63;

/** what a new field can be */
const NEW_KINDS: readonly [FieldKind, string][] = [
  ["text", "Text"],
  ["integer", "Integer"],
  ["number", "Number"],
  ["dimension", "Dimension"],
  ["boolean", "Boolean"],
];

const KIND_LABEL: Partial<Record<FieldKind, string>> = {
  choice: "Choice",
  class: "Class",
  layer: "Layer",
  angle: "Angle",
  area: "Area",
  volume: "Volume",
  color: "Colour",
  ...Object.fromEntries(NEW_KINDS),
};

/** True with a drawing open: a new record format copies one the drawing has, or starts from Rodeo's own. */
export function canCreateRecordFormat(): boolean {
  return !!store.session;
}

/** Tools > Records > Edit Record Format: the drawing's data record formats, by name. */
export function editRecordFormatRows(): Row[] {
  const formats = store.session?.doc.recordFormats() ?? [];
  if (formats.length === 0) return [{ label: "No record formats", enabled: () => false, run: () => undefined }];
  return formats.map((f): Row => ({ label: f.name, run: () => void editRecordFormat(f.format) }));
}

interface FieldRow {
  readonly el: HTMLElement;
  /** the field it was, kept with its values; undefined for a new one */
  readonly from: string | undefined;
  readonly name: HTMLInputElement;
  readonly kind: HTMLSelectElement;
  /** the default: a checkbox for a boolean, else a text field */
  value: HTMLInputElement;
}

/** The default value's control for a field kind. */
function valueControl(kind: FieldKind, value: RecordValue): HTMLInputElement {
  if (kind === "boolean") return h("input", { cls: "rf-check", attrs: { type: "checkbox", "aria-label": "Default" }, checked: value === true });
  const units = store.session?.doc.info.units;
  const text = kind === "dimension" && typeof value === "number" ? formatLength(value, units) : String(value);
  return h("input", { cls: "rf-value", value: text, attrs: { type: "text", "aria-label": "Default", spellcheck: "false" } });
}

/** A default as its kind stores it, or an error. */
function readValue(kind: FieldKind, input: HTMLInputElement): { value: RecordValue } | { error: string } {
  if (kind === "boolean") return { value: input.checked };
  const t = input.value.trim();
  switch (kind) {
    case "integer":
    case "color": {
      const n = Number(t === "" ? "0" : t);
      return Number.isInteger(n) && Math.abs(n) <= 0x7fffffff ? { value: n } : { error: "takes a whole number" };
    }
    case "dimension": {
      if (t === "") return { value: 0 };
      const mm = parseLength(t, store.session?.doc.info.units);
      return mm === null ? { error: "takes a length" } : { value: mm };
    }
    case "number":
    case "angle":
    case "area":
    case "volume": {
      const n = Number(t === "" ? "0" : t.replace(",", "."));
      return Number.isFinite(n) ? { value: n } : { error: "takes a number" };
    }
    default:
      return { value: input.value };
  }
}

/** Tools > Records > New Record Format…: a new data record format with a first text field. */
export function newRecordFormat(): Promise<void> {
  return openEditor(null, [{ name: "Field 1", kind: "text", value: "" }]);
}

/** Edits the data record format with name index `format`. */
export function editRecordFormat(format: number): Promise<void> {
  const fields = store.session?.doc.recordFormatFields(format);
  if (!fields) return Promise.resolve();
  return openEditor(format, fields);
}

async function openEditor(format: number | null, fields: readonly RecordField[]): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const oldName = format === null ? "" : (doc.recordFormats().find((f) => f.format === format)?.name ?? "");
  const nameInput = h("input", {
    cls: "menu-dialog-input rf-name",
    value: format === null ? "New Record" : oldName,
    attrs: { type: "text", "aria-label": "Name", spellcheck: "false" },
  });
  const list = h("div", { cls: "rf-list", attrs: { role: "list" } });
  const rows: FieldRow[] = [];

  const render = (): void => {
    list.replaceChildren(...rows.map((r) => r.el));
    rows.forEach((r, i) => {
      r.el.querySelector<HTMLButtonElement>(".rf-up")!.disabled = i === 0;
      r.el.querySelector<HTMLButtonElement>(".rf-down")!.disabled = i === rows.length - 1;
      r.el.querySelector<HTMLButtonElement>(".rf-remove")!.disabled = rows.length === 1;
    });
  };

  const addRow = (field: RecordField, from: string | undefined): FieldRow => {
    const name = h("input", { cls: "rf-field", value: field.name, attrs: { type: "text", "aria-label": "Field name", spellcheck: "false" } });
    const kept = from !== undefined;
    const kind = h(
      "select",
      { cls: "rf-kind", attrs: { "aria-label": "Type" } },
      ...(kept ? [[field.kind, KIND_LABEL[field.kind] ?? field.kind] as const] : NEW_KINDS).map(([k, label]) => h("option", { value: k, text: label })),
    );
    kind.value = field.kind;
    // a kept field keeps its type, so its records' values stay readable
    kind.disabled = kept;
    if (kept) kind.title = "A kept field keeps its type; add a new field for another.";
    const cell = h("span", { cls: "rf-default" });
    const button = (cls: string, text: string, label: string): HTMLButtonElement =>
      h("button", { cls: `rf-btn ${cls}`, text, attrs: { type: "button", "aria-label": label, title: label } });
    const up = button("rf-up", "↑", "Move up");
    const down = button("rf-down", "↓", "Move down");
    const remove = button("rf-remove", "×", "Remove field");
    const el = h("div", { cls: "rf-row", attrs: { role: "listitem" } }, name, kind, cell, up, down, remove);
    const row: FieldRow = { el, from, name, kind, value: valueControl(field.kind, field.value) };
    cell.append(row.value);
    kind.addEventListener("change", () => {
      // a new type starts from its own empty default
      const k = kind.value as FieldKind;
      row.value = valueControl(k, k === "boolean" ? false : k === "text" ? "" : 0);
      cell.replaceChildren(row.value);
    });
    const move = (d: number): void => {
      const i = rows.indexOf(row);
      const j = i + d;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      render();
      (d < 0 ? up : down).focus();
    };
    up.addEventListener("click", () => move(-1));
    down.addEventListener("click", () => move(1));
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(row), 1);
      render();
    });
    return row;
  };

  for (const f of fields) rows.push(addRow(f, format === null ? undefined : f.name));
  render();
  const add = h("button", { cls: "btn rf-add", text: "Add Field", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    const taken = new Set(rows.map((r) => r.name.value.trim().toLowerCase()));
    let n = rows.length + 1;
    while (taken.has(`field ${n}`)) n++;
    const row = addRow({ name: `Field ${n}`, kind: "text", value: "" }, undefined);
    rows.push(row);
    render();
    row.name.focus();
    row.name.select();
  });

  const taken = new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.resources().map((r) => r.name),
  ]);
  const result = await showDialog<{ name: string; specs: RecordFieldSpec[] }>({
    title: format === null ? "New Record Format" : "Edit Record Format",
    okLabel: "OK",
    cls: "rf-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
      h("div", { cls: "rf-head", attrs: { "aria-hidden": "true" } }, h("span", { text: "Field" }), h("span", { text: "Type" }), h("span", { text: "Default" })),
      list,
      add,
      h("p", {
        cls: "muted",
        text:
          format === null
            ? "Attach the format to objects in Object Info's Data tab; each record starts with these defaults."
            : "Objects keep their values in the fields kept; new fields start at their defaults there, and removed fields go with their values. Worksheets and plug-ins that name a renamed field aren't changed.",
      }),
    ],
    check: (): DialogCheck<{ name: string; specs: RecordFieldSpec[] }> => {
      const name = nameInput.value.trim();
      if (!name) return { error: "Enter a name for the format.", focus: nameInput };
      if (name !== oldName && taken.has(name)) return { error: `"${name}" is already used in this drawing.`, focus: nameInput };
      if (rows.length === 0) return { error: "A record format needs a field.", focus: add };
      const seen = new Set<string>();
      const specs: RecordFieldSpec[] = [];
      for (const r of rows) {
        const field = r.from !== undefined && r.name.value === r.from ? r.from : r.name.value.trim();
        if (!field) return { error: "Every field needs a name.", focus: r.name };
        if (field.length > MAX_FIELD_NAME) return { error: `"${field}" is longer than ${MAX_FIELD_NAME} characters.`, focus: r.name };
        if (seen.has(field.toLowerCase())) return { error: `Two fields are named "${field}".`, focus: r.name };
        seen.add(field.toLowerCase());
        const kind = r.kind.value as FieldKind;
        const v = readValue(kind, r.value);
        if ("error" in v) return { error: `${field}: the default ${v.error}.`, focus: r.value };
        specs.push({ name: field, kind, value: v.value, ...(r.from !== undefined ? { from: r.from } : {}) });
      }
      return { value: { name, specs } };
    },
  });
  if (!result) return;
  if (format === null) {
    attempt("New record format", (s) => s.createRecordFormat(result.name, result.specs));
    return;
  }
  attempt("Edit record format", (s) =>
    s.batch(() => {
      s.editRecordFormat(format, result.specs);
      if (result.name !== oldName) s.renameResource(format, result.name);
    }),
  );
}
