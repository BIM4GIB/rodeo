// Archicad's library part elements (doors, windows, skylights, objects, lamps), the library parts
// they place, their GDL parameters, and the library packed into the file, read from the objects of
// an Archicad 25, 27 or 29 file (./objects.ts). Nothing here runs GDL: scripts are text to read.
//
// Element payloads. After the class GUID and the object header (OBJECT_DATA), each element class
// starts with a chain of u16 class versions whose low byte is the version and high byte 0, ending
// with one whose high byte is 1 (Door and Wind: 03 00, 08 00 or 07 00, 05 01; VBElem::Skylight:
// 03 00, 05 01; Symb: 07 00, 07 01; Light: 04 00, 07 01). A u32 byte size of the element block
// follows. The block opens with the element header: 01 00 01 00, then 09 00 83 00 (Archicad 29),
// 09 00 82 00 (27) or 07 00 04 00 82 00 (25), then 03 00 00 01, the class GUID again, a u16 count n
// and n u16 versions of the classes the element is built on. Archicad 29 then has a block of
// 0x62 + 4n bytes, almost all zero (a u32 0x62 at +0x10); 25 and 27 have nothing, so the common
// element data (F below) starts right after the versions. F is checked by its 01 00 at F+1 (a
// short scan finds it when the size rule fails). From F: a u8, then the layer as every attribute
// reference is stored (01 00, i32 attribute index), then fields that sit 10 bytes later in Archicad 25 than in 27 and 29 (s = 10 or 0 below).
// Every element block ends with its ID string (01 00, u32 count, UTF-16) and 9 more bytes; the
// payload ends with a u32 length and the list of references (01 00, then per entry a tag: 0x11 or
// 0x12 with a 16-byte reference type and one GUID, 0x01 or 0x02 with a type, a u32 count and that
// many GUIDs, 0 to end).
//
// Doors and windows (Door, Wind), from F + s: +0x17 u8 mirrored (the marker's AC_WIDO_MIRRORED),
// +0x18 u8 opening on the other side (AC_WIDO_REVEAL_SIDE), +0x19 u8 reference side
// (AC_WIDO_REVEAL_SIDE_2 is the XOR of the two), +0x1c f64 width (AC_WIDO_A_SIZE), +0x24 f64 height
// (AC_WIDO_B_SIZE), +0x6e the ID. After the block, 116 bytes (120 in Archicad 29), from its end B:
// +0x0c an i8 -1/0/1 (the anchor of the position: read raw), +0x0f f64 distance along the host wall
// from its begin point, +0x37 f64 sill height above the story (AC_SILL_TO_CURR_STORY), +0x3f f64
// reveal depth offset, +0x47, +0x4f, +0x57, +0x5f f64 jamb depths (head, sill, jamb, second jamb),
// +0x67 u8 reveal, +0x68 u16 where the reveal depth is measured from, +0x6a f64 reveal depth from
// that side. The width, height, mirror and side flags and the sill were matched against the
// AC_WIDO_* parameters of the opening markers (the Symb each opening links to) in every sample whose
// marker parts have them; the names of the jamb and reveal fields follow the order of Archicad's
// API window record and are inferred.
// Skylights (VBElem::Skylight) share the opening fields in the block (width, height, flags, ID);
// after it come 98 bytes: 10 bytes, then f64s: two local coordinates, the anchor point x, y in plan,
// two zeros, the anchor level, the azimuth angle, the elevation angle (the roof's pitch), one more
// and a zero. Hosts: a door or window refers to its wall, a skylight to its roof; every element refers to its
// story's EDB::Floor object.
// Objects and lamps (Symb, Light), from F + s: +0x21 u8 mirrored (checked against the 2D bounding
// box Archicad caches for each placed object), +0x22 u8 set on every lamp, +0x26 f64 x, +0x2e y,
// +0x36 rotation angle, +0x3e z above the story, +0x46 A and +0x4e B (the part's A and B
// parameters), +0x77 the ID. The height is the ZZYZX parameter. A lamp's switch, colour and
// intensity are not stored inline: they are its gs_light_switch, gs_color_red/green/blue (0..1) and
// gs_light_intensity parameters.
// Many Symb objects are not free objects: curtain wall panels and frames, stair and railing parts,
// opening markers and section segments are Symbs that refer to the element that owns them (see
// OWNER_LINKS); `owner` tells them apart.
//
// Library part identity. An element refers (by reference type) to a VBElem::LibPartReference:
// 01 00 8X 00 03 00 00 00 01 00 02 00, the part's main GUID and revision GUID (16 bytes each, as
// Windows GUIDs: u32, u16, u16 little-endian, then 8 bytes), its file name and its name (strings),
// the main and revision GUID of the subtype it is made from (the parent in its ancestry: door,
// window, skylight, lamp, general object…), the library's name, and references to its three GDL
// parameter lists. Some elements also refer to a VBElem::PersistentLibPartID (01 00 03 00 00 02 00,
// main GUID, revision GUID, file name, name). GUIDs of library parts are given in their text form
// (XXXXXXXX-XXXX-…) because that is how GDL and the library files name them.
//
// GDL parameter lists (VBElem::UserGDLParamList, CurrentGDLParamList, ProgramGDLParamList), the
// same in 25, 27 and 29: 01 00 08 00 8X 00 03 00 00 00 01 00 01 00, a u32 block size, then the
// block (B): u32 count, u32, 8 zero bytes, count 72-byte records, then a data area whose offsets are
// from B. A record: u16 type, u8 array, u8 flags, u32 first and u32 second array size (0 for one
// dimension), u8, 3 bytes, 8 bytes of value (f64 for length, angle, real and colour, i32 in the low
// half for the others), the name (32 bytes ASCII, NUL padded), u32 data offset, u32 data length, u32
// length of extra data at the end of the data, u32 0. A string's value is NUL-ended UTF-16 in the
// data area; another scalar's data, when there is any, is a NUL-ended UTF-16 display text. An
// array's values start the data area, row by row: f64 for length, angle, real and colour, i32 for
// the others (padded to 8 bytes), strings one after another, NUL-ended. Descriptions are not kept
// here (they are in the library part). The Current list holds every parameter with the values in
// effect; the User list is usually the same; the Program list is a subset Archicad sets. Lists are
// shared between references with the same values.
//
// The packed library. A header per file refers to its DatabaseLibraryContainerLibPartContent and
// its DatabaseLibraryContainerFolder: DatabaseLibraryContainerSymbolHeader (01 00 01 00 01 00 03 00
// 00, the file name) for GDL files (.gsm parts and .gdl macros), DatabaseLibraryContainerLibPartHeader
// (01 00 01 00 03 00 00, the file name) for the others (images, text, lists…). The content (01 00 03 00 00,
// file name, MIME type: model/vnd.gs-gdl for library parts, image types for textures, gs/list…,
// u32 0, a 4-letter tag, two 8-byte time stamps, u32 0, u32 file size, the file) is large: it is not
// in LIBPART_CLASSES; pass LIBPART_CONTENT_CLASS too to read it. LM::EmbeddedLibItem is the
// project's embedded library: 03 00 01 00 8X 00 03 00 00 00, u32 0x420, u32 0x421, 01 01 u32, 01 02
// u32, u32 depth, then per level from the library's root 02 01, u32 and a name (the item's own
// last), u32 0, u32 1 for a file (0 for a folder), then for a file u8, u32 time (Unix seconds), u32
// size and the file. A folder lists its items by reference.
// A library part file (.gsm) starts "WW" ("mm" in some older parts) and a u16 format version (0x19,
// 0x26, 0x28 and 0x2b seen), laid out the same in all: +0x24 u32 section count, +0x28 a 4-letter signature,
// +0x30 an entry "DAEH" (u32 offset 0x80, u32 length of the directory), +0x48 main GUID, +0x58
// revision GUID, +0x80 the directory: per section a 4-letter name stored reversed, u32 offset and
// u32 length from the file start. A section starts with its name, "WW", u16 version, u32 length and
// u32 0. Scripts (1DSC master, 2DSC, 3DSC, PRSC parameter, UISC interface, VLSC values,
// FMSC/BMSC migration) are UTF-8 text; ANCS holds the ancestry (u32 count at +0x14, then from +0x30
// pairs of main and revision GUIDs, root first); PARD, the parameter defaults, is not read here.

