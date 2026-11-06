// A new drawing: one design layer, "Design Layer-1", with no objects, in the chosen units. The
// page is A3 landscape for millimetres and 17 by 11 inches for feet and inches.
//
// Rodeo writes this file itself, so its layout is checked against the sample files
// (blank.check.ts) and by opening it with openVwx. Whether Vectorworks opens it is not
// confirmed.
//
// Version: the header and records follow the newest layout in the samples, Vectorworks
// VW31.2.0 (build 834101), which is the one with the layer layout Rodeo writes (kind at
// +0x24c, name at +0x2a2). Only bytes that are the same in every sample, in both unit systems,
// are written as constants: the container header's, the palette and the colour table. The
// serial and licence block at +0x20 stays blank, and no names, text, layer or object data, or
// per-file bytes are copied; the units are written as Document Settings > Units writes them.

import { writeClassAttrs } from "./attrs.ts";
import { writeContainer } from "./container.ts";
import { withFont } from "./fonts.ts";
import { writeNameTable } from "./names.ts";
import { NEXT_MARK, Rec, joinRecords, newGuid } from "./records.ts";
import { unitsPatch } from "./settings.ts";
import { concat, encodeUtf16, setF64, setU16, setU32, setU32be, setU64 } from "./bytes.ts";

const BUILD = 834101;
const CONTAINER_HEADER = 2676;

// Owners and saved pointers of the records that hold other records. Every child list has its
// own owner value; a record's saved pointer is non-zero where the samples' is.
const ROOT = 0x10000n;
const CLASS_LIST = 0x10040n;
const LAYER = 0x10080n;
const CLASS_LIST_PTR = 0x100c0n;
const LAYER_PTR = 0x10100n;

// Container header bytes that are the same in every sample, in both unit systems (the serial at
// +0x20 is blank); the version, build, units and page are written over them (header()).
const HEADER: readonly (readonly [number, string])[] = [
  [0x2, "09e0"],
  [0xb, "940020565732"],
  [0x12, "2e302e"],
  [0x16, "205657"],
  [0x1b, "2e"],
  [0x1d, "2e"],
  [0x3b, "6563746f72576f726b73"],
  [0x49, "20"],
  [0x4d, "02"],
  [0x62, "4255494c443a20"],
  [0x91, "010000e009"],
  [0xad, "20"],
  [0xb3, "40"],
  [0xd6, "ff"],
  [0xfc, "ffffffffffffefffffffffffffffef7fffffffffffffef7fffffffffffffefff"],
  [0x137, "00"],
  [0x139, "ffffff"],
  [0x157, "3f"],
  [0x17f, "40"],
  [0x187, "40"],
  [0x189, "00010001000100"],
  [0x197, "40"],
  [0x19f, "40"],
  [0x1a7, "3f"],
  [0x1bb, "3f"],
  [0x1c5, "00"],
  [0x1c7, "00"],
  [0x1c9, "00"],
  [0x1cb, "00"],
  [0x1cd, "00"],
  [0x1cf, "00"],
  [0x1d1, "00"],
  [0x1d3, "00"],
  [0x1d5, "00"],
  [0x1d7, "00"],
  [0x1d9, "00"],
  [0x227, "002000730071002000"],
  [0x231, "00"],
  [0x246, "2000630075002000"],
  [0x24f, "00"],
  [0x269, "0c"],
  [0x26e, "03"],
  [0x272, "03"],
  [0x276, "02005300710075006100720065002000"],
  [0x287, "006500"],
  [0x28b, "00"],
  [0x2a2, "2000730071002000"],
  [0x2bc, "03"],
  [0x2c0, "430075006200690063002000"],
  [0x2cd, "006500"],
  [0x2d1, "00"],
  [0x2ea, "2000630075002000"],
  [0x304, "03"],
  [0x309, "0101"],
  [0x312, "08"],
  [0x320, "1d"],
  [0x32a, "02"],
  [0x341, "010001"],
  [0x346, "0001"],
  [0x356, "e03f0000480048000100517569636b4472617720334420496e746572616374697665"],
  [0x772, "6666666666663940"],
  [0x78c, "4d0069006c006c0069006d00650074006500720073"],
  [0x7b6, "6d006d"],
  [0x7ec, "010020007300710020006d006d"],
  [0x808, "01"],
  [0x80c, "20006300750020006d006d"],
  [0x826, "01"],
  [0x82e, "41"],
  [0x834, "03"],
  [0x838, "03"],
  [0x83c, "02"],
  [0x8d7, "40"],
  [0x8df, "40"],
  [0x8ef, "40"],
  [0x8f7, "400001"],
  [0x904, "01"],
  [0x912, "01"],
  [0x936, "010001"],
  [0x93c, "02"],
  [0x941, "02"],
  [0x962, "f03f02"],
  [0x968, "03"],
  [0x96c, "01"],
  [0x982, "6666666666663940"],
  [0x994, "01000001"],
  [0x9c4, "01"],
  [0x9cf, "40"],
  [0x9d7, "40"],
  [0x9df, "40"],
  [0x9e7, "40"],
  [0x9f0, "0101646401"],
  [0x9fd, "01"],
  [0xa26, "d03f"],
  [0xa30, "02010001"],
  [0xa3d, "99b93f"],
  [0xa46, "a93f"],
  [0xa4f, "4001014b"],
  [0xa6b, "c0"],
  [0xa73, "40"],
];

