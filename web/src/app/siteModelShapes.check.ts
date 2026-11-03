// Run with: npx tsx src/app/siteModelShapes.check.ts
import assert from "node:assert/strict";
import {
  alignedHeights,
  bandPieces,
  borderRings,
  clippedSurface,
  editedPoints,
  surfaceElement,
  type SwaleProfile,
  boundaryPoints,
  boxOf,
  cellFace,
  cellHeight,
  columnFaces,
  contourLevels,
  contourLines,
  cutAndFill,
  differenceSurface,
  drapedFaces,
  elevationBand,
  facesByBand,
  flowArrows,
  gappedLine,
  gridCells,
  heightLookup,
  heightRange,
  labelPlace,
  labelStations,
  lineLength,
  niceInterval,
  packPoints,
  padHeight,
  proposedPoints,
  skirtFaces,
  slopeBand,
  slopePercent,
  smoothed,
  surfaceFigures,
  surfaceOf,
  terracedFaces,
  triangulate,
  unpackPoints,
  volumeAbove,
  type Pt3,
  type SiteModifier,
  type Surface,
} from "./siteModelShapes.ts";

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const surface = (points: readonly Pt3[], border?: { x: number; y: number }[]): Surface => {
  const s = surfaceOf(points, border);
  assert.ok(s);
  return s;
};
/** a grid of heights from `height`, 100 apart */
const grid = (n: number, height: (x: number, y: number) => number): Pt3[] => {
  const out: Pt3[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push([i * 100, j * 100, height(i * 100, j * 100)]);
  return out;
};

// four corners make two triangles; too few or in a line make none
{
  assert.equal(triangulate([[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]]).length, 6);
  assert.equal(triangulate([[0, 0, 0], [100, 0, 0]]).length, 0);
  assert.equal(surfaceOf([[0, 0, 0], [100, 0, 0], [200, 0, 0]]), null);
  assert.equal(surfaceOf([[0, 0, 0], [0, 0, 5], [0, 0.2, 7]]), null);
}

// a grid, exactly on circles everywhere: all its area, each corner counter-clockwise
{
  const s = surface(grid(10, () => 0));
  assert.equal(s.points.length, 121);
  assert.equal(s.triangles.length / 3, 200);
  near(surfaceFigures(surface(grid(10, () => 0).filter((p) => Math.hypot(p[0] - 500, p[1] - 500) > 200))).projected, 1e6, 1);
  const f = surfaceFigures(s);
  near(f.projected, 1e6, 1e-3);
  near(f.area, 1e6, 1e-3);
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [s.points[s.triangles[t]], s.points[s.triangles[t + 1]], s.points[s.triangles[t + 2]]];
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0);
  }
  const rings = borderRings(s);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 40);
}

// the Delaunay condition: no point inside a triangle's circle, on scattered points
{
  const points: Pt3[] = [];
  for (let i = 0; i < 300; i++) points.push([Math.abs(Math.sin(i * 12.3)) * 5000, Math.abs(Math.cos(i * 7.7)) * 5000, i]);
  const s = surface(points);
  for (let t = 0; t < s.triangles.length; t += 3) {
    const [a, b, c] = [s.points[s.triangles[t]], s.points[s.triangles[t + 1]], s.points[s.triangles[t + 2]]];
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
    const d = 2 * (bx * cy - by * cx);
    const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
    const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
    const r = Math.hypot(ux, uy);
    // long ones along the hull lean on the far triangle: they're only checked when well formed
    if (r > 1e5) continue;
    for (const p of s.points) assert.ok(Math.hypot(p[0] - a[0] - ux, p[1] - a[1] - uy) >= r - 1e-3);
  }
}

// lots of points in reasonable time
{
  const points: Pt3[] = [];
  for (let i = 0; i < 20000; i++) points.push([Math.abs(Math.sin(i * 1.3)) * 1e6, Math.abs(Math.cos(i * 0.7)) * 1e6, 0]);
  const at = Date.now();
  const s = surface(points);
  assert.ok(s.triangles.length / 3 > 10000);
  assert.ok(Date.now() - at < 15000, "took too long");
}

