// Isometric and other axonometric line work back into 3D. A drawing like Rhino's Make2D output
// is a parallel projection: every world axis is drawn along one fixed direction, foreshortened
// by a fixed amount, and depth along the view is lost. The three directions are found from the
// lines themselves (most of the length runs along them), and with them how much each axis is
// foreshortened. The line work is cleaned (fragments joined, ends snapped), and corners are
// placed in 3D by walking the edges that run along an axis: such an edge's 3D step is its drawn
// length over the foreshortening. What that can't fix, the depth of pieces joined only by
// sloping lines (ridges, hips) and of whole separate pieces, is filled in by assumptions that
// suit buildings: ridges over the middle of what they join, curves in the vertical plane of
// their ends, pieces touching others at the touching point, the rest standing on the ground.
// Faces are then found as the closed loops of edges in each plane the edges share.

import type { Pt, Vec3 } from "../../core/types.ts";

export interface IsoSegment {
  readonly a: Pt;
  readonly b: Pt;
  /** drawn hidden (behind something); placed like the rest, it completes the wireframe */
  readonly hidden?: boolean;
}

export interface IsoModel {
  /** the projection found: each world axis's drawn direction (unit) and how long one world unit along it is drawn */
  readonly axes: { readonly x: Pt; readonly y: Pt; readonly z: Pt; readonly scale: Vec3 };
  /** world units as drawn (millimetres for Make2D in a millimetre drawing), z up, each group's lowest point at z = 0 */
  readonly vertices: Vec3[];
  readonly edges: [number, number][];
  /** planar loops of vertex indices, without holes */
  readonly faces: number[][];
  /** separate pieces of line work, each placed on its own */
  readonly components: number;
  /** segments left out because they contradicted the others */
  readonly skipped: number;
  readonly notes: string[];
}

export interface IsoOptions {
  /** how near ends must be to join, drawing units (default from the drawing's size) */
  readonly tolerance?: number;
  /** how long one world unit along any axis is drawn, for drawings scaled rather than projected (an isometric drawing uses 1) */
  readonly scale?: number;
}

type V3 = [number, number, number];

/** lines within this angle of an axis's direction run along it */
const AXIS_DEGREES = 0.75;
/** peaks of the angle histogram at least this far apart are different axes */
const PEAK_SEPARATION = 12;
/** a plane is searched for faces only when it holds no more edges than this */
const PLANE_EDGES = 4000;
const MAX_FACES = 50_000;

const dot2 = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross2 = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const sub2 = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len2 = (a: Pt): number => Math.hypot(a.x, a.y);
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: V3): V3 => mul3(a, 1 / (norm3(a) || 1));
const AXES3: readonly V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The projection: world axis k is drawn as `m[k]` per world unit; `view` is the world direction drawn as a point. */
interface Projection {
  readonly dirs: [Pt, Pt, Pt];
  readonly m: [Pt, Pt, Pt];
  readonly view: V3;
  /** (M Mᵀ)⁻¹, for the least-norm point drawn at a given place */
  readonly inv: [number, number, number];
}

/** The world point nearest the origin that is drawn at `q`; every other is it plus some of `view`. */
function lift(p: Projection, q: Pt): V3 {
  const [a, b, c] = p.inv;
  const ux = a * q.x + b * q.y;
  const uy = b * q.x + c * q.y;
  return [p.m[0].x * ux + p.m[0].y * uy, p.m[1].x * ux + p.m[1].y * uy, p.m[2].x * ux + p.m[2].y * uy];
}

