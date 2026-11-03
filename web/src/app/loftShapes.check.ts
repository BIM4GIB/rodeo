// Node check of Loft Surface's sums. Run from web/: npx tsx src/app/loftShapes.check.ts

import assert from "node:assert/strict";
import { aligned, birailRings, loftFaces, loftProblem, loftRings, loftWires, oneRailRings, shareNearest, type LoftCurve, type Point3 } from "./loftShapes.ts";
import { meshVolume } from "./solidOps.ts";

const near = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

const square = (side: number, z: number, cx = 0, cy = 0): LoftCurve => {
  const h = side / 2;
  return { closed: true, points: [[cx - h, cy - h, z], [cx + h, cy - h, z], [cx + h, cy + h, z], [cx - h, cy + h, z]] };
};
const circle = (r: number, z: number, n = 48): LoftCurve => ({ closed: true, points: Array.from({ length: n }, (_, i): Point3 => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]) });
const line = (a: Point3, b: Point3): LoftCurve => ({ closed: false, points: [a, b] });
const volumeOf = (faces: number[][]): number => meshVolume(faces.flat());
const plain = { ruled: true, closed: false, solid: true };

// two equal squares ruled: a box
{
  const rings = loftRings([square(1000, 0), square(1000, 500)], plain);
  assert.equal(rings.length, 2);
  assert.equal(rings[0].length, 4);
  near(volumeOf(loftFaces(rings, true, true)), 5e8, 1);
  assert.equal(loftFaces(rings, true, true).length, 12);
  // no caps: open at both ends
  assert.equal(loftFaces(rings, true, false).length, 8);
}

// a frustum of squares, 1000 to 500 over 600: h/3 (A1 + A2 + sqrt(A1 A2))
near(volumeOf(loftFaces(loftRings([square(1000, 0), square(500, 600)], plain), true, true)), (600 / 3) * (1e6 + 250000 + 500000), 1);

// a square into a circle keeps the square's corners and the circle's points
{
  const rings = loftRings([square(1000, 0), circle(500, 800)], plain);
  assert.equal(rings[0].length, rings[1].length);
  for (const c of square(1000, 0).points) assert.ok(rings[0].some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1e-9));
  assert.ok(rings[1].every((p) => Math.abs(Math.hypot(p[0], p[1]) - 500) < 1));
}

// a section running the other way is turned, so the loft doesn't cross itself
{
  const back: LoftCurve = { closed: true, points: [...square(1000, 500).points].reverse() };
  const rings = loftRings([square(1000, 0), back], plain);
  near(volumeOf(loftFaces(rings, true, true)), 5e8, 1);
}

// through three sections: a curve, passing through the middle one, wider than a straight line
{
  const three = [square(1000, 0), square(1400, 500), square(1000, 1000)];
  const rings = loftRings(three, { ruled: false, closed: false, solid: true });
  assert.equal(rings.length, 2 * 8 + 1);
  // the middle ring is the middle section
  assert.ok(Math.abs(Math.max(...rings[8].map((p) => p[0])) - 700) < 1e-9);
  near(rings[8][0][2], 500, 1e-9);
  const curved = volumeOf(loftFaces(rings, true, true));
  const ruled = volumeOf(loftFaces(loftRings(three, plain), true, true));
  assert.ok(curved > ruled);
  // the ends are the first and last sections
  assert.ok(Math.abs(Math.max(...rings[0].map((p) => p[0])) - 500) < 1e-9);
  assert.ok(Math.abs(Math.max(...rings[rings.length - 1].map((p) => p[0])) - 500) < 1e-9);
}

// closed: a loop through three squares round the z axis, with no caps
{
  const turn = (a: number, c: LoftCurve): LoftCurve => ({ closed: true, points: c.points.map((p): Point3 => [(p[0] + 1000) * Math.cos(a), (p[0] + 1000) * Math.sin(a), p[1]]) });
  const ring = square(300, 0);
  const loop = [0, 1, 2, 3].map((k) => turn((k * Math.PI) / 2, ring));
  const rings = loftRings(loop, { ruled: true, closed: true, solid: false });
  assert.equal(rings.length, 5);
  assert.equal(loftFaces(rings, true, true).length, 4 * 4 * 2);
}

