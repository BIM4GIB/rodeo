// Data bar: a small floating panel beside the cursor that shows the live values
// of the drawing tool in use and takes exact ones typed by the user. Tab moves
// into the fields (Tab and Shift+Tab cycle them), Enter places the point the
// values define, Esc returns focus to the canvas. A field the user types into
// is locked and highlighted: it keeps its typed value while the mouse moves,
// until Enter or Esc. The tools say what the values mean (see tools/draw.ts).
// Lengths are shown and typed in the document's units; the values the tools get are millimetres.
//
// Window > Data Bar Options, as Vectorworks has them: the bar follows the cursor, or shows only
// once Tab is pressed (and goes again when the object is placed or Esc is pressed); it sits below
// the cursor or above it; and typing a number while it shows can start its first field (numbers
// on the main keys and the keypad, the main keys only, or neither, Tab doing it). Kept in this
// browser.
//
// A stage's fields are primary (the tool's own: L and A, ΔX and ΔY, R), secondary (ΔX and ΔY
// where they aren't its own) or the cursor's location (X and Y). Data Bar Options shows the
// primary ones, those and the secondary ones, or all; Tab past the last one shown brings out the
// rest, or goes back to the first. A second point's X and Y typed put it there; else its ΔX and
// ΔY typed put it that far from the first; else the primary fields do (typedPoint).
//
// While a SmartCursor datum is set (store.datum, G over the drawing), X and Y are shown and typed
// from it, the tools still getting the drawing's own coordinates; Data Bar Options can bring the
// bar out, its first field ready, as a datum is set.

import "./databar.css";
import type { Pt } from "../core/index.ts";
import { byId, h } from "./dom.ts";
import type { Row } from "./menu.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** What a field's value is: a length (millimetres), an angle (degrees) or a count. */
export type BarKind = "length" | "angle" | "count";

export interface BarField {
  /** key of the value in BarValues */
  readonly key: string;
  readonly label: string;
  readonly suffix?: string;
  /** decimal places shown while the field follows the cursor (angles and counts) */
  readonly digits: number;
  /**
   * What the value is. Without it a field with a suffix is an angle, one with no decimals is a
   * count, and any other is a length.
   */
  readonly kind?: BarKind;
}

export interface BarStage {
  /** unique per tool stage: the fields are rebuilt only when this changes */
  readonly key: string;
  readonly caption: string;
  readonly fields: readonly BarField[];
  /** the keys of its secondary fields; X and Y are location fields, the rest primary */
  readonly secondary?: readonly string[];
}

/** the cursor location fields */
const LOCATION: ReadonlySet<string> = new Set(["x", "y"]);

/** Values by field key. Lengths are millimetres (world units), angles degrees. */
export type BarValues = Record<string, number>;

/** What typing a number does while the bar shows: start its first field from the main keys and the keypad, the main keys only, or nothing. */
type Instant = "keypad" | "keyboard" | "none";

/** The fields shown: the primary ones, those and the secondary ones, or all. */
type Shown = "primary" | "secondary" | "all";

interface Options {
  /** the bar follows the cursor; otherwise it shows only once Tab is pressed */
  readonly floating: boolean;
  /** above the cursor rather than below it */
  readonly above: boolean;
  readonly instant: Instant;
  readonly fields: Shown;
  /** Tab past the last field shown brings out the others; otherwise it goes back to the first */
  readonly autoCycle: boolean;
  /** a datum set brings the bar out with its first field ready, as Tab does */
  readonly afterDatum: boolean;
}

const OPTIONS_KEY = "openvwx.dataBar";
// typing a number does nothing unless chosen: the main keys' 3 shows the 3D view
const DEFAULT_OPTIONS: Options = { floating: true, above: false, instant: "none", fields: "primary", autoCycle: true, afterDatum: false };

let options: Options = loadOptions();

function loadOptions(): Options {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}");
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const instant: Instant = r.instant === "keypad" || r.instant === "keyboard" ? r.instant : "none";
    const fields: Shown = r.fields === "secondary" || r.fields === "all" ? r.fields : "primary";
    return { floating: r.floating !== false, above: r.above === true, instant, fields, autoCycle: r.autoCycle !== false, afterDatum: r.afterDatum === true };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function setOptions(next: Partial<Options>): void {
  options = { ...options, ...next };
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // storage full or blocked: the options last for this visit
  }
  if (!options.floating) dataBar.release();
  dataBar.restyle();
}

