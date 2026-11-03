// Solids for the tool sets' "- 3D" tools, as the faces a mesh takes (each a flat list of x, y, z):
// a shape turned about the z axis, optionally cut down to a plan outline (a hex head), a prism, a
// section swept along a 3D path or screwed up an axis, and the turns that lay them down or stand
// them on the layer. Kept apart from the tools so it runs without the page.

import earcut from "earcut";
import type { Pt } from "../core/index.ts";

/** A mesh's faces, each corner's x, y and z in turn, wound anticlockwise seen from outside. */
export type Solid = number[][];
export type Point3 = readonly [number, number, number];

/** how many facets a full turn takes */
const TURN = 48;
const NEAR_AXIS = 1e-9;

/**
 * What of a closed outline lies on one side of its axis, as a profile: x its distance from the axis
 * and y its place along it. A drawing's axis is its x or y axis; along x, the outline's low end comes
 * out on top, so a pin drawn from its head rightwards stands head up with its other end at 0.
 */
export function axisProfile(outline: readonly Pt[], axis: "x" | "y"): Pt[] {
  const top = axis === "x" ? Math.max(...outline.map((p) => p.x)) : 0;
  return clipped(axis === "x" ? outline.map((p) => ({ x: p.y, y: top - p.x })) : outline);
}

/**
 * What of a closed outline in a section cut along the drawing's x axis lies below that axis, as a
 * profile: x its distance from the axis and y its place along it. Below, since sections draw any
 * keyway above.
 */
export function sectionProfile(outline: readonly Pt[]): Pt[] {
  return clipped(outline.map((p) => ({ x: -p.y, y: p.x })));
}

/** What of a closed outline has x at or past 0, closed along x = 0. */
function clipped(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    if (p.x >= 0) out.push(p);
    if ((p.x > 0 && q.x < 0) || (p.x < 0 && q.x > 0)) {
      const t = p.x / (p.x - q.x);
      out.push({ x: 0, y: p.y + (q.y - p.y) * t });
    }
  });
  return out;
}

/** What of a closed outline keeps `side` (a straight-line function of a point) at or above 0. */
export function clipOutline(outline: readonly Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length];
    const [a, b] = [side(p), side(q)];
    if (a >= 0) out.push(p);
    if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const t = a / (a - b);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  });
  return out;
}

/** Twice a closed outline's area, positive when it runs anticlockwise. */
function area2(pts: readonly Pt[]): number {
  return pts.reduce((a, p, i) => {
    const q = pts[(i + 1) % pts.length];
    return a + p.x * q.y - q.x * p.y;
  }, 0);
}

/** How far a ray at angle `t` from the origin runs inside a convex outline round the origin. */
function reachOf(plan: readonly Pt[], t: number): number {
  const [c, s] = [Math.cos(t), Math.sin(t)];
  let best = Infinity;
  plan.forEach((a, i) => {
    const b = plan[(i + 1) % plan.length];
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    const det = c * ey - s * ex;
    if (Math.abs(det) < 1e-12) return;
    const along = (a.x * ey - a.y * ex) / det;
    if (along > 0) best = Math.min(best, along);
  });
  return best;
}

/**
 * A closed profile (x from the axis, y up it) turned once about z. With a convex `plan` round the
 * origin, every point keeps within it, so a turned head with a hexagon for its plan is a chamfered
 * hex head, with its plan's corners among the facets' edges.
 */
export function lathe(profile: readonly Pt[], plan?: readonly Pt[]): Solid {
  const loop = area2(profile) < 0 ? [...profile].reverse() : profile;
  const even = Array.from({ length: TURN }, (_, i) => (i * 2 * Math.PI) / TURN);
  const corners = (plan ?? []).map((p) => (Math.atan2(p.y, p.x) + 2 * Math.PI) % (2 * Math.PI));
  const angles = [...even.filter((t) => !corners.some((c) => Math.abs(c - t) < 1e-9)), ...corners].sort((a, b) => a - b);
  const rings = angles.map((t) => ({ c: Math.cos(t), s: Math.sin(t), reach: plan ? reachOf(plan, t) : Infinity }));
  const faces: Solid = [];
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length];
    if (a.x <= NEAR_AXIS && b.x <= NEAR_AXIS) return;
    if (a.x === b.x && a.y === b.y) return;
    rings.forEach((r0, j) => {
      const r1 = rings[(j + 1) % rings.length];
      const at = (p: Pt, r: typeof r0): number[] => {
        const d = Math.min(p.x, r.reach);
        return [d * r.c, d * r.s, p.y];
      };
      if (a.x <= NEAR_AXIS) faces.push([...at(a, r0), ...at(b, r1), ...at(b, r0)]);
      else if (b.x <= NEAR_AXIS) faces.push([...at(a, r0), ...at(a, r1), ...at(b, r0)]);
      else faces.push([...at(a, r0), ...at(a, r1), ...at(b, r1), ...at(b, r0)]);
    });
  });
  return faces;
}

