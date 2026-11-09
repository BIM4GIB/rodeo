// The Render palette's controls, one look for every tab: groups that fold, labelled rows, sliders
// with their value beside them (a double-click on the label puts the default back), switches,
// segmented controls, chips, picture tiles, colour and number fields, notes and empty states. Each
// control returns its element and a `set` that shows a value without calling back, so a tab can
// keep every control in step with the settings. Classes start "rs-" (studio.css). No three.js here.

import { h } from "../../../app/dom.ts";
import "./studio.css";

/** 16 px line icons (stroke currentColor), as inline SVG. */
export const ICONS = {
  scene: '<path d="M3 17h18"/><path d="M5 17l4-6 3 4 2-3 5 5"/><circle cx="17" cy="7" r="2"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0118 8.5V16a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 16z"/><circle cx="11" cy="12" r="3"/>',
  materials: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 000 16"/><path d="M6 8.5c3 1.5 9 1.5 12 0M6 15.5c3-1.5 9-1.5 12 0"/>',
  look: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 8h4.5M12 12h6M12 16h4.5"/>',
  output: '<rect x="3.5" y="5" width="17" height="12" rx="1.5"/><path d="M8 20h8M12 17v3"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z"/>',
  shutter: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>',
  render: '<path d="M4 8.5A1.5 1.5 0 015.5 7h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0118 8.5V17a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 17z"/><circle cx="11" cy="12.5" r="3"/><path d="M20 3.5v3M18.5 5h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  eyedropper: '<path d="M14.5 4.5l5 5"/><path d="M17 7l-9.5 9.5L5 19l2.5-2.5"/><path d="M13 5.5l5.5 5.5"/>',
  reset: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7"/><path d="M4 4v4h4"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  focus: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><circle cx="12" cy="12" r="2.5"/>',
  frame: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 10h16" stroke-dasharray="2 2"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 01-.5-9A6 6 0 0118 9.5 4 4 0 0117 18z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  library: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  more: '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 19h14"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M5 15V6.5A1.5 1.5 0 016.5 5H15"/>',
  compare: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M12 3v18"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An icon as an element (aria-hidden), `size` px. */
export function icon(name: IconName, size = 16): HTMLElement {
  return h("span", {
    cls: "rs-icon",
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
  });
}

// ---- groups and rows -----------------------------------------------------------

const GROUPS_KEY = "openvwx.renderStudio.groups";
let folded: Record<string, boolean> | null = null;

function foldedGroups(): Record<string, boolean> {
  if (folded) return folded;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "{}");
    folded = typeof raw === "object" && raw !== null ? (raw as Record<string, boolean>) : {};
  } catch {
    folded = {};
  }
  return folded;
}

export interface GroupOptions {
  /** kept under this key when folded or unfolded (each group needs its own) */
  readonly key: string;
  /** starts folded the first time */
  readonly folded?: boolean;
  /** beside the title, on the right: a switch, a button */
  readonly aside?: Node;
}

export interface Group {
  readonly el: HTMLElement;
  /** where the group's rows go */
  readonly body: HTMLElement;
  setFolded(f: boolean): void;
}

/** A group of rows under a title that folds it. */
export function group(title: string, opts: GroupOptions, ...children: Node[]): Group {
  const chevron = icon("chevron", 14);
  chevron.classList.add("rs-group-chevron");
  const head = h("button", { cls: "rs-group-head", attrs: { type: "button", "aria-expanded": "true" } }, chevron, h("span", { cls: "rs-group-title", text: title }));
  const body = h("div", { cls: "rs-group-body" }, ...children);
  const top = h("div", { cls: "rs-group-top" }, head, opts.aside ? h("div", { cls: "rs-group-aside" }, opts.aside) : null);
  const el = h("section", { cls: "rs-group" }, top, body);
  const setFolded = (f: boolean): void => {
    el.classList.toggle("is-folded", f);
    head.setAttribute("aria-expanded", String(!f));
    body.hidden = f;
  };
  setFolded(foldedGroups()[opts.key] ?? opts.folded ?? false);
  head.addEventListener("click", () => {
    const f = !el.classList.contains("is-folded");
    setFolded(f);
    foldedGroups()[opts.key] = f;
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify(foldedGroups()));
    } catch {
      // private windows: the groups fold for this session
    }
  });
  return { el, body, setFolded };
}

/** A labelled row: the label on the left, the control on the right. */
export function row(label: string, control: Node, hint?: string): HTMLElement {
  const lab = h("span", { cls: "rs-label", text: label });
  if (hint) lab.title = hint;
  return h("div", { cls: "rs-row" }, lab, h("div", { cls: "rs-control" }, control));
}

/** A muted line under a row or at a group's end. */
export function note(text: string): HTMLElement {
  return h("p", { cls: "rs-note", text });
}

/** A tab's empty state: an icon, a title, a line and maybe a button. */
export function empty(iconName: IconName, title: string, text: string, action?: HTMLElement): HTMLElement {
  return h("div", { cls: "rs-empty" }, icon(iconName, 24), h("p", { cls: "rs-empty-title", text: title }), h("p", { cls: "rs-empty-text", text }), action ?? null);
}

