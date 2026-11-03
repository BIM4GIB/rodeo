// Checks the USD reader under Node. Run from web/:
//   npx tsx src/import/usd.check.ts
// What export/usd.ts writes reads back: the same faces at the same places, coloured, grouped by
// layer, from text and from a .usdz. A hand-written layer tries what other tools write:
// xformOps (translate, rotateXYZ, scale, a matrix, an inverted op, a reset), a reference inside
// the layer, a GeomSubset bound to its own material, a Cube, a left-handed mesh, an inactive and
// an invisible prim, metadata, dictionaries and variant sets passed over, centimetres and z up.
// A binary USD cut short is refused. With BLENDER set to Blender's binary
// (BLENDER=/Applications/Blender.app/Contents/MacOS/Blender), a scene Blender writes is read as
// .usda, as .usdc (binary) and as .usdz (binary inside), each the same; and binary USD that USD
// itself writes (the pxr inside Blender, crate versions 0.4.0, 0.7.0 and its newest) holding every
// kind of value, compressed arrays, time samples, references, a payload and variants reads the
// values written, and the scene the same as USD's own text of it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mesh3D, VwxDocument } from "../core/types.ts";
import { usdScene, usdzPackage } from "../export/usd.ts";
import { parseUsd, parseUsda } from "./usd.ts";
import { readCrate } from "./usdc.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) < tol;

// ---- what Export USD writes comes back ---------------------------------------------------------

const box = new Float32Array([0, 0, 1000, 1000, 0, 1000, 1000, 1000, 1000, 0, 0, 1000, 1000, 1000, 1000, 0, 1000, 1000]);
const tri = new Float32Array([4000, 0, 0, 5000, 0, 0, 5000, 0, 1000]);
const mesh = (objectId: string, layerId: string, triangles: Float32Array, color: string): Mesh3D => ({ objectId, layerId, classIndex: 0, triangles, edges: new Float32Array(), color, opacity: 1, texture: -1 });
const doc = {
  resources: () => [],
  object: (id: string) => ({ id, name: id, typeName: "Mesh", className: "None", layerId: id === "a" ? "L1" : "L2" }),
  layers: () => [
    { id: "L1", name: "Ground" },
    { id: "L2", name: "Roof" },
  ],
  records: () => [],
} as unknown as VwxDocument;
const scene = usdScene(doc, [mesh("a", "L1", box, "#ff0000"), mesh("b", "L2", tri, "#0000ff")], { organization: "layer", combine: false, records: false, textures: false });
const back = parseUsda(scene.text);
check(back.metersPerUnit === 1 && back.upAxis === "Y", "Export USD's metres and y up read back");
check(back.parts.length === 2 && back.parts.map((p) => p.faces.length).join() === "2,1", "two parts, two faces and one");
check(back.parts[0].group === "Ground" && back.parts[1].group === "Roof", "grouped by the layer Xforms under the default prim");
check(!!back.parts[0].color && near(back.parts[0].color.r, 1) && near(back.parts[0].color.b, 0) && !!back.parts[1].color && near(back.parts[1].color.b, 1), "each part's material colour");
// the triangle's corners, y up in metres: (4, 0, 0), (5, 0, 0), (5, 1, 0)
const f = back.parts[1].faces[0];
check(f.length === 9 && [4, 0, 0, 5, 0, 0, 5, 1, 0].every((v, i) => near(f[i], v)), "the corners where they were written");
const pkg = usdzPackage([["scene.usda", new TextEncoder().encode(scene.text)]]);
const fromPkg = parseUsd(pkg);
check(fromPkg.parts.length === 2 && fromPkg.parts[1].faces[0].every((v, i) => near(v, f[i])), "the same from a .usdz");

// ---- what other tools write ---------------------------------------------------------------------