/** Window > Data Bar Options: a ticked toggle for each on/off option, and the three-way choices as a group of rows, the one in force ticked. */
export function dataBarOptionRows(): Row[] {
  const instant = (label: string, value: Instant): Row => ({ label, checked: () => options.instant === value, run: () => setOptions({ instant: value }) });
  const shown = (label: string, value: Shown): Row => ({ label, checked: () => options.fields === value, run: () => setOptions({ fields: value }) });
  return [
    { label: "Use Floating Data Bar Only When Tab Key Is Pressed", checked: () => !options.floating, run: () => setOptions({ floating: !options.floating }) },
    { label: "Show Floating Data Bar Above SmartCursor Cues", checked: () => options.above, run: () => setOptions({ above: !options.above }) },
    "-",
    instant("Allow Numeric Keypad Entry for Instant Data Bar Activation", "keypad"),
    instant("Do Not Allow Numeric Keypad Entry for Instant Data Bar Activation", "keyboard"),
    instant("Do Not Allow Instant Data Bar Activation", "none"),
    "-",
    shown("Show Only Primary Fields on Data Bar", "primary"),
    shown("Show Primary and Secondary Fields on Data Bar", "secondary"),
    shown("Show Primary, Secondary, and Cursor Location Fields on Data Bar", "all"),
    "-",
    { label: "Auto Cycle to Non-Displayed Fields When Tabbing Past Last Field", checked: () => options.autoCycle, run: () => setOptions({ autoCycle: !options.autoCycle }) },
    { label: "Show Floating Data Bar After Datum Creation", checked: () => options.afterDatum, run: () => setOptions({ afterDatum: !options.afterDatum }) },
  ];
}

/**
 * Where typed values put a stage's second point: at its X and Y when either was typed (the other
 * from the cursor), else `from` plus its ΔX and ΔY when either was; null when neither was, the
 * tool's own fields deciding.
 */
export function typedPoint(values: BarValues, from: Pt): Pt | null {
  const typed = dataBar.typed();
  if (typed.has("x") || typed.has("y")) return { x: values.x, y: values.y };
  if (typed.has("dx") || typed.has("dy")) return { x: from.x + values.dx, y: from.y + values.dy };
  return null;
}

export interface BarHandlers {
  /** Enter: the values (typed or live) that the point is defined by */
  readonly commit: (values: BarValues) => void;
  /** a field was typed into, so the preview should be redrawn */
  readonly edit: () => void;
}

/** Gap in CSS px between the cursor and the bar. */
const GAP = 16;
/** Smallest distance in CSS px kept between the bar and the canvas edge. */
const MARGIN = 6;
/** On a touch screen the quick bar (features/touch) floats at the drawing's right edge: the bar keeps clear of it. */
const QUICK_BAR_RESERVE = 72;
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export const FIELD_X: BarField = { key: "x", label: "X", digits: 2, kind: "length" };
export const FIELD_Y: BarField = { key: "y", label: "Y", digits: 2, kind: "length" };
export const FIELD_LENGTH: BarField = { key: "length", label: "L", digits: 2, kind: "length" };
export const FIELD_ANGLE: BarField = { key: "angle", label: "A", suffix: "°", digits: 1, kind: "angle" };
export const FIELD_DX: BarField = { key: "dx", label: "ΔX", digits: 2, kind: "length" };
export const FIELD_DY: BarField = { key: "dy", label: "ΔY", digits: 2, kind: "length" };
export const FIELD_RADIUS: BarField = { key: "radius", label: "R", digits: 2, kind: "length" };

/** How far a field's values are from the drawing's own: X and Y are measured from the datum while one is set. */
function datumOffset(key: string): number {
  const d = store.datum;
  return d && LOCATION.has(key) ? (key === "x" ? d.x : d.y) : 0;
}

/** Text of a value for a field that follows the cursor. */
function formatValue(v: number, digits: number): string {
  return String(Number(v.toFixed(digits)));
}

/** The kind of a field's value (see BarField.kind). */
function kindOf(f: BarField): BarKind {
  if (f.kind) return f.kind;
  if (f.suffix) return "angle";
  return f.digits === 0 ? "count" : "length";
}

/** The document's units: lengths in the bar are shown and typed in them. */
function unitsNow(): string | undefined {
  return store.session?.doc.info.units;
}

