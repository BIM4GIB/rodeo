// The drawings Archicad generates for elements and keeps in the file: what there is, and its decoder.
//
// What the file holds. Archicad does not save a 3D model of the project, nor the floor-plan symbols
// it draws for scripted (GDL) elements: both are rebuilt from the elements and their library parts
// when a project opens. What it does save is the drawing of each element in each section,
// elevation, interior elevation and 3D document: one VirtSy object per element per view, holding
// the element's hidden-line drawing there (lines, arcs, polylines, fills) and its 3D hotspots, in
// the view's own plane. So doors, windows, objects and stairs have Archicad's own geometry only
// in those views, as 2D, and only when some such view shows them. (Drawings placed on layouts are
// kept too, zlib-compressed in DLM::StoredIDFData / DLM::RuntimeIDFData, each with a table of the
// elements in it, but their content isn't grouped by element; not read here.)
//
// A VirtSy object (class 15b15de369db4e4dac7f88062efde491), every version alike except where said:
//  - the object framework, then 01 00 09 01 (00 00 09 01 in Archicad 25), a u32 length L and a
//    vector image of L bytes;
//  - the vector image: u32 0x80, 01, 0x24, two marker bytes ("mm" or "WW"), its box (xMin, yMin,
//    xMax, yMax, f64), a u8, the drawing scale (u32, 100 for 1:100), a u32 of flags, a u32 size in
//    memory, twelve u32 counts by record type (type k + 2: hotspots, lines, arcs, -, fills, ...,
//    texts at 9, polylines at 10) and twelve u16 record versions; then records, each a type byte
//    and a u32 size in memory, then its fields, ending with type 0:
//      2 hotspot (69 bytes): 16 bytes of header, a u32, x, y, depth and a fourth f64, a u8, a GUID;
//      3 line (54): type, a byte, pen (u16), line type (i16), a u16, two u32s, x1 y1 x2 y2, 6 bytes;
//      4 arc (107): type, a byte, pen, line type, a u16, a u32, a u16, a "whole" flag byte, then
//        centre x, y, radius, main axis direction, axis ratio, begin and end angle, begin x, y,
//        end x, y (f64), 4 bytes;
//      6 fill (20): type, a byte, a u16, the GUID of a fill stored after the records;
//      11 text (213, only two in the samples): skipped, its words aren't decoded;
//      12 polyline: type, three bytes, pen (u16 at +4), line type, a u16, a u32, a u16, the point
//        count n (u32), the arc count a (u32), 16 bytes, n points (x, y), a arcs (begin and end point
//        index, counted from 1, u32, and the angle, f64), 2 bytes;
//    after the end record 9 zero bytes (a font list instead when there are texts), 01 00 and the
//    fill count (u32), then each fill: its GUID,
//    03 01, a u16, 6 bytes, pen (u16 at +10 from the GUID's end), line type, 21 bytes, a colour
//    (three u16 at +37, the high byte of each is the 0..255 value), 12 bytes, then its outline as
//    Archicad keeps polygons: a u32 count and that many points (x, y; the first unused), 01 00, a
//    u32 count of arcs (begin and end point index u32, angle f64; counter-clockwise positive),
//    01 00, a u32 count of contour ends (the first 0, then each contour's last point index; each
//    contour repeats its first point at its end), 100 bytes (pattern origin and frame), the GUID
//    again and 7 bytes;
//  - after the vector image: the element's class GUID (Archicad 27 and 29; a u16 element kind
//    and a zero GUID in 25), GUIDs of the element and its owner, a u16 kind, the drawing's origin
//    in the view (x, y, f64), a u16 of flags (preceded by one more byte in Archicad 25), the
//    element's own frame as a 3x4 matrix (rows: axis x, y, z with translation; local to world;
//    unit axes, square to each other except for some slanted elements; all zero for some),
//    the element's reference point, and the element's outline in the view with point ids;
//  - last, a u32 size, 01 00, entries of 0x12 (or 0x11), a role GUID and an object GUID (the
//    element, the view, the view's content holder, a group, a renovation status) or of 0x01, a GUID
//    and a u32-counted GUID list, and a 00.
// The vector image's coordinates are relative to the drawing's origin; adding it gives the view's
// coordinates: in a section or elevation, x runs along the cut line and y is the elevation
// (metres, as the model stores them); depth is the distance behind the cut plane. Checked on
// sample walls and slabs against their own records: the drawn extent of a wall in a section
// matches its begin and end points, bottom and top, and a hotspot box its thickness.

