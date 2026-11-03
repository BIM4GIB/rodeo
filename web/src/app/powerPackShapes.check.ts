// npx tsx src/app/powerPackShapes.check.ts
import assert from "node:assert/strict";
import { intersectMeshes, outward, unionMeshes } from "../core/csg.ts";
import { loftFaces, type LoftCurve, type Point3 } from "./loftShapes.ts";
import {
  drapeFaces,
  extendedCurve,
  filletSurface,
  isFlatRing,
  joinedSides,
  openSurface,
  planarCaps,
  railedRevolve,
  rebuiltCurve,
  rebuiltSurface,
  stitchAndTrim,
  surfaceExtension,
  surfaceFromCurves,
  unfolded,
  type FilletFit,
  type FlatPiece,
  type Point2,
  type RailedRevolve,
  type RebuiltSurface,
  ringSheet,
  thickenedSurface,
} from "./powerPackShapes.ts";
import { healed, isClosedMesh, meshVolume } from "./solidOps.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const quad = (p: Point3, q: Point3, r: Point3, s: Point3): number[] => [...p, ...q, ...r, ...p, ...r, ...s];
const box = (x: number, y: number, z: number, dx: number, dy: number, dz: number, skip: readonly string[] = []): number[] => {
  const c = (i: number, j: number, k: number): Point3 => [x + i * dx, y + j * dy, z + k * dz];
  const faces: [string, number[]][] = [
    ["bottom", quad(c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0))],
    ["top", quad(c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1))],
    ["front", quad(c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1))],
    ["right", quad(c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1))],
    ["back", quad(c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1))],
    ["left", quad(c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1))],
  ];
  return faces.filter(([n]) => !skip.includes(n)).flatMap(([, f]) => f);
};
const areaOfTris = (t: readonly number[]): number => {
  let n = 0;
  for (let i = 0; i + 8 < t.length; i += 9) {
    const [ux, uy, uz, vx, vy, vz] = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2], t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
    n += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return n;
};
const flatArea = (l: readonly Point2[]): number => l.reduce((n, p, i) => n + p[0] * l[(i + 1) % l.length][1] - l[(i + 1) % l.length][0] * p[1], 0) / 2;
const circle = (r: number, z: number, n = 24): Point3[] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]);

// Planar caps: an open tube's two ends
{
  const tube = loftFaces([circle(100, 0), circle(100, 300)], true, false).flat();
  const { caps, notFlat } = planarCaps(tube);
  assert.equal(caps.length, 2);
  assert.equal(notFlat, 0);
  const area = (24 / 2) * 100 * 100 * Math.sin((2 * Math.PI) / 24);
  for (const c of caps) near(areaOfTris(c), area, 1e-6);
  // closed by them, it has the tube's volume and faces out
  const whole = outward([...tube, ...caps.flat()], 1e-4);
  near(meshVolume(whole), area * 300, 1e-3);
  const normalZ = (c: readonly number[]): number => (c[3] - c[0]) * (c[7] - c[1]) - (c[4] - c[1]) * (c[6] - c[0]);
  const topCap = caps.find((c) => c[2] > 100)!;
  const bottomCap = caps.find((c) => c[2] < 100)!;
  assert.ok(normalZ(topCap) > 0, "top cap faces up");
  assert.ok(normalZ(bottomCap) < 0, "bottom cap faces down");
  // a closed box has none, a box with no lid one, of a square, in a plane
  assert.equal(planarCaps(box(0, 0, 0, 10, 10, 10)).caps.length, 0);
  const lidless = planarCaps(box(0, 0, 0, 10, 20, 30, ["top"]));
  assert.equal(lidless.caps.length, 1);
  near(areaOfTris(lidless.caps[0]), 200);
  assert.ok(lidless.caps[0].filter((_, i) => i % 3 === 2).every((z) => Math.abs(z - 30) < 1e-6));
  // an end that isn't in a plane isn't capped
  const warped: Point3[] = circle(100, 300).map(([x, y], i) => [x, y, 300 + (i % 2) * 40]);
  const skew = planarCaps(loftFaces([circle(100, 0), warped], true, false).flat());
  assert.equal(skew.caps.length, 1);
  assert.equal(skew.notFlat, 1);
}

// isFlatRing
assert.ok(isFlatRing(circle(10, 5)));
assert.ok(!isFlatRing([[0, 0, 0], [10, 0, 0], [10, 10, 5], [0, 10, 0]]));

