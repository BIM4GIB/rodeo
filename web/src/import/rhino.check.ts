// Checks the Rhino .3dm reader and writer under Node, with rhino3dm loaded from web/node_modules. Run from web/:
//   npx tsx src/import/rhino.check.ts
// A hand-built drawing (two design layers, two classes, three colours, a box, triangles and flat linework and
// text) is written and read back: each mesh comes back as a part with its faces in millimetres, its colour and
// its layer's path as its group; each line, polyline, circle, arc, ellipse, text and point comes back as a shape
// of its kind with its millimetre coordinates. Files built in metres and inches read in millimetres. A Brep
// made in code has no render mesh and is counted; a meshed face reads; an extrusion with no mesh is counted; a
// block is placed by its transform and coloured by its instance; a mirrored block turns over; blocks nested past
// eight deep are left out; objects on hidden layers and hidden objects are counted, not read; bytes that aren't
// a 3DM file are refused.
//
// rhino3dm's typings differ from its runtime in places this check works round: BrepFace.setMesh takes the mesh
// first, the InstanceReference constructor takes its definition's id and a transform, and a material's diffuse
// colour is an object of 0..255 channels.

import rhino3dm from "rhino3dm";
import type { File3dm, InstanceReference, Mesh, ObjectAttributes, Transform, UnitSystem } from "rhino3dm";
import { parse3dm, type Rhino } from "./rhino.ts";
import { MAX_FACES, tooMany, unfoldTree, type MeshFile } from "./mesh.ts";
import { checkSymbolTrip, SYMBOL_MODEL } from "./symbols.fixture.ts";
import { export3dm } from "../export/rhino.ts";
import type { FlatObject, Model3D } from "../export/scene3d.ts";
import type { BBox, Pt, Shape, ShapeKind } from "../core/types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;
const nearPt = (p: Pt | undefined, x: number, y: number): boolean => !!p && near(p.x, x) && near(p.y, y);
const samePts = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => near(v, b[i]));

/** Two triangles' corners, the same numbers in the same order. */
const sameTriangles = (faces: readonly number[][], tris: Float32Array): boolean =>
  faces.length === tris.length / 9 && faces.every((f, i) => samePts(f, Array.from(tris.subarray(9 * i, 9 * i + 9))));

const rhino: Rhino = await rhino3dm();
const SKIP_NO_MESH = "surface without a render mesh";
const MM_PER_PT = 25.4 / 72;

/** One triangle's corners, as a piece takes them. */
function tri(a: number[], b: number[], c: number[]): Float32Array {
  return new Float32Array([...a, ...b, ...c]);
}

