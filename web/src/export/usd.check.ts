// Checks the USD export under Node. Run from web/:
//   npx tsx src/export/usd.check.ts
// A made-up drawing of three objects (a box in two colours, a textured square with its own UV
// map, a textured triangle the image is projected onto) goes out by layer, by texture and
// combined. The text's prims, materials, metadata and coordinates are read back, and the .usdz's
// files must be stored and start on 64-byte boundaries. With BLENDER set to Blender's binary
// (BLENDER=/Applications/Blender.app/Contents/MacOS/Blender) each scene is imported there too,
// and its meshes, faces, materials and image must come through.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "../core/bytes.ts";
import type { Mesh3D, ObjectInfo, ObjectRecord, ResourceInfo, VwxDocument } from "../core/types.ts";
import { deflate } from "./flate.ts";
import { usdIdent, usdScene, usdzPackage } from "./usd.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A PNG of `w` × `h` RGB pixels. */
function png(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Uint8Array {
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (1 + 3 * w) + 1 + 3 * x);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflate(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const tri = (...pts: number[][]): number[] => pts.flat();
/** A 1 m box's faces, two triangles each, counter-clockwise from outside: the top in one list, the rest in the other. */
const s = 1000;
const top = [tri([0, 0, s], [s, 0, s], [s, s, s]), tri([0, 0, s], [s, s, s], [0, s, s])].flat();
const sides = [
  tri([0, 0, 0], [s, s, 0], [s, 0, 0]),
  tri([0, 0, 0], [0, s, 0], [s, s, 0]),
  tri([0, 0, 0], [s, 0, 0], [s, 0, s]),
  tri([0, 0, 0], [s, 0, s], [0, 0, s]),
  tri([s, 0, 0], [s, s, 0], [s, s, s]),
  tri([s, 0, 0], [s, s, s], [s, 0, s]),
  tri([s, s, 0], [0, s, 0], [0, s, s]),
  tri([s, s, 0], [0, s, s], [s, s, s]),
  tri([0, s, 0], [0, 0, 0], [0, 0, s]),
  tri([0, s, 0], [0, 0, s], [0, s, s]),
].flat();
const square = [tri([2000, 0, 0], [3000, 0, 0], [3000, 1000, 0]), tri([2000, 0, 0], [3000, 1000, 0], [2000, 1000, 0])].flat();
const squareUvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
// upright, facing -y: the image projects along y, at its 500 mm size
const wall = tri([4000, 0, 0], [5000, 0, 0], [5000, 0, 1000]);

const mesh = (objectId: string, layerId: string, triangles: number[], color: string, texture = -1, uvs?: number[]): Mesh3D => ({
  objectId,
  layerId,
  classIndex: 0,
  triangles: new Float32Array(triangles),
  edges: new Float32Array(),
  color,
  opacity: 1,
  texture,
  ...(uvs ? { uvs: new Float32Array(uvs) } : {}),
});
const meshes: Mesh3D[] = [
  mesh("box-1111-aaaa", "L1", top, "#ff0000"),
  mesh("box-1111-aaaa", "L1", sides, "#00ff00"),
  mesh("square-2222", "L1", square, "#888888", 7, squareUvs),
  mesh("wall-3333", "L2", wall, "#888888", 7),
];
const image = png(2, 2, (x, y) => (x === y ? [255, 255, 255] : [0, 0, 255]));
const objects: Record<string, Partial<ObjectInfo>> = {
  "box-1111-aaaa": { id: "box-1111-aaaa", name: 'Box "one"', typeName: "Extrude", className: "None", layerId: "L1" },
  "square-2222": { id: "square-2222", typeName: "Mesh", className: "Floors", layerId: "L1" },
  "wall-3333": { id: "wall-3333", typeName: "Mesh", className: "Walls", layerId: "L2" },
};
const records: Record<string, ObjectRecord[]> = {
  "box-1111-aaaa": [{ format: 1, name: "Cost data", parametric: false, fields: [{ name: "Price", kind: "number", value: 12.5 } as never, { name: "Paid?", kind: "boolean", value: true } as never, { name: "Note", kind: "text", value: "a\nb" } as never] }],
};
const doc = {
  resources: () => [{ index: 7, kind: "texture", name: "Blue Tile", folder: "", preview: null, previewMime: "", image, imageMime: "image/png", imageSize: 500 } as ResourceInfo],
  object: (id: string) => objects[id] as ObjectInfo | undefined,
  layers: () => [
    { id: "L1", name: "Ground Floor" },
    { id: "L2", name: "1st floor" },
  ],
  records: (id: string) => records[id] ?? [],
} as unknown as VwxDocument;

check(usdIdent("1st floor") === "_1st_floor" && usdIdent("Café-Bar") === "Cafe_Bar" && usdIdent("***") === "_", "names become USD identifiers");

const byLayer = usdScene(doc, meshes, { organization: "layer", combine: false, records: true, textures: true }, "Test");
const t = byLayer.text;
check(t.startsWith("#usda 1.0\n") && t.includes('upAxis = "Y"') && t.includes("metersPerUnit = 1") && t.includes('defaultPrim = "Model"'), "a usda layer, y up in metres, Model its default prim");
check(t.includes('def Xform "Ground_Floor"') && t.includes('def Xform "_1st_floor"'), "an Xform per layer");
check(/def Xform "Box_one"[\s\S]*?custom string vw:name = "Box \\"one\\""/.test(t), "the two-colour box is an Xform with its data, its name's quotes escaped");
check((t.match(/def Mesh /g) ?? []).length === 4, "four meshes: the box's two parts, the square and the triangle");
check(t.includes('custom string vw:class = "Floors"') && t.includes('custom string vw:layer = "1st floor"') && t.includes('custom string vw:uuid = "wall-3333"'), "each object's class, layer and id");
check(t.includes("custom double vw:record:Cost_data:Price = 12.5") && t.includes("custom bool vw:record:Cost_data:Paid = 1") && t.includes('custom string vw:record:Cost_data:Note = "a\\nb"'), "record values typed, as attributes");
check((t.match(/def Material /g) ?? []).length === 3 && t.includes('def Material "Color_ff0000"') && t.includes('def Material "Blue_Tile"'), "a material per colour and per texture");
check(t.includes("asset inputs:file = @textures/Blue_Tile.png@") && byLayer.files.length === 1 && byLayer.files[0][0] === "textures/Blue_Tile.png", "the texture's image as a file beside the scene");
check(t.includes("primvars:st = [(0, 0), (1, 0), (1, 1), (0, 0), (1, 1), (0, 1)]"), "the square keeps its own UV map");
// the triangle at y = 0 projects along y: x and z over 500 mm, z down the image
check(/primvars:st = \[\(8, 0\), \(10, 0\), \(10, -2\)\]/.test(t), "the triangle's image projected along its main axis at its size");
check(t.includes("point3f[] points = [(4, 0, 0), (5, 0, 0), (5, 1, 0)]"), "corners y up in metres: x, z, -y over 1000");
// the box's top faces up (y), the triangle faces -y in the drawing (z, y up)
check(/def Mesh "Color_ff0000"[\s\S]*?normals = \[\(0, 1, 0\), \(0, 1, 0\)/.test(t) && t.includes("normals = [(0, 0, 1), (0, 0, 1), (0, 0, 1)]"), "normals turned y up as the corners are");
const boxTop = /def Mesh "Color_ff0000"[\s\S]*?int\[\] faceVertexIndices = \[([^\]]*)\][\s\S]*?point3f\[\] points = \[([^\]]*)\]/.exec(t);
check(!!boxTop && boxTop[1].split(",").length === 6 && boxTop[2].split("), (").length === 4, "the box's top: two triangles on four shared corners");

const byTexture = usdScene(doc, meshes, { organization: "texture", combine: false, records: false, textures: true });
check(byTexture.text.includes('def Xform "Blue_Tile"') && !byTexture.text.includes("vw:record"), "by texture: an Xform per material, no records unless asked");
const combined = usdScene(doc, meshes, { organization: "texture", combine: true, records: false, textures: true });
check((combined.text.match(/def Mesh /g) ?? []).length === 3 && !combined.text.includes("vw:uuid"), "combined: one mesh per material, the objects' data left out");
const plain = usdScene(doc, meshes, { organization: "layer", combine: false, records: false, textures: false });
check(plain.files.length === 0 && !plain.text.includes("UsdUVTexture") && !plain.text.includes("primvars:st"), "without textures, colours only");

// the package: stored, each file's data on a 64-byte boundary
const files: [string, Uint8Array][] = [["Test.usda", new TextEncoder().encode(t)], ...byLayer.files.map(([p, d]) => [p, d] as [string, Uint8Array])];
const usdz = usdzPackage(files);
const v = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
let at = 0;
let aligned = true;
let stored = true;
let same = true;
for (const [path, data] of files) {
  const nameLen = v.getUint16(at + 26, true);
  const extra = v.getUint16(at + 28, true);
  const start = at + 30 + nameLen + extra;
  aligned &&= start % 64 === 0 && new TextDecoder().decode(usdz.subarray(at + 30, at + 30 + nameLen)) === path;
  stored &&= v.getUint16(at + 8, true) === 0 && v.getUint32(at + 18, true) === data.length && v.getUint32(at + 14, true) === crc32(data);
  same &&= usdz.subarray(start, start + data.length).every((b, i) => b === data[i]);
  at = start + data.length;
}
check(aligned && stored && same, "the .usdz stores each file whole, its data on a 64-byte boundary");
const end = usdz.length - 22;
check(v.getUint32(end, true) === 0x06054b50 && v.getUint16(end + 10, true) === 2 && v.getUint32(end + 16, true) === at, "the .usdz's directory lists both files");

const blender = process.env.BLENDER;
if (blender) {
  const dir = mkdtempSync(join(tmpdir(), "usd-check-"));
  try {
    writeFileSync(join(dir, "test.usdz"), usdz);
    writeFileSync(join(dir, "combined.usda"), combined.text);
    const script = [
      "import bpy, json, sys",
      "out = {}",
      "for f in ['test.usdz', 'combined.usda']:",
      "    bpy.ops.wm.read_factory_settings(use_empty=True)",
      `    bpy.ops.wm.usd_import(filepath='${dir}/' + f)`,
      "    ms = [o for o in bpy.data.objects if o.type == 'MESH']",
      "    imgs = [i for i in bpy.data.images if i.size[0] > 0]",
      "    out[f] = {'meshes': len(ms), 'faces': sum(len(o.data.polygons) for o in ms), 'materials': len(bpy.data.materials), 'images': len(imgs), 'size': [round(max(o.dimensions[k] for o in ms), 3) for k in range(3)], 'props': sorted(k for o in bpy.data.objects for k in o.keys() if k.startswith('vw'))[:3]}",
      "print('RESULT ' + json.dumps(out))",
    ].join("\n");
    writeFileSync(join(dir, "read.py"), script);
    const log = execFileSync(blender, ["-b", "--factory-startup", "--python", join(dir, "read.py")], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const line = log.split("\n").find((l) => l.startsWith("RESULT "));
    const r = line ? JSON.parse(line.slice(7)) : null;
    console.log("     Blender:", JSON.stringify(r));
    check(!!r && r["test.usdz"].meshes === 4 && r["test.usdz"].faces === 15 && r["test.usdz"].images === 1, "Blender reads the .usdz: four meshes, 15 faces, the image");
    check(!!r && r["test.usdz"].materials >= 3, "Blender makes the three materials");
    check(!!r && r["combined.usda"].meshes === 3 && r["combined.usda"].faces === 15, "Blender reads the combined text: three meshes, 15 faces");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
