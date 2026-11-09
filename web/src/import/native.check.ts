// Checks the CAD part reader (import/native.ts) under Node. Run from web/:
//   npx tsx src/import/native.check.ts
// A box is written as a STEP file by export/step.ts, and a stand-in converter hands it back as a format's
// reader would (no WebAssembly is needed): the top's title (the file and the app its format names), the
// warnings and level, the box's one part of 12 triangles in millimetres, the formats asked for in order (a
// .prt tries NX, then Creo, and loads Creo only when NX throws), and the plain reasons a file is refused (a
// reader's failure, both failing, a missing build, a STEP with no shapes). The worker's answer is checked for
// a trap (a WebAssembly RuntimeError), which ends its worker. The stand-in is handed to the converter
// (convert/read.ts) for a .SLDPRT. With CADMPEG_CORPUS set to a folder of CAD parts (never committed), every
// .FCStd, .f3d, .SLDPRT, .ipt and .prt under it is read through the real readers (vendor/cadmpeg, loaded by
// convert/node.ts), and a table of each file's format, level, parts, triangles, extents and time is printed.
// Last, a command line without a format's WebAssembly is refused with the plain reason.

import "../convert/node.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { describe, formatOfName, formats, readAny } from "../convert/index.ts";
import { libraries, useLibraries } from "../convert/libs.ts";
import { setWasmDir } from "../convert/node.ts";
import type { Model3D } from "../export/scene3d.ts";
import { exportStep } from "../export/step.ts";
import type { MeshFile, MeshPart, MeshTreeNode } from "./mesh.ts";
import { answerNative, type CadConvert, type Cadmpeg, type CadmpegConverted, type CadFormat, CadReaderMissing, type Converted, readConverted, readNative } from "./native.ts";
import { occtLib } from "./occt.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V3 = [number, number, number];

/** A box's 12 triangles, counter-clockwise from outside, in millimetres. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const c = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]);
}

/** A model of one design layer holding one green box. */
const greenBox = (): Model3D => ({
  layers: [{ id: "L", name: "Design Layer-1", elevation: 0, objects: [{ id: "o0", name: "Box", className: "None", pieces: [{ color: "#00ff00", opacity: 1, triangles: new Float32Array(box(0, 0, 0, 1000, 1000, 1000)) }] }] }],
});

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Every part of a tree, its groups' too. */
function partsOf(n: MeshTreeNode): MeshPart[] {
  return [...n.parts, ...n.groups.flatMap(partsOf)];
}

/** The lowest and highest corner of a set of parts, in millimetres. */
function extentOf(parts: readonly MeshPart[]): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (const f of p.faces)
      for (let i = 0; i < f.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], f[i + k]);
          hi[k] = Math.max(hi[k], f[i + k]);
        }
  return { lo, hi };
}

/** Whether two extents agree to a tenth of a millimetre. */
const sameExtent = (a: V3, b: V3): boolean => a.every((v, k) => Math.abs(v - b[k]) < 0.1);

/** The faces of a part set, in all: each face is one triangle. */
const triangles = (parts: readonly MeshPart[]): number => parts.reduce((n, p) => n + p.faces.length, 0);

/** A file's top, as a tree: the reader always gives one. */
function topOf(f: MeshFile): MeshTreeNode {
  if (!f.tree) throw new Error("the reader gave no tree");
  return f.tree.top;
}

/** A converted file as a format's reader gives it. */
const converted = (step: Uint8Array, format: string, warnings: string[] = [], level = 6): Converted => ({ step, format, level, warnings });

/**
 * A stand-in for the readers: `answer` gives the converted file for each format asked for, or throws the
 * reason as a reader does. `asked` lists the formats asked for, in order.
 */
function standIn(answer: (format: CadFormat) => Converted): { convert: CadConvert; asked: CadFormat[] } {
  const asked: CadFormat[] = [];
  const convert: CadConvert = async (format) => {
    asked.push(format);
    return answer(format);
  };
  return { convert, asked };
}

/** A reader that refuses the file with `reason`, as its to_step throws a string. */
const refuse = (reason: string): never => {
  throw reason;
};

