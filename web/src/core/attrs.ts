// Pen/fill attributes (record bytes +0x50..+0x67 of drawable objects) and colours.
//
//   +0x50  i32  line style: 0 none, 2 solid, -n = the line type named n (readLineTypes)
//   +0x54  u8   line weight in mils (10 = 0.254 mm)
//   +0x55  u8   unknown; set on some 2023+ objects (0x01, 0x05, 0x33, 0x75, 0x8c), preserved
//   +0x56  u16  fill foreground colour index (pattern ink; unused by solid fills)
//   +0x58  u16  fill background colour index: the colour a solid fill paints
//   +0x5a  u16  pen foreground colour index
//   +0x5c  u16  pen background colour index
//   +0x5e  u8   fill opacity (0..100)
//   +0x5f  u8   pen opacity (0..100)
//   +0x64  i16  fill pattern: 0 none, 1 solid (in the background colour), 2 and
//               up an 8x8 bitmap pattern (see fillPatternBits; unknown ones draw
//               as 1 does), -n the fill resource named n (hatch type 66, tile 108,
//               gradient 120, image fill)
//
// Any of these may come from the object's class instead (BY_CLASS flags at +0x24).
//
// Colour indices point into the document colour table: a root aux record
// tagged TDMD/NDCD holding column sections, with C, M, Y, K as float32 columns
// (256 = white, 257 = black). Without that table, 256/257 still map to white and
// black, indices below 256 use the classic RGB16 palette in the type-80 record,
// and anything else falls back to black.

