// Archicad's main construction elements, decoded from their objects (gathered by ./objects.ts):
// walls, slabs, roofs, meshes, morphs and shells, with the geometry needed to rebuild them.
//
// The framework every element here shares. A payload is the class GUID, the 23-byte object header
// (whose last u32 is the length of the first section, which starts at byte 39), the first section,
// then a links section: a u32 length, u16 1, then entries until a 00 byte; an entry is a tag byte, a
// link-type GUID and its targets (tag 11 one target and 01 a u32 count then that many: links the
// object owns; 12 and 02 the same for links back to an owner, such as an element's EDB::Floor). The
// first section opens with a chain of base-class versions ending 8x 00 03 00 00 01, the class GUID
// again, a u16 count and that many u16 versions; x is 83 in Archicad 29 and 82 in 25 and 27, and in
// 25 the u16 before it is 04 (09 in 27 and 29), which tells the three apart. In 29 the class data
// then starts with 16 bytes, a u32 m, m bytes and a u32 (m differs by class: roofs keep 8 bytes
// more than walls); in 25 and 27 it starts with the element header at once.
//
// The element header (every class here): a flags byte; 01 00 and the layer (i32, a VBAttr::Layer
// index); the story (i16, the EDB::Floor index, then a u16); in 25 ten more bytes (u32, 01 00,
// u32); 01 00 and an i32; a u32 serial; then, for walls, 01 00 + a u32 counter and 01 00 + a u32
// count of 22-byte gable records (06 00, a GUID, a u32); then the element ID (01 00, a u32
// count, UTF-16). The home story is also the element's link (0312b679…, owner side) to its
// EDB::Floor object, which is what tells stories of different databases (hotlinked modules) apart.
// Attribute references are 01 00 + i32 index; "overridden" ones (surfaces) are 03 00, a flag byte,
// 01 00, i32 in 27 and 29, and 02 00, a flag byte, i32 in 25.
//
// A polygon (Archicad's Polygon2D) is 02 01 and a u32 size, then size bytes: a flag byte, a u16
// version (1f, or 0f in some), the bounding box (x0, y0, x1, y1), u32 counts of vertices nV, arcs
// nA and contours nC, the vertices (nV + 1 points, the first unused; absent when nV is 0), the arcs
// when nA > 0 (nA + 1 records, the first unused: begin and end vertex index, u32, and the signed
// angle, f64, counter-clockwise positive), nC + 1 u32 contour ends (the first 0, then each contour's
// last vertex, 1-based; each contour repeats its first vertex at its end; the first contour is the
// outline, the others holes), then three lists (01 00, u32 count, u32s: vertex ids, edge ids,
// contour ids, each with an unused first entry) and a few closing bytes.
//
// Wall. After the ID (the same in 25, 27 and 29): the reference line's begin x, y and end x, y; six
// i32; three surfaces (01 00 + i32 at +0x38, +0x3e, +0x44: taken as the reference side, the
// opposite side and the edges; which is which isn't confirmed) and their three overridden flags at
// +0x4a; the thickness at +0x4d and the thickness at the end at +0x55 (different for a trapezoid
// wall); the arc angle at +0x75 (0 straight, else the curved wall's central angle); the top offset
// (from the top-linked story) at +0x91, the height at +0x99 and the bottom offset (from the home
// story) at +0xa1. A wall whose top is linked to a story keeps its top there (that story's level plus
// the top offset); its stored height is then usually stale or 0, so wallTop() works the top out from the
// story levels. An unlinked wall's top is the bottom offset plus the height (its top offset is left
// over from an old link and means nothing); the profile type (u16 at +0xb8: 0 straight, 1 slanted, 2 double slanted) and the
// two slant angles at +0xba and +0xc2 (π/2 upright; the first keeps a stale default on straight
// walls); the building material (i32 at +0xd7), the structure (u16 at +0xe1: 1 basic, 2 composite, 3
// complex profile) and the composite (i32 at +0xe5). At +0xe9: a byte and a u32; in 25 and 27 the
// gable list (01 00, u32 count, 22-byte records); then a flip byte, the reference line location
// (i32: 0 outside face, 1 centre, 2 inside face, 3-5 the same for the core), the reference line
// offset (f64: from the reference line to the outside face), three bytes, a u32 (4 when a footprint
// follows, 0 when it is empty), the footprint polygon, then 77 bytes: a u32, the 3D box (x0, y0, x1,
// y1, z0, z1; zero in 25 and 27), six i32 and a byte. The geometry: with n the left normal of
// begin→end, the outside face is the reference line moved by +offset (-offset when flipped) along
// n, the inside face a thickness further in (-thickness, or +thickness when flipped). Checked against
// the stored footprints, which are the plan outline of the wall (some are stale copies, and many 25
// files store none, so the reference line, thickness and offsets are what to build from). A wall
// with a complex profile links (32763ee6…) to an object holding the profile's geometry; its profile
// attribute index isn't stored inline. Doors and windows in the wall are its links 02fe6b1f… and
// e67943c5…; the top-linked story is a link (47cc487b…) to an EDB::FloorIndirection whose own link
// (805bf9ba…) is the EDB::Floor.
//
// Slab (class Ceil). After the ID: the level (f64), the reference plane (byte: 0 top, 3 bottom), the
// offset from the top (0, or the thickness when the reference plane is the bottom) and the
// thickness; two overridden surfaces (taken as top and bottom); then 0x1c bytes on 01 00 + the
// building material, at +0x28 the structure (u16: 1 basic, 2 composite) and at +0x2a 01 00 + the
// composite; then a texture-projection record (01, a u32 type, then type-dependent data) and 01 02
// 00 before the outline polygon. After it: 01 00 01 00, a u32 count of edge records (u32 edge id,
// u16 trim type, u16, the edge angle f64, π/2 vertical, an overridden surface, two bytes), the
// default edge record (no id: its surface is the slab's side surface), more bytes, and the slab's 3D
// box (x0, y0, x1, y1, z0, z1, absolute) with a byte just before the links section. Heights: the top
// is the home story's level + level + offset from the top; the bottom is the top - thickness.
//
// Roof (class Roof, single-plane in every sample; no other roof class is present). After the ID: a
// byte, the thickness (f64), two overridden surfaces, two attributes (01 00 + i32 each: building
// material and composite, by the attribute lists they fall in), a u16, four u16, an i32 and 16 bytes;
// then (at o) the pivot line's midpoint (x, y), 6 bytes, the pivot direction as a 2x2 rotation (cos,
// sin, -sin, cos), an f64, 41 bytes, a u16, a point, an f64 and two bytes, at o+131 the level (f64:
// the underside's height at the pivot line above the home story), a byte, at o+140 the slope in
// degrees (as stored; negative slopes down to the left), the pivot line's end and begin points
// (o+148, o+164; begin→end is the stored direction), 4 bytes and at o+184 the outline polygon,
// followed by edge records as for slabs. The underside at a point p is level + d·tan(slope), d the
// signed distance of p from the pivot line along the left normal of begin→end, and the top is a
// thickness / cos(slope) above it. Checked against the roofs' drawings in sections and elevations
// (their lowest and highest points). Multi-plane roofs (pivot polygons, per-edge slopes) don't
// occur in the samples, so their class and layout are unknown.
//
// Mesh. After the ID: the level (f64, above the home story), 01 00 + i32 twice (surfaces, taken as
// top and sides), a few u16/i32, at +0x37 the skirt (f64: the flat bottom is level - skirt), then
// the outline polygon. After it: three u32; the level points (01 00 01 00, a u32 count, then per
// point 01 00, x, y, z (f64, above the level) and a u32 id); the ridges (01 00, a u32 count of
// ridge ends: 1-based last point of each run of level points, a single point being a run of one),
// a u32 (the next id), a u16; the outline heights (01 00 01 00, a u32 count, then per outline vertex
// its vertex id, u32, and its height above the level, f64); a texture record; then the mesh's 3D box
// (absolute z) as for slabs. Checked: the box's top is story + level + the highest point and its
// bottom story + level - skirt. Each mesh also owns a MeshTriangulationCache (not read here).
//
// Morph (class VBElem::FreeShape). After the ID: a byte, two u16, then the placement as a 3x4
// matrix (rows: x', y', z' = row · (x, y, z, 1)), mapping the body's coordinates to the plan with z
// above the home story (checked against the morphs' drawings in sections, and against the stories:
// morph bottoms sit near their own story's level, not the project's zero). The body is a separate
// VBElem::BodyData object (link 6bfa7fd5…; several morphs can share none, each has its own). A body,
// from byte 195 of its payload: a u32 vertex count and the vertices (x, y, z, f64); a u32 count of
// f64 curve parameters and those; a u32 edge count and 24-byte edges (u16 flags, 6 bytes, the two
// vertex indices, the two polygons either side, -1 for none); a u32 count of polygon edges (i32:
// ±(edge index + 1), negative running the edge backwards, 0 starting a hole); a u32 count of normals
// (x, y, z); a u32 count of 40-byte polygons (u16 flags, ..., at +20 the normal index, 1-based, then
// the first and last of its polygon edges, 0-based, inclusive); a u32 count of vertex flag bits and
// those bits; 01 00, a u32 count and that many overridden surfaces, one per polygon; 01 00, a u32
// count and one pen (u16) per edge. Polygons are triangulated here (earcut, in the polygon's plane).
//
// Shell (class GUID 6620e48d…, its name isn't stored in the samples; present only in one Archicad 25
// file). It shares the roof's opening fields (thickness, surfaces, the pivot frame), then holds a
// placement point and, after 00 01 80 00, a 3x4 matrix, then the shell's profile polylines and
// extrusion/revolution data, which aren't decoded: shells come out with thickness and placement
// only.
//
// Connection objects (not read here): WallSlab, WallBeam, ColumnWall, BeamSlab, SlabColumn, BeamBeam,
// BeamColumn record a junction between two elements (their links name both, and a JCTN::JunctionSet
// owns them): which one cuts the other where they meet. NWall records a wall-to-wall junction (two
// walls and the joint's position along them) and NWallGroup groups the NWalls meeting at a point.
// None carries geometry needed to rebuild the elements.

