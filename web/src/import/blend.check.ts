// Checks the Blender reader under Node. Run from web/:
//   npx tsx src/import/blend.check.ts
// The hand-built files always run: text that isn't a .blend, a file cut short, one with no struct table,
// a damaged compressed stream, a gzip file and a header this reader can't use each give a short clause,
// and a gzip file reads through. With BLENDER set to the Blender binary
// (BLENDER=/Applications/Blender.app/Contents/MacOS/Blender) Blender builds the fixtures headless and
// prints what each holds, and the reader must match it: the default startup cube, and a scene with a
// parented, rotated and scaled cube, a child whose parent moved, every Euler order, quaternion and
// axis-angle rotations, delta transforms, a Suzanne with two material slots (one linked to the object),
// an n-gon, a modifier, a curve, a collection instance, a second collection and a linked object, saved
// uncompressed, zstd-compressed and gzip-compressed. Blender is only ever run headless on its own files.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { parseBlend } from "./blend.ts";
import { MAX_FACES, tooMany, type MeshFile } from "./mesh.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The message a read throws, or null when it reads. */
function thrown(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** A file of just a header and an ENDB block: it has no struct table, so it can't be read. */
function headerOnly(header: string): Uint8Array {
  const out = new Uint8Array(header.length + 32);
  out.set(bytes(header));
  out.set(bytes("ENDB"), header.length);
  return out;
}

// ---- hand-built files ------------------------------------------------------------------------

const notBlend = thrown(() => parseBlend(bytes("hello, this is not a blend file at all")));
check(notBlend === "it isn't a Blender file", `text that is not a .blend is refused: ${notBlend}`);

const cut = thrown(() => parseBlend(bytes("BLENDER-v404")));
check(cut === "it ends early", `a header with no blocks is cut short: ${cut}`);

const noDna = thrown(() => parseBlend(headerOnly("BLENDER-v404")));
check(noDna === "it has no struct table", `a file with no struct table is refused: ${noDna}`);

const noDnaGz = thrown(() => parseBlend(gzipSync(headerOnly("BLENDER-v404"))));
check(noDnaGz === "it has no struct table", `a gzip file is unpacked before it is read: ${noDnaGz}`);

const noDna5 = thrown(() => parseBlend(headerOnly("BLENDER17-01v0500")));
check(noDna5 === "it has no struct table", `Blender 5.0's longer header is recognised: ${noDna5}`);

const badZstd = thrown(() => parseBlend(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3, 4, 5, 6])));
check(badZstd === "its compressed data is damaged", `a damaged zstd stream is refused: ${badZstd}`);

const gzText = thrown(() => parseBlend(gzipSync(bytes("not a blend, zipped"))));
check(gzText === "it isn't a Blender file", `a zipped file that is not a .blend is refused: ${gzText}`);

const badHeader = thrown(() => parseBlend(bytes("BLENDER?v404 and then some more bytes to make the length")));
check(badHeader === "its header is damaged", `a header with a bad pointer size is refused: ${badHeader}`);

// ---- Blender's own files -----------------------------------------------------------------------

/** Blender's ground truth for one file: its mesh objects by name, and what it leaves out. */
interface Truth {
  objects: Record<string, { faces: number; bbox: number[][]; colours: (number[] | null)[]; group: string | null; unapplied: boolean }>;
  skipped: Record<string, number>;
  mm: number;
}

/** Blender's script: builds the fixtures in the folder it is given, and prints their ground truth as one JSON line. */
/** the side of the square grid that is one mesh over the face limit */
const BIG_SIDE = Math.ceil(Math.sqrt(MAX_FACES)) + 10;

