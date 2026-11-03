// A Rodeo Instrument: a plug-in object holding a lighting instrument's data (fixture.ts), drawn from it as
// a generic outline, or a symbol of the drawing's (its Symbol Name), with Rodeo's own labels
// (lightingDeviceShapes.ts) or a label legend of the drawing's (its Use Legend, devices/legendData.ts). Object Info edits it and draws it again. fixtures() is the list every paperwork, beam and load feature reads, and editFixtures the one
// way they write back.

import { attempt } from "../../app/commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../app/ext.ts";
import { accessoryNames, lightingDevice, symbolBody } from "../../app/lightingDeviceShapes.ts";
import { colorMatcher } from "../../app/pdfImport.ts";
import { store } from "../../app/state.ts";
import { markerParts } from "../../app/tools/markers.ts";
import { errorMessage } from "../../app/toast.ts";
import type { EditSession, Pt, RecordValue } from "../../core/index.ts";
import { DEFAULT_TYPE, editValues, FIELD, FIXTURE_TYPES, fixtureType, foreignValues, INSTRUMENT, instrumentFields, patchText, readFixtures, type Fixture, type FixtureEdit } from "./fixture.ts";
import type { LegendField } from "./devices/legendBook.ts";
import { legendNamed, readLegends } from "./devices/legendData.ts";
import { colorOf } from "./gels.ts";

/** The drawing's instruments, read once per change of it. */
let memo: { session: EditSession; list: readonly Fixture[] } | null = null;
const watched = new WeakSet<EditSession>();

/** Every lighting instrument in the open drawing, Rodeo's and Vectorworks'. */
export function fixtures(): readonly Fixture[] {
  const s = store.session;
  if (!s) return [];
  if (memo?.session === s) return memo.list;
  if (!watched.has(s)) {
    watched.add(s);
    s.onChange(() => {
      if (memo?.session === s) memo = null;
    });
  }
  const list = readFixtures(s.doc);
  memo = { session: s, list };
  return list;
}

/** The one instrument `id`, or undefined. */
export function fixture(id: string): Fixture | undefined {
  return fixtures().find((f) => f.id === id);
}

/** What a label of `field` reads on an instrument whose fields `text` and `num` read; "" for nothing. */
function labelText(field: LegendField, text: (name: string) => string, num: (name: string) => number): string {
  const n = (name: string): string => (num(name) > 0 ? String(num(name)) : "");
  switch (field) {
    case "type":
      return fixtureType(text(FIELD.type))?.label ?? text(FIELD.type);
    case "patch":
      return patchText({ universe: num(FIELD.universe), address: num(FIELD.address) });
    case "universe":
      return n(FIELD.universe);
    case "address":
      return n(FIELD.address);
    case "watts":
      return num(FIELD.watts) > 0 ? `${num(FIELD.watts)}W` : "";
    default:
      return text(FIELD[field]);
  }
}

/** What the drawing shows of an instrument, from its record. */
function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === INSTRUMENT);
  if (!obj || !rec) throw new Error("That isn't a lighting instrument.");
  const value = (name: string): RecordValue | undefined => rec.fields.find((f) => f.name === name)?.value;
  const text = (name: string): string => String(value(name) ?? "");
  const scale = s.doc.layers().find((l) => l.id === obj.layerId)?.scale || 1;
  const textMm = Number(value(FIELD.labelSize)) || 2.5;
  const factor = Number(value(FIELD.factor)) || 1;
  const glyph = fixtureType(text(FIELD.type))?.glyph ?? "ellipsoidal";
  const at = obj.insertion ?? { x: 0, y: 0 };
  const focused = value(FIELD.focused) === true;
  const aim = focused && (Number(value(FIELD.focusX)) !== at.x || Number(value(FIELD.focusY)) !== at.y) ? Math.atan2(Number(value(FIELD.focusY)) - at.y, Number(value(FIELD.focusX)) - at.x) : (Number(value(FIELD.aim)) * Math.PI) / 180;
  const shown = {
    channel: value(FIELD.showChannel) === false ? "" : text(FIELD.channel),
    unit: value(FIELD.showUnit) === false ? "" : text(FIELD.unit),
    color: value(FIELD.showColor) === false ? "" : text(FIELD.color),
    purpose: value(FIELD.showPurpose) === false ? "" : text(FIELD.purpose),
    accessories: accessoryNames(text(FIELD.accessory)),
  };
  const name = text(FIELD.symbol);
  const def = name ? s.doc.symbolDefs().find((x) => x.name === name) : undefined;
  const legend = legendNamed(text(FIELD.legend));
  const items = legend?.labels.map((l) => ({ text: labelText(l.field, text, (f) => Number(value(f)) || 0), spot: l.spot, box: l.box, rightReading: l.rightReading, height: (textMm * scale * l.size) / 100 }));
  const d = lightingDevice(glyph, factor, shown, textMm * scale, aim, def?.bbox ? symbolBody(def.bbox, factor) : undefined, legend && items ? { items, nonRotating: legend.nonRotating } : undefined);
  const match = colorMatcher();
  const paper = match({ r: 1, g: 1, b: 1 });
  const solid = (c: number) => ({ fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 });
  const ids: string[] = [];
  if (def) ids.push(symbolIn(s, obj.layerId, def.index, obj.classIndex, aim, factor, Number(value(FIELD.height)) || 0));
  // the body solid white so a pipe doesn't run through it, the channel's bubble tinted by its colour
  const parts = markerParts(d);
  const bubble = !legend && shown.channel.trim() ? d.circles.at(-1) : undefined;
  if (bubble) {
    const c = colorOf(text(FIELD.color));
    const light = { r: (c.r + 1) / 2, g: (c.g + 1) / 2, b: (c.b + 1) / 2 };
    ids.push(s.addObject(obj.layerId, { kind: "arc", center: bubble.center, radius: bubble.radius, startAngle: 0, sweepAngle: 360 }, obj.classIndex, solid(match(light))));
  }
  for (const part of parts) {
    const shape = "shape" in part ? part.shape : part;
    const own = "shape" in part ? part.attrs : undefined;
    const closed = shape.kind === "polygon" || (shape.kind === "polyline" && shape.closed);
    ids.push(s.addObject(obj.layerId, shape, obj.classIndex, own ?? (closed ? solid(paper) : { fillPattern: 0 })));
  }
  // drawn in its own frame on its layer, then moved into it
  s.setPluginDrawing(id, ids);
}

