// Checks the Collada reader and writer, and the KMZ reader, under Node. Run from web/:
//   npx tsx src/import/collada.check.ts
// Round trip: a hand-built model (two layers, objects, two colours and a see-through one, a name with
// markup characters) is written by exportCollada and read by parseCollada: parts, names, colours,
// groups, frame and positions. A hand-written SketchUp-style file (Z up, inches, a component instanced
// by instance_node under transformed nodes, a polylist of quads with normals and texture coordinates,
// a lines element) is read and its world coordinates checked, and again as X up. A KMZ built with
// zipFiles is read through its doc.kml, and without one. With BLENDER set to the Blender binary,
// Blender imports the exported file and reports its objects (count, world bounds in metres, material
// colours), which must match the reader; and Blender builds a scene, exports it with
// bpy.ops.wm.collada_export, and the reader's face counts and bounds must match Blender's.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCollada } from "../export/collada.ts";
import type { Model3D } from "../export/scene3d.ts";
import { zipFiles } from "../export/zip.ts";
import { parseCollada, parseKmz } from "./collada.ts";
import { unfoldTree, type MeshFile, type MeshPart } from "./mesh.ts";
import { checkSymbolTrip, SYMBOL_MODEL } from "./symbols.fixture.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The lowest and highest corner of a part's faces (flat x, y, z triples). */
function bounds(faces: number[][]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) {
    for (let i = 0; i < f.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], f[i + k]);
        max[k] = Math.max(max[k], f[i + k]);
      }
    }
  }
  return { min, max };
}

/** Two lists of numbers equal to a part in a million. */
function sameNumbers(a: readonly number[], b: readonly number[], tol = 1e-6): boolean {
  return a.length === b.length && a.every((v, k) => near(v, b[k], tol));
}

/** Whether a bounds matches the given lowest and highest corners. */
function boxNear(b: { min: number[]; max: number[] }, min: number[], max: number[], tol = 1e-3): boolean {
  return min.every((v, i) => near(b.min[i], v, tol)) && max.every((v, i) => near(b.max[i], v, tol));
}

/** "#rrggbb" as three 0..1 channels. */
function rgbOf(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Whether a part's colour is the given "#rrggbb", to half a percent. */
function isColour(color: { r: number; g: number; b: number } | undefined, hex: string, tol = 0.005): boolean {
  if (!color) return false;
  const want = rgbOf(hex);
  return near(color.r, want[0], tol) && near(color.g, want[1], tol) && near(color.b, want[2], tol);
}

/** The twelve triangles of an axis-aligned box, counter-clockwise seen from outside, as a piece's triangles. */
function boxTriangles(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
  const at = (b: number[]): number[] => [b[0] ? x1 : x0, b[1] ? y1 : y0, b[2] ? z1 : z0];
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) {
    for (const t of [[a, b, c], [a, c, d]]) for (const p of t) out.push(...at(p));
  }
  return new Float32Array(out);
}

/** Whether a part's faces are exactly a piece's triangles, in order, to a hundredth of a millimetre. */
function sameTriangles(faces: number[][], tris: Float32Array): boolean {
  if (faces.length !== tris.length / 9) return false;
  return faces.every((f, i) => f.length === 9 && f.every((v, k) => near(v, tris[9 * i + k], 0.01)));
}

