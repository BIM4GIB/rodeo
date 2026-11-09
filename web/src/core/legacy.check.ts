// Checks the legacy (Vectorworks 2013) reader on synthetic files: a blank drawing's records narrowed
// into the 2013 layout (the inverse of legacy.ts's widen, written here) and wrapped in a 2013 header
// must read back to the same records, with GUIDs made by the reader. Only the records whose bodies
// the per-type converters give back as they are take part; legacyDoc.check.ts and
// legacyShapes.check.ts check the conversions. Also: uncompressed 2018+
// records pass through, Snappy bodies keep their path, and an old file whose body is unreadable
// names the year it was saved in. Run from web/:
//   npx tsx src/core/legacy.check.ts
// No file of the user's is read.

import { blankDrawing } from "./blank.ts";
import { bytesSource, readContainer, readContainerStream, writeContainer } from "./container.ts";
import { concat, setU32, setU32be, u64 } from "./bytes.ts";
import { docBody } from "./legacyDoc.ts";
import { shapeBody } from "./legacyShapes.ts";
import { NEXT_MARK, Rec, splitRecords } from "./records.ts";
import { unitsName } from "./settings.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A 2018+ record as the 2013 layout: the inverse of legacy.ts's widen (its GUID and +0x48 bytes are dropped). */
function narrow(rec: Uint8Array): Uint8Array {
  const terminator = rec[0x19] === 0;
  const body = rec.subarray(0x50);
  if (terminator && body.length !== 8) throw new Error("a terminator's body is a u64 here");
  const mark = u64(rec, 0x08);
  if (mark !== 0n && mark !== NEXT_MARK) throw new Error("mark is not 0 or NEXT_MARK");
  if (u64(rec, 0x10) >= 2n ** 32n || u64(rec, 0x26) >= 2n ** 32n) throw new Error("pointer does not fit in u32");
  if (rec.subarray(0x2a, 0x2e).some((b) => b !== 0)) throw new Error("owner's high half is not zero");
  if (terminator && body.subarray(4).some((b) => b !== 0)) throw new Error("terminator's high half is not zero");
  const tailLength = terminator ? 4 : body.length;
  const out = new Uint8Array(0x28 + tailLength);
  setU32(out, 0x00, out.length);
  setU32(out, 0x04, Number(mark));
  setU32(out, 0x08, Number(u64(rec, 0x10)));
  out.set(rec.subarray(0x18, 0x19), 0x0c);
  out.set(rec.subarray(0x19, 0x1a), 0x0d);
  out.set(rec.subarray(0x1a, 0x1c), 0x0e);
  out.set(rec.subarray(0x1c, 0x1f), 0x10);
  out.set(rec.subarray(0x1f, 0x20), 0x13);
  out.set(rec.subarray(0x20, 0x24), 0x14);
  out.set(rec.subarray(0x24, 0x26), 0x18);
  setU32(out, 0x1a, Number(u64(rec, 0x26)));
  out.set(rec.subarray(0x2e, 0x38), 0x1e);
  out.set(body.subarray(0, tailLength), 0x28);
  return out;
}

/** Whether legacy.ts gives the body of the 2018+ record `rec` back as it is, read as a 2013 body. */
function keptAsIs(rec: Uint8Array): boolean {
  if (rec[0x19] === 0) return true;
  const body = rec.subarray(0x50);
  try {
    const doc = docBody(rec[0x19], body);
    const made = doc !== undefined ? doc : shapeBody(rec[0x19], body);
    return made === undefined || (made !== null && same(made, body));
  } catch {
    return false;
  }
}

/** A 2013 file: the header's bytes with a 2013-length settings block, then the records. */
function legacyFile(header: Uint8Array, records: Uint8Array[]): Uint8Array {
  const settings = 0x880;
  const h = header.slice(0, 0x94 + settings);
  setU32be(h, 0, settings);
  setU32(h, 0x94, settings);
  const file = concat([h, ...records]);
  setU32be(file, 0x54, file.length);
  return file;
}

