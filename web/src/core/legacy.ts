// Bodies that are not Snappy chunks: Vectorworks 2013 files (and, untested, 2014 to 2017 files
// with the 2018+ record header but no compression). container.ts asks here first; a body that
// starts as neither layout below is read as Snappy chunks, as before.
//
// A 2013 body is the record stream itself, uncompressed, with narrower records: u32 sizes and
// pointers, a 0x28-byte header and no GUID, and the body from +0x28 where 2018+ has it from
// +0x50. Measured on a 2013 file of 8,602 records: every size lands exactly on the next record,
// every next-sibling mark is 0x05792ca4 or 0, and +0x0c is 0 throughout.
//
//   2013          2018+         field
//   +0x00 u32     +0x00 u64     size
//   +0x04 u32     +0x08 u64     next-sibling mark
//   +0x08 u32     +0x10 u64     aux-list pointer
//   +0x0c u8      +0x18 u8      (0 in all 8,602)
//   +0x0d u8      +0x19 u8      object type
//   +0x0e u16     +0x1a u16     name index
//   +0x10 3 B     +0x1c 3 B     (zero in all but 2 of 8,602)
//   +0x13 u8      +0x1f u8      flags
//   +0x14 u32     +0x20 u32     class index
//   +0x18 u16     +0x24 u16     by-class flags
//   +0x1a u32     +0x26 u64     owner pointer
//   +0x1e 10 B    +0x2e 10 B    copied across (what they hold is not known)
//   (none)        +0x38 16 B    GUID: made here from the record's place and header
//   +0x28 ...     +0x50 ...     body, converted per type (legacyDoc.ts, legacyShapes.ts)
//
// A terminator's body is a u32 (2018+: a u64), so it is widened with zeros. Records are made
// 2018+ records in memory; saving writes them as Snappy chunks under a 2018+ header (legacyHeader).
//
// Units: the 2013 settings block keeps its length unit as ASCII text ("Feet & Inches"), not the
// UTF-16 settings.ts reads, so the name is found by looking for the unit names in it.

import { blankHeader } from "./blank.ts";
import { docBody } from "./legacyDoc.ts";
import { shapeBody, shapeType } from "./legacyShapes.ts";
import { setU32, setU64, u32 } from "./bytes.ts";
import { LENGTH_UNITS, unitsName, unitsPatch } from "./settings.ts";

const NARROW_HEAD = 0x28;
const WIDE_HEAD = 0x50;
const MARK = 0x05792ca4;
const TERMINATOR = 0;
/** where the settings block starts (the units are inside it) */
const SETTINGS = 0x94;
/** unit names longest first, so "Feet & Inches" is read before "Feet" */
const UNIT_NAMES = [...LENGTH_UNITS].sort((a, b) => b.length - a.length);

/**
 * What a converter makes of a 2013 record's body (from its +0x28): the 2018+ body (from +0x50), null
 * to leave the record out, or undefined when the type isn't one it converts.
 */
export type BodyConversion = Uint8Array | null | undefined;

/** The layouts a body can have that are not Snappy chunks. */
export type LegacyLayout = "narrow" | "wide";

function isLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function markOk(v: number): boolean {
  return v === MARK || v === 0;
}

/**
 * The layout a body starts in, from its first 16 bytes (fewer when the file is that short): wide
 * when its first record has a u64 size of at least 0x50 and a 2018+ mark (its u32 at +0x04 is the
 * size's high half, 0, which is also a narrow record's "last in list" mark, so this is tested
 * first; a narrow record passes it only as a terminator, and those are shorter than 0x50), narrow
 * when its first record has a u32 size of at least 0x28 and a 2013 mark. Null otherwise, so a
 * Snappy body (whose first u32 is a chunk size and whose second starts a Snappy block, neither a
 * mark) is never taken here.
 */
export function legacyStart(first: Uint8Array): LegacyLayout | null {
  if (first.length >= 16 && u32(first, 4) === 0 && u32(first, 0) >= WIDE_HEAD && u32(first, 12) === 0 && markOk(u32(first, 8))) {
    return "wide";
  }
  if (first.length >= 8 && u32(first, 0) >= NARROW_HEAD && markOk(u32(first, 4))) return "narrow";
  return null;
}