/** Finds 3D corners, edges and faces for axonometric line work. */
export function unprojectIso(segments: readonly IsoSegment[], opts: IsoOptions = {}): IsoModel {
  const notes: string[] = [];
  const segs = segments.filter((s) => [s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite) && len2(sub2(s.b, s.a)) > 0);
  const empty = (why: string): IsoModel => ({
    axes: { x: { x: 1, y: 0 }, y: { x: 0, y: 1 }, z: { x: 0, y: 1 }, scale: [0, 0, 0] },
    vertices: [],
    edges: [],
    faces: [],
    components: 0,
    skipped: segs.length,
    notes: [why],
  });
  if (segs.length < 3) return empty("There are too few lines to work from.");

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of segs) {
    x0 = Math.min(x0, s.a.x, s.b.x);
    y0 = Math.min(y0, s.a.y, s.b.y);
    x1 = Math.max(x1, s.a.x, s.b.x);
    y1 = Math.max(y1, s.a.y, s.b.y);
  }
  const extent = Math.max(x1 - x0, y1 - y0);
  const tol = opts.tolerance && opts.tolerance > 0 ? opts.tolerance : Math.max(0.5, extent * 2e-5);

  const proj = projection(segs, opts.scale, notes);
  if (!proj) return empty(notes[0] ?? "The lines don't run along three directions, so this isn't an axonometric drawing.");

  // ---- the line work, cleaned -------------------------------------------------------
  const merged = mergeCollinear(segs, proj, tol);
  const verts: Pt[] = [];
  const grid = new Map<string, number[]>();
  const cell = (p: Pt): [number, number] => [Math.floor(p.x / tol), Math.floor(p.y / tol)];
  const snap = (p: Pt): number => {
    const [cx, cy] = cell(p);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const v of grid.get(`${cx + i},${cy + j}`) ?? []) if (len2(sub2(verts[v], p)) <= tol) return v;
      }
    }
    verts.push({ x: p.x, y: p.y });
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(verts.length - 1);
    else grid.set(key, [verts.length - 1]);
    return verts.length - 1;
  };
  interface Edge {
    a: number;
    b: number;
    /** 0, 1, 2: along that world axis; -1: along none */
    axis: number;
    /** world units along the axis from a to b */
    step: number;
    len: number;
    dropped: boolean;
    /** a slope drawn along an axis, from a to b in the world; null for an axis edge or a free one */
    alt: V3 | null;
  }
  const lines: [number, number][] = [];
  for (const s of merged) {
    const a = snap(s.a);
    const b = snap(s.b);
    if (a !== b) lines.push([a, b]);
  }
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const [a, b] of joinBreaks(verts, lines, tol)) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = sub2(verts[b], verts[a]);
    const axis = axisOf(proj, d, tol);
    const m = axis >= 0 ? proj.m[axis] : null;
    edges.push({ a, b, axis, step: m ? dot2(d, m) / dot2(m, m) : 0, len: len2(d), dropped: false, alt: null });
  }
  if (!edges.length) return empty("Nothing was left once the lines were joined up.");

  const adj: number[][] = verts.map(() => []);
  edges.forEach((e, i) => {
    adj[e.a].push(i);
    adj[e.b].push(i);
  });

  // ---- two lines leaving a corner the same way along a horizontal axis can't both run along it
  // (they'd overlap), so the shorter is a slope drawn in line with the axis, as a 45° roof's verge
  // is in true isometric beside the eave or ridge. It's read in the upright plane across the axis.
  // One whose far end joins nothing else is more likely a stray piece of the longer line.
  const from = (i: number, v: number): number => (edges[i].a === v ? edges[i].step : -edges[i].step);
  let leaning = 0;
  for (let v = 0; v < verts.length; v++) {
    const level = adj[v].filter((i) => edges[i].axis === 0 || edges[i].axis === 1);
    for (const i of level) {
      const e = edges[i];
      const far = e.a === v ? e.b : e.a;
      if (e.alt || adj[far].length < 2 || Math.abs(proj.view[e.axis]) < 1e-6) continue;
      const longer = level.some((j) => j !== i && edges[j].axis === e.axis && from(j, v) * from(i, v) > 0 && edges[j].len > e.len + tol);
      if (!longer) continue;
      e.alt = add3(mul3(AXES3[e.axis], e.step), mul3(proj.view, -e.step / proj.view[e.axis]));
      leaning++;
    }
  }
  if (leaning) notes.push(`${leaning} line${leaning === 1 ? "" : "s"} drawn along an axis inside a longer one from the same corner ${leaning === 1 ? "was" : "were"} read as sloping across it (a 45° roof in true isometric).`);
  /** an edge's run from a to b in the world, along its axis or its slope */
  const run = (e: Edge): V3 => e.alt ?? mul3(AXES3[e.axis], e.step);

  // ---- corners placed along axis edges: one spanning tree per rigid piece, longest edges first.
  // A line drawn along an axis needn't run along it in 3D (in true isometric a hip at 45° in plan
  // is drawn upright), which shows as a loop that doesn't close. Such loops are mended by taking
  // their doubtful lines as sloping: those no closing loop vouches for, and of those the ones
  // hanging off vouched-for structure (so a ridge between two hips stays straight and rigid).
  const pos: V3[] = verts.map(() => [0, 0, 0]);
  const tree = new Int32Array(verts.length);
  const parent = new Int32Array(verts.length);
  const depth = new Int32Array(verts.length);
  let treeEdges = new Set<number>();
  let trees: number[][] = [];
  const tol3 = tol * 3;
  const fits = (i: number): boolean => {
    const e = edges[i];
    return norm3(sub3(add3(pos[e.a], run(e)), pos[e.b])) <= Math.max(tol3, e.len * 0.02);
  };
  const grow = (): void => {
    const uf = new UnionFind(verts.length);
    treeEdges = new Set();
    [...edges.keys()]
      .filter((i) => edges[i].axis >= 0 && !edges[i].dropped)
      .sort((i, j) => edges[j].len - edges[i].len)
      .forEach((i) => {
        if (uf.union(edges[i].a, edges[i].b)) treeEdges.add(i);
      });
    tree.fill(-1);
    parent.fill(-1);
    trees = [];
    for (let v = 0; v < verts.length; v++) {
      if (tree[v] >= 0 || !adj[v].length) continue;
      const id = trees.length;
      const members = [v];
      tree[v] = id;
      depth[v] = 0;
      pos[v] = lift(proj, verts[v]);
      for (let k = 0; k < members.length; k++) {
        const u = members[k];
        for (const ei of adj[u]) {
          if (!treeEdges.has(ei)) continue;
          const e = edges[ei];
          const w = e.a === u ? e.b : e.a;
          if (tree[w] >= 0) continue;
          tree[w] = id;
          parent[w] = ei;
          depth[w] = depth[u] + 1;
          pos[w] = add3(pos[u], e.a === u ? run(e) : mul3(run(e), -1));
          members.push(w);
        }
      }
      trees.push(members);
    }
  };
  /** the tree edges between two corners of one tree */
  const path = (a: number, b: number): number[] => {
    const out: number[] = [];
    const up = (v: number): number => {
      const e = edges[parent[v]];
      out.push(parent[v]);
      return e.a === v ? e.b : e.a;
    };
    while (depth[a] > depth[b] && out.length < 5000) a = up(a);
    while (depth[b] > depth[a] && out.length < 5000) b = up(b);
    while (a !== b && out.length < 5000) {
      a = up(a);
      b = up(b);
    }
    return out;
  };
  let sloped = 0;
  for (let round = 0; ; round++) {
    grow();
    const vouched = new Set<number>();
    const open: number[][] = [];
    edges.forEach((e, i) => {
      if (e.axis < 0 || e.dropped || treeEdges.has(i) || tree[e.a] !== tree[e.b]) return;
      const loop = [i, ...path(e.a, e.b)];
      if (fits(i)) for (const x of loop) vouched.add(x);
      else open.push(loop);
    });
    if (!open.length) break;
    if (round >= 8) {
      // still open: the closing lines are left out
      for (const [i] of open) edges[i].dropped = true;
      grow();
      break;
    }
    const firm = new Uint8Array(verts.length);
    for (const i of vouched) firm[edges[i].a] = firm[edges[i].b] = 1;
    for (const loop of open) {
      const doubtful = loop.filter((i) => !vouched.has(i) && edges[i].axis >= 0);
      const hanging = doubtful.filter((i) => firm[edges[i].a] || firm[edges[i].b]);
      for (const i of hanging.length ? hanging : doubtful.length ? doubtful : [loop[0]]) {
        if (edges[i].axis < 0) continue;
        edges[i].axis = -1;
        edges[i].step = 0;
        edges[i].alt = null;
        sloped++;
      }
    }
  }
  const skipped = edges.filter((e) => e.dropped).length;
  if (sloped) notes.push(`${sloped} line${sloped === 1 ? "" : "s"} drawn along an axis didn't fit as one and ${sloped === 1 ? "was" : "were"} taken as sloping.`);
  if (skipped) notes.push(`${skipped} line${skipped === 1 ? "" : "s"} along an axis disagreed with the rest and ${skipped === 1 ? "was" : "were"} left out.`);

  // ---- pieces joined only by sloping lines: each tree moves as one along the view ----------
  const live = (ei: number): boolean => !edges[ei].dropped;
  const comp = new UnionFind(verts.length);
  for (const e of edges) if (!e.dropped) comp.union(e.a, e.b);
  const treeComp = trees.map((m) => comp.find(m[0]));
  const treeSize = trees.map((m) => {
    let total = 0;
    for (const v of m) for (const ei of adj[v]) if (live(ei)) total += edges[ei].len / 2;
    return total;
  });
  const shift = new Float64Array(trees.length);
  const placed = new Uint8Array(trees.length);
  const horizontalView = Math.hypot(proj.view[0], proj.view[1]);
  /** a single corner joined by exactly two sloping lines: a point along a curve or a broken slope */
  const isChain = (t: number): boolean => trees[t].length === 1 && adj[trees[t][0]].filter(live).length === 2;
  const at = (v: number): V3 => add3(pos[v], mul3(proj.view, shift[tree[v]]));
  const neighbours = (v: number): number[] => adj[v].filter(live).map((ei) => (edges[ei].a === v ? edges[ei].b : edges[ei].a));
  /** across chains of curve points, the corners at their far ends */
  const reach = (v: number): number[] => {
    const out: number[] = [];
    for (let w of neighbours(v)) {
      let prev = v;
      for (let guard = 0; guard < 10_000 && isChain(tree[w]); guard++) {
        const next = neighbours(w).find((x) => x !== prev);
        if (next === undefined) break;
        prev = w;
        w = next;
      }
      if (!isChain(tree[w])) out.push(w);
    }
    return out;
  };
  let ridges = 0;
  const byComp = new Map<number, number[]>();
  trees.forEach((_, t) => {
    const list = byComp.get(treeComp[t]);
    if (list) list.push(t);
    else byComp.set(treeComp[t], [t]);
  });
  for (const list of byComp.values()) {
    const solid = list.filter((t) => !isChain(t));
    if (!solid.length) continue;
    const root = solid.reduce((best, t) => (treeSize[t] > treeSize[best] ? t : best), solid[0]);
    placed[root] = 1;
    const queue = [root];
    for (let k = 0; k < queue.length; k++) {
      for (const v of trees[queue[k]]) {
        for (const w of reach(v)) {
          const t = tree[w];
          if (placed[t] || isChain(t)) continue;
          // over the middle of the placed corners it joins, as near as it can be
          let num = 0;
          let den = 0;
          for (const u of trees[t]) {
            const near = reach(u).filter((x) => placed[tree[x]]);
            if (!near.length) continue;
            let cx = 0;
            let cy = 0;
            for (const x of near) {
              const p = at(x);
              cx += p[0] / near.length;
              cy += p[1] / near.length;
            }
            num += (cx - pos[u][0]) * proj.view[0] + (cy - pos[u][1]) * proj.view[1];
            den += horizontalView * horizontalView;
          }
          shift[t] = den > 1e-12 ? num / den : 0;
          placed[t] = 1;
          ridges++;
          queue.push(t);
        }
      }
    }
  }
  // points along curves: in the vertical plane through the corners at the curve's ends
  let curves = 0;
  trees.forEach((m, t) => {
    if (!isChain(t) || placed[t]) return;
    const v = m[0];
    const ends = reach(v);
    const anchors = ends.filter((x) => placed[tree[x]]);
    if (!anchors.length) return;
    const [pa, pb] = [at(anchors[0]), at(anchors[anchors.length - 1])];
    const along: V3 = [pb[0] - pa[0], pb[1] - pa[1], 0];
    const base = pos[v];
    if (anchors.length >= 2 && norm3(along) > tol) {
      const n: V3 = [-along[1], along[0], 0];
      const den = dot3(n, proj.view);
      shift[t] = Math.abs(den) > 1e-9 ? dot3(n, sub3(pa, base)) / den : 0;
    } else {
      shift[t] = dot3(sub3(pa, base), proj.view);
    }
    placed[t] = 1;
    curves++;
  });
  if (ridges) notes.push(`${ridges} piece${ridges === 1 ? " was" : "s were"} joined only by sloping lines (ridges, hips) and set over the middle of what they join.`);
  if (curves) notes.push(`${curves} point${curves === 1 ? "" : "s"} along curves were set in the vertical plane of the curve's ends.`);

  // ---- separate pieces: touching ones where they touch, the rest standing on the ground ----
  const live2 = edges.filter((e) => !e.dropped);
  const touches = touchings(verts, live2, tol);
  const comps = [...new Set(trees.map((_, t) => treeComp[t]))];
  const compTrees = new Map<number, number[]>(comps.map((c) => [c, byComp.get(c) ?? []]));
  const compSize = new Map<number, number>(comps.map((c) => [c, (compTrees.get(c) ?? []).reduce((s, t) => s + treeSize[t], 0)]));
  const lift3 = new Map<number, number>();
  const lowest = (c: number, extra: number): number => {
    let low = Infinity;
    for (const t of compTrees.get(c) ?? []) for (const v of trees[t]) low = Math.min(low, at(v)[2] + extra * proj.view[2]);
    return low;
  };
  const ground = (c: number): number => (Math.abs(proj.view[2]) > 1e-9 ? -lowest(c, 0) / proj.view[2] : 0);
  let grounded = 0;
  let attached = 0;
  const groupOf = new Map<number, number>();
  while (lift3.size < comps.length) {
    // the piece touching placed ones most, else the largest left
    let best = -1;
    const candidates = new Map<number, { moves: number[]; group: number }>();
    for (const t of touches) {
      const ca = comp.find(t.v);
      const cb = comp.find(t.e.a);
      for (const [mine, other] of [
        [ca, cb],
        [cb, ca],
      ] as const) {
        if (lift3.has(mine) || !lift3.has(other)) continue;
        // where this piece's corner meets the placed one's edge, or the placed corner meets this piece's edge
        const s = mine === ca ? meet(at(t.v), at(t.e.a), at(t.e.b), proj.view, lift3.get(other)!) : -meet(at(t.v), at(t.e.a), at(t.e.b), proj.view, -lift3.get(other)!);
        const c = candidates.get(mine);
        if (c) c.moves.push(s);
        else candidates.set(mine, { moves: [s], group: groupOf.get(other) ?? other });
      }
    }
    for (const [c, { moves }] of candidates) if (best < 0 || moves.length > candidates.get(best)!.moves.length) best = c;
    if (best >= 0) {
      const { moves, group } = candidates.get(best)!;
      moves.sort((a, b) => a - b);
      const s = moves[Math.floor(moves.length / 2)];
      if (lowest(best, s) < -tol3) {
        lift3.set(best, ground(best));
        groupOf.set(best, best);
        grounded++;
      } else {
        lift3.set(best, s);
        groupOf.set(best, group);
        attached++;
      }
      continue;
    }
    let largest = -1;
    for (const c of comps) if (!lift3.has(c) && (largest < 0 || compSize.get(c)! > compSize.get(largest)!)) largest = c;
    lift3.set(largest, ground(largest));
    groupOf.set(largest, largest);
    grounded++;
  }
  if (attached) notes.push(`${attached} separate piece${attached === 1 ? " was" : "s were"} placed where they touch others in the drawing.`);
  if (grounded > 1) notes.push(`${grounded} separate pieces were each stood on the ground.`);

  // ---- the 3D wireframe ---------------------------------------------------------------
  const world = (v: number): V3 => add3(at(v), mul3(proj.view, lift3.get(comp.find(v)) ?? 0));
  const groupLow = new Map<number, number>();
  for (let v = 0; v < verts.length; v++) {
    if (!adj[v].some(live)) continue;
    const g = groupOf.get(comp.find(v)) ?? comp.find(v);
    groupLow.set(g, Math.min(groupLow.get(g) ?? Infinity, world(v)[2]));
  }
  const index = new Int32Array(verts.length).fill(-1);
  const out: V3[] = [];
  const out2: Pt[] = [];
  for (let v = 0; v < verts.length; v++) {
    if (!adj[v].some(live)) continue;
    const p = world(v);
    // each group's lowest point exactly on the ground, against rounding
    const g = groupOf.get(comp.find(v)) ?? comp.find(v);
    const low = groupLow.get(g) ?? 0;
    if (Math.abs(low) < tol3) p[2] -= low;
    index[v] = out.length;
    out.push(p);
    out2.push(verts[v]);
  }
  let wire: [number, number][] = live2.map((e) => [index[e.a], index[e.b]]);
  wire = splitAtCorners(out, out2, wire, tol3);
  const faces = findFaces(out, wire, tol3, notes);

  return {
    axes: { x: proj.dirs[0], y: proj.dirs[1], z: proj.dirs[2], scale: [len2(proj.m[0]), len2(proj.m[1]), len2(proj.m[2])] },
    vertices: out.map((p): Vec3 => [round(p[0]), round(p[1]), round(p[2])]),
    edges: wire,
    faces,
    components: comps.length,
    skipped,
    notes,
  };
}