const GEN_PY = String.raw`import bpy, bmesh, gzip, json, math, os, sys

OUT = sys.argv[sys.argv.index("--") + 1]
os.makedirs(OUT, exist_ok=True)
TRUTH = {}


def bbox(ob):
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return [[min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]]


def srgb(c):
    # Blender's values are linear; the sRGB transfer curve, clamped to 0..1
    c = min(1.0, max(0.0, c))
    v = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return min(1.0, max(0.0, v))


def colour_of(mat):
    # the Principled base colour when the material has one, else its viewport colour; both as sRGB
    if mat is None:
        return None
    if mat.node_tree is not None:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = n.inputs['Base Color'].default_value
                return [srgb(c[0]), srgb(c[1]), srgb(c[2])]
    d = mat.diffuse_color
    return [srgb(d[0]), srgb(d[1]), srgb(d[2])]


def slot_material(ob, idx):
    if not ob.material_slots:
        return None
    return ob.material_slots[min(idx, len(ob.material_slots) - 1)].material


def truth(scene):
    objs, skipped, holders = {}, {}, {}
    def bump(k):
        skipped[k] = skipped.get(k, 0) + 1
    mesh_obs = []
    for ob in scene.objects:
        if ob.library is not None:
            bump("linked object")
            continue
        if ob.type == 'MESH':
            if len(ob.modifiers) > 0:
                bump("unapplied modifier")
            mesh_obs.append(ob)
        elif ob.type in ('CURVE', 'SURFACE', 'FONT', 'META'):
            bump("curve or surface")
        elif ob.type == 'EMPTY' and ob.instance_type == 'COLLECTION' and ob.instance_collection is not None:
            bump("collection instance")
    for ob in mesh_obs:
        names = [c.name for c in ob.users_collection]
        holders[ob.name] = names[0] if names and names[0] in scene.collection.children else ""
    distinct = set(holders.values())
    for ob in mesh_obs:
        used = {}
        for p in ob.data.polygons:
            m = slot_material(ob, p.material_index)
            used[m.name if m else ""] = colour_of(m)
        objs[ob.name] = {
            "faces": len(ob.data.polygons),
            "bbox": bbox(ob),
            "colours": list(used.values()),
            "group": holders[ob.name] if len(distinct) >= 2 and holders[ob.name] else None,
            "unapplied": len(ob.modifiers) > 0,
        }
    return {"objects": objs, "skipped": skipped, "mm": round(scene.unit_settings.scale_length * 1000, 9)}


def put(ob, coll):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    return ob


def cube_mesh(name, size=1.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=size)
    bm.to_mesh(me)
    bm.free()
    return me


def make_mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    m.diffuse_color = (0.5, 0.5, 0.5, 1.0)
    return m


# 1. the startup cube, as it is
bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene
TRUTH["default"] = truth(scene)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "default.blend"), compress=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "default_z.blend"), compress=True)

# 2. a library file to link an object from
bpy.ops.wm.read_factory_settings(use_empty=True)
lib_ob = bpy.data.objects.new("LinkedCube", cube_mesh("LinkedCubeMesh", 2.0))
bpy.context.scene.collection.objects.link(lib_ob)
lib_ob.location = (10, 10, 0)
LIB = os.path.join(OUT, "lib.blend")
bpy.ops.wm.save_as_mainfile(filepath=LIB, compress=False)

# 3. the scene
bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene
main = scene.collection.children["Collection"]
bpy.data.objects.remove(bpy.data.objects["Cube"], do_unlink=True)

parent = put(bpy.data.objects.new("Parent", None), main)
parent.empty_display_type = 'PLAIN_AXES'
parent.location = (5, -2, 1)

root = put(bpy.data.objects.new("Root", None), main)
root.empty_display_type = 'PLAIN_AXES'
root.location = (0, 0, 0.5)
root.rotation_euler = (0, 0, 0.2)
parent.parent = root

cube = put(bpy.data.objects.new("Cube", cube_mesh("CubeMesh")), main)
cube.parent = parent
cube.location = (1, 0, 0)
cube.rotation_euler = (math.radians(10), 0, math.radians(30))
cube.scale = (2, 1, 0.5)

# a child whose parent inverse holds the parent's pose from when it was parented, then the parent moves
child = put(bpy.data.objects.new("Child", cube_mesh("ChildMesh", 0.5)), main)
child.parent = parent
bpy.context.view_layer.update()
child.matrix_parent_inverse = parent.matrix_world.inverted()
child.location = (0, 0, 1)
parent.location = (6, 0, 2)
parent.rotation_euler = (0, 0, 0.5)

order = put(bpy.data.objects.new("Order", cube_mesh("OrderMesh")), main)
order.location = (-8, -8, 0)
order.rotation_mode = 'XZY'
order.rotation_euler = (0.4, 0.9, -0.3)

quat = put(bpy.data.objects.new("Quat", cube_mesh("QuatMesh")), main)
quat.location = (-8, 8, 2)
quat.rotation_mode = 'QUATERNION'
quat.rotation_quaternion = (0.9239, 0.3827, 0.0, 0.0)

axis = put(bpy.data.objects.new("Axis", cube_mesh("AxisMesh")), main)
axis.location = (8, 8, 0)
axis.rotation_mode = 'AXIS_ANGLE'
axis.rotation_axis_angle = (0.7, 0.5, 0.5, 0.2)

delta = put(bpy.data.objects.new("Delta", cube_mesh("DeltaMesh")), main)
delta.location = (-2, 2, 0)
delta.delta_location = (0.5, 0.5, 0.0)
delta.delta_rotation_euler = (0.0, 0.3, 0.0)
delta.delta_scale = (1.0, 1.5, 1.0)
delta.rotation_euler = (0.2, 0.0, 0.5)

qdelta = put(bpy.data.objects.new("QuatDelta", cube_mesh("QuatDeltaMesh")), main)
qdelta.location = (-6, -2, 3)
qdelta.rotation_mode = 'QUATERNION'
qdelta.rotation_quaternion = (0.9239, 0.0, 0.3827, 0.0)
qdelta.delta_rotation_quaternion = (0.9239, 0.3827, 0.0, 0.0)

bpy.ops.mesh.primitive_monkey_add(location=(-4, 0, 1))
suz = put(bpy.context.active_object, main)
suz.name = "Suzanne"
red = make_mat("Red", (0.8, 0.1, 0.1))
green = make_mat("Green", (0.1, 0.8, 0.1))
blue = make_mat("Blue", (0.1, 0.2, 0.9))
suz.data.materials.append(red)
suz.data.materials.append(green)
suz.material_slots[1].link = 'OBJECT'
suz.material_slots[1].material = blue
for i, p in enumerate(suz.data.polygons):
    p.material_index = i % 2

me = bpy.data.meshes.new("NGonMesh")
bm = bmesh.new()
hexv = [bm.verts.new((math.cos(a) * 1.5, math.sin(a) * 1.5, 0)) for a in [i * math.tau / 6 for i in range(6)]]
bm.faces.new(hexv)
quad = [bm.verts.new(p) for p in [(3, 0, 0), (4, 0, 0), (4, 1, 0), (3, 1, 0)]]
bm.faces.new(quad)
bm.to_mesh(me)
bm.free()
ngon = put(bpy.data.objects.new("NGon", me), main)
ngon.location = (0, 5, 0)
ngon.data.materials.append(make_mat("Gold", (0.9, 0.7, 0.2)))
plain = bpy.data.materials.new("Plain")
plain.diffuse_color = (0.2, 0.4, 0.6, 1.0)
order.data.materials.append(plain)
TRUTH["plain_has_nodes"] = plain.node_tree is not None

sub = put(bpy.data.objects.new("Subsurf", cube_mesh("SubsurfMesh")), main)
sub.location = (4, 4, 0)
sm = sub.modifiers.new("Subdivision", 'SUBSURF')
sm.levels = 1
sm.render_levels = 1

bpy.ops.curve.primitive_bezier_curve_add(location=(-4, -5, 0))
bez = put(bpy.context.active_object, main)
bez.name = "Bezier"

extras = bpy.data.collections.new("Extras")
scene.collection.children.link(extras)
pm = bpy.data.meshes.new("PlaneMesh")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=1.0)
bm.to_mesh(pm)
bm.free()
plane = put(bpy.data.objects.new("Plane", pm), extras)
plane.location = (0, -6, 0)
plane.data.materials.append(make_mat("Teal", (0.1, 0.6, 0.6)))

inst = put(bpy.data.objects.new("Instance", None), main)
inst.instance_type = 'COLLECTION'
inst.instance_collection = extras
inst.location = (-8, 4, 0)

with bpy.data.libraries.load(LIB, link=True) as (src, dst):
    dst.objects = ["LinkedCube"]
scene.collection.objects.link(dst.objects[0])

scene.unit_settings.scale_length = 0.001
bpy.context.view_layer.update()
TRUTH["scene"] = truth(scene)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "scene.blend"), compress=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "scene_z.blend"), compress=True)
with open(os.path.join(OUT, "scene.blend"), "rb") as f:
    raw = f.read()
with open(os.path.join(OUT, "scene_gzip.blend"), "wb") as f:
    f.write(gzip.compress(raw))

# 4. a mesh over the face limit, which must be refused
bpy.ops.wm.read_factory_settings(use_empty=True)
big = bmesh.new()
bmesh.ops.create_grid(big, x_segments=${BIG_SIDE}, y_segments=${BIG_SIDE}, size=10.0)
bigme = bpy.data.meshes.new("Big")
big.to_mesh(bigme)
big.free()
bpy.context.scene.collection.objects.link(bpy.data.objects.new("Big", bigme))
TRUTH["big_faces"] = len(bigme.polygons)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "big.blend"), compress=False)

TRUTH["enum"] = {item.identifier: item.value for item in bpy.types.Object.bl_rna.properties["type"].enum_items}
print("BLEND_TRUTH " + json.dumps(TRUTH))`;