import { type ArchicadObject, type ObjectsByClass, Cursor, f64, hex, i32, OBJECT_DATA, u16, u32, utf16At } from "./objects.ts";

const CLASS = {
  door: "8976f0d8fa9cbe4faeb40a60b8e667ee",
  window: "a061f1934e4cf74da1004fd0e8c4f1e1",
  skylight: "6ef0a954293e304888803cf85eb0ad27",
  symb: "c3ceefdbbf1b6748b8b3c4f7c859df61",
  light: "558b2a3448736a48850b1eb1bed031fc",
  reference: "3da3fc2b38bde349bf6d52ac8b850b9f",
  persistent: "be1d4f9e62936f459b2f6abb72028bbc",
  userParams: "7d22db11e4dbaf4588b66fddea993f71",
  currentParams: "cde72b806ce1004bbcc54bdc0d287cc6",
  programParams: "14321661fac7a841bbe6817da0323144",
  header: "3f36a8a2aa0de249a404070b263ff699",
  symbolHeader: "5db0c05c1ca1624db29da3897814a203",
  embedded: "93a4ef5691439649a0561f18c2e4efdf",
  content: "2cf8aa6f31c18b4fb1d99706144935dd",
} as const;

const CLASS_NAME: Readonly<Record<string, string>> = {
  [CLASS.door]: "Door",
  [CLASS.window]: "Wind",
  [CLASS.skylight]: "VBElem::Skylight",
  [CLASS.symb]: "Symb",
  [CLASS.light]: "Light",
  [CLASS.reference]: "VBElem::LibPartReference",
  [CLASS.persistent]: "VBElem::PersistentLibPartID",
  [CLASS.userParams]: "VBElem::UserGDLParamList",
  [CLASS.currentParams]: "VBElem::CurrentGDLParamList",
  [CLASS.programParams]: "VBElem::ProgramGDLParamList",
  [CLASS.header]: "DatabaseLibraryContainerLibPartHeader",
  [CLASS.symbolHeader]: "DatabaseLibraryContainerSymbolHeader",
  [CLASS.embedded]: "LM::EmbeddedLibItem",
  [CLASS.content]: "DatabaseLibraryContainerLibPartContent",
};

/** The classes readLibParts reads (all but the packed library's file contents, which are large). */
export const LIBPART_CLASSES: ReadonlySet<string> = new Set(Object.values(CLASS).filter((c) => c !== CLASS.content));
/** DatabaseLibraryContainerLibPartContent: the packed library's files; add it to read them (readLibraryFiles). */
export const LIBPART_CONTENT_CLASS = CLASS.content;

/** Reference types (hex as stored) in the references at the end of a payload. */
const LINK = {
  doorWall: "02fe6b1f0cd6ae409ac8c3953ce12814",
  windowWall: "e67943c5d0af9a4b9887af5baeeccf84",
  skylightRoof: "57ad135b9577b5429762c3037113fa83",
  openingStory: "fa4c2e430499ca45a76b1b944ffc4041",
  skylightStory: "9328e0696afc5043afee158ef7726ebe",
  objectStory: "0312b67984ae884da9c620ead705e0bc",
  openingPart: "461c2f67f364f5418a4affdfd86bcbfd",
  objectPart: "3e459f182eea384eafe9660d1d25afc6",
  persistent: "e44ada3087be67429b0403bf07898ee3",
  marker: "f9c22af4fbbebe4789c9595aacc3089d",
  group: "80b955a819fd60458bc17a2b82c4f5aa",
  database: "0b279bbd4703cf4d92cfd2d872117ba1",
  userParams: "a4f0eb76efc23f48a1a828d3adde99a0",
  currentParams: "588778494a52594789accec113bc37f1",
  programParams: "1c08998a590f7a45854e7200720c14e1",
  headerContent: "efc2d99a176b014e884fdd0e18593724",
  headerFolder: "7321ff8ec53d944c8deaca68fe12b2dd",
} as const;

