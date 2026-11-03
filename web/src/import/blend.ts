// Blender .blend files, the reading side (no DOM). parseBlend reads a file Blender saves, uncompressed,
// zstd-compressed (Blender 3.0 on) or gzip-compressed (older). Every field is looked up by name in the
// file's own struct table (its DNA), so no offset is written here. Only Blender 4.4 files have been read;
// the paths for 2.8 to 3.x (the MVert, MPoly and MLoop arrays, and the matrix each object keeps) and for
// 5.0's longer header and block headers are written from the layouts as known, and untested. The scene's
// collections are walked, and each mesh object comes in as its base mesh, placed by its world transform:
// the matrix the file keeps (2.8 to 3.x), else one worked out from its location, rotation, scale, deltas
// and object parent. A part is made for each material its faces use, named after the object and coloured
// by that material's Principled BSDF base colour (its viewport colour without such a node). Modifiers and
// constraints are not applied: an object with either comes in as its base mesh and is counted as an
// unapplied modifier or constraint. Left out and counted: curves, surfaces, text and metaballs, grease
// pencil, point clouds, volumes, collection instances and linked objects. Lights, cameras, empties and
// armatures hold no geometry and are not counted. Textures, shape keys, geometry nodes, and bone or
// vertex parents (ignored, so the object is placed by its own transform) are not read. Colours are
// converted from Blender's linear values to sRGB, the palette a drawing's colours are picked from. The
// scene's unit scale sets the millimetres per unit.

import { decompress } from "fzstd";
import { inflate } from "../export/flate.ts";
import { MAX_FACES, tooMany, type MeshFile, type MeshPart } from "./mesh.ts";

const UTF8 = new TextDecoder();
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const CODE_OB = "OB\0\0";
const CODE_SC = "SC\0\0";

/** Blender's object types (DNA_object_types.h) that matter here. */
const OB_EMPTY = 0;
const OB_MESH = 1;
/** object types left out, with the kind they are counted as */
const LEFT_OUT: ReadonlyMap<number, string> = new Map([
  [2, "curve or surface"],
  [3, "curve or surface"],
  [4, "curve or surface"],
  [5, "curve or surface"],
  [27, "curve or surface"],
  [26, "grease pencil"],
  [30, "grease pencil"],
  [28, "point cloud"],
  [29, "volume"],
]);
/** transflag bit on an empty that instances a collection */
const OB_DUPLICOLLECTION = 1 << 8;
/** partype: the parent is an object (the low bits; the rest are flags) */
const PAROBJECT = 0;
const PARTYPE_MASK = 0x0f;
/** rotmode: 1 to 6 are Euler orders, -1 an axis and angle, 0 a quaternion */
const ROT_AXIS_ANGLE = -1;
/** the axes of each Euler order (XYZ, XZY, YXZ, YZX, ZXY, ZYX), in the order they turn */
const EULER_ORDER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const PRINCIPLED = "ShaderNodeBsdfPrincipled";
/** deepest object parent chain, and longest list, followed */
const MAX_DEPTH = 64;
const MAX_LIST = 1_000_000;

interface Header {
  ptrSize: number;
  le: boolean;
  headerLen: number;
  /** Blender 5.0's 64-bit block headers */
  long: boolean;
}

interface Field {
  type: string;
  offset: number;
  size: number;
}

interface Struct {
  name: string;
  size: number;
  fields: Map<string, Field>;
}

/** a struct in the file, and where its bytes start in the file */
interface Ref {
  s: Struct;
  at: number;
}

/** a block of the file: its code, its struct index (not used for DATA), its old address and its data */
interface Block {
  code: string;
  nr: number;
  addr: number;
  start: number;
  len: number;
}

