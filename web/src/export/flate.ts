// zlib streams (RFC 1950 and 1951), synchronously and with no dependencies, for the PDF writer's
// images: a PNG's pixels are read with inflate and written back with deflate once their alpha is
// split off, since a PDF image holds its colours and its transparency apart. Browsers only offer
// zlib as async streams, which the PDF writer, built in one pass, can't wait on.

/** order the code length code lengths are stored in */
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const MAX_BITS = 15;

// ---- inflate ------------------------------------------------------------------------------

/**
 * A Huffman code as a lookup table of 2^bits entries indexed by the next `bits` input bits
 * (least significant first, as deflate packs them): symbol << 4 | its code's length.
 */
interface Table {
  readonly bits: number;
  readonly entries: Uint32Array;
}

function table(lengths: ArrayLike<number>): Table {
  let bits = 0;
  const count = new Array<number>(MAX_BITS + 1).fill(0);
  for (let i = 0; i < lengths.length; i++) {
    count[lengths[i]]++;
    bits = Math.max(bits, lengths[i]);
  }
  count[0] = 0;
  const next = new Array<number>(MAX_BITS + 2).fill(0);
  for (let len = 1, code = 0; len <= MAX_BITS; len++) {
    code = (code + count[len - 1]) << 1;
    next[len] = code;
  }
  const size = Math.max(1, bits);
  const entries = new Uint32Array(1 << size);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len === 0) continue;
    const code = next[len]++;
    let rev = 0;
    for (let i = 0; i < len; i++) rev |= ((code >> i) & 1) << (len - 1 - i);
    for (let i = rev; i < entries.length; i += 1 << len) entries[i] = (sym << 4) | len;
  }
  return { bits: size, entries };
}

let fixedLit: Table | null = null;
let fixedDist: Table | null = null;

/** The bytes a zlib stream inflates to. Throws on a damaged or preset-dictionary stream. */
export function inflate(z: Uint8Array): Uint8Array {
  if (z.length < 2 || (z[0] & 0x0f) !== 8 || ((z[0] << 8) | z[1]) % 31 !== 0) throw new Error("not a zlib stream");
  if (z[1] & 0x20) throw new Error("the zlib stream needs a preset dictionary");
  let pos = 2;
  let buf = 0;
  let have = 0;
  const need = (n: number): void => {
    while (have < n) {
      if (pos >= z.length) throw new Error("the zlib stream ends early");
      buf |= z[pos++] << have;
      have += 8;
    }
  };
  const bits = (n: number): number => {
    need(n);
    const v = buf & ((1 << n) - 1);
    buf >>>= n;
    have -= n;
    return v;
  };
  const decode = (t: Table): number => {
    // the table is indexed by `t.bits` bits, which may run past the stream's end on its last code
    while (have < t.bits && pos < z.length) {
      buf |= z[pos++] << have;
      have += 8;
    }
    const e = t.entries[buf & ((1 << t.bits) - 1)];
    const len = e & 15;
    if (len === 0 || len > have) throw new Error("the zlib stream has a bad code");
    buf >>>= len;
    have -= len;
    return e >> 4;
  };

  let out = new Uint8Array(Math.max(1024, z.length * 4));
  let n = 0;
  const room = (k: number): void => {
    if (n + k <= out.length) return;
    let size = out.length * 2;
    while (size < n + k) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, n));
    out = bigger;
  };

  for (let last = 0; !last; ) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      // a stored block starts on a byte: drop the partial one, and give back whole bytes read ahead
      pos -= have >> 3;
      buf = 0;
      have = 0;
      if (pos + 4 > z.length) throw new Error("the zlib stream ends early");
      const len = z[pos] | (z[pos + 1] << 8);
      pos += 4;
      if (pos + len > z.length) throw new Error("the zlib stream ends early");
      room(len);
      out.set(z.subarray(pos, pos + len), n);
      n += len;
      pos += len;
      continue;
    }
    let lit: Table;
    let dist: Table;
    if (type === 1) {
      if (!fixedLit || !fixedDist) {
        const l = new Array<number>(288);
        l.fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
        fixedLit = table(l);
        fixedDist = table(new Array<number>(30).fill(5));
      }
      lit = fixedLit;
      dist = fixedDist;
    } else if (type === 2) {
      const nlit = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncl = bits(4) + 4;
      const cl = new Array<number>(19).fill(0);
      for (let i = 0; i < ncl; i++) cl[CL_ORDER[i]] = bits(3);
      const clTable = table(cl);
      const lengths: number[] = [];
      while (lengths.length < nlit + ndist) {
        const sym = decode(clTable);
        if (sym < 16) lengths.push(sym);
        else if (sym === 16) {
          if (lengths.length === 0) throw new Error("the zlib stream has a bad code");
          const prev = lengths[lengths.length - 1];
          for (let r = 3 + bits(2); r > 0; r--) lengths.push(prev);
        } else for (let r = sym === 17 ? 3 + bits(3) : 11 + bits(7); r > 0; r--) lengths.push(0);
      }
      if (lengths.length > nlit + ndist) throw new Error("the zlib stream has a bad code");
      lit = table(lengths.slice(0, nlit));
      dist = table(lengths.slice(nlit));
    } else throw new Error("the zlib stream has a bad block");

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        room(1);
        out[n++] = sym;
      } else if (sym === 256) break;
      else {
        const li = sym - 257;
        if (li >= 29) throw new Error("the zlib stream has a bad code");
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new Error("the zlib stream has a bad code");
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > n) throw new Error("the zlib stream reaches back too far");
        room(len);
        for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
      }
    }
  }
  return out.subarray(0, n);
}

