// The data a lighting instrument carries. A Rodeo Instrument is a plug-in object whose parameters
// (FIELD) hold its patch, colour, photometrics and focus, so paperwork, patching, beams and load checks
// all read one source and it's saved in the drawing; instrument.ts draws it. readFixtures also reads
// the lighting devices Vectorworks Spotlight saves, under the field names they use, so an imported plot
// gets the same paperwork. Everything here is pure: lengths in mm, angles in degrees, weights in kg.

import type { PluginFieldSpec, Pt, RecordField, RecordValue, VwxDocument } from "../../core/index.ts";
import type { Instrument } from "../../app/lightingDeviceShapes.ts";

/** the plug-in format of Rodeo's own instruments */
export const INSTRUMENT = "Rodeo Instrument";
const PLUGIN = 86;
/** the plug-in formats Vectorworks saves its lighting devices under */
const VECTORWORKS_DEVICES: ReadonlySet<string> = new Set(["lighting device", "light instrument", "lighting instrument"]);

const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

export const FIELD = {
  type: "Instrument Type",
  position: "Position",
  unit: "Unit Number",
  channel: "Channel",
  universe: "Universe",
  address: "Address",
  footprint: "Footprint",
  dimmer: "Dimmer",
  circuit: "Circuit",
  color: "Color",
  gobo: "Gobo",
  purpose: "Purpose",
  accessory: "Accessory",
  notes: "Notes",
  watts: "Wattage",
  weight: "Weight",
  beam: "Beam Angle",
  field: "Field Angle",
  lumens: "Lumens",
  height: "Height",
  focused: "Focused",
  focusX: "Focus X",
  focusY: "Focus Y",
  focusZ: "Focus Z",
  aim: "Aim",
  factor: "Symbol Scale",
  labelSize: "Label Size",
  showChannel: "Show Channel",
  showUnit: "Show Unit",
  showColor: "Show Color",
  showPurpose: "Show Purpose",
  symbol: "Symbol Name",
  legend: "Use Legend",
} as const;

/** A kind of instrument: typical figures to start from, which each instrument's own fields can change. */
export interface FixtureType {
  readonly key: string;
  readonly label: string;
  readonly glyph: Instrument;
  readonly watts: number;
  readonly weightKg: number;
  /** 50% of peak intensity, full angle */
  readonly beamDeg: number;
  /** 10% of peak intensity, full angle */
  readonly fieldDeg: number;
  /** total output of the fixture, after the optics */
  readonly lumens: number;
  /** DMX channels in its usual mode */
  readonly footprint: number;
}

const type = (key: string, label: string, glyph: Instrument, watts: number, weightKg: number, beamDeg: number, fieldDeg: number, lumens: number, footprint: number): FixtureType => ({
  key,
  label,
  glyph,
  watts,
  weightKg,
  beamDeg,
  fieldDeg,
  lumens,
  footprint,
});