// Add Solids' union of closed meshes
{
  const u = unionMeshes([box(0, 0, 0, 10, 10, 10), box(5, 0, 0, 10, 10, 10)])!;
  near(meshVolume(u.triangles), 1500, 1e-6);
  const apart = unionMeshes([box(0, 0, 0, 10, 10, 10), box(50, 0, 0, 10, 10, 10)])!;
  near(meshVolume(apart.triangles), 2000, 1e-6);
  near(meshVolume(intersectMeshes([box(0, 0, 0, 10, 10, 10), box(5, 0, 0, 10, 10, 10)])!.triangles), 500, 1e-6);
}

// Drape: over a box, hanging to the plane
{
  const b = box(0, 0, 0, 100, 100, 50);
  const faces = drapeFaces(b, { u: 13, v: 13, planeZ: -20 });
  assert.equal(faces.length, 12 * 12 * 2);
  const flat = faces.flat();
  const zs = flat.filter((_, i) => i % 3 === 2);
  near(Math.max(...zs), 50);
  near(Math.min(...zs), -20);
  // it reaches one step past the box all round (100 / 10 = 10)
  const xs = flat.filter((_, i) => i % 3 === 0);
  near(Math.min(...xs), -10);
  near(Math.max(...xs), 110);
  // every point over the box's top is on it, and the outer ring on the plane
  const zAt = (x: number, y: number): number => {
    for (let i = 0; i + 2 < flat.length; i += 3) if (Math.abs(flat[i] - x) < 1e-6 && Math.abs(flat[i + 1] - y) < 1e-6) return flat[i + 2];
    throw new Error("no point there");
  };
  near(zAt(50, 50), 50);
  near(zAt(0, 0), 50);
  near(zAt(-10, -10), -20);
  near(zAt(110, 50), -20);
  // faces up
  near(Math.sign((flat[3] - flat[0]) * (flat[7] - flat[1]) - (flat[4] - flat[1]) * (flat[6] - flat[0])), 1);
  // over a sloped face: follows it
  const ramp = [0, 0, 0, 100, 0, 100, 100, 100, 100, 0, 0, 0, 100, 100, 100, 0, 100, 0];
  const over = drapeFaces(ramp, { u: 13, v: 13, planeZ: 0 }).flat();
  for (let i = 0; i + 2 < over.length; i += 3) if (over[i] >= 0 && over[i] <= 100 && over[i + 1] >= 0 && over[i + 1] <= 100) near(over[i + 2], over[i], 1e-6);
  // a thin spike isn't missed
  const spike = [50, 50, 0, 50.1, 50, 0, 50, 50, 300];
  assert.ok(Math.max(...drapeFaces([...b, ...spike], { u: 7, v: 7, planeZ: 0 }).flat().filter((_, i) => i % 3 === 2)) >= 300);
}

// Revolve with Rail: a tent over a square rail
{
  const axis: LoftCurve = { points: [[0, 0, 0], [0, 0, 100]], closed: false };
  const profile: LoftCurve = { points: [[0, 0, 100], [50, 0, 50], [100, 0, 0]], closed: false };
  const rail: LoftCurve = { points: [[100, -100, 0], [100, 100, 0], [-100, 100, 0], [-100, -100, 0]], closed: true };
  const r = railedRevolve(axis, profile, rail);
  assert.ok(typeof r !== "string", String(r));
  const { rings } = r as Exclude<typeof r, string>;
  assert.equal(rings.length, 5);
  assert.equal(rings[0], rings[4]);
  // each ring from the top of the axis to the rail's point
  rings.slice(0, 4).forEach((ring, j) => {
    near(ring[0][0], 0);
    near(ring[0][1], 0);
    near(ring[0][2], 100);
    for (let k = 0; k < 3; k++) near(ring[2][k], rail.points[j][k]);
    near(ring[1][2], 50);
    near(ring[1][0], rail.points[j][0] / 2);
  });
  // a four-sided pyramid's sides
  const area = areaOfTris(loftFaces(rings, false, false).flat());
  near(area, 4 * (0.5 * 200 * Math.hypot(100, 100)), 1e-6);
  // a circle rail makes a cone, an open rail stops where it ends
  const round = railedRevolve(axis, profile, { points: circle(100, 0), closed: true }) as RailedRevolve;
  assert.equal(round.rings.length, 25);
  const part = railedRevolve(axis, profile, { points: circle(100, 0, 24).slice(0, 7), closed: false }) as RailedRevolve;
  assert.equal(part.rings.length, 7);
  // a smaller rail shrinks the profile; a profile with a point on the axis stays there
  const half = railedRevolve(axis, profile, { points: circle(50, 0), closed: true }) as RailedRevolve;
  near(half.rings[0][2][0], 50);
  near(half.rings[0][1][0], 25);
  // what's refused
  assert.match(String(railedRevolve({ points: [[0, 0, 0], [1, 5, 50], [0, 0, 100]], closed: false }, profile, rail)), /straight/);
  assert.match(String(railedRevolve(axis, { points: [[0, 0, 100], [50, 50, 50], [100, 0, 0]], closed: false }, rail)), /one plane with the axis/);
  assert.match(String(railedRevolve(axis, { points: [[-50, 0, 100], [100, 0, 0]], closed: false }, rail)), /cross/);
  assert.match(String(railedRevolve(axis, { points: [[0, 0, 0], [0, 0, 100]], closed: false }, rail)), /reach/);
  assert.match(String(railedRevolve(axis, profile, { points: [[100, 0, 0], [0, 0, 0], [0, 100, 0]], closed: false })), /touch the axis/);
  assert.match(String(railedRevolve(axis, profile, { points: [[100, 0, 0], [100, 50, 80], [100, 100, 0]], closed: false })), /square to the plane/);
  assert.match(String(railedRevolve(axis, profile, { points: [[100, 0, 0], [200, 0, 0]], closed: false })), /go round/);
  assert.match(String(railedRevolve(axis, profile, { points: [[100, 0, 0], [0, 100, 0], [-100, 0, 40], [0, -100, 0]], closed: true })), /one plane/);
}

