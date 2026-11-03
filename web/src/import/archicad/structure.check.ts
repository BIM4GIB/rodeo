// Checks ./structure.ts: synthetic beams, columns, a curtain wall, a stair and a railing built here
// in the Archicad 25, 27 and 29 layouts with made-up values, then (with PLN_SAMPLES set to a folder
// of .pln/.pla files) every beam, column, curtain wall, stair and railing in each file: decoded/total
// per class, story and layer against the file's own EDB::Floor stories and VBAttr::Layer attributes
// (read by ./attributes.ts, per database), material, surface and profile indices against theirs,
// every child linking back to its parent, and numbers finite and in sane ranges. Counts only;
// nothing from the files is printed.
//   npx tsx src/import/archicad/structure.check.ts
//   PLN_SAMPLES=~/samples npx tsx src/import/archicad/structure.check.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTRIBUTE_CLASSES, readAttributes, type ArchicadDatabaseAttributes } from "./attributes.ts";
import { objectsInFile, type ArchicadObject } from "./objects.ts";
import { internals, readStructure, STRUCTURE_CLASSES, type Structure } from "./structure.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;
const { CLASS, LINK } = internals;

// ---- building payloads ---------------------------------------------------------------------------

class Out {
  readonly bytes: number[] = [];
  get length(): number {
    return this.bytes.length;
  }
  u8(...v: number[]): this {
    for (const x of v) this.bytes.push(x & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v, v >> 8);
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
  guid(h: string): this {
    for (let i = 0; i < 32; i += 2) this.u8(parseInt(h.slice(i, i + 2), 16));
    return this;
  }
  str(s: string): this {
    this.u16(1).u32(s.length);
    for (const c of s) this.u16(c.charCodeAt(0));
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  at(o: number, f: (w: Out) => void): this {
    const w = new Out();
    f(w);
    for (let i = 0; i < w.length; i++) this.bytes[o + i] = w.bytes[i];
    return this;
  }
}

type Version = 25 | 27 | 29;
type L = [tag: number, type: string, targets: string[]];

let made = 0;
/** A made-up GUID. */
const g = (): string => (++made).toString(16).padStart(8, "0") + "5eed".repeat(6);

/** A payload: class GUID, object header, first section (class chain, the class GUID, versions, body), links. */
function payload(cls: string, version: Version | null, body: (o: Out) => void, links: L[] = []): Uint8Array {
  const o = new Out().guid(cls).u8(2, 0, 0).u32(1).zeros(4).u32(7).zeros(4).u32(0);
  const start = o.length;
  if (version !== null) {
    if (version === 25) o.u8(1, 0, 1, 0, 7, 0, 4, 0, 0x82, 0, 3, 0, 0, 1);
    else o.u8(1, 0, 1, 0, 9, 0, version === 29 ? 0x83 : 0x82, 0, 3, 0, 0, 1);
    o.guid(cls).u16(2).u16(1).u16(1);
  }
  body(o);
  o.at(35, (w) => w.u32(o.length - start));
  const l = new Out().u16(1);
  for (const [tag, type, targets] of links) {
    l.u8(tag).guid(type);
    if (tag === 1 || tag === 2) l.u32(targets.length);
    for (const t of targets) l.guid(t);
  }
  l.u8(0);
  o.u32(l.length).u8(...l.bytes);
  return new Uint8Array(o.bytes);
}

/** An element's data: [29: 16 bytes, u32 m, m bytes], [a block: u32 n, n bytes], [29: u32], the header, `post`. */
function element(o: Out, v: Version, block: Out | null, strings: string[], layer: number, story: number, post: Out): void {
  if (v === 29) o.zeros(16).u32(4).zeros(4);
  if (block) o.u32(block.length).u8(...block.bytes);
  if (v === 29) o.u32(0);
  o.u8(0x0e, 1, 0).u32(layer).u16(story & 0xffff).u16(0);
  if (v === 25) o.u32(0).u16(1).u32(0);
  o.u16(1).u32(3).u32(5);
  for (const s of strings) o.str(s);
  o.u8(...post.bytes);
}

const objects = new Map<string, ArchicadObject[]>();
function add(cls: string, guid: string, data: Uint8Array): void {
  let list = objects.get(cls);
  if (!list) objects.set(cls, (list = []));
  list.push({ guid, data });
}

// ---- beams in all three layouts -------------------------------------------------------------------

const FLOOR = g();
const pt = (x: number, y: number, z: number): Out => new Out().f64(x, y, z);

function beam(v: Version, withCache: boolean): { guid: string; segment: string } {
  const guid = g();
  const segment = g();
  const shape = g();
  // the block: the anchor (here 1, the section above the line), then the 3D cache
  const block = new Out().zeros(v === 25 ? 97 : 1).u32(1).zeros(12);
  if (withCache) block.u8(1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0).u8(...pt(1, 2, 0.5).bytes, ...pt(4, 6, 0.5).bytes, ...pt(1, 2, 0.7).bytes, ...pt(4, 6, 0.7).bytes).f64(0, 5);
  else block.u8(0).zeros(40);
  const post = new Out().u8(0).f64(0, 0.5, 1, 2, 4, 6, 0).u32(0).zeros(0x61 - 0x3d).f64(0.125).zeros(16);
  add(
    CLASS.beam,
    guid,
    payload(CLASS.beam, v, (o) => element(o, v, block, ["", "", `B-${v}`], 3, 2, post), [
      [0x12, LINK.floor, [FLOOR]],
      [0x11, LINK.beamSegment, [segment]],
    ]),
  );
  // the segment: material at +0x22, a surface at +0x36 (from its u32)
  const seg = new Out().u32(77).zeros(0x16).u16(3).zeros(6).u16(1).u32(4).zeros(0x0e).u16(1).u32(9).zeros(8);
  add(
    CLASS.beamSegment,
    segment,
    payload(CLASS.beamSegment, v, (o) => (v === 29 ? o.zeros(16).u32(4).zeros(4) : o).u8(...seg.bytes), [
      [0x12, LINK.beamSegment, [guid]],
      [0x11, LINK.shape, [shape]],
    ]),
  );
  add(CLASS.rectShape, shape, payload(CLASS.rectShape, v, (o) => (v === 29 ? o.zeros(12) : o).u32(9).u16(1).f64(0.2, 0.4).u8(1, 0x24, 0x6d, 0x6d).f64(-0.1, 0, 0.1, 0.4).zeros(8), [[0x12, LINK.shape, [segment]]]));
  return { guid, segment };
}

const beams = ([25, 27, 29] as const).map((v) => beam(v, v !== 25));
beam(27, true);

// ---- a column with a circular section and a linked top -----------------------------------------------

const COLUMN = g();
const TOP_FLOOR = g();
const INDIRECTION = g();
{
  const segment = g();
  const shape = g();
  const block = new Out().zeros(1).u32(4).zeros(12).u8(1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0).u8(...pt(3, 3, 0.25).bytes, ...pt(3, 3, 3.25).bytes, ...pt(3, 3, 0.25).bytes, ...pt(3, 3, 3.25).bytes).f64(0, 3);
  const post = new Out()
    .u32(1)
    .f64(-0.1, 2.75, 0.25, 0, 3, 3)
    .zeros(0x4f - 0x34)
    .f64(Math.PI / 2, 0.3)
    .zeros(200 - 0x5f);
  add(
    CLASS.column,
    COLUMN,
    payload(CLASS.column, 27, (o) => element(o, 27, block, ["", "", "C-1"], 4, 0, post), [
      [0x12, LINK.floor, [FLOOR]],
      [0x12, LINK.columnTop, [INDIRECTION]],
      [0x11, LINK.columnSegment, [segment]],
    ]),
  );
  add(CLASS.floorIndirection, INDIRECTION, payload(CLASS.floorIndirection, null, (o) => o.zeros(8), [[0x12, LINK.indirectionFloor, [TOP_FLOOR]]]));
  const seg = new Out().u32(77).zeros(0x16).u16(3).zeros(6).u16(1).u32(6).zeros(0x0e).u16(1).u32(11).zeros(8);
  add(CLASS.columnSegment, segment, payload(CLASS.columnSegment, 27, (o) => o.u8(...seg.bytes), [[0x12, LINK.columnSegment, [COLUMN]], [0x11, LINK.shape, [shape]]]));
  add(CLASS.circleShape, shape, payload(CLASS.circleShape, 27, (o) => o.u32(9).u16(1).f64(0.35, 0.35).zeros(8), [[0x12, LINK.shape, [segment]]]));
}

// ---- a curtain wall: one segment, two mullions, two transoms, one panel ------------------------------

const CW = g();
const frames = [g(), g(), g(), g()];
const PANEL = g();
const CW_SEGMENT = g();
{
  add(
    CLASS.curtainWall,
    CW,
    payload(CLASS.curtainWall, 27, (o) => element(o, 27, null, ["CW-1"], 5, 1, new Out().zeros(16)), [
      [0x12, LINK.floor, [FLOOR]],
      [0x01, LINK.cwSegments, [CW_SEGMENT]],
      [0x01, LINK.cwFrames, frames],
      [0x01, LINK.cwPanels, [PANEL]],
    ]),
  );
  add(
    CLASS.cwSegment,
    CW_SEGMENT,
    payload(CLASS.cwSegment, 27, (o) => element(o, 27, null, [], 5, -42, new Out().zeros(14).f64(0, 0, 0, 4, 0, 0).zeros(8)), [[0x12, LINK.cwSegments, [CW]]]),
  );
  // the frames' tail: section (halves of the width, depth from/to), a f64, u32, u32 kind, 6 bytes, the box, 01
  const boxes: [number[], number][] = [
    [[0, 0, 0, 0, 0, 3], 0],
    [[2, 0, 2, 0, 0, 3], 0],
    [[-0.025, -0.1, 2.025, 0, -0.025, 0.025], 3],
    [[0, 0, 2, 0, 3, 3], 0],
  ];
  boxes.forEach(([b, kind], i) =>
    add(
      CLASS.cwFrame,
      frames[i],
      payload(CLASS.cwFrame, 27, (o) => o.zeros(24).f64(0.025, 0.025, 0, 0.1, 12.5).u32(0).u32(kind).zeros(6).f64(b[0], b[1], b[2], b[3], b[4], b[5]).u8(1), [[0x12, LINK.frameTemplate, [CW]]]),
    ),
  );
  add(
    CLASS.cwPanel,
    PANEL,
    payload(CLASS.cwPanel, 27, (o) => {
      o.zeros(4);
      for (const x of [...frames, CW_SEGMENT]) o.u16(6).guid(x);
      o.zeros(4);
    }),
  );
}

// ---- a stair: three step lines, a placement -------------------------------------------------------------

const STAIR = g();
const treads = [g(), g()];
{
  const scheme = g();
  const c = Math.cos(0.5);
  const s = Math.sin(0.5);
  add(
    CLASS.stair,
    STAIR,
    payload(CLASS.stair, 27, (o) => element(o, 27, null, ["S-1"], 6, 0, new Out().zeros(40).f64(10, 20, 0, c, -s, 0, s, c, 0, 0, 0, 1).zeros(8)), [
      [0x12, LINK.floor, [FLOOR]],
      [0x01, "4f505257f29fb34bbbd8e819208d5716", treads],
      [0x11, LINK.stairScheme, [scheme]],
    ]),
  );
  for (const t of treads) add(CLASS.tread, t, payload(CLASS.tread, 27, (o) => o.zeros(8), [[0x12, "4f505257f29fb34bbbd8e819208d5716", [STAIR]]]));
  add(
    CLASS.stairScheme,
    scheme,
    payload(CLASS.stairScheme, null, (o) => {
      o.zeros(6);
      // the middle line is stored the other way round
      for (const l of [
        [0, 0, 0, 1],
        [0.3, 1, 0.3, 0],
        [0.6, 0, 0.6, 1],
      ])
        o.u8(3, 0, 0x3d, 0).f64(l[0], l[1], l[2], l[3]);
    }),
  );
}

// ---- a railing: placement, two stored nodes and one attached to another element ----------------------------

const RAILING = g();
{
  const nodes = [g(), g(), g()];
  const vertices = [g(), g(), g()];
  add(
    CLASS.railing,
    RAILING,
    payload(CLASS.railing, 27, (o) => element(o, 27, null, ["R-1"], 7, 0, new Out().u8(0, 1, 0, 4, 0).f64(1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1).zeros(72)), [
      [0x12, LINK.floor, [FLOOR]],
      [0x11, LINK.railingFirstNode, [nodes[0]]],
      [0x01, LINK.railingNodes, nodes.slice(1)],
    ]),
  );
  nodes.forEach((n, i) => add(CLASS.railingNode, n, payload(CLASS.railingNode, 27, (o) => o.zeros(8), [[0x11, LINK.nodeVertex, [vertices[i]]], [0x12, LINK.railingNodes, [RAILING]]])));
  add(CLASS.railingVertex, vertices[0], payload(CLASS.railingVertex, null, (o) => o.zeros(10).f64(1, 2, 0)));
  add(CLASS.railingVertex, vertices[1], payload(CLASS.railingVertex, null, (o) => o.zeros(10).f64(5, 2, 0.1)));
  add(CLASS.attachedVertex, vertices[2], payload(CLASS.attachedVertex, null, (o) => o.zeros(26)));
}

// ---- and an object that is cut short -------------------------------------------------------------------

add(CLASS.beam, g(), payload(CLASS.beam, 27, (o) => o.u32(500).zeros(3)).subarray(0, 60));

// ---- reading them back -------------------------------------------------------------------------------

{
  const r = readStructure(objects);
  check(r.beams.length === 4 && r.problems.Beam === 1, "four beams read, the cut-short one counted under problems");
  for (const [i, v] of ([25, 27, 29] as const).entries()) {
    const b = r.beams.find((x) => x.guid === beams[i].guid);
    const ok =
      !!b &&
      b.id === `B-${v}` &&
      b.layer === 3 &&
      b.story === 2 &&
      b.floor === FLOOR &&
      near(b.level, 0.5) &&
      near(b.begin.x, 1) &&
      near(b.end.y, 6) &&
      near(b.slant, 0.125) &&
      b.anchor === 1 &&
      (v === 25 ? b.axis === null : !!b.axis && near(b.axis.begin.z, 0.7)) &&
      b.segments.length === 1 &&
      b.segments[0].guid === beams[i].segment &&
      b.segments[0].material === 4 &&
      b.segments[0].surface === 9 &&
      b.segments[0].section?.kind === "rectangular" &&
      near(b.segments[0].section.width, 0.2) &&
      near(b.segments[0].section.height, 0.4) &&
      !!b.segments[0].bounds &&
      near(b.segments[0].bounds.maxY, 0.4);
    check(ok, `Archicad ${v} beam: header, reference line, level, slant, anchor, ${v === 25 ? "no 3D cache" : "section axis"}, segment, material, surface, section, box`);
  }
  const c = r.columns[0];
  check(
    !!c &&
      c.id === "C-1" &&
      c.layer === 4 &&
      near(c.origin.x, 3) &&
      near(c.bottomOffset, 0.25) &&
      near(c.topOffset, -0.1) &&
      near(c.storedHeight, 2.75) &&
      c.height !== null &&
      near(c.height, 3) &&
      c.topFloor === TOP_FLOOR &&
      near(c.slant, Math.PI / 2) &&
      near(c.rotation, 0.3) &&
      c.segments[0]?.section?.kind === "circular" &&
      near(c.segments[0].section.diameter, 0.35) &&
      c.segments[0].material === 6,
    "column: origin, offsets, stored and cached height, top story through its indirection, slant, rotation, circular section, material",
  );
  const w = r.curtainWalls[0];
  const poly = w?.panels[0]?.polygon ?? [];
  const has = (x: number, z: number): boolean => poly.some((p) => near(p.x, x, 1e-6) && near(p.y, 0, 1e-6) && near(p.z, z, 1e-6));
  check(
    !!w && w.id === "CW-1" && w.story === 1 && w.segments.length === 1 && near(w.segments[0].end.x, 4) && w.frames.length === 4 && w.frames[2].boundsOfBody && !w.frames[0].boundsOfBody && w.frames[0].template === CW && near(w.frames[0].section?.width ?? 0, 0.05),
    "curtain wall: segment line, four frames with their boxes, kinds, templates and sections",
  );
  check(
    w?.panels.length === 1 && w.panels[0].frames.length === 4 && w.panels[0].segments[0] === CW_SEGMENT && poly.length === 4 && has(0, 0) && has(2, 0) && has(2, 3) && has(0, 3),
    "curtain wall panel: its frames and segment, and its outline from the frames' axes (a body box moved onto the frame plane)",
  );
  const s = r.stairs[0];
  check(
    !!s &&
      s.id === "S-1" &&
      s.treads.length === 2 &&
      s.stepLines.length === 3 &&
      near(s.stepLines[1].a.y, 0) &&
      s.outline.length === 6 &&
      near(s.walkingLine[2].y, 0.5) &&
      !!s.placement &&
      near(s.placement.origin.x, 10) &&
      near(s.placement.matrix[0], Math.cos(0.5)),
    "stair: treads, step lines turned one way, outline, walking line, placement",
  );
  const rl = r.railings[0];
  check(
    !!rl && rl.id === "R-1" && !!rl.placement && near(rl.placement.origin.x, 1) && rl.nodes.length === 3 && near(rl.nodes[1]?.x ?? 0, 5) && rl.nodes[2] === null && !r.problems["VBElem::RailingNode"],
    "railing: placement, nodes in order, the attached one without a point",
  );
}

// ---- the samples ---------------------------------------------------------------------------------------

/** Every number in a value, recursively. */
function numbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) for (const x of v) numbers(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) numbers(x, out);
  return out;
}