/** Generic instruments with typical figures, not any maker's published data. */
export const FIXTURE_TYPES: readonly FixtureType[] = [
  type("profile19", "Profile 19°", "ellipsoidal", 750, 7.7, 13, 19, 9500, 1),
  type("profile26", "Profile 26°", "ellipsoidal", 750, 7.7, 18, 26, 10500, 1),
  type("profile36", "Profile 36°", "ellipsoidal", 750, 7.7, 25, 36, 11000, 1),
  type("profile50", "Profile 50°", "ellipsoidal", 750, 7.7, 34, 50, 10500, 1),
  type("zoomprofile", "Zoom Profile 25–50°", "ellipsoidal", 1000, 11, 26, 38, 11000, 1),
  type("ledprofile", "LED Profile 26°", "ellipsoidal", 250, 12, 18, 26, 9000, 8),
  type("fresnel650", "Fresnel 650 W", "fresnel", 650, 4.5, 25, 45, 4500, 1),
  type("fresnel1k", "Fresnel 1 kW", "fresnel", 1000, 7, 25, 45, 9000, 1),
  type("fresnel2k", "Fresnel 2 kW", "fresnel", 2000, 12, 25, 45, 21000, 1),
  type("parvnsp", "PAR 64 VNSP", "par", 1000, 3, 9, 14, 12000, 1),
  type("parnsp", "PAR 64 NSP", "par", 1000, 3, 12, 24, 14000, 1),
  type("parmfl", "PAR 64 MFL", "par", 1000, 3, 23, 44, 16000, 1),
  type("parwfl", "PAR 64 WFL", "par", 1000, 3, 40, 70, 16000, 1),
  type("ledpar", "LED PAR", "par", 120, 4.5, 25, 40, 4000, 7),
  type("washmover", "LED Wash Mover", "moving", 400, 13, 15, 30, 12000, 16),
  type("spotmover", "Spot Mover", "moving", 700, 24, 18, 25, 16000, 24),
  type("profilemover", "Profile Mover", "moving", 800, 28, 18, 25, 18000, 30),
  type("beammover", "Beam Mover", "moving", 230, 15, 3, 4, 6500, 16),
  type("cycflood", "Cyc Flood 1 kW", "wash", 1000, 6, 60, 90, 12000, 1),
  type("ledbatten", "LED Batten", "wash", 200, 6, 30, 60, 6000, 12),
  type("ledpanel", "LED Wash Panel", "wash", 300, 9, 40, 80, 8000, 8),
  type("followspot", "Followspot", "ellipsoidal", 1200, 32, 6, 10, 40000, 1),
];

export const DEFAULT_TYPE = "profile26";

export function fixtureType(key: string): FixtureType | undefined {
  return FIXTURE_TYPES.find((t) => t.key === key);
}

/** A focus point: the drawing's x and y, and z above the stage floor; mm. */
export interface FocusPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One lighting instrument in the drawing, Rodeo's own or Vectorworks'. */
export interface Fixture {
  readonly id: string;
  readonly layerId: string;
  readonly classIndex: number;
  /** a Rodeo Instrument, which Rodeo draws again from its data; otherwise Vectorworks' device, whose drawing stays as saved */
  readonly native: boolean;
  /** the hanging point in plan */
  readonly at: Pt;
  /** the catalogue key, or a Vectorworks device's type name */
  readonly type: string;
  /** the type's name to show */
  readonly label: string;
  readonly glyph: Instrument;
  /** the hanging position's name ("1st Electric") */
  readonly position: string;
  readonly unit: string;
  readonly channel: string;
  /** DMX universe from 1; 0 when not patched */
  readonly universe: number;
  /** DMX start address 1 to 512; 0 when not patched */
  readonly address: number;
  readonly footprint: number;
  readonly dimmer: string;
  readonly circuit: string;
  /** the filters, as gels.ts reads them */
  readonly color: string;
  readonly gobo: string;
  readonly purpose: string;
  readonly accessory: string;
  readonly notes: string;
  readonly watts: number;
  readonly weightKg: number;
  readonly beamDeg: number;
  readonly fieldDeg: number;
  readonly lumens: number;
  /** the lens above the stage floor */
  readonly heightMm: number;
  /** where it's focused, in the drawing's frame (z above the stage floor), or null when not focused */
  readonly focus: FocusPoint | null;
  /** which way its front points in plan, degrees anticlockwise from +x */
  readonly aimDeg: number;
  /** the drawing's symbol it shows in place of its generic outline, "" or none for the outline */
  readonly symbol?: string;
}

/** What can be set on an instrument: the fields of Fixture that hold data. */
export type FixtureEdit = Partial<
  Pick<
    Fixture,
    | "type"
    | "position"
    | "unit"
    | "channel"
    | "universe"
    | "address"
    | "footprint"
    | "dimmer"
    | "circuit"
    | "color"
    | "gobo"
    | "purpose"
    | "accessory"
    | "notes"
    | "symbol"
    | "watts"
    | "weightKg"
    | "beamDeg"
    | "fieldDeg"
    | "lumens"
    | "heightMm"
    | "focus"
    | "aimDeg"
  >
