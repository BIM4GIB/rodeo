// Model › Create Animation's camera paths as plain numbers (animationPathObject.ts is the object,
// playing it and its keyframes; movie.ts the commands and the movie): where the camera is and what it looks at a fraction of the way through an
// animation path. A path is a polyline of eye points, millimetres in the model, with keyframes on
// some of its vertices (always the first and the last). The camera moves along it at the pace the
// keyframes' speeds set and looks at their look-to points, or, when they have none (a walkthrough
// from a path object), a little way ahead along the path. Vectorworks doesn't publish how it eases
// between keyframes; these are Rodeo's readings of its help. Pure.

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Vectorworks' Path Types: Fly Freely, Walk, and Orthographic Orbit */
export type PathType = "fly" | "walk" | "orbit";

export interface Keyframe {
  /** the path vertex it sits on */
  readonly at: number;
  /** its look-to point; null looks ahead along the path */
  readonly target: V3 | null;
  /** View Angle, degrees */
  readonly angle: number;
  /** Speed, % (−99 to 100): how fast the camera moves near it against the others */
  readonly speed: number;
}

export interface CameraPath {
  readonly type: PathType;
  readonly points: readonly V3[];
  readonly keys: readonly Keyframe[];
}

export interface Camera {
  readonly eye: V3;
  readonly target: V3;
  /** view angle, degrees */
  readonly angle: number;
}

export const MIN_ANGLE = 12;
export const MAX_ANGLE = 130;
export const MIN_SPEED = -99;
export const MAX_SPEED = 100;
/** the camera's view angle when nothing else gives one: a 35 mm lens's, about */
export const DEFAULT_ANGLE = 55;
/** an orbit's or a spin's keyframes are this far apart round it, degrees */
const KEY_STEP_DEG = 45;
/** and the path between them is drawn in steps no longer than this */
const ARC_STEP_DEG = 5;
/** a walkthrough looks this far ahead along its path, mm, at most a third of the path */
const LOOK_AHEAD = 2000;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
const lerp = (a: V3, b: V3, t: number): V3 => add(a, scale(sub(b, a), t));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Distances along the path to each vertex. */
function along(points: readonly V3[]): number[] {
  const s = [0];
  for (let i = 1; i < points.length; i++) s.push(s[i - 1] + len(sub(points[i], points[i - 1])));
  return s;
}

/** Length: the path's length. */
export function pathLength(p: CameraPath): number {
  const s = along(p.points);
  return s[s.length - 1];
}

/** The point `d` along the polyline whose vertex distances are `s`, carried on past either end along it. */
function pointAt(points: readonly V3[], s: readonly number[], d: number): V3 {
  const n = points.length;
  if (n === 1) return points[0];
  let i = 0;
  while (i < n - 2 && s[i + 1] < d) i++;
  const seg = s[i + 1] - s[i];
  return lerp(points[i], points[i + 1], seg > 0 ? (d - s[i]) / seg : 0);
}

/** A keyframe's speed as a pace: 1 at 0%, 0.01 at −99%, 2 at 100%. */
const pace = (speed: number): number => 1 + clamp(speed, MIN_SPEED, MAX_SPEED) / 100;

/** Time to cover `l` with the pace going linearly from `a` to `b`. */
function spanTime(l: number, a: number, b: number): number {
  if (l <= 0) return 0;
  return Math.abs(b - a) < 1e-9 ? l / a : (l * Math.log(b / a)) / (b - a);
}

/** How far into a span of length `l` the camera is after time `t`, its pace going from `a` to `b`. */
function spanDistance(l: number, a: number, b: number, t: number): number {
  if (l <= 0) return 0;
  const k = (b - a) / l;
  return Math.abs(k) < 1e-12 ? a * t : (a * (Math.exp(k * t) - 1)) / k;
}

/** Where along the path, and between which keyframes, the camera is at `t` (0 to 1) of the way through in time. */
function locate(p: CameraPath, t: number): { d: number; k: number; w: number; s: number[] } {
  const s = along(p.points);
  const keys = p.keys;
  const spans = keys.slice(1).map((key, i) => {
    const l = s[key.at] - s[keys[i].at];
    return { l, a: pace(keys[i].speed), b: pace(key.speed) };
  });
  const times = spans.map((sp) => spanTime(sp.l, sp.a, sp.b));
  const total = times.reduce((a, b) => a + b, 0);
  let left = clamp(t, 0, 1) * total;
  for (let k = 0; k < spans.length; k++) {
    if (left <= times[k] || k === spans.length - 1) {
      const { l, a, b } = spans[k];
      const u = clamp(spanDistance(l, a, b, Math.min(left, times[k])), 0, l);
      return { d: s[keys[k].at] + u, k, w: l > 0 ? u / l : 0, s };
    }
    left -= times[k];
  }
  return { d: 0, k: 0, w: 0, s };
}

