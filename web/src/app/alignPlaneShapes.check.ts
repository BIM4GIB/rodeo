// npx tsx src/app/alignPlaneShapes.check.ts
import type { Vec3 } from "../core/index.ts";
import { aligned, alignFrames, axisAngle, faceOnPlane, frameOfPoints, upOf, type Frame } from "./alignPlaneShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const close = (a: Vec3, b: Vec3, tol = 1e-6): boolean => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

const layer: Frame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
// a plane leaning back 30° about x, its origin up in the air
const r30 = Math.PI / 6;
const leaning: Frame = { origin: [500, -200, 1500], x: [1, 0, 0], y: [0, Math.cos(r30), Math.sin(r30)] };

// three points: the first lands on the origin, the second along x, the third on the plane's y side
for (const to of [layer, leaning]) {
  const [a, b, c]: Vec3[] = [
    [100, 200, 300],
    [100, 200, 900],
    [400, 200, 300],
  ];
  const from = frameOfPoints(a, b, c);
  ok(!!from, "three points set a frame");
  if (!from) continue;
  const al = alignFrames(from, to);
  ok(close(aligned(al, a), to.origin), `the first point on the origin (${aligned(al, a)})`);
  ok(close(aligned(al, b), add(to.origin, to.x, 600)), `the second along x (${aligned(al, b)})`);
  ok(close(aligned(al, c), add(to.origin, to.y, 300)), `the third along y (${aligned(al, c)})`);
}
ok(frameOfPoints([0, 0, 0], [100, 0, 0], [300, 0, 0]) === null, "points in a line set no frame");
ok(frameOfPoints([0, 0, 0], [0, 0, 0], [0, 100, 0]) === null, "two points at one place set no frame");

// a frame already on the plane needs no turn; one beside it, only a move
const same = alignFrames(layer, layer);
ok(same.axis === null && close(same.move, [0, 0, 0]), "a frame onto itself doesn't move");
const turnedInPlan = alignFrames({ origin: [0, 0, 0], x: [0, 1, 0], y: [-1, 0, 0] }, layer);
ok(!!turnedInPlan.axis && turnedInPlan.axis[0] === 0 && turnedInPlan.axis[1] === 0 && Math.abs(turnedInPlan.deg - 90) < 1e-9, `a frame turned in plan turns back about z (${turnedInPlan.axis}, ${turnedInPlan.deg})`);

// half turns read their axis from the diagonal
const flipped = axisAngle([
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]);
ok(!!flipped && Math.abs(flipped.deg - 180) < 1e-9 && close([Math.abs(flipped.axis[0]), Math.abs(flipped.axis[1]), Math.abs(flipped.axis[2])], [1, 0, 0]), `a half turn about x (${flipped?.axis}, ${flipped?.deg})`);
const diagonal = alignFrames({ origin: [0, 0, 0], x: [0, 1, 0], y: [1, 0, 0] }, layer);
ok(close(aligned(diagonal, [0, 1, 0]), [1, 0, 0]) && close(aligned(diagonal, [1, 0, 0]), [0, 1, 0]) && close(aligned(diagonal, [0, 0, 1]), [0, 0, -1]), "a half turn about the diagonal swaps x and y and turns z over");

// a box's side laid on the layer plane: that side at 0, the box standing above it
const box: Vec3[] = [];
for (const x of [0, 1000]) for (const y of [0, 500]) for (const z of [200, 1200]) box.push([x, y, z]);
const side = faceOnPlane([1000, 250, 700], [1, 0, 0], layer);
const moved = box.map((p) => aligned(side, p));
const onSide = box.map((p, i) => (p[0] === 1000 ? moved[i] : null)).filter((p): p is Vec3 => !!p);
ok(onSide.every((p) => Math.abs(p[2]) < 1e-6), `the side lies on the plane (${onSide.map((p) => p[2].toFixed(3))})`);
ok(moved.every((p) => p[2] > -1e-6) && moved.some((p) => p[2] > 999), "the box stands on it, a thousand up");
const kept = aligned(side, [1000, 250, 700]);
ok(Math.abs(kept[0] - 1000) < 1e-6 && Math.abs(kept[1] - 250) < 1e-6, "the clicked point keeps its place along the plane");
// its top: half a turn over, onto the plane
const top = faceOnPlane([500, 250, 1200], [0, 0, 1], layer);
ok(!!top.axis && Math.abs(top.deg - 180) < 1e-9, `the top turns over (${top.deg})`);
ok(box.map((p) => aligned(top, p)).every((p) => p[2] > -1e-6 && p[2] < 1000 + 1e-6), "and the box sits on the plane");
// its bottom: no turn, only down
const bottom = faceOnPlane([500, 250, 200], [0, 0, -1], layer);
ok(bottom.axis === null && close(bottom.move, [0, 0, -200]), `the bottom only moves down (${bottom.move})`);
// onto a leaning plane: the face's points end on it
const lean = faceOnPlane([1000, 250, 700], [1, 0, 0], leaning);
const up = upOf(leaning);
const height = (p: Vec3): number => (p[0] - leaning.origin[0]) * up[0] + (p[1] - leaning.origin[1]) * up[1] + (p[2] - leaning.origin[2]) * up[2];
ok(box.filter((p) => p[0] === 1000).every((p) => Math.abs(height(aligned(lean, p))) < 1e-6), "a side laid on a leaning plane lies on it");
ok(box.every((p) => height(aligned(lean, p)) > -1e-6), "with the box on its upper side");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
