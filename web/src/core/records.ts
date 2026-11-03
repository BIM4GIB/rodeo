// Record stream: length-prefixed object records forming a pre-order tree.
// Port of openvwx/records.py.
//
// Every record starts with a 0x50-byte common header (little-endian):
//   +0x00  u64   record size, including this header
//   +0x08  u64   next-sibling marker: 0 = last item of its list, else NEXT_MARK
//   +0x10  u64   saved memory pointer (preserved)
//   +0x19  u8    object type (TYPE_NAMES)
//   +0x1a  u16   name index into the name table (type 55), 0 = unnamed
//   +0x20  u32   class index into the name table
//   +0x26  u64   owner pointer: address of the parent at save time (unaligned)
//   +0x38  16B   object GUID (UUID with little-endian first three groups)
//   +0x50  ...   type-specific body
//
// The tree is implicit. Records are written in pre-order: a parent, its aux
// records, its children, then a type-0 terminator for containers.

import { concat, setU16, setU32, setU64, u16, u32, u64 } from "./bytes.ts";

export const TYPE_NAMES: Record<number, string> = {
  0: "terminator",
  2: "line",
  3: "rectangle",
  5: "polygon",
  6: "arc",
  10: "text",
  11: "group",
  13: "rounded-rectangle",
  14: "image",
  15: "symbol",
  16: "symbol-definition",
  17: "locus",
  21: "polyline",
  24: "extrude",
  9: "3d-locus",
  25: "3d-polygon",
  31: "layer",
  34: "sweep",
  38: "multiple-extrude",
  40: "mesh",
  47: "record-format",
  54: "symbol-library",
  55: "name-table",
  57: "class-list",
  68: "wall",
  71: "slab",
  76: "aux-data",
  80: "layer-list-header",
  81: "light",
  84: "solid",
  86: "plug-in-object",
  92: "symbol-folder",
  94: "class",
  101: "drop-shadow",
  113: "generic-solid",
  119: "preview-image",

  122: "viewport",};

/** Value written at +0x08 when a record has a next sibling. */
export const NEXT_MARK = 0x05792ca4n;

function hex(n: number): string {
  return "0x" + n.toString(16);
}

/** Reorder the first three UUID groups between RFC order and bytes_le order.
 *  The permutation is its own inverse. */
function swapGuidGroups(src: Uint8Array): Uint8Array {
  return Uint8Array.of(
    src[3], src[2], src[1], src[0],
    src[5], src[4], src[7], src[6],
    src[8], src[9], src[10], src[11], src[12], src[13], src[14], src[15],
  );
}

function uuidString(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += u[i].toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s;
}

function parseUuid(text: string): Uint8Array {
  const digits = text.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(digits)) throw new Error(`invalid GUID: ${text}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export class Rec {
  data: Uint8Array;
  index: number;
  parent: Rec | null = null;
  children: Rec[] = [];

  constructor(data: Uint8Array, index = 0) {
    this.data = data;
    this.index = index;
  }

  get type(): number {
    return this.data[0x19];
  }

  get typeName(): string {
    return TYPE_NAMES[this.type] ?? `type-${this.type}`;
  }

  get size(): number {
    return this.data.length;
  }

  get nameIndex(): number {
    return u16(this.data, 0x1a);
  }

  set nameIndex(v: number) {
    setU16(this.data, 0x1a, v);
  }

  get classIndex(): number {
    return u32(this.data, 0x20);
  }

  set classIndex(v: number) {
    setU32(this.data, 0x20, v);
  }

  get owner(): bigint {
    return u64(this.data, 0x26);
  }

  set owner(v: bigint) {
    setU64(this.data, 0x26, v);
  }

  get ptr10(): bigint {
    return u64(this.data, 0x10);
  }

  set ptr10(v: bigint) {
    setU64(this.data, 0x10, v);
  }

  get hasNext(): boolean {
    return u64(this.data, 0x08) !== 0n;
  }

  set hasNext(v: boolean) {
    setU64(this.data, 0x08, v ? NEXT_MARK : 0n);
  }

  get guid(): string {
    return uuidString(swapGuidGroups(this.data.subarray(0x38, 0x48)));
  }

  set guid(v: string) {
    this.data.set(swapGuidGroups(parseUuid(v)), 0x38);
  }

  /** Pre-order traversal: self, then children recursively. */
  *walk(): Generator<Rec> {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

/** Split the decompressed stream into flat records. Each record owns a copy of its bytes. */
export function splitRecords(raw: Uint8Array): Rec[] {
  const out: Rec[] = [];
  let pos = 0;
  while (pos < raw.length) {
    if (pos + 8 > raw.length) throw new Error(`truncated record header at stream offset ${hex(pos)}`);
    const size = Number(u64(raw, pos));
    if (size < 0x50 || pos + size > raw.length) {
      throw new Error(`bad record size ${size} at stream offset ${hex(pos)}`);
    }
    out.push(new Rec(raw.slice(pos, pos + size), out.length));
    pos += size;
  }
  return out;
}

/** Link parent/children from owner pointers. Returns the top-level records. */
export function buildTree(recs: Rec[]): Rec[] {
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    rec.index = i;
    rec.parent = null;
    rec.children = [];
  }

  const roots: Rec[] = [];
  const stack: Array<{ owner: bigint; parent: Rec | null }> = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const owner = rec.owner;
    if (stack.length > 0 && stack[stack.length - 1].owner === owner) {
      // sibling of the current list
    } else if (stack.some((e) => e.owner === owner)) {
      while (stack[stack.length - 1].owner !== owner) stack.pop();
    } else {
      // a new owner opens a list whose parent is the record just before it
      stack.push({ owner, parent: i > 0 ? recs[i - 1] : null });
    }
    const parent = stack[stack.length - 1].parent;
    rec.parent = parent;
    if (parent) parent.children.push(rec);
    else roots.push(rec);
    if (rec.type === 0) stack.pop();
  }
  return roots;
}

/** Concatenate records after writing each u64 size field to the record's length. */
export function joinRecords(recs: Rec[]): Uint8Array {
  for (const r of recs) setU64(r.data, 0, BigInt(r.data.length));
  return concat(recs.map((r) => r.data));
}

/** Random version-4 GUID in the same string format as Rec.guid. */
export function newGuid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return uuidString(b);
}
