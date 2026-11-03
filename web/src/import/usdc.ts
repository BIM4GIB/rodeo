// Binary USD, the "crate" format Pixar's .usdc files and most .usdz packages hold, read into the
// layer metadata and prims import/usd.ts walks (no DOM). The file's table of contents names its
// sections: TOKENS (the names, LZ4-compressed), STRINGS (strings as token indexes), FIELDS (each
// field's name and value rep), FIELDSETS (each spec's run of fields), PATHS (the path tree, its
// indexes, element tokens and jumps compressed as integers) and SPECS (each spec's path, field set
// and kind). A value rep is 64 bits: whether it is an array, inlined or compressed, its type, and
// 48 bits of payload, the value itself when inlined (small vectors as signed bytes, doubles as
// floats) or where it is in the file. Integer arrays compress as Pixar's integer coding (a common
// delta and 2-bit codes for 8-, 16- and 32-bit deltas) over LZ4; float arrays as integers or a
// lookup table. Versions 0.4.0 and on are read (every file written since USD 19.x); time samples,
// dictionaries and variants are passed over.

import type { Prim, Value } from "./usd.ts";

/** spec kinds, as Sdf numbers them */
const ATTRIBUTE = 1;
const PRIM = 6;
const PSEUDO_ROOT = 7;
const RELATIONSHIP = 8;
const SPECIFIERS = ["def", "over", "class"];

// ---- compression --------------------------------------------------------------------------------

/** An LZ4 block into `out`; the bytes written. */
function lz4(src: Uint8Array, out: Uint8Array): number {
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b: number;
      do {
        b = src[i++];
        lit += b;
      } while (b === 255);
    }
    out.set(src.subarray(i, i + lit), o);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) {
      let b: number;
      do {
        b = src[i++];
        len += b;
      } while (b === 255);
    }
    len += 4;
    if (offset === 0 || offset > o) throw new Error("a compressed section is damaged");
    for (let k = 0; k < len; k++, o++) out[o] = out[o - offset];
  }
  return o;
}

/** Pixar's fast compression: a chunk count (0 for one), then LZ4 blocks, each but a lone one after its size. */
function decompress(src: Uint8Array, max: number): Uint8Array {
  const out = new Uint8Array(max);
  const chunks = src[0];
  if (chunks === 0) return out.subarray(0, lz4(src.subarray(1), out));
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let at = 1;
  let o = 0;
  for (let c = 0; c < chunks; c++) {
    const size = v.getInt32(at, true);
    at += 4;
    o += lz4(src.subarray(at, at + size), out.subarray(o));
    at += size;
  }
  return out.subarray(0, o);
}

/** `n` integers in Pixar's coding: a common delta, 2-bit codes, then the deltas the codes don't take as common; each value the sum of the deltas so far. */
function decodeInts(data: Uint8Array, n: number, wide: boolean): number[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = wide ? 8 : 4;
  const common = wide ? Number(v.getBigInt64(0, true)) : v.getInt32(0, true);
  let at = size + ((n * 2 + 7) >> 3);
  const out = new Array<number>(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const code = (data[size + (i >> 2)] >> ((i & 3) * 2)) & 3;
    let d: number;
    if (code === 0) d = common;
    else if (code === 1) {
      d = wide ? v.getInt16(at, true) : v.getInt8(at);
      at += wide ? 2 : 1;
    } else if (code === 2) {
      d = wide ? v.getInt32(at, true) : v.getInt16(at, true);
      at += wide ? 4 : 2;
    } else {
      d = wide ? Number(v.getBigInt64(at, true)) : v.getInt32(at, true);
      at += size;
    }
    prev = wide ? prev + d : (prev + d) | 0;
    out[i] = prev;
  }
  return out;
}

