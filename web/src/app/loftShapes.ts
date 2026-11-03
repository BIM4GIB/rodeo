// The sums behind the 3D Modeling set's Loft Surface: rings of points made from cross sections, with no
// rail, one rail or two, and the faces between them. A section's vertices are kept: every section is
// measured along its length at the share where any section has a vertex, so all have the same number of
// points and none loses a corner. World mm, z up. Kept apart from the page so a check can run it.

export type Point3 = readonly [number, number, number];

export interface LoftCurve {
  readonly points: readonly Point3[];
  readonly closed: boolean;
}

export interface LoftOptions {
  /** straight between sections, not a curve through them */
  readonly ruled: boolean;
  /** the last section runs on into the first */
  readonly closed: boolean;
  /** caps on the first and last section, when they're closed and the loft isn't */
  readonly solid: boolean;
}

/** rings between two sections, for a curve through them */
const BETWEEN = 8;
/** the most points to a ring */
const MAX_RING = 400;

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Point3, k: number): Point3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Point3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Point3): Point3 => {
  const n = length(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
};

/** The curve's points with those saying the same thing dropped. */
function cleaned(c: LoftCurve): Point3[] {
  const out: Point3[] = [];
  for (const p of c.points) if (!out.length || length(sub(p, out[out.length - 1])) > 1e-6) out.push(p);
  if (c.closed && out.length > 1 && length(sub(out[0], out[out.length - 1])) <= 1e-6) out.pop();
  return out;
}

/** The share of the curve's length each of its vertices is at, and the whole length. */
function shares(points: readonly Point3[], closed: boolean): { at: number[]; total: number } {
  const at = [0];
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    run += length(sub(points[i], points[i - 1]));
    at.push(run);
  }
  const total = closed ? run + length(sub(points[0], points[points.length - 1])) : run;
  return { at: at.map((v) => (total > 0 ? v / total : 0)), total };
}

/** The point at this share of the curve's length. */
function pointAt(points: readonly Point3[], closed: boolean, at: readonly number[], t: number): Point3 {
  const n = points.length;
  const list = closed ? [...at, 1] : at;
  let i = 0;
  while (i + 2 < list.length && list[i + 1] < t) i++;
  const [a, b] = [points[i % n], points[(i + 1) % n]];
  const span = list[i + 1] - list[i];
  const u = span > 0 ? Math.min(1, Math.max(0, (t - list[i]) / span)) : 0;
  return add(a, scale(sub(b, a), u));
}

/** The curves measured at the same shares, each with as many points. */
function matched(curves: readonly LoftCurve[]): Point3[][] {
  const data = curves.map((c) => {
    const points = cleaned(c);
    return { points, closed: c.closed, ...shares(points, c.closed) };
  });
  const all = [...new Set(data.flatMap((d) => d.at))].sort((a, b) => a - b);
  // shares closer than this are one, so many sections don't make a ring too long to use
  const gap = 1 / MAX_RING;
  const params: number[] = [];
  for (const t of all) if (!params.length || t - params[params.length - 1] >= gap) params.push(t);
  if (curves.every((c) => !c.closed) && params[params.length - 1] < 1) params.push(1);
  return data.map((d) => params.map((t) => pointAt(d.points, d.closed, d.at, t)));
}

/** The curve as it's to be lofted: turned to run the other way, and starting a share of the way along it. */
export function aligned(c: LoftCurve, reverse: boolean, startShare: number): LoftCurve {
  let points = cleaned(c);
  if (reverse) {
    // a closed curve keeps its start; an open one starts at its other end
    points = c.closed ? [points[0], ...points.slice(1).reverse()] : [...points].reverse();
  }
  if (!c.closed || startShare <= 0 || points.length < 2) return { points, closed: c.closed };
  const { at } = shares(points, true);
  const t = startShare % 1;
  // at a vertex, if one's that close; else a new point there
  const near = at.findIndex((v) => Math.abs(v - t) < 1e-4);
  if (near >= 0) return { points: [...points.slice(near), ...points.slice(0, near)], closed: true };
  const after = at.findIndex((v) => v > t);
  const k = after < 0 ? points.length : after;
  const start = pointAt(points, true, at, t);
  return { points: [start, ...points.slice(k), ...points.slice(0, k)], closed: true };
}

/** A closed curve's direction, by the area it turns round. */
function turning(points: readonly Point3[]): Point3 {
  let n: Point3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) n = add(n, cross(points[i], points[(i + 1) % points.length]));
  return n;
}

/** Why these curves can't be lofted together, or null. */
export function loftProblem(curves: readonly LoftCurve[]): string | null {
  if (curves.some((c) => cleaned(c).length < 2)) return "One of those curves has no length.";
  if (curves.some((c) => c.closed !== curves[0].closed)) return "The cross sections must be all closed or all open, not a mixture of the two.";
  return null;
}

