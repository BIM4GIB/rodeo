// Checks the construction element reader (./construction.ts) under Node. Run from web/:
//   npx tsx src/import/archicad/construction.check.ts
// Made-up objects built here, laid out as Archicad lays them out, read back: a wall (Archicad 27
// framing, with a footprint, a top link through a floor indirection and a door), a slab (29 framing,
// an outline with a hole and an arc, edge records, its box), a roof (25 framing, a sloped plane), a
// mesh (outline heights, level points, a ridge) and a morph (29 framing, a cube body placed by a
// matrix, triangulated outward). With PLN_SAMPLES set to a folder of .pln/.pla files it also reads
// every object of these classes in each file and checks what came out is plausible: numbers finite,
// sizes in range, outlines with area, stories, layers and attributes that resolve, walls' stored
// footprints lying on their faces, slabs' and meshes' cached boxes agreeing with their heights,
// top-linked walls' stored heights agreeing with their stories. Nothing from those files is printed
// but counts.
//   PLN_SAMPLES=~/samples npx tsx src/import/archicad/construction.check.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTRIBUTE_CLASSES, readAttributes, type ArchicadDatabaseAttributes } from "./attributes.ts";
import { CONSTRUCTION_CLASSES, flattenPolygon, internals, readConstruction, roofUndersideAt, wallTop, type Point2, type Polygon, type Wall } from "./construction.ts";
import { objectsInFile, type ArchicadObject } from "./objects.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

// ---- writing made-up objects --------------------------------------------------------------------

