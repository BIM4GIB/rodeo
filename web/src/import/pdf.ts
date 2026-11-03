// PDF import, the reading side. openPdf (no DOM) finds a PDF file's pages, and page() draws one
// page's content into its vector paths and its text, in page space: points, y up, the origin at
// the bottom left of the page as it is shown (its /Rotate applied). Paths keep the colours they
// print in and their line widths; curves are flattened; Form XObjects are followed. Text is read
// through each font's ToUnicode map or its encoding, and runs on one baseline are joined into one
// string. Pictures, shadings and clipping are left out (pictures and shadings counted).
//
// Objects are found by scanning the file for "n g obj" and inside object streams, so a damaged
// cross-reference table doesn't matter; the last definition of an object wins, as an incremental
// update's would. Encrypted files are refused. Streams decode with the Flate, LZW, ASCII hex,
// ASCII85 and run-length filters, with PNG and TIFF predictors.

import type { BBox, Pt } from "../core/types.ts";

/** 0 to 1 each */
export interface PdfColor {
  r: number;
  g: number;
  b: number;
}

export interface PdfSubpath {
  points: Pt[];
  closed: boolean;
}

export interface PdfPath {
  subpaths: PdfSubpath[];
  /** null when it isn't stroked */
  stroke: PdfColor | null;
  /** null when it isn't filled */
  fill: PdfColor | null;
  /** stroke width in points (0 is the thinnest line the device draws) */
  width: number;
}

export interface PdfText {
  /** start of the baseline */
  at: Pt;
  /** of the baseline, degrees anticlockwise */
  angle: number;
  /** points */
  size: number;
  text: string;
  color: PdfColor;
}

export interface PdfPage {
  /** points */
  width: number;
  height: number;
  paths: PdfPath[];
  texts: PdfText[];
  /** what was left out, by kind */
  skipped: Record<string, number>;
}

export interface PdfFile {
  readonly pages: number;
  /** page `n`, 0-based */
  page(n: number): Promise<PdfPage>;
}

/** most paths and texts one page may have */
const MAX_ITEMS = 200_000;
/** deepest Form XObject nesting that is followed */
const MAX_FORM_DEPTH = 12;
/** a path with more subpaths than this isn't searched for holes: each subpath is its own shape */
export const MAX_NESTED_SUBPATHS = 200;

// ---- objects -------------------------------------------------------------------------------

class Name {
  constructor(readonly v: string) {}
}
class Ref {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}
class Op {
  constructor(readonly v: string) {}
}
class Stream {
  constructor(
    readonly dict: Dict,
    readonly raw: Uint8Array,
  ) {}
}
type Dict = Map<string, Obj>;
type Obj = null | boolean | number | Name | Uint8Array | Obj[] | Dict | Ref | Stream;

const isDict = (o: unknown): o is Dict => o instanceof Map;
const nameOf = (o: Obj | undefined): string | null => (o instanceof Name ? o.v : null);
const num = (o: Obj | undefined, dflt = 0): number => (typeof o === "number" && Number.isFinite(o) ? o : dflt);

// ---- lexer ---------------------------------------------------------------------------------

const SPACE = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) SPACE[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of "()<>[]{}/%") DELIM[c.charCodeAt(0)] = 1;

const hexValue = (c: number): number => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

class Lexer {
  constructor(
    readonly b: Uint8Array,
    public pos = 0,
  ) {}

  skipSpace(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (SPACE[c]) this.pos++;
      else if (c === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }

  /** The next token: a number, name, string or keyword (structural marks are keywords too); undefined at the end. */
  token(): number | Name | Uint8Array | Op | undefined {
    this.skipSpace();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 47) return this.name();
    if (c === 40) return this.literal();
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return new Op("<<");
      }
      return this.hex();
    }
    if (c === 62 && b[this.pos + 1] === 62) {
      this.pos += 2;
      return new Op(">>");
    }
    if (c === 91 || c === 93 || c === 123 || c === 125) {
      this.pos++;
      return new Op(String.fromCharCode(c));
    }
    const start = this.pos;
    while (this.pos < b.length && !SPACE[b[this.pos]] && !DELIM[b[this.pos]]) this.pos++;
    if (this.pos === start) {
      // a stray delimiter such as ")" or ">"
      this.pos++;
      return new Op(String.fromCharCode(c));
    }
    let s = "";
    for (let i = start; i < this.pos; i++) s += String.fromCharCode(b[i]);
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      const n = parseFloat(s.replace(/^([+-])+/, "$1").replace(/(\..*)\./g, "$1"));
      return Number.isFinite(n) ? n : 0;
    }
    return new Op(s);
  }

  private name(): Name {
    const b = this.b;
    this.pos++;
    let s = "";
    while (this.pos < b.length && !SPACE[b[this.pos]] && !DELIM[b[this.pos]]) {
      const c = b[this.pos];
      if (c === 35 && hexValue(b[this.pos + 1]) >= 0 && hexValue(b[this.pos + 2]) >= 0) {
        s += String.fromCharCode(hexValue(b[this.pos + 1]) * 16 + hexValue(b[this.pos + 2]));
        this.pos += 3;
      } else {
        s += String.fromCharCode(c);
        this.pos++;
      }
    }
    return new Name(s);
  }

  private literal(): Uint8Array {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const e = b[this.pos++];
        const simple: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
        if (e in simple) out.push(simple[e]);
        else if (e >= 48 && e <= 55) {
          let v = e - 48;
          for (let k = 0; k < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; k++) v = v * 8 + (b[this.pos++] - 48);
          out.push(v & 255);
        } else if (e === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (e !== 10) out.push(e);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }

  private hex(): Uint8Array {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let hi = -1;
    while (this.pos < b.length && b[this.pos] !== 62) {
      const v = hexValue(b[this.pos++]);
      if (v < 0) continue;
      if (hi < 0) hi = v;
      else {
        out.push(hi * 16 + v);
        hi = -1;
      }
    }
    this.pos++;
    if (hi >= 0) out.push(hi * 16);
    return Uint8Array.from(out);
  }

  /** The next object; keywords other than true, false and null come back as Op. */
  object(): Obj | Op | undefined {
    const t = this.token();
    if (typeof t === "number") {
      // "n g R" is a reference
      const save = this.pos;
      const g = this.token();
      if (typeof g === "number") {
        const r = this.token();
        if (r instanceof Op && r.v === "R") return new Ref(t, g);
      }
      this.pos = save;
      return t;
    }
    if (!(t instanceof Op)) return t;
    switch (t.v) {
      case "[": {
        const arr: Obj[] = [];
        for (;;) {
          const o = this.object();
          if (o === undefined || (o instanceof Op && o.v === "]")) return arr;
          if (!(o instanceof Op)) arr.push(o);
        }
      }
      case "<<": {
        const d: Dict = new Map();
        for (;;) {
          const k = this.object();
          if (k === undefined || (k instanceof Op && k.v === ">>")) return d;
          if (!(k instanceof Name)) continue;
          const v = this.object();
          if (v === undefined) return d;
          if (v instanceof Op) {
            if (v.v === ">>") return d;
            continue;
          }
          d.set(k.v, v);
        }
      }
      case "true":
        return true;
      case "false":
        return false;
      case "null":
        return null;
      default:
        return t;
    }
  }
}

