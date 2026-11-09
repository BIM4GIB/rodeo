// Units: a drawing split into the pieces branches compare and merge. Every top-level record is a
// unit, except that layers, the class list, the symbol library and symbol folders are split into a
// shell (the record and its aux records) and one unit per item in them. A unit is a record and its
// whole subtree, named by its GUID. Fingerprints skip the bytes that only say where a record sits,
// so a unit that moves in the file keeps its hash. DOM-free: bytes in, bytes out.

import { readContainer, writeContainer } from "../../core/container.ts";
import { buildTree, joinRecords, Rec, splitRecords } from "../../core/records.ts";
import { auxCount, layerNameAt, MATERIAL_AT, MATERIAL_TYPES, readStr, subtreeEnd } from "../../core/model.ts";
import { readNameTable, writeNameTable } from "../../core/names.ts";
import { textStyleAt } from "../../core/geometry.ts";
import { ATTR_END } from "../../core/attrs.ts";
import { i16, i32, setI16, setI32, setU16, setU32, setU64, u16, u32, u64 } from "../../core/bytes.ts";

/** Container types whose items are units of their own: layer, class list, symbol library, symbol folder. */
export const SPLIT_TYPES: ReadonlySet<number> = new Set([31, 57, 54, 92]);
/** The key of the name table (type 55) unit; it is merged entry by entry, never compared as bytes. */
export const NAMES_KEY = "names";
/** Types that a drawing holds by name: class, symbol definition, record format, hatch, line type, texture, text style, wall style, material, symbol folder. */
export const RESOURCE_TYPES: ReadonlySet<number> = new Set([94, 16, 47, 66, 96, 97, 109, 127, 19, 92]);
/** Types holding name indices at places Rodeo can't renumber yet: viewport, worksheet, worksheet image. */
export const UNSAFE_RENUMBER_TYPES: ReadonlySet<number> = new Set([122, 18, 56]);
/** Types with the attribute block at +0x50 (FORMAT.md 4.2): drawables and classes. */
const ATTR_TYPES: ReadonlySet<number> = new Set([2, 3, 5, 6, 10, 11, 13, 14, 15, 21, 24, 25, 38, 68, 71, 84, 86, 94, 113]);
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";
/** Owner and saved-pointer values at or above this are not heap addresses, so they are never renumbered. */
const ADDRESS_LIMIT = 0x7f00_0000_0000n;

/** The kind of thing a unit is. */
export type UnitKind = "object" | "layer" | "class" | "symbol" | "resource" | "settings";

export interface Unit {
  /** the root record's GUID; "names" for the name table; "#<type>:<listKey>:<n>" when the GUID is zero or already taken */
  readonly key: string;
  /** "" for the top level, else the key of the split container it sits in */
  readonly parent: string;
  /** index of its root record in Units.recs */
  readonly start: number;
  /** index of its last record (subtreeEnd of the root), inclusive */
  readonly end: number;
  /** +0x19 of its root record */
  readonly type: number;
  /** hashSpan over its records; for a split container over its shell only (the record and its aux records) */
  readonly hash: string;
  readonly split: boolean;
}

export interface Shell {
  /** index of its last aux record's last record, or the container's own index when it has none */
  readonly auxEnd: number;
  /** index of its terminator (type 0), or null */
  readonly term: number | null;
  /** the owner value (+0x26) its children carry */
  readonly owner: bigint;
}

/** A drawing split into units, with the indexes that comparing and writing need. */
export interface Units {
  readonly header: Uint8Array;
  readonly recs: Rec[];
  readonly roots: Rec[];
  /** the name table; empty when there is none */
  readonly names: ReadonlyMap<number, string>;
  readonly units: ReadonlyMap<string, Unit>;
  /** list key ("" = top level, else a split container's key) to the unit keys in it, in order */
  readonly lists: ReadonlyMap<string, readonly string[]>;
  /** split containers' shells by key */
  readonly shells: ReadonlyMap<string, Shell>;
  /** every name index used anywhere: table keys, every record's +0x1a, and +0x20 below 0x1000000 */
  readonly used: ReadonlySet<number>;
  /** for each name index, the record types that carry it at +0x1a */
  readonly nameTypes: ReadonlyMap<number, ReadonlySet<number>>;
  /** the highest index in `used` (0 when none) */
  readonly topName: number;
}