// heights on a tilted plane
{
  const s = surface(grid(10, (x, y) => x * 0.5 + y * 0.25 + 100));
  const at = heightLookup(s);
  near(at(123, 456) ?? 0, 123 * 0.5 + 456 * 0.25 + 100, 1e-6);
  near(at(0, 0) ?? 0, 100, 1e-6);
  near(at(1000, 1000) ?? 0, 850, 1e-6);
  assert.equal(at(1001, 0), null);
  assert.deepEqual(heightRange(s), { min: 100, max: 850 });
  near(slopePercent([0, 0, 0], [100, 0, 50], [0, 100, 0]), 50);
}

// contours: a straight one across a ramp, ending at the edges; a closed one round a cone
{
  const ramp = surface(grid(10, (x) => x));
  const lines = contourLines(ramp, 455);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].closed, false);
  for (const p of lines[0].points) near(p.x, 455);
  near(lineLength(lines[0]), 1000);
  const cone = surface(grid(20, (x, y) => 1000 - Math.hypot(x - 1000, y - 1000)));
  const rings = contourLines(cone, 500);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].closed, true);
  for (const p of rings[0].points) near(Math.hypot(p.x - 1000, p.y - 1000), 500, 10);
  // none above the top or below the bottom
  assert.equal(contourLines(cone, 2000).length, 0);
  // two hills, two rings
  const hills = surface(grid(40, (x, y) => Math.max(0, 500 - Math.hypot(x - 1000, y - 2000), 500 - Math.hypot(x - 3000, y - 2000))));
  assert.equal(contourLines(hills, 250).length, 2);
  // smoothing keeps a line's ends, and rounds it
  const bent = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], closed: false };
  const round = smoothed(bent);
  assert.deepEqual(round.points[0], bent.points[0]);
  assert.deepEqual(round.points.at(-1), bent.points[2]);
  assert.ok(lineLength(round) < lineLength(bent));
  assert.equal(smoothed(rings[0]).closed, true);
}

// levels: every interval, the majors from the offset
{
  const levels = contourLevels(95, 410, 100, 2, 0);
  assert.deepEqual(levels.map((l) => l.z), [100, 200, 300, 400]);
  assert.deepEqual(levels.map((l) => l.major), [false, true, false, true]);
  assert.deepEqual(contourLevels(0, 100, 50, 5, 10).map((l) => l.z), [10, 60]);
  assert.deepEqual(contourLevels(-200, -100, 100, 2, 0).map((l) => l.major), [true, false]);
  assert.deepEqual(contourLevels(0, 100, 0, 2, 0), []);
  assert.deepEqual(contourLevels(100, 0, 10, 2, 0), []);
  near(niceInterval(10000, 1000), 1000);
  near(niceInterval(23000, 1000), 5000);
  near(niceInterval(5000, 304.8), 304.8 * 2);
  near(niceInterval(0, 1000), 1000);
}

// a label sits half way along with its top uphill
{
  const ramp = surface(grid(10, (x) => x));
  const line = contourLines(ramp, 455)[0];
  const place = labelPlace(line, lineLength(line) / 2, heightLookup(ramp));
  near(place.at.y, 500, 1e-6);
  const a = (place.angle * Math.PI) / 180;
  // up the text is towards +x, the uphill way
  assert.ok(-Math.sin(a) > 0.99);
}

// volumes over a datum: a block, and one half below it
{
  const flat = surface(grid(10, () => 500));
  near(volumeAbove(flat, 0), 1e6 * 500, 1e-2);
  near(volumeAbove(flat, 200), 1e6 * 300, 1e-2);
  near(volumeAbove(flat, 900), 0);
}