// Surface from Curves
{
  // one closed flat curve
  const one = surfaceFromCurves([{ points: [[0, 0, 5], [100, 0, 5], [100, 100, 5], [0, 100, 5]], closed: true }]) as number[][];
  near(areaOfTris(one.flat()), 10000);
  // a curve closing on itself by its ends
  const own = surfaceFromCurves([{ points: [[0, 0, 5], [100, 0, 5], [100, 100, 5], [0, 0, 5]], closed: false }]) as number[][];
  near(areaOfTris(own.flat()), 5000);
  // open curves round a flat region, in any order and any way along
  const a: LoftCurve = { points: [[0, 0, 0], [100, 0, 0]], closed: false };
  const b: LoftCurve = { points: [[100, 100, 0], [100, 0, 0]], closed: false };
  const c: LoftCurve = { points: [[100, 100, 0], [0, 100, 0]], closed: false };
  const d: LoftCurve = { points: [[0, 0, 0], [0, 100, 0]], closed: false };
  assert.equal((joinedSides([a, c, b, d]) as Point3[][]).length, 4);
  near(areaOfTris((surfaceFromCurves([a, c, b, d]) as number[][]).flat()), 10000);
  // four curves not flat: a patch through all four sides, with a saddle's middle
  const bent = (x0: number, y0: number, x1: number, y1: number, z: number): LoftCurve => ({
    points: Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z * Math.sin(Math.PI * t)] as Point3;
    }),
    closed: false,
  });
  const sides = [bent(0, 0, 100, 0, 30), bent(100, 0, 100, 100, -30), bent(100, 100, 0, 100, 30), bent(0, 100, 0, 0, -30)];
  const patch = (surfaceFromCurves(sides) as number[][]).flat();
  const points: Point3[] = [];
  for (let i = 0; i + 2 < patch.length; i += 3) points.push([patch[i], patch[i + 1], patch[i + 2]]);
  const closest = (p: Point3): number => Math.min(...points.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])));
  for (const s of sides) for (const p of s.points) near(closest(p), 0, 1e-6);
  near(closest([50, 50, 0]), 0, 1e-6);
  // not flat with three sides: stretched across, the rim kept
  const tri = [bent(0, 0, 100, 0, 30), bent(100, 0, 50, 100, -10), bent(50, 100, 0, 0, 20)];
  const film = (surfaceFromCurves(tri) as number[][]).flat();
  const filmPoints: Point3[] = [];
  for (let i = 0; i + 2 < film.length; i += 3) filmPoints.push([film[i], film[i + 1], film[i + 2]]);
  for (const s of tri) for (const p of s.points) assert.ok(Math.min(...filmPoints.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))) < 1e-6);
  // one closed curve that isn't flat
  assert.ok(Array.isArray(surfaceFromCurves([{ points: bent(0, 0, 100, 100, 40).points.concat([[0, 100, 0]]), closed: true }])));
  // what's refused
  assert.match(String(surfaceFromCurves([a])), /enclose/);
  assert.match(String(surfaceFromCurves([a, c])), /enclose/);
  assert.match(String(surfaceFromCurves([{ points: circle(10, 0), closed: true }, { points: circle(20, 0), closed: true }])), /not more than one/);
  assert.match(String(surfaceFromCurves([])), /Select/);
}

