// Node check of georeferencing's sums. Run from web/: npx tsx src/app/geoShapes.check.ts

import assert from "node:assert/strict";
import { bearingText, clippedLine, constrainedEnd, destination, drawingToGeo, eastNorth, formatDegrees, geodesic, geoToDrawing, georefThrough, graticuleLines, graticuleProblem, greatCirclePath, parseDegrees, projected, systemName, systemOfEpsg, unprojected, utmZone, type Georef } from "./geoShapes.ts";

const near = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// UTM: on the central meridian at the equator, easting 500 km; at 45° north, the meridian's published
// arc length (4 984 944.378 m) times the scale
{
  const utm: Georef = { system: "utm", lat: 0, lon: -3, north: 0 };
  assert.equal(utmZone(-3), 30);
  const a = projected(utm, { lat: 0, lon: -3 });
  near(a.x, 500000, 1e-6);
  near(a.y, 0, 1e-6);
  const b = projected(utm, { lat: 45, lon: -3 });
  near(b.y, 4984944.378 * 0.9996, 0.01);
  // and back, off the meridian too
  for (const p of [{ lat: 51.5, lon: -0.1 }, { lat: 10, lon: -6 }, { lat: 70, lon: 0 }]) {
    const q = unprojected(utm, projected(utm, p));
    near(q.lat, p.lat, 1e-9);
    near(q.lon, p.lon, 1e-9);
  }
  // southern hemisphere: 10 000 km false northing
  const s: Georef = { system: "utm", lat: -33, lon: 151, north: 0 };
  assert.ok(projected(s, { lat: -33, lon: 151 }).y > 6e6);
}

// Pseudo-Mercator: the published world extent
{
  const w: Georef = { system: "pseudo-mercator", lat: 0, lon: 0, north: 0 };
  near(projected(w, { lat: 0, lon: 180 }).x, 20037508.34, 0.01);
  const q = unprojected(w, projected(w, { lat: 40, lon: -70 }));
  near(q.lat, 40, 1e-9);
  near(q.lon, -70, 1e-9);
}

// Vincenty's published test: Flinders Peak to Buninyong, 54 972.271 m at 306° 52' 05.37" (on GRS 80, a hair from WGS 84)
{
  const a = { lat: -(37 + 57 / 60 + 3.7203 / 3600), lon: 144 + 25 / 60 + 29.5244 / 3600 };
  const b = { lat: -(37 + 39 / 60 + 10.1561 / 3600), lon: 143 + 55 / 60 + 35.3839 / 3600 };
  const g = geodesic(a, b);
  near(g.distance, 54972.271, 0.01);
  near(g.azimuth, 306 + 52 / 60 + 5.37 / 3600, 1e-4);
  const end = destination(a, g.azimuth, g.distance);
  near(end.lat, b.lat, 1e-8);
  near(end.lon, b.lon, 1e-8);
  assert.equal(geodesic(a, a).distance, 0);
  // opposite points don't settle and go by the sphere
  const far = geodesic({ lat: 0, lon: 0 }, { lat: 0.5, lon: 179.7 });
  near(far.distance, 19_970_000, 150_000);
}

// A drawing placed on the Earth, turned: a point and its place go both ways, the distance is the drawing's
for (const system of ["local", "utm", "pseudo-mercator"] as const) {
  const g: Georef = { system, lat: 51.5, lon: -0.1, north: 30 };
  const p = { x: 123456, y: -98765 };
  const place = drawingToGeo(g, p);
  const back = geoToDrawing(g, place);
  near(back.x, p.x, 0.01);
  near(back.y, p.y, 0.01);
  near(drawingToGeo(g, { x: 0, y: 0 }).lat, 51.5, 1e-9);
  if (system !== "pseudo-mercator") near(geodesic(g, place).distance / (Math.hypot(p.x, p.y) / 1000), 1, 1e-3);
}

// True north 90° clockwise of Y: the drawing's +X points north
{
  const g: Georef = { system: "local", lat: 10, lon: 20, north: 90 };
  const en = eastNorth(g, { x: 1000, y: 0 });
  const o = eastNorth(g, { x: 0, y: 0 });
  near(en.x - o.x, 0, 1e-6);
  near(en.y - o.y, 1, 1e-6);
  near(geodesic(g, drawingToGeo(g, { x: 1000, y: 0 })).azimuth, 0, 1e-3);
}

// A survey point sets the origin so that it is where it's said to be
for (const system of ["local", "utm", "pseudo-mercator"] as const) {
  const g = georefThrough({ system, lat: 0, lon: 0, north: 25 }, { x: 500000, y: 300000 }, { lat: 39.18, lon: -76.6 });
  const q = drawingToGeo(g, { x: 500000, y: 300000 });
  near(q.lat, 39.18, 1e-7);
  near(q.lon, -76.6, 1e-7);
}

