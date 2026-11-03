// Checks the Archicad project reader under Node. Run from web/:
//   npx tsx src/import/pln.check.ts
// QuickLZ level 1 as written here (a compressor kept beside the check) expands back: text with
// repeats, long runs, bytes that don't compress (stored as they are), a chunk small enough for the
// short header, and the first bytes only. A file built here, laid out as Archicad lays one out
// (header, allocations stored as they are, as zero-byte masks and as QuickLZ chunks, free space
// holding a stale copy, a compressed group, a filler bigger than the read window), reads back: the
// version saved with and started in, when, the preview (not the credit picture after it) and the
// filled Project Info fields, custom ones too, in Archicad's order. With the meta information and
// Project Info only inside a group, they are still found; with no preview saved there is none; a
// file that isn't one is refused. With PLN_SAMPLES set to a folder of Archicad files
// (PLN_SAMPLES=~/archicad-files), every allocation in each, compressed groups too,
// expands to its stated size, and each reads back with a version, dates in order, Project Info
// and a whole PNG when it has a preview. Nothing from those files is printed but counts.

import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { allocationPayload, blocksIn, expandGroup, isRof, qlzDecompress, qlzHeader, readPln, type ReadRange } from "./pln.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// ---- writing: QuickLZ level 1, zero masks, allocations, groups ----------------------------------

/** QuickLZ level 1, keeping the hash table as the expander will: each position hashed, except inside a match. */
function qlzCompress(src: Uint8Array): Uint8Array {
  const size = src.length;
  const body: number[] = [];
  const table = new Int32Array(4096).fill(-1);
  let hashed = -1;
  const hashAt = (p: number): number => {
    const v = src[p] | (src[p + 1] << 8) | (src[p + 2] << 16);
    return ((v >>> 12) ^ v) & 0xfff;
  };
  const hashUpTo = (to: number): void => {
    while (hashed < to) table[hashAt(++hashed)] = hashed;
  };
  let word = -1;
  let bits = 0;
  let items = 31;
  const flush = (): void => {
    if (word >= 0) for (let i = 0; i < 4; i++) body[word + i] = ((bits | 0x80000000) >>> (8 * i)) & 0xff;
  };
  const item = (match: boolean): void => {
    if (items === 31) {
      flush();
      word = body.length;
      body.push(0, 0, 0, 0);
      bits = 0;
      items = 0;
    }
    if (match) bits |= 1 << items;
    items++;
  };
  const lastMatchStart = size - 1 - 10;
  let s = 0;
  while (s < size) {
    if (s + 3 <= lastMatchStart) {
      const h = hashAt(s);
      const from = table[h];
      if (from >= 0 && src[from] === src[s] && src[from + 1] === src[s + 1] && src[from + 2] === src[s + 2]) {
        let length = 3;
        while (length < 255 && s + length < lastMatchStart && src[from + length] === src[s + length]) length++;
        item(true);
        if (length <= 17) body.push(((h << 4) | (length - 2)) & 0xff, h >> 4);
        else body.push((h << 4) & 0xff, h >> 4, length);
        hashUpTo(s);
        hashed = s + length - 1;
        s += length;
        continue;
      }
    }
    item(false);
    body.push(src[s++]);
    hashUpTo(s - 3);
  }
  flush();
  if (body.length >= size) return qlzChunk(src, false);
  return qlzChunk(Uint8Array.from(body), true, size);
}

/** A QuickLZ header (short when both sizes fit a byte) and its body; stored as is when not `packed`. */
function qlzChunk(body: Uint8Array, packed: boolean, size = body.length): Uint8Array {
  const short = body.length + 3 <= 255 && size <= 255;
  const head = short ? 3 : 9;
  const out = new Uint8Array(head + body.length);
  out[0] = 0x44 | (short ? 0 : 2) | (packed ? 1 : 0);
  if (short) {
    out[1] = out.length;
    out[2] = size;
  } else {
    put32(out, 1, out.length);
    put32(out, 5, size);
  }
  out.set(body, head);
  return out;
}

function put32(b: Uint8Array, o: number, v: number): void {
  for (let i = 0; i < 4; i++) b[o + i] = (v >>> (8 * i)) & 0xff;
}
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const cat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const pad16 = (b: Uint8Array): Uint8Array => cat(b, new Uint8Array((16 - (b.length % 16)) % 16));
const fromHex = (s: string): number[] => s.match(/../g)!.map((x) => parseInt(x, 16));

function zeroMaskOf(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i += 8) {
    let mask = 0;
    const kept: number[] = [];
    for (let k = 0; k < 8 && i + k < b.length; k++) {
      if (b[i + k]) {
        mask |= 1 << k;
        kept.push(b[i + k]);
      }
    }
    out.push(mask, ...kept);
  }
  return Uint8Array.from(out);
}