/** A reader that is not on this computer. */
const missing = (): never => {
  throw new CadReaderMissing("not here");
};

/** Whether `f` throws with exactly `message`. */
async function refused(f: () => unknown, message: string, what: string): Promise<void> {
  try {
    await f();
    check(false, `${what}: refused`);
  } catch (e) {
    check(e instanceof Error && e.message === message, `${what}: refused (${e instanceof Error ? e.message : String(e)})`);
  }
}

// a cadmpeg result as the module gives it: getters, and free counted
let freed = 0;
function moduleResult(step: Uint8Array, format: string, warnings: string, level = 6): CadmpegConverted {
  return {
    get step() {
      return step;
    },
    get format() {
      return format;
    },
    get level() {
      return level;
    },
    get warnings() {
      return warnings;
    },
    free() {
      freed++;
    },
  };
}

const occt = await occtLib();
const box3 = bytesOf(exportStep(greenBox(), false, "Box.vwx", new Date("2026-11-08T12:00:00Z")).text);
const bare = bytesOf(
  "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('check'),'2;1');\nFILE_NAME('bare.stp','2026-11-08T00:00:00',(''),(''),'','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n",
);

// a SolidWorks part: the box, its title from the file and the app, the warnings and level, one format asked
{
  const { convert, asked } = standIn(() => converted(box3, "sldprt", ['colour lost on one feature', '2 features not converted'], 7));
  const t0 = performance.now();
  const f = await readNative(box3, "Bracket.SLDPRT", convert, occt);
  console.log(`  SolidWorks box read in ${Math.round(performance.now() - t0)} ms`);
  const parts = partsOf(topOf(f));
  check(f.title === "Bracket (SolidWorks part)", `CAD: the top is titled after the file and its app (${f.title})`);
  check(JSON.stringify(f.warnings) === '["colour lost on one feature","2 features not converted"]', `CAD: cadmpeg's warnings come back (${JSON.stringify(f.warnings)})`);
  check(f.level === 7, `CAD: cadmpeg's support level comes back (${f.level})`);
  check(f.frame?.mm === 1 && f.frame.yUp === false, "CAD: the frame is millimetres, z up");
  check(parts.length === 1 && triangles(parts) === 12, `CAD box: one part of 12 triangles (${parts.length} parts, ${triangles(parts)} triangles)`);
  const e = extentOf(parts);
  check(sameExtent(e.lo, [0, 0, 0]) && sameExtent(e.hi, [1000, 1000, 1000]), "CAD box: 1000 mm cube, from the origin");
  check(JSON.stringify(asked) === '["sldprt"]', `CAD: only the SolidWorks reader is asked (${JSON.stringify(asked)})`);
}

// each format names its app; a .prt that the reader names by none is NX or Creo
{
  const apps: [CadFormat, string, string][] = [
    ["sldprt", "Part.SLDPRT", "SolidWorks"],
    ["inventor", "Part.ipt", "Inventor"],
    ["fcstd", "Part.FCStd", "FreeCAD"],
    ["f3d", "Part.f3d", "Fusion 360"],
    ["nx", "Part.prt", "NX"],
    ["creo", "Part.prt", "Creo"],
  ];
  for (const [id, name, app] of apps) {
    // a .prt tries NX first, so Creo's row refuses NX to reach Creo
    const f = await readNative(box3, name, standIn((fmt) => (id === "creo" && fmt === "nx" ? refuse("not NX") : converted(box3, fmt))).convert, occt);
    check(f.title === `Part (${app} part)`, `CAD: format ${id} is titled "${f.title}"`);
  }
  const f = await readNative(box3, "Part.prt", standIn(() => converted(box3, "zzz")).convert, occt);
  check(f.title === "Part (NX or Creo part)", `CAD: a .prt whose reader names no known app is titled by its extension (${f.title})`);
}