/** A profile from a closed outline's half with a through hole of radius `bore` down its axis. */
export function bored(profile: readonly Pt[], bore: number): Pt[] {
  return profile.map((p) => ({ x: Math.max(p.x, bore), y: p.y }));
}

/** A circle as a closed outline. */
export function circleOutline(center: Pt, radius: number, sides = TURN): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const t = (i * 2 * Math.PI) / sides;
    return { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) };
  });
}

/**
 * A polygon's prism of `sides` sides `flats` across, axis up from y0 to y1, for a nut or a head: its
 * end faces chamfered to a circle 0.95 of the flats as asked.
 */
export function polygonBody(sides: number, flats: number, y0: number, y1: number, chamferLow: boolean, chamferHigh: boolean): Solid {
  const G = flats / Math.cos(Math.PI / sides);
  const inner = (0.95 * flats) / 2;
  const c = Math.min((G / 2 - inner) * Math.tan(Math.PI / 6), (y1 - y0) / 2);
  const turn = sides === 4 ? Math.PI / 4 : 0;
  const plan = Array.from({ length: sides }, (_, i) => ({ x: (G / 2) * Math.cos((i * 2 * Math.PI) / sides + turn), y: (G / 2) * Math.sin((i * 2 * Math.PI) / sides + turn) }));
  const low = chamferLow ? [{ x: inner, y: y0 }, { x: G / 2, y: y0 + c }] : [{ x: G / 2, y: y0 }];
  const high = chamferHigh ? [{ x: G / 2, y: y1 - c }, { x: inner, y: y1 }] : [{ x: G / 2, y: y1 }];
  return lathe([{ x: 0, y: y0 }, ...low, ...high, { x: 0, y: y1 }], plan);
}

/** A section's outlines, each that has area below the drawing's x axis turned about that axis as the z axis. */
export function turnedSection(outlines: readonly (readonly Pt[])[]): Solid {
  return outlines
    .map(sectionProfile)
    .filter((profile) => Math.abs(area2(profile)) > NEAR_AXIS)
    .flatMap((profile) => lathe(profile));
}

/** An outline with holes, from z0 to z1. Each outline is closed; the first is the outside. */
export function prism(outlines: readonly (readonly Pt[])[], z0: number, z1: number): Solid {
  const rings = outlines.map((o, i) => (area2(o) < 0 === (i === 0) ? [...o].reverse() : [...o]));
  const flat = rings.flat();
  const holes: number[] = [];
  let count = 0;
  rings.forEach((r, i) => {
    if (i > 0) holes.push(count);
    count += r.length;
  });
  const faces: Solid = [];
  const tris = earcut(
    flat.flatMap((p) => [p.x, p.y]),
    holes.length ? holes : null,
    2,
  );
  for (let i = 0; i + 2 < tris.length; i += 3) {
    let [a, b, c] = [flat[tris[i]], flat[tris[i + 1]], flat[tris[i + 2]]];
    if (area2([a, b, c]) < 0) [b, c] = [c, b];
    faces.push([a.x, a.y, z1, b.x, b.y, z1, c.x, c.y, z1], [a.x, a.y, z0, c.x, c.y, z0, b.x, b.y, z0]);
  }
  for (const r of rings) {
    r.forEach((a, i) => {
      const b = r[(i + 1) % r.length];
      faces.push([a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1, a.x, a.y, z1]);
    });
  }
  return faces;
}

const minus = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Point3): Point3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/**
 * A closed section (anticlockwise, x and y across the path) along a path of 3D points, its ends
 * closed or, with `closed`, joined. Its x stays square to `up` where one is given (a helix's axis,
 * so a rectangular wire keeps its faces to it); else its frame is carried along so it doesn't twist.
 */
