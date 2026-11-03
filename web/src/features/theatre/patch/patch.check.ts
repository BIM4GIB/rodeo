// Checks for patch.ts, with the expected numbers worked out by hand in the comments. Run with:
//   npx tsx src/features/theatre/patch/patch.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { DEFAULT_STAGE } from "../stage.ts";
import { absoluteOf, addressOf, compareText, conflicts, describeFixture, isPatched, numberChannels, numberUnits, planPatch, spanOf, universeMap, universeOf } from "./patch.ts";

const base: Fixture = {
  id: "",
  layerId: "L",
  classIndex: 0,
  native: true,
  at: { x: 0, y: 0 },
  type: "profile26",
  label: "Profile 26°",
  glyph: "ellipsoidal",
  position: "",
  unit: "",
  channel: "",
  universe: 0,
  address: 0,
  footprint: 1,
  dimmer: "",
  circuit: "",
  color: "",
  gobo: "",
  purpose: "",
  accessory: "",
  notes: "",
  watts: 750,
  weightKg: 7.7,
  beamDeg: 18,
  fieldDeg: 26,
  lumens: 10500,
  heightMm: 6000,
  focus: null,
  aimDeg: -90,
};
const fx = (id: string, o: Partial<Fixture> = {}): Fixture => ({ ...base, id, ...o });
const frame = DEFAULT_STAGE; // across = x on the default frame, so stage right (negative x) comes first

// spans and addresses
assert.equal(spanOf({ footprint: 0 }), 1, "a footprint of 0 counts as 1");
assert.equal(spanOf({ footprint: 24 }), 24);
assert.equal(isPatched({ universe: 1, address: 0 }), false);
assert.equal(absoluteOf(2, 10), 522, "universe 2 address 10 is 512 + 10");
assert.equal(absoluteOf(1, 512), 512);
assert.equal(universeOf(512), 1);
assert.equal(universeOf(513), 2);
assert.equal(addressOf(522), 10);
assert.equal(addressOf(513), 1);

// text order: natural, blanks last
assert.ok(compareText("2", "10") < 0, "2 before 10");
assert.ok(compareText("", "1") > 0, "a blank sorts after a name");
assert.equal(compareText(" 4 ", "4"), 0);

// describeFixture
assert.equal(describeFixture({ channel: "12", position: "1st Electric", unit: "3", label: "Profile 26°" }), "Ch 12 · 1st Electric · Unit 3 · Profile 26°");
assert.equal(describeFixture({ channel: "", position: "", unit: "", label: "" }), "Instrument");

// planPatch
// a footprint of 24 at address 500 runs to 523, past 512, so it starts universe 2 at address 1
assert.deepEqual(planPatch([fx("a", { footprint: 24 })], { universe: 1, address: 500, gap: 0, order: "unit", frame }), [{ id: "a", universe: 2, address: 1 }]);
// two footprint-0 instruments (each 1 address) from 512: the first takes 512, the second starts universe 2 at 1
assert.deepEqual(planPatch([fx("f", { unit: "1" }), fx("g", { unit: "2" })].map((f) => ({ ...f, footprint: 0 })), { universe: 1, address: 512, gap: 0, order: "unit", frame }), [
  { id: "f", universe: 1, address: 512 },
  { id: "g", universe: 2, address: 1 },
]);
// footprint 10 with a gap of 2: addresses 1, 13, 25
const ten = [1, 2, 3].map((n) => fx(`t${n}`, { unit: String(n), footprint: 10 }));
assert.deepEqual(
  planPatch(ten, { universe: 1, address: 1, gap: 2, order: "unit", frame }).map((p) => p.address),
  [1, 13, 25],
);
// from 500 with footprint 10 and gap 2: the first takes 500 to 509, the next would start at 512 and run past 512, so universe 2
assert.deepEqual(
  planPatch(ten.slice(0, 2), { universe: 1, address: 500, gap: 2, order: "unit", frame }),
  [
    { id: "t1", universe: 1, address: 500 },
    { id: "t2", universe: 2, address: 1 },
  ],
);
// position order: natural position first ("2" before "10"), then stage right to left (across ascending)
const pos = [
  fx("a", { position: "10", at: { x: 0, y: 0 } }),
  fx("b", { position: "2", at: { x: 0, y: 0 } }),
  fx("c", { position: "2", at: { x: 3000, y: 0 } }),
  fx("d", { position: "2", at: { x: -1000, y: 0 } }),
];
assert.deepEqual(
  planPatch(pos, { universe: 1, address: 1, gap: 0, order: "position", frame }).map((p) => p.id),
  ["d", "b", "c", "a"],
);
// channel order is natural; a blank channel goes last
const chans = [fx("x", { channel: "10" }), fx("y", { channel: "" }), fx("z", { channel: "9" })];
assert.deepEqual(
  planPatch(chans, { universe: 1, address: 1, gap: 0, order: "channel", frame }).map((p) => p.id),
  ["z", "x", "y"],
);
// an instrument with a footprint over 512 can't be patched and is left out
assert.equal(planPatch([fx("big", { footprint: 600 }), fx("ok")], { universe: 1, address: 1, gap: 0, order: "unit", frame }).length, 1);

