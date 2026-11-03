// What the 3D Modeling set's Extract tool takes off a solid or surface, as plain sums on its triangles. Rodeo's
// solids have no kernel behind them, so an edge here is a crease or an open rim, a faceted curve's straight
// pieces joined back into one, and an iso-parametric curve is a slice across the surface, along or across
// the way it runs. Kept apart from the tool so it runs without the page.

import { crossingOfPlane, type Tri } from "./powerPackShapes.ts";
import { solidEdges, solidFace, stitched, tangentFaces, type FacePick, type SolidEdge, type SolidFace } from "./solidOps.ts";

export type Point = readonly [number, number, number];

/** the most a faceted curve turns from one piece to the next, the same as the most a smooth surface folds */
const MOST_TURN = (20 * Math.PI) / 180;
const LEAST_TURN = (0.05 * Math.PI) / 180;
/** how different in length a faceted curve's pieces can be */
const PIECE_RATIO = 1.6;
/** how far off its circle a point of a circular edge can lie, as a share of the radius */
const CIRCLE_SHARE = 0.005;

const sub = (a: readonly number[], b: readonly number[]): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: readonly number[], b: readonly number[]): Point => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: readonly number[], k: number): Point => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: readonly number[]): Point => {
  const n = length(a);
  return n ? scale(a, 1 / n) : [0, 0, 0];
};
const toPoint = (a: readonly number[]): Point => [a[0], a[1], a[2]];

function sizeOf(tris: ArrayLike<number>): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], tris[i + k]);
      hi[k] = Math.max(hi[k], tris[i + k]);
    }
  }
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
}

/** A key for a point near enough to others that share it. */
const keyMaker = (tol: number) => (p: readonly number[]): string => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;

const CREASE_COS = Math.cos(MOST_TURN);

/**
 * Every edge to extract from. A closed solid's are its creases; an open surface also has its rim, each side
 * of which has just one face, so solidEdges, which needs two to a side, can't find them.
 */
export function pieces(tris: ArrayLike<number>): SolidEdge[] {
  const { points, triangles } = stitched(tris);
  const sides = new Map<string, { p: number; q: number; n: Point[]; third: number[] }>();
  for (const t of triangles) {
    const n = unit(cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]])));
    for (let k = 0; k < 3; k++) {
      const [p, q, third] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const side = sides.get(key) ?? { p, q, n: [], third: [] };
      side.n.push(n);
      side.third.push(third);
      sides.set(key, side);
    }
  }
  const all = [...sides.values()];
  if (!all.some((v) => v.n.length === 1)) return solidEdges(tris);
  const kept = all.filter((v) => v.n.length === 1 || (v.n.length === 2 && dot(v.n[0], v.n[1]) <= CREASE_COS));
  // pieces running straight on between the same faces are one edge
  const at = new Map<number, number[]>();
  kept.forEach((e, i) => {
    for (const v of [e.p, e.q]) at.set(v, [...(at.get(v) ?? []), i]);
  });
  const same = (u: readonly number[], v: readonly number[]): boolean => dot(u, v) > 0.99999;
  const used = new Set<number>();
  const out: SolidEdge[] = [];
  kept.forEach((e, i) => {
    if (used.has(i)) return;
    used.add(i);
    const dir = unit(sub(points[e.q], points[e.p]));
    const [n1, n2] = [e.n[0], e.n[e.n.length - 1]];
    const grow = (from: number): number => {
      let tip = from;
      for (;;) {
        const next = (at.get(tip) ?? []).find((j) => {
          if (used.has(j)) return false;
          const o = kept[j];
          const [m1, m2] = [o.n[0], o.n[o.n.length - 1]];
          return Math.abs(dot(unit(sub(points[o.q], points[o.p])), dir)) > 0.99999 && ((same(m1, n1) && same(m2, n2)) || (same(m1, n2) && same(m2, n1)));
        });
        if (next === undefined) return tip;
        used.add(next);
        tip = kept[next].p === tip ? kept[next].q : kept[next].p;
      }
    };
    const b = grow(e.q);
    const a = grow(e.p);
    const across = (n: Point, third: number): Point => {
      const d = unit(cross(n, dir));
      return dot(d, sub(points[third], points[e.p])) >= 0 ? d : scale(d, -1);
    };
    const d1 = across(n1, e.third[0]);
    const d2 = across(n2, e.third[e.third.length - 1]);
    out.push({ a: points[a], b: points[b], n1, n2, d1, d2, convex: e.n.length === 2 && dot(d1, n2) < -1e-9 });
  });
  return out;
}