export function sweep(path: readonly Point3[], section: readonly Pt[], closed = false, up?: Point3): Solid {
  const n = path.length;
  const sides = section.length;
  const dirAt = (i: number): Point3 => unit(closed ? minus(path[(i + 1) % n], path[(i + n - 1) % n]) : minus(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]));
  const first = dirAt(0);
  let side = unit(cross(first, Math.abs(first[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const rings = path.map((p, i) => {
    const d = dirAt(i);
    if (up) side = unit(cross(d, up));
    else {
      const k = dot(side, d);
      side = unit([side[0] - k * d[0], side[1] - k * d[1], side[2] - k * d[2]]);
    }
    const across = cross(d, side);
    return section.map(({ x, y }): Point3 => [p[0] + x * side[0] + y * across[0], p[1] + x * side[1] + y * across[1], p[2] + x * side[2] + y * across[2]]);
  });
  const faces: Solid = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [r0, r1] = [rings[i], rings[(i + 1) % n]];
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      faces.push([...r0[j], ...r0[k], ...r1[k], ...r1[j]]);
    }
  }
  if (!closed) faces.push([...rings[0]].reverse().flat(), rings[n - 1].flat());
  return faces;
}

/** Skins rings of the same number of points, each anticlockwise seen looking back along the way they run, closing both ends. */
export function loft(rings: readonly (readonly Point3[])[]): Solid {
  const faces: Solid = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const [r0, r1] = [rings[i], rings[i + 1]];
    for (let j = 0; j < r0.length; j++) {
      const k = (j + 1) % r0.length;
      faces.push([...r0[j], ...r0[k], ...r1[k], ...r1[j]]);
    }
  }
  faces.push([...rings[0]].reverse().flat(), rings[rings.length - 1].flat());
  return faces;
}

/** A round tube of `radius` along a path of 3D points. */
export function tube(path: readonly Point3[], radius: number, closed = false, sides = 12): Solid {
  return sweep(path, circleOutline({ x: 0, y: 0 }, radius, sides), closed);
}

/** A closed section (x from the axis, y up it) screwed up the z axis, `lead` a turn for `turns` turns, a right-hand thread. */
export function helical(section: readonly Pt[], lead: number, turns: number): Solid {
  const loop = area2(section) < 0 ? [...section].reverse() : section;
  const steps = Math.max(2, Math.ceil(turns * TURN));
  const at = (p: Pt, i: number): number[] => {
    const t = (i / steps) * turns * 2 * Math.PI;
    return [p.x * Math.cos(t), p.x * Math.sin(t), p.y + (lead * t) / (2 * Math.PI)];
  };
  const faces: Solid = [loop.flatMap((p) => at(p, 0)), [...loop].reverse().flatMap((p) => at(p, steps))];
  for (let i = 0; i < steps; i++) {
    loop.forEach((a, j) => {
      const b = loop[(j + 1) % loop.length];
      faces.push([...at(a, i), ...at(a, i + 1), ...at(b, i + 1), ...at(b, i)]);
    });
  }
  return faces;
}

/** The solid moved by `f`, corner by corner. */
export function mapSolid(solid: Solid, f: (p: Point3) => Point3): Solid {
  return solid.map((face) => {
    const out: number[] = [];
    for (let i = 0; i + 2 < face.length; i += 3) out.push(...f([face[i], face[i + 1], face[i + 2]]));
    return out;
  });
}

/** The solid turned about z by `angle` radians with its origin moved to `at`. */
export function placedSolid(solid: Solid, at: Pt, angle: number): Solid {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return mapSolid(solid, ([x, y, z]) => [at.x + c * x - s * y, at.y + s * x + c * y, z]);
}

/** The solid laid down: its z axis along x, its x along y, its y up. */
export function lying(solid: Solid): Solid {
  return mapSolid(solid, ([x, y, z]) => [z, x, y]);
}

/** The solid stood on edge: its y up and its z toward -y, so a prism of a front view runs back from the view. */
export function onEdge(solid: Solid): Solid {
  return mapSolid(solid, ([x, y, z]) => [x, -z, y]);
}

/** The solid raised or lowered so its lowest point is on the layer. */
export function onLayer(solid: Solid): Solid {
  let low = Infinity;
  for (const face of solid) for (let i = 2; i < face.length; i += 3) low = Math.min(low, face[i]);
  return mapSolid(solid, ([x, y, z]) => [x, y, z - low]);
}
