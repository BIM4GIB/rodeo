// Node check of the solid editing sums. Run from web/: npx tsx src/app/solidOps.check.ts

import assert from "node:assert/strict";
import { subtractMeshes, unionMeshes } from "../core/csg.ts";
import { edgeCuts, edgeProblem, faceEdges, faceOutline, healed, meshVolume, nearestEdge, shellCopies, solidEdges, tangentChain, tangentFaces, taperedFace, type FacePick, faceSlab, faceSlabLines, isClosedMesh, movedFace, nestedRings, offsetRim, rimSideAt, ringSlab, solidFace, splitFaceRing, type Vec3 } from "./solidOps.ts";

const near = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

/** a box's triangles, from (x0, y0, z0) with these sizes */
function box(x0: number, y0: number, z0: number, w: number, d: number, h: number): number[] {
  const c = (x: number, y: number, z: number): number[] => [x0 + x * w, y0 + y * d, z0 + z * h];
  const quad = (a: number[], b: number[], e: number[], f: number[]): number[] => [...a, ...b, ...e, ...a, ...e, ...f];
  return [
    ...quad(c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)),
    ...quad(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)),
    ...quad(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)),
    ...quad(c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)),
    ...quad(c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)),
    ...quad(c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)),
  ];
}

const cube = box(-500, -500, 0, 1000, 1000, 1000);
near(meshVolume(cube), 1e9, 1);

// 12 creases, all outside corners; the flat diagonals don't count
const edges = solidEdges(cube);
assert.equal(edges.length, 12);
assert.ok(edges.every((e) => e.convex));

// a click near the middle of the top, toward +x, takes the edge at +x of the top
const pick: FacePick = { point: [450, 0, 1000], normal: [0, 0, 1] };
const i = nearestEdge(edges, pick.point, pick.normal)!;
assert.equal(Math.max(edges[i].a[0], edges[i].b[0]), 500);
assert.equal(Math.min(edges[i].a[0], edges[i].b[0]), 500);
assert.equal(edges[i].a[2], 1000);
// a face's edges are its four
assert.equal(faceEdges(edges, pick.point, pick.normal).length, 4);

// a chamfer of 100 takes a triangle 100 by 100 / 2 along the 1000 edge
const cut = subtractMeshes(cube, edgeCuts(cube, edges, [i], "chamfer", 100))!;
near(meshVolume(cut.triangles), 1e9 - 5000 * 1000, 1000);
// a fillet of 100 takes (1 - pi/4) of a square along the edge, and what its arc's 12 straight pieces lose: 22.4 mm2
const round = subtractMeshes(cube, edgeCuts(cube, edges, [i], "fillet", 100))!;
near(meshVolume(round.triangles), 1e9 - (1 - Math.PI / 4) * 10000 * 1000 - 22410, 100);
// the rest of the solid is untouched: chamfer the whole top
const top = faceEdges(edges, pick.point, pick.normal);
const allTop = subtractMeshes(cube, edgeCuts(cube, edges, top, "chamfer", 100))!;
// four prisms of 5,000,000, less the four corners they share, s cubed over 3 each
near(meshVolume(allTop.triangles), 1e9 - 4 * 5000 * 1000 + (4 * 100 ** 3) / 3, 1000);

// a chamfered solid's edges: 12 less the one, 2 long ones and 2 short ones for its new face
{
  const healedCut = healed(cut.triangles);
  near(meshVolume(healedCut), meshVolume(cut.triangles), 1);
  // the booleans' spare corners are gone: a box with one corner cut has 8 + 2 points, 16 triangles
  assert.equal(healedCut.length / 9, 16);
  const after = solidEdges(healedCut);
  assert.equal(after.length, 15);
  assert.ok(after.every((e) => e.convex));
  // chamfer one of its new edges again, and the volume goes down
  const steep = after.findIndex((e) => Math.abs(e.a[2] - 1000) < 1e-6 && Math.abs(e.b[2] - 1000) < 1e-6 && Math.abs(e.a[0] - 400) < 1e-6 && Math.abs(e.b[0] - 400) < 1e-6);
  assert.ok(steep >= 0);
  const again = subtractMeshes(healedCut, edgeCuts(healedCut, after, [steep], "chamfer", 20))!;
  assert.ok(meshVolume(again.triangles) < meshVolume(healedCut));
  assert.ok(meshVolume(again.triangles) > meshVolume(healedCut) - 1000 * 20 * 20);
}

