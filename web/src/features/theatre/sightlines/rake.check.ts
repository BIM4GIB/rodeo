// Checks the seating rake under Node. Run from web/:
//   npx tsx src/features/theatre/sightlines/rake.check.ts
// The isoptic step: with C = 90, D = 5000, R = -100 (the eye 100 below the focal point) and T = 900,
// the next eye is (-100 + 90) x 5900 / 5000 = -11.8, and its clearance comes back as 90 exactly.
// The sample rake: the first row 4000 from the focal point, 900 spacing, the seated eye 1120 above its
// floor, the stage 900 above the first row's floor, the focal point at the stage's edge (0 above it), C 90
// and steps of 25. The eye above the focal point starts at 1120 - 900 = 220.
//   row 1 to 2: (220 + 90) x 4900 / 4000 = 379.75; riser 159.75 rounds up to 175; eye 395;
//               clearance over row 1 = 395 x 4000 / 4900 - 220 = 102.449
//   row 2 to 3: (395 + 90) x 5800 / 4900 = 574.08; riser 179.08 rounds up to 200; eye 595;
//               clearance over row 2 = 595 x 4900 / 5800 - 395 = 107.672
// So the risers are 0, 175, 200 (over 190: a stair aisle needs an intermediate tread), rows sit 0, 175,
// 375 above the first row's floor, and their eyes 1120, 1295, 1495.

import assert from "node:assert/strict";
import { clearanceOf, nextEye, rakeSection, RAKE_LIMIT_DEG, RISER_LIMIT_MM, solveRake, type RakeInput } from "./rake.ts";

const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;

assert.ok(near(nextEye(-100, 90, 5000, 900), -11.8, 1e-9), "next eye from -100 is -11.8");
assert.ok(near(clearanceOf(-100, -11.8, 5000, 900), 90, 1e-9), "and the clearance it gives back is 90");
assert.equal(RISER_LIMIT_MM, 190);
assert.equal(RAKE_LIMIT_DEG, 35);

const sample: RakeInput = {
  firstRowMm: 4000,
  spacingMm: 900,
  rows: 3,
  seatedEyeMm: 1120,
  stageHeightMm: 900,
  focalHeightMm: 0,
  clearanceMm: 90,
  stepMm: 25,
};
const rake = solveRake(sample);
const [r1, r2, r3] = rake.rows;
assert.equal(rake.rows.length, 3);
assert.ok(near(r1.riserMm, 0) && near(r1.riseMm, 0) && near(r1.eyeMm, 1120) && near(r1.eyeAboveFocalMm, 220), "row 1 sits on the first floor");
assert.ok(near(r2.riserMm, 175) && near(r2.riseMm, 175) && near(r2.eyeMm, 1295), "row 2: riser 175 (159.75 rounded up), eye 1295");
assert.ok(near(r3.riserMm, 200) && near(r3.riseMm, 375) && near(r3.eyeMm, 1495), "row 3: riser 200 (179.08 rounded up), eye 1495");
assert.ok(near(r1.clearanceMm!, 102.449) && near(r2.clearanceMm!, 107.672), "the clearances the rounded risers give: 102.4 and 107.7");
assert.equal(r3.clearanceMm, null, "the last row has no row behind it to clear");
assert.ok(r1.clearanceMm! >= 90 && r2.clearanceMm! >= 90, "every row clears its C target");
assert.deepEqual([...r1.flags], []);
assert.deepEqual([...r2.flags], []);
assert.equal(r3.flags.length, 1, "a 200 riser is over 190: flagged");
assert.ok(r3.flags[0].startsWith("Riser over 190 mm"));
assert.ok(near(rake.averageRiserMm, 187.5) && near(rake.totalRiseMm, 375) && near(rake.lowestClearanceMm!, 102.449));
assert.ok(rake.steepestDeg < 35, "the steepest floor, atan(200 / 900) = 12.5 degrees, is under the 35 degree rake");

// a rake over 35 degrees: C 600 from row 1 (eye 220) gives (820 x 4900 / 4000) - 220 = 784.5 of riser,
// rounded up to 800; atan(800 / 900) = 41.6 degrees, over 35, and over 190 too
const steep = solveRake({ ...sample, rows: 2, clearanceMm: 600, stepMm: 25 });
assert.ok(near(steep.rows[1].riserMm, 800), "the riser is 800");
assert.ok(steep.rows[1].flags.some((f) => f.startsWith("Rake over 35")), "a 41.6 degree floor is flagged");
assert.ok(steep.rows[1].flags.some((f) => f.startsWith("Riser over 190")), "and so is its 800 riser");
assert.ok(near(steep.steepestDeg, (Math.atan(800 / 900) * 180) / Math.PI, 1e-6));

// a negative eye: first eye -100 above focal (seated 800, stage 900), so the riser is 100 and the eye ends at 0
const below = solveRake({ ...sample, firstRowMm: 5000, seatedEyeMm: 800, rows: 2 });
assert.ok(near(below.rows[0].eyeAboveFocalMm, -100), "the first eye sits below the focal point");
assert.ok(near(below.rows[1].riserMm, 100) && near(below.rows[1].eyeAboveFocalMm, 0), "riser 100 (88.2 rounded up) brings the eye to the focal height");
assert.ok(near(below.rows[0].clearanceMm!, 100), "and the clearance is 100 (0 x 5000 / 5900 + 100)");

// one row: nothing to clear, no riser
const one = solveRake({ ...sample, rows: 1 });
assert.equal(one.rows.length, 1);
assert.equal(one.rows[0].clearanceMm, null);
assert.equal(one.averageRiserMm, 0);
assert.equal(one.lowestClearanceMm, null);

// the section: the front edge at x = 0 with the focal point at the stage height, the rows' sightlines from it
const section = rakeSection(rake, sample);
assert.deepEqual(section.focal, { x: 0, y: 900 });
assert.ok(near(section.eyes[1].at.y, 1295) && near(section.eyes[1].at.x, 4900));
const ray = section.rays[0];
assert.ok(near(ray.to.x, 5800 + 900), "the sightlines run on past the last row");
assert.ok(near(ray.to.y, 900 + ((1120 - 900) * 6700) / 4000), "the first row's sightline climbs from the focal point through its eye");
assert.equal(section.floor[0].x, 0);
assert.equal(section.stage[2].y, 900, "the stage block stands 900 high");

console.log("rake.check.ts: all checks passed");
