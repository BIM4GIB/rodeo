// Checks an Archicad import end to end under Node, as the worker runs it. Run from web/:
//   npx tsx src/app/archicadImport.check.ts
// A file that isn't an Archicad 17 or later file is refused. With PLN_SAMPLES set to a folder of
// Archicad files, each is read by ranges as the browser reads it, made into a drawing, and that
// drawing is opened again; only counts and times are printed, never the files' contents.

import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { openVwx } from "../core/index.ts";
import { archicadDrawing } from "./archicadImport.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const junk = new Uint8Array(64).fill(7);
const refused = await archicadDrawing(async (o, n) => junk.slice(o, o + n), junk.length, "junk.pln").then(
  () => null,
  (err: unknown) => String(err),
);
check(refused !== null && /isn't an Archicad/.test(refused), "a file that isn't an Archicad 17+ file is refused");

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const names = (await readdir(folder)).filter((n) => /\.(pln|pla|tpl)$/i.test(n)).sort();
  check(names.length > 0, `Archicad files in PLN_SAMPLES (${names.length})`);
  for (const [i, name] of names.entries()) {
    const fh = await open(join(folder, name));
    const size = (await fh.stat()).size;
    const t0 = Date.now();
    const d = await archicadDrawing(
      async (o, n) => {
        const b = new Uint8Array(Math.max(0, Math.min(n, size - o)));
        await fh.read(b, 0, b.length, o);
        return b;
      },
      size,
      `sample-${i + 1}.pla`,
    );
    await fh.close();
    const t1 = Date.now();
    const again = openVwx(d.bytes, "again.vwx");
    const layers = again.doc.layers().filter((l) => l.kind === "design");
    const objects = layers.reduce((n, l) => n + again.doc.objects(l.id).length, 0);
    const w = d.written;
    check(
      layers.length >= w.layers.length && objects > 0,
      `sample ${i + 1}: ${t1 - t0} ms, ${(d.bytes.length / 1e6).toFixed(1)} MB; ${w.layers.length} stories, ${w.walls} walls, ${w.slabs} slabs, ${w.openings} openings, ${w.objects} other, ${w.drawing} 2D; reopened with ${objects} objects on ${layers.length} layers`,
    );
    const failed = Object.entries(w.failed);
    if (failed.length) console.log(`     couldn't make: ${failed.map(([k, n]) => `${k} ${n}`).join(", ")}`);
    const skipped = Object.entries(d.skipped);
    if (skipped.length) console.log(`     left out: ${skipped.map(([k, n]) => `${k} ${n}`).join(", ")}`);
    if (d.notes.length) console.log(`     notes: ${d.notes.join("; ")}`);
  }
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
