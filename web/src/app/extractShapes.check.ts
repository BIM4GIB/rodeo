// Run: npx tsx src/app/extractShapes.check.ts
import assert from "node:assert/strict";
import { allFaces, circleCentre, edgeLoci, facesAt, isoCurve, joined, onePerPlace, pieces, ringsOf, trianglesOf, wholeEdges, type Point } from "./extractShapes.ts";

const box = (w: number, d: number, hh: number): number[] => {
  const c = (x: number, y: number, z: number): number[] => [x * w, y * d, z * hh];
  const quads = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)],
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)],
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
    [c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)],
    [c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)],
  ];
  return quads.flatMap((q) => [...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]]);
};

const cylinder = (r: number, hh: number, n: number): number[] => {
  const out: number[] = [];
  const at = (i: number, z: number): number[] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z];
  for (let i = 0; i < n; i++) {
    out.push(...at(i, 0), ...at(i + 1, 0), ...at(i + 1, hh), ...at(i, 0), ...at(i + 1, hh), ...at(i, hh));
    out.push(0, 0, hh, ...at(i, hh), ...at(i + 1, hh));
    out.push(0, 0, 0, ...at(i + 1, 0), ...at(i, 0));
  }
  return out;
};

const close = (a: readonly number[], b: readonly number[], tol = 1e-6): void => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= tol, `${a} near ${b}`));

// a box's twelve edges, straight
const b = box(2000, 1000, 500);
const be = pieces(b);
assert.equal(be.length, 12);
const bw = wholeEdges(be, 2000);
assert.equal(bw.length, 12);
for (const e of bw) assert.equal(e.pieces.length, 1);
// start, end, middle
const long = bw.find((e) => Math.abs(e.points[0][2] - 500) < 1 && Math.abs(e.points[1][2] - 500) < 1 && Math.abs(e.points[0][0] - e.points[1][0]) > 1999)!;
const loci = edgeLoci(long);
assert.equal(loci.length, 3);
assert.equal(loci[2][0], 1000);

// a cylinder's rims are whole circles, each with a centre
const c = cylinder(500, 1500, 48);
const ce = pieces(c);
const cw = wholeEdges(ce, 1500);
assert.equal(cw.length, 2);
for (const e of cw) {
  assert.ok(e.closed);
  assert.equal(e.pieces.length, 48);
  const on = edgeLoci(e);
  // start, the far side and the centre
  assert.equal(on.length, 3);
  close(on[2], [0, 0, e.points[0][2]], 1e-6);
  close(on[1], [-on[0][0], -on[0][1], on[0][2]], 1e-6);
}

// a hexagon is six edges, not a circle
const hex = cylinder(500, 100, 6);
assert.equal(wholeEdges(pieces(hex), 1000).length, 18);

// an arc has its centre; a straight doesn't
const arc: Point[] = [0, 1, 2, 3, 4, 5, 6].map((i) => [100 * Math.cos(i / 6), 100 * Math.sin(i / 6), 5]);
close(circleCentre(arc)!, [0, 0, 5], 1e-6);
assert.equal(circleCentre([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]), null);
// nor does a wavy line
assert.equal(circleCentre([[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 1, 0], [4, 0, 0]]), null);

// shared points once
assert.equal(onePerPlace([[[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [2, 0, 0]]], 100).length, 3);

// joined: a ring closes, a spare point on a straight goes, and a point three share stops a curve
const ring = joined([[[0, 0, 0], [50, 0, 0]], [[50, 0, 0], [100, 0, 0]], [[100, 0, 0], [100, 100, 0]], [[100, 100, 0], [0, 100, 0]], [[0, 100, 0], [0, 0, 0]]], 100);
assert.equal(ring.length, 1);
assert.ok(ring[0].closed);
assert.equal(ring[0].points.length, 4);
const three = joined([[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1]]], 10);
assert.equal(three.length, 3);
assert.equal(joined(be.map((e) => [e.a, e.b] as const), 2000).length, 12);

// faces: the top of a box, then all six; the whole side of a cylinder is one face
const top = facesAt(b, { point: [1000, 500, 500], normal: [0, 0, 1] }, false);
assert.equal(top.length, 1);
assert.ok(top[0].flat);
assert.equal(trianglesOf(top[0]).length, 18);
assert.equal(ringsOf(top[0])[0].points.length, 4);
assert.equal(allFaces(b).length, 6);
const seam = ((2 * Math.PI) / 48) * 0.5;
const side = facesAt(c, { point: [500 * Math.cos(seam), 500 * Math.sin(seam), 700] as const, normal: [Math.cos(seam), Math.sin(seam), 0] as const }, false);
assert.equal(side.length, 1);
assert.equal(side[0].triangles.size, 96);
assert.equal(allFaces(c).length, 3);

// iso-parametric: along a cylinder is its height, across it a ring at the click's height
const pick = { point: [500 * Math.cos(seam) * 0.999, 500 * Math.sin(seam) * 0.999, 700] as const, normal: [Math.cos(seam), Math.sin(seam), 0] as const };
const along = isoCurve(c, pick, "u");
assert.ok(typeof along !== "string");
assert.equal(along.points.length, 2);
assert.ok(Math.abs(Math.abs(along.points[0][2] - along.points[1][2]) - 1500) < 1e-6);
assert.ok(!along.closed);
const across = isoCurve(c, pick, "v");
assert.ok(typeof across !== "string");
assert.ok(across.closed);
assert.equal(across.points.length, 48);
for (const p of across.points) assert.ok(Math.abs(p[2] - 700) < 1e-6);
// on a flat face: along its longest side, then across
const flatU = isoCurve(b, { point: [700, 300, 500], normal: [0, 0, 1] }, "u");
assert.ok(typeof flatU !== "string");
assert.equal(flatU.points.length, 2);
close([Math.abs(flatU.points[0][0] - flatU.points[1][0]), flatU.points[0][1], flatU.points[1][1]], [2000, 300, 300], 1e-6);
const flatV = isoCurve(b, { point: [700, 300, 500], normal: [0, 0, 1] }, "v");
assert.ok(typeof flatV !== "string");
close([flatV.points[0][0], flatV.points[1][0], Math.abs(flatV.points[0][1] - flatV.points[1][1])], [700, 700, 1000], 1e-6);

// an open sheet with a fold: six sides round it, and the fold
const sheet = [6000, 0, 0, 7000, 0, 0, 7000, 1000, 0, 6000, 0, 0, 7000, 1000, 0, 6000, 1000, 0, 7000, 0, 0, 7700, 0, 700, 7700, 1000, 700, 7000, 0, 0, 7700, 1000, 700, 7000, 1000, 0];
const se = pieces(sheet);
assert.equal(se.length, 7);
assert.equal(se.filter((e) => e.n1 !== e.n2).length, 1);
const sj = joined(se.map((e) => [e.a, e.b] as const), 1700);
assert.equal(sj.length, 3);

console.log("extractShapes ok");