// Unfold
{
  const pieceArea = (p: FlatPiece): number => Math.abs(flatArea(p.outline)) - p.holes.reduce((n, h) => n + Math.abs(flatArea(h)), 0);
  // an open tube: a rectangle, as long as its round and as tall
  const tube = loftFaces([circle(100, 0), circle(100, 300)], true, false).flat();
  const round = 24 * 2 * 100 * Math.sin(Math.PI / 24);
  const t = unfolded(tube) as FlatPiece[];
  assert.equal(t.length, 1);
  assert.equal(t[0].outline.length, 4);
  near(t[0].width, round, 1e-6);
  near(t[0].height, 300, 1e-6);
  assert.ok(flatArea(t[0].outline) > 0, "anticlockwise");
  // with caps it's a rectangle and two polygons
  const closed = [...tube, ...planarCaps(tube).caps.flat()];
  const c = unfolded(closed) as FlatPiece[];
  assert.equal(c.length, 3);
  near(c.map(pieceArea).reduce((a, b) => a + b, 0), areaOfTris(closed), 1e-5);
  // a box: six squares; a box with no lid or base: one strip, its sides in a row
  assert.equal((unfolded(box(0, 0, 0, 10, 10, 10)) as FlatPiece[]).length, 6);
  const strip = unfolded(box(0, 0, 0, 10, 20, 30, ["top", "bottom"])) as FlatPiece[];
  assert.equal(strip.length, 1);
  assert.equal(strip[0].outline.length, 4);
  near(strip[0].width, 60);
  near(strip[0].height, 30);
  // a cone's sides: a sector, its area kept
  const n = 48;
  const cone = loftFaces([circle(100, 0, n), Array.from({ length: n }, () => [0, 0, 100] as Point3)], true, false).flat();
  const k = unfolded(cone) as FlatPiece[];
  assert.equal(k.length, 1);
  near(pieceArea(k[0]), areaOfTris(cone), 1e-5);
  assert.ok(k[0].outline.length > 3);
  // a frustum: a ring sector, area kept
  const frustum = loftFaces([circle(100, 0), circle(50, 100)], true, false).flat();
  const f = unfolded(frustum) as FlatPiece[];
  assert.equal(f.length, 1);
  near(pieceArea(f[0]), areaOfTris(frustum), 1e-5);
  // a flat sheet with a hole
  const ring = [...quad([0, 0, 0], [100, 0, 0], [100, 30, 0], [0, 30, 0]), ...quad([0, 70, 0], [100, 70, 0], [100, 100, 0], [0, 100, 0]), ...quad([0, 30, 0], [30, 30, 0], [30, 70, 0], [0, 70, 0]), ...quad([70, 30, 0], [100, 30, 0], [100, 70, 0], [70, 70, 0])];
  const holed = unfolded(ring) as FlatPiece[];
  assert.equal(holed.length, 1);
  assert.equal(holed[0].holes.length, 1);
  near(pieceArea(holed[0]), 10000 - 1600, 1e-6);
  // a sheet bent along a line: flat again, one rectangle
  const bent = [...quad([0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]), ...quad([0, 50, 0], [100, 50, 0], [100, 80, 40], [0, 80, 40])];
  const sheet = unfolded(bent) as FlatPiece[];
  assert.equal(sheet.length, 1);
  near(sheet[0].width, 100);
  near(sheet[0].height, 100);
  // a sphere's refused
  const rings: Point3[][] = Array.from({ length: 11 }, (_, i) => {
    const a = (Math.PI * (i + 1)) / 12 - Math.PI / 2;
    return circle(100 * Math.cos(a), 100 * Math.sin(a));
  });
  assert.match(String(unfolded(loftFaces(rings, true, false).flat())), /curved two ways/);
}

