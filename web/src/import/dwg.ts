// DWG import, the reading side. parseDwg (no DOM) reads an AutoCAD drawing file, from R13 (AC1012)
// to 2018 and later (AC1032), into the same drawable objects as parseDxf: each object it knows is
// decoded into the group codes it would have in a DXF file, and import/dxf.ts walks those, so
// layers, blocks, text and the rest come in exactly as they do from DXF. Objects it does not decode
// (hatches, multileaders, 3D solids, images, ...) are counted as skipped. The file layout follows
// the Open Design Alliance's freely published "Open Design Specification for .dwg files"; ACadSharp
// (MIT licence) was the cross-check where the specification is unclear.

import type { Pt } from "../core/types.ts";
import {
  ACIS_TYPES,
  aciColor,
  drawingOf,
  leaderArrows,
  type AcisObject,
  type Block,
  type DxfDrawing,
  type DxfLayer,
  type DxfLineType,
  type DxfTables,
  type Entry,
  type Pair,
  type XrefDef,
  type XrefSource,
} from "./dxf.ts";

/** The AutoCAD release behind each version code this reader knows. */
const RELEASES: Readonly<Record<string, string>> = {
  AC1012: "R13",
  AC1014: "R14",
  AC1015: "2000",
  AC1018: "2004",
  AC1021: "2007",
  AC1024: "2010",
  AC1027: "2013",
  AC1032: "2018",
};

/** Version codes of the DWG files before R13, which have a layout of their own. */
const OLDER: Readonly<Record<string, string>> = {
  "MC0.0": "1.1",
  "AC1.2": "1.2",
  "AC1.40": "1.4",
  "AC1.50": "2.0",
  "AC2.10": "2.10",
  AC1001: "2.2",
  AC1002: "2.5",
  AC1003: "2.6",
  AC1004: "R9",
  AC1006: "R10",
  AC1009: "R11/R12",
};

/** Text encodings by the drawing's code page number, for the text of files before 2007. */
const CODE_PAGES: readonly string[] = [
  "windows-1252", "windows-1252", "iso-8859-1", "iso-8859-2", "iso-8859-3", "iso-8859-4", "iso-8859-5",
  "iso-8859-6", "iso-8859-7", "iso-8859-8", "iso-8859-9", "ibm437", "ibm850", "ibm852", "ibm855", "ibm857",
  "ibm860", "ibm861", "ibm863", "ibm864", "ibm865", "ibm869", "shift_jis", "macintosh", "big5", "euc-kr",
  "johab", "ibm866", "windows-1250", "windows-1251", "windows-1252", "gbk", "windows-1253", "windows-1254",
  "windows-1255", "windows-1256", "windows-1257", "windows-874", "shift_jis", "gbk", "euc-kr", "big5",
  "johab", "utf-16le", "windows-1258",
];

/** Entity types with a fixed number, by their DXF names. Any other fixed number is a non-graphic object. */
const ENTITY_NAMES: Readonly<Record<number, string>> = {
  1: "TEXT", 2: "ATTRIB", 3: "ATTDEF", 4: "BLOCK", 5: "ENDBLK", 6: "SEQEND", 7: "INSERT", 8: "MINSERT",
  10: "VERTEX", 11: "VERTEX", 12: "VERTEX", 13: "VERTEX", 14: "VERTEX", 15: "POLYLINE", 16: "POLYLINE",
  17: "ARC", 18: "CIRCLE", 19: "LINE", 20: "DIMENSION", 21: "DIMENSION", 22: "DIMENSION", 23: "DIMENSION",
  24: "DIMENSION", 25: "DIMENSION", 26: "DIMENSION", 27: "POINT", 28: "3DFACE", 29: "POLYLINE",
  30: "POLYLINE", 31: "SOLID", 32: "TRACE", 33: "SHAPE", 34: "VIEWPORT", 35: "ELLIPSE", 36: "SPLINE",
  37: "REGION", 38: "3DSOLID", 39: "BODY", 40: "RAY", 41: "XLINE", 43: "OLEFRAME", 44: "MTEXT",
  45: "LEADER", 46: "TOLERANCE", 47: "MLINE", 74: "OLE2FRAME", 77: "LWPOLYLINE", 78: "HATCH",
  498: "ACAD_PROXY_ENTITY",
};

const BLOCK_HEADER = 49;
const LAYER = 51;
const LTYPE = 57;
/** Line weights in hundredths of a millimetre by the index a DWG keeps; 28 and 29 are by layer, 30 by block and 31 the default. */
const LINE_WEIGHTS: readonly number[] = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
/** Class-defined entities that are dimensions, drawn through their block like the fixed ones. */
const CLASS_DIMENSIONS = new Set(["ARC_DIMENSION", "LARGE_RADIAL_DIMENSION"]);
/** Most objects one drawing may hold; a larger object map is taken for a damaged file. */
const MAX_OBJECTS = 2_000_000;

export interface DwgDrawing extends DxfDrawing {
  /** the AutoCAD release that wrote the file, e.g. "2018" */
  readonly release: string;
  /** "model" normally; "paper" when model space is empty and the sheet's paper space was read instead */
  readonly space: "model" | "paper";
  /** objects in the file that could not be decoded, counted by DXF type */
  readonly unreadable: Readonly<Record<string, number>>;
}

/** True when the bytes start like a DWG file ("AC10xx"). */
export function isDwg(bytes: Uint8Array): boolean {
  return bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43;
}

/**
 * Reads a .dwg drawing: its model space, or its paper space when model space holds nothing.
 * Throws when the bytes are not a DWG file, or one of a release it cannot read. `xrefs` gives the
 * files of its external references by upper-case name (see dwgSource); one not given is left out.
 */
export function parseDwg(bytes: Uint8Array, xrefs: ReadonlyMap<string, XrefSource> = new Map()): DwgDrawing {
  const { db, header, release } = readDwg(bytes);
  return assemble(db, header, release, xrefs);
}

/**
 * Reads a .dwg file as a drawing of its own or as the file of an external reference: its model
 * space, blocks, tables, units and the xrefs it defines. Throws as parseDwg does.
 */
export function dwgSource(bytes: Uint8Array): XrefSource {
  const { db, header } = readDwg(bytes);
  const parts = partsOf(db, header);
  return { entities: parts.model, blocks: parts.blocks, tables: parts.tables, insunits: header.insunits, xrefs: parts.xrefs };
}

/** The file's header and objects read into the database that assemble and partsOf draw from. */
function readDwg(bytes: Uint8Array): { db: Db; header: Header; release: string } {
  const code = String.fromCharCode(...bytes.subarray(0, 6));
  const f = fileOf(bytes, code);
  const sections = sectionsOf(f);
  const classes = sections.classes ? classesOf(f, sections.classes) : new Map<number, DwgClass>();
  const header = sections.header ? headerOf(f, sections.header) : { insunits: 0, ltscale: 1 };
  const map = objectMap(sections.handles);
  const db = readObjects(f, sections.objects, map, classes, sections.acis);
  return { db, header, release: RELEASES[code] ?? `newer than 2018 (${code})` };
}

// ---- the file and its sections --------------------------------------------------------

interface DwgFile {
  readonly bytes: Uint8Array;
  /** the version as a number: 1012 for AC1012, and so on */
  readonly v: number;
  /** the maintenance release byte, which decides a field in R2010 and R2013 files */
  readonly maint: number;
  readonly decoder: TextDecoder;
}

interface Sections {
  readonly header: Uint8Array | null;
  readonly classes: Uint8Array | null;
  readonly handles: Uint8Array;
  /** the bytes the object map's offsets count from: the whole file before R2004, the objects section after */
  readonly objects: Uint8Array;
  /** R2013 on: the ACIS data of solids, regions and bodies by handle, from the AcDsPrototype_1b section; empty before */
  readonly acis: Map<number, Uint8Array>;
}

function fileOf(bytes: Uint8Array, code: string): DwgFile {
  if (OLDER[code]) {
    throw new Error(`it is an AutoCAD ${OLDER[code]} drawing (${code}); Rodeo reads DWG files from R13 on, so save it as DXF or as a newer DWG`);
  }
  const m = /^AC(\d{4})$/.exec(code);
  if (!m || Number(m[1]) < 1012) throw new Error("it is not an AutoCAD DWG drawing");
  // releases after 2018 have kept its layout so far
  const v = Math.min(Number(m[1]), 1032);
  if (v !== 1012 && v !== 1014 && !RELEASES[`AC${v}`] && v < 1032) throw new Error(`its version (${code}) is not one AutoCAD released`);
  const page = bytes[0x13] | (bytes[0x14] << 8);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(CODE_PAGES[page] ?? "windows-1252");
  } catch {
    decoder = new TextDecoder("windows-1252");
  }
  return { bytes, v, maint: bytes[0x0b], decoder };
}

function sectionsOf(f: DwgFile): Sections {
  if (f.v <= 1015) return sections15(f);
  const named = f.v === 1021 ? sections21(f) : sections18(f);
  const handles = named.get("AcDb:Handles");
  const objects = named.get("AcDb:AcDbObjects");
  if (!handles || !objects) throw new Error("the drawing has no object map, so it cannot be read");
  return { header: named.get("AcDb:Header") ?? null, classes: named.get("AcDb:Classes") ?? null, handles, objects, acis: acisOfSection(named.get("AcDb:AcDsPrototype_1b")) };
}

/** R13 to 2000: a table of section locators after the version, each a number, an offset and a size. */
function sections15(f: DwgFile): Sections {
  const b = f.bytes;
  const count = u32(b, 0x15);
  const at = new Map<number, Uint8Array>();
  for (let i = 0; i < count && i < 16; i++) {
    const p = 0x19 + i * 9;
    const seeker = u32(b, p + 1);
    const size = u32(b, p + 5);
    if (seeker < b.length) at.set(b[p], b.subarray(seeker, Math.min(b.length, seeker + size)));
  }
  const handles = at.get(2);
  if (!handles) throw new Error("the drawing has no object map, so it cannot be read");
  return { header: at.get(0) ?? null, classes: at.get(1) ?? null, handles, objects: b, acis: new Map() };
}

/** R2004 and 2010 on: an encrypted header points to a map of pages, and a map of sections lists each one's pages. */
function sections18(f: DwgFile): Map<string, Uint8Array> {
  const b = f.bytes;
  // the header at 0x80 is XORed with a fixed pseudo-random sequence
  const head = new Uint8Array(0x6c);
  let seed = 1;
  for (let i = 0; i < head.length; i++) {
    seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0;
    head[i] = b[0x80 + i] ^ ((seed >>> 16) & 0xff);
  }
  if (String.fromCharCode(...head.subarray(0, 11)) !== "AcFssFcAJMB") throw new Error("the drawing's file header is damaged");
  const pageMapAt = u32(head, 0x54) + 0x100;
  const sectionMapId = u32(head, 0x5c);

  // page number -> where the page starts; pages follow one another from 0x100
  const pageMap = systemPage(b, pageMapAt);
  const pages = new Map<number, number>();
  let at = 0x100;
  for (let p = 0; p + 8 <= pageMap.length; ) {
    const number = i32(pageMap, p);
    const size = u32(pageMap, p + 4);
    p += 8;
    if (number >= 0) pages.set(number, at);
    else p += 16; // a gap: parent, left, right, 0
    at += size;
  }
  const mapAt = pages.get(sectionMapId);
  if (mapAt === undefined) throw new Error("the drawing's section map is missing");
  const map = systemPage(b, mapAt);

  const out = new Map<string, Uint8Array>();
  const count = u32(map, 0);
  let p = 0x14;
  for (let s = 0; s < count && p + 0x60 <= map.length; s++) {
    const size = u64(map, p);
    const pageCount = u32(map, p + 8);
    const maxPage = u32(map, p + 12);
    const compressed = u32(map, p + 20) === 2;
    const encrypted = u32(map, p + 28) === 1;
    const name = latin1(map.subarray(p + 32, p + 96));
    p += 96;
    const list: { page: number; size: number; offset: number }[] = [];
    for (let i = 0; i < pageCount && p + 16 <= map.length; i++, p += 16) {
      list.push({ page: u32(map, p), size: u32(map, p + 4), offset: u64(map, p + 8) });
    }
    if (!WANTED.has(name)) continue;
    if (encrypted) throw new Error("the drawing is password protected");
    const data = new Uint8Array(size);
    // the last page can unpack to more than the section's size says, so each page unpacks whole first
    const page = new Uint8Array(maxPage);
    for (const pg of list) {
      const start = pages.get(pg.page);
      if (start === undefined || pg.offset >= size) continue;
      // each data page has a 32-byte header, XORed with a mask from its position
      const mask = (0x4164536b ^ start) >>> 0;
      const compSize = (u32(b, start + 8) ^ mask) >>> 0;
      const n = Math.min(size - pg.offset, maxPage);
      if (compressed) {
        decompress18(b, start + 32, compSize, page);
        data.set(page.subarray(0, n), pg.offset);
      } else {
        data.set(b.subarray(start + 32, start + 32 + Math.min(compSize, n)), pg.offset);
      }
    }
    out.set(name, data);
  }
  return out;
}

const WANTED = new Set(["AcDb:Header", "AcDb:Classes", "AcDb:Handles", "AcDb:AcDbObjects", "AcDb:AcDsPrototype_1b"]);

/** A system page of an R2004 file (the page map or the section map): a 20-byte header and compressed data. */
function systemPage(b: Uint8Array, at: number): Uint8Array {
  const size = u32(b, at + 4);
  const compSize = u32(b, at + 8);
  const out = new Uint8Array(size);
  decompress18(b, at + 20, compSize, out);
  return out;
}

