// Built-in record templates for the object kinds a file may have no sample of, so that
// a blank drawing can add them. Each is a record of the size Vectorworks writes, with
// neutral attributes (solid black 0.254 mm pen, no fill) and zero geometry: addObjects
// writes the geometry as it does for a template copied from a file, and a group's boxes
// are refitted when its objects change. Layouts follow FORMAT.md sections 2 and 4.

import { writeAttrs } from "./attrs.ts";
import { setF64, setI32, setU16, setU32, setU64 } from "./bytes.ts";
import { newPreview } from "./resources.ts";
import type { ImageTextureSpec, Pt, TextureData } from "./types.ts";

// recordFormatTemplate and pluginTemplate: the plug-in format and plug-in object a Vectorworks
// plug-in Rodeo runs places, in drawings that have none of either to copy (FORMAT.md §4, 86; §7.3).

const TERMINATOR = 0;
const LINE = 2;
const RECT = 3;
const POLYGON = 5;
const ARC = 6;
const TEXT = 10;
const GROUP = 11;
const ROUNDED_RECT = 13;
const POLYLINE = 21;

/** A subtree captured as bytes plus parent links (index into `recs`, -1 = root). */
export interface Template {
  recs: Uint8Array[];
  parent: number[];
}

/** A record of the given type and length, with a placeholder GUID that instantiate replaces. */
function record(type: number, length: number): Uint8Array {
  const d = new Uint8Array(length);
  setU64(d, 0, BigInt(length));
  d[0x19] = type;
  d[0x1f] = 0x40;
  d[0x38] = 1;
  return d;
}

/** Attributes an object draws with when it has none of its own: a solid black pen, no fill. */
function plainAttributes(d: Uint8Array): Uint8Array {
  writeAttrs(d, {
    lineStyle: 2,
    lineWeight: 10,
    fillFore: 257,
    fillBack: 256,
    penFore: 257,
    penBack: 256,
    fillOpacity: 100,
    penOpacity: 100,
    fillPattern: 0,
  });
  return d;
}

/** A single shape, with its geometry written by addObjects. */
function shape(type: number, length: number): Template {
  return { recs: [plainAttributes(record(type, length))], parent: [-1] };
}

/**
 * One line of text. encodeText refreshes the count fields only when the template has more
 * than one character, so the template holds two placeholder spaces and every count starts at 2;
 * +0x100 is the number of laid-out lines, 1 (the text's size and font sit after that many).
 */
function text(): Template {
  const d = plainAttributes(record(TEXT, 316 + 2 * 10));
  setF64(d, 0xc0, 1); // baseline runs left to right: cos 1, sin 0 at +0xb8
  d[0xe8] = 1; // top aligned
  d[0xe9] = 1; // left justified
  for (const off of [0xea, 0xf6, 0x102, 0x104]) setU16(d, off, 2);
  setU16(d, 0x100, 1);
  d.set([0x20, 0, 0x20, 0], d.length - 4);
  return { recs: [d], parent: [-1] };
}

/** An empty group: its shell and the terminator that closes its objects. */
function group(): Template {
  const g = plainAttributes(record(GROUP, 0xcc));
  // the plan box and the 3D box an empty group has: inverted, so the first object fits them
  [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => setF64(g, 0x68 + 8 * i, v));
  [-1, -1, -1, 1, 1, 1].forEach((s, i) => setF64(g, 0x9c + 8 * i, s * Number.MAX_VALUE));
  return { recs: [g, record(TERMINATOR, 0x58)], parent: [-1, 0] };
}

const SYMBOL_INSTANCE = 15;
const SYMBOL_DEFINITION = 16;
const SYMBOL_LIBRARY = 54;

/** An empty resource library, for a drawing with no symbols: it goes among the root's document data. */
export function symbolLibraryTemplate(): Template {
  const lib = record(SYMBOL_LIBRARY, 0x9c);
  setU64(lib, 0x10, 1n);
  [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => setF64(lib, 0x68 + 8 * i, v));
  return { recs: [lib, record(TERMINATOR, 0x58)], parent: [-1, 0] };
}

/**
 * A symbol definition with nothing in it. Vectorworks' hold seven aux records whose use isn't known
 * (FORMAT.md §12), so this holds none, and Vectorworks has not opened one yet.
 */