const toSegment = (p: readonly number[], a: readonly number[], b: readonly number[]): number => {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12)));
  return length(sub(p, add(a, scale(ab, t))));
};

/** The piece nearest a point, of any face. */
export function nearestPiece(edges: readonly SolidEdge[], point: readonly number[]): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  edges.forEach((e, i) => {
    const d = toSegment(point, e.a, e.b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** One edge as a person sees it: a straight piece, or the pieces of a faceted curve in order. */
export interface WholeEdge {
  readonly pieces: readonly number[];
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/** The pieces joined into whole edges, each piece in exactly one. */
export function wholeEdges(edges: readonly SolidEdge[], size: number): WholeEdge[] {
  const key = keyMaker(Math.max(size * 1e-6, 1e-4));
  const at = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = key(p);
      at.set(k, [...(at.get(k) ?? []), i]);
    }
  });
  const used = new Set<number>();
  const lengthOf = (i: number): number => length(sub(edges[i].b, edges[i].a));
  /** the way on from a piece at its far end `tip`, having come along `dir` */
  const nextFrom = (i: number, tip: Point, dir: Point): number | null => {
    let best: number | null = null;
    let bestTurn = MOST_TURN;
    for (const j of at.get(key(tip)) ?? []) {
      if (used.has(j) || j === i) continue;
      const out = key(edges[j].a) === key(tip) ? sub(edges[j].b, edges[j].a) : sub(edges[j].a, edges[j].b);
      const turn = Math.acos(Math.min(1, Math.max(-1, dot(dir, unit(out)))));
      const ratio = Math.max(lengthOf(i), lengthOf(j)) / Math.max(Math.min(lengthOf(i), lengthOf(j)), 1e-9);
      if (turn > LEAST_TURN && turn < bestTurn && ratio < PIECE_RATIO) {
        best = j;
        bestTurn = turn;
      }
    }
    return best;
  };
  const out: WholeEdge[] = [];
  edges.forEach((e, i) => {
    if (used.has(i)) return;
    used.add(i);
    const walk = (from: readonly number[], to: readonly number[], start: number): { points: Point[]; list: number[] } => {
      const points: Point[] = [];
      const list: number[] = [];
      let [piece, a, b] = [start, from, to];
      for (;;) {
        const tip = toPoint(b);
        const next = nextFrom(piece, tip, unit(sub(b, a)));
        if (next === null) return { points, list };
        used.add(next);
        const flip = key(edges[next].a) !== key(tip);
        const far = flip ? edges[next].a : edges[next].b;
        points.push(toPoint(far));
        list.push(next);
        [piece, a, b] = [next, tip, far];
      }
    };
    const ahead = walk(e.a, e.b, i);
    const behind = walk(e.b, e.a, i);
    const points = [...behind.points.reverse(), toPoint(e.a), toPoint(e.b), ...ahead.points];
    const closed = points.length > 3 && key(points[0]) === key(points[points.length - 1]);
    if (closed) points.pop();
    out.push({ pieces: [...behind.list.reverse(), i, ...ahead.list], points, closed });
  });
  return out;
}

/** The centre of the circle these points lie on, when they do; null for anything else, or too few to tell. */
export function circleCentre(points: readonly Point[]): Point | null {
  if (points.length < 4) return null;
  const n = points.length;
  const [p, q, r] = [points[0], points[Math.floor(n / 3)], points[Math.floor((2 * n) / 3)]];
  const [u, v] = [sub(q, p), sub(r, p)];
  const normal = cross(u, v);
  const nn = dot(normal, normal);
  if (nn < 1e-12) return null;
  const centre = add(p, scale(add(scale(cross(v, normal), dot(u, u)), scale(cross(normal, u), dot(v, v))), 1 / (2 * nn)));
  const radius = length(sub(p, centre));
  const off = radius * CIRCLE_SHARE;
  const axis = unit(normal);
  return points.every((o) => Math.abs(length(sub(o, centre)) - radius) <= off && Math.abs(dot(sub(o, centre), axis)) <= off) ? centre : null;
}

/** Where 3D loci go on an edge: its start, end and middle, and a circular edge's centre. */
export function edgeLoci(edge: WholeEdge): Point[] {
  const list = edge.closed ? [...edge.points, edge.points[0]] : [...edge.points];
  const stretch: number[] = [];
  let all = 0;
  for (let i = 1; i < list.length; i++) {
    stretch.push(length(sub(list[i], list[i - 1])));
    all += stretch[i - 1];
  }
  let left = all / 2;
  let middle = list[0];
  for (let i = 0; i < stretch.length; i++) {
    if (left <= stretch[i]) {
      middle = add(list[i], scale(sub(list[i + 1], list[i]), stretch[i] ? left / stretch[i] : 0));
      break;
    }
    left -= stretch[i];
  }
  const centre = circleCentre(edge.points);
  return [list[0], ...(edge.closed ? [] : [list[list.length - 1]]), middle, ...(centre ? [centre] : [])];
}

/** The points of several lists, each place once. */
export function onePerPlace(lists: readonly (readonly Point[])[], size: number): Point[] {
  const key = keyMaker(Math.max(size * 1e-6, 1e-4));
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const list of lists) {
    for (const p of list) {
      const k = key(p);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(p);
      }
    }
  }
  return out;
}

