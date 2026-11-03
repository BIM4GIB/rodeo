// Worksheets (type 18) and the images of them placed on sheet layers (type 56).
//
// A worksheet and each of its database blocks hold a grid laid out the same way:
//   counts   u16 columns, u16 rows        (worksheet +0xc0, block +0x8c)
//   table    8-byte entries u32 flags, u32 offset from table - 8, one per column, then per
//            row the row header followed by one per cell (offset 0 = empty), then the end
//            offset                         (worksheet +0x22a, block +0x98)
//   column   u16 1, u16 width (points), u16 left (points)
//   row      u16 kind (2 plain, 4 database, 3 database subrow), u16 height (points), u16 top,
//            u16; a database row goes on with u32 the name index of its block (a type-60
//            child of the worksheet), u16 subrow count, u32 criteria length, the criteria
//   cell     0x6a bytes of format, u8 value kind, u8, then the value:
//              +0x02  u8   horizontal alignment: 0 general, 1 left, 2 right, 3 centre
//              +0x06  u16  font size (points)       +0x08 u16 style: 1 bold, 2 italic
//              +0x0a  u8   number format: 0 general, 1 rounded, 2 decimal, 3 scientific,
//                          4 fraction, 5 dimension, 6 angle, 11 area, 12 volume
//              +0x0b  u8   accuracy: decimal places, or fractions of 1/2^n inch
//              +0x0d  u8   wrap text
//              +0x11  u8   merged, then u16 top row, bottom row, left column, right
//                          column (1-based worksheet rows and columns)
//              +0x1b  u8   filled, +0x1c u16 fill colour index
//            Worksheet cells: kind 0 text, 1 formula, 2 number; a u32 length (characters for
//            text, bytes of formula tokens), 34 bytes of cached result (u8 kind: 0 f64,
//            7 i32, at +2), then the text or the tokens. Block cells hold results only:
//            kind 0 f64, 5 text (u32 characters, UTF-16), 7 i32. Empty text keeps two zero
//            bytes. A number cell's tokens (14 bytes) are 0x065a, the number as an 80-bit
//            x87 extended float, 0x0690.
// A block's type-61 child lists its subrows in display (sorted) order: u32 count + 1, then
// u16 1-based subrow numbers. Cached numbers are in the document's units (feet in an
// imperial file).
//
// On a sheet, a worksheet image (type 56) draws the worksheet with database header rows
// left out and each database row's subrows in their place:
//   +0x68  f64 x 4  its bounds on the sheet: top, left, bottom, right (mm)
//   +0x8c  u32      name index of the worksheet
//   +0x90  f64 x 4  the whole worksheet's frame, top left at the top left of the bounds.
//                   Equal to the bounds up to 2025; a 2026 file has a frame taller than
//                   its bounds, which show only the first rows.
//   +0xb0  f64      scale (1 draws a point as 1/72 inch)

