// Checks writing a building model into a drawing under Node, whatever file it came from. Run from web/:
//   npx tsx src/app/buildingWrite.check.ts
// A hand-made model (two storeys, a wall with a door in it, a floor, a two-colour object, 2D with its
// own pens, a category hidden in its file, properties of each kind) written into a blank drawing,
// saved and opened again: the stories and layers, the wall's heights above its layer and the door's
// opening cut through it, the floor's foot, the object as a group of meshes in its exact colours, a
// single-colour one as a mesh, the 2D's pens, the hidden class and the records, with areas in m².
// A wall a window fills whole stands uncut, with its records, rather than be lost.
// Three chairs of one type, one turned and one mirrored though their file says neither, their faces
// cut into triangles each its own way and one's origin a little out, as one symbol placed three
// times where each stood, with its own records; a lone one of another type as a mesh.
// Revit's own import is checked by import/rvtBuilding.check.ts.

import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import type { BuildingModel } from "../import/building.ts";
import { writeBuilding } from "./buildingWrite.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number | undefined, b: number, slack = 0.5): boolean => a !== undefined && Math.abs(a - b) <= slack;

/** a box's faces, mm */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
  const q = (...p: number[][]): number[] => p.flat();
  return [
    q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]),
    q([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]),
    q([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]),
    q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]),
    q([x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]),
    q([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]),
  ];
}

/** a chair (seat, back, an arm on its left) standing at `at`, turned and maybe mirrored, its quads cut into triangles one way or the other */
function chair(at: { x: number; y: number; z: number }, turn: number, mirror: boolean, diagonal: boolean): number[][] {
  const [c, n, m] = [Math.cos(turn), Math.sin(turn), mirror ? -1 : 1];
  const quads = [...box(0, 0, 0, 500, 500, 450), ...box(0, 450, 450, 500, 500, 900), ...box(0, 0, 450, 50, 450, 650)];
  return quads.flatMap((q) => {
    const p = [0, 1, 2, 3].map((i) => {
      const [x, y, z] = [m * q[3 * i], q[3 * i + 1], q[3 * i + 2]];
      return [at.x + x * c - y * n, at.y + x * n + y * c, at.z + z];
    });
    const tris = diagonal ? [[p[0], p[1], p[3]], [p[1], p[2], p[3]]] : [[p[0], p[1], p[2]], [p[0], p[2], p[3]]];
    return tris.map((t) => (mirror ? t.reverse() : t).flat());
  });
}

