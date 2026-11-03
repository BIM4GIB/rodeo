// The sums behind Model > Create Surface Array: items repeated in a grid across a flat object or surface. A
// surface here is triangles, with no U and V of its own, so the grid is laid out on the plane the surface faces
// most and each item's points are carried along that plane's normal onto it, standing up along the surface's
// normal where they meet it. Kept apart from the dialog so it runs without the page.

import { intersectMeshes, subtractMeshes, trimmedMesh } from "../core/csg.ts";
import { openLoops } from "./powerPackShapes.ts";
import { isClosedMesh, ringSlab, stitched, type Vec3 } from "./solidOps.ts";

export type Point = readonly [number, number, number];
type Flat = readonly [number, number];

export type Repeat = "count" | "distance";
export type EdgeCondition = "overlap" | "omit" | "trim";

export interface ArrayOptions {
  originX: number;
  originY: number;
  /** degrees */
  rotation: number;
  modeX: Repeat;
  modeY: Repeat;
  countX: number;
  countY: number;
  /** the length of an item, each way, in mm */
  distanceX: number;
  distanceY: number;
  offsetX: number;
  offsetY: number;
  shiftX: number;
  shiftY: number;
  edge: EdgeCondition;
  scaleZ: boolean;
  /** Switch Z' Direction: the other side of the surface */
  flip: boolean;
}

export const newArrayOptions = (): ArrayOptions => ({
  originX: 0,
  originY: 0,
  rotation: 0,
  modeX: "count",
  modeY: "count",
  countX: 3,
  countY: 3,
  distanceX: 1000,
  distanceY: 1000,
  offsetX: 1,
  offsetY: 1,
  shiftX: 0,
  shiftY: 0,
  edge: "overlap",
  scaleZ: true,
  flip: false,
});

/** the most items an array can have */
export const MAX_CELLS = 5000;

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

export interface BaseSurface {
  /** the middle of its box on the plane it faces */
  readonly centre: Point;
  readonly ex: Point;
  readonly ey: Point;
  readonly normal: Point;
  readonly width: number;
  readonly height: number;
  readonly flat: boolean;
  /** how far it reaches off that plane */
  readonly depth: number;
  readonly points: readonly Point[];
  readonly triangles: readonly (readonly [number, number, number])[];
  readonly uv: readonly Flat[];
  readonly faceNormals: readonly Point[];
  readonly pointNormals: readonly Point[];
  /** its rims on the plane, largest first */
  readonly rims: readonly (readonly Flat[])[];
  readonly grid: ReadonlyMap<string, readonly number[]>;
  readonly cell: number;
}

const ringArea = (r: readonly Flat[]): number => {
  let sum = 0;
  for (let i = 0; i < r.length; i++) sum += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
  return Math.abs(sum) / 2;
};

