// Spotlight Numbering (Stage > Lighting): numbers the objects of one type, a
// plug-in object (a lighting device, a ConnectCAD device…) or objects carrying a record, in one or more
// of their fields at once. Each field in use has its own Start (a number, its leading zeros kept, or
// letters), Prefix and Suffix, the same value for all or Increment by, Increment by DMX footprint for
// lighting devices (the next universe when one is full), a Limit (Restart at, Stop at) and Number of
// Units per Increment. With objects of the type selected they're numbered in a Numbering Direction (a
// primary direction, a secondary one across it, zigzag, a tolerance lining them up) as one undo step and
// stay selected; Stop at numbers those up to the limit and opens the dialog again for the rest. With none
// selected, or Manual, they're clicked one by one (numberTool.ts). The sums are in numberingShapes.ts.

import type { EditSession, FieldKind, Pt, RecordValue } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext, pluginDriver } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { planRotationDegrees } from "../../../app/planRotation.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import { FIELD, INSTRUMENT } from "../fixture.ts";
import { fixtures } from "../instrument.ts";
import { DIRECTIONS, LIMITS, numberingOrder, numberingProblem, secondaries, sequence, startOf, valueLetters, type Direction, type FieldNumbering, type Limit } from "./numberingShapes.ts";

/** A type of object the drawing has to number: a plug-in's or a record's, and the fields that take a number. */
export interface NumberType {
  readonly key: string;
  /** the plug-in's or record's name */
  readonly name: string;
  readonly label: string;
  readonly plugin: boolean;
  /** lighting devices, which number DMX addresses by their footprints */
  readonly lighting: boolean;
  readonly fields: readonly NumberField[];
}

export interface NumberField {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
}

/** What OK numbers: the type, each field in use with its numbering, and how the objects are taken. */
export interface NumberingRun {
  readonly type: NumberType;
  readonly fields: readonly { readonly field: NumberField; readonly o: FieldNumbering }[];
  /** the selected objects in the order they're numbered, or null to click them one by one */
  readonly order: readonly string[] | null;
}

type Editable = { -readonly [K in keyof FieldNumbering]: FieldNumbering[K] };

/** the kinds of field a value can go in */
const NUMBERED_KINDS: ReadonlySet<FieldKind> = new Set(["text", "integer", "number"]);
const LIGHTING = new Set([INSTRUMENT.toLowerCase(), "lighting device", "light instrument", "lighting instrument"]);
const MANUAL = "Manual";

const freshField = (): Editable => ({ start: "1", prefix: "", suffix: "", same: false, step: 1, limit: "No Limit", limitAt: 0, perValue: 1, footprint: false });

/** what the dialog had last for each type (its fields in use and their numbering) and its direction, for as long as Rodeo is open */
const remembered = new Map<string, { inUse: string[]; fields: Map<string, Editable> }>();
const direction = { primary: "Left to Right" as Direction | typeof MANUAL, secondary: "Top to Bottom" as Direction, zigzag: false, tolerance: null as number | null };
let lastType = "";

/** The types of object on the drawing's design layers (those it holds directly), each with its objects. */
export function numberTypes(): { type: NumberType; ids: string[] }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const found = new Map<string, { name: string; plugin: boolean; ids: string[]; fields: NumberField[] }>();
  for (const layer of doc.layers()) {
    if (layer.kind !== "design") continue;
    for (const o of doc.objects(layer.id)) {
      for (const r of doc.records(o.id)) {
        const key = `${r.parametric ? "plug-in" : "record"}:${r.name}`;
        let t = found.get(key);
        if (!t) {
          const driver = r.parametric ? pluginDriver(r.name) : undefined;
          const fields = r.fields.filter((f) => NUMBERED_KINDS.has(f.kind) && !driver?.readOnly(f.name)).map((f) => ({ name: f.name, label: driver?.label(f.name) ?? f.name, kind: f.kind }));
          t = { name: r.name, plugin: r.parametric, ids: [], fields };
          found.set(key, t);
        }
        t.ids.push(o.id);
      }
    }
  }
  const both = [...found.values()].some((t) => t.plugin && t.name === INSTRUMENT) && [...found.values()].some((t) => t.plugin && t.name.toLowerCase() === "lighting device");
  const labelOf = (t: { name: string; plugin: boolean }): string => {
    if (!t.plugin) return `${t.name} (record)`;
    if (t.name === INSTRUMENT) return both ? "Lighting Device (Rodeo)" : "Lighting Device";
    return t.name.replace(/^Rodeo /, "");
  };
  return [...found.entries()]
    .filter(([, t]) => t.fields.length > 0)
    .map(([key, t]) => ({ type: { key, name: t.name, label: labelOf(t), plugin: t.plugin, lighting: t.plugin && LIGHTING.has(t.name.toLowerCase()), fields: t.fields }, ids: t.ids }))
    .sort((a, b) => Number(b.type.plugin) - Number(a.type.plugin) || a.type.label.localeCompare(b.type.label));
}

