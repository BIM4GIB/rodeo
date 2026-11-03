// Run with: npx tsx src/app/siteGrading.check.ts
import assert from "node:assert/strict";
import { balancedPad, hiddenFaces, hiddenOutlines, limitsAround, pointAtStation, readSlope, ringCrosses, sectionProfile, sectionStations, slopeText, stationsOf, triangleFigures, viewField, type ViewField } from "./siteGrading.ts";
import { heightLookup, modifierStep, proposedPoints, surfaceOf, cutAndFill, type Pt3, type SiteModifier } from "./siteModelShapes.ts";

const near = (a: number, b: number, by: number): void => assert.ok(Math.abs(a - b) <= by, `${a} vs ${b} (within ${by})`);

// slopes as typed
near(readSlope("50", "Percent") as number, 0.5, 1e-9);
near(readSlope("50%", "Percent") as number, 0.5, 1e-9);
near(readSlope("1:3", "Rise-over-run") as number, 1 / 3, 1e-9);
near(readSlope("0.25", "Rise-over-run") as number, 0.25, 1e-9);
near(readSlope("45", "Angular") as number, 1, 1e-9);
near(readSlope("45°", "Angular") as number, 1, 1e-9);
for (const bad of ["0", "-3", "abc", ""]) for (const m of ["Angular", "Percent", "Rise-over-run"] as const) assert.equal(readSlope(bad, m), null, `${bad} ${m}`);
assert.equal(readSlope("90", "Angular"), null);
assert.equal(readSlope("1:0", "Rise-over-run"), null);
assert.equal(slopeText(0.5, "Percent"), "50%");
assert.equal(slopeText(0.5, "Rise-over-run"), "1:2");
assert.equal(slopeText(1, "Angular"), "45°");

