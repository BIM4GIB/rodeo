// Archicad's 2D and annotation elements (lines, arcs, polylines, splines, fills, texts, dimensions,
// level dimensions, zones, cameras, hotspots, groups and labels) decoded from their objects (see
// objects.ts), the reading side. Checked on files saved by Archicad 25, 27 and 29.
//
// The class data (from OBJECT_DATA) opens with a chain of versions, then 03 00 00 01, the class GUID
// again, a u16 count and that many u16 versions; the element's own data starts after them (D here).
// Archicad 25 writes 07 00 04 00 82 00 before the 03 00 00 01, Archicad 27 09 00 82 00 and Archicad
// 29 09 00 83 00, which is how the version is told. Some classes put a u32 main-block length first.
//
// A drawn element's data starts with a common header (h): a u8 drawing order, 01 00 and the layer's
// index (i32), the story number (i16, the floor index; meaningful for floor-plan elements only),
// then attribute-like fields and a u32 sequence number at h+0x11 (Archicad 27 and 29) or h+0x1b
// (Archicad 25). The class's own part (c) follows at h+0x15 or h+0x1f. The header sits right at D
// in Archicad 25 and 27 (8 bytes in for dimensions), and 16 to 32 bytes further on in Archicad 29,
// so it is looked for where expected and else found by its shape.
//
// Every payload ends with a link list: a u32 length (to the end), 01 00, entries, a 00. An entry is
// 11 or 12, a link kind GUID and a target GUID, or 01 or 02, a kind GUID, a u32 count and that many
// targets (ordered). The links say where an element lives: its owner database (a floor plan,
// section, elevation, interior elevation, detail, worksheet, layout, master layout, 3D document, a
// hotlinked module's database, or a drawing that sections and elevations share for their
// dimensions, all objects of their own classes), its story (an EDB::Floor object,
// present when the owner is a floor plan), its group, and what an annotation belongs to.
//
// Class parts, c as above, g the geometry; Archicad 25 puts g at c+0x18, 27 and 29 at c+0x34:
// - Line, Arc, PolyLine, Spline: c pen (u8), c+2 i16 -2, c+4 01 00 and the line type's index.
//   Line: g begin x, y, end x, y. Arc: g centre x, y, g+0x10 radius, g+0x18 main axis angle, g+0x20
//   minor/major ratio, g+0x28 begin and g+0x30 end angle, g+0x58 reflected (clockwise), g+0x59 whole
//   (a full circle or ellipse). PolyLine: g+4 a box, then a polygon at g+0x24 (below). Spline: g+4
//   n, n points, n (length before, length after, direction) triples, then n vertex IDs.
// - Polygons (polylines, fills, zones): u32 n, u32 arcs, u32 contours, a dummy point, n points;
//   when there are arcs a dummy and per arc u32 begin and end (1-based point numbers) and the f64
//   angle it turns (positive counter-clockwise); then the contour ends (contours + 1 u32, 0 first).
//   The first contour is the outline, the others holes; each repeats its first point at its end.
// - Hatch (fill): c its ID string, then q: u16 orientation kind, q+8 origin x, y, q+0x18 a 2x2
//   matrix, q+0x38 inner radius, q+0x44 the polygon block's length, a box at q+0x4b and the polygon
//   at q+0x6b. Before the link list (E): E-72 contour pen, E-66 contour line type, E-62 contour
//   shown, E-58 the fill's index, E-54 foreground pen, E-50 background pen (i16, -1 none). An area
//   text is a Note linked to the fill.
// - Word (text): c+2 u32 length to the location block, c+6 angle, c+0x23 the text (\r between
//   paragraphs), then the paragraphs (01 01, u32 length, then: u32 from, u32 count, i32
//   justification as the old Mac text engine had it (0 left, 1 centre, -1 right, 20 full), 24 zero
//   bytes, f64, u32 lines and their ends, u32 runs; a run is 01 00, u32 from, u32 count, 01 00 and
//   u32 style bits, 01 00 and a u32, three strings (the first the font), u32 0, 01 00 and a u32
//   list, f64 size in paper millimetres, u32 pen). Then the location: x, y, width, height.
// - Dim: c+1 a point on the dimension line, c+0x11 its direction; its DimElems in order through a
//   multi-link. DimElem: c+0 its point (0, 0 when associated to an element, which is linked); its
//   DimElemDerivedData holds the point projected onto the dimension line at D+0x10 (D+0x1c in 29).
// - LevDim: c+0xc x, y; its LevDimDerivedData holds the shown level at D (D+0xc in 29).
// - Room (zone): the name and number strings (at D+99, D+89 or D+211 in 25, 27 and 29), then a
//   base (f64) and height (f64), and the polygon 95 bytes after the number; the stamp is a Symb.
// - Camera (seen in 29 only): its name at D+37, then eye x, y, z, target x, y, z, and the view
//   cone in degrees 81 bytes after the name.
// - Hotspot: c x, y, z, c+0x18 pen (u32). Group: its members as a multi-link, its parent group.
// Not decoded: text anchors, styles and line spacing; Note (dimension and area text) contents;
// label geometry; zone categories and stamps; hotlinked modules' transforms.

