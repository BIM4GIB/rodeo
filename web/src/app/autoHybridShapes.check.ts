// npx tsx src/app/autoHybridShapes.check.ts
import type { Pt } from "../core/index.ts";
import { hybridPlan, keyhole, nested, type HybridView } from "./autoHybridShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;

type P3 = [number, number, number];
/** A flat face fanned into triangles, each turned to face along `out`. */
function face(pts: P3[], out: P3): number[] {
  const tris: number[] = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    let [a, b, c] = [pts[0], pts[i], pts[i + 1]];
    const [u, v] = [b.map((x, k) => x - a[k]), c.map((x, k) => x - a[k])];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) [b, c] = [c, b];
    tris.push(...a, ...b, ...c);
  }
  return tris;
}
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  return [
    ...face([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]),
    ...face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]),
    ...face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]),
    ...face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]),
    ...face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]),
    ...face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]),
  ];
}
const area = (r: readonly Pt[]): number => Math.abs(r.reduce((sum, p, i) => sum + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0)) / 2;
const length = (runs: readonly Pt[][]): number => runs.reduce((sum, r) => sum + r.slice(1).reduce((m, p, i) => m + Math.hypot(p.x - r[i].x, p.y - r[i].y), 0), 0);
const view: HybridView = { cut: 1200, below: Infinity, above: null, smoothing: 15, up: false };

// a box cut through: its outline at the cut, and its bottom's edges below
const [cutBox] = hybridPlan([box(0, 0, 0, 1000, 2000, 3000)], view);
ok(cutBox.rings.length === 1 && near(area(cutBox.rings[0]), 2e6, 1), `one ring round the cut (${cutBox.rings.length})`);
ok(cutBox.open.length === 0, "a closed box cuts closed");
ok(cutBox.below.length === 0 && cutBox.belowHidden.length === 0, `the bottom's outline right under the cut's is left to it (${length(cutBox.below)} seen, ${length(cutBox.belowHidden)} hidden)`);
ok(cutBox.above.length === 0, "nothing above while it's off");

// a finite depth stops short of the bottom
const [shallow] = hybridPlan([box(0, 0, 0, 1000, 2000, 3000)], { ...view, below: 500 });
ok(shallow.below.length === 0 && shallow.rings.length === 1, "500 below the cut sees no bottom, and the cut's own edge isn't an edge");

// a box under a slab is out of sight looking down, and in sight looking up
const slab = box(0, 0, 500, 1000, 1000, 600);
const small = box(400, 400, 0, 600, 600, 300);
const [slabPlan, smallPlan] = hybridPlan([slab, small], view);
ok(near(length(slabPlan.below), 4000, 1) && slabPlan.belowHidden.length === 0, `the slab's top seen, and its bottom right under it not drawn again (${length(slabPlan.below)}, ${length(slabPlan.belowHidden)})`);
ok(smallPlan.below.length === 0 && near(length(smallPlan.belowHidden), 800, 1) && smallPlan.belowHidden.length === 1, `the box under it hidden (${length(smallPlan.below)} seen, ${length(smallPlan.belowHidden)} hidden)`);
const [, smallUp] = hybridPlan([slab, small], { ...view, up: true });
ok(near(length(smallUp.below), 800, 1) && smallUp.belowHidden.length === 0, "looked at from below the box is in sight");

// the cut's face hides what's below it inside the cut object
const [, inside] = hybridPlan([box(0, 0, 0, 1000, 1000, 3000), small], view);
ok(inside.below.length === 0 && near(length(inside.belowHidden), 800, 1), `a box inside a cut wall is hidden by the cut (${length(inside.belowHidden)})`);

// above the cut
const high = box(0, 0, 2000, 1000, 1000, 2500);
const [noneAbove] = hybridPlan([high], view);
ok(noneAbove.above.length === 0 && noneAbove.below.length === 0 && noneAbove.rings.length === 0, "a box above the cut shows nothing with only Below on");
const [shownAbove] = hybridPlan([high], { ...view, above: Infinity });
ok(near(length(shownAbove.above), 4000, 1) && shownAbove.aboveHidden.length === 0, `its outline above with Above on (${length(shownAbove.above)})`);
const [shortAbove] = hybridPlan([high], { ...view, above: 500 });
ok(shortAbove.above.length === 0, "and none with it 800 up and 500 shown");
const [under, over] = hybridPlan([box(0, 0, 2000, 1000, 1000, 2100), box(400, 400, 2500, 600, 600, 2800)], { ...view, above: Infinity });
ok(near(length(over.above), 800, 1) && near(length(under.above), 4000, 1), "looking down, a box above the cut sits on top in sight");
const [, overUp] = hybridPlan([box(0, 0, 2000, 1000, 1000, 2100), box(400, 400, 2500, 600, 600, 2800)], { ...view, above: Infinity, up: true });
ok(overUp.above.length === 0 && near(length(overUp.aboveHidden), 800, 1), "looking up, the slab under it hides it");