import { concat, f64, i32, readUtf16, setF64, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { BBox, NewWorksheet, SheetCell, WorksheetContents } from "./types.ts";

export const WORKSHEET = 18;
export const WORKSHEET_IMAGE = 56;
export const DATABASE_BLOCK = 60;
const DATABASE_ORDER = 61;

const SHEET_COUNTS = 0xc0;
const SHEET_TABLE = 0x22a;
const BLOCK_COUNTS = 0x8c;
const BLOCK_TABLE = 0x98;

const ROW_PLAIN = 2;
const ROW_DATABASE = 4;
const COLUMN = 1;

const FORMAT_SIZE = 0x6a;
/** bytes of cached result between a worksheet cell's length and its text or tokens */
const RESULT_SIZE = 34;

const KIND_TEXT = 0;
const KIND_FORMULA = 1;
const KIND_NUMBER = 2;
const RESULT_REAL = 0;
const RESULT_TEXT = 5;
const RESULT_INT = 7;

const IMAGE_BOUNDS = 0x68;
const IMAGE_SHEET = 0x8c;
export const IMAGE_FRAME = 0x90;
const IMAGE_SCALE = 0xb0;

/** Millimetres per point at image scale 1. */
export const MM_PER_POINT = 25.4 / 72;

export type CellAlign = "left" | "center" | "right";

export interface WorksheetCell {
  /** display row and column (database rows expanded, their header rows left out) */
  row: number;
  col: number;
  /** rows and columns it spans (merged cells), at least 1 */
  rowSpan: number;
  colSpan: number;
  /** what the cell shows: text, or a formula's cached result formatted as Vectorworks would */
  text: string;
  align: CellAlign;
  /** points */
  size: number;
  bold: boolean;
  italic: boolean;
  wrap: boolean;
  /** colour index of the cell's fill (VwxDocument.color), or null when unfilled */
  fill: number | null;
}

export interface WorksheetGrid {
  name: string;
  /** points (1/72 inch at image scale 1) */
  colWidths: number[];
  rowHeights: number[];
  cells: WorksheetCell[];
}

export interface WorksheetImage {
  /** the whole worksheet on the sheet, mm: the grid's top left is (box.x0, box.y1) */
  box: BBox;
  /** what the image shows of it (clip to this), mm */
  bounds: BBox;
  /** name index of the worksheet (type 18) it shows */
  worksheet: number;
  /** points to sheet: mm = points * MM_PER_POINT * scale */
  scale: number;
}

interface Grid {
  d: Uint8Array;
  cols: number;
  rows: number;
  table: number;
}

function gridAt(d: Uint8Array, counts: number, table: number): Grid | null {
  if (counts + 4 > d.length) return null;
  const cols = u16(d, counts);
  const rows = u16(d, counts + 2);
  const n = cols + rows * (cols + 1) + 1;
  if (table + 8 * n > d.length) return null;
  // the last entry points at the end of the record
  if (table - 8 + u32(d, table + 8 * (n - 1) + 4) !== d.length) return null;
  return { d, cols, rows, table };
}

/** Byte offset of entry i's item, or null when empty. */
function itemAt(g: Grid, i: number): number | null {
  const off = u32(g.d, g.table + 8 * i + 4);
  return off ? g.table - 8 + off : null;
}

function rowAt(g: Grid, r: number): number | null {
  return itemAt(g, g.cols + r * (g.cols + 1));
}

function cellAt(g: Grid, r: number, c: number): number | null {
  const p = itemAt(g, g.cols + r * (g.cols + 1) + 1 + c);
  return p !== null && p + FORMAT_SIZE + 6 <= g.d.length ? p : null;
}

interface Format {
  align: number;
  size: number;
  style: number;
  number: number;
  accuracy: number;
  wrap: boolean;
  fill: number | null;
  merge: { top: number; bottom: number; left: number; right: number } | null;
}

function formatAt(d: Uint8Array, p: number): Format {
  return {
    align: d[p + 0x02],
    size: u16(d, p + 0x06),
    style: u16(d, p + 0x08),
    number: d[p + 0x0a],
    accuracy: d[p + 0x0b],
    wrap: d[p + 0x0d] === 1,
    fill: d[p + 0x1b] ? u16(d, p + 0x1c) : null,
    merge: d[p + 0x11]
      ? { top: u16(d, p + 0x12), bottom: u16(d, p + 0x14), left: u16(d, p + 0x16), right: u16(d, p + 0x18) }
      : null,
  };
}

/** A worksheet cell's value: its text, or its cached result. */
function sheetValue(d: Uint8Array, p: number): string | number {
  const kind = d[p + FORMAT_SIZE];
  const len = u32(d, p + FORMAT_SIZE + 2);
  const result = p + FORMAT_SIZE + 6;
  if (kind === KIND_TEXT) {
    const at = result + RESULT_SIZE;
    return len && at + 2 * len <= d.length ? readUtf16(d, at, 2 * len) : "";
  }
  if (kind !== KIND_FORMULA && kind !== KIND_NUMBER) return "";
  if (d[result] === RESULT_INT) return i32(d, result + 2);
  if (d[result] === RESULT_REAL) {
    const v = f64(d, result + 2);
    return Number.isFinite(v) ? v : "";
  }
  return "";
}

/** A database subrow cell's cached result. */
function blockValue(d: Uint8Array, p: number): string | number {
  const kind = d[p + FORMAT_SIZE];
  const at = p + FORMAT_SIZE + 2;
  if (kind === RESULT_TEXT) {
    const len = u32(d, at);
    return len && at + 4 + 2 * len <= d.length ? readUtf16(d, at + 4, 2 * len) : "";
  }
  if (kind === RESULT_INT) return i32(d, at);
  if (kind === RESULT_REAL) {
    const v = f64(d, at);
    return Number.isFinite(v) ? v : "";
  }
  return "";
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Inches rounded to 1/denom as a worksheet shows them: 23'7 1/2", 1 3/4", 3/4". */
function feetInches(inches: number, feet: boolean, denom: number): string {
  const sign = inches < 0 ? "-" : "";
  const units = Math.round(Math.abs(inches) * denom);
  const ft = feet ? Math.floor(units / (12 * denom)) : 0;
  const rest = units - ft * 12 * denom;
  const whole = Math.floor(rest / denom);
  const part = rest - whole * denom;
  const g = gcd(part, denom);
  const frac = part ? `${part / g}/${denom / g}` : "";
  const inch = frac ? (whole ? `${whole} ${frac}` : frac) : `${whole}`;
  return ft ? `${sign}${ft}'${inch}"` : `${sign}${inch}"`;
}

/** v to at most `places` decimals, without trailing zeros */
function plain(v: number, places: number): string {
  return String(Number(v.toFixed(places)));
}

/**
 * A cached number as its cell's number format shows it, in the document's units.
 * `accuracy` is decimal places, or for fractions the power of two of the denominator.
 */
function formatNumber(v: number, format: number, accuracy: number, units: string): string {
  const u = units.toLowerCase();
  const feet = u.includes("feet") || u.includes("foot");
  const imperial = feet || u.includes("inch");
  const places = Math.min(accuracy, 10);
  const denom = 2 ** Math.min(accuracy, 8);
  switch (format) {
    case 1:
      return String(Math.round(v));
    case 2:
      return v.toFixed(places);
    case 3:
      return v.toExponential(places);
    case 4:
      return feetInches(v, false, denom).slice(0, -1);
    case 5:
      return imperial ? feetInches(feet ? v * 12 : v, feet, denom) : plain(v, places);
    case 6:
      return `${plain(v, places)}°`;
    case 11:
      return `${plain(v, places)} ${imperial ? "sq ft" : "m²"}`;
    case 12:
      return `${plain(v, places)} ${imperial ? "cu ft" : "m³"}`;
    default:
      return plain(v, 3);
  }
}

function cellOf(
  row: number,
  col: number,
  value: string | number,
  f: Format,
  units: string,
  span: { rowSpan: number; colSpan: number },
): WorksheetCell {
  const text = typeof value === "number" ? formatNumber(value, f.number, f.accuracy, units) : value;
  const align: CellAlign =
    f.align === 1 ? "left" : f.align === 2 ? "right" : f.align === 3 ? "center" : typeof value === "number" ? "right" : "left";
  return {
    row,
    col,
    ...span,
    text,
    align,
    size: f.size > 0 && f.size < 1000 ? f.size : 10,
    bold: (f.style & 1) !== 0,
    italic: (f.style & 2) !== 0,
    wrap: f.wrap,
    fill: f.fill,
  };
}

/** Subrow numbers (0-based) in display order: the block's sort list when it is a permutation. */
function subrowOrder(block: Rec, n: number): number[] {
  const list = block.children.find((c) => c.type === DATABASE_ORDER)?.data;
  const plainOrder = Array.from({ length: n }, (_, i) => i);
  if (!list || list.length < 0x54 || u32(list, 0x50) !== n + 1 || 0x54 + 2 * n > list.length) return plainOrder;
  const order = Array.from({ length: n }, (_, i) => u16(list, 0x54 + 2 * i) - 1);
  const seen = new Set(order);
  return seen.size === n && order.every((i) => i >= 0 && i < n) ? order : plainOrder;
}

/**
 * The grid a worksheet shows on a sheet: column widths, row heights and cell texts, with
 * database rows expanded into their cached subrows. `units` is the document's unit name
 * (DocumentInfo.units), for formatting dimensions. Null when the record can't be read.
 */
export function readWorksheet(rec: Rec, names: ReadonlyMap<number, string>, units = ""): WorksheetGrid | null {
  if (rec.type !== WORKSHEET) return null;
  const g = gridAt(rec.data, SHEET_COUNTS, SHEET_TABLE);
  if (!g) return null;
  const d = g.d;
  const colWidths: number[] = [];
  for (let c = 0; c < g.cols; c++) {
    const p = itemAt(g, c);
    colWidths.push(p !== null && u16(d, p) === COLUMN ? u16(d, p + 2) : 0);
  }
  const blocks = new Map<number, Rec>();
  for (const b of rec.children) if (b.type === DATABASE_BLOCK) blocks.set(b.nameIndex, b);

  const rowHeights: number[] = [];
  const cells: WorksheetCell[] = [];
  /** display row of each worksheet row's last line */
  const last: number[] = [];
  const merged: { cell: WorksheetCell; m: NonNullable<Format["merge"]> }[] = [];
  for (let r = 0; r < g.rows; r++) {
    const head = rowAt(g, r);
    const kind = head === null ? ROW_PLAIN : u16(d, head);
    if (kind === ROW_DATABASE && head !== null) {
      // the header row is hidden; its cells give each column's format
      const block = blocks.get(u32(d, head + 8));
      const bg = block ? gridAt(block.data, BLOCK_COUNTS, BLOCK_TABLE) : null;
      if (bg && block) {
        const formats = Array.from({ length: g.cols }, (_, c) => {
          const p = cellAt(g, r, c);
          return p === null ? null : formatAt(d, p);
        });
        for (const s of subrowOrder(block, bg.rows)) {
          const sh = rowAt(bg, s);
          const at = rowHeights.length;
          rowHeights.push(sh === null ? 0 : u16(bg.d, sh + 2));
          for (let c = 0; c < Math.min(bg.cols, g.cols); c++) {
            const p = cellAt(bg, s, c);
            const f = formats[c];
            if (p === null || !f) continue;
            const value = blockValue(bg.d, p);
            if (value === "" && f.fill === null) continue;
            cells.push(cellOf(at, c, value, f, units, { rowSpan: 1, colSpan: 1 }));
          }
        }
      }
    } else {
      const at = rowHeights.length;
      rowHeights.push(head === null ? 0 : u16(d, head + 2));
      for (let c = 0; c < g.cols; c++) {
        const p = cellAt(g, r, c);
        if (p === null) continue;
        const f = formatAt(d, p);
        const value = sheetValue(d, p);
        if (value === "" && f.fill === null) continue;
        const cell = cellOf(at, c, value, f, units, { rowSpan: 1, colSpan: 1 });
        cells.push(cell);
        if (f.merge && f.merge.top === r + 1 && f.merge.left === c + 1) merged.push({ cell, m: f.merge });
      }
    }
    last.push(rowHeights.length - 1);
  }
  // merged ranges cover the cells under them
  const covered = new Set<string>();
  for (const { cell, m } of merged) {
    const bottom = Math.min(Math.max(m.bottom, m.top), g.rows) - 1;
    const right = Math.min(Math.max(m.right, m.left), g.cols) - 1;
    cell.rowSpan = Math.max(1, last[bottom] - cell.row + 1);
    cell.colSpan = right - cell.col + 1;
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) if (r !== cell.row || c !== cell.col) covered.add(`${r},${c}`);
    }
  }
  return {
    name: names.get(rec.nameIndex) ?? "",
    colWidths,
    rowHeights,
    cells: covered.size ? cells.filter((c) => !covered.has(`${c.row},${c.col}`)) : cells,
  };
}

