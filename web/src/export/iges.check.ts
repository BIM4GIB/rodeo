// Node check of the IGES export. Run from web/: npx tsx src/export/iges.check.ts

import assert from "node:assert/strict";
import { exportIges } from "./iges.ts";
import type { Model3D } from "./scene3d.ts";

type V3 = [number, number, number];

/** A box's 12 triangles, counter-clockwise from outside; `skip` leaves faces out. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: number[] = []): number[] {
  const c = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.filter((_, i) => !skip.includes(i)).flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]);
}

const model = (objects: { name: string; pieces: { color: string; triangles: number[] }[] }[]): Model3D => ({
  layers: [
    {
      id: "L",
      name: "Design Layer-1",
      elevation: 0,
      objects: objects.map((o, i) => ({ id: `o${i}`, name: o.name, className: "None", pieces: o.pieces.map((p) => ({ color: p.color, opacity: 1, triangles: new Float32Array(p.triangles) })) })),
    },
  ],
});

/** Free-format IGES parameters: split at commas outside Hollerith strings, the last ended by a semicolon. */
function tokens(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "H" && /^\d+$/.test(cur)) {
      const n = Number(cur);
      cur = s.slice(i + 1, i + 1 + n);
      i += n;
      continue;
    }
    if (ch === "," || ch === ";") {
      out.push(cur.trim());
      cur = "";
      if (ch === ";") return out;
      continue;
    }
    cur += ch;
  }
  throw new Error("no record delimiter");
}

interface Ent {
  readonly de: number;
  readonly type: number;
  readonly form: number;
  readonly status: string;
  readonly color: number;
  readonly level: number;
  readonly p: string[];
}

/** The file's entities by directory pointer, checked: its columns, sections, counts and the pointers between them. */
function read(text: string): { es: Map<number, Ent>; global: string[] } {
  const lines = text.split("\n");
  assert.equal(lines.pop(), "");
  const by: Record<string, string[]> = { S: [], G: [], D: [], P: [], T: [] };
  let order = "";
  for (const l of lines) {
    assert.equal(l.length, 80, `80 columns: ${JSON.stringify(l)}`);
    const letter = l[72];
    assert.ok(letter in by, l);
    by[letter].push(l);
    assert.equal(Number(l.slice(73)), by[letter].length, "numbered in order");
    if (!order.endsWith(letter)) order += letter;
  }
  assert.ok(order === "SGDPT" || (order === "SGT" && by.D.length === 0), order);
  const t = by.T[0];
  assert.deepEqual([1, 9, 17, 25].map((i) => Number(t.slice(i, i + 7))), [by.S.length, by.G.length, by.D.length, by.P.length]);
  const global = tokens(by.G.map((l) => l.slice(0, 72)).join(""));
  const es = new Map<number, Ent>();
  for (let i = 0; i < by.D.length; i += 2) {
    const f1 = Array.from({ length: 9 }, (_, k) => by.D[i].slice(8 * k, 8 * k + 8));
    const f2 = Array.from({ length: 9 }, (_, k) => by.D[i + 1].slice(8 * k, 8 * k + 8));
    const de = i + 1;
    assert.equal(Number(f1[0]), Number(f2[0]), "the type twice");
    const first = Number(f1[1]);
    const count = Number(f2[3]);
    const pl = by.P.slice(first - 1, first - 1 + count);
    assert.equal(pl.length, count);
    for (const l of pl) {
      assert.equal(l[64], " ");
      assert.equal(Number(l.slice(65, 72)), de, "the parameter lines point back");
    }
    const p = tokens(pl.map((l) => l.slice(0, 64)).join(""));
    assert.equal(Number(p[0]), Number(f1[0]), "the parameters start with the type");
    es.set(de, { de, type: Number(f1[0]), form: Number(f2[4]), status: f1[8], color: Number(f2[2]), level: Number(f1[4]), p: p.slice(1) });
  }
  // every parameter line is some entity's
  assert.equal([...es.values()].reduce((n, e) => n + Number(by.D[e.de].slice(24, 32)), 0), by.P.length);
  return { es, global };
}

const num = (s: string): number => Number(s);
const at = (es: Map<number, Ent>, de: string | number, type: number): Ent => {
  const e = es.get(Number(de));
  assert.ok(e, `no entity at ${de}`);
  assert.equal(e.type, type, `entity ${de} is ${e.type}, not ${type}`);
  return e;
};

/** A degree-1 curve's points, its parameter count checked. */
function curvePoints(e: Ent): V3[] {
  const k = num(e.p[0]);
  assert.equal(num(e.p[1]), 1);
  assert.equal(e.p.length, 6 + (k + 3) + (k + 1) + 3 * (k + 1) + 2 + 3);
  const at0 = 6 + (k + 3) + (k + 1);
  return Array.from({ length: k + 1 }, (_, i) => e.p.slice(at0 + 3 * i, at0 + 3 * i + 3).map(num) as V3);
}