import earcut from "earcut";
import { f64, hex, i32, u16, u32, utf16At, type ArchicadObject, type ObjectsByClass } from "./objects.ts";

/** Class GUIDs (hex as stored) of the classes this module reads. */
const CLASS = {
  wall: "8245654faf33524eabfcc35d46765ec4",
  slab: "75125c944879d44187449d22d72ca486",
  roof: "21764c9de9512345a3baf2121777bcbe",
  mesh: "46ee2f8f3f6aac41a32b69e44dc6276d",
  morph: "7b3c36e60e94eb4daf958b3b39e86bd2",
  body: "ad8c58f158255c49820bf3bcf4651007",
  shell: "6620e48d6239ea42ab5c2fe3276e7792",
  floorIndirection: "4d04d664e803ec42bd568813cc6481cb",
} as const;

const NAME: Readonly<Record<string, string>> = {
  [CLASS.wall]: "Wall",
  [CLASS.slab]: "Ceil",
  [CLASS.roof]: "Roof",
  [CLASS.mesh]: "Mesh",
  [CLASS.morph]: "VBElem::FreeShape",
  [CLASS.body]: "VBElem::BodyData",
  [CLASS.shell]: "shell (class name not stored in any sample)",
  [CLASS.floorIndirection]: "EDB::FloorIndirection",
};

/** Link types (hex GUIDs) between the objects. */
const LINK = {
  floor: "0312b67984ae884da9c620ead705e0bc",
  topIndirection: "47cc487b6772fd4c91339214ea18fb99",
  indirectionFloor: "805bf9ba56f23249b89103ff66848591",
  door: "02fe6b1f0cd6ae409ac8c3953ce12814",
  window: "e67943c5d0af9a4b9887af5baeeccf84",
  skylight: "57ad135b9577b5429762c3037113fa83",
  body: "6bfa7fd50fc17f4fabe60fd52f2cc23e",
  wallProfile: "32763ee6fd0e2d418077d3f3906b638a",
} as const;

/** The classes this module reads (elements, morph bodies, and the floor indirections of top-linked walls). */
export const CONSTRUCTION_CLASSES: ReadonlySet<string> = new Set(Object.values(CLASS));

export const constructionClassName = (guid: string): string => NAME[guid] ?? guid;

// ---- output types ------------------------------------------------------------------------------

export interface Point2 {
  readonly x: number;
  readonly y: number;
}
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export interface Box3 {
  readonly min: Point3;
  readonly max: Point3;
}

/** An arc on a polygon edge: the edge from contour[edge] to the next point bulges by `angle` (radians, counter-clockwise positive). */
export interface PolygonArc {
  readonly contour: number;
  readonly edge: number;
  readonly angle: number;
}

/** A plan polygon: the outline then holes; each contour's points once (Archicad's repeated closing point dropped). */
export interface Polygon {
  readonly contours: readonly (readonly Point2[])[];
  readonly arcs: readonly PolygonArc[];
  /** Archicad's vertex id per point, contour by contour (mesh heights refer to them) */
  readonly vertexIds: readonly (readonly number[])[];
}

/** An attribute reference that can be overridden on the element (surfaces). */
export interface Overridable {
  readonly index: number;
  readonly overridden: boolean;
}

