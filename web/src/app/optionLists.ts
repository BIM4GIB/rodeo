// Tools > Options > Edit Marker List… and Line Thickness…, as Vectorworks keeps them: the markers
// and the line thicknesses the attribute controls offer (the Attributes palette's Start and End
// marker and Line weight menus), edited as lists. Vectorworks keeps both in the user's settings, not the
// drawing; Rodeo keeps them in this browser (localStorage). A marker is named and has a style
// (the filled arrow, dot and slash Rodeo draws), a size on paper and an angle; a thickness is a
// paper line weight. Reset puts back the lists Rodeo starts with.

import "./optionLists.css";
import type { LineMarker, MarkerStyle } from "../core/index.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";

const MARKERS_KEY = "openvwx.markerlist.v1";
const THICKNESS_KEY = "openvwx.thicknesses.v1";
const MM_PER_INCH = 25.4;
/** Attributes.lineWeight is in mils (1/1000 inch) */
const MM_PER_MIL = 0.0254;
/** the most entries either list keeps */
const MAX_ENTRIES = 40;
/** a drawing keeps a marker's size in 1/16384 inch and its angle in whole degrees */
const SIZE_STEP = 1 / 16384;

export interface NamedMarker {
  readonly name: string;
  readonly marker: LineMarker;
}

export const MARKER_STYLES: readonly { value: MarkerStyle; label: string }[] = [
  { value: "arrow", label: "Arrow" },
  { value: "dot", label: "Dot" },
  { value: "slash", label: "Slash" },
];

/** a new marker of each style, in paper inches: Vectorworks' default arrow is 1/8 inch at 15° */
export const NEW_MARKER: Readonly<Record<MarkerStyle, LineMarker>> = {
  arrow: { style: "arrow", size: 0.125, angle: 15, width: 0 },
  dot: { style: "dot", size: 0.0625, angle: 0, width: 0.0625 },
  slash: { style: "slash", size: 0.125, angle: 45, width: 0 },
};

const DEFAULT_MARKERS: readonly NamedMarker[] = MARKER_STYLES.map((s) => ({ name: s.label, marker: NEW_MARKER[s.value] }));
/** line weights offered at first, in mm on paper */
const DEFAULT_THICKNESS_MM = [0.05, 0.1, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2];

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage refused: the lists last this visit only
  }
}

/**
 * A marker of `style` (size in paper inches), its size and angle kept in range and to the steps a
 * drawing keeps them in; a dot's width is its size.
 */
export function makeMarker(style: MarkerStyle, size: number, angle: number): LineMarker {
  const s = Math.round(Math.min(Math.max(size, 0.01 / MM_PER_INCH), 99 / MM_PER_INCH) / SIZE_STEP) * SIZE_STEP;
  const a = Math.round(style === "arrow" ? Math.min(Math.max(angle, 1), 89) : style === "slash" ? Math.min(Math.max(angle, 0), 180) : 0);
  return { style, size: s, angle: a, width: style === "dot" ? s : 0 };
}

let markers: readonly NamedMarker[] | null = null;
let thicknesses: readonly number[] | null = null;

/** The markers Edit Marker List keeps, in order. */
export function markerList(): readonly NamedMarker[] {
  if (markers) return markers;
  const raw = read(MARKERS_KEY);
  const styles = new Set<string>(MARKER_STYLES.map((s) => s.value));
  const kept = Array.isArray(raw)
    ? raw
        .filter((m) => m && typeof m.name === "string" && styles.has(m.style) && Number.isFinite(m.size) && Number.isFinite(m.angle))
        .map((m): NamedMarker => ({ name: m.name, marker: makeMarker(m.style, m.size, m.angle) }))
    : [];
  markers = kept.length ? kept.slice(0, MAX_ENTRIES) : DEFAULT_MARKERS;
  return markers;
}

/**
 * The line thicknesses Line Thickness keeps, in millimetres as typed, thinnest first; each is
 * stored on an object as the nearest thousandth of an inch (mils).
 */
export function thicknessList(): readonly number[] {
  if (thicknesses) return thicknesses;
  const raw = read(THICKNESS_KEY);
  const kept = Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number" && n >= 0.01 && n <= 25) : [];
  thicknesses = kept.length ? distinct(kept).slice(0, MAX_ENTRIES) : DEFAULT_THICKNESS_MM;
  return thicknesses;
}