/** Message from reading `bytes` whole, or "" when it reads. */
function failure(bytes: Uint8Array): string {
  try {
    readContainer(bytes);
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const blank = blankDrawing("mm");
const blankRead = readContainer(blank);
const blankAll = splitRecords(blankRead.raw).map((r) => r.data);
const blankRecords = blankAll.filter(keptAsIs);

// 1. a 2018+ drawing is still read as Snappy chunks
check(blankRead.chunkCount > 0 && blankAll.length > 0, `blank drawing reads as Snappy chunks (${blankRead.chunkCount} chunk(s), ${blankAll.length} records)`);
check(blankRecords.length >= blankAll.length / 2, `${blankRecords.length} of the blank's ${blankAll.length} records keep their bodies`);

// 2. the narrowing's assumptions hold for the blank's records (no bytes at +0x48 that a 2013 record lacks)
check(blankRecords.every((r) => r.subarray(0x48, 0x50).every((b) => b === 0)), "the blank's records are zero at +0x48");

// 3. narrowed records in a 2013 file read back to the blank's records, GUIDs aside
const file = legacyFile(blank, blankRecords.map(narrow));
const read = readContainer(file);
const back = splitRecords(read.raw).map((r) => r.data);
const guidFree = (d: Uint8Array): Uint8Array => {
  const c = d.slice();
  c.fill(0, 0x38, 0x48);
  return c;
};
check(read.chunkCount === 0, "a 2013 body reads as records, not Snappy chunks");
check(back.length === blankRecords.length, `2013 file: ${back.length} records read back, ${blankRecords.length} written`);
check(back.every((r, i) => same(guidFree(r), guidFree(blankRecords[i]))), "every record reads back as it was, GUID aside");
const guids = new Set(back.map((r) => new Rec(r).guid));
check(guids.size === back.length && back.every((r) => r.subarray(0x38, 0x48).some((b) => b !== 0)), "every record gets its own nonzero GUID");
check(same(readContainer(file).raw, read.raw), "the same 2013 file reads to the same GUIDs every time");
check(read.units === "Millimeters", `units from the 2013 settings: ${read.units}`);
check(read.header.length === blankRead.header.length && same(read.header.subarray(0x1ac, 0x304), blankRead.header.subarray(0x1ac, 0x304)), "the header's units fields are the blank's millimetres");

// 4. the same file streamed in small slices reads the same
const streamed = await readContainerStream(bytesSource(file), { slice: 4 << 10 });
check(
  streamed.records.length === back.length && streamed.records.every((r, i) => same(r, back[i])) && same(streamed.header, read.header) && streamed.units === read.units,
  "streamed in 4 KB slices: the same records, header and units",
);

// 5. units written in ASCII (as 2013 writes them) are found when the UTF-16 name is not there
const ftinBlank = blankDrawing("ftin");
const ftinRecords = splitRecords(readContainer(ftinBlank).raw)
  .map((r) => r.data)
  .filter(keptAsIs);
const asciiHeader = readContainer(ftinBlank).header.slice();
asciiHeader.fill(0, 0x1c6, 0x1c6 + 42);
check(unitsName(asciiHeader) === null, "without the UTF-16 name, the 2018+ units reader finds nothing");
asciiHeader.set(new TextEncoder().encode("Feet & Inches"), 0x500);
const ftinRead = readContainer(legacyFile(asciiHeader, ftinRecords.map(narrow)));
check(ftinRead.units === "Feet & Inches", `units written in ASCII: ${ftinRead.units}`);
check(splitRecords(ftinRead.raw).length === ftinRecords.length, "feet and inches records read back");

// 6. uncompressed 2018+ records (u64 sizes, 0x50 headers) pass through unchanged
const wideFile = concat([blank.slice(0, blankRead.header.length), ...blankAll]);
setU32be(wideFile, 0x54, wideFile.length);
const wide = readContainer(wideFile);
const wideBack = splitRecords(wide.raw).map((r) => r.data);
check(wide.chunkCount === 0 && wideBack.length === blankAll.length && wideBack.every((r, i) => same(r, blankAll[i])), `uncompressed 2018+ records pass through unchanged (${wideBack.length})`);

// 7. a 2013 file cut short fails, and does not get the year message (2013 is read)
const cutFile = file.slice(0, file.length - 30);
setU32be(cutFile, 0x54, cutFile.length);
const cutError = failure(cutFile);
check(cutError !== "" && !cutError.includes("can't read yet"), `a 2013 file cut short fails with its own error: ${cutError}`);

// 8. an old file whose body is unreadable names the year it was saved in
const junk = new Uint8Array(4096);
for (let i = 0; i < junk.length; i++) junk[i] = (i * 131 + 7) & 0xff;
const oldHeader = blank.slice(0, blankRead.header.length);
oldHeader.set(new TextEncoder().encode("VW12.5.0 VW12.5.0"), 0x0e);
const oldFile = concat([oldHeader, junk]);
setU32be(oldFile, 0x54, oldFile.length);
const oldError = failure(oldFile);
check(oldError === "This file was saved by Vectorworks 2007, which Rodeo can't read yet: save it from Vectorworks 2013 or newer.", `a file saved in 2007 names its year: ${oldError}`);
let oldStream = "";
try {
  await readContainerStream(bytesSource(oldFile), { slice: 1 << 10 });
} catch (err) {
  oldStream = err instanceof Error ? err.message : String(err);
}
check(oldStream === oldError, "the streamed reader gives the same message");

// 9. a 2018+ file whose body is unreadable keeps its own error
const newFile = concat([blank.slice(0, blankRead.header.length), junk]);
setU32be(newFile, 0x54, newFile.length);
const newError = failure(newFile);
check(newError.startsWith("bad chunk") && !newError.includes("can't read yet"), `a 2018 file that fails keeps its error: ${newError}`);

// 10. a legacy drawing's header carries a 2018+ version string, so saving writes the 2018+ layout
check(new TextDecoder().decode(read.header.subarray(0x0e, 0x2e)).startsWith("VW31.2.0"), "a legacy drawing's header carries the 2018+ version string");

// 11. saved as it would be (2018+ header, Snappy chunks), the drawing reads back: its records and units
for (const [name, legacy, records] of [
  ["millimetres", read, back],
  ["feet and inches", ftinRead, splitRecords(ftinRead.raw).map((r) => r.data)],
] as const) {
  const saved = writeContainer(legacy.header, concat(records));
  const reopened = readContainer(saved);
  check(
    reopened.chunkCount > 0 && same(reopened.raw, concat(records)) && reopened.units === legacy.units,
    `${name}: saved with a 2018+ header and read back (${reopened.chunkCount} chunk(s)), units ${reopened.units}`,
  );
}

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
