// Checks hvacShapes.ts under Node, each solid by its volume: a closed solid with its faces wound
// outward gives its volume by the divergence theorem. Run from web/:
//   npx tsx src/app/hvacShapes.check.ts

import { damperSolid, diffuserProblem, diffuserSolid, elbow, elbowSolid, flexDuct, flexDuctSolid, flexPath, outletSolid, splitter, splitterProblem, splitterSolid, straightDuct, straightDuctSolid, transition, transitionSolid, verticalDuct, verticalDuctSolid, type Diffuser, type DuctSection, type Splitter } from "./hvacShapes.ts";
import type { Solid } from "./solids3d.ts";

let failures = 0;
function near(got: number, want: number, tol: number, what: string): void {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? "ok  " : "FAIL"} ${what} ${got.toFixed(1)} ${want.toFixed(1)}`);
  if (!ok) failures++;
}
const volume = (solid: Solid): number => {
  let v = 0;
  for (const f of solid) {
    for (let i = 3; i + 5 < f.length; i += 3) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = [f[0], f[1], f[2], f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
};
const lowest = (solid: Solid): number => Math.min(...solid.flatMap((f) => f.filter((_, i) => i % 3 === 2)));
const area = (o: readonly { x: number; y: number }[]): number => Math.abs(o.reduce((a, p, i) => { const q = o[(i + 1) % o.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);

const rect: DuctSection = { shape: "rect", width: 400, height: 300 };
const round: DuctSection = { shape: "round", width: 200, height: 0 };

near(area(straightDuct(1000, rect).outlines[0]), 400000, 1e-6, "straight: its plan");
near(volume(straightDuctSolid(1000, rect, 2700)), 400 * 300 * 1000, 1, "straight, rectangular");
near(lowest(straightDuctSolid(1000, rect, 2700)), 2550, 1e-6, "its underside below its centre");
near(volume(straightDuctSolid(1000, round, 0)) / (Math.PI * 100 * 100 * 1000), 1, 0.02, "straight, round, of facets");

// by Pappus: the section's area along the centre line's arc
const bend = { section: rect, inner: 200, angle: 90, right: false };
near(volume(elbowSolid(bend, 0)), 400 * 300 * 400 * (Math.PI / 2), 2e5, "elbow, by its centre line");
near(area(elbow(bend).outlines[0]), (Math.PI / 4) * (600 * 600 - 200 * 200), 1000, "elbow: its plan");
near(Math.max(...elbow(bend).outlines[0].map((p) => p.y)), 400, 1e-6, "left: its end reaches +y, at its centre line's radius");
near(Math.max(...elbow(bend).outlines[0].map((p) => p.x)), 600, 1e-6, "its outer side's reach along the run");
near(Math.min(...elbow({ ...bend, right: true }).outlines[0].map((p) => p.y)), -400, 1e-6, "right: it reaches -y");

near(volume(verticalDuctSolid(rect, 100, 2000)), 400 * 300 * 2000, 1, "riser");
near(lowest(verticalDuctSolid(rect, 100, 2000)), 100, 1e-6, "from its bottom elevation");
near(verticalDuct(rect, "cross").lines.length, 2, 0, "supply: a cross");
near(verticalDuct(round, "diagonal").lines.length, 1, 0, "return: one diagonal");

const path = flexPath([{ x: 0, y: 0 }, { x: 1000, y: 500 }, { x: 2000, y: 0 }]);
near(path.length, 21, 0, "flex: samples between its clicks");
near(path[10].x, 1000, 1e-6, "through its clicks");
near(path[10].y, 500, 1e-6, "through its clicks");
near(flexDuct(path, 200, 100).lines.length > 15 ? 1 : 0, 1, 0, "hoops along it");
near(volume(flexDuctSolid([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 200, 0)) / (Math.PI * 100 * 100 * 1000), 1, 0.03, "flex, a straight piece");

const t = { from: rect, to: { shape: "rect", width: 200, height: 100 } as DuctSection, length: 500, align: "centre" as const };
near(volume(transitionSolid(t, 0)), (500 / 6) * (400 * 300 + 4 * 300 * 200 + 200 * 100), 1, "transition: a prismoid");
near(area(transition(t).outlines[0]), ((400 + 200) / 2) * 500, 1e-6, "transition: its plan");
near(Math.max(...transition({ ...t, align: "left" }).outlines[0].map((p) => p.y)), 200, 1e-6, "flat on the left");
near(Math.min(...transition({ ...t, align: "right" }).outlines[0].map((p) => p.y)), -200, 1e-6, "flat on the right");
near(volume(transitionSolid({ ...t, to: round }, 0)) > 0 ? 1 : 0, 1, 0, "rectangular to round wound outward");

const fork: Splitter = { width: 400, height: 300, lead: 200, left: 300, right: 300, branch: 500, angle: 45 };
const forked = splitter(fork).outlines[0];
near(volume(splitterSolid(fork, 0)), area(forked) * 300, 1, "splitter: its plan raised");
near(forked.filter((p) => Math.abs(p.y) < 1e-6).length, 1, 0, "the crotch on the run's middle");
const tee = { ...fork, angle: 90, left: 300, right: 200 };
near(splitterProblem(tee) === null ? 1 : 0, 1, 0, "a tee makes one");
near(volume(splitterSolid(tee, 0)), area(splitter(tee).outlines[0]) * 300, 1, "a tee, its branches differing");
near(splitterProblem({ ...fork, angle: 15, left: 3000, right: 3000 }) ? 1 : 0, 1, 0, "too wide for its angle refused");

near(volume(damperSolid(rect, 200, 0)) >= 400 * 300 * 200 ? 1 : 0, 1, 0, "damper: its body and handle");

const u: Diffuser = { shape: "rect", face: 600, neck: 250, height: 300 };
near(lowest(diffuserSolid(u, 2700)), 2700, 1e-6, "diffuser: its face on the ceiling");
near(volume(diffuserSolid(u, 0)) > 0 ? 1 : 0, 1, 0, "wound outward");
near(diffuserProblem({ ...u, neck: 900 }) ? 1 : 0, 1, 0, "a neck wider than its face refused");
near(volume(diffuserSolid({ ...u, shape: "round" }, 0)) > 0 ? 1 : 0, 1, 0, "round, wound outward");

near(volume(outletSolid({ width: 400, height: 200, depth: 50 }, 0)) > 400 * 200 * 50 ? 1 : 0, 1, 0, "outlet: its plate and louvres");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
