// Tools > Custom Selection…: selects the objects that meet every criterion set,
// as the Vectorworks command does. Each criterion is a type, class, symbol, fill
// colour, pen colour or line weight that an object is, or is not; the values
// offered are the ones the drawing has, with how many objects have each. It
// searches the active layer's top-level objects (the children of the group being
// edited, when one is), and replaces, adds to or removes from the selection.
// As in Vectorworks, it can instead write that as a VectorScript or Python script
// for a script palette (customScripts.ts): the type, class and symbol criteria as
// search criteria on the active layer. Find and Modify and Custom Modification
// (findModify.ts) find their objects with the same criteria.

import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { setSelection } from "./commands.ts";
import { allOf, criterionText, quoted, SCRIPT_MODES, selectionScript, typeCriterion, type ScriptMode, type SelectAction } from "./customScripts.ts";
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
  /** the criterion that `o`'s value is, or is not, as search criteria; null when its name holds a quote; absent when criteria can't say it */
  criterion?(o: ObjectInfo, is: boolean): string | null;
}

type Action = SelectAction;

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
    { id: "type", label: "Type", value: (o) => ({ key: o.typeName, label: typeLabel(o.typeName) }), criterion: (o, is) => typeCriterion(o.type, o.typeName, is) },
    {
      id: "class",
      label: "Class",
      value: (o) => ({ key: String(o.classIndex), label: o.className || "None" }),
      criterion: (o, is) => {
        const q = quoted(o.className || "None");
        return q && criterionText("C", q, is);
      },
    },
    {
      id: "symbol",
      label: "Symbol",
      value: (o) =>
        o.kind === "symbol" && o.symbol !== undefined
          ? { key: String(o.symbol), label: symbols.get(o.symbol) ?? `Symbol ${o.symbol}` }
          : null,
      criterion: (o, is) => {
        const q = o.symbol === undefined ? null : quoted(symbols.get(o.symbol) ?? "");
        return q && criterionText("S", q, is);
      },
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
  /** every criterion, and the active layer, as search criteria for a script; or why they can't be */
  script(): { readonly criteria: string } | { readonly error: string; readonly focus?: HTMLElement };
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
    script: () => {
      if (store.editGroupId) return { error: "A script searches a layer, not the group being edited: use Execute Immediately, or leave the group first." };
      const layer = doc.layers().find((l) => l.id === store.activeLayerId)?.name ?? "";
      const parts: string[] = [];
      for (const r of rows) {
        const c = r.read();
        if ("error" in c) return c;
        if (!c.field.criterion) return { error: `${c.field.label} can't be written as search criteria: use Execute Immediately.` };
        const sample = objects.find((o) => c.field.value(o)?.key === c.key);
        const part = sample ? c.field.criterion(sample, c.is) : null;
        if (!part) return { error: `${c.field.label}: a name with a quote (') in it can't be written as search criteria.` };
        parts.push(part);
      }
      const criteria = allOf(layer, parts);
      return criteria ? { criteria } : { error: "The active layer's name has a quote (') in it, which search criteria can't hold." };
    },
  };
}

/** Execute Immediately, Create VectorScript or Create Python Script, as Custom Selection and Custom Modification offer them. */
export function scriptModeSelect(): HTMLSelectElement {
  return h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cs-action", attrs: { "aria-label": "Execute" } },
    ...SCRIPT_MODES.map((m) => h("option", { value: m.id, text: m.label })),
  );
}

/** Opens Custom Selection and applies it, or writes it as a script. */
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
  const mode = scriptModeSelect();
  const where = store.editGroupId ? "the group being edited" : "the active layer";

  const result = await showDialog<{ ids: string[]; action: Action } | { script: string; language: "python" | "vectorscript" }>({
    title: "Custom Selection",
    okLabel: "OK",
    cls: "cs-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Execute" }), mode),
      h("p", { cls: "muted", text: `Objects in ${where} that meet every criterion:` }),
      ...criteria.body,
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Selection" }), action),
    ],
    check: () => {
      const m = mode.value as ScriptMode;
      if (m !== "now") {
        const s = criteria.script();
        return "error" in s ? { error: s.error, focus: s.focus ?? mode } : { value: { script: selectionScript(m, s.criteria, action.value as Action), language: m } };
      }
      const found = criteria.matches();
      return "error" in found ? found : { value: { ids: found.ids, action: action.value as Action } };
    },
  });
  if (!result) return;
  if ("script" in result) {
    const { addScript } = await import("../features/python/scriptPalettes.ts");
    await addScript(result.language, result.script, "Custom Selection");
    return;
  }

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
