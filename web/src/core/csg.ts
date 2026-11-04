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
  /** stitch put corners into its sides: it is fanned from its middle */
  fan?: boolean;
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

/**
 * Each polygon with the corners of others that lie along its sides put into those sides. The tree
 * splits faces where planes cross them, so a face often ends part way along a neighbour's side (a
 * T junction): drawn, that shows nothing, but the result isn't closed corner to corner, so it
 * doesn't check closed, doesn't export watertight, and is read wrong when it is cut again (outward
 * pairs triangles by the sides they share). Points within `tol` are one.
 */
function stitch(polys: Poly[], tol: number): Poly[] {
  // each distinct corner once, in a grid of cells about a 64th of the result's size
  let size = 0;
  for (const q of polys) for (const v of q.p) size = Math.max(size, Math.abs(v));
  const cellSize = Math.max((2 * size) / 64, tol * 4);
  const cells = new Map<string, number[]>();
  const pts: number[] = [];
  const seen = new Map<string, number>();
  const cellKey = (x: number, y: number, z: number): string => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
  for (const q of polys) {
    for (let i = 0; i < q.p.length; i += 3) {
      const [x, y, z] = [q.p[i], q.p[i + 1], q.p[i + 2]];
      const k = `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
      if (seen.has(k)) continue;
      const n = pts.length / 3;
      seen.set(k, n);
      pts.push(x, y, z);
      const c = cellKey(x, y, z);
      const list = cells.get(c);
      if (list) list.push(n);
      else cells.set(c, [n]);
    }
  }
  /** the corners lying on the side from p to q, strictly between them, in order from p */
  const between = (p: number[], q: number[]): number[] => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (!(len > 2 * tol)) return [];
    // samples half a cell apart: every point of the side is within a quarter cell of one, so the
    // cells a quarter cell (and tol) either way of each sample hold every corner near the side
    const keys = new Set<string>();
    const steps = Math.ceil(len / (cellSize / 2));
    const o = cellSize / 4 + tol;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const at = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
      for (const dx of [-o, o]) for (const dy of [-o, o]) for (const dz of [-o, o]) keys.add(cellKey(at[0] + dx, at[1] + dy, at[2] + dz));
    }
    const found: { t: number; n: number }[] = [];
    for (const k of keys) {
      for (const n of cells.get(k) ?? []) {
        const v = [pts[3 * n] - p[0], pts[3 * n + 1] - p[1], pts[3 * n + 2] - p[2]];
        const t = (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / (len * len);
        if (t * len <= tol || (1 - t) * len <= tol) continue;
        if (Math.hypot(v[0] - d[0] * t, v[1] - d[1] * t, v[2] - d[2] * t) <= tol) found.push({ t, n });
      }
    }
    found.sort((a, b) => a.t - b.t);
    const out: number[] = [];
    for (const { n } of found) out.push(pts[3 * n], pts[3 * n + 1], pts[3 * n + 2]);
    return out;
  };
  return polys.map((q) => {
    const n = q.p.length / 3;
    // each side from its corner, with what lies along it
    const sides: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = q.p.slice(3 * i, 3 * i + 3);
      const b = q.p.slice(3 * ((i + 1) % n), 3 * ((i + 1) % n) + 3);
      sides.push([...a, ...between(a, b)]);
    }
    if (sides.every((s) => s.length === 3)) return q;
    // fanned from a corner neither of whose sides gained one, no triangle is flat; with none, from its middle
    const start = sides.findIndex((s, i) => s.length === 3 && sides[(i + n - 1) % n].length === 3);
    const from = Math.max(0, start);
    const p: number[] = [];
    for (let k = 0; k < n; k++) p.push(...sides[(from + k) % n]);
    return { ...q, p, fan: start < 0 };
  });
}

/** `result`'s faces as triangles back about the origin, with its crease edges. */
function finish(result: Poly[], f: { cx: number; cy: number; cz: number; eps: number }): { triangles: Float64Array; edges: Float64Array } {
  const { cx, cy, cz } = f;
  const tris: number[] = [];
  for (const q of stitch(result, f.eps * 10)) {
    const n = q.p.length / 3;
    if (q.fan) {
      // corners put into its sides lie in line with their neighbours: fanned from its middle, no
      // triangle is flat and every corner is one
      const m = [0, 1, 2].map((k) => {
        let s = 0;
        for (let i = 0; i < n; i++) s += q.p[3 * i + k];
        return s / n;
      });
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tris.push(m[0] + cx, m[1] + cy, m[2] + cz, q.p[3 * i] + cx, q.p[3 * i + 1] + cy, q.p[3 * i + 2] + cz, q.p[3 * j] + cx, q.p[3 * j + 1] + cy, q.p[3 * j + 2] + cz);
      }
      continue;
    }
    for (let i = 3; i + 5 < q.p.length; i += 3) {
      tris.push(q.p[0] + cx, q.p[1] + cy, q.p[2] + cz, q.p[i] + cx, q.p[i + 1] + cy, q.p[i + 2] + cz, q.p[i + 3] + cx, q.p[i + 4] + cy, q.p[i + 5] + cz);
    }
  }
  const { at, faces } = indexed(tris, f.eps * 10);
  flipSlivers(at, faces, f.eps * 10);
  const out = flat(at, faces);
  return { triangles: Float64Array.from(out), edges: Float64Array.from(creaseEdges(out, f.eps * 10)) };
}

type Face = [number, number, number];

/** Triangles as corners shared by index (welded at `weld`) and the faces round them. */
function indexed(tris: ArrayLike<number>, weld: number): { at: number[]; faces: (Face | null)[] } {
  const ids = new Map<string, number>();
  const at: number[] = [];
  const corner = (i: number): number => {
    const k = `${Math.round(tris[i] / weld)},${Math.round(tris[i + 1] / weld)},${Math.round(tris[i + 2] / weld)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = at.length / 3;
      ids.set(k, id);
      at.push(tris[i], tris[i + 1], tris[i + 2]);
    }
    return id;
  };
  const faces: (Face | null)[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) faces.push([corner(i), corner(i + 3), corner(i + 6)]);
  return { at, faces };
}

const flat = (at: readonly number[], faces: readonly (Face | null)[]): number[] => {
  const out: number[] = [];
  for (const f of faces) if (f) for (const v of f) out.push(at[3 * v], at[3 * v + 1], at[3 * v + 2]);
  return out;
};

/**
 * Triangles with a corner within `weld` of their long side (no area to speak of) taken out, and
 * the triangle across that side split at the corner instead, so the mesh stays closed and every
 * face has an area (an STL with flat triangles reads as broken).
 */
function flipSlivers(at: readonly number[], faces: (Face | null)[], weld: number): void {
  const side = new Map<string, number>();
  const link = (t: number): void => {
    const f = faces[t];
    if (f) for (let k = 0; k < 3; k++) side.set(`${f[k]}>${f[(k + 1) % 3]}`, t);
  };
  const unlink = (t: number): void => {
    const f = faces[t];
    if (f) for (let k = 0; k < 3; k++) if (side.get(`${f[k]}>${f[(k + 1) % 3]}`) === t) side.delete(`${f[k]}>${f[(k + 1) % 3]}`);
  };
  faces.forEach((_, t) => link(t));
  const d2 = (a: number, b: number): number => (at[3 * a] - at[3 * b]) ** 2 + (at[3 * a + 1] - at[3 * b + 1]) ** 2 + (at[3 * a + 2] - at[3 * b + 2]) ** 2;
  /** the face's index of the corner lying on its long side when it is flat, -1 when it isn't, -2 when two corners are one */
  const flatAt = (f: Face): number => {
    const [a, b, c] = f;
    if (a === b || b === c || c === a) return -2;
    const u = [at[3 * b] - at[3 * a], at[3 * b + 1] - at[3 * a + 1], at[3 * b + 2] - at[3 * a + 2]];
    const v = [at[3 * c] - at[3 * a], at[3 * c + 1] - at[3 * a + 1], at[3 * c + 2] - at[3 * a + 2]];
    const twice = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    const sides = [d2(b, c), d2(c, a), d2(a, b)];
    const k = sides.indexOf(Math.max(...sides));
    return twice / Math.sqrt(sides[k]) < weld ? k : -1;
  };
  // a flip whose new triangles would be flat as well is left alone, so it never undoes itself;
  // the passes after the first take the flats a flip next door has made flippable
  for (let pass = 0; pass < 3; pass++) {
    let flipped = 0;
    for (let t = 0; t < faces.length; t++) {
      const f = faces[t];
      if (!f) continue;
      const k = flatAt(f);
      if (k === -1) continue;
      if (k === -2) {
        unlink(t);
        faces[t] = null;
        continue;
      }
      // b lies on the side from c to a; the face across it runs a to c
      const b = f[k];
      const c = f[(k + 1) % 3];
      const a = f[(k + 2) % 3];
      const n = side.get(`${a}>${c}`);
      const g = n === undefined ? null : faces[n];
      if (n === undefined || !g || n === t) continue;
      const d = g[(g.indexOf(a) + 2) % 3];
      const one: Face = [a, b, d];
      const two: Face = [b, c, d];
      if (d === b || flatAt(one) !== -1 || flatAt(two) !== -1) continue;
      unlink(t);
      unlink(n);
      faces[t] = one;
      faces[n] = two;
      link(t);
      link(n);
      flipped++;
    }
    if (!flipped) break;
  }
}

/**
 * A closed triangle mesh with its sides shorter than `shortest` collapsed (the specks cutting
 * leaves where cuts pass near corners) and its flat triangles split into their neighbours, still
 * closed: for a solid that is to be printed or exported.
 */
export function cleanMesh(tris: ArrayLike<number>, shortest: number): number[] {
  const { at, faces } = indexed(tris, shortest / 100);
  const into = at.map((_, i) => i).slice(0, at.length / 3);
  const root = (v: number): number => {
    while (into[v] !== v) v = into[v] = into[into[v]];
    return v;
  };
  const near = (a: number, b: number): boolean => Math.hypot(at[3 * a] - at[3 * b], at[3 * a + 1] - at[3 * b + 1], at[3 * a + 2] - at[3 * b + 2]) < shortest;
  for (const f of faces) for (let k = 0; f && k < 3; k++) {
    const [a, b] = [root(f[k]), root(f[(k + 1) % 3])];
    if (a !== b && near(a, b)) into[Math.max(a, b)] = Math.min(a, b);
  }
  for (let t = 0; t < faces.length; t++) {
    const f = faces[t];
    if (!f) continue;
    const g: Face = [root(f[0]), root(f[1]), root(f[2])];
    faces[t] = g[0] === g[1] || g[1] === g[2] || g[2] === g[0] ? null : g;
  }
  flipSlivers(at, faces, shortest / 10);
  return flat(at, faces);
}

type Box = [number, number, number, number, number, number];

function boxOf(polys: readonly Poly[]): Box {
  const b: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const q of polys) {
    for (let i = 0; i < q.p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], q.p[i + k]);
        b[k + 3] = Math.max(b[k + 3], q.p[i + k]);
      }
    }
  }
  return b;
}