/** Text of a value for a field that follows the cursor: a length in the document's units, otherwise its decimals. */
function formatField(f: BarField, v: number, units: string | undefined): string {
  return kindOf(f) === "length" ? formatLengthValue(v, units) : formatValue(v, f.digits);
}

/** A typed value for a field: a length in millimetres (see parseLength), otherwise a number (see parseValue). */
function parseField(f: BarField, text: string, units: string | undefined): number | null {
  return kindOf(f) === "length" ? parseLength(text, units) : parseValue(text);
}

/** A typed value, or null when the text is not a number. Accepts "," and a trailing degree sign. */
export function parseValue(text: string): number | null {
  const t = text.trim().replace(/°$/, "").replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export class DataBar {
  private root: HTMLElement | null = null;
  private stage: BarStage | null = null;
  private handlers: BarHandlers | null = null;
  private readonly inputs = new Map<string, HTMLInputElement>();
  /** each field's label, holding its input, hidden with the field */
  private readonly labels = new Map<string, HTMLElement>();
  /** Tab went past the last field shown: the stage shows all its fields */
  private revealed = false;
  /** the unit beside each length field, which follows the document's units */
  private readonly suffixes = new Map<string, HTMLElement>();
  private readonly locked = new Set<string>();
  private live: BarValues = {};
  /** Tab brought the bar out while it floats only when Tab is pressed */
  private summoned = false;

  constructor() {
    // X and Y follow the datum as it is set, moved or released
    store.on("datum", () => this.refresh());
  }

  /** Shows the bar, mounting it into the canvas host on first use (unless it waits for Tab). */
  show(): void {
    const root = this.mount();
    if (options.floating || this.summoned) root.hidden = false;
  }

  hide(): void {
    if (!this.root) return;
    this.blurField();
    this.root.hidden = true;
  }

  /** Hides the bar unless the user is typing in it or has locked values. */
  hideIfIdle(): void {
    if (this.locked.size === 0 && !this.hasFocus()) this.hide();
  }

  /** Cancels: drops the locks, returns focus to the canvas and hides the bar. */
  reset(): void {
    this.release();
    this.hide();
  }

  /** Drops the locks and returns focus to the canvas. The fields follow the cursor again; a bar shown by Tab goes. */
  release(): void {
    this.unlock();
    this.blurField();
    if (!options.floating) {
      this.summoned = false;
      this.hide();
    }
  }

  /** Drops the locks but keeps focus where it is (the next point is starting). */
  unlock(): void {
    this.locked.clear();
    this.clearInvalid();
    this.refresh();
  }

  /**
   * Sets the fields and the tool's handlers. The locks are dropped when the
   * stage changes; the same stage keeps its locks and focus.
   */
  setStage(stage: BarStage, handlers: BarHandlers): void {
    this.handlers = handlers;
    if (this.stage?.key === stage.key) return;
    const root = this.mount();
    this.blurField();
    this.stage = stage;
    this.locked.clear();
    this.inputs.clear();
    this.labels.clear();
    this.suffixes.clear();
    this.revealed = false;
    const fields = stage.fields.map((f) => this.fieldEl(f));
    root.replaceChildren(h("span", { cls: "databar-caption", text: stage.caption }), ...fields);
    this.restyle();
    this.refresh();
  }

  /** The keys typed into: those fields keep their typed values. */
  typed(): ReadonlySet<string> {
    return this.locked;
  }

  /** Shows the fields Data Bar Options has shown (all of them once Tab has gone past the last). */
  restyle(): void {
    const shown = this.shownKeys();
    for (const [key, label] of this.labels) label.hidden = !shown.has(key);
  }

  /** The stage's fields shown: a stage of location fields alone shows them whatever the options. */
  private shownKeys(): Set<string> {
    const stage = this.stage;
    if (!stage) return new Set();
    const all = stage.fields.map((f) => f.key);
    if (this.revealed || options.fields === "all") return new Set(all);
    const secondary = new Set(stage.secondary ?? []);
    const keep = all.filter((k) => !LOCATION.has(k) && (options.fields === "secondary" || !secondary.has(k)));
    return new Set(keep.length ? keep : all);
  }

  /** The inputs shown, in order. */
  private shownInputs(): HTMLInputElement[] {
    const shown = this.shownKeys();
    return [...this.inputs].filter(([k]) => shown.has(k)).map(([, el]) => el);
  }

  /** Values of the cursor for the current stage; fields with a typed value keep it on the next refresh. */
  update(live: BarValues): void {
    this.live = live;
    this.refresh();
  }

  /** Repositions the bar beside `screen` (CSS px in the canvas host), flipping it to stay inside `box`. */
  position(screen: Pt, box: { readonly width: number; readonly height: number }): void {
    const root = this.root;
    if (!root || root.hidden) return;
    const w = root.offsetWidth;
    const hgt = root.offsetHeight;
    let x = screen.x + GAP;
    const right = box.width - MARGIN - (COARSE ? QUICK_BAR_RESERVE : 0);
    if (x + w > right) x = screen.x - GAP - w;
    // below the cursor or above it, as Data Bar Options has it, the other side where there's no room
    const below = screen.y + GAP;
    const above = screen.y - GAP - hgt;
    let y = options.above ? above : below;
    if (options.above && y < MARGIN) y = below;
    else if (!options.above && y + hgt > box.height - MARGIN) y = above;
    root.style.left = `${Math.max(MARGIN, x)}px`;
    root.style.top = `${Math.max(MARGIN, y)}px`;
  }

  /** Moves focus to the first (or last) field, bringing out a bar that waits for Tab. False when the bar has no fields or is hidden. */
  focusField(backwards: boolean): boolean {
    const list = this.shownInputs();
    if (list.length > 0 && this.root?.hidden && !options.floating) {
      this.summoned = true;
      this.root.hidden = false;
    }
    if (list.length === 0 || !this.root || this.root.hidden) return false;
    const active = document.activeElement;
    const cur = list.findIndex((el) => el === active);
    // Tab past the last field shown brings out the others, at the first of them
    const hidden = [...this.inputs.values()].filter((el) => !list.includes(el));
    if (!backwards && cur === list.length - 1 && hidden.length > 0 && options.autoCycle) {
      this.revealed = true;
      this.restyle();
      hidden[0].focus();
      hidden[0].select();
      return true;
    }
    const next =
      cur < 0
        ? list[backwards ? list.length - 1 : 0]
        : list[(cur + (backwards ? -1 : 1) + list.length) % list.length];
    if (!next) return false;
    next.focus();
    next.select();
    return true;
  }

  /**
   * A datum was just set: as Data Bar Options has it, the bar comes out with its first field
   * ready for a value measured from it (as Tab would), or waits for Tab. True when it came out.
   */
  datumSet(): boolean {
    return options.afterDatum && this.focusField(false);
  }

  /**
   * Instant activation: a number typed while the bar shows, and nothing in it has focus, starts
   * its first field (keypad numbers too, when Data Bar Options allows them). True when it did.
   */
  instantKey(e: KeyboardEvent): boolean {
    if (options.instant === "none" || !this.root || this.root.hidden || this.hasFocus()) return false;
    if (e.metaKey || e.ctrlKey || e.altKey || !/^[0-9.,-]$/.test(e.key)) return false;
    if (e.code.startsWith("Numpad") && options.instant !== "keypad") return false;
    const first = this.shownInputs()[0];
    if (!first) return false;
    first.focus();
    first.value = e.key;
    first.setSelectionRange(1, 1);
    first.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  /** Puts focus on the first field unless it is already inside the bar. */
  keepFocus(): void {
    if (!this.hasFocus()) this.focusField(false);
  }

  hasLocks(): boolean {
    return this.locked.size > 0;
  }

  /**
   * Values for the current stage: typed (locked) fields as typed, the others
   * from `live`. Null when a typed value is not a number or a live one is missing.
   */
  resolve(live: BarValues): BarValues | null {
    const stage = this.stage;
    if (!stage) return null;
    const units = unitsNow();
    const out: BarValues = {};
    for (const f of stage.fields) {
      if (this.locked.has(f.key)) {
        const typed = parseField(f, this.inputs.get(f.key)?.value ?? "", units);
        if (typed === null) return null;
        // X and Y are typed from the datum; the tools get the drawing's own
        out[f.key] = typed + datumOffset(f.key);
      } else {
        const v = live[f.key];
        if (v === undefined || !Number.isFinite(v)) return null;
        out[f.key] = v;
      }
    }
    return out;
  }

  private mount(): HTMLElement {
    if (this.root) return this.root;
    const wrap = byId("canvas-wrap");
    const canvas = byId("canvas");
    const root = h("div", { cls: "databar", attrs: { role: "group", "aria-label": "Exact values" } });
    root.hidden = true;
    root.addEventListener("keydown", (e) => this.onKey(e));
    root.addEventListener("input", (e) => this.onInput(e));
    root.addEventListener("focusout", () => this.refresh());
    root.addEventListener("pointerleave", (e) => {
      if (e.relatedTarget !== canvas) this.hideIfIdle();
    });
    // the bar sits beside the cursor, so the pointer can cross onto it without leaving the canvas for good
    canvas.addEventListener("pointerleave", (e) => {
      if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) this.hideIfIdle();
    });
    wrap.append(root);
    this.root = root;
    return root;
  }

  private fieldEl(f: BarField): HTMLElement {
    let suffix: HTMLElement | null = null;
    if (kindOf(f) === "length") {
      // filled in by refresh, since the unit depends on the document
      suffix = h("span", { cls: "databar-suffix" });
      this.suffixes.set(f.key, suffix);
    } else if (f.suffix) {
      suffix = h("span", { cls: "databar-suffix", text: f.suffix });
    }
    const input = h("input", {
      cls: "databar-input",
      attrs: {
        type: "text",
        inputmode: "decimal",
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": f.label,
        "data-key": f.key,
      },
    });
    this.inputs.set(f.key, input);
    const label = h("label", { cls: "databar-field" }, h("span", { cls: "databar-label", text: f.label }), input, suffix);
    this.labels.set(f.key, label);
    return label;
  }

  /** Writes the live values into the fields that are neither locked nor typed into. */
  private refresh(): void {
    const stage = this.stage;
    if (!stage) return;
    const active = document.activeElement;
    const units = unitsNow();
    // X and Y read from the datum: their labels say so
    this.root?.classList.toggle("from-datum", store.datum !== null);
    for (const f of stage.fields) {
      const input = this.inputs.get(f.key);
      if (!input) continue;
      if (LOCATION.has(f.key)) this.labels.get(f.key)?.setAttribute("title", store.datum ? `${f.label} from the datum` : "");
      const isLocked = this.locked.has(f.key);
      input.classList.toggle("is-locked", isLocked);
      const suffix = this.suffixes.get(f.key);
      if (suffix) {
        // feet and inches carry their marks in the number, so they have no suffix
        suffix.textContent = lengthSuffix(units);
        suffix.hidden = suffix.textContent === "";
      }
      if (isLocked) continue;
      const v = this.live[f.key];
      const text = v === undefined || !Number.isFinite(v) ? "" : formatField(f, v - datumOffset(f.key), units);
      if (input === active) {
        // a focused field follows the cursor too, but stays selected so typing replaces it
        if (input.value !== text) {
          input.value = text;
          input.select();
        }
      } else {
        input.value = text;
      }
    }
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case "Tab":
        this.focusField(e.shiftKey);
        break;
      case "Enter":
        this.commit();
        break;
      case "Escape":
        this.release();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private onInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const key = input.dataset.key;
    if (!key) return;
    // emptying a field gives it back to the cursor
    if (input.value.trim() === "") this.locked.delete(key);
    else this.locked.add(key);
    input.classList.toggle("is-locked", this.locked.has(key));
    input.classList.remove("is-invalid");
    this.handlers?.edit();
  }

  private commit(): void {
    const values = this.resolve(this.live);
    if (!values) {
      this.markInvalid();
      return;
    }
    this.handlers?.commit(values);
  }

  private markInvalid(): void {
    const units = unitsNow();
    for (const f of this.stage?.fields ?? []) {
      const input = this.inputs.get(f.key);
      if (this.locked.has(f.key) && input && parseField(f, input.value, units) === null) {
        input.classList.add("is-invalid");
      }
    }
  }

  private clearInvalid(): void {
    for (const input of this.inputs.values()) input.classList.remove("is-invalid");
  }

  private hasFocus(): boolean {
    const active = document.activeElement;
    return this.root !== null && active instanceof Node && this.root.contains(active);
  }

  private blurField(): void {
    const active = document.activeElement;
    if (this.hasFocus() && active instanceof HTMLElement) active.blur();
  }
}

/** The data bar shared by the drawing tools. */
export const dataBar = new DataBar();
