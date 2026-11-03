// npx tsx src/app/videoCameraShapes.check.ts
import { aspectOf, BODIES, bodyNamed, cameraPlan, cameraSolids, diagonalAngle, focalForDiagonal, focalOn, lensFront, lensNamed, lookOf, panToward, picture, tiltToward } from "./videoCameraShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

// a full-frame body's 43.3 mm diagonal: a 43.3 mm lens sees about 53° across it
const ff = bodyNamed("Full frame");
ok(near(diagonalAngle(ff, Math.hypot(36, 24)), 2 * Math.atan(0.5) * (180 / Math.PI)), "the diagonal angle of a lens as long as the diagonal");
ok(near(diagonalAngle(ff, 50), 46.79, 0.01), `a 50 mm lens on full frame sees 46.8° diagonally (${diagonalAngle(ff, 50).toFixed(2)})`);
for (const body of BODIES) for (const f of [5, 24, 85, 400]) ok(near(focalForDiagonal(body, diagonalAngle(body, f)), f, 1e-6), `angle and focal length go back and forth (${body.name}, ${f} mm)`);
ok(bodyNamed("nonesuch") === BODIES[0], "an unknown body is the first");

// lenses keep their focal length within their range
const studio = lensNamed("Studio zoom 8.5–170 mm");
ok(focalOn(studio, 4) === 8.5 && focalOn(studio, 500) === 170 && focalOn(studio, 50) === 50, "a zoom keeps to its range");
ok(focalOn(lensNamed("Prime 50 mm"), 20) === 50, "a prime keeps its length");

// the picture: a 16:9 format on a 3:2 sensor uses its full width, a 4:3 one its full height
const wide = picture(ff, 50, aspectOf("16:9", ff, 0));
ok(near(wide.width, 36) && near(wide.height, 20.25), `16:9 on full frame is 36 × 20.25 (${wide.width} × ${wide.height})`);
const square = picture(ff, 50, aspectOf("4:3", ff, 0));
ok(near(square.height, 24) && near(square.width, 32), `4:3 on full frame is 32 × 24 (${square.width} × ${square.height})`);
ok(near(wide.across, 39.6, 0.05), `a 50 mm lens sees 39.6° across full frame (${wide.across.toFixed(2)})`);
ok(near(aspectOf("Camera Default", ff, 0), 1.5) && near(aspectOf("Custom Aspect", ff, 2), 2) && near(aspectOf("Custom Aspect", ff, 0), 1.5), "Camera Default and Custom Aspect");

// which way it looks
const level = { pan: 0, tilt: 0, roll: 0, height: 1500 };
ok(lookOf(level).every((v, i) => near(v, [1, 0, 0][i])), "level and unpanned it looks along x");
const turned = lookOf({ ...level, pan: 90, tilt: 30 });
ok(near(turned[0], 0) && near(turned[1], Math.cos(Math.PI / 6)) && near(turned[2], 0.5), `panned left and tilted up (${turned})`);
ok(near(lookOf({ ...level, pan: 170 })[1], 1), "the pan stops at 90°");
const front = lensFront(level);
ok(near(front[0], 310) && near(front[1], 0) && near(front[2], 1500), `the lens's front ahead of the pivot at its height (${front})`);

// aiming
ok(near(panToward({ x: 1000, y: 1000 })!, 45) && panToward({ x: -1000, y: 10 }) === null && panToward({ x: 0, y: 0 }) === null, "a pan toward a point, none behind it");
ok(near(tiltToward(1500, 1500, 0), -45) && near(tiltToward(1500, 1000, 1500), 0), "a tilt down to the floor and level with the lens");

// the plan: the field of view reaches as far as asked, as wide as the picture
const plan = cameraPlan(level, "Tripod", 40, 5000);
ok(plan.standLines.length === 3 && plan.stand.length === 0, "a tripod's three legs");
ok(!!plan.field && near(plan.field[1].x, 310 + 5000) && near(plan.field[1].y, -5000 * Math.tan((20 * Math.PI) / 180)), `the field's far corner (${JSON.stringify(plan.field?.[1])})`);
ok(cameraPlan(level, "None", 40, 0).field === null && cameraPlan(level, "Pedestal", 40, 1000).stand.length === 1, "no field at no reach; a pedestal's base");
const bodyXs = plan.body.map((p) => p.x);
ok(near(Math.min(...bodyXs), -260) && near(Math.max(...bodyXs), 90), "the body from behind the pivot to the lens");
const tilted = cameraPlan({ ...level, tilt: 60 }, "Tripod", 40, 5000);
ok(Math.max(...tilted.lens.map((p) => p.x)) < Math.max(...plan.lens.map((p) => p.x)), "a tilt foreshortens the lens from above");

// the solids: the head at the lens's height, the stand down to the floor
const solids = cameraSolids(level, "Tripod");
const zs = (faces: number[][]): number[] => faces.flatMap((f) => f.filter((_, i) => i % 3 === 2));
ok(near(Math.min(...zs(solids.head)), 1390) && near(Math.max(...zs(solids.head)), 1610), "the head is centred on the lens's height");
ok(near(Math.min(...zs(solids.stand)), 0, 20) && Math.max(...zs(solids.stand)) <= 1350 + 20, "the tripod stands on the floor under the head");
ok(cameraSolids(level, "None").stand.length === 0, "no stand");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