import { OBJECT_DATA, hex, i32, u16, u32, utf16At, type ArchicadObject, type ObjectsByClass } from "./objects.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What kind of database (view) an element is drawn in. */
export type DatabaseKind = "floorPlan" | "section" | "elevation" | "interiorElevation" | "iesCommon" | "detail" | "worksheet" | "layout" | "masterLayout" | "document3d" | "hotlinkModule";

/** Where an element lives; every item has these. */
export interface Placement {
  readonly guid: string;
  /** the story number from the element's header, kept only for floor-plan elements (and elements without an owner) */
  readonly story: number | null;
  /** the layer's attribute index */
  readonly layer: number | null;
  /** drawing order (u8) */
  readonly order: number | null;
  /** the owner database's GUID, and its kind (from `databases`) */
  readonly owner: string | null;
  readonly ownerKind: DatabaseKind | null;
  /** the story's EDB::Floor GUID (present for floor-plan elements); stories of hotlinked modules are their own Floors */
  readonly floor: string | null;
  /** the Group the element belongs to */
  readonly group: string | null;
}

export interface DraftLine extends Placement {
  readonly pen: number;
  readonly lineType: number;
  readonly begin: Point;
  readonly end: Point;
}

export interface DraftArc extends Placement {
  readonly pen: number;
  readonly lineType: number;
  readonly center: Point;
  /** the radius along the main axis */
  readonly radius: number;
  /** the main axis's angle */
  readonly axisAngle: number;
  /** the other axis / the main axis (1 for a circle; can be a little over 1) */
  readonly ratio: number;
  readonly beginAngle: number;
  readonly endAngle: number;
  /** drawn clockwise from beginAngle to endAngle */
  readonly reflected: boolean;
  /** a whole circle or ellipse */
  readonly whole: boolean;
}

/** A polygon or polyline: flat arrays, no per-point objects. */
export interface Polygon {
  /** x, y pairs */
  readonly points: Float64Array;
  /** where each contour ends, in points (contour i is [ends[i-1] ?? 0, ends[i])); the first is the outline, the rest holes; one open run for a polyline */
  readonly ends: Uint32Array;
  /** curved edges as (from point, to point, angle) triples, 0-based point numbers; the angle the edge turns, positive counter-clockwise */
  readonly arcs: Float64Array;
}

export interface DraftPolyline extends Placement {
  readonly pen: number;
  readonly lineType: number;
  readonly shape: Polygon;
  /** the last point is the first */
  readonly closed: boolean;
}

export interface DraftSpline extends Placement {
  readonly pen: number;
  readonly lineType: number;
  /** x, y pairs */
  readonly points: Float64Array;
  /** per point: the handle's length before, after, and its direction */
  readonly handles: Float64Array;
}

export interface DraftFill extends Placement {
  readonly id: string;
  readonly shape: Polygon;
  /** the fill's attribute index */
  readonly fill: number;
  readonly pen: number;
  /** -1 when transparent */
  readonly backgroundPen: number;
  readonly contourPen: number;
  readonly contourLineType: number;
  readonly contourShown: boolean;
  /** how the pattern is oriented (0..3), its origin and 2x2 matrix (m00, m10, m01, m11) */
  readonly orientation: number;
  readonly origin: Point;
  readonly matrix: readonly [number, number, number, number];
  /** an area text (a Note) is shown */
  readonly areaText: string | null;
}

export type Justify = "left" | "center" | "right" | "full";
export interface TextParagraph {
  readonly from: number;
  readonly count: number;
  readonly justify: Justify;
}
export interface TextRun {
  readonly from: number;
  readonly count: number;
  readonly font: string;
  /** paper millimetres */
  readonly size: number;
  readonly pen: number;
  /** style bits as stored (which bit is bold, italic, underline isn't decoded) */
  readonly style: number;
}
export interface DraftText extends Placement {
  /** paragraphs separated by \r (the runs cover the paragraphs, not the separators) */
  readonly content: string;
  readonly paragraphs: readonly TextParagraph[];
  readonly runs: readonly TextRun[];
  /** the anchor point (which corner it is isn't decoded) */
  readonly point: Point;
  readonly angle: number;
  readonly width: number;
  readonly height: number;
}

