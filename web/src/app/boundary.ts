// Boundaries of the areas that lines and outlines enclose, for the Polygon tool's
// Inner and Outer Boundary modes and Modify > Combine into Surface. The pieces'
// outlines are cut where they cross and joined where they meet into a planar
// graph; loose ends are trimmed away, since they bound nothing. An area is then a
// face of the graph, traced round with it on the left: the inner boundary is the
// face a click falls in, the outer boundary the outside of the connected pieces
// around it.

import type { BBox, Pt, Shape } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { sampleArc, selectedObjects } from "./compose.ts";
import { bboxIntersects, pointInPolygon, signedArea } from "./geom.ts";
import type { CullIndex, Scene } from "./scene.ts";
import { isFullArc } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

type Seg = readonly [Pt, Pt];

/** Points closer than this fraction of the pieces' extent are one point. */
const MERGE_TOL = 1e-7;
/** A ray direction that is never exactly along a drawn edge or through a vertex in practice. */
const RAY = { x: Math.cos(0.0137), y: Math.sin(0.0137) };

/** The straight pieces of a shape's outline: arcs sampled, polylines as drawn. Text and images have none. */
export function outlineSegments(shape: Shape): Seg[] {
  let pts: readonly Pt[];
  let closed: boolean;
  switch (shape.kind) {
    case "line":
      return shape.points.length >= 2 ? [[shape.points[0], shape.points[1]]] : [];
    case "rect":
      pts = shape.points;
      closed = true;
      break;
    case "polygon":
    case "polyline":
      pts = shape.points;
      closed = shape.closed;
      break;
    case "arc": {
      const sampled = sampleArc(shape);
      if (!sampled) return [];
      pts = sampled;
      closed = isFullArc(shape);
      break;
    }
    default:
      return [];
  }
  const out: Seg[] = [];
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
}

/** A planar graph: its vertices and, for each, its neighbours sorted counter-clockwise by direction. */
export interface Graph {
  readonly pts: readonly Pt[];
  readonly adj: readonly (readonly number[])[];
}

/** Where along a→b (0 to 1) the segment c→d crosses or touches it, within `tol`; several where they overlap. */
function cuts(a: Pt, b: Pt, c: Pt, d: Pt, tol: number): number[] {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const len2 = rx * rx + ry * ry;
  if (len2 === 0) return [];
  const den = rx * sy - ry * sx;
  const len = Math.sqrt(len2);
  const slen = Math.hypot(sx, sy);
  // the param along a→b of a point lying on it within tol, or null
  const along = (p: Pt): number | null => {
    const t = ((p.x - a.x) * rx + (p.y - a.y) * ry) / len2;
    if (t < -tol / len || t > 1 + tol / len) return null;
    const off = Math.abs((p.x - a.x) * ry - (p.y - a.y) * rx) / len;
    return off <= tol ? Math.min(1, Math.max(0, t)) : null;
  };
  if (Math.abs(den) <= 1e-12 * len * slen) {
    // parallel: only where they overlap, at the other's ends
    return [along(c), along(d)].filter((t): t is number => t !== null);
  }
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const et = tol / len;
  const eu = slen > 0 ? tol / slen : 0;
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return [];
  return [Math.min(1, Math.max(0, t))];
}

/**
 * The graph `segs` make: each cut where another crosses or ends on it, ends within a hair of
 * each other joined, repeated edges dropped and loose ends trimmed back to where they meet
 * something.
 */