/** Matches one file's mesh against Blender's ground truth for it, one line for each object. */
function checkFile(dir: string, file: string, t: Truth): void {
  const mesh: MeshFile = parseBlend(new Uint8Array(readFileSync(join(dir, file))));
  const label = file.replace(".blend", "");
  check(JSON.stringify(sorted(mesh.skipped)) === JSON.stringify(sorted(t.skipped)), `${label}: left out ${JSON.stringify(t.skipped)}`);
  check(Math.abs((mesh.frame?.mm ?? NaN) - t.mm) < 1e-6 && mesh.frame?.yUp === false, `${label}: ${mesh.frame?.mm} mm to a unit, z up`);
  const names = new Set(mesh.parts.map((p) => p.name));
  const want = Object.keys(t.objects);
  check(names.size === want.length && want.every((n) => names.has(n)), `${label}: parts are the ${want.length} mesh objects`);
  for (const [name, o] of Object.entries(t.objects)) {
    const parts = mesh.parts.filter((p) => p.name === name);
    const problems: string[] = [];
    const faces = parts.reduce((n, p) => n + p.faces.length, 0);
    if (faces !== o.faces) problems.push(`${faces} faces, not ${o.faces}`);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) {
      for (const f of p.faces) {
        for (let i = 0; i < f.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], f[i + k]);
            hi[k] = Math.max(hi[k], f[i + k]);
          }
        }
      }
    }
    const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
    if (!(near(lo, o.bbox[0]) && near(hi, o.bbox[1]))) problems.push(`bounds ${lo.map((v) => v.toFixed(3))} to ${hi.map((v) => v.toFixed(3))}`);
    const got = parts.map((p) => (p.color ? [p.color.r, p.color.g, p.color.b] : null));
    const same = (a: number[] | null, b: number[] | null): boolean => (a === null || b === null ? a === b : near(a, b));
    if (!(got.length === o.colours.length && o.colours.every((w) => got.some((g) => same(g, w))))) problems.push(`colours ${JSON.stringify(got)}`);
    if (!parts.every((p) => (p.group ?? null) === o.group)) problems.push(`groups ${parts.map((p) => p.group ?? "none").join(", ")}`);
    const detail = problems.length ? ` (${problems.join("; ")})` : "";
    check(problems.length === 0, `${label}: ${name}, ${o.faces} faces, bounds, colours and group as Blender has them${detail}`);
  }
}

