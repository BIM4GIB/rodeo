// Outer .vwx container: big-endian file header, settings block, Snappy chunks.
// Port of openvwx/container.py.
//
// Layout (file offsets):
//   0x0000  u32be  settings block length
//   0x0008  u32be  settings block offset (0x94)
//   0x000c  u16be  length of the version field, then ASCII "VW<created> VW<saved>"
//   0x003a  ASCII  "VectorWorks"
//   0x0050  u32be  build number
//   0x0054  u32be  total file size (rewritten on save)
//   0x0058  u32be  unknown (preserved)
//   0x005c  u32be  unknown (preserved)
//   0x0060  ASCII  "BUILD: <n>"
//   0x0094  ...    settings block (little-endian; starts with its own length)
//   0x0094+len     body: repeated [u32le compressed size][raw Snappy block]
//                  each block decompresses to <= 1 MiB; concatenated they form
//                  the record stream (see records.ts)
//
// readContainer takes the whole file. readContainerStream reads it a slice at a time instead,
// decodes several slices at once (in workers, when given an inflate that uses them) and cuts the
// stream straight into records, so neither the file nor the stream is ever in memory whole: a
// browser can neither read a file over about 4 GB at once nor hold one buffer much bigger.
// Given `hold`, it also leaves the big parts nothing reads in the file (held.ts), and writeVwx
// writes a drawing out a slice at a time, putting them back.

import { concat, readAscii, setU32, setU32be, setU64, u32, u32be, u64 } from "./bytes.ts";
import { CHECK_SPAN, ChunkTable, chunkSum, FileStream, HOLD_HEAD, HeldEntry, type HeldTable, type HoldPlan, Holder, TOKEN, expansion, heldPart } from "./held.ts";
import { unitsName } from "./settings.ts";
import { blockLength, compress, decompress, decompressInto } from "./snappy.ts";

export interface Container {
  /** everything before the first Snappy chunk (copied) */
  header: Uint8Array;
  createdWith: string;
  savedWith: string;
  build: number;
  /** decompressed record stream */
  raw: Uint8Array;
  chunkCount: number;
  /** length unit name from the settings block, e.g. "Millimeters" ("" if not found) */
  units: string;
}

const CHUNK_SIZE = 1 << 20;
const FILE_SIZE_OFFSET = 0x54;

function hex(n: number): string {
  return "0x" + n.toString(16);
}

function hasSignature(data: Uint8Array): boolean {
  let window = "";
  const end = Math.min(0x50, data.length);
  for (let i = 0x30; i < end; i++) window += String.fromCharCode(data[i]);
  return window.includes("VectorWorks");
}

function isAsciiLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/**
 * The length unit's name: from its own field (core/settings.ts), or else the first UTF-16LE run of
 * at least 4 ASCII letters in header bytes 0x94..0x300.
 */
export function findUnits(header: Uint8Array): string {
  const named = unitsName(header);
  if (named !== null) return named;
  const end = Math.min(0x300, header.length);
  for (let p = 0x94; p < end; p++) {
    let k = 0;
    while (p + 2 * k + 1 < end && isAsciiLetter(header[p + 2 * k]) && header[p + 2 * k + 1] === 0) {
      k++;
    }
    if (k >= 4) {
      let s = "";
      for (let i = 0; i < k; i++) s += String.fromCharCode(header[p + 2 * i]);
      return s;
    }
  }
  return "";
}

function safeDecompress(data: Uint8Array, pos: number, where: string): { data: Uint8Array; end: number } {
  try {
    return decompress(data, pos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`bad chunk ${where}: ${msg}`);
  }
}

interface Head {
  /** where the first chunk starts */
  readonly body: number;
  readonly createdWith: string;
  readonly savedWith: string;
  readonly build: number;
}