/** IEEE half precision bits as a number. */
function half(h: number): number {
  const e = (h >> 10) & 31;
  const m = h & 1023;
  const s = h & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

// ---- the file -----------------------------------------------------------------------------------

class Reader {
  readonly v: DataView;
  pos = 0;
  constructor(readonly bytes: Uint8Array) {
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(): number {
    return this.bytes[this.pos++];
  }
  u32(): number {
    const x = this.v.getUint32(this.pos, true);
    this.pos += 4;
    return x;
  }
  i32(): number {
    const x = this.v.getInt32(this.pos, true);
    this.pos += 4;
    return x;
  }
  u64(): number {
    const lo = this.v.getUint32(this.pos, true);
    const hi = this.v.getUint32(this.pos + 4, true);
    this.pos += 8;
    return hi * 2 ** 32 + lo;
  }
  i64(): number {
    const x = Number(this.v.getBigInt64(this.pos, true));
    this.pos += 8;
    return x;
  }
  f32(): number {
    const x = this.v.getFloat32(this.pos, true);
    this.pos += 4;
    return x;
  }
  f64(): number {
    const x = this.v.getFloat64(this.pos, true);
    this.pos += 8;
    return x;
  }
  take(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** `n` integers stored compressed, after their compressed size. */
  ints(n: number, wide = false): number[] {
    const size = this.u64();
    const work = decompress(this.take(size), (wide ? 8 : 4) * (n + 1) + ((n * 2 + 7) >> 3));
    return decodeInts(work, n, wide);
  }
}

/** A value rep: 64 bits read as two halves. */
interface Rep {
  readonly lo: number;
  readonly hi: number;
}
const repType = (r: Rep): number => (r.hi >>> 16) & 0xff;
const isArray = (r: Rep): boolean => (r.hi & 0x80000000) !== 0;
const isInlined = (r: Rep): boolean => (r.hi & 0x40000000) !== 0;
const isCompressed = (r: Rep): boolean => (r.hi & 0x20000000) !== 0;
const payload = (r: Rep): number => (r.hi & 0xffff) * 2 ** 32 + r.lo;

/** The vector types, by their number in the crate's type list: components, and how each is stored. */
const VECTORS: Readonly<Record<number, { n: number; kind: "d" | "f" | "h" | "i" }>> = {
  19: { n: 2, kind: "d" },
  20: { n: 2, kind: "f" },
  21: { n: 2, kind: "h" },
  22: { n: 2, kind: "i" },
  23: { n: 3, kind: "d" },
  24: { n: 3, kind: "f" },
  25: { n: 3, kind: "h" },
  26: { n: 3, kind: "i" },
  27: { n: 4, kind: "d" },
  28: { n: 4, kind: "f" },
  29: { n: 4, kind: "h" },
  30: { n: 4, kind: "i" },
};
const QUATS: Readonly<Record<number, "d" | "f" | "h">> = { 16: "d", 17: "f", 18: "h" };
const MATRICES: Readonly<Record<number, number>> = { 13: 2, 14: 3, 15: 4 };

/** The layer metadata and root prims of a binary USD layer. */
export function readCrate(bytes: Uint8Array): { meta: Map<string, Value>; prims: Prim[] } {
  const r = new Reader(bytes);
  const version = bytes[8] * 10000 + bytes[9] * 100 + bytes[10];
  if (version < 400) throw new Error(`it is binary USD of version ${bytes[8]}.${bytes[9]}.${bytes[10]}, older than this reads (0.4.0 and on)`);
  r.pos = 16;
  r.pos = r.u64();
  const sections = new Map<string, number>();
  for (let n = r.u64(); n > 0; n--) {
    const name = new TextDecoder().decode(r.take(16)).replace(/\0.*$/s, "");
    sections.set(name, r.u64());
    r.u64();
  }
  const seek = (name: string): boolean => {
    const at = sections.get(name);
    if (at === undefined) return false;
    r.pos = at;
    return true;
  };

  let tokens: string[] = [];
  if (seek("TOKENS")) {
    const n = r.u64();
    const size = r.u64();
    const chars = decompress(r.take(r.u64()), size);
    tokens = new TextDecoder().decode(chars).split("\0").slice(0, n);
  }
  const token = (i: number): string => tokens[i] ?? "";
  let strings: number[] = [];
  if (seek("STRINGS")) {
    const n = r.u64();
    strings = Array.from({ length: n }, () => r.u32());
  }
  const string = (i: number): string => token(strings[i] ?? -1);
  let fields: { name: string; rep: Rep }[] = [];
  if (seek("FIELDS")) {
    const n = r.u64();
    const names = r.ints(n);
    const reps = decompress(r.take(r.u64()), n * 8);
    const rv = new DataView(reps.buffer, reps.byteOffset, reps.byteLength);
    fields = names.map((t, i) => ({ name: token(t), rep: { lo: rv.getUint32(i * 8, true), hi: rv.getUint32(i * 8 + 4, true) } }));
  }
  let fieldSets: number[] = [];
  if (seek("FIELDSETS")) fieldSets = r.ints(r.u64());
  let paths: string[] = [];
  if (seek("PATHS")) {
    paths = new Array<string>(r.u64());
    const n = r.u64();
    const index = r.ints(n);
    const element = r.ints(n);
    const jumps = r.ints(n);
    // a jump says where the next sibling is (0 none, -1 a child only, -2 neither, else both)
    const pending: [number, string | null][] = [[0, null]];
    while (pending.length) {
      let [cur, parent] = pending.pop()!;
      let child: boolean;
      let sibling: boolean;
      do {
        const i = cur++;
        if (parent === null) {
          parent = "/";
          paths[index[i]] = "/";
        } else {
          const name = token(Math.abs(element[i]));
          paths[index[i]] = element[i] < 0 ? `${parent}.${name}` : parent === "/" ? `/${name}` : `${parent}/${name}`;
        }
        child = jumps[i] > 0 || jumps[i] === -1;
        sibling = jumps[i] >= 0;
        if (child) {
          if (sibling) pending.push([i + jumps[i], parent]);
          parent = paths[index[i]];
        }
      } while (child || sibling);
    }
  }

  // ---- values ----

  const vector = <T>(read: () => T): T[] => Array.from({ length: r.u64() }, read);
  const component = (kind: "d" | "f" | "h" | "i"): number => (kind === "d" ? r.f64() : kind === "f" ? r.f32() : kind === "h" ? half(r.v.getUint16((r.pos += 2) - 2, true)) : r.i32());
  const listOp = <T>(read: () => T): T[] => {
    const h = r.u8();
    const out: T[] = [];
    // explicit, added, prepended, appended, deleted (left out), ordered (left out)
    for (const bit of [2, 4, 32, 64, 8, 16]) {
      if (!(h & bit)) continue;
      const items = vector(read);
      if (bit !== 8 && bit !== 16) out.push(...items);
    }
    return out;
  };
  /** A payload: its file and prim, then (from 0.8.0) a layer offset. */
  const payloadOf = (): Value => {
    const asset = string(r.u32());
    const prim = paths[r.u32()] ?? "";
    if (version >= 800) {
      r.f64();
      r.f64();
    }
    return asset ? { asset } : { path: prim };
  };
  /** A value at a relative offset (in dictionaries): its rep, then back. */
  const nested = (): Value => {
    const start = r.pos;
    const off = r.i64();
    r.pos = start + off;
    const rep = { lo: r.u32(), hi: r.u32() };
    const v = unpack(rep);
    r.pos = start + 8;
    return v;
  };
  const dictionary = (): Value => {
    const n = r.u64();
    for (let i = 0; i < n; i++) {
      r.u32();
      nested();
    }
    return null;
  };
  const scalar = (t: number): Value => {
    const vec = VECTORS[t];
    if (vec) return Array.from({ length: vec.n }, () => component(vec.kind));
    const quat = QUATS[t];
    if (quat) {
      const [i, j, k, w] = Array.from({ length: 4 }, () => component(quat));
      return [w, i, j, k];
    }
    const dim = MATRICES[t];
    if (dim) return Array.from({ length: dim }, () => Array.from({ length: dim }, () => r.f64()));
    switch (t) {
      case 1:
        return r.u8() !== 0;
      case 2:
        return r.u8();
      case 3:
        return r.i32();
      case 4:
        return r.u32();
      case 5:
      case 6:
        return r.i64();
      case 7:
        return half(r.v.getUint16((r.pos += 2) - 2, true));
      case 8:
        return r.f32();
      case 9:
        return r.f64();
      case 10:
        return string(r.u32());
      case 11:
        return token(r.u32());
      case 12:
        return { asset: token(r.u32()) };
      default:
        return null;
    }
  };

  function unpack(rep: Rep): Value {
    const t = repType(rep);
    if (isArray(rep)) return array(rep, t);
    if (isInlined(rep)) {
      const x = rep.lo;
      const vec = VECTORS[t];
      // small vectors and diagonal matrices inline their components as signed bytes
      const byte = (i: number): number => ((payload(rep) / 2 ** (8 * i)) & 0xff) << 24 >> 24;
      if (vec) return Array.from({ length: vec.n }, (_, i) => byte(i));
      const dim = MATRICES[t];
      if (dim) return Array.from({ length: dim }, (_, i) => Array.from({ length: dim }, (_, j) => (i === j ? byte(i) : 0)));
      switch (t) {
        case 1:
          return x !== 0;
        case 2:
          return x & 0xff;
        case 3:
        case 5:
          return x | 0;
        case 4:
        case 6:
          return x >>> 0;
        case 7:
          return half(x & 0xffff);
        case 8:
        case 9: {
          // a double inlined as the float it equals
          const f = new DataView(new ArrayBuffer(4));
          f.setUint32(0, x, true);
          return f.getFloat32(0, true);
        }
        case 10:
          return string(x);
        case 11:
          return token(x);
        case 12:
          return { asset: token(x) };
        case 31:
          return null;
        default:
          return x;
      }
    }
    const at = payload(rep);
    const back = r.pos;
    r.pos = at;
    try {
      switch (t) {
        case 31:
          return dictionary();
        case 32:
          return listOp(() => token(r.u32()));
        case 33:
          return listOp(() => string(r.u32()));
        case 34:
          return listOp(() => ({ path: paths[r.u32()] ?? "" }));
        case 35:
          return listOp((): Value => {
            const asset = string(r.u32());
            const prim = paths[r.u32()] ?? "";
            r.f64();
            r.f64();
            dictionary();
            return asset ? { asset } : { path: prim };
          });
        case 47:
          return payloadOf();
        case 55:
          return listOp(payloadOf);
        case 40:
          return vector(() => ({ path: paths[r.u32()] ?? "" }));
        case 41:
          return vector(() => token(r.u32()));
        case 48:
          return vector(() => r.f64());
        case 50:
          return vector(() => string(r.u32()));
        case 46:
          // time samples are passed over
          return null;
        default:
          return scalar(t);
      }
    } finally {
      r.pos = back;
    }
  }

  function array(rep: Rep, t: number): Value {
    const at = payload(rep);
    if (at === 0) return [];
    const back = r.pos;
    r.pos = at;
    try {
      if (version < 500) r.u32();
      const n = version < 700 ? r.u32() : r.u64();
      const packed = isCompressed(rep);
      if (t === 3 || t === 4 || t === 5 || t === 6) {
        const wide = t === 5 || t === 6;
        if (packed && version >= 500) return r.ints(n, wide);
        return Array.from({ length: n }, () => (t === 3 ? r.i32() : t === 4 ? r.u32() : r.i64()));
      }
      if (t === 7 || t === 8 || t === 9) {
        if (packed && version >= 600) {
          const code = String.fromCharCode(r.u8());
          if (code === "i") return r.ints(n);
          if (code === "t") {
            const size = r.u32();
            const lut = Array.from({ length: size }, () => scalar(t) as number);
            return r.ints(n).map((i) => lut[i]);
          }
          throw new Error("an array is compressed in a way this doesn't know");
        }
        return Array.from({ length: n }, () => scalar(t));
      }
      if (t === 10 || t === 11 || t === 12 || t === 1 || t === 2 || VECTORS[t] || QUATS[t] || MATRICES[t]) return Array.from({ length: n }, () => scalar(t));
      return null;
    } finally {
      r.pos = back;
    }
  }

  // ---- the specs ----

  const meta = new Map<string, Value>();
  const byPath = new Map<string, Prim & { order?: string[] }>();
  const roots: string[] = [];
  const attrs: { path: string; kind: number; fields: Map<string, Rep> }[] = [];
  if (seek("SPECS")) {
    const n = r.u64();
    const pathIndex = r.ints(n);
    const setIndex = r.ints(n);
    const kinds = r.ints(n);
    for (let s = 0; s < n; s++) {
      const path = paths[pathIndex[s]] ?? "";
      const own = new Map<string, Rep>();
      for (let f = setIndex[s]; f < fieldSets.length && fieldSets[f] >= 0; f++) {
        const field = fields[fieldSets[f]];
        if (field) own.set(field.name, field.rep);
      }
      const value = (name: string): Value | undefined => {
        const rep = own.get(name);
        return rep ? unpack(rep) : undefined;
      };
      if (kinds[s] === PSEUDO_ROOT) {
        for (const k of ["defaultPrim", "metersPerUnit", "upAxis"]) {
          const v = value(k);
          if (v !== undefined) meta.set(k, v);
        }
        const kids = value("primChildren");
        if (Array.isArray(kids)) roots.push(...kids.map(String));
      } else if (kinds[s] === PRIM) {
        const pm = new Map<string, Value>();
        for (const k of ["active", "references", "payload", "kind", "instanceable"]) {
          const v = value(k);
          if (v !== undefined) pm.set(k, v);
        }
        const kids = value("primChildren");
        const specifier = value("specifier");
        byPath.set(path, {
          spec: SPECIFIERS[typeof specifier === "number" ? specifier : 0] ?? "def",
          type: String(value("typeName") ?? ""),
          name: path.slice(path.lastIndexOf("/") + 1),
          meta: pm,
          attrs: new Map(),
          children: [],
          order: Array.isArray(kids) ? kids.map(String) : undefined,
        });
      } else if (kinds[s] === ATTRIBUTE || kinds[s] === RELATIONSHIP) {
        attrs.push({ path, kind: kinds[s], fields: own });
      }
    }
  }
  for (const a of attrs) {
    const dot = a.path.lastIndexOf(".");
    const prim = byPath.get(a.path.slice(0, dot));
    if (!prim) continue;
    const name = a.path.slice(dot + 1);
    const get = (k: string): Value | undefined => {
      const rep = a.fields.get(k);
      return rep ? unpack(rep) : undefined;
    };
    if (a.kind === RELATIONSHIP) {
      const targets = get("targetPaths");
      if (Array.isArray(targets) && targets.length) prim.attrs.set(name, targets.length === 1 ? targets[0] : targets);
      continue;
    }
    const v = get("default");
    if (v !== undefined) prim.attrs.set(name, v);
    const connect = get("connectionPaths");
    if (Array.isArray(connect) && connect.length) prim.attrs.set(`${name}.connect`, connect[0]);
    const interp = get("interpolation");
    if (typeof interp === "string") prim.attrs.set(`${name}#interpolation`, interp);
  }
  // each prim's children, in the order it lists them (else as the specs came)
  const under = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    const names = under.get(parent) ?? [];
    names.push(path.slice(path.lastIndexOf("/") + 1));
    under.set(parent, names);
  }
  for (const [path, p] of byPath) {
    for (const n of p.order ?? under.get(path) ?? []) {
      const c = byPath.get(`${path}/${n}`);
      if (c) p.children.push(c);
    }
  }
  const top = roots.length ? roots : (under.get("/") ?? []);
  return { meta, prims: top.map((n) => byPath.get(`/${n}`)).filter((p): p is Prim & { order?: string[] } => !!p) };
}
