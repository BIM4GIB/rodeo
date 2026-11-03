// Modify > Simplify Mesh: a mesh drawn with fewer triangles. Edges are collapsed, each edge's two
// ends made one point, cheapest first by quadric error (Garland and Heckbert, 1997): every point
// carries the planes of the triangles round it (weighed by their areas), and a collapse costs how
// far its new point lies from the planes of both ends, so flat parts go first and creases and
// corners stay. An edge on an open border, between parts drawn differently or along a seam of the
// values carried with the vertices (where a texture's map is cut, or a normal turns) also carries
// a plane upright across its triangle, which holds it in place.
//
// Points are where the triangles meet; a vertex is a point with its carried values, so a point on
// a seam has a vertex for each side. Without carried values the new point goes where the cost is
// least (or at an end or the middle when that place isn't well defined). With them, an end is
// moved onto the other (the cheaper way round), so every vertex left is one given, its values
// exact: each triangle round the end that goes takes the other end's vertex on its side of any
// seam, and the collapse isn't made when a side has none (an end on a seam moves only along it).
// A point where three triangles or more meet one edge stays. A collapse that would turn a
// triangle more than 60°, or pinch the surface into a point two sheets share, isn't made. Each
// triangle left is one of the triangles given with its corners moved, and keeps its part and the
// turn of its corners.

/** points this close (mm) are one point */
const WELD = 1e-4;
/** how much more a border's plane weighs than a triangle's, by the square of the edge's length */
const BORDER = 1000;
/** a solved place this many edge lengths from the edge's middle is taken as ill-defined */
const FAR = 2;
/** the cosine of the most a collapse may turn a triangle round it (60°) */
const MIN_TURN = 0.5;

export interface MeshData {
  /** x, y, z of each vertex */
  readonly points: ArrayLike<number>;
  /** `size` values carried with each vertex: vertices at one place with other values are a seam */
  readonly carried?: { readonly values: ArrayLike<number>; readonly size: number };
  /** three vertex numbers a triangle */
  readonly triangles: ArrayLike<number>;
  /** each triangle's part: the edges between different parts keep their place */
  readonly parts: ArrayLike<number>;
}

export interface Simplified {
  readonly points: number[];
  /** the carried values of each vertex, as many as were given one */
  readonly carried: number[];
  readonly triangles: number[];
  readonly parts: number[];
  /** how many triangles there were to start with (those with a point twice left out) */
  readonly given: number;
}

