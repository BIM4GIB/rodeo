// Checks for section.ts: run with `npx tsx src/features/theatre/venue/section.check.ts`.
// Hand figures (mm), with the stage frame as the drawing's (up = the drawing's y):
// Beam cut-off: a lens at up 2000 and 6000 high, focused at up 1000 and 1700 high, with a 18° field: the axis
// runs at atan2(-4300, -1000) = -103.1° and the cone's edges at -94.1° and -112.1° (9° either side). A border at up
// 1500 is crossed by the cone between the floor (0) and about 4770 high, so a cloth from 3200 to 4000 is cut off
// and one from 5200 to 6000 (above the cone there) is not.
// Front-row visibility: a 1.1 m eye at 3.5 m into the house, sighting over a 6 m proscenium top, climbs
// (6000 - 1100) / 3500 = 1.4 on the way; at up 2000 it passes 1100 + 5500 x 1.4 = 8800 high. A lens at 6000 is
// below that, so the front row sees it; at 9000 it is above, so it doesn't.

import assert from "node:assert/strict";
import type { Audience, Lineset, VenueInfo } from "../showTypes.ts";
import type { Fixture } from "../fixture.ts";
import { DEFAULT_STAGE } from "../stage.ts";
import { lightingSection, type SectionInput } from "./section.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const venue: VenueInfo = {
  kind: "proscenium",
  prosWidthMm: 10000,
  prosHeightMm: 6000,
  stageDepthMm: 10000,
  stageWidthMm: 14000,
  apronMm: 1500,
  gridHeightMm: 16000,
  ironUpMm: 300,
  doorWidthMm: 2400,
  doorHeightMm: 2400,
};
const audience: Audience = {
  blocks: [{ name: "Stalls", acrossMm: 0, downMm: 3500, rows: 10, seatsPerRow: 14, rowSpacingMm: 900, seatWidthMm: 500, curveUpMm: 0, eyeMm: 1100, riseMm: 120 }],
};
const fixture = (over: Partial<Fixture> & { at: { x: number; y: number } }): Fixture =>
  ({
    unit: "1",
    label: "Profile 26°",
    position: "1st Electric",
    heightMm: 6000,
    fieldDeg: 18,
    focus: { x: 0, y: 1000, z: 1700 },
    ...over,
  }) as unknown as Fixture;
const border = (name: string, upMm: number, inTrimMm: number, clothMm: number): Lineset => ({
  id: name,
  name,
  upMm,
  battenMm: 12000,
  capacityKg: 0,
  inTrimMm,
  outTrimMm: 13000,
  kind: "border",
  hung: "",
  weightKg: 0,
  clothMm,
});
const input = (over: Partial<SectionInput>): SectionInput => ({
  venue,
  audience,
  linesets: [],
  fixtures: [],
  frame: DEFAULT_STAGE,
  labelMm: 350,
  scale: 48,
  format: (mm) => `${(mm / 1000).toFixed(1)} m`,
  ...over,
});

// the beam cut-off case: the cloth 3.2 to 4.0 m is cut, 5.2 to 6.0 m is above the cone and not
const lens = fixture({ at: { x: 0, y: 2000 } });
const cut = lightingSection(input({ fixtures: [lens], linesets: [border("B1", 1500, 4000, 800)] }));
const cuts = (r: { flags: readonly string[] }) => r.flags.filter((f) => f.includes("cut off"));
assert.deepEqual(cuts(cut), ["Unit 1 (1st Electric): beam cut off by border B1"]);
const above = lightingSection(input({ fixtures: [lens], linesets: [border("B2", 1500, 6000, 800)] }));
assert.deepEqual(cuts(above), []);
// a border behind the lens is never in the beam
const behind = lightingSection(input({ fixtures: [lens], linesets: [border("B3", 2500, 4000, 800)] }));
assert.deepEqual(cuts(behind), []);
// an unfocused instrument has no beam and is counted
const unfocused = lightingSection(input({ fixtures: [fixture({ at: { x: 0, y: 2000 }, focus: null })] }));
assert.equal(unfocused.unfocused, 1);
assert.equal(unfocused.sketch.lines.length > 0, true);

// front-row visibility: a 6 m lens at 2 m upstage is seen; a 9 m one is above the sightline and is not
const seen = lightingSection(input({ fixtures: [fixture({ at: { x: 0, y: 2000 }, heightMm: 6000 })] }));
assert.ok(seen.flags.includes("Unit 1 (1st Electric): visible from the front row"), seen.flags.join(" | "));
const hidden = lightingSection(input({ fixtures: [fixture({ at: { x: 0, y: 2000 }, heightMm: 9000 })] }));
assert.ok(!hidden.flags.some((f) => f.includes("visible")), hidden.flags.join(" | "));

// the front row's sightline: from (-3500, 1100), climbing 1.4 to the back wall at 10.3 m: 1100 + 13800 x 1.4 = 20420
const sl = lightingSection(input({}));
const front = sl.sketch.lines.find((l) => l.length === 2 && Math.abs(l[0].x + 3500) < 1e-6 && Math.abs(l[0].y - 1100) < 1e-6);
assert.ok(front, "front sightline from the front row's eye");
near(front![1].x, 10300);
near(front![1].y, 20420, 1e-3);
assert.ok(sl.sketch.texts.some((t) => t.text === "Front row sightline"));

// the stage floor runs from the apron's edge (-1.5 m) to the back wall (10 m); the grid is at 16 m
const floor = sl.sketch.lines.find((l) => l.length === 2 && l[0].y === 0 && l[1].y === 0 && l[0].x === -1500);
assert.ok(floor, "stage floor from the apron edge");
near(floor![1].x, 10000);
assert.ok(sl.sketch.lines.some((l) => l.length === 2 && l[0].y === 16000 && l[1].y === 16000), "grid line at 16 m");
assert.ok(sl.sketch.texts.some((t) => t.text === "Lighting Section at CL"));
assert.ok(sl.sketch.texts.some((t) => t.text.startsWith("Scale 1:48")));

// a venue with no audience: no sightlines, no house floor, still a section
const bare = lightingSection(input({ audience: { blocks: [] } }));
assert.ok(!bare.sketch.texts.some((t) => t.text === "Front row sightline"));
assert.ok(bare.sketch.lines.length > 0);

console.log("section checks passed");