>;

/** the plug-in's parameters, for a new format: their defaults come from the default type */
export function instrumentFields(): PluginFieldSpec[] {
  const t = fixtureType(DEFAULT_TYPE)!;
  return [
    { name: FIELD.type, type: POPUP, value: t.key },
    { name: FIELD.position, type: TEXT, value: "" },
    { name: FIELD.unit, type: TEXT, value: "" },
    { name: FIELD.channel, type: TEXT, value: "" },
    { name: FIELD.universe, type: NUMBER, value: 0 },
    { name: FIELD.address, type: NUMBER, value: 0 },
    { name: FIELD.footprint, type: NUMBER, value: t.footprint },
    { name: FIELD.dimmer, type: TEXT, value: "" },
    { name: FIELD.circuit, type: TEXT, value: "" },
    { name: FIELD.color, type: TEXT, value: "" },
    { name: FIELD.gobo, type: TEXT, value: "" },
    { name: FIELD.purpose, type: TEXT, value: "" },
    { name: FIELD.accessory, type: TEXT, value: "" },
    { name: FIELD.notes, type: TEXT, value: "" },
    { name: FIELD.watts, type: NUMBER, value: t.watts },
    { name: FIELD.weight, type: NUMBER, value: t.weightKg },
    { name: FIELD.beam, type: NUMBER, value: t.beamDeg },
    { name: FIELD.field, type: NUMBER, value: t.fieldDeg },
    { name: FIELD.lumens, type: NUMBER, value: t.lumens },
    { name: FIELD.height, type: DIMENSION, value: DEFAULT_HEIGHT_MM },
    { name: FIELD.focused, type: BOOL, value: false },
    { name: FIELD.focusX, type: DIMENSION, value: 0 },
    { name: FIELD.focusY, type: DIMENSION, value: 0 },
    { name: FIELD.focusZ, type: DIMENSION, value: FOCUS_PLANE_MM },
    { name: FIELD.aim, type: NUMBER, value: -90 },
    { name: FIELD.factor, type: NUMBER, value: 1 },
    { name: FIELD.labelSize, type: NUMBER, value: 2.5 },
    { name: FIELD.showChannel, type: BOOL, value: true },
    { name: FIELD.showUnit, type: BOOL, value: true },
    { name: FIELD.showColor, type: BOOL, value: true },
    { name: FIELD.showPurpose, type: BOOL, value: false },
    { name: FIELD.symbol, type: POPUP, value: "" },
    { name: FIELD.legend, type: POPUP, value: "" },
  ];
}

/** an instrument hangs this high until it's told otherwise */
export const DEFAULT_HEIGHT_MM = 6000;
/** the plane designers focus on: a performer's head, about 1.7 m */
export const FOCUS_PLANE_MM = 1700;

/** A field by any of its names, whatever their case. */
function fieldOf(fields: readonly RecordField[], names: readonly string[]): RecordField | undefined {
  for (const name of names) {
    const f = fields.find((x) => x.name.toLowerCase() === name);
    if (f) return f;
  }
  return undefined;
}

const textOf = (fields: readonly RecordField[], ...names: string[]): string => {
  const v = fieldOf(fields, names)?.value;
  return v === undefined ? "" : String(v).trim();
};

