// Checks photometry.ts against numbers worked out by hand. Run with:
//   npx tsx src/features/theatre/beam/photometry.check.ts

import assert from "node:assert/strict";
import {
  coverage,
  curveOf,
  gelBrightness,
  illuminance,
  peakCandela,
  poolOutline,
  poolSize,
  relativeIntensity,
  statsOf,
  throwMm,
  type Photometric,
} from "./photometry.ts";

const DEG = Math.PI / 180;
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not ${b} (tolerance ${tol})`);

// Trapezoid rule over 200 000 steps, an independent quadrature of the flux 2π ∫ I(θ) sinθ dθ with I0 = 1.
function fluxTrapezoid(beamDeg: number, fieldDeg: number): number {
  const c = curveOf(beamDeg, fieldDeg);
  const n = 200000;
  const h = Math.PI / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const t = i * h;
    const w = i === 0 || i === n ? 0.5 : 1;
    s += w * Math.exp(-c.a * Math.pow(t, c.p)) * Math.sin(t);
  }
  return 2 * Math.PI * s * h;
}

// 1. The curve for beam 18°, field 26°. p = ln(ln10/ln2) / ln(26/18) = ln(3.32193) / ln(1.44444)
//    = 1.20060 / 0.36772 = 3.2648. a = ln2 / (9°)^p, so exactly half the peak at 9° and a tenth at 13°.
const c = curveOf(18, 26);
near(c.p, 3.2648, 1e-3, "exponent p");
near(relativeIntensity(c, 9), 0.5, 1e-6, "I at the beam's half angle");
near(relativeIntensity(c, 13), 0.1, 1e-6, "I at the field's half angle");
assert.equal(relativeIntensity(c, 0), 1);
// A field no wider than the beam is taken as 1.05 × the beam: 18.9°, so its half angle is 9.45°.
const narrow = curveOf(18, 10);
near(relativeIntensity(narrow, 9), 0.5, 1e-6, "I at 9° when the field is narrower");
near(relativeIntensity(narrow, 9.45), 0.1, 1e-6, "I at 9.45° (1.05 × the beam's half angle)");

// 2. Lumens to candela: flux = 2π ∫ I sinθ dθ. The Simpson rule here and a 200 000-step trapezoid agree.
const lumens = 10500;
const i0 = peakCandela(lumens, 18, 26);
near(i0, lumens / fluxTrapezoid(18, 26), 1e-4 * (lumens / fluxTrapezoid(18, 26)), "candela on the axis");
assert.equal(peakCandela(0, 18, 26), 0, "no lumens, no candela");

// 3. A fixture 5 m straight above a point, 1000 cd on the axis: E = I · cos / d² = 1000 / 5² = 40 lx.
//    The lumens for 1000 cd are 1000 × flux, so the Simpson figure must give 1000 cd back.
const body = { channel: "1", color: "", heightMm: 5000, focus: null, beamDeg: 18, fieldDeg: 26 };
const lamp: Photometric = { ...body, at: { x: 0, y: 0 }, lumens: 1000 * fluxTrapezoid(18, 26) };
near(illuminance(lamp, { x: 0, y: 0, z: 0 }), 40, 1e-3, "lux 5 m below, on the axis");
// A point 13° off the axis (horizontal offset 5 m · tan 13°) sits at the field's edge: I = 0.1 × 1000 cd.
// d = 5 / cos13° m, cos(incidence) = cos13°, so E = 100 · cos13° · cos²13° / 25 = 4 · cos³13°.
const edge = 5000 * Math.tan(13 * DEG);
near(illuminance(lamp, { x: edge, y: 0, z: 0 }), 4 * Math.pow(Math.cos(13 * DEG), 3), 1e-3, "lux at the field's edge");
// Level scales it; a point above the lens gets nothing.
near(illuminance(lamp, { x: 0, y: 0, z: 0 }, 0.5), 20, 1e-3, "lux at half level");
assert.equal(illuminance(lamp, { x: 0, y: 0, z: 6000 }), 0, "above the lens");

// 4. A cone straight down: its pool on the plane z = 1700 is a circle of diameter 2 · T · tan(field/2),
//    with the throw T = 6000 − 1700 = 4300 mm: radius 4300 · tan13° = 992.73 mm, diameter 1985.47 mm.
const straight: Photometric = {
  at: { x: 0, y: 0 },
  heightMm: 6000,
  focus: { x: 0, y: 0, z: 1700 },
  beamDeg: 18,
  fieldDeg: 26,
  lumens: 10500,
  channel: "",
  color: "",
};
const radius = 4300 * Math.tan(13 * DEG);
const ring = poolOutline(straight, 1700, 26);
assert.equal(ring.length, 64);
for (const p of ring) near(Math.hypot(p.x, p.y), radius, 1e-6, "pool radius");
near(Math.hypot(ring[0].x - ring[32].x, ring[0].y - ring[32].y), 2 * radius, 1e-6, "pool diameter across");
near(throwMm(straight), 4300, 1e-9, "throw");
near(poolSize(straight, 26), 2 * radius, 1e-6, "pool size straight on");

// 5. An oblique cone: the lens (0,0,6000) aims at (10000,0,5000), 84.3° from straight down, and its field
//    is 20°, so some rays run up past 85° and are drawn 60 m out instead of reaching the plane.
const slant: Photometric = { ...straight, focus: { x: 10000, y: 0, z: 5000 }, fieldDeg: 20 };
const slantRing = poolOutline(slant, 1700, 20);
assert.ok(slantRing.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert.ok(Math.max(...slantRing.map((p) => Math.hypot(p.x, p.y))) > 50000, "a ray running up is clipped far out");

// 6. Gel brightness: L201 is #8fb6ff = (143, 182, 255): 0.2126·143/255 + 0.7152·182/255 + 0.0722·1 = 0.70196.
near(gelBrightness("L201"), 0.2126 * (143 / 255) + 0.7152 * (182 / 255) + 0.0722, 1e-9, "L201 brightness");
assert.equal(gelBrightness(""), 1, "open white lets all through");

// 7. Coverage over one cell straight below the lamp gives 40 lx; a 0.5 level gives 20; an L201 gel gives 40 × 0.70196.
const one = { x0: -1, y0: -1, x1: 1, y1: 1 };
near(coverage([lamp], () => 1, one, 1, 1, 0).lux[0], 40, 1e-3, "coverage in one cell");
near(coverage([lamp], () => 0.5, one, 1, 1, 0).lux[0], 20, 1e-3, "coverage at half level");
near(coverage([{ ...lamp, color: "L201" }], () => 1, one, 1, 1, 0).lux[0], 40 * gelBrightness("L201"), 1e-3, "coverage through L201");
assert.equal(coverage([lamp], () => 0, one, 1, 1, 0).lux[0], 0, "a level of 0 lights nothing");

// 8. Stats of 10, 20, 30, 40: min 10, average 25, max 40, uniformity 10 / 25 = 0.4.
assert.deepEqual(statsOf(new Float32Array([10, 20, 30, 40])), { min: 10, avg: 25, max: 40, uniformity: 0.4 });

console.log("photometry.check.ts: all checks pass");