// Stitch and Trim
{
  // six big squares past each other's edges close round a box
  const plane = (p: Point3, u: Point3, v: Point3): number[] => quad(p, [p[0] + u[0], p[1] + u[1], p[2] + u[2]], [p[0] + u[0] + v[0], p[1] + u[1] + v[1], p[2] + u[2] + v[2]], [p[0] + v[0], p[1] + v[1], p[2] + v[2]]);
  const sheets = [
    plane([-50, -50, 0], [200, 0, 0], [0, 200, 0]),
    plane([-50, -50, 100], [200, 0, 0], [0, 200, 0]),
    plane([-50, 0, -50], [200, 0, 0], [0, 0, 200]),
    plane([-50, 100, -50], [200, 0, 0], [0, 0, 200]),
    plane([0, -50, -50], [0, 200, 0], [0, 0, 200]),
    plane([100, -50, -50], [0, 200, 0], [0, 0, 200]),
  ];
  const cells = stitchAndTrim(sheets) as number[][];
  assert.equal(cells.length, 1);
  near(meshVolume(cells[0]), 1e6, 1e-3);
  near(areaOfTris(cells[0]), 6e4, 1e-3);
  // a sheet through it makes two
  const two = stitchAndTrim([...sheets, plane([-50, -50, 30], [200, 0, 0], [0, 200, 0])]) as number[][];
  assert.equal(two.length, 2);
  const vols = two.map(meshVolume).sort((p, q) => p - q);
  near(vols[0], 3e5, 1e-3);
  near(vols[1], 7e5, 1e-3);
  // a closed box and a sheet through it: both parts
  const halves = stitchAndTrim([box(0, 0, 0, 100, 100, 100), plane([-50, -50, 40], [200, 0, 0], [0, 200, 0])]) as number[][];
  assert.equal(halves.length, 2);
  near(halves.map(meshVolume).reduce((p, q) => p + q, 0), 1e6, 1e-3);
  // a curved tent's sheets over a base: a pyramid's volume
  const roof = loftFaces([[[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]], [[50, 50, 80], [50, 50, 80], [50, 50, 80], [50, 50, 80]]], true, false).flat();
  const tent = stitchAndTrim([roof, plane([-20, -20, 0], [140, 0, 0], [0, 140, 0])]) as number[][];
  assert.equal(tent.length, 1);
  near(meshVolume(tent[0]), (100 * 100 * 80) / 3, 1e-3);
  // sheets that don't enclose anything
  assert.match(String(stitchAndTrim(sheets.slice(0, 2))), /enclose/);
  assert.match(String(stitchAndTrim(sheets.slice(0, 3))), /enclose/);
}

// Extend
{
  const line: LoftCurve = { points: [[0, 0, 0], [100, 0, 0]], closed: false };
  assert.deepEqual(extendedCurve(line, false, 50, "linear"), [[0, 0, 0], [100, 0, 0], [150, 0, 0]]);
  assert.deepEqual(extendedCurve(line, true, 50, "linear"), [[-50, 0, 0], [0, 0, 0], [100, 0, 0]]);
  assert.match(String(extendedCurve({ points: circle(10, 0), closed: true }, false, 5, "linear")), /closed/);
  // round a circle it stays on the circle, the distance along it
  const arc: LoftCurve = { points: circle(100, 7, 24).slice(0, 7), closed: false };
  const on = extendedCurve(arc, false, (Math.PI * 100) / 2, "smooth") as Point3[];
  assert.equal(on.length, 7 + 8);
  for (const p of on) {
    near(Math.hypot(p[0], p[1]), 100, 1e-6);
    near(p[2], 7, 1e-6);
  }
  // 90 degrees of it, past the 90 at the end of the arc
  near(on[on.length - 1][0], -100, 1e-6);
  near(on[on.length - 1][1], 0, 1e-6);
  // straight on, smooth stays straight
  const st = extendedCurve({ points: [[0, 0, 0], [10, 0, 0], [20, 0, 0]], closed: false }, false, 10, "smooth") as Point3[];
  near(st[st.length - 1][0], 30);
  near(st[st.length - 1][1], 0);

  // a sheet of squares: four edges; one carried on by its linear distance adds its area
  const rows: Point3[][] = [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => [i * 100, j * 100, 0] as Point3));
  const sheet = loftFaces(rows, false, false).flat();
  const s = openSurface(sheet);
  assert.equal(s.edges.length, 4);
  const edge = s.edges.find((e) => e.points.every((p) => s.mesh.points[p][0] === 300))!;
  const out = surfaceExtension(s, edge, 50, "linear");
  assert.equal(out.rings.length, 2);
  near(Math.max(...out.rings[1].map((p) => p[0])), 350);
  near(Math.min(...out.rings[1].map((p) => p[0])), 350);
  near(areaOfTris(loftFaces(out.rings, false, false).flat()), 300 * 50);
  // an open tube's rim is one edge, closed; it runs on straight
  const tube = openSurface(loftFaces([circle(100, 0), circle(100, 100), circle(100, 200)], true, false).flat());
  assert.equal(tube.edges.length, 2);
  assert.ok(tube.edges.every((e) => e.closed));
  const top = tube.edges.find((e) => tube.mesh.points[e.points[0]][2] === 200)!;
  const up = surfaceExtension(tube, top, 50, "smooth");
  assert.ok(up.closed);
  for (const p of up.rings[up.rings.length - 1]) near(p[2], 250, 1e-6);
  // a bent sheet carried on smoothly keeps turning
  const bowl: Point3[][] = [0, 1, 2, 3, 4, 5].map((j) => {
    const a = (j * Math.PI) / 12;
    return [0, 100, 200].map((x) => [x, 100 * Math.sin(a), 100 - 100 * Math.cos(a)] as Point3);
  });
  const b = openSurface(loftFaces(bowl, false, false).flat());
  const rim = b.edges.find((e) => e.points.every((p) => Math.abs(s2(b.mesh.points[p]) - 5 * 15) < 1e-6))!;
  const more = surfaceExtension(b, rim, (Math.PI * 100) / 12, "smooth");
  for (const p of more.rings[more.rings.length - 1]) {
    near(p[1], 100, 1e-6);
    near(p[2], 100, 1e-6);
  }
}
function s2(p: Point3): number {
  return (Math.atan2(p[1], 100 - p[2]) * 180) / Math.PI;
}

