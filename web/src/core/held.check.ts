// Checks holding parts in the file (held.ts) and writing drawings out a slice at a time (writeVwx)
// under Node. Run from web/:
//   npx tsx src/core/held.check.ts [file.vwx ...]
// It only reads the files. With none it reads the blank drawing and ../samples/sample.vwx,
// holding parts down to 128 bytes so that small drawings have many; files named are read from
// disk a slice at a time, holding parts as the app does, and checked against their whole reading
// by hash (a big one needs `node --max-old-space-size=16000`). For each: records with tokens put
// back are the records read whole; the drawing written out is toBytes()'s bytes, before and after
// an edit, and again once its parts are read from the file just written; a file that has changed
// under its parts, or can't be read again, fails to write rather than writing something else.

import { createHash } from "node:crypto";
import { existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename } from "node:path";
import { blankDrawing } from "./blank.ts";
import { type ByteSource, bytesSource, inflateChunks, readContainer, readContainerStream, RecordCarver, type VwxSink } from "./container.ts";
import { expandRecords, FileStream, heldPart, Holder, withHeldImages } from "./held.ts";
import { imageBytes } from "./geometry.ts";
import { clipboardHolds, expandClipboard, openVwx } from "./index.ts";
import { Model } from "./model.ts";
import { splitRecords } from "./records.ts";
import { Session } from "./edit.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));
const inflate = async (chunks: Uint8Array, first: number, at: number): Promise<Uint8Array> => inflateChunks(chunks, first, at);
const mb = (n: number): string => `${(n / 2 ** 20).toFixed(0)} MB`;

/** A sink keeping what is written, in memory. */
function memorySink(): VwxSink & { bytes(): Uint8Array } {
  const parts: Uint8Array[] = [];
  let header: Uint8Array | null = null;
  return {
    async write(b) {
      if (!header) header = b;
      parts.push(b);
    },
    async patch(at, b) {
      header!.set(b, at);
    },
    bytes: () => Buffer.concat(parts),
  };
}

/** A sink hashing what is written (the header, patched at the end, hashed then). */
function hashSink(): VwxSink & { digest(): string } {
  const hash = createHash("sha256");
  let header: Uint8Array | null = null;
  const rest = createHash("sha256");
  return {
    async write(b) {
      if (!header) header = b;
      else rest.update(b);
    },
    async patch(at, b) {
      header!.set(b, at);
    },
    digest: () => hash.update(header!).update(rest.digest()).digest("hex"),
  };
}

function hashBytes(bytes: Uint8Array, headerLength: number): string {
  const rest = createHash("sha256").update(bytes.subarray(headerLength)).digest();
  return createHash("sha256").update(bytes.subarray(0, headerLength)).update(rest).digest("hex");
}

/** A file on disk read a slice at a time. */
function fileSource(path: string): ByteSource {
  const fd = openSync(path, "r");
  return {
    size: statSync(path).size,
    read: async (start, end) => {
      const b = Buffer.alloc(end - start);
      readSync(fd, b, 0, end - start, start);
      return new Uint8Array(b.buffer, b.byteOffset, b.length);
    },
  };
}

/** Records whose parts are held, against the same records read whole. */
async function expandsTo(held: Uint8Array[], whole: Uint8Array[]): Promise<boolean> {
  if (held.length !== whole.length) return false;
  const back = await expandRecords(held);
  return back.every((r, i) => same(r, whole[i]));
}

const SAMPLE = "../samples/sample.vwx";
const paths = process.argv.slice(2);