// a tube cuts as a ring with a hole
const tube = [
  ...face([[0, 0, 0], [1000, 0, 0], [1000, 0, 3000], [0, 0, 3000]], [0, -1, 0]),
  ...face([[1000, 0, 0], [1000, 1000, 0], [1000, 1000, 3000], [1000, 0, 3000]], [1, 0, 0]),
  ...face([[1000, 1000, 0], [0, 1000, 0], [0, 1000, 3000], [1000, 1000, 3000]], [0, 1, 0]),
  ...face([[0, 1000, 0], [0, 0, 0], [0, 0, 3000], [0, 1000, 3000]], [-1, 0, 0]),
  ...face([[400, 400, 0], [600, 400, 0], [600, 400, 3000], [400, 400, 3000]], [0, 1, 0]),
  ...face([[600, 400, 0], [600, 600, 0], [600, 600, 3000], [600, 400, 3000]], [-1, 0, 0]),
  ...face([[600, 600, 0], [400, 600, 0], [400, 600, 3000], [600, 600, 3000]], [0, -1, 0]),
  ...face([[400, 600, 0], [400, 400, 0], [400, 400, 3000], [400, 600, 3000]], [1, 0, 0]),
];
const [tubePlan] = hybridPlan([tube], view);
const groups = nested(tubePlan.rings);
ok(tubePlan.rings.length === 2 && groups.length === 1 && groups[0].holes.length === 1, `a tube's cut is a ring with a hole (${tubePlan.rings.length} rings, ${groups.length} outer)`);
const k = keyhole(groups[0].outer, groups[0].holes);
ok(k.length === groups[0].outer.length + groups[0].holes[0].length + 2, "the keyhole runs round both and back");
ok(near(area(k), 1e6 - 4e4, 1), `the keyhole fills the ring less the hole (${area(k)})`);

// a cylinder on its side: only its outline's sides with smoothing, every facet's edge without
const sides = 32;
const cylinder: number[] = [];
for (let i = 0; i < sides; i++) {
  const [a, b] = [(i * 2 * Math.PI) / sides, ((i + 1) * 2 * Math.PI) / sides];
  const p = (t: number, x: number): P3 => [x, 300 * Math.cos(t), 300 + 300 * Math.sin(t)];
  const m = (a + b) / 2;
  cylinder.push(...face([p(a, 0), p(b, 0), p(b, 1000), p(a, 1000)], [0, Math.cos(m), Math.sin(m)]));
}
const ring = (x: number): P3[] => Array.from({ length: sides }, (_, i): P3 => [x, 300 * Math.cos((i * 2 * Math.PI) / sides), 300 + 300 * Math.sin((i * 2 * Math.PI) / sides)]);
cylinder.push(...face(ring(0), [-1, 0, 0]), ...face(ring(1000), [1, 0, 0]));
/** the runs' pieces along the cylinder's length, wherever a run turns onto or off one */
const long = (runs: readonly Pt[][]): number => runs.reduce((n, r) => n + r.slice(1).filter((p, i) => near(Math.abs(p.x - r[i].x), 1000, 1) && near(p.y, r[i].y, 0.01)).length, 0);
const [smooth] = hybridPlan([cylinder], { ...view, cut: 5000 });
ok(long(smooth.below) === 2 && long(smooth.belowHidden) === 0, `smoothed, only the two sides' lines show (${long(smooth.below)} seen, ${long(smooth.belowHidden)} hidden)`);
const [faceted] = hybridPlan([cylinder], { ...view, cut: 5000, smoothing: 5 });
ok(long(faceted.below) === 17 && long(faceted.belowHidden) === 0, `facets of the top half seen, the bottom half's right under them not drawn again (${long(faceted.below)} seen, ${long(faceted.belowHidden)} hidden)`);
// hidden edges with none over them in plan stay: a smaller box under a slab, off to one side of a post
const [, side] = hybridPlan([box(0, 0, 500, 1000, 1000, 600), box(-200, 400, 0, 200, 600, 300)], view);
ok(near(length(side.belowHidden), 600, 1) && near(length(side.below), 600, 1), `the part under the slab hidden, the part out from under it seen (${length(side.below)} seen, ${length(side.belowHidden)} hidden)`);

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
