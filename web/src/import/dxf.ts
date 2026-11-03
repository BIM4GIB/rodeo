// DXF import, the reading side. parseDxf (no DOM) reads an ASCII DXF drawing into its drawable
// objects in the file's own units: curves stay parametric, and blocks are expanded through their
// inserts. dxfPlacements then turns them into NewShape geometry in world units (millimetres). It reads
// what export/dxf.ts writes, plus the common AutoCAD entities; anything else is counted as skipped.
// import/dwg.ts decodes a .dwg file into the same entries, and drawingOf walks them for both.

import type { Affine, NewShape, Pt } from "../core/types.ts";

/** Most objects one drawing may expand to, blocks and arrays included. */
const MAX_OBJECTS = 100_000;
/** Deepest block nesting that is expanded; deeper inserts are skipped. */
const MAX_DEPTH = 8;
/** Angle step when a bulge or an ellipse is sampled into a polyline, in degrees. */
const STEP_DEG = 8;
const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
/** A DXF text height is the cap height, about 0.72 of the em that openvwx stores as text size (see export/dxf.ts). */
const CAP_HEIGHT = 0.72;
/** A dot in a line type, in paper inches, when it becomes a Rodeo line type. */
const DOT = 0.01;
/** Most dash and gap pairs a Rodeo line type holds (see writeLineType). */
const MAX_PAIRS = 5;
/** Most dashes one hatch's pattern may be cut into; a denser one is skipped. */
const MAX_STROKES = 50_000;
const BLACK = 0x000000;

/** Millimetres per unit for each $INSUNITS code. Unset (0) and unknown codes count as millimetres. */
const MM_PER_INSUNITS: Readonly<Record<number, number>> = {
  1: 25.4, // inches
  2: 304.8, // feet
  3: 1609344, // miles
  4: 1, // millimetres
  5: 10, // centimetres
  6: 1000, // metres
  7: 1e6, // kilometres
  8: 2.54e-5, // microinches
  9: 0.0254, // mils
  10: 914.4, // yards
  11: 1e-7, // angstroms
  12: 1e-6, // nanometres
  13: 0.001, // microns
  14: 100, // decimetres
  15: 1e4, // decametres
  16: 1e5, // hectometres
  17: 1e12, // gigametres
};

/** AutoCAD's index colours (ACI) 1 to 255 as 0xRRGGBB, at their own index; 0 and 256 mean by block and by layer. */
const ACI: readonly number[] = aciColors();

function aciColors(): number[] {
  const out = [BLACK, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  // 10 to 249: 24 hues 15° apart, each at five brightnesses, at full and at half saturation
  const values = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i < 250; i++) {
    const j = (i - 10) % 10;
    out.push(hsv(Math.floor((i - 10) / 10) * 15, j % 2 === 0 ? 1 : 0.5, 255 * values[j >> 1]));
  }
  out.push(0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff);
  return out;
}

/** A colour from hue (degrees), saturation (0..1) and value (0..255), each channel rounded down as AutoCAD's table is. */
function hsv(h: number, s: number, v: number): number {
  const ch = (n: number): number => {
    const k = (n + h / 60) % 6;
    return Math.floor(v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return (ch(5) << 16) | (ch(3) << 8) | ch(1);
}

/** An index colour as 0xRRGGBB. 7 is white on AutoCAD's black screen and black on paper, as here. */
export function aciColor(index: number): number {
  return index === 7 ? BLACK : (ACI[Math.abs(Math.round(index))] ?? BLACK);
}

/** DXF TEXT horizontal justification (group 72) to openvwx alignment: 1 left, 2 centre, 3 right. */
const H_ALIGN: Readonly<Record<number, number>> = { 0: 1, 1: 2, 2: 3, 3: 1, 4: 2, 5: 1 };
/** DXF TEXT vertical justification (group 73) to openvwx alignment: 1 top, 2 top baseline, 3 centre, 5 bottom. */
const V_ALIGN: Readonly<Record<number, number>> = { 0: 2, 1: 5, 2: 3, 3: 1 };

/**
 * A drawable object in the file's units. Curves are arcs (radiusY set when they are elliptical;
 * angles are then parametric) or sampled polylines.
 */
export type DxfShape =
  | { readonly kind: "point"; readonly at: Pt }
  | { readonly kind: "line"; readonly a: Pt; readonly b: Pt }
  | { readonly kind: "polyline"; readonly points: readonly Pt[]; readonly closed: boolean }
  | {
      readonly kind: "arc";
      readonly center: Pt;
      readonly radius: number;
      readonly radiusY?: number;
      /** degrees, counter-clockwise from +x */
      readonly startAngle: number;
      readonly sweepAngle: number;
    }
  | {
      readonly kind: "text";
      readonly at: Pt;
      readonly text: string;
      /** DXF text height (cap height), in file units */
      readonly height: number;
      /** degrees, counter-clockwise from +x */
      readonly rotation: number;
      /** openvwx alignment, see H_ALIGN and V_ALIGN */
      readonly hAlign: number;
      readonly vAlign: number;
    }
  /** an area filled in the entity's colour: its loops, even-odd (a hole is a loop inside another) */
  | { readonly kind: "fill"; readonly rings: readonly (readonly Pt[])[] }
  /** a hatch pattern's lines, cut to its dashes */
  | { readonly kind: "strokes"; readonly segments: readonly (readonly [Pt, Pt])[] };

/** A line type's name and its pattern: dashes (positive), gaps (negative) and dots (0), in file units. */
export interface DxfLineType {
  readonly name: string;
  readonly dashes: readonly number[];
}

/** How an entity draws, from its own settings, its layer's and the insert's it is in. */
export interface DxfStyle {
  /** 0xRRGGBB */
  readonly color: number;
  /** pen weight in millimetres; null for the drawing's default */
  readonly weight: number | null;
  /** null when continuous */
  readonly lineType: DxfLineType | null;
}

export interface DxfEntity {
  /** the DXF entity type it came from, e.g. "LWPOLYLINE" */
  readonly type: string;
  /** the DXF layer name ("0" when the file gives none) */
  readonly layer: string;
  readonly shape: DxfShape;
  readonly style: DxfStyle;
}

export interface DxfDrawing {
  readonly entities: readonly DxfEntity[];
  /** objects left out, counted by DXF type ("HATCH", "DIMENSION", ...) */
  readonly skipped: Readonly<Record<string, number>>;
  /** millimetres per file unit, from $INSUNITS */
  readonly mmPerUnit: number;
  /** the layers that are off or frozen, by upper-case name: what is on them is not shown */
  readonly hiddenLayers: ReadonlySet<string>;
}

/** A layer's own colour, line type and weight, and whether it is shown. */
export interface DxfLayer {
  /** 0xRRGGBB */
  readonly color: number;
  /** its line type's name; "" for continuous */
  readonly lineType: string;
  /** hundredths of a millimetre; negative for the drawing's default */
  readonly weight: number;
  /** false when it is off or frozen */
  readonly shown: boolean;
}

/** What the tables give the entities: layers and line types by upper-case name, and $LTSCALE. */
export interface DxfTables {
  readonly layers: ReadonlyMap<string, DxfLayer>;
  readonly lineTypes: ReadonlyMap<string, DxfLineType>;
  /** the drawing's line type scale */
  readonly ltscale: number;
}

const NO_TABLES: DxfTables = { layers: new Map(), lineTypes: new Map(), ltscale: 1 };
/** How an entity draws when nothing says otherwise, and what by block means outside any insert. */
const PLAIN: DxfStyle = { color: BLACK, weight: null, lineType: null };

// ---- reading the file -------------------------------------------------------------

/** A group code and its value. */
export interface Pair {
  readonly code: number;
  readonly value: string;
}

/** An entity or table record: its type and the pairs after it. */
export interface Entry {
  readonly type: string;
  readonly pairs: Pair[];
}

/** A block definition: its base point and the entities in it. */
export interface Block {
  readonly base: Pt;
  readonly entries: readonly Entry[];
}

interface Vertex {
  readonly p: Pt;
  readonly bulge: number;
}

/** Where the entities being read sit: the transform into file units, the layer they inherit and the block depth. */
interface Place {
  readonly m: Affine;
  /** layer of the INSERT that brought them in, or null at the top level */
  readonly layer: string | null;
  readonly depth: number;
  /** how the INSERT that brought them in draws, which is what their by block settings take */
  readonly byBlock: DxfStyle;
}

interface Walk {
  readonly blocks: ReadonlyMap<string, Block>;
  readonly tables: DxfTables;
  readonly entities: DxfEntity[];
  readonly skipped: Record<string, number>;
  /** block copies made so far, arrays included */
  copies: number;
}

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Reads an ASCII DXF drawing. Throws when the text is not a DXF drawing at all. */
export function parseDxf(text: string): DxfDrawing {
  const sections = sectionsOf(readPairs(text));
  if (sections.size === 0) throw new Error("no SECTION found, so this is not a DXF drawing");
  const header = sections.get("HEADER");
  return drawingOf(
    entriesOf(sections.get("ENTITIES") ?? []),
    blocksOf(entriesOf(sections.get("BLOCKS") ?? [])),
    insUnits(header),
    tablesOf(entriesOf(sections.get("TABLES") ?? []), headerNum(header, "$LTSCALE", 40, 1)),
  );
}

/**
 * The drawable objects of a run of entities, with blocks (by upper-case name) expanded through their
 * inserts. `insunits` is the drawing's $INSUNITS code. parseDxf and parseDwg both end here.
 */
export function drawingOf(entities: readonly Entry[], blocks: ReadonlyMap<string, Block>, insunits: number, tables: DxfTables = NO_TABLES): DxfDrawing {
  const w: Walk = { blocks, tables, entities: [], skipped: {}, copies: 0 };
  readEntries(entities, w, { m: IDENTITY, layer: null, depth: 0, byBlock: PLAIN });
  const hiddenLayers = new Set([...tables.layers].filter(([, l]) => !l.shown).map(([name]) => name));
  return { entities: w.entities, skipped: w.skipped, mmPerUnit: MM_PER_INSUNITS[insunits] ?? 1, hiddenLayers };
}

/** Group code / value pairs: the lines alternate, a code line then its value. */
function readPairs(text: string): Pair[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    if (!/^-?\d+$/.test(code)) throw new Error(`not an ASCII DXF file (line ${i + 1} should hold a group code)`);
    pairs.push({ code: Number(code), value: lines[i + 1] });
  }
  return pairs;
}

/** True for a pair that starts an entity or section with this name (group code 0). */
function isMarker(p: Pair, name: string): boolean {
  return p.code === 0 && p.value.trim().toUpperCase() === name;
}

/** The pairs of each SECTION, by name (HEADER, BLOCKS, ENTITIES, ...). */
function sectionsOf(pairs: readonly Pair[]): Map<string, Pair[]> {
  const out = new Map<string, Pair[]>();
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (!isMarker(pairs[i], "SECTION") || pairs[i + 1].code !== 2) continue;
    const body: Pair[] = [];
    let j = i + 2;
    while (j < pairs.length && !isMarker(pairs[j], "ENDSEC")) body.push(pairs[j++]);
    out.set(pairs[i + 1].value.trim().toUpperCase(), body);
    i = j;
  }
  return out;
}

