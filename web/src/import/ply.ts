// PLY, the polygon file format Blender, MeshLab, CloudCompare and 3D scanners write, the reading side
// (no DOM). parsePly reads an ASCII or binary (little or big endian) version 1.0 file into parts, each
// a run of x, y, z triples in the file's own units and axes. Where its vertices carry red, green and
// blue, the faces are split into parts by their first corner's colour (at most 16, each coloured with
// the mean of its faces). Normals, texture coordinates and other properties, and other elements, are
// left out, and other elements are counted; a file of vertices and no faces (a point cloud) imports
// nothing and is counted as points. PLY keeps no units or up axis, so the file has no frame. It reads
// what export/ply.ts writes.

import { MAX_FACES, tooMany } from "./mesh.ts";
import type { MeshFile, MeshPart } from "./mesh.ts";

/** Most parts a file's faces are split into by colour; the faces of the rest join the nearest part. */
const MAX_COLOUR_PARTS = 16;
/** Steps per colour channel when grouping faces by colour: 4 × 4 × 4 cells. */
const COLOUR_STEPS = 4;
/** How much of the file is searched for the end of its header. */
const HEADER_LIMIT = 1 << 20;
/** A vertex property's slot: x, y, z, then red, green and blue (r, g and b too). */
const SLOT = new Map<string, number>([
  ["x", 0],
  ["y", 1],
  ["z", 2],
  ["red", 3],
  ["r", 3],
  ["green", 4],
  ["g", 4],
  ["blue", 5],
  ["b", 5],
]);
/** The names a face element's index list may have. */
const INDEX_LISTS = new Set(["vertex_indices", "vertex_index"]);

/** A PLY scalar: its size in bytes, whether it is a float (colours then run 0..1, not 0..255) and how a binary body holds it. */
interface Scalar {
  size: number;
  float: boolean;
  get: (dv: DataView, at: number, little: boolean) => number;
}

const INT8: Scalar = { size: 1, float: false, get: (dv, at) => dv.getInt8(at) };
const UINT8: Scalar = { size: 1, float: false, get: (dv, at) => dv.getUint8(at) };
const INT16: Scalar = { size: 2, float: false, get: (dv, at, little) => dv.getInt16(at, little) };
const UINT16: Scalar = { size: 2, float: false, get: (dv, at, little) => dv.getUint16(at, little) };
const INT32: Scalar = { size: 4, float: false, get: (dv, at, little) => dv.getInt32(at, little) };
const UINT32: Scalar = { size: 4, float: false, get: (dv, at, little) => dv.getUint32(at, little) };
const FLOAT32: Scalar = { size: 4, float: true, get: (dv, at, little) => dv.getFloat32(at, little) };
const FLOAT64: Scalar = { size: 8, float: true, get: (dv, at, little) => dv.getFloat64(at, little) };

/** PLY's type names, with their aliases. */
const TYPES = new Map<string, Scalar>([
  ["char", INT8],
  ["int8", INT8],
  ["uchar", UINT8],
  ["uint8", UINT8],
  ["short", INT16],
  ["int16", INT16],
  ["ushort", UINT16],
  ["uint16", UINT16],
  ["int", INT32],
  ["int32", INT32],
  ["uint", UINT32],
  ["uint32", UINT32],
  ["float", FLOAT32],
  ["float32", FLOAT32],
  ["double", FLOAT64],
  ["float64", FLOAT64],
]);

/** A property: a scalar, or a list (its `count` type says how many items, `type` what each is). */
interface Prop {
  name: string;
  type: Scalar;
  count?: Scalar;
}

interface Element {
  name: string;
  count: number;
  props: Prop[];
}

interface Header {
  /** "ascii", or "little" or "big" for binary */
  format: "ascii" | "little" | "big";
  elements: Element[];
  /** where the body starts, in bytes */
  body: number;
}

/** The values of the body, read in turn: each one's type decides how many bytes it takes. */
interface Values {
  next(t: Scalar): number;
}

/** The vertex positions (x, y, z per vertex; empty unless kept) and, where the vertices are coloured, their 0..1 red, green and blue. */
interface Positions {
  count: number;
  xyz: Float64Array;
  rgb: Float64Array | null;
}


