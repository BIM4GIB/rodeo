// Tools > Records > Modify by Record…, Vectorworks' command of that name: the objects' colours, sizes
// or heights from the number in a field of a data record attached to them. Color Gradient gives
// each object the colour a gradient has where its value falls between a lower and an upper bound
// (one of the drawing's gradients, or a yellow-red-brown one when it has none); Color Ranges the
// colour of the range (lower to upper bound) its value falls in; Color Value a colour for each
// value found. Each sets the fill's or the pen's background or foreground colour (a solid fill
// shows its background), as the nearest of the drawing's colours. Resize scales each object about
// its middle by its value times a multiplier, Extrude extrudes it that high, and Elevate 2D Polys
// turns each polygon and polyline into a 3D polygon at that elevation (2D Polys to 3D Source
// Data's). Values and heights are in the drawing's units. It acts on the whole drawing or the
// selection, and inside groups when asked; groups and symbols themselves are left alone, as are
// objects whose field holds no number. One undo step. The last settings are kept in this browser.

import type { GradientStop, ObjectInfo, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import "./modifyByRecord.css";
import { showDialog } from "./menubar.ts";
import { colorSwatch } from "./panels/colorPicker.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { parseLength } from "./units.ts";

type Op = "gradient" | "ranges" | "values" | "resize" | "extrude" | "elevate";
type Slot = "fillBack" | "fillFore" | "penBack" | "penFore";

const OPS: readonly (readonly [Op, string])[] = [
  ["gradient", "Color Gradient"],
  ["ranges", "Color Ranges"],
  ["values", "Color Value"],
  ["resize", "Resize"],
  ["extrude", "Extrude"],
  ["elevate", "Elevate 2D Polys"],
];
const SLOTS: readonly (readonly [Slot, string])[] = [
  ["fillBack", "Fill Background"],
  ["fillFore", "Fill Foreground"],
  ["penBack", "Pen Background"],
  ["penFore", "Pen Foreground"],
];
/** the gradient offered when the drawing has none: Vectorworks' example's yellow, red and brown */
const BUILT_IN: readonly GradientStop[] = [
  { at: 0, color: "#ffe14d", opacity: 1, midpoint: 0.5 },
  { at: 0.5, color: "#e2401c", opacity: 1, midpoint: 0.5 },
  { at: 1, color: "#6b3a1e", opacity: 1, midpoint: 0.5 },
];
const BUILT_IN_ID = "built-in";
const STORAGE_KEY = "openvwx.modifyByRecord";

interface Prefs {
  readonly op: Op;
  readonly slot: Slot;
  readonly multiplier: number;
  readonly selected: boolean;
  readonly groups: boolean;
  /** the record format's name and the field last used */
  readonly record: string;
  readonly field: string;
}

const DEFAULT_PREFS: Prefs = { op: "gradient", slot: "fillBack", multiplier: 1, selected: false, groups: false, record: "", field: "" };

function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    return {
      op: OPS.some(([o]) => o === r.op) ? (r.op as Op) : DEFAULT_PREFS.op,
      slot: SLOTS.some(([s]) => s === r.slot) ? (r.slot as Slot) : DEFAULT_PREFS.slot,
      multiplier: typeof r.multiplier === "number" && Number.isFinite(r.multiplier) ? r.multiplier : DEFAULT_PREFS.multiplier,
      selected: r.selected === true,
      groups: r.groups === true,
      record: typeof r.record === "string" ? r.record : "",
      field: typeof r.field === "string" ? r.field : "",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage full or blocked: the settings last for this visit
  }
}

/** An object the command can change and the number its field holds. */
interface Target {
  readonly o: ObjectInfo;
  readonly value: number;
}

