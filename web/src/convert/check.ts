// Checks the converter end to end under Node. Run from web/:
//   npx tsx src/convert/check.ts
// Every format Rodeo writes is written from the fixture drawing and read back, so units, up axes and
// extents must survive the trip; then the DXF class layers, the placers' own rules, the errors readAny
// gives, the converter pages against the format table and, where the machine has them, the sample
// drawing and folders of public files. Sample files are read through a copy and never written.

import "./node.ts";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import { exportDxf } from "../export/dxf.ts";
import { exportPdf } from "../export/pdf.ts";
import { parseDxf } from "../import/dxf.ts";
import { openPdf } from "../import/pdf.ts";
import { describe, formatById, formats, formatOfName, readAny, summaryLine, writeAs, type ReadOptions } from "./index.ts";
import { fixtureDrawing } from "./fixture.ts";
import { placeDxf, placePage } from "./place.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;

/** The first design layer of a blank drawing, where a placer puts what it reads. */
function designLayer(s: ReturnType<typeof openVwx>): string {
  const layer = s.doc.layers().find((l) => l.kind === "design");
  if (!layer) throw new Error("no design layer");
  return layer.id;
}

/** Runs `fn` and checks that it fails with a message containing `text`. */
async function rejects(what: string, fn: () => Promise<unknown>, text: string): Promise<void> {
  try {
    await fn();
    check(false, `${what}: no error`);
  } catch (err) {
    const message = (err as Error).message;
    check(message.includes(text), `${what}: ${message}`);
  }
}

// ---- round trip through every format the matrix names ----------------------------------------------

const ROUND_TRIP = ["vwx", "dxf", "pdf", "emf", "ifc", "skp", "3dm", "glb", "obj", "fbx", "dae", "stl", "ply", "3ds", "usdz"];
/** The formats whose 3D model comes back: the fixture's ground box must keep its size. */
const THREE_D = new Set(["ifc", "skp", "3dm", "glb", "obj", "fbx", "dae", "stl", "ply", "3ds", "usdz"]);
/** How each format's file says its units and up axis, when it doesn't say them itself. */
const READ_AS: Readonly<Record<string, ReadOptions>> = {
  obj: { units: "m", yUp: true },
  stl: { units: "mm", yUp: false },
  ply: { units: "m", yUp: false },
  "3ds": { units: "m", yUp: false },
};

for (const id of ROUND_TRIP) {
  const t0 = performance.now();
  try {
    const written = await writeAs(fixtureDrawing(), id);
    const drawing = await readAny(written.bytes, written.name, READ_AS[id] ?? {});
    const s = describe(drawing);
    const ms = Math.round(performance.now() - t0);
    if (THREE_D.has(id)) {
      const b = s.bounds3d;
      const extent = b ? `${Math.round(b.x1 - b.x0)} x ${Math.round(b.y1 - b.y0)} x ${Math.round(b.z1 - b.z0)} mm` : "none";
      check(b !== null && near(b.x1 - b.x0, 1000) && near(b.y1 - b.y0, 2000) && near(b.z1 - b.z0, 3000), `${id}: 3D extent ${extent} (${ms} ms)`);
    } else if (id === "vwx") {
      const names = s.layers.map((l) => l.name).join(",");
      check(names === "Ground,Upper", `vwx: layers ${names} (${ms} ms)`);
    } else {
      check(s.totalObjects >= 3, `${id}: ${s.totalObjects} objects (${ms} ms)`);
    }
  } catch (err) {
    check(false, `${id}: ${(err as Error).message}`);
  }
}

// ---- DXF class layers ----------------------------------------------------------------------------------

{
  const written = await writeAs(fixtureDrawing(), "dxf", { dxfLayers: "classes" });
  const drawing = await readAny(written.bytes, written.name);
  check(drawing.session.doc.classes().some((c) => c.name === "Walls"), "DXF written by class reads back with a Walls class");
}

// ---- placer rules ----------------------------------------------------------------------------------------

{
  const s = openVwx(blankDrawing("mm"));
  const layer = designLayer(s);
  const placed = placeDxf(s, layer, parseDxf(exportDxf(fixtureDrawing().session.doc)));
  const top = s.doc.objects(layer).filter((o) => o.parentId === null);
  check(placed.count >= 3 && top.every((o) => o.kind !== "group"), `placeDxf makes ${placed.count} objects, none of them a top-level group`);
}

{
  const pdfBytes = exportPdf(fixtureDrawing().session.doc);
  const file = await openPdf(pdfBytes);
  const page = await file.page(0);
  const s = openVwx(blankDrawing("mm"));
  const placed = placePage(s, designLayer(s), page, 1);
  const bounds = describe({ session: s, name: "page.pdf", from: "pdf", skipped: placed.skipped, notes: [] }).bounds2d;
  check(bounds !== null && bounds.x0 >= -1 && bounds.y0 >= -1, `placePage puts the page's lower left at the origin (${bounds ? `${bounds.x0.toFixed(1)}, ${bounds.y0.toFixed(1)}` : "none"})`);
}

