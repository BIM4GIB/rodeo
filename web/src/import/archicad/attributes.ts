// Archicad's stories and attributes (layers, layer combinations, pen sets, surfaces, building
// materials, composites, complex profiles, fills, line types, zone categories) and the project's
// geolocation, read from the objects of an Archicad 25, 27 or 29 file (./objects.ts). Elements
// refer to attributes by their attribute index and to their story by the GUID of its EDB::Floor
// object, so everything here is keyed for that.
//
// Every attribute object (VBAttr::*) starts its class data (at OBJECT_DATA) the same way in all
// three versions: a u16 class version (when its high byte is 1, a u32 size follows), then the
// common attribute block: 05 02, a u32 byte length of the block, 0x83 00 (Archicad 29) or 0x82 00
// (25 and 27), a u32 3, the name (01 00, u32 count, UTF-16), 01 00 and the attribute index (i32),
// a u16 of flags, 01 00, four zero bytes, a u32 time stamp and zero padding. The class's own data
// follows the block, and the object ends with a u32 length and a list of references (01 00, then
// 0x11/0x12, a 16-byte reference type and the GUID referred to). A reference to another attribute
// inside the own data is 01 00 and the i32 index. The attribute index is what elements store: in
// every sample the indices of one kind are unique within a database, run from 1 (layer
// combinations from 0, see below) and their maximum is near the count (deleted attributes leave
// gaps), and every reference between attributes (a building material's cut fill and surface, a
// composite's skins, a profile's parts, a surface's fill) resolves.
//
// A file holds one attribute set and one story structure per database: the project's own, and one
// for each hotlinked module source kept in the file (one sample has twelve). ADB::AttributeSet ends
// with a reference to its database whose reference type tells the project's own (MAIN_DATABASE)
// from a module's. ADB::AttributeContainer (one per attribute kind and set) holds a 4-letter tag
// (stored reversed: "2YAL" for layers), the GUID of the kind's current attribute (for pen sets it is
// the model view pen set: it matches the name Archicad keeps in PlanIO::GlobalVariableStore in
// every sample), its members (01, a reference type and a u32 count of object GUIDs; 11, the
// reference type and one GUID; 12, none) and, last, the GUID of its set. Attributes are grouped by
// database through those lists. A few VBAttr::PenTable objects belong to a view's settings
// (VBD::PenSet, referred to by VBD::ViewSetting) rather than to a set; they aren't returned. Unnamed VBAttr::LayerComb objects with index 0 are in
// no list: they are layer state snapshots kept for views, not combinations, and are skipped.
//
// Own data, version by version (the same in 25, 27 and 29 unless said):
//  - Layer: u32 intersection group. Flags: 1 hidden, 2 locked, 0x10 forced to wireframe.
//  - LayerComb: 01 00, u32 count, then per layer: the layer reference (01 00, i32), u8 hidden, u8
//    locked, u8 wireframe, i32 intersection group.
//  - PenTable: 01 00, u32 255, then per pen: u16 4, u32, its name ("Pen1"…), u32 index, 12 bytes,
//    f64 weight (mm on paper), u16 red, green, blue (0..65535), 4 bytes, a description.
//  - Material (surface): u16, u16 x3 colour, u16 ambient, diffuse, specular, transparency (all %),
//    shine (0..10000), transparency attenuation, u16 x3 specular colour, u16 x3 emission colour,
//    u16 emission attenuation, a fill reference (the vectorial 3D hatch), the texture name (empty
//    when none), u32 texture flags, f64 texture width and height (m) and rotation (degrees); the
//    rendering engine's parameters follow (not read). Textures are images in the embedded library,
//    named here only.
//  - BuildingMaterial: an ID string, u32 intersection priority (raw: 4200..5909 seen), the cut
//    fill reference, i16 cut fill pen, i16 cut fill background pen (-1: none), the surface
//    reference, u32 fill orientation, f64 thermal conductivity (W/mK), density (kg/m3), heat
//    capacity (J/kgK), u8, two strings, u8, f64 embodied energy, embodied carbon, two strings.
//  - CompWall: f64 total thickness, u16 skin count, 48 skin slots (05 01, u32 17, the building
//    material reference, i16 frame pen, u8 kind: 1 core, 5 finish, 6 other, f64 thickness), then
//    49 skin lines (02 00, the line type reference, u16 pen; line i is the face before skin i).
//    Flags: 4 walls, 8 slabs, 0x10 roofs, 0x20 shells.
//  - Profile: u16, u16 2, then a vector image block (09 01, u32 size). Its hatch records (03 01, u32
//    size) hold u16 0, u16 2, u16 fill pen, i16 background pen, i32 fill, i32 building material,
//    then at +49 a polygon: u32 count of points with a dummy first one, the points (f64 x, y,
//    metres), 01 00, u32 arc count, arcs (u32 from point, u32 to point, f64 angle, radians), 01 00,
//    u32 count of contour ends with a dummy, the ends (each contour closed, first point repeated).
//    A second copy of the hatches follows the first block (not read).
//  - Fill: 8 bytes of bitmap pattern, f64 x spacing, y spacing, angle, four f64 of symbol fill
//    layout, u16 kind (0 vectorial, 1 symbol, 2 solid with f64 percent, 4 linear gradient, 5
//    radial gradient, 6 image with the image's name), six bytes; a vectorial fill continues 01 00,
//    u32 line count and, when there are lines, a u32 byte length and the hatch lines (f64 spacing,
//    angle, offset along the line, origin x, y, u32 dash count, 4 bytes, the f64 dash lengths:
//    dash, gap, dash…). Spacings multiply the fill's x/y spacing; fills scaled with the model are
//    in metres, others in metres on paper. Flags: 1 scaled with the model, 2 cut, 4 drafting, 8
//    cover. Archicad 29 stores "Air Space" as a 0% solid fill, 25 as a vectorial fill with no lines.
//  - LineType: f64 definition scale, period, height, u16 kind (1 solid, 2 dashed, 3 symbol), u16
//    (1 fixed size, 2 scaled with the model), 100 bytes, u16 group count, u32 byte length, groups
//    (u32, u16 item kind, u16 count, f64 values): a dashed line's groups are dots (kind 2, each a
//    position) and dashes (kind 3, start and length pairs). Lengths are millimetres for fixed-size
//    line types. Symbol line items aren't read.
//  - RoomCat (zone category): code, stamp file name, stamp name, u16 x3 colour, stamp parameters.
//
// Stories: EDB::Floor is one story of one database (546 in the sample with twelve modules: 42 per
// database) and also lists the GUIDs of the elements on it, which is what makes some big: name at
// OBJECT_DATA+8, then i16 story index (negative below ground), u8 "show on sections", u16, u32.
// EDB::FloorGeometry: f64 level (metres) at OBJECT_DATA+8 and, last, its Floor's GUID.
// EDB::FloorStructure: the database's floors (u32 count and GUIDs) and, last, the database. Each
// structure has one floor more than the stories (the project navigator's StoryNode count): an
// unnamed one with the highest index whose level is the top of the top story; it is dropped and
// gives the top story its height.
//
// GeoLoc::GeoLocation: the sun-study date (u16 year, month, day, hour, 4 bytes), f64 longitude,
// f64 latitude (degrees), u16, f64 altitude (m), u16, i16 time zone (minutes), u16, u16, f64 project
// north (degrees; Archicad's default 90 is +y). Its start moves between versions, so it is found
// by its date. Working units (AM::UnitSettingsObject) and the survey point aren't read.

