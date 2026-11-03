// FBX import, the reading side (no DOM). FBX is Autodesk's exchange format, which Blender, 3ds Max,
// Maya, Revit, SketchUp, Unity and Unreal all speak: a tree of named records with typed properties,
// written in binary (from "Kaydara FBX Binary") or as ASCII (from "; FBX"). parseFbx reads each Mesh
// geometry's polygons, placed by the world transform of the model it hangs from (the whole FBX chain:
// translation, rotation with its offsets and pivots, pre and post rotation, scaling, and the model's
// geometric offsets), one part per material, coloured by its diffuse colour. Polygons stay whole, not
// triangulated. `frame` gives the millimetres per unit and whether y or z is up, with the axes made
// right-handed: a file that declares a left-handed frame has its coordinates mirrored and its faces
// turned round. Left out and counted: NURBS and patch surfaces ("curve or surface") and line geometry
// ("line"). Cameras, lights, textures, UVs, normals, edges, deformers and animation are ignored, and
// every model inherits its parent's whole transform (the mode Blender and Maya write). Models that
// share geometry (Blender's linked duplicates, the instances export/fbx.ts writes) come back as a
// tree: the topmost model of each repeat (the same geometries and materials, with the same models
// under it the same way) is an instance of one symbol, z up, of what it and the models under it
// hold, models in it that repeat more often than it does placing symbols of their own. It reads what
// export/fbx.ts writes.

import { MAX_FACES, placementOf, tooMany, treeTop, type MeshFile, type MeshPart, type MeshTree, type MeshTreeInstance, type MeshTreeNode } from "./mesh.ts";
import { inflate } from "../export/flate.ts";

/**
 * A property's value: a number (Y, Z, C, I, F, D, a small ASCII number), a bigint (L, or a large ASCII
 * integer), text (S, or a bare ASCII word), raw bytes (R), or an array: f, d and i as Float64Array,
 * l as BigInt64Array, b and c as bytes.
 */
type Value = number | bigint | string | Uint8Array | Float64Array | BigInt64Array;

/** A record of the file: its name, its properties and the records inside it. */
interface Node {
  /** the record's name, such as "Model" or "P" */
  name: string;
  /** its properties, in order */
  props: Value[];
  /** the records inside it, in order */
  children: Node[];
}

/** x, y, z */
type V3 = [number, number, number];
/** a 4 × 4 matrix, row by row, applied to column vectors */
type M4 = number[];

/** the first 20 bytes of a binary file: "Kaydara FBX Binary" and two spaces */
const BINARY_START = "Kaydara FBX Binary  ";
/** a binary file's header: its 23-byte magic and its u32 version */
const HEADER = 27;
/** the deepest chain of models followed when working out where one sits */
const MAX_DEPTH = 64;
/** the bytes each element of an array type takes */
const ELEMENT_BYTES: Readonly<Record<string, number>> = { f: 4, d: 8, l: 8, i: 4, b: 1, c: 1 };
/** the rotation orders FBX numbers 0 to 5 (6, spherical, is read as XYZ) */
const ORDERS = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const UTF8 = new TextDecoder();
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
/** the characters that end a bare word in ASCII FBX */
const DELIMITERS = new Set([" ", "\t", "\r", "\n", "{", "}", ":", ",", "*", '"', ";"]);


/** Reads an FBX file, binary or ASCII, into its meshes, with the units and up axis it declares in `frame`. */
export function parseFbx(bytes: Uint8Array): MeshFile {
  if (BINARY_START.split("").every((c, i) => bytes[i] === c.charCodeAt(0))) return meshesOf(readBinary(bytes));
  const head = new TextDecoder().decode(bytes.subarray(0, 512));
  if (/^\s*;[^\n]*FBX/.test(head)) return meshesOf(parseAscii(new TextDecoder().decode(bytes)));
  throw new Error("it isn't a binary or ASCII FBX file");
}

// ---- binary -------------------------------------------------------------------------------

