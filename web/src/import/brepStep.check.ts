// Checks the B-rep meshing under Node. Run from web/:
//   npx tsx src/import/brepStep.check.ts
// Each body is built by hand in ACIS style (planes, cylinders and cones with sinHalf 0 or negative
// cosHalf, full-circle edges with start = end, a cone's apex as a vertex loop, spheres and tori with
// no loops, a box with a hole, a bicubic patch with short knot vectors, a face on an unknown surface),
// written to STEP, read back and meshed by occt-import-js, and the triangles are checked against the
// true shape: volume, area and whether every normal points out. The bicubic patch's area is checked
// against a fine sampling of its own B-spline surface.

import type { BrepBody, BrepCoedge, BrepCurve, BrepEdge, BrepFace, BrepLoop, BrepShell, V3 } from "./brep.ts";
import { meshBreps, writeBrep } from "./brepStep.ts";
import { loadOcct } from "./occt.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, rel: number): boolean => Math.abs(a - b) <= rel * Math.abs(b);
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const same = (a: V3, b: V3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const TAU = 2 * Math.PI;

/** A rigid move: a turn about z, then an offset, for points and for directions. */
interface Xf {
  readonly point: (p: V3) => V3;
  readonly dir: (d: V3) => V3;
}
const ID: Xf = { point: (p) => p, dir: (d) => d };
function move(turn: number, offset: V3): Xf {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const rot = (d: V3): V3 => [c * d[0] - s * d[1], s * d[0] + c * d[1], d[2]];
  return { point: (p) => { const r = rot(p); return [r[0] + offset[0], r[1] + offset[1], r[2] + offset[2]]; }, dir: rot };
}

/** Edges shared by their coedges: one BrepEdge per pair of points, however the loops run along it. */
class Edges {
  private readonly store = new Map<string, BrepEdge>();
  /** The edge between a and b, as a coedge running from a to b. */
  use(a: V3, b: V3): BrepCoedge {
    const e = this.store.get(`${a}|${b}`) ?? this.store.get(`${b}|${a}`) ?? this.line(a, b);
    return { edge: e, reversed: !same(e.start, a) };
  }
  private line(a: V3, b: V3): BrepEdge {
    const d = sub(b, a);
    const e: BrepEdge = { start: a, end: b, curve: { kind: "line", origin: a, dir: d }, t0: 0, t1: len(d), reversed: false };
    this.store.set(`${a}|${b}`, e);
    return e;
  }
}

/** A loop through points, each consecutive pair a coedge, the points turned to run counter-clockwise about `normal`. */
function polyLoop(edges: Edges, pts: readonly V3[], normal: V3): BrepLoop {
  const ordered = dot(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])), normal) < 0 ? [...pts].reverse() : [...pts];
  return { coedges: ordered.map((p, i) => edges.use(p, ordered[(i + 1) % ordered.length])) };
}

function plane(origin: V3, normal: V3, uDir: V3, loops: BrepLoop[], reversed = false): BrepFace {
  return { surface: { kind: "plane", origin, normal, uDir }, reversed, loops, doubleSided: false };
}

/** A box between lo and hi, moved by xf. */
function box(lo: V3, hi: V3, xf: Xf = ID): BrepBody {
  const edges = new Edges();
  const c = (x: number, y: number, z: number): V3 => xf.point([x, y, z]);
  const faces: BrepFace[] = [];
  const quad = (pts: V3[], n: V3, u: V3): void => {
    const normal = xf.dir(n);
    faces.push(plane(pts[0], normal, xf.dir(u), [polyLoop(edges, pts, normal)]));
  };
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  quad([c(x0, y0, z0), c(x0, y1, z0), c(x0, y1, z1), c(x0, y0, z1)], [-1, 0, 0], [0, 1, 0]);
  quad([c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1), c(x1, y0, z1)], [1, 0, 0], [0, 1, 0]);
  quad([c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)], [0, -1, 0], [1, 0, 0]);
  quad([c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1)], [0, 1, 0], [1, 0, 0]);
  quad([c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0)], [0, 0, -1], [1, 0, 0]);
  quad([c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)], [0, 0, 1], [1, 0, 0]);
  return { shells: [{ faces }] };
}