// ---- measuring ------------------------------------------------------------------------

/** A drawing's three axes: each one's drawn direction, and how long one world unit along it is drawn. */
export interface IsoAxes {
  readonly dirs: readonly [Pt, Pt, Pt];
  readonly m: readonly [Pt, Pt, Pt];
  /**
   * The direction it is seen from (unit, toward the eye), taken as from above: a drawing alone
   * can't tell that from below (a cube drawn in lines reads either way)
   */
  readonly from: Vec3;
  readonly notes: readonly string[];
}

/** The axes the line work is drawn along, as unprojectIso finds them, or null when it isn't axonometric. */
export function findAxes(segments: readonly IsoSegment[], opts: IsoOptions = {}): IsoAxes | null {
  const notes: string[] = [];
  const segs = segments.filter((s) => [s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite) && len2(sub2(s.b, s.a)) > 0);
  const p = segs.length >= 3 ? projection(segs, opts.scale, notes) : null;
  if (!p) return null;
  // the world direction drawn as a point is across both rows of the projection
  const v = unit3(cross3([p.m[0].x, p.m[1].x, p.m[2].x], [p.m[0].y, p.m[1].y, p.m[2].y]));
  const from: Vec3 = v[2] < 0 ? [-v[0], -v[1], -v[2]] : v;
  return { dirs: p.dirs, m: p.m, from, notes };
}