/**
 * The whole body as 2018+ records, when it is the layout `layout` from its first record to its
 * end (the sizes must land exactly on the end); null when it isn't.
 */
export function legacyRecords(layout: LegacyLayout, body: Uint8Array): Uint8Array[] | null {
  return layout === "narrow" ? narrowRecords(body) : wideRecords(body);
}

function narrowRecords(body: Uint8Array): Uint8Array[] | null {
  const recs: Uint8Array[] = [];
  for (let p = 0; p < body.length; ) {
    if (p + 8 > body.length) return null;
    const size = u32(body, p);
    if (size < NARROW_HEAD || p + size > body.length || !markOk(u32(body, p + 4))) return null;
    recs.push(body.subarray(p, p + size));
    p += size;
  }
  return convert(recs);
}

/** Types whose 2013 bodies are read as they are: aux data (tagged dictionaries), the symbol library and its folders (Rodeo reads only their names and what they hold). */
const SAME_BODY = new Set([76, 54, 92]);
/** Types neither converter takes that Rodeo reads (worksheets, textures, preview images, wall styles): left out with what they hold. */
const LEFT_OUT = new Set([18, 97, 119, 127]);

/**
 * The 2013 records `recs` as 2018+ records, each body converted by legacyDoc.ts or legacyShapes.ts.
 * A record they leave out (null) or of a LEFT_OUT type is dropped with everything under it; one of
 * a type neither converts is kept as it is when SAME_BODY names it or it holds others (Rodeo reads
 * such containers only for what they hold), else dropped, so no 2013 body is read as a 2018+ one
 * where Rodeo reads it. When a dropped record closed its list's aux part (next mark 0), the record
 * before it in the same list takes the 0. The tree is walked as records.ts buildTree walks it, from
 * the 2013 owner pointers.
 */
function convert(recs: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  const stack: { owner: number; last: Uint8Array | null }[] = [];
  /** while a dropped record's subtree is being skipped, the depth of the list that record was in */
  let skipping = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const type = rec[0x0d];
    const owner = u32(rec, 0x1a);
    if (stack.length > 0 && stack[stack.length - 1].owner === owner) {
      // in the current list
    } else if (stack.some((e) => e.owner === owner)) {
      while (stack[stack.length - 1].owner !== owner) stack.pop();
    } else {
      stack.push({ owner, last: null });
    }
    if (skipping && stack.length <= skipping) skipping = 0;
    if (skipping) {
      if (type === TERMINATOR) stack.pop();
      continue;
    }
    const list = stack[stack.length - 1];
    const next = recs[i + 1];
    // the next record opens a list of this one's when its owner is on no list yet
    const parent = next !== undefined && type !== TERMINATOR && !stack.some((e) => e.owner === u32(next, 0x1a));
    const old = rec.subarray(NARROW_HEAD);
    let made: BodyConversion = old;
    if (type !== TERMINATOR) {
      const doc = docBody(type, old);
      made = doc !== undefined ? doc : shapeBody(type, old);
      if (made === undefined) made = LEFT_OUT.has(type) ? null : SAME_BODY.has(type) || parent ? old : null;
    }
    if (made == null) {
      if (u32(rec, 0x04) === 0 && list.last) setU64(list.last, 0x08, 0n);
      if (parent) skipping = stack.length;
    } else {
      const wide = widen(rec, out.length, made);
      wide[0x19] = shapeType(type);
      out.push(wide);
      list.last = wide;
    }
    if (type === TERMINATOR) stack.pop();
  }
  return out;
}

/** A body of u64-sized records with 2018+ headers, uncompressed: its records as they are. */
function wideRecords(body: Uint8Array): Uint8Array[] | null {
  const out: Uint8Array[] = [];
  for (let p = 0; p < body.length; ) {
    if (p + 8 > body.length) return null;
    const size = u32(body, p);
    if (u32(body, p + 4) !== 0 || size < WIDE_HEAD || p + size > body.length) return null;
    out.push(body.slice(p, p + size));
    p += size;
  }
  return out;
}