/** Splits a section's pairs into entries, each starting at a group code 0. */
function entriesOf(pairs: readonly Pair[]): Entry[] {
  const out: Entry[] = [];
  for (const p of pairs) {
    if (p.code === 0) out.push({ type: p.value.trim().toUpperCase(), pairs: [] });
    else out[out.length - 1]?.pairs.push(p);
  }
  return out;
}

/** The blocks of the BLOCKS section, by upper-case name (DXF block names do not match case). */
function blocksOf(list: readonly Entry[]): Map<string, Block> {
  const out = new Map<string, Block>();
  let name = "";
  let base: Pt = { x: 0, y: 0 };
  let body: Entry[] | null = null;
  for (const e of list) {
    if (e.type === "BLOCK") {
      name = (rawOf(e, 2) ?? "").trim().toUpperCase();
      base = pointOf(e, 10) ?? { x: 0, y: 0 };
      body = [];
    } else if (e.type === "ENDBLK") {
      if (body) out.set(name, { base, entries: body });
      body = null;
    } else {
      body?.push(e);
    }
  }
  return out;
}

/** $INSUNITS from the HEADER section; 0 when it is not set. */
function insUnits(header: readonly Pair[] | undefined): number {
  return Math.round(headerNum(header, "$INSUNITS", 70, 0));
}