class Bytes {
  readonly b: number[] = [];
  get length(): number {
    return this.b.length;
  }
  u8(v: number): this {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v).u8(v >> 8);
  }
  u32(v: number): this {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  i32(v: number): this {
    return this.u32(v >>> 0);
  }
  f64(v: number): this {
    const a = new Uint8Array(new Float64Array([v]).buffer);
    for (const x of a) this.b.push(x);
    return this;
  }
  hex(h: string): this {
    for (let i = 0; i < h.length; i += 2) this.b.push(parseInt(h.slice(i, i + 2), 16));
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.b.push(0);
    return this;
  }
  /** pad with zeros up to base + off */
  to(base: number, off: number): this {
    if (this.length > base + off) throw new Error(`layout overrun at +${off.toString(16)}`);
    return this.zeros(base + off - this.length);
  }
  str(s: string): this {
    this.u16(1).u32(s.length);
    for (const c of s) this.u16(c.charCodeAt(0));
    return this;
  }
  attr(v: number): this {
    return this.u16(1).i32(v);
  }
  surface(v: number, overridden: boolean, version: 25 | 27 | 29): this {
    return version === 25 ? this.u16(2).u8(overridden ? 1 : 0).i32(v) : this.u16(3).u8(overridden ? 1 : 0).u16(1).i32(v);
  }
  put(o: Bytes | number[]): this {
    for (const x of o instanceof Bytes ? o.b : o) this.b.push(x);
    return this;
  }
  patchU32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.b[at + i] = (v >>> (8 * i)) & 0xff;
  }
  data(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

const { CLASS, LINK } = internals;
const GUID = (n: number): string => n.toString(16).padStart(2, "0").repeat(16);
const FLOOR = GUID(0xa1);
const TOP_FLOOR = GUID(0xa2);

interface Opts {
  readonly version: 25 | 27 | 29;
  readonly layer: number;
  readonly story: number;
  readonly id: string;
  readonly wall?: boolean;
  /** extra bytes before the header in 29 (roofs keep 8) */
  readonly extra29?: number;
  readonly links?: readonly [number, string, readonly string[]][];
}

/** An element payload: class GUID, object header, base-class chain, element header, `body(w, start)`, links. */
function element(cls: string, o: Opts, body: (w: Bytes) => void): Uint8Array {
  const w = new Bytes().hex(cls);
  w.u8(2).u16(0).u32(7).u32(0).u32(1234).u32(0).u32(0);
  if (o.version === 25) w.hex("01000100070004008200030000 01".replace(/ /g, ""));
  else w.hex(`010001000900${o.version === 29 ? "83" : "82"}0003000001`);
  w.hex(cls).u16(2).u16(2).u16(1);
  if (o.version === 29) w.zeros(16).u32(4).zeros(4).u32(0).zeros(o.extra29 ?? 0);
  w.u8(0).attr(o.layer).u16(o.story & 0xffff).u16(0);
  if (o.version === 25) w.u32(0).attr(0);
  w.attr(0).u32(99);
  if (o.wall) w.attr(0).attr(0);
  w.str(o.id);
  body(w);
  w.patchU32(35, w.length - 39);
  const links = new Bytes().u16(1);
  for (const [tag, type, targets] of [[0x12, LINK.floor, [FLOOR]] as const, ...(o.links ?? [])]) {
    links.u8(tag).hex(type);
    if (tag === 0x01 || tag === 0x02) links.u32(targets.length);
    for (const t of targets) links.hex(t);
  }
  links.u8(0);
  return w.u32(links.length).put(links).data();
}

/** A Polygon2D: contours (each closed here), arcs as [contour, edge, angle]. */
function polygon(contours: readonly (readonly Point2[])[], arcs: readonly [number, number, number][] = []): Bytes {
  const pts: Point2[] = [];
  const ends: number[] = [0];
  const starts: number[] = [];
  for (const c of contours) {
    starts.push(pts.length + 1);
    pts.push(...c, c[0]);
    ends.push(pts.length);
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const body = new Bytes().u8(1).u16(0x1f).f64(Math.min(...xs)).f64(Math.min(...ys)).f64(Math.max(...xs)).f64(Math.max(...ys));
  body.u32(pts.length).u32(arcs.length).u32(contours.length).zeros(16);
  for (const p of pts) body.f64(p.x).f64(p.y);
  if (arcs.length) {
    body.zeros(16);
    for (const [c, e, a] of arcs) body.u32(starts[c] + e).u32(starts[c] + e + 1).f64(a);
  }
  for (const e of ends) body.u32(e);
  body.u16(1).u32(pts.length + 1).u32(0);
  for (let k = 1; k <= pts.length; k++) body.u32(100 + k);
  body.u16(1).u32(pts.length + 1).u32(0);
  for (let k = 1; k <= pts.length; k++) body.u32(k);
  body.u16(1).u32(contours.length + 1).u32(0);
  for (let k = 1; k <= contours.length; k++) body.u32(k);
  body.hex("010001000000");
  return new Bytes().u16(0x0102).u32(body.length).put(body);
}

const rect = (x: number, y: number, w: number, h: number): Point2[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const area = (c: readonly Point2[]): number => {
  let s = 0;
  for (let k = 0; k < c.length; k++) {
    const a = c[k];
    const b = c[(k + 1) % c.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};
const polygonArea = (p: Polygon): number => {
  const f = flattenPolygon(p, Math.PI / 90);
  return f.length ? Math.abs(area(f[0])) - f.slice(1).reduce((t, c) => t + Math.abs(area(c)), 0) : 0;
};

const obj = (guid: string, data: Uint8Array): ArchicadObject => ({ guid, data });

// ---- a wall (27) ---------------------------------------------------------------------------------

const DOOR = GUID(0xd0);
const INDIRECTION = GUID(0xb1);
{
  const t = 0.3;
  const off = 0.1;
  const wall = element(CLASS.wall, { version: 27, layer: 5, story: 1, id: "W-1", wall: true, links: [[0x11, LINK.topIndirection, [INDIRECTION]], [0x01, LINK.door, [DOOR]]] }, (w) => {
    const E = w.length;
    w.f64(1).f64(2).f64(6).f64(2);
    w.to(E, 0x38).attr(11).attr(12).attr(13).u8(1).u8(0).u8(0);
    w.f64(t).f64(t).to(E, 0x75).f64(0);
    w.to(E, 0x91).f64(-0.2).f64(2.8).f64(0.1);
    w.to(E, 0xb8).u16(0).f64(Math.PI / 2).f64(Math.PI / 2);
    w.to(E, 0xd5).attr(21).to(E, 0xe1).u16(2).attr(31);
    w.u8(0).u32(0).attr(0).u8(0).i32(0).f64(off).zeros(3).u32(4);
    // footprint: the outside face is the reference line moved 0.1 left, the inside face 0.3 further right
    w.put(polygon([[{ x: 1, y: 2.1 }, { x: 1, y: 1.8 }, { x: 6, y: 1.8 }, { x: 6, y: 2.1 }]]));
    w.u32(0).f64(1).f64(1.8).f64(6).f64(2.1).f64(0.1).f64(2.9).zeros(25);
  });
  // the floor indirection object: its link to the top story's EDB::Floor
  const ind = new Bytes().hex(CLASS.floorIndirection).u8(2).u16(0).u32(1).u32(0).u32(0).u32(0).u32(4).u32(0);
  const links = new Bytes().u16(1).u8(0x12).hex(LINK.indirectionFloor).hex(TOP_FLOOR).u8(0);
  ind.put(new Bytes().u32(links.length).put(links));
  const c = readConstruction(
    new Map([
      [CLASS.wall, [obj(GUID(0x01), wall)]],
      [CLASS.floorIndirection, [obj(INDIRECTION, ind.data())]],
    ]),
  );
  const w = c.walls[0];
  check(c.walls.length === 1 && Object.keys(c.problems).length === 0, "wall: decodes");
  check(w?.id === "W-1" && w.layer === 5 && w.story === 1 && w.floor === FLOOR && w.version === 27, "wall: ID, layer, story and its EDB::Floor");
  check(w !== undefined && near(w.begin.x, 1) && near(w.end.x, 6) && near(w.thickness, t) && near(w.bottomOffset, 0.1) && near(w.height, 2.8) && near(w.topOffset, -0.2), "wall: reference line, thickness, heights");
  check(w?.topFloor === TOP_FLOOR, "wall: the top-linked story through its floor indirection");
  // the linked top wins over the stored height: home story at 1, top story at 4.5 → 3.5 - 0.2
  const levels = new Map([[FLOOR, 1], [TOP_FLOOR, 4.5]]);
  check(w !== undefined && near(wallTop(w, (g) => levels.get(g)), 3.3) && near(wallTop({ ...w, topFloor: null }, (g) => levels.get(g)), 2.9), "wall: top from the linked story, else bottom + height");
  check(w !== undefined && w.structure === "composite" && w.buildingMaterial === 21 && w.composite === 31 && w.surfaces[0].index === 11 && w.surfaces[0].overridden && !w.surfaces[1].overridden, "wall: structure, material, composite, surfaces");
  check(w !== undefined && near(w.faces.outside, off) && near(w.faces.insideBegin, off - t) && w.footprint?.contours[0].length === 4, "wall: faces from the reference offset, and the footprint");
  check(w !== undefined && w.footprint !== null && onFaces(w) === 4, "wall: the footprint lies on the faces");
  check(w?.openings.length === 1 && w.openings[0] === DOOR, "wall: its door");
  check(w?.box !== null && near(w?.box?.max.z ?? 0, 2.9), "wall: the cached box");
}

/** How many of a wall's footprint points lie on its faces (straight) or their arcs (curved). */
function onFaces(w: Wall, eps = 0.02): number {
  const pts = w.footprint?.contours.flat() ?? [];
  const dx = w.end.x - w.begin.x;
  const dy = w.end.y - w.begin.y;
  const len = Math.hypot(dx, dy);
  const lo = Math.min(w.faces.outside, w.faces.insideBegin, w.faces.insideEnd) - eps;
  const hi = Math.max(w.faces.outside, w.faces.insideBegin, w.faces.insideEnd) + eps;
  if (w.centre) {
    const r = Math.hypot(w.begin.x - w.centre.x, w.begin.y - w.centre.y);
    const s = w.arcAngle > 0 ? -1 : 1; // the left normal points away from the centre on a clockwise arc
    return pts.filter((p) => {
      const d = s * (Math.hypot(p.x - w.centre!.x, p.y - w.centre!.y) - r);
      return d >= lo && d <= hi;
    }).length;
  }
  const t = Math.max(w.thickness, w.endThickness) + Math.abs(w.referenceOffset) + eps;
  return pts.filter((p) => {
    const along = ((p.x - w.begin.x) * dx + (p.y - w.begin.y) * dy) / len;
    const side = (-(p.x - w.begin.x) * dy + (p.y - w.begin.y) * dx) / len;
    return side >= lo && side <= hi && along >= -t && along <= len + t;
  }).length;
}

// ---- a slab (29) -------------------------------------------------------------------------------

{
  const slab = element(CLASS.slab, { version: 29, layer: 3, story: 0, id: "S-1" }, (w) => {
    const E = w.length;
    w.f64(-0.25).u8(3).f64(0.25).f64(0.25).surface(41, false, 29).surface(42, true, 29);
    const S = w.length;
    w.to(S, 0x1c).attr(51).to(S, 0x28).u16(1).attr(0);
    w.u8(1).u32(0x14).u32(0xe0).zeros(96).hex("010200");
    // an outline whose first edge bulges outward (a quarter turn, counter-clockwise), and a square hole
    w.put(polygon([rect(0, 0, 4, 3), rect(1, 1, 1, 1)], [[0, 0, Math.PI / 2]]));
    w.u16(1).u16(1).u32(1).u32(101).u16(2).u16(1).f64(1.2).surface(43, true, 29).zeros(2);
    w.u16(2).u16(1).f64(Math.PI / 2).surface(44, false, 29).zeros(2);
    w.zeros(5).f64(0).f64(-1).f64(4).f64(3).f64(-0.25).f64(0).u8(1);
    void E;
  });
  const c = readConstruction(new Map([[CLASS.slab, [obj(GUID(0x02), slab)]]]));
  const s = c.slabs[0];
  check(c.slabs.length === 1 && Object.keys(c.problems).length === 0, "slab: decodes (Archicad 29 framing)");
  check(s !== undefined && s.version === 29 && s.layer === 3 && s.id === "S-1" && s.floor === FLOOR, "slab: ID, layer, story");
  check(s !== undefined && near(s.top, 0) && near(s.thickness, 0.25) && s.referencePlane === 3, "slab: top from the level and the offset from the top");
  check(s !== undefined && s.outline.contours.length === 2 && s.outline.arcs.length === 1 && s.outline.arcs[0].edge === 0, "slab: outline with a hole and an arc");
  // the circular segment a quarter-turn arc adds on a 4 m chord (radius 2√2)
  const segment = (2 * Math.SQRT2) ** 2 * (Math.PI / 2 - 1) / 2;
  check(s !== undefined && near(polygonArea(s.outline), 12 + segment - 1, 1e-2), "slab: area with the arc's segment, less the hole");
  check(s !== undefined && s.structure === "basic" && s.buildingMaterial === 51 && s.surfaces.top.index === 41 && s.surfaces.bottom.overridden && s.surfaces.side?.index === 44, "slab: material and surfaces, the side from the default edge");
  check(s?.edges.length === 1 && s.edges[0].edge === 101 && near(s.edges[0].angle, 1.2) && s.edges[0].surface.index === 43, "slab: edge records");
  check(s?.box !== null && near(s?.box?.min.z ?? 1, -0.25), "slab: the cached box");
}

// ---- a roof (25) -------------------------------------------------------------------------------

{
  const slope = 30;
  const roof = element(CLASS.roof, { version: 25, layer: 2, story: 1, id: "R-1" }, (w) => {
    w.u8(0).f64(0.2).surface(61, false, 25).surface(62, false, 25).attr(71).attr(72).zeros(30);
    const o = w.length;
    // pivot along +y at x = 0 from y 0 to 10; the plane rises to the left (-x)
    w.f64(0).f64(5).zeros(4).u16(1).f64(0).f64(1).f64(-1).f64(0);
    w.to(o, 131).f64(2.5).u8(0).f64(slope).f64(0).f64(10).f64(0).f64(0).zeros(4);
    w.put(polygon([rect(-6, 0, 6, 10)]));
    w.u16(1).u16(1).u32(0).u16(2).u16(1).f64(Math.PI / 2).surface(63, false, 25).zeros(2);
  });
  const c = readConstruction(new Map([[CLASS.roof, [obj(GUID(0x03), roof)]]]));
  const r = c.roofs[0];
  check(c.roofs.length === 1 && Object.keys(c.problems).length === 0, "roof: decodes (Archicad 25 framing)");
  check(r !== undefined && r.version === 25 && r.story === 1 && near(r.thickness, 0.2) && near(r.slope, Math.PI / 6) && near(r.level, 2.5), "roof: thickness, slope (degrees as stored) and level");
  check(r !== undefined && near(r.pivot.begin.y, 0) && near(r.pivot.end.y, 10) && r.buildingMaterial === 71 && r.composite === 72, "roof: pivot line and attributes");
  check(r !== undefined && near(roofUndersideAt(r, -6, 3), 2.5 + 6 * Math.tan(Math.PI / 6)) && near(roofUndersideAt(r, 0, 7), 2.5), "roof: underside rises left of the pivot line");
}

// ---- a mesh (27) -------------------------------------------------------------------------------

{
  const mesh = element(CLASS.mesh, { version: 27, layer: 4, story: 0, id: "M-1" }, (w) => {
    const E = w.length;
    w.f64(-1).attr(81).attr(82).to(E, 0x37).f64(0.5).to(E, 0x6a);
    w.put(polygon([rect(0, 0, 10, 10)]));
    w.u32(4).u32(4).u32(1);
    // three level points; the first two make a ridge, the third stands alone
    w.u16(1).u16(1).u32(3);
    for (const [x, y, z, id] of [[2, 2, 1, 1], [8, 2, 1.5, 2], [5, 8, 3, 3]]) w.u16(1).f64(x).f64(y).f64(z).u32(id);
    w.u16(1).u32(2).u32(2).u32(3).u32(4).u16(0x49);
    w.u16(1).u16(1).u32(4);
    for (let k = 1; k <= 4; k++) w.u32(100 + k).f64(k * 0.25);
    w.u8(1).u32(0x14).u32(0x20).zeros(96).zeros(40);
    w.f64(0).f64(0).f64(10).f64(10).f64(-1.5).f64(2).u8(1);
  });
  const c = readConstruction(new Map([[CLASS.mesh, [obj(GUID(0x04), mesh)]]]));
  const m = c.meshes[0];
  check(c.meshes.length === 1 && Object.keys(c.problems).length === 0, "mesh: decodes");
  check(m !== undefined && near(m.level, -1) && near(m.skirt, 0.5) && m.surfaces[0] === 81, "mesh: level, skirt, surfaces");
  check(m !== undefined && m.outline[0].map((p) => p.z).join(",") === "0.25,0.5,0.75,1", "mesh: outline heights by vertex id");
  check(m !== undefined && m.points.length === 3 && m.ridges.length === 1 && m.ridges[0].join(",") === "0,1", "mesh: level points and the ridge");
}

// ---- a morph (29) and its body -------------------------------------------------------------------

{
  const BODY = GUID(0xbb);
  // a unit cube; faces counter-clockwise seen from outside
  const V = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const F = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const edges: [number, number][] = [];
  const pedges: number[] = [];
  for (const f of F) {
    for (let k = 0; k < 4; k++) {
      const a = f[k];
      const b = f[(k + 1) % 4];
      let e = edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (e < 0) e = edges.push([a, b]) - 1;
      pedges.push(edges[e][0] === a ? e + 1 : -(e + 1));
    }
  }
  const body = new Bytes().hex(CLASS.body).zeros(195 - 16);
  body.u32(V.length);
  for (const v of V) body.f64(v[0]).f64(v[1]).f64(v[2]);
  body.u32(0).u32(edges.length);
  for (const [a, b] of edges) body.u16(0).zeros(6).u32(a).u32(b).i32(-1).i32(-1);
  body.u32(pedges.length);
  for (const p of pedges) body.i32(p);
  body.u32(0).u32(F.length);
  F.forEach((_, k) => body.u16(2).zeros(18).i32(0).i32(4 * k).i32(4 * k + 3).zeros(8));
  body.u32(V.length).u8(0xff).u16(1).u32(F.length);
  F.forEach((_, k) => body.surface(90 + k, false, 29));
  body.u16(1).u32(edges.length);
  for (let k = 0; k < edges.length; k++) body.u16(1);
  // placed: turned a quarter about z and moved to (10, 20, 3)
  const morph = element(CLASS.morph, { version: 29, layer: 6, story: 2, id: "", links: [[0x11, LINK.body, [BODY]]] }, (w) => {
    w.u8(0).u16(1).u16(0);
    for (const v of [0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 3]) w.f64(v);
  });
  const c = readConstruction(
    new Map([
      [CLASS.morph, [obj(GUID(0x05), morph)]],
      [CLASS.body, [obj(BODY, body.data())]],
    ]),
  );
  const m = c.morphs[0];
  check(c.morphs.length === 1 && Object.keys(c.problems).length === 0, "morph: decodes with its body");
  check(m !== undefined && m.triangles.length === 36 && m.failedPolygons === 0 && m.triangleSurfaces[0] === 90 && m.triangleSurfaces[11] === 95, "morph: six faces, twelve triangles, a surface each");
  check(m !== undefined && m.edges.length === 24 && [...m.edges].every((v) => v < 8), "morph: twelve edges between its vertices");
  let volume = 0;
  let minX = Infinity;
  let minZ = Infinity;
  if (m) {
    const p = m.positions;
    for (let k = 0; k < m.triangles.length; k += 3) {
      const [a, b, cc] = [3 * m.triangles[k], 3 * m.triangles[k + 1], 3 * m.triangles[k + 2]];
      volume += (p[a] * (p[b + 1] * p[cc + 2] - p[b + 2] * p[cc + 1]) - p[a + 1] * (p[b] * p[cc + 2] - p[b + 2] * p[cc]) + p[a + 2] * (p[b] * p[cc + 1] - p[b + 1] * p[cc])) / 6;
    }
    for (let k = 0; k < p.length; k += 3) [minX, minZ] = [Math.min(minX, p[k]), Math.min(minZ, p[k + 2])];
  }
  check(near(volume, 1, 1e-9), "morph: triangles wind outward (volume +1)");
  check(near(minX, 9) && near(minZ, 3), "morph: placed by its matrix");
}

// ---- the sample files ----------------------------------------------------------------------------

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const files = readdirSync(folder)
    .filter((f) => /\.(pln|pla)$/i.test(f))
    .sort();
  const wanted = new Set([...CONSTRUCTION_CLASSES, ...ATTRIBUTE_CLASSES]);
  const totals = new Map<string, [number, number]>();
  const add = (k: string, ok: number, n: number): void => {
    const t = totals.get(k) ?? [0, 0];
    totals.set(k, [t[0] + ok, t[1] + n]);
  };
  for (const [i, file] of files.entries()) {
    const objects = objectsInFile(readFileSync(join(folder, file)), wanted);
    const c = readConstruction(objects);
    const a = readAttributes(objects);
    const n = (cls: string): number => objects.get(cls)?.length ?? 0;
    const counts: [string, number, number][] = [
      ["walls", c.walls.length, n(CLASS.wall)],
      ["slabs", c.slabs.length, n(CLASS.slab)],
      ["roofs", c.roofs.length, n(CLASS.roof)],
      ["meshes", c.meshes.length, n(CLASS.mesh)],
      ["morphs", c.morphs.length, n(CLASS.morph)],
      ["shells", c.shells.length, n(CLASS.shell)],
    ];
    for (const [k, ok, all] of counts) add(k, ok, all);
    console.log(`file ${i + 1}: ${counts.map(([k, ok, all]) => `${k} ${ok}/${all}`).join(", ")}`);
    check(Object.keys(c.problems).length === 0, `file ${i + 1}: every object of the construction classes decodes`);

    // stories, layers and attributes resolve (in any of the file's databases)
    const dbs: ArchicadDatabaseAttributes[] = [a, ...a.modules];
    const story = new Map(dbs.flatMap((d) => d.stories.map((s) => [s.guid, s] as const)));
    const layers = new Set(dbs.flatMap((d) => d.layers.map((l) => l.index)));
    const materials = new Set(dbs.flatMap((d) => d.buildingMaterials.map((x) => x.index)));
    const composites = new Set(dbs.flatMap((d) => d.composites.map((x) => x.index)));
    const surfaces = new Set(dbs.flatMap((d) => d.surfaces.map((x) => x.index)));
    const all = [...c.walls, ...c.slabs, ...c.roofs, ...c.meshes, ...c.morphs, ...c.shells];
    const floors = all.filter((e) => e.floor !== null && story.has(e.floor));
    const numbered = floors.filter((e) => story.get(e.floor!)!.index === e.story);
    check(floors.length === all.length, `file ${i + 1}: home stories (EDB::Floor links) resolve ${floors.length}/${all.length}`);
    check(numbered.length === floors.length, `file ${i + 1}: stored story numbers match their floors ${numbered.length}/${floors.length}`);
    const onLayers = all.filter((e) => layers.has(e.layer)).length;
    check(onLayers >= 0.99 * all.length, `file ${i + 1}: layers resolve ${onLayers}/${all.length}`);
    const refs = (xs: readonly number[], set: ReadonlySet<number>): [number, number] => [xs.filter((x) => set.has(x)).length, xs.length];
    const bm = refs([...c.walls.filter((w) => w.structure === "basic").map((w) => w.buildingMaterial), ...c.slabs.filter((s) => s.structure === "basic").map((s) => s.buildingMaterial), ...c.roofs.map((r) => r.buildingMaterial)], materials);
    const cp = refs([...c.walls.filter((w) => w.structure === "composite").map((w) => w.composite), ...c.slabs.filter((s) => s.structure === "composite").map((s) => s.composite)], composites);
    const sf = refs([...c.walls.flatMap((w) => w.surfaces.map((s) => s.index)), ...c.slabs.flatMap((s) => [s.surfaces.top.index, s.surfaces.bottom.index]), ...c.morphs.flatMap((m) => [...m.triangleSurfaces].filter((x) => x >= 0))], surfaces);
    check(bm[0] >= 0.99 * bm[1] && cp[0] >= 0.99 * cp[1] && sf[0] >= 0.99 * sf[1], `file ${i + 1}: building materials ${bm[0]}/${bm[1]}, composites ${cp[0]}/${cp[1]}, surfaces ${sf[0]}/${sf[1]} resolve`);

    // walls
    const level = (g: string | null): number => (g && story.has(g) ? story.get(g)!.level : NaN);
    const levelOf = (g: string): number | undefined => story.get(g)?.level;
    const heightOf = (w: Wall): number => wallTop(w, levelOf) - w.bottomOffset;
    // complex-profile walls take their thickness from the profile's width, which can be large
    const wallOk = c.walls.filter((w) => {
      const len = Math.hypot(w.end.x - w.begin.x, w.end.y - w.begin.y);
      const tMax = w.structure === "profile" ? 50 : 5;
      const h = heightOf(w);
      return len > 0 && len < 2000 && w.thickness > 0 && w.thickness <= tMax && w.endThickness > 0 && w.endThickness <= tMax && h > 0 && h < 500;
    }).length;
    const tiny = c.walls.filter((w) => Math.hypot(w.end.x - w.begin.x, w.end.y - w.begin.y) < 1e-3).length;
    check(wallOk === c.walls.length, `file ${i + 1}: walls: lengths, thicknesses and heights (linked tops from story levels) in range ${wallOk}/${c.walls.length} (shorter than 1 mm: ${tiny})`);
    const withPrint = c.walls.filter((w) => w.footprint && w.structure !== "profile");
    const lying = withPrint.filter((w) => onFaces(w) === w.footprint!.contours.flat().length).length;
    // one sample keeps many footprints from before its walls were edited, so this is reported, and
    // checked only where most footprints are current
    if (lying >= 0.5 * withPrint.length) check(lying >= 0.9 * withPrint.length, `file ${i + 1}: walls: stored footprints on the faces ${lying}/${withPrint.length}`);
    else console.log(`  note: file ${i + 1}: walls: stored footprints on the faces ${lying}/${withPrint.length} (stale footprints, not checked)`);
    const linkedTop = c.walls.filter((w) => w.topFloor !== null && story.has(w.topFloor) && w.floor !== null);
    const stale = linkedTop.filter((w) => !near(w.height, heightOf(w), 1e-3)).length;
    console.log(`  file ${i + 1}: walls: top-linked ${linkedTop.length}, of which the stored height differs from the linked top ${stale}`);
    // boxes are in the host project's levels, so walls of a hotlinked module are shifted by its
    // placement: the box's height is checked, its bottom only reported
    const withBox = c.walls.filter((w) => w.box && w.floor);
    const boxHeight = withBox.filter((w) => near(w.box!.max.z - w.box!.min.z, heightOf(w), 1e-3)).length;
    const boxBottom = withBox.filter((w) => near(w.box!.min.z, level(w.floor) + w.bottomOffset, 1e-3)).length;
    check(boxHeight >= 0.9 * withBox.length, `file ${i + 1}: walls: cached box heights agree with bottom and top ${boxHeight}/${withBox.length} (bottoms at the home story ${boxBottom})`);

    // slabs
    // slabs also serve as massing blocks, so thickness is allowed up to 100 m
    const slabOk = c.slabs.filter((s) => s.thickness > 0 && s.thickness <= 100 && polygonArea(s.outline) > 0).length;
    check(slabOk === c.slabs.length, `file ${i + 1}: slabs: thickness in range, outline area > 0 ${slabOk}/${c.slabs.length}`);
    const slabBox = c.slabs.filter((s) => s.box && s.floor);
    const slabAgree = slabBox.filter((s) => near(s.box!.max.z, level(s.floor) + s.top, 1e-3) && near(s.box!.min.z, level(s.floor) + s.top - s.thickness, 1e-3)).length;
    check(slabAgree >= 0.9 * slabBox.length, `file ${i + 1}: slabs: cached boxes agree with top and thickness ${slabAgree}/${slabBox.length}`);

    // roofs
    const roofOk = c.roofs.filter((r) => r.thickness > 0 && r.thickness <= 3 && Math.abs(r.slope) < (85 * Math.PI) / 180 && polygonArea(r.outline) > 0 && Math.hypot(r.pivot.end.x - r.pivot.begin.x, r.pivot.end.y - r.pivot.begin.y) > 1e-3).length;
    check(roofOk === c.roofs.length, `file ${i + 1}: roofs: thickness and slope in range, outline area > 0, a pivot line ${roofOk}/${c.roofs.length}`);

    // meshes
    const meshOk = c.meshes.filter((m) => polygonArea(m.outlinePolygon) > 0).length;
    check(meshOk === c.meshes.length, `file ${i + 1}: meshes: outline area > 0 ${meshOk}/${c.meshes.length}`);
    const meshBox = c.meshes.filter((m) => m.box && m.floor);
    const meshAgree = meshBox.filter((m) => {
      const top = Math.max(...m.outline.flat().map((p) => p.z), ...m.points.map((p) => p.z));
      return near(m.box!.max.z, level(m.floor) + m.level + top, 1e-3) && near(m.box!.min.z, level(m.floor) + m.level - m.skirt, 1e-3);
    }).length;
    check(meshAgree >= 0.9 * meshBox.length, `file ${i + 1}: meshes: cached boxes agree with level, heights and skirt ${meshAgree}/${meshBox.length}`);

    // morphs and shells
    const nv = (m: { positions: Float64Array }): number => m.positions.length / 3;
    const morphOk = c.morphs.filter((m) => m.positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6) && m.triangles.length + m.edges.length > 0 && m.triangles.every((t) => t < nv(m)) && m.edges.every((e) => e < nv(m))).length;
    const edgeOnly = c.morphs.filter((m) => m.triangles.length === 0).length;
    const failedPg = c.morphs.reduce((t, m) => t + m.failedPolygons, 0);
    check(morphOk === c.morphs.length && failedPg === 0, `file ${i + 1}: morphs: finite positions, triangles or edges ${morphOk}/${c.morphs.length} (edges only: ${edgeOnly}), untriangulated polygons ${failedPg}`);
    const shellOk = c.shells.filter((s) => s.thickness > 0 && s.matrix !== null).length;
    check(shellOk === c.shells.length, `file ${i + 1}: shells: thickness and placement ${shellOk}/${c.shells.length}`);
  }
  console.log(`\nall files: ${[...totals].map(([k, [ok, all]]) => `${k} ${ok}/${all}`).join(", ")}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