/** The leading number of a field Vectorworks may hold as text ("750W"), or 0. */
const numberOf = (fields: readonly RecordField[], ...names: string[]): number => {
  const n = parseFloat(String(fieldOf(fields, names)?.value ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** names Vectorworks' Lighting Device and Light Instrument save each thing under */
const ALIASES = {
  type: ["inst type", "instrument type", "device type"],
  position: ["position"],
  unit: ["unit number"],
  channel: ["channel"],
  universeAddress: ["universeaddr", "universe/address"],
  universe: ["universe"],
  address: ["address", "dmx address"],
  footprint: ["footprint", "num channels"],
  dimmer: ["dimmer"],
  circuit: ["circuit name", "circuit number", "circuit"],
  color: ["color", "colour"],
  gobo: ["gobo 1", "gobo"],
  purpose: ["purpose"],
  accessory: ["accessories", "accessory"],
  notes: ["user field 1", "notes"],
  watts: ["wattage", "watts", "load"],
  weight: ["weight"],
  beam: ["beam angle", "beam"],
  field: ["field angle", "field"],
  lumens: ["lumens"],
  height: ["z height", "height"],
} as const;

/** The instrument a plug-in object's record holds, Rodeo's or Vectorworks'. */
function fixtureOf(id: string, layerId: string, classIndex: number, at: Pt, name: string, f: readonly RecordField[]): Fixture {
  const native = name === INSTRUMENT;
  const typeText = textOf(f, ...ALIASES.type);
  const known = fixtureType(typeText);
  const pair = /^(\d+)\s*[./]\s*(\d+)$/.exec(textOf(f, ...ALIASES.universeAddress));
  const focused = native && fieldOf(f, [FIELD.focused.toLowerCase()])?.value === true;
  const focus = focused ? { x: numberOf(f, FIELD.focusX.toLowerCase()), y: numberOf(f, FIELD.focusY.toLowerCase()), z: numberOf(f, FIELD.focusZ.toLowerCase()) } : null;
  const figure = (read: number, typical: number | undefined): number => (read > 0 ? read : (typical ?? 0));
  return {
    id,
    layerId,
    classIndex,
    native,
    at,
    type: typeText,
    label: known?.label ?? typeText,
    glyph: known?.glyph ?? "ellipsoidal",
    position: textOf(f, ...ALIASES.position),
    unit: textOf(f, ...ALIASES.unit),
    channel: textOf(f, ...ALIASES.channel),
    universe: pair ? Number(pair[1]) : numberOf(f, ...ALIASES.universe),
    address: pair ? Number(pair[2]) : numberOf(f, ...ALIASES.address),
    footprint: figure(numberOf(f, ...ALIASES.footprint), known?.footprint ?? 1),
    dimmer: textOf(f, ...ALIASES.dimmer),
    circuit: textOf(f, ...ALIASES.circuit),
    color: textOf(f, ...ALIASES.color),
    gobo: textOf(f, ...ALIASES.gobo),
    purpose: textOf(f, ...ALIASES.purpose),
    accessory: textOf(f, ...ALIASES.accessory),
    notes: textOf(f, ...ALIASES.notes),
    watts: figure(numberOf(f, ...ALIASES.watts), known?.watts),
    weightKg: figure(numberOf(f, ...ALIASES.weight), known?.weightKg),
    beamDeg: figure(numberOf(f, ...ALIASES.beam), known?.beamDeg ?? 18),
    fieldDeg: figure(numberOf(f, ...ALIASES.field), known?.fieldDeg ?? 26),
    lumens: figure(numberOf(f, ...ALIASES.lumens), known?.lumens ?? 8000),
    heightMm: figure(numberOf(f, ...ALIASES.height), DEFAULT_HEIGHT_MM),
    focus,
    aimDeg: focus ? aimTo(at, focus) : numberOf(f, FIELD.aim.toLowerCase()),
    symbol: textOf(f, FIELD.symbol.toLowerCase()),
  };
}

/** The plan direction from a hanging point to its focus, degrees anticlockwise from +x (straight down the page when they meet). */
export function aimTo(at: Pt, focus: Pt): number {
  return Math.hypot(focus.x - at.x, focus.y - at.y) < 1e-6 ? -90 : (Math.atan2(focus.y - at.y, focus.x - at.x) * 180) / Math.PI;
}

/** Every instrument on the drawing's design layers, in layer and stacking order. */
export function readFixtures(doc: VwxDocument): Fixture[] {
  const out: Fixture[] = [];
  const seen = new Set<string>();
  for (const layer of doc.layers()) {
    if (layer.kind !== "design") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN || seen.has(o.id)) continue;
      seen.add(o.id);
      const rec = doc.records(o.id).find((r) => r.parametric);
      if (!rec || (rec.name !== INSTRUMENT && !VECTORWORKS_DEVICES.has(rec.name.toLowerCase()))) continue;
      out.push(fixtureOf(o.id, layer.id, o.classIndex, o.insertion ?? { x: 0, y: 0 }, rec.name, rec.fields));
    }
  }
  return out;
}

/** The fields of a Rodeo Instrument an edit sets, by field name. */
export function editValues(edit: FixtureEdit): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  const put = (field: string, v: RecordValue | undefined): void => {
    if (v !== undefined) out[field] = v;
  };
  put(FIELD.type, edit.type);
  put(FIELD.position, edit.position);
  put(FIELD.unit, edit.unit);
  put(FIELD.channel, edit.channel);
  put(FIELD.universe, edit.universe);
  put(FIELD.address, edit.address);
  put(FIELD.footprint, edit.footprint);
  put(FIELD.dimmer, edit.dimmer);
  put(FIELD.circuit, edit.circuit);
  put(FIELD.color, edit.color);
  put(FIELD.gobo, edit.gobo);
  put(FIELD.purpose, edit.purpose);
  put(FIELD.accessory, edit.accessory);
  put(FIELD.notes, edit.notes);
  put(FIELD.symbol, edit.symbol);
  put(FIELD.watts, edit.watts);
  put(FIELD.weight, edit.weightKg);
  put(FIELD.beam, edit.beamDeg);
  put(FIELD.field, edit.fieldDeg);
  put(FIELD.lumens, edit.lumens);
  put(FIELD.height, edit.heightMm);
  put(FIELD.aim, edit.aimDeg);
  if (edit.focus !== undefined) {
    put(FIELD.focused, edit.focus !== null);
    if (edit.focus) {
      put(FIELD.focusX, edit.focus.x);
      put(FIELD.focusY, edit.focus.y);
      put(FIELD.focusZ, edit.focus.z);
    }
  }
  return out;
}