import { f64, hex, i32, OBJECT_DATA, u16, u32, utf16At, type ArchicadObject, type ObjectsByClass } from "./objects.ts";

// ---- class GUIDs (as stored) -------------------------------------------------------------------

const FLOOR = "256b04bcd6271a46a6e56fa0e8594a95"; // EDB::Floor
const FLOOR_GEOMETRY = "a2ca396b1e60744c9955f90ee308af98"; // EDB::FloorGeometry
const FLOOR_STRUCTURE = "3b5841f932a38f45b1beaec894267e09"; // EDB::FloorStructure
const ATTRIBUTE_SET = "2db9625b16e93641b00d526ee21191ce"; // ADB::AttributeSet
const ATTRIBUTE_CONTAINER = "0bdb1448a4c52949a9e0b54229a3fd1b"; // ADB::AttributeContainer
const LAYER = "e23fda6f758e3f4eb8c0d0c4777e5d4d"; // VBAttr::Layer
const LAYER_COMB = "078cd82d1a67eb4a94f13b18279b5d63"; // VBAttr::LayerComb
const PEN_TABLE = "1abab22742def348ae17b16c0dccab32"; // VBAttr::PenTable
const MATERIAL = "e02affd5ddebb549a850b5cfe9e0b438"; // VBAttr::Material
const BUILDING_MATERIAL = "9b5e0c2b5e608f4baaaecc166f03bee5"; // VBAttr::BuildingMaterial
const COMP_WALL = "29b6ecc7f33c9c4ca22211082672e04b"; // VBAttr::CompWall
const PROFILE = "3151ab31ae818141a7147e4d3dd1a91d"; // VBAttr::Profile
const FILL = "0f4a4e6b52bc234ab0a211ab07918e26"; // VBAttr::Fill
const LINE_TYPE = "6ee7b99d473f6a4182d9f63a9de807e7"; // VBAttr::LineType
const ROOM_CAT = "313297c1cebd0d418ab87d628b449087"; // VBAttr::RoomCat
const GEO_LOCATION = "9ab53efdf761924b9e49177ebc1e407f"; // GeoLoc::GeoLocation

/** The reference type an attribute set's last reference has when its database is the project's own (a module's differs). */
const MAIN_DATABASE = "6d7ea5fb8bd4e949a2947bf50b5017c8";

/** Class names, for `problems`. */
export const ATTRIBUTE_CLASS_NAMES: ReadonlyMap<string, string> = new Map([
  [FLOOR, "EDB::Floor"],
  [FLOOR_GEOMETRY, "EDB::FloorGeometry"],
  [FLOOR_STRUCTURE, "EDB::FloorStructure"],
  [ATTRIBUTE_SET, "ADB::AttributeSet"],
  [ATTRIBUTE_CONTAINER, "ADB::AttributeContainer"],
  [LAYER, "VBAttr::Layer"],
  [LAYER_COMB, "VBAttr::LayerComb"],
  [PEN_TABLE, "VBAttr::PenTable"],
  [MATERIAL, "VBAttr::Material"],
  [BUILDING_MATERIAL, "VBAttr::BuildingMaterial"],
  [COMP_WALL, "VBAttr::CompWall"],
  [PROFILE, "VBAttr::Profile"],
  [FILL, "VBAttr::Fill"],
  [LINE_TYPE, "VBAttr::LineType"],
  [ROOM_CAT, "VBAttr::RoomCat"],
  [GEO_LOCATION, "GeoLoc::GeoLocation"],
]);

