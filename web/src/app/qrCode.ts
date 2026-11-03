// A QR code (ISO/IEC 18004) for the Hyperlink tool's QR Code function (tools/hyperlink.ts): the text
// in byte mode as UTF-8, at error correction level M, in the smallest version (1 to 40) that holds it,
// under the mask that scores the lowest penalty. Its dark modules are then merged into rectangles, so
// a code is a few hundred filled shapes rather than one per module. Kept apart so it runs without the
// page.

/** Level M's error correction codewords per block, by version (0 unused) */
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28,
];
/** Level M's blocks, by version */
const BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47,
  49,
];
/** level M in the format information */
const LEVEL_M = 0;
const MAX_VERSION = 40;
/** the penalties for runs, 2×2 blocks and finder-like patterns */
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** Modules of version `v` that aren't function patterns or format and version information. */
function rawModules(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (v: number): number => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v]! * BLOCKS[v]!;
/** the length field's bits for byte mode */
const countBits = (v: number): number => (v < 10 ? 8 : 16);

/** x·y in GF(2^8) over x^8 + x^4 + x^3 + x^2 + 1. */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The Reed–Solomon generator of `degree`, its leading 1 left out. */
function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j]!, root);
      if (j + 1 < degree) out[j] ^= out[j + 1]!;
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    divisor.forEach((d, i) => (out[i] ^= gfMul(d, factor)));
  }
  return out;
}

/** The data codewords split into blocks, each with its error correction, interleaved. */
function withEcc(data: readonly number[], v: number): number[] {
  const blocks = BLOCKS[v]!;
  const ecc = ECC_PER_BLOCK[v]!;
  const raw = Math.floor(rawModules(v) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(ecc);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const check = rsRemainder(dat, divisor);
    // a short block gets a placeholder where the long ones have one more data codeword
    if (i < short) dat.push(0);
    all.push([...dat, ...check]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((b, j) => {
      if (i !== shortLen - ecc || j >= short) out.push(b[i]!);
    });
  }
  return out;
}

/** The alignment patterns' centres along each axis of version `v`. */
function alignments(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = v * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly dark: boolean[][];
  /** function patterns and format information, which data and masks leave alone */
  readonly fixed: boolean[][];

  constructor(readonly size: number) {
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  set(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.fixed[y]![x] = true;
  }

  /** The format information (level M and `mask`) in both its places, and the dark module. */
  format(mask: number): void {
    const data = (LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
    this.set(8, n - 8, true);
  }

  mask(m: number): void {
    const f = MASKS[m]!;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.fixed[y]![x] && f(x, y)) this.dark[y]![x] = !this.dark[y]![x];
  }
}

/** The penalty a masked grid scores: runs, 2×2 blocks, finder-like patterns and the balance of dark and light. */
function penalty(g: Grid): number {
  const n = g.size;
  const at = (x: number, y: number): boolean => g.dark[y]![x]!;
  let score = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push(g.dark[i]!);
    lines.push(Array.from({ length: n }, (_, k) => at(i, k)));
  }
  // a finder's 1:1:3:1:1 with four light modules on one side, the light margin round the code counting
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    for (let i = 0, run = 1; i < n; i++) {
      if (i + 1 < n && line[i + 1] === line[i]) run++;
      else {
        if (run >= 5) score += N1 + run - 5;
        run = 1;
      }
    }
    const light = (i: number): boolean => i < 0 || i >= n || !line[i];
    for (let i = 0; i + 7 <= n; i++) {
      if (!finder.every((d, k) => line[i + k] === d)) continue;
      if ([1, 2, 3, 4].every((k) => light(i - k))) score += N3;
      if ([1, 2, 3, 4].every((k) => light(i + 6 + k))) score += N3;
    }
  }
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (at(x, y)) dark++;
      if (x + 1 < n && y + 1 < n && at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) score += N2;
    }
  }
  const total = n * n;
  score += N4 * (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  return score;
}

/** The QR code holding `text`: its modules, rows from the top, true for dark; null when it's too long for one. */
export function qrModules(text: string): boolean[][] | null {
  const bytes = new TextEncoder().encode(text);
  let v = 1;
  while (4 + countBits(v) + bytes.length * 8 > dataCodewords(v) * 8) if (++v > MAX_VERSION) return null;
  // byte mode, the length, the bytes; a terminator, then padding to the capacity
  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, countBits(v));
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(v) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  const codewords = withEcc(data, v);

  const n = v * 4 + 17;
  const g = new Grid(n);
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  // the finders with their light separators
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) g.set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = alignments(v);
  const last = pos.length - 1;
  pos.forEach((ax, i) =>
    pos.forEach((ay, j) => {
      // not over the finders
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  g.format(0);
  if (v >= 7) {
    let rem = v;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (v << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, dark);
      g.set(b, a, dark);
    }
  }
  // the codewords zigzag up and down column pairs from the right, skipping the vertical timing column
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? n - 1 - vert : vert;
        if (g.fixed[y]![x] || i >= codewords.length * 8) continue;
        g.dark[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
        i++;
      }
    }
  }
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < MASKS.length; m++) {
    g.mask(m);
    g.format(m);
    const s = penalty(g);
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    g.mask(m);
  }
  g.mask(best);
  g.format(best);
  return g.dark;
}

/** A rectangle of modules: its left column and top row, and its width and height in modules. */
export interface ModuleRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The dark modules as rectangles: each row's runs, a run carried down while the rows under it have the same one. */
export function moduleRects(dark: readonly (readonly boolean[])[]): ModuleRect[] {
  const out: ModuleRect[] = [];
  let open = new Map<string, { x: number; y: number; w: number; h: number }>();
  dark.forEach((row, y) => {
    const next = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      const key = `${x},${end}`;
      const r = open.get(key);
      if (r) {
        r.h++;
        open.delete(key);
        next.set(key, r);
      } else next.set(key, { x, y, w: end - x, h: 1 });
      x = end;
    }
    out.push(...open.values());
    open = next;
  });
  out.push(...open.values());
  return out;
}
