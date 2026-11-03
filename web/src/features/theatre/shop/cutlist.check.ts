// Checks cutlist.ts under Node, against packings worked out by hand in the comments. Run from web/:
//   npx tsx src/features/theatre/shop/cutlist.check.ts

import assert from "node:assert/strict";
import { costOf, cutStock, nestSheets, type CutPiece, type NestRect } from "./cutlist.ts";

const piece = (mark: string, lengthMm: number, material = "1x3 (19 x 64 mm)", qty = 1): CutPiece => ({ mark, material, lengthMm, qty });

// 1. First fit decreasing. Stock 2438, kerf 3. Pieces 2000 (A), 2000 (B), 1000 (C), 500 (D), 300 (E).
//    Sorted: A 2000, B 2000, C 1000, D 500, E 300.
//    A: no stick, so stick 1 (2438, 2000 used).
//    B: 2000 + 3 + 2000 = 4003 > 2438, so stick 2 (2000 used).
//    C: 2000 + 3 + 1000 = 3003 on stick 1 and stick 2 both too big, so stick 3 (1000 used).
//    D: stick 1 2003 + 500 = 2503 > 2438; stick 2 likewise; stick 3 1000 + 3 + 500 = 1503 fits.
//    E: stick 1 2000 + 3 + 300 = 2303 fits.
//    Three sticks, the least possible: 2 sticks hold 4876 and the cuts need 5800.
//    Offcuts: stick 1 2438 - 2303 = 135, stick 2 2438 - 2000 = 438, stick 3 2438 - 1503 = 935.
//    Waste = 1508 / (3 * 2438) = 20.62%.
const ffd = cutStock([piece("A", 2000), piece("B", 2000), piece("C", 1000), piece("D", 500), piece("E", 300)], [2438], 3);
assert.equal(ffd.sticks.length, 3);
assert.deepEqual(
  ffd.sticks.map((s) => s.cuts.map((c) => c.mark)),
  [["A", "E"], ["B"], ["C", "D"]],
);
assert.deepEqual(
  ffd.sticks.map((s) => s.offcutMm),
  [135, 438, 935],
);
assert.ok(Math.abs(ffd.wastePct - 20.618) < 0.01, `waste ${ffd.wastePct}`);
assert.deepEqual(ffd.byLength, [{ material: "1x3 (19 x 64 mm)", stockMm: 2438, count: 3 }]);
assert.equal(ffd.tooLong.length, 0);

// 2. The shortest stock that holds a piece: a 1000 takes 2438 (offcut 1438), a 3000 takes 3048 (offcut 48).
const lengths = [2438, 3048, 3658, 4877];
const short = cutStock([piece("X", 1000, "2x4")], lengths, 3);
assert.deepEqual([short.sticks[0].stockMm, short.sticks[0].offcutMm], [2438, 1438]);
const longer = cutStock([piece("Y", 3000, "2x4")], lengths, 3);
assert.deepEqual([longer.sticks[0].stockMm, longer.sticks[0].offcutMm], [3048, 48]);

// 3. A piece longer than the longest stick is reported, not cut. 5000 is over 4877.
const big = cutStock([piece("Z", 5000)], lengths, 3);
assert.equal(big.sticks.length, 0);
assert.deepEqual(big.tooLong.map((p) => p.mark), ["Z"]);

// 4. Material is kept apart: a 1x3 and a 2x4 of 1000 each need a stick apiece even though one would hold both.
const mixed = cutStock([piece("P", 1000, "1x3"), piece("Q", 1000, "2x4")], [2438], 3);
assert.equal(mixed.sticks.length, 2);

// 5. The kerf: two 1219s on a 2438 stick use 1219 + 3 + 1219 = 2441 > 2438, so two sticks. With no kerf, one stick, no offcut.
assert.equal(cutStock([piece("H", 1219, "x", 2)], [2438], 3).sticks.length, 2);
const exact = cutStock([piece("H", 1219, "x", 2)], [2438], 0);
assert.equal(exact.sticks.length, 1);
assert.equal(exact.sticks[0].offcutMm, 0);

// 6. Quantities expand: qty 3 of a 600 is three cuts on one stick (600 + 3 + 600 + 3 + 600 = 1806 < 2438).
const three = cutStock([piece("R", 600, "1x3", 3)], [2438], 3);
assert.equal(three.sticks.length, 1);
assert.equal(three.sticks[0].cuts.length, 3);
assert.equal(three.sticks[0].offcutMm, 2438 - 1806);

// 7. Cost sums count times unit price: 3 sticks at 12 and 2 sheets at 40 come to 116.
assert.equal(costOf([{ count: 3, unit: 12 }, { count: 2, unit: 40 }]), 116);

// 8. Nesting. Four 1219 x 1219 rectangles on a 1219 x 2438 sheet, no kerf: two per sheet, two sheets, no waste.
const squares: NestRect[] = [1, 2, 3, 4].map((n) => ({ mark: `Q${n}`, widthMm: 1219, heightMm: 1219 }));
const two = nestSheets(squares, 1219, 2438, 0);
assert.equal(two.sheets.length, 2);
assert.deepEqual(
  two.sheets.map((s) => s.map((p) => [p.xMm, p.yMm])),
  [
    [
      [0, 0],
      [0, 1219],
    ],
    [
      [0, 0],
      [0, 1219],
    ],
  ],
);
assert.equal(Math.round(two.wastePct * 100) / 100, 0);
assert.equal(two.tooBig.length, 0);

// With a 3 mm kerf the second shelf would end at 1222 + 1219 = 2441, past 2438: one piece a sheet, four sheets.
assert.equal(nestSheets(squares, 1219, 2438, 3).sheets.length, 4);

// 9. Too big: a 2000 x 2000 fits no way round a 1219 x 2438 sheet, so it's reported and not placed.
const huge = nestSheets([{ mark: "H", widthMm: 2000, heightMm: 2000 }, { mark: "S", widthMm: 500, heightMm: 500 }], 1219, 2438, 3);
assert.deepEqual(huge.tooBig.map((r) => r.mark), ["H"]);
assert.equal(huge.sheets.length, 1);
assert.equal(huge.sheets[0].length, 1);

// 10. Turned: a 2438 x 1219 on a 1219 x 2438 sheet fits only on its side, so it is placed turned, 1219 wide and 2438 high.
const turned = nestSheets([{ mark: "T", widthMm: 2438, heightMm: 1219 }], 1219, 2438, 0);
assert.deepEqual(turned.sheets[0][0], { mark: "T", xMm: 0, yMm: 0, widthMm: 1219, heightMm: 2438, turned: true });

console.log("cutlist.check: all assertions passed");