/** What every element here carries. */
export interface ConstructionBase {
  /** the object's GUID */
  readonly guid: string;
  /** the element ID */
  readonly id: string;
  /** the home story's EDB::Floor object GUID (its link); null when missing */
  readonly floor: string | null;
  /** the home story's number as the element stores it (the EDB::Floor index) */
  readonly story: number;
  /** a VBAttr::Layer attribute index */
  readonly layer: number;
  readonly version: 25 | 27 | 29;
}

export type WallStructure = "basic" | "composite" | "profile";

export interface Wall extends ConstructionBase {
  /** reference line in plan */
  readonly begin: Point2;
  readonly end: Point2;
  /** central angle of a curved wall (signed, counter-clockwise positive), 0 when straight */
  readonly arcAngle: number;
  /** a curved wall's centre, null when straight */
  readonly centre: Point2 | null;
  readonly thickness: number;
  /** thickness at the end (differs from `thickness` on a trapezoid wall) */
  readonly endThickness: number;
  /** bottom above the home story */
  readonly bottomOffset: number;
  /** stored height: the wall's height when the top isn't linked; usually stale or 0 when it is (use wallTop) */
  readonly height: number;
  /** top relative to the top-linked story, when linked (meaningless otherwise) */
  readonly topOffset: number;
  /** the top-linked story's EDB::Floor GUID; null when the top isn't linked */
  readonly topFloor: string | null;
  /** reference line location: 0 outside face, 1 centre, 2 inside face, 3-5 the same for the core */
  readonly referenceLocation: number;
  /** distance from the reference line to the outside face, as stored */
  readonly referenceOffset: number;
  readonly flipped: boolean;
  /**
   * Where the faces are: signed distances from the reference line along its left normal (-dy, dx)/length,
   * at the begin and at the end (they differ on a trapezoid wall).
   */
  readonly faces: { readonly outside: number; readonly insideBegin: number; readonly insideEnd: number };
  /** 0 straight, 1 slanted, 2 double slanted (other values as stored) */
  readonly profileType: number;
  /** slant angles (π/2 upright); meaningful only for slanted profiles */
  readonly slantAlpha: number;
  readonly slantBeta: number;
  readonly structure: WallStructure | null;
  /** VBAttr::BuildingMaterial index (the wall's material when basic) */
  readonly buildingMaterial: number;
  /** VBAttr::Composite index (meaningful when the structure is composite) */
  readonly composite: number;
  /** the object holding a complex profile's geometry, when the structure is a profile */
  readonly profileObject: string | null;
  /** reference side, opposite side, edges (order not confirmed) */
  readonly surfaces: readonly [Overridable, Overridable, Overridable];
  /** the plan outline as Archicad cached it; null when it stores none (rebuild from the reference line then) */
  readonly footprint: Polygon | null;
  /** the 3D box Archicad cached (Archicad 29 only; absolute z) */
  readonly box: Box3 | null;
  /** doors and windows in the wall (their object GUIDs) */
  readonly openings: readonly string[];
  /** gable records (GUIDs as stored) */
  readonly gables: readonly string[];
}

export interface SlabEdge {
  /** the polygon edge id it applies to */
  readonly edge: number;
  /** angle of the edge face (π/2 vertical) */
  readonly angle: number;
  readonly surface: Overridable;
}

export interface Slab extends ConstructionBase {
  /** level as stored (the reference plane's height above the home story) */
  readonly level: number;
  /** 0 top, 3 bottom */
  readonly referencePlane: number;
  readonly offsetFromTop: number;
  readonly thickness: number;
  /** top above the home story (level + offset from the top); the bottom is top - thickness */
  readonly top: number;
  readonly outline: Polygon;
  readonly structure: "basic" | "composite" | null;
  readonly buildingMaterial: number;
  readonly composite: number;
  /** top, bottom (order not confirmed), side */
  readonly surfaces: { readonly top: Overridable; readonly bottom: Overridable; readonly side: Overridable | null };
  /** per-edge records as stored (custom edge angles and surfaces) */
  readonly edges: readonly SlabEdge[];
  /** the 3D box Archicad cached (absolute z) */
  readonly box: Box3 | null;
}

export interface Roof extends ConstructionBase {
  readonly thickness: number;
  /** the pivot line; the roof rises to the left of begin→end for a positive slope */
  readonly pivot: { readonly begin: Point2; readonly end: Point2 };
  /** radians (Archicad stores degrees here) */
  readonly slope: number;
  /** the underside's height at the pivot line, above the home story */
  readonly level: number;
  readonly outline: Polygon;
  readonly buildingMaterial: number;
  readonly composite: number;
  /** top, bottom (order not confirmed) */
  readonly surfaces: readonly [Overridable, Overridable];
  readonly edges: readonly SlabEdge[];
  /** skylights in the roof */
  readonly openings: readonly string[];
}

export interface Mesh extends ConstructionBase {
  /** above the home story; every height below is above this level */
  readonly level: number;
  /** the flat bottom is level - skirt */
  readonly skirt: number;
  /** outline (then holes) with each point's height above the level */
  readonly outline: readonly (readonly Point3[])[];
  readonly outlinePolygon: Polygon;
  /** extra points inside, height above the level */
  readonly points: readonly Point3[];
  /** ridges: runs of `points` indices (two or more points each) */
  readonly ridges: readonly (readonly number[])[];
  /** two surfaces, taken as top and sides (order not confirmed) */
  readonly surfaces: readonly [number, number];
  /** the 3D box Archicad cached (absolute z) */
  readonly box: Box3 | null;
}

export interface Morph extends ConstructionBase {
  /** placement, rows of (x, y, z, translation); applied already to `positions` */
  readonly matrix: readonly number[];
  /** the body object (VBElem::BodyData); null when missing */
  readonly body: string | null;
  /** x, y, z per vertex: plan coordinates, z above the home story */
  readonly positions: Float64Array;
  /** three vertex indices per triangle, counter-clockwise seen from outside */
  readonly triangles: Uint32Array;
  /** the surface (VBAttr::Material index) per triangle, -1 when not stored */
  readonly triangleSurfaces: Int32Array;
  /** two vertex indices per body edge (a morph made only of edges has no triangles) */
  readonly edges: Uint32Array;
  /** body polygons that couldn't be triangulated */
  readonly failedPolygons: number;
}

export interface Shell extends ConstructionBase {
  readonly thickness: number;
  /** placement point, z above the home story (as stored) */
  readonly origin: Point3 | null;
  /** 3x4 placement matrix as stored (rows of x, y, z, translation); the shell's shape isn't decoded */
  readonly matrix: readonly number[] | null;
}

export interface Construction {
  readonly walls: readonly Wall[];
  readonly slabs: readonly Slab[];
  readonly roofs: readonly Roof[];
  readonly meshes: readonly Mesh[];
  readonly morphs: readonly Morph[];
  readonly shells: readonly Shell[];
  /** objects that didn't decode, by class name */
  readonly problems: Record<string, number>;
}