/** The classes this module reads. */
export const ATTRIBUTE_CLASSES: ReadonlySet<string> = new Set(ATTRIBUTE_CLASS_NAMES.keys());

// ---- the decoded data ----------------------------------------------------------------------------

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** What every attribute has: its object GUID, its index (what elements store) and name. */
export interface ArchicadAttribute {
  readonly guid: string;
  readonly index: number;
  readonly name: string;
}

export interface ArchicadStory {
  /** the EDB::Floor object's GUID: what an element stores to say which story it is on */
  readonly guid: string;
  /** Archicad's story number: 0 the ground story, negative below it */
  readonly index: number;
  readonly name: string;
  /** elevation above project zero, metres */
  readonly level: number;
  /** to the next story up (the top story's from the structure's closing floor), metres */
  readonly height: number;
  readonly showOnSections: boolean;
}

export interface ArchicadLayer extends ArchicadAttribute {
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly wireframe: boolean;
  /** elements on layers of the same group intersect */
  readonly intersectionGroup: number;
}

export interface ArchicadLayerState {
  /** the layer's index */
  readonly layer: number;
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly wireframe: boolean;
  readonly intersectionGroup: number;
}

export interface ArchicadLayerCombination extends ArchicadAttribute {
  readonly layers: readonly ArchicadLayerState[];
}

export interface ArchicadPen {
  /** 1..255: what elements store */
  readonly index: number;
  readonly color: Rgb;
  /** line weight, millimetres on paper */
  readonly weight: number;
  readonly description: string;
}

export interface ArchicadPenTable extends ArchicadAttribute {
  /** 255 pens, in index order */
  readonly pens: readonly ArchicadPen[];
}

export interface ArchicadPens {
  readonly tables: readonly ArchicadPenTable[];
  /** the index of the model view pen set (the one the model is drawn with), when known */
  readonly model: number | null;
  /** the model view pen set's pens (empty when not known) */
  readonly modelPens: readonly ArchicadPen[];
}

export interface ArchicadTexture {
  /** the image's name in the embedded library (no extension) */
  readonly name: string;
  /** width and height of one tile, metres */
  readonly width: number;
  readonly height: number;
  /** degrees */
  readonly rotation: number;
  /** raw texture flags (mirroring, alpha use…; not decoded) */
  readonly flags: number;
}

export interface ArchicadSurface extends ArchicadAttribute {
  readonly color: Rgb;
  /** percentages 0..100 */
  readonly ambient: number;
  readonly diffuse: number;
  readonly specular: number;
  readonly transparency: number;
  /** 0..10000 */
  readonly shine: number;
  readonly transparencyAttenuation: number;
  readonly specularColor: Rgb;
  readonly emissionColor: Rgb;
  readonly emissionAttenuation: number;
  /** the fill index used to hatch the surface in 3D (vectorial 3D hatching) */
  readonly fill: number;
  readonly texture: ArchicadTexture | null;
}

export interface ArchicadBuildingMaterial extends ArchicadAttribute {
  /** the material's ID field */
  readonly id: string;
  /** intersection priority as stored (not the 0..999 shown in Archicad) */
  readonly priority: number;
  readonly cutFill: number;
  readonly cutFillPen: number;
  /** -1: transparent */
  readonly cutFillBackgroundPen: number;
  /** the surface (VBAttr::Material) index */
  readonly surface: number;
  /** raw: project origin, element origin, fit to skin (0..2; order not verified) */
  readonly fillOrientation: number;
  readonly thermalConductivity: number;
  readonly density: number;
  readonly heatCapacity: number;
  readonly embodiedEnergy: number;
  readonly embodiedCarbon: number;
  /** the four free-text fields in stored order (the first holds classification codes in one sample) */
  readonly texts: readonly string[];
}

export interface ArchicadSkin {
  readonly buildingMaterial: number;
  /** metres */
  readonly thickness: number;
  readonly kind: "core" | "finish" | "other";
  /** negative in some skins; sign meaning not known */
  readonly framePen: number;
}

export interface ArchicadSkinLine {
  readonly lineType: number;
  /** negative in some lines (likely hidden) */
  readonly pen: number;
}

export interface ArchicadComposite extends ArchicadAttribute {
  /** metres, the skins' sum */
  readonly thickness: number;
  readonly forWalls: boolean;
  readonly forSlabs: boolean;
  readonly forRoofs: boolean;
  readonly forShells: boolean;
  /** outside (reference line side) first */
  readonly skins: readonly ArchicadSkin[];
  /** skins.length + 1 lines: line i is the face before skin i, the last the inner face */
  readonly lines: readonly ArchicadSkinLine[];
}

export interface ArchicadArc {
  /** the arc runs from points[from] to points[from + 1] of its contour */
  readonly from: number;
  /** signed central angle, radians (positive: counter-clockwise) */
  readonly angle: number;
}

export interface ArchicadContour {
  /** closed: the last point repeats the first */
  readonly points: readonly Point[];
  readonly arcs: readonly ArchicadArc[];
}

export interface ArchicadProfilePart {
  readonly buildingMaterial: number;
  readonly fill: number;
  readonly fillPen: number;
  readonly fillBackgroundPen: number;
  /** the first is the outline, any others holes */
  readonly contours: readonly ArchicadContour[];
}

