// Vectorworks 2013 bodies of the document's own records (name table, classes, layers, fonts and
// the like) as their 2018+ bodies. legacy.ts calls docBody for every 2013 record but terminators.
//
// The 2013 body is the record from +0x28 and the 2018+ body the record from +0x50; a 2013 record
// offset X is body offset X - 0x28 and a 2018+ one X - 0x50 (the functions below work in record
// offsets, so the 2018+ writes read as FORMAT.md's). Each converter writes the fields it knows into a
// zeroed body of the 2018+ size (as blank.ts builds new records), so no byte of a 2013 record is
// copied where its 2018+ meaning differs.
//
//   55 name table   parsed entry by entry (see nameEntries); written as 2018+ UTF-16 entries
//   94 class        attributes at the 2018+ offsets (FORMAT.md §6); 188-byte record
//   57 class list   a zeroed list record (blank.ts's)
//   31 layer        vis, story, scale, view, elevation, kind, page, name and title (FORMAT.md §5)
//   80 palette      the 256 RGB16 entries, unchanged (both sizes: 0x28 or 0x50 + 1536)
//   74 font list    count and entries, names re-encoded (fonts.ts layout)
//   47 record fmt   fields re-laid out (type, offset, number format, UTF-16 name)
//   33 doc header   dropped: Rodeo does not read it (new drawings have none, blank.ts)
//   48 record data  dropped: its 2013 layout is not decoded (its values keep no meaning here)
//   anything else   undefined (shapeBody, or copied as it is)
//
// 8-bit text in 2013 files (names, sheet numbers, font names) is Mac OS Roman: in the one 2013 file
// measured, the only names with a byte past 0x7f use 0xA1 after a number of degrees, the degree sign
// in Mac OS Roman (an inverted exclamation mark in Windows-1252). See macRoman.

import type { BodyConversion } from "./legacy.ts";
import { encodeUtf16, f64, i16, setF64, setI16, setU16, setU32, u16, u32 } from "./bytes.ts";

/** where the 2013 body starts in its record, and the 2018+ body in its own */
const OLD = 0x28;
const NEW = 0x50;

/** Mac OS Roman, bytes 0x80 to 0xff (the 0x00 to 0x7f half is ASCII). */
const MAC_ROMAN_HIGH: readonly number[] = [
  0x00c4, 0x00c5, 0x00c7, 0x00c9, 0x00d1, 0x00d6, 0x00dc, 0x00e1, 0x00e0, 0x00e2, 0x00e4, 0x00e3, 0x00e5, 0x00e7, 0x00e9, 0x00e8,
  0x00ea, 0x00eb, 0x00ed, 0x00ec, 0x00ee, 0x00ef, 0x00f1, 0x00f3, 0x00f2, 0x00f4, 0x00f6, 0x00f5, 0x00fa, 0x00f9, 0x00fb, 0x00fc,
  0x2020, 0x00b0, 0x00a2, 0x00a3, 0x00a7, 0x2022, 0x00b6, 0x00df, 0x00ae, 0x00a9, 0x2122, 0x00b4, 0x00a8, 0x2260, 0x00c6, 0x00d8,
  0x221e, 0x00b1, 0x2264, 0x2265, 0x00a5, 0x00b5, 0x2202, 0x2211, 0x220f, 0x03c0, 0x222b, 0x00aa, 0x00ba, 0x03a9, 0x00e6, 0x00f8,
  0x00bf, 0x00a1, 0x00ac, 0x221a, 0x0192, 0x2248, 0x2206, 0x00ab, 0x00bb, 0x2026, 0x00a0, 0x00c0, 0x00c3, 0x00d5, 0x0152, 0x0153,
  0x2013, 0x2014, 0x201c, 0x201d, 0x2018, 0x2019, 0x00f7, 0x25ca, 0x00ff, 0x0178, 0x2044, 0x20ac, 0x2039, 0x203a, 0xfb01, 0xfb02,
  0x2021, 0x00b7, 0x201a, 0x201e, 0x2030, 0x00c2, 0x00ca, 0x00c1, 0x00cb, 0x00c8, 0x00cd, 0x00ce, 0x00cf, 0x00cc, 0x00d3, 0x00d4,
  0xf8ff, 0x00d2, 0x00da, 0x00db, 0x00d9, 0x0131, 0x02c6, 0x02dc, 0x00af, 0x02d8, 0x02d9, 0x02da, 0x00b8, 0x02dd, 0x02db, 0x02c7,
];

