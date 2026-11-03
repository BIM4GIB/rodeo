// Checks for beam.ts: the hand-worked cases, and the statics any answer must satisfy.
// Run with: npx tsx src/features/theatre/loads/beam.check.ts

import assert from "node:assert/strict";
import { solveBeam } from "./beam.ts";

const near = (a: number, b: number, what: string, eps = 1e-6): void => {
  assert.ok(Math.abs(a - b) < eps, `${what}: got ${a}, expected ${b}`);
};

// Single span, 6 m on pins at both ends, 100 kg at midspan: each end takes 50, and the moment at midspan is 50 x 3 = 150 kg·m.
{
  const r = solveBeam(6000, [0, 6000], [{ atMm: 3000, kg: 100 }], 0);
  near(r.reactionsKg[0], 50, "point load, left reaction");
  near(r.reactionsKg[1], 50, "point load, right reaction");
  near(r.maxMomentKgM, 150, "point load, moment");
  near(r.maxShearKg, 50, "point load, shear");
  assert.equal(r.unstable, false);
}

// The same span under 20 kg/m: each end takes wL/2 = 60, and the moment wL²/8 = 20 x 36 / 8 = 90 kg·m at midspan.
{
  const r = solveBeam(6000, [0, 6000], [], 20);
  near(r.reactionsKg[0], 60, "udl, left reaction");
  near(r.reactionsKg[1], 60, "udl, right reaction");
  near(r.maxMomentKgM, 90, "udl, moment");
  near(r.maxShearKg, 60, "udl, shear");
}

// Two equal spans of 4 m on pins at 0, 4 and 8 m, 10 kg/m (wL = 40 per span): ends 0.375 x 40 = 15, middle
// 1.25 x 40 = 50; the largest moment is wL²/8 = 20 kg·m, hogging over the middle pin, and the largest shear 25 kg.
{
  const r = solveBeam(8000, [0, 4000, 8000], [], 10);
  near(r.reactionsKg[0], 15, "two spans, end reaction");
  near(r.reactionsKg[1], 50, "two spans, middle reaction");
  near(r.reactionsKg[2], 15, "two spans, far end reaction");
  near(r.maxMomentKgM, 20, "two spans, moment");
  near(r.maxShearKg, 25, "two spans, shear");
}

// A 6 m beam on pins at 0 and 4 m with 60 kg at the tip (6 m): the pin at 0 takes -30 (it pulls down), the pin at
// 4 m takes +90. The moment over the pin at 4 m is 60 x 2 = 120 kg·m, and the largest shear is 60 kg.
{
  const r = solveBeam(6000, [0, 4000], [{ atMm: 6000, kg: 60 }], 0);
  near(r.reactionsKg[0], -30, "overhang, pin at 0");
  near(r.reactionsKg[1], 90, "overhang, pin at 4 m");
  near(r.maxMomentKgM, 120, "overhang, moment");
  near(r.maxShearKg, 60, "overhang, shear");
}

// Reactions follow the supports as given.
{
  const r = solveBeam(6000, [4000, 0], [{ atMm: 6000, kg: 60 }], 0);
  near(r.reactionsKg[0], 90, "reversed order, pin at 4 m");
  near(r.reactionsKg[1], -30, "reversed order, pin at 0");
}

// One hoist holds it: the whole weight (100 + 50 + pipe 3 kg/m x 6 m = 168) on it, nothing bends.
{
  const r = solveBeam(6000, [3000], [{ atMm: 1000, kg: 100 }, { atMm: 5000, kg: 50 }], 3);
  assert.equal(r.unstable, true);
  near(r.reactionsKg[0], 168, "one hoist, reaction");
  near(r.maxMomentKgM, 0, "one hoist, moment");
}

// No hoists: unstable, with nothing to react.
{
  const r = solveBeam(6000, [], [{ atMm: 3000, kg: 10 }], 0);
  assert.equal(r.unstable, true);
  assert.equal(r.reactionsKg.length, 0);
}

// The reactions carry the whole weight: 30 + 45 + 4 kg/m x 7 m = 103 kg, with the load off the middle.
{
  const r = solveBeam(7000, [0, 2500, 7000], [{ atMm: 1000, kg: 30 }, { atMm: 4000, kg: 45 }], 4);
  near(r.reactionsKg.reduce((s, v) => s + v, 0), 103, "statics, total");
}

// Stations: 41 on the even grid of a 6 m span with a node at midspan, which is already on the grid. Moment at
// 1.5 m is 50 x 1.5 = 75 kg·m; just after midspan the shear is 50 - 100 = -50 kg.
{
  const r = solveBeam(6000, [0, 6000], [{ atMm: 3000, kg: 100 }], 0);
  assert.equal(r.stations.length, 41);
  assert.equal(r.stations[0].atMm, 0);
  assert.equal(r.stations.at(-1)?.atMm, 6000);
  const at = (mm: number) => r.stations.find((s) => Math.abs(s.atMm - mm) < 1e-6)!;
  near(at(1500).momentKgM, 75, "station moment at 1.5 m");
  near(at(3000).shearKg, -50, "station shear just after midspan");
}

// The peak can sit between stations. Pins at 0 and 6 m, 100 kg at 1 m, 20 kg/m: the left reaction is 143.33, the
// shear is zero at x = 43.33 / 20 = 2.1667 m (not on a 150 mm station), and the moment there is 146.944 kg·m.
{
  const r = solveBeam(6000, [0, 6000], [{ atMm: 1000, kg: 100 }], 20);
  near(r.reactionsKg[0], 143.3333, "interior peak, left reaction", 1e-3);
  near(r.maxMomentKgM, 146.9444, "interior peak, moment", 1e-3);
}

// Coincident supports count once: two hoists at one point hold it as one (unstable, the total split between them).
{
  const r = solveBeam(6000, [3000, 3000.2], [{ atMm: 1000, kg: 100 }], 0);
  assert.equal(r.unstable, true);
  near(r.reactionsKg.reduce((s, v) => s + v, 0), 100, "coincident supports, total");
}

console.log("beam.check.ts: all checks passed");
