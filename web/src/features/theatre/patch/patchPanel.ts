// Stage > Lighting Paperwork > Patch…: a window of three tabs over the drawing's instruments. Patch Wizard proposes a
// universe and address for each (all of them, or those selected) and Apply writes them as one undo step. Numbering
// does the same for unit and channel numbers. Universe Map draws each universe's 512 addresses, the shared ones
// outlined in red, with what's at an address under the pointer and listed under the map. The planning is patch.ts.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import type { Fixture } from "../fixture.ts";
import { editFixtures, fixtures } from "../instrument.ts";
import { stageFrame } from "../stageTool.ts";
import { dataTable, noteLine, openPanel, tabs, type Column, type OpenPanel, type Tab } from "../ui.ts";
import { conflicts, counted, numberChannels, numberUnits, planPatch, spanOf, universeMap, UNIVERSE_SIZE, type PatchOrder, type Patched, type UniverseInfo } from "./patch.ts";
import "./patch.css";

type Scope = "all" | "selected";

const SCOPES: readonly { readonly value: Scope; readonly label: string }[] = [
  { value: "all", label: "All instruments" },
  { value: "selected", label: "Selected instruments" },
];
const ORDERS: readonly { readonly value: PatchOrder; readonly label: string }[] = [
  { value: "position", label: "Position, then stage right to stage left" },
  { value: "channel", label: "Channel number" },
  { value: "unit", label: "Unit number" },
];
const NUMBERING: readonly { readonly value: "units" | "channels"; readonly label: string }[] = [
  { value: "units", label: "Unit numbers" },
  { value: "channels", label: "Channel numbers" },
];
const CHANNEL_BY: readonly { readonly value: "each" | "purpose"; readonly label: string }[] = [
  { value: "each", label: "Each instrument its own channel" },
  { value: "purpose", label: "One channel per purpose and colour" },
];

/** The Patch Wizard's and Numbering's settings, remembered between openings of the window (not saved in the drawing). */
const wizard: { scope: Scope; universe: number; address: number; gap: number; order: PatchOrder } = { scope: "all", universe: 1, address: 1, gap: 0, order: "position" };
const numbering: { mode: "units" | "channels"; scope: Scope; start: number; by: "each" | "purpose" } = { mode: "units", scope: "all", start: 1, by: "each" };

/** A proposed patch line: the instrument, and its universe and start address. */
interface PatchLine {
  readonly f: Fixture;
  readonly universe: number;
  readonly address: number;
}

/** A proposed number: the instrument, what it's numbered now, and what it would be. */
interface NumberLine {
  readonly f: Fixture;
  readonly now: string;
  readonly next: string;
}

/** The instruments in scope: all, or those selected on the drawing. */
function scopeList(scope: Scope): Fixture[] {
  const all = fixtures();
  return scope === "selected" ? all.filter((f) => store.selection.has(f.id)) : [...all];
}

/** The instruments with a planned patch applied, for the usage and clash checks. */
function withPatch(list: readonly Fixture[], lines: readonly PatchLine[]): Fixture[] {
  const at = new Map(lines.map((l) => [l.f.id, l] as const));
  return list.map((f) => {
    const l = at.get(f.id);
    return l ? { ...f, universe: l.universe, address: l.address } : f;
  });
}

function proposedLines(): PatchLine[] {
  const scope = scopeList(wizard.scope);
  const byId = new Map(scope.map((f) => [f.id, f] as const));
  const planned: readonly Patched[] = planPatch(scope, { universe: wizard.universe, address: wizard.address, gap: wizard.gap, order: wizard.order, frame: stageFrame() });
  return planned.flatMap((p) => {
    const f = byId.get(p.id);
    return f ? [{ f, universe: p.universe, address: p.address }] : [];
  });
}

