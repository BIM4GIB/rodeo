// Checks for reports.ts, with each expected figure worked out by hand in the comments. Run with:
//   npx tsx src/features/theatre/paperwork/reports.check.ts

import assert from "node:assert/strict";
import { fixtureType, type Fixture } from "../fixture.ts";
import { channelHookup, colorCuts, cutsPerSheet, dimmerHookup, frameInches, goboPull, problems, shopOrder, unitsText } from "./reports.ts";

/** An instrument as readFixtures makes one from a catalogue type, with `over` set. */
function fx(id: string, type: string, over: Partial<Fixture> = {}): Fixture {
  const t = fixtureType(type)!;
  return {
    id,
    layerId: "layer",
    classIndex: 0,
    native: true,
    at: { x: 0, y: 0 },
    type: t.key,
    label: t.label,
    glyph: t.glyph,
    position: "",
    unit: "",
    channel: "",
    universe: 0,
    address: 0,
    footprint: t.footprint,
    dimmer: "",
    circuit: "",
    color: "",
    gobo: "",
    purpose: "",
    accessory: "",
    notes: "",
    watts: t.watts,
    weightKg: t.weightKg,
    beamDeg: t.beamDeg,
    fieldDeg: t.fieldDeg,
    lumens: t.lumens,
    heightMm: 6000,
    focus: null,
    aimDeg: -90,
    ...over,
  };
}

// Frames and sheets. A sheet is 20 x 24 in.
// 20/6.25 = 3.2 -> 3, 24/6.25 = 3.84 -> 3: 9 per sheet. 20/8 -> 2, 24/8 = 3: 6. 20/10 -> 2, 24/10 -> 2: 4. 20/12 -> 1, 24/12 = 2: 2.
assert.equal(frameInches("ellipsoidal"), 6.25);
assert.equal(frameInches("fresnel"), 8);
assert.equal(frameInches("par"), 10);
assert.equal(frameInches("wash"), 12);
assert.equal(frameInches("moving"), null);
assert.equal(cutsPerSheet(6.25), 9);
assert.equal(cutsPerSheet(8), 6);
assert.equal(cutsPerSheet(10), 4);
assert.equal(cutsPerSheet(12), 2);

// 13 cuts of 6.25 in frames: 9 per sheet, 13 / 9 = 1.44 -> 2 sheets.
{
  const list = Array.from({ length: 13 }, (_, i) => fx(`e${i}`, "profile26", { color: "L201" }));
  assert.deepEqual(colorCuts(list), [{ code: "L201", name: "Full CT Blue", frameIn: 6.25, cuts: 13, sheets: 2 }]);
}

// Gel counting. a and b: "L201+L119" each (L201 x2, L119 x2). c: fresnel "L201", a frame of 8 (6 per sheet).
// d: moving light, no gel, left out. e: par "R80" at 10. f: "lee 201" is L201 at 6.25 (gelOf reads it).
// g: "Open" and i: blank give nothing. h: a wash with "#ff0000" is an LED colour, not a gel.
// So L119 @6.25: 2 cuts, 1 sheet. L201 @6.25: a, b, f = 3 cuts, 1 sheet. L201 @8: 1 cut, 1 sheet. R80 @10: 1 cut, 1 sheet.
{
  const list = [
    fx("a", "profile26", { color: "L201+L119" }),
    fx("b", "profile26", { color: "L201+L119" }),
    fx("c", "fresnel1k", { color: "L201" }),
    fx("d", "washmover", { color: "L201" }),
    fx("e", "parnsp", { color: "R80" }),
    fx("f", "profile26", { color: "lee 201" }),
    fx("g", "profile26", { color: "Open" }),
    fx("h", "ledbatten", { color: "#ff0000" }),
    fx("i", "profile26", { color: "" }),
  ];
  assert.deepEqual(colorCuts(list), [
    { code: "L119", name: "Dark Blue", frameIn: 6.25, cuts: 2, sheets: 1 },
    { code: "L201", name: "Full CT Blue", frameIn: 6.25, cuts: 3, sheets: 1 },
    { code: "L201", name: "Full CT Blue", frameIn: 8, cuts: 1, sheets: 1 },
    { code: "R80", name: "Primary Blue", frameIn: 10, cuts: 1, sheets: 1 },
  ]);
}