// ---- deflate ------------------------------------------------------------------------------

const WINDOW = 32768;
const HASH_BITS = 15;
const MAX_MATCH = 258;
/** previous positions with the same three bytes that are tried for a match: speed over size */
const MAX_CHAIN = 24;
/** symbols per block, each block getting its own codes */
const BLOCK_SYMBOLS = 1 << 16;

/** Writes bits least significant first, as deflate packs them. */
class BitWriter {
  private out = new Uint8Array(1 << 16);
  private n = 0;
  private buf = 0;
  private have = 0;

  bits(v: number, count: number): void {
    this.buf |= v << this.have;
    this.have += count;
    while (this.have >= 8) {
      this.byte(this.buf & 0xff);
      this.buf >>>= 8;
      this.have -= 8;
    }
  }

  /** A Huffman code, which deflate stores most significant bit first. */
  code(code: number, len: number): void {
    let rev = 0;
    for (let i = 0; i < len; i++) rev |= ((code >> i) & 1) << (len - 1 - i);
    this.bits(rev, len);
  }

  byte(b: number): void {
    if (this.n === this.out.length) {
      const bigger = new Uint8Array(this.out.length * 2);
      bigger.set(this.out);
      this.out = bigger;
    }
    this.out[this.n++] = b;
  }

  finish(): Uint8Array {
    if (this.have > 0) this.byte(this.buf & 0xff);
    this.buf = 0;
    this.have = 0;
    return this.out.subarray(0, this.n);
  }
}

/**
 * Code lengths for symbol frequencies, none longer than `limit`: Huffman's, then any that are
 * too long cut to the limit and shorter ones lengthened until the code is complete again.
 */
function codeLengths(freq: readonly number[], limit: number): number[] {
  const lengths = new Array<number>(freq.length).fill(0);
  const used = freq.map((f, i) => (f > 0 ? i : -1)).filter((i) => i >= 0);
  if (used.length === 0) return lengths;
  if (used.length === 1) {
    lengths[used[0]] = 1;
    return lengths;
  }
  // nodes: leaves first, then the merged ones; a sorted queue is plenty for 30 to 286 symbols
  const weight: number[] = used.map((i) => freq[i]);
  const parent: number[] = used.map(() => -1);
  let queue = used.map((_, k) => k).sort((a, b) => weight[a] - weight[b]);
  while (queue.length > 1) {
    const [a, b] = queue;
    const node = weight.length;
    weight.push(weight[a] + weight[b]);
    parent.push(-1);
    parent[a] = node;
    parent[b] = node;
    queue = queue.slice(2);
    let at = queue.findIndex((q) => weight[q] > weight[node]);
    if (at < 0) at = queue.length;
    queue.splice(at, 0, node);
  }
  used.forEach((sym, k) => {
    let depth = 0;
    for (let p = parent[k]; p >= 0; p = parent[p]) depth++;
    lengths[sym] = Math.min(depth, limit);
  });
  // the Kraft sum in units of 2^-limit; over 2^limit the code is over-full
  const full = 1 << limit;
  let kraft = used.reduce((s, sym) => s + (1 << (limit - lengths[sym])), 0);
  while (kraft > full) {
    // lengthen the longest code that can still grow
    let pick = -1;
    for (const sym of used) if (lengths[sym] < limit && (pick < 0 || lengths[sym] > lengths[pick])) pick = sym;
    kraft -= 1 << (limit - lengths[pick] - 1);
    lengths[pick]++;
  }
  return lengths;
}

/** Canonical codes for code lengths. */
function codesOf(lengths: readonly number[]): number[] {
  const count = new Array<number>(MAX_BITS + 1).fill(0);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  const next = new Array<number>(MAX_BITS + 2).fill(0);
  for (let len = 1, code = 0; len <= MAX_BITS; len++) {
    code = (code + count[len - 1]) << 1;
    next[len] = code;
  }
  return lengths.map((l) => (l > 0 ? next[l]++ : 0));
}

function lengthSymbol(len: number): number {
  let i = 28;
  while (LEN_BASE[i] > len) i--;
  return i;
}

function distSymbol(d: number): number {
  let i = 29;
  while (DIST_BASE[i] > d) i--;
  return i;
}