/** `m` with about `keep` (0–1) of its triangles. */
export function simplifyMesh(m: MeshData, keep: number): Simplified {
  const size = m.carried?.size ?? 0;
  // ends move onto ends when there are values to keep exact
  const onto = size > 0;
  // points by place, vertices ("wedges") by place and values
  const pos: number[] = [];
  const carry: number[] = [];
  const pointOf: number[] = [];
  const pointByKey = new Map<string, number>();
  const wedgeByKey = new Map<string, number>();
  const wedgeOf: number[] = [];
  const vertexCount = Math.floor(m.points.length / 3);
  for (let v = 0; v < vertexCount; v++) {
    const place = `${Math.round(m.points[3 * v] / WELD)},${Math.round(m.points[3 * v + 1] / WELD)},${Math.round(m.points[3 * v + 2] / WELD)}`;
    let p = pointByKey.get(place);
    if (p === undefined) {
      p = pos.length / 3;
      pointByKey.set(place, p);
      pos.push(m.points[3 * v], m.points[3 * v + 1], m.points[3 * v + 2]);
    }
    let key = place;
    for (let k = 0; k < size; k++) key += `,${m.carried!.values[size * v + k]}`;
    let w = wedgeByKey.get(key);
    if (w === undefined) {
      w = pointOf.length;
      wedgeByKey.set(key, w);
      pointOf.push(p);
      for (let k = 0; k < size; k++) carry.push(m.carried!.values[size * v + k]);
    }
    wedgeOf.push(w);
  }
  const nv = pos.length / 3;
  const tv: number[] = [];
  const tw: number[] = [];
  const tp: number[] = [];
  for (let i = 0; i + 2 < m.triangles.length; i += 3) {
    const ws = [wedgeOf[m.triangles[i]], wedgeOf[m.triangles[i + 1]], wedgeOf[m.triangles[i + 2]]];
    if (ws.some((w) => w === undefined)) continue;
    const [a, b, c] = ws.map((w) => pointOf[w]);
    if (a === b || b === c || a === c) continue;
    tv.push(a, b, c);
    tw.push(...ws);
    tp.push(m.parts[i / 3]);
  }
  const nt = tp.length;
  const target = Math.max(0, Math.ceil(nt * Math.min(1, Math.max(0, keep))));
  const tri = Int32Array.from(tv);
  const wedge = Int32Array.from(tw);
  const alive = new Uint8Array(nt).fill(1);
  let live = nt;
  const round: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) round[tri[3 * t + k]].push(t);
  const held = new Uint8Array(nv);
  const border = new Uint8Array(nv);

  // each point's quadric: a², ab, ac, ad, b², bc, bd, c², cd, d² of its planes, summed
  const q = new Float64Array(10 * nv);
  const addPlane = (v: number, nx: number, ny: number, nz: number, d: number, w: number): void => {
    const o = 10 * v;
    q[o] += w * nx * nx;
    q[o + 1] += w * nx * ny;
    q[o + 2] += w * nx * nz;
    q[o + 3] += w * nx * d;
    q[o + 4] += w * ny * ny;
    q[o + 5] += w * ny * nz;
    q[o + 6] += w * ny * d;
    q[o + 7] += w * nz * nz;
    q[o + 8] += w * nz * d;
    q[o + 9] += w * d * d;
  };
  const normalOf = (t: number): [number, number, number] => {
    const [a, b, c] = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  for (let t = 0; t < nt; t++) {
    const [nx, ny, nz] = normalOf(t);
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 0)) continue;
    const a = tri[3 * t];
    const d = -(nx * pos[3 * a] + ny * pos[3 * a + 1] + nz * pos[3 * a + 2]) / len;
    for (let k = 0; k < 3; k++) addPlane(tri[3 * t + k], nx / len, ny / len, nz / len, d, len / 2);
  }
  /** the vertex triangle `t` has at point `v` */
  const wedgeAt = (t: number, v: number): number => wedge[3 * t + (tri[3 * t] === v ? 0 : tri[3 * t + 1] === v ? 1 : 2)];
  // each edge's triangles: one is a border, two of different parts or vertices a seam, more a fin
  const edges = new Map<number, { t: number; n: number; seam: boolean }>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tri[3 * t + k];
      const b = tri[3 * t + ((k + 1) % 3)];
      const key = Math.min(a, b) * nv + Math.max(a, b);
      const e = edges.get(key);
      if (!e) edges.set(key, { t, n: 1, seam: false });
      else {
        e.n++;
        if (tp[e.t] !== tp[t] || wedgeAt(e.t, a) !== wedgeAt(t, a) || wedgeAt(e.t, b) !== wedgeAt(t, b)) e.seam = true;
      }
    }
  }
  for (const [key, e] of edges) {
    const a = Math.floor(key / nv);
    const b = key % nv;
    if (e.n > 2) {
      held[a] = held[b] = 1;
      continue;
    }
    if (e.n === 1) border[a] = border[b] = 1;
    if (e.n === 2 && !e.seam) continue;
    // a plane through the edge, upright across its triangle
    const [nx, ny, nz] = normalOf(e.t);
    const ex = pos[3 * b] - pos[3 * a], ey = pos[3 * b + 1] - pos[3 * a + 1], ez = pos[3 * b + 2] - pos[3 * a + 2];
    let px = ey * nz - ez * ny, py = ez * nx - ex * nz, pz = ex * ny - ey * nx;
    const len = Math.hypot(px, py, pz);
    if (!(len > 0)) continue;
    px /= len;
    py /= len;
    pz /= len;
    const d = -(px * pos[3 * a] + py * pos[3 * a + 1] + pz * pos[3 * a + 2]);
    const w = BORDER * (ex * ex + ey * ey + ez * ez);
    addPlane(a, px, py, pz, d, w);
    addPlane(b, px, py, pz, d, w);
  }

  const qs = new Float64Array(10);
  const error = (x: number, y: number, z: number): number =>
    Math.max(
      0,
      qs[0] * x * x + 2 * qs[1] * x * y + 2 * qs[2] * x * z + 2 * qs[3] * x + qs[4] * y * y + 2 * qs[5] * y * z + 2 * qs[6] * y + qs[7] * z * z + 2 * qs[8] * z + qs[9],
    );
  /** The point a collapse of a and b leaves: the end that stays, where, and what it costs; held points don't go. */
  const place = (a: number, b: number): { stay: number; x: number; y: number; z: number; cost: number } | null => {
    if (held[a] && held[b]) return null;
    for (let k = 0; k < 10; k++) qs[k] = q[10 * a + k] + q[10 * b + k];
    const at = (v: number, stay: number) => ({ stay, x: pos[3 * v], y: pos[3 * v + 1], z: pos[3 * v + 2], cost: error(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]) });
    if (held[a]) return at(a, a);
    if (held[b]) return at(b, b);
    let best = at(a, a);
    const tryAt = (x: number, y: number, z: number, stay: number): void => {
      const cost = error(x, y, z);
      if (cost < best.cost) best = { stay, x, y, z, cost };
    };
    tryAt(pos[3 * b], pos[3 * b + 1], pos[3 * b + 2], b);
    if (onto) return best;
    const mx = (pos[3 * a] + pos[3 * b]) / 2, my = (pos[3 * a + 1] + pos[3 * b + 1]) / 2, mz = (pos[3 * a + 2] + pos[3 * b + 2]) / 2;
    tryAt(mx, my, mz, a);
    // the least-cost point: solve the quadric's 3 × 3 part against its linear part
    const [a11, a12, a13, b1, a22, a23, b2, a33, b3] = qs;
    const c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
    const det = a11 * c11 + a12 * c12 + a13 * c13;
    const scale = (a11 + a22 + a33) / 3;
    if (Math.abs(det) > 1e-9 * scale * scale * scale) {
      const c22 = a11 * a33 - a13 * a13, c23 = a12 * a13 - a11 * a23, c33 = a11 * a22 - a12 * a12;
      const x = -(c11 * b1 + c12 * b2 + c13 * b3) / det;
      const y = -(c12 * b1 + c22 * b2 + c23 * b3) / det;
      const z = -(c13 * b1 + c23 * b2 + c33 * b3) / det;
      const reach = FAR * Math.hypot(pos[3 * b] - pos[3 * a], pos[3 * b + 1] - pos[3 * a + 1], pos[3 * b + 2] - pos[3 * a + 2]);
      if (Number.isFinite(x + y + z) && Math.hypot(x - mx, y - my, z - mz) <= reach) tryAt(x, y, z, a);
    }
    return best;
  };

  // a heap of collapses, cheapest on top; each notes its ends' versions, and is stale once either changed
  const hc: number[] = [];
  const ha: number[] = [];
  const hb: number[] = [];
  const hva: number[] = [];
  const hvb: number[] = [];
  const version = new Uint32Array(nv);
  const swap = (i: number, j: number): void => {
    for (const arr of [hc, ha, hb, hva, hvb]) [arr[i], arr[j]] = [arr[j], arr[i]];
  };
  const push = (a: number, b: number): void => {
    const p = place(a, b);
    if (!p) return;
    let i = hc.length;
    hc.push(p.cost);
    ha.push(a);
    hb.push(b);
    hva.push(version[a]);
    hvb.push(version[b]);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (hc[up] <= hc[i]) break;
      swap(i, up);
      i = up;
    }
  };
  const pop = (): [number, number, number, number] => {
    const top: [number, number, number, number] = [ha[0], hb[0], hva[0], hvb[0]];
    const last = hc.length - 1;
    swap(0, last);
    for (const arr of [hc, ha, hb, hva, hvb]) arr.pop();
    for (let i = 0; ; ) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < hc.length && hc[l] < hc[m]) m = l;
      if (r < hc.length && hc[r] < hc[m]) m = r;
      if (m === i) break;
      swap(i, m);
      i = m;
    }
    return top;
  };
  for (const key of edges.keys()) push(Math.floor(key / nv), key % nv);

  const dead = new Uint8Array(nv);
  const liveRound = (v: number): number[] => (round[v] = round[v].filter((t) => alive[t]));
  const has = (t: number, v: number): boolean => tri[3 * t] === v || tri[3 * t + 1] === v || tri[3 * t + 2] === v;
  /** Whether moving `v`'s corners of the triangles round it (but those holding `other` too) to p turns none more than 60°. */
  const keepsTurn = (v: number, other: number, x: number, y: number, z: number): boolean => {
    if (pos[3 * v] === x && pos[3 * v + 1] === y && pos[3 * v + 2] === z) return true;
    for (const t of round[v]) {
      if (has(t, other)) continue;
      const [ox, oy, oz] = normalOf(t);
      const [sx, sy, sz] = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
      pos[3 * v] = x;
      pos[3 * v + 1] = y;
      pos[3 * v + 2] = z;
      const [nx, ny, nz] = normalOf(t);
      pos[3 * v] = sx;
      pos[3 * v + 1] = sy;
      pos[3 * v + 2] = sz;
      const was = Math.hypot(ox, oy, oz);
      const now = Math.hypot(nx, ny, nz);
      if (!(now > 1e-12 * was) || ox * nx + oy * ny + oz * nz <= MIN_TURN * was * now) return false;
    }
    return true;
  };
  const neighbours = (v: number, out: Set<number>): Set<number> => {
    for (const t of round[v]) for (let k = 0; k < 3; k++) if (tri[3 * t + k] !== v) out.add(tri[3 * t + k]);
    return out;
  };
  /**
   * For `gone` moving onto `stay`: each vertex of `gone`'s the vertex of `stay` its triangles take
   * (the one the shared triangles pair it with), or null when a vertex has none or two.
   */
  const pairing = (gone: number, stay: number, shared: readonly number[]): Map<number, number> | null => {
    const to = new Map<number, number>();
    for (const t of shared) {
      const from = wedgeAt(t, gone);
      const w = wedgeAt(t, stay);
      if ((to.get(from) ?? w) !== w) return null;
      to.set(from, w);
    }
    for (const t of round[gone]) if (!has(t, stay) && !to.has(wedgeAt(t, gone))) return null;
    return to;
  };

  /** The collapse of `gone` onto `stay`, its point moved to p, when it may be made; whether it was. */
  const collapse = (stay: number, gone: number, x: number, y: number, z: number): boolean => {
    const shared = round[stay].filter((t) => has(t, gone));
    if (shared.length === 0 || shared.length > 2) return false;
    if (shared.length === 2 && border[stay] && border[gone]) return false;
    // the ends' common neighbours must be the shared triangles' third corners only
    const ns = neighbours(stay, new Set());
    const ng = neighbours(gone, new Set());
    let common = 0;
    for (const c of ng) if (c !== stay && ns.has(c)) common++;
    if (common !== shared.length) return false;
    // a closed piece of four points would fold flat
    if (shared.length === 2 && ns.size + ng.size - common - 2 <= 2) return false;
    if (!keepsTurn(stay, gone, x, y, z) || !keepsTurn(gone, stay, x, y, z)) return false;
    let to: Map<number, number> | null = null;
    if (onto) {
      to = pairing(gone, stay, shared);
      if (!to) return false;
    }
    pos[3 * stay] = x;
    pos[3 * stay + 1] = y;
    pos[3 * stay + 2] = z;
    for (let k = 0; k < 10; k++) q[10 * stay + k] += q[10 * gone + k];
    border[stay] |= border[gone];
    // without values to keep, a point is one vertex: the one that stays
    const sole = to ? -1 : wedgeAt(round[stay][0], stay);
    for (const t of round[gone]) {
      if (has(t, stay)) {
        alive[t] = 0;
        live--;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        if (tri[3 * t + k] !== gone) continue;
        tri[3 * t + k] = stay;
        wedge[3 * t + k] = to ? to.get(wedge[3 * t + k])! : sole;
      }
      round[stay].push(t);
    }
    round[gone] = [];
    dead[gone] = 1;
    liveRound(stay);
    version[stay]++;
    return true;
  };

  while (live > target && hc.length) {
    const [a, b, va, vb] = pop();
    if (dead[a] || dead[b] || version[a] !== va || version[b] !== vb) continue;
    const p = place(a, b);
    if (!p) continue;
    liveRound(a);
    liveRound(b);
    const [stay, gone] = p.stay === a ? [a, b] : [b, a];
    let made = collapse(stay, gone, p.x, p.y, p.z);
    // moving onto the other end instead, when that end may go
    if (!made && onto && !held[stay]) made = collapse(gone, stay, pos[3 * gone], pos[3 * gone + 1], pos[3 * gone + 2]);
    if (!made) continue;
    const kept = dead[a] ? b : a;
    for (const c of neighbours(kept, new Set())) push(kept, c);
  }

  // what's left, its vertices numbered afresh
  const number = new Map<number, number>();
  const out: Simplified = { points: [], carried: [], triangles: [], parts: [], given: nt };
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue;
    for (let k = 0; k < 3; k++) {
      const w = wedge[3 * t + k];
      let n = number.get(w);
      if (n === undefined) {
        n = number.size;
        number.set(w, n);
        const v = tri[3 * t + k];
        out.points.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
        for (let j = 0; j < size; j++) out.carried.push(carry[size * w + j]);
      }
      out.triangles.push(n);
    }
    out.parts.push(tp[t]);
  }
  return out;
}
