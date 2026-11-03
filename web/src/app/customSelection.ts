// Tools > Custom Selection…: selects the objects that meet every criterion set,
// as the Vectorworks command does. Each criterion is a type, class, symbol, fill
// colour, pen colour or line weight that an object is, or is not; the values
// offered are the ones the drawing has, with how many objects have each. It
// searches the active layer's top-level objects (the children of the group being
// edited, when one is), and replaces, adds to or removes from the selection.
// Find and Modify (findModify.ts) finds its objects with the same criteria.

import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { typeLabel } from "./reportRows.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** mm per mil: line weights are kept in mils (1/1000 inch) */
const MM_PER_MIL = 0.0254;

/** An object's value for a criterion: what is compared, and what the dialog shows. */
interface Value {
  readonly key: string;
  readonly label: string;
}

interface Field {
  readonly id: string;
  readonly label: string;
  /** the object's value, or null when it has none (a symbol on a line, a fill on a group) */
  value(o: ObjectInfo): Value | null;
}

type Action = "replace" | "add" | "remove";

const ACTIONS: readonly { readonly id: Action; readonly label: string }[] = [
  { id: "replace", label: "Replace the selection" },
  { id: "add", label: "Add to the selection" },
  { id: "remove", label: "Remove from the selection" },
];

/** The criteria the dialog offers, reading values from `doc`. */
function fieldsOf(doc: VwxDocument): readonly Field[] {
  const symbols = new Map(doc.symbolDefs().map((s) => [s.index, s.name]));
  const names = new Map(doc.colors().map((c) => [c.css, c.name]));
  const colour = (index: number): Value => {
    const css = doc.color(index);
    const name = names.get(css);
    return { key: css, label: name ? `${name} (${css})` : css };
  };
  const none: Value = { key: "none", label: "None" };
  return [
    { id: "type", label: "Type", value: (o) => ({ key: o.typeName, label: typeLabel(o.typeName) }) },
    { id: "class", label: "Class", value: (o) => ({ key: String(o.classIndex), label: o.className || "None" }) },
    {
      id: "symbol",
      label: "Symbol",
      value: (o) =>
        o.kind === "symbol" && o.symbol !== undefined
          ? { key: String(o.symbol), label: symbols.get(o.symbol) ?? `Symbol ${o.symbol}` }
          : null,
    },
    { id: "fill", label: "Fill colour", value: (o) => (!o.attrs ? null : o.attrs.fillPattern === 0 ? none : colour(o.attrs.fillFore)) },
    { id: "pen", label: "Pen colour", value: (o) => (!o.attrs ? null : o.attrs.lineStyle === 0 ? none : colour(o.attrs.penFore)) },
    {
      id: "weight",
      label: "Line weight",
      value: (o) => (o.attrs ? { key: String(o.attrs.lineWeight), label: `${(o.attrs.lineWeight * MM_PER_MIL).toFixed(2)} mm` } : null),
    },
  ];
}

/** The objects Custom Selection searches: the active layer's top level, or the group being edited. */
export function scopeObjects(doc: VwxDocument): ObjectInfo[] {
  const layerId = store.activeLayerId;
  if (!layerId) return [];
  const scope = store.editGroupId;
  return doc.objects(layerId).filter((o) => o.parentId === scope && !isDerivedId(o.id));
}

/** The values `field` takes among `objects`, by key, with how many objects have each, sorted by label. */
function valuesOf(field: Field, objects: readonly ObjectInfo[]): { readonly value: Value; readonly count: number }[] {
  const found = new Map<string, { value: Value; count: number }>();
  for (const o of objects) {
    const v = field.value(o);
    if (!v) continue;
    const seen = found.get(v.key);
    if (seen) seen.count++;
    else found.set(v.key, { value: v, count: 1 });
  }
  return [...found.values()].sort((a, b) => a.value.label.localeCompare(b.value.label, undefined, { numeric: true }));
}

interface Criterion {
  readonly field: Field;
  readonly is: boolean;
  readonly key: string;
}