/** A thickness in mm as an object stores it, in mils. */
export function mils(mm: number): number {
  return Math.max(1, Math.round(mm / MM_PER_MIL));
}

/** Thicknesses thinnest first, one for each weight they store as. */
function distinct(mm: readonly number[]): number[] {
  const seen = new Set<number>();
  return [...mm].sort((a, b) => a - b).filter((v) => !seen.has(mils(v)) && !!seen.add(mils(v)));
}

/** Whether two markers draw the same, to the steps a drawing keeps them in. */
export function sameMarker(a: LineMarker, b: LineMarker): boolean {
  return a.style === b.style && Math.abs(a.size - b.size) < SIZE_STEP / 2 && (a.style === "dot" || Math.abs(a.angle - b.angle) < 0.5);
}

/** "Arrow, 3.18 mm, 15°": a marker described by its style, paper size and angle. */
export function markerText(m: LineMarker): string {
  const style = MARKER_STYLES.find((s) => s.value === m.style)?.label ?? m.style;
  const size = `${(m.size * MM_PER_INCH).toFixed(2)} mm`;
  return m.style === "dot" ? `${style}, ${size}` : `${style}, ${size}, ${Math.round(m.angle * 100) / 100}°`;
}

const input = (label: string, value: string, mode = "decimal"): HTMLInputElement =>
  h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: mode, "aria-label": label } });

const button = (text: string, label: string, run: () => void): HTMLButtonElement => {
  const b = h("button", { cls: "btn", text, attrs: { type: "button", "aria-label": label } });
  b.addEventListener("click", run);
  return b;
};

const num = (s: string): number => Number(s.trim().replace(",", "."));

/** Tools > Options > Edit Marker List…: the markers, each named, with its style, size and angle. */
export async function editMarkerListDialog(): Promise<void> {
  interface Row {
    readonly el: HTMLElement;
    readonly name: HTMLInputElement;
    readonly style: HTMLSelectElement;
    readonly size: HTMLInputElement;
    readonly angle: HTMLInputElement;
  }
  const rows: Row[] = [];
  const holder = h("div", { cls: "option-list" });
  const sync = (): void => {
    holder.replaceChildren(
      h("div", { cls: "option-list-head" }, h("span", { text: "Name" }), h("span", { text: "Style" }), h("span", { text: "Size (mm)" }), h("span", { text: "Angle (°)" }), h("span")),
      ...rows.map((r) => r.el),
    );
    for (const r of rows) r.angle.disabled = r.style.value === "dot";
    add.disabled = rows.length >= MAX_ENTRIES;
  };
  const addRow = (m: NamedMarker): void => {
    const name = input("Marker name", m.name, "text");
    const style = h(
      "select",
      { cls: "menu-dialog-input", attrs: { "aria-label": "Marker style" } },
      ...MARKER_STYLES.map((s) => h("option", { text: s.label, attrs: { value: s.value } })),
    );
    style.value = m.marker.style;
    const size = input("Marker size in millimetres", String(Math.round(m.marker.size * MM_PER_INCH * 1000) / 1000));
    const angle = input("Marker angle in degrees", String(m.marker.angle));
    const row: Row = {
      el: h("div", { cls: "option-list-row" }, name, style, size, angle),
      name,
      style,
      size,
      angle,
    };
    row.el.append(
      button("↑", "Move up", () => move(row, -1)),
      button("✕", "Delete marker", () => {
        rows.splice(rows.indexOf(row), 1);
        sync();
      }),
    );
    style.addEventListener("change", sync);
    rows.push(row);
  };
  const move = (row: Row, by: number): void => {
    const i = rows.indexOf(row);
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    sync();
  };
  const add = button("Add Marker", "Add a marker", () => {
    addRow({ name: `Marker ${rows.length + 1}`, marker: NEW_MARKER.arrow });
    sync();
    rows[rows.length - 1].name.select();
  });
  const reset = button("Reset", "Put back the markers Rodeo starts with", () => {
    rows.length = 0;
    for (const m of DEFAULT_MARKERS) addRow(m);
    sync();
  });
  for (const m of markerList()) addRow(m);
  sync();
  const list = await showDialog<NamedMarker[]>({
    title: "Edit Marker List",
    okLabel: "OK",
    cls: "option-list-dialog",
    body: [
      h("p", { cls: "muted", text: "The markers the Attributes palette's Start and End marker menus offer, kept in this browser. Sizes are on paper; an arrow's angle is each side's to the line, a slash's its turn from it, in whole degrees." }),
      holder,
      h("div", { cls: "option-list-actions" }, add, reset),
    ],
    check: () => {
      const out: NamedMarker[] = [];
      const names = new Set<string>();
      for (const r of rows) {
        const name = r.name.value.trim();
        if (!name) return { error: "Give every marker a name.", focus: r.name };
        if (names.has(name)) return { error: `Two markers are named ${name}.`, focus: r.name };
        names.add(name);
        const size = num(r.size.value);
        if (!(size > 0 && size <= 99)) return { error: "Size: millimetres from 0.01 to 99.", focus: r.size };
        const style = r.style.value as MarkerStyle;
        const angle = style === "dot" ? 0 : num(r.angle.value);
        if (style === "arrow" && !(angle >= 1 && angle <= 89)) return { error: "An arrow's angle: 1° to 89°.", focus: r.angle };
        if (style === "slash" && !(angle >= 0 && angle <= 180)) return { error: "A slash's angle: 0° to 180°.", focus: r.angle };
        // angles are kept in whole degrees
        out.push({ name, marker: makeMarker(style, size / MM_PER_INCH, angle) });
      }
      if (out.length === 0) return { error: "Keep at least one marker, or Reset.", focus: add };
      return { value: out };
    },
  });
  if (!list) return;
  markers = list;
  write(MARKERS_KEY, list.map((m) => ({ name: m.name, style: m.marker.style, size: m.marker.size, angle: m.marker.angle })));
  store.emit("attrs");
}

