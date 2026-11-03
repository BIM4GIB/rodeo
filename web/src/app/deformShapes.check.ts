// Node check of the Deform tool's sums. Run from web/: npx tsx src/app/deformShapes.check.ts

import assert from "node:assert/strict";
import { anyAcross, bendMap, bendTooTight, bulgeMap, deformed, deformedAround, farHeight, mappedLines, pointsOf, sizeOfPoints, taperMap, twistFaceMap, twistMap, type Frame } from "./deformShapes.ts";
import { faceAndNeighbours, healed, isClosedMesh, meshVolume, solidFace, type Vec3 } from "./solidOps.ts";

const near = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

function box(x0: number, y0: number, z0: number, w: number, d: number, h: number): number[] {
  const c = (x: number, y: number, z: number): number[] => [x0 + x * w, y0 + y * d, z0 + z * h];
  const quad = (a: number[], b: number[], e: number[], f: number[]): number[] => [...a, ...b, ...e, ...a, ...e, ...f];
  return [
    ...quad(c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)),
    ...quad(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)),
    ...quad(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)),
    ...quad(c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)),
    ...quad(c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)),
    ...quad(c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)),
  ];
}

const column = box(-100, -100, 0, 200, 200, 2000);
const volume = meshVolume(column);
const frame: Frame = { center: [0, 0, 0], axis: [0, 0, 1], across: [1, 0, 0] };
const far = farHeight(pointsOf(column), frame);
assert.equal(far, 2000);
near(sizeOfPoints(pointsOf(column)), Math.hypot(200, 200, 2000), 1e-6);
near(Math.abs(anyAcross([0, 0, 1])[2]), 0, 1e-9);

const top = (t: ArrayLike<number>, z: number): Vec3[] => pointsOf(t).filter((p) => Math.abs(p[2] - z) < 1e-6);

// a quarter twist: the bottom stays, the top's square is turned, and the volume holds
{
  const t = deformed(column, twistMap(frame, far, 90), 100);
  assert.ok(isClosedMesh(t));
  assert.ok(t.length / 9 > 500);
  near(meshVolume(t), volume, volume * 0.02);
  near(Math.max(...top(t, 0).map((p) => p[0])), 100, 1e-6);
  near(Math.max(...top(t, 2000).map((p) => p[0])), 100, 1e-6);
  // the middle is an eighth turn: a corner runs out to the diagonal
  const middle = pointsOf(t).filter((p) => Math.abs(p[2] - 1000) < 1e-6);
  near(Math.max(...middle.map((p) => p[0])), Math.hypot(100, 100), 1e-6);
  // a centre part way up turns the two ends opposite ways
  const f2: Frame = { center: [0, 0, 1000], axis: [0, 0, 1], across: [1, 0, 0] };
  const map = twistMap(f2, farHeight(pointsOf(column), f2), 90);
  const [hi, lo] = [map([100, 0, 2000]), map([100, 0, 0])];
  near(hi[1], 100, 1e-6);
  near(lo[1], -100, 1e-6);
  // past a full turn
  near(twistMap(frame, far, 450)([100, 0, 2000])[1], 100, 1e-6);
}

// a taper of 2: square at the plane, twice as wide at the far end
{
  const t = deformed(column, taperMap(frame, far, 2, true), 200);
  assert.ok(isClosedMesh(t));
  near(Math.max(...top(t, 2000).map((p) => p[0])), 200, 1e-6);
  near(Math.max(...top(t, 2000).map((p) => p[1])), 200, 1e-6);
  near(Math.max(...top(t, 0).map((p) => p[0])), 100, 1e-6);
  // a frustum: 2000/3 × (A + √(A·B) + B)
  near(meshVolume(t), (2000 / 3) * (40000 + 80000 + 160000), 1e6);
  // one way: only along the reference line
  const one = deformed(column, taperMap(frame, far, 2, false), 200);
  near(Math.max(...top(one, 2000).map((p) => p[0])), 200, 1e-6);
  near(Math.max(...top(one, 2000).map((p) => p[1])), 100, 1e-6);
  near(meshVolume(one), 40000 * 1500 * 2000 / 1500, 1e6 * 80);
}