/** The twelve triangles of an axis-aligned box. */
function boxTriangles(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Float32Array {
  const quads = [
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
  ];
  const out: number[] = [];
  for (const [a, b, c, d] of quads) out.push(...a, ...b, ...c, ...a, ...c, ...d);
  return new Float32Array(out);
}

/** A flat object's shape, with the fields a shape leaves out at their defaults. */
function shape(s: { kind: ShapeKind } & Partial<Shape>): Shape {
  return { points: [], closed: false, bbox: null as BBox | null, ...s };
}

/** A mesh of the given triangles' corners, as rhino3dm builds one. */
function meshOf(corners: number[][][]): Mesh {
  const m = new rhino.Mesh();
  const verts = m.vertices();
  const faces = m.faces();
  for (const [a, b, c] of corners) faces.addTriFace(verts.add(a[0], a[1], a[2]), verts.add(b[0], b[1], b[2]), verts.add(c[0], c[1], c[2]));
  return m;
}

/** Attributes with a name, a layer and an optional colour from the object. */
function attrs(props: { name?: string; layerIndex?: number; colour?: { r: number; g: number; b: number } }): ObjectAttributes {
  const a = new rhino.ObjectAttributes();
  if (props.name !== undefined) a.name = props.name;
  if (props.layerIndex !== undefined) a.layerIndex = props.layerIndex;
  if (props.colour) {
    a.colorSource = rhino.ObjectColorSource.ColorFromObject;
    a.objectColor = { ...props.colour, a: 255 };
  }
  return a;
}

/** A part by its name, or undefined. */
const partNamed = (out: MeshFile, name: string) => (out.tree ? unfoldTree(out.tree) : out.parts).filter((p) => p.name === name);

/** Counts of what was left out, with zero for kinds not counted. */
const skipped = (out: MeshFile, kind: string): number => out.skipped[kind] ?? 0;

// ---- round trip -------------------------------------------------------------------------------------------

const model: Model3D = {
  layers: [
    {
      id: "ground",
      name: "Ground",
      elevation: 0,
      objects: [
        { id: "wall-a", name: "Wall A", className: "Walls", pieces: [{ color: "#ff0000", opacity: 1, triangles: boxTriangles(0, 0, 0, 4000, 200, 3000) }] },
        { id: "door", name: "Door", className: "Doors", pieces: [{ color: "#00ff00", opacity: 1, triangles: tri([100, 0, 0], [900, 0, 0], [900, 0, 2100]) }] },
      ],
    },
    {
      id: "upper",
      name: "Upper",
      elevation: 3000,
      objects: [
        {
          id: "wall-b",
          name: "Wall B",
          className: "Walls",
          pieces: [
            { color: "#0000ff", opacity: 1, triangles: tri([0, 0, 3000], [1000, 0, 3000], [1000, 0, 4000]) },
            { color: "#ffff00", opacity: 1, triangles: tri([0, 500, 3000], [1000, 500, 3000], [0, 500, 4000]) },
          ],
        },
      ],
    },
  ],
};

const FLAT_LINE_COLOUR = "#123456";
const flat: FlatObject[] = [
  { layerId: "ground", className: "Walls", z: 0, color: FLAT_LINE_COLOUR, scale: 1, shape: shape({ kind: "line", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }) },
  { layerId: "ground", className: "Walls", z: 0, color: FLAT_LINE_COLOUR, scale: 1,
    shape: shape({ kind: "polygon", points: [{ x: 0, y: 2000 }, { x: 1000, y: 2000 }, { x: 1000, y: 3000 }], closed: true }) },
  { layerId: "ground", className: "Doors", z: 0, color: "#654321", scale: 1,
    shape: shape({ kind: "arc", center: { x: 5000, y: 5000 }, rx: 500, ry: 500, startAngle: 0, sweepAngle: 360 }) },
  { layerId: "ground", className: "Doors", z: 0, color: "#654321", scale: 1,
    shape: shape({ kind: "arc", center: { x: 0, y: 8000 }, rx: 300, ry: 300, startAngle: 0, sweepAngle: 90 }) },
  { layerId: "ground", className: "Doors", z: 0, color: "#654321", scale: 1,
    shape: shape({ kind: "arc", center: { x: 6000, y: 6000 }, rx: 800, ry: 400, startAngle: 0, sweepAngle: 180 }) },
  { layerId: "ground", className: "Walls", z: 0, color: "#000000", scale: 50, shape: shape({ kind: "text", anchor: { x: 100, y: 9000 }, text: "Level 1", textSize: 12 * MM_PER_PT * 50 }) },
  { layerId: "upper", className: "Walls", z: 3000, color: FLAT_LINE_COLOUR, scale: 1, shape: shape({ kind: "line", points: [{ x: 0, y: 0 }, { x: 0, y: 1000 }] }) },
  { layerId: "upper", className: "Walls", z: 3000, color: "#000000", scale: 1, shape: shape({ kind: "locus", points: [{ x: 50, y: 50 }] }) },
  { layerId: "roof", className: "None", z: 6000, color: "#aaaaaa", scale: 1, shape: shape({ kind: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }) },
  { layerId: "ground", className: "Walls", z: 0, color: "#000000", scale: 1, shape: shape({ kind: "text", anchor: { x: 0, y: 9500 }, text: "Note", textSize: 0.5 }) },
];
const layerNames = new Map([
  ["ground", "Ground"],
  ["upper", "Upper"],
  ["roof", "Roof"],
]);

const bytes = export3dm(model, flat, layerNames, rhino);
{
  // the objects in groups in a Rhino group named after each
  const grouped: Model3D = {
    layers: [
      {
        id: "g",
        name: "Ground",
        elevation: 0,
        objects: [
          { id: "A", name: "Sink", className: "None", groups: [{ id: "G", name: "Kitchen" }], pieces: [{ color: "#ff0000", opacity: 1, triangles: boxTriangles(0, 0, 0, 600, 600, 900) }] },
          { id: "B", name: "Hob", className: "None", groups: [{ id: "G", name: "Kitchen" }, { id: "C", name: "Cooking" }], pieces: [{ color: "#0000ff", opacity: 1, triangles: boxTriangles(700, 0, 0, 1300, 600, 900) }] },
          { id: "T", name: "Table", className: "None", pieces: [{ color: "#00ff00", opacity: 1, triangles: boxTriangles(2000, 0, 0, 3000, 900, 750) }] },
        ],
      },
    ],
  };
  const f = rhino.File3dm.fromByteArray(export3dm(grouped, [], new Map([["g", "Ground"]]), rhino));
  const groups = f.groups();
  const members = (name: string): number[] => {
    for (let i = 0; i < f.objects().count; i++) {
      const a = f.objects().get(i).attributes();
      if (a.name === name) return a.getGroupList() ?? [];
    }
    return [-1];
  };
  check(groups.count === 2 && groups.get(0).name === "Kitchen" && groups.get(1).name === "Cooking", "groups: two Rhino groups, Kitchen and Cooking");
  check(members("Sink").join() === "0" && members("Hob").join() === "0,1" && members("Table").length === 0, `groups: Sink in Kitchen, Hob in Kitchen and Cooking, Table in none (${members("Hob")})`);
}
check(bytes instanceof Uint8Array && bytes.length > 0, `export writes ${bytes.length} bytes`);
const out = parse3dm(bytes, rhino);
check(out.frame?.mm === 1 && out.frame?.yUp === false, "round trip: frame is millimetres, z up");

const wallA = partNamed(out, "Wall A");
check(
  wallA.length === 1 && wallA[0].faces.length === 12 && sameTriangles(wallA[0].faces, boxTriangles(0, 0, 0, 4000, 200, 3000)),
  "Wall A: 12 faces, the box's corners in mm",
);
check(wallA.length === 1 && wallA[0].group === "Ground::Walls", "Wall A: its layer's class path as its group");
check(
  wallA.length === 1 && wallA[0].color !== undefined && near(wallA[0].color.r, 1) && near(wallA[0].color.g, 0) && near(wallA[0].color.b, 0),
  "Wall A: red from its object",
);

const door = partNamed(out, "Door");
check(
  door.length === 1 && door[0].faces.length === 1 && sameTriangles(door[0].faces, tri([100, 0, 0], [900, 0, 0], [900, 0, 2100])),
  "Door: one face, its corners in mm",
);
check(door.length === 1 && door[0].group === "Ground::Doors" && door[0].color !== undefined && near(door[0].color.g, 1), "Door: group Ground::Doors, green");

const wallB = partNamed(out, "Wall B");
check(wallB.length === 2, "Wall B: one part per piece");
check(wallB.length === 2 && wallB.every((p) => p.group === "Upper::Walls"), "Wall B: group Upper::Walls for each piece");
check(
  wallB.length === 2 && wallB.some((p) => p.color && near(p.color.b, 1) && near(p.color.r, 0)) &&
    wallB.some((p) => p.color && near(p.color.r, 1) && near(p.color.g, 1) && near(p.color.b, 0)),
  "Wall B: blue and yellow pieces",
);

const sh = out.shapes ?? [];
check(sh.length === flat.length, `round trip: ${flat.length} flat objects read back as ${sh.length} shapes`);
const [line, poly, circle, quarter, ellipse, label, upperLine, locus, roofLine, note] = sh;
check(Object.keys(out.skipped).length === 0, "round trip: nothing left out");
check(line?.shape.kind === "line" && line.shape.kind === "line" && nearPt(line.shape.a, 0, 0) && nearPt(line.shape.b, 1000, 0), "line: its ends in mm");
check(
  line?.group === "Ground::Walls" && line.color !== undefined && near(line.color.r, 0x12 / 255) && near(line.color.g, 0x34 / 255) &&
    near(line.color.b, 0x56 / 255),
  "line: group and colour",
);
check(
  poly?.shape.kind === "polyline" && poly.shape.kind === "polyline" && poly.shape.closed && poly.shape.points.length === 3,
  "closed polygon: a closed polyline with its three corners",
);
check(poly?.shape.kind === "polyline" && nearPt(poly.shape.points[2], 1000, 3000), "closed polygon: last corner in mm");
check(
  circle?.shape.kind === "arc" && circle.shape.kind === "arc" && nearPt(circle.shape.center, 5000, 5000) && near(circle.shape.radius, 500) &&
    near(circle.shape.sweepAngle, 360),
  "full circle: arc of 360 degrees, radius in mm",
);
check(
  quarter?.shape.kind === "arc" && quarter.shape.kind === "arc" && nearPt(quarter.shape.center, 0, 8000) && near(quarter.shape.radius, 300) &&
    near(quarter.shape.sweepAngle, 90) && near(quarter.shape.startAngle, 0),
  "90 degree arc: start 0, sweep 90",
);
const ell = ellipse?.shape.kind === "polyline" ? ellipse.shape : null;
check(
  !!ell && !ell.closed && ell.points.length === 65 && nearPt(ell.points[0], 6800, 6000) && nearPt(ell.points[32], 6000, 6400) &&
    nearPt(ell.points[64], 5200, 6000),
  "elliptical arc: sampled polyline through its ends and quarter point",
);
check(
  label?.shape.kind === "text" && label.shape.kind === "text" && nearPt(label.shape.at, 100, 9000) && label.shape.text === "Level 1" &&
    label.points === 12 && near(label.shape.height, 12 * MM_PER_PT),
  "text: at its anchor, its text, 12 points (its 211.7 mm at 1:50) and the 1:1 height of 12 points",
);
check(
  upperLine?.shape.kind === "line" && upperLine.shape.kind === "line" && nearPt(upperLine.shape.b, 0, 1000) && upperLine.group === "Upper::Walls",
  "upper line: plan only (z dropped), group Upper::Walls",
);
check(locus?.shape.kind === "locus" && locus.shape.kind === "locus" && nearPt(locus.shape.at, 50, 50), "point: a locus at its place");
check(roofLine?.group === "Roof::None", "flat-only layer: named from layerNames, sublayer None");
check(
  note?.shape.kind === "text" && note.points === 3,
  "a 0.5 mm text at 1:1 (1.4 points) reads back at 3 points: a text dot keeps whole sizes of 3 and up",
);

// ---- units ------------------------------------------------------------------------------------------------

/** A file in the given unit system: one triangle (its corners in file units) and one line from `from` to `to`. */
function unitFile(units: UnitSystem, triangle: number[][], from: number[], to: number[]): Uint8Array {
  const f = new rhino.File3dm();
  f.settings().modelUnitSystem = units;
  const m = meshOf([triangle]);
  f.objects().addMesh(m, attrs({ name: "Tri" }));
  f.objects().addLine(from, to, attrs({}));
  return f.toByteArray();
}

/** The first shape's end point b, when it is a line. */
function lineEnd(out: MeshFile): Pt | undefined {
  const s = out.shapes?.[0]?.shape;
  return s?.kind === "line" ? s.b : undefined;
}

const metres = parse3dm(unitFile(rhino.UnitSystem.Meters, [[1, 0, 0], [3, 0, 0], [1, 2, 0]], [0, 0, 0], [1, 0, 0]), rhino);
check(metres.frame?.mm === 1000, "metres: frame is 1000 mm a unit");
check(sameTriangles(metres.parts[0].faces, tri([1, 0, 0], [3, 0, 0], [1, 2, 0])), "metres: the triangle's corners stay in file units");
check(nearPt(lineEnd(metres), 1000, 0), "metres: the 1 m line is 1000 mm long in plan");

const inches = parse3dm(unitFile(rhino.UnitSystem.Inches, [[1, 1, 1], [11, 1, 1], [1, 11, 1]], [0, 0, 0], [10, 0, 0]), rhino);
check(inches.frame !== undefined && near(inches.frame.mm, 25.4, 1e-9), "inches: frame is 25.4 mm a unit");
check(sameTriangles(inches.parts[0].faces, tri([1, 1, 1], [11, 1, 1], [1, 11, 1])), "inches: the triangle's corners stay in file units");
check(nearPt(lineEnd(inches), 254, 0), "inches: the 10 in line is 254 mm");

const none = parse3dm(unitFile(rhino.UnitSystem.None, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [0, 0, 0], [1, 0, 0]), rhino);
check(none.frame?.mm === 1, "no units: taken as millimetres");

// ---- Breps, extrusions and surfaces --------------------------------------------------------------------

/** A file holding one object, made by `add` from the file. */
function fileWith(add: (f: File3dm) => void): Uint8Array {
  const f = new rhino.File3dm();
  f.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
  add(f);
  return f.toByteArray();
}

const boxBrep = () => rhino.Brep.createFromBoundingBox(new rhino.BoundingBox([0, 0, 0], [1, 1, 1]));

const bare = parse3dm(fileWith((f) => f.objects().addBrep(boxBrep(), attrs({ name: "Solid" }))), rhino);
check(partNamed(bare, "Solid").length === 0 && skipped(bare, SKIP_NO_MESH) === 1, "a Brep with no render mesh: counted, no part, no crash");

const partial = parse3dm(
  fileWith((f) => {
    const b = boxBrep();
    const face = b.faces().get(0);
    // rhino3dm's setMesh takes the mesh first, whatever its typings say
    (face as unknown as { setMesh(mesh: Mesh, type: unknown): boolean }).setMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), rhino.MeshType.Render);
    f.objects().addBrep(b, attrs({ name: "Partial" }));
  }),
  rhino,
);
check(partNamed(partial, "Partial").length === 1 && partNamed(partial, "Partial")[0].faces.length === 1, "a Brep with one face meshed: that face is a part");
check(skipped(partial, SKIP_NO_MESH) === 1, "a Brep with one face unmeshed: counted once");

