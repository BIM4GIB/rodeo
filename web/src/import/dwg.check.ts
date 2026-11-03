// Checks the DWG reader under Node. Run from web/:
//   npx tsx src/import/dwg.check.ts
// Small R2000 and R2004 drawings are built here bit by bit (two layers, a line, a text, a block with
// a circle and a turned, scaled insert of it, an invisible line and a paper space line) and read
// back. Files of releases before R13 and files that are not DWG fail with a message saying what to
// do. The parts of the DXF walker that DWG files lean on are checked through parseDxf: invisible
// entities, arc dimensions, tables, and splines kept only as fit points against the control points
// AutoCAD worked out for them. With DWG_SAMPLES set to a folder of public DWG files (LibreDWG's
// test-data and ACadSharp's samples, which are never committed), every file is read, and each one
// with a .dxf of the same name beside it must give the same objects by type, extents, text, colour,
// line weight, line type and units, and the same hidden layers.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Pt } from "../core/types.ts";
import { aciColor, paperDashes, parseDxf, type DxfDrawing, type DxfShape } from "./dxf.ts";
import { isDwg, parseDwg, type DwgDrawing } from "./dwg.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const nearPt = (a: Pt, b: Pt, tol = 1e-9): boolean => near(a.x, b.x, tol) && near(a.y, b.y, tol);

/** Whether `f` throws an Error whose message has `text`. */
function throwsWith(f: () => unknown, text: string): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes(text);
  }
}

/** Objects by the type they came from. */
function countsOf(d: DxfDrawing): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of d.entities) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// ---- building DWG files ---------------------------------------------------------------