function numberLines(): NumberLine[] {
  const list = scopeList(numbering.scope);
  const frame = stageFrame();
  const byId = new Map(list.map((f) => [f.id, f] as const));
  const next: { readonly id: string; readonly value: string }[] =
    numbering.mode === "units"
      ? numberUnits(list, frame, { start: numbering.start }).map((r) => ({ id: r.id, value: r.unit }))
      : numberChannels(list, { start: numbering.start, by: numbering.by, frame }).map((r) => ({ id: r.id, value: r.channel }));
  return next.flatMap(({ id, value }) => {
    const f = byId.get(id);
    return f ? [{ f, now: numbering.mode === "units" ? f.unit : f.channel, next: value }] : [];
  });
}

/** A labelled control in the window's form. */
function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "patch-field" }, h("span", { text: label }), control);
}

function choice<T extends string>(label: string, options: readonly { readonly value: T; readonly label: string }[], value: T, set: (v: T) => void): HTMLSelectElement {
  const select = h(
    "select",
    { cls: "patch-input", attrs: { "aria-label": label } },
    ...options.map((o) => h("option", { value: o.value, text: o.label })),
  );
  select.value = value;
  select.addEventListener("change", () => set(select.value as T));
  return select;
}

/** A whole number from `min` to `max`: a typed value is kept within the range, and text that isn't a number is put back. */
function count(label: string, value: number, min: number, max: number, set: (v: number) => void): HTMLInputElement {
  const attrs = { type: "number", inputmode: "numeric", min: String(min), max: String(max), step: "1", "aria-label": label };
  const input = h("input", { cls: "patch-input", value: String(value), attrs });
  input.addEventListener("change", () => {
    const n = Math.round(Number(input.value));
    const v = input.value.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    input.value = String(v);
    set(v);
  });
  return input;
}

/** The Patch Wizard's lines of text above its table: what the patch would do, and what it can't. */
function wizardStatus(lines: readonly PatchLine[], scope: readonly Fixture[], all: readonly Fixture[]): HTMLElement[] {
  if (scope.length === 0) return [h("p", { cls: "patch-summary", text: "No instruments in scope. Choose All instruments, or select some on the drawing." })];
  const touched = universeMap(withPatch(all, lines)).filter((u) => lines.some((l) => l.universe === u.universe));
  const uses = touched.map((u: UniverseInfo) => `universe ${u.universe} used ${u.used} of ${UNIVERSE_SIZE}`).join(", ");
  const left = scope.length - lines.length;
  const out: HTMLElement[] = [h("p", { cls: "patch-summary", text: `${lines.length} of ${counted(scope.length, "instrument")} would be patched${uses ? `: ${uses}` : ""}.` })];
  if (left > 0) out.push(noteLine(`${left === 1 ? "One instrument is" : `${left} instruments are`} wider than a universe and left out.`, "th-bad"));
  const clashes = conflicts(withPatch(all, lines)).length;
  if (clashes > 0) out.push(noteLine(`${counted(clashes, "pair")} of instruments would share addresses, outlined in red on the Universe Map.`, "th-warn"));
  return out;
}

const PATCH_COLUMNS: readonly Column<PatchLine>[] = [
  { label: "Position", value: (r) => r.f.position || "-" },
  { label: "Unit", value: (r) => r.f.unit || "-" },
  { label: "Instrument", value: (r) => r.f.label || "Instrument" },
  { label: "Channel", value: (r) => r.f.channel || "-" },
  { label: "Footprint", value: (r) => spanOf(r.f), numeric: true },
  { label: "Universe", value: (r) => r.universe, numeric: true },
  { label: "Address", value: (r) => r.address, numeric: true },
  { label: "Last Address", value: (r) => r.address + spanOf(r.f) - 1, numeric: true },
];