/** References from a Symb to the element that generated it, by reference type. */
const OWNER_LINKS: Readonly<Record<string, string>> = {
  [LINK.marker]: "opening",
  d4f1c2304cec4c439e65ef83c3648eac: "curtain wall panel",
  a5ec7f132c5849419afbbf7d41c705ac: "curtain wall panel",
  ea790f301310b843b81808c210849f4b: "curtain wall frame",
  b438d6f28a589a41a4f0e0d80b902934: "curtain wall frame",
  "8c952a6fcc8cf14c875e25cd40b50c41": "curtain wall",
  "755c6bb58e2e5649b6db2bcc6f77cde0": "curtain wall",
  d687a74b54d83c4ea1fed9d126721bb7: "stair part",
  "382c50615e11ba488491fbccad008f5d": "stair",
  d1d250935c71fa4284e2faa5862a710e: "stair",
  "4b92923679225144be33e45556f0b7a3": "railing panel",
  "388df0f4a1986342a9d09e8bf80cd91d": "railing panel",
  b4b779ec7025184c98b18142f82bde35: "rail",
  "9d1b6a9a10ec164c80a9ee204a5a35ac": "railing post",
  b100982d1d59ab488ecd9c721cf7d68b: "railing post",
  "762bb3615c98fe41a29e2d7e4acb7e72": "rail end",
  b3336e2662792448a423a8b5eeea383c: "railing connection",
  "9d87050b26672842b0f15d64f44cc2e3": "railing finish",
  "08799140ae67de469b7e3dbb4530d8d8": "section segment",
  eb2cb2861038e84b94ee1d81e01a033a: "section segment",
  d610890faccaec4c8cf7b20a99484b5b: "section segment",
  "2fa5063e46a91c49b752b2aae53c321e": "section segment",
};

/** Archicad's built-in library part subtypes (main GUIDs), the same in every library. */
export const SUBTYPE = {
  modelElement: "103E8D2C-8230-42E1-9597-46F84CCE28C0",
  generalObject: "F938E33A-329D-4A36-BE3E-85E126820996",
  door: "11E85B84-8DD1-491B-A2FE-337454A91545",
  window: "4ABD0A6E-634B-4931-B3AA-9BEE01F35CDF",
  skylight: "5921D56A-82F2-4253-BD84-6091E5717DC4",
  lamp: "51A838E5-0F40-4F6D-A658-CF2845581749",
} as const;

// ---- types ----------------------------------------------------------------------------------------

export type GdlParamType =
  | "integer"
  | "length"
  | "angle"
  | "real"
  | "lightSwitch"
  | "colorRGB"
  | "intensity"
  | "lineType"
  | "material"
  | "fillPattern"
  | "penColor"
  | "string"
  | "boolean"
  | "separator"
  | "title"
  | "buildingMaterial"
  | "profile"
  | "dictionary"
  | "unknown";

const PARAM_TYPES: readonly GdlParamType[] = [
  "integer",
  "unknown",
  "length",
  "angle",
  "real",
  "lightSwitch",
  "colorRGB",
  "intensity",
  "lineType",
  "material",
  "fillPattern",
  "penColor",
  "string",
  "boolean",
  "separator",
  "title",
  "buildingMaterial",
  "profile",
  "dictionary",
];
/** Types whose values are f64; the others (but strings) are i32. */
const REAL_TYPES = new Set([2, 3, 4, 6]);

export type GdlValue = number | string | boolean | null | readonly number[] | readonly string[] | readonly boolean[];

/** One GDL parameter. Arrays are flat, row by row; `dims` is [rows, columns] (columns 0 for one dimension). */
export interface GdlParam {
  readonly name: string;
  readonly type: GdlParamType;
  /** the type as stored */
  readonly code: number;
  readonly value: GdlValue;
  readonly dims: readonly [number, number] | null;
  /** flags as stored (not interpreted) */
  readonly flags: number;
  /** a scalar's display text, when one is stored */
  readonly text?: string;
}

export type LibPartKind = "door" | "window" | "skylight" | "lamp" | "object" | "other";

/** The library part an element places, from its VBElem::LibPartReference. */
export interface LibPartUse {
  /** the VBElem::LibPartReference object */
  readonly reference: string;
  readonly fileName: string;
  readonly name: string;
  readonly mainGuid: string;
  readonly revisionGuid: string;
  /** main GUID of the subtype it is made from */
  readonly subtype: string;
  readonly library: string;
  /** the parameter list objects (VBElem::User/Current/ProgramGDLParamList) */
  readonly userParams: string | null;
  readonly currentParams: string | null;
  readonly programParams: string | null;
}

interface Placed {
  readonly guid: string;
  /** its story: the EDB::Floor object's GUID (readAttributes' stories[].guid; its database too) */
  readonly floor: string | null;
  /** layer attribute index (stored 01 00, i32) */
  readonly layer: number;
  readonly id: string;
  readonly libPart: LibPartUse | null;
  /** the Current parameter list (the User list when there is no Current one) */
  readonly params: readonly GdlParam[];
  /** the group it is in */
  readonly group: string | null;
  /** the database object it is drawn in (VBES::FloorPlan, a section, a layout…) */
  readonly database: string | null;
}

/** A door or window in a wall. Distances in metres along the wall from its begin point, heights above the story. */
export interface WallOpening extends Placed {
  /** the Wall it is in */
  readonly wall: string | null;
  readonly width: number;
  readonly height: number;
  readonly along: number;
  readonly sill: number;
  readonly head: number;
  readonly mirrored: boolean;
  /** opened to the wall's other side (AC_WIDO_REVEAL_SIDE) */
  readonly otherSide: boolean;
  readonly refSide: boolean;
  /** -1, 0 or 1 as stored (which point of the opening `along` places) */
  readonly anchor: number;
  readonly reveal: boolean;
  readonly revealDepthFromSide: number;
  readonly revealDepthOffset: number;
  readonly jambDepthHead: number;
  readonly jambDepthSill: number;
  readonly jambDepth: number;
  readonly jambDepth2: number;
  /** the opening's marker (a Symb) */
  readonly marker: string | null;
}