/** Reads the header of a file `size` bytes long from `data`, its first bytes (all of them up to the body, when it says where that is). */
function readHead(data: Uint8Array, size: number): Head {
  if (size < 0x94) throw new Error("file too small to be a .vwx document");
  const settingsLen = u32be(data, 0);
  const settingsOff = u32be(data, 8);
  if (!hasSignature(data)) {
    throw new Error("missing VectorWorks signature; not a VW 2018+ file?");
  }
  const versions = readAscii(data, 0x0e, 0x20).split(/\s+/).filter((s) => s.length > 0);
  const declared = u32be(data, FILE_SIZE_OFFSET);
  // a u32: a file of 4 GB or more can only keep the low 32 bits of its size there
  if (declared !== size % 2 ** 32) {
    throw new Error(`header says ${declared} bytes, file has ${size}`);
  }
  return { body: settingsOff + settingsLen, createdWith: versions[0] ?? "", savedWith: versions[1] ?? "", build: u32be(data, 0x50) };
}

export function readContainer(data: Uint8Array): Container {
  const { body, createdWith, savedWith, build } = readHead(data, data.length);
  const parts: Uint8Array[] = [];
  let pos = body;
  let chunks = 0;
  while (pos < data.length) {
    const where = `${chunks} at ${hex(pos)}`;
    if (pos + 4 > data.length) throw new Error(`bad chunk ${where}: truncated size prefix`);
    const csize = u32(data, pos);
    const res = safeDecompress(data, pos + 4, where);
    if (res.end !== pos + 4 + csize) throw new Error(`bad chunk ${where}: size mismatch`);
    parts.push(res.data);
    pos = res.end;
    chunks++;
  }

  const header = data.slice(0, body);
  return {
    header,
    createdWith,
    savedWith,
    build,
    raw: concat(parts),
    chunkCount: chunks,
    units: findUnits(header),
  };
}

/** A drawing's bytes as it opens, read a slice at a time. */
export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<Uint8Array>;
  /** the file it reads, when it is one */
  readonly blob?: Blob;
}

/** A file (or any blob) as a ByteSource: each slice is read from it when asked for. */
export function blobSource(blob: Blob): ByteSource {
  return { size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()), blob };
}

/** Bytes already in memory as a ByteSource. */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (start, end) => bytes.subarray(start, end) };
}

/** A container read by readContainerStream: the record stream comes already cut into records. */
export interface OpenedContainer extends Omit<Container, "raw"> {
  /** each record's bytes, in stream order */
  readonly records: Uint8Array[];
  /** the parts left in the file (`hold`), and the file's stream they are read from; null when none were */
  readonly held: { readonly table: HeldTable; readonly stream: FileStream } | null;
}

/**
 * Decodes `chunks`, a run of whole chunks ([u32le size][Snappy block] each), into their part of
 * the record stream. `first` is the first one's number and `at` its file offset, for errors.
 */
export type Inflate = (chunks: Uint8Array, first: number, at: number) => Promise<Uint8Array>;

export interface StreamOptions {
  /** decodes slices of chunks; by default on this thread */
  readonly inflate?: Inflate;
  /** how many slices are read ahead and decoding at once */
  readonly ahead?: number;
  /** how many bytes of the file are read at once (SLICE) */
  readonly slice?: number;
  /** the share of the file read so far, 0 .. 1 */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  /** leave the big parts nothing reads in the file (held.ts): `src` must stay readable while the drawing is open */
  readonly hold?: boolean;
  /** parts shorter than this aren't held (HOLD_MIN) */
  readonly holdMin?: number;
  /** `src` again, after a read of it failed (a browser's file once it has changed on disk), for held parts */
  readonly refresh?: () => Promise<ByteSource | null>;
}

/** how much of the file is read at once (whole chunks of it are decoded together) */
const SLICE = 8 << 20;

