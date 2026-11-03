// Checks flats.ts under Node, against cut lists worked out by hand in the comments. Run from web/:
//   npx tsx src/features/theatre/shop/flats.check.ts

import assert from "node:assert/strict";
import { elevation, flatParts, framing, legPositions, noteLines, planMark, platformParts, platformWarnings, sheetPieces, STOCK, stockText, type FlatSpec, type PlatformSpec, type ShopPart } from "./flats.ts";

const id = (x: number): string => String(x);
const rows = (parts: readonly ShopPart[]) => parts.map((p) => [p.mark, p.lengthMm, p.qty]);

// 1. Hollywood 1219 x 2438, 1x3 (19 x 64), lauan 5 mm, toggles at most 1219 apart.
//    H' = 2438 - 2*19 = 2400. Toggles = ceil(2400 / 1219) - 1 = 2 - 1 = 1.
//    Stiles 2 @ 2438 (full height). Rails 2 @ 1219 - 2*19 = 1181. Toggle 1 @ 1181. No centre stile (1219 is not over 1219).
//    Skin: 1219 x 2438 is one sheet, so K @ 2438 long, 1219 wide, qty 1.
const holly: FlatSpec = { name: "Flat A", widthMm: 1219, heightMm: 2438, style: "hollywood", stock: STOCK["1x3"], skin: "lauan", skinThickMm: 5 };
const p1 = flatParts(holly);
assert.equal(stockText(STOCK["1x3"]), "1x3 (19 x 64 mm)");
assert.deepEqual(rows(p1), [
  ["S", 2438, 2],
  ["R", 1181, 2],
  ["T", 1181, 1],
  ["K", 2438, 1],
]);
assert.equal(p1[3].material, "lauan 5 mm");
assert.equal(p1[3].widthMm, 1219);
assert.equal(framing(holly).length, 5, "two stiles, two rails and one toggle are five members");
// the toggle sits in the middle of the clear height: gaps of (2400 - 19) / 2 = 1190.5 above and below
assert.deepEqual(framing(holly)[4], [19, 1209.5, 1200, 1228.5]);

// 2. Broadway 1219 x 2438, 1x3 with its 64 mm face out, no skin.
//    Rails 2 @ 1219 (full width). Stiles 2 @ 2438 - 2*64 = 2310. Clear height 2310: toggles = ceil(2310 / 1219) - 1 = 1,
//    each @ 1219 - 2*64 = 1091. Corner blocks 4 @ 64.
const broad: FlatSpec = { name: "Flat B", widthMm: 1219, heightMm: 2438, style: "broadway", stock: STOCK["1x3"], skin: "none", skinThickMm: 5 };
assert.deepEqual(rows(flatParts(broad)), [
  ["R", 1219, 2],
  ["S", 2310, 2],
  ["T", 1091, 1],
  ["B", 64, 4],
]);
assert.equal(framing(broad).length, 5);

// 3. Hollywood 1500 x 2395, 1x3, lauan 5 mm. Over 1219 wide, so a centre stile.
//    H' = 2395 - 38 = 2357. Toggles = ceil(2357 / 1219) - 1 = 1.
//    Stiles 2 @ 2395. Rails 2 @ 1500 - 38 = 1462. Toggle 1 @ 1462.
//    Centre stile: 2 pieces (toggles + 1) @ (2357 - 1*19) / 2 = 1169.
//    Skin: 1500 x 2395 is over a sheet either way round, so cut into 1219 x 2395 and 281 x 2395.
const wide: FlatSpec = { name: "Flat C", widthMm: 1500, heightMm: 2395, style: "hollywood", stock: STOCK["1x3"], skin: "lauan", skinThickMm: 5 };
const p3 = flatParts(wide);
assert.deepEqual(rows(p3), [
  ["S", 2395, 2],
  ["R", 1462, 2],
  ["T", 1462, 1],
  ["C", 1169, 2],
  ["K1", 2395, 1],
  ["K2", 2395, 1],
]);
assert.equal(p3[4].widthMm, 1219);
assert.equal(p3[5].widthMm, 281);
assert.equal(framing(wide).length, 2 + 2 + 1 + 2, "stiles, rails, a toggle and two centre stile pieces");
assert.deepEqual(framing(wide)[5], [750 - 9.5, 19, 750 + 9.5, 1188], "the first centre stile piece runs from the bottom rail to the toggle");

// 4. Toggle counts at the edges: a clear height of 1000 needs no toggle (ceil(1000 / 1219) - 1 = 0).
const low: FlatSpec = { ...holly, heightMm: 1000, skin: "none" };
assert.deepEqual(rows(flatParts(low)), [
  ["S", 1000, 2],
  ["R", 1181, 2],
]);

