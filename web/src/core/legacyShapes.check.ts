// Checks legacyShapes.ts on synthetic Vectorworks 2013 bodies made here (no client data). Each
// converted type's fields are written at their 2013 record offsets, and must read back through
// Rodeo's own 2018+ readers as the same values: lines, rectangles and their frames, polygons,
// arcs, rounded rectangles, symbol instances, polylines, lights, texts (the standard and the
// rebuilt layouts), groups, plug-in objects, symbol definitions, dimensions, viewports (view,
// scale and layer list) and the empty 3D boxes of solids. Identity types keep their bytes,
// images are dropped and types not converted here are left to the caller. Run from web/:
//   npx tsx src/core/legacyShapes.check.ts

import { shapeBody, shapeType } from "./legacyShapes.ts";
import { Rec } from "./records.ts";
import { decodeShape, readRectFrame, VIEWPORT_BOX, VIEWPORT_ROTATION, VIEWPORT_SHIFT, viewportIsPlan, viewportListAt, viewportScale } from "./geometry.ts";
import { readInstancePlacement, readPluginMatrix } from "./encode.ts";
import { f64, setF64, setU16, setU32 } from "./bytes.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type Pt = { x: number; y: number };
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const ptNear = (p: Pt | undefined, q: Pt): boolean => !!p && near(p.x, q.x) && near(p.y, q.y);
const MAX = Number.MAX_VALUE;
/** the 3D box of an empty group or solid, highs then lows inverted: [x0, y0, z0, x1, y1, z1] as stored */
const EMPTY_BOX = [-MAX, -MAX, -MAX, MAX, MAX, MAX];

/** Record size of the 2013 bodies below: long enough for every field they use. */
const SIZE = 0x200;
/** A 2013 body (from +0x28) of a record of `size` bytes, zeroed. */
const body13 = (size = SIZE): Uint8Array => new Uint8Array(size - 0x28);
// Writers at 2013 record offsets (the body begins at +0x28 there).
const putF = (b: Uint8Array, off: number, v: number): void => setF64(b, off - 0x28, v);
const putU16 = (b: Uint8Array, off: number, v: number): void => setU16(b, off - 0x28, v);
/** a point as stored: y at off, x at off + 8 */
const putPt = (b: Uint8Array, off: number, p: Pt): void => {
  putF(b, off, p.y);
  putF(b, off + 8, p.x);
};
/** the plan box (top, left, bottom, right) at 2013 +0x40, its body +0x18 */
const planBox = (b: Uint8Array, top: number, left: number, bottom: number, right: number): void => {
  putF(b, 0x40, top);
  putF(b, 0x48, left);
  putF(b, 0x50, bottom);
  putF(b, 0x58, right);
};
/** shapeBody's body for a 2013 body of `type`; the check fails when it gives none */
function bodyOf(type: number, b: Uint8Array): Uint8Array {
  const out = shapeBody(type, b);
  if (out instanceof Uint8Array) return out;
  check(false, `type ${type} converts to a body`);
  return new Uint8Array(0);
}
/** A 2018+ record of `type` whose body (from +0x50) is `body`, as the readers see it. */
function record(type: number, body: Uint8Array): Rec {
  const d = new Uint8Array(0x50 + body.length);
  d[0x19] = type;
  d.set(body, 0x50);
  return new Rec(d);
}
/** a 2013 rectangle's frame: origin (y, x) at +0x60, sin and cos at +0x70 / +0x78, width +0x80, height +0x88 */
function rectFrame13(b: Uint8Array, origin: Pt, sin: number, cos: number, w: number, h: number): void {
  putPt(b, 0x60, origin);
  putF(b, 0x70, sin);
  putF(b, 0x78, cos);
  putF(b, 0x80, w);
  putF(b, 0x88, h);
}

// 1. Identity types keep their bodies. A line's points are the corners of its plan box.
{
  const line = body13();
  planBox(line, 10, 20, 30, 40);
  for (const type of [2, 9, 17, 125]) check(bodyOf(type, line).every((v, i) => v === line[i]) && bodyOf(type, line).length === line.length, `type ${type} keeps its body`);
  const s = decodeShape(record(2, bodyOf(2, line)));
  check(!!s && s.points.length === 2 && ptNear(s.points[0], { x: 20, y: 10 }) && ptNear(s.points[1], { x: 40, y: 30 }), "line reads its endpoints from its plan box");
}