/** A worksheet's cells as stored, with each plain row's text, numbers and formula results. */
export function readWorksheetContents(rec: Rec, names: ReadonlyMap<number, string>, units = ""): WorksheetContents | null {
  if (rec.type !== WORKSHEET) return null;
  const g = gridAt(rec.data, SHEET_COUNTS, SHEET_TABLE);
  if (!g) return null;
  const d = g.d;
  const database: boolean[] = [];
  const cells: SheetCell[] = [];
  for (let r = 0; r < g.rows; r++) {
    const head = rowAt(g, r);
    const db = head !== null && u16(d, head) === ROW_DATABASE;
    database.push(db);
    for (let c = 0; c < g.cols; c++) {
      const p = cellAt(g, r, c);
      if (p === null) continue;
      const kind = d[p + FORMAT_SIZE];
      if (kind !== KIND_TEXT && kind !== KIND_NUMBER && kind !== KIND_FORMULA) continue;
      const value = sheetValue(d, p);
      const f = formatAt(d, p);
      const shown = typeof value === "number" ? formatNumber(value, f.number, f.accuracy, units) : value;
      if (kind === KIND_TEXT && !shown) continue;
      cells.push({
        row: r,
        col: c,
        kind: kind === KIND_TEXT ? "text" : kind === KIND_NUMBER ? "number" : "formula",
        display: shown,
        value: typeof value === "number" ? value : null,
      });
    }
  }
  return { index: rec.nameIndex, name: names.get(rec.nameIndex) ?? "", cols: g.cols, rows: g.rows, database, cells };
}

