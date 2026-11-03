// Checks the PLY reader and writer under Node. Run from web/:
//   npx tsx src/import/ply.check.ts
// The round trip keeps the faces, positions and colours, and the writer shares vertices within a piece.
// Hand-written files read as they should: ASCII with CRLF line ends, big-endian binary with double
// positions, extra properties and an extra element, a point cloud, and bad faces. With BLENDER set to
// Blender's binary, Blender imports a file this writer made, and exports PLY files (binary and ASCII,
// with and without colours) that are read back here. Blender runs headless; nothing is drawn.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPly } from "../export/ply.ts";
import type { Model3D } from "../export/scene3d.ts";
import type { MeshFile } from "./mesh.ts";
import { parsePly } from "./ply.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= tol;
const nearList = (a: number[], b: number[], tol = 1e-4): boolean => a.length === b.length && a.every((v, k) => near(v, b[k], tol));

/** Whether `f` throws an Error whose message has `text`. */
function throwsWith(f: () => unknown, text: string): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes(text);
  }
}

/** Every face of a parsed file, in part order. */
const facesOf = (file: MeshFile): number[][] => file.parts.flatMap((p) => p.faces);

/** Corners in millimetres to a hundredth, as a string to compare by. */
const keyOf = (f: ArrayLike<number>): string => Array.from(f, (v) => Math.round(v * 100)).join(" ");

/** The keys of a piece's triangles. */
function triangleKeys(t: Float32Array): string[] {
  const out: string[] = [];
  for (let i = 0; i + 9 <= t.length; i += 9) out.push(keyOf(t.subarray(i, i + 9)));
  return out;
}

/** The lowest and highest corner on each axis of some faces. */
function boundsOf(faces: number[][]): [number[], number[]] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) {
    for (let i = 0; i < f.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], f[i + k]);
        hi[k] = Math.max(hi[k], f[i + k]);
      }
    }
  }
  return [lo, hi];
}

/** A cube of side `s` at (x0, y0, z0) as 12 triangles of nine floats. */
function cube(x0: number, y0: number, z0: number, s: number): number[] {
  const c = (i: number): number[] => [x0 + (i & 1) * s, y0 + ((i >> 1) & 1) * s, z0 + ((i >> 2) & 1) * s];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const out: number[] = [];
  for (const [a, b, d, e] of quads) {
    for (const [p, q, r] of [
      [a, b, d],
      [a, d, e],
    ]) {
      out.push(...c(p), ...c(q), ...c(r));
    }
  }
  return out;
}

/** Two pieces in mm: a red square of two triangles sharing an edge, and a green triangle. */
function twoColours(): Model3D {
  const red = [0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 0, 0, 1000, 1000, 0, 0, 1000, 0];
  const green = [2000, 0, 500, 3000, 0, 500, 2000, 1000, 500];
  return {
    layers: [
      {
        id: "L1",
        name: "Design Layer-1",
        elevation: 0,
        objects: [
          { id: "A", name: "Square", className: "None", pieces: [{ color: "#ff0000", opacity: 1, triangles: new Float32Array(red) }] },
          { id: "B", name: "Tri", className: "None", pieces: [{ color: "#00ff00", opacity: 1, triangles: new Float32Array(green) }] },
        ],
      },
    ],
  };
}

