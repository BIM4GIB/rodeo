// Checks the Archicad drafting reader (./drafting.ts) on payloads built here from made-up values,
// laid out as Archicad 25, 27 and 29 lay them out: lines, arcs, a polyline with a curved edge, a
// spline, a fill with a hole and a curved edge, a text with a paragraph and a run, a dimension of
// two points with derived data, a level dimension, a zone, a camera, a hotspot, a group and a label,
// with owner, story and group links, and a broken object that is counted, not thrown. With
// PLN_SAMPLES set to a folder of .pln/.pla files it also reads every object of the drafting classes
// in each and prints decoded/total counts per class and plausibility checks (counts only; nothing
// from the files is printed).
//   npx tsx src/import/archicad/drafting.check.ts
//   PLN_SAMPLES=~/samples npx tsx src/import/archicad/drafting.check.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARC,
  CAMERA,
  DIM,
  DIM_ELEM,
  DIM_ELEM_DERIVED,
  DRAFTING_CLASS_NAMES,
  DRAFTING_CLASSES,
  DRAFTING_LINKS as L,
  GROUP,
  HATCH,
  HOTSPOT,
  LABEL,
  LEV_DIM,
  LEV_DIM_DERIVED,
  LINE,
  POLYLINE,
  readDrafting,
  ROOM,
  SPLINE,
  WORD,
  type Drafting,
  type Polygon,
} from "./drafting.ts";
import { objectsInFile, type ArchicadObject } from "./objects.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;

// ---- building payloads -----------------------------------------------------------------------------

class Out {
  readonly bytes: number[] = [];
  get at(): number {
    return this.bytes.length;
  }
  u8(...v: number[]): this {
    for (const x of v) this.bytes.push(x & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v, v >> 8);
  }
  u32(v: number): this {
    return this.u8(v, v >> 8, v >> 16, v >>> 24);
  }
  f64(...v: number[]): this {
    for (const x of v) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, x, true);
      this.u8(...b);
    }
    return this;
  }
  guid(h: string): this {
    for (let i = 0; i < 32; i += 2) this.u8(parseInt(h.slice(i, i + 2), 16));
    return this;
  }
  str(s: string): this {
    this.u16(1).u32(s.length);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.bytes.push(0);
    return this;
  }
  /** zeros up to `to` */
  to(to: number): this {
    if (to < this.at) throw new Error(`past ${to}`);
    return this.zeros(to - this.at);
  }
  patch32(at: number, v: number): void {
    for (let i = 0; i < 4; i++) this.bytes[at + i] = (v >>> (8 * i)) & 0xff;
  }
}

type Gen = 25 | 27 | 29;
type Link = readonly [tag: number, kind: string, ...targets: string[]];

let serial = 1;
const newGuid = (): string => (serial++).toString(16).padStart(8, "0") + "5eed0000aaaa0000bbbb0000";

/** A payload: the class GUID, the object header, the version chain, `body`, then the link list. */
function payload(cls: string, gen: Gen, body: (o: Out, D: number) => void, links: readonly Link[] = []): Uint8Array {
  const o = new Out().guid(cls).u8(2, 0, 0).u32(7).u32(0).u32(9).u32(0).u32(0);
  if (gen === 25) o.u8(0x10, 0, 1, 0, 7, 0, 4, 0, 0x82, 0, 3, 0, 0, 1);
  else if (gen === 27) o.u8(0x10, 0, 1, 0, 9, 0, 0x82, 0, 3, 0, 0, 1);
  else o.u8(0x11, 0, 1, 0, 9, 0, 0x83, 0, 3, 0, 0, 1);
  o.guid(cls).u16(2).u16(1).u16(1);
  body(o, o.at);
  const start = o.at;
  o.u32(0).u16(1);
  for (const [tag, kind, ...targets] of links) {
    o.u8(tag).guid(kind);
    if (tag === 0x01 || tag === 0x02) o.u32(targets.length);
    for (const t of targets) o.guid(t);
  }
  o.u8(0);
  o.patch32(start, o.at - start - 4);
  return Uint8Array.from(o.bytes);
}

