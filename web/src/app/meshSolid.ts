// What a set of 3D meshes measures as a solid, for Model > Volumetric Properties… and Tools > Machine Design >
// 3D Properties…: the surface area, and where the faces close round a volume, the volume, centre of mass and
// second moments. Faces are taken as the 3D view draws them, curved ones as their facets. Pure.

/**
 * The volume's second moments about axes through its centre of mass, parallel to x, y and z (mm⁵): the
 * moments of inertia ∫(y²+z²)dV and so on, and the products ∫(x−x̄)(y−ȳ)dV and so on. Times a density
 * they are the mass moments; over the volume, the radii of gyration squared.
 */
export interface Inertia {
  readonly xx: number;
  readonly yy: number;
  readonly zz: number;
  readonly xy: number;
  readonly yz: number;
  readonly zx: number;
}

/** The systems of units Calculate Mass Properties offers. */
export type MassSystem = "english" | "metric";

/** Water's density, which a specific gravity multiplies: lb/in³ and kg/m³. */
export const WATER: Readonly<Record<MassSystem, number>> = { english: 62.428 / 1728, metric: 1000 };

/**
 * A solid's mass properties at a density (lb/in³ or kg/m³) or a specific gravity: its mass (lb or kg),
 * weight (lbf or N) and mass moments of inertia about axes through its centre of mass (lb·in² or kg·m²).
 */
export function massProperties(volume: number, inertia: Inertia, system: MassSystem, by: "density" | "gravity", value: number): { density: number; mass: number; weight: number; xx: number; yy: number; zz: number } {
  const density = by === "gravity" ? value * WATER[system] : value;
  const [l3, l5] = system === "english" ? [25.4 ** 3, 25.4 ** 5] : [1e9, 1e15];
  const mass = (density * volume) / l3;
  return { density, mass, weight: system === "english" ? mass : mass * 9.80665, xx: (density * inertia.xx) / l5, yy: (density * inertia.yy) / l5, zz: (density * inertia.zz) / l5 };
}

/** What the faces of some meshes measure, in millimetres; volume, centre and inertia null when the faces don't close. */
export interface Solid {
  readonly area: number;
  readonly volume: number | null;
  readonly center: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly inertia: Inertia | null;
}

/** How far the faces' outward areas may fail to cancel, as a share of their area, and still count as closed (the 3D view's corners are 32-bit). */
const OPEN_SHARE = 1e-3;

