// Node check of the section cut. Run from web/: npx tsx src/app/sectionCut.check.ts

import assert from "node:assert/strict";
import type { Pt } from "../core/index.ts";
import { nearestHit, sectionDrawing, type CutMesh, type SectionPiece } from "./sectionCut.ts";

type V3 = [number, number, number];

/** A box's 12 triangles and its 12 edges. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { triangles: number[]; edges: number[] } {
  const c = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  const pairs = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return {
    triangles: quads.flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]),
    edges: pairs.flatMap(([a, b]) => [...c(a), ...c(b)]),
  };
}

/** An upright cylinder of `sides` facets, its caps fanned, no edges given. */
function cylinder(cx: number, cy: number, r: number, z0: number, z1: number, sides: number): number[] {
  const p = (i: number, z: number): V3 => [cx + r * Math.cos((2 * Math.PI * i) / sides), cy + r * Math.sin((2 * Math.PI * i) / sides), z];
  const t: number[] = [];
  for (let i = 0; i < sides; i++) {
    t.push(...p(i, z0), ...p(i + 1, z0), ...p(i + 1, z1), ...p(i, z0), ...p(i + 1, z1), ...p(i, z1));
    t.push(cx, cy, z0, ...p(i + 1, z0), ...p(i, z0));
    t.push(cx, cy, z1, ...p(i, z1), ...p(i + 1, z1));
  }
  return t;
}

/** A square tube running along y: outer [0, 1000]² and inner [300, 700]² in x and z, from y0 to y1. */
function tube(y0: number, y1: number): number[] {
  const o = [0, 1000];
  const n = [300, 700];
  const ring = (s: number[]): [number, number][] => [
    [s[0], s[0]],
    [s[1], s[0]],
    [s[1], s[1]],
    [s[0], s[1]],
  ];
  const out = ring(o);
  const inn = ring(n);
  const t: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3): void => {
    t.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const r of [out, inn]) quad([r[i][0], y0, r[i][1]], [r[j][0], y0, r[j][1]], [r[j][0], y1, r[j][1]], [r[i][0], y1, r[i][1]]);
    for (const y of [y0, y1]) quad([out[i][0], y, out[i][1]], [out[j][0], y, out[j][1]], [inn[j][0], y, inn[j][1]], [inn[i][0], y, inn[i][1]]);
  }
  return t;
}

const mesh = (id: string, triangles: number[], edges: number[] = [], color = "#808080"): CutMesh => ({ id, triangles: new Float32Array(triangles), edges: new Float32Array(edges), color });
const area = (ring: readonly Pt[]): number => Math.abs(ring.reduce((s, p, i) => s + (ring[(i + 1) % ring.length].x - p.x) * (ring[(i + 1) % ring.length].y + p.y), 0)) / 2;
const piece = (pieces: readonly SectionPiece[], id: string): SectionPiece | undefined => pieces.find((p) => p.id === id);
const segments = (lines: readonly Pt[][]): [Pt, Pt][] => lines.flatMap((l) => l.slice(1).map((p, i): [Pt, Pt] => [l[i], p]));
const near = (a: number, b: number, e = 1e-3): boolean => Math.abs(a - b) <= e;

// a line running east from x -500 to 1500 along y 500, looking north (to its left)
const east = { a: { x: -500, y: 500 }, b: { x: 1500, y: 500 }, look: "left" as const, depth: Infinity };

