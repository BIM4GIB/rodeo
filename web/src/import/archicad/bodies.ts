// Shapes an Archicad import builds for itself, in Rodeo's terms (mm, z up, absolute z): plan
// contours with their arced edges turned into points, and 3D bodies as faces (flat corner lists,
// x, y, z triples) for building.ts to hand to import/building.ts. Archicad keeps an element's
// parameters, not its 3D model, so walls that aren't plain, roofs, terrain meshes, beams, columns
// and curtain wall parts are built here from what the element stores; doors, windows and objects,
// whose shapes are GDL scripts, get the box of their sizes.

import earcut from "earcut";
import type { Pt } from "../../core/types.ts";

export type Vec = readonly [number, number, number];

/** Degrees an arc's chord may turn through before it is split. */
const ARC_STEP = (10 * Math.PI) / 180;

/** The points strictly between `a` and `b` on the arc from `a` to `b` turning `angle` (radians, positive counter-clockwise). */
export function arcBetween(a: Pt, b: Pt, angle: number): Pt[] {
  if (!angle || !Number.isFinite(angle)) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [];
  // the centre sits on the chord's left for a counter-clockwise arc
  const d = chord / 2 / Math.tan(angle / 2);
  const cx = (a.x + b.x) / 2 - (dy / chord) * d;
  const cy = (a.y + b.y) / 2 + (dx / chord) * d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(angle) / ARC_STEP));
  const out: Pt[] = [];
  for (let k = 1; k < n; k++) {
    const t = a0 + (angle * k) / n;
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/** A closed contour with the edges `arcs` gives (edge k runs from point k to the next) turned into points; no repeated closing point. */
export function contourWithArcs(points: readonly Pt[], arcs: ReadonlyMap<number, number>): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < points.length; k++) {
    out.push(points[k]);
    const angle = arcs.get(k);
    if (angle) out.push(...arcBetween(points[k], points[(k + 1) % points.length], angle));
  }
  return out;
}

/** Twice the signed area: positive counter-clockwise. */
export function area2(ring: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s;
}

/** `ring` without repeated neighbours or a closing point that repeats the first. */
export function cleanRing(ring: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const q = out.at(-1);
    if (!q || Math.abs(q.x - p.x) > 1e-6 || Math.abs(q.y - p.y) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0].x - out.at(-1)!.x) < 1e-6 && Math.abs(out[0].y - out.at(-1)!.y) < 1e-6) out.pop();
  return out;
}

/**
 * One closed outline that runs into each hole and back along a seam, so a shape with holes fills
 * as one polygon (a 2D polygon has no holes of its own).
 */
export function keyhole(outline: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt[] {
  let ring = [...outline];
  for (const hole of holes) {
    if (hole.length < 3) continue;
    // the seam joins the hole's leftmost point to the outline's nearest point
    let h = 0;
    for (let k = 1; k < hole.length; k++) if (hole[k].x < hole[h].x) h = k;
    let o = 0;
    let best = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const d = (ring[k].x - hole[h].x) ** 2 + (ring[k].y - hole[h].y) ** 2;
      if (d < best) [best, o] = [d, k];
    }
    const around = [...hole.slice(h), ...hole.slice(0, h), hole[h]];
    ring = [...ring.slice(0, o + 1), ...around, ...ring.slice(o)];
  }
  return ring;
}

/**
 * A slab of the plan shape `outline` less `holes` between two surfaces: its underside at
 * `bottom(x, y)` and its top at `top(x, y)` (both planes, or flat).
 */
export function prismFaces(outline: readonly Pt[], holes: readonly (readonly Pt[])[], bottom: (p: Pt) => number, top: (p: Pt) => number): number[][] {
  const out = cleanRing(outline);
  if (out.length < 3) return [];
  const rings = [area2(out) < 0 ? out.reverse() : out, ...holes.map(cleanRing).filter((r) => r.length >= 3).map((r) => (area2(r) > 0 ? r.reverse() : r))];
  const flat: number[] = [];
  const starts: number[] = [];
  const pts: Pt[] = [];
  for (const [k, r] of rings.entries()) {
    if (k) starts.push(pts.length);
    for (const p of r) {
      flat.push(p.x, p.y);
      pts.push(p);
    }
  }
  const faces: number[][] = [];
  const tri = earcut(flat, starts.length ? starts : null, 2);
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [pts[tri[i]], pts[tri[i + 1]], pts[tri[i + 2]]];
    faces.push([a.x, a.y, top(a), b.x, b.y, top(b), c.x, c.y, top(c)]);
    faces.push([a.x, a.y, bottom(a), c.x, c.y, bottom(c), b.x, b.y, bottom(b)]);
  }
  for (const r of rings)
    for (let k = 0; k < r.length; k++) {
      const [a, b] = [r[k], r[(k + 1) % r.length]];
      faces.push([a.x, a.y, bottom(a), b.x, b.y, bottom(b), b.x, b.y, top(b), a.x, a.y, top(a)]);
    }
  return faces;
}