/** A big-endian binary file: double positions, float normals and quality, a face flag, and an extra element. */
function bigEndianFile(): Uint8Array {
  const head = new TextEncoder().encode(
    [
      "ply",
      "format binary_big_endian 1.0",
      "comment double positions",
      "obj_info made by hand",
      "element vertex 4",
      "property float nx",
      "property double x",
      "property float ny",
      "property double y",
      "property float nz",
      "property double z",
      "property float quality",
      "element face 2",
      "property uchar flags",
      "property list uchar uint vertex_indices",
      "element material 2",
      "property float opacity",
      "property list uchar float weights",
      "end_header",
      "",
    ].join("\r\n"),
  );
  // 160 bytes of vertices, 32 of faces, 34 of material
  const out = new Uint8Array(head.length + 226);
  out.set(head);
  const dv = new DataView(out.buffer);
  let at = head.length;
  const f32 = (v: number): void => {
    dv.setFloat32(at, v, false);
    at += 4;
  };
  const f64 = (v: number): void => {
    dv.setFloat64(at, v, false);
    at += 8;
  };
  const u8 = (v: number): void => {
    dv.setUint8(at, v);
    at += 1;
  };
  const u32 = (v: number): void => {
    dv.setUint32(at, v, false);
    at += 4;
  };
  const verts = [
    [0.5, 1.25, -2],
    [3, 1.25, -2],
    [3, 4, -2],
    [0.5, 4, 2],
  ];
  verts.forEach(([x, y, z], i) => {
    f32(0);
    f64(x);
    f32(1);
    f64(y);
    f32(0);
    f64(z);
    f32(0.25 * (i + 1));
  });
  u8(7);
  u8(4);
  [0, 1, 2, 3].forEach(u32);
  u8(0);
  u8(3);
  [0, 2, 3].forEach(u32);
  for (const o of [0.5, 1]) {
    f32(o);
    u8(3);
    f32(0.25);
    f32(0.5);
    f32(0.25);
  }
  return out;
}

// ---- the round trip and hand-written files --------------------------------------

const model = twoColours();
const bytes = exportPly(model);
const headText = new TextDecoder().decode(bytes.subarray(0, 240));
check(
  headText.startsWith("ply\nformat binary_little_endian 1.0\ncomment Rodeo 3D model, metres, z up\nelement vertex 7\n"),
  "round trip: binary little endian header, seven vertices (shared within a piece)",
);
const back = parsePly(bytes, "square");
const modelKeys = model.layers.flatMap((l) => l.objects.flatMap((o) => o.pieces.flatMap((p) => triangleKeys(p.triangles))));
check(
  // the file is in metres; the model is in mm
  JSON.stringify(facesOf(back).map((f) => keyOf(f.map((v) => v * 1000))).sort()) === JSON.stringify(modelKeys.sort()),
  "round trip: the faces' positions come back as the model's mm, to a hundredth",
);
check(
  JSON.stringify(back.parts.map((p) => [p.name, p.faces.length, p.color && [p.color.r, p.color.g, p.color.b]])) ===
    JSON.stringify([
      ["square 1", 2, [1, 0, 0]],
      ["square 2", 1, [0, 1, 0]],
    ]),
  "round trip: two colour parts, red then green, with their face counts and colours",
);
check(back.parts.every((p) => p.faces.every((f) => f.length >= 9)), "round trip: every face has three or more corners");

const none = parsePly(exportPly({ layers: [] }), "none");
check(none.parts.length === 0 && Object.keys(none.skipped).length === 0, "an empty model reads as nothing");

const asciiText = [
  "ply",
  "format ascii 1.0",
  "comment hand written",
  "element vertex 8",
  "property float x",
  "property float y",
  "property float z",
  "property uchar red",
  "property uchar green",
  "property uchar blue",
  "element face 2",
  "property list uchar int vertex_index",
  "end_header",
  "0 0 0 255 0 0",
  "1 0 0 255 0 0",
  "1 1 0 255 0 0",
  "0 1 0 255 0 0",
  "0 0 1 0 0 255",
  "1 0 1 0 0 255",
  "1 1 1 0 0 255",
  "0 1 1 0 0 255",
  "4 0 1 2 3",
  "4 4 5 6 7",
  "",
].join("\r\n");
const hand = parsePly(new TextEncoder().encode(asciiText), "hand");
check(
  hand.parts.length === 2 && hand.parts[0].name === "hand 1" && hand.parts[1].name === "hand 2",
  "ASCII with CRLF line ends and vertex_index: two colour parts, one quad each",
);
check(hand.parts.every((p) => p.faces.length === 1 && p.faces[0].length === 12), "ASCII: each quad keeps its four corners");
check(
  JSON.stringify(hand.parts[1].faces[0]) === JSON.stringify([0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]) &&
    hand.parts[1].color?.b === 1 &&
    hand.parts[0].color?.r === 1,
  "ASCII: the blue quad's corners and colour, and the red quad's colour, read",
);