/** The field's number, or null when it holds none (text that isn't a number, a check box, nothing). */
function numberOf(doc: VwxDocument, id: string, format: number, field: string): number | null {
  const v = doc
    .records(id)
    .find((r) => !r.parametric && r.format === format)
    ?.fields.find((f) => f.name === field)?.value;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * The objects the command reaches: on any layer or among the selection, inside groups only when
 * `groups` says so (through groups alone: not inside symbols, plug-ins or viewports; the group
 * being edited counts as the layer). Groups and symbol instances themselves are left out.
 */
function reach(doc: VwxDocument, selected: boolean, groups: boolean): ObjectInfo[] {
  const out: ObjectInfo[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (isDerivedId(o.id) || o.kind === "group" || o.kind === "symbol") continue;
      let ok = !selected || store.selection.has(o.id);
      // the group being edited counts as the layer
      for (let up = o.parentId; up !== null && up !== store.editGroupId; ) {
        const p = doc.object(up);
        if (!p || p.kind !== "group" || !groups) {
          ok = false;
          break;
        }
        if (selected && store.selection.has(p.id)) ok = true;
        up = p.parentId;
      }
      if (ok) out.push(o);
    }
  }
  return out;
}

/** The data record formats attached to `objects`, by name. */
function formatsOf(doc: VwxDocument, objects: readonly ObjectInfo[]): { format: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const o of objects) for (const r of doc.records(o.id)) if (!r.parametric && !seen.has(r.format)) seen.set(r.format, r.name);
  return [...seen].map(([format, name]) => ({ format, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The colour `stops` have at `t` (0..1), as #rrggbb. */
function colourAt(stops: readonly GradientStop[], t: number): string {
  const s = [...stops].sort((a, b) => a.at - b.at);
  if (!s.length) return "#000000";
  if (t <= s[0].at) return s[0].color;
  for (let i = 1; i < s.length; i++) {
    if (t > s[i].at) continue;
    const a = s[i - 1];
    const b = s[i];
    const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
    // the blend is half way at the first stop's midpoint
    const m = Math.min(0.99, Math.max(0.01, a.midpoint));
    const k = f < m ? (0.5 * f) / m : 0.5 + (0.5 * (f - m)) / (1 - m);
    const [ra, ga, ba] = rgb(a.color);
    const [rb, gb, bb] = rgb(b.color);
    const mix = (x: number, y: number): string => Math.round(x + (y - x) * k).toString(16).padStart(2, "0");
    return `#${mix(ra, rb)}${mix(ga, gb)}${mix(ba, bb)}`;
  }
  return s[s.length - 1].color;
}

function rgb(css: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(css);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The drawing's colour nearest `css`. */
function nearestColour(doc: VwxDocument, css: string): number {
  const [r, g, b] = rgb(css);
  let best = doc.colors()[0]?.index ?? 0;
  let d = Infinity;
  for (const c of doc.colors()) {
    const [cr, cg, cb] = rgb(c.css);
    const e = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (e < d) {
      d = e;
      best = c.index;
    }
  }
  return best;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
}

function select(label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement {
  const el = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
    ...options.map(([v, text]) => h("option", { value: v, text })),
  );
  el.value = value;
  return el;
}

function numberInput(label: string, value: number): HTMLInputElement {
  return h("input", { cls: "menu-dialog-input mbr-number", value: String(value), attrs: { type: "number", step: "any", "aria-label": label } });
}

/** A colour the dialog holds, shown as a swatch that changes it. */
function swatchSlot(doc: VwxDocument, label: string, initial: number): { readonly el: HTMLElement; get(): number } {
  let colour = initial;
  const el = h("span", { cls: "mbr-swatch" });
  const draw = (): void => {
    el.replaceChildren(
      colorSwatch({
        doc,
        value: colour,
        label,
        onPick: (index) => {
          colour = index;
          draw();
        },
      }),
    );
  };
  draw();
  return { el, get: () => colour };
}

function fmt(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

type Plan =
  | { readonly op: "gradient"; readonly slot: Slot; readonly lower: number; readonly upper: number; readonly stops: readonly GradientStop[] }
  | { readonly op: "ranges"; readonly slot: Slot; readonly ranges: readonly { lower: number; upper: number; colour: number }[] }
  | { readonly op: "values"; readonly slot: Slot; readonly colours: ReadonlyMap<number, number> }
  | { readonly op: "resize" | "extrude" | "elevate"; readonly multiplier: number };

interface Choice {
  readonly targets: readonly Target[];
  readonly plan: Plan;
  readonly prefs: Prefs;
}

/** Tools > Records > Modify by Record…: the dialog, then the change. */
export async function modifyByRecordDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const prefs = loadPrefs();
  const units = doc.info.units;

  const scopeAll = h("input", { checked: !prefs.selected || store.selection.size === 0, attrs: { type: "radio", name: "mbr-scope", "aria-label": "Entire drawing" } });
  const scopeSel = h("input", { checked: prefs.selected && store.selection.size > 0, attrs: { type: "radio", name: "mbr-scope", "aria-label": "Selected objects only" } });
  scopeSel.disabled = store.selection.size === 0;
  const groups = h("input", { checked: prefs.groups, attrs: { type: "checkbox", "aria-label": "Include components of groups" } });

  const record = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Record" } });
  const recordField = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Record Field" } });
  const opRadios = OPS.map(([op, label]) => {
    const input = h("input", { checked: op === prefs.op, value: op, attrs: { type: "radio", name: "mbr-op", "aria-label": label } });
    return { op, input, row: h("label", { cls: "menu-dialog-check" }, input, label) };
  });
  const options = h("div", { cls: "mbr-options" });
  const found = h("p", { cls: "muted mbr-found" });

  const gradients = doc.resources().filter((r) => r.kind === "gradient" && r.gradient && r.gradient.length > 0);
  const slot = select("Apply to", SLOTS, prefs.slot);
  const lower = numberInput("Lower bound", 0);
  const upper = numberInput("Upper bound", 1);
  const gradient = select(
    "Gradient",
    [[BUILT_IN_ID, "Yellow to Brown (built in)"], ...gradients.map((g): [string, string] => [String(g.index), g.name])],
    gradients.length ? String(gradients[0].index) : BUILT_IN_ID,
  );
  const ramp = h("span", { cls: "mbr-ramp", attrs: { "aria-hidden": "true" } });
  const stopsOf = (): readonly GradientStop[] => gradients.find((g) => String(g.index) === gradient.value)?.gradient ?? BUILT_IN;
  const drawRamp = (): void => {
    const s = [...stopsOf()].sort((a, b) => a.at - b.at);
    ramp.style.background = `linear-gradient(to right, ${s.map((x) => `${x.color} ${x.at * 100}%`).join(", ")})`;
  };
  gradient.addEventListener("change", drawRamp);
  drawRamp();
  const multiplier = numberInput("Multiplier", prefs.multiplier);

  // Color Ranges: rows of lower bound, upper bound and colour
  const rangeRows: { lower: HTMLInputElement; upper: HTMLInputElement; colour: () => number; el: HTMLElement }[] = [];
  const rangeList = h("div", { cls: "mbr-list", attrs: { role: "list", "aria-label": "Ranges" } });
  const addRange = (lo: number, hi: number, colour: number): void => {
    const lowerIn = numberInput("Range lower bound", lo);
    const upperIn = numberInput("Range upper bound", hi);
    const sw = swatchSlot(doc, "Range colour", colour);
    const del = h("button", { cls: "btn small", text: "Delete", attrs: { type: "button" } });
    const row = { lower: lowerIn, upper: upperIn, colour: sw.get, el: h("div", { cls: "mbr-row", attrs: { role: "listitem" } }, lowerIn, h("span", { cls: "muted", text: "to" }), upperIn, sw.el, del) };
    del.addEventListener("click", () => {
      rangeRows.splice(rangeRows.indexOf(row), 1);
      row.el.remove();
    });
    rangeRows.push(row);
    rangeList.append(row.el);
  };
  const add = h("button", { cls: "btn small", text: "Add Range", attrs: { type: "button" } });

  // Color Value: a row for each value found
  let valueRows: { value: number; apply: HTMLInputElement; colour: () => number; el: HTMLElement }[] = [];
  const valueList = h("div", { cls: "mbr-list", attrs: { role: "list", "aria-label": "Values" } });

  let targets: Target[] = [];
  const values = (): number[] => [...new Set(targets.map((t) => t.value))].sort((a, b) => a - b);

  // the record and field last used, when they are still there
  let keepRecord = prefs.record;
  let keepField = prefs.field;
  const fillRecords = (): void => {
    const keep = record.value ? record.options[record.selectedIndex]?.text : keepRecord;
    const formats = formatsOf(doc, reach(doc, scopeSel.checked, groups.checked));
    record.replaceChildren(...formats.map((f) => h("option", { attrs: { translate: "no" }, value: String(f.format), text: f.name })));
    const same = formats.find((f) => f.name === keep);
    if (same) record.value = String(same.format);
    fillFields();
  };
  const fillFields = (): void => {
    const keep = recordField.value || keepField;
    keepRecord = keepField = "";
    const fields = record.value === "" ? [] : (doc.recordFormatFields(Number(record.value)) ?? []);
    recordField.replaceChildren(...fields.map((f) => h("option", { attrs: { translate: "no" }, value: f.name, text: f.name })));
    // else the field most objects hold a number in
    const objects = reach(doc, scopeSel.checked, groups.checked);
    const counts = fields.map((f) => objects.filter((o) => numberOf(doc, o.id, Number(record.value), f.name) !== null).length);
    const most = counts.indexOf(Math.max(0, ...counts));
    recordField.value = fields.some((f) => f.name === keep) ? keep : (fields[most]?.name ?? "");
    gather();
  };
  const gather = (): void => {
    const format = Number(record.value);
    targets = [];
    if (record.value !== "" && recordField.value !== "") {
      for (const o of reach(doc, scopeSel.checked, groups.checked)) {
        const value = numberOf(doc, o.id, format, recordField.value);
        if (value !== null) targets.push({ o, value });
      }
    }
    const vs = values();
    found.textContent = targets.length
      ? `${targets.length} ${targets.length === 1 ? "object has" : "objects have"} a number in this field (${vs.length} ${vs.length === 1 ? "value" : "values"}, ${fmt(vs[0])} to ${fmt(vs[vs.length - 1])}).`
      : "No object reached has a number in this field.";
    lower.value = vs.length ? fmt(vs[0]) : "0";
    upper.value = vs.length ? fmt(vs[vs.length - 1]) : "1";
    // the values along the gradient, to start with
    valueRows = vs.map((value, i) => {
      const apply = h("input", { checked: true, attrs: { type: "checkbox", "aria-label": `Apply a colour to ${fmt(value)}` } });
      const sw = swatchSlot(doc, `Colour for ${fmt(value)}`, nearestColour(doc, colourAt(stopsOf(), vs.length > 1 ? i / (vs.length - 1) : 0)));
      return { value, apply, colour: sw.get, el: h("div", { cls: "mbr-row", attrs: { role: "listitem" } }, apply, h("span", { cls: "mbr-value", text: fmt(value) }), sw.el) };
    });
    valueList.replaceChildren(...valueRows.map((r) => r.el));
    // three ranges across what was found, to start with
    rangeRows.splice(0).forEach((r) => r.el.remove());
    if (vs.length) {
      const lo = vs[0];
      const hi = vs[vs.length - 1];
      const step = (hi - lo) / 3;
      const round = (x: number): number => Math.round(x * 100) / 100;
      for (let i = 0; i < 3; i++) addRange(i === 0 ? lo : round(lo + i * step), i === 2 ? hi : round(lo + (i + 1) * step), nearestColour(doc, colourAt(stopsOf(), i / 2)));
    }
  };
  add.addEventListener("click", () => {
    const last = rangeRows[rangeRows.length - 1];
    const from = last ? Number(last.upper.value) || 0 : 0;
    addRange(from, from, nearestColour(doc, colourAt(stopsOf(), 1)));
  });

  const opOf = (): Op => opRadios.find((r) => r.input.checked)?.op ?? "gradient";
  const showOptions = (): void => {
    const op = opOf();
    const slotField = field("Apply to", slot);
    if (op === "gradient") options.replaceChildren(slotField, field("Lower bound", lower), field("Upper bound", upper), field("Gradient", gradient), h("div", { cls: "mbr-ramp-row" }, ramp));
    else if (op === "ranges") options.replaceChildren(slotField, rangeList, h("div", { cls: "mbr-actions" }, add));
    else if (op === "values") options.replaceChildren(slotField, valueList);
    else
      options.replaceChildren(
        field("Multiplier", multiplier),
        h("p", {
          cls: "muted",
          text:
            op === "resize"
              ? "Each object is scaled about its middle by its value times this."
              : op === "extrude"
                ? "Each object is extruded its value times this high, in the drawing's units."
                : "Each polygon and polyline becomes a 3D polygon at its value times this, in the drawing's units.",
        }),
      );
  };
  for (const r of opRadios) r.input.addEventListener("change", showOptions);
  record.addEventListener("change", fillFields);
  recordField.addEventListener("change", gather);
  for (const el of [scopeAll, scopeSel, groups]) el.addEventListener("change", fillRecords);
  fillRecords();
  showOptions();
  if (record.options.length === 0) {
    toast("No object has a data record attached.", "info");
    return;
  }

  const v = await showDialog<Choice>({
    title: "Modify by Record Value",
    okLabel: "OK",
    cls: "mbr-dialog",
    body: [
      field("Record", record),
      field("Record Field", recordField),
      found,
      h("fieldset", { cls: "mbr-group" }, h("legend", { text: "Operation" }), h("div", { cls: "mbr-ops" }, ...opRadios.map((r) => r.row))),
      h("fieldset", { cls: "mbr-group" }, h("legend", { text: "Options" }), options),
      h(
        "fieldset",
        { cls: "mbr-group" },
        h("legend", { text: "Apply to" }),
        h("label", { cls: "menu-dialog-check" }, scopeAll, "Entire drawing"),
        h("label", { cls: "menu-dialog-check" }, scopeSel, "Selected objects only"),
        h("label", { cls: "menu-dialog-check" }, groups, "Include components of groups"),
      ),
    ],
    check: () => {
      if (!targets.length) return { error: "No object reached has a number in this field.", focus: recordField };
      const op = opOf();
      const s = slot.value as Slot;
      const p: Prefs = {
        op,
        slot: s,
        multiplier: Number(multiplier.value),
        selected: scopeSel.checked,
        groups: groups.checked,
        record: record.options[record.selectedIndex]?.text ?? "",
        field: recordField.value,
      };
      if (op === "gradient") {
        const lo = Number(lower.value);
        const hi = Number(upper.value);
        if (lower.value.trim() === "" || !Number.isFinite(lo)) return { error: "Lower bound: a number.", focus: lower };
        if (upper.value.trim() === "" || !Number.isFinite(hi) || hi <= lo) return { error: "Upper bound: a number above the lower bound.", focus: upper };
        return { value: { targets, plan: { op, slot: s, lower: lo, upper: hi, stops: stopsOf() }, prefs: p } };
      }
      if (op === "ranges") {
        const ranges: { lower: number; upper: number; colour: number }[] = [];
        for (const r of rangeRows) {
          const lo = Number(r.lower.value);
          const hi = Number(r.upper.value);
          if (r.lower.value.trim() === "" || !Number.isFinite(lo)) return { error: "Each range needs a lower bound.", focus: r.lower };
          if (r.upper.value.trim() === "" || !Number.isFinite(hi) || hi < lo) return { error: "Each range's upper bound is at or above its lower bound.", focus: r.upper };
          ranges.push({ lower: lo, upper: hi, colour: r.colour() });
        }
        if (!ranges.length) return { error: "Add a range.", focus: add };
        return { value: { targets, plan: { op, slot: s, ranges }, prefs: p } };
      }
      if (op === "values") {
        const colours = new Map(valueRows.filter((r) => r.apply.checked).map((r) => [r.value, r.colour()]));
        if (!colours.size) return { error: "Apply a colour to at least one value." };
        return { value: { targets, plan: { op, slot: s, colours }, prefs: p } };
      }
      const m = Number(multiplier.value);
      if (multiplier.value.trim() === "" || !Number.isFinite(m) || m === 0) return { error: "Multiplier: a number other than 0.", focus: multiplier };
      return { value: { targets, plan: { op, multiplier: m }, prefs: p } };
    },
  });
  if (!v) return;
  savePrefs(v.prefs);
  apply(doc, v.targets, v.plan, units);
}

/** Makes the change, in one undo step, and says what it did. */
function apply(doc: VwxDocument, targets: readonly Target[], plan: Plan, units: string | undefined): void {
  let changed = 0;
  let made: string[] = [];
  // the change replaces extruded and elevated objects, which leave the selection with it
  const wasSelected = targets.some((t) => store.selection.has(t.o.id));
  const r = attempt("Modify by Record", (s) =>
    s.batch(() => {
      if (plan.op === "gradient" || plan.op === "ranges" || plan.op === "values") {
        const byColour = new Map<number, string[]>();
        for (const t of targets) {
          let colour: number | null = null;
          if (plan.op === "gradient") colour = nearestColour(doc, colourAt(plan.stops, Math.min(1, Math.max(0, (t.value - plan.lower) / (plan.upper - plan.lower)))));
          else if (plan.op === "ranges") colour = plan.ranges.find((x) => t.value >= x.lower && t.value <= x.upper)?.colour ?? null;
          else colour = plan.colours.get(t.value) ?? null;
          if (colour === null || !t.o.attrs) continue;
          byColour.set(colour, [...(byColour.get(colour) ?? []), t.o.id]);
        }
        for (const [colour, ids] of byColour) {
          s.setAttributes(ids, { [plan.slot]: colour });
          changed += ids.length;
        }
      } else if (plan.op === "resize") {
        const boxes = boxesOf(targets.map((t) => t.o));
        for (const t of targets) {
          const k = t.value * plan.multiplier;
          const b = boxes.get(t.o.id) ?? t.o.bounds;
          if (!(k > 0) || !b || k === 1) continue;
          const cx = (b.x0 + b.x1) / 2;
          const cy = (b.y0 + b.y1) / 2;
          s.transformObjects([t.o.id], { a: k, b: 0, c: 0, d: k, e: cx * (1 - k), f: cy * (1 - k) });
          changed++;
        }
      } else if (plan.op === "extrude") {
        const byHeight = new Map<number, string[]>();
        for (const t of targets) {
          const mm = parseLength(fmt(t.value * plan.multiplier), units);
          if (mm === null || !(mm > 0) || !t.o.shape) continue;
          byHeight.set(mm, [...(byHeight.get(mm) ?? []), t.o.id]);
        }
        for (const [mm, ids] of byHeight) {
          made = made.concat(s.extrudeObjects(ids, mm));
          changed += ids.length;
        }
      } else {
        const items: { id: string; elevation: number }[] = [];
        for (const t of targets) {
          if (t.o.kind !== "polygon" && t.o.kind !== "polyline") continue;
          const mm = parseLength(fmt(t.value * plan.multiplier), units);
          if (mm !== null) items.push({ id: t.o.id, elevation: mm });
        }
        if (items.length) made = s.polysTo3DSourceData(items, 0, false);
        changed = items.length;
      }
    }),
  );
  if (!r) return;
  if (made.length && wasSelected) setSelection(made);
  const skipped = targets.length - changed;
  toast(
    changed === 0
      ? "Nothing to change: no object's value called for a change."
      : `${changed} ${changed === 1 ? "object" : "objects"} modified${skipped ? `; ${skipped} left as ${skipped === 1 ? "it was" : "they were"}` : ""}.`,
    "info",
  );
}

/** Where `objects` lie in plan: the scene's bounds of each, by the layer or group it is in. */
function boxesOf(objects: readonly ObjectInfo[]): Map<string, { x0: number; y0: number; x1: number; y1: number }> {
  const out = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  const scene = appContext()?.scene;
  if (!scene) return out;
  const scopes = new Set(objects.map((o) => `${o.layerId}\n${o.parentId ?? ""}`));
  for (const key of scopes) {
    const [layerId, parent] = key.split("\n");
    for (const e of scene.topLevelEntries(layerId, parent === "" ? null : parent)) if (e.bbox) out.set(e.id, e.bbox);
  }
  return out;
}
