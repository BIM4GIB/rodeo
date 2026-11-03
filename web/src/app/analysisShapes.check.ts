// Run with: npx tsx src/app/analysisShapes.check.ts
import assert from "node:assert";
import { circlePoints, closest, curveBend, curveCrossings, curvesMeet, meshCrossing, surfaceBend, surfaceData, tooMany, type Thing } from "./analysisShapes.ts";
import type { Point } from "./extractShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const nearPoint = (a: readonly number[], b: readonly number[], tol = 1e-6): void => a.forEach((v, i) => near(v, b[i], tol));

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const quads = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return quads.flatMap(([a, b, c, d]) => [...p[a], ...p[b], ...p[c], ...p[a], ...p[c], ...p[d]]);
}

function cylinder(r: number, h: number, n = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [(2 * Math.PI * i) / n, (2 * Math.PI * (i + 1)) / n];
    const [p, q] = [[r * Math.cos(a), r * Math.sin(a)], [r * Math.cos(b), r * Math.sin(b)]];
    out.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], h, p[0], p[1], 0, q[0], q[1], h, p[0], p[1], h);
  }
  return out;
}

function sphere(r: number, inward = false, rows = 24, cols = 48): number[] {
  const out: number[] = [];
  const at = (i: number, j: number): number[] => {
    const [t, f] = [(Math.PI * i) / rows, (2 * Math.PI * j) / cols];
    return [r * Math.sin(t) * Math.cos(f), r * Math.sin(t) * Math.sin(f), r * Math.cos(t)];
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const [a, b, c, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (i > 0) out.push(...(inward ? [...a, ...d, ...b] : [...a, ...b, ...d]));
      if (i < rows - 1) out.push(...(inward ? [...b, ...d, ...c] : [...b, ...c, ...d]));
    }
  }
  return out;
}

const mesh = (tris: number[]): Thing => ({ kind: "mesh", tris });
const line = (...points: Point[]): Thing => ({ kind: "curve", points, closed: false });
const point = (p: Point): Thing => ({ kind: "point", point: p });

// ---- nearest ----
{
  // two boxes facing each other
  const n = closest(mesh(box(0, 0, 0, 1000, 1000, 1000)), mesh(box(1500, 200, 200, 2500, 800, 800)));
  near(n.distance, 500);
  near(n.a[0], 1000);
  near(n.b[0], 1500);
  // diagonal: corners
  const c = closest(mesh(box(0, 0, 0, 100, 100, 100)), mesh(box(400, 500, 100, 500, 600, 200)));
  near(c.distance, 500);
  nearPoint(c.a, [100, 100, 100]);
  nearPoint(c.b, [400, 500, 100]);
  // edge against edge, neither at a corner
  const e = closest(mesh(box(0, 0, 0, 100, 1000, 100)), mesh(box(200, 400, 150, 300, 500, 250)));
  near(e.distance, Math.hypot(100, 50));
  // a point over a face
  const f = closest(point([500, 500, 1300]), mesh(box(0, 0, 0, 1000, 1000, 1000)));
  near(f.distance, 300);
  nearPoint(f.b, [500, 500, 1000]);
  nearPoint(f.a, [500, 500, 1300]);
  // a point and a curve
  const g = closest(point([500, 700, 0]), line([0, 0, 0], [1000, 0, 0]));
  near(g.distance, 700);
  nearPoint(g.b, [500, 0, 0]);
  // two points
  near(closest(point([0, 0, 0]), point([3, 4, 0])).distance, 5);
  // skew lines
  const s = closest(line([0, 0, 0], [1000, 0, 0]), line([500, -500, 200], [500, 500, 200]));
  near(s.distance, 200);
  nearPoint(s.a, [500, 0, 0]);
  nearPoint(s.b, [500, 0, 200]);
  // a curve over a box
  near(closest(line([-100, 500, 1400], [1100, 500, 1400]), mesh(box(0, 0, 0, 1000, 1000, 1000))).distance, 400);
  // nothing is compared that would take too long
  assert.equal(tooMany(mesh(box(0, 0, 0, 1, 1, 1)), mesh(box(0, 0, 0, 1, 1, 1))), false);
}