export interface DimPoint {
  readonly guid: string;
  /** the measured point (0, 0 when it follows an element, see `element`) */
  readonly point: Point;
  /** the point projected onto the dimension line, from the derived data */
  readonly onLine: Point | null;
  /** the element the point follows */
  readonly element: string | null;
}
export interface DraftDimension extends Placement {
  /** a point on the dimension line and its direction */
  readonly linePoint: Point;
  readonly direction: Point;
  /** in order; the shown values are the distances between neighbours' onLine points */
  readonly points: readonly DimPoint[];
}

export interface DraftLevelDimension extends Placement {
  readonly point: Point;
  /** the level shown (metres), null when not stored */
  readonly level: number | null;
  /** the story it measures from, and the element it is attached to */
  readonly levelFloor: string | null;
  readonly element: string | null;
}

export interface DraftZone extends Placement {
  readonly name: string;
  readonly number: string;
  readonly shape: Polygon;
  /** the two f64 after the number: likely the base offset from the story, and the height */
  readonly base: number;
  readonly height: number;
  /** the zone stamp (a Symb object) */
  readonly stamp: string | null;
}

export interface DraftCamera extends Placement {
  readonly name: string;
  readonly eye: Point3;
  readonly target: Point3;
  /** degrees */
  readonly viewCone: number;
}

export interface DraftHotspot extends Placement {
  readonly point: Point3;
  readonly pen: number;
}

export interface DraftGroup {
  readonly guid: string;
  readonly members: readonly string[];
  readonly parent: string | null;
}

export interface DraftLabel extends Placement {
  /** the Word holding its text, and the element it labels */
  readonly text: string | null;
  readonly element: string | null;
}

export interface Drafting {
  /** owner database GUID → kind */
  readonly databases: ReadonlyMap<string, DatabaseKind>;
  readonly lines: readonly DraftLine[];
  readonly arcs: readonly DraftArc[];
  readonly polylines: readonly DraftPolyline[];
  readonly splines: readonly DraftSpline[];
  readonly fills: readonly DraftFill[];
  readonly texts: readonly DraftText[];
  readonly dimensions: readonly DraftDimension[];
  readonly levelDimensions: readonly DraftLevelDimension[];
  readonly zones: readonly DraftZone[];
  readonly cameras: readonly DraftCamera[];
  readonly hotspots: readonly DraftHotspot[];
  readonly groups: readonly DraftGroup[];
  readonly labels: readonly DraftLabel[];
  /** objects that didn't decode, by class name */
  readonly problems: Record<string, number>;
}

// ---- classes and link kinds (GUIDs hex as stored) ----------------------------------------------

export const LINE = "737dfebd781cca4a809b1b25747e3126";
export const ARC = "2b7b49f3fc11ae498424d933780bacce";
export const POLYLINE = "228bdcb06dadf14b97335077b6588fc4";
export const SPLINE = "a620311ece364f4690e2322ce53e2521";
export const HATCH = "346130666af70f41991dc9ee97b541ec";
export const WORD = "ae7ec0e62a5a974595a973e7543ac91e";
export const HOTSPOT = "27ffacda06ac9b46bb7cb1f15eaedf70";
export const DIM = "e5385d96ad0ce44bb5024f5e907815dc";
export const DIM_ELEM = "cbee9357e232dd4fb216739ff6c806c4";
export const DIM_ELEM_DERIVED = "631df7a4b4c2e44bb7bd8b0a57651b73";
export const LEV_DIM = "fa7808691fb1c946953c3864d85bdee6";
export const LEV_DIM_DERIVED = "c6cad7b888d2f14aad44c67591f6cd74";
export const ROOM = "2e33d03ae2ef1a4992a65b14bfdd7229";
export const CAMERA = "eaa31afb0a89fd4aa8f809b0df5e502a";
export const GROUP = "d94bc14a4db49e46aada209d8a7ef7e2";
export const LABEL = "0cb501161fa67c448b740f578c003d88";

/** Owner database classes → kind. */
export const DATABASE_CLASSES: ReadonlyMap<string, DatabaseKind> = new Map<string, DatabaseKind>([
  ["21e5a0f63b44da4eb20a7160cbe09115", "floorPlan"],
  ["509ae4f923d3a845bd880d6b82e6aa7a", "section"],
  ["10b74ffbc8089546a420a4c142e04d33", "elevation"],
  // VBES::IESCommonDrawing: seen holding only dimensions (each with an IES::DimensionInfo), drawn in sections, elevations or interior elevations
  ["623bfe0d0da5434fb05cc99ed9f5aeed", "iesCommon"],
  // unnamed in the files read; a section-like database with its own sight cache, seen only in an Archicad 27 file
  ["a577a69b48ab93468133e819cec8e262", "interiorElevation"],
  ["209204749ae31949b2ae5d371185ad03", "detail"],
  ["ca1c7648254da541a1c30fe97a74ebd8", "worksheet"],
  ["3cafac32b8269345926cf81a205550ba", "layout"],
  ["dd231e04ca9f534a96338865f82a3a40", "masterLayout"],
  ["c2bb4499e6c5e440a0a96ccc782f0e90", "document3d"],
  ["ea39e33377ab9c4f874c110eb5f66f63", "hotlinkModule"],
]);