import { concat, f32, f64, i16, i32, readUtf16, setF32, setF64, setI32, setU16, setU32, u16, u32 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { Attributes, ByClassGroup, LineType } from "./types.ts";

export const ATTR_END = 0x68;
/** The line style of a pen set to None: the shape draws its fill only. */
export const NO_PEN = 0;

/**
 * Whether a shape draws its outline: not with the pen None, nor at weight 0 (the published PDFs
 * leave weight-0 outlines out, e.g. the borders of the teal tags and grid bubbles).
 */
export function drawsPen(a: Attributes | null | undefined): boolean {
  return !a || (a.lineStyle !== NO_PEN && a.lineWeight > 0);
}

/**
 * Bitmap fill patterns known so far: eight rows, high bit leftmost; set bits take the fill
 * foreground colour, clear ones the background. Vectorworks keeps its pattern table in the
 * application, not the file (the 2026 walls' pattern is nowhere in it), so these come from
 * published drawings: 35 from a 2026 sheet's wall components. Pattern 2 is not the all-set
 * QuickDraw black: black-on-white shapes using it print white, so it stays a background fill.
 */
const FILL_PATTERN_BITS: ReadonlyMap<number, readonly number[]> = new Map([
  [35, [0x88, 0x05, 0x02, 0x05, 0x88, 0x50, 0x20, 0x50]],
]);

/** The rows of a bitmap fill pattern, or null when the pattern is not one or its bits are unknown. */
export function fillPatternBits(pattern: number): readonly number[] | null {
  return FILL_PATTERN_BITS.get(pattern) ?? null;
}

export function readAttrs(d: Uint8Array): Attributes | null {
  if (d.length < ATTR_END) return null;
  return {
    lineStyle: i32(d, 0x50),
    lineWeight: d[0x54],
    fillPattern: i16(d, 0x64),
    fillFore: u16(d, 0x56),
    fillBack: u16(d, 0x58),
    penFore: u16(d, 0x5a),
    penBack: u16(d, 0x5c),
    fillOpacity: d[0x5e],
    penOpacity: d[0x5f],
  };
}

/**
 * An object's +0x24 u16 says which of its attributes come from its class ("Class Style"). A set bit
 * leaves the object's own value as a stale placeholder (weight 0, line style 0, black on white,
 * opacity 0 or 100) and the class's applies. Fill takes two: bit 6 its colours, bit 7 its pattern,
 * so an object can fill with its own hatch in its class's colours, or not at all (a title block's
 * page-size border, whose class is solid white). Bits 2, 8 and 10 (and 0, 1, 11-15, set only when
 * every bit is) cover attributes not drawn here (markers, drop shadow, text style).
 */
export const BY_CLASS = 0x24;
/** the bits of each group: a group is by class when all of them are set */
export const BY_CLASS_BITS: Readonly<Record<ByClassGroup, number>> = {
  lineWeight: 1 << 3,
  penColor: 1 << 4,
  lineStyle: 1 << 5,
  fill: (1 << 6) | (1 << 7),
  opacity: 1 << 9,
};
/** the bit each attribute follows its class by */
const FIELD_BITS: Readonly<Record<keyof Attributes, number>> = {
  lineWeight: 1 << 3,
  penFore: 1 << 4,
  penBack: 1 << 4,
  lineStyle: 1 << 5,
  fillFore: 1 << 6,
  fillBack: 1 << 6,
  fillPattern: 1 << 7,
  fillOpacity: 1 << 9,
  penOpacity: 1 << 9,
};
export const BY_CLASS_KEYS: Readonly<Record<ByClassGroup, readonly (keyof Attributes)[]>> = {
  lineWeight: ["lineWeight"],
  penColor: ["penFore", "penBack"],
  lineStyle: ["lineStyle"],
  fill: ["fillPattern", "fillFore", "fillBack"],
  opacity: ["fillOpacity", "penOpacity"],
};
const GROUPS = Object.keys(BY_CLASS_BITS) as ByClassGroup[];

/** The groups the flags take whole from the class. */
export function byClassGroups(flags: number): ByClassGroup[] {
  return GROUPS.filter((g) => (flags & BY_CLASS_BITS[g]) === BY_CLASS_BITS[g]);
}

/** The attribute group a field belongs to. */
export function byClassGroup(key: keyof Attributes): ByClassGroup {
  return GROUPS.find((g) => BY_CLASS_KEYS[g].includes(key))!;
}

/**
 * A class's attributes (type-94 record): +0x52 u16 fill foreground and +0x54 background colour,
 * +0x56 pen foreground and +0x58 background colour, +0x5a i32 line style (0 none, 2 solid, -n a
 * line type), +0x5e u8 weight in mils, +0x60 i16 fill pattern, +0x65 u8 fill and +0x66 pen opacity.
 */
export function readClassAttrs(d: Uint8Array): Attributes | null {
  if (d.length < 0x67) return null;
  return {
    lineStyle: i32(d, 0x5a),
    lineWeight: d[0x5e],
    fillPattern: i16(d, 0x60),
    fillFore: u16(d, 0x52),
    fillBack: u16(d, 0x54),
    penFore: u16(d, 0x56),
    penBack: u16(d, 0x58),
    fillOpacity: d[0x65],
    penOpacity: d[0x66],
  };
}

/** Class record field: the name index of the RenderWorks texture objects "by class" show (i32, 0 none). */
export const CLASS_TEXTURE = 0x9e;

/** Class record field: the name index of the text style its "Class Text Style" texts follow (i32, 0 none). */
export const CLASS_TEXT_STYLE = 0xb8;

/** Writes the given fields of a class's attributes in place (offsets as readClassAttrs). `d` must be a buffer the caller owns. */
export function writeClassAttrs(d: Uint8Array, a: Partial<Attributes>): void {
  if (d.length < 0x67) throw new Error("class record has no attribute block");
  const byte = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const word = (v: number) => Math.max(0, Math.min(0xffff, Math.round(v)));
  if (a.lineStyle !== undefined) setI32(d, 0x5a, Math.round(a.lineStyle));
  if (a.lineWeight !== undefined) d[0x5e] = Math.max(0, Math.min(0xff, Math.round(a.lineWeight)));
  if (a.fillFore !== undefined) setU16(d, 0x52, word(a.fillFore));
  if (a.fillBack !== undefined) setU16(d, 0x54, word(a.fillBack));
  if (a.penFore !== undefined) setU16(d, 0x56, word(a.penFore));
  if (a.penBack !== undefined) setU16(d, 0x58, word(a.penBack));
  if (a.fillOpacity !== undefined) d[0x65] = byte(a.fillOpacity);
  if (a.penOpacity !== undefined) d[0x66] = byte(a.penOpacity);
  if (a.fillPattern !== undefined) setU16(d, 0x60, Math.max(-0x8000, Math.min(0x7fff, Math.round(a.fillPattern))) & 0xffff);
}

/** An object's attributes as drawn: each its +0x24 flags take from the class does. */
export function resolveAttrs(a: Attributes, flags: number, cls: Uint8Array | undefined): Attributes {
  const c = flags && cls ? readClassAttrs(cls) : null;
  if (!c) return a;
  const out = { ...a };
  for (const k of Object.keys(FIELD_BITS) as (keyof Attributes)[]) if (flags & FIELD_BITS[k]) out[k] = c[k];
  return out;
}

/** Write the given fields in place. `d` must be a buffer the caller owns. */
export function writeAttrs(d: Uint8Array, a: Partial<Attributes>): void {
  if (d.length < ATTR_END) throw new Error("record has no attribute block");
  // a value written is the object's own, no longer its class's
  let flags = u16(d, BY_CLASS);
  for (const k of Object.keys(a) as (keyof Attributes)[]) if (a[k] !== undefined) flags &= ~FIELD_BITS[k];
  setU16(d, BY_CLASS, flags);
  const byte = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const word = (v: number) => Math.max(0, Math.min(0xffff, Math.round(v)));
  if (a.lineStyle !== undefined) setI32(d, 0x50, Math.round(a.lineStyle));
  if (a.lineWeight !== undefined) d[0x54] = Math.max(0, Math.min(0xff, Math.round(a.lineWeight)));
  if (a.fillFore !== undefined) setU16(d, 0x56, word(a.fillFore));
  if (a.fillBack !== undefined) setU16(d, 0x58, word(a.fillBack));
  if (a.penFore !== undefined) setU16(d, 0x5a, word(a.penFore));
  if (a.penBack !== undefined) setU16(d, 0x5c, word(a.penBack));
  if (a.fillOpacity !== undefined) d[0x5e] = byte(a.fillOpacity);
  if (a.penOpacity !== undefined) d[0x5f] = byte(a.penOpacity);
  if (a.fillPattern !== undefined) setU16(d, 0x64, Math.max(-0x8000, Math.min(0x7fff, Math.round(a.fillPattern))) & 0xffff);
}

/** Most dash/gap entries a line type record has room for (+0x62..+0xba). */
const MAX_DASHES = 11;

/**
 * Line types (dash styles): type-96 records, named by their name index.
 * An object's negative line style -n selects the line type named n.
 *   +0x61  u8   number of dash/gap entries
 *   +0x62  n x f64 alternating dash and gap lengths in paper inches
 *               (unused slots repeat the first entry)
 * The type-119 children hold preview images.
 */
export function readLineTypes(recs: Iterable<Rec>, names: ReadonlyMap<number, string>): LineType[] {
  const out: LineType[] = [];
  for (const r of recs) {
    if (r.type !== 96 || r.data.length < 0x62) continue;
    const d = r.data;
    const n = d[0x61];
    const dashes: number[] = [];
    if (n >= 2 && n <= MAX_DASHES && n % 2 === 0 && 0x62 + 8 * n <= d.length) {
      for (let i = 0; i < n; i++) dashes.push(f64(d, 0x62 + 8 * i));
    }
    const valid = dashes.every((v) => Number.isFinite(v) && v >= 0) && dashes.some((v) => v > 0);
    out.push({ style: -r.nameIndex, name: names.get(r.nameIndex) ?? `Line type ${r.nameIndex}`, dashes: valid ? dashes : [] });
  }
  return out;
}

/**
 * The line type record with `dashes` (alternating dash and gap lengths, paper inches) in place of
 * its own, or the same record when they don't change. Unused slots repeat the first entry, as
 * most records have them; the bytes after the slots are kept as they are.
 */
export function writeLineType(d: Uint8Array, dashes: readonly number[]): Uint8Array {
  if (dashes.length < 2 || dashes.length >= MAX_DASHES || dashes.length % 2 || !dashes.every((v) => Number.isFinite(v) && v >= 0) || !dashes.some((v) => v > 0)) {
    throw new Error(`a line type takes 1 to ${(MAX_DASHES - 1) / 2} dash and gap pairs, not all of them 0`);
  }
  if (d.length < 0x62 + 8 * MAX_DASHES) throw new Error("a line type record can't be read");
  if (d[0x61] === dashes.length && dashes.every((v, i) => f64(d, 0x62 + 8 * i) === v)) return d;
  const out = d.slice();
  out[0x61] = dashes.length;
  for (let i = 0; i < MAX_DASHES; i++) setF64(out, 0x62 + 8 * i, dashes[i] ?? dashes[0]);
  return out;
}

export const WHITE = 256;
export const BLACK = 257;

function hex2(v: number): string {
  return (v >>> 8).toString(16).padStart(2, "0");
}

/** Classic palette from the type-80 record: 256 x RGB16 at +0x50. */
export function readPalette(rec: Rec | undefined): string[] {
  if (!rec || rec.data.length < 0x50 + 256 * 6) return [];
  const out: string[] = [];
  for (let i = 0; i < 256; i++) {
    const off = 0x50 + 6 * i;
    out.push("#" + hex2(u16(rec.data, off)) + hex2(u16(rec.data, off + 2)) + hex2(u16(rec.data, off + 4)));
  }
  return out;
}

function isTag(d: Uint8Array, off: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i++) if (d[off + i] !== tag.charCodeAt(i)) return false;
  return true;
}