export interface Curve {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

/** A curve without the points that lie on the straight between their neighbours. */
function withoutSpare(curve: Curve): Curve {
  const { points, closed } = curve;
  const n = points.length;
  const kept = points.filter((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const [a, b] = [unit(sub(p, points[(i + n - 1) % n])), unit(sub(points[(i + 1) % n], p))];
    return dot(a, b) < 0.999999;
  });
  return { points: kept, closed };
}

/** Straight pieces joined end to end, through each point just two of them share: where more meet, a curve stops. */
export function joined(segments: readonly (readonly [readonly number[], readonly number[]])[], size: number): Curve[] {
  const key = keyMaker(Math.max(size * 1e-6, 1e-4));
  const at = new Map<string, number[]>();
  segments.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      at.set(k, [...(at.get(k) ?? []), i]);
    }
  });
  const used = new Set<number>();
  const follow = (start: string): Curve | null => {
    const first = (at.get(start) ?? []).find((i) => !used.has(i));
    if (first === undefined) return null;
    const points: Point[] = [];
    let tip = start;
    let piece: number | undefined = first;
    while (piece !== undefined) {
      used.add(piece);
      const [a, b] = segments[piece];
      const far = key(a) === tip ? b : a;
      if (!points.length) points.push(toPoint(key(a) === tip ? a : b));
      points.push(toPoint(far));
      tip = key(far);
      const there: number[] = at.get(tip) ?? [];
      piece = there.length === 2 ? there.find((i) => !used.has(i)) : undefined;
    }
    const closed = points.length > 3 && key(points[0]) === key(points[points.length - 1]);
    if (closed) points.pop();
    return withoutSpare({ points, closed });
  };
  const out: Curve[] = [];
  // from the points where curves end first, so a closed one isn't started halfway along another
  for (const [k, list] of at) {
    if (list.length === 2) continue;
    for (;;) {
      const curve = follow(k);
      if (!curve) break;
      out.push(curve);
    }
  }
  for (const k of at.keys()) {
    for (;;) {
      const curve = follow(k);
      if (!curve) break;
      out.push(curve);
    }
  }
  return out;
}

/** A face's triangles, flat. */
export function trianglesOf(face: SolidFace): number[] {
  const out: number[] = [];
  for (const i of face.triangles) for (const v of face.mesh.triangles[i]) out.push(...face.mesh.points[v]);
  return out;
}

/** A face's loops, outer first. */
export function ringsOf(face: SolidFace): Curve[] {
  return face.rings.map((ring) => ({ points: ring.map((v) => toPoint(face.mesh.points[v])), closed: true }));
}

/** The faces at a pick: the one clicked, or with Select Tangent Entities those running smoothly on from it. */
export function facesAt(tris: ArrayLike<number>, pick: FacePick, tangent: boolean): SolidFace[] {
  const out: SolidFace[] = [];
  const seen = new Set<number>();
  for (const p of tangent ? tangentFaces(tris, pick) : [pick]) {
    const face = solidFace(tris, p);
    if (typeof face === "string" || [...face.triangles].some((i) => seen.has(i))) continue;
    for (const i of face.triangles) seen.add(i);
    out.push(face);
  }
  return out;
}

