// Node check of Focus Lighting Devices Along Path. Run from web/: npx tsx src/app/focusPathShapes.check.ts

import assert from "node:assert/strict";
import { closestOnPath, focusTargets, pathLength, pointAlong } from "./focusPathShapes.ts";

const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const line = [{ x: 0, y: 0 }, { x: 900, y: 0 }];
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

near(pathLength(line, false), 900);
near(pathLength(square, true), 400);
near(pathLength(square, false), 300);
assert.deepEqual(pointAlong(square, true, 350), { x: 0, y: 50 });
assert.deepEqual(pointAlong(square, false, 1000), { x: 0, y: 100 });
assert.deepEqual(closestOnPath({ x: 300, y: 50 }, line, false), { at: { x: 300, y: 0 }, along: 300 });

// closest point: straight down, and off the end stops at the end
const devices = [{ x: 100, y: 500 }, { x: 400, y: 500 }, { x: 1200, y: 500 }];
assert.deepEqual(focusTargets(devices, line, false, "closest"), [{ x: 100, y: 0 }, { x: 400, y: 0 }, { x: 900, y: 0 }]);

// evenly between: a beam at each end
assert.deepEqual(focusTargets(devices, line, false, "between"), [{ x: 0, y: 0 }, { x: 450, y: 0 }, { x: 900, y: 0 }]);
// evenly inside: half a space in
assert.deepEqual(focusTargets(devices, line, false, "inside"), [{ x: 150, y: 0 }, { x: 450, y: 0 }, { x: 750, y: 0 }]);
// one device goes to the middle
assert.deepEqual(focusTargets([{ x: 0, y: 500 }], line, false, "between"), [{ x: 450, y: 0 }]);
// the order the devices come in doesn't cross the beams
assert.deepEqual(focusTargets([devices[2], devices[0], devices[1]], line, false, "between"), [{ x: 900, y: 0 }, { x: 0, y: 0 }, { x: 450, y: 0 }]);

// closed: on the first vertex, or either side of it, at the same spacing
const four = [{ x: 0, y: -50 }, { x: 50, y: 50 }, { x: 150, y: 150 }, { x: -50, y: 50 }];
const between = focusTargets(four, square, true, "between");
assert.ok(between.some((p) => p.x === 0 && p.y === 0));
assert.equal(new Set(between.map((p) => `${p.x},${p.y}`)).size, 4);
const inside = focusTargets(four, square, true, "inside");
assert.ok(inside.some((p) => p.x === 50 && p.y === 0));
assert.ok(inside.some((p) => p.x === 0 && p.y === 50));

// nothing to go on
assert.deepEqual(focusTargets(devices, [], false, "between"), []);
assert.deepEqual(focusTargets([devices[0]], [{ x: 5, y: 5 }], false, "between"), [{ x: 5, y: 5 }]);

console.log("all checks passed");
