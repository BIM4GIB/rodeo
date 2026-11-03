// Checks the library part reader under Node. Run from web/:
//   npx tsx src/import/archicad/libparts.check.ts
// Payloads built here with made-up values, laid out as Archicad 25, 27 and 29 lay them out, read
// back: a door with its wall, story, layer, library part, parameters, size, sill, position along
// the wall, mirror and side flags; a skylight in a roof; an object and a lamp with position, angle,
// size, ZZYZX height and the lamp's switch, colour and intensity from its parameters; a parameter
// list with every kind of value (numbers, text, booleans, arrays of numbers, booleans and strings);
// a library part file in the packed library and one in the embedded library, with ancestry and a
// script; an object cut short counts as a problem instead of throwing. With PLN_SAMPLES set to a
// folder of Archicad files, every element, reference, parameter list and library item in each
// decodes, and the plausibility of what it holds is printed as counts and shares only: stories
// and layers that resolve to the file's attributes, hosts that are walls and roofs, positions along
// the host wall, sizes in range, parts and parameters found, library files that are GDL parts.

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ATTRIBUTE_CLASSES, readAttributes } from "./attributes.ts";
import {
  gsmScript,
  LIBPART_CLASSES,
  LIBPART_CONTENT_CLASS,
  readGdlParams,
  readGsm,
  readLibPartReference,
  readLibraryHeaders,
  readLibParts,
  readLibraryFiles,
  SUBTYPE,
  type GdlParam,
} from "./libparts.ts";
import { type ArchicadObject, f64, hex, i32, objectsInFile, u16, utf16At } from "./objects.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number | null | undefined, b: number): boolean => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

// ---- writing payloads ---------------------------------------------------------------------------

const CLS = {
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
  wall: "8245654faf33524eabfcc35d46765ec4",
  roof: "21764c9de9512345a3baf2121777bcbe",
  floor: "256b04bcd6271a46a6e56fa0e8594a95",
};
const LINK = {
  doorWall: "02fe6b1f0cd6ae409ac8c3953ce12814",
  skylightRoof: "57ad135b9577b5429762c3037113fa83",
  openingStory: "fa4c2e430499ca45a76b1b944ffc4041",
  skylightStory: "9328e0696afc5043afee158ef7726ebe",
  objectStory: "0312b67984ae884da9c620ead705e0bc",
  openingPart: "461c2f67f364f5418a4affdfd86bcbfd",
  objectPart: "3e459f182eea384eafe9660d1d25afc6",
  marker: "f9c22af4fbbebe4789c9595aacc3089d",
  userParams: "a4f0eb76efc23f48a1a828d3adde99a0",
  currentParams: "588778494a52594789accec113bc37f1",
  programParams: "1c08998a590f7a45854e7200720c14e1",
  headerContent: "efc2d99a176b014e884fdd0e18593724",
  curtainWallPanel: "d4f1c2304cec4c439e65ef83c3648eac",
};