/** Class GUID → class name, for the element classes read. */
export const DRAFTING_CLASS_NAMES: ReadonlyMap<string, string> = new Map([
  [LINE, "VBElem::Line"],
  [ARC, "VBElem::Arc"],
  [POLYLINE, "PolyLine"],
  [SPLINE, "Spline"],
  [HATCH, "Hatch"],
  [WORD, "Word"],
  [HOTSPOT, "Hotspot"],
  [DIM, "VBElem::Dim"],
  [DIM_ELEM, "DimElem"],
  [DIM_ELEM_DERIVED, "DimElemDerivedData"],
  [LEV_DIM, "LevDim"],
  [LEV_DIM_DERIVED, "LevDimDerivedData"],
  [ROOM, "Room"],
  [CAMERA, "Camera"],
  [GROUP, "Group"],
  [LABEL, "Label"],
]);

export const DRAFTING_CLASSES: ReadonlySet<string> = new Set([...DRAFTING_CLASS_NAMES.keys(), ...DATABASE_CLASSES.keys()]);

const K_OWNER = "0b279bbd4703cf4d92cfd2d872117ba1";
const K_FLOOR = "0312b67984ae884da9c620ead705e0bc";
const K_GROUP = "80b955a819fd60458bc17a2b82c4f5aa";
const K_NOTE = "1ef03d9e1866ff4db154236e87778087";
const K_LABEL_WORD = "895ffd1ca688cd4cbbff4c0aadb903df";
const K_LABEL_ELEM = "dcd23af73b97704e9787a3c6fee4a2bf";
const K_DIM_MEASURED = "fbc46b3834ea874280674f16b966b7af";
const K_DIM_PARTS = "44572a42c7200c4d85cb62669759f0e9";
const K_DIM_DERIVED = "cbe644279d7f6241bd25049649bb2172";
const K_LEV_DERIVED = "0571582bbc3b4742973767fc09a9793f";
const K_LEV_FLOOR = "d18dfe8d97df5f47b6b2ec0c720e82d0";
const K_LEV_ELEM = "c6a8769102f50f448ef3f0a700178e4a";
const K_STAMP = "049fbc5b4d758b408e1b4f20c33cd868";

/** The link kinds read (GUIDs hex as stored). */
export const DRAFTING_LINKS = {
  owner: K_OWNER,
  floor: K_FLOOR,
  group: K_GROUP,
  note: K_NOTE,
  labelText: K_LABEL_WORD,
  labelElement: K_LABEL_ELEM,
  dimMeasured: K_DIM_MEASURED,
  dimParts: K_DIM_PARTS,
  dimDerived: K_DIM_DERIVED,
  levelDerived: K_LEV_DERIVED,
  levelFloor: K_LEV_FLOOR,
  levelElement: K_LEV_ELEM,
  stamp: K_STAMP,
} as const;

// ---- the framework ------------------------------------------------------------------------------

type Gen = 25 | 27 | 29;

/** Where the element's own data starts (D), and the Archicad generation. */
export function frameOf(d: Uint8Array): { gen: Gen; D: number } | null {
  for (let at = OBJECT_DATA; at <= 120 && at + 18 <= d.length; at++) {
    let same = true;
    for (let i = 0; i < 16 && same; i++) same = d[at + i] === d[i];
    if (!same) continue;
    const n = u16(d, at + 16);
    const D = at + 18 + 2 * n;
    if (n > 32 || D > d.length) return null;
    const gen: Gen = u16(d, at - 8) === 4 ? 25 : u16(d, at - 6) === 0x83 ? 29 : 27;
    return { gen, D };
  }
  return null;
}

function headerFits(d: Uint8Array, k: number, gen: Gen): boolean {
  if (k + 0x24 > d.length) return false;
  const order = d[k];
  if (order < 1 || order > 40 || u16(d, k + 1) !== 1 || u32(d, k + 3) > 65535) return false;
  const story = (u16(d, k + 7) << 16) >> 16;
  if (story < -100 || story > 1000) return false;
  return gen === 25 ? u16(d, k + 0xf) === 1 && u16(d, k + 0x15) === 1 : u16(d, k + 0xb) === 1;
}