interface Section {
  /** element size: 8 = 4-byte values, 1 = bytes */
  type: number;
  count: number;
  at: number;
}

/** Sections of the root `TDMD`/`NDCD` aux record:
 *    +0x5a u16 section count, +0x60 count x { u16 id; u32 offset from +0x60 }
 *    section: u16 element type (8 = 4-byte, 1 = byte), u32 count, data */
function ndcdSections(roots: Rec[]): { d: Uint8Array; sections: Map<number, Section> } | null {
  const rec = roots.find((r) => r.type === 76 && isTag(r.data, 0x50, "TDMD") && isTag(r.data, 0x56, "NDCD"));
  if (!rec) return null;
  const d = rec.data;
  const sections = new Map<number, Section>();
  const n = u16(d, 0x5a);
  for (let i = 0; i < n; i++) {
    const id = u16(d, 0x60 + 6 * i);
    const at = 0x60 + u32(d, 0x60 + 6 * i + 2);
    if (at + 6 > d.length) continue;
    const type = u16(d, at);
    const count = u32(d, at + 2);
    const size = type === 8 ? 4 : 1;
    if (at + 6 + size * count <= d.length) sections.set(id, { type, count, at: at + 6 });
  }
  return { d, sections };
}

/** Document colour table: NDCD sections 2..5 are C, M, Y, K (float32, 0..1),
 *  one entry per colour index. */
