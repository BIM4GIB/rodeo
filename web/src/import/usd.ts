// USD import, the reading side (no DOM): a USD layer, text (.usda) or binary (.usdc, read by
// import/usdc.ts; a .usd may hold either), or a .usdz package of one, as parts for
// app/meshImport.ts. The layer is read whole (prims, their properties and metadata; variant sets,
// time samples and dictionaries are passed over), then its
// defined prims are walked from the root through their transforms (the xformOps in xformOpOrder,
// matrices included) and the prims they reference inside the layer. Each Mesh is a part of its
// polygons, each GeomSubset bound to a material a part of its own; Cube, Sphere, Cylinder and Cone
// prims are made into polygons. A part's colour is its bound material's UsdPreviewSurface diffuse
// colour (bindings inherit down the tree), else its displayColor. Meshes are grouped by the prim
// under the default prim that holds them (a layer, as export/usd.ts writes them). The file's
// metersPerUnit (0.01 when it says nothing, as USD has it) and upAxis (y when it says nothing) come
// back for the importer to apply. Other files' layers, curves, points and instancers are left out,
// and counted.

import { MAX_FACES, type MeshFile, type MeshPart } from "./mesh.ts";
import { readCrate } from "./usdc.ts";
import { unzip } from "./zip.ts";

export interface UsdFile extends MeshFile {
  /** metres per unit of the file's coordinates */
  readonly metersPerUnit: number;
  readonly upAxis: "Y" | "Z";
}

// ---- tokens -----------------------------------------------------------------------------------

type Tok = { readonly k: "id" | "num" | "str" | "asset" | "path" | "p"; readonly v: string };

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "#") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      let s = "";
      while (j < n && !text.startsWith(q, j)) {
        if (text[j] === "\\" && j + 1 < n) {
          const e = text[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
        } else s += text[j++];
      }
      out.push({ k: "str", v: s });
      i = j + q.length;
    } else if (c === "@") {
      const q = text.startsWith("@@@", i) ? "@@@" : "@";
      const j = text.indexOf(q, i + q.length);
      out.push({ k: "asset", v: text.slice(i + q.length, j < 0 ? n : j) });
      i = j < 0 ? n : j + q.length;
    } else if (c === "<") {
      const j = text.indexOf(">", i);
      out.push({ k: "path", v: text.slice(i + 1, j < 0 ? n : j) });
      i = j < 0 ? n : j + 1;
    } else if (/[0-9.+-]/.test(c) && /[0-9.]/.test(text[i + 1] ?? "") || /[0-9]/.test(c) || ((c === "-" || c === "+") && /[iIn]/.test(text[i + 1] ?? ""))) {
      const m = /^[+-]?(?:inf|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(text.slice(i, i + 64));
      const v = m ? m[0] : c;
      out.push({ k: "num", v });
      i += v.length;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w:.]/.test(text[j])) j++;
      out.push({ k: "id", v: text.slice(i, j) });
      i = j;
    } else {
      out.push({ k: "p", v: c });
      i++;
    }
  }
  return out;
}

// ---- the layer --------------------------------------------------------------------------------

/** A value as a layer holds it: numbers, strings and tokens, asset paths, prim paths, and lists and tuples of them. */
export type Value = number | string | boolean | null | { readonly asset: string } | { readonly path: string } | Value[];

/**
 * A prim as the layer defines it: its specifier ("def", "over", "class"), type, name, metadata and
 * properties (an attribute's value by its name, a connection as `name.connect`, a relationship's
 * target by its name, an attribute's interpolation as `name#interpolation`) and its children.
 */
export interface Prim {
  readonly spec: string;
  readonly type: string;
  readonly name: string;
  readonly meta: Map<string, Value>;
  readonly attrs: Map<string, Value>;
  readonly children: Prim[];
}

class Parser {
  private i = 0;
  constructor(private readonly toks: readonly Tok[]) {}

