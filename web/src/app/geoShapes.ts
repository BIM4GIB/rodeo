// Georeferencing's sums: where a point of the drawing is on the Earth and back, how far apart two
// places are, the great circle between them and the lines of a graticule. A drawing is placed by its
// internal origin's latitude and longitude and the angle to true north, through one of three
// coordinate systems on WGS 84: Pseudo-Mercator, UTM, or a transverse Mercator on the origin's own
// meridian. Vectorworks takes any system GDAL knows; no such library is here.

import type { Pt } from "../core/index.ts";
import { pointInPolygon } from "./geom.ts";

export interface LatLon {
  /** degrees */
  readonly lat: number;
  readonly lon: number;
}

export type GeoSystem = "pseudo-mercator" | "utm" | "local";

export interface Georef extends LatLon {
  readonly system: GeoSystem;
  /** a UTM system's zone and hemisphere; without them, those of the location */
  readonly zone?: number;
  readonly south?: boolean;
  /** true north's azimuth from the drawing's Y axis, clockwise, degrees */
  readonly north: number;
}

export type DegreeStyle = "decimal" | "dms";

const RAD = Math.PI / 180;
const A = 6378137;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const UTM_K = 0.9996;
const UTM_EAST = 500000;
const UTM_SOUTH = 10000000;
/** degrees of a graticule's reach sampled for a line */
const LINE_STEPS = 64;
/** a graticule asks for no more lines than this */
const MAX_LINES = 500;

const n = F / (2 - F);
const RECT = (A / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64 + n ** 6 / 256);
const ALPHA = [n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16 + (41 * n ** 4) / 180, (13 * n * n) / 48 - (3 * n ** 3) / 5 + (557 * n ** 4) / 1440, (61 * n ** 3) / 240 - (103 * n ** 4) / 140, (49561 * n ** 4) / 161280];
const BETA = [n / 2 - (2 * n * n) / 3 + (37 * n ** 3) / 96 - n ** 4 / 360, (n * n) / 48 + n ** 3 / 15 - (437 * n ** 4) / 1440, (17 * n ** 3) / 480 - (37 * n ** 4) / 840, (4397 * n ** 4) / 161280];
const DELTA = [2 * n - (2 * n * n) / 3 - 2 * n ** 3 + (116 * n ** 4) / 45, (7 * n * n) / 3 - (8 * n ** 3) / 5 - (227 * n ** 4) / 45, (56 * n ** 3) / 15 - (136 * n ** 4) / 35, (4279 * n ** 4) / 630];
const STRETCH = (2 * Math.sqrt(n)) / (1 + n);

/** Metres east and north on a transverse Mercator (Krüger's series, good to a millimetre near its meridian). */
function tmForward(p: LatLon, lon0: number, k: number, east: number, north: number): Pt {
  const phi = p.lat * RAD;
  const dl = (p.lon - lon0) * RAD;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - STRETCH * Math.atanh(STRETCH * Math.sin(phi)));
  const xi0 = Math.atan2(t, Math.cos(dl));
  const eta0 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xi0;
  let eta = eta0;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xi0) * Math.cosh(j * eta0);
    eta += a * Math.cos(j * xi0) * Math.sinh(j * eta0);
  });
  return { x: east + k * RECT * eta, y: north + k * RECT * xi };
}

function tmInverse(p: Pt, lon0: number, k: number, east: number, north: number): LatLon {
  const xi = (p.y - north) / (k * RECT);
  const eta = (p.x - east) / (k * RECT);
  let xi0 = xi;
  let eta0 = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xi0 -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    eta0 -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  let phi = chi;
  DELTA.forEach((d, i) => {
    phi += d * Math.sin(2 * (i + 1) * chi);
  });
  return { lat: phi / RAD, lon: lon0 + Math.atan2(Math.sinh(eta0), Math.cos(xi0)) / RAD };
}

export function utmZone(lon: number): number {
  return Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
}

/** A system by its EPSG code, for the ones Rodeo has; null for the rest. */
export function systemOfEpsg(code: number): Pick<Georef, "system" | "zone" | "south"> | null {
  if (code === 3857) return { system: "pseudo-mercator" };
  if (code >= 32601 && code <= 32660) return { system: "utm", zone: code - 32600, south: false };
  if (code >= 32701 && code <= 32760) return { system: "utm", zone: code - 32700, south: true };
  return null;
}