type Stored = "plain4" | "plain" | "mask" | "qlz";
let objects = 0;

/** An allocation holding `payload`, stored as asked, with a class tag; `wide` takes a u32 stored length. */
function allocationOf(payload: Uint8Array, how: Stored, tag = 0x30, wide = false): Uint8Array {
  const guid = new Uint8Array(16).fill(++objects);
  let lengths: number[];
  let stored: Uint8Array;
  let form: number[];
  if (how === "plain4") {
    form = [0xb3, 0x80];
    lengths = le32(payload.length);
    stored = payload;
  } else {
    stored =
      how === "plain"
        ? payload
        : how === "mask"
          ? zeroMaskOf(payload)
          : cat(...Array.from({ length: Math.ceil(payload.length / 0x40000) }, (_, i) => qlzCompress(payload.subarray(i * 0x40000, (i + 1) * 0x40000))));
    const length = wide ? le32(stored.length) : [stored.length & 0xff, stored.length >> 8];
    if (!wide && stored.length > 0xffff) throw new Error("too long for a u16 length");
    form = [wide ? 0xa7 : 0xa3, how === "plain" ? 0x84 : how === "mask" ? 0x85 : 0x86];
    lengths = how === "plain" ? [...length, ...le32(0x1234)] : [...length, ...le32(payload.length), ...le32(0x1234)];
  }
  const out = pad16(cat([0, 0, 0, 0, 0, 0], [tag & 0xff, tag >> 8, 1], form, guid, lengths, stored));
  out.set([0x42, 0x4c], 0);
  put32(out, 2, out.length / 16);
  return out;
}

/** A compressed group holding these allocations, its chunks at most `chunk` bytes expanded. */
function groupOf(allocations: Uint8Array[], chunk = 1 << 20): Uint8Array {
  const all = cat(...allocations);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < all.length; i += chunk) chunks.push(qlzCompress(all.subarray(i, i + chunk)));
  return pad16(
    cat(
      fromHex("79a8a99645b44af3983833c33a061b06"),
      le32(all.length),
      [0, 0, 0, 0],
      le32(chunks.length),
      [0, 0, 0, 0],
      ...chunks.flatMap((c) => [le32(c.length), c]),
    ),
  );
}

/** A file: the header, then these blocks. */
function fileOf(blocks: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(32);
  head.set([..."ROF FDB "].map((c) => c.charCodeAt(0)));
  head.set([0x10, 0, 2, 0, 0, 0, 1, 1], 8);
  return cat(head, ...blocks);
}

// ---- the objects -------------------------------------------------------------------------------

const PREVIEW_CLASS = "988b37d87c434747863dee9d096469d5";
const META_CLASS = "ba0d826fd47cd743bec2f8c75b687d63";
const INFO_CLASS = "ea2d06e2fbcfe6488b07a0eefac20d71";

/** The object header that follows the class GUID (version, stamps, the rest's length): 23 bytes the reader passes over. */
const objectHead = (): number[] => [2, 0, 0, ...le32(12), 0, 0, 0, 0, ...le32(0x563f9371), 0, 0, 0, 0, ...le32(0)];

/** A PNG's chunks (CRCs aren't checked), `filler` bytes of IDAT. */
function png(width: number, height: number, filler: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array =>
    cat([data.length >>> 24, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], [...type].map((c) => c.charCodeAt(0)), data, [0, 0, 0, 0]);
  const be = (v: number): number[] => [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const idat = Uint8Array.from({ length: filler }, (_, i) => (i * 7) & 0xff);
  return cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", Uint8Array.from([...be(width), ...be(height), 8, 6, 0, 0, 0])), chunk("IDAT", idat), chunk("IEND", new Uint8Array()));
}

function preview(pictures: Uint8Array[]): Uint8Array {
  const parts: (Uint8Array | number[])[] = [fromHex(PREVIEW_CLASS), objectHead(), [3, 0, 1, 2, 5, 0, 0, 0, 1, 0, 3, 0, 0]];
  for (const p of pictures) parts.push([1], le32(p.length), p);
  if (!pictures.length) parts.push([0, 1, 0, 0, 0, 0, 0x24, 0, 0, 0]);
  return cat(...parts);
}

const str = (s: string): number[] => [1, 0, ...le32(s.length), ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])];

function meta(savedWith: number, startedIn: number, started: number, saved: number): Uint8Array {
  return cat(
    fromHex(META_CLASS),
    objectHead(),
    [2, 1, ...le32(400), 3, 0, 0],
    le32(savedWith * 1000),
    le32(startedIn * 1000),
    le32(started),
    le32(savedWith * 1000),
    le32(saved),
    [0xf6, 0x01],
    str("Test project"),
    str("Test project.pln"),
  );
}

