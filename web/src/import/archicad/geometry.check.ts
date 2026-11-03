// Checks the reader of Archicad's stored element drawings (./geometry.ts) on VirtSy payloads built
// here from made-up values, laid out as Archicad 29 and Archicad 25 lay them out: a hotspot, lines,
// a circle, a polyline with a rounded corner and a fill with an arc edge and a hole come back in
// the view's coordinates (the drawing's origin added), with their pens and colour, the element,
// view, holder and group they belong to (the closing list with a GUID list and a 0x11 entry in
// it), the view's kind and the element's frame (none when stored as zeros; a skewed one kept).
// A drawing with a text record keeps its fills (they follow the font list). A short object, a
// record count that doesn't match and an element frame with stretched axes are counted as
// problems, not thrown. With PLN_SAMPLES set to a folder of .pln/.pla files, every VirtSy object
// in each decodes; numbers are finite and in range, points lie in the drawing's box, views
// resolve, wall and slab frames stand at the bottom of their section and elevation drawings, and
// the share of elements of each kind that have a drawing is printed (counts only; nothing from
// the files is printed).
//   npx tsx src/import/archicad/geometry.check.ts
//   PLN_SAMPLES=~/samples npx tsx src/import/archicad/geometry.check.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fillContours, GEOMETRY_CLASSES, readGeometry, VIRTSY_CLASS, type ViewDrawing, type ViewKind } from "./geometry.ts";
import { objectsInFile, OBJECT_DATA, type ArchicadObject } from "./objects.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

// ---- building payloads ---------------------------------------------------------------------------