class Out {
  private b: number[] = [];
  get at(): number {
    return this.b.length;
  }
  u8(...v: number[]): this {
    for (const x of v) this.b.push(x & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v, v >> 8);
  }
  u32(v: number): this {
    return this.u8(v, v >> 8, v >> 16, v >>> 24);
  }
  f64(v: number): this {
    const t = new DataView(new ArrayBuffer(8));
    t.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.b.push(t.getUint8(i));
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
  str(s: string): this {
    this.u16(1).u32(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    return this;
  }
  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i));
    return this;
  }
  bytes(d: Uint8Array): this {
    for (const x of d) this.b.push(x);
    return this;
  }
  setU32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.b[at + i] = (v >>> (8 * i)) & 0xff;
  }
  setF64(at: number, v: number): void {
    const t = new DataView(new ArrayBuffer(8));
    t.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.b[at + i] = t.getUint8(i);
  }
  setU8(at: number, v: number): void {
    this.b[at] = v & 0xff;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

/** A made-up object GUID. */
let serial = 0;
const id = (): string => (++serial).toString(16).padStart(8, "0") + "5eed0000c0ffee00decafbad";
/** Made-up library part GUID bytes and their text form (Windows order). */
const GUID_BYTES = "78563412cdab01ef0123456789abcdef";
const GUID_TEXT = "12345678-ABCD-EF01-0123-456789ABCDEF";
const REV_BYTES = "efbeadde0d0cfeca0011223344556677";
const REV_TEXT = "DEADBEEF-0C0D-CAFE-0011-223344556677";
/** A subtype's text form back to stored bytes. */
function guidBytes(text: string): string {
  const h = text.replace(/-/g, "").toLowerCase();
  const rev = (s: string): string => s.match(/../g)!.reverse().join("");
  return rev(h.slice(0, 8)) + rev(h.slice(8, 12)) + rev(h.slice(12, 16)) + h.slice(16);
}

/** Class GUID, the object header, then `body(w)`; then the references. */
function payload(cls: string, body: (w: Out) => void, links: readonly [string, string][]): Uint8Array {
  const w = new Out().hex(cls).u8(2, 0, 0).u32(7).zeros(4).u32(99).zeros(4).u32(0);
  body(w);
  const table = new Out().u16(1);
  for (const [key, ref] of links) table.u8(0x12).hex(key).hex(ref);
  table.u8(0);
  const t = table.done();
  return w.u32(t.length).bytes(t).done();
}

type Version = 25 | 27 | 29;

/** An element: version chain, sized block with the element header, F fields set by `fields(F + s)`, the ID, 9 bytes; then `after`. */
function element(
  cls: string,
  version: Version,
  chain: readonly number[],
  bases: number,
  fieldBytes: number,
  fields: (w: Out, at: number) => void,
  ident: string,
  after: (w: Out) => void,
  links: readonly [string, string][],
): Uint8Array {
  return payload(
    cls,
    (w) => {
      for (const v of chain) w.u16(v);
      const size = w.at;
      w.u32(0);
      const start = w.at;
      w.u16(1).u16(1);
      if (version === 25) w.u16(7).u16(4).u16(0x82);
      else w.u16(9).u16(version === 29 ? 0x83 : 0x82);
      w.u8(3, 0, 0, 1).hex(cls).u16(bases);
      for (let i = 0; i < bases; i++) w.u16(2);
      if (version === 29) {
        const z = w.at;
        w.zeros(0x62 + 4 * bases);
        w.setU32(z + 0x10, 0x62);
      }
      const f = w.at;
      w.u8(9).u16(1).u32(3).zeros(4);
      const s = version === 25 ? 10 : 0;
      w.zeros(fieldBytes + s - (w.at - f));
      fields(w, f + s);
      w.str(ident).zeros(9);
      w.setU32(size, w.at - start);
      after(w);
    },
    links,
  );
}

const FLOOR = id();
const WALL = id();
const ROOF = id();
const REF = id();
const USER = id();
const CURRENT = id();
const PROGRAM = id();
const MARKER = id();

function door(version: Version): Uint8Array {
  return element(
    CLS.door,
    version,
    [3, version === 25 ? 7 : 8, 0x105],
    version === 25 ? 9 : 8,
    0x6e,
    (w, q) => {
      w.setU8(q + 0x17, 1);
      w.setU8(q + 0x18, 0);
      w.setU8(q + 0x19, 1);
      w.setF64(q + 0x1c, 0.95);
      w.setF64(q + 0x24, 2.15);
    },
    "D-1",
    (w) => {
      const B = w.at;
      w.zeros(version === 29 ? 120 : 116);
      w.setU8(B + 0x0c, 0xff);
      w.setF64(B + 0x0f, 1.75);
      w.setF64(B + 0x27, 1);
      w.setF64(B + 0x37, 0.05);
      w.setF64(B + 0x3f, 0.02);
      w.setF64(B + 0x47, 0.07);
      w.setF64(B + 0x57, 0.08);
      w.setF64(B + 0x5f, 0.09);
      w.setU8(B + 0x67, 1);
      w.setF64(B + 0x6a, 0.11);
    },
    [
      [LINK.doorWall, WALL],
      [LINK.openingStory, FLOOR],
      [LINK.openingPart, REF],
      [LINK.marker, MARKER],
    ],
  );
}

function skylight(version: Version): Uint8Array {
  return element(
    CLS.skylight,
    version,
    [3, 0x105],
    7,
    0x6e,
    (w, q) => {
      w.setF64(q + 0x1c, 0.78);
      w.setF64(q + 0x24, 1.18);
    },
    "S-1",
    (w) => {
      w.u8(0, 0, 1).zeros(7);
      for (const v of [0.4, 0.6, 12.5, -3.25, 0, 0, 4.1, 0.5, 0.7, 0.1, 0]) w.f64(v);
    },
    [
      [LINK.skylightRoof, ROOF],
      [LINK.skylightStory, FLOOR],
      [LINK.openingPart, REF],
    ],
  );
}

function placedObject(cls: string, version: Version, owner: string | null): Uint8Array {
  const links: [string, string][] = [
    [LINK.objectStory, FLOOR],
    [LINK.objectPart, REF],
  ];
  if (owner) links.push([LINK.curtainWallPanel, owner]);
  return element(
    cls,
    version,
    cls === CLS.light ? [4, 0x107] : [7, 0x107],
    7,
    0x77,
    (w, q) => {
      w.setU8(q + 0x21, 1);
      w.setU8(q + 0x22, cls === CLS.light ? 1 : 0);
      [3.5, -2.25, Math.PI / 6, 0.4, 1.2, 0.6].forEach((v, i) => w.setF64(q + 0x26 + 8 * i, v));
    },
    "O-1",
    () => {},
    links,
  );
}

function reference(): Uint8Array {
  return payload(
    CLS.reference,
    (w) => {
      w.u16(1).u16(0x83).u32(3).u16(1).u16(2).hex(GUID_BYTES).hex(REV_BYTES);
      w.str("Made Up Door.gsm").str("Made Up Door").hex(guidBytes(SUBTYPE.door)).zeros(16).str("Made Up Library");
    },
    [
      [LINK.userParams, USER],
      [LINK.currentParams, CURRENT],
      [LINK.programParams, PROGRAM],
    ],
  );
}

interface P {
  name: string;
  code: number;
  value?: number;
  array?: { dims: [number, number]; data: Uint8Array; extra: number };
  data?: Uint8Array;
}
const utf16z = (s: string): Out => {
  const w = new Out();
  for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i));
  return w.u16(0);
};
const pad8 = (w: Out): Out => w.zeros((8 - (w.at % 8)) % 8);

