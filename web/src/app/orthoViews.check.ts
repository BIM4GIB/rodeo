// Node check of Create Multiple Viewports' views and layout. Run from web/: npx tsx src/app/orthoViews.check.ts

import assert from "node:assert/strict";
import { layOut, ORTHO_VIEWS, orthoFrame, seenBox, viewAxes, viewName, type Method, type OrthoView } from "./orthoViews.ts";
import { sectionView, type CutMesh, type SectionDrawing } from "./sectionCut.ts";

type V3 = [number, number, number];

/** A box's 12 triangles and its 12 edges. */
function box(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): CutMesh {
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
    id,
    triangles: new Float32Array(quads.flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)])),
    edges: new Float32Array(pairs.flatMap(([a, b]) => [...c(a), ...c(b)])),
    color: "#808080",
  };
}

const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;

// the axes: unit, square, and across × up back at the viewer
for (const method of ["first", "third"] as Method[]) {
  for (const view of ORTHO_VIEWS) {
    const [r, u, t] = viewAxes(view, method);
    const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const a of [r, u, t]) assert.ok(near(dot(a, a), 1, 1e-12), `${view} axis unit`);
    assert.ok(near(dot(r, u), 0, 1e-12) && near(dot(r, t), 0, 1e-12) && near(dot(u, t), 0, 1e-12), `${view} axes square`);
    const x = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
    assert.ok(near(dot(x, t), -1, 1e-12), `${view} across × up faces the viewer`);
    // up never points down, and only Top and Bottom look along z
    assert.ok(u[2] >= 0 || view === "bottom" || view === "top");
  }
}
assert.equal(viewName("iso", "third"), "Right Isometric");
assert.equal(viewName("iso", "first"), "Left Isometric");
assert.equal(viewName("front", "first"), "Front");

// a slab A with a block B on its top at the front right
const A = box("A", 0, 0, 0, 3000, 1000, 2000);
const B = box("B", 2000, 0, 2000, 3000, 400, 2600);
const meshes = [A, B];
const lo: V3 = [0, 0, 0];
const hi: V3 = [3000, 1000, 2600];
const draw = (view: OrthoView, method: Method = "third"): SectionDrawing => sectionView(meshes, orthoFrame(view, method, lo, hi));

/** How much of the level line at height y from x a to b is drawn (by A or B). */
function levelRun(d: SectionDrawing, y: number, a: number, b: number): number {
  let sum = 0;
  for (const p of d.pieces)
    for (const l of p.lines)
      for (let i = 0; i + 1 < l.length; i++) {
        const [s, e] = [l[i], l[i + 1]];
        if (!near(s.y, y, 0.5) || !near(e.y, y, 0.5)) continue;
        const x0 = Math.max(Math.min(s.x, e.x), a);
        const x1 = Math.min(Math.max(s.x, e.x), b);
        if (x1 > x0) sum += x1 - x0;
      }
  return sum;
}
function boxNear(got: { x0: number; y0: number; x1: number; y1: number } | null, want: { x0: number; y0: number; x1: number; y1: number }, what: string): void {
  assert.ok(got, `${what}: something drawn`);
  for (const k of ["x0", "y0", "x1", "y1"] as const) assert.ok(near(got[k], want[k], 0.5), `${what} ${k}: ${got[k]} vs ${want[k]}`);
}

// nothing is cut: every view sees the whole model from outside
for (const view of ORTHO_VIEWS) {
  const d = draw(view);
  assert.ok(d.pieces.every((p) => !p.cuts.length && !p.cutLines.length), `${view}: nothing cut`);
  if (view !== "iso") boxNear(d.box, seenBox(view, "third", lo, hi), `${view} box`);
}
// the views centre on the model's middle (1500, 500, 1300), each along its own axes
boxNear(seenBox("front", "third", lo, hi), { x0: -1500, y0: -1300, x1: 1500, y1: 1300 }, "front seen");
boxNear(seenBox("right", "third", lo, hi), { x0: -500, y0: -1300, x1: 500, y1: 1300 }, "right seen");
boxNear(seenBox("top", "third", lo, hi), { x0: -1500, y0: -500, x1: 1500, y1: 500 }, "top seen");

