// The sums behind the 3D Modeling set's Deform tool. Rodeo has no solid-modeling kernel, so a solid is
// its triangles: each is cut small enough to take the curve, with its neighbours cut to match so no crack opens,
// and then every point is moved. World mm, z up; triangles are 9 numbers each. Kept apart from the page
// so a check can run it.

import { stitched, type SolidFace, type Vec3 } from "./solidOps.ts";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = length(a);
  return l ? scale(a, 1 / l) : [0, 0, 0];
};

/** Where a point goes. */
export type PointMap = (p: Vec3) => Vec3;

/** A point and the plane through it that a deformation is set out on. */
export interface Frame {
  readonly center: Vec3;
  /** square to the plane, length 1 */
  readonly axis: Vec3;
  /** in the plane, the way the reference line runs, length 1 */
  readonly across: Vec3;
}

/** A direction in the plane square to `axis`, when none has been chosen. */
export function anyAcross(axis: Vec3): Vec3 {
  return unit(cross(Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], axis));
}

/** The height off the plane of whatever's farthest from it, with its sign; 1 when everything is on the plane. */
export function farHeight(points: readonly Vec3[], frame: Frame): number {
  let far = 0;
  for (const p of points) {
    const h = dot(sub(p, frame.center), frame.axis);
    // with the plane halfway, the positive end counts as the far one
    if (Math.abs(h) > Math.abs(far) + 1e-9 || (h > 0 && far < 0 && Math.abs(h + far) <= 1e-9)) far = h;
  }
  return far || 1;
}

const turned = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
};

/** Twist Solid: turned about the axis through the centre, in step with the height, `degrees` at the far end. */
export function twistMap(frame: Frame, far: number, degrees: number): PointMap {
  const whole = (degrees * Math.PI) / 180;
  return (p) => {
    const q = sub(p, frame.center);
    return add(frame.center, turned(q, frame.axis, (whole * dot(q, frame.axis)) / far));
  };
}

/**
 * Twist Face: the face (at height 0 and above) turns the whole of `degrees`, and what runs down to it from
 * `far` (below 0) follows less and less, down to not at all.
 */
export function twistFaceMap(frame: Frame, far: number, degrees: number): PointMap {
  const whole = (degrees * Math.PI) / 180;
  return (p) => {
    const q = sub(p, frame.center);
    const share = 1 - Math.min(1, Math.max(0, dot(q, frame.axis) / far));
    return add(frame.center, turned(q, frame.axis, whole * share));
  };
}

/** A point scaled out from the axis through the centre by `k`, both ways across or (not symmetric) only along the reference line. */
function scaledAcross(frame: Frame, q: Vec3, k: number, symmetric: boolean): Vec3 {
  const up = scale(frame.axis, dot(q, frame.axis));
  const flat = sub(q, up);
  if (symmetric) return add(frame.center, add(up, scale(flat, k)));
  const way = scale(frame.across, dot(flat, frame.across));
  return add(frame.center, add(up, add(sub(flat, way), scale(way, k))));
}

/** Taper Solid: scaled in step with the height, `ratio` at the far end and 1 at the plane. */
export function taperMap(frame: Frame, far: number, ratio: number, symmetric: boolean): PointMap {
  return (p) => {
    const q = sub(p, frame.center);
    const share = dot(q, frame.axis) / far;
    return scaledAcross(frame, q, Math.max(0.01, 1 + (ratio - 1) * share), symmetric);
  };
}

/** Bulge Solid: scaled most at the plane, `ratio` there, and by nothing at the far end. */
export function bulgeMap(frame: Frame, far: number, ratio: number, symmetric: boolean): PointMap {
  return (p) => {
    const q = sub(p, frame.center);
    const share = dot(q, frame.axis) / far;
    return scaledAcross(frame, q, Math.max(0.01, 1 + (ratio - 1) * (1 - share * share)), symmetric);
  };
}

/** A spine to bend along, and the settings of the bend. */
export interface Bend {
  readonly start: Vec3;
  /** along the spine, length 1 */
  readonly along: Vec3;
  /** in the plane, square to the spine, length 1: above 0 the bend turns this way */
  readonly toward: Vec3;
  readonly length: number;
  readonly degrees: number;
  /** both ways from the start, or only along the spine */
  readonly symmetric: boolean;
  /** only for the spine's length, what's past it running straight on */
  readonly finite: boolean;
}

/** Bend Solid: laid round an arc, turning by `degrees` over the spine's length. */
export function bendMap(b: Bend): PointMap {
  const whole = (b.degrees * Math.PI) / 180;
  if (Math.abs(whole) < 1e-9) return (p) => p;
  const radius = b.length / whole;
  return (p) => {
    const q = sub(p, b.start);
    const s = dot(q, b.along);
    if (s <= 0 && !b.symmetric) return p;
    const way = s < 0 ? scale(b.along, -1) : b.along;
    const run = Math.abs(s);
    const w = dot(q, b.toward);
    const rest = sub(sub(q, scale(b.along, s)), scale(b.toward, w));
    const angle = (b.finite ? Math.min(run, b.length) : run) / radius;
    const beyond = b.finite ? Math.max(0, run - b.length) : 0;
    const out = sub(scale(way, Math.sin(angle)), scale(b.toward, Math.cos(angle)));
    const ahead = add(scale(way, Math.cos(angle)), scale(b.toward, Math.sin(angle)));
    const at = add(scale(b.toward, radius), scale(out, radius - w));
    return add(b.start, add(add(at, scale(ahead, beyond)), rest));
  };
}

