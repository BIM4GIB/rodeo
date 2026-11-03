// Checks for linesets.ts: run with `npx tsx src/features/theatre/venue/linesets.check.ts`.
// Hand figures (mm, kg): five linesets from 500 spaced 200 are at 500, 700, 900, 1100 and 1300. A lineset with
// 400 kg of its own and a 450 kg capacity, with seven 7.7 kg instruments on it, carries 400 + 53.9 = 453.9 kg:
// overweight; with six it carries 446.2 kg: fine. Two linesets 150 mm apart are not "closer than 150 mm"; 149 is.

import assert from "node:assert/strict";
import type { Lineset, VenueInfo } from "../showTypes.ts";
import type { Fixture } from "../fixture.ts";
import { CLEARANCE, kindOf, linesetProblems, newLinesets } from "./linesets.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const fixture = (position: string, weightKg: number): Fixture => ({ position, weightKg }) as unknown as Fixture;
const line = (over: Partial<Lineset> & { name: string; upMm: number }): Lineset => ({
  id: over.name,
  battenMm: 12000,
  capacityKg: 0,
  inTrimMm: 6000,
  outTrimMm: 13000,
  kind: "electric",
  hung: "",
  weightKg: 0,
  clothMm: 0,
  ...over,
});
const venue: VenueInfo = {
  kind: "proscenium",
  prosWidthMm: 10000,
  prosHeightMm: 6000,
  stageDepthMm: 10000,
  stageWidthMm: 14000,
  apronMm: 1500,
  gridHeightMm: 16000,
  ironUpMm: 300,
  doorWidthMm: 2400,
  doorHeightMm: 2400,
};
const flagsOf = (ls: Lineset[], fx: Fixture[] = [], v: VenueInfo | null = null) => linesetProblems(ls, fx, v);

// new linesets: 500, 700, 900, 1100, 1300, named 1 to 5, each with its own id
const made = newLinesets(5, 500, 200, 12000, 500);
assert.deepEqual(made.map((l) => l.upMm), [500, 700, 900, 1100, 1300]);
assert.deepEqual(made.map((l) => l.name), ["1", "2", "3", "4", "5"]);
assert.equal(new Set(made.map((l) => l.id)).size, 5);
assert.equal(newLinesets(0, 0, 0, 0, 0).length, 0);

// the load: 400 own + 7 x 7.7 = 453.9 kg against 450 kg: overweight; with 6 it is 446.2 kg: not
const heavy = line({ name: "3", upMm: 900, capacityKg: 450, weightKg: 400 });
const seven = [...Array.from({ length: 7 }, () => fixture("3", 7.7)), fixture("4", 7.7)];
const over = flagsOf([heavy], seven)[0];
assert.equal(over.instruments, 7, "only the fixtures whose position is the name count");
near(over.instrumentKg, 53.9, 1e-6);
near(over.usedKg, 453.9, 1e-6);
assert.equal(over.overweight, true);
assert.ok(over.flags.includes("Overweight: 453.9 kg on 450 kg"), over.flags.join(" | "));
const six = flagsOf([heavy], Array.from({ length: 6 }, () => fixture("3", 7.7)))[0];
near(six.usedKg, 446.2, 1e-6);
assert.equal(six.overweight, false);
assert.equal(flagsOf([line({ name: "9", upMm: 0, weightKg: 9999 })])[0].overweight, false, "no capacity set is no limit");

// closeness: 150 mm is not closer than 150; 149 is
const apart = flagsOf([line({ id: "a", name: "A", upMm: 500 }), line({ id: "b", name: "B", upMm: 650 })]);
assert.equal(apart[0].flags.length, 0);
const close = flagsOf([line({ id: "a", name: "A", upMm: 500 }), line({ id: "b", name: "B", upMm: 649 })]);
assert.ok(close[0].flags.includes("Within 150 mm of B"));
assert.equal(CLEARANCE.closeMm, 150);

// heat: an electric within 300 mm of a drop, not at 300
const drop = line({ id: "d", name: "D", upMm: 1250, kind: "drop", clothMm: 1000 });
const hot = flagsOf([line({ id: "e", name: "E", upMm: 1000 }), drop])[0];
assert.ok(hot.flags.includes("Within 300 mm of drop D"));
assert.equal(flagsOf([line({ id: "e", name: "E", upMm: 950 }), drop])[0].flags.length, 0, "exactly 300 apart is fine");

// the venue: upstage of the stage depth, a batten wider than the 14 m stage, trims above the grid
const far = flagsOf([line({ name: "U", upMm: 10500, battenMm: 15000, inTrimMm: 16500, outTrimMm: 15500 })], [], venue)[0].flags;
assert.ok(far.includes("Upstage of the stage depth"));
assert.ok(far.includes("Batten wider than the stage"));
assert.ok(far.includes("In trim above the grid"));
assert.ok(far.includes("Out trim within 1 m of the grid"));
const exact = flagsOf([line({ name: "O", upMm: 10000, outTrimMm: 15000 })], [], venue)[0].flags;
assert.equal(exact.length, 0, "stage depth and out trim 1 m below the grid are not over");
assert.equal(flagsOf([line({ name: "U", upMm: 10500, battenMm: 15000, inTrimMm: 16500 })])[0].flags.length, 0, "no venue, no venue checks");

// cloth below the floor: a border whose cloth is longer than its trim height; an electric with the same figures is not checked
const low = flagsOf([line({ name: "B", upMm: 2000, kind: "border", inTrimMm: 2000, clothMm: 2500 })])[0].flags;
assert.ok(low.includes("Cloth reaches below the floor at trim"));
assert.equal(flagsOf([line({ name: "B", upMm: 2000, kind: "electric", inTrimMm: 2000, clothMm: 2500 })])[0].flags.length, 0);

// kinds as typed: any case; anything else is empty
assert.equal(kindOf("Border"), "border");
assert.equal(kindOf(" drop "), "drop");
assert.equal(kindOf("bogus"), "empty");

console.log("linesets checks passed");
