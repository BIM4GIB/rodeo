// Checks the FBX reader and writer under Node. Run from web/:
//   npx tsx src/import/fbx.check.ts
//   BLENDER=/Applications/Blender.app/Contents/MacOS/Blender npx tsx src/import/fbx.check.ts
// A drawing (two layers; a box in two colours, a second box, and a slab on the upper layer) is
// exported and read back: names, colours, polygons, corner positions and volumes must match.
// A hand-written ASCII file is read for its units, axes, transforms, materials and skipped kinds,
// and again with its front axis declared the other way round, which turns the faces round. With
// BLENDER set, Blender imports the drawing file and reports its objects, and Blender builds a scene
// (a cube under a moved, rotated empty; a UV sphere in two materials; a cylinder) and exports it at
// its defaults and with z up; parseFbx must read both to Blender's own faces, bounds and volumes.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportFbx } from "../export/fbx.ts";
import type { Model3D } from "../export/scene3d.ts";
import { parseFbx } from "./fbx.ts";
import { checkSymbolTrip, SYMBOL_MODEL } from "./symbols.fixture.ts";
import { unfoldTree, type MeshFile } from "./mesh.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V3 = [number, number, number];
const near = (a: number, b: number, tol = 1e-4): boolean => Math.abs(a - b) <= tol;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The triangles of the named faces of a box (mm, z up), two per face, each turned to face out of the
 * box, as the 9 floats per triangle that a Model3D piece takes.
 */
function boxTriangles(lo: V3, hi: V3, faces: string[]): Float32Array {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const rings: Record<string, V3[]> = {
    "-x": [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]],
    "+x": [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    "-y": [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    "+y": [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    "-z": [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    "+z": [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
  };
  const out: number[] = [];
  for (const name of faces) {
    let ring = rings[name];
    const outward: V3 = [0, 0, 0];
    outward["xyz".indexOf(name[1])] = name[0] === "+" ? 1 : -1;
    if (dot(cross(sub(ring[1], ring[0]), sub(ring[2], ring[0])), outward) < 0) ring = ring.slice().reverse();
    for (const k of [0, 1, 2, 0, 2, 3]) out.push(...ring[k]);
  }
  return Float32Array.from(out);
}

const ALL = ["-x", "+x", "-y", "+y", "-z", "+z"];
const RED = "#d62828";
const BLUE = "#1d4ed8";
const GREEN = "#00aa44";
const GREY = "#cccccc";

const drawing: Model3D = {
  layers: [
    {
      id: "walls",
      name: "Walls",
      elevation: 0,
      objects: [
        {
          id: "cube",
          name: "Cube",
          className: "Wall",
          pieces: [
            { color: RED, opacity: 1, triangles: boxTriangles([0, 0, 0], [1000, 1000, 1000], ["+z", "-z", "+x"]) },
            { color: BLUE, opacity: 1, triangles: boxTriangles([0, 0, 0], [1000, 1000, 1000], ["-x", "+y", "-y"]) },
          ],
        },
        {
          id: "pillar",
          name: "Pillar",
          className: "None",
          pieces: [{ color: GREEN, opacity: 0.5, triangles: boxTriangles([2000, 0, 0], [2500, 500, 3000], ALL) }],
        },
      ],
    },
    {
      id: "roof",
      name: "Roof",
      elevation: 3000,
      objects: [{ id: "slab", name: "Slab", className: "None", pieces: [{ color: GREY, opacity: 1, triangles: boxTriangles([0, 0, 3000], [3000, 3000, 3100], ALL) }] }],
    },
  ],
};

/** A parsed corner in millimetres, z up: the file's own units and axes through `frame`. */
function zupMm(p: number[], frame: { mm: number; yUp: boolean }): V3 {
  const [x, y, z] = [p[0] * frame.mm, p[1] * frame.mm, p[2] * frame.mm];
  return frame.yUp ? [x, -z, y] : [x, y, z];
}

/** Faces (flat corner lists) in mm, z up. */
function zupFaces(faces: number[][], frame: { mm: number; yUp: boolean }): V3[][] {
  return faces.map((f) => {
    const out: V3[] = [];
    for (let i = 0; i < f.length; i += 3) out.push(zupMm(f.slice(i, i + 3), frame));
    return out;
  });
}

/** The signed volume of closed faces (fan-triangulated), in the units of the corners cubed. */
function volumeOf(faces: V3[][]): number {
  let v = 0;
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k++) v += dot(f[0], cross(f[k], f[k + 1])) / 6;
  }
  return v;
}

function boundsOf(faces: V3[][]): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) {
    for (const p of f) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], p[i]);
        hi[i] = Math.max(hi[i], p[i]);
      }
    }
  }
  return [lo, hi];
}

