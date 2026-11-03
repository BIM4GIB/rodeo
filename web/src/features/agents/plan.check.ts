// Checks the floor-plan reader under Node. Run from web/:
//   npx tsx src/features/agents/plan.check.ts [drawing.vwx]
// Known plans are drawn as line work the way a hand or a careless export draws them: ends a few
// millimetres out, lines stopping short or running past, some broken in two. A rectangular house
// with a T junction, a front door, two windows and an opening; an L-shaped house with four-line
// cavity walls, windows drawn two ways and an internal door; and a plan with walls drawn as
// filled, hatched rectangles among furniture, a stair, a dimension string and a dimension in a
// "Dimension" class. Each must come back with its walls, thicknesses, openings, rooms and labels,
// and nothing read from the clutter, drawn square and turned. A plan of over 20,000 lines (many of
// them side by side) must read in well under 2 s, as the sum of its parts. The house's walls must
// chain into runs that build as they are.
// With a drawing named, every design layer of it is read and only counts and timings printed.

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openVwx } from "../../core/index.ts";
import type { Pt } from "../../core/types.ts";
import { buildParts } from "./build.ts";
import { readPlan, wallPaths, type PlanInput, type PlanReading } from "./plan.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const P = (x: number, y: number): Pt => ({ x, y });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Line work drawn a little carelessly, from a seed so every run draws the same. */
class Sketch implements PlanInput {
  segments: { a: Pt; b: Pt; id: string; className: string }[] = [];
  arcs: { center: Pt; radius: number; start: number; sweep: number; id: string; className: string }[] = [];
  fills: { points: Pt[]; id: string; className: string }[] = [];
  texts: { at: Pt; text: string; id: string }[] = [];
  private n = 0;
  constructor(private seed: number) {}
  rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
    return this.seed / 2147483648;
  }
  id(): string {
    return `o${++this.n}`;
  }
  /** a point moved up to 2.5 mm each way */
  wobble(p: Pt): Pt {
    return { x: p.x + (this.rand() - 0.5) * 5, y: p.y + (this.rand() - 0.5) * 5 };
  }
  /** a line whose ends stop up to 4 mm short or run up to 4 mm past, sometimes in two pieces with a gap of 1–4 mm */
  line(a: Pt, b: Pt, cls = ""): void {
    const l = dist(a, b);
    const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    const s = (this.rand() - 0.5) * 8;
    const e = (this.rand() - 0.5) * 8;
    const pa = this.wobble({ x: a.x - u.x * s, y: a.y - u.y * s });
    const pb = this.wobble({ x: b.x + u.x * e, y: b.y + u.y * e });
    if (l > 400 && this.rand() < 0.25) {
      const t = 0.2 + this.rand() * 0.6;
      const g = 1 + this.rand() * 3;
      const m = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
      this.segments.push({ a: pa, b: { x: m.x - u.x * g / 2, y: m.y - u.y * g / 2 }, id: this.id(), className: cls });
      this.segments.push({ a: { x: m.x + u.x * g / 2, y: m.y + u.y * g / 2 }, b: pb, id: this.id(), className: cls });
    } else this.segments.push({ a: pa, b: pb, id: this.id(), className: cls });
  }
  /** a line from a to b left out where it crosses the given ranges of x (along a horizontal) or y (along an upright) */
  gapped(a: Pt, b: Pt, gaps: [number, number][], cls = ""): void {
    const along = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? "x" : "y";
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    const at = (v: number): Pt => {
      const t = (v - a[along]) / (b[along] - a[along]);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    let from = lo;
    for (const [g0, g1] of gaps.map(([p, q]): [number, number] => [Math.min(p, q), Math.max(p, q)]).sort((p, q) => p[0] - q[0])) {
      if (g1 <= lo || g0 >= hi) continue;
      if (g0 > from) this.line(at(from), at(g0), cls);
      from = Math.max(from, g1);
    }
    if (hi > from) this.line(at(from), at(hi), cls);
  }
  /** a closed shape, its corners wobbled, as lines or as a fill only */
  shape(pts: Pt[], cls = "", fillOnly = false): void {
    const w = pts.map((p) => this.wobble(p));
    const id = this.id();
    if (fillOnly) this.fills.push({ points: w, id, className: cls });
    else for (let i = 0; i < w.length; i++) this.segments.push({ a: w[i], b: w[(i + 1) % w.length], id, className: cls });
  }
  rect(x0: number, y0: number, x1: number, y1: number, cls = "", fillOnly = false): void {
    this.shape([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], cls, fillOnly);
  }
  arc(c: Pt, r: number, start: number, sweep: number, cls = ""): void {
    this.arcs.push({ center: this.wobble(c), radius: r + (this.rand() - 0.5) * 4, start, sweep, id: this.id(), className: cls });
  }
  text(x: number, y: number, text: string): void {
    this.texts.push({ at: P(x, y), text, id: this.id() });
  }
}