// a bulge: widest at the plane, the far end as it was
{
  const f2: Frame = { center: [0, 0, 1000], axis: [0, 0, 1], across: [1, 0, 0] };
  const fh = farHeight(pointsOf(column), f2);
  const t = deformed(column, bulgeMap(f2, fh, 1.5, true), 100);
  assert.ok(isClosedMesh(t));
  near(Math.max(...top(t, 1000).map((p) => p[0])), 150, 1e-6);
  near(Math.max(...top(t, 2000).map((p) => p[0])), 100, 1e-6);
  near(Math.max(...top(t, 0).map((p) => p[0])), 100, 1e-6);
  assert.ok(meshVolume(t) > volume);
  const thin = deformed(column, bulgeMap(f2, fh, 0.5, true), 100);
  assert.ok(meshVolume(thin) < volume);
}

// a bend of 90° over the whole column, from its foot, toward +x: the top lies over on its side
{
  const b = { start: [0, 0, 0] as Vec3, along: [0, 0, 1] as Vec3, toward: [1, 0, 0] as Vec3, length: 2000, degrees: 90, symmetric: false, finite: true };
  const t = deformed(column, bendMap(b), 100);
  assert.ok(isClosedMesh(t));
  near(meshVolume(t), volume, volume * 0.02);
  const r = 2000 / (Math.PI / 2);
  const end = bendMap(b)([0, 0, 2000]);
  near(end[0], r, 1e-6);
  near(end[2], r, 1e-6);
  // the top's face now looks along +x; the foot stays
  near(bendMap(b)([0, 0, 0])[2], 0, 1e-9);
  assert.deepEqual(bendMap(b)([50, 50, 0]).map((v) => Math.round(v)), [50, 50, 0]);
  // past the spine it runs straight on
  const short = { ...b, length: 1000 };
  const r2 = 1000 / (Math.PI / 2);
  const past = bendMap(short)([0, 0, 2000]);
  near(past[0], r2 + 1000, 1e-6);
  near(past[2], r2, 1e-6);
  // not finite: it keeps turning, half a turn by twice the spine
  const whole = bendMap({ ...short, finite: false })([0, 0, 2000]);
  near(whole[0], 2 * r2, 1e-6);
  near(whole[2], 0, 1e-6);
  // symmetric: the far side bends toward the same side; one way leaves it
  assert.deepEqual(bendMap(short)([10, 0, -500]), [10, 0, -500]);
  const both = bendMap({ ...short, symmetric: true })([0, 0, -1000]);
  near(both[0], r2, 1e-6);
  near(both[2], -r2, 1e-6);
  // negative bends the other way; none is none
  near(bendMap({ ...b, degrees: -90 })([0, 0, 2000])[0], -r, 1e-6);
  assert.deepEqual(bendMap({ ...b, degrees: 0 })([1, 2, 3]), [1, 2, 3]);
  // too tight for its width
  assert.ok(bendTooTight(pointsOf(column), { ...b, length: 100, degrees: 180 }));
  assert.ok(!bendTooTight(pointsOf(column), b));
}

// twist a face: the base stays, the block on it twists, its neighbours follow
{
  const block = healed(box(-500, -500, 0, 1000, 1000, 1000));
  const face = solidFace(block, { point: [0, 0, 1000], normal: [0, 0, 1] });
  assert.ok(typeof face !== "string");
  if (typeof face !== "string") {
    const around = faceAndNeighbours(face);
    // the top, and its four sides; not the bottom
    assert.equal(around.size, 10);
    const f: Frame = { center: [0, 0, 1000], axis: [0, 0, 1], across: [1, 0, 0] };
    const map = twistFaceMap(f, -1000, 90);
    const t = deformedAround(face, around, map, 100);
    assert.ok(isClosedMesh(t));
    near(Math.max(...top(t, 0).map((p) => p[0])), 500, 1e-6);
    near(map([500, 0, 1000])[1], 500, 1e-6);
    near(map([500, 0, 0])[1], 0, 1e-9);
  }
}

// the preview lines
{
  const lines = mappedLines([[[0, 0, 0], [0, 0, 2000]]], twistMap(frame, far, 90), 500);
  assert.equal(lines.length, 4 * 6);
}

console.log("all checks passed");
