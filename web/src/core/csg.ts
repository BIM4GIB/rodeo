// Boolean operations on triangle meshes by BSP trees, after Evan Wallace's csg.js (MIT): enough
// for the 3D view to show a solid subtraction saved without its body (FORMAT.md §3D), and for
// Intersect Solids. Each mesh is a closed triangle soup, 9 numbers a triangle; the result is one
// too, with the edges where its faces meet at a crease.

/** Most triangles a subtraction takes on; past this the tree's depth and time grow too far. */
export const MAX_CSG_TRIANGLES = 4000;
/** Points this close, as a share of the meshes' size, are one point. */
const EPSILON = 1e-7;

interface Poly {
  /** corners, x y z each, round the face */
  p: number[];
  nx: number;
  ny: number;
  nz: number;
  w: number;
}

const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

function flip(q: Poly): Poly {
  const p: number[] = [];
  for (let i = q.p.length - 3; i >= 0; i -= 3) p.push(q.p[i], q.p[i + 1], q.p[i + 2]);
  return { p, nx: -q.nx, ny: -q.ny, nz: -q.nz, w: -q.w };
}

/** Sorts `q` against `plane`'s side, splitting it when it spans. */
function split(plane: Poly, q: Poly, eps: number, coFront: Poly[], coBack: Poly[], front: Poly[], back: Poly[]): void {
  const n = q.p.length / 3;
  const types: number[] = [];
  let kind = 0;
  for (let i = 0; i < n; i++) {
    const t = plane.nx * q.p[3 * i] + plane.ny * q.p[3 * i + 1] + plane.nz * q.p[3 * i + 2] - plane.w;
    const type = t < -eps ? BACK : t > eps ? FRONT : COPLANAR;
    kind |= type;
    types.push(type);
  }
  if (kind === COPLANAR) (plane.nx * q.nx + plane.ny * q.ny + plane.nz * q.nz > 0 ? coFront : coBack).push(q);
  else if (kind === FRONT) front.push(q);
  else if (kind === BACK) back.push(q);
  else {
    const f: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ti, tj] = [types[i], types[j]];
      const [x, y, z] = [q.p[3 * i], q.p[3 * i + 1], q.p[3 * i + 2]];
      if (ti !== BACK) f.push(x, y, z);
      if (ti !== FRONT) b.push(x, y, z);
      if ((ti | tj) === SPANNING) {
        const [dx, dy, dz] = [q.p[3 * j] - x, q.p[3 * j + 1] - y, q.p[3 * j + 2] - z];
        const t = (plane.w - (plane.nx * x + plane.ny * y + plane.nz * z)) / (plane.nx * dx + plane.ny * dy + plane.nz * dz);
        f.push(x + t * dx, y + t * dy, z + t * dz);
        b.push(x + t * dx, y + t * dy, z + t * dz);
      }
    }
    if (f.length >= 9) front.push({ ...q, p: f });
    if (b.length >= 9) back.push({ ...q, p: b });
  }
}

class Node {
  plane: Poly | null = null;
  front: Node | null = null;
  back: Node | null = null;
  polys: Poly[] = [];

  constructor(private eps: number) {}

  /** Every node below this one, this one first. */
  private nodes(): Node[] {
    const out: Node[] = [];
    const stack: Node[] = [this];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      if (n.front) stack.push(n.front);
      if (n.back) stack.push(n.back);
    }
    return out;
  }

  build(polys: Poly[]): void {
    const stack: [Node, Poly[]][] = [[this, polys]];
    while (stack.length) {
      const [node, list] = stack.pop()!;
      if (!list.length) continue;
      node.plane ??= list[0];
      const front: Poly[] = [];
      const back: Poly[] = [];
      for (const q of list) split(node.plane, q, this.eps, node.polys, node.polys, front, back);
      if (front.length) stack.push([(node.front ??= new Node(this.eps)), front]);
      if (back.length) stack.push([(node.back ??= new Node(this.eps)), back]);
    }
  }

  invert(): void {
    for (const n of this.nodes()) {
      n.polys = n.polys.map(flip);
      if (n.plane) n.plane = flip(n.plane);
      [n.front, n.back] = [n.back, n.front];
    }
  }

  /** The parts of `polys` outside this tree's solid. */
  clip(polys: Poly[]): Poly[] {
    const out: Poly[] = [];
    const stack: [Node, Poly[]][] = [[this, polys]];
    while (stack.length) {
      const [node, list] = stack.pop()!;
      if (!node.plane) {
        out.push(...list);
        continue;
      }
      const front: Poly[] = [];
      const back: Poly[] = [];
      for (const q of list) split(node.plane, q, this.eps, front, back, front, back);
      if (node.front) stack.push([node.front, front]);
      else out.push(...front);
      if (node.back) stack.push([node.back, back]);
    }
    return out;
  }

  clipTo(other: Node): void {
    for (const n of this.nodes()) n.polys = other.clip(n.polys);
  }

  all(): Poly[] {
    return this.nodes().flatMap((n) => n.polys);
  }
}

