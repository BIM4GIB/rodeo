// Checks each show audit rule against a case worked by hand. Run from web/:
//   npx tsx src/features/theatre/docs/audit.check.ts
// The stage frame faces up the page, so across is the drawing's x and up its y. Lenses are 6000 mm high.
// The hand checks: 1/100 with 24 channels against 1/110 overlaps; 1/500 with 24 runs past 512; a flat of
// 3000 × 5000 mm goes through a 2400 × 4000 mm door carried lengthwise (its thickness to the 2400, its 3000 to
// the 4000), and one of 5000 × 6000 mm doesn't, as its 5000 mm side is over the 4000.

import assert from "node:assert/strict";
import type { Fixture } from "../fixture.ts";
import type { Lineset, PositionInfo, ShopPiece, VenueInfo } from "../showTypes.ts";
import { auditShow, nameOf, type AuditInput, type Finding, type ScenicPiece } from "./audit.ts";

const frame = { x: 0, y: 0, upDeg: 90 };

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
  unit: "3",
  channel: "21",
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
  // a focus 4300 mm away on the plan and 4300 mm down: 45°, clear of the 30° rule
  focus: { x: 0, y: 2700, z: 1700 },
  aimDeg: -90,
};

const venue: VenueInfo = {
  kind: "proscenium",
  prosWidthMm: 12000,
  prosHeightMm: 7000,
  stageDepthMm: 10000,
  stageWidthMm: 12000,
  apronMm: 1500,
  gridHeightMm: 9000,
  ironUpMm: 0,
  doorWidthMm: 2400,
  doorHeightMm: 4000,
};

const noShow: AuditInput = {
  fixtures: [],
  frame,
  hasStageFrame: true,
  linesets: [],
  positions: [],
  venue,
  shop: [],
  pieces: [],
};

/** the findings of `input`, with the rest of the show as clean as it can be (venue set, origin set) */
function audit(over: Partial<AuditInput>): Finding[] {
  return auditShow({ ...noShow, ...over });
}

/** the findings that say `text` */
function saying(list: readonly Finding[], text: string): Finding[] {
  return list.filter((f) => f.text.includes(text));
}

const fx = (id: string, over: Partial<Fixture> = {}): Fixture => ({ ...base, id, ...over });

// a clean show finds nothing (the stage origin, venue and everything else are in order)
assert.deepEqual(audit({ fixtures: [fx("clean")] }), []);

// Patch: overlapping ranges. 1/100 (24 channels, to 123) against 1/110 overlaps on 1/110 to 1/123.
const overlap = audit({ fixtures: [fx("a", { universe: 1, address: 100, footprint: 24 }), fx("b", { unit: "5", universe: 1, address: 110, footprint: 24 })] });
const clash = saying(overlap, "overlap on DMX 1/110 to 1/123");
assert.equal(clash.length, 1);
assert.equal(clash[0]!.severity, "error");
assert.deepEqual(clash[0]!.ids.sort(), ["a", "b"]);
assert.ok(clash[0]!.text.startsWith("Unit 3 @ 1st Electric and Unit 5 @ 1st Electric"));

// 1/100 with 24 and 1/124 with 24 sit side by side: no overlap
assert.equal(saying(audit({ fixtures: [fx("a", { universe: 1, address: 100, footprint: 24 }), fx("c", { universe: 1, address: 124, footprint: 24 })] }), "overlap").length, 0);
// the same address in another universe: no overlap
assert.equal(saying(audit({ fixtures: [fx("a", { universe: 1, address: 100, footprint: 24 }), fx("d", { universe: 2, address: 110, footprint: 24 })] }), "overlap").length, 0);

// Patch: past 512. 1/500 with 24 channels ends at 523; 1/489 with 24 ends at 512 exactly, which is fine.
const past = audit({ fixtures: [fx("p", { universe: 1, address: 500, footprint: 24 })] });
const pastOne = saying(past, "runs past channel 512");
assert.equal(pastOne.length, 1);
assert.equal(pastOne[0]!.severity, "error");
assert.equal(saying(audit({ fixtures: [fx("q", { universe: 1, address: 489, footprint: 24 })] }), "runs past").length, 0);

// Patch: no channel (warning), and channels with different colours (note)
const noChannel = audit({ fixtures: [fx("n", { channel: "" })] });
assert.equal(noChannel.filter((f) => f.severity === "warning" && f.text.includes("has no channel number")).length, 1);
const mixedColour = audit({ fixtures: [fx("m1", { channel: "7", color: "L201" }), fx("m2", { channel: "7", color: "R80", unit: "4" })] });
const colourNote = saying(mixedColour, "Channel 7 drives lights of different colours: L201 and R80");
assert.equal(colourNote.length, 1);
assert.equal(colourNote[0]!.severity, "note");
// one colour, or a blank beside a colour, is no clash
assert.equal(saying(audit({ fixtures: [fx("s1", { channel: "7", color: "L201" }), fx("s2", { channel: "7", color: "", unit: "4" })] }), "different colours").length, 0);