// Rebuild
{
  const c = rebuiltCurve({ points: [[0, 0, 0], [100, 0, 0], [100, 100, 0]], closed: false }, 3);
  assert.deepEqual(c.points, [[0, 0, 0], [100, 0, 0], [100, 100, 0]]);
  near(c.deviation, 0);
  const d = rebuiltCurve({ points: [[0, 0, 0], [50, 40, 0], [100, 0, 0]], closed: false }, 2);
  near(d.deviation, 40);
  // a circle of many points, fewer: still round, the deviation what a coarser one loses
  const ring = rebuiltCurve({ points: circle(100, 0, 96), closed: true }, 12);
  assert.equal(ring.points.length, 12);
  for (const p of ring.points) assert.ok(Math.hypot(p[0], p[1]) <= 100 + 1e-6 && Math.hypot(p[0], p[1]) > 99.9);
  assert.ok(ring.deviation > 3 && ring.deviation < 4);
  // a flat sheet to any grid; its area kept
  const rows: Point3[][] = [0, 1, 2, 3].map((j) => [0, 1, 2, 3].map((i) => [i * 100, j * 100, 0] as Point3));
  const g = rebuiltSurface(loftFaces(rows, false, false).flat(), 6, 5) as RebuiltSurface;
  assert.equal(g.rings.length, 5);
  assert.equal(g.rings[0].length, 6);
  near(g.deviation, 0, 1e-6);
  near(areaOfTris(loftFaces(g.rings, false, false).flat()), 90000, 1e-6);
  // a tube, fewer points round it
  const t = rebuiltSurface(loftFaces([circle(100, 0), circle(100, 100), circle(100, 200)], true, false).flat(), 12, 5) as RebuiltSurface;
  assert.ok(t.closedRing);
  assert.equal(t.rings.length, 5);
  for (const r of t.rings) for (const p of r) assert.ok(Math.hypot(p[0], p[1]) <= 100 + 1e-6);
  near(t.rings[0][0][2], t.rings[0][1][2], 1e-6);
  // not four-sided
  assert.match(String(rebuiltSurface(loftFaces([circle(100, 0), circle(100, 100)], true, true).flat(), 12, 5)), /four sides/);
}

