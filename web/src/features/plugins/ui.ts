// The window bits a plug-in can ask for: an alert, a prompt with fields (a dialog
// in the editor's own style), and a progress bar. Built on the shared dialog shell
// (menubar.ts showDialog) so they look and behave like the editor's other dialogs.

import { h } from "../../app/dom.ts";
import { showDialog } from "../../app/menubar.ts";

/** openvwx.ui.alert(title, text): one message and OK. */
export async function showAlert(title: string, text: string): Promise<void> {
  await showDialog<true>({
    title,
    okLabel: "OK",
    cls: "pi-dialog",
    body: [h("p", { cls: "pi-alert", text })],
    check: () => ({ value: true }),
  });
}

type FieldType = "text" | "number" | "select" | "checkbox";

interface FieldSpec {
  readonly name: string;
  readonly label: string;
  readonly type: FieldType;
  readonly options: readonly string[];
  readonly value: unknown;
}

/** The fields a plug-in asked for, checked; a bad one is an error in the plug-in. */
export function parseFields(raw: unknown): FieldSpec[] {
  if (!Array.isArray(raw)) throw new TypeError("openvwx.ui.prompt(title, fields) takes a list of fields");
  const seen = new Set<string>();
  return raw.map((f: unknown, i): FieldSpec => {
    const x = (f ?? {}) as Record<string, unknown>;
    if (typeof x.name !== "string" || x.name === "") throw new TypeError(`field ${i + 1} needs a name`);
    if (seen.has(x.name)) throw new TypeError(`field name "${x.name}" is used twice`);
    seen.add(x.name);
    const type: FieldType = x.type === "number" || x.type === "select" || x.type === "checkbox" ? x.type : "text";
    const options = Array.isArray(x.options) ? x.options.map((o) => String(o)) : [];
    if (type === "select" && options.length === 0) throw new TypeError(`field "${x.name}" is a select with no options`);
    return {
      name: x.name,
      label: typeof x.label === "string" ? x.label : x.name,
      type,
      options,
      value: x.value,
    };
  });
}

/**
 * openvwx.ui.prompt(title, fields): a dialog with the fields, resolved with an object of their
 * values by name, or null when cancelled.
 */
export async function promptValues(title: string, rawFields: unknown): Promise<Record<string, string | number | boolean> | null> {
  const fields = parseFields(rawFields);
  const controls = fields.map((spec) => control(spec));
  const rows = fields.map((spec, i) => {
    const c = controls[i];
    if (spec.type === "checkbox") return h("label", { cls: "menu-dialog-check" }, c.el, spec.label);
    return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: spec.label }), c.el);
  });
  return showDialog<Record<string, string | number | boolean>>({
    title,
    okLabel: "OK",
    cls: "pi-dialog",
    body: rows,
    check: () => {
      const out: Record<string, string | number | boolean> = {};
      for (let i = 0; i < fields.length; i++) {
        const result = controls[i].read();
        if ("error" in result) return { error: result.error, focus: controls[i].el };
        out[fields[i].name] = result.value;
      }
      return { value: out };
    },
  });
}

type Read = { value: string | number | boolean } | { error: string };

function control(spec: FieldSpec): { el: HTMLElement; read: () => Read } {
  if (spec.type === "checkbox") {
    const input = h("input", { attrs: { type: "checkbox" }, checked: spec.value === true });
    return { el: input, read: () => ({ value: input.checked }) };
  }
  if (spec.type === "select") {
    const current = typeof spec.value === "string" && spec.options.includes(spec.value) ? spec.value : spec.options[0];
    const select = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": spec.label } },
      ...spec.options.map((o) => h("option", { value: o, text: o })),
    );
    select.value = current;
    return { el: select, read: () => ({ value: select.value }) };
  }
  if (spec.type === "number") {
    const input = h("input", { cls: "menu-dialog-input", attrs: { type: "number", step: "any", "aria-label": spec.label } });
    if (typeof spec.value === "number") input.value = String(spec.value);
    return {
      el: input,
      read: () => {
        const n = Number(input.value);
        if (input.value.trim() === "" || !Number.isFinite(n)) return { error: `${spec.label}: enter a number.` };
        return { value: n };
      },
    };
  }
  const input = h("input", { cls: "menu-dialog-input pi-input", attrs: { type: "text", spellcheck: "false", "aria-label": spec.label } });
  input.value = typeof spec.value === "string" || typeof spec.value === "number" ? String(spec.value) : "";
  return { el: input, read: () => ({ value: input.value }) };
}

// ---- progress --------------------------------------------------------------------

let bar: { root: HTMLElement; fill: HTMLElement; label: HTMLElement } | null = null;

/** openvwx.ui.progress: a bar with a label, or hidden when `fraction` is null. */
export function progress(fraction: number | null, label: string): void {
  if (fraction === null) {
    bar?.root.remove();
    bar = null;
    return;
  }
  if (!bar) {
    const fill = h("div", { cls: "pi-progress-fill" });
    const text = h("span", { cls: "pi-progress-label" });
    const root = h("div", { cls: "pi-progress", attrs: { role: "status", "aria-live": "polite" } }, text, h("div", { cls: "pi-progress-track" }, fill));
    document.body.append(root);
    bar = { root, fill, label: text };
  }
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  bar.fill.style.width = `${(f * 100).toFixed(1)}%`;
  bar.label.textContent = label;
}
