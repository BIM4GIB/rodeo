// npx tsx src/app/exteriorDims.check.ts
import type { Pt } from "../core/index.ts";
import { exteriorChains, type ExteriorChain, type ExteriorOptions, type ExteriorWall } from "./exteriorDims.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const T = 200;

/** A wall from `a` to `b`, its area run out half its thickness past each end (where a corner meets another) or not. */
function wall(a: Pt, b: Pt, openings: { a0: number; a1: number }[] = [], ends = true): ExteriorWall {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const e = ends ? T / 2 : 0;
  const s = { x: a.x - u.x * e, y: a.y - u.y * e };
  const f = { x: b.x + u.x * e, y: b.y + u.y * e };
  const h = T / 2;
  return { start: a, end: b, openings, footprint: [{ x: s.x - n.x * h, y: s.y - n.y * h }, { x: f.x - n.x * h, y: f.y - n.y * h }, { x: f.x + n.x * h, y: f.y + n.y * h }, { x: s.x + n.x * h, y: s.y + n.y * h }] };
}
/** Walls round the ring of corners `pts`. */
const around = (pts: Pt[], openings: Record<number, { a0: number; a1: number }[]> = {}): ExteriorWall[] => pts.map((p, i) => wall(p, pts[(i + 1) % pts.length], openings[i] ?? []));
const P = (x: number, y: number): Pt => ({ x, y });
const base: ExteriorOptions = { to: "faces", openings: "edges", tees: false, offsets: { openings: 500, walls: 1000, overall: 1500 }, small: 0, smallMode: "red" };
const chains = (walls: ExteriorWall[], o: Partial<ExteriorOptions> = {}): ExteriorChain[] => {
  const r = exteriorChains(walls, { ...base, ...o });
  if (typeof r === "string") throw new Error(r);
  return r;
};
const xs = (c: ExteriorChain): number[] => c.points.map((p) => Math.round(p.x));
const ys = (c: ExteriorChain): number[] => c.points.map((p) => Math.round(p.y));
const find = (cs: ExteriorChain[], side: string, kind: string) => cs.find((c) => c.side === side && c.kind === kind);

// a 10 m × 6 m box of 200 walls: an overall size on each side, measured to the outer faces
{
  const cs = chains(around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)]));
  ok(cs.length === 4 && cs.every((c) => c.kind === "overall"), `four overall chains, the walls' chains saying no more: ${cs.map((c) => c.side + ":" + c.kind)}`);
  const b = find(cs, "bottom", "overall")!;
  ok(xs(b).join() === "-100,10100" && ys(b).join() === "-100,-100", `bottom, face to face: ${JSON.stringify(b.points)}`);
  ok(near(b.at.y, -100 - 1500) && near(b.u.x, 1) && near(b.u.y, 0), `bottom chain 1500 below, horizontal: ${JSON.stringify(b.at)}`);
  const l = find(cs, "left", "overall")!;
  ok(ys(l).join() === "-100,6100" && near(l.at.x, -1600) && near(l.u.y, 1), `left, along y: ${JSON.stringify(l)}`);
  const t = find(cs, "top", "overall")!;
  ok(near(t.at.y, 6100 + 1500), "top chain above");
}

// a door in the bottom wall: an openings chain at its edges, between the corners; or at its centre
{
  const walls = around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)], { 0: [{ a0: 2000, a1: 2900 }] });
  const cs = chains(walls);
  const op = find(cs, "bottom", "openings");
  ok(!!op && xs(op).join() === "-100,2000,2900,10100" && near(op.at.y, -600), `door edges: ${op && xs(op)}`);
  ok(!find(cs, "top", "openings") && cs.length === 5, "only the bottom has openings");
  const mid = find(chains(walls, { openings: "centers" }), "bottom", "openings")!;
  ok(xs(mid).join() === "-100,2450,10100", `door centre: ${xs(mid)}`);
  // a door in the top wall, which runs right to left, measured where it is
  const top = find(chains(around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)], { 2: [{ a0: 1000, a1: 1800 }] })), "top", "openings")!;
  ok(xs(top).join() === "-100,8200,9000,10100" && ys(top).every((y) => y === 6100), `top wall's door: ${xs(top)}`);
}