function projectInfo(fields: [string, string, string][], custom: [string, string, string][]): Uint8Array {
  const list = (pairs: [string, string][]): number[] => [1, 0, ...le32(pairs.length), ...pairs.flatMap(([a, b]) => [...str(a), ...str(b)])];
  return cat(
    fromHex(INFO_CLASS),
    objectHead(),
    [6, 0, 2, 1, 0x3b, 0, 0, 0, 1, 0, 0x83, 0, 3, 0, 0, 0],
    new Uint8Array(40),
    list(fields.map(([label, key]) => [label, key])),
    // values come in an order of their own
    list(fields.map(([, key, value]) => [key, value] as [string, string]).reverse()),
    list(custom.map(([label, key]) => [label, key])),
    list(custom.map(([, key, value]) => [key, value])),
  );
}

/** How many allocations `b` holds from `from` on, compressed groups' too, and how many fail to expand. */
function sweep(b: Uint8Array, from: number): { allocations: number; failed: number } {
  let allocations = 0;
  let failed = 0;
  for (const block of blocksIn(b, from)) {
    if (block.group) {
      const inner = sweep(expandGroup(b, block.at), 0);
      allocations += inner.allocations;
      failed += inner.failed;
      continue;
    }
    allocations++;
    try {
      if (block.tag < 0xf000) allocationPayload(b, block.at);
    } catch {
      failed++;
    }
  }
  return { allocations, failed };
}

/** A ReadRange over bytes in memory, counting reads. */
function ranges(b: Uint8Array): { read: ReadRange; reads: () => number } {
  let n = 0;
  return {
    read: async (offset, length) => {
      n++;
      return b.subarray(offset, Math.min(b.length, offset + length));
    },
    reads: () => n,
  };
}

// ---- QuickLZ round trips --------------------------------------------------------------------------