/** Text of 8-bit Mac OS Roman bytes. */
export function macRoman(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b < 0x80 ? b : MAC_ROMAN_HIGH[b - 0x80]);
  return s;
}

/** A 2018+ body's bytes for a record of `size` bytes in all (its header included), zeroed. */
function newBody(size: number): Uint8Array {
  return new Uint8Array(size - NEW);
}

/** The UTF-16 string `s` written at `at` as a u32 byte length and its bytes (2018+ text). */
function putText(out: Uint8Array, at: number, s: string): number {
  const bytes = encodeUtf16(s);
  setU32(out, at, bytes.length);
  out.set(bytes, at + 4);
  return at + 4 + bytes.length;
}

// ---- name table (55) -----------------------------------------------------------------------------

/** The 2013 name table's count at body +0x08 and its entries from +0x50 (record +0x30 and +0x78). */
const NT_COUNT = 0x08;
const NT_FIRST = 0x50;
/**
 * The most bytes an entry's variable block holds. The entries of the sample file parse into one
 * sequence of 419 entries for any limit from 60 to 65 bytes (and into two at 66 or more), so the
 * middle of that range is used; a file whose blocks run longer fails to parse rather than guess.
 */
const NT_MAX_BLOCK = 64;

interface NameStart {
  at: number;
  index: number;
  end: number;
}

/**
 * The 2013 name table's entries, read exactly: each is a u32 index, a u8 length and the name, then
 * a variable block whose size the file doesn't give (19 to 60 bytes in the sample). Every entry
 * boundary is a start that reads as an index in 1 to 0xffff, a length of 1 to 120 and a name of
 * printable or 8-bit bytes. The entries are the one run of starts that begins at +0x50, holds
 * exactly the count, and runs to the end of the body with each block at most NT_MAX_BLOCK bytes;
 * with more than one such run, or none, the table is refused.
 */
export function nameEntries(body: Uint8Array): { index: number; name: string }[] {
  const count = u32(body, NT_COUNT);
  const starts: NameStart[] = [];
  for (let q = NT_FIRST; q + 5 <= body.length; q++) {
    const index = u32(body, q);
    const len = body[q + 4];
    if (index < 1 || index > 0xffff || len < 1 || q + 5 + len > body.length) continue;
    let printable = true;
    for (let k = 0; k < len && printable; k++) {
      const c = body[q + 5 + k];
      printable = c >= 0x80 || (c >= 0x20 && c < 0x7f);
    }
    if (printable) starts.push({ at: q, index, end: q + 5 + len });
  }
  if (count === 0) return [];
  if (count > starts.length) throw new Error(`the name table has ${count} entries, but only ${starts.length} entry starts`);
  const gapOk = (gap: number) => gap >= 0 && gap <= NT_MAX_BLOCK;
  const succ: number[][] = starts.map((s, i) => {
    const out: number[] = [];
    for (let j = i + 1; j < starts.length && starts[j].at - s.end <= NT_MAX_BLOCK; j++) {
      if (gapOk(starts[j].at - s.end)) out.push(j);
    }
    return out;
  });
  // levels[k - 1][i]: the number of ways to read k entries from start i to the end of the body, capped at 2
  const first0 = new Uint8Array(starts.length);
  for (let i = 0; i < starts.length; i++) first0[i] = gapOk(body.length - starts[i].end) ? 1 : 0;
  const levels: Uint8Array[] = [first0];
  for (let k = 2; k <= count; k++) {
    const next = new Uint8Array(starts.length);
    for (let i = 0; i < starts.length; i++) {
      let w = 0;
      for (const j of succ[i]) w += levels[k - 2][j];
      next[i] = Math.min(2, w);
    }
    levels.push(next);
  }
  const first = starts.findIndex((s) => s.at === NT_FIRST);
  const total = first < 0 ? 0 : levels[count - 1][first];
  if (total === 0) throw new Error(`the name table does not read as ${count} entries`);
  if (total > 1) throw new Error(`the name table reads as more than one run of ${count} entries`);
  const out: { index: number; name: string }[] = [];
  let i = first;
  for (let k = count; k >= 1; k--) {
    const s = starts[i];
    out.push({ index: s.index, name: macRoman(body.subarray(s.at + 5, s.end)) });
    if (k === 1) break;
    i = succ[i].find((j) => levels[k - 2][j] > 0)!;
  }
  return out;
}

