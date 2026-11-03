// A vegetation line's cloud, as AEC > Plants > Vegetation Line draws it round a massed planting.
// Kept apart from the command so it runs without the page. Sizes are in mm.

import type { Pt } from "../core/index.ts";
import { signedArea } from "./geom.ts";

export interface VegetationCloud {
  /** each arc's smallest and largest radius */
  readonly minRadius: number;
  readonly maxRadius: number;
  /** how far an arc rises, as a share of its radius: 1 is a half circle */
  readonly billow: number;
}

/** points of an arc (its end is the next arc's start) */
const ARC_STEPS = 8;
/** a cloud's arcs at most, so tiny arcs round a great mass can't flood the drawing */
const MAX_ARCS = 4000;

/** The same arcs for the same outline each time, so a redo or a neighbour's copy matches. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A radius' arc's chord, for its billow. */
const chordOf = (r: number, billow: number): number => 2 * r * Math.sqrt(Math.max(0, 2 * billow - billow * billow));

/** The point `along` the ring, from its start. */
function pointOn(ring: readonly Pt[], stations: readonly number[], along: number): Pt {
  let lo = 0;
  let hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid] <= along) lo = mid;
    else hi = mid;
  }
  const a = ring[lo];
  const b = ring[(lo + 1) % ring.length];
  const span = stations[lo + 1] - stations[lo];
  const k = span > 0 ? (along - stations[lo]) / span : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** A closed outline of outward arcs along `outline`; null when its sizes or outline don't make one. */
export function vegetationCloud(outline: readonly Pt[], c: VegetationCloud): Pt[] | null {
  const area = signedArea(outline);
  if (!(Math.abs(area) > 0) || !(c.minRadius > 0) || c.maxRadius < c.minRadius || !(c.billow > 0) || c.billow > 1) return null;
  // counter-clockwise, so outwards is to the right of the way round
  const ring = area > 0 ? outline : [...outline].reverse();
  const stations = [0];
  for (let i = 0; i < ring.length; i++) {
    const b = ring[(i + 1) % ring.length];
    stations.push(stations[i] + Math.hypot(b.x - ring[i].x, b.y - ring[i].y));
  }
  const total = stations[stations.length - 1];
  const next = sequence(ring.length);
  const radius = (): number => c.minRadius + (c.maxRadius - c.minRadius) * next();
  const radii: number[] = [];
  let walked = 0;
  while (walked < total && radii.length < MAX_ARCS) {
    const r = radius();
    radii.push(r);
    walked += chordOf(r, c.billow);
  }
  if (radii.length < 3) return null;
  // the arcs share out the ring's length exactly, so the last meets the first
  const stretch = total / walked;
  const out: Pt[] = [];
  let along = 0;
  for (const r of radii) {
    const span = chordOf(r, c.billow) * stretch;
    const p = pointOn(ring, stations, along);
    const q = pointOn(ring, stations, Math.min(total - 1e-9, along + span));
    along += span;
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    if (chord === 0) continue;
    const u = { x: (q.x - p.x) / chord, y: (q.y - p.y) / chord };
    const n = { x: u.y, y: -u.x };
    // an arc over this chord at its billow's shape, whatever a corner has cut the chord to
    const rise = (chord / 2) * (c.billow / Math.sqrt(2 * c.billow - c.billow * c.billow));
    const R = (chord * chord) / 8 / rise + rise / 2;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const centre = { x: mid.x - n.x * (R - rise), y: mid.y - n.y * (R - rise) };
    const half = Math.asin(Math.min(1, chord / 2 / R));
    for (let i = 0; i < ARC_STEPS; i++) {
      const phi = -half + (2 * half * i) / ARC_STEPS;
      out.push({ x: centre.x + R * (Math.cos(phi) * n.x + Math.sin(phi) * u.x), y: centre.y + R * (Math.cos(phi) * n.y + Math.sin(phi) * u.y) });
    }
  }
  return out.length >= 3 ? out : null;
}