export function symbolDefinitionTemplate(): Template {
  const def = plainAttributes(record(SYMBOL_DEFINITION, 436));
  return { recs: [def, record(TERMINATOR, 0x58)], parent: [-1, 0] };
}

/** A symbol instance, placed by writePlacement and named by its definition's index at +0x8e. */
function symbolInstance(): Template {
  return { recs: [plainAttributes(record(SYMBOL_INSTANCE, 280))], parent: [-1] };
}

const RECORD_FORMAT = 47;
const RECORD = 48;
const PLUGIN = 86;

/**
 * A record format with its default record under it and no fields: encodePluginFormat and
 * encodeRecord fill them in. +0x10 marks the default record as the format's aux list; the default
 * record's u16 at +0x54 is non-zero so that encodeRecord lists its per-field bytes, as the plug-in
 * formats' defaults in the demos do.
 */
export function recordFormatTemplate(): Template {
  const f = record(RECORD_FORMAT, 0x60);
  setU64(f, 0x10, 1n);
  const r = record(RECORD, 0x56);
  setU16(r, 0x54, 1);
  return { recs: [f, r], parent: [-1, 0] };
}

/**
 * A plug-in object at the origin, unturned, with nothing in it: the 360-byte record the demos'
 * plug-ins have, its plan box and 3D box empty (as an empty group's), its own box at +0xcc empty
 * too, the identity matrix at +0xf0 (rows, then the translation), and the terminator that closes
 * its list. Its parameters are an aux record addPluginObject attaches. The bytes after the matrix
 * are those of the Road Case objects saved by Vectorworks 2018 (meaning unknown).
 */
export function pluginTemplate(): Template {
  const d = plainAttributes(record(PLUGIN, 0x168));
  [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => {
    setF64(d, 0x68 + 8 * i, v);
    setF64(d, 0xcc + 8 * i, v);
  });
  [-1, -1, -1, 1, 1, 1].forEach((s, i) => setF64(d, 0x9c + 8 * i, s * Number.MAX_VALUE));
  d.fill(0xff, 0xec, 0xf0);
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].forEach((v, i) => setF64(d, 0xf0 + 8 * i, v));
  d[0x154] = 0x40;
  setU16(d, 0x160, 1);
  setU16(d, 0x162, 1);
  return { recs: [d, record(TERMINATOR, 0x58)], parent: [-1, 0] };
}

// poly3dHead and meshShell: the 3D polygon and mesh new 3D geometry is written from, in drawings
// that have neither (a flattened Make2D drawing, a blank one). Layouts as FORMAT.md §4 types 25,
// 40 and 41.

const POLY3D = 25;
const MESH = 40;
const MESH_FACE = 41;

/**
 * Header bits every mesh, mesh face and mesh terminator in the demos has, and most 3D polygons:
 * +0x2f's 0x11. No record in the samples has +0x2f zero; 3D ones have 0x11 there.
 */
function solidRecord(type: number, length: number): Uint8Array {
  const d = record(type, length);
  d[0x2f] = 0x11;
  return d;
}

/** A 3D polygon's record up to its points (+0xd2), closed: Convert to 3D Polygons writes the rest. */
export function poly3dHead(): Uint8Array {
  const d = plainAttributes(solidRecord(POLY3D, 0xd2));
  d[0x8d] = 1;
  return d;
}

/**
 * A mesh's record up to its vertices (+0xd4), a face's up to its corners (+0xce) and the
 * terminator that ends the faces, as the demos' meshes have them: a solid fill (each face draws
 * filled in 3D), 0x41 at +0x1f, the u32 at +0xcc all 1s (every mesh), and a terminator with no
 * flags at +0x1f. meshRecords writes the vertices, the faces' corners and both boxes.
 */
export function meshShell(): { head: Uint8Array; face: Uint8Array; term: Uint8Array } {
  const head = plainAttributes(solidRecord(MESH, 0xd4));
  writeAttrs(head, { fillPattern: 1 });
  head[0x1f] = 0x41;
  head.fill(0xff, 0xcc, 0xd0);
  const face = plainAttributes(solidRecord(MESH_FACE, 0xce));
  writeAttrs(face, { fillPattern: 1 });
  face[0x8d] = 1;
  const term = solidRecord(TERMINATOR, 0x58);
  term[0x1f] = 0;
  return { head, face, term };
}