/** How far ahead a walkthrough's camera looks along its path. */
function lookAhead(total: number): number {
  return Math.min(LOOK_AHEAD, total / 3);
}

/** The camera `t` (0 to 1) of the way through the animation in time. */
export function cameraAt(p: CameraPath, t: number): Camera {
  const keys = p.keys;
  if (keys.length < 2) {
    const key = keys[0];
    const eye = p.points[key?.at ?? 0];
    return { eye, target: key?.target ?? add(eye, { x: 1, y: 0, z: 0 }), angle: key?.angle ?? DEFAULT_ANGLE };
  }
  const { d, k, w, s } = locate(p, t);
  const a = keys[k];
  const b = keys[k + 1];
  const eye = pointAt(p.points, s, d);
  const angle = a.angle + (b.angle - a.angle) * w;
  if (a.target && b.target) return { eye, target: lerp(a.target, b.target, w), angle };
  const total = s[s.length - 1];
  let ahead = pointAt(p.points, s, d + lookAhead(total));
  // at the very end, along the last stretch
  if (len(sub(ahead, eye)) < 1e-6) ahead = add(eye, sub(p.points[p.points.length - 1], p.points[Math.max(0, p.points.length - 2)]));
  // a walk looks level
  const target = p.type === "walk" ? { x: ahead.x, y: ahead.y, z: eye.z } : ahead;
  return { eye, target, angle };
}

/** The time (0 to 1) at which the camera reaches keyframe `k`. */
export function keyTime(p: CameraPath, k: number): number {
  const s = along(p.points);
  const keys = p.keys;
  let before = 0;
  let total = 0;
  for (let i = 1; i < keys.length; i++) {
    const tm = spanTime(s[keys[i].at] - s[keys[i - 1].at], pace(keys[i - 1].speed), pace(keys[i].speed));
    if (i <= k) before += tm;
    total += tm;
  }
  return total > 0 ? before / total : 0;
}

/** The keyframe the camera is on at `t`, if it is on one. */
export function keyAt(p: CameraPath, t: number): number | null {
  for (let k = 0; k < p.keys.length; k++) if (Math.abs(keyTime(p, k) - t) < 1e-6) return k;
  return null;
}

/** Add Keyframe: a keyframe where the camera is at `t`, the path getting a vertex there; null when it's on one. */
export function addKeyframe(p: CameraPath, t: number): CameraPath | null {
  if (keyAt(p, t) !== null || p.keys.length < 2) return null;
  const cam = cameraAt(p, t);
  const { d, k, w, s } = locate(p, t);
  let i = 0;
  while (i < p.points.length - 2 && s[i + 1] < d) i++;
  const onVertex = Math.abs(s[i + 1] - d) < 1e-6 ? i + 1 : Math.abs(s[i] - d) < 1e-6 ? i : -1;
  const points = onVertex >= 0 ? p.points : [...p.points.slice(0, i + 1), cam.eye, ...p.points.slice(i + 1)];
  const at = onVertex >= 0 ? onVertex : i + 1;
  const shift = (key: Keyframe): Keyframe => (onVertex < 0 && key.at > i ? { ...key, at: key.at + 1 } : key);
  const a = p.keys[k];
  const b = p.keys[k + 1];
  const target = a.target && b.target ? cam.target : null;
  const speed = Math.round(a.speed + (b.speed - a.speed) * w);
  const key: Keyframe = { at, target, angle: cam.angle, speed };
  const keys = [...p.keys.slice(0, k + 1).map(shift), key, ...p.keys.slice(k + 1).map(shift)];
  return { ...p, points, keys };
}

/** Delete Keyframe: keyframe `k` gone (the path keeps its shape); null for the first or last. */
export function deleteKeyframe(p: CameraPath, k: number): CameraPath | null {
  if (k <= 0 || k >= p.keys.length - 1) return null;
  return { ...p, keys: p.keys.filter((_, i) => i !== k) };
}

/** Keyframe `k` with its view angle or speed changed, each kept in its range. */
export function setKeyframe(p: CameraPath, k: number, change: { angle?: number; speed?: number }): CameraPath {
  const keys = p.keys.map((key, i) =>
    i !== k
      ? key
      : {
          ...key,
          angle: change.angle === undefined ? key.angle : clamp(change.angle, MIN_ANGLE, MAX_ANGLE),
          speed: change.speed === undefined ? key.speed : clamp(Math.round(change.speed), MIN_SPEED, MAX_SPEED),
        },
  );
  return { ...p, keys };
}

/** Points `at` 0 to `sweep` degrees, in steps that land on every `keyStep`; with the indices of
 *  those that are keyframes. */