// a pad cut into a ramp, with limits round it
{
  const ramp = surface(grid(40, () => 1000));
  const at = heightLookup(ramp);
  const ring = [{ x: 1500, y: 1500 }, { x: 2500, y: 1500 }, { x: 2500, y: 2500 }, { x: 1500, y: 2500 }];
  const pad: SiteModifier = { kind: "pad", ring, elevation: 800, slope: 0, slopeAngle: 0 };
  const proposed = surface(proposedPoints(ramp, at, [pad]));
  const now = heightLookup(proposed);
  // nothing overlapping: its triangles add up to the site
  near(surfaceFigures(proposed).projected, 16e6, 1);
  // flat on the pad, up to the old ground outside
  near(now(2000, 2000) ?? 0, 800, 1e-6);
  near(now(1600, 2400) ?? 0, 800, 1e-6);
  near(now(500, 500) ?? 0, 1000, 1e-6);
  // the edge of the site hasn't moved
  assert.deepEqual(boxOf(proposed), boxOf(ramp));
  // what came out of the pad
  const { cut, fill } = cutAndFill(at, now, boxOf(ramp));
  assert.ok(cut >= 1e6 * 200 * 0.98, `cut ${cut}`);
  // not much more, with the old ground caught up within a grid square of the pad
  assert.ok(cut <= 1e6 * 200 * 1.5, `cut ${cut}`);
  assert.equal(fill, 0);
  // with grade limits the ground slopes all the way from them
  const wide = [{ x: 500, y: 500 }, { x: 3500, y: 500 }, { x: 3500, y: 3500 }, { x: 500, y: 3500 }];
  const limited = surface(proposedPoints(ramp, at, [{ kind: "limits", ring: wide, elevation: 0, slope: 0, slopeAngle: 0 }, pad]));
  const graded = heightLookup(limited);
  near(graded(2000, 2000) ?? 0, 800, 1e-6);
  near(graded(100, 100) ?? 0, 1000, 1e-6);
  const half = graded(1000, 2000) ?? 0;
  assert.ok(half > 850 && half < 950, `half way ${half}`);
  // a fill pad
  const raised = surface(proposedPoints(ramp, at, [{ ...pad, elevation: 1100 }]));
  const raisedAt = heightLookup(raised);
  assert.ok(cutAndFill(at, raisedAt, boxOf(ramp)).fill > 1e6 * 100 * 0.98);
  // a sloped pad
  const sloped: SiteModifier = { ...pad, slope: 0.1, slopeAngle: 0 };
  near(padHeight(sloped, { x: 2000, y: 2000 }), 800);
  near(padHeight(sloped, { x: 2500, y: 2000 }), 850);
  near(heightLookup(surface(proposedPoints(ramp, at, [sloped])))(2200, 2000) ?? 0, 820, 1e-6);
  // over the edge: its outline stops at the edge, and the edge comes to its height
  const over: SiteModifier = { kind: "pad", ring: [{ x: -500, y: 1000 }, { x: 500, y: 1000 }, { x: 500, y: 2000 }, { x: -500, y: 2000 }], elevation: 700, slope: 0, slopeAngle: 0 };
  const edgeAt = heightLookup(surface(proposedPoints(ramp, at, [over])));
  near(edgeAt(0, 1500) ?? 0, 700, 1e-6);
  near(edgeAt(300, 1500) ?? 0, 700, 1e-6);
}

// from a boundary: flat, on a grid, its concave corner cut out
{
  const ell = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 500, y: 500 }, { x: 500, y: 1000 }, { x: 0, y: 1000 }];
  const points = boundaryPoints(ell, 100, { x: 0, y: 0 }, 300);
  const s = surface(points, ell);
  near(surfaceFigures(s).projected, 750000, 1);
  assert.equal(heightLookup(s)(800, 800), null);
  near(heightLookup(s)(250, 250) ?? 0, 300);
  assert.equal(borderRings(s).length, 1);
}

