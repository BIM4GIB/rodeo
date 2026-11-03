// Checks turning a decoded Archicad file into a building model, under Node. Run from web/:
//   npx tsx src/import/archicad/building.check.ts
// A hand-made reading (two stories, a hotlinked module's story, a wall on its outside face with a
// door in it, a curved wall, a sloped roof, a slab with a hole, a column, an object, an element on
// a layer the file doesn't list, a hidden layer, floor plan lines and a fill with a hole, and a line
// in a section) made into a model: storeys at their levels, the wall on its centreline at its
// heights, the door in it at its sill, the curved wall as a body, the roof's underside rising
// from its pivot line, the module's own copy not drawn, the section's line in its view, the pens' colours and
// weights, the fill as one outline round its hole. Then the model is written into a blank drawing,
// saved and opened again. The end-to-end run on real files is app/archicadImport.check.ts.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx } from "../../core/index.ts";
import { writeBuilding } from "../../app/buildingWrite.ts";
import type { ArchicadAttributes } from "./attributes.ts";
import { archicadBuilding } from "./building.ts";
import type { Construction, Roof, Slab, Wall } from "./construction.ts";
import type { DraftFill, DraftLine, Drafting } from "./drafting.ts";
import type { LibParts, PlacedObject, WallOpening } from "./libparts.ts";
import type { ArchicadRead } from "./read.ts";
import type { Column, Structure } from "./structure.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number | undefined, b: number, slack = 0.01): boolean => a !== undefined && Math.abs(a - b) <= slack;

const F0 = "f0".repeat(16);
const F1 = "f1".repeat(16);
const FM = "fm".repeat(16);
const story = (guid: string, index: number, name: string, level: number) => ({ guid, index, name, level, height: 3, showOnSections: true });
const pen = (index: number, r: number, weight: number) => ({ index, color: { r, g: 0, b: 0 }, weight, description: "" });
const db = {
  database: "db",
  layerCombinations: [],
  pens: { tables: [], model: 1, modelPens: [pen(1, 0, 0.13), pen(5, 255, 0.5), pen(9, 128, 0.25)] },
  buildingMaterials: [],
  composites: [],
  profiles: [],
  fills: [{ guid: "fill", index: 2, name: "Solid", kind: "solid", scaled: false, forCut: false, forDrafting: true, forCover: true, pattern: [], spacing: { x: 0, y: 0 }, angle: 0, percent: 1, lines: [], image: null }],
  lineTypes: [],
  zoneCategories: [],
};
const attributes = {
  ...db,
  stories: [story(F0, 0, "Ground Floor", 0), story(F1, 1, "First Floor", 3)],
  layers: [
    { guid: "l1", index: 1, name: "Walls", hidden: false, locked: false, wireframe: false, intersectionGroup: 1 },
    { guid: "l2", index: 2, name: "Furniture", hidden: true, locked: false, wireframe: false, intersectionGroup: 1 },
  ],
  surfaces: [{ guid: "s1", index: 1, name: "Paint", color: { r: 255, g: 255, b: 255 }, ambient: 0, diffuse: 0, specular: 0, transparency: 0, shine: 0, transparencyAttenuation: 0, specularColor: { r: 0, g: 0, b: 0 }, emissionColor: { r: 0, g: 0, b: 0 }, emissionAttenuation: 0, fill: 0, texture: null }],
  modules: [{ ...db, database: "module", stories: [story(FM, 0, "Module Ground", 0)], layers: [], surfaces: [] }],
  geoLocation: null,
  problems: {},
} as unknown as ArchicadAttributes;

