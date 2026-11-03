// Tool preferences: the dialog the mode bar's Preferences button opens, as each
// Vectorworks tool has one. A tool lists its settings as fields; lengths are
// shown and typed in the document's units and come back in millimetres (a length
// left as shown comes back exactly as it was, not rounded to what was shown).

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

interface FieldBase {
  readonly key: string;
  readonly label: string;
}

/** A length greater than 0 (or 0 too, with `zero`; any, with `signed`), in mm. */
interface LengthField extends FieldBase {
  readonly kind: "length";
  readonly value: number;
  readonly zero?: boolean;
  readonly signed?: boolean;
}

/** A plain number from `min` to `max`. */
interface NumberField extends FieldBase {
  readonly kind: "number";
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  readonly unit?: string;
}

interface CheckField extends FieldBase {
  readonly kind: "check";
  readonly value: boolean;
}

/** Text, empty allowed: a marker's number or a label. */
interface TextField extends FieldBase {
  readonly kind: "text";
  readonly value: string;
}

interface ChoiceField extends FieldBase {
  readonly kind: "choice";
  /** for long option names */
  readonly wide?: boolean;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

/** A colour, #rrggbb, read back with choice(). */
interface ColorField extends FieldBase {
  readonly kind: "color";
  readonly value: string;
}

/** A title over the fields after it; it holds no value. */
interface HeadingField extends FieldBase {
  readonly kind: "heading";
}

export type PrefField = LengthField | NumberField | CheckField | TextField | ChoiceField | ColorField | HeadingField;

/** The values a preferences dialog returned, by field key. */
export interface PrefValues {
  num(key: string): number;
  flag(key: string): boolean;
  /** a choice's value or a text field's text */
  choice(key: string): string;
}

type Read = { readonly value: number | boolean | string } | { readonly error: string; readonly focus: HTMLElement };

/** Opens `title`'s preferences with `fields`; resolves to the values entered, or null when cancelled. */
export async function toolPrefs(title: string, fields: readonly PrefField[], note?: string): Promise<PrefValues | null> {
  const units = store.session?.doc.info.units;
  const rows: HTMLElement[] = [];
  const reads = new Map<string, () => Read>();
  for (const f of fields) {
    if (f.kind === "heading") {
      rows.push(h("div", { cls: "menu-dialog-title menu-dialog-heading", text: f.label }));
      continue;
    }
    if (f.kind === "check") {
      const input = h("input", { checked: f.value, attrs: { type: "checkbox" } });
      rows.push(h("label", { cls: "menu-dialog-check" }, input, f.label));
      reads.set(f.key, () => ({ value: input.checked }));
      continue;
    }
    if (f.kind === "choice") {
      const select = h(
        "select",
        { cls: `menu-dialog-input menu-dialog-select${f.wide ? " wide" : ""}`, attrs: { "aria-label": f.label } },
        ...f.options.map((o) => h("option", { value: o.value, text: o.label })),
      );
      select.value = f.value;
      rows.push(field(f.label, select, ""));
      reads.set(f.key, () => ({ value: select.value }));
      continue;
    }
    if (f.kind === "color") {
      const input = h("input", { cls: "menu-dialog-input", value: f.value, attrs: { type: "color", "aria-label": f.label, style: "width: 64px; padding: 2px" } });
      rows.push(field(f.label, input, ""));
      reads.set(f.key, () => ({ value: input.value }));
      continue;
    }
    if (f.kind === "text") {
      const input = h("input", { cls: "menu-dialog-input", value: f.value, attrs: { type: "text", "aria-label": f.label } });
      rows.push(field(f.label, input, ""));
      reads.set(f.key, () => ({ value: input.value.trim() }));
      continue;
    }
    const shown = f.kind === "length" ? formatLengthValue(f.value, units) : String(f.value);
    const input = h("input", { cls: "menu-dialog-input", value: shown, attrs: { type: "text", inputmode: "decimal", "aria-label": f.label } });
    rows.push(field(f.label, input, f.kind === "length" ? lengthSuffix(units) : (f.unit ?? "")));
    reads.set(f.key, () => (f.kind === "length" ? (input.value === shown ? { value: f.value } : readLength(f, input, units)) : readNumber(f, input)));
  }
  const values = await showDialog<Map<string, number | boolean | string>>({
    title,
    okLabel: "OK",
    body: [...rows, note ? h("p", { cls: "muted", text: note }) : null].filter((r): r is HTMLElement => r !== null),
    check: () => {
      const out = new Map<string, number | boolean | string>();
      for (const [key, read] of reads) {
        const r = read();
        if ("error" in r) return r;
        out.set(key, r.value);
      }
      return { value: out };
    },
  });
  if (!values) return null;
  return {
    num: (key) => Number(values.get(key)),
    flag: (key) => values.get(key) === true,
    choice: (key) => String(values.get(key) ?? ""),
  };
}

function field(label: string, input: HTMLElement, unit: string): HTMLElement {
  return h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: label }),
    input,
    unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
  );
}

function readLength(f: LengthField, input: HTMLInputElement, units: string | undefined): Read {
  const mm = parseLength(input.value, units);
  if (mm !== null && (mm > 0 || (f.zero && mm === 0) || f.signed)) return { value: mm };
  return { error: `${f.label}: enter a length${f.signed ? "" : f.zero ? " of 0 or more" : " greater than 0"}.`, focus: input };
}

function readNumber(f: NumberField, input: HTMLInputElement): Read {
  const text = input.value.trim().replace(",", ".");
  const n = Number(text);
  const ok = text !== "" && Number.isFinite(n) && n >= f.min && n <= f.max && (!f.integer || Number.isInteger(n));
  if (ok) return { value: n };
  const what = f.integer ? "a whole number" : "a number";
  return { error: `${f.label}: enter ${what} from ${f.min} to ${f.max}.`, focus: input };
}