/** The top-level records of a binary file: 32-bit offsets before version 7500, 64-bit from it. */
function readBinary(b: Uint8Array): Node[] {
  const need = (at: number, n: number): void => {
    if (at < 0 || at + n > b.length) throw new Error("it ends early");
  };
  need(0, HEADER);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const wide = dv.getUint32(23, true) >= 7500;
  // a record's end offset, property count and property list length, each a word (4 or 8 bytes), then its name's length (a byte) and name
  const word = wide ? 8 : 4;
  const meta = 3 * word;
  /** the i-th word of a record's header: its end offset (0), property count (1) or property list length (2) */
  const field = (at: number, i: number): number => (wide ? Number(dv.getBigUint64(at + i * word, true)) : dv.getUint32(at + i * word, true));

  /** One property at `at`: its value and where the next one starts. */
  const prop = (at: number): [Value, number] => {
    need(at, 1);
    const code = String.fromCharCode(b[at]);
    const p = at + 1;
    switch (code) {
      case "Z":
        need(p, 1);
        return [dv.getInt8(p), p + 1];
      case "Y":
        need(p, 2);
        return [dv.getInt16(p, true), p + 2];
      case "C":
      case "B":
        need(p, 1);
        return [b[p] ? 1 : 0, p + 1];
      case "I":
        need(p, 4);
        return [dv.getInt32(p, true), p + 4];
      case "F":
        need(p, 4);
        return [dv.getFloat32(p, true), p + 4];
      case "D":
        need(p, 8);
        return [dv.getFloat64(p, true), p + 8];
      case "L":
        need(p, 8);
        return [dv.getBigInt64(p, true), p + 8];
      case "S":
      case "R": {
        need(p, 4);
        const n = dv.getUint32(p, true);
        need(p + 4, n);
        const bytes = b.subarray(p + 4, p + 4 + n);
        return [code === "S" ? UTF8.decode(bytes) : bytes.slice(), p + 4 + n];
      }
      case "f":
      case "d":
      case "l":
      case "i":
      case "b":
      case "c": {
        need(p, 12);
        const count = dv.getUint32(p, true);
        const encoding = dv.getUint32(p + 4, true);
        const len = dv.getUint32(p + 8, true);
        need(p + 12, len);
        let raw = b.subarray(p + 12, p + 12 + len);
        if (encoding === 1) raw = inflate(raw);
        else if (encoding !== 0) throw new Error("an array is in an unknown encoding");
        if (raw.length < count * ELEMENT_BYTES[code]) throw new Error("an array is cut short");
        return [arrayOf(raw, code, count), p + 12 + len];
      }
      default:
        throw new Error(`it has a property of an unknown type ("${code}")`);
    }
  };

  /** The record at `at` and where it ends; a null record (no end offset) gives no node. */
  const record = (at: number, limit: number): { node: Node | null; next: number } => {
    need(at, meta + 1);
    const end = field(at, 0);
    if (end === 0) return { node: null, next: at + meta + 1 };
    if (end > limit || end < at + meta + 1) throw new Error("a record runs past the one that holds it");
    const count = field(at, 1);
    const propsLength = field(at, 2);
    const nameLength = b[at + meta];
    need(at + meta + 1, nameLength);
    const name = UTF8.decode(b.subarray(at + meta + 1, at + meta + 1 + nameLength));
    const propsStart = at + meta + 1 + nameLength;
    let p = propsStart;
    const props: Value[] = [];
    for (let k = 0; k < count; k++) {
      const [v, next] = prop(p);
      props.push(v);
      p = next;
    }
    if (p - propsStart !== propsLength) throw new Error("a record's properties are not the length it says");
    // the records inside, which end at a null record (or where this one ends)
    const children: Node[] = [];
    while (p < end) {
      const r = record(p, end);
      if (!r.node) break;
      children.push(r.node);
      p = r.next;
    }
    return { node: { name, props, children }, next: end };
  };

  // the top level ends at a null record, which comes before the footer; without one the file is cut short
  const top: Node[] = [];
  for (let at = HEADER; ; ) {
    need(at, meta + 1);
    if (field(at, 0) > b.length) throw new Error("it ends early");
    const r = record(at, b.length);
    if (!r.node) break;
    top.push(r.node);
    at = r.next;
  }
  if (!top.length) throw new Error("it has no records");
  return top;
}

/** The values of a binary array: numbers for f, d and i, longs for l, bytes for b and c. */
function arrayOf(raw: Uint8Array, code: string, count: number): Value {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (code === "b" || code === "c") return raw.slice(0, count);
  if (code === "l") {
    const out = new BigInt64Array(count);
    for (let k = 0; k < count; k++) out[k] = dv.getBigInt64(8 * k, true);
    return out;
  }
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    out[k] = code === "f" ? dv.getFloat32(4 * k, true) : code === "d" ? dv.getFloat64(8 * k, true) : dv.getInt32(4 * k, true);
  }
  return out;
}