/**
 * R2007: the header at 0x80 and every page are interleaved Reed-Solomon blocks (read here without
 * the correction) of data compressed in a scheme of their own, and the maps count from 0x480.
 */
function sections21(f: DwgFile): Map<string, Uint8Array> {
  const b = f.bytes;
  const decoded = new Uint8Array(3 * 239);
  deinterleave(b.subarray(0x80, 0x80 + 0x400), decoded, 3, 239);
  const comprLen = i32(decoded, 24);
  const meta = new Uint8Array(0x110);
  if (comprLen > 0) decompress21(decoded, 32, comprLen, meta);
  else meta.set(decoded.subarray(32, 32 + Math.min(0x110, -comprLen)));
  const field = (at: number): number => u64(meta, at);

  // page id -> offset from 0x480 and size
  const pageMap = systemPage21(b, field(0x38), field(0x50), field(0x58), field(0x18), 239);
  const pages = new Map<number, { offset: number; size: number }>();
  let offset = 0;
  for (let p = 0; p + 16 <= pageMap.length; p += 16) {
    const size = u64(pageMap, p);
    pages.set(Math.abs(i64(pageMap, p + 8)), { offset, size });
    offset += size;
  }
  const mapPage = pages.get(field(0xc0));
  if (!mapPage) throw new Error("the drawing's section map is missing");
  const map = systemPage21(b, mapPage.offset, field(0xb0), field(0xc8), field(0xd8), 239);

  const out = new Map<string, Uint8Array>();
  for (let p = 0; p + 64 <= map.length; ) {
    const size = u64(map, p);
    const encoding = u64(map, p + 0x30);
    const nameLength = u64(map, p + 0x20);
    const pageCount = u64(map, p + 0x38);
    p += 64;
    const name = utf16(map.subarray(p, p + nameLength)).replace(/\0/g, "");
    p += nameLength;
    const list: { offset: number; id: number; full: number; comp: number }[] = [];
    for (let i = 0; i < pageCount && p + 56 <= map.length; i++, p += 56) {
      list.push({ offset: u64(map, p), id: u64(map, p + 16), full: u64(map, p + 24), comp: u64(map, p + 32) });
    }
    if (!WANTED.has(name)) continue;
    const data = new Uint8Array(size);
    for (const pg of list) {
      const where = pages.get(pg.id);
      if (!where || pg.offset >= size) continue;
      let raw = b.subarray(0x480 + where.offset, 0x480 + where.offset + where.size);
      if (encoding === 4) {
        const blocks = Math.ceil(alignTo8(pg.comp) / 251);
        const plain = new Uint8Array(blocks * 251);
        deinterleave(raw, plain, blocks, 251);
        raw = plain;
      }
      const dest = data.subarray(pg.offset, Math.min(size, pg.offset + pg.full));
      if (pg.comp !== pg.full) decompress21(raw, 0, pg.comp, dest);
      else dest.set(raw.subarray(0, dest.length));
    }
    out.set(name, data);
  }
  return out;
}

/** An R2007 system page: Reed-Solomon blocks of `block` bytes holding `comp` compressed bytes, `factor` times over. */
function systemPage21(b: Uint8Array, offset: number, comp: number, full: number, factor: number, block: number): Uint8Array {
  const total = alignTo8(comp) * factor;
  const blocks = Math.ceil(total / block);
  const plain = new Uint8Array(total);
  deinterleave(b.subarray(0x480 + offset, 0x480 + offset + blocks * 255), plain, blocks, block);
  const out = new Uint8Array(full);
  decompress21(plain, 0, comp, out);
  return out;
}

function alignTo8(n: number): number {
  return Math.floor((n + 7) / 8) * 8;
}

/** Undoes the interleaving of Reed-Solomon (255, k) blocks: byte j of block i is at i + j * blocks. */
function deinterleave(src: Uint8Array, out: Uint8Array, blocks: number, block: number): void {
  let o = 0;
  for (let i = 0; i < blocks && o < out.length; i++) {
    const n = Math.min(block, out.length - o);
    for (let j = 0, s = i; j < n; j++, s += blocks) out[o++] = src[s] ?? 0;
  }
}

// ---- decompression -----------------------------------------------------------------

/** The LZ77 variant of R2004 and 2010 on, from src[at] for `size` bytes into out. */
function decompress18(src: Uint8Array, at: number, size: number, out: Uint8Array): void {
  let i = at;
  const end = at + size;
  let o = 0;
  const next = (): number => (i < end ? src[i++] : 0x11);
  const literal = (n: number): number => {
    if (o + n > out.length || i + n > end) throw new Error("a compressed page runs past its end");
    out.set(src.subarray(i, i + n), o);
    i += n;
    o += n;
    return next();
  };
  // a length with an escape: a zero byte adds 0xFF, the first non-zero byte ends it
  const longCount = (low: number, bits: number): number => {
    if (low !== 0) return low;
    let n = bits;
    let b = next();
    while (b === 0 && i < end) {
      n += 0xff;
      b = next();
    }
    return n + b;
  };
  let op = next();
  if (op > 0x11) op = literal(op - 17);
  if ((op & 0xf0) === 0) op = literal(longCount(op & 0x0f, 0x0f) + 3);
  while (op !== 0x11) {
    let count: number;
    let offset: number;
    let lit: number;
    if (op < 0x10 || op >= 0x40) {
      count = (op >> 4) - 1;
      const op2 = next();
      offset = (((op >> 2) & 3) | (op2 << 2)) + 1;
      lit = op & 3;
    } else if (op < 0x20) {
      count = longCount(op & 7, 7) + 2;
      const b1 = next();
      offset = ((op & 8) << 11) + ((b1 >> 2) | (next() << 6)) + 0x4000;
      lit = b1 & 3;
    } else {
      count = longCount(op & 0x1f, 0x1f) + 2;
      const b1 = next();
      offset = ((b1 >> 2) | (next() << 6)) + 1;
      lit = b1 & 3;
    }
    if (offset > o || o + count > out.length) throw new Error("a compressed page points outside itself");
    for (let k = 0; k < count; k++, o++) out[o] = out[o - offset];
    if (lit === 0) {
      op = next();
      if ((op & 0xf0) === 0) op = literal(longCount(op & 0x0f, 0x0f) + 3);
    } else {
      op = literal(lit);
    }
  }
}

/**
 * How R2007 copies a literal run's last bytes (the run goes in blocks of 32, each with its quarters
 * reversed): for each length below 32, pieces of [source offset, destination offset, length]. A
 * piece of 1 to 3 bytes is copied back to front; 4 and 8 in order; 16 as its two halves swapped.
 */
const TAIL_COPIES: readonly (readonly (readonly [number, number, number])[])[] = [
  [],
  [[0, 0, 1]],
  [[0, 0, 2]],
  [[0, 0, 3]],
  [[0, 0, 4]],
  [[4, 0, 1], [0, 1, 4]],
  [[5, 0, 1], [1, 1, 4], [0, 5, 1]],
  [[5, 0, 2], [1, 2, 4], [0, 6, 1]],
  [[0, 0, 8]],
  [[8, 0, 1], [0, 1, 8]],
  [[9, 0, 1], [1, 1, 8], [0, 9, 1]],
  [[9, 0, 2], [1, 2, 8], [0, 10, 1]],
  [[8, 0, 4], [0, 4, 8]],
  [[12, 0, 1], [8, 1, 4], [0, 5, 8]],
  [[13, 0, 1], [9, 1, 4], [1, 5, 8], [0, 13, 1]],
  [[13, 0, 2], [9, 2, 4], [1, 6, 8], [0, 14, 1]],
  [[0, 0, 16]],
  [[9, 0, 8], [8, 8, 1], [0, 9, 8]],
  [[17, 0, 1], [1, 1, 16], [0, 17, 1]],
  [[16, 0, 3], [0, 3, 16]],
  [[16, 0, 4], [8, 4, 8], [0, 12, 8]],
  [[20, 0, 1], [16, 1, 4], [8, 5, 8], [0, 13, 8]],
  [[20, 0, 2], [16, 2, 4], [8, 6, 8], [0, 14, 8]],
  [[20, 0, 3], [16, 3, 4], [8, 7, 8], [0, 15, 8]],
  [[16, 0, 8], [0, 8, 16]],
  [[17, 0, 8], [16, 8, 1], [0, 9, 16]],
  [[25, 0, 1], [17, 1, 8], [16, 9, 1], [0, 10, 16]],
  [[25, 0, 2], [17, 2, 8], [16, 10, 1], [0, 11, 16]],
  [[24, 0, 4], [16, 4, 8], [8, 12, 8], [0, 20, 8]],
  [[28, 0, 1], [24, 1, 4], [16, 5, 8], [8, 13, 8], [0, 21, 8]],
  [[28, 0, 2], [24, 2, 4], [16, 6, 8], [8, 14, 8], [0, 22, 8]],
  [[30, 0, 1], [26, 1, 4], [18, 5, 8], [10, 13, 8], [2, 21, 8], [0, 29, 2]],
];

/** One piece of an R2007 literal copy (see TAIL_COPIES). */
function copyPiece(src: Uint8Array, s: number, out: Uint8Array, d: number, n: number): void {
  if (n <= 3) {
    for (let k = 0; k < n; k++) out[d + k] = src[s + n - 1 - k];
  } else if (n === 16) {
    out.set(src.subarray(s + 8, s + 16), d);
    out.set(src.subarray(s, s + 8), d + 8);
  } else {
    out.set(src.subarray(s, s + n), d);
  }
}

/** The compression of R2007 files, from src[at] for `size` bytes into out. */
function decompress21(src: Uint8Array, at: number, size: number, out: Uint8Array): void {
  let i = at;
  const end = at + size;
  let o = 0;
  let op = src[i++];
  let len = 0;
  let back = 0;
  if (i >= end) return;
  if ((op & 0xf0) === 0x20) {
    i += 3;
    len = src[i - 1] & 7;
  }
  const instruction = (): void => {
    switch (op >> 4) {
      case 0:
        len = (op & 0x0f) + 0x13;
        back = src[i++];
        op = src[i++];
        len += (op >> 3) & 0x10;
        back += ((op & 0x78) << 5) + 1;
        break;
      case 1:
        len = (op & 0x0f) + 3;
        back = src[i++];
        op = src[i++];
        back += ((op & 0xf8) << 5) + 1;
        break;
      case 2:
        back = src[i] | (src[i + 1] << 8);
        i += 2;
        len = op & 7;
        if ((op & 8) === 0) {
          op = src[i++];
          len += op & 0xf8;
        } else {
          back++;
          len += src[i++] << 3;
          op = src[i++];
          len += ((op & 0xf8) << 8) + 0x100;
        }
        break;
      default:
        len = op >> 4;
        back = op & 0x0f;
        op = src[i++];
        back += ((op & 0xf8) << 1) + 1;
    }
  };
  while (i < end) {
    // a literal run
    if (len === 0) {
      len = op + 8;
      if (len === 0x17) {
        let n = src[i++];
        len += n;
        if (n === 0xff) {
          do {
            n = src[i] | (src[i + 1] << 8);
            i += 2;
            len += n;
          } while (n === 0xffff);
        }
      }
    }
    if (o + len > out.length || i + len > src.length) throw new Error("a compressed page runs past its end");
    let s = i;
    let d = o;
    let left = len;
    for (; left >= 32; left -= 32, s += 32, d += 32) {
      for (const [from, to] of [[24, 0], [28, 4], [16, 8], [20, 12], [8, 16], [12, 20], [0, 24], [4, 28]]) {
        out.set(src.subarray(s + from, s + from + 4), d + to);
      }
    }
    for (const [from, to, n] of TAIL_COPIES[left]) copyPiece(src, s + from, out, d + to, n);
    i += len;
    o += len;
    if (i >= end) break;
    // then copies from earlier output, as long as the instructions run on
    len = 0;
    op = src[i++];
    instruction();
    for (;;) {
      if (back > o || o + len > out.length) throw new Error("a compressed page points outside itself");
      for (let k = 0; k < len; k++, o++) out[o] = out[o - back];
      len = op & 7;
      if (len !== 0 || i >= end) break;
      op = src[i++];
      if (op >> 4 === 0) break;
      if (op >> 4 === 15) op &= 15;
      instruction();
    }
  }
}

// ---- the bit stream ----------------------------------------------------------------

const scratch = new DataView(new ArrayBuffer(8));

/** A reader over a DWG bit stream, from bit `pos` of `buf`. Past the end it reads zeros. */
class Bits {
  constructor(
    readonly buf: Uint8Array,
    public pos: number,
    readonly f: DwgFile,
  ) {}

  bit(): number {
    const p = this.pos++;
    return (this.buf[p >> 3] >> (7 - (p & 7))) & 1;
  }

  /** BB: two bits */
  bb(): number {
    return (this.bit() << 1) | this.bit();
  }

  /** RC: a raw byte */
  byte(): number {
    const p = this.pos;
    this.pos += 8;
    const i = p >> 3;
    const s = p & 7;
    return s === 0 ? (this.buf[i] ?? 0) : (((this.buf[i] ?? 0) << s) | ((this.buf[i + 1] ?? 0) >> (8 - s))) & 0xff;
  }

  /** RS: a raw signed short */
  rs(): number {
    const lo = this.byte();
    return ((this.byte() << 24) >> 16) | lo;
  }

  /** RL: a raw signed long */
  rl(): number {
    const b0 = this.byte();
    const b1 = this.byte();
    const b2 = this.byte();
    return b0 | (b1 << 8) | (b2 << 16) | (this.byte() << 24);
  }

