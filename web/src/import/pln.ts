// Archicad project files (.pln, a .pla archive, which also packs the project's library parts, and a
// .tpl template), the reading side (no DOM): what the file says of itself, not its model. Archicad
// 17 and later save a "random object file": the 8-byte signature "ROF FDB ", a 32-byte header,
// then allocations ("BL" blocks sized in 16-byte units) and QuickLZ-compressed groups that expand
// into more of them, back to back to the end. An allocation holds one object of Archicad's object
// database: a class tag, how its payload is stored (as is, as a zero-byte mask, or as QuickLZ
// chunks), the object's GUID, then the payload, which starts with the GUID of the object's class.
// Three classes are read: the project preview (a PNG), the plan's meta information (the Archicad
// version it was last saved with and started in, and when) and Project Info (File > Info > Project
// Info). The model (walls, slabs, library parts) isn't read: Archicad saves it as IFC (File >
// Save As…), which ifc.ts reads. The file is read by ranges, so a project of several hundred
// megabytes isn't held in memory. In the Archicad 23 to 29 archives it was checked on, every object
// these classes need sits outside the compressed groups, so the groups are opened only when one
// isn't found outside them. Older files ("MM", "WW" headers) aren't read.

/** `length` bytes of the file from `offset` (fewer at its end). */
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>;