// Units. "1st Electric" has #3, #4 and #10 (natural order), "2nd Electric" #1, and one unit with no position: #7.
// Positions in natural order, the blank one last, joined by semicolons. An instrument with neither adds nothing.
{
  const list = [
    fx("u1", "profile26", { position: "2nd Electric", unit: "1" }),
    fx("u2", "profile26", { position: "1st Electric", unit: "10" }),
    fx("u3", "profile26", { position: "1st Electric", unit: "3" }),
    fx("u4", "profile26", { position: "1st Electric", unit: "4" }),
    fx("u5", "profile26", { unit: "7" }),
    fx("u6", "profile26"),
  ];
  assert.equal(unitsText(list), "1st Electric #3, #4, #10; 2nd Electric #1; #7");
}

// Channel hookup, on six instruments:
//  f1 profile26 "1st Electric" #3, ch 101, dimmer 1, L201, Key, 750 W
//  f2 profile26 "1st Electric" #4, ch 101, dimmer 1, L201, Key, 750 W
//  f3 fresnel1k "1st Electric" #10, ch 2, dimmer 2, blank colour, Wash, 1000 W
//  f4 profile26 "2nd Electric" #1, ch 10, dimmer 10, R80, no purpose, 750 W
//  f5 parnsp, no position, unit, channel or dimmer, 1000 W
//  f6 washmover "1st Electric" #5, ch 101, no dimmer, no colour, 400 W
// Channels in natural order: 2, 10, 101, then the unchannelled.
{
  const list = [
    fx("f1", "profile26", { position: "1st Electric", unit: "3", channel: "101", dimmer: "1", color: "L201", purpose: "Key" }),
    fx("f2", "profile26", { position: "1st Electric", unit: "4", channel: "101", dimmer: "1", color: "L201", purpose: "Key" }),
    fx("f3", "fresnel1k", { position: "1st Electric", unit: "10", channel: "2", dimmer: "2", purpose: "Wash" }),
    fx("f4", "profile26", { position: "2nd Electric", unit: "1", channel: "10", dimmer: "10", color: "R80" }),
    fx("f5", "parnsp"),
    fx("f6", "washmover", { position: "1st Electric", unit: "5", channel: "101" }),
  ];
  assert.deepEqual(channelHookup(list), [
    { channel: "2", count: 1, units: "1st Electric #10", dimmers: "2", types: "Fresnel 1 kW", colours: "none", purposes: "Wash", watts: 1000 },
    { channel: "10", count: 1, units: "2nd Electric #1", dimmers: "10", types: "Profile 26°", colours: "R80", purposes: "", watts: 750 },
    // 101: units #3, #4, #5 at 1st Electric; dimmer 1 (the blank one left out); types LED Wash Mover and Profile 26°;
    // colours "" and L201 ("none, L201"); 750 + 750 + 400 = 1900 W.
    {
      channel: "101",
      count: 3,
      units: "1st Electric #3, #4, #5",
      dimmers: "1",
      types: "LED Wash Mover, Profile 26°",
      colours: "none, L201",
      purposes: "Key",
      watts: 1900,
    },
    { channel: "", count: 1, units: "", dimmers: "", types: "PAR 64 NSP", colours: "none", purposes: "", watts: 1000 },
  ]);
}