const PALETTE_BASE64 =
  "////////AAAAABERAAD///////8AAP//AAAAAP///////wAAAAD//wAA//8AAAAAgICAgICAoKCgoKSk///7+/DwQQJUq//q" +
  "1/JWCOyEAPx98y8FAAAAgLARa93CCKIG3d0AAAAAAAAREQAA//9mZjMzzMyZmWZm///MzJmZ/////8zMAAAAAMzMzAxgCEQE" +
  "MzNmZjMzEREAAAAAAAC7uwAAMzP//5mZMzOZmWZmAAAAAGZmMzNmZmZmmZn/////AAAAAN3dAAAAAADUmRkAAJkZMzMAAJmZ" +
  "AACZmf//AAAAAP//zMzMzP//mZmZmf//ZmZmZszMmZlmZpmZ//9mZszMAAAAADMzmZkAAGZmAACqqgAAzMzMzMzMAAAAAJmZ" +
  "3d3d3d3du7u7u7u7qqqqqqqqiIiIiIiId3d3d3d3VVVVVVVVREREREREIiIiIiIiERERERER7u5G6czM3d2O0pmZzMzXu2Zm" +
  "MrNnn7w7AIDdcaoqzUxQRJkZmRnGFokIZeb//2Xm/////8zM/////5mZ/////2Zm/////zMz/////wAA//9VVf////9VVczM" +
  "//9VVZmZ//9VVWZm//9VVTMz//9VVQAAkJBxcTo6VJWaWZpZm1lUlZpZmlmbWVSVzMz/////zMz//8zMzMz//5mZzMz//2Zm" +
  "zMz//zMzzMz//wAAzMxVVf//zMxVVczMzMxVVZmZzMxVVWZmzMxVVTMzzMxVVQAAVlYsLAUFMrO8O7w7vjsys7w7vDu+OzKz" +
  "mZn/////mZn//8zMmZn//5mZmZn//2ZmmZn//zMzmZn//wAAmZlVVf//mZlVVczMmZlVVZmZmZlVVWZmmZlVVTMzmZlVVQAA" +
  "d/ed7mXm7u4AAAAAAADu7gAAAAAAAO7uZmb/////Zmb//8zMZmb//5mZZmb//2ZmZmb//zMzZmb//wAAZmZVVf//ZmZVVczM" +
  "ZmZVVZmZZmZVVWZmZmZVVTMzZmZVVQAAquqJ1P6/3d0AAAAAAADd3QAAAAAAAN3dMzP/////MzP//8zMMzP//5mZMzP//2Zm" +
  "MzP//zMzMzP//wAAMzNVVf//MzNVVczMMzNVVZmZMzNVVWZmMzNVVTMzMzNVVQAA3d12upmZu7sAAAAAAAC7uwAAAAAAALu7" +
  "AAD/////AAD//8zMAAD//5mZAAD//2ZmAAD//zMzAAD//wAAAABVVf//AABVVczMAABVVZmZAABVVWZmAABVVTMzAABVVQAA" +
  "ENFioDJzqqoAAAAAAACqqgAAAAAAAKqq//+qqv////+qqszM//+qqpmZ//+qqmZm//+qqjMz//+qqgAA//8AAP////8AAMzM" +
  "//8AAJmZ//8AAGZm//8AADMz//8AAAAARMRPhsxMiIgAAAAAAACIiAAAAAAAAIiIzMyqqv//zMyqqszMzMyqqpmZzMyqqmZm" +
  "zMyqqjMzzMyqqgAAzMwAAP//zMwAAMzMzMwAAJmZzMwAAGZmzMwAADMzzMwAAAAAZabgbHc3d3cAAAAAAAB3dwAAAAAAAHd3" +
  "mZmqqv//mZmqqszMmZmqqpmZmZmqqmZmmZmqqjMzmZmqqgAAmZkAAP//mZkAAMzMmZkAAJmZmZkAAGZmmZkAADMzmZkAAAAA" +
  "/3/AU6sqVVUAAAAAAABVVQAAAAAAAFVVZmaqqv//ZmaqqszMZmaqqpmZZmaqqmZmZmaqqjMzZmaqqgAAZmYAAP//ZmYAAMzM" +
  "ZmYAAJmZZmYAAGZmZmYAADMzZmYAAAAAmFmgOt4dREQAAAAAAABERAAAAAAAAEREMzOqqv//MzOqqszMMzOqqpmZMzOqqmZm" +
  "MzOqqjMzMzOqqgAAMzMAAP//MzMAAMzMMzMAAJmZMzMAAGZmMzMAADMzMzMAAAAAMzOAIRERIiIAAAAAAAAiIgAAAAAAACIi" +
  "AACqqv//AACqqszMAACqqpmZAACqqmZmAACqqjMz7u7u7u7upqbKyvDwwMDc3MDAwMDAwMDAAACAgICAgIAAAICAAAAAAICA" +
  "gICAgAAAAACAgAAAgIAAAAAAAAAAAAAA";

