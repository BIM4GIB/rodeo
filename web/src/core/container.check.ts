// Checks readContainerStream against readContainer under Node. Run from web/:
//   npx tsx src/core/container.check.ts [file.vwx ...]
// With no files it reads the blank drawing and ../samples/sample.vwx. Each is read whole and then
// streamed with slices from 4 KB (so record size fields and records split between slices) up to
// the default, one and several slices decoding at once: the header, units and every record's
// bytes must be the same. A file cut short, or with a chunk spoilt, must fail to open.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { blankDrawing } from "./blank.ts";
import { bytesSource, readContainer, readContainerStream, RecordCarver } from "./container.ts";
import { splitRecords } from "./records.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const SAMPLE = "../samples/sample.vwx";
const paths = process.argv.slice(2);
const files: { name: string; bytes: Uint8Array }[] = (paths.length ? paths : existsSync(SAMPLE) ? [SAMPLE] : []).map((f) => ({ name: basename(f), bytes: new Uint8Array(readFileSync(f)) }));
if (!paths.length) files.unshift({ name: "blank (mm)", bytes: blankDrawing("mm") });

for (const { name, bytes } of files) {
  const whole = readContainer(bytes);
  const records = splitRecords(whole.raw).map((r) => r.data);
  for (const slice of [4 << 10, 64 << 10, 1 << 20, undefined]) {
    for (const ahead of [1, 4]) {
      let fractions = 0;
      const t = performance.now();
      const read = await readContainerStream(bytesSource(bytes), { slice, ahead, onProgress: () => fractions++ });
      const ms = performance.now() - t;
      const ok =
        same(read.header, whole.header) &&
        read.units === whole.units &&
        read.createdWith === whole.createdWith &&
        read.build === whole.build &&
        read.chunkCount === whole.chunkCount &&
        read.records.length === records.length &&
        read.records.every((r, i) => same(r, records[i]));
      check(ok, `${name}: ${records.length} records, ${slice ? `${slice >> 10} KB` : "default"} slices, ${ahead} at once (${ms.toFixed(0)} ms, ${fractions} progress calls)`);
    }
  }
}

{
  // pieces of 1 to 13 bytes: size fields and records split every way between them
  const raw = readContainer(files[files.length - 1].bytes).raw;
  const records = splitRecords(raw).map((r) => r.data);
  const carver = new RecordCarver();
  for (let p = 0, n = 1; p < raw.length; p += n, n = (n % 13) + 1) carver.push(raw.subarray(p, p + n));
  const cut = carver.finish();
  check(cut.length === records.length && cut.every((r, i) => same(r, records[i])), `records cut from pieces of 1 to 13 bytes: ${cut.length}`);
}

const sample = files[files.length - 1].bytes;
const fails = async (bytes: Uint8Array): Promise<string> => {
  try {
    await readContainerStream(bytesSource(bytes), { slice: 4 << 10 });
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};
const cut = new Uint8Array(sample.subarray(0, sample.length - 100));
// the header keeps the size it had, so put the cut file's own size there
new DataView(cut.buffer).setUint32(0x54, cut.length);
const cutError = await fails(cut);
check(/truncated|bad chunk|bad record/.test(cutError), `a file cut short fails: ${cutError}`);
const spoilt = new Uint8Array(sample);
spoilt[readContainer(sample).header.length + 4] ^= 0xff;
const spoiltError = await fails(spoilt);
check(spoiltError !== "", `a spoilt chunk fails: ${spoiltError}`);
const aborted = new AbortController();
aborted.abort();
let abortError = "";
try {
  await readContainerStream(bytesSource(sample), { signal: aborted.signal });
} catch (err) {
  abortError = err instanceof Error ? err.name : String(err);
}
check(abortError === "AbortError", "an aborted read stops");

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