const text = `#usda 1.0
(
    """A test
    layer"""
    defaultPrim = "World"
    metersPerUnit = 0.01
    upAxis = "Z"
    customLayerData = { string creator = "hand { not a brace" }
)

def Xform "World" (
    kind = "assembly"
)
{
    def Xform "Moved"
    {
        double3 xformOp:translate = (100, 0, 0)
        float3 xformOp:rotateXYZ = (0, 0, 90)
        float3 xformOp:scale = (2, 2, 2)
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"]

        def Mesh "Quad" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {
            int[] faceVertexCounts = [4, 3]
            int[] faceVertexIndices = [0, 1, 2, 3, 0, 2, 4]
            point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (2, 2, 0)]
            color3f[] primvars:displayColor = [(0, 1, 0)] (
                interpolation = "constant"
            )
            rel material:binding = </World/Looks/Red>
            float3[] extent.timeSamples = { 0: [(0, 0, 0), (1, 1, 0)], 1: [(0, 0, 0), (1, 1, 0)] }

            def GeomSubset "Blue" (
                prepend apiSchemas = ["MaterialBindingAPI"]
            )
            {
                uniform token elementType = "face"
                uniform token familyName = "materialBind"
                int[] indices = [1]
                rel material:binding = </World/Looks/Blue>
            }
        }
    }

    def Xform "Matrix"
    {
        matrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (10, 20, 30, 1) )
        uniform token[] xformOpOrder = ["xformOp:transform"]

        def Cube "Box"
        {
            double size = 4
        }
    }

    def Xform "Inverted"
    {
        double3 xformOp:translate = (5, 0, 0)
        uniform token[] xformOpOrder = ["!invert!xformOp:translate"]

        def Mesh "Left"
        {
            uniform token orientation = "leftHanded"
            int[] faceVertexCounts = [3]
            int[] faceVertexIndices = [0, 1, 2]
            point3f[] points = [(0, 0, 0), (0, 1, 0), (1, 0, 0)]
        }
    }

    def Xform "Copy" (
        prepend references = </World/Moved>
    )
    {
        double3 xformOp:translate = (0, 500, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def Xform "Reset"
    {
        double3 xformOp:translate = (1000, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
        def Xform "Child"
        {
            uniform token[] xformOpOrder = ["!resetXformStack!"]
            def Mesh "Here"
            {
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
            }
        }
    }

    def Mesh "Off" (
        active = false
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }

    def Mesh "Hidden"
    {
        token visibility = "invisible"
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }

    def BasisCurves "Curve"
    {
    }

    def Xform "Variants" (
        variantSets = "look"
    )
    {
        variantSet "look" = {
            "a" {
                def Mesh "InVariant" {}
            }
        }
    }

    def Scope "Looks"
    {
        def Material "Red"
        {
            token outputs:surface.connect = </World/Looks/Red/Shader.outputs:surface>
            def Shader "Shader"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (1, 0, 0)
                token outputs:surface
            }
        }
        def Material "Blue"
        {
            token outputs:surface.connect = </World/Looks/Blue/Surface.outputs:surface>
            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (0, 0, 1)
                token outputs:surface
            }
        }
    }
}
`;
const hand = parseUsda(text);
check(hand.metersPerUnit === 0.01 && hand.upAxis === "Z", "centimetres and z up, from the layer's metadata");
const byName = (n: string) => hand.parts.filter((p) => p.name === n);
check(hand.parts.map((p) => p.name).sort().join() === "Box,Here,Left,Quad,Quad,Quad_Blue,Quad_Blue", `the parts: ${hand.parts.map((p) => p.name).sort().join()}`);
const quad = byName("Quad")[0];
// scaled 2, turned 90° about z, moved 100 along x: (1, 0, 0) goes to (100, 2, 0)
check(quad.faces.length === 1 && [100, 0, 0, 100, 2, 0, 98, 2, 0, 98, 0, 0].every((v, i) => near(quad.faces[0][i], v)), "translate, rotateXYZ and scale, in xformOpOrder");
check(!!quad.color && near(quad.color.r, 1) && near(quad.color.g, 0), "the bound material's colour wins over displayColor");
const blue = byName("Quad_Blue")[0];
check(blue.faces.length === 1 && !!blue.color && near(blue.color.b, 1), "the GeomSubset's face, in its own material");
const cube = byName("Box")[0];
check(cube.faces.length === 6 && cube.faces.every((face) => face.length === 12) && Math.min(...cube.faces.flat().filter((_, i) => i % 3 === 0)) === 8 && Math.max(...cube.faces.flat().filter((_, i) => i % 3 === 2)) === 32, "a Cube of size 4 through a matrix's translation (10, 20, 30)");
const left = byName("Left")[0];
check([-4, 0, 0, -5, 1, 0, -5, 0, 0].every((v, i) => near(left.faces[0][i], v)), "an inverted translate, and a left-handed face's corners reversed");
const copies = byName("Quad");
check(copies.length === 2 && near(copies[1].faces[0][1], 500), "a reference inside the layer brings the prim's meshes, moved by its own transform");
check(byName("Here").length === 1 && near(byName("Here")[0].faces[0][0], 0), "resetXformStack ignores the parents' transforms");
check(!hand.parts.some((p) => p.name === "Off" || p.name === "Hidden" || p.name === "InVariant"), "inactive, invisible and variant prims left out");
check(hand.skipped.curve === 1, "the curve counted as left out");