function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** The header: the format and the elements with their properties; comment and obj_info lines are ignored. Throws when it is not a PLY file it can read. */
function readHeader(bytes: Uint8Array): Header {
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, HEADER_LIMIT)));
  if (!/^ply\r?\n/.test(text)) throw new Error("it isn't a PLY file");
  const end = /^end_header[ \t\r]*\n/m.exec(text);
  if (!end) throw new Error("it has no end_header line");
  let format: Header["format"] | undefined;
  const elements: Element[] = [];
  for (const line of text.slice(0, end.index).split(/\r?\n/).slice(1)) {
    const w = line.trim().split(/\s+/);
    if (w[0] === "format") {
      if (Number(w[2]) !== 1) throw new Error(`it is PLY version ${w[2] ?? ""}; only 1.0 is read`);
      format = w[1] === "ascii" ? "ascii" : w[1] === "binary_little_endian" ? "little" : w[1] === "binary_big_endian" ? "big" : undefined;
      if (!format) throw new Error(`it has an unknown format, "${w[1] ?? ""}"`);
    } else if (w[0] === "element") {
      const count = Number(w[2]);
      if (!w[1] || !Number.isInteger(count) || count < 0) throw new Error(`it has a bad element line, "${line.trim()}"`);
      elements.push({ name: w[1], count, props: [] });
    } else if (w[0] === "property") {
      const el = elements[elements.length - 1];
      if (!el) throw new Error("it has a property before any element");
      if (w[1] === "list") {
        const count = TYPES.get(w[2] ?? "");
        const type = TYPES.get(w[3] ?? "");
        if (!count || !type || !w[4]) throw new Error(`it has an unknown list property, "${line.trim()}"`);
        el.props.push({ name: w[4], type, count });
      } else {
        const type = TYPES.get(w[1] ?? "");
        if (!type || !w[2]) throw new Error(`it has an unknown property, "${line.trim()}"`);
        el.props.push({ name: w[2], type });
      }
    }
  }
  if (!format) throw new Error("it has no format line");
  return { format, elements, body: end.index + end[0].length };
}

/** A binary body from byte `start`, read with the given byte order. */
function binaryValues(bytes: Uint8Array, start: number, little: boolean): Values {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  return {
    next(t) {
      if (at + t.size > bytes.length) throw new Error("it ends before all its values");
      const v = t.get(dv, at, little);
      at += t.size;
      return v;
    },
  };
}

/** An ASCII body: numbers separated by any white space, read in turn. */
function asciiValues(text: string): Values {
  const token = /\S+/g;
  return {
    next() {
      const m = token.exec(text);
      if (!m) throw new Error("it ends before all its values");
      const v = Number(m[0]);
      if (Number.isNaN(v)) throw new Error(`it has a value that isn't a number, "${m[0]}"`);
      return v;
    },
  };
}

/** A list's length, read from its count type: a whole number, not negative. */
function listLength(values: Values, count: Scalar): number {
  const n = values.next(count);
  if (!Number.isInteger(n) || n < 0) throw new Error("it has a list with a bad length");
  return n;
}

/** Reads past one property of an item: a scalar, or a list and its items. */
function skipProp(prop: Prop, values: Values): void {
  if (!prop.count) {
    values.next(prop.type);
    return;
  }
  const n = listLength(values, prop.count);
  for (let k = 0; k < n; k++) values.next(prop.type);
}

/** The vertex element: positions are kept only when `keep` (a point cloud keeps none); colours only when it has red, green and blue. */
function readVertices(el: Element, values: Values, keep: boolean): Positions {
  const slot = el.props.map((p) => (p.count ? -1 : (SLOT.get(p.name) ?? -1)));
  for (const s of [0, 1, 2]) if (!slot.includes(s)) throw new Error("it has no x, y and z vertex positions");
  const coloured = keep && [3, 4, 5].every((s) => slot.includes(s));
  const xyz = new Float64Array(keep ? 3 * el.count : 0);
  const rgb = coloured ? new Float64Array(3 * el.count) : null;
  for (let i = 0; i < el.count; i++) {
    for (let p = 0; p < el.props.length; p++) {
      const prop = el.props[p];
      const s = slot[p];
      if (prop.count || s < 0) {
        skipProp(prop, values);
        continue;
      }
      const v = values.next(prop.type);
      if (s < 3) {
        if (keep) xyz[3 * i + s] = v;
      } else if (rgb) rgb[3 * i + s - 3] = clamp01(prop.type.float ? v : v / 255);
    }
  }
  return { count: el.count, xyz, rgb };
}

/** The face element: each face's index list goes to `polys` as read (checked later); the other properties are read past. */
function readFaces(el: Element, values: Values, index: number, polys: number[][]): void {
  for (let i = 0; i < el.count; i++) {
    for (let p = 0; p < el.props.length; p++) {
      const prop = el.props[p];
      if (p !== index || !prop.count) {
        skipProp(prop, values);
        continue;
      }
      const n = listLength(values, prop.count);
      const corners: number[] = [];
      for (let k = 0; k < n; k++) corners.push(values.next(prop.type));
      if (polys.length >= MAX_FACES) throw tooMany();
      polys.push(corners);
    }
  }
}

/** The position of a face element's vertex index list among its properties, or -1 when it has none. */
function indexOf(el: Element): number {
  return el.props.findIndex((p) => p.count !== undefined && INDEX_LISTS.has(p.name));
}

/** A face's corners as x, y, z triples, from its vertex indices. */
function corners(f: number[], xyz: Float64Array): number[] {
  return f.flatMap((v) => [xyz[3 * v], xyz[3 * v + 1], xyz[3 * v + 2]]);
}

function dist2(a: number[], b: number[]): number {
  return a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0);
}

