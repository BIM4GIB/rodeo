// npx tsx src/features/theatre/connectcad/cableLengthShapes.check.ts
import { alongRacks, cableLength, gapBetween, SIDE_BY_SIDE, type RackFoot } from "./cableLengthShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-6;

/** a 600 x 900 rack whose front's middle is at x, y, facing -y */
const rack = (id: string, x: number, y = 0): RackFoot => ({
  id,
  ring: [
    { x: x - 300, y },
    { x: x + 300, y },
    { x: x + 300, y: y + 900 },
    { x: x - 300, y: y + 900 },
  ],
  middle: { x, y: y + 450 },
});

// outlines
const [a, b] = [rack("A", 0), rack("B", 600)];
ok(gapBetween(a.ring, b.ring) === 0, "racks touching");
ok(near(gapBetween(a.ring, rack("C", 650).ring), 50), "a 50 mm gap");
ok(gapBetween(a.ring, rack("D", 300).ring) === 0, "overlapping");
ok(near(gapBetween(a.ring, rack("E", 0, 1000).ring), 100), "one behind another");

// a row of three, one 50 mm apart, one well away
const row = [rack("A", 0), rack("B", 600), rack("C", 1250), rack("FAR", 5000)];
ok(near(alongRacks(row, "A", "A"), 0), "the same rack");
ok(near(alongRacks(row, "A", "B"), 600), "next door, middle to middle");
ok(near(alongRacks(row, "A", "C"), 1250), "through the rack between, the gap under SIDE_BY_SIDE");
ok(alongRacks(row, "A", "FAR") === null, "a rack away from the row");
ok(alongRacks(row, "A", "C", 10) === null, "a gap wider than asked for breaks the row");
ok(alongRacks(row, "A", "NONE") === null, "a rack that isn't there");
ok(SIDE_BY_SIDE >= 50, "small gaps count");
// round a corner: the way goes through the corner rack, not straight across
const corner = [rack("A", 0), rack("B", 600), { id: "C", ring: [{ x: 900, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: -600 }, { x: 900, y: -600 }], middle: { x: 1350, y: -300 } }];
const way = alongRacks(corner, "A", "C");
ok(near(way, 600 + Math.hypot(750, 750)), `round a corner (${way})`);

// lengths
const o = { swanNeck: 300, tail: 500, floor: 400 };
ok(near(cableLength({ rack: "A", height: 1800, panel: false }, { rack: "A", height: 600, panel: false }, 0, o), 1200 + 1000), "in one rack: the height between, a tail at each end");
ok(near(cableLength({ rack: "A", height: 1800, panel: true }, { rack: "A", height: 600, panel: false }, 0, o), 1200 + 800), "a swan-neck at a patch panel");
ok(near(cableLength({ rack: "A", height: 1800, panel: false }, { rack: "B", height: 600, panel: true }, 1200, o), 1800 + 600 + 800 + 1200 + 800), "racks side by side: down, under, along, up");
ok(cableLength({ rack: "A", height: 1, panel: false }, { rack: "B", height: 1, panel: false }, null, o) === null, "racks not side by side");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