/** Where an object is numbered from: its insertion point, or its middle; as the plan shows it when it's rotated. */
function placeOf(id: string): Pt | null {
  const o = store.session?.doc.object(id);
  if (!o) return null;
  const box = appContext()?.scene.topLevelEntries(o.layerId, null).find((e) => e.id === id)?.bbox;
  const p = o.insertion ?? (box ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : null);
  if (!p) return null;
  const t = (planRotationDegrees() * Math.PI) / 180;
  return t ? { x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) } : p;
}

/** Each object's DMX footprint, 1 for those that aren't lighting devices. */
export function footprintOf(id: string): number {
  return fixtures().find((f) => f.id === id)?.footprint || 1;
}

/** The universe numbering by footprint starts in: the first device's, or 1. */
export const universeOf = (id: string | undefined): number => (id ? fixtures().find((f) => f.id === id)?.universe : 0) || 1;

/** One object's values for its fields, the `k`th in turn (`seqs` each field's sequence), as their fields hold them. */
export function valuesAt(run: Pick<NumberingRun, "type" | "fields">, seqs: readonly ReturnType<typeof sequence>[], k: number): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  run.fields.forEach(({ field, o }, i) => {
    const v = seqs[i].values[k];
    if (v === undefined) return;
    out[field.name] = field.kind === "text" ? v : Number(v);
    // a Rodeo instrument numbered by footprint goes in the universe it reached
    if (o.footprint && run.type.name === INSTRUMENT && field.name === FIELD.address) out[FIELD.universe] = seqs[i].universes[k];
  });
  return out;
}

/** Writes values to an object of the type, in the session's open batch: a plug-in Rodeo draws itself draws again. */
export function writeNumbers(s: EditSession, type: NumberType, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const driver = type.plugin ? pluginDriver(type.name) : undefined;
  if (driver?.builtIn) {
    driver.edit(id, values);
    return;
  }
  const rec = s.doc.records(id).find((r) => r.name === type.name && r.parametric === type.plugin);
  if (!rec) return;
  for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
}

const plural = (n: number, label: string): string => `${n} ${label}${n === 1 ? "" : /s$/.test(label) ? "" : "s"}`;

/** Why a field's numbering can't go in it, or null. */
function fieldProblem(field: NumberField, o: FieldNumbering): string | null {
  const problem = numberingProblem(o);
  if (problem) return `${field.label}: ${problem}`;
  if (field.kind !== "text" && (o.prefix || o.suffix || startOf(o.start)?.kind === "letters")) return `${field.label} holds a number: no letters, prefix or suffix.`;
  return null;
}