// EPSG codes
{
  assert.deepEqual(systemOfEpsg(3857), { system: "pseudo-mercator" });
  assert.deepEqual(systemOfEpsg(32630), { system: "utm", zone: 30, south: false });
  assert.deepEqual(systemOfEpsg(32756), { system: "utm", zone: 56, south: true });
  assert.equal(systemOfEpsg(27700), null);
  assert.match(systemName({ system: "utm", lat: 51, lon: 0, north: 0 }), /zone 31N/);
}

// The great circle from New York to London bends north of both
{
  const path = greatCirclePath({ lat: 40.7, lon: -74 }, { lat: 51.5, lon: 0 }, 32);
  assert.equal(path.length, 33);
  assert.ok(Math.max(...path.map((p) => p.lat)) > 52);
  near(path[0].lon, -74, 1e-12);
  near(path[32].lat, 51.5, 1e-12);
  // the same distance as the geodesic, within the sphere's error
  let sum = 0;
  for (let i = 0; i < 32; i++) sum += geodesic(path[i], path[i + 1]).distance;
  near(sum / geodesic(path[0], path[32]).distance, 1, 1e-3);
}

// Degrees in and out
{
  near(parseDegrees("39.18")!, 39.18, 1e-12);
  near(parseDegrees("-39.18")!, -39.18, 1e-12);
  near(parseDegrees(`39° 10' 32"`)!, 39 + 10 / 60 + 32 / 3600, 1e-12);
  near(parseDegrees("39d 10m 32s")!, 39 + 10 / 60 + 32 / 3600, 1e-12);
  near(parseDegrees("39 10 32")!, 39 + 10 / 60 + 32 / 3600, 1e-12);
  near(parseDegrees("76.5 W")!, -76.5, 1e-12);
  assert.equal(parseDegrees("north"), null);
  assert.equal(parseDegrees(""), null);
  assert.equal(formatDegrees(39.5, "decimal", 2), "39.50°");
  assert.equal(formatDegrees(-76.5, "decimal", 1, "EW"), "76.5° W");
  assert.equal(formatDegrees(39.5, "dms", 0, "NS"), `39° 30' 0" N`);
  assert.equal(formatDegrees(9.99999, "dms", 0), `10° 0' 0"`);
  assert.equal(bearingText(45), "N 45° 0' E");
  assert.equal(bearingText(135), "S 45° 0' E");
  assert.equal(bearingText(225.5), "S 45° 30' W");
  assert.equal(bearingText(315), "N 45° 0' W");
}

// A constrained line keeps to level, plumb and 30° and 45° off them
{
  const e = constrainedEnd({ x: 0, y: 0 }, { x: 100, y: 3 });
  near(e.y, 0, 1e-9);
  const f = constrainedEnd({ x: 0, y: 0 }, { x: 100, y: 95 });
  near(f.x, f.y, 1e-9);
  const h = constrainedEnd({ x: 0, y: 0 }, { x: 100, y: 60 });
  near(Math.atan2(h.y, h.x), Math.PI / 6, 1e-9);
}

// Clipping keeps what's inside, in pieces
{
  const box = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const across = clippedLine([{ x: -5, y: 5 }, { x: 15, y: 5 }], box);
  assert.equal(across.length, 1);
  near(across[0][0].x, 0, 1e-9);
  near(across[0][1].x, 10, 1e-9);
  const notch = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
  assert.equal(clippedLine([{ x: -5, y: 5 }, { x: 15, y: 5 }], notch).length, 2);
}

// A graticule over a square about a degree across: lines at each tenth of a degree, every fifth major
{
  const g: Georef = { system: "local", lat: 40, lon: -100, north: 0 };
  const box = [{ x: -40e6, y: -55e6 }, { x: 40e6, y: -55e6 }, { x: 40e6, y: 55e6 }, { x: -40e6, y: 55e6 }];
  const t = { start: { lat: 40, lon: -100 }, stepLat: 0.1, stepLon: 0.1, majorEvery: 5, labelMajor: true, labelMinor: false, style: "decimal" as const, precision: 1 };
  assert.equal(graticuleProblem(t), null);
  const lines = graticuleLines(g, box, t)!;
  const meridians = lines.filter((l) => l.meridian);
  const parallels = lines.filter((l) => !l.meridian);
  assert.equal(meridians.length, 9);
  assert.equal(parallels.length, 9);
  assert.equal(meridians.filter((l) => l.major).length, 1);
  assert.equal(lines.filter((l) => l.label).length, 2);
  assert.ok(lines.find((l) => l.label === "100.0° W"));
  // lines stay inside
  for (const l of lines) for (const p of l.points) assert.ok(Math.abs(p.x) <= 40e6 + 1 && Math.abs(p.y) <= 55e6 + 1);
  // a meridian off the central one leans toward the pole
  const east = meridians.find((m) => Math.abs(m.value + 99.7) < 1e-9)!;
  const bottom = east.points[0];
  const top = east.points[east.points.length - 1];
  assert.ok(top.x < bottom.x);
  assert.equal(graticuleLines(g, box, { ...t, stepLat: 0.0001, stepLon: 0.0001 }), null);
  assert.ok(graticuleProblem({ ...t, stepLat: 0 }));
}

console.log("all checks passed");
