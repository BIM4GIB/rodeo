// Node check of Create Animation's camera paths. Run from web/: npx tsx src/features/render/animationPath.check.ts

import assert from "node:assert/strict";
import {
  addKeyframe,
  cameraAt,
  deleteKeyframe,
  keyAt,
  keyTime,
  orbitPath,
  pathLength,
  readPath,
  setKeyframe,
  spinPath,
  viewsPath,
  walkPath,
  writePath,
  type V3,
} from "./animationPath.ts";

const near = (a: number, b: number, tol = 1e-6, what = ""): void => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} ≠ ${b}`);
const nearPt = (a: V3, b: V3, tol = 1e-6, what = ""): void => {
  near(a.x, b.x, tol, `${what} x`);
  near(a.y, b.y, tol, `${what} y`);
  near(a.z, b.z, tol, `${what} z`);
};
const P = (x: number, y: number, z = 0): V3 => ({ x, y, z });

// a straight walk 0–10 m, keyframes at both ends: even pace, looking level and ahead
{
  const p = walkPath([P(0, 0, 1600), P(10000, 0, 1600)], [], "walk", 55);
  near(pathLength(p), 10000);
  nearPt(cameraAt(p, 0).eye, P(0, 0, 1600));
  nearPt(cameraAt(p, 0.5).eye, P(5000, 0, 1600), 1e-6, "halfway");
  nearPt(cameraAt(p, 1).eye, P(10000, 0, 1600));
  const c = cameraAt(p, 0.25);
  assert.ok(c.target.x > c.eye.x && c.target.z === c.eye.z && c.target.y === 0, "looks ahead, level");
  // at the end it looks on along the last stretch
  const end = cameraAt(p, 1);
  assert.ok(end.target.x > end.eye.x, "looks on at the end");
}

// an L: keyframes on the corner; the camera turns before it reaches it
{
  const p = walkPath([P(0, 0), P(10000, 0), P(10000, 10000)], [1], "fly", 55);
  assert.deepEqual(
    p.keys.map((k) => k.at),
    [0, 1, 2],
  );
  near(keyTime(p, 1), 0.5);
  nearPt(cameraAt(p, 0.5).eye, P(10000, 0));
  const before = cameraAt(p, 0.49);
  assert.ok(before.target.y > 0, "looking round the corner before it");
  assert.equal(keyAt(p, 0.5), 1);
  assert.equal(keyAt(p, 0.4), null);
}

// speed: the first keyframe fast (100%), the last slow (−50%): halfway in time is past halfway in length
{
  const base = walkPath([P(0, 0), P(10000, 0)], [], "fly", 55);
  const p = setKeyframe(setKeyframe(base, 0, { speed: 100 }), 1, { speed: -50 });
  assert.equal(p.keys[0].speed, 100);
  assert.equal(p.keys[1].speed, -50);
  const x = cameraAt(p, 0.5).eye.x;
  assert.ok(x > 5000, `fast start covers more in the first half: ${x}`);
  // pace goes from 2 to 0.5 linearly in distance: time = L ln(b/a)/(b−a); check the halfway point exactly
  const L = 10000, a = 2, b = 0.5;
  const total = (L * Math.log(b / a)) / (b - a);
  const k = (b - a) / L;
  near(x, (a * (Math.exp((k * total) / 2) - 1)) / k, 1e-6, "halfway distance");
  // speeds stay in range
  assert.equal(setKeyframe(p, 0, { speed: 500 }).keys[0].speed, 100);
  assert.equal(setKeyframe(p, 0, { angle: 5 }).keys[0].angle, 12);
  assert.equal(setKeyframe(p, 0, { angle: 500 }).keys[0].angle, 130);
}

// orbit: 360° round the centre at the start's height and distance, 8 spans of 45°, always looking at the centre
{
  const c = P(1000, 2000, 500);
  const p = orbitPath(c, P(1000 + 20000, 2000, 3000), 360, 50, "orbit");
  assert.equal(p.keys.length, 9);
  near(pathLength(p), 2 * Math.PI * 20000, 2 * Math.PI * 20000 * 0.005, "about a circle");
  for (const t of [0, 0.1, 0.37, 0.5, 0.99, 1]) {
    const cam = cameraAt(p, t);
    near(Math.hypot(cam.eye.x - c.x, cam.eye.y - c.y), 20000, 20000 * 0.01, `radius at ${t}`);
    near(cam.eye.z, 3000);
    nearPt(cam.target, c, 1e-6, "target");
    near(cam.angle, 50);
  }
  nearPt(cameraAt(p, 0.25).eye, P(1000, 2000 + 20000, 3000), 1, "a quarter round is a keyframe, counter-clockwise");
  nearPt(cameraAt(p, 1).eye, P(1000 + 20000, 2000, 3000), 1e-6, "back where it began");
  // 90° makes two keyframes 90° apart... at 45° steps, three
  assert.equal(orbitPath(c, P(0, 0, 0), 90, 50, "fly").keys.length, 3);
}

// spin: once round, over and under, looking at the centre
{
  const c = P(0, 0, 400);
  const p = spinPath(c, 3000, -90, 40, 50);
  assert.equal(p.keys.length, 9);
  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i <= 100; i++) {
    const cam = cameraAt(p, i / 100);
    // on the ball, give or take the 5° chords it is drawn in
    near(Math.hypot(cam.eye.x, cam.eye.y, cam.eye.z - 400), 3000, 3000 * (1 - Math.cos(Math.PI / 72)) * 2, "on the ball");
    hi = Math.max(hi, cam.eye.z);
    lo = Math.min(lo, cam.eye.z);
    nearPt(cam.target, c);
  }
  near(hi, 400 + 3000 * Math.sin(Math.PI * 40 / 180), 1, "as high as it rises");
  near(lo, 400 - 3000 * Math.sin(Math.PI * 40 / 180), 1, "as far below");
  nearPt(cameraAt(p, 0).eye, P(0, -3000 * Math.cos(Math.PI * 40 / 180), 400 + 3000 * Math.sin(Math.PI * 40 / 180)), 1e-6, "starts in front, above");
}

// saved views: straight from eye to eye, look-to points and angles blended between
{
  const p = viewsPath([
    { eye: P(0, 0, 0), target: P(0, 1000, 0), angle: 40 },
    { eye: P(10000, 0, 0), target: P(10000, 1000, 0), angle: 80 },
  ]);
  const cam = cameraAt(p, 0.5);
  nearPt(cam.eye, P(5000, 0, 0));
  nearPt(cam.target, P(5000, 1000, 0));
  near(cam.angle, 60);
}

// add a keyframe partway, then delete it: the camera's course is unchanged
{
  const p = walkPath([P(0, 0), P(10000, 0), P(10000, 10000)], [1], "fly", 55);
  assert.equal(addKeyframe(p, 0.5), null, "on a keyframe already");
  const q = addKeyframe(p, 0.25)!;
  assert.equal(q.keys.length, 4);
  assert.equal(q.points.length, 4);
  nearPt(q.points[q.keys[1].at], P(5000, 0), 1e-6, "the new vertex");
  for (const t of [0.1, 0.3, 0.6, 0.9]) nearPt(cameraAt(q, t).eye, cameraAt(p, t).eye, 1e-6, `same course at ${t}`);
  assert.equal(keyAt(q, 0.25), 1);
  const r = deleteKeyframe(q, 1)!;
  assert.equal(r.keys.length, 3);
  assert.equal(deleteKeyframe(q, 0), null, "not the first");
  assert.equal(deleteKeyframe(q, 3), null, "not the last");
  // a keyframe added on an orbit takes the look-to point between its neighbours
  const o = orbitPath(P(0, 0, 0), P(10000, 0, 0), 360, 50, "fly");
  const o2 = addKeyframe(o, 0.06)!;
  assert.equal(o2.keys.length, 10);
  nearPt(o2.keys[1].target!, P(0, 0, 0));
}

// written and read back
{
  const p = setKeyframe(orbitPath(P(0, 0, 0), P(10000, 0, 1600), 180, 50, "orbit"), 2, { speed: -30 });
  const q = readPath(writePath(p))!;
  assert.equal(q.type, "orbit");
  assert.equal(q.points.length, p.points.length);
  assert.equal(q.keys[2].speed, -30);
  nearPt(q.points[3], p.points[3], 0.05);
  const w = readPath(writePath(walkPath([P(0, 0, 1600), P(5000, 0, 1600)], [], "walk", 55)))!;
  assert.equal(w.keys[0].target, null);
  assert.equal(readPath("nonsense"), null);
  assert.equal(readPath("fly;0 0 0;5 - - - 55 0"), null, "a keyframe off the path");
}

console.log("animationPath: all checks passed");