function nameTableBody(body: Uint8Array): Uint8Array {
  const entries = nameEntries(body);
  let size = 0x0c;
  for (const e of entries) size += 8 + 2 * e.name.length;
  const out = new Uint8Array(size);
  out.set(body.subarray(0, 8), 0);
  setU32(out, 8, entries.length);
  let at = 0x0c;
  for (const e of entries) {
    setU32(out, at, e.index);
    const bytes = encodeUtf16(e.name);
    setU32(out, at + 4, bytes.length);
    out.set(bytes, at + 8);
    at += 8 + bytes.length;
  }
  return out;
}

// ---- classes (94) and the class list (57) --------------------------------------------------------

/** a 2018+ class record is 188 bytes (its text style at +0xb8 ends it) */
const CLASS_SIZE = 0xbc;

function classBody(old: Uint8Array): Uint8Array {
  const out = newBody(CLASS_SIZE);
  const o = (x: number) => x - OLD;
  const w = (x: number) => x - NEW;
  setU16(out, w(0x52), u16(old, o(0x2a))); // fill foreground
  setU16(out, w(0x54), u16(old, o(0x2c))); // fill background
  setU16(out, w(0x56), u16(old, o(0x2e))); // pen foreground
  setU16(out, w(0x58), u16(old, o(0x30))); // pen background
  setU32(out, w(0x5a), u32(old, o(0x32))); // line style (i32: 0 none, 2 solid, -n a line type)
  out[w(0x5e)] = old[o(0x36)]; // line weight, mils (a u8 in both)
  setU16(out, w(0x60), old[o(0x38)]); // fill pattern (a u8 in 2013, an i16 here)
  out[w(0x65)] = old[o(0x3d)]; // fill opacity
  out[w(0x66)] = old[o(0x3e)]; // pen opacity
  out.set(old.subarray(o(0x40), o(0x40) + 10), w(0x68)); // start line marker
  out.set(old.subarray(o(0x4a), o(0x4a) + 10), w(0x72)); // end line marker
  setI16(out, w(0xb6), i16(old, o(0x6e))); // visibility: 0 visible, -1 hidden, 2 grayed
  // no RenderWorks texture (+0x9e) or text style (+0xb8) in 2013: both none (0)
  return out;
}

/** The class list (57): a zeroed list record as blank.ts makes one (its classes are its children). */
function classListBody(): Uint8Array {
  return newBody(0x9c);
}

// ---- layers (31) ---------------------------------------------------------------------------------

/**
 * A 2013 layer (764 bytes) as a 2018+ layer: the 2013 fields at their 2013 offsets (vis +0xdc,
 * story +0xf8, scale +0xfc, view matrix +0x16c, t +0x1b4, projection +0x1cc, render mode +0x1ce,
 * elevation +0x200, kind +0x236, page +0x240, the design name's u8 length at +0x9c and the sheet
 * title's at +0x27c) written at the 2018+ offsets (+0xd8, +0xf4, +0xf8, +0x168, +0x1b0, +0x1c8,
 * +0x1ca, +0x1fc, +0x23c, +0x246, and the name and title strings at +0x292).
 */
