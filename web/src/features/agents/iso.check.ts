// Checks the isometric solver under Node. Run from web/:
//   npx tsx src/features/agents/iso.check.ts [drawing.vwx]
// Known models (a box, an L-shaped block, gable houses at 39° and 45°, a hipped house, two boxes
// apart) are drawn in true isometric with their hidden edges, broken into pieces and jittered, and
// must come back where they were, with their edges and faces. With a drawing of Make2D line work
// named, each such layer must solve in a few seconds with most of its lines placed; only counts
// are printed.

import { existsSync, readFileSync } from "node:fs";
import { openVwx } from "../../core/index.ts";
import type { Pt } from "../../core/types.ts";
import { findAxes, readDrawn, unprojectIso, type IsoModel, type IsoSegment } from "./iso.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V = [number, number, number];
interface Model {
  name: string;
  verts: V[];
  edges: [number, number][];
  faces: number[][];
}

// true isometric: x up to the right, y up to the left, z up, each foreshortened to √(2/3)
const S = Math.sqrt(2 / 3);
const C30 = Math.cos(Math.PI / 6);
const draw = (p: readonly number[]): Pt => ({ x: S * C30 * (p[0] - p[1]), y: S * 0.5 * (p[0] + p[1]) + S * p[2] });

function prism(name: string, footprint: [number, number][], h: number, at: V = [0, 0, 0]): Model {
  const n = footprint.length;
  const verts: V[] = [...footprint.map(([x, y]): V => [x + at[0], y + at[1], at[2]]), ...footprint.map(([x, y]): V => [x + at[0], y + at[1], at[2] + h])];
  const edges: [number, number][] = [];
  const faces: number[][] = [[...Array(n).keys()], [...Array(n).keys()].map((i) => n + i)];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edges.push([i, j], [n + i, n + j], [i, n + i]);
    faces.push([i, j, n + j, n + i]);
  }
  return { name, verts, edges, faces };
}

function house(name: string, L: number, W: number, h: number, rise: number, hip: number): Model {
  const m = prism(name, [
    [0, 0],
    [L, 0],
    [L, W],
    [0, W],
  ], h);
  const r0 = m.verts.push([hip, W / 2, h + rise]) - 1;
  const r1 = m.verts.push([L - hip, W / 2, h + rise]) - 1;
  // top corners 4 (0,0), 5 (L,0), 6 (L,W), 7 (0,W)
  m.edges.push([r0, r1], [4, r0], [7, r0], [5, r1], [6, r1]);
  m.faces = m.faces.filter((f) => !(f.length === 4 && f.every((v) => v >= 4)));
  m.faces.push([4, 5, r1, r0], [6, 7, r0, r1], [4, 7, r0], [5, 6, r1]);
  return m;
}