/**
 * The faces in parts by their first corner's colour. Each colour falls in a cell of a 4 × 4 × 4 grid;
 * the 16 fullest cells are parts, and the faces of any other cell join the part whose mean colour is
 * nearest. Each part takes the mean colour of its faces. Parts are numbered in the order their first
 * faces come, "name 1", "name 2"…; one part keeps `name` alone.
 */
function byColour(name: string, faces: number[][], xyz: Float64Array, rgb: Float64Array): MeshPart[] {
  const colours = faces.map((f) => [rgb[3 * f[0]], rgb[3 * f[0] + 1], rgb[3 * f[0] + 2]]);
  const cellOf = colours.map((c) => c.reduce((key, v) => key * COLOUR_STEPS + Math.min(COLOUR_STEPS - 1, Math.floor(v * COLOUR_STEPS)), 0));
  const cells = new Map<number, { n: number; sum: number[] }>();
  for (let i = 0; i < faces.length; i++) {
    const cell = cells.get(cellOf[i]) ?? { n: 0, sum: [0, 0, 0] };
    cells.set(cellOf[i], cell);
    cell.n++;
    for (let k = 0; k < 3; k++) cell.sum[k] += colours[i][k];
  }
  const mean = (c: { n: number; sum: number[] }): number[] => c.sum.map((s) => s / c.n);
  const ranked = [...cells].sort((a, b) => b[1].n - a[1].n || a[0] - b[0]);
  const kept = ranked.slice(0, MAX_COLOUR_PARTS).map(([key, c]) => ({ key, mean: mean(c) }));
  const partOf = new Map<number, number>();
  kept.forEach((k, i) => partOf.set(k.key, i));
  for (const [key, c] of ranked.slice(MAX_COLOUR_PARTS)) {
    const m = mean(c);
    let best = 0;
    for (let i = 1; i < kept.length; i++) if (dist2(kept[i].mean, m) < dist2(kept[best].mean, m)) best = i;
    partOf.set(key, best);
  }
  // numbered in the order their first faces come
  const order = new Map<number, number>();
  const groups: { faces: number[][]; sum: number[] }[] = [];
  for (let i = 0; i < faces.length; i++) {
    const p = partOf.get(cellOf[i])!;
    let id = order.get(p);
    if (id === undefined) {
      id = groups.length;
      order.set(p, id);
      groups.push({ faces: [], sum: [0, 0, 0] });
    }
    const g = groups[id];
    g.faces.push(corners(faces[i], xyz));
    for (let k = 0; k < 3; k++) g.sum[k] += colours[i][k];
  }
  const named = groups.length > 1;
  return groups.map((g, i) => {
    const n = g.faces.length;
    return { name: named ? `${name} ${i + 1}` : name, faces: g.faces, color: { r: g.sum[0] / n, g: g.sum[1] / n, b: g.sum[2] / n } };
  });
}

/**
 * A PLY file's faces: one part named `name`, or, where its vertices carry colours, parts by colour (see
 * byColour). Faces with fewer than three corners, a corner that is not a vertex, or a repeated corner
 * are left out as "bad face". Throws when the file is not one it can read.
 */
export function parsePly(bytes: Uint8Array, name: string): MeshFile {
  const { format, elements, body } = readHeader(bytes);
  const values =
    format === "ascii" ? asciiValues(new TextDecoder().decode(bytes.subarray(body))) : binaryValues(bytes, body, format === "little");
  const vertexEl = elements.find((e) => e.name === "vertex");
  // the first face element with an index list, and where that list is among its properties
  const faceEl = elements.find((e) => indexOf(e) >= 0);
  // a file with no faces (a point cloud) has its points read but not kept
  const keep = !!faceEl && faceEl.count > 0;
  const skipped: Record<string, number> = {};
  const polys: number[][] = [];
  let vertices: Positions | null = null;
  for (const el of elements) {
    if (el === vertexEl) vertices = readVertices(el, values, keep);
    else if (el === faceEl) readFaces(el, values, indexOf(el), polys);
    else {
      for (let i = 0; i < el.count; i++) for (const prop of el.props) skipProp(prop, values);
      if (el.count) skipped[el.name] = el.count;
    }
  }
  if (!vertices) throw new Error("it has no vertices");
  const { count: nv, xyz, rgb } = vertices;
  const usable = (v: number): boolean =>
    Number.isInteger(v) && v >= 0 && v < nv && Number.isFinite(xyz[3 * v]) && Number.isFinite(xyz[3 * v + 1]) && Number.isFinite(xyz[3 * v + 2]);
  const faces: number[][] = [];
  let bad = 0;
  for (const f of polys) {
    if (f.length >= 3 && new Set(f).size === f.length && f.every(usable)) faces.push(f);
    else bad++;
  }
  if (bad) skipped["bad face"] = bad;
  if (!faceEl?.count && nv) skipped.point = nv;
  const parts: MeshPart[] = rgb
    ? byColour(name, faces, xyz, rgb)
    : faces.length
      ? [{ name, faces: faces.map((f) => corners(f, xyz)) }]
      : [];
  return { parts, skipped };
}