/** A header variable's number in group `code`; the fallback when it is not set. */
function headerNum(header: readonly Pair[] | undefined, name: string, code: number, fallback: number): number {
  if (!header) return fallback;
  for (let i = 0; i < header.length; i++) {
    if (header[i].code !== 9 || header[i].value.trim().toUpperCase() !== name) continue;
    for (let j = i + 1; j < header.length && header[j].code !== 9; j++) {
      const n = parseNum(header[j].value);
      if (header[j].code === code && Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

/** The LAYER and LTYPE records of the TABLES section. */
function tablesOf(list: readonly Entry[], ltscale: number): DxfTables {
  const layers = new Map<string, DxfLayer>();
  const lineTypes = new Map<string, DxfLineType>();
  for (const e of list) {
    const name = (rawOf(e, 2) ?? "").trim();
    if (!name) continue;
    if (e.type === "LAYER") {
      // a negative colour is a layer turned off; flag 1 is a frozen one
      const aci = numOf(e, 62, 7);
      layers.set(name.toUpperCase(), {
        color: hasCode(e, 420) ? numOf(e, 420) & 0xffffff : aciColor(aci),
        lineType: (rawOf(e, 6) ?? "").trim(),
        weight: Math.round(numOf(e, 370, -3)),
        shown: aci >= 0 && (numOf(e, 70) & 1) === 0,
      });
    } else if (e.type === "LTYPE") {
      lineTypes.set(name.toUpperCase(), { name, dashes: e.pairs.filter((p) => p.code === 49).map((p) => parseNum(p.value)).filter(Number.isFinite) });
    }
  }
  return { layers, lineTypes, ltscale: ltscale > 0 ? ltscale : 1 };
}

// ---- entry access -----------------------------------------------------------------

/** A number from text, or NaN when it is not one. */
function parseNum(text: string): number {
  const t = text.trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : NaN;
}

/** The value of the first pair with this group code, or undefined. */
function rawOf(e: Entry, code: number): string | undefined {
  return e.pairs.find((p) => p.code === code)?.value;
}

function hasCode(e: Entry, code: number): boolean {
  return e.pairs.some((p) => p.code === code);
}

/** A number from the first pair with this group code; the fallback when it is missing or not a number. */
function numOf(e: Entry, code: number, fallback = 0): number {
  const n = parseNum(rawOf(e, code) ?? "");
  return Number.isFinite(n) ? n : fallback;
}

/** The point in group codes x and x + 10 (y), or null when either is missing. */
function pointOf(e: Entry, code: number): Pt | null {
  if (!hasCode(e, code) || !hasCode(e, code + 10)) return null;
  const x = parseNum(rawOf(e, code) ?? "");
  const y = parseNum(rawOf(e, code + 10) ?? "");
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** The layer an entity is on: its own, or the layer of the INSERT when it is on layer 0 inside a block. */
function layerOf(e: Entry, inherited: string | null): string {
  const own = (rawOf(e, 8) ?? "0").trim() || "0";
  return own === "0" && inherited !== null ? inherited : own;
}

// ---- walking the entities -----------------------------------------------------------

/** Reads a run of entities (a section or a block body) into the walk, placed as `place` says. */
function readEntries(list: readonly Entry[], w: Walk, place: Place): void {
  let i = 0;
  while (i < list.length) {
    const e = list[i];
    let kids: Entry[] = [];
    let next = i + 1;
    if (e.type === "POLYLINE") {
      ({ kids, next } = takeKids(list, i + 1, "VERTEX"));
    } else if (e.type === "INSERT" && numOf(e, 66) === 1) {
      ({ kids, next } = takeKids(list, i + 1, "ATTRIB"));
    }
    i = next;
    // paper space entities are not part of the drawing
    if (numOf(e, 67) === 1) {
      skip(w, "PAPER SPACE");
      continue;
    }
    // invisible entities (a dynamic block's other visibility states, for one) are not drawn
    if (numOf(e, 60) === 1) continue;
    readOne(e, kids, w, place);
  }
}

/** The entries of one kind that follow an entity, and the index after them (and after their SEQEND). */
function takeKids(list: readonly Entry[], from: number, kind: string): { kids: Entry[]; next: number } {
  const kids: Entry[] = [];
  let j = from;
  while (j < list.length && list[j].type === kind) kids.push(list[j++]);
  if (j < list.length && list[j].type === "SEQEND") j++;
  return { kids, next: j };
}

/** Entities whose coordinates are in their object coordinate system (OCS), set by the extrusion 210/220/230. */
const IN_OCS = new Set(["ARC", "CIRCLE", "LWPOLYLINE", "POLYLINE", "TEXT", "ATTRIB", "INSERT", "SOLID", "TRACE", "DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION", "ACAD_TABLE", "HATCH"]);

function readOne(e: Entry, kids: readonly Entry[], w: Walk, place: Place): void {
  // a 3D polyline (flag 8) is in world coordinates, like LINE and the rest
  const ocs = IN_OCS.has(e.type) && !(e.type === "POLYLINE" && (numOf(e, 70) & 8) !== 0) ? ocsOf(e) : null;
  const m = ocs ? compose(place.m, ocs) : place.m;
  const layer = layerOf(e, place.layer);
  const style = styleOf(e, layer, place, w);
  switch (e.type) {
    case "POINT": {
      const at = pointOf(e, 10);
      push(w, e.type, layer, at ? { kind: "point", at: applyPt(m, at) } : null, style);
      return;
    }
    case "LINE": {
      const a = pointOf(e, 10);
      const b = pointOf(e, 11);
      push(w, e.type, layer, a && b ? lineShape(m, a, b) : null, style);
      return;
    }
    case "LWPOLYLINE": {
      const closed = (numOf(e, 70) & 1) === 1;
      push(w, e.type, layer, polylineShape(m, tracePoints(lwVertices(e), closed), closed), style);
      return;
    }
    case "POLYLINE": {
      // polygon meshes and polyface meshes are not outlines
      if ((numOf(e, 70) & (16 | 64)) !== 0) {
        skip(w, e.type);
        return;
      }
      const closed = (numOf(e, 70) & 1) === 1;
      const verts: Vertex[] = [];
      for (const v of kids) {
        // a spline-fit polyline keeps its frame's control points (flag 16) beside the fitted vertices
        if ((numOf(v, 70) & 16) !== 0) continue;
        const p = pointOf(v, 10);
        if (p) verts.push({ p, bulge: numOf(v, 42) });
      }
      push(w, e.type, layer, polylineShape(m, tracePoints(verts, closed), closed), style);
      return;
    }
    case "SOLID":
    case "TRACE": {
      // the corners go 1, 2, 4, 3 around the outline; a triangle repeats its third corner as the fourth
      const pts = [pointOf(e, 10), pointOf(e, 11), pointOf(e, 13), pointOf(e, 12)].filter((p): p is Pt => p !== null);
      const outline = pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));
      if (outline.length > 1 && same(outline[0], outline[outline.length - 1])) outline.pop();
      push(w, e.type, layer, outline.length >= 3 ? { kind: "fill", rings: [outline.map((p) => applyPt(m, p))] } : null, style);
      return;
    }
    case "SPLINE":
      push(w, e.type, layer, splineShape(m, e), style);
      return;
    case "LEADER": {
      // the leader's line; its arrowhead and annotation are objects of their own or left out
      const pts = e.pairs.filter((p) => p.code === 10).length;
      push(w, e.type, layer, pts >= 2 ? polylineShape(m, tracePoints(lwVertices(e), false), false) : null, style);
      return;
    }
    case "DIMENSION":
    case "ARC_DIMENSION":
    case "LARGE_RADIAL_DIMENSION":
      dimension(w, place, m, e, layer, style);
      return;
    case "CIRCLE": {
      const c = pointOf(e, 10);
      const r = numOf(e, 40);
      push(w, e.type, layer, c && r > 0 ? curveOn(m, c, { x: r, y: 0 }, { x: 0, y: r }, 0, TWO_PI) : null, style);
      return;
    }
    case "ARC": {
      const c = pointOf(e, 10);
      const r = numOf(e, 40);
      const start = numOf(e, 50);
      const span = sweepRad(start, numOf(e, 51));
      push(w, e.type, layer, c && r > 0 ? curveOn(m, c, { x: r, y: 0 }, { x: 0, y: r }, start * DEG, span) : null, style);
      return;
    }
    case "ELLIPSE": {
      // the major axis end (11) is relative to the centre; the minor axis is a quarter turn of it, scaled by the ratio
      const c = pointOf(e, 10);
      const major = pointOf(e, 11);
      const ratio = numOf(e, 40, 1);
      const t0 = numOf(e, 41, 0);
      let span = numOf(e, 42, TWO_PI) - t0;
      while (span <= 0) span += TWO_PI;
      span = Math.min(span, TWO_PI);
      const minor = major ? { x: -major.y * ratio, y: major.x * ratio } : null;
      push(w, e.type, layer, c && major && minor ? curveOn(m, c, major, minor, t0, span) : null, style);
      return;
    }
    case "TEXT":
    case "MTEXT":
    case "ATTRIB":
      addText(w, m, e, layer, style);
      return;
    case "HATCH":
      hatch(w, m, e, layer, style);
      return;
    case "INSERT":
      insert(w, place, m, e, layer, kids, style);
      return;
    case "ACAD_TABLE":
      // a table draws as an insert of its anonymous block, which holds its lines and cell text
      insert(w, place, m, e, layer, [], style);
      return;
    // definitions and sequence markers, not objects of their own
    case "ATTDEF":
    case "VERTEX":
    case "SEQEND":
    case "BLOCK":
    case "ENDBLK":
      return;
    default:
      skip(w, e.type);
  }
}

/** Radians swept counter-clockwise from one angle (degrees) to another; a full turn when they are equal. */
function sweepRad(startDeg: number, endDeg: number): number {
  const deg = (((endDeg - startDeg) % 360) + 360) % 360;
  return (deg === 0 ? 360 : deg) * DEG;
}

function skip(w: Walk, type: string): void {
  w.skipped[type] = (w.skipped[type] ?? 0) + 1;
}

function push(w: Walk, type: string, layer: string, shape: DxfShape | null, style: DxfStyle): void {
  if (!shape) {
    skip(w, type);
    return;
  }
  if (w.entities.length >= MAX_OBJECTS) throw new Error(`the drawing has more than ${MAX_OBJECTS} objects`);
  w.entities.push({ type, layer, shape, style });
}

/**
 * How an entity draws. Its colour is a true colour (420), an index colour (62), its insert's (0)
 * or its layer's (256, or none given); its weight (370, hundredths of a millimetre) its own, its
 * layer's (-1), its insert's (-2) or the default (-3); its line type (6) by name, by layer or by
 * block, with its dashes scaled by $LTSCALE and its own scale (48).
 */
function styleOf(e: Entry, layer: string, place: Place, w: Walk): DxfStyle {
  const own = w.tables.layers.get(layer.toUpperCase());
  const aci = Math.round(numOf(e, 62, 256));
  const color =
    aci === 0 ? place.byBlock.color : hasCode(e, 420) ? numOf(e, 420) & 0xffffff : aci >= 1 && aci <= 255 ? aciColor(aci) : (own?.color ?? BLACK);
  const lw = Math.round(numOf(e, 370, -1));
  const weight = lw >= 0 ? lw / 100 : lw === -2 ? place.byBlock.weight : lw === -1 && own && own.weight >= 0 ? own.weight / 100 : null;
  const name = (rawOf(e, 6) ?? "BYLAYER").trim();
  const key = name.toUpperCase();
  const lineType = key === "BYBLOCK" ? place.byBlock.lineType : lineTypeOf(w, key === "BYLAYER" ? (own?.lineType ?? "") : name, numOf(e, 48, 1));
  return { color, weight, lineType };
}

/** The named line type at this scale (times $LTSCALE); null for a continuous or unknown one, or one with no dashes. */
function lineTypeOf(w: Walk, name: string, scale: number): DxfLineType | null {
  const lt = w.tables.lineTypes.get(name.trim().toUpperCase());
  if (!lt || !lt.dashes.some((d) => d !== 0)) return null;
  const k = w.tables.ltscale * (scale > 0 ? scale : 1);
  return k === 1 ? lt : { name: lt.name, dashes: lt.dashes.map((d) => d * k) };
}

/**
 * An INSERT, or a MINSERT array of copies, expanded in place. Each copy is the block moved so its
 * base point is at the origin, scaled, turned and moved to the insertion point, all in the insert's
 * OCS (m is the place's transform after it). Its ATTRIB values are placed as text at their own
 * points, so only the outer transform and their own OCS apply to them.
 */
function insert(w: Walk, place: Place, m: Affine, e: Entry, layer: string, attribs: readonly Entry[], style: DxfStyle): void {
  const block = w.blocks.get((rawOf(e, 2) ?? "").trim().toUpperCase());
  if (!block || place.depth >= MAX_DEPTH) {
    skip(w, e.type);
    return;
  }
  const at = pointOf(e, 10) ?? { x: 0, y: 0 };
  const sx = numOf(e, 41, 1);
  const sy = numOf(e, 42, 1);
  // a table in a DXF file has no 50: its horizontal direction (11) turns it instead
  const dir = e.type === "ACAD_TABLE" && !hasCode(e, 50) ? pointOf(e, 11) : null;
  const rot = dir ? Math.atan2(dir.y, dir.x) : numOf(e, 50) * DEG;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const cols = Math.max(1, Math.round(numOf(e, 70, 1)));
  const rows = Math.max(1, Math.round(numOf(e, 71, 1)));
  const colGap = numOf(e, 44);
  const rowGap = numOf(e, 45);
  const a = cs * sx;
  const b = sn * sx;
  const c = -sn * sy;
  const d = cs * sy;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // array steps are in the turned frame of the insert
      const gx = i * colGap;
      const gy = j * rowGap;
      const local: Affine = {
        a,
        b,
        c,
        d,
        e: at.x + cs * gx - sn * gy - (a * block.base.x + c * block.base.y),
        f: at.y + sn * gx + cs * gy - (b * block.base.x + d * block.base.y),
      };
      w.copies++;
      if (w.copies > MAX_OBJECTS) throw new Error(`the drawing has more than ${MAX_OBJECTS} block copies`);
      readEntries(block.entries, w, { m: compose(m, local), layer, depth: place.depth + 1, byBlock: style });
    }
  }
  for (const att of attribs) {
    // invisible attributes are not drawn
    if ((numOf(att, 70) & 1) !== 0) continue;
    const ocs = ocsOf(att);
    const attLayer = layerOf(att, layer);
    addText(w, ocs ? compose(place.m, ocs) : place.m, att, attLayer, styleOf(att, attLayer, { ...place, byBlock: style }, w));
  }
}

/**
 * A DIMENSION as AutoCAD drew it: the anonymous block named in group 2 holds its lines, arrowheads
 * and text, placed at the clone insertion point (12/22), which is the origin for most. A dimension
 * whose block is missing is skipped.
 */
function dimension(w: Walk, place: Place, m: Affine, e: Entry, layer: string, style: DxfStyle): void {
  const block = w.blocks.get((rawOf(e, 2) ?? "").trim().toUpperCase());
  if (!block || place.depth >= MAX_DEPTH) {
    skip(w, e.type);
    return;
  }
  const at = pointOf(e, 12) ?? { x: 0, y: 0 };
  w.copies++;
  if (w.copies > MAX_OBJECTS) throw new Error(`the drawing has more than ${MAX_OBJECTS} block copies`);
  const local: Affine = { a: 1, b: 0, c: 0, d: 1, e: at.x - block.base.x, f: at.y - block.base.y };
  readEntries(block.entries, w, { m: compose(m, local), layer, depth: place.depth + 1, byBlock: style });
}

/** One line family of a hatch pattern: its angle (degrees), a point it passes through, the step to the next line and its dashes. */
interface PatternLine {
  readonly angle: number;
  readonly base: Pt;
  readonly offset: Pt;
  readonly dashes: readonly number[];
}

/**
 * A HATCH: filled in its colour when it is solid, or in a gradient's first colour; otherwise its
 * pattern's lines cut to its loops (even-odd) and to their dashes. Its loops and pattern are in
 * its OCS, at the size and angle it was drawn with.
 */
function hatch(w: Walk, m: Affine, e: Entry, layer: string, style: DxfStyle): void {
  let read: { rings: Pt[][]; lines: PatternLine[] } | null;
  try {
    read = hatchOf(e);
  } catch {
    read = null;
  }
  const rings = read?.rings.filter((r) => r.length >= 3) ?? [];
  if (!read || rings.length === 0) {
    skip(w, e.type);
    return;
  }
  const gradient = numOf(e, 450) === 1;
  if (numOf(e, 70) === 1 || gradient) {
    const color = gradient ? gradientColor(e) : null;
    push(w, e.type, layer, { kind: "fill", rings: rings.map((r) => r.map((p) => applyPt(m, p))) }, { ...style, color: color ?? style.color, lineType: null });
    return;
  }
  const segments = patternStrokes(rings, read.lines, MAX_STROKES);
  const shape: DxfShape | null =
    segments && segments.length > 0 ? { kind: "strokes", segments: segments.map(([a, b]): [Pt, Pt] => [applyPt(m, a), applyPt(m, b)]) } : null;
  push(w, e.type, layer, shape, { ...style, lineType: null });
}

/** A gradient's first colour: the 421 true colour, else the 63 index colour, after its first 463 and before the next; or null. */
function gradientColor(e: Entry): number | null {
  const from = e.pairs.findIndex((p) => p.code === 463);
  let index: number | null = null;
  for (let i = from + 1; from >= 0 && i < e.pairs.length && e.pairs[i].code !== 463; i++) {
    const n = parseNum(e.pairs[i].value);
    if (!Number.isFinite(n)) continue;
    if (e.pairs[i].code === 421) return n & 0xffffff;
    if (e.pairs[i].code === 63 && n >= 1 && n <= 255) index = aciColor(n);
  }
  return index;
}

/**
 * A HATCH's loops and pattern lines, read in order after its loop count (91). Each loop is a
 * polyline with bulges, or a chain of edges: lines (1), circular arcs (2), elliptical arcs (3) and
 * splines (4). A clockwise arc's angles are stored mirrored (360 minus each). Throws when the
 * groups are not in the order a HATCH has them.
 */
function hatchOf(e: Entry): { rings: Pt[][]; lines: PatternLine[] } {
  const ps = e.pairs;
  let i = ps.findIndex((p) => p.code === 91);
  if (i < 0) throw new Error("no loops");
  const num = (code: number): number => {
    const n = ps[i]?.code === code ? parseNum(ps[i].value) : NaN;
    if (!Number.isFinite(n)) throw new Error(`group ${code} expected`);
    i++;
    return n;
  };
  const opt = (code: number, fallback: number): number => (ps[i]?.code === code ? num(code) : fallback);
  const pt = (x: number, y: number): Pt => ({ x: num(x), y: num(y) });
  const rings: Pt[][] = [];
  const loops = num(91);
  for (let k = 0; k < loops; k++) {
    const flags = num(92);
    if ((flags & 2) !== 0) {
      const bulged = num(72) !== 0;
      opt(73, 1);
      const n = num(93);
      const verts: Vertex[] = [];
      for (let j = 0; j < n; j++) {
        const p = pt(10, 20);
        verts.push({ p, bulge: bulged ? opt(42, 0) : 0 });
      }
      rings.push(tracePoints(verts, true));
    } else {
      const n = num(93);
      const pieces: Pt[][] = [];
      for (let j = 0; j < n; j++) {
        const kind = num(72);
        if (kind === 1) {
          pieces.push([pt(10, 20), pt(11, 21)]);
        } else if (kind === 2 || kind === 3) {
          const c = pt(10, 20);
          const major = kind === 3 ? pt(11, 21) : null;
          const r = num(40);
          const s0 = num(50);
          const s1 = num(51);
          const ccw = opt(73, 1) !== 0;
          // an elliptical arc's 40 is its minor axis over its major; a circular one's its radius
          const u = major ?? { x: r, y: 0 };
          const v = major ? { x: -major.y * r, y: major.x * r } : { x: 0, y: r };
          pieces.push(edgeArc(c, u, v, ccw ? s0 : 360 - s0, ccw ? s1 : 360 - s1, ccw));
        } else if (kind === 4) {
          const degree = num(94);
          const rational = opt(73, 0) !== 0;
          opt(74, 0);
          const nk = num(95);
          const nc = num(96);
          const knots: number[] = [];
          for (let q = 0; q < nk; q++) knots.push(num(40));
          const ctrl: Pt[] = [];
          const weights: number[] = [];
          for (let q = 0; q < nc; q++) {
            ctrl.push(pt(10, 20));
            if (rational) weights.push(opt(42, 1));
          }
          // fit points, from 2010 (a loop's own 97, its source objects, comes after its last edge)
          const fit: Pt[] = [];
          let t0: Pt | null = null;
          let t1: Pt | null = null;
          if (ps[i]?.code === 97 && [11, 12, 72, 97].includes(ps[i + 1]?.code ?? -1)) {
            const nf = num(97);
            for (let q = 0; q < nf; q++) fit.push(pt(11, 21));
            if (ps[i]?.code === 12) t0 = pt(12, 22);
            if (ps[i]?.code === 13) t1 = pt(13, 23);
          }
          const pts =
            (ctrl.length >= 2 ? nurbsPoints(ctrl, knots, weights.length === ctrl.length ? weights : [], Math.max(1, degree)) : null) ??
            (fit.length >= 2 ? (fitPoints(fit, t0, t1) ?? throughPoints(fit, false)) : null);
          if (!pts) throw new Error("a spline edge without points");
          pieces.push(pts);
        } else {
          throw new Error(`edge type ${kind}`);
        }
      }
      rings.push(chain(pieces));
    }
    // the objects the loop was made from
    const sources = opt(97, 0);
    for (let j = 0; j < sources && ps[i]?.code === 330; j++) i++;
  }
  const lines: PatternLine[] = [];
  opt(75, 0);
  opt(76, 1);
  if (numOf(e, 70) !== 1) {
    opt(52, 0);
    opt(41, 1);
    opt(77, 0);
    const count = opt(78, 0);
    for (let k = 0; k < count; k++) {
      const angle = num(53);
      const base = pt(43, 44);
      const offset = pt(45, 46);
      const n = opt(79, 0);
      const dashes: number[] = [];
      for (let j = 0; j < n; j++) dashes.push(num(49));
      lines.push({ angle, base, offset, dashes });
    }
  }
  return { rings, lines };
}

/** An arc edge's points: c + u cos t + v sin t from `from` to `to` (degrees), counter-clockwise, or clockwise when `ccw` is false. */
function edgeArc(c: Pt, u: Pt, v: Pt, from: number, to: number, ccw: boolean): Pt[] {
  let span = ccw ? to - from : from - to;
  span = ((span % 360) + 360) % 360;
  if (span === 0) span = 360;
  const steps = Math.max(2, Math.ceil(span / STEP_DEG));
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = (from + ((ccw ? span : -span) * k) / steps) * DEG;
    out.push({ x: c.x + u.x * Math.cos(t) + v.x * Math.sin(t), y: c.y + u.y * Math.cos(t) + v.y * Math.sin(t) });
  }
  return out;
}