// ---- ASCII --------------------------------------------------------------------------------

/** A token of ASCII FBX: a punctuation mark ("{", "}", ":", ",", "*"), a quoted string "s", a number "n" or a bare word "w". */
interface Token {
  /** "{", "}", ":", ",", "*", "s" (a quoted string), "n" (a number) or "w" (a bare word) */
  kind: string;
  /** the text, or the number it reads as */
  value: Value;
}

/** A number as a JS number, or a bigint when it is a whole number too big for one. */
function numberOf(word: string): number | bigint {
  const n = Number(word);
  return /[.eE]/.test(word) || Number.isSafeInteger(n) ? n : BigInt(word);
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") i++;
    else if (c === ";") {
      // a comment runs to the end of its line
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "{" || c === "}" || c === ":" || c === "," || c === "*") {
      out.push({ kind: c, value: c });
      i++;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new Error("a quoted string is not closed");
      out.push({ kind: "s", value: text.slice(i + 1, end) });
      i = end + 1;
    } else {
      let end = i;
      while (end < text.length && !DELIMITERS.has(text[end])) end++;
      const word = text.slice(i, end);
      i = end;
      out.push(NUMBER.test(word) ? { kind: "n", value: numberOf(word) } : { kind: "w", value: word });
    }
  }
  return out;
}

/** ASCII FBX text as records: `Name: values { ... }`, with `a:` lines making the array a record holds. */
function parseAscii(text: string): Node[] {
  const toks = tokenize(text);
  let at = 0;
  const records = (): Node[] => {
    const out: Node[] = [];
    while (at < toks.length && toks[at].kind !== "}") out.push(record());
    return out;
  };
  const record = (): Node => {
    if (at >= toks.length || toks[at].kind !== "w" || toks[at + 1]?.kind !== ":") throw new Error("a line is neither a property nor a block");
    const name = String(toks[at].value);
    at += 2;
    const props: Value[] = [];
    let children: Node[] = [];
    while (at < toks.length) {
      const t = toks[at];
      if (t.kind === "{") {
        at++;
        children = records();
        if (toks[at]?.kind !== "}") throw new Error("a block is not closed");
        at++;
        break;
      }
      if (t.kind === "}" || (t.kind === "w" && toks[at + 1]?.kind === ":")) break;
      // an array's count (`*24`) is skipped; commas separate values and are dropped
      if (t.kind === "*") {
        at++;
        if (toks[at]?.kind === "n") at++;
        continue;
      }
      if (t.kind === "s" || t.kind === "n" || t.kind === "w") props.push(t.value);
      at++;
    }
    // the values of `a:` lines inside a block are the array of the record that holds them
    const arrays = children.filter((c) => c.name === "a");
    if (arrays.length) {
      props.push(Float64Array.from(arrays.flatMap((c) => c.props), Number));
      children = children.filter((c) => c.name !== "a");
    }
    return { name, props, children };
  };
  const top = records();
  if (at < toks.length) throw new Error("a block is closed that was never opened");
  return top;
}

// ---- the scene ----------------------------------------------------------------------------

/** The first record of a list with this name. */
function pick(list: readonly Node[], name: string): Node | undefined {
  return list.find((n) => n.name === name);
}

/** A record's id (its first property) as text, for matching connections. */
function idOf(n: Node): string {
  return String(n.props[0]);
}

/** A model's or material's name without its class: "Name\0\1Model" and "Model::Name" both give "Name". */
function nameOf(n: Node): string {
  const raw = typeof n.props[1] === "string" ? n.props[1] : "";
  const nul = raw.indexOf("\0");
  if (nul >= 0) return raw.slice(0, nul).trim() || "Object";
  const sep = raw.indexOf("::");
  return (sep >= 0 ? raw.slice(sep + 2) : raw).trim() || "Object";
}