// Fillet
{
  // two square sheets at a right angle, meeting along a line: floor and wall
  const floor = quad([0, 0, 0], [300, 0, 0], [300, 300, 0], [0, 300, 0]);
  const wall = quad([0, 0, 0], [0, 0, 300], [0, 300, 300], [0, 300, 0]);
  const find = (flipA: boolean, flipB: boolean): FilletFit | string => filletSurface(floor, wall, { radius: 50, section: "circular", flipA, flipB });
  // of the four ways round only one has the ball inside both sheets' reach, in this quadrant
  const fits = [find(false, false), find(true, false), find(false, true), find(true, true)].filter((f): f is FilletFit => typeof f !== "string");
  assert.ok(fits.length >= 1, "fits");
  const f = fits.find((x) => x.rings.flat().every((p) => p[0] >= -1e-6 && p[2] >= -1e-6))!;
  assert.ok(f, "one in the corner");
  // its points are all 50 from the line x 50, z 50, and it runs the sheets' length
  for (const p of f.rings.flat()) near(Math.hypot(p[0] - 50, p[2] - 50), 50, 1e-6);
  const ys = f.rings.flat().map((p) => p[1]);
  near(Math.max(...ys) - Math.min(...ys), 300, 1e-6);
  const arcLength = (2 * Math.PI * 50) / 4;
  near(areaOfTris(loftFaces(f.rings, false, false).flat()), 12 * 2 * 50 * Math.sin(Math.PI / 4 / 12) * 300, 1e-3);
  void arcLength;
  // the sheets are cut back by the radius
  near(areaOfTris(f.trimmedA), 250 * 300, 1e-6);
  near(areaOfTris(f.trimmedB), 250 * 300, 1e-6);
  for (let i = 0; i + 2 < f.trimmedA.length; i += 3) assert.ok(f.trimmedA[i] >= 50 - 1e-6);
  // too big
  assert.equal(typeof filletSurface(floor, wall, { radius: 5000, section: "circular", flipA: false, flipB: false }), "string");
  // the other sections end at the same feet, and bow less than the corner
  for (const section of ["linear", "tangent", "curvature"] as const) {
    const flip = [[false, false], [true, false], [false, true], [true, true]].map(([p, q]) => filletSurface(floor, wall, { radius: 50, section, flipA: p, flipB: q })).filter((x): x is FilletFit => typeof x !== "string").find((x) => x.rings.flat().every((p) => p[0] >= -1e-6 && p[2] >= -1e-6))!;
    const across = flip.rings[0];
    const ends = [across[0], across[across.length - 1]].sort((p, q) => p[0] - q[0]);
    near(ends[0][0], 0, 1e-6);
    near(ends[0][2], 50, 1e-6);
    near(ends[1][0], 50, 1e-6);
    near(ends[1][2], 0, 1e-6);
  }
  // sheets crossing: the flaps past the corner go
  const floor2 = quad([-100, 0, 0], [300, 0, 0], [300, 300, 0], [-100, 300, 0]);
  const wall2 = quad([0, 0, -100], [0, 0, 300], [0, 300, 300], [0, 300, -100]);
  const c = [[false, false], [true, false], [false, true], [true, true]].map(([p, q]) => filletSurface(floor2, wall2, { radius: 50, section: "circular", flipA: p, flipB: q })).filter((x): x is FilletFit => typeof x !== "string").find((x) => x.rings.flat().every((p) => p[0] >= -1e-6 && p[2] >= -1e-6))!;
  near(areaOfTris(c.trimmedA), 250 * 300, 1e-6);
  near(areaOfTris(c.trimmedB), 250 * 300, 1e-6);
  // a floor and an upright tube: a ring of fillet round it, the floor cut in a ring
  const n = 32;
  const tube = loftFaces([circle(100, 0, n), circle(100, 300, n)], true, false).flat();
  const big = quad([-400, -400, 0], [400, -400, 0], [400, 400, 0], [-400, 400, 0]);
  const rings = [[false, false], [true, false], [false, true], [true, true]].map(([p, q]) => filletSurface(big, tube, { radius: 40, section: "circular", flipA: p, flipB: q })).filter((x): x is FilletFit => typeof x !== "string");
  const outer = rings.find((x) => x.closedChain && x.rings.flat().every((p) => Math.hypot(p[0], p[1]) >= 90 && p[2] >= -1e-6))!;
  assert.ok(outer, "a ring outside the tube, above the floor");
  assert.equal(outer.rings[0], outer.rings[outer.rings.length - 1]);
  const lowest = outer.rings.flat().filter((p) => Math.abs(p[2]) < 1e-6);
  assert.ok(lowest.length > 0);
  for (const p of lowest) near(Math.hypot(p[0], p[1]), 140, 2);
}

