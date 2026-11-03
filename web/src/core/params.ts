// Record data: the values a record format (type 47) defines, held by a record
// (type 48) under an object. A plug-in object's parameters are one of these.
//
// Record format (47), after the common header:
//   +0x50  u16   field count
//   +0x5a  u16   flags; bit 0 = a plug-in's parameters
//   +0x60  136B  per field: u16 type, u16 value offset, u16, u16 number
//                format, then the field name (UTF-16, zero-ended)
//
// A plug-in's format is written as the demos' are: its fields' types are Vectorworks' parameter
// types (popups 8, x and y coordinates 10 and 11, static text 14, classes 18...), and its records
// list their per-field bytes.
//
// Record (48):
//   +0x50  u16   name index of its format
//   +0x54  u16   n: the field count, or 0
//   +0x56  n×u8  one byte per field
//   then the values, each at its field's offset from there. Text values are
//   u32 byte length + u32 offset (from the same start) into a string pool
//   after the fixed values; reals are an f64 and two spare bytes. Some
//   records keep stale bytes after the pool. The format's own record holds
//   its default values.
//
// In the demos a data record format is exactly its fields long, each field's
// third u16 is 0, the value offsets follow the fields in order, and every
// record's per-field bytes and its u16 at +0x52 are 0. A new field is written
// that way; a dimension's number format is 5, as theirs are.

import { concat, encodeUtf16, f64, i32, readUtf16, setF64, setI32, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import type { FieldKind, PluginFieldSpec, RecordField, RecordFieldSpec, RecordValue } from "./types.ts";

export const RECORD_FORMAT = 47;
export const RECORD = 48;
const FIELD_COUNT = 0x50;
/** u16: 1 when the format holds a plug-in's parameters */
const FORMAT_PLUGIN = 0x58;
const FIELDS_AT = 0x60;
const FIELD_SIZE = 0x88;
const RECORD_FORMAT_REF = 0x50;
const RECORD_COUNT = 0x54;
const RECORD_FLAGS = 0x56;

/** Field types by how the value is stored. */
const KINDS: Record<number, FieldKind> = {
  1: "integer",
  2: "boolean",
  3: "number",
  4: "text",
  7: "dimension",
  8: "choice",
  9: "choice",
  10: "dimension",
  11: "dimension",
  14: "text",
  16: "integer",
  18: "class",
  19: "layer",
  20: "angle",
  21: "area",
  22: "volume",
  23: "integer",
  24: "integer",
  25: "integer",
  26: "integer",
  27: "integer",
  28: "color",
  29: "integer",
  30: "integer",
};
const TEXT = new Set<FieldKind>(["text", "choice", "class", "layer"]);
const REAL = new Set<FieldKind>(["number", "dimension", "angle", "area", "volume"]);

export interface FieldDef {
  name: string;
  type: number;
  kind: FieldKind | null;
  off: number;
}

export interface FormatDef {
  parametric: boolean;
  fields: FieldDef[];
}

function sizeOf(kind: FieldKind): number {
  if (TEXT.has(kind)) return 8;
  if (REAL.has(kind)) return 10;
  return kind === "boolean" || kind === "color" ? 2 : 4;
}

export function readFormat(d: Uint8Array): FormatDef {
  const n = u16(d, FIELD_COUNT);
  const fields: FieldDef[] = [];
  for (let i = 0; i < n; i++) {
    const o = FIELDS_AT + i * FIELD_SIZE;
    if (o + FIELD_SIZE > d.length) break;
    let end = o + 8;
    while (end + 1 < o + FIELD_SIZE && u16(d, end)) end += 2;
    const type = u16(d, o);
    fields.push({ name: readUtf16(d, o + 8, end - o - 8), type, kind: KINDS[type] ?? null, off: u16(d, o + 2) });
  }
  return { parametric: u16(d, FORMAT_PLUGIN) === 1, fields };
}

/** Name index of the format a record holds values for. */
export function recordFormat(d: Uint8Array): number {
  return u16(d, RECORD_FORMAT_REF);
}

function valuesAt(d: Uint8Array): number {
  return RECORD_FLAGS + u16(d, RECORD_COUNT);
}

/** The record's values in field order; null when it doesn't fit its format. */
export function readValues(d: Uint8Array, fmt: FormatDef): RecordField[] | null {
  if (d.length < RECORD_FLAGS) return null;
  const n = u16(d, RECORD_COUNT);
  if (n !== 0 && n !== fmt.fields.length) return null;
  const at = valuesAt(d);
  const out: RecordField[] = [];
  for (const f of fmt.fields) {
    const o = at + f.off;
    let value: RecordValue = "";
    if (f.kind && o + sizeOf(f.kind) > d.length) return null;
    if (!f.kind) value = "";
    else if (TEXT.has(f.kind)) {
      const len = u32(d, o);
      const from = at + u32(d, o + 4);
      if (len % 2 || from + len > d.length) return null;
      value = readUtf16(d, from, len);
    } else if (REAL.has(f.kind)) value = f64(d, o);
    else if (f.kind === "boolean") value = u16(d, o) !== 0;
    else if (f.kind === "color") value = u16(d, o);
    else value = i32(d, o);
    out.push({ name: f.name, kind: f.kind ?? "other", value });
  }
  return out;
}

/**
 * The record with one field set. Numbers are written in place; text rebuilds
 * the string pool after the fixed values (dropping any stale bytes).
 */
export function writeValue(d: Uint8Array, fmt: FormatDef, field: string, value: RecordValue): Uint8Array {
  const values = readValues(d, fmt);
  const i = fmt.fields.findIndex((f) => f.name === field);
  if (!values || i < 0) throw new Error(`no field "${field}" in this record`);
  const f = fmt.fields[i];
  const at = valuesAt(d);
  const o = at + f.off;
  if (!f.kind) throw new Error(`field "${field}" can't be edited`);
  if (TEXT.has(f.kind)) {
    if (typeof value !== "string") throw new Error(`field "${field}" takes text`);
    if (fmt.fields.some((g) => !g.kind)) throw new Error(`field "${field}" can't be edited`);
    const fixed = Math.max(0, ...fmt.fields.map((g) => g.off + sizeOf(g.kind!)));
    const head = d.slice(0, at + fixed);
    const pool: Uint8Array[] = [];
    let next = fixed;
    fmt.fields.forEach((g, k) => {
      if (!TEXT.has(g.kind!)) return;
      const s = encodeUtf16(k === i ? value : (values[k].value as string));
      setU32(head, at + g.off, s.length);
      setU32(head, at + g.off + 4, next);
      pool.push(s);
      next += s.length;
    });
    const out = concat([head, ...pool]);
    setU64(out, 0, BigInt(out.length));
    return out;
  }
  const out = d.slice();
  if (REAL.has(f.kind)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`field "${field}" takes a number`);
    setF64(out, o, value);
  } else if (f.kind === "boolean") {
    setU16(out, o, value ? 1 : 0);
  } else {
    if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`field "${field}" takes a whole number`);
    if (f.kind === "color") setU16(out, o, value);
    else setI32(out, o, value);
  }
  return out;
}