import { f64, hex, OBJECT_DATA, u16, u32, type ObjectsByClass } from "./objects.ts";

export const VIRTSY_CLASS = "15b15de369db4e4dac7f88062efde491";

export type ViewKind = "section" | "elevation" | "interiorElevation" | "document3d";

/** The view classes a drawing can belong to, by class GUID. */
const VIEW_CLASSES: Readonly<Record<string, ViewKind>> = {
  "509ae4f923d3a845bd880d6b82e6aa7a": "section", // VBES::Section
  "10b74ffbc8089546a420a4c142e04d33": "elevation", // VBES::Elevation
  "623bfe0d0da5434fb05cc99ed9f5aeed": "interiorElevation", // VBES::IESCommonDrawing
  c2bb4499e6c5e440a0a96ccc782f0e90: "document3d", // VBES::DocumentFrom3D
  a577a69b48ab93468133e819cec8e262: "interiorElevation", // unnamed; only in the Archicad 27 sample, holds interior elevation drawings
};

/** VirtSy, plus the view classes (read only to tell which kind of view each drawing is in). */
export const GEOMETRY_CLASSES: ReadonlySet<string> = new Set([VIRTSY_CLASS, ...Object.keys(VIEW_CLASSES)]);

/** Roles in a drawing's closing list of references. */
const ROLE_ELEMENT = "78f39898252c2e4686b95e6b7a9aa0e4";
const ROLE_VIEW = "d1895284f49c9b4c9180744cbf6834f9";
const ROLE_HOLDER = "107f08794bfd834c95165e790a7e4519";
const ROLE_IE_HOLDER = "294db7dfcde461478bf6dd4a9c0452e8";
const ROLE_GROUP = "80b955a819fd60458bc17a2b82c4f5aa";

/**
 * A drawing's filled areas, packed. Fill k has contours fillContours[k] .. fillContours[k + 1] - 1,
 * the first its outline, the others holes; contour c has the points contourStarts[c] ..
 * contourStarts[c + 1] - 1 of `points` (x, y pairs, closed implicitly, arcs turned into points).
 */
export interface Fills {
  readonly points: Float64Array;
  readonly contourStarts: Uint32Array;
  readonly fillContours: Uint32Array;
  readonly pens: Uint16Array;
  /** r, g, b (0..255) per fill, as stored; often 0, 0, 0 (the colour then comes from the pen) */
  readonly rgb: Uint8Array;
}

/** A drawing's polylines, packed: polyline k has the points starts[k] .. starts[k + 1] - 1 of `points` (x, y pairs). */
export interface Polylines {
  readonly points: Float64Array;
  readonly starts: Uint32Array;
  readonly pens: Uint16Array;
}

/** One element's drawing in one view; coordinates in metres in the view's plane (origin already added). */
export interface ViewDrawing {
  /** the VirtSy object's GUID */
  readonly id: string;
  /** the element drawn (a dimension or other annotation for some interior-elevation drawings); null when not named */
  readonly element: string | null;
  /** the section, elevation, interior elevation or 3D document */
  readonly view: string | null;
  /** null when the view's class wasn't among the objects given */
  readonly viewKind: ViewKind | null;
  readonly holder: string | null;
  readonly group: string | null;
  /** where the drawing's own origin sits in the view */
  readonly origin: { readonly x: number; readonly y: number };
  /** the drawing's extent in the view; null for an empty drawing */
  readonly box: { readonly xMin: number; readonly yMin: number; readonly xMax: number; readonly yMax: number } | null;
  /** the view's scale as the drawing records it (100 for 1:100) */
  readonly scale: number;
  /** x1, y1, x2, y2 per line */
  readonly lines: Float64Array;
  readonly linePens: Uint16Array;
  /** centre x, y, radius, axis ratio (1 for a circle), main axis direction, begin and end angle per arc (radians from the x axis, counter-clockwise; equal angles: the whole circle) */
  readonly arcs: Float64Array;
  readonly arcPens: Uint16Array;
  readonly polylines: Polylines;
  readonly fills: Fills;
  /** x, y, depth per hotspot (Archicad's 3D hotspots of the element, seen in this view) */
  readonly hotspots: Float64Array;
  /** the element's own frame, local to world: 3 rows of (axis x, axis y, axis z, translation), unit axes (not always square to each other); null when not stored */
  readonly frame: Float64Array | null;
  /** text records present but not decoded */
  readonly texts: number;
}