  /** RD: a raw double */
  rd(): number {
    for (let k = 0; k < 8; k++) scratch.setUint8(k, this.byte());
    return scratch.getFloat64(0, true);
  }

  /** BS: a bit short */
  bs(): number {
    switch (this.bb()) {
      case 0:
        return this.rs();
      case 1:
        return this.byte();
      case 2:
        return 0;
      default:
        return 256;
    }
  }

  /** BL: a bit long */
  bl(): number {
    switch (this.bb()) {
      case 0:
        return this.rl();
      case 1:
        return this.byte();
      default:
        return 0;
    }
  }

  /** BLL: a length in three bits and that many bytes */
  bll(): number {
    const n = (this.bit() << 2) | (this.bit() << 1) | this.bit();
    let v = 0;
    for (let k = 0; k < n; k++) v += this.byte() * 2 ** (8 * k);
    return v;
  }

  /** BD: a bit double */
  bd(): number {
    switch (this.bb()) {
      case 0:
        return this.rd();
      case 1:
        return 1;
      default:
        return 0;
    }
  }

  /** DD: a double stored as a change to a default */
  dd(def: number): number {
    const code = this.bb();
    if (code === 0) return def;
    if (code === 3) return this.rd();
    // 01: four bytes replace the default's first four; 10: two replace its fifth and sixth, then four the first four
    scratch.setFloat64(0, def, true);
    if (code === 2) {
      scratch.setUint8(4, this.byte());
      scratch.setUint8(5, this.byte());
    }
    for (let k = 0; k < 4; k++) scratch.setUint8(k, this.byte());
    return scratch.getFloat64(0, true);
  }

  /** 2RD: a point of two raw doubles */
  rd2(): Pt {
    return { x: this.rd(), y: this.rd() };
  }

  bd3(): { x: number; y: number; z: number } {
    return { x: this.bd(), y: this.bd(), z: this.bd() };
  }

  /** BT: thickness, a single bit for zero from R2000 */
  bt(): number {
    return this.f.v >= 1015 && this.bit() ? 0 : this.bd();
  }

  /** BE: extrusion, a single bit for 0,0,1 from R2000 */
  be(): { x: number; y: number; z: number } {
    return this.f.v >= 1015 && this.bit() ? { x: 0, y: 0, z: 1 } : this.bd3();
  }

  /** MC: a modular char, unsigned */
  mc(): number {
    let v = 0;
    for (let shift = 0; shift < 63; shift += 7) {
      const b = this.byte();
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
    }
    return v;
  }

  /** MS: a modular short */
  ms(): number {
    let v = 0;
    for (let shift = 0; shift < 60; shift += 15) {
      const lo = this.byte();
      const hi = this.byte();
      v += (lo | ((hi & 0x7f) << 8)) * 2 ** shift;
      if ((hi & 0x80) === 0) break;
    }
    return v;
  }

  /** OT: the object type of R2010 on */
  ot(): number {
    switch (this.bb()) {
      case 0:
        return this.byte();
      case 1:
        return 0x1f0 + this.byte();
      default:
        return this.rs() & 0xffff;
    }
  }

  /** H: a handle reference, made absolute against `ref` (the object's own handle) */
  handle(ref = 0): number {
    const form = this.byte();
    const code = form >> 4;
    let n = 0;
    for (let k = form & 0x0f; k > 0; k--) n = n * 256 + this.byte();
    switch (code) {
      case 6:
        return ref + 1;
      case 8:
        return ref - 1;
      case 0x0a:
        return ref + n;
      case 0x0c:
        return ref - n;
      default:
        if (code > 5) throw new Error("a handle has an unknown code");
        return n;
    }
  }

  /** TV before R2007: a length and that many bytes in the drawing's code page */
  tv(): string {
    const n = this.bs();
    if (n <= 0) return "";
    this.room(n * 8);
    const bytes = new Uint8Array(n);
    for (let k = 0; k < n; k++) bytes[k] = this.byte();
    return this.f.decoder.decode(bytes).replace(/\0+$/, "");
  }

  /** TU from R2007: a length and that many UTF-16 characters */
  tu(): string {
    const n = this.bs();
    if (n <= 0) return "";
    this.room(n * 16);
    let s = "";
    for (let k = 0; k < n; k++) {
      const lo = this.byte();
      s += String.fromCharCode(lo | (this.byte() << 8));
    }
    return s.replace(/\0+$/, "");
  }

  /** Throws unless `bits` more bits are left, so a damaged count cannot run on past the data. */
  room(bits: number): void {
    if (!(bits >= 0) || this.pos + bits > this.buf.length * 8) throw new Error("an object runs past its data");
  }
}

/**
 * The string stream of R2007 on: a flag bit just before an object's (or section's) handles says
 * whether the object has strings, and the 16 bits before it (32 for a long one) give their size
 * in bits, ending at that size field. Null when there are none.
 */
function stringStream(buf: Uint8Array, flagPos: number, f: DwgFile): Bits | null {
  const r = new Bits(buf, flagPos, f);
  if (!r.bit()) return null;
  let p = flagPos - 16;
  r.pos = p;
  let size = r.rs() & 0xffff;
  if ((size & 0x8000) !== 0) {
    p -= 16;
    r.pos = p;
    size = (size & 0x7fff) + (r.rs() & 0xffff) * 0x8000;
  }
  return new Bits(buf, p - size, f);
}

// ---- the header, the classes and the object map -----------------------------------------

/**
 * $INSUNITS from the header section, which comes after some 400 other variables in a fixed order
 * that grows with each release; 0 (unitless) for R13 and R14, which have none, or when the header
 * cannot be read. Only the values in the data stream are read: from R2007 the strings and handles
 * are in streams of their own.
 */
/** The header variables the drawing is read with: $INSUNITS (0 before R2000) and $LTSCALE. */
interface Header {
  insunits: number;
  ltscale: number;
}

function headerOf(f: DwgFile, sec: Uint8Array): Header {
  const out: Header = { insunits: 0, ltscale: 1 };
  if (f.v < 1015) return out;
  try {
    readHeader(f, sec, out);
  } catch {
    // what was read before the damage stands
  }
  return out;
}

function readHeader(f: DwgFile, sec: Uint8Array, out: Header): void {
  const v = f.v;
  const m = new Bits(sec, 16 * 8, f);
  m.rl();
  if ((v >= 1024 && f.maint > 3) || v >= 1032) m.rl();
  if (v >= 1021) m.rl();
  const late = v >= 1021;
  const n = (count: number, read: () => unknown): void => {
    for (let k = 0; k < count; k++) read();
  };
  const bit = (): number => m.bit();
  const bs = (): number => m.bs();
  const bl = (): number => m.bl();
  const bd = (): number => m.bd();
  const bd3 = (): unknown => m.bd3();
  const rd2 = (): unknown => m.rd2();
  const tv = (): void => void (late ? 0 : m.tv());
  const h = (): void => void (late ? 0 : m.handle());
  // CMC: an index, and from R2004 a colour, a flag byte and its names
  const cmc = (): void => {
    m.bs();
    if (v < 1018) return;
    m.bl();
    const named = m.byte();
    if ((named & 1) !== 0) tv();
    if ((named & 2) !== 0) tv();
  };

  if (v >= 1027) m.bll(); // REQUIREDVERSIONS
  n(4, bd);
  n(4, tv);
  n(2, bl);
  if (v < 1018) h(); // current viewport
  n(2, bit); // DIMASO, DIMSHO
  n(7, bit); // PLINEGEN, ORTHOMODE, REGENMODE, FILLMODE, QTEXTMODE, PSLTSCALE, LIMCHECK
  if (v >= 1018) bit();
  n(4, bit); // USRTIMER, SKPOLY, ANGDIR, SPLFRAME
  n(2, bit); // MIRRTEXT, WORLDVIEW
  n(3, bit); // TILEMODE, PLIMCHECK, VISRETAIN
  n(2, bit); // DISPSILH, PELLIPSE
  bs(); // PROXYGRAPHICS
  n(5, bs); // TREEDEPTH, LUNITS, LUPREC, AUNITS, AUPREC
  n(2, bs); // ATTMODE, PDMODE
  if (v >= 1018) n(3, bl);
  n(19, bs); // USERI1-5, SPLINESEGS, SURFU, SURFV, SURFTYPE, SURFTAB1-2, SPLINETYPE, SHADEDGE, SHADEDIF, UNITMODE, MAXACTVP, ISOLINES, CMLJUST, TEXTQLTY
  const ltscale = bd();
  if (ltscale > 0 && Number.isFinite(ltscale)) out.ltscale = ltscale;
  n(20, bd); // TEXTSIZE to CELTSCALE
  tv(); // MENU
  n(4, bl); // TDCREATE, TDUPDATE
  if (v >= 1018) n(3, bl);
  n(4, bl); // TDINDWG, TDUSRTIMER
  cmc(); // CECOLOR
  m.handle(); // HANDSEED, which stays in the data stream
  n(v >= 1021 ? 6 : 5, h); // CLAYER, TEXTSTYLE, CELTYPE, (CMATERIAL), DIMSTYLE, CMLSTYLE
  bd(); // PSVPSCALE
  for (let space = 0; space < 2; space++) {
    // paper space, then model space: base, extents, limits, elevation, UCS and its orthographic origins
    n(3, bd3);
    n(2, rd2);
    bd();
    n(3, bd3);
    h();
    h();
    bs();
    h();
    n(6, bd3);
  }
  tv(); // DIMPOST
  tv(); // DIMAPOST
  n(9, bd); // DIMSCALE to DIMTM
  if (v >= 1021) {
    n(2, bd); // DIMFXL, DIMJOGANG
    bs(); // DIMTFILL
    cmc(); // DIMTFILLCLR
  }
  n(6, bit); // DIMTOL, DIMLIM, DIMTIH, DIMTOH, DIMSE1, DIMSE2
  n(3, bs); // DIMTAD, DIMZIN, DIMAZIN
  if (v >= 1021) bs(); // DIMARCSYM
  n(8, bd); // DIMTXT to DIMGAP
  bd(); // DIMALTRND
  bit(); // DIMALT
  bs(); // DIMALTD
  n(4, bit); // DIMTOFL, DIMSAH, DIMTIX, DIMSOXD
  n(3, cmc); // DIMCLRD, DIMCLRE, DIMCLRT
  n(11, bs); // DIMADEC to DIMJUST
  n(2, bit); // DIMSD1, DIMSD2
  n(4, bs); // DIMTOLJ, DIMTZIN, DIMALTZ, DIMALTTZ
  bit(); // DIMUPT
  bs(); // DIMATFIT
  if (v >= 1021) bit(); // DIMFXLON
  if (v >= 1024) {
    bit(); // DIMTXTDIRECTION
    bd(); // DIMALTMZF
    tv(); // DIMALTMZS
    bd(); // DIMMZF
    tv(); // DIMMZS
  }
  n(5, h); // DIMTXSTY, DIMLDRBLK, DIMBLK, DIMBLK1, DIMBLK2
  if (v >= 1021) n(3, h); // DIMLTYPE, DIMLTEX1, DIMLTEX2
  n(2, bs); // DIMLWD, DIMLWE
  n(9, h); // the table control objects
  if (v === 1015) h(); // the viewport entity header control
  n(3, h); // the group, multiline style and named object dictionaries
  n(2, bs); // TSTACKALIGN, TSTACKSIZE
  tv(); // HYPERLINKBASE
  tv(); // STYLESHEET
  n(3, h); // the layout, plot setting and plot style dictionaries
  if (v >= 1018) n(2, h); // materials, colours
  if (v >= 1021) h(); // visual styles
  if (v >= 1027) h();
  bl(); // CELWEIGHT, ENDCAPS, JOINSTYLE and other flags
  const insunits = bs();
  if (insunits >= 0 && insunits <= 24) out.insunits = insunits;
}

interface DwgClass {
  /** its DXF name, upper case */
  readonly name: string;
  /** true for a class of entities, false for other objects */
  readonly entity: boolean;
}

/** The classes section: the object types numbered from 500, by number. A damaged one gives what was read. */
function classesOf(f: DwgFile, sec: Uint8Array): Map<number, DwgClass> {
  const out = new Map<number, DwgClass>();
  const v = f.v;
  try {
    const r = new Bits(sec, 16 * 8, f);
    let end = (20 + r.rl()) * 8;
    if ((v >= 1024 && f.maint > 3) || v > 1027) r.rl();
    let t: Bits | null = null;
    if (v >= 1021) {
      const flagPos = r.pos + r.rl() - 1;
      t = stringStream(sec, flagPos, f);
      end = t ? t.pos : flagPos;
    }
    if (v >= 1018) {
      r.bs(); // the highest class number
      r.byte();
      r.byte();
      r.bit();
    }
    const tv = (): string => (v >= 1021 ? (t ? t.tu() : "") : r.tv());
    while (r.pos + 32 < end) {
      const number = r.bs();
      r.bs(); // proxy flags
      tv(); // application
      tv(); // C++ class
      const name = tv();
      r.bit(); // was a zombie
      const item = r.bs();
      // from R2004: the instance count, versions and two unknowns
      if (v >= 1018) for (let k = 0; k < 5; k++) r.bl();
      out.set(number, { name: name.toUpperCase(), entity: item === 0x1f2 });
    }
  } catch {
    // the classes read so far stand
  }
  return out;
}

/**
 * The object map: each object's handle and where it starts, in handle order. It comes in runs of
 * at most 2032 bytes, each a big-endian size, pairs of offsets from the previous handle and place,
 * and a CRC.
 */