// ---- crossings ----
{
  // two cubes overlapping corner to corner: one closed curve round where they meet
  const c = meshCrossing(box(0, 0, 0, 1000, 1000, 1000), box(500, 500, 500, 1500, 1500, 1500));
  assert.equal(c.length, 1);
  assert.equal(c[0].closed, true);
  let total = 0;
  const pts = c[0].points;
  for (let i = 0; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[(i + 1) % pts.length][0], pts[i][1] - pts[(i + 1) % pts.length][1], pts[i][2] - pts[(i + 1) % pts.length][2]);
  near(total, 3000, 1e-3);
  // boxes apart don't cross
  assert.equal(meshCrossing(box(0, 0, 0, 100, 100, 100), box(200, 0, 0, 300, 100, 100)).length, 0);
  // one through another: two loops
  assert.equal(meshCrossing(box(0, 0, 0, 1000, 1000, 1000), box(300, 300, -500, 700, 700, 1500)).length, 2);
  // a line through a box, even where it meets the line two faces share
  const through = curveCrossings(line([500, 500, -100], [500, 500, 1100]), box(0, 0, 0, 1000, 1000, 1000));
  assert.equal(through.length, 2);
  nearPoint(through[0], [500, 500, 0]);
  nearPoint(through[1], [500, 500, 1000]);
  assert.equal(curveCrossings(line([1500, 500, -100], [1500, 500, 1100]), box(0, 0, 0, 1000, 1000, 1000)).length, 0);
  // curves
  const x = curvesMeet(line([0, 0, 0], [1000, 0, 0]), line([500, -500, 0], [500, 500, 0], [700, 500, 0], [700, -500, 0]));
  assert.equal(x.length, 2);
  nearPoint(x[0], [500, 0, 0]);
  nearPoint(x[1], [700, 0, 0]);
  assert.equal(curvesMeet(line([0, 0, 0], [1000, 0, 0]), line([500, -500, 10], [500, 500, 10])).length, 0);
}

// ---- how a curve bends ----
{
  const ring: Point[] = circlePoints([100, 200, 300], 1000, [0, 0, 1], 72);
  ring.forEach((p) => near(Math.hypot(p[0] - 100, p[1] - 200), 1000));
  const b = curveBend(ring, true, ring[10]);
  near(b.radius ?? 0, 1000, 1);
  nearPoint(b.centre ?? [], [100, 200, 300], 1);
  nearPoint(b.point, ring[10]);
  near(Math.abs((b.axis ?? [0, 0, 0])[2]), 1);
  // the tangent runs along the curve, square to the way to the centre
  const to = [b.point[0] - 100, b.point[1] - 200, 0];
  near((to[0] * b.tangent[0] + to[1] * b.tangent[1]) / 1000, 0, 0.05);
  // a straight line
  const s = curveBend([[0, 0, 0], [1000, 0, 0], [2000, 0, 0]], false, [1500, 10, 0]);
  assert.equal(s.radius, null);
  nearPoint(s.point, [1500, 0, 0]);
  nearPoint(s.tangent, [1, 0, 0]);
  // two points are straight too
  assert.equal(curveBend([[0, 0, 0], [1000, 0, 0]], false, [500, 0, 0]).radius, null);
  // the far end of an open one still has neighbours
  const arc: Point[] = ring.slice(0, 10);
  near(curveBend(arc, false, arc[9]).radius ?? 0, 1000, 1);
  near(curveBend(arc, false, arc[0]).radius ?? 0, 1000, 1);
}

// ---- how a surface bends ----
{
  // a cylinder: round the way across, straight along its height
  const c = surfaceData(cylinder(1000, 2000));
  const onC = [1000 * Math.cos((2 * Math.PI * 10.5) / 48), 1000 * Math.sin((2 * Math.PI * 10.5) / 48), 1000] as const;
  const outward = [Math.cos((2 * Math.PI * 10.5) / 48), Math.sin((2 * Math.PI * 10.5) / 48), 0] as const;
  const b = surfaceBend(c, onC, outward);
  near(Math.abs(b.bends[0].curvature), 1 / 1000, 1e-5);
  assert.equal(b.bends[1].radius, null);
  near(Math.abs(b.bends[0].along[2]), 0, 0.01);
  near(Math.abs(b.bends[1].along[2]), 1, 0.01);
  nearPoint(b.bends[0].centre ?? [], [0, 0, 1000], 10);
  nearPoint(b.normal, outward, 0.01);

  // a sphere: the same both ways, the centre where it should be, facing out or in
  for (const inward of [false, true]) {
    const s = surfaceData(sphere(1000, inward));
    const t = (Math.PI * 7.4) / 24;
    const f = (2 * Math.PI * 9.4) / 48;
    const way = [Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)] as const;
    const at = way.map((v) => v * 1000) as unknown as Point;
    const clickNormal: Point = inward ? [-way[0], -way[1], -way[2]] : way;
    const r = surfaceBend(s, at, clickNormal);
    for (const k of r.bends) {
      assert.ok(k.radius !== null, "a sphere bends both ways");
      near(k.radius ?? 0, 1000, 30);
      nearPoint(k.centre ?? [], [0, 0, 0], 30);
    }
  }

  // a flat face reads as flat
  const flat = surfaceBend(surfaceData(box(0, 0, 0, 1000, 1000, 1000)), [500, 500, 1000], [0, 0, 1]);
  assert.equal(flat.bends[0].radius, null);
  assert.equal(flat.bends[1].radius, null);
  nearPoint(flat.normal, [0, 0, 1]);
}

console.log("analysisShapes checks pass");