// ---- refusals -------------------------------------------------------------------------------------------

await rejects("an unknown extension", () => readAny(new Uint8Array([1, 2, 3]), "x.xyz"), "Rodeo doesn't read .xyz files");
await rejects("a Revit family", () => readAny(new Uint8Array([1, 2, 3]), "x.rfa"), "Revit family or template");
await rejects("a Revit file that isn't one", () => readAny(new Uint8Array([1, 2, 3]), "x.rvt"), "this isn't a Revit file");
await rejects("a DWG that isn't one", () => readAny(new Uint8Array([1, 2, 3]), "x.dwg"), "DWG");
await rejects("a PDF page out of range", () => readAny(exportPdf(fixtureDrawing().session.doc), "fixture.pdf", { page: 9 }), "the PDF has pages 1 to 1");
// a DXF with an empty ENTITIES section, which is a drawing with nothing in it (no SECTION at all is not a DXF)
await rejects("an empty DXF", () => readAny(new TextEncoder().encode("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"), "empty.dxf"), "there's nothing in it Rodeo can draw");

// ---- the converter pages agree with the format table ----------------------------------------------------

const pages = await import("./pages.ts").catch(() => null);
if (!pages) {
  console.log("skip pages");
} else {
  const f = formats();
  // one line for the pairs that agree, and one for each that doesn't
  const badPairs = pages.PAIRS.filter(([from, to]) => !(f.read.includes(from) && (f.write.includes(to) || to === "png")));
  check(badPairs.length === 0, `${pages.PAIRS.length - badPairs.length} of ${pages.PAIRS.length} page pairs are in the format table${badPairs.map(([a, b]) => ` (not: ${a} to ${b})`).join("")}`);
  // a page may say it writes PNG, which the core does not: the page makes that from the SVG
  const badFormats = pages.PAGE_FORMATS.filter((page) => !(page.read === f.read.includes(page.id) && (page.id === "png" ? page.write : page.write === f.write.includes(page.id))));
  check(badFormats.length === 0, `${pages.PAGE_FORMATS.length - badFormats.length} of ${pages.PAGE_FORMATS.length} page formats have the read and write flags of the format table${badFormats.map((p) => ` (not: ${p.id})`).join("")}`);
}

// ---- real files, when the machine has them -------------------------------------------------------------

/** The sample drawing, read through a copy in a temporary folder that is removed after. */
function readCopy(path: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "rodeo-convert-check-"));
  try {
    const copy = join(dir, basename(path));
    copyFileSync(path, copy);
    return new Uint8Array(readFileSync(copy));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAMPLE = fileURLToPath(new URL("../../../samples/sample.vwx", import.meta.url));
if (existsSync(SAMPLE)) {
  const bytes = readCopy(SAMPLE);
  const drawing = await readAny(bytes, "sample.vwx").catch((err: unknown) => (check(false, `sample: ${(err as Error).message}`), null));
  if (drawing) {
    const has3d = describe(drawing).triangles > 0;
    for (const id of ["pdf", "dxf", "ifc", "glb"]) {
      // a plan with no 3D model has nothing for a 3D format, which the writer refuses by design
      if (THREE_D.has(id) && !has3d) {
        console.log(`skip sample to ${id}: it has no 3D model`);
        continue;
      }
      const t0 = performance.now();
      try {
        const written = await writeAs(drawing, id);
        console.log(`ok   sample to ${id}: ${written.bytes.length} bytes (${Math.round(performance.now() - t0)} ms)`);
      } catch (err) {
        check(false, `sample to ${id}: ${(err as Error).message}`);
      }
    }
  }
} else {
  console.log("skip sample");
}

// folders of public files, named by environment variable; each file is read and written in memory
const FOLDERS = ["DWG_SAMPLES", "RVT_SAMPLES", "PLN_SAMPLES", "SKP_DIR"];
for (const env of FOLDERS) {
  const dir = process.env[env];
  if (!dir) {
    console.log(`skip ${env} (not set)`);
    continue;
  }
  for (const file of readdirSync(dir).sort()) {
    const path = join(dir, file);
    if (!statSync(path).isFile() || formatOfName(file) === null) continue;
    const t0 = performance.now();
    try {
      const drawing = await readAny(new Uint8Array(readFileSync(path)), file);
      const line = summaryLine(describe(drawing));
      // a 2D drawing is written as a PDF, a model as an IFC
      const to = formatById(drawing.from)?.kind === "2d" ? "pdf" : "ifc";
      const written = await writeAs(drawing, to);
      console.log(`ok   ${file}: ${line}; ${to} ${written.bytes.length} bytes (${Math.round(performance.now() - t0)} ms)`);
    } catch (err) {
      check(false, `${file}: ${(err as Error).message}`);
    }
  }
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