let refused = "";
try {
  parseUsd(new TextEncoder().encode("PXR-USDC\0\0\0\0"));
} catch (err) {
  refused = String(err);
}
check(/binary USD/.test(refused), "a binary USD cut short refused, saying so");

// ---- what Blender writes ------------------------------------------------------------------------

const blender = process.env.BLENDER;
if (blender) {
  const dir = mkdtempSync(join(tmpdir(), "usd-read-"));
  try {
    const script = [
      "import bpy, sys",
      "bpy.ops.wm.read_factory_settings(use_empty=True)",
      "bpy.ops.mesh.primitive_cube_add(size=2, location=(3, 0, 1))",
      "cube = bpy.context.object",
      "red = bpy.data.materials.new('Red'); red.use_nodes = True",
      "red.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 0, 0, 1)",
      "blue = bpy.data.materials.new('Blue'); blue.use_nodes = True",
      "blue.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0, 0, 1, 1)",
      "cube.data.materials.append(red); cube.data.materials.append(blue)",
      "cube.data.polygons[0].material_index = 1",
      "bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))",
      "bpy.context.object.rotation_euler = (0, 0, 0.5)",
      `bpy.ops.wm.usd_export(filepath='${dir}/b.usda')`,
      `bpy.ops.wm.usd_export(filepath='${dir}/b.usdc')`,
      `bpy.ops.wm.usd_export(filepath='${dir}/b.usdz')`,
    ].join("\n");
    writeFileSync(join(dir, "make.py"), script);
    execFileSync(blender, ["-b", "--factory-startup", "--python", join(dir, "make.py")], { stdio: "ignore" });
    const a = parseUsd(readFileSync(join(dir, "b.usda")));
    const faces = a.parts.reduce((n, p) => n + p.faces.length, 0);
    console.log("     Blender's usda:", JSON.stringify({ parts: a.parts.map((p) => [p.name, p.faces.length, p.color ? [p.color.r, p.color.g, p.color.b].map((c) => Math.round(c * 100) / 100) : null]), units: a.metersPerUnit, up: a.upAxis, skipped: a.skipped }));
    // a cube's 6 faces and a UV sphere's 32 × 16 rings: 512 faces
    check(faces === 6 + 512, `Blender's cube and sphere: ${faces} faces`);
    const red = a.parts.find((p) => p.color && near(p.color.r, 1, 1e-3) && near(p.color.b, 0, 1e-3));
    const blueParts = a.parts.find((p) => p.color && near(p.color.b, 1, 1e-3) && near(p.color.r, 0, 1e-3));
    check(red?.faces.length === 5 && blueParts?.faces.length === 1, "the cube's two materials, five faces red and one blue");
    const xs = red ? red.faces.flat().filter((_, i) => i % 3 === 0) : [];
    check(xs.length > 0 && near(Math.min(...xs), 2, 1e-4) && near(Math.max(...xs), 4, 1e-4), "the cube where Blender put it, x from 2 to 4");
    // the same scene in binary, alone and packed into a .usdz
    for (const name of ["b.usdc", "b.usdz"]) {
      const b = parseUsd(readFileSync(join(dir, name)));
      // Blender doesn't keep the order of its root prims from one export to the next
      const named = new Map(a.parts.map((p) => [p.name, p]));
      const same =
        b.parts.length === a.parts.length &&
        b.metersPerUnit === a.metersPerUnit &&
        b.upAxis === a.upAxis &&
        b.parts.every((p) => {
          const q = named.get(p.name);
          return !!q && p.name === q.name && p.faces.length === q.faces.length && p.faces.every((f, j) => f.length === q.faces[j].length && f.every((v, k) => near(v, q.faces[j][k], 1e-4))) && JSON.stringify(p.color) === JSON.stringify(q.color);
        });
      check(same, `Blender's ${name} read the same as its .usda`);
    }
  } catch (err) {
    check(false, `Blender's files: ${String(err).slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- binary USD of each kind, written by USD itself (the pxr inside Blender) -------------------

if (blender) {
  const dir = mkdtempSync(join(tmpdir(), "usdc-read-"));
  try {
    const script = [
      "import sys",
      "from pxr import Usd, UsdGeom, Sdf, Gf",
      "out = sys.argv[sys.argv.index('--') + 1]",
      "stage = Usd.Stage.CreateNew(out)",
      "UsdGeom.SetStageMetersPerUnit(stage, 0.001); UsdGeom.SetStageUpAxis(stage, 'Z')",
      "world = UsdGeom.Xform.Define(stage, '/World'); stage.SetDefaultPrim(world.GetPrim())",
      // a 40 × 40 grid, its indexes long enough to be compressed
      "n = 40",
      "grid = UsdGeom.Mesh.Define(stage, '/World/Grid')",
      "grid.CreatePointsAttr([Gf.Vec3f(x, y, 0) for y in range(n + 1) for x in range(n + 1)])",
      "grid.CreateFaceVertexCountsAttr([4] * (n * n))",
      "grid.CreateFaceVertexIndicesAttr([i for y in range(n) for x in range(n) for i in (y*(n+1)+x, y*(n+1)+x+1, y*(n+1)+x+n+2, y*(n+1)+x+n+1)])",
      "grid.CreateDisplayColorAttr([Gf.Vec3f(0.25, 0.5, 1)])",
      "grid.AddTranslateOp().Set(Gf.Vec3d(100.5, 0, 0)); grid.AddOrientOp().Set(Gf.Quatf(0.70710677, 0, 0, 0.70710677)); grid.AddScaleOp().Set(Gf.Vec3f(2, 2, 2))",
      // time samples, a diagonal matrix (inlined) and a full one
      "moving = UsdGeom.Xform.Define(stage, '/World/Moving'); op = moving.AddTranslateOp(); op.Set(Gf.Vec3d(1, 2, 3), 1.0); op.Set(Gf.Vec3d(4, 5, 6), 2.0)",
      "UsdGeom.Cube.Define(stage, '/World/Moving/Box').CreateSizeAttr(4.0)",
      "UsdGeom.Xform.Define(stage, '/World/Scaled').AddTransformOp().Set(Gf.Matrix4d(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1))",
      "UsdGeom.Cube.Define(stage, '/World/Scaled/Box')",
      "UsdGeom.Xform.Define(stage, '/World/Moved').AddTransformOp().Set(Gf.Matrix4d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10.25, 20, 30, 1))",
      "UsdGeom.Cube.Define(stage, '/World/Moved/Box')",
      // a reference inside the layer, one to another file, a payload, a class and an inactive prim
      "stage.CreateClassPrim('/Proto'); UsdGeom.Cube.Define(stage, '/Proto/Box').CreateSizeAttr(6.0)",
      "ref = stage.DefinePrim('/World/Ref', 'Xform'); ref.GetReferences().AddInternalReference('/Proto')",
      "stage.DefinePrim('/World/Far', 'Xform').GetReferences().AddReference('other.usd')",
      // (a payload needs crate 0.8.0, so the older versions go without)
      "import os",
      "if not os.environ.get('USD_WRITE_NEW_USDC_FILES_AS_VERSION'): stage.DefinePrim('/World/Later', 'Xform').GetPayloads().AddPayload('later.usd')",
      "off = UsdGeom.Cube.Define(stage, '/World/Off'); off.GetPrim().SetActive(False)",
      // values of every kind, on a prim of their own
      "v = stage.DefinePrim('/World/Values')",
      "T = Sdf.ValueTypeNames",
      "for name, t, val in [",
      "  ('lut', T.FloatArray, [0.5, 0.25] * 32), ('whole', T.FloatArray, [float(i) for i in range(64)]),",
      "  ('dbl', T.DoubleArray, [i * 0.1 for i in range(64)]), ('dblLut', T.DoubleArray, [0.1, 0.2] * 20),",
      "  ('halfs', T.HalfArray, [1.5] * 32), ('big', T.Int64Array, [0, 2**40, -5] * 8),",
      "  ('small', T.IntArray, [3, -1, 7]), ('many', T.IntArray, list(range(-50, 50, 3))),",
      "  ('q', T.Quatf, Gf.Quatf(0.5, 0.25, -0.5, 1)), ('qd', T.Quatd, Gf.Quatd(0.5, 0.25, -0.5, 1)),",
      "  ('d', T.Double, 0.1), ('dHalf', T.Double, 0.5), ('i', T.Int, -7), ('b', T.Bool, True),",
      "  ('t', T.Token, 'tok'), ('s', T.String, 'a string'), ('a', T.Asset, Sdf.AssetPath('tex/a.png')),",
      "  ('ts', T.TokenArray, ['x', 'y']), ('ss', T.StringArray, ['one', 'two']),",
      "  ('v2', T.Float2Array, [Gf.Vec2f(0.5, 1.25)] * 20), ('h3', T.Half3, Gf.Vec3h(0.5, 1.5, -2.5)),",
      "  ('m', T.Matrix4d, Gf.Matrix4d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16))]:",
      "  v.CreateAttribute(name, t).Set(val)",
      "v.SetCustomDataByKey('note', 'passed over'); v.SetCustomDataByKey('n', 3)",
      "vs = v.GetVariantSets().AddVariantSet('look'); vs.AddVariant('a'); vs.SetVariantSelection('a')",
      "with vs.GetVariantEditContext(): stage.DefinePrim('/World/Values/InVariant', 'Cube')",
      "stage.GetRootLayer().Save()",
      "stage.GetRootLayer().Export(out[:-1] + 'a')",
    ].join("\n");
    writeFileSync(join(dir, "make.py"), script);
    const expected: Record<string, unknown> = {
      lut: Array.from({ length: 64 }, (_, i) => (i % 2 ? 0.25 : 0.5)),
      whole: Array.from({ length: 64 }, (_, i) => i),
      dbl: Array.from({ length: 64 }, (_, i) => i * 0.1),
      dblLut: Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.2 : 0.1)),
      halfs: Array(32).fill(1.5),
      big: Array.from({ length: 24 }, (_, i) => [0, 2 ** 40, -5][i % 3]),
      small: [3, -1, 7],
      many: Array.from({ length: 34 }, (_, i) => -50 + 3 * i),
      q: [0.5, 0.25, -0.5, 1],
      qd: [0.5, 0.25, -0.5, 1],
      d: 0.1,
      dHalf: 0.5,
      i: -7,
      b: true,
      t: "tok",
      s: "a string",
      a: { asset: "tex/a.png" },
      ts: ["x", "y"],
      ss: ["one", "two"],
      v2: Array(20).fill([0.5, 1.25]),
      h3: [0.5, 1.5, -2.5],
      m: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
      ],
    };
    const same = (a: unknown, b: unknown): boolean =>
      typeof a === "number" && typeof b === "number"
        ? a === b || near(a, b, 1e-6)
        : Array.isArray(a) && Array.isArray(b)
          ? a.length === b.length && a.every((x, i) => same(x, b[i]))
          : JSON.stringify(a) === JSON.stringify(b);
    for (const version of ["0.4.0", "0.7.0", ""]) {
      rmSync(join(dir, "v.usdc"), { force: true });
      const env = version ? { ...process.env, USD_WRITE_NEW_USDC_FILES_AS_VERSION: version } : process.env;
      execFileSync(blender, ["-b", "--factory-startup", "--python", join(dir, "make.py"), "--", join(dir, "v.usdc")], { stdio: "ignore", env });
      const bytes = readFileSync(join(dir, "v.usdc"));
      const written = `${bytes[8]}.${bytes[9]}.${bytes[10]}`;
      const layer = readCrate(bytes);
      const values = layer.prims.find((p) => p.name === "World")?.children.find((p) => p.name === "Values");
      const wrong = Object.entries(expected).filter(([k, want]) => !same(values?.attrs.get(k), want));
      check(!!values && wrong.length === 0, `crate ${written}: every kind of value${wrong.length ? `; wrong: ${wrong.map(([k]) => `${k}=${JSON.stringify(values?.attrs.get(k))?.slice(0, 80)}`).join(", ")}` : ""}`);
      check(layer.prims.map((p) => `${p.spec} ${p.name}`).join() === "def World,class Proto", `crate ${written}: the root prims and their specifiers`);
      const fromBinary = parseUsd(bytes);
      const fromText = parseUsda(readFileSync(join(dir, "v.usda"), "utf8"));
      const sameScene =
        fromBinary.parts.length === fromText.parts.length &&
        fromBinary.metersPerUnit === fromText.metersPerUnit &&
        fromBinary.upAxis === fromText.upAxis &&
        JSON.stringify(fromBinary.skipped) === JSON.stringify(fromText.skipped) &&
        fromBinary.parts.every((p, i) => p.name === fromText.parts[i].name && same(p.faces, fromText.parts[i].faces) && JSON.stringify(p.color) === JSON.stringify(fromText.parts[i].color));
      check(sameScene, `crate ${written}: the scene reads the same as USD's own text of it (${fromBinary.parts.map((p) => `${p.name} ${p.faces.length}`).join(", ")}; left out ${JSON.stringify(fromBinary.skipped)})`);
      const grid = fromBinary.parts.find((p) => p.name === "Grid");
      const gx = grid ? grid.faces.flat().filter((_, i) => i % 3 === 0) : [];
      const gy = grid ? grid.faces.flat().filter((_, i) => i % 3 === 1) : [];
      check(grid?.faces.length === 1600 && near(Math.min(...gx), 20.5, 1e-3) && near(Math.max(...gx), 100.5, 1e-3) && near(Math.min(...gy), 0, 1e-3) && near(Math.max(...gy), 80, 1e-3), `crate ${written}: the grid turned a quarter about z, doubled and moved`);
      check(fromBinary.metersPerUnit === 0.001 && fromBinary.upAxis === "Z", `crate ${written}: millimetres and z up`);
    }
  } catch (err) {
    check(false, `binary USD from pxr: ${String(err).slice(0, 300)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