/** A model's edges drawn as line work: each broken into one to three pieces, some hidden, ends jittered. */
function drawn(models: readonly Model[], seed: number): IsoSegment[] {
  let r = seed;
  const rand = (): number => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: IsoSegment[] = [];
  for (const m of models) {
    for (const [a, b] of m.edges) {
      const pa = draw(m.verts[a]);
      const pb = draw(m.verts[b]);
      const cuts = [0, ...Array.from({ length: Math.floor(rand() * 3) }, () => 0.15 + rand() * 0.7).sort(), 1];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const at = (t: number): Pt => ({ x: pa.x + (pb.x - pa.x) * t + (rand() - 0.5) * 0.1, y: pa.y + (pb.y - pa.y) * t + (rand() - 0.5) * 0.1 });
        out.push({ a: at(cuts[i]), b: at(cuts[i + 1]), hidden: rand() < 0.4 });
      }
    }
  }
  return out;
}

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nearest = (model: IsoModel, p: readonly number[]): number => {
  let best = -1;
  let bestD = Infinity;
  model.vertices.forEach((v, i) => {
    const d = dist(v, p);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
};

function area(pts: readonly (readonly number[])[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(nx, ny, nz) / 2;
}

const angle = (u: Pt): number => ((((Math.atan2(u.y, u.x) * 180) / Math.PI) % 360) + 360) % 360;

function solve(name: string, models: readonly Model[], seed: number): void {
  const model = unprojectIso(drawn(models, seed));
  check(Math.abs(angle(model.axes.x) - 30) < 0.1 && Math.abs(angle(model.axes.y) - 150) < 0.1 && Math.abs(angle(model.axes.z) - 90) < 0.1, `${name}: axes found at 30°, 150° and 90°`);
  check(model.axes.scale.every((s) => Math.abs(s - S) < 1e-3), `${name}: each axis foreshortened to √(2/3)`);
  check(model.components === models.length, `${name}: ${models.length} piece${models.length === 1 ? "" : "s"} (found ${model.components})`);
  check(model.skipped === 0, `${name}: no lines left out (${model.skipped})`);
  for (const m of models) {
    // one translation for the whole model, which standing it on the ground makes none
    const pairs = m.verts.map((p) => [p, model.vertices[nearest(model, p)]] as const);
    const shift = pairs.map(([p, q]) => [q[0] - p[0], q[1] - p[1], q[2] - p[2]]);
    const worst = Math.max(...shift.map((s) => dist(s, shift[0])));
    check(worst < 1, `${m.name}: every corner where it was, up to one move (worst ${worst.toFixed(3)} mm)`);
    check(dist(shift[0], [0, 0, 0]) < 1, `${m.name}: stood where it was drawn, on the ground (off by ${dist(shift[0], [0, 0, 0]).toFixed(3)} mm)`);
    // every edge covered by solved edges along it
    const missing = m.edges.filter(([a, b]) => {
      const pa = m.verts[a];
      const pb = m.verts[b];
      const len = dist(pa, pb);
      let covered = 0;
      for (const [i, j] of model.edges) {
        const qi = model.vertices[i];
        const qj = model.vertices[j];
        if (onSegment(qi, pa, pb) && onSegment(qj, pa, pb)) covered += dist(qi, qj);
      }
      return Math.abs(covered - len) > 1;
    });
    check(!missing.length, `${m.name}: all ${m.edges.length} edges found${missing.length ? ` (${missing.length} missing)` : ""}`);
    const lost = m.faces.filter((f) => {
      const corners = f.map((v) => m.verts[v]);
      const want = area(corners);
      return !model.faces.some((g) => {
        const pts = g.map((v) => model.vertices[v]);
        return corners.every((c) => pts.some((p) => dist(p, c) < 1)) && Math.abs(area(pts) - want) < want * 0.01;
      });
    });
    check(!lost.length, `${m.name}: all ${m.faces.length} faces found${lost.length ? ` (${lost.length} missing)` : ""}`);
  }
}

/** within a millimetre of segment ab, between its ends */
function onSegment(p: readonly number[], a: readonly number[], b: readonly number[]): boolean {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2;
  const len = Math.sqrt(l2);
  return t * len > -1 && (1 - t) * len > -1 && dist(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]) < 1;
}

solve("box", [prism("box", [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
], 2500, [1000, 2000, 0])], 1);
solve("L-shaped block", [prism("L-shaped block", [
  [0, 0],
  [6000, 0],
  [6000, 2000],
  [2000, 2000],
  [2000, 5000],
  [0, 5000],
], 3000)], 2);
solve("gable house", [house("gable house", 8000, 5000, 2800, 2000, 0)], 3);
// a 45° roof's verges are drawn in line with the eave and ridge
solve("45° gable house", [house("45° gable house", 6000, 4000, 2500, 2000, 0)], 6);
solve("hipped house", [house("hipped house", 9000, 5000, 2800, 2000, 2500)], 4);
solve("two boxes", [
  prism("first box", [
    [0, 0],
    [3000, 0],
    [3000, 2000],
    [0, 2000],
  ], 2000),
  prism("second box", [
    [0, 0],
    [2000, 0],
    [2000, 2000],
    [0, 2000],
  ], 4000, [15000, -15000, 0]),
], 5);

// ---- measuring: the 45° house's lines read back as lengths, heights and pitches ----
{
  const m = house("measured house", 6000, 4000, 2500, 2000, 0);
  const axes = findAxes(drawn([m], 7));
  check(!!axes && Math.abs(axes.from[0] + 1 / Math.sqrt(3)) < 1e-3 && Math.abs(axes.from[1] + 1 / Math.sqrt(3)) < 1e-3 && axes.from[2] > 0, "measuring: seen from the front left, above");
  if (axes) {
    const read = (i: number, j: number) => readDrawn(axes, draw(m.verts[i]), draw(m.verts[j]));
    const eave = read(4, 5);
    check(eave.axis === "x" && Math.abs((eave.length ?? 0) - 6000) < 1, `measuring: the eave runs 6000 along x (${eave.axis} ${eave.length})`);
    const corner = read(0, 4);
    check(corner.axis === "z" && Math.abs((corner.length ?? 0) - 2500) < 1, `measuring: the corner rises 2500 (${corner.axis} ${corner.length})`);
    const verge = read(4, 8).planes.find((p) => p.plane === "yz");
    check(!!verge && Math.abs(verge.slope - 45) < 0.1 && Math.abs(verge.run[2] - 2000) < 1, `measuring: the verge rises 2000 at 45° in the upright plane (${verge?.run[2]} at ${verge?.slope}°)`);
  }
}

// ---- a real drawing of Make2D line work, read here only, never printed ----
const file = process.argv[2];
if (!file) {
  console.log("skip no drawing named");
} else if (!existsSync(file)) {
  console.log(`skip ${file} isn't here`);
} else {
  const s = openVwx(new Uint8Array(readFileSync(file)), "drawing.vwx");
  for (const layer of s.doc.layers()) {
    if (layer.kind !== "design") continue;
    const segs: IsoSegment[] = [];
    let make2d = 0;
    for (const o of s.doc.objects(layer.id)) {
      if (o.className.startsWith("Make2D$")) make2d++;
      const sh = o.shape;
      if (!sh || o.className.includes("ViewportRectangle") || !["line", "rect", "polygon", "polyline"].includes(sh.kind)) continue;
      const n = sh.closed || sh.kind === "rect" ? sh.points.length : sh.points.length - 1;
      for (let i = 0; i < n; i++) segs.push({ a: sh.points[i], b: sh.points[(i + 1) % sh.points.length], hidden: o.className.includes("$Hidden$") });
    }
    if (make2d < 50 || segs.length > 6000) continue;
    const t0 = performance.now();
    const m = unprojectIso(segs);
    const ms = performance.now() - t0;
    const placed = 1 - m.skipped / segs.length;
    console.log(`     ${segs.length} segments in: ${m.vertices.length} corners, ${m.edges.length} edges, ${m.faces.length} faces, ${m.components} pieces, ${m.skipped} left out, ${ms.toFixed(0)} ms`);
    console.log(`     ${m.notes[0] ?? ""}`);
    check(ms < 3000, `a layer of ${segs.length} segments solves in under 3 s`);
    check(placed > 0.9 && m.faces.length > 0, `a layer of ${segs.length} segments: ${(placed * 100).toFixed(0)}% placed, with faces`);
  }
}

if (failures) {
  console.error(`${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("all checks passed");
