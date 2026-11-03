// Run: npx tsx src/app/projectShapes.check.ts
import assert from "node:assert/strict";
import { connectedParts, curveNormal, isOnPlane, ribOn, ringOf, splitBy, trimBy } from "./projectShapes.ts";
import type { Vec3 } from "./solidOps.ts";

const box = (x0: number, y0: number, z0: number, w: number, d: number, hh: number): number[] => {
  const c = (x: number, y: number, z: number): number[] => [x0 + x * w, y0 + y * d, z0 + z * hh];
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

const volume = (t: ArrayLike<number>): number => {
  let v = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    v += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
  }
  return Math.abs(v);
};

const near = (a: number, b: number, share = 1e-4): void => assert.ok(Math.abs(a - b) <= Math.max(Math.abs(b) * share, 1e-6), `${a} near ${b}`);

const solid = box(0, 0, 0, 1000, 1000, 1000);
const circle = (x: number, y: number, r: number, z: number, n = 32): Vec3[] => Array.from({ length: n }, (_, i): Vec3 => [x + r * Math.cos((2 * Math.PI * i) / n), y + r * Math.sin((2 * Math.PI * i) / n), z]);
const polyArea = (r: number, n: number): number => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

// the normal faces up however a ring is wound, and a wall's toward +y
const up = curveNormal({ points: circle(0, 0, 100, 50), closed: true });
assert.deepEqual(up.map((v) => Math.round(v) + 0), [0, 0, 1]);
assert.deepEqual(curveNormal({ points: [...circle(0, 0, 100, 50)].reverse(), closed: true }).map((v) => Math.round(v) + 0), [0, 0, 1]);
assert.deepEqual(curveNormal({ points: [[0, 0, 0], [100, 0, 0], [100, 0, 100]], closed: true }).map((v) => Math.round(v) + 0), [0, 1, 0]);
// a straight curve goes straight down
assert.deepEqual(curveNormal({ points: [[0, 0, 0], [100, 50, 0]], closed: false }).map((v) => Math.round(v) + 0), [0, 0, 1]);
assert.ok(isOnPlane({ points: circle(0, 0, 100, 50), closed: true }, up));
assert.ok(!isOnPlane({ points: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 90]], closed: true }, [0, 0, 1]));

// Split with a closed curve: a core and the rest, the volume whole
const ring = circle(500, 500, 200, 1500);
const n: Vec3 = [0, 0, 1];
const parts = splitBy(solid, ring, n);
assert.ok(typeof parts !== "string");
assert.equal(parts.length, 2);
const core = polyArea(200, 32) * 1000;
const volumes = parts.map(volume).sort((a, b) => a - b);
near(volumes[0], core);
near(volumes[1], 1e9 - core);

// Split with an open curve: its ends outside, in two halves
const open = { points: [[-100, 300, 1500], [500, 400, 1500], [1100, 300, 1500]] as Vec3[], closed: false };
const openRing = ringOf(open, n, solid);
assert.ok(typeof openRing !== "string");
const halves = splitBy(solid, openRing, n);
assert.ok(typeof halves !== "string");
assert.equal(halves.length, 2);
near(halves.map(volume).reduce((a, b) => a + b), 1e9);
// under the curve within the box: from y 316.67 at each side up to 400 at the middle, 1000 wide and 1000 high
near(Math.min(...halves.map(volume)), ((316.6667 + 400) / 2) * 1000 * 1000, 1e-3);

// an end over the object is refused
assert.equal(typeof ringOf({ points: [[500, 500, 1500], [1500, 500, 1500]], closed: false }, n, solid), "string");

// Trim: a click in the ring takes the core away; a click out takes the rest
const trimmedOut = trimBy(solid, ring, n, [500, 500, 1000]);
assert.ok(typeof trimmedOut !== "string");
assert.equal(trimmedOut.length, 1);
near(volume(trimmedOut[0]), 1e9 - core);
const trimmedRest = trimBy(solid, ring, n, [50, 50, 1000]);
assert.ok(typeof trimmedRest !== "string");
near(volume(trimmedRest[0]), core);

