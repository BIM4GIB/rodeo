// The objects of an Archicad 17+ file (the container is read by ../pln.ts), gathered by class, and
// a cursor for reading their payloads. Every object's payload starts with its class GUID (16 bytes,
// the same in every Archicad version), then a 23-byte header (02 00 00, a u32 sequence number, 4
// zero bytes, a u32 stamp, 4 zero bytes, a u32), then the class's own data, which starts with the
// versions of the class and the classes it is built on and so moves from version to version. Most
// objects sit in compressed groups, so a whole read expands every group. Coordinates are metres.

import { allocation, allocationPayload, blocksIn, expandGroup, FIRST, groupLength, isAllocation, isGroup, isRof, SYSTEM_TAG, Windowed, type ReadRange } from "../pln.ts";

/** One object: its GUID (hex as stored) and its payload, the class GUID first. */
export interface ArchicadObject {
  readonly guid: string;
  readonly data: Uint8Array;
}

/** Objects by class GUID (hex as stored). */
export type ObjectsByClass = ReadonlyMap<string, readonly ArchicadObject[]>;

/** Where the class's own data starts: after the class GUID and the object header. */
export const OBJECT_DATA = 39;

export function hex(b: Uint8Array, o: number, n: number): string {
  let s = "";
  for (let i = o; i < o + n; i++) s += (b[i] ?? 0).toString(16).padStart(2, "0");
  return s;
}

export const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
export const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const i32 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
export function f64(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);
}

/** A length-prefixed UTF-16 string at `o` (01 00, a u32 count of code units, the units), and where it ends; null when there isn't one. */
export function utf16At(d: Uint8Array, o: number): { text: string; end: number } | null {
  if (o + 6 > d.length || d[o] !== 1 || d[o + 1] !== 0) return null;
  const n = u32(d, o + 2);
  const end = o + 6 + 2 * n;
  if (n > 1 << 20 || end > d.length) return null;
  let text = "";
  for (let p = o + 6; p < end; p += 2) text += String.fromCharCode(u16(d, p));
  return { text, end };
}

/** Reads a payload in order, every read checked against its end. */
export class Cursor {
  constructor(
    readonly d: Uint8Array,
    public at = 0,
  ) {}

  get left(): number {
    return this.d.length - this.at;
  }

  private need(n: number): number {
    if (this.at + n > this.d.length) throw new Error(`an object ends early (${n} bytes wanted at ${this.at} of ${this.d.length})`);
    const at = this.at;
    this.at += n;
    return at;
  }

  skip(n: number): this {
    this.need(n);
    return this;
  }
  u8(): number {
    return this.d[this.need(1)];
  }
  u16(): number {
    return u16(this.d, this.need(2));
  }
  u32(): number {
    return u32(this.d, this.need(4));
  }
  i32(): number {
    return i32(this.d, this.need(4));
  }
  f64(): number {
    return f64(this.d, this.need(8));
  }
  guid(): string {
    return hex(this.d, this.need(16), 16);
  }
  /** a length-prefixed UTF-16 string (01 00, u32 count, units) */
  utf16(): string {
    const s = utf16At(this.d, this.at);
    if (!s) throw new Error(`no string at ${this.at}`);
    this.at = s.end;
    return s.text;
  }
}

/** The objects of the wanted classes (all, when `wanted` is null) among the allocations held in `b`, expanding groups. */
function gather(b: Uint8Array, from: number, wanted: ReadonlySet<string> | null, into: Map<string, ArchicadObject[]>): void {
  for (const block of blocksIn(b, from)) {
    if (block.group) {
      gather(expandGroup(b, block.at), 0, wanted, into);
      continue;
    }
    if (block.tag >= SYSTEM_TAG) continue;
    take(b, block.at, wanted, into);
  }
}

function take(b: Uint8Array, at: number, wanted: ReadonlySet<string> | null, into: Map<string, ArchicadObject[]>): void {
  const head = allocationPayload(b, at, 16);
  if (!head || head.length < 16) return;
  const cls = hex(head, 0, 16);
  if (wanted && !wanted.has(cls)) return;
  const data = allocationPayload(b, at);
  if (!data) return;
  let list = into.get(cls);
  if (!list) into.set(cls, (list = []));
  list.push({ guid: hex(b, at + 11, 16), data });
}

/** The objects of a whole file held in memory (Node checks), by class; only the wanted classes when given. */
export function objectsInFile(file: Uint8Array, wanted: ReadonlySet<string> | null = null): Map<string, ArchicadObject[]> {
  if (!isRof(file)) throw new Error("not an Archicad 17 or later file");
  const into = new Map<string, ArchicadObject[]>();
  gather(file, FIRST, wanted, into);
  return into;
}

/**
 * The objects of the wanted classes in a file of `size` bytes read by ranges, every compressed
 * group expanded; `progress` hears how far through the file the walk is (0..1).
 */
export async function readObjects(read: ReadRange, size: number, wanted: ReadonlySet<string> | null, progress?: (fraction: number) => void): Promise<Map<string, ArchicadObject[]>> {
  const file = new Windowed(read, size);
  if (!isRof(await file.at(0, 8))) throw new Error("not an Archicad 17 or later file");
  const into = new Map<string, ArchicadObject[]>();
  let pos = FIRST;
  let step = 0;
  while (pos + 16 <= size) {
    const head = await file.at(pos, Math.min(96, size - pos));
    if (isAllocation(head, 0)) {
      const { bytes, tag } = allocation(head, 0);
      if (!bytes) break;
      if (tag < SYSTEM_TAG && pos + bytes <= size) take(await file.at(pos, bytes), 0, wanted, into);
      pos += bytes;
    } else if (isGroup(head, 0)) {
      const length = await groupLength(file, pos);
      gather(expandGroup(await file.at(pos, length), 0), 0, wanted, into);
      pos += length;
    } else pos += 16;
    if (progress && ++step % 256 === 0) progress(pos / size);
  }
  progress?.(1);
  return into;
}