interface Expect {
  name: string;
  walls: { a: Pt; b: Pt; t: number }[];
  openings: { at: Pt; width: number; type: "door" | "window" | "opening"; hinge?: Pt; opens?: Pt }[];
  rooms: { area: number; label: string }[];
  /** places nothing may be read at: the middles of furniture, stairs and the like */
  clear?: Pt[];
  notes?: RegExp[];
}

/** A rectangular house: 300 mm walls, a 100 mm wall across it (T junctions), a front door, two windows with three lines across and an opening. */
function house(seed: number): { input: Sketch; expect: Expect } {
  const k = new Sketch(seed);
  // outer faces, open at the windows and the door
  k.gapped(P(0, 0), P(10000, 0), [
    [1500, 2700],
    [6000, 6900],
  ]);
  k.gapped(P(10000, 0), P(10000, 7000), [[2500, 3700]]);
  k.line(P(10000, 7000), P(0, 7000));
  k.line(P(0, 7000), P(0, 0));
  // the rooms' faces
  k.gapped(P(300, 300), P(3950, 300), [[1500, 2700]]);
  k.gapped(P(3950, 300), P(3950, 6700), [[2000, 2800]]);
  k.line(P(3950, 6700), P(300, 6700));
  k.line(P(300, 6700), P(300, 300));
  k.gapped(P(4050, 300), P(9700, 300), [[6000, 6900]]);
  k.gapped(P(9700, 300), P(9700, 6700), [[2500, 3700]]);
  k.line(P(9700, 6700), P(4050, 6700));
  k.gapped(P(4050, 6700), P(4050, 300), [[2000, 2800]]);
  // jambs
  for (const x of [1500, 2700, 6000, 6900]) k.line(P(x, 0), P(x, 300));
  for (const y of [2500, 3700]) k.line(P(9700, y), P(10000, y));
  for (const y of [2000, 2800]) k.line(P(3950, y), P(4050, y));
  // windows: three lines across, one in a window class and one not
  for (const y of [0, 150, 300]) k.line(P(1500, y), P(2700, y), "Windows");
  for (const x of [9700, 9850, 10000]) k.line(P(x, 2500), P(x, 3700));
  // the front door, hinged at its left jamb, opening in
  k.arc(P(6000, 300), 900, 0, 90);
  k.line(P(6000, 300), P(6000, 1200));
  k.text(2000, 3500, "Living Room");
  k.text(2000, 3000, "25.8 m²");
  k.text(7000, 3500, "Kitchen");
  return {
    input: k,
    expect: {
      name: "rectangular house",
      walls: [
        { a: P(150, 150), b: P(9850, 150), t: 300 },
        { a: P(9850, 150), b: P(9850, 6850), t: 300 },
        { a: P(150, 6850), b: P(9850, 6850), t: 300 },
        { a: P(150, 150), b: P(150, 6850), t: 300 },
        { a: P(4000, 150), b: P(4000, 6850), t: 100 },
      ],
      openings: [
        { at: P(2100, 150), width: 1200, type: "window" },
        { at: P(6450, 150), width: 900, type: "door", hinge: P(6000, 150), opens: P(0, 1) },
        { at: P(9850, 3100), width: 1200, type: "window" },
        { at: P(4000, 2400), width: 800, type: "opening" },
      ],
      rooms: [
        { area: 3850 * 6700, label: "Living Room" },
        { area: 5850 * 6700, label: "Kitchen" },
      ],
      notes: [/closed loop/],
    },
  };
}