// Focus: no focus (warning)
const unfocused = audit({ fixtures: [fx("u", { focus: null })] });
assert.equal(saying(unfocused, "is not focused yet")[0]?.severity, "warning");

// Focus: throw under 30°. Focus 9000 mm away on the plan at a 4300 drop: 25.5° is flagged; 45° is not.
const flat = audit({ fixtures: [fx("f", { at: { x: 0, y: 12000 }, focus: { x: 0, y: 3000, z: 1700 } })] });
const flatOne = saying(flat, "throws at 26° above the horizontal");
assert.equal(flatOne.length, 1, "25.5° rounds to 26° in the words");
assert.equal(flatOne[0]!.severity, "warning");
assert.ok(flatOne[0]!.text.includes("under 30°"));
assert.equal(saying(audit({ fixtures: [fx("steep")] }), "above the horizontal").length, 0);

// Focus: above the lens (error): focus 1 m above a lens 6 m high is the beam pointing up
const up = audit({ fixtures: [fx("up", { focus: { x: 0, y: 2700, z: 7000 } })] });
const upOne = saying(up, "above its lens, so its beam points up");
assert.equal(upOne.length, 1);
assert.equal(upOne[0]!.severity, "error");
assert.ok(upOne[0]!.text.includes("1.00 m above its lens"));
// and it is not also called flat
assert.equal(saying(up, "above the horizontal").length, 0);

// Focus: outside the stage's width (note). Half of 12 m is 6 m; a focus 6.5 m stage left is outside.
const wide = audit({ fixtures: [fx("w", { focus: { x: 6500, y: 2700, z: 1700 }, at: { x: 6500, y: 7000 } })] });
const wideOne = saying(wide, "outside the 12.00 m stage");
assert.equal(wideOne.length, 1);
assert.equal(wideOne[0]!.severity, "note");
assert.ok(wideOne[0]!.text.startsWith("Unit 3 @ 1st Electric is focused 6.50 m SL"));
assert.equal(saying(audit({ fixtures: [fx("in", { focus: { x: 5900, y: 2700, z: 1700 }, at: { x: 5900, y: 7000 } })] }), "outside").length, 0);

// Rigging: a lineset over its capacity. Ten lights at 30 kg and 50 kg of other gear: 350 kg on a 300 kg lineset.
const lineset: Lineset = { id: "ls1", name: "1st Electric", upMm: 5000, battenMm: 1000, capacityKg: 300, inTrimMm: 5500, outTrimMm: 8000, kind: "electric", hung: "", weightKg: 50, clothMm: 0 };
const heavy = Array.from({ length: 10 }, (_, i) => fx(`h${i}`, { unit: String(i + 1), weightKg: 30 }));
const loadRed = audit({ fixtures: heavy, linesets: [lineset] });
const loadOne = saying(loadRed, "Lineset 1st Electric is loaded to 350 kg, over its 300 kg capacity");
assert.equal(loadOne.length, 1);
assert.equal(loadOne[0]!.severity, "error");
assert.equal(loadOne[0]!.ids.length, 10);
// eight lights at 30 kg and the 50 kg is 290 kg: within the 300 kg
assert.equal(saying(audit({ fixtures: heavy.slice(0, 8), linesets: [lineset] }), "is loaded to").length, 0);

// Rigging: a position over its rating: 7 lights at 30 kg is 210 kg against 200 kg
const position: PositionInfo = { name: "1st Electric", capacityKg: 200, lengthMm: 0, supportsMm: [], supportCapacityKg: 0 };
const posRed = audit({ fixtures: heavy.slice(0, 7), positions: [position] });
const posOne = saying(posRed, "Position 1st Electric carries 210 kg of lights, over its 200 kg rating");
assert.equal(posOne.length, 1);
assert.equal(posOne[0]!.severity, "error");

// Rigging: no position (note)
assert.equal(saying(audit({ fixtures: [fx("np", { position: "" })] }), "has no hanging position")[0]?.severity, "note");

// Rigging: lens above the grid (9 m grid): a lens at 9.5 m is flagged
assert.equal(saying(audit({ fixtures: [fx("g", { heightMm: 9500 })] }), "above the grid at 9.00 m")[0]?.severity, "error");

// Rigging: a lens under 2 m where people walk (on a stage of 12 m width and 10 m depth from 1.5 m apron)
assert.equal(saying(audit({ fixtures: [fx("low", { heightMm: 1800, at: { x: 0, y: 5000 } })] }), "under 2 m, where people walk")[0]?.severity, "warning");
// off the stage (beyond its width) it is not flagged
assert.equal(saying(audit({ fixtures: [fx("lowOff", { heightMm: 1800, at: { x: 7000, y: 5000 } })] }), "where people walk").length, 0);

