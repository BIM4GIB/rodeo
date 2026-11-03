// Run with: npx tsx src/app/retainingShapes.check.ts
import assert from "node:assert/strict";
import { carriedHeights, chainRuns, heightBy, movedPart, partHeight, retainingBand, thinRun, withVertexHeight, type RetainingOptions, type RetainingVertex, type RunSource } from "./retainingShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const run = (ax: number, ay: number, bx: number, by: number, top = 3000): RunSource => ({ start: { x: ax, y: ay }, end: { x: bx, y: by }, top, bottom: 0, thickness: 200 });

// one wall as it was drawn
{
  const r = chainRuns([run(0, 0, 5000, 0)]);
  assert.ok(r);
  assert.deepEqual(r.line, [{ x: 0, y: 0 }, { x: 5000, y: 0 }]);
  assert.deepEqual(r.tops, [3000, 3000]);
  assert.equal(r.width, 200);
}

// walls out of order and against each other, going the way the first goes, their corner the middle of a small gap
{
  const r = chainRuns([run(5000, 0, 5000, 4000, 2000), run(9000, 4100, 5050, 4050), run(-3000, 0, 4950, 0, 4000)]);
  assert.ok(r);
  assert.equal(r.line.length, 4);
  assert.deepEqual(r.line[0], { x: -3000, y: 0 });
  assert.deepEqual(r.line[1], { x: 4975, y: 0 });
  assert.deepEqual(r.line[3], { x: 9000, y: 4100 });
  assert.deepEqual(r.tops, [4000, 3000, 2500, 3000]);
}

// walls that don't connect
assert.equal(chainRuns([run(0, 0, 1000, 0), run(5000, 0, 6000, 0)]), null);
assert.equal(chainRuns([]), null);

// an extrude: the long way along its box, however it's turned
{
  const c = Math.SQRT1_2;
  const rot = (x: number, y: number): { x: number; y: number } => ({ x: x * c - y * c, y: x * c + y * c });
  const r = thinRun([rot(0, 0), rot(4000, 0), rot(4000, 300), rot(0, 300), rot(2000, 150)], 2500, 100);
  assert.ok(r);
  near(r.thickness, 300, 1e-6);
  near(Math.hypot(r.end.x - r.start.x, r.end.y - r.start.y), 4000, 1e-6);
  assert.equal(r.top, 2500);
  assert.equal(r.bottom, 100);
  assert.equal(thinRun([{ x: 0, y: 0 }, { x: 10, y: 10 }], 1, 0), null);
}

assert.equal(heightBy("top", 100, 3000, 0, 500), 2900);
assert.equal(heightBy("bottom", 100, 3000, 0, 500), 100);
assert.equal(heightBy("terrain", 100, 3000, 0, 500), 500);
assert.equal(heightBy("terrain", 100, 3000, 50, null), 50);

const v: RetainingVertex[] = [{ x: 0, y: 0, left: 3000, right: 1000, pad: 0 }, { x: 10000, y: 0, left: 3500, right: 1500, pad: 200 }];
const all: RetainingOptions = { width: 200, left: true, right: true, start: true, end: true, padOffset: 0 };
const zAt = (samples: readonly (readonly number[])[], x: number, y: number): number | undefined => samples.find((q) => Math.abs(q[0] - x) < 1 && Math.abs(q[1] - y) < 1)?.[2];

// each edge holds its heights; left is left of the way it runs
{
  const b = retainingBand(v, all);
  assert.ok(b);
  assert.equal(zAt(b.samples, 0, 100), 3000);
  assert.equal(zAt(b.samples, 0, -100), 1000);
  assert.equal(zAt(b.samples, 10000, 100), 3500);
  assert.equal(zAt(b.samples, 10000, -100), 1500);
  assert.equal(zAt(b.samples, 5000, 0), 100);
  // close enough along to hold it
  assert.ok(b.samples.length >= 150);
  assert.equal(b.ring.length, 4);
  // across its end, half way up from the pad
  assert.equal(zAt(b.samples, 0, 50), 1500);
}

// a side left out isn't touched, and its side of the band all but goes
{
  const b = retainingBand(v, { ...all, left: false });
  assert.ok(b);
  assert.equal(zAt(b.samples, 0, 100), undefined);
  assert.ok(Math.max(...b.ring.map((p) => p.y)) < 5);
  assert.equal(zAt(b.samples, 0, -100), 1000);
}

// no end edge: the pad stops short at that end only
{
  const b = retainingBand(v, { ...all, end: false });
  assert.ok(b);
  assert.equal(zAt(b.samples, 0, 0), 0);
  assert.equal(zAt(b.samples, 10000, 0), undefined);
  assert.equal(zAt(b.samples, 10000, 100), 3500);
}

// the pad's offset
assert.equal(zAt(retainingBand(v, { ...all, padOffset: 300 })?.samples ?? [], 0, 0), 300);

// nothing for no length or no width
assert.equal(retainingBand([v[0], { ...v[0] }], all), null);
assert.equal(retainingBand(v, { ...all, width: 0 }), null);

// moving parts
assert.equal(partHeight(v, "Left Edge"), 3000);
assert.equal(partHeight(v, "End Edge"), 3500);
assert.deepEqual(movedPart(v, "Left Edge", 2000).map((q) => q.left), [2000, 2500]);
assert.deepEqual(movedPart(v, "Left Edge", 2000).map((q) => q.right), [1000, 1500]);
{
  const m = movedPart(v, "End Edge", 3000);
  assert.deepEqual([m[1].left, m[1].right], [3000, 1000]);
  assert.deepEqual(m[0], v[0]);
}
assert.deepEqual(withVertexHeight(v, "Right Edge", 1, 777).map((q) => q.right), [1000, 777]);
assert.deepEqual(withVertexHeight(v, "Start Edge", 1, 777), v);

// reshaping keeps heights, by order or where a new corner falls
{
  assert.equal(carriedHeights(v, [{ x: 0, y: 1000 }, { x: 10000, y: 1000 }])[1].left, 3500);
  const added = carriedHeights(v, [{ x: 0, y: 0 }, { x: 5000, y: 2000 }, { x: 10000, y: 0 }]);
  assert.equal(added.length, 3);
  assert.equal(added[1].left, 3250);
  assert.equal(added[1].pad, 100);
  assert.equal(added[1].y, 2000);
}

console.log("retainingShapes ok");