/**
 * `tris` turned to face outward: the 3D view draws both sides, so meshes come wound either way.
 * Triangles sharing a side are made to run along it in opposite directions, and each connected
 * piece then turned round if it encloses a negative volume. Points within `weld` are one.
 */
export function outward(tris: ArrayLike<number>, weld: number): Float64Array {
  const out = Float64Array.from(tris);
  const count = Math.floor(out.length / 9);
  const ids = new Map<string, number>();
  const point = (i: number): number => {
    const k = `${Math.round(out[i] / weld)},${Math.round(out[i + 1] / weld)},${Math.round(out[i + 2] / weld)}`;
    let n = ids.get(k);
    if (n === undefined) ids.set(k, (n = ids.size));
    return n;
  };
  const corners = new Int32Array(3 * count);
  for (let t = 0; t < count; t++) for (let k = 0; k < 3; k++) corners[3 * t + k] = point(9 * t + 3 * k);
  const sideKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  const bySide = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const key = sideKey(corners[3 * t + k], corners[3 * t + ((k + 1) % 3)]);
      const list = bySide.get(key);
      if (list) list.push(t);
      else bySide.set(key, [t]);
    }
  }
  const turned = new Uint8Array(count);
  const seen = new Uint8Array(count);
  // whether triangle t, as it now runs, goes from a to b
  const runs = (t: number, a: number, b: number): boolean => {
    const c = turned[t] ? [corners[3 * t], corners[3 * t + 2], corners[3 * t + 1]] : [corners[3 * t], corners[3 * t + 1], corners[3 * t + 2]];
    return (c[0] === a && c[1] === b) || (c[1] === a && c[2] === b) || (c[2] === a && c[0] === b);
  };
  for (let start = 0; start < count; start++) {
    if (seen[start]) continue;
    const piece: number[] = [];
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const t = queue.pop()!;
      piece.push(t);
      for (let k = 0; k < 3; k++) {
        const [a, b] = [corners[3 * t + k], corners[3 * t + ((k + 1) % 3)]];
        const [from, to] = runs(t, a, b) ? [a, b] : [b, a];
        for (const u of bySide.get(sideKey(a, b)) ?? []) {
          if (seen[u]) continue;
          seen[u] = 1;
          if (runs(u, from, to)) turned[u] = 1;
          queue.push(u);
        }
      }
    }
    // measured from one of its points, where the numbers are small
    let volume = 0;
    const o = 9 * start;
    for (const t of piece) {
      const i = 9 * t;
      const [j, k] = turned[t] ? [i + 6, i + 3] : [i + 3, i + 6];
      const [ax, ay, az] = [out[i] - out[o], out[i + 1] - out[o + 1], out[i + 2] - out[o + 2]];
      const [bx, by, bz] = [out[j] - out[o], out[j + 1] - out[o + 1], out[j + 2] - out[o + 2]];
      const [cx, cy, cz] = [out[k] - out[o], out[k + 1] - out[o + 1], out[k + 2] - out[o + 2]];
      volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    if (volume < 0) for (const t of piece) turned[t] ^= 1;
  }
  for (let t = 0; t < count; t++) {
    if (!turned[t]) continue;
    const i = 9 * t;
    for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
  }
  return out;
}

function polysOf(tris: ArrayLike<number>, cx: number, cy: number, cz: number): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const p = [tris[i] - cx, tris[i + 1] - cy, tris[i + 2] - cz, tris[i + 3] - cx, tris[i + 4] - cy, tris[i + 5] - cz, tris[i + 6] - cx, tris[i + 7] - cy, tris[i + 8] - cz];
    const [ux, uy, uz, vx, vy, vz] = [p[3] - p[0], p[4] - p[1], p[5] - p[2], p[6] - p[0], p[7] - p[1], p[8] - p[2]];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    out.push({ p, nx: nx / len, ny: ny / len, nz: nz / len, w: (nx * p[0] + ny * p[1] + nz * p[2]) / len });
  }
  return out;
}

/** The meshes' centre, where the numbers are small, and the tolerance for their size; null when they hold no points. */
function frameOf(meshes: ArrayLike<number>[]): { cx: number; cy: number; cz: number; eps: number } | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i < m.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], m[i]);
      hi[i % 3] = Math.max(hi[i % 3], m[i]);
    }
  }
  if (!lo.every(Number.isFinite)) return null;
  const [cx, cy, cz] = lo.map((v, k) => (v + hi[k]) / 2);
  return { cx, cy, cz, eps: EPSILON * Math.max(...hi.map((v, k) => v - lo[k]), 1) };
}