/** The common header `pad` bytes after D; returns where the class part starts. */
function header(o: Out, gen: Gen, pad: number, layer: number, story: number): number {
  o.zeros(pad);
  const k = o.at;
  o.u8(3).u16(1).u32(layer).u16(story & 0xffff);
  if (gen === 25) o.to(k + 0xf).u16(1).to(k + 0x15).u16(1).to(k + 0x1b).u32(42);
  else o.to(k + 0xb).u16(1).to(k + 0x11).u32(42);
  return o.at;
}

/** pen, line type, then zeros to the geometry */
function drawn(o: Out, gen: Gen, c: number, pen: number, lineType: number): void {
  o.u8(pen, 0).u16(0xfffe).u16(1).u32(lineType).to(c + (gen === 25 ? 0x18 : 0x34));
}

/** a polygon: n, arcs, contours, dummy, points, arcs, contour ends */
function polygon(o: Out, contours: readonly (readonly number[])[], arcs: readonly (readonly [number, number, number])[], open = false): void {
  const n = contours.reduce((s, c) => s + c.length / 2, 0);
  o.u32(n).u32(arcs.length).u32(open ? 0 : contours.length).zeros(16);
  for (const c of contours) o.f64(...c);
  if (arcs.length) {
    o.zeros(16);
    for (const [from, to, angle] of arcs) o.u32(from + 1).u32(to + 1).f64(angle);
  }
  if (!open) {
    o.u32(0);
    let end = 0;
    for (const c of contours) o.u32((end += c.length / 2));
  }
}

// ---- the synthetic project ---------------------------------------------------------------------

const FLOOR_PLAN = "21e5a0f63b44da4eb20a7160cbe09115";
const SECTION = "509ae4f923d3a845bd880d6b82e6aa7a";
const plan = newGuid();
const section = newGuid();
const floor = newGuid();
const group = newGuid();
const parentGroup = newGuid();
const onPlan: Link[] = [
  [0x12, L.owner, plan],
  [0x12, L.floor, floor],
  [0x12, L.group, group],
];

const objects = new Map<string, ArchicadObject[]>();
function add(cls: string, data: Uint8Array, guid = newGuid()): string {
  let list = objects.get(cls);
  if (!list) objects.set(cls, (list = []));
  list.push({ guid, data });
  return guid;
}
add(FLOOR_PLAN, payload(FLOOR_PLAN, 25, (o) => o.zeros(8)), plan);
add(SECTION, payload(SECTION, 25, (o) => o.zeros(8)), section);

// lines in each version
const line25 = add(LINE, payload(LINE, 25, (o) => { const c = header(o, 25, 0, 4, 2); drawn(o, 25, c, 7, 3); o.f64(1, 2, 3.5, -4).u8(0); }, onPlan));
const line27 = add(LINE, payload(LINE, 27, (o) => { const c = header(o, 27, 0, 5, 0); drawn(o, 27, c, 8, 2); o.f64(-1, -2, 6, 7).u8(0); }, [[0x12, L.owner, section]]));
const line29 = add(LINE, payload(LINE, 29, (o) => { const c = header(o, 29, 28, 6, -1); drawn(o, 29, c, 9, 1); o.f64(0.5, 0.25, 0.75, 1).u8(0); }, [[0x12, L.owner, plan], [0x12, L.floor, floor]]));
// a broken line: its geometry is cut short
add(LINE, payload(LINE, 25, (o) => { const c = header(o, 25, 0, 4, 2); drawn(o, 25, c, 7, 3); o.u8(1, 2); }));
// an arc: quarter of an ellipse, clockwise
add(ARC, payload(ARC, 25, (o) => { const c = header(o, 25, 0, 4, 2); drawn(o, 25, c, 5, 1); o.f64(10, 20, 2, 0.5, 0.5, 0, Math.PI / 2).zeros(32).u8(1, 0); }, onPlan));
// a polyline with a curved middle edge (Archicad 27)
add(POLYLINE, payload(POLYLINE, 27, (o) => { const c = header(o, 27, 0, 4, 1); drawn(o, 27, c, 6, 2); o.u16(3).u16(0x39).f64(0, 0, 3, 1); polygon(o, [[0, 0, 1, 0, 2, 1, 3, 1]], [[1, 2, -Math.PI / 3]], true); o.zeros(12); }, onPlan));
// a spline of three points (Archicad 25)
add(SPLINE, payload(SPLINE, 25, (o) => { const c = header(o, 25, 0, 4, 1); drawn(o, 25, c, 6, 2); o.u8(1, 1).u16(0).u32(3).f64(0, 0, 1, 1, 2, 0).f64(0, 0.5, 0.3, 0.4, 0.4, 0, 0.5, 0, -0.3).u32(3).u32(1).u32(2).u32(3); }, onPlan));

