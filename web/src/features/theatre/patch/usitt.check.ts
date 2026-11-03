// Checks for usitt.ts, with the expected text worked out by hand in the comments. Run with:
//   npx tsx src/features/theatre/patch/usitt.check.ts

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { patchRows, PATCH_HEADINGS, usittPatch, wholeChannel } from "./usitt.ts";

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

// whole channels only
assert.equal(wholeChannel("12"), 12);
assert.equal(wholeChannel(" 3.0 "), 3);
assert.equal(wholeChannel("1A"), null);
assert.equal(wholeChannel("0"), null, "channel 0 doesn't exist on a console");
assert.equal(wholeChannel(""), null);

// a small patch: F1 is absolute 1; F2 is universe 2 address 10, absolute 512 + 10 = 522; F3 is absolute 25 on channel 2
const F1 = fx("F1", { channel: "1", universe: 1, address: 1 });
const F2 = fx("F2", { channel: "1", universe: 2, address: 10 });
const F3 = fx("F3", { channel: "2", universe: 1, address: 25 });
const F4 = fx("F4", { channel: "1A", universe: 1, address: 5 });
const F5 = fx("F5", { channel: "3", universe: 0, address: 0 });
const small = usittPatch([F1, F2, F3, F4, F5]);
assert.equal(
  small.text,
  [
    "Ident 3:0",
    "Manufacturer Rodeo",
    "Console Rodeo",
    "Clear Patch",
    "Patch 1 1 1@100 522@100", // channel 1: absolute 1 and 522, on one line
    "Patch 1 2 25@100",
    "EndData",
  ].join("\r\n") + "\r\n",
);
assert.equal(small.patched, 3);
assert.deepEqual(
  small.skipped.map((s) => [s.id, s.reason]),
  [
    ["F4", "no whole-number channel"],
    ["F5", "not patched"],
  ],
);

// wrapping: channel 5 at address 100 of universes 1 to 10 is absolute 100, 612, 1124, ..., 4708.
// "Patch 1 5" is 9 characters; each token adds a space and its text. 79 characters fit 100 to 3684;
// 4196 would make 88, so it starts a new "Patch 1 5" line with 4708 after it.
const wrap = Array.from({ length: 10 }, (_, i) => fx(`w${i + 1}`, { channel: "5", universe: i + 1, address: 100 }));
const wrapped = usittPatch(wrap).text.split("\r\n");
assert.equal(wrapped[4], "Patch 1 5 100@100 612@100 1124@100 1636@100 2148@100 2660@100 3172@100 3684@100");
assert.equal(wrapped[4].length, 79);
assert.equal(wrapped[5], "Patch 1 5 4196@100 4708@100");
for (const line of wrapped) assert.ok(line.length < 80, `a line runs to ${line.length} characters`);

// the same address twice on one channel is written once
const twice = usittPatch([fx("p", { channel: "7", universe: 1, address: 50 }), fx("q", { channel: "7", universe: 1, address: 50 })]);
assert.ok(twice.text.includes("\r\nPatch 1 7 50@100\r\n"), twice.text);
assert.equal(twice.patched, 2);

// nothing to patch: the file still has its header and EndData
assert.equal(usittPatch([F5]).text, "Ident 3:0\r\nManufacturer Rodeo\r\nConsole Rodeo\r\nClear Patch\r\nEndData\r\n");

// patchRows: the headings, patched in address order first, then the rest; blank where unpatched
assert.equal(PATCH_HEADINGS.length, 11);
assert.deepEqual(patchRows([F2, F5, F1]), [
  ["1", 1, 1, 1, 1, "Profile 26°", "", "", "", "", ""],
  ["1", 2, 10, 522, 1, "Profile 26°", "", "", "", "", ""],
  ["3", "", "", "", 1, "Profile 26°", "", "", "", "", ""],
]);

console.log("usitt.check.ts: all checks passed");