const NUMBER_TOKEN = 0x065a;
const END_TOKEN = 0x0690;

/** v as an 80-bit x87 extended float: 64-bit mantissa with its integer bit, then sign and exponent. */
function extended(v: number): Uint8Array {
  const out = new Uint8Array(10);
  if (v === 0) return out;
  const bits = new DataView(new Float64Array([v]).buffer);
  const hi = bits.getUint32(4, true);
  const lo = bits.getUint32(0, true);
  const sign = hi >>> 31;
  const exp = (hi >>> 20) & 0x7ff;
  if (exp === 0 || exp === 0x7ff) throw new Error("number out of range");
  const mantissa = (1n << 63n) | (((BigInt(hi & 0xfffff) << 32n) | BigInt(lo)) << 11n);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, mantissa, true);
  dv.setUint16(8, (sign << 15) | (exp - 1023 + 16383), true);
  return out;
}

/**
 * A worksheet cell's value part (what follows its format): text, or a number with its tokens.
 * `old` is the value part it replaces: of the same kind, its spare bytes (the one after the
 * kind, and the cached result's) are kept, so only what changed changes.
 */
function cellValue(value: string | number, old: Uint8Array | null): Uint8Array {
  const kind = typeof value === "number" ? KIND_NUMBER : KIND_TEXT;
  const head = new Uint8Array(6 + RESULT_SIZE);
  if (old && old.length >= head.length && old[0] === kind) head.set(old.subarray(0, head.length));
  head[0] = kind;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("number out of range");
    const out = new Uint8Array(6 + RESULT_SIZE + 14);
    out.set(head);
    setU32(out, 2, 14);
    out[6] = RESULT_REAL;
    setF64(out, 8, value);
    const tokens = 6 + RESULT_SIZE;
    setU16(out, tokens, NUMBER_TOKEN);
    out.set(extended(value), tokens + 2);
    setU16(out, tokens + 12, END_TOKEN);
    return out;
  }
  const units = [...value].flatMap((ch) => {
    const c = ch.codePointAt(0)!;
    return c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c];
  });
  const out = new Uint8Array(6 + RESULT_SIZE + Math.max(2, 2 * units.length));
  out.set(head);
  setU32(out, 2, units.length);
  units.forEach((u, i) => setU16(out, 6 + RESULT_SIZE + 2 * i, u));
  return out;
}

