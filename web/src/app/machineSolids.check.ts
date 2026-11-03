// Checks machineSolids.ts under Node, by volume: a closed solid with its faces wound outward gives
// its volume by the divergence theorem. Run from web/:
//   npx tsx src/app/machineSolids.check.ts

import { circularPins, CHAINS, linearPins, offsetLinkTop } from "./chainShapes.ts";
import { bevelSolid, chainSolid, coilSolid, extensionSolid, offsetLinkSolid, toothedSolid, torsionSolid, wormSolid } from "./machineSolids.ts";
import { circleOutline, type Solid } from "./solids3d.ts";

let failures = 0;
const volume = (solid: Solid): number => {
  let v = 0;
  for (const f of solid) {
    for (let i = 1; i + 1 < f.length / 3; i++) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = [f[0], f[1], f[2], f[3 * i], f[3 * i + 1], f[3 * i + 2], f[3 * i + 3], f[3 * i + 4], f[3 * i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
};
const low = (solid: Solid): number => {
  let z = Infinity;
  for (const f of solid) for (let i = 2; i < f.length; i += 3) z = Math.min(z, f[i]);
  return z;
};
const near = (got: number, want: number, share: number, what: string): void => {
  const ok = Math.abs(got - want) <= share * Math.abs(want);
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", what, got.toFixed(1), want.toFixed(1));
};
const onLayer = (solid: Solid, what: string): void => {
  const ok = Math.abs(low(solid)) < 1e-6;
  if (!ok) failures++;
  console.log(ok ? "ok  " : "FAIL", what, "on the layer", low(solid).toFixed(3));
};

// a wheel: radius 50 teeth on a section with a bore of 10 and a face of 20
const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const ring = toothedSolid(circleOutline({ x: 0, y: 0 }, 50, 240), [rect(0, -50, 20, -10), rect(0, 10, 20, 50)]);
// (the teeth sink a little into the body, so it counts a thin ring twice)
near(volume(ring), Math.PI * (2500 - 100) * 20, 0.02, "a wheel whose teeth are all root: a ring's volume, outward");

// a round-wire coil: the wire's area (an octagon's) along its length
const r = 8;
const wire = 2;
const octagon = 2 * Math.SQRT2 * (wire / 2) ** 2;
const coil = coilSolid({ wire: { kind: "round", width: wire }, total: 6, along: [{ u: 0, s: 1 }, { u: 6, s: 37 }], r0: r, r1: r, length: 38, ground: false, leftHand: false });
near(volume(coil), octagon * 6 * Math.hypot(2 * Math.PI * r, 6), 0.05, "a coil spring's wire");
onLayer(coil, "a coil spring");
const left = coilSolid({ wire: { kind: "round", width: wire }, total: 6, along: [{ u: 0, s: 1 }, { u: 6, s: 37 }], r0: r, r1: r, length: 38, ground: false, leftHand: true });
near(volume(left), volume(coil), 0.05, "a left-hand coil is outward too");
const die = coilSolid({ wire: { kind: "rect", width: 2, height: 3 }, total: 6, along: [{ u: 0, s: 1 }, { u: 6, s: 37 }], r0: r, r1: r, length: 38, ground: false, leftHand: false });
near(volume(die), 2 * 3 * 6 * Math.hypot(2 * Math.PI * r, 6), 0.05, "a rectangular wire's coil");

// a worm: outward, and more than its root with less than its outside
const worm = wormSolid({ pitchDiameter: 40, axialPitch: 10, pressureAngle: 20, starts: 1, faceWidth: 60, profile: "detailed", hub: null, bore: null });
const rootR = 20 - (1.25 * 10) / Math.PI;
const tipR = 20 + 10 / Math.PI;
const wv = volume(worm);
const fine = wv > Math.PI * rootR ** 2 * 60 && wv < Math.PI * tipR ** 2 * 60;
if (!fine) failures++;
console.log(fine ? "ok  " : "FAIL", "a worm's volume between its root's and its outside's", wv.toFixed(1));
onLayer(worm, "a worm");

// a chain: plates, rollers and pins all outward
const chain = CHAINS[2];
const linear = chainSolid(chain, linearPins(chain, 4), true);
const circular = chainSolid(chain, circularPins(chain, 20, 4, 0, false), true);
near(volume(circular), volume(linear), 0.02, "a chain has the same volume straight or round a sprocket");
onLayer(linear, "a chain");
const offset = offsetLinkSolid(chain, offsetLinkTop(chain, null).outlines);
if (!(volume(offset) > 0)) failures++;
onLayer(offset, "an offset link");

// a torsion spring and an extension spring's wire
const torsion = torsionSolid({ outside: 20, wire: 2, coils: 8, left: { length: 40, direction: "up", orientation: "normal" }, right: { length: 30, direction: "down", orientation: "normal" }, leftHand: false });
near(volume(torsion), octagon * (2 * Math.PI * 9 * 8 + 40 + 30), 0.05, "a torsion spring's wire, coils and legs");
const ext = extensionSolid({ outside: 20, wire: 2, free: 80, length: 90, hook: 10, style: "loop", view: "facing", allCoils: true, leftHand: false });
if (!(volume(ext) > 0)) failures++;
onLayer(ext, "an extension spring");

// a turned bevel about a tilted axis keeps its volume
const cone = [{ x: 0, y: -10 }, { x: 10, y: -10 }, { x: 0, y: 0 }];
const down = bevelSolid([{ profile: cone, body: { x: 0, y: -1 } }]);
const tilted = bevelSolid([{ profile: cone, body: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } }]);
near(volume(tilted), (Math.PI * 100 * 10) / 3, 0.02, "a bevel's cone about a tilted axis");
near(volume(down), (Math.PI * 100 * 10) / 3, 0.02, "a bevel's cone about its upright axis");

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all checks passed");
