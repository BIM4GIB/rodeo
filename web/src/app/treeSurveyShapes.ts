// Import Tree Survey File's sums: a file's rows as columns and data, which parameter and unit a column's name suggests, and
// where each row says its tree stands. Kept apart from the page (treeSurveyImport.ts) so a check can run it. Lengths in mm.

import type { Pt, RecordField } from "../core/index.ts";
import { parseDegrees, type LatLon } from "./geoShapes.ts";
import { fieldLength, FIELD_UNITS, guessParameter, TREE_PARAMETERS, type FieldMapping, type FieldUnit, type TreeParameter } from "./treeMapping.ts";

export const LOCATION_PARAMETERS = [
  { id: "x", label: "X Coordinate" },
  { id: "y", label: "Y Coordinate" },
  { id: "z", label: "Z Coordinate" },
  { id: "xy", label: "XY Coordinates" },
  { id: "yx", label: "YX Coordinates" },
  { id: "lat", label: "Latitude" },
  { id: "lon", label: "Longitude" },
  { id: "latlon", label: "Latitude/Longitude" },
  { id: "lonlat", label: "Longitude/Latitude" },
] as const;

export type LocationParameter = (typeof LOCATION_PARAMETERS)[number]["id"];
export type SurveyParameter = TreeParameter | LocationParameter;

export const SURVEY_PARAMETERS: readonly { readonly id: SurveyParameter; readonly label: string }[] = [...TREE_PARAMETERS, ...LOCATION_PARAMETERS];

export interface SurveyTable {
  readonly columns: readonly string[];
  readonly data: readonly (readonly string[])[];
}

/** A file's rows as a table. Data starts at this row, 1 being the first, and without counting a header, which is the row at that number. */
export function surveyTable(rows: readonly (readonly string[])[], startRow: number, headers: boolean): SurveyTable {
  const first = Math.max(1, Math.floor(startRow) || 1) - 1;
  const header = headers ? (rows[first] ?? []) : [];
  const data = rows.slice(headers ? first + 1 : first).filter((row) => row.some((c) => String(c ?? "").trim()));
  const width = Math.max(header.length, ...data.map((row) => row.length), 0);
  const used = new Set<string>();
  const columns = Array.from({ length: width }, (_, i) => {
    const name = String(header[i] ?? "").trim() || (headers ? `Column ${i + 1}` : String(i + 1));
    let unique = name;
    for (let n = 2; used.has(unique); n++) unique = `${name} (${n})`;
    used.add(unique);
    return unique;
  });
  return { columns, data };
}

const LOOKS_LIKE: readonly (readonly [RegExp, LocationParameter])[] = [
  [/^lat.*lon|^lat.*lng/i, "latlon"],
  [/^lon.*lat|^lng.*lat/i, "lonlat"],
  [/^xy\b/i, "xy"],
  [/^yx\b/i, "yx"],
  [/^lat/i, "lat"],
  [/^lon|^lng/i, "lon"],
  [/^x\b|^x[ _-]*coord|east/i, "x"],
  [/^y\b|^y[ _-]*coord|north/i, "y"],
  [/^z\b|^z[ _-]*coord|^elev|elevation/i, "z"],
];

/** The parameter a column's name suggests. */
export function guessSurveyParameter(column: string): SurveyParameter {
  return LOOKS_LIKE.find(([re]) => re.test(column))?.[1] ?? guessParameter(column);
}

const UNIT_WORDS: readonly (readonly [RegExp, FieldUnit])[] = [
  [/\(\s*mm\s*\)|\bmillim/i, "mm"],
  [/\(\s*cm\s*\)|\bcentim/i, "cm"],
  [/\(\s*m\s*\)|\bmet(er|re)s?\b/i, "m"],
  [/\(\s*in\.?\s*\)|\binch(es)?\b/i, "in"],
  [/\(\s*ft\.?\s*\)|\bfeet\b|\bfoot\b/i, "ft"],
];

/** The unit a column's name says it's in, if any. */
export const guessSurveyUnit = (column: string): FieldUnit => UNIT_WORDS.find(([re]) => re.test(column))?.[1] ?? "auto";

