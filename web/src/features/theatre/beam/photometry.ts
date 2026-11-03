// How an instrument's light falls: its brightness at each angle off the beam's axis, the lux it gives a
// point on a flat surface, the outline its beam cuts on a plane (the pool), and the lux over a grid of a
// stage. Pure: lengths in mm, angles in degrees, candela over metres squared gives lux. The curve runs
// through the two catalogue angles (half the peak at the beam angle, a tenth at the field angle). It
// leaves out light bounced off the stage and walls and the lamp's ageing; a gel counts by its brightness.

import type { Pt } from "../../../core/index.ts";
import { FOCUS_PLANE_MM, type Fixture } from "../fixture.ts";
import { colorOf } from "../gels.ts";

/** What the light model reads of an instrument. */
export type Photometric = Pick<Fixture, "at" | "heightMm" | "focus" | "beamDeg" | "fieldDeg" | "lumens" | "channel" | "color">;

/** A point in mm: x, y in the plan and z above the stage floor. */
export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A rectangle of the plan, mm. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface LuxStats {
  readonly min: number;
  readonly avg: number;
  readonly max: number;
  /** min over average: 1 is even */
  readonly uniformity: number;
}

/** Lux at the centre of each cell of a grid: row 0 at the rectangle's y0 edge, each row from its x0 edge across. */
export interface LuxGrid {
  readonly cols: number;
  readonly rows: number;
  readonly lux: Float32Array;
  readonly stats: LuxStats;
}

/** A ray that doesn't reach the plane is drawn this far, mm (so a steep cone stays drawable). */
const FAR_MM = 60000;
/** past this angle from straight down a ray counts as not reaching a floor plane */
const STEEP_DEG = 85;
/** the integral of the beam's light over the sphere takes this many steps (Simpson's rule) */
const FLUX_STEPS = 2000;
/** a field angle no wider than the beam's is taken as this many times the beam's */
const FIELD_OVER_BEAM = 1.05;
/** the curve is cut off where it is below this share of the peak, when it's culled */
const NEGLIGIBLE = 1e-6;
/** the peak candela cache is cleared past this many entries */
const CACHE_MAX = 500;

/** An angle in radians, kept within the range the curve can hold. */
function radians(deg: number): number {
  return (Math.min(Math.max(deg, 0.5), 170) * Math.PI) / 180;
}

/** I/I0 = exp(-a·θ^p), with θ in radians. */
export interface Curve {
  readonly p: number;
  readonly a: number;
}

/** The curve through a beam angle (half the peak at half of it) and a field angle (a tenth at half of it), both full angles in degrees. */
export function curveOf(beamDeg: number, fieldDeg: number): Curve {
  const beam = radians(beamDeg);
  let field = radians(fieldDeg);
  if (field <= beam) field = beam * FIELD_OVER_BEAM;
  const p = Math.log(Math.log(10) / Math.LN2) / Math.log(field / beam);
  const a = Math.LN2 / Math.pow(beam / 2, p);
  return { p, a };
}

/** The intensity at `thetaDeg` off the axis as a share of the peak, 0 to 1. */
export function relativeIntensity(c: Curve, thetaDeg: number): number {
  const t = (Math.abs(thetaDeg) * Math.PI) / 180;
  return Math.exp(-c.a * Math.pow(t, c.p));
}

const peakCache = new Map<string, number>();

/** The candela on the axis for `lumens` in a beam of these angles: the curve's flux over the sphere, scaled to the lumens. */
export function peakCandela(lumens: number, beamDeg: number, fieldDeg: number): number {
  if (!(lumens > 0)) return 0;
  const key = `${lumens}|${beamDeg}|${fieldDeg}`;
  const hit = peakCache.get(key);
  if (hit !== undefined) return hit;
  const c = curveOf(beamDeg, fieldDeg);
  const h = Math.PI / FLUX_STEPS;
  let sum = 0;
  for (let i = 0; i <= FLUX_STEPS; i++) {
    const t = i * h;
    const w = i === 0 || i === FLUX_STEPS ? 1 : i % 2 ? 4 : 2;
    sum += w * Math.exp(-c.a * Math.pow(t, c.p)) * Math.sin(t);
  }
  const flux = 2 * Math.PI * ((sum * h) / 3);
  const i0 = lumens / flux;
  if (peakCache.size >= CACHE_MAX) peakCache.clear();
  peakCache.set(key, i0);
  return i0;
}