const base = { name: "", type: "", properties: {} };
const mark = (value: string) => ({ Identity: [{ name: "Mark", kind: "text" as const, value }] });
const oak = { r: 0.6, g: 0.4, b: 0.2 };
const model: BuildingModel = {
  name: "Check",
  units: "mm",
  storeys: [
    { name: "Ground", elevation: 0 },
    { name: "First", elevation: 3000 },
  ],
  categories: [{ name: "Walls" }, { name: "Slabs", color: { r: 0.8, g: 0.8, b: 0.8 } }, { name: "Furniture" }, { name: "Annotation", hidden: true }],
  materials: [],
  walls: [
    {
      ...base,
      storey: 1,
      category: 0,
      start: { x: 0, y: 0 },
      end: { x: 5000, y: 0 },
      thickness: 200,
      bottom: 3100,
      height: 2700,
      properties: {
        Wall: [
          { name: "Mark", kind: "text", value: "W1" },
          { name: "Area", kind: "area", value: 13.5e6 },
          { name: "External", kind: "boolean", value: true },
        ],
      },
    },
    // a wall that only holds a window wider than itself
    { ...base, storey: 0, category: 0, start: { x: 0, y: 6000 }, end: { x: 2000, y: 6000 }, thickness: 100, bottom: 0, height: 2500, properties: { Wall: [{ name: "Mark", kind: "text", value: "W2" }] } },
  ],
  slabs: [
    {
      ...base,
      storey: 0,
      category: 1,
      outline: [
        { x: 0, y: 0 },
        { x: 5000, y: 0 },
        { x: 5000, y: 4000 },
        { x: 0, y: 4000 },
      ],
      bottom: -250,
      thickness: 250,
    },
  ],
  openings: [
    { ...base, storey: 1, category: 0, kind: "door", wall: 0, at: { x: 2500, y: 0 }, width: 1000, height: 2100, sill: 3100, bodies: [{ faces: box(2000, -40, 3100, 3000, 40, 5200) }] },
    { ...base, storey: 0, category: 0, kind: "window", wall: 1, at: { x: 1000, y: 6000 }, width: 2400, height: 2500, sill: 0, bodies: [{ faces: box(-200, 5950, 0, 2200, 6050, 2500), box: true }] },
  ],
  objects: [
    { ...base, storey: 0, category: 2, bodies: [{ faces: box(1000, 1000, 0, 2000, 1500, 750), color: { r: 0.5, g: 0.3, b: 0.1 } }, { faces: box(1000, 1000, 750, 2000, 1500, 780), color: { r: 0.9, g: 0.9, b: 0.9 } }] },
    { ...base, storey: 1, category: 2, bodies: [{ faces: box(3000, 1000, 3000, 3500, 1500, 3450), box: true }] },
    // the reader knows where each stands, roughly, but not how it is turned or flipped
    { ...base, storey: 0, category: 2, properties: mark("C1"), typeKey: "Chair: Plain", placement: { at: { x: 1000, y: 2500, z: 0 }, turn: 0 }, bodies: [{ faces: chair({ x: 1000, y: 2500, z: 0 }, 0, false, false), color: oak }] },
    { ...base, storey: 0, category: 2, properties: mark("C2"), typeKey: "Chair: Plain", placement: { at: { x: 3030, y: 2480, z: 0 }, turn: 0 }, bodies: [{ faces: chair({ x: 3000, y: 2500, z: 0 }, Math.PI / 2, false, true), color: oak }] },
    { ...base, storey: 1, category: 2, properties: mark("C3"), typeKey: "Chair: Plain", placement: { at: { x: 4000, y: 3500, z: 3000 }, turn: 0 }, bodies: [{ faces: chair({ x: 4000, y: 3500, z: 3000 }, 0, true, false), color: oak }] },
    { ...base, storey: 0, category: 2, typeKey: "Chair: Tall", placement: { at: { x: 1000, y: 3500, z: 0 }, turn: 0 }, bodies: [{ faces: chair({ x: 1000, y: 3500, z: 0 }, 0, false, false), color: oak }] },
  ],
  drawing: [
    { storey: 0, category: 3, shape: { kind: "line", a: { x: 0, y: -500 }, b: { x: 5000, y: -500 } }, attrs: { lineWeight: 35 } },
    { storey: 0, category: 3, shape: { kind: "text", at: { x: 2500, y: -800 }, text: "Ground", height: 250 } },
    // a shape that can't be made costs only itself
    { storey: 0, category: 3, shape: { kind: "polygon", points: [], closed: true } },
  ],
  skipped: {},
  notes: [],
};

const s = openVwx(blankDrawing("mm"));
const written = writeBuilding(s, model);
check(written.walls === 2 && written.slabs === 1 && written.objects === 6 && written.symbols === 1 && written.drawing === 2, `everything is made (${JSON.stringify({ ...written, layers: written.layers.length })})`);
check(JSON.stringify(written.failed) === '{"2D objects":1}', "but the shape that can't be, alone");

const doc = openVwx(s.doc.toBytes()).doc;
const stories = doc.stories();
check(stories.length === 2 && near(stories.find((st) => st.name === "First")?.elevation, 3000), "a story per storey");
const layers = doc.layers().filter((l) => l.kind === "design");
check(layers.length === 2 && layers.every((l) => l.story !== null), `a layer per storey, on its story (${layers.map((l) => `${l.name} ${l.elevation}`).join(", ")})`);
const ground = layers.find((l) => near(l.elevation, 0));
const first = layers.find((l) => near(l.elevation, 3000));
const tops = (id?: string) => (id ? doc.objects(id).filter((o) => !o.parentId) : []);

