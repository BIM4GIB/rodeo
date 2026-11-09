// Checks the meshing of DWG and DXF solids under Node. Run from web/:
//   npx tsx src/import/solids.check.ts
// A DXF drawing is built with a block holding a box solid (SAT text, acis.fixture.ts) inserted twice,
// once plainly and once mirrored, beside a solid with no data and a region whose data does not read.
// The box is meshed once for both inserts, each placed box holds 8 (its volume) facing out, and the
// other two are counted as skipped. With DWG_SAMPLES set to the folder of public DWG files, every file
// with solids, regions or bodies is read and meshed as the import does it, and each one must mesh.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { boxText, placed } from "./acis.fixture.ts";
import { parseDwg } from "./dwg.ts";
import { parseDxf, type DxfMesh } from "./dxf.ts";
import { loadOcct, type Occt } from "./occt.ts";
import { meshSolids } from "./solids.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** DXF text from code, value pairs. */
const dxf = (...pairs: (string | number)[]): string => {
  const lines: string[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) lines.push(String(pairs[i]), String(pairs[i + 1]));
  return `${lines.join("\n")}\n`;
};

/** The signed volume a closed mesh holds: positive when its triangles face out. */
function volumeOf(m: DxfMesh): number {
  let v = 0;
  for (const f of m.faces) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = f;
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/** The middle of a mesh's corners. */
function middleOf(m: DxfMesh): number[] {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const f of m.faces) {
    for (let i = 0; i < f.length; i++) {
      box[i % 3] = Math.min(box[i % 3], f[i]);
      box[3 + (i % 3)] = Math.max(box[3 + (i % 3)], f[i]);
    }
  }
  return [0, 1, 2].map((k) => (box[k] + box[k + 3]) / 2);
}

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);

const occt = await loadOcct();
let reads = 0;
/** OpenCascade, counting the STEP files it is given. */
const counted = new Proxy(occt, {
  get(target, key) {
    if (key !== "ReadStepFile") return Reflect.get(target, key);
    return (...args: Parameters<Occt["ReadStepFile"]>) => {
      reads++;
      return target.ReadStepFile(...args);
    };
  },
});

{
  const sat = boxText(700).split("\n").filter((line) => line !== "");
  const text = dxf(
    0, "SECTION", 2, "BLOCKS",
    0, "BLOCK", 8, 0, 2, "BOX", 70, 0, 10, 0, 20, 0, 30, 0,
    0, "3DSOLID", 5, "1A", 8, "PARTS", 62, 3, 100, "AcDbModelerGeometry", 70, 1, ...sat.flatMap((line) => [1, line]),
    0, "ENDBLK",
    0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES",
    0, "INSERT", 8, 0, 2, "BOX", 10, 100, 20, 0, 30, 0,
    0, "INSERT", 8, 0, 2, "BOX", 10, 0, 20, 100, 30, 0, 41, -1,
    0, "3DSOLID", 5, "2A", 8, "PARTS", 100, "AcDbModelerGeometry", 70, 1,
    0, "REGION", 5, "2B", 8, "PARTS", 100, "AcDbModelerGeometry", 70, 1, 1, "400 0 1 0", 1, "nothing to read",
    0, "ENDSEC",
    0, "EOF",
  );
  const d = parseDxf(text);
  check(d.solids.length === 3 && d.skipped["3DSOLID"] === 1, `the walk gathers the solids with data, and counts the one without (${d.solids.length}, ${JSON.stringify(d.skipped)})`);
  check(d.solids[0]?.data === d.solids[1]?.data, "both inserts of the block's solid share its data");
  const m = await meshSolids(d, () => Promise.resolve(counted));
  check(m.solids.length === 0 && m.meshes.length === 2, `the box is meshed for both inserts (${m.meshes.length} meshes)`);
  check(reads === 1, `the box is meshed once, and the region, with no body, not at all (${reads} STEP files read)`);
  check(m.skipped.REGION === 1 && m.skipped["3DSOLID"] === 1, `a region that does not read is skipped (${JSON.stringify(m.skipped)})`);
  const [plain, mirrored] = m.meshes;
  if (plain && mirrored) {
    const at = placed([0, 0, 0]);
    check(plain.faces.length === 12 && plain.layer === "PARTS" && plain.type === "3DSOLID", `the box is 12 triangles on its layer (${plain.faces.length} on ${plain.layer})`);
    check(Math.abs(volumeOf(plain) - 8) < 1e-3, `the plain box holds 8, facing out (${volumeOf(plain)})`);
    check(Math.abs(volumeOf(mirrored) - 8) < 1e-3, `the mirrored box holds 8, still facing out (${volumeOf(mirrored)})`);
    check(near(middleOf(plain), [at[0] + 100, at[1], at[2]]), `the plain box is where its insert puts it (${middleOf(plain)})`);
    check(near(middleOf(mirrored), [-at[0], at[1] + 100, at[2]]), `the mirrored box is mirrored in x (${middleOf(mirrored)})`);
  }
  const none = parseDxf(dxf(0, "SECTION", 2, "ENTITIES", 0, "LINE", 8, 0, 10, 0, 20, 0, 11, 1, 21, 0, 0, "ENDSEC", 0, "EOF"));
  const same = await meshSolids(none, () => Promise.reject(new Error("OpenCascade should not load")));
  check(same === none, "a drawing with no solids is given back as it is, with no OpenCascade");
}

const samples = process.env.DWG_SAMPLES;
if (samples) {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.dwg$/i.test(n)) files.push(p);
    }
  };
  walk(samples);
  let total = 0;
  for (const path of files) {
    let d;
    try {
      d = parseDwg(new Uint8Array(readFileSync(path)));
    } catch {
      continue; // files from before R13 and the like, which dwg.check.ts covers
    }
    if (d.solids.length === 0) continue;
    const name = path.slice(samples.length + 1);
    const t0 = performance.now();
    const m = await meshSolids(d, () => Promise.resolve(occt));
    const ms = performance.now() - t0;
    const lost = ["3DSOLID", "REGION", "BODY"].reduce((n, type) => n + (m.skipped[type] ?? 0) - (d.skipped[type] ?? 0), 0);
    const triangles = m.meshes.slice(d.meshes.length).reduce((n, mesh) => n + mesh.faces.length, 0);
    total += d.solids.length;
    check(lost === 0 && m.meshes.length - d.meshes.length === d.solids.length, `${name}: all ${d.solids.length} solids, regions and bodies mesh (${triangles} triangles, ${lost} skipped, ${Math.round(ms)} ms)`);
  }
  check(total > 0, `${total} solids, regions and bodies of the sample files meshed`);
}

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
