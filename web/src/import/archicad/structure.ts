// Archicad's structural and assembled elements, decoded from their objects (gathered by
// ./objects.ts): beams and columns with the segments, cross-section shapes and profiles they are
// built from; curtain walls with their segments, frames and panels; stairs; railings. Read the same
// way from Archicad 25, 27 and 29 files.
//
// The framework every object here shares. A payload is the class GUID, the 23-byte object header
// (whose last u32 is the length of the first section, which starts at byte 39), the first section,
// then a links section: a u32 length, u16 1, then entries until a 00 byte. An entry is a tag byte, a
// link-type GUID and its targets: tag 11 one target and 01 a u32 count then that many (links the
// object owns: a beam its segments), tag 12 one target and 02 a count then that many (links back to
// an owner: a segment its beam, an element its EDB::Floor story). The same link type is 11/01 on one
// side and 12/02 on the other, so every parent/child link here is stored twice, once each way, and
// children are found by following the owner's 11/01 links in their stored order. The first section
// starts with a chain of base-class versions ending 8x 00 03 00 00 01 + the class GUID again + a u16
// count + that many u16 versions; the class data follows. x is 83 in Archicad 29 and 82 in 25 and
// 27; in 25 the u16 before it is 04 (09 in 27 and 29), which tells the versions apart.
//
// Element objects (beam, column, curtain wall, stair, railing) carry an element header: a flags
// byte, 01 00, the layer (i32, a VBAttr::Layer attribute index), the story (i16 then a u16: the
// index of the EDB::Floor the element also links to, link type 0312b679…), in Archicad 25 ten more
// bytes (u32 0, u16 1, u32 0 or 1), then 01 00, two u32, then UTF-16 strings: three for beams and
// columns (two empty ones, then the element ID), one (the ID) for the rest. Where it sits: in
// Archicad 29 every element's class data starts with 16 bytes, a u32 m and m bytes; beams and
// columns then have a block (u32 n, n bytes) holding the anchor and a 3D cache; in 29 a u32 follows;
// then the header. In 25 and 27 the header comes first, after the beam or column block when there is
// one. It is looked for over a few bytes from there, checked by its 01 00 markers and strings.
// Sub-elements (curtain wall segments, frames, panels) have the same header with story -42, no ID.
//
// Beam. After the ID: a byte, f64 0, the level (reference line height above the story), the
// reference line begin x,y and end x,y, the arc angle (0 straight, else the curved beam's central
// angle), a u32, attributes and pens, and at +0x61 the slant angle (0 level, positive rising toward
// the end; found where the 3D cache's end is higher by tan(slant)·length). The anchor (i32, 0..8,
// the section point on the reference line) opens the block before the header (in 25 at block+97,
// else block+1); 16 bytes on, a byte says whether the 3D cache follows: 01 00 01 00 01 00 00 00 01
// 00 then four 3D points: the reference line begin and end (z = level and level + slant rise) and
// the same line moved to the section's centre (z + height/2 for anchors 0-2, - height/2 for 6-8, 0
// for 3-5; that is the evidence for which row is which). Some Archicad 25 beams and columns have no
// cache (a 0x72-byte block).
//
// Segments. A beam owns its segments (link type a72c76d5…, in order; a column 21864427…). A
// segment's class data (in 29 after the same 16 + 4 + m bytes) is u32 n, `01 00 01 00 00 00`, two
// f64, then at +0x1a 03 00 02 00 02 00 02 00, at +0x22 the building material (01 00 + i32; every
// value of a rectangular or circular segment in all seven samples is a VBAttr::BuildingMaterial
// index of its element's database; a complex profile's segment keeps an old value there, as its
// materials are the profile's), two pen overrides, a u16, an attribute, and at +0x36 01 00 + a
// VBAttr::Material (surface) index (every value but 0, none, is a surface index), repeated for the
// faces after it. A segment owns its shape (306cb863…):
// VBElem::RectangularAssemblySegmentShape (after u32 n and 01 00: width, height, both f64; in 29
// after 12 more bytes first; when the shape carries its contour cache, "$mm" then the section's
// bounding box minX,minY,maxX,maxY around the reference line), the same layout in a third class no
// sample names (3929c1d6…) whose width and height are equal in every one of its objects (read as a
// circle's diameter; Archicad's segment shapes are rectangular, circular and complex), or
// ProfiledAssemblySegmentShape, which owns a VBElem::AssemblySegmentProfile (443b07ca…) whose first
// section holds 8 bytes, then 01 00 + the VBAttr::Profile index (i32) at byte 49, then what looks
// like the profile's own vector image (02 00, 09 01, u32 size, as in VBAttr::Profile data): the
// segment keeps a copy, and in one sample some indices name no profile left in the file.
//
// Column. After the ID (200 bytes, the same in 25, 27 and 29): u32, the top offset (from the
// top-linked story), the height (meaningful when the top isn't linked), the bottom offset (from the
// home story), the slant direction angle, the origin x,y, pen/attributes, two f64 (0.08), at +0x4f
// the slant angle (π/2 upright) and at +0x57 the axis rotation (the 3D cache's local axes are cos/sin
// of it). The top-linked story is a link (2dbcbe5e…) to an EDB::FloorIndirection whose own link
// (805bf9ba…) is the EDB::Floor; columns without it are not top-linked and their height is the
// stored one. The block before the header is a beam's (anchor, cache with bottom and top points), so
// the cached height is the distance between them.
//
// Curtain wall. The header as above; it owns placed segments (e53f3a20…; 7484b6fb… is the default
// one), frames (27130ae6…) and panels (db35bf66…), plus default frames/panels/junctions/accessories
// it uses as templates. A CWSegment's header (no strings) is followed by 14 bytes and its reference
// line as 3D begin and end points, z story-relative. A CWFrame's first section ends with: four f64
// of section (the two halves of the width, the depth from and to), f64, u32, u32 kind, 6 bytes, six
// f64 (a box: minX, minY, maxX, maxY, minZ, maxZ) and a 01 byte. With kind 3 the box is the frame
// body's; with kind 0 it is its axis line's alone (no extent across the frame). Frame boxes are in
// absolute z (their minimum sits at the story's level plus the segment's z in every sample), unlike
// the segments. A placed frame links back (506d5caa…) to the default frame it was made from. A
// CWPanel stores no geometry (its look is a library part: see libparts.ts): its first section lists
// (06 00 + GUID) the frames that bound it and its segment(s), so its outline is rebuilt here: each
// segment's frames lie in one plane (u along the segment, v the direction the frames spread across
// it: vertical, sloped or flat), each frame's axis is the line along u or v that fits its box (or
// for a frame sloped in the plane, the box diagonal that meets the frames around it), and the panel's
// corners are where its frames' axes meet, walked frame to frame.
//
// Stair. The header as above; it owns treads and risers (VBElem::Tread, VBElem::Riser), side and
// monolith structures, its library-part Symbs (382c5061…, d1d25093…) and, in most stairs, a
// VBElem::StairSchemeGeometry (3f141750…) whose step lines are records 03 00 3d 00 + x1,y1,x2,y2 in
// the stair's local plan coordinates, in order up the stair. The placement is the one 3D point
// followed by a 3x3 matrix turning about z that the stair's data holds (its offset varies with what
// comes before it: one such matrix per stair in every sample; with it, step lines of stairs land on
// their railings' nodes where samples have both).
//
// Railing. The header as above, then 00 01 00 04 00 and the placement: origin x,y,z and a 3x3
// matrix (then a copy). It owns RailingNodes (b0fb595d… the first, 00b2cffa… the rest, in order),
// each owning a vertex (4df31ce0…): a VBElem::StaticRailingVertex whose first section ends with its
// x,y (plan, like beams) and z, or an unnamed class (2ef99de3…) with no coordinates, for a node
// attached to another element (a stair, a slab edge); and segments, whose patterns own posts,
// panels, balusters and rails, gathered here as children by class.

