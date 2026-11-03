// Run with: npx tsx src/app/chainExtrudeShapes.check.ts
import assert from "node:assert/strict";
import { chainContinuous, chainPath, chainPlan, chainReach, chainRibs, chainSections, chainSolids, ribTriangles, type ChainOptions, type ChainPath } from "./chainExtrudeShapes.ts";
import { isClosedMesh, meshVolume } from "./solidOps.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const pathOf = (points: { x: number; y: number }[], closed: boolean, flip = false): ChainPath => {
  const p = chainPath(points, closed, flip);
  assert.notEqual(typeof p, "string");
  return p as ChainPath;
};
const options: ChainOptions = { flip: false, centerRibs: true, cornerRibs: false, datum: "top", thickness: 50, spacing: 500, elevation: 0 };
const box = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const cornersOf = (flat: readonly number[]): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
};

// the reference: the top or bottom right of the continuous shape's box, or a locus
{
  const shape = box(-300, 100, 0, 200);
  const top = chainSections({ continuous: shape, repeating: [], locus: null }, "top").continuous;
  near(Math.max(...top.map((p) => p.y)), 0);
  near(Math.min(...top.map((p) => p.y)), -100);
  near(Math.min(...top.map((p) => p.x)), 0);
  near(Math.max(...top.map((p) => p.x)), 300);
  const bottom = chainSections({ continuous: shape, repeating: [], locus: null }, "bottom").continuous;
  near(Math.min(...bottom.map((p) => p.y)), 0);
  const locus = chainSections({ continuous: shape, repeating: [box(-100, 0, -50, 100)], locus: { x: -100, y: 150 } }, "top");
  near(Math.max(...locus.continuous.map((p) => p.x)), 200);
  near(Math.min(...locus.continuous.map((p) => p.x)), -100);
  near(Math.max(...locus.repeating[0].map((p) => p.y)), -50);
}

// a straight run goes out to the left of the way it's walked, and to the right flipped
{
  const section = box(0, 0, 100, 50);
  const left = cornersOf(chainContinuous(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false), section, 200));
  near(Math.max(...left.map((p) => p[1])), 100);
  near(Math.min(...left.map((p) => p[1])), 0);
  near(Math.min(...left.map((p) => p[2])), 200);
  near(Math.max(...left.map((p) => p[2])), 250);
  const right = cornersOf(chainContinuous(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false, true), section, 0));
  near(Math.min(...right.map((p) => p[1])), -100);
  const solid = chainContinuous(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false), section, 0);
  assert.ok(isClosedMesh(solid));
  near(meshVolume(solid), 1000 * 100 * 50);
}

// a closed square, walked clockwise so it grows outward, mitred at its corners
{
  const square = [{ x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }, { x: 0, y: 0 }];
  const path = pathOf(square, true);
  near(Math.hypot(path.frames[0].miter.x, path.frames[0].miter.y), Math.SQRT2);
  const section = box(0, 0, 100, 50);
  const solid = chainContinuous(path, section, 0);
  assert.ok(isClosedMesh(solid));
  near(meshVolume(solid), (1200 * 1200 - 1000 * 1000) * 50);
  const out = cornersOf(solid);
  near(Math.max(...out.map((p) => p[0])), 1100);
  near(Math.min(...out.map((p) => p[0])), -100);
  // flipped it grows inward
  const inward = cornersOf(chainContinuous(pathOf(square, true, true), section, 0));
  near(Math.max(...inward.map((p) => p[0])), 1000);
  near(Math.min(...inward.filter((p) => Math.abs(p[1] - 1000) < 1e-6).map((p) => p[0])), 0);
  near(Math.max(...inward.filter((p) => Math.abs(p[1] - 900) < 1e-6).map((p) => p[0])), 900);
}

// a concave section still closes up
{
  const notch = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 40 }, { x: 0, y: 100 }];
  const solid = chainContinuous(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], false), notch, 0);
  assert.ok(isClosedMesh(solid));
  assert.ok(meshVolume(solid) > 0);
}

