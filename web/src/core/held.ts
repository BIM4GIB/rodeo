// Parts of a big drawing left in its file while it is open ("held"): the caches in 3D bodies (114)
// that nothing here reads (section 17, and 19, Parasolid's) and big pictures' bytes (14). In a
// large drawing they are most of it: 2.6 GB of the 2.9 GB a 1.6 GB event file holds.
//
// readContainerStream, given `hold`, leaves each such part out of its record as it opens and puts
// a 32-byte token in its place:
//   +0x00  8B   "RodeoHLD"
//   +0x08  u32  the HeldTable it is in (a number chosen at random, only meaningful in this page)
//   +0x0c  u32  its entry there
//   +0x10  u64  the part's length
//   +0x18  u32  what a picture's bytes are (MIME_*), 0 otherwise
//   +0x1c  u32  0
// and a body's section directory and the record's size are moved to match, so a record with a
// token reads as one whose held section is 32 bytes long. The entry says where the bytes are: in
// the file the drawing was opened from (a FileStream, which reads and decodes the chunks that hold
// them again), or in memory. Tokens travel with the record bytes, through edits, undo and copies.
//
// toBytes refuses a drawing with tokens; writeVwx writes one out with the parts put back, byte for
// byte as they were, and says where each landed in the file it wrote, so that once that file is
// the drawing's file the parts can be read from it (heldEntry(...).moveTo).

import { crc32, setU32, setU64, u16, u32 } from "./bytes.ts";
import type { ByteSource, Inflate } from "./container.ts";
import type { VwxDocument } from "./types.ts";

export const TOKEN = 32;
const MAGIC = [0x52, 0x6f, 0x64, 0x65, 0x6f, 0x48, 0x4c, 0x44];
export const MIME_NONE = 0;
export const MIME_PNG = 1;
export const MIME_JPEG = 2;

const BODY = 114;
const IMAGE = 14;
/** a body's section directory: 16 (u16 id, u32 offset) slots at +0x5a, offsets from +0x60; slot 0 is (count, end) */
const BODY_SECTIONS = 0x5a;
const BODY_BASE = 0x60;
const BODY_SLOTS = 16;
const BODY_DIRECTORY_END = BODY_SECTIONS + 6 * BODY_SLOTS;
/** the sections held, the first long enough */
const HELD_SECTIONS = [17, 19];
/** an image record's QuickTime description (its u32 size first), and where the picture starts after a plain one */
const IMAGE_DESC = 0x13a;
const IMAGE_DATA = 0x190;

/** how much of a record's start holdPlan looks at */
export const HOLD_HEAD = 0x1000;
/** parts shorter than this stay in their record */
export const HOLD_MIN = 64 << 10;
/** the most file bytes decoded in one go when reading parts back */
const READ_PIECE = 8 << 20;
/** how many bytes at each end of a part its check covers */
export const CHECK_SPAN = 64;

// ---- where held bytes are --------------------------------------------------

/** how many places in a chunk chunkSum samples, and how much at each */
const SUM_SAMPLES = 16;
const SUM_SPAN = 32;

/**
 * A check of a chunk's compressed bytes, from SUM_SAMPLES places across it: a file saved again
 * over the one a drawing was opened from (by Vectorworks, say) has different bytes all through
 * it, which a few samples catch at no cost to opening.
 */
export function chunkSum(block: Uint8Array): number {
  const sample = new Uint8Array(SUM_SAMPLES * SUM_SPAN + 4);
  const step = Math.max(0, block.length - SUM_SPAN) / (SUM_SAMPLES - 1);
  for (let i = 0; i < SUM_SAMPLES; i++) {
    const at = Math.round(i * step);
    sample.set(block.subarray(at, at + SUM_SPAN), i * SUM_SPAN);
  }
  setU32(sample, SUM_SAMPLES * SUM_SPAN, block.length);
  return crc32(sample);
}

/** Where each chunk of a .vwx file starts in the file (at its size prefix) and in its record stream, and a check of each (chunkSum). */
export class ChunkTable {
  readonly file: number[] = [];
  readonly raw: number[] = [];
  readonly sums: number[] = [];
  fileEnd = 0;
  rawEnd = 0;

