// Checks the focus card text against hand-worked numbers. Run from web/:
//   npx tsx src/features/theatre/docs/focusCards.check.ts
// Stage frame at the drawing's origin, facing up the page: across is the drawing's x, up its y. A lamp at
// (1200, 7300) focused at (1200, 3000), 1700 high, from a lens 6000 high: 1.20 m SL, 3.00 m US, a 4.30 m
// plan throw and 6.08 m at 45°, field pool 2.81 m, beam pool (18°) 1.93 m.

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { cardOf, sortCards, type FocusCard } from "./focusCards.ts";

const fmt = (mm: number): string => `${(mm / 1000).toFixed(2)} m`;
const frame = { x: 0, y: 0, upDeg: 90 };

const base: Fixture = {
  id: "base",
  layerId: "layer",
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

const focused: Fixture = {
  ...base,
  id: "u3",
  unit: "3",
  position: "1st Electric",
  channel: "21",
  universe: 1,
  address: 101,
  color: "L201",
  purpose: "Key",
  at: { x: 1200, y: 7300 },
  focus: { x: 1200, y: 3000, z: 1700 },
};

const c = cardOf(focused, frame, fmt);
assert.equal(c.title, "Unit 3 @ 1st Electric");
assert.equal(c.patch, "1/101");
assert.equal(c.hungAt, "1.20 m SL · 7.30 m US");
assert.equal(c.hotSpot, "1.20 m SL · 3.00 m US");
assert.equal(c.lens, "6.00 m");
assert.equal(c.throwText, "6.08 m at 45°");
assert.equal(c.fieldText, "2.81 m");
assert.equal(c.beamText, "1.93 m");
assert.equal(c.acrossText, "1.20 m");
assert.equal(c.upText, "3.00 m");
// the QR text is the brief's example, word for word
assert.equal(c.qr, "Unit 3 @ 1st Electric Ch 21 Hot spot 1.20 m SL 3.00 m US");
assert.equal(c.focused, true);

// no unit: the type's name; no position: no "@"
const noUnit = cardOf({ ...focused, unit: "", position: "" }, frame, fmt);
assert.equal(noUnit.title, "Profile 26°");
const noUnitPosition = cardOf({ ...focused, unit: "" }, frame, fmt);
assert.equal(noUnitPosition.title, "Profile 26° @ 1st Electric");

// not focused: no hot spot, no throw, and the QR says so; not patched: no patch
const bare = cardOf({ ...base, channel: "" }, frame, fmt);
assert.equal(bare.focused, false);
assert.equal(bare.hotSpot, "");
assert.equal(bare.throwText, "");
assert.equal(bare.fieldText, "");
assert.equal(bare.patch, "");
assert.equal(bare.qr, "Profile 26° Not focused yet");

// a focus 1000 above the lens: the throw is sqrt(4300² + 1000²) = 4415 mm at -13°
const high = cardOf({ ...focused, focus: { x: 1200, y: 3000, z: 7000 } }, frame, fmt);
assert.equal(high.throwText, "4.41 m at -13°");

// sorting: position as people read it (2 before 10, blanks last); channel likewise
const cards = (list: Fixture[]): FocusCard[] => list.map((f) => cardOf(f, frame, fmt));
const byPos = sortCards(cards([
  { ...focused, id: "a", position: "10", unit: "1" },
  { ...focused, id: "b", position: "2", unit: "9" },
  { ...focused, id: "c", position: "", unit: "5" },
  { ...focused, id: "d", position: "2", unit: "10" },
]), "position");
assert.deepEqual(byPos.map((x) => x.id), ["b", "d", "a", "c"]);

const byChannel = sortCards(cards([
  { ...focused, id: "a", channel: "10" },
  { ...focused, id: "b", channel: "" },
  { ...focused, id: "c", channel: "2" },
]), "channel");
assert.deepEqual(byChannel.map((x) => x.id), ["c", "a", "b"]);

console.log("focusCards.check: all checks pass");