function arc(sweep: number, keyStep: number, at: (deg: number) => V3): { points: V3[]; keyIdx: number[] } {
  const spans = Math.max(1, Math.round(Math.abs(sweep) / keyStep));
  const per = Math.max(1, Math.ceil(Math.abs(sweep) / spans / ARC_STEP_DEG));
  const points: V3[] = [];
  const keyIdx: number[] = [];
  for (let i = 0; i <= spans * per; i++) {
    if (i % per === 0) keyIdx.push(points.length);
    points.push(at((sweep * i) / (spans * per)));
  }
  return { points, keyIdx };
}

/** Create Orbit Path: the camera going `degrees` round `centre` from `start`, at `start`'s height and
 *  distance, looking at the centre, keyframes evenly round it. */
export function orbitPath(centre: V3, start: V3, degrees: number, angle: number, type: PathType): CameraPath {
  const r = Math.hypot(start.x - centre.x, start.y - centre.y);
  const from = Math.atan2(start.y - centre.y, start.x - centre.x);
  const { points, keyIdx } = arc(degrees, KEY_STEP_DEG, (deg) => ({
    x: centre.x + r * Math.cos(from + rad(deg)),
    y: centre.y + r * Math.sin(from + rad(deg)),
    z: start.z,
  }));
  return { type, points, keys: keyIdx.map((at) => ({ at, target: centre, angle, speed: 0 })) };
}

/** Create Spin Path: the camera once round `centre` at `distance`, from `from`° round and `rise`°
 *  above it down to as far below and back, so each side shows, looking at the centre. */
export function spinPath(centre: V3, distance: number, from: number, rise: number, angle: number): CameraPath {
  const { points, keyIdx } = arc(360, KEY_STEP_DEG, (deg) => {
    const up = rad(rise * Math.cos(rad(deg)));
    return {
      x: centre.x + distance * Math.cos(up) * Math.cos(rad(from + deg)),
      y: centre.y + distance * Math.cos(up) * Math.sin(rad(from + deg)),
      z: centre.z + distance * Math.sin(up),
    };
  });
  return { type: "fly", points, keys: keyIdx.map((at) => ({ at, target: centre, angle, speed: 0 })) };
}

/** How far a camera with view angle `angle` stands from a ball of `radius` to have it fill the view. */
export function fitDistance(radius: number, angle: number): number {
  return (radius / Math.sin(rad(clamp(angle, MIN_ANGLE, MAX_ANGLE)) / 2)) * 1.1;
}

/** Create Walkthrough Path from Selection: the camera along `points`, keyframes on the vertices
 *  `corners` (the corners, and each curve's apex), looking ahead. */
export function walkPath(points: readonly V3[], corners: readonly number[], type: "walk" | "fly", angle: number): CameraPath {
  const at = [...new Set([0, ...corners, points.length - 1])].filter((i) => i >= 0 && i < points.length).sort((a, b) => a - b);
  return { type, points: [...points], keys: at.map((i) => ({ at: i, target: null, angle, speed: 0 })) };
}

/** Create Walkthrough Path from Saved Views: the camera going straight from each view's eye to the next. */
export function viewsPath(cameras: readonly Camera[]): CameraPath {
  return {
    type: "fly",
    points: cameras.map((c) => c.eye),
    keys: cameras.map((c, at) => ({ at, target: c.target, angle: clamp(c.angle, MIN_ANGLE, MAX_ANGLE), speed: 0 })),
  };
}

/** A path written as text for its record, millimetres to a tenth. */
export function writePath(p: CameraPath): string {
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  const pt = (q: V3): string => `${n(q.x)} ${n(q.y)} ${n(q.z)}`;
  const keys = p.keys.map((k) => `${k.at} ${k.target ? pt(k.target) : "- - -"} ${n(k.angle)} ${k.speed}`);
  return [p.type, p.points.map(pt).join(","), keys.join(",")].join(";");
}

/** A path read back from `writePath`'s text; null when it doesn't read as one. */
export function readPath(text: string): CameraPath | null {
  const [type, pts, ks] = text.split(";");
  if (type !== "fly" && type !== "walk" && type !== "orbit") return null;
  const nums = (s: string): number[] => s.trim().split(/\s+/).map(Number);
  const points = (pts ?? "").split(",").filter(Boolean).map((s): V3 => {
    const [x, y, z] = nums(s);
    return { x, y, z };
  });
  const keys = (ks ?? "").split(",").filter(Boolean).map((s): Keyframe => {
    const f = s.trim().split(/\s+/);
    const target = f[1] === "-" ? null : { x: Number(f[1]), y: Number(f[2]), z: Number(f[3]) };
    return { at: Number(f[0]), target, angle: Number(f[4]), speed: Number(f[5]) };
  });
  const ok =
    points.length >= 1 &&
    points.every((q) => [q.x, q.y, q.z].every(Number.isFinite)) &&
    keys.length >= 1 &&
    keys.every((k, i) => Number.isInteger(k.at) && k.at >= 0 && k.at < points.length && (i === 0 || k.at > keys[i - 1].at) && Number.isFinite(k.angle) && Number.isFinite(k.speed));
  return ok ? { type, points, keys } : null;
}
