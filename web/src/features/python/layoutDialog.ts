// A Vectorworks layout dialog a script shows (vs.RunLayoutDialog in vsModule.ts), drawn as the
// editor's own dialogs are. Its controls are placed as the script laid them out: each below or to the
// right of another, indented by standard characters, with group boxes and tab panes holding theirs.
// Each click or change is an event the script's handler gets, with what every control then holds;
// what the handler sets (texts, values, choices, enabled, shown) comes back with the next call, and a
// value it didn't change is left as the user may since have made it. Radio buttons in one group (or
// the dialog itself) exclude each other, and a check box or radio button group box enables its own.

import { h } from "../../app/dom.ts";
import { colorSwatch } from "../../app/panels/colorPicker.ts";
import { store } from "../../app/state.ts";
import { formatLength, parseLength } from "../../app/units.ts";

/** A control as the vs module keeps it (lengths in mm). */
interface Item {
  readonly id: number;
  readonly kind: string;
  readonly text?: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  /** standard characters */
  readonly width?: number | null;
  readonly lines?: number;
  readonly value?: unknown;
  readonly raw?: string | null;
  /** an edit real's kind: 1 a number, 2 an angle, 3 a dimension, 4 and 5 an x and a y coordinate */
  readonly edit?: number;
  readonly choices?: readonly string[];
  readonly sel?: readonly number[];
  readonly multi?: boolean;
  readonly frame?: boolean;
  readonly bold?: boolean;
  readonly readonly?: boolean;
  readonly tip?: string;
  readonly first?: number | null;
  readonly panes?: readonly number[];
  readonly below?: number;
  readonly right?: number;
  readonly indent?: number;
  readonly space?: number;
}

interface Spec {
  readonly id: number;
  readonly title: string;
  readonly first: number | null;
  readonly focus: number | null;
  readonly items: readonly Item[];
}

type Values = Record<string, unknown>;

/** What the script's handler gets: the control and its data (a choice's index, a tab's pane), and every control's values. */
interface DialogEvent {
  readonly item: number;
  readonly data: number;
  readonly values: Record<string, Values>;
}

const OK = 1;
const CANCEL = 2;
const LENGTHS: ReadonlySet<number> = new Set([3, 4, 5]);
/** a standard character's width, and a line of spacing, in px */
const STD_CHAR = 7;
const LINE = 6;

const units = (): string | undefined => store.session?.doc.info.units;
const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** Whether two values are the same, numbers to a millionth (lengths come back through the script's units). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => same((a as Values)[k], (b as Values)[k]));
  }
  return a === b;
}

/** One control drawn: its element (what is shown and hidden), and how its values are read and set. */
interface Control {
  readonly el: HTMLElement;
  /** the elements its enabled state disables */
  readonly inputs: readonly (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLFieldSetElement)[];
  /** its label's text node, for SetItemText */
  readonly label?: HTMLElement;
  read?(): Values;
  write?(item: Item): void;
}

class LayoutDialog {
  private readonly backdrop: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly controls = new Map<number, Control>();
  private items = new Map<number, Item>();
  /** the radio buttons that exclude each other, by the group (or 0, the dialog) holding them */
  private readonly radios = new Map<number, HTMLInputElement[]>();
  /** each control's values as sent with the event the script is answering */
  private sent = new Map<number, Values>();
  /** events the script hasn't taken yet, each with its controls' values as sent */
  private readonly queue: { event: DialogEvent; sent: Map<number, Values> }[] = [];
  private waiting: ((e: DialogEvent) => void) | null = null;
  private readonly returnFocus: HTMLElement | null;