const be = parsePly(bigEndianFile(), "bigend");
check(be.parts.length === 1 && be.parts[0].name === "bigend" && be.parts[0].color === undefined, "big endian binary: one part, no colour");
check(
  JSON.stringify(facesOf(be)) === JSON.stringify([
    [0.5, 1.25, -2, 3, 1.25, -2, 3, 4, -2, 0.5, 4, 2],
    [0.5, 1.25, -2, 3, 4, -2, 0.5, 4, 2],
  ]),
  "big endian binary: double positions, a quad and a triangle; extra properties skipped",
);
check(JSON.stringify(be.skipped) === '{"material":2}', "big endian binary: the extra element is counted as two materials");

const cloud = parsePly(
  new TextEncoder().encode(
    [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "end_header",
      "0 0 0 255 0 0",
      "1 0 0 0 255 0",
      "0 1 0 0 0 255",
      "",
    ].join("\n"),
  ),
  "cloud",
);
check(cloud.parts.length === 0 && JSON.stringify(cloud.skipped) === '{"point":3}', "a point cloud imports nothing and is counted as points");

const bad = parsePly(
  new TextEncoder().encode(
    [
      "ply",
      "format ascii 1.0",
      "element vertex 3",
      "property float x",
      "property float y",
      "property float z",
      "element face 3",
      "property list uchar int vertex_indices",
      "end_header",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "3 0 1 2",
      "3 0 1 9",
      "3 1 1 2",
      "",
    ].join("\n"),
  ),
  "bad",
);
check(
  bad.parts.length === 1 && bad.parts[0].faces.length === 1 && JSON.stringify(bad.skipped) === '{"bad face":2}',
  "a face with a missing vertex or a repeated corner is left out as a bad face",
);

check(throwsWith(() => parsePly(new TextEncoder().encode("solid cube\nendsolid\n"), "x"), "it isn't a PLY file"), "a file that is not PLY throws");
check(
  throwsWith(() => parsePly(new TextEncoder().encode("ply\nformat ascii 2.0\nend_header\n"), "x"), "only 1.0 is read"),
  "a PLY version other than 1.0 throws",
);
check(
  throwsWith(() => parsePly(bytes.subarray(0, bytes.length - 5), "cut"), "it ends before all its values"),
  "a binary file cut short throws",
);

// ---- Blender -----------------------------------------------------------------------

/** What Blender's import reports for an object: its vertices, its polygons, world bounds and colour attributes. */
interface BlenderObject {
  name: string;
  vertices: number;
  polygons: { vertices: number[]; loop_start: number; loop_total: number }[];
  bbox: [number[], number[]];
  colours: { name: string; domain: string; type: string; values: number[][] }[];
}

interface BlenderImport {
  blender: string;
  objects: BlenderObject[];
}

/** Imports a PLY file in Blender and writes what it made to JSON. */
const IMPORT_PY = `
import bpy, json, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
rna = bpy.ops.wm.ply_import.get_rna_type().properties
kw = {"filepath": src}
if "import_colors" in rna:
    kw["import_colors"] = rna["import_colors"].default
bpy.ops.wm.ply_import(**kw)
result = {"blender": bpy.app.version_string, "colour_mode": kw.get("import_colors", ""), "objects": []}
for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    world = [ob.matrix_world @ v.co for v in me.vertices]
    lo = [min(p[k] for p in world) for k in range(3)]
    hi = [max(p[k] for p in world) for k in range(3)]
    colours = [{"name": a.name, "domain": a.domain, "type": a.data_type, "values": [list(d.color) for d in a.data]} for a in me.color_attributes]
    result["objects"].append({
        "name": ob.name,
        "vertices": len(me.vertices),
        "polygons": [{"vertices": list(p.vertices), "loop_start": p.loop_start, "loop_total": p.loop_total} for p in me.polygons],
        "bbox": [lo, hi],
        "colours": colours,
    })
with open(out, "w") as f:
    json.dump(result, f)
`;