// a fill: a square with a square hole and a curved edge on the outline (Archicad 29)
const note = newGuid();
add(HATCH, payload(HATCH, 29, (o) => {
  const c = header(o, 29, 24, 4, 1);
  o.to(c).str("F-1");
  const q = o.at;
  o.u16(2).u16(2).u32(0).f64(1, 2).f64(1, 0, 0, 1).f64(0).u8(0, 0, 2, 1);
  const lenAt = o.at;
  o.u32(0);
  const block = o.at;
  o.u8(1, 0x1f, 0).f64(0, 0, 4, 4);
  polygon(o, [[0, 0, 4, 0, 4, 4, 0, 4, 0, 0], [1, 1, 1, 2, 2, 2, 2, 1, 1, 1]], [[1, 2, 0.5]]);
  o.zeros(10);
  o.patch32(lenAt, o.at - block);
  if (lenAt !== q + 0x44) throw new Error("fill layout");
  // the tail before the links: contour pen, line type, shown, fill, pens
  const t = o.at;
  o.u8(11, 0).u16(0xfffe).u16(1).u32(5).u8(1, 0).u16(1).u32(3).u8(12, 0).u16(0xfffe).u16(0xffff).zeros(8).to(t + 72);
}, [...onPlan, [0x11, L.note, note]]));

// a text: one paragraph, centred, one run (Archicad 25)
const content = "Ab\rCd";
add(WORD, payload(WORD, 25, (o) => {
  const c = header(o, 25, 0, 4, 1);
  o.u8(1, 3);
  const lAt = o.at;
  o.u32(0).f64(Math.PI / 6, 1, 1).u8(0).u32(11).str(content).u32(1);
  const par = new Out();
  par.u32(0).u32(content.length).u32(1).zeros(24).f64(-1).u32(1).u32(content.length - 1).u32(1);
  par.u16(1).u32(0).u32(content.length).u16(1).u32(0x10).u16(1).u32(0).str("Font").str("").str("Font").u32(0).u16(1).u32(1).u32(11).f64(2.5).u32(14);
  par.u32(0).u32(1).f64(3);
  o.u8(1, 1).u32(par.at).u8(...par.bytes);
  o.f64(1);
  o.patch32(lAt, o.at - (c + 6));
  o.f64(5, 6, 3, 1.5).zeros(24);
}, onPlan));

// a dimension of two points (Archicad 25): one free point, one following an element
const derivedA = add(DIM_ELEM_DERIVED, payload(DIM_ELEM_DERIVED, 25, (o) => o.zeros(16).f64(1, 3).zeros(80)));
const derivedB = add(DIM_ELEM_DERIVED, payload(DIM_ELEM_DERIVED, 25, (o) => o.zeros(16).f64(4, 3).zeros(80)));
const dim = newGuid();
const elemA = add(DIM_ELEM, payload(DIM_ELEM, 25, (o) => { const c = header(o, 25, 0, 4, 1); o.to(c).f64(1, 0).zeros(40).u8(2); }, [[0x12, L.dimDerived, derivedA], [0x12, L.dimParts, dim]]));
const elemB = add(DIM_ELEM, payload(DIM_ELEM, 25, (o) => { const c = header(o, 25, 0, 4, 1); o.to(c).f64(0, 0).zeros(40).u8(3); }, [[0x12, L.dimDerived, derivedB], [0x12, L.dimParts, dim], [0x12, L.dimMeasured, line25]]));
add(DIM, payload(DIM, 25, (o) => { const c = header(o, 25, 8, 4, 1); o.to(c).u8(0).f64(0, 3, 1, 0, 2).zeros(16); }, [...onPlan, [0x01, L.dimParts, elemB, elemA]]), dim);

// a level dimension (Archicad 29)
const levelData = add(LEV_DIM_DERIVED, payload(LEV_DIM_DERIVED, 29, (o) => o.zeros(12).f64(2.75).zeros(24)));
add(LEV_DIM, payload(LEV_DIM, 29, (o) => { const c = header(o, 29, 32, 4, 1); o.to(c).zeros(12).f64(8, 9, 0.2, 2).zeros(20); }, [...onPlan, [0x12, L.levelDerived, levelData], [0x12, L.levelFloor, floor]]));