/**
 * The fields of a Vectorworks device an edit sets, under the names its record has. Only what it has
 * a field for is set, as text or a number as the field already holds it; its drawing stays as saved.
 */
export function foreignValues(edit: FixtureEdit, fields: readonly RecordField[]): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  const put = (names: readonly string[], v: string | number | undefined): void => {
    if (v === undefined) return;
    const f = fieldOf(fields, names);
    if (f) out[f.name] = typeof f.value === "number" ? Number(v) || 0 : String(v);
  };
  put(ALIASES.position, edit.position);
  put(ALIASES.unit, edit.unit);
  put(ALIASES.channel, edit.channel);
  put(ALIASES.dimmer, edit.dimmer);
  put(ALIASES.circuit, edit.circuit);
  put(ALIASES.color, edit.color);
  put(ALIASES.gobo, edit.gobo);
  put(ALIASES.purpose, edit.purpose);
  put(ALIASES.accessory, edit.accessory);
  put(ALIASES.notes, edit.notes);
  put(ALIASES.watts, edit.watts);
  put(ALIASES.weight, edit.weightKg);
  // unpatched is blank, as Vectorworks leaves it, not 0
  const blank = (v: number | undefined): string | number | undefined => (v === 0 ? "" : v);
  if (edit.universe !== undefined && edit.address !== undefined && fieldOf(fields, ALIASES.universeAddress)) put(ALIASES.universeAddress, patchText({ universe: edit.universe, address: edit.address }));
  else {
    put(ALIASES.universe, blank(edit.universe));
    put(ALIASES.address, blank(edit.address));
  }
  return out;
}

/** "1/101" for a patched instrument, "" for one not patched. */
export function patchText(f: Pick<Fixture, "universe" | "address">): string {
  return f.universe > 0 && f.address > 0 ? `${f.universe}/${f.address}` : "";
}

/** Sorts text as people read it: "2" before "10", "E2" before "E10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