function wizardTab(): HTMLElement {
  const status = h("div", { cls: "patch-status" });
  const update = (): void => {
    status.replaceChildren(...wizardStatus(proposedLines(), scopeList(wizard.scope), fixtures()));
    table.refresh();
  };
  const table = dataTable(PATCH_COLUMNS, () => proposedLines(), { empty: "Nothing to patch yet." });
  const apply = h("button", { cls: "btn primary", text: "Apply Patch", attrs: { type: "button" } });
  apply.addEventListener("click", () => {
    const lines = proposedLines();
    if (lines.length === 0) {
      toast("Nothing to patch: choose All instruments, or select some on the drawing.", "info");
      return;
    }
    const edits = lines.map((l) => ({ id: l.f.id, edit: { universe: l.universe, address: l.address } }));
    if (editFixtures("Patch Instruments", edits)) toast(`Patched ${counted(lines.length, "instrument")}.`, "info");
    update();
  });
  const form = h(
    "div",
    { cls: "patch-form" },
    field("Instruments", choice("Instruments", SCOPES, wizard.scope, (v) => { wizard.scope = v; update(); })),
    field("Start universe", count("Start universe", wizard.universe, 1, 63999, (v) => { wizard.universe = v; update(); })),
    field("Start address", count("Start address", wizard.address, 1, UNIVERSE_SIZE, (v) => { wizard.address = v; update(); })),
    field("Spare addresses after each", count("Spare addresses after each", wizard.gap, 0, UNIVERSE_SIZE - 1, (v) => { wizard.gap = v; update(); })),
    field("Order", choice("Order", ORDERS, wizard.order, (v) => { wizard.order = v; update(); })),
  );
  update();
  return h("div", { cls: "th-tab-body" }, form, status, table.element, h("div", { cls: "patch-actions" }, apply));
}

const NUMBER_HEAD = (mode: "units" | "channels"): { now: string; next: string; done: string } =>
  mode === "units" ? { now: "Unit Now", next: "New Unit", done: "unit" } : { now: "Channel Now", next: "New Channel", done: "channel" };

function numberingTab(): HTMLElement {
  const heads = NUMBER_HEAD(numbering.mode);
  const columns: readonly Column<NumberLine>[] = [
    { label: "Position", value: (r) => r.f.position || "-" },
    { label: "Instrument", value: (r) => r.f.label || "Instrument" },
    { label: heads.now, value: (r) => r.now || "-" },
    { label: heads.next, value: (r) => r.next, numeric: true },
  ];
  const status = h("div", { cls: "patch-status" });
  const table = dataTable(columns, () => numberLines(), { empty: "Nothing to number yet." });
  const update = (): void => {
    const lines = numberLines();
    const how =
      numbering.mode === "units"
        ? "Units count up from the start number in each position, from stage right to stage left."
        : numbering.by === "each"
          ? "Each instrument gets its own channel, in position order."
          : "Instruments with the same purpose and colour share a channel.";
    const text = lines.length ? `${counted(lines.length, "instrument")} to number. ${how}` : "No instruments in scope. Choose All instruments, or select some on the drawing.";
    status.replaceChildren(h("p", { cls: "patch-summary", text }));
    table.refresh();
  };
  const apply = h("button", { cls: "btn primary", text: "Apply Numbers", attrs: { type: "button" } });
  apply.addEventListener("click", () => {
    const lines = numberLines();
    if (lines.length === 0) {
      toast("Nothing to number: choose All instruments, or select some on the drawing.", "info");
      return;
    }
    const unit = numbering.mode === "units";
    const edits = lines.map((l) => ({ id: l.f.id, edit: unit ? { unit: l.next } : { channel: l.next } }));
    if (editFixtures(unit ? "Number Units" : "Number Channels", edits)) toast(`Numbered ${counted(lines.length, heads.done)}.`, "info");
    update();
  });
  const form = h(
    "div",
    { cls: "patch-form" },
    field("Number", choice("Number", NUMBERING, numbering.mode, (v) => { numbering.mode = v; redraw(); })),
    field("Instruments", choice("Numbering instruments", SCOPES, numbering.scope, (v) => { numbering.scope = v; update(); })),
    field("Start at", count("Start at", numbering.start, 1, 99999, (v) => { numbering.start = v; update(); })),
    ...(numbering.mode === "channels" ? [field("Channels", choice("Channels", CHANNEL_BY, numbering.by, (v) => { numbering.by = v; update(); }))] : []),
  );
  update();
  return h("div", { cls: "th-tab-body" }, form, status, table.element, h("div", { cls: "patch-actions" }, apply));
}