assert.equal(ringCrosses([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), false);
assert.equal(ringCrosses([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), true);

// a flat site 100 m across at height 0
const grid = (f: (x: number, y: number) => number, n = 40, size = 100000): Pt3[] => {
  const out: Pt3[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push([(size * i) / n, (size * j) / n, f((size * i) / n, (size * j) / n)]);
  return out;
};
const flat = surfaceOf(grid(() => 0));
assert.ok(flat);
const flatAt = heightLookup(flat);
const square = [{ x: 40000, y: 40000 }, { x: 60000, y: 40000 }, { x: 60000, y: 60000 }, { x: 40000, y: 60000 }];
const pad: SiteModifier = { kind: "pad", ring: square, elevation: 2000, slope: 0, slopeAngle: 0 };

// a fixed distance goes out that far, whichever way the pad was drawn
const fixed = limitsAround(pad, flatAt, { offset: 5000, slope: null, increment: null });
assert.ok(fixed);
assert.equal(fixed.length, 4);
near(fixed[0].x, 35000, 1e-6);
near(fixed[0].y, 35000, 1e-6);
near(fixed[2].x, 65000, 1e-6);
const back = limitsAround({ ...pad, ring: [...square].reverse() }, flatAt, { offset: 5000, slope: null, increment: null });
assert.ok(back);
near(back[0].x, 35000, 1e-6);
near(back[0].y, 65000, 1e-6);

// a batter of 1:2 from 2 m up meets flat ground 4 m out
const batter = limitsAround(pad, flatAt, { offset: 20000, slope: 0.5, increment: null });
assert.ok(batter);
near(batter[0].x, 36000, 40);
near(batter[2].y, 64000, 40);

// capped by Max. Offset
const capped = limitsAround(pad, flatAt, { offset: 1000, slope: 0.5, increment: null });
assert.ok(capped);
near(capped[0].x, 39000, 1e-6);

// midpoints add a point along each side at the increment
const mids = limitsAround(pad, flatAt, { offset: 20000, slope: 0.5, increment: 5000 });
assert.ok(mids);
assert.equal(mids.length, 16);
near(mids[1].y, 36000, 40);

// a ground rising to the east: the limit reaches further where the ground is further below the pad
const rise = surfaceOf(grid((x) => (x / 100000) * 8000));
assert.ok(rise);
const riseAt = heightLookup(rise);
const on = limitsAround({ ...pad, elevation: 2000 }, riseAt, { offset: 30000, slope: 0.5, increment: 5000 });
assert.ok(on);
assert.ok(!ringCrosses(on));

// off the edge of the site, it stops there
const edge = limitsAround({ ...pad, ring: square.map((p) => ({ x: p.x + 38000, y: p.y })) }, flatAt, { offset: 30000, slope: 0.5, increment: null });
assert.ok(edge);
assert.ok(edge[1].x <= 100000, `${edge[1].x}`);

// a pad inside limits on a plane: it comes to the plane's height in the middle, and cut and fill balance
const limit = [{ x: 20000, y: 20000 }, { x: 80000, y: 20000 }, { x: 80000, y: 80000 }, { x: 20000, y: 80000 }];
const step = modifierStep(rise);
const plane = balancedPad(limit, riseAt, [0.5, 0.5, 0.5, 0.5], step);
assert.ok(typeof plane !== "string", String(plane));
near(plane.elevation, 4000, 150);
near(plane.fill, plane.cut, Math.max(plane.cut, plane.fill) * 0.1);
assert.equal(plane.ring.length, 4);
assert.ok(plane.ring[0].x > 20000 && plane.ring[2].x < 80000);

// the proposed surface an update makes from it does balance
const proposed = surfaceOf(proposedPoints(rise, riseAt, [{ kind: "limits", ring: limit, elevation: 0, slope: 0, slopeAngle: 0 }, { kind: "pad", ring: plane.ring, elevation: plane.elevation, slope: 0, slopeAngle: 0 }]));
assert.ok(proposed);
const made = cutAndFill(riseAt, heightLookup(proposed), { x0: 0, y0: 0, x1: 100000, y1: 100000 });
near(made.cut, made.fill, Math.max(made.cut, made.fill) * 0.08);

// per side: a shallower side sets its side further back
const perSide = balancedPad(limit, riseAt, [0.5, 0.25, 0.5, 0.5], step);
assert.ok(typeof perSide !== "string");
const eastSteep = 80000 - plane.ring[2].x;
const eastShallow = 80000 - perSide.ring[2].x;
near(eastShallow, eastSteep * 2, eastSteep);

// too low a slope leaves no room; off the surface fails
assert.equal(balancedPad(limit, riseAt, [0.05, 0.05, 0.05, 0.05], step), "too low");
assert.equal(balancedPad(limit.map((p) => ({ x: p.x + 50000, y: p.y })), riseAt, [0.5, 0.5, 0.5, 0.5], step), "outside");

// on flat ground the pad fills the limits at the ground's height
const level = balancedPad(limit, flatAt, [0.5, 0.5, 0.5, 0.5], modifierStep(flat));
assert.ok(typeof level !== "string");
near(level.elevation, 0, 1);

// a section along a line
const line = [{ x: 0, y: 50000 }, { x: 50000, y: 50000 }, { x: 50000, y: 80000 }];
assert.deepEqual(stationsOf(line), [0, 50000, 80000]);
const profile = sectionProfile(line, riseAt);
near(profile[0].z as number, 0, 1);
near(profile[profile.length - 1].z as number, 4000, 1);
assert.equal(profile[profile.length - 1].station, 80000);
assert.ok(profile.every((p, i) => i === 0 || p.station > profile[i - 1].station));
assert.deepEqual(pointAtStation(line, 60000), { x: 50000, y: 60000 });
assert.deepEqual(pointAtStation(line, 0), { x: 0, y: 50000 });
assert.deepEqual(pointAtStation(line, 80000), { x: 50000, y: 80000 });
assert.deepEqual(sectionStations(line, false, null), [0, 80000]);
assert.deepEqual(sectionStations(line, true, null), [0, 50000, 80000]);
assert.deepEqual(sectionStations(line, true, 25000), [0, 25000, 50000, 75000, 80000]);
near(sectionProfile([{ x: 200000, y: 0 }, { x: 300000, y: 0 }], riseAt)[0].z ?? -1, -1, 0);

// triangle figures add up to the surface's: raising the ground by 1 m over everything fills 1 m × the area
const up = surfaceOf(grid(() => 1000));
assert.ok(up);
const rows = triangleFigures(up, flatAt, 0);
assert.equal(rows.length, up.triangles.length / 3);
near(rows.reduce((s, r) => s + r.projected, 0), 1e10, 1);
near(rows.reduce((s, r) => s + r.fill, 0), 1e13, 1e8);
near(rows.reduce((s, r) => s + r.cut, 0), 0, 1e-6);
near(rows.reduce((s, r) => s + r.existingVolume, 0), 0, 1e-6);
near(rows.reduce((s, r) => s + r.proposedVolume, 0), 1e13, 1e8);
const down = triangleFigures(flat, heightLookup(up), 0);
near(down.reduce((s, r) => s + r.cut, 0), 1e13, 1e8);
near(down.reduce((s, r) => s + r.existingVolume, 0), 1e13, 1e8);
assert.equal(rows[0].index, 1);

// the sloped surface's area is bigger than its plan
const sloped = triangleFigures(rise, riseAt, 0);
const planArea = sloped.reduce((s, r) => s + r.projected, 0);
const onSlope = sloped.reduce((s, r) => s + r.proposedArea, 0);
near(onSlope, planArea * Math.hypot(1, 0.08), planArea * 0.001);
near(sloped.reduce((s, r) => s + r.existingArea, 0), onSlope, planArea * 0.001);

// what can be seen: all of a plane, level or tilted, from above it
const viewBox = { x0: 0, y0: 0, x1: 100, y1: 50 };
for (const tilt of [0, 0.2]) {
  const plane = viewField((x) => x * tilt, viewBox, { x: 10, y: 25 }, 2) as ViewField;
  assert.equal(plane.hidden, 0);
  assert.equal(plane.seen, plane.across * plane.down);
}
// a ridge along x = 50: what's near its far side is hidden, what's on this side or on its top is seen
const ridge = (x: number): number => 10 * Math.max(0, 1 - Math.abs(x - 50) / 5);
const behind = viewField(ridge, viewBox, { x: 10, y: 25 }, 2) as ViewField;
const cellAt = (f: ViewField, x: number, y: number): number => f.cells[Math.floor((y - f.y0) / f.cell) * f.across + Math.floor((x - f.x0) / f.cell)];
assert.equal(cellAt(behind, 30, 25), 1);
assert.equal(cellAt(behind, 49.7, 25), 1);
assert.equal(cellAt(behind, 70, 25), 2);
// the line over the ridge's top keeps rising, so all the level ground past it stays hidden
assert.equal(cellAt(behind, 99, 25), 2);
// from high enough all of it is seen
const above = viewField(ridge, viewBox, { x: 10, y: 25 }, 200) as ViewField;
assert.equal(above.hidden, 0);
// off the surface
assert.equal(viewField(() => null, viewBox, { x: 10, y: 25 }, 2), null);
const edgeOnly = viewField((x) => (x > 50 ? null : 0), viewBox, { x: 10, y: 25 }, 2) as ViewField;
assert.equal(cellAt(edgeOnly, 75, 25), 0);
assert.equal(edgeOnly.hidden, 0);
// the hidden cells come out as outlines of the same area
const areaWithin = (ring: readonly { x: number; y: number }[]): number => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;
const hiddenArea = (f: ViewField): number => hiddenOutlines(f).reduce((sum, ring) => sum + areaWithin(ring), 0);
near(hiddenArea(behind), behind.hidden * behind.cell * behind.cell, 1e-6);
const mask = (...lines: string[]): ViewField => {
  const across = lines[0].length;
  const down = lines.length;
  const cells = new Uint8Array(across * down);
  lines.forEach((line, j) => [...line].forEach((c, i) => (cells[j * across + i] = c === "#" ? 2 : 1)));
  return { x0: 0, y0: 0, cell: 1, across, down, heights: new Float64Array((across + 1) * (down + 1)), cells, seen: 0, hidden: cells.filter((c) => c === 2).length };
};
// one block, a hole in one, two holes side by side, a hole in a hole's island, patches touching at a corner
for (const f of [
  mask("###", "###"),
  mask("#####", "#...#", "#####"),
  mask("#######", "#.#.#.#", "#######"),
  mask("#########", "#.......#", "#.#####.#", "#.#...#.#", "#.#####.#", "#.......#", "#########"),
  mask("##..", "##..", "..##", "..##"),
  mask("#.#", ".#.", "#.#"),
  mask("......", ".####.", ".#..#.", ".####.", "......"),
]) {
  const outlines = hiddenOutlines(f);
  near(hiddenArea(f), f.hidden, 1e-9);
  assert.ok(outlines.length >= 1);
}
assert.equal(hiddenOutlines(mask("###", "#.#", "###")).length, 1);
assert.equal(hiddenOutlines(mask("#.#", "...", "#.#")).length, 4);
assert.deepEqual(hiddenOutlines(mask("...")), []);
const faces = hiddenFaces(behind, 2, 0.5);
assert.ok(faces.length > 0);
near(faces.length * 4 * behind.cell * behind.cell, behind.hidden * behind.cell * behind.cell, behind.hidden * behind.cell * behind.cell * 0.1);
assert.equal(faces[0].length, 12);

console.log("siteGrading ok");
