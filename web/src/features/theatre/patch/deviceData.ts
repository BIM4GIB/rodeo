// The sums behind File > Export > Export Lighting Device Data and File > Import > Import Lighting Device
// Data, Spotlight's exchange with Lightwright and spreadsheets: every instrument's fields as tab-delimited
// text, its UID (Rodeo's id for the object) always in the first column so a file can come back, and a
// file's columns linked to those fields and read back onto the instruments its key column names. Lengths
// go out and come in through the formatters the caller passes, in the drawing's units. Pure.

import { FIXTURE_TYPES, type Fixture, type FixtureEdit } from "../fixture.ts";

export const UID = "UID";

/** Writing and reading lengths in the drawing's units. */
export interface LengthText {
  readonly format: (mm: number) => string;
  readonly parse: (text: string) => number | null;
}

/** What an instrument's place says that isn't in its record. */
export interface Placement {
  readonly layer: string;
  readonly cls: string;
}

/** A field of the exchange: how it's written, and how a cell sets it (export-only fields can't be set). */
export interface DeviceField {
  readonly key: string;
  readonly label: string;
  /** other names files give it, lower case, for AutoLink */
  readonly aliases: readonly string[];
  readonly write: (f: Fixture, p: Placement, len: LengthText) => string;
  readonly read?: (cell: string, len: LengthText) => FixtureEdit | null;
}

const text =
  (set: (v: string) => FixtureEdit) =>
  (cell: string): FixtureEdit =>
    set(cell.trim());

