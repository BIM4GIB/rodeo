// Checks the beam geometry against hand-worked numbers. Run from web/:
//   npx tsx src/features/theatre/docs/beam.check.ts
// Lens 6000 mm, focus 1700 mm high at a plan distance of 4300 mm: the throw is 4300·√2 = 6081 mm at
// 45°, and a 26° field pool is 2 × 6081 × tan 13° = 2808 mm across.

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { beamOf, poolMm } from "./beam.ts";

/** an instrument with only the fields beamOf reads */
function optics(over: Partial<Pick<Fixture, "at" | "heightMm" | "focus" | "beamDeg" | "fieldDeg">>) {
  return { at: { x: 0, y: 7300 }, heightMm: 6000, focus: { x: 0, y: 3000, z: 1700 }, beamDeg: 18, fieldDeg: 26, ...over };
}

const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// 45°, throw 6081 mm, field pool 2808 mm
const b = beamOf(optics({}));
assert.ok(b);
near(b.planMm, 4300, 1e-6);
near(b.throwMm, 6081.1, 0.1);
near(b.elevationDeg, 45, 1e-9);
near(b.fieldMm, 2808, 0.5);
// beam 18°: 2 × 6081.1 × tan 9° = 1926 mm
near(b.beamMm, 1926, 0.5);

// the hand check's pool, straight from the formula
near(poolMm(6081.13, 26), 2808, 0.5);

// a focus above the lens points the beam up: negative elevation (6000 to 7000 is 1000 up, 4300 across)
const up = beamOf(optics({ focus: { x: 0, y: 3000, z: 7000 } }));
assert.ok(up);
near(up.elevationDeg, (Math.atan2(-1000, 4300) * 180) / Math.PI, 1e-9);
assert.ok(up.elevationDeg < 0);

// a flat throw: 9000 across at a 4300 drop is 25.5°
const flat = beamOf(optics({ at: { x: 0, y: 12000 }, focus: { x: 0, y: 3000, z: 1700 } }));
assert.ok(flat);
near(flat.elevationDeg, (Math.atan2(4300, 9000) * 180) / Math.PI, 1e-9);
assert.ok(flat.elevationDeg < 30);

// the focus straight below the lens: 90°, throw equal to the drop
const below = beamOf(optics({ at: { x: 0, y: 3000 } }));
assert.ok(below);
near(below.planMm, 0, 1e-9);
near(below.elevationDeg, 90, 1e-9);
near(below.throwMm, 4300, 1e-9);

// no focus, no beam
assert.equal(beamOf(optics({ focus: null })), null);

console.log("beam.check: all checks pass");