export interface Skylight extends Placed {
  /** the Roof it is in */
  readonly roof: string | null;
  readonly width: number;
  readonly height: number;
  readonly mirrored: boolean;
  readonly otherSide: boolean;
  /** anchor point in plan */
  readonly position: { readonly x: number; readonly y: number };
  readonly level: number;
  readonly azimuth: number;
  /** the roof's pitch there */
  readonly pitch: number;
}

/** A placed object. z is above its story; A and B are its plan size; height is ZZYZX when the part has it. */
export interface PlacedObject extends Placed {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly angle: number;
  readonly mirrored: boolean;
  readonly a: number;
  readonly b: number;
  readonly height: number | null;
  /** the element that generated it (curtain wall, stair, railing, opening marker…) */
  readonly owner: { readonly kind: string; readonly guid: string } | null;
}

export interface Lamp extends PlacedObject {
  readonly on: boolean;
  readonly color: { readonly r: number; readonly g: number; readonly b: number } | null;
  readonly intensity: number | null;
}

/** A library part known to the file: from the elements' references, the packed library and the embedded library. */
export interface LibraryPart {
  readonly fileName: string;
  readonly name: string | null;
  readonly mainGuid: string | null;
  readonly revisionGuid: string | null;
  readonly subtype: string | null;
  readonly kind: LibPartKind;
  readonly library: string | null;
  /** its DatabaseLibraryContainerSymbolHeader (packed library) */
  readonly header: string | null;
  /** its DatabaseLibraryContainerLibPartContent */
  readonly content: string | null;
  /** its LM::EmbeddedLibItem (embedded library) */
  readonly embedded: string | null;
  /** how many elements place it */
  readonly uses: number;
}

export interface LibParts {
  readonly doors: readonly WallOpening[];
  readonly windows: readonly WallOpening[];
  readonly skylights: readonly Skylight[];
  readonly objects: readonly PlacedObject[];
  readonly lamps: readonly Lamp[];
  readonly libraryParts: readonly LibraryPart[];
  readonly problems: Record<string, number>;
}

// ---- small readers ----------------------------------------------------------------------------------

/** A 16-byte GUID as Windows writes it: u32, u16, u16 little-endian, then 8 bytes. */
export function guidText(d: Uint8Array, o: number): string {
  const h = (a: number, n: number): string => hex(d, a, n);
  const rev = (a: number, n: number): string => {
    let s = "";
    for (let i = a + n - 1; i >= a; i--) s += d[i].toString(16).padStart(2, "0");
    return s;
  };
  return `${rev(o, 4)}-${rev(o + 4, 2)}-${rev(o + 6, 2)}-${h(o + 8, 2)}-${h(o + 10, 6)}`.toUpperCase();
}

interface LinkEntry {
  readonly tag: number;
  readonly key: string;
  readonly refs: readonly string[];
}

interface Links {
  /** where the u32 length before the references is */
  readonly at: number;
  readonly entries: readonly LinkEntry[];
}

function parseLinks(d: Uint8Array, p: number): LinkEntry[] | null {
  const out: LinkEntry[] = [];
  while (p < d.length) {
    const tag = d[p];
    if (tag === 0) return p + 1 === d.length ? out : null;
    if (p + 17 > d.length) return null;
    const key = hex(d, p + 1, 16);
    if (tag === 0x11 || tag === 0x12) {
      if (p + 33 > d.length) return null;
      out.push({ tag, key, refs: [hex(d, p + 17, 16)] });
      p += 33;
    } else if (tag === 0x01 || tag === 0x02) {
      if (p + 21 > d.length) return null;
      const n = u32(d, p + 17);
      if (p + 21 + 16 * n > d.length) return null;
      const refs: string[] = [];
      for (let i = 0; i < n; i++) refs.push(hex(d, p + 21 + 16 * i, 16));
      out.push({ tag, key, refs });
      p += 21 + 16 * n;
    } else return null;
  }
  return null;
}

/** The references at the end of a payload: found from the end, where a u32 length and 01 00 lead to a list that ends the payload exactly. */
function linksOf(d: Uint8Array): Links | null {
  for (let p = d.length - 7; p >= OBJECT_DATA; p--) {
    if (d[p + 4] !== 1 || d[p + 5] !== 0 || u32(d, p) + p + 4 !== d.length) continue;
    const entries = parseLinks(d, p + 6);
    if (entries) return { at: p, entries };
  }
  return null;
}

function one(l: Links, key: string): string | null {
  for (const e of l.entries) if (e.key === key && e.refs.length > 0) return e.refs[0];
  return null;
}

/** The common frame of an element payload: its version, F, the Archicad 25 shift, the block's end and the references. */
interface Frame {
  readonly version: 25 | 27 | 29;
  readonly f: number;
  readonly s: number;
  readonly blockEnd: number;
  readonly links: Links;
}

function frameOf(d: Uint8Array): Frame {
  let p = OBJECT_DATA;
  for (let i = 0; ; i++) {
    if (i >= 8 || p + 2 > d.length) throw new Error("no class version chain");
    const hi = d[p + 1];
    p += 2;
    if (hi === 1) break;
    if (hi !== 0) throw new Error("no class version chain");
  }
  const blockEnd = p + 4 + u32(d, p);
  if (blockEnd > d.length) throw new Error("element block runs past the object");
  const c = new Cursor(d, p + 4);
  if (c.u16() !== 1 || c.u16() !== 1) throw new Error("no element header");
  let version: 25 | 27 | 29;
  const v = c.u16();
  if (v === 9) {
    const w = c.u16();
    if (w === 0x83) version = 29;
    else if (w === 0x82) version = 27;
    else throw new Error("unknown element header");
  } else if (v === 7) {
    if (c.u16() !== 4 || c.u16() !== 0x82) throw new Error("unknown element header");
    version = 25;
  } else throw new Error("unknown element header");
  c.skip(4);
  if (hex(d, c.at, 16) !== hex(d, 0, 16)) throw new Error("no class GUID in the element header");
  c.skip(16);
  const n = c.u16();
  c.skip(2 * n);
  const e = c.at;
  let f = version === 29 ? e + 0x62 + 4 * n : e;
  if (d[f + 1] !== 1 || d[f + 2] !== 0) {
    f = -1;
    for (let k = e; k < e + 0x100 && k + 3 < blockEnd; k++)
      if (d[k + 1] === 1 && d[k + 2] === 0) {
        f = k;
        break;
      }
    if (f < 0) throw new Error("no element data");
  }
  const links = linksOf(d);
  if (!links || links.at < blockEnd) throw new Error("no references");
  return { version, f, s: version === 25 ? 10 : 0, blockEnd, links };
}