/** The SketchUp-style test file: a box of 2 × 1 × 3 inches as a component, with quads, normals, texture coordinates and a line. */
function sketchUp(up: string): string {
  // the box's corners, index = x + 2y + 4z, and its six quads with their normals
  const pos = Array.from({ length: 8 }, (_, i) => [i & 1 ? 2 : 0, i & 2 ? 1 : 0, i & 4 ? 3 : 0]);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const normals = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]];
  const p = quads.flatMap((q, f) => q.flatMap((v, k) => [v, f, k])).join(" ");
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><unit meter="0.0254" name="inch"/><up_axis>${up}</up_axis></asset>
<library_effects><effect id="red-fx"><profile_COMMON><technique sid="common"><phong>
<diffuse><color>0.8 0.1 0.1 1</color></diffuse></phong></technique></profile_COMMON></effect></library_effects>
<library_materials><material id="red" name="Red"><instance_effect url="#red-fx"/></material></library_materials>
<library_geometries><geometry id="box" name="BoxMesh"><mesh>
<source id="pos"><float_array id="pos-array" count="24">${pos.map((v) => v.join(" ")).join(" ")}</float_array>
<technique_common>
<accessor source="#pos-array" count="8" stride="3">
<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="nrm"><float_array id="nrm-array" count="18">${normals.map((v) => v.join(" ")).join(" ")}</float_array>
<technique_common>
<accessor source="#nrm-array" count="6" stride="3">
<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<source id="uv"><float_array id="uv-array" count="8">0 0 1 0 1 1 0 1</float_array>
<technique_common>
<accessor source="#uv-array" count="4" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common></source>
<vertices id="verts"><input semantic="POSITION" source="#pos"/></vertices>
<lines count="1" material="Red"><input semantic="VERTEX" source="#verts" offset="0"/><p>0 1</p></lines>
<polylist material="Red" count="6">
<input semantic="VERTEX" source="#verts" offset="0"/>
<input semantic="NORMAL" source="#nrm" offset="1"/>
<input semantic="TEXCOORD" source="#uv" offset="2" set="0"/>
<vcount>4 4 4 4 4 4</vcount><p>${p}</p></polylist>
</mesh></geometry></library_geometries>
<library_nodes><node id="brick" name="Brick"><instance_geometry url="#box"><bind_material><technique_common>
<instance_material symbol="Red" target="#red"/></technique_common></bind_material></instance_geometry></node></library_nodes>
<library_visual_scenes><visual_scene id="Scene">
<node id="top" name="SketchUp">
<node id="a" name="Brick A"><matrix>1 0 0 10 0 1 0 0 0 0 1 0 0 0 0 1</matrix><instance_node url="#brick"/></node>
<node id="b" name="Brick B"><matrix>0 -1 0 30 1 0 0 0 0 0 1 0 0 0 0 1</matrix><instance_node url="#brick"/></node>
<node id="wall" name="Wall"><translate>0 0 10</translate>
<node id="c" name="Brick C"><scale>2 1 1</scale><translate>5 5 0</translate><instance_node url="#brick"/></node>
</node>
</node>
</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#Scene"/></scene>
</COLLADA>
`;
}

// ---- round trip ------------------------------------------------------------------------

console.log("round trip");
const model: Model3D = {
  layers: [
    {
      id: "L1",
      name: "Ground",
      elevation: 0,
      objects: [
        { id: "O1", name: "Slab", className: "Walls", pieces: [{ color: "#ff0000", opacity: 1, triangles: boxTriangles(0, 0, 0, 4000, 3000, 200) }] },
        {
          id: "O2",
          name: "Column",
          className: "None",
          pieces: [
            { color: "#0000ff", opacity: 1, triangles: boxTriangles(5000, 0, 0, 5200, 200, 3000) },
            // a gap between the pieces: Blender merges the coincident faces of touching boxes on import
            { color: "#00ff00", opacity: 0.5, triangles: boxTriangles(5300, 0, 0, 5500, 200, 3000) },
          ],
        },
      ],
    },
    {
      id: "L2",
      name: "Level 2",
      elevation: 3000,
      objects: [
        {
          id: "O3",
          name: 'Beam & "Cap" <x>',
          className: "None",
          pieces: [{ color: "#ff0000", opacity: 1, triangles: boxTriangles(0, 0, 3000, 4000, 300, 3300) }],
        },
      ],
    },
  ],
};
const xml = exportCollada(model, new Date("2026-11-01T09:00:00Z"));
check(xml.includes('<unit meter="1" name="meter"/>') && xml.includes("<up_axis>Z_UP</up_axis>"), "writer: metres, z up");
const rt = parseCollada(xml);
check(rt.frame !== undefined && near(rt.frame.mm, 1000, 1e-9) && rt.frame.yUp === false, "round trip: frame is 1000 mm per unit (metres), z up");
check(rt.parts.length === 4, `round trip: four parts (${rt.parts.length})`);
const find = (name: string, hex: string): MeshPart | undefined => rt.parts.find((p) => p.name === name && isColour(p.color, hex));
const slab = find("Slab", "#ff0000");
const column = find("Column", "#0000ff");
const sheer = find("Column", "#00ff00");
const beam = find("Beam & \"Cap\" <x>", "#ff0000");
// the file is in metres; back to the drawing's millimetres for comparing with the model
const toMm = (faces: number[][]): number[][] => faces.map((f) => f.map((v) => v * (rt.frame?.mm ?? 1)));
check(!!slab && !!column && !!sheer && !!beam, "round trip: names and colours read back, markup characters kept");
check(!!slab && sameTriangles(toMm(slab.faces), boxTriangles(0, 0, 0, 4000, 3000, 200)), "round trip: Slab's positions");
check(!!column && sameTriangles(toMm(column.faces), boxTriangles(5000, 0, 0, 5200, 200, 3000)), "round trip: Column's blue piece positions");
check(!!sheer && sameTriangles(toMm(sheer.faces), boxTriangles(5300, 0, 0, 5500, 200, 3000)), "round trip: Column's green piece positions");
check(!!beam && sameTriangles(toMm(beam.faces), boxTriangles(0, 0, 3000, 4000, 300, 3300)), "round trip: Beam's positions at level 2");
check(!!slab && slab.group === "Ground" && !!beam && beam.group === "Level 2", "round trip: groups are the layers");
check(rt.parts.reduce((n, p) => n + p.faces.length, 0) === 48, "round trip: 48 faces in all");

// the objects in groups: their own nodes, named, inside a node named after each group
const grouped: Model3D = {
  layers: [
    {
      id: "L1",
      name: "Ground",
      elevation: 0,
      objects: [
        { id: "A", name: "Sink", className: "None", groups: [{ id: "G", name: "Kitchen" }], pieces: [{ color: "#ff0000", opacity: 1, triangles: boxTriangles(0, 0, 0, 600, 600, 900) }] },
        { id: "T", name: "Table", className: "None", pieces: [{ color: "#00ff00", opacity: 1, triangles: boxTriangles(2000, 0, 0, 3000, 900, 750) }] },
        { id: "B", name: "Hob", className: "None", groups: [{ id: "G", name: "Kitchen" }, { id: "C", name: "Cooking" }], pieces: [{ color: "#0000ff", opacity: 1, triangles: boxTriangles(700, 0, 0, 1300, 600, 900) }] },
      ],
    },
  ],
};
const gx = exportCollada(grouped, new Date("2026-11-01T09:00:00Z"));
check(
  /<node id="layer1" name="Ground"><node id="node\d+" name="Kitchen"><node id="node\d+" name="Sink">.*?<\/node><node id="node\d+" name="Cooking"><node id="node\d+" name="Hob">.*?<\/node><\/node><\/node><node id="node\d+" name="Table">/.test(gx),
  "groups: Sink and a Cooking node holding Hob in a Kitchen node, in the layer's node before Table",
);
const gb = parseCollada(gx);
check(
  ["Sink", "Hob", "Table"].every((n) => gb.parts.some((p) => p.name === n)) && new Set(gx.match(/id="node\d+"/g)).size === gx.match(/id="node\d+"/g)!.length,
  "groups: each member reads back by its own name, node ids unique",
);
check(!!gb.parts.find((p) => p.name === "Hob") && sameTriangles(toMm(gb.parts.find((p) => p.name === "Hob")!.faces), boxTriangles(700, 0, 0, 1300, 600, 900)), "groups: Hob's positions");

// ---- symbols -------------------------------------------------------------------------------

console.log("symbols");
const symbolDae = exportCollada(SYMBOL_MODEL, new Date("2026-11-03T10:00:00Z"));
check(
  (symbolDae.match(/<node id="symbol\d+"/g) ?? []).length === 2 && (symbolDae.match(/<instance_node url="#symbol2"\/>/g) ?? []).length === 2,
  "symbols: each definition a node in library_nodes once, the Chair instanced twice",
);
checkSymbolTrip("Collada", parseCollada(symbolDae), check);

// ---- SketchUp-style file ------------------------------------------------------------------

console.log("SketchUp-style file");
const sk = parseCollada(sketchUp("Z_UP"));
check(sk.frame !== undefined && near(sk.frame.mm, 25.4, 1e-9) && sk.frame.yUp === false, "SketchUp: inches (25.4 mm), z up");
check(!!sk.tree && sk.parts.length === 0, "SketchUp: instance_node makes a tree");
const brick = sk.tree?.symbols ?? [];
check(brick.length === 1 && brick[0].name === "Brick", `SketchUp: one symbol, named after the node instanced (${brick.map((b) => b.name)})`);
const brickParts = brick[0]?.content.parts ?? [];
check(brickParts.length === 1 && brickParts[0].faces.length === 6 && brickParts[0].faces.every((f) => f.length === 12), "SketchUp: the symbol holds the box once, six quads");
check(!!brickParts[0] && boxNear(bounds(brickParts[0].faces), [0, 0, 0], [2, 1, 3]), "SketchUp: the symbol's box in its own frame");
check(!!brickParts[0] && isColour(brickParts[0].color, "#cc1a1a", 0.01), "SketchUp: colour from the phong diffuse");
check((sk.skipped.line ?? 0) === 1, "SketchUp: the line is left out and counted once");
const skTop = sk.tree?.top;
const skPlaced = [...(skTop?.instances ?? []), ...(skTop?.groups ?? []).flatMap((g) => g.instances.map((i) => ({ ...i, group: g.name })))];
const placedAs = (name: string): ((typeof skPlaced)[number] & { group?: string }) | undefined => skPlaced.find((i) => i.name === name);
const [brickA, brickB, brickC] = ["Brick A", "Brick B", "Brick C"].map(placedAs);
check(!!brickA && !!brickB && !!brickC && [brickA, brickB, brickC].every((i) => i?.symbol === 0), "SketchUp: three instances of the one symbol, named after their nodes");
check(!!brickA && sameNumbers(brickA.matrix, [1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0]), "SketchUp: Brick A moved 10 in along x");
check(!!brickB && sameNumbers(brickB.matrix, [0, 1, 0, -1, 0, 0, 0, 0, 1, 30, 0, 0]), "SketchUp: Brick B turned a quarter and moved");
check(!!brickC && sameNumbers(brickC.matrix, [2, 0, 0, 0, 1, 0, 0, 0, 1, 10, 5, 10]), "SketchUp: Brick C scaled, moved and lifted under Wall");
check(
  !!brickA && brickA.group === undefined && !!brickB && brickB.group === undefined && brickC?.group === "Wall",
  "SketchUp: a node under the top node that places one component is that instance, not a group of it; Wall is a group",
);
const skFlat = sk.tree ? unfoldTree(sk.tree) : [];
check(
  skFlat.length === 3 && skFlat.some((p) => p.group === "Wall" && boxNear(bounds(p.faces), [10, 5, 10], [14, 6, 13])),
  "SketchUp: unfolded, Brick C's box lands where the flat reader put it",
);

const up = parseCollada(sketchUp("X_UP"));
const upBrick = up.tree?.symbols[0]?.content.parts[0];
const upA = up.tree?.top.instances.find((i) => i.name === "Brick A");
check(up.frame !== undefined && up.frame.yUp === false, "X up: a tree is turned to z up");
check(
  !!upBrick && !!upA && boxNear(bounds(unfoldTree({ symbols: up.tree!.symbols, top: { parts: [], groups: [], instances: [upA] } })[0].faces), [0, -1, 10], [3, 0, 12]),
  "X up: Brick A turned to z up (x to z, y to x, z to -y)",
);

// ---- KMZ -----------------------------------------------------------------------------------

console.log("KMZ");
const kml =
  `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Brick</name>` +
  `<Model><Link><href>models/sketchup.dae</href></Link></Model></Placemark></kml>`;
// a decoy .dae comes first in the archive, so reading the first would give the wrong model
const kmz = parseKmz(
  zipFiles([
    ["models/decoy.dae", enc(xml)],
    ["models/sketchup.dae", enc(sketchUp("Z_UP"))],
    ["doc.kml", enc(kml)],
  ]),
);
check(kmz.tree?.top.instances.some((i) => i.name === "Brick A") === true, "KMZ: the model its doc.kml links to, not the first .dae");
const kmzFallback = parseKmz(zipFiles([["models/decoy.dae", enc(xml)], ["models/sketchup.dae", enc(sketchUp("Z_UP"))]]));
check(kmzFallback.parts.length === 4, "KMZ without a doc.kml: the first .dae");
let kmzNone = "";
try {
  parseKmz(zipFiles([["doc.kml", enc(kml)]]));
} catch (e) {
  kmzNone = (e as Error).message;
}
check(kmzNone === "it has no Collada model", "KMZ with no model: says so");

let notCollada = "";
try {
  parseCollada("<kml/>");
} catch (e) {
  notCollada = (e as Error).message;
}
check(notCollada === "it isn't a Collada file", "a non-Collada root is refused");
let notXml = "";
try {
  parseCollada("<COLLADA>");
} catch (e) {
  notXml = (e as Error).message;
}
check(notXml === "it isn't an XML file", "unclosed markup is refused");

// ---- Blender scripts ----------------------------------------------------------------------

/** Imports the file given after -- with Blender's default options, and prints each mesh object's world bounds, faces and material colours. */
const IMPORT_PY = `
import bpy, json, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.collada_import(filepath=argv[0])
bpy.context.view_layer.update()
objects = []
for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    me.calc_loop_triangles()
    pts = [ob.matrix_world @ v.co for v in me.vertices]
    colours = []
    for slot in ob.material_slots:
        m = slot.material
        c = None
        if m is not None:
            if m.use_nodes:
                bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf is not None:
                    c = list(bsdf.inputs["Base Color"].default_value)[:3]
            if c is None:
                c = list(m.diffuse_color)[:3]
        colours.append(c)
    objects.append({
        "name": ob.name,
        "min": [min(p[i] for p in pts) for i in range(3)],
        "max": [max(p[i] for p in pts) for i in range(3)],
        "colours": colours,
        "faces": len(me.loop_triangles),
    })