// ---- buttons ---------------------------------------------------------------------

export interface ButtonOptions {
  readonly primary?: boolean;
  readonly small?: boolean;
  readonly icon?: IconName;
  readonly title?: string;
  /** a button with only its icon showing: `text` is its label */
  readonly iconOnly?: boolean;
}

export function button(text: string, onClick: (e: MouseEvent) => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const cls = ["btn", "rs-btn", opts.primary ? "primary" : "", opts.small ? "small" : "", opts.iconOnly ? "rs-icon-btn" : ""].filter(Boolean).join(" ");
  const b = h(
    "button",
    { cls, attrs: { type: "button", ...(opts.iconOnly ? { "aria-label": text } : {}) }, title: opts.title ?? (opts.iconOnly ? text : undefined) },
    opts.icon ? icon(opts.icon) : null,
    opts.iconOnly ? null : h("span", { text }),
  );
  b.addEventListener("click", onClick);
  return b;
}

// ---- value controls -------------------------------------------------------------

export interface SliderSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** the readout beside it */
  readonly format: (v: number) => string;
  /** runs as it moves */
  readonly onInput: (v: number) => void;
  /** the default a double-click on the label (or readout) puts back */
  readonly reset?: number;
  readonly hint?: string;
}

export interface SliderRow {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  set(v: number): void;
  /** greys it out */
  setDisabled(off: boolean): void;
}

/** A labelled slider with its value beside it; the track fills to the value. */
export function slider(label: string, spec: SliderSpec): SliderRow {
  const input = h("input", { cls: "rs-range", attrs: { type: "range", min: String(spec.min), max: String(spec.max), step: String(spec.step), "aria-label": label } });
  const readout = h("span", { cls: "rs-readout" });
  const fill = (): void => {
    const t = (Number(input.value) - spec.min) / (spec.max - spec.min || 1);
    input.style.setProperty("--fill", `${Math.max(0, Math.min(1, t)) * 100}%`);
  };
  input.addEventListener("input", () => {
    const v = Number(input.value);
    readout.textContent = spec.format(v);
    fill();
    spec.onInput(v);
  });
  const lab = h("span", { cls: "rs-label", text: label });
  const el = h("div", { cls: "rs-row rs-slider" }, lab, h("div", { cls: "rs-control" }, input, readout));
  if (spec.hint) lab.title = spec.hint;
  if (spec.reset !== undefined) {
    const back = spec.reset;
    const reset = (): void => {
      if (input.disabled) return;
      input.value = String(back);
      readout.textContent = spec.format(back);
      fill();
      spec.onInput(back);
    };
    for (const t of [lab, readout]) {
      t.addEventListener("dblclick", reset);
      t.classList.add("rs-resettable");
      t.title = `${spec.hint ? `${spec.hint}. ` : ""}Double-click to reset`;
    }
  }
  return {
    el,
    input,
    set(v) {
      input.value = String(v);
      readout.textContent = spec.format(v);
      fill();
    },
    setDisabled(off) {
      input.disabled = off;
      el.classList.toggle("is-disabled", off);
    },
  };
}

export interface ToggleRow {
  readonly el: HTMLElement;
  readonly box: HTMLInputElement;
  set(on: boolean): void;
}

/** A labelled switch. */
export function toggle(label: string, onChange: (on: boolean) => void, hint?: string): ToggleRow {
  const box = h("input", { cls: "rs-switch", attrs: { type: "checkbox", role: "switch", "aria-label": label } });
  box.addEventListener("change", () => onChange(box.checked));
  const el = h("label", { cls: "rs-row rs-toggle" }, h("span", { cls: "rs-label", text: label }), h("span", { cls: "rs-control" }, box));
  if (hint) el.title = hint;
  return {
    el,
    box,
    set(on) {
      box.checked = on;
    },
  };
}

/** A bare switch (for a group's aside), labelled `label` for screen readers. */
export function switchBox(label: string, onChange: (on: boolean) => void): ToggleRow {
  const box = h("input", { cls: "rs-switch", attrs: { type: "checkbox", role: "switch", "aria-label": label } });
  box.addEventListener("change", () => onChange(box.checked));
  // its clicks do not fold the group
  box.addEventListener("click", (e) => e.stopPropagation());
  return {
    el: box,
    box,
    set(on) {
      box.checked = on;
    },
  };
}

export interface Choice<T> {
  readonly el: HTMLElement;
  set(v: T): void;
  /** the buttons, by value, to hide or grey out some */
  readonly buttons: ReadonlyMap<T, HTMLButtonElement>;
}

/** A segmented control: one of `options` (value, text) pressed. */
export function segmented<T extends string | number>(label: string, options: readonly (readonly [T, string])[], onPick: (v: T) => void): Choice<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h("div", { cls: "seg rs-seg", attrs: { role: "group", "aria-label": label } });
  for (const [v, text] of options) {
    const b = h("button", { cls: "seg-btn", text, attrs: { type: "button", "aria-pressed": "false" } });
    b.addEventListener("click", () => {
      b.blur();
      onPick(v);
    });
    buttons.set(v, b);
    el.append(b);
  }
  return {
    el,
    buttons,
    set(v) {
      for (const [k, b] of buttons) {
        b.classList.toggle("active", k === v);
        b.setAttribute("aria-pressed", String(k === v));
      }
    },
  };
}