/** Makes a cube and a sphere (only the sphere with a colour attribute) and exports them four ways, then writes the expected bounds. */
const EXPORT_PY = `
import bpy, json, sys

argv = sys.argv[sys.argv.index("--") + 1:]
folder = argv[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(3, 0, 0), segments=32, ring_count=16)
sphere = bpy.context.active_object
attr = sphere.data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
for d in attr.data:
    d.color = (0.2, 0.4, 0.8, 1.0)
props = list(bpy.ops.wm.ply_export.get_rna_type().properties.keys())
colour_prop = bpy.ops.wm.ply_export.get_rna_type().properties["export_colors"]
enum_ids = [i.identifier for i in colour_prop.enum_items]
polys = 0
lo = [1e9, 1e9, 1e9]
hi = [-1e9, -1e9, -1e9]
for ob in (cube, sphere):
    polys += len(ob.data.polygons)
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        for k in range(3):
            lo[k] = min(lo[k], p[k])
            hi[k] = max(hi[k], p[k])
# export_colors is an enum: its default (sRGB) for the coloured files, NONE for the plain ones
variants = {
    "binary_colour": ("binary_colour.ply", False, colour_prop.default),
    "binary_plain": ("binary_plain.ply", False, "NONE"),
    "ascii_colour": ("ascii_colour.ply", True, colour_prop.default),
    "ascii_plain": ("ascii_plain.ply", True, "NONE"),
}
result = {"blender": bpy.app.version_string, "props": props, "colour_modes": enum_ids, "polygons": polys, "bbox": [lo, hi], "files": {}}
for key, (name, ascii_format, colours) in variants.items():
    kw = {"filepath": folder + "/" + name}
    if "ascii_format" in props:
        kw["ascii_format"] = ascii_format
    kw["export_colors"] = colours
    bpy.ops.wm.ply_export(**kw)
    result["files"][key] = name
with open(folder + "/export.json", "w") as f:
    json.dump(result, f)
`;

/** Runs Blender headless on a script written into `dir`, with `args` after its `--`; returns its output. */
function runBlender(blender: string, dir: string, name: string, script: string, args: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, script);
  const run = spawnSync(blender, ["--background", "--factory-startup", "--python", path, "--", ...args], {
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 64 << 20,
  });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}

/** The model Blender imports: a cube of 2 m in one colour and a triangle in another, in mm. */
function imported(): Model3D {
  return {
    layers: [
      {
        id: "L1",
        name: "",
        elevation: 0,
        objects: [
          { id: "C", name: "Cube", className: "None", pieces: [{ color: "#cc6633", opacity: 1, triangles: new Float32Array(cube(0, 0, 0, 2000)) }] },
          {
            id: "T",
            name: "Tri",
            className: "None",
            pieces: [{ color: "#3366cc", opacity: 1, triangles: new Float32Array([3000, 0, 0, 4000, 0, 0, 3000, 1000, 0]) }],
          },
        ],
      },
    ],
  };
}

/** Whether Blender wrote `path`; when it did not, a failed check with the end of Blender's log. */
function wrote(path: string, log: string): boolean {
  if (existsSync(path)) return true;
  console.log(`FAIL Blender wrote no ${path}; its log ends:\n${log.slice(-900)}`);
  failures++;
  return false;
}