// numberUnits: each position numbered from stage right (negative x) to stage left
const units = [
  fx("e1", { position: "1st Electric", at: { x: -2000, y: 0 } }),
  fx("e2", { position: "1st Electric", at: { x: 0, y: 0 } }),
  fx("e3", { position: "1st Electric", at: { x: 2000, y: 0 } }),
  fx("e4", { position: "2nd Electric", at: { x: 500, y: 0 } }),
];
assert.deepEqual(numberUnits(units, frame, { start: 1 }), [
  { id: "e1", unit: "1" },
  { id: "e2", unit: "2" },
  { id: "e3", unit: "3" },
  { id: "e4", unit: "1" },
]);
assert.deepEqual(numberUnits(units.slice(0, 1), frame, { start: 10 }), [{ id: "e1", unit: "10" }]);

// numberChannels each: one channel per instrument, in position order (2nd Electric before 10th)
const each = [fx("c1", { position: "10th" }), fx("c2", { position: "2nd" })];
assert.deepEqual(numberChannels(each, { start: 1, by: "each", frame }), [
  { id: "c2", channel: "1" },
  { id: "c1", channel: "2" },
]);
// numberChannels purpose: Key L201 twice (the second typed differently) shares a channel, Back R80 gets the next
const shared = [
  fx("k1", { position: "1", purpose: "Key", color: "L201", at: { x: -1000, y: 0 } }),
  fx("b1", { position: "1", purpose: "Back", color: "R80", at: { x: 0, y: 0 } }),
  fx("k2", { position: "1", purpose: "key ", color: "l201", at: { x: 1000, y: 0 } }),
];
const byPurpose = (start: number) => Object.fromEntries(numberChannels(shared, { start, by: "purpose", frame }).map((r) => [r.id, r.channel]));
assert.deepEqual(byPurpose(1), { k1: "1", b1: "2", k2: "1" });
assert.deepEqual(byPurpose(10), { k1: "10", b1: "11", k2: "10" });
// instruments with neither purpose nor colour have nothing to share: each keeps a channel of its own
const blanks = [
  fx("n1", { position: "1", at: { x: -1000, y: 0 } }),
  fx("key", { position: "1", purpose: "Key", at: { x: 0, y: 0 } }),
  fx("n2", { position: "1", at: { x: 1000, y: 0 } }),
];
assert.deepEqual(
  numberChannels(blanks, { start: 1, by: "purpose", frame }).map((r) => [r.id, r.channel]),
  [
    ["n1", "1"],
    ["key", "2"],
    ["n2", "3"],
  ],
);

// conflicts: A 1..24 and B 20..27 share 20 to 24; F (24) shares 24 with both; E (30) and C (universe 2) share nothing
const A = fx("A", { channel: "1", universe: 1, address: 1, footprint: 24 });
const B = fx("B", { channel: "1", universe: 1, address: 20, footprint: 8 });
const F = fx("F", { channel: "1", universe: 1, address: 24, footprint: 1 });
const E = fx("E", { channel: "1", universe: 1, address: 30, footprint: 1 });
const C = fx("C", { universe: 2, address: 20, footprint: 10 });
const D = fx("D", { universe: 0, address: 5, footprint: 4 });
assert.deepEqual(
  conflicts([A, B, F, E, C, D]).map((c) => [c.a, c.b, c.universe, c.from, c.to]),
  [
    ["A", "B", 1, 20, 24],
    ["A", "F", 1, 24, 24],
    ["B", "F", 1, 24, 24],
  ],
);

// universeMap: universe 1 uses 1 to 27 and 30 (28 addresses); universe 2 uses 20 to 29 (10 addresses)
const map = universeMap([A, B, F, E, C, D]);
assert.deepEqual(
  map.map((u) => [u.universe, u.used, u.free]),
  [
    [1, 28, 484],
    [2, 10, 502],
  ],
);
assert.deepEqual(
  map[0].blocks.map((b) => [b.start, b.end, b.fixtureId, b.label]),
  [
    [1, 24, "A", "Ch 1 · Profile 26°"],
    [20, 27, "B", "Ch 1 · Profile 26°"],
    [24, 24, "F", "Ch 1 · Profile 26°"],
    [30, 30, "E", "Ch 1 · Profile 26°"],
  ],
);
assert.deepEqual(universeMap([D]), [], "an unpatched instrument has no universe");

console.log("patch.check.ts: all checks passed");