/** A polygon's sides moved d to their left (inwards, for one drawn anticlockwise). */
function inset(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const [p0, p1, p2] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]];
    const left = (a: Pt, b: Pt): Pt => {
      const l = dist(a, b);
      return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    };
    const n0 = left(p0, p1);
    const n1 = left(p1, p2);
    // corners are square here, so the offset corner is the corner moved along both normals
    return { x: p1.x + (n0.x + n1.x) * d, y: p1.y + (n0.y + n1.y) * d };
  });
}

/** An L-shaped house with cavity walls drawn as four lines (brick, cavity, block: 300 mm), an internal wall with a door, and windows drawn two ways. */
function lHouse(seed: number): { input: Sketch; expect: Expect } {
  const k = new Sketch(seed);
  const outline = [P(0, 0), P(12000, 0), P(12000, 5000), P(5000, 5000), P(5000, 9000), P(0, 9000)];
  // gaps per side, as ranges of x along horizontal sides and of y along upright ones
  const gaps: [number, number][][] = [
    [
      [2000, 2900],
      [5950, 6050],
    ],
    [[1500, 2700]],
    [[5950, 6050]],
    [],
    [[1500, 3000]],
    [],
  ];
  const offsets = [0, 100, 175, 300];
  for (const d of offsets) {
    const ring = inset(outline, d);
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      // the internal wall meets only the inner face
      k.gapped(a, b, gaps[i].filter(([g0, g1]) => d === 300 || g1 - g0 > 200));
    });
  }
  // jambs across all four lines
  for (const x of [2000, 2900]) k.line(P(x, 0), P(x, 300));
  for (const y of [1500, 2700]) k.line(P(12000, y), P(11700, y));
  for (const x of [1500, 3000]) k.line(P(x, 9000), P(x, 8700));
  // east window: two glazing lines within the wall; north-west window: three lines across
  for (const x of [11875, 11825]) k.line(P(x, 1500), P(x, 2700));
  for (const y of [9000, 8850, 8700]) k.line(P(1500, y), P(3000, y));
  // front door hinged at its right jamb, opening in
  k.arc(P(2900, 300), 900, 90, 90);
  k.line(P(2900, 300), P(2900, 1200));
  // the internal wall, 100 mm, with a door opening east
  k.gapped(P(5950, 300), P(5950, 4700), [[1000, 1800]]);
  k.gapped(P(6050, 300), P(6050, 4700), [[1000, 1800]]);
  for (const y of [1000, 1800]) k.line(P(5950, y), P(6050, y));
  k.arc(P(6050, 1000), 800, 0, 90);
  k.line(P(6050, 1000), P(6850, 1000));
  k.text(2500, 6000, "Bedroom");
  k.text(9000, 2500, "Lounge");
  const c = inset(outline, 150);
  return {
    input: k,
    expect: {
      name: "L-shaped cavity-wall house",
      walls: [...c.map((a, i) => ({ a, b: c[(i + 1) % c.length], t: 300 })), { a: P(6000, 150), b: P(6000, 4850), t: 100 }],
      openings: [
        { at: P(2450, 150), width: 900, type: "door", hinge: P(2900, 150), opens: P(0, 1) },
        { at: P(11850, 2100), width: 1200, type: "window" },
        { at: P(2250, 8850), width: 1500, type: "window" },
        { at: P(6000, 1400), width: 800, type: "door", hinge: P(6000, 1000), opens: P(1, 0) },
      ],
      rooms: [
        { area: 5850 * 4700 + 4700 * 4000, label: "Bedroom" },
        { area: 5850 * 4700, label: "Lounge" },
      ],
      notes: [/closed loop/, /cavity/],
    },
  };
}

