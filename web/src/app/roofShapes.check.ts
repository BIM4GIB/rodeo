// Node check of Create Roof's geometry. Run from web/: npx tsx src/app/roofShapes.check.ts

import assert from "node:assert/strict";
import type { Pt } from "../core/index.ts";
import { bearingHeightFor, buildRoof, doubleCutHorizontal, doubleCutVertical, eaveHeightFor, overhangFor, pitchFor, roofOutline, roofProblem, type EaveProfile, type RoofSpec } from "./roofShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const rad = (d: number): number => (d * Math.PI) / 180;

function spec(outline: readonly Pt[], over: Partial<RoofSpec> = {}): RoofSpec {
  return { outline: roofOutline(outline), gables: new Set(), eave: "vertical", vertical: 50, thickness: 200, bearingInset: 0, pitch: rad(30), bearingHeight: 3000, overhang: 0, gableWall: 0, ...over };
}

/** The volume a closed mesh holds, its faces facing out. */
function volume(solid: readonly number[][]): number {
  let v = 0;
  for (const f of solid) {
    for (let i = 3; i + 5 < f.length; i += 3) {
      const [ax, ay, az] = [f[0], f[1], f[2]];
      const [bx, by, bz] = [f[i], f[i + 1], f[i + 2]];
      const [cx, cy, cz] = [f[i + 3], f[i + 4], f[i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
}

function area(pts: readonly Pt[]): number {
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}

function heights(solid: readonly number[][]): { low: number; high: number } {
  const z = solid.flatMap((f) => f.filter((_, i) => i % 3 === 2));
  return { low: Math.min(...z), high: Math.max(...z) };
}

const rect = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 10000, y: 0 },
  { x: 10000, y: 4000 },
  { x: 6000, y: 4000 },
  { x: 6000, y: 10000 },
  { x: 0, y: 10000 },
];
const T: Pt[] = [
  { x: 0, y: 0 },
  { x: 12000, y: 0 },
  { x: 12000, y: 4000 },
  { x: 8000, y: 4000 },
  { x: 8000, y: 9000 },
  { x: 4000, y: 9000 },
  { x: 4000, y: 4000 },
  { x: 0, y: 4000 },
];
const U: Pt[] = [
  { x: 0, y: 0 },
  { x: 12000, y: 0 },
  { x: 12000, y: 9000 },
  { x: 8000, y: 9000 },
  { x: 8000, y: 3000 },
  { x: 4000, y: 3000 },
  { x: 4000, y: 9000 },
  { x: 0, y: 9000 },
];
const skew: Pt[] = [
  { x: 0, y: 0 },
  { x: 9000, y: 1000 },
  { x: 11000, y: 6000 },
  { x: 7000, y: 4500 },
  { x: 5000, y: 9000 },
  { x: -1000, y: 7000 },
];

// A hip roof on a rectangle: the ridge runs along the middle, shorter by the width
{
  const r = buildRoof(spec(rect(10000, 6000)))!;
  assert.ok(r);
  near(area(r.eaves), 60_000_000);
  const ridge = r.lines.filter(([a, b]) => Math.abs(a.y - 3000) < 1e-3 && Math.abs(b.y - 3000) < 1e-3);
  assert.equal(ridge.length, 1);
  near(Math.abs(ridge[0][0].x - ridge[0][1].x), 4000, 1e-3);
  assert.equal(r.lines.length, 5);
  // the eave's lowest point, and the ridge a half width up the slope above the eave edge's top
  const plumb = 200 / Math.cos(rad(30));
  const { low, high } = heights(r.solid);
  near(low, eaveHeightFor(spec(rect(1, 1)), rad(30), 3000, 0));
  near(high, low + plumb + 3000 * Math.tan(rad(30)));
}

// The solid is closed and holds the plan's area times the plumb thickness, whatever the plan's shape
for (const [name, outline] of Object.entries({ rect: rect(10000, 6000), L, T, U, skew })) {
  for (const overhang of [0, 300]) {
    const s = spec(outline, { overhang });
    const r = buildRoof(s);
    assert.ok(r, `${name} builds`);
    const expected = (area(r.eaves) * 200) / Math.cos(rad(30));
    near(volume(r.solid) / expected, 1, 1e-6);
  }
}

// An L's valley, from its inward corner toward the ridges
{
  const r = buildRoof(spec(L))!;
  const valley = r.lines.find(([a, b]) => [a, b].some((p) => Math.hypot(p.x - 6000, p.y - 4000) < 1e-3));
  assert.ok(valley, "the valley starts at the inward corner");
  const other = Math.hypot(valley[0].x - 6000, valley[0].y - 4000) < 1e-3 ? valley[1] : valley[0];
  near(6000 - other.x, 4000 - other.y, 1e-3);
}

// The other cuts keep the surface and change how the eave closes; each eave's lowest point is the Eave Height
for (const eave of ["square", "vertical", "horizontal", "double"] as EaveProfile[]) {
  const s = spec(rect(10000, 6000), { eave, overhang: 400, bearingInset: 100 });
  const r = buildRoof(s)!;
  assert.ok(r, eave);
  const low = heights(r.solid).low;
  near(low, eaveHeightFor(s, s.pitch, s.bearingHeight, s.overhang), 1e-6);
  assert.ok(volume(r.solid) > 0, `${eave} faces out`);
  // the underside over the bearing line is the Bearing Height
  near(bearingHeightFor(s, s.pitch, low, s.overhang), 3000, 1e-6);
}

// Any of the four levels follows from the other three
{
  for (const eave of ["square", "vertical", "horizontal", "double"] as EaveProfile[]) {
    const s = { eave, vertical: 50, thickness: 200, bearingInset: 100 };
    const e = eaveHeightFor(s, rad(35), 2800, 450);
    near(bearingHeightFor(s, rad(35), e, 450), 2800);
    near(overhangFor(s, rad(35), e, 2800)!, 450);
    near(pitchFor(s, e, 2800, 450)!, rad(35), 1e-6);
  }
  const s = { eave: "double" as const, vertical: 100, thickness: 200, bearingInset: 0 };
  near(doubleCutVertical(s, rad(30), doubleCutHorizontal(s, rad(30))), 100);
}

// A gable: one hip less, the slopes running to the gable edge, and its side closed
{
  const s = spec(rect(10000, 6000), { gables: new Set([1, 3]) });
  const r = buildRoof(s)!;
  assert.ok(r);
  // nothing but the ridge inside
  assert.equal(r.lines.length, 1);
  near(Math.abs(r.lines[0][0].x - r.lines[0][1].x), 10000, 1e-3);
  near(volume(r.solid) / ((60_000_000 * 200) / Math.cos(rad(30))), 1, 1e-6);
  const one = buildRoof(spec(rect(10000, 6000), { gables: new Set([1]) }))!;
  assert.equal(one.lines.length, 3);
  near(volume(one.solid) / ((60_000_000 * 200) / Math.cos(rad(30))), 1, 1e-6);
  // a gable's wall is added: a triangle on the wall line, up to the underside
  const walled = spec(rect(10000, 6000), { gables: new Set([1]), gableWall: 100 });
  const w = buildRoof(walled)!;
  const rise = 3000 * Math.tan(rad(30));
  near(volume(w.solid) - volume(one.solid), (6000 * rise * 100) / 2, 1);
}

// Refusals
{
  assert.ok(roofProblem(spec(rect(1000, 1000), { pitch: 0 })));
  assert.ok(roofProblem(spec(rect(1000, 1000), { thickness: 0 })));
  assert.ok(roofProblem(spec(rect(1000, 1000), { gables: new Set([0, 1, 2, 3]) })));
  assert.equal(buildRoof(spec(rect(1000, 1000), { pitch: 0 })), null);
  // an overhang past a short edge in an inward notch can't be drawn
  const notch: Pt[] = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 3000 },
    { x: 3100, y: 3000 },
    { x: 3100, y: 2000 },
    { x: 2900, y: 2000 },
    { x: 2900, y: 3000 },
    { x: 0, y: 3000 },
  ];
  assert.equal(buildRoof(spec(notch, { overhang: 500 })), null);
  assert.ok(buildRoof(spec(notch)));
}

// A clockwise outline is turned round, and repeated and in-line points go
{
  const o = roofOutline([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 5 }, { x: 10, y: 0 }]);
  assert.equal(o.length, 4);
  assert.ok(buildRoof(spec(o)));
}

console.log("all checks passed");