// an L: its one inside corner isn't convex
const ell = subtractMeshes(cube, [box(0, 0, -100, 600, 600, 1200)])!;
const ellEdges = solidEdges(ell.triangles);
assert.equal(ellEdges.filter((e) => !e.convex).length, 1);
assert.ok(edgeProblem(ellEdges.find((e) => !e.convex)!));
assert.equal(edgeProblem(edges[0]), null);
// a cut along the top of an arm stops at the wall it runs into: it takes 100 x 100 / 2 along the arm's 500
{
  const hl = healed(ell.triangles);
  const list = solidEdges(hl);
  // the short top edge from the inside corner at (0, 0) along -x to (-500, 0)
  const armEdge = list.findIndex((e) => e.a[2] === 1000 && e.b[2] === 1000 && e.a[1] === 0 && e.b[1] === 0);
  assert.ok(armEdge >= 0);
  assert.ok(list[armEdge].convex);
  const armCut = subtractMeshes(hl, edgeCuts(hl, list, [armEdge], "chamfer", 100))!;
  near(meshVolume(armCut.triangles), meshVolume(hl) - 5000 * 500, 1000);
}

// a prism's rim chains together from one piece of it
{
  const n = 24;
  const tris: number[] = [];
  const at = (k: number, z: number): number[] => [500 * Math.cos((2 * Math.PI * k) / n), 500 * Math.sin((2 * Math.PI * k) / n), z];
  for (let k = 0; k < n; k++) {
    tris.push(...at(k, 0), ...at(k + 1, 0), ...at(k + 1, 300), ...at(k, 0), ...at(k + 1, 300), ...at(k, 300));
    tris.push(0, 0, 0, ...at(k + 1, 0), ...at(k, 0));
    tris.push(0, 0, 300, ...at(k, 300), ...at(k + 1, 300));
  }
  const rim = solidEdges(tris);
  assert.equal(rim.length, 2 * n);
  const start = rim.findIndex((e) => e.a[2] === 300 && e.b[2] === 300);
  assert.equal(tangentChain(rim, start).length, n);
  // the rim chamfered round, mitred, as one cut however many pieces it's in: a section of 50 x 50 / 2, a third of 50 in from the sides
  const apothem = 500 * Math.cos(Math.PI / n);
  const perimeter = 2 * n * 500 * Math.sin(Math.PI / n);
  const chamfered = subtractMeshes(tris, edgeCuts(tris, rim, tangentChain(rim, start), "chamfer", 50))!;
  near(meshVolume(chamfered.triangles), meshVolume(tris) - (1250 * perimeter * (apothem - 50 / 3)) / apothem, 100);
  // a hole's rim: mitred, with nothing bitten past its pieces' ends
  const plate = box(-1000, -1000, 0, 2000, 2000, 300);
  const holed = healed(subtractMeshes(plate, [tris])!.triangles);
  const holeEdges = solidEdges(holed);
  const hole = holeEdges.findIndex((e) => Math.abs(e.a[2] - 300) < 1e-6 && Math.hypot(e.a[0], e.a[1]) < 501 && Math.abs(e.b[2] - 300) < 1e-6);
  assert.ok(hole >= 0);
  assert.ok(holeEdges[hole].convex);
  const holeChain = tangentChain(holeEdges, hole);
  assert.equal(holeChain.length, n);
  const countersunk = subtractMeshes(holed, edgeCuts(holed, holeEdges, holeChain, "chamfer", 50))!;
  near(meshVolume(countersunk.triangles), meshVolume(holed) - (1250 * perimeter * (apothem + 50 / 3)) / apothem, 100);
  // the side's facets all, from one, and not the top
  const side = tangentFaces(tris, { point: [apothem * Math.cos(Math.PI / n), apothem * Math.sin(Math.PI / n), 150], normal: [Math.cos(Math.PI / n), Math.sin(Math.PI / n), 0] });
  assert.equal(side.length, n);
  assert.equal(tangentFaces(tris, { point: [0, 0, 300], normal: [0, 0, 1] }).length, 1);
}
// a box's edges don't chain: they turn 90 degrees
assert.equal(tangentChain(edges, i).length, 1);

