// Checks solids3d.ts under Node, by volume: a closed solid with its faces wound outward gives its
// volume by the divergence theorem. Run from web/:
//   npx tsx src/app/solids3d.check.ts

import { axisProfile, bored, clipOutline, lathe, polygonBody, prism, tube, type Solid } from "./solids3d.ts";

let failures = 0;

// Signed volume by the divergence theorem: a closed outward solid gives its volume
const volume = (solid: Solid): number => {
  let v = 0;
  for (const f of solid) {
    const n = f.length / 3;
    for (let i = 1; i + 1 < n; i++) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = [f[0], f[1], f[2], f[3 * i], f[3 * i + 1], f[3 * i + 2], f[3 * i + 3], f[3 * i + 4], f[3 * i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
};
const near = (a: number, b: number, tol: number, what: string): void => {
  const ok = Math.abs(a - b) <= tol;
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", what, a.toFixed(1), b.toFixed(1));
};
// a cylinder of radius 10, height 20, with 48 facets
const cyl = lathe([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }]);
near(volume(cyl), Math.PI * 100 * 20, 25, "lathe: a cylinder's volume, outward");
near(volume(lathe([{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 0 }, { x: 0, y: 0 }])), Math.PI * 100 * 20, 25, "lathe: either way round");
// a hex prism by plan, across flats 20
const G = 20 / Math.cos(Math.PI / 6);
const hex = Array.from({ length: 6 }, (_, i) => ({ x: (G / 2) * Math.cos((i * Math.PI) / 3), y: (G / 2) * Math.sin((i * Math.PI) / 3) }));
near(volume(lathe([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }, { x: 0, y: 5 }], hex)), ((3 * Math.sqrt(3)) / 2) * (G / 2) ** 2 * 5, 0.01, "lathe by plan: a hexagon's area");
// a tube of the bore
const nut = lathe(bored([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], 4));
near(volume(nut), Math.PI * (100 - 16) * 5, 6, "bored: a ring's volume");
// profile of a side view, axis x: head to the left
const p = axisProfile([{ x: 0, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 3 }, { x: 10, y: 3 }, { x: 10, y: -3 }, { x: 2, y: -3 }, { x: 2, y: -5 }, { x: 0, y: -5 }], "x");
near(volume(lathe(p)), Math.PI * (25 * 2 + 9 * 8), 3, "axisProfile: a headed pin from a side view");
near(p.find((q) => q.x === 5)!.y, 10, 0, "a side view's left end comes out on top");
// prisms, with a hole
const square = (r: number) => [{ x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r }];
near(volume(prism([square(10), square(5)], 0, 4)), (400 - 100) * 4, 1e-6, "prism with a hole");
near(volume(prism([[...square(10)].reverse()], 0, 4)), 400 * 4, 1e-6, "prism wound the other way");
// a closed tube: a torus of major 20, minor 2
const ring = Array.from({ length: 48 }, (_, i) => [20 * Math.cos((i * Math.PI) / 24), 20 * Math.sin((i * Math.PI) / 24), 0] as [number, number, number]);
near(volume(tube(ring, 2, true, 16)), 2 * Math.PI ** 2 * 20 * 4, 50, "a closed tube: a torus's volume");
near(volume(tube([[0, 0, 0], [0, 0, 30]], 2, false, 24)), Math.PI * 4 * 30, 5, "an open tube: a cylinder's volume");
// half a square by a straight line; a hex body's volume, chamfered less than plain
near(volume(prism([clipOutline(square(10), (q) => q.x)], 0, 4)), 200 * 4, 1e-6, "clipOutline: half a square");
near(volume(polygonBody(6, 20, 0, 5, false, false)), ((3 * Math.sqrt(3)) / 2) * (G / 2) ** 2 * 5, 0.01, "polygonBody: a plain hex prism");
near(polygonBody(6, 20, 0, 5, true, true).length > 0 && volume(polygonBody(6, 20, 0, 5, true, true)) < volume(polygonBody(6, 20, 0, 5, false, false)) ? 1 : 0, 1, 0, "polygonBody: chamfers cut it");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
