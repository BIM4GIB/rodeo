// Shapefiles read (File > Import > Import Shapefile…): the geometry (.shp), its attribute table
// (.dbf, its text in the encoding the .cpg names, else UTF-8 or Windows-1252) and its coordinate
// system (.prj), from the files picked or a zip of them. Points, multipoints, polylines and
// polygons are read, their Z and M variants in plan (MultiPatch features are counted, not read); a
// polygon's rings are sorted into outlines and the holes inside them. Kept apart from the page so
// it runs in Node.

import type { Pt } from "../core/index.ts";
import { decodeText, windows1252Text } from "./worksheet.ts";
import { unzip } from "./zip.ts";

export type ShapeGeometry =
  | { kind: "point"; points: Pt[] }
  | { kind: "line"; parts: Pt[][] }
  /** each outline with the holes inside it */
  | { kind: "polygon"; polygons: { outer: Pt[]; holes: Pt[][] }[] };

export type DbfValue = string | number | boolean | null;

export interface DbfField {
  name: string;
  /** dBase's type letter: C text, N and F numbers, L logical, D date, and others read as text */
  type: string;
  length: number;
  decimals: number;
}

export interface CoordinateSystem {
  /** the .prj's name for it ("WGS 84", "OSGB 1936 / British National Grid") */
  name: string;
  /** longitude and latitude in degrees, not a projection onto a plane */
  geographic: boolean;
  /** metres per coordinate unit, for a projected system */
  metresPerUnit: number;
  unitName: string;
}

export interface Shapefile {
  name: string;
  /** each feature's geometry, null for a null shape */
  features: (ShapeGeometry | null)[];
  fields: DbfField[];
  /** per feature, its row's values in field order (empty when there is no .dbf) */
  rows: DbfValue[][];
  crs: CoordinateSystem | null;
  /** features of kinds not read (MultiPatch) */
  skipped: number;
  /** bounds of the features' points */
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** a feature count past which a file is refused */
export const MAX_FEATURES = 100_000;
const MAX_POINTS = 5_000_000;

// ---- .shp ------------------------------------------------------------------------------

/** The geometry of a .shp file, a feature per record. */
export function parseShp(bytes: Uint8Array): { features: (ShapeGeometry | null)[]; skipped: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 100 || v.getInt32(0, false) !== 9994) throw new Error("this isn't a shapefile: its .shp has no shapefile header");
  const end = Math.min(bytes.length, v.getInt32(24, false) * 2 || bytes.length);
  const features: (ShapeGeometry | null)[] = [];
  let skipped = 0;
  let points = 0;
  const pt = (at: number): Pt => ({ x: v.getFloat64(at, true), y: v.getFloat64(at + 8, true) });
  for (let at = 100; at + 12 <= end; ) {
    const length = v.getInt32(at + 4, false) * 2;
    const c = at + 8;
    at = c + length;
    if (length < 4 || at > bytes.length) break;
    if (features.length >= MAX_FEATURES) throw new Error(`it holds more than ${MAX_FEATURES.toLocaleString()} features`);
    const type = v.getInt32(c, true);
    switch (type) {
      case 0:
        features.push(null);
        break;
      case 1:
      case 11:
      case 21:
        features.push({ kind: "point", points: [pt(c + 4)] });
        points++;
        break;
      case 8:
      case 18:
      case 28: {
        const n = v.getInt32(c + 36, true);
        if (n < 0 || c + 40 + n * 16 > at) throw new Error("a multipoint runs past its record");
        features.push({ kind: "point", points: Array.from({ length: n }, (_, i) => pt(c + 40 + i * 16)) });
        points += n;
        break;
      }
      case 3:
      case 13:
      case 23:
      case 5:
      case 15:
      case 25: {
        const nParts = v.getInt32(c + 36, true);
        const nPoints = v.getInt32(c + 40, true);
        const first = c + 44 + nParts * 4;
        if (nParts < 0 || nPoints < 0 || first + nPoints * 16 > at) throw new Error("a shape runs past its record");
        points += nPoints;
        if (points > MAX_POINTS) throw new Error(`it holds more than ${MAX_POINTS.toLocaleString()} points`);
        const parts: Pt[][] = [];
        for (let p = 0; p < nParts; p++) {
          const from = v.getInt32(c + 44 + p * 4, true);
          const to = p + 1 < nParts ? v.getInt32(c + 44 + (p + 1) * 4, true) : nPoints;
          if (from < 0 || to > nPoints || to < from) throw new Error("a shape's parts are out of order");
          parts.push(Array.from({ length: to - from }, (_, i) => pt(first + (from + i) * 16)));
        }
        const line = type === 3 || type === 13 || type === 23;
        features.push(line ? { kind: "line", parts: parts.filter((p) => p.length >= 2) } : { kind: "polygon", polygons: ringsToPolygons(parts) });
        break;
      }
      default:
        // MultiPatch (31) and anything else
        features.push(null);
        skipped++;
    }
  }
  return { features, skipped };
}