/** a number from a cell ("750W" is 750); null when it holds none */
const numberIn = (cell: string): number | null => {
  const n = parseFloat(cell.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const figure =
  (set: (n: number) => FixtureEdit) =>
  (cell: string): FixtureEdit | null => {
    const n = numberIn(cell);
    return n === null ? null : set(n);
  };
const shown = (n: number): string => (n ? String(Math.round(n * 1000) / 1000) : "");

/** a type cell: a catalogue type by its key or label, else the text as it is */
function typeOf(cell: string): FixtureEdit | null {
  const t = cell.trim();
  if (!t) return null;
  const known = FIXTURE_TYPES.find((k) => k.key.toLowerCase() === t.toLowerCase() || k.label.toLowerCase() === t.toLowerCase());
  return { type: known?.key ?? t };
}

/** "1/101", "1.101" or "1:101" */
function universeAddress(cell: string): FixtureEdit | null {
  const t = cell.trim();
  if (!t) return { universe: 0, address: 0 };
  const m = /^(\d+)\s*[/.:]\s*(\d+)$/.exec(t);
  return m ? { universe: Number(m[1]), address: Number(m[2]) } : null;
}

const field = (key: string, label: string, aliases: readonly string[], write: DeviceField["write"], read?: DeviceField["read"]): DeviceField => ({ key, label, aliases, write, read });

/** The exchange's fields, in the order they're offered and written. */
export const DEVICE_FIELDS: readonly DeviceField[] = [
  field("type", "Instrument Type", ["inst type", "instrument type", "device type", "type"], (f) => f.label, typeOf),
  field("position", "Position", ["position", "pos"], (f) => f.position, text((v) => ({ position: v }))),
  field("unit", "Unit Number", ["unit number", "unit", "unit#", "unit no"], (f) => f.unit, text((v) => ({ unit: v }))),
  field("channel", "Channel", ["channel", "chan", "ch"], (f) => f.channel, text((v) => ({ channel: v }))),
  field("universeAddress", "Universe/Address", ["universe/address", "universeaddr", "u/a", "addr", "dmx"], (f) => (f.universe > 0 && f.address > 0 ? `${f.universe}/${f.address}` : ""), universeAddress),
  field("universe", "Universe", ["universe", "univ"], (f) => shown(f.universe), (c) => (c.trim() ? figure((n) => ({ universe: Math.max(0, Math.round(n)) }))(c) : { universe: 0 })),
  field("address", "Address", ["address", "dmx address", "start address"], (f) => shown(f.address), (c) => (c.trim() ? figure((n) => ({ address: Math.max(0, Math.round(n)) }))(c) : { address: 0 })),
  field("footprint", "DMX Footprint", ["dmx footprint", "footprint", "num channels", "channels"], (f) => shown(f.footprint), figure((n) => (n >= 1 ? { footprint: Math.round(n) } : {}))),
  field("dimmer", "Dimmer", ["dimmer", "dim"], (f) => f.dimmer, text((v) => ({ dimmer: v }))),
  field("circuit", "Circuit", ["circuit", "circuit name", "circuit number", "circ"], (f) => f.circuit, text((v) => ({ circuit: v }))),
  field("color", "Color", ["color", "colour", "gel", "filter"], (f) => f.color, text((v) => ({ color: v }))),
  field("gobo", "Gobo", ["gobo", "gobo 1", "template", "pattern"], (f) => f.gobo, text((v) => ({ gobo: v }))),
  field("purpose", "Purpose", ["purpose", "focus", "use"], (f) => f.purpose, text((v) => ({ purpose: v }))),
  field("accessory", "Accessory", ["accessory", "accessories", "acc"], (f) => f.accessory, text((v) => ({ accessory: v }))),
  field("notes", "Notes", ["notes", "note", "user field 1", "comment"], (f) => f.notes, text((v) => ({ notes: v }))),
  field("watts", "Wattage", ["wattage", "watts", "load", "power"], (f) => shown(f.watts), figure((n) => ({ watts: n }))),
  field("weight", "Weight (kg)", ["weight", "weight (kg)", "kg"], (f) => shown(f.weightKg), figure((n) => ({ weightKg: n }))),
  field("beam", "Beam Angle", ["beam angle", "beam"], (f) => shown(f.beamDeg), figure((n) => ({ beamDeg: n }))),
  field("field", "Field Angle", ["field angle", "field"], (f) => shown(f.fieldDeg), figure((n) => ({ fieldDeg: n }))),
  field("lumens", "Lumens", ["lumens", "lm", "output"], (f) => shown(f.lumens), figure((n) => ({ lumens: n }))),
  field("height", "Z Height", ["z height", "height", "z", "trim"], (f, _p, len) => len.format(f.heightMm), (c, len) => {
    const mm = len.parse(c);
    return mm === null ? null : { heightMm: mm };
  }),
  field("aim", "Aim", ["aim", "rotation", "pan"], (f) => shown(Math.round(f.aimDeg * 100) / 100), figure((n) => ({ aimDeg: n }))),
  field("x", "X Location", ["x location", "x"], (f, _p, len) => len.format(f.at.x)),
  field("y", "Y Location", ["y location", "y"], (f, _p, len) => len.format(f.at.y)),
  field("layer", "Layer", ["layer"], (_f, p) => p.layer),
  field("class", "Class", ["class"], (_f, p) => p.cls),
];

export const fieldByKey = (key: string): DeviceField | undefined => DEVICE_FIELDS.find((f) => f.key === key);

/** a cell as tab-delimited text can hold it: no tabs or line breaks */
const cellOf = (v: string): string => v.replace(/[\t\r\n]+/g, " ");

/** The instruments' fields `keys`, UID first, tab-delimited with Windows line ends as Lightwright reads them; field names first when `headings`. */
export function deviceDataText(list: readonly Fixture[], keys: readonly string[], headings: boolean, placement: (f: Fixture) => Placement, len: LengthText): string {
  const fields = keys.map(fieldByKey).filter((f): f is DeviceField => !!f);
  const lines: string[][] = [];
  if (headings) lines.push([UID, ...fields.map((f) => f.label)]);
  for (const f of list) {
    const p = placement(f);
    lines.push([f.id, ...fields.map((d) => d.write(f, p, len))]);
  }
  return lines.map((l) => l.map(cellOf).join("\t")).join("\r\n") + "\r\n";
}

/** A file's table: its column names (the first row's, or Column 1… when it holds data) and its rows, blank lines dropped. */
export function deviceTable(rows: readonly (readonly string[])[], firstIsData: boolean): { headings: string[]; rows: string[][] } {
  const kept = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  const width = Math.max(0, ...kept.map((r) => r.length));
  const pad = (r: readonly string[]): string[] => Array.from({ length: width }, (_, i) => r[i] ?? "");
  if (firstIsData || !kept.length) return { headings: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows: kept.map(pad) };
  const [head, ...rest] = kept;
  return { headings: pad(head).map((h, i) => h || `Column ${i + 1}`), rows: rest.map(pad) };
}

const squeezed = (s: string): string => s.toLowerCase().replace(/[^a-z0-9/#]+/g, "");

/** The settable field a column name most likely means, or null: a name or alias spelled alike, else one that starts the other. */
export function likelyField(heading: string): string | null {
  const name = squeezed(heading);
  if (!name) return null;
  const settable = DEVICE_FIELDS.filter((f) => f.read);
  for (const f of settable) if ([f.label, f.key, ...f.aliases].some((a) => squeezed(a) === name)) return f.key;
  if (name.length < 3) return null;
  for (const f of settable) if ([f.label, ...f.aliases].some((a) => squeezed(a).length >= 3 && (squeezed(a).startsWith(name) || name.startsWith(squeezed(a))))) return f.key;
  return null;
}

/** The key column: one named UID, EID or Unique ID, else the first. */
export function likelyKey(headings: readonly string[]): number {
  const i = headings.findIndex((h) => /^(uid|eid|unique ?id|external ?id|vwid|lightwright ?id)$/i.test(h.trim()));
  return Math.max(0, i);
}

/** Whether links set the patch twice over: Universe/Address and Universe or Address both. */
export function patchTwice(links: ReadonlyMap<number, string>): boolean {
  const fields = new Set(links.values());
  return fields.has("universeAddress") && (fields.has("universe") || fields.has("address"));
}

/**
 * AutoLink: each column but the key to the field its name most likely means, no field taken twice,
 * and Universe/Address or Universe and Address, not both (the pair when a file has all three).
 */
export function autoLink(headings: readonly string[], key: number): Map<number, string> {
  const out = new Map<number, string>();
  const taken = new Set<string>();
  headings.forEach((h, i) => {
    if (i === key) return;
    const f = likelyField(h);
    if (f && !taken.has(f)) {
      out.set(i, f);
      taken.add(f);
    }
  });
  if (patchTwice(out)) for (const [i, f] of out) if (f === "universeAddress") out.delete(i);
  return out;
}

/** What an import does: the instruments it sets, the rows that match none (orphans, placed new), and the cells it couldn't read. */
export interface ImportPlan {
  readonly edits: { readonly id: string; readonly edit: FixtureEdit }[];
  readonly orphans: { readonly key: string; readonly edit: FixtureEdit }[];
  /** cells a field couldn't read ("12ft" in Wattage), left as they were */
  readonly unread: number;
  /** keys more than one row gave, the later rows winning */
  readonly repeated: number;
}

/**
 * The plan for `rows`: each row's key (column `key`) matched to the instrument whose UID it is, or
 * when `matchBy` names a field, whose value of that field it is; the linked columns read into an edit.
 */
export function planImport(rows: readonly (readonly string[])[], key: number, links: ReadonlyMap<number, string>, list: readonly Fixture[], len: LengthText, matchBy: string = UID): ImportPlan {
  const placement: Placement = { layer: "", cls: "" };
  const keyOf = (f: Fixture): string => (matchBy === UID ? f.id : (fieldByKey(matchBy)?.write(f, placement, len) ?? "")).trim().toLowerCase();
  const byKey = new Map<string, Fixture[]>();
  for (const f of list) {
    const k = keyOf(f);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  const edits = new Map<string, FixtureEdit>();
  const orphans: { key: string; edit: FixtureEdit }[] = [];
  const seen = new Set<string>();
  let unread = 0;
  let repeated = 0;
  for (const row of rows) {
    let edit: FixtureEdit = {};
    for (const [col, fieldKey] of links) {
      const read = fieldByKey(fieldKey)?.read;
      if (!read || col === key) continue;
      const got = read(row[col] ?? "", len);
      if (got) edit = { ...edit, ...got };
      else if ((row[col] ?? "").trim()) unread++;
    }
    const k = (row[key] ?? "").trim();
    const found = k ? byKey.get(k.toLowerCase()) : undefined;
    if (!found) {
      orphans.push({ key: k, edit });
      continue;
    }
    if (seen.has(k.toLowerCase())) repeated++;
    seen.add(k.toLowerCase());
    for (const f of found) edits.set(f.id, { ...edits.get(f.id), ...edit });
  }
  return { edits: [...edits].map(([id, edit]) => ({ id, edit })), orphans, unread, repeated };
}