// 2. Rectangle: the material slot is inserted and the frame moves with the body.
{
  const b = body13();
  planBox(b, 5, 7, 25, 47);
  rectFrame13(b, { x: 7, y: 5 }, 0, 1, 40, 20);
  const out = bodyOf(3, b);
  check(out.length === b.length + 4, "rectangle gains the 4-byte material slot");
  const r = record(3, out);
  const frame = readRectFrame(r.data);
  check(ptNear(frame.o, { x: 7, y: 5 }) && near(frame.w, 40) && near(frame.h, 20), "rectangle's frame reads back (origin, width, height)");
  const s = decodeShape(r);
  check(
    !!s && s.kind === "rect" && s.points.length === 4 && ptNear(s.points[1], { x: 47, y: 5 }) && ptNear(s.points[2], { x: 47, y: 25 }) && ptNear(s.points[3], { x: 7, y: 25 }),
    "rectangle's corners come from its frame",
  );
}

// 3. An oval (type 4, a rectangle's layout) becomes the arc of its whole ellipse; a turned one is left out.
{
  const b = body13();
  planBox(b, 25, 7, 5, 47);
  rectFrame13(b, { x: 7, y: 5 }, 0, 1, 40, 20);
  check(shapeType(4) === 6 && shapeType(3) === 3, "an oval is written as an arc");
  const s = decodeShape(record(6, bodyOf(4, b)));
  check(
    !!s && ptNear(s.center, { x: 27, y: 15 }) && near(s.rx ?? NaN, 20) && near(s.ry ?? NaN, 10) && near(Math.abs(s.sweepAngle ?? NaN), 360),
    "an oval reads as the whole ellipse in its frame",
  );
  rectFrame13(b, { x: 7, y: 5 }, Math.sin(0.3), Math.cos(0.3), 40, 20);
  check(shapeBody(4, b) === null, "a turned oval is left out");
}

// 4. Polygon: closed flag, vertex count and vertices (y, x) from +0x64, 16 bytes each.
{
  const b = body13();
  b[0x61 - 0x28] = 1;
  putU16(b, 0x62, 3);
  const v: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  v.forEach((p, i) => putPt(b, 0x64 + 16 * i, p));
  const s = decodeShape(record(5, bodyOf(5, b)));
  check(!!s && s.closed && s.points.length === 3 && v.every((p, i) => ptNear(s.points[i], p)), "polygon reads its closed flag and vertices");
}

// 5. Arc: centre, radii and QuickDraw angles.
{
  const b = body13();
  planBox(b, 20, 30, 40, 70);
  putPt(b, 0x84, { x: 50, y: 30 });
  putF(b, 0x94, 0);
  putF(b, 0x9c, 90);
  const s = decodeShape(record(6, bodyOf(6, b)));
  check(
    !!s && ptNear(s.center, { x: 50, y: 30 }) && near(s.rx ?? NaN, 20) && near(s.ry ?? NaN, 10) && near(s.startAngle ?? NaN, 90) && near(s.sweepAngle ?? NaN, -90),
    "arc reads its centre, radii and angles",
  );
}

// 6. Rounded rectangle: its corner diameters (y at +0x90, x at +0x98) give the corner radii.
{
  const b = body13();
  planBox(b, 5, 7, 25, 47);
  rectFrame13(b, { x: 7, y: 5 }, 0, 1, 40, 20);
  putF(b, 0x90, 6);
  putF(b, 0x98, 10);
  const s = decodeShape(record(13, bodyOf(13, b)));
  check(!!s && near(s.roundRect?.rx ?? NaN, 5) && near(s.roundRect?.ry ?? NaN, 3), "rounded rectangle reads its corner radii");
}

// 7. Symbol instance: row-vector matrix at 2013 +0x6a and translation at +0xb2 / +0xba.
{
  const b = body13();
  putF(b, 0x6a, 0);
  putF(b, 0x72, 1);
  putF(b, 0x82, -1);
  putF(b, 0x8a, 0);
  putF(b, 0xb2, 100);
  putF(b, 0xba, 50);
  const p = readInstancePlacement(record(15, bodyOf(15, b)).data);
  check(
    near(p.a, 0) && near(p.b, 1) && near(p.c, -1) && near(p.d, 0) && near(p.e, 100) && near(p.f, 50),
    "symbol instance reads its matrix and translation",
  );
}