// faces and skirts make a closed volume
{
  const s = surface(grid(2, () => 100));
  const faces = facesByBand(s, () => 0);
  assert.equal(faces.get(0)?.length, 8);
  const sides = skirtFaces(s, 0);
  assert.equal(sides.length, 8 + 8);
  // bands
  const bands = facesByBand(surface(grid(2, (x) => x)), (a, b, c) => elevationBand((a[2] + b[2] + c[2]) / 3, 0, 200));
  assert.ok(bands.size >= 2);
  assert.equal(elevationBand(0, 0, 0), 0);
  assert.equal(elevationBand(100, 0, 100), 7);
  assert.equal(slopeBand([0, 0, 0], [100, 0, 1], [0, 100, 0]), 0);
  assert.equal(slopeBand([0, 0, 0], [100, 0, 90], [0, 100, 0]), 4);
}

// lifting faces
{
  const s = surface([[0, 0, 10], [100, 0, 10], [0, 100, 10]]);
  assert.equal(facesByBand(s, () => 0, 5).get(0)?.[0][2], 15);
  assert.equal(skirtFaces(s, 0, 5)[0][5], 5);
}

// labels: gaps in a line at their stations, a loop's ends joined
{
  const open = { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], closed: false };
  assert.deepEqual(labelStations(open, 2), [250, 750]);
  const pieces = gappedLine(open, [250, 750], 100);
  assert.equal(pieces.length, 3);
  near(pieces[0].points[1].x, 200);
  near(pieces[1].points[0].x, 300);
  near(pieces[1].points[1].x, 700);
  near(pieces[2].points[0].x, 800);
  assert.deepEqual(gappedLine(open, [], 100), [open]);
  const square = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], closed: true };
  const round = gappedLine(square, [200], 20);
  assert.equal(round.length, 1);
  near(lineLength(round[0]), 380);
  assert.equal(round[0].closed, false);
  // two labels on a loop: two pieces, the first going through its start
  const two = gappedLine(square, labelStations(square, 2), 20);
  assert.equal(two.length, 2);
  near(lineLength(two[0]) + lineLength(two[1]), 360);
}

// bands: a ramp cut along levels covers the whole of it, each piece within its band
{
  const ramp = surface(grid(4, (x) => x));
  const pieces = bandPieces(ramp, [100, 250]);
  assert.deepEqual([...new Set(pieces.map((p) => p.band))].sort(), [0, 1, 2]);
  let area = 0;
  for (const { band, ring } of pieces) {
    for (const p of ring) {
      if (band === 0) assert.ok(p[2] <= 100 + 1e-9);
      if (band === 1) assert.ok(p[2] >= 100 - 1e-9 && p[2] <= 250 + 1e-9);
      if (band === 2) assert.ok(p[2] >= 250 - 1e-9);
    }
    for (let i = 1; i + 1 < ring.length; i++) area += Math.abs((ring[i][0] - ring[0][0]) * (ring[i + 1][1] - ring[0][1]) - (ring[i][1] - ring[0][1]) * (ring[i + 1][0] - ring[0][0])) / 2;
  }
  near(area, 160000, 1e-3);
  assert.deepEqual([...new Set(bandPieces(ramp, []).map((p) => p.band))], [0]);
}

// a layer cake: flat tops, walls at the contours, sides down
{
  const ramp = surface(grid(4, (x) => x));
  const faces = terracedFaces(ramp, [100, 200, 300], 0);
  const walls = faces.filter(({ face }) => face.length === 12 && face[2] !== face[8]);
  assert.ok(walls.length > 0);
  assert.ok(walls.every(({ face }) => face[8] > face[2]));
  assert.equal(Math.max(...walls.map(({ face }) => face[8])), 300);
  const flats = faces.filter((f) => !walls.includes(f));
  assert.ok(flats.every(({ band, face }) => face[2] === [0, 100, 200, 300][band]));
}