function layerBody(old: Uint8Array): Uint8Array {
  const o = (x: number) => x - OLD;
  const kind = old[o(0x236)];
  const nameLen = old[o(0x9c)];
  let name = macRoman(old.subarray(o(0x9c) + 1, o(0x9c) + 1 + nameLen));
  if (name.length === 0) name = kind === 2 ? "Sheet" : "Design Layer";
  const titleLen = kind === 2 ? old[o(0x27c)] : 0;
  const title = kind === 2 ? macRoman(old.subarray(o(0x27c) + 1, o(0x27c) + 1 + titleLen)) : "";
  const nameBytes = encodeUtf16(name).length;
  const titleBytes = encodeUtf16(title).length;
  // the layer's fixed part (to +0x292), then the name, the title and a 0 trailer
  const size = 0x292 + 4 + nameBytes + 4 + titleBytes + 4;
  const out = newBody(size);
  const w = (x: number) => x - NEW;
  setI16(out, w(0xd8), i16(old, o(0xdc)));
  setU16(out, w(0xf4), u16(old, o(0xf8)));
  setF64(out, w(0xf8), f64(old, o(0xfc)));
  for (let k = 0; k < 9; k++) setF64(out, w(0x168) + 8 * k, f64(old, o(0x16c) + 8 * k));
  for (let k = 0; k < 3; k++) setF64(out, w(0x1b0) + 8 * k, f64(old, o(0x1b4) + 8 * k));
  out[w(0x1c8)] = old[o(0x1cc)];
  out[w(0x1ca)] = old[o(0x1ce)];
  setF64(out, w(0x1fc), f64(old, o(0x200)));
  out[w(0x23c)] = kind;
  setF64(out, w(0x246), f64(old, o(0x240)));
  setF64(out, w(0x24e), f64(old, o(0x248)));
  let at = putText(out, w(0x292), name);
  putText(out, at, title);
  return out;
}

// ---- font list (74) ------------------------------------------------------------------------------

/** 2013 font entries are 262 bytes (u16 0, u16 id, u8 length, 8-bit name); 2018+ entries 518 (fonts.ts). */
const FONT_OLD = 262;
const FONT_NEW = 518;

function fontBody(old: Uint8Array): Uint8Array {
  const n = u16(old, 0);
  const out = new Uint8Array(2 + FONT_NEW * n);
  setU16(out, 0, n);
  for (let i = 0; i < n; i++) {
    const src = 2 + FONT_OLD * i;
    const dst = 2 + FONT_NEW * i;
    const len = Math.min(old[src + 4], 254);
    setU16(out, dst + 2, u16(old, src + 2));
    const bytes = encodeUtf16(macRoman(old.subarray(src + 5, src + 5 + len)));
    out.set(bytes, dst + 4);
    out[dst + 516] = 1;
  }
  return out;
}

// ---- record formats (47) -------------------------------------------------------------------------

/** 2013 field entries are 70 bytes (u16 type, u16 value offset, u16 number format, u8 length, 8-bit name); 2018+ are 136. */
const FIELD_OLD = 70;
const FIELD_NEW = 136;
const FIELDS_OLD = 0x0c;
const FIELDS_NEW = 0x10;

function formatBody(old: Uint8Array): Uint8Array {
  const n = u16(old, 0);
  const out = new Uint8Array(FIELDS_NEW + FIELD_NEW * n);
  setU16(out, 0, n);
  setU16(out, 8, u16(old, 0x30 - OLD)); // 1 for a plug-in's parameters, 0 for a data record
  setU16(out, 0x0a, u16(old, 0x32 - OLD)); // flags
  for (let i = 0; i < n; i++) {
    const src = FIELDS_OLD + FIELD_OLD * i;
    const dst = FIELDS_NEW + FIELD_NEW * i;
    setU16(out, dst, u16(old, src));
    setU16(out, dst + 2, u16(old, src + 2));
    setU16(out, dst + 6, u16(old, src + 4));
    const len = Math.min(old[src + 6], 63);
    const bytes = encodeUtf16(macRoman(old.subarray(src + 7, src + 7 + len)));
    out.set(bytes, dst + 8);
  }
  return out;
}

// ---- the dispatcher ------------------------------------------------------------------------------

/** The 2018+ body (from +0x50) for a 2013 record of type `type` whose body (from +0x28) is `body`. */
export function docBody(type: number, body: Uint8Array): BodyConversion {
  switch (type) {
    case 55:
      return nameTableBody(body);
    case 94:
      return classBody(body);
    case 57:
      return classListBody();
    case 31:
      return layerBody(body);
    case 80:
      return body.slice(0, 1536);
    case 74:
      return fontBody(body);
    case 47:
      return formatBody(body);
    case 33:
    case 48:
      return null;
    default:
      return undefined;
  }
}