import { f64, hex, i32, u16, u32, utf16At, type ArchicadObject, type ObjectsByClass } from "./objects.ts";

/** Class GUIDs (hex as stored) of the classes this module reads. */
const CLASS = {
  beam: "85d2c2a57c5a684a95549eda9d4556ca",
  beamSegment: "c67babcb3ae033419161c28ed3368672",
  rectShape: "551919c4c687b64fb0745f094fe9f6a6",
  profiledShape: "40ae258827f8574aa1c549d04c687c46",
  circleShape: "3929c1d605d9e040aa57f7c8d687dc7b",
  profile: "d72bcdf4b1d4bf4ab13c59001907bbbd",
  column: "85ebe813335aa347a4d41e05296aec7e",
  columnSegment: "ab821a7acd69e640a7d876564f981cf9",
  curtainWall: "17c853c655a84644aef424efb46271aa",
  cwSegment: "42a7e656f989084aa470434d1d202db9",
  cwFrame: "bd19ff350a0a374289b8536f4b5d0d75",
  cwPanel: "3d2db16730c3d1408c43887d5c5e2b01",
  cwJunction: "71414c8354966046aaed05b2bf046e2a",
  cwAccessory: "e535c29ba97b154db825d0a898b5c21b",
  stair: "157f0ffab429054980fac6769109847b",
  stairScheme: "9c2b80871011ba4dbf9c9eb8278960b0",
  tread: "af5e42b03c166c41b030050e538b85e0",
  riser: "81aed3bfc0d25f4dbadaa005458c7c3e",
  railing: "1ae65a4c17af854b93e0005c987d5f5b",
  railingSegment: "9995f52972f9f744af1d1f24770725c3",
  railingNode: "d5d14bf595714e4e8833f307fef2e569",
  railingVertex: "14178fd9926df640b37cc63ba2c145b1",
  attachedVertex: "2ef99de3ab618342ba6adce78ae1c252",
  railingPost: "1fe1c6a6774fb147a328f7ac3fa37a5f",
  railingPanel: "62125bbd6c31d24f8eff64f58d76308f",
  railingPattern: "1d37e110f0976141abd15c890f6cfe14",
  innerPost: "9933f3121b116241ad9934ccf0713f46",
  baluster: "9a13a3f44455cf4fb9d4bd231992da4b",
  balusterSet: "04e7aa5246d7984482fb073339d44f38",
  toprail: "9756eb59ba837848bdd460e7a3ffc9f5",
  handrail: "9e6a18376e8a0044b0efc0545e4ac3bf",
  rail: "f9501618bec1cc4f8581f4f4f756d906",
  floorIndirection: "4d04d664e803ec42bd568813cc6481cb",
} as const;

const NAME: Readonly<Record<string, string>> = {
  [CLASS.beam]: "Beam",
  [CLASS.beamSegment]: "VBElem::BeamSegment",
  [CLASS.rectShape]: "VBElem::RectangularAssemblySegmentShape",
  [CLASS.profiledShape]: "ProfiledAssemblySegmentShape",
  [CLASS.circleShape]: "circular segment shape (class name not stored in any sample)",
  [CLASS.profile]: "VBElem::AssemblySegmentProfile",
  [CLASS.column]: "Column",
  [CLASS.columnSegment]: "VBElem::ColumnSegment",
  [CLASS.curtainWall]: "CurtainWall",
  [CLASS.cwSegment]: "CWSegment",
  [CLASS.cwFrame]: "CWFrame",
  [CLASS.cwPanel]: "CWPanel",
  [CLASS.cwJunction]: "CWJunction",
  [CLASS.cwAccessory]: "CWAccessory",
  [CLASS.stair]: "VBElem::Stair",
  [CLASS.stairScheme]: "VBElem::StairSchemeGeometry",
  [CLASS.tread]: "VBElem::Tread",
  [CLASS.riser]: "VBElem::Riser",
  [CLASS.railing]: "VBElem::Railing",
  [CLASS.railingSegment]: "VBElem::RailingSegment",
  [CLASS.railingNode]: "VBElem::RailingNode",
  [CLASS.railingVertex]: "VBElem::StaticRailingVertex",
  [CLASS.attachedVertex]: "attached railing vertex (class name not stored in any sample)",
  [CLASS.railingPost]: "VBElem::RailingPost",
  [CLASS.railingPanel]: "VBElem::RailingPanel",
  [CLASS.railingPattern]: "VBElem::RailingPattern",
  [CLASS.innerPost]: "VBElem::InnerPost",
  [CLASS.baluster]: "VBElem::Baluster",
  [CLASS.balusterSet]: "VBElem::BalusterSet",
  [CLASS.toprail]: "VBElem::Toprail",
  [CLASS.handrail]: "VBElem::Handrail",
  [CLASS.rail]: "VBElem::Rail",
  [CLASS.floorIndirection]: "EDB::FloorIndirection",
};

/** Every class GUID this module reads; pass it to objectsInFile / readObjects. */
export const STRUCTURE_CLASSES: ReadonlySet<string> = new Set(Object.values(CLASS));

/** The class name for one of STRUCTURE_CLASSES. */
export const structureClassName = (guid: string): string => NAME[guid] ?? guid;

/** Link types (GUID hex as stored). */
const LINK = {
  floor: "0312b67984ae884da9c620ead705e0bc",
  beamSegment: "a72c76d520d95d45a37328ba6d47152a",
  columnSegment: "21864427dc9ae643b5aafc76e4cd62ce",
  shape: "306cb86321a21c4284fb926c694bf611",
  profile: "443b07ca55067d4097151a019e628139",
  columnTop: "2dbcbe5e0bcf51478f557c2353c3fd14",
  stairTop: "74c103daf96ec043883cdbae884869a5",
  indirectionFloor: "805bf9ba56f23249b89103ff66848591",
  cwSegments: "e53f3a2056c59b4c81d0abf77def748e",
  cwFrames: "27130ae6d1787442b2f0775e80ecead4",
  cwPanels: "db35bf66df79ba4cbf98792b948f121e",
  frameTemplate: "506d5caa6089ee4f99535b2eacf8bc13",
  panelTemplate: "0710a83d6561e54b8a83c59e1ff9c694",
  stairScheme: "3f141750bd7ce14683e68cf63b89a01c",
  railingFirstNode: "b0fb595d45539a489ad7b71c79ffa1da",
  railingNodes: "00b2cffacf79a7419b7a77fc2893d38c",
  nodeVertex: "4df31ce06121d048aa231bfe35c6b3ed",
  stairSymbol: "382c50615e11ba488491fbccad008f5d",
  stairSymbol2: "d1d250935c71fa4284e2faa5862a710e",
} as const;

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

/** What every element carries. */
export interface ElementBase {
  /** the object's GUID */
  readonly guid: string;
  /** the home story: an EDB::Floor index */
  readonly story: number;
  /** a VBAttr::Layer attribute index */
  readonly layer: number;
  /** the element ID */
  readonly id: string;
  /** the home story's EDB::Floor object GUID (its link), when stored */
  readonly floor: string | null;
}

export type Section =
  | { readonly kind: "rectangular"; readonly width: number; readonly height: number }
  /** the third shape class: width and height stored equal in every object seen, read as the diameter */
  | { readonly kind: "circular"; readonly diameter: number }
  /** a complex profile: the AssemblySegmentProfile object (it also holds a copy of the profile's image) and the VBAttr::Profile index it names (possibly one since deleted) */
  | { readonly kind: "profile"; readonly profileObject: string | null; readonly profile: number | null };