// a grid over a surface, and columns
{
  const ramp = surface(grid(4, (x) => x));
  const cells = gridCells(heightLookup(ramp), boxOf(ramp), 100);
  assert.equal(cells.length, 16);
  near(cellHeight(cells[0]), 50);
  assert.equal(cellFace(cells[0], 10).length, 12);
  assert.equal(cellFace(cells[0], 10)[2], 10);
  const columns = columnFaces(cells[0], 0);
  assert.equal(columns.length, 5);
  assert.equal(columns[0][2], 50);
  // a triangular site leaves off what's over its edge
  const triangle = surface([[0, 0, 0], [1000, 0, 0], [0, 1000, 0]]);
  assert.ok(gridCells(heightLookup(triangle), boxOf(triangle), 100).length < 60);
}

// flow arrows go downhill, none on the flat
{
  const ramp = surface(grid(10, (x) => x * 0.5));
  const arrows = flowArrows(heightLookup(ramp), boxOf(ramp), 200, false);
  assert.ok(arrows.length >= 3);
  assert.ok(arrows[0][1].x < arrows[0][0].x);
  near(arrows[0][1].y, arrows[0][0].y);
  assert.equal(flowArrows(heightLookup(surface(grid(4, () => 7))), { x0: 0, y0: 0, x1: 400, y1: 400 }, 100, true).length, 0);
  // no more than a fair number however close they're asked for
  assert.ok(flowArrows(heightLookup(ramp), boxOf(ramp), 1, true).length <= 3 * 2600);
}

// how far proposed stands above existing
{
  const was = surface(grid(4, () => 100));
  const now = surface(grid(4, (x) => (x > 200 ? 150 : 100)));
  const diff = differenceSurface(was, now, heightLookup(was), heightLookup(now));
  assert.ok(diff);
  near(heightLookup(diff)(50, 50) ?? 1, 0);
  near(heightLookup(diff)(350, 50) ?? 0, 50);
}

// points as text
{
  const points = [[1.26, 2, 3.04], [-4.5, 5, 6]];
  assert.deepEqual(unpackPoints(packPoints(points)), [[1.3, 2, 3], [-4.5, 5, 6]]);
  assert.deepEqual(unpackPoints(""), []);
}

// a spoil pile adds its thickness inside and meets the ground again just outside
{
  const flat = surface(grid(12, (x) => 100 + x / 10));
  const at = heightLookup(flat);
  const ring = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 800 }, { x: 400, y: 800 }];
  const spoil = heightLookup(surface(proposedPoints(flat, at, [{ kind: "spoil", ring, elevation: 50, slope: 0, slopeAngle: 0 }])));
  near(spoil(600, 600) ?? 0, 210, 0.5);
  near(spoil(100, 100) ?? 0, 110, 0.5);
}

// grade limits can hold one height
{
  const flat = surface(grid(12, () => 100));
  const inner = [{ x: 500, y: 500 }, { x: 700, y: 500 }, { x: 700, y: 700 }, { x: 500, y: 700 }];
  const outer = [{ x: 300, y: 300 }, { x: 900, y: 300 }, { x: 900, y: 900 }, { x: 300, y: 900 }];
  const pad = { kind: "pad", ring: inner, elevation: 300, slope: 0, slopeAngle: 0 } as const;
  const edge = { kind: "limits", ring: outer, elevation: 0, slope: 0, slopeAngle: 0, level: 150 } as const;
  const held = heightLookup(surface(proposedPoints(flat, heightLookup(flat), [pad, edge])));
  near(held(300, 600) ?? 0, 150, 0.5);
  near(held(600, 600) ?? 0, 300, 0.5);
  near(held(100, 100) ?? 0, 100, 0.5);
  // a level of nothing follows the ground
  const free = heightLookup(surface(proposedPoints(flat, heightLookup(flat), [pad, { ...edge, level: undefined }])));
  near(free(300, 600) ?? 0, 100, 0.5);
}

