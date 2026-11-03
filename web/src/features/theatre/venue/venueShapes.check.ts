// Checks for venueShapes.ts: run with `npx tsx src/features/theatre/venue/venueShapes.check.ts`.
// Hand figures (mm): a proscenium of 10 m opening, 14 m stage, 1.5 m apron, 2 m aisle, 900 mm rows of 14 seats
// at 500 mm: the first row sits 1.5 + 2.0 = 3.5 m into the house and spans 14 x 0.5 / 2 = 3.5 m either side of CL;
// the tenth row is 3.5 + 9 x 0.9 = 11.6 m out. The apron lip is an arc through (±5 m, 0) with its middle 1.5 m
// into the house: R = (5^2 + 1.5^2) / (2 x 1.5) = 9.0833 m. The back wall's door, 2.4 m wide at across -3.5 m,
// leaves a gap from -4.7 m to -2.3 m. The thrust has three blocks: 3 x 10 x 14 = 420 seats.

import assert from "node:assert/strict";
import { audienceOf, DEFAULT_VENUE, venueParts, type StageSketch, type VenueSpec } from "./venueShapes.ts";
import type { StagePoint } from "../stage.ts";

const LABEL = 350;
const near = (a: number, b: number, tol = 0.5): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const pros: VenueSpec = { ...DEFAULT_VENUE };
const withKind = (kind: VenueSpec["kind"], over: Partial<VenueSpec> = {}): VenueSpec => ({ ...DEFAULT_VENUE, kind, ...over });

// the proscenium's one block: 14 seats in each of 10 rows, first row 3.5 m into the house
const pb = audienceOf(pros).blocks;
assert.equal(pb.length, 1);
assert.equal(pb[0].rows * pb[0].seatsPerRow, 140);
near(pb[0].downMm, 3500);
const parts = venueParts(pros, LABEL);
const rowLines = parts.seating.lines;
assert.equal(rowLines.length, 10, "one line per row");
near(rowLines[0][0].across, 3500);
near(rowLines[0][1].across, -3500);
near(rowLines[0][0].up, -3500);
near(rowLines[9][0].up, -11600);
assert.ok(parts.seating.texts.some((t) => t.text === "Stalls: 140 seats"), "seat count written beside the block");

// the apron: a closed arc from the opening's edges, reaching 1.5 m into the house at its middle
const apron = parts.stage.outlines[0];
near(apron[0].across, -5000, 1e-6);
near(apron[0].up, 0, 1e-6);
near(apron.at(-1)!.across, 5000, 1e-6);
near(apron.at(-1)!.up, 0, 1e-6);
assert.equal(apron.length, 25, "24 segments");
const lowest = Math.min(...apron.map((q: StagePoint) => q.up));
near(lowest, -1500, 1e-6);
const sagitta = apron[12];
near(sagitta.across, 0, 1e-6);

// the proscenium wall: two thick pieces leaving the opening 10 m wide between their inner ends
const pieces = parts.walls.filled.filter((poly) => poly.every((q) => Math.abs(q.up) <= 150));
assert.equal(pieces.length, 2, "two pieces either side of the opening");
const inner = pieces.map((poly) => Math.min(...poly.map((q) => Math.abs(q.across))));
near(inner[0] + inner[1], 10000, 1e-6);

// the load-in door: the back wall is split with a gap from -4.7 m to -2.3 m
const backWall = parts.walls.filled.filter((poly) => poly.every((q) => q.up >= 10000 && q.up <= 10300));
assert.equal(backWall.length, 2, "back wall split by the door");
const gapLeft = Math.max(...backWall.map((poly) => Math.max(...poly.map((q) => q.across))).filter((a) => a < 0));
near(gapLeft, -4700, 1e-6);
const gapRight = Math.max(...backWall.map((poly) => Math.min(...poly.map((q) => q.across))));
near(gapRight, -2300, 1e-6);
assert.ok(parts.notes.texts.some((t) => t.text === "Load-in door"));
assert.ok(parts.notes.texts.some((t) => t.text === "Iron"));

// the thrust: three blocks of 140, 420 seats in all, the front one centred on CL
const th = audienceOf(withKind("thrust")).blocks;
assert.equal(th.length, 3);
assert.equal(th.reduce((n, b) => n + b.rows * b.seatsPerRow, 0), 420);
const thrust = venueParts(withKind("thrust"), LABEL);
assert.ok(thrust.seating.texts.some((t) => t.text === "Front: 140 seats"));
assert.equal(thrust.seating.lines.length, 30, "three blocks of ten rows");

// the arena: four blocks round a centre stage of 5 m up, each curved about it, with four vomitory labels
const arena = withKind("arena");
const ab = audienceOf(arena).blocks;
assert.equal(ab.length, 4);
for (const b of ab) near(b.curveUpMm, 5000);
const ap = venueParts(arena, LABEL);
assert.equal(ap.notes.texts.filter((t) => t.text === "Vomitory").length, 4);

// the black box: two blocks side by side 0.5 m apart, at the far end of a 16 m house
const bb = audienceOf(withKind("blackbox")).blocks;
assert.equal(bb.length, 2);
near(bb[0].acrossMm, 4000);
near(bb[1].acrossMm, -4000);

// the traverse: rows in front (first at 2 m) and behind (far row at 10 + 2 + 8.1 = 20.1 m from PL)
const tv = audienceOf(withKind("traverse")).blocks;
assert.equal(tv.length, 2);
near(tv[0].downMm, 2000);
near(tv[1].downMm, -20100);
const tvParts = venueParts(withKind("traverse"), LABEL);
assert.equal(tvParts.seating.lines.length, 20, "ten rows each side");

// every kind draws walls, a stage and labels STAGE and HOUSE
for (const kind of ["proscenium", "thrust", "arena", "blackbox", "traverse"] as const) {
  const d = venueParts(withKind(kind), LABEL);
  const texts = (s: StageSketch) => s.texts.map((t) => t.text);
  assert.ok(texts(d.notes).includes("STAGE") && texts(d.notes).includes("HOUSE"), `${kind} labels`);
  assert.ok(d.walls.filled.length >= 4, `${kind} walls`);
  assert.ok(d.stage.outlines.length >= 1, `${kind} stage`);
}

console.log("venueShapes checks passed");