// ---- filters -------------------------------------------------------------------------------

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Flate: a zlib stream (or a bare deflate one); a damaged one gives what came out before the damage. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const zlib = data.length >= 2 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0;
  const ds = new DecompressionStream(zlib ? "deflate" : "deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
  } catch {
    // trailing junk or a truncated stream: keep what was decoded
  }
  return concatBytes(parts);
}

function lzw(data: Uint8Array, earlyChange: number): Uint8Array {
  const out: number[] = [];
  let table: Uint8Array[] = [];
  const reset = (): void => {
    table = [];
    for (let i = 0; i < 256; i++) table.push(Uint8Array.of(i));
    table.push(new Uint8Array(0), new Uint8Array(0));
  };
  reset();
  let bits = 9;
  let buf = 0;
  let have = 0;
  let prev: Uint8Array | null = null;
  for (let i = 0; i < data.length; i++) {
    buf = (buf << 8) | data[i];
    have += 8;
    while (have >= bits) {
      const code = (buf >> (have - bits)) & ((1 << bits) - 1);
      have -= bits;
      buf &= (1 << have) - 1;
      if (code === 256) {
        reset();
        bits = 9;
        prev = null;
        continue;
      }
      if (code === 257) return Uint8Array.from(out);
      let entry: Uint8Array;
      if (code < table.length) entry = table[code];
      else if (prev) entry = Uint8Array.from([...prev, prev[0]]);
      else return Uint8Array.from(out);
      for (const v of entry) out.push(v);
      if (prev) table.push(Uint8Array.from([...prev, entry[0]]));
      prev = entry;
      const next = table.length + earlyChange;
      if (next >= 1 << bits && bits < 12) bits++;
    }
  }
  return Uint8Array.from(out);
}

function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let hi = -1;
  for (const c of data) {
    if (c === 62) break;
    const v = hexValue(c);
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out.push(hi * 16 + v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi * 16);
  return Uint8Array.from(out);
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  let i = 0;
  if (data[0] === 60 && data[1] === 126) i = 2;
  const flush = (n: number): void => {
    let v = 0;
    for (let k = 0; k < 5; k++) v = v * 85 + (k < group.length ? group[k] : 84);
    for (let k = 0; k < n; k++) out.push((v >>> (24 - 8 * k)) & 255);
    group.length = 0;
  };
  for (; i < data.length; i++) {
    const c = data[i];
    if (c === 126) break;
    if (SPACE[c]) continue;
    if (c === 122 && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 33 || c > 117) continue;
    group.push(c - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length > 1) flush(group.length - 1);
  return Uint8Array.from(out);
}

function runLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const n = data[i++];
    if (n === 128) break;
    if (n < 128) {
      for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++]);
    } else {
      const v = data[i++];
      for (let k = 0; k < 257 - n; k++) out.push(v);
    }
  }
  return Uint8Array.from(out);
}

function unpredict(data: Uint8Array, parms: Dict | null): Uint8Array {
  const predictor = num(parms?.get("Predictor"), 1);
  if (predictor < 2) return data;
  const colors = num(parms?.get("Colors"), 1);
  const bpc = num(parms?.get("BitsPerComponent"), 8);
  const columns = num(parms?.get("Columns"), 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const row = Math.ceil((columns * colors * bpc) / 8);
  if (predictor === 2) {
    if (bpc !== 8) return data;
    const out = data.slice();
    for (let r = 0; r + row <= out.length; r += row) for (let i = bpp; i < row; i++) out[r + i] = (out[r + i] + out[r + i - bpp]) & 255;
    return out;
  }
  // PNG: each row starts with its filter type
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (row + 1)];
    const src = r * (row + 1) + 1;
    const at = r * row;
    for (let i = 0; i < row; i++) {
      const left = i >= bpp ? out[at + i - bpp] : 0;
      const up = r > 0 ? out[at - row + i] : 0;
      const corner = r > 0 && i >= bpp ? out[at - row + i - bpp] : 0;
      const x = data[src + i];
      let v = x;
      if (type === 1) v = x + left;
      else if (type === 2) v = x + up;
      else if (type === 3) v = x + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - corner);
        v = x + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
      }
      out[at + i] = v & 255;
    }
  }
  return out;
}

class UnsupportedFilter extends Error {}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const OBJ = ascii("obj");
const TRAILER = ascii("trailer");
const ENDSTREAM = ascii("endstream");
const OBJSTM = ascii("/ObjStm");
const XREF = ascii("/XRef");