/** A loop's edges joined end to end, each turned round when its far end is the one that meets the last. */
function chain(pieces: readonly Pt[][]): Pt[] {
  const d2 = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const out: Pt[] = [];
  pieces.forEach((piece, k) => {
    let run = piece;
    if (k === 0 && pieces.length > 1) {
      // the first edge runs towards whichever end of the second it is nearer
      const next = pieces[1];
      const end = piece[piece.length - 1];
      const start = piece[0];
      const near = (p: Pt): number => Math.min(d2(p, next[0]), d2(p, next[next.length - 1]));
      if (near(start) < near(end)) run = [...piece].reverse();
    } else if (out.length > 0 && d2(out[out.length - 1], piece[piece.length - 1]) < d2(out[out.length - 1], piece[0])) {
      run = [...piece].reverse();
    }
    for (const p of run) if (out.length === 0 || !same(out[out.length - 1], p)) out.push(p);
  });
  if (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

/**
 * A hatch pattern's lines over loops (even-odd), cut to their dashes: each line family runs
 * through its base point at its angle, the next line one offset on, and its dashes repeat from
 * where each line starts. A dot (a 0 dash) is a short dash. Null when there would be more than `max`.
 */
function patternStrokes(rings: readonly Pt[][], lines: readonly PatternLine[], max: number): [Pt, Pt][] | null {
  const out: [Pt, Pt][] = [];
  for (const fam of lines) {
    const u = { x: Math.cos(fam.angle * DEG), y: Math.sin(fam.angle * DEG) };
    const n = { x: -u.y, y: u.x };
    // how far apart the lines lie, across them
    const step = fam.offset.x * n.x + fam.offset.y * n.y;
    if (!(Math.abs(step) > 1e-12)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rings) {
      for (const q of r) {
        const k = ((q.x - fam.base.x) * n.x + (q.y - fam.base.y) * n.y) / step;
        lo = Math.min(lo, k);
        hi = Math.max(hi, k);
      }
    }
    if (Math.floor(hi) - Math.ceil(lo) > max) return null;
    const period = fam.dashes.reduce((sum, d) => sum + Math.abs(d), 0);
    const dot = period / 50;
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
      const q = { x: fam.base.x + k * fam.offset.x, y: fam.base.y + k * fam.offset.y };
      const along = (t: number): Pt => ({ x: q.x + u.x * t, y: q.y + u.y * t });
      // where line k crosses the loops, along it from q
      const at: number[] = [];
      for (const r of rings) {
        for (let i = 0; i < r.length; i++) {
          const a = r[i];
          const b = r[(i + 1) % r.length];
          const sa = (a.x - q.x) * n.x + (a.y - q.y) * n.y;
          const sb = (b.x - q.x) * n.x + (b.y - q.y) * n.y;
          // an edge crosses when its ends lie on different sides (a point on the line counts as below it)
          if (sa > 0 === sb > 0) continue;
          const f = sa / (sa - sb);
          at.push((a.x + (b.x - a.x) * f - q.x) * u.x + (a.y + (b.y - a.y) * f - q.y) * u.y);
        }
      }
      at.sort((a, b) => a - b);
      for (let j = 0; j + 1 < at.length; j += 2) {
        const t0 = at[j];
        const t1 = at[j + 1];
        if (!(t1 > t0)) continue;
        if (!(period > 0) || !fam.dashes.some((d) => d < 0)) {
          out.push([along(t0), along(t1)]);
        } else {
          for (let s0 = Math.floor(t0 / period) * period; s0 < t1; s0 += period) {
            let d0 = s0;
            for (const d of fam.dashes) {
              if (d >= 0) {
                const a = Math.max(d0, t0);
                const b = Math.min(d0 + (d === 0 ? dot : d), t1);
                if (b > a) out.push([along(a), along(b)]);
              }
              d0 += Math.abs(d);
            }
            if (out.length > max) return null;
          }
        }
      }
      if (out.length > max) return null;
    }
  }
  return out;
}

/** TEXT, ATTRIB and MTEXT as one text object: its anchor, justification and turn. */
function addText(w: Walk, m: Affine, e: Entry, layer: string, style: DxfStyle): void {
  let text: string;
  let at: Pt | null;
  let rotation: number;
  let hAlign: number;
  let vAlign: number;
  if (e.type === "MTEXT") {
    // the text is group 3 pieces (each up to 250 characters) followed by group 1
    const pieces = e.pairs.filter((p) => p.code === 3).map((p) => p.value);
    text = mtextPlain(unicodeEscapes(pieces.join("") + (rawOf(e, 1) ?? "")));
    at = pointOf(e, 10);
    // 11/21 give the direction of the text's x axis; without them, group 50 turns it, in radians
    const dx = numOf(e, 11);
    const dy = numOf(e, 21);
    rotation = dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) / DEG : numOf(e, 50) / DEG;
    // attachment point 1 to 9: top, middle or bottom row, left, centre or right column
    const attach = Math.min(9, Math.max(1, Math.round(numOf(e, 71, 1))));
    hAlign = 1 + ((attach - 1) % 3);
    vAlign = attach <= 3 ? 1 : attach <= 6 ? 3 : 5;
  } else {
    text = textCodes(rawOf(e, 1) ?? "");
    const h = numOf(e, 72);
    // an attribute's vertical justification is group 74, as its 73 is the field length
    const v = numOf(e, e.type === "ATTRIB" ? 74 : 73);
    // justified text is placed by its alignment point (11/21), otherwise by the insertion point (10/20)
    at = h !== 0 || v !== 0 ? (pointOf(e, 11) ?? pointOf(e, 10)) : pointOf(e, 10);
    rotation = numOf(e, 50);
    hAlign = H_ALIGN[h] ?? 1;
    vAlign = V_ALIGN[v] ?? 2;
  }
  push(w, e.type, layer, at ? textShape(m, at, text.replace(/\s+$/, ""), numOf(e, 40), rotation, hAlign, vAlign) : null, style);
}