// Dimmer hookup, limit 2400 W. Dimmer 1: 750 + 750 = 1500 W. Dimmer 3: 2000 + 1000 = 3000 W, over.
// Dimmer 4: one instrument at exactly 2400 W, not over (the limit is not passed). Dimmer 10: 750 W.
// One instrument has no dimmer and is not on a row. Dimmers in natural order: 1, 3, 4, 10.
{
  const list = [
    fx("d1", "profile26", { position: "1st Electric", unit: "3", channel: "101", dimmer: "1" }),
    fx("d2", "profile26", { position: "1st Electric", unit: "4", channel: "101", dimmer: "1" }),
    fx("d3", "fresnel2k", { position: "2nd Electric", unit: "2", channel: "3", dimmer: "3" }),
    fx("d4", "fresnel1k", { position: "2nd Electric", unit: "3", channel: "3", dimmer: "3" }),
    fx("d5", "fresnel1k", { position: "3rd Electric", unit: "1", channel: "4", dimmer: "4", watts: 2400 }),
    fx("d6", "profile26", { dimmer: "" }),
    fx("d7", "profile26", { channel: "10", dimmer: "10" }),
  ];
  assert.deepEqual(dimmerHookup(list, 2400), [
    { dimmer: "1", channels: "101", units: "1st Electric #3, #4", watts: 1500, over: false },
    { dimmer: "3", channels: "3", units: "2nd Electric #2, #3", watts: 3000, over: true },
    { dimmer: "4", channels: "4", units: "3rd Electric #1", watts: 2400, over: false },
    { dimmer: "10", channels: "10", units: "", watts: 750, over: false },
  ]);
  // At a 1000 W limit, dimmer 1 (1500) and dimmer 4 (2400) are over as well; dimmer 10 (750) is not.
  assert.deepEqual(
    dimmerHookup(list, 1000).map((r) => [r.dimmer, r.over]),
    [
      ["1", true],
      ["3", true],
      ["4", true],
      ["10", false],
    ],
  );
}

// Gobo pull. "Breakup 3" and "breakup 3" are one gobo, count 2, named as first typed. "Leaves" on a moving light
// and a profile: count 2. The instrument with no gobo is not on a row.
{
  const list = [
    fx("g1", "profile26", { position: "1st Electric", unit: "3", gobo: "Breakup 3" }),
    fx("g2", "profile26", { position: "1st Electric", unit: "4", gobo: "breakup 3" }),
    fx("g3", "washmover", { position: "1st Electric", unit: "5", gobo: "Leaves" }),
    fx("g4", "profile26", { position: "2nd Electric", unit: "1", gobo: "Leaves" }),
    fx("g5", "profile26", { position: "2nd Electric", unit: "2" }),
  ];
  assert.deepEqual(goboPull(list), [
    { gobo: "Breakup 3", count: 2, units: "1st Electric #3, #4", types: "Profile 26°" },
    { gobo: "Leaves", count: 2, units: "1st Electric #5; 2nd Electric #1", types: "LED Wash Mover, Profile 26°" },
  ]);
}

// Shop order. Profile 26 x2: 750 W and 7.7 kg each, so 1500 W and 15.4 kg. Fresnel 1 kW x1: 1000 W, 7 kg.
// LED Wash Mover x1: 400 W, 13 kg. Totals: 4 instruments, 2900 W, 7 + 13 + 15.4 = 35.4 kg.
{
  const list = [fx("s1", "profile26"), fx("s2", "profile26"), fx("s3", "fresnel1k"), fx("s4", "washmover")];
  assert.deepEqual(shopOrder(list), {
    rows: [
      { type: "Fresnel 1 kW", count: 1, wattsEach: 1000, watts: 1000, weightEach: 7, weightKg: 7 },
      { type: "LED Wash Mover", count: 1, wattsEach: 400, watts: 400, weightEach: 13, weightKg: 13 },
      { type: "Profile 26°", count: 2, wattsEach: 750, watts: 1500, weightEach: 7.7, weightKg: 15.4 },
    ],
    total: { count: 4, watts: 2900, weightKg: 35.4 },
  });
  // Two of one type at different wattages: "each" is the average, 1250 / 2 = 625 W.
  const mixed = shopOrder([fx("m1", "profile26"), fx("m2", "profile26", { watts: 500 })]);
  assert.equal(mixed.rows[0].wattsEach, 625);
  assert.equal(mixed.rows[0].watts, 1250);
}