/** Where `pat` first occurs in `b` from `from` up to `to`, or −1. */
function indexOf(b: Uint8Array, pat: Uint8Array, from = 0, to = b.length): number {
  const last = Math.min(to, b.length) - pat.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (b[i] !== pat[0]) continue;
    for (let k = 1; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

/** Where `pat` last occurs in `b`, or −1. */
function lastIndexOf(b: Uint8Array, pat: Uint8Array): number {
  outer: for (let i = b.length - pat.length; i >= 0; i--) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;

/** Each "n g obj" in the file, as [n, where its object starts], in file order. */
function scanObjects(b: Uint8Array): [number, number][] {
  const out: [number, number][] = [];
  for (let i = indexOf(b, OBJ); i >= 0; i = indexOf(b, OBJ, i + 3)) {
    const after = b[i + 3];
    if (after !== undefined && !SPACE[after] && !DELIM[after]) continue;
    // back over: space, the generation's digits, space, the object number's digits
    let j = i - 1;
    if (!SPACE[b[j]]) continue;
    while (j >= 0 && SPACE[b[j]]) j--;
    if (!isDigit(b[j])) continue;
    while (j >= 0 && isDigit(b[j])) j--;
    if (!SPACE[b[j]]) continue;
    while (j >= 0 && SPACE[b[j]]) j--;
    const end = j + 1;
    if (!isDigit(b[j])) continue;
    while (j >= 0 && isDigit(b[j])) j--;
    if (end - (j + 1) > 10) continue;
    let n = 0;
    for (let k = j + 1; k < end; k++) n = n * 10 + (b[k] - 48);
    out.push([n, i + 3]);
  }
  return out;
}

// ---- the file ------------------------------------------------------------------------------

class Reader {
  private readonly at = new Map<number, number>();
  private readonly packed = new Map<number, { data: Uint8Array; pos: number }>();
  private readonly cache = new Map<number, Obj>();
  private readonly decoded = new WeakMap<Stream, Promise<Uint8Array>>();

  constructor(readonly bytes: Uint8Array) {}

  /** Indexes every object, finds the catalogue and returns it. */
  async open(): Promise<Dict> {
    const b = this.bytes;
    if (indexOf(b, ascii("%PDF"), 0, 1024) < 0) throw new Error("this isn't a PDF file");
    const streams: number[] = [];
    for (const [n, pos] of scanObjects(b)) {
      this.at.set(n, pos);
      if (indexOf(b, OBJSTM, pos, pos + 400) >= 0) streams.push(n);
    }
    // objects packed in object streams; a plain definition of the same number wins
    for (const n of streams) {
      const s = this.get(new Ref(n, 0));
      if (!(s instanceof Stream) || nameOf(s.dict.get("Type")) !== "ObjStm") continue;
      let data: Uint8Array;
      try {
        data = await this.decode(s);
      } catch {
        continue;
      }
      const count = num(this.get(s.dict.get("N")));
      const first = num(this.get(s.dict.get("First")));
      const lex = new Lexer(data);
      for (let i = 0; i < count; i++) {
        const objNum = lex.token();
        const off = lex.token();
        if (typeof objNum !== "number" || typeof off !== "number") break;
        if (!this.at.has(objNum)) this.packed.set(objNum, { data, pos: first + off });
      }
    }

    let trailer: Dict | null = null;
    const t = lastIndexOf(b, TRAILER);
    if (t >= 0) {
      const d = new Lexer(this.bytes, t + 7).object();
      if (isDict(d) && d.has("Root")) trailer = d;
    }
    if (!trailer) {
      // a cross-reference stream holds the trailer's entries; the last one is the newest
      let best = -1;
      for (const [n, pos] of this.at) {
        if (pos < best || indexOf(b, XREF, pos, pos + 400) < 0) continue;
        const s = this.get(new Ref(n, 0));
        if (s instanceof Stream && s.dict.has("Root")) {
          trailer = s.dict;
          best = pos;
        }
      }
    }
    if (trailer?.has("Encrypt")) throw new Error("this PDF is encrypted, so it can't be read");
    let root = trailer ? this.get(trailer.get("Root")) : null;
    if (!isDict(root)) {
      for (const n of [...this.at.keys(), ...this.packed.keys()]) {
        const d = this.get(new Ref(n, 0));
        if (isDict(d) && nameOf(d.get("Type")) === "Catalog") {
          root = d;
          break;
        }
      }
    }
    if (!isDict(root)) throw new Error("this PDF has no page catalogue");
    return root;
  }

  /** `o` with references followed. */
  get(o: Obj | undefined): Obj {
    if (o === undefined) return null;
    if (!(o instanceof Ref)) return o;
    const hit = this.cache.get(o.num);
    if (hit !== undefined) return hit;
    this.cache.set(o.num, null);
    let v: Obj = null;
    const pos = this.at.get(o.num);
    if (pos !== undefined) v = this.parseAt(pos);
    else {
      const p = this.packed.get(o.num);
      if (p) {
        const r = new Lexer(p.data, p.pos).object();
        v = r instanceof Op || r === undefined ? null : r;
      }
    }
    this.cache.set(o.num, v);
    return v;
  }

  private parseAt(pos: number): Obj {
    const lex = new Lexer(this.bytes, pos);
    const o = lex.object();
    if (o === undefined || o instanceof Op) return null;
    if (!isDict(o)) return o;
    const save = lex.pos;
    const k = lex.token();
    if (!(k instanceof Op) || k.v !== "stream") {
      lex.pos = save;
      return o;
    }
    const b = this.bytes;
    let start = lex.pos;
    if (b[start] === 13) start++;
    if (b[start] === 10) start++;
    const len = this.get(o.get("Length"));
    let end = typeof len === "number" ? start + len : -1;
    const fits = (e: number): boolean => {
      if (e < start || e > b.length) return false;
      let i = e;
      while (i < b.length && SPACE[b[i]]) i++;
      return indexOf(b, ENDSTREAM, i, i + 9) === i;
    };
    if (!fits(end)) {
      // a wrong /Length: the data runs to the "endstream" keyword
      const k2 = indexOf(b, ENDSTREAM, start);
      end = k2 < 0 ? b.length : k2;
      if (b[end - 1] === 10) end--;
      if (b[end - 1] === 13) end--;
    }
    return new Stream(o, b.subarray(start, end));
  }

  /** A stream's data with its filters undone; image filters throw UnsupportedFilter. */
  decode(s: Stream): Promise<Uint8Array> {
    let p = this.decoded.get(s);
    if (!p) {
      p = this.undo(s);
      this.decoded.set(s, p);
    }
    return p;
  }

  private async undo(s: Stream): Promise<Uint8Array> {
    const f = this.get(s.dict.get("Filter") ?? s.dict.get("F"));
    const filters = (Array.isArray(f) ? f.map((x) => this.get(x)) : [f]).map(nameOf).filter((x): x is string => x !== null);
    const pr = this.get(s.dict.get("DecodeParms") ?? s.dict.get("DP"));
    const parms = Array.isArray(pr) ? pr.map((x) => this.get(x)) : [pr];
    let data = s.raw;
    for (const [i, name] of filters.entries()) {
      const p = parms[i];
      const dp = isDict(p) ? p : null;
      switch (name) {
        case "FlateDecode":
        case "Fl":
          data = unpredict(await inflate(data), dp);
          break;
        case "LZWDecode":
        case "LZW":
          data = unpredict(lzw(data, num(dp?.get("EarlyChange"), 1)), dp);
          break;
        case "ASCIIHexDecode":
        case "AHx":
          data = asciiHex(data);
          break;
        case "ASCII85Decode":
        case "A85":
          data = ascii85(data);
          break;
        case "RunLengthDecode":
        case "RL":
          data = runLength(data);
          break;
        default:
          throw new UnsupportedFilter(name);
      }
    }
    return data;
  }
}

// ---- fonts ---------------------------------------------------------------------------------

/** WinAnsiEncoding's codes 128 to 159; the rest of it is Latin-1 */
const WIN_ANSI_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** Glyph names a font's /Differences commonly uses, beyond single letters and "uniXXXX" */
const GLYPHS: Readonly<Record<string, string>> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*",
  plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", zero: "0", one: "1", two: "2",
  three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", colon: ":",
  semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
  backslash: "\\", bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{",
  bar: "|", braceright: "}", asciitilde: "~", bullet: "•", endash: "–", emdash: "—",
  quotedblleft: "“", quotedblright: "”", quotesinglbase: "‚", quotedblbase: "„", ellipsis: "…",
  degree: "°", plusminus: "±", multiply: "×", divide: "÷", copyright: "©", registered: "®",
  trademark: "™", section: "§", paragraph: "¶", mu: "µ", fi: "fi", fl: "fl", ff: "ff", ffi: "ffi",
  ffl: "ffl", dagger: "†", daggerdbl: "‡", sterling: "£", Euro: "€", yen: "¥", cent: "¢",
  onehalf: "½", onequarter: "¼", threequarters: "¾", twosuperior: "²", threesuperior: "³",
  nbspace: " ", periodcentered: "·", eacute: "é", egrave: "è", agrave: "à", ccedilla: "ç",
  udieresis: "ü", odieresis: "ö", adieresis: "ä", germandbls: "ß", diameter: "⌀", Omega: "Ω",
};

function glyphChar(name: string): string | null {
  if (name.length === 1) return name;
  const g = GLYPHS[name];
  if (g) return g;
  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  return null;
}

/** A WinAnsi character, the encoding a simple font without its own falls back on here. */
function winAnsi(code: number): string {
  if (code >= 128 && code < 160) return WIN_ANSI_HIGH[code - 128];
  return String.fromCharCode(code);
}

interface Font {
  /** codes are 2 bytes (a composite font) */
  readonly twoByte: boolean;
  /** a code's advance in text space units (1/1000 em scaled by the font matrix) */
  width(code: number): number;
  text(code: number): string;
}

/** A ToUnicode CMap's code-to-text map. */
function readCMap(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const lex = new Lexer(data);
  const value = (b: Uint8Array): number => b.reduce((v, x) => v * 256 + x, 0);
  const utf16 = (b: Uint8Array): string => {
    let s = "";
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return b.length === 1 ? String.fromCharCode(b[0]) : s;
  };
  for (let t = lex.object(); t !== undefined; t = lex.object()) {
    if (!(t instanceof Op)) continue;
    if (t.v === "beginbfchar") {
      for (;;) {
        const src = lex.object();
        if (!(src instanceof Uint8Array)) break;
        const dst = lex.object();
        if (dst instanceof Uint8Array) map.set(value(src), utf16(dst));
        else if (dst instanceof Name) map.set(value(src), glyphChar(dst.v) ?? "");
      }
    } else if (t.v === "beginbfrange") {
      for (;;) {
        const lo = lex.object();
        if (!(lo instanceof Uint8Array)) break;
        const hi = lex.object();
        const dst = lex.object();
        if (!(hi instanceof Uint8Array)) break;
        const a = value(lo);
        const z = Math.min(value(hi), a + 0xffff);
        if (dst instanceof Uint8Array) {
          const base = utf16(dst);
          const last = base.charCodeAt(base.length - 1);
          for (let c = a; c <= z; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - a)));
        } else if (Array.isArray(dst)) {
          dst.forEach((d, i) => {
            if (d instanceof Uint8Array && a + i <= z) map.set(a + i, utf16(d));
          });
        }
      }
    }
  }
  return map;
}

async function loadFont(r: Reader, font: Dict): Promise<Font> {
  const subtype = nameOf(r.get(font.get("Subtype")));
  let toUnicode: Map<number, string> | null = null;
  const tu = r.get(font.get("ToUnicode"));
  if (tu instanceof Stream) {
    try {
      toUnicode = readCMap(await r.decode(tu));
    } catch {
      toUnicode = null;
    }
  }
  if (subtype === "Type0") {
    const kids = r.get(font.get("DescendantFonts"));
    const cid = Array.isArray(kids) ? r.get(kids[0]) : null;
    const dw = isDict(cid) ? num(r.get(cid.get("DW")), 1000) : 1000;
    const widths = new Map<number, number>();
    const w = isDict(cid) ? r.get(cid.get("W")) : null;
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length; ) {
        const first = num(r.get(w[i]));
        const next = r.get(w[i + 1]);
        if (Array.isArray(next)) {
          next.forEach((v, k) => widths.set(first + k, num(r.get(v), dw)));
          i += 2;
        } else {
          const last = num(next);
          const v = num(r.get(w[i + 2]), dw);
          for (let c = first; c <= last && c - first < 0x10000; c++) widths.set(c, v);
          i += 3;
        }
      }
    }
    return {
      twoByte: true,
      width: (code) => widths.get(code) ?? dw,
      // without a character map the codes are glyph numbers, which say nothing
      text: (code) => toUnicode?.get(code) ?? "",
    };
  }
  // a simple font: one byte a code
  const first = num(r.get(font.get("FirstChar")));
  const ws = r.get(font.get("Widths"));
  const widths = Array.isArray(ws) ? ws.map((v) => num(r.get(v))) : [];
  const desc = r.get(font.get("FontDescriptor"));
  const missing = isDict(desc) ? num(r.get(desc.get("MissingWidth")), 0) : 0;
  const fm = r.get(font.get("FontMatrix"));
  // a Type 3 font's widths are in its own glyph space
  const k = subtype === "Type3" && Array.isArray(fm) ? num(r.get(fm[0]), 0.001) * 1000 : 1;
  const chars: (string | null)[] = Array.from({ length: 256 }, (_, c) => winAnsi(c));
  const enc = r.get(font.get("Encoding"));
  if (isDict(enc)) {
    const diffs = r.get(enc.get("Differences"));
    if (Array.isArray(diffs)) {
      let code = 0;
      for (const d of diffs) {
        const v = r.get(d);
        if (typeof v === "number") code = v;
        else if (v instanceof Name && code < 256) chars[code++] = glyphChar(v.v);
      }
    }
  }
  const avg = widths.length ? widths.reduce((s, v) => s + v, 0) / widths.length : 500;
  return {
    twoByte: false,
    width: (code) => {
      const i = code - first;
      const v = i >= 0 && i < widths.length ? widths[i] : missing || avg;
      return v * k;
    },
    text: (code) => toUnicode?.get(code) ?? chars[code] ?? "",
  };
}

