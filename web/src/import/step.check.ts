// Checks the STEP and IGES readers under Node. Run from web/:
//   npx tsx src/import/step.check.ts
// A box and a two-object model, one of whose boxes has a blue top, are written by export/step.ts and
// export/iges.ts and read back: the parts, their colours, names and extents in millimetres. The same STEP
// file is read through the converter (convert/read.ts), and bytes that aren't a STEP or IGES file fail with
// the message the editor shows. With DWG_SAMPLES set to a folder of public DWG files (LibreDWG's test-data,
// never committed), its r11/ACEB10.stp, an Autodesk Inventor assembly of seven named parts, reads as one
// group of those seven parts, with extents and a triangle count in range.

import "../convert/node.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, formatOfName, formats, readAny } from "../convert/index.ts";
import { exportIges } from "../export/iges.ts";
import type { Model3D } from "../export/scene3d.ts";
import { exportStep } from "../export/step.ts";
import type { MeshFile, MeshPart, MeshTreeNode } from "./mesh.ts";
import { occtLib } from "./occt.ts";
import { readIges, readStep } from "./step.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V3 = [number, number, number];

/** A box's 12 triangles, counter-clockwise from outside, in millimetres; `skip` leaves faces out. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: number[] = []): number[] {
  const c = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.filter((_, i) => !skip.includes(i)).flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]);
}

/** A model of one design layer holding the objects, each piece in its colour. */
const model = (objects: { name: string; pieces: { color: string; triangles: number[] }[] }[]): Model3D => ({
  layers: [
    {
      id: "L",
      name: "Design Layer-1",
      elevation: 0,
      objects: objects.map((o, i) => ({ id: `o${i}`, name: o.name, className: "None", pieces: o.pieces.map((p) => ({ color: p.color, opacity: 1, triangles: new Float32Array(p.triangles) })) })),
    },
  ],
});

/** The model the round trips write: a red box, and a red box with a blue top, 3 m apart along x. */
const twoObjects = (): Model3D =>
  model([
    { name: "Red box", pieces: [{ color: "#ff0000", triangles: box(0, 0, 0, 1000, 1000, 1000) }] },
    {
      name: "Lid",
      pieces: [
        { color: "#ff0000", triangles: box(3000, 0, 0, 4000, 1000, 1000, [1]) },
        { color: "#0000ff", triangles: box(3000, 0, 0, 4000, 1000, 1000, [0, 2, 3, 4, 5]) },
      ],
    },
  ]);

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Every part of a tree, its groups' too. */
function partsOf(n: MeshTreeNode): MeshPart[] {
  return [...n.parts, ...n.groups.flatMap(partsOf)];
}

