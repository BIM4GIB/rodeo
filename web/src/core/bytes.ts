// Byte-level helpers for the .vwx format.
//
// Vectorworks stores almost everything little-endian; the outer container
// header is the exception (u32be accessors below). Offsets are relative to the
// start of the view passed in, not to the underlying ArrayBuffer.

const UTF16LE = new TextDecoder("utf-16le", { ignoreBOM: true });

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** where a float or a 64-bit integer is copied to be read or written */
const SCRATCH = new Uint8Array(8);
const SCRATCH_VIEW = new DataView(SCRATCH.buffer);

/**
 * Whether `size` bytes at the whole offset `off` lie inside `b`. Those are read and written byte by
 * byte, with no DataView made for each (a big drawing's edits spent seconds making them); any
 * other offset goes through a DataView as before, which reads it, or throws, as it always did.
 */
function inside(b: Uint8Array, off: number, size: number): boolean {
  return off >>> 0 === off && off + size <= b.length;
}

function scratch(b: Uint8Array, off: number, size: number): DataView {
  for (let i = 0; i < size; i++) SCRATCH[i] = b[off + i];
  return SCRATCH_VIEW;
}

export function u16(b: Uint8Array, off: number): number {
  return inside(b, off, 2) ? b[off] | (b[off + 1] << 8) : view(b).getUint16(off, true);
}

export function i16(b: Uint8Array, off: number): number {
  return inside(b, off, 2) ? ((b[off] | (b[off + 1] << 8)) << 16) >> 16 : view(b).getInt16(off, true);
}

export function u32(b: Uint8Array, off: number): number {
  return inside(b, off, 4) ? (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0 : view(b).getUint32(off, true);
}

export function i32(b: Uint8Array, off: number): number {
  return inside(b, off, 4) ? b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24) : view(b).getInt32(off, true);
}

export function u64(b: Uint8Array, off: number): bigint {
  return inside(b, off, 8) ? scratch(b, off, 8).getBigUint64(0, true) : view(b).getBigUint64(off, true);
}

export function f64(b: Uint8Array, off: number): number {
  return inside(b, off, 8) ? scratch(b, off, 8).getFloat64(0, true) : view(b).getFloat64(off, true);
}

export function f32(b: Uint8Array, off: number): number {
  return inside(b, off, 4) ? scratch(b, off, 4).getFloat32(0, true) : view(b).getFloat32(off, true);
}

export function setU16(b: Uint8Array, off: number, v: number): void {
  view(b).setUint16(off, v, true);
}

export function setI16(b: Uint8Array, off: number, v: number): void {
  view(b).setInt16(off, v, true);
}

export function setU32(b: Uint8Array, off: number, v: number): void {
  view(b).setUint32(off, v, true);
}

export function setI32(b: Uint8Array, off: number, v: number): void {
  view(b).setInt32(off, v, true);
}

export function setU64(b: Uint8Array, off: number, v: bigint): void {
  view(b).setBigUint64(off, v, true);
}

export function setF64(b: Uint8Array, off: number, v: number): void {
  if (!inside(b, off, 8)) return view(b).setFloat64(off, v, true);
  SCRATCH_VIEW.setFloat64(0, v, true);
  for (let i = 0; i < 8; i++) b[off + i] = SCRATCH[i];
}

export function setF32(b: Uint8Array, off: number, v: number): void {
  view(b).setFloat32(off, v, true);
}

export function u32be(b: Uint8Array, off: number): number {
  return view(b).getUint32(off, false);
}

export function setU32be(b: Uint8Array, off: number, v: number): void {
  view(b).setUint32(off, v, false);
}

/** UTF-16LE text of `byteLen` bytes at `off`. A leading BOM is kept, as in Python. */
export function readUtf16(b: Uint8Array, off: number, byteLen: number): string {
  return UTF16LE.decode(b.subarray(off, off + byteLen));
}

/** UTF-16LE encoding of `s`: no BOM, no terminator. */
export function encodeUtf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c & 0xff;
    out[2 * i + 1] = c >>> 8;
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Latin-1 string from `start` up to `end`, stopping at the first 0 byte. */
export function readAscii(b: Uint8Array, start: number, end: number): string {
  let s = "";
  const stop = Math.min(end, b.length);
  for (let i = start; i < stop; i++) {
    const c = b[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (as PNG chunks and zip entries use it) of `b`. */
export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