/** The ID string at `o`, which must end 9 bytes before the block does. */
function idAt(d: Uint8Array, o: number, blockEnd: number): string {
  const id = utf16At(d, o);
  if (!id || id.end + 9 !== blockEnd) throw new Error("no ID where expected");
  return id.text;
}

function finite(...v: number[]): void {
  for (const x of v) if (!Number.isFinite(x)) throw new Error("a number is not finite");
}

// ---- GDL parameter lists ----------------------------------------------------------------------------

/** NUL-ended UTF-16 at `o`, no further than `end`; and where the next one starts. */
function cstr16(d: Uint8Array, o: number, end: number): { text: string; next: number } {
  let text = "";
  let p = o;
  for (; p + 1 < end; p += 2) {
    const c = u16(d, p);
    if (c === 0) return { text, next: p + 2 };
    text += String.fromCharCode(c);
  }
  return { text, next: end };
}

/** The parameters of a VBElem::User/Current/ProgramGDLParamList payload, in their order. */
export function readGdlParams(d: Uint8Array): GdlParam[] {
  if (u16(d, OBJECT_DATA) !== 1 || OBJECT_DATA + 18 + 4 > d.length) throw new Error("not a parameter list");
  const B = OBJECT_DATA + 18;
  if (B + u32(d, B - 4) > d.length) throw new Error("parameter list runs past the object");
  const n = u32(d, B);
  if (B + 16 + 72 * n > d.length) throw new Error("parameter records run past the object");
  const out: GdlParam[] = [];
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  for (let k = 0; k < n; k++) {
    const r = B + 16 + 72 * k;
    const code = u16(d, r);
    const isArray = d[r + 2] !== 0;
    const flags = d[r + 3];
    let name = "";
    for (let i = r + 0x18; i < r + 0x38 && d[i] !== 0; i++) name += String.fromCharCode(d[i]);
    const off = B + u32(d, r + 0x38);
    const len = u32(d, r + 0x3c);
    const end = off + len;
    if (len > 0 && end > d.length) throw new Error("parameter data runs past the object");
    const type = PARAM_TYPES[code] ?? "unknown";
    const real = REAL_TYPES.has(code);
    if (isArray) {
      const d1 = u32(d, r + 4);
      const d2 = u32(d, r + 8);
      const count = d1 * Math.max(d2, 1);
      let value: GdlValue;
      if (code === 12) {
        const list: string[] = [];
        let p = off;
        for (let i = 0; i < count && p < end; i++) {
          const s = cstr16(d, p, end);
          list.push(s.text);
          p = s.next;
        }
        value = list;
      } else {
        if (off + count * (real ? 8 : 4) > end) throw new Error("parameter array runs past its data");
        const nums: number[] = [];
        for (let i = 0; i < count; i++) nums.push(real ? dv.getFloat64(off + 8 * i, true) : dv.getInt32(off + 4 * i, true));
        value = code === 13 ? nums.map((x) => x !== 0) : nums;
      }
      out.push({ name, type, code, value, dims: [d1, d2], flags });
      continue;
    }
    let value: GdlValue;
    let text: string | undefined;
    if (code === 12) value = len > 0 ? cstr16(d, off, end).text : "";
    else {
      if (code === 14 || code === 15) value = null;
      else if (real) value = dv.getFloat64(r + 0x10, true);
      else if (code === 13) value = dv.getInt32(r + 0x10, true) !== 0;
      else value = dv.getInt32(r + 0x10, true);
      if (len > 0) {
        const t = cstr16(d, off, end).text;
        if (t) text = t;
      }
    }
    out.push(text === undefined ? { name, type, code, value, dims: null, flags } : { name, type, code, value, dims: null, flags, text });
  }
  return out;
}

function param(list: readonly GdlParam[], name: string): GdlParam | undefined {
  const lower = name.toLowerCase();
  return list.find((p) => p.name.toLowerCase() === lower);
}

function numberParam(list: readonly GdlParam[], name: string): number | null {
  const p = param(list, name);
  return p && typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null;
}

// ---- library part references --------------------------------------------------------------------------

/** What a VBElem::LibPartReference holds (GUIDs in text form). */
export interface LibPartReference {
  readonly fileName: string;
  readonly name: string;
  readonly mainGuid: string;
  readonly revisionGuid: string;
  readonly subtype: string;
  readonly library: string;
}

/** Reads a VBElem::LibPartReference payload; throws when it isn't one. */
export function readLibPartReference(d: Uint8Array): LibPartReference {
  return referenceOf(d);
}

function referenceOf(d: Uint8Array): LibPartReference & { readonly links: Links } {
  const c = new Cursor(d, OBJECT_DATA);
  if (c.u16() !== 1) throw new Error("not a library part reference");
  c.skip(10);
  const main = c.at;
  c.skip(32);
  const fileName = c.utf16();
  const name = c.utf16();
  const subtype = c.at;
  c.skip(32);
  const library = c.utf16();
  const links = linksOf(d);
  if (!links || links.at < c.at) throw new Error("no references");
  return { fileName, name, mainGuid: guidText(d, main), revisionGuid: guidText(d, main + 16), subtype: guidText(d, subtype), library, links };
}

// ---- library part files ---------------------------------------------------------------------------------

export interface GsmSection {
  /** the 4-letter name read forwards ("2DSC", "ANCS"…) */
  readonly name: string;
  readonly offset: number;
  readonly length: number;
}

