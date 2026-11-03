// Checks the audience's seat positions and eyes under Node. Run from web/:
//   npx tsx src/features/theatre/sightlines/seats.check.ts
// Straight rows: row 1 is 2000 mm into the house, 4 seats 500 mm apart centred on CL, so seat 1 is
// at across -750 and seat 4 at +750; each row 900 mm deeper, its eye 120 mm higher than the one in front.
// Curved rows: the centre is 10000 mm upstage of PL, so row 1's middle (0, -2000) is 12000 mm from it;
// row 2 is 13000 mm away. Seats sit on the arcs 600 mm apart along them.

import assert from "node:assert/strict";
import { blockSeats, isCurved, seatCount, seatsOf } from "./seats.ts";
import type { Audience, SeatBlock } from "../showTypes.ts";

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const straight: SeatBlock = {
  name: "Stalls",
  acrossMm: 0,
  downMm: 2000,
  rows: 3,
  seatsPerRow: 4,
  rowSpacingMm: 900,
  seatWidthMm: 500,
  curveUpMm: 0,
  eyeMm: 1120,
  riseMm: 120,
};
const curved: SeatBlock = {
  name: "Circle",
  acrossMm: 0,
  downMm: 2000,
  rows: 2,
  seatsPerRow: 3,
  rowSpacingMm: 1000,
  seatWidthMm: 600,
  curveUpMm: 10000,
  eyeMm: 1120,
  riseMm: 0,
};

// straight rows
assert.equal(isCurved(straight), false);
const s = blockSeats(straight);
assert.equal(s.length, 12, "3 rows of 4");
const at = (row: number, seat: number) => s.find((x) => x.row === row && x.seat === seat)!;
assert.ok(near(at(1, 1).across, -750) && near(at(1, 1).up, -2000), "row 1 seat 1 at -750 across, 2000 into the house");
assert.ok(near(at(1, 4).across, 750) && near(at(1, 4).up, -2000), "row 1 seat 4 at +750 across");
assert.ok(near(at(3, 1).up, -3800), "row 3 is two spacings (1800) past row 1");
assert.ok(near(at(2, 2).across, -250) && near(at(2, 2).up, -2900), "row 2 seat 2 at -250 across");
assert.ok(near(at(1, 1).eyeMm, 1120) && near(at(2, 2).eyeMm, 1240) && near(at(3, 1).eyeMm, 1360), "eyes rise 120 a row from 1120");

// curved rows
assert.equal(isCurved(curved), true);
const c = blockSeats(curved);
assert.equal(c.length, 6, "2 rows of 3");
const cat = (row: number, seat: number) => c.find((x) => x.row === row && x.seat === seat)!;
assert.ok(near(cat(1, 2).across, 0) && near(cat(1, 2).up, -2000), "row 1 middle seat on CL at 2000 into the house");
// seat 1 is 600 mm along the arc of radius 12000: angle 0.05 rad from straight downstage of the centre
assert.ok(near(cat(1, 1).across, 12000 * Math.sin(-0.05), 1e-6), "row 1 seat 1 across = R sin(-0.05) = -599.75");
assert.ok(near(cat(1, 1).up, 10000 - 12000 * Math.cos(0.05), 1e-6), "row 1 seat 1 up = 10000 - R cos(0.05) = -1985.00");
assert.ok(near(cat(1, 3).across, -cat(1, 1).across, 1e-6), "row 1 seats are symmetrical about CL");
assert.ok(near(cat(2, 2).up, -3000), "row 2 middle is 3000 into the house (radius 13000)");
assert.ok(near(cat(2, 1).across, 13000 * Math.sin(-600 / 13000), 1e-6), "row 2 seats spaced 600 along the 13000 arc");
for (const seat of c) {
  const r = seat.row === 1 ? 12000 : 13000;
  assert.ok(near(Math.hypot(seat.across, seat.up - 10000), r, 1e-6), `seat ${seat.row}.${seat.seat} lies on its arc`);
}
const chord = Math.hypot(cat(1, 1).across - cat(1, 2).across, cat(1, 1).up - cat(1, 2).up);
assert.ok(Math.abs(chord - 600) < 0.1, "neighbouring seats are 600 mm along the arc (599.9 across the chord)");

// the audience as a whole
const audience: Audience = { blocks: [straight, curved] };
assert.equal(seatCount(audience), 18);
assert.equal(seatsOf(audience).length, 18);
assert.equal(seatsOf(audience)[12].block, "Circle", "blocks list in their order");

// a block with no rows or no seats has none
assert.equal(blockSeats({ ...straight, rows: 0 }).length, 0);

console.log("seats.check.ts: all checks passed");