class Bytes {
  readonly b: number[] = [];
  get length(): number {
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
  f64(...v: number[]): this {
    const dv = new DataView(new ArrayBuffer(8));
    for (const x of v) {
      dv.setFloat64(0, x, true);
      for (let i = 0; i < 8; i++) this.b.push(dv.getUint8(i));
    }
    return this;
  }
  guid(h: string): this {
    for (let i = 0; i < 32; i += 2) this.b.push(parseInt(h.slice(i, i + 2), 16));
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.b.push(0);
    return this;
  }
  bytes(o: Bytes): this {
    for (const x of o.b) this.b.push(x);
    return this;
  }
  /** content padded with zeros to `size` bytes from `from` */
  padTo(from: number, size: number): this {
    return this.zeros(from + size - this.b.length);
  }
}

// Format constants (the same in every file): roles in the closing list, and a section's class.
const ROLE_ELEMENT = "78f39898252c2e4686b95e6b7a9aa0e4";
const ROLE_VIEW = "d1895284f49c9b4c9180744cbf6834f9";
const ROLE_HOLDER = "107f08794bfd834c95165e790a7e4519";
const ROLE_GROUP = "80b955a819fd60458bc17a2b82c4f5aa";
const SECTION_CLASS = "509ae4f923d3a845bd880d6b82e6aa7a";

// Made-up GUIDs.
const g = (c: string): string => c.repeat(32);
const ELEMENT = g("a");
const OTHER_ELEMENT = g("b");
const VIEW = g("c");
const HOLDER = g("d");
const GROUP = g("e");
const FILL = g("f");
const HOT_ID = g("1");

interface Content {
  readonly texts?: boolean;
  /** lines claimed in the header beyond those written */
  readonly extraLineCount?: number;
}

/** A vector image: one hotspot, two lines, a circle, a polyline with a rounded corner, a fill with an arc edge and a hole. */
function vectorImage(c: Content): Bytes {
  const counts = new Array<number>(12).fill(0);
  counts[0] = 1;
  counts[1] = 2 + (c.extraLineCount ?? 0);
  counts[2] = 1;
  counts[4] = 1;
  counts[9] = c.texts ? 1 : 0;
  counts[10] = 1;
  const v = new Bytes().u32(0x80).u8(1, 0x24, 0x6d, 0x6d);
  v.f64(-1, -1, 4, 3); // box, before the origin is added
  v.u8(0).u32(50).u32(0).u32(0);
  for (const n of counts) v.u32(n);
  for (let i = 0; i < 12; i++) v.u16(0x2500);
  // hotspot
  let at = v.u8(2).u32(80).length;
  v.zeros(20).f64(0.5, 0.25, 0.75, 0).padTo(at, 53).guid(HOT_ID);
  // lines
  for (const [pen, x1, y1, x2, y2] of [
    [7, 0, 0, 3, 0],
    [8, 3, 0, 3, 2],
  ]) {
    at = v.u8(3).u32(60).length;
    v.u8(1, 0).u16(pen).padTo(at, 16).f64(x1, y1, x2, y2).padTo(at, 54);
  }
  // a circle of radius 0.5 around (1, 1)
  at = v.u8(4).u32(120).length;
  v.u8(1, 0).u16(9).padTo(at, 14).u8(1).f64(1, 1, 0.5, 0, 1, 0, 0, 1.5, 1, 1.5, 1).padTo(at, 107);
  // the fill's reference
  at = v.u8(6).u32(24).length;
  v.u8(1, 0, 0, 0).guid(FILL);
  if (c.texts) v.u8(11).u32(240).zeros(213);
  // a polyline (0, 0), (1, 0), (1, 1), the edge from the second point to the third an arc turning a quarter
  at = v.u8(12).u32(300).length;
  v.u8(1, 0, 0, 0).u16(11).padTo(at, 16).u32(3).u32(1).u32(48).u32(0).u32(16).u32(0);
  v.f64(0, 0, 1, 0, 1, 1).u32(2).u32(3).f64(Math.PI / 2).zeros(2);
  v.u8(0).u32(0);
  // after the records: zeros, or a font list when there are texts; then the fills
  if (c.texts) v.u16(1).u32(1).u16(1).u32(4).u16(0x46).u16(0x6f).u16(0x6e).u16(0x74).zeros(3);
  else v.zeros(9);
  v.u16(1).u32(1);
  // the fill: a 2 x 2 square, its right side bulging out as a half circle, with a square hole
  v.guid(FILL);
  at = v.length;
  v.u8(3, 1).padTo(at, 10).u16(12).padTo(at, 37).u16(0x1010).u16(0x8080).u16(0xffff).padTo(at, 55);
  const coords = [
    [0, 0],
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
    [0, 0],
    [0.5, 0.5],
    [0.5, 1.5],
    [1.5, 1.5],
    [1.5, 0.5],
    [0.5, 0.5],
  ];
  v.u32(coords.length);
  for (const [x, y] of coords) v.f64(x, y);
  v.u16(1).u32(1).u32(2).u32(3).f64(Math.PI);
  v.u16(1).u32(3).u32(0).u32(5).u32(10);
  v.zeros(100).guid(FILL).zeros(7);
  return v;
}

interface Payload extends Content {
  readonly ac25?: boolean;
  readonly element?: string;
  readonly origin?: readonly [number, number];
  /** 12 doubles; zeros when left out */
  readonly frame?: readonly number[];
}

/** A whole VirtSy object: class GUID, object header, framework, vector image, placement, closing list. */
function virtsy(p: Payload): Uint8Array {
  const b = new Bytes().guid(VIRTSY_CLASS).u8(2, 0, 0).u32(1).zeros(4).u32(1).zeros(4).u32(0);
  if (b.length !== OBJECT_DATA) throw new Error("object header");
  // the class/data version chain, then the image's prefix
  if (p.ac25) b.u8(0x0d, 0, 1, 0, 1, 0, 7, 0, 4, 0, 0x82, 0, 3, 0, 0, 1).guid(VIRTSY_CLASS).zeros(24).u8(0, 0, 9, 1);
  else b.u8(0x11, 0, 1, 0, 1, 0, 9, 0, 0x83, 0, 3, 0, 0, 1).guid(VIRTSY_CLASS).zeros(30).u8(1, 0, 9, 1);
  const image = vectorImage(p);
  b.u32(image.length).bytes(image);
  const element = p.element ?? ELEMENT;
  if (p.ac25) b.u16(5).guid(element).guid(g("9")).zeros(16).u16(0).u16(1);
  else b.guid(g("8")).guid(element).guid(g("9")).zeros(16).u8(0).u16(1);
  b.f64(...(p.origin ?? [0, 0]));
  if (p.ac25) b.u8(0);
  b.u16(0);
  b.f64(...(p.frame ?? new Array<number>(12).fill(0)));
  b.f64(0, 0, 0).zeros(10);
  const roles = new Bytes().u8(1, 0);
  roles.u8(0x12).guid(ROLE_ELEMENT).guid(element);
  roles.u8(0x01).guid(g("7")).u32(2).guid(g("6")).guid(g("5"));
  roles.u8(0x12).guid(ROLE_VIEW).guid(VIEW);
  roles.u8(0x11).guid(ROLE_HOLDER).guid(HOLDER);
  roles.u8(0x12).guid(ROLE_GROUP).guid(GROUP);
  roles.u8(0);
  b.u32(roles.length).bytes(roles);
  return Uint8Array.from(b.b);
}

function objectsOf(payloads: readonly [string, Uint8Array][]): Map<string, ArchicadObject[]> {
  return new Map([
    [VIRTSY_CLASS, payloads.map(([guid, data]) => ({ guid, data }))],
    [SECTION_CLASS, [{ guid: VIEW, data: new Uint8Array(64) }]],
  ]);
}

// ---- made-up drawings ----------------------------------------------------------------------------

const turn = Math.PI / 6;
const rotation = [Math.cos(turn), -Math.sin(turn), 0, 4, Math.sin(turn), Math.cos(turn), 0, 5, 0, 0, 1, -0.5];

function drawingChecks(name: string, d: ViewDrawing | undefined, ox: number, oy: number): void {
  check(d !== undefined, `${name}: decodes`);
  if (!d) return;
  check(d.element === ELEMENT && d.view === VIEW && d.viewKind === "section" && d.holder === HOLDER && d.group === GROUP, `${name}: element, view (a section), holder and group`);
  check(near(d.origin.x, ox) && near(d.origin.y, oy) && d.scale === 50, `${name}: origin and scale`);
  check(d.box !== null && near(d.box.xMin, ox - 1) && near(d.box.yMin, oy - 1) && near(d.box.xMax, ox + 4) && near(d.box.yMax, oy + 3), `${name}: box moved by the origin`);
  check(d.hotspots.length === 3 && near(d.hotspots[0], ox + 0.5) && near(d.hotspots[1], oy + 0.25) && near(d.hotspots[2], 0.75), `${name}: hotspot x, y and depth`);
  const l = [...d.lines];
  const want = [ox, oy, ox + 3, oy, ox + 3, oy, ox + 3, oy + 2];
  check(l.length === 8 && l.every((v, i) => near(v, want[i])) && d.linePens.join() === "7,8", `${name}: lines and pens`);
  const a = [...d.arcs];
  const wantArc = [ox + 1, oy + 1, 0.5, 1, 0, 0, 0];
  check(a.length === 7 && a.every((v, i) => near(v, wantArc[i])) && d.arcPens[0] === 9, `${name}: circle`);
  const pl = d.polylines;
  const n = pl.starts[1] - pl.starts[0];
  const pts = pl.points;
  const onCorner = (i: number): boolean => near(Math.hypot(pts[2 * i] - ox - 0.5, pts[2 * i + 1] - oy - 0.5), Math.SQRT1_2, 1e-9);
  let corner = true;
  for (let i = 1; i < n - 1; i++) corner &&= onCorner(i);
  check(pl.pens[0] === 11 && n === 20 && near(pts[0], ox) && near(pts[1], oy) && near(pts[2 * n - 2], ox + 1) && near(pts[2 * n - 1], oy + 1) && corner, `${name}: polyline with its arc corner turned into points`);
  const f = d.fills;
  const contours = fillContours(f, 0);
  check(f.pens.length === 1 && f.pens[0] === 12 && [...f.rgb].join() === "16,128,255", `${name}: fill pen and colour`);
  check(contours.length === 2 && contours[0].length / 2 === 39 && contours[1].length / 2 === 4, `${name}: fill outline (arc edge as points, first point not repeated) and hole`);
  if (contours.length === 2) {
    const o = contours[0];
    let bulge = 0;
    let round = true;
    for (let i = 2; i < o.length; i += 2) {
      if (o[i] - ox > 2 + 1e-9) {
        bulge = Math.max(bulge, o[i] - ox);
        round &&= near(Math.hypot(o[i] - ox - 2, o[i + 1] - oy - 1), 1);
      }
    }
    check(near(bulge, 3) && round && near(o[0], ox) && near(o[1], oy), `${name}: the arc edge bulges out a half circle`);
    const h = [...contours[1]];
    check([ox + 0.5, oy + 0.5, ox + 0.5, oy + 1.5, ox + 1.5, oy + 1.5, ox + 1.5, oy + 0.5].every((v, i) => near(v, h[i])), `${name}: hole points`);
  }
}

{
  const g29 = readGeometry(objectsOf([["01".repeat(16), virtsy({ origin: [10, 2], frame: rotation })]]));
  check(Object.keys(g29.problems).length === 0, "Archicad 29 layout: no problems");
  const d = g29.drawings[0];
  drawingChecks("Archicad 29 layout", d, 10, 2);
  check(d !== undefined && d.frame !== null && [...d.frame].every((v, i) => near(v, rotation[i])) && d.texts === 0, "Archicad 29 layout: element frame");

  const g25 = readGeometry(objectsOf([["02".repeat(16), virtsy({ ac25: true, origin: [-3, 7.5] })]]));
  check(Object.keys(g25.problems).length === 0, "Archicad 25 layout: no problems");
  drawingChecks("Archicad 25 layout", g25.drawings[0], -3, 7.5);
  check(g25.drawings[0]?.frame === null, "Archicad 25 layout: a frame of zeros reads as none");

  const gt = readGeometry(objectsOf([["03".repeat(16), virtsy({ texts: true, origin: [1, 1] })]]));
  drawingChecks("with a text record", gt.drawings[0], 1, 1);
  check(gt.drawings[0]?.texts === 1, "with a text record: the text is counted");

  // slanted: unit axes not square to each other, kept as stored
  const skew = [1, 0, 0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 0, 1, 0];
  const gs = readGeometry(objectsOf([["04".repeat(16), virtsy({ frame: skew })]]));
  check(gs.drawings.length === 1 && gs.drawings[0].frame !== null && near(gs.drawings[0].frame[5], Math.SQRT1_2), "skewed element frame kept");

  // problems are counted, the good drawings still read
  const good = virtsy({ origin: [0, 0] });
  const other = virtsy({ element: OTHER_ELEMENT });
  const second = virtsy({ origin: [1, 0] });
  const geo = readGeometry(
    objectsOf([
      ["05".repeat(16), good],
      ["06".repeat(16), good.slice(0, 400)],
      ["07".repeat(16), virtsy({ extraLineCount: 1 })],
      ["08".repeat(16), virtsy({ frame: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0] })],
      ["09".repeat(16), other],
      ["0a".repeat(16), second],
    ]),
  );
  check(geo.problems.VirtSy === 3 && geo.drawings.length === 3, "a short object, a count that doesn't match and a stretched frame are 3 problems; 3 drawings read");
  check(geo.byElement.get(ELEMENT)?.length === 2 && geo.byElement.get(OTHER_ELEMENT)?.length === 1, "drawings grouped by element");
}