// Problems on twelve instruments. Expected, in order:
//  errors: 1 "Unit #3 at 1st Electric" used twice (p1, p2); 2 p4 has no unit; 3 p5 has no channel;
//          4 o2 at DMX 1/16 overlaps o1 at 1/1 (o1 covers 1 to 16, o2 starts at 16).
//  warnings: 5 and 6, channel 101 mixes colours and types (p1, p2, p6).
// p3 (2nd Electric #3) isn't a duplicate of p1 (1st Electric #3). o3 at 1/17 starts after o1 ends. o4 at 2/1
// and o6 at 2/2 are in universe 2 and don't touch each other. o5 has no address, so it isn't patched.
{
  const list = [
    fx("p1", "profile26", { position: "1st Electric", unit: "3", channel: "101", color: "L201" }),
    fx("p2", "profile26", { position: "1st Electric", unit: "3", channel: "101", color: "L201" }),
    fx("p3", "profile26", { position: "2nd Electric", unit: "3", channel: "102", color: "L201" }),
    fx("p4", "profile26", { position: "2nd Electric", unit: "", channel: "103", color: "L201" }),
    fx("p5", "profile26", { position: "2nd Electric", unit: "7", channel: "", color: "L201" }),
    fx("p6", "washmover", { position: "1st Electric", unit: "9", channel: "101" }),
    fx("o1", "profile26", { position: "3rd Electric", unit: "11", channel: "201", color: "L201", universe: 1, address: 1, footprint: 16 }),
    fx("o2", "profile26", { position: "3rd Electric", unit: "12", channel: "202", color: "L201", universe: 1, address: 16 }),
    fx("o3", "profile26", { position: "3rd Electric", unit: "14", channel: "203", color: "L201", universe: 1, address: 17 }),
    fx("o4", "profile26", { position: "3rd Electric", unit: "15", channel: "204", color: "L201", universe: 2, address: 1 }),
    fx("o5", "profile26", { position: "3rd Electric", unit: "16", channel: "205", color: "L201" }),
    fx("o6", "profile26", { position: "3rd Electric", unit: "17", channel: "206", color: "L201", universe: 2, address: 2 }),
  ];
  const found = problems(list);
  assert.deepEqual(
    found.map((p) => [p.severity, p.text, [...p.ids]]),
    [
      ["error", "Unit #3 at 1st Electric is used by 2 instruments", ["p1", "p2"]],
      ["error", "Profile 26° on 2nd Electric has no unit number", ["p4"]],
      ["error", "2nd Electric #7 has no channel", ["p5"]],
      ["error", "DMX 1/16 (3rd Electric #12) overlaps 1/1 (3rd Electric #11)", ["o1", "o2"]],
      ["warning", "Channel 101 mixes colours: none, L201", ["p1", "p2", "p6"]],
      ["warning", "Channel 101 mixes types: LED Wash Mover, Profile 26°", ["p1", "p2", "p6"]],
    ],
  );
}

// No position, two instruments on unit 5: a duplicate with no "at" in its text.
{
  const found = problems([
    fx("n1", "profile26", { unit: "5", channel: "1", color: "L201" }),
    fx("n2", "profile26", { unit: "5", channel: "2", color: "L201" }),
  ]);
  assert.deepEqual(
    found.map((p) => p.text),
    ["Unit #5 is used by 2 instruments"],
  );
}

// Nothing in, nothing out.
assert.deepEqual(channelHookup([]), []);
assert.deepEqual(dimmerHookup([], 2400), []);
assert.deepEqual(colorCuts([]), []);
assert.deepEqual(goboPull([]), []);
assert.deepEqual(shopOrder([]), { rows: [], total: { count: 0, watts: 0, weightKg: 0 } });
assert.deepEqual(problems([]), []);

console.log("reports.check.ts: all checks passed");
