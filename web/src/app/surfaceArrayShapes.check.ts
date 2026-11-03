// Run with: npx tsx src/app/surfaceArrayShapes.check.ts
import assert from "node:assert";
import { arrayLayout, baseSurface, cellLines, itemBox, itemMapper, newArrayOptions, surfaceAt, trimmer, type ArrayLayout, type ArrayOptions, type BaseSurface } from "./surfaceArrayShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

const quad = (a: number[], b: number[], c: number[], d: number[]): number[] => [...a, ...b, ...c, ...a, ...c, ...d];
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0): number[] => quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] => {
  const p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].flatMap(([a, b, c, d]) => quad(p[a], p[b], p[c], p[d]));
};
const options = (o: Partial<ArrayOptions>): ArrayOptions => ({ ...newArrayOptions(), ...o });
const got = (b: BaseSurface | string): BaseSurface => {
  assert.ok(typeof b !== "string", String(b));
  return b as BaseSurface;
};
const laid = (b: BaseSurface, o: ArrayOptions): ArrayLayout => {
  const l = arrayLayout(b, o);
  assert.ok(typeof l !== "string", String(l));
  return l as ArrayLayout;
};
const area = (t: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [ax, ay, az, bx, by, bz] = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2], t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
    sum += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
  }
  return sum;
};

// ---- the base ----
{
  const b = got(baseSurface(rect(0, 0, 3000, 2000)));
  near(b.width, 3000);
  near(b.height, 2000);
  assert.equal(b.flat, true);
  near(b.normal[2], 1);
  near(b.centre[0], 1500);
  near(b.centre[1], 1000);
  // a rectangle turned on the plane is fitted along its own sides
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const at = (x: number, y: number): number[] => [x * c - y * s, x * s + y * c, 500];
  const turned = got(baseSurface(quad(at(0, 0), at(3000, 0), at(3000, 2000), at(0, 2000))));
  near(turned.width, 3000);
  near(turned.height, 2000);
  near(turned.ex[0], c);
  // faces running the other way still have it on top
  const under = got(baseSurface(quad([0, 0, 0], [0, 1000, 0], [1000, 1000, 0], [1000, 0, 0])));
  near(under.normal[2], 1);
  near(surfaceAt(under, 0, 0).normal[2], 1);
  // a closed solid won't do
  assert.equal(typeof baseSurface(box(0, 0, 0, 100, 100, 100)), "string");
  // a wall-like one, standing up
  const up = got(baseSurface(quad([0, 0, 0], [3000, 0, 0], [3000, 0, 2000], [0, 0, 2000])));
  near(Math.abs(up.normal[1]), 1);
  near(up.width, 3000);
  near(up.height, 2000);
}

