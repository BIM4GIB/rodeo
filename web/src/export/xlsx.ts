// Worksheets as Excel workbooks (File > Export > Export Worksheet…, Excel): one sheet holding the
// rows, a plain number as a number cell and anything else as text, the columns as wide as their
// longest value. The workbook is the least SpreadsheetML Excel, Numbers and LibreOffice open (a
// workbook, its sheet and a default style), zipped (export/zip.ts).

import { isPlainNumber } from "./delimited.ts";
import { zipFiles } from "./zip.ts";

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The column's letters: A to Z, then AA, AB and on. */
function columnName(col: number): string {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Text for XML: its markup characters escaped, the control characters XML forbids left out. */
function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A sheet name Excel takes: none of []:*?/\, at most 31 characters, not empty. */
export function sheetName(name: string): string {
  const s = name.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31).trim();
  return s || "Worksheet";
}

/** The sheet's XML: the rows (trailing empty ones left out), empty cells left out. */
function sheetXml(rows: readonly (readonly string[])[]): string {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((v) => v === "")) end--;
  const widths: number[] = [];
  const out: string[] = [];
  for (let r = 0; r < end; r++) {
    const cells: string[] = [];
    rows[r].forEach((v, c) => {
      if (v === "") return;
      const longest = Math.max(...v.split(/\r?\n/).map((l) => l.length));
      widths[c] = Math.max(widths[c] ?? 0, longest);
      const ref = `${columnName(c)}${r + 1}`;
      if (isPlainNumber(v)) cells.push(`<c r="${ref}"><v>${Number(v)}</v></c>`);
      else {
        const space = /^\s|\s$|\n/.test(v) ? ' xml:space="preserve"' : "";
        cells.push(`<c r="${ref}" t="inlineStr"><is><t${space}>${xmlText(v)}</t></is></c>`);
      }
    });
    if (cells.length) out.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  const cols = widths
    .map((w, c) => (w === undefined ? "" : `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(8, w + 2))}" customWidth="1"/>`))
    .join("");
  return `${XML_HEAD}<worksheet xmlns="${MAIN}">${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${out.join("")}</sheetData></worksheet>`;
}

/** An Excel workbook (.xlsx) of one sheet, `name`, holding `rows`. */
export function xlsxWorkbook(name: string, rows: readonly (readonly string[])[]): Uint8Array {
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    ],
    ["_rels/.rels", `${XML_HEAD}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      "xl/workbook.xml",
      `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${xmlText(sheetName(name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${XML_HEAD}<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        "</Relationships>",
    ],
    [
      "xl/styles.xml",
      `${XML_HEAD}<styleSheet xmlns="${MAIN}">` +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        "</styleSheet>",
    ],
    ["xl/worksheets/sheet1.xml", sheetXml(rows)],
  ];
  return zipFiles(files.map(([path, text]) => [path, new TextEncoder().encode(text)]));
}