interface Header {
  readonly gen: Gen;
  readonly D: number;
  readonly order: number;
  readonly layer: number;
  readonly story: number;
  /** the class's own part */
  readonly c: number;
}

/** The common header, looked for `expect` bytes after D first. */
function headerOf(d: Uint8Array, expect: (gen: Gen) => number): Header | null {
  const f = frameOf(d);
  if (!f) return null;
  let h = f.D + expect(f.gen);
  if (!headerFits(d, h, f.gen)) {
    h = -1;
    for (let k = f.D; k < f.D + 64; k++)
      if (headerFits(d, k, f.gen)) {
        h = k;
        break;
      }
    if (h < 0) return null;
  }
  return { gen: f.gen, D: f.D, order: d[h], layer: i32(d, h + 3), story: (u16(d, h + 7) << 16) >> 16, c: h + (f.gen === 25 ? 0x1f : 0x15) };
}

const atDrawn = (gen: Gen): number => (gen === 29 ? 28 : 0);
const atNote = (gen: Gen): number => (gen === 29 ? 24 : 0);
const atDim = (gen: Gen): number => (gen === 29 ? 32 : 8);

interface Link {
  readonly tag: number;
  readonly kind: string;
  readonly target: string;
}

function linkEntries(d: Uint8Array, p: number, end: number, out: Link[]): boolean {
  while (p < end) {
    const tag = d[p];
    if (tag === 0) return p === end - 1;
    if (tag === 0x11 || tag === 0x12) {
      if (p + 33 > end) return false;
      out.push({ tag, kind: hex(d, p + 1, 16), target: hex(d, p + 17, 16) });
      p += 33;
    } else if (tag === 0x01 || tag === 0x02) {
      if (p + 21 > end) return false;
      const n = u32(d, p + 17);
      if (p + 21 + 16 * n > end) return false;
      const kind = hex(d, p + 1, 16);
      for (let i = 0; i < n; i++) out.push({ tag, kind, target: hex(d, p + 21 + 16 * i, 16) });
      p += 21 + 16 * n;
    } else return false;
  }
  return false;
}

/** The link list at the end of a payload, and where it starts (the payload's length when there is none). */
export function linksOf(d: Uint8Array): { at: number; links: readonly Link[] } {
  const end = d.length;
  if (end > 0 && d[end - 1] === 0)
    for (let p = end - 7; p >= OBJECT_DATA; p--) {
      if (d[p + 4] !== 1 || d[p + 5] !== 0 || u32(d, p) !== end - p - 4) continue;
      const links: Link[] = [];
      if (linkEntries(d, p + 6, end, links)) return { at: p, links };
    }
  return { at: end, links: [] };
}

const linkTo = (links: readonly Link[], kind: string): string | null => links.find((l) => l.kind === kind && l.tag !== 0x01 && l.tag !== 0x02)?.target ?? null;

class Fail extends Error {}
function need(ok: boolean): void {
  if (!ok) throw new Fail();
}

/** f64 reads through one view per payload. */
class View {
  readonly v: DataView;
  constructor(readonly d: Uint8Array) {
    this.v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }
  f(o: number): number {
    return this.v.getFloat64(o, true);
  }
  /** a finite coordinate */
  c(o: number): number {
    const x = this.v.getFloat64(o, true);
    need(Number.isFinite(x) && Math.abs(x) < 1e7);
    return x;
  }
  pt(o: number): Point {
    return { x: this.c(o), y: this.c(o + 8) };
  }
  pt3(o: number): Point3 {
    return { x: this.c(o), y: this.c(o + 8), z: this.c(o + 16) };
  }
}

/** The polygon whose point count is at `p`; `open` for a polyline (no contours), and where it ends. */
function polygonAt(w: View, p: number): { shape: Polygon; end: number } {
  const d = w.d;
  need(p + 28 <= d.length);
  const n = u32(d, p);
  const nArcs = u32(d, p + 4);
  const nSub = u32(d, p + 8);
  need(n >= 1 && nArcs <= n && nSub <= n);
  let q = p + 28;
  need(q + 16 * n <= d.length);
  const points = new Float64Array(2 * n);
  for (let i = 0; i < 2 * n; i++) points[i] = w.c(q + 8 * i);
  q += 16 * n;
  const arcs = new Float64Array(3 * nArcs);
  if (nArcs > 0) {
    q += 16;
    need(q + 16 * nArcs <= d.length);
    for (let i = 0; i < nArcs; i++) {
      const from = u32(d, q) - 1;
      const to = u32(d, q + 4) - 1;
      need(from < n && to < n);
      arcs[3 * i] = from;
      arcs[3 * i + 1] = to;
      arcs[3 * i + 2] = w.f(q + 8);
      q += 16;
    }
  }
  let ends: Uint32Array;
  if (nSub > 0) {
    need(q + 4 * (nSub + 1) <= d.length && u32(d, q) === 0);
    ends = new Uint32Array(nSub);
    for (let i = 0; i < nSub; i++) ends[i] = u32(d, q + 4 + 4 * i);
    need(ends[nSub - 1] === n);
    q += 4 * (nSub + 1);
  } else ends = Uint32Array.of(n);
  return { shape: { points, ends, arcs }, end: q };
}