/** The mesh's parts of one name, as faces (flat corner lists). */
function facesNamed(mesh: MeshFile, name: string): number[][] {
  return mesh.parts.filter((p) => p.name === name).flatMap((p) => p.faces);
}

// ---- round trip ---------------------------------------------------------------------------

const bytes = exportFbx(drawing, new Date("2026-11-01T10:00:00Z"));
const back = parseFbx(bytes);
const frame = back.frame!;
check(bytes.length > 27 + 16 + 120 && new TextDecoder().decode(bytes.subarray(0, 20)) === "Kaydara FBX Binary  ", "binary FBX header");
check(frame.mm === 10 && frame.yUp === true, "frame: centimetres (10 mm a unit), y up");
check(back.parts.map((p) => p.name).join(",") === "Cube,Cube,Pillar,Slab", `parts named after their objects (${back.parts.map((p) => p.name).join(", ")})`);
check(Object.keys(back.skipped).length === 0, "nothing skipped");

// the objects in groups: models of their own under a null named after each group
const grouped = exportFbx(
  {
    layers: [
      {
        id: "L1",
        name: "Ground",
        elevation: 0,
        objects: [
          { id: "A", name: "Sink", className: "None", groups: [{ id: "G", name: "Kitchen" }], pieces: drawing.layers[0].objects[1].pieces },
          { id: "B", name: "Hob", className: "None", groups: [{ id: "G", name: "Kitchen" }, { id: "C", name: "Cooking" }], pieces: drawing.layers[1].objects[0].pieces },
        ],
      },
    ],
  },
  new Date("2026-11-01T10:00:00Z"),
);
const gb = parseFbx(grouped);
const text = new TextDecoder("latin1").decode(grouped);
check(gb.parts.map((p) => p.name).join(",") === "Sink,Hob" && text.includes("Kitchen\x00\x01Model") && text.includes("Cooking\x00\x01Model"), `groups: Sink and Hob read back by name, Kitchen and Cooking models hold them (${gb.parts.map((p) => p.name)})`);
const hob = zupFaces(gb.parts[1]?.faces ?? [], gb.frame!);
const hobWant = drawing.layers[1].objects[0].pieces[0].triangles;
check(
  hob.length === hobWant.length / 9 && hob.every((f, t) => f.every((c, k) => c.every((v, a) => near(v, hobWant[9 * t + 3 * k + a], 1e-3)))),
  "groups: Hob's triangles in place through the groups' nulls",
);

const cubeParts = back.parts.filter((p) => p.name === "Cube");
const colourOk = (c: { r: number; g: number; b: number } | undefined, hex: string): boolean => {
  const n = parseInt(hex.slice(1), 16);
  return !!c && near(c.r, ((n >> 16) & 255) / 255, 1e-6) && near(c.g, ((n >> 8) & 255) / 255, 1e-6) && near(c.b, (n & 255) / 255, 1e-6);
};
check(cubeParts.length === 2 && colourOk(cubeParts[0].color, RED) && colourOk(cubeParts[1].color, BLUE), "Cube's two parts coloured red and blue");
check(back.parts.find((p) => p.name === "Pillar")?.color !== undefined && colourOk(back.parts.find((p) => p.name === "Pillar")!.color, GREEN), "Pillar coloured green");
check(colourOk(back.parts.find((p) => p.name === "Slab")?.color, GREY), "Slab coloured grey");