const wall = tops(first?.id).find((o) => o.typeName === "wall");
check(!!wall, "the wall is a wall on the first storey's layer");
const fields = Object.fromEntries((wall ? doc.records(wall.id) : []).flatMap((r) => r.fields.map((f) => [f.name, f.value])));
// faces: two sides less the door, top, bottom less the door, ends, and the opening's jambs and head
const wallArea = 2 * (5000 * 2700 - 1000 * 2100) + 4000 * 200 + 5000 * 200 + 2 * 2700 * 200 + (2 * 2100 + 1000) * 200;
let faces = 0;
for (const m of doc.model3d().filter((m) => m.objectId === wall?.id))
  for (let i = 0; i + 8 < m.triangles.length; i += 9) {
    const t = Array.from(m.triangles.subarray(i, i + 9));
    const [ux, uy, uz, vx, vy, vz] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    faces += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
check(near(faces, wallArea, wallArea * 1e-6), `the door's opening is cut through its wall (${(faces / 1e6).toFixed(3)} m², want ${(wallArea / 1e6).toFixed(3)})`);
// the door: the mesh whose 3D spans the opening's middle
const spans = (id: string): boolean =>
  doc.model3d().some((m) => {
    if (m.objectId !== id) return false;
    const xs = m.triangles.filter((_, i) => i % 3 === 0);
    return Math.min(...xs) < 2500 && Math.max(...xs) > 2500;
  });
const door = tops(first?.id).find((o) => o.typeName === "mesh" && spans(o.id));
check(written.openings === 2 && !!door, `the door stands in it (${written.openings})`);
const filled = tops(ground?.id).find((o) => o.typeName === "wall");
const filledMark = filled ? doc.records(filled.id).flatMap((r) => r.fields).find((f) => f.name === "Mark")?.value : undefined;
let filledArea = 0;
for (const m of doc.model3d().filter((m) => m.objectId === filled?.id))
  for (let i = 0; i + 8 < m.triangles.length; i += 9) {
    const t = Array.from(m.triangles.subarray(i, i + 9));
    const [ux, uy, uz, vx, vy, vz] = [t[3] - t[0], t[4] - t[1], t[5] - t[2], t[6] - t[0], t[7] - t[1], t[8] - t[2]];
    filledArea += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
const uncut = 2 * 2000 * 2500 + 2 * 2000 * 100 + 2 * 2500 * 100;
check(filledMark === "W2" && near(filledArea, uncut, uncut * 1e-6), `a wall its window fills whole stands uncut, with its records (${filledMark}, ${(filledArea / 1e6).toFixed(3)} m², want ${(uncut / 1e6).toFixed(3)})`);
check(fields.Mark === "W1" && near(fields["Area (m²)"] as number, 13.5, 0.001) && fields.External === true, `its properties are records, the area in m² (${JSON.stringify(fields)})`);

const groundKinds = tops(ground?.id).map((o) => o.typeName);
check(groundKinds.includes("extrude"), `the floor is an extrude (${groundKinds.join(", ")})`);
const table = tops(ground?.id).find((o) => o.typeName === "group");
check(!!table && doc.objects(ground!.id).filter((o) => o.parentId === table.id && o.typeName === "mesh").length === 2, "a two-colour object is a group of two meshes");
const legs = table ? doc.objects(ground!.id).find((o) => o.parentId === table.id && o.typeName === "mesh") : undefined;
const legColour = legs?.attrs ? doc.color(legs.attrs.fillBack) : "";
check(legColour.toLowerCase().startsWith("#804d1a"), `a body's colour is exact, added to the drawing's colours where it has none so (${legColour})`);
const stool = tops(first?.id).find((o) => o.typeName === "mesh" && o !== door);
check(!!stool && stool.attrs?.fillOpacity === 35, `a body that is only a box is a mesh, see-through (${stool?.attrs?.fillOpacity})`);

// the chairs: one symbol, an instance where each stood, with its records
const chairs = model.objects.filter((o) => o.typeKey === "Chair: Plain");
const defs = doc.symbolDefs().filter((d) => d.name.startsWith("Chair"));
check(defs.length === 1 && defs[0].name === "Chair: Plain", `the three chairs are one symbol, the lone one none (${defs.map((d) => d.name).join(", ")})`);
const instances = [ground, first].flatMap((l) => tops(l?.id).filter((o) => o.typeName === "symbol"));
/** the box round faces, or round an object's 3D */
const boxOf = (points: Iterable<number>): number[] => {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let i = 0;
  for (const v of points) {
    b[i % 3] = Math.min(b[i % 3], v);
    b[3 + (i % 3)] = Math.max(b[3 + (i % 3)], v);
    i++;
  }
  return b;
};
const shown = (id: string) => boxOf(doc.model3d().flatMap((m) => (m.objectId === id ? Array.from(m.triangles) : [])));
const marks = chairs.map((c) => {
  const want = boxOf(c.bodies[0].faces.flat());
  const at = instances.find((o) => shown(o.id).every((v, i) => near(v, want[i], 1)));
  return at ? (doc.records(at.id).flatMap((r) => r.fields).find((f) => f.name === "Mark")?.value ?? "no mark") : "missing";
});
check(instances.length === 3 && marks.join() === "C1,C2,C3", `placed where each stood, turned, flipped and up a storey, each with its own records (${instances.length}: ${marks.join(", ")})`);
const chairArea = (faces: number[][]) => faces.reduce((sum, t) => sum + Math.hypot(...[0, 1, 2].map((i) => { const [u, v] = [[t[3] - t[0], t[4] - t[1], t[5] - t[2]], [t[6] - t[0], t[7] - t[1], t[8] - t[2]]]; return u[(i + 1) % 3] * v[(i + 2) % 3] - u[(i + 2) % 3] * v[(i + 1) % 3]; })) / 2, 0);
const tri = (id: string) => doc.model3d().filter((m) => m.objectId === id).flatMap((m) => { const t = Array.from(m.triangles); return Array.from({ length: t.length / 9 }, (_, k) => t.slice(9 * k, 9 * k + 9)); });
check(instances.every((o) => near(chairArea(tri(o.id)), chairArea(chairs[0].bodies[0].faces), 1)), "each whole");
const lone = tops(ground?.id).find((o) => o.typeName === "mesh" && shown(o.id).every((v, i) => near(v, boxOf(model.objects[5].bodies[0].faces.flat())[i], 1)));
check(!!lone, "the lone one a mesh where it stood");

const line = tops(ground?.id).find((o) => o.typeName === "line");
check(!!line && line.attrs?.lineWeight === 35 && line.className === "Annotation", `2D keeps its own pen in its class (${line?.attrs?.lineWeight}, ${line?.className})`);
const annotation = doc.classes().find((c) => c.name === "Annotation");
check(annotation?.visibility === "hidden", `a category hidden in its file is a hidden class (${annotation?.visibility})`);
check(doc.classes().find((c) => c.name === "Walls")?.visibility === "visible", "the others stay visible");

// floors of one storey made together: each extrude keeps its own thickness, foot and records
{
  const slab = (x: number, bottom: number, thickness: number, mark: string) => ({
    ...base,
    storey: 1,
    category: 1,
    outline: [
      { x, y: 0 },
      { x: x + 1000, y: 0 },
      { x: x + 1000, y: 1000 },
      { x, y: 1000 },
    ],
    bottom,
    thickness,
    properties: { Floor: [{ name: "Mark", kind: "text" as const, value: mark }] },
  });
  const floors: BuildingModel = { ...model, walls: [], objects: [], drawing: [], slabs: [slab(0, 2800, 200, "F1"), slab(2000, 3000, 300, "F2"), slab(4000, 2800, 300, "F3")] };
  const t = openVwx(blankDrawing("mm"));
  const made = writeBuilding(t, floors);
  check(made.slabs === 3 && !Object.keys(made.failed).length, `three floors on a storey are made together (${made.slabs}, ${JSON.stringify(made.failed)})`);
  const again = openVwx(t.doc.toBytes());
  const firstLayer = again.doc.layers().find((l) => l.kind === "design" && near(l.elevation, 3000));
  const extrudes = firstLayer ? again.doc.objects(firstLayer.id).filter((o) => !o.parentId && o.typeName === "extrude") : [];
  const seen = extrudes.map((o) => {
    const ms = again.doc.model3d().filter((m) => m.objectId === o.id);
    const zs = ms.flatMap((m) => [...m.triangles].filter((_, i) => i % 3 === 2));
    const xs = ms.flatMap((m) => [...m.triangles].filter((_, i) => i % 3 === 0));
    const mark = again.doc.records(o.id).flatMap((r) => r.fields).find((f) => f.name === "Mark")?.value;
    return { x: Math.min(...xs), lo: Math.min(...zs), hi: Math.max(...zs), mark };
  });
  const at = (x: number) => seen.find((e) => near(e.x, x));
  check(
    seen.length === 3 && near(at(0)?.lo, 2800) && near(at(0)?.hi, 3000) && near(at(2000)?.lo, 3000) && near(at(2000)?.hi, 3300) && near(at(4000)?.lo, 2800) && near(at(4000)?.hi, 3100),
    `each floor stands at its foot and thickness (${JSON.stringify(seen.map(({ x, lo, hi }) => [x, lo, hi]))})`,
  );
  check(at(0)?.mark === "F1" && at(2000)?.mark === "F2" && at(4000)?.mark === "F3", `each floor carries its own records (${seen.map((e) => e.mark).join(", ")})`);
}

// a floor that can't be made in a storey's group costs only itself
{
  const good = model.slabs[0];
  const floors: BuildingModel = { ...model, walls: [], objects: [], drawing: [], slabs: [good, { ...good, outline: [] }, { ...good, outline: good.outline.map((p) => ({ x: p.x + 6000, y: p.y })) }] };
  const t = openVwx(blankDrawing("mm"));
  const made = writeBuilding(t, floors);
  const extrudes = t.doc.layers().flatMap((l) => t.doc.objects(l.id)).filter((o) => !o.parentId && o.typeName === "extrude");
  check(made.slabs === 2 && made.failed.floors === 1 && extrudes.length === 2, `a bad floor in a group costs only itself (${made.slabs} made, ${JSON.stringify(made.failed)}, ${extrudes.length} extrudes)`);
}

console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
