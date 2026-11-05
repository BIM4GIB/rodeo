// Checks the turning picture's camera maths in node: a quarter turn lands where it should, a full
// turn keeps the target, the lens and the eye's distance and height, and the spin directions start
// with the first one. Run from web/:
//
//   npx tsx src/features/embed/turntable.check.ts
//
// Prints each failure and exits non-zero, or prints how many checks passed.

import assert from "node:assert/strict";
import type { CameraState } from "../../app/view3d.ts";
import type { Vec3 } from "../../core/index.ts";
import { spinDirections, towardOf, turnAboutZ, turntableStates } from "./turntable.ts";

type Check = () => void;
const checks: [string, Check][] = [];

/** Registers a named check; the checks run in the order they are registered. */
function check(name: string, fn: Check): void {
  checks.push([name, fn]);
}

/** Asserts that two vectors agree to within a billionth. */
function near(actual: readonly number[], expected: readonly number[]): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${v} is not ${expected[i]} (at ${i})`));
}

/** The length of a vector. */
function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

const START: CameraState = { position: [10, 0, 5], target: [0, 0, 0], zoom: 1, half: 3, fov: 40 };

check("quarter turns land on the four sides", () => {
  const states = turntableStates(START, 4);
  assert.equal(states.length, 4);
  near(states[0].position, [10, 0, 5]);
  near(states[1].position, [0, 10, 5]);
  near(states[2].position, [-10, 0, 5]);
  near(states[3].position, [0, -10, 5]);
});

check("a turn keeps the target, zoom, half and fov", () => {
  for (const s of turntableStates(START, 4)) {
    near(s.target, [0, 0, 0]);
    assert.equal(s.zoom, 1);
    assert.equal(s.half, 3);
    assert.equal(s.fov, 40);
  }
});

check("a full turn about an off-centre target keeps the distance and height", () => {
  const off: CameraState = { ...START, position: [12, -3, 7], target: [1, 2, 0] };
  const first = towardOf(off.position, off.target);
  for (const s of turntableStates(off, 40)) {
    const toward = towardOf(s.position, s.target);
    assert.ok(Math.abs(length(toward) - length(first)) < 1e-9, "the eye's distance from the target changed");
    assert.ok(Math.abs(toward[2] - first[2]) < 1e-9, "the eye's height changed");
    near(s.target, [1, 2, 0]);
  }
});

check("the frames step evenly, starting at the start view", () => {
  // eight frames step 45 degrees: the fifth is half a turn round, on the far side
  near(turntableStates(START, 8)[4].position, [-10, 0, 5]);
  // forty frames step 9 degrees, so a loop of them closes on the start without a repeated frame
  near(turntableStates(START, 40)[0].position, START.position);
});

check("turnAboutZ turns a quarter counter-clockwise seen from above", () => {
  near(turnAboutZ([1, 0, 0], 90), [0, 1, 0]);
  near(turnAboutZ([0, 1, 0], 90), [-1, 0, 0]);
  near(turnAboutZ([1, 2, 3], 0), [1, 2, 3]);
});

check("towardOf points from the target to the eye", () => {
  near(towardOf([3, 4, 5], [1, 1, 1]), [2, 3, 4]);
});

check("spinDirections gives count directions starting with the first", () => {
  const dirs = spinDirections([1, 0, 0], 8);
  assert.equal(dirs.length, 8);
  near(dirs[0], [1, 0, 0]);
  near(dirs[2], [0, 1, 0]);
  near(dirs[4], [-1, 0, 0]);
});

/** Runs every check, prints the failures, and exits non-zero when there are any. */
function main(): void {
  const failures: string[] = [];
  let passed = 0;
  for (const [name, fn] of checks) {
    try {
      fn();
      passed++;
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length) {
    for (const f of failures) console.log(`FAIL ${f}`);
    console.log(`turntable check: ${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`turntable check: ${passed} passed`);
}

main();