function objectMap(sec: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  let p = 0;
  while (p + 2 <= sec.length) {
    const size = (sec[p] << 8) | sec[p + 1];
    if (size <= 2) break;
    const end = Math.min(sec.length, p + size);
    let q = p + 2;
    let handle = 0;
    let at = 0;
    while (q < end) {
      // the handle step is unsigned; the place step's last byte carries a sign in its 0x40 bit
      let step = 0;
      for (let shift = 0; q < end; shift += 7) {
        const b = sec[q++];
        step += (b & 0x7f) * 2 ** shift;
        if ((b & 0x80) === 0) break;
      }
      let move = 0;
      for (let shift = 0; q < end; shift += 7) {
        const b = sec[q++];
        if ((b & 0x80) !== 0) {
          move += (b & 0x7f) * 2 ** shift;
          continue;
        }
        move += (b & 0x3f) * 2 ** shift;
        if ((b & 0x40) !== 0) move = -move;
        break;
      }
      handle += step;
      at += move;
      if (step > 0) out.push([handle, at]);
    }
    if (out.length > MAX_OBJECTS) throw new Error(`the drawing has more than ${MAX_OBJECTS} objects`);
    p += size + 2;
  }
  return out;
}

// ---- the objects -------------------------------------------------------------------

/** An entity decoded into DXF group codes, before its layer, block and children are tied in. */
interface Rec {
  readonly handle: number;
  /** its DXF type: "LINE", "POLYLINE", "VERTEX", ... */
  readonly type: string;
  readonly pairs: Pair[];
  /** 0 when it belongs to an owner (a block, a polyline, an insert), 1 in paper space, 2 in model space */
  readonly mode: number;
  readonly owner: number;
  /** its layer's handle */
  readonly layer: number;
  /** the block an INSERT or DIMENSION draws, by its block header's handle; 0 for none */
  readonly ref: number;
  /** its line type's handle, or BY_LAYER, BY_BLOCK or CONTINUOUS */
  readonly lineType: number;
  /** a solid, region or body's ACIS data (see Entry.data) */
  readonly data?: Uint8Array;
}

const BY_LAYER = -1;
const BY_BLOCK = -2;
const CONTINUOUS = -3;

/** A LAYER record: its name and how what is on it draws. */
interface DwgLayer {
  readonly name: string;
  /** 0xRRGGBB */
  readonly color: number;
  /** its line type's handle, 0 for none */
  readonly lineType: number;
  /** hundredths of a millimetre; negative for the default */
  readonly weight: number;
  readonly shown: boolean;
}

interface BlockHeader {
  readonly name: string;
  readonly base: Pt;
  /** the base point's z */
  readonly baseZ: number;
  /** an external reference, whose objects are in another file */
  readonly xref: boolean;
  /** an overlay: an xref that is not shown inside another xref */
  readonly overlay: boolean;
  /** an xref's file, as the drawing gives it; empty for other blocks */
  readonly path: string;
}

interface Db {
  readonly recs: Rec[];
  readonly blocks: Map<number, BlockHeader>;
  readonly layers: Map<number, DwgLayer>;
  readonly lineTypes: Map<number, DxfLineType>;
  /** entities that could not be decoded, by DXF type */
  readonly unreadable: Record<string, number>;
}

/** What one object's decoder reads from: its data, handle and string streams. */
interface Ctx {
  readonly f: DwgFile;
  readonly m: Bits;
  readonly h: Bits;
  /** the string stream from R2007; null when the object has no strings */
  readonly t: Bits | null;
  readonly handle: number;
  /** the bit where the object's data ends and its handles (or, from R2007, its strings) begin */
  readonly end: number;
}

/** A TV string: in the data stream before R2007, in the string stream after. */
function text(c: Ctx): string {
  return c.f.v >= 1021 ? (c.t ? c.t.tu() : "") : c.m.tv();
}

function readObjects(f: DwgFile, buf: Uint8Array, map: readonly [number, number][], classes: ReadonlyMap<number, DwgClass>, acis: ReadonlyMap<number, Uint8Array>): Db {
  const db: Db = { recs: [], blocks: new Map(), layers: new Map(), lineTypes: new Map(), unreadable: {} };
  for (const [, at] of map) {
    let name = "";
    try {
      readObject(f, buf, at, classes, db, (n) => (name = n));
    } catch {
      if (name) db.unreadable[name] = (db.unreadable[name] ?? 0) + 1;
    }
  }
  // from R2013 a solid's ACIS data is not in the entity: it comes from the prototype section, by handle
  db.recs.forEach((r, i) => {
    const data = acis.get(r.handle);
    if (data && ACIS_TYPES.has(r.type)) db.recs[i] = { ...r, data };
  });
  return db;
}

/**
 * Reads the object at byte `at`: an entity into a Rec, a layer's or block's name into the tables;
 * anything else is passed over. `named` hears an entity's DXF name before its data is decoded, so
 * a failure can be counted against it.
 */
function readObject(
  f: DwgFile,
  buf: Uint8Array,
  at: number,
  classes: ReadonlyMap<number, DwgClass>,
  db: Db,
  named: (name: string) => void,
): void {
  const v = f.v;
  const r = new Bits(buf, at * 8, f);
  const size = r.ms();
  const handleBits = v >= 1024 ? r.mc() : 0;
  const start = r.pos;
  const end = start + size * 8;
  if (size <= 0 || end > buf.length * 8) return;
  const type = v >= 1024 ? r.ot() : r.bs();
  const cls = type >= 500 ? classes.get(type) : undefined;
  const entity = cls ? cls.entity : ENTITY_NAMES[type] !== undefined;
  if (!entity && type !== LAYER && type !== BLOCK_HEADER && type !== LTYPE) return;
  const name = cls ? cls.name : (ENTITY_NAMES[type] ?? "");
  if (entity) named(name);

  // where the handle stream starts: given before the handle from R2000, after the EED in R13 and R14
  let hpos = end - handleBits;
  if (v >= 1015 && v < 1024) hpos = start + r.rl();
  const handle = r.handle();
  for (let eed = r.bs(); eed !== 0; eed = r.bs()) {
    r.handle();
    r.room(eed * 8);
    r.pos += eed * 8;
  }
  if (entity && r.bit()) {
    // a proxy graphic image
    const bytes = v >= 1024 ? r.bll() : r.rl();
    r.room(bytes * 8);
    r.pos += bytes * 8;
  }
  if (v <= 1014) hpos = start + r.rl();
  if (hpos < start || hpos > end) throw new Error("an object's handles are out of place");
  const t = v >= 1021 ? stringStream(buf, hpos - 1, f) : null;
  const c: Ctx = { f, m: r, h: new Bits(buf, hpos, f), t, handle, end: t ? t.pos : hpos };

  if (!entity) {
    objectHead(c);
    const title = text(c);
    if (v >= 1021) r.bs();
    else {
      r.bit();
      r.bs();
      r.bit();
    }
    if (type === LAYER) db.layers.set(handle, layerRecord(c, title));
    else if (type === LTYPE) db.lineTypes.set(handle, { name: title, dashes: lineTypeDashes(c) });
    else db.blocks.set(handle, blockHeader(c, title));
    return;
  }

  const head = entityHead(c);
  // invisible entities are not drawn
  if ((head.invisible & 1) !== 0) return;
  const body = decodeEntity(c, type, cls?.name ?? "", name);
  if (body) {
    const pairs = [...body.pairs, ...head.style];
    db.recs.push({ handle, type: body.type, pairs, mode: head.mode, owner: head.owner, layer: head.layer, ref: body.ref ?? 0, lineType: head.lineType, data: body.data });
  }
}

/**
 * A colour as a CMC holds it: an index before R2004; from R2004 a flagged colour (its top byte
 * 0xC2 for a true colour, 0xC3 for an index), a flag byte and the names it says follow. Returns
 * 0xRRGGBB, or an index (0 by block, 256 by layer) when `index` is set and it is one.
 */
function cmcColor(c: Ctx): { rgb: number | null; index: number } {
  const m = c.m;
  const index = m.bs();
  if (c.f.v < 1018) return { rgb: null, index };
  const value = m.bl() >>> 0;
  const named = m.byte();
  if ((named & 1) !== 0) text(c);
  if ((named & 2) !== 0) text(c);
  const kind = value >>> 24;
  if (kind === 0xc2) return { rgb: value & 0xffffff, index };
  if (kind === 0xc3) return { rgb: null, index: value & 0xff };
  if (kind === 0xc0) return { rgb: null, index: 256 };
  if (kind === 0xc1) return { rgb: null, index: 0 };
  return { rgb: null, index };
}

/** A LAYER record after its name: whether it is shown, its weight, colour and line type. */
function layerRecord(c: Ctx, name: string): DwgLayer {
  const { m, h } = c;
  const v = c.f.v;
  let shown = true;
  let weight = -3;
  if (v <= 1014) {
    // frozen, off (which the ODA's notes call on), frozen in new viewports, locked
    const frozen = m.bit();
    const off = m.bit();
    m.bit();
    m.bit();
    shown = off === 0 && frozen === 0;
  } else {
    // frozen (1), off (2), frozen in new viewports (4), locked (8), plotted (16), and the weight's index
    const flags = m.bs();
    shown = (flags & 3) === 0;
    weight = lineWeightOf((flags >> 5) & 0x1f);
  }
  const { rgb, index } = cmcColor(c);
  // a negative index is a layer turned off
  if (index < 0) shown = false;
  h.handle(c.handle); // the external reference's block
  if (v >= 1015) h.handle(c.handle); // plot style
  if (v >= 1021) h.handle(c.handle); // material
  const lineType = h.handle(c.handle);
  return { name, color: rgb ?? aciColor(Math.abs(index) || 7), lineType, weight, shown };
}

/** A weight index as hundredths of a millimetre; negative (by layer, by block, the default) for the others. */
function lineWeightOf(index: number): number {
  return LINE_WEIGHTS[index] ?? (index === 28 || index === 29 ? -1 : index === 30 ? -2 : -3);
}

/** An LTYPE record's dashes, after its name: its description, length, alignment and dash count first. */
function lineTypeDashes(c: Ctx): number[] {
  const m = c.m;
  text(c); // description
  m.bd(); // pattern length
  m.byte(); // alignment
  const n = m.byte();
  const dashes: number[] = [];
  for (let k = 0; k < n; k++) {
    dashes.push(m.bd());
    m.bs(); // shape number
    m.rd(); // x and y offset
    m.rd();
    m.bd(); // scale
    m.bd(); // rotation
    m.bs(); // shape flags
  }
  return dashes;
}

/** A non-graphic object's owner, reactors and extension dictionary. */
function objectHead(c: Ctx): void {
  const { m, h } = c;
  const v = c.f.v;
  h.handle(c.handle);
  const reactors = m.bl();
  m.room(reactors);
  for (let k = 0; k < reactors; k++) h.handle(c.handle);
  const noXdic = v >= 1018 && m.bit() === 1;
  if (!noXdic) h.handle(c.handle);
  if (v >= 1027) m.bit();
}

function blockHeader(c: Ctx, name: string): BlockHeader {
  const m = c.m;
  const v = c.f.v;
  m.bit(); // anonymous
  m.bit(); // has attributes
  const xref = m.bit() === 1;
  const overlaid = m.bit() === 1;
  if (v >= 1015) m.bit(); // loaded
  if (v >= 1018 && !xref && !overlaid) m.bl(); // owned objects
  const base = m.bd3();
  // the file name follows the base point; it is read only for an xref, as nothing after it is needed
  const path = xref || overlaid ? text(c) : "";
  return { name, base: { x: base.x, y: base.y }, baseZ: base.z, xref: xref || overlaid, overlay: overlaid, path };
}

interface Head {
  readonly mode: number;
  readonly owner: number;
  readonly layer: number;
  readonly invisible: number;
  /** its line type: a handle, or BY_LAYER, BY_BLOCK or CONTINUOUS */
  readonly lineType: number;
  /** its colour (62 or 420), weight (370) and line type scale (48) as DXF groups */
  readonly style: Pair[];
}

/** The data every entity starts with: its owner, layer, colour, linetype and the rest. */
function entityHead(c: Ctx): Head {
  const { m, h } = c;
  const v = c.f.v;
  const mode = m.bb();
  const owner = mode === 0 ? h.handle(c.handle) : 0;
  const reactors = m.bl();
  m.room(reactors);
  for (let k = 0; k < reactors; k++) h.handle(c.handle);
  const noXdic = v >= 1018 && m.bit() === 1;
  if (!noXdic) h.handle(c.handle);
  if (v >= 1027) m.bit(); // binary data in the data store
  let layer = 0;
  let lineType = BY_LAYER;
  if (v <= 1014) {
    layer = h.handle(c.handle);
    if (!m.bit()) lineType = h.handle(c.handle); // a linetype other than by layer
  }
  if (v < 1018 && !m.bit()) {
    // links to the previous and next entity
    h.handle(c.handle);
    h.handle(c.handle);
  }
  const style: Pair[] = [];
  if (v >= 1018) {
    // the colour: an index with flags, then a true colour or a colour book entry, and a transparency
    const colour = m.bs();
    let rgb: number | null = null;
    let index = colour & 0x1ff;
    if ((colour & 0x4000) !== 0) {
      // a colour book's, kept in the object the handle names (0x8000 is set too, but no colour
      // follows): its index bits stand in for it
      if (!(index >= 1 && index <= 255)) index = 256;
      h.handle(c.handle);
    } else if ((colour & 0x8000) !== 0) {
      const value = m.bl() >>> 0;
      const kind = value >>> 24;
      if (kind === 0xc3) index = value & 0xff;
      else if (kind === 0xc0) index = 256;
      else if (kind === 0xc1) index = 0;
      else rgb = value & 0xffffff;
    }
    if ((colour & 0x2000) !== 0) m.bl();
    style.push(rgb !== null ? pair(420, rgb) : pair(62, index));
  } else {
    style.push(pair(62, m.bs()));
  }
  style.push(pair(48, m.bd())); // linetype scale
  if (v >= 1015) {
    layer = h.handle(c.handle);
    const flags = m.bb();
    if (flags === 3) lineType = h.handle(c.handle);
    else lineType = [BY_LAYER, BY_BLOCK, CONTINUOUS][flags];
    if (v >= 1021) {
      if (m.bb() === 3) h.handle(c.handle); // material
      m.byte(); // shadows
    }
    if (m.bb() === 3) h.handle(c.handle); // plot style
    if (v >= 1024) {
      // full, face and edge visual styles
      for (let k = 0; k < 3; k++) if (m.bit()) h.handle(c.handle);
    }
  }
  const invisible = m.bs();
  if (v >= 1015) style.push(pair(370, lineWeightOf(m.byte())));
  return { mode, owner, layer, invisible, lineType, style };
}