export function buildGraph(segs: readonly Seg[]): Graph {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [a, b] of segs) {
    x0 = Math.min(x0, a.x, b.x);
    y0 = Math.min(y0, a.y, b.y);
    x1 = Math.max(x1, a.x, b.x);
    y1 = Math.max(y1, a.y, b.y);
  }
  const extent = Math.max(x1 - x0, y1 - y0);
  if (!(extent > 0)) return { pts: [], adj: [] };
  const tol = extent * MERGE_TOL;

  // sweep along x: only segments whose x spans overlap can meet
  const order = segs.map((_, i) => i).sort((i, j) => Math.min(segs[i][0].x, segs[i][1].x) - Math.min(segs[j][0].x, segs[j][1].x));
  const params: number[][] = segs.map(() => [0, 1]);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const [a, b] = segs[i];
    const ix1 = Math.max(a.x, b.x) + tol;
    const iy0 = Math.min(a.y, b.y) - tol;
    const iy1 = Math.max(a.y, b.y) + tol;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      const [c, d] = segs[j];
      if (Math.min(c.x, d.x) > ix1) break;
      if (Math.max(c.y, d.y) < iy0 || Math.min(c.y, d.y) > iy1) continue;
      params[i].push(...cuts(a, b, c, d, tol));
      params[j].push(...cuts(c, d, a, b, tol));
    }
  }

  // vertices, merged on a grid of cells `tol` wide (neighbouring cells checked too)
  const pts: Pt[] = [];
  const cells = new Map<string, number[]>();
  const vertexAt = (p: Pt): number => {
    const cx = Math.floor(p.x / tol);
    const cy = Math.floor(p.y / tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.abs(pts[k].x - p.x) <= tol && Math.abs(pts[k].y - p.y) <= tol) return k;
        }
      }
    }
    pts.push(p);
    const key = `${cx},${cy}`;
    const list = cells.get(key);
    if (list) list.push(pts.length - 1);
    else cells.set(key, [pts.length - 1]);
    return pts.length - 1;
  };

  const nbrs: Set<number>[] = [];
  const link = (u: number, v: number): void => {
    if (u === v) return;
    while (nbrs.length <= Math.max(u, v)) nbrs.push(new Set());
    nbrs[u].add(v);
    nbrs[v].add(u);
  };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(params[i])].sort((s, t) => s - t);
    let prev = vertexAt(a);
    for (const t of ts) {
      if (t === 0) continue;
      const v = t === 1 ? vertexAt(b) : vertexAt({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      link(prev, v);
      prev = v;
    }
  });
  while (nbrs.length < pts.length) nbrs.push(new Set());

  // trim loose ends: a vertex with one neighbour bounds nothing
  const stack = nbrs.map((s, i) => (s.size === 1 ? i : -1)).filter((i) => i >= 0);
  while (stack.length > 0) {
    const v = stack.pop() as number;
    if (nbrs[v].size !== 1) continue;
    const [u] = nbrs[v];
    nbrs[v].clear();
    nbrs[u].delete(v);
    if (nbrs[u].size === 1) stack.push(u);
  }

  const adj = nbrs.map((s, v) => {
    const angle = (u: number): number => Math.atan2(pts[u].y - pts[v].y, pts[u].x - pts[v].x);
    return [...s].sort((p, q) => angle(p) - angle(q));
  });
  return { pts, adj };
}

/** The face on the left of u→v, traced round: at each vertex the edge just clockwise of the way back. */
function traceFace(g: Graph, u: number, v: number): number[] | null {
  const cycle: number[] = [];
  let a = u;
  let b = v;
  const limit = g.pts.length * 4 + 8;
  for (let step = 0; step < limit; step++) {
    cycle.push(a);
    const around = g.adj[b];
    const i = around.indexOf(a);
    if (i < 0) return null;
    const c = around[(i - 1 + around.length) % around.length];
    a = b;
    b = c;
    if (a === u && b === v) return cycle;
  }
  return null;
}

/** A cycle's points with the vertices that only continue a straight edge left out. */
function polygonOf(g: Graph, cycle: readonly number[]): Pt[] {
  const pts = cycle.map((k) => g.pts[k]);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[(i - 1 + pts.length) % pts.length];
    const q = pts[i];
    const r = pts[(i + 1) % pts.length];
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    const scale = Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(r.x - q.x, r.y - q.y);
    const backward = (q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y) < 0;
    if (Math.abs(cross) > 1e-9 * scale || backward) out.push(q);
  }
  return out;
}

/** The edges the ray from `p` crosses, nearest first, each oriented with `p` on its left. */
function edgesAlongRay(g: Graph, p: Pt): [number, number][] {
  const hits: { at: number; u: number; v: number }[] = [];
  g.adj.forEach((around, u) => {
    for (const v of around) {
      if (v < u) continue;
      const a = g.pts[u];
      const b = g.pts[v];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = RAY.x * ey - RAY.y * ex;
      if (den === 0) continue;
      const s = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
      const t = ((a.x - p.x) * RAY.y - (a.y - p.y) * RAY.x) / den;
      if (s <= 0 || t < 0 || t > 1) continue;
      const left = ex * (p.y - a.y) - ey * (p.x - a.x) > 0;
      hits.push({ at: s, u: left ? u : v, v: left ? v : u });
    }
  });
  return hits.sort((h, k) => h.at - k.at).map((h) => [h.u, h.v]);
}

/** The vertex cycle of the smallest area of `g` holding `p`, counter-clockwise; null when `p` is in none. */
function innerCycle(g: Graph, p: Pt): number[] | null {
  for (const [u, v] of edgesAlongRay(g, p)) {
    const cycle = traceFace(g, u, v);
    if (!cycle || cycle.length < 3) continue;
    const pts = cycle.map((k) => g.pts[k]);
    // the outside of an island traces clockwise, or does not hold p: look further along the ray
    if (signedArea(pts) > 0 && pointInPolygon(p, pts)) return cycle;
  }
  return null;
}