// ---- framework ---------------------------------------------------------------------------------

type Version = 25 | 27 | 29;

interface Frame {
  /** where the class's own data starts */
  readonly at: number;
  /** end of the first section */
  readonly end: number;
  readonly version: Version;
}

/** The class data's start and the Archicad version, from the base-class chain. */
function frameOf(d: Uint8Array): Frame | null {
  if (d.length < 43) return null;
  const end = 39 + u32(d, 35);
  if (end > d.length) return null;
  for (let p = 39; p + 18 <= Math.min(end, 160); p++) {
    if (d[p] !== d[0] || hex(d, p, 16) !== hex(d, 0, 16)) continue;
    if (d[p - 1] !== 1 || d[p - 2] !== 0 || d[p - 3] !== 0 || d[p - 4] !== 3 || d[p - 5] !== 0) return null;
    const n = u16(d, p + 16);
    const at = p + 18 + 2 * n;
    if (at > end) return null;
    const version: Version = d[p - 6] === 0x83 ? 29 : u16(d, p - 8) === 4 ? 25 : 27;
    return { at, end, version };
  }
  return null;
}

interface Link {
  readonly tag: number;
  readonly type: string;
  readonly targets: readonly string[];
}

/** The links section after the first section. */
function linksOf(d: Uint8Array): Link[] {
  const out: Link[] = [];
  let p = 39 + u32(d, 35);
  if (p + 6 > d.length) return out;
  const end = p + 4 + u32(d, p);
  p += 6;
  if (end > d.length) return out;
  while (p < end) {
    const tag = d[p++];
    if (tag === 0 || p + 16 > end) break;
    const type = hex(d, p, 16);
    p += 16;
    let n = 1;
    if (tag === 0x01 || tag === 0x02) {
      if (p + 4 > end) break;
      n = u32(d, p);
      p += 4;
    } else if (tag !== 0x11 && tag !== 0x12) break;
    if (p + 16 * n > end) break;
    const targets: string[] = [];
    for (let i = 0; i < n; i++, p += 16) targets.push(hex(d, p, 16));
    out.push({ tag, type, targets });
  }
  return out;
}

/** Targets of the links of a type, either side, in order. */
function linked(links: readonly Link[], type: string): string[] {
  const out: string[] = [];
  for (const l of links) if (l.type === type) out.push(...l.targets);
  return out;
}

const finite = (...v: number[]): boolean => v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e7);

function need(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

const pt2 = (d: Uint8Array, o: number): Point2 => ({ x: f64(d, o), y: f64(d, o + 8) });

/** The 3D box (x0, y0, x1, y1, z0, z1) at o; null when zero or not finite. */
function boxAt(d: Uint8Array, o: number): Box3 | null {
  if (o < 0 || o + 48 > d.length) return null;
  const v = [0, 1, 2, 3, 4, 5].map((k) => f64(d, o + 8 * k));
  if (!finite(...v) || v.every((x) => x === 0) || v[0] > v[2] || v[1] > v[3] || v[4] > v[5]) return null;
  return { min: { x: v[0], y: v[1], z: v[4] }, max: { x: v[2], y: v[3], z: v[5] } };
}

/** An overridable attribute at o: 03 00, flag, 01 00, i32 (27, 29) or 02 00, flag, i32 (25). */
function overridable(d: Uint8Array, o: number): { value: Overridable; end: number } {
  const v = u16(d, o);
  if (v === 3 && u16(d, o + 3) === 1) return { value: { index: i32(d, o + 5), overridden: d[o + 2] !== 0 }, end: o + 9 };
  if (v === 2) return { value: { index: i32(d, o + 3), overridden: d[o + 2] !== 0 }, end: o + 7 };
  throw new Error(`no surface at ${o}`);
}

/** 01 00 + i32 at o. */
function attr(d: Uint8Array, o: number): number {
  need(u16(d, o) === 1, `no attribute at ${o}`);
  return i32(d, o + 2);
}

interface Header {
  readonly version: Version;
  readonly layer: number;
  readonly story: number;
  readonly id: string;
  /** after the ID: where the class's own fields start */
  readonly end: number;
  readonly gables: readonly string[];
  readonly links: readonly Link[];
  readonly frame: Frame;
}

/** The element header at p, or null when it doesn't read as one there. */
function headerAt(d: Uint8Array, p: number, f: Frame, isWall: boolean): Omit<Header, "links" | "frame"> | null {
  if (p + 30 >= f.end || d[p + 1] !== 1 || d[p + 2] !== 0) return null;
  const layer = i32(d, p + 3);
  const story = (u16(d, p + 7) << 16) >> 16;
  if (layer < 0 || layer > 1 << 20) return null;
  let q = p + 11;
  if (f.version === 25) {
    if (u16(d, q + 4) !== 1) return null;
    q += 10;
  }
  if (u16(d, q) !== 1) return null;
  q += 10;
  const gables: string[] = [];
  if (isWall) {
    if (u16(d, q) !== 1 || u16(d, q + 6) !== 1) return null;
    const n = u32(d, q + 8);
    q += 12;
    if (q + 22 * n > f.end) return null;
    for (let k = 0; k < n; k++, q += 22) {
      if (u16(d, q) !== 6) return null;
      gables.push(hex(d, q + 2, 16));
    }
  }
  const s = utf16At(d, q);
  if (!s || s.end > f.end || s.text.length > 1000) return null;
  return { version: f.version, layer, story, id: s.text, end: s.end, gables };
}

/**
 * The framework and element header of an element object. In 29 the header follows the 16 bytes, u32 m,
 * m bytes and a u32 (roofs and shells keep 8 bytes more there); it is looked for over a few bytes.
 */
function headerOf(d: Uint8Array, isWall: boolean): Header {
  const f = frameOf(d);
  if (!f) throw new Error("no frame");
  let p = f.at;
  if (f.version === 29) {
    need(p + 20 <= f.end, "short");
    p += 20 + u32(d, p + 16) + 4;
  }
  for (let k = 0; k <= 16; k += 4) {
    const h = headerAt(d, p + k, f, isWall);
    if (h) return { ...h, links: linksOf(d), frame: f };
  }
  throw new Error("no element header");
}

function baseOf(o: ArchicadObject, h: Header): ConstructionBase {
  return { guid: o.guid, id: h.id, floor: linked(h.links, LINK.floor)[0] ?? null, story: h.story, layer: h.layer, version: h.version };
}

// ---- polygons ----------------------------------------------------------------------------------

/** A Polygon2D at p (02 01 + size), or null when there isn't a well-formed one. */
function polygonAt(d: Uint8Array, p: number): { polygon: Polygon; end: number } | null {
  if (p + 9 > d.length || d[p] !== 2 || d[p + 1] !== 1 || d[p + 6] > 1 || (u16(d, p + 7) !== 0x1f && u16(d, p + 7) !== 0x0f)) return null;
  const end = p + 6 + u32(d, p + 2);
  if (end > d.length) return null;
  let q = p + 9 + 32;
  if (q + 12 > end) return null;
  const nV = u32(d, q);
  const nA = u32(d, q + 4);
  const nC = u32(d, q + 8);
  q += 12;
  if (nV === 0) return { polygon: { contours: [], arcs: [], vertexIds: [] }, end };
  if (nC === 0 || nC > nV || q + 16 * (nV + 1) + (nA ? 16 * (nA + 1) : 0) + 4 * (nC + 1) > end) return null;
  const pts: Point2[] = [];
  for (let k = 0; k <= nV; k++, q += 16) pts.push(pt2(d, q));
  const rawArcs: [number, number][] = [];
  if (nA > 0) {
    q += 16;
    for (let k = 0; k < nA; k++, q += 16) rawArcs.push([u32(d, q), f64(d, q + 8)]);
  }
  const ends: number[] = [];
  for (let k = 0; k <= nC; k++, q += 4) ends.push(u32(d, q));
  if (ends[0] !== 0 || ends[nC] !== nV) return null;
  let ids: number[] | null = null;
  if (q + 6 <= end && u16(d, q) === 1 && u32(d, q + 2) === nV + 1 && q + 6 + 4 * (nV + 1) <= end) {
    ids = [];
    for (let k = 0; k <= nV; k++) ids.push(u32(d, q + 6 + 4 * k));
  }
  const contours: Point2[][] = [];
  const vertexIds: number[][] = [];
  for (let c = 0; c < nC; c++) {
    const a = ends[c] + 1;
    const b = ends[c + 1];
    // two points make a contour when both edges are arcs (a circle)
    if (b - a < (nA > 0 ? 2 : 3)) return null;
    const first = pts[a];
    const last = pts[b];
    if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) return null;
    contours.push(pts.slice(a, b));
    vertexIds.push(ids ? ids.slice(a, b) : []);
  }
  if (!contours.every((c) => c.every((v) => finite(v.x, v.y)))) return null;
  const arcs: PolygonArc[] = [];
  for (const [begin, angle] of rawArcs) {
    for (let c = 0; c < nC; c++) {
      const a = ends[c] + 1;
      if (begin >= a && begin < ends[c + 1]) {
        arcs.push({ contour: c, edge: begin - a, angle });
        break;
      }
    }
  }
  return { polygon: { contours, arcs, vertexIds }, end };
}