export interface ArchicadProfile extends ArchicadAttribute {
  /** metres in the profile's own plane (x across, y up) */
  readonly parts: readonly ArchicadProfilePart[];
}

export interface ArchicadHatchLine {
  /** distance between parallel lines, times the fill's spacing */
  readonly spacing: number;
  /** radians */
  readonly angle: number;
  /** shift of the dash pattern from one line to the next */
  readonly offset: number;
  readonly origin: Point;
  /** dash, gap, dash, gap… (empty: a solid line) */
  readonly dashes: readonly number[];
}

export type ArchicadFillKind = "vectorial" | "symbol" | "solid" | "empty" | "linear-gradient" | "radial-gradient" | "image" | "unknown";

export interface ArchicadFill extends ArchicadAttribute {
  readonly kind: ArchicadFillKind;
  /** sized with the model (metres) rather than on paper */
  readonly scaled: boolean;
  readonly forCut: boolean;
  readonly forDrafting: boolean;
  readonly forCover: boolean;
  /** the 8x8 bitmap pattern, one byte a row */
  readonly pattern: readonly number[];
  readonly spacing: Point;
  /** radians */
  readonly angle: number;
  /** a solid fill's coverage, 0..1 */
  readonly percent: number;
  readonly lines: readonly ArchicadHatchLine[];
  /** an image fill's image name */
  readonly image: string | null;
}

export interface ArchicadLineSegment {
  /** from the period's start; a dot has length 0 */
  readonly start: number;
  readonly length: number;
}

export interface ArchicadLineType extends ArchicadAttribute {
  readonly kind: "solid" | "dashed" | "symbol";
  /** sized with the model rather than fixed on paper */
  readonly scaled: boolean;
  readonly defineScale: number;
  /** millimetres for fixed-size types */
  readonly period: number;
  readonly height: number;
  /** a dashed line's dashes and dots within one period, in order */
  readonly segments: readonly ArchicadLineSegment[];
}

export interface ArchicadZoneCategory extends ArchicadAttribute {
  readonly code: string;
  readonly color: Rgb;
  /** the zone stamp library part's name */
  readonly stamp: string;
}

export interface ArchicadGeoLocation {
  /** degrees, east positive */
  readonly longitude: number;
  /** degrees, north positive */
  readonly latitude: number;
  /** metres */
  readonly altitude: number;
  /** degrees, counter-clockwise from +x; Archicad's default 90 means north is +y */
  readonly north: number;
}

/** The stories and attributes of one database (the project's own or a hotlinked module source's). */
export interface ArchicadDatabaseAttributes {
  /** the database's GUID */
  readonly database: string;
  /** in index order */
  readonly stories: readonly ArchicadStory[];
  readonly layers: readonly ArchicadLayer[];
  readonly layerCombinations: readonly ArchicadLayerCombination[];
  readonly pens: ArchicadPens;
  readonly surfaces: readonly ArchicadSurface[];
  readonly buildingMaterials: readonly ArchicadBuildingMaterial[];
  readonly composites: readonly ArchicadComposite[];
  readonly profiles: readonly ArchicadProfile[];
  readonly fills: readonly ArchicadFill[];
  readonly lineTypes: readonly ArchicadLineType[];
  readonly zoneCategories: readonly ArchicadZoneCategory[];
}

export interface ArchicadAttributes extends ArchicadDatabaseAttributes {
  /** the hotlinked module sources kept in the file, each with its own stories and attributes */
  readonly modules: readonly ArchicadDatabaseAttributes[];
  readonly geoLocation: ArchicadGeoLocation | null;
  /** objects that didn't decode, by class name */
  readonly problems: Record<string, number>;
}

// ---- reading helpers -----------------------------------------------------------------------------

/** Reads a payload in order; every read is checked. */
class Reader {
  constructor(
    readonly d: Uint8Array,
    public p: number,
  ) {}