/** Field type codes for the kinds a new field can take. */
const NEW_TYPES: Partial<Record<FieldKind, number>> = { integer: 1, boolean: 2, number: 3, text: 4, dimension: 7 };
/** a field name's most UTF-16 units: the name and its terminator fill the field's 128 bytes */
export const MAX_FIELD_NAME = 63;

/** `value` as the field kind takes it, or an error. */
function checkValue(kind: FieldKind, name: string, value: RecordValue): RecordValue {
  if (TEXT.has(kind)) {
    if (typeof value !== "string") throw new Error(`field "${name}" takes text`);
  } else if (REAL.has(kind)) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`field "${name}" takes a number`);
  } else if (kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`field "${name}" takes true or false`);
  } else if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`field "${name}" takes a whole number`);
  return value;
}

/** Throws unless `name` (`spec`'s, trimmed) can name a field among `specs`. */
function checkFieldName(name: string, spec: RecordFieldSpec, specs: readonly RecordFieldSpec[]): void {
  if (!name) throw new Error("every field needs a name");
  if (name.length > MAX_FIELD_NAME) throw new Error(`"${name}" is longer than ${MAX_FIELD_NAME} characters`);
  const lower = name.toLowerCase();
  if (specs.filter((x) => (x === spec ? name : x.name).toLowerCase() === lower).length > 1) throw new Error(`two fields are named "${name}"`);
}

