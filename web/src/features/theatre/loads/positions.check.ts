// Checks for positions.ts: the batten each position gets, where its hoists sit, and the status words.
// Run with: npx tsx src/features/theatre/loads/positions.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import type { PositionInfo } from "../showTypes.ts";
import type { StageFrame } from "../stage.ts";
import { checkOf, infoOf, NO_POSITION, positionsOf } from "./positions.ts";

const near = (a: number, b: number, what: string, eps = 1e-6): void => {
  assert.ok(Math.abs(a - b) < eps, `${what}: got ${a}, expected ${b}`);
};

const fx = (id: string, x: number, y: number, position: string, weightKg = 10): Fixture =>
  ({ id, at: { x, y }, position, weightKg, watts: 0, circuit: "", dimmer: "", unit: "", channel: "", label: "" }) as unknown as Fixture;

const info = (over: Partial<PositionInfo> & { name: string }): PositionInfo => ({ capacityKg: 0, lengthMm: 0, supportsMm: [], supportCapacityKg: 0, ...over });

// The default frame: across is drawing +x (stage left), up is drawing +y.
const DEFAULT_FRAME: StageFrame = { x: 0, y: 0, upDeg: 90 };

// Four 10 kg instruments on a line at x = 0, 2, 4, 6 m. The batten runs from the stage-right end (x = 0): 500 mm
// past the first, so the instruments sit at 500, 2500, 4500 and 6500; it is 6000 + 1000 = 7000 mm long, on hoists at
// its two ends. The pipe is 3 kg/m x 7 m = 21 kg, so the total is 40 + 21 = 61 kg, and by symmetry each hoist takes
// 20 + 10.5 = 30.5 kg.
{
  const ps = positionsOf([fx("a", 0, 0, "1st Electric"), fx("b", 2000, 0, "1st Electric"), fx("c", 4000, 0, "1st Electric"), fx("d", 6000, 0, "1st Electric")], [], DEFAULT_FRAME);
  assert.equal(ps.length, 1);
  const p = ps[0];
  assert.equal(p.name, "1st Electric");
  assert.deepEqual(
    p.hangs.map((h) => h.offsetMm),
    [500, 2500, 4500, 6500],
  );
  near(p.lengthMm, 7000, "batten length");
  assert.deepEqual([...p.supportsMm], [0, 7000]);
  near(p.instrumentKg, 40, "instrument weight");

  const c = checkOf(p, 3);
  near(c.pipeKg, 21, "pipe weight");
  near(c.totalKg, 61, "total");
  near(c.beam.reactionsKg[0], 30.5, "hoist 1 reaction");
  near(c.beam.reactionsKg[1], 30.5, "hoist 2 reaction");
  near(c.maxReactionKg, 30.5, "biggest reaction");
  assert.equal(c.status, "No capacity set");
  assert.equal(c.level, "unset");
  assert.equal(c.usePct, null);

  // 61 kg on a 50 kg position is 122%, over capacity
  const over = checkOf({ ...p, capacityKg: 50 }, 3);
  near(over.usePct!, 122, "use over capacity", 1e-6);
  assert.equal(over.status, "Over capacity");
  assert.equal(over.level, "bad");

  // 61 kg on a 100 kg position is 61%, and with no hoist limit set it is OK
  const fine = checkOf({ ...p, capacityKg: 100 }, 3);
  near(fine.usePct!, 61, "use within capacity", 1e-6);
  assert.equal(fine.status, "OK");
  assert.equal(fine.level, "ok");

  // each hoist takes 30.5 kg against a 25 kg limit: 5.5 kg over, rounded up to 6 kg, and it's the first hoist
  const hoist = checkOf({ ...p, capacityKg: 100, supportCapacityKg: 25 }, 3);
  assert.equal(hoist.status, "Hoist 1 over by 6 kg");
  assert.equal(hoist.level, "bad");

  // both problems at once: the words join
  const both = checkOf({ ...p, supportCapacityKg: 25 }, 3);
  assert.equal(both.status, "No capacity set · Hoist 1 over by 6 kg");
  assert.equal(both.level, "bad");
}

