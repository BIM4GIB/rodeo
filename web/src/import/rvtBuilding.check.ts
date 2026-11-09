// Checks the Revit model import under Node. Run from web/:
//   npx tsx src/import/rvtBuilding.check.ts
// A model made here as rvt-rs gives one (two levels; a wall by its centreline with layers, a
// door in it and a hole its edited profile cuts, one by its box only, a floor by its outline, a room, a table; parameters of each kind
// and an IFC property set), drawn by rvt-rs's own glTF, becomes the building model expected: walls
// along their lines, the door on its wall, the profile's hole in the wall's elevation, the floor's outline, the room's outline and name, the
// parameters in mm, m², degrees. Written into a blank drawing, saved and opened again, it holds a
// story and layer per level, a wall, extrude, mesh, polygon and text where each should be, and
// every element's parameters as records. With RVT_SAMPLES set to a folder of Revit projects (Autodesk's
// samples, fetched from revit.downloads.autodesk.com, never kept in this repository), each opens
// as a drawing with as many stories as levels, walls, every element made and its records attached.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as rvt from "../../vendor/rvt-rs/rvt.js";
import { revitDrawing } from "../app/revitImport.ts";
import { openVwx } from "../core/index.ts";
import type { BuildingModel } from "./building.ts";
import { entourage, revitBuilding, standInCar, standInPerson } from "./rvtBuilding.ts";
import { readWith, type RvtEntity, type RvtModel } from "./rvtModel.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number | undefined, b: number, slack = 0.5): boolean => a !== undefined && Math.abs(a - b) <= slack;

rvt.initSync({ module: readFileSync(new URL("../../vendor/rvt-rs/rvt_bg.wasm", import.meta.url)) });

// ---- a model as rvt-rs reads one ------------------------------------------------------------------