export function readColorTable(roots: Rec[]): string[] {
  const t = ndcdSections(roots);
  if (!t) return [];
  const { d, sections } = t;
  const cols = [2, 3, 4, 5].map((id) => sections.get(id));
  if (cols.some((c) => !c || c.type !== 8)) return [];
  const count = Math.min(...cols.map((c) => c!.count));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const [c, m, y, k] = cols.map((col) => Math.min(1, Math.max(0, f32(d, col!.at + 4 * i) || 0)));
    const ch = (v: number) =>
      Math.round(255 * (1 - v) * (1 - k))
        .toString(16)
        .padStart(2, "0");
    out.push("#" + ch(c) + ch(m) + ch(y));
  }
  return out;
}

/** Colour names, per colour index: section 7 holds each name's byte offset
 *  into the section-10 string pool, section 8 its byte length (UTF-16LE with
 *  a 2-byte terminator, so 2 = unnamed). */
export function readColorNames(roots: Rec[]): string[] {
  const t = ndcdSections(roots);
  if (!t) return [];
  const { d, sections } = t;
  const offs = sections.get(7);
  const lens = sections.get(8);
  const pool = sections.get(10);
  if (!offs || !lens || !pool || offs.type !== 8 || lens.type !== 8 || pool.type !== 1) return [];
  const out: string[] = [];
  for (let i = 0; i < Math.min(offs.count, lens.count); i++) {
    const off = u32(d, offs.at + 4 * i);
    const len = u32(d, lens.at + 4 * i) - 2;
    out.push(len > 0 && off + len <= pool.count ? readUtf16(d, pool.at + off, len) : "");
  }
  return out;
}

/** "#rrggbb" as the table's C, M, Y, K (0..1): K from the brightest channel, as every entry in the samples has it. */
export function cmykOf(css: string): [number, number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16) / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

/** sections 2 to 8 hold one value per colour slot: C, M, Y, K, the flag, the name's offset and length */
const PER_COLOUR = [2, 3, 4, 5, 6, 7, 8];
/** free slots a full table grows by (the samples keep 24 to 26 spare) */
const SLOT_GROWTH = 32;