  private at(n: number): number {
    if (this.p + n > this.d.length || this.p < 0) throw new Error(`ends early at ${this.p}`);
    const at = this.p;
    this.p += n;
    return at;
  }
  skip(n: number): void {
    this.at(n);
  }
  u8(): number {
    return this.d[this.at(1)];
  }
  u16(): number {
    return u16(this.d, this.at(2));
  }
  i16(): number {
    const v = u16(this.d, this.at(2));
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32(): number {
    return u32(this.d, this.at(4));
  }
  i32(): number {
    return i32(this.d, this.at(4));
  }
  f64(): number {
    return f64(this.d, this.at(8));
  }
  guid(): string {
    return hex(this.d, this.at(16), 16);
  }
  text(): string {
    const s = utf16At(this.d, this.p);
    if (!s) throw new Error(`no string at ${this.p}`);
    this.p = s.end;
    return s.text;
  }
  /** an attribute reference: 01 00 and the index */
  ref(): number {
    if (this.u16() !== 1) throw new Error(`no attribute reference at ${this.p - 2}`);
    return this.i32();
  }
  /** a colour as three u16 channels */
  rgb(): Rgb {
    const c = (): number => Math.round(this.u16() / 257);
    return { r: c(), g: c(), b: c() };
  }
  expect16(v: number): void {
    const got = this.u16();
    if (got !== v) throw new Error(`expected ${v} at ${this.p - 2}, found ${got}`);
  }
}

/** The common attribute block, and where the class's own data starts. */
interface Head {
  readonly name: string;
  readonly index: number;
  readonly flags: number;
  readonly own: number;
}

function head(d: Uint8Array): Head {
  const r = new Reader(d, OBJECT_DATA);
  const version = r.u16();
  if (version >> 8 === 1) r.skip(4);
  r.expect16(0x0205);
  const length = r.u32();
  const own = r.p + length;
  r.skip(6);
  const name = r.text();
  const index = r.ref();
  const flags = r.u16();
  if (own > d.length) throw new Error("attribute block runs past the object");
  return { name, index, flags, own };
}

/** The GUID before an object's final byte: the last thing it refers to. */
const lastGuid = (d: Uint8Array): string => hex(d, d.length - 17, 16);

// ---- attribute kinds -----------------------------------------------------------------------------

function layer(o: ArchicadObject): ArchicadLayer {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  return { guid: o.guid, index: h.index, name: h.name, hidden: (h.flags & 1) !== 0, locked: (h.flags & 2) !== 0, wireframe: (h.flags & 0x10) !== 0, intersectionGroup: r.i32() };
}

function layerCombination(o: ArchicadObject): ArchicadLayerCombination {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  r.expect16(1);
  const n = r.u32();
  if (n > 100000) throw new Error("too many layers");
  const layers: ArchicadLayerState[] = [];
  for (let i = 0; i < n; i++) {
    const layer = r.ref();
    const hidden = r.u8() !== 0;
    const locked = r.u8() !== 0;
    const wireframe = r.u8() !== 0;
    layers.push({ layer, hidden, locked, wireframe, intersectionGroup: r.i32() });
  }
  return { guid: o.guid, index: h.index, name: h.name, layers };
}

function penTable(o: ArchicadObject): ArchicadPenTable {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  r.expect16(1);
  const n = r.u32();
  if (n > 1024) throw new Error("too many pens");
  const pens: ArchicadPen[] = [];
  for (let i = 0; i < n; i++) {
    r.skip(6);
    r.text();
    const index = r.u32();
    r.skip(12);
    const weight = r.f64();
    const color = r.rgb();
    r.skip(4);
    pens.push({ index, color, weight, description: r.text() });
  }
  return { guid: o.guid, index: h.index, name: h.name, pens };
}

function surface(o: ArchicadObject): ArchicadSurface {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  r.skip(2);
  const color = r.rgb();
  const ambient = r.u16();
  const diffuse = r.u16();
  const specular = r.u16();
  const transparency = r.u16();
  const shine = r.u16();
  const transparencyAttenuation = r.u16();
  const specularColor = r.rgb();
  const emissionColor = r.rgb();
  const emissionAttenuation = r.u16();
  const fill = r.ref();
  const name = r.text();
  const flags = r.u32();
  const width = r.f64();
  const height = r.f64();
  const rotation = r.f64();
  const texture = name ? { name, width, height, rotation, flags } : null;
  return { guid: o.guid, index: h.index, name: h.name, color, ambient, diffuse, specular, transparency, shine, transparencyAttenuation, specularColor, emissionColor, emissionAttenuation, fill, texture };
}

function buildingMaterial(o: ArchicadObject): ArchicadBuildingMaterial {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  const id = r.text();
  const priority = r.u32();
  const cutFill = r.ref();
  const cutFillPen = r.i16();
  const cutFillBackgroundPen = r.i16();
  const surface = r.ref();
  const fillOrientation = r.u32();
  const thermalConductivity = r.f64();
  const density = r.f64();
  const heatCapacity = r.f64();
  r.skip(1);
  const texts = [r.text(), r.text()];
  r.skip(1);
  const embodiedEnergy = r.f64();
  const embodiedCarbon = r.f64();
  texts.push(r.text(), r.text());
  return { guid: o.guid, index: h.index, name: h.name, id, priority, cutFill, cutFillPen, cutFillBackgroundPen, surface, fillOrientation, thermalConductivity, density, heatCapacity, embodiedEnergy, embodiedCarbon, texts };
}

function composite(o: ArchicadObject): ArchicadComposite {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  const thickness = r.f64();
  const n = r.u16();
  const slots: ArchicadSkin[] = [];
  while (u16(o.data, r.p) === 0x0105 && u32(o.data, r.p + 2) === 17) {
    r.skip(6);
    const buildingMaterial = r.ref();
    const framePen = r.i16();
    const k = r.u8();
    slots.push({ buildingMaterial, framePen, kind: k === 1 ? "core" : k === 5 ? "finish" : "other", thickness: r.f64() });
  }
  const lines: ArchicadSkinLine[] = [];
  while (lines.length <= slots.length && r.p + 10 <= o.data.length && u16(o.data, r.p) === 2) {
    r.skip(2);
    const lineType = r.ref();
    const pen = r.i16();
    lines.push({ lineType, pen });
  }
  if (n > slots.length || lines.length < n + 1) throw new Error("fewer skins stored than counted");
  return {
    guid: o.guid,
    index: h.index,
    name: h.name,
    thickness,
    forWalls: (h.flags & 4) !== 0,
    forSlabs: (h.flags & 8) !== 0,
    forRoofs: (h.flags & 0x10) !== 0,
    forShells: (h.flags & 0x20) !== 0,
    skins: slots.slice(0, n),
    lines: lines.slice(0, n + 1),
  };
}

/** A hatch record's polygon at `at`: contours with their arcs; null when it isn't one. */
function polygon(d: Uint8Array, at: number, end: number): ArchicadContour[] | null {
  const r = new Reader(d.subarray(0, end), at);
  const n = r.u32();
  if (n < 2 || at + 4 + 16 * n > end) return null;
  const coords: Point[] = [];
  for (let i = 0; i < n; i++) coords.push({ x: r.f64(), y: r.f64() });
  if (r.u16() !== 1) return null;
  const arcCount = r.u32();
  if (arcCount > n) return null;
  const arcs: { from: number; to: number; angle: number }[] = [];
  for (let i = 0; i < arcCount; i++) arcs.push({ from: r.u32(), to: r.u32(), angle: r.f64() });
  if (r.u16() !== 1) return null;
  const endCount = r.u32();
  if (endCount < 2 || endCount > n) return null;
  const ends: number[] = [];
  for (let i = 0; i < endCount; i++) ends.push(r.u32());
  if (ends[0] !== 0 || ends[endCount - 1] !== n - 1 || ends.some((e, i) => i > 0 && e <= ends[i - 1])) return null;
  if (!coords.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x) < 1e6 && Math.abs(c.y) < 1e6)) return null;
  const contours: ArchicadContour[] = [];
  for (let k = 1; k < endCount; k++) {
    const first = ends[k - 1] + 1;
    const last = ends[k];
    const points = coords.slice(first, last + 1);
    const own = arcs.filter((a) => a.from >= first && a.from < last && a.to === a.from + 1).map((a) => ({ from: a.from - first, angle: a.angle }));
    contours.push({ points, arcs: own });
  }
  return contours;
}

