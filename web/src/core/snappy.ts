// Raw Snappy block codec (https://github.com/google/snappy/blob/main/format_description.txt).
// Port of openvwx/snappy.py: one block per call, no framing.

function hex(n: number): string {
  return "0x" + n.toString(16);
}

function need(buf: Uint8Array, pos: number, count: number): void {
  if (pos + count > buf.length) throw new Error(`truncated snappy block at ${hex(pos)}`);
}

function readLE(buf: Uint8Array, pos: number, count: number): number {
  let v = 0;
  for (let k = count - 1; k >= 0; k--) v = v * 256 + buf[pos + k];
  return v;
}

/** Decode one raw Snappy block starting at `pos`. Returns the data and the position after it. */
export function decompress(buf: Uint8Array, pos = 0): { data: Uint8Array; end: number } {
  const { size, start } = blockLength(buf, pos);
  const data = new Uint8Array(size);
  return { data, end: decompressInto(buf, start, data) };
}

/** The length the raw Snappy block at `pos` decodes to, and where its tags start. */
export function blockLength(buf: Uint8Array, pos = 0): { size: number; start: number } {
  // uncompressed length: little-endian base-128 varint
  let size = 0;
  let scale = 1;
  for (;;) {
    need(buf, pos, 1);
    const b = buf[pos++];
    size += (b & 0x7f) * scale;
    if (b < 0x80) break;
    scale *= 0x80;
  }
  return { size, start: pos };
}

/** Decode a block's tags, from `pos` (blockLength's start), into all of `out` (its size). Returns the position after the block. */
export function decompressInto(buf: Uint8Array, pos: number, out: Uint8Array): number {
  const size = out.length;
  let op = 0;
  while (op < size) {
    need(buf, pos, 1);
    const tag = buf[pos++];
    const kind = tag & 3;

    if (kind === 0) {
      // literal
      let len = tag >>> 2;
      if (len >= 60) {
        const nbytes = len - 59;
        need(buf, pos, nbytes);
        len = readLE(buf, pos, nbytes);
        pos += nbytes;
      }
      len += 1;
      need(buf, pos, len);
      if (op + len > size) throw new Error("snappy block decoded to the wrong length");
      out.set(buf.subarray(pos, pos + len), op);
      op += len;
      pos += len;
      continue;
    }

    let len: number;
    let offset: number;
    if (kind === 1) {
      need(buf, pos, 1);
      len = ((tag >>> 2) & 7) + 4;
      offset = ((tag >>> 5) << 8) | buf[pos];
      pos += 1;
    } else if (kind === 2) {
      need(buf, pos, 2);
      len = (tag >>> 2) + 1;
      offset = buf[pos] | (buf[pos + 1] << 8);
      pos += 2;
    } else {
      need(buf, pos, 4);
      len = (tag >>> 2) + 1;
      offset = readLE(buf, pos, 4);
      pos += 4;
    }
    if (offset === 0 || offset > op) {
      throw new Error(`corrupt snappy copy (offset ${offset}) at ${hex(pos)}`);
    }
    if (op + len > size) throw new Error("snappy block decoded to the wrong length");

    const src = op - offset;
    if (offset >= len) {
      out.copyWithin(op, src, src + len); // source and destination do not overlap
    } else {
      // overlapping copy repeats the last `offset` bytes
      for (let k = 0; k < len; k++) out[op + k] = out[src + k];
    }
    op += len;
  }
  return pos;
}

/** Growable output buffer. */
class Sink {
  private buf: Uint8Array;
  private len = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(Math.max(64, capacity));
  }

  private reserve(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  byte(v: number): void {
    if (this.len >= this.buf.length) this.reserve(1);
    this.buf[this.len++] = v;
  }

  bytes(src: Uint8Array, start: number, end: number): void {
    this.reserve(end - start);
    this.buf.set(src.subarray(start, end), this.len);
    this.len += end - start;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function emitLiteral(out: Sink, data: Uint8Array, start: number, end: number): void {
  const n = end - start - 1;
  if (n < 60) {
    out.byte(n << 2);
  } else {
    let nbytes = 0;
    for (let t = n; t > 0; t = Math.floor(t / 256)) nbytes++;
    out.byte((59 + nbytes) << 2);
    for (let k = 0; k < nbytes; k++) out.byte(Math.floor(n / 256 ** k) & 0xff);
  }
  out.bytes(data, start, end);
}

function emitCopy(out: Sink, offset: number, length: number): void {
  while (length > 0) {
    let n = Math.min(length, 64);
    // never leave a remainder shorter than 4 bytes
    if (length - n > 0 && length - n < 4) n = length - 4;
    if (n >= 4 && n <= 11 && offset < 2048) {
      out.byte(1 | ((n - 4) << 2) | ((offset >>> 8) << 5));
      out.byte(offset & 0xff);
    } else {
      out.byte(2 | ((n - 1) << 2));
      out.byte(offset & 0xff);
      out.byte((offset >>> 8) & 0xff);
    }
    length -= n;
  }
}

/** Encode `data` as one raw Snappy block (greedy matcher, 4-byte hash, 64 KiB window). */
export function compress(data: Uint8Array): Uint8Array {
  const n = data.length;
  const out = new Sink(n / 2 + 64);

  let v = n;
  while (v >= 0x80) {
    out.byte((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.byte(v);

  const table = new Int32Array(1 << 16); // stores position + 1; 0 = empty
  const limit = n - 4;
  let lit = 0;
  let i = 0;
  while (i <= limit) {
    const word = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    const h = Math.imul(word, 0x1e35a7bd) >>> 16;
    const cand = table[h] - 1;
    table[h] = i + 1;
    if (
      cand >= 0 &&
      i - cand <= 0xffff &&
      data[cand] === data[i] &&
      data[cand + 1] === data[i + 1] &&
      data[cand + 2] === data[i + 2] &&
      data[cand + 3] === data[i + 3]
    ) {
      let j = 4;
      while (i + j < n && data[cand + j] === data[i + j]) j++;
      if (lit < i) emitLiteral(out, data, lit, i);
      emitCopy(out, i - cand, j);
      i += j;
      lit = i;
    } else {
      i++;
    }
  }
  if (lit < n) emitLiteral(out, data, lit, n);
  return out.finish();
}