/** Twice the ring's signed area: negative when it runs clockwise, as a shapefile's outlines do. */
function area2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return a;
}

function inside(p: Pt, ring: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * A polygon's rings as outlines with their holes: clockwise rings are outlines and anticlockwise
 * ones holes (the shapefile rule), each hole going to the smallest outline holding it. A file that
 * winds them the other way round (no clockwise ring) is read with the windings swapped. The closing
 * point a ring repeats is left off.
 */
function ringsToPolygons(parts: Pt[][]): { outer: Pt[]; holes: Pt[][] }[] {
  const rings = parts
    .map((r) => (r.length > 1 && r[0].x === r[r.length - 1].x && r[0].y === r[r.length - 1].y ? r.slice(0, -1) : r))
    .filter((r) => r.length >= 3)
    .map((points) => ({ points, area: area2(points) }));
  if (!rings.length) return [];
  const flip = !rings.some((r) => r.area < 0);
  const outers = rings.filter((r) => (flip ? r.area > 0 : r.area < 0)).map((r) => ({ outer: r.points, size: Math.abs(r.area), holes: [] as Pt[][] }));
  for (const r of rings) {
    if (flip ? r.area > 0 : r.area < 0) continue;
    const owner = outers.filter((o) => inside(r.points[0], o.outer)).sort((a, b) => a.size - b.size)[0];
    // a hole in no outline is an outline of its own
    if (owner) owner.holes.push(r.points);
    else outers.push({ outer: r.points, size: Math.abs(r.area), holes: [] });
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

// ---- .dbf ------------------------------------------------------------------------------

/** The text decoder a .cpg names, or null to tell UTF-8 from Windows-1252 value by value. */
function decoderFor(cpg: string | null): ((b: Uint8Array) => string) | null {
  const c = (cpg ?? "").trim().toUpperCase();
  if (/UTF-?8|65001/.test(c)) return (b) => new TextDecoder("utf-8").decode(b);
  if (/1252|8859-?1|88591|LATIN/.test(c)) return windows1252Text;
  return null;
}

/** A .dbf table: its fields and each row's values (a deleted row's too, as GIS programs keep them in step with the shapes). */
export function parseDbf(bytes: Uint8Array, cpg: string | null): { fields: DbfField[]; rows: DbfValue[][] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33) throw new Error("its .dbf is too short to be a dBase table");
  const count = v.getUint32(4, true);
  const headerSize = v.getUint16(8, true);
  const recordSize = v.getUint16(10, true);
  const fields: DbfField[] = [];
  const ascii = (a: number, b: number): string => String.fromCharCode(...bytes.subarray(a, b));
  for (let at = 32; at + 32 <= headerSize && bytes[at] !== 0x0d; at += 32) {
    const raw = bytes.subarray(at, at + 11);
    const nul = raw.indexOf(0);
    fields.push({ name: ascii(at, at + (nul < 0 ? 11 : nul)).trim(), type: String.fromCharCode(bytes[at + 11]).toUpperCase(), length: bytes[at + 16], decimals: bytes[at + 17] });
  }
  const decode = decoderFor(cpg) ?? decodeText;
  const rows: DbfValue[][] = [];
  for (let r = 0; r < count; r++) {
    const start = headerSize + r * recordSize;
    if (start + recordSize > bytes.length) break;
    let at = start + 1;
    rows.push(
      fields.map((f) => {
        const raw = bytes.subarray(at, at + f.length);
        at += f.length;
        switch (f.type) {
          case "N":
          case "F": {
            const t = String.fromCharCode(...raw).trim();
            const n = Number(t);
            return t === "" || !Number.isFinite(n) ? null : n;
          }
          case "L": {
            const ch = String.fromCharCode(raw[0] ?? 0x3f).toUpperCase();
            return ch === "Y" || ch === "T" ? true : ch === "N" || ch === "F" ? false : null;
          }
          case "D": {
            const t = String.fromCharCode(...raw).trim();
            if (/^0*$/.test(t)) return null;
            return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}` : t;
          }
          case "M":
          case "B":
          case "G":
            // memos live in a .dbt the import doesn't read
            return null;
          default: {
            let end = raw.length;
            while (end > 0 && (raw[end - 1] === 0x20 || raw[end - 1] === 0)) end--;
            const t = decode(raw.subarray(0, end));
            return t === "" ? null : t;
          }
        }
      }),
    );
  }
  return { fields, rows };
}

// ---- .prj ------------------------------------------------------------------------------

/** What a .prj's well-known text says of the coordinate system: its name, and its unit or that it's geographic. */
export function parsePrj(wkt: string): CoordinateSystem {
  const t = wkt.trim();
  const kind = /^(\w+)\s*\[/.exec(t)?.[1]?.toUpperCase() ?? "";
  const name = /^\w+\s*\[\s*"([^"]*)"/.exec(t)?.[1] ?? "";
  const geographic = kind === "GEOGCS" || kind === "GEOGCRS" || kind === "GEODCRS";
  // the projected system's own unit is its last, after the geographic system's and the parameters
  const units = [...t.matchAll(/(?:UNIT|LENGTHUNIT)\s*\[\s*"([^"]*)"\s*,\s*([0-9.eE+-]+)/g)];
  const last = units[units.length - 1];
  const metresPerUnit = geographic || !last ? 1 : Number(last[2]) || 1;
  return { name: name.replace(/_/g, " "), geographic, metresPerUnit, unitName: geographic ? "degree" : (last?.[1] ?? "metre") };
}

// ---- a set of files --------------------------------------------------------------------

/**
 * The shapefiles among the files picked (a zip's files as well), by name: each .shp with the
 * .dbf, .prj and .cpg of the same name beside it.
 */
export function readShapefiles(files: ReadonlyMap<string, Uint8Array>): Shapefile[] {
  const all = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    if (/\.zip$/i.test(name)) {
      for (const [inner, read] of unzip(bytes)) {
        // folders and macOS's resource forks aside
        if (!/\/$/.test(inner) && !/(^|\/)__MACOSX\//.test(inner)) all.set(inner, read());
      }
    } else all.set(name, bytes);
  }
  // a .shp and the files of the same name beside it
  const byStem = new Map<string, { stem: string; files: Map<string, Uint8Array> }>();
  for (const [name, bytes] of all) {
    const m = /^(.*)\.([^./]+)$/.exec(name);
    if (!m) continue;
    const set = byStem.get(m[1].toLowerCase()) ?? { stem: m[1], files: new Map<string, Uint8Array>() };
    set.files.set(m[2].toLowerCase(), bytes);
    byStem.set(m[1].toLowerCase(), set);
  }
  const out: Shapefile[] = [];
  for (const { stem, files: set } of byStem.values()) {
    const shp = set.get("shp");
    if (!shp) continue;
    const name = stem.slice(stem.lastIndexOf("/") + 1);
    const { features, skipped } = parseShp(shp);
    const cpg = set.get("cpg");
    const dbf = set.get("dbf");
    const table = dbf ? parseDbf(dbf, cpg ? new TextDecoder().decode(cpg) : null) : { fields: [], rows: [] };
    const prj = set.get("prj");
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (p: Pt): void => {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    };
    for (const f of features) {
      if (!f) continue;
      if (f.kind === "point") f.points.forEach(grow);
      else if (f.kind === "line") f.parts.forEach((p) => p.forEach(grow));
      else f.polygons.forEach((p) => p.outer.forEach(grow));
    }
    out.push({
      name,
      features,
      fields: table.fields,
      rows: table.rows,
      crs: prj ? parsePrj(new TextDecoder().decode(prj)) : null,
      skipped,
      bbox: Number.isFinite(x0) ? { x0, y0, x1, y1 } : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