function profile(o: ArchicadObject): ArchicadProfile {
  const d = o.data;
  const h = head(d);
  const r = new Reader(d, h.own);
  r.skip(4);
  if (r.u8() !== 9 || r.u8() !== 1) throw new Error("no vector image");
  const size = r.u32();
  const end = r.p + size;
  if (end > d.length) throw new Error("vector image runs past the object");
  const parts: ArchicadProfilePart[] = [];
  for (let p = r.p; p + 6 + 53 <= end; p++) {
    if (d[p] !== 3 || d[p + 1] !== 1) continue;
    const length = u32(d, p + 2);
    const at = p + 6;
    if (length < 53 || at + length > end || u16(d, at) !== 0 || u16(d, at + 2) !== 2) continue;
    const contours = polygon(d, at + 49, at + length);
    if (!contours) continue;
    const bg = u16(d, at + 6);
    parts.push({ fillPen: u16(d, at + 4), fillBackgroundPen: bg >= 0x8000 ? bg - 0x10000 : bg, fill: i32(d, at + 8), buildingMaterial: i32(d, at + 12), contours });
    p = at + length - 1;
  }
  if (!parts.length) throw new Error("no hatches");
  return { guid: o.guid, index: h.index, name: h.name, parts };
}

const FILL_KINDS: Record<number, ArchicadFillKind> = { 0: "vectorial", 1: "symbol", 2: "solid", 4: "linear-gradient", 5: "radial-gradient", 6: "image" };

function fill(o: ArchicadObject): ArchicadFill {
  const d = o.data;
  const h = head(d);
  const r = new Reader(d, h.own);
  const pattern: number[] = [];
  for (let i = 0; i < 8; i++) pattern.push(r.u8());
  const spacing = { x: r.f64(), y: r.f64() };
  const angle = r.f64();
  r.skip(32);
  const code = r.u16();
  r.skip(6);
  let kind = FILL_KINDS[code] ?? "unknown";
  let percent = kind === "solid" ? 1 : 0;
  let image: string | null = null;
  const lines: ArchicadHatchLine[] = [];
  if (kind === "vectorial") {
    r.expect16(1);
    const n = r.u32();
    if (n > 10000) throw new Error("too many hatch lines");
    if (n) {
      const length = r.u32();
      const end = r.p + length;
      for (let i = 0; i < n; i++) {
        const spacing = r.f64();
        const angle = r.f64();
        const offset = r.f64();
        const origin = { x: r.f64(), y: r.f64() };
        const parts = r.u32();
        r.skip(4);
        if (parts > 1000) throw new Error("too many dashes");
        const dashes: number[] = [];
        for (let k = 0; k < parts; k++) dashes.push(r.f64());
        lines.push({ spacing, angle, offset, origin, dashes });
      }
      if (r.p !== end) throw new Error("hatch lines don't fill their length");
    } else kind = "empty";
  } else if (kind === "solid") {
    percent = r.f64();
    if (percent === 0) kind = "empty";
  } else if (kind === "image") {
    const s = utf16At(d, r.p) ?? utf16At(d, r.p + 2);
    image = s ? s.text : null;
  }
  return {
    guid: o.guid,
    index: h.index,
    name: h.name,
    kind,
    scaled: (h.flags & 1) !== 0,
    forCut: (h.flags & 2) !== 0,
    forDrafting: (h.flags & 4) !== 0,
    forCover: (h.flags & 8) !== 0,
    pattern,
    spacing,
    angle,
    percent,
    lines,
    image,
  };
}