/** The curves in order, each closed one running the same way round as the first. */
function sameWay(curves: readonly LoftCurve[]): LoftCurve[] {
  const first = curves[0].closed ? turning(cleaned(curves[0])) : null;
  return curves.map((c, i) => {
    if (i === 0 || !first || dot(turning(cleaned(c)), first) >= 0) return c;
    const p = cleaned(c);
    return { points: [p[0], ...p.slice(1).reverse()], closed: true };
  });
}

/** A smooth curve through a and b, with the points beside them setting how it leaves and arrives (Catmull-Rom). */
function through(p0: Point3, a: Point3, b: Point3, p3: Point3, t: number): Point3 {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(0.5 * (2 * a[i] + (b[i] - p0[i]) * t + (2 * p0[i] - 5 * a[i] + 4 * b[i] - p3[i]) * t * t + (3 * a[i] - p0[i] - 3 * b[i] + p3[i]) * t * t * t));
  }
  return out as unknown as Point3;
}

/** The rings of a loft through the sections, with no rail. */
export function loftRings(curves: readonly LoftCurve[], o: LoftOptions): Point3[][] {
  const rings = matched(sameWay(curves));
  const n = rings.length;
  // two sections have nothing to bend them, unless closed into a loop
  if (o.ruled || (n < 3 && !o.closed)) return o.closed ? [...rings, rings[0]] : rings;
  const out: Point3[][] = [];
  const at = (i: number): Point3[] => (o.closed ? rings[(i + n) % n] : rings[Math.max(0, Math.min(n - 1, i))]);
  const spans = o.closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    for (let k = 0; k < BETWEEN; k++) {
      const t = k / BETWEEN;
      out.push(at(i).map((_, j) => through(at(i - 1)[j], at(i)[j], at(i + 1)[j], at(i + 2)[j], t)));
    }
  }
  out.push(o.closed ? out[0] : rings[n - 1]);
  return out;
}

interface Frame {
  readonly at: Point3;
  readonly x: Point3;
  readonly y: Point3;
  readonly z: Point3;
}

/** The rail's frames at its points, z along it, turned as little as possible from one to the next. */
function railFrames(points: readonly Point3[]): Frame[] {
  const tangent = (i: number): Point3 => unit(sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]));
  const z0 = tangent(0);
  const seed: Point3 = Math.abs(z0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let x = unit(cross(seed, z0));
  return points.map((at, i) => {
    const z = tangent(i);
    x = unit(sub(x, scale(z, dot(x, z))));
    return { at, x, y: cross(z, x), z };
  });
}

const toFrame = (f: Frame, p: Point3): Point3 => {
  const d = sub(p, f.at);
  return [dot(d, f.x), dot(d, f.y), dot(d, f.z)];
};
const fromFrame = (f: Frame, q: Point3): Point3 => add(add(add(f.at, scale(f.x, q[0])), scale(f.y, q[1])), scale(f.z, q[2]));

/** The rail's points, with its long sides in pieces no longer than a share of its length. */
function divided(rail: LoftCurve): Point3[] {
  const points = cleaned(rail);
  const list = rail.closed ? [...points, points[0]] : points;
  const total = list.slice(1).reduce((sum, p, i) => sum + length(sub(p, list[i])), 0);
  const out: Point3[] = [list[0]];
  for (let i = 1; i < list.length; i++) {
    const pieces = Math.max(1, Math.min(32, Math.ceil((length(sub(list[i], list[i - 1])) / total) * 32)));
    for (let k = 1; k <= pieces; k++) out.push(add(list[i - 1], scale(sub(list[i], list[i - 1]), k / pieces)));
  }
  return out;
}

/**
 * One rail: each section is carried along the rail as its frame turns, changing into the next section
 * between the places on the rail nearest each.
 */
export function oneRailRings(rail: LoftCurve, curves: readonly LoftCurve[]): Point3[][] {
  const frames = railFrames(divided(rail));
  const rings = matched(sameWay(curves));
  // each section by where on the rail its middle is nearest, in that place's frame
  const stops = rings.map((ring) => {
    const middle = scale(ring.reduce<Point3>((a, p) => add(a, p), [0, 0, 0]), 1 / ring.length);
    let best = 0;
    frames.forEach((f, i) => {
      if (length(sub(f.at, middle)) < length(sub(frames[best].at, middle))) best = i;
    });
    return { index: best, local: ring.map((p) => toFrame(frames[best], p)) };
  });
  stops.sort((a, b) => a.index - b.index);
  return frames.map((f, i) => {
    let k = 0;
    while (k + 1 < stops.length && stops[k + 1].index <= i) k++;
    const [a, b] = [stops[k], stops[Math.min(stops.length - 1, k + 1)]];
    const span = b.index - a.index;
    const u = span > 0 ? Math.min(1, Math.max(0, (i - a.index) / span)) : 0;
    return a.local.map((q, j) => fromFrame(f, add(q, scale(sub(b.local[j], q), u))));
  });
}

