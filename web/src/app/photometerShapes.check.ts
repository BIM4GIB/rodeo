// Node check of the Photometer's sums. Run from web/: npx tsx src/app/photometerShapes.check.ts

import assert from "node:assert/strict";
import { illuminance, luxOn, peakCandela, type Photometric } from "../features/theatre/beam/photometry.ts";
import { DEFAULT_THRESHOLDS, gridFromClicks, gridNormal, gridPoints, gridProblem, illumText, illumUnit, inDrawing, offsetOfTilt, readingParts, thresholdColour, tiltOfOffset, MAX_READINGS } from "./photometerShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// footcandles in imperial drawings, lux in metric
assert.equal(illumUnit("Feet and Inches"), "fc");
assert.equal(illumUnit("Inches"), "fc");
assert.equal(illumUnit("Millimeters"), "lx");
assert.equal(illumUnit("Meters"), "lx");
assert.equal(illumUnit(undefined), "lx");
assert.equal(illumText(107.64, "fc"), "10.00 FC");
assert.equal(illumText(437.244, "lx"), "437.24 lx");

// threshold colours
const t = DEFAULT_THRESHOLDS;
assert.equal(thresholdColour(0, "lx", t), t.zero);
assert.equal(thresholdColour(100, "lx", t), t.below);
assert.equal(thresholdColour(150, "lx", t), t.between);
assert.equal(thresholdColour(350, "lx", t), t.between);
assert.equal(thresholdColour(351, "lx", t), t.above);
// in footcandles: 200 fc is 2152.8 lux, between
assert.equal(thresholdColour(2152.8, "fc", t), t.between);

// a grid: 6 m by 4 m at 1 m is 7 by 5, centred, the corner at the elevation
const spec = { widthX: 6000, widthY: 4000, spacingX: 1000, spacingY: 1000, elevation: 500, tiltX: 0, tiltY: 0 };
assert.equal(gridProblem(spec), null);
const flat = gridPoints(spec);
assert.equal(flat.length, 35);
near(Math.min(...flat.map((p) => p.x)), -3000);
near(Math.max(...flat.map((p) => p.y)), 2000);
for (const p of flat) near(p.z, 500);
// spacing that doesn't divide the width stays centred
const part = gridPoints({ ...spec, spacingX: 2500, spacingY: 3000 });
assert.equal(part.length, 3 * 2);
near(Math.max(...part.map((p) => p.x)), 2500);
near(Math.max(...part.map((p) => p.y)), 1500);
// refusals
assert.ok(gridProblem({ ...spec, spacingX: 0 }));
assert.ok(gridProblem({ ...spec, widthY: 0 }));
assert.ok(gridProblem({ ...spec, tiltX: 89 }));
assert.ok(gridProblem({ ...spec, spacingX: 1, spacingY: 1 })?.includes(MAX_READINGS.toLocaleString()));

// tilted 45° in X: the far side is a whole width higher, the low corner stays
const tilted = gridPoints({ ...spec, tiltX: 45 });
near(Math.min(...tilted.map((p) => p.z)), 500);
near(Math.max(...tilted.map((p) => p.z)), 6500);
near(offsetOfTilt(45, 6000), 6000);
near(tiltOfOffset(6000, 6000), 45);
near(tiltOfOffset(offsetOfTilt(12.5, 4000), 4000), 12.5);
// its normal leans back toward -X, and turning the grid turns it
const n = gridNormal(45, 0, 0);
near(n.x, -Math.SQRT1_2);
near(n.y, 0);
near(n.z, Math.SQRT1_2);
const turned = gridNormal(45, 0, 90);
near(turned.x, 0);
near(turned.y, -Math.SQRT1_2);
near(Math.hypot(gridNormal(20, -30, 40).x, gridNormal(20, -30, 40).y, gridNormal(20, -30, 40).z), 1);

// an object's frame in the drawing
const q = inDrawing({ x: 100, y: 200 }, 90, { x: 10, y: 0 });
near(q.x, 100);
near(q.y, 210);

// clicks: through the centre or along the edge
{
  const a = { x: 0, y: 0 };
  const b = { x: 6000, y: 0 };
  const c = { x: 3000, y: 2000 };
  const mid = gridFromClicks(a, b, c, false)!;
  near(mid.center.x, 3000);
  near(mid.center.y, 0);
  near(mid.widthX, 6000);
  near(mid.widthY, 4000);
  near(mid.angle, 0);
  const edge = gridFromClicks(a, b, c, true)!;
  near(edge.center.y, 1000);
  near(edge.widthY, 2000);
  // the other side of the line
  near(gridFromClicks(a, b, { x: 0, y: -2000 }, true)!.center.y, -1000);
  // a line straight up
  const up = gridFromClicks(a, { x: 0, y: 5000 }, { x: -1000, y: 0 }, true)!;
  near(up.angle, 90);
  near(up.center.x, -500);
  near(up.center.y, 2500);
  assert.equal(gridFromClicks(a, a, c, false), null);
  assert.equal(gridFromClicks(a, b, { x: 100, y: 0 }, true), null);
}

// a reading: a dot and its lines under it
const parts = readingParts(0, 0, 100, ["40.62 FC", "3'"]);
assert.equal(parts.length, 3);
assert.equal(parts[0].kind, "polygon");
assert.equal(parts[1].kind, "text");

// the light: straight down onto a level surface it's the inverse square law, the same as coverage's
const light: Photometric = { at: { x: 0, y: 0 }, heightMm: 5000, focus: { x: 0, y: 0, z: 0 }, beamDeg: 20, fieldDeg: 30, lumens: 20000, channel: "1", color: "" };
const up = { x: 0, y: 0, z: 1 };
near(luxOn([light], () => 1, { x: 0, y: 0, z: 0 }, up), peakCandela(20000, 20, 30) / 25, 1e-6);
// off the axis, level: the same as illuminance()
near(luxOn([light], () => 1, { x: 700, y: 300, z: 0 }, up), illuminance(light, { x: 700, y: 300, z: 0 }), 1e-6);
// two lights add; a channel at half gives half; a channel off nothing
near(luxOn([light, light], () => 1, { x: 0, y: 0, z: 0 }, up), (2 * peakCandela(20000, 20, 30)) / 25, 1e-6);
near(luxOn([light], () => 0.5, { x: 0, y: 0, z: 0 }, up), (0.5 * peakCandela(20000, 20, 30)) / 25, 1e-6);
assert.equal(luxOn([light], () => 0, { x: 0, y: 0, z: 0 }, up), 0);
// a surface tilted 60° from the light gets the cosine; one facing away gets none
const tilt60 = { x: Math.sin(Math.PI / 3), y: 0, z: Math.cos(Math.PI / 3) };
near(luxOn([light], () => 1, { x: 0, y: 0, z: 0 }, tilt60), (0.5 * peakCandela(20000, 20, 30)) / 25, 1e-6);
assert.equal(luxOn([light], () => 1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }), 0);
// above the lens nothing falls on a level surface
assert.equal(luxOn([light], () => 1, { x: 0, y: 0, z: 6000 }, up), 0);

console.log("all checks passed");