/** A beam or column segment and its cross-section. */
export interface AssemblySegment {
  readonly guid: string;
  /** null when the shape object is missing or didn't decode */
  readonly section: Section | null;
  /** the section's bounding box around the reference line (min/max x, y), when the shape caches its contour */
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null;
  /**
   * the VBAttr::BuildingMaterial index. For a complex profile Archicad builds the segment from the
   * profile's own parts and materials; the field then keeps an old value that may name no building
   * material of the element's database.
   */
  readonly material: number | null;
  /** the first VBAttr::Material (surface) index the segment stores (the following face references are not split out) */
  readonly surface: number | null;
}

export interface Beam extends ElementBase {
  /** reference line in plan */
  readonly begin: Point2;
  readonly end: Point2;
  /** reference line height above the home story */
  readonly level: number;
  /** slant (pitch) angle: 0 level, positive rising toward the end */
  readonly slant: number;
  /** central angle of a curved beam, 0 when straight */
  readonly arc: number;
  /** section anchor 0..8 on the reference line (0-2 the section sits above it, 6-8 below, 3-5 centred) */
  readonly anchor: number;
  /** the section-centre line from the 3D cache (story-relative z), when the beam has one */
  readonly axis: { readonly begin: Point3; readonly end: Point3 } | null;
  /** segments in order (one for most beams) */
  readonly segments: readonly AssemblySegment[];
}

export interface Column extends ElementBase {
  /** origin (axis) in plan */
  readonly origin: Point2;
  /** bottom above the home story */
  readonly bottomOffset: number;
  /** top relative to the top-linked story (when linked) */
  readonly topOffset: number;
  /** the top-linked story's EDB::Floor object GUID; null when the top isn't linked */
  readonly topFloor: string | null;
  /** the stored height, meaningful when the top isn't linked */
  readonly storedHeight: number;
  /** the height from the 3D cache (top z - bottom z), when the column has one */
  readonly height: number | null;
  /** axis rotation */
  readonly rotation: number;
  /** slant angle, π/2 upright */
  readonly slant: number;
  /** the direction a slanted column leans */
  readonly slantDirection: number;
  readonly anchor: number;
  readonly segments: readonly AssemblySegment[];
}

export interface CWSegment {
  readonly guid: string;
  /** the segment's reference line, 3D, story-relative z */
  readonly begin: Point3;
  readonly end: Point3;
}

export interface CWFrame {
  readonly guid: string;
  /** the default frame it was made from */
  readonly template: string | null;
  /** the segment it was matched to (the nearest in plan) */
  readonly segment: string | null;
  /** the stored box: of the frame's body when boundsOfBody, else of its axis line only */
  readonly bounds: Box3;
  readonly boundsOfBody: boolean;
  /** the frame's axis, rebuilt from the box and its segment's direction, on the segment's vertical plane (vertical or horizontal only) */
  readonly axis: { readonly begin: Point3; readonly end: Point3 };
  /** section: width across the face, and the depth range from the reference plane; null when the frame has none */
  readonly section: { readonly width: number; readonly depthFrom: number; readonly depthTo: number } | null;
}

export interface CWPanel {
  readonly guid: string;
  readonly template: string | null;
  /** the frames around it, as stored */
  readonly frames: readonly string[];
  /** the segment(s) it lies on, as stored (two or more when it turns a corner) */
  readonly segments: readonly string[];
  /** corners rebuilt from those frames' axes, in loop order; null when they don't close one loop */
  readonly polygon: readonly Point3[] | null;
}

export interface CurtainWall extends ElementBase {
  readonly segments: readonly CWSegment[];
  readonly frames: readonly CWFrame[];
  readonly panels: readonly CWPanel[];
}

export interface Placement {
  readonly origin: Point3;
  /** 3x3 rotation, row-major as stored */
  readonly matrix: readonly number[];
}

export interface Stair extends ElementBase {
  /** the top-linked story's EDB::Floor object GUID */
  readonly topFloor: string | null;
  /** tread and riser object GUIDs */
  readonly treads: readonly string[];
  readonly risers: readonly string[];
  /** step lines in the stair's local plan coordinates (from its scheme geometry), bottom to top, turned so every a end is on one side */
  readonly stepLines: readonly { readonly a: Point2; readonly b: Point2 }[];
  /** local plan outline through the step lines' ends (a side up, b side down; it cuts across landings' outer corners) */
  readonly outline: readonly Point2[];
  /** local walking line: the step lines' midpoints */
  readonly walkingLine: readonly Point2[];
  /** local → plan placement (a turn about z), story-relative z */
  readonly placement: Placement | null;
  /** the Symb objects the stair owns (its library-part representation; read by libparts.ts) */
  readonly symbols: readonly string[];
}

export interface Railing extends ElementBase {
  readonly placement: Placement | null;
  /** the reference polyline's nodes in order: x, y in plan, z relative; null for a node attached to another element (it stores no point) */
  readonly nodes: readonly (Point3 | null)[];
  readonly segments: readonly string[];
  /** owned components (posts, panels, rails, balusters, …) by class name */
  readonly parts: Readonly<Record<string, readonly string[]>>;
}

