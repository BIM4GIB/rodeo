// File X-ray check. Run from web/:
//   npx tsx src/features/xray/check.ts ../samples/sample.vwx [more.vwx ...]
// Opens each file, prints the analysis, and verifies that the categories add up to the decompressed
// record stream (readContainer's raw length, computed independently of the analysis).

import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { openVwx } from "../../core/index.ts";
import { readContainer } from "../../core/container.ts";
import { Model } from "../../core/model.ts";
import { analyse, type XrayReport } from "./analyse.ts";

const MB = 1024 * 1024;
const fmt = (bytes: number): string => (bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`);
const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;

function show(report: XrayReport): void {
  console.log(`  file ${fmt(report.fileBytes)}, records ${fmt(report.recordBytes)} in ${report.recordCount.toLocaleString("en-US")} records`);
  console.log(
    `  compression: ${fmt(report.compressedBytes)} on disk for the records (${report.ratio.toFixed(2)} bytes per record byte); header ${report.headerBytes} B, chunk framing ${report.framingBytes} B (${pct(report.overheadShare)} of the file)`,
  );
  for (const cat of report.categories) {
    console.log(`  ${cat.label.padEnd(36)} ${String(cat.records).padStart(8)} rec  ${fmt(cat.bytes).padStart(10)}  ${pct(cat.share).padStart(6)} of file`);
    for (const it of cat.items.slice(0, 5)) {
      const img = it.image ? `  [${it.image.width}x${it.image.height} px ${it.image.mime}]` : "";
      console.log(`      ${it.label.slice(0, 44).padEnd(44)} ${String(it.count).padStart(7)} ${it.unit.padEnd(14)} ${fmt(it.bytes).padStart(10)}${it.subtreeBytes !== it.bytes ? ` (subtree ${fmt(it.subtreeBytes)})` : ""}${img}`);
    }
    if (cat.items.length > 5) console.log(`      ... ${cat.items.length - 5} more`);
  }
  for (const f of report.findings) {
    console.log(`  finding ${f.id}: ${f.summary} (${f.rows.length} rows, ${fmt(f.bytes)})`);
    for (const row of f.rows.slice(0, 3)) console.log(`      ${row.label}: ${row.detail}`);
  }
}

function verify(report: XrayReport, rawBytes: number): boolean {
  const sum = report.categories.reduce((s, c) => s + c.bytes, 0);
  const records = report.categories.reduce((s, c) => s + c.records, 0);
  const ok = sum === rawBytes && report.recordBytes === rawBytes && records === report.recordCount;
  console.log(`  check: categories sum to ${sum.toLocaleString("en-US")} B, record stream is ${rawBytes.toLocaleString("en-US")} B, ${records} of ${report.recordCount} records: ${ok ? "OK" : "MISMATCH"}`);
  return ok;
}

async function run(path: string): Promise<boolean> {
  const started = Date.now();
  const bytes = new Uint8Array(readFileSync(path));
  const session = openVwx(bytes, basename(path));
  const doc = session.doc;
  if (!(doc instanceof Model)) throw new Error("openVwx did not return a Model");
  const raw = readContainer(bytes).raw.length;
  const openedMs = Date.now() - started;
  const report = await analyse(doc, bytes, (label) => console.log(`  .. ${label}`));
  const ok = verify(report, raw);
  show(report);
  console.log(`  time: open ${openedMs} ms, analysis ${Date.now() - started - openedMs} ms, file ${statSync(path).size.toLocaleString("en-US")} B`);
  return ok;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: npx tsx src/features/xray/check.ts <file.vwx> [...]");
    process.exit(2);
  }
  let failed = 0;
  for (const file of files) {
    console.log(`== ${file}`);
    try {
      if (!(await run(file))) failed++;
    } catch (err) {
      failed++;
      console.log(`  error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(failed === 0 ? "all files OK" : `${failed} file(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