// a box the plane cuts, a taller narrower one behind it, one in front of the plane
{
  const a = box(0, 0, 0, 1000, 1000, 1000);
  const b = box(200, 2000, 0, 800, 3000, 2000);
  const front = box(0, -2000, 0, 1000, -1000, 3000);
  const d = sectionDrawing([mesh("A", a.triangles, a.edges, "#ff0000"), mesh("B", b.triangles, b.edges), mesh("F", front.triangles, front.edges)], east);
  const A = piece(d.pieces, "A");
  assert.ok(A, "the cut box is drawn");
  assert.equal(A.cuts.length, 1);
  assert.equal(A.cuts[0].color, "#ff0000");
  assert.equal(A.cuts[0].holes.length, 0);
  assert.ok(near(area(A.cuts[0].outer), 1e6, 1), `cut area ${area(A.cuts[0].outer)}`);
  const xs = A.cuts[0].outer.map((p) => p.x);
  const ys = A.cuts[0].outer.map((p) => p.y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [500, 1500, 0, 1000]);
  assert.equal(piece(d.pieces, "F"), undefined, "what's in front of the plane isn't drawn");
  const B = piece(d.pieces, "B");
  assert.ok(B, "the box behind is drawn");
  const segs = segments(B.lines);
  // nothing of it shows through the cut
  for (const [p, q] of segs)
    for (const t of [0.25, 0.5, 0.75]) {
      const x = p.x + (q.x - p.x) * t;
      const y = p.y + (q.y - p.y) * t;
      assert.ok(!(x > 501 && x < 1499 && y > 1 && y < 999), `a line through the cut at ${x},${y}`);
    }
  // its sides show above the cut, from its top down to the cut's
  for (const x of [700, 1300]) {
    const side = segs.filter(([p, q]) => near(p.x, x) && near(q.x, x));
    assert.equal(side.length, 1, `one side at ${x}`);
    const [y0, y1] = [side[0][0].y, side[0][1].y].sort((m, n) => m - n);
    assert.ok(near(y0, 1000, 0.5) && near(y1, 2000), `side ${x} runs ${y0}..${y1}`);
  }
  assert.ok(segs.some(([p, q]) => near(p.y, 2000) && near(q.y, 2000) && near(Math.abs(q.x - p.x), 600)), "its top edge whole");
  assert.deepEqual(d.box, { x0: 500, y0: 0, x1: 1500, y1: 2000 });

  // only between two heights
  const band = sectionDrawing([mesh("A", a.triangles, a.edges), mesh("B", b.triangles, b.edges)], { ...east, bottom: 200, top: 1500 });
  assert.ok(near(area(piece(band.pieces, "A")!.cuts[0].outer), 800e3, 1));
  const bandSides = segments(piece(band.pieces, "B")!.lines).filter(([p, q]) => near(p.x, q.x));
  assert.equal(bandSides.length, 2);
  for (const [p, q] of bandSides) assert.ok(near(Math.min(p.y, q.y), 1000, 0.5) && near(Math.max(p.y, q.y), 1500));
  assert.deepEqual(band.box, { x0: 500, y0: 200, x1: 1500, y1: 1500 });
  // only so far beyond the plane
  const short = sectionDrawing([mesh("A", a.triangles, a.edges), mesh("B", b.triangles, b.edges)], { ...east, depth: 1000 });
  assert.equal(piece(short.pieces, "B"), undefined);
  // the cut alone
  const cutOnly = sectionDrawing([mesh("A", a.triangles, a.edges), mesh("B", b.triangles, b.edges)], { ...east, depth: 0 });
  assert.equal(cutOnly.pieces.length, 1);
  assert.equal(cutOnly.pieces[0].lines.length, 0);
  // looking south (right of the line): the front box is beyond now, the one north isn't, and x runs the other way
  const south = sectionDrawing([mesh("A", a.triangles, a.edges), mesh("B", b.triangles, b.edges), mesh("F", front.triangles, front.edges)], { ...east, look: "right" });
  assert.ok(piece(south.pieces, "F"));
  assert.equal(piece(south.pieces, "B"), undefined);
  const sx = piece(south.pieces, "A")!.cuts[0].outer.map((p) => p.x);
  assert.deepEqual([Math.min(...sx), Math.max(...sx)], [-1500, -500]);
}

// touching the plane isn't cutting: a box beyond with its face on it is drawn whole, one in front with its face on it isn't drawn
{
  const beyond = box(0, 500, 0, 1000, 1500, 1000);
  const before = box(2000, -500, 0, 3000, 500, 2000);
  const d = sectionDrawing([mesh("B", beyond.triangles, beyond.edges), mesh("F", before.triangles, before.edges)], { ...east, b: { x: 4000, y: 500 } });
  const B = piece(d.pieces, "B")!;
  assert.equal(B.cuts.length, 0);
  assert.equal(segments(B.lines).reduce((n, [p, q]) => n + Math.hypot(q.x - p.x, q.y - p.y), 0), 4000, "its outline");
  assert.equal(piece(d.pieces, "F"), undefined);
}

// a box turned 45° with two of its upright edges on the plane: cut across its whole width
{
  const c = (x: number, y: number, z: number): V3 => [x, y, z];
  const ring = [c(0, 500, 0), c(500, 0, 0), c(1000, 500, 0), c(500, 1000, 0)];
  const t: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 4];
    t.push(...p, ...q, q[0], q[1], 1000, ...p, q[0], q[1], 1000, p[0], p[1], 1000);
  }
  t.push(...ring[0], ...ring[1], ...ring[2], ...ring[0], ...ring[2], ...ring[3]);
  t.push(0, 500, 1000, 500, 0, 1000, 1000, 500, 1000, 0, 500, 1000, 1000, 500, 1000, 500, 1000, 1000);
  const d = sectionDrawing([mesh("D", t)], east);
  assert.equal(d.pieces[0].cuts.length, 1);
  assert.ok(near(area(d.pieces[0].cuts[0].outer), 1e6, 1), `diamond cut ${area(d.pieces[0].cuts[0].outer)}`);
}

// only across the line's length: a line from x 0 to 600 cuts the box to 600 wide
{
  const a = box(0, 0, 0, 1000, 1000, 1000);
  const d = sectionDrawing([mesh("A", a.triangles, a.edges)], { a: { x: 0, y: 500 }, b: { x: 600, y: 500 }, look: "left", depth: Infinity });
  assert.ok(near(area(d.pieces[0].cuts[0].outer), 600e3, 1));
  for (const l of d.pieces[0].lines) for (const p of l) assert.ok(p.x >= -1e-6 && p.x <= 600 + 1e-6);
}