// a zone (Archicad 27)
const stamp = newGuid();
add(ROOM, payload(ROOM, 27, (o, D) => {
  o.to(D + 89).str("Hall").str("7");
  const ne = o.at;
  o.f64(0.1, 2.6).to(ne + 63).f64(0, 0, 5, 3);
  polygon(o, [[0, 0, 5, 0, 5, 3, 0, 3, 0, 0]], []);
  o.zeros(40);
}, [[0x12, L.owner, plan], [0x12, L.floor, floor], [0x12, L.stamp, stamp]]));

// a camera (Archicad 29)
add(CAMERA, payload(CAMERA, 29, (o, D) => {
  o.to(D + 37).str("Cam");
  const e = o.at;
  o.f64(1, 2, 1.6, 4, 6, 1.6).to(e + 81).f64(60).zeros(20);
}));

add(HOTSPOT, payload(HOTSPOT, 25, (o) => { const c = header(o, 25, 0, 4, 1); o.to(c).f64(3, 4, 0).u32(9).zeros(8); }, onPlan));
add(GROUP, payload(GROUP, 25, (o) => o.zeros(40), [[0x01, L.group, line25, line27], [0x12, L.group, parentGroup]]), group);
add(LABEL, payload(LABEL, 25, (o) => { const c = header(o, 25, 0, 4, 1); o.to(c).zeros(40); }, [...onPlan, [0x11, L.labelText, newGuid()], [0x12, L.labelElement, line29]]));

// ---- reading it back ---------------------------------------------------------------------------

const r = readDrafting(objects);
const ln = (g: string) => r.lines.find((l) => l.guid === g);
check(r.lines.length === 3 && r.problems["VBElem::Line"] === 1, "three lines decode, the broken one is counted");
const a = ln(line25);
check(!!a && a.pen === 7 && a.lineType === 3 && a.layer === 4 && a.story === 2 && a.order === 3 && near(a.end.x, 3.5) && near(a.end.y, -4), "an Archicad 25 line: pen, line type, layer, story, order, points");
check(!!a && a.owner === plan && a.ownerKind === "floorPlan" && a.floor === floor && a.group === group, "its owner, story Floor and group");
const b = ln(line27);
check(!!b && b.ownerKind === "section" && b.story === null && near(b.begin.x, -1) && near(b.end.y, 7), "an Archicad 27 line in a section has no story");
const c29 = ln(line29);
check(!!c29 && c29.pen === 9 && c29.story === -1 && near(c29.end.x, 0.75), "an Archicad 29 line, a story below zero");
const arc = r.arcs[0];
check(!!arc && near(arc.center.y, 20) && near(arc.radius, 2) && near(arc.ratio, 0.5) && near(arc.endAngle, Math.PI / 2) && arc.reflected && !arc.whole, "an arc of an ellipse, clockwise");
const pl = r.polylines[0];
check(!!pl && pl.shape.points.length === 8 && pl.shape.ends[0] === 4 && pl.shape.arcs.length === 3 && pl.shape.arcs[0] === 1 && near(pl.shape.arcs[2], -Math.PI / 3) && !pl.closed, "a polyline with a curved edge (Archicad 27)");
const sp = r.splines[0];
check(!!sp && sp.points.length === 6 && sp.handles.length === 9 && near(sp.handles[8], -0.3), "a spline's points and handles");
const fill = r.fills[0];
check(!!fill && fill.id === "F-1" && fill.shape.ends.length === 2 && fill.shape.ends[1] === 10 && fill.shape.arcs[0] === 1, "a fill's outline, hole and curved edge (Archicad 29)");
check(!!fill && fill.fill === 3 && fill.pen === 12 && fill.backgroundPen === -1 && fill.contourPen === 11 && fill.contourLineType === 5 && fill.contourShown && fill.areaText === note && near(fill.origin.y, 2), "a fill's pens, fill, contour and area text");
const text = r.texts[0];
check(!!text && text.content === content && text.paragraphs[0]?.justify === "center" && text.runs[0]?.font === "Font" && near(text.runs[0].size, 2.5) && text.runs[0].pen === 14 && text.runs[0].style === 0x10, "a text's content, paragraph and run");
check(!!text && near(text.point.x, 5) && near(text.width, 3) && near(text.height, 1.5) && near(text.angle, Math.PI / 6), "a text's place, size and angle");
const d = r.dimensions[0];
check(!!d && d.points.length === 2 && d.points[0].guid === elemB && d.points[0].element === line25 && near(d.points[1].point.x, 1) && near(d.points[0].onLine?.x ?? 0, 4) && near(d.linePoint.y, 3) && near(d.direction.x, 1), "a dimension's points in order, projected onto its line");
const lv = r.levelDimensions[0];
check(!!lv && near(lv.level ?? 0, 2.75) && near(lv.point.x, 8) && lv.levelFloor === floor, "a level dimension (Archicad 29)");
const z = r.zones[0];
check(!!z && z.name === "Hall" && z.number === "7" && near(z.height, 2.6) && z.shape.points.length === 10 && z.stamp === stamp && z.floor === floor, "a zone (Archicad 27)");
const cam = r.cameras[0];
check(!!cam && cam.name === "Cam" && near(cam.eye.z, 1.6) && near(cam.target.y, 6) && near(cam.viewCone, 60), "a camera (Archicad 29)");
check(r.hotspots[0]?.pen === 9 && near(r.hotspots[0].point.y, 4), "a hotspot");
check(r.groups[0]?.members.length === 2 && r.groups[0].parent === parentGroup, "a group's members and parent");
check(r.labels[0]?.element === line29 && r.labels[0].text !== null, "a label's text and element");
check(r.databases.get(section) === "section" && r.databases.size === 2, "the databases by kind");