// the top's outline is its four sides, as many as its split triangles leave
assert.equal(faceOutline(cube, [pick]).length, 4 * 6);

// shell, inside, open at the top: the walls and floor at 100
{
  const s = shellCopies(cube, 100, true, [pick]);
  assert.ok(typeof s !== "string");
  const shell = subtractMeshes(s.outer, [s.inner])!;
  near(meshVolume(shell.triangles), 1e9 - 800 * 800 * 900, 5000);
}
// shell, inside, closed: a void, whose volume counts against the solid
{
  const s = shellCopies(cube, 100, true, []);
  assert.ok(typeof s !== "string");
  near(meshVolume(s.inner), 800 * 800 * 800, 5000);
}
// a shell of a chamfered solid, its split sides healed, stays whole
{
  const s = shellCopies(healed(cut.triangles), 50, true, []);
  assert.ok(typeof s !== "string");
  assert.ok(meshVolume(s.inner) < meshVolume(cut.triangles));
  // a cube of 900, less its chamfer of a little under 5,000 x 900
  near(meshVolume(s.inner), 900 ** 3 - 2_250_000, 20000);
}
// shell, outside, open at the top: walls and floor around the solid
{
  const s = shellCopies(cube, 100, false, [pick]);
  assert.ok(typeof s !== "string");
  const shell = subtractMeshes(s.outer, [s.inner])!;
  near(meshVolume(shell.triangles), 1200 * 1200 * 1100 - 1e9, 5000);
}
// too thick, and all faces open
assert.equal(typeof shellCopies(cube, 600, true, []), "string");
assert.equal(typeof shellCopies(cube, 100, true, [{ point: [0, 0, 0], normal: [0, 0, -1] }, pick, { point: [500, 0, 500], normal: [1, 0, 0] }, { point: [-500, 0, 500], normal: [-1, 0, 0] }, { point: [0, 500, 500], normal: [0, 1, 0] }, { point: [0, -500, 500], normal: [0, -1, 0] }]), "string");

// taper: the +x side by 10 degrees about the bottom: its top comes in by tan(10) x 1000, a wedge off the volume
{
  const side: FacePick = { point: [500, 0, 500], normal: [1, 0, 0] };
  const bottom: FacePick = { point: [0, 0, 0], normal: [0, 0, -1] };
  const t = taperedFace(cube, side, bottom, 10);
  assert.ok(typeof t !== "string");
  near(meshVolume(t), 1e9 - 0.5 * 1000 * Math.tan((10 * Math.PI) / 180) * 1000 * 1000, 2000);
  // the bottom's edge stays
  let bottomMax = -Infinity;
  let topMax = -Infinity;
  for (let k = 0; k + 2 < t.length; k += 3) {
    if (Math.abs(t[k + 2]) < 1e-6) bottomMax = Math.max(bottomMax, t[k]);
    if (Math.abs(t[k + 2] - 1000) < 1e-6) topMax = Math.max(topMax, t[k]);
  }
  near(bottomMax, 500, 1e-4);
  near(topMax, 500 - 1000 * Math.tan((10 * Math.PI) / 180), 1e-4);
  // outward by a negative angle
  const out = taperedFace(cube, side, bottom, -10);
  assert.ok(typeof out !== "string");
  near(meshVolume(out), 1e9 + 0.5 * 1000 * Math.tan((10 * Math.PI) / 180) * 1000 * 1000, 2000);
  // no line to turn about
  assert.equal(typeof taperedFace(cube, side, { point: [-500, 0, 0], normal: [1, 0, 0] }, 10), "string");
  // too steep
  assert.equal(typeof taperedFace(cube, side, bottom, 60), "string");
  // not a face of it
  assert.equal(typeof taperedFace(cube, { point: [900, 0, 500], normal: [1, 0, 0] }, bottom, 10), "string");
}