function paramList(cls: string, params: readonly P[]): Uint8Array {
  return payload(
    cls,
    (w) => {
      w.u16(1).u16(8).u16(0x83).u32(3).u16(1).u16(1);
      const records = new Out();
      const data = new Out();
      const dataStart = 16 + 72 * params.length;
      for (const p of params) {
        const rec = records.at;
        records.u16(p.code).u8(p.array ? 1 : 0, 0x10).u32(p.array?.dims[0] ?? 0).u32(p.array?.dims[1] ?? 0).zeros(4);
        if (p.value !== undefined && [2, 3, 4, 6].includes(p.code)) records.f64(p.value);
        else records.u32(p.value ?? 0).zeros(4);
        records.ascii(p.name).zeros(32 - p.name.length);
        const bytes = p.array?.data ?? p.data;
        records.u32(bytes ? dataStart + data.at : 0).u32(bytes ? bytes.length : 0).u32(p.array?.extra ?? 0).u32(0);
        if (records.at - rec !== 72) throw new Error("record size");
        if (bytes) data.bytes(bytes);
      }
      const block = new Out().u32(params.length).u32(0).zeros(8).bytes(records.done()).bytes(data.done()).done();
      w.u32(block.length).bytes(block);
    },
    [],
  );
}

const reals = (...v: number[]): Uint8Array => {
  const w = new Out();
  for (const x of v) w.f64(x);
  return w.done();
};
const ints = (extra: number, ...v: number[]): Uint8Array => {
  const w = new Out();
  for (const x of v) w.u32(x);
  pad8(w);
  return w.zeros(extra).done();
};

const PARAMS: P[] = [
  { name: "A", code: 2, value: 1.2 },
  { name: "B", code: 2, value: 0.6 },
  { name: "ZZYZX", code: 2, value: 0.9 },
  { name: "openingAngle", code: 3, value: Math.PI / 4 },
  { name: "panelCount", code: 0, value: 3, data: pad8(utf16z("three")).done() },
  { name: "hasHandle", code: 13, value: 1 },
  { name: "finish", code: 12, data: pad8(utf16z("made up finish")).done() },
  { name: "gs_light_switch", code: 5, value: 1 },
  { name: "gs_color_red", code: 6, value: 1 },
  { name: "gs_color_green", code: 6, value: 0.5 },
  { name: "gs_color_blue", code: 6, value: 0 },
  { name: "gs_light_intensity", code: 7, value: 80 },
  { name: "frameMat", code: 9, value: 12 },
  { name: "sizes", code: 2, array: { dims: [3, 0], data: reals(0.1, 0.2, 0.3), extra: 0 } },
  { name: "grid", code: 0, array: { dims: [2, 3], data: ints(16, 1, 2, 3, 4, 5, 6), extra: 16 } },
  { name: "flags", code: 13, array: { dims: [3, 0], data: ints(8, 1, 0, 1), extra: 8 } },
  { name: "labels", code: 12, array: { dims: [2, 0], data: pad8(new Out().bytes(utf16z("left").done()).bytes(utf16z("right").done())).done(), extra: 0 } },
  { name: "layout", code: 15 },
];