const FT = 304.8;
const text = (name: string, value: string) => ({ name, value: { kind: "Text", value } });
const ents: RvtEntity[] = [
  // 0: a 200 mm wall by its centreline, 20 ft from (0, 0) east, two layers, 10 ft high
  {
    kind: "BuildingElement",
    ifc_type: "IFCWALL",
    name: "Basic Wall:Generic - 200mm:1001",
    storey_index: 0,
    location_feet: [10, 0, 0],
    rotation_radians: 0,
    extrusion: { width_feet: 20, depth_feet: 200 / FT, height_feet: 10 },
    material_layer_set_index: 0,
    property_set: {
      name: "Revit",
      properties: [
        text("BodySource", "partition_wall_centreline"),
        { name: "Thickness", value: { kind: "LengthFeet", value: 200 / FT } },
        text("Comments", "North wall"),
        { name: "Area", value: { kind: "AreaSquareFeet", value: 200 } },
        { name: "Volume", value: { kind: "VolumeCubicFeet", value: 100 } },
        { name: "Slope", value: { kind: "AngleRadians", value: Math.PI / 2 } },
        { name: "Layers", value: { kind: "CountValue", value: 2 } },
        { name: "Structural", value: { kind: "Boolean", value: false } },
      ],
    },
  },
  // 1: a wall known only by its box, 0.5 ft thick, running 12 ft north from (0, 0)
  {
    kind: "BuildingElement",
    ifc_type: "IFCWALL",
    name: "Basic Wall:Generic - 6\":1002",
    storey_index: 0,
    location_feet: [0, 6, 0],
    extrusion: { width_feet: 0.5, depth_feet: 12, height_feet: 10 },
    property_set: { name: "Revit", properties: [text("BodySource", "partition_element_record_bbox")] },
  },
  // 2: a floor 1 ft thick under the walls, by its outline
  {
    kind: "BuildingElement",
    ifc_type: "IFCSLAB",
    name: "Floor:Generic 300mm:1003",
    storey_index: 0,
    location_feet: [10, 6, -1],
    extrusion: {
      width_feet: 20,
      depth_feet: 12,
      height_feet: 1,
      profile_override: {
        ArbitraryClosed: {
          points: [
            [-10, -6],
            [10, -6],
            [10, 6],
            [-10, 6],
          ],
        },
      },
    },
  },
  // 3: a 3 ft door in wall 0, 5 ft along it
  {
    kind: "BuildingElement",
    ifc_type: "IFCDOOR",
    name: "Single-Flush:36\" x 84\":1004",
    storey_index: 0,
    host_element_index: 0,
    location_feet: [5, 0.05, 0],
    extrusion: { width_feet: 3, depth_feet: 0.4, height_feet: 7 },
  },
  // 4: a room, an L in plan, named by its IFC property set
  {
    kind: "BuildingElement",
    ifc_type: "IFCSPACE",
    name: "Room-1005",
    storey_index: 0,
    location_feet: [10, 6, 0],
    extrusion: {
      width_feet: 20,
      depth_feet: 12,
      height_feet: 9,
      profile_override: {
        ArbitraryClosed: {
          points: [
            [-10, -6],
            [10, -6],
            [10, 0],
            [0, 0],
            [0, 6],
            [-10, 6],
          ],
        },
      },
    },
  },
  // 5: a table on the upper level
  {
    kind: "BuildingElement",
    ifc_type: "IFCFURNITURE",
    name: "Table:1500 x 900mm:1006",
    storey_index: 1,
    location_feet: [8, 4, 10],
    extrusion: { width_feet: 5, depth_feet: 3, height_feet: 2.5 },
  },
  { kind: "ElementPropertySet", element: 0, set: { name: "Pset_WallCommon", properties: [{ name: "IsExternal", value: { kind: "Boolean", value: true } }] } },
  { kind: "ElementPropertySet", element: 4, set: { name: "Pset_SpaceCommon", properties: [{ name: "Reference", value: { kind: "Identifier", value: "Office 101" } }] } },
  { kind: "ElementPropertySet", element: 0, set: { name: "Constraints", properties: [{ name: "Base Constraint", value: { kind: "Label", value: "Level 1" } }] } },
  // the north wall's edited profile: a hole 2 ft wide and high, 6 to 8 ft from its middle along an
  // axis turned to run west, 7 ft up
  {
    kind: "WallProfileOpening",
    host: 0,
    tag: "1001",
    name: "Basic Wall:Generic - 200mm:1001",
    outline_feet: [
      [-6, 7],
      [-8, 7],
      [-8, 9],
      [-6, 9],
    ],
    axis_turn_radians: Math.PI,
    plane_offset_feet: 0,
    thickness_feet: 200 / FT,
  },
];
const model = {
  entities: ents,
  classifications: [],
  units: [],
  // out of order, as a file may list them
  building_storeys: [
    { name: "Level 2", elevation_feet: 10 },
    { name: "Level 1", elevation_feet: 0 },
  ],
  materials: [
    { name: "Brick", color_packed: 0x3050a0 },
    { name: "Plaster", color_packed: 0xf0f0f0 },
  ],
  material_layer_sets: [
    {
      name: "Generic - 200mm",
      layers: [
        { material_index: 0, thickness_feet: 150 / FT },
        { material_index: 1, thickness_feet: 50 / FT },
      ],
    },
  ],
  material_profile_sets: [],
  representation_maps: [],
} as unknown as RvtModel;
// the levels as the file lists them, so the elements' storey_index follows that order
ents.forEach((e) => {
  if (e.storey_index === 0) e.storey_index = 1;
  else if (e.storey_index === 1) e.storey_index = 0;
});

const glb = rvt.modelToGlb(model);
const m: BuildingModel = revitBuilding({ model, diagnostics: {}, glb }, "Test House.rvt");

check(m.name === "Test House", `the project takes the file's name when it has none of its own (${m.name})`);
check(m.units === "mm", `types sized in mm make a metric drawing (${m.units})`);
check(m.storeys.length === 2 && m.storeys[0].name === "Level 1" && near(m.storeys[1].elevation, 3048), `levels lowest first, in mm (${JSON.stringify(m.storeys)})`);