  constructor(spec: Spec) {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.items = new Map(spec.items.map((i) => [i.id, i]));
    const ok = this.button(OK, "btn primary", "submit");
    const cancel = this.button(CANCEL, "btn", "button");
    const body = h("div", { cls: "ld-body" });
    const seen = new Set<number>([OK, CANCEL]);
    // the panes of tab controls are drawn by their tab control
    for (const i of spec.items) for (const p of i.panes ?? []) seen.add(p);
    if (spec.first !== null) {
      const top = this.block(spec.first, seen, 0);
      if (top) body.append(top);
    }
    this.form = h(
      "form",
      { cls: "menu-dialog ld-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": spec.title } },
      h("h2", { cls: "menu-dialog-title", text: spec.title }),
      body,
      h("div", { cls: "menu-dialog-actions" }, cancel, ok),
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!(this.controls.get(OK)?.inputs[0] as HTMLButtonElement | undefined)?.disabled) this.fire(OK, 0);
    });
    this.backdrop = h("div", { cls: "menu-dialog-backdrop" }, this.form);
    // every key stays inside the dialog, so the window's shortcuts don't run under it
    this.backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.fire(CANCEL, 0);
      }
    });
    this.update(spec);
    document.body.append(this.backdrop);
    const first = (spec.focus !== null ? this.controls.get(spec.focus)?.inputs[0] : null) ?? body.querySelector<HTMLElement>("input, select, textarea");
    first?.focus();
  }

  /** The script's state after its handler ran: each control brought up to it, keeping what the user changed since. */
  update(spec: Spec): void {
    this.items = new Map(spec.items.map((i) => [i.id, i]));
    for (const item of spec.items) {
      const c = this.controls.get(item.id);
      if (!c) continue;
      c.el.hidden = !item.visible;
      for (const input of c.inputs) input.disabled = !item.enabled;
      if (c.label && item.text !== undefined) c.label.textContent = item.text;
      if (item.tip) c.el.title = item.tip;
      const sent = this.sent.get(item.id);
      if (c.write && (!sent || !same(this.state(item), sent))) c.write(item);
    }
  }

  /** The next event, once the user makes one. */
  next(): Promise<DialogEvent> {
    const e = this.queue.shift();
    if (!e) return new Promise((resolve) => (this.waiting = resolve));
    this.sent = e.sent;
    return Promise.resolve(e.event);
  }

  close(): void {
    this.backdrop.remove();
    this.returnFocus?.focus();
  }

  /** An item's values as the script holds them, to compare with those sent. */
  private state(item: Item): Values {
    switch (item.kind) {
      case "edit":
        return { text: item.text ?? "" };
      case "real":
      case "int":
        return { raw: item.raw ?? null, value: item.value ?? null };
      case "popup":
      case "list":
        return { sel: [...(item.sel ?? [])], choices: [...(item.choices ?? [])] };
      default:
        return { value: item.value ?? null };
    }
  }

  private fire(item: number, data: number): void {
    const values: Record<string, Values> = {};
    const sent = new Map<number, Values>();
    for (const [id, c] of this.controls) {
      const v = c.read?.();
      if (!v) continue;
      values[id] = v;
      const it = this.items.get(id);
      if (it) sent.set(id, this.state({ ...it, ...v } as Item));
    }
    const event: DialogEvent = { item, data, values };
    const resolve = this.waiting;
    this.waiting = null;
    if (!resolve) {
      this.queue.push({ event, sent });
      return;
    }
    this.sent = sent;
    resolve(event);
  }

  private button(id: number, cls: string, type: "button" | "submit"): HTMLButtonElement {
    const item = this.items.get(id);
    const b = h("button", { cls, text: item?.text ?? "", attrs: { type } });
    if (type === "button") b.addEventListener("click", () => this.fire(id, 0));
    this.controls.set(id, { el: b, inputs: [b], label: b });
    return b;
  }

  /** The control `id` with what is to its right, and under that what is below it: the script's layout. */
  private block(id: number, seen: Set<number>, group: number): HTMLElement | null {
    const item = this.items.get(id);
    if (!item || seen.has(id)) return null;
    seen.add(id);
    const row = h("div", { cls: "ld-row" }, this.control(item, seen, group).el);
    const right = item.right === undefined ? null : this.block(item.right, seen, group);
    if (right) row.append(right);
    const col = h("div", { cls: "ld-col" }, row);
    const below = item.below === undefined ? null : this.block(item.below, seen, group);
    if (below) col.append(below);
    if (item.indent) col.style.marginLeft = `${item.indent * STD_CHAR}px`;
    if (item.space) col.style.marginTop = `${item.space * LINE}px`;
    return col;
  }

  private sized(el: HTMLElement, item: Item): void {
    if (item.width) el.style.width = `${item.width * STD_CHAR + 16}px`;
  }

  private control(item: Item, seen: Set<number>, group: number): Control {
    const c = this.make(item, seen, group);
    this.controls.set(item.id, c);
    return c;
  }

  private make(item: Item, seen: Set<number>, group: number): Control {
    const change = (data = 0) => () => this.fire(item.id, data);
    switch (item.kind) {
      case "static": {
        const el = h("span", { cls: item.bold ? "ld-text ld-bold" : "ld-text", text: item.text ?? "" });
        this.sized(el, item);
        return { el, inputs: [], label: el };
      }
      case "edit": {
        const el = (item.lines ?? 1) > 1 ? h("textarea", { cls: "menu-dialog-input ld-edit", attrs: { rows: String(item.lines) } }) : h("input", { cls: "menu-dialog-input ld-edit", attrs: { type: "text" } });
        this.sized(el, item);
        el.addEventListener("change", change());
        return {
          el,
          inputs: [el],
          read: () => ({ text: el.value }),
          write: (i) => {
            el.value = i.text ?? "";
            el.readOnly = i.readonly === true;
          },
        };
      }
      case "real":
      case "int": {
        const el = h("input", { cls: "menu-dialog-input", attrs: { type: "text" } });
        this.sized(el, item);
        el.addEventListener("change", change());
        const length = item.kind === "real" && LENGTHS.has(item.edit ?? 1);
        return {
          el,
          inputs: [el],
          read: () => {
            const text = el.value.trim();
            let value: number | null;
            if (length) value = parseLength(text, units());
            else {
              const n = Number(text.replace(/°$/, ""));
              value = text !== "" && Number.isFinite(n) && (item.kind === "real" || Number.isInteger(n)) ? n : null;
            }
            return { raw: el.value, value };
          },
          write: (i) => {
            const v = typeof i.value === "number" ? i.value : null;
            el.value = i.raw ?? (v === null ? "" : length ? formatLength(v, units()) : fmt(v));
          },
        };
      }
      case "check":
      case "check3":
      case "radio": {
        const box = h("input", { attrs: { type: item.kind === "radio" ? "radio" : "checkbox" } });
        const label = h("span", { text: item.text ?? "" });
        if (item.kind === "radio") this.radio(group, box);
        box.addEventListener("change", () => {
          if (item.kind === "radio") this.exclude(group, box);
          change()();
        });
        return {
          el: h("label", { cls: "menu-dialog-check ld-check" }, box, label),
          inputs: [box],
          label,
          read: () => ({ value: item.kind === "check3" ? (box.indeterminate ? 2 : box.checked ? 1 : 0) : box.checked }),
          write: (i) => {
            box.checked = i.kind === "check3" ? i.value === 1 : i.value === true;
            box.indeterminate = i.kind === "check3" && i.value === 2;
          },
        };
      }
      case "button": {
        const el = h("button", { cls: "btn small", text: item.text ?? "", attrs: { type: "button" } });
        el.addEventListener("click", change());
        return { el, inputs: [el], label: el };
      }
      case "popup":
      case "list": {
        const el = h("select", { cls: "menu-dialog-input ld-select" });
        if (item.kind === "list") {
          el.size = Math.max(2, item.lines ?? 8);
          el.multiple = item.multi === true;
          el.classList.add("ld-list");
        }
        this.sized(el, item);
        el.addEventListener("change", () => change(el.selectedIndex)());
        return {
          el,
          inputs: [el],
          read: () => ({ sel: [...el.options].filter((o) => o.selected).map((o) => o.index) }),
          write: (i) => {
            const choices = i.choices ?? [];
            if (el.options.length !== choices.length || choices.some((t, k) => el.options[k].text !== t)) {
              el.replaceChildren(...choices.map((t, k) => h("option", { text: t, attrs: { value: String(k) } })));
            }
            const sel = new Set(i.sel ?? []);
            for (const o of el.options) o.selected = sel.has(o.index);
            if (!sel.size && !el.multiple) el.selectedIndex = -1;
          },
        };
      }
      case "color": {
        const holder = h("span", { cls: "ld-color" });
        let index = typeof item.value === "number" ? item.value : 0;
        const draw = (): void => {
          const doc = store.session?.doc;
          if (!doc) return;
          holder.replaceChildren(
            colorSwatch({
              doc,
              value: index,
              label: "Colour",
              onPick: (picked) => {
                index = picked;
                draw();
                change()();
              },
            }),
          );
        };
        draw();
        return {
          el: holder,
          // the swatch is drawn again with each value, so it is looked up when disabled
          get inputs() {
            return [...holder.querySelectorAll("button")];
          },
          read: () => ({ value: index }),
          write: (i) => {
            index = typeof i.value === "number" ? i.value : 0;
            draw();
          },
        };
      }
      case "group":
      case "checkgroup":
      case "radiogroup": {
        const set = h("fieldset", { cls: item.frame === false ? "ld-group ld-plain" : "ld-group" });
        const label = h("span", { text: item.text ?? "" });
        let box: HTMLInputElement | null = null;
        if (item.kind === "group") set.append(h("legend", {}, label));
        else {
          box = h("input", { attrs: { type: item.kind === "radiogroup" ? "radio" : "checkbox" } });
          const own = box;
          if (item.kind === "radiogroup") this.radio(group, own);
          own.addEventListener("change", () => {
            if (item.kind === "radiogroup") this.exclude(group, own);
            set.disabled = !own.checked;
            change()();
          });
          // a fieldset's first legend stays enabled while the rest of it is disabled
          set.append(h("legend", {}, h("label", { cls: "ld-check" }, own, label)));
        }
        const inner = item.first === null || item.first === undefined ? null : this.block(item.first, seen, item.id);
        if (inner) set.append(inner);
        const own = box;
        return {
          el: set,
          inputs: own ? [own] : [set],
          label,
          read: own ? () => ({ value: own.checked }) : undefined,
          write: own
            ? (i) => {
                own.checked = i.value === true;
                set.disabled = !own.checked;
              }
            : undefined,
        };
      }
      case "tabs": {
        const strip = h("div", { cls: "ld-tabs", attrs: { role: "tablist" } });
        const panes = new Map<number, HTMLElement>();
        const tabs = new Map<number, HTMLButtonElement>();
        let current = typeof item.value === "number" ? item.value : (item.panes?.[0] ?? 0);
        const show = (): void => {
          for (const [id, pane] of panes) {
            pane.classList.toggle("ld-off", id !== current);
            pane.inert = id !== current;
          }
          for (const [id, tab] of tabs) tab.setAttribute("aria-selected", String(id === current));
        };
        const box = h("div", { cls: "ld-tabbed" }, strip);
        for (const id of item.panes ?? []) {
          const pane = this.items.get(id);
          const tab = h("button", { cls: "ld-tab", text: pane?.text ?? "", attrs: { type: "button", role: "tab" } });
          tab.addEventListener("click", () => {
            current = id;
            show();
            change(id)();
          });
          tabs.set(id, tab);
          strip.append(tab);
          const body = h("div", { cls: "ld-pane", attrs: { role: "tabpanel" } });
          const inner = pane?.first === null || pane?.first === undefined ? null : this.block(pane.first, seen, id);
          if (inner) body.append(inner);
          panes.set(id, body);
          box.append(body);
        }
        show();
        return {
          el: box,
          inputs: [...tabs.values()],
          read: () => ({ value: current }),
          write: (i) => {
            if (typeof i.value === "number" && panes.has(i.value)) current = i.value;
            show();
          },
        };
      }
      case "sep": {
        const el = h("hr", { cls: "ld-sep" });
        this.sized(el, item);
        return { el, inputs: [] };
      }
      default:
        // an image from the plug-in's resources, which aren't read
        return { el: h("span", { cls: "ld-image" }), inputs: [] };
    }
  }

  private radio(group: number, box: HTMLInputElement): void {
    const list = this.radios.get(group) ?? [];
    list.push(box);
    this.radios.set(group, list);
  }

  /** A radio button chosen: the others of its group turn off (a radio button group box disabling its own). */
  private exclude(group: number, box: HTMLInputElement): void {
    if (!box.checked) return;
    for (const other of this.radios.get(group) ?? []) {
      if (other === box || !other.checked) continue;
      other.checked = false;
      const set = other.closest("legend")?.parentElement;
      if (set instanceof HTMLFieldSetElement) set.disabled = true;
    }
  }
}

const open = new Map<number, LayoutDialog>();

/** Shows the dialog `spec` (vs.RunLayoutDialog's, as JSON), or brings the open one up to it, and waits for its next event. */
export function runLayoutDialog(spec: string): Promise<DialogEvent> {
  const s = JSON.parse(spec) as Spec;
  let d = open.get(s.id);
  if (d) d.update(s);
  else {
    d = new LayoutDialog(s);
    open.set(s.id, d);
  }
  return d.next();
}

export function closeLayoutDialog(id: number): void {
  open.get(id)?.close();
  open.delete(id);
}

/** Closes every dialog a script left open (it ended or was stopped). */
export function closeLayoutDialogs(): void {
  for (const d of open.values()) d.close();
  open.clear();
}