const text = new TextEncoder().encode("Archicad saves walls, slabs and roofs; ".repeat(400) + "the end.");
const runs = cat(new Uint8Array(5000), new Uint8Array(3000).fill(7), Uint8Array.from({ length: 2000 }, (_, i) => i % 13));
let seed = 1;
const noise = Uint8Array.from({ length: 4000 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);
const small = new TextEncoder().encode("abcabcabcabcabcabcabcabcabcabcabc xyz xyz xyz");
for (const [name, data] of [
  ["text with repeats", text],
  ["long runs", runs],
  ["noise", noise],
  ["a short chunk", small],
] as const) {
  const packed = qlzCompress(data);
  const h = qlzHeader(packed, 0);
  const back = qlzDecompress(packed, 0);
  check(back.length === data.length && back.every((x, i) => x === data[i]) && h.csize === packed.length, `QuickLZ: ${name} expands back (${data.length} → ${packed.length} bytes, ${h.packed ? "compressed" : "stored"}, ${h.hlen}-byte header)`);
}
check(qlzHeader(qlzCompress(text), 0).csize < text.length / 5, "QuickLZ: repeated text shrinks");
check(!qlzHeader(qlzCompress(noise), 0).packed, "QuickLZ: noise is stored as it is");
check(qlzHeader(qlzCompress(small), 0).hlen === 3, "QuickLZ: a chunk under 256 bytes takes the short header");
const first = qlzDecompress(qlzCompress(text), 0, 16);
check(first.length === 16 && first.every((x, i) => x === text[i]), "QuickLZ: the first 16 bytes alone");

// ---- a file laid out as Archicad lays one out ---------------------------------------------------------

const picture = png(1920, 1080, 300_000);
const credit = png(600, 140, 2000);
const fields: [string, string, string][] = [
  ["Project Name", "PROJECTNAME", "House on the hill"],
  ["Project Number", "PROJECTNUMBER", ""],
  ["Site Full Address", "SITEFULLADDRESS", "1 High Street, Penzance"],
  ["Client Full Name", "CLIENT_FULLNAME", "  A. Client  "],
];
const custom: [string, string, string][] = [["Phase", "autotext-PROJECT-1", "Stage 3"]];
const started = Date.UTC(2016, 3, 13) / 1000;
const saved = Date.UTC(2026, 3, 29) / 1000;
const stale = allocationOf(meta(30, 19, started, Date.UTC(2030, 0, 1) / 1000), "mask");
stale.set([0xdc, 0xff], 6); // free space, still holding a copy (newer, so it would win if read)
const filler = allocationOf(new Uint8Array(5 << 20).fill(1), "plain", 0x30, true);
const file = fileOf([
  allocationOf(Uint8Array.from([0x2d, 0xd0, 5, 0, ...new Uint8Array(16)]), "plain4", 0xfde8),
  stale,
  allocationOf(cat(fromHex("c61e38d752f7b449a2f31e1a7aaa2b15"), new Uint8Array(160)), "mask", 0x1e8),
  groupOf([allocationOf(new Uint8Array(3000).fill(9), "mask", 0x42), allocationOf(text, "qlz", 0x43)], 4096),
  allocationOf(meta(29, 19, started, saved), "mask", 0x42),
  filler,
  allocationOf(preview([picture, credit]), "qlz", 0x0e, true),
  allocationOf(projectInfo(fields, custom), "qlz", 0x11),
  allocationOf(text, "plain", 0x51),
]);
check(isRof(file) && !isRof(new TextEncoder().encode("<?xml version")), "the signature is told from other files");
const counted = ranges(file);
const info = await readPln(counted.read, file.length);
check(info.savedWith === 29 && info.startedIn === 19, "saved with Archicad 29, started in 19 (the copy in free space passed over)");
check(info.saved?.getTime() === saved * 1000 && info.started?.getTime() === started * 1000, "when it was started and last saved");
check(info.preview?.width === 1920 && info.preview.height === 1080 && info.preview.png.length === picture.length && info.preview.png.every((x, i) => x === picture[i]), "the preview, whole, not the credit picture after it");
check(
  info.fields.map((f) => `${f.label}=${f.value}`).join("|") === "Project Name=House on the hill|Site Full Address=1 High Street, Penzance|Client Full Name=A. Client|Phase=Stage 3",
  "Project Info's filled fields in Archicad's order, trimmed, custom ones last",
);
check(counted.reads() < 10, `read in a few windows, not per header (${counted.reads()} reads)`);

const walked = sweep(file, 32);
check(walked.allocations === 10 && walked.failed === 0, `every allocation walks and expands, the group's too (${walked.allocations})`);

// the meta information and Project Info only inside a group
const grouped = fileOf([
  allocationOf(preview([picture]), "qlz", 0x0e, true),
  groupOf([allocationOf(meta(27, 22, started, saved), "mask", 0x42), allocationOf(projectInfo(fields, []), "qlz", 0x11)], 8192),
]);
const inGroup = await readPln(ranges(grouped).read, grouped.length);
check(inGroup.savedWith === 27 && inGroup.startedIn === 22 && inGroup.fields.length === 3 && inGroup.preview?.width === 1920, "found inside a compressed group when not outside one");

// no preview saved
const bare = fileOf([allocationOf(preview([]), "mask", 0x0e), allocationOf(meta(25, 23, started, saved), "mask", 0x42)]);
const noPreview = await readPln(ranges(bare).read, bare.length);
check(noPreview.preview === null && noPreview.savedWith === 25 && noPreview.fields.length === 0, "no preview when none was saved, no fields without Project Info");

// not an Archicad file
let refused = false;
try {
  await readPln(ranges(new TextEncoder().encode("<?xml version='1.0'?><FlightPlan/>")).read, 36);
} catch {
  refused = true;
}
check(refused, "a .pln that isn't Archicad's is refused");

// ---- real files ---------------------------------------------------------------------------------------

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const names = (await readdir(folder)).filter((n) => /\.(pln|pla|tpl)$/i.test(n)).sort();
  check(names.length > 0, `Archicad files in PLN_SAMPLES (${names.length})`);
  for (const [i, name] of names.entries()) {
    const handle = await open(join(folder, name), "r");
    const { size } = await handle.stat();
    const read: ReadRange = async (offset, length) => {
      const b = new Uint8Array(length);
      const { bytesRead } = await handle.read(b, 0, length, offset);
      return b.subarray(0, bytesRead);
    };
    const { allocations, failed } = sweep(await read(0, size), 32);
    check(failed === 0 && allocations > 1000, `file ${i + 1}: ${allocations} allocations expand, none fail`);
    const got = await readPln(read, size);
    const versions = got.savedWith !== null && got.startedIn !== null && got.savedWith >= 17 && got.startedIn <= got.savedWith && got.savedWith < 40;
    check(versions && !!got.saved && !!got.started && got.started <= got.saved, `file ${i + 1}: saved with Archicad ${got.savedWith}, started in ${got.startedIn}, dates in order`);
    check(got.fields.length > 0 && got.fields.every((f) => f.label && f.value), `file ${i + 1}: ${got.fields.length} Project Info fields`);
    const p = got.preview;
    check(!p || (p.width > 0 && p.height > 0 && p.png.length > 100), `file ${i + 1}: ${p ? `a ${p.width} x ${p.height} preview` : "no preview saved"}`);
    await handle.close();
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
