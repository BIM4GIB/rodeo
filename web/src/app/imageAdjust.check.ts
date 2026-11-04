// Node check of the image effects' pixel work. Run from web/: npx tsx src/app/imageAdjust.check.ts

import assert from "node:assert/strict";
import { applyEffects, autoLevel, isPlain, needsAlpha, NO_EFFECTS, type ImageEffects } from "./imageAdjust.ts";

type RGBA = [number, number, number, number];

/** A `w` × `h` picture of one colour. */
function flat(w: number, h: number, c: RGBA): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) px.set(c, i);
  return px;
}

/** One pixel's colour after the effects `e`. */
function one(c: RGBA, e: Partial<ImageEffects>): RGBA {
  const px = flat(1, 1, c);
  applyEffects(px, 1, 1, { ...NO_EFFECTS, ...e });
  return [px[0], px[1], px[2], px[3]];
}

const at = (px: Uint8ClampedArray, w: number, x: number, y: number, c = 0): number => px[(y * w + x) * 4 + c];

// nothing set leaves the picture alone
assert.ok(isPlain(NO_EFFECTS));
assert.deepEqual(one([12, 130, 250, 200], {}), [12, 130, 250, 200]);
assert.ok(!needsAlpha({ ...NO_EFFECTS, exposure: 50 }) && needsAlpha({ ...NO_EFFECTS, softEdges: 1 }));

// Exposure: two stops each way
assert.deepEqual(one([64, 64, 64, 255], { exposure: 100 }).slice(0, 3), [255, 255, 255]);
assert.deepEqual(one([128, 128, 128, 255], { exposure: -100 }).slice(0, 3), [32, 32, 32]);
assert.ok(one([100, 100, 100, 255], { exposure: 30 })[0] > 100);

// Contrast about middle grey; down washes out without going flat
assert.ok(one([64, 64, 64, 255], { contrast: 50 })[0] < 64);
assert.ok(one([192, 192, 192, 255], { contrast: 50 })[0] > 192);
const washed = one([0, 0, 0, 255], { contrast: -100 })[0];
assert.ok(washed > 64 && washed < 128, `washed-out black ${washed}`);

// Highlights move only light parts, Shadows only dark ones (to the right, darker)
assert.ok(one([230, 230, 230, 255], { highlights: 100 })[0] > 230);
assert.equal(one([20, 20, 20, 255], { highlights: 100 })[0], 20);
assert.ok(one([40, 40, 40, 255], { shadows: 100 })[0] < 40);
assert.ok(one([40, 40, 40, 255], { shadows: -100 })[0] > 40);
assert.equal(one([220, 220, 220, 255], { shadows: 100 })[0], 220);

// Saturation: −100 is grey, up spreads the channels
const grey = one([200, 60, 30, 255], { saturation: -100 });
assert.ok(grey[0] === grey[1] && grey[1] === grey[2]);
const vivid = one([150, 110, 100, 255], { saturation: 100 });
assert.ok(vivid[0] - vivid[2] > 50);

// Temperature: warmer is redder and less blue
const warm = one([128, 128, 128, 255], { temperature: 100 });
assert.ok(warm[0] > 128 && warm[2] < 128 && warm[1] === 128);

// Sepia at 100: the classic sepia tone; Invert: a negative
assert.deepEqual(one([100, 100, 100, 255], { sepia: 100 }).slice(0, 3), [135, 120, 94]);
assert.deepEqual(one([10, 20, 30, 77], { invert: true }), [245, 235, 225, 77]);

// Blur: a hard black/white edge softens; far from it the picture stays
const W = 200;
const H = 40;
const edge = (): Uint8ClampedArray => {
  const px = flat(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) for (let x = W / 2; x < W; x++) px.set([255, 255, 255, 255], (y * W + x) * 4);
  return px;
};
const soft = edge();
applyEffects(soft, W, H, { ...NO_EFFECTS, sharpness: -100 });
const mid = at(soft, W, W / 2, H / 2);
assert.ok(mid > 60 && mid < 200, `blurred edge ${mid}`);
assert.equal(at(soft, W, 5, 5), 0);
assert.equal(at(soft, W, W - 5, 5), 255);
assert.equal(at(soft, W, W / 2, 5, 3), 255, "a solid picture stays solid");