export interface Structure {
  readonly beams: readonly Beam[];
  readonly columns: readonly Column[];
  readonly curtainWalls: readonly CurtainWall[];
  readonly stairs: readonly Stair[];
  readonly railings: readonly Railing[];
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

/** The class data's start and the Archicad version, from the base-class chain; null when the class GUID isn't repeated. */
function frameOf(d: Uint8Array): Frame | null {
  if (d.length < 43) return null;
  const end = 39 + u32(d, 35);
  if (end > d.length) return null;
  for (let p = 39; p + 18 <= Math.min(end, 160); p++) {
    if (d[p] !== d[0] || hex(d, p, 16) !== hex(d, 0, 16)) continue;
    if (d[p - 1] !== 1 || d[p - 2] !== 0 || d[p - 3] !== 0 || d[p - 4] !== 3 || d[p - 5] !== 0) return null;
    const base = d[p - 6];
    const n = u16(d, p + 16);
    const at = p + 18 + 2 * n;
    if (at > end) return null;
    const version: Version = base === 0x83 ? 29 : p >= 8 && u16(d, p - 8) === 4 ? 25 : 27;
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
    if (tag === 0) break;
    if (p + 16 > end) break;
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

/** Targets of the owned (01/11) or owner (02/12) links of a type, in order. */
function linked(links: readonly Link[], type: string, owner = false): string[] {
  const out: string[] = [];
  for (const l of links) if (l.type === type && (owner ? l.tag === 0x02 || l.tag === 0x12 : l.tag === 0x01 || l.tag === 0x11)) out.push(...l.targets);
  return out;
}

const finite = (...v: number[]): boolean => v.every((x) => Number.isFinite(x) && Math.abs(x) < 1e7);

function pt3(d: Uint8Array, o: number): Point3 {
  return { x: f64(d, o), y: f64(d, o + 8), z: f64(d, o + 16) };
}

interface Header {
  readonly layer: number;
  readonly story: number;
  readonly id: string;
  /** where the element's own data starts, after the ID */
  readonly end: number;
}

/**
 * The element header at or after `from` (it is looked for over `span` bytes, so a version whose
 * preceding block is a few bytes off still reads): flags, 01 00, layer, story, [25: 10 bytes],
 * 01 00, two u32, then `strings` strings, the last the ID.
 */
function headerAt(d: Uint8Array, from: number, to: number, version: Version, strings: number, span = 48): Header | null {
  for (let p = from; p < Math.min(from + span, to - 21); p++) {
    if (d[p + 1] !== 1 || d[p + 2] !== 0) continue;
    const layer = i32(d, p + 3);
    const story = (u16(d, p + 7) << 16) >> 16;
    if (layer < 0 || layer > 1 << 20 || story < -1000 || story > 1000) continue;
    let q = p + 11;
    if (version === 25 && u32(d, q) === 0 && u16(d, q + 4) === 1 && u32(d, q + 6) < 0x10000) q += 10;
    if (q + 10 > to || u16(d, q) !== 1) continue;
    q += 10;
    let id = "";
    let ok = true;
    for (let i = 0; i < strings; i++) {
      const s = utf16At(d, q);
      if (!s || s.end > to || s.text.length > 1000) {
        ok = false;
        break;
      }
      id = s.text;
      q = s.end;
    }
    if (ok) return { layer, story, id, end: q };
  }
  return null;
}

/** Where the element header search starts, and (beams and columns) where the anchor sits. */
function elementStart(d: Uint8Array, f: Frame, withBlock: boolean): { header: number; anchor: number | null } | null {
  let p = f.at;
  if (f.version === 29) {
    if (p + 20 > f.end) return null;
    p += 20 + u32(d, p + 16);
  }
  let anchor: number | null = null;
  if (withBlock) {
    if (p + 4 > f.end) return null;
    const n = u32(d, p);
    anchor = f.version === 25 ? p + 4 + 97 : p + 5;
    p += 4 + n;
  }
  if (f.version === 29) p += 4;
  if (p > f.end || (anchor !== null && anchor + 4 > f.end)) return null;
  return { header: p, anchor };
}

/** The home story's EDB::Floor (its link). */
const floorOf = (links: readonly Link[]): string | null => linked(links, LINK.floor, true)[0] ?? null;

/** A story linked through an EDB::FloorIndirection. */
function indirectFloor(links: readonly Link[], type: string, byGuid: ReadonlyMap<string, ArchicadObject>): string | null {
  const ind = linked(links, type, true)[0];
  const o = ind ? byGuid.get(ind) : undefined;
  return o ? (linked(linksOf(o.data), LINK.indirectionFloor, true)[0] ?? null) : null;
}

// ---- beams and columns -------------------------------------------------------------------------

/** The 3D cache after a beam's or column's anchor: four points, or null. */
function cachePoints(d: Uint8Array, anchor: number, to: number): Point3[] | null {
  const at = anchor + 16;
  if (at + 11 + 96 > to || d[at] !== 1) return null;
  const marker = [1, 0, 1, 0, 1, 0, 0, 0, 1, 0];
  for (let i = 0; i < 10; i++) if (d[at + 1 + i] !== marker[i]) return null;
  const pts = [0, 1, 2, 3].map((i) => pt3(d, at + 11 + 24 * i));
  return pts.every((p) => finite(p.x, p.y, p.z)) ? pts : null;
}

/** An attribute reference (01 00 + i32 index) at `o`, or null (also for index 0: none). */
function attrAt(d: Uint8Array, o: number, to: number): number | null {
  if (o + 6 > to || u16(d, o) !== 1) return null;
  const v = i32(d, o + 2);
  return v > 0 && v < 1 << 20 ? v : null;
}

/** A beam or column segment's building material and first surface (see the header comment). */
function segmentAttributes(d: Uint8Array, f: Frame): { material: number | null; surface: number | null } {
  let p = f.at;
  if (f.version === 29) p += 20 + u32(d, p + 16);
  if (p + 0x3e > f.end || u16(d, p + 0x1a) !== 3) return { material: null, surface: null };
  return { material: attrAt(d, p + 0x22, f.end), surface: attrAt(d, p + 0x36, f.end) };
}

function readSegment(guid: string, byGuid: ReadonlyMap<string, ArchicadObject>, problems: Record<string, number>): AssemblySegment | null {
  const o = byGuid.get(guid);
  if (!o) return null;
  const f = frameOf(o.data);
  if (!f) {
    bump(problems, hex(o.data, 0, 16));
    return null;
  }
  const links = linksOf(o.data);
  const { material, surface } = segmentAttributes(o.data, f);
  const shapeGuid = linked(links, LINK.shape)[0];
  const shape = shapeGuid ? byGuid.get(shapeGuid) : undefined;
  let section: Section | null = null;
  let bounds: AssemblySegment["bounds"] = null;
  if (shape) {
    const cls = hex(shape.data, 0, 16);
    const sf = frameOf(shape.data);
    if ((cls === CLASS.rectShape || cls === CLASS.circleShape) && sf) {
      let p = sf.at + (sf.version === 29 ? 12 : 0);
      if (u16(shape.data, p + 4) !== 1 && sf.version === 29) p = sf.at;
      if (p + 22 <= sf.end && u16(shape.data, p + 4) === 1) {
        const width = f64(shape.data, p + 6);
        const height = f64(shape.data, p + 14);
        if (finite(width, height)) section = cls === CLASS.circleShape ? { kind: "circular", diameter: width } : { kind: "rectangular", width, height };
        // the contour cache: 01 24 6d 6d ("$mm"), then the bounding box
        for (let k = p + 22; k + 36 <= Math.min(sf.end, p + 120); k++) {
          if (shape.data[k] !== 0x01 || shape.data[k + 1] !== 0x24 || shape.data[k + 2] !== 0x6d || shape.data[k + 3] !== 0x6d) continue;
          const b = [0, 1, 2, 3].map((i) => f64(shape.data, k + 4 + 8 * i));
          if (finite(...b)) bounds = { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] };
          break;
        }
      }
      if (!section) bump(problems, cls);
    } else if (cls === CLASS.profiledShape) {
      const po = linked(linksOf(shape.data), LINK.profile)[0] ?? null;
      const prof = po ? byGuid.get(po) : undefined;
      let profile: number | null = null;
      if (prof && prof.data.length > 53 && u16(prof.data, 47) === 1) {
        const v = i32(prof.data, 49);
        if (v >= 0 && v < 1 << 20) profile = v;
      }
      section = { kind: "profile", profileObject: po, profile };
    }
  }
  return { guid, section, bounds, material, surface };
}

function readBeam(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>, problems: Record<string, number>): Beam | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, true);
  if (!f || !start || start.anchor === null) return null;
  const h = headerAt(d, start.header, f.end, f.version, 3);
  if (!h || h.end + 0x69 > f.end) return null;
  const e = h.end;
  const level = f64(d, e + 9);
  const begin = { x: f64(d, e + 0x11), y: f64(d, e + 0x19) };
  const end = { x: f64(d, e + 0x21), y: f64(d, e + 0x29) };
  const arc = f64(d, e + 0x31);
  const slant = f64(d, e + 0x61);
  if (!finite(level, begin.x, begin.y, end.x, end.y, arc, slant)) return null;
  const anchor = i32(d, start.anchor);
  const pts = cachePoints(d, start.anchor, h.end);
  const links = linksOf(d);
  const segments: AssemblySegment[] = [];
  for (const g of linked(links, LINK.beamSegment)) {
    const s = readSegment(g, byGuid, problems);
    if (s) segments.push(s);
  }
  return {
    guid: o.guid,
    story: h.story,
    layer: h.layer,
    id: h.id,
    floor: floorOf(links),
    begin,
    end,
    level,
    slant,
    arc,
    anchor,
    axis: pts ? { begin: pts[2], end: pts[3] } : null,
    segments,
  };
}