const apart = (a: Box, b: Box, eps: number): boolean => a[0] > b[3] + eps || a[1] > b[4] + eps || a[2] > b[5] + eps || b[0] > a[3] + eps || b[1] > a[4] + eps || b[2] > a[5] + eps;

/** The parts of `polys` outside `tree`'s solid; those clear of `box` (the solid's) kept whole. */
function clipNear(tree: Node, box: Box, polys: readonly Poly[], eps: number): Poly[] {
  const near: Poly[] = [];
  const out: Poly[] = [];
  for (const q of polys) (apart(boxOf([q]), box, eps) ? out : near).push(q);
  return out.concat(tree.clip(near));
}

// csg.js's subtraction and union, with each solid's faces split only by the other's planes and
// only where they come near it: a tree's own faces come out of building it split by its own
// planes, which, step after step, broke a plate with a row of holes into tens of thousands of slivers

/** The closed solid `a` less the closed solid `b`, as faces. */
function less(a: Poly[], b: Poly[], eps: number): Poly[] {
  const outside = new Node(eps);
  outside.build(a.map(flip));
  const B = new Node(eps);
  B.build(b);
  const aBox = boxOf(a);
  // a's faces where b isn't; b's inside a, facing into the hole
  const kept = clipNear(B, boxOf(b), a.map(flip), eps);
  const inA = outside.clip(b.filter((q) => !apart(boxOf([q]), aBox, eps)));
  const walls = outside.clip(inA.map(flip)).map(flip);
  return kept.concat(walls).map(flip);
}

