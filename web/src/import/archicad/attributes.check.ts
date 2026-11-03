// Checks the Archicad stories and attributes reader (./attributes.ts) on payloads built here from
// made-up values. With PLN_SAMPLES set to a folder of .pln/.pla files it also reads every object of
// the attribute classes in each and prints decoded/total counts per class and plausibility checks
// (counts only; nothing from the files is printed).
//   npx tsx src/import/archicad/attributes.check.ts
//   PLN_SAMPLES=~/samples npx tsx src/import/archicad/attributes.check.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTRIBUTE_CLASS_NAMES, ATTRIBUTE_CLASSES, readAttributes, type ArchicadAttributes, type ArchicadDatabaseAttributes } from "./attributes.ts";
import { hex, objectsInFile, type ArchicadObject } from "./objects.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;

const classOf = (name: string): string => {
  for (const [guid, n] of ATTRIBUTE_CLASS_NAMES) if (n === name) return guid;
  throw new Error(name);
};

// ---- building payloads -----------------------------------------------------------------------------

class Out {
  readonly bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  u8(...v: number[]): this {
    for (const x of v) this.bytes.push(x & 0xff);
    return this;
  }
  u16(...v: number[]): this {
    for (const x of v) this.u8(x, x >> 8);
    return this;
  }
  u32(v: number): this {
    return this.u8(v, v >> 8, v >> 16, v >>> 24);
  }
  f64(...v: number[]): this {
    for (const x of v) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, x, true);
      this.u8(...b);
    }
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  hex(h: string): this {
    for (let i = 0; i < h.length; i += 2) this.bytes.push(parseInt(h.slice(i, i + 2), 16));
    return this;
  }
  text(s: string): this {
    this.u16(1).u32(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    return this;
  }
  ref(index: number): this {
    return this.u16(1).u32(index >>> 0);
  }
  rgb(r: number, g: number, b: number): this {
    return this.u16(r * 257, g * 257, b * 257);
  }
  add(o: Out): this {
    this.bytes.push(...o.bytes);
    return this;
  }
}

let serial = 0;
/** A made-up object GUID. */
const newGuid = (): string => `c0ffee${(++serial).toString(16).padStart(26, "0")}`;

/** A payload: class GUID, object header, then the class data written by `body`. */
function payload(cls: string, body: (o: Out) => void): Uint8Array {
  const o = new Out().hex(classOf(cls)).u8(2, 0, 0).u32(serial).zeros(4).u32(7).zeros(4).u32(0);
  body(o);
  return new Uint8Array(o.bytes);
}

/** An attribute object: the common block, then the class's own data, then a reference trailer. */
function attribute(cls: string, index: number, name: string, flags: number, own: (o: Out) => void, version = 0x000a): ArchicadObject {
  const guid = newGuid();
  const data = payload(cls, (o) => {
    o.u16(version);
    if (version >> 8 === 1) o.u32(0);
    const block = new Out().u16(0x83).u32(3).text(name).ref(index).u16(flags).u16(1).u32(0).u32(12345).zeros(17);
    o.u16(0x0205).u32(block.length).add(block);
    own(o);
    o.u32(0x24).u16(1).u8(0x12).hex("11".repeat(16)).u8(0x12).hex(guid).u8(0);
  });
  return { guid, data };
}

/** Objects by class from a list of [class name, object]. */
function objectsOf(list: readonly (readonly [string, ArchicadObject])[]): Map<string, ArchicadObject[]> {
  const m = new Map<string, ArchicadObject[]>();
  for (const [name, o] of list) {
    const cls = classOf(name);
    const l = m.get(cls) ?? [];
    l.push(o);
    m.set(cls, l);
  }
  return m;
}

const MAIN_DATABASE = "6d7ea5fb8bd4e949a2947bf50b5017c8";
/** The reference type between a container and its members (both ways). */
const MEMBER = "d9e489a27d5cf94ba0168bd82aed69c8";
const MODULE_DATABASE = "0badf00d0badf00d0badf00d0badf00d";

function attributeSet(main: boolean, database: string): ArchicadObject {
  const guid = newGuid();
  return { guid, data: payload("ADB::AttributeSet", (o) => o.u16(3).zeros(40).u8(0x12).hex(main ? MAIN_DATABASE : MODULE_DATABASE).hex(database).u8(0)) };
}