  private peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  private next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new Error("the file ends too soon");
    return t;
  }
  private is(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.k === "p" && t.v === v;
  }
  private expect(v: string): void {
    const t = this.next();
    if (t.k !== "p" || t.v !== v) throw new Error(`expected ${v} but found ${t.v}`);
  }
  /** Passes over a bracketed run, its brackets matched, from its opening one. */
  private skipBalanced(): void {
    let depth = 0;
    do {
      const t = this.next();
      if (t.k === "p" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
      else if (t.k === "p" && (t.v === ")" || t.v === "]" || t.v === "}")) depth--;
    } while (depth > 0);
  }

  value(): Value {
    const t = this.peek();
    if (!t) throw new Error("the file ends too soon");
    if (t.k === "p" && (t.v === "(" || t.v === "[")) {
      const close = t.v === "(" ? ")" : "]";
      this.next();
      const out: Value[] = [];
      while (!this.is(close)) {
        out.push(this.value());
        if (this.is(",")) this.next();
      }
      this.next();
      return out;
    }
    if (t.k === "p" && t.v === "{") {
      // a dictionary or time samples: passed over
      this.skipBalanced();
      return null;
    }
    this.next();
    if (t.k === "num") return Number(t.v.replace(/inf/i, "Infinity"));
    if (t.k === "str") return t.v;
    if (t.k === "asset") return { asset: t.v };
    if (t.k === "path") return { path: t.v };
    if (t.k === "id") return t.v === "true" ? true : t.v === "false" ? false : t.v === "None" ? null : t.v;
    throw new Error(`unexpected ${t.v}`);
  }

  /** `( key = value … )`: a layer's or prim's metadata, list edits (prepend, append…) taken as the value they set. */
  metadata(): Map<string, Value> {
    const out = new Map<string, Value>();
    this.expect("(");
    while (!this.is(")")) {
      const t = this.next();
      if (t.k === "str") {
        out.set("doc", t.v);
        continue;
      }
      if (t.k === "p" && t.v === ";") continue;
      let key = t.v;
      if (["prepend", "append", "add", "delete", "reorder"].includes(key) && this.peek()?.k === "id") key = this.next().v;
      if (this.is("=")) {
        this.next();
        out.set(key, this.value());
      }
    }
    this.next();
    return out;
  }

  layer(): { meta: Map<string, Value>; prims: Prim[] } {
    const meta = this.is("(") ? this.metadata() : new Map<string, Value>();
    const prims: Prim[] = [];
    while (this.peek()) {
      const t = this.next();
      if (t.k === "id" && (t.v === "def" || t.v === "over" || t.v === "class")) prims.push(this.prim(t.v));
    }
    return { meta, prims };
  }

  private prim(spec: string): Prim {
    const type = this.peek()?.k === "id" ? this.next().v : "";
    const name = this.next().v;
    const meta = this.is("(") ? this.metadata() : new Map<string, Value>();
    const prim: Prim = { spec, type, name, meta, attrs: new Map(), children: [] };
    this.expect("{");
    while (!this.is("}")) {
      const t = this.next();
      if (t.k === "p") continue;
      if (t.k === "id" && (t.v === "def" || t.v === "over" || t.v === "class")) {
        prim.children.push(this.prim(t.v));
      } else if (t.v === "variantSet") {
        this.next();
        this.expect("=");
        this.skipBalanced();
      } else if (t.v === "reorder") {
        this.next();
        this.expect("=");
        this.value();
      } else {
        this.property(t, prim);
      }
    }
    this.next();
    return prim;
  }

  /** A property from its first word: qualifiers, its type (with [] for an array), its name, its value and metadata. */
  private property(first: Tok, prim: Prim): void {
    let t = first;
    while (["custom", "uniform", "varying", "config", "prepend", "append", "add", "delete"].includes(t.v)) t = this.next();
    let name: string;
    if (t.v === "rel") name = this.next().v;
    else {
      if (this.is("[") && this.is("]", 1)) {
        this.next();
        this.next();
      }
      name = this.next().v;
    }
    if (this.is("=")) {
      this.next();
      prim.attrs.set(name, this.value());
    }
    if (this.is("(")) {
      const meta = this.metadata();
      const interp = meta.get("interpolation");
      if (typeof interp === "string") prim.attrs.set(`${name}#interpolation`, interp);
    }
  }
}