export interface GsmFile {
  /** the format version (the u16 after "WW" or "mm") */
  readonly version: number;
  /** the 4-letter signature as stored */
  readonly signature: string;
  readonly mainGuid: string;
  readonly revisionGuid: string;
  readonly sections: readonly GsmSection[];
  /** main GUIDs of its ancestry, root first (the part's own last when listed) */
  readonly ancestry: readonly string[];
}

const ascii = (d: Uint8Array, o: number, n: number): string => String.fromCharCode(...d.subarray(o, o + n));

/** Reads a library part file (.gsm) laid out from the start of `file`; null when it isn't one. */
export function readGsm(file: Uint8Array): GsmFile | null {
  const magic = ascii(file, 0, 2);
  if (file.length < 0x80 || (magic !== "WW" && magic !== "mm") || ascii(file, 0x30, 4) !== "DAEH") return null;
  const count = u32(file, 0x24);
  const dir = u32(file, 0x34);
  if (dir + 16 * count > file.length) return null;
  const sections: GsmSection[] = [];
  for (let i = 0; i < count; i++) {
    const q = dir + 16 * i;
    const offset = u32(file, q + 4);
    const length = u32(file, q + 8);
    if (offset + length > file.length) return null;
    sections.push({ name: ascii(file, q, 4).split("").reverse().join(""), offset, length });
  }
  const ancestry: string[] = [];
  const ancs = sections.find((s) => s.name === "ANCS");
  if (ancs && ancs.length >= 0x30) {
    const n = u32(file, ancs.offset + 0x14);
    if (0x30 + 32 * n <= ancs.length) for (let i = 0; i < n; i++) ancestry.push(guidText(file, ancs.offset + 0x30 + 32 * i));
  }
  return { version: u16(file, 2), signature: ascii(file, 0x28, 4), mainGuid: guidText(file, 0x48), revisionGuid: guidText(file, 0x58), sections, ancestry };
}

/** A script section's text (UTF-8), e.g. gsmScript(file, gsm, "2DSC"); null when the part has none. */
export function gsmScript(file: Uint8Array, gsm: GsmFile, name: string): string | null {
  const s = gsm.sections.find((x) => x.name === name);
  if (!s || s.length < 16) return null;
  let from = s.offset + 16;
  if (file[from] === 0xef && file[from + 1] === 0xbb && file[from + 2] === 0xbf) from += 3;
  return new TextDecoder().decode(file.subarray(from, s.offset + s.length));
}

/** A file of the packed library (DatabaseLibraryContainerLibPartContent). */
export interface LibraryFile {
  readonly guid: string;
  readonly fileName: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  /** set for library parts */
  readonly gsm: GsmFile | null;
}

function readContent(o: ArchicadObject): LibraryFile {
  const d = o.data;
  const c = new Cursor(d, OBJECT_DATA);
  if (c.u16() !== 1) throw new Error("not a library file");
  c.skip(3);
  const fileName = c.utf16();
  const mime = c.utf16();
  c.skip(4 + 4 + 16 + 4);
  const size = c.u32();
  if (c.at + size > d.length) throw new Error("library file runs past the object");
  const bytes = d.subarray(c.at, c.at + size);
  return { guid: o.guid, fileName, mime, bytes, gsm: readGsm(bytes) };
}

/** The packed library's files, from DatabaseLibraryContainerLibPartContent objects (LIBPART_CONTENT_CLASS). */
export function readLibraryFiles(objects: ObjectsByClass): { files: LibraryFile[]; problems: Record<string, number> } {
  const files: LibraryFile[] = [];
  const problems: Record<string, number> = {};
  for (const o of objects.get(CLASS.content) ?? []) {
    try {
      files.push(readContent(o));
    } catch {
      problems[CLASS_NAME[CLASS.content]] = (problems[CLASS_NAME[CLASS.content]] ?? 0) + 1;
    }
  }
  return { files, problems };
}

/** A file of the packed library as its header lists it; `content` is its DatabaseLibraryContainerLibPartContent object. */
export interface LibraryHeader {
  readonly header: string;
  readonly fileName: string;
  /** a GDL file (.gsm part or .gdl macro) rather than an image, text or list */
  readonly gdl: boolean;
  readonly content: string | null;
  readonly folder: string | null;
}

/** The packed library's file list, from its headers (small; the files themselves are LIBPART_CONTENT_CLASS objects). */
export function readLibraryHeaders(objects: ObjectsByClass): { headers: LibraryHeader[]; problems: Record<string, number> } {
  const headers: LibraryHeader[] = [];
  const problems: Record<string, number> = {};
  for (const [cls, gdl] of [
    [CLASS.symbolHeader, true],
    [CLASS.header, false],
  ] as const) {
    for (const o of objects.get(cls) ?? []) {
      try {
        const c = new Cursor(o.data, OBJECT_DATA);
        if (c.u16() !== 1 || c.u16() !== 1) throw new Error("not a library file header");
        if (gdl && c.u16() !== 1) throw new Error("not a library file header");
        if (c.u16() !== 3 || c.u8() !== 0) throw new Error("not a library file header");
        const fileName = c.utf16();
        const links = linksOf(o.data);
        if (!links || links.at < c.at) throw new Error("no references");
        headers.push({ header: o.guid, fileName, gdl, content: one(links, LINK.headerContent), folder: one(links, LINK.headerFolder) });
      } catch {
        problems[CLASS_NAME[cls]] = (problems[CLASS_NAME[cls]] ?? 0) + 1;
      }
    }
  }
  return { headers, problems };
}

/** A file of the embedded library (LM::EmbeddedLibItem); folders have no bytes. */
interface EmbeddedItem {
  /** folder names from the library's root, the item's own name last */
  readonly path: readonly string[];
  readonly bytes: Uint8Array | null;
}