// B's top edge: Front sees it at x 500–1500, Back mirrored at -1500 – -500, Right (front to the left) at -500 – -100, Left at 100–500
assert.ok(near(levelRun(draw("front"), 1300, 500, 1500), 1000, 1), "front: B's top");
assert.ok(near(levelRun(draw("back"), 1300, -1500, -500), 1000, 1), "back: B's top, mirrored");
assert.ok(near(levelRun(draw("right"), 1300, -500, -100), 400, 1), "right: B's top at the front, on the left");
assert.ok(near(levelRun(draw("left"), 1300, 100, 500), 400, 1), "left: B's top at the front, on the right");
// Top sees B's back edge at y 400 → -100; Bottom doesn't see B at all (A hides it), only A's outline
assert.ok(near(levelRun(draw("top"), -100, 500, 1500), 1000, 1), "top: B's back edge");
const bottom = draw("bottom");
assert.equal(bottom.pieces.filter((p) => p.id === "B").length, 0, "bottom: B hidden behind A");
// the bottom looks up with its front edge at the top: A's front edge (y 0) is at +500
assert.ok(near(levelRun(bottom, 500, -1500, 1500), 3000, 1), "bottom: A's front edge at the top");
// Front sees A's front face, not its back edges: its top edge only once, from 0 to 2000 (B stands on the rest)
assert.ok(near(levelRun(draw("front"), 700, -1500, 500), 2000, 1), "front: A's top edge where B doesn't stand");
const iso = draw("iso");
assert.ok(iso.box && iso.box.x1 - iso.box.x0 > 3000 * Math.SQRT1_2, "iso: wider than A's width foreshortened");
// B's middle (2500, 200) across each: (1000 + 300) / √2 from the left, (1000 - 300) / √2 from the right
const middleOf = (d: SectionDrawing, id: string): number => {
  const xs = d.pieces.filter((p) => p.id === id).flatMap((p) => p.lines.flat().map((q) => q.x));
  return (Math.min(...xs) + Math.max(...xs)) / 2;
};
assert.ok(near(middleOf(iso, "B"), 700 * Math.SQRT1_2, 1), "third angle's isometric is the right one");
assert.ok(near(middleOf(draw("iso", "first"), "B"), 1300 * Math.SQRT1_2, 1), "first angle's isometric is the left one");

// layout, third angle: Top over Front, Right to its right, Left to its left, Back past Right, Bottom under, iso over Right
const halves = (view: OrthoView): { view: OrthoView; halfW: number; halfH: number } => {
  const b = seenBox(view, "third", lo, hi);
  return { view, halfW: (b.x1 - b.x0) / 2 / 50 + 10, halfH: (b.y1 - b.y0) / 2 / 50 + 10 };
};
const all = ORTHO_VIEWS.map(halves);
const third = layOut(all, "third", 20);
const at = (m: Map<OrthoView, { x: number; y: number }>, v: OrthoView): { x: number; y: number } => {
  const p = m.get(v);
  assert.ok(p, `${v} placed`);
  return p;
};
const half = (v: OrthoView): { halfW: number; halfH: number } => all.find((h) => h.view === v) ?? { halfW: 0, halfH: 0 };
assert.ok(near(at(third, "top").x, at(third, "front").x) && at(third, "top").y > at(third, "front").y, "third: top above front");
assert.ok(near(at(third, "bottom").x, at(third, "front").x) && at(third, "bottom").y < at(third, "front").y, "third: bottom below front");
for (const v of ["left", "right", "back"] as OrthoView[]) assert.ok(near(at(third, v).y, at(third, "front").y), `third: ${v} level with front`);
assert.ok(at(third, "left").x < at(third, "front").x && at(third, "right").x > at(third, "front").x && at(third, "back").x > at(third, "right").x, "third: left, front, right, back");
// Right shares its column with the iso, as wide as the wider of them
assert.ok(near(at(third, "right").x - at(third, "front").x, half("front").halfW + 20 + Math.max(half("right").halfW, half("iso").halfW)), "third: right a gap from front");
assert.ok(near(at(third, "iso").x, at(third, "right").x) && near(at(third, "iso").y, at(third, "top").y), "third: iso top right");
// centred on the sheet's origin
const xs = all.flatMap((h) => [at(third, h.view).x - h.halfW, at(third, h.view).x + h.halfW]);
const ys = all.flatMap((h) => [at(third, h.view).y - h.halfH, at(third, h.view).y + h.halfH]);
assert.ok(near(Math.min(...xs) + Math.max(...xs), 0) && near(Math.min(...ys) + Math.max(...ys), 0), "third: centred");

// first angle: Top under Front, Left to its right, Right to its left
const first = layOut(all, "first", 20);
assert.ok(at(first, "top").y < at(first, "front").y && at(first, "bottom").y > at(first, "front").y, "first: top below, bottom above");
assert.ok(at(first, "left").x > at(first, "front").x && at(first, "right").x < at(first, "front").x, "first: left on the right, right on the left");
assert.ok(near(at(first, "iso").x, at(first, "left").x) && near(at(first, "iso").y, at(first, "top").y), "first: iso bottom right");

// three views and an iso make a 2 × 2 block with no empty rows or columns
const few = layOut(["front", "top", "right", "iso"].map((v) => halves(v as OrthoView)), "third", 20);
assert.ok(near(at(few, "front").x, at(few, "top").x) && near(at(few, "iso").x, at(few, "right").x) && near(at(few, "iso").y, at(few, "top").y));
const width = half("front").halfW * 2 + 20 + Math.max(half("right").halfW, half("iso").halfW) * 2;
assert.ok(near(at(few, "front").x - half("front").halfW, -width / 2), "few: centred, no empty column");

console.log("orthoViews: all checks passed");