// ---- the sample files --------------------------------------------------------------------------

/** a polygon's contours each end on their first point */
function closed(p: Polygon): boolean {
  let from = 0;
  for (const end of p.ends) {
    if (end - from < 2 || p.points[2 * from] !== p.points[2 * end - 2] || p.points[2 * from + 1] !== p.points[2 * end - 1]) return false;
    from = end;
  }
  return true;
}
/** curved edges join neighbouring points */
function arcsJoin(p: Polygon): boolean {
  for (let i = 0; i < p.arcs.length; i += 3) if (p.arcs[i + 1] !== p.arcs[i] + 1 || !(Math.abs(p.arcs[i + 2]) <= 2 * Math.PI + 1e-9)) return false;
  return true;
}

const folder = process.env.PLN_SAMPLES?.replace(/^~/, process.env.HOME ?? "~");
if (folder) {
  const files = readdirSync(folder)
    .filter((f) => /\.(pln|pla)$/i.test(f))
    .sort();
  const total = new Map<string, [number, number]>();
  files.forEach((f, i) => {
    const t0 = performance.now();
    const objs = objectsInFile(readFileSync(join(folder, f)), DRAFTING_CLASSES);
    const t1 = performance.now();
    const r: Drafting = readDrafting(objs);
    const t2 = performance.now();
    const counts: string[] = [];
    for (const [cls, name] of DRAFTING_CLASS_NAMES) {
      const n = objs.get(cls)?.length ?? 0;
      const ok = n - (r.problems[name] ?? 0);
      const t = total.get(name) ?? [0, 0];
      total.set(name, [t[0] + ok, t[1] + n]);
      if (n) counts.push(`${name} ${ok}/${n}`);
    }
    console.log(`file ${i + 1}: read ${((t1 - t0) / 1000).toFixed(1)} s, decoded in ${((t2 - t1) / 1000).toFixed(2)} s: ${counts.join(", ")}`);
    check(Object.keys(r.problems).length === 0, `file ${i + 1}: every drafting object decodes`);

    const placed = [...r.lines, ...r.arcs, ...r.polylines, ...r.splines, ...r.fills, ...r.texts, ...r.dimensions, ...r.levelDimensions, ...r.zones, ...r.hotspots, ...r.labels];
    const owned = placed.filter((p) => p.owner !== null);
    const known = owned.filter((p) => p.ownerKind !== null).length;
    const onPlan = placed.filter((p) => p.ownerKind === "floorPlan");
    const withFloor = onPlan.filter((p) => p.floor !== null).length;
    console.log(`  ${placed.length} placed, ${owned.length} with an owner (${known} of a known kind), ${onPlan.length} on the floor plan (${withFloor} with a Floor)`);
    check(known === owned.length, `file ${i + 1}: every owner is a known database`);
    check(withFloor >= 0.99 * onPlan.length, `file ${i + 1}: floor-plan elements link their Floor`);

    const shapes = [...r.fills.map((x) => x.shape), ...r.zones.map((x) => x.shape)];
    const shut = shapes.filter(closed).length;
    const joined = [...shapes, ...r.polylines.map((x) => x.shape)].filter(arcsJoin).length;
    const polyN = r.polylines.length + shapes.length;
    console.log(`  polygons: ${shut}/${shapes.length} fill and zone contours closed, ${joined}/${polyN} with arcs joining neighbours`);
    check(shut === shapes.length, `file ${i + 1}: fill and zone contours are closed`);
    check(joined === polyN, `file ${i + 1}: curved edges join neighbouring points`);

    const pens = [...r.lines, ...r.arcs, ...r.polylines, ...r.splines, ...r.fills].filter((x) => x.pen >= 1 && x.pen <= 255).length;
    const penN = r.lines.length + r.arcs.length + r.polylines.length + r.splines.length + r.fills.length;
    check(pens === penN, `file ${i + 1}: pens are 1..255 (${pens}/${penN})`);
    const radii = r.arcs.filter((x) => x.radius > 0 && x.radius < 1e5 && x.ratio > 0 && x.ratio < 100).length;
    check(radii === r.arcs.length, `file ${i + 1}: arc radii and ratios are sane (${radii}/${r.arcs.length})`);

    // the runs cover the paragraphs; the \r between paragraphs (and sometimes one at the end) aren't in a run
    const runsCover = r.texts.filter((x) => {
      const n = x.runs.reduce((s, run) => s + run.count, 0) + x.paragraphs.length - 1;
      return x.content.length === n || x.content.length === n + 1;
    }).length;
    const sizes = r.texts.filter((x) => x.runs.every((run) => run.size > 0 && run.size < 1000 && run.font.length > 0)).length;
    console.log(`  texts: ${runsCover}/${r.texts.length} with runs covering the text, ${sizes}/${r.texts.length} with sane sizes and fonts`);
    check(sizes === r.texts.length, `file ${i + 1}: text sizes and fonts are sane`);
    check(runsCover === r.texts.length, `file ${i + 1}: text runs cover the paragraphs`);

    let onLine = 0;
    let dimPoints = 0;
    for (const dm of r.dimensions)
      for (const p of dm.points) {
        dimPoints++;
        if (p.onLine && Math.abs((p.onLine.x - dm.linePoint.x) * dm.direction.y - (p.onLine.y - dm.linePoint.y) * dm.direction.x) < 1e-6) onLine++;
      }
    const twoPoints = r.dimensions.filter((x) => x.points.length >= 2).length;
    console.log(`  dimensions: ${twoPoints}/${r.dimensions.length} with two or more points, ${onLine}/${dimPoints} projected points on the line; level dimensions with a level: ${r.levelDimensions.filter((x) => x.level !== null).length}/${r.levelDimensions.length}`);
    check(onLine >= 0.95 * dimPoints, `file ${i + 1}: dimension points lie on their lines`);

    const zonesOk = r.zones.filter((x) => x.height > 0 && x.height < 100 && x.floor !== null).length;
    check(zonesOk === r.zones.length, `file ${i + 1}: zones have a height and a Floor (${zonesOk}/${r.zones.length})`);
    const camsOk = r.cameras.filter((x) => x.viewCone > 0 && x.viewCone < 180 && (x.eye.x !== x.target.x || x.eye.y !== x.target.y)).length;
    check(camsOk === r.cameras.length, `file ${i + 1}: cameras look somewhere (${camsOk}/${r.cameras.length})`);
    const members = r.groups.reduce((s, g) => s + g.members.length, 0);
    console.log(`  ${r.groups.length} groups with ${members} members; ${r.labels.filter((x) => x.text !== null).length}/${r.labels.length} labels with a text; ${r.databases.size} databases`);
  });
  console.log("all files:");
  for (const [name, [ok, n]] of total) console.log(`  ${name} ${ok}/${n}`);
}

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all drafting checks pass");