// ---- reading ------------------------------------------------------------------------------------

interface Common {
  readonly placement: Placement;
  readonly h: Header;
  readonly links: readonly Link[];
  /** where the link list starts */
  readonly E: number;
  readonly w: View;
}

/**
 * The drafting elements among `objects` (gathered with DRAFTING_CLASSES). Owners, stories and
 * groups are GUIDs: match `floor` with the stories' EDB::Floor GUIDs and `owner` with `databases`.
 */
export function readDrafting(objects: ObjectsByClass): Drafting {
  const problems: Record<string, number> = {};
  const bad = (cls: string): void => {
    const name = DRAFTING_CLASS_NAMES.get(cls) ?? cls;
    problems[name] = (problems[name] ?? 0) + 1;
  };
  const list = (cls: string): readonly ArchicadObject[] => objects.get(cls) ?? [];

  const databases = new Map<string, DatabaseKind>();
  for (const [cls, kind] of DATABASE_CLASSES) for (const o of list(cls)) databases.set(o.guid, kind);

  function common(o: ArchicadObject, expect: ((gen: Gen) => number) | null): Common {
    const d = o.data;
    const { at: E, links } = linksOf(d);
    const h = expect ? headerOf(d, expect) : null;
    if (expect) need(h !== null);
    const f = h ?? frameOf(d);
    need(f !== null);
    const owner = linkTo(links, K_OWNER);
    const ownerKind = owner ? (databases.get(owner) ?? null) : null;
    const placement: Placement = {
      guid: o.guid,
      story: h && (ownerKind === "floorPlan" || owner === null) ? h.story : null,
      layer: h ? h.layer : null,
      order: h ? h.order : null,
      owner,
      ownerKind,
      floor: linkTo(links, K_FLOOR),
      group: linkTo(links, K_GROUP),
    };
    const head: Header = h ?? { gen: f!.gen, D: f!.D, order: 0, layer: 0, story: 0, c: f!.D };
    return { placement, h: head, links, E, w: new View(d) };
  }

  function each<T>(cls: string, expect: ((gen: Gen) => number) | null, read: (x: Common, o: ArchicadObject) => T): T[] {
    const out: T[] = [];
    for (const o of list(cls)) {
      try {
        out.push(read(common(o, expect), o));
      } catch (e) {
        if (!(e instanceof Fail) && !(e instanceof RangeError)) throw e;
        bad(cls);
      }
    }
    return out;
  }

  const drawnGeometry = (x: Common): number => x.h.c + (x.h.gen === 25 ? 0x18 : 0x34);
  const penAndType = (x: Common): { pen: number; lineType: number } => {
    const d = x.w.d;
    need(u16(d, x.h.c + 4) === 1);
    return { pen: d[x.h.c], lineType: i32(d, x.h.c + 6) };
  };

  const lines = each(LINE, atDrawn, (x): DraftLine => {
    const g = drawnGeometry(x);
    return { ...x.placement, ...penAndType(x), begin: x.w.pt(g), end: x.w.pt(g + 16) };
  });

  const arcs = each(ARC, atDrawn, (x): DraftArc => {
    const g = drawnGeometry(x);
    const w = x.w;
    const radius = w.c(g + 0x10);
    need(radius >= 0);
    return {
      ...x.placement,
      ...penAndType(x),
      center: w.pt(g),
      radius,
      axisAngle: w.c(g + 0x18),
      ratio: w.c(g + 0x20),
      beginAngle: w.c(g + 0x28),
      endAngle: w.c(g + 0x30),
      reflected: w.d[g + 0x58] === 1,
      whole: w.d[g + 0x59] === 1,
    };
  });

  const polylines = each(POLYLINE, atDrawn, (x): DraftPolyline => {
    const g = drawnGeometry(x);
    need(u16(x.w.d, g) === 3);
    const { shape } = polygonAt(x.w, g + 0x24);
    const p = shape.points;
    const n = p.length;
    return { ...x.placement, ...penAndType(x), shape, closed: n >= 6 && p[0] === p[n - 2] && p[1] === p[n - 1] };
  });

  const splines = each(SPLINE, atDrawn, (x): DraftSpline => {
    const d = x.w.d;
    // the Archicad 25 place is known; try the later one too
    for (const g of [drawnGeometry(x), x.h.c + 0x18, x.h.c + 0x34]) {
      if (g + 8 > x.E) continue;
      const n = u32(d, g + 4);
      if (n < 2 || g + 8 + 40 * n + 4 + 4 * n !== x.E || u32(d, g + 8 + 40 * n) !== n) continue;
      const points = new Float64Array(2 * n);
      for (let i = 0; i < 2 * n; i++) points[i] = x.w.c(g + 8 + 8 * i);
      const handles = new Float64Array(3 * n);
      for (let i = 0; i < 3 * n; i++) handles[i] = x.w.c(g + 8 + 16 * n + 8 * i);
      return { ...x.placement, ...penAndType(x), points, handles };
    }
    throw new Fail();
  });

  const fills = each(HATCH, atNote, (x): DraftFill => {
    const { w, E } = x;
    const d = w.d;
    const id = utf16At(d, x.h.c);
    need(id !== null);
    const q = id!.end;
    const blockEnd = q + 0x48 + u32(d, q + 0x44);
    need(blockEnd <= E && E - 72 > q);
    const { shape, end } = polygonAt(w, q + 0x6b);
    need(end <= blockEnd && shape.ends.length >= 1 && u16(d, E - 60) === 1 && u16(d, E - 68) === 1);
    return {
      ...x.placement,
      id: id!.text,
      shape,
      fill: i32(d, E - 58),
      pen: d[E - 54],
      backgroundPen: (u16(d, E - 50) << 16) >> 16,
      contourPen: d[E - 72],
      contourLineType: i32(d, E - 66),
      contourShown: d[E - 62] === 1,
      orientation: u16(d, q),
      origin: w.pt(q + 8),
      matrix: [w.c(q + 0x18), w.c(q + 0x20), w.c(q + 0x28), w.c(q + 0x30)],
      areaText: linkTo(x.links, K_NOTE),
    };
  });

  const texts = each(WORD, atNote, (x): DraftText => {
    const { w } = x;
    const d = w.d;
    const c = x.h.c;
    need(d[c] === 1 && d[c + 1] === 3);
    const loc = c + 6 + u32(d, c + 2);
    need(loc + 32 <= d.length);
    const content = utf16At(d, c + 0x23);
    need(content !== null);
    let p = content!.end;
    const nPar = u32(d, p);
    p += 4;
    const paragraphs: TextParagraph[] = [];
    const runs: TextRun[] = [];
    for (let i = 0; i < nPar; i++) {
      need(p + 6 <= loc && d[p] === 1 && d[p + 1] === 1);
      const len = u32(d, p + 2);
      paragraphs.push(paragraph(d, w, p + 6, p + 6 + len, runs));
      p += 6 + len;
    }
    need(p === loc - 8);
    const width = w.c(loc + 16);
    const height = w.c(loc + 24);
    return { ...x.placement, content: content!.text, paragraphs, runs, point: w.pt(loc), angle: w.c(c + 6), width, height };
  });

  const derivedPoints = new Map<string, Point>();
  for (const o of list(DIM_ELEM_DERIVED)) {
    const f = frameOf(o.data);
    const at = f ? f.D + (f.gen === 29 ? 0x1c : 0x10) : -1;
    if (at < 0 || at + 16 > o.data.length) {
      bad(DIM_ELEM_DERIVED);
      continue;
    }
    const w = new View(o.data);
    const x = w.f(at);
    const y = w.f(at + 8);
    if (Number.isFinite(x) && Number.isFinite(y)) derivedPoints.set(o.guid, { x, y });
    else bad(DIM_ELEM_DERIVED);
  }
  const dimPoints = new Map<string, DimPoint>();
  each(DIM_ELEM, atNote, (x): null => {
    const derived = linkTo(x.links, K_DIM_DERIVED);
    dimPoints.set(x.placement.guid, { guid: x.placement.guid, point: x.w.pt(x.h.c), onLine: derived ? (derivedPoints.get(derived) ?? null) : null, element: linkTo(x.links, K_DIM_MEASURED) });
    return null;
  });
  const dimensions = each(DIM, atDim, (x): DraftDimension => {
    const points: DimPoint[] = [];
    for (const l of x.links) {
      if (l.kind !== K_DIM_PARTS || (l.tag !== 0x01 && l.tag !== 0x02)) continue;
      const p = dimPoints.get(l.target);
      if (p) points.push(p);
    }
    return { ...x.placement, linePoint: x.w.pt(x.h.c + 1), direction: x.w.pt(x.h.c + 0x11), points };
  });

  const levels = new Map<string, number>();
  for (const o of list(LEV_DIM_DERIVED)) {
    const f = frameOf(o.data);
    const at = f ? f.D + (f.gen === 29 ? 0xc : 0) : -1;
    if (at < 0 || at + 8 > o.data.length) {
      bad(LEV_DIM_DERIVED);
      continue;
    }
    const v = new View(o.data).f(at);
    if (Number.isFinite(v) && Math.abs(v) < 1e6) levels.set(o.guid, v);
  }
  const levelDimensions = each(LEV_DIM, atDim, (x): DraftLevelDimension => {
    const derived = linkTo(x.links, K_LEV_DERIVED);
    return { ...x.placement, point: x.w.pt(x.h.c + 0xc), level: derived ? (levels.get(derived) ?? null) : null, levelFloor: linkTo(x.links, K_LEV_FLOOR), element: linkTo(x.links, K_LEV_ELEM) };
  });

  const zones = each(ROOM, null, (x): DraftZone => {
    const d = x.w.d;
    const name = utf16At(d, x.h.D + (x.h.gen === 25 ? 99 : x.h.gen === 27 ? 89 : 211));
    need(name !== null);
    const number = utf16At(d, name!.end);
    need(number !== null);
    const ne = number!.end;
    const { shape } = polygonAt(x.w, ne + 95);
    // a room's header doesn't match the drawn elements' one: its story comes from its Floor link
    return { ...x.placement, name: name!.text, number: number!.text, shape, base: x.w.c(ne), height: x.w.c(ne + 8), stamp: linkTo(x.links, K_STAMP) };
  });

  const cameras = each(CAMERA, null, (x): DraftCamera => {
    const name = utf16At(x.w.d, x.h.D + 37);
    need(name !== null);
    const e = name!.end;
    return { ...x.placement, name: name!.text, eye: x.w.pt3(e), target: x.w.pt3(e + 24), viewCone: x.w.c(e + 81) };
  });

  const hotspots = each(HOTSPOT, atNote, (x): DraftHotspot => ({ ...x.placement, point: x.w.pt3(x.h.c), pen: u32(x.w.d, x.h.c + 0x18) }));

  const groups = each(GROUP, null, (x): DraftGroup => {
    const members: string[] = [];
    let parent: string | null = null;
    for (const l of x.links) {
      if (l.kind !== K_GROUP) continue;
      if (l.tag === 0x01 || l.tag === 0x02) members.push(l.target);
      else parent = l.target;
    }
    return { guid: x.placement.guid, members, parent };
  });

  const labels = each(LABEL, atNote, (x): DraftLabel => ({ ...x.placement, text: linkTo(x.links, K_LABEL_WORD), element: linkTo(x.links, K_LABEL_ELEM) }));

  return { databases, lines, arcs, polylines, splines, fills, texts, dimensions, levelDimensions, zones, cameras, hotspots, groups, labels, problems };
}