// ---- Push/Pull and Offset Edge ----
{
  const closed = (t: ArrayLike<number>): boolean => isClosedMesh(t);
  const block = healed(box(0, 0, 0, 1000, 1000, 1000));
  const top = solidFace(block, { point: [300, 300, 1000], normal: [0, 0, 1] });
  assert.ok(typeof top !== "string");
  if (typeof top !== "string") {
    assert.ok(top.flat);
    assert.equal(top.rings.length, 1);
    assert.equal(top.rings[0].length, 4);
    // a slab on the whole top: out, the block grows; in, it shrinks
    const out = faceSlab(top, 200);
    near(meshVolume(out), 2e8, 1);
    assert.ok(closed(out));
    const grown = unionMeshes([block, out])!;
    near(meshVolume(grown.triangles), 1.2e9, 10);
    assert.ok(closed(healed(grown.triangles)));
    const inward = faceSlab(top, -200);
    near(meshVolume(inward), 2e8, 1);
    const cut = subtractMeshes(block, [inward])!;
    near(meshVolume(cut.triangles), 8e8, 10);
    assert.ok(closed(healed(cut.triangles)));
    // Move Face: the sides run on
    const up = movedFace(top, 500);
    assert.ok(typeof up !== "string");
    if (typeof up !== "string") near(meshVolume(up), 1.5e9, 10);
    const down = movedFace(top, -400);
    if (typeof down !== "string") near(meshVolume(down), 6e8, 10);
    assert.equal(typeof movedFace(top, -1000), "string");
    assert.equal(typeof movedFace(top, -1100), "string");
  }

  // a frustum: Move Face follows the slant, Extrude Face goes straight up
  const slope = (x: number, y: number, z: number): number[] => [x, y, z];
  const frustum = healed([
    ...[slope(0, 0, 0), slope(0, 1000, 0), slope(1000, 1000, 0), slope(0, 0, 0), slope(1000, 1000, 0), slope(1000, 0, 0)].flat(),
    ...[slope(100, 100, 500), slope(900, 100, 500), slope(900, 900, 500), slope(100, 100, 500), slope(900, 900, 500), slope(100, 900, 500)].flat(),
    ...[slope(0, 0, 0), slope(1000, 0, 0), slope(900, 100, 500), slope(0, 0, 0), slope(900, 100, 500), slope(100, 100, 500)].flat(),
    ...[slope(1000, 0, 0), slope(1000, 1000, 0), slope(900, 900, 500), slope(1000, 0, 0), slope(900, 900, 500), slope(900, 100, 500)].flat(),
    ...[slope(1000, 1000, 0), slope(0, 1000, 0), slope(100, 900, 500), slope(1000, 1000, 0), slope(100, 900, 500), slope(900, 900, 500)].flat(),
    ...[slope(0, 1000, 0), slope(0, 0, 0), slope(100, 100, 500), slope(0, 1000, 0), slope(100, 100, 500), slope(100, 900, 500)].flat(),
  ]);
  const small = solidFace(frustum, { point: [500, 500, 500], normal: [0, 0, 1] });
  assert.ok(typeof small !== "string");
  if (typeof small !== "string") {
    const higher = movedFace(small, 100);
    assert.ok(typeof higher !== "string");
    if (typeof higher !== "string") {
      const zs = [];
      const xs = [];
      for (let i = 0; i < higher.length; i += 3) if (higher[i + 2] > 550) (zs.push(higher[i + 2]), xs.push(higher[i]));
      near(Math.max(...zs), 600, 1e-6);
      // the slant runs on: 100 in over 500 up, so 120 in at 600
      near(Math.min(...xs), 120, 1e-6);
    }
    const lines = faceSlabLines(small, 100);
    near(Math.max(...lines.filter((_, i) => i % 3 === 2)), 600, 1e-6);
    near(Math.min(...lines.filter((_, i) => i % 3 === 0)), 100, 1e-6);
  }

  // a boss on a face goes with it, a through hole stretches
  const boss = healed(unionMeshes([block, box(400, 400, 1000, 200, 200, 100)])!.triangles);
  const withBoss = solidFace(boss, { point: [100, 100, 1000], normal: [0, 0, 1] });
  assert.ok(typeof withBoss !== "string");
  if (typeof withBoss !== "string") {
    assert.equal(withBoss.rings.length, 2);
    assert.ok(withBoss.carried.size >= 8);
    const raised = movedFace(withBoss, 300);
    assert.ok(typeof raised !== "string");
    if (typeof raised !== "string") {
      near(meshVolume(raised), 1.3e9 + 4e6, 100);
      let high = 0;
      for (let i = 2; i < raised.length; i += 3) high = Math.max(high, raised[i]);
      near(high, 1400, 1e-6);
    }
  }
  const holed = healed(subtractMeshes(block, [box(400, 400, -100, 200, 200, 1200)])!.triangles);
  const ringed = solidFace(holed, { point: [100, 100, 1000], normal: [0, 0, 1] });
  assert.ok(typeof ringed !== "string");
  if (typeof ringed !== "string") {
    assert.equal(ringed.rings.length, 2);
    assert.equal(ringed.carried.size, 0);
    const raised = movedFace(ringed, 100);
    if (typeof raised !== "string") near(meshVolume(raised), 0.96e9 * 1.1, 100);
    else assert.fail(raised);
    // a slab with a hole in it
    near(meshVolume(faceSlab(ringed, 100)), 0.96e6 * 100, 100);
  }

  // a sub-face: a closed curve on the top, cut in and raised, with a hole in it
  if (typeof top !== "string") {
    const curve: Vec3[] = [[200, 200, 1000], [800, 200, 1000], [800, 800, 1000], [200, 800, 1000]];
    const up = ringSlab(curve, [0, 0, 1], 100);
    assert.ok(typeof up !== "string");
    if (typeof up !== "string") {
      near(meshVolume(up), 36e6, 1);
      near(meshVolume(unionMeshes([block, up])!.triangles), 1e9 + 36e6, 100);
    }
    const down = ringSlab([...curve].reverse(), [0, 0, 1], -300);
    assert.ok(typeof down !== "string");
    if (typeof down !== "string") near(meshVolume(subtractMeshes(block, [down])!.triangles), 1e9 - 108e6, 100);
    // past the far side, the cut stops at the solid
    const through = ringSlab(curve, [0, 0, 1], -5000);
    if (typeof through !== "string") near(meshVolume(subtractMeshes(block, [through])!.triangles), 1e9 - 360e6, 100);
    const inner: Vec3[] = [[400, 400, 1000], [600, 400, 1000], [600, 600, 1000], [400, 600, 1000]];
    const far: Vec3[] = [[10, 10, 1000], [100, 10, 1000], [100, 100, 1000], [10, 100, 1000]];
    const nested = nestedRings([curve, inner, far], [0, 0, 1]);
    assert.equal(nested.length, 2);
    assert.equal(nested[0].holes.length, 1);
    assert.equal(nested[1].holes.length, 0);
    // an open curve splits the face: which part goes by the click
    const part = splitFaceRing(top, [[300, 0, 1000], [300, 1000, 1000]], [100, 500, 1000]);
    assert.ok(typeof part !== "string");
    if (typeof part !== "string") {
      const slab = ringSlab(part, [0, 0, 1], 100);
      if (typeof slab !== "string") near(meshVolume(slab), 300 * 1000 * 100, 1);
      else assert.fail(slab);
    }
    const other = splitFaceRing(top, [[300, 0, 1000], [300, 1000, 1000]], [900, 500, 1000]);
    if (typeof other !== "string") {
      const slab = ringSlab(other, [0, 0, 1], 100);
      if (typeof slab !== "string") near(meshVolume(slab), 700 * 1000 * 100, 1);
      else assert.fail(slab);
    } else assert.fail(other);
    assert.equal(typeof splitFaceRing(top, [[300, 200, 1000], [300, 1000, 1000]], [100, 500, 1000]), "string");

    // Offset Edge: a side onto the face runs to its edges; the loop stays closed
    const { ring, side } = rimSideAt(top, [999, 500, 1000]);
    const count = top.rings[ring].length;
    const line = offsetRim(top, ring, new Set([side]), 100);
    assert.ok(typeof line !== "string");
    if (typeof line !== "string") {
      assert.equal(line.closed, false);
      assert.equal(line.points.length, 2);
      near(line.points[0][0], 900, 1e-6);
      near(line.points[1][0], 900, 1e-6);
      near(Math.abs(line.points[0][1] - line.points[1][1]), 1000, 1e-6);
    }
    // off the face it's not cut to the edge
    const off = offsetRim(top, ring, new Set([side]), -100);
    if (typeof off !== "string") near(off.points[0][0], 1100, 1e-6);
    else assert.fail(off);
    const loop = offsetRim(top, ring, new Set(Array(count).keys()), 100);
    assert.ok(typeof loop !== "string");
    if (typeof loop !== "string") {
      assert.ok(loop.closed);
      assert.deepEqual(loop.points.map((p) => Math.round(p[0])).sort((a, b) => a - b), [100, 100, 900, 900]);
    }
    assert.equal(typeof offsetRim(top, ring, new Set(Array(count).keys()), 600), "string");
    const opposite = new Set([side, (side + 2) % count]);
    assert.equal(typeof offsetRim(top, ring, opposite, 100), "string");
    const corner = offsetRim(top, ring, new Set([side, (side + 1) % count]), 100);
    if (typeof corner !== "string") {
      assert.equal(corner.points.length, 3);
      assert.equal(corner.closed, false);
    } else assert.fail(corner);
    assert.equal(typeof offsetRim(top, ring, new Set([side]), 1500), "string");
  }

  // a cylinder's side is one curved face, and shells out as a slab
  const n = 48;
  const r = 500;
  const round: number[] = [];
  const at = (i: number): [number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)];
  for (let i = 0; i < n; i++) {
    const [a, b] = [at(i), at(i + 1)];
    round.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], 1000, a[0], a[1], 0, b[0], b[1], 1000, a[0], a[1], 1000);
    round.push(0, 0, 0, b[0], b[1], 0, a[0], a[1], 0, 0, 0, 1000, a[0], a[1], 1000, b[0], b[1], 1000);
  }
  const cyl = healed(round);
  const mid = at(0.5);
  const side = solidFace(cyl, { point: [mid[0], mid[1], 500], normal: [Math.cos(Math.PI / n), Math.sin(Math.PI / n), 0] });
  assert.ok(typeof side !== "string");
  if (typeof side !== "string") {
    assert.equal(side.flat, false);
    assert.equal(side.triangles.size, 2 * n);
    assert.equal(typeof movedFace(side, 50), "string");
    const shell = faceSlab(side, 50);
    assert.ok(closed(shell) || meshVolume(shell) > 0);
    const big = Math.PI * (550 * 550 - 500 * 500) * 1000;
    near(meshVolume(shell), big, big * 0.02);
  }
}

console.log("all checks passed");