function container(tag: string, set: string, members: readonly string[], current: string | null = null): ArchicadObject {
  const guid = newGuid();
  return {
    guid,
    data: payload("ADB::AttributeContainer", (o) => {
      o.u16(3).u8(0x83, 0, 3, 0, 0, 0).u32(1).u32(2).text("Made Up");
      for (let i = 3; i >= 0; i--) o.u8(tag.charCodeAt(i));
      o.zeros(8).u16(6).hex(current ?? "00".repeat(16)).u32(0x45).u16(1);
      // several members: 01 and a list; one: 11 and a reference; none: straight to the set's reference
      if (members.length > 1) {
        o.u8(1).hex(MEMBER).u32(members.length);
        for (const m of members) o.hex(m);
      } else if (members.length === 1) o.u8(0x11).hex(MEMBER).hex(members[0]);
      o.u8(0x12).hex("5e7a5e7a5e7a5e7a5e7a5e7a5e7a5e7a").hex(set).u8(0);
    }),
  };
}

function floor(name: string, index: number): ArchicadObject {
  return { guid: newGuid(), data: payload("EDB::Floor", (o) => o.u8(5, 0, 0x83, 0, 3, 0, 0, 0).text(name).u16(index & 0xffff).u8(1).u16(4).u32(0).zeros(20)) };
}

function floorGeometry(floorGuid: string, level: number): ArchicadObject {
  return { guid: newGuid(), data: payload("EDB::FloorGeometry", (o) => o.u8(1, 0, 0x83, 0, 3, 0, 0, 0).f64(level).zeros(24).u8(0x12).hex(floorGuid).u8(0)) };
}

function floorStructure(floors: readonly string[], database: string): ArchicadObject {
  return {
    guid: newGuid(),
    data: payload("EDB::FloorStructure", (o) => {
      o.u16(2).zeros(6).u32(floors.length);
      for (const f of floors) o.hex(f);
      o.zeros(9).u8(0x12).hex(database).u8(0);
    }),
  };
}

/** A story list (made-up names and levels): floors at the given indices and levels plus the unnamed closing floor. */
function stories(database: string, list: readonly (readonly [string, number, number])[], top: number): [string, ArchicadObject][] {
  const out: [string, ArchicadObject][] = [];
  const floors: ArchicadObject[] = [];
  const maxIndex = Math.max(...list.map((s) => s[1])) + 1;
  for (const [name, index, level] of [...list, ["", maxIndex, top] as const]) {
    const f = floor(name, index);
    floors.push(f);
    out.push(["EDB::Floor", f], ["EDB::FloorGeometry", floorGeometry(f.guid, level)]);
  }
  // stored like Archicad: the closing floor first, then 0 upwards, then the ones below ground
  const order = [floors[floors.length - 1], ...floors.slice(0, -1).filter((_, i) => list[i][1] >= 0), ...floors.slice(0, -1).filter((_, i) => list[i][1] < 0)];
  out.push(["EDB::FloorStructure", floorStructure(order.map((f) => f.guid), database)]);
  return out;
}

// ---- synthetic checks --------------------------------------------------------------------------------

