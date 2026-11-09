// Checks legacyDoc.ts on synthetic Vectorworks 2013 bodies made here (no client data): each document
// type's 2013 body converts to a 2018+ body that Rodeo's own readers read back as the 2013 fields
// say. Covers the name table (exact parse, count mismatch refused, 8-bit names as Mac OS Roman),
// classes, layers (name and title, scale, visibility, kind, page, elevation), the palette, the font
// list and record formats, and what is dropped or left to shapeBody. Run from web/:
//   npx tsx src/core/legacyDoc.check.ts

import { docBody, macRoman, nameEntries } from "./legacyDoc.ts";
import { readNameTable } from "./names.ts";
import { CLASS_TEXT_STYLE, CLASS_TEXTURE, readClassAttrs, readPalette } from "./attrs.ts";
import { readFontList } from "./fonts.ts";
import { CLASS_VIS, LAYER_SCALE, LAYER_VIS, layerKindAt, layerNameAt, layerPageAt, readStr } from "./model.ts";
import { Rec } from "./records.ts";
import { setF64, setI16, setU16, setU32, setU64 } from "./bytes.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A 2013 record body (from +0x28) of `size` record bytes, zeroed; record offset X is body offset X - 0x28. */
const old = (size: number) => new Uint8Array(size - 0x28);
const at = (x: number) => x - 0x28;

/** A 2018+ body as the record it sits in (its header zeroed, which the readers here don't use). */
function record(body: Uint8Array): Uint8Array {
  const d = new Uint8Array(0x50 + body.length);
  setU64(d, 0, BigInt(d.length));
  d.set(body, 0x50);
  return d;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** the bytes of `s` in Mac OS Roman (the 8-bit text 2013 files hold), for s made of its characters */
const mac = (s: string): number[] => [...s].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : macCode(c)));
function macCode(c: string): number {
  for (let b = 0x80; b < 0x100; b++) if (macRoman(new Uint8Array([b])) === c) return b;
  throw new Error(`no Mac OS Roman byte for ${c}`);
}

// 1. Mac OS Roman: all 256 bytes agree with the platform's own decoder where it has one
{
  let decoder: TextDecoder | null = null;
  try {
    decoder = new TextDecoder("macintosh");
  } catch {
    decoder = null;
  }
  if (decoder) {
    const bad: number[] = [];
    for (let b = 0; b < 256; b++) if (macRoman(new Uint8Array([b])) !== decoder.decode(new Uint8Array([b]))) bad.push(b);
    check(bad.length === 0, `Mac OS Roman table agrees with TextDecoder("macintosh") on all 256 bytes${bad.length ? ` (differs at ${bad.map((b) => b.toString(16))})` : ""}`);
  } else {
    check(macRoman(new Uint8Array([0xa1])) === "°", "Mac OS Roman 0xA1 is the degree sign (no platform decoder here)");
  }
  check(macRoman(new Uint8Array([0xa1])) === "°", "0xA1 reads as the degree sign");
}

// 2. name table: entries of several block sizes (and a GUID-carrying block), one name with 0xA1
{
  const entries = [
    { index: 301, name: "    100.1.1.0.0.NNA", block: 43 },
    { index: 12, name: "None", block: 19 },
    { index: 140, name: "FRONT LIGHT", block: 30 },
    { index: 222, name: "Spot 26°", block: 47 },
    { index: 88, name: "Label-Colour", block: 51 },
    { index: 230, name: "{01234567-89AB-4CDE-8F01-23456789ABCD}", block: 25 },
    { index: 45, name: "Pipe Position", block: 22 },
    { index: 3, name: "Dimension", block: 60 },
  ];
  const count = entries.length;
  const body = old(0x28 + 0x50 + entries.reduce((n, e) => n + 5 + mac(e.name).length + e.block, 0));
  setU64(body, 0, 1n);
  setU32(body, at(0x30), count);
  let p = at(0x78);
  entries.forEach((e, k) => {
    const name = mac(e.name);
    setU32(body, p, e.index);
    body[p + 4] = name.length;
    body.set(name, p + 5);
    // a block of bytes that no entry can start in (a zero run, then a marker pattern)
    const block = new Uint8Array(e.block);
    for (let i = 0; i < e.block; i++) block[i] = i % 3 === 0 ? 0 : 0xd0 + (k + i) % 16;
    body.set(block, p + 5 + name.length);
    p += 5 + name.length + e.block;
  });
  const converted = docBody(55, body);
  check(converted !== undefined && converted !== null, "the name table converts");
  const rec = new Rec(record(converted as Uint8Array));
  const names = readNameTable(rec);
  check(names.size === count, `name table reads back ${names.size} of ${count} entries`);
  check(entries.every((e) => names.get(e.index) === e.name), "every name reads back by its index (8-bit 0xA1 as the degree sign)");
  check(nameEntries(body).length === count, "nameEntries reads the entries exactly");
  // a count one more than the entries is refused, not guessed at
  const wrong = body.slice();
  setU32(wrong, at(0x30), count + 1);
  let threw = false;
  try {
    docBody(55, wrong);
  } catch {
    threw = true;
  }
  check(threw, "a count that the entries do not fill is refused");
}

