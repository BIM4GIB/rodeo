// The sums behind ConnectCAD's Cable Route tool set (cableRoute.ts): a cable path's corners in 3D as
// the Cable Route tool clicks them (a rise or drop where the height changes), where a point falls on
// a path and the path split there, a new drop point's name, and the network cable paths make, whose
// shortest route between the places cables join it Calculate Cable Lengths takes. Kept apart so it
// runs without the page.

import type { Pt } from "../../../core/index.ts";
import { insideRing } from "./layoutShapes.ts";

export interface Pt3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** how near cable paths' corners come in 3D to join them into a network, mm */
export const JOIN = 10;

const flat = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const span = (a: Pt3, b: Pt3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A path's corners from the clicks, each at the height it was clicked at: where the height changes, it rises or drops at the corner before. */
export function routeCorners(clicks: readonly Pt3[]): Pt3[] {
  const out: Pt3[] = [];
  for (const c of clicks) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.z - c.z) > 1e-6) out.push({ x: last.x, y: last.y, z: c.z });
    const prev = out[out.length - 1];
    if (!prev || span(prev, c) > 1e-6) out.push(c);
  }
  return out;
}

/** A path's length in 3D. */
export const pathLength3 = (points: readonly Pt3[]): number => points.slice(1).reduce((n, p, i) => n + span(points[i], p), 0);

/** The point of a path nearest `p` on the drawing: the piece it's on (from corner `i`), how far along it (0 to 1), the point with its height, and how far it is from `p`. */
export function nearestOnPath(points: readonly Pt3[], p: Pt): { i: number; t: number; at: Pt3; d: number } | null {
  let best: { i: number; t: number; at: Pt3; d: number } | null = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    const t = len > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    const at = { x: a.x + t * dx, y: a.y + t * dy, z: a.z + t * (b.z - a.z) };
    const d = flat(at, p);
    if (!best || d < best.d - 1e-9) best = { i, t, at, d };
  }
  if (!best && points.length === 1) best = { i: 0, t: 0, at: points[0], d: flat(points[0], p) };
  return best;
}

/** A path split in two at the point `t` along its piece from corner `i`; null when that's one of its ends. */
export function splitPath(points: readonly Pt3[], i: number, t: number): [Pt3[], Pt3[]] | null {
  const a = points[i];
  const b = points[i + 1];
  if (!a || !b) return null;
  const at = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
  const apart = (list: Pt3[]): Pt3[] => list.filter((p, k) => k === 0 || span(p, list[k - 1]) > 1e-6);
  const head = apart([...points.slice(0, i + 1), at]);
  const tail = apart([at, ...points.slice(i + 1)]);
  return head.length >= 2 && tail.length >= 2 ? [head, tail] : null;
}

/** letters of drop points' names: I and O are passed by, as Vectorworks does, so they aren't read as 1 and 0 */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** The first drop point name not in `taken`: A, B… Z, then AA, AB… */
export function dropName(taken: ReadonlySet<string>): string {
  for (let n = 0; ; n++) {
    let name = "";
    for (let k = n; ; k = Math.floor(k / LETTERS.length) - 1) {
      name = LETTERS[k % LETTERS.length] + name;
      if (k < LETTERS.length) break;
    }
    if (!taken.has(name)) return name;
  }
}

/** A cable path for the network: its object and its corners on the drawing. */
export interface NetPath {
  readonly id: string;
  readonly points: readonly Pt3[];
}

/** The network cable paths make: corners joined where they meet, and each path's pieces between them. */
export interface Network {
  readonly nodes: readonly Pt3[];
  readonly edges: readonly { readonly a: number; readonly b: number; readonly length: number; readonly path: string }[];
}

/** The network of `paths`, corners within `join` of each other in 3D made one. */
export function network(paths: readonly NetPath[], join = JOIN): Network {
  const nodes: Pt3[] = [];
  const edges: { a: number; b: number; length: number; path: string }[] = [];
  const nodeAt = (p: Pt3): number => {
    const k = nodes.findIndex((q) => span(p, q) <= join);
    if (k >= 0) return k;
    nodes.push(p);
    return nodes.length - 1;
  };
  for (const path of paths) {
    const ids = path.points.map(nodeAt);
    for (let i = 0; i + 1 < ids.length; i++) if (ids[i] !== ids[i + 1]) edges.push({ a: ids[i], b: ids[i + 1], length: span(path.points[i], path.points[i + 1]), path: path.id });
  }
  return { nodes, edges };
}