const full = parse3dm(
  fileWith((f) => {
    const b = boxBrep();
    for (let i = 0; i < b.faces().count; i++) {
      const face = b.faces().get(i);
      (face as unknown as { setMesh(mesh: Mesh, type: unknown): boolean }).setMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), rhino.MeshType.Render);
    }
    f.objects().addBrep(b, attrs({ name: "Meshed" }));
  }),
  rhino,
);
check(
  partNamed(full, "Meshed").length === 1 && partNamed(full, "Meshed")[0].faces.length === 6 && skipped(full, SKIP_NO_MESH) === 0,
  "a Brep with every face meshed: six faces, nothing counted",
);

const extrusion = rhino.Extrusion.create(rhino.ArcCurve.createFromCircle(new rhino.Circle([0, 0, 0], 5)), 10, true);
check(!!extrusion && !extrusion.getMesh(rhino.MeshType.Any), "premise: a fresh extrusion has no render mesh");
const ext = parse3dm(fileWith((f) => f.objects().addExtrusion(extrusion, attrs({ name: "Cyl" }))), rhino);
check(partNamed(ext, "Cyl").length === 0 && skipped(ext, SKIP_NO_MESH) === 1, "an extrusion with no render mesh: counted, no part");

// ---- symbols as blocks ----------------------------------------------------------------------------------