function readEmbedded(d: Uint8Array): EmbeddedItem {
  const c = new Cursor(d, OBJECT_DATA);
  if (c.u16() !== 3) throw new Error("not an embedded library item");
  c.skip(2 + 2 + 4 + 4 + 4);
  if (c.u16() !== 0x0101) throw new Error("not an embedded library item");
  c.skip(4);
  if (c.u16() !== 0x0201) throw new Error("not an embedded library item");
  c.skip(4);
  const depth = c.u32();
  if (depth < 1 || depth > 64) throw new Error("not an embedded library item");
  const path: string[] = [];
  for (let i = 0; i < depth; i++) {
    if (c.u16() !== 0x0102) throw new Error("not an embedded library item");
    c.skip(4);
    path.push(c.utf16());
  }
  c.skip(4);
  const isFile = c.u32();
  if (isFile === 0) return { path, bytes: null };
  c.skip(1 + 4);
  const size = c.u32();
  if (c.at + size > d.length) throw new Error("embedded file runs past the object");
  return { path, bytes: d.subarray(c.at, c.at + size) };
}

function kindOf(guids: readonly string[]): LibPartKind | null {
  if (guids.includes(SUBTYPE.door)) return "door";
  if (guids.includes(SUBTYPE.window)) return "window";
  if (guids.includes(SUBTYPE.skylight)) return "skylight";
  if (guids.includes(SUBTYPE.lamp)) return "lamp";
  if (guids.includes(SUBTYPE.generalObject)) return "object";
  return null;
}

// ---- the elements -----------------------------------------------------------------------------------------