// Sharpness: a soft ramp between two greys gets crisper corners (darker at its foot, lighter at its top)
const ramp = (): Uint8ClampedArray => {
  const px = flat(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.min(192, Math.max(64, (x - 86) * 6.4 + 64));
      px.set([v, v, v, 255], (y * W + x) * 4);
    }
  return px;
};
const before = ramp();
const crisp = ramp();
applyEffects(crisp, W, H, { ...NO_EFFECTS, sharpness: 100 });
assert.ok(at(crisp, W, 87, H / 2) < at(before, W, 87, H / 2), "darker at the foot");
assert.ok(at(crisp, W, 105, H / 2) > at(before, W, 105, H / 2), "lighter at the top");
assert.equal(at(crisp, W, 20, H / 2), 64);
assert.equal(at(crisp, W, 96, H / 2), at(before, W, 96, H / 2), "a straight stretch stays");

// blurring is sized to the picture: a quarter-size preview blurs over a quarter the pixels
const reach = (w: number): number => {
  const px = flat(w, 8, [0, 0, 0, 255]);
  for (let y = 0; y < 8; y++) for (let x = w / 2; x < w; x++) px.set([255, 255, 255, 255], (y * w + x) * 4);
  applyEffects(px, w, 8, { ...NO_EFFECTS, sharpness: -100 });
  let n = 0;
  for (let x = 0; x < w; x++) if (at(px, w, x, 4) > 10 && at(px, w, x, 4) < 245) n++;
  return n;
};
const big = reach(800);
const small = reach(200);
assert.ok(Math.abs(big / small - 4) < 1.2, `blur widths ${big} and ${small}`);

// Soft Edges: corners fade out, the middle stays solid, colour untouched
const card = flat(100, 60, [90, 80, 70, 255]);
applyEffects(card, 100, 60, { ...NO_EFFECTS, softEdges: 100 });
assert.equal(at(card, 100, 0, 0, 3), 0);
assert.equal(at(card, 100, 50, 30, 3), 255);
assert.ok(at(card, 100, 5, 30, 3) > 0 && at(card, 100, 5, 30, 3) < 255);
assert.equal(at(card, 100, 0, 0, 0), 90);

// Auto-Level: a dull picture (80 to 160) stretched to nearly black and white; a flat one left
const dull = new Uint8ClampedArray(81 * 4);
for (let v = 0; v <= 80; v++) dull.set([80 + v, 80 + v, 80 + v, 255], v * 4);
const lv = autoLevel(dull);
assert.ok(lv.exposure !== 0 && lv.contrast > 0, JSON.stringify(lv));
const levelled = new Uint8ClampedArray(dull);
applyEffects(levelled, 81, 1, { ...NO_EFFECTS, ...lv });
assert.ok(levelled[0] < 20 && levelled[80 * 4] > 235, `levelled ${levelled[0]}..${levelled[80 * 4]}`);
assert.deepEqual(autoLevel(flat(4, 4, [120, 120, 120, 255])), { exposure: 0, contrast: 0 });

// a 12-megapixel picture takes every effect in reasonable time
const bigW = 4000;
const bigH = 3000;
const photo = new Uint8ClampedArray(bigW * bigH * 4);
for (let i = 0; i < photo.length; i += 4) photo.set([(i >> 2) % 251, (i >> 3) % 241, (i >> 4) % 239, 255], i);
const t0 = performance.now();
applyEffects(photo, bigW, bigH, { ...NO_EFFECTS, exposure: 20, contrast: 20, highlights: 10, shadows: 10, saturation: 20, temperature: 10, sharpness: -60, sepia: 10, softEdges: 20 });
console.log(`12 MP, every effect: ${Math.round(performance.now() - t0)} ms`);

console.log("imageAdjust: all checks passed");
