// Checks for crossfade.ts, with each expected figure worked out by hand in the comments.

import assert from "node:assert/strict";
import { easeInOut, levelsBetween } from "./crossfade.ts";

// the midpoint of a fade from {1: 1} to {2: 1}: channel 1 falls from 1 to 0, channel 2 rises from 0 to 1,
// so each is (1 - 0.5) * own + 0.5 * other = 0.5
{
  const mid = levelsBetween({ 1: 1 }, { 2: 1 }, 0.5);
  assert.deepEqual(mid, { 1: 0.5, 2: 0.5 });
}

// the ends are the two looks exactly (a channel missing from a look is 0)
{
  assert.deepEqual(levelsBetween({ 1: 1, 3: 0.25 }, { 2: 0.8 }, 0), { 1: 1, 3: 0.25, 2: 0 });
  assert.deepEqual(levelsBetween({ 1: 1, 3: 0.25 }, { 2: 0.8 }, 1), { 1: 0, 3: 0, 2: 0.8 });
}

// a quarter of the way: channel 1 is 0.75 * 0.6 + 0.25 * 0 = 0.45 (its level in the second look is missing)
{
  const q = levelsBetween({ 1: 0.6 }, { 2: 0.4 }, 0.25);
  assert.ok(Math.abs(q[1] - 0.45) < 1e-12);
  assert.ok(Math.abs(q[2] - 0.1) < 1e-12);
}

// t outside 0 to 1 holds at the ends
{
  assert.deepEqual(levelsBetween({ 1: 1 }, { 1: 0 }, 2), levelsBetween({ 1: 1 }, { 1: 0 }, 1));
  assert.deepEqual(levelsBetween({ 1: 1 }, { 1: 0 }, -1), levelsBetween({ 1: 1 }, { 1: 0 }, 0));
}

// easing: 4 * 0.25^3 = 0.0625 at a quarter, 1 - (0.5)^3 / 2 = 0.9375 at three quarters, symmetric about the middle
{
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(0.5), 0.5);
  assert.equal(easeInOut(1), 1);
  assert.ok(Math.abs(easeInOut(0.25) - 0.0625) < 1e-12);
  assert.ok(Math.abs(easeInOut(0.75) - 0.9375) < 1e-12);
  assert.ok(Math.abs(easeInOut(0.25) + easeInOut(0.75) - 1) < 1e-12);
}

// the eased fade never runs backwards
{
  let last = -1;
  for (let i = 0; i <= 100; i++) {
    const v = easeInOut(i / 100);
    assert.ok(v >= last);
    last = v;
  }
}

console.log("crossfade.check.ts: all passed");