/** Why a new record format can't have these fields, all new, or null when it can: the checks encodeFormat makes. */
export function newFieldsProblem(specs: readonly RecordFieldSpec[]): string | null {
  try {
    for (const spec of specs) {
      const name = spec.name.trim();
      checkFieldName(name, spec, specs);
      if (NEW_TYPES[spec.kind] === undefined) throw new Error(`a new field can't be a ${spec.kind} field`);
      checkValue(spec.kind, name, spec.value);
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * The format record `d` with its fields replaced by `specs`. A spec naming an old field (`from`)
 * keeps that field's definition, renamed; any other is a new field of its kind.
 */
export function encodeFormat(d: Uint8Array, specs: readonly RecordFieldSpec[]): Uint8Array {
  const old = readFormat(d);
  if (old.parametric) throw new Error("a plug-in's parameters can't be edited as a record format");
  if (old.fields.some((f) => !f.kind)) throw new Error("this format has a field openvwx can't read, so it can't be edited");
  const kept = new Set<string>();
  const defs: Uint8Array[] = [];
  let off = 0;
  for (const spec of specs) {
    const i = spec.from === undefined ? -1 : old.fields.findIndex((f) => f.name === spec.from);
    const f = old.fields[i];
    // a kept field keeps its whole definition, so a name it already has needn't pass the checks
    const name = f && spec.name === f.name ? spec.name : spec.name.trim();
    if (name !== f?.name) checkFieldName(name, spec, specs);
    let def: Uint8Array;
    let kind: FieldKind;
    if (spec.from !== undefined) {
      if (!f || kept.has(spec.from)) throw new Error(`no field "${spec.from}" to keep`);
      if (f.kind !== spec.kind) throw new Error(`field "${f.name}" can't change its kind`);
      kept.add(spec.from);
      def = d.slice(FIELDS_AT + i * FIELD_SIZE, FIELDS_AT + (i + 1) * FIELD_SIZE);
      kind = f.kind!;
      if (name !== f.name) {
        def.fill(0, 8);
        def.set(encodeUtf16(name), 8);
      }
    } else {
      const type = NEW_TYPES[spec.kind];
      if (type === undefined) throw new Error(`a new field can't be a ${spec.kind} field`);
      def = new Uint8Array(FIELD_SIZE);
      setU16(def, 0, type);
      setU16(def, 6, spec.kind === "dimension" ? 5 : 0);
      def.set(encodeUtf16(name), 8);
      kind = spec.kind;
    }
    checkValue(kind, name, spec.value);
    setU16(def, 2, off);
    defs.push(def);
    off += sizeOf(kind);
  }
  const head = d.slice(0, FIELDS_AT);
  setU16(head, FIELD_COUNT, specs.length);
  const out = concat([head, ...defs]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** How a field of Vectorworks' type `type` holds its value; null for types Rodeo doesn't read. */
export function fieldKind(type: number): FieldKind | null {
  return KINDS[type] ?? null;
}

/**
 * The format record `d` holding a plug-in's parameters (+0x58 = 1, flag bit 0 set, as most of the
 * demos' plug-in formats have) with these fields, each of its own type, laid out as a new data
 * field is; dimensions and coordinates take number format 5, as data dimensions do.
 */
export function encodePluginFormat(d: Uint8Array, specs: readonly PluginFieldSpec[]): Uint8Array {
  const defs: Uint8Array[] = [];
  let off = 0;
  for (const spec of specs) {
    const kind = KINDS[spec.type];
    if (!kind) throw new Error(`a plug-in parameter can't be of type ${spec.type}`);
    checkFieldName(spec.name, { name: spec.name, kind, value: spec.value }, specs.map((s) => ({ name: s.name, kind: KINDS[s.type] ?? "text", value: s.value })));
    checkValue(kind, spec.name, spec.value);
    const def = new Uint8Array(FIELD_SIZE);
    setU16(def, 0, spec.type);
    setU16(def, 2, off);
    setU16(def, 6, kind === "dimension" ? 5 : 0);
    def.set(encodeUtf16(spec.name), 8);
    defs.push(def);
    off += sizeOf(kind);
  }
  const head = d.slice(0, FIELDS_AT);
  setU16(head, FIELD_COUNT, specs.length);
  setU16(head, FORMAT_PLUGIN, 1);
  setU16(head, FORMAT_PLUGIN + 2, u16(head, FORMAT_PLUGIN + 2) | 1);
  const out = concat([head, ...defs]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/**
 * A record of format `fmt` holding `values` (in field order), keeping `d`'s header and whether
 * it lists its per-field bytes. With `old` (`d`'s format) and `from` (each field's index there,
 * or −1 for a new one), a kept field starts from its old bytes, so a real keeps its spare two.
 */
export function encodeRecord(d: Uint8Array, fmt: FormatDef, values: readonly RecordValue[], old?: FormatDef, from?: readonly number[]): Uint8Array {
  if (d.length < RECORD_FLAGS) throw new Error("not a record");
  const n = u16(d, RECORD_COUNT) === 0 ? 0 : fmt.fields.length;
  const fixed = fmt.fields.reduce((m, f) => Math.max(m, f.off + sizeOf(f.kind!)), 0);
  const at = RECORD_FLAGS + n;
  const head = new Uint8Array(at + fixed);
  head.set(d.subarray(0, RECORD_COUNT));
  setU16(head, RECORD_COUNT, n);
  const pool: Uint8Array[] = [];
  let next = fixed;
  const was = old ? valuesAt(d) : 0;
  fmt.fields.forEach((f, i) => {
    const kind = f.kind!;
    const v = checkValue(kind, f.name, values[i]);
    const o = at + f.off;
    const g = old && from && from[i] >= 0 ? old.fields[from[i]] : undefined;
    if (g && was + g.off + sizeOf(kind) <= d.length) {
      head.set(d.subarray(was + g.off, was + g.off + sizeOf(kind)), o);
      // an unchanged value keeps its bytes as they were (a true stored as other than 1, say)
      const same = REAL.has(kind)
        ? f64(head, o) === v
        : kind === "boolean"
          ? (u16(head, o) !== 0) === v
          : kind === "color"
            ? u16(head, o) === v
            : !TEXT.has(kind) && i32(head, o) === v;
      if (same) return;
    }
    if (TEXT.has(kind)) {
      const s = encodeUtf16(v as string);
      setU32(head, o, s.length);
      setU32(head, o + 4, next);
      pool.push(s);
      next += s.length;
    } else if (REAL.has(kind)) setF64(head, o, v as number);
    else if (kind === "boolean") setU16(head, o, v ? 1 : 0);
    else if (kind === "color") setU16(head, o, v as number);
    else setI32(head, o, v as number);
  });
  const out = concat([head, ...pool]);
  setU64(out, 0, BigInt(out.length));
  return out;
}