function lineType(o: ArchicadObject): ArchicadLineType {
  const d = o.data;
  const h = head(d);
  const r = new Reader(d, h.own);
  const defineScale = r.f64();
  const period = r.f64();
  const height = r.f64();
  const code = r.u16();
  const scaled = r.u16() === 2;
  if (code < 1 || code > 3) throw new Error(`line type kind ${code}`);
  const kind = code === 1 ? "solid" : code === 2 ? "dashed" : "symbol";
  r.skip(100);
  const groups = r.u16();
  const length = r.u32();
  const end = r.p + length;
  if (end > d.length) throw new Error("line items run past the object");
  const segments: ArchicadLineSegment[] = [];
  if (kind === "dashed") {
    for (let g = 0; g < groups; g++) {
      r.skip(4);
      const item = r.u16();
      const n = r.u16();
      const values: number[] = [];
      for (let i = 0; i < n; i++) values.push(r.f64());
      if (item === 2) for (const v of values) segments.push({ start: v, length: 0 });
      else if (item === 3) for (let i = 0; i + 1 < n; i += 2) segments.push({ start: values[i], length: values[i + 1] });
      else throw new Error(`dashed line item kind ${item}`);
    }
    if (r.p !== end) throw new Error("dash items don't fill their length");
    segments.sort((a, b) => a.start - b.start);
  }
  return { guid: o.guid, index: h.index, name: h.name, kind, scaled, defineScale, period, height, segments };
}

function zoneCategory(o: ArchicadObject): ArchicadZoneCategory {
  const h = head(o.data);
  const r = new Reader(o.data, h.own);
  const code = r.text();
  r.text();
  const stamp = r.text();
  return { guid: o.guid, index: h.index, name: h.name, code, stamp, color: r.rgb() };
}

// ---- containers, sets, stories, geolocation -------------------------------------------------------

interface Container {
  /** the 4-letter kind, as Archicad spells it ("LAY2") */
  readonly tag: string;
  readonly set: string;
  readonly current: string | null;
  readonly members: readonly string[];
}

function container(d: Uint8Array): Container {
  const r = new Reader(d, OBJECT_DATA + 2 + 6 + 8);
  r.text();
  let tag = "";
  for (let i = 3; i >= 0; i--) tag += String.fromCharCode(d[r.p + i]);
  r.skip(4 + 8);
  r.expect16(6);
  const current = r.guid();
  r.skip(4);
  r.expect16(1);
  const members: string[] = [];
  const kind = r.u8();
  if (kind === 1) {
    r.skip(16);
    const n = r.u32();
    if (n > 1000000) throw new Error("too many members");
    for (let i = 0; i < n; i++) members.push(r.guid());
  } else if (kind === 0x11) {
    r.skip(16);
    members.push(r.guid());
  } else if (kind !== 0x12) throw new Error(`member list kind ${kind}`);
  return { tag, set: lastGuid(d), current: /^0+$/.test(current) ? null : current, members };
}

interface AttributeSet {
  readonly guid: string;
  readonly database: string;
  readonly main: boolean;
}

function attributeSet(o: ArchicadObject): AttributeSet {
  const d = o.data;
  if (d.length < OBJECT_DATA + 40 || d[d.length - 34] !== 0x12) throw new Error("no database reference");
  return { guid: o.guid, database: lastGuid(d), main: hex(d, d.length - 33, 16) === MAIN_DATABASE };
}

interface Floor {
  readonly name: string;
  readonly index: number;
  readonly showOnSections: boolean;
}

function floor(d: Uint8Array): Floor {
  const r = new Reader(d, OBJECT_DATA + 8);
  const name = r.text();
  const index = r.i16();
  return { name, index, showOnSections: r.u8() !== 0 };
}

/** The floors a structure lists: a u32 count followed by that many known floor GUIDs. */
function structureFloors(d: Uint8Array, floors: ReadonlySet<string>): string[] {
  for (let p = OBJECT_DATA; p + 20 <= d.length; p++) {
    const n = u32(d, p);
    if (n < 1 || n > 10000 || p + 4 + 16 * n > d.length) continue;
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const g = hex(d, p + 4 + 16 * i, 16);
      if (!floors.has(g)) break;
      list.push(g);
    }
    if (list.length === n) return list;
  }
  throw new Error("no floor list");
}

function geoLocation(d: Uint8Array): ArchicadGeoLocation {
  for (let p = OBJECT_DATA; p + 54 <= d.length && p < OBJECT_DATA + 400; p++) {
    const year = u16(d, p);
    const month = u16(d, p + 2);
    const day = u16(d, p + 4);
    const hour = u16(d, p + 6);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) continue;
    const longitude = f64(d, p + 12);
    const latitude = f64(d, p + 20);
    if (!(Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90)) continue;
    const altitude = f64(d, p + 30);
    const north = f64(d, p + 46);
    if (!Number.isFinite(altitude) || !Number.isFinite(north) || Math.abs(north) > 1000) continue;
    return { longitude, latitude, altitude, north };
  }
  throw new Error("no geolocation");
}

// ---- the whole -----------------------------------------------------------------------------------

type Decoded = { readonly guid: string; readonly index: number };

const KINDS = {
  layers: { cls: LAYER, tag: "LAY2", decode: layer },
  layerCombinations: { cls: LAYER_COMB, tag: "LCO2", decode: layerCombination },
  pens: { cls: PEN_TABLE, tag: "PTBL", decode: penTable },
  surfaces: { cls: MATERIAL, tag: "MAT2", decode: surface },
  buildingMaterials: { cls: BUILDING_MATERIAL, tag: "BMAT", decode: buildingMaterial },
  composites: { cls: COMP_WALL, tag: "CWA2", decode: composite },
  profiles: { cls: PROFILE, tag: "PROF", decode: profile },
  fills: { cls: FILL, tag: "FIL3", decode: fill },
  lineTypes: { cls: LINE_TYPE, tag: "LIN2", decode: lineType },
  zoneCategories: { cls: ROOM_CAT, tag: "RMC2", decode: zoneCategory },
} as const;