/**
 * The colour table record's data with `colors` ("#rrggbb") added after the colours in use (section
 * 1's count), each unnamed and flagged 1 in section 6, as the colours objects take on in the samples
 * are (white, black and the colours added as a drawing is worked on; a palette's block is 0). A table
 * with no free slot left grows each per-colour section by SLOT_GROWTH. The sections are rewritten in
 * their order, the directory's offsets and the size at +0x5c moved by what they grew; null when the
 * record isn't laid out as the samples' are (sections 1 to 10, back to back).
 */
export function addTableColors(data: Uint8Array, colors: readonly string[]): { data: Uint8Array; indices: number[] } | null {
  if (!isTag(data, 0x50, "TDMD") || !isTag(data, 0x56, "NDCD")) return null;
  const dir = u16(data, 0x5a);
  const list: { id: number; slot: number; type: number; count: number; start: number; end: number }[] = [];
  for (let i = 0; i < dir; i++) {
    const start = 0x60 + u32(data, 0x60 + 6 * i + 2);
    if (start + 6 > data.length) return null;
    const type = u16(data, start);
    const count = u32(data, start + 2);
    list.push({ id: u16(data, 0x60 + 6 * i), slot: i, type, count, start, end: start + 6 + count * (type === 8 ? 4 : 1) });
  }
  const byId = new Map(list.map((s) => [s.id, s]));
  const slots = byId.get(2)?.count ?? 0;
  if ([1, 9].some((id) => byId.get(id)?.type !== 8) || byId.get(10)?.type !== 1) return null;
  if (PER_COLOUR.some((id) => byId.get(id)?.count !== slots || byId.get(id)?.type !== (id === 6 ? 1 : 8))) return null;
  const sorted = [...list].sort((a, b) => a.start - b.start);
  if (sorted.some((s, i) => i > 0 && s.start !== sorted[i - 1].end) || sorted.at(-1)!.end > data.length) return null;
  const inUse = u32(data, byId.get(1)!.start + 6);
  if (inUse > slots) return null;
  const used = inUse + colors.length;
  const total = used <= slots ? slots : slots + Math.ceil((used - slots) / SLOT_GROWTH) * SLOT_GROWTH;
  // an unnamed colour's name points at a terminator another unnamed one uses (blank drawings: 0)
  const lens = byId.get(8)!;
  const offs = byId.get(7)!;
  let unnamedAt = 0;
  for (let i = 0; i < inUse; i++) {
    if (u32(data, lens.start + 6 + 4 * i) === 2) {
      unnamedAt = u32(data, offs.start + 6 + 4 * i);
      break;
    }
  }
  const cmyk = colors.map(cmykOf);
  const parts: Uint8Array[] = [data.subarray(0, sorted[0].start)];
  const moved = new Map<number, number>();
  let at = sorted[0].start;
  for (const s of sorted) {
    const size = s.type === 8 ? 4 : 1;
    const count = PER_COLOUR.includes(s.id) ? total : s.count;
    const out = new Uint8Array(6 + count * size);
    out.set(data.subarray(s.start, s.end));
    setU32(out, 2, count);
    if (s.id === 1) setU32(out, 6, used);
    cmyk.forEach((v, j) => {
      const slot = 6 + (inUse + j) * size;
      if (s.id >= 2 && s.id <= 5) setF32(out, slot, v[s.id - 2]);
      else if (s.id === 6) out[slot] = 1;
      else if (s.id === 7) setU32(out, slot, unnamedAt);
      else if (s.id === 8) setU32(out, slot, 2);
    });
    moved.set(s.slot, at - 0x60);
    parts.push(out);
    at += out.length;
  }
  parts.push(data.subarray(sorted.at(-1)!.end));
  const out = concat(parts);
  for (const [slot, off] of moved) setU32(out, 0x60 + 6 * slot + 2, off);
  setU32(out, 0x5c, u32(data, 0x5c) + out.length - data.length);
  return { data: out, indices: colors.map((_, j) => inUse + j) };
}

export function colorOf(table: string[], palette: string[], index: number): string {
  const t = table[index];
  if (t) return t;
  if (index === WHITE) return "#ffffff";
  if (index === BLACK) return "#000000";
  return palette[index] ?? "#000000";
}