/** The sRGB encoding of a linear 0..1 channel: Blender writes its colours that way in PLY. */
const srgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** The linear light of an sRGB 0..1 channel: how Blender stores a colour it imports. */
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Runs the Blender import and export checks, with the scratch files in a temporary folder that is removed after. */
function blenderChecks(blender: string): void {
  const dir = mkdtempSync(join(tmpdir(), "rodeo-ply-"));
  try {
    // (a) Blender imports a file this writer made: 11 vertices, 13 faces, 0..4 × 0..2 × 0..2 m, colours kept
    const src = join(dir, "rodeo.ply");
    writeFileSync(src, exportPly(imported()));
    const importJson = join(dir, "import.json");
    const importLog = runBlender(blender, dir, "import.py", IMPORT_PY, [src, importJson]);
    if (wrote(importJson, importLog)) {
      const got = JSON.parse(readFileSync(importJson, "utf8")) as BlenderImport;
      console.log(`     Blender ${got.blender}`);
      check(got.objects.length === 1, "Blender imports the file as one mesh object");
      const ob = got.objects[0];
      check(ob !== undefined && ob.vertices === 11 && ob.polygons.length === 13, "Blender's import: 11 vertices and 13 faces");
      check(
        ob !== undefined && nearList(ob.bbox[0], [0, 0, 0]) && nearList(ob.bbox[1], [4, 2, 2]),
        "Blender's import: bounds 0 to 4 by 0 to 2 by 0 to 2 m",
      );
      const attr = ob?.colours[0];
      check(attr !== undefined && ob.colours.length === 1, "Blender's import: one colour attribute");
      if (attr && ob) {
        const colourOf = (p: BlenderObject["polygons"][number]): number[] =>
          attr.values[attr.domain === "POINT" ? p.vertices[0] : p.loop_start];
        // the file's bytes are sRGB; Blender keeps its colour attribute in linear light
        const cubeColour = [linear(0.8), linear(0.4), linear(0.2)];
        const triColour = [linear(0.2), linear(0.4), linear(0.8)];
        const cubeFaces = ob.polygons.filter((p) => nearList(colourOf(p).slice(0, 3), cubeColour)).length;
        const triFaces = ob.polygons.filter((p) => nearList(colourOf(p).slice(0, 3), triColour)).length;
        console.log(`     colour attribute ${attr.name}, ${attr.domain}, ${attr.type}; first face colour ${JSON.stringify(colourOf(ob.polygons[0]))}`);
        check(cubeFaces === 12 && triFaces === 1, "Blender's import: 12 cube faces and 1 triangle, each in its colour");
      }
    }

    // (b) Blender exports a cube and a sphere, binary and ASCII, with and without colours; each is read back
    const exportJson = join(dir, "export.json");
    const exportLog = runBlender(blender, dir, "export.py", EXPORT_PY, [dir]);
    if (wrote(exportJson, exportLog)) {
      const exp = JSON.parse(readFileSync(exportJson, "utf8")) as {
        blender: string;
        colour_modes: string[];
        polygons: number;
        bbox: [number[], number[]];
        files: Record<string, string>;
      };
      console.log(`     Blender ${exp.blender}; export_colors modes ${exp.colour_modes.join(", ")}`);
      // the sphere's colour is set in linear light; Blender writes it as sRGB bytes, and the cube (no colour) as black
      const sphere = [srgb(0.2), srgb(0.4), srgb(0.8)];
      for (const [key, file] of Object.entries(exp.files)) {
        const data = readFileSync(join(dir, file));
        const f = parsePly(data, key);
        const head = new TextDecoder().decode(data.subarray(0, 300));
        const coloured = key.endsWith("colour");
        check(facesOf(f).length === exp.polygons, `Blender ${key}: ${exp.polygons} faces read back (${facesOf(f).length})`);
        const [lo, hi] = boundsOf(facesOf(f));
        check(nearList(lo, exp.bbox[0]) && nearList(hi, exp.bbox[1]), `Blender ${key}: bounds match Blender's`);
        const ascii = key.startsWith("ascii");
        check(
          head.includes(ascii ? "format ascii 1.0" : "format binary_little_endian 1.0") && head.includes("property uchar red") === coloured,
          `Blender ${key}: ${ascii ? "ASCII" : "binary"} with ${coloured ? "" : "no "}colours`,
        );
        // the colours are written as bytes, so within one step of 1/255
        const sphereParts = f.parts.filter((p) => p.color && nearList([p.color.r, p.color.g, p.color.b], sphere, 1 / 255) && p.faces.length === 512);
        check(
          coloured ? sphereParts.length === 1 && f.parts.length === 2 : f.parts.length === 1 && f.parts[0].color === undefined,
          coloured
            ? `Blender ${key}: the sphere's 512 faces read back in its sRGB colour, the cube's 6 apart`
            : `Blender ${key}: one part, no colour`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const blender = process.env.BLENDER;
if (blender) blenderChecks(blender);
else console.log("skipped: BLENDER is not set, so Blender's import and export are not run");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
