// Shapefiles written (File > Export > Export Shapefile…): one geometry kind a set, as the format
// holds — points (or multipoints when a feature has several), polylines or polygons — with its
// index (.shx), its attribute table (.dbf, UTF-8, which the .cpg says) and no projection (.prj),
// since Rodeo doesn't know the drawing's coordinate system. Polygon outlines run clockwise and
// holes anticlockwise, rings closed, as the format asks.

import type { Pt } from "../core/index.ts";
import type { DbfValue, ShapeGeometry } from "../import/shapefile.ts";

export interface DbfColumn {
  name: string;
  kind: "text" | "number" | "integer" | "boolean";
}

/** the files of one shapefile set, by extension */
export interface ShapefileSet {
  shp: Uint8Array;
  shx: Uint8Array;
  dbf: Uint8Array;
  cpg: Uint8Array;
}

/** Twice the ring's signed area, positive anticlockwise. */
function area2(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return a;
}

/** The ring closed, running clockwise (an outline) or anticlockwise (a hole). */
function ringOf(points: readonly Pt[], clockwise: boolean): Pt[] {
  const r = area2(points) < 0 === clockwise ? [...points] : [...points].reverse();
  const a = r[0];
  const b = r[r.length - 1];
  if (a.x !== b.x || a.y !== b.y) r.push({ ...a });
  return r;
}

/** A feature's parts as the file stores them: its points, or its rings and lines. */
function partsOf(g: ShapeGeometry): Pt[][] {
  if (g.kind === "point") return [g.points];
  if (g.kind === "line") return g.parts;
  return g.polygons.flatMap((p) => [ringOf(p.outer, true), ...p.holes.map((h) => ringOf(h, false))]);
}

/** The DBF field names: letters, digits and _, at most 10, unique (a number added where two meet). */
export function dbfNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((n) => {
    const base = (n.normalize("NFKD").replace(/[^\w]/g, "_").replace(/^_+|_+$/g, "") || "FIELD").slice(0, 10);
    let name = base;
    for (let i = 1; taken.has(name.toUpperCase()); i++) name = `${base.slice(0, 10 - String(i).length - 1)}_${i}`;
    taken.add(name.toUpperCase());
    return name;
  });
}

const utf8 = new TextEncoder();

/** The text's UTF-8 bytes, cut to `max` without splitting a character. */
function bytesUpTo(s: string, max: number): Uint8Array {
  const b = utf8.encode(s);
  if (b.length <= max) return b;
  let end = max;
  while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
  return b.subarray(0, end);
}

/** Decimals a number needs, at most 8. */
function decimalsOf(n: number): number {
  for (let d = 0; d < 8; d++) if (Math.abs(Number(n.toFixed(d)) - n) <= Math.abs(n) * 1e-12) return d;
  return 8;
}

/** A .dbf table of `columns` holding `rows`, in UTF-8. */
export function dbfTable(columns: readonly DbfColumn[], rows: readonly DbfValue[][]): Uint8Array {
  const names = dbfNames(columns.map((c) => c.name));
  const specs = columns.map((c, i) => {
    const values = rows.map((r) => r[i]).filter((v) => v !== null && v !== undefined);
    if (c.kind === "boolean") return { type: "L", length: 1, decimals: 0 };
    if (c.kind === "integer" || c.kind === "number") {
      const nums = values.map(Number).filter(Number.isFinite);
      const decimals = c.kind === "integer" ? 0 : Math.max(0, ...nums.map(decimalsOf));
      const length = Math.min(20, Math.max(1, ...nums.map((n) => n.toFixed(decimals).length)));
      return { type: "N", length: Math.max(length, decimals + 2), decimals };
    }
    return { type: "C", length: Math.min(254, Math.max(1, ...values.map((v) => utf8.encode(String(v)).length))), decimals: 0 };
  });
  const headerSize = 32 + 32 * columns.length + 1;
  const recordSize = 1 + specs.reduce((n, s) => n + s.length, 0);
  const out = new Uint8Array(headerSize + recordSize * rows.length + 1);
  const v = new DataView(out.buffer);
  const now = new Date();
  out[0] = 0x03;
  out.set([now.getFullYear() - 1900, now.getMonth() + 1, now.getDate()], 1);
  v.setUint32(4, rows.length, true);
  v.setUint16(8, headerSize, true);
  v.setUint16(10, recordSize, true);
  specs.forEach((s, i) => {
    const at = 32 + 32 * i;
    out.set(utf8.encode(names[i]), at);
    out[at + 11] = s.type.charCodeAt(0);
    out[at + 16] = s.length;
    out[at + 17] = s.decimals;
  });
  out[headerSize - 1] = 0x0d;
  rows.forEach((row, r) => {
    let at = headerSize + r * recordSize;
    out[at++] = 0x20;
    specs.forEach((s, i) => {
      const value = row[i];
      const cell = out.subarray(at, at + s.length);
      cell.fill(0x20);
      if (value !== null && value !== undefined) {
        if (s.type === "L") cell[0] = value ? 0x54 : 0x46;
        else if (s.type === "N") {
          const n = Number(value);
          const t = Number.isFinite(n) ? n.toFixed(s.decimals) : "";
          if (t.length <= s.length) cell.set(utf8.encode(t), s.length - t.length);
        } else cell.set(bytesUpTo(String(value), s.length));
      }
      at += s.length;
    });
  });
  out[out.length - 1] = 0x1a;
  return out;
}