{
  const bytes = export3dm(SYMBOL_MODEL, [], new Map([["ground", "Ground"]]), rhino);
  const f = rhino.File3dm.fromByteArray(bytes);
  const defs = f.instanceDefinitions();
  const names = Array.from({ length: defs.count }, (_, i) => defs.get(i).name);
  check(names.join() === "Leg,Chair", `symbols: each definition written once as a block (${names})`);
  let refs = 0;
  for (let i = 0; i < f.objects().count; i++) {
    const o = f.objects().get(i);
    if (o.geometry() instanceof rhino.InstanceReference && !o.attributes().isInstanceDefinitionObject) refs++;
  }
  check(refs === 2, `symbols: the two Chairs written as block instances (${refs})`);
  checkSymbolTrip("3DM", parse3dm(bytes, rhino), check);
}

// ---- blocks --------------------------------------------------------------------------------------------

/** A block instance of definition `id`, through `xf`, as rhino3dm's InstanceReference takes it. */
function instanceOf(id: string, xf: Transform): InstanceReference {
  return new (rhino.InstanceReference as unknown as new (id: string, xf: Transform) => InstanceReference)(id, xf);
}

const blockFile = fileWith((f) => {
  const pin = new rhino.ObjectAttributes();
  pin.name = "member";
  pin.colorSource = rhino.ObjectColorSource.ColorFromParent;
  const pinIdx = f.instanceDefinitions().add("Pin", "", "", "", [0, 0, 0], [meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]])], [pin]);
  const pinDef = f.instanceDefinitions().get(pinIdx);
  const placed = instanceOf(pinDef.id, rhino.Transform.translationXYZ(100, 200, 0));
  const instance = new rhino.ObjectAttributes();
  instance.colorSource = rhino.ObjectColorSource.ColorFromObject;
  instance.objectColor = { r: 255, g: 136, b: 0, a: 255 };
  f.objects().addInstanceObject(placed, instance);

  // the same member, turned over by a mirror in x
  const mirrorIdx = f.instanceDefinitions().add("Mirror", "", "", "", [0, 0, 0], [meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]])], [attrs({ name: "member" })]);
  const mirrored = instanceOf(f.instanceDefinitions().get(mirrorIdx).id, rhino.Transform.mirror([0, 0, 0], [1, 0, 0]));
  f.objects().addInstanceObject(mirrored, new rhino.ObjectAttributes());
});
const blocks = parse3dm(blockFile, rhino);
const members = partNamed(blocks, "member");
check(members.length === 2, "blocks: each instance's member is a part (the definition itself is not drawn)");
const moved = members.find((p) => p.faces.length === 1 && near(p.faces[0][0], 100));
check(!!moved && samePts(moved.faces[0], [100, 200, 0, 101, 200, 0, 100, 201, 0]), "blocks: the member is placed by its instance's transform");
check(
  !!moved && moved.color !== undefined && near(moved.color.r, 1) && near(moved.color.g, 136 / 255) && near(moved.color.b, 0),
  "blocks: the member takes its instance's colour",
);
const turned = members.find((p) => p !== moved);
check(!!turned && samePts(turned.faces[0], [0, 1, 0, -1, 0, 0, 0, 0, 0]), "a mirrored block: mirrored in x, its faces turned over");

