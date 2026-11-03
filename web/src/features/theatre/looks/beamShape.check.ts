// Checks for beamShape.ts. Hand figures are in the comments; the exact ones are computed from the angles.

import assert from "node:assert/strict";
import { beamShape, BEAM_SEGMENTS } from "./beamShape.ts";

const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const rad = (deg: number) => (deg * Math.PI) / 180;

// A: straight down from 6 m, field 26 degrees (half-angle 13). The spot is under the lens, and every edge point
// is at 6000 * tan 13 = 6000 * 0.230868 = 1385.2 mm from it, all on the floor.
{
  const s = beamShape({ x: 0, y: 0, z: 6000 }, { x: 0, y: 0, z: 0 }, 26);
  assert.equal(s.rim.length, BEAM_SEGMENTS);
  assert.deepEqual(s.spot, { x: 0, y: 0, z: 0 });
  assert.equal(s.pools, true);
  for (const p of s.rim) {
    assert.equal(p.z, 0);
    near(Math.hypot(p.x, p.y), 6000 * Math.tan(rad(13)), 1e-6, "edge radius");
    near(Math.hypot(p.x, p.y), 1385.2, 0.1, "edge radius hand figure");
  }
  assert.deepEqual(s.apex, { x: 0, y: 0, z: 6000 });
}

// B: from (0,0,6000) to a focus at (3000,0,1700). The axis drops 4300 over 3000 across, so it sits
// atan(4300/3000) = 55.10 degrees below level. The edges are 13 degrees either side of that:
//   the steep edge, 68.10 degrees down, lands 6000 / tan 68.10 = 2412 mm out along +x (rim point 18, at phi = pi);
//   the shallow edge, 42.10 degrees down, lands 6000 / tan 42.10 = 6641 mm out (rim point 0, at phi = 0).
// The axis lands at 6000 * 3000 / 4300 = 4186 mm; the pool's middle is halfway between the edges, 4527 mm.
{
  const lens = { x: 0, y: 0, z: 6000 };
  const s = beamShape(lens, { x: 3000, y: 0, z: 1700 }, 26);
  const theta = Math.atan2(4300, 3000) * (180 / Math.PI);
  const shallow = 6000 / Math.tan(rad(theta - 13));
  const steep = 6000 / Math.tan(rad(theta + 13));
  near(s.rim[0].x, shallow, 1e-6, "shallow edge, exact");
  near(s.rim[BEAM_SEGMENTS / 2].x, steep, 1e-6, "steep edge, exact");
  near(s.rim[0].x, 6641, 2, "shallow edge, hand figure");
  near(s.rim[BEAM_SEGMENTS / 2].x, 2412, 2, "steep edge, hand figure");
  near(s.rim[0].y, 0, 1e-9, "edge stays in the tilt plane");
  near(s.rim[BEAM_SEGMENTS / 2].y, 0, 1e-9, "edge stays in the tilt plane");
  near(s.spot!.x, 4186, 1, "axis landing");
  near(s.spot!.y, 0, 1e-9, "axis landing stays in the tilt plane");
  near((s.rim[0].x + s.rim[BEAM_SEGMENTS / 2].x) / 2, 4527, 2, "pool middle");
  assert.equal(s.pools, true);
  for (const p of s.rim) assert.equal(p.z, 0);
}

// C: a focus far out at a shallow angle: the axis drops 1000 over 30000, under 2 degrees, less than the
// 13 degree half-angle, so the upper edge never reaches the floor. It stops above the floor, and the pool is open.
{
  const s = beamShape({ x: 0, y: 0, z: 6000 }, { x: 30000, y: 0, z: 5000 }, 26);
  assert.equal(s.pools, false);
  assert.ok(s.rim.some((p) => p.z > 0), "an edge stops above the floor");
  assert.ok(s.rim.some((p) => p.z === 0), "the steeper edge still lands");
}

// D: aimed up at a focus 3000 out and 3000 above the lens: no spot, no pool, and every edge rises above the lens.
{
  const s = beamShape({ x: 0, y: 0, z: 6000 }, { x: 3000, y: 0, z: 9000 }, 26);
  assert.equal(s.spot, null);
  assert.equal(s.pools, false);
  for (const p of s.rim) assert.ok(p.z > 6000, `edge ${p.z} rises above the lens`);
}

// E: no distance to the focus: the beam points straight down, as A does, with its spot under the lens.
{
  const s = beamShape({ x: 1000, y: 2000, z: 6000 }, { x: 1000, y: 2000, z: 6000 }, 26);
  assert.deepEqual(s.spot, { x: 1000, y: 2000, z: 0 });
  assert.equal(s.pools, true);
}

console.log("beamShape.check.ts: all passed");
