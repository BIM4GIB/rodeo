// Node check of AEC > Roof Face's geometry. Run from web/: npx tsx src/app/roofFaceShapes.check.ts

import assert from "node:assert/strict";
import type { Pt } from "../core/index.ts";
import { buildRoofFace, pitchThrough, roofFaceProblem, sideOf, splitHoles, type RoofFace, type RoofFaceSpec } from "./roofFaceShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} is not ${b}`);
const rad = (d: number): number => (d * Math.PI) / 180;

const RECT: Pt[] = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 3000 },
  { x: 0, y: 3000 },
];
const HOLE: Pt[] = [
  { x: 1500, y: 1000 },
  { x: 2500, y: 1000 },
  { x: 2500, y: 2000 },
  { x: 1500, y: 2000 },
];

function spec(over: Partial<RoofFaceSpec> = {}): RoofFaceSpec {
  return { outline: RECT, holes: [], axis: [RECT[0], RECT[1]], side: 1, pitch: rad(30), axisZ: 2700, thickness: 200, eave: "vertical", vertical: 100, hole: "vertical", ...over };
}

/** The volume a closed mesh holds, its faces facing out. */
function volume(faces: readonly number[][]): number {
  let v = 0;
  for (const f of faces) {
    for (let i = 3; i + 5 < f.length; i += 3) {
      const [ax, ay, az] = [f[0], f[1], f[2]];
      const [bx, by, bz] = [f[i], f[i + 1], f[i + 2]];
      const [cx, cy, cz] = [f[i + 3], f[i + 4], f[i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
}

/** Every edge is met once each way. */
function closed(faces: readonly number[][]): void {
  const key = (f: readonly number[], i: number): string => `${Math.round(f[i] * 1000)},${Math.round(f[i + 1] * 1000)},${Math.round(f[i + 2] * 1000)}`;
  const count = new Map<string, number>();
  for (const f of faces) {
    const n = f.length / 3;
    for (let i = 0; i < n; i++) {
      const a = key(f, i * 3);
      const b = key(f, ((i + 1) % n) * 3);
      if (a === b) continue;
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  for (const [edge, n] of count) {
    const [a, b] = edge.split(">");
    assert.equal(count.get(`${b}>${a}`) ?? 0, n, `edge ${edge} isn't met the other way`);
  }
}

const zs = (r: RoofFace): number[] => r.faces.flatMap((f) => f.filter((_, i) => i % 3 === 2));

const T = 200;
const V = T / Math.cos(rad(30));
const TAN = Math.tan(rad(30));
const top0 = 2700 + V;

// vertical cuts all round: a plumb-sided slab, its underside at Axis Z at the axis
const plumb = buildRoofFace(spec());
assert.ok(plumb);
closed(plumb.faces);
near(volume(plumb.faces), 4000 * 3000 * V);
near(Math.min(...zs(plumb)), 2700);
near(Math.max(...zs(plumb)), top0 + 3000 * TAN);
near(plumb.area, (4000 * 3000) / Math.cos(rad(30)));
near(plumb.planArea, 4000 * 3000);

// the same axis drawn the other way, rising to its right, is the same roof
const back = buildRoofFace(spec({ axis: [RECT[1], RECT[0]], side: -1 }));
assert.ok(back);
near(volume(back.faces), volume(plumb.faces));
near(Math.max(...zs(back)), Math.max(...zs(plumb)));

// a horizontal eave cut takes off the triangle under the top edge's level
const level = buildRoofFace(spec({ eave: "horizontal" }));
assert.ok(level);
closed(level.faces);
near(volume(level.faces), 4000 * 3000 * V - (4000 * V * (V / TAN)) / 2);
near(Math.min(...zs(level)), top0);

// a square eave cut is square to the slope: the triangle off is half V by T sin p
const square = buildRoofFace(spec({ eave: "square" }));
assert.ok(square);
closed(square.faces);
near(volume(square.faces), 4000 * 3000 * V - (4000 * V * T * Math.sin(rad(30))) / 2);

// a double cut: a 100 fascia, then level to the underside
const double = buildRoofFace(spec({ eave: "double", vertical: 100 }));
assert.ok(double);
closed(double.faces);
near(volume(double.faces), 4000 * 3000 * V - (4000 * (V - 100) * ((V - 100) / TAN)) / 2);
near(Math.min(...zs(double)), top0 - 100);
// no fascia is a horizontal cut, one deeper than the roof a vertical cut
near(volume(buildRoofFace(spec({ eave: "double", vertical: 0 }))!.faces), volume(level.faces));
near(volume(buildRoofFace(spec({ eave: "double", vertical: 400 }))!.faces), volume(plumb.faces));

// holes: plumb, splayed (level from the hole's upper edge) and square (what one side loses the other gains)
const holed = buildRoofFace(spec({ holes: [HOLE] }));
assert.ok(holed);
closed(holed.faces);
near(volume(holed.faces), 11e6 * V);
near(holed.planArea, 11e6);
const splayed = buildRoofFace(spec({ holes: [HOLE], hole: "splayed" }));
assert.ok(splayed);
closed(splayed.faces);
near(volume(splayed.faces), 11e6 * V - (1000 * V * (V / TAN)) / 2);
const squareHole = buildRoofFace(spec({ holes: [HOLE], hole: "square", eave: "double" }));
assert.ok(squareHole);
closed(squareHole.faces);
near(volume(squareHole.faces), volume(double.faces) - 1e6 * V);

// a hole given either way round is the same
near(volume(buildRoofFace(spec({ holes: [[...HOLE].reverse()], hole: "splayed" }))!.faces), volume(splayed.faces));

// an L, not square to the axis, with every cut: closed, and its plan area kept
const L: Pt[] = [
  { x: 0, y: 0 },
  { x: 5000, y: 500 },
  { x: 4800, y: 2500 },
  { x: 2500, y: 2300 },
  { x: 2300, y: 4500 },
  { x: -200, y: 4300 },
];
for (const eave of ["vertical", "horizontal", "double", "square"] as const) {
  const r = buildRoofFace(spec({ outline: L, axis: [L[0], L[1]], eave, pitch: rad(40) }));
  assert.ok(r, eave);
  closed(r.faces);
  assert.ok(volume(r.faces) > 0, `${eave} turned inside out`);
}

// too narrow for a horizontal cut's run: none
assert.equal(
  buildRoofFace(
    spec({
      outline: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 100 },
        { x: 0, y: 100 },
      ],
      eave: "horizontal",
    }),
  ),
  null,
);

// problems
assert.ok(roofFaceProblem(spec({ pitch: 0 })));
assert.ok(roofFaceProblem(spec({ pitch: rad(90) })));
assert.ok(roofFaceProblem(spec({ thickness: 0 })));
assert.ok(roofFaceProblem(spec({ axis: [RECT[0], RECT[0]] })));
assert.equal(roofFaceProblem(spec()), null);

// a polygon with its hole joined in comes apart again
const joined: Pt[] = [...RECT, HOLE[3], HOLE[0], HOLE[1], HOLE[2], HOLE[3], RECT[3]];
const split = splitHoles(joined);
assert.equal(split.outer.length, 4);
assert.equal(split.holes.length, 1);
assert.equal(split.holes[0].length, 4);
near(volume(buildRoofFace(spec({ outline: split.outer, holes: split.holes }))!.faces), volume(holed.faces));
assert.equal(splitHoles(RECT).holes.length, 0);

// 2nd Click Height
const through = pitchThrough([RECT[0], RECT[1]], { x: 2000, y: 3000 }, 3000 * TAN);
assert.ok(through);
near(through.pitch, rad(30));
assert.equal(through.side, 1);
assert.equal(pitchThrough([RECT[0], RECT[1]], { x: 2000, y: -3000 }, 3000 * TAN)?.side, -1);
assert.equal(pitchThrough([RECT[0], RECT[1]], { x: 2000, y: 3000 }, -1000)?.side, -1);
assert.equal(pitchThrough([RECT[0], RECT[1]], { x: 2000, y: 0 }, 1000), null);
assert.equal(pitchThrough([RECT[0], RECT[1]], { x: 2000, y: 3000 }, 0), null);
assert.equal(sideOf([RECT[0], RECT[1]], { x: 1, y: 5 }), 1);
assert.equal(sideOf([RECT[0], RECT[1]], { x: 1, y: -5 }), -1);

console.log("roofFaceShapes: all checks pass");
