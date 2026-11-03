// Node check of Export Simple VectorScript (3D only)'s text. Run from web/: npx tsx src/features/python/simpleScript.check.ts

import assert from "node:assert/strict";
import { FRONT_BASIS, simpleScript, TOP_BASIS, viewBasis, type Vec3 } from "./simpleScript.ts";

/** A box's 12 triangles, counter-clockwise from outside. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const c = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]);
}

const cube = { triangles: box(0, 0, 0, 1000, 1000, 1000) };
const tri = { triangles: [0, 0, 2000, 500, 0, 2000, 0, 500, 2000] };
const top = simpleScript([cube, tri], TOP_BASIS, 1, "millimeters", "Test.vwx", "Top/Plan");
assert.equal(top.objects, 2);
assert.equal(top.faces, 7, "the cube's six faces and the triangle");
assert.equal(top.text.match(/Poly3D\(/g)?.length, 7);
assert.equal(top.text.match(/BeginGroup;/g)?.length, 1, "a lone face isn't grouped");
assert.ok(top.text.includes("Poly3D(0, 0, 2000,  500, 0, 2000,  0, 500, 2000);"), top.text);
assert.ok(top.text.trimEnd().endsWith("RUN(Simple3D);"));
assert.ok(top.text.includes("    ClosePoly;\n    Part1;\nEND;"));
// every cube corner is on the cube
for (const m of top.text.matchAll(/Poly3D\(([^)]*)\)/g)) {
  const v = m[1].split(",").map(Number);
  assert.equal(v.length % 3, 0);
}

// Front view in inches: z up the page as y, depth toward the viewer as -y
const front = simpleScript([tri], FRONT_BASIS, 25.4, "inches", "Test.vwx", "Front view");
assert.ok(front.text.includes("Poly3D(0, 78.740157, 0,  19.685039, 78.740157, 0,  0, 78.740157, -19.685039);"), front.text);
assert.ok(front.text.includes("in Front view"));

// a view basis: looking from the front is Front view; straight down keeps the given right
const near = (a: readonly Vec3[], b: readonly Vec3[]): void => a.forEach((r, i) => r.forEach((v, j) => assert.ok(Math.abs(v - b[i][j]) < 1e-12, `${a} vs ${b}`)));
near(viewBasis([0, -5000, 0], [0, 0, 0]), FRONT_BASIS);
near(viewBasis([0, 0, 5000], [0, 0, 0]), TOP_BASIS);
near(viewBasis([0, 0, 5000], [0, 0, 0], [0, 1, 0]), [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
]);
// an isometric view: right is level, up and toward the viewer are square to it
const iso = viewBasis([-1, -1, 1], [0, 0, 0]);
assert.ok(Math.abs(iso[0][2]) < 1e-12, "right stays level");
for (const [a, b] of [
  [0, 1],
  [1, 2],
  [0, 2],
])
  assert.ok(Math.abs(iso[a].reduce((n, v, k) => n + v * iso[b][k], 0)) < 1e-12);

// many objects split into procedures, an object never across two
const many = simpleScript(Array.from({ length: 70 }, (_, i) => ({ triangles: box(i * 2000, 0, 0, i * 2000 + 1000, 1000, 1000) })), TOP_BASIS, 1, "millimeters", "Test.vwx", "Top/Plan");
assert.equal(many.faces, 420);
assert.equal(many.text.match(/PROCEDURE Part\d+;/g)?.length, 2);
const first = many.text.slice(many.text.indexOf("PROCEDURE Part1;"), many.text.indexOf("PROCEDURE Part2;"));
assert.equal(first.match(/BeginGroup;/g)?.length, first.match(/EndGroup;/g)?.length);
assert.equal(first.match(/Poly3D\(/g)?.length, 396, "66 cubes, the 67th in the next");
console.log("simpleScript: all passed");