/** A flat prism between two heights. */
export function flatPrism(outline: readonly Pt[], holes: readonly (readonly Pt[])[], z0: number, z1: number): number[][] {
  return prismFaces(
    outline,
    holes,
    () => Math.min(z0, z1),
    () => Math.max(z0, z1),
  );
}

/**
 * A terrain mesh: its top through the outline's and the inner points' heights, triangulated with
 * the inner points as vertices, a flat underside at `floor`, and sides down to it.
 */
export function terrainFaces(outline: readonly (readonly Vec[])[], inner: readonly Vec[], floor: number): number[][] {
  const rings = outline.map((r) => {
    const ring = r.filter((p, k) => k === 0 || Math.abs(p[0] - r[k - 1][0]) > 1e-6 || Math.abs(p[1] - r[k - 1][1]) > 1e-6);
    while (ring.length > 1 && Math.abs(ring[0][0] - ring.at(-1)![0]) < 1e-6 && Math.abs(ring[0][1] - ring.at(-1)![1]) < 1e-6) ring.pop();
    return ring;
  });
  if (!rings[0] || rings[0].length < 3) return [];
  const flat: number[] = [];
  const starts: number[] = [];
  const zs: number[] = [];
  const add = (p: Vec): void => {
    flat.push(p[0], p[1]);
    zs.push(p[2]);
  };
  for (const [k, r] of rings.entries()) {
    if (r.length < 3) continue;
    if (k) starts.push(zs.length);
    r.forEach(add);
  }
  // a hole of one point is a vertex inside the triangulation
  for (const p of inner) {
    starts.push(zs.length);
    add(p);
  }
  const faces: number[][] = [];
  const tri = earcut(flat, starts.length ? starts : null, 2);
  const at = (i: number): number[] => [flat[2 * i], flat[2 * i + 1], zs[i]];
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [at(tri[i]), at(tri[i + 1]), at(tri[i + 2])];
    // counter-clockwise from above
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    faces.push(ccw ? [...a, ...b, ...c] : [...a, ...c, ...b]);
    faces.push(ccw ? [a[0], a[1], floor, c[0], c[1], floor, b[0], b[1], floor] : [a[0], a[1], floor, b[0], b[1], floor, c[0], c[1], floor]);
  }
  for (const r of rings)
    for (let k = 0; k < r.length; k++) {
      const [a, b] = [r[k], r[(k + 1) % r.length]];
      faces.push([a[0], a[1], floor, b[0], b[1], floor, b[0], b[1], b[2], a[0], a[1], a[2]]);
    }
  return faces;
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec): Vec => {
  const l = length(a);
  return l ? scale(a, 1 / l) : [0, 0, 0];
};

/**
 * A box from the corner `o` along the edges `u`, `v` and `w` (any lengths, not necessarily square
 * to each other): six four-cornered faces.
 */
export function boxFaces(o: Vec, u: Vec, v: Vec, w: Vec): number[][] {
  const p = (a: number, b: number, c: number): Vec => add3(add3(add3(o, scale(u, a)), scale(v, b)), scale(w, c));
  const q = (...c: Vec[]): number[] => c.flatMap((x) => [...x]);
  // the corners counter-clockwise seen from outside when u, v, w are right-handed
  const faces = [
    q(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)),
    q(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),
    q(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)),
    q(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)),
    q(p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)),
    q(p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)),
  ];
  const det = cross(u, v)[0] * w[0] + cross(u, v)[1] * w[1] + cross(u, v)[2] * w[2];
  return det < 0 ? faces.map(reverseFace) : faces;
}

/** A face's corners the other way round. */
export function reverseFace(f: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = f.length - 3; i >= 0; i -= 3) out.push(f[i], f[i + 1], f[i + 2]);
  return out;
}