const AXIS_NAMES = ["x", "y", "z"] as const;
const PLANES: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, 2],
  [1, 2],
];

/** What a drawn line from `a` to `b` measures in the world. */
export interface DrawnReading {
  /** its length on the drawing */
  drawn: number;
  /** the axis it is drawn along, if any, and its true length along it (signed: + along the axis) */
  axis: "x" | "y" | "z" | null;
  length: number | null;
  /**
   * The line read as lying in each of the three planes through two axes: its run (dx, dy, dz),
   * true length and slope (degrees above level, 0 for the level plane). A drawn line is one of
   * these when it lies in such a plane: a gable's verge in an upright one, a hip's plan in the
   * level one.
   */
  planes: { plane: "xy" | "xz" | "yz"; run: Vec3; length: number; slope: number }[];
}

/** Reads a drawn line as world lengths along the drawing's axes. */
export function readDrawn(axes: IsoAxes, a: Pt, b: Pt): DrawnReading {
  const d = sub2(b, a);
  const drawn = len2(d);
  let axis: DrawnReading["axis"] = null;
  let length: number | null = null;
  for (let k = 0; k < 3; k++) {
    const m = axes.m[k];
    const ml = len2(m);
    if (ml > 0 && Math.abs(cross2(d, m)) <= drawn * Math.tan((AXIS_DEGREES * Math.PI) / 180) && (axis === null || Math.abs(cross2(d, m)) / ml < Math.abs(cross2(d, axes.m[AXIS_NAMES.indexOf(axis)])) / len2(axes.m[AXIS_NAMES.indexOf(axis)]))) {
      axis = AXIS_NAMES[k];
      length = round(dot2(d, m) / (ml * ml));
    }
  }
  const planes: DrawnReading["planes"] = [];
  for (const [i, j] of PLANES) {
    // d = u m_i + v m_j
    const det = cross2(axes.m[i], axes.m[j]);
    if (Math.abs(det) < 1e-12) continue;
    const u = cross2(d, axes.m[j]) / det;
    const v = cross2(axes.m[i], d) / det;
    const run: V3 = [0, 0, 0];
    run[i] = round(u);
    run[j] = round(v);
    const level = Math.hypot(run[0], run[1]);
    planes.push({
      plane: `${AXIS_NAMES[i]}${AXIS_NAMES[j]}` as "xy" | "xz" | "yz",
      run,
      length: round(Math.hypot(...run)),
      slope: round((Math.atan2(Math.abs(run[2]), level) * 180) / Math.PI),
    });
  }
  return { drawn: round(drawn), axis, length, planes };
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---- the projection ----------------------------------------------------------------

/** The three drawn axis directions (from a length-weighted histogram of line angles) and their foreshortening. */
function projection(segs: readonly IsoSegment[], scale: number | undefined, notes: string[]): Projection | null {
  const BINS = 1800;
  const hist = new Float64Array(BINS);
  let total = 0;
  const angles = segs.map((s) => {
    const d = sub2(s.b, s.a);
    const l = len2(d);
    const a = (((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180 + 180) % 180;
    hist[Math.min(BINS - 1, Math.floor((a / 180) * BINS))] += l;
    total += l;
    return { a, l };
  });
  // smoothed over half a degree either way
  const smooth = new Float64Array(BINS);
  for (let i = 0; i < BINS; i++) for (let k = -5; k <= 5; k++) smooth[i] += hist[(i + k + BINS) % BINS];
  const peaks: number[] = [];
  const angleOf = (i: number): number => ((i + 0.5) / BINS) * 180;
  const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
  for (let n = 0; n < 3; n++) {
    let best = -1;
    for (let i = 0; i < BINS; i++) {
      if (peaks.some((p) => apart(angleOf(i), p) < PEAK_SEPARATION)) continue;
      if (best < 0 || smooth[i] > smooth[best]) best = i;
    }
    if (best < 0 || smooth[best] < total * 0.03) {
      notes.push("The lines don't run along three main directions, so this doesn't look like an axonometric drawing.");
      return null;
    }
    // refined: the length-weighted mean of the angles near the peak (doubled, as angles wrap at 180)
    let sx = 0;
    let sy = 0;
    for (const { a, l } of angles) {
      if (apart(a, angleOf(best)) > 0.75) continue;
      sx += l * Math.cos((a * Math.PI) / 90);
      sy += l * Math.sin((a * Math.PI) / 90);
    }
    peaks.push(((((Math.atan2(sy, sx) * 90) / Math.PI) % 180) + 180) % 180);
  }
  // z is the one nearest upright, drawn upwards; x points right, y turns anticlockwise from x so the view is from above
  const zi = peaks.reduce((best, p, i) => (apart(p, 90) < apart(peaks[best], 90) ? i : best), 0);
  const rest = peaks.filter((_, i) => i !== zi);
  const dir = (deg: number): Pt => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
  const rightward = (deg: number): Pt => {
    const d = dir(deg);
    return d.x < 0 || (d.x === 0 && d.y < 0) ? { x: -d.x, y: -d.y } : d;
  };
  const signed = (d: Pt): number => Math.atan2(d.y, d.x);
  let [ux, uy] = rest.map(rightward);
  if (signed(uy) > signed(ux)) [ux, uy] = [uy, ux];
  if (cross2(ux, uy) < 0) uy = { x: -uy.x, y: -uy.y };
  let uz = dir(peaks[zi]);
  if (uz.y < 0) uz = { x: -uz.x, y: -uz.y };
  const dirs: [Pt, Pt, Pt] = [ux, uy, uz];

  // an orthographic view draws the axes so that Σ s²·u·uᵀ is the identity: solve for each s²
  let s2: number[] | null = null;
  if (scale && scale > 0) {
    s2 = [scale * scale, scale * scale, scale * scale];
  } else {
    const A = dirs.map((u) => [u.x * u.x, u.x * u.y, u.y * u.y]);
    const det = (m: number[][]): number => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    // columns are the axes, rows the three equations
    const M = [0, 1, 2].map((r) => [0, 1, 2].map((c) => A[c][r]));
    const rhs = [1, 0, 1];
    const D = det(M);
    if (Math.abs(D) > 1e-9) {
      s2 = [0, 1, 2].map((c) => det(M.map((row, r) => row.map((v, k) => (k === c ? rhs[r] : v)))) / D);
      if (s2.some((v) => !(v > 0.05 && v <= 1.0001))) s2 = null;
    }
    if (!s2) {
      s2 = [2 / 3, 2 / 3, 2 / 3];
      notes.push("The axis directions don't fit a true parallel projection, so each axis is taken as drawn at the isometric scale.");
    }
  }
  const s = s2.map(Math.sqrt);
  const m: [Pt, Pt, Pt] = [0, 1, 2].map((k) => ({ x: dirs[k].x * s[k], y: dirs[k].y * s[k] })) as [Pt, Pt, Pt];
  const r1: V3 = [m[0].x, m[1].x, m[2].x];
  const r2: V3 = [m[0].y, m[1].y, m[2].y];
  const view = unit3(cross3(r1, r2));
  const a = dot3(r1, r1);
  const b = dot3(r1, r2);
  const c = dot3(r2, r2);
  const det = a * c - b * b;
  const deg = (u: Pt): string => `${((((Math.atan2(u.y, u.x) * 180) / Math.PI) + 360) % 360).toFixed(1)}°`;
  notes.unshift(`Axes drawn at x ${deg(ux)}, y ${deg(uy)}, z ${deg(uz)}, one world unit drawn as ${s.map((v) => v.toFixed(3)).join(", ")}.`);
  return { dirs, m, view, inv: [c / det, -b / det, a / det] };
}

/** Which axis a drawn line runs along (0, 1, 2), or -1 for none. */
function axisOf(p: Projection, d: Pt, tol: number): number {
  const l = len2(d);
  let best = -1;
  let bestOff = Infinity;
  for (let k = 0; k < 3; k++) {
    const off = Math.abs(cross2(d, p.dirs[k]));
    if (off <= Math.max(tol * 0.5, l * Math.tan((AXIS_DEGREES * Math.PI) / 180)) && off < bestOff) {
      best = k;
      bestOff = off;
    }
  }
  return best;
}

// ---- cleaning ------------------------------------------------------------------------

/**
 * Pieces of one line joined into one (seen and hidden parts alike): pieces meeting end to end
 * where no other line ends (Make2D breaks a line where something hides it, and the hiding edge
 * passes through there; at a corner other lines end), and the same piece drawn twice.
 */
function mergeCollinear(segs: readonly IsoSegment[], p: Projection, tol: number): IsoSegment[] {
  const ends = new Map<string, number>();
  const endKey = (q: Pt): string => `${Math.round(q.x / tol)},${Math.round(q.y / tol)}`;
  const endsNear = (q: Pt): number => {
    const cx = Math.round(q.x / tol);
    const cy = Math.round(q.y / tol);
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += ends.get(`${cx + i},${cy + j}`) ?? 0;
    return n;
  };
  for (const s of segs) for (const q of [s.a, s.b]) ends.set(endKey(q), (ends.get(endKey(q)) ?? 0) + 1);
  const groups = new Map<string, { dir: Pt; items: { o: number; t0: number; t1: number; a: Pt; b: Pt; hidden: boolean }[] }>();
  for (const s of segs) {
    const d = sub2(s.b, s.a);
    const axis = axisOf(p, d, tol);
    let dir: Pt;
    let key: string;
    if (axis >= 0) {
      dir = p.dirs[axis];
      key = `a${axis}`;
    } else {
      const deg = (((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180 + 180) % 180;
      const bucket = Math.round(deg / 0.5) % 360;
      const r = ((bucket * 0.5) * Math.PI) / 180;
      dir = { x: Math.cos(r), y: Math.sin(r) };
      key = `o${bucket}`;
    }
    const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    let ta = dot2(s.a, dir);
    let tb = dot2(s.b, dir);
    let [a, b] = [s.a, s.b];
    if (tb < ta) {
      [ta, tb] = [tb, ta];
      [a, b] = [b, a];
    }
    const g = groups.get(key) ?? { dir, items: [] };
    g.items.push({ o: cross2(dir, mid), t0: ta, t1: tb, a, b, hidden: !!s.hidden });
    groups.set(key, g);
  }
  const out: IsoSegment[] = [];
  for (const g of groups.values()) {
    g.items.sort((x, y) => x.o - y.o);
    for (let i = 0; i < g.items.length; ) {
      let j = i + 1;
      while (j < g.items.length && g.items[j].o - g.items[i].o <= tol) j++;
      const line = g.items.slice(i, j).sort((x, y) => x.t0 - y.t0);
      let cur = { ...line[0] };
      for (const it of line.slice(1)) {
        // pieces meeting end to end, or the same piece twice; lines that only overlap in part are
        // different edges that happen to line up in the drawing
        const abutting = Math.abs(it.t0 - cur.t1) <= tol && endsNear(it.a) <= 2;
        const same = Math.abs(it.t0 - cur.t0) <= tol && Math.abs(it.t1 - cur.t1) <= tol;
        const within = it.t0 >= cur.t0 - tol && it.t1 <= cur.t1 + tol && same;
        if (abutting || within) {
          if (it.t1 > cur.t1) {
            cur.t1 = it.t1;
            cur.b = it.b;
          }
          cur.hidden = cur.hidden && it.hidden;
        } else {
          out.push({ a: cur.a, b: cur.b, hidden: cur.hidden });
          cur = { ...it };
        }
      }
      out.push({ a: cur.a, b: cur.b, hidden: cur.hidden });
      i = j;
    }
  }
  return out;
}

/**
 * Lines broken where nothing else ends, joined back into one: the corner between two pieces
 * that run on in a straight line. Pieces of a sloping line can lean a little differently and
 * miss each other above, and a break left in would read as a corner of the model.
 */
function joinBreaks(verts: readonly Pt[], lines: readonly [number, number][], tol: number): [number, number][] {
  const out = lines.map(([a, b]): [number, number] => [a, b]);
  const gone = new Uint8Array(out.length);
  const at: number[][] = verts.map(() => []);
  out.forEach(([a, b], i) => {
    at[a].push(i);
    at[b].push(i);
  });
  for (let v = 0; v < verts.length; v++) {
    if (at[v].length !== 2) continue;
    const [i, j] = at[v];
    const p = out[i][0] === v ? out[i][1] : out[i][0];
    const q = out[j][0] === v ? out[j][1] : out[j][0];
    if (p === q) continue;
    const { dist, t } = along(verts[v], verts[p], verts[q]);
    if (dist > tol || t <= 0 || t >= 1) continue;
    out[i] = [p, q];
    gone[j] = 1;
    at[v] = [];
    at[q] = at[q].map((k) => (k === j ? i : k));
  }
  return out.filter((_, i) => !gone[i]);
}

class UnionFind {
  private readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n).map((_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  /** joins the sets of a and b; false when they were one already */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

/** A grid over segments' bounding boxes, for finding the segments near a point. */
function segmentGrid(pts: readonly Pt[], edges: readonly { a: number; b: number }[]): { near(p: Pt, r: number): number[] } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const n = Math.max(1, Math.min(512, Math.ceil(Math.sqrt(edges.length) * 2)));
  const size = Math.max(x1 - x0, y1 - y0, 1e-9) / n;
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number): number => i * 4096 + j;
  edges.forEach((e, k) => {
    const a = pts[e.a];
    const b = pts[e.b];
    const i0 = Math.floor((Math.min(a.x, b.x) - x0) / size);
    const i1 = Math.floor((Math.max(a.x, b.x) - x0) / size);
    const j0 = Math.floor((Math.min(a.y, b.y) - y0) / size);
    const j1 = Math.floor((Math.max(a.y, b.y) - y0) / size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = cells.get(key(i, j));
        if (list) list.push(k);
        else cells.set(key(i, j), [k]);
      }
    }
  });
  return {
    near(p: Pt, r: number): number[] {
      const out = new Set<number>();
      for (let i = Math.floor((p.x - r - x0) / size); i <= Math.floor((p.x + r - x0) / size); i++) {
        for (let j = Math.floor((p.y - r - y0) / size); j <= Math.floor((p.y + r - y0) / size); j++) for (const k of cells.get(key(i, j)) ?? []) out.add(k);
      }
      return [...out];
    },
  };
}

/** How far `p` lies from segment ab, and where along it (0 to 1). */
function along(p: Pt, a: Pt, b: Pt): { dist: number; t: number } {
  const d = sub2(b, a);
  const l2 = dot2(d, d);
  const t = l2 > 0 ? dot2(sub2(p, a), d) / l2 : 0;
  const q = { x: a.x + d.x * t, y: a.y + d.y * t };
  return { dist: len2(sub2(p, q)), t };
}

/** Corners drawn on another edge's middle, where pieces of the line work touch. */
function touchings(verts: readonly Pt[], edges: readonly { a: number; b: number }[], tol: number): { v: number; e: { a: number; b: number } }[] {
  const grid = segmentGrid(verts, edges);
  const used = new Uint8Array(verts.length);
  for (const e of edges) used[e.a] = used[e.b] = 1;
  const out: { v: number; e: { a: number; b: number } }[] = [];
  for (let v = 0; v < verts.length; v++) {
    if (!used[v]) continue;
    for (const k of grid.near(verts[v], tol)) {
      const e = edges[k];
      if (e.a === v || e.b === v) continue;
      const l = len2(sub2(verts[e.b], verts[e.a]));
      const { dist, t } = along(verts[v], verts[e.a], verts[e.b]);
      if (dist <= tol && t * l > tol && (1 - t) * l > tol) out.push({ v, e });
    }
  }
  return out;
}

/**
 * How far along the view the piece holding corner `pv` must move for the corner to lie on edge
 * ab of a piece already moved `other` along it: least squares of pv + δ·view = a + t·(b - a).
 */
function meet(pv: V3, pa: V3, pb: V3, view: V3, other: number): number {
  const a = add3(pa, mul3(view, other));
  const e = sub3(pb, pa);
  const r = sub3(a, pv);
  // [view, -e] [δ, t]ᵀ = r
  const m11 = dot3(view, view);
  const m12 = -dot3(view, e);
  const m22 = dot3(e, e);
  const b1 = dot3(view, r);
  const b2 = -dot3(e, r);
  const det = m11 * m22 - m12 * m12;
  if (Math.abs(det) < 1e-12) return other;
  return (b1 * m22 - m12 * b2) / det;
}

// ---- faces -----------------------------------------------------------------------------

/** Edges split where another edge's corner lies on them in 3D, so faces can close there. */
function splitAtCorners(pts: readonly V3[], drawn: readonly Pt[], edges: [number, number][], tol: number): [number, number][] {
  const grid = segmentGrid(drawn, edges.map(([a, b]) => ({ a, b })));
  const cuts = new Map<number, { t: number; v: number }[]>();
  for (let v = 0; v < pts.length; v++) {
    for (const k of grid.near(drawn[v], tol)) {
      const [a, b] = edges[k];
      if (a === v || b === v) continue;
      const e = sub3(pts[b], pts[a]);
      const l2 = dot3(e, e);
      if (!(l2 > 0)) continue;
      const t = dot3(sub3(pts[v], pts[a]), e) / l2;
      const l = Math.sqrt(l2);
      if (t * l <= tol || (1 - t) * l <= tol) continue;
      if (norm3(sub3(pts[v], add3(pts[a], mul3(e, t)))) > tol) continue;
      const list = cuts.get(k);
      if (list) list.push({ t, v });
      else cuts.set(k, [{ t, v }]);
    }
  }
  const out: [number, number][] = [];
  const seen = new Set<string>();
  const push = (a: number, b: number): void => {
    if (a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a, b]);
  };
  edges.forEach(([a, b], k) => {
    const list = cuts.get(k);
    if (!list) return push(a, b);
    list.sort((x, y) => x.t - y.t);
    let prev = a;
    for (const { v } of list) {
      push(prev, v);
      prev = v;
    }
    push(prev, b);
  });
  return out;
}

/**
 * Closed loops of edges in each plane two edges at a corner span. In each plane the edges are
 * split where they cross, then every face is walked keeping it on the left; the outer loops
 * (walked clockwise) and loops inside a larger one (holes, drawn again as faces) are dropped.
 */
function findFaces(pts: V3[], edges: readonly [number, number][], tol: number, notes: string[]): number[][] {
  const dirs = edges.map(([a, b]) => unit3(sub3(pts[b], pts[a])));
  const at: number[][] = pts.map(() => []);
  edges.forEach(([a, b], i) => {
    at[a].push(i);
    at[b].push(i);
  });
  // the normals two edges at a corner give, each kept once
  const normals = new Map<string, V3>();
  const canon = (n: V3): V3 => {
    const e = 1e-6;
    return n[2] < -e || (Math.abs(n[2]) <= e && (n[1] < -e || (Math.abs(n[1]) <= e && n[0] < 0))) ? mul3(n, -1) : n;
  };
  for (const list of at) {
    const k = Math.min(list.length, 12);
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const c = cross3(dirs[list[i]], dirs[list[j]]);
        if (norm3(c) < Math.sin((3 * Math.PI) / 180)) continue;
        const n = canon(unit3(c));
        normals.set(n.map((x) => Math.round(x * 500)).join(","), n);
      }
    }
  }
  const faces: number[][] = [];
  const keys = new Set<string>();
  let crowded = 0;
  for (const n of normals.values()) {
    // the edges lying across this normal, by their distance along it
    const flat: { o: number; i: number }[] = [];
    edges.forEach(([a, b], i) => {
      if (Math.abs(dot3(dirs[i], n)) > 2e-3) return;
      const oa = dot3(pts[a], n);
      if (Math.abs(dot3(pts[b], n) - oa) > tol) return;
      flat.push({ o: oa, i });
    });
    flat.sort((x, y) => x.o - y.o);
    for (let i = 0; i < flat.length; ) {
      let j = i + 1;
      while (j < flat.length && flat[j].o - flat[i].o <= tol) j++;
      if (j - i >= 3) {
        if (j - i > PLANE_EDGES) crowded++;
        else for (const f of planeFaces(pts, edges, flat.slice(i, j).map((x) => x.i), n, tol)) {
          const key = [...f].sort((x, y) => x - y).join(",");
          if (keys.has(key)) continue;
          keys.add(key);
          faces.push(f);
          if (faces.length >= MAX_FACES) {
            notes.push(`Stopped at ${MAX_FACES} faces.`);
            return faces;
          }
        }
      }
      i = j;
    }
  }
  if (crowded) notes.push(`${crowded} plane${crowded === 1 ? " held" : "s held"} too many edges to look for faces in.`);
  return faces;
}

function planeFaces(pts: V3[], edges: readonly [number, number][], ids: readonly number[], n: V3, tol: number): number[][] {
  const u = unit3(Math.abs(n[2]) < 0.9 ? cross3([0, 0, 1], n) : cross3([1, 0, 0], n));
  const w = cross3(n, u);
  const flat = (v: number): Pt => ({ x: dot3(pts[v], u), y: dot3(pts[v], w) });
  // the plane's edges, split where they cross one another
  let segs = ids.map((i) => [...edges[i]] as [number, number]);
  if (segs.length <= 1500) {
    const cuts = segs.map(() => [] as { t: number; v: number }[]);
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      const pa = flat(a);
      const pb = flat(b);
      for (let j = i + 1; j < segs.length; j++) {
        const [c, d] = segs[j];
        if (c === a || c === b || d === a || d === b) continue;
        const pc = flat(c);
        const pd = flat(d);
        const r = sub2(pb, pa);
        const s = sub2(pd, pc);
        const den = cross2(r, s);
        if (Math.abs(den) < 1e-12) continue;
        const t = cross2(sub2(pc, pa), s) / den;
        const q = cross2(sub2(pc, pa), r) / den;
        const lr = len2(r);
        const ls = len2(s);
        if (t * lr <= tol || (1 - t) * lr <= tol || q * ls <= tol || (1 - q) * ls <= tol) continue;
        const v = pts.length;
        pts.push(add3(pts[a], mul3(sub3(pts[b], pts[a]), t)));
        cuts[i].push({ t, v });
        cuts[j].push({ t: q, v });
      }
    }
    const next: [number, number][] = [];
    segs.forEach(([a, b], i) => {
      const list = cuts[i].sort((x, y) => x.t - y.t);
      let prev = a;
      for (const { v } of list) {
        next.push([prev, v]);
        prev = v;
      }
      next.push([prev, b]);
    });
    segs = next;
  }
  // dangling edges bound no face: pruned, so the loops they sit in stay simple
  for (let pruned = true; pruned; ) {
    pruned = false;
    const degree = new Map<number, number>();
    for (const [a, b] of segs) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    const kept = segs.filter(([a, b]) => degree.get(a)! > 1 && degree.get(b)! > 1);
    if (kept.length < segs.length) {
      segs = kept;
      pruned = true;
    }
  }
  if (segs.length < 3) return [];
  const around = new Map<number, { to: number; angle: number }[]>();
  const p2 = new Map<number, Pt>();
  const flatOf = (v: number): Pt => {
    let p = p2.get(v);
    if (!p) {
      p = flat(v);
      p2.set(v, p);
    }
    return p;
  };
  for (const [a, b] of segs) {
    const pa = flatOf(a);
    const pb = flatOf(b);
    for (const [x, y, px, py] of [
      [a, b, pa, pb],
      [b, a, pb, pa],
    ] as const) {
      const list = around.get(x) ?? [];
      list.push({ to: y, angle: Math.atan2(py.y - px.y, py.x - px.x) });
      around.set(x, list);
    }
  }
  for (const list of around.values()) list.sort((p, q) => p.angle - q.angle);
  const used = new Set<string>();
  const loops: { vs: number[]; area: number }[] = [];
  for (const [a, b] of segs) {
    for (const [s0, s1] of [
      [a, b],
      [b, a],
    ]) {
      if (used.has(`${s0}>${s1}`)) continue;
      const vs: number[] = [];
      let [x, y] = [s0, s1];
      let ok = false;
      for (let guard = 0; guard < 4 * segs.length + 8; guard++) {
        used.add(`${x}>${y}`);
        vs.push(x);
        const list = around.get(y)!;
        const back = list.findIndex((e) => e.to === x);
        const nxt = list[(back - 1 + list.length) % list.length].to;
        [x, y] = [y, nxt];
        if (x === s0 && y === s1) {
          ok = true;
          break;
        }
      }
      if (!ok || vs.length < 3) continue;
      let area = 0;
      for (let i = 0; i < vs.length; i++) area += cross2(flatOf(vs[i]), flatOf(vs[(i + 1) % vs.length]));
      if (area / 2 > tol * tol) loops.push({ vs, area: area / 2 });
    }
  }
  // a loop inside a larger one is a hole in it: the larger face covers it
  if (loops.length <= 400) {
    loops.sort((p, q) => q.area - p.area);
    const keep = loops.filter((l, i) => {
      const probe = inside(l.vs.map(flatOf));
      return !loops.slice(0, i).some((big) => big.area > l.area && pointIn(probe, big.vs.map(flatOf)));
    });
    return keep.map((l) => l.vs).filter(simple);
  }
  return loops.map((l) => l.vs).filter(simple);
}

/** a loop that doesn't come back through a corner it passed (dangling edges walked both ways) */
function simple(vs: readonly number[]): boolean {
  return new Set(vs).size === vs.length;
}

/** A point just inside an anticlockwise loop, off the middle of its longest side. */
function inside(poly: readonly Pt[]): Pt {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < poly.length; i++) {
    const l = len2(sub2(poly[(i + 1) % poly.length], poly[i]));
    if (l > bestLen) {
      best = i;
      bestLen = l;
    }
  }
  const a = poly[best];
  const b = poly[(best + 1) % poly.length];
  const d = sub2(b, a);
  const k = 1e-4;
  return { x: (a.x + b.x) / 2 - d.y * k, y: (a.y + b.y) / 2 + d.x * k };
}

function pointIn(p: Pt, poly: readonly Pt[]): boolean {
  let inPoly = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inPoly = !inPoly;
  }
  return inPoly;
}