// a .prt tries NX first and loads Creo only when NX throws; NX converting keeps Creo unloaded
{
  const creoOnly = standIn((fmt) => (fmt === "nx" ? refuse("not an NX file") : converted(box3, "creo")));
  const f = await readNative(box3, "Part.prt", creoOnly.convert, occt);
  check(f.title === "Part (Creo part)", `CAD .prt: Creo reads what NX refuses (${f.title})`);
  check(JSON.stringify(creoOnly.asked) === '["nx","creo"]', `CAD .prt: NX asked first, then Creo (${JSON.stringify(creoOnly.asked)})`);
  const nxFirst = standIn((fmt) => converted(box3, fmt === "nx" ? "nx" : "creo"));
  const g = await readNative(box3, "Part.prt", nxFirst.convert, occt);
  check(g.title === "Part (NX part)" && JSON.stringify(nxFirst.asked) === '["nx"]', `CAD .prt: NX reads it, Creo is never loaded (${g.title}, asked ${JSON.stringify(nxFirst.asked)})`);
}

// warnings that are empty or not a JSON array come back as none or as the text itself; freed once read
{
  freed = 0;
  const c = readConverted(moduleResult(box3, "sldprt", "", 3));
  check(c.warnings.length === 0 && c.level === 3 && c.format === "sldprt" && freed === 1, "CAD: no warnings given is none; the result is freed once");
  check(JSON.stringify(readConverted(moduleResult(box3, "sldprt", "not json")).warnings) === '["not json"]', "CAD: warnings that aren't JSON are kept as text");
  check(JSON.stringify(readConverted(moduleResult(box3, "sldprt", '["a","b"]')).warnings) === '["a","b"]', "CAD: warnings given as a JSON array come back as strings");
}

// a worker's answer: a module's result is done; a RuntimeError is a trap, anything else a plain failure
{
  const ok = await answerNative({ format: "sldprt", bytes: box3, name: "A.SLDPRT" }, async () => ({ to_step: () => moduleResult(box3, "sldprt", "[]") }));
  check(ok.type === "done" && ok.converted.format === "sldprt", "worker: a converted part is answered done");
  const trap = await answerNative({ format: "sldprt", bytes: box3, name: "A.SLDPRT" }, async () => ({
    to_step: () => {
      throw new WebAssembly.RuntimeError("unreachable");
    },
  }));
  check(trap.type === "error" && trap.trap === true && trap.message === "unreachable", "worker: a trap is answered with trap set");
  const plain = await answerNative({ format: "sldprt", bytes: box3, name: "A.SLDPRT" }, async () => ({ to_step: () => refuse("unsupported file version") }));
  check(plain.type === "error" && plain.trap === false && plain.message === "unsupported file version", "worker: a refusal is answered without trap");
  const loadFails = await answerNative({ format: "sldprt", bytes: box3, name: "A.SLDPRT" }, async (): Promise<Cadmpeg> => refuse("could not load"));
  check(loadFails.type === "error" && loadFails.trap === false, "worker: a module that fails to load is answered without trap");
}

// refusals: a reader's failure (with its reason, or without one), a missing build, both .prt readers failing, a file with no shapes
{
  await refused(() => readNative(box3, "Bracket.SLDPRT", standIn(() => refuse("unsupported file version")).convert, occt), "the reader can't open this SolidWorks part (unsupported file version)", "CAD: the reader's reason is given");
  await refused(() => readNative(box3, "Bracket.SLDPRT", standIn(() => refuse("")).convert, occt), "the reader can't open this SolidWorks part", "CAD: a failure with no reason");
  await refused(() => readNative(box3, "Part.ipt", standIn(() => refuse("x")).convert, occt), "the reader can't open this Inventor part (x)", "CAD: an Inventor failure names Inventor");
  await refused(() => readNative(box3, "Bracket.SLDPRT", standIn(missing).convert, occt), "SolidWorks parts need the full Rodeo build", "CAD: a SolidWorks part with no reader here needs the full build");
  await refused(() => readNative(box3, "Part.prt", standIn(missing).convert, occt), "NX or Creo parts need the full Rodeo build", "CAD: a .prt with neither reader here needs the full build");
  await refused(
    () => readNative(box3, "Part.prt", standIn((fmt) => refuse(fmt === "nx" ? "nx reason" : "creo reason")).convert, occt),
    "the reader can't open this NX or Creo part (NX: nx reason; Creo: creo reason)",
    "CAD .prt: both readers refuse, and the error names both",
  );
  await refused(
    () => readNative(box3, "Part.prt", standIn((fmt) => (fmt === "nx" ? missing() : refuse("creo reason"))).convert, occt),
    "the reader can't open this NX or Creo part (NX: needs the full Rodeo build; Creo: creo reason)",
    "CAD .prt: a missing NX reader is named with Creo's refusal",
  );
  await refused(() => readNative(bare, "Sketch.SLDPRT", standIn((fmt) => converted(bare, fmt)).convert, occt), "no solid bodies could be read from this SolidWorks part, which may hold only sketches or drawings", "CAD: a file of sketches has nothing to import");
}

