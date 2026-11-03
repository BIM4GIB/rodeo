// An object's RenderWorks texture settings, as Object Info's Render tab shows them: a "TDMD" aux
// record (76) of kind "ttwr", a typed dictionary (FORMAT.md §7.1) holding one value per texture
// part under each key:
//   1  i32 the part's id: 3 the whole object; walls, slabs, solids and some plug-ins hold
//      further parts (their names in Vectorworks aren't known here)
//   2  i32 0
//   3  i32 the texture: a texture's name index, 0 the class's, -1 none
//   4  byte (no fixed meaning found: often 0xcd, a fill for memory never written)
//   5  i32 the mapping method, as Vectorworks numbers it (0, 3 and 7 in the demo files)
//   6  6 × f64: offset along the texture's width and height (mm), scale across and up, rotation
//      (radians), and a length
//   7  12 × f64: the mapping's three axes and its origin
//   8  i32 0 (one value whatever the part count; some dictionaries lack it)
// A dictionary can hold no parts (key 8 alone). Its directory has one spare zero entry after the
// last, and the values end 6 zero bytes before the record does, where the u32 at +0x5c says.

import { concat, f64, i32, setF64, setI32, setU16, setU32, u16, u32 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { TexturePart, TexturePartChange } from "./types.ts";

const AUX = 76;
const TAG = 0x50;
const VERSION = 0x54;
const KIND = 0x56;
const COUNT = 0x5a;
const END = 0x5c;
const BASE = 0x60;
const I32 = 8;
const BYTE = 1;
const F64 = 6;

const K_PART = 1;
const K_ZERO = 2;
const K_TEXTURE = 3;
const K_FLAG = 4;
const K_MAPPING = 5;
const K_PLACE = 6;
const K_AXES = 7;
const K_TAIL = 8;
const PLACE = 6;

/** The part id of the whole object. */
export const OVERALL = 3;

/** 3D objects that take a texture when they have no settings record yet: extrudes, 3D polygons, sweeps, multiple extrudes, meshes, slabs and solids. */
export const TAKES_TEXTURE: ReadonlySet<number> = new Set([24, 25, 34, 38, 40, 71, 84, 113]);

/** A part as a new dictionary is written: what key 4 and the mapping start as. */
export interface NewPart {
  part: number;
  texture: number;
  flag: number;
  mapping: number;
}

interface Entry {
  type: number;
  count: number;
  /** where the values start in the record */
  at: number;
}

function text(d: Uint8Array, at: number): string {
  return String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);
}

/** True for an object's texture settings record. */
export function isTextureDict(r: Rec): boolean {
  const d = r.data;
  return r.type === AUX && d.length >= BASE && text(d, TAG) === "TDMD" && text(d, KIND) === "ttwr";
}

/** The object's texture settings record, if it has one. */
export function textureDict(r: Rec): Rec | null {
  return r.children.find(isTextureDict) ?? null;
}

function entries(d: Uint8Array): Map<number, Entry> {
  const out = new Map<number, Entry>();
  const n = u16(d, COUNT);
  for (let i = 0; i < n && BASE + 6 * i + 6 <= d.length; i++) {
    const at = BASE + u32(d, BASE + 6 * i + 2);
    if (at + 6 > d.length) continue;
    out.set(u16(d, BASE + 6 * i), { type: u16(d, at), count: u32(d, at + 2), at: at + 6 });
  }
  return out;
}

const SIZE: Record<number, number> = { [I32]: 4, [BYTE]: 1, [F64]: 8 };

/** The keys holding one value per part (`per` of them), checked to fit the record; null when they don't. */
function partEntries(d: Uint8Array): { n: number; e: Map<number, Entry> } | null {
  const e = entries(d);
  const tex = e.get(K_TEXTURE);
  if (!tex) return { n: 0, e };
  const n = tex.count;
  const want: [number, number, number][] = [
    [K_PART, I32, 1],
    [K_TEXTURE, I32, 1],
    [K_MAPPING, I32, 1],
    [K_PLACE, F64, PLACE],
  ];
  for (const [key, type, per] of want) {
    const x = e.get(key);
    if (!x || x.type !== type || x.count !== n * per || x.at + x.count * SIZE[type] > d.length) return null;
  }
  return { n, e };
}

/** The parts of a texture settings record (none when it holds none or doesn't read). */
export function readTextureParts(d: Uint8Array): TexturePart[] {
  const pe = partEntries(d);
  if (!pe) return [];
  const { n, e } = pe;
  const v = (key: number, i: number): number => i32(d, e.get(key)!.at + 4 * i);
  const place = (i: number, j: number): number => f64(d, e.get(K_PLACE)!.at + 8 * (PLACE * i + j));
  const out: TexturePart[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      part: v(K_PART, i),
      texture: v(K_TEXTURE, i),
      mapping: v(K_MAPPING, i),
      offsetU: place(i, 0),
      offsetV: place(i, 1),
      scaleU: place(i, 2),
      scaleV: place(i, 3),
      rotation: (place(i, 4) * 180) / Math.PI,
    });
  }
  return out;
}

/** True when the record holds parts (they may not read). */
export function holdsParts(d: Uint8Array): boolean {
  return entries(d).has(K_TEXTURE);
}

/** Key 4 and the mapping of a record holding the whole object's part alone, for a new one to start as. */
export function partLike(d: Uint8Array): { flag: number; mapping: number } | null {
  const pe = partEntries(d);
  const flag = pe?.e.get(K_FLAG);
  if (!pe || pe.n !== 1 || !flag || flag.type !== BYTE || flag.count !== 1 || i32(d, pe.e.get(K_PART)!.at) !== OVERALL) return null;
  return { flag: d[flag.at], mapping: i32(d, pe.e.get(K_MAPPING)!.at) };
}