const JUSTIFY: ReadonlyMap<number, Justify> = new Map<number, Justify>([
  [0, "left"],
  [-2, "left"],
  [1, "center"],
  [-1, "right"],
  [20, "full"],
]);

/** One paragraph of a text (from `p` to `end`), its runs added to `runs`. */
function paragraph(d: Uint8Array, w: View, p: number, end: number, runs: TextRun[]): TextParagraph {
  need(p + 48 <= end);
  const from = u32(d, p);
  const count = u32(d, p + 4);
  const justify = JUSTIFY.get(i32(d, p + 8)) ?? "left";
  let q = p + 44;
  const nLines = u32(d, q);
  need(nLines < 1 << 16);
  q += 4 + 4 * nLines;
  const nRuns = u32(d, q);
  need(nRuns < 1 << 16);
  q += 4;
  for (let i = 0; i < nRuns; i++) {
    need(q + 10 <= end && u16(d, q) === 1);
    const runFrom = u32(d, q + 2);
    const runCount = u32(d, q + 6);
    need(u16(d, q + 10) === 1 && u16(d, q + 16) === 1);
    const style = u32(d, q + 12);
    q += 22;
    let font = "";
    for (let s = 0; s < 3; s++) {
      const str = utf16At(d, q);
      need(str !== null && str.end <= end);
      if (s === 0) font = str!.text;
      q = str!.end;
    }
    q += 4;
    need(q + 6 <= end && u16(d, q) === 1);
    const n = u32(d, q + 2);
    need(n < 1 << 16);
    q += 6 + 4 * n;
    need(q + 12 <= end);
    const size = w.f(q);
    need(Number.isFinite(size));
    runs.push({ from: runFrom, count: runCount, font, size, pen: u32(d, q + 8), style });
    q += 12;
  }
  return { from, count, justify };
}