function readColumn(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>, problems: Record<string, number>): Column | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, true);
  if (!f || !start || start.anchor === null) return null;
  const h = headerAt(d, start.header, f.end, f.version, 3);
  if (!h || h.end + 0x5f > f.end) return null;
  const e = h.end;
  const topOffset = f64(d, e + 4);
  const storedHeight = f64(d, e + 0xc);
  const bottomOffset = f64(d, e + 0x14);
  const slantDirection = f64(d, e + 0x1c);
  const origin = { x: f64(d, e + 0x24), y: f64(d, e + 0x2c) };
  const slant = f64(d, e + 0x4f);
  const rotation = f64(d, e + 0x57);
  if (!finite(topOffset, storedHeight, bottomOffset, slantDirection, origin.x, origin.y, slant, rotation)) return null;
  const pts = cachePoints(d, start.anchor, h.end);
  const links = linksOf(d);
  const segments: AssemblySegment[] = [];
  for (const g of linked(links, LINK.columnSegment)) {
    const s = readSegment(g, byGuid, problems);
    if (s) segments.push(s);
  }
  return {
    guid: o.guid,
    story: h.story,
    layer: h.layer,
    id: h.id,
    floor: floorOf(links),
    origin,
    bottomOffset,
    topOffset,
    topFloor: indirectFloor(links, LINK.columnTop, byGuid),
    storedHeight,
    height: pts ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z) : null,
    rotation,
    slant,
    slantDirection,
    anchor: i32(d, start.anchor),
    segments,
  };
}

// ---- curtain walls -----------------------------------------------------------------------------

function readCWSegment(o: ArchicadObject): CWSegment | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, false);
  if (!f || !start) return null;
  // the sub-element header (no strings), 14 bytes, then the reference line's two 3D points
  const h = headerAt(d, start.header, f.end, f.version, 0);
  if (!h || h.end + 14 + 48 > f.end) return null;
  const begin = pt3(d, h.end + 14);
  const end = pt3(d, h.end + 38);
  if (!finite(begin.x, begin.y, begin.z, end.x, end.y, end.z)) return null;
  return { guid: o.guid, begin, end };
}

interface FrameBox {
  readonly bounds: Box3;
  readonly body: boolean;
  readonly section: CWFrame["section"];
}

/** The tail of a frame's first section: section block, u32 kind, the box, 01 (see the header comment). */
function frameBox(d: Uint8Array): FrameBox | null {
  const f = frameOf(d);
  if (!f || f.end - 103 < f.at) return null;
  const b = [0, 1, 2, 3, 4, 5].map((i) => f64(d, f.end - 49 + 8 * i));
  if (!finite(...b) || b[0] > b[2] || b[1] > b[3] || b[4] > b[5]) return null;
  const s = [0, 1, 2, 3].map((i) => f64(d, f.end - 103 + 8 * i));
  const ok = s.every((x) => Number.isFinite(x) && Math.abs(x) <= 5) && s[0] + s[1] > 0;
  return {
    bounds: { min: { x: b[0], y: b[1], z: b[4] }, max: { x: b[2], y: b[3], z: b[5] } },
    body: u32(d, f.end - 59) === 3,
    section: ok ? { width: s[0] + s[1], depthFrom: s[2], depthTo: s[3] } : null,
  };
}

type Line3 = { readonly begin: Point3; readonly end: Point3 };

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const along3 = (p: Point3, e: Point3, t: number): Point3 => ({ x: p.x + e.x * t, y: p.y + e.y * t, z: p.z + e.z * t });
function unit(a: Point3): Point3 | null {
  const l = Math.hypot(a.x, a.y, a.z);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null;
}

/** The segment whose plan line is nearest to a point in plan. */
function nearestSegment(segments: readonly CWSegment[], c: Point2): CWSegment | null {
  let best: CWSegment | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    const len = Math.hypot(s.end.x - s.begin.x, s.end.y - s.begin.y);
    const dir = len > 1e-9 ? { x: (s.end.x - s.begin.x) / len, y: (s.end.y - s.begin.y) / len } : { x: 1, y: 0 };
    const t = (c.x - s.begin.x) * dir.x + (c.y - s.begin.y) * dir.y;
    const off = Math.abs(-(c.x - s.begin.x) * dir.y + (c.y - s.begin.y) * dir.x);
    const outside = t < 0 ? -t : t > len ? t - len : 0;
    const dist = Math.hypot(off, outside);
    if (dist < bestD) (bestD = dist), (best = s);
  }
  return best;
}

const centre = (b: Box3): Point3 => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 });

/** A segment's frame plane: u along the segment, v across it (up a vertical wall, along the slope of a sloped one), n its normal, at depth `at` along n. */
interface Plane {
  readonly u: Point3;
  readonly v: Point3;
  readonly n: Point3;
  readonly at: number;
}

/**
 * The plane a segment's frames lie in: u is the segment's direction, v the direction across it in
 * which the frames' box centres spread most (vertical for an upright curtain wall, sloped or flat
 * for a slanted one; vertical when they don't spread or lean less than 2°), at the centres' mean
 * depth, taken from the axis-line boxes when there are any (a body box's centre sits off the
 * plane by the frame's depth).
 */
function framePlane(seg: CWSegment | null, frames: readonly FrameBox[]): Plane {
  const u = (seg && unit(sub(seg.end, seg.begin))) ?? { x: 1, y: 0, z: 0 };
  const e1 = unit({ x: -u.x * u.z, y: -u.y * u.z, z: 1 - u.z * u.z }) ?? { x: 0, y: 1, z: 0 };
  const e2 = cross(u, e1);
  const pts = frames.map((f) => centre(f.bounds));
  let v = e1;
  if (pts.length > 1) {
    const a = pts.map((p) => dot(p, e1));
    const b = pts.map((p) => dot(p, e2));
    const ma = a.reduce((s, x) => s + x, 0) / a.length;
    const mb = b.reduce((s, x) => s + x, 0) / b.length;
    let saa = 0;
    let sbb = 0;
    let sab = 0;
    for (let i = 0; i < a.length; i++) {
      saa += (a[i] - ma) ** 2;
      sbb += (b[i] - mb) ** 2;
      sab += (a[i] - ma) * (b[i] - mb);
    }
    if (saa + sbb > 1e-6 * pts.length) {
      const t = Math.atan2(2 * sab, saa - sbb) / 2;
      if (Math.abs(t) > (2 * Math.PI) / 180) v = { x: e1.x * Math.cos(t) + e2.x * Math.sin(t), y: e1.y * Math.cos(t) + e2.y * Math.sin(t), z: e1.z * Math.cos(t) + e2.z * Math.sin(t) };
    }
  }
  const n = cross(u, v);
  const lines = frames.filter((f) => !f.body).map((f) => centre(f.bounds));
  const depth = lines.length ? lines : pts;
  const at = depth.length ? depth.reduce((s, p) => s + dot(p, n), 0) / depth.length : 0;
  return { u, v, n, at };
}

/**
 * A frame's axis from its box, in its segment's frame plane. A frame along u or v has a box whose
 * extents are its length times |u| or |v| (plus its section): the better fit gives the direction
 * and length, through the box's centre. A frame that fits neither is sloped in the plane: it lies
 * along one of the box's diagonals, the ones closest to the plane; when two are (a box with an
 * extent of zero along a world axis can't tell them apart) both are returned, to be told apart by
 * the frames around. Every axis is put on the plane.
 */
