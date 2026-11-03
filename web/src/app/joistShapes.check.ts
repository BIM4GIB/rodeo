// npx tsx src/app/joistShapes.check.ts
import type { Pt } from "../core/index.ts";
import { joistFraming, takeOff, type JoistSpec, type Member } from "./joistShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const P = (x: number, y: number): Pt => ({ x, y });
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const bounds = (m: Member): number[] => [Math.min(...m.outline.map((p) => p.x)), Math.min(...m.outline.map((p) => p.y)), Math.max(...m.outline.map((p) => p.x)), Math.max(...m.outline.map((p) => p.y))];
const of = (r: Member[] | string, kind: string): Member[] => (typeof r === "string" ? [] : r.filter((m) => m.kind === kind));

const size = { width: 50, height: 235, top: 0 };
const spec: JoistSpec = { joists: { ...size, spacing: 400 }, perimeter: size, end: "inside", corner: "lapped" };
const floor = box(0, 0, 4000, 6000);

// joists along y, laid out from x = 0
const a = joistFraming(floor, [], P(0, 0), P(0, 6000), spec);
ok(typeof a !== "string", "frames a rectangle");
const joists = of(a, "joist");
ok(joists.length === 9, `nine joists between the rims (${joists.length})`);
ok(joists.every((m) => near(m.length, 5900)), "joists stop at the rims' inside faces");
const xs = joists.map((m) => (m.centre[0].x + m.centre[1].x) / 2).sort((p, q) => p - q);
ok(near(xs[0], 400) && near(xs[8], 3600), "the first and last joists are a spacing in from the edge");
const rims = of(a, "perimeter");
ok(rims.length === 4, "four perimeter members");
const bottom = rims.find((m) => near(bounds(m)[1], 0) && near(bounds(m)[3], 50));
ok(!!bottom && near(bounds(bottom)[0], 0) && near(bounds(bottom)[2], 4000), "a rim across the joists runs through the corners when lapped");
const side = rims.find((m) => near(bounds(m)[0], 0) && near(bounds(m)[2], 50));
ok(!!side && near(bounds(side)[1], 50) && near(bounds(side)[3], 5950), "an end member alongside the joists butts between the rims");

// end conditions
const outside = of(joistFraming(floor, [], P(0, 0), P(0, 6000), { ...spec, end: "outside" }), "joist");
ok(outside.every((m) => near(m.length, 6000)), "outside face runs the joists to the floor's edge");
const centre = of(joistFraming(floor, [], P(0, 0), P(0, 6000), { ...spec, end: "centre" }), "joist");
ok(centre.every((m) => near(m.length, 5950)), "centerline stops the joists at the rims' middles");

// mitred corners
const mitred = of(joistFraming(floor, [], P(0, 0), P(0, 6000), { ...spec, corner: "mitred" }), "perimeter");
ok(mitred.length === 4 && mitred.every((m) => m.outline.length === 4), "mitred members");
const mb = mitred.find((m) => near(bounds(m)[1], 0));
ok(!!mb && mb.outline.some((p) => near(p.x, 50) && near(p.y, 50)) && near(mb.length, 4000), "a mitred member's inside corner is on the bisector");

// an opening: headers round it, joists through it split
const hole = box(1000, 2000, 2000, 3000);
const h = joistFraming(floor, [hole], P(0, 0), P(0, 6000), spec);
const headers = of(h, "header");
ok(headers.length === 4, `four headers round the opening (${headers.length})`);
ok(headers.every((m) => { const [x0, y0, x1, y1] = bounds(m); return x0 >= 950 - 0.01 && y0 >= 1950 - 0.01 && x1 <= 2050 + 0.01 && y1 <= 3050 + 0.01; }), "headers ring the opening outside it");
const trimmer = headers.find((m) => near(bounds(m)[0], 950));
ok(!!trimmer && near(bounds(trimmer)[1], 1950) && near(bounds(trimmer)[3], 3050), "the members alongside the joists run through round an opening");
const hj = of(h, "joist");
ok(hj.length === 12, `joists crossing the opening are cut in two (${hj.length})`);
ok(hj.filter((m) => near((m.centre[0].x + m.centre[1].x) / 2, 1200)).every((m) => { const [, y0, , y1] = bounds(m); return y1 <= 1950 + 0.01 || y0 >= 3050 - 0.01; }), "cut joists stop at the headers");

// an angled edge cuts the joists to it
const slope = [P(0, 0), P(4000, 0), P(4000, 4000), P(0, 6000)];
const sj = of(joistFraming(slope, [], P(0, 0), P(0, 10), { ...spec, perimeter: null }), "joist");
ok(sj.length === 9, `joists across a sloped floor (${sj.length})`);
const top = (m: Member): number => Math.max(...m.outline.map((p) => p.y));
const j2000 = sj.find((m) => near((m.centre[0].x + m.centre[1].x) / 2, 2000));
ok(!!j2000 && near(top(j2000), 5000 + 12.5, 0.1), "a joist's end follows the sloped edge");
ok(!!j2000 && j2000.outline.some((p) => near(p.y, 5000 + 12.5, 0.1)) && j2000.outline.some((p) => near(p.y, 5000 - 12.5, 0.1)), "the cut is slanted across the joist");

// along x, the other way
const xj = of(joistFraming(floor, [], P(0, 0), P(10, 0), spec), "joist");
ok(xj.length === 14 && xj.every((m) => near(m.length, 3900)), `joists along x (${xj.length})`);

// perimeter only, and refusals
const ponly = joistFraming(floor, [], P(0, 0), P(0, 0), { ...spec, joists: null });
ok(typeof ponly !== "string" && ponly.length === 4, "perimeter only needs no direction");
ok(typeof joistFraming(floor, [], P(0, 0), P(0, 0), spec) === "string", "joists need two points apart");
ok(typeof joistFraming(floor, [], P(0, 0), P(0, 10), { ...spec, joists: { ...size, spacing: 40 } }) === "string", "spacing under a joist's width is refused");
ok(typeof joistFraming(floor, [], P(0, 0), P(0, 10), { ...spec, joists: null, perimeter: null }) === "string", "nothing chosen is refused");

// the take-off
const rows = takeOff(typeof h === "string" ? [] : h);
ok(rows[0].kind === "joist" && rows.reduce((n, r) => n + r.count, 0) === (typeof h === "string" ? 0 : h.length), "the take-off counts every member");
ok(rows.find((r) => r.kind === "joist" && r.length === 5900)?.count === 6, "joists of a length counted together");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