/** A part's colour as #rrggbb, or "" for none. */
function hexOf(p: MeshPart): string {
  if (!p.color) return "";
  return "#" + [p.color.r, p.color.g, p.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
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

/** Each part's name and colour as "name colour", sorted, for comparing a set. */
const signature = (parts: readonly MeshPart[]): string[] => parts.map((p) => `${p.name} ${hexOf(p)}`).sort();

/** A file's shapes as a plain tree: its top's parts and groups, a file with no symbols. */
function topOf(f: MeshFile): MeshTreeNode {
  if (!f.tree) throw new Error("the reader gave no tree");
  return f.tree.top;
}

const occt = await occtLib();

// a STEP file of a box alone: one part, twelve triangles, the colour the file gives
{
  const r = exportStep(model([{ name: "Box", pieces: [{ color: "#00ff00", triangles: box(0, 0, 0, 1000, 1000, 1000) }] }]), false, "Box.vwx", new Date("2026-11-08T12:00:00Z"));
  const t0 = performance.now();
  const f = readStep(bytesOf(r.text), occt);
  console.log(`  STEP box read in ${Math.round(performance.now() - t0)} ms`);
  const parts = partsOf(topOf(f));
  check(f.frame?.mm === 1 && f.frame.yUp === false, "STEP: the frame is millimetres, z up");
  check(parts.length === 1 && triangles(parts) === 12, `STEP box: one part of 12 triangles (${parts.length} parts, ${triangles(parts)} triangles)`);
  check(parts.length === 1 && hexOf(parts[0]) === "#00ff00", "STEP box: green as the file gives it");
  const e = extentOf(parts);
  check(sameExtent(e.lo, [0, 0, 0]) && sameExtent(e.hi, [1000, 1000, 1000]), "STEP box: 1000 mm cube, from the origin");
}

// the two-object model as STEP: its three parts, the blue top split from the red box it is on, the extents in millimetres
{
  const r = exportStep(twoObjects(), false, "Test.vwx", new Date("2026-11-08T12:00:00Z"));
  const t0 = performance.now();
  const f = readStep(bytesOf(r.text), occt);
  console.log(`  STEP two objects read in ${Math.round(performance.now() - t0)} ms`);
  const parts = partsOf(topOf(f));
  check(parts.length === 3, `STEP two objects: three parts, the blue top its own (${parts.length})`);
  check(signature(parts).join("|") === "Test #0000ff|Test #ff0000|Test #ff0000", `STEP two objects: colours ${signature(parts).join(", ")}`);
  check(triangles(parts) === 24, `STEP two objects: 24 triangles (${triangles(parts)})`);
  // occt names a STEP shape after its product, which Rodeo's writer titles with the file, not after the object
  check(parts.every((p) => p.name === "Test"), `STEP two objects: named after the file's product (${[...new Set(parts.map((p) => p.name))].join(", ")})`);
  const e = extentOf(parts);
  check(sameExtent(e.lo, [0, 0, 0]) && sameExtent(e.hi, [4000, 1000, 1000]), `STEP two objects: extents 4000 x 1000 x 1000 mm (${e.hi.map((v) => v.toFixed(1)).join(" x ")})`);
}

// the same model as IGES, which keeps each object's name
{
  const r = exportIges(twoObjects(), false, "Test.vwx");
  const t0 = performance.now();
  const f = readIges(bytesOf(r.text), occt);
  console.log(`  IGES two objects read in ${Math.round(performance.now() - t0)} ms`);
  const parts = partsOf(topOf(f));
  check(parts.length === 3, `IGES two objects: three parts (${parts.length})`);
  check(signature(parts).join("|") === ["Lid #0000ff", "Lid #ff0000", "Red box #ff0000"].join("|"), `IGES two objects: names and colours ${signature(parts).join(", ")}`);
  check(triangles(parts) === 24, `IGES two objects: 24 triangles (${triangles(parts)})`);
  const e = extentOf(parts);
  check(sameExtent(e.lo, [0, 0, 0]) && sameExtent(e.hi, [4000, 1000, 1000]), `IGES two objects: extents 4000 x 1000 x 1000 mm (${e.hi.map((v) => v.toFixed(1)).join(" x ")})`);
}

// the converter reads the same STEP and IGES files, by their extensions, into a drawing of their parts
{
  check(formatOfName("model.stp") === "step" && formatOfName("MODEL.STEP") === "step", "converter: .stp and .step are STEP");
  check(formatOfName("model.igs") === "iges" && formatOfName("model.iges") === "iges", "converter: .igs and .iges are IGES");
  check(formats().read.includes("step") && formats().read.includes("iges"), "converter: STEP and IGES are read formats");
  const step = exportStep(twoObjects(), false, "Test.vwx");
  const d = describe(await readAny(bytesOf(step.text), "two.stp"));
  check(d.from === "step" && d.fromName === "STEP", `converter: a STEP file is read as STEP (${d.fromName})`);
  check(d.triangles === 24 && d.bounds3d !== null && sameExtent([d.bounds3d.x0, d.bounds3d.y0, d.bounds3d.z0], [0, 0, 0]) && sameExtent([d.bounds3d.x1, d.bounds3d.y1, d.bounds3d.z1], [4000, 1000, 1000]), `converter: its 24 triangles fill 4000 x 1000 x 1000 mm (${d.triangles}, ${JSON.stringify(d.bounds3d)})`);
  const iges = exportIges(twoObjects(), false, "Test.vwx");
  const di = describe(await readAny(bytesOf(iges.text), "two.igs"));
  check(di.from === "iges" && di.triangles === 24, `converter: an IGES file is read as IGES (${di.fromName}, ${di.triangles} triangles)`);
}

// bytes that aren't a STEP or IGES file, and a STEP file with no shapes in it, are refused with a plain reason
{
  const refused = (f: () => unknown, what: string): void => {
    try {
      f();
      check(false, `${what}: refused`);
    } catch (e) {
      check(e instanceof Error && e.message === what, `${what}: refused (${e instanceof Error ? e.message : String(e)})`);
    }
  };
  refused(() => readStep(bytesOf("hello, this is not a step file\n"), occt), "no shapes could be read from this STEP file");
  refused(() => readIges(bytesOf("hello, this is not an iges file\n"), occt), "no shapes could be read from this IGES file");
  refused(
    () => readStep(bytesOf("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('check'),'2;1');\nFILE_NAME('bare.stp','2026-11-08T00:00:00',(''),(''),'','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n"), occt),
    "no shapes could be read from this STEP file",
  );
}

// an Inventor assembly from LibreDWG's test data: its tree, its seven parts, the triangles and the extents
const samples = process.env.DWG_SAMPLES;
if (samples) {
  const file = join(samples.replace(/^~(?=\/)/, homedir()), "libredwg/test/test-data/r11/ACEB10.stp");
  const t0 = performance.now();
  const f = readStep(new Uint8Array(readFileSync(file)), occt);
  console.log(`  ACEB10.stp read in ${Math.round(performance.now() - t0)} ms`);
  const top = topOf(f);
  check(top.parts.length === 0 && top.groups.length === 1, `ACEB10: one assembly group under the file (${top.groups.length} groups)`);
  const assembly = top.groups[0];
  check(assembly?.name === "EBC-10.iam (LevelofDetail1)", `ACEB10: the group is the assembly node (${assembly?.name})`);
  const named = assembly?.parts.map((p) => p.name).sort() ?? [];
  check(
    assembly?.parts.length === 7 && named.join("|") === ["Slotted Pan Head Machine Screw - Inch 4 - 40 x .25", "Slotted Pan Head Machine Screw - Inch 4 - 40 x .25", "Slotted Pan Head Machine Screw - Inch 4 - 40 x .25", "Slotted Pan Head Machine Screw - Inch 4 - 40 x .25", "Slotted Pan Head Machine Screw - Inch 4 - 40 x .25", "decal mini", "ebc-10 example"].join("|"),
    `ACEB10: seven named parts (${named.join("; ")})`,
  );
  const n = triangles(partsOf(top));
  check(n > 10_000 && n < 250_000, `ACEB10: a sane triangle count (${n.toLocaleString("en")})`);
  const e = extentOf(partsOf(top));
  check(sameExtent(e.lo, [0, 0, 0]) && sameExtent(e.hi, [63.5, 88.9, 34.93]), `ACEB10: extents 63.5 x 88.9 x 34.93 mm (${e.hi.map((v) => v.toFixed(2)).join(" x ")})`);
}

console.log(failures ? `${failures} failed` : "all passed");
process.exitCode = failures ? 1 : 0;
