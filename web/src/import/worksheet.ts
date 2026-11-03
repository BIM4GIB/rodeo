// Worksheets read from other programs' files (File > Import > Import Worksheet…), the formats
// Vectorworks' Import Worksheet takes: tab-delimited text, CSV (commas or semicolons, told apart by
// the first line), DIF, SYLK and Excel workbooks (.xlsx: each sheet's values as last calculated,
// its bold, alignment and column widths, dates as text). Text files are UTF-8, or Windows-1252 when
// they aren't. Kept apart from the page so it runs in Node.

import { CP1252_HIGH } from "../export/delimited.ts";
import { unzip } from "./zip.ts";

export interface ImportedCell {
  /** a number makes a number cell, a string a text cell */
  value: string | number;
  bold?: boolean;
  align?: "left" | "center" | "right";
}

export interface ImportedSheet {
  name: string;
  /** null for an empty cell */
  rows: (ImportedCell | null)[][];
  /** points, where the file sets a column's width */
  widths: (number | undefined)[];
  /** formulas the file holds without a value calculated, left empty */
  uncalculated?: number;
}

/** A plain number as a spreadsheet writes one; a leading zero ("007") keeps it text, as a code. */
const NUMBER = /^[-+]?(0|[1-9]\d*)?(\.\d+)?(e[-+]?\d+)?$/i;

/** The text's cell: a number when it is a plain one, null when empty. */
export function cellOf(text: string): ImportedCell | null {
  if (text === "") return null;
  const t = text.trim();
  if (t !== "" && /\d/.test(t) && NUMBER.test(t) && Number.isFinite(Number(t))) return { value: Number(t) };
  return { value: text };
}

/** The file's text: UTF-8 (a byte order mark dropped), or Windows-1252 when it isn't UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return windows1252Text(bytes);
  }
}

/** Windows-1252 text, decoded by hand: some TextDecoders read it as Latin-1, losing € and the curly quotes. */
export function windows1252Text(bytes: Uint8Array): string {
  const out: string[] = [];
  for (const b of bytes) out.push(b >= 0x80 && b < 0xa0 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b));
  return out.join("");
}

/** The separator a CSV's first line uses: semicolons when it has more of them than commas, outside quotes. */
export function csvSeparator(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

/**
 * Delimited text's rows: values between `sep`, a quoted value holding separators, line breaks and
 * doubled quotes. Lines end in CRLF, LF or CR; a last empty line is no row.
 */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let i = 0;
  const n = text.length;
  const stop = sep === "\t" ? /[\t\r\n]/g : sep === ";" ? /[;\r\n]/g : /[,\r\n]/g;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' && value === "") {
      // a quoted value, to its closing quote
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) {
          value += text.slice(i);
          i = n;
          break;
        }
        value += text.slice(i, q);
        i = q + 1;
        if (text[i] === '"') {
          value += '"';
          i++;
        } else break;
      }
      // anything after the closing quote and before the separator is kept, as spreadsheets keep it
      continue;
    }
    if (ch === sep) {
      row.push(value);
      value = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      stop.lastIndex = i;
      const end = stop.exec(text)?.index ?? n;
      value += text.slice(i, end);
      i = end;
    }
  }
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

/** DIF (Data Interchange Format): its header, then each row's values between BOT and the next BOT or EOD. */
export function parseDif(text: string): (ImportedCell | null)[][] {
  const lines = text.split(/\r\n|\r|\n/);
  let i = lines.findIndex((l) => l.trim() === "DATA");
  if (i < 0) throw new Error("this isn't a DIF file: it has no DATA section");
  // the DATA header's own value pair and string
  i += 3;
  const rows: (ImportedCell | null)[][] = [];
  let row: (ImportedCell | null)[] | null = null;
  const unquote = (s: string): string => {
    const t = s.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
  };
  while (i + 1 < lines.length) {
    const [kind, num] = lines[i].split(",");
    const str = lines[i + 1];
    i += 2;
    const k = Number(kind);
    if (k === -1) {
      if (str.trim() === "EOD") break;
      if (str.trim() === "BOT") rows.push((row = []));
      continue;
    }
    if (!row) continue;
    if (k === 0) {
      // V a value, NA and ERROR none, TRUE and FALSE the words
      const flag = str.trim();
      if (flag === "V") row.push(cellOf(num.trim()));
      else if (flag === "TRUE" || flag === "FALSE") row.push({ value: flag });
      else row.push(null);
    } else if (k === 1) row.push(cellOf(unquote(str)));
  }
  return rows;
}