function sorted(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

const blender = process.env.BLENDER;
if (!blender) {
  console.log("skip  Blender fixtures: set BLENDER to the Blender binary to run them");
} else {
  const dir = mkdtempSync(join(tmpdir(), "blend-check-"));
  const script = join(dir, "gen.py");
  const out = join(dir, "fixtures");
  writeFileSync(script, GEN_PY);
  let truth: (Record<string, Truth> & { big_faces?: number }) | null = null;
  try {
    const log = execFileSync(blender, ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", out], {
      encoding: "utf8",
      maxBuffer: 256 << 20,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = log.split("\n").find((l) => l.startsWith("BLEND_TRUTH "));
    truth = line ? (JSON.parse(line.slice("BLEND_TRUTH ".length)) as Record<string, Truth> & { big_faces?: number }) : null;
  } catch (e) {
    check(false, `Blender builds the fixtures: ${(e as Error).message.split("\n")[0]}`);
  }
  if (truth) {
    check(true, "Blender builds the fixtures and prints their ground truth");
    checkFile(out, "default.blend", truth.default);
    checkFile(out, "default_z.blend", truth.default);
    checkFile(out, "scene.blend", truth.scene);
    checkFile(out, "scene_z.blend", truth.scene);
    checkFile(out, "scene_gzip.blend", truth.scene);

    const whole = new Uint8Array(readFileSync(join(out, "scene.blend")));
    const half = thrown(() => parseBlend(whole.subarray(0, whole.length >> 1)));
    check(half !== null && /^its? /.test(half), `half of scene.blend is refused: ${half}`);
    const bigTooMany = thrown(() => parseBlend(new Uint8Array(readFileSync(join(out, "big.blend")))));
    check(
      bigTooMany === tooMany().message,
      `a mesh of ${truth.big_faces ?? "?"} faces is refused past the limit: ${bigTooMany}`,
    );
    const zWhole = new Uint8Array(readFileSync(join(out, "scene_z.blend")));
    const zHalf = thrown(() => parseBlend(zWhole.subarray(0, zWhole.length >> 1)));
    check(zHalf !== null && /^its? /.test(zHalf), `half of scene_z.blend is refused: ${zHalf}`);
  }
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