/** A grid's size on screen, in CSS pixels: 32 addresses to a row, 16 rows, with the row numbers to the left. */
const PER_ROW = 32;
const ROWS = UNIVERSE_SIZE / PER_ROW;
const CELL = 20;
const LABEL_W = 36;
const GRID_W = LABEL_W + PER_ROW * CELL;
const GRID_H = ROWS * CELL;

/** Each instrument's colour, spread round the hue wheel so neighbours differ. */
function colourOf(index: number): string {
  return `hsl(${(index * 137.508) % 360} 60% 60%)`;
}

/** Draws one universe: a cell per address, coloured by the instrument on it, shared addresses outlined in red. */
function drawGrid(canvas: HTMLCanvasElement, info: UniverseInfo, index: ReadonlyMap<string, number>): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = GRID_W * dpr;
  canvas.height = GRID_H * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const root = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => root.getPropertyValue(name).trim() || fallback;
  ctx.clearRect(0, 0, GRID_W, GRID_H);
  const first = new Int32Array(UNIVERSE_SIZE + 1).fill(-1);
  const covered = new Uint8Array(UNIVERSE_SIZE + 1);
  info.blocks.forEach((b, i) => {
    for (let a = Math.max(1, b.start); a <= Math.min(b.end, UNIVERSE_SIZE); a++) {
      if (covered[a] === 0) first[a] = i;
      if (covered[a] < 255) covered[a]++;
    }
  });
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = token("--text-3", "#888");
  for (let r = 0; r < ROWS; r++) ctx.fillText(String(r * PER_ROW + 1), LABEL_W - 6, r * CELL + CELL / 2);
  for (let a = 1; a <= UNIVERSE_SIZE; a++) {
    const col = (a - 1) % PER_ROW;
    const row = Math.floor((a - 1) / PER_ROW);
    const x = LABEL_W + col * CELL + 1;
    const y = row * CELL + 1;
    const block = covered[a] > 0 ? info.blocks[first[a]] : undefined;
    ctx.fillStyle = block ? colourOf(index.get(block.fixtureId) ?? 0) : token("--fill", "rgba(127, 127, 127, 0.14)");
    ctx.fillRect(x, y, CELL - 2, CELL - 2);
    if (covered[a] > 1) {
      ctx.strokeStyle = token("--danger", "#d64545");
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, CELL - 4, CELL - 4);
    }
  }
}

/** What is at address `a` of a universe, in words for the readout and the list. */
function describeAt(info: UniverseInfo, a: number): string {
  const here = info.blocks.filter((b) => a >= b.start && a <= b.end);
  if (here.length === 0) return `Universe ${info.universe}, address ${a}: free.`;
  return `Universe ${info.universe}, address ${a}: ${here.map((b) => b.label).join(" and ")}${here.length > 1 ? " (shared)" : ""}.`;
}

const READOUT = "Move the pointer over a universe to see what's at each address.";