// every triangle comes back in its order, corner for corner, in millimetres z up
let positions = true;
const expected = [drawing.layers[0].objects[0].pieces[0], drawing.layers[0].objects[0].pieces[1], drawing.layers[0].objects[1].pieces[0], drawing.layers[1].objects[0].pieces[0]];
back.parts.forEach((part, k) => {
  const want = expected[k].triangles;
  const got = zupFaces(part.faces, frame);
  if (got.length !== want.length / 9) positions = false;
  got.forEach((f, t) => {
    for (let c = 0; c < 3; c++) for (let a = 0; a < 3; a++) if (!near(f[c][a], want[9 * t + 3 * c + a], 1e-3)) positions = false;
  });
});
check(positions, "every triangle's corners match the drawing (z up, mm)");
check(back.parts[0].faces.length === 6 && back.parts[1].faces.length === 6 && back.parts[2].faces.length === 12 && back.parts[3].faces.length === 12, "face counts: 6, 6, 12, 12");

const volumes = [
  ["Cube", 1e9],
  ["Pillar", 500 * 500 * 3000],
  ["Slab", 3000 * 3000 * 100],
] as const;
for (const [name, want] of volumes) {
  const v = volumeOf(zupFaces(facesNamed(back, name), frame));
  check(near(v, want, want * 1e-9), `${name} volume ${want} mm³, outward faces (${v})`);
}

// ---- symbols ------------------------------------------------------------------------------

const symbolFbx = exportFbx(SYMBOL_MODEL, new Date("2026-11-03T10:00:00Z"));
const symbolText = new TextDecoder("latin1").decode(symbolFbx);
check((symbolText.match(/\x00\x01Geometry/g) ?? []).length === 3, `symbols: one Geometry each for the Seat, the Leg and the Table, shared by every placing (${(symbolText.match(/\x00\x01Geometry/g) ?? []).length})`);
checkSymbolTrip("FBX", parseFbx(symbolFbx), check);

// ---- ASCII --------------------------------------------------------------------------------

/** The corners of a flat corner list in reverse order (a face turned round). */
function reverseCorners(flat: number[]): number[] {
  const out: number[] = [];
  for (let i = flat.length - 3; i >= 0; i -= 3) out.push(flat[i], flat[i + 1], flat[i + 2]);
  return out;
}

/** A quad and a triangle in ASCII FBX, in metres: a Z-up file with the model turned 90° about z and moved 2 m along x. */
function asciiFbx(frontSign: number): string {
  return `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",2
		P: "UpAxisSign", "int", "Integer", "",1
		P: "FrontAxis", "int", "Integer", "",1
		P: "FrontAxisSign", "int", "Integer", "",${frontSign}
		P: "CoordAxis", "int", "Integer", "",0
		P: "CoordAxisSign", "int", "Integer", "",1
		P: "UnitScaleFactor", "double", "Number", "",100
	}
}
Objects:  {
	Geometry: 10, "Geometry::Quad", "Mesh" {
		Vertices: *15 {
			a: 0,0,0,1,0,0,1,1,0,0,1,0,0,0,1
		}
		PolygonVertexIndex: *7 {
			a: 0,1,2,-4,0,1,-5
		}
		LayerElementMaterial: 0 {
			Version: 101
			Name: ""
			MappingInformationType: "ByPolygon"
			ReferenceInformationType: "IndexToDirect"
			Materials: *2 {
				a: 0,1
			}
		}
	}
	Geometry: 11, "Geometry::Curve", "NurbsCurve" {
	}
	Geometry: 12, "Geometry::Line", "Line" {
	}
	Model: 20, "Model::Quad", "Mesh" {
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",2,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,90
		}
	}
	Material: 30, "Material::Red", "" {
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",1,0,0
		}
	}
	Material: 31, "Material::Blue", "" {
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0,0,1
		}
	}
}
Connections:  {
	C: "OO",10,20
	C: "OO",20,0
	C: "OO",30,20
	C: "OO",31,20
}
`;
}