/** TEXT codes: %%c, %%d and %%p are the diameter, degree and plus-minus signs; %%% is a percent sign; %%u and %%o are dropped. */
function textCodes(raw: string): string {
  return unicodeEscapes(raw).replace(/%%([cdpuo%])/gi, (_, code: string) => {
    switch (code.toLowerCase()) {
      case "c":
        return "Ø";
      case "d":
        return "°";
      case "p":
        return "±";
      case "%":
        return "%";
      default:
        return "";
    }
  });
}

/** \U+XXXX escapes as the characters they name. */
function unicodeEscapes(raw: string): string {
  return raw.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * MTEXT without its formatting: \P and \X start a new line, \~ is a space, \S stacks a fraction
 * (written a/b), braces group and are dropped, and the codes that take a value (font, colour,
 * height, width, tracking, obliquing, paragraph) are dropped with their value up to the ';'.
 */
function mtextPlain(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{" || ch === "}") continue;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    if (i + 1 >= raw.length) break;
    const code = raw[++i];
    if (code === "P" || code === "X") {
      out += "\n";
    } else if (code === "~") {
      out += " ";
    } else if (code === "\\" || code === "{" || code === "}") {
      out += code;
    } else if (code === "S") {
      const end = raw.indexOf(";", i);
      out += raw.slice(i + 1, end < 0 ? undefined : end).replace(/[\^#]/, "/");
      i = end < 0 ? raw.length : end;
    } else if ("fFHCcATWQp".includes(code)) {
      const end = raw.indexOf(";", i);
      i = end < 0 ? raw.length : end;
    }
    // any other code switches a decoration (underline, overline, strike-through), which is dropped
  }
  return out;
}

/** The vertices of an LWPOLYLINE: each group 10 starts one, with its group 20 and bulge (42). */
function lwVertices(e: Entry): Vertex[] {
  const pts: { x: number; y: number }[] = [];
  const bulges: number[] = [];
  for (const p of e.pairs) {
    const v = parseNum(p.value);
    if (p.code === 10) {
      pts.push({ x: v, y: 0 });
      bulges.push(0);
    } else if (p.code === 20 && pts.length > 0) {
      pts[pts.length - 1].y = v;
    } else if (p.code === 42 && bulges.length > 0) {
      bulges[bulges.length - 1] = Number.isFinite(v) ? v : 0;
    }
  }
  const out: Vertex[] = [];
  pts.forEach((p, i) => {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ p, bulge: bulges[i] });
  });
  return out;
}