export interface Geometry {
  readonly drawings: readonly ViewDrawing[];
  /** drawings by element GUID */
  readonly byElement: ReadonlyMap<string, readonly ViewDrawing[]>;
  /** objects that didn't decode, by class name */
  readonly problems: Record<string, number>;
}

// ---- reading -------------------------------------------------------------------------------------

const RECORD_TYPES = [2, 3, 4, 6, 11, 12] as const;
/** each record type's index among the header counts */
const COUNT_INDEX: Readonly<Record<number, number>> = { 2: 0, 3: 1, 4: 2, 6: 4, 11: 9, 12: 10 };
const HOTSPOT = 69;
const LINE = 54;
const ARC = 107;
const FILL_REF = 20;
const TEXT = 213;
const FILL_FIXED = 55;
const FILL_TAIL = 100;

/** Where a GUID (hex) next appears in d[from, to), or -1. */
function indexOf(d: Uint8Array, guid: string, from: number, to: number): number {
  const first = parseInt(guid.slice(0, 2), 16);
  for (let p = from; p + 16 <= to; p++) if (d[p] === first && hex(d, p, 16) === guid) return p;
  return -1;
}

function fail(what: string): never {
  throw new Error(what);
}

function need(d: Uint8Array, at: number, n: number): void {
  if (at < 0 || at + n > d.length) fail(`ends early (${n} bytes wanted at ${at} of ${d.length})`);
}

/** Where the vector image starts and how long it is: the 80 00 00 00 01 24 that follows 01 00 09 01 (00 00 09 01 in Archicad 25) and its length. */
function findImage(d: Uint8Array): { at: number; length: number } {
  const limit = Math.min(d.length - 8, OBJECT_DATA + 256);
  for (let p = OBJECT_DATA + 8; p < limit; p++) {
    if (d[p] !== 0x80 || d[p + 1] !== 0 || d[p + 2] !== 0 || d[p + 3] !== 0 || d[p + 4] !== 1 || d[p + 5] !== 0x24) continue;
    if (d[p - 7] !== 0 || d[p - 6] !== 9 || d[p - 5] !== 1) continue;
    const length = u32(d, p - 4);
    if (p + length > d.length) fail("vector image longer than the object");
    return { at: p, length };
  }
  return fail("no vector image");
}

/**
 * The closing references: a u32 size (of what follows it), 01 00, then tagged entries up to a 00:
 * 0x12 or 0x11, a role GUID and an object GUID; 0x01, a key GUID, a u32 count and that many GUIDs.
 */
function readRoles(d: Uint8Array): { roles: Map<string, string>; start: number } {
  if (d[d.length - 1] !== 0) fail("no reference list at the end");
  const stop = Math.max(OBJECT_DATA, d.length - (1 << 22));
  for (let at = d.length - 10; at >= stop; at--) {
    if (d[at + 4] !== 1 || d[at + 5] !== 0 || u32(d, at) !== d.length - at - 4) continue;
    const roles = new Map<string, string>();
    let p = at + 6;
    while (p < d.length - 1) {
      const tag = d[p];
      if (tag === 0x12 || tag === 0x11) {
        if (p + 33 > d.length) break;
        roles.set(hex(d, p + 1, 16), hex(d, p + 17, 16));
        p += 33;
      } else if (tag === 1) {
        if (p + 21 > d.length) break;
        p += 21 + 16 * u32(d, p + 17);
      } else break;
    }
    if (p === d.length - 1) return { roles, start: at };
  }
  return fail("no reference list at the end");
}

/**
 * What follows the vector image: in Archicad 27 and 29 three GUIDs (the element's class, then the
 * element and its owner, either order), 16 bytes, a u8 and a u16 kind; in 25 a u16 kind, three
 * GUIDs, 2 bytes and a u16. Then the drawing's origin in the view (x, y), a u16 of flags (one more
 * byte first in 25) and the element's frame (12 doubles; all zero for some).
 */
function readPlacement(d: Uint8Array, imageEnd: number, rolesAt: number, ac25: boolean): { origin: { x: number; y: number }; frame: Float64Array | null } {
  const at = imageEnd + (ac25 ? 54 : 67);
  const frameAt = at + 16 + (ac25 ? 3 : 2);
  if (frameAt + 96 > rolesAt) fail("no placement after the vector image");
  const x = f64(d, at);
  const y = f64(d, at + 8);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) fail("placement out of range");
  const m = new Float64Array(12);
  for (let i = 0; i < 12; i++) m[i] = f64(d, frameAt + 8 * i);
  if (!m.every((v) => Number.isFinite(v) && Math.abs(v) < 1e7)) fail("element frame out of range");
  // each axis a unit vector (the axes are square to each other too, except for some slanted elements)
  const row = (r: number): number => m[4 * r] * m[4 * r] + m[4 * r + 1] * m[4 * r + 1] + m[4 * r + 2] * m[4 * r + 2];
  const axes = Math.abs(row(0) - 1) < 1e-6 && Math.abs(row(1) - 1) < 1e-6 && Math.abs(row(2) - 1) < 1e-6;
  if (!axes && m.some((v) => v !== 0)) fail("element frame axes aren't unit vectors");
  return { origin: { x, y }, frame: axes ? m : null };
}