// open sections: a ruled sheet
{
  const sheet = loftRings([line([0, 0, 0], [1000, 0, 0]), line([0, 500, 0], [1000, 500, 0])], plain);
  const faces = loftFaces(sheet, false, true);
  assert.equal(faces.length, 2);
  assert.equal(loftProblem([line([0, 0, 0], [1, 0, 0]), square(10, 0)]) !== null, true);
  assert.equal(loftProblem([square(10, 0), square(10, 5)]), null);
}

// reversing and moving the start
{
  const a = aligned(square(1000, 0), false, 0.25);
  assert.deepEqual(a.points[0], [500, -500, 0]);
  const mid = aligned(square(1000, 0), false, 0.125);
  assert.equal(mid.points.length, 5);
  near(mid.points[0][0], 0, 1e-9);
  near(mid.points[0][1], -500, 1e-9);
  const r = aligned(line([0, 0, 0], [10, 0, 0]), true, 0);
  assert.deepEqual(r.points[0], [10, 0, 0]);
  const rc = aligned(square(1000, 0), true, 0);
  assert.deepEqual(rc.points[0], square(1000, 0).points[0]);
  assert.deepEqual(rc.points[1], square(1000, 0).points[3]);
  near(shareNearest(square(1000, 0), [500, -500, 0]), 0.25, 1e-9);
  near(shareNearest(square(1000, 0), [0, -700, 0]), 0.125, 1e-9);
  near(shareNearest(line([0, 0, 0], [10, 0, 0]), [5, 3, 0]), 0.5, 1e-9);
}

// one rail, straight: a section square to it makes a box, the rail's length long
{
  const rail = line([0, 0, 0], [0, 0, 1000]);
  const rings = oneRailRings(rail, [square(200, 0)]);
  near(volumeOf(loftFaces(rings, true, true)), 200 * 200 * 1000, 1);
  // two sections: square 200 at the start, square 400 at the end
  const morph = oneRailRings(rail, [square(200, 0), square(400, 1000)]);
  near(volumeOf(loftFaces(morph, true, true)), (1000 / 3) * (40000 + 160000 + 80000), 500000);
  assert.ok(Math.abs(Math.max(...morph[morph.length - 1].map((p) => p[0])) - 200) < 1e-6);
}

// one rail round a right angle: the section turns with it
{
  const rail: LoftCurve = { closed: false, points: [[0, 0, 0], [0, 0, 1000], [1000, 0, 1000]] };
  const rings = oneRailRings(rail, [square(100, 0)]);
  const last = rings[rings.length - 1];
  // the end section is square to the rail's last leg, so flat in x
  const xs = last.map((p) => p[0]);
  near(Math.max(...xs) - Math.min(...xs), 0, 1e-6);
}

// two rails: a section between two lines parting evenly grows with them, a frustum
{
  const a = line([-500, 0, 0], [-1000, 0, 1000]);
  const b = line([500, 0, 0], [1000, 0, 1000]);
  const rings = birailRings(a, b, square(1000, 0));
  const top = rings[rings.length - 1];
  near(Math.max(...top.map((p) => p[0])), 1000, 1e-6);
  near(Math.min(...top.map((p) => p[0])), -1000, 1e-6);
  near(top[0][2], 1000, 1e-6);
  near(Math.max(...top.map((p) => p[1])), 1000, 1e-6);
  // a straight pair of rails is just a box
  const box = birailRings(line([-500, 0, 0], [-500, 0, 1000]), line([500, 0, 0], [500, 0, 1000]), square(1000, 0));
  near(volumeOf(loftFaces(box, true, true)), 1e9, 1);
}

// a cap of an L-shaped section, not convex: its area, in the box it makes
{
  const ell = (z: number): LoftCurve => ({ closed: true, points: [[0, 0, z], [1000, 0, z], [1000, 500, z], [500, 500, z], [500, 1000, z], [0, 1000, z]] });
  near(volumeOf(loftFaces(loftRings([ell(0), ell(100)], plain), true, true)), 750000 * 100, 1);
}

assert.ok(loftWires(loftRings([square(100, 0), square(100, 50)], plain), true).length > 0);

console.log("all checks passed");
