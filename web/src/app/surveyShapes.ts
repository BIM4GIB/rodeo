// What Survey Input reads and places: rows of a survey file as points, and a grid of them. Plain data in and out
// (surveyInput.ts asks and adds).

import { parseDelimited } from "../import/worksheet.ts";
import type { Pt } from "../core/index.ts";

/** P point number, N northing, E easting, Z elevation, D description. */
export const SURVEY_FORMATS = ["PNEZD", "PENZD", "PNEZ", "PENZ", "NEZD", "ENZD", "NEZ", "ENZ"] as const;
export type SurveyFormat = (typeof SURVEY_FORMATS)[number];

const WORDS: Readonly<Record<string, string>> = { P: "Point", N: "Northing", E: "Easting", Z: "Elevation", D: "Description" };

export const surveyFormatLabel = (format: SurveyFormat): string => [...format].map((c) => WORDS[c]).join(", ");

export const SURVEY_UNITS: readonly { readonly label: string; readonly mm: number }[] = [
  { label: "Feet", mm: 304.8 },
  { label: "US Survey Feet", mm: (1200 / 3937) * 1000 },
  { label: "Inches", mm: 25.4 },
  { label: "Yards", mm: 914.4 },
  { label: "Meters", mm: 1000 },
  { label: "Centimeters", mm: 10 },
  { label: "Millimeters", mm: 1 },
];

export interface SurveyPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly description: string;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

const numberOf = (text: string | undefined): number | null => {
  const t = (text ?? "").trim();
  return NUMBER.test(t) ? Number(t) : null;
};

/** The file's rows. A space between fields can be any number of them; what's quoted stays together for the others. */
export function surveyRows(text: string, delimiter: string): string[][] {
  if (delimiter !== " ") return parseDelimited(text, delimiter).filter((row) => row.some((c) => c.trim()));
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));
}

/** Which of the usual separators a file uses. */
export function guessDelimiter(text: string): string {
  const line = text.split(/\r\n|\r|\n/).find((l) => l.trim()) ?? "";
  for (const candidate of ["\t", ",", ";"]) if (line.includes(candidate)) return candidate;
  return " ";
}

/** The rows that fit a format as points, in the drawing's millimetres, and how many didn't: headers and the like. */
export function readSurvey(rows: readonly (readonly string[])[], format: SurveyFormat, mm: number): { readonly points: SurveyPoint[]; readonly skipped: number } {
  const points: SurveyPoint[] = [];
  let skipped = 0;
  const places = [...format];
  for (const row of rows) {
    const field = (c: string): string | undefined => {
      const i = places.indexOf(c);
      return i < 0 ? undefined : row[i];
    };
    const [n, e, z] = [numberOf(field("N")), numberOf(field("E")), numberOf(field("Z"))];
    if (n === null || e === null || z === null) {
      if (row.some((c) => c.trim())) skipped++;
      continue;
    }
    const from = places.indexOf("D");
    points.push({ id: (field("P") ?? "").trim(), x: e * mm, y: n * mm, z: z * mm, description: from < 0 ? "" : row.slice(from).join(" ").trim() });
  }
  return { points, skipped };
}

/** The format the most likely to fit, going by the first row of figures: a number first means a point number only if there are enough. */
export function guessFormat(rows: readonly (readonly string[])[]): SurveyFormat {
  const first = rows.find((row) => row.filter((c) => numberOf(c) !== null).length >= 3);
  if (!first) return "PNEZD";
  if (first.length === 3) return "ENZ";
  if (first.length === 4) return numberOf(first[3]) === null ? "ENZD" : "PNEZ";
  return "PNEZD";
}

/** A grid's points, row by row across and then down from its upper left corner. */
export function gridPoints(start: Pt, rows: number, columns: number, spacing: number): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) out.push({ x: start.x + i * spacing, y: start.y - j * spacing });
  return out;
}

/** The middle of the points' extents. */
export function surveyCentre(points: readonly SurveyPoint[]): Pt {
  if (!points.length) return { x: 0, y: 0 };
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** An ID as a stake takes it: what comes before its last digits, and those as a number. */
export function idParts(id: string): { readonly prefix: string; readonly number: number } | null {
  if (!id) return null;
  const m = /^(.*?)(\d+)$/.exec(id);
  return m ? { prefix: m[1], number: Number(m[2]) } : { prefix: id, number: 0 };
}

/** Rows and columns of typed or pasted elevations: tabs across, new lines down. */
export const pastedCells = (text: string): string[][] =>
  text
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