// ---- repetitions ----
{
  const b = got(baseSurface(rect(0, 0, 3000, 3000)));
  // three each way, touching: nine, each a third, all inside
  const l = laid(b, options({}));
  assert.equal(l.cells.length, 9);
  near(l.sizeX, 1000);
  assert.ok(l.cells.every((c) => !c.onEdge));
  // an even number has its middle between two
  const even = laid(b, options({ countX: 2, countY: 4 }));
  assert.equal(even.cells.length, 8);
  near(even.sizeX, 1500);
  near(even.sizeY, 750);
  near(Math.min(...even.cells.map((c) => c.at[0])), -750);
  near(Math.min(...even.cells.map((c) => c.at[1])), -1125);
  // with gaps the items are smaller and still fit
  const gaps = laid(b, options({ offsetX: 1.5, offsetY: 1.5 }));
  near(gaps.sizeX, 750);
  assert.equal(gaps.cells.length, 9);
  near(Math.max(...gaps.cells.map((c) => c.at[0])), 1125);
  assert.ok(gaps.cells.every((c) => !c.onEdge));
  // fixed distance: as many as it takes
  const fixed = laid(b, options({ modeX: "distance", modeY: "distance", distanceX: 700, distanceY: 1000 }));
  near(fixed.sizeX, 700);
  assert.equal(fixed.cells.length, 5 * 3);
  // moved by half an item, a further row appears at the edge, and the rest shift
  const moved = laid(b, options({ originY: 0.5 }));
  near(Math.max(...moved.cells.map((c) => c.at[1])), 1500);
  assert.equal(moved.cells.length, 12);
  assert.equal(moved.cells.filter((c) => c.onEdge).length, 6);
  // shift: each column up by a quarter
  const shifted = laid(b, options({ shiftY: 0.25 }));
  const row = shifted.cells.filter((c) => Math.abs(c.at[0] - 1000) < 1e-6).map((c) => c.at[1]);
  assert.ok(row.some((v) => Math.abs(v - 250) < 1e-6));
  // turned, it still covers the base
  const turned = laid(b, options({ rotation: 45 }));
  assert.ok(turned.cells.length > 9);
  const points = cellLines(b, turned);
  assert.equal(points.length, turned.cells.length * 4 * 6);
  // omit leaves those the edge cuts off
  const omit = laid(b, options({ originY: 0.5, edge: "omit" }));
  assert.equal(omit.cells.length, 6);
  // nothing lands: an item too big to fit inside with omit
  assert.equal(typeof arrayLayout(b, options({ modeX: "distance", distanceX: 5000, edge: "omit" })), "string");
  // all in a line
  assert.equal(typeof arrayLayout(b, options({ offsetX: 0, shiftY: 0 })), "string");
  // too many
  assert.equal(typeof arrayLayout(b, options({ modeX: "distance", modeY: "distance", distanceX: 1, distanceY: 1 })), "string");
}

// ---- an oval: what the edge cuts ----
{
  const ring: number[][] = [];
  for (let i = 0; i < 48; i++) ring.push([1000 * Math.cos((i * Math.PI) / 24), 1500 * Math.sin((i * Math.PI) / 24), 0]);
  const tris = ring.flatMap((p, i) => [0, 0, 0, ...p, ...ring[(i + 1) % 48]]);
  const b = got(baseSurface(tris));
  const over = laid(b, options({}));
  const omit = laid(b, options({ edge: "omit" }));
  assert.ok(omit.cells.length < over.cells.length);
  assert.ok(omit.cells.every((c) => !c.onEdge));
  // the corners of the box are off it
  assert.ok(over.cells.some((c) => c.onEdge));
}

// ---- items laid on it ----
{
  const b = got(baseSurface(rect(0, 0, 3000, 3000, 500)));
  const item = box(10000, 10000, 200, 10100, 10100, 300);
  const ibox = itemBox([item]);
  assert.ok(ibox);
  const o = options({});
  const l = laid(b, o);
  const m = itemMapper(b, l, ibox, o);
  // fitted to its rectangle, standing on the surface, scaled up with it
  const placed = m.placeFaces(item, l.cells[0]);
  const xs = placed.filter((_, i) => i % 3 === 0);
  const zs = placed.filter((_, i) => i % 3 === 2);
  near(Math.max(...xs) - Math.min(...xs), 1000);
  near(Math.min(...zs), 500);
  near(Math.max(...zs), 1500);
  // without Scale Z' it keeps its height
  const flat = itemMapper(b, l, ibox, options({ scaleZ: false })).place(item, l.cells[0]).filter((_, i) => i % 3 === 2);
  near(Math.max(...flat), 600);
  // on the other side, mirrored and still facing outward
  const under = itemMapper(b, l, ibox, options({ flip: true })).placeFaces(item, l.cells[0]);
  const uz = under.filter((_, i) => i % 3 === 2);
  near(Math.max(...uz), 500);
  near(Math.min(...uz), -500);
  const volume = (t: readonly number[]): number => {
    let sum = 0;
    for (let i = 0; i + 8 < t.length; i += 9) sum += t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) + t[i + 1] * (t[i + 5] * t[i + 6] - t[i + 3] * t[i + 8]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6]);
    return sum / 6;
  };
  near(volume(under), 1e9, 1e3);
  near(volume(placed), 1e9, 1e3);
}