/** A decoded entity: its DXF type and group codes, and the block it draws. */
interface Body {
  readonly type: string;
  readonly pairs: Pair[];
  readonly ref?: number;
  /** a solid, region or body's ACIS data, when the entity holds it (before R2013) */
  readonly data?: Uint8Array;
}

const DEG = Math.PI / 180;

function pair(code: number, value: number | string): Pair {
  return { code, value: String(value) };
}

/** Group codes 10 and 20 (or code and code + 10) for a point. */
function at(code: number, p: { x: number; y: number }): Pair[] {
  return [pair(code, p.x), pair(code + 10, p.y)];
}

/** Group codes 10, 20 and 30 (or code, code + 10 and code + 20) for a 3D point. */
function at3(code: number, p: { x: number; y: number; z: number }): Pair[] {
  return [...at(code, p), pair(code + 20, p.z)];
}

/** A 3D point stored as changes to a default point, one coordinate at a time (see Bits.dd). */
function dd3(m: Bits, def: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: m.dd(def.x), y: m.dd(def.y), z: m.dd(def.z) };
}

/** The extrusion as 210/220/230, left out when it is the usual +z. */
function extrusion(n: { x: number; y: number; z: number }): Pair[] {
  if (n.x === 0 && n.y === 0 && n.z > 0) return [];
  return [pair(210, n.x), pair(220, n.y), pair(230, n.z)];
}

/**
 * The entity-specific part of an entity, as the DXF group codes import/dxf.ts reads. Types it has
 * no drawing for come back with no codes, so the walk counts them as skipped; definitions and
 * markers (BLOCK, ENDBLK, SEQEND, ATTDEF, mesh vertices) come back null.
 */
function decodeEntity(c: Ctx, type: number, className: string, name: string): Body | null {
  const m = c.m;
  switch (type) {
    case 1: // TEXT
    case 2: // ATTRIB
      return textEntity(c, type === 2);
    case 7: // INSERT
    case 8: // MINSERT
      return insertEntity(c, type === 8);
    case 10: {
      // VERTEX of a 2D polyline
      const flags = m.byte();
      const p = m.bd3();
      const width = m.bd();
      if (width >= 0) m.bd();
      const bulge = m.bd();
      return { type: "VERTEX", pairs: [pair(70, flags), ...at(10, p), pair(42, bulge)] };
    }
    case 11: {
      // VERTEX of a 3D polyline
      const flags = m.byte();
      return { type: "VERTEX", pairs: [pair(70, flags), ...at(10, m.bd3())] };
    }
    case 15: {
      // 2D POLYLINE; its vertices follow as objects of their own
      const flags = m.bs();
      m.bs(); // curve type
      m.bd();
      m.bd(); // start and end width
      m.bt();
      m.bd(); // elevation
      return { type: "POLYLINE", pairs: [pair(70, flags & ~(8 | 16 | 64)), ...extrusion(m.be())] };
    }
    case 16: {
      // 3D POLYLINE
      m.byte(); // spline fitting
      const closed = m.byte() & 1;
      return { type: "POLYLINE", pairs: [pair(70, 8 | closed)] };
    }
    case 17: {
      const center = m.bd3();
      const radius = m.bd();
      m.bt();
      const n = m.be();
      const start = m.bd();
      const end = m.bd();
      return { type: "ARC", pairs: [...at(10, center), pair(40, radius), pair(50, start / DEG), pair(51, end / DEG), ...extrusion(n)] };
    }
    case 18: {
      const center = m.bd3();
      const radius = m.bd();
      m.bt();
      return { type: "CIRCLE", pairs: [...at(10, center), pair(40, radius), ...extrusion(m.be())] };
    }
    case 19:
      return lineEntity(c);
    case 20:
    case 21:
    case 22:
    case 23:
    case 24:
    case 25:
    case 26:
      return dimensionEntity(c);
    case 27:
      return { type: "POINT", pairs: at(10, m.bd3()) };
    case 31:
    case 32: {
      // SOLID and TRACE: four corners in the OCS
      m.bt();
      m.bd(); // elevation
      const corners = [m.rd2(), m.rd2(), m.rd2(), m.rd2()];
      return { type: name, pairs: [...corners.flatMap((p, i) => at(10 + i, p)), ...extrusion(m.be())] };
    }
    case 35: {
      const center = m.bd3();
      const major = m.bd3();
      const n = m.bd3();
      const ratio = m.bd();
      const t0 = m.bd();
      const t1 = m.bd();
      return { type: "ELLIPSE", pairs: [...at(10, center), ...at(11, major), pair(40, ratio), pair(41, t0), pair(42, t1), ...extrusion(n)] };
    }
    case 36:
      return splineEntity(c);
    case 37: // REGION
    case 38: // 3DSOLID
    case 39: // BODY
      return modelerEntity(c, name);
    case 44:
      return mtextEntity(c);
    case 45: {
      // LEADER: its path; the arrowhead and the note are left to other objects
      m.bit();
      m.bs(); // annotation type
      m.bs(); // path type
      const count = m.bl();
      m.room(count * 6);
      const pairs: Pair[] = [];
      for (let k = 0; k < count; k++) pairs.push(...at(10, m.bd3()));
      return { type: "LEADER", pairs };
    }
    case 77:
      return lwPolyline(c);
    case 78:
      return hatchEntity(c);
    case 28:
      return faceEntity(c);
    case 29: {
      // a polyface mesh; its vertices and face records follow as objects of their own
      m.bs(); // vertex count
      m.bs(); // face count
      return { type: "POLYLINE", pairs: [pair(70, 64)] };
    }
    case 30: {
      // a polygon mesh; its vertices follow as objects of their own
      const flags = m.bs();
      const smooth = m.bs();
      const mCount = m.bs();
      const nCount = m.bs();
      const mDensity = m.bs();
      const nDensity = m.bs();
      return {
        type: "POLYLINE",
        pairs: [pair(70, flags | 16), pair(71, mCount), pair(72, nCount), pair(73, mDensity), pair(74, nDensity), pair(75, smooth)],
      };
    }
    case 12: {
      // a polygon mesh's vertex, which belongs to its polygon mesh (flag 64)
      const flags = m.byte();
      return { type: "VERTEX", pairs: [pair(70, flags | 64), ...at3(10, m.bd3())] };
    }
    case 13: {
      // a polyface mesh's position vertex (flags 128 and 64)
      const flags = m.byte();
      return { type: "VERTEX", pairs: [pair(70, flags | 192), ...at3(10, m.bd3())] };
    }
    case 14: {
      // a polyface mesh's face record: its corners' numbers among the positions (71 to 74, 0 for none)
      const corners = [m.bs(), m.bs(), m.bs(), m.bs()];
      return { type: "VERTEX", pairs: [pair(70, 128), ...corners.map((v, k) => pair(71 + k, v))] };
    }
    case 3: // ATTDEF
    case 4: // BLOCK
    case 5: // ENDBLK
    case 6: // SEQEND
      return null;
    default:
      if (className === "LWPOLYLINE" || className === "LWPLINE") return lwPolyline(c);
      if (className === "HATCH") return hatchEntity(c);
      if (CLASS_DIMENSIONS.has(className)) return dimensionEntity(c);
      if (className === "MESH") return meshEntity(c);
      // a table begins as an insert of the anonymous block that draws it
      if (className === "ACAD_TABLE") return { ...insertEntity(c, false), type: "ACAD_TABLE" };
      if (className === "MULTILEADER") return multileaderEntity(c);
      return { type: name || "UNKNOWN", pairs: [] };
  }
}

/**
 * A 3DFACE: its four corners in world coordinates (a triangle's fourth is its third) and its invisible
 * edges (70). From R2000 the first corner is raw and each later one is a change to the one before.
 */
function faceEntity(c: Ctx): Body {
  const m = c.m;
  let corners: { x: number; y: number; z: number }[];
  let flags = 0;
  if (c.f.v >= 1015) {
    const noFlags = m.bit() === 1;
    const zIsZero = m.bit() === 1;
    const x = m.rd();
    const y = m.rd();
    const z = zIsZero ? 0 : m.rd();
    const second = dd3(m, { x, y, z });
    const third = dd3(m, second);
    const fourth = dd3(m, third);
    corners = [{ x, y, z }, second, third, fourth];
    if (!noFlags) flags = m.bs();
  } else {
    corners = [m.bd3(), m.bd3(), m.bd3(), m.bd3()];
    flags = m.bs();
  }
  return { type: "3DFACE", pairs: [...at3(10, corners[0]), ...at3(11, corners[1]), ...at3(12, corners[2]), ...at3(13, corners[3]), pair(70, flags)] };
}

/**
 * A MESH (AcDbSubDMesh), as a DXF one: its vertices (92, and 10 to 30) and its face list (93 items: each
 * face's corner count, then its corners' indices from 0). Its base cage is what is read; the subdivision
 * levels, edges and creases are not.
 */
function meshEntity(c: Ctx): Body {
  const m = c.m;
  m.bs(); // version
  m.bit(); // blend crease
  m.bl(); // subdivision level
  const count = m.bl();
  m.room(count * 6);
  const verts: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < count; k++) verts.push(m.bd3());
  const size = m.bl();
  m.room(size * 2);
  const items: number[] = [];
  let used = 0;
  while (used < size) {
    const corners = m.bl();
    if (corners < 0 || used + corners + 1 > size) throw new Error("a MESH face runs past its face list");
    items.push(corners);
    for (let k = 0; k < corners; k++) items.push(m.bl());
    used += corners + 1;
  }
  return { type: "MESH", pairs: [pair(92, count), ...verts.flatMap((p) => at3(10, p)), pair(93, size), ...items.map((v) => pair(90, v))] };
}

/**
 * A HATCH: from R2004 its gradient (the first colour kept as 421), then its elevation, extrusion,
 * pattern name, solid fill flag, loops and pattern lines, as the groups a DXF HATCH has them in
 * (angles in degrees).
 */
function hatchEntity(c: Ctx): Body {
  const m = c.m;
  const v = c.f.v;
  const pairs: Pair[] = [];
  const gradient: Pair[] = [];
  if (v >= 1018) {
    const on = m.bl() !== 0;
    m.bl(); // reserved
    m.bd(); // angle
    m.bd(); // shift
    m.bl(); // single colour
    m.bd(); // tint
    const colours = m.bl();
    m.room(colours);
    for (let k = 0; k < colours; k++) {
      m.bd(); // where the colour sits
      const { rgb, index } = cmcColor(c);
      if (k === 0 && on) gradient.push(pair(450, 1), pair(463, 0), pair(421, rgb ?? aciColor(index)));
    }
    text(c); // gradient name
  }
  const z = m.bd();
  const n = m.bd3();
  pairs.push(pair(10, 0), pair(20, 0), pair(30, z), ...extrusion(n));
  pairs.push(pair(2, text(c)));
  const solid = m.bit();
  pairs.push(pair(70, solid), pair(71, m.bit()), ...gradient);
  const loops = m.bl();
  m.room(loops);
  pairs.push(pair(91, loops));
  let derived = false;
  const deg = (rad: number): number => rad / DEG;
  for (let k = 0; k < loops; k++) {
    const flags = m.bl();
    if ((flags & 4) !== 0) derived = true;
    pairs.push(pair(92, flags));
    if ((flags & 2) === 0) {
      const edges = m.bl();
      m.room(edges);
      pairs.push(pair(93, edges));
      for (let j = 0; j < edges; j++) {
        const kind = m.byte();
        pairs.push(pair(72, kind));
        if (kind === 1) {
          pairs.push(...at(10, m.rd2()), ...at(11, m.rd2()));
        } else if (kind === 2) {
          pairs.push(...at(10, m.rd2()), pair(40, m.bd()), pair(50, deg(m.bd())), pair(51, deg(m.bd())), pair(73, m.bit()));
        } else if (kind === 3) {
          pairs.push(...at(10, m.rd2()), ...at(11, m.rd2()), pair(40, m.bd()), pair(50, deg(m.bd())), pair(51, deg(m.bd())), pair(73, m.bit()));
        } else if (kind === 4) {
          const degree = m.bl();
          const rational = m.bit();
          const periodic = m.bit();
          const knots = m.bl();
          const ctrl = m.bl();
          m.room(knots + ctrl);
          pairs.push(pair(94, degree), pair(73, rational), pair(74, periodic), pair(95, knots), pair(96, ctrl));
          for (let q = 0; q < knots; q++) pairs.push(pair(40, m.bd()));
          for (let q = 0; q < ctrl; q++) {
            pairs.push(...at(10, m.rd2()));
            if (rational) pairs.push(pair(42, m.bd()));
          }
          if (v >= 1024) {
            const fit = m.bl();
            m.room(fit);
            if (fit > 0) {
              pairs.push(pair(97, fit));
              for (let q = 0; q < fit; q++) pairs.push(...at(11, m.rd2()));
              pairs.push(...at(12, m.rd2()), ...at(13, m.rd2()));
            }
          }
        } else {
          throw new Error(`a hatch edge of unknown type ${kind}`);
        }
      }
    } else {
      const bulged = m.bit();
      const closed = m.bit();
      const count = m.bl();
      m.room(count);
      pairs.push(pair(72, bulged), pair(73, closed), pair(93, count));
      for (let j = 0; j < count; j++) {
        pairs.push(...at(10, m.rd2()));
        if (bulged) pairs.push(pair(42, m.bd()));
      }
    }
    // the objects the loop was made from, whose handles are in the handle stream
    m.bl();
    pairs.push(pair(97, 0));
  }
  pairs.push(pair(75, m.bs()), pair(76, m.bs()));
  if (!solid) {
    pairs.push(pair(52, deg(m.bd())), pair(41, m.bd()), pair(77, m.bit()));
    const lines = m.bs();
    m.room(lines);
    pairs.push(pair(78, lines));
    for (let k = 0; k < lines; k++) {
      pairs.push(pair(53, deg(m.bd())), pair(43, m.bd()), pair(44, m.bd()), pair(45, m.bd()), pair(46, m.bd()));
      const dashes = m.bs();
      m.room(dashes);
      pairs.push(pair(79, dashes));
      for (let j = 0; j < dashes; j++) pairs.push(pair(49, m.bd()));
    }
  }
  if (derived) m.bd(); // pixel size
  return { type: "HATCH", pairs };
}