/** A file of `n` block definitions, each holding the next, the last holding a mesh; the top instance is the first. */
function chainFile(n: number): Uint8Array {
  return fileWith((f) => {
    const noAttrs = new rhino.ObjectAttributes();
    let inner: string | null = null;
    for (let i = n; i >= 1; i--) {
      const geometry = inner === null ? [meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]])] : [instanceOf(inner, rhino.Transform.identity())];
      const at = new rhino.ObjectAttributes();
      at.name = i === n ? "deep" : `level ${i}`;
      const idx = f.instanceDefinitions().add(`Level ${i}`, "", "", "", [0, 0, 0], geometry, [at]);
      inner = f.instanceDefinitions().get(idx).id;
    }
    f.objects().addInstanceObject(instanceOf(inner ?? "", rhino.Transform.identity()), noAttrs);
  });
}
const eight = parse3dm(chainFile(8), rhino);
check(partNamed(eight, "deep").length === 1 && skipped(eight, "nested block") === 0, "blocks eight deep: read");
const nine = parse3dm(chainFile(9), rhino);
check(partNamed(nine, "deep").length === 0 && skipped(nine, "nested block") === 1, "blocks nine deep: the innermost left out and counted");

// ---- hidden things, colours from layers and materials --------------------------------------------------

const hiddenFile = fileWith((f) => {
  const off = new rhino.Layer();
  off.name = "Off";
  off.visible = false;
  const offIdx = f.layers().add(off);
  const offId = f.layers().get(offIdx).id;
  const child = new rhino.Layer();
  child.name = "Child";
  child.parentLayerId = offId;
  const childIdx = f.layers().add(child);

  const red = new rhino.Layer();
  red.name = "Red";
  red.color = { r: 255, g: 0, b: 0, a: 255 };
  const redIdx = f.layers().add(red);

  f.objects().addMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), attrs({ name: "On Off", layerIndex: offIdx }));
  f.objects().addMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), attrs({ name: "On Child", layerIndex: childIdx }));
  const invisible = attrs({ name: "Invisible", layerIndex: redIdx });
  invisible.visible = false;
  f.objects().addMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), invisible);

  // coloured by its layer
  const byLayer = attrs({ name: "Layer coloured", layerIndex: redIdx });
  byLayer.colorSource = rhino.ObjectColorSource.ColorFromLayer;
  f.objects().addMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), byLayer);

  // coloured by a material
  const mat = new rhino.Material();
  (mat as unknown as { diffuseColor: unknown }).diffuseColor = { r: 0, g: 128, b: 255, a: 255 };
  f.materials().add(mat);
  const byMaterial = attrs({ name: "Material coloured", layerIndex: redIdx });
  byMaterial.colorSource = rhino.ObjectColorSource.ColorFromMaterial;
  byMaterial.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
  byMaterial.materialIndex = 0;
  f.objects().addMesh(meshOf([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]), byMaterial);
});
const hidden = parse3dm(hiddenFile, rhino);
check(
  partNamed(hidden, "On Off").length === 0 && partNamed(hidden, "On Child").length === 0 && partNamed(hidden, "Invisible").length === 0,
  "hidden layers, a child of a hidden layer, and a hidden object are left out",
);
check(skipped(hidden, "hidden object") === 3, "hidden: three objects counted as hidden");
const byLayerPart = partNamed(hidden, "Layer coloured")[0];
check(!!byLayerPart && byLayerPart.color !== undefined && near(byLayerPart.color.r, 1) && near(byLayerPart.color.g, 0), "colour from layer: the layer's red");
check(!!byLayerPart && byLayerPart.group === "Red", "layer path as group: the layer's name");
const byMaterialPart = partNamed(hidden, "Material coloured")[0];
check(
  !!byMaterialPart && byMaterialPart.color !== undefined && near(byMaterialPart.color.b, 1) && near(byMaterialPart.color.g, 128 / 255, 1e-2),
  "colour from material: its diffuse blue",
);

// ---- the face cap ----------------------------------------------------------------------------------------

const many: number[][][] = [];
for (let i = 0; i <= MAX_FACES; i++) many.push([[i, 0, 0], [i, 1, 0], [i, 0, 1]]);
let capped = "";
try {
  parse3dm(fileWith((f) => f.objects().addMesh(meshOf(many), attrs({ name: "Many" }))), rhino);
} catch (e) {
  capped = e instanceof Error ? e.message : String(e);
}
check(capped === tooMany().message, `a mesh over the face cap is refused with the mesh reader's message (${capped})`);

// ---- not a 3DM file ------------------------------------------------------------------------------------

let refused = "";
try {
  parse3dm(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), rhino);
} catch (e) {
  refused = e instanceof Error ? e.message : String(e);
}
check(refused === "it isn't a Rhino 3DM file", "bytes that aren't a 3DM file are refused");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