// ---- drawing a page ------------------------------------------------------------------------

/** [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f */
type M6 = [number, number, number, number, number, number];
const IDENTITY: M6 = [1, 0, 0, 1, 0, 0];

/** `m` then `n` */
function mul(m: M6, n: M6): M6 {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

const apply = (m: M6, x: number, y: number): Pt => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

interface ColorSpace {
  /** components a colour takes */
  readonly n: number;
  /** the colour it starts with when chosen: black, or full tint */
  readonly initial: readonly number[];
  rgb(c: readonly number[]): PdfColor | null;
}

const gray = (v: number): PdfColor => ({ r: v, g: v, b: v });
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const DEVICE_GRAY: ColorSpace = { n: 1, initial: [0], rgb: (c) => gray(clamp01(c[0] ?? 0)) };
const DEVICE_RGB: ColorSpace = { n: 3, initial: [0, 0, 0], rgb: (c) => ({ r: clamp01(c[0] ?? 0), g: clamp01(c[1] ?? 0), b: clamp01(c[2] ?? 0) }) };
const DEVICE_CMYK: ColorSpace = {
  n: 4,
  initial: [0, 0, 0, 1],
  rgb: (c) => {
    const k = clamp01(c[3] ?? 0);
    return { r: (1 - clamp01(c[0] ?? 0)) * (1 - k), g: (1 - clamp01(c[1] ?? 0)) * (1 - k), b: (1 - clamp01(c[2] ?? 0)) * (1 - k) };
  },
};
/** a pattern paints with something openvwx doesn't draw; it's shown mid-grey */
const PATTERN: ColorSpace = { n: 0, initial: [], rgb: () => gray(0.5) };

interface GState {
  ctm: M6;
  strokeSpace: ColorSpace;
  fillSpace: ColorSpace;
  stroke: PdfColor | null;
  fill: PdfColor | null;
  lineWidth: number;
  font: Font | null;
  size: number;
  charSpace: number;
  wordSpace: number;
  hScale: number;
  leading: number;
  rise: number;
  render: number;
}

/** The text run being joined: the last text and where its baseline ended. */
interface Run {
  text: PdfText;
  end: Pt;
}

class Painter {
  readonly paths: PdfPath[] = [];
  readonly texts: PdfText[] = [];
  readonly skipped: Record<string, number> = {};
  private readonly fonts = new Map<Dict, Promise<Font>>();
  private run: Run | null = null;

  constructor(private readonly r: Reader) {}

  skip(kind: string, n = 1): void {
    this.skipped[kind] = (this.skipped[kind] ?? 0) + n;
  }

  private font(d: Dict): Promise<Font> {
    let f = this.fonts.get(d);
    if (!f) {
      f = loadFont(this.r, d);
      this.fonts.set(d, f);
    }
    return f;
  }

  private colorSpace(o: Obj, res: Dict | null): ColorSpace {
    const r = this.r;
    let v = r.get(o);
    const n = nameOf(v);
    if (n === "DeviceGray" || n === "G" || n === "CalGray") return DEVICE_GRAY;
    if (n === "DeviceRGB" || n === "RGB" || n === "CalRGB") return DEVICE_RGB;
    if (n === "DeviceCMYK" || n === "CMYK") return DEVICE_CMYK;
    if (n === "Pattern") return PATTERN;
    if (n !== null) {
      const named = res ? r.get(res.get("ColorSpace")) : null;
      v = isDict(named) ? r.get(named.get(n)) : null;
      if (v === null) return DEVICE_GRAY;
      if (nameOf(v)) return this.colorSpace(v, null);
    }
    if (!Array.isArray(v) || v.length === 0) return DEVICE_GRAY;
    const family = nameOf(r.get(v[0]));
    switch (family) {
      case "ICCBased": {
        const s = r.get(v[1]);
        const comps = s instanceof Stream ? num(r.get(s.dict.get("N")), 3) : 3;
        return comps === 1 ? DEVICE_GRAY : comps === 4 ? DEVICE_CMYK : DEVICE_RGB;
      }
      case "CalRGB":
      case "Lab":
        return DEVICE_RGB;
      case "CalGray":
        return DEVICE_GRAY;
      case "Indexed":
      case "I": {
        const base = this.colorSpace(v[1] ?? null, res);
        const hival = num(r.get(v[2]));
        const lookup = r.get(v[3]);
        const table = lookup instanceof Uint8Array ? lookup : null;
        return {
          n: 1,
          initial: [0],
          rgb: (c) => {
            const i = Math.max(0, Math.min(hival, Math.round(c[0] ?? 0)));
            if (!table) return gray(0);
            return base.rgb(Array.from({ length: base.n }, (_, k) => (table[i * base.n + k] ?? 0) / 255));
          },
        };
      }
      case "Separation":
      case "DeviceN": {
        // the tint transform is a function openvwx doesn't run: full tint prints black
        const names = r.get(v[1]);
        const comps = family === "DeviceN" && Array.isArray(names) ? names.length : 1;
        return { n: comps, initial: Array.from({ length: comps }, () => 1), rgb: (c) => gray(1 - clamp01(Math.max(...c.slice(0, comps), 0))) };
      }
      case "Pattern":
        return PATTERN;
      default:
        return DEVICE_GRAY;
    }
  }

  /** Draws a content stream (`data`) with its resources; `depth` counts the forms it is inside. */
  async draw(data: Uint8Array, res: Dict | null, gs: GState, depth: number): Promise<void> {
    const r = this.r;
    const lex = new Lexer(data);
    const stack: GState[] = [];
    let st: GState = { ...gs };
    const ops: Obj[] = [];
    /** the path being built: page-space subpaths */
    let subpaths: PdfSubpath[] = [];
    let cur: Pt[] | null = null;
    /** the current point and the subpath's start, in user space */
    let lastUser: Pt = { x: 0, y: 0 };
    let startUser: Pt = { x: 0, y: 0 };
    let tm: M6 = IDENTITY;
    let tlm: M6 = IDENTITY;
    const at = (i: number): number => num(ops[i]);
    const begin = (x: number, y: number): void => {
      cur = [apply(st.ctm, x, y)];
      subpaths.push({ points: cur, closed: false });
      lastUser = { x, y };
      startUser = { x, y };
    };
    const lineTo = (x: number, y: number): void => {
      if (!cur) begin(x, y);
      else cur.push(apply(st.ctm, x, y));
      lastUser = { x, y };
    };
    const curveTo = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void => {
      if (!cur) begin(lastUser.x, lastUser.y);
      const p0 = apply(st.ctm, lastUser.x, lastUser.y);
      const p1 = apply(st.ctm, x1, y1);
      const p2 = apply(st.ctm, x2, y2);
      const p3 = apply(st.ctm, x3, y3);
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const n = Math.min(32, Math.max(2, Math.ceil(Math.sqrt(len / 0.5))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        cur!.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
      }
      lastUser = { x: x3, y: y3 };
    };
    const close = (): void => {
      const s = subpaths[subpaths.length - 1];
      if (s && cur) s.closed = true;
      // a path after h goes on from the subpath's start
      cur = null;
      lastUser = startUser;
    };
    const paint = (stroke: boolean, fill: boolean, closeFirst: boolean): void => {
      if (closeFirst) close();
      const kept = subpaths.filter((s) => s.points.length >= 2);
      if (kept.length > 0 && (stroke || fill)) {
        if (this.paths.length + this.texts.length >= MAX_ITEMS) this.skip("over the limit");
        else {
          const k = Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2]));
          this.paths.push({ subpaths: kept, stroke: stroke ? st.stroke : null, fill: fill ? st.fill : null, width: st.lineWidth * k });
        }
      }
      subpaths = [];
      cur = null;
    };

    /** Shows a string: its characters as text, its advance moving the text matrix. */
    const show = (s: Uint8Array, out: string[]): void => {
      const f = st.font;
      if (!f) return;
      const step = f.twoByte ? 2 : 1;
      for (let i = 0; i + step <= s.length; i += step) {
        const code = f.twoByte ? (s[i] << 8) | s[i + 1] : s[i];
        const ch = f.text(code);
        out.push(ch);
        const w0 = f.width(code) / 1000;
        const space = !f.twoByte && code === 32 ? st.wordSpace : 0;
        const tx = (w0 * st.size + st.charSpace + space) * (st.hScale / 100);
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
    };
    /** Starts a text run where the text matrix is now; `body` shows its strings. */
    const text = (body: (out: string[]) => void): void => {
      const trm = (): M6 => mul(mul([st.size * (st.hScale / 100), 0, 0, st.size, 0, st.rise], tm), st.ctm);
      const m0 = trm();
      const out: string[] = [];
      body(out);
      const m1 = trm();
      // invisible text (OCR layers) and text with no font draw nothing
      if (st.render === 3 || st.render === 7 || !st.font) return;
      const str = out.join("").replace(/[\u0000-\u001f\u007f]/g, "");
      if (!str.trim()) {
        // characters with no text behind them (a font without a character map)
        if (out.length > 0 && out.every((c) => c === "")) this.skip("unreadable text");
        if (this.run) this.run.end = apply(m1, 0, 0);
        return;
      }
      const start = apply(m0, 0, 0);
      const end = apply(m1, 0, 0);
      const size = Math.hypot(m0[2], m0[3]);
      const angle = (Math.atan2(m0[1], m0[0]) * 180) / Math.PI;
      const color = (st.render === 1 || st.render === 5 ? st.stroke : st.fill) ?? gray(0);
      const last = this.run;
      if (last && Math.abs(last.text.angle - angle) < 0.5 && Math.abs(last.text.size - size) <= size * 0.02 && sameColor(last.text.color, color)) {
        const u = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
        const dx = start.x - last.end.x;
        const dy = start.y - last.end.y;
        const along = dx * u.x + dy * u.y;
        const across = -dx * u.y + dy * u.x;
        if (Math.abs(across) < size * 0.2 && along > -size * 0.3 && along < size * 1.5) {
          const gap = along > size * 0.2 && !last.text.text.endsWith(" ") && !str.startsWith(" ");
          last.text.text += (gap ? " " : "") + str;
          last.end = end;
          return;
        }
      }
      if (this.paths.length + this.texts.length >= MAX_ITEMS) {
        this.skip("over the limit");
        return;
      }
      const t: PdfText = { at: start, angle, size, text: str, color };
      this.texts.push(t);
      this.run = { text: t, end };
    };

    for (;;) {
      const t = lex.object();
      if (t === undefined) break;
      if (!(t instanceof Op)) {
        ops.push(t);
        continue;
      }
      const op = t.v;
      try {
        switch (op) {
          case "q":
            stack.push({ ...st });
            break;
          case "Q":
            if (stack.length) st = stack.pop()!;
            break;
          case "cm":
            st.ctm = mul([at(0), at(1), at(2), at(3), at(4), at(5)], st.ctm);
            break;
          case "w":
            st.lineWidth = Math.abs(at(0));
            break;
          case "gs": {
            const egs = res ? r.get(res.get("ExtGState")) : null;
            const g = isDict(egs) ? r.get(egs.get(nameOf(ops[0]) ?? "")) : null;
            if (isDict(g) && typeof r.get(g.get("LW")) === "number") st.lineWidth = Math.abs(num(r.get(g.get("LW"))));
            break;
          }
          case "m":
            begin(at(0), at(1));
            break;
          case "l":
            lineTo(at(0), at(1));
            break;
          case "c":
            curveTo(at(0), at(1), at(2), at(3), at(4), at(5));
            break;
          case "v":
            curveTo(lastUser.x, lastUser.y, at(0), at(1), at(2), at(3));
            break;
          case "y":
            curveTo(at(0), at(1), at(2), at(3), at(2), at(3));
            break;
          case "h":
            close();
            break;
          case "re": {
            const [x, y, w, hh] = [at(0), at(1), at(2), at(3)];
            begin(x, y);
            lineTo(x + w, y);
            lineTo(x + w, y + hh);
            lineTo(x, y + hh);
            close();
            lastUser = { x, y };
            break;
          }
          case "S":
            paint(true, false, false);
            break;
          case "s":
            paint(true, false, true);
            break;
          case "f":
          case "F":
          case "f*":
            paint(false, true, false);
            break;
          case "B":
          case "B*":
            paint(true, true, false);
            break;
          case "b":
          case "b*":
            paint(true, true, true);
            break;
          case "n":
            paint(false, false, false);
            break;
          case "CS":
            st.strokeSpace = this.colorSpace(ops[0] ?? null, res);
            st.stroke = st.strokeSpace.rgb(st.strokeSpace.initial);
            break;
          case "cs":
            st.fillSpace = this.colorSpace(ops[0] ?? null, res);
            st.fill = st.fillSpace.rgb(st.fillSpace.initial);
            break;
          case "SC":
          case "SCN":
            st.stroke = st.strokeSpace.rgb(ops.filter((o): o is number => typeof o === "number"));
            break;
          case "sc":
          case "scn":
            st.fill = st.fillSpace.rgb(ops.filter((o): o is number => typeof o === "number"));
            break;
          case "G":
            st.strokeSpace = DEVICE_GRAY;
            st.stroke = DEVICE_GRAY.rgb([at(0)]);
            break;
          case "g":
            st.fillSpace = DEVICE_GRAY;
            st.fill = DEVICE_GRAY.rgb([at(0)]);
            break;
          case "RG":
            st.strokeSpace = DEVICE_RGB;
            st.stroke = DEVICE_RGB.rgb([at(0), at(1), at(2)]);
            break;
          case "rg":
            st.fillSpace = DEVICE_RGB;
            st.fill = DEVICE_RGB.rgb([at(0), at(1), at(2)]);
            break;
          case "K":
            st.strokeSpace = DEVICE_CMYK;
            st.stroke = DEVICE_CMYK.rgb([at(0), at(1), at(2), at(3)]);
            break;
          case "k":
            st.fillSpace = DEVICE_CMYK;
            st.fill = DEVICE_CMYK.rgb([at(0), at(1), at(2), at(3)]);
            break;
          case "BT":
            tm = IDENTITY;
            tlm = IDENTITY;
            break;
          case "ET":
            break;
          case "Tc":
            st.charSpace = at(0);
            break;
          case "Tw":
            st.wordSpace = at(0);
            break;
          case "Tz":
            st.hScale = at(0);
            break;
          case "TL":
            st.leading = at(0);
            break;
          case "Ts":
            st.rise = at(0);
            break;
          case "Tr":
            st.render = at(0);
            break;
          case "Tf": {
            const fonts = res ? r.get(res.get("Font")) : null;
            const fd = isDict(fonts) ? r.get(fonts.get(nameOf(ops[0]) ?? "")) : null;
            st.font = isDict(fd) ? await this.font(fd) : null;
            st.size = at(1);
            break;
          }
          case "Td":
            tlm = mul([1, 0, 0, 1, at(0), at(1)], tlm);
            tm = tlm;
            break;
          case "TD":
            st.leading = -at(1);
            tlm = mul([1, 0, 0, 1, at(0), at(1)], tlm);
            tm = tlm;
            break;
          case "Tm":
            tlm = [at(0), at(1), at(2), at(3), at(4), at(5)];
            tm = tlm;
            break;
          case "T*":
            tlm = mul([1, 0, 0, 1, 0, -st.leading], tlm);
            tm = tlm;
            break;
          case "Tj":
            if (ops[0] instanceof Uint8Array) {
              const s = ops[0];
              text((out) => show(s, out));
            }
            break;
          case "'":
          case '"': {
            if (op === '"') {
              st.wordSpace = at(0);
              st.charSpace = at(1);
            }
            tlm = mul([1, 0, 0, 1, 0, -st.leading], tlm);
            tm = tlm;
            const s = ops[ops.length - 1];
            if (s instanceof Uint8Array) text((out) => show(s, out));
            break;
          }
          case "TJ": {
            const arr = ops[0];
            if (!Array.isArray(arr)) break;
            text((out) => {
              for (const e of arr) {
                if (e instanceof Uint8Array) show(e, out);
                else if (typeof e === "number") {
                  const tx = (-e / 1000) * st.size * (st.hScale / 100);
                  tm = mul([1, 0, 0, 1, tx, 0], tm);
                  // a kern of a quarter em or more reads as a space
                  if (e < -250) out.push(" ");
                }
              }
            });
            break;
          }
          case "Do": {
            const xo = res ? r.get(res.get("XObject")) : null;
            const x = isDict(xo) ? r.get(xo.get(nameOf(ops[0]) ?? "")) : null;
            if (!(x instanceof Stream)) break;
            const sub = nameOf(r.get(x.dict.get("Subtype")));
            if (sub === "Image") {
              this.skip("pictures");
              break;
            }
            if (sub !== "Form" || depth >= MAX_FORM_DEPTH) break;
            const fm = r.get(x.dict.get("Matrix"));
            const m: M6 = Array.isArray(fm) && fm.length === 6 ? (fm.map((v) => num(r.get(v))) as M6) : IDENTITY;
            const fr = r.get(x.dict.get("Resources"));
            let body: Uint8Array;
            try {
              body = await r.decode(x);
            } catch {
              this.skip("unreadable streams");
              break;
            }
            this.run = null;
            await this.draw(body, isDict(fr) ? fr : res, { ...st, ctm: mul(m, st.ctm) }, depth + 1);
            this.run = null;
            break;
          }
          case "sh":
            this.skip("shadings");
            break;
          case "BI": {
            // an inline picture: its data runs from ID to EI
            const b = lex.b;
            let i = lex.pos;
            while (i < b.length - 1 && !(b[i] === 73 && b[i + 1] === 68 && SPACE[b[i - 1]] && SPACE[b[i + 2]])) i++;
            i += 3;
            while (i < b.length - 1 && !(b[i] === 69 && b[i + 1] === 73 && SPACE[b[i - 1]] && (i + 2 >= b.length || SPACE[b[i + 2]]))) i++;
            lex.pos = i + 2;
            this.skip("pictures");
            break;
          }
          default:
            // marked content, compatibility sections, clipping, line caps, joins and dashes draw nothing here
            break;
        }
      } catch (err) {
        if (err instanceof UnsupportedFilter) this.skip("unreadable streams");
        else throw err;
      }
      ops.length = 0;
    }
  }
}

