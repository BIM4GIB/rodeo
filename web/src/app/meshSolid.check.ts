// npx tsx src/app/meshSolid.check.ts
import { massProperties, solidOf, WATER } from "./meshSolid.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, rel = 1e-6): boolean => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

/** A box's twelve triangles, some wound in and some out, as the 3D view's are. */
function box(x0: number, y0: number, z0: number, a: number, b: number, c: number, flip = false): Float32Array {
  const p = (i: number): number[] => [x0 + (i & 1 ? a : 0), y0 + (i & 2 ? b : 0), z0 + (i & 4 ? c : 0)];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const out: number[] = [];
  quads.forEach(([q0, q1, q2, q3], i) => {
    const tri = (u: number, v: number, w: number) => out.push(...p(u), ...(flip && i % 2 ? [...p(w), ...p(v)] : [...p(v), ...p(w)]));
    tri(q0, q1, q2);
    tri(q0, q2, q3);
  });
  return new Float32Array(out);
}

// a 100 × 200 × 300 box: I about its centre's x axis is V(b² + c²)/12, its products nought
{
  const s = solidOf([{ triangles: box(0, 0, 0, 100, 200, 300, true) }])!;
  const V = 100 * 200 * 300;
  ok(near(s.volume!, V) && near(s.area, 2 * (100 * 200 + 200 * 300 + 300 * 100)), `volume ${s.volume}, area ${s.area}`);
  ok(near(s.center!.x, 50) && near(s.center!.y, 100) && near(s.center!.z, 150), `centre ${JSON.stringify(s.center)}`);
  const i = s.inertia!;
  ok(near(i.xx, (V * (200 ** 2 + 300 ** 2)) / 12) && near(i.yy, (V * (100 ** 2 + 300 ** 2)) / 12) && near(i.zz, (V * (100 ** 2 + 200 ** 2)) / 12), `moments ${JSON.stringify(i)}`);
  ok(Math.abs(i.xy) < 1e-6 * i.xx && Math.abs(i.yz) < 1e-6 * i.xx && Math.abs(i.zx) < 1e-6 * i.xx, "no products for a box square to the axes");
  ok(near(Math.sqrt(i.zz / V), Math.sqrt((100 ** 2 + 200 ** 2) / 12)), "radius of gyration about z");
}

// far from the origin, the moments about its own centre are the same
{
  const s = solidOf([{ triangles: box(250000, -180000, 3000, 100, 200, 300) }])!;
  const V = 100 * 200 * 300;
  ok(near(s.center!.x, 250050, 1e-9) && near(s.center!.z, 3150, 1e-9), `centre ${JSON.stringify(s.center)}`);
  ok(near(s.inertia!.xx, (V * (200 ** 2 + 300 ** 2)) / 12, 1e-4), `moments far away ${s.inertia!.xx}`);
}

// two boxes apart: the parallel axis theorem, and products off the diagonal
{
  const s = solidOf([{ triangles: box(0, 0, 0, 100, 100, 100) }, { triangles: box(300, 200, 0, 100, 100, 100) }])!;
  const v = 1e6;
  // centres (50, 50, 50) and (350, 250, 50): the pair's at (200, 150, 50), each 150 and 100 off it in x and y
  ok(near(s.volume!, 2 * v) && near(s.center!.x, 200) && near(s.center!.y, 150) && near(s.center!.z, 50), `centre ${JSON.stringify(s.center)}`);
  const own = (v * (100 ** 2 + 100 ** 2)) / 12;
  ok(near(s.inertia!.zz, 2 * own + 2 * v * (150 ** 2 + 100 ** 2)), `zz ${s.inertia!.zz}`);
  ok(near(s.inertia!.xx, 2 * own + 2 * v * 100 ** 2) && near(s.inertia!.yy, 2 * own + 2 * v * 150 ** 2), `xx, yy ${s.inertia!.xx} ${s.inertia!.yy}`);
  ok(near(s.inertia!.xy, 2 * v * 150 * 100), `xy, both off the same way ${s.inertia!.xy}`);
}

// faces that don't close measure only their area
{
  const t = box(0, 0, 0, 10, 10, 10).slice(0, 9 * 10);
  const s = solidOf([{ triangles: t }])!;
  ok(s.volume === null && s.center === null && s.inertia === null && near(s.area, 500), `open: ${JSON.stringify(s)}`);
}

// mass properties: a 1 in steel cube at 0.2836 lb/in³, and a 10 cm cube of water by its specific gravity
{
  const s = solidOf([{ triangles: box(0, 0, 0, 25.4, 25.4, 25.4) }])!;
  const m = massProperties(s.volume!, s.inertia!, "english", "density", 0.2836);
  ok(near(m.mass, 0.2836) && m.weight === m.mass && near(m.zz, (0.2836 * 2) / 12), `steel inch: ${JSON.stringify(m)}`);
  const w = solidOf([{ triangles: box(0, 0, 0, 100, 100, 100) }])!;
  const n = massProperties(w.volume!, w.inertia!, "metric", "gravity", 1);
  ok(near(n.density, 1000) && near(n.mass, 1) && near(n.weight, 9.80665) && near(n.xx, (1 * (0.1 ** 2 + 0.1 ** 2)) / 12), `water decimetre: ${JSON.stringify(n)}`);
  ok(near(WATER.english * 1728, 62.428), "water in lb/ft³");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