/** a run of a block's data: where it starts in the file and how many bytes are left */
interface Raw {
  at: number;
  len: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** a 4x4 matrix, row by row (m[row * 4 + col]) */
type Mat = number[];

interface MeshData {
  nv: number;
  faces: number;
  /** x, y, z per vertex, in the object's own space */
  verts: Float64Array;
  /** first corner of each face, and one past its last (faces + 1 entries) */
  offsets: Int32Array;
  /** the vertex each corner is at */
  corners: Int32Array;
  /** each face's material slot, when the mesh has more than one */
  mats: Int32Array | null;
}

interface Item {
  holder: string;
  parts: MeshPart[];
}

/** Reads a .blend file into mesh parts; throws a short clause for what it can't read. */
export function parseBlend(bytes: Uint8Array): MeshFile {
  try {
    return new Reader(unpack(bytes)).read();
  } catch (e) {
    if (e instanceof RangeError) throw new Error("it ends early");
    throw e;
  }
}

/** The file's bytes, decompressed when zstd (Blender 3.0 on) or gzip (older) packed. */
function unpack(b: Uint8Array): Uint8Array {
  if (b.length >= 4 && ZSTD_MAGIC.every((v, i) => b[i] === v)) {
    try {
      return decompress(b);
    } catch {
      throw new Error("its compressed data is damaged");
    }
  }
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) {
    try {
      return gunzip(b);
    } catch {
      throw new Error("its compressed data is damaged");
    }
  }
  return b;
}

/** A gzip file's deflate data, inflated: its header is skipped and the zlib wrapper inflate needs put back. */
function gunzip(b: Uint8Array): Uint8Array {
  const flg = b[3];
  let p = 10;
  if (flg & 4) p += 2 + (b[p] | (b[p + 1] << 8));
  // a file name and a comment, each ended by a zero byte
  for (const bit of [8, 16]) {
    if (flg & bit) {
      while (p < b.length && b[p] !== 0) p++;
      p++;
    }
  }
  if (flg & 2) p += 2;
  const z = new Uint8Array(b.length - p + 2);
  z[0] = 0x78;
  z[1] = 0x9c;
  z.set(b.subarray(p), 2);
  return inflate(z);
}

/** n bytes from a position, as text (zero bytes and all). */
function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = at; i < Math.min(b.length, at + n); i++) s += String.fromCharCode(b[i]);
  return s;
}

/** The header: "BLENDER" then the pointer size and endianness, or Blender 5.0's longer one. */
function readHeader(b: Uint8Array): Header {
  if (ascii(b, 0, 7) !== "BLENDER") throw new Error("it isn't a Blender file");
  if (b.length < 12) throw new Error("it ends early");
  // Blender 5.0 writes "BLENDER17-01v0500": header length, pointer size, format version, endianness, version
  if (/^\d\d$/.test(ascii(b, 7, 2))) {
    if (ascii(b, 10, 2) !== "01") throw new Error("it is a Blender file format this reader doesn't know");
    return { ptrSize: pointerSize(b[9]), le: endian(b[12]), headerLen: Number(ascii(b, 7, 2)), long: true };
  }
  // "BLENDER-v404": a '-' for 8-byte pointers, '_' for 4, then 'v' (little endian) or 'V'
  return { ptrSize: pointerSize(b[7]), le: endian(b[8]), headerLen: 12, long: false };
}

/** The pointer size a header byte names: '-' for 8 bytes, '_' for 4. */
function pointerSize(c: number): number {
  if (c === 0x2d) return 8;
  if (c === 0x5f) return 4;
  throw new Error("its header is damaged");
}

/** The endianness a header byte names: true for little endian ('v'). */
function endian(c: number): boolean {
  if (c === 0x76) return true;
  if (c === 0x56) return false;
  throw new Error("its header is damaged");
}


const damaged = (what: string): Error => new Error(`its ${what} is damaged`);