/** A 2013 record's header over `body` (its 2018+ body) as a 2018+ record; `index` is its place in the stream. */
function widen(rec: Uint8Array, index: number, body: Uint8Array): Uint8Array {
  const extra = rec[0x0d] === TERMINATOR && body.length === 4 ? 4 : 0;
  const out = new Uint8Array(WIDE_HEAD + body.length + extra);
  setU64(out, 0x00, BigInt(out.length));
  setU64(out, 0x08, BigInt(u32(rec, 0x04)));
  setU64(out, 0x10, BigInt(u32(rec, 0x08)));
  out.set(rec.subarray(0x0c, 0x0d), 0x18);
  out.set(rec.subarray(0x0d, 0x0e), 0x19);
  out.set(rec.subarray(0x0e, 0x10), 0x1a);
  out.set(rec.subarray(0x10, 0x13), 0x1c);
  out.set(rec.subarray(0x13, 0x14), 0x1f);
  out.set(rec.subarray(0x14, 0x18), 0x20);
  out.set(rec.subarray(0x18, 0x1a), 0x24);
  setU64(out, 0x26, BigInt(u32(rec, 0x1a)));
  out.set(rec.subarray(0x1e, 0x28), 0x2e);
  out.set(guidOf(index, rec), 0x38);
  out.set(body, WIDE_HEAD);
  return out;
}

/**
 * A GUID for a record that has none: four FNV-1a hashes of its 2013 header, each started from the
 * record's place in the stream, so no two records of a drawing share one and the same file gives
 * the same ones every time it opens.
 */
function guidOf(index: number, rec: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
    for (let i = 0; i < NARROW_HEAD; i++) h = Math.imul(h ^ rec[i], 0x01000193) >>> 0;
    setU32(out, 4 * k, h);
  }
  return out;
}

/** The name of a length unit written as ASCII in a settings block, or null when none is. */
function asciiUnits(file: Uint8Array): string | null {
  for (let p = SETTINGS; p < file.length; p++) {
    if (isLetter(file[p - 1] ?? 0)) continue;
    for (const name of UNIT_NAMES) {
      const end = p + name.length;
      if (end > file.length || (end < file.length && isLetter(file[end]))) continue;
      let i = 0;
      while (i < name.length && file[p + i] === name.charCodeAt(i)) i++;
      if (i === name.length) return name;
    }
  }
  return null;
}

/**
 * The 2018+ container header for a legacy drawing, and its length unit. The header is Rodeo's
 * blank one (blank.ts) with the units of `file` (the legacy file's own header bytes, settings block
 * included) written over it. A file whose units can't be found is read as millimetres.
 */
export function legacyHeader(file: Uint8Array): { header: Uint8Array; units: string } {
  const found = unitsName(file) ?? asciiUnits(file);
  const units = found !== null && LENGTH_UNITS.includes(found) ? found : "Millimeters";
  const header = blankHeader(units === "Feet & Inches" ? "ftin" : "mm");
  const patch = unitsPatch(header, units);
  header.set(patch.bytes, patch.at);
  return { header, units };
}

/** The year a file's saved-with version names (VW18 is 2013: the year is the major version + 1995), or null. */
export function savedYear(savedWith: string): number | null {
  const m = /^VW(\d+)/.exec(savedWith);
  return m ? 1995 + Number(m[1]) : null;
}

/**
 * The message for a file whose body reads as neither layout nor Snappy, when it was saved before
 * 2013 or in 2014 to 2017 (those years Rodeo doesn't read yet). Null for the other years, whose
 * errors are the reader's own.
 */
export function unreadableMessage(savedWith: string): string | null {
  const year = savedYear(savedWith);
  if (year === null || year === 2013 || year >= 2018) return null;
  if (year < 2013) return `This file was saved by Vectorworks ${year}, which Rodeo can't read yet: save it from Vectorworks 2013 or newer.`;
  return `This file was saved by Vectorworks ${year}, which Rodeo can't read yet: save it from Vectorworks 2018 or newer.`;
}