check(m.walls.length === 2, `both walls are walls (${m.walls.length})`);
const [north, west] = m.walls;
check(
  !!north && near(north.start.x, 0) && near(north.start.y, 0) && near(north.end.x, 6096) && near(north.end.y, 0) && near(north.thickness, 200) && near(north.height, 3048) && north.storey === 0,
  `the centreline wall runs (0, 0) to (6096, 0), 200 thick and 3048 high (${JSON.stringify(north && { s: north.start, e: north.end, t: north.thickness, h: north.height })})`,
);
const hole = north?.cutOuts?.[0] ?? [];
const [hx, hy] = [hole.map((p) => p.x), hole.map((p) => p.y)];
check(
  north?.cutOuts?.length === 1 && near(Math.min(...hx), 4876.8) && near(Math.max(...hx), 5486.4) && near(Math.min(...hy), 2133.6) && near(Math.max(...hy), 2743.2),
  `its profile's hole lies along it from its start, up from its foot (${JSON.stringify(hole)})`,
);
check(north?.components?.length === 2 && near(north.components[0].thickness, 150) && north.components[0].material === 0, "its layers are its components, outside first");
check(!!west && near(west.start.x, 0) && near(west.start.y, 0) && near(west.end.y, 3657.6) && near(west.thickness, 152.4), `the box wall runs along its long side (${JSON.stringify(west && { s: west.start, e: west.end, t: west.thickness })})`);

check(m.slabs.length === 1 && m.slabs[0].outline.length === 4 && near(m.slabs[0].bottom, -304.8) && near(m.slabs[0].thickness, 304.8), "the floor is a slab of its outline, 1 ft thick, under the level");
check(!!m.slabs[0] && near(m.slabs[0].outline[2].x, 6096) && near(m.slabs[0].outline[2].y, 3657.6), "its outline is placed at its location");

const door = m.openings[0];
check(m.openings.length === 1 && door.kind === "door" && door.wall === 0, "the door is set in its wall");
check(!!door && near(door.at.y, 0) && near(door.at.x, 1524) && near(door.width, 914.4, 1) && near(door.height, 2133.6), `on the wall's line, 3 ft wide (${JSON.stringify(door && { at: door.at, w: door.width })})`);
check((door?.bodies.length ?? 0) > 0, "and drawn by its own body");

check(m.objects.length === 1 && m.objects[0].storey === 1 && m.categories[m.objects[0].category].name === "Furniture", "the table is an object of Furniture on Level 2");
const room = m.drawing.find((d) => d.shape.kind === "polygon");
const label = m.drawing.find((d) => d.shape.kind === "text");
check(room?.shape.kind === "polygon" && room.shape.points.length === 6, "the room is its L-shaped outline, not its box");
check(label?.shape.kind === "text" && label.shape.text === "Office 101", "and its name");

const props = north?.properties ?? {};
const revit = Object.fromEntries((props.Revit ?? []).map((p) => [p.name, p]));
check(revit.Family?.value === "Basic Wall" && revit.Type?.value === "Generic - 200mm" && revit["Element ID"]?.value === 1001, "Family, Type and Element ID come from the element's name");
check(revit.Comments?.value === "North wall" && !("BodySource" in revit), "parameters are kept and rvt-rs's reading notes left out");
check(revit.Thickness?.kind === "length" && near(revit.Thickness.value as number, 200), "a length is mm");
check(revit.Area?.kind === "area" && near(revit.Area.value as number, 200 * FT * FT, 1), "an area is mm²");
check(revit.Volume?.kind === "volume" && near(revit.Volume.value as number, 100 * FT ** 3, 10), "a volume is mm³");
check(revit.Slope?.kind === "angle" && near(revit.Slope.value as number, 90), "an angle is degrees");
check(revit.Layers?.kind === "integer" && revit.Structural?.value === false, "counts are whole numbers and yes/no stays yes/no");
check(props.Pset_WallCommon?.[0]?.value === true, "an IFC property set keeps its name");
check(props["Revit Constraints"]?.[0]?.value === "Level 1", "a Revit parameter group says it is Revit's");