print("JSON " + json.dumps({"objects": objects}))
`;

/** Imports a Collada file and prints each mesh object's bounds through the transforms Blender read, its parent inverses left out. */
const PLACED_PY = `
import bpy, json, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.collada_import(filepath=argv[0])
def placed(ob):
    return placed(ob.parent) @ ob.matrix_basis if ob.parent else ob.matrix_basis
objects = []
for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    me.calc_loop_triangles()
    m = placed(ob)
    pts = [m @ v.co for v in me.vertices]
    objects.append({"name": ob.name, "faces": len(me.loop_triangles),
                    "min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)]})
print("JSON " + json.dumps({"objects": objects}))
`;

/** Builds a rotated, scaled cube under a moved empty and a sphere with two materials, exports it, and prints what Blender holds. */
const BUILD_PY = `
import bpy, json, math, sys
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "Cube"
cube.rotation_euler = (0, 0, math.radians(30))
cube.scale = (1, 2, 0.5)
holder = bpy.data.objects.new("Holder", None)
bpy.context.collection.objects.link(holder)
holder.location = (5, -3, 1)
cube.parent = holder
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(-2, 0, 0))
sphere = bpy.context.active_object
sphere.name = "Sphere"
for name, rgb in (("Red", (1, 0, 0)), ("Green", (0, 1, 0))):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (rgb[0], rgb[1], rgb[2], 1)
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1)
    sphere.data.materials.append(mat)
