// Checks the masking solver under Node. Run from web/:
//   npx tsx src/features/theatre/sightlines/masking.check.ts
// The case: a proscenium 10000 wide and 6000 high, a stage 10000 deep, 2 leg pairs, the first 2000 up,
// a performing width of 8000, the critical seat 6000 off CL and 4000 into the house, its front eye at 1100.
// The sightline past the stage-left pros edge (5000, 0) from the seat (-6000, -4000) reaches across
// -6000 + 11000 x 6000 / 4000 = 10500 at depth 2000. Leg 1's onstage edge is the performing edge, 4000 (the
// sightline is further out), so its outer edge goes out to 10500: 6500 wide. Leg 2 (depth 9000) sits past
// the sightline through leg 1's onstage edge (4000, 2000): -6000 + 10000 x 13000 / 6000 = 15666.7.

import assert from "node:assert/strict";
import { acrossAt, heightAt, legDepths, pleatedLine, solveMasking, type MaskingInput } from "./masking.ts";

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const base: MaskingInput = {
  prosWidthMm: 10000,
  prosHeightMm: 6000,
  stageDepthMm: 10000,
  legs: 2,
  firstLegUpMm: 2000,
  performingWidthMm: 8000,
  performingHeightMm: 5400,
  wingWidthMm: 12000,
  minLegWidthMm: 1000,
  wantedTrimMm: 6000,
  gridHeightMm: 12000,
  seatAcrossMm: 6000,
  seatDownMm: 4000,
  frontEyeMm: 1100,
};

// the sightlines
assert.ok(near(acrossAt(6000, 4000, { across: 5000, up: 0 }, 2000), 10500), "the pros edge's sightline at depth 2000 is 10500");
assert.ok(near(acrossAt(6000, 4000, { across: 4000, up: 2000 }, 9000), 15666.6667, 1e-3), "past leg 1's onstage edge, at depth 9000, 15666.7");
assert.ok(near(heightAt(4000, 1100, { up: 0, height: 6000 }, 2000), 8450), "the eye's sightline over the pros top at depth 2000 is 8450");
assert.ok(near(heightAt(4000, 1100, { up: 2000, height: 6000 }, 9000), 11716.6667, 1e-3), "past border 1's bottom, at depth 9000, 11716.7");

// depths: evenly from the first to 1000 short of the back wall
assert.deepEqual(legDepths(2, 2000, 10000), [2000, 9000]);
assert.deepEqual(legDepths(3, 2000, 10000), [2000, 5500, 9000]);
assert.deepEqual(legDepths(1, 2000, 10000), [2000]);

// the solution for the base case
const s = solveMasking(base);
const [l1, l2] = s.legs;
assert.ok(near(l1.onstageMm, 4000) && near(l1.offstageMm, 10500) && near(l1.widthMm, 6500), "leg 1: onstage 4000, outer 10500, 6500 wide");
assert.ok(near(l2.onstageMm, 4000) && near(l2.offstageMm, 15666.6667, 1e-3), "leg 2: outer edge on the sightline past leg 1, 15666.7");
assert.deepEqual([...l1.flags], [], "leg 1 (6500 wide) fits the 12000 wing plus 300 overlap");
assert.deepEqual([...l2.flags], [], "leg 2 (11666.7 wide) fits the 12000 wing plus 300 overlap");
assert.ok(near(s.plan.rays[0].to.across, acrossAt(6000, 4000, { across: 4000, up: 2000 }, 10000)), "leg 1's sight ray runs on to the back wall");
assert.ok(near(s.plan.seat.across, -6000) && near(s.plan.seat.up, -4000), "the seat is on stage right, 4000 into the house");

// the borders: the eye at height 1100, depth 4000 into the house
const [b1, b2] = s.borders;
assert.ok(near(b1.trimMm, 6000) && near(b1.topMm, 8450) && near(b1.clothMm, 2450), "border 1: trim 6000, reaches the sightline at 8450, cloth 2450");
assert.ok(near(b2.trimMm, 6000) && near(b2.topMm, 11716.6667, 1e-3) && near(b2.clothMm, 5716.6667, 1e-3), "border 2: trim 6000, cloth to 11716.7");
assert.deepEqual([...b1.flags, ...b2.flags], [], "nothing flagged in the base case");
assert.ok(near(s.section.rays[1].to.height, 6376.9231, 1e-3), "border 2's sightline reaches 6376.9 at the back wall");

// the flags
const tall = solveMasking({ ...base, gridHeightMm: 11000, wingWidthMm: 6000 });
assert.ok(tall.borders[1].flags.length === 1 && near(tall.borders[1].topMm, 11000), "a sightline above the grid is flagged; the cloth stops at the grid");
assert.ok(near(tall.borders[1].clothMm, 5000), "cloth of 5000 from trim 6000 to the grid 11000");
assert.ok(tall.legs[0].flags.length === 1 && tall.legs[1].flags.length === 1, "legs wider than the 6000 wing are flagged");
const low = solveMasking({ ...base, wantedTrimMm: 5000 });
assert.ok(near(low.borders[0].trimMm, 5000) && low.borders[0].flags.length === 1, "a trim under the performing height is flagged");

// the pleated leg: 6500 wide gives 11 pleats (22 steps), its ends on the line and the rest either side of it
const p = pleatedLine(4000, 10500, 2000);
assert.equal(p.length, 23);
assert.ok(near(p[0].across, 4000) && near(p[0].up, 2000) && near(p[22].across, 10500) && near(p[22].up, 2000));
assert.ok(near(p[1].up, 2150) && near(p[2].up, 1850), "pleats go 150 either side of the line in turn");
assert.ok(near(s.plan.legs[0].right[0].across, -4000), "the stage right leg mirrors the stage left one");

console.log("masking.check.ts: all checks passed");
