// Checks the converter's core under Node. Run from web/:
//   npx tsx src/convert/write.check.ts
// The format table lists what is read and written; each writable format writes the fixture drawing
// (two design layers, one hidden, with a rectangle, a line in a class, a circle, a text and two boxes)
// into bytes with its file's signature; layers chosen by name, id or case-insensitively are the ones
// written, and an unknown one or a format Rodeo doesn't write is refused with a message. The DXF
// layers come out by layer or by class. describe reads the fixture's counts and extent, and the
// one-line summary names the format and the layers.

import "./node.ts";
import { openVwx } from "../core/index.ts";
import { describe, summaryLine, summaryText } from "./describe.ts";
import { formatById, formats, formatOfName, outputFormat } from "./formats.ts";
import { fixtureDrawing } from "./fixture.ts";
import { writeAs } from "./write.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);
const near = (a: number, b: number, tol = 1): boolean => Math.abs(a - b) <= tol;
/** The triangle count an STL file holds, from its header (bytes 80 to 83). */
const stlTriangles = (b: Uint8Array): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true);

// Each writable format's file starts with what its standard says it starts with.
const SIGNATURE: Readonly<Record<string, (b: Uint8Array) => boolean>> = {
  vwx: (b) => openVwx(b, "fixture.vwx").doc.layers().map((l) => l.name).join(",") === "Ground,Upper",
  pdf: (b) => decode(b.subarray(0, 4)) === "%PDF",
  svg: (b) => decode(b).includes("<svg"),
  eps: (b) => decode(b.subarray(0, 10)) === "%!PS-Adobe",
  emf: (b) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true) === 1,
  dxf: (b) => decode(b).startsWith("0\nSECTION"),
  ifc: (b) => decode(b.subarray(0, 12)).startsWith("ISO-10303-21"),
  step: (b) => decode(b.subarray(0, 12)).startsWith("ISO-10303-21"),
  glb: (b) => decode(b.subarray(0, 4)) === "glTF",
  stl: (b) => b.length >= 84 && stlTriangles(b) === 12,
  usdz: (b) => decode(b.subarray(0, 2)) === "PK",
  "3dm": (b) => b.length > 0,
  dae: (b) => decode(b.subarray(0, 5)) === "<?xml",
  ply: (b) => decode(b.subarray(0, 3)) === "ply",
  fbx: (b) => decode(b.subarray(0, 18)) === "Kaydara FBX Binary",
  "3ds": (b) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(0, true) === 0x4d4d,
};

// ---- the format table ----------------------------------------------------------------------------

const f = formats();
const READ = ["vwx", "dwg", "rvt", "pln", "ifc", "skp", "3dm", "usdz"];
check(READ.every((id) => f.read.includes(id)), `formats().read includes ${READ.join(", ")}`);
check(f.write.length === 19, `formats().write has the 19 writable ids (${f.write.length})`);
check(!f.write.includes("dwg") && !f.write.includes("png") && !f.read.includes("png"), "formats(): no dwg or png written, no png read");
check(outputFormat("x.STP") === "step", `outputFormat("x.STP") is step (${outputFormat("x.STP")})`);
check(outputFormat("gltf") === null, `outputFormat("gltf") is null (${outputFormat("gltf")})`);
check(outputFormat(".stp") === "step" && outputFormat("ifc") === "ifc", "outputFormat takes ids, extensions with or without a dot");
check(formatOfName("a.blend1") === "blend", `formatOfName("a.blend1") is blend (${formatOfName("a.blend1")})`);
check(formatOfName("tower.RVT") === "rvt" && formatOfName("plain") === null, "formatOfName ignores case and names without an extension");

// ---- every writable format --------------------------------------------------------------------------

const drawing = fixtureDrawing();
for (const id of f.write) {
  try {
    const out = await writeAs(drawing, id);
    // the name takes the format's first write extension
    const ext = formatById(id)?.writeExtensions[0];
    check(out.bytes.length > 0 && out.name === `fixture.${ext}`, `${id}: ${out.bytes.length} bytes as ${out.name}`);
    const sig = SIGNATURE[id];
    if (sig) check(sig(out.bytes), `${id}: its file signature`);
  } catch (err) {
    check(false, `${id}: writes (${(err as Error).message})`);
  }
}
{
  // the .vwx written reopens with the fixture's two layers
  const back = openVwx((await writeAs(drawing, "vwx")).bytes, "fixture.vwx");
  check(back.doc.layers().map((l) => l.name).join(",") === "Ground,Upper", "vwx reopens with layers Ground and Upper");
}

// ---- layers, DXF and refusals -----------------------------------------------------------------------

{
  const dxfClasses = decode((await writeAs(drawing, "dxf", { dxfLayers: "classes" })).bytes);
  check(dxfClasses.includes("\nWalls\n"), "dxf by class: a Walls layer");
  const dxfLayers = decode((await writeAs(drawing, "dxf")).bytes);
  check(dxfLayers.includes("\nGround\n"), "dxf by layer: a Ground layer");
  check(!dxfLayers.includes("\nWalls\n"), "dxf by layer: no class layer");
  const dwgSource = { ...drawing, from: "dwg" };
  check(decode((await writeAs(dwgSource, "dxf")).bytes).includes("\nWalls\n"), "dxf from a DWG defaults to classes");
}

{
  const stl = await writeAs(drawing, "stl", { layers: ["Upper"] });
  check(stlTriangles(stl.bytes) === 12, `stl of Upper alone has 12 triangles (${stlTriangles(stl.bytes)})`);
  const byId = await writeAs(drawing, "stl", { layers: [drawing.session.doc.layers()[0].id] });
  check(stlTriangles(byId.bytes) === 12, "stl by layer id takes that layer");
  const byCase = await writeAs(drawing, "stl", { layers: ["ground"] });
  check(stlTriangles(byCase.bytes) === 12, "stl by name, ignoring case");
}

try {
  await writeAs(drawing, "ifc", { layers: ["nope"] });
  check(false, "ifc of an unknown layer is refused");
} catch (err) {
  check((err as Error).message.startsWith('no layer is called "nope"'), `ifc of an unknown layer: ${(err as Error).message}`);
}
try {
  await writeAs(drawing, "dwg");
  check(false, "dwg is refused");
} catch (err) {
  check((err as Error).message.startsWith("Rodeo doesn't write dwg"), `dwg is refused: ${(err as Error).message}`);
}

// ---- describe -----------------------------------------------------------------------------------------

const d = describe(fixtureDrawing());
console.log(summaryText(d).join("\n"));
check(d.units === "Millimeters", `units are ${d.units}`);
check(d.layers.length === 2, `two layers (${d.layers.length})`);
console.log("objects:", JSON.stringify(d.objects));
check(d.totalObjects === 6, `six objects counted (${d.totalObjects})`);
check(d.layers.map((l) => l.objects).join(",") === "5,1", `layers count their objects: 5 and 1 (${d.layers.map((l) => l.objects).join(",")})`);
check(Object.keys(d.objects).length >= 4, `at least four object types (${Object.keys(d.objects).length})`);
check(d.triangles === 24, `24 triangles (${d.triangles})`);
check(d.bounds3d !== null && near(d.bounds3d.x1 - d.bounds3d.x0, 5500) && near(d.bounds3d.z1 - d.bounds3d.z0, 3000), "3D extent covers the hidden layer too (5500 wide, 3000 tall)");
const line = summaryLine(d);
check(line.includes("Vectorworks · 2 layers"), `summaryLine: ${line}`);

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