/** A full circle of radius r about the z axis at height z, moved by xf: start = end, no seam. */
function circle(r: number, z: number, xf: Xf = ID): BrepEdge {
  const at = xf.point([r, 0, z]);
  return {
    start: at,
    end: at,
    curve: { kind: "ellipse", center: xf.point([0, 0, z]), normal: xf.dir([0, 0, 1]), major: xf.dir([r, 0, 0]), ratio: 1 },
    t0: 0,
    t1: TAU,
    reversed: false,
  };
}

/** An ACIS cylinder of radius r and height h on the z axis, as ACIS has it; `cosHalf` -1 writes its cone reversed. */
function cylinder(r: number, h: number, xf: Xf = ID, cosHalf = 1): BrepBody {
  const bottom = circle(r, 0, xf);
  const top = circle(r, h, xf);
  const reversedSurface = cosHalf < 0;
  const down = xf.dir([0, 0, -1]);
  const up = xf.dir([0, 0, 1]);
  const cone: BrepFace = {
    surface: { kind: "cone", origin: xf.point([0, 0, 0]), axis: xf.dir([0, 0, 1]), major: xf.dir([r, 0, 0]), ratio: 1, sinHalf: 0, cosHalf },
    // the side's outward normal is the cone's normal, flipped when the surface is reversed
    reversed: reversedSurface,
    loops: [
      { coedges: [{ edge: bottom, reversed: false }] },
      { coedges: [{ edge: top, reversed: true }] },
    ],
    doubleSided: false,
  };
  return {
    shells: [
      {
        faces: [
          plane(xf.point([0, 0, 0]), down, xf.dir([1, 0, 0]), [{ coedges: [{ edge: bottom, reversed: true }] }]),
          plane(xf.point([0, 0, h]), up, xf.dir([1, 0, 0]), [{ coedges: [{ edge: top, reversed: false }] }]),
          cone,
        ],
      },
    ],
  };
}

/** A cone of base radius 2 and height 3 narrowing to an apex, ACIS style: sinHalf and cosHalf negative and positive. */
function cone(): BrepBody {
  const edge = circle(2, 0);
  const apex: V3 = [0, 0, 3];
  const apexEdge: BrepEdge = { start: apex, end: apex, curve: null, t0: 0, t1: 0, reversed: false };
  const k = Math.sqrt(13);
  const side: BrepFace = {
    surface: { kind: "cone", origin: [0, 0, 0], axis: [0, 0, 1], major: [2, 0, 0], ratio: 1, sinHalf: -2 / k, cosHalf: 3 / k },
    reversed: false,
    loops: [{ coedges: [{ edge, reversed: false }] }, { coedges: [{ edge: apexEdge, reversed: false }] }],
    doubleSided: false,
  };
  const base = plane([0, 0, 0], [0, 0, -1], [1, 0, 0], [{ coedges: [{ edge, reversed: true }] }]);
  return { shells: [{ faces: [base, side] }] };
}

/** The cone of cone() with both halves negated and its face reversed: the same surface with its normal turned. */
function coneReversed(): BrepBody {
  const [base, side] = cone().shells[0].faces;
  if (side.surface.kind !== "cone") throw new Error("the side of cone() is a cone");
  const { surface } = side;
  const flipped: BrepFace = { ...side, surface: { ...surface, sinHalf: -surface.sinHalf, cosHalf: -surface.cosHalf }, reversed: true };
  return { shells: [{ faces: [base, flipped] }] };
}