/** SYLK: its C records' values (K) at their row (Y) and column (X), each kept from the record before when left out. */
export function parseSylk(text: string): (ImportedCell | null)[][] {
  const lines = text.split(/\r\n|\r|\n/);
  if (!lines[0]?.startsWith("ID")) throw new Error("this isn't a SYLK file: it doesn't start with ID");
  const rows: (ImportedCell | null)[][] = [];
  let y = 1;
  let x = 1;
  for (const line of lines) {
    if (line === "E") break;
    // fields are split at single semicolons; a doubled one is a semicolon in the value
    const fields = line.split(/(?<!;);(?!;)/).map((f) => f.replace(/;;/g, ";"));
    const type = fields[0];
    if (type !== "C" && type !== "F") continue;
    let value: string | null = null;
    for (const f of fields.slice(1)) {
      if (f[0] === "Y") y = Number(f.slice(1)) || y;
      else if (f[0] === "X") x = Number(f.slice(1)) || x;
      else if (f[0] === "K" && type === "C") value = f.slice(1);
    }
    if (value === null) continue;
    const cell = value.startsWith('"') ? { value: value.replace(/^"|"$/g, "") } : value === "TRUE" || value === "FALSE" ? { value } : cellOf(value);
    const row = (rows[y - 1] ??= []);
    while (row.length < x - 1) row.push(null);
    row[x - 1] = cell;
  }
  for (let r = 0; r < rows.length; r++) rows[r] ??= [];
  return rows;
}

// ---- Excel workbooks ---------------------------------------------------------------------

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()] ?? "";
  });
}

/** A tag's attributes, by name without its namespace prefix. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].replace(/^\w+:/, "")] = unescapeXml(m[3] ?? m[4] ?? "");
  return out;
}

/** The elements named `name` (any namespace prefix): their opening tag and what they hold. */
function* elements(xml: string, name: string): Generator<{ tag: string; body: string }> {
  const re = new RegExp(`<(?:\\w+:)?${name}(?=[\\s/>])[^>]*?(/?)>`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] === "/") {
      yield { tag: m[0], body: "" };
      continue;
    }
    const close = new RegExp(`</(?:\\w+:)?${name}>`, "g");
    close.lastIndex = re.lastIndex;
    const c = close.exec(xml);
    const end = c ? c.index : xml.length;
    yield { tag: m[0], body: xml.slice(re.lastIndex, end) };
    re.lastIndex = c ? close.lastIndex : xml.length;
  }
}