/** Walls drawn as filled, hatched rectangles, among furniture, a stair, a dimension string and a dimension in a class named for dimensions. */
function clutter(seed: number): { input: Sketch; expect: Expect } {
  const k = new Sketch(seed);
  // walls: 200 mm external, 100 mm internal, as filled rectangles given only as fills
  const walls: [number, number, number, number][] = [
    [0, 0, 8000, 200],
    [0, 5800, 4000, 6000],
    [5200, 5800, 8000, 6000],
    [0, 200, 200, 5800],
    [7800, 200, 8000, 5800],
    [200, 3450, 3000, 3550],
    [3800, 3450, 7800, 3550],
  ];
  for (const [x0, y0, x1, y1] of walls) k.rect(x0, y0, x1, y1, "", true);
  // hatching at 45° inside the external walls
  for (const [x0, y0, x1, y1] of walls.slice(0, 5)) {
    const across = Math.min(x1 - x0, y1 - y0);
    if (x1 - x0 > y1 - y0) for (let x = x0; x + across <= x1; x += 150) k.line(P(x, y0), P(x + across, y1));
    else for (let y = y0; y + across <= y1; y += 150) k.line(P(x0, y), P(x1, y + across));
  }
  // a window in the north wall, three lines across
  for (const y of [5800, 5900, 6000]) k.line(P(4000, y), P(5200, y));
  // a door in the internal wall, hinged at its west jamb, opening north
  k.arc(P(3000, 3550), 800, 0, 90);
  k.line(P(3000, 3550), P(3000, 4350));
  // furniture: a bed and a wardrobe against walls, a sofa, a table and four chairs, a worktop with its units, a basin, an armchair
  k.rect(1000, 3800, 2600, 5800);
  k.rect(7200, 3800, 7800, 5600, "Furniture");
  k.rect(3600, 3700, 5600, 4600);
  k.rect(3500, 1200, 4400, 2100);
  k.rect(3725, 2200, 4175, 2650);
  k.rect(3725, 650, 4175, 1100);
  k.rect(2950, 1425, 3400, 1875);
  k.rect(4500, 1425, 4950, 1875);
  k.rect(200, 400, 800, 2800);
  for (const y of [1000, 1600, 2200]) k.line(P(200, y), P(800, y));
  k.arc(P(6000, 5400), 250, 0, 360);
  k.rect(5800, 4800, 6500, 5500);
  // a stair: twelve treads between strings
  for (let i = 0; i < 12; i++) k.line(P(6400, 450 + 250 * i), P(7300, 450 + 250 * i));
  k.line(P(6400, 450), P(6400, 3200));
  k.line(P(7300, 450), P(7300, 3200));
  // a dimension string under the plan: ticks across a broken line, extension lines up to the wall
  const stations = [0, 3000, 5000, 8000];
  for (let i = 0; i + 1 < stations.length; i++) k.line(P(stations[i], -800), P(stations[i + 1], -800));
  for (const x of stations) {
    k.line(P(x - 70, -870), P(x + 70, -730));
    k.line(P(x, -150), P(x, -900));
  }
  k.text(1500, -700, "3000");
  k.text(4000, -700, "2000");
  k.text(6500, -700, "3000");
  // and one in a dimension class beside it
  k.line(P(8800, 0), P(8800, 6000), "Dimension");
  for (const y of [0, 6000]) {
    k.line(P(8730, y - 70), P(8870, y + 70), "Dimension");
    k.line(P(8150, y), P(8900, y), "Dimension");
  }
  k.text(2500, 2600, "Kitchen");
  k.text(4500, 5200, "Bedroom");
  return {
    input: k,
    expect: {
      name: "plan with clutter",
      walls: [
        { a: P(100, 100), b: P(7900, 100), t: 200 },
        { a: P(100, 5900), b: P(7900, 5900), t: 200 },
        { a: P(100, 100), b: P(100, 5900), t: 200 },
        { a: P(7900, 100), b: P(7900, 5900), t: 200 },
        { a: P(100, 3500), b: P(7900, 3500), t: 100 },
      ],
      openings: [
        { at: P(3400, 3500), width: 800, type: "door", hinge: P(3000, 3500), opens: P(0, 1) },
        { at: P(4600, 5900), width: 1200, type: "window" },
      ],
      rooms: [
        { area: 7800 * 3400, label: "Kitchen" },
        { area: 7800 * 2400, label: "Bedroom" },
      ],
      clear: [P(1800, 4800), P(7500, 4700), P(4600, 4150), P(3950, 1650), P(3950, 2425), P(3950, 875), P(3175, 1650), P(4725, 1650), P(500, 1600), P(6150, 5150), P(6850, 1800), P(4000, -800), P(8800, 3000)],
      notes: [/closed loop/, /dimension/i, /stair/i, /hatch/i, /furniture/i],
    },
  };
}