/**
 * An instance of symbol `index` showing an instrument, in its frame: turned so the symbol's front (toward -y,
 * as a device aimed down the page is drawn) points along `aim`, `factor` times its size, at `height` above
 * the layer (a plug-in's drawing is lifted by its layer's elevation when shown).
 */
function symbolIn(s: EditSession, layerId: string, index: number, classIndex: number, aim: number, factor: number, height: number): string {
  const id = s.insertSymbol(layerId, index, { x: 0, y: 0 }, classIndex);
  const t = aim + Math.PI / 2;
  const [c, n] = [Math.cos(t) * factor, Math.sin(t) * factor];
  s.transformObjects([id], { a: c, b: n, c: -n, d: c, e: 0, f: 0 });
  const base = s.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
  s.moveObjects3D([id], 0, 0, height - base);
  return id;
}

/** Starting values for a new instrument of a catalogue type, as a type's figures with `edit` over them. */
function initialValues(typeKey: string, edit: FixtureEdit): Record<string, RecordValue> {
  const t = fixtureType(typeKey) ?? fixtureType(DEFAULT_TYPE)!;
  return { ...editValues({ type: t.key, watts: t.watts, weightKg: t.weightKg, beamDeg: t.beamDeg, fieldDeg: t.fieldDeg, lumens: t.lumens, footprint: t.footprint }), ...editValues(edit) };
}

/**
 * Places an instrument of catalogue type `typeKey` on `layerId` at `at`, within the caller's batch,
 * with `edit`'s values over the type's figures; its id. Colour, position, focus and so on come from `edit`.
 */
export function placeInstrument(s: EditSession, layerId: string, at: Pt, typeKey: string, edit: FixtureEdit = {}, classIndex?: number): string {
  // it takes the active label legend
  const active = readLegends().active;
  // a drawing whose instruments came before a field was added takes it
  if (edit.symbol || active) s.growPluginFields(INSTRUMENT, instrumentFields());
  const id = s.addPluginObject(layerId, INSTRUMENT, instrumentFields(), { ...initialValues(typeKey, edit), ...(active ? { [FIELD.legend]: active } : {}) }, at, 0, classIndex ?? store.activeClassIndex);
  drawInto(s, id);
  return id;
}

/** Draws Rodeo Instruments `ids` again from their records, in the session's open batch (after their legend changed). */
export function redrawInstruments(s: EditSession, ids: readonly string[]): void {
  for (const id of ids) drawInto(s, id);
}

/** Writes each edit to its instrument, in the session's open batch: a Rodeo Instrument is drawn again, a Vectorworks device only has its fields set. */
export function writeFixtures(s: EditSession, edits: readonly { readonly id: string; readonly edit: FixtureEdit }[]): void {
  for (const { id, edit } of edits) {
    const rec = s.doc.records(id).find((r) => r.parametric);
    if (!rec) continue;
    const native = rec.name === INSTRUMENT;
    const values = native ? editValues(edit) : foreignValues(edit, rec.fields);
    for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
    if (native) drawInto(s, id);
  }
}

/** Writes each edit to its instrument as one undo step named `label`; false if it failed (the user has been told). */
export function editFixtures(label: string, edits: readonly { readonly id: string; readonly edit: FixtureEdit }[]): boolean {
  return attempt(label, (s) => s.batch(() => writeFixtures(s, edits))) !== null;
}