/** A made-up library part file: header, directory, a 2D script and the ancestry. */
function gsm(version = 0x28): Uint8Array {
  const script = new Out().u8(0xef, 0xbb, 0xbf).ascii("LINE2 0, 0, A, 0\n").done();
  const scriptSection = new Out().ascii("CSD2WW").u16(0x14).u32(16 + script.length).u32(0).bytes(script).done();
  const anc = new Out().ascii("SCNAWW").u16(1).u32(0).u32(0).zeros(4).u32(2).zeros(0x30 - 0x18);
  anc.hex(guidBytes(SUBTYPE.generalObject)).zeros(16).hex(guidBytes(SUBTYPE.door)).zeros(16);
  const ancs = anc.done();
  new DataView(ancs.buffer).setUint32(8, ancs.length, true);
  const w = new Out().ascii("WW").u16(version).zeros(0x24 - 4).u32(2).ascii("MYSM").zeros(4).ascii("DAEH").u32(0x80).u32(32).u32(0);
  w.zeros(8).hex(GUID_BYTES).hex(REV_BYTES).zeros(0x80 - 0x68);
  const first = 0x80 + 32;
  w.ascii("CSD2").u32(first).u32(scriptSection.length).u32(0);
  w.ascii("SCNA").u32(first + scriptSection.length).u32(ancs.length).u32(0);
  return w.bytes(scriptSection).bytes(ancs).done();
}

// ---- synthetic checks ---------------------------------------------------------------------------

function byClass(list: readonly [string, Uint8Array][]): Map<string, ArchicadObject[]> {
  const m = new Map<string, ArchicadObject[]>();
  for (const [g, data] of list) {
    const cls = hex(data, 0, 16);
    let l = m.get(cls);
    if (!l) m.set(cls, (l = []));
    l.push({ guid: g, data });
  }
  return m;
}

{
  const params = readGdlParams(paramList(CLS.currentParams, PARAMS));
  const get = (n: string): GdlParam | undefined => params.find((p) => p.name === n);
  check(params.length === PARAMS.length, "a parameter list reads every record");
  check(get("A")?.type === "length" && near(get("A")?.value as number, 1.2), "a length parameter reads as f64");
  check(get("openingAngle")?.type === "angle" && near(get("openingAngle")?.value as number, Math.PI / 4), "an angle parameter reads in radians");
  check(get("panelCount")?.value === 3 && get("panelCount")?.text === "three", "an integer parameter reads with its display text");
  check(get("hasHandle")?.value === true, "a boolean parameter reads as a boolean");
  check(get("finish")?.value === "made up finish", "a string parameter reads from the data area");
  check(get("frameMat")?.type === "material" && get("frameMat")?.value === 12, "a material parameter is its attribute index");
  check(JSON.stringify(get("sizes")?.value) === "[0.1,0.2,0.3]" && JSON.stringify(get("sizes")?.dims) === "[3,0]", "a length array reads its values");
  check(JSON.stringify(get("grid")?.value) === "[1,2,3,4,5,6]" && JSON.stringify(get("grid")?.dims) === "[2,3]", "a two-dimensional integer array reads row by row");
  check(JSON.stringify(get("flags")?.value) === "[true,false,true]", "a boolean array reads as booleans");
  check(JSON.stringify(get("labels")?.value) === '["left","right"]', "a string array reads every string");
  check(get("layout")?.type === "title" && get("layout")?.value === null, "a title has no value");
}

{
  const r = readLibPartReference(reference());
  check(r.mainGuid === GUID_TEXT && r.revisionGuid === REV_TEXT, "a reference's GUIDs read in their text form");
  check(r.fileName === "Made Up Door.gsm" && r.name === "Made Up Door" && r.library === "Made Up Library", "a reference's file, part and library names read");
  check(r.subtype === SUBTYPE.door, "a reference's subtype reads");
}

{
  const file = gsm();
  const g = readGsm(file);
  check(g !== null && g.mainGuid === GUID_TEXT && g.revisionGuid === REV_TEXT && g.signature === "MYSM" && g.version === 0x28, "a library part file's identity reads");
  check(readGsm(gsm(0x2b))?.version === 0x2b, "a library part file of a later format version reads too");
  check(g !== null && g.sections.map((s) => s.name).join(",") === "2DSC,ANCS", "its sections are named forwards");
  check(g !== null && g.ancestry.join(",") === `${SUBTYPE.generalObject},${SUBTYPE.door}`, "its ancestry reads root first");
  check(g !== null && gsmScript(file, g, "2DSC") === "LINE2 0, 0, A, 0\n", "its 2D script reads as text without the byte order mark");
  check(readGsm(new Uint8Array(200)) === null, "bytes that aren't a library part file are refused");
}

