// Hand-worked checks for transitions.ts. Run: npx tsx src/features/theatre/scenes/transitions.check.ts

import assert from "node:assert/strict";
import { DEFAULT_STAGE } from "../stage.ts";
import { clashesAt, crewEstimate, footprint, isStill, moveMatrix, normDeg, overlap, posesAt, rectangleOf, sceneDiff, type Piece, type Scene, shiftSeconds, spikeLegs, spikes, sweep, turnBetween } from "./transitions.ts";

const sq = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const format = (mm: number) => `${(mm / 1000).toFixed(2)} m`;
const piece = (id: string, w: number, h: number, x0 = 0, y0 = 0, deg0 = 0): Piece => ({ id, name: id, w, h, x0, y0, deg0 });
const scene = (id: string, poses: Scene["poses"]): Scene => ({ id, name: id, note: "", color: "#e53935", poses });

// turns the short way round: 350 to 10 is +20, so the middle is 360, which is 0
assert.equal(turnBetween(350, 10), 20);
assert.equal(turnBetween(10, 350), -20);
assert.equal(normDeg(360), 0);
assert.equal(normDeg(-90), 270);

// posesAt: a piece from (0,0) at 350 degrees to (1000,0) at 10 degrees
{
  const a = scene("a", { P: { x: 0, y: 0, deg: 350 } });
  const b = scene("b", { P: { x: 1000, y: 0, deg: 10 } });
  const mid = posesAt(a, b, 0.5).P;
  assert.equal(mid.x, 500);
  assert.equal(mid.deg, 0, "350 to 10 halfway is 0, the short way round");
  assert.equal(posesAt(a, b, 0).P.deg, 350);
  assert.equal(posesAt(a, b, 1).P.deg, 10);
  // flown out at the end only: out for the second half of the change
  const c = scene("c", { P: { x: 0, y: 0, deg: 0, out: true } });
  const d = scene("d", { P: { x: 0, y: 0, deg: 0 } });
  assert.equal(posesAt(c, d, 0.49).P.out, true);
  assert.equal(posesAt(c, d, 0.5).P.out, false);
}

// footprint: 2000 x 1000 at (1000, 3000), unturned: x 0..2000, y 2500..3500
{
  const p = piece("P", 2000, 1000, 1000, 3000);
  assert.deepEqual(footprint(p, { x: 1000, y: 3000, deg: 0 }), [
    { x: 0, y: 2500 },
    { x: 2000, y: 2500 },
    { x: 2000, y: 3500 },
    { x: 0, y: 3500 },
  ]);
  // turned 90 about its centre: 1000 wide and 2000 tall, x 500..1500, y 2000..4000
  const t = footprint(p, { x: 1000, y: 3000, deg: 90 });
  near(t[0].x, 1500);
  near(t[0].y, 2000);
  near(t[2].x, 500);
  near(t[2].y, 4000);
}

// overlap: two squares sharing an area, two squares sharing an edge, and a diamond whose corner stops short of a square
{
  assert.equal(overlap(sq(0, 0, 2, 2), sq(1, 1, 3, 3)), true);
  assert.equal(overlap(sq(1, 1, 3, 3), sq(0, 0, 2, 2)), true);
  assert.equal(overlap(sq(0, 0, 2, 2), sq(2, 0, 4, 2)), false, "edges touching is no overlap");
  const diamond = (cx: number, cy: number) => [
    { x: cx - 1, y: cy },
    { x: cx, y: cy - 1 },
    { x: cx + 1, y: cy },
    { x: cx, y: cy + 1 },
  ];
  // left corner at x 2.5, the square's right edge at x 2: a gap of 0.5, no overlap
  assert.equal(overlap(sq(0, 0, 2, 2), diamond(3.5, 1)), false);
  // left corner exactly at x 2: touching at one point only
  assert.equal(overlap(sq(0, 0, 2, 2), diamond(3, 1)), false);
  // left corner at x 1.5: inside the square
  assert.equal(overlap(sq(0, 0, 2, 2), diamond(2.5, 1)), true);
}

