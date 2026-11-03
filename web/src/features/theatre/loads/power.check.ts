// Checks for power.ts: the loads a set of instruments makes, the phase balance worked by hand, the neutral and the
// look demand. Run with: npx tsx src/features/theatre/loads/power.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import type { Look } from "../showTypes.ts";
import { balancePhases, imbalanceOf, loadKeyOf, loadsOf, lookDemand, neutralAmps, phaseAmps, phaseNumber, serviceAmps } from "./power.ts";

const near = (a: number, b: number, what: string, eps = 1e-6): void => {
  assert.ok(Math.abs(a - b) < eps, `${what}: got ${a}, expected ${b}`);
};

const fx = (id: string, o: Partial<Fixture>): Fixture => ({ id, watts: 0, circuit: "", dimmer: "", unit: "", channel: "", label: "Profile", ...o }) as unknown as Fixture;

// Loads: circuit 3 has two 750 W lamps (1500 W); the dimmer D1 alone is 1000 W; a lamp with neither is its own load.
// A circuit wins over a dimmer, so the lamp on circuit 3 and dimmer 9 counts with circuit 3.
{
  const list = [
    fx("a", { watts: 750, circuit: "3", unit: "1", channel: "11" }),
    fx("b", { watts: 750, circuit: "3", unit: "2", channel: "12" }),
    fx("c", { watts: 1000, dimmer: "D1", unit: "3", channel: "13" }),
    fx("d", { watts: 500, circuit: "3", dimmer: "9" }),
    fx("e", { watts: 1000, unit: "5", channel: "15" }),
  ];
  const loads = loadsOf(list);
  assert.equal(loads.length, 3);
  const byKey = new Map(loads.map((l) => [l.key, l]));
  near(byKey.get("circuit:3")!.watts, 2000, "circuit 3 watts (the dimmer 9 lamp is on it too)");
  near(byKey.get("dimmer:D1")!.watts, 1000, "dimmer D1 watts");
  near(byKey.get("fixture:e")!.watts, 1000, "lone instrument watts");
  assert.equal(byKey.get("fixture:e")!.name, "Unit 5, Ch 15");
  assert.equal(loadKeyOf(list[3]), "circuit:3");
  near(loads.reduce((s, l) => s + l.watts, 0), 4000, "all watts kept");
}

// Balancing: 2400, 2000, 1500, 1000, 800, 500 over three phases. Total 8200, ideal 2733. Heaviest first to the
// lightest phase gives 2400+500, 2000+800, 1500+1000 = 2900, 2800, 2500. No swap of the heaviest phase's load with
// the lightest's narrows the 400 spread, so that stands: imbalance = 400 / 2733.33 x 100 = 14.634%.
{
  const b = balancePhases([2400, 2000, 1500, 1000, 800, 500], 3);
  assert.deepEqual([...b.watts].sort((x, y) => y - x), [2900, 2800, 2500]);
  near(b.watts.reduce((s, w) => s + w, 0), 8200, "balanced total");
  near(b.imbalancePct, (400 / (8200 / 3)) * 100, "imbalance of 2900, 2800, 2500", 1e-9);
  near(b.imbalancePct, 14.634146, "imbalance figure", 1e-5);
  // every load is on exactly one phase, and the phases match the watts they hold
  const check = [0, 0, 0];
  b.assignment.forEach((p, i) => (check[p] += [2400, 2000, 1500, 1000, 800, 500][i]));
  assert.deepEqual(check, b.watts);
}

// A swap that helps: 6, 5, 4, 3, 2 over two phases. The heaviest-first pass gives 6+3+2 = 11 and 5+4 = 9; swapping
// the 6 with the 5 gives 10 and 10, so the imbalance is 0.
{
  const b = balancePhases([6, 5, 4, 3, 2], 2);
  assert.deepEqual([...b.watts].sort((x, y) => x - y), [10, 10]);
  near(b.imbalancePct, 0, "swap evens two phases");
}

// One phase: everything is on it, and nothing is out of balance.
{
  const b = balancePhases([2400, 500], 1);
  assert.deepEqual(b.assignment, [0, 0]);
  near(b.watts[0], 2900, "one phase total");
  near(b.imbalancePct, 0, "one phase imbalance");
}

// Amps and neutral. 120 V to neutral: 2900 W is 24.17 A. Three equal phases of 10 A leave no neutral current;
// 20, 10, 10 leave sqrt(600 - 500) = 10 A. A balanced 8200 W on three phases at 120 V is 8200 / 360 = 22.78 A a line.
{
  near(phaseAmps(2900, 120), 24.1666667, "phase amps", 1e-6);
  near(neutralAmps(10, 10, 10), 0, "neutral, equal");
  near(neutralAmps(20, 10, 10), 10, "neutral, one heavy");
  near(serviceAmps(8200, 120, 3), 22.7777778, "service amps, balanced", 1e-6);
  near(serviceAmps(1200, 120, 1), 10, "service amps, one phase");
}

// Percent: nothing on the supply is 0%; 3 and 1 over two phases is (4-2)/2 = 100%.
{
  near(imbalanceOf([0, 0, 0]), 0, "no load");
  near(imbalanceOf([3, 1]), 100, "3 and 1 over two phases");
}

// Phase labels: L1 to L3 on three phases, L1 alone on one.
{
  assert.equal(phaseNumber("L2", 3), 2);
  assert.equal(phaseNumber(" l 3 ", 3), 3);
  assert.equal(phaseNumber("2", 3), 2);
  assert.equal(phaseNumber("L3", 1), null);
  assert.equal(phaseNumber("L4", 3), null);
  assert.equal(phaseNumber("", 3), null);
}

// Looks: a look draws each instrument's watts at its channel's level; a channel the look leaves out is off. Here
// channel 11 is at half, 12 at full and 13 is left out, so 750 x 0.5 + 750 x 1 = 1125 W, on phases 0 and 1.
{
  const list = [
    fx("a", { watts: 750, channel: "11", circuit: "1" }),
    fx("b", { watts: 750, channel: "12", circuit: "2" }),
    fx("c", { watts: 1000, channel: "13", circuit: "3" }),
  ];
  const phaseOf = (f: Fixture): number => (f.id === "a" ? 0 : f.id === "b" ? 1 : 2);
  const looks: Look[] = [{ id: "l1", name: "Warm", levels: { "11": 0.5, "12": 1 }, fadeSeconds: 0 }];
  const [d] = lookDemand(looks, list, phaseOf, 3);
  assert.equal(d.name, "Warm");
  near(d.watts, 1125, "look watts");
  assert.deepEqual(d.phaseWatts, [375, 750, 0]);
}

console.log("power.check.ts: all checks passed");