for (const version of [25, 27, 29] as const) {
  const contentGuid = id();
  const content = payload(
    "2cf8aa6f31c18b4fb1d99706144935dd",
    (w) => {
      const f = gsm(version === 25 ? 0x28 : 0x2b);
      w.u16(1).u8(3, 0, 0).str("Made Up Door.gsm").str("model/vnd.gs-gdl").u32(0).ascii("CASG").zeros(16).u32(0).u32(f.length).bytes(f);
    },
    [],
  );
  const header = payload(CLS.symbolHeader, (w) => w.u16(1).u16(1).u16(1).u8(3, 0, 0).str("Made Up Door.gsm"), [[LINK.headerContent, contentGuid]]);
  const otherHeader = payload(CLS.header, (w) => w.u16(1).u16(1).u8(3, 0, 0).str("made up texture.jpg"), [[LINK.headerContent, id()]]);
  const embedded = payload(
    CLS.embedded,
    (w) => {
      const f = gsm();
      w.u16(3).u16(1).u16(0x83).u32(3).u32(0x420).u32(0x421).u8(1, 1).u32(0).u8(1, 2).u32(0).u32(2);
      w.u8(2, 1).u32(0).str("Made Up Folder").u8(2, 1).u32(0).str("Embedded Door.gsm");
      w.u32(0).u32(1).u8(1).u32(1600000000).u32(f.length).bytes(f);
    },
    [],
  );
  const objects = byClass([
    [id(), door(version)],
    [id(), skylight(version)],
    [id(), placedObject(CLS.symb, version, null)],
    [id(), placedObject(CLS.symb, version, WALL)],
    [id(), placedObject(CLS.light, version, null)],
    [REF, reference()],
    [CURRENT, paramList(CLS.currentParams, PARAMS)],
    [USER, paramList(CLS.userParams, PARAMS.slice(0, 3))],
    [PROGRAM, paramList(CLS.programParams, PARAMS.slice(0, 1))],
    [contentGuid, content],
    [id(), header],
    [id(), otherHeader],
    [id(), embedded],
    [id(), door(version).subarray(0, 300)],
  ]);
  const r = readLibParts(objects);
  const v = `Archicad ${version}:`;
  const d = r.doors[0];
  check(r.doors.length === 1 && r.problems.Door === 1, `${v} the door reads; the one cut short is a problem`);
  check(d?.wall === WALL && d.floor === FLOOR && d.layer === 3 && d.id === "D-1" && d.marker === MARKER, `${v} the door's wall, story, layer, ID and marker read`);
  check(near(d?.width, 0.95) && near(d?.height, 2.15) && near(d?.sill, 0.05) && near(d?.head, 2.2) && near(d?.along, 1.75), `${v} the door's size, sill, head and place along the wall read`);
  check(d?.mirrored === true && d.otherSide === false && d.refSide === true && d.anchor === -1 && d.reveal === true, `${v} the door's flags read`);
  check(near(d?.revealDepthOffset, 0.02) && near(d?.jambDepthHead, 0.07) && near(d?.jambDepth, 0.08) && near(d?.jambDepth2, 0.09) && near(d?.revealDepthFromSide, 0.11), `${v} the door's reveal and jambs read`);
  check(d?.libPart?.mainGuid === GUID_TEXT && d.libPart.currentParams === CURRENT && d.params.length === PARAMS.length, `${v} the door's library part and Current parameters are found`);
  const s = r.skylights[0];
  check(s?.roof === ROOF && s.floor === FLOOR && near(s.width, 0.78) && near(s.height, 1.18), `${v} the skylight's roof, story and size read`);
  check(near(s?.position.x, 12.5) && near(s?.position.y, -3.25) && near(s?.level, 4.1) && near(s?.azimuth, 0.5) && near(s?.pitch, 0.7), `${v} the skylight's anchor, level, azimuth and pitch read`);
  const o = r.objects.find((x) => !x.owner);
  check(r.objects.length === 2 && o !== undefined && near(o.position.x, 3.5) && near(o.position.y, -2.25) && near(o.position.z, 0.4), `${v} the object's position reads`);
  check(near(o?.angle, Math.PI / 6) && near(o?.a, 1.2) && near(o?.b, 0.6) && near(o?.height, 0.9) && o?.mirrored === true, `${v} the object's angle, size, height and mirror read`);
  check(r.objects.find((x) => x.owner)?.owner?.kind === "curtain wall panel", `${v} an object made by a curtain wall says so`);
  const l = r.lamps[0];
  check(l?.on === true && l.color?.r === 255 && l.color.g === 128 && l.color.b === 0 && l.intensity === 80, `${v} the lamp's switch, colour and intensity come from its parameters`);
  const part = r.libraryParts.find((p) => p.mainGuid === GUID_TEXT);
  check(part !== undefined && part.uses === 5 && part.header !== null && part.content === contentGuid && part.embedded !== null, `${v} the catalogue joins the reference, the packed file and the embedded file by GUID`);
  check(part?.kind === "door" && part.subtype === SUBTYPE.door, `${v} the part's kind comes from its subtype`);
  const headers = readLibraryHeaders(objects).headers;
  check(headers.length === 2 && headers.filter((h) => h.gdl).length === 1 && headers.find((h) => h.gdl)?.content === contentGuid, `${v} the packed library's headers list a GDL file and another file`);
  const files = readLibraryFiles(objects).files;
  check(files.length === 1 && files[0].mime === "model/vnd.gs-gdl" && files[0].gsm?.mainGuid === GUID_TEXT, `${v} the packed library's file reads`);
}