/**
 * A worksheet record with one plain row's cell set to `value` (row and column 0-based): its
 * format kept, or for an empty cell copied from the nearest cell in its column (else any),
 * unmerged. The items after it move and the table follows them.
 */
export function writeWorksheetCell(d: Uint8Array, row: number, col: number, value: string | number): Uint8Array {
  const g = gridAt(d, SHEET_COUNTS, SHEET_TABLE);
  if (!g) throw new Error("this worksheet can't be read");
  if (!(row >= 0 && row < g.rows && col >= 0 && col < g.cols)) throw new Error("no such cell");
  const head = rowAt(g, row);
  if (head !== null && u16(d, head) === ROW_DATABASE) throw new Error("database rows can't be edited here");
  const n = g.cols + g.rows * (g.cols + 1) + 1;
  const entry = g.cols + row * (g.cols + 1) + 1 + col;
  const base = g.table - 8;
  const own = cellAt(g, row, col);
  if (own !== null && d[own + FORMAT_SIZE] === KIND_FORMULA) throw new Error("formula cells can't be edited yet");
  let format: Uint8Array;
  let at: number;
  let end: number;
  let flags: number;
  if (own !== null) {
    format = d.slice(own, own + FORMAT_SIZE);
    at = own;
    // the cell runs to the next item
    end = d.length;
    for (let i = 0; i < n; i++) {
      const p = itemAt(g, i);
      if (p !== null && p > own && p < end) end = p;
    }
    flags = u32(d, g.table + 8 * entry);
  } else {
    let from: number | null = null;
    for (let k = 1; k < g.rows && from === null; k++) {
      for (const r of [row - k, row + k]) {
        if (r < 0 || r >= g.rows || from !== null) continue;
        const h = rowAt(g, r);
        if (h === null || u16(d, h) !== ROW_DATABASE) from = cellAt(g, r, col);
      }
    }
    for (let i = g.cols; i < n - 1 && from === null; i++) if ((i - g.cols) % (g.cols + 1) !== 0) from = itemAt(g, i);
    if (from === null) throw new Error("this worksheet has no cell to copy a format from");
    format = d.slice(from, from + FORMAT_SIZE);
    format.fill(0, 0x11, 0x1a);
    // a cell goes before the next one in the table, or at the end
    at = d.length;
    for (let i = entry + 1; i < n - 1; i++) {
      const p = itemAt(g, i);
      if (p !== null) {
        at = p;
        break;
      }
    }
    end = at;
    let source = 0;
    for (let i = 0; i < n; i++) if (itemAt(g, i) === from) source = i;
    flags = u32(d, g.table + 8 * source);
  }
  const item = concat([format, cellValue(value, own === null ? null : d.subarray(own + FORMAT_SIZE, end))]);
  const out = concat([d.subarray(0, at), item, d.subarray(end)]);
  const delta = item.length - (end - at);
  for (let i = 0; i < n; i++) {
    if (i === entry) continue;
    const off = u32(d, g.table + 8 * i + 4);
    if (off && base + off >= end) setU32(out, g.table + 8 * i + 4, off + delta);
  }
  setU32(out, g.table + 8 * entry, flags);
  setU32(out, g.table + 8 * entry + 4, at - base);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** taken to be the active cell and selection, as (row, column, offset) triples: A1 in each, as 4 of the 50 sample worksheets have them */
const SHEET_SELECTION = 0xa8;
const SELECTION_WORDS = [1, 1, 0, 1, 1, 0, 1, 1, 0];
const ALIGN_CODES = { left: 1, right: 2, center: 3 } as const;

/**
 * A worksheet record laid out anew from `src`, another worksheet: its header kept but for the
 * counts and the selection (A1), then `sheet`'s columns and plain rows. Each cell takes the
 * format of a plain text cell of `src` (its font and size), unmerged and unfilled, with its own
 * alignment, weight and number format. Items follow the table in its order, every entry's flags
 * 0, as the samples' plain rows have them.
 */
export function newWorksheetRecord(src: Uint8Array, sheet: NewWorksheet): Uint8Array {
  const g = gridAt(src, SHEET_COUNTS, SHEET_TABLE);
  if (!g) throw new Error("the worksheet to copy can't be read");
  const cols = sheet.widths.length;
  const rows = sheet.rows.length;
  if (cols < 1 || rows < 1 || cols > 0xfff || rows > 0xffff) throw new Error("a worksheet needs from 1 to 4095 columns and 1 to 65535 rows");
  if (sheet.rows.some((r) => r.length > cols)) throw new Error("a row has more cells than the worksheet has columns");
  const plainRows = Array.from({ length: g.rows }, (_, r) => rowAt(g, r)).filter((p): p is number => p !== null && u16(src, p) === ROW_PLAIN);
  // a text cell of a plain row, or any cell
  let from: number | null = null;
  for (let r = 0; r < g.rows && from === null; r++) {
    const head = rowAt(g, r);
    if (head === null || u16(src, head) !== ROW_PLAIN) continue;
    for (let c = 0; c < g.cols && from === null; c++) {
      const p = cellAt(g, r, c);
      if (p !== null && src[p + FORMAT_SIZE] === KIND_TEXT) from = p;
    }
  }
  for (let r = 0; r < g.rows && from === null; r++) for (let c = 0; c < g.cols && from === null; c++) from = cellAt(g, r, c);
  if (from === null) throw new Error("the worksheet to copy has no cell to copy a format from");
  const format = src.slice(from, from + FORMAT_SIZE);
  // unmerged, unfilled, not wrapped
  format.fill(0, 0x11, 0x1a);
  format.fill(0, 0x1b, 0x1e);
  format[0x0d] = 0;

  const n = cols + rows * (cols + 1) + 1;
  const table = new Uint8Array(8 * n);
  const items: Uint8Array[] = [];
  let at = SHEET_TABLE + table.length;
  const add = (entry: number, item: Uint8Array): void => {
    setU32(table, 8 * entry + 4, at - (SHEET_TABLE - 8));
    items.push(item);
    at += item.length;
  };
  let left = 0;
  sheet.widths.forEach((w, c) => {
    const item = new Uint8Array(6);
    setU16(item, 0, COLUMN);
    setU16(item, 2, Math.max(1, Math.round(w)));
    setU16(item, 4, left);
    left += u16(item, 2);
    add(c, item);
  });
  const height = Math.max(1, Math.round(sheet.rowHeight));
  // rows' and columns' places are u16 points
  if (left > 0xffff || rows * height > 0xffff) throw new Error("the worksheet would be more than 65535 points wide or tall");
  sheet.rows.forEach((line, r) => {
    const entry = cols + r * (cols + 1);
    // the row's last word is the first plain row's (1 in most samples)
    const item = new Uint8Array(8);
    setU16(item, 0, ROW_PLAIN);
    setU16(item, 2, height);
    setU16(item, 4, r * height);
    setU16(item, 6, plainRows.length ? u16(src, plainRows[0] + 6) : 1);
    add(entry, item);
    line.forEach((cell, c) => {
      if (!cell) return;
      const f = format.slice();
      f[0x02] = cell.align ? ALIGN_CODES[cell.align] : 0;
      setU16(f, 0x08, cell.bold ? 1 : 0);
      f[0x0a] = typeof cell.value === "number" ? (cell.format ?? 0) : 0;
      f[0x0b] = Math.max(0, Math.min(10, Math.round(cell.accuracy ?? 3)));
      add(entry + 1 + c, concat([f, cellValue(cell.value, null)]));
    });
  });
  setU32(table, 8 * (n - 1) + 4, at - (SHEET_TABLE - 8));

  const out = concat([src.subarray(0, SHEET_TABLE), table, ...items]);
  setU16(out, SHEET_COUNTS, cols);
  setU16(out, SHEET_COUNTS + 2, rows);
  SELECTION_WORDS.forEach((w, i) => setU16(out, SHEET_SELECTION + 2 * i, w));
  setU64(out, 0, BigInt(out.length));
  return out;
}

function boxAt(d: Uint8Array, at: number): BBox | null {
  const [top, left, bottom, right] = [0, 8, 16, 24].map((k) => f64(d, at + k));
  if (![top, left, bottom, right].every(Number.isFinite)) return null;
  return { x0: Math.min(left, right), y0: Math.min(top, bottom), x1: Math.max(left, right), y1: Math.max(top, bottom) };
}

/** A worksheet image on a sheet layer (type 56), or null when the record can't be read. */
export function readWorksheetImage(d: Uint8Array): WorksheetImage | null {
  if (d.length < IMAGE_SCALE + 8) return null;
  const bounds = boxAt(d, IMAGE_BOUNDS);
  const box = boxAt(d, IMAGE_FRAME) ?? bounds;
  const scale = f64(d, IMAGE_SCALE);
  if (!bounds || !box || !(scale > 0 && scale < 1e6)) return null;
  return { box, bounds, worksheet: u32(d, IMAGE_SHEET), scale };
}
