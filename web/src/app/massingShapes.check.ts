// Run with: npx tsx src/app/massingShapes.check.ts
import assert from "node:assert/strict";
import { floorUsages, grossArea, limitsRing, massing, outlineArea, shadowRings, type MassingSpec } from "./massingShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const box = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }];
const spec: MassingSpec = { outline: box, base: 1000, height: 9000, floors: 3, pitched: true, eave: "square", slope: 30, overhang: 500, roofThickness: 200, drawFloors: true, slabThickness: 200, wallThickness: 200 };
const zs = (faces: readonly (readonly number[])[]): number[] => faces.flatMap((f) => f.filter((_, i) => i % 3 === 2));

near(outlineArea(box), 60000000);
near(grossArea(box, 3), 180000000);

// a pitched roof over walls to the eaves
{
  const m = massing(spec);
  assert.ok(m);
  near(Math.min(...zs(m.walls)), 1000);
  near(Math.max(...zs(m.walls)), 10000);
  assert.ok(Math.max(...zs(m.roof)) > 10000);
  assert.ok(m.lines.length >= 5);
  assert.equal(m.fellBack, false);
  near(Math.min(...m.eaves.map((p) => p.x)), -500, 1);
  near(Math.max(...m.eaves.map((p) => p.y)), 6500, 1);
  // three floors at each storey, within the walls
  const levels = [...new Set(zs(m.floors))].sort((a, b) => a - b);
  assert.deepEqual(levels, [1000, 1200, 4000, 4200, 7000, 7200]);
}

// flat: the overhang and thickness, with no ridge
{
  const m = massing({ ...spec, pitched: false });
  assert.ok(m);
  assert.equal(m.lines.length, 0);
  near(Math.max(...zs(m.roof)), 10200);
  near(Math.min(...zs(m.roof)), 10000);
  near(Math.min(...m.eaves.map((p) => p.x)), -500, 1);
}

// no floors; a clockwise outline too
{
  const m = massing({ ...spec, drawFloors: false, outline: [...box].reverse() });
  assert.ok(m);
  assert.equal(m.floors.length, 0);
  assert.ok(m.walls.length > 0);
}

// nothing without a height or an outline
assert.equal(massing({ ...spec, height: 0 }), null);
assert.equal(massing({ ...spec, outline: box.slice(0, 2) }), null);

// grade limits keep their distance all round, into an L's corner too and with its corners run either way
{
  const ell = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 15, y: 20 }, { x: 15, y: 40 }, { x: 0, y: 40 }];
  for (const ring of [ell, [...ell].reverse()]) {
    const out = limitsRing(ring, 5);
    assert.equal(out.length, 6);
    near(Math.min(...out.map((p) => p.x)), -5);
    near(Math.max(...out.map((p) => p.y)), 45);
    assert.ok(out.some((p) => Math.abs(p.x - 20) < 1e-6 && Math.abs(p.y - 25) < 1e-6), "the inside corner");
  }
}

// a shadow: each side's sweep, and the outline moved
{
  const rings = shadowRings(box, -100, -200);
  assert.equal(rings.length, 5);
  assert.deepEqual(rings[4][0], { x: -100, y: -200 });
  assert.deepEqual(rings[0][2], { x: 9900, y: -200 });
}

// usage: one for each floor, kept when there are fewer
assert.deepEqual(floorUsages("", 2), ["Unspecified", "Unspecified"]);
assert.deepEqual(floorUsages("Retail; Office", 3), ["Retail", "Office", "Unspecified"]);
assert.deepEqual(floorUsages("Retail;Office;Flats", 1), ["Retail"]);

console.log("massingShapes ok");