/**
 * Two rails: the section is carried along them, turned to keep its place across the line between
 * them, and growing as they part. It's taken as it stands at the rails' start.
 */
export function birailRings(railA: LoftCurve, railB: LoftCurve, section: LoftCurve): Point3[][] {
  const [ra, rb] = matched([{ points: divided(railA), closed: false }, { points: divided(railB), closed: false }]);
  const count = ra.length;
  const frame = (i: number): Frame & { readonly width: number } => {
    const across = sub(rb[i], ra[i]);
    const x = unit(across);
    const along = unit(add(sub(ra[Math.min(count - 1, i + 1)], ra[Math.max(0, i - 1)]), sub(rb[Math.min(count - 1, i + 1)], rb[Math.max(0, i - 1)])));
    const z = unit(sub(along, scale(x, dot(along, x))));
    return { at: ra[i], x, y: cross(z, x), z, width: length(across) };
  };
  const start = frame(0);
  const local = cleaned(section).map((p) => toFrame(start, p));
  return ra.map((_, i) => {
    const f = frame(i);
    const k = start.width > 0 ? f.width / start.width : 1;
    return local.map((q) => fromFrame(f, scale(q, k)));
  });
}

/** A flat polygon's triangles, as lists of its point numbers, by cutting off ears. */
export function capTriangles(ring: readonly Point3[]): number[][] {
  const normal = unit(turning(ring));
  const left = ring.map((_, i) => i);
  const out: number[][] = [];
  const area = (a: number, b: number, c: number): number => dot(cross(sub(ring[b], ring[a]), sub(ring[c], ring[a])), normal);
  const inside = (p: number, a: number, b: number, c: number): boolean => area(a, b, p) >= -1e-9 && area(b, c, p) >= -1e-9 && area(c, a, p) >= -1e-9;
  let guard = ring.length * ring.length + 8;
  while (left.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < left.length; i++) {
      const [a, b, c] = [left[(i + left.length - 1) % left.length], left[i], left[(i + 1) % left.length]];
      if (area(a, b, c) <= 1e-9) continue;
      if (left.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      left.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) {
      // a corner with no area, a point along a straight side, can go
      const flat = left.findIndex((b, i) => Math.abs(area(left[(i + left.length - 1) % left.length], b, left[(i + 1) % left.length])) <= 1e-9);
      if (flat < 0) break;
      left.splice(flat, 1);
    }
  }
  if (left.length === 3) out.push([left[0], left[1], left[2]]);
  return out;
}

/** The loft's faces, triangles of 9 numbers each. The rings run the same way, so does each face. */
export function loftFaces(rings: readonly (readonly Point3[])[], closedRing: boolean, solid: boolean): number[][] {
  const faces: number[][] = [];
  const count = rings[0].length;
  const tri = (a: Point3, b: Point3, c: Point3): void => {
    if (length(cross(sub(b, a), sub(c, a))) > 1e-9) faces.push([...a, ...b, ...c]);
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const [r0, r1] = [rings[i], rings[i + 1]];
    for (let j = 0; j < (closedRing ? count : count - 1); j++) {
      const k = (j + 1) % count;
      tri(r0[j], r0[k], r1[k]);
      tri(r0[j], r1[k], r1[j]);
    }
  }
  const ends = rings[0] === rings[rings.length - 1];
  if (solid && closedRing && !ends) {
    const [first, last] = [rings[0], rings[rings.length - 1]];
    for (const [a, b, c] of capTriangles(first)) tri(first[c], first[b], first[a]);
    for (const [a, b, c] of capTriangles(last)) tri(last[a], last[b], last[c]);
  }
  return faces;
}

/** Lines that show the loft before it's made: its sections and a few lines running along it, 6 numbers a line. */
export function loftWires(rings: readonly (readonly Point3[])[], closedRing: boolean): number[] {
  const out: number[] = [];
  const count = rings[0].length;
  for (const ring of rings) {
    for (let j = 0; j < (closedRing ? count : count - 1); j++) out.push(...ring[j], ...ring[(j + 1) % count]);
  }
  const every = Math.max(1, Math.floor(count / 12));
  for (let j = 0; j < count; j += every) {
    for (let i = 0; i + 1 < rings.length; i++) out.push(...rings[i][j], ...rings[i + 1][j]);
  }
  return out;
}

/** The point on the curve nearest `p` as a share of its length, so a click sets where the curve starts. */
export function shareNearest(c: LoftCurve, p: Point3): number {
  const points = cleaned(c);
  const { at, total } = shares(points, c.closed);
  let best = 0;
  let bestD = Infinity;
  const n = c.closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    const ab = sub(b, a);
    const u = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12)));
    const d = length(sub(p, add(a, scale(ab, u))));
    if (d < bestD) {
      bestD = d;
      best = at[i] + (u * length(ab)) / Math.max(total, 1e-9);
    }
  }
  return best % 1;
}