/** Points along an arc edge from (x1, y1) to (x2, y2) turning by `angle` (counter-clockwise positive), the end point excluded. */
function arcEdge(out: number[], x1: number, y1: number, x2: number, y2: number, angle: number): void {
  const chord = Math.hypot(x2 - x1, y2 - y1);
  const half = angle / 2;
  if (chord === 0 || Math.abs(Math.sin(half)) < 1e-12) {
    out.push(x1, y1);
    return;
  }
  const r = chord / (2 * Math.sin(half));
  // centre: from the chord's middle, to the left of the chord (for a positive angle) by r cos(half)
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const h = r * Math.cos(half);
  const cx = mx - ((y2 - y1) / chord) * h;
  const cy = my + ((x2 - x1) / chord) * h;
  const a0 = Math.atan2(y1 - cy, x1 - cx);
  const steps = Math.max(2, Math.ceil(Math.abs(angle) / (Math.PI / 36)));
  for (let i = 0; i < steps; i++) {
    const a = a0 + (angle * i) / steps;
    out.push(cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a));
  }
}

interface FillsBuilder {
  readonly points: number[];
  readonly contourStarts: number[];
  readonly fillContours: number[];
  readonly pens: number[];
  readonly rgb: number[];
}

/** One fill after the records, from its GUID, added to `out`; returns its GUID and where the next one starts. */
function readFill(d: Uint8Array, at: number, ox: number, oy: number, out: FillsBuilder): { guid: string; end: number } {
  need(d, at, 16 + FILL_FIXED + 4);
  const guid = hex(d, at, 16);
  const q = at + 16;
  if (d[q] !== 3) fail("unknown fill version");
  const nCoords = u32(d, q + FILL_FIXED);
  let p = q + FILL_FIXED + 4;
  need(d, p, 16 * nCoords + 6);
  const coords = p;
  p += 16 * nCoords;
  if (u16(d, p) !== 1) fail("fill: no arc list");
  const nArcs = u32(d, p + 2);
  p += 6;
  need(d, p, 16 * nArcs + 6);
  const arcs = new Map<number, number>();
  for (let i = 0; i < nArcs; i++) arcs.set(u32(d, p + 16 * i), f64(d, p + 16 * i + 8));
  p += 16 * nArcs;
  if (u16(d, p) !== 1) fail("fill: no contour list");
  const nEnds = u32(d, p + 2);
  p += 6;
  need(d, p, 4 * nEnds + FILL_TAIL + 16 + 7);
  const ends: number[] = [];
  for (let i = 0; i < nEnds; i++) ends.push(u32(d, p + 4 * i));
  p += 4 * nEnds + FILL_TAIL;
  if (hex(d, p, 16) !== guid) fail("fill: GUID not repeated");
  p += 16 + 7;
  for (let c = 1; c < ends.length; c++) if (ends[c - 1] + 1 < 1 || ends[c] >= nCoords || ends[c] < ends[c - 1] + 1) fail("fill: contour out of range");
  out.fillContours.push(out.contourStarts.length);
  out.pens.push(u16(d, q + 10));
  out.rgb.push(d[q + 38], d[q + 40], d[q + 42]);
  const pts = out.points;
  for (let c = 1; c < ends.length; c++) {
    const from = pts.length;
    // the contour repeats its first point at its end; walk its edges, expanding arcs
    for (let i = ends[c - 1] + 1; i < ends[c]; i++) {
      const x1 = f64(d, coords + 16 * i) + ox;
      const y1 = f64(d, coords + 16 * i + 8) + oy;
      const angle = arcs.get(i);
      if (angle !== undefined && angle !== 0) arcEdge(pts, x1, y1, f64(d, coords + 16 * (i + 1)) + ox, f64(d, coords + 16 * (i + 1) + 8) + oy, angle);
      else pts.push(x1, y1);
    }
    if (pts.length - from < 6) pts.length = from;
    else out.contourStarts.push(from / 2);
  }
  return { guid, end: p };
}