{
  const db = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";
  const moduleDb = "e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0";
  const layerA = attribute("VBAttr::Layer", 1, "Base Layer", 0, (o) => o.u32(1));
  const layerB = attribute("VBAttr::Layer", 4, "Hidden Locked", 1 | 2 | 0x10, (o) => o.u32(6));
  const combo = attribute(
    "VBAttr::LayerComb",
    3,
    "Combo",
    0,
    (o) => o.u16(1).u32(2).ref(1).u8(0, 0, 0).u32(1).ref(4).u8(1, 1, 0).u32(6).u8(1, 0, 0, 0, 0, 0),
    0x0103,
  );
  const snapshot = attribute("VBAttr::LayerComb", 0, "", 0, (o) => o.u16(1).u32(0).u8(1, 0, 0, 0, 0, 0), 0x0103);
  const pens = (weightOf: (i: number) => number): ((o: Out) => void) => (o) => {
    o.u16(1).u32(3);
    for (let i = 1; i <= 3; i++) o.u16(4).u32(128).text(`Pen${i}`).u32(i).zeros(12).f64(weightOf(i)).rgb(10 * i, 20 * i, 30 * i).zeros(4).text(i === 2 ? "made up" : "");
  };
  const penA = attribute("VBAttr::PenTable", 1, "Set One", 0, pens((i) => i / 10));
  const penB = attribute("VBAttr::PenTable", 2, "Set Two", 0, pens((i) => i / 5));
  const surface = attribute("VBAttr::Material", 5, "Surface", 0, (o) => {
    o.u16(0).rgb(200, 100, 50).u16(60, 70, 30, 25, 4000, 0).rgb(255, 255, 255).rgb(0, 10, 0).u16(0).ref(9).text("Made Texture").u32(2).f64(1.5, 0.75, 90);
    o.u16(1).u16(1).u32(4).zeros(4);
  });
  const plain = attribute("VBAttr::Material", 6, "Plain", 0, (o) => o.u16(0).rgb(1, 2, 3).u16(0, 0, 0, 0, 0, 0).rgb(0, 0, 0).rgb(0, 0, 0).u16(0).ref(0).text("").u32(0).f64(1, 1, 0).u16(1).u16(1).u32(0));
  const bmat = attribute("VBAttr::BuildingMaterial", 7, "Material A", 0, (o) => {
    o.text("ID-1").u32(5000).ref(9).u16(3).u16(0xffff).ref(5).u32(1).f64(0.5, 1200, 900).u8(1).text("first").text("").u8(0).f64(2.5, 0.25).text("").text("last");
  });
  const composite = attribute("VBAttr::CompWall", 8, "Composite", 4 | 8, (o) => {
    o.f64(0.3).u16(2);
    const skins: [number, number, number][] = [
      [7, 1, 0.2],
      [7, 5, 0.1],
    ];
    for (let i = 0; i < 48; i++) {
      const [m, kind, t] = skins[i] ?? [0, 0, 0];
      o.u16(0x0105).u32(17).ref(m).u16(i === 1 ? 0xfffe : 2).u8(kind).f64(t);
    }
    for (let i = 0; i < 49; i++) o.u16(2).ref(i < 3 ? 1 : 0).u16(i < 3 ? 5 + i : 0);
  });
  const profile = attribute("VBAttr::Profile", 2, "Profile", 0, (o) => {
    const hatch = new Out().u16(0, 2, 7).u16(0xffff).u32(9).u32(7).zeros(33);
    // a square with a hole: point 0 is a dummy, each contour repeats its first point
    const pts = [
      [0, 0],
      [0, 0],
      [0.4, 0],
      [0.4, 0.4],
      [0, 0.4],
      [0, 0],
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
      [0.1, 0.1],
    ];
    hatch.u32(pts.length);
    for (const [x, y] of pts) hatch.f64(x, y);
    hatch.u16(1).u32(1).u32(2).u32(3).f64(0.5);
    hatch.u16(1).u32(3).u32(0).u32(5).u32(9);
    hatch.zeros(16 * 9).hex(newGuid());
    const image = new Out().u8(3, 1, 4, 0, 0, 0).zeros(10).hex(newGuid()).u8(3, 1).u32(hatch.length).add(hatch).zeros(8);
    o.u16(1, 2).u8(9, 1).u32(image.length).add(image).u8(9, 1).u32(0);
  });
  const fillRow = (o: Out): Out => o.u8(1, 2, 4, 8, 16, 32, 64, 128).f64(0.25, 0.5, 0.75).zeros(32);
  const vectorial = attribute("VBAttr::Fill", 9, "Hatch", 1 | 2, (o) => {
    const lines = new Out().f64(1, 0, 0.5, 0, 0).u32(0).u32(0).f64(2, Math.PI / 2, 0, 0.1, 0.2).u32(2).u32(0).f64(0.3, 0.1);
    // the u16 after the kind isn't always zero
    fillRow(o).u16(0, 0x0123).zeros(4).u16(1).u32(2).u32(lines.length).add(lines).zeros(6);
  });
  const solid = attribute("VBAttr::Fill", 10, "Half", 4, (o) => fillRow(o).u16(2, 0).zeros(4).f64(0.5));
  const empty = attribute("VBAttr::Fill", 11, "Nothing", 8, (o) => fillRow(o).u16(0, 0).zeros(4).u16(1).u32(0).zeros(4));
  const image = attribute("VBAttr::Fill", 12, "Picture", 0, (o) => fillRow(o).u16(6, 0).zeros(4).text("Made Image"));
  const dashed = attribute("VBAttr::LineType", 1, "Dashes", 0, (o) => {
    const body = new Out().u32(0).u16(3).u16(4).f64(0, 2, 3, 1).u32(0).u16(2).u16(1).f64(5.5);
    o.f64(1, 6, 0).u16(2).u16(1).zeros(100).u16(2).u32(body.length).add(body);
  });
  const solidLine = attribute("VBAttr::LineType", 2, "Line", 0, (o) => o.f64(1, 0, 0).u16(1).u16(2).zeros(100).u16(0).u32(0));
  const zone = attribute("VBAttr::RoomCat", 3, "Zone Kind", 0, (o) => o.text("ZK").text("Stamp.gsm").text("Made Stamp").rgb(9, 99, 199).zeros(10));
  const moduleLayer = attribute("VBAttr::Layer", 1, "Module Layer", 0, (o) => o.u32(0));

  const mainSet = attributeSet(true, db);
  const moduleSet = attributeSet(false, moduleDb);
  const tags: [string, ArchicadObject[], string | null][] = [
    ["LAY2", [layerB, layerA], null],
    ["LCO2", [combo], null],
    ["PTBL", [penA, penB], penB.guid],
    ["MAT2", [surface, plain], null],
    ["BMAT", [bmat], null],
    ["CWA2", [composite], null],
    ["PROF", [profile], null],
    ["FIL3", [vectorial, solid, empty, image], null],
    ["LIN2", [dashed, solidLine], null],
    ["RMC2", [zone], null],
  ];
  const list: [string, ArchicadObject][] = [
    ["ADB::AttributeSet", mainSet],
    ["ADB::AttributeSet", moduleSet],
    ...tags.map(([tag, members, current]): [string, ArchicadObject] => ["ADB::AttributeContainer", container(tag, mainSet.guid, members.map((m) => m.guid), current)]),
    ["ADB::AttributeContainer", container("LAY2", moduleSet.guid, [moduleLayer.guid])],
    ["ADB::AttributeContainer", container("RMC2", moduleSet.guid, [])],
    ["VBAttr::Layer", layerA],
    ["VBAttr::Layer", layerB],
    ["VBAttr::Layer", moduleLayer],
    ["VBAttr::LayerComb", combo],
    ["VBAttr::LayerComb", snapshot],
    ["VBAttr::PenTable", penA],
    ["VBAttr::PenTable", penB],
    ["VBAttr::Material", surface],
    ["VBAttr::Material", plain],
    ["VBAttr::BuildingMaterial", bmat],
    ["VBAttr::CompWall", composite],
    ["VBAttr::Profile", profile],
    ["VBAttr::Fill", vectorial],
    ["VBAttr::Fill", solid],
    ["VBAttr::Fill", empty],
    ["VBAttr::Fill", image],
    ["VBAttr::LineType", dashed],
    ["VBAttr::LineType", solidLine],
    ["VBAttr::RoomCat", zone],
    ...stories(db, [
      ["Basement", -1, -3],
      ["Ground", 0, 0],
      ["Upper", 1, 3.5],
    ], 6.5),
    ...stories(moduleDb, [["Only", 0, 0]], 2.75),
    [
      "GeoLoc::GeoLocation",
      { guid: newGuid(), data: payload("GeoLoc::GeoLocation", (o) => o.u16(1).zeros(14).u16(2001, 2, 3, 4).zeros(4).f64(12.5, -33.25).u16(0).f64(42).u16(0).u16(60).u16(0, 0).f64(120).zeros(8)) },
    ],
    // a truncated layer must count as a problem, not stop the read
    ["VBAttr::Layer", { guid: newGuid(), data: payload("VBAttr::Layer", (o) => o.u16(0x000a).u16(0x0205).u32(400).u16(0x83)) }],
  ];
  const a = readAttributes(objectsOf(list));

  check(a.problems["VBAttr::Layer"] === 1 && Object.keys(a.problems).length === 1, "a truncated layer counts as one problem and nothing else fails");
  check(a.stories.map((s) => s.index).join() === "-1,0,1", "stories sorted by index, the closing floor dropped");
  check(a.stories.map((s) => s.name).join() === "Basement,Ground,Upper", "story names");
  check(near(a.stories[0].level, -3) && near(a.stories[0].height, 3) && near(a.stories[1].height, 3.5) && near(a.stories[2].height, 3), "story levels and heights (the top from the closing floor)");
  check(a.stories.every((s) => s.showOnSections), "story show-on-sections flag");
  check(a.layers.map((l) => `${l.index}:${l.name}`).join() === "1:Base Layer,4:Hidden Locked", "layers by index, from the main set only");
  check(a.layers[1].hidden && a.layers[1].locked && a.layers[1].wireframe && a.layers[1].intersectionGroup === 6 && !a.layers[0].hidden, "layer flags and intersection group");
  check(a.layerCombinations.length === 1 && a.layerCombinations[0].index === 3, "layer combinations: the listed one, not the view snapshot");
  const states = a.layerCombinations[0]?.layers ?? [];
  check(states.length === 2 && states[1].layer === 4 && states[1].hidden && states[1].locked && !states[1].wireframe && states[1].intersectionGroup === 6, "layer combination states");
  check(a.pens.tables.length === 2 && a.pens.model === 2, "pen sets and the model view pen set (the container's current)");
  check(a.pens.modelPens.length === 3 && a.pens.modelPens[2].index === 3 && near(a.pens.modelPens[2].weight, 0.6), "model pens: index and weight");
  check(JSON.stringify(a.pens.modelPens[1].color) === JSON.stringify({ r: 20, g: 40, b: 60 }) && a.pens.modelPens[1].description === "made up", "pen colour (16-bit channels to 0..255) and description");
  const s = a.surfaces[0];
  check(a.surfaces.length === 2 && s.index === 5 && s.color.r === 200 && s.color.g === 100 && s.color.b === 50, "surface index and colour");
  check(s.ambient === 60 && s.diffuse === 70 && s.specular === 30 && s.transparency === 25 && s.shine === 4000 && s.emissionColor.g === 10 && s.fill === 9, "surface reflectance, transparency, shine, emission and 3D hatch fill");
  check(s.texture?.name === "Made Texture" && near(s.texture.width, 1.5) && near(s.texture.height, 0.75) && near(s.texture.rotation, 90) && a.surfaces[1].texture === null, "surface texture");
  const m = a.buildingMaterials[0];
  check(m.index === 7 && m.id === "ID-1" && m.priority === 5000 && m.cutFill === 9 && m.cutFillPen === 3 && m.cutFillBackgroundPen === -1 && m.surface === 5, "building material: fill, pens, surface");
  check(near(m.thermalConductivity, 0.5) && near(m.density, 1200) && near(m.heatCapacity, 900) && near(m.embodiedEnergy, 2.5) && near(m.embodiedCarbon, 0.25), "building material physical properties");
  check(m.texts.join("|") === "first|||last", "building material free texts");
  const c = a.composites[0];
  check(c.index === 8 && near(c.thickness, 0.3) && c.forWalls && c.forSlabs && !c.forRoofs && !c.forShells, "composite thickness and use flags");
  check(c.skins.length === 2 && c.skins[0].kind === "core" && c.skins[1].kind === "finish" && c.skins[1].framePen === -2 && near(c.skins[0].thickness, 0.2), "composite skins");
  check(c.lines.length === 3 && c.lines[2].pen === 7 && c.lines.every((l) => l.lineType === 1), "composite skin lines");
  const part = a.profiles[0]?.parts[0];
  check(a.profiles.length === 1 && a.profiles[0].parts.length === 1, "profile: one part found past a false record start");
  check(part?.buildingMaterial === 7 && part.fill === 9 && part.fillPen === 7 && part.fillBackgroundPen === -1, "profile part material, fill and pens");
  check(part?.contours.length === 2 && part.contours[0].points.length === 5 && near(part.contours[0].points[2].x, 0.4) && part.contours[1].points.length === 4, "profile contours (outline and hole, closed)");
  check(part?.contours[0].arcs.length === 1 && part.contours[0].arcs[0].from === 1 && near(part.contours[0].arcs[0].angle, 0.5) && part.contours[1].arcs.length === 0, "profile arcs on their contour's points");
  const [vf, sf, ef, imf] = a.fills;
  check(vf.kind === "vectorial" && vf.scaled && vf.forCut && !vf.forDrafting && vf.lines.length === 2 && near(vf.spacing.y, 0.5) && vf.pattern[7] === 128, "vectorial fill header and flags");
  check(near(vf.lines[1].angle, Math.PI / 2) && near(vf.lines[1].origin.y, 0.2) && vf.lines[1].dashes.join() === "0.3,0.1" && vf.lines[0].dashes.length === 0, "hatch lines");
  check(sf.kind === "solid" && near(sf.percent, 0.5) && sf.forDrafting, "solid fill percent");
  check(ef.kind === "empty" && ef.forCover && imf.kind === "image" && imf.image === "Made Image", "empty and image fills");
  const [dl, sl] = a.lineTypes;
  check(dl.kind === "dashed" && !dl.scaled && near(dl.period, 6) && dl.segments.length === 3, "dashed line type");
  check(dl.segments.map((x) => `${x.start}+${x.length}`).join() === "0+2,3+1,5.5+0", "dashes and dots in order");
  check(sl.kind === "solid" && sl.scaled && sl.segments.length === 0, "solid line type");
  const z = a.zoneCategories[0];
  check(z.code === "ZK" && z.stamp === "Made Stamp" && z.color.b === 199, "zone category");
  check(a.modules.length === 1 && a.modules[0].layers.length === 1 && a.modules[0].layers[0].name === "Module Layer" && a.modules[0].stories.length === 1 && near(a.modules[0].stories[0].height, 2.75), "module database: its own layers and stories");
  const g = a.geoLocation;
  check(g !== null && near(g.longitude, 12.5) && near(g.latitude, -33.25) && near(g.altitude, 42) && near(g.north, 120), "geolocation found by its date");

  const lone = readAttributes(objectsOf([["VBAttr::Layer", layerA], ...stories(db, [["Solo", 0, 1]], 4)]));
  check(lone.layers.length === 1 && lone.stories.length === 1 && near(lone.stories[0].height, 3), "no sets: everything in the main database");
  const nothing = readAttributes(new Map());
  check(nothing.stories.length === 0 && nothing.pens.model === null && nothing.geoLocation === null && Object.keys(nothing.problems).length === 0, "no objects at all");
}