/** A bilinear patch's corners, its parameter count checked: P00, P10, P01, P11. */
function patchCorners(e: Ent): V3[] {
  assert.equal(e.p.length, 9 + 4 + 4 + 4 + 12 + 4);
  assert.deepEqual(e.p.slice(0, 4).map(num), [1, 1, 1, 1]);
  return [0, 1, 2, 3].map((i) => e.p.slice(21 + 3 * i, 24 + 3 * i).map(num) as V3);
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Checks a solid (186): loops that run on, each edge once each way, V − E + F = 2, faces whose patches face out from `centre`. */
function checkSolid(es: Map<number, Ent>, msbo: Ent, centre: V3): { v: number; e: number; f: number } {
  assert.equal(msbo.status, "00000000");
  const shell = at(es, msbo.p[0], 514);
  assert.equal(shell.form, 1);
  const n = num(shell.p[0]);
  const uses = new Map<number, number[]>();
  const vertices = new Set<string>();
  for (let i = 0; i < n; i++) {
    const face = at(es, shell.p[1 + 2 * i], 510);
    assert.equal(shell.p[2 + 2 * i], "1");
    const surface = at(es, face.p[0], 128);
    const [p00, p10, p01] = patchCorners(surface);
    const normal = cross(sub(p10, p00), sub(p01, p00));
    assert.ok(dot(normal, sub(p00, centre)) > 0, "the patch faces out");
    assert.deepEqual(face.p.slice(1, 3), ["1", "1"]);
    const loop = at(es, face.p[3], 508);
    const m = num(loop.p[0]);
    const ends: [number, number][] = [];
    let list: Ent | null = null;
    for (let k = 0; k < m; k++) {
      const [type, edgeList, index, of, curves] = loop.p.slice(1 + 5 * k, 6 + 5 * k).map(num);
      assert.deepEqual([type, curves], [0, 0]);
      list = at(es, edgeList, 504);
      const [line, svp, sv, tvp, tv] = list.p.slice(1 + 5 * (index - 1), 6 + 5 * (index - 1)).map(num);
      at(es, line, 110);
      at(es, svp, 502);
      assert.equal(svp, tvp);
      uses.set(index, [...(uses.get(index) ?? []), of]);
      vertices.add(`${svp}:${sv}`).add(`${tvp}:${tv}`);
      ends.push(of === 1 ? [sv, tv] : [tv, sv]);
      // the line runs from its start vertex to its end
      const vl = es.get(svp)!;
      const point = (j: number): V3 => vl.p.slice(1 + 3 * (j - 1), 4 + 3 * (j - 1)).map(num) as V3;
      assert.deepEqual(es.get(line)!.p.map(num), [...point(sv), ...point(tv)]);
    }
    ends.forEach(([, end], k) => assert.equal(end, ends[(k + 1) % ends.length][0], "the loop runs on"));
    assert.ok(list);
  }
  for (const [, u] of uses) assert.deepEqual(u.sort(), [0, 1], "each edge once each way");
  const result = { v: vertices.size, e: uses.size, f: n };
  assert.equal(result.v - result.e + result.f, 2, "Euler");
  return result;
}

/** Checks a trimmed surface (144): its outline a closed curve on its patch's plane, its parameter-space twin inside the patch. */
function checkTrimmed(es: Map<number, Ent>, ts: Ent): void {
  assert.equal(ts.status, "00000000");
  const surface = at(es, ts.p[0], 128);
  assert.deepEqual(ts.p.slice(1, 3), ["1", "0"]);
  const bound = at(es, ts.p[3], 142);
  assert.equal(bound.p[1], ts.p[0], "the curve is on the trimmed surface");
  const flat = at(es, bound.p[2], 126);
  assert.equal(flat.status, "00010500", "a parameter-space curve");
  const outline = at(es, bound.p[3], 126);
  const [p00, p10, p01] = patchCorners(surface);
  const normal = cross(sub(p10, p00), sub(p01, p00));
  const pts = curvePoints(outline);
  assert.deepEqual(pts[0], pts[pts.length - 1], "closed");
  assert.equal(outline.p[3], "1");
  for (const p of pts) assert.ok(Math.abs(dot(normal, sub(p, p00))) < 1e-3 * Math.hypot(...normal), "on the plane");
  for (const p of curvePoints(flat)) assert.ok(p[0] >= -1e-9 && p[0] <= 1 + 1e-9 && p[1] >= -1e-9 && p[1] <= 1 + 1e-9 && p[2] === 0);
}

const named = (es: Map<number, Ent>, e: Ent): string => {
  // a Name property after the entity's own parameters: no associativities, one property
  const prop = at(es, e.p[e.p.length - 1], 406);
  assert.deepEqual(e.p.slice(-3, -1), ["0", "1"]);
  assert.equal(prop.form, 15);
  return prop.p[1];
};
const colourOf = (es: Map<number, Ent>, e: Ent): number[] => at(es, -e.color, 314).p.slice(0, 3).map(num);
const ofType = (es: Map<number, Ent>, type: number): Ent[] => [...es.values()].filter((e) => e.type === type);

// a cube: one solid
{
  const r = exportIges(model([{ name: "Cube", pieces: [{ color: "#ff0000", triangles: box(0, 0, 0, 1000, 1000, 1000) }] }]), false, "Test.vwx", new Date("2026-11-03T12:00:00Z"));
  assert.deepEqual([r.solids, r.surfaces, r.faces], [1, 0, 6]);
  const { es, global } = read(r.text);
  assert.deepEqual(global.slice(0, 2), [",", ";"]);
  assert.equal(global[3], "Test.igs");
  assert.deepEqual([global[13], global[14], global[22]], ["2", "MM", "11"], "millimetres, IGES 5.3");
  assert.equal(global[17], "20261103.120000");
  assert.equal(num(global[19]), 1000, "the largest coordinate");
  const [msbo] = ofType(es, 186);
  assert.deepEqual(checkSolid(es, msbo, [500, 500, 500]), { v: 8, e: 12, f: 6 });
  assert.equal(named(es, msbo), "Cube");
  assert.deepEqual(colourOf(es, msbo), [100, 0, 0]);
  assert.equal(msbo.level, 1);
  assert.equal(ofType(es, 144).length, 0);
  assert.ok(r.text.startsWith("Rodeo IGES export of Test, millimetres, z up"));
}

// trimmed surfaces: six of them
{
  const r = exportIges(model([{ name: "Cube", pieces: [{ color: "#808080", triangles: box(0, 0, 0, 1000, 1000, 1000) }] }]), true, "Test.vwx");
  assert.deepEqual([r.solids, r.surfaces, r.faces], [0, 6, 6]);
  const { es } = read(r.text);
  assert.equal(ofType(es, 186).length, 0);
  const ts = ofType(es, 144);
  assert.equal(ts.length, 6);
  for (const t of ts) {
    checkTrimmed(es, t);
    assert.equal(named(es, t), "Cube");
  }
}

// an open box goes as trimmed surfaces; two boxes apart in one object as two solids; a box with its cap wound as its top closes
{
  const flipped = (tris: number[]): number[] => {
    const out = [...tris];
    for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
    return out;
  };
  const r = exportIges(
    model([
      { name: "Tray", pieces: [{ color: "#00ff00", triangles: box(0, 0, 0, 500, 500, 200, [1]) }] },
      { name: "Pair", pieces: [{ color: "#0000ff", triangles: [...box(0, 0, 0, 100, 100, 100), ...box(300, 0, 0, 400, 100, 100)] }] },
      { name: "Caps", pieces: [{ color: "#0000ff", triangles: [...flipped(box(0, 0, 0, 10, 10, 10, [1, 2, 3, 4, 5])), ...box(0, 0, 0, 10, 10, 10, [0])] }] },
    ]),
    false,
    "Test.vwx",
  );
  assert.deepEqual([r.solids, r.surfaces, r.faces], [3, 5, 23]);
  const { es } = read(r.text);
  const solids = ofType(es, 186);
  checkSolid(es, solids[0], [50, 50, 50]);
  checkSolid(es, solids[1], [350, 50, 50]);
  checkSolid(es, solids[2], [5, 5, 5]);
  for (const t of ofType(es, 144)) checkTrimmed(es, t);
  // one colour definition each
  assert.equal(ofType(es, 314).length, 2);
}

// a lid of another colour: the face keeps its own; a name past ASCII; nothing at all
{
  const r = exportIges(
    model([
      {
        name: "Lid é",
        pieces: [
          { color: "#ff0000", triangles: box(0, 0, 0, 1000, 1000, 1000, [1]) },
          { color: "#0000ff", triangles: box(0, 0, 0, 1000, 1000, 1000, [0, 2, 3, 4, 5]) },
        ],
      },
    ]),
    false,
    "Test.vwx",
  );
  const { es } = read(r.text);
  const [msbo] = ofType(es, 186);
  checkSolid(es, msbo, [500, 500, 500]);
  assert.equal(named(es, msbo), "Lid ?");
  const off = ofType(es, 510).filter((f) => f.color !== 0);
  assert.equal(off.length, 1);
  assert.deepEqual(colourOf(es, off[0]), [0, 0, 100]);
  const none = exportIges({ layers: [] }, false, "Empty.vwx");
  assert.deepEqual([none.solids, none.surfaces, none.faces], [0, 0, 0]);
  read(none.text);
}

console.log("iges: all passed");