/** A plan-axis frame for a member from `a` to `b`: `side` is horizontal across it, `up` square to it in its vertical plane. */
function memberFrame(a: Vec, b: Vec): { along: Vec; side: Vec; up: Vec } {
  const along = unit(sub(b, a));
  const vertical = Math.abs(along[2]) > 0.999;
  // a vertical member's sides follow the plan axes
  const side = vertical ? ([1, 0, 0] as Vec) : unit(cross([0, 0, 1], along));
  const up = unit(cross(along, side));
  return { along, side, up };
}

/** A member of rectangular section `width` (across) × `depth` (up) whose section centre runs from `a` to `b`; `turn` turns the section about the member's axis (radians). */
export function memberBox(a: Vec, b: Vec, width: number, depth: number, turn = 0): number[][] {
  const f = memberFrame(a, b);
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const side = add3(scale(f.side, c), scale(f.up, s));
  const up = add3(scale(f.up, c), scale(f.side, -s));
  const o = add3(add3(a, scale(side, -width / 2)), scale(up, -depth / 2));
  return boxFaces(o, sub(b, a), scale(side, width), scale(up, depth));
}

/**
 * A member of any section along `from` → `to`: `outline` less `holes` in the section's own plane
 * (x across the member, y up it, mm about the axis), turned by `turn` about the axis.
 */
export function memberSection(from: Vec, to: Vec, outline: readonly Pt[], holes: readonly (readonly Pt[])[], turn = 0): number[][] {
  const f = memberFrame(from, to);
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const side = add3(scale(f.side, c), scale(f.up, s));
  const up = add3(scale(f.up, c), scale(f.side, -s));
  const along = sub(to, from);
  const at = (p: Pt, end: number): number[] => [...add3(add3(add3(from, scale(along, end)), scale(side, p.x)), scale(up, p.y))];
  const out = cleanRing(outline);
  if (out.length < 3) return [];
  const rings = [area2(out) < 0 ? out.reverse() : out, ...holes.map(cleanRing).filter((r) => r.length >= 3).map((r) => (area2(r) > 0 ? r.reverse() : r))];
  const flat: number[] = [];
  const starts: number[] = [];
  const pts: Pt[] = [];
  for (const [k, r] of rings.entries()) {
    if (k) starts.push(pts.length);
    for (const p of r) {
      flat.push(p.x, p.y);
      pts.push(p);
    }
  }
  const faces: number[][] = [];
  const tri = earcut(flat, starts.length ? starts : null, 2);
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, d] = [pts[tri[i]], pts[tri[i + 1]], pts[tri[i + 2]]];
    faces.push([...at(a, 1), ...at(b, 1), ...at(d, 1)]);
    faces.push([...at(a, 0), ...at(d, 0), ...at(b, 0)]);
  }
  for (const r of rings)
    for (let k = 0; k < r.length; k++) {
      const [a, b] = [r[k], r[(k + 1) % r.length]];
      faces.push([...at(a, 0), ...at(b, 0), ...at(b, 1), ...at(a, 1)]);
    }
  return faces;
}

/** A round member of `diameter` whose axis runs from `a` to `b`, as a prism of `sides` sides. */
export function memberCylinder(a: Vec, b: Vec, diameter: number, sides = 16): number[][] {
  const f = memberFrame(a, b);
  const r = diameter / 2;
  const ring = (c: Vec): Vec[] => Array.from({ length: sides }, (_, k) => add3(c, add3(scale(f.side, r * Math.cos((2 * Math.PI * k) / sides)), scale(f.up, r * Math.sin((2 * Math.PI * k) / sides)))));
  const [ra, rb] = [ring(a), ring(b)];
  const faces: number[][] = [ra.slice().reverse().flatMap((p) => [...p]), rb.flatMap((p) => [...p])];
  for (let k = 0; k < sides; k++) {
    const j = (k + 1) % sides;
    faces.push([...ra[k], ...ra[j], ...rb[j], ...rb[k]]);
  }
  // the end caps' corners run with the member's axis: flip all when the frame is left-handed
  return faces;
}

/** A flat face with its two sides (a curtain wall panel, a glass pane). */
export function sheetFaces(corners: readonly Vec[]): number[][] {
  const f = corners.flatMap((p) => [...p]);
  return [f, reverseFace(f)];
}

/** Rotates a plan point about the origin. */
export function turn(p: Pt, angle: number): Pt {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