// ---- into a drawing -----------------------------------------------------------------------------------

const made = revitDrawing({ model, diagnostics: {}, glb }, "Test House.rvt");
check(Object.keys(made.written.failed).length === 0, `every element is made (${JSON.stringify(made.written.failed)})`);
const doc = openVwx(made.bytes).doc;
const stories = doc.stories();
check(stories.length === 2 && near(stories.find((st) => st.name === "Level 2")?.elevation, 3048), `a story per level (${JSON.stringify(stories.map((s) => [s.name, s.elevation]))})`);
const layers = doc.layers().filter((l) => l.kind === "design");
check(layers.length === 2 && layers.every((l) => l.story !== null), `a design layer per level, on its story (${layers.map((l) => l.name).join(", ")})`);
const objects = layers.map((l) => doc.objects(l.id).filter((o) => !o.parentId));
const kinds = objects.map((list) => list.map((o) => o.typeName).sort());
check(kinds[0].filter((k) => k === "wall").length === 2, `Level 1 holds both walls (${kinds[0].join(", ")})`);
check(kinds[0].includes("extrude") && kinds[0].includes("text") && kinds[0].includes("polygon"), "the floor as an extrude, the room as a polygon and text");
check(kinds[1].length === 1, `Level 2 holds the table (${kinds[1].join(", ")})`);
const classes = new Set(doc.classes().map((c) => c.name));
check(["Walls", "Floors", "Doors", "Rooms", "Furniture"].every((c) => classes.has(c)), "a class per category");
const wall = objects[0].find((o) => o.typeName === "wall");
const records = wall ? doc.records(wall.id) : [];
const fields = Object.fromEntries(records.flatMap((r) => r.fields.map((f) => [f.name, f.value])));
check(fields.Family === "Basic Wall" && fields["Element ID"] === 1001 && fields.Comments === "North wall", `the wall's parameters are its records (${records.length} records)`);
check(near(fields["Area (m²)"] as number, 200 * 0.3048 ** 2, 0.001) && near(fields["Volume (m³)"] as number, 100 * 0.3048 ** 3, 0.001), "areas and volumes in m², m³");
check(fields.IsExternal === true, "with its IFC property set's");
const table = objects[1][0];
check(!!table && doc.records(table.id).some((r) => r.fields.some((f) => f.value === "Table")), "the table's records too");

// ---- RPC entourage --------------------------------------------------------------------------------

const box = (w: number, d: number, h: number) => ({ width_feet: w, depth_feet: d, height_feet: h });
check(
  entourage("RPC Tree - Deciduous:Red Maple - 30':1", box(25, 25, 30)) === "tree" &&
    entourage("M_RPC Shrub:Barberry:2", box(3, 3, 3)) === "tree" &&
    entourage("RPC Female:Cathy:3", box(2.2, 2.2, 5.75)) === "person" &&
    entourage("M_RPC Beetle:M_RPC Beetle:4", box(13.5, 6, 5)) === "vehicle" &&
    entourage("Entourage-5", box(13.5, 6, 5)) === "vehicle" &&
    entourage("Entourage-6", box(2.2, 2.2, 5.75)) === "person" &&
    entourage("Entourage-7", box(4, 4, 4)) === null &&
    entourage("Table:Round:8", box(4, 4, 2.5)) === null,
  "RPC trees, people and cars are told by their names, else their boxes' shape",
);
for (const [what, bodies, [w, d, h]] of [
  ["person", standInPerson(678, 678, 1753), [678, 678, 1753]],
  ["car", standInCar(4126, 1834, 1510), [4126, 1834, 1510]],
] as const) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies)
    for (const f of b.faces)
      for (let k = 0; k < f.length; k++) {
        lo[k % 3] = Math.min(lo[k % 3], f[k]);
        hi[k % 3] = Math.max(hi[k % 3], f[k]);
      }
  const inside = lo[0] >= -w / 2 - 1 && hi[0] <= w / 2 + 1 && lo[1] >= -d / 2 - 1 && hi[1] <= d / 2 + 1 && lo[2] >= -1 && hi[2] <= h + 1;
  const fills = near(lo[2], 0, 1) && near(hi[2], h, 1) && hi[0] - lo[0] > w * 0.5;
  check(inside && fills && bodies.every((b) => b.faces.every((f) => f.length >= 9 && f.length % 3 === 0)), `an RPC ${what} stands in its box, from its foot to its top (${lo.map(Math.round)} to ${hi.map(Math.round)})`);
}