function toNumber(v: Value | undefined): number | undefined {
  return typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : undefined;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A record's Properties70 entries: each P's name to its values (those after its type, label and flags). */
function props70(n: Node | undefined): Map<string, Value[]> {
  const out = new Map<string, Value[]>();
  for (const p of pick(n?.children ?? [], "Properties70")?.children ?? []) {
    if (p.name === "P" && typeof p.props[0] === "string") out.set(p.props[0], p.props.slice(4));
  }
  return out;
}

function scalar(p: Map<string, Value[]>, name: string, fallback: number): number {
  return toNumber(p.get(name)?.[0]) ?? fallback;
}

function integer(p: Map<string, Value[]>, name: string, fallback: number): number {
  return Math.round(scalar(p, name, fallback));
}

function vec(p: Map<string, Value[]>, name: string, fallback: V3): V3 {
  const v = p.get(name);
  if (!v || v.length < 3) return fallback;
  return [toNumber(v[0]) ?? fallback[0], toNumber(v[1]) ?? fallback[1], toNumber(v[2]) ?? fallback[2]];
}

/** A child list of a record as numbers, for Vertices, PolygonVertexIndex and the like. */
function listOf(n: Node | undefined, name: string): Float64Array | undefined {
  const v = pick(n?.children ?? [], name)?.props[0];
  if (v instanceof Float64Array) return v;
  if (v instanceof BigInt64Array) return Float64Array.from(v, Number);
  return undefined;
}

/** A signed axis as a unit vector in the file's own numbers: axis 0 is x, 1 y, 2 z. */
function axisVector(axis: number, sign: number): V3 {
  const v: V3 = [0, 0, 0];
  v[axis] = sign < 0 ? -1 : 1;
  return v;
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function neg(a: V3): V3 {
  return [-a[0], -a[1], -a[2]];
}

/** a · b, both 4 × 4 row by row */
function mul4(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[4 * r + k] * b[4 * k + c];
      out[4 * r + c] = v;
    }
  }
  return out;
}

/** The product of several matrices, left to right. */
function chain(...ms: M4[]): M4 {
  return ms.reduce((acc, m) => mul4(acc, m), I4);
}

/** The determinant of a matrix's 3 × 3 part. */
function det3(m: M4): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/**
 * The three rows applied to a world matrix, as a 3 × 4 affine map flattened row by row: row r is the
 * r-th output coordinate, a sum over the matrix's rows weighted by `rows[r]`.
 */
function applyRows(rows: readonly V3[], w: M4): number[] {
  const out: number[] = [];
  for (const q of rows) for (let c = 0; c < 4; c++) out.push(q[0] * w[c] + q[1] * w[4 + c] + q[2] * w[8 + c]);
  return out;
}

function translate(v: V3): M4 {
  return [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1];
}

function scaleOf(v: V3): M4 {
  return [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1];
}

/** A rotation about one axis by an angle in radians (right-handed). */
function rotAxis(axis: string, a: number): M4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === "X") return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === "Y") return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Euler angles in degrees, applied in the order's letters: "XYZ" is Rz · Ry · Rx, so x turns first. */
function euler(deg: V3, order: string): M4 {
  let m = I4;
  for (const axis of order) {
    const i = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
    m = mul4(rotAxis(axis, (deg[i] * Math.PI) / 180), m);
  }
  return m;
}

/** The rotation part of a rotation matrix, transposed: its inverse. */
function transpose3(m: M4): M4 {
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
}

/**
 * A model's own transform, as FBX composes it: T · Roff · Rp · Rpre · R · Rpost⁻¹ · Rp⁻¹ · Soff · Sp · S · Sp⁻¹,
 * where R is the rotation in its RotationOrder and the pre and post rotations are XYZ. As Blender's importer
 * does, the RotationOrder counts only when RotationActive is set; otherwise the rotation is XYZ.
 */
function localOf(m: Node): M4 {
  const p = props70(m);
  const zero: V3 = [0, 0, 0];
  const rp = vec(p, "RotationPivot", zero);
  const sp = vec(p, "ScalingPivot", zero);
  const active = integer(p, "RotationActive", 0) !== 0;
  const order = (active && ORDERS[integer(p, "RotationOrder", 0)]) || "XYZ";
  return chain(
    translate(vec(p, "Lcl Translation", zero)),
    translate(vec(p, "RotationOffset", zero)),
    translate(rp),
    euler(vec(p, "PreRotation", zero), "XYZ"),
    euler(vec(p, "Lcl Rotation", zero), order),
    transpose3(euler(vec(p, "PostRotation", zero), "XYZ")),
    translate(neg(rp)),
    translate(vec(p, "ScalingOffset", zero)),
    translate(sp),
    scaleOf(vec(p, "Lcl Scaling", [1, 1, 1])),
    translate(neg(sp)),
  );
}