// ---- transforms ---------------------------------------------------------------------------------

/** A 4×4 matrix, column-major, acting on column vectors. */
type Mat = Float64Array;
const RAD = Math.PI / 180;

function identity(): Mat {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function invert(m: Mat): Mat {
  // a general 4×4 inverse by cofactors
  const a = m;
  const inv = new Float64Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (!det) return identity();
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

function translate(x: number, y: number, z: number): Mat {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function scale(x: number, y: number, z: number): Mat {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

function rotate(axis: number, deg: number): Mat {
  const m = identity();
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  m[a * 4 + a] = c;
  m[a * 4 + b] = s;
  m[b * 4 + a] = -s;
  m[b * 4 + b] = c;
  return m;
}

/** A quaternion (real first, as USD writes it) as a rotation. */
function orient(q: readonly number[]): Mat {
  const [w, x, y, z] = q;
  const n = Math.hypot(w, x, y, z) || 1;
  const [a, b, c, d] = [w / n, x / n, y / n, z / n];
  const m = identity();
  m[0] = 1 - 2 * (c * c + d * d);
  m[1] = 2 * (b * c + a * d);
  m[2] = 2 * (b * d - a * c);
  m[4] = 2 * (b * c - a * d);
  m[5] = 1 - 2 * (b * b + d * d);
  m[6] = 2 * (c * d + a * b);
  m[8] = 2 * (b * d + a * c);
  m[9] = 2 * (c * d - a * b);
  m[10] = 1 - 2 * (b * b + c * c);
  return m;
}

const nums = (v: Value | undefined): number[] => (Array.isArray(v) ? v.flat(3).map(Number) : typeof v === "number" ? [v] : []);

/** One xformOp as a matrix; null for an op the prim doesn't hold. */
function opMatrix(op: string, v: Value | undefined): Mat | null {
  if (v === undefined) return null;
  const kind = op.split(":")[1] ?? "";
  const n = nums(v);
  if (kind === "translate") return translate(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
  if (kind === "scale") return n.length === 1 ? scale(n[0], n[0], n[0]) : scale(n[0] ?? 1, n[1] ?? 1, n[2] ?? 1);
  if (kind === "orient") return orient(n);
  if (kind === "transform") {
    // USD writes a matrix row by row for row vectors: its transpose acts on columns, which is the same numbers column by column
    return n.length === 16 ? Float64Array.from(n) : null;
  }
  const single = /^rotate([XYZ])$/.exec(kind);
  if (single) return rotate("XYZ".indexOf(single[1]), n[0] ?? 0);
  const triple = /^rotate([XYZ]{3})$/.exec(kind);
  if (triple) {
    // rotateXYZ turns about x first, then y, then z
    let m = identity();
    for (const ch of triple[1]) m = mul(rotate("XYZ".indexOf(ch), n["XYZ".indexOf(ch)] ?? 0), m);
    return m;
  }
  return null;
}

/** A prim's own transform, from its xformOpOrder; `reset` when it ignores its parents'. */
function localTransform(p: Prim): { m: Mat; reset: boolean } {
  const order = p.attrs.get("xformOpOrder");
  let m = identity();
  let reset = false;
  if (!Array.isArray(order)) return { m, reset };
  for (const raw of order) {
    if (typeof raw !== "string") continue;
    if (raw === "!resetXformStack!") {
      reset = true;
      m = identity();
      continue;
    }
    const inverse = raw.startsWith("!invert!");
    const op = inverse ? raw.slice(8) : raw;
    const o = opMatrix(op, p.attrs.get(op));
    if (o) m = mul(m, inverse ? invert(o) : o);
  }
  return { m, reset };
}

function apply(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

// ---- primitives ---------------------------------------------------------------------------------

/** sides round a sphere, cylinder or cone */
const SEGMENTS = 24;

/** A Cube, Sphere, Cylinder or Cone as polygons (x, y, z triples), or null for another type. */
function primitiveFaces(p: Prim): number[][] | null {
  const num = (k: string, d: number): number => {
    const v = p.attrs.get(k);
    return typeof v === "number" ? v : d;
  };
  if (p.type === "Cube") {
    const h = num("size", 2) / 2;
    const c = (i: number): number[] => [i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h];
    return [
      [0, 2, 3, 1],
      [4, 5, 7, 6],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 4, 6, 2],
      [1, 3, 7, 5],
    ].map((f) => f.flatMap(c));
  }
  const axis = p.attrs.get("axis");
  const along = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  /** a point at angle a round the axis, r out, h along it */
  const at = (a: number, r: number, h: number): number[] => {
    const u = r * Math.cos(a);
    const v = r * Math.sin(a);
    return along === 2 ? [u, v, h] : along === 0 ? [h, u, v] : [v, h, u];
  };
  const ring = (r: number, h: number): number[][] => Array.from({ length: SEGMENTS }, (_, i) => at((2 * Math.PI * i) / SEGMENTS, r, h));
  if (p.type === "Sphere") {
    const r = num("radius", 1);
    const rows = SEGMENTS / 2;
    const faces: number[][] = [];
    for (let j = 0; j < rows; j++) {
      const a0 = -Math.PI / 2 + (Math.PI * j) / rows;
      const a1 = -Math.PI / 2 + (Math.PI * (j + 1)) / rows;
      const lo = ring(r * Math.cos(a0), r * Math.sin(a0));
      const hi = ring(r * Math.cos(a1), r * Math.sin(a1));
      for (let i = 0; i < SEGMENTS; i++) {
        const k = (i + 1) % SEGMENTS;
        if (j === 0) faces.push([...lo[i], ...hi[k], ...hi[i]]);
        else if (j === rows - 1) faces.push([...lo[i], ...lo[k], ...hi[i]]);
        else faces.push([...lo[i], ...lo[k], ...hi[k], ...hi[i]]);
      }
    }
    return faces;
  }
  if (p.type === "Cylinder" || p.type === "Cone") {
    const r = num("radius", 1);
    const h = num("height", 2) / 2;
    const lo = ring(r, -h);
    const faces: number[][] = [lo.slice().reverse().flat()];
    if (p.type === "Cylinder") {
      const hi = ring(r, h);
      faces.push(hi.flat());
      for (let i = 0; i < SEGMENTS; i++) faces.push([...lo[i], ...lo[(i + 1) % SEGMENTS], ...hi[(i + 1) % SEGMENTS], ...hi[i]]);
    } else {
      const tip = at(0, 0, h);
      for (let i = 0; i < SEGMENTS; i++) faces.push([...lo[i], ...lo[(i + 1) % SEGMENTS], ...tip]);
    }
    return faces;
  }
  return null;
}

// ---- the scene ----------------------------------------------------------------------------------

const PRIMITIVES = new Set(["Cube", "Sphere", "Cylinder", "Cone"]);
const SKIPPED_TYPES: Readonly<Record<string, string>> = {
  BasisCurves: "curve",
  NurbsCurves: "curve",
  Points: "point cloud",
  PointInstancer: "instancer",
  NurbsPatch: "surface",
  Capsule: "capsule",
  Plane: "plane",
};

function pathOf(v: Value | undefined): string | null {
  if (v && typeof v === "object" && !Array.isArray(v) && "path" in v) return v.path;
  if (Array.isArray(v) && v.length > 0) return pathOf(v[0]);
  return null;
}

/** A text USD layer as parts. */
export function parseUsda(text: string): UsdFile {
  if (!/^\s*#usda\b/.test(text)) throw new Error("it isn't a text USD layer");
  const { meta, prims } = new Parser(tokenize(text)).layer();
  return sceneOf(meta, prims);
}

/** A layer's metadata and root prims (read from text or from binary) as parts. */
export function sceneOf(meta: ReadonlyMap<string, Value>, prims: readonly Prim[]): UsdFile {
  const byPath = new Map<string, Prim>();
  const index = (p: Prim, parent: string): void => {
    const path = `${parent}/${p.name}`;
    byPath.set(path, p);
    for (const c of p.children) index(c, path);
  };
  for (const p of prims) index(p, "");

  const parts: MeshPart[] = [];
  const skipped: Record<string, number> = {};
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };
  let faces = 0;
  const defaultPrim = typeof meta.get("defaultPrim") === "string" ? `/${meta.get("defaultPrim")}` : null;

  /** The diffuse colour of the material at `path`, through its surface output. */
  const materialColour = (path: string | null): MeshPart["color"] | undefined => {
    const mat = path ? byPath.get(path) : undefined;
    if (!mat) return undefined;
    const surface = pathOf(mat.attrs.get("outputs:surface.connect"));
    const shader = surface ? byPath.get(surface.split(".")[0]) : mat.children.find((c) => c.attrs.get("info:id") === "UsdPreviewSurface");
    if (!shader) return undefined;
    const c = shader.attrs.get("inputs:diffuseColor");
    const n = nums(c);
    if (n.length >= 3) return { r: n[0], g: n[1], b: n[2] };
    // a texture's colour isn't read; its fallback, when it gives one
    const tex = pathOf(shader.attrs.get("inputs:diffuseColor.connect"));
    const fallback = tex ? nums(byPath.get(tex.split(".")[0])?.attrs.get("inputs:fallback")) : [];
    if (tex) skip("texture");
    return fallback.length >= 3 ? { r: fallback[0], g: fallback[1], b: fallback[2] } : undefined;
  };
  const displayColour = (p: Prim): MeshPart["color"] | undefined => {
    const n = nums(p.attrs.get("primvars:displayColor"));
    return n.length >= 3 ? { r: n[0], g: n[1], b: n[2] } : undefined;
  };

  const addPart = (name: string, polys: number[][], m: Mat, color: MeshPart["color"] | undefined, group: string, flip: boolean): void => {
    if (polys.length === 0) return;
    faces += polys.length;
    if (faces > MAX_FACES) throw new Error(`it has more than ${MAX_FACES.toLocaleString("en")} faces, more than can come in at once`);
    const out = polys.map((f) => {
      const pts: number[] = [];
      for (let i = 0; i < f.length; i += 3) pts.push(...apply(m, f[i], f[i + 1], f[i + 2]));
      if (!flip) return pts;
      const rev: number[] = [];
      for (let i = pts.length - 3; i >= 0; i -= 3) rev.push(pts[i], pts[i + 1], pts[i + 2]);
      return rev;
    });
    parts.push({ name, faces: out, ...(color ? { color } : {}), ...(group ? { group } : {}) });
  };

  /** The meshes under `p` (at `path`), through `parent`'s transform, bound to `binding` unless they bind their own. */
  const walk = (p: Prim, path: string, parent: Mat, binding: string | null, group: string, depth: number, seen: ReadonlySet<Prim>): void => {
    if (p.spec !== "def" || p.meta.get("active") === false || seen.has(p)) return;
    // a reference to a prim of this layer brings its children and properties in; another file's isn't read
    const ref = p.meta.get("references") ?? p.meta.get("payload");
    let body = p;
    if (ref !== undefined && ref !== null) {
      const target = pathOf(ref);
      const hasAsset = JSON.stringify(ref).includes('"asset"');
      const t = target && !hasAsset ? byPath.get(target) : undefined;
      if (t) body = { ...t, name: p.name, meta: p.meta, attrs: new Map([...t.attrs, ...p.attrs]), children: [...t.children, ...p.children] };
      else if (hasAsset) skip("reference to another file");
    }
    const visible = body.attrs.get("visibility") !== "invisible" && body.attrs.get("purpose") !== "guide" && body.attrs.get("purpose") !== "proxy";
    if (!visible) return;
    const { m: local, reset } = localTransform(body);
    const m = reset ? local : mul(parent, local);
    const bound = pathOf(body.attrs.get("material:binding")) ?? binding;
    // the prim under the default one (a layer) groups what it holds
    const g = depth === 1 && body.children.length > 0 ? body.name : group;
    const kind = SKIPPED_TYPES[body.type];
    if (kind) skip(kind);
    else if (PRIMITIVES.has(body.type)) {
      const polys = primitiveFaces(body);
      if (polys) addPart(body.name, polys, m, materialColour(bound) ?? displayColour(body), g, false);
    } else if (body.type === "Mesh") {
      const pts = nums(body.attrs.get("points"));
      const counts = nums(body.attrs.get("faceVertexCounts"));
      const idx = nums(body.attrs.get("faceVertexIndices"));
      const polys: number[][] = [];
      let at = 0;
      for (const c of counts) {
        const f: number[] = [];
        for (let k = 0; k < c; k++) {
          const v = idx[at + k];
          f.push(pts[v * 3], pts[v * 3 + 1], pts[v * 3 + 2]);
        }
        at += c;
        polys.push(c >= 3 && f.every(Number.isFinite) ? f : []);
      }
      const flip = body.attrs.get("orientation") === "leftHanded";
      // faces a subset binds to a material of its own come in as parts of their own
      const taken = new Set<number>();
      for (const s of body.children) {
        if (s.type !== "GeomSubset" || s.attrs.get("familyName") !== "materialBind") continue;
        const sub = pathOf(s.attrs.get("material:binding"));
        const ids = nums(s.attrs.get("indices")).filter((i) => polys[i]?.length && !taken.has(i));
        ids.forEach((i) => taken.add(i));
        addPart(`${body.name}_${s.name}`, ids.map((i) => polys[i]), m, materialColour(sub ?? bound) ?? displayColour(body), g, flip);
      }
      const rest = polys.filter((f, i) => f.length > 0 && !taken.has(i));
      addPart(body.name, rest, m, materialColour(bound) ?? displayColour(body), g, flip);
    }
    const next = new Set(seen).add(p);
    for (const c of body.children) if (c.type !== "GeomSubset" && c.type !== "Material" && c.type !== "Shader") walk(c, `${path}/${c.name}`, m, bound, g, depth + 1, next);
  };
  const roots = defaultPrim && byPath.has(defaultPrim) ? [byPath.get(defaultPrim)!] : prims;
  for (const p of roots) walk(p, `/${p.name}`, identity(), null, "", 0, new Set());

  const mpu = meta.get("metersPerUnit");
  return {
    parts,
    skipped,
    metersPerUnit: typeof mpu === "number" && mpu > 0 ? mpu : 0.01,
    upAxis: meta.get("upAxis") === "Z" ? "Z" : "Y",
  };
}

/** A .usd, .usda, .usdc or .usdz file's bytes as parts. */
export function parseUsd(bytes: Uint8Array): UsdFile {
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic === "PXR-USDC") {
    let layer: ReturnType<typeof readCrate>;
    try {
      layer = readCrate(bytes);
    } catch (err) {
      // reads past the end come back as RangeErrors
      throw err instanceof RangeError ? new Error("the binary USD is cut short or damaged") : err;
    }
    return sceneOf(layer.meta, layer.prims);
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // a .usdz: its first USD file is the root layer
    const files = unzip(bytes);
    const root = [...files.keys()].find((k) => /\.usd[ac]?$/i.test(k));
    if (!root) throw new Error("the package holds no USD layer");
    return parseUsd(files.get(root)!());
  }
  return parseUsda(new TextDecoder().decode(bytes));
}