// an aligned modifier's corners take what they touch, and its top runs between them
{
  const ring = [{ x: 600, y: 400 }, { x: 1000, y: 400 }, { x: 1000, y: 800 }, { x: 600, y: 800 }];
  const pad = { kind: "pad", ring: [{ x: 200, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 800 }, { x: 200, y: 800 }], elevation: 300, slope: 0, slopeAngle: 0 } as const;
  const line = { kind: "line", ring: [{ x: 1000, y: 0 }, { x: 1000, y: 400 }], elevation: 100, end: 200, slope: 0, slopeAngle: 0 } as const;
  const heights = alignedHeights(ring, [pad, line], 50, 10);
  assert.deepEqual(heights, [300, 200, 50, 300]);
  const flat = surface(grid(14, () => 100));
  const top = heightLookup(surface(proposedPoints(flat, heightLookup(flat), [{ kind: "aligned", ring, elevation: 50, slope: 0, slopeAngle: 0, heights }])));
  near(top(800, 400) ?? 0, 250, 1);
  near(top(1000, 600) ?? 0, 125, 1);
}

// an open line on a plane, when it has no second height
{
  const flat = surface(grid(12, () => 100));
  const line = { kind: "line", ring: [{ x: 200, y: 600 }, { x: 1000, y: 600 }], elevation: 300, slope: 0.1, slopeAngle: 0 } as const;
  const lined = heightLookup(surface(proposedPoints(flat, heightLookup(flat), [line])));
  near(lined(600, 600) ?? 0, 300, 1);
  near(lined(800, 600) ?? 0, 320, 1);
}

// a bed lies on the ground, within its outline
{
  const flat = surface(grid(12, (x) => 100 + x / 10));
  const ring = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 800 }, { x: 400, y: 800 }];
  const faces = drapedFaces(flat, heightLookup(flat), ring, 2);
  assert.ok(faces.length > 2);
  let area = 0;
  for (const f of faces) {
    area += Math.abs((f[3] - f[0]) * (f[7] - f[1]) - (f[6] - f[0]) * (f[4] - f[1])) / 2;
    for (let i = 0; i < 9; i += 3) {
      assert.ok(f[i] >= 400 - 1e-6 && f[i] <= 800 + 1e-6 && f[i + 1] >= 400 - 1e-6 && f[i + 1] <= 800 + 1e-6);
      near(f[i + 2], 102 + f[i] / 10, 1e-6);
    }
  }
  near(area, 160000, 1);
}

// a site border crops the surface, its heights as they were
{
  const flat = surface(grid(12, (x) => 100 + x / 10));
  const ring = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 800 }, { x: 400, y: 800 }];
  const cropped = clippedSurface(flat, heightLookup(flat), ring);
  assert.ok(cropped);
  const at = heightLookup(cropped);
  near(at(600, 600) ?? 0, 160, 1e-6);
  near(at(450, 800) ?? 0, 145, 1e-6);
  assert.equal(at(200, 200), null);
  assert.equal(at(900, 600), null);
}

// sculpting: even, soft, with new detail, and a single vertex
{
  const flat = surface(grid(12, () => 100));
  const base = { kind: "sculpt", ring: [], elevation: 50, slope: 0, slopeAngle: 0 } as const;
  const after = (edit: SiteModifier) => {
    const points = editedPoints(flat, heightLookup(flat), [edit]);
    return { points, at: heightLookup(surface(points)) };
  };
  const reach = { centre: { x: 600, y: 600 }, radius: 300, spacing: null };
  const even = after({ ...base, sculpt: { ...reach, soft: null } }).at;
  near(even(600, 600) ?? 0, 150, 1e-6);
  near(even(800, 600) ?? 0, 150, 1e-6);
  near(even(1000, 600) ?? 0, 100, 1e-6);
  const soft = after({ ...base, sculpt: { ...reach, soft: 1 } }).at;
  near(soft(600, 600) ?? 0, 150, 1e-6);
  near(soft(700, 600) ?? 0, 137.5, 1);
  near(soft(800, 600) ?? 0, 112.5, 1);
  near(soft(1000, 600) ?? 0, 100, 1e-6);
  const half = after({ ...base, sculpt: { ...reach, soft: 0.5 } }).at;
  near(half(700, 600) ?? 0, 150, 1e-6);
  assert.ok(after({ ...base, sculpt: { ...reach, soft: 1, spacing: 50 } }).points.length > after({ ...base, sculpt: { ...reach, soft: 1 } }).points.length + 50);
  const one = after({ ...base, sculpt: { ...reach, soft: null, elements: [{ x: 600, y: 600 }] } }).at;
  near(one(600, 600) ?? 0, 150, 1e-6);
  near(one(700, 600) ?? 0, 100, 1e-6);
  near(one(650, 600) ?? 0, 125, 1e-6);
}