/** One unit to write, and the drawing it comes from. */
export interface Placed {
  readonly key: string;
  /** the drawing the unit's records come from */
  readonly from: Units;
}

/** What to write: the units in order, and how names are handled. */
export interface WritePlan {
  /** the drawing whose header, addresses and top-level owner the output keeps */
  readonly home: Units;
  /** list key ("" = top level) to the units in it, in order; a split container's list must be here when the container is placed */
  readonly lists: ReadonlyMap<string, readonly Placed[]>;
  /** the name table to write, or null to keep home's record as it is */
  readonly names: ReadonlyMap<number, string> | null;
  /** name index renumbering for records taken from a drawing other than home */
  readonly renumber: ReadonlyMap<number, number>;
}

/** Splits a .vwx drawing into units. */
export function readUnits(bytes: Uint8Array): Units {
  const c = readContainer(bytes);
  const recs = splitRecords(c.raw);
  const roots = buildTree(recs);
  const nameRec = roots.find((r) => r.type === 55);
  const names: ReadonlyMap<number, string> = nameRec ? readNameTable(nameRec) : new Map();

  const used = new Set<number>(names.keys());
  const nameTypes = new Map<number, Set<number>>();
  for (const r of recs) {
    if (r.data.length < 0x24) continue;
    const ni = u16(r.data, 0x1a);
    if (ni) {
      used.add(ni);
      let types = nameTypes.get(ni);
      if (!types) {
        types = new Set<number>();
        nameTypes.set(ni, types);
      }
      types.add(r.type);
    }
    const ci = u32(r.data, 0x20);
    if (ci > 0 && ci < 0x1000000) used.add(ci);
  }
  // a loop, not Math.max(...used): spreading a big set overflows the call stack
  let topName = 0;
  for (const v of used) if (v > topName) topName = v;

  const units = new Map<string, Unit>();
  const shells = new Map<string, Shell>();
  const lists = new Map<string, readonly string[]>();

  // units are set before their items are walked, so a duplicate GUID inside a container falls back to a # key
  const walk = (listKey: string, items: readonly Rec[]): void => {
    const keys: string[] = [];
    let n = 0;
    for (const r of items) {
      const guid = r.guid;
      const key = r.type === 55 && !units.has(NAMES_KEY) ? NAMES_KEY
        : guid !== ZERO_GUID && !units.has(guid) ? guid
        : `#${r.type}:${listKey}:${n++}`;
      if (SPLIT_TYPES.has(r.type) && r.children.length > 0) {
        const ch = r.children;
        const k = auxCount(r);
        const last = ch[ch.length - 1];
        const term = last.type === 0 ? last : null;
        const aux = ch.slice(0, k);
        const inner = ch.slice(k, term ? ch.length - 1 : ch.length);
        const auxEnd = aux.length ? subtreeEnd(aux[aux.length - 1]) : r.index;
        units.set(key, { key, parent: listKey, start: r.index, end: subtreeEnd(r), type: r.type, hash: hashSpan(recs, r.index, auxEnd), split: true });
        shells.set(key, { auxEnd, term: term ? term.index : null, owner: ch[0].owner });
        keys.push(key);
        walk(key, inner);
      } else {
        const e = subtreeEnd(r);
        units.set(key, { key, parent: listKey, start: r.index, end: e, type: r.type, hash: hashSpan(recs, r.index, e), split: false });
        keys.push(key);
      }
    }
    lists.set(listKey, keys);
  };
  walk("", roots);

  return { header: c.header, recs, roots, names, units, lists, shells, used, nameTypes, topName };
}