// ---- geometry in file units ----------------------------------------------------------

/**
 * The plan view of an entity's object coordinate system, from its extrusion (210/220/230) by
 * AutoCAD's arbitrary axis rule; null for the usual +z, which is the world's own. A mirrored
 * object's -z turns x the other way.
 */
function ocsOf(e: Entry): Affine | null {
  if (!hasCode(e, 230)) return null;
  const nx = numOf(e, 210);
  const ny = numOf(e, 220);
  const nz = numOf(e, 230);
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0) || (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0)) return null;
  const n = { x: nx / len, y: ny / len, z: nz / len };
  // Ax is world y (or z, when the normal is not near the z axis) crossed with the normal
  const w = Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const ax = unit({ x: w.y * n.z - w.z * n.y, y: w.z * n.x - w.x * n.z, z: w.x * n.y - w.y * n.x });
  const ay = unit({ x: n.y * ax.z - n.z * ax.y, y: n.z * ax.x - n.x * ax.z, z: n.x * ax.y - n.y * ax.x });
  return { a: ax.x, b: ax.y, c: ay.x, d: ay.y, e: 0, f: 0 };
}

function unit(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * A SPLINE as a sampled polyline: through its control points (10/20, with weights 41 when rational)
 * and knots (40) when it has them, otherwise a smooth curve through its fit points (11/21).
 */
function splineShape(m: Affine, e: Entry): DxfShape | null {
  const ctrl = repeatedPoints(e, 10);
  const fit = repeatedPoints(e, 11);
  const closed = (numOf(e, 70) & 1) === 1;
  if (ctrl.length >= 2) {
    const degree = Math.max(1, Math.round(numOf(e, 71, 3)));
    const knots = e.pairs.filter((p) => p.code === 40).map((p) => parseNum(p.value));
    const weights = e.pairs.filter((p) => p.code === 41).map((p) => parseNum(p.value));
    const pts = nurbsPoints(ctrl, knots, weights.length === ctrl.length ? weights : [], degree);
    if (pts) return polylineShape(m, pts, false);
  }
  if (fit.length >= 2) {
    // only fit points (how a DWG keeps a spline drawn through points): AutoCAD's cubic through them when it is one
    const cubic = !closed && Math.round(numOf(e, 71, 3)) === 3 ? fitPoints(fit, pointOf(e, 12), pointOf(e, 13)) : null;
    return polylineShape(m, cubic ?? throughPoints(fit, closed), false);
  }
  return null;
}

/**
 * The cubic B-spline AutoCAD draws through fit points: knots at the running chord length, the end
 * tangents where given (unit vectors) or else no curvature at that end, sampled like any other.
 */
function fitPoints(fit: readonly Pt[], startTangent: Pt | null, endTangent: Pt | null): Pt[] | null {
  const q = fit.filter((pt, i) => i === 0 || !same(pt, fit[i - 1]));
  const n = q.length - 1;
  if (n < 1) return null;
  const u = [0];
  for (let k = 1; k <= n; k++) u.push(u[k - 1] + Math.hypot(q[k].x - q[k - 1].x, q[k].y - q[k - 1].y));
  const end = u[n];
  const knots = [0, 0, 0, 0, ...u.slice(1, n), end, end, end, end];
  const dir = (t: Pt | null): Pt | null => {
    const len = t ? Math.hypot(t.x, t.y) : 0;
    return t && len > 0 ? { x: t.x / len, y: t.y / len } : null;
  };
  const t0 = dir(startTangent);
  const t1 = dir(endTangent);
  // one equation a row for control points 0..n+2, each touching only its neighbours: a tridiagonal system
  const size = n + 3;
  const a = new Array<number>(size).fill(0);
  const b = new Array<number>(size).fill(1);
  const c = new Array<number>(size).fill(0);
  const d: Pt[] = new Array<Pt>(size).fill({ x: 0, y: 0 });
  d[0] = q[0];
  d[size - 1] = q[n];
  // at the start: the tangent, or the second derivative zero
  const s1 = u[1];
  const s2 = n >= 2 ? u[2] : end;
  if (t0) [a[1], b[1], c[1], d[1]] = [-1, 1, 0, { x: (s1 / 3) * t0.x, y: (s1 / 3) * t0.y }];
  else [a[1], b[1], c[1]] = [1 / s1, -(1 / s1 + 1 / s2), 1 / s2];
  // through each inner fit point, where three cubic basis functions are not zero
  for (let k = 1; k < n; k++) {
    const [n0, n1, n2] = cubicBasis(knots, k + 3, u[k]);
    [a[k + 1], b[k + 1], c[k + 1], d[k + 1]] = [n0, n1, n2, q[k]];
  }
  // and the same at the end
  const e1 = end - u[n - 1];
  const e2 = n >= 2 ? end - u[n - 2] : end;
  if (t1) [a[n + 1], b[n + 1], c[n + 1], d[n + 1]] = [0, -1, 1, { x: (e1 / 3) * t1.x, y: (e1 / 3) * t1.y }];
  else [a[n + 1], b[n + 1], c[n + 1]] = [1 / e2, -(1 / e1 + 1 / e2), 1 / e1];
  for (let i = 1; i < size; i++) {
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    d[i] = { x: d[i].x - w * d[i - 1].x, y: d[i].y - w * d[i - 1].y };
  }
  const ctrl = new Array<Pt>(size);
  ctrl[size - 1] = { x: d[size - 1].x / b[size - 1], y: d[size - 1].y / b[size - 1] };
  for (let i = size - 2; i >= 0; i--) {
    ctrl[i] = { x: (d[i].x - c[i] * ctrl[i + 1].x) / b[i], y: (d[i].y - c[i] * ctrl[i + 1].y) / b[i] };
  }
  if (ctrl.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.y))) return null;
  return nurbsPoints(ctrl, knots, [], 3);
}