/** `result`'s faces as triangles back about the origin, with its crease edges. */
function finish(result: Poly[], f: { cx: number; cy: number; cz: number; eps: number }): { triangles: Float64Array; edges: Float64Array } {
  const { cx, cy, cz } = f;
  const tris: number[] = [];
  for (const q of result) {
    for (let i = 3; i + 5 < q.p.length; i += 3) {
      tris.push(q.p[0] + cx, q.p[1] + cy, q.p[2] + cz, q.p[i] + cx, q.p[i + 1] + cy, q.p[i + 2] + cz, q.p[i + 3] + cx, q.p[i + 4] + cy, q.p[i + 5] + cz);
    }
  }
  return { triangles: Float64Array.from(tris), edges: Float64Array.from(creaseEdges(tris, f.eps * 10)) };
}

const tooMany = (meshes: ArrayLike<number>[]): boolean => meshes.reduce((n, m) => n + m.length, 0) / 9 > MAX_CSG_TRIANGLES;

/**
 * `a` with each of `cuts` taken away, as triangles with its crease edges; null when the meshes
 * hold more than MAX_CSG_TRIANGLES triangles between them.
 */
export function subtractMeshes(a: ArrayLike<number>, cuts: ArrayLike<number>[]): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany([a, ...cuts])) return null;
  const f = frameOf([a, ...cuts]);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  let result = polysOf(outward(a, 10 * eps), cx, cy, cz);
  for (const cut of cuts) {
    const A = new Node(eps);
    A.build(result);
    const B = new Node(eps);
    B.build(polysOf(outward(cut, 10 * eps), cx, cy, cz));
    A.invert();
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.all());
    A.invert();
    result = A.all();
  }
  return finish(result, f);
}

/**
 * The volume all of `meshes` enclose, as triangles with its crease edges (none when they don't
 * all overlap); null when they hold more than MAX_CSG_TRIANGLES triangles between them.
 */
export function intersectMeshes(meshes: ArrayLike<number>[]): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany(meshes)) return null;
  const f = frameOf(meshes);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  let result = polysOf(outward(meshes[0], 10 * eps), cx, cy, cz);
  for (const m of meshes.slice(1)) {
    // an empty tree clips nothing away, so stop once nothing is left
    if (!result.length) break;
    const A = new Node(eps);
    A.build(result);
    const B = new Node(eps);
    B.build(polysOf(outward(m, 10 * eps), cx, cy, cz));
    A.invert();
    B.clipTo(A);
    B.invert();
    A.clipTo(B);
    B.clipTo(A);
    A.build(B.all());
    A.invert();
    result = A.all();
  }
  return finish(result, f);
}

/**
 * The parts of `a`, closed or an open surface, inside or outside the closed `cutter`, with no new faces made
 * where it's cut; null when they hold more than MAX_CSG_TRIANGLES triangles between them.
 */
export function trimmedMesh(a: ArrayLike<number>, cutter: ArrayLike<number>, keepInside: boolean): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany([a, cutter])) return null;
  const f = frameOf([a, cutter]);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  const B = new Node(eps);
  B.build(polysOf(outward(cutter, 10 * eps), cx, cy, cz));
  if (keepInside) B.invert();
  return finish(B.clip(polysOf(a, cx, cy, cz)), f);
}

/**
 * The volume any of `meshes` enclose, as triangles with its crease edges; null when they hold more
 * than MAX_CSG_TRIANGLES triangles between them.
 */
export function unionMeshes(meshes: ArrayLike<number>[]): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany(meshes)) return null;
  const f = frameOf(meshes);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  let result = polysOf(outward(meshes[0], 10 * eps), cx, cy, cz);
  for (const m of meshes.slice(1)) {
    const A = new Node(eps);
    A.build(result);
    const B = new Node(eps);
    B.build(polysOf(outward(m, 10 * eps), cx, cy, cz));
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.all());
    result = A.all();
  }
  return finish(result, f);
}

/** Sides two triangles share, welded at `weld`, where their faces meet at more than `crease` radians. */
export function creaseEdges(tris: ArrayLike<number>, weld: number, crease = (20 * Math.PI) / 180): number[] {
  const key = (i: number): string => `${Math.round(tris[i] / weld)},${Math.round(tris[i + 1] / weld)},${Math.round(tris[i + 2] / weld)}`;
  const sides = new Map<string, { at: number[]; n: number[][] }>();
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [ux, uy, uz, vx, vy, vz] = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2], tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) continue;
    for (const [s, t] of [[i, i + 3], [i + 3, i + 6], [i + 6, i]]) {
      const [ks, kt] = [key(s), key(t)];
      if (ks === kt) continue;
      const k = ks < kt ? `${ks}|${kt}` : `${kt}|${ks}`;
      const side = sides.get(k) ?? { at: [tris[s], tris[s + 1], tris[s + 2], tris[t], tris[t + 1], tris[t + 2]], n: [] };
      side.n.push(n.map((v) => v / len));
      sides.set(k, side);
    }
  }
  const out: number[] = [];
  const cos = Math.cos(crease);
  for (const { at, n } of sides.values()) {
    if (n.length === 2 && n[0][0] * n[1][0] + n[0][1] * n[1][1] + n[0][2] * n[1][2] < cos) out.push(...at);
  }
  return out;
}
