// Triangles merged back into the flat faces they were cut from, for Convert to 3D Polygons: the
// triangles of one plane that share edges become one face, its outline walked from the edges
// only one of them has. A face with a hole, or whose outline touches itself, stays as its
// triangles (a 3D polygon has one outline). Points closer than WELD are taken as one.

/** points this close (mm) are one point */
const WELD = 1e-4;
/** planes this close in direction (1 − cos) and offset (mm) are one plane */
const SAME_DIRECTION = 1e-9;
const SAME_OFFSET = 1e-4;

/** The faces of `tris` (9 numbers a triangle), each its corners as x, y, z triples in order round it. */
export function facesOf(tris: ArrayLike<number>): number[][] {
  // weld the corners into numbered points
  const pts: number[] = [];
  const byKey = new Map<string, number>();
  const point = (i: number): number => {
    const key = `${Math.round(tris[i] / WELD)},${Math.round(tris[i + 1] / WELD)},${Math.round(tris[i + 2] / WELD)}`;
    let n = byKey.get(key);
    if (n === undefined) {
      n = pts.length / 3;
      pts.push(tris[i], tris[i + 1], tris[i + 2]);
      byKey.set(key, n);
    }
    return n;
  };
  const corners: [number, number, number][] = [];
  const planes: { n: [number, number, number]; d: number }[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [a, b, c] = [point(i), point(i + 3), point(i + 6)];
    if (a === b || b === c || a === c) continue;
    const n = normal(pts, a, b, c);
    if (!n) continue;
    corners.push([a, b, c]);
    planes.push({ n, d: n[0] * pts[3 * a] + n[1] * pts[3 * a + 1] + n[2] * pts[3 * a + 2] });
  }
  // triangles of one plane sharing an edge are one face
  const root = corners.map((_, i) => i);
  const find = (i: number): number => {
    while (root[i] !== i) i = root[i] = root[root[i]];
    return i;
  };
  const byEdge = new Map<string, number[]>();
  corners.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const [u, v] = [t[k], t[(k + 1) % 3]];
      const key = u < v ? `${u} ${v}` : `${v} ${u}`;
      const list = byEdge.get(key) ?? [];
      list.push(i);
      byEdge.set(key, list);
    }
  });
  for (const list of byEdge.values()) {
    if (list.length !== 2) continue;
    const [p, q] = [planes[list[0]], planes[list[1]]];
    const cos = p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2];
    if (1 - cos <= SAME_DIRECTION && Math.abs(p.d - q.d) <= SAME_OFFSET) root[find(list[0])] = find(list[1]);
  }
  const groups = new Map<number, number[]>();
  corners.forEach((_, i) => {
    const g = find(i);
    const list = groups.get(g) ?? [];
    list.push(i);
    groups.set(g, list);
  });

  const out: number[][] = [];
  const asTriangles = (list: readonly number[]): void => {
    for (const i of list) out.push(corners[i].flatMap((v) => [pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]]));
  };
  for (const list of groups.values()) {
    if (list.length === 1) {
      asTriangles(list);
      continue;
    }
    const loop = outline(list.map((i) => corners[i]));
    if (!loop) {
      asTriangles(list);
      continue;
    }
    const kept = dropStraight(pts, loop);
    out.push(kept.flatMap((v) => [pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]]));
  }
  return out;
}

/** Unit normal of triangle a, b, c (points numbered in `pts`), or null when it has no area. */
function normal(pts: readonly number[], a: number, b: number, c: number): [number, number, number] | null {
  const [ux, uy, uz] = [pts[3 * b] - pts[3 * a], pts[3 * b + 1] - pts[3 * a + 1], pts[3 * b + 2] - pts[3 * a + 2]];
  const [vx, vy, vz] = [pts[3 * c] - pts[3 * a], pts[3 * c + 1] - pts[3 * a + 1], pts[3 * c + 2] - pts[3 * a + 2]];
  const n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.hypot(...n);
  return len > 0 ? [n[0] / len, n[1] / len, n[2] / len] : null;
}

/** The one outline of triangles that share edges, in their winding; null for a hole, or an outline touching itself. */
function outline(tris: readonly (readonly [number, number, number])[]): number[] | null {
  const edges = new Set<string>();
  for (const t of tris) for (let k = 0; k < 3; k++) edges.add(`${t[k]} ${t[(k + 1) % 3]}`);
  const next = new Map<number, number>();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const [u, v] = [t[k], t[(k + 1) % 3]];
      if (edges.has(`${v} ${u}`)) continue;
      if (next.has(u)) return null;
      next.set(u, v);
    }
  }
  if (next.size < 3) return null;
  const start = next.keys().next().value!;
  const loop = [start];
  for (let v = next.get(start)!; v !== start; v = next.get(v)!) {
    if (v === undefined || loop.length > next.size) return null;
    loop.push(v);
  }
  return loop.length === next.size ? loop : null;
}

/** The outline without the corners that lie on a straight run between their neighbours. */
function dropStraight(pts: readonly number[], loop: readonly number[]): number[] {
  const n = loop.length;
  const kept = loop.filter((v, i) => {
    const [a, c] = [loop[(i + n - 1) % n], loop[(i + 1) % n]];
    const [ux, uy, uz] = [pts[3 * v] - pts[3 * a], pts[3 * v + 1] - pts[3 * a + 1], pts[3 * v + 2] - pts[3 * a + 2]];
    const [wx, wy, wz] = [pts[3 * c] - pts[3 * v], pts[3 * c + 1] - pts[3 * v + 1], pts[3 * c + 2] - pts[3 * v + 2]];
    const cross = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    const dot = ux * wx + uy * wy + uz * wz;
    return !(dot > 0 && cross <= WELD * Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz)));
  });
  return kept.length >= 3 ? kept : [...loop];
}