/** Small pills, one of them chosen: sizes, categories. */
export function chips<T extends string | number>(label: string, options: readonly (readonly [T, string])[], onPick: (v: T) => void): Choice<T> {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h("div", { cls: "rs-chips", attrs: { role: "group", "aria-label": label } });
  for (const [v, text] of options) {
    const b = h("button", { cls: "rs-chip", text, attrs: { type: "button", "aria-pressed": "false" } });
    b.addEventListener("click", () => onPick(v));
    buttons.set(v, b);
    el.append(b);
  }
  return {
    el,
    buttons,
    set(v) {
      for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === v));
    },
  };
}

export interface SelectRow<T> {
  readonly el: HTMLElement;
  readonly select: HTMLSelectElement;
  set(v: T): void;
}

/** A labelled drop-down of `options` (value, text). */
export function select<T extends string | number>(label: string, options: readonly (readonly [T, string])[], onPick: (v: T) => void, hint?: string): SelectRow<T> {
  const el0 = h("select", { cls: "select rs-select", attrs: { "aria-label": label } }, ...options.map(([v, text]) => h("option", { text, attrs: { value: String(v) } })));
  el0.addEventListener("change", () => {
    const picked = options.find(([v]) => String(v) === el0.value);
    if (picked) onPick(picked[0]);
  });
  return {
    el: row(label, el0, hint),
    select: el0,
    set(v) {
      el0.value = String(v);
    },
  };
}

export interface ColourRow {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  set(css: string): void;
}

/** A labelled colour well; the settings keep CSS colours, shown here as #rrggbb. */
export function colour(label: string, onInput: (css: string) => void): ColourRow {
  const input = h("input", { cls: "rs-colour", attrs: { type: "color", "aria-label": label } });
  const text = h("span", { cls: "rs-readout rs-colour-text" });
  input.addEventListener("input", () => {
    text.textContent = input.value;
    onInput(input.value);
  });
  return {
    el: row(label, h("span", { cls: "rs-colour-wrap" }, input, text)),
    input,
    set(css) {
      input.value = hexOf(css);
      text.textContent = input.value;
    },
  };
}

export interface NumberRow {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  set(n: number): void;
}

/** A labelled number box with its unit: it takes Enter or leaving it, clamps to min..max, and anything else shows the value again. */
export function number(label: string, unit: string, min: number, max: number, onChange: (n: number) => void, hint?: string): NumberRow {
  const input = h("input", { cls: "rs-number", attrs: { type: "number", min: String(min), max: String(max), step: "any", "aria-label": label } });
  let shown = "";
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (input.value.trim() !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    input.value = shown;
  });
  // the editor's shortcuts stay out of the box
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return {
    el: row(label, h("span", { cls: "rs-number-wrap" }, input, unit ? h("span", { cls: "rs-unit", text: unit }) : null), hint),
    input,
    set(n) {
      shown = String(n);
      if (document.activeElement !== input) input.value = shown;
    },
  };
}

// ---- tiles -------------------------------------------------------------------------

export interface Tile<T> {
  readonly id: T;
  readonly label: string;
  /** the picture: an element (an SVG, a thumb, a swatch) filling the tile's top */
  readonly art: Node;
  readonly title?: string;
}

/** Picture tiles in a grid, one of them chosen (or none). */
export function tiles<T extends string>(label: string, items: readonly Tile<T>[], onPick: (id: T) => void, columns = 3): Choice<T | null> {
  const buttons = new Map<T | null, HTMLButtonElement>();
  const el = h("div", { cls: "rs-tiles", attrs: { role: "group", "aria-label": label } });
  el.style.setProperty("--cols", String(columns));
  for (const item of items) {
    const b = h(
      "button",
      { cls: "rs-tile", attrs: { type: "button", "aria-pressed": "false" }, title: item.title ?? item.label },
      h("span", { cls: "rs-tile-art" }, item.art),
      h("span", { cls: "rs-tile-label", text: item.label }),
    );
    b.addEventListener("click", () => onPick(item.id));
    buttons.set(item.id, b);
    el.append(b);
  }
  return {
    el,
    buttons,
    set(v) {
      for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === v));
    },
  };
}

// ---- formats -----------------------------------------------------------------------

/** A CSS colour as the #rrggbb a colour input takes; `fallback` for anything else. */
export function hexOf(css: string, fallback = "#000000"): string {
  return /^#[0-9a-f]{6}$/i.test(css) ? css.toLowerCase() : fallback;
}

export const toPct = (v: number): number => Math.round(v * 100);
export const pct = (v: number): string => `${Math.round(v)} %`;
export const signedPct = (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v)} %`;
/** Exposure as "+0.5 EV". */
export const evText = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)} EV`;