function packFills(b: FillsBuilder): Fills {
  return {
    points: Float64Array.from(b.points),
    contourStarts: Uint32Array.from([...b.contourStarts, b.points.length / 2]),
    fillContours: Uint32Array.from([...b.fillContours, b.contourStarts.length]),
    pens: Uint16Array.from(b.pens),
    rgb: Uint8Array.from(b.rgb),
  };
}

/** Fill k's contours as views into `fills.points` (x, y pairs), the outline first. */
export function fillContours(fills: Fills, k: number): Float64Array[] {
  const out: Float64Array[] = [];
  for (let c = fills.fillContours[k]; c < fills.fillContours[k + 1]; c++) out.push(fills.points.subarray(2 * fills.contourStarts[c], 2 * fills.contourStarts[c + 1]));
  return out;
}

/** One VirtSy object's drawing. Throws when the object doesn't read as expected. */
export function readDrawing(id: string, d: Uint8Array, viewKinds?: ReadonlyMap<string, ViewKind>): ViewDrawing {
  const image = findImage(d);
  const m = image.at;
  const imageEnd = m + image.length;
  need(d, m, 125);
  const { roles, start: rolesAt } = readRoles(d);
  if (rolesAt < imageEnd) fail("references inside the vector image");
  const ac25 = u16(d, OBJECT_DATA) < 0x10;
  const placement = readPlacement(d, imageEnd, rolesAt, ac25);
  const ox = placement.origin.x;
  const oy = placement.origin.y;

  const counts: number[] = [];
  for (let k = 0; k < 12; k++) counts.push(u32(d, m + 53 + 4 * k));
  const scale = u32(d, m + 41);
  const xMin = f64(d, m + 8);
  const yMin = f64(d, m + 16);
  const xMax = f64(d, m + 24);
  const yMax = f64(d, m + 32);
  const box = xMin <= xMax && yMin <= yMax ? { xMin: xMin + ox, yMin: yMin + oy, xMax: xMax + ox, yMax: yMax + oy } : null;

  const nLines = counts[1];
  const nArcs = counts[2];
  const nPolys = counts[10];
  const nHots = counts[0];
  if (nLines * LINE + nArcs * ARC + nHots * HOTSPOT + counts[4] * FILL_REF > image.length) fail("counts larger than the vector image");
  const lines = new Float64Array(4 * nLines);
  const linePens = new Uint16Array(nLines);
  const arcs = new Float64Array(7 * nArcs);
  const arcPens = new Uint16Array(nArcs);
  const hotspots = new Float64Array(3 * nHots);
  const polyPoints: number[] = [];
  const polyStarts = new Uint32Array(nPolys + 1);
  const polyPens = new Uint16Array(nPolys);
  const fillGuids: string[] = [];
  const seen = new Map<number, number>();
  let texts = 0;

  let p = m + 125;
  for (;;) {
    need(d, p, 5);
    const type = d[p];
    if (type === 0) {
      p += 5;
      break;
    }
    const c = p + 5;
    const i = seen.get(type) ?? 0;
    seen.set(type, i + 1);
    const ci = COUNT_INDEX[type];
    if (ci === undefined) fail(`unknown record type ${type}`);
    if (i >= counts[ci]) fail(`more type ${type} records than counted`);
    switch (type) {
      case 2:
        need(d, c, HOTSPOT);
        hotspots[3 * i] = f64(d, c + 20) + ox;
        hotspots[3 * i + 1] = f64(d, c + 28) + oy;
        hotspots[3 * i + 2] = f64(d, c + 36);
        p = c + HOTSPOT;
        break;
      case 3:
        need(d, c, LINE);
        linePens[i] = u16(d, c + 2);
        lines[4 * i] = f64(d, c + 16) + ox;
        lines[4 * i + 1] = f64(d, c + 24) + oy;
        lines[4 * i + 2] = f64(d, c + 32) + ox;
        lines[4 * i + 3] = f64(d, c + 40) + oy;
        p = c + LINE;
        break;
      case 4: {
        need(d, c, ARC);
        arcPens[i] = u16(d, c + 2);
        const v = (k: number): number => f64(d, c + 15 + 8 * k);
        arcs[7 * i] = v(0) + ox;
        arcs[7 * i + 1] = v(1) + oy;
        arcs[7 * i + 2] = v(2);
        arcs[7 * i + 3] = v(4);
        arcs[7 * i + 4] = v(3);
        arcs[7 * i + 5] = v(5);
        arcs[7 * i + 6] = v(6);
        p = c + ARC;
        break;
      }
      case 6:
        need(d, c, FILL_REF);
        fillGuids.push(hex(d, c + 4, 16));
        p = c + FILL_REF;
        break;
      case 11:
        need(d, c, TEXT);
        texts++;
        p = c + TEXT;
        break;
      case 12: {
        need(d, c, 40);
        polyPens[i] = u16(d, c + 4);
        const n = u32(d, c + 16);
        const nArcs = u32(d, c + 20);
        need(d, c + 40, 16 * n + 16 * nArcs + 2);
        const at = c + 40 + 16 * n;
        const arcs = new Map<number, number>();
        for (let k = 0; k < nArcs; k++) {
          const beg = u32(d, at + 16 * k);
          if (beg < 1 || beg >= n || u32(d, at + 16 * k + 4) !== beg + 1) fail("polyline arc out of range");
          arcs.set(beg - 1, f64(d, at + 16 * k + 8));
        }
        polyStarts[i] = polyPoints.length / 2;
        for (let k = 0; k < n; k++) {
          const x = f64(d, c + 40 + 16 * k) + ox;
          const y = f64(d, c + 48 + 16 * k) + oy;
          const angle = arcs.get(k);
          if (angle !== undefined && angle !== 0) arcEdge(polyPoints, x, y, f64(d, c + 56 + 16 * k) + ox, f64(d, c + 64 + 16 * k) + oy, angle);
          else polyPoints.push(x, y);
        }
        p = at + 16 * nArcs + 2;
        break;
      }
    }
    if (p > imageEnd) fail("records run past the vector image");
  }
  for (const t of RECORD_TYPES) if ((seen.get(t) ?? 0) !== counts[COUNT_INDEX[t]]) fail(`type ${t} records don't match their count`);

  // the fills after the records (after the fonts when there are texts): 01 00, their count, each
  polyStarts[nPolys] = polyPoints.length / 2;
  const fills: FillsBuilder = { points: [], contourStarts: [], fillContours: [], pens: [], rgb: [] };
  const nFills = fillGuids.length;
  if (nFills) {
    const first = indexOf(d, fillGuids[0], p, imageEnd);
    if (first < 0 || u32(d, first - 4) !== nFills || u16(d, first - 6) !== 1) fail("fill count doesn't match the fill records");
    p = first;
  }
  for (let k = 0; k < nFills; k++) {
    const f = readFill(d, p, ox, oy, fills);
    if (f.guid !== fillGuids[k]) fail("fills out of order");
    p = f.end;
  }
  if (p > imageEnd) fail("fills run past the vector image");

  const view = roles.get(ROLE_VIEW) ?? null;
  return {
    id,
    element: roles.get(ROLE_ELEMENT) ?? null,
    view,
    viewKind: view ? (viewKinds?.get(view) ?? null) : null,
    holder: roles.get(ROLE_HOLDER) ?? roles.get(ROLE_IE_HOLDER) ?? null,
    group: roles.get(ROLE_GROUP) ?? null,
    origin: { x: ox, y: oy },
    box,
    scale,
    lines,
    linePens,
    arcs,
    arcPens,
    polylines: { points: Float64Array.from(polyPoints), starts: polyStarts, pens: polyPens },
    fills: packFills(fills),
    hotspots,
    frame: placement.frame,
    texts,
  };
}

/** Every element's drawings in the sections, elevations, interior elevations and 3D documents of a file. */
export function readGeometry(objects: ObjectsByClass): Geometry {
  const viewKinds = new Map<string, ViewKind>();
  for (const [cls, kind] of Object.entries(VIEW_CLASSES)) for (const o of objects.get(cls) ?? []) viewKinds.set(o.guid, kind);
  const drawings: ViewDrawing[] = [];
  const byElement = new Map<string, ViewDrawing[]>();
  const problems: Record<string, number> = {};
  for (const o of objects.get(VIRTSY_CLASS) ?? []) {
    let drawing: ViewDrawing;
    try {
      drawing = readDrawing(o.guid, o.data, viewKinds);
    } catch {
      problems.VirtSy = (problems.VirtSy ?? 0) + 1;
      continue;
    }
    drawings.push(drawing);
    if (drawing.element) {
      let list = byElement.get(drawing.element);
      if (!list) byElement.set(drawing.element, (list = []));
      list.push(drawing);
    }
  }
  return { drawings, byElement, problems };
}
