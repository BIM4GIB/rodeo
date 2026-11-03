// The sums behind the 3D Modeling set's Align Plane: the turn and move that take a face, or a frame
// set by three points, onto a plane. A turn is an axis and an angle about a centre, as
// rotateObjects3D takes it (counter-clockwise seen from the axis's positive end), and the move
// follows it.

import type { Vec3 } from "../core/index.ts";

/** A plane with axes on it: x and y unit and square, x × y up from it. */
export interface Frame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
}

/** A turn about `centre` (none when `axis` is null), then a move. */
export interface Alignment {
  readonly axis: Vec3 | null;
  readonly deg: number;
  readonly centre: Vec3;
  readonly move: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));
const each = (f: (i: number) => number): Vec3 => [f(0), f(1), f(2)];

/** an angle this small (radians) is no turn */
const NO_TURN = 1e-9;

/** z of a frame: up from its plane */
export const upOf = (f: Frame): Vec3 => cross(f.x, f.y);

/**
 * The frame three points set: the first its origin, its x axis toward the second, its y axis
 * square to that toward the third. Null when they lie in a line or two meet.
 */
export function frameOfPoints(a: Vec3, b: Vec3, c: Vec3): Frame | null {
  const ab = sub(b, a);
  const span = Math.max(Math.hypot(...ab), Math.hypot(...sub(c, a)));
  if (!(span > 0)) return null;
  const x = unit(ab);
  const ac = sub(c, a);
  const off = sub(ac, scale(x, dot(ac, x)));
  // the third point off the line by a ten-thousandth of the span at least
  if (Math.hypot(...ab) < span * 1e-4 || Math.hypot(...off) < span * 1e-4) return null;
  return { origin: a, x, y: unit(off) };
}

/** The axis and angle of turn `r` (rows of a rotation matrix); null when it doesn't turn. */
export function axisAngle(r: readonly (readonly number[])[]): { axis: Vec3; deg: number } | null {
  const c = Math.min(1, Math.max(-1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2));
  const angle = Math.acos(c);
  if (angle < NO_TURN) return null;
  const skew: Vec3 = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
  // near a half turn the skew part fades: the axis is read from the diagonal instead
  if (Math.hypot(...skew) < 1e-6) {
    const k = [0, 1, 2].map((i) => Math.sqrt(Math.max(0, (r[i][i] + 1) / 2)));
    const i = k.indexOf(Math.max(...k));
    const axis = each((j) => (j === i ? k[i] : (r[i][j] + r[j][i]) / (4 * k[i])));
    return { axis: unit(axis), deg: (angle * 180) / Math.PI };
  }
  return { axis: unit(skew), deg: (angle * 180) / Math.PI };
}

/** an axis within a whisker of z is z, so that the turn is one in plan, which every object takes */
function cleaned(axis: Vec3): Vec3 {
  return Math.hypot(axis[0], axis[1]) < 1e-9 ? [0, 0, Math.sign(axis[2]) || 1] : axis;
}

/** The turn about `from`'s origin and the move that put frame `from` on frame `to`, axis for axis. */
export function alignFrames(from: Frame, to: Frame): Alignment {
  const [fz, tz] = [upOf(from), upOf(to)];
  // to's axes as columns times from's as rows
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => to.x[i] * from.x[j] + to.y[i] * from.y[j] + tz[i] * fz[j]));
  const turn = axisAngle(r);
  return { axis: turn ? cleaned(turn.axis) : null, deg: turn?.deg ?? 0, centre: from.origin, move: sub(to.origin, from.origin) };
}

/**
 * The least turn, about `point`, that lays a face (through `point`, its outside along `normal`) on
 * plane `to` facing down into it, so that the object stands on the plane; and the move square to
 * the plane that brings it there, `point` keeping its place along the plane.
 */
export function faceOnPlane(point: Vec3, normal: Vec3, to: Frame): Alignment {
  const n = unit(normal);
  const up = upOf(to);
  const down = scale(up, -1);
  const axis = cross(n, down);
  const [s, c] = [Math.hypot(...axis), dot(n, down)];
  let turn: { axis: Vec3; deg: number } | null = null;
  if (s > NO_TURN) turn = { axis: unit(axis), deg: (Math.atan2(s, c) * 180) / Math.PI };
  // facing up: a half turn about the plane's x axis, which lies along the face then
  else if (c < 0) turn = { axis: unit(sub(to.x, scale(n, dot(to.x, n)))), deg: 180 };
  return { axis: turn ? cleaned(turn.axis) : null, deg: turn?.deg ?? 0, centre: point, move: scale(up, -dot(sub(point, to.origin), up)) };
}

/** Where `p` goes under alignment `a`. */
export function aligned(a: Alignment, p: Vec3): Vec3 {
  let q = p;
  if (a.axis) {
    const k = a.axis;
    const t = (a.deg * Math.PI) / 180;
    const [s, c] = [Math.sin(t), Math.cos(t)];
    const v = sub(p, a.centre);
    // Rodrigues: v cos t + (k × v) sin t + k (k · v)(1 − cos t)
    const kv = cross(k, v);
    const along = dot(k, v) * (1 - c);
    q = each((i) => a.centre[i] + v[i] * c + kv[i] * s + k[i] * along);
  }
  return [q[0] + a.move[0], q[1] + a.move[1], q[2] + a.move[2]];
}