const EXTRUDE = 24;
const AUX_RECORD = 76;
/** u64 at +0x08 of a record with a sibling after it (FORMAT.md §2) */
const NEXT_MARKER = 0x05792ca4n;
/** a texture dictionary's body from +0x50: every extrude in the four demo drawings carries this "SCDT" one */
const EXTRUDE_SCDT = fromHex(
  "54444d4405005343445401001300000001000c00000000000000000001000100000000000000000000",
);
/** and a "ttwr" one: the commonest of theirs, its one texture part set to none (−1) */
const EXTRUDE_TTWR = fromHex(
  "54444d4405007474777208000b01000001003600000002004000000003004a00000004005400000005005b0000000600" +
  "6500000007009b0000000800010100000000000000000800010000000300000008000100000000000000080001000000" +
  "ffffffff0100010000004d08000100000007000000060006000000000000000000000000000000000000000000000000" +
  "00f03f000000000000f03f0000000000000000000000000000000006000c000000000000000000f03f00000000000000" +
  "0000000000000000000000000000000000000000000000f03f0000000000000000000000000000000000000000000000" +
  "00000000000000f03f000000000000000000000000000000000000000000000000080001000000000000000000000000" +
  "00",
);

function fromHex(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
}

/**
 * An extrude's records as the demos' extrudes saved without a body have them (FORMAT.md §3D): its
 * 324-byte header with 0x6000 at +0x98 and the bytes after its frame that most of them share, its
 * two texture dictionaries (SCDT, then ttwr) and the terminator that ends its list. extrudeObjects
 * puts the profile before the terminator and writes the class, attributes, frame and boxes;
 * multiple extrudes, sweeps and solids are made from it as from one of the drawing's.
 */
export function extrudeShell(): Template {
  const head = plainAttributes(solidRecord(EXTRUDE, 0x144));
  // it has aux records: instantiate gives the list its own address
  setU64(head, 0x10, 1n);
  head[0x99] = 0x60;
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => setF64(head, 0xcc + 8 * i, v));
  head.set(fromHex("000000000000000000000000666666666666094044000000"), 0x12c);
  const dict = (body: Uint8Array, last: boolean): Uint8Array => {
    const a = record(AUX_RECORD, 0x50 + body.length);
    a[0x2f] = 0x12;
    if (!last) setU64(a, 0x08, NEXT_MARKER);
    a.set(body, 0x50);
    return a;
  };
  const term = solidRecord(TERMINATOR, 0x58);
  term[0x1f] = 0;
  return { recs: [head, dict(EXTRUDE_SCDT, false), dict(EXTRUDE_TTWR, true), term], parent: [-1, 0, 0, 0] };
}

const VIEWPORT = 122;

/** Where a viewport's fields sit in the layout Rodeo writes a new one in (FORMAT.md §7). */
const VIEWPORT_ROTATION = 0x8c;
const VIEWPORT_VIEW = 0x238;
const VIEWPORT_SCALE = 0x2cc;
const VIEWPORT_LIST = 0x338;

/** A group a viewport holds, saying what it is for by an aux record with a reversed four-letter tag. */
function taggedGroup(tags: readonly string[]): Template {
  const g = group();
  // it has aux records: instantiate gives the list its own address
  setU64(g.recs[0], 0x10, 1n);
  const aux = tags.map((tag, i) => {
    const a = record(AUX_RECORD, 84);
    a.set([...tag].map((c) => c.charCodeAt(0)), 0x50);
    if (i < tags.length - 1) setU64(a, 0x08, NEXT_MARKER);
    return a;
  });
  return { recs: [g.recs[0], ...aux, g.recs[1]], parent: [-1, ...aux.map(() => 0), 0] };
}

/**
 * A plan viewport: an unturned plan with an empty list of layers and classes, its annotations and
 * crop empty. For a drawing with no plan viewport to copy; createViewport writes the rest. It reads
 * as FORMAT.md §7 sets it out, but Vectorworks has not opened one yet.
 */