// a head-on crossing: A from 0 to 10000 and B from 10000 to 0 along x, both 2000 square
// the centres are 2000 apart when 10000t and 10000 - 10000t differ by 2000: first sample t = 10/24 (1666.7 apart), not 9/24 (2500 apart)
{
  const a = scene("a", { A: { x: 0, y: 0, deg: 0 }, B: { x: 10000, y: 0, deg: 0 } });
  const b = scene("b", { A: { x: 10000, y: 0, deg: 0 }, B: { x: 0, y: 0, deg: 0 } });
  const pieces = [piece("A", 2000, 2000), piece("B", 2000, 2000, 10000)];
  const hits = sweep(a, b, pieces);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].a, "A");
  assert.equal(hits[0].b, "B");
  near(hits[0].t, 10 / 24, 1e-12);
  // the same pieces going past each other 10 m apart: no hit
  const c = scene("c", { A: { x: 0, y: 0, deg: 0 }, B: { x: 30000, y: 0, deg: 0 } });
  const d = scene("d", { A: { x: 10000, y: 0, deg: 0 }, B: { x: 20000, y: 0, deg: 0 } });
  assert.deepEqual(sweep(c, d, pieces), []);
}

// a platform with a box on it: overlapping in both scenes is stacked, so no hit; the box moving off it is a hit at the start
{
  const pieces = [piece("P", 4000, 4000), piece("K", 1000, 1000)];
  const a = scene("a", { P: { x: 0, y: 0, deg: 0 }, K: { x: 0, y: 0, deg: 0 } });
  const b = scene("b", { P: { x: 0, y: 0, deg: 0 }, K: { x: 0, y: 0, deg: 0 } });
  assert.deepEqual(sweep(a, b, pieces), []);
  const c = scene("c", { P: { x: 0, y: 0, deg: 0 }, K: { x: 10000, y: 0, deg: 0 } });
  assert.deepEqual(sweep(a, c, pieces), [{ a: "P", b: "K", t: 0 }]);
}

// a piece flown out at the start and in at the end, on top of A: it counts once it is on stage, from half way
{
  const pieces = [piece("A", 2000, 2000), piece("B", 2000, 2000)];
  const a = scene("a", { A: { x: 0, y: 0, deg: 0 }, B: { x: 0, y: 0, deg: 0, out: true } });
  const b = scene("b", { A: { x: 0, y: 0, deg: 0 }, B: { x: 0, y: 0, deg: 0 } });
  assert.deepEqual(sweep(a, b, pieces), [{ a: "A", b: "B", t: 0.5 }]);
  // flown out at both ends: skipped, however it overlaps
  const c = scene("c", { A: { x: 0, y: 0, deg: 0 }, B: { x: 0, y: 0, deg: 0, out: true } });
  assert.deepEqual(sweep(c, c, pieces), []);
  assert.equal(clashesAt(a, b, pieces, 0).length, 0);
  assert.equal(clashesAt(a, b, pieces, 0.5).length, 1);
}

// crew by area: 1.5 m2 is 1, 2 m2 is 2 (not under 2), 4 m2 is 2, 6 m2 is 4
{
  assert.equal(crewEstimate(piece("p", 1500, 1000)), 1);
  assert.equal(crewEstimate(piece("p", 2000, 1000)), 2);
  assert.equal(crewEstimate(piece("p", 2000, 2000)), 2);
  assert.equal(crewEstimate(piece("p", 3000, 2000)), 4);
}

// time: 3 s handling plus the distance at 0.8 m/s: 4 m is 5 s, so 8 s; nothing moved is 3 s
{
  assert.equal(shiftSeconds(0), 3);
  assert.equal(shiftSeconds(4000), 8);
  assert.equal(shiftSeconds(1600), 5);
}

// spikes: 2 m x 1 m unturned at (1000, 3000) in the default frame, where across is x and up is y
{
  const p = piece("Wagon", 2000, 1000, 1000, 3000);
  const scn = scene("s", { Wagon: { x: 1000, y: 3000, deg: 0 } });
  const [s] = spikes(scn, [p], DEFAULT_STAGE);
  assert.equal(s.name, "Wagon");
  const want = [
    [0, 2500],
    [2000, 2500],
    [2000, 3500],
    [0, 3500],
  ];
  s.corners.forEach((c, i) => {
    near(c.across, want[i][0]);
    near(c.up, want[i][1]);
  });
  // a flown piece has no spike marks
  assert.deepEqual(spikes(scene("f", { Wagon: { x: 1000, y: 3000, deg: 0, out: true } }), [p], DEFAULT_STAGE), []);
}