const LABELS: Readonly<Record<string, string>> = {
  [FIELD.type]: "Instrument Type",
  [FIELD.watts]: "Wattage (W)",
  [FIELD.weight]: "Weight (kg)",
  [FIELD.beam]: "Beam Angle (°)",
  [FIELD.field]: "Field Angle (°)",
  [FIELD.height]: "Lens Height",
  [FIELD.focused]: "Focused",
  [FIELD.aim]: "Aim (° in plan)",
  [FIELD.factor]: "Symbol Scale",
  [FIELD.labelSize]: "Label Size (mm on paper)",
  [FIELD.symbol]: "Symbol",
  [FIELD.legend]: "Use Legend",
};

/** Replace Lighting Devices, opened on devices from Object Info's button: set by the Stage menu's part that has it, which reads this file. */
export const replaceDevices = { open: (_ids: readonly string[]): void => {} };
const REPLACE = 38;

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const divider = (id: number, label: string): PluginWidget => ({ id, kind: "divider", label, level: 0 });
const WIDGETS: readonly PluginWidget[] = [
  param(1, FIELD.type),
  param(2, FIELD.position),
  param(3, FIELD.unit),
  param(4, FIELD.purpose),
  divider(5, "Control"),
  param(6, FIELD.channel),
  param(7, FIELD.universe),
  param(8, FIELD.address),
  param(9, FIELD.footprint),
  param(10, FIELD.dimmer),
  param(11, FIELD.circuit),
  divider(12, "Colour and Accessories"),
  param(13, FIELD.color),
  param(14, FIELD.gobo),
  param(15, FIELD.accessory),
  divider(16, "Photometrics"),
  param(17, FIELD.watts),
  param(18, FIELD.weight),
  param(19, FIELD.beam),
  param(20, FIELD.field),
  param(21, FIELD.lumens),
  divider(22, "Focus"),
  param(23, FIELD.height),
  param(24, FIELD.focused),
  param(25, FIELD.focusX),
  param(26, FIELD.focusY),
  param(27, FIELD.focusZ),
  param(28, FIELD.aim),
  divider(29, "Drawing"),
  param(37, FIELD.symbol),
  { id: REPLACE, kind: "button", label: "Replace Lighting Device…", level: 0 },
  param(39, FIELD.legend),
  param(30, FIELD.factor),
  param(31, FIELD.labelSize),
  param(32, FIELD.showChannel),
  param(33, FIELD.showUnit),
  param(34, FIELD.showColor),
  param(35, FIELD.showPurpose),
  param(36, FIELD.notes),
];

const TYPE_CHOICES = FIXTURE_TYPES.map((t) => ({ value: t.key, label: t.label }));

const driver: PluginDriver = {
  name: INSTRUMENT,
  shape: "point",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: () => false,
  choices(field) {
    if (field === FIELD.type) return TYPE_CHOICES;
    if (field === FIELD.legend) return [{ value: "", label: "Rodeo default" }, ...readLegends().legends.map((l) => ({ value: l.name, label: l.name }))];
    if (field !== FIELD.symbol) return undefined;
    const names = (store.session?.doc.symbolDefs() ?? []).map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [{ value: "", label: "Generic outline" }, ...names.map((value) => ({ value, label: value }))];
  },
  place(layerId, at) {
    attempt("Lighting Device", (s) => s.batch(() => placeInstrument(s, layerId, at, DEFAULT_TYPE)));
  },
  edit(id, values) {
    attempt("Edit Instrument", (s) =>
      s.batch(() => {
        let rec = s.doc.records(id).find((r) => r.parametric && r.name === INSTRUMENT);
        if (!rec) throw new Error("That isn't a lighting instrument.");
        // a drawing whose instruments came before a field was added takes it
        if (Object.keys(values).some((f) => !rec!.fields.some((x) => x.name === f))) {
          s.growPluginFields(INSTRUMENT, instrumentFields());
          rec = s.doc.records(id).find((r) => r.parametric && r.name === INSTRUMENT)!;
        }
        // a new type brings its typical figures, which a later edit can change
        const t = FIELD.type in values ? fixtureType(String(values[FIELD.type])) : undefined;
        const typical = t ? editValues({ watts: t.watts, weightKg: t.weightKg, beamDeg: t.beamDeg, fieldDeg: t.fieldDeg, lumens: t.lumens, footprint: t.footprint }) : {};
        for (const [field, value] of Object.entries({ ...typical, ...values })) s.setRecordField(id, rec.format, field, value);
        drawInto(s, id);
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates: () => {},
  press(id, widget) {
    if (widget === REPLACE) replaceDevices.open([id]);
  },
};
registerPluginDrivers(() => [driver]);