/** One universe: its header, its map, and its instruments listed by address. */
function universeGrid(info: UniverseInfo, index: ReadonlyMap<string, number>): HTMLElement {
  const canvas = h("canvas", { cls: "patch-canvas", attrs: { width: String(GRID_W), height: String(GRID_H), role: "img", "aria-label": `Universe ${info.universe} map` } });
  const readout = h("p", { cls: "patch-readout", text: READOUT });
  const addressAt = (e: PointerEvent): number => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return 0;
    const x = ((e.clientX - r.left) * GRID_W) / r.width;
    const y = ((e.clientY - r.top) * GRID_H) / r.height;
    const col = Math.floor((x - LABEL_W) / CELL);
    const row = Math.floor(y / CELL);
    if (x < LABEL_W || col < 0 || col >= PER_ROW || row < 0 || row >= ROWS) return 0;
    const a = row * PER_ROW + col + 1;
    return a <= UNIVERSE_SIZE ? a : 0;
  };
  canvas.addEventListener("pointermove", (e) => {
    const a = addressAt(e);
    readout.textContent = a ? describeAt(info, a) : READOUT;
  });
  canvas.addEventListener("pointerleave", () => {
    readout.textContent = READOUT;
  });
  const shares = (b: UniverseInfo["blocks"][number]): boolean => info.blocks.some((o) => o !== b && o.start <= b.end && o.end >= b.start);
  const list = h(
    "ol",
    { cls: "patch-blocks" },
    ...info.blocks.map((b) => {
      const runs = b.end > UNIVERSE_SIZE ? " (runs past 512)" : "";
      const clash = shares(b) ? " (shares addresses)" : "";
      return h("li", { cls: runs || clash ? "th-bad" : undefined, text: `${b.start} to ${b.end}  ${b.label}${runs}${clash}` });
    }),
  );
  drawGrid(canvas, info, index);
  return h(
    "section",
    { cls: "patch-universe" },
    h("div", { cls: "patch-universe-head" }, `Universe ${info.universe}`, h("span", { text: `used ${info.used} of ${UNIVERSE_SIZE}, ${info.free} free` })),
    canvas,
    readout,
    list,
  );
}

function mapTab(): HTMLElement {
  const list = fixtures();
  const maps = universeMap(list);
  const index = new Map(list.map((f, i) => [f.id, i] as const));
  const clashes = conflicts(list).length;
  const notes: HTMLElement[] = [];
  if (maps.length === 0) notes.push(noteLine("No instrument is patched yet. Patch Wizard gives each one a universe and address."));
  else notes.push(noteLine(`${counted(maps.length, "universe")} in use, ${counted(list.filter((f) => f.universe > 0 && f.address > 0).length, "instrument")} patched.`));
  if (clashes > 0) notes.push(noteLine(`${counted(clashes, "pair")} of instruments share addresses, outlined in red on the map.`, "th-bad"));
  return h("div", { cls: "patch-scroll" }, ...notes, ...maps.map((m) => universeGrid(m, index)));
}

const TABS: readonly Tab[] = [
  { id: "wizard", label: "Patch Wizard", build: wizardTab },
  { id: "numbering", label: "Numbering", build: numberingTab },
  { id: "map", label: "Universe Map", build: mapTab },
];

let shown: OpenPanel | null = null;
let panelTabs: ReturnType<typeof tabs> | null = null;
let unwatch: (() => void) | null = null;

let queued = false;

/** Rebuilds the tab in front after the drawing or the selection changes, once the change has finished (so the instruments read are the new ones). */
function redraw(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    panelTabs?.refresh();
  });
}

/** Watches the drawing and the selection while the window is open. */
function watch(): () => void {
  let off = store.session?.onChange(redraw) ?? null;
  const again = store.on(["session", "selection"], () => {
    off?.();
    off = store.session?.onChange(redraw) ?? null;
    redraw();
  });
  return () => {
    off?.();
    again();
  };
}

/** Opens the Patch window on the Patch Wizard (a window already open is brought forward). */
export function openPatchPanel(): void {
  if (shown?.element.isConnected) {
    document.body.append(shown.element);
    return;
  }
  panelTabs = tabs(TABS);
  shown = openPanel({
    key: "patch",
    title: "Patch",
    body: panelTabs.element,
    width: 800,
    height: 620,
    onClose: () => {
      unwatch?.();
      unwatch = null;
      panelTabs = null;
      shown = null;
    },
  });
  unwatch = watch();
}