function lineEntity(c: Ctx): Body {
  const m = c.m;
  let a: Pt;
  let b: Pt;
  if (c.f.v <= 1014) {
    a = m.bd3();
    b = m.bd3();
  } else {
    // the end is stored as a change from the start
    const flat = m.bit() === 1;
    const ax = m.rd();
    const bx = m.dd(ax);
    const ay = m.rd();
    const by = m.dd(ay);
    if (!flat) m.dd(m.rd());
    a = { x: ax, y: ay };
    b = { x: bx, y: by };
  }
  return { type: "LINE", pairs: [...at(10, a), ...at(11, b)] };
}

/** TEXT and ATTRIB: the anchor, alignment point, height, turn and justification, in the OCS. */
function textEntity(c: Ctx, attrib: boolean): Body {
  const m = c.m;
  const v = c.f.v;
  let ins: Pt;
  let align: Pt | null = null;
  let n: { x: number; y: number; z: number };
  let rotation = 0;
  let height: number;
  let value: string;
  let hAlign = 0;
  let vAlign = 0;
  if (v <= 1014) {
    m.bd(); // elevation
    ins = m.rd2();
    align = m.rd2();
    n = m.bd3();
    m.bd(); // thickness
    m.bd(); // oblique angle
    rotation = m.bd();
    height = m.bd();
    m.bd(); // width factor
    value = text(c);
    m.bs(); // mirroring
    hAlign = m.bs();
    vAlign = m.bs();
  } else {
    // a flag byte says which values are left at their defaults
    const fl = m.byte();
    if ((fl & 1) === 0) m.rd();
    ins = m.rd2();
    if ((fl & 2) === 0) align = { x: m.dd(ins.x), y: m.dd(ins.y) };
    n = m.be();
    m.bt();
    if ((fl & 4) === 0) m.rd();
    if ((fl & 8) === 0) rotation = m.rd();
    height = m.rd();
    if ((fl & 0x10) === 0) m.rd();
    value = text(c);
    if ((fl & 0x20) === 0) m.bs();
    if ((fl & 0x40) === 0) hAlign = m.bs();
    if ((fl & 0x80) === 0) vAlign = m.bs();
  }
  const pairs = [...at(10, ins), ...(align ? at(11, align) : []), pair(40, height), pair(50, rotation / DEG), pair(1, value)];
  pairs.push(pair(72, hAlign), pair(attrib ? 74 : 73, vAlign), ...extrusion(n));
  if (attrib) {
    if (v >= 1024) m.byte(); // version
    // a multi-line attribute (2018 on) holds an MTEXT; it is shown as its one-line value
    const kind = v >= 1032 ? m.byte() : 1;
    if (kind !== 2 && kind !== 4) {
      text(c); // tag
      m.bs(); // field length
      pairs.push(pair(70, m.byte()));
    }
  }
  return { type: attrib ? "ATTRIB" : "TEXT", pairs };
}

/** MTEXT: its anchor, direction, height, attachment and text, in world coordinates. */
function mtextEntity(c: Ctx): Body {
  const m = c.m;
  const ins = m.bd3();
  m.bd3(); // extrusion
  const dir = m.bd3();
  m.bd(); // rectangle width
  if (c.f.v >= 1021) m.bd(); // rectangle height
  const height = m.bd();
  const attach = m.bs();
  m.bs(); // drawing direction
  m.bd();
  m.bd(); // extents
  const value = text(c);
  return { type: "MTEXT", pairs: [...at(10, ins), ...at(11, dir), pair(40, height), pair(71, attach), pair(1, value)] };
}

/** INSERT and MINSERT: the block, where, how scaled and turned, and for MINSERT the array. */
function insertEntity(c: Ctx, array: boolean): Body {
  const m = c.m;
  const v = c.f.v;
  const ins = m.bd3();
  let sx = 1;
  let sy = 1;
  let sz = 1;
  if (v <= 1014) {
    const s = m.bd3();
    sx = s.x;
    sy = s.y;
    sz = s.z;
  } else {
    switch (m.bb()) {
      case 0:
        sx = m.rd();
        sy = m.dd(sx);
        sz = m.dd(sx);
        break;
      case 1:
        sy = m.dd(1);
        sz = m.dd(1);
        break;
      case 2:
        sx = m.rd();
        sy = sx;
        sz = sx;
        break;
    }
  }
  const rotation = m.bd();
  const n = m.bd3();
  const hasAttribs = m.bit() === 1;
  if (v >= 1018 && hasAttribs) m.bl(); // owned attributes
  const pairs = [...at(10, ins), pair(41, sx), pair(42, sy), pair(43, sz), pair(50, rotation / DEG), ...extrusion(n)];
  if (array) pairs.push(pair(70, m.bs()), pair(71, m.bs()), pair(44, m.bd()), pair(45, m.bd()));
  return { type: "INSERT", pairs, ref: c.h.handle(c.handle) };
}

/** A DIMENSION of any kind: drawn through its anonymous block, placed at its clone insertion point. */
function dimensionEntity(c: Ctx): Body {
  const m = c.m;
  const v = c.f.v;
  if (v >= 1024) m.byte(); // version
  const n = m.bd3();
  m.rd2(); // text middle point
  m.bd(); // elevation
  m.byte(); // flags
  text(c); // the text as typed
  m.bd(); // text rotation
  m.bd(); // horizontal direction
  m.bd3(); // insertion scale
  m.bd(); // insertion rotation
  if (v >= 1015) {
    m.bs(); // attachment point
    m.bs(); // line spacing style
    m.bd(); // line spacing factor
    m.bd(); // measurement
  }
  if (v >= 1021) {
    m.bit();
    m.bit();
    m.bit(); // flipped arrows
  }
  const clone = m.rd2();
  c.h.handle(c.handle); // dimension style
  return { type: "DIMENSION", pairs: [...at(12, clone), ...extrusion(n)], ref: c.h.handle(c.handle) };
}

function lwPolyline(c: Ctx): Body {
  const m = c.m;
  const flags = m.bs();
  if ((flags & 4) !== 0) m.bd(); // constant width
  if ((flags & 8) !== 0) m.bd(); // elevation
  if ((flags & 2) !== 0) m.bd(); // thickness
  const n = (flags & 1) !== 0 ? m.bd3() : { x: 0, y: 0, z: 1 };
  const count = m.bl();
  const bulges = (flags & 0x10) !== 0 ? m.bl() : 0;
  if ((flags & 0x400) !== 0) m.bl(); // vertex ids
  if ((flags & 0x20) !== 0) m.bl(); // widths
  m.room(count * 2 + bulges * 2);
  const pts: Pt[] = [];
  if (c.f.v <= 1014) {
    for (let k = 0; k < count; k++) pts.push(m.rd2());
  } else if (count > 0) {
    // each vertex after the first is stored as a change from the one before
    let p = m.rd2();
    pts.push(p);
    for (let k = 1; k < count; k++) {
      p = { x: m.dd(p.x), y: m.dd(p.y) };
      pts.push(p);
    }
  }
  const bulge: number[] = [];
  for (let k = 0; k < bulges; k++) bulge.push(m.bd());
  const pairs: Pair[] = [pair(70, (flags & 0x200) !== 0 ? 1 : 0)];
  pts.forEach((p, k) => pairs.push(...at(10, p), pair(42, bulge[k] ?? 0)));
  return { type: "LWPOLYLINE", pairs: [...pairs, ...extrusion(n)] };
}

/** SPLINE: its degree, knots, control points and weights, or its fit points. */
function splineEntity(c: Ctx): Body {
  const m = c.m;
  const v = c.f.v;
  let scenario = m.bl();
  let closed = false;
  if (v >= 1027) {
    const flags = m.bl();
    const knotParameters = m.bl();
    closed = (flags & 4) !== 0;
    scenario = knotParameters === 15 || (flags & 8) === 0 ? 1 : 2;
  }
  const degree = m.bl();
  let rational = false;
  let periodic = false;
  let knots = 0;
  let ctrl = 0;
  let fit = 0;
  let weighted = false;
  let tangents: { x: number; y: number; z: number }[] = [];
  if (scenario === 1) {
    rational = m.bit() === 1;
    closed = m.bit() === 1 || closed;
    periodic = m.bit() === 1;
    m.bd(); // knot tolerance
    m.bd(); // control point tolerance
    knots = m.bl();
    ctrl = m.bl();
    weighted = m.bit() === 1;
  } else if (scenario === 2) {
    m.bd(); // fit tolerance
    tangents = [m.bd3(), m.bd3()];
    fit = m.bl();
  }
  m.room(knots * 2 + ctrl * 6 + fit * 6);
  const pairs: Pair[] = [pair(70, (closed ? 1 : 0) | (periodic ? 2 : 0) | (rational ? 4 : 0)), pair(71, degree)];
  for (let k = 0; k < knots; k++) pairs.push(pair(40, m.bd()));
  for (let k = 0; k < ctrl; k++) {
    pairs.push(...at(10, m.bd3()));
    if (weighted) pairs.push(pair(41, m.bd()));
  }
  // the end tangents, given only where they were set
  tangents.forEach((t, i) => {
    if (t.x !== 0 || t.y !== 0) pairs.push(...at(12 + i, t));
  });
  for (let k = 0; k < fit; k++) pairs.push(...at(11, m.bd3()));
  return { type: "SPLINE", pairs };
}

/**
 * A MULTILEADER, read in the order ACadSharp reads it (DwgObjectReader.readMultiLeader): from R2010
 * a version, then its context (the leaders first in the data, then the content and the block), then
 * its own line, arrowhead, content and text settings. The groups kept are the DXF ones that
 * import/dxf.ts draws from, with the markers: CONTEXT_DATA{ holds LEADER{ holds LEADER_LINE{. Values
 * read only to keep the streams in step are left out. The block content is the body's `ref`.
 */
function multileaderEntity(c: Ctx): Body {
  const { m, h } = c;
  const v = c.f.v;
  if (v >= 1024) m.bs(); // 270, the version
  const context = leaderContext(c);
  m.bl(); // 90, property overrides
  const pathType = m.bs(); // 170, leader line type
  cmcColor(c); // 91, leader line colour
  h.handle(c.handle); // 341, leader line type
  m.bl(); // 171, leader line weight
  const landing = m.bit(); // 290, enable landing
  const dogleg = m.bit(); // 291, enable dogleg
  const landingDistance = m.bd(); // 41, dogleg length
  const arrowhead = h.handle(c.handle); // 342, arrowhead, 0 for the default
  const arrow = m.bd(); // 42, arrowhead size
  const contentType = m.bs(); // 172, content type
  h.handle(c.handle); // 343, text style
  m.bs(); // 173, left text attachment
  m.bs(); // 95, right text attachment
  m.bs(); // 174, text angle
  m.bs(); // 175, text alignment
  cmcColor(c); // 92, text colour
  m.bit(); // 292, text frame
  h.handle(c.handle); // 344, block content
  cmcColor(c); // 93, block colour
  m.bd3(); // 10, block scale
  m.bd(); // 43, block rotation
  m.bs(); // 176, block connection type
  m.bit(); // 293, annotation scale
  if (v <= 1021) {
    // before 2010, its arrowheads, each with a flag for the default one (345)
    const arrows = m.bl();
    m.room(arrows);
    for (let k = 0; k < arrows; k++) {
      m.bit();
      h.handle(c.handle);
    }
  }
  // its block attributes: a definition (330), its text (302), index (177) and width (44)
  const labels = m.bl();
  m.room(labels);
  for (let k = 0; k < labels; k++) {
    h.handle(c.handle);
    text(c);
    m.bs();
    m.bd();
  }
  m.bit(); // 294, text direction negative
  m.bs(); // 178, text align in IPE
  m.bs(); // 179, text attachment point
  m.bd(); // 45, scale factor
  if (v >= 1024) {
    m.bs(); // 271, text attachment direction
    m.bs(); // 272, bottom text attachment
    m.bs(); // 273, top text attachment
  }
  if (v >= 1027) m.bit(); // 295, extended to text
  return {
    type: "MULTILEADER",
    pairs: [
      ...context.pairs,
      pair(170, pathType),
      pair(290, landing),
      pair(291, dogleg),
      pair(41, landingDistance),
      pair(42, arrow),
      pair(172, contentType),
      pair(342, arrowhead.toString(16).toUpperCase()),
    ],
    ref: context.ref,
  };
}