/** The text of a string item: its runs' text, phonetic readings left out. */
function itemText(body: string): string {
  const plain = body.replace(/<(?:\w+:)?rPh[\s>][\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  return [...elements(plain, "t")].map((t) => unescapeXml(t.body)).join("");
}

/** The column (0-based) and row (1-based) of a reference such as "AB12". */
function refOf(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

/** Excel's built-in date and time formats. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Whether a number format code shows a date or time: d, m, y, h or s outside quotes and brackets. */
function isDateCode(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A date serial number as text: "2026-11-01", "2026-11-01 14:30" or "14:30:15". */
function dateText(serial: number, date1904: boolean): string {
  const ms = Math.round(serial * 86400000) + (date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30));
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${pad(d.getUTCSeconds())}` : ""}`;
  if (serial < 1 && serial >= 0) return time;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return serial % 1 === 0 ? day : `${day} ${time}`;
}

/** points for an Excel column width in characters (Calibri 11's digit, 7 px, and 5 px of padding) */
function widthPoints(chars: number): number {
  return Math.round((Math.trunc(chars * 7 + 5) * 3) / 4);
}

interface Style {
  bold: boolean;
  align?: "left" | "center" | "right";
  date: boolean;
}

/** An Excel workbook's sheets, each with its values as last calculated. */
export function readXlsx(bytes: Uint8Array): ImportedSheet[] {
  const files = unzip(bytes);
  const text = (path: string): string | null => {
    const read = files.get(path);
    return read ? new TextDecoder().decode(read()) : null;
  };
  const relsOf = (path: string): Map<string, string> => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    const rels = text(`${dir}_rels/${path.slice(dir.length)}.rels`) ?? "";
    const out = new Map<string, string>();
    for (const r of elements(rels, "Relationship")) {
      const a = attrs(r.tag);
      if (!a.Id || !a.Target) continue;
      out.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : normalise(dir + a.Target));
    }
    return out;
  };
  const root = text("_rels/.rels") ?? "";
  const main = [...elements(root, "Relationship")].map((r) => attrs(r.tag)).find((a) => /\/officeDocument$/.test(a.Type ?? ""));
  const bookPath = main?.Target ? normalise(main.Target.replace(/^\//, "")) : "xl/workbook.xml";
  const book = text(bookPath);
  if (book === null) throw new Error("this workbook has no workbook part: is it an .xlsx file?");
  const rels = relsOf(bookPath);
  const date1904 = [...elements(book, "workbookPr")].some((w) => /^(1|true)$/.test(attrs(w.tag).date1904 ?? ""));
  const dir = bookPath.slice(0, bookPath.lastIndexOf("/") + 1);
  const relOfType = (type: string): string | null => {
    const bookRels = text(`${dir}_rels/${bookPath.slice(dir.length)}.rels`) ?? "";
    const r = [...elements(bookRels, "Relationship")].map((e) => attrs(e.tag)).find((a) => (a.Type ?? "").endsWith(`/${type}`));
    return r?.Target ? (r.Target.startsWith("/") ? r.Target.slice(1) : normalise(dir + r.Target)) : null;
  };

  const sharedPath = relOfType("sharedStrings");
  const shared = sharedPath ? [...elements(text(sharedPath) ?? "", "si")].map((si) => itemText(si.body)) : [];

  const styles: Style[] = [];
  const stylesPath = relOfType("styles");
  const stylesXml = stylesPath ? (text(stylesPath) ?? "") : "";
  if (stylesXml) {
    const codes = new Map<number, string>();
    for (const f of elements(stylesXml, "numFmt")) {
      const a = attrs(f.tag);
      codes.set(Number(a.numFmtId), a.formatCode ?? "");
    }
    const fontsXml = [...elements(stylesXml, "fonts")][0]?.body ?? "";
    const bold = [...elements(fontsXml, "font")].map((f) => [...elements(f.body, "b")].some((b) => !/^(0|false)$/.test(attrs(b.tag).val ?? "")));
    const xfsXml = [...elements(stylesXml, "cellXfs")][0]?.body ?? "";
    for (const xf of elements(xfsXml, "xf")) {
      const a = attrs(xf.tag);
      const fmt = Number(a.numFmtId ?? 0);
      const align = attrs([...elements(xf.body, "alignment")][0]?.tag ?? "").horizontal;
      styles.push({
        bold: bold[Number(a.fontId ?? 0)] ?? false,
        align: align === "left" || align === "right" ? align : align === "center" || align === "centerContinuous" ? "center" : undefined,
        date: DATE_FORMATS.has(fmt) || (codes.has(fmt) && isDateCode(codes.get(fmt) ?? "")),
      });
    }
  }

  const sheets: ImportedSheet[] = [];
  for (const s of elements(book, "sheet")) {
    const a = attrs(s.tag);
    const path = a.id ? rels.get(a.id) : undefined;
    const xml = path ? text(path) : null;
    if (xml === null) continue;
    sheets.push(readSheet(a.name || `Sheet${sheets.length + 1}`, xml, shared, styles, date1904));
  }
  if (sheets.length === 0) throw new Error("this workbook has no worksheets");
  return sheets;
}

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

function readSheet(name: string, xml: string, shared: readonly string[], styles: readonly Style[], date1904: boolean): ImportedSheet {
  const widths: (number | undefined)[] = [];
  const colsXml = [...elements(xml, "cols")][0]?.body ?? "";
  for (const c of elements(colsXml, "col")) {
    const a = attrs(c.tag);
    const w = Number(a.width);
    if (!Number.isFinite(w)) continue;
    const pts = /^(1|true)$/.test(a.hidden ?? "") ? undefined : widthPoints(w);
    // a run of columns, kept to the first few thousand as a sheet's last <col> often runs to XFD
    for (let i = Number(a.min); i <= Math.min(Number(a.max), 4096); i++) widths[i - 1] = pts;
  }
  const rows: (ImportedCell | null)[][] = [];
  const data = [...elements(xml, "sheetData")][0]?.body ?? "";
  let r = 0;
  let uncalculated = 0;
  for (const row of elements(data, "row")) {
    const ra = attrs(row.tag);
    r = ra.r ? Number(ra.r) : r + 1;
    const line: (ImportedCell | null)[] = [];
    let c = -1;
    for (const cell of elements(row.body, "c")) {
      const a = attrs(cell.tag);
      c = (a.r ? refOf(a.r)?.col : undefined) ?? c + 1;
      const style = styles[Number(a.s ?? 0)];
      const v = [...elements(cell.body, "v")][0];
      const raw = v ? unescapeXml(v.body) : null;
      let value: string | number | null = null;
      switch (a.t) {
        case "s":
          value = raw === null ? null : (shared[Number(raw)] ?? "");
          break;
        case "inlineStr":
          value = itemText([...elements(cell.body, "is")][0]?.body ?? "");
          break;
        case "str":
        case "e":
        case "d":
          value = raw;
          break;
        case "b":
          value = raw === null ? null : raw === "1" ? "TRUE" : "FALSE";
          break;
        default:
          if (raw !== null && raw !== "") {
            const n = Number(raw);
            value = !Number.isFinite(n) ? raw : style?.date ? dateText(n, date1904) : n;
          }
      }
      if (value === null || value === "") {
        if (!raw && [...elements(cell.body, "f")].length) uncalculated++;
        continue;
      }
      while (line.length < c) line.push(null);
      line[c] = { value, ...(style?.bold ? { bold: true } : {}), ...(style?.align ? { align: style.align } : {}) };
    }
    if (!line.length) continue;
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = line;
  }
  return { name, rows, widths, ...(uncalculated ? { uncalculated } : {}) };
}

// ---- any of them ---------------------------------------------------------------------------

/** The sheets a file holds, read by its extension (or its first bytes): one but for a workbook. */
export function readWorksheetFile(fileName: string, bytes: Uint8Array): ImportedSheet[] {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
  const base = fileName.replace(/\.[^.]+$/, "");
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (ext === "xlsx" || ext === "xlsm" || zip) return readXlsx(bytes);
  if (ext === "xls" || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new Error("Excel 97–2004 workbooks (.xls) can't be read yet: save it from Excel as an .xlsx workbook, or as CSV");
  }
  const text = decodeText(bytes);
  const plain = (rows: string[][]): ImportedSheet => ({ name: base, rows: rows.map((r) => r.map(cellOf)), widths: [] });
  if (ext === "dif" || /^TABLE\r?\n0,1/.test(text)) return [{ name: base, rows: parseDif(text), widths: [] }];
  if (ext === "slk" || ext === "sylk" || /^ID;/.test(text)) return [{ name: base, rows: parseSylk(text), widths: [] }];
  if (ext === "csv") return [plain(parseDelimited(text, csvSeparator(text)))];
  return [plain(parseDelimited(text, "\t"))];
}