export function systemName(g: Georef): string {
  if (g.system === "pseudo-mercator") return "WGS 84 / Pseudo-Mercator (EPSG:3857)";
  if (g.system === "local") return `Transverse Mercator on the meridian ${formatDegrees(g.lon, "decimal", 4)}`;
  const zone = g.zone ?? utmZone(g.lon);
  const south = g.south ?? g.lat < 0;
  return `WGS 84 / UTM zone ${zone}${south ? "S" : "N"} (EPSG:${(south ? 32700 : 32600) + zone})`;
}

/** Metres east and north in the drawing's coordinate system. */
export function projected(g: Georef, p: LatLon): Pt {
  if (g.system === "pseudo-mercator") return { x: A * p.lon * RAD, y: A * Math.log(Math.tan(Math.PI / 4 + (p.lat * RAD) / 2)) };
  if (g.system === "local") return tmForward(p, g.lon, 1, 0, 0);
  const zone = g.zone ?? utmZone(g.lon);
  return tmForward(p, zone * 6 - 183, UTM_K, UTM_EAST, (g.south ?? g.lat < 0) ? UTM_SOUTH : 0);
}

/** Where metres east and north in the drawing's coordinate system are. */
export function unprojected(g: Georef, p: Pt): LatLon {
  if (g.system === "pseudo-mercator") return { lat: (2 * Math.atan(Math.exp(p.y / A)) - Math.PI / 2) / RAD, lon: p.x / A / RAD };
  if (g.system === "local") return tmInverse(p, g.lon, 1, 0, 0);
  const zone = g.zone ?? utmZone(g.lon);
  return tmInverse(p, zone * 6 - 183, UTM_K, UTM_EAST, (g.south ?? g.lat < 0) ? UTM_SOUTH : 0);
}

/** A drawing point's (mm) easting and northing. */
export function eastNorth(g: Georef, p: Pt): Pt {
  const o = projected(g, g);
  const c = Math.cos(g.north * RAD);
  const s = Math.sin(g.north * RAD);
  return { x: o.x + (p.x * c - p.y * s) / 1000, y: o.y + (p.x * s + p.y * c) / 1000 };
}

/** The drawing point (mm) at an easting and northing. */
export function drawingAtEastNorth(g: Georef, en: Pt): Pt {
  const o = projected(g, g);
  const c = Math.cos(g.north * RAD);
  const s = Math.sin(g.north * RAD);
  const e = (en.x - o.x) * 1000;
  const m = (en.y - o.y) * 1000;
  return { x: e * c + m * s, y: -e * s + m * c };
}

export function drawingToGeo(g: Georef, p: Pt): LatLon {
  return unprojected(g, eastNorth(g, p));
}

export function geoToDrawing(g: Georef, p: LatLon): Pt {
  return drawingAtEastNorth(g, projected(g, p));
}

/**
 * The georeferencing that puts a drawing point at a place, keeping the system and the angle: a local
 * system's meridian goes with the origin, so it is found by going round a few times.
 */
export function georefThrough(g: Georef, at: Pt, place: LatLon): Georef {
  const c = Math.cos(g.north * RAD);
  const s = Math.sin(g.north * RAD);
  const offset = { x: (at.x * c - at.y * s) / 1000, y: (at.x * s + at.y * c) / 1000 };
  let out: Georef = { ...g, lat: place.lat, lon: place.lon };
  for (let i = 0; i < 6; i++) {
    const en = projected(out, place);
    out = { ...out, ...unprojected(out, { x: en.x - offset.x, y: en.y - offset.y }) };
  }
  return out;
}

export interface Geodesic {
  /** metres */
  readonly distance: number;
  /** degrees clockwise from north, at the start and on arrival */
  readonly azimuth: number;
  readonly arrival: number;
}