// Shell Solid on a surface
{
  const cornersOf = (flat: readonly number[]): Point3[] => {
    const out: Point3[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
    return out;
  };
  const sheet = quad([0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]);
  const outside = thickenedSurface(sheet, 10, false) as number[];
  assert.ok(isClosedMesh(outside));
  near(meshVolume(healed(outside)), 100 * 50 * 10, 1e-6);
  const zs = cornersOf(outside).map((p) => p[2]);
  near(Math.max(...zs), 10, 1e-9);
  near(Math.min(...zs), 0, 1e-9);
  const inside = thickenedSurface(sheet, 10, true) as number[];
  near(meshVolume(healed(inside)), 100 * 50 * 10, 1e-6);
  const down = cornersOf(inside).map((p) => p[2]);
  near(Math.max(...down), 0, 1e-9);
  near(Math.min(...down), -10, 1e-9);
  // a face turned against its neighbours still makes one shell, as most of it looks
  const mixed = [...quad([0, 0, 0], [100, 0, 0], [100, 50, 0], [0, 50, 0]), 100, 50, 0, 0, 50, 0, 50, 100, 0];
  const mixedUp = thickenedSurface(mixed, 5, false) as number[];
  assert.ok(isClosedMesh(mixedUp));
  near(meshVolume(healed(mixedUp)), 5 * (100 * 50 + (100 * 50) / 2), 1e-6);
  assert.ok(Math.max(...cornersOf(mixedUp).map((p) => p[2])) > 4.9);
  // a fold keeps its faces the thickness apart
  const roof = [...quad([0, 0, 0], [100, 0, 100], [100, 50, 100], [0, 50, 0]), ...quad([100, 0, 100], [200, 0, 0], [200, 50, 0], [100, 50, 100])];
  const raised = thickenedSurface(roof, 10, false) as number[];
  assert.ok(isClosedMesh(raised));
  const ridge = cornersOf(raised).filter((p) => Math.abs(p[0] - 100) < 1e-6).map((p) => p[2]);
  near(Math.max(...ridge), 100 + 10 * Math.SQRT2, 1e-6);
  // each side's outer face runs a thickness longer, going over the fold
  near(meshVolume(healed(raised)), 2 * 50 * 10 * (Math.hypot(100, 100) + 5), 1e-6);
  const lowered = cornersOf(thickenedSurface(roof, 10, true) as number[]).filter((p) => Math.abs(p[0] - 100) < 1e-6).map((p) => p[2]);
  near(Math.min(...lowered), 100 - 10 * Math.SQRT2, 1e-6);
  // a curved sheet, an arch looking up and out or in
  const n = 24;
  const arch: number[] = [];
  const at = (i: number, y: number): number[] => [100 * Math.cos((Math.PI * i) / n), y, 100 * Math.sin((Math.PI * i) / n)];
  for (let i = 0; i < n; i++) arch.push(...at(i, 0), ...at(i + 1, 0), ...at(i + 1, 200), ...at(i, 0), ...at(i + 1, 200), ...at(i, 200));
  const grown = [thickenedSurface(arch, 5, false), thickenedSurface(arch, 5, true)] as number[][];
  const halfRing = (Math.PI / 2) * (105 * 105 - 100 * 100) * 200;
  const smaller = (Math.PI / 2) * (100 * 100 - 95 * 95) * 200;
  const volumes = grown.map((g) => meshVolume(healed(g))).sort((a, b) => a - b);
  near(volumes[0], smaller, smaller * 0.02);
  near(volumes[1], halfRing, halfRing * 0.02);
  // thicker than the bend is tight toward its middle
  const toMiddle = grown.findIndex((g) => Math.max(...cornersOf(g).map((p) => Math.hypot(p[0], p[2]))) < 100.5);
  assert.equal(typeof thickenedSurface(arch, 150, toMiddle === 1), "string");
  assert.equal(typeof thickenedSurface(arch, 150, toMiddle !== 1), "object");
  // three faces on a side, and none
  const fins = [...sheet, 0, 0, 0, 100, 0, 0, 50, 0, 40, 0, 0, 0, 100, 0, 0, 50, 0, -40];
  assert.equal(typeof thickenedSurface(fins, 5, false), "string");
  assert.equal(typeof thickenedSurface([], 5, false), "string");
  // a flat ring looks the way asked
  const ring: Point3[] = [[0, 0, 7], [100, 0, 7], [100, 100, 7], [50, 40, 7], [0, 100, 7]];
  const looksUp = (flat: readonly number[]): number => (flat[3] - flat[0]) * (flat[7] - flat[1]) - (flat[4] - flat[1]) * (flat[6] - flat[0]);
  const faceUp = ringSheet(ring, [0, 0, 1]);
  assert.ok(looksUp(faceUp) > 0);
  assert.ok(looksUp(ringSheet(ring, [0, 0, -1])) < 0);
  assert.ok(looksUp(ringSheet([...ring].reverse(), [0, 0, 1])) > 0);
  const slab = thickenedSurface(faceUp, 2, false) as number[];
  near(meshVolume(healed(slab)), 2 * (10000 - (100 * 60) / 2), 1e-6);
  near(Math.max(...cornersOf(slab).map((p) => p[2])), 9, 1e-9);
}

console.log("powerPackShapes ok");