const sameColor = (a: PdfColor, b: PdfColor): boolean => Math.abs(a.r - b.r) < 1e-3 && Math.abs(a.g - b.g) < 1e-3 && Math.abs(a.b - b.b) < 1e-3;

/** The page's box in default user space: the crop box within the media box. */
function pageBox(r: Reader, media: Obj, crop: Obj): BBox {
  const box = (o: Obj): BBox | null => {
    const v = r.get(o);
    if (!Array.isArray(v) || v.length < 4) return null;
    const [a, b, c, d] = v.map((x) => num(r.get(x)));
    return { x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
  };
  const m = box(media) ?? { x0: 0, y0: 0, x1: 612, y1: 792 };
  const c = box(crop);
  if (!c) return m;
  const out = { x0: Math.max(m.x0, c.x0), y0: Math.max(m.y0, c.y0), x1: Math.min(m.x1, c.x1), y1: Math.min(m.y1, c.y1) };
  return out.x1 > out.x0 && out.y1 > out.y0 ? out : m;
}

interface PageRef {
  dict: Dict;
  resources: Obj;
  media: Obj;
  crop: Obj;
  rotate: number;
}

/** The page tree's leaves in order, each with what it inherits. */
function listPages(r: Reader, root: Dict): PageRef[] {
  const out: PageRef[] = [];
  const seen = new Set<Dict>();
  const walk = (node: Obj, inherited: Omit<PageRef, "dict">): void => {
    const d = r.get(node);
    if (!isDict(d) || seen.has(d) || out.length > 10000) return;
    seen.add(d);
    const here: Omit<PageRef, "dict"> = {
      resources: d.get("Resources") ?? inherited.resources,
      media: d.get("MediaBox") ?? inherited.media,
      crop: d.get("CropBox") ?? inherited.crop,
      rotate: d.has("Rotate") ? num(r.get(d.get("Rotate"))) : inherited.rotate,
    };
    const kids = r.get(d.get("Kids"));
    if (Array.isArray(kids) && nameOf(r.get(d.get("Type"))) !== "Page") {
      for (const k of kids) walk(k, here);
    } else out.push({ dict: d, ...here });
  };
  walk(root.get("Pages") ?? null, { resources: null, media: null, crop: null, rotate: 0 });
  return out;
}

/** Opens a PDF file's bytes; throws when it can't be read. */
export async function openPdf(bytes: Uint8Array): Promise<PdfFile> {
  const r = new Reader(bytes);
  const root = await r.open();
  const pages = listPages(r, root);
  if (pages.length === 0) throw new Error("this PDF has no pages");
  return {
    pages: pages.length,
    page: async (n) => {
      const p = pages[n];
      if (!p) throw new Error(`no page ${n + 1}`);
      const box = pageBox(r, p.media, p.crop);
      const rot = (((Math.round(p.rotate / 90) * 90) % 360) + 360) % 360;
      // the page as it is shown, its bottom left at the origin
      const base: M6 =
        rot === 90
          ? [0, -1, 1, 0, -box.y0, box.x1]
          : rot === 180
            ? [-1, 0, 0, -1, box.x1, box.y1]
            : rot === 270
              ? [0, 1, -1, 0, box.y1, -box.x0]
              : [1, 0, 0, 1, -box.x0, -box.y0];
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      const [width, height] = rot === 90 || rot === 270 ? [h, w] : [w, h];
      const painter = new Painter(r);
      const contents = r.get(p.dict.get("Contents"));
      const streams = (Array.isArray(contents) ? contents.map((c) => r.get(c)) : [contents]).filter((s): s is Stream => s instanceof Stream);
      const parts: Uint8Array[] = [];
      for (const s of streams) {
        try {
          parts.push(await r.decode(s), Uint8Array.of(10));
        } catch {
          painter.skip("unreadable streams");
        }
      }
      const res = r.get(p.resources);
      await painter.draw(concatBytes(parts), isDict(res) ? res : null, {
        ctm: base,
        strokeSpace: DEVICE_GRAY,
        fillSpace: DEVICE_GRAY,
        stroke: gray(0),
        fill: gray(0),
        lineWidth: 1,
        font: null,
        size: 0,
        charSpace: 0,
        wordSpace: 0,
        hScale: 100,
        leading: 0,
        rise: 0,
        render: 0,
      }, 0);
      // what lies wholly off the page is clipped away when it prints
      const on = (pts: readonly Pt[]): boolean => {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const q of pts) {
          if (q.x < x0) x0 = q.x;
          if (q.y < y0) y0 = q.y;
          if (q.x > x1) x1 = q.x;
          if (q.y > y1) y1 = q.y;
        }
        return x1 >= 0 && y1 >= 0 && x0 <= width && y0 <= height;
      };
      const paths = painter.paths.filter((q) => q.subpaths.some((s) => on(s.points)));
      const texts = painter.texts.filter((t) => on([t.at]));
      const off = painter.paths.length - paths.length + painter.texts.length - texts.length;
      if (off > 0) painter.skip("off the page", off);
      return { width, height, paths, texts, skipped: painter.skipped };
    },
  };
}