/** The network's corners within `within` of `p` on the drawing (whatever their height). */
export const nodesNear = (net: Network, p: Pt, within: number): number[] => net.nodes.flatMap((q, k) => (flat(q, p) <= within ? [k] : []));

/** The network's corners inside an outline on the drawing. */
export const nodesInside = (net: Network, ring: readonly Pt[]): number[] => net.nodes.flatMap((q, k) => (insideRing(q, ring) ? [k] : []));

function toSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** how near a cable path's corner comes to equipment, a rack or a drop point in plan to join it, mm */
export const ATTACH = 50;

/** The network's corners at an outline on the drawing: inside it, or within `within` of its sides. */
export const nodesAt = (net: Network, ring: readonly Pt[], within = ATTACH): number[] =>
  net.nodes.flatMap((q, k) => (insideRing(q, ring) || ring.some((a, i) => toSegment(q, a, ring[(i + 1) % ring.length]) <= within) ? [k] : []));

/** Where equipment whose middle is `height` up joins the network at an outline (its own, or its rack's): the corners there, each with the rise or drop from the equipment to it. */
export const joinAtOutline = (net: Network, ring: readonly Pt[], height: number, within = ATTACH): Map<number, number> => new Map(nodesAt(net, ring, within).map((k) => [k, Math.abs(net.nodes[k].z - height)]));

/** Where equipment at `to`, its middle `height` up, joins the network through a drop point at `at`: the corners there, each with the way from it to the drop point and on to the equipment. */
export const joinAtDrop = (net: Network, at: Pt, to: Pt, height: number, within = ATTACH): Map<number, number> =>
  new Map(nodesNear(net, at, within).map((k) => [k, Math.abs(net.nodes[k].z - height) + Math.hypot(at.x - to.x, at.y - to.y)]));

/**
 * The shortest way through the network from where a cable joins it to where it leaves: each a set of
 * corners, with the length it takes to reach each from the equipment. Its length and the pieces it
 * takes (by edge), or null when no way joins them.
 */
export function shortestRoute(net: Network, from: ReadonlyMap<number, number>, to: ReadonlyMap<number, number>): { length: number; edges: number[] } | null {
  const near = new Map<number, { to: number; edge: number; length: number }[]>();
  net.edges.forEach((e, k) => {
    near.set(e.a, [...(near.get(e.a) ?? []), { to: e.b, edge: k, length: e.length }]);
    near.set(e.b, [...(near.get(e.b) ?? []), { to: e.a, edge: k, length: e.length }]);
  });
  const dist = new Map<number, number>(from);
  const back = new Map<number, { node: number; edge: number }>();
  const done = new Set<number>();
  let best: { node: number; length: number } | null = null;
  for (;;) {
    let here = -1;
    for (const [n, d] of dist) if (!done.has(n) && (here < 0 || d < dist.get(here)!)) here = n;
    if (here < 0) break;
    const so = dist.get(here)!;
    if (best && so >= best.length) break;
    done.add(here);
    const leave = to.get(here);
    if (leave !== undefined && (!best || so + leave < best.length)) best = { node: here, length: so + leave };
    for (const n of near.get(here) ?? []) {
      const d = so + n.length;
      if (!done.has(n.to) && d < (dist.get(n.to) ?? Infinity)) {
        dist.set(n.to, d);
        back.set(n.to, { node: here, edge: n.edge });
      }
    }
  }
  if (!best) return null;
  const edges: number[] = [];
  for (let n = best.node; back.has(n); n = back.get(n)!.node) edges.unshift(back.get(n)!.edge);
  return { length: best.length, edges };
}

/** the routes Select Alternative Route offers at most, lettered A (the shortest) to F */
export const ROUTE_LETTERS = "ABCDEF";

/** A route's letter: A the shortest, B the next… */
export const routeLetter = (rank: number): string => ROUTE_LETTERS[Math.max(0, Math.min(ROUTE_LETTERS.length - 1, Math.round(rank)))];

/** A kept letter's rank: 0 for A, an empty field or anything else. */
export const routeRank = (letter: string): number => Math.max(0, ROUTE_LETTERS.indexOf(letter.trim().toUpperCase().slice(0, 1) || "A"));

interface Arc {
  readonly to: number;
  /** the same for both ways along a piece */
  readonly key: string;
  /** the network's edge, or -1 for joining at either end */
  readonly edge: number;
  readonly length: number;
}

interface Way {
  readonly nodes: readonly number[];
  readonly arcs: readonly Arc[];
  readonly length: number;
}