/** The cubic basis functions N(span-3)..N(span-1) at t, where t is the knot that starts the span (the fourth is zero there). */
function cubicBasis(knots: readonly number[], span: number, t: number): [number, number, number] {
  const N = [1, 0, 0, 0];
  const left = [0, 0, 0, 0];
  const right = [0, 0, 0, 0];
  for (let j = 1; j <= 3; j++) {
    left[j] = t - knots[span + 1 - j];
    right[j] = knots[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return [N[0], N[1], N[2]];
}

/** The points of a repeated group: each x (code) starts one, completed by its y (code + 10). */
function repeatedPoints(e: Entry, code: number): Pt[] {
  const out: Pt[] = [];
  let x = NaN;
  for (const p of e.pairs) {
    if (p.code === code) x = parseNum(p.value);
    else if (p.code === code + 10 && Number.isFinite(x)) {
      const y = parseNum(p.value);
      if (Number.isFinite(y)) out.push({ x, y });
      x = NaN;
    }
  }
  return out;
}

/**
 * Samples a (rational) B-spline by de Boor's algorithm over its knot span, about 8 points per span;
 * null when the knots do not fit the control points and degree.
 */
function nurbsPoints(ctrl: readonly Pt[], knots: readonly number[], weights: readonly number[], degree: number): Pt[] | null {
  const n = ctrl.length;
  const p = Math.min(degree, n - 1);
  if (knots.length !== n + p + 1 || knots.some((k) => !Number.isFinite(k))) return null;
  const lo = knots[p];
  const hi = knots[n];
  if (!(hi > lo)) return null;
  const w = weights.length === n ? weights : ctrl.map(() => 1);
  const spans = new Set(knots.slice(p, n + 1)).size - 1;
  const samples = Math.min(4000, Math.max(16, spans * 8));
  const out: Pt[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? hi : lo + ((hi - lo) * s) / samples;
    // the span holding t: the last k with knots[k] <= t < knots[k + 1], kept inside p..n-1
    let k = p;
    while (k < n - 1 && knots[k + 1] <= t) k++;
    const d: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j];
      const wj = w[k - p + j];
      d.push({ x: c.x * wj, y: c.y * wj, w: wj });
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = k - p + j;
        const den = knots[i + p - r + 1] - knots[i];
        const a = den === 0 ? 0 : (t - knots[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    }
    const q = d[p];
    if (q.w !== 0) out.push({ x: q.x / q.w, y: q.y / q.w });
  }
  return out.filter((pt, i) => i === 0 || !same(pt, out[i - 1]));
}

/** A smooth curve through points (Catmull-Rom, 8 steps a segment), closing back to the first when asked. */
function throughPoints(pts: readonly Pt[], closed: boolean): Pt[] {
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt[] = [pts[0]];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 1; s <= 8; s++) {
      const t = s / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/** m applied after n: n first, then m. */
function compose(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function applyPt(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** The linear part of m on a vector: a direction or a radius, which the translation does not move. */
function applyVec(m: Affine, v: Pt): Pt {
  return { x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y };
}

function same(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

function lineShape(m: Affine, a: Pt, b: Pt): DxfShape | null {
  if (same(a, b)) return null;
  return { kind: "line", a: applyPt(m, a), b: applyPt(m, b) };
}

/** An open or closed outline in file units; a closed one needs three points to be a polygon. */
function polylineShape(m: Affine, pts: readonly Pt[], closed: boolean): DxfShape | null {
  if (pts.length < 2) return null;
  return { kind: "polyline", points: pts.map((p) => applyPt(m, p)), closed: closed && pts.length >= 3 };
}

/** The curve c + u cos t + v sin t, for t from t0 over span radians, transformed by m. */
function curveOn(m: Affine, c: Pt, u: Pt, v: Pt, t0: number, span: number): DxfShape | null {
  return curveShape(applyPt(m, c), applyVec(m, u), applyVec(m, v), t0, span);
}

/**
 * The curve c + u cos t + v sin t, for t from t0 over span radians. It is an arc when it is an
 * ellipse whose axes are at right angles and turned by a quarter turn (or any angle, for a circle),
 * as the arc shape can draw; any other ellipse is a sampled polyline. Null when it has no size.
 */
function curveShape(c: Pt, u: Pt, v: Pt, t0: number, span: number): DxfShape | null {
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (!(lu > 0) || !(lv > 0) || !(span > 0)) return null;
  const full = span >= TWO_PI - 1e-6;
  const dot = u.x * v.x + u.y * v.y;
  if (Math.abs(dot) <= 1e-9 * lu * lv) {
    // the ellipse is the arc shape turned by phi: its x radius runs along u, its y radius across it
    const phi = Math.atan2(u.y, u.x);
    const quarters = phi / (Math.PI / 2);
    const quarter = Math.abs(quarters - Math.round(quarters)) < 1e-9;
    const circle = Math.abs(lu - lv) <= 1e-9 * Math.max(lu, lv);
    if (quarter || circle) {
      // t runs backwards when v turns clockwise from u; then the arc starts at -(t0 + span)
      const cross = u.x * v.y - u.y * v.x;
      const start = (cross >= 0 ? t0 : -(t0 + span)) + phi;
      const swap = quarter && Math.round(quarters) % 2 !== 0;
      const rx = swap ? lv : lu;
      const ry = swap ? lu : lv;
      const startAngle = (((start / DEG) % 360) + 360) % 360;
      const sweepAngle = full ? 360 : span / DEG;
      if (circle) return { kind: "arc", center: c, radius: rx, startAngle, sweepAngle };
      return { kind: "arc", center: c, radius: rx, radiusY: ry, startAngle, sweepAngle };
    }
  }
  const steps = Math.max(8, Math.ceil((span / DEG) / STEP_DEG));
  const count = full ? steps : steps + 1;
  const pts: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const t = t0 + (span * k) / steps;
    pts.push({
      x: c.x + u.x * Math.cos(t) + v.x * Math.sin(t),
      y: c.y + u.y * Math.cos(t) + v.y * Math.sin(t),
    });
  }
  return { kind: "polyline", points: pts, closed: full };
}

/** A text object's shape in file units: its anchor, height and turn move with m. */
function textShape(m: Affine, at: Pt, text: string, height: number, rotation: number, hAlign: number, vAlign: number): DxfShape | null {
  if (!(height > 0) || text.trim() === "") return null;
  const dir = applyVec(m, { x: Math.cos(rotation * DEG), y: Math.sin(rotation * DEG) });
  const turn = Math.atan2(dir.y, dir.x) / DEG;
  return {
    kind: "text",
    at: applyPt(m, at),
    text,
    height: height * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)),
    rotation: ((turn % 360) + 360) % 360,
    hAlign,
    vAlign,
  };
}

/** The points a polyline passes through, with its bulge arcs sampled; the closing point is left out when closed. */
function tracePoints(verts: readonly Vertex[], closed: boolean): Pt[] {
  if (verts.length === 0) return [];
  const n = verts.length;
  const out: Pt[] = [verts[0].p];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) bulgeTo(out, verts[i].p, verts[(i + 1) % n].p, verts[i].bulge);
  if (closed && out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out.filter((p, i) => i === 0 || !same(p, out[i - 1]));
}

/**
 * Adds the points of the arc from a to b with this bulge (the tangent of a quarter of its included
 * angle; positive turns counter-clockwise), ending with b.
 */
function bulgeTo(out: Pt[], a: Pt, b: Pt, bulge: number): void {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (bulge === 0 || chord === 0) {
    out.push(b);
    return;
  }
  const included = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  // the centre sits on the chord's perpendicular, offset from its middle by this much to the left of a to b
  const ux = (b.x - a.x) / chord;
  const uy = (b.y - a.y) / chord;
  const offset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const cx = (a.x + b.x) / 2 - uy * offset;
  const cy = (a.y + b.y) / 2 + ux * offset;
  const from = Math.atan2(a.y - cy, a.x - cx);
  const steps = Math.max(1, Math.ceil(Math.abs(included) / (STEP_DEG * DEG)));
  for (let k = 1; k < steps; k++) {
    const t = from + (included * k) / steps;
    out.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
  }
  out.push(b);
}

// ---- objects for the document ------------------------------------------------------

/** Where a text object is justified and how it is turned, for setTextStyle. */
export interface TextTurn {
  readonly hAlign: number;
  readonly vAlign: number;
  /** degrees, counter-clockwise from +x */
  readonly angle: number;
}

/** One object to create: its DXF type and layer, its geometry and how it draws, and for text its justification and turn. */
export interface DxfPlacement {
  readonly type: string;
  readonly layer: string;
  readonly shape: NewShape;
  readonly style: DxfStyle;
  readonly text?: TextTurn;
  /** filled in its colour, with no pen: a solid hatch, a SOLID or a TRACE */
  readonly filled?: boolean;
  /** a fill's loops (even-odd), when it has holes or more than one loop; `shape` is then its first */
  readonly rings?: Pt[][];
}

/**
 * The objects of a drawing as NewShape geometry. `scale` is world units (millimetres) per file
 * unit, which is the file's own $INSUNITS (DxfDrawing.mmPerUnit).
 */
export function dxfPlacements(drawing: DxfDrawing, scale: number): DxfPlacement[] {
  const sc = (p: Pt): Pt => ({ x: p.x * scale, y: p.y * scale });
  return drawing.entities.map((en): DxfPlacement => {
    const s = en.shape;
    const base = { type: en.type, layer: en.layer, style: en.style };
    switch (s.kind) {
      case "point":
        return { ...base, shape: { kind: "locus", at: sc(s.at) } };
      case "line":
        return { ...base, shape: { kind: "line", a: sc(s.a), b: sc(s.b) } };
      case "polyline": {
        const points = s.points.map(sc);
        return s.closed
          ? { ...base, shape: { kind: "polygon", points, closed: true } }
          : { ...base, shape: { kind: "polyline", points, closed: false } };
      }
      case "arc":
        return {
          ...base,
          shape: {
            kind: "arc",
            center: sc(s.center),
            radius: s.radius * scale,
            ...(s.radiusY !== undefined ? { radiusY: s.radiusY * scale } : {}),
            startAngle: s.startAngle,
            sweepAngle: s.sweepAngle,
          },
        };
      case "text":
        return {
          ...base,
          shape: { kind: "text", at: sc(s.at), text: s.text, height: (s.height * scale) / CAP_HEIGHT },
          text: { hAlign: s.hAlign, vAlign: s.vAlign, angle: s.rotation },
        };
      case "fill": {
        const rings = s.rings.map((r) => r.map(sc));
        return { ...base, filled: true, shape: { kind: "polygon", points: rings[0], closed: true }, ...(rings.length > 1 ? { rings } : {}) };
      }
      case "strokes": {
        // one polyline through every dash, the edges between dashes hidden, as Vectorworks keeps hatch strokes
        const points = s.segments.flatMap(([a, b]) => [sc(a), sc(b)]);
        const hidden = s.segments.slice(1).map((_, i) => 2 * i + 1);
        return { ...base, shape: { kind: "polyline", points, closed: false, ...(hidden.length ? { hidden } : {}) } };
      }
    }
  });
}

/**
 * A DXF line type's pattern (dashes positive, gaps negative, dots 0) as a Rodeo line type's:
 * alternating dash and gap lengths in paper inches (`k` per file unit), from a dash, neighbours of
 * one kind run together and a dot a short dash; at most MAX_PAIRS pairs. Null when it has no gap.
 */
export function paperDashes(pattern: readonly number[], k: number): number[] | null {
  const runs: { dash: boolean; len: number }[] = [];
  for (const d of pattern) {
    const dash = d >= 0;
    const len = d === 0 ? DOT : Math.abs(d) * k;
    const last = runs[runs.length - 1];
    if (last && last.dash === dash) last.len += len;
    else runs.push({ dash, len });
  }
  // start on a dash; a dash at both ends is one dash across the repeat
  const first = runs.findIndex((r) => r.dash);
  if (first < 0 || !runs.some((r) => !r.dash)) return null;
  const turned = [...runs.slice(first), ...runs.slice(0, first)];
  if (turned.length > 1 && turned[turned.length - 1].dash) turned[0].len += turned.pop()?.len ?? 0;
  const out = turned.slice(0, 2 * MAX_PAIRS).map((r) => +r.len.toPrecision(9));
  return out.length >= 2 && out.some((v) => v > 0) ? out : null;
}