// 8. Polyline: vertices (y, x, kind word, radius) at +0x64, 36 bytes each.
{
  const b = body13();
  putU16(b, 0x62, 3);
  const v: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  v.forEach((p, i) => {
    const off = 0x64 + 36 * i;
    putPt(b, off, p);
    setU32(b, off + 16 - 0x28, 0); // a corner
    putF(b, off + 20, 0);
  });
  const s = decodeShape(record(21, bodyOf(21, b)));
  check(!!s && s.points.length >= 3 && v.every((p) => s.points.some((q) => ptNear(q, p))), "polyline reads its vertices");
}

// 9. Light: position (x, y) at +0x60 / +0x68, kind at +0xb6, on at +0x78.
{
  const b = body13();
  putF(b, 0x60, 12);
  putF(b, 0x68, 34);
  putU16(b, 0xb6, 1);
  b[0x78 - 0x28] = 1;
  const s = decodeShape(record(81, bodyOf(81, b)));
  check(!!s && s.kind === "light" && ptNear(s.points[0], { x: 12, y: 34 }) && s.light?.kind === "point" && s.light.on, "light reads its position, kind and on state");
}

// 10. Text: the standard one-line layout (font at +0xdc, size at font + 6), then the rebuilt one.
{
  const b = body13(0x106);
  putU16(b, 0xca, 2);
  putU16(b, 0xd4, 1);
  putU16(b, 0xdc, 1);
  putU16(b, 0xde, 0);
  putF(b, 0xe2, 3.5);
  // the characters' advances (8 bytes each) and then the UTF-16 characters, at the end of the record
  setF64(b, b.length - 20, 6);
  setF64(b, b.length - 12, 6);
  setU16(b, b.length - 4, 0x48); // H
  setU16(b, b.length - 2, 0x69); // i
  const s = decodeShape(record(10, bodyOf(10, b)));
  check(!!s && s.kind === "text" && s.text === "Hi" && near(s.textSize ?? NaN, 3.5), "one-line text reads its characters and size");
}
{
  // a font index no file has: the layout reads as garbage, so the text is rebuilt from its box
  const b = body13(0x130);
  putU16(b, 0xca, 3);
  putU16(b, 0xd4, 2);
  putU16(b, 0xde, 999);
  planBox(b, 11.7, 0, 0, 20); // 20 wide, 11.7 high (two lines of 5 at 1.17 a size)
  putF(b, 0x8c, 0); // up direction: sin 0 ...
  putF(b, 0x94, 1); // ... cos 1
  [0x41, 0x0d, 0x42].forEach((c, i) => setU16(b, b.length - 6 + 2 * i, c)); // A, CR, B
  const s = decodeShape(record(10, bodyOf(10, b)));
  check(!!s && s.text === "A\rB" && near(s.textSize ?? NaN, 5), "a text with a garbage layout is rebuilt at the size its box gives");
}
{
  // a paragraph wider than its box wraps: 11 characters, a box 20 wide and 2 lines (7.02) high, so 2 lines at size 3
  const b = body13(0x130);
  putU16(b, 0xca, 11);
  putU16(b, 0xd4, 1);
  putU16(b, 0xde, 999);
  planBox(b, 7.02, 0, 0, 20);
  putF(b, 0x8c, 0);
  putF(b, 0x94, 1);
  "AB CD EF GH".split("").forEach((ch, i) => setU16(b, b.length - 22 + 2 * i, ch.charCodeAt(0)));
  const s = decodeShape(record(10, bodyOf(10, b)));
  check(!!s && s.text === "AB CD EF\rGH" && near(s.textSize ?? NaN, 3), "a text wider than its box is wrapped at its width, at the size its box gives");
}

// 11. Group: its 3D box moves from 2013 +0x68 to 2018 +0x9c (12 bytes inserted).
{
  const b = body13();
  for (let i = 0; i < 6; i++) putF(b, 0x68 + 8 * i, i + 1);
  const out = bodyOf(11, b);
  const r = record(11, out);
  check(out.length === b.length + 12, "group gains the 12-byte container gap");
  check([0, 1, 2, 3, 4, 5].every((i) => near(f64At(r.data, 0x9c + 8 * i), i + 1)), "group's 3D box reads back at +0x9c");
}

// 12. Plug-in object: its matrix at 2013 +0xbc (linear) and +0x104 (translation).
{
  const b = body13();
  putF(b, 0xbc, 2);
  putF(b, 0xc4, 0);
  putF(b, 0xd4, 0);
  putF(b, 0xdc, 3);
  putF(b, 0x104, 7);
  putF(b, 0x10c, 9);
  const out = bodyOf(86, b);
  const m = readPluginMatrix(record(86, out).data);
  check(out.length === b.length + 12, "plug-in object gains the 12-byte container gap");
  check(near(m.a, 2) && near(m.b, 0) && near(m.c, 0) && near(m.d, 3) && near(m.e, 7) && near(m.f, 9), "plug-in object's matrix reads back where its 2013 fields are");
}