// a cylinder beyond the plane, no edges given: its rims and its outline left and right
{
  const d = sectionDrawing([mesh("C", cylinder(500, 2000, 300, 0, 1000, 48))], east);
  const C = d.pieces[0];
  assert.equal(C.cuts.length, 0);
  const segs = segments(C.lines);
  const upright = segs.filter(([p, q]) => near(p.x, q.x, 1e-6) && Math.abs(q.y - p.y) > 999);
  assert.equal(upright.length, 2, `two outlines, got ${upright.length}`);
  const ux = upright.map(([p]) => p.x).sort((m, n) => m - n);
  assert.ok(near(ux[0], 700, 1) && near(ux[1], 1300, 1), `outlines at ${ux}`);
  // rims top and bottom, seen edge on: lines across
  assert.ok(segs.some(([p, q]) => near(p.y, 1000) && near(q.y, 1000)));
  // no facet lines between
  assert.ok(!segs.some(([p, q]) => near(p.x, q.x, 1e-6) && p.x > 710 && p.x < 1290), "facet lines drawn");
}

// a cylinder cut through: a round cut
{
  const d = sectionDrawing([mesh("C", cylinder(500, 500, 300, 0, 1000, 48))], east);
  const cut = d.pieces[0].cuts[0];
  assert.ok(near(area(cut.outer), 600 * 1000, 2), `round cut ${area(cut.outer)}`);
}

// a square tube cut across: its cut a ring with a hole, what's beyond seen through the hole
{
  const inHole = box(400, 2000, 400, 600, 2500, 600);
  const half = box(100, 2000, 450, 500, 2500, 550);
  const d = sectionDrawing([mesh("T", tube(0, 1000)), mesh("I", inHole.triangles, inHole.edges), mesh("H", half.triangles, half.edges)], east);
  const T = piece(d.pieces, "T")!;
  assert.equal(T.cuts.length, 1);
  assert.equal(T.cuts[0].holes.length, 1);
  assert.ok(near(area(T.cuts[0].outer), 1e6, 1) && near(area(T.cuts[0].holes[0]), 160e3, 1));
  // the box in the hole whole; the other only where the hole shows it, from the hole's side at 800
  assert.equal(segments(piece(d.pieces, "I")!.lines).reduce((n, [p, q]) => n + Math.hypot(q.x - p.x, q.y - p.y), 0), 800);
  const xs = segments(piece(d.pieces, "H")!.lines).flatMap(([p, q]) => [p.x, q.x]);
  assert.ok(near(Math.min(...xs), 800, 0.1) && near(Math.max(...xs), 1000), `seen ${Math.min(...xs)}..${Math.max(...xs)}`);
}

// an open surface across the plane: a cut line, not filled
{
  const t = [200, 0, 0, 200, 1000, 0, 200, 1000, 1000, 200, 0, 0, 200, 1000, 1000, 200, 0, 1000];
  const d = sectionDrawing([mesh("S", t)], east);
  assert.equal(d.pieces[0].cuts.length, 0);
  assert.equal(d.pieces[0].cutLines.length, 1);
  const l = d.pieces[0].cutLines[0];
  assert.ok(l.every((p) => near(p.x, 700)));
}

// two pieces of one object in two colours: one cut each, each its own colour
{
  const a = box(0, 0, 0, 1000, 1000, 1000);
  const b = box(2000, 0, 0, 3000, 1000, 1000);
  const d = sectionDrawing([mesh("G", a.triangles, a.edges, "#ff0000"), mesh("G", b.triangles, b.edges, "#00ff00")], { a: { x: -500, y: 500 }, b: { x: 3500, y: 500 }, look: "left", depth: Infinity });
  assert.equal(d.pieces.length, 1);
  assert.deepEqual(d.pieces[0].cuts.map((c) => c.color).sort(), ["#00ff00", "#ff0000"]);
}

// the nearest face along a ray, either way it's wound
{
  const a = box(0, 0, 0, 1000, 1000, 1000);
  const b = box(0, 3000, 0, 1000, 4000, 1000);
  const ms = [mesh("A", a.triangles), mesh("B", b.triangles)];
  assert.equal(nearestHit(ms, [500, 2000, 500], [0, 1, 0]), 1000);
  assert.equal(nearestHit(ms, [500, 2000, 500], [0, -1, 0]), 1000);
  assert.equal(nearestHit(ms, [500, 500, 500], [0, 0, 1]), 500, "from inside");
  assert.equal(nearestHit(ms, [5000, 2000, 500], [1, 0, 0]), null);
}

// a big model in reasonable time
{
  const meshes: CutMesh[] = [];
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) meshes.push(mesh(`c${i}-${j}`, cylinder(i * 700, j * 700 - 3000, 250, 0, 1000 + ((i * j) % 7) * 300, 32)));
  const start = performance.now();
  const d = sectionDrawing(meshes, { a: { x: -500, y: 0 }, b: { x: 30000, y: 0 }, look: "left", depth: Infinity });
  const ms = performance.now() - start;
  console.log(`${meshes.length} cylinders, ${meshes.reduce((n, m) => n + m.triangles.length / 9, 0)} triangles: ${d.pieces.length} drawn in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 15000);
}

console.log("section cut checks passed");