/** A sphere of radius -3 (ACIS's inward normals) with its face reversed: the same solid as a sphere of radius 3. */
const sphereReversed = (): BrepBody => ({ shells: [{ faces: [{ surface: { kind: "sphere", center: [0, 0, 0], radius: -3, uDir: [1, 0, 0], pole: [0, 0, 1] }, reversed: true, loops: [], doubleSided: false }] }] });

/** A sphere of radius 3 as one face with no loops, and a torus of major 5 and minor 1 likewise. */
const sphere = (): BrepBody => ({ shells: [{ faces: [{ surface: { kind: "sphere", center: [0, 0, 0], radius: 3, uDir: [1, 0, 0], pole: [0, 0, 1] }, reversed: false, loops: [], doubleSided: false }] }] });
const torus = (): BrepBody => ({ shells: [{ faces: [{ surface: { kind: "torus", center: [0, 0, 0], axis: [0, 0, 1], major: 5, minor: 1, uDir: [1, 0, 0] }, reversed: false, loops: [], doubleSided: false }] }] });

/** A 4 by 4 by 2 box with a radius 1 hole through it, the hole's wall an ACIS cylinder with its normal into the hole. */
function holedBox(): BrepBody {
  const edges = new Edges();
  const z0: V3 = [0, 0, 0];
  const hole0: V3 = [3, 2, 0];
  const hole1: V3 = [3, 2, 2];
  const bottomCircle: BrepEdge = { start: hole0, end: hole0, curve: { kind: "ellipse", center: [2, 2, 0], normal: [0, 0, 1], major: [1, 0, 0], ratio: 1 }, t0: 0, t1: TAU, reversed: false };
  const topCircle: BrepEdge = { start: hole1, end: hole1, curve: { kind: "ellipse", center: [2, 2, 2], normal: [0, 0, 1], major: [1, 0, 0], ratio: 1 }, t0: 0, t1: TAU, reversed: false };
  const square = (z: number): V3[] => [[0, 0, z], [4, 0, z], [4, 4, z], [0, 4, z]];
  const outerTop = polyLoop(edges, square(2), [0, 0, 1]);
  const outerBottom = polyLoop(edges, square(0), [0, 0, -1]);
  const faces: BrepFace[] = [
    plane([0, 0, 2], [0, 0, 1], [1, 0, 0], [outerTop, { coedges: [{ edge: topCircle, reversed: true }] }]),
    plane(z0, [0, 0, -1], [1, 0, 0], [outerBottom, { coedges: [{ edge: bottomCircle, reversed: false }] }]),
    plane([0, 0, 0], [-1, 0, 0], [0, 1, 0], [polyLoop(edges, [[0, 0, 0], [0, 4, 0], [0, 4, 2], [0, 0, 2]], [-1, 0, 0])]),
    plane([4, 0, 0], [1, 0, 0], [0, 1, 0], [polyLoop(edges, [[4, 0, 0], [4, 4, 0], [4, 4, 2], [4, 0, 2]], [1, 0, 0])]),
    plane([0, 0, 0], [0, -1, 0], [1, 0, 0], [polyLoop(edges, [[0, 0, 0], [4, 0, 0], [4, 0, 2], [0, 0, 2]], [0, -1, 0])]),
    plane([0, 4, 0], [0, 1, 0], [1, 0, 0], [polyLoop(edges, [[0, 4, 0], [4, 4, 0], [4, 4, 2], [0, 4, 2]], [0, 1, 0])]),
    {
      // the normal points into the hole, out of the material: the cylinder's own normal (cosHalf 1) is out of the hole, so the face is reversed
      surface: { kind: "cone", origin: [2, 2, 0], axis: [0, 0, 1], major: [1, 0, 0], ratio: 1, sinHalf: 0, cosHalf: 1 },
      reversed: true,
      loops: [{ coedges: [{ edge: topCircle, reversed: false }] }, { coedges: [{ edge: bottomCircle, reversed: true }] }],
      doubleSided: false,
    },
  ];
  return { shells: [{ faces }] };
}