/** Vincenty's inverse: the shortest way over the ellipsoid; nearly opposite points, where it doesn't settle, go by the sphere. */
export function geodesic(a: LatLon, b: LatLon): Geodesic {
  const L = (b.lon - a.lon) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(a.lat * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(b.lat * RAD));
  const [sU1, cU1, sU2, cU2] = [Math.sin(U1), Math.cos(U1), Math.sin(U2), Math.cos(U2)];
  let lambda = L;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lambda);
    const cl = Math.cos(lambda);
    const sinSigma = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl);
    if (sinSigma === 0) return { distance: 0, azimuth: 0, arrival: 0 };
    const cosSigma = sU1 * sU2 + cU1 * cU2 * cl;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cU1 * cU2 * sl) / sinSigma;
    const cos2Alpha = 1 - sinAlpha * sinAlpha;
    const cos2Mid = cos2Alpha === 0 ? 0 : cosSigma - (2 * sU1 * sU2) / cos2Alpha;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const next = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2Mid + C * cosSigma * (-1 + 2 * cos2Mid * cos2Mid)));
    if (Math.abs(next - lambda) < 1e-12) {
      const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
      const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma = BB * sinSigma * (cos2Mid + (BB / 4) * (cosSigma * (-1 + 2 * cos2Mid * cos2Mid) - (BB / 6) * cos2Mid * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2Mid * cos2Mid)));
      const az = Math.atan2(cU2 * Math.sin(next), cU1 * sU2 - sU1 * cU2 * Math.cos(next)) / RAD;
      const end = Math.atan2(cU1 * Math.sin(next), -sU1 * cU2 + cU1 * sU2 * Math.cos(next)) / RAD;
      return { distance: B * AA * (sigma - dSigma), azimuth: (az + 360) % 360, arrival: (end + 360) % 360 };
    }
    lambda = next;
  }
  const [va, vb] = [unitOf(a), unitOf(b)];
  const angle = Math.atan2(Math.hypot(va[1] * vb[2] - va[2] * vb[1], va[2] * vb[0] - va[0] * vb[2], va[0] * vb[1] - va[1] * vb[0]), va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]);
  const az = Math.atan2(Math.sin(L) * Math.cos(b.lat * RAD), Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(L)) / RAD;
  return { distance: angle * ((2 * A + B) / 3), azimuth: (az + 360) % 360, arrival: (az + 360) % 360 };
}

/** Vincenty's direct: where a distance (m) along an azimuth (degrees) from a place ends. */
export function destination(a: LatLon, azimuth: number, distance: number): LatLon {
  const alpha = azimuth * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(a.lat * RAD));
  const [sU1, cU1] = [Math.sin(U1), Math.cos(U1)];
  const sigma1 = Math.atan2(Math.tan(U1), Math.cos(alpha));
  const sinAlpha = cU1 * Math.sin(alpha);
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
  const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  let sigma = distance / (B * AA);
  let cos2Mid = 0;
  for (let i = 0; i < 100; i++) {
    cos2Mid = Math.cos(2 * sigma1 + sigma);
    const s = Math.sin(sigma);
    const c = Math.cos(sigma);
    const dSigma = BB * s * (cos2Mid + (BB / 4) * (c * (-1 + 2 * cos2Mid * cos2Mid) - (BB / 6) * cos2Mid * (-3 + 4 * s * s) * (-3 + 4 * cos2Mid * cos2Mid)));
    const next = distance / (B * AA) + dSigma;
    if (Math.abs(next - sigma) < 1e-12) {
      sigma = next;
      break;
    }
    sigma = next;
  }
  const s = Math.sin(sigma);
  const c = Math.cos(sigma);
  const x = sU1 * s - cU1 * c * Math.cos(alpha);
  const lat = Math.atan2(sU1 * c + cU1 * s * Math.cos(alpha), (1 - F) * Math.hypot(sinAlpha, x));
  const lambda = Math.atan2(s * Math.sin(alpha), cU1 * c - sU1 * s * Math.cos(alpha));
  const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
  const L = lambda - (1 - C) * F * sinAlpha * (sigma + C * s * (cos2Mid + C * c * (-1 + 2 * cos2Mid * cos2Mid)));
  return { lat: lat / RAD, lon: a.lon + L / RAD };
}

function unitOf(p: LatLon): [number, number, number] {
  const phi = p.lat * RAD;
  const l = p.lon * RAD;
  return [Math.cos(phi) * Math.cos(l), Math.cos(phi) * Math.sin(l), Math.sin(phi)];
}