/** A model's geometric transform, which places its geometry in the model: T · R · S, applied to the mesh only. */
function geometricOf(m: Node): M4 {
  const p = props70(m);
  const zero: V3 = [0, 0, 0];
  return chain(translate(vec(p, "GeometricTranslation", zero)), euler(vec(p, "GeometricRotation", zero), "XYZ"), scaleOf(vec(p, "GeometricScaling", [1, 1, 1])));
}

/** A part's colour from its material's diffuse colour (or the older "Diffuse"), 0..1 channels. */
function colourOf(material: Node | undefined): { r: number; g: number; b: number } | undefined {
  const p = props70(material);
  const v = p.get("DiffuseColor") ?? p.get("Diffuse");
  if (!v || v.length < 3) return undefined;
  const [r, g, b] = [toNumber(v[0]), toNumber(v[1]), toNumber(v[2])];
  if (r === undefined || g === undefined || b === undefined) return undefined;
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/** The meshes of the objects, placed and split by material. */
function meshesOf(top: Node[]): MeshFile {
  const objects = pick(top, "Objects")?.children ?? [];
  const byId = new Map<string, Node>();
  for (const o of objects) if (o.props.length) byId.set(idOf(o), o);

  // who hangs from whom, and each model's geometry and materials, in the order the connections give
  const parents = new Map<string, string>();
  const geometry = new Map<string, string[]>();
  const materials = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const c of pick(top, "Connections")?.children ?? []) {
    if (c.name !== "C" || c.props[0] !== "OO" || c.props.length < 3) continue;
    const child = String(c.props[1]);
    const parent = String(c.props[2]);
    const kind = byId.get(child)?.name;
    if (kind === "Geometry") add(geometry, parent, child);
    else if (kind === "Material") add(materials, parent, child);
    else if (kind === "Model" && byId.get(parent)?.name === "Model" && !parents.has(child)) parents.set(child, parent);
  }

  // the axes: FBX's up, front and coordinate axes with their signs, as vectors in the file's numbers
  const settings = props70(pick(top, "GlobalSettings"));
  const axes = [integer(settings, "UpAxis", 1), integer(settings, "FrontAxis", 2), integer(settings, "CoordAxis", 0)];
  const usable = axes.every((a) => a >= 0 && a <= 2) && new Set(axes).size === 3;
  const [up, front, coord] = usable ? axes : [1, 2, 0];
  const sign = (name: string): number => (usable ? scalar(settings, name, 1) : 1);
  const right = axisVector(coord, sign("CoordAxisSign"));
  const upV = axisVector(up, sign("UpAxisSign"));
  const fwd = axisVector(front, sign("FrontAxisSign"));
  // +1 when the frame is right-handed; -1 when the file declares it left-handed
  const handed = dot(right, cross(upV, fwd));
  const yUp = up !== 2;
  // the output's axes, as rows of the file's numbers: right, then up (y or z), then front, turned round
  // when the frame is left-handed; each row set has a determinant of +1, so it turns the numbers, never mirrors them
  const rows: V3[] = yUp ? [right, upV, handed > 0 ? fwd : neg(fwd)] : [right, handed > 0 ? neg(fwd) : fwd, upV];
  const unit = scalar(settings, "UnitScaleFactor", 1);
  const frame = { mm: unit > 0 && Number.isFinite(unit) ? unit * 10 : 10, yUp };

  /** Each model's world transform, its parents' first. */
  const worlds = new Map<string, M4>();
  const worldOf = (id: string, depth: number): M4 => {
    const known = worlds.get(id);
    if (known) return known;
    const parent = parents.get(id);
    const above = parent !== undefined && depth < MAX_DEPTH ? worldOf(parent, depth + 1) : I4;
    const m = byId.get(id);
    const w = m ? mul4(above, localOf(m)) : above;
    worlds.set(id, w);
    return w;
  };

  const parts: MeshPart[] = [];
  const skipped: Record<string, number> = {};
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };
  for (const g of objects) {
    if (g.name !== "Geometry") continue;
    const kind = String(g.props[2]);
    if (kind === "Line") skip("line");
    else if (kind === "NurbsCurve" || kind === "NurbsSurface" || kind === "Nurbs" || kind === "Patch") skip("curve or surface");
  }

  let faces = 0;
  // one model's geometry as parts in `out`, placed by `place` (the file's numbers in), its rows `turn`ing it out
  const readModel = (m: Node, place: M4, turn: readonly V3[], name: string, out: MeshPart[]): void => {
    const id = idOf(m);
    // a mirrored placement (negative scale) and a left-handed frame each turn the faces round; both together cancel
    const flip = det3(place) * handed < 0;
    const A = applyRows(turn, place);
    for (const gid of geometry.get(id) ?? []) {
      const g = byId.get(gid);
      if (!g || g.props[2] !== "Mesh") continue;
      const verts = listOf(g, "Vertices");
      const pvi = listOf(g, "PolygonVertexIndex");
      if (!verts || !pvi) continue;
      const n = Math.floor(verts.length / 3);
      const pos = new Float64Array(3 * n);
      for (let k = 0; k < n; k++) {
        const x = verts[3 * k];
        const y = verts[3 * k + 1];
        const z = verts[3 * k + 2];
        pos[3 * k] = A[0] * x + A[1] * y + A[2] * z + A[3];
        pos[3 * k + 1] = A[4] * x + A[5] * y + A[6] * z + A[7];
        pos[3 * k + 2] = A[8] * x + A[9] * y + A[10] * z + A[11];
      }
      // a polygon's material is an index into the model's materials: one for all, or one each
      const layer = pick(g.children, "LayerElementMaterial");
      const mapping = String(pick(layer?.children ?? [], "MappingInformationType")?.props[0] ?? "AllSame");
      const indexes = listOf(layer, "Materials");
      const mats = materials.get(id) ?? [];
      const byMaterial = new Map<number, MeshPart>();
      const emit = (idx: number[], poly: number): void => {
        if (idx.length < 3 || idx.some((c) => c >= n)) return skip("bad face");
        const key = !indexes || indexes.length === 0 ? -1 : Math.round(mapping === "AllSame" ? indexes[0] : (indexes[poly] ?? indexes[0]));
        let part = byMaterial.get(key);
        if (!part) {
          const colour = colourOf(byId.get(mats[key] ?? ""));
          part = { name, faces: [], ...(colour ? { color: colour } : {}) };
          byMaterial.set(key, part);
          out.push(part);
        }
        if (++faces > MAX_FACES) throw tooMany();
        const order = flip ? idx.slice().reverse() : idx;
        const face: number[] = [];
        for (const c of order) face.push(pos[3 * c], pos[3 * c + 1], pos[3 * c + 2]);
        part.faces.push(face);
      };
      // polygons end at a negative index, which holds the last corner's index as ~i
      let corners: number[] = [];
      let poly = 0;
      for (let k = 0; k < pvi.length; k++) {
        const v = pvi[k];
        if (v >= 0) {
          corners.push(v);
          continue;
        }
        corners.push(-v - 1);
        emit(corners, poly++);
        corners = [];
      }
      if (corners.length) skip("bad face");
    }
  };

  // the models under each model, and those under none, in the order the file gives them
  const models = objects.filter((o) => o.name === "Model");
  const under = new Map<string, Node[]>();
  for (const m of models) {
    const p = parents.get(idOf(m)) ?? "";
    const list = under.get(p);
    if (list) list.push(m);
    else under.set(p, [m]);
  }
  // what a model is, wherever it stands: its geometries, materials and geometric offset, and the models under it, each where it stands in it
  const sigs = new Map<string, string>();
  const sigOf = (m: Node, depth: number): string => {
    const id = idOf(m);
    let sig = sigs.get(id);
    if (sig === undefined) {
      const kids = depth < MAX_DEPTH ? (under.get(id) ?? []) : [];
      const meshes = (geometry.get(id) ?? []).filter((g) => byId.get(g)?.props[2] === "Mesh");
      const inner = kids.map((k) => `${key(localOf(k))}=${sigOf(k, depth + 1)}`);
      // one with no mesh in it or under it is nothing to repeat
      sig = meshes.length || inner.some((x) => !x.endsWith("=")) ? `${meshes.join(",")};${(materials.get(id) ?? []).join(",")};${key(geometricOf(m))};[${inner.join("|")}]` : "";
      sigs.set(id, sig);
    }
    return sig;
  };
  const repeats = new Map<string, number>();
  for (const m of models) {
    const sig = sigOf(m, 0);
    if (sig) repeats.set(sig, (repeats.get(sig) ?? 0) + 1);
  }
  const tree = [...repeats.values()].some((n) => n >= 2);

  if (!tree) {
    for (const m of models) readModel(m, mul4(worldOf(idOf(m), 0), geometricOf(m)), rows, nameOf(m), parts);
    return { parts, skipped, frame };
  }

  // a tree is z up: the rows that turn the file's numbers to x, y and z with z up
  const zRows: V3[] = yUp ? [rows[0], neg(rows[2]), rows[1]] : rows;
  const Z: M4 = [...zRows[0], 0, ...zRows[1], 0, ...zRows[2], 0, 0, 0, 0, 1];
  const Zt = transpose3(Z);
  const symbols: MeshTree["symbols"] = [];
  const made = new Map<string, number>();
  const instances: MeshTreeInstance[] = [];
  const repeated = (sig: string): boolean => sig !== "" && (repeats.get(sig) ?? 0) >= 2;
  // the first geometry's name in a model or under it, which names its symbol
  const geometryName = (m: Node, depth: number): string | undefined => {
    const g = (geometry.get(idOf(m)) ?? []).map((x) => byId.get(x)).find((x) => x?.props[2] === "Mesh");
    if (g) return nameOf(g);
    if (depth >= MAX_DEPTH) return undefined;
    for (const k of under.get(idOf(m)) ?? []) {
      const name = geometryName(k, depth + 1);
      if (name) return name;
    }
    return undefined;
  };
  // an instance of symbol `k` placed by `at` (the file's numbers), named after its model unless that only repeats the symbol's name
  const instanceOf = (m: Node, k: number, at: M4): MeshTreeInstance => {
    const own = nameOf(m);
    return { symbol: k, matrix: placementOf(chain(Z, at, Zt)), ...(own && own !== symbols[k].name ? { name: own } : {}) };
  };
  // a repeated model as a symbol, in its own frame: its geometry and the models under it, those that
  // repeat more often than it does (not only as often, being in it) placing symbols of their own
  const symbolFor = (m: Node, sig: string): number => {
    const known = made.get(sig);
    if (known !== undefined) return known;
    const content: MeshTreeNode = { parts: [], groups: [], instances: [] };
    const name = geometryName(m, 0) || nameOf(m) || "Model";
    const fill = (n: Node, frame: M4, ownName: string, depth: number): void => {
      readModel(n, mul4(frame, geometricOf(n)), zRows, ownName, content.parts);
      if (depth >= MAX_DEPTH) return;
      for (const c of under.get(idOf(n)) ?? []) {
        const at = mul4(frame, localOf(c));
        const inner = sigOf(c, 0);
        if (repeated(inner) && (repeats.get(inner) ?? 0) > (repeats.get(sig) ?? 0)) content.instances.push(instanceOf(c, symbolFor(c, inner), at));
        else fill(c, at, nameOf(c), depth + 1);
      }
    };
    // its own geometry stays unnamed: named as the symbol, the drawing would make it "name 2"
    fill(m, I4, "", 0);
    symbols.push({ name, content: { ...content, parts: content.parts.filter((p) => p.faces.length > 0) } });
    made.set(sig, symbols.length - 1);
    return symbols.length - 1;
  };
  // the topmost model of each repeat places its symbol; the rest of the models are parts where they stand
  const visit = (m: Node, depth: number): void => {
    const sig = sigOf(m, 0);
    if (repeated(sig)) {
      instances.push(instanceOf(m, symbolFor(m, sig), worldOf(idOf(m), 0)));
      return;
    }
    readModel(m, mul4(worldOf(idOf(m), 0), geometricOf(m)), zRows, nameOf(m), parts);
    if (depth < MAX_DEPTH) for (const k of under.get(idOf(m)) ?? []) visit(k, depth + 1);
  };
  for (const m of under.get("") ?? []) visit(m, 0);
  return { parts: [], skipped, frame: { mm: frame.mm, yUp: false }, tree: { symbols, top: treeTop(parts.filter((p) => p.faces.length > 0), instances) } };
}

/** A matrix as text that tells the same placements apart, to a part in a billion. */
function key(m: M4): string {
  return m.map((v) => (Math.abs(v) < 1e-12 ? "0" : String(Number(v.toPrecision(9))))).join(" ");
}