export function viewportShell(): Template {
  const head = plainAttributes(record(VIEWPORT, VIEWPORT_LIST + 6));
  setU64(head, 0x10, 1n);
  for (const at of [VIEWPORT_ROTATION, VIEWPORT_VIEW]) [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => setF64(head, at + 8 * i, v));
  setF64(head, VIEWPORT_SCALE, 1);
  const annotations = taggedGroup(["onna", "mnna"]);
  const crop = taggedGroup(["porc"]);
  for (const g of [annotations, crop]) setU64(g.recs[0], 0x08, NEXT_MARKER);
  const shift = (t: Template, by: number): number[] => t.parent.map((p) => (p < 0 ? 0 : p + by));
  return {
    recs: [head, ...annotations.recs, ...crop.recs, record(TERMINATOR, 0x58)],
    parent: [-1, ...shift(annotations, 1), ...shift(crop, 1 + annotations.recs.length), 0],
  };
}

/** Fresh templates for the built-in types, keyed by record type. */
const WALL = 68;
const BODY = 114;
const BODY_DIRECTORY = 0x5a;
const BODY_BASE = 0x60;
const BODY_SLOTS = 16;
const BODY_POINTS = 0;
const BODY_LINES = 14;

/**
 * A body of straight edges, section 0 its points and section 14 its edges, two points each (FORMAT.md
 * §4, 114). It has no Parasolid section: its faces are rebuilt from its edges, as for any body.
 */
export function edgesBody(edges: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[]): Uint8Array {
  const first = BODY_DIRECTORY + 6 * BODY_SLOTS;
  const pointBytes = 48 * edges.length;
  const length = first + pointBytes + 6 * edges.length;
  const d = record(BODY, length);
  setU16(d, BODY_DIRECTORY, 2);
  setU32(d, BODY_DIRECTORY + 2, length - BODY_BASE);
  const slot = (i: number, id: number, at: number): void => {
    setU16(d, BODY_DIRECTORY + 6 * i, id);
    setU32(d, BODY_DIRECTORY + 6 * i + 2, at);
  };
  slot(1, BODY_POINTS, first - BODY_BASE);
  slot(2, BODY_LINES, first + pointBytes - BODY_BASE);
  for (let i = 3; i < BODY_SLOTS; i++) slot(i, 0xffff, 0);
  edges.forEach(([a, b], i) => {
    [...a, ...b].forEach((v, k) => setF64(d, first + 48 * i + 8 * k, v));
    const entry = first + pointBytes + 6 * i;
    setU16(d, entry, 2);
    setU32(d, entry + 2, 2 * i);
  });
  return d;
}

/** A wall's line in the shell wallShell makes, stretched onto the one a new wall runs along. */
export const WALL_SHELL_LENGTH = 1000;

/**
 * A plain wall for a drawing with none to copy: along x from the origin, WALL_SHELL_LENGTH long,
 * centred on that line, from 0 up to `height`. Holds no aux records or components, its 3D a box of
 * edges in a group, as a wall's group caches its bodies (FORMAT.md §7, Walls in 3D). `plan` is its
 * plan drawing, encoded by the caller.
 */
export function wallShell(thickness: number, height: number, plan: Uint8Array): Template {
  const half = thickness / 2;
  const corners = [
    [0, -half],
    [WALL_SHELL_LENGTH, -half],
    [WALL_SHELL_LENGTH, half],
    [0, half],
  ] as const;
  const at = (i: number, z: number): readonly [number, number, number] => [corners[i % 4][0], corners[i % 4][1], z];
  const edges = [0, 1, 2, 3].flatMap((i) => [[at(i, 0), at(i + 1, 0)], [at(i, height), at(i + 1, height)], [at(i, 0), at(i, height)]] as const);
  return plainWall({ x: 0, y: 0 }, { x: WALL_SHELL_LENGTH, y: 0 }, thickness, 0, height, [plan], edges);
}

/**
 * A plain wall where it stands: its control line from `start` to `end`, `thickness` across it, from
 * `bottom` to `top` (z in the model, its layer's elevation in them), with no aux records or
 * components. `plans` is its plan drawing, encoded by the caller, and `edges` its 3D, a body cached
 * in a group as Vectorworks caches a wall's (FORMAT.md §7, Walls in 3D); `box`, x0 y0 z0 x1 y1 z1,
 * is that group's 3D box, else it is left empty.
 */