// a stair drawn by its flight: the stair's own record, with no body, isn't a box drawn
{
  const record = (BodySource: string) => ({ name: "Revit", properties: [text("BodySource", BodySource)] });
  const stairs = {
    ...model,
    entities: [
      { kind: "BuildingElement", ifc_type: "IFCSTAIR", name: "Stair:Straight:2001", storey_index: 0, location_feet: [0, 0, 0], property_set: record("partition_element_record_bbox") },
      { kind: "BuildingElement", ifc_type: "IFCSTAIRFLIGHT", name: "Run:Straight:2002", storey_index: 0, location_feet: [0, 0, 0], extrusion: { width_feet: 3, depth_feet: 10, height_feet: 5 }, property_set: record("saved_graphics_mesh") },
      { kind: "BuildingElement", ifc_type: "IFCFURNITURE", name: "Chest:Low:2003", storey_index: 0, location_feet: [6, 0, 0], extrusion: { width_feet: 2, depth_feet: 2, height_feet: 3 }, property_set: record("partition_element_record_bbox") },
    ],
  } as unknown as RvtModel;
  const s = revitBuilding({ model: stairs, diagnostics: {}, glb: rvt.modelToGlb(stairs) }, "Stairs.rvt");
  const note = s.notes.find((n) => n.includes("bounding box"));
  check(note?.startsWith("1 element is drawn as its bounding box") === true, `a stair drawn by its flight isn't counted as a box, a chest known by its box is (${note})`);
}

// ---- Revit's own projects ----------------------------------------------------------------------------

const samples = process.env.RVT_SAMPLES;
if (samples) {
  const names = readdirSync(samples)
    .filter((n) => /\.rvt$/i.test(n))
    .sort();
  check(names.length > 0, `RVT_SAMPLES holds Revit projects (${names.length})`);
  for (const name of names) {
    const t0 = performance.now();
    try {
      const read = readWith(rvt, new Uint8Array(readFileSync(join(samples, name))));
      const t1 = performance.now();
      const d = revitDrawing(read, name);
      const t2 = performance.now();
      const back = openVwx(d.bytes).doc;
      const tops = back.layers().flatMap((l) => back.objects(l.id).filter((o) => !o.parentId));
      const walls = tops.filter((o) => o.typeName === "wall").length;
      const withRecords = tops.filter((o) => back.records(o.id).length > 0).length;
      const w = d.written;
      const elements = w.walls + w.slabs + w.openings + w.objects;
      check(
        back.stories().length === w.layers.length && walls === w.walls && withRecords >= elements && Object.keys(w.failed).length === 0,
        `${name}: ${w.layers.length} levels, ${w.walls} walls, ${w.slabs} floors, ${w.openings} doors and windows, ${w.objects} others (${w.symbols} symbols), ${w.drawing} 2D; ${withRecords} with records; ` +
          `read ${Math.round(t1 - t0)} ms, made ${Math.round(t2 - t1)} ms, ${(d.bytes.length / 1048576).toFixed(1)} MB${Object.keys(w.failed).length ? `; failed ${JSON.stringify(w.failed)}` : ""}`,
      );
    } catch (err) {
      check(false, `${name}: opens (${err instanceof Error ? err.message : String(err)})`);
    }
  }
}

console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