// ---- on a curved surface ----
{
  // half a cylinder of radius 1000 lying along y, 2000 long, facing up
  const faces: number[] = [];
  const n = 36;
  for (let i = 0; i < n; i++) {
    const [a, c] = [(Math.PI * i) / n, (Math.PI * (i + 1)) / n];
    faces.push(...quad([1000 * Math.cos(c), 0, 1000 * Math.sin(c)], [1000 * Math.cos(a), 0, 1000 * Math.sin(a)], [1000 * Math.cos(a), 2000, 1000 * Math.sin(a)], [1000 * Math.cos(c), 2000, 1000 * Math.sin(c)]));
  }
  const b = got(baseSurface(faces));
  assert.equal(b.flat, false);
  near(Math.abs(b.normal[2]), 1, 1e-6);
  near(b.width, 2000, 1);
  near(b.height, 2000, 1);
  // the middle of it, on top
  const at = surfaceAt(b, 0, 0);
  near(at.point[2], 1000, 1);
  near(at.normal[2], 1, 0.01);
  // part way round, the point is on the circle, and faces out from the middle
  const s = surfaceAt(b, b.ex[0] ? 600 : 0, b.ex[0] ? 0 : 600);
  near(Math.hypot(s.point[0], s.point[2]), 1000, 2);
  near(s.normal[0] * s.point[2] - s.normal[2] * s.point[0], 0, 5);
  // an item carried onto it stands out along the normal
  const item = box(0, 0, 0, 100, 100, 100);
  const ibox = itemBox([item]);
  assert.ok(ibox);
  const o = options({ countX: 5, countY: 5, scaleZ: false });
  const l = laid(b, o);
  const m = itemMapper(b, l, ibox, o);
  for (const cell of l.cells) {
    const p = m.place(item, cell);
    for (let i = 0; i + 2 < p.length; i += 3) {
      const r = Math.hypot(p[i], p[i + 2]);
      // bottom on the surface, top 100 out, whatever chord the facets make
      assert.ok(r > 990 && r < 1110, `radius ${r}`);
    }
  }
}

// ---- trimmed at the edge ----
{
  const b = got(baseSurface(rect(0, 0, 3000, 3000)));
  const o = options({ originY: 0.5, edge: "trim" });
  const l = laid(b, o);
  const flatItem = rect(0, 0, 100, 100);
  const ibox = itemBox([flatItem]);
  assert.ok(ibox);
  const m = itemMapper(b, l, ibox, o);
  const trim = trimmer(b, 100);
  let sum = 0;
  for (const cell of l.cells) {
    const copy = m.placeFaces(flatItem, cell);
    sum += area(cell.onEdge ? trim(copy) : copy);
  }
  // exactly the base's area: half a row each end is trimmed away
  near(sum, 9e6, 1);
  // a solid item is closed off where it's cut
  const solid = box(0, 0, 0, 100, 100, 100);
  const sbox = itemBox([solid]);
  assert.ok(sbox);
  const sm = itemMapper(b, l, sbox, options({ originY: 0.5, edge: "trim", scaleZ: false }));
  const edgeCell = l.cells.find((c) => c.onEdge);
  assert.ok(edgeCell);
  const cut = trim(sm.placeFaces(solid, edgeCell));
  const ys = cut.filter((_, i) => i % 3 === 1);
  assert.ok(Math.max(...ys) <= 3000 + 1e-6 && Math.min(...ys) >= 0 - 1e-6);
  near(area(cut), 2 * 1000 * 500 + 2 * 1000 * 100 + 2 * 500 * 100, 1);
}

console.log("surfaceArrayShapes checks pass");