/** One criterion row: the field, is or is not, and the value; its value list follows the field. */
function criterionRow(fields: readonly Field[], objects: readonly ObjectInfo[], onRemove: (row: HTMLElement) => void) {
  const fieldSelect = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cs-field", attrs: { "aria-label": "Criterion" } },
    ...fields.map((f) => h("option", { value: f.id, text: f.label })),
  );
  const opSelect = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cs-op", attrs: { "aria-label": "Is or is not" } },
    h("option", { value: "is", text: "is" }),
    h("option", { value: "not", text: "is not" }),
  );
  const valueSelect = h("select", { cls: "menu-dialog-input menu-dialog-select cs-value", attrs: { "aria-label": "Value" } });
  const remove = h("button", { cls: "btn small cs-remove", text: "×", title: "Remove this criterion", attrs: { type: "button" } });
  const row = h("div", { cls: "cs-row" }, fieldSelect, opSelect, valueSelect, remove);
  const field = (): Field => fields.find((f) => f.id === fieldSelect.value) ?? fields[0];
  const fill = (): void => {
    const values = valuesOf(field(), objects);
    valueSelect.replaceChildren(...values.map((v) => h("option", { value: v.value.key, text: `${v.value.label} (${v.count})` })));
    valueSelect.disabled = values.length === 0;
    if (values.length === 0) valueSelect.append(h("option", { value: "", text: "None here" }));
  };
  fieldSelect.addEventListener("change", fill);
  remove.addEventListener("click", () => onRemove(row));
  fill();
  return {
    row,
    remove,
    read: (): Criterion | { error: string; focus: HTMLElement } =>
      valueSelect.disabled
        ? { error: `${field().label}: no object here has one.`, focus: fieldSelect }
        : { field: field(), is: opSelect.value === "is", key: valueSelect.value },
  };
}

/** The criteria part of the dialog: its rows, Add Criterion, and the objects that meet every criterion. */
export interface CriteriaEditor {
  readonly body: readonly HTMLElement[];
  /** the ids of `objects` that meet every criterion, or what is wrong with one */
  matches(): { readonly ids: string[] } | { readonly error: string; readonly focus: HTMLElement };
}

/** Criterion rows over `objects`, with values read from `doc`; one row to start with. */
export function criteriaEditor(doc: VwxDocument, objects: readonly ObjectInfo[]): CriteriaEditor {
  const fields = fieldsOf(doc);
  const rows: ReturnType<typeof criterionRow>[] = [];
  const list = h("div", { cls: "cs-list" });
  const syncRemove = (): void => {
    for (const r of rows) r.remove.disabled = rows.length === 1;
  };
  const addRow = (): void => {
    const r = criterionRow(fields, objects, (row) => {
      const i = rows.findIndex((x) => x.row === row);
      if (i >= 0 && rows.length > 1) {
        rows.splice(i, 1);
        row.remove();
        syncRemove();
      }
    });
    rows.push(r);
    list.append(r.row);
    syncRemove();
  };
  addRow();
  const add = h("button", { cls: "btn small", text: "Add Criterion", attrs: { type: "button" } });
  add.addEventListener("click", addRow);
  return {
    body: [list, h("div", { cls: "cs-add" }, add)],
    matches: () => {
      const criteria: Criterion[] = [];
      for (const r of rows) {
        const c = r.read();
        if ("error" in c) return c;
        criteria.push(c);
      }
      return { ids: objects.filter((o) => criteria.every((c) => (c.field.value(o)?.key === c.key) === c.is)).map((o) => o.id) };
    },
  };
}

/** Opens Custom Selection and applies it. */
export async function customSelectionDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc || !store.activeLayerId) return;
  const objects = scopeObjects(doc);
  if (objects.length === 0) {
    toast("The active layer has no objects to select.", "info");
    return;
  }
  const criteria = criteriaEditor(doc, objects);
  const action = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cs-action", attrs: { "aria-label": "Selection" } },
    ...ACTIONS.map((a) => h("option", { value: a.id, text: a.label })),
  );
  const where = store.editGroupId ? "the group being edited" : "the active layer";

  const result = await showDialog<{ ids: string[]; action: Action }>({
    title: "Custom Selection",
    okLabel: "Select",
    cls: "cs-dialog",
    body: [
      h("p", { cls: "muted", text: `Objects in ${where} that meet every criterion:` }),
      ...criteria.body,
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Selection" }), action),
    ],
    check: () => {
      const found = criteria.matches();
      return "error" in found ? found : { value: { ids: found.ids, action: action.value as Action } };
    },
  });
  if (!result) return;

  const next = new Set(result.action === "replace" ? [] : store.selection);
  for (const id of result.ids) {
    if (result.action === "remove") next.delete(id);
    else next.add(id);
  }
  setSelection(next);
  const n = result.ids.length;
  if (n === 0) toast("No objects meet those criteria.", "info");
  else toast(`${n} ${n === 1 ? "object meets" : "objects meet"} the criteria · ${next.size} selected`, "info");
}