const ascii = parseFbx(new TextEncoder().encode(asciiFbx(-1)));
check(ascii.frame?.mm === 1000 && ascii.frame?.yUp === false, "ASCII: 1000 mm a unit, z up");
check(ascii.skipped["curve or surface"] === 1 && ascii.skipped["line"] === 1 && Object.keys(ascii.skipped).length === 2, "ASCII: NURBS curve and line counted as skipped");
const quadRed = ascii.parts.find((p) => p.name === "Quad" && p.color?.r === 1);
const quadBlue = ascii.parts.find((p) => p.name === "Quad" && p.color?.b === 1);
// in the file's units (metres here: parts are not scaled), the quad turned about z and moved 2 along x
const wantRed = [2, 0, 0, 2, 1, 0, 1, 1, 0, 1, 0, 0];
const wantBlue = [2, 0, 0, 2, 1, 0, 2, 0, 1];
const fits = (got: number[] | undefined, want: number[]): boolean => !!got && got.length === want.length && got.every((v, i) => near(v, want[i], 1e-6));
check(ascii.parts.length === 2 && fits(quadRed?.faces[0], wantRed), "ASCII: quad placed by translation and rotation, red");
check(fits(quadBlue?.faces[0], wantBlue), "ASCII: triangle placed, blue (material index 1)");

// declared left-handed: the same place, the faces turned round
const mirrored = parseFbx(new TextEncoder().encode(asciiFbx(1)));
const turned = mirrored.parts.find((p) => p.name === "Quad" && p.color?.r === 1);
check(!!turned && fits(turned.faces[0], reverseCorners(wantRed)), "ASCII: left-handed frame keeps the places and turns the faces round");

// the RotationOrder counts only with RotationActive set, as Blender reads it: without the flag the turn is XYZ
const turnedBy = (extra: string): number[] => {
  const text = asciiFbx(-1).replace('P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,90', `P: "Lcl Rotation", "Lcl Rotation", "", "A",30,40,50${extra}`);
  const quad = parseFbx(new TextEncoder().encode(text)).parts.find((p) => p.name === "Quad" && p.color?.r === 1);
  return quad?.faces[0] ?? [];
};
const xyzTurn = turnedBy("");
const zyxNoFlag = turnedBy('\n\t\t\tP: "RotationOrder", "enum", "", "",5');
const zyxFlag = turnedBy('\n\t\t\tP: "RotationOrder", "enum", "", "",5\n\t\t\tP: "RotationActive", "bool", "", "",1');
check(xyzTurn.length === 12 && zyxNoFlag.length === 12 && zyxNoFlag.every((v, i) => near(v, xyzTurn[i], 1e-9)), "ASCII: a RotationOrder without RotationActive is XYZ");
check(zyxFlag.length === 12 && !zyxFlag.every((v, i) => near(v, xyzTurn[i], 1e-6)), "ASCII: RotationOrder 5 with RotationActive turns the model ZYX");

let refused = "";
try {
  parseFbx(new TextEncoder().encode("hello, not an FBX file"));
} catch (e) {
  refused = (e as Error).message;
}
check(refused === "it isn't a binary or ASCII FBX file", "other files are refused");

// ---- Blender ------------------------------------------------------------------------------

/** The line Blender prints its JSON on, parsed. */
function blenderJson(out: string): Record<string, any> {
  const line = out.split("\n").find((l) => l.startsWith("JSON "));
  if (!line) throw new Error("Blender printed no JSON");
  return JSON.parse(line.slice(5));
}

/** A Blender script that imports argv[1] as argv[0] ("fbx", "dae") and prints each mesh object's name, world bounds, volume and how many objects share its mesh. */
const BLENDER_OBJECTS = `import bpy, sys, json
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
if argv[0] == "fbx":
    bpy.ops.import_scene.fbx(filepath=argv[1])
else:
    bpy.ops.wm.collada_import(filepath=argv[1])
bpy.context.view_layer.update()
out = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    m = o.matrix_world
    pts = [m @ v.co for v in o.data.vertices]
    total = 0.0
    for poly in o.data.polygons:
        vs = [m @ o.data.vertices[i].co for i in poly.vertices]
        for k in range(1, len(vs) - 1):
            total += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
    out.append({"name": o.name, "mesh": o.data.name, "users": o.data.users, "volume": total,
                "min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)]})
print("JSON " + json.dumps(out))
`;