/** Whether a bend is so tight that part of the object would pass through the arc's centre. */
export function bendTooTight(points: readonly Vec3[], b: Bend): boolean {
  const whole = (b.degrees * Math.PI) / 180;
  if (Math.abs(whole) < 1e-9) return false;
  const radius = b.length / whole;
  return points.some((p) => {
    const q = sub(p, b.start);
    if (dot(q, b.along) <= 0 && !b.symmetric) return false;
    const w = dot(q, b.toward);
    return radius > 0 ? w >= radius : w <= radius;
  });
}

/** A mesh by its points, its triangles and which of them are being changed. */
interface Pieces {
  readonly points: Vec3[];
  readonly triangles: (readonly [number, number, number])[];
  /** which triangles are changed; all when there's no such list */
  readonly changing: boolean[];
}

/** The mesh with its long sides cut, each triangle's neighbours cut to match. Stops growing at about `most` triangles. */
function cutSmall(mesh: Pieces, longest: number, most: number): Pieces {
  const points = [...mesh.points];
  let triangles = mesh.triangles;
  let changing = mesh.changing;
  for (let pass = 0; pass < 12; pass++) {
    const cuts = new Map<string, number>();
    const keyOf = (p: number, q: number): string => (p < q ? `${p},${q}` : `${q},${p}`);
    triangles.forEach((t, i) => {
      if (!changing[i]) return;
      for (let k = 0; k < 3; k++) {
        const [p, q] = [t[k], t[(k + 1) % 3]];
        if (length(sub(points[p], points[q])) <= longest) continue;
        const key = keyOf(p, q);
        if (!cuts.has(key)) {
          cuts.set(key, points.length);
          points.push(scale(add(points[p], points[q]), 0.5));
        }
      }
    });
    if (!cuts.size || triangles.length > most) break;
    const next: (readonly [number, number, number])[] = [];
    const flags: boolean[] = [];
    const push = (flag: boolean, ...list: (readonly [number, number, number])[]): void => {
      for (const t of list) {
        next.push(t);
        flags.push(flag);
      }
    };
    triangles.forEach((t, i) => {
      const mids = [0, 1, 2].map((k) => cuts.get(keyOf(t[k], t[(k + 1) % 3])));
      const count = mids.filter((m) => m !== undefined).length;
      const flag = changing[i];
      if (count === 0) push(flag, t);
      else if (count === 3) {
        const [ab, bc, ca] = mids as number[];
        push(flag, [t[0], ab, ca], [ab, t[1], bc], [ca, bc, t[2]], [ab, bc, ca]);
      } else if (count === 1) {
        const k = mids.findIndex((m) => m !== undefined);
        const [a, b, c] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
        const m = mids[k]!;
        push(flag, [a, m, c], [m, b, c]);
      } else {
        // the side not cut comes last
        const free = mids.findIndex((m) => m === undefined);
        const k = (free + 1) % 3;
        const [a, b, c] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]];
        const [m, n] = [mids[k]!, mids[(k + 1) % 3]!];
        push(flag, [m, b, n], [a, m, n], [a, n, c]);
      }
    });
    triangles = next;
    changing = flags;
  }
  return { points, triangles, changing };
}

function flatOf(points: readonly Vec3[], triangles: readonly (readonly [number, number, number])[]): number[] {
  const out: number[] = [];
  for (const [a, b, c] of triangles) out.push(...points[a], ...points[b], ...points[c]);
  return out;
}

/** Most triangles a deformed solid is cut into. */
const MOST_TRIANGLES = 16000;

/** Every point of the mesh mapped, its triangles first cut to no longer than `longest`. */
export function deformed(triangles: ArrayLike<number>, map: PointMap, longest: number): number[] {
  const { points, triangles: list } = stitched(triangles);
  const cut = cutSmall({ points: points as Vec3[], triangles: list, changing: list.map(() => true) }, longest, MOST_TRIANGLES);
  return flatOf(cut.points.map(map), cut.triangles);
}

/** A face and those next to it (with what runs smoothly on from them) mapped; what's beyond them stays. */
export function deformedAround(face: SolidFace, around: ReadonlySet<number>, map: PointMap, longest: number): number[] {
  const { mesh } = face;
  const cut = cutSmall({ points: mesh.points, triangles: mesh.triangles, changing: mesh.triangles.map((_, i) => around.has(i)) }, longest, MOST_TRIANGLES);
  const moving = new Set<number>();
  cut.triangles.forEach((t, i) => {
    if (cut.changing[i]) for (const v of t) moving.add(v);
  });
  return flatOf(cut.points.map((p, v) => (moving.has(v) ? map(p) : p)), cut.triangles);
}

/** The size of what's being deformed, the corner to corner of its box. */
export function sizeOfPoints(points: readonly Vec3[]): number {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      low[k] = Math.min(low[k], p[k]);
      high[k] = Math.max(high[k], p[k]);
    }
  }
  return Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) || 1;
}

/** Line segments cut into short pieces and mapped, 6 numbers each: a preview of the deformation. */
export function mappedLines(lines: readonly (readonly [Vec3, Vec3])[], map: PointMap, longest: number): number[] {
  const out: number[] = [];
  for (const [a, b] of lines) {
    const pieces = Math.min(32, Math.max(1, Math.ceil(length(sub(b, a)) / longest)));
    let was = map(a);
    for (let i = 1; i <= pieces; i++) {
      const now = map(add(a, scale(sub(b, a), i / pieces)));
      out.push(...was, ...now);
      was = now;
    }
  }
  return out;
}

/** The points of flat triangles. */
export function pointsOf(triangles: ArrayLike<number>): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < triangles.length; i += 3) out.push([triangles[i], triangles[i + 1], triangles[i + 2]]);
  return out;
}