// Scenery: a platform stands 800 mm: a guard rail (warning); 760 mm is at the rule, 700 mm is not over
const platform = (name: string, standMm: number): ShopPiece => ({ id: name, kind: "platform", name, widthMm: 2400, heightMm: 1200, standMm, count: 1 });
assert.equal(saying(audit({ shop: [platform("High deck", 800)] }), "guard rail")[0]?.severity, "warning");
assert.equal(saying(audit({ shop: [platform("Edge deck", 760)] }), "guard rail").length, 1);
assert.equal(saying(audit({ shop: [platform("Low deck", 700)] }), "guard rail").length, 0);

// Scenery: a flat 5000 × 6000 through a 2400 × 4000 door: its thickness fits, but its 5000 mm side is over the 4000
const flatPiece: ShopPiece = { id: "cyc", kind: "flat", name: "Cyc wall", widthMm: 5000, heightMm: 6000, standMm: 0, count: 1 };
const door = audit({ shop: [flatPiece] });
const doorOne = saying(door, "won't go through the 2.40 m × 4.00 m door");
assert.equal(doorOne.length, 1);
assert.equal(doorOne[0]!.severity, "error");
assert.ok(doorOne[0]!.text.endsWith("Split it across its 5.00 m side."), doorOne[0]!.text);
// a flat 3000 × 5000 goes through carried lengthwise: thickness to the 2400, 3000 to the 4000, 5000 along
assert.equal(saying(audit({ shop: [{ ...flatPiece, widthMm: 3000, heightMm: 5000 }] }), "door").length, 0);
// which side is called the width makes no difference
assert.equal(saying(audit({ shop: [{ ...flatPiece, widthMm: 5000, heightMm: 3000 }] }), "door").length, 0);
// a platform 3000 × 5000 standing 2600: its least side is over the door's 2400, its 3000 fits the 4000
const tall: ShopPiece = { ...flatPiece, kind: "platform", widthMm: 3000, heightMm: 5000, standMm: 2600 };
assert.ok(saying(audit({ shop: [tall] }), "door")[0]!.text.endsWith("Split it across its 2.60 m side."));
// a platform 5000 × 6000 standing 2600 is over on both
assert.ok(saying(audit({ shop: [{ ...tall, widthMm: 5000, heightMm: 6000 }] }), "door")[0]!.text.endsWith("Split it across its 2.60 m and 5.00 m sides."));
// a platform 2400 × 1200 standing 800 goes through either way up
assert.equal(saying(audit({ shop: [{ ...tall, widthMm: 2400, heightMm: 1200, standMm: 800 }] }), "door").length, 0);

// Venue: the stage origin (note), and no venue (note)
assert.equal(saying(audit({ hasStageFrame: false }), "stage origin isn't set")[0]?.severity, "note");
assert.equal(saying(auditShow({ ...noShow, venue: null, fixtures: [] }), "No venue is set")[0]?.severity, "note");
// with no venue, the stage checks are skipped, so a flat is not measured against a door
assert.equal(saying(auditShow({ ...noShow, venue: null, shop: [flatPiece] }), "won't go through").length, 0);

// Venue: an instrument across the iron line (the iron 3 m upstage): body 2.85 to 3.35 m crosses it: an error
const ironVenue: VenueInfo = { ...venue, ironUpMm: 3000 };
const crossing = audit({ venue: ironVenue, fixtures: [fx("iron", { at: { x: 0, y: 3100 }, focus: null })] });
assert.equal(saying(crossing, "stands across the iron line in plan")[0]?.severity, "error");
// clear of it: 2000 mm, body 1.75 to 2.25 m
assert.equal(saying(audit({ venue: ironVenue, fixtures: [fx("clear", { at: { x: 0, y: 2000 }, focus: null })] }), "iron").length, 0);
// a scenic piece over the iron line: 2.8 m to 3.2 m
const piece: ScenicPiece = { id: "wall", name: "Back wall", x0: -500, y0: 2800, w: 1000, h: 400 };
const pieceCross = audit({ venue: ironVenue, pieces: [piece] });
assert.equal(saying(pieceCross, "Back wall crosses the iron line in plan")[0]?.severity, "error");

// Data: lights imported from Vectorworks (grouped once)
const imported = audit({ fixtures: [fx("v1", { native: false }), fx("v2", { native: false, unit: "9" }), fx("ok")] });
const importedNote = saying(imported, "2 lights imported from Vectorworks");
assert.equal(importedNote.length, 1);
assert.deepEqual(importedNote[0]!.ids, ["v1", "v2"]);

// the naming: unit and position, with the type and channel where there is neither
assert.equal(nameOf({ unit: "3", position: "1st Electric", label: "Profile 26°", channel: "21" }), "Unit 3 @ 1st Electric");
assert.equal(nameOf({ unit: "", position: "", label: "Profile 26°", channel: "21" }), "Profile 26° on channel 21");

// every finding's area is one of the six
const every = audit({ fixtures: [fx("all", { focus: null, channel: "", position: "" })] });
for (const f of every) assert.ok(["Patch", "Focus", "Rigging", "Scenery", "Venue", "Data"].includes(f.area), f.area);

console.log("audit.check: all checks pass");
