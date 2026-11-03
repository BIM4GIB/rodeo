// Tools > Find and Modify…: finds objects with the criteria Custom Selection
// uses and changes every one found at once, as the Vectorworks command does:
// their class, fill or pen colour, line weight, opacity, the definition a symbol
// shows, or the layer they are on. All the changes are one undo step.

import type { VwxDocument } from "../core/index.ts";
import { setSelection } from "./commands.ts";
import { criteriaEditor, scopeObjects } from "./customSelection.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { colorSwatch } from "./panels/colorPicker.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

/** mm per mil: line weights are kept in mils (1/1000 inch) */
const MM_PER_MIL = 0.0254;

type Change =
  | { readonly id: "class"; readonly index: number }
  | { readonly id: "fill"; readonly color: number }
  | { readonly id: "pen"; readonly color: number }
  | { readonly id: "weight"; readonly mils: number }
  | { readonly id: "opacity"; readonly percent: number }
  | { readonly id: "symbol"; readonly symbol: number }
  | { readonly id: "layer"; readonly layerId: string };

type ChangeId = Change["id"];

type Read = Change | { readonly error: string; readonly focus: HTMLElement };

/** A change row's value control, and how to read it. */
interface Control {
  readonly el: HTMLElement;
  read(): Read;
}

const select = (label: string, options: readonly (readonly [string, string])[]): HTMLSelectElement =>
  h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select fm-value", attrs: { "aria-label": label } },
    ...options.map(([value, text]) => h("option", { value, text })),
  );

/** The changes the dialog offers for `doc` (a symbol only when it has some, a layer outside a group). */
function changeKinds(doc: VwxDocument): { readonly id: ChangeId; readonly label: string; control(): Control }[] {
  const black = doc.colors().find((c) => c.css === "#000000")?.index ?? doc.colors()[0]?.index ?? 0;
  const colour = (id: "fill" | "pen", label: string) => (): Control => {
    let color = black;
    const slot = h("span", { cls: "fm-value" });
    const draw = (): void => {
      slot.replaceChildren(
        colorSwatch({
          doc,
          value: color,
          label,
          onPick: (index) => {
            color = index;
            draw();
          },
        }),
      );
    };
    draw();
    return { el: slot, read: () => ({ id, color }) };
  };
  const number = (label: string, value: number, unit: string, min: number, max: number, make: (v: number) => Change) => (): Control => {
    const input = h("input", {
      cls: "menu-dialog-input fm-number",
      value: String(value),
      attrs: { type: "number", min: String(min), max: String(max), step: "any", "aria-label": label },
    });
    return {
      el: h("span", { cls: "fm-value fm-with-unit" }, input, h("span", { cls: "muted", text: unit })),
      read: () => {
        const v = Number(input.value);
        return Number.isFinite(v) && v >= min && v <= max
          ? make(v)
          : { error: `${label}: enter a number from ${min} to ${max}.`, focus: input };
      },
    };
  };
  const kinds: { id: ChangeId; label: string; control(): Control }[] = [
    {
      id: "class",
      label: "Class",
      control: () => {
        const s = select(
          "Class",
          [...doc.classes()].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [String(c.index), c.name] as const),
        );
        return { el: s, read: () => ({ id: "class", index: Number(s.value) }) };
      },
    },
    { id: "fill", label: "Fill colour", control: colour("fill", "Fill colour") },
    { id: "pen", label: "Pen colour", control: colour("pen", "Pen colour") },
    {
      id: "weight",
      label: "Line weight",
      control: number("Line weight", 0.25, "mm", 0, 25, (v) => ({ id: "weight", mils: Math.round(v / MM_PER_MIL) })),
    },
    { id: "opacity", label: "Opacity", control: number("Opacity", 100, "%", 0, 100, (v) => ({ id: "opacity", percent: Math.round(v) })) },
  ];
  const symbols = doc.symbolDefs();
  if (symbols.length) {
    kinds.push({
      id: "symbol",
      label: "Symbol",
      control: () => {
        const s = select(
          "Symbol",
          symbols.map((d) => [String(d.index), d.folder ? `${d.folder} / ${d.name}` : d.name] as const),
        );
        return { el: s, read: () => ({ id: "symbol", symbol: Number(s.value) }) };
      },
    });
  }
  if (!store.editGroupId) {
    kinds.push({
      id: "layer",
      label: "Layer",
      control: () => {
        const s = select(
          "Layer",
          doc.layers().filter((l) => l.kind === "design").map((l) => [l.id, l.name] as const),
        );
        s.value = store.activeLayerId ?? "";
        return { el: s, read: () => ({ id: "layer", layerId: s.value }) };
      },
    });
  }
  return kinds;
}