/** The faces as corner numbers into one list of points, corners closer than rounding welded, about the first point so far models keep their precision. */
function weld(meshes: readonly { readonly triangles: Float32Array }[]): { pts: number[]; tris: number[] } {
  const first = meshes.find((m) => m.triangles.length >= 9)!.triangles;
  let far = 0;
  for (const { triangles: t } of meshes) for (const v of t) far = Math.max(far, Math.abs(v));
  // a 32-bit float is good to about 1 part in 8 million
  const step = Math.max(1e-3, far * 2.5e-7);
  const ids = new Map<string, number>();
  const pts: number[] = [];
  const tris: number[] = [];
  const id = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x / step)},${Math.round(y / step)},${Math.round(z / step)}`;
    let n = ids.get(key);
    if (n === undefined) {
      n = pts.length / 3;
      ids.set(key, n);
      pts.push(x - first[0], y - first[1], z - first[2]);
    }
    return n;
  };
  for (const { triangles: t } of meshes) {
    for (let i = 0; i + 8 < t.length; i += 9) {
      const a = id(t[i], t[i + 1], t[i + 2]);
      const b = id(t[i + 3], t[i + 4], t[i + 5]);
      const c = id(t[i + 6], t[i + 7], t[i + 8]);
      if (a !== b && b !== c && c !== a) tris.push(a, b, c);
    }
  }
  return { pts, tris };
}

/**
 * Which faces to turn over so that each run of faces joined edge to edge is wound one way: the 3D
 * view draws both sides of a face, so the model doesn't keep to one winding (an extrude's ends
 * face the same way). Faces meeting at an edge are wound one way when they run along it in
 * opposite directions. Each face's run, numbered from 0, whether it is turned, and how many runs there are.
 */
function orient(tris: readonly number[], count: number): { run: Int32Array; turned: Uint8Array; runs: number } {
  const n = tris.length / 3;
  // each edge's faces: the face's number, doubled, plus 1 when it runs from the lower corner to the higher
  const edges = new Map<number, number[]>();
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < 3; k++) {
      const u = tris[3 * f + k];
      const v = tris[3 * f + ((k + 1) % 3)];
      const key = Math.min(u, v) * count + Math.max(u, v);
      const list = edges.get(key);
      const entry = 2 * f + (u < v ? 1 : 0);
      if (list) list.push(entry);
      else edges.set(key, [entry]);
    }
  }
  const run = new Int32Array(n).fill(-1);
  const turned = new Uint8Array(n);
  let runs = 0;
  for (let start = 0; start < n; start++) {
    if (run[start] >= 0) continue;
    run[start] = runs;
    const queue = [start];
    while (queue.length) {
      const f = queue.pop()!;
      for (let k = 0; k < 3; k++) {
        const u = tris[3 * f + k];
        const v = tris[3 * f + ((k + 1) % 3)];
        const list = edges.get(Math.min(u, v) * count + Math.max(u, v))!;
        // only an edge two faces share says which way round the other goes
        if (list.length !== 2) continue;
        const other = list[0] >> 1 === f ? list[1] : list[0];
        const g = other >> 1;
        if (run[g] >= 0) continue;
        const up = (u < v ? 1 : 0) ^ turned[f];
        // g must run along the edge the other way
        turned[g] = (other & 1) ^ (up ^ 1);
        run[g] = runs;
        queue.push(g);
      }
    }
    runs++;
  }
  return { run, turned, runs };
}

/**
 * Surface area, and for closed faces the volume, centre of mass and second moments by signed
 * tetrahedra, each from the first point to a face: one with corners 0, a, b, c has ∫xᵢxⱼ dV of
 * V/20 · (Σ aᵢaⱼ + Σaᵢ · Σaⱼ) over its three corners. The faces
 * are wound one way in each run joined edge to edge, outwards when its volume comes out positive;
 * a run is closed when its faces' outward areas cancel out. A hollow sealed inside a solid is
 * counted as solid too.
 */
export function solidOf(meshes: readonly { readonly triangles: Float32Array }[]): Solid | null {
  if (!meshes.some((m) => m.triangles.length >= 9)) return null;
  const first = meshes.find((m) => m.triangles.length >= 9)!.triangles;
  const { pts, tris } = weld(meshes);
  if (!tris.length) return null;
  const { run, turned, runs } = orient(tris, pts.length / 3);
  // per run: twice the area, the normals' sum, six times the volume, the volume-weighted corner sums,
  // and 120 times the second moments about the first point
  const sums = Array.from({ length: runs }, () => ({ area2: 0, nx: 0, ny: 0, nz: 0, v6: 0, cx: 0, cy: 0, cz: 0, xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 }));
  for (let f = 0; f < tris.length / 3; f++) {
    const s = sums[run[f]];
    // a face turned over runs b, a, c
    const [i, j] = turned[f] ? [3 * tris[3 * f + 1], 3 * tris[3 * f]] : [3 * tris[3 * f], 3 * tris[3 * f + 1]];
    const l = 3 * tris[3 * f + 2];
    const ax = pts[i], ay = pts[i + 1], az = pts[i + 2];
    const bx = pts[j], by = pts[j + 1], bz = pts[j + 2];
    const qx = pts[l], qy = pts[l + 1], qz = pts[l + 2];
    // the face's normal, twice its area long
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = qx - ax, fy = qy - ay, fz = qz - az;
    const kx = ey * fz - ez * fy, ky = ez * fx - ex * fz, kz = ex * fy - ey * fx;
    s.area2 += Math.hypot(kx, ky, kz);
    s.nx += kx;
    s.ny += ky;
    s.nz += kz;
    // six times the signed volume of the tetrahedron from the first point to the face
    const v = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    s.v6 += v;
    const sx = ax + bx + qx;
    const sy = ay + by + qy;
    const sz = az + bz + qz;
    s.cx += v * sx;
    s.cy += v * sy;
    s.cz += v * sz;
    s.xx += v * (ax * ax + bx * bx + qx * qx + sx * sx);
    s.yy += v * (ay * ay + by * by + qy * qy + sy * sy);
    s.zz += v * (az * az + bz * bz + qz * qz + sz * sz);
    s.xy += v * (ax * ay + bx * by + qx * qy + sx * sy);
    s.yz += v * (ay * az + by * bz + qy * qz + sy * sz);
    s.zx += v * (az * ax + bz * bx + qz * qx + sz * sx);
  }
  let area2 = 0;
  let v6 = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const second = { xx: 0, yy: 0, zz: 0, xy: 0, yz: 0, zx: 0 };
  let closed = true;
  for (const s of sums) {
    area2 += s.area2;
    if (Math.hypot(s.nx, s.ny, s.nz) > OPEN_SHARE * s.area2 || s.v6 === 0) closed = false;
    // a run wound inwards comes out negative
    const sign = Math.sign(s.v6);
    v6 += sign * s.v6;
    cx += sign * s.cx;
    cy += sign * s.cy;
    cz += sign * s.cz;
    for (const k of ["xx", "yy", "zz", "xy", "yz", "zx"] as const) second[k] += (sign * s[k]) / 120;
  }
  if (area2 === 0) return null;
  if (!closed) return { area: area2 / 2, volume: null, center: null, inertia: null };
  const volume = v6 / 6;
  // the centre from the first point, and the moments moved to it
  const [x, y, z] = [cx / (4 * v6), cy / (4 * v6), cz / (4 * v6)];
  const xx = second.xx - volume * x * x;
  const yy = second.yy - volume * y * y;
  const zz = second.zz - volume * z * z;
  return {
    area: area2 / 2,
    volume,
    center: { x: first[0] + x, y: first[1] + y, z: first[2] + z },
    inertia: { xx: yy + zz, yy: xx + zz, zz: xx + yy, xy: second.xy - volume * x * y, yz: second.yz - volume * y * z, zx: second.zx - volume * z * x },
  };
}