// 5. Sheets. A panel that fits a sheet either way round is one piece; one over a sheet is cut into sheet-sized pieces.
assert.deepEqual(sheetPieces(1219, 2438), [{ widthMm: 1219, lengthMm: 2438 }]);
assert.equal(sheetPieces(2438, 1219).length, 1, "a sheet turned on its side");
assert.deepEqual(sheetPieces(2438, 2438), [
  { widthMm: 1219, lengthMm: 2438 },
  { widthMm: 1219, lengthMm: 2438 },
]);
assert.deepEqual(sheetPieces(1219, 3000), [
  { widthMm: 1219, lengthMm: 2438 },
  { widthMm: 1219, lengthMm: 562 },
]);

// 6. A platform 2438 wide, 1219 deep, 760 high; 2x4 frame (38 x 89), 4x4 legs (89 x 89), 19 mm lid, joists at most 406 apart.
//    Leg length = 760 - 19 - 89 = 652.
//    Long rails 2 @ 1219 (the depth). End rails 2 @ 2438 - 76 = 2362.
//    Joists = ceil(1219 / 406) - 1 = 4 - 1 = 3 @ 2362 (spaced 304.75 apart).
//    Lid: 2438 x 1219 fits a sheet turned on its side: one piece.
//    Legs: corners only (spans of 1219 are under 2438): 2 positions on each long rail = 4 legs @ 652.
//    Braces (over 600 high): one bay on each long side, hypot(1219, 652) = 1382.4 @ 1382, times 2 sides = qty 2.
//    At 760 high a guard rail is normally required.
const deck: PlatformSpec = {
  name: "Deck",
  widthMm: 2438,
  depthMm: 1219,
  standMm: 760,
  frameStock: STOCK["2x4"],
  legStock: STOCK["4x4"],
  legsPer: "corners",
};
assert.deepEqual(rows(platformParts(deck)), [
  ["LR", 1219, 2],
  ["ER", 2362, 2],
  ["J", 2362, 3],
  ["LID", 1219, 1],
  ["L", 652, 4],
  ["B", 1382, 2],
]);
assert.equal(platformParts(deck)[3].widthMm, 2438);
assert.equal(platformParts(deck)[3].material, "plywood 19 mm");
assert.equal(platformWarnings(deck).length, 1, "760 mm is at the guard rail height");
assert.equal(platformWarnings({ ...deck, standMm: 700 }).length, 0);
assert.equal(platformWarnings({ ...deck, standMm: 100 })[0].includes("too low"), true);

// 7. Leg positions. A 3000 deep platform needs two spans of 1500 (each under 2438), so a middle leg: three positions a side.
//    On a grid, every joist adds a position too: 1219 with 3 joists gives five. Exactly 2438 needs no middle leg.
assert.deepEqual(legPositions("corners", 3000, 7), [0, 1500, 3000]);
assert.equal(legPositions("grid", 1219, 3).length, 5);
assert.equal(legPositions("corners", 2438, 0).length, 2, "exactly 2438 needs no middle leg");
const tall = platformParts({ ...deck, depthMm: 3000 });
assert.deepEqual(rows(tall).find((r) => r[0] === "L"), ["L", 652, 6], "three leg positions a side, two legs each");

// 8. Drawings and notes. A Hollywood flat's plan mark is its face deep (64 mm), the flat's width long.
const plan = planMark(holly, 100);
assert.deepEqual(plan.outlines[0], [
  { x: 0, y: 0 },
  { x: 1219, y: 0 },
  { x: 1219, y: 64 },
  { x: 0, y: 64 },
]);
const fmt = (mm: number): string => id(Math.round(mm));
const views = elevation(holly, 100, fmt);
assert.equal(views.front.outlines.length, 1, "a lauan skin is one outline");
assert.equal(views.back.outlines.length, 5, "the back shows every member");
assert.ok(views.front.texts.some((t) => t.text === "Front"));
assert.ok(views.back.texts.some((t) => t.text === "Back"));
assert.ok(views.front.texts.some((t) => t.text === "1219" && t.angle === undefined), "overall width noted under the view");
assert.ok(views.front.texts.some((t) => t.text === "2438" && t.angle === 90), "overall height noted up the side");
assert.equal(elevation(wide, 100, fmt).front.lines.length, 1, "a 1500 skin joins at 1219");
const frameOnly = elevation({ ...holly, skin: "none" }, 100, fmt).front;
assert.equal(frameOnly.outlines.length, 5, "with no skin the front shows the framing");
const lines = noteLines(p1, fmt);
assert.equal(lines[0], "S  2 x Stile, 2438, 1x3 (19 x 64 mm)");
assert.equal(lines[3], "K  1 x Skin sheet, 2438 x 1219, lauan 5 mm");
const deckViews = elevation(deck, 100, fmt);
assert.ok(deckViews.front.texts.some((t) => t.text === "Front"));
assert.ok(deckViews.back.texts.some((t) => t.text === "Side"));
assert.equal(deckViews.back.lines.length, 1, "one brace per bay on the side");
assert.equal(deckViews.back.outlines.length, 4, "the lid, the frame and the two legs on the side");
assert.equal(deckViews.front.outlines.length, 4, "the lid, the frame and the two corner legs at the end");

console.log("flats.check: all assertions passed");