/** Whether a child object links back (02/12) to its parent. */
function linksBack(child: ArchicadObject | undefined, parent: string): boolean {
  return !!child && internals.linksOf(child.data).some((l) => (l.tag === 0x02 || l.tag === 0x12) && l.targets.includes(parent));
}

function sweep(index: number, r: Structure, all: ReadonlyMap<string, readonly ArchicadObject[]>, dbs: readonly ArchicadDatabaseAttributes[]): void {
  const count = (cls: string): number => all.get(cls)?.length ?? 0;
  const byGuid = new Map<string, ArchicadObject>();
  for (const [, list] of all) for (const o of list) byGuid.set(o.guid, o);
  const tag = `file ${index}:`;

  // decoded / total
  const pairs: [string, number, number][] = [
    ["Beam", r.beams.length, count(CLASS.beam)],
    ["Column", r.columns.length, count(CLASS.column)],
    ["CurtainWall", r.curtainWalls.length, count(CLASS.curtainWall)],
    ["VBElem::Stair", r.stairs.length, count(CLASS.stair)],
    ["VBElem::Railing", r.railings.length, count(CLASS.railing)],
  ];
  for (const [name, got, total] of pairs) check(got === total, `${tag} ${name} ${got}/${total}`);
  const problems = Object.entries(r.problems).filter(([k]) => k !== "VBElem::RailingNode");
  check(problems.length === 0, `${tag} no sub-object problems${problems.length ? ` (${problems.map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
  console.log(`     ${tag} railing nodes without a stored vertex: ${r.problems["VBElem::RailingNode"] ?? 0}`);

  // story and layer, against the element's own database
  const floorOf = new Map<string, { db: ArchicadDatabaseAttributes; index: number }>();
  for (const db of dbs) for (const s of db.stories) floorOf.set(s.guid, { db, index: s.index });
  const elements = [...r.beams, ...r.columns, ...r.curtainWalls, ...r.stairs, ...r.railings];
  let storyOk = 0;
  let layerOk = 0;
  for (const e of elements) {
    const f = e.floor ? floorOf.get(e.floor) : undefined;
    if (f && f.index === e.story) storyOk++;
    if (f && f.db.layers.some((l) => l.index === e.layer)) layerOk++;
  }
  check(storyOk === elements.length, `${tag} story = the index of the linked EDB::Floor: ${storyOk}/${elements.length}`);
  check(layerOk === elements.length, `${tag} layer is a VBAttr::Layer index of that database: ${layerOk}/${elements.length}`);

  // segments: section, material, surface, profile
  const segs = [...r.beams.map((b) => ({ e: b.floor, s: b.segments })), ...r.columns.map((c) => ({ e: c.floor, s: c.segments }))].flatMap(({ e, s }) => s.map((x) => ({ db: e ? floorOf.get(e)?.db : undefined, x })));
  const segTotal = count(CLASS.beamSegment) + count(CLASS.columnSegment);
  check(segs.length === segTotal, `${tag} beam and column segments reached from their elements: ${segs.length}/${segTotal}`);
  const sections = segs.filter(({ x }) => x.section !== null).length;
  check(sections === segs.length, `${tag} segments with a section: ${sections}/${segs.length}`);
  const sane = segs.filter(({ x }) => x.section && (x.section.kind === "profile" || (x.section.kind === "circular" ? x.section.diameter > 0 && x.section.diameter < 20 : x.section.width > 0 && x.section.width < 20 && x.section.height > 0 && x.section.height < 20))).length;
  check(sane === segs.length, `${tag} section sizes in (0, 20) m: ${sane}/${segs.length}`);
  const plain = segs.filter(({ x }) => x.section?.kind !== "profile");
  const mats = plain.filter(({ db, x }) => x.material !== null && !!db?.buildingMaterials.some((m) => m.index === x.material)).length;
  check(mats === plain.length, `${tag} rectangular/circular segment building material is a VBAttr::BuildingMaterial index of its database: ${mats}/${plain.length}`);
  const withSurface = segs.filter(({ x }) => x.surface !== null);
  const surfs = withSurface.filter(({ db, x }) => !!db?.surfaces.some((m) => m.index === x.surface)).length;
  check(surfs === withSurface.length, `${tag} segment surface is a VBAttr::Material index: ${surfs}/${withSurface.length} (${segs.length - withSurface.length} none)`);
  const profiled = segs.filter(({ x }) => x.section?.kind === "profile");
  const profIndex = profiled.filter(({ x }) => x.section?.kind === "profile" && x.section.profile !== null).length;
  const profOk = profiled.filter(({ db, x }) => x.section?.kind === "profile" && x.section.profile !== null && !!db?.profiles.some((p) => p.index === (x.section as { profile: number }).profile)).length;
  check(profIndex === profiled.length, `${tag} complex sections have a profile index: ${profIndex}/${profiled.length}`);
  // a segment keeps its own copy of the profile, so its index may name a profile since deleted
  console.log(`     ${tag} profile indices naming a VBAttr::Profile of the database: ${profOk}/${profiled.length}`);

  // children link back to their parents
  let children = 0;
  let back = 0;
  const pair = (child: string, parent: string): void => {
    children++;
    if (linksBack(byGuid.get(child), parent)) back++;
  };
  for (const b of r.beams) for (const s of b.segments) pair(s.guid, b.guid);
  for (const c of r.columns) for (const s of c.segments) pair(s.guid, c.guid);
  for (const w of r.curtainWalls) for (const x of [...w.segments, ...w.frames, ...w.panels]) pair(x.guid, w.guid);
  for (const s of r.stairs) for (const x of [...s.treads, ...s.risers]) pair(x, s.guid);
  for (const rl of r.railings) for (const x of rl.segments) pair(x, rl.guid);
  check(back === children, `${tag} children link back to their parent: ${back}/${children}`);
  // and every segment, tread and riser object belongs to an element read here
  const owned = new Set<string>([...r.beams.flatMap((b) => b.segments.map((s) => s.guid)), ...r.columns.flatMap((c) => c.segments.map((s) => s.guid)), ...r.stairs.flatMap((s) => [...s.treads, ...s.risers])]);
  const childObjects = [CLASS.beamSegment, CLASS.columnSegment, CLASS.tread, CLASS.riser].flatMap((c) => all.get(c) ?? []);
  const resolved = childObjects.filter((o) => owned.has(o.guid)).length;
  check(resolved === childObjects.length, `${tag} beam/column segments, treads and risers resolve to a parent: ${resolved}/${childObjects.length}`);

  // numbers
  const all3 = numbers(r);
  const finite = all3.filter((x) => Number.isFinite(x) && Math.abs(x) < 1e6).length;
  check(finite === all3.length, `${tag} every number finite and under 1e6: ${finite}/${all3.length}`);
  const beamOk = r.beams.filter((b) => Math.hypot(b.end.x - b.begin.x, b.end.y - b.begin.y) < 1000 && Math.abs(b.level) < 1000 && Math.abs(b.slant) < Math.PI / 2 && b.anchor >= 0 && b.anchor <= 8).length;
  check(beamOk === r.beams.length, `${tag} beams: length < 1 km, level, slant, anchor 0..8: ${beamOk}/${r.beams.length}`);
  const colOk = r.columns.filter((c) => c.storedHeight >= 0 && (c.height === null || (c.height > 0 && c.height < 1000)) && c.slant > 0 && c.slant < Math.PI).length;
  check(colOk === r.columns.length, `${tag} columns: heights in (0, 1 km), slant in (0, π): ${colOk}/${r.columns.length}`);
  console.log(`     ${tag} beams with a 3D cache ${r.beams.filter((b) => b.axis).length}/${r.beams.length}, columns ${r.columns.filter((c) => c.height !== null).length}/${r.columns.length}, top-linked columns ${r.columns.filter((c) => c.topFloor).length}`);
  const frames = r.curtainWalls.flatMap((w) => w.frames);
  const panels = r.curtainWalls.flatMap((w) => w.panels);
  const frameOk = frames.filter((f) => f.section === null || (f.section.width > 0 && f.section.width <= 10)).length;
  check(frameOk === frames.length, `${tag} curtain wall frame widths in (0, 10] m: ${frameOk}/${frames.length} (${frames.filter((f) => !f.section).length} without a section)`);
  const outlined = panels.filter((p) => p.polygon && p.polygon.length >= 3).length;
  check(panels.length === 0 || outlined >= panels.length * 0.75, `${tag} curtain wall panels with an outline: ${outlined}/${panels.length}`);
  const stepOk = r.stairs.every((s) => s.stepLines.every((l) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y) < 50));
  check(stepOk, `${tag} stair step lines under 50 m; stairs with step lines ${r.stairs.filter((s) => s.stepLines.length).length}/${r.stairs.length}, with a placement ${r.stairs.filter((s) => s.placement).length}/${r.stairs.length}`);
  const nodes = r.railings.flatMap((x) => x.nodes);
  check(
    r.railings.every((x) => x.placement),
    `${tag} railings with a placement ${r.railings.filter((x) => x.placement).length}/${r.railings.length}; nodes with a point ${nodes.filter(Boolean).length}/${nodes.length}`,
  );
}

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const files = readdirSync(folder)
    .filter((f) => /\.(pln|pla)$/i.test(f))
    .sort();
  check(files.length > 0, `Archicad files in PLN_SAMPLES (${files.length})`);
  const wanted = new Set([...STRUCTURE_CLASSES, ...ATTRIBUTE_CLASSES]);
  for (const [i, f] of files.entries()) {
    const all = objectsInFile(readFileSync(join(folder, f)), wanted);
    const a = readAttributes(all);
    sweep(i + 1, readStructure(all), all, [a, ...a.modules]);
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
if (failures) process.exit(1);