/** The Spotlight Numbering dialog: what to number and how, or null when cancelled. */
async function ask(): Promise<NumberingRun | null> {
  const s = store.session;
  if (!s) return null;
  const types = numberTypes();
  if (!types.length) {
    toast("Spotlight Numbering: the drawing has no plug-in objects or records with fields to number.", "info");
    return null;
  }
  const selectedOf = (key: string): string[] => types.find((t) => t.type.key === key)?.ids.filter((id) => store.selection.has(id)) ?? [];
  // the type most of the selection is, else the last one, else lighting devices, else the first
  const bySelection = [...types].sort((a, b) => selectedOf(b.type.key).length - selectedOf(a.type.key).length)[0];
  const first = (selectedOf(bySelection.type.key).length ? bySelection : types.find((t) => t.type.key === lastType) ?? types.find((t) => t.type.lighting) ?? types[0]).type;
  const units = s.doc.info.units;

  const settingsOf = (t: NumberType): { inUse: string[]; fields: Map<string, Editable> } => {
    let k = remembered.get(t.key);
    if (!k) {
      const unit = t.fields.find((f) => f.name === FIELD.unit && t.name === INSTRUMENT) ?? t.fields[0];
      k = { inUse: [unit.name], fields: new Map() };
      remembered.set(t.key, k);
    }
    return k;
  };
  const numberingOf = (t: NumberType, field: string): Editable => {
    const k = settingsOf(t);
    let o = k.fields.get(field);
    if (!o) k.fields.set(field, (o = freshField()));
    return o;
  };

  // the controls
  const select = (label: string, options: readonly { value: string; label: string }[], value: string | null, cls = ""): HTMLSelectElement => {
    const el = h("select", { cls: `menu-dialog-input ${cls}`.trim(), attrs: { "aria-label": label } });
    fill(el, options, value);
    return el;
  };
  const fill = (el: HTMLSelectElement, options: readonly { value: string; label: string }[], value: string | null): void => {
    el.replaceChildren(
      ...options.map((o) => {
        const opt = h("option", { text: o.label, attrs: { value: o.value } });
        opt.selected = o.value === value;
        return opt;
      }),
    );
  };
  const input = (label: string, value = ""): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label } });
  const field = (label: string, el: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const check = (label: string, el: HTMLInputElement): HTMLElement => h("label", { cls: "menu-dialog-check" }, el, label);

  const typeSel = select("Object Type", types.map((t) => ({ value: t.type.key, label: t.type.label })), first.key, "spot-num-type");
  const available = h("select", { cls: "menu-dialog-input spot-num-list", attrs: { size: "8", "aria-label": "Available Fields" } });
  const inUse = h("select", { cls: "menu-dialog-input spot-num-list", attrs: { size: "8", "aria-label": "Fields In Use" } });
  const add = h("button", { cls: "btn", text: "Add ›", attrs: { type: "button" } });
  const remove = h("button", { cls: "btn", text: "‹ Remove", attrs: { type: "button" } });

  const start = input("Start");
  const prefix = input("Prefix");
  const suffix = input("Suffix");
  const same = h("input", { attrs: { type: "radio", name: "spot-num-step", "aria-label": "Apply same number to all" } });
  const counted = h("input", { attrs: { type: "radio", name: "spot-num-step", "aria-label": "Increment by" } });
  const step = input("Increment by");
  const footprint = h("input", { attrs: { type: "checkbox", "aria-label": "Increment by DMX footprint" } });
  const footprintRow = check("Increment by DMX footprint (the next universe when one is full)", footprint);
  const limit = select("Limit", LIMITS.map((l) => ({ value: l, label: l })), "No Limit");
  const limitAt = input("Limit value");
  const perValue = input("Number of Units per Increment");
  const example = h("p", { cls: "muted spot-num-example" });
  const options = h(
    "fieldset",
    { cls: "spot-num-options" },
    h("legend", { cls: "spot-num-legend" }),
    field("Start", start),
    h("div", { cls: "spot-num-pair" }, field("Prefix", prefix), field("Suffix", suffix)),
    check("Apply same number to all", same),
    h("label", { cls: "menu-dialog-check" }, counted, "Increment by", step),
    footprintRow,
    h("div", { cls: "spot-num-pair" }, field("Limit", limit), limitAt),
    field("Number of Units per Increment", perValue),
    example,
  );

  const primary = select("Primary", [...DIRECTIONS, MANUAL].map((d) => ({ value: d, label: d })), direction.primary);
  const secondary = select("Secondary", [], null);
  const zigzag = h("input", { checked: direction.zigzag, attrs: { type: "checkbox", "aria-label": "Zigzag" } });
  // a foot in a drawing in feet and inches, else 300 mm
  const tolerance = input("Tolerance", formatLengthValue(direction.tolerance ?? (lengthSuffix(units) ? 300 : 304.8), units));
  const directionBox = h(
    "fieldset",
    { cls: "spot-num-options" },
    h("legend", { cls: "spot-num-legend", text: "Numbering Direction" }),
    h("div", { cls: "spot-num-pair" }, field("Primary", primary), field("Secondary", secondary)),
    h("div", { cls: "spot-num-pair" }, check("Zigzag", zigzag), field("Tolerance", tolerance, lengthSuffix(units))),
  );
  const note = h("p", { cls: "muted spot-num-note" });

  let type = first;
  let picked: string | null = null;
  const typeOf = (key: string): NumberType => types.find((t) => t.type.key === key)!.type;
  const labelOf = (name: string): string => type.fields.find((f) => f.name === name)?.label ?? name;

  const showDirections = (): void => {
    const p = primary.value as Direction | typeof MANUAL;
    const manual = p === MANUAL;
    const across = manual ? [] : secondaries(p);
    fill(secondary, across.map((d) => ({ value: d, label: d })), across.includes(direction.secondary) ? direction.secondary : across[0] ?? null);
    secondary.disabled = zigzag.disabled = tolerance.disabled = manual;
  };
  const showNote = (): void => {
    const n = selectedOf(type.key).length;
    directionBox.hidden = n === 0;
    const manual = n === 0 || primary.value === MANUAL;
    note.textContent = manual
      ? `After OK, click the ${type.label} objects one at a time to number them; Shift-click gives the last value again. A double-click on empty space, Enter or Esc ends.`
      : `${plural(n, `selected ${type.label}`)} will be numbered${n > 1 ? " in the direction below" : ""}.`;
  };
  // the options for the field picked in use, kept as they change
  const showOptions = (): void => {
    const o = picked ? numberingOf(type, picked) : null;
    options.hidden = !o;
    if (!o || !picked) return;
    options.querySelector("legend")!.textContent = `${labelOf(picked)} numbering`;
    start.value = o.start;
    prefix.value = o.prefix;
    suffix.value = o.suffix;
    same.checked = o.same;
    counted.checked = !o.same;
    step.value = String(o.step);
    footprint.checked = !!o.footprint;
    footprintRow.hidden = !type.lighting;
    limit.value = o.limit;
    const s0 = startOf(o.start);
    limitAt.value = o.limit === "No Limit" ? "" : s0?.kind === "letters" ? valueLetters(o.limitAt, s0.lower) : String(o.limitAt);
    perValue.value = String(o.perValue);
    showExample();
  };
  const takeOptions = (): void => {
    const o = picked ? numberingOf(type, picked) : null;
    if (!o) return;
    o.start = start.value.trim();
    o.prefix = prefix.value;
    o.suffix = suffix.value;
    o.same = same.checked;
    o.step = Number(step.value.trim());
    o.footprint = type.lighting && footprint.checked;
    o.limit = limit.value as Limit;
    const at = limitAt.value.trim();
    o.limitAt = o.limit === "No Limit" ? 0 : (startOf(at)?.value ?? NaN);
    o.perValue = Number(perValue.value.trim());
    step.disabled = o.same;
    limitAt.disabled = o.limit === "No Limit";
    showExample();
  };
  const showExample = (): void => {
    const o = picked ? numberingOf(type, picked) : null;
    if (!o || !picked) return;
    const problem = numberingProblem(o);
    const seq = problem ? null : sequence(o, 4, [], 1);
    example.textContent = problem ?? `Example: ${seq!.values.join(", ")}${seq!.stopped === null && !o.same ? "…" : ""}`;
    step.disabled = o.same;
    limitAt.disabled = o.limit === "No Limit";
  };
  const showLists = (): void => {
    const k = settingsOf(type);
    k.inUse = k.inUse.filter((f) => type.fields.some((x) => x.name === f));
    if (picked && !k.inUse.includes(picked)) picked = null;
    picked ??= k.inUse[0] ?? null;
    fill(available, type.fields.filter((f) => !k.inUse.includes(f.name)).map((f) => ({ value: f.name, label: f.label })), null);
    fill(inUse, k.inUse.map((f) => ({ value: f, label: labelOf(f) })), picked);
    showOptions();
  };
  const addField = (): void => {
    const name = available.value;
    if (!name) return;
    settingsOf(type).inUse.push(name);
    picked = name;
    showLists();
  };
  const removeField = (): void => {
    const name = inUse.value;
    if (!name) return;
    const k = settingsOf(type);
    k.inUse = k.inUse.filter((f) => f !== name);
    picked = null;
    showLists();
  };

  typeSel.addEventListener("change", () => {
    type = typeOf(typeSel.value);
    picked = null;
    showLists();
    showNote();
  });
  add.addEventListener("click", addField);
  remove.addEventListener("click", removeField);
  available.addEventListener("dblclick", addField);
  inUse.addEventListener("dblclick", removeField);
  inUse.addEventListener("change", () => {
    picked = inUse.value || null;
    showOptions();
  });
  for (const el of [start, prefix, suffix, step, limitAt, perValue]) el.addEventListener("input", takeOptions);
  for (const el of [same, counted, footprint, limit]) el.addEventListener("change", takeOptions);
  primary.addEventListener("change", () => {
    showDirections();
    showNote();
  });
  showDirections();
  showLists();
  showNote();

  const lists = h(
    "div",
    { cls: "spot-num-lists" },
    h("div", { cls: "spot-num-col" }, h("span", { cls: "menu-dialog-label", text: "Available Fields" }), available),
    h("div", { cls: "spot-num-buttons" }, add, remove),
    h("div", { cls: "spot-num-col" }, h("span", { cls: "menu-dialog-label", text: "Fields In Use" }), inUse),
  );
  const run = await showDialog<NumberingRun>({
    title: "Spotlight Numbering",
    okLabel: "OK",
    cls: "spot-num-dialog",
    body: [field("Object Type", typeSel), lists, options, directionBox, note],
    check: () => {
      takeOptions();
      const k = settingsOf(type);
      if (!k.inUse.length) return { error: "Add a field to number to Fields In Use." };
      const fields = k.inUse.map((name) => ({ field: type.fields.find((f) => f.name === name)!, o: { ...numberingOf(type, name) } }));
      for (const f of fields) {
        const problem = fieldProblem(f.field, f.o);
        if (problem) return { error: problem };
      }
      const ids = selectedOf(type.key);
      const manual = ids.length === 0 || primary.value === MANUAL;
      const tol = parseLength(tolerance.value, units);
      if (!manual && (tol === null || tol < 0)) return { error: "Tolerance is a length, 0 or more." };
      if (manual) return { value: { type, fields, order: null } };
      const at = ids.map(placeOf);
      const placed = ids.filter((_, i) => at[i]);
      const order = numberingOrder(at.filter((p): p is Pt => !!p), primary.value as Direction, secondary.value as Direction, zigzag.checked, tol ?? 0).map((i) => placed[i]);
      return { value: { type, fields, order } };
    },
  });
  lastType = type.key;
  direction.primary = primary.value as Direction | typeof MANUAL;
  if (secondary.value) direction.secondary = secondary.value as Direction;
  direction.zigzag = zigzag.checked;
  direction.tolerance = parseLength(tolerance.value, units) ?? direction.tolerance;
  return store.session === s ? run : null;
}