type Vec = Point3;

const unit = (v: Vec): Vec => {
  const n = Math.hypot(v.x, v.y, v.z);
  return n > 0 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: -1 };
};

const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** The beam's axis, from the lens to its focus; straight down when there's no focus (or it's at the lens). */
function axisOf(f: Photometric): Vec {
  const fp = f.focus;
  if (!fp) return { x: 0, y: 0, z: -1 };
  const v = { x: fp.x - f.at.x, y: fp.y - f.at.y, z: fp.z - f.heightMm };
  return Math.hypot(v.x, v.y, v.z) > 1 ? unit(v) : { x: 0, y: 0, z: -1 };
}

/** Two unit vectors across an axis, at right angles to it and to each other. */
function acrossAxis(u: Vec): [Vec, Vec] {
  const helper: Vec = Math.abs(u.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const e1 = unit(cross(u, helper));
  return [e1, cross(u, e1)];
}

/** What one instrument needs to light a point, worked out once. */
interface Source {
  readonly lens: Vec;
  readonly axis: Vec;
  readonly a: number;
  readonly p: number;
  readonly i0: number;
  /** cos of the angle past which the light is negligible; a point further off is skipped */
  readonly cosCut: number;
}

function sourceOf(f: Photometric): Source {
  const c = curveOf(f.beamDeg, f.fieldDeg);
  const i0 = peakCandela(f.lumens, f.beamDeg, f.fieldDeg);
  const thetaCut = Math.pow(Math.log(1 / NEGLIGIBLE) / c.a, 1 / c.p);
  return {
    lens: { x: f.at.x, y: f.at.y, z: f.heightMm },
    axis: axisOf(f),
    a: c.a,
    p: c.p,
    i0,
    cosCut: thetaCut < Math.PI ? Math.cos(thetaCut) : -2,
  };
}

/** Lux one source gives a point (0 above the lens, where the light doesn't fall). */
function luxFrom(s: Source, x: number, y: number, z: number): number {
  const down = s.lens.z - z;
  if (down <= 0 || s.i0 <= 0) return 0;
  const vx = x - s.lens.x;
  const vy = y - s.lens.y;
  const dist = Math.sqrt(vx * vx + vy * vy + down * down);
  if (dist < 1) return 0;
  const cosT = (s.axis.x * vx + s.axis.y * vy - s.axis.z * down) / dist;
  if (cosT < s.cosCut) return 0;
  const theta = Math.acos(Math.min(1, Math.max(-1, cosT)));
  const candela = s.i0 * Math.exp(-s.a * Math.pow(theta, s.p));
  const metres = dist / 1000;
  return (candela * (down / dist)) / (metres * metres);
}

/** Lux at a point from one instrument, times `level` (the channel's level, 0 to 1). Its beam aims at its focus, or straight down without one. */
export function illuminance(f: Photometric, point: Point3, level = 1): number {
  return luxFrom(sourceOf(f), point.x, point.y, point.z) * level;
}

/**
 * Lux at a point on a surface facing `normal` (a unit vector) from every instrument, each scaled by
 * `levelFor(channel)` and its gel's brightness: light from behind the surface doesn't count.
 */
export function luxOn(fixtures: readonly Photometric[], levelFor: (channel: string) => number, point: Point3, normal: Point3): number {
  let sum = 0;
  for (const f of fixtures) {
    const k = levelFor(f.channel) * gelBrightness(f.color);
    if (!(k > 0)) continue;
    const s = sourceOf(f);
    if (!(s.i0 > 0)) continue;
    const vx = point.x - s.lens.x;
    const vy = point.y - s.lens.y;
    const vz = point.z - s.lens.z;
    const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (dist < 1) continue;
    const cosT = (s.axis.x * vx + s.axis.y * vy + s.axis.z * vz) / dist;
    if (cosT < s.cosCut) continue;
    const facing = -(normal.x * vx + normal.y * vy + normal.z * vz) / dist;
    if (facing <= 0) continue;
    const theta = Math.acos(Math.min(1, Math.max(-1, cosT)));
    const metres = dist / 1000;
    sum += (k * s.i0 * Math.exp(-s.a * Math.pow(theta, s.p)) * facing) / (metres * metres);
  }
  return sum;
}

/**
 * The outline its beam (or field, by `coneDeg`, the full angle) cuts on the plane z = `zPlane`: `steps`
 * points round it. A ray that doesn't reach the plane (upward, or past 85° from straight down) runs to
 * a far point instead.
 */
export function poolOutline(f: Photometric, zPlane: number, coneDeg: number, steps = 64): Pt[] {
  const s = sourceOf(f);
  const [e1, e2] = acrossAxis(s.axis);
  const alpha = radians(coneDeg) / 2;
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const steepCos = Math.cos((STEEP_DEG * Math.PI) / 180);
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const psi = (2 * Math.PI * i) / steps;
    const c = Math.cos(psi);
    const sn = Math.sin(psi);
    const dx = ca * s.axis.x + sa * (c * e1.x + sn * e2.x);
    const dy = ca * s.axis.y + sa * (c * e1.y + sn * e2.y);
    const dz = ca * s.axis.z + sa * (c * e1.z + sn * e2.z);
    const reaches = dz < 0 && -dz >= steepCos;
    const t = reaches ? (zPlane - s.lens.z) / dz : 0;
    if (reaches && t > 0) out.push({ x: s.lens.x + t * dx, y: s.lens.y + t * dy });
    else out.push({ x: s.lens.x + FAR_MM * dx, y: s.lens.y + FAR_MM * dy });
  }
  return out;
}

/** Lens to focus, mm; with no focus, the lens to the focus plane straight below it. */
export function throwMm(f: Photometric): number {
  const fp = f.focus;
  if (!fp) return Math.max(0, f.heightMm - FOCUS_PLANE_MM);
  return Math.hypot(fp.x - f.at.x, fp.y - f.at.y, fp.z - f.heightMm);
}

/** The pool's diameter straight on at the focus, mm: 2 · throw · tan(cone / 2). */
export function poolSize(f: Photometric, coneDeg: number): number {
  return 2 * throwMm(f) * Math.tan(radians(coneDeg) / 2);
}

/** The light a gel or colour lets through, 0 to 1: the luminance of its colour (gels.ts). */
export function gelBrightness(color: string): number {
  const c = colorOf(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Min, average, max and min over average of a grid of lux. */
export function statsOf(lux: ArrayLike<number>): LuxStats {
  if (lux.length === 0) return { min: 0, avg: 0, max: 0, uniformity: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < lux.length; i++) {
    const v = lux[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const avg = sum / lux.length;
  return { min, avg, max, uniformity: avg > 0 ? min / avg : 0 };
}

/**
 * Lux on a grid of cells over `rect` at the plane `zPlane`: each cell's centre lit by every instrument,
 * scaled by `levelFor(channel)` and by the brightness of its gel. An instrument with no level or
 * no light is skipped.
 */
export function coverage(
  fixtures: readonly Photometric[],
  levelFor: (channel: string) => number,
  rect: Rect,
  cols: number,
  rows: number,
  zPlane: number,
): LuxGrid {
  const parts: { readonly source: Source; readonly k: number }[] = [];
  for (const f of fixtures) {
    const k = levelFor(f.channel) * gelBrightness(f.color);
    if (!(k > 0)) continue;
    const source = sourceOf(f);
    if (source.i0 > 0) parts.push({ source, k });
  }
  const lux = new Float32Array(cols * rows);
  const dx = (rect.x1 - rect.x0) / cols;
  const dy = (rect.y1 - rect.y0) / rows;
  for (let r = 0; r < rows; r++) {
    const y = rect.y0 + (r + 0.5) * dy;
    for (let c = 0; c < cols; c++) {
      const x = rect.x0 + (c + 0.5) * dx;
      let e = 0;
      for (const { source, k } of parts) e += k * luxFrom(source, x, y, zPlane);
      lux[r * cols + c] = e;
    }
  }
  return { cols, rows, lux, stats: statsOf(lux) };
}
