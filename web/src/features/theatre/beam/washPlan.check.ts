// Checks washPlan.ts against numbers worked out by hand. Run with:
//   npx tsx src/features/theatre/beam/washPlan.check.ts

import assert from "node:assert/strict";
import { columnsFor, planWash, type WashSpec } from "./washPlan.ts";

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} (tolerance ${tol})`);

const base: WashSpec = {
  typeKey: "profile26",
  width: 12000,
  depth: 2000,
  upFront: 4000,
  hangUp: 0,
  heightMm: 6000,
  planeMm: 1700,
  overlap: 0.35,
  color: "",
  color2: "",
  position: "1st Electric",
  purpose: "Wash",
  startUnit: 1,
  startChannel: 1,
  oneChannelPerCell: true,
  mccandless: false,
};

// 1. Columns: 12000 with focus points at most 2500 apart needs ceil(12000 / 2500) = ceil(4.8) = 5, spaced 12000 / 5 = 2400.
assert.deepEqual(columnsFor(12000, 2500), { n: 5, spacing: 2400 });
// Exactly 2400 apart still takes 5 columns, not 6.
assert.deepEqual(columnsFor(12000, 2400), { n: 5, spacing: 2400 });
assert.deepEqual(columnsFor(12000, 12000), { n: 1, spacing: 12000 });

// 2. Profile 26 (field 26°, so tan13° = 0.23086) on a pipe at PL, lens 6 m and focus plane 1.7 m: lift 4300 mm.
//    One row at up 5000 mm (the middle of 4 m to 6 m). Throw T = hypot(4300, 5000) = 6595.5 mm.
//    Half the pool across: b = T · tan13° = 1522.5 mm, a diameter of 3045 mm; spacing 0.65 × 3045 = 1979.3 mm.
//    Columns: ceil(12000 / 1979.3) = ceil(6.06) = 7, spaced 12000 / 7 = 1714.3 mm.
//    Depth: the pool stretches to a = b · T / lift = 2335 mm (diameter 4670); 0.65 × 4670 = 3035 mm ≥ 2000 mm, so one row.
const p = planWash(base);
assert.equal(p.rows, 1);
assert.equal(p.cols, 7);
assert.equal(p.count, 7);
near(p.spacing.across, 12000 / 7, 1e-9, "spacing across");
near(p.spacing.up, 2000, 1e-9, "spacing up");
// The outermost focus points sit 6000 − 857.1 = 5142.9 mm either side of CL, all at up 5000.
near(p.cells[0].across, -5142.857, 0.01, "outer focus, stage right");
near(p.cells[6].across, 5142.857, 0.01, "outer focus, stage left");
assert.ok(p.cells.every((c) => c.up === 5000), "one row, at up 5000");
// Straight on: each unit hangs over its focus on the pipe at PL.
assert.ok(p.fixtures.every((f) => f.side === "front" && f.across === p.cells[f.cell].across && f.hangUp === 0));
// 7 units of 750 W and 7.7 kg.
assert.equal(p.watts, 5250);
near(p.weightKg, 53.9, 1e-9, "weight");
// The beams come down at atan(4300 / 5000) = 40.7° from the floor: no warnings.
assert.deepEqual(p.warnings, []);
// The predicted light is lit everywhere in the area, and its uniformity is between 0 and 1.
assert.ok(p.predicted && p.predicted.min > 0 && p.predicted.uniformity > 0 && p.predicted.uniformity <= 1);

// 3. McCandless: each unit from one side, its hang 4300 mm across from its focus so its beam comes in at 45°.
//    Across the pool stretches to 1 / cos45° = 1.414 × the field (2570 mm half width, diameter 5140), so spacing
//    0.65 × 5140 = 3341 and columns ceil(12000 / 3341) = 4, spaced 3000. Foci at −4500, −1500, 1500, 4500.
//    Left units hang at focus + 4300, right units at focus − 4300; two units per cell, so count 8.
const mcc = planWash({ ...base, mccandless: true, color: "L201", color2: "L204" });
assert.equal(mcc.cols, 4);
assert.equal(mcc.rows, 1);
assert.equal(mcc.count, 8);
assert.equal(mcc.fixtures[0].side, "left");
near(mcc.fixtures[0].across, -4500 + 4300, 1e-9, "left unit hangs across from its focus");
assert.equal(mcc.fixtures[0].color, "L201");
assert.equal(mcc.fixtures[1].side, "right");
near(mcc.fixtures[1].across, -4500 - 4300, 1e-9, "right unit hangs across from its focus");
assert.equal(mcc.fixtures[1].color, "L204");
assert.deepEqual(mcc.fixtures.map((f) => f.cell), [0, 0, 1, 1, 2, 2, 3, 3]);

// 4. Warnings. A pipe straight above the row gives beams at 90°, steeper than 60°.
assert.ok(planWash({ ...base, hangUp: 5000 }).warnings.some((w) => /steeper than 60/.test(w)));
// A pipe 20 m upstage gives beams at atan(4300 / 25000) = 9.8°, under 30°.
assert.ok(planWash({ ...base, hangUp: -20000 }).warnings.some((w) => /under 30/.test(w)));
// An 8 m deep area takes several rows, which hang at the same spots on the pipe: the planner says so.
const deep = planWash({ ...base, depth: 8000, upFront: 0 });
assert.ok(deep.rows > 1, "deep area takes rows");
assert.equal(deep.count, deep.rows * deep.cols);
assert.ok(deep.warnings.some((w) => /rows of focus points/.test(w)));

// 5. A lens no higher than the focus plane plans nothing and says why.
const low = planWash({ ...base, heightMm: 1000 });
assert.equal(low.count, 0);
assert.match(low.warnings[0], /higher than the focus height/);

console.log("washPlan.check.ts: all checks pass");