/**
 * A MULTILEADER's CONTEXT_DATA{: its leader roots first (each a LEADER{), then the content. Text (290)
 * is MText, read in full; otherwise a block (296) whose record is `ref`, placed at group 15 and turned
 * by 46. The leaders follow the context's own groups, as in the DXF layout.
 */
function leaderContext(c: Ctx): { pairs: Pair[]; ref: number } {
  const { m, h } = c;
  const v = c.f.v;
  const roots = m.bl();
  m.room(roots);
  const leaders: Pair[][] = [];
  for (let k = 0; k < roots; k++) leaders.push(leaderRoot(c));
  const pairs: Pair[] = [pair(300, "CONTEXT_DATA{")];
  m.bd(); // 40, overall scale
  m.bd3(); // 10, content base point
  pairs.push(pair(41, m.bd())); // text height
  pairs.push(pair(140, m.bd())); // arrowhead size
  m.bd(); // 145, landing gap
  m.bs(); // 174, left text attachment
  m.bs(); // 175, right text attachment
  m.bs(); // 176, text alignment
  m.bs(); // 177, block connection
  const hasText = m.bit() === 1;
  pairs.push(pair(290, hasText ? 1 : 0));
  if (hasText) {
    pairs.push(pair(304, text(c)));
    m.bd3(); // 11, normal
    h.handle(c.handle); // 340, text style
    pairs.push(...at(12, m.bd3())); // location
    pairs.push(...at(13, m.bd3())); // direction
    m.bd(); // 42, rotation
    m.bd(); // 43, boundary width
    m.bd(); // 44, boundary height
    m.bd(); // 45, line spacing factor
    m.bs(); // 170, line spacing style
    cmcColor(c); // 90, text colour
    pairs.push(pair(171, m.bs())); // attachment point
    m.bs(); // 172, flow direction
    cmcColor(c); // 91, background colour
    m.bd(); // 141, background scale
    m.bl(); // 92, background transparency
    m.bit(); // 291, background fill
    m.bit(); // 292, background mask fill
    m.bs(); // 173, column type
    m.bit(); // 293, text height automatic
    m.bd(); // 142, column width
    m.bd(); // 143, column gutter
    m.bit(); // 294, column flow reversed
    const sizes = m.bl();
    m.room(sizes);
    for (let k = 0; k < sizes; k++) m.bd(); // 144, column sizes
    m.bit(); // 295, word break
    m.bit(); // a flag this text branch ends with
  }
  // a block is only read when there is no text (296 is the ELSE of the text)
  const hasBlock = !hasText && m.bit() === 1;
  pairs.push(pair(296, hasBlock ? 1 : 0));
  let ref = 0;
  if (hasBlock) {
    ref = h.handle(c.handle); // 341, the block record
    pairs.push(pair(341, ref.toString(16).toUpperCase()));
    m.bd3(); // 14, normal
    pairs.push(...at(15, m.bd3())); // location
    pairs.push(...at(16, m.bd3())); // scale
    pairs.push(pair(46, m.bd())); // rotation, in radians
    cmcColor(c); // 93, block colour
    for (let k = 0; k < 16; k++) m.bd(); // 47, the transformation matrix, which is not used
  }
  m.bd3(); // 110, base point
  m.bd3(); // 111, base direction
  m.bd3(); // 112, base vertical
  m.bit(); // 297, normal reversed
  for (const leader of leaders) pairs.push(...leader);
  if (v >= 1024) {
    const top = m.bs(); // 273, top text attachment
    const bottom = m.bs(); // 272, bottom text attachment
    pairs.push(pair(272, bottom), pair(273, top));
  }
  pairs.push(pair(301, "}"));
  return { pairs, ref };
}

/** A LEADER{ of a MULTILEADER's context: its last point, dogleg vector and length, and its lines. */
function leaderRoot(c: Ctx): Pair[] {
  const { m } = c;
  const v = c.f.v;
  const pairs: Pair[] = [pair(302, "LEADER{")];
  pairs.push(pair(290, m.bit())); // the last leader line point is set
  pairs.push(pair(291, m.bit())); // the dogleg vector is set
  pairs.push(...at(10, m.bd3())); // the last leader line point
  pairs.push(...at(11, m.bd3())); // the dogleg vector
  const breaks = m.bl();
  m.room(breaks * 12);
  for (let k = 0; k < breaks; k++) {
    m.bd3(); // break start point
    m.bd3(); // break end point
  }
  m.bl(); // 90, leader index
  pairs.push(pair(40, m.bd())); // the dogleg's length
  const lines = m.bl();
  m.room(lines);
  for (let k = 0; k < lines; k++) pairs.push(...leaderLine(c));
  if (v >= 1024) pairs.push(pair(271, m.bs())); // text attachment direction
  pairs.push(pair(303, "}"));
  return pairs;
}

/**
 * A LEADER_LINE{: its points, then from R2010 its path type (170), arrowhead size (40), arrowhead
 * handle (341, 0 for the default) and override flags (93). The values only hold when the line sets them
 * (1, 16 and 32), so import/dxf.ts falls back to the MULTILEADER's own.
 */
function leaderLine(c: Ctx): Pair[] {
  const { m, h } = c;
  const v = c.f.v;
  const count = m.bl();
  m.room(count * 6);
  const points: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) points.push(m.bd3());
  const breaks = m.bl();
  m.room(breaks);
  for (let k = 0; k < breaks; k++) {
    m.bl(); // 90, segment index
    const ends = m.bl();
    m.room(ends * 12);
    for (let j = 0; j < ends; j++) {
      m.bd3(); // break start point
      m.bd3(); // break end point
    }
  }
  const pairs: Pair[] = [pair(304, "LEADER_LINE{")];
  for (const p of points) pairs.push(...at(10, p));
  pairs.push(pair(91, m.bl())); // leader line index
  if (v >= 1024) {
    const type = m.bs(); // 170, 0 invisible, 1 straight, 2 spline
    cmcColor(c); // 92, line colour
    h.handle(c.handle); // 340, line type
    m.bl(); // 171, line weight
    const size = m.bd(); // 40, arrowhead size
    const arrow = h.handle(c.handle); // 341, arrowhead
    const overrides = m.bl(); // 93, the properties this line sets itself
    pairs.push(pair(170, type), pair(40, size), pair(341, arrow.toString(16).toUpperCase()), pair(93, overrides));
  }
  pairs.push(pair(305, "}"));
  return pairs;
}

// ---- the drawing -------------------------------------------------------------------

/** A DWG file's objects in the form drawingOf reads them. `paper` is only made into entries by `emit`, when a sheet is read. */
interface DwgParts {
  readonly model: Entry[];
  readonly paper: readonly Rec[];
  readonly emit: (list: readonly Rec[]) => Entry[];
  readonly blocks: Map<string, Block>;
  readonly tables: DxfTables;
  readonly xrefs: readonly XrefDef[];
}

/**
 * Ties the entities to their layers, owners and blocks, and walks model space; paper space when
 * model space draws nothing. Polylines take their vertices, and inserts their attributes, after
 * them, as in a DXF file. The xref blocks are listed with their files, and not drawn here.
 */
function partsOf(db: Db, header: Header): DwgParts {
  const kids = new Map<number, Rec[]>();
  const model: Rec[] = [];
  const paper: Rec[] = [];
  let modelSpace = -1;
  let paperSpace = -1;
  for (const [handle, b] of db.blocks) {
    const n = b.name.toUpperCase();
    if (n === "*MODEL_SPACE") modelSpace = handle;
    else if (n === "*PAPER_SPACE") paperSpace = handle;
  }
  for (const r of db.recs) {
    if (r.mode === 2 || (r.mode === 0 && r.owner === modelSpace)) model.push(r);
    else if (r.mode === 1 || (r.mode === 0 && r.owner === paperSpace)) paper.push(r);
    else if (r.mode === 0) {
      const list = kids.get(r.owner);
      if (list) list.push(r);
      else kids.set(r.owner, [r]);
    }
  }

  const key = (handle: number): string => `*DWG${handle.toString(16).toUpperCase()}`;
  const lineTypeName = (handle: number): string | null =>
    handle === BY_BLOCK ? "BYBLOCK" : handle === CONTINUOUS ? "CONTINUOUS" : handle > 0 ? (db.lineTypes.get(handle)?.name ?? null) : null;
  // an arrowhead block by its hex handle: its key, "_NONE" for no arrowhead, empty for the default (a null handle)
  const arrowOf = (hex: string): string => {
    const handle = parseInt(hex, 16);
    const b = handle > 0 ? db.blocks.get(handle) : undefined;
    return !b ? "" : b.name.toUpperCase() === "_NONE" ? "_NONE" : key(handle);
  };
  const entryOf = (r: Rec): Entry => {
    // a multileader's arrowheads name their blocks, as its DXF does once read (leaderArrows)
    const own = r.type === "MULTILEADER" ? leaderArrows(r.pairs, arrowOf) : r.pairs;
    const pairs = [...own, pair(8, db.layers.get(r.layer)?.name ?? "0")];
    const lt = lineTypeName(r.lineType);
    if (lt !== null) pairs.push(pair(6, lt));
    // an external reference is named by its own block name, which the walk finds among the xrefs
    const target = db.blocks.get(r.ref);
    if (r.ref) pairs.push(pair(2, target?.xref ? target.name : key(r.ref)));
    return { type: r.type, pairs, data: r.data };
  };
  const emit = (list: readonly Rec[]): Entry[] => {
    const out: Entry[] = [];
    for (const r of list) {
      if (r.type === "VERTEX" || r.type === "ATTRIB") continue;
      const e = entryOf(r);
      out.push(e);
      if (r.type === "POLYLINE") {
        for (const k of kids.get(r.handle) ?? []) if (k.type === "VERTEX") out.push(entryOf(k));
        out.push({ type: "SEQEND", pairs: [] });
      } else if (r.type === "INSERT") {
        const attribs = (kids.get(r.handle) ?? []).filter((k) => k.type === "ATTRIB");
        if (attribs.length > 0) {
          e.pairs.push(pair(66, 1));
          out.push(...attribs.map(entryOf), { type: "SEQEND", pairs: [] });
        }
      }
    }
    return out;
  };

  const blocks = new Map<string, Block>();
  // an xref's objects are in its own file, so it is kept by name for the walk rather than as a block
  const xrefs: XrefDef[] = [];
  for (const [handle, b] of db.blocks) {
    if (b.xref) xrefs.push({ name: b.name, path: b.path, overlay: b.overlay, base: b.base });
    if (b.xref || /^\*(MODEL|PAPER)_SPACE/i.test(b.name)) continue;
    blocks.set(key(handle), { base: b.base, baseZ: b.baseZ, entries: emit(kids.get(handle) ?? []) });
  }

  const layers = new Map<string, DxfLayer>();
  for (const l of db.layers.values()) {
    layers.set(l.name.toUpperCase(), { color: l.color, lineType: lineTypeName(l.lineType) ?? "", weight: l.weight, shown: l.shown });
  }
  const lineTypes = new Map([...db.lineTypes.values()].map((lt): [string, DxfLineType] => [lt.name.toUpperCase(), lt]));
  const tables: DxfTables = { layers, lineTypes, ltscale: header.ltscale };
  return { model: emit(model), paper, emit, blocks, tables, xrefs };
}

function assemble(db: Db, header: Header, release: string, sources: ReadonlyMap<string, XrefSource>): DwgDrawing {
  const parts = partsOf(db, header);
  let drawing = drawingOf(parts.model, parts.blocks, header.insunits, parts.tables, parts.xrefs, sources);
  let space: "model" | "paper" = "model";
  const sheet = parts.paper.filter((r) => r.type !== "VIEWPORT" && r.type !== "VERTEX" && r.type !== "ATTRIB").length;
  if (drawing.entities.length === 0 && sheet > 0) {
    drawing = drawingOf(parts.emit(parts.paper), parts.blocks, header.insunits, parts.tables, parts.xrefs, sources);
    space = "paper";
  } else if (sheet > 0) {
    drawing = { ...drawing, skipped: { ...drawing.skipped, "PAPER SPACE": sheet } };
  }
  const skipped: Record<string, number> = { ...drawing.skipped };
  // an entity that could not be decoded is counted as skipped too
  for (const [k, n] of Object.entries(db.unreadable)) skipped[k] = (skipped[k] ?? 0) + n;
  return { ...drawing, skipped, release, space, unreadable: db.unreadable };
}

// ---- ACIS data of solids, regions and bodies ---------------------------------------

/**
 * The ACIS data of one solid, region or body, read as ACadSharp's readModelerGeometry reads it. Before
 * R2013 the data is in the entity: a bit that is 0 when the data comes straight after the common data.
 * Otherwise a wireframe bit comes first; when it is set the wireframe data is skipped and a second
 * bit says whether the data follows it. From R2013 the data is in the AcDsPrototype_1b section, which
 * readObjects attaches by handle, so the entity has nothing here.
 */