// A line running up and down the stage (along drawing +y) starts at its downstage end, as it's the only end that
// can be taken as the stage-right one. Here the instrument at y = 0 is the start, so it hangs 500 mm from the end.
{
  const ps = positionsOf([fx("near", 0, 4000, "Bar"), fx("start", 0, 0, "Bar")], [], DEFAULT_FRAME);
  const p = ps[0];
  near(p.lengthMm, 5000, "upstage line: length");
  assert.equal(p.hangs[0].fixture.id, "start");
  near(p.hangs[0].offsetMm, 500, "upstage line: first offset");
  near(p.hangs[1].offsetMm, 4500, "upstage line: second offset");
}

// With the stage turned so that drawing +y is stage left, the line runs across: the instrument at y = 4000 is
// stage right of the one at y = 0, so it's the start.
{
  const turned: StageFrame = { x: 0, y: 0, upDeg: 0 };
  const ps = positionsOf([fx("low", 0, 0, "Bar"), fx("high", 0, 4000, "Bar")], [], turned);
  const p = ps[0];
  assert.equal(p.hangs[0].fixture.id, "high", "stage-right end is the start");
  near(p.hangs[0].offsetMm, 500, "turned frame: first offset");
  near(p.lengthMm, 5000, "turned frame: length");
}

// A slanted line through (0,0) and (3 m, 4 m) is 5 m long; the start is the (0,0) end: offsets 500 and 5500.
{
  const ps = positionsOf([fx("a", 0, 0, "Slant", 1), fx("b", 3000, 4000, "Slant", 1)], [], DEFAULT_FRAME);
  near(ps[0].lengthMm, 6000, "slanted line: length");
  assert.equal(ps[0].hangs[0].fixture.id, "a");
  near(ps[0].hangs[1].offsetMm, 5500, "slanted line: far offset");
}

// One instrument: its batten is 1 m (500 mm past it at each end), hoists at both ends. A 50 kg lamp at the middle
// with a 1 m pipe of 3 kg: 26.5 kg each.
{
  const ps = positionsOf([fx("one", 0, 0, "Solo", 50)], [], DEFAULT_FRAME);
  near(ps[0].lengthMm, 1000, "one instrument: length");
  near(ps[0].hangs[0].offsetMm, 500, "one instrument: offset");
  const c = checkOf(ps[0], 3);
  near(c.maxReactionKg, 26.5, "one instrument: reaction");
}

// Stored limits: a set length and hoists replace the worked-out ones. Hoists beyond the batten are dropped.
{
  const stored = [info({ name: "1st Electric", capacityKg: 100, lengthMm: 9000, supportsMm: [0, 4500, 9000, 12000] })];
  const ps = positionsOf([fx("a", 0, 0, "1st Electric"), fx("d", 6000, 0, "1st Electric")], stored, DEFAULT_FRAME);
  near(ps[0].lengthMm, 9000, "set length");
  assert.deepEqual([...ps[0].supportsMm], [0, 4500, 9000]);
  near(ps[0].capacityKg, 100, "set capacity");
  assert.deepEqual(infoOf("Nowhere", stored), { name: "Nowhere", capacityKg: 0, lengthMm: 0, supportsMm: [], supportCapacityKg: 0 });
}

// Instruments with no Position form their own group, last, with no hoists and no pipe.
{
  const ps = positionsOf([fx("x", 0, 0, ""), fx("y", 0, 0, "1st Electric"), fx("z", 0, 0, "  ")], [], DEFAULT_FRAME);
  assert.deepEqual(
    ps.map((p) => p.name),
    ["1st Electric", NO_POSITION],
  );
  assert.equal(ps[1].hangs.length, 2);
  assert.deepEqual([...ps[1].supportsMm], []);
  const c = checkOf(ps[1], 3);
  near(c.pipeKg, 0, "no position: no pipe");
  assert.equal(c.beam.unstable, true);
  assert.equal(c.status, "No batten to check");
}

console.log("positions.check.ts: all checks passed");