for poly in sphere.data.polygons:
    poly.material_index = 1 if poly.center.z > 0 else 0
bpy.ops.wm.collada_export(filepath=argv[0], triangulate=True, selected=False)
objects = []
for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    me.calc_loop_triangles()
    pts = [ob.matrix_world @ v.co for v in me.vertices]
    per = {}
    for tri in me.loop_triangles:
        i = me.polygons[tri.polygon_index].material_index
        per[i] = per.get(i, 0) + 1
    slots = []
    for i, slot in enumerate(ob.material_slots):
        slots.append({"colour": list(slot.material.diffuse_color)[:3], "faces": per.get(i, 0)})
    objects.append({
        "name": ob.name,
        "min": [min(p[i] for p in pts) for i in range(3)],
        "max": [max(p[i] for p in pts) for i in range(3)],
        "faces": len(me.loop_triangles),
        "slots": slots,
    })
print("JSON " + json.dumps({"objects": objects}))
`;

// ---- Blender ------------------------------------------------------------------------------

const blender = process.env.BLENDER;
if (!blender) {
  console.log("skipped Blender checks: BLENDER is not set");
} else {
  console.log("Blender");
  const work = mkdtempSync(join(tmpdir(), "rodeo-collada-"));
  /** Runs a Blender script headless; its one `JSON ` line is returned parsed. */
  const runBlender = (source: string, args: string[]): any => {
    const script = join(work, `script-${Math.random().toString(36).slice(2)}.py`);
    writeFileSync(script, source);
    const out = execFileSync(blender, ["--background", "--factory-startup", "--python", script, "--", ...args], {
      encoding: "utf8",
      maxBuffer: 512 << 20,
    });
    const line = out.split("\n").find((l) => l.startsWith("JSON "));
    if (!line) throw new Error("Blender gave no JSON");
    return JSON.parse(line.slice(5));
  };

  try {
    // (a) Blender reads our file
    const daePath = join(work, "rodeo.dae");
    writeFileSync(daePath, xml);
    const imported = runBlender(IMPORT_PY, [daePath]);
    console.log(`  Blender imported ${imported.objects.length} object(s): ${imported.objects.map((o: { name: string }) => o.name).join(", ")}`);
    const ours = new Map<string, { parts: MeshPart[] }>();
    for (const p of rt.parts) {
      const e = ours.get(p.name) ?? { parts: [] };
      e.parts.push(p);
      ours.set(p.name, e);
    }
    check(imported.objects.length === ours.size, `Blender: ${ours.size} objects, as the file has`);
    for (const [name, { parts }] of ours) {
      const b = imported.objects.find((o: { name: string }) => o.name === name);
      check(!!b, `Blender: object "${name}" present`);
      if (!b) continue;
      const faces = parts.flatMap((p) => p.faces);
      const mine = bounds(faces);
      const k = (rt.frame?.mm ?? 1) / 1000;
      const metres = { min: mine.min.map((v) => v * k), max: mine.max.map((v) => v * k) };
      check(
        boxNear(metres, b.min, b.max, 1e-5),
        `Blender: "${name}" world bounds match (${b.min.map((v: number) => v.toFixed(4)).join(", ")} to ` +
          `${b.max.map((v: number) => v.toFixed(4)).join(", ")} m)`,
      );
      check(b.faces === faces.length, `Blender: "${name}" has ${faces.length} triangles`);
      const colours = parts.map((p) => p.color).filter((c): c is { r: number; g: number; b: number } => !!c);
      check(
        colours.length === b.colours.length &&
          colours.every((c) => b.colours.some((bc: number[]) => bc && near(bc[0], c.r, 0.01) && near(bc[1], c.g, 0.01) && near(bc[2], c.b, 0.01))),
        `Blender: "${name}" material colours match`,
      );
    }

    // (b) Blender writes a scene, the reader reads it back
    const built = join(work, "built.dae");
    const scene = runBlender(BUILD_PY, [built]);
    const written = parseCollada(readFileSync(built, "utf8"));
    const metresOf = (v: number, file: MeshFile): number => (v * (file.frame?.mm ?? 1)) / 1000;
    for (const obj of scene.objects as { name: string; min: number[]; max: number[]; faces: number; slots: { colour: number[]; faces: number }[] }[]) {
      const parts = written.parts.filter((p) => p.name === obj.name);
      const total = parts.reduce((n, p) => n + p.faces.length, 0);
      check(total === obj.faces, `Blender export: "${obj.name}" has ${obj.faces} triangles (read ${total})`);
      const wb = bounds(parts.flatMap((p) => p.faces));
      const bb = { min: wb.min.map((v) => metresOf(v, written)), max: wb.max.map((v) => metresOf(v, written)) };
      check(boxNear(bb, obj.min, obj.max, 1e-5), `Blender export: "${obj.name}" world bounds match Blender's`);
      for (const slot of obj.slots) {
        const got = parts.find((p) => isColour(p.color, `#${slot.colour.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`, 0.01));
        check(!!got && got.faces.length === slot.faces, `Blender export: "${obj.name}" material ${slot.colour.join("/")} has ${slot.faces} triangles`);
      }
    }
    check(written.frame !== undefined && near(written.frame.mm, 1000, 1e-6), `Blender export: frame ${written.frame?.mm} mm per unit (metres)`);

    // (c) Blender reads our symbols' placements: each instance_node a copy of its node. Blender 4's importer
    // gives the nodes inside a library node a parent inverse that undoes the instancing node's placement
    // (SketchUp's nested components land at the origin too), so this follows the transforms it read instead
    const symbolPath = join(work, "symbols.dae");
    writeFileSync(symbolPath, symbolDae);
    const placed = runBlender(PLACED_PY, [symbolPath]).objects as { name: string; min: number[]; max: number[]; faces: number }[];
    const seatAt = (min: number[], max: number[]): boolean => placed.some((o) => o.faces === 12 && boxNear(o, min, max, 1e-5));
    check(placed.length === 7, `Blender symbols: two Seats, four Legs and the Table (${placed.length} objects)`);
    check(seatAt([1.5, 1, 0.7], [2, 1.5, 0.75]) && seatAt([4.5, 0, 0.4], [5, 0.5, 0.45]), "Blender symbols: the turned and the mirrored Chair's Seats where they were");
    check(placed.some((o) => boxNear(o, [4.5, 0.46, 0], [4.54, 0.5, 0.4], 1e-5)), "Blender symbols: a mirrored Chair's Leg, placed through both instances, where it was");
  } catch (e) {
    check(false, `Blender checks ran (${(e as Error).message})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");