// A curve off to the side crosses nothing
assert.equal(typeof splitBy(solid, circle(5000, 5000, 100, 1500), n), "string");

// a curve through two separate pieces: three parts in all
const bar = [...box(0, 0, 0, 3000, 100, 100)];
const barParts = splitBy(bar, [[1000, -50, 500], [2000, -50, 500], [2000, 150, 500], [1000, 150, 500]], n);
assert.ok(typeof barParts !== "string");
assert.equal(barParts.length, 3);
near(barParts.map(volume).reduce((a, b) => a + b), 3e7);

// An open sheet: a ring trims a hole, and a split makes the hole's piece, with no faces added
const sheet = [0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 0, 0, 1000, 1000, 0, 0, 1000, 0];
const area = (t: ArrayLike<number>): number => {
  let a = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const u = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
    const v = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
};
const hole = trimBy(sheet, ring, n, [500, 500, 0]);
assert.ok(typeof hole !== "string");
near(hole.map(area).reduce((a, b) => a + b), 1e6 - polyArea(200, 32));
const sheetParts = splitBy(sheet, ring, n);
assert.ok(typeof sheetParts !== "string");
assert.equal(sheetParts.length, 2);
assert.ok(sheetParts.every((p) => p.length % 9 === 0));

// connected parts
assert.equal(connectedParts([...box(0, 0, 0, 10, 10, 10), ...box(50, 0, 0, 10, 10, 10)]).length, 2);

// Add Downward from above: a rib from the curve down to the top
const small = circle(500, 500, 200, 1500, 16);
const ribbed = ribOn(solid, small, n, [-1]);
assert.ok(typeof ribbed !== "string");
near(volume(ribbed), 1e9 + polyArea(200, 16) * 500, 1e-3);
// Add Upward from there meets nothing
assert.equal(typeof ribOn(solid, small, n, [1]), "string");
// Add Upward from below
const below = ribOn(solid, circle(500, 500, 200, -300, 16), n, [1]);
assert.ok(typeof below !== "string");
near(volume(below), 1e9 + polyArea(200, 16) * 300, 1e-3);
// both ways from above: only the way down meets it
const both = ribOn(solid, small, n, [1, -1]);
assert.ok(typeof both !== "string");
near(volume(both), 1e9 + polyArea(200, 16) * 500, 1e-3);
// a profile hanging past the side is trimmed to what meets it
const edge = ribOn(solid, [[900, 400, 1500], [1100, 400, 1500], [1100, 600, 1500], [900, 600, 1500]], n, [-1]);
assert.ok(typeof edge !== "string");
near(volume(edge), 1e9 + 100 * 200 * 500, 1e-3);
// onto a slope: a wedge of a box with its top sloping from 1000 to 500
const c = (x: number, y: number, z: number): number[] => [x, y, z];
const slope = [[c(0, 0, 0), c(0, 1000, 0), c(1000, 1000, 0), c(1000, 0, 0)], [c(0, 0, 1000), c(1000, 0, 500), c(1000, 1000, 500), c(0, 1000, 1000)], [c(0, 0, 0), c(1000, 0, 0), c(1000, 0, 500), c(0, 0, 1000)], [c(1000, 0, 0), c(1000, 1000, 0), c(1000, 1000, 500), c(1000, 0, 500)], [c(1000, 1000, 0), c(0, 1000, 0), c(0, 1000, 1000), c(1000, 1000, 500)], [c(0, 1000, 0), c(0, 0, 0), c(0, 0, 1000), c(0, 1000, 1000)]].flatMap((q) => [...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]]);
const onSlope = ribOn(slope, [[400, 400, 1500], [600, 400, 1500], [600, 600, 1500], [400, 600, 1500]], n, [-1]);
assert.ok(typeof onSlope !== "string");
near(volume(onSlope) - volume(slope), 200 * 200 * (1500 - 750), 1e-3);
// an open surface can't take a rib
assert.equal(typeof ribOn(sheet, small, n, [-1]), "string");

console.log("projectShapes ok");