const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const poly = (...contours: { x: number; y: number }[][]) => ({ contours, arcs: [], vertexIds: contours.map((c) => c.map((_, k) => k)) });
const base = (guid: string, floor: string, story: number, layer: number) => ({ guid, id: guid.toUpperCase(), floor, story, layer, version: 29 as const });
const surface = { index: 1, overridden: false };
const wall = (guid: string, extra: Partial<Wall>): Wall =>
  ({
    ...base(guid, F1, 1, 1),
    begin: { x: 0, y: 0 },
    end: { x: 5, y: 0 },
    arcAngle: 0,
    centre: null,
    thickness: 0.3,
    endThickness: 0.3,
    bottomOffset: 0.1,
    height: 2.7,
    topOffset: 0,
    topFloor: null,
    referenceLocation: 0,
    referenceOffset: 0,
    flipped: false,
    // the reference line on the outside face, the wall to its right
    faces: { outside: 0, insideBegin: -0.3, insideEnd: -0.3 },
    profileType: 0,
    slantAlpha: Math.PI / 2,
    slantBeta: Math.PI / 2,
    structure: "basic",
    buildingMaterial: 0,
    composite: 0,
    profileObject: null,
    surfaces: [surface, surface, surface],
    footprint: poly(square(0, -0.3, 5, 0)),
    box: null,
    openings: [],
    gables: [],
    ...extra,
  }) as Wall;