/** The shape type a set of features is written as. */
function shapeType(kind: ShapeGeometry["kind"], features: readonly (ShapeGeometry | null)[]): number {
  if (kind === "line") return 3;
  if (kind === "polygon") return 5;
  return features.every((f) => !f || (f.kind === "point" && f.points.length === 1)) ? 1 : 8;
}

/**
 * The .shp and .shx of features of one kind (null features written as null shapes), and the
 * .dbf of their rows.
 */
export function shapefileSet(kind: ShapeGeometry["kind"], features: readonly (ShapeGeometry | null)[], columns: readonly DbfColumn[], rows: readonly DbfValue[][]): ShapefileSet {
  const type = shapeType(kind, features);
  const contents: Uint8Array[] = features.map((f) => {
    if (!f) return new Uint8Array(4);
    if (type === 1) {
      const c = new Uint8Array(20);
      const v = new DataView(c.buffer);
      v.setInt32(0, 1, true);
      v.setFloat64(4, (f as { points: Pt[] }).points[0].x, true);
      v.setFloat64(12, (f as { points: Pt[] }).points[0].y, true);
      return c;
    }
    const parts = partsOf(f).filter((p) => p.length > 0);
    const pts = parts.flat();
    const box = boxOf(pts);
    const multipoint = type === 8;
    const c = new Uint8Array(multipoint ? 40 + pts.length * 16 : 44 + parts.length * 4 + pts.length * 16);
    const v = new DataView(c.buffer);
    v.setInt32(0, type, true);
    [box.x0, box.y0, box.x1, box.y1].forEach((n, i) => v.setFloat64(4 + i * 8, n, true));
    let at: number;
    if (multipoint) {
      v.setInt32(36, pts.length, true);
      at = 40;
    } else {
      v.setInt32(36, parts.length, true);
      v.setInt32(40, pts.length, true);
      let start = 0;
      parts.forEach((p, i) => {
        v.setInt32(44 + i * 4, start, true);
        start += p.length;
      });
      at = 44 + parts.length * 4;
    }
    for (const p of pts) {
      v.setFloat64(at, p.x, true);
      v.setFloat64(at + 8, p.y, true);
      at += 16;
    }
    return c;
  });
  const all = features.flatMap((f) => (f ? partsOf(f).flat() : []));
  const box = all.length ? boxOf(all) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const header = (length: number): Uint8Array => {
    const h = new Uint8Array(100);
    const v = new DataView(h.buffer);
    v.setInt32(0, 9994, false);
    v.setInt32(24, length / 2, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, type, true);
    [box.x0, box.y0, box.x1, box.y1].forEach((n, i) => v.setFloat64(36 + i * 8, n, true));
    return h;
  };
  const shpLength = 100 + contents.reduce((n, c) => n + 8 + c.length, 0);
  const shp = new Uint8Array(shpLength);
  const shx = new Uint8Array(100 + 8 * contents.length);
  shp.set(header(shpLength));
  shx.set(header(shx.length));
  const sv = new DataView(shp.buffer);
  const xv = new DataView(shx.buffer);
  let at = 100;
  contents.forEach((c, i) => {
    sv.setInt32(at, i + 1, false);
    sv.setInt32(at + 4, c.length / 2, false);
    shp.set(c, at + 8);
    xv.setInt32(100 + i * 8, at / 2, false);
    xv.setInt32(104 + i * 8, c.length / 2, false);
    at += 8 + c.length;
  });
  return { shp, shx, dbf: dbfTable(columns, rows), cpg: utf8.encode("UTF-8") };
}

function boxOf(pts: readonly Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}