type KindName = keyof typeof KINDS;

/**
 * The project's stories and attributes (and those of each hotlinked module source kept in the
 * file), with the objects that didn't decode counted by class. Never throws on a bad object.
 */
export function readAttributes(objects: ObjectsByClass): ArchicadAttributes {
  const problems: Record<string, number> = {};
  const problem = (cls: string): void => {
    const name = ATTRIBUTE_CLASS_NAMES.get(cls) ?? cls;
    problems[name] = (problems[name] ?? 0) + 1;
  };
  const each = <T>(cls: string, f: (o: ArchicadObject) => T): Map<string, T> => {
    const out = new Map<string, T>();
    for (const o of objects.get(cls) ?? []) {
      try {
        out.set(o.guid, f(o));
      } catch {
        problem(cls);
      }
    }
    return out;
  };

  const decoded = new Map<KindName, Map<string, Decoded>>();
  for (const [name, kind] of Object.entries(KINDS) as [KindName, (typeof KINDS)[KindName]][]) decoded.set(name, each<Decoded>(kind.cls, kind.decode));

  const sets = each(ATTRIBUTE_SET, attributeSet);
  const containers = each(ATTRIBUTE_CONTAINER, (o) => container(o.data));
  const floors = each(FLOOR, (o) => floor(o.data));
  const levels = new Map<string, number>();
  for (const o of objects.get(FLOOR_GEOMETRY) ?? []) {
    const level = o.data.length >= OBJECT_DATA + 16 + 17 ? f64(o.data, OBJECT_DATA + 8) : NaN;
    if (Number.isFinite(level) && Math.abs(level) < 1e5) levels.set(lastGuid(o.data), level);
    else problem(FLOOR_GEOMETRY);
  }
  const floorGuids = new Set(floors.keys());
  const structures = each(FLOOR_STRUCTURE, (o) => ({ database: lastGuid(o.data), floors: structureFloors(o.data, floorGuids) }));

  const storiesOf = (floorList: readonly string[]): ArchicadStory[] => {
    const known = floorList.flatMap((g) => {
      const f = floors.get(g);
      const level = levels.get(g);
      return f && level !== undefined ? [{ guid: g, ...f, level }] : [];
    });
    known.sort((a, b) => a.index - b.index);
    // the highest-indexed floor closes the structure: it is the top story's ceiling, not a story
    const stories = known.slice(0, -1);
    return stories.map((s, i) => ({ guid: s.guid, index: s.index, name: s.name, level: s.level, height: known[i + 1].level - s.level, showOnSections: s.showOnSections }));
  };

  const databaseOf = (setGuid: string | null, database: string, structureFloors: readonly string[]): ArchicadDatabaseAttributes => {
    const mine = [...containers.values()].filter((c) => setGuid === null || c.set === setGuid);
    const pick = <K extends KindName>(name: K): ReturnType<(typeof KINDS)[K]["decode"]>[] => {
      const all = decoded.get(name) ?? new Map<string, Decoded>();
      const tagged = mine.filter((c) => c.tag === KINDS[name].tag);
      const list = setGuid === null && !tagged.length ? [...all.values()] : tagged.flatMap((c) => c.members.flatMap((g) => (all.has(g) ? [all.get(g) as Decoded] : [])));
      return list.sort((a, b) => a.index - b.index) as ReturnType<(typeof KINDS)[K]["decode"]>[];
    };
    const tables = pick("pens");
    const current = mine.find((c) => c.tag === KINDS.pens.tag)?.current ?? null;
    const model = tables.find((t) => t.guid === current) ?? null;
    return {
      database,
      stories: storiesOf(structureFloors),
      layers: pick("layers"),
      layerCombinations: pick("layerCombinations"),
      pens: { tables, model: model ? model.index : null, modelPens: model ? model.pens : [] },
      surfaces: pick("surfaces"),
      buildingMaterials: pick("buildingMaterials"),
      composites: pick("composites"),
      profiles: pick("profiles"),
      fills: pick("fills"),
      lineTypes: pick("lineTypes"),
      zoneCategories: pick("zoneCategories"),
    };
  };

  const setList = [...sets.values()];
  const mainSet = setList.find((s) => s.main) ?? (setList.length === 1 ? setList[0] : null);
  const floorsOf = (database: string | null): readonly string[] => {
    const all = [...structures.values()];
    const s = database === null ? (all.length === 1 ? all[0] : undefined) : all.find((x) => x.database === database);
    return s ? s.floors : [];
  };
  const main = mainSet ? databaseOf(mainSet.guid, mainSet.database, floorsOf(mainSet.database)) : databaseOf(null, "", floorsOf(null));
  const modules = setList.filter((s) => s !== mainSet).map((s) => databaseOf(s.guid, s.database, floorsOf(s.database)));

  let location: ArchicadGeoLocation | null = null;
  for (const o of objects.get(GEO_LOCATION) ?? []) {
    try {
      location = geoLocation(o.data);
    } catch {
      problem(GEO_LOCATION);
    }
  }
  return { ...main, modules, geoLocation: location, problems };
}