/** Numbers the objects of `run`, in its order, as one undo step; the numbered stay selected, and a Stop at limit asks again for the rest. */
function numberInOrder(run: NumberingRun, order: readonly string[]): void {
  const prints = run.fields.some((f) => f.o.footprint) ? order.map(footprintOf) : [];
  const seqs = run.fields.map((f) => sequence(f.o, order.length, prints, universeOf(order[0])));
  const count = Math.min(order.length, ...seqs.map((q) => q.stopped ?? order.length));
  const done = order.slice(0, count);
  const r = attempt("Spotlight Numbering", (s) => s.batch(() => done.forEach((id, k) => writeNumbers(s, run.type, id, valuesAt(run, seqs, k)))));
  if (!r) return;
  const rest = order.slice(count);
  if (!rest.length) {
    setSelection(done);
    toast(`Numbered ${plural(done.length, run.type.label)}.`, "info");
    return;
  }
  // Stop at: the rest are numbered afresh
  setSelection(rest);
  toast(`Numbered ${plural(done.length, run.type.label)} up to the Stop at limit: set the numbering for the other ${rest.length}.`, "info");
  void spotlightNumbering();
}

/** Clicking objects one by one: set by numberTool.ts, which reads this file. */
export const clickNumbering = { start: (_run: NumberingRun): void => {} };

/** Stage > Lighting > Spotlight Numbering… */
export async function spotlightNumbering(): Promise<void> {
  const run = await ask();
  if (!run) return;
  if (run.order) numberInOrder(run, run.order);
  else clickNumbering.start(run);
}