export interface PlnPreview {
  /** the PNG file's bytes */
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** A Project Info field with a value, labelled as Archicad labels it. */
export interface PlnField {
  readonly label: string;
  readonly value: string;
}

export interface PlnInfo {
  /** the Archicad version (17, 29…) the file was last saved with, when the file says */
  readonly savedWith: number | null;
  /** the Archicad version the project was started in */
  readonly startedIn: number | null;
  readonly saved: Date | null;
  readonly started: Date | null;
  /** the preview Archicad shows when opening the project, when one was saved */
  readonly preview: PlnPreview | null;
  /** Project Info's filled-in fields, in Archicad's order, then its custom ones */
  readonly fields: readonly PlnField[];
}

/** The first bytes of an Archicad 17+ project, archive or template. */
export const ROF_SIGNATURE = "ROF FDB ";

/** True when `head` starts as an Archicad 17+ file does. */
export function isRof(head: Uint8Array): boolean {
  if (head.length < 8) return false;
  for (let i = 0; i < 8; i++) if (head[i] !== ROF_SIGNATURE.charCodeAt(i)) return false;
  return true;
}

// ---- class GUIDs (as the bytes are stored) ---------------------------------------------------

const PREVIEW_CLASS = "988b37d87c434747863dee9d096469d5"; // ProjectPreviewAndCreditData
const META_CLASS = "ba0d826fd47cd743bec2f8c75b687d63"; // PlanIO::PlanMetaInformation
const INFO_CLASS = "ea2d06e2fbcfe6488b07a0eefac20d71"; // PIF::ProjectInfo
const WANTED: ReadonlySet<string> = new Set([PREVIEW_CLASS, META_CLASS, INFO_CLASS]);

/** what starts a compressed group */
const GROUP_MAGIC = [0x79, 0xa8, 0xa9, 0x96, 0x45, 0xb4, 0x4a, 0xf3, 0x98, 0x38, 0x33, 0xc3, 0x3a, 0x06, 0x1b, 0x06];
/** the first allocation, after the header */
export const FIRST = 32;
/** tags at or above this are the database's own blocks (free space, directories), never objects */
export const SYSTEM_TAG = 0xf000;
/** bytes read at once while walking */
const WINDOW = 4 << 20;
/** an allocation's header and enough of its payload to tell its class */
const HEAD = 96;

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function hex(b: Uint8Array, o: number, n: number): string {
  let s = "";
  for (let i = o; i < o + n; i++) s += (b[i] ?? 0).toString(16).padStart(2, "0");
  return s;
}

// ---- QuickLZ ----------------------------------------------------------------------------------

/** A QuickLZ chunk's header at `o`: its whole size (header included), its size expanded, and its header's length. */
export function qlzHeader(b: Uint8Array, o: number): { csize: number; dsize: number; hlen: number; packed: boolean; level: number } {
  const flags = b[o];
  const long = (flags & 2) !== 0;
  return {
    csize: long ? u32(b, o + 1) : b[o + 1],
    dsize: long ? u32(b, o + 5) : b[o + 2],
    hlen: long ? 9 : 3,
    packed: (flags & 1) !== 0,
    level: (flags >> 2) & 3,
  };
}

const LITERALS = [4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0];

/**
 * Expands the QuickLZ chunk at `o` (level 1, which Archicad writes), or its first `limit` bytes.
 * Level 1 names a match by the hash of its first three bytes, so the expander keeps the same table
 * of where each hash was last seen as the compressor did: every position it writes, except those
 * inside a match.
 */
export function qlzDecompress(b: Uint8Array, o: number, limit = Infinity): Uint8Array {
  const { dsize, hlen, packed, level, csize } = qlzHeader(b, o);
  const want = Math.min(dsize, limit);
  if (!packed) return b.slice(o + hlen, o + hlen + want);
  if (level !== 1) throw new Error(`QuickLZ level ${level} isn't read`);
  const out = new Uint8Array(Math.min(dsize, want + 256) + 8);
  const end = Math.min(b.length, o + csize);
  const last = dsize - 1;
  const lastMatchStart = last - 10;
  const table = new Int32Array(4096);
  let hashed = -1;
  let src = o + hlen;
  let d = 0;
  let cword = 1;
  const hashUpTo = (to: number): void => {
    while (hashed < to) {
      hashed++;
      const v = out[hashed] | (out[hashed + 1] << 8) | (out[hashed + 2] << 16);
      table[((v >>> 12) ^ v) & 0xfff] = hashed;
    }
  };
  while (d < want) {
    if (src >= end) throw new Error("QuickLZ chunk ends early");
    if (cword === 1) {
      cword = (u32(b, src) | 0x80000000) >>> 0;
      src += 4;
    }
    const fetch = u32(b, src);
    if (cword & 1) {
      cword >>>= 1;
      const from = table[(fetch >>> 4) & 0xfff];
      let length: number;
      if (fetch & 0xf) {
        length = (fetch & 0xf) + 2;
        src += 2;
      } else {
        length = b[src + 2];
        src += 3;
      }
      if (from < 0 || from >= d || d + length > dsize) throw new Error("QuickLZ match out of range");
      for (let i = 0; i < length; i++) out[d + i] = out[from + i];
      d += length;
      hashUpTo(d - length);
      hashed = d - 1;
    } else if (d < lastMatchStart) {
      const n = LITERALS[cword & 0xf];
      for (let i = 0; i < 4; i++) out[d + i] = b[src + i];
      cword >>>= n;
      d += n;
      src += n;
      hashUpTo(d - 3);
    } else {
      // the last few bytes are literals, whatever the control bits say
      while (d <= last && d < want) {
        if (cword === 1) {
          src += 4;
          cword = 0x80000000;
        }
        out[d++] = b[src++];
        cword >>>= 1;
      }
    }
  }
  return out.slice(0, want);
}

/** Expands a zero-byte mask: each mask byte says, low bit first, which of the next 8 bytes are stored (the rest are 0). */
export function zeroMask(b: Uint8Array, o: number, stored: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const end = Math.min(b.length, o + stored);
  let p = o;
  let d = 0;
  while (p < end && d < size) {
    const mask = b[p++];
    for (let bit = 0; bit < 8 && d < size; bit++, d++) if (mask & (1 << bit)) out[d] = b[p++];
  }
  return out;
}

// ---- allocations ------------------------------------------------------------------------------

/** How an allocation's payload is stored, from the header bytes at `at`. */
interface Layout {
  /** where the stored payload starts */
  readonly data: number;
  readonly stored: number;
  /** its size expanded */
  readonly size: number;
  readonly kind: "plain" | "mask" | "qlz";
}

/**
 * An allocation's layout: "BL", its size in 16-byte units, a u16 class tag, a version byte, two
 * bytes saying how the payload is stored, the object's GUID, then lengths. 0xBn: a u32 length and
 * the bytes as they are. 0xAn: a stored length (u16, or u32 when n is 7 or more), then 0x84: a
 * u32 we don't need and the bytes; 0x85: the expanded size, that u32 and a zero-byte mask; 0x86:
 * the expanded size, that u32 and QuickLZ chunks. Null for anything else (free space).
 */
function layout(b: Uint8Array, at: number): Layout | null {
  const form = b[at + 9];
  const stored = b[at + 10];
  const p = at + 27;
  if (form >> 4 === 0xb) return { data: p + 4, stored: u32(b, p), size: u32(b, p), kind: "plain" };
  if (form >> 4 !== 0xa) return null;
  const wide = (form & 15) >= 7;
  const length = wide ? u32(b, p) : u16(b, p);
  const q = p + (wide ? 4 : 2);
  if (stored === 0x84) return { data: q + 4, stored: length, size: length, kind: "plain" };
  if (stored === 0x85) return { data: q + 8, stored: length, size: u32(b, q), kind: "mask" };
  if (stored === 0x86) return { data: q + 8, stored: length, size: u32(b, q), kind: "qlz" };
  return null;
}

/** An allocation's payload expanded, or its first `limit` bytes; null when its layout isn't known. */
export function allocationPayload(b: Uint8Array, at: number, limit = Infinity): Uint8Array | null {
  const l = layout(b, at);
  if (!l) return null;
  const want = Math.min(l.size, limit);
  if (l.kind === "plain") return b.slice(l.data, l.data + want);
  if (l.kind === "mask") return zeroMask(b, l.data, l.stored, want);
  const out = new Uint8Array(want);
  let p = l.data;
  let d = 0;
  while (d < want && p < l.data + l.stored) {
    const chunk = qlzDecompress(b, p, want - d);
    out.set(chunk, d);
    d += chunk.length;
    p += qlzHeader(b, p).csize;
  }
  if (d < want) throw new Error("an allocation's QuickLZ chunks end early");
  return out;
}

/** The allocation at `at`: its size in bytes and tag. */
export function allocation(b: Uint8Array, at: number): { bytes: number; tag: number } {
  return { bytes: u32(b, at + 2) * 16, tag: u16(b, at + 6) };
}

export const isAllocation = (b: Uint8Array, o: number): boolean => b[o] === 0x42 && b[o + 1] === 0x4c;
export const isGroup = (b: Uint8Array, o: number): boolean => GROUP_MAGIC.every((x, i) => b[o + i] === x);

/** A group's chunks expanded: the allocations it holds, back to back. */
export function expandGroup(b: Uint8Array, at: number): Uint8Array {
  const count = u32(b, at + 24);
  const size = u32(b, at + 16);
  const out = new Uint8Array(size);
  let p = at + 32;
  let d = 0;
  for (let i = 0; i < count; i++) {
    const chunk = qlzDecompress(b, p + 4);
    out.set(chunk.subarray(0, Math.max(0, size - d)), d);
    d += chunk.length;
    p += 4 + u32(b, p);
  }
  if (d !== size) throw new Error("a compressed group expands to the wrong size");
  return out;
}

/** The bytes a group held in memory takes, padding included. */
function groupBytes(b: Uint8Array, at: number): number {
  let p = at + 32;
  for (let i = u32(b, at + 24); i > 0; i--) p += 4 + u32(b, p);
  return Math.ceil(p / 16) * 16 - at;
}

/** The bytes a group takes in the file, padding included, read by ranges. */
export async function groupLength(read: Windowed, at: number): Promise<number> {
  const head = await read.at(at, 32);
  let p = at + 32;
  for (let i = u32(head, 24); i > 0; i--) p += 4 + u32(await read.at(p, 4), 0);
  return Math.ceil(p / 16) * 16 - at;
}

/** Reads through a window, so the many small headers of a walk don't each cost a read. */
export class Windowed {
  private start = 0;
  private bytes: Uint8Array = new Uint8Array(0);
  constructor(
    private readonly read: ReadRange,
    readonly size: number,
  ) {}