export function samplePlans(seed = 7): { input: PlanInput; expect: Expect }[] {
  return [house(seed), lHouse(seed + 1), clutter(seed + 2)];
}

/** within the wall's rectangle */
function onWall(r: PlanReading, p: Pt): boolean {
  return r.walls.some((w) => {
    const L = dist(w.a, w.b);
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const s = (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
    const o = Math.abs((p.x - w.a.x) * u.y - (p.y - w.a.y) * u.x);
    return s >= -w.thickness / 2 && s <= L + w.thickness / 2 && o <= w.thickness / 2;
  });
}

function verify(input: PlanInput, e: Expect): void {
  const r = readPlan(input);
  const name = e.name;
  check(r.walls.length === e.walls.length, `${name}: ${e.walls.length} walls (read ${r.walls.length})`);
  for (const w of e.walls) {
    const got = r.walls.find((x) => (dist(x.a, w.a) < 30 && dist(x.b, w.b) < 30) || (dist(x.a, w.b) < 30 && dist(x.b, w.a) < 30));
    check(!!got, `${name}: wall (${w.a.x}, ${w.a.y})–(${w.b.x}, ${w.b.y}) read end to end${got ? "" : ` (nearest: ${nearestWall(r, w)})`}`);
    if (got) check(Math.abs(got.thickness - w.t) <= 5, `${name}: that wall ${w.t} mm thick (read ${got.thickness})`);
  }
  check(r.openings.length === e.openings.length, `${name}: ${e.openings.length} openings (read ${r.openings.length})`);
  for (const o of e.openings) {
    const got = r.openings.find((x) => dist(x.at, o.at) < 60);
    check(!!got && got.type === o.type && Math.abs(got.width - o.width) <= 20, `${name}: ${o.type} ${o.width} wide at (${o.at.x}, ${o.at.y})${got ? ` (read ${got.type} ${got.width})` : " (missing)"}`);
    if (got && o.hinge && o.opens) {
      const w = r.walls[got.wall];
      const left = (w.b.x - w.a.x) * o.opens.y - (w.b.y - w.a.y) * o.opens.x > 0;
      check(!!got.hinge && dist(got.hinge, o.hinge) < 30 && got.swing === (left ? "left" : "right"), `${name}: that door hinged at (${o.hinge.x}, ${o.hinge.y}), swinging ${left ? "left" : "right"} (read ${got.hinge ? `(${got.hinge.x}, ${got.hinge.y})` : "none"}, ${got.swing})`);
    }
    if (got) check(dist(r.walls[got.wall].a, got.at) + dist(got.at, r.walls[got.wall].b) - dist(r.walls[got.wall].a, r.walls[got.wall].b) < 1, `${name}: that ${o.type} on its wall's centre line`);
  }
  check(r.rooms.length === e.rooms.length, `${name}: ${e.rooms.length} rooms (read ${r.rooms.length})`);
  for (const room of e.rooms) {
    const got = r.rooms.find((x) => x.label === room.label);
    check(!!got && Math.abs(got.area - room.area) < room.area * 0.005, `${name}: room "${room.label}" of ${(room.area / 1e6).toFixed(2)} m²${got ? ` (read ${(got.area / 1e6).toFixed(2)})` : " (missing)"}`);
  }
  for (const p of e.clear ?? []) check(!onWall(r, p), `${name}: nothing read as wall at (${p.x}, ${p.y})`);
  for (const re of e.notes ?? []) check(r.notes.some((n) => re.test(n)), `${name}: a note matching ${re}`);
  console.log(`     notes: ${r.notes.join(" | ")}`);
}

function nearestWall(r: PlanReading, w: { a: Pt; b: Pt }): string {
  let best = "none";
  let bestD = Infinity;
  for (const x of r.walls) {
    const d = Math.min(dist(x.a, w.a) + dist(x.b, w.b), dist(x.a, w.b) + dist(x.b, w.a));
    if (d < bestD) {
      bestD = d;
      best = `(${x.a.x}, ${x.a.y})–(${x.b.x}, ${x.b.y}) ${x.thickness}`;
    }
  }
  return best;
}

type Mutable = PlanInput & { segments: PlanInput["segments"][number][]; arcs: PlanInput["arcs"][number][]; fills: PlanInput["fills"][number][]; texts: PlanInput["texts"][number][] };

/** Many plans side by side, until there are at least n lines, and the walls, openings and rooms they should read as. */
function many(n: number): { input: PlanInput; walls: number; openings: number; rooms: number } {
  const out: Mutable = { segments: [], arcs: [], fills: [], texts: [] };
  let walls = 0;
  let openings = 0;
  let rooms = 0;
  for (let i = 0; out.segments.length + out.fills.length * 4 < n; i++) {
    const { input, expect } = samplePlans(100 + i)[i % 3];
    walls += expect.walls.length;
    openings += expect.openings.length;
    rooms += expect.rooms.length;
    const dx = (i % 8) * 16000;
    const dy = Math.floor(i / 8) * 13000;
    const mv = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
    for (const s of input.segments) out.segments.push({ ...s, a: mv(s.a), b: mv(s.b), id: `${i}:${s.id}` });
    for (const a of input.arcs) out.arcs.push({ ...a, center: mv(a.center), id: `${i}:${a.id}` });
    for (const f of input.fills) out.fills.push({ ...f, points: f.points.map(mv), id: `${i}:${f.id}` });
    for (const t of input.texts) out.texts.push({ ...t, at: mv(t.at), id: `${i}:${t.id}` });
  }
  return { input: out, walls, openings, rooms };
}

/** A plan and what it should read as, turned about the origin. */
function turned({ input, expect }: { input: PlanInput; expect: Expect }, deg: number): { input: PlanInput; expect: Expect } {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  const t = (p: Pt): Pt => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const v = (p: Pt): Pt => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  return {
    input: {
      segments: input.segments.map((x) => ({ ...x, a: t(x.a), b: t(x.b) })),
      arcs: input.arcs.map((x) => ({ ...x, center: t(x.center), start: x.start + deg })),
      fills: input.fills.map((x) => ({ ...x, points: x.points.map(t) })),
      texts: input.texts.map((x) => ({ ...x, at: t(x.at) })),
    },
    expect: {
      ...expect,
      name: `${expect.name} turned ${deg}°`,
      walls: expect.walls.map((w) => ({ ...w, a: t(w.a), b: t(w.b) })),
      openings: expect.openings.map((o) => ({ ...o, at: t(o.at), hinge: o.hinge && t(o.hinge), opens: o.opens && v(o.opens) })),
      clear: expect.clear?.map(t),
    },
  };
}

function main(): void {
  for (const seed of [7, 31]) for (const { input, expect } of samplePlans(seed)) verify(input, { ...expect, name: `${expect.name} (seed ${seed})` });
  for (const [k, deg] of [
    [0, 17],
    [1, 52],
    [2, -30],
  ]) {
    const { input, expect } = turned(samplePlans(11)[k], deg);
    verify(input, expect);
  }

  // the walls chained for building: the house's outside walls one closed loop, the wall across it a run of its own
  for (const [k, deg] of [
    [0, 0],
    [0, 17],
  ]) {
    const { input } = turned(samplePlans(7)[k], deg);
    const runs = wallPaths(readPlan(input));
    const loop = runs.find((w) => w.closed);
    check(runs.length === 2 && !!loop && loop.path.length === 4 && Math.abs(loop.thickness - 300) <= 5, `house turned ${deg}°: walls chained into a closed loop of 4 corners and one more run (${runs.map((w) => `${w.closed ? "closed" : "open"} ${w.path.length}`).join(", ")})`);
    check(!!loop && loop.openings.length === 3 && runs.reduce((n, w) => n + w.openings.length, 0) === 4, `house turned ${deg}°: the openings go with their runs (${runs.map((w) => w.openings.length).join(", ")})`);
    let built = "";
    try {
      const { parts } = buildParts(runs.map((w) => ({ kind: "walls", path: w.path, closed: w.closed, thickness: w.thickness, openings: w.openings })));
      built = `${parts.length} parts`;
    } catch (e) {
      built = e instanceof Error ? e.message : String(e);
    }
    check(/^\d+ parts$/.test(built), `house turned ${deg}°: the runs build as they are (${built})`);
  }

  const empty = readPlan({ segments: [], arcs: [], fills: [], texts: [] });
  check(!empty.walls.length && empty.notes.length === 1, "no line work: an empty reading with a note");
  const junk = readPlan({ segments: [{ a: P(NaN, 0), b: P(1, 1), id: "x", className: "" }, { a: P(0, 0), b: P(100, 0), id: "y", className: "" }], arcs: [], fills: [], texts: [] });
  check(!junk.walls.length && junk.notes.length > 0, "a stray line and a broken one: no walls, a note");

  const big = many(20000);
  const lineCount = big.input.segments.length + big.input.fills.length * 4;
  const t0 = performance.now();
  const r = readPlan(big.input);
  const ms = performance.now() - t0;
  check(ms < 1500, `a plan of ${lineCount} lines reads in under 1.5 s (${ms.toFixed(0)} ms)`);
  check(r.walls.length === big.walls && r.openings.length === big.openings && r.rooms.length === big.rooms, `that plan, many plans side by side: ${big.walls} walls, ${big.openings} openings, ${big.rooms} rooms (read ${r.walls.length}, ${r.openings.length}, ${r.rooms.length})`);

  // ---- a real drawing, read here only, never printed beyond counts and timings ----
  const file = process.argv[2];
  if (!file) console.log("skip no drawing named");
  else if (!existsSync(file)) console.log(`skip ${file} isn't here`);
  else {
    const t1 = performance.now();
    const s = openVwx(new Uint8Array(readFileSync(file)), "drawing.vwx");
    console.log(`     opened in ${(performance.now() - t1).toFixed(0)} ms`);
    for (const layer of s.doc.layers()) {
      if (layer.kind !== "design") continue;
      const input: Mutable = { segments: [], arcs: [], fills: [], texts: [] };
      for (const o of s.doc.objects(layer.id)) {
        const sh = o.shape;
        if (!sh || o.className.includes("ViewportRectangle")) continue;
        if (sh.kind === "line" || sh.kind === "rect" || sh.kind === "polygon" || sh.kind === "polyline") {
          const pts = sh.points;
          const closed = sh.closed || sh.kind === "rect";
          const n = closed ? pts.length : pts.length - 1;
          for (let i = 0; i < n; i++) input.segments.push({ a: pts[i], b: pts[(i + 1) % pts.length], id: o.id, className: o.className });
          if (closed && o.attrs && o.attrs.fillPattern !== 0) input.fills.push({ points: pts, id: o.id, className: o.className });
        } else if (sh.kind === "arc" && sh.center && sh.rx) {
          input.arcs.push({ center: sh.center, radius: sh.rx, start: sh.startAngle ?? 0, sweep: sh.sweepAngle ?? 360, id: o.id, className: o.className });
        } else if (sh.kind === "text" && sh.text) {
          const b = sh.bbox;
          input.texts.push({ at: sh.anchor ?? (b ? P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) : P(0, 0)), text: sh.text, id: o.id });
        }
      }
      if (input.segments.length < 10) continue;
      const t2 = performance.now();
      const got = readPlan(input);
      const took = performance.now() - t2;
      console.log(`     a layer: ${input.segments.length} segments, ${input.arcs.length} arcs, ${input.fills.length} fills, ${input.texts.length} texts in: ${got.walls.length} walls, ${got.openings.length} openings, ${got.rooms.length} rooms, ${got.notes.length} notes, ${took.toFixed(0)} ms`);
      check(took < Math.max(2000, input.segments.length / 10), `a layer of ${input.segments.length} segments reads in time`);
    }
  }

  if (failures) {
    console.error(`${failures} check${failures === 1 ? "" : "s"} failed`);
    process.exit(1);
  }
  console.log("all checks passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
