// Worksheets as delimited text (File > Export > Export Worksheet…): tab-delimited, or CSV with
// commas or semicolons between the values, a line each with CRLF endings, as spreadsheets write
// them; and as DIF and SYLK, the older interchange formats Vectorworks also offers.

export type DelimitedFormat = "tab" | "comma" | "semicolon";

/**
 * The rows as delimited text. Tab-delimited values have their tabs and line breaks made spaces; a
 * CSV value holding the delimiter, a quote or a line break is quoted, its quotes doubled. Trailing
 * empty rows are left out.
 */
export function delimitedText(rows: readonly (readonly string[])[], format: DelimitedFormat): string {
  const sep = format === "tab" ? "\t" : format === "comma" ? "," : ";";
  const value = (v: string): string => {
    if (format === "tab") return v.replace(/[\t\r\n]+/g, " ");
    return v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((v) => v === "")) end--;
  return rows
    .slice(0, end)
    .map((r) => r.map(value).join(sep) + "\r\n")
    .join("");
}

/** A value written as a number: what a spreadsheet reads as one, digits and all. */
export function isPlainNumber(v: string): boolean {
  const t = v.trim();
  return /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(t) && Number.isFinite(Number(t));
}

/** The rows up to the last that holds a value, and how many columns the widest of them has. */
function trimmed(rows: readonly (readonly string[])[]): { rows: readonly (readonly string[])[]; cols: number } {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((v) => v === "")) end--;
  const kept = rows.slice(0, end);
  return { rows: kept, cols: Math.max(0, ...kept.map((r) => r.length)) };
}

/** Text on one line: line breaks and tabs made spaces. */
const oneLine = (v: string): string => v.replace(/[\t\r\n]+/g, " ");

/**
 * The rows as DIF (Data Interchange Format), as Excel writes it: the header's table, vectors (its
 * columns) and tuples (its rows), then each row from BOT, a number as 0,n V and text as 1,0 "text"
 * (its quotes doubled), an empty cell as empty text, EOD at the end. CRLF line endings.
 */
export function difText(rows: readonly (readonly string[])[], title: string): string {
  const t = trimmed(rows);
  const quote = (v: string): string => `"${oneLine(v).replace(/"/g, '""')}"`;
  const out = ["TABLE", "0,1", quote(title), "VECTORS", `0,${t.cols}`, '""', "TUPLES", `0,${t.rows.length}`, '""', "DATA", "0,0", '""'];
  for (const row of t.rows) {
    out.push("-1,0", "BOT");
    for (let c = 0; c < t.cols; c++) {
      const v = row[c] ?? "";
      if (v !== "" && isPlainNumber(v)) out.push(`0,${Number(v.trim())}`, "V");
      else out.push("1,0", quote(v));
    }
  }
  out.push("-1,0", "EOD");
  return out.join("\r\n") + "\r\n";
}

/**
 * The rows as SYLK: an ID record, the sheet's bounds (B), a C record per value at its row (Y)
 * and column (X), numbers as they are and text quoted with its semicolons doubled, and E at the
 * end. CRLF line endings.
 */
export function sylkText(rows: readonly (readonly string[])[]): string {
  const t = trimmed(rows);
  const out = ["ID;PRodeo", `B;Y${Math.max(1, t.rows.length)};X${Math.max(1, t.cols)}`];
  t.rows.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === "") return;
      const value = isPlainNumber(v) ? String(Number(v.trim())) : `"${oneLine(v).replace(/;/g, ";;")}"`;
      out.push(`C;Y${r + 1};X${c + 1};K${value}`);
    }),
  );
  out.push("E");
  return out.join("\r\n") + "\r\n";
}

/** Windows-1252's characters in 0x80–0x9F, by their byte. */
export const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** The text in Windows-1252, as Excel reads DIF and SYLK; a character it lacks becomes "?", and is counted. */
export function windows1252(text: string): { bytes: Uint8Array; lost: number } {
  const bytes: number[] = [];
  let lost = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    const high = CP1252_HIGH.indexOf(ch);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (high >= 0 && !/[\u0081\u008d\u008f\u0090\u009d]/.test(ch)) bytes.push(0x80 + high);
    else {
      bytes.push(0x3f);
      lost++;
    }
  }
  return { bytes: Uint8Array.from(bytes), lost };
}