/** Opens Find and Modify and applies it. */
export async function findModifyDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc || !store.activeLayerId) return;
  const objects = scopeObjects(doc);
  if (objects.length === 0) {
    toast("The active layer has no objects to change.", "info");
    return;
  }
  const criteria = criteriaEditor(doc, objects);
  const kinds = changeKinds(doc);

  const rows: { readonly row: HTMLElement; readonly remove: HTMLButtonElement; read(): Read }[] = [];
  const list = h("div", { cls: "fm-list" });
  const syncRemove = (): void => {
    for (const r of rows) r.remove.disabled = rows.length === 1;
  };
  const addRow = (): void => {
    // each new row offers the first change not chosen yet
    const used = new Set(rows.map((r) => (r.row.querySelector(".fm-kind") as HTMLSelectElement).value));
    const kindSelect = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select fm-kind", attrs: { "aria-label": "Change" } },
      ...kinds.map((k) => h("option", { value: k.id, text: k.label })),
    );
    kindSelect.value = (kinds.find((k) => !used.has(k.id)) ?? kinds[0]).id;
    const remove = h("button", { cls: "btn small cs-remove", text: "×", title: "Remove this change", attrs: { type: "button" } });
    let control: Control;
    const row = h("div", { cls: "fm-row" }, kindSelect);
    const fill = (): void => {
      control = kinds.find((k) => k.id === kindSelect.value)!.control();
      row.replaceChildren(kindSelect, h("span", { cls: "fm-to", text: "to" }), control.el, remove);
    };
    kindSelect.addEventListener("change", fill);
    fill();
    const entry = { row, remove, read: () => control.read() };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i >= 0 && rows.length > 1) {
        rows.splice(i, 1);
        row.remove();
        syncRemove();
      }
    });
    rows.push(entry);
    list.append(row);
    syncRemove();
  };
  addRow();
  const add = h("button", { cls: "btn small", text: "Add Change", attrs: { type: "button" } });
  add.addEventListener("click", addRow);
  const selectThem = h("input", { attrs: { type: "checkbox", "aria-label": "Select the changed objects" } });
  selectThem.checked = true;
  const where = store.editGroupId ? "the group being edited" : "the active layer";

  const done = await showDialog<{ ids: string[]; layerMoved: boolean }>({
    title: "Find and Modify",
    okLabel: "Modify",
    cls: "cs-dialog fm-dialog",
    body: [
      h("p", { cls: "muted", text: `Find objects in ${where} that meet every criterion:` }),
      ...criteria.body,
      h("p", { cls: "muted fm-then", text: "and change them:" }),
      list,
      h("div", { cls: "cs-add" }, add),
      h("label", { cls: "menu-dialog-check" }, selectThem, h("span", { text: "Select the changed objects" })),
    ],
    check: () => {
      const found = criteria.matches();
      if ("error" in found) return found;
      if (found.ids.length === 0) return { error: "No objects meet those criteria." };
      const changes: Change[] = [];
      for (const r of rows) {
        const c = r.read();
        if ("error" in c) return c;
        changes.push(c);
      }
      try {
        apply(found.ids, changes);
      } catch (err) {
        return { error: errorMessage(err) };
      }
      return { value: { ids: found.ids, layerMoved: changes.some((c) => c.id === "layer" && c.layerId !== store.activeLayerId) } };
    },
  });
  if (!done) return;
  const n = done.ids.length;
  if (selectThem.checked && !done.layerMoved) setSelection(done.ids);
  toast(`Changed ${n} ${n === 1 ? "object" : "objects"}.`, "info");
}

/** Makes `changes` to the objects `ids`, as one undo step; on failure nothing changes. */
function apply(ids: readonly string[], changes: readonly Change[]): void {
  const s = store.session;
  if (!s) throw new Error("No drawing is open.");
  const info = ids.map((id) => s.doc.object(id)).filter((o) => o !== null);
  // attributes belong to drawn objects; a group takes them through its contents
  const drawn = info.filter((o) => o.attrs).map((o) => o.id);
  const symbols = info.filter((o) => o.kind === "symbol").map((o) => o.id);
  const all = [...ids];
  s.batch(() => {
    // the layer last, once everything else is done where the objects are
    for (const c of [...changes].sort((a, b) => Number(a.id === "layer") - Number(b.id === "layer"))) {
      switch (c.id) {
        case "class":
          s.setObjectClass(all, c.index);
          break;
        case "fill":
          if (drawn.length) s.setAttributes(drawn, { fillPattern: 1, fillFore: c.color });
          break;
        case "pen":
          if (drawn.length) s.setAttributes(drawn, { penFore: c.color });
          break;
        case "weight":
          if (drawn.length) s.setAttributes(drawn, { lineWeight: c.mils });
          break;
        case "opacity":
          if (drawn.length) s.setAttributes(drawn, { fillOpacity: c.percent, penOpacity: c.percent });
          break;
        case "symbol":
          if (symbols.length) s.replaceSymbol(symbols, c.symbol);
          break;
        case "layer":
          if (c.layerId !== store.activeLayerId) s.setObjectLayer(all, c.layerId);
          break;
      }
    }
  });
}