  async at(offset: number, length: number): Promise<Uint8Array> {
    const from = offset - this.start;
    if (from >= 0 && from + length <= this.bytes.length) return this.bytes.subarray(from, from + length);
    if (length > WINDOW) return this.read(offset, Math.min(length, this.size - offset));
    this.start = offset;
    this.bytes = await this.read(offset, Math.min(WINDOW, this.size - offset));
    return this.bytes.subarray(0, length);
  }
}

/** An allocation, or with `group` a compressed group, among bytes held in memory. */
export interface Block {
  readonly at: number;
  readonly bytes: number;
  /** an allocation's class tag; -1 for a group */
  readonly tag: number;
  readonly group: boolean;
}

/** The allocations and compressed groups in `b` from `from` on, in order, past any padding. */
export function* blocksIn(b: Uint8Array, from: number): Generator<Block> {
  let o = from;
  while (o + 16 <= b.length) {
    if (isAllocation(b, o)) {
      const { bytes, tag } = allocation(b, o);
      if (!bytes || o + bytes > b.length) return;
      yield { at: o, bytes, tag, group: false };
      o += bytes;
    } else if (isGroup(b, o)) {
      const bytes = groupBytes(b, o);
      yield { at: o, bytes, tag: -1, group: true };
      o += bytes;
    } else o += 16;
  }
}

/** The class GUID (hex, as stored) the payload of the allocation at `at` starts with, or "" when the bytes held don't tell. */
export function classOf(b: Uint8Array, at: number): string {
  try {
    const start = allocationPayload(b, at, 16);
    return start && start.length === 16 ? hex(start, 0, 16) : "";
  } catch {
    return "";
  }
}

/** The objects of the wanted classes among allocations held in memory (an expanded group). */
function wantedIn(b: Uint8Array, found: Map<string, Uint8Array[]>): void {
  for (const block of blocksIn(b, 0)) {
    if (block.group || block.tag >= SYSTEM_TAG) continue;
    const cls = classOf(b, block.at);
    if (WANTED.has(cls)) found.get(cls)!.push(allocationPayload(b, block.at)!);
  }
}

/**
 * What an Archicad 17+ file says of itself, read by ranges from a file of `size` bytes;
 * `progress` hears how far through the file the walk is (0..1). Throws when it isn't one.
 */
export async function readPln(read: ReadRange, size: number, progress?: (fraction: number) => void): Promise<PlnInfo> {
  const file = new Windowed(read, size);
  if (!isRof(await file.at(0, 8))) throw new Error("not an Archicad 17 or later file");
  const found = new Map<string, Uint8Array[]>([...WANTED].map((c) => [c, []]));
  const groups: number[] = [];
  let pos = FIRST;
  let step = 0;
  while (pos + 16 <= size) {
    const head = await file.at(pos, Math.min(HEAD, size - pos));
    if (isAllocation(head, 0)) {
      const { bytes, tag } = allocation(head, 0);
      if (!bytes) break;
      if (tag < SYSTEM_TAG && pos + bytes <= size) {
        const cls = classOf(head, 0);
        if (WANTED.has(cls)) found.get(cls)!.push(allocationPayload(await file.at(pos, bytes), 0)!);
      }
      pos += bytes;
    } else if (isGroup(head, 0)) {
      groups.push(pos);
      pos += await groupLength(file, pos);
    } else pos += 16;
    if (progress && ++step % 4096 === 0) progress(pos / size);
  }
  if ([...found.values()].some((list) => !list.length)) {
    for (const at of groups) {
      const length = await groupLength(file, at);
      wantedIn(expandGroup(await file.at(at, length), 0), found);
    }
  }
  progress?.(1);
  const metas = found.get(META_CLASS)!.map(planMeta).filter((m) => m !== null);
  const meta = metas.sort((a, b) => (a.saved?.getTime() ?? 0) - (b.saved?.getTime() ?? 0)).at(-1) ?? null;
  const previews = found.get(PREVIEW_CLASS)!.map(previewPng).filter((p) => p !== null);
  const infos = found.get(INFO_CLASS)!.map(projectInfo).filter((f) => f !== null);
  return {
    savedWith: meta?.savedWith ?? null,
    startedIn: meta?.startedIn ?? null,
    saved: meta?.saved ?? null,
    started: meta?.started ?? null,
    preview: previews.at(-1) ?? null,
    fields: infos.at(-1) ?? [],
  };
}

// ---- the three objects ------------------------------------------------------------------------

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The PNG at `i`'s length, walking its chunks to IEND, or 0 when it is cut short. */
function pngLength(b: Uint8Array, i: number): number {
  let p = i + 8;
  while (p + 12 <= b.length) {
    const n = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    p += 12 + n;
    if (type === "IEND") return p <= b.length ? p - i : 0;
    if (!/^[A-Za-z]{4}$/.test(type)) return 0;
  }
  return 0;
}

/** The project preview: the first PNG in the object (a second is the credit picture), or null when none was saved. */
function previewPng(d: Uint8Array): PlnPreview | null {
  for (let i = 16; i + 24 < d.length; i++) {
    if (!PNG.every((x, k) => d[i + k] === x)) continue;
    const n = pngLength(d, i);
    if (!n) return null;
    const be = (o: number): number => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
    return { png: d.slice(i, i + n), width: be(i + 16), height: be(i + 20) };
  }
  return null;
}

/** A length-prefixed UTF-16 string at `o` (01 00, a u32 count of code units, the units), and where it ends. */
function utf16(d: Uint8Array, o: number): { text: string; end: number } | null {
  if (o + 6 > d.length || d[o] !== 1 || d[o + 1] !== 0) return null;
  const n = u32(d, o + 2);
  const end = o + 6 + 2 * n;
  if (end > d.length) return null;
  let text = "";
  for (let p = o + 6; p < end; p += 2) text += String.fromCharCode(u16(d, p));
  return { text, end };
}

/** A version stored as 29000 for Archicad 29 (an update may add to it: 23150), or null when it isn't one. */
function version(n: number): number | null {
  return n >= 10_000 && n < 100_000 ? Math.floor(n / 1000) : null;
}

/** A time stored as seconds since 1970, or null when it isn't a plausible one. */
function time(n: number): Date | null {
  return n > 946_684_800 && n < 4_102_444_800 ? new Date(n * 1000) : null;
}

/**
 * The plan's meta information: after the object header, the version it was last saved with, the
 * version it was started in and when, the version last saved with again and when (then its name,
 * and a list of the saves before).
 */
function planMeta(d: Uint8Array): { savedWith: number | null; startedIn: number | null; saved: Date | null; started: Date | null } | null {
  if (d.length < 68) return null;
  const savedWith = version(u32(d, 60)) ?? version(u32(d, 48));
  const startedIn = version(u32(d, 52));
  if (savedWith === null && startedIn === null) return null;
  return { savedWith, startedIn, started: time(u32(d, 56)), saved: time(u32(d, 64)) };
}

/** A count (01 00, u32) then that many pairs of strings, from `o`; null when the bytes there aren't one. */
function pairs(d: Uint8Array, o: number, empty: boolean): { list: [string, string][]; end: number } | null {
  if (o + 6 > d.length || d[o] !== 1 || d[o + 1] !== 0) return null;
  const n = u32(d, o + 2);
  if (n > 10_000 || (!n && !empty)) return null;
  const list: [string, string][] = [];
  let p = o + 6;
  for (let i = 0; i < n; i++) {
    const a = utf16(d, p);
    const b = a && utf16(d, a.end);
    if (!b) return null;
    list.push([a.text, b.text]);
    p = b.end;
  }
  return { list, end: p };
}

/**
 * Project Info: its fields as (label, key) pairs, then (key, value) pairs; then its custom fields
 * the same way. The lists are found by their shape: a run of label pairs whose keys the value
 * pairs that follow it all use.
 */
function projectInfo(d: Uint8Array): PlnField[] | null {
  for (let o = 16; o < Math.min(d.length, 4096); o++) {
    const labels = pairs(d, o, false);
    if (!labels) continue;
    const values = pairs(d, labels.end, false);
    const keys = new Set(labels.list.map(([, key]) => key));
    if (!values || !values.list.every(([key]) => keys.has(key))) continue;
    const fields = filled(labels.list, values.list);
    const customLabels = pairs(d, values.end, true);
    const customValues = customLabels && pairs(d, customLabels.end, true);
    if (customValues) fields.push(...filled(customLabels.list, customValues.list));
    return fields;
  }
  return null;
}

/** The fields with a value, in the labels' order. */
function filled(labels: [string, string][], values: [string, string][]): PlnField[] {
  const value = new Map(values);
  return labels
    .map(([label, key]) => ({ label, value: (value.get(key) ?? "").trim() }))
    .filter((f) => f.value !== "");
}