/** The chunks of inflate's `chunks`, decoded into one buffer. */
export function inflateChunks(chunks: Uint8Array, first = 0, at = 0): Uint8Array {
  const blocks: { start: number; end: number; size: number; where: string }[] = [];
  let total = 0;
  for (let p = 0, n = first; p < chunks.length; n++) {
    const where = `${n} at ${hex(at + p)}`;
    if (p + 4 > chunks.length) throw new Error(`bad chunk ${where}: truncated size prefix`);
    const end = p + 4 + u32(chunks, p);
    if (end > chunks.length) throw new Error(`bad chunk ${where}: truncated`);
    let length: { size: number; start: number };
    try {
      length = blockLength(chunks.subarray(0, end), p + 4);
    } catch (err) {
      throw new Error(`bad chunk ${where}: ${err instanceof Error ? err.message : String(err)}`);
    }
    blocks.push({ start: length.start, end, size: length.size, where });
    total += length.size;
    p = end;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    let end: number;
    try {
      end = decompressInto(chunks.subarray(0, b.end), b.start, out.subarray(o, o + b.size));
    } catch (err) {
      throw new Error(`bad chunk ${b.where}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (end !== b.end) throw new Error(`bad chunk ${b.where}: size mismatch`);
    o += b.size;
  }
  return out;
}

/** How many bytes of `slice` are whole chunks, and how many chunks that is. */
function wholeChunks(slice: Uint8Array): { bytes: number; count: number } {
  let p = 0;
  let count = 0;
  while (p + 4 <= slice.length && p + 4 + u32(slice, p) <= slice.length) {
    p += 4 + u32(slice, p);
    count++;
  }
  return { bytes: p, count };
}

/** Adds the whole chunks of `chunks`, found at file offset `at`, to `table`; stops at one that doesn't read (decoding it says why). */
function addChunks(table: ChunkTable, chunks: Uint8Array, at: number): void {
  for (let p = 0; p + 4 <= chunks.length; ) {
    const end = p + 4 + u32(chunks, p);
    if (end > chunks.length) return;
    let raw: number;
    try {
      raw = blockLength(chunks.subarray(0, end), p + 4).size;
    } catch {
      return;
    }
    table.add(at + p, end - p - 4, raw, chunkSum(chunks.subarray(p + 4, end)));
    p = end;
  }
}

/**
 * Reads a .vwx file from `src` a slice at a time: up to `ahead` slices decode at once, and each,
 * in turn, is cut into records as it comes back.
 */
export async function readContainerStream(src: ByteSource, options: StreamOptions = {}): Promise<OpenedContainer> {
  const { signal, onProgress } = options;
  const inflate: Inflate = options.inflate ?? (async (chunks, first, at) => inflateChunks(chunks, first, at));
  const ahead = Math.max(1, options.ahead ?? 1);
  const sliceBytes = options.slice ?? SLICE;
  const size = src.size;
  let start = await src.read(0, Math.min(size, 0x10000));
  const head = readHead(start, size);
  if (head.body > start.length) start = await src.read(0, Math.min(size, head.body));
  const header = start.slice(0, head.body);
  const table = options.hold ? new ChunkTable() : null;
  const stream = table ? new FileStream(src, table, inflate, options.refresh ?? null) : null;
  const holder = stream ? new Holder(stream, options.holdMin) : null;
  const carver = new RecordCarver(holder);
  /** the slices decoding, in file order, each with where it ends */
  const decoding: { readonly stream: Promise<Uint8Array>; readonly end: number }[] = [];
  let pos = head.body;
  let chunks = 0;
  while (pos < size || decoding.length) {
    signal?.throwIfAborted();
    if (pos < size && decoding.length < ahead) {
      let slice = await src.read(pos, Math.min(size, pos + sliceBytes));
      let whole = wholeChunks(slice);
      if (whole.count === 0) {
        // a chunk longer than a slice, or the file ends inside one
        const where = `${chunks} at ${hex(pos)}`;
        if (slice.length < 4) throw new Error(`bad chunk ${where}: truncated size prefix`);
        const need = 4 + u32(slice, 0);
        if (pos + need > size) throw new Error(`bad chunk ${where}: truncated`);
        slice = await src.read(pos, pos + need);
        whole = { bytes: need, count: 1 };
      }
      const run = slice.subarray(0, whole.bytes);
      if (table) addChunks(table, run, pos);
      const decoded = inflate(run, chunks, pos);
      // a failure is seen when its turn comes, not unhandled meanwhile
      decoded.catch(() => {});
      pos += whole.bytes;
      chunks += whole.count;
      decoding.push({ stream: decoded, end: pos });
      continue;
    }
    const next = decoding.shift()!;
    carver.push(await next.stream);
    onProgress?.((next.end - head.body) / Math.max(1, size - head.body));
  }
  return {
    header,
    createdWith: head.createdWith,
    savedWith: head.savedWith,
    build: head.build,
    records: carver.finish(),
    chunkCount: chunks,
    units: findUnits(header),
    held: holder && stream && holder.table.entries.length ? { table: holder.table, stream } : null,
  };
}

/** records up to this long share a SLAB-sized buffer with their neighbours; longer ones have their own */
const SHARED_MAX = 64 << 10;
const SLAB = 8 << 20;

/**
 * Cuts the record stream, arriving a piece at a time, into records: each one's bytes copied out,
 * the small ones into a few large buffers. With a Holder, a long record's start is looked at
 * first (holdPlan), and a part of it to hold is passed over rather than copied.
 */
export class RecordCarver {
  private readonly records: Uint8Array[] = [];
  private slab = new Uint8Array(0);
  private used = 0;
  /** the record being cut: its size (0 between records) and how much of it has come */
  private size = 0;
  private filled = 0;
  /** where its bytes go: all of them, or (with a plan) all but its held part */
  private record: Uint8Array | null = null;
  /** its start, while it is read to decide whether to hold part of it */
  private head: Uint8Array | null = null;
  private plan: HoldPlan | null = null;
  /** the held part's first and last CHECK_SPAN bytes, as they pass */
  private readonly partHead = new Uint8Array(CHECK_SPAN);
  private readonly partTail = new Uint8Array(CHECK_SPAN);
  /** the start of a record whose size field is split between pieces */
  private readonly lead = new Uint8Array(8);
  private leadLength = 0;
  /** the stream offsets of the record being cut and of the record after it */
  private recordAt = 0;
  private at = 0;

  constructor(private readonly holder: Holder | null = null) {}

  push(piece: Uint8Array): void {
    let p = 0;
    while (p < piece.length) {
      if (this.size) {
        p = this.fill(piece, p);
        continue;
      }
      if (this.leadLength === 0 && piece.length - p >= 8) {
        this.begin(Number(u64(piece, p)));
        continue;
      }
      const n = Math.min(8 - this.leadLength, piece.length - p);
      this.lead.set(piece.subarray(p, p + n), this.leadLength);
      this.leadLength += n;
      p += n;
      if (this.leadLength < 8) continue;
      this.leadLength = 0;
      this.begin(Number(u64(this.lead, 0)));
      this.fill(this.lead, 0);
    }
  }

  finish(): Uint8Array[] {
    if (this.leadLength) throw new Error(`truncated record header at stream offset ${hex(this.at)}`);
    if (this.size) throw new Error(`bad record size ${this.size} at stream offset ${hex(this.recordAt)}`);
    return this.records;
  }

  /** Starts a record `size` bytes long. */
  private begin(size: number): void {
    if (size < 0x50) throw new Error(`bad record size ${size} at stream offset ${hex(this.at)}`);
    this.size = size;
    this.filled = 0;
    this.recordAt = this.at;
    this.at += size;
    if (this.holder && size >= this.holder.min) {
      this.head = new Uint8Array(Math.min(size, HOLD_HEAD));
      this.record = null;
    } else {
      this.record = this.allocate(size);
    }
  }

  /** Takes the record's bytes from piece[p..]; returns where they end. */
  private fill(piece: Uint8Array, p: number): number {
    const n = Math.min(this.size - this.filled, piece.length - p);
    let bytes = piece.subarray(p, p + n);
    if (this.head) {
      const k = Math.min(this.head.length - this.filled, bytes.length);
      this.head.set(bytes.subarray(0, k), this.filled);
      this.filled += k;
      bytes = bytes.subarray(k);
      if (this.filled < this.head.length) return p + n;
      this.decide();
    }
    this.place(bytes, this.filled);
    this.filled += bytes.length;
    if (this.filled === this.size) this.end();
    return p + n;
  }

  /** The record's start has come: whether part of it is held, and where its bytes go. */
  private decide(): void {
    const head = this.head!;
    this.head = null;
    this.plan = this.holder!.plan(head, this.size);
    this.record = this.plan ? new Uint8Array(this.size - (this.plan.end - this.plan.start) + TOKEN) : this.allocate(this.size);
    this.place(head, 0);
  }

  /** Puts `bytes`, the record's from `from` on, where they go. */
  private place(bytes: Uint8Array, from: number): void {
    const plan = this.plan;
    if (!plan) {
      this.record!.set(bytes, from);
      return;
    }
    const to = from + bytes.length;
    if (from < plan.start) this.record!.set(bytes.subarray(0, Math.min(to, plan.start) - from), from);
    const a = Math.max(from, plan.start);
    const b = Math.min(to, plan.end);
    if (a < b) this.check(bytes.subarray(a - from, b - from), a - plan.start, plan.end - plan.start);
    if (to > plan.end) {
      const c = Math.max(from, plan.end);
      this.record!.set(bytes.subarray(c - from), c - plan.end + plan.start + TOKEN);
    }
  }

  /** Keeps what the held part's check covers of `bytes`, its bytes from `at` on. */
  private check(bytes: Uint8Array, at: number, length: number): void {
    if (at < CHECK_SPAN) this.partHead.set(bytes.subarray(0, CHECK_SPAN - at), at);
    const tail = length - CHECK_SPAN;
    const end = at + bytes.length;
    if (end > tail) {
      const from = Math.max(at, tail);
      this.partTail.set(bytes.subarray(from - at), from - tail);
    }
  }

  private end(): void {
    let record = this.record!;
    if (this.plan) record = this.holder!.seal(record, this.plan, this.recordAt + this.plan.start, this.partHead, this.partTail);
    this.records.push(record);
    this.record = null;
    this.plan = null;
    this.size = 0;
  }

  private allocate(size: number): Uint8Array {
    if (size > SHARED_MAX) return new Uint8Array(size);
    if (this.used + size > this.slab.length) {
      this.slab = new Uint8Array(SLAB);
      this.used = 0;
    }
    this.used += size;
    return this.slab.subarray(this.used - size, this.used);
  }
}

/** Rebuild a .vwx file from an original header and a record stream. */
export function writeContainer(header: Uint8Array, raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [header];
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const block = compress(raw.subarray(i, i + CHUNK_SIZE));
    const prefix = new Uint8Array(4);
    setU32(prefix, 0, block.length);
    parts.push(prefix, block);
  }
  const out = concat(parts);
  setU32be(out, FILE_SIZE_OFFSET, out.length);
  return out;
}

/** Compresses `raw` into chunks as writeContainer does, CHUNK_SIZE of it in each: [u32le size][Snappy block] each. */
export function deflateChunks(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < raw.length; i += CHUNK_SIZE) {
    const block = compress(raw.subarray(i, i + CHUNK_SIZE));
    const prefix = new Uint8Array(4);
    setU32(prefix, 0, block.length);
    parts.push(prefix, block);
  }
  return concat(parts);
}

/** Compresses a run of the record stream (a whole number of CHUNK_SIZE pieces, but at its end) as deflateChunks does. */
export type Deflate = (raw: Uint8Array) => Promise<Uint8Array>;

/** Where writeVwx writes a file, in order. */
export interface VwxSink {
  write(bytes: Uint8Array): Promise<void>;
  /** puts `bytes` at `at`, over what was written there (the file's size in its header, once it is known) */
  patch(at: number, bytes: Uint8Array): Promise<void>;
}

export interface WriteOptions {
  /** compresses runs of the stream; by default on this thread */
  readonly deflate?: Deflate;
  /** how many runs compress at once */
  readonly ahead?: number;
  /** the share of the stream written so far, 0 .. 1 */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** What writeVwx wrote. */
export interface Written {
  readonly size: number;
  /** where its chunks are */
  readonly chunks: ChunkTable;
  /** each held part written, and where in the record stream (its first copy's, when copies share one) */
  readonly placed: ReadonlyMap<HeldEntry, number>;
}

/** how much of the stream is compressed in one go: whole chunks */
const RUN = 8 * CHUNK_SIZE;
/** how much of a held part is read back at once */
const PART_PIECE = 8 * CHUNK_SIZE;

/**
 * Writes a .vwx file to `sink` a run at a time: the same bytes writeContainer(header,
 * joinRecords(records)) makes, held parts put back, without the stream or the file ever being in
 * memory whole. `records` must stay as they are while it writes (a drawing's are: edits swap in
 * new buffers). Fails, before writing anything, on a token whose part this page doesn't have.
 */
export async function writeVwx(header: Uint8Array, records: readonly Uint8Array[], sink: VwxSink, options: WriteOptions = {}): Promise<Written> {
  const deflate: Deflate = options.deflate ?? (async (raw) => deflateChunks(raw));
  const ahead = Math.max(1, options.ahead ?? 1);
  const { signal, onProgress } = options;
  const parts = records.map((d) => {
    const part = heldPart(d);
    return part ? expansion(d, part) : null;
  });
  let total = 0;
  records.forEach((d, i) => (total += parts[i]?.size ?? d.length));
  const chunks = new ChunkTable();
  const placed = new Map<HeldEntry, number>();
  await sink.write(header.slice());
  let fileAt = header.length;
  let rawAt = 0;
  let run = new Uint8Array(Math.min(RUN, Math.max(1, total)));
  let used = 0;
  const compressing: Promise<Uint8Array>[] = [];

  const flushOne = async (): Promise<void> => {
    const out = await compressing.shift()!;
    addChunks(chunks, out, fileAt);
    await sink.write(out);
    fileAt += out.length;
    onProgress?.(chunks.rawEnd / Math.max(1, total));
  };
  const emit = async (): Promise<void> => {
    if (!used) return;
    const done = deflate(used === run.length ? run : run.subarray(0, used));
    done.catch(() => {});
    compressing.push(done);
    run = new Uint8Array(Math.min(RUN, Math.max(1, total - rawAt)));
    used = 0;
    while (compressing.length >= ahead) await flushOne();
    signal?.throwIfAborted();
  };
  const put = async (bytes: Uint8Array): Promise<void> => {
    for (let p = 0; p < bytes.length; ) {
      const n = Math.min(run.length - used, bytes.length - p);
      run.set(bytes.subarray(p, p + n), used);
      used += n;
      p += n;
      rawAt += n;
      if (used === run.length) await emit();
    }
  };

  for (let i = 0; i < records.length; i++) {
    const d = records[i];
    const x = parts[i];
    if (!x) {
      // as joinRecords does
      setU64(d, 0, BigInt(d.length));
      await put(d);
      continue;
    }
    await put(x.before);
    if (!placed.has(x.entry)) placed.set(x.entry, rawAt);
    const length = x.entry.length;
    // pieces read one ahead; the last is never shorter than the check's span, so it holds the part's tail whole
    const ends = (o: number): number => (length - o - PART_PIECE < CHECK_SPAN ? length : o + PART_PIECE);
    let next = x.entry.read(0, ends(0));
    let head: Uint8Array | null = null;
    for (let o = 0; o < length; ) {
      const piece = await next;
      const after = o + piece.length;
      if (after < length) next = x.entry.read(after, ends(after));
      head ??= piece.slice(0, CHECK_SPAN);
      if (after === length) x.entry.verify(head, piece.subarray(piece.length - CHECK_SPAN));
      await put(piece);
      o = after;
    }
    await put(x.after);
  }
  await emit();
  while (compressing.length) await flushOne();
  const field = new Uint8Array(4);
  setU32be(field, 0, fileAt);
  await sink.patch(FILE_SIZE_OFFSET, field);
  return { size: fileAt, chunks, placed };
}