/** Writes a DWG bit stream, each byte from its high bit. */
class BitWriter {
  readonly bits: number[] = [];
  bit(b: number): void {
    this.bits.push(b ? 1 : 0);
  }
  num(v: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bit(Math.floor(v / 2 ** i) % 2);
  }
  bb(v: number): void {
    this.num(v, 2);
  }
  rc(v: number): void {
    this.num(v & 0xff, 8);
  }
  rs(v: number): void {
    this.rc(v);
    this.rc(v >> 8);
  }
  rl(v: number): void {
    this.rs(v & 0xffff);
    this.rs((v >>> 16) & 0xffff);
  }
  rd(v: number): void {
    for (const b of new Uint8Array(new Float64Array([v]).buffer)) this.rc(b);
  }
  bs(v: number): void {
    if (v === 0) this.bb(2);
    else if (v < 256) {
      this.bb(1);
      this.rc(v);
    } else {
      this.bb(0);
      this.rs(v);
    }
  }
  bl(v: number): void {
    if (v === 0) this.bb(2);
    else if (v < 256) {
      this.bb(1);
      this.rc(v);
    } else {
      this.bb(0);
      this.rl(v);
    }
  }
  bd(v: number): void {
    if (v === 0) this.bb(2);
    else if (v === 1) this.bb(1);
    else {
      this.bb(0);
      this.rd(v);
    }
  }
  bd3(x: number, y: number, z = 0): void {
    this.bd(x);
    this.bd(y);
    this.bd(z);
  }
  dd(v: number, def: number): void {
    if (v === def) this.bb(0);
    else {
      this.bb(3);
      this.rd(v);
    }
  }
  /** H: a handle, absolute (code 2 to 5), or code 0 for an object's own */
  handle(value: number, code = 4): void {
    const bytes: number[] = [];
    for (let h = value; h > 0; h = Math.floor(h / 256)) bytes.unshift(h & 0xff);
    this.num(code, 4);
    this.num(bytes.length, 4);
    for (const b of bytes) this.rc(b);
  }
  tv(s: string): void {
    this.bs(s.length + 1);
    for (const ch of s) this.rc(ch.charCodeAt(0));
    this.rc(0);
  }
  append(w: BitWriter): void {
    for (const b of w.bits) this.bits.push(b);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => {
      if (b) out[i >> 3] |= 0x80 >> (i & 7);
    });
    return out;
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function le(n: number, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Math.floor(n / 2 ** (8 * i)) & 0xff;
  return out;
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

const LAYER = 51;
const BLOCK_HEADER = 49;
const TEXT = 1;
const INSERT = 7;
const CIRCLE = 18;
const LINE = 19;

interface Obj {
  readonly handle: number;
  readonly type: number;
  readonly data: BitWriter;
  readonly handles: BitWriter;
}

/** An object's bytes: its size, its data (the handle stream's place first), its handles, and a CRC left at zero. */
function objectBytes(o: Obj): Uint8Array {
  const type = new BitWriter();
  type.bs(o.type);
  const own = new BitWriter();
  own.handle(o.handle, 0);
  own.bs(0); // no extended data
  const all = new BitWriter();
  all.append(type);
  all.rl(type.bits.length + 32 + own.bits.length + o.data.bits.length);
  all.append(own);
  all.append(o.data);
  all.append(o.handles);
  const body = all.bytes();
  return concat(le(body.length, 2), body, new Uint8Array(2));
}

/** A layer or block header: its owner, no reactors or dictionary, its name, then `rest`. */
function tableObject(v: number, handle: number, type: number, name: string, rest: (d: BitWriter, h: BitWriter) => void): Obj {
  const data = new BitWriter();
  const handles = new BitWriter();
  handles.handle(1);
  data.bl(0);
  if (v >= 1018) data.bit(1);
  else handles.handle(0, 3);
  data.tv(name);
  data.bit(0);
  data.bs(0);
  data.bit(0);
  rest(data, handles);
  return { handle, type, data, handles };
}

/** A colour as an entity's ENC holds it from R2004 (a true colour flagged 0x8000), or a CMC index before. */
function colour(v: number, d: BitWriter, c: number | { rgb: number }): void {
  if (typeof c === "number") d.bs(c);
  else if (v >= 1018) {
    d.bs(0x8000);
    d.bl(0xc2000000 + c.rgb);
  } else d.bs(7);
}

/** A layer: on or off, its weight's index (from R2000) and its index colour, with no line type. */
const layer = (v: number, handle: number, name: string, aci = 7, weight = 31, off = false): Obj =>
  tableObject(v, handle, LAYER, name, (d, h) => {
    if (v <= 1014) [0, off ? 1 : 0, 0, 0].forEach((b) => d.bit(b));
    else d.bs((off ? 2 : 0) | (weight << 5));
    d.bs(aci);
    if (v >= 1018) {
      d.bl(0xc3000000 + aci);
      d.rc(0);
    }
    h.handle(0, 5); // external reference
    if (v >= 1015) h.handle(0, 5); // plot style
    h.handle(0, 5); // line type
  });

const block = (v: number, handle: number, name: string, base: Pt): Obj =>
  tableObject(v, handle, BLOCK_HEADER, name, (d) => {
    for (let k = 0; k < (v >= 1015 ? 5 : 4); k++) d.bit(0); // anonymous, attributes, xref, overlaid, loaded
    if (v >= 1018) d.bl(0);
    d.bd3(base.x, base.y);
  });

interface Place {
  /** 0 in a block (`owner` says which), 1 paper space, 2 model space */
  readonly mode: number;
  readonly owner?: number;
  readonly layer: number;
  readonly invisible?: boolean;
  /** an index colour (7 when left out; 0 by block, 256 by layer) or a true colour */
  readonly colour?: number | { rgb: number };
  /** the weight's index: 29 by layer (when left out), 31 the default */
  readonly weight?: number;
}

/** An entity: the common head every one starts with, then `body` writes its own data and handles. */
function entity(v: number, handle: number, type: number, p: Place, body: (d: BitWriter, h: BitWriter) => void): Obj {
  const data = new BitWriter();
  const handles = new BitWriter();
  data.bit(0); // no proxy graphics
  data.bb(p.mode);
  if (p.mode === 0) handles.handle(p.owner ?? 0);
  data.bl(0);
  if (v >= 1018) data.bit(1);
  else handles.handle(0, 3);
  if (v < 1018) data.bit(1); // no links to the next and previous entity
  colour(v, data, p.colour ?? 7);
  data.bd(1); // linetype scale
  handles.handle(p.layer, 5);
  data.bb(0); // linetype by layer
  data.bb(0); // plot style by layer
  data.bs(p.invisible ? 1 : 0);
  data.rc(p.weight ?? 29);
  body(data, handles);
  return { handle, type, data, handles };
}

const line = (v: number, handle: number, p: Place, a: Pt, b: Pt): Obj =>
  entity(v, handle, LINE, p, (d) => {
    d.bit(1); // flat
    d.rd(a.x);
    d.dd(b.x, a.x);
    d.rd(a.y);
    d.dd(b.y, a.y);
  });

const circle = (v: number, handle: number, p: Place, c: Pt, r: number): Obj =>
  entity(v, handle, CIRCLE, p, (d) => {
    d.bd3(c.x, c.y);
    d.bd(r);
    d.bit(1); // no thickness
    d.bit(1); // extrusion +z
  });

/** TEXT with every value at its default but the turn (radians) and height. */
const text = (v: number, handle: number, p: Place, at: Pt, height: number, turn: number, value: string): Obj =>
  entity(v, handle, TEXT, p, (d) => {
    d.rc(0xf7);
    d.rd(at.x);
    d.rd(at.y);
    d.bit(1);
    d.bit(1);
    d.rd(turn);
    d.rd(height);
    d.tv(value);
  });

/** An INSERT scaled the same on every axis and turned `turn` radians. */
const insert = (v: number, handle: number, p: Place, blockHandle: number, at: Pt, scale: number, turn: number): Obj =>
  entity(v, handle, INSERT, p, (d, h) => {
    d.bd3(at.x, at.y);
    d.bb(2);
    d.rd(scale);
    d.bd(turn);
    d.bd3(0, 0, 1);
    d.bit(0); // no attributes
    h.handle(blockHandle, 5);
  });

/** The object map: handles and places as steps from the last, a page of them, then an empty page. */
function objectMap(places: readonly [number, number][]): Uint8Array {
  const steps: number[] = [];
  let handle = 0;
  let at = 0;
  for (const [h, p] of [...places].sort((a, b) => a[0] - b[0])) {
    for (let s = h - handle; ; s = Math.floor(s / 128)) {
      if (s < 0x80) {
        steps.push(s);
        break;
      }
      steps.push((s & 0x7f) | 0x80);
    }
    const move = p - at;
    for (let s = Math.abs(move); ; s = Math.floor(s / 128)) {
      if (s < 0x40) {
        steps.push(s | (move < 0 ? 0x40 : 0));
        break;
      }
      steps.push((s & 0x7f) | 0x80);
    }
    handle = h;
    at = p;
  }
  const size = steps.length + 2;
  return Uint8Array.from([size >> 8, size & 0xff, ...steps, 0, 0, 0, 2, 0, 0]);
}

/** The drawing both builders write. */
function objects(v: number): Obj[] {
  return [
    layer(v, 0x10, "Walls", 1, 11),
    layer(v, 0x11, "Notes", 3, 31, true),
    block(v, 0x20, "BOX", { x: 1, y: 0 }),
    circle(v, 0x21, { mode: 0, owner: 0x20, layer: 0x99, colour: 0, weight: 30 }, { x: 6, y: 0 }, 2),
    line(v, 0x40, { mode: 2, layer: 0x10, colour: 256 }, { x: 0, y: 0 }, { x: 1000, y: 500 }),
    text(v, 0x41, { mode: 2, layer: 0x11, colour: 5, weight: 31 }, { x: 10, y: 20 }, 2.5, Math.PI / 6, "Hello DWG"),
    insert(v, 0x42, { mode: 2, layer: 0x10, colour: { rgb: 0x123456 }, weight: 7 }, 0x20, { x: 100, y: 50 }, 2, Math.PI / 2),
    line(v, 0x43, { mode: 2, layer: 0x10, invisible: true }, { x: 0, y: 0 }, { x: -5, y: -5 }),
    line(v, 0x44, { mode: 1, layer: 0x10 }, { x: 0, y: 0 }, { x: 5, y: 5 }),
  ];
}

/** An R2000 file: a few header bytes, one section locator (the object map), the objects, the map. */
function r2000(list: readonly Obj[]): Uint8Array {
  const head = new Uint8Array(0x40);
  head.set(ascii("AC1015"));
  head[0x13] = 30; // code page: ANSI 1252
  head.set(le(1, 4), 0x15);
  const parts: Uint8Array[] = [];
  const places: [number, number][] = [];
  let at = head.length;
  for (const o of list) {
    const b = objectBytes(o);
    places.push([o.handle, at]);
    parts.push(b);
    at += b.length;
  }
  const map = objectMap(places);
  head.set([2, ...le(at, 4), ...le(map.length, 4)], 0x19);
  return concat(head, ...parts, map);
}

/** The R2004 compression with no back references: one run of literal bytes, then the end mark. */
function literal(data: Uint8Array): Uint8Array {
  if (data.length < 19) return concat(Uint8Array.of(data.length + 17), data, Uint8Array.of(0x11));
  const r = data.length - 18;
  const zeros = Math.floor((r - 1) / 0xff);
  return concat(Uint8Array.of(0, ...new Array<number>(zeros).fill(0), r - 0xff * zeros), data, Uint8Array.of(0x11));
}

/** A system page of an R2004 file: a 20-byte header and the compressed data. */
function systemPage(type: number, data: Uint8Array): Uint8Array {
  const packed = literal(data);
  return concat(le(type, 4), le(data.length, 4), le(packed.length, 4), le(2, 4), le(0, 4), packed);
}

/**
 * An R2004 file: the header at 0x80 (XORed), then from 0x100 the object map and objects as two
 * uncompressed data pages, the section map and the page map.
 */
function r2004(list: readonly Obj[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(4)];
  const places: [number, number][] = [];
  let at = 4;
  for (const o of list) {
    const b = objectBytes(o);
    places.push([o.handle, at]);
    parts.push(b);
    at += b.length;
  }
  const sections: [string, Uint8Array][] = [
    ["AcDb:Handles", objectMap(places)],
    ["AcDb:AcDbObjects", concat(...parts)],
  ];
  const pages: Uint8Array[] = [];
  let start = 0x100;
  sections.forEach(([, data], i) => {
    const mask = (0x4164536b ^ start) >>> 0;
    const head = concat(le(0x4163043b, 4), le(i + 1, 4), le((data.length ^ mask) >>> 0, 4), new Uint8Array(20));
    pages.push(concat(head, data));
    start += 32 + data.length;
  });
  const sectionMap = concat(
    le(sections.length, 4),
    le(2, 4),
    le(0x7400, 4),
    le(0, 4),
    le(sections.length, 4),
    ...sections.map(([name, data], i) => {
      const title = new Uint8Array(64);
      title.set(ascii(name));
      const info = concat(le(data.length, 8), le(1, 4), le(0x7400, 4), le(1, 4), le(1, 4), le(i + 1, 4), le(0, 4), title);
      return concat(info, le(i + 1, 4), le(data.length, 4), le(0, 8));
    }),
  );
  pages.push(systemPage(0x4163003b, sectionMap));
  const pageMapAt = start + pages[pages.length - 1].length;
  // the page map lists every page in order, itself last; its size does not depend on what it says
  const sizes = [...pages.map((p) => p.length), systemPage(0x41630e3b, new Uint8Array(8 * (pages.length + 1))).length];
  pages.push(systemPage(0x41630e3b, concat(...sizes.map((s, i) => concat(le(i + 1, 4), le(s, 4))))));

  const file = new Uint8Array(0x100);
  file.set(ascii("AC1018"));
  file[0x13] = 30;
  const plain = new Uint8Array(0x6c);
  plain.set(ascii("AcFssFcAJMB"));
  plain.set(le(pageMapAt - 0x100, 4), 0x54);
  plain.set(le(3, 4), 0x5c); // the section map is page 3
  let seed = 1;
  for (let i = 0; i < plain.length; i++) {
    seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0;
    file[0x80 + i] = plain[i] ^ ((seed >>> 16) & 0xff);
  }
  return concat(file, ...pages);
}

// ---- the built drawings ----------------------------------------------------------------

for (const [label, bytes, release] of [
  ["R2000", r2000(objects(1015)), "2000"],
  ["R2004", r2004(objects(1018)), "2004"],
] as const) {
  check(isDwg(bytes), `${label}: taken for a DWG file`);
  let d: DwgDrawing;
  try {
    d = parseDwg(bytes);
  } catch (e) {
    check(false, `${label}: reads (${(e as Error).message})`);
    continue;
  }
  check(d.release === release && d.space === "model", `${label}: release ${d.release}, ${d.space} space`);
  check(sameCounts(countsOf(d), { LINE: 1, TEXT: 1, CIRCLE: 1 }), `${label}: a line, a text and the block's circle (${JSON.stringify(countsOf(d))})`);
  check(JSON.stringify(d.skipped) === JSON.stringify({ "PAPER SPACE": 1 }), `${label}: the paper space line is counted as left out, the invisible one is not drawn (${JSON.stringify(d.skipped)})`);
  check(Object.keys(d.unreadable).length === 0, `${label}: nothing unreadable`);
  const ln = d.entities.find((e) => e.type === "LINE");
  check(
    ln?.layer === "Walls" && ln.shape.kind === "line" && nearPt(ln.shape.a, { x: 0, y: 0 }) && nearPt(ln.shape.b, { x: 1000, y: 500 }),
    `${label}: the line runs 0,0 to 1000,500 on Walls`,
  );
  const tx = d.entities.find((e) => e.type === "TEXT");
  check(
    tx?.layer === "Notes" && tx.shape.kind === "text" && tx.shape.text === "Hello DWG" && near(tx.shape.height, 2.5) && near(tx.shape.rotation, 30, 1e-9) && nearPt(tx.shape.at, { x: 10, y: 20 }),
    `${label}: the text, its height, turn and place`,
  );
  // the block's circle at 6,0 about base 1,0, scaled 2 and turned a quarter: 100 - 10, 50 + 0 → centre 100,60
  const ci = d.entities.find((e) => e.type === "CIRCLE");
  check(
    ci?.layer === "Walls" && ci.shape.kind === "arc" && nearPt(ci.shape.center, { x: 100, y: 60 }, 1e-9) && near(ci.shape.radius, 4) && ci.shape.sweepAngle === 360,
    `${label}: the insert places the circle at 100,60, radius 4, on the insert's layer`,
  );
  check(ln?.style.color === 0xff0000 && ln.style.weight === 0.5 && ln.style.lineType === null, `${label}: the line takes its layer's colour and weight`);
  check(tx?.style.color === 0x0000ff && tx.style.weight === null, `${label}: the text has its own colour and the default weight`);
  // R2000 has no true colours, so the insert there is colour 7, which is black on paper
  const insertColour = release === "2000" ? 0x000000 : 0x123456;
  check(ci?.style.color === insertColour && ci.style.weight === 0.25, `${label}: the circle by block takes the insert's colour and weight`);
  check([...d.hiddenLayers].join() === "NOTES", `${label}: the layer that is off is hidden`);
}

// ---- files it does not read --------------------------------------------------------------

const old = new Uint8Array(64);
old.set(ascii("AC1009"));
check(throwsWith(() => parseDwg(old), "R11/R12 drawing (AC1009)") && throwsWith(() => parseDwg(old), "save it as DXF"), "an R12 file asks for a DXF or a newer DWG");
check(throwsWith(() => parseDwg(ascii("0\nSECTION\n2\nHEADER\n")), "not an AutoCAD DWG"), "a DXF file is not taken for a DWG");
check(!isDwg(ascii("0\nSECTION")), "isDwg says no to text");
const cut = r2000(objects(1015)).subarray(0, 0x30);
check(throwsWith(() => parseDwg(cut), ""), "a cut-off file fails rather than reading as empty");

// ---- the DXF walker's parts DWG files lean on ------------------------------------------------

/** A DXF file from groups: code, value, code, value... */
const dxf = (...groups: (string | number)[]): string => {
  const lines: string[] = [];
  for (let i = 0; i + 1 < groups.length; i += 2) lines.push(String(groups[i]), String(groups[i + 1]));
  return lines.join("\n") + "\n";
};
const blocks = (...body: (string | number)[]): (string | number)[] => [0, "SECTION", 2, "BLOCKS", ...body, 0, "ENDSEC"];
const entities = (...body: (string | number)[]): (string | number)[] => [0, "SECTION", 2, "ENTITIES", ...body, 0, "ENDSEC"];
const unitLine = (name: string): (string | number)[] => [0, "BLOCK", 8, 0, 2, name, 70, 1, 10, 0, 20, 0, 0, "LINE", 8, 0, 10, 0, 20, 0, 11, 10, 21, 0, 0, "ENDBLK"];
const lineOf = (s: DxfShape | undefined): [Pt, Pt] | null => (s?.kind === "line" ? [s.a, s.b] : null);

{
  const d = parseDxf(dxf(...entities(0, "LINE", 8, 0, 10, 0, 20, 0, 11, 1, 21, 0, 0, "LINE", 8, 0, 60, 1, 10, 0, 20, 0, 11, 2, 21, 0), 0, "EOF"));
  check(d.entities.length === 1 && Object.keys(d.skipped).length === 0, "an invisible entity (group 60) is not drawn, nor counted as left out");
}
{
  const d = parseDxf(dxf(...blocks(...unitLine("*D1")), ...entities(0, "ARC_DIMENSION", 8, 0, 2, "*D1", 12, 5, 22, 5), 0, "EOF"));
  const l = lineOf(d.entities[0]?.shape);
  check(d.entities.length === 1 && l !== null && nearPt(l[0], { x: 5, y: 5 }) && nearPt(l[1], { x: 15, y: 5 }), "an arc dimension draws through its block, like any dimension");
}
{
  const d = parseDxf(dxf(...blocks(...unitLine("*T1")), ...entities(0, "ACAD_TABLE", 8, 0, 2, "*T1", 10, 100, 20, 100, 11, 0, 21, 1), 0, "EOF"));
  const l = lineOf(d.entities[0]?.shape);
  check(d.entities.length === 1 && l !== null && nearPt(l[0], { x: 100, y: 100 }) && nearPt(l[1], { x: 100, y: 110 }), "a table draws its block, turned to its horizontal direction");
}

// ---- colours, weights and line types -----------------------------------------------------------

check(
  aciColor(1) === 0xff0000 && aciColor(7) === 0 && aciColor(12) === 0xcc0000 && aciColor(21) === 0xff9f7f && aciColor(140) === 0x00bfff && aciColor(250) === 0x333333 && aciColor(255) === 0xffffff,
  "AutoCAD's index colours, 7 black on paper",
);
{
  const tables = [0, "SECTION", 2, "TABLES",
    0, "TABLE", 2, "LTYPE", 0, "LTYPE", 2, "DASHED", 73, 2, 40, 0.75, 49, 0.5, 74, 0, 49, -0.25, 74, 0, 0, "ENDTAB",
    0, "TABLE", 2, "LAYER", 0, "LAYER", 2, "Walls", 70, 0, 62, 1, 6, "DASHED", 370, 50, 0, "LAYER", 2, "Off", 70, 0, 62, -3, 6, "Continuous", 0, "LAYER", 2, "Frozen", 70, 1, 62, 4, 6, "Continuous", 0, "ENDTAB",
    0, "ENDSEC"];
  const header = [0, "SECTION", 2, "HEADER", 9, "$LTSCALE", 40, 2, 0, "ENDSEC"];
  const box = [0, "BLOCK", 8, 0, 2, "B", 70, 0, 10, 0, 20, 0, 0, "LINE", 8, 0, 62, 0, 370, -2, 6, "BYBLOCK", 10, 0, 20, 0, 11, 1, 21, 0, 0, "ENDBLK"];
  const d = parseDxf(dxf(...header, ...tables, ...blocks(...box), ...entities(
    0, "LINE", 8, "Walls", 10, 0, 20, 0, 11, 1, 21, 0,
    0, "LINE", 8, "Walls", 420, 0x123456, 370, 13, 6, "Continuous", 10, 0, 20, 0, 11, 1, 21, 0,
    0, "LINE", 8, "Walls", 62, 3, 48, 0.5, 6, "DASHED", 10, 0, 20, 0, 11, 1, 21, 0,
    0, "INSERT", 8, "Walls", 2, "B", 62, 5, 370, 35, 10, 0, 20, 0,
    0, "LINE", 8, "Off", 10, 0, 20, 0, 11, 1, 21, 0,
  ), 0, "EOF"));
  const [byLayer, own, scaled, byBlock] = d.entities.map((e) => e.style);
  check(byLayer?.color === 0xff0000 && byLayer.weight === 0.5 && byLayer.lineType?.name === "DASHED" && byLayer.lineType.dashes.join() === "1,-0.5", "by layer: the layer's colour, weight and line type, its dashes times $LTSCALE");
  check(own?.color === 0x123456 && own.weight === 0.13 && own.lineType === null, "a true colour, a weight of its own and a continuous line");
  check(scaled?.color === 0x00ff00 && scaled.lineType?.dashes.join() === "0.5,-0.25", "an index colour, and a line type at its own scale");
  check(byBlock?.color === 0x0000ff && byBlock.weight === 0.35 && byBlock.lineType?.name === "DASHED", "by block: the insert's colour, weight and line type");
  check([...d.hiddenLayers].sort().join() === "FROZEN,OFF" && d.entities.length === 5, "layers that are off or frozen are hidden, and what is on them still read");
}
check(JSON.stringify(paperDashes([0.5, -0.25, 0, -0.25], 1)) === "[0.5,0.25,0.01,0.25]", "a dash, gap, dot, gap line type in paper inches");
check(JSON.stringify(paperDashes([-0.2, 0.6], 2)) === "[1.2,0.4]", "a pattern that starts on a gap starts on its dash");
check(JSON.stringify(paperDashes([0.3, -0.2, 0.1], 1)) === "[0.4,0.2]", "a dash at both ends is one dash");
check(paperDashes([1], 1) === null && paperDashes([], 1) === null, "a pattern with no gap is solid");

// ---- hatches ---------------------------------------------------------------------------------

/** A HATCH's groups: solid or not, its loops' groups, then its pattern's. */
const hatchOf = (solid: boolean, loops: (string | number)[][], pattern: (string | number)[] = [], extra: (string | number)[] = []): (string | number)[] => [
  0, "HATCH", 8, 0, 62, 1, 10, 0, 20, 0, 30, 0, 210, 0, 220, 0, 230, 1, 2, solid ? "SOLID" : "USER", 70, solid ? 1 : 0, 71, 0, ...extra,
  91, loops.length, ...loops.flat(), 75, 0, 76, 1, ...pattern, 98, 0,
];
/** A polyline loop through the corners. */
const polyLoop = (pts: [number, number][]): (string | number)[] => [92, 2, 72, 0, 73, 1, 93, pts.length, ...pts.flatMap(([x, y]) => [10, x, 20, y]), 97, 0];
{
  const d = parseDxf(dxf(...entities(...hatchOf(true, [polyLoop([[0, 0], [10, 0], [10, 10], [0, 10]]), polyLoop([[3, 3], [7, 3], [7, 7], [3, 7]])])), 0, "EOF"));
  const s = d.entities[0]?.shape;
  check(s?.kind === "fill" && s.rings.length === 2 && s.rings[1].length === 4 && d.entities[0].style.color === 0xff0000, "a solid hatch is a fill of its loops, the hole too, in its colour");
}
{
  // horizontal lines one apart from y = 0.5, dashed half on, half off, over a square of edges
  const edges = [92, 1, 93, 4, 72, 1, 10, 0, 20, 0, 11, 10, 21, 0, 72, 1, 10, 10, 20, 0, 11, 10, 21, 10, 72, 1, 10, 10, 20, 10, 11, 0, 21, 10, 72, 1, 10, 0, 20, 10, 11, 0, 21, 0, 97, 0];
  const pattern = [52, 0, 41, 1, 77, 0, 78, 1, 53, 0, 43, 0, 44, 0.5, 45, 0, 46, 1, 79, 2, 49, 0.5, 49, -0.5];
  const d = parseDxf(dxf(...entities(...hatchOf(false, [edges], pattern)), 0, "EOF"));
  const s = d.entities[0]?.shape;
  const inside = (p: Pt): boolean => p.x >= -1e-9 && p.x <= 10 + 1e-9 && p.y > 0 && p.y < 10;
  check(
    s?.kind === "strokes" && s.segments.length === 100 && s.segments.every(([a, b]) => inside(a) && inside(b) && near(b.x - a.x, 0.5) && near(a.y, b.y)),
    "a patterned hatch is its lines cut to the loop and to their dashes",
  );
}
{
  // a quarter disc below the x axis: a line out, a clockwise arc (its angles stored mirrored), a line back
  const loop = [92, 1, 93, 3, 72, 1, 10, 0, 20, 0, 11, 5, 21, 0, 72, 2, 10, 0, 20, 0, 40, 5, 50, 0, 51, 90, 73, 0, 72, 1, 10, 0, 20, -5, 11, 0, 21, 0, 97, 0];
  const d = parseDxf(dxf(...entities(...hatchOf(true, [loop])), 0, "EOF"));
  const s = d.entities[0]?.shape;
  check(s?.kind === "fill" && s.rings[0].length > 4 && s.rings[0].every((p) => p.x >= -1e-9 && p.y <= 1e-9 && Math.hypot(p.x, p.y) <= 5 + 1e-9), "a clockwise arc edge bounds the quarter it sweeps");
}
{
  const d = parseDxf(dxf(...entities(...hatchOf(false, [polyLoop([[0, 0], [1, 0], [1, 1]])], [], [450, 1, 451, 0, 452, 0, 453, 2, 460, 0, 461, 0, 462, 1, 463, 0, 63, 3, 421, 0x00aa00, 463, 1, 421, 0xffffff, 470, "LINEAR"])), 0, "EOF"));
  check(d.entities[0]?.shape.kind === "fill" && d.entities[0].style.color === 0x00aa00, "a gradient hatch is filled in its first colour");
}

// Fit points and end tangents of a spline, and the knots and control points AutoCAD worked out for
// them (from a public sample's DXF). Read from fit points alone it must sample to the same curve.
{
  const fit = [
    [-1160.70828949499, 1466.29959801825],
    [-803.2584206390579, 1216.773557430618],
    [-1263.536333621469, 1021.066859620477],
    [-1297.812348330295, 1896.854333640411],
    [-1493.675290112675, 1867.498328089189],
    [-1449.606128933269, 1436.943592467027],
  ];
  const knots = [0, 0, 0, 0, 435.9284960592313, 936.0853402063389, 1812.54329403786, 2010.593961861958, 2443.398157005357, 2443.398157005357, 2443.398157005357, 2443.398157005357];
  const ctrl = [
    [-1160.70828949499, 1466.29959801825],
    [-1278.733898858219, 1381.536363400083],
    [-393.9544459252916, 1231.131526494542],
    [-1793.156271927829, 719.5692228288901],
    [-936.5505143705686, 1967.430418368798],
    [-1656.363244849998, 1879.620298503901],
    [-1444.406509911975, 1581.117926364117],
    [-1449.606128933269, 1436.943592467027],
  ];
  const tangents = [12, -0.8122360233169471, 22, -0.5833289315868635, 13, -0.0360413721468526, 23, -0.9993502986909906];
  const fromFit = parseDxf(dxf(...entities(0, "SPLINE", 8, 0, 70, 8, 71, 3, ...tangents, ...fit.flatMap(([x, y]) => [11, x, 21, y])), 0, "EOF"));
  const fromCtrl = parseDxf(
    dxf(...entities(0, "SPLINE", 8, 0, 70, 8, 71, 3, ...knots.flatMap((k) => [40, k]), ...ctrl.flatMap(([x, y]) => [10, x, 20, y])), 0, "EOF"),
  );
  const a = fromFit.entities[0]?.shape;
  const b = fromCtrl.entities[0]?.shape;
  check(
    a?.kind === "polyline" && b?.kind === "polyline" && a.points.length === b.points.length && a.points.every((p, i) => nearPt(p, b.points[i], 1e-6)),
    "a spline of fit points and end tangents is AutoCAD's curve through them",
  );
}

// ---- public sample files, when there are some ---------------------------------------------------

const samples = process.env.DWG_SAMPLES;
if (samples) {
  /** Pairs whose DWG and DXF are not one save of one drawing, so they differ for reasons of their own. */
  const DIFFERENT_SAVES = new Set(["BLOCKPOLARPARAMETER.dwg"]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.dwg$/i.test(n)) files.push(p);
    }
  };
  walk(samples);
  const releases = new Set<string>();
  let read = 0;
  let older = 0;
  let twins = 0;
  const boxOf = (d: DxfDrawing, type: string): number[] => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (p: Pt): void => {
      box[0] = Math.min(box[0], p.x);
      box[1] = Math.min(box[1], p.y);
      box[2] = Math.max(box[2], p.x);
      box[3] = Math.max(box[3], p.y);
    };
    for (const e of d.entities) {
      if (e.type !== type) continue;
      const s = e.shape;
      if (s.kind === "point" || s.kind === "text") add(s.at);
      else if (s.kind === "line") [s.a, s.b].forEach(add);
      else if (s.kind === "polyline") s.points.forEach(add);
      else if (s.kind === "fill") s.rings.forEach((r) => r.forEach(add));
      else if (s.kind === "strokes") s.segments.forEach((seg) => seg.forEach(add));
      else if (s.kind === "arc") {
        const ry = s.radiusY ?? s.radius;
        add({ x: s.center.x - s.radius, y: s.center.y - ry });
        add({ x: s.center.x + s.radius, y: s.center.y + ry });
      }
    }
    return box;
  };
  const textsOf = (d: DxfDrawing): string => d.entities.flatMap((e) => (e.shape.kind === "text" ? [e.shape.text] : [])).sort().join("|");
  /** How many objects draw in each colour, weight and line type (with its dashes), by type. */
  const stylesOf = (d: DxfDrawing): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const e of d.entities) {
      const lt = e.style.lineType;
      const k = `${e.type} #${e.style.color.toString(16).padStart(6, "0")} ${e.style.weight ?? "-"} ${lt ? `${lt.name.toUpperCase()}[${lt.dashes.map((x) => +x.toPrecision(6))}]` : "-"}`;
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const hiddenOf = (d: DxfDrawing): string => [...d.hiddenLayers].sort().join("|");
  for (const path of files) {
    const name = path.slice(samples.length + 1);
    const bytes = new Uint8Array(readFileSync(path));
    let d: DwgDrawing;
    try {
      d = parseDwg(bytes);
    } catch (e) {
      const message = (e as Error).message;
      if (message.includes("save it as DXF")) older++;
      else check(false, `${name} reads (${message})`);
      continue;
    }
    read++;
    releases.add(d.release);
    if (Object.keys(d.unreadable).length > 0) check(false, `${name}: objects it could not decode ${JSON.stringify(d.unreadable)}`);
    const twin = path.replace(/\.dwg$/i, ".dxf");
    if (!existsSync(twin) || DIFFERENT_SAVES.has(path.split("/").pop() ?? "")) continue;
    // as the app reads a DXF file: UTF-8, else Windows-1252
    const raw = readFileSync(twin);
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      source = new TextDecoder("windows-1252").decode(raw);
    }
    const x = parseDxf(source);
    twins++;
    const a = countsOf(d);
    const b = countsOf(x);
    const differences: string[] = [];
    if (!sameCounts(a, b)) differences.push(`objects ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    else {
      for (const type of Object.keys(a)) {
        const p = boxOf(d, type);
        const q = boxOf(x, type);
        const tol = 1e-6 * Math.max(1, ...q.map(Math.abs));
        if (p.some((v, i) => Math.abs(v - q[i]) > tol)) differences.push(`${type} extents ${p} vs ${q}`);
      }
      if (textsOf(d) !== textsOf(x)) differences.push("text");
      const sa = stylesOf(d);
      const sb = stylesOf(x);
      if (!sameCounts(sa, sb)) {
        const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter((k) => sa[k] !== sb[k]).sort();
        differences.push(`styles ${keys.slice(0, 6).map((k) => `${k}: ${sa[k] ?? 0} vs ${sb[k] ?? 0}`).join(", ")}`);
      }
      if (hiddenOf(d) !== hiddenOf(x)) differences.push(`hidden layers ${hiddenOf(d)} vs ${hiddenOf(x)}`);
    }
    if (d.mmPerUnit !== x.mmPerUnit) differences.push(`units ${d.mmPerUnit} vs ${x.mmPerUnit}`);
    if (differences.length > 0) check(false, `${name} matches its DXF: ${differences.join("; ")}`);
  }
  check(read > 0, `${read} sample files read (${[...releases].sort().join(", ")}); ${older} from before R13 refused with a message`);
  check(twins > 0, `${twins} of them match the DXF file beside them`);
}

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