// 3. classes (94): attributes, visibility, and no texture or text style
{
  const b = old(112);
  setU16(b, at(0x2a), 300);
  setU16(b, at(0x2c), 256);
  setU16(b, at(0x2e), 1252);
  setU16(b, at(0x30), 257);
  setU32(b, at(0x32), (-60) >>> 0);
  b[at(0x36)] = 6;
  b[at(0x38)] = 1;
  b[at(0x3d)] = 80;
  b[at(0x3e)] = 90;
  b.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], at(0x40));
  b.set([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], at(0x4a));
  setI16(b, at(0x6e), -1);
  const converted = docBody(94, b) as Uint8Array;
  const d = record(converted);
  check(d.length === 0xbc, `a class record is 188 bytes (${d.length})`);
  const a = readClassAttrs(d);
  check(
    !!a && a.lineStyle === -60 && a.lineWeight === 6 && a.fillPattern === 1 && a.fillFore === 300 && a.fillBack === 256 && a.penFore === 1252 && a.penBack === 257 && a.fillOpacity === 80 && a.penOpacity === 90,
    "class attributes read back (line style -60, weight 6, pattern 1, colours 300/256/1252/257, opacities 80/90)",
  );
  const vis = new DataView(d.buffer, d.byteOffset).getInt16(CLASS_VIS, true);
  check(vis === -1, `class visibility reads back hidden (${vis})`);
  const dv = new DataView(d.buffer, d.byteOffset);
  check(dv.getInt32(CLASS_TEXTURE, true) === 0 && dv.getInt32(CLASS_TEXT_STYLE, true) === 0, "no texture or text style: both none");
  check(d.subarray(0x68, 0x72).every((v, i) => v === i + 1) && d.subarray(0x72, 0x7c).every((v, i) => v === i + 11), "start and end line markers carried over");
}

// 4. layers (31): a sheet with a name and title, a design with an elevation and no title
{
  const s = old(764);
  setI16(s, at(0xdc), -1);
  setF64(s, at(0xfc), 1);
  for (let k = 0; k < 9; k++) setF64(s, at(0x16c) + 8 * k, k % 4 === 0 ? 1 : 0);
  s[at(0x1cc)] = 6;
  s[at(0x236)] = 2; // sheet
  setF64(s, at(0x240), 36);
  setF64(s, at(0x248), 24);
  const sheetName = mac("Plan 1°");
  s[at(0x9c)] = sheetName.length;
  s.set(sheetName, at(0x9d));
  const title = mac("Plan");
  s[at(0x27c)] = title.length;
  s.set(title, at(0x27d));
  const sheet = record(docBody(31, s) as Uint8Array);
  check(sheet[layerKindAt(sheet)] === 2, "a sheet layer's kind is 2");
  const [name, next] = readStr(sheet, layerNameAt(sheet));
  const [titleBack] = readStr(sheet, next);
  check(name === "Plan 1°" && titleBack === "Plan", `sheet name and title read back ("${name}", "${titleBack}")`);
  const dv = new DataView(sheet.buffer, sheet.byteOffset);
  check(dv.getFloat64(LAYER_SCALE, true) === 1, "sheet scale 1");
  check(dv.getInt16(LAYER_VIS, true) === -1, "sheet visibility hidden");
  check(dv.getFloat64(layerPageAt(sheet), true) === 36 && dv.getFloat64(layerPageAt(sheet) + 8, true) === 24, "sheet page 36 x 24 in");

  const dsg = old(764);
  setF64(dsg, at(0xfc), 24);
  setF64(dsg, at(0x200), 1524);
  dsg[at(0x236)] = 1;
  dsg[at(0x9c)] = 0;
  const design = record(docBody(31, dsg) as Uint8Array);
  check(design[layerKindAt(design)] === 1, "a design layer's kind is 1");
  const [dname, dnext] = readStr(design, layerNameAt(design));
  const [dtitle] = readStr(design, dnext);
  check(dname === "Design Layer" && dtitle === "", "an unnamed design layer gets a name and an empty title");
  const dvd = new DataView(design.buffer, design.byteOffset);
  check(dvd.getFloat64(LAYER_SCALE, true) === 24 && dvd.getInt16(LAYER_VIS, true) === 0, "design scale 24, visible");
  check(dvd.getFloat64(0x1fc, true) === 1524, "design elevation 1524 mm at +0x1fc");
}