// a new vertex is on the ground as it stood
{
  const slope = surface(grid(12, (x) => 100 + x / 10));
  const points = editedPoints(slope, heightLookup(slope), [{ kind: "vertex", ring: [{ x: 633, y: 655 }], elevation: 0, slope: 0, slopeAngle: 0 }]);
  assert.equal(points.length, slope.points.length + 1);
  near(points[points.length - 1][2], 163.3, 1e-6);
}

// swales and berms, by their profile
{
  const flat = surface(grid(12, () => 100));
  const ring = [{ x: 200, y: 600 }, { x: 1000, y: 600 }];
  const swaled = (profile: SwaleProfile) => heightLookup(surface(editedPoints(flat, heightLookup(flat), [{ kind: "swale", ring, elevation: -40, slope: 0, slopeAngle: 0, swale: { width: 400, profile, follow: true } }])));
  const level = swaled("Flat");
  near(level(600, 600) ?? 0, 60, 1e-6);
  near(level(600, 700) ?? 0, 60, 1e-6);
  near(level(600, 750) ?? 0, 80, 1);
  near(level(600, 800) ?? 0, 100, 1e-6);
  near(level(600, 1000) ?? 0, 100, 1e-6);
  near(swaled("Sharp")(600, 700) ?? 0, 80, 1e-6);
  near(swaled("Rounded")(600, 700) ?? 0, 80, 1e-6);
  near(swaled("Rounded")(600, 650) ?? 0, 100 - 40 * Math.cos(Math.PI / 8) ** 2, 1e-6);
  // following the ground, or running straight between its ends
  const dip = surface(grid(12, (x) => 100 + (x - 600) ** 2 / 1000));
  const crossing = (follow: boolean) => heightLookup(surface(editedPoints(dip, heightLookup(dip), [{ kind: "swale", ring, elevation: -40, slope: 0, slopeAngle: 0, swale: { width: 400, profile: "Flat", follow } }])));
  near(crossing(true)(600, 600) ?? 0, 60, 1e-6);
  near(crossing(false)(600, 600) ?? 0, 220, 1e-6);
}

// a contour moved: the ground goes with it, not by the old line too
{
  const slope = surface(grid(12, (x) => 100 + x / 10));
  const old = [{ x: 600, y: 100 }, { x: 600, y: 1000 }];
  const ring = [{ x: 700, y: 100 }, { x: 700, y: 1000 }];
  const at = heightLookup(surface(proposedPoints(slope, heightLookup(slope), [{ kind: "contour", ring, old, elevation: 160, slope: 0, slopeAngle: 0 }])));
  near(at(700, 600) ?? 0, 160, 1);
  near(at(950, 600) ?? 0, 195, 1);
  assert.ok((at(600, 600) ?? 0) < 160 && (at(600, 600) ?? 0) > 150);
}

// picking what's under the pointer
{
  const flat = surface(grid(12, () => 100));
  assert.equal(surfaceElement(flat, { x: 602, y: 601 }, 10).length, 1);
  assert.equal(surfaceElement(flat, { x: 650, y: 601 }, 10).length, 2);
  assert.equal(surfaceElement(flat, { x: 630, y: 660 }, 10).length, 3);
  assert.equal(surfaceElement(flat, { x: 99999, y: 0 }, 10).length, 0);
}

console.log("siteModelShapes ok");