/** A bicubic B-spline patch with ACIS's short knot vectors (first and last knot left out) as one open face. */
interface Patch {
  readonly body: BrepBody;
  readonly eval: (u: number, v: number) => V3;
}
function patch(rational = false): Patch {
  const deg = 3;
  const count = 4;
  const pts: V3[] = [];
  for (let iu = 0; iu < count; iu++) for (let iv = 0; iv < count; iv++) pts.push([iu / 3, iv / 3, 0.3 * Math.sin(iu + 0.5) * Math.cos(iv) + 0.2 * iu * iv / 9]);
  const short = [0, 0, 0, 1, 1, 1];
  const full = [0, 0, 0, 0, 1, 1, 1, 1];
  const row = (iu: number): V3[] => pts.slice(iu * count, (iu + 1) * count);
  const col = (iv: number): V3[] => Array.from({ length: count }, (_, iu) => pts[iu * count + iv]);
  // the four boundary curves, each from its start corner to its end corner, as ACIS keeps them
  const curve = (ps: V3[]): BrepCurve => ({ kind: "nurbs", degree: deg, knots: short, points: ps, weights: null });
  const corner = (iu: number, iv: number): V3 => pts[iu * count + iv];
  const edge = (a: V3, b: V3, ps: V3[]): BrepEdge => ({ start: a, end: b, curve: curve(ps), t0: 0, t1: 1, reversed: false });
  const e = {
    v0: edge(corner(0, 0), corner(0, 3), row(0)),
    v3: edge(corner(0, 3), corner(3, 3), col(3)),
    u3: edge(corner(3, 3), corner(3, 0), [...row(3)].reverse()),
    u0: edge(corner(3, 0), corner(0, 0), [...col(0)].reverse()),
  };
  const loop: BrepLoop = { coedges: [e.v0, e.v3, e.u3, e.u0].map((edge) => ({ edge, reversed: false })) };
  const face: BrepFace = {
    surface: { kind: "nurbs", degreeU: deg, degreeV: deg, knotsU: short, knotsV: short, countU: count, countV: count, points: pts, weights: rational ? pts.map(() => 1) : null },
    reversed: false,
    loops: [loop],
    doubleSided: true,
  };
  const eval_ = (u: number, v: number): V3 => {
    const uu = Math.min(Math.max(u, 0), 1 - 1e-12);
    const vv = Math.min(Math.max(v, 0), 1 - 1e-12);
    const nu = basis(full, deg, uu);
    const nv = basis(full, deg, vv);
    const out: [number, number, number] = [0, 0, 0];
    for (let iu = 0; iu < count; iu++) for (let iv = 0; iv < count; iv++) {
      const w = nu[iu] * nv[iv];
      const p = pts[iu * count + iv];
      out[0] += w * p[0];
      out[1] += w * p[1];
      out[2] += w * p[2];
    }
    return out;
  };
  return { body: { shells: [{ faces: [face] }] }, eval: eval_ };
}