/** The shortest way from `start` to `goal` past the arcs and corners banned, by a heap. */
function search(arcs: ReadonlyMap<number, readonly Arc[]>, start: number, goal: number, banArcs: ReadonlySet<string>, banNodes: ReadonlySet<number>): Way | null {
  const dist = new Map<number, number>([[start, 0]]);
  const back = new Map<number, { node: number; arc: Arc }>();
  const heap: [number, number][] = [[0, start]];
  const up = (i: number): void => {
    for (let p = (i - 1) >> 1; i > 0 && heap[p][0] > heap[i][0]; i = p, p = (i - 1) >> 1) [heap[p], heap[i]] = [heap[i], heap[p]];
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (d > dist.get(n)!) continue;
    if (n === goal) break;
    for (const a of arcs.get(n) ?? []) {
      if (banArcs.has(a.key) || banNodes.has(a.to)) continue;
      const nd = d + a.length;
      if (nd < (dist.get(a.to) ?? Infinity)) {
        dist.set(a.to, nd);
        back.set(a.to, { node: n, arc: a });
        heap.push([nd, a.to]);
        up(heap.length - 1);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const nodes = [goal];
  const taken: Arc[] = [];
  for (let n = goal; back.has(n); n = back.get(n)!.node) {
    taken.unshift(back.get(n)!.arc);
    nodes.unshift(back.get(n)!.node);
  }
  return { nodes, arcs: taken, length: dist.get(goal)! };
}

/**
 * Up to `k` ways through the network between where a cable joins it and where it leaves (as
 * shortestRoute takes them), shortest first: Yen's way, each next one the shortest that turns off one
 * already found. A way that takes a shorter one's pieces and more (passing a corner it could have
 * joined at) isn't one, so isn't offered.
 */
export function shortestRoutes(net: Network, from: ReadonlyMap<number, number>, to: ReadonlyMap<number, number>, k = ROUTE_LETTERS.length): { length: number; edges: number[] }[] {
  const start = net.nodes.length;
  const goal = start + 1;
  const arcs = new Map<number, Arc[]>();
  const add = (n: number, a: Arc): void => void (arcs.get(n)?.push(a) ?? arcs.set(n, [a]));
  net.edges.forEach((e, i) => {
    add(e.a, { to: e.b, key: `e${i}`, edge: i, length: e.length });
    add(e.b, { to: e.a, key: `e${i}`, edge: i, length: e.length });
  });
  for (const [n, d] of from) add(start, { to: n, key: `s${n}`, edge: -1, length: d });
  for (const [n, d] of to) add(n, { to: goal, key: `t${n}`, edge: -1, length: d });
  const first = search(arcs, start, goal, new Set(), new Set());
  if (!first) return [];
  const found: Way[] = [first];
  const pending: Way[] = [];
  const seen = new Set([first.arcs.map((a) => a.key).join()]);
  // more than k found, since some are left out below
  while (found.length < 3 * k) {
    const last = found[found.length - 1];
    for (let i = 0; i + 1 < last.nodes.length; i++) {
      const root = last.nodes.slice(0, i + 1);
      const banArcs = new Set(found.filter((w) => w.nodes.length > i + 1 && root.every((n, j) => w.nodes[j] === n)).map((w) => w.arcs[i].key));
      const tail = search(arcs, last.nodes[i], goal, banArcs, new Set(root.slice(0, -1)));
      if (!tail) continue;
      const head = last.arcs.slice(0, i);
      const way: Way = { nodes: [...root.slice(0, -1), ...tail.nodes], arcs: [...head, ...tail.arcs], length: head.reduce((n, a) => n + a.length, 0) + tail.length };
      const key = way.arcs.map((a) => a.key).join();
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push(way);
    }
    if (!pending.length) break;
    pending.sort((a, b) => a.length - b.length);
    found.push(pending.shift()!);
  }
  const out: { length: number; edges: number[] }[] = [];
  for (const w of found) {
    const edges = w.arcs.filter((a) => a.edge >= 0).map((a) => a.edge);
    const has = new Set(edges);
    if (out.some((o) => o.edges.every((e) => has.has(e)))) continue;
    out.push({ length: w.length, edges });
    if (out.length >= k) break;
  }
  return out;
}

/** A spare cable's number: the drop points it runs between and the next number for them (A-B-1, A-B-2…) past those `taken`. */
export function spareNumber(a: string, b: string, taken: Iterable<string>): string {
  const head = `${a}-${b}-`;
  let most = 0;
  for (const t of taken) if (t.startsWith(head) && /^\d+$/.test(t.slice(head.length))) most = Math.max(most, Number(t.slice(head.length)));
  return `${head}${most + 1}`;
}
