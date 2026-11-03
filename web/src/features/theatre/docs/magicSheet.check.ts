// Checks the Magic Sheet layout: no two bubbles overlap (including a dense 30-channel case and one with every
// channel on a single point), a channel shared by two lights sits at their mean, and the grouping. Run from web/:
//   npx tsx src/features/theatre/docs/magicSheet.check.ts
// The map is 80 mm wide and a bubble 8 mm across, so a spread of 2000 mm across the stage puts the channels
// at 4, 76 mm across the map (k = 72/2000): a channel at 1000 mm sits at 40 mm, midway, with no push apart.

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import { magicLayout, type MagicOptions } from "./magicSheet.ts";

const frame = { x: 0, y: 0, upDeg: 90 };
const opts: MagicOptions = { pageMm: 400, bubbleMm: 8, group: "purposeColour" };

const base: Fixture = {
  id: "base",
  layerId: "layer",
  classIndex: 0,
  native: true,
  at: { x: 0, y: 7000 },
  type: "profile26",
  label: "Profile 26°",
  glyph: "ellipsoidal",
  position: "1st Electric",
  unit: "",
  channel: "1",
  universe: 0,
  address: 0,
  footprint: 1,
  dimmer: "",
  circuit: "",
  color: "L201",
  gobo: "",
  purpose: "Key",
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

const lamp = (id: string, channel: string, x: number, y: number, over: Partial<Fixture> = {}): Fixture => ({
  ...base,
  id,
  channel,
  at: { x, y: 7000 },
  focus: { x, y, z: 1700 },
  ...over,
});

const overlapping = (circles: { center: { x: number; y: number }; radius: number }[]): number => {
  let n = 0;
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i]!;
      const b = circles[j]!;
      if (Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < a.radius + b.radius - 1e-9) n++;
    }
  return n;
};

// a dense case: 30 channels within 300 mm of one another, each with its own lamp
const dense = Array.from({ length: 30 }, (_, i) => lamp(`d${i}`, String(i + 1), 1000 + (i % 6) * 60, 3000 + Math.floor(i / 6) * 60));
const denseSheet = magicLayout(dense, frame, opts);
assert.equal(denseSheet.channels, 30);
assert.equal(denseSheet.systems, 1);
assert.equal(denseSheet.drawing.circles.length, 30);
assert.equal(overlapping(denseSheet.drawing.circles), 0, "dense 30 channels overlap");
const radius = denseSheet.drawing.circles[0]!.radius;
assert.ok(denseSheet.drawing.circles.every((c) => c.radius === radius), "one bubble size in a box");
assert.ok(denseSheet.drawing.circles.every((c) => Number.isFinite(c.center.x) && Number.isFinite(c.center.y)));

// every channel on one point: the spiral finds each its own clear spot
const stacked = Array.from({ length: 30 }, (_, i) => lamp(`s${i}`, String(i + 1), 2000, 3000));
const stackedSheet = magicLayout(stacked, frame, opts);
assert.equal(stackedSheet.drawing.circles.length, 30);
assert.equal(overlapping(stackedSheet.drawing.circles), 0, "stacked channels overlap");

// a channel shared by two lights: one bubble, at the mean of their two points (A at 0, B at 2000, C at 1000 twice)
const shared = magicLayout(
  [lamp("a", "A", 0, 3000), lamp("b", "B", 2000, 3000), lamp("c1", "C", 1000, 3000), lamp("c2", "C", 1000, 3000)],
  frame,
  opts,
);
assert.equal(shared.drawing.circles.length, 3, "a shared channel gets one bubble");
const centre = (label: string) => shared.drawing.texts.find((t) => t.text === label)!.at;
const bubbleOf = (label: string) => shared.drawing.circles.find((c) => Math.hypot(c.center.x - centre(label).x, c.center.y - centre(label).y) < 1e-6)!;
assert.ok(bubbleOf("C"));
const mid = (centre("A").x + centre("B").x) / 2;
assert.ok(Math.abs(centre("C").x - mid) < 1e-6, `C at ${centre("C").x}, midway is ${mid}`);
assert.ok(Math.abs(centre("B").x - centre("A").x - 72) < 1e-6, "72 mm of map between A and B");

// grouping: purpose and colour make three systems here; colour alone makes two; position makes one
const mixed = [
  lamp("k1", "1", 0, 3000, { purpose: "Key", color: "L201" }),
  lamp("k2", "2", 500, 3000, { purpose: "Key", color: "L201" }),
  lamp("k3", "3", 1000, 3000, { purpose: "Key", color: "L120" }),
  lamp("f1", "4", 1500, 3000, { purpose: "", color: "R80" }),
  lamp("o1", "5", 2000, 3000, { purpose: "", color: "" }),
];
const byPC = magicLayout(mixed, frame, { ...opts, group: "purposeColour" });
assert.equal(byPC.systems, 4, "Key L201, Key L120, R80 and Other");
assert.equal(byPC.chips.length, 3, "a chip for each system with a colour");
const byColour = magicLayout(mixed, frame, { ...opts, group: "colour" });
assert.equal(byColour.systems, 4, "L201, L120, R80 and Other");
const byPosition = magicLayout(mixed, frame, { ...opts, group: "position" });
assert.equal(byPosition.systems, 1, "all on 1st Electric");

// a light with no channel has no bubble and is counted
const withBlank = magicLayout([...dense.slice(0, 3), lamp("x", "", 0, 3000)], frame, opts);
assert.equal(withBlank.unchanneled, 1);
assert.equal(withBlank.channels, 3);
assert.equal(withBlank.drawing.circles.length, 3);

// nothing on a channel: an empty sheet, for the caller to say so
const none = magicLayout([lamp("n", "", 0, 3000)], frame, opts);
assert.equal(none.channels, 0);
assert.equal(none.drawing.circles.length, 0);

// a row wraps at the page width: boxes past 400 mm go to the next row, so their titles sit lower
const many = Array.from({ length: 12 }, (_, i) => lamp(`m${i}`, String(i + 1), i * 10, 3000, { purpose: `Look ${i}`, color: "" }));
const rows = magicLayout(many, frame, { ...opts, pageMm: 200 });
const titleYs = [...new Set(rows.drawing.texts.filter((t) => t.text.startsWith("Look")).map((t) => t.at.y))];
assert.ok(titleYs.length > 1, "boxes wrap to more than one row");

console.log("magicSheet.check: all checks pass");