/** One dynamic block of symbols: literals as 0–255, matches as 256 + length and distance. */
function writeBlock(w: BitWriter, lits: Uint16Array, dists: Uint16Array, count: number, last: boolean): void {
  const litFreq = new Array<number>(286).fill(0);
  const distFreq = new Array<number>(30).fill(0);
  for (let i = 0; i < count; i++) {
    if (dists[i] === 0) litFreq[lits[i]]++;
    else {
      litFreq[257 + lengthSymbol(lits[i])]++;
      distFreq[distSymbol(dists[i])]++;
    }
  }
  litFreq[256] = 1;
  // a block with no matches still needs a distance code
  if (!distFreq.some((f) => f > 0)) distFreq[0] = 1;
  const litLen = codeLengths(litFreq, MAX_BITS);
  const distLen = codeLengths(distFreq, MAX_BITS);
  let nlit = 286;
  while (nlit > 257 && litLen[nlit - 1] === 0) nlit--;
  let ndist = 30;
  while (ndist > 1 && distLen[ndist - 1] === 0) ndist--;

  // the two code lengths in a row, run-length coded with 16 (repeat), 17 and 18 (zeros)
  const all = [...litLen.slice(0, nlit), ...distLen.slice(0, ndist)];
  const rle: [number, number, number][] = [];
  for (let i = 0; i < all.length; ) {
    const l = all[i];
    let run = 1;
    while (i + run < all.length && all[i + run] === l) run++;
    let left = run;
    if (l === 0) {
      while (left >= 11) {
        const k = Math.min(left, 138);
        rle.push([18, k - 11, 7]);
        left -= k;
      }
      if (left >= 3) {
        rle.push([17, left - 3, 3]);
        left = 0;
      }
    } else {
      rle.push([l, 0, 0]);
      left--;
      while (left >= 3) {
        const k = Math.min(left, 6);
        rle.push([16, k - 3, 2]);
        left -= k;
      }
    }
    for (; left > 0; left--) rle.push([l, 0, 0]);
    i += run;
  }
  const clFreq = new Array<number>(19).fill(0);
  for (const [s] of rle) clFreq[s]++;
  const clLen = codeLengths(clFreq, 7);
  const clCode = codesOf(clLen);
  let ncl = 19;
  while (ncl > 4 && clLen[CL_ORDER[ncl - 1]] === 0) ncl--;

  w.bits(last ? 1 : 0, 1);
  w.bits(2, 2);
  w.bits(nlit - 257, 5);
  w.bits(ndist - 1, 5);
  w.bits(ncl - 4, 4);
  for (let i = 0; i < ncl; i++) w.bits(clLen[CL_ORDER[i]], 3);
  for (const [s, extra, n] of rle) {
    w.code(clCode[s], clLen[s]);
    if (n) w.bits(extra, n);
  }
  const litCode = codesOf(litLen);
  const distCode = codesOf(distLen);
  for (let i = 0; i < count; i++) {
    const d = dists[i];
    if (d === 0) w.code(litCode[lits[i]], litLen[lits[i]]);
    else {
      const len = lits[i];
      const ls = lengthSymbol(len);
      w.code(litCode[257 + ls], litLen[257 + ls]);
      if (LEN_EXTRA[ls]) w.bits(len - LEN_BASE[ls], LEN_EXTRA[ls]);
      const ds = distSymbol(d);
      w.code(distCode[ds], distLen[ds]);
      if (DIST_EXTRA[ds]) w.bits(d - DIST_BASE[ds], DIST_EXTRA[ds]);
    }
  }
  w.code(litCode[256], litLen[256]);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(data.length, i + 5552);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** `data` as a zlib stream: greedy matches over a 32 KiB window, a dynamic code per block. */
export function deflate(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.byte(0x78);
  w.byte(0x9c);
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(WINDOW);
  const hash = (i: number): number => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & ((1 << HASH_BITS) - 1);
  const insert = (i: number): void => {
    if (i + 2 >= data.length) return;
    const h = hash(i);
    prev[i & (WINDOW - 1)] = head[h];
    head[h] = i;
  };
  const lits = new Uint16Array(BLOCK_SYMBOLS);
  const dists = new Uint16Array(BLOCK_SYMBOLS);
  let count = 0;
  let i = 0;
  while (i < data.length) {
    let best = 0;
    let bestDist = 0;
    if (i + 2 < data.length) {
      const limit = Math.min(MAX_MATCH, data.length - i);
      let cand = head[hash(i)];
      for (let chain = 0; cand >= 0 && i - cand <= WINDOW && chain < MAX_CHAIN; chain++) {
        if (data[cand + best] === data[i + best]) {
          let len = 0;
          while (len < limit && data[cand + len] === data[i + len]) len++;
          if (len > best) {
            best = len;
            bestDist = i - cand;
            if (len === limit) break;
          }
        }
        const p = prev[cand & (WINDOW - 1)];
        if (p >= cand) break;
        cand = p;
      }
    }
    if (best >= 3) {
      lits[count] = best;
      dists[count++] = bestDist;
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else {
      lits[count] = data[i];
      dists[count++] = 0;
      insert(i);
      i++;
    }
    if (count === BLOCK_SYMBOLS) {
      writeBlock(w, lits, dists, count, i >= data.length);
      count = 0;
    }
  }
  if (count > 0 || data.length === 0) writeBlock(w, lits, dists, count, true);
  const out = w.finish();
  const sum = adler32(data);
  const z = new Uint8Array(out.length + 4);
  z.set(out);
  z.set([sum >>> 24, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff], out.length);
  return z;
}