/** Tools > Options > Line Thickness…: the line weights, in millimetres on paper. */
export async function lineThicknessDialog(): Promise<void> {
  const rows: { el: HTMLElement; mm: HTMLInputElement }[] = [];
  const holder = h("div", { cls: "option-list" });
  const sync = (): void => {
    holder.replaceChildren(...rows.map((r) => r.el));
    add.disabled = rows.length >= MAX_ENTRIES;
  };
  const addRow = (value: number): void => {
    const mm = input("Thickness in millimetres", String(value));
    const row = { el: h("div", { cls: "option-list-row thickness" }, mm, h("span", { cls: "option-list-unit", text: "mm" })), mm };
    row.el.append(
      button("✕", "Delete thickness", () => {
        rows.splice(rows.indexOf(row), 1);
        sync();
      }),
    );
    rows.push(row);
  };
  const add = button("Add Thickness", "Add a thickness", () => {
    addRow(rows.length ? Math.round(((num(rows[rows.length - 1].mm.value) || 0.25) + 0.1) * 100) / 100 : 0.25);
    sync();
    rows[rows.length - 1].mm.select();
  });
  const reset = button("Reset", "Put back the thicknesses Rodeo starts with", () => {
    rows.length = 0;
    for (const mm of DEFAULT_THICKNESS_MM) addRow(mm);
    sync();
  });
  for (const m of thicknessList()) addRow(m);
  sync();
  const list = await showDialog<number[]>({
    title: "Line Thickness",
    okLabel: "OK",
    cls: "option-list-dialog",
    body: [
      h("p", { cls: "muted", text: "The line weights the Attributes palette's Line weight menu offers, thinnest first, kept in this browser. Objects keep them to the thousandth of an inch, as Vectorworks does." }),
      holder,
      h("div", { cls: "option-list-actions" }, add, reset),
    ],
    check: () => {
      const out: number[] = [];
      for (const r of rows) {
        const mm = num(r.mm.value);
        if (!(mm >= 0.01 && mm <= 25)) return { error: "Thickness: millimetres from 0.01 to 25.", focus: r.mm };
        out.push(mm);
      }
      if (out.length === 0) return { error: "Keep at least one thickness, or Reset.", focus: add };
      return { value: distinct(out) };
    },
  });
  if (!list) return;
  thicknesses = list;
  write(THICKNESS_KEY, list);
  store.emit("attrs");
}
