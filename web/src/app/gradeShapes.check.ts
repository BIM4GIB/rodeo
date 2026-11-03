// Node check for the Grade tool's sums: `npx tsx src/app/gradeShapes.check.ts`.

import assert from "node:assert/strict";
import { closestOn, criticalGrades, endsAt, gradeFigures, linesCross, networkOf, secondParameters, slopeLabel, solveGrade, type GradeLine } from "./gradeShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// any two figures, as long as one is an elevation
assert.deepEqual(solveGrade("Elevation 1", 100, "Elevation 2", 80, 1000), { e1: 100, e2: 80 });
assert.deepEqual(solveGrade("Elevation 2", 80, "Elevation 1", 100, 1000), { e1: 100, e2: 80 });
assert.deepEqual(solveGrade("Elevation 1", 100, "Downward Grade in %", 2, 1000), { e1: 100, e2: 80 });
assert.deepEqual(solveGrade("Elevation 1", 100, "Upward Grade in %", 2, 1000), { e1: 100, e2: 120 });
assert.deepEqual(solveGrade("Elevation 2", 100, "Downward Grade in %", 2, 1000), { e1: 120, e2: 100 });
assert.deepEqual(solveGrade("Upward Ratio (rise/run)", 0.5, "Elevation 1", 10, 100), { e1: 10, e2: 60 });
assert.deepEqual(solveGrade("Downward Ratio (rise/run)", 0.5, "Elevation 2", 10, 100), { e1: 60, e2: 10 });
assert.deepEqual(solveGrade("Elevation 1", 5, "Elevation Change", -3, 100), { e1: 5, e2: 2 });
assert.equal(solveGrade("Downward Grade in %", 2, "Upward Grade in %", 2, 100), null);
assert.equal(solveGrade("Elevation 1", 2, "Elevation 1", 2, 100), null);
assert.ok(!secondParameters("Downward Grade in %").includes("Upward Grade in %"));
assert.ok(secondParameters("Downward Grade in %").includes("Elevation 1"));
assert.ok(secondParameters("Elevation 1").includes("Elevation Change"));
assert.ok(!secondParameters("Elevation 1").includes("Elevation 1"));

// the figures
const f = gradeFigures(100, 70, 40);
near(f.change, -30);
near(f.slope, 0.75);
near(f.surface, 50);
near(gradeFigures(5, 5, 0).slope, 0);

// how a slope reads
assert.equal(slopeLabel(0.05, "Percent", 2), "5.00%");
assert.equal(slopeLabel(0.05, "Permille", 1), "50.0‰");
assert.equal(slopeLabel(1, "Angle", 0), "45°");
assert.equal(slopeLabel(0.5, "Run/Rise Ratio", 1), "2.0:1");
assert.equal(slopeLabel(0.5, "Rise/Run Ratio", 1), "1:2.0");
assert.equal(slopeLabel(0, "Rise/Run Ratio", 1), "Level");

// a point on a line
const c = closestOn({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 });
near(c.t, 0.5);
near(c.off, 3);
near(closestOn({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).t, 0);

// crossing, but not at the ends
assert.ok(linesCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }));
assert.ok(!linesCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }));
assert.ok(!linesCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }));

const line = (id: string, ax: number, ay: number, bx: number, by: number, e1 = 0, e2 = 0, detached = false): GradeLine => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, e1, e2, detached });

// the analysis
const lines = [line("flat", 0, 0, 100, 0, 5, 5), line("steep", 0, 50, 100, 50, 0, 50), line("cross", 50, -10, 50, 10, 1, 1)];
assert.deepEqual([...criticalGrades(lines, { slope: { min: 0, max: 10 }, elevation: null, intersections: false })], ["steep"]);
assert.deepEqual([...criticalGrades(lines, { slope: { min: 1, max: 100 }, elevation: null, intersections: false })].sort(), ["cross", "flat"]);
assert.deepEqual([...criticalGrades(lines, { slope: null, elevation: { min: 0, max: 10 }, intersections: false })], ["steep"]);
assert.deepEqual([...criticalGrades(lines, { slope: null, elevation: null, intersections: true })].sort(), ["cross", "flat"]);
assert.equal(criticalGrades(lines, { slope: null, elevation: null, intersections: false }).size, 0);

// networks, by ends in the same place
const net = [line("a", 0, 0, 10, 0), line("b", 10, 0, 10, 10), line("c", 10.5, 10, 20, 10), line("d", 30, 30, 40, 40), line("e", 20, 10, 20, 20, 0, 0, true)];
assert.deepEqual(networkOf(net, "a").map((g) => g.id).sort(), ["a", "b", "c"]);
assert.deepEqual(networkOf(net, "d").map((g) => g.id), ["d"]);
assert.deepEqual(networkOf(net, "e").map((g) => g.id), ["e"]);
assert.deepEqual(endsAt(net, { x: 10, y: 0 }, "a"), [{ id: "b", end: 1 }]);
assert.deepEqual(endsAt(net, { x: 20, y: 10 }, "x"), [{ id: "c", end: 2 }]);

console.log("gradeShapes ok");
