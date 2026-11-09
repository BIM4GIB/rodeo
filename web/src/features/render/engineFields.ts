// The fields a render engine asks for (engines.ts), as rows of a dialog: Render Image's under its
// Engine, and the viewer's Restyle with AI. A field with `when` shows only while the field it names
// holds one of its values. This file loads with the renderers, not the editor.

import { h } from "../../app/dom.ts";
import { optionValue, type EngineOption, type OptionValue, type OptionValues, type RenderEngine } from "./engines.ts";

const SELECT_CLS = "menu-dialog-input menu-dialog-select render-select";

export interface EngineFields {
  readonly rows: readonly HTMLElement[];
  /** the values as the fields hold them now, each checked */
  values(): OptionValues;
  /** shows or hides every row (the engine is chosen or not), then each by its `when` */
  show(on: boolean): void;
}

/** The rows for `engine`'s fields, filled from `start`; `onChange` runs as any of them changes. */
export function engineFields(engine: RenderEngine, start: OptionValues, onChange: () => void): EngineFields {
  const readers = new Map<string, () => OptionValue>();
  const rows: { readonly option: EngineOption; readonly row: HTMLElement }[] = [];
  for (const option of engine.options) {
    const { control, read } = controlOf(option, start[option.key] ?? option.initial);
    control.addEventListener("input", onChange);
    control.addEventListener("change", onChange);
    // the dialog's keys stay out of a text box (Enter makes a new line there, not the picture)
    if (control instanceof HTMLTextAreaElement) control.addEventListener("keydown", (e) => e.key === "Enter" && e.stopPropagation());
    readers.set(option.key, read);
    const row =
      option.kind === "check"
        ? h("label", { cls: "menu-dialog-check" }, control, option.label)
        : h("label", { cls: `menu-dialog-field${option.kind === "text" ? " render-text-field" : ""}` }, h("span", { cls: "menu-dialog-label", text: option.label }), control);
    if (option.hint) row.title = option.hint;
    rows.push({ option, row });
  }
  let shown = true;
  const values = (): OptionValues => {
    const out: Record<string, OptionValue> = {};
    for (const o of engine.options) out[o.key] = optionValue(o, readers.get(o.key)?.());
    return out;
  };
  const refresh = (): void => {
    const now = values();
    for (const { option, row } of rows) row.hidden = !shown || (option.when !== undefined && !option.when.is.includes(now[option.when.key]));
  };
  for (const { row } of rows) row.addEventListener("change", refresh);
  refresh();
  return {
    rows: rows.map((r) => r.row),
    values,
    show(on: boolean): void {
      shown = on;
      refresh();
    },
  };
}

function controlOf(o: EngineOption, value: OptionValue): { control: HTMLElement; read: () => OptionValue } {
  const label = o.label;
  switch (o.kind) {
    case "choice": {
      const el = h("select", { cls: SELECT_CLS, attrs: { "aria-label": label } }, ...(o.choices ?? []).map(([v, text]) => h("option", { text, value: v })));
      el.value = String(value);
      if (el.selectedIndex < 0) el.value = String(o.initial);
      return { control: el, read: () => el.value };
    }
    case "text": {
      const el = h("textarea", { cls: "menu-dialog-input render-words", attrs: { rows: "2", "aria-label": label, ...(o.placeholder ? { placeholder: o.placeholder } : {}), ...(o.max ? { maxlength: String(o.max) } : {}) } });
      el.value = String(value);
      return { control: el, read: () => el.value };
    }
    case "number": {
      const el = h("input", {
        cls: "menu-dialog-input",
        value: String(value),
        attrs: { type: "number", step: "1", "aria-label": label, ...(o.min !== undefined ? { min: String(o.min) } : {}), ...(o.max !== undefined ? { max: String(o.max) } : {}) },
      });
      return { control: el, read: () => Number(el.value) };
    }
    case "check": {
      const el = h("input", { attrs: { type: "checkbox", "aria-label": label }, checked: value === true });
      return { control: el, read: () => el.checked };
    }
  }
}