const COLOUR_TABLE_BASE64 =
  "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";

function base64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** A record of the given type and length with a fresh GUID; its owner and next mark are set by link. */
function record(type: number, length: number, flags = 0x40): Rec {
  const d = new Uint8Array(length);
  setU64(d, 0, BigInt(length));
  d[0x19] = type;
  d[0x1f] = flags;
  const r = new Rec(d);
  r.guid = newGuid();
  return r;
}

/** Set a record's owner (the list it belongs to), whether another sibling follows it, and its saved pointer. */
function link(r: Rec, owner: bigint, next: boolean, ptr = 0n): void {
  r.owner = owner;
  setU64(r.data, 0x08, next ? NEXT_MARK : 0n);
  r.ptr10 = ptr;
}

/** Container header: the samples' common bytes, then the version, build, units and page. */
function header(mm: boolean): Uint8Array {
  const h = new Uint8Array(CONTAINER_HEADER);
  for (const [off, hex] of HEADER) h.set(hexBytes(hex), off);
  // the signature at +0x3a (the serial block at +0x20 to +0x39 is left blank)
  h.set(ascii("VectorWorks"), 0x3a);
  // created with and saved by VW31.2.0 (the u16 length at +0x0c stays as the samples have it)
  h.set(ascii("VW31.2.0 VW31.2.0"), 0x0e);
  setU32be(h, 0x50, BUILD);
  h.set(ascii(`BUILD: ${BUILD}`), 0x62);
  // millimetres first (FORMAT.md §1: the size in an inch, the unit's and area unit's names), so the
  // units writer reads units it knows and writes the chosen ones over them
  setF64(h, 0x1ac, 25.4);
  h.set(encodeUtf16("Millimeters"), 0x1c6);
  h.set(encodeUtf16("Square Meters"), 0x278);
  const units = unitsPatch(h, mm ? "Millimeters" : "Feet & Inches");
  h.set(units.bytes, units.at);
  // page size in inches: width, then height
  setF64(h, 0x190, mm ? 420 / 25.4 : 17);
  setF64(h, 0x198, mm ? 297 / 25.4 : 11);
  return h;
}

/** Colour table: the NDCD sections for colours 0 to 257, none of them named. */
function colourTable(): Rec {
  const data = base64(COLOUR_TABLE_BASE64);
  const n = 258;
  const cmyk = (k: number) => data.subarray(4 * n * k, 4 * n * (k + 1));
  const u32s = (vals: number[]) => {
    const b = new Uint8Array(4 * vals.length);
    vals.forEach((v, i) => setU32(b, 4 * i, v));
    return b;
  };
  // id, element type (8 = 4 bytes, 1 = byte), count, data: names point at one shared terminator
  const sections = [
    { id: 1, type: 8, count: 1, body: u32s([n]) },
    { id: 2, type: 8, count: n, body: cmyk(0) },
    { id: 3, type: 8, count: n, body: cmyk(1) },
    { id: 4, type: 8, count: n, body: cmyk(2) },
    { id: 5, type: 8, count: n, body: cmyk(3) },
    { id: 6, type: 1, count: n, body: data.subarray(16 * n, 17 * n) },
    { id: 7, type: 8, count: n, body: new Uint8Array(4 * n) },
    { id: 8, type: 8, count: n, body: u32s(new Array<number>(n).fill(2)) },
    { id: 9, type: 8, count: 1, body: u32s([2]) },
    { id: 10, type: 1, count: 2, body: new Uint8Array(2) },
  ];
  const directory = 11 * 6; // ten entries and an empty slot, as the samples have
  const parts = sections.map((s) => {
    const h = new Uint8Array(6);
    setU16(h, 0, s.type);
    setU32(h, 2, s.count);
    return concat([h, s.body]);
  });
  const body = concat(parts);
  const length = 0x60 + directory + body.length + 6;
  const d = new Uint8Array(length);
  d[0x19] = 76;
  d[0x1f] = 0x40;
  d.set(ascii("TDMD"), 0x50);
  setU16(d, 0x54, 5);
  d.set(ascii("NDCD"), 0x56);
  setU16(d, 0x5a, sections.length);
  setU32(d, 0x5c, length - 102);
  let at = 0x60 + directory;
  sections.forEach((s, i) => {
    setU16(d, 0x60 + 6 * i, s.id);
    setU32(d, 0x60 + 6 * i + 2, at - 0x60);
    at += parts[i].length;
  });
  d.set(body, 0x60 + directory);
  const r = new Rec(d);
  r.guid = newGuid();
  return r;
}