/** Whether the triangles close up: every edge walked once each way, so the mesh is watertight and consistently oriented. */
function closedAndOriented(mesh: Float32Array): boolean {
  // to a micron, with no negative zeros: (-1e-17).toFixed(3) reads "-0.000"
  const q = (x: number): string => (Math.round(x * 1000) / 1000 + 0).toFixed(3);
  const key = (i: number): string => `${q(mesh[i])},${q(mesh[i + 1])},${q(mesh[i + 2])}`;
  const walks = new Map<string, number>();
  for (let t = 0; t < mesh.length / 9; t++) {
    const k = [key(9 * t), key(9 * t + 3), key(9 * t + 6)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    for (let i = 0; i < 3; i++) {
      const walk = `${k[i]}>${k[(i + 1) % 3]}`;
      walks.set(walk, (walks.get(walk) ?? 0) + 1);
    }
  }
  for (const [walk, n] of walks) {
    const [a, b] = walk.split(">");
    if (walks.get(`${b}>${a}`) !== n) return false;
  }
  return walks.size > 0;
}

/** A frustum on the z axis: radius r0 at the bottom, r1 at height h, the cone's radius growing by (r1 - r0) / h per unit along the axis. */
function frustum(r0: number, r1: number, h: number): BrepBody {
  const bottom = circle(r0, 0);
  const top = circle(r1, h);
  const slope = (r1 - r0) / h;
  const k = Math.hypot(1, slope);
  const side: BrepFace = {
    surface: { kind: "cone", origin: [0, 0, 0], axis: [0, 0, 1], major: [r0, 0, 0], ratio: 1, sinHalf: slope / k, cosHalf: 1 / k },
    reversed: false,
    loops: [{ coedges: [{ edge: bottom, reversed: false }] }, { coedges: [{ edge: top, reversed: true }] }],
    doubleSided: false,
  };
  return {
    shells: [
      {
        faces: [
          plane([0, 0, 0], [0, 0, -1], [1, 0, 0], [{ coedges: [{ edge: bottom, reversed: true }] }]),
          plane([0, 0, h], [0, 0, 1], [1, 0, 0], [{ coedges: [{ edge: top, reversed: false }] }]),
          side,
        ],
      },
    ],
  };
}

/** The B-spline basis functions of degree p at u, by the Cox-de Boor recursion. */
function basis(knots: readonly number[], p: number, u: number): number[] {
  let n: number[] = [];
  for (let i = 0; i < knots.length - 1; i++) n.push(u >= knots[i] && u < knots[i + 1] ? 1 : 0);
  for (let k = 1; k <= p; k++) {
    const m: number[] = [];
    for (let i = 0; i < knots.length - k - 1; i++) {
      const left = knots[i + k] === knots[i] ? 0 : ((u - knots[i]) / (knots[i + k] - knots[i])) * n[i];
      const right = knots[i + k + 1] === knots[i + 1] ? 0 : ((knots[i + k + 1] - u) / (knots[i + k + 1] - knots[i + 1])) * n[i + 1];
      m.push(left + right);
    }
    n = m;
  }
  return n;
}

/** An elliptical cylinder: semi-axes 2 and 1 (ratio 0.5), height 5, as ACIS has it, its ellipses full. */
function ellipticalCylinder(): BrepBody {
  const ellipse = (z: number): BrepEdge => {
    const at: V3 = [2, 0, z];
    return { start: at, end: at, curve: { kind: "ellipse", center: [0, 0, z], normal: [0, 0, 1], major: [2, 0, 0], ratio: 0.5 }, t0: 0, t1: TAU, reversed: false };
  };
  const bottom = ellipse(0);
  const top = ellipse(5);
  const side: BrepFace = {
    surface: { kind: "cone", origin: [0, 0, 0], axis: [0, 0, 1], major: [2, 0, 0], ratio: 0.5, sinHalf: 0, cosHalf: 1 },
    reversed: false,
    loops: [{ coedges: [{ edge: bottom, reversed: false }] }, { coedges: [{ edge: top, reversed: true }] }],
    doubleSided: false,
  };
  return {
    shells: [
      {
        faces: [
          plane([0, 0, 0], [0, 0, -1], [1, 0, 0], [{ coedges: [{ edge: bottom, reversed: true }] }]),
          plane([0, 0, 5], [0, 0, 1], [1, 0, 0], [{ coedges: [{ edge: top, reversed: false }] }]),
          side,
        ],
      },
    ],
  };
}

/** A box of side 4 with a box of side 2 inside it as a void: its own shell, its faces turned into the void. */
function voidBox(): BrepBody {
  const outer = box([0, 0, 0], [4, 4, 4]).shells[0];
  const inner = box([1, 1, 1], [3, 3, 3]).shells[0];
  const voidShell: BrepShell = { faces: inner.faces.map((f) => ({ ...f, reversed: !f.reversed })) };
  return { shells: [outer, voidShell] };
}

/** Volume, area and whether each triangle's normal points away from `centre` (for convex shapes). */
interface Stats {
  readonly volume: number;
  readonly area: number;
  readonly outward: number;
  readonly triangles: number;
}
function statsOf(mesh: Float32Array, centre: V3): Stats {
  let volume = 0;
  let area = 0;
  let outward = 0;
  const n = mesh.length / 9;
  for (let t = 0; t < n; t++) {
    const a: V3 = [mesh[9 * t], mesh[9 * t + 1], mesh[9 * t + 2]];
    const b: V3 = [mesh[9 * t + 3], mesh[9 * t + 4], mesh[9 * t + 5]];
    const c: V3 = [mesh[9 * t + 6], mesh[9 * t + 7], mesh[9 * t + 8]];
    volume += dot(a, cross(b, c)) / 6;
    const nrm = cross(sub(b, a), sub(c, a));
    area += len(nrm) / 2;
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    if (dot(nrm, mid) > 0) outward++;
  }
  return { volume, area, outward: outward / Math.max(1, n), triangles: n };
}


async function main(): Promise<void> {
  const t0 = performance.now();
  const occt = await loadOcct();
  console.log(`occt-import-js loaded in ${(performance.now() - t0).toFixed(0)} ms`);

  const one = (body: BrepBody): Float32Array | null => meshBreps(occt, [[body]])[0];
  const timed = (body: BrepBody): { mesh: Float32Array | null; ms: number } => {
    const start = performance.now();
    const mesh = one(body);
    return { mesh, ms: performance.now() - start };
  };

  // a unit cube, then the same cube turned and moved
  {
    const { mesh, ms } = timed(box([0, 0, 0], [1, 1, 1]));
    const s = mesh ? statsOf(mesh, [0.5, 0.5, 0.5]) : null;
    check(!!s && near(s.volume, 1, 1e-6) && near(s.area, 6, 1e-6), `unit cube: volume ${s?.volume.toFixed(6)} area ${s?.area.toFixed(6)} (${ms.toFixed(1)} ms)`);
    check(!!s && s.outward === 1, `unit cube: every normal outward (${s ? (s.outward * 100).toFixed(0) : "-"}%)`);
  }
  {
    const xf = move(0.5, [3, -2, 1.5]);
    const centre = xf.point([0.5, 0.5, 0.5]);
    const { mesh, ms } = timed(box([0, 0, 0], [1, 1, 1], xf));
    const s = mesh ? statsOf(mesh, centre) : null;
    check(!!s && near(s.volume, 1, 1e-6) && near(s.area, 6, 1e-6), `rotated and moved cube: volume ${s?.volume.toFixed(6)} area ${s?.area.toFixed(6)} (${ms.toFixed(1)} ms)`);
    check(!!s && s.outward === 1, `rotated and moved cube: every normal outward (${s ? (s.outward * 100).toFixed(0) : "-"}%)`);
  }

  // cylinders: r 2, h 5, volume pi r^2 h and area 2 pi r h + 2 pi r^2
  const cylVolume = Math.PI * 4 * 5;
  const cylArea = 2 * Math.PI * 2 * 5 + 2 * Math.PI * 4;
  {
    const { mesh, ms } = timed(cylinder(2, 5));
    const s = mesh ? statsOf(mesh, [0, 0, 2.5]) : null;
    check(!!s && near(s.volume, cylVolume, 0.01) && !!mesh && closedAndOriented(mesh), `cylinder r 2 h 5: volume ${s?.volume.toFixed(3)} vs ${cylVolume.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
    check(!!s && near(s.area, cylArea, 0.01), `cylinder r 2 h 5: area ${s?.area.toFixed(3)} vs ${cylArea.toFixed(3)}`);
  }
  {
    const { mesh } = timed(cylinder(2, 5, ID, -1));
    const s = mesh ? statsOf(mesh, [0, 0, 2.5]) : null;
    check(!!s && near(s.volume, cylVolume, 0.01) && near(s.area, cylArea, 0.01), `cylinder with its cone reversed (cosHalf -1): volume ${s?.volume.toFixed(3)} area ${s?.area.toFixed(3)}`);
  }

  // a cone of base radius 2, height 3, narrowing to an apex
  {
    const { mesh, ms } = timed(cone());
    const s = mesh ? statsOf(mesh, [0, 0, 1]) : null;
    const vol = Math.PI * 4 * 3 / 3;
    check(!!s && near(s.volume, vol, 0.015) && !!mesh && closedAndOriented(mesh), `cone r 2 h 3 with apex: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }

  // a frustum opening upward (radius 1 to 3 over height 4), and a cone with both halves negated and its face reversed
  {
    const { mesh, ms } = timed(frustum(1, 3, 4));
    const s = mesh ? statsOf(mesh, [0, 0, 2]) : null;
    const vol = (Math.PI * 4 * (1 + 3 + 9)) / 3;
    check(!!s && near(s.volume, vol, 0.01) && !!mesh && closedAndOriented(mesh), `frustum r 1 to 3 h 4: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }
  {
    const { mesh } = timed(coneReversed());
    const s = mesh ? statsOf(mesh, [0, 0, 1]) : null;
    const vol = (Math.PI * 4 * 3) / 3;
    check(!!s && near(s.volume, vol, 0.015) && !!mesh && closedAndOriented(mesh), `cone with both halves negated and face reversed: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}`);
  }

  // a sphere and a torus with no loops, meshed as grids
  {
    const { mesh, ms } = timed(sphere());
    const s = mesh ? statsOf(mesh, [0, 0, 0]) : null;
    const vol = (4 / 3) * Math.PI * 27;
    check(!!s && near(s.volume, vol, 0.02) && !!mesh && closedAndOriented(mesh), `full sphere r 3: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }
  {
    // a torus with a negative minor radius and its face reversed: the same solid
    const torusReversed: BrepBody = { shells: [{ faces: [{ surface: { kind: "torus", center: [0, 0, 0], axis: [0, 0, 1], major: 5, minor: -1, uDir: [1, 0, 0] }, reversed: true, loops: [], doubleSided: false }] }] };
    const { mesh } = timed(torusReversed);
    const s = mesh ? statsOf(mesh, [0, 0, 0]) : null;
    const vol = 2 * Math.PI * Math.PI * 5;
    check(!!s && near(s.volume, vol, 0.02), `torus with minor radius -1 and its face reversed: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}`);
  }
  {
    const { mesh } = timed(sphereReversed());
    const s = mesh ? statsOf(mesh, [0, 0, 0]) : null;
    const vol = (4 / 3) * Math.PI * 27;
    check(!!s && near(s.volume, vol, 0.02), `sphere of radius -3 with its face reversed: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}`);
  }
  {
    const { mesh, ms } = timed(torus());
    const s = mesh ? statsOf(mesh, [0, 0, 0]) : null;
    const vol = 2 * Math.PI * Math.PI * 5;
    check(!!s && near(s.volume, vol, 0.02) && !!mesh && closedAndOriented(mesh), `torus R 5 r 1: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }

  // a box with a hole through it
  {
    const { mesh, ms } = timed(holedBox());
    const s = mesh ? statsOf(mesh, [2, 2, 1]) : null;
    const vol = 32 - 2 * Math.PI;
    check(!!s && near(s.volume, vol, 0.01) && !!mesh && closedAndOriented(mesh), `box 4x4x2 with a r 1 hole: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }

  // a bicubic patch: area against a fine sampling of its own surface
  {
    const p = patch();
    const { mesh, ms } = timed(p.body);
    const n = 200;
    let sampled = 0;
    const h = 1e-4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const u = (i + 0.5) / n;
      const v = (j + 0.5) / n;
      const su = sub(p.eval(u + h, v), p.eval(u - h, v));
      const sv = sub(p.eval(u, v + h), p.eval(u, v - h));
      sampled += len(cross(su, sv)) / (2 * h) / (2 * h) / (n * n);
    }
    const area = mesh ? statsOf(mesh, [0, 0, 0]).area : 0;
    check(!!mesh && near(area, sampled, 0.02), `bicubic patch: area ${area.toFixed(5)} vs sampled ${sampled.toFixed(5)} (${ms.toFixed(1)} ms)`);
  }

  // the same patch in rational form (unit weights): the complex STEP entity reads the same
  {
    const p = patch(true);
    const { mesh } = timed(p.body);
    const area = mesh ? statsOf(mesh, [0, 0, 0]).area : 0;
    const plain = timed(patch().body).mesh;
    const ref = plain ? statsOf(plain, [0, 0, 0]).area : 0;
    check(!!mesh && near(area, ref, 1e-4), `rational bicubic patch with unit weights: area ${area.toFixed(5)} vs ${ref.toFixed(5)}`);
  }

  // an elliptical cylinder (semi-axes 2 and 1, height 5) and a box with a void inside it
  {
    const { mesh, ms } = timed(ellipticalCylinder());
    const s = mesh ? statsOf(mesh, [0, 0, 2.5]) : null;
    const vol = Math.PI * 2 * 1 * 5;
    check(!!s && near(s.volume, vol, 0.01) && !!mesh && closedAndOriented(mesh), `elliptical cylinder 2 by 1 h 5: volume ${s?.volume.toFixed(3)} vs ${vol.toFixed(3)}, closed (${ms.toFixed(1)} ms)`);
  }
  {
    const { mesh, ms } = timed(voidBox());
    const s = mesh ? statsOf(mesh, [2, 2, 2]) : null;
    const vol = 64 - 8;
    check(!!s && near(s.volume, vol, 0.01), `box 4 with a void of 2 inside: volume ${s?.volume.toFixed(3)} vs ${vol} (${ms.toFixed(1)} ms)`);
  }

  // a body with a face on an unknown surface: that face left out and counted, the rest meshed
  {
    const body = box([0, 0, 0], [1, 1, 1]);
    const [first, ...rest] = body.shells[0].faces;
    const faces: BrepFace[] = [{ ...first, surface: { kind: "unknown", name: "spline-free-form" } }, ...rest];
    const shaped: BrepBody = { shells: [{ faces }] };
    const { skipped } = writeBrep([shaped]);
    check(skipped === 1, `unknown surface: ${skipped} face left out`);
    const { mesh } = timed(shaped);
    const s = mesh ? statsOf(mesh, [0.5, 0.5, 0.5]) : null;
    check(!!s && near(s.area, 5, 1e-6), `unknown surface: the other five faces meshed, area ${s?.area.toFixed(6)}`);
  }

  // sixty cylinders in one call, each its own solid
  {
    const solids: BrepBody[][] = Array.from({ length: 60 }, (_, i) => [cylinder(2, 5, move(0, [i * 6, 0, 0]))]);
    const start = performance.now();
    const meshes = meshBreps(occt, solids);
    const ms = performance.now() - start;
    const ok = meshes.every((m) => m !== null);
    const vol = meshes.reduce((acc, m) => acc + (m ? statsOf(m, [0, 0, 2.5]).volume : 0), 0);
    check(ok && near(vol, 60 * cylVolume, 0.01), `60 cylinders in one call: ${ms.toFixed(0)} ms (${(ms / 60).toFixed(2)} ms each), total volume ${vol.toFixed(1)} vs ${(60 * cylVolume).toFixed(1)}`);
  }

  console.log(failures === 0 ? "all passed" : `${failures} failed`);
  if (failures) process.exitCode = 1;
}

await main();