/** The centre of the arc from a to b turning by `angle` (counter-clockwise positive): left of a→b when positive. */
export function arcCentre(a: Point2, b: Point2, angle: number): Point2 | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || angle === 0 || !Number.isFinite(angle)) return null;
  const t = len / 2 / Math.tan(angle / 2);
  return { x: (a.x + b.x) / 2 - (dy / len) * t, y: (a.y + b.y) / 2 + (dx / len) * t };
}

/** A polygon's contours as points only, arcs replaced by chords no more than `step` radians apart. */
export function flattenPolygon(p: Polygon, step = Math.PI / 18): Point2[][] {
  return p.contours.map((c, ci) => {
    const bulge = new Map<number, number>();
    for (const a of p.arcs) if (a.contour === ci) bulge.set(a.edge, a.angle);
    const out: Point2[] = [];
    for (let k = 0; k < c.length; k++) {
      const a = c[k];
      const b = c[(k + 1) % c.length];
      out.push(a);
      const angle = bulge.get(k) ?? 0;
      const centre = angle ? arcCentre(a, b, angle) : null;
      if (!centre) continue;
      const r = Math.hypot(a.x - centre.x, a.y - centre.y);
      const start = Math.atan2(a.y - centre.y, a.x - centre.x);
      // at least two segments, so a very flat arc never collapses onto its chord
      const n = Math.max(2, Math.ceil(Math.abs(angle) / step));
      for (let i = 1; i < n; i++) {
        const t = start + (angle * i) / n;
        out.push({ x: centre.x + r * Math.cos(t), y: centre.y + r * Math.sin(t) });
      }
    }
    return out;
  });
}

/** The first well-formed polygon from `from`, within `span` bytes. */
function findPolygon(d: Uint8Array, from: number, to: number, span = 512): { polygon: Polygon; end: number; at: number } | null {
  for (let p = from; p < Math.min(to, from + span); p++) {
    if (d[p] !== 2 || d[p + 1] !== 1) continue;
    const r = polygonAt(d, p);
    if (r && r.polygon.contours.length > 0) return { ...r, at: p };
  }
  return null;
}

/** Edge records after a slab or roof outline: 01 00 01 00, count, records, then the default record. */
function edgesAt(d: Uint8Array, p: number, end: number): { edges: SlabEdge[]; side: Overridable | null } {
  if (p + 8 > end || u16(d, p) !== 1 || u16(d, p + 2) !== 1) return { edges: [], side: null };
  const n = u32(d, p + 4);
  let q = p + 8;
  const edges: SlabEdge[] = [];
  for (let k = 0; k < n; k++) {
    need(q + 25 <= end, "edge records");
    const edge = u32(d, q);
    const angle = f64(d, q + 8);
    const s = overridable(d, q + 16);
    edges.push({ edge, angle, surface: s.value });
    q = s.end + 2;
  }
  let side: Overridable | null = null;
  if (q + 21 <= end) {
    try {
      side = overridable(d, q + 12).value;
    } catch {
      side = null;
    }
  }
  return { edges, side };
}

// ---- walls -------------------------------------------------------------------------------------