// centrelines: the walls' control lines' ends, on the face
{
  const cs = chains(around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)]), { to: "centerlines" });
  const b = find(cs, "bottom", "overall")!;
  ok(xs(b).join() === "0,10000" && ys(b).join() === "-100,-100", `centre to centre: ${JSON.stringify(b.points)}`);
}

// an L: the jogs on the top and right, with the overall size beyond
{
  const cs = chains(around([P(0, 0), P(10000, 0), P(10000, 4000), P(6000, 4000), P(6000, 8000), P(0, 8000)]));
  const tw = find(cs, "top", "walls");
  ok(!!tw && xs(tw).join() === "-100,6100,10100", `top: the jog's corners: ${tw && xs(tw)}`);
  ok(xs(find(cs, "top", "overall")!).join() === "-100,10100" && near(find(cs, "top", "overall")!.at.y, 8100 + 1500), "overall above the highest point");
  const rw = find(cs, "right", "walls");
  ok(!!rw && ys(rw).join() === "-100,4100,8100", `right: ${rw && ys(rw)}`);
  ok(!find(cs, "bottom", "walls") && !find(cs, "left", "walls"), "straight sides need only the overall");
}

// T-joins: a wall inside meeting the bottom wall's inner face
{
  const walls = [...around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)]), wall(P(5000, 100), P(5000, 5900), [], false)];
  ok(!find(chains(walls), "bottom", "openings"), "without T-joins it isn't dimensioned");
  const cs = chains(walls, { tees: true });
  const b = find(cs, "bottom", "openings");
  ok(!!b && xs(b).join() === "-100,4900,5100,10100", `its faces: ${b && xs(b)}`);
  const t = find(cs, "top", "openings");
  ok(!!t && xs(t).join() === "-100,4900,5100,10100", `top too: ${t && xs(t)}`);
  const c = find(chains(walls, { tees: true, to: "centerlines" }), "bottom", "openings")!;
  ok(xs(c).join() === "0,5000,10000", `its centreline: ${xs(c)}`);
}

// small spans: marked in red, or left out
{
  const walls = around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)], { 0: [{ a0: -90, a1: 800 }] });
  const red = find(chains(walls, { small: 20 }), "bottom", "openings")!;
  ok(xs(red).join() === "-100,-90,800,10100" && red.small.join() === "true,false,false", `marked: ${xs(red)} ${red.small}`);
  const skip = find(chains(walls, { small: 20, smallMode: "skip" }), "bottom", "openings")!;
  ok(xs(skip).join() === "-100,800,10100" && skip.small.every((x) => !x), `left out: ${xs(skip)}`);
}

// a building turned 30°: dimensioned along its own sides
{
  const a = Math.PI / 6;
  const r = (p: Pt): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
  const cs = chains(around([P(0, 0), P(10000, 0), P(10000, 6000), P(0, 6000)].map(r)));
  ok(cs.length === 4, `four chains: ${cs.length}`);
  const spans = cs.map((c) => {
    const [p, q] = c.points;
    return Math.round(Math.abs((q.x - p.x) * c.u.x + (q.y - p.y) * c.u.y));
  });
  ok(spans.sort((x, y) => x - y).join() === "6200,6200,10200,10200", `its sizes along its sides: ${spans}`);
  ok(cs.some((c) => near(Math.abs(c.u.x), Math.cos(a), 1e-5)), "along the turned side");
}

// two buildings, and nothing to dimension
{
  const cs = chains([...around([P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)]), ...around([P(10000, 0), P(14000, 0), P(14000, 3000), P(10000, 3000)])]);
  ok(cs.length === 8, `two buildings, four sides each: ${cs.length}`);
  ok(exteriorChains([], base) === "there are no straight walls to dimension", "no walls");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