// ---- the real files ---------------------------------------------------------------------------------

/** Plausibility of one database's attributes: counts of what fails, by check, and of references resolved, by kind. */
function plausibility(d: ArchicadDatabaseAttributes, bad: Map<string, number>, refs: Map<string, [number, number]>): void {
  const ref = (what: string, ok: boolean): void => {
    const t = refs.get(what) ?? [0, 0];
    refs.set(what, [t[0] + (ok ? 1 : 0), t[1] + 1]);
  };
  const fail = (what: string, ok: boolean): void => {
    if (!ok) bad.set(what, (bad.get(what) ?? 0) + 1);
  };
  const fin = (...v: number[]): boolean => v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e9);
  const indices = (l: readonly { index: number }[]): Set<number> => new Set(l.map((x) => x.index));
  const kinds = { layers: d.layers, layerCombinations: d.layerCombinations, pens: d.pens.tables, surfaces: d.surfaces, buildingMaterials: d.buildingMaterials, composites: d.composites, profiles: d.profiles, fills: d.fills, lineTypes: d.lineTypes, zoneCategories: d.zoneCategories };
  for (const [name, l] of Object.entries(kinds)) fail(`${name}: indices unique`, indices(l).size === l.length);
  for (const [name, l] of Object.entries(kinds)) for (const x of l) fail(`${name}: index positive`, x.index >= 1);
  const layers = indices(d.layers);
  const fills = indices(d.fills);
  const surfaces = indices(d.surfaces);
  const bmats = indices(d.buildingMaterials);
  const lineTypes = indices(d.lineTypes);
  for (let i = 0; i < d.stories.length; i++) {
    const s = d.stories[i];
    fail("stories: finite, heights positive", fin(s.level, s.height) && s.height > 0);
    if (i) fail("stories: indices and levels ascend", s.index > d.stories[i - 1].index && s.level > d.stories[i - 1].level);
  }
  for (const c of d.layerCombinations) for (const st of c.layers) ref("layer combination layers", layers.has(st.layer));
  // module sources keep no pen sets of their own
  if (d.pens.tables.length) fail("pens: the model pen set found", d.pens.model !== null);
  for (const t of d.pens.tables) {
    fail("pens: 255 pens numbered 1..255", t.pens.length === 255 && t.pens.every((p, i) => p.index === i + 1));
    for (const p of t.pens) fail("pens: weights 0..10 mm, colours 0..255", fin(p.weight) && p.weight >= 0 && p.weight <= 10 && [p.color.r, p.color.g, p.color.b].every((v) => v >= 0 && v <= 255));
  }
  for (const s of d.surfaces) {
    fail("surfaces: percentages 0..100, shine 0..10000", [s.ambient, s.diffuse, s.specular, s.transparency].every((v) => v <= 100) && s.shine <= 10000);
    if (s.fill !== 0) ref("surface hatch fills", fills.has(s.fill));
    if (s.texture) fail("surfaces: texture size finite, positive", fin(s.texture.width, s.texture.height, s.texture.rotation) && s.texture.width > 0 && s.texture.height > 0);
  }
  for (const m of d.buildingMaterials) {
    ref("building material cut fills", fills.has(m.cutFill));
    if (m.surface !== 0) ref("building material surfaces", surfaces.has(m.surface));
    fail("building materials: properties finite", fin(m.thermalConductivity, m.density, m.heatCapacity, m.embodiedEnergy, m.embodiedCarbon));
  }
  for (const c of d.composites) {
    fail("composites: thickness = sum of skins", near(c.thickness, c.skins.reduce((t, s) => t + s.thickness, 0), 1e-6));
    for (const s of c.skins) ref("composite skin materials", bmats.has(s.buildingMaterial));
    fail("composites: one or more skins, a line per face", c.skins.length >= 1 && c.lines.length === c.skins.length + 1);
    for (const l of c.lines) ref("skin line types", lineTypes.has(l.lineType));
  }
  for (const p of d.profiles) {
    for (const part of p.parts) {
      ref("profile part materials", bmats.has(part.buildingMaterial));
      for (const ct of part.contours) {
        const a = ct.points[0];
        const z = ct.points[ct.points.length - 1];
        // a circle is two points and two half-circle arcs
        const shaped = ct.points.length >= 4 || (ct.points.length === 3 && ct.arcs.length === 2);
        fail("profiles: contours closed, within 100 m", shaped && near(a.x, z.x, 1e-9) && near(a.y, z.y, 1e-9) && ct.points.every((q) => fin(q.x, q.y) && Math.abs(q.x) < 100 && Math.abs(q.y) < 100));
        fail("profiles: arcs on their contour, angles within 2pi", ct.arcs.every((r) => r.from >= 0 && r.from < ct.points.length - 1 && fin(r.angle) && Math.abs(r.angle) <= 2 * Math.PI + 1e-9));
      }
    }
  }
  for (const f of d.fills) {
    fail("fills: kind known", f.kind !== "unknown");
    fail("fills: spacing and angle finite", fin(f.spacing.x, f.spacing.y, f.angle));
    if (f.kind === "solid") fail("fills: solid percent 0..1", f.percent > 0 && f.percent <= 1);
    if (f.kind === "image") fail("fills: image fills name an image", f.image !== null);
    for (const l of f.lines) fail("fills: hatch lines finite", fin(l.spacing, l.angle, l.offset, l.origin.x, l.origin.y, ...l.dashes));
  }
  for (const l of d.lineTypes) {
    // a solid line's period is huge (2e12)
    fail("line types: finite", fin(l.defineScale, l.height) && Number.isFinite(l.period) && l.period >= 0);
    if (l.kind === "dashed") fail("line types: dashed have segments within the period", l.segments.length > 0 && l.segments.every((s) => fin(s.start, s.length) && s.length >= 0));
  }
  for (const z of d.zoneCategories) fail("zone categories: colour 0..255", [z.color.r, z.color.g, z.color.b].every((v) => v >= 0 && v <= 255));
}

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const files = readdirSync(folder)
    .filter((f) => /\.(pln|pla)$/i.test(f))
    .sort();
  const total = new Map<string, [number, number]>();
  const KINDS: [keyof ArchicadDatabaseAttributes, string][] = [
    ["layers", "VBAttr::Layer"],
    ["layerCombinations", "VBAttr::LayerComb"],
    ["surfaces", "VBAttr::Material"],
    ["buildingMaterials", "VBAttr::BuildingMaterial"],
    ["composites", "VBAttr::CompWall"],
    ["profiles", "VBAttr::Profile"],
    ["fills", "VBAttr::Fill"],
    ["lineTypes", "VBAttr::LineType"],
    ["zoneCategories", "VBAttr::RoomCat"],
  ];
  for (const [i, file] of files.entries()) {
    const objects = objectsInFile(readFileSync(join(folder, file)), ATTRIBUTE_CLASSES);
    const a: ArchicadAttributes = readAttributes(objects);
    const line: string[] = [];
    for (const cls of ATTRIBUTE_CLASSES) {
      const name = ATTRIBUTE_CLASS_NAMES.get(cls) ?? cls;
      const n = objects.get(cls)?.length ?? 0;
      const ok = n - (a.problems[name] ?? 0);
      const t = total.get(name) ?? [0, 0];
      total.set(name, [t[0] + ok, t[1] + n]);
      line.push(`${name.replace(/^.*::/, "")} ${ok}/${n}`);
    }
    console.log(`file ${i + 1}: ${line.join(", ")}`);
    check(Object.keys(a.problems).length === 0, `file ${i + 1}: every object of the attribute classes decodes`);
    const databases = [a, ...a.modules];
    // every attribute object is in exactly one database (layer combination snapshots in none)
    for (const [kind, name] of KINDS) {
      const listed = databases.reduce((t, d) => t + (d[kind] as readonly unknown[]).length, 0);
      const n = objects.get(classOf(name))?.length ?? 0;
      const snapshots = kind === "layerCombinations" ? n - listed : 0;
      check(listed + snapshots === n && (kind === "layerCombinations" || listed === n), `file ${i + 1}: ${name.replace(/^.*::/, "")} ${listed} in sets of ${n}${snapshots ? ` (${snapshots} view snapshots)` : ""}`);
    }
    // pen sets in no set belong to a view's settings: their last reference isn't a container's
    const tables = new Set(databases.flatMap((d) => d.pens.tables.map((t) => t.guid)));
    const penObjects = objects.get(classOf("VBAttr::PenTable")) ?? [];
    const viewPens = penObjects.filter((o) => !tables.has(o.guid));
    check(tables.size > 0 && viewPens.every((o) => hex(o.data, o.data.length - 33, 16) !== MEMBER), `file ${i + 1}: pen sets ${tables.size} in sets of ${penObjects.length}${viewPens.length ? ` (${viewPens.length} kept with views)` : ""}`);
    const floors = objects.get(classOf("EDB::Floor"))?.length ?? 0;
    const stories = databases.reduce((t, d) => t + d.stories.length, 0);
    check(stories + databases.length === floors, `file ${i + 1}: ${databases.length} database(s), ${stories} stories + one closing floor each = ${floors} floors`);
    const bad = new Map<string, number>();
    const refs = new Map<string, [number, number]>();
    for (const d of databases) plausibility(d, bad, refs);
    check(bad.size === 0, `file ${i + 1}: plausibility${bad.size ? ` (${[...bad].map(([k, v]) => `${k}: ${v}`).join("; ")})` : ""}`);
    // references to deleted attributes stay in a file (Archicad falls back): a few are allowed
    let resolved = 0;
    let all = 0;
    for (const [ok, n] of refs.values()) [resolved, all] = [resolved + ok, all + n];
    const dangling = [...refs].filter(([, [ok, n]]) => ok < n).map(([k, [ok, n]]) => `${k} ${n - ok}`);
    check(resolved >= 0.99 * all, `file ${i + 1}: attribute references resolve ${resolved}/${all}${dangling.length ? ` (to deleted attributes: ${dangling.join(", ")})` : ""}`);
    const g = a.geoLocation;
    check(g !== null && Math.abs(g.latitude) <= 90 && Math.abs(g.longitude) <= 180 && Number.isFinite(g.north) && Number.isFinite(g.altitude), `file ${i + 1}: geolocation in range`);
  }
  console.log(`\nall files: ${[...total].map(([k, [ok, n]]) => `${k.replace(/^.*::/, "")} ${ok}/${n}`).join(", ")}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