/** Writes `change` to part `part` of the record `d` in place; false when it has no such part. */
export function writeTexturePart(d: Uint8Array, part: number, change: TexturePartChange): boolean {
  const pe = partEntries(d);
  if (!pe) return false;
  const { n, e } = pe;
  let i = 0;
  while (i < n && i32(d, e.get(K_PART)!.at + 4 * i) !== part) i++;
  if (i === n) return false;
  if (change.texture !== undefined) setI32(d, e.get(K_TEXTURE)!.at + 4 * i, change.texture);
  const place = (j: number, v: number | undefined): void => {
    if (v !== undefined) setF64(d, e.get(K_PLACE)!.at + 8 * (PLACE * i + j), v);
  };
  place(0, change.offsetU);
  place(1, change.offsetV);
  place(2, change.scaleU);
  place(3, change.scaleV);
  place(4, change.rotation === undefined ? undefined : (change.rotation * Math.PI) / 180);
  return true;
}

/** Key 8's values of a record, to keep when it is rewritten with parts. */
export function tailValues(d: Uint8Array): number[] {
  const x = entries(d).get(K_TAIL);
  if (!x || x.type !== I32 || x.at + 4 * x.count > d.length) return [0];
  return Array.from({ length: x.count }, (_, i) => i32(d, x.at + 4 * i));
}

/**
 * A texture settings record's body (from +0x50) with `parts`, each unmoved, at scale 1 and turned
 * by 0, with the length Vectorworks gives new parts (1000) and its mapping axes the drawing's.
 */
export function newTextureDict(parts: readonly NewPart[], tail: readonly number[], place?: readonly (readonly number[])[], axes?: readonly (readonly number[])[]): Uint8Array {
  return newDict("ttwr", [
    [K_PART, I32, parts.map((p) => p.part)],
    [K_ZERO, I32, parts.map(() => 0)],
    [K_TEXTURE, I32, parts.map((p) => p.texture)],
    [K_FLAG, BYTE, parts.map((p) => p.flag)],
    [K_MAPPING, I32, parts.map((p) => p.mapping)],
    [K_PLACE, F64, parts.flatMap((_, i) => place?.[i] ?? [0, 0, 1, 1, 0, 1000])],
    [K_AXES, F64, parts.flatMap((_, i) => axes?.[i] ?? IDENTITY)],
    [K_TAIL, I32, tail],
  ]);
}

/** The part a mesh's UV-mapped texture is in, as the demos' plants have it. */
export const UV_PART = 4;
/** The mapping method that places a texture by each vertex's (u, v). */
export const UV_MAPPING = 5;

/**
 * A mesh's texture settings (from +0x50) with its texture `texture` mapped by UV: an empty
 * whole-object part and the texture in a part of its own, as the demos' plants have them.
 */
export function newUvTextureDict(texture: number): Uint8Array {
  return newTextureDict(
    [
      { part: OVERALL, texture: -1, flag: 12, mapping: 0 },
      { part: UV_PART, texture, flag: 77, mapping: UV_MAPPING },
    ],
    [0],
  );
}

/**
 * A mesh's UV map (from +0x50), a "TeMe" dictionary (stored "eMeT"): key 1 a normal per vertex,
 * key 2 (u, v) per vertex, key 3 each face's texture part, front and back. Keys 4, 5 and 7 hold
 * what every UV map in the demos does (3, 50 and an unturned frame at the origin, meanings not
 * known); key 6 the vertex count, then two numbers whose meaning isn't known (0 here).
 */
export function newUvMapDict(normals: readonly number[], uvs: readonly number[], faces: number): Uint8Array {
  return newDict("eMeT", [
    [1, F64, normals],
    [2, F64, uvs],
    [3, I32, new Array<number>(2 * faces).fill(UV_PART)],
    [4, I32, [3]],
    [5, F64, [50]],
    [6, F64, [uvs.length / 2, 0, 0]],
    [7, F64, IDENTITY],
  ]);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** A typed dictionary's body (from +0x50) of kind `kind` (as stored) holding `values` by key. */
function newDict(kind: string, values: readonly (readonly [number, number, readonly number[]])[]): Uint8Array {
  const dir = 6 * (values.length + 1);
  const blocks = values.map(([, type, vs]) => {
    const b = new Uint8Array(6 + vs.length * SIZE[type]);
    setU16(b, 0, type);
    setU32(b, 2, vs.length);
    vs.forEach((v, i) => {
      if (type === I32) setI32(b, 6 + 4 * i, v);
      else if (type === F64) setF64(b, 6 + 8 * i, v);
      else b[6 + i] = v;
    });
    return b;
  });
  const head = new Uint8Array(0x10 + dir);
  head.set([..."TDMD"].map((c) => c.charCodeAt(0)), 0);
  setU16(head, VERSION - TAG, 5);
  head.set([...kind].map((c) => c.charCodeAt(0)), KIND - TAG);
  setU16(head, COUNT - TAG, values.length);
  let off = dir;
  values.forEach(([key], i) => {
    setU16(head, 0x10 + 6 * i, key);
    setU32(head, 0x10 + 6 * i + 2, off);
    off += blocks[i].length;
  });
  setU32(head, END - TAG, off);
  return concat([head, ...blocks, new Uint8Array(6)]);
}