// ---- the sample files ----------------------------------------------------------------------------

/** Element classes, by Archicad's class name, for the coverage counts. */
const ELEMENT_CLASSES: readonly [string, string][] = [
  ["Wall", "8245654faf33524eabfcc35d46765ec4"],
  ["Door", "8976f0d8fa9cbe4faeb40a60b8e667ee"],
  ["Wind", "a061f1934e4cf74da1004fd0e8c4f1e1"],
  ["Symb", "c3ceefdbbf1b6748b8b3c4f7c859df61"],
  ["Light", "558b2a3448736a48850b1eb1bed031fc"],
  ["Column", "85ebe813335aa347a4d41e05296aec7e"],
  ["Beam", "85d2c2a57c5a684a95549eda9d4556ca"],
  ["Ceil", "75125c944879d44187449d22d72ca486"],
  ["Roof", "21764c9de9512345a3baf2121777bcbe"],
  ["Mesh", "46ee2f8f3f6aac41a32b69e44dc6276d"],
  ["FreeShape", "7b3c36e60e94eb4daf958b3b39e86bd2"],
  ["Stair", "157f0ffab429054980fac6769109847b"],
  ["Railing", "1ae65a4c17af854b93e0005c987d5f5b"],
  ["CurtainWall", "17c853c655a84644aef424efb46271aa"],
  ["Skylight", "6ef0a954293e304888803cf85eb0ad27"],
  ["Room", "2e33d03ae2ef1a4992a65b14bfdd7229"],
];

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const files = readdirSync(folder)
    .filter((f) => /\.(pln|pla)$/i.test(f))
    .sort();
  const wanted = new Set([...GEOMETRY_CLASSES, ...ELEMENT_CLASSES.map(([, c]) => c)]);
  const coverage = new Map<string, [number, number]>();
  let decodedAll = 0;
  let totalAll = 0;
  for (const [i, file] of files.entries()) {
    const objects = objectsInFile(readFileSync(join(folder, file)), wanted);
    const t0 = performance.now();
    const geo = readGeometry(objects);
    const ms = Math.round(performance.now() - t0);
    const total = objects.get(VIRTSY_CLASS)?.length ?? 0;
    decodedAll += geo.drawings.length;
    totalAll += total;
    console.log(`file ${i + 1}: VirtSy ${geo.drawings.length}/${total} in ${ms} ms, ${geo.byElement.size} elements drawn`);
    check(Object.keys(geo.problems).length === 0 && geo.drawings.length === total, `file ${i + 1}: every VirtSy object decodes`);

    let bad = 0;
    let points = 0;
    let outside = 0;
    let outside3d = 0;
    let badPen = 0;
    let badArc = 0;
    const kinds = new Map<ViewKind | "none", number>();
    let unresolved = 0;
    for (const d of geo.drawings) {
      for (const a of [d.lines, d.arcs, d.polylines.points, d.fills.points, d.hotspots]) for (const v of a) if (!Number.isFinite(v) || Math.abs(v) > 1e6) bad++;
      for (const pens of [d.linePens, d.arcPens, d.polylines.pens, d.fills.pens]) for (const p of pens) if (p > 255) badPen++;
      for (let k = 0; k < d.arcs.length; k += 7) if (!(d.arcs[k + 2] > 0) || !(d.arcs[k + 3] > 0)) badArc++;
      kinds.set(d.viewKind ?? "none", (kinds.get(d.viewKind ?? "none") ?? 0) + 1);
      if (d.view && !d.viewKind) unresolved++;
      const b = d.box;
      let out = 0;
      for (const a of [d.lines, d.polylines.points, d.fills.points]) {
        points += a.length / 2;
        if (!b) {
          out += a.length / 2;
          continue;
        }
        const tol = 1e-6 * Math.max(1, Math.abs(b.xMin), Math.abs(b.xMax), Math.abs(b.yMin), Math.abs(b.yMax));
        for (let k = 0; k < a.length; k += 2) if (a[k] < b.xMin - tol || a[k] > b.xMax + tol || a[k + 1] < b.yMin - tol || a[k + 1] > b.yMax + tol) out++;
      }
      if (d.viewKind === "document3d") outside3d += out;
      else outside += out;
    }
    check(bad === 0 && badPen === 0 && badArc === 0, `file ${i + 1}: coordinates finite and within 1000 km, pens 0..255, arcs with a radius`);
    // a 3D document's box can leave out a few line ends (connected lines, just past it)
    check(outside === 0 && outside3d <= 1e-4 * points, `file ${i + 1}: ${points} points lie in their drawing's box${outside3d ? ` (in 3D documents, ${outside3d} line ends just past it)` : ""}`);
    check(unresolved === 0, `file ${i + 1}: views resolve (${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")})`);

    // walls and slabs: the frame's height is the lowest hotspot's elevation in sections and elevations
    const classOf = new Map<string, string>();
    for (const [name, cls] of ELEMENT_CLASSES) for (const o of objects.get(cls) ?? []) classOf.set(o.guid, name);
    let standing = 0;
    let measured = 0;
    for (const d of geo.drawings) {
      const kind = d.element ? classOf.get(d.element) : undefined;
      if ((kind !== "Wall" && kind !== "Ceil") || !d.frame || !d.hotspots.length || (d.viewKind !== "section" && d.viewKind !== "elevation")) continue;
      let low = Infinity;
      for (let k = 1; k < d.hotspots.length; k += 3) low = Math.min(low, d.hotspots[k]);
      measured++;
      if (Math.abs(low - d.frame[11]) < 1e-4) standing++;
    }
    check(measured === 0 || standing >= 0.5 * measured, `file ${i + 1}: wall and slab frames at their lowest hotspot in sections and elevations ${standing}/${measured}`);

    const line: string[] = [];
    for (const [name, cls] of ELEMENT_CLASSES) {
      const list = objects.get(cls) ?? [];
      if (!list.length) continue;
      const drawn = list.filter((o) => geo.byElement.has(o.guid)).length;
      const t = coverage.get(name) ?? [0, 0];
      coverage.set(name, [t[0] + drawn, t[1] + list.length]);
      line.push(`${name} ${drawn}/${list.length}`);
    }
    console.log(`file ${i + 1}: elements with a drawing: ${line.join(", ")}`);
  }
  console.log(`\nall files: VirtSy ${decodedAll}/${totalAll}`);
  console.log(`all files: elements with a drawing: ${[...coverage].map(([k, [a, n]]) => `${k} ${a}/${n}`).join(", ")}`);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