const BLENDER = process.env.BLENDER;
if (!BLENDER) {
  console.log("skip Blender checks: set BLENDER to the Blender executable to run them");
} else {
  const dir = mkdtempSync(join(tmpdir(), "rodeo-fbx-"));
  const run = (script: string, args: string[]): string => {
    const path = join(dir, `${Math.random().toString(36).slice(2)}.py`);
    writeFileSync(path, script);
    return execFileSync(BLENDER, ["--background", "--factory-startup", "--python", path, "--", ...args], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 600_000 });
  };
  try {
    // (a) Blender reads our file
    const ours = join(dir, "rodeo.fbx");
    writeFileSync(ours, bytes);
    const imported = blenderJson(
      run(
        `import bpy, sys, json
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])
bpy.context.view_layer.update()
def volume(o):
    m = o.matrix_world
    total = 0.0
    for poly in o.data.polygons:
        vs = [m @ o.data.vertices[i].co for i in poly.vertices]
        for k in range(1, len(vs) - 1):
            total += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
    return total
out = {}
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    mats = []
    for s in o.material_slots:
        m = s.material
        if m is None:
            continue
        base = None
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    base = list(n.inputs[0].default_value)[:3]
        mats.append({"diffuse": list(m.diffuse_color)[:3], "base": base})
    out[o.name] = {"vertices": len(o.data.vertices), "polygons": len(o.data.polygons),
                   "min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)],
                   "volume": volume(o), "materials": mats}
print("JSON " + json.dumps(out))
`,
        [ours],
      ),
    );
    const want: Record<string, { polygons: number; vertices: number; min: V3; max: V3; volume: number; colours: string[] }> = {
      Cube: { polygons: 12, vertices: 8, min: [0, 0, 0], max: [1, 1, 1], volume: 1, colours: [RED, BLUE] },
      Pillar: { polygons: 12, vertices: 8, min: [2, 0, 0], max: [2.5, 0.5, 3], volume: 0.75, colours: [GREEN] },
      Slab: { polygons: 12, vertices: 8, min: [0, 0, 3], max: [3, 3, 3.1], volume: 0.9, colours: [GREY] },
    };
    for (const [name, w] of Object.entries(want)) {
      const got = imported[name];
      check(!!got, `Blender imports ${name}`);
      if (!got) continue;
      check(got.polygons === w.polygons && got.vertices === w.vertices, `Blender ${name}: ${got.polygons} polygons, ${got.vertices} vertices`);
      const bounds = [0, 1, 2].every((i) => near(got.min[i], w.min[i], 1e-4) && near(got.max[i], w.max[i], 1e-4));
      check(bounds, `Blender ${name}: bounds ${JSON.stringify(got.min)} to ${JSON.stringify(got.max)} m`);
      check(near(got.volume, w.volume, 1e-4), `Blender ${name}: volume ${got.volume.toFixed(4)} m³, outward`);
      const hexRgb = (h: string): number[] => [((parseInt(h.slice(1), 16) >> 16) & 255) / 255, ((parseInt(h.slice(1), 16) >> 8) & 255) / 255, (parseInt(h.slice(1), 16) & 255) / 255];
      const seen = (got.materials as { diffuse: number[]; base: number[] | null }[]).map((m) => m.base ?? m.diffuse);
      const colours = w.colours.every((h) => seen.some((c) => hexRgb(h).every((v, i) => near(c[i], v, 0.01))));
      check(colours, `Blender ${name}: diffuse colours ${w.colours.join(", ")}`);
    }

    // (b) Blender writes files, and parseFbx reads them as Blender's own scene
    const built = blenderJson(
      run(
        `import bpy, sys, json, os
argv = sys.argv[sys.argv.index("--") + 1:]
outdir = argv[0]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.object.empty_add(type='PLAIN_AXES', location=(3, -2, 1), rotation=(0.2, 0.3, 0.5))
holder = bpy.context.active_object
holder.name = "Holder"
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "Cube"
cube.scale = (1, 2, 0.5)
cube.rotation_mode = 'ZYX'
cube.rotation_euler = (0.1, 0.4, 0.7)
cube.parent = holder
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(-4, 0, 0))
sphere = bpy.context.active_object
sphere.name = "Sphere"
def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (rgb[0], rgb[1], rgb[2], 1.0)
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            n.inputs[0].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    return m
sphere.data.materials.append(material("Red", (0.8, 0.1, 0.1)))
sphere.data.materials.append(material("Blue", (0.1, 0.2, 0.9)))
for p in sphere.data.polygons:
    p.material_index = 1 if p.center.z > 0 else 0
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.5, depth=2, location=(0, 4, 0))
cyl = bpy.context.active_object
cyl.name = "Cylinder"
bpy.context.view_layer.update()
def volume(o):
    m = o.matrix_world
    total = 0.0
    for poly in o.data.polygons:
        vs = [m @ o.data.vertices[i].co for i in poly.vertices]
        for k in range(1, len(vs) - 1):
            total += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
    return total
out = {}
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    slots = []
    for i, s in enumerate(o.material_slots):
        base = list(s.material.node_tree.nodes[0].inputs[0].default_value)[:3] if s.material and s.material.node_tree else None
        slots.append({"colour": base, "faces": sum(1 for p in o.data.polygons if p.material_index == i)})
    out[o.name] = {"polygons": len(o.data.polygons), "min": [min(p[i] for p in pts) for i in range(3)],
                   "max": [max(p[i] for p in pts) for i in range(3)], "volume": volume(o), "slots": slots}
bpy.ops.export_scene.fbx(filepath=os.path.join(outdir, "default.fbx"))
bpy.ops.export_scene.fbx(filepath=os.path.join(outdir, "zup.fbx"), axis_up='Z', axis_forward='Y')
print("JSON " + json.dumps(out))
`,
        [dir],
      ),
    );
    for (const [file, label] of [
      ["default.fbx", "default export"],
      ["zup.fbx", "z-up export"],
    ] as const) {
      const mesh = parseFbx(readFileSync(join(dir, file)));
      const f = mesh.frame!;
      for (const [name, w] of Object.entries(built as Record<string, any>)) {
        const faces = zupFaces(facesNamed(mesh, name), f);
        check(faces.length === w.polygons, `Blender ${label}: ${name} has ${w.polygons} faces (${faces.length})`);
        const [lo, hi] = boundsOf(faces);
        const bounds = [0, 1, 2].every((i) => near(lo[i] / 1000, w.min[i], 1e-5) && near(hi[i] / 1000, w.max[i], 1e-5));
        check(bounds, `Blender ${label}: ${name} bounds match (${lo.map((v) => (v / 1000).toFixed(3)).join(", ")} to ${hi.map((v) => (v / 1000).toFixed(3)).join(", ")} m)`);
        const v = volumeOf(faces) / 1e9;
        check(near(v, w.volume, Math.max(1e-6, Math.abs(w.volume) * 1e-4)), `Blender ${label}: ${name} volume ${v.toFixed(4)} m³ (Blender ${w.volume.toFixed(4)})`);
        for (const [i, slot] of (w.slots as { colour: number[]; faces: number }[]).entries()) {
          const got = mesh.parts.filter((p) => p.name === name && p.color && near(p.color.r, slot.colour[0], 1e-4) && near(p.color.g, slot.colour[1], 1e-4) && near(p.color.b, slot.colour[2], 1e-4));
          const count = got.reduce((n, p) => n + p.faces.length, 0);
          if (w.slots.length > 1) check(count === slot.faces, `Blender ${label}: ${name} slot ${i} colour ${slot.colour.map((c: number) => c.toFixed(1)).join(",")} has ${slot.faces} faces (${count})`);
        }
      }
    }

    // (c) Blender reads our symbols as linked duplicates: each placing its own object, all sharing one mesh
    const symbolPath = join(dir, "symbols.fbx");
    writeFileSync(symbolPath, symbolFbx);
    const linked = blenderJson(run(BLENDER_OBJECTS, ["fbx", symbolPath]));
    const seats = linked.filter((o: any) => o.name.startsWith("Seat"));
    const legs = linked.filter((o: any) => o.name.startsWith("Leg"));
    check(seats.length === 2 && seats.every((o: any) => o.users === 2) && legs.length === 4 && legs.every((o: any) => o.users === 4), `Blender symbols: two Seats share one mesh, four Legs another (${linked.map((o: any) => `${o.name}×${o.users}`)})`);
    // Blender keeps a mirrored object's mesh as it is and turns its faces when it draws it, so its volume through the world matrix is negative
    const seatAt = (min: V3, max: V3, volume: number): boolean =>
      seats.some((o: any) => [0, 1, 2].every((i) => near(o.min[i], min[i], 1e-5) && near(o.max[i], max[i], 1e-5)) && near(o.volume, volume, 1e-6));
    check(seatAt([1.5, 1, 0.7], [2, 1.5, 0.75], 0.0125) && seatAt([4.5, 0, 0.4], [5, 0.5, 0.45], -0.0125), `Blender symbols: the turned and the mirrored Chair's Seats where they were, the mirrored one by its scale (${JSON.stringify(seats.map((o: any) => o.min))})`);

    // (d) Blender's linked duplicates come back as one symbol placed each time
    const dupes = blenderJson(
      run(
        `import bpy, sys, json, os
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
crate = bpy.context.active_object
crate.name = "Crate"
crate.data.name = "CrateMesh"
placed = [("Crate turned", (3, 1, 0), (0, 0, 0.6), (1, 1, 1)), ("Crate mirrored", (-2, 2, 1), (0, 0, 0), (-1, 1, 1))]
for name, at, turn, scale in placed:
    o = crate.copy()
    o.name = name
    o.location = at
    o.rotation_euler = turn
    o.scale = scale
    bpy.context.collection.objects.link(o)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -3, 0))
bpy.context.active_object.name = "Loner"
bpy.context.view_layer.update()
out = []
for o in bpy.data.objects:
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    out.append({"name": o.name, "min": [min(p[i] for p in pts) for i in range(3)], "max": [max(p[i] for p in pts) for i in range(3)]})
bpy.ops.export_scene.fbx(filepath=argv[0])
print("JSON " + json.dumps(out))
`,
        [join(dir, "dupes.fbx")],
      ),
    );
    const dupesBack = parseFbx(readFileSync(join(dir, "dupes.fbx")));
    const dt = dupesBack.tree;
    const crates = dt ? dt.top.instances : [];
    check(!!dt && dt.symbols.length === 1 && dt.symbols[0].name === "CrateMesh" && crates.length === 3, `Blender linked duplicates: one symbol, named after the shared mesh, placed three times (${dt?.symbols.map((x) => x.name)}, ${crates.length})`);
    check(crates.every((i) => i.name?.startsWith("Crate")) && dt?.top.parts.length === 1 && dt.top.parts[0].name === "Loner", "Blender linked duplicates: each instance named after its object, the lone cube a mesh");
    for (const want of dupes as { name: string; min: V3; max: V3 }[]) {
      const i = crates.find((x) => x.name === want.name);
      const faces = dt && i ? unfoldTree({ symbols: dt.symbols, top: { parts: [], groups: [], instances: [i] } }).flatMap((p) => p.faces) : dt?.top.parts.find((p) => p.name === want.name)?.faces ?? [];
      const mm = dupesBack.frame!.mm;
      const zf = faces.map((f) => Array.from({ length: f.length / 3 }, (_, k): V3 => [f[3 * k] * mm, f[3 * k + 1] * mm, f[3 * k + 2] * mm]));
      const [lo, hi] = boundsOf(zf);
      const v = volumeOf(zf) / 1e9;
      check(
        faces.length === 6 && [0, 1, 2].every((k) => near(lo[k] / 1000, want.min[k], 1e-5) && near(hi[k] / 1000, want.max[k], 1e-5)) && near(v, 1, 1e-6),
        `Blender linked duplicates: ${want.name} where Blender has it, facing out (volume ${v.toFixed(4)} m³)`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