/** Reads the library part elements, the parts they place with their parameters, and the library catalogue. */
export function readLibParts(objects: ObjectsByClass): LibParts {
  const problems: Record<string, number> = {};
  const fail = (cls: string): void => {
    const name = CLASS_NAME[cls] ?? cls;
    problems[name] = (problems[name] ?? 0) + 1;
  };
  const byGuid = (cls: string): Map<string, ArchicadObject> => new Map((objects.get(cls) ?? []).map((o) => [o.guid, o]));

  // parameter lists and references, read when an element needs them, each once
  const lists = new Map<string, readonly GdlParam[] | null>();
  const listObjects = [CLASS.currentParams, CLASS.userParams, CLASS.programParams].map((cls) => ({ cls, objs: byGuid(cls) }));
  const listOf = (guid: string | null): readonly GdlParam[] | null => {
    if (!guid) return null;
    if (lists.has(guid)) return lists.get(guid) ?? null;
    let got: readonly GdlParam[] | null = null;
    for (const { cls, objs } of listObjects) {
      const o = objs.get(guid);
      if (!o) continue;
      try {
        got = readGdlParams(o.data);
      } catch {
        fail(cls);
      }
      break;
    }
    lists.set(guid, got);
    return got;
  };
  const referenceObjects = byGuid(CLASS.reference);
  const uses = new Map<string, LibPartUse | null>();
  const useOf = (guid: string | null): LibPartUse | null => {
    if (!guid) return null;
    if (uses.has(guid)) return uses.get(guid) ?? null;
    let use: LibPartUse | null = null;
    const o = referenceObjects.get(guid);
    if (o)
      try {
        const r = referenceOf(o.data);
        use = {
          reference: guid,
          fileName: r.fileName,
          name: r.name,
          mainGuid: r.mainGuid,
          revisionGuid: r.revisionGuid,
          subtype: r.subtype,
          library: r.library,
          userParams: one(r.links, LINK.userParams),
          currentParams: one(r.links, LINK.currentParams),
          programParams: one(r.links, LINK.programParams),
        };
      } catch {
        fail(CLASS.reference);
      }
    uses.set(guid, use);
    return use;
  };

  const catalogue = new Map<string, { part: Mutable<LibraryPart>; kinds: Set<LibPartKind> }>();
  const partFor = (key: string, fileName: string): { part: Mutable<LibraryPart>; kinds: Set<LibPartKind> } => {
    let e = catalogue.get(key);
    if (!e) {
      e = {
        part: { fileName, name: null, mainGuid: null, revisionGuid: null, subtype: null, kind: "other", library: null, header: null, content: null, embedded: null, uses: 0 },
        kinds: new Set(),
      };
      catalogue.set(key, e);
    }
    return e;
  };

  const placed = (o: ArchicadObject, fr: Frame, storyKey: string, partKeys: readonly string[], kind: LibPartKind): Placed & { readonly libPart: LibPartUse | null } => {
    let use: LibPartUse | null = null;
    for (const k of partKeys) {
      use = useOf(one(fr.links, k));
      if (use) break;
    }
    const params = (use && (listOf(use.currentParams) ?? listOf(use.userParams))) ?? [];
    if (use) {
      const e = partFor(use.mainGuid, use.fileName);
      e.part.name ??= use.name;
      e.part.mainGuid ??= use.mainGuid;
      e.part.revisionGuid ??= use.revisionGuid;
      e.part.subtype ??= use.subtype;
      e.part.library ??= use.library;
      e.part.uses++;
      e.kinds.add(kind);
    }
    return {
      guid: o.guid,
      floor: one(fr.links, storyKey),
      layer: i32(o.data, fr.f + 3),
      id: "",
      libPart: use,
      params,
      group: one(fr.links, LINK.group),
      database: one(fr.links, LINK.database),
    };
  };

  const doors: WallOpening[] = [];
  const windows: WallOpening[] = [];
  for (const [cls, into, wallKey, kind] of [
    [CLASS.door, doors, LINK.doorWall, "door"],
    [CLASS.window, windows, LINK.windowWall, "window"],
  ] as const) {
    for (const o of objects.get(cls) ?? []) {
      try {
        const d = o.data;
        const fr = frameOf(d);
        const q = fr.f + fr.s;
        const id = idAt(d, q + 0x6e, fr.blockEnd);
        const B = fr.blockEnd;
        if (B + 0x72 > fr.links.at) throw new Error("opening data runs short");
        const width = f64(d, q + 0x1c);
        const height = f64(d, q + 0x24);
        const along = f64(d, B + 0x0f);
        const sill = f64(d, B + 0x37);
        const rest = [0x3f, 0x47, 0x4f, 0x57, 0x5f, 0x6a].map((x) => f64(d, B + x));
        finite(width, height, along, sill, ...rest);
        const base = placed(o, fr, LINK.openingStory, [LINK.openingPart, LINK.objectPart], kind);
        into.push({
          ...base,
          id,
          wall: one(fr.links, wallKey),
          width,
          height,
          along,
          sill,
          head: sill + height,
          mirrored: d[q + 0x17] !== 0,
          otherSide: d[q + 0x18] !== 0,
          refSide: d[q + 0x19] !== 0,
          anchor: (d[B + 0x0c] << 24) >> 24,
          reveal: d[B + 0x67] !== 0,
          revealDepthOffset: rest[0],
          jambDepthHead: rest[1],
          jambDepthSill: rest[2],
          jambDepth: rest[3],
          jambDepth2: rest[4],
          revealDepthFromSide: rest[5],
          marker: one(fr.links, LINK.marker),
        });
      } catch {
        fail(cls);
      }
    }
  }

  const skylights: Skylight[] = [];
  for (const o of objects.get(CLASS.skylight) ?? []) {
    try {
      const d = o.data;
      const fr = frameOf(d);
      const q = fr.f + fr.s;
      const id = idAt(d, q + 0x6e, fr.blockEnd);
      const B = fr.blockEnd + 10;
      if (B + 88 > fr.links.at) throw new Error("skylight data runs short");
      const width = f64(d, q + 0x1c);
      const height = f64(d, q + 0x24);
      const v = Array.from({ length: 11 }, (_, i) => f64(d, B + 8 * i));
      finite(width, height, ...v);
      skylights.push({
        ...placed(o, fr, LINK.skylightStory, [LINK.openingPart, LINK.objectPart], "skylight"),
        id,
        roof: one(fr.links, LINK.skylightRoof),
        width,
        height,
        mirrored: d[q + 0x17] !== 0,
        otherSide: d[q + 0x18] !== 0,
        position: { x: v[2], y: v[3] },
        level: v[6],
        azimuth: v[7],
        pitch: v[8],
      });
    } catch {
      fail(CLASS.skylight);
    }
  }

  const objectsOut: PlacedObject[] = [];
  const lamps: Lamp[] = [];
  for (const cls of [CLASS.symb, CLASS.light]) {
    for (const o of objects.get(cls) ?? []) {
      try {
        const d = o.data;
        const fr = frameOf(d);
        const q = fr.f + fr.s;
        const id = idAt(d, q + 0x77, fr.blockEnd);
        const [x, y, angle, z, a, b] = [0x26, 0x2e, 0x36, 0x3e, 0x46, 0x4e].map((k) => f64(d, q + k));
        finite(x, y, angle, z, a, b);
        const base = placed(o, fr, LINK.objectStory, [LINK.objectPart, LINK.openingPart], cls === CLASS.light ? "lamp" : "object");
        let owner: PlacedObject["owner"] = null;
        for (const e of fr.links.entries) {
          const kind = OWNER_LINKS[e.key];
          if (kind && e.refs.length > 0) {
            owner = { kind, guid: e.refs[0] };
            break;
          }
        }
        const obj: PlacedObject = {
          ...base,
          id,
          position: { x, y, z },
          angle,
          mirrored: d[q + 0x21] !== 0,
          a,
          b,
          height: numberParam(base.params, "ZZYZX"),
          owner,
        };
        if (cls === CLASS.symb) {
          objectsOut.push(obj);
          continue;
        }
        const sw = numberParam(base.params, "gs_light_switch");
        const rgb = ["gs_color_red", "gs_color_green", "gs_color_blue"].map((n) => numberParam(base.params, n));
        const channel = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
        lamps.push({
          ...obj,
          on: sw === null ? d[q + 0x22] !== 0 : sw !== 0,
          color: rgb[0] !== null && rgb[1] !== null && rgb[2] !== null ? { r: channel(rgb[0]), g: channel(rgb[1]), b: channel(rgb[2]) } : null,
          intensity: numberParam(base.params, "gs_light_intensity"),
        });
      } catch {
        fail(cls);
      }
    }
  }

  // the packed library: one header per file, linked to its content
  const packed = readLibraryFiles(objects);
  const files = new Map<string, LibraryFile>(packed.files.map((f) => [f.guid, f]));
  for (const [k, v] of Object.entries(packed.problems)) problems[k] = (problems[k] ?? 0) + v;
  const byFile = new Map<string, string>();
  for (const [key, e] of catalogue) byFile.set(e.part.fileName.toLowerCase(), key);
  const listed = readLibraryHeaders(objects);
  for (const [k, v] of Object.entries(listed.problems)) problems[k] = (problems[k] ?? 0) + v;
  for (const h of listed.headers) {
    const file = h.content ? files.get(h.content) : undefined;
    if (!h.gdl || (file ? !file.gsm : !/\.gsm$/i.test(h.fileName))) continue;
    const key = file?.gsm?.mainGuid ?? byFile.get(h.fileName.toLowerCase()) ?? `file:${h.fileName.toLowerCase()}`;
    const e = partFor(key, h.fileName);
    e.part.header = h.header;
    e.part.content = h.content;
    if (file?.gsm) {
      e.part.mainGuid ??= file.gsm.mainGuid;
      e.part.revisionGuid ??= file.gsm.revisionGuid;
      const k = kindOf(file.gsm.ancestry);
      if (k) e.kinds.add(k);
    }
  }
  for (const o of objects.get(CLASS.embedded) ?? []) {
    try {
      const item = readEmbedded(o.data);
      const gsm = item.bytes ? readGsm(item.bytes) : null;
      if (!gsm) continue;
      const e = partFor(gsm.mainGuid, item.path[item.path.length - 1]);
      e.part.embedded = o.guid;
      e.part.mainGuid ??= gsm.mainGuid;
      e.part.revisionGuid ??= gsm.revisionGuid;
      const k = kindOf(gsm.ancestry);
      if (k) e.kinds.add(k);
    } catch {
      fail(CLASS.embedded);
    }
  }
  const libraryParts: LibraryPart[] = [];
  for (const { part, kinds } of catalogue.values()) {
    const fromSubtype = part.subtype ? kindOf([part.subtype]) : null;
    const kind = (["door", "window", "skylight", "lamp", "object"] as const).find((k) => kinds.has(k)) ?? fromSubtype ?? "other";
    libraryParts.push({ ...part, kind });
  }

  return { doors, windows, skylights, objects: objectsOut, lamps, libraryParts, problems };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