function frameAxes(b: FrameBox, p: Plane): Line3[] {
  const e = sub(b.bounds.max, b.bounds.min);
  const c = centre(b.bounds);
  const onPlane = (q: Point3): Point3 => along3(q, p.n, p.at - dot(q, p.n));
  const fit = (dir: Point3): { dir: Point3; length: number; miss: number } => {
    const a = { x: Math.abs(dir.x), y: Math.abs(dir.y), z: Math.abs(dir.z) };
    const length = dot(e, a);
    return { dir, length, miss: Math.hypot(e.x - a.x * length, e.y - a.y * length, e.z - a.z * length) };
  };
  const fu = fit(p.u);
  const fv = fit(p.v);
  const best = fu.miss <= fv.miss ? fu : fv;
  const slack = (b.section ? b.section.width + Math.abs(b.section.depthTo - b.section.depthFrom) : 0) * 1.5 + 0.02;
  const line = (dir: Point3, length: number): Line3 => ({ begin: onPlane(along3(c, dir, -length / 2)), end: onPlane(along3(c, dir, length / 2)) });
  if (best.miss <= slack) return [line(best.dir, best.length)];
  // a body box is the axis's box grown by the section across it (in the plane) and through the depth
  const width = b.section?.width ?? 0;
  const depth = b.section ? Math.abs(b.section.depthTo - b.section.depthFrom) : 0;
  const diagonals: { d: Point3; off: number }[] = [];
  for (const sx of [1, -1])
    for (const sy of [1, -1]) {
      const d0 = unit({ x: sx * e.x, y: sy * e.y, z: e.z });
      if (!d0) continue;
      const across = unit(cross(p.n, d0)) ?? { x: 0, y: 0, z: 0 };
      const shrink = (k: "x" | "y" | "z"): number => Math.max(0, e[k] - width * Math.abs(across[k]) - depth * Math.abs(p.n[k]));
      const d = { x: sx * shrink("x"), y: sy * shrink("y"), z: shrink("z") };
      const ud = unit(d);
      if (ud && !diagonals.some((q) => Math.abs(Math.abs(dot(unit(q.d)!, ud)) - 1) < 1e-9)) diagonals.push({ d, off: Math.abs(dot(ud, p.n)) });
    }
  diagonals.sort((q, r) => q.off - r.off);
  const keep = diagonals.filter((q) => q.off <= diagonals[0].off + 0.05).slice(0, 2);
  return keep.map((q) => ({ begin: onPlane(along3(c, q.d, -0.5)), end: onPlane(along3(c, q.d, 0.5)) }));
}

/** Distance from a point to a line segment. */
function toSegment(p: Point3, l: Line3): number {
  const d = sub(l.end, l.begin);
  const dd = dot(d, d);
  const t = dd > 0 ? Math.max(0, Math.min(1, dot(sub(p, l.begin), d) / dd)) : 0;
  const q = along3(l.begin, d, t);
  return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
}

/** The GUIDs an object's first section lists (06 00 + GUID). */
function listedGuids(d: Uint8Array): string[] {
  const f = frameOf(d);
  if (!f) return [];
  const out: string[] = [];
  for (let p = f.at; p + 18 <= f.end; p++) if (d[p] === 6 && d[p + 1] === 0) out.push(hex(d, p + 2, 16));
  return out;
}

/** Where two frame axes meet: the midpoint of their lines' closest points within `tol` of both; for (nearly) parallel ones that continue each other, between their touching ends. */
function meet(a: Line3, b: Line3, tol: number): Point3 | null {
  const u = { x: a.end.x - a.begin.x, y: a.end.y - a.begin.y, z: a.end.z - a.begin.z };
  const v = { x: b.end.x - b.begin.x, y: b.end.y - b.begin.y, z: b.end.z - b.begin.z };
  const w = { x: a.begin.x - b.begin.x, y: a.begin.y - b.begin.y, z: a.begin.z - b.begin.z };
  const uu = dot(u, u);
  const uv = dot(u, v);
  const vv = dot(v, v);
  const uw = dot(u, w);
  const vw = dot(v, w);
  const den = uu * vv - uv * uv;
  if (uu < 1e-12 || vv < 1e-12) return null;
  if (den < 0.0025 * uu * vv) {
    // (nearly) parallel: a corner only where one continues the other, end to end
    let best: [Point3, Point3, Point3, Point3] | null = null;
    let bestGap = Infinity;
    for (const [pa, qa] of [[a.end, a.begin], [a.begin, a.end]] as const)
      for (const [pb, qb] of [[b.begin, b.end], [b.end, b.begin]] as const) {
        const g = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (g < bestGap) (bestGap = g), (best = [pa, qa, pb, qb]);
      }
    if (!best || bestGap > tol || dot(sub(best[0], best[1]), sub(best[3], best[2])) <= 0) return null;
    return { x: (best[0].x + best[2].x) / 2, y: (best[0].y + best[2].y) / 2, z: (best[0].z + best[2].z) / 2 };
  }
  const s = (uv * vw - vv * uw) / den;
  const t = (uu * vw - uv * uw) / den;
  const lu = Math.sqrt(uu);
  const lv = Math.sqrt(vv);
  if (s * lu < -tol || (s - 1) * lu > tol || t * lv < -tol || (t - 1) * lv > tol) return null;
  const p = { x: a.begin.x + s * u.x, y: a.begin.y + s * u.y, z: a.begin.z + s * u.z };
  const q = { x: b.begin.x + t * v.x, y: b.begin.y + t * v.y, z: b.begin.z + t * v.z };
  if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > tol) return null;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 };
}

/** Frames that continue one another on one line (a side split in several frames) joined into one. */
function joinCollinear(lines: readonly Line3[], tol: number): Line3[] {
  const out = [...lines];
  for (let joined = true; joined; ) {
    joined = false;
    for (let i = 0; i < out.length && !joined; i++)
      for (let j = i + 1; j < out.length && !joined; j++) {
        const a = out[i];
        const b = out[j];
        const u = sub(a.end, a.begin);
        const lu = Math.sqrt(dot(u, u));
        if (lu < 1e-9) continue;
        const e = { x: u.x / lu, y: u.y / lu, z: u.z / lu };
        // b's ends on a's line, and how far along it
        const off = (p: Point3): number => {
          const w = sub(p, a.begin);
          const t = dot(w, e);
          return Math.hypot(w.x - e.x * t, w.y - e.y * t, w.z - e.z * t);
        };
        if (off(b.begin) > 1e-3 || off(b.end) > 1e-3) continue;
        const tb0 = dot(sub(b.begin, a.begin), e);
        const tb1 = dot(sub(b.end, a.begin), e);
        if (Math.min(tb0, tb1) > lu + tol || Math.max(tb0, tb1) < -tol) continue;
        const t0 = Math.min(0, tb0, tb1);
        const t1 = Math.max(lu, tb0, tb1);
        const at = (t: number): Point3 => ({ x: a.begin.x + e.x * t, y: a.begin.y + e.y * t, z: a.begin.z + e.z * t });
        out[i] = { begin: at(t0), end: at(t1) };
        out.splice(j, 1);
        joined = true;
      }
  }
  return out;
}

/**
 * A panel's outline from the axes of the frames around it: frames on one line joined, corners
 * where two of them meet, walked frame to frame (each joins the two corners farthest apart on it).
 * Null when they don't close one loop.
 */