/** Name table: index 2 is "None", the class of new objects. */
function nameTable(): Rec {
  const d = new Uint8Array(0x58);
  setU64(d, 0x50, 1n);
  d[0x19] = 55;
  d[0x1f] = 0x40;
  const r = new Rec(d);
  r.guid = newGuid();
  writeNameTable(r, new Map([[2, "None"]]));
  return r;
}

/** Font list with one font, Arial. */
function fontList(): Rec {
  const d = new Uint8Array(0x52);
  d[0x19] = 74;
  d[0x1f] = 0x40;
  const r = new Rec(withFont(d, "Arial"));
  r.guid = newGuid();
  return r;
}

/** Palette (record 80): the 256 RGB16 entries after its 0x50-byte header. */
function palette(): Rec {
  const body = base64(PALETTE_BASE64);
  const d = new Uint8Array(0x50 + body.length);
  d[0x19] = 80;
  d[0x1f] = 0x40;
  d.set(body, 0x50);
  const r = new Rec(d);
  r.guid = newGuid();
  return r;
}

/** Design layer: scale, plan view, kind and name, with an empty title and trailer. */
function designLayer(mm: boolean): Rec {
  const d = new Uint8Array(0x2ca);
  d[0x19] = 31;
  d[0x1f] = 0x40;
  setF64(d, 0xf8, mm ? 100 : 48);
  for (let i = 0; i < 3; i++) setF64(d, 0x168 + 8 * 4 * i, 1); // identity matrix, row-major
  d[0x1c8] = 6; // plan projection
  d[0x24c] = 1; // design layer
  const name = encodeUtf16("Design Layer-1");
  setU32(d, 0x2a2, name.length);
  d.set(name, 0x2a6);
  const r = new Rec(d);
  r.guid = newGuid();
  return r;
}

/** A record ending a child list: a terminator carries no data of its own. */
function terminator(): Rec {
  return record(0, 0x58);
}

function records(mm: boolean): Rec[] {
  const out: Rec[] = [];
  const add = (r: Rec, owner: bigint, next: boolean, ptr = 0n) => {
    link(r, owner, next, ptr);
    out.push(r);
  };
  add(colourTable(), ROOT, true);
  add(nameTable(), ROOT, true);
  add(fontList(), ROOT, true);

  const classes = record(57, 0x9c);
  add(classes, ROOT, true, CLASS_LIST_PTR);
  // class None: solid black 0.254 mm pen, no fill
  const none = record(94, 188, 0x41);
  setU16(none.data, 0x1a, 2);
  writeClassAttrs(none.data, {
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
  add(none, CLASS_LIST, true);
  // the story list (FORMAT.md §5.1): the header and its tag, empty until a story is made
  const stories = record(76, 0x54);
  stories.data.set([0x4c, 0x52, 0x54, 0x53], 0x50);
  add(stories, CLASS_LIST, true);
  add(terminator(), CLASS_LIST, false);

  add(palette(), ROOT, false);

  add(designLayer(mm), ROOT, true, LAYER_PTR);
  add(terminator(), LAYER, false);

  add(terminator(), ROOT, false);
  return out;
}

/** The container header of a new drawing in the given units (legacy.ts writes a legacy drawing's units over it). */
export function blankHeader(units: "mm" | "ftin"): Uint8Array {
  return header(units === "mm");
}

/** A new drawing in the given units: one design layer, no objects. */
export function blankDrawing(units: "mm" | "ftin"): Uint8Array {
  const mm = units === "mm";
  return writeContainer(header(mm), joinRecords(records(mm)));
}