/** Places along the great circle from a to b, ends included. */
export function greatCirclePath(a: LatLon, b: LatLon, steps: number): LatLon[] {
  const u = unitOf(a);
  const v = unitOf(b);
  const angle = Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
  if (angle < 1e-12) return [a, b];
  const out: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = Math.sin((1 - t) * angle) / Math.sin(angle);
    const q = Math.sin(t * angle) / Math.sin(angle);
    const w = [p * u[0] + q * v[0], p * u[1] + q * v[1], p * u[2] + q * v[2]];
    out.push({ lat: Math.atan2(w[2], Math.hypot(w[0], w[1])) / RAD, lon: Math.atan2(w[1], w[0]) / RAD });
  }
  out[0] = a;
  out[steps] = b;
  return out;
}

/** Degrees typed as 39.18, -39.18, 39° 10' 32", 39d 10m 32s or 39 10 32, a trailing N, S, E or W allowed; null if not. */
export function parseDegrees(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  // the s of 39d 10m 32s is seconds, not south
  const hemi = /[dm]/.test(t) && t.endsWith("s") ? null : /\s*([nsew])$/.exec(t);
  const body = hemi ? t.slice(0, hemi.index) : t;
  const m = /^(-?)\s*(\d*\.?\d+)\s*(?:°|d|\s)?\s*(?:(\d*\.?\d+)\s*(?:'|m|\s)?\s*)?(?:(\d*\.?\d+)\s*(?:"|s)?\s*)?$/.exec(body);
  if (!m) return null;
  const v = Number(m[2]) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
  const negative = m[1] === "-" || hemi?.[1] === "s" || hemi?.[1] === "w";
  return Number.isFinite(v) ? (negative ? -v : v) : null;
}

/** Degrees for a label; `hemi` gives the letters for north/south or east/west in place of a sign. */
export function formatDegrees(value: number, style: DegreeStyle, precision: number, hemi?: "NS" | "EW"): string {
  const abs = Math.abs(value);
  const letter = hemi ? ` ${value < 0 ? hemi[1] : hemi[0]}` : "";
  const sign = hemi || value >= 0 ? "" : "-";
  if (style === "decimal") return `${sign}${abs.toFixed(precision)}°${letter}`;
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = (abs - d - m / 60) * 3600;
  // rounding up to a whole minute or degree carries
  if (Number(s.toFixed(precision)) >= 60) {
    s = 0;
    m++;
  }
  if (m >= 60) {
    m = 0;
    d++;
  }
  return `${sign}${d}° ${m}' ${s.toFixed(precision)}"${letter}`;
}

/** An azimuth as a surveyor's bearing: N 56° 30' E. */
export function bearingText(azimuth: number): string {
  const a = ((azimuth % 360) + 360) % 360;
  const north = a <= 90 || a >= 270;
  const east = a <= 180;
  const off = a <= 90 ? a : a <= 180 ? 180 - a : a <= 270 ? a - 180 : 360 - a;
  let d = Math.floor(off);
  let m = Math.round((off - d) * 60);
  if (m === 60) {
    m = 0;
    d++;
  }
  return `${north ? "N" : "S"} ${d}° ${m}' ${east ? "E" : "W"}`;
}

/** A line snapped to the nearest of level, plumb and 30° and 45° off them. */
export function constrainedEnd(a: Pt, b: Pt): Pt {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d === 0) return b;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) / RAD;
  let best = 0;
  for (let k = -180; k <= 180; k += 15) {
    if (k % 30 !== 0 && k % 45 !== 0) continue;
    if (Math.abs(k - angle) < Math.abs(best - angle)) best = k;
  }
  const r = (d * Math.cos((best - angle) * RAD)) / 1;
  return { x: a.x + r * Math.cos(best * RAD), y: a.y + r * Math.sin(best * RAD) };
}

export interface Graticule {
  readonly start: LatLon;
  /** degrees between lines */
  readonly stepLat: number;
  readonly stepLon: number;
  /** every this many lines is a major one */
  readonly majorEvery: number;
  readonly labelMajor: boolean;
  readonly labelMinor: boolean;
  readonly style: DegreeStyle;
  readonly precision: number;
}