/** The fingerprint of records from..to (inclusive): 16 hex digits. */
export function hashSpan(recs: readonly Rec[], from: number, to: number): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x41c6ce57 | 0;
  for (let i = from; i <= to; i++) {
    const d = recs[i].data;
    // size, next marker and saved pointer (+0x00..+0x17) and the owner (+0x26..+0x2d) change with
    // where a record sits, not with what it is
    for (let k = 0x18; k < 0x26 && k < d.length; k++) { h1 = Math.imul(h1 ^ d[k], 0x9e3779b1); h2 = Math.imul(h2 ^ d[k], 0x85ebca77); }
    for (let k = 0x2e; k < d.length; k++) { h1 = Math.imul(h1 ^ d[k], 0x9e3779b1); h2 = Math.imul(h2 ^ d[k], 0x85ebca77); }
    h1 = Math.imul(h1 ^ (d.length & 0xffff), 0x9e3779b1);
    h2 = Math.imul(h2 ^ (d.length >>> 16), 0x85ebca77);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** A unit by key; throws when the drawing has none. */
function unitOf(u: Units, key: string): Unit {
  const x = u.units.get(key);
  if (!x) throw new Error(`unit ${key} is missing`);
  return x;
}

/** The kind of thing a unit is, by its type and the container it sits in. */
export function whatOf(u: Units, key: string): UnitKind {
  const x = unitOf(u, key);
  if (x.type === 31) return "layer";
  if (u.units.get(x.parent)?.type === 31) return "object";
  if (x.type === 94) return "class";
  if (x.type === 16) return "symbol";
  if (x.parent === "") return "settings";
  return "resource";
}

/** The state three-way decisions compare: "hash@parent", or "-" when the drawing lacks the unit. */
export function stateOf(u: Units, key: string): string {
  const x = u.units.get(key);
  return x ? `${x.hash}@${x.parent}` : "-";
}

/** Object units only (items of layers): key to "hash@parent#name", for blame. */
export function prints(u: Units): Map<string, string> {
  const out = new Map<string, string>();
  for (const x of u.units.values()) {
    if (whatOf(u, x.key) !== "object") continue;
    const name = u.names.get(u16(u.recs[x.start].data, 0x1a)) ?? "";
    out.set(x.key, `${x.hash}@${x.parent}#${name}`);
  }
  return out;
}

/**
 * Writes a drawing from units of up to three drawings, re-addressing those not from home. A unit
 * from home is copied as it is. A unit from elsewhere gets fresh addresses for its owners and
 * saved pointers, so it can sit beside the units already in the drawing (FORMAT.md "Writing new
 * records").
 */
export function writeDocument(plan: WritePlan): Uint8Array {
  const out: Uint8Array[] = [];

  // fresh addresses sit above every owner and saved pointer of the drawings the output takes from
  let max = 0n;
  const sources = new Set<Units>([plan.home]);
  for (const list of plan.lists.values()) for (const p of list) sources.add(p.from);
  for (const from of sources) {
    for (const r of from.recs) {
      const owner = r.owner;
      if (owner < ADDRESS_LIMIT && owner > max) max = owner;
      const ptr = r.ptr10;
      if (ptr < ADDRESS_LIMIT && ptr > max) max = ptr;
    }
  }
  let next = ((max >> 4n) + 0x10000n) << 4n;
  const fresh = (): bigint => (next += 0x40n);

  const topOwner = plan.home.roots[0].owner;
  emitList("", topOwner);

  function emitList(listKey: string, listOwner: bigint): void {
    for (const { key, from } of plan.lists.get(listKey) ?? []) {
      const u = from.units.get(key);
      if (!u) throw new Error(`unit ${key} is missing`);
      if (key === NAMES_KEY) emitNames(u, from, listOwner);
      else if (u.split) emitContainer(u, from, listOwner);
      else emitSpan(from, u.start, u.end, listOwner, new Map());
    }
  }

  // a span of records. When rootOwner is given, the record at `start` is a root that goes into a
  // list owned by it; otherwise every record in the span is a child, and its owners are mapped.
  function emitSpan(from: Units, start: number, end: number, rootOwner: bigint | null, map: Map<bigint, bigint>): void {
    for (let i = start; i <= end; i++) {
      const src = from.recs[i].data;
      if (from === plan.home) {
        if (i === start && rootOwner !== null && u64(src, 0x26) !== rootOwner) {
          const d = src.slice();
          setU64(d, 0x26, rootOwner);
          out.push(d);
        } else out.push(src);
        continue;
      }
      const d = src.slice();
      if (i === start && rootOwner !== null) setU64(d, 0x26, rootOwner);
      else {
        // siblings share an owner, so each old owner maps to one fresh owner across the span
        const ow = u64(d, 0x26);
        let mapped = map.get(ow);
        if (mapped === undefined) {
          mapped = fresh();
          map.set(ow, mapped);
        }
        setU64(d, 0x26, mapped);
      }
      if (u64(d, 0x10) !== 0n) setU64(d, 0x10, fresh());
      if (plan.renumber.size) renumberNames(d, plan.renumber);
      out.push(d);
    }
  }

  function emitContainer(u: Unit, from: Units, listOwner: bigint): void {
    const sh = from.shells.get(u.key);
    if (!sh) throw new Error(`container ${u.key} has no shell`);
    const childOwner = from === plan.home ? sh.owner : fresh();
    // the shell's aux records and terminator follow childOwner
    const map = new Map<bigint, bigint>([[sh.owner, childOwner]]);
    emitSpan(from, u.start, sh.auxEnd, listOwner, map);
    emitList(u.key, childOwner);
    if (sh.term !== null) emitSpan(from, sh.term, sh.term, childOwner, map);
  }

  function emitNames(u: Unit, from: Units, listOwner: bigint): void {
    if (plan.names === null) {
      emitSpan(from, u.start, u.end, listOwner, new Map());
      return;
    }
    const rec = new Rec(from.recs[u.start].data.slice());
    writeNameTable(rec, new Map(plan.names));
    if (from !== plan.home || u64(rec.data, 0x26) !== listOwner) setU64(rec.data, 0x26, listOwner);
    if (from !== plan.home && u64(rec.data, 0x10) !== 0n) setU64(rec.data, 0x10, fresh());
    out.push(rec.data);
    // the table's children are its own list, not a list of roots, so none is treated as a root
    if (u.end > u.start) emitSpan(from, u.start + 1, u.end, null, new Map());
  }

  // joinRecords rewrites each record's size with its own length, which the copies already carry
  return writeContainer(plan.home.header, joinRecords(out.map((d) => new Rec(d))));
}

/** The plan that writes `u` back out as it is. */
export function identityPlan(u: Units): WritePlan {
  const lists = new Map<string, readonly Placed[]>();
  for (const [listKey, keys] of u.lists) lists.set(listKey, keys.map((key) => ({ key, from: u })));
  return { home: u, lists, names: null, renumber: new Map() };
}

/** `u` with only the objects (items of layers) in `keep`; everything else (layers, classes, symbols, settings) stays. */
export function keepOnly(u: Units, keep: ReadonlySet<string>): Uint8Array {
  const plan = identityPlan(u);
  const lists = new Map<string, readonly Placed[]>();
  for (const [listKey, items] of plan.lists) {
    const inLayer = u.units.get(listKey)?.type === 31;
    lists.set(listKey, inLayer ? items.filter((p) => keep.has(p.key)) : items);
  }
  return writeDocument({ ...plan, lists });
}

/** Renumbers a name index stored as a u16 or u32 at `at`; 0 is unnamed and is left alone. */
function renumberU16(d: Uint8Array, at: number, map: ReadonlyMap<number, number>): void {
  if (at + 2 > d.length) return;
  const old = u16(d, at);
  const to = old === 0 ? undefined : map.get(old);
  if (to !== undefined) setU16(d, at, to);
}

/** Renumbers a name index stored as a u32 at `at`; 0 is unnamed and is left alone. */
function renumberU32(d: Uint8Array, at: number, map: ReadonlyMap<number, number>): void {
  if (at + 4 > d.length) return;
  const old = u32(d, at);
  const to = old === 0 ? undefined : map.get(old);
  if (to !== undefined) setU32(d, at, to);
}

/** Renumbers a positive i32 name index at `at`, such as a class's texture or a text's style; 0 and below mean none. */
function renumberPositive(d: Uint8Array, at: number, map: ReadonlyMap<number, number>): void {
  if (at + 4 > d.length) return;
  const old = i32(d, at);
  const to = old > 0 ? map.get(old) : undefined;
  if (to !== undefined) setI32(d, at, to);
}

/** Renumbers an i32 that holds −n for a line type named n, at `at`. */
function renumberNegative32(d: Uint8Array, at: number, map: ReadonlyMap<number, number>): void {
  if (at + 4 > d.length) return;
  const v = i32(d, at);
  const to = v < 0 ? map.get(-v) : undefined;
  if (to !== undefined) setI32(d, at, -to);
}

/** Renumbers an i16 that holds −n for a hatch, tile or gradient named n, at `at`. */
function renumberNegative16(d: Uint8Array, at: number, map: ReadonlyMap<number, number>): void {
  if (at + 2 > d.length) return;
  const v = i16(d, at);
  const to = v < 0 ? map.get(-v) : undefined;
  if (to !== undefined) setI16(d, at, -to);
}

/**
 * Rewrites name indices in one record (a copy) by `map`, at every place Rodeo knows a record names
 * something. Each place has a bounds check, so a short record is left alone.
 */
export function renumberNames(d: Uint8Array, map: ReadonlyMap<number, number>): void {
  const t = d[0x19];
  if (d.length >= 0x24) {
    renumberU16(d, 0x1a, map); // the header's name index (FORMAT.md 2)
    renumberU32(d, 0x20, map); // the header's class index (FORMAT.md 2)
  }
  if (ATTR_TYPES.has(t) && d.length >= ATTR_END) {
    renumberNegative32(d, 0x50, map); // the line style: −n is the line type named n (FORMAT.md 4.2)
    renumberNegative16(d, 0x64, map); // the fill: −n is the hatch, tile or gradient named n (FORMAT.md 4.2)
  }
  if (MATERIAL_TYPES.has(t)) renumberU32(d, MATERIAL_AT, map); // the material resource (FORMAT.md 4.2)
  if (t === 15) renumberU16(d, 0x8e, map); // a symbol instance names its symbol definition (FORMAT.md 4, type 15)
  if (t === 48) renumberU16(d, 0x50, map); // a data record names its record format (FORMAT.md 7.3)
  if (t === 68) renumberU32(d, 0xf7, map); // a wall names its wall style (FORMAT.md 4, type 68)
  if (t === 31) renumberU16(d, 0xf4, map); // a design layer names its story (FORMAT.md 5)
  if (t === 94) {
    renumberPositive(d, 0x9e, map); // a class's RenderWorks texture (FORMAT.md 6)
    renumberPositive(d, 0xb8, map); // a class's text style (FORMAT.md 6)
  }
  if (t === 71) renumberU32(d, 0x104, map); // a slab names its slab style (FORMAT.md 4, type 71)
  if (t === 10) renumberPositive(d, textStyleAt(d), map); // a text names its text style (FORMAT.md 4.1)
}

/** True when the unit's records include a type in UNSAFE_RENUMBER_TYPES. */
export function holdsUnsafe(u: Units, key: string): boolean {
  const x = unitOf(u, key);
  for (let i = x.start; i <= x.end; i++) if (UNSAFE_RENUMBER_TYPES.has(u.recs[i].type)) return true;
  return false;
}

/** A layer unit's name (stored in the layer record, not the name table); "" for anything else. */
export function layerName(u: Units, key: string): string {
  const x = u.units.get(key);
  if (!x || x.type !== 31) return "";
  const d = u.recs[x.start].data;
  return readStr(d, layerNameAt(d))[0];
}
