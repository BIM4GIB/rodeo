// npx tsx src/features/theatre/event/lecternShapes.check.ts
import { DESK_SLOPE, facing, highestAt, LECTERNS, lecternNamed, lecternSize, planOutlines, viewFaces } from "./lecternShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const zsOf = (faces: number[][]): number[] => faces.flatMap((f) => f.filter((_, i) => i % 3 === 2));

// every lectern stands on the floor, has a desk and a book stop, and shows something in plan
for (const kind of LECTERNS) {
  const zs = kind.parts.flatMap((p) => zsOf(p.solid));
  ok(near(Math.min(...zs), 0), `${kind.name} stands on the floor (${Math.min(...zs)})`);
  ok(kind.parts.some((p) => p.role === "desk") && kind.parts.some((p) => p.role === "trim"), `${kind.name} has a desk and a book stop`);
  ok(planOutlines(kind).length >= 2, `${kind.name} draws its outlines in plan`);
  // the desk rises toward the audience (−y) by its slope
  const desk = kind.parts.find((p) => p.role === "desk")!;
  const top = desk.solid.flatMap((f) => Array.from({ length: f.length / 3 }, (_, i) => [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]]));
  const ys = top.map((p) => p[1]);
  const front = Math.min(...ys);
  const back = Math.max(...ys);
  const highFront = Math.max(...top.filter((p) => near(p[1], front)).map((p) => p[2]));
  const highBack = Math.max(...top.filter((p) => near(p[1], back)).map((p) => p[2]));
  ok(near(highFront - highBack, Math.tan((DESK_SLOPE * Math.PI) / 180) * (back - front), 1e-6), `${kind.name}'s desk falls ${DESK_SLOPE}° toward the speaker`);
  // every part is a convex block with its faces turned outward
  for (const part of kind.parts) {
    const all = part.solid.flat();
    const mid = [0, 1, 2].map((k) => all.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0) / (all.length / 3));
    const outward = part.solid.every((f) => {
      const n = f.length / 3;
      const nrm = [0, 0, 0];
      const c = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        const [a, b] = [f.slice(i * 3, i * 3 + 3), f.slice(((i + 1) % n) * 3, ((i + 1) % n) * 3 + 3)];
        nrm[0] += (a[1] - b[1]) * (a[2] + b[2]);
        nrm[1] += (a[2] - b[2]) * (a[0] + b[0]);
        nrm[2] += (a[0] - b[0]) * (a[1] + b[1]);
        for (let k = 0; k < 3; k++) c[k] += a[k] / n;
      }
      return nrm[0] * (c[0] - mid[0]) + nrm[1] * (c[1] - mid[1]) + nrm[2] * (c[2] - mid[2]) > 0;
    });
    ok(outward, `${kind.name}'s ${part.role} faces outward`);
  }
  // the preview's three views hold every face, front to back in paint order
  for (const v of ["front", "side", "top"] as const) ok(viewFaces(kind, v).length === kind.parts.reduce((n, p) => n + p.solid.length, 0), `${kind.name} ${v} view has every face`);
}
const classic = lecternNamed("Classic Wood Lectern");
const size = lecternSize(classic);
ok(near(size.width, 660) && near(size.depth, 580) && size.height > 1150 && size.height < 1220, `the classic lectern's size (${JSON.stringify(size)})`);
ok(lecternNamed("nonesuch") === LECTERNS[0], "an unknown name is the first lectern");
// the top view paints low faces first: the plinth's underside before the book stop's top
const top = viewFaces(classic, "top");
ok(top[0].role === "base" && top[top.length - 1].role !== "base", "the top view paints low faces first");

// the turn that faces it toward a point: straight down the screen is as drawn
ok(near(facing({ x: 0, y: 0 }, { x: 0, y: -100 }), 0), "facing down the screen is no turn");
ok(near(facing({ x: 0, y: 0 }, { x: 100, y: 0 }), 90), "facing +x is a quarter turn");
ok(near(Math.abs(facing({ x: 0, y: 0 }, { x: 0, y: 100 })), 180), "facing up the screen is a half turn");
ok(facing({ x: 5, y: 5 }, { x: 5, y: 5 }) === 0, "no turn without a second point");

// the stage under it: a box from 0 to 600 high, 4000 × 2000
const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, flip = false): number[] => {
  const quad = (a: number[], b: number[], c: number[], d: number[]): number[] => (flip ? [...a, ...c, ...b, ...a, ...d, ...c] : [...a, ...b, ...c, ...a, ...c, ...d]);
  return [
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]),
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ];
};
const stage = box(0, 0, 4000, 2000, 0, 600);
ok(near(highestAt(stage, { x: 1000, y: 500 }, 3000)!, 600), "the top of the stage under the point");
ok(near(highestAt(box(0, 0, 4000, 2000, 0, 600, true), { x: 1000, y: 500 }, 3000)!, 600), "whichever way its faces wind");
ok(highestAt(stage, { x: 5000, y: 500 }, 3000) === null, "nothing beside the stage");
ok(near(highestAt(stage, { x: 1000, y: 500 }, 500)!, 0), "a top above the limit is passed over for the floor of the box");
const truss = box(0, 0, 4000, 300, 6000, 6300);
ok(near(highestAt([...stage, ...truss], { x: 1000, y: 100 }, 3000)!, 600), "a truss overhead isn't stood on");
// a raked top: from 0 at y=0 to 400 at y=2000
const rake = [0, 0, 0, 4000, 0, 0, 4000, 2000, 400, 0, 0, 0, 4000, 2000, 400, 0, 2000, 400];
ok(near(highestAt(rake, { x: 100, y: 1000 }, 3000)!, 200), "a raked top at the point");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