/** How a flat object or open surface takes an array, or why it won't. */
export function baseSurface(tris: ArrayLike<number>): BaseSurface | string {
  const mesh = stitched(tris);
  const { points, triangles } = mesh;
  if (!triangles.length) return "This object shows no faces.";
  let facing: Point = [0, 0, 0];
  let total = 0;
  for (const t of triangles) {
    const n = cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]]));
    facing = add(facing, n);
    total += length(n);
  }
  if (length(facing) < total * 0.05) return "This surface faces every way alike, so there's no side to lay an array on.";
  // a level surface has its array on top, whichever way its faces run; Switch Z' Direction gets the other side
  const side = facing[2] < -1e-6 * length(facing) ? -1 : 1;
  const normal = scale(unit(facing), side);
  const loops = openLoops(mesh);
  if (!loops.length) return "A closed solid can't be a base: use a flat object or an open surface.";

  // along the object's own sides when that fits it closest, as with a rectangle turned on the plane; level otherwise
  const across = (x: Point): Point => cross(normal, x);
  const inPlane = (way: Point): Point => unit(sub(way, scale(normal, dot(way, normal))));
  const areaAlong = (x: Point): number => {
    const y = across(x);
    let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of points) {
      const [a, b] = [dot(p, x), dot(p, y)];
      [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
    }
    return (a1 - a0) * (b1 - b0);
  };
  const level = inPlane(Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  let ex = level;
  let best = areaAlong(level) * 0.99;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const way = inPlane(sub(points[loop[(i + 1) % loop.length]], points[loop[i]]));
      if (!length(way)) continue;
      const area = areaAlong(way);
      if (area < best) [best, ex] = [area, way];
    }
  }
  // the long way of what it fits, as near level as it'll go
  if (Math.abs(dot(ex, level)) < Math.SQRT1_2) ex = across(ex);
  if (dot(ex, level) < 0) ex = scale(ex, -1);
  const ey = across(ex);

  const raw = points.map((p): Flat => [dot(p, ex), dot(p, ey)]);
  const [u0, u1] = [Math.min(...raw.map((p) => p[0])), Math.max(...raw.map((p) => p[0]))];
  const [v0, v1] = [Math.min(...raw.map((p) => p[1])), Math.max(...raw.map((p) => p[1]))];
  const heights = points.map((p) => dot(p, normal));
  const h0 = Math.min(...heights);
  const h1 = Math.max(...heights);
  const [mu, mv] = [(u0 + u1) / 2, (v0 + v1) / 2];
  const centre = add(add(scale(ex, mu), scale(ey, mv)), scale(normal, (h0 + h1) / 2));
  const uv = raw.map((p): Flat => [p[0] - mu, p[1] - mv]);
  const size = Math.max(u1 - u0, v1 - v0, 1);

  const faceNormals: Point[] = [];
  const summed: Point[] = points.map(() => [0, 0, 0]);
  triangles.forEach((t) => {
    const n = cross(sub(points[t[1]], points[t[0]]), sub(points[t[2]], points[t[0]]));
    faceNormals.push(scale(unit(n), side));
    for (const v of t) summed[v] = add(summed[v], scale(n, side));
  });
  const pointNormals = summed.map(unit);

  // which triangles are over which part of the plane
  const cell = size / Math.max(1, Math.ceil(Math.sqrt(triangles.length)));
  const grid = new Map<string, number[]>();
  triangles.forEach((t, i) => {
    const [a, b, c] = [uv[t[0]], uv[t[1]], uv[t[2]]];
    for (let x = Math.floor(Math.min(a[0], b[0], c[0]) / cell); x <= Math.floor(Math.max(a[0], b[0], c[0]) / cell); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1], c[1]) / cell); y <= Math.floor(Math.max(a[1], b[1], c[1]) / cell); y++) {
        const key = `${x},${y}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });

  return {
    centre,
    ex,
    ey,
    normal,
    width: u1 - u0,
    height: v1 - v0,
    flat: h1 - h0 <= size * 1e-6,
    depth: h1 - h0,
    points,
    triangles,
    uv,
    faceNormals,
    pointNormals,
    rims: loops.map((l) => l.map((i) => uv[i])).sort((a, b) => ringArea(b) - ringArea(a)),
    grid,
    cell,
  };
}

/** Where a triangle's corners are, for a point on the plane: its weights there, null if the triangle stands edge on. */
function weights(base: BaseSurface, t: readonly [number, number, number], u: number, v: number): [number, number, number] | null {
  const [a, b, c] = [base.uv[t[0]], base.uv[t[1]], base.uv[t[2]]];
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-9) return null;
  const w0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / det;
  const w1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / det;
  return [w0, w1, 1 - w0 - w1];
}

/** The surface over a point on its plane and which way it faces there. Past its edge, its nearest face carries on. */
export function surfaceAt(base: BaseSurface, u: number, v: number): { point: Point; normal: Point } {
  const { centre, ex, ey, normal, points, triangles, pointNormals, faceNormals } = base;
  if (base.flat) return { point: add(add(centre, scale(ex, u)), scale(ey, v)), normal };
  const here = (i: number, w: readonly number[], smooth: boolean): { point: Point; normal: Point } => {
    const t = triangles[i];
    const point = add(add(scale(points[t[0]], w[0]), scale(points[t[1]], w[1])), scale(points[t[2]], w[2]));
    const n = smooth ? unit(add(add(scale(pointNormals[t[0]], w[0]), scale(pointNormals[t[1]], w[1])), scale(pointNormals[t[2]], w[2]))) : faceNormals[i];
    return { point, normal: length(n) ? n : normal };
  };
  let found = -1;
  let foundW: readonly number[] = [];
  let top = -Infinity;
  const margin = 1e-9;
  for (const i of base.grid.get(`${Math.floor(u / base.cell)},${Math.floor(v / base.cell)}`) ?? []) {
    const w = weights(base, triangles[i], u, v);
    if (!w || w[0] < -margin || w[1] < -margin || w[2] < -margin) continue;
    const height = dot(add(add(scale(points[triangles[i][0]], w[0]), scale(points[triangles[i][1]], w[1])), scale(points[triangles[i][2]], w[2])), normal);
    if (height > top) [found, foundW, top] = [i, w, height];
  }
  if (found >= 0) return here(found, foundW, true);
  let nearest = -1;
  let bestD = Infinity;
  triangles.forEach((t, i) => {
    const m = [(base.uv[t[0]][0] + base.uv[t[1]][0] + base.uv[t[2]][0]) / 3, (base.uv[t[0]][1] + base.uv[t[1]][1] + base.uv[t[2]][1]) / 3];
    const d = Math.hypot(m[0] - u, m[1] - v);
    if (d < bestD && weights(base, t, u, v)) [nearest, bestD] = [i, d];
  });
  if (nearest < 0) return { point: add(add(centre, scale(ex, u)), scale(ey, v)), normal };
  return here(nearest, weights(base, triangles[nearest], u, v) ?? [1, 0, 0], false);
}

export interface ArrayCell {
  readonly at: Flat;
  readonly corners: readonly Flat[];
  /** cut by the base's edge */
  readonly onEdge: boolean;
}

export interface ArrayLayout {
  readonly cells: readonly ArrayCell[];
  readonly sizeX: number;
  readonly sizeY: number;
}

const insideRing = (p: Flat, ring: readonly Flat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

const segmentsCross = (a: Flat, b: Flat, c: Flat, d: Flat): boolean => {
  const side = (p: Flat, q: Flat, r: Flat): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
};

const insideBase = (p: Flat, rims: readonly (readonly Flat[])[]): boolean => {
  // the largest rim is the outside, others holes in it
  if (!rims.length || !insideRing(p, rims[0])) return false;
  return !rims.slice(1).some((r) => insideRing(p, r));
};

/** How a cell's rectangle sits on the base: quite inside it, cut by its edge, or off it. */
function relation(corners: readonly Flat[], rims: readonly (readonly Flat[])[]): "inside" | "edge" | "off" {
  const inCorners = corners.map((p) => insideBase(p, rims));
  const crossing = rims.some((r) => r.some((p, i) => corners.some((c, k) => segmentsCross(p, r[(i + 1) % r.length], c, corners[(k + 1) % corners.length]))));
  const ringIn = rims.some((r) => r.some((p) => insideRing(p, corners)));
  if (inCorners.every(Boolean) && !crossing && !ringIn) return "inside";
  return inCorners.some(Boolean) || crossing || ringIn ? "edge" : "off";
}

/** The rectangles of the array, or why there aren't any. `itemW` and `itemH` only matter when an item has no size that way. */
export function arrayLayout(base: BaseSurface, o: ArrayOptions): ArrayLayout | string {
  const fit = (mode: Repeat, extent: number, count: number, offset: number, distance: number): number => {
    if (mode === "distance") return distance;
    const span = (count - 1) * offset + 1;
    return extent / (span > 0.001 ? span : count);
  };
  const sizeX = fit(o.modeX, base.width, o.countX, o.offsetX, o.distanceX);
  const sizeY = fit(o.modeY, base.height, o.countY, o.offsetY, o.distanceY);
  if (!(sizeX > 0) || !(sizeY > 0)) return "The array items need a size more than 0.";
  const [c, s] = [Math.cos((o.rotation * Math.PI) / 180), Math.sin((o.rotation * Math.PI) / 180)];
  const turn = (x: number, y: number): Flat => [x * c - y * s, x * s + y * c];
  const a = turn(o.offsetX * sizeX, o.shiftY * sizeY);
  const b = turn(o.shiftX * sizeX, o.offsetY * sizeY);
  const det = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(det) < sizeX * sizeY * 1e-6) return "These offset and shift factors put every item in one line.";
  // an even number of repetitions has its middle between two
  const halfX = o.modeX === "count" && o.countX % 2 === 0 ? 0.5 : 0;
  const halfY = o.modeY === "count" && o.countY % 2 === 0 ? 0.5 : 0;
  const start = turn(o.originX * sizeX, o.originY * sizeY);
  const anchor: Flat = [start[0] + halfX * a[0] + halfY * b[0], start[1] + halfX * a[1] + halfY * b[1]];
  const reach = Math.hypot(sizeX, sizeY) / 2;
  const [w, h] = [base.width / 2 + reach, base.height / 2 + reach];
  let [i0, i1, j0, j1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of [[-w, -h], [w, -h], [w, h], [-w, h]]) {
    const [dx, dy] = [x - anchor[0], y - anchor[1]];
    const [i, j] = [(dx * b[1] - dy * b[0]) / det, (a[0] * dy - a[1] * dx) / det];
    [i0, i1, j0, j1] = [Math.min(i0, i), Math.max(i1, i), Math.min(j0, j), Math.max(j1, j)];
  }
  [i0, i1, j0, j1] = [Math.floor(i0), Math.ceil(i1), Math.floor(j0), Math.ceil(j1)];
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS * 16) return `That would be more than ${MAX_CELLS.toLocaleString("en")} items.`;
  // a hair small, so a rectangle that only touches the edge isn't taken for one that crosses it
  const shrink = 1 - 1e-4;
  const cells: ArrayCell[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const at: Flat = [anchor[0] + i * a[0] + j * b[0], anchor[1] + i * a[1] + j * b[1]];
      const corner = (x: number, y: number, k: number): Flat => {
        const t = turn((x * sizeX * k) / 2, (y * sizeY * k) / 2);
        return [at[0] + t[0], at[1] + t[1]];
      };
      const rel = relation([corner(-1, -1, shrink), corner(1, -1, shrink), corner(1, 1, shrink), corner(-1, 1, shrink)], base.rims);
      if (rel === "off" || (rel === "edge" && o.edge === "omit")) continue;
      cells.push({ at, corners: [corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)], onEdge: rel === "edge" });
      if (cells.length > MAX_CELLS) return `That would be more than ${MAX_CELLS.toLocaleString("en")} items.`;
    }
  }
  return cells.length ? { cells, sizeX, sizeY } : "No items would land on the base surface.";
}

/** The rectangles lying on the surface, as lines, for showing the array before it's made. */
export function cellLines(base: BaseSurface, layout: ArrayLayout): number[] {
  const out: number[] = [];
  const parts = base.flat ? 1 : 4;
  for (const cell of layout.cells) {
    const n = cell.corners.length;
    for (let k = 0; k < n; k++) {
      const [p, q] = [cell.corners[k], cell.corners[(k + 1) % n]];
      for (let m = 0; m < parts; m++) {
        const from = surfaceAt(base, p[0] + ((q[0] - p[0]) * m) / parts, p[1] + ((q[1] - p[1]) * m) / parts).point;
        const to = surfaceAt(base, p[0] + ((q[0] - p[0]) * (m + 1)) / parts, p[1] + ((q[1] - p[1]) * (m + 1)) / parts).point;
        out.push(...from, ...to);
      }
    }
  }
  return out;
}

/** The base's rims in the model, as lines. */
export function rimLines(base: BaseSurface): number[] {
  const out: number[] = [];
  for (const rim of base.rims) {
    for (let i = 0; i < rim.length; i++) {
      out.push(...surfaceAt(base, rim[i][0], rim[i][1]).point, ...surfaceAt(base, rim[(i + 1) % rim.length][0], rim[(i + 1) % rim.length][1]).point);
    }
  }
  return out;
}

export interface ItemBox {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
}

/** What's common to all the items: their box, by which they're fitted to the rectangles. */
export function itemBox(lists: readonly ArrayLike<number>[]): ItemBox | null {
  let [x0, y0, z0, x1, y1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity];
  for (const list of lists) {
    for (let i = 0; i + 2 < list.length; i += 3) {
      [x0, x1] = [Math.min(x0, list[i]), Math.max(x1, list[i])];
      [y0, y1] = [Math.min(y0, list[i + 1]), Math.max(y1, list[i + 1])];
      z0 = Math.min(z0, list[i + 2]);
    }
  }
  return x0 === Infinity ? null : { x0, y0, z0, x1, y1 };
}

export interface ItemMapper {
  /** the flat x y z list carried onto a cell */
  place(list: ArrayLike<number>, cell: ArrayCell): number[];
  /** a flat triangle list onto a cell, facing the way it did */
  placeFaces(tris: ArrayLike<number>, cell: ArrayCell): number[];
}

/** Carries items' points onto cells of the array. */
export function itemMapper(base: BaseSurface, layout: ArrayLayout, box: ItemBox, o: ArrayOptions): ItemMapper {
  const [w, h] = [box.x1 - box.x0, box.y1 - box.y0];
  const kx = w > 1e-9 ? layout.sizeX / w : h > 1e-9 ? layout.sizeY / h : 1;
  const ky = h > 1e-9 ? layout.sizeY / h : kx;
  const kz = o.scaleZ ? (kx + ky) / 2 : 1;
  const [mx, my] = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  const [c, s] = [Math.cos((o.rotation * Math.PI) / 180), Math.sin((o.rotation * Math.PI) / 180)];
  const side = o.flip ? -1 : 1;
  const place = (list: ArrayLike<number>, cell: ArrayCell): number[] => {
    const out: number[] = [];
    for (let i = 0; i + 2 < list.length; i += 3) {
      const [x, y] = [(list[i] - mx) * kx, (list[i + 1] - my) * ky];
      const at = surfaceAt(base, cell.at[0] + x * c - y * s, cell.at[1] + x * s + y * c);
      const p = add(at.point, scale(at.normal, (list[i + 2] - box.z0) * kz * side));
      out.push(p[0], p[1], p[2]);
    }
    return out;
  };
  return {
    place,
    placeFaces(tris, cell) {
      const out = place(tris, cell);
      if (o.flip) {
        // the other side of the surface is the mirror of this
        for (let i = 0; i + 8 < out.length; i += 9) {
          for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
        }
      }
      return out;
    },
  };
}

/** Whatever is outside the base's rims taken off faces. They stay as they were if it can't be worked out. */
export function trimmer(base: BaseSurface, reach: number): (tris: ArrayLike<number>) => number[] {
  const way = base.normal as unknown as Vec3;
  const far = base.depth + reach + 1;
  const low = add(base.centre, scale(base.normal, -far));
  const prisms = base.rims.map((rim) => {
    const ring = rim.map((p): Vec3 => add(add(low, scale(base.ex, p[0])), scale(base.ey, p[1])) as unknown as Vec3);
    return ringSlab(ring, way, 2 * far);
  });
  return (tris) => {
    const [outer, ...holes] = prisms;
    if (typeof outer === "string") return Array.from(tris);
    if (isClosedMesh(tris)) {
      let inner = intersectMeshes([tris, outer])?.triangles;
      if (!inner) return Array.from(tris);
      const cuts = holes.filter((h): h is number[] => typeof h !== "string");
      if (cuts.length && inner.length) inner = subtractMeshes(inner, cuts)?.triangles ?? inner;
      return Array.from(inner);
    }
    let kept = trimmedMesh(tris, outer, true)?.triangles;
    if (!kept) return Array.from(tris);
    for (const h of holes) if (typeof h !== "string" && kept.length) kept = trimmedMesh(kept, h, false)?.triangles ?? kept;
    return Array.from(kept);
  };
}