// 5. palette (80): 256 RGB16 entries, unchanged
{
  const p = new Uint8Array(1536);
  for (let i = 0; i < 256; i++) {
    setU16(p, 6 * i, i === 0 ? 0xffff : 0);
    setU16(p, 6 * i + 2, i === 0 ? 0xffff : 0);
    setU16(p, 6 * i + 4, i === 0 ? 0xffff : 0);
  }
  setU16(p, 6, 0x1100);
  setU16(p, 8, 0x2200);
  setU16(p, 10, 0x3300);
  const d = record(docBody(80, p) as Uint8Array);
  const pal = readPalette(new Rec(d));
  check(pal.length === 256 && pal[0] === "#ffffff" && pal[1] === "#112233", `palette reads back (${pal[0]}, ${pal[1]})`);
}

// 6. font list (74): u16 count, then 262-byte entries; names in Mac OS Roman
{
  const b = new Uint8Array(2 + 262 * 2);
  setU16(b, 0, 2);
  const e1 = 2;
  setU16(b, e1 + 2, 5);
  b[e1 + 4] = 9;
  b.set(ascii("Helvetica"), e1 + 5);
  const e2 = 2 + 262;
  setU16(b, e2 + 2, 9);
  const second = mac("Chére");
  b[e2 + 4] = second.length;
  b.set(second, e2 + 5);
  const names = readFontList(record(docBody(74, b) as Uint8Array));
  check(names.length === 2 && names[0] === "Helvetica" && names[1] === "Chére", `font names read back (${names.join(", ")})`);
}

// 7. record formats (47): field types, offsets, number formats and names; the table as 136-byte fields
{
  const b = new Uint8Array(12 + 70 * 2);
  setU16(b, 0, 2);
  setU16(b, 8, 1);
  setU16(b, 10, 1);
  setU16(b, 12, 2);
  setU16(b, 14, 0);
  setU16(b, 16, 0);
  b[18] = 5;
  b.set(ascii("Ready"), 19);
  const f2 = 12 + 70;
  setU16(b, f2, 7);
  setU16(b, f2 + 2, 2);
  setU16(b, f2 + 4, 5);
  b[f2 + 6] = 5;
  b.set(ascii("Width"), f2 + 7);
  const out = docBody(47, b) as Uint8Array;
  const dv = new DataView(out.buffer, out.byteOffset);
  check(out.length === 0x10 + 136 * 2 && dv.getUint16(0, true) === 2 && dv.getUint16(8, true) === 1, "format: count and plug-in flag kept");
  const f0 = 0x10;
  const f1 = 0x10 + 136;
  const nameOf = (at2: number) => {
    let s = "";
    for (let k = 0; k < 128; k += 2) {
      const c = dv.getUint16(at2 + 8 + k, true);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  check(dv.getUint16(f0, true) === 2 && dv.getUint16(f0 + 2, true) === 0 && nameOf(f0) === "Ready", "field 0: type 2 at offset 0, named Ready");
  check(dv.getUint16(f1, true) === 7 && dv.getUint16(f1 + 2, true) === 2 && dv.getUint16(f1 + 6, true) === 5 && nameOf(f1) === "Width", "field 1: type 7 at offset 2, number format 5, named Width");
}

// 8. the rest: the doc header and record data are dropped, the class list is a zeroed list, others are left to shapeBody
{
  check(docBody(33, new Uint8Array(100)) === null, "a document header (33) is dropped (Rodeo does not read it)");
  check(docBody(48, new Uint8Array(100)) === null, "record data (48) is dropped (its 2013 layout is not decoded)");
  const list = docBody(57, new Uint8Array(64)) as Uint8Array;
  check(list.length === 0x9c - 0x50 && list.every((v) => v === 0), "the class list (57) is a zeroed list record");
  check(docBody(76, new Uint8Array(40)) === undefined, "an aux record (76) is left to shapeBody (undefined here)");
  check(docBody(2, new Uint8Array(40)) === undefined, "a line (2) is left to shapeBody (undefined here)");
  check(docBody(31, new Uint8Array(724)) !== undefined, "a layer converts (the test above)");
}

// 9. a name table whose entries cannot be read at all is refused
{
  const bad = new Uint8Array(0x50 + 40);
  setU64(bad, 0, 1n);
  setU32(bad, at(0x30), 1);
  let threw = false;
  try {
    docBody(55, bad);
  } catch {
    threw = true;
  }
  check(threw, "an unreadable name table is refused");
}

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