/** The boundary of the smallest area holding `p`, counter-clockwise; null when no outline encloses it. */
export function innerBoundary(g: Graph, p: Pt): Pt[] | null {
  const cycle = innerCycle(g, p);
  return cycle ? polygonOf(g, cycle) : null;
}

/** The outside of the connected outlines starting at `start`, counter-clockwise. */
function outerOf(g: Graph, start: number): Pt[] | null {
  // the component, and its leftmost (then lowest) vertex, which lies on its outside
  const seen = new Set([start]);
  const queue = [start];
  let left = start;
  while (queue.length > 0) {
    const v = queue.pop() as number;
    const a = g.pts[v];
    const l = g.pts[left];
    if (a.x < l.x || (a.x === l.x && a.y < l.y)) left = v;
    for (const u of g.adj[v]) {
      if (!seen.has(u)) {
        seen.add(u);
        queue.push(u);
      }
    }
  }
  const around = g.adj[left];
  if (around.length === 0) return null;
  // coming in from the far left, the next edge is the one turned furthest counter-clockwise: the outside is on its left
  const cycle = traceFace(g, left, around[around.length - 1]);
  if (!cycle || cycle.length < 3) return null;
  return polygonOf(g, cycle).reverse();
}

/** The outside boundary of the connected outlines around `p`, counter-clockwise; null when none enclose it. */
export function outerBoundary(g: Graph, p: Pt): Pt[] | null {
  const cycle = innerCycle(g, p);
  return cycle ? outerOf(g, cycle[0]) : null;
}

/**
 * The outside boundary of each set of connected outlines that encloses something,
 * counter-clockwise; sets lying inside another's boundary (islands) are left out.
 */
export function outerBoundaries(g: Graph): Pt[][] {
  const done = new Set<number>();
  const out: Pt[][] = [];
  g.adj.forEach((around, v) => {
    if (around.length === 0 || done.has(v)) return;
    const queue = [v];
    done.add(v);
    while (queue.length > 0) {
      const w = queue.pop() as number;
      for (const u of g.adj[w]) {
        if (!done.has(u)) {
          done.add(u);
          queue.push(u);
        }
      }
    }
    const outline = outerOf(g, v);
    if (outline && outline.length >= 3) out.push(outline);
  });
  return out.filter((o) => !out.some((other) => other !== o && pointInPolygon(o[0], other)));
}

let cached: { readonly index: CullIndex; readonly key: string; readonly graph: Graph } | null = null;

/**
 * The graph of what `layerId` draws within `rect`: the outlines of its visible objects there
 * (whole, where they reach outside it). Kept until the layer changes or the rect moves.
 */
export function layerGraph(scene: Scene, layerId: string, rect: BBox): Graph {
  const index = scene.cullIndex(layerId);
  const key = `${layerId}|${rect.x0}|${rect.y0}|${rect.x1}|${rect.y1}`;
  if (cached && cached.index === index && cached.key === key) return cached.graph;
  const segs: Seg[] = [];
  index.objects.forEach((obj, i) => {
    const k = i * 4;
    const box = { x0: index.boxes[k], y0: index.boxes[k + 1], x1: index.boxes[k + 2], y1: index.boxes[k + 3] };
    if (!obj.shape || !bboxIntersects(box, rect) || !scene.isObjectVisible(obj)) return;
    segs.push(...outlineSegments(obj.shape));
  });
  const graph = buildGraph(segs);
  cached = { index, key, graph };
  return graph;
}

/** The outlines Combine into Surface makes of the selection: the outside of each set of connected outlines that encloses something. */
function surfaces(): Pt[][] {
  const segs = selectedObjects().flatMap((o) => (o.shape ? outlineSegments(o.shape) : []));
  return segs.length < 2 ? [] : outerBoundaries(buildGraph(segs));
}

/** past this many selected objects the menu does not work the outlines out just to grey the command */
const CHECK_LIMIT = 200;

export function canCombineIntoSurface(): boolean {
  const n = store.selection.size;
  return n > 0 && (n > CHECK_LIMIT || surfaces().length > 0);
}

/**
 * Modify > Combine into Surface: a polygon of the area the selected lines, arcs and outlines
 * enclose together (one for each set that encloses one), added in one step and selected; the
 * pieces stay.
 */
export function combineIntoSurface(): void {
  const layerId = store.activeLayerId;
  const outlines = surfaces();
  if (!layerId || outlines.length === 0) {
    toast("The selected objects do not enclose an area.", "info");
    return;
  }
  const r = attempt("Combine into Surface", (s) =>
    s.batch(() => outlines.map((points) => s.addObject(layerId, { kind: "polygon", points, closed: true }))),
  );
  if (r) setSelection(r.value);
}