// ---- the sample files -----------------------------------------------------------------------------

const ELEMENT_NAMES: readonly [string, string][] = [
  [CLS.door, "Door"],
  [CLS.window, "Wind"],
  [CLS.skylight, "VBElem::Skylight"],
  [CLS.symb, "Symb"],
  [CLS.light, "Light"],
];

/** A wall's layer and length, read roughly for the check (the walls module reads walls properly): the element header as in libparts.ts, the layer at F+3, the ID at F+0x21 (+10 in Archicad 25), then begin and end points. */
function wallOf(d: Uint8Array): { layer: number; length: number } | null {
  const at = hex(d, 0, 16);
  let p = 39;
  for (; p < 120; p++) if (hex(d, p, 16) === at) break;
  if (p >= 120) return null;
  const n = u16(d, p + 16);
  const e = p + 18 + 2 * n;
  const v29 = d[p - 6] === 0x83;
  const v25 = d[p - 8] === 4;
  const f = v29 ? e + 0x62 + 4 * n : e;
  if (d[f + 1] !== 1 || d[f + 2] !== 0) return null;
  const id = utf16At(d, f + 0x21 + (v25 ? 10 : 0));
  if (!id || id.end + 32 > d.length) return null;
  const [x0, y0, x1, y1] = [0, 8, 16, 24].map((k) => f64(d, id.end + k));
  const length = Math.hypot(x1 - x0, y1 - y0);
  return Number.isFinite(length) && length > 0 && length < 1e4 ? { layer: i32(d, f + 3), length } : null;
}

const share = (n: number, of: number): string => (of === 0 ? "-" : `${((100 * n) / of).toFixed(1)}%`);