/** A reader over one decompressed file: its blocks, its structs, and the objects in its scene. */
class Reader {
  private readonly dv: DataView;
  private readonly le: boolean;
  private readonly ptrSize: number;
  private readonly structs = new Map<string, Struct>();
  private readonly blocks: Block[] = [];
  /** blocks with data, by old address */
  private readonly byAddr: Block[];
  private readonly skipped: Record<string, number> = {};
  private readonly colours = new Map<number, RGB | undefined>();
  private readonly worlds = new Map<number, Mat>();
  private faces = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const h = readHeader(bytes);
    this.le = h.le;
    this.ptrSize = h.ptrSize;
    this.readBlocks(h);
    const dna = this.blocks.find((b) => b.code === "DNA1");
    if (!dna) throw new Error("it has no struct table");
    this.readSdna(dna.start, dna.len);
    this.byAddr = this.blocks.filter((b) => b.len > 0 && b.addr !== 0).sort((a, b) => a.addr - b.addr);
  }

  /** The parts of the scene's mesh objects, and what was left out of it. */
  read(): MeshFile {
    const items: Item[] = [];
    for (const { ob, holder } of this.objects()) this.object(ob, holder, items);
    // objects in two or more collections are grouped by the collection that holds them
    const holders = new Set(items.map((it) => it.holder));
    const parts: MeshPart[] = [];
    for (const it of items) {
      for (const p of it.parts) {
        if (holders.size > 1 && it.holder) p.group = it.holder;
        parts.push(p);
      }
    }
    return { parts, skipped: this.skipped, frame: { mm: this.mmPerUnit(), yUp: false } };
  }

  // ---- blocks and structs ----------------------------------------------------------------------

  /** Every block up to ENDB: the block header is 16 bytes and a pointer (or 32 bytes in Blender 5.0). */
  private readBlocks(h: Header): void {
    const { dv, le, ptrSize } = this;
    let p = h.headerLen;
    for (;;) {
      if (p + 4 > this.bytes.length) throw new Error("it ends early");
      if (ascii(this.bytes, p, 4) === "ENDB") break;
      let len: number;
      let addr: number;
      let nr: number;
      let start: number;
      if (h.long) {
        len = Number(dv.getBigInt64(p + 16, le));
        addr = Number(dv.getBigUint64(p + 8, le));
        nr = Number(dv.getBigInt64(p + 24, le));
        start = p + 32;
      } else {
        len = dv.getInt32(p + 4, le);
        addr = this.readPtr(p + 8);
        nr = dv.getInt32(p + 12 + ptrSize, le);
        start = p + 16 + ptrSize;
      }
      if (len < 0 || start + len > this.bytes.length) throw new Error("it ends early");
      this.blocks.push({ code: ascii(this.bytes, p, 4), nr, addr, start, len });
      p = start + len;
    }
  }

  /** The struct table: names, types, their lengths, then each struct's fields with offsets worked out from the sizes. */
  private readSdna(start: number, len: number): void {
    const { dv, le } = this;
    const end = start + len;
    let q = start;
    const word = (w: string): void => {
      if (ascii(this.bytes, q, 4) !== w) throw damaged("struct table");
      q += 4;
    };
    const align = (): void => {
      q = start + ((q - start + 3) & ~3);
    };
    const count = (): number => {
      const n = dv.getInt32(q, le);
      q += 4;
      if (n < 0 || n > len) throw damaged("struct table");
      return n;
    };
    const strings = (n: number): string[] => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const at = q;
        while (q < end && this.bytes[q] !== 0) q++;
        if (q >= end) throw damaged("struct table");
        out.push(UTF8.decode(this.bytes.subarray(at, q)));
        q++;
      }
      return out;
    };
    word("SDNA");
    word("NAME");
    const names = strings(count());
    align();
    word("TYPE");
    const types = strings(count());
    align();
    word("TLEN");
    const tlen = types.map((_, i) => dv.getUint16(q + 2 * i, le));
    q += 2 * types.length;
    align();
    word("STRC");
    const ns = count();
    for (let i = 0; i < ns; i++) {
      const t = dv.getUint16(q, le);
      const nf = dv.getUint16(q + 2, le);
      q += 4;
      const fields = new Map<string, Field>();
      let offset = 0;
      for (let k = 0; k < nf; k++) {
        const ft = dv.getUint16(q, le);
        const fn = dv.getUint16(q + 2, le);
        q += 4;
        const raw = names[fn];
        // "*next" and "(*update)()" are pointers; "mat[4][4]" is 16 of its type
        const name = raw.split("[")[0].replace(/[*()\s]/g, "");
        let n = 1;
        for (const d of raw.matchAll(/\[(\d+)\]/g)) n *= Number(d[1]);
        const size = (raw.includes("*") ? this.ptrSize : tlen[ft]) * n;
        fields.set(name, { type: types[ft], offset, size });
        offset += size;
      }
      this.structs.set(types[t], { name: types[t], size: tlen[t], fields });
    }
  }

  private struct(name: string): Struct {
    const s = this.structs.get(name);
    if (!s) throw new Error(`its layout has no ${name} struct`);
    return s;
  }

  private field(r: Ref, names: string[]): Field {
    for (const n of names) {
      const f = r.s.fields.get(n);
      if (f) return f;
    }
    throw new Error(`its layout has no ${r.s.name}.${names[0]}`);
  }

  private has(r: Ref, names: string[]): boolean {
    return names.some((n) => r.s.fields.has(n));
  }

  /** A field's number, read as its type says. */
  private num(r: Ref, names: string[]): number {
    const f = this.field(r, names);
    const at = r.at + f.offset;
    const dv = this.dv;
    const le = this.le;
    switch (f.type) {
      case "float":
        return dv.getFloat32(at, le);
      case "double":
        return dv.getFloat64(at, le);
      case "char":
        return dv.getInt8(at);
      case "uchar":
        return dv.getUint8(at);
      case "short":
        return dv.getInt16(at, le);
      case "ushort":
        return dv.getUint16(at, le);
      case "int":
        return dv.getInt32(at, le);
      case "uint":
        return dv.getUint32(at, le);
      case "int64_t":
        return Number(dv.getBigInt64(at, le));
      case "uint64_t":
        return Number(dv.getBigUint64(at, le));
      default:
        throw new Error(`its layout has a ${f.type} field, ${names[0]}, that isn't read`);
    }
  }

  /** A field that holds a pointer: the address it points to. */
  private ptr(r: Ref, names: string[]): number {
    return this.readPtr(r.at + this.field(r, names).offset);
  }

  /** A pointer field, or zero when this version of the file has no such field. */
  private optPtr(r: Ref, names: string[]): number {
    return this.has(r, names) ? this.ptr(r, names) : 0;
  }

  private readPtr(at: number): number {
    return this.ptrSize === 8 ? Number(this.dv.getBigUint64(at, this.le)) : this.dv.getUint32(at, this.le);
  }

  /** A field's text, up to its first zero byte. */
  private str(r: Ref, names: string[]): string {
    const f = this.field(r, names);
    const at = r.at + f.offset;
    const lim = at + f.size;
    let end = at;
    while (end < lim && this.bytes[end] !== 0) end++;
    return UTF8.decode(this.bytes.subarray(at, end));
  }

  /** A field that is itself a struct, in place. */
  private sub(r: Ref, names: string[]): Ref {
    const f = this.field(r, names);
    return { s: this.struct(f.type), at: r.at + f.offset };
  }

  /** A field's numbers, n of them, as floats. */
  private floats(r: Ref, names: string[], n: number): number[] {
    const f = this.field(r, names);
    if (f.size < 4 * n) throw new Error(`its layout has a ${names[0]} that is too short`);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = this.dv.getFloat32(r.at + f.offset + 4 * i, this.le);
    return out;
  }

  /** The block that holds an old address, if any. */
  private blockAt(addr: number): Block | null {
    if (!addr) return null;
    const arr = this.byAddr;
    let lo = 0;
    let hi = arr.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].addr <= addr) {
        best = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (best < 0) return null;
    const b = arr[best];
    return addr < b.addr + b.len ? b : null;
  }

  /** The struct at an old address, of the named type, if the file has it. */
  private refOf(addr: number, name: string): Ref | null {
    const b = this.blockAt(addr);
    if (!b) return null;
    const s = this.struct(name);
    const off = addr - b.addr;
    if (off + s.size > b.len) return null;
    return { s, at: b.start + off };
  }

  /** The n-th struct of an array at an old address. */
  private elem(addr: number, name: string, i: number): Ref {
    const s = this.struct(name);
    const r = this.refOf(addr + i * s.size, name);
    if (!r) throw damaged(`${name} array`);
    return r;
  }

  /** The data at an old address: where it starts in the file, and its length. */
  private raw(addr: number): Raw | null {
    const b = this.blockAt(addr);
    if (!b) return null;
    const off = addr - b.addr;
    return { at: b.start + off, len: b.len - off };
  }

  /** A ListBase's items, each of the named struct type, in order. */
  private list(r: Ref, names: string[], item: string): Ref[] {
    const out: Ref[] = [];
    const seen = new Set<number>();
    let addr = this.ptr(this.sub(r, names), ["first"]);
    for (;;) {
      const it = this.refOf(addr, item);
      if (!it || seen.has(it.at) || out.length >= MAX_LIST) break;
      seen.add(it.at);
      out.push(it);
      addr = this.ptr(it, ["next"]);
    }
    return out;
  }

  /** Millimetres in one Blender unit: the scene's unit scale, which is 1 metre by default. */
  private mmPerUnit(): number {
    const scene = this.sceneRef();
    const scale = scene ? this.num(this.sub(scene, ["unit"]), ["scale_length"]) : 1;
    // toPrecision drops the float32 noise (0.001 is not exact in float32)
    return Number((1000 * (scale > 0 ? scale : 1)).toPrecision(7));
  }

  /** The scene to read: the one the file was saved with, else its first. */
  private sceneRef(): Ref | null {
    const glob = this.blocks.find((b) => b.code === "GLOB");
    if (glob) {
      const g: Ref = { s: this.struct("FileGlobal"), at: glob.start };
      const cur = this.refOf(this.ptr(g, ["curscene"]), "Scene");
      if (cur) return cur;
    }
    const first = this.blocks.find((b) => b.code === CODE_SC);
    return first ? this.refOf(first.addr, "Scene") : null;
  }

  // ---- objects ---------------------------------------------------------------------------------

  /** The scene's objects, each with the collection that holds it (blank for the scene collection). */
  private objects(): { ob: Ref; holder: string }[] {
    const out: { ob: Ref; holder: string }[] = [];
    const scene = this.sceneRef();
    const master = scene ? this.refOf(this.ptr(scene, ["master_collection"]), "Collection") : null;
    if (master) {
      const seenObj = new Set<number>();
      const seenLinked = new Set<number>();
      const seenColl = new Set<number>();
      const visit = (coll: Ref, holder: string, depth: number): void => {
        if (seenColl.has(coll.at) || depth > MAX_DEPTH) return;
        seenColl.add(coll.at);
        for (const co of this.list(coll, ["gobject"], "CollectionObject")) {
          const addr = this.ptr(co, ["ob"]);
          const ob = this.refOf(addr, "Object");
          if (!ob) {
            // Blender writes a library's object only as a pointer, so one with no block here is linked
            if (addr && !seenLinked.has(addr)) {
              seenLinked.add(addr);
              this.leave("linked object");
            }
          } else if (!seenObj.has(ob.at)) {
            seenObj.add(ob.at);
            out.push({ ob, holder });
          }
        }
        for (const ch of this.list(coll, ["children"], "CollectionChild")) {
          const child = this.refOf(this.ptr(ch, ["collection"]), "Collection");
          if (child) visit(child, this.nameOf(child), depth + 1);
        }
      };
      visit(master, "", 0);
      return out;
    }
    // no scene to walk: every mesh object that is in use
    for (const b of this.blocks) {
      if (b.code !== CODE_OB) continue;
      const ob: Ref = { s: this.struct("Object"), at: b.start };
      if (this.num(ob, ["type"]) === OB_MESH && this.num(this.sub(ob, ["id"]), ["us"]) > 0) out.push({ ob, holder: "" });
    }
    return out;
  }

  /** An ID's name without its two-letter type code. */
  private nameOf(r: Ref): string {
    return this.str(this.sub(r, ["id"]), ["name"]).slice(2);
  }

  /** Counts one thing left out, by its kind. */
  private leave(kind: string): void {
    this.skipped[kind] = (this.skipped[kind] ?? 0) + 1;
  }

  /** Reads one scene object: a mesh's parts, or what is left out of them. */
  private object(ob: Ref, holder: string, out: Item[]): void {
    const id = this.sub(ob, ["id"]);
    if (this.ptr(id, ["lib"])) return this.leave("linked object");
    const type = this.num(ob, ["type"]);
    if (type === OB_EMPTY) {
      if (this.num(ob, ["transflag"]) & OB_DUPLICOLLECTION && this.optPtr(ob, ["dup_group", "instance_collection"])) this.leave("collection instance");
      return;
    }
    const kind = LEFT_OUT.get(type);
    if (kind) return this.leave(kind);
    if (type !== OB_MESH) return;
    const me = this.refOf(this.ptr(ob, ["data"]), "Mesh");
    if (!me) return;
    if (this.ptr(this.sub(ob, ["modifiers"]), ["first"])) this.leave("unapplied modifier");
    if (this.ptr(this.sub(ob, ["constraints"]), ["first"])) this.leave("unapplied constraint");

    const m = this.meshData(me);
    const world = this.world(ob, 0);
    const wv = new Float64Array(3 * m.nv);
    for (let v = 0; v < m.nv; v++) {
      const [x, y, z] = [m.verts[3 * v], m.verts[3 * v + 1], m.verts[3 * v + 2]];
      for (let r = 0; r < 3; r++) wv[3 * v + r] = world[r * 4] * x + world[r * 4 + 1] * y + world[r * 4 + 2] * z + world[r * 4 + 3];
    }
    const slots = this.slots(ob, me);
    const name = this.nameOf(ob);
    const byKey = new Map<number, MeshPart>();
    for (let f = 0; f < m.faces; f++) {
      const a = m.offsets[f];
      const z = m.offsets[f + 1];
      if (z - a < 3) continue;
      // a face's slot is clamped to the object's slots, as Blender clamps it on load
      const slot = m.mats && slots.length ? Math.min(slots.length - 1, Math.max(0, m.mats[f])) : 0;
      const key = slots.length ? slots[slot] : 0;
      const corners: number[] = [];
      let ok = true;
      for (let c = a; c < z; c++) {
        const v = c < m.corners.length ? m.corners[c] : -1;
        if (v < 0 || v >= m.nv) {
          ok = false;
          break;
        }
        corners.push(wv[3 * v], wv[3 * v + 1], wv[3 * v + 2]);
      }
      if (!ok) continue;
      if (++this.faces > MAX_FACES) throw tooMany();
      let part = byKey.get(key);
      if (!part) {
        const color = this.colour(key);
        part = { name, faces: [], ...(color ? { color } : {}) };
        byKey.set(key, part);
      }
      part.faces.push(corners);
    }
    if (byKey.size) out.push({ holder, parts: [...byKey.values()] });
  }

  /** An object's material slots, each the address of its material (zero for none), in slot order. */
  private slots(ob: Ref, me: Ref): number[] {
    const n = this.num(ob, ["totcol"]);
    const obMats = this.optPtr(ob, ["mat"]);
    const meMats = this.optPtr(me, ["mat"]);
    const meCount = this.num(me, ["totcol"]);
    const bits = this.raw(this.optPtr(ob, ["matbits"]));
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      // a slot linked to the object keeps its material in the object, not the mesh
      const linked = bits !== null && i < bits.len && this.bytes[bits.at + i] !== 0;
      const list = linked ? obMats : meMats;
      const count = linked ? n : meCount;
      const arr = this.raw(list);
      out.push(list && i < count && arr && arr.len >= (i + 1) * this.ptrSize ? this.readPtr(arr.at + i * this.ptrSize) : 0);
    }
    return out;
  }

  /** A material's colour in sRGB: its Principled BSDF base colour, else its viewport colour. */
  private colour(addr: number): RGB | undefined {
    if (!addr) return undefined;
    if (this.colours.has(addr)) return this.colours.get(addr);
    const mat = this.refOf(addr, "Material");
    const c = mat ? this.materialColour(mat) : undefined;
    this.colours.set(addr, c);
    return c;
  }

  private materialColour(mat: Ref): RGB | undefined {
    const tree = this.refOf(this.ptr(mat, ["nodetree"]), "bNodeTree");
    if (tree) {
      for (const node of this.list(tree, ["nodes"], "bNode")) {
        if (this.str(node, ["idname"]) !== PRINCIPLED) continue;
        for (const sock of this.list(node, ["inputs"], "bNodeSocket")) {
          if (this.str(sock, ["identifier"]) !== "Base Color") continue;
          const v = this.refOf(this.ptr(sock, ["default_value"]), "bNodeSocketValueRGBA");
          if (v) {
            const [r, g, b] = this.floats(v, ["value"], 3);
            return { r: toSrgb(r), g: toSrgb(g), b: toSrgb(b) };
          }
        }
      }
    }
    return { r: toSrgb(this.num(mat, ["r"])), g: toSrgb(this.num(mat, ["g"])), b: toSrgb(this.num(mat, ["b"])) };
  }

  // ---- transforms ------------------------------------------------------------------------------

  /** An object's world matrix: the file's own where it keeps one, else its parent's times its parent inverse times its own. */
  private world(ob: Ref, depth: number): Mat {
    const known = this.worlds.get(ob.at);
    if (known) return known;
    let m: Mat;
    if (this.has(ob, ["obmat", "object_to_world"])) {
      m = fromColumns(this.floats(ob, ["obmat", "object_to_world"], 16));
    } else {
      m = this.local(ob);
      const parent = this.refOf(this.optPtr(ob, ["parent"]), "Object");
      if (parent && depth < MAX_DEPTH && (this.num(ob, ["partype"]) & PARTYPE_MASK) === PAROBJECT) {
        m = mul(mul(this.world(parent, depth + 1), fromColumns(this.floats(ob, ["parentinv"], 16))), m);
      }
    }
    this.worlds.set(ob.at, m);
    return m;
  }

  /** An object's own transform: its location and deltas, then rotation, then scale and delta scale. */
  private local(ob: Ref): Mat {
    const loc = this.floats(ob, ["loc"], 3);
    const dloc = this.floats(ob, ["dloc"], 3);
    const size = this.floats(ob, ["size"], 3);
    const dscale = this.floats(ob, ["dscale"], 3);
    const mode = this.num(ob, ["rotmode"]);
    let rot: Mat;
    if (mode > 0) {
      rot = mul(eulerMat(this.floats(ob, ["drot"], 3), mode), eulerMat(this.floats(ob, ["rot"], 3), mode));
    } else if (mode === ROT_AXIS_ANGLE) {
      const ax = this.floats(ob, ["rotAxis"], 3);
      const dax = this.floats(ob, ["drotAxis"], 3);
      rot = mul(axisAngleMat(dax, this.num(ob, ["drotAngle"])), axisAngleMat(ax, this.num(ob, ["rotAngle"])));
    } else {
      const q = this.floats(ob, ["quat"], 4);
      const dq = this.floats(ob, ["dquat"], 4);
      rot = mul(quatMat(dq), quatMat(q));
    }
    const m = rot.slice();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 4 + c] *= size[c] * dscale[c];
    m[3] = loc[0] + dloc[0];
    m[7] = loc[1] + dloc[1];
    m[11] = loc[2] + dloc[2];
    return m;
  }

  // ---- mesh data -------------------------------------------------------------------------------

  /** A mesh's positions, faces and corners, and its face material indices, in the layout of each version. */
  private meshData(me: Ref): MeshData {
    const nv = this.num(me, ["totvert", "verts_num"]);
    const faces = this.num(me, ["totpoly", "faces_num"]);
    const nl = this.num(me, ["totloop", "corners_num"]);

    // positions: a float3 layer from 3.5 on, else each MVert's co
    const verts = new Float64Array(3 * nv);
    const pos = this.layer(me, ["vert_data", "vdata"], "position");
    if (pos) {
      if (pos.len < 12 * nv) throw damaged("vertex list");
      for (let i = 0; i < 3 * nv; i++) verts[i] = this.dv.getFloat32(pos.at + 4 * i, this.le);
    } else {
      const mv = this.optPtr(me, ["mvert"]);
      for (let v = 0; v < nv; v++) verts.set(this.floats(this.elem(mv, "MVert", v), ["co"], 3), 3 * v);
    }

    // faces: where each one's corners start, from 3.6 on (a file without them is a legacy one, MPoly and MLoop)
    const offsets = new Int32Array(faces + 1);
    const polyName = ["poly_offset_indices", "face_offset_indices"].find((n) => me.s.fields.has(n));
    const polys = polyName ? this.ptr(me, [polyName]) : 0;
    const legacy = polys === 0;
    const mpoly = legacy ? this.optPtr(me, ["mpoly"]) : 0;
    if (!legacy) {
      offsets.set(this.ints(this.raw(polys), faces + 1));
    } else {
      for (let f = 0; f < faces; f++) offsets[f] = this.num(this.elem(mpoly, "MPoly", f), ["loopstart"]);
      offsets[faces] = nl;
    }

    // corners: the vertex each one is at, from the ".corner_vert" layer, else MLoop.v
    const cv = this.layer(me, ["corner_data", "ldata"], ".corner_vert");
    let corners: Int32Array;
    if (cv) {
      corners = this.ints(cv, nl);
    } else {
      corners = new Int32Array(nl);
      const ml = legacy ? this.optPtr(me, ["mloop"]) : 0;
      for (let c = 0; c < nl; c++) corners[c] = this.num(this.elem(ml, "MLoop", c), ["v"]);
    }

    // material slots per face: the "material_index" layer, else MPoly.mat_nr
    const mi = this.layer(me, ["face_data", "pdata"], "material_index");
    let mats: Int32Array | null = null;
    if (mi) {
      mats = this.ints(mi, faces);
    } else if (legacy && mpoly) {
      mats = new Int32Array(faces);
      for (let f = 0; f < faces; f++) mats[f] = this.num(this.elem(mpoly, "MPoly", f), ["mat_nr"]);
    }
    return { nv, faces, verts, offsets, corners, mats };
  }

  /** The data of a named layer in a CustomData field (vdata, ldata, pdata and their later names). */
  private layer(me: Ref, cd: string[], name: string): Raw | null {
    if (!this.has(me, cd)) return null;
    const data = this.sub(me, cd);
    const list = this.ptr(data, ["layers"]);
    const n = this.num(data, ["totlayer"]);
    const ls = this.struct("CustomDataLayer");
    for (let i = 0; i < n; i++) {
      const lr = this.refOf(list + i * ls.size, "CustomDataLayer");
      if (!lr) break;
      if (this.str(lr, ["name"]) === name) return this.raw(this.ptr(lr, ["data"]));
    }
    return null;
  }

  /** `count` int32s from a run of data. */
  private ints(r: Raw | null, count: number): Int32Array {
    const out = new Int32Array(count);
    if (count === 0) return out;
    if (!r || r.len < 4 * count) throw damaged("mesh data");
    for (let i = 0; i < count; i++) out[i] = this.dv.getInt32(r.at + 4 * i, this.le);
    return out;
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A linear channel as sRGB (the transfer curve of an sRGB picker), 0..1. */
function toSrgb(v: number): number {
  const c = clamp01(v);
  return clamp01(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
}

// ---- matrices --------------------------------------------------------------------------------

/** Blender's matrices are stored column by column (m[col * 4 + row]); this reads one row by row. */
function fromColumns(a: ArrayLike<number>): Mat {
  const m = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) m[r * 4 + c] = a[c * 4 + r];
  return m;
}

/** The identity matrix. */
const IDENT: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a times b. */
function mul(a: Mat, b: Mat): Mat {
  const m = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      m[r * 4 + c] = s;
    }
  }
  return m;
}

/** A rotation about the x (0), y (1) or z (2) axis, by an angle in radians. */
function rotAbout(axis: number, angle: number): Mat {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (axis === 0) return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  if (axis === 1) return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Euler angles in a mode (1 to 6): the first axis turns first, each turn about the world axes. */
function eulerMat(e: number[], mode: number): Mat {
  const [a, b, c] = EULER_ORDER[(mode - 1) % 6];
  return mul(rotAbout(c, e[c]), mul(rotAbout(b, e[b]), rotAbout(a, e[a])));
}

/** A quaternion (w, x, y, z) as a matrix; zero is taken as no rotation. */
function quatMat(q: number[]): Mat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  const [w, x, y, z] = n > 0 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [1, 0, 0, 0];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0,
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0,
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

/** An axis and an angle (radians) as a matrix; a zero axis is no rotation. */
function axisAngleMat(ax: number[], angle: number): Mat {
  const n = Math.hypot(ax[0], ax[1], ax[2]);
  if (n === 0) return IDENT;
  const [x, y, z] = [ax[0] / n, ax[1] / n, ax[2] / n];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
}