export interface GraticuleLine {
  readonly points: readonly Pt[];
  readonly major: boolean;
  /** which it is, and where it is */
  readonly meridian: boolean;
  readonly value: number;
  /** the line's text, where it's labelled */
  readonly label: string | null;
}

export function graticuleProblem(t: Graticule): string | null {
  if (!(t.stepLat > 0) || !(t.stepLon > 0)) return "The grid's spacing must be more than 0.";
  if (!(t.majorEvery >= 1)) return "Major lines need a count of 1 or more.";
  return null;
}

/** What of a line lies inside an outline, in pieces. */
export function clippedLine(points: readonly Pt[], boundary: readonly Pt[]): Pt[][] {
  const pieces: Pt[][] = [];
  let open: Pt[] | null = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i];
    const q = points[i + 1];
    const d = { x: q.x - p.x, y: q.y - p.y };
    const cuts = [0, 1];
    boundary.forEach((a, k) => {
      const b = boundary[(k + 1) % boundary.length];
      const e = { x: b.x - a.x, y: b.y - a.y };
      const det = d.x * e.y - d.y * e.x;
      if (Math.abs(det) < 1e-12) return;
      const o = { x: a.x - p.x, y: a.y - p.y };
      const t = (o.x * e.y - o.y * e.x) / det;
      const r = (o.x * d.y - o.y * d.x) / det;
      if (t > 0 && t < 1 && r >= 0 && r <= 1) cuts.push(t);
    });
    cuts.sort((x, y) => x - y);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const [t0, t1] = [cuts[c], cuts[c + 1]];
      if (t1 - t0 < 1e-9) continue;
      const at = (t: number): Pt => ({ x: p.x + d.x * t, y: p.y + d.y * t });
      if (pointInPolygon(at((t0 + t1) / 2), boundary)) {
        if (open) open.push(at(t1));
        else {
          open = [at(t0), at(t1)];
          pieces.push(open);
        }
      } else open = null;
    }
  }
  return pieces;
}

/** The graticule's lines inside an outline of the drawing; null when it would take too many lines. */
export function graticuleLines(g: Georef, boundary: readonly Pt[], t: Graticule): GraticuleLine[] | null {
  // the outline's reach on the globe, from points along its edges
  const places: LatLon[] = [];
  boundary.forEach((a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    for (let k = 0; k < 16; k++) places.push(drawingToGeo(g, { x: a.x + ((b.x - a.x) * k) / 16, y: a.y + ((b.y - a.y) * k) / 16 }));
  });
  const lats = places.map((p) => p.lat);
  const lons = places.map((p) => p.lon);
  const [lat0, lat1] = [Math.min(...lats), Math.max(...lats)];
  const [lon0, lon1] = [Math.min(...lons), Math.max(...lons)];
  const eachLon = [Math.ceil((lon0 - t.start.lon) / t.stepLon), Math.floor((lon1 - t.start.lon) / t.stepLon)];
  const eachLat = [Math.ceil((lat0 - t.start.lat) / t.stepLat), Math.floor((lat1 - t.start.lat) / t.stepLat)];
  if (eachLon[1] - eachLon[0] + eachLat[1] - eachLat[0] > MAX_LINES) return null;
  const out: GraticuleLine[] = [];
  const add = (meridian: boolean, k: number): void => {
    const value = meridian ? t.start.lon + k * t.stepLon : t.start.lat + k * t.stepLat;
    const line: Pt[] = [];
    for (let i = 0; i <= LINE_STEPS; i++) {
      const f = i / LINE_STEPS;
      line.push(geoToDrawing(g, meridian ? { lat: lat0 + (lat1 - lat0) * f, lon: value } : { lat: value, lon: lon0 + (lon1 - lon0) * f }));
    }
    const major = ((k % t.majorEvery) + t.majorEvery) % t.majorEvery === 0;
    const shown = major ? t.labelMajor : t.labelMinor;
    const label = shown ? formatDegrees(value, t.style, t.precision, meridian ? "EW" : "NS") : null;
    for (const points of clippedLine(line, boundary)) out.push({ points, major, meridian, value, label });
  };
  for (let k = eachLon[0]; k <= eachLon[1]; k++) add(true, k);
  for (let k = eachLat[0]; k <= eachLat[1]; k++) add(false, k);
  return out;
}