// ribs: centred along a side, clear of the mitre zones
{
  const section = box(0, -100, 200, 0);
  const reach = chainReach([section]);
  near(reach, 200);
  const straight = chainRibs(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false), reach, options);
  assert.deepEqual(straight.map((r) => r.at.x), [0 + 250, 750]);
  // a side of an L: the corner's 200 wide zone comes off the second side's start
  const ell = pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], false);
  const ribs = chainRibs(ell, reach, { ...options, spacing: 300 });
  const onFirst = ribs.filter((r) => Math.abs(r.at.y) < 1e-6).map((r) => r.at.x);
  const onSecond = ribs.filter((r) => Math.abs(r.at.x - 1000) < 1e-6).map((r) => r.at.y);
  assert.ok(onFirst.every((x) => x <= 800 + 1e-6));
  assert.ok(onSecond.every((y) => y >= 200 - 1e-6));
  near(onFirst.reduce((a, b) => a + b, 0) / onFirst.length, 400);
  near(onSecond.reduce((a, b) => a + b, 0) / onSecond.length, 600);
  // no room between the zones, no ribs
  assert.equal(chainRibs(pathOf([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }], true), reach, options).length, 0);
  // corner ribs bisect the corner and reach its mitre
  const corners = chainRibs(ell, reach, { ...options, centerRibs: false, cornerRibs: true });
  assert.equal(corners.length, 1);
  near(corners[0].at.x, 1000);
  near(Math.hypot(corners[0].out.x, corners[0].out.y), Math.SQRT2);
  const solid = ribTriangles(corners[0], section, options);
  assert.ok(isClosedMesh(solid));
  near(meshVolume(solid), 200 * Math.SQRT2 * 100 * 50);
  const far = cornersOf(solid).map((p) => Math.hypot(p[0] - 1000, p[1]));
  near(Math.max(...far), Math.hypot(200 * Math.SQRT2, 25));
  // both off: none; a closed square has a rib on each corner
  assert.equal(chainRibs(ell, reach, { ...options, centerRibs: false }).length, 0);
  const square = pathOf([{ x: 0, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 0 }, { x: 0, y: 0 }], true);
  assert.equal(chainRibs(square, reach, { ...options, centerRibs: false, cornerRibs: true }).length, 4);
}

// a rib is the thickness wide, the section's area deep, at the height asked
{
  const section = box(0, -100, 200, 0);
  const [rib] = chainRibs(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false), 200, { ...options, spacing: 5000 });
  const solid = ribTriangles(rib, section, { ...options, elevation: 300 });
  assert.ok(isClosedMesh(solid));
  near(meshVolume(solid), 50 * 200 * 100);
  const points = cornersOf(solid);
  near(Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])), 50);
  near(Math.max(...points.map((p) => p[2])), 300);
  near(Math.min(...points.map((p) => p[2])), 200);
}

// the whole object, and its plan
{
  const path = pathOf([{ x: 0, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 0 }, { x: 0, y: 0 }], true);
  const sections = { continuous: box(0, 0, 400, 50), repeating: [box(0, -200, 300, 0)] };
  const made = chainSolids(path, sections, { ...options, cornerRibs: true }) as { continuous: number[]; ribs: number[] };
  assert.ok(isClosedMesh(made.continuous));
  assert.ok(isClosedMesh(made.ribs));
  const plan = chainPlan(path, sections, { ...options, cornerRibs: true });
  assert.equal(plan.lines.length, 2);
  assert.equal(plan.lines[1].length, 5);
  // 6 stand on each side's 2400 clear of the zones, at 500 with a 50 rib, and 4 on the corners
  assert.equal(plan.ribs.length, 4 * 5 + 4);
  assert.equal(chainPlan(pathOf([{ x: 0, y: 0 }, { x: 1000, y: 0 }], false), { continuous: box(0, 0, 100, 50), repeating: [] }, options).lines.length, 4);
  // bad values, bad paths
  assert.equal(typeof chainSolids(path, sections, { ...options, thickness: 0 }), "string");
  assert.equal(typeof chainSolids(path, sections, { ...options, spacing: 0 }), "string");
  assert.equal(typeof chainSolids(path, { continuous: sections.continuous, repeating: [] }, { ...options, thickness: 0 }), "object");
  assert.equal(typeof chainPath([{ x: 0, y: 0 }], false, false), "string");
  assert.equal(typeof chainPath([{ x: 0, y: 0 }, { x: 0, y: 0 }], false, false), "string");
  assert.equal(typeof chainPath([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 0 }], false, false), "string");
}

console.log("chainExtrudeShapes ok");