function readWall(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>): Wall {
  const d = o.data;
  const h = headerOf(d, true);
  const E = h.end;
  const end = h.frame.end;
  need(E + 0xe9 + 30 < end, "short wall");
  const begin = pt2(d, E);
  const endPt = pt2(d, E + 16);
  const surface = (k: number): Overridable => ({ index: attr(d, E + 0x38 + 6 * k), overridden: d[E + 0x4a + k] !== 0 });
  const thickness = f64(d, E + 0x4d);
  const endThickness = f64(d, E + 0x55);
  const arcAngle = f64(d, E + 0x75);
  const topOffset = f64(d, E + 0x91);
  const height = f64(d, E + 0x99);
  const bottomOffset = f64(d, E + 0xa1);
  const profileType = u16(d, E + 0xb8);
  const slantAlpha = f64(d, E + 0xba);
  const slantBeta = f64(d, E + 0xc2);
  const buildingMaterial = attr(d, E + 0xd5);
  const kind = u16(d, E + 0xe1);
  const composite = attr(d, E + 0xe3);
  need(finite(begin.x, begin.y, endPt.x, endPt.y, thickness, endThickness, arcAngle, topOffset, height, bottomOffset), "wall numbers");
  let q = E + 0xe9 + 5;
  // in 25 and 27 a second gable list here (its records as in the header's)
  const gables = [...h.gables];
  if (h.version !== 29) {
    need(u16(d, q) === 1, "no gable list");
    const n = u32(d, q + 2);
    q += 6;
    need(q + 22 * n <= end, "gable list");
    for (let k = 0; k < n; k++, q += 22) gables.push(hex(d, q + 2, 16));
  }
  const flipped = d[q] !== 0;
  const referenceLocation = i32(d, q + 1);
  const referenceOffset = f64(d, q + 5);
  const footprintAt = polygonAt(d, q + 20);
  need(footprintAt !== null, "no footprint polygon");
  const footprint = footprintAt!.polygon.contours.length > 0 ? footprintAt!.polygon : null;
  const box = footprintAt!.end + 77 <= end ? boxAt(d, footprintAt!.end + 4) : null;
  const outside = flipped ? -referenceOffset : referenceOffset;
  const faces = {
    outside,
    insideBegin: outside + (flipped ? thickness : -thickness),
    insideEnd: outside + (flipped ? endThickness : -endThickness),
  };
  const centre = arcCentre(begin, endPt, arcAngle);
  const indirection = linked(h.links, LINK.topIndirection)[0];
  const ind = indirection ? byGuid.get(indirection) : undefined;
  const topFloor = ind ? (linked(linksOf(ind.data), LINK.indirectionFloor)[0] ?? null) : null;
  const structure: WallStructure | null = kind === 1 ? "basic" : kind === 2 ? "composite" : kind === 3 ? "profile" : null;
  return {
    ...baseOf(o, h),
    begin,
    end: endPt,
    arcAngle,
    centre,
    thickness,
    endThickness,
    bottomOffset,
    height,
    topOffset,
    topFloor,
    referenceLocation,
    referenceOffset,
    flipped,
    faces,
    profileType,
    slantAlpha,
    slantBeta,
    structure,
    buildingMaterial,
    composite,
    profileObject: linked(h.links, LINK.wallProfile)[0] ?? null,
    surfaces: [surface(0), surface(1), surface(2)],
    footprint,
    box,
    openings: [...linked(h.links, LINK.door), ...linked(h.links, LINK.window)],
    gables,
  };
}

// ---- slabs -------------------------------------------------------------------------------------

function readSlab(o: ArchicadObject): Slab {
  const d = o.data;
  const h = headerOf(d, false);
  const E = h.end;
  const end = h.frame.end;
  const level = f64(d, E);
  const referencePlane = d[E + 8];
  const offsetFromTop = f64(d, E + 9);
  const thickness = f64(d, E + 0x11);
  need(finite(level, offsetFromTop, thickness), "slab numbers");
  const top = overridable(d, E + 0x19);
  const bottom = overridable(d, top.end);
  const S = bottom.end;
  const buildingMaterial = attr(d, S + 0x1c);
  const kind = u16(d, S + 0x28);
  const composite = attr(d, S + 0x2a);
  const outline = findPolygon(d, S + 0x30, end);
  need(outline !== null, "no outline");
  const { edges, side } = edgesAt(d, outline!.end, end);
  return {
    ...baseOf(o, h),
    level,
    referencePlane,
    offsetFromTop,
    thickness,
    top: level + offsetFromTop,
    outline: outline!.polygon,
    structure: kind === 1 ? "basic" : kind === 2 ? "composite" : null,
    buildingMaterial,
    composite,
    surfaces: { top: top.value, bottom: bottom.value, side },
    edges,
    box: boxAt(d, end - 49),
  };
}

// ---- roofs and shells --------------------------------------------------------------------------

/** The fields roofs and shells open with: thickness, two surfaces, two attributes; `o` is where the pivot frame starts. */
function shellBase(d: Uint8Array, E: number): { thickness: number; surfaces: [Overridable, Overridable]; buildingMaterial: number; composite: number; o: number } {
  const thickness = f64(d, E + 1);
  const a = overridable(d, E + 9);
  const b = overridable(d, a.end);
  const buildingMaterial = attr(d, b.end);
  const composite = attr(d, b.end + 6);
  return { thickness, surfaces: [a.value, b.value], buildingMaterial, composite, o: b.end + 42 };
}

function readRoof(o: ArchicadObject): Roof {
  const d = o.data;
  const h = headerOf(d, false);
  const E = h.end;
  const end = h.frame.end;
  const sb = shellBase(d, E);
  const p = sb.o;
  need(p + 190 < end, "short roof");
  const cos = f64(d, p + 22);
  const sin = f64(d, p + 30);
  const level = f64(d, p + 131);
  const degrees = f64(d, p + 140);
  const pivotEnd = pt2(d, p + 148);
  const pivotBegin = pt2(d, p + 164);
  need(finite(sb.thickness, cos, sin, level, degrees, pivotEnd.x, pivotEnd.y, pivotBegin.x, pivotBegin.y) && Math.abs(Math.hypot(cos, sin) - 1) < 1e-6, "roof numbers");
  const outline = polygonAt(d, p + 184) ?? findPolygon(d, p + 150, end);
  need(outline !== null && outline.polygon.contours.length > 0, "no outline");
  const { edges } = edgesAt(d, outline!.end, end);
  return {
    ...baseOf(o, h),
    thickness: sb.thickness,
    pivot: { begin: pivotBegin, end: pivotEnd },
    slope: (degrees * Math.PI) / 180,
    level,
    outline: outline!.polygon,
    buildingMaterial: sb.buildingMaterial,
    composite: sb.composite,
    surfaces: sb.surfaces,
    edges,
    openings: linked(h.links, LINK.skylight),
  };
}

/**
 * A wall's top above its home story. Top-linked walls keep their top at the linked story's level plus
 * the top offset, so this needs the story levels (EDB::Floor GUID → level, e.g. from readAttributes'
 * stories). Falls back to bottom offset + stored height when the top isn't linked or a level is missing.
 */
export function wallTop(wall: Wall, levelOf: (floor: string) => number | undefined): number {
  if (wall.topFloor !== null && wall.floor !== null) {
    const top = levelOf(wall.topFloor);
    const home = levelOf(wall.floor);
    if (top !== undefined && home !== undefined) return top + wall.topOffset - home;
  }
  return wall.bottomOffset + wall.height;
}

/** A roof's underside height above its home story at plan point (x, y); add thickness / cos(slope) for the top. */
export function roofUndersideAt(roof: Roof, x: number, y: number): number {
  const dx = roof.pivot.end.x - roof.pivot.begin.x;
  const dy = roof.pivot.end.y - roof.pivot.begin.y;
  const len = Math.hypot(dx, dy) || 1;
  const side = (-(x - roof.pivot.begin.x) * dy + (y - roof.pivot.begin.y) * dx) / len;
  return roof.level + side * Math.tan(roof.slope);
}