/** One pair of figures in brackets, many, or neither: [10, 20] or [[10, 10], [10, 20], [20, 20]]. */
export function bracketedPairs(text: string): { readonly one: boolean; readonly pairs: readonly (readonly [number, number])[] } | null {
  if (!text.trim().startsWith("[")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
  if (pair(parsed)) return { one: true, pairs: [[parsed[0], parsed[1]]] };
  if (Array.isArray(parsed) && parsed.length && parsed.every(pair)) return { one: false, pairs: (parsed as [number, number][]).map((q) => [q[0], q[1]]) };
  return null;
}

export interface ColumnMapping {
  readonly column: string;
  readonly parameter: SurveyParameter;
  readonly unit: FieldUnit;
}

export type TreeSite = { readonly kind: "point"; readonly at: Pt; readonly z: number | null } | { readonly kind: "area"; readonly ring: readonly Pt[] };

const FAR_AS_A_DEGREE = { lat: 90, lon: 180 } as const;

/** Does this mapping say where trees go? */
export function locates(mappings: readonly ColumnMapping[]): boolean {
  const has = (id: SurveyParameter): boolean => mappings.some((m) => m.parameter === id);
  return (has("x") && has("y")) || has("xy") || has("yx") || (has("lat") && has("lon")) || has("latlon") || has("lonlat");
}

/** Whether a mapping needs the drawing's georeferencing. */
export const usesDegrees = (mappings: readonly ColumnMapping[]): boolean => mappings.some((m) => m.parameter === "lat" || m.parameter === "lon" || m.parameter === "latlon" || m.parameter === "lonlat");

/** Where a row's tree stands, or the area it covers; null if the row doesn't say. */
export function siteOf(row: Readonly<Record<string, string>>, mappings: readonly ColumnMapping[], docUnits: string | undefined, toDrawing: (p: LatLon) => Pt | null): TreeSite | null {
  const find = (id: SurveyParameter): ColumnMapping | undefined => mappings.find((m) => m.parameter === id);
  const text = (m: ColumnMapping | undefined): string => (m ? String(row[m.column] ?? "").trim() : "");
  const length = (value: string | number, unit: FieldUnit): number | null => fieldLength({ name: "", kind: "text", value: String(value) } as RecordField, unit, docUnits);
  const degrees = (lat: number | null, lon: number | null): Pt | null => (lat === null || lon === null || Math.abs(lat) > FAR_AS_A_DEGREE.lat || Math.abs(lon) > FAR_AS_A_DEGREE.lon ? null : toDrawing({ lat, lon }));
  const zOf = (): number | null => {
    const m = find("z");
    return m && text(m) ? length(text(m), m.unit) : null;
  };
  // a pair's place, as it's written in the parameter it's mapped to
  const place = (m: ColumnMapping, a: number, b: number): Pt | null => {
    if (m.parameter === "latlon") return degrees(a, b);
    if (m.parameter === "lonlat") return degrees(b, a);
    const [x, y] = m.parameter === "xy" ? [a, b] : [b, a];
    const [px, py] = [length(x, m.unit), length(y, m.unit)];
    return px === null || py === null ? null : { x: px, y: py };
  };
  for (const id of ["xy", "yx", "latlon", "lonlat"] as const) {
    const m = find(id);
    const pairs = m ? bracketedPairs(text(m)) : null;
    if (!m || !pairs) continue;
    const spots = pairs.pairs.map(([a, b]) => place(m, a, b));
    if (spots.some((q) => q === null)) continue;
    if (pairs.one) return { kind: "point", at: spots[0] as Pt, z: zOf() };
    if (spots.length >= 3) return { kind: "area", ring: spots as Pt[] };
  }
  const [mx, my] = [find("x"), find("y")];
  if (mx && my && text(mx) && text(my)) {
    const [x, y] = [length(text(mx), mx.unit), length(text(my), my.unit)];
    if (x !== null && y !== null) return { kind: "point", at: { x, y }, z: zOf() };
  }
  const [mLat, mLon] = [find("lat"), find("lon")];
  if (mLat && mLon) {
    const at = degrees(parseDegrees(text(mLat)), parseDegrees(text(mLon)));
    if (at) return { kind: "point", at, z: zOf() };
  }
  return null;
}

/** The mappings a tree takes, for its parameters. */
export function treeMappings(mappings: readonly ColumnMapping[]): FieldMapping[] {
  const trees = new Set<string>(TREE_PARAMETERS.map((p) => p.id));
  return mappings.filter((m) => m.parameter !== "none" && trees.has(m.parameter)).map((m) => ({ field: m.column, parameter: m.parameter as TreeParameter, unit: m.unit }));
}

/** A row as a record's fields. */
export const rowFields = (row: Readonly<Record<string, string>>): RecordField[] => Object.entries(row).map(([name, value]): RecordField => ({ name, kind: "text", value }));

export const isUnit = (id: string): id is FieldUnit => FIELD_UNITS.some((u) => u.id === id);
