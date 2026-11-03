// Checks the sightline coverage under Node. Run from web/:
//   npx tsx src/features/theatre/sightlines/coverage.check.ts
// The wall (-600, 0) to (-100, 0) across the stage, seen from a seat at (0, -5000): the line to a point at
// (-500, 1000) crosses up = 0 at across -500 x 5000 / 6000 = -416.7, inside the wall, so it's blocked; the
// line to (500, 1000) crosses at +416.7, past the wall's end, so it's seen.

import type { Shape } from "../../../core/index.ts";
import assert from "node:assert/strict";
import { DEFAULT_STAGE } from "../stage.ts";
import { cellCentres, coverageGrid, coverageStats, MAX_SEATS, sampleSeats, seesPoint, segmentsMeet, wallsOf, type Wall } from "./coverage.ts";
import type { Seat } from "./seats.ts";

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const pt = (across: number, up: number) => ({ across, up });

// the lines
assert.equal(segmentsMeet(pt(-1, 0), pt(1, 0), pt(0, -1), pt(0, 1)), true, "crossing segments meet");
assert.equal(segmentsMeet(pt(-1, 0), pt(1, 0), pt(2, -1), pt(2, 1)), false, "segments that miss don't");
assert.equal(segmentsMeet(pt(0, 0), pt(10, 0), pt(10, 0), pt(20, 0)), true, "segments touching at an end meet");
assert.equal(segmentsMeet(pt(0, 0), pt(10, 0), pt(11, 0), pt(20, 0)), false, "collinear segments with a gap don't");

// sight
const seat = pt(0, -5000);
assert.equal(seesPoint(seat, pt(0, 2000), []), true, "no occluders: every point is seen");
const wall: Wall = { a: pt(-1000, 0), b: pt(1000, 0) };
assert.equal(seesPoint(seat, pt(0, 2000), [wall]), false, "a wall across the middle hides the point behind it");
assert.equal(seesPoint(seat, pt(2000, 2000), [wall]), true, "the line crosses up = 0 at +1428.6, past the wall's end at 1000");
assert.equal(seesPoint(seat, pt(-500, 1000), [wall]), false, "the line crosses at -416.7, inside the wall");
const short: Wall = { a: pt(-600, 0), b: pt(-100, 0) };
assert.equal(seesPoint(seat, pt(-500, 1000), [short]), false, "crosses at -416.7, inside (-600, -100)");
assert.equal(seesPoint(seat, pt(500, 1000), [short]), true, "crosses at +416.7, clear of (-600, -100)");

// the grid: two cells across, one row, centres at -500 and +500 and up 1000
const rect = { across0: -1000, across1: 1000, up0: 0, up1: 2000 };
assert.deepEqual(cellCentres(rect, 2, 1), [pt(-500, 1000), pt(500, 1000)]);
const one: Seat[] = [{ block: "T", row: 1, seat: 1, across: 0, up: -5000, eyeMm: 1120 }];
const cov = coverageGrid(one, rect, 2, 1, [short]);
assert.equal(cov.percent[0], 0, "the cell behind the wall is seen by none of the one seat");
assert.equal(cov.percent[1], 100, "the other cell is seen by the one seat");
assert.equal(cov.seatScores[0], 50, "the seat sees half the grid");
const stats = coverageStats(cov);
assert.equal(stats.average, 50);
assert.equal(stats.worst, 50);
assert.equal(stats.everyone, 50, "one cell of two is seen by all counted seats");
assert.equal(stats.underHalf, 50, "one cell of two is seen by under half");

// sampling: 900 seats count 300, taken every third seat
const many: Seat[] = Array.from({ length: 900 }, (_, i) => ({ block: "B", row: 1 + Math.floor(i / 30), seat: (i % 30) + 1, across: 0, up: -2000, eyeMm: 1120 }));
assert.equal(sampleSeats(many).length, MAX_SEATS);
assert.equal(sampleSeats(many)[1], many[3], "every third seat when 900 are sampled to 300");
assert.equal(sampleSeats(one).length, 1, "a short audience is counted whole");
const sampled = coverageGrid(many, rect, 2, 1, []);
assert.equal(sampled.total, 900);
assert.equal(sampled.counted.length, 300);
assert.equal(sampled.percent[0], 100, "with no occluders every counted seat sees every cell");

// shapes give their edges in stage terms (DEFAULT_STAGE: across = x, up = y)
const xy = (x: number, y: number) => ({ x, y });
const line = { kind: "line", points: [xy(0, 0), xy(3000, 4000)], closed: false, bbox: null } as unknown as Shape;
const lw = wallsOf(line, DEFAULT_STAGE);
assert.equal(lw.length, 1);
assert.ok(near(lw[0].b.across, 3000) && near(lw[0].b.up, 4000), "a line's edge in stage terms");
const rectShape = { kind: "rect", points: [xy(0, 0), xy(100, 0), xy(100, 50), xy(0, 50)], closed: true, bbox: null } as unknown as Shape;
assert.equal(wallsOf(rectShape, DEFAULT_STAGE).length, 4, "a rectangle has four sides");
const circle = { kind: "arc", points: [], closed: true, bbox: null, center: xy(0, 0), rx: 1000, sweepAngle: 360, startAngle: 0 } as unknown as Shape;
const cw = wallsOf(circle, DEFAULT_STAGE);
assert.equal(cw.length, 60, "a full circle is 60 chords of 6 degrees");
assert.ok(cw.every((w) => near(Math.hypot(w.a.across, w.a.up), 1000, 1e-6)), "every chord end is on the circle");
const quarter = { kind: "arc", points: [], closed: false, bbox: null, center: xy(0, 0), rx: 1000, sweepAngle: 90, startAngle: 0 } as unknown as Shape;
const qw = wallsOf(quarter, DEFAULT_STAGE);
assert.equal(qw.length, 15, "a quarter circle is 15 chords");
assert.ok(near(qw[0].a.across, 1000) && near(qw.at(-1)!.b.across, 0) && near(qw.at(-1)!.b.up, 1000), "a quarter arc runs from +x to +y");

console.log("coverage.check.ts: all checks passed");