if (!paths.length) {
  const files: { name: string; bytes: Uint8Array }[] = existsSync(SAMPLE) ? [{ name: basename(SAMPLE), bytes: new Uint8Array(readFileSync(SAMPLE)) }] : [];
  files.unshift({ name: "blank (mm)", bytes: blankDrawing("mm") });
  for (const { name, bytes } of files) {
    const whole = openVwx(bytes);
    const want = whole.doc.toBytes();
    const wholeRecords = splitRecords(readContainer(want).raw).map((r) => r.data);
    const opened = await readContainerStream(bytesSource(bytes), { hold: true, holdMin: 128, slice: 64 << 10, ahead: 3 });
    const entries = opened.held?.table.entries.length ?? 0;
    const heldBytes = opened.held?.table.entries.reduce((s, e) => s + e.length, 0) ?? 0;
    // the blank drawing has nothing long enough to hold: it is still written out the same way
    const any = !name.startsWith("blank");
    check(any === entries > 0, `${name}: ${entries} parts held, ${heldBytes} bytes`);
    check(await expandsTo(opened.records, wholeRecords), `${name}: every record put back is the record read whole`);
    const session = new Session(new Model(opened, name));
    let threw = false;
    try {
      session.doc.toBytes();
    } catch {
      threw = true;
    }
    check(session.doc.holdsParts() === any && threw === any, `${name}: ${any ? "holds parts, and toBytes() refuses it" : "holds none, and toBytes() works"}`);
    const sink = memorySink();
    const written = await session.doc.write(sink, { ahead: 3 });
    const out = sink.bytes();
    check(same(out, want) && written.size === want.length, `${name}: written out a slice at a time, it is toBytes()'s ${want.length} bytes`);
    check(written.placed.size === entries, `${name}: every held part placed (${written.placed.size})`);

    // pictures: read back from the file, and in memory while an export runs, the same bytes as read whole
    {
      const pics = session.doc.layers().flatMap((l) => session.doc.objects(l.id).filter((o) => o.shape?.kind === "image" && (o.shape.image || o.shape.heldImage)));
      const held = pics.filter((o) => o.shape!.heldImage);
      const want = (id: string): Uint8Array | undefined => whole.doc.object(id)?.shape?.image;
      let read = 0;
      for (const o of held) if (same((await imageBytes(o.shape!))!, want(o.id)!)) read++;
      const during = await withHeldImages(session.doc, () => held.filter((o) => same(o.shape!.image!, want(o.id)!)).length);
      const after = held.filter((o) => o.shape!.image === undefined).length;
      check(read === held.length && during === held.length && after === held.length, `${name}: ${held.length} of ${pics.length} pictures held: read back ${read}, in memory for an export ${during}, gone after ${after}`);
    }

    // a copy: holding parts, and put back for another window, the copy the drawing read whole makes
    {
      const copies = (id: string): boolean => {
        try {
          whole.copyObjects([id]);
          return true;
        } catch {
          return false;
        }
      };
      const ids = session.doc.layers().flatMap((l) => session.doc.objects(l.id).filter((o) => !o.id.includes("/") && copies(o.id)).map((o) => o.id));
      const copy = session.copyObjects(ids);
      const want = whole.copyObjects(ids);
      const full = await expandClipboard(copy);
      const sameCopy = full.records.length === want.records.length && full.records.every((r, i) => r.data === want.records[i].data && r.parent === want.records[i].parent);
      check(clipboardHolds(copy) === any && !clipboardHolds(full) && sameCopy, `${name}: a copy of all that copies (${copy.records.length} records) ${any ? "holds parts; put back, it is" : "is"} the copy made from the drawing read whole`);
    }

    // the same edit to both: every top-level object moved, which rewrites bodies' points around their held sections
    for (const s of [whole, session]) {
      for (const layer of s.doc.layers()) {
        const ids = s.doc.objects(layer.id).map((o) => o.id).filter((id) => !id.includes("/"));
        if (ids.length) s.moveObjects(ids, 1234.5, -678.25);
      }
    }
    const edited = whole.doc.toBytes();
    const sink2 = memorySink();
    await session.doc.write(sink2);
    check(same(sink2.bytes(), edited), `${name}: after moving everything, still toBytes()'s bytes`);

    // parts read from the file just written, as after a save
    const stream = new FileStream(bytesSource(out), written.chunks, inflate);
    for (const [entry, at] of written.placed) entry.moveTo(stream, at);
    session.undo();
    const sink3 = memorySink();
    await session.doc.write(sink3);
    const undone = memorySink();
    whole.undo();
    await whole.doc.write(undone);
    check(same(sink3.bytes(), undone.bytes()), `${name}: parts read from the file written, and an undo, still the same bytes`);

    // a held part's chunks in the opened file spoilt after it opened: writing fails rather than writing them
    if (opened.held) {
      const spoilt = bytes.slice();
      let spoil = false;
      const src: ByteSource = { size: spoilt.length, read: async (a, b) => (spoil ? spoilt : bytes).subarray(a, b) };
      const again = await readContainerStream(src, { hold: true, holdMin: 128 });
      const target = again.held!.table.entries.reduce((a, e) => (e.length > a.length ? e : a));
      const at = (target as unknown as { at: number }).at;
      const t = again.held!.stream.chunks;
      const k = t.chunkAt(at + (target.length >> 1));
      // the chunk's bytes changed all through it, its size kept, as a file saved again over it might be
      for (let i = t.fileStart(k) + 16; i < t.fileStart(k + 1); i += 97) spoilt[i] ^= 0x5a;
      spoil = true;
      const s = new Session(new Model(again, name));
      let error = "";
      try {
        await s.doc.write(memorySink());
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      check(error !== "", `${name}: a held part's chunk changed in the file: writing fails (${error.slice(0, 90)})`);

      // a file that can't be read once open, read again (refresh) unchanged: writing works; changed in size: fails
      let gone = false;
      const flaky: ByteSource = {
        size: bytes.length,
        read: async (a, b) => {
          if (gone) throw new Error("NotReadableError");
          return bytes.subarray(a, b);
        },
      };
      const third = await readContainerStream(flaky, { hold: true, holdMin: 128, refresh: async () => bytesSource(bytes) });
      gone = true;
      const sink4 = memorySink();
      await new Session(new Model(third, name)).doc.write(sink4);
      check(same(sink4.bytes(), want), `${name}: read again after its file couldn't be read, the same bytes`);
      const fourth = await readContainerStream(bytesSource(bytes), { hold: true, holdMin: 128 });
      const moved = new FileStream(
        { size: bytes.length, read: async () => Promise.reject(new Error("NotReadableError")) },
        fourth.held!.stream.chunks,
        inflate,
        async () => bytesSource(bytes.subarray(0, bytes.length - 1)),
      );
      for (const e of fourth.held!.table.entries) e.moveTo(moved, (e as unknown as { at: number }).at);
      let failed = false;
      try {
        await new Session(new Model(fourth, name)).doc.write(memorySink());
      } catch {
        failed = true;
      }
      check(failed, `${name}: read again, its file a different size: writing fails`);
    }
  }

  {
    // records cut from pieces of 1 to 13 bytes while holding parts: split at every point of a held part
    const bytes = files[files.length - 1].bytes;
    const raw = readContainer(bytes).raw;
    const records = splitRecords(raw).map((r) => r.data);
    const holder = new Holder({ read: async (a, b) => raw.slice(a, b) }, 64);
    const carver = new RecordCarver(holder);
    for (let p = 0, n = 1; p < raw.length; p += n, n = (n % 13) + 1) carver.push(raw.subarray(p, p + n));
    const cut = carver.finish();
    const tokens = cut.filter((r) => heldPart(r)).length;
    check(tokens > 0 && (await expandsTo(cut, records)), `pieces of 1 to 13 bytes, ${tokens} parts held: put back, the records`);
  }
} else {
  for (const path of paths) {
    const name = basename(path);
    const t0 = performance.now();
    const before = process.memoryUsage();
    const opened = await readContainerStream(fileSource(path), { hold: true, ahead: 4 });
    const t1 = performance.now();
    const after = process.memoryUsage();
    const kept = opened.records.reduce((s, r) => s + r.length, 0);
    const held = opened.held?.table.entries.reduce((s, e) => s + e.length, 0) ?? 0;
    check(!!opened.held, `${name}: opened in ${((t1 - t0) / 1000).toFixed(1)} s, ${opened.records.length} records: ${mb(kept)} in memory, ${mb(held)} held in ${opened.held?.table.entries.length ?? 0} parts (array buffers ${mb(after.arrayBuffers - before.arrayBuffers)})`);
    const session = new Session(new Model(opened, name));
    const sink = hashSink();
    const t2 = performance.now();
    const written = await session.doc.write(sink, { ahead: 4 });
    const t3 = performance.now();
    const got = sink.digest();
    const whole = openVwx(new Uint8Array(readFileSync(path)));
    const want = whole.doc.toBytes();
    check(got === hashBytes(want, opened.header.length) && written.size === want.length, `${name}: written out in ${((t3 - t2) / 1000).toFixed(1)} s, held parts put back: toBytes()'s ${mb(want.length)}, byte for byte`);
  }
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all ok");