  add(fileAt: number, compressed: number, rawLength: number, sum: number): void {
    this.file.push(fileAt);
    this.raw.push(this.rawEnd);
    this.sums.push(sum);
    this.fileEnd = fileAt + 4 + compressed;
    this.rawEnd += rawLength;
  }

  get count(): number {
    return this.file.length;
  }

  fileStart(i: number): number {
    return i < this.file.length ? this.file[i] : this.fileEnd;
  }

  rawStart(i: number): number {
    return i < this.raw.length ? this.raw[i] : this.rawEnd;
  }

  /** The chunk holding stream offset `at`. */
  chunkAt(at: number): number {
    let lo = 0;
    let hi = this.raw.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.raw[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

/** Bytes of a record stream, read back on demand. */
export interface RawSource {
  read(start: number, end: number): Promise<Uint8Array>;
}

/** The record stream of a .vwx file, read back from the file: the chunks that hold a range are read and decoded again. */
export class FileStream implements RawSource {
  constructor(
    private src: ByteSource,
    readonly chunks: ChunkTable,
    private readonly inflate: Inflate,
    /** the file again, after a read of it failed (as a browser's does once the file has changed on disk): its bytes must still be what they were */
    private readonly refresh: (() => Promise<ByteSource | null>) | null = null,
  ) {}

  /** The file it reads, when it is one. */
  get file(): Blob | undefined {
    return this.src.blob;
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    const out = new Uint8Array(end - start);
    if (end <= start) return out;
    const t = this.chunks;
    const last = t.chunkAt(end - 1);
    const pieces: Promise<void>[] = [];
    for (let i = t.chunkAt(start); i <= last; ) {
      let j = i;
      while (j < last && t.fileStart(j + 2) - t.fileStart(i) <= READ_PIECE) j++;
      const first = i;
      pieces.push(
        this.decode(first, j).then((raw) => {
          const from = t.rawStart(first);
          const a = Math.max(start, from);
          const b = Math.min(end, from + raw.length);
          out.set(raw.subarray(a - from, b - from), a - start);
        }),
      );
      i = j + 1;
    }
    await Promise.all(pieces);
    return out;
  }

  /** Chunks first..last decoded. */
  private async decode(first: number, last: number): Promise<Uint8Array> {
    const t = this.chunks;
    const at = t.fileStart(first);
    const end = t.fileStart(last + 1);
    let bytes: Uint8Array;
    try {
      bytes = await this.src.read(at, end);
    } catch (err) {
      const again = this.refresh && (await this.refresh());
      if (!again || again.size !== this.src.size) throw changed(err);
      this.src = again;
      bytes = await this.src.read(at, end);
    }
    // each chunk's size prefix where the table has it, and its bytes as they were: a file changed since is not read as if it were the same
    for (let k = first; k <= last; k++) {
      const p = t.fileStart(k) - at;
      const next = t.fileStart(k + 1) - at;
      if (p + 4 > bytes.length || u32(bytes, p) !== next - p - 4 || chunkSum(bytes.subarray(p + 4, next)) !== t.sums[k]) throw changed(null);
    }
    const raw = await this.inflate(bytes, first, at);
    if (raw.length !== t.rawStart(last + 1) - t.rawStart(first)) throw changed(null);
    return raw;
  }
}

function changed(cause: unknown): Error {
  const why = cause instanceof Error ? ` (${cause.message})` : "";
  return new Error(`the drawing's file has changed on disk since it was opened, and the parts of it left there can't be read${why}`);
}

/** A held part: its length, where its bytes are, and a check of its ends. */
export class HeldEntry {
  private source: RawSource | null;
  private at: number;
  private bytes: Uint8Array | null = null;

  constructor(
    readonly length: number,
    source: RawSource,
    at: number,
    /** crc32 of its first and last CHECK_SPAN bytes */
    private readonly check: number,
    /** what a picture's bytes are (MIME_*) */
    readonly mime = MIME_NONE,
  ) {
    this.source = source;
    this.at = at;
  }

  /** Bytes [start, end) of the part. */
  async read(start = 0, end = this.length): Promise<Uint8Array> {
    if (this.bytes) return this.bytes.subarray(start, end);
    const got = await this.source!.read(this.at + start, this.at + end);
    // a read that covers both ends is checked whole; the writer's pieces check theirs (checkEnds)
    if (start === 0 && end === this.length) this.verify(got.subarray(0, CHECK_SPAN), got.subarray(Math.max(0, got.length - CHECK_SPAN)));
    return got;
  }

  /** Checks a part read in pieces: its first CHECK_SPAN bytes and its last. */
  verify(head: Uint8Array, tail: Uint8Array): void {
    if (endsCheck(head, tail) !== this.check) throw changed(null);
  }

  /** Where its bytes are read from; null once they are in memory. */
  get from(): RawSource | null {
    return this.source;
  }

  /** From now on its bytes are read from `source` at stream offset `at` (a file just written with it there). */
  moveTo(source: RawSource, at: number): void {
    this.source = source;
    this.at = at;
    this.bytes = null;
  }

  /** Keeps its bytes in memory from now on: the file they are read from is about to change. */
  async load(): Promise<void> {
    if (this.bytes) return;
    this.bytes = await this.read();
    this.source = null;
  }
}

/** crc32 of a part's first and last CHECK_SPAN bytes. */
function endsCheck(head: Uint8Array, tail: Uint8Array): number {
  const both = new Uint8Array(head.length + tail.length);
  both.set(head);
  both.set(tail, head.length);
  return crc32(both);
}

/** The parts held from one drawing as it opened, found again by the number in their tokens. */
export class HeldTable {
  readonly id: number;
  readonly entries: HeldEntry[] = [];

  constructor() {
    let id: number;
    do id = crypto.getRandomValues(new Uint32Array(1))[0];
    while (id === 0 || tables.has(id));
    this.id = id;
    tables.set(id, this);
  }
}

/** every table made in this page: they cost little (their bytes stay in the files), and tokens may be anywhere (undo, a copy) */
const tables = new Map<number, HeldTable>();

/** The held tables, for finding the entries read from a file about to be written over. */
export function heldTables(): Iterable<HeldTable> {
  return tables.values();
}

// ---- tokens ---------------------------------------------------------------

/** A token's contents. */
export interface HeldRef {
  readonly table: number;
  readonly index: number;
  readonly length: number;
  readonly mime: number;
}

/** The entry a token names; throws when this page has no such entry (a token from elsewhere). */
export function heldEntry(ref: HeldRef): HeldEntry {
  const entry = tables.get(ref.table)?.entries[ref.index];
  if (!entry || entry.length !== ref.length) throw new Error("part of this drawing was left in a file this window no longer has");
  return entry;
}

function isToken(d: Uint8Array, at: number): boolean {
  if (at < 0 || at + TOKEN > d.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (d[at + i] !== MAGIC[i]) return false;
  return true;
}

function readToken(d: Uint8Array, at: number): HeldRef {
  return { table: u32(d, at + 8), index: u32(d, at + 12), length: u32(d, at + 16) + u32(d, at + 20) * 2 ** 32, mime: u32(d, at + 24) };
}

/** What `part` names when it is exactly a token (a held section's bytes as its record has them); null otherwise. */
export function tokenOf(part: Uint8Array): HeldRef | null {
  return part.length === TOKEN && isToken(part, 0) ? readToken(part, 0) : null;
}

function writeToken(d: Uint8Array, at: number, ref: HeldRef): void {
  d.set(MAGIC, at);
  setU32(d, at + 8, ref.table);
  setU32(d, at + 12, ref.index);
  setU32(d, at + 16, ref.length % 2 ** 32);
  setU32(d, at + 20, Math.floor(ref.length / 2 ** 32));
  setU32(d, at + 24, ref.mime);
  setU32(d, at + 28, 0);
}

/** A body's sections, read from `d` (which may be only its start) for a record `size` bytes long: [id, start, end) sorted by start. */
function sections(d: Uint8Array, size: number): [number, number, number][] | null {
  if (d.length < BODY_DIRECTORY_END) return null;
  const count = u16(d, BODY_SECTIONS);
  const end = BODY_BASE + u32(d, BODY_SECTIONS + 2);
  if (count === 0 || count >= BODY_SLOTS || end > size) return null;
  const list: [number, number][] = [];
  for (let i = 1; i <= count; i++) {
    const id = u16(d, BODY_SECTIONS + 6 * i);
    if (id !== 0xffff) list.push([id, BODY_BASE + u32(d, BODY_SECTIONS + 6 * i + 2)]);
  }
  list.sort((a, b) => a[1] - b[1]);
  return list.map(([id, at], i) => [id, at, i + 1 < list.length ? list[i + 1][1] : end]);
}

/** Where an image record's picture starts, given at least its first IMAGE_DESC + 4 bytes. */
function imageStart(d: Uint8Array, size: number): number {
  const desc = d.length >= IMAGE_DESC + 4 ? IMAGE_DESC + u32(d, IMAGE_DESC) : 0;
  return desc > IMAGE_DATA && desc < size ? desc : IMAGE_DATA;
}

function mimeAt(d: Uint8Array, at: number): number {
  if (at + 4 > d.length) return MIME_NONE;
  if (d[at] === 0x89 && d[at + 1] === 0x50 && d[at + 2] === 0x4e && d[at + 3] === 0x47) return MIME_PNG;
  if (d[at] === 0xff && d[at + 1] === 0xd8) return MIME_JPEG;
  return MIME_NONE;
}

export function mimeName(mime: number): string | undefined {
  return mime === MIME_PNG ? "image/png" : mime === MIME_JPEG ? "image/jpeg" : undefined;
}

/** A record's token: where it is and what it names; null when it has none. */
export function heldPart(d: Uint8Array): { at: number; ref: HeldRef } | null {
  if (d.length < 0x50) return null;
  if (d[0x19] === BODY) {
    const secs = sections(d, d.length);
    for (const [, start, end] of secs ?? []) if (end - start === TOKEN && isToken(d, start)) return { at: start, ref: readToken(d, start) };
    return null;
  }
  if (d[0x19] === IMAGE) {
    const start = d.length - TOKEN;
    return start >= IMAGE_DATA && imageStart(d, d.length) === start && isToken(d, start) ? { at: start, ref: readToken(d, start) } : null;
  }
  return null;
}

/** Whether any of `records` has a token. */
export function anyHeld(records: readonly Uint8Array[]): boolean {
  for (const d of records) if ((d[0x19] === BODY || d[0x19] === IMAGE) && d.length >= 0x50 && heldPart(d)) return true;
  return false;
}

/** Moves the offsets in a body's section directory that are at or past `from` by `delta`. */
function shiftSections(d: Uint8Array, from: number, delta: number): void {
  const count = u16(d, BODY_SECTIONS);
  for (let i = 0; i <= count && i < BODY_SLOTS; i++) {
    const slot = BODY_SECTIONS + 6 * i + 2;
    if (i > 0 && u16(d, slot - 2) === 0xffff) continue;
    const rel = u32(d, slot);
    if (BODY_BASE + rel >= from) setU32(d, slot, rel + delta);
  }
}

function setSize(d: Uint8Array, size: number): void {
  setU64(d, 0, BigInt(size));
}

// ---- holding parts as a drawing opens -------------------------------------

/** The part of a record to hold: [start, end) of it, and a picture's kind. */
export interface HoldPlan {
  readonly start: number;
  readonly end: number;
  readonly mime: number;
}

/** The part of a record `size` bytes long to hold, from `head`, its first HOLD_HEAD bytes (or all of it); null to keep it whole. Parts shorter than `min` aren't held. */
export function holdPlan(head: Uint8Array, size: number, min = HOLD_MIN): HoldPlan | null {
  if (head.length < 0x50 || size < min) return null;
  if (head[0x19] === BODY) {
    const secs = sections(head, size);
    if (!secs) return null;
    for (const id of HELD_SECTIONS) {
      const s = secs.find(([sid]) => sid === id);
      if (s && s[2] - s[1] >= Math.max(min, TOKEN) && s[1] >= BODY_DIRECTORY_END) return { start: s[1], end: s[2], mime: MIME_NONE };
    }
    return null;
  }
  if (head[0x19] === IMAGE && head.length >= IMAGE_DESC + 4) {
    const start = imageStart(head, size);
    if (size - start < Math.max(min, TOKEN) || start >= head.length) return null;
    return { start, end: size, mime: mimeAt(head, start) };
  }
  return null;
}

/**
 * Holds parts of a drawing's records as it opens, in `table`, reading them back from `source`
 * (the stream of the file being opened).
 */
export class Holder {
  readonly table = new HeldTable();

  constructor(
    private readonly source: RawSource,
    /** parts shorter than this stay in their record */
    readonly min = HOLD_MIN,
  ) {}

  plan(head: Uint8Array, size: number): HoldPlan | null {
    return holdPlan(head, size, this.min);
  }

  /**
   * A record whose part `plan` is held, from `record` (as long as it is less the part, plus
   * TOKEN, its bytes before and after the part in place, a TOKEN-long gap between), `at` (where
   * the part started in the stream) and the part's first and last CHECK_SPAN bytes.
   */
  seal(record: Uint8Array, plan: HoldPlan, at: number, head: Uint8Array, tail: Uint8Array): Uint8Array {
    const length = plan.end - plan.start;
    const index = this.table.entries.length;
    this.table.entries.push(new HeldEntry(length, this.source, at, endsCheck(head, tail), plan.mime));
    writeToken(record, plan.start, { table: this.table.id, index, length, mime: plan.mime });
    setSize(record, record.length);
    if (record[0x19] === BODY) shiftSections(record, plan.end, TOKEN - length);
    return record;
  }
}

// ---- pictures --------------------------------------------------------------

/** held pictures' bytes, while withHeldImages has them read back */
const loadedImages = new Map<HeldEntry, Uint8Array>();

/**
 * Runs `fn` with the bytes of the held pictures `doc` shows in memory, readable at once as their
 * shapes' `image` (for code that can't wait for them, an export), then lets them go.
 */
export async function withHeldImages<T>(doc: Pick<VwxDocument, "layers" | "objects">, fn: () => T | Promise<T>): Promise<T> {
  const wanted = new Set<HeldEntry>();
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      const ref = o.shape?.heldImage;
      const entry = ref && tables.get(ref.table)?.entries[ref.index];
      if (entry) wanted.add(entry);
    }
  }
  const mine: HeldEntry[] = [];
  try {
    for (const entry of wanted) {
      if (loadedImages.has(entry)) continue;
      loadedImages.set(entry, await entry.read());
      mine.push(entry);
    }
    return await fn();
  } finally {
    for (const entry of mine) loadedImages.delete(entry);
  }
}

/** A held picture's bytes while withHeldImages has them; undefined otherwise (or for a token from elsewhere). */
export function loadedImage(ref: HeldRef): Uint8Array | undefined {
  const entry = tables.get(ref.table)?.entries[ref.index];
  return entry && loadedImages.get(entry);
}

// ---- putting parts back ---------------------------------------------------

/** A record with a token, put back together: its bytes before the part (size and directory as they were), the part, then its bytes after. */
export function expansion(d: Uint8Array, part: { at: number; ref: HeldRef }): { before: Uint8Array; entry: HeldEntry; after: Uint8Array; size: number } {
  const entry = heldEntry(part.ref);
  const size = d.length - TOKEN + entry.length;
  const before = d.slice(0, part.at);
  setSize(before, size);
  if (d[0x19] === BODY) shiftSections(before, part.at + TOKEN, entry.length - TOKEN);
  return { before, entry, after: d.subarray(part.at + TOKEN), size };
}

/** Records with their held parts put back, for those that must carry them (a copy to another window). */
export async function expandRecords(records: readonly Uint8Array[]): Promise<Uint8Array[]> {
  return Promise.all(
    records.map(async (d) => {
      const part = heldPart(d);
      if (!part) return d;
      const x = expansion(d, part);
      const out = new Uint8Array(x.size);
      out.set(x.before);
      out.set(await x.entry.read(), x.before.length);
      out.set(x.after, x.before.length + x.entry.length);
      return out;
    }),
  );
}