const construction: Construction = {
  walls: [
    wall("wall", {}),
    // a curved wall: a quarter circle about (10, 0)
    wall("curve", { begin: { x: 11, y: 0 }, end: { x: 10, y: 1 }, arcAngle: Math.PI / 2, centre: { x: 10, y: 0 }, footprint: poly(square(10, 0, 11, 1)) }),
    wall("module", { floor: FM }),
    wall("stray", { layer: 99, begin: { x: 0, y: 5 }, end: { x: 5, y: 5 } }),
    // a complex-profile wall Archicad cached no outline for
    wall("profiled", { structure: "profile", footprint: null, begin: { x: 0, y: 10 }, end: { x: 5, y: 10 } }),
  ],
  slabs: [
    {
      ...base("slab", F0, 0, 1),
      level: 0,
      referencePlane: 0,
      offsetFromTop: 0,
      thickness: 0.25,
      top: 0,
      outline: poly(square(0, 0, 4, 4), square(1, 1, 2, 2)),
      structure: "basic",
      buildingMaterial: 0,
      composite: 0,
      surfaces: { top: surface, bottom: surface, side: null },
      edges: [],
      box: null,
    } as Slab,
  ],
  roofs: [
    {
      ...base("roof", F0, 0, 1),
      thickness: 0.2,
      pivot: { begin: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      slope: Math.PI / 6,
      level: 3,
      outline: poly(square(0, 0, 10, 5)),
      buildingMaterial: 0,
      composite: 0,
      surfaces: [surface, surface],
      edges: [],
      openings: [],
    } as Roof,
  ],
  meshes: [],
  morphs: [],
  shells: [],
  problems: {},
};
const structure = {
  beams: [],
  columns: [
    {
      ...base("column", F0, 0, 1),
      origin: { x: 2, y: 2 },
      bottomOffset: 0,
      topOffset: 0,
      topFloor: F1,
      storedHeight: 2,
      height: null,
      rotation: 0,
      slant: Math.PI / 2,
      slantDirection: 0,
      anchor: 4,
      segments: [{ guid: "seg", section: { kind: "rectangular", width: 0.3, height: 0.4 }, bounds: null, material: null, surface: 1 }],
    } as Column,
  ],
  curtainWalls: [],
  stairs: [],
  railings: [],
  problems: {},
} as unknown as Structure;
const placed = { group: null, database: null, libPart: { reference: "r", fileName: "Door.gsm", name: "Door 1", mainGuid: "", revisionGuid: "", subtype: "", library: "", userParams: null, currentParams: null, programParams: null }, params: [{ name: "gs_frame", type: "length", code: 2, value: 0.05, dims: null, flags: 0 }] };
const libparts = {
  doors: [
    {
      ...placed,
      guid: "door",
      floor: F1,
      layer: 0,
      id: "D1",
      wall: "wall",
      width: 0.9,
      height: 2.1,
      along: 2.5,
      sill: 0,
      head: 2.1,
      mirrored: false,
      otherSide: false,
      refSide: false,
      anchor: 0,
      reveal: false,
      revealDepthFromSide: 0,
      revealDepthOffset: 0,
      jambDepthHead: 0,
      jambDepthSill: 0,
      jambDepth: 0,
      jambDepth2: 0,
      marker: null,
    } as WallOpening,
  ],
  windows: [],
  skylights: [],
  objects: [
    { ...placed, guid: "chair", floor: F0, layer: 2, id: "C1", position: { x: 1, y: 1, z: 0 }, angle: 0, mirrored: false, a: 0.5, b: 0.6, height: 0.9, owner: null } as PlacedObject,
    { ...placed, guid: "panel", floor: null, layer: 2, id: "", position: { x: 0, y: 0, z: 0 }, angle: 0, mirrored: false, a: 1, b: 1, height: 1, owner: { kind: "railing post", guid: "r" } } as PlacedObject,
  ],
  lamps: [],
  libraryParts: [],
  problems: {},
} as unknown as LibParts;
const where = { story: 0, layer: 1, order: 0, owner: "plan", ownerKind: "floorPlan" as const, floor: F0, group: null };
const flat = (...contours: { x: number; y: number }[][]) => ({
  points: Float64Array.from(contours.flatMap((c) => c.flatMap((p) => [p.x, p.y]))),
  ends: Uint32Array.from(contours.map((_, k) => contours.slice(0, k + 1).reduce((n, c) => n + c.length, 0))),
  arcs: new Float64Array(0),
});
const drafting = {
  databases: new Map(),
  lines: [
    { ...where, guid: "line", pen: 5, lineType: 1, begin: { x: 0, y: 0 }, end: { x: 1, y: 0 } } as DraftLine,
    { ...where, guid: "cut", ownerKind: "section", floor: null, pen: 5, lineType: 1, begin: { x: 0, y: 0 }, end: { x: 1, y: 0 } } as DraftLine,
  ],
  arcs: [],
  polylines: [],
  splines: [],
  fills: [
    {
      ...where,
      guid: "fill",
      id: "",
      shape: flat(square(0, 0, 4, 4), square(1, 1, 2, 2)),
      fill: 2,
      pen: 9,
      backgroundPen: -1,
      contourPen: 1,
      contourLineType: 1,
      contourShown: false,
      orientation: 0,
      origin: { x: 0, y: 0 },
      matrix: [1, 0, 0, 1],
      areaText: null,
    } as DraftFill,
  ],
  texts: [],
  dimensions: [],
  levelDimensions: [],
  zones: [],
  cameras: [],
  hotspots: [],
  groups: [],
  labels: [],
  problems: {},
} as unknown as Drafting;

const read: ArchicadRead = { attributes, construction, structure, drafting, libparts };
const palette = (c: { r: number }): number => c.r;
const model = archicadBuilding(read, "House.pla", palette);

check(model.name === "House" && model.units === "mm", "named after the file, in millimetres");
check(model.storeys.length === 2 && model.storeys[1].elevation === 3000 && model.storeys[1].name === "First Floor", "stories become storeys at their levels");
check(model.categories[1]?.hidden === true && model.categories.some((c) => c.name === "Archicad Layer 99"), "a hidden layer's category starts hidden; an unlisted layer gets a category of its own");

const w = model.walls.find((x) => x.name === "WALL");
check(near(w?.start.y, -150) && near(w?.end.x, 5000) && near(w?.thickness, 300), "a wall drawn on its outside face sits on its centreline at its thickness");
check(near(w?.bottom, 3100) && near(w?.height, 2700) && w?.storey === 1, "the wall stands from its foot above its story to its height");
check(
  model.objects.some((o) => o.name === "CURVE" && o.bodies[0].faces.length > 0),
  "a curved wall is a body of its outline",
);
const profiled = model.objects.find((o) => o.name === "PROFILED")?.bodies[0].faces.flat() ?? [];
const ys = profiled.filter((_, i) => i % 3 === 1);
check(profiled.length > 0 && near(Math.min(...ys), 9700) && near(Math.max(...ys), 10000), "a profiled wall with no cached outline gets one from its reference line and faces");
check(!model.walls.some((x) => x.name === "MODULE") && !Object.keys(model.skipped).some((k) => k.includes("module")), "a hotlinked module's own copy isn't drawn or reported as left out");

const door = model.openings[0];
check(door?.kind === "door" && door.wall === model.walls.indexOf(w!) && near(door.at.x, 2500) && near(door.at.y, -150), "a door sits in its wall at its distance along it, on the centreline");
check(near(door?.sill, 3000) && near(door?.width, 900) && near(door?.height, 2100) && door?.category === w?.category, "the door's sill is above its story, and it takes its wall's layer when it has none");
check(door?.properties["Door 1"]?.some((p) => p.name === "gs_frame" && p.kind === "length" && near(p.value as number, 50)) ?? false, "its GDL parameters are its records, lengths in mm");

const slab = model.slabs[0];
check(near(slab?.bottom, -250) && near(slab?.thickness, 250) && slab?.holes?.length === 1, "a slab hangs from its top, its hole kept");

const roof = model.objects.find((o) => o.name === "ROOF");
const zs = roof?.bodies[0].faces.flatMap((f) => f.filter((_, i) => i % 3 === 2)) ?? [];
const under = 3000 + Math.tan(Math.PI / 6) * 5000;
check(near(Math.min(...zs), 3000) && near(Math.max(...zs), under + 200 / Math.cos(Math.PI / 6)), "a roof's underside rises from its pivot line at its slope");

const column = model.objects.find((o) => o.name === "COLUMN");
const cz = column?.bodies[0].faces.flatMap((f) => f.filter((_, i) => i % 3 === 2)) ?? [];
check(near(Math.max(...cz), 3000) && model.drawing.some((d) => d.shape.kind === "polygon" && d.shape.points.length === 4 && near(d.shape.points[0].x, 1850)), "a column linked to the story above reaches it, its section drawn in plan");

const chair = model.objects.find((o) => o.name === "C1");
check(chair?.bodies[0].box === true && model.skipped["stair and railing parts (Archicad makes them from scripts)"] === 1, "an object is the see-through box of its size; generated parts are counted");

const line = model.drawing.find((d) => d.shape.kind === "line" && d.attrs?.penFore === 255);
check(line?.attrs?.lineWeight === Math.round(0.5 / 0.0254), "a plan line has its pen's colour and weight");
check(model.views.length === 1 && model.views[0].name === "Section 1" && !model.views[0].sheet && model.views[0].items.length === 1, "a section's line goes on the section's own layer");
const fill = model.drawing.find((d) => d.shape.kind === "polygon" && d.attrs?.fillPattern === 1);
check(fill?.shape.kind === "polygon" && fill.shape.points.length === 10 && fill.attrs?.fillFore === 128, "a fill with a hole is one outline round it, in its pen's colour");

// written into a drawing and opened again
const s = openVwx(blankDrawing("mm"));
const written = writeBuilding(s, model);
const again = openVwx(s.doc.toBytes(), "again.vwx");
const designs = again.doc.layers().filter((l) => l.kind === "design");
const count = designs.reduce((n, l) => n + again.doc.objects(l.id).length, 0);
check(written.walls === 2 && written.slabs === 1 && written.openings === 1 && designs.length >= 2 && count > 0, `written and opened again (${written.walls} walls, ${written.objects} other, ${written.drawing} 2D; ${count} objects)`);
check(Object.keys(written.failed).length === 0, `nothing failed to be made (${JSON.stringify(written.failed)})`);

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
