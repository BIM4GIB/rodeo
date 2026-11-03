// Checks modelBox.ts under Node: scaled sizes worked out by hand, the joints of a platform box, and the SVG's
// units and colours. Run from web/:
//   npx tsx src/features/theatre/shop/modelBox.check.ts

import assert from "node:assert/strict";
import { combRect, modelBoxSheets, modelPieces, MODEL_SHEETS } from "./modelBox.ts";
import type { ShopPiece } from "../showTypes.ts";

const size = (outline: readonly { x: number; y: number }[]): [number, number] => [
  Math.round(Math.max(...outline.map((p) => p.x)) * 100) / 100,
  Math.round(Math.max(...outline.map((p) => p.y)) * 100) / 100,
];

const flat: ShopPiece = { id: "a", kind: "flat", name: "Flat A", widthMm: 2438, heightMm: 1219, standMm: 0, count: 1 };
const deck: ShopPiece = { id: "b", kind: "platform", name: "Deck", widthMm: 2438, heightMm: 1219, standMm: 600, count: 1 };
const T = 3;

// 1. Scale. A 2438 mm flat at 1:25 is 97.52 mm; 1219 is 48.76 mm. A flat has one piece with four corners.
const f = modelPieces([flat], 25, T);
assert.equal(f.length, 1);
assert.deepEqual(size(f[0].outline), [97.52, 48.76]);
assert.equal(f[0].outline.length, 4);

// 2. A platform at 1:25 is a top and four walls. W' = 97.52, D' = 48.76, stand 600 mm is S' = 24.
//    The top has tabs out on all four edges: (97.52 + 2 * 3) x (48.76 + 2 * 3) = 103.52 x 54.76.
//    The front wall has a tab out on its left edge only, so 97.52 + 3 by 24.
//    The left wall has a tab out on its back (right) edge only: 48.76 + 3 by 24.
const box = modelPieces([deck], 25, T);
assert.deepEqual(box.map((p) => p.name), ["Deck top", "Deck front", "Deck back", "Deck left", "Deck right"]);
assert.deepEqual(size(box[0].outline), [103.52, 54.76]);
assert.deepEqual(size(box[1].outline), [100.52, 24]);
assert.deepEqual(size(box[2].outline), [100.52, 24]);
assert.deepEqual(size(box[3].outline), [51.76, 24]);
assert.deepEqual(size(box[4].outline), [51.76, 24]);

// 3. Tabs. The top edge of a 10 x 10 square at 3 mm card: 10 / 3 = 3.33, the nearest odd count is 3 segments, each
//    3.33 long, with the middle one a tab standing 3 mm out (up the page, so y goes negative). The ends stay square.
//    Walk: (0,0) along to (3.33,0), up to (3.33,-3), across to (6.67,-3), down to (6.67,0), on to (10,0); the other
//    three sides are plain, so the square closes at (10,10) and (0,10).
const tabbed = combRect(10, 10, { top: "tab", right: "flat", bottom: "flat", left: "flat" }, 3);
assert.deepEqual(
  tabbed.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
  [
    [0, 0],
    [3.33, 0],
    [3.33, -3],
    [6.67, -3],
    [6.67, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
);

// 4. Count multiplies. Two of the same flat are two pieces.
assert.equal(modelPieces([{ ...flat, count: 2 }], 25, T).length, 2);

// 5. SVG. A3 at 1:25: a flat fits; the file is in mm with its viewBox in mm, red 0.1 mm cut lines, blue text names.
const out = modelBoxSheets([flat], { scale: 25, thickMm: T, sheetWidthMm: MODEL_SHEETS[0].widthMm, sheetHeightMm: MODEL_SHEETS[0].heightMm });
assert.equal(out.svgs.length, 1);
assert.equal(out.tooBig.length, 0);
const svg = out.svgs[0];
assert.ok(svg.includes('width="420mm" height="297mm" viewBox="0 0 420 297"'), "sheet size in mm");
assert.ok(svg.includes('stroke="#ff0000" stroke-width="0.1"'), "red hairline cut");
assert.ok(svg.includes('fill="#0000ff"'), "blue engraving");
assert.ok(svg.includes('<g id="sheet-1">'), "one group per sheet");
assert.ok(svg.includes(">Flat A</text>"), "the name is engraved as text");

// 6. A piece too big for the sheet is reported. A 20 m flat at 1:24 is 833 mm, past a 420 mm sheet.
const huge = modelBoxSheets([{ ...flat, name: "Cyc", widthMm: 20000, heightMm: 2438 }], { scale: 24, thickMm: T, sheetWidthMm: 420, sheetHeightMm: 297 });
assert.deepEqual(huge.tooBig, ["Cyc"]);
assert.equal(huge.svgs.length, 0);

// 7. Many pieces run on to a second sheet, one SVG each, each with its own group.
const many = modelBoxSheets([{ ...flat, count: 40 }], { scale: 24, thickMm: T, sheetWidthMm: 420, sheetHeightMm: 297 });
assert.ok(many.svgs.length >= 2, `${many.svgs.length} sheets`);
assert.ok(many.svgs[1].includes('<g id="sheet-2">'));

// 8. Names are escaped: an ampersand in a name is written as an entity.
const esc = modelBoxSheets([{ ...flat, name: "Ben & Jerry <1>" }], { scale: 25, thickMm: T, sheetWidthMm: 420, sheetHeightMm: 297 });
assert.ok(esc.svgs[0].includes("Ben &amp; Jerry &lt;1&gt;"));

console.log("modelBox.check: all assertions passed");