// 13. Symbol definition: attributes and plan box kept, 3D box empty, 356 bytes.
{
  const b = body13();
  b[0] = 7;
  planBox(b, 1, 2, 3, 4);
  const out = bodyOf(16, b);
  const r = record(16, out);
  check(out.length === 356 && r.data[0x50] === 7, "symbol definition is 356 bytes and keeps its attributes");
  check(near(f64At(r.data, 0x68), 1) && near(f64At(r.data, 0x70), 2) && near(f64At(r.data, 0x78), 3) && near(f64At(r.data, 0x80), 4), "symbol definition keeps its plan box");
  check(EMPTY_BOX.every((v, i) => f64At(r.data, 0x9c + 8 * i) === v), "symbol definition's 3D box is empty");
}

// 14. Dimension: attributes and plan box kept, 768 bytes.
{
  const b = body13();
  b[0] = 5;
  planBox(b, 1, 2, 3, 4);
  const out = bodyOf(63, b);
  const r = record(63, out);
  check(out.length === 768 && r.data[0x50] === 5 && near(f64At(r.data, 0x68), 1), "dimension is 768 bytes and keeps its attributes and plan box");
}

// 15. Viewport: plan box at 2013 +0x40, rotation at +0x60, shift at +0xa8, view matrix (identity for a
// plan) at +0x18c, scale at +0x220, layer and class list at +0x28c (the offsets the 2013 test file confirms).
{
  const b = body13(0x2aa);
  planBox(b, 10, -20, -30, 40);
  const turn = [0.6, -0.8, 0, 0.8, 0.6, 0, 0, 0, 1]; // a 3x3 rotation, row-major
  turn.forEach((v, i) => putF(b, 0x60 + 8 * i, v));
  putF(b, 0xa8, 123.5);
  putF(b, 0xb0, -456.25);
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => putF(b, 0x18c + 8 * i, v));
  putF(b, 0x220, 48);
  putU16(b, 0x28c, 0);
  putU16(b, 0x28e, 2); // two layers
  putU16(b, 0x290, 1); // one class
  const out = bodyOf(122, b);
  const r = record(122, out);
  check(out.length === b.length + 132, "viewport gains the 4-byte material slot and the 128-byte gap");
  check(f64At(r.data, VIEWPORT_BOX) === 10 && f64At(r.data, VIEWPORT_BOX + 8) === -20, "viewport's plan box reads back (2018 +0x68)");
  check(f64At(r.data, VIEWPORT_BOX + 16) === -30 && f64At(r.data, VIEWPORT_BOX + 24) === 40, "viewport's plan box reads back, bottom and right (2018 +0x78, +0x80)");
  check(near(f64At(r.data, VIEWPORT_ROTATION), 0.6) && near(f64At(r.data, VIEWPORT_ROTATION + 8), -0.8) && near(f64At(r.data, VIEWPORT_ROTATION + 24), 0.8), "viewport's rotation reads back (2018 +0x8c)");
  check(near(f64At(r.data, VIEWPORT_SHIFT), 123.5) && near(f64At(r.data, VIEWPORT_SHIFT + 8), -456.25), "viewport's shift reads back (2018 +0xd4)");
  check(viewportIsPlan(r.data), "viewport's view matrix reads as a plan (2018 +0x238)");
  check(viewportScale(r.data) === 48, "viewport's scale reads back (2018 +0x2cc)");
  const list = viewportListAt(r.data);
  check(list?.layers === 2 && list?.classes === 1, "viewport's layer and class list reads back (2018 +0x338)");
}

// 15b. 3D objects are left out (their 2013 layouts aren't converted).
for (const type of [24, 34, 38, 42, 84, 111, 112, 113, 114]) check(shapeBody(type, body13()) === null, `type ${type} (3D) is left out (null)`);

// 16. Images are dropped; a type this file does not convert is left to the caller.
check(shapeBody(14, body13()) === null, "image (14) is dropped (null)");
check(shapeBody(58, body13()) === undefined, "a type not converted here (58) is left to the caller (undefined)");

/** a float at a 2018+ record offset */
function f64At(d: Uint8Array, off: number): number {
  return f64(d, off);
}

console.log(failures ? `${failures} check(s) failed` : "all legacyShapes checks pass");
if (failures) process.exitCode = 1;