function readShell(o: ArchicadObject): Shell {
  const d = o.data;
  const h = headerOf(d, false);
  const E = h.end;
  const end = h.frame.end;
  const sb = shellBase(d, E);
  need(finite(sb.thickness), "shell numbers");
  let origin: Point3 | null = null;
  let matrix: number[] | null = null;
  for (let p = sb.o; p + 4 + 96 <= Math.min(end, sb.o + 512); p++) {
    if (d[p] !== 0 || d[p + 1] !== 1 || d[p + 2] !== 0x80 || d[p + 3] !== 0) continue;
    const m = Array.from({ length: 12 }, (_, k) => f64(d, p + 4 + 8 * k));
    const col = (c: number): number => Math.hypot(m[c], m[4 + c], m[8 + c]);
    if (!finite(...m) || Math.abs(col(0) - 1) > 1e-3 || Math.abs(col(1) - 1) > 1e-3 || Math.abs(col(2) - 1) > 1e-3) continue;
    matrix = m;
    const z = f64(d, p - 8);
    const pt = pt2(d, p - 24);
    if (finite(pt.x, pt.y, z)) origin = { ...pt, z };
    break;
  }
  return { ...baseOf(o, h), thickness: sb.thickness, origin, matrix };
}

// ---- meshes ------------------------------------------------------------------------------------

function readMesh(o: ArchicadObject): Mesh {
  const d = o.data;
  const h = headerOf(d, false);
  const E = h.end;
  const end = h.frame.end;
  const level = f64(d, E);
  const surfaces: [number, number] = [attr(d, E + 8), attr(d, E + 14)];
  const skirt = f64(d, E + 0x37);
  need(finite(level, skirt), "mesh numbers");
  const outline = polygonAt(d, E + 0x6a) ?? findPolygon(d, E + 0x3f, end);
  need(outline !== null && outline.polygon.contours.length > 0, "no outline");
  let q = outline!.end + 12;
  need(q + 8 <= end && u16(d, q) === 1 && u16(d, q + 2) === 1, "no level points");
  const n = u32(d, q + 4);
  q += 8;
  need(q + 30 * n <= end, "level points");
  const points: Point3[] = [];
  for (let k = 0; k < n; k++, q += 30) {
    need(u16(d, q) === 1, "level point");
    points.push({ x: f64(d, q + 2), y: f64(d, q + 10), z: f64(d, q + 18) });
  }
  need(q + 6 <= end && u16(d, q) === 1, "no ridges");
  const nr = u32(d, q + 2);
  q += 6;
  need(q + 4 * nr + 6 <= end, "ridges");
  const ridges: number[][] = [];
  let from = 0;
  for (let k = 0; k < nr; k++, q += 4) {
    const last = u32(d, q);
    need(last >= from && last <= n, "ridge end");
    if (last - from >= 2) ridges.push(Array.from({ length: last - from }, (_, i) => from + i));
    from = last;
  }
  q += 4 + 2;
  need(q + 8 <= end && u16(d, q) === 1 && u16(d, q + 2) === 1, "no heights");
  const nz = u32(d, q + 4);
  q += 8;
  need(q + 12 * nz <= end, "heights");
  const heights = new Map<number, number>();
  for (let k = 0; k < nz; k++, q += 12) heights.set(u32(d, q), f64(d, q + 4));
  const poly = outline!.polygon;
  const lifted = poly.contours.map((c, ci) => c.map((v, vi) => ({ x: v.x, y: v.y, z: heights.get(poly.vertexIds[ci][vi]) ?? 0 })));
  need(lifted.every((c) => c.every((v) => finite(v.z))) && points.every((v) => finite(v.x, v.y, v.z)), "mesh heights");
  return { ...baseOf(o, h), level, skirt, outline: lifted, outlinePolygon: poly, points, ridges, surfaces, box: boxAt(d, end - 49) };
}

// ---- morphs ------------------------------------------------------------------------------------

interface Body {
  readonly vertices: Float64Array;
  readonly edges: Uint32Array;
  readonly triangles: Uint32Array;
  readonly surfaces: Int32Array;
  readonly failed: number;
}