export function plainWall(
  start: Pt,
  end: Pt,
  thickness: number,
  bottom: number,
  top: number,
  plans: readonly Uint8Array[],
  edges: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[],
  box?: readonly [number, number, number, number, number, number],
): Template {
  const w = plainAttributes(record(WALL, 0x100));
  [start.y, start.x, end.y, end.x].forEach((v, i) => setF64(w, 0x9e + 8 * i, v));
  setF64(w, 0xbf, thickness);
  [0xc7, 0xd7, 0xe7].forEach((at) => setF64(w, at, top));
  [0xcf, 0xdf, 0xef].forEach((at) => setF64(w, at, bottom));
  const body = edgesBody(edges);
  const [bodies, groupEnd] = group().recs;
  if (box) [box[3], box[4], box[5], box[0], box[1], box[2]].forEach((v, i) => setF64(bodies, 0x9c + 8 * i, v));
  // all objects, so none reads as an aux record
  for (const object of [...plans, bodies, body]) setU64(object, 0x08, NEXT_MARKER);
  const g = 1 + plans.length;
  return { recs: [w, ...plans, bodies, body, groupEnd, record(TERMINATOR, 0x58)], parent: [-1, ...plans.map(() => 0), 0, g, g, 0] };
}

// imageTexture and shaderFormatList: a RenderWorks texture showing one image, made as Vectorworks
// makes one from an image, and the list its shaders' record formats sit in, for drawings that have
// none (FORMAT.md §4 type 97, §7.3). The records are those the 16 image textures of the four
// JohnMosbyHwy demos each have, in the same order: the texture, its two previews, the Image Color
// shader's settings, the image's holder (93) with the image under it, and the preview and shadow
// options. Every byte is one those 16 share, or one that only says what the image is; the record
// formats' field names are kept only where every drawing names a field alike (they carry other
// languages' names, or stale bytes, in the rest), and stale bytes after each name are left out.

const TEXTURE = 97;
const IMAGE_HOLDER = 93;
/** a shader's settings format: each field's type (1 an i32, 2 a boolean, 7 a dimension), with its name where every drawing has one */
const SHADERS: readonly { name: string; fields: readonly (readonly [number, string?])[] }[] = [
  { name: "NNAMaxon Image Color", fields: [[1, "Family"], [1, "Prototype"], [1, "Version"], [1], [1], [1], [1], [1], [2]] },
  { name: "NNAPreview Object Options", fields: [[1, "Family"], [1, "Prototype"], [1, "Version"], [1], [7]] },
  { name: "NNAShadow Options", fields: [[1, "Family"], [1, "Prototype"], [1, "Version"], [2], [2]] },
];
const FIELD_SIZE = 136;
const FIELD_BYTES: Record<number, number> = { 1: 4, 2: 2, 7: 10 };
/** the values each shader's settings start with, as the format's defaults (field by field) */
const SHADER_DEFAULTS: readonly (readonly number[])[] = [
  [1, 41, 1, 4, 1, 255, 255, 255, 1],
  [8, 2, 1, 1, 25.4],
  [8, 1, 1, 1, 1],
];

/** A record with the header bits the demos' texture records have: 0x40 (0x41 for a record format or record) at +0x1f, 0x12 at +0x2f. */
function textureRecord(type: number, length: number): Uint8Array {
  const d = record(type, length);
  if (type === RECORD_FORMAT || type === RECORD) d[0x1f] = 0x41;
  d[0x2f] = 0x12;
  return d;
}

/** Shader `i`'s settings with `values`, field by field, its format's name index left for importTexture to write. */
function shaderRecord(i: number, values: readonly number[]): Uint8Array {
  const { fields } = SHADERS[i];
  let at = 0x56;
  const offsets = fields.map(([type]) => (at += FIELD_BYTES[type]) - FIELD_BYTES[type]);
  const d = textureRecord(RECORD, at);
  fields.forEach(([type], k) => {
    if (type === 1) setI32(d, offsets[k], values[k]);
    else if (type === 2) setU16(d, offsets[k], values[k] ? 1 : 0);
    else setF64(d, offsets[k], values[k]);
  });
  return d;
}