// the shift plot's rows: a move of 3.2 m upstage, a turn of 90, both, a diagonal, a fly out and a fly in; still pieces left out
{
  const p = piece("Wagon", 2000, 1000);
  const q = piece("Sofa", 1500, 1000);
  const from = scene("a", { Wagon: { x: 0, y: 0, deg: 0 }, Sofa: { x: 0, y: 0, deg: 0 } });
  const up = scene("b", { Wagon: { x: 0, y: 3200, deg: 0 }, Sofa: { x: 0, y: 0, deg: 0 } });
  const rows = sceneDiff(from, up, DEFAULT_STAGE, format, [p, q]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].piece, "Wagon");
  assert.equal(rows[0].action, "Moves 3.20 m US");
  assert.equal(rows[0].from, "on CL · on PL");
  assert.equal(rows[0].to, "on CL · 3.20 m US");
  assert.equal(rows[0].distanceMm, 3200);
  assert.equal(rows[0].turnDeg, 0);
  assert.equal(rows[0].crew, 2);
  near(rows[0].seconds, 7, 1e-9);

  const turned = scene("c", { Wagon: { x: 0, y: 0, deg: 90 }, Sofa: { x: 0, y: 0, deg: 0 } });
  assert.equal(sceneDiff(from, turned, DEFAULT_STAGE, format, [p, q])[0].action, "Turns 90°");

  const both = scene("d", { Wagon: { x: 0, y: 3200, deg: 90 }, Sofa: { x: 0, y: 0, deg: 0 } });
  assert.equal(sceneDiff(from, both, DEFAULT_STAGE, format, [p, q])[0].action, "Moves 3.20 m US; Turns 90°");

  // 3000 across to stage left and 4000 upstage: 5000 in all
  const diag = scene("e", { Wagon: { x: 3000, y: 4000, deg: 0 }, Sofa: { x: 0, y: 0, deg: 0 } });
  assert.equal(sceneDiff(from, diag, DEFAULT_STAGE, format, [p, q])[0].action, "Moves 5.00 m (4.00 m US and 3.00 m SL)");

  const flyOut = scene("f", { Wagon: { x: 0, y: 0, deg: 0, out: true }, Sofa: { x: 0, y: 0, deg: 0 } });
  const out = sceneDiff(from, flyOut, DEFAULT_STAGE, format, [p, q]);
  assert.equal(out[0].action, "Flies out");
  assert.equal(out[0].to, "Flown");
  const flyIn = sceneDiff(flyOut, from, DEFAULT_STAGE, format, [p, q]);
  assert.equal(flyIn[0].action, "Flies in");
  assert.equal(flyIn[0].from, "Flown");
  near(flyIn[0].seconds, 3, 1e-9);
}

// spike marks: an L at each corner of the square, its arms running on past the corner, outside the square
{
  const legs = spikeLegs(
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 1 },
    ],
    0.5,
  );
  assert.deepEqual(legs[0], [
    { x: -0.5, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: -0.5 },
  ]);
  assert.deepEqual(legs[2][1], { x: 2, y: 1 });
}

// a turn about a point then a move to another point: p goes to q, and the arms turn with the piece
{
  const m = moveMatrix({ x: 1000, y: 0, deg: 0 }, { x: 0, y: 1000, deg: 90 });
  const map = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  near(map(1000, 0).x, 0);
  near(map(1000, 0).y, 1000);
  // a point 1000 to the right of p turns to 1000 above q
  near(map(2000, 0).x, 0);
  near(map(2000, 0).y, 2000);
  assert.equal(isStill({ x: 5, y: 5, deg: 10 }, { x: 5, y: 5, deg: 10 }), true);
  assert.equal(isStill({ x: 5, y: 5, deg: 10 }, { x: 5, y: 5, deg: 11 }), false);
}

// a rectangle read back from its corners: 4 by 2 turned 30 degrees about (5, 5); read with a width of 2, its other edge
// is the width, at 120 degrees; turned by hand 90 more, its 4 mm edge now reads at 120 degrees
{
  const pts = footprint({ id: "r", name: "r", w: 4, h: 2, x0: 5, y0: 5, deg0: 30 }, { x: 5, y: 5, deg: 30 });
  const r = rectangleOf(pts);
  assert.ok(r);
  near(r.x, 5);
  near(r.y, 5);
  near(r.deg, 30);
  near(r.w, 4);
  near(r.h, 2);
  const s = rectangleOf(pts, 2);
  assert.ok(s);
  near(s.deg, 120);
  near(s.w, 2);
  near(s.h, 4);
  const turned = rectangleOf(footprint({ id: "r", name: "r", w: 4, h: 2, x0: 5, y0: 5, deg0: 30 }, { x: 5, y: 5, deg: 120 }), 4);
  assert.ok(turned);
  near(turned.deg, 120);
  // not a rectangle: a trapezoid-ish quadrilateral and a triangle
  assert.equal(rectangleOf([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 0, y: 2 },
  ]), null);
  assert.equal(rectangleOf([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
  ]), null);
}

console.log("transitions.check.ts: all checks pass");