/** A VBElem::BodyData's mesh at p (the vertex count), triangulated; throws when the layout doesn't hold. */
function bodyAt(d: Uint8Array, p: number): Body {
  let q = p;
  const take = (n: number): number => {
    need(q + n <= d.length, "body ends early");
    const at = q;
    q += n;
    return at;
  };
  const nV = u32(d, take(4));
  need(nV < 1e7 && q + 24 * nV <= d.length, "vertex count");
  const vertices = new Float64Array(3 * nV);
  for (let k = 0; k < 3 * nV; k++) vertices[k] = f64(d, take(8));
  const nCurve = u32(d, take(4));
  need(nCurve < 1e7, "curve count");
  take(8 * nCurve);
  const nE = u32(d, take(4));
  need(nE < 1e7 && q + 24 * nE <= d.length, "edge count");
  const ev = new Uint32Array(2 * nE);
  for (let k = 0; k < nE; k++) {
    const at = take(24);
    ev[2 * k] = u32(d, at + 8);
    ev[2 * k + 1] = u32(d, at + 12);
    need(ev[2 * k] < nV && ev[2 * k + 1] < nV, "edge vertex");
  }
  const nP = u32(d, take(4));
  need(nP < 1e7 && q + 4 * nP <= d.length, "polygon edge count");
  const pe = new Int32Array(nP);
  for (let k = 0; k < nP; k++) {
    pe[k] = i32(d, take(4));
    need(Math.abs(pe[k]) <= nE, "polygon edge");
  }
  const nN = u32(d, take(4));
  need(nN < 1e7 && q + 24 * nN <= d.length, "normal count");
  const normals = new Float64Array(3 * nN);
  for (let k = 0; k < 3 * nN; k++) normals[k] = f64(d, take(8));
  const nG = u32(d, take(4));
  need(nG < 1e7 && q + 40 * nG <= d.length, "polygon count");
  const pg: { normal: number; first: number; last: number }[] = [];
  for (let k = 0; k < nG; k++) {
    const at = take(40);
    const first = i32(d, at + 24);
    const last = i32(d, at + 28);
    need(first >= 0 && last < nP && first <= last + 1, "polygon range");
    pg.push({ normal: i32(d, at + 20), first, last });
  }
  // vertex flag bits, then one surface per polygon
  const bits = u32(d, take(4));
  const polySurface = new Int32Array(nG).fill(-1);
  if (bits < 1e8 && q + Math.ceil(bits / 8) + 6 <= d.length) {
    q += Math.ceil(bits / 8);
    if (u16(d, q) === 1 && u32(d, q + 2) === nG) {
      let r = q + 6;
      try {
        for (let k = 0; k < nG; k++) {
          const s = overridable(d, r);
          polySurface[k] = s.value.index;
          r = s.end;
        }
      } catch {
        polySurface.fill(-1);
      }
    }
  }
  const tris: number[] = [];
  const triSurface: number[] = [];
  let failed = 0;
  for (let g = 0; g < nG; g++) {
    const { first, last, normal } = pg[g];
    const loops: number[][] = [[]];
    for (let k = first; k <= last; k++) {
      const e = pe[k];
      if (e === 0) {
        if (loops[loops.length - 1].length > 0) loops.push([]);
        continue;
      }
      const i = Math.abs(e) - 1;
      loops[loops.length - 1].push(e > 0 ? ev[2 * i] : ev[2 * i + 1]);
    }
    const rings = loops.filter((l) => l.length >= 3);
    if (rings.length === 0) {
      if (last >= first) failed++;
      continue;
    }
    // the face normal: stored, else from the outline (Newell)
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const ni = Math.abs(normal) - 1;
    if (ni >= 0 && ni < nN) {
      const s = normal < 0 ? -1 : 1;
      nx = s * normals[3 * ni];
      ny = s * normals[3 * ni + 1];
      nz = s * normals[3 * ni + 2];
    }
    if (Math.hypot(nx, ny, nz) < 1e-9) {
      const r = rings[0];
      for (let k = 0; k < r.length; k++) {
        const a = 3 * r[k];
        const b = 3 * r[(k + 1) % r.length];
        nx += (vertices[a + 1] - vertices[b + 1]) * (vertices[a + 2] + vertices[b + 2]);
        ny += (vertices[a + 2] - vertices[b + 2]) * (vertices[a] + vertices[b]);
        nz += (vertices[a] - vertices[b]) * (vertices[a + 1] + vertices[b + 1]);
      }
    }
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 1e-12)) {
      failed++;
      continue;
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // a basis in the face's plane
    const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = ny * ax[2] - nz * ax[1];
    let uy = nz * ax[0] - nx * ax[2];
    let uz = nx * ax[1] - ny * ax[0];
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const flat: number[] = [];
    const idx: number[] = [];
    const holes: number[] = [];
    rings.forEach((r, ri) => {
      if (ri > 0) holes.push(idx.length);
      for (const v of r) {
        const a = 3 * v;
        flat.push(vertices[a] * ux + vertices[a + 1] * uy + vertices[a + 2] * uz, vertices[a] * vx + vertices[a + 1] * vy + vertices[a + 2] * vz);
        idx.push(v);
      }
    });
    const t = earcut(flat, holes.length ? holes : undefined, 2);
    if (t.length === 0) {
      failed++;
      continue;
    }
    for (let k = 0; k < t.length; k += 3) {
      let a = idx[t[k]];
      const b = idx[t[k + 1]];
      let c = idx[t[k + 2]];
      // wind counter-clockwise around the face normal
      const e1 = [vertices[3 * b] - vertices[3 * a], vertices[3 * b + 1] - vertices[3 * a + 1], vertices[3 * b + 2] - vertices[3 * a + 2]];
      const e2 = [vertices[3 * c] - vertices[3 * a], vertices[3 * c + 1] - vertices[3 * a + 1], vertices[3 * c + 2] - vertices[3 * a + 2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1];
      const cy = e1[2] * e2[0] - e1[0] * e2[2];
      const cz = e1[0] * e2[1] - e1[1] * e2[0];
      if (cx * nx + cy * ny + cz * nz < 0) [a, c] = [c, a];
      tris.push(a, b, c);
      triSurface.push(polySurface[g]);
    }
  }
  return { vertices, edges: ev, triangles: Uint32Array.from(tris), surfaces: Int32Array.from(triSurface), failed };
}

/** The body in a VBElem::BodyData payload: at byte 195 in every version seen, else looked for. */
function readBody(d: Uint8Array): Body {
  try {
    return bodyAt(d, 195);
  } catch (first) {
    for (let p = 60; p < Math.min(d.length - 8, 600); p++) {
      if (p === 195) continue;
      const n = u32(d, p);
      if (n < 3 || n > 1e6 || p + 4 + 24 * n > d.length) continue;
      try {
        return bodyAt(d, p);
      } catch {
        // keep looking
      }
    }
    throw first;
  }
}

function readMorph(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>): Morph {
  const d = o.data;
  const h = headerOf(d, false);
  const E = h.end;
  need(E + 5 + 96 <= h.frame.end, "short morph");
  const m = Array.from({ length: 12 }, (_, k) => f64(d, E + 5 + 8 * k));
  need(finite(...m), "morph matrix");
  const bodyGuid = linked(h.links, LINK.body)[0] ?? null;
  const bo = bodyGuid ? byGuid.get(bodyGuid) : undefined;
  need(bo !== undefined, "no body");
  const body = readBody(bo!.data);
  const v = body.vertices;
  const positions = new Float64Array(v.length);
  for (let k = 0; k < v.length; k += 3) {
    const x = v[k];
    const y = v[k + 1];
    const z = v[k + 2];
    positions[k] = m[0] * x + m[1] * y + m[2] * z + m[3];
    positions[k + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    positions[k + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return { ...baseOf(o, h), matrix: m, body: bodyGuid, positions, edges: body.edges, triangles: body.triangles, triangleSurfaces: body.surfaces, failedPolygons: body.failed };
}

// ---- all ---------------------------------------------------------------------------------------

export function readConstruction(objects: ObjectsByClass): Construction {
  const problems: Record<string, number> = {};
  const byGuid = new Map<string, ArchicadObject>();
  for (const cls of [CLASS.body, CLASS.floorIndirection]) for (const o of objects.get(cls) ?? []) byGuid.set(o.guid, o);
  const each = <T>(cls: string, read: (o: ArchicadObject) => T): T[] => {
    const out: T[] = [];
    for (const o of objects.get(cls) ?? []) {
      try {
        out.push(read(o));
      } catch {
        const name = NAME[cls] ?? cls;
        problems[name] = (problems[name] ?? 0) + 1;
      }
    }
    return out;
  };
  return {
    walls: each(CLASS.wall, (o) => readWall(o, byGuid)),
    slabs: each(CLASS.slab, readSlab),
    roofs: each(CLASS.roof, readRoof),
    meshes: each(CLASS.mesh, readMesh),
    morphs: each(CLASS.morph, (o) => readMorph(o, byGuid)),
    shells: each(CLASS.shell, readShell),
    problems,
  };
}

/** For checks: the pieces below readConstruction. */
export const internals = { frameOf, headerOf, polygonAt, readBody, readWall, readSlab, readRoof, readMesh, readMorph, readShell, CLASS, LINK };