/** Every face of the object. */
export function allFaces(tris: ArrayLike<number>): SolidFace[] {
  const out: SolidFace[] = [];
  const seen = new Set<number>();
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const corners: Point[] = [0, 3, 6].map((k): Point => [tris[t + k], tris[t + k + 1], tris[t + k + 2]]);
    const normal = unit(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
    if (!length(normal)) continue;
    const point = scale(add(add(corners[0], corners[1]), corners[2]), 1 / 3);
    // a triangle's number here needn't be the welded mesh's, so a face is told by what it's already taken
    const face = solidFace(tris, { point, normal });
    if (typeof face === "string" || [...face.triangles].some((i) => seen.has(i))) continue;
    for (const i of face.triangles) seen.add(i);
    out.push(face);
  }
  return out;
}

/** The way with the least change in a set of normals: a cylinder's axis, or null when there's no one way. */
function steadiest(normals: readonly { n: Point; w: number }[]): Point | null {
  // the moments of the normals; power steps on (trace − moments) find the smallest moment's direction
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let all = 0;
  for (const { n, w } of normals) {
    all += w;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[3 * i + j] += w * n[i] * n[j];
  }
  if (!all) return null;
  const mine = m.map((v) => v / all);
  const trace = mine[0] + mine[4] + mine[8];
  const apply = (v: Point): Point => [
    trace * v[0] - (mine[0] * v[0] + mine[1] * v[1] + mine[2] * v[2]),
    trace * v[1] - (mine[3] * v[0] + mine[4] * v[1] + mine[5] * v[2]),
    trace * v[2] - (mine[6] * v[0] + mine[7] * v[1] + mine[8] * v[2]),
  ];
  let v: Point = unit([0.31, 0.57, 0.76]);
  for (let i = 0; i < 64; i++) {
    const next = unit(apply(v));
    if (!length(next)) return null;
    v = next;
  }
  const leastMoment = dot(v, sub(scale(v, trace), apply(v)));
  // a ball has about the same moment each way
  return leastMoment < 0.05 ? v : null;
}

/** The way a face runs: a flat face along its longest side, a curved one along its axis, or up the way the world does. */
function faceRuns(face: SolidFace, pick: FacePick): Point {
  if (face.flat) {
    const ring = face.rings[0] ?? [];
    let best: Point = [1, 0, 0];
    let longest = 0;
    ring.forEach((v, i) => {
      const side = sub(face.mesh.points[ring[(i + 1) % ring.length]], face.mesh.points[v]);
      if (length(side) > longest) {
        longest = length(side);
        best = unit(side);
      }
    });
    return best;
  }
  const normals = [...face.triangles].map((i) => {
    const t = face.mesh.triangles[i];
    const c = cross(sub(face.mesh.points[t[1]], face.mesh.points[t[0]]), sub(face.mesh.points[t[2]], face.mesh.points[t[0]]));
    return { n: unit(c), w: length(c) / 2 };
  });
  const axis = steadiest(normals);
  if (axis) return axis;
  const up: Point = Math.abs(pick.normal[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1];
  return unit(sub(up, scale(pick.normal, dot(up, pick.normal))));
}

/** An iso-parametric curve through a click: the face sliced along the way it runs (U), or across it (V). */
export function isoCurve(tris: ArrayLike<number>, pick: FacePick, way: "u" | "v"): Curve | string {
  const face = solidFace(tris, pick);
  if (typeof face === "string") return face;
  const runs = faceRuns(face, pick);
  const size = sizeOf(tris);
  const across = way === "v" ? runs : unit(cross(pick.normal, runs));
  if (!length(across)) return "That face has no way to slice it there.";
  const tol = Math.max(size * 1e-7, 1e-5);
  const segments: [readonly number[], readonly number[]][] = [];
  for (const i of face.triangles) {
    const t = face.mesh.triangles[i];
    const hit = crossingOfPlane([face.mesh.points[t[0]], face.mesh.points[t[1]], face.mesh.points[t[2]]] as unknown as Tri, across, pick.point as Point, tol);
    if (hit && length(sub(hit[0], hit[1])) > tol) segments.push(hit);
  }
  const curves = joined(segments, size);
  let best: Curve | null = null;
  let nearest = Infinity;
  for (const c of curves) {
    const list = c.closed ? [...c.points, c.points[0]] : c.points;
    for (let i = 1; i < list.length; i++) {
      const d = toSegment(pick.point, list[i - 1], list[i]);
      if (d < nearest) {
        nearest = d;
        best = c;
      }
    }
  }
  return best ?? "That face has no curve through that point.";
}