// the converter reads the same part by its name, through the stand-in handed over in place of the readers
{
  check(formatOfName("Bracket.SLDPRT") === "cad" && formatOfName("a.ipt") === "cad" && formatOfName("a.FCStd") === "cad" && formatOfName("a.f3d") === "cad" && formatOfName("a.prt") === "cad", "converter: the five CAD part extensions are CAD parts");
  check(formatOfName("a.sldasm") === null && formatOfName("a.iam") === null, "converter: assemblies are not read");
  check(formats().read.includes("cad") && !formats().write.includes("cad"), "converter: CAD parts are a read-only format");
  const saved = libraries();
  useLibraries({ ...saved, convertCad: standIn(() => converted(box3, "sldprt", ["one warning"])).convert });
  try {
    const d = describe(await readAny(bytesOf("placeholder"), "Bracket.SLDPRT"));
    check(d.from === "cad" && d.fromName === "CAD", `converter: a .SLDPRT is read as a CAD part (${d.fromName})`);
    check(d.triangles === 12 && d.bounds3d !== null && sameExtent([d.bounds3d.x0, d.bounds3d.y0, d.bounds3d.z0], [0, 0, 0]) && sameExtent([d.bounds3d.x1, d.bounds3d.y1, d.bounds3d.z1], [1000, 1000, 1000]), `converter: its 12 triangles fill the 1000 mm cube (${d.triangles})`);
  } finally {
    useLibraries(saved);
  }
}

// the real readers over a folder of CAD parts (CADMPEG_CORPUS): each file's format, level, parts, triangles, extents, time, or refusal
const corpus = process.env.CADMPEG_CORPUS;
if (!corpus) {
  console.log("skip  CADMPEG_CORPUS is not set: no CAD parts read through the real readers");
} else {
  const dir = corpus.replace(/^~(?=\/)/, homedir());
  const convert = libraries().convertCad;
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((rel) => /\.(fcstd|f3d|sldprt|ipt|prt)$/i.test(rel) && statSync(join(dir, rel)).isFile())
    .sort();
  console.log("file | format | level | parts | triangles | extents (mm) | ms | warnings");
  let read = 0;
  for (const rel of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, rel)));
    const t0 = performance.now();
    try {
      const f = await readNative(bytes, basename(rel), convert, occt);
      const ms = Math.round(performance.now() - t0);
      const parts = partsOf(topOf(f));
      const e = extentOf(parts);
      const app = f.title?.match(/\((.*) part\)$/)?.[1] ?? "?";
      const size = e.hi.map((v, k) => (v - e.lo[k]).toFixed(1)).join(" x ");
      console.log(`${rel} | ${app} | L${f.level} | ${parts.length} | ${triangles(parts).toLocaleString("en")} | ${size} | ${ms} | ${f.warnings?.length ?? 0}`);
      read++;
    } catch (err) {
      console.log(`${rel} | ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  check(files.length > 0, `corpus: ${files.length} CAD parts found, ${read} read through the real readers`);
}

// a command line without a format's WebAssembly (the bundle carries none of the CAD readers): the plain reason
{
  setWasmDir(join(import.meta.dirname, "no-such-folder-for-the-check"));
  await refused(
    () => readAny(bytesOf("placeholder"), "Bracket.SLDPRT"),
    "SolidWorks parts need the full Rodeo build",
    "command line: a SolidWorks part with no reader beside it needs the full build",
  );
}

console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;