function panelPolygon(frameAxes: readonly Line3[], tol: number): Point3[] | null {
  const axes = joinCollinear(frameAxes, tol);
  const corners: Point3[] = [];
  const on: number[][] = axes.map(() => []);
  const near = (a: Point3, b: Point3): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-3;
  for (let i = 0; i < axes.length; i++)
    for (let j = i + 1; j < axes.length; j++) {
      const m = meet(axes[i], axes[j], tol);
      if (!m) continue;
      let k = corners.findIndex((c) => near(c, m));
      if (k < 0) k = corners.push(m) - 1;
      if (!on[i].includes(k)) on[i].push(k);
      if (!on[j].includes(k)) on[j].push(k);
    }
  // each frame is an edge between its two extreme corners
  const edges: [number, number][] = [];
  for (let i = 0; i < axes.length; i++) {
    if (on[i].length < 2) continue;
    const a = axes[i];
    const u = { x: a.end.x - a.begin.x, y: a.end.y - a.begin.y, z: a.end.z - a.begin.z };
    const t = (k: number): number => (corners[k].x - a.begin.x) * u.x + (corners[k].y - a.begin.y) * u.y + (corners[k].z - a.begin.z) * u.z;
    const sorted = [...on[i]].sort((p, q) => t(p) - t(q));
    edges.push([sorted[0], sorted[sorted.length - 1]]);
  }
  if (edges.length < 3) return null;
  const loop: number[] = [edges[0][0]];
  const used = new Set<number>([0]);
  let at = edges[0][1];
  while (at !== loop[0]) {
    loop.push(at);
    const next = edges.findIndex((e, i) => !used.has(i) && (e[0] === at || e[1] === at));
    if (next < 0 || loop.length > edges.length) return null;
    used.add(next);
    at = edges[next][0] === at ? edges[next][1] : edges[next][0];
  }
  return loop.length >= 3 ? loop.map((k) => corners[k]) : null;
}

function readCurtainWall(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>, problems: Record<string, number>): CurtainWall | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, false);
  if (!f || !start) return null;
  const h = headerAt(d, start.header, f.end, f.version, 1);
  if (!h) return null;
  const links = linksOf(d);
  const segments: CWSegment[] = [];
  for (const g of linked(links, LINK.cwSegments)) {
    const so = byGuid.get(g);
    const s = so ? readCWSegment(so) : null;
    if (s) segments.push(s);
    else bump(problems, CLASS.cwSegment);
  }
  const segmentBy = new Map(segments.map((s) => [s.guid, s]));
  // frames and what each panel lists (its frames and segments)
  const boxes = new Map<string, { o: ArchicadObject; box: FrameBox }>();
  for (const g of linked(links, LINK.cwFrames)) {
    const fo = byGuid.get(g);
    const box = fo ? frameBox(fo.data) : null;
    if (fo && box) boxes.set(g, { o: fo, box });
    else bump(problems, CLASS.cwFrame);
  }
  const panelLists: { g: string; o: ArchicadObject; listed: string[] }[] = [];
  for (const g of linked(links, LINK.cwPanels)) {
    const po = byGuid.get(g);
    if (po) panelLists.push({ g, o: po, listed: listedGuids(po.data) });
    else bump(problems, CLASS.cwPanel);
  }
  // a frame's segment: the one segment of a panel it bounds, else the nearest in plan
  const frameSegment = new Map<string, CWSegment>();
  for (const p of panelLists) {
    const segs = p.listed.filter((x) => segmentBy.has(x));
    if (segs.length !== 1) continue;
    for (const x of p.listed) if (boxes.has(x) && !frameSegment.has(x)) frameSegment.set(x, segmentBy.get(segs[0])!);
  }
  for (const [g, { box }] of boxes) {
    if (frameSegment.has(g)) continue;
    const s = nearestSegment(segments, { x: (box.bounds.min.x + box.bounds.max.x) / 2, y: (box.bounds.min.y + box.bounds.max.y) / 2 });
    if (s) frameSegment.set(g, s);
  }
  // each segment's frame plane, the frames' axes in it, sloped ones told apart by where their ends land
  const planes = new Map<string | null, Plane>();
  const planeOf = (s: CWSegment | undefined): Plane => {
    const key = s?.guid ?? null;
    let p = planes.get(key);
    if (!p) {
      const own = [...boxes].filter(([g]) => (frameSegment.get(g)?.guid ?? null) === key).map(([, b]) => b.box);
      planes.set(key, (p = framePlane(s ?? null, own)));
    }
    return p;
  };
  let size = 0;
  for (const { box } of boxes.values()) if (box.section) size = Math.max(size, box.section.width, Math.abs(box.section.depthTo - box.section.depthFrom));
  const tol = Math.max(0.02, size);
  const candidates = new Map<string, Line3[]>();
  for (const [g, { box }] of boxes) candidates.set(g, frameAxes(box, planeOf(frameSegment.get(g))));
  const straight = [...candidates].filter(([, c]) => c.length === 1).map(([g, c]) => ({ g, l: c[0] }));
  const axes = new Map<string, Line3>();
  for (const [g, c] of candidates) {
    if (c.length === 1) {
      axes.set(g, c[0]);
      continue;
    }
    const seg = frameSegment.get(g)?.guid;
    const near = straight.filter((x) => frameSegment.get(x.g)?.guid === seg);
    // the candidate whose ends land on other frames' ends (else on other frames)
    const gap = (q: Point3, r: Point3): number => Math.hypot(q.x - r.x, q.y - r.y, q.z - r.z);
    const score = (l: Line3, ends: boolean): number => {
      let a = Infinity;
      let b = Infinity;
      for (const x of near)
        if (ends) (a = Math.min(a, gap(l.begin, x.l.begin), gap(l.begin, x.l.end))), (b = Math.min(b, gap(l.end, x.l.begin), gap(l.end, x.l.end)));
        else (a = Math.min(a, toSegment(l.begin, x.l))), (b = Math.min(b, toSegment(l.end, x.l)));
      return a + b;
    };
    const e0 = score(c[0], true);
    const e1 = score(c[1], true);
    const pick = Math.abs(e0 - e1) > tol / 2 ? e0 < e1 : score(c[0], false) <= score(c[1], false);
    axes.set(g, pick ? c[0] : c[1]);
  }
  const frames: CWFrame[] = [];
  for (const [g, { o: fo, box }] of boxes)
    frames.push({
      guid: g,
      template: linked(linksOf(fo.data), LINK.frameTemplate, true)[0] ?? null,
      segment: frameSegment.get(g)?.guid ?? null,
      bounds: box.bounds,
      boundsOfBody: box.body,
      axis: axes.get(g)!,
      section: box.section,
    });
  const panels: CWPanel[] = panelLists.map(({ g, o: po, listed }) => {
    const around = listed.filter((x) => axes.has(x));
    return {
      guid: g,
      template: linked(linksOf(po.data), LINK.panelTemplate, true)[0] ?? null,
      frames: around,
      segments: listed.filter((x) => segmentBy.has(x)),
      polygon: panelPolygon(
        around.map((x) => axes.get(x)!),
        tol,
      ),
    };
  });
  return { guid: o.guid, story: h.story, layer: h.layer, id: h.id, floor: floorOf(links), segments, frames, panels };
}

// ---- stairs and railings -----------------------------------------------------------------------

/** Every object owned (01/11 links) from `root`, through objects of the given classes, by class. */
function partsOf(root: readonly Link[], byGuid: ReadonlyMap<string, ArchicadObject>, classes: ReadonlySet<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue: string[] = [];
  const push = (links: readonly Link[]): void => {
    for (const l of links) if (l.tag === 0x01 || l.tag === 0x11) for (const t of l.targets) if (!seen.has(t)) (seen.add(t), queue.push(t));
  };
  push(root);
  while (queue.length) {
    const g = queue.shift()!;
    const o = byGuid.get(g);
    if (!o) continue;
    const cls = hex(o.data, 0, 16);
    if (!classes.has(cls)) continue;
    let list = out.get(cls);
    if (!list) out.set(cls, (list = []));
    list.push(g);
    push(linksOf(o.data));
  }
  return out;
}