function modelerEntity(c: Ctx, name: string): Body {
  if (c.f.v >= 1027) return { type: name, pairs: [] };
  const m = c.m;
  if (m.bit() === 0) return { type: name, pairs: [], data: acisData(c) };
  if (m.bit() === 1) {
    skipWireframe(m);
    if (m.bit() === 0) return { type: name, pairs: [], data: acisData(c) };
  }
  return { type: name, pairs: [] };
}

/**
 * The ACIS data after its unknown bit and version: version 1 is blocks of ciphered SAT text, each a
 * byte count and its bytes, up to a count of 0; version 2 is the object's data from there on, SAT or
 * SAB text, cut after its end marker (readModelerGeometryData in ACadSharp).
 */
function acisData(c: Ctx): Uint8Array | undefined {
  const m = c.m;
  m.bit();
  const version = m.bs();
  if (version === 1) {
    const parts: Uint8Array[] = [];
    for (let size = m.bl(); size > 0; size = m.bl()) {
      m.room(size * 8);
      const block = new Uint8Array(size);
      for (let k = 0; k < size; k++) block[k] = unswap(m.byte());
      parts.push(block);
    }
    return parts.length > 0 ? lfEnds(joined(parts)) : undefined;
  }
  if (version === 2) {
    // the data stream ends where the handles begin, so the rest of it is the ACIS data up to its marker
    const n = Math.max(0, Math.floor((c.end - m.pos) / 8));
    const raw = new Uint8Array(n);
    for (let k = 0; k < n; k++) raw[k] = m.byte();
    return lfEnds(trimAtAcisEnd(raw));
  }
  return undefined;
}

/**
 * SAT text as DXF gives it, its lines joined with LF and no line end after the last one: the CR of
 * each CRLF goes, and so do trailing line ends, so one solid has the same bytes in either file. SAB
 * is binary and is returned as it is.
 */
function lfEnds(b: Uint8Array): Uint8Array {
  if (isSab(b)) return b;
  let end = b.length;
  while (end > 0 && b[end - 1] === 0x0a) end--;
  let n = 0;
  for (let i = 0; i < end; i++) if (b[i] !== 0x0d || b[i + 1] !== 0x0a) n++;
  const out = new Uint8Array(n);
  let k = 0;
  for (let i = 0; i < end; i++) if (b[i] !== 0x0d || b[i + 1] !== 0x0a) out[k++] = b[i];
  return out;
}

/** Skips the wireframe data of a modeler geometry: a point, the isolines and the silhouettes, with their wires (readWire in ACadSharp). */
function skipWireframe(m: Bits): void {
  if (m.bit()) m.bd3();
  m.bl(); // the number of isolines
  if (m.bit()) skipWires(m, m.bl());
  const silhouettes = m.bl();
  m.room(silhouettes);
  for (let k = 0; k < silhouettes; k++) {
    m.bll(); // viewport id
    m.bd3(); // target
    m.bd3(); // direction from the target
    m.bd3(); // up direction
    m.bit(); // perspective
    if (m.bit()) skipWires(m, m.bl());
  }
}

/** Skips `count` wires: a type, selection marker, colour and ACIS index, their points and an optional transform. */
function skipWires(m: Bits, count: number): void {
  m.room(count);
  for (let k = 0; k < count; k++) {
    m.byte(); // type
    m.bl(); // selection marker
    m.bs(); // colour
    m.bl(); // ACIS index
    const points = m.bl();
    m.room(points);
    for (let j = 0; j < points; j++) m.bd3();
    if (m.bit()) {
      // three axes and a translation, a scale, then whether it rotates, reflects and shears
      for (let j = 0; j < 4; j++) m.bd3();
      m.bd();
      m.bit();
      m.bit();
      m.bit();
    }
  }
}

/** The ACIS data's end markers, which AutoCAD spells as plain text in SAT and in tagged chunks in SAB (AcisTextCodec in ACadSharp). */
const ACIS_END: readonly Uint8Array[] = [
  Uint8Array.from(ascii("End-of-ACIS-data")),
  Uint8Array.from(ascii("End-of-ASM-data")),
  Uint8Array.from([0x0e, 0x03, ...ascii("End"), 0x0e, 0x02, ...ascii("of"), 0x0e, 0x04, ...ascii("ACIS"), 0x0d, 0x04, ...ascii("data")]),
  Uint8Array.from([0x0e, 0x03, ...ascii("End"), 0x0e, 0x02, ...ascii("of"), 0x0e, 0x03, ...ascii("ASM"), 0x0d, 0x04, ...ascii("data")]),
];

/** The bytes up to and including the first end marker of the kinds above, in that order; all of them when there is none. */
function trimAtAcisEnd(b: Uint8Array): Uint8Array {
  for (const marker of ACIS_END) {
    const at = indexOfBytes(b, marker);
    if (at >= 0) return b.slice(0, at + marker.length);
  }
  return b;
}

/** Where `needle` first occurs in `b`, or -1. */
function indexOfBytes(b: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i + needle.length <= b.length; i++) {
    let k = 0;
    while (k < needle.length && b[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

/** SAT text's character swap, which is its own inverse: each byte above a space and below 0x9F becomes 0x9F minus itself. */
function unswap(c: number): number {
  return c > 0x20 && c < 0x9f ? 0x9f - c : c;
}

/** The bytes of ASCII text. */
function ascii(s: string): number[] {
  return [...s].map((ch) => ch.charCodeAt(0));
}

/** The first bytes of a SAB file: ACIS's, or ASM's (Autodesk Shape Manager, which writes the same format). */
const SAB_MAGIC: readonly (readonly number[])[] = [ascii("ACIS BinaryFile"), ascii("ASM BinaryFile")];

/** Whether the bytes are a SAB file, which starts with one of SAB_MAGIC. */
function isSab(b: Uint8Array): boolean {
  return SAB_MAGIC.some((m) => b.length >= m.length && m.every((v, i) => b[i] === v));
}

/** An unsigned 16-bit number at byte `p`, little-endian. */
function u16(b: Uint8Array, p: number): number {
  return b[p] | (b[p + 1] << 8);
}

/** The parts' bytes, one after another. */
function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Each R2013 segment starts with this 48-byte header (readSubItemHeader in ACadSharp). */
const SEGMENT_HEADER = 48;
/** The DataSize that marks a record kept in blob pages (see DwgPrototype1bReader in ACadSharp). */
const BLOB_SIZE = 0xbb106bb1;
/** The size in bytes of a property value by its type number; 0 for the types with no fixed size. */
const TYPE_SIZES: readonly number[] = [0, 0, 2, 1, 2, 4, 8, 1, 2, 4, 8, 4, 8, 0, 0, 0];
/** The schema property flag that says a property has no type. */
const NO_TYPE = 2;

/** The ACIS data of an R2013 file's AcDsPrototype_1b section, by handle, or none when it cannot be read. */
function acisOfSection(b: Uint8Array | undefined): Map<number, Uint8Array> {
  if (!b) return new Map();
  try {
    return acisOfPrototype(b);
  } catch {
    // the solids then come without their data, and the check reports them
    return new Map();
  }
}

/**
 * The ACIS data of each solid, region and body in an R2013 file, by handle (DwgPrototype1bReader in
 * ACadSharp). The section's file header names its segment index, its schema index and its data index.
 * The schema index says which schemas are in which segment, and each schema's properties are named
 * in a table after the schemas. The data index points at each record in a data segment, with the
 * schema it follows; a record whose schema has an ASM_Data property holds that solid's ACIS data.
 */
function acisOfPrototype(b: Uint8Array): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const segmentsAt = u32(b, 24);
  const segmentCount = u32(b, 32);
  const segments: number[] = [];
  for (let i = 0; i < segmentCount; i++) segments.push(u64(b, segmentsAt + SEGMENT_HEADER + 12 * i));
  const segment = (i: number): number => {
    if (!(i < segments.length)) throw new Error("the ACIS section names a segment it does not have");
    return segments[i];
  };

  // the schema index: the schemas by their segment, and the property entries by theirs
  let p = segment(u32(b, 36)) + SEGMENT_HEADER;
  const schemaCount = u32(b, p);
  p += 8;
  const schemaPointers: { index: number; segment: number }[] = [];
  for (let i = 0; i < schemaCount; i++, p += 12) schemaPointers.push({ index: u32(b, p), segment: u32(b, p + 4) });
  p += 8;
  const propertyCount = u32(b, p);
  p += 8;
  const propertySegments: number[] = [];
  for (let i = 0; i < propertyCount; i++, p += 12) propertySegments.push(u32(b, p));

  // the schemas of each segment, and the names of the properties they have, by schema index
  const properties = new Map<number, string[]>();
  for (const seg of new Set(schemaPointers.map((s) => s.segment))) {
    const start = segment(seg);
    const own = u32(b, start + 8);
    p = start + SEGMENT_HEADER;
    p += 8 * propertySegments.filter((s) => s === own).length;
    const found: { schema: number; names: number[] }[] = [];
    for (const s of schemaPointers.filter((x) => x.segment === own)) {
      p += 2 + 8 * u16(b, p); // the schema's index entries
      const propCount = u16(b, p);
      p += 2;
      const names: number[] = [];
      for (let k = 0; k < propCount; k++) {
        const flags = u32(b, p);
        names.push(u32(b, p + 4));
        p += 8;
        let typeSize = 0;
        if ((flags & NO_TYPE) === 0) {
          const type = u32(b, p);
          p += 4;
          if (type === 0xe) {
            typeSize = u32(b, p);
            p += 4;
          } else typeSize = TYPE_SIZES[type] ?? 0;
        }
        if (flags === 1 || flags === 8) p += 4; // an unknown field
        p += 2 + u16(b, p) * typeSize; // the property's values
      }
      found.push({ schema: s.index, names });
    }
    // the property names follow, at the next 16-byte boundary
    p += (16 - (p % 16)) % 16;
    const nameCount = u32(b, p);
    p += 4;
    const table: string[] = [];
    for (let k = 0; k < nameCount; k++) {
      const end = b.indexOf(0, p);
      if (end < 0) throw new Error("a property name is not ended");
      table.push(latin1(b.subarray(p, end)));
      p = end + 1;
    }
    for (const f of found) properties.set(f.schema, f.names.map((n) => table[n] ?? ""));
  }

  // the data index: each record's segment, its offset within that segment's data, and its schema
  const dataStart = segment(u32(b, 40));
  p = dataStart + SEGMENT_HEADER + 8;
  const entryCount = u32(b, dataStart + SEGMENT_HEADER);
  const bySegment = new Map<number, { offset: number; schema: number }[]>();
  for (let k = 0; k < entryCount; k++, p += 12) {
    const seg = u32(b, p);
    if (seg === 0) continue; // a stub entry
    const list = bySegment.get(seg) ?? [];
    list.push({ offset: u32(b, p + 4), schema: u32(b, p + 8) });
    bySegment.set(seg, list);
  }

  for (const [seg, entries] of bySegment) {
    const start = segment(seg);
    const dataRef = start + (u32(b, start + 36) << 4);
    for (const e of entries) {
      if (!(properties.get(e.schema) ?? []).includes("ASM_Data")) continue;
      // the record's header: its size, an unknown field, its handle and its offset from dataRef
      const h = start + SEGMENT_HEADER + e.offset;
      const handle = u64(b, h + 8);
      const at = dataRef + u32(b, h + 16);
      const size = u32(b, at);
      out.set(handle, size === BLOB_SIZE ? blobOf(b, at + 4, segment) : b.slice(at + 4, at + 4 + size));
    }
  }
  return out;
}

/** A record kept in blob pages: a header, then the segment and size of each page, which joined make the data. */
function blobOf(b: Uint8Array, at: number, segment: (i: number) => number): Uint8Array {
  const pages = u32(b, at + 8);
  const parts: Uint8Array[] = [];
  for (let k = 0; k < pages; k++) {
    const start = segment(u32(b, at + 32 + 8 * k));
    // a blob segment: its header, then the total size, the page's start and index and count, and its data
    const size = u64(b, start + SEGMENT_HEADER + 24);
    const from = start + SEGMENT_HEADER + 32;
    parts.push(b.slice(from, from + size));
  }
  return joined(parts);
}

/**
 * The solids, regions and bodies of a DWG file, each with its handle and, when the file holds it, its
 * ACIS data. Every one counts, in any space or block. dwg.check.ts matches them with the DXF twin.
 */
export function dwgAcisObjects(bytes: Uint8Array): AcisObject[] {
  const f = fileOf(bytes, String.fromCharCode(...bytes.subarray(0, 6)));
  const sections = sectionsOf(f);
  const classes = sections.classes ? classesOf(f, sections.classes) : new Map<number, DwgClass>();
  const db = readObjects(f, sections.objects, objectMap(sections.handles), classes, sections.acis);
  return db.recs.filter((r) => ACIS_TYPES.has(r.type)).map((r) => ({ type: r.type, handle: r.handle.toString(16).toUpperCase(), data: r.data }));
}

// ---- bytes -------------------------------------------------------------------------

function u32(b: Uint8Array, p: number): number {
  return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
}

function i32(b: Uint8Array, p: number): number {
  return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);
}

function u64(b: Uint8Array, p: number): number {
  return u32(b, p) + u32(b, p + 4) * 2 ** 32;
}

function i64(b: Uint8Array, p: number): number {
  return u32(b, p) + i32(b, p + 4) * 2 ** 32;
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (const c of b) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function utf16(b: Uint8Array): string {
  let s = "";
  for (let k = 0; k + 1 < b.length; k += 2) s += String.fromCharCode(b[k] | (b[k + 1] << 8));
  return s;
}