/** Shader `i`'s record format, its defaults under it. */
function shaderFormat(i: number): TextureData["formats"][number] {
  const { name, fields } = SHADERS[i];
  const f = textureRecord(RECORD_FORMAT, 0x60 + FIELD_SIZE * fields.length);
  // its defaults are its aux list
  setU64(f, 0x10, 1n);
  setU16(f, 0x50, fields.length);
  let off = 0;
  fields.forEach(([type, label], k) => {
    const at = 0x60 + FIELD_SIZE * k;
    setU16(f, at, type);
    setU16(f, at + 2, off);
    // dimensions in millimetres
    if (type === 7) setU16(f, at + 6, 5);
    [...(label ?? "")].forEach((c, j) => setU16(f, at + 8 + 2 * j, c.charCodeAt(0)));
    off += FIELD_BYTES[type];
  });
  return { name, list: "76 TMFH", records: [{ data: f, parent: -1 }, { data: shaderRecord(i, SHADER_DEFAULTS[i]), parent: 0 }] };
}

/**
 * The texture `spec` describes, as importTexture takes one. Its Image Color shader shows the
 * image tinted by nothing (the colour is what Vectorworks shows for it in a plain view), its
 * preview options size the preview's object at twice the image, and it casts shadows.
 */
export function imageTexture(spec: ImageTextureSpec): TextureData {
  const { image, mime, width, height, size, color, previews } = spec;
  // as Vectorworks works them out from millimetres
  const inches = size * (1 / 25.4);
  const tex = textureRecord(TEXTURE, 0x62);
  tex[0x2f] = 0x11;
  setU64(tex, 0x10, 1n);
  setF64(tex, 0x5a, inches);
  // what the image's holder keeps besides its size in inches (as in each of the 16)
  const holder = textureRecord(IMAGE_HOLDER, 0x8a);
  setU64(holder, 0x10, 1n);
  setF64(holder, 0x60, height / 2);
  setF64(holder, 0x70, height / 2);
  setF64(holder, 0x78, width - 1);
  setF64(holder, 0x80, inches);
  holder[0x88] = holder[0x89] = 1;
  const preview = (png: Uint8Array, side: number, role: number): Uint8Array => newPreview(png, side, side, "image/png", role);
  const records: { data: Uint8Array; parent: number; format?: string }[] = [
    { data: tex, parent: -1 },
    { data: preview(previews.large, 256, 2), parent: 0 },
    { data: preview(previews.small, 64, 1), parent: 0 },
    { data: shaderRecord(0, [1, 41, 1, 4, 1, ...color.map((c) => Math.max(0, Math.min(255, Math.round(c)))), 1]), parent: 0, format: SHADERS[0].name },
    { data: holder, parent: 0 },
    { data: newPreview(image, width, height, mime), parent: 4 },
    { data: shaderRecord(1, [8, 2, 1, 1, 2 * inches * 25.4]), parent: 0, format: SHADERS[1].name },
    { data: shaderRecord(2, SHADER_DEFAULTS[2]), parent: 0, format: SHADERS[2].name },
  ];
  // each record but the last of its list has a sibling after it
  records.forEach((r, i) => {
    if (i > 0 && records.slice(i + 1).some((x) => x.parent === r.parent)) setU64(r.data, 0x08, NEXT_MARKER);
  });
  return { records, formats: SHADERS.map((_, i) => shaderFormat(i)) };
}

/** The list shader record formats sit in (a type-76 list tagged TMFH), empty, for the top of a class list. */
export function shaderFormatList(): Uint8Array {
  const d = textureRecord(AUX_RECORD, 0x54);
  setU64(d, 0x10, 1n);
  d.set([0x54, 0x4d, 0x46, 0x48], 0x50);
  return d;
}

export function builtinTemplates(): Map<number, Template> {
  return new Map<number, Template>([
    [LINE, shape(LINE, 0x8c)],
    [RECT, shape(RECT, 0xbc)],
    [ROUNDED_RECT, shape(ROUNDED_RECT, 0xcc)],
    [POLYGON, shape(POLYGON, 0x90)],
    [POLYLINE, shape(POLYLINE, 0x90)],
    [ARC, shape(ARC, 0xd2)],
    [TEXT, text()],
    [GROUP, group()],
    [SYMBOL_INSTANCE, symbolInstance()],
  ]);
}