/** A point followed by a 3x3 rotation (|det| = 1, unit rows; with `plan`, a turn about z only), the first after `from`. */
function placementAfter(d: Uint8Array, from: number, to: number, plan = false): Placement | null {
  for (let p = from; p + 96 <= to; p++) {
    const v: number[] = [];
    for (let k = 0; k < 12; k++) v.push(f64(d, p + 8 * k));
    if (!finite(...v)) continue;
    const m = v.slice(3);
    const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (Math.abs(Math.abs(det) - 1) > 1e-6) continue;
    if ([0, 3, 6].some((r) => Math.abs(Math.hypot(m[r], m[r + 1], m[r + 2]) - 1) > 1e-6)) continue;
    if (plan && (Math.abs(m[8] - 1) > 1e-9 || Math.abs(m[2]) > 1e-9 || Math.abs(m[5]) > 1e-9)) continue;
    return { origin: { x: v[0], y: v[1], z: v[2] }, matrix: m };
  }
  return null;
}

const STAIR_PARTS: ReadonlySet<string> = new Set([CLASS.tread, CLASS.riser]);
const RAILING_PARTS: ReadonlySet<string> = new Set([
  CLASS.railingSegment,
  CLASS.railingPattern,
  CLASS.railingPost,
  CLASS.railingPanel,
  CLASS.innerPost,
  CLASS.baluster,
  CLASS.balusterSet,
  CLASS.toprail,
  CLASS.handrail,
  CLASS.rail,
]);

function stepLines(o: ArchicadObject | undefined): { a: Point2; b: Point2 }[] {
  const out: { a: Point2; b: Point2 }[] = [];
  if (!o) return out;
  const d = o.data;
  for (let p = 39; p + 36 <= d.length; p++) {
    if (d[p] !== 3 || d[p + 1] !== 0 || d[p + 2] !== 0x3d || d[p + 3] !== 0) continue;
    const v = [0, 1, 2, 3].map((k) => f64(d, p + 4 + 8 * k));
    if (!finite(...v) || (v[0] === v[2] && v[1] === v[3])) continue;
    out.push({ a: { x: v[0], y: v[1] }, b: { x: v[2], y: v[3] } });
    p += 35;
  }
  return out;
}

/** Step lines turned the same way (each line's a end on the side the previous line's a end was), by which pairing joins nearer. */
function alignSteps(lines: readonly { a: Point2; b: Point2 }[]): { a: Point2; b: Point2 }[] {
  const out: { a: Point2; b: Point2 }[] = [];
  const gap = (p: Point2, q: Point2): number => Math.hypot(p.x - q.x, p.y - q.y);
  for (const l of lines) {
    const prev = out[out.length - 1];
    out.push(prev && gap(prev.a, l.b) + gap(prev.b, l.a) < gap(prev.a, l.a) + gap(prev.b, l.b) ? { a: l.b, b: l.a } : l);
  }
  return out;
}

function readStair(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>): Stair | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, false);
  if (!f || !start) return null;
  const h = headerAt(d, start.header, f.end, f.version, 1);
  if (!h) return null;
  const links = linksOf(d);
  const parts = partsOf(links, byGuid, STAIR_PARTS);
  const scheme = linked(links, LINK.stairScheme)[0];
  const steps = alignSteps(stepLines(scheme ? byGuid.get(scheme) : undefined));
  return {
    guid: o.guid,
    story: h.story,
    layer: h.layer,
    id: h.id,
    floor: floorOf(links),
    topFloor: indirectFloor(links, LINK.stairTop, byGuid),
    treads: parts.get(CLASS.tread) ?? [],
    risers: parts.get(CLASS.riser) ?? [],
    stepLines: steps,
    outline: steps.length > 1 ? [...steps.map((l) => l.a), ...steps.map((l) => l.b).reverse()] : [],
    walkingLine: steps.map((l) => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 })),
    placement: placementAfter(d, h.end, f.end, true),
    symbols: [...linked(links, LINK.stairSymbol), ...linked(links, LINK.stairSymbol2)],
  };
}

/** A railing node's point; "attached" for a vertex that follows another element (it stores no point). */
function vertexOf(node: string, byGuid: ReadonlyMap<string, ArchicadObject>): Point3 | "attached" | null {
  const n = byGuid.get(node);
  const vg = n && linked(linksOf(n.data), LINK.nodeVertex)[0];
  const v = vg ? byGuid.get(vg) : undefined;
  if (v && hex(v.data, 0, 16) === CLASS.attachedVertex) return "attached";
  if (!v || hex(v.data, 0, 16) !== CLASS.railingVertex || v.data.length < 43) return null;
  const end = 39 + u32(v.data, 35);
  if (end - 24 < 39 || end > v.data.length) return null;
  const p = pt3(v.data, end - 24);
  return finite(p.x, p.y, p.z) ? p : null;
}

function readRailing(o: ArchicadObject, byGuid: ReadonlyMap<string, ArchicadObject>, problems: Record<string, number>): Railing | null {
  const d = o.data;
  const f = frameOf(d);
  const start = f && elementStart(d, f, false);
  if (!f || !start) return null;
  const h = headerAt(d, start.header, f.end, f.version, 1);
  if (!h) return null;
  const links = linksOf(d);
  let placement: Placement | null = null;
  if (h.end + 5 + 96 <= f.end && d[h.end + 1] === 1 && d[h.end + 3] === 4) placement = placementAfter(d, h.end + 5, h.end + 5 + 96);
  const nodes: (Point3 | null)[] = [];
  for (const g of [...linked(links, LINK.railingFirstNode), ...linked(links, LINK.railingNodes)]) {
    const v = vertexOf(g, byGuid);
    nodes.push(v === "attached" ? null : v);
    if (!v) bump(problems, CLASS.railingNode);
  }
  const parts = partsOf(links, byGuid, RAILING_PARTS);
  const named: Record<string, readonly string[]> = {};
  for (const [cls, list] of parts) if (cls !== CLASS.railingSegment) named[NAME[cls] ?? cls] = list;
  return {
    guid: o.guid,
    story: h.story,
    layer: h.layer,
    id: h.id,
    floor: floorOf(links),
    placement,
    nodes,
    segments: parts.get(CLASS.railingSegment) ?? [],
    parts: named,
  };
}

// ---- all ---------------------------------------------------------------------------------------

function bump(problems: Record<string, number>, cls: string): void {
  const name = NAME[cls] ?? cls;
  problems[name] = (problems[name] ?? 0) + 1;
}

/** Beams, columns, curtain walls, stairs and railings from a file's objects (see STRUCTURE_CLASSES). */
export function readStructure(objects: ObjectsByClass): Structure {
  const byGuid = new Map<string, ArchicadObject>();
  for (const cls of STRUCTURE_CLASSES) for (const o of objects.get(cls) ?? []) byGuid.set(o.guid, o);
  const problems: Record<string, number> = {};
  const each = <T>(cls: string, read: (o: ArchicadObject) => T | null): T[] => {
    const out: T[] = [];
    for (const o of objects.get(cls) ?? []) {
      let r: T | null = null;
      try {
        r = read(o);
      } catch {
        r = null;
      }
      if (r) out.push(r);
      else bump(problems, cls);
    }
    return out;
  };
  return {
    beams: each(CLASS.beam, (o) => readBeam(o, byGuid, problems)),
    columns: each(CLASS.column, (o) => readColumn(o, byGuid, problems)),
    curtainWalls: each(CLASS.curtainWall, (o) => readCurtainWall(o, byGuid, problems)),
    stairs: each(CLASS.stair, (o) => readStair(o, byGuid)),
    railings: each(CLASS.railing, (o) => readRailing(o, byGuid, problems)),
    problems,
  };
}

/** For checks: link reading, link types and class GUIDs. */
export const internals = { linksOf, linked, LINK, CLASS };