const dir = process.env.PLN_SAMPLES;
if (dir) {
  const names = (await readdir(dir)).filter((f) => /\.(pln|pla)$/i.test(f)).sort();
  const totals = new Map<string, [number, number]>();
  const add = (cls: string, ok: number, all: number): void => {
    const t = totals.get(cls) ?? [0, 0];
    totals.set(cls, [t[0] + ok, t[1] + all]);
  };
  let fileNo = 0;
  for (const name of names) {
    fileNo++;
    const tag = `file ${fileNo}:`;
    const wanted = new Set([...LIBPART_CLASSES, LIBPART_CONTENT_CLASS, ...ATTRIBUTE_CLASSES, CLS.wall, CLS.roof]);
    const objects = objectsInFile(readFileSync(join(dir, name)), wanted);
    const count = (cls: string): number => objects.get(cls)?.length ?? 0;
    const r = readLibParts(objects);
    const attrs = readAttributes(objects);
    const problems = Object.entries(r.problems).filter(([, v]) => v > 0);
    check(problems.length === 0, `${tag} nothing failed to decode${problems.length ? ` (${problems.map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);

    const decoded: [string, number][] = [
      [CLS.door, r.doors.length],
      [CLS.window, r.windows.length],
      [CLS.skylight, r.skylights.length],
      [CLS.symb, r.objects.length],
      [CLS.light, r.lamps.length],
    ];
    console.log(`     ${tag} ${decoded.map(([c, n]) => `${ELEMENT_NAMES.find((e) => e[0] === c)?.[1]} ${n}/${count(c)}`).join(", ")}`);
    for (const [c, n] of decoded) add(ELEMENT_NAMES.find((e) => e[0] === c)?.[1] ?? c, n, count(c));

    // references and parameter lists, every one of them
    let refs = 0;
    for (const o of objects.get(CLS.reference) ?? [])
      try {
        readLibPartReference(o.data);
        refs++;
      } catch {
        /* counted */
      }
    add("VBElem::LibPartReference", refs, count(CLS.reference));
    const listCounts: string[] = [];
    let paramCount = 0;
    for (const [cls, label] of [
      [CLS.userParams, "VBElem::UserGDLParamList"],
      [CLS.currentParams, "VBElem::CurrentGDLParamList"],
      [CLS.programParams, "VBElem::ProgramGDLParamList"],
    ] as const) {
      let ok = 0;
      for (const o of objects.get(cls) ?? [])
        try {
          paramCount += readGdlParams(o.data).length;
          ok++;
        } catch {
          /* counted */
        }
      add(label, ok, count(cls));
      listCounts.push(`${label.split("::")[1]} ${ok}/${count(cls)}`);
    }
    console.log(`     ${tag} LibPartReference ${refs}/${count(CLS.reference)}, ${listCounts.join(", ")}, ${paramCount} parameters`);
    check(refs === count(CLS.reference), `${tag} every library part reference reads`);

    // stories and layers resolve to the attributes of the story's database
    const databases = [attrs, ...attrs.modules];
    const layersOfFloor = new Map<string, Set<number>>();
    for (const db of databases) {
      const layers = new Set(db.layers.map((l) => l.index));
      for (const s of db.stories) layersOfFloor.set(s.guid, layers);
    }
    const all = [...r.doors, ...r.windows, ...r.skylights, ...r.objects, ...r.lamps];
    const free = [...r.objects, ...r.lamps].filter((o) => !o.owner);
    const placedOnStory = all.filter((e) => e.floor !== null);
    const withFloor = placedOnStory.filter((e) => layersOfFloor.has(e.floor!));
    const ownedNoFloor = [...r.objects, ...r.lamps].filter((o) => o.owner && o.floor === null).length;
    const freeNoFloor = free.filter((o) => o.floor === null).length;
    const elements = [...r.skylights, ...free].filter((e) => e.floor !== null && layersOfFloor.has(e.floor));
    const layerOk = elements.filter((e) => layersOfFloor.get(e.floor!)!.has(e.layer));
    console.log(
      `     ${tag} story resolves ${share(withFloor.length, placedOnStory.length)} of ${placedOnStory.length} with one; none: ${ownedNoFloor} made by another element, ${freeNoFloor} free objects; free objects' layer in their database ${share(layerOk.length, elements.length)}`,
    );
    check(withFloor.length === placedOnStory.length, `${tag} every story an element refers to is an EDB::Floor of the file`);
    check(elements.length === 0 || layerOk.length / elements.length > 0.99, `${tag} free objects' layers are layers of their database`);

    // hosts, places along the wall, sizes
    const walls = new Map((objects.get(CLS.wall) ?? []).map((o) => [o.guid, o]));
    const roofs = new Set((objects.get(CLS.roof) ?? []).map((o) => o.guid));
    const openings = [...r.doors, ...r.windows];
    const hosted = openings.filter((o) => o.wall !== null && walls.has(o.wall));
    let measured = 0;
    let within = 0;
    let layerZero = 0;
    let layerAsWall = 0;
    let layerOther = 0;
    for (const o of hosted) {
      const wall = wallOf(walls.get(o.wall!)!.data);
      if (wall === null) continue;
      measured++;
      if (o.along >= -0.01 && o.along <= wall.length + 0.01) within++;
      if (o.layer === 0) layerZero++;
      else if (o.layer === wall.layer) layerAsWall++;
      else if (o.floor && layersOfFloor.get(o.floor)?.has(o.layer)) layerOther++;
    }
    console.log(`     ${tag} openings' layer: 0 ${share(layerZero, measured)}, the wall's ${share(layerAsWall, measured)}, another layer of the database ${share(layerOther, measured)}`);
    check(layerZero + layerAsWall + layerOther === measured, `${tag} openings' layers are 0 (the wall's) or layers of their database`);
    const sane = openings.filter((o) => o.width >= 0 && o.width < 30 && o.height > 0 && o.height < 30 && Math.abs(o.sill) < 100);
    const zeroWidth = openings.filter((o) => o.width === 0);
    const roofed = r.skylights.filter((s) => s.roof !== null && roofs.has(s.roof));
    console.log(
      `     ${tag} opening host is a Wall ${share(hosted.length, openings.length)}, along within the wall ${share(within, measured)} of ${measured} measured, sizes in range ${share(sane.length, openings.length)} (width 0: ${zeroWidth.length}, of them with an A parameter above 0: ${zeroWidth.filter((o) => (o.params.find((p) => p.name === "A")?.value as number) > 0).length}), skylight host is a Roof ${share(roofed.length, r.skylights.length)}`,
    );
    check(hosted.length === openings.length, `${tag} every door and window is in a wall of the file`);
    check(roofed.length === r.skylights.length, `${tag} every skylight is in a roof of the file`);
    check(sane.length === openings.length, `${tag} opening sizes and sills are in range`);
    check(measured === 0 || within / measured > 0.95, `${tag} openings sit along their wall`);

    const objs = [...r.objects, ...r.lamps];
    const sized = free.filter((o) => Math.abs(o.a) < 1000 && Math.abs(o.b) < 1000 && Math.abs(o.position.x) < 1e6 && Math.abs(o.position.y) < 1e6 && Math.abs(o.position.z) < 1e4);
    const owned = new Map<string, number>();
    for (const o of objs) if (o.owner) owned.set(o.owner.kind, (owned.get(o.owner.kind) ?? 0) + 1);
    console.log(
      `     ${tag} free objects ${free.length} of ${objs.length}, in range ${share(sized.length, free.length)}, with ZZYZX ${share(objs.filter((o) => o.height !== null).length, objs.length)}, mirrored ${share(objs.filter((o) => o.mirrored).length, objs.length)}, made by another element: ${[...owned].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
    );
    check(sized.length === free.length, `${tag} free objects' positions and sizes are in range`);
    const lampsColored = r.lamps.filter((l) => l.color !== null);
    if (r.lamps.length)
      console.log(`     ${tag} lamps on ${share(r.lamps.filter((l) => l.on).length, r.lamps.length)}, with colour ${share(lampsColored.length, r.lamps.length)}, with intensity ${share(r.lamps.filter((l) => l.intensity !== null).length, r.lamps.length)}`);

    const withPart = all.filter((e) => e.libPart !== null);
    const withParams = all.filter((e) => e.params.length > 0);
    console.log(`     ${tag} library part found ${share(withPart.length, all.length)}, parameters found ${share(withParams.length, all.length)}`);
    check(all.length === 0 || withPart.length / all.length > 0.99, `${tag} elements' library parts are found`);
    const kindOk = (list: readonly { libPart: { subtype: string } | null }[], subtype: string): number => list.filter((e) => e.libPart?.subtype === subtype).length;
    console.log(
      `     ${tag} subtype matches the class: doors ${share(kindOk(r.doors, SUBTYPE.door), r.doors.length)}, windows ${share(kindOk(r.windows, SUBTYPE.window), r.windows.length)}, skylights ${share(kindOk(r.skylights, SUBTYPE.skylight), r.skylights.length)}, lamps ${share(kindOk(r.lamps, SUBTYPE.lamp), r.lamps.length)}`,
    );

    // the library
    const files = readLibraryFiles(objects);
    const headers = readLibraryHeaders(objects).headers;
    const contentGuids = new Set(files.files.map((f) => f.guid));
    check(headers.every((h) => h.content !== null && contentGuids.has(h.content)), `${tag} every packed library header refers to its file`);
    const gdl = files.files.filter((f) => /gdl/.test(f.mime));
    const parsed = gdl.filter((f) => f.gsm !== null);
    const byKind = new Map<string, number>();
    for (const p of r.libraryParts) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    const usedFound = r.libraryParts.filter((p) => p.uses > 0 && (p.content !== null || p.embedded !== null));
    console.log(
      `     ${tag} packed library files ${files.files.length}/${count(LIBPART_CONTENT_CLASS)} (GDL ${gdl.length}, read as parts ${parsed.length}), headers ${headers.filter((h) => h.gdl).length} GDL + ${headers.filter((h) => !h.gdl).length} other, embedded items ${count(CLS.embedded)} (parts ${r.libraryParts.filter((p) => p.embedded).length}); catalogue ${r.libraryParts.length} parts (${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}), placed parts with their file ${share(usedFound.length, r.libraryParts.filter((p) => p.uses > 0).length)}`,
    );
    add("DatabaseLibraryContainerLibPartContent", files.files.length, count(LIBPART_CONTENT_CLASS));
    check(files.files.length === count(LIBPART_CONTENT_CLASS), `${tag} every packed library file reads`);
    check(gdl.filter((f) => f.fileName.toLowerCase().endsWith(".gsm")).every((f) => f.gsm !== null), `${tag} every packed .gsm reads as a library part file`);
  }
  console.log("     all files:");
  for (const [cls, [ok, all]] of totals) console.log(`     ${cls} ${ok}/${all}`);
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all ok");