/** The closed solids `a` and `b` together, as faces. */
function more(a: Poly[], b: Poly[], eps: number): Poly[] {
  const A = new Node(eps);
  A.build(a);
  const B = new Node(eps);
  B.build(b);
  const kept = clipNear(B, boxOf(b), a, eps);
  const outA = clipNear(A, boxOf(a), b, eps);
  const rest = clipNear(A, boxOf(a), outA.map(flip), eps).map(flip);
  return kept.concat(rest);
}

const tooMany = (meshes: ArrayLike<number>[], max = MAX_CSG_TRIANGLES): boolean => meshes.reduce((n, m) => n + m.length, 0) / 9 > max;

/**
 * `a` with each of `cuts` taken away, as triangles with its crease edges; null when the meshes
 * hold more than `max` (MAX_CSG_TRIANGLES) triangles between them.
 */
export function subtractMeshes(a: ArrayLike<number>, cuts: ArrayLike<number>[], max = MAX_CSG_TRIANGLES): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany([a, ...cuts], max)) return null;
  const f = frameOf([a, ...cuts]);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  let result = polysOf(outward(a, 10 * eps), cx, cy, cz);
  for (const cut of cuts) result = less(result, polysOf(outward(cut, 10 * eps), cx, cy, cz), eps);
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
 * than `max` (MAX_CSG_TRIANGLES) triangles between them.
 */
export function unionMeshes(meshes: ArrayLike<number>[], max = MAX_CSG_TRIANGLES): { triangles: Float64Array; edges: Float64Array } | null {
  if (tooMany(meshes, max)) return null;
  const f = frameOf(meshes);
  if (!f) return { triangles: new Float64Array(), edges: new Float64Array() };
  const { cx, cy, cz, eps } = f;
  let result = polysOf(outward(meshes[0], 10 * eps), cx, cy, cz);
  for (const m of meshes.slice(1)) result = more(result, polysOf(outward(m, 10 * eps), cx, cy, cz), eps);
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
