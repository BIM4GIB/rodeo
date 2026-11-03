// The sums behind Spotlight's Video Camera (videoCamera.ts): its picture from the lens's focal length,
// the camera body's sensor and the format, which way it looks from its pan and tilt, and what it draws:
// in plan its stand, its body and lens turned by the pan and foreshortened by the tilt, and its field
// of view; in 3D the same as solids. Everything is in the object's own frame, its pivot (the head on
// the stand) over its origin, x the way it faces before it pans. Kept apart so it runs without the page.

import type { Pt } from "../core/index.ts";
import { circleOutline, mapSolid, prism, tube, type Point3, type Solid } from "./solids3d.ts";

/** A camera body: its sensor, in mm. */
export interface CameraBody {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/** A lens: the focal lengths it zooms between (equal for a prime), in mm. */
export interface Lens {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

/** Rodeo's generic bodies, by their sensor's usual size. */
export const BODIES: readonly CameraBody[] = [
  { name: "2/3-inch broadcast", width: 9.59, height: 5.39 },
  { name: "1-inch", width: 13.2, height: 8.8 },
  { name: "Super 35", width: 24.89, height: 14 },
  { name: "Full frame", width: 36, height: 24 },
];

/** Rodeo's generic lenses. */
export const LENSES: readonly Lens[] = [
  { name: "Wide zoom 4.5–60 mm", min: 4.5, max: 60 },
  { name: "Studio zoom 8.5–170 mm", min: 8.5, max: 170 },
  { name: "Long zoom 9–900 mm", min: 9, max: 900 },
  { name: "Cinema zoom 24–70 mm", min: 24, max: 70 },
  { name: "Prime 35 mm", min: 35, max: 35 },
  { name: "Prime 50 mm", min: 50, max: 50 },
  { name: "Prime 85 mm", min: 85, max: 85 },
];

/** The formats the picture can take, width over height; Camera Default is the sensor's own. */
export const FORMATS: readonly { readonly name: string; readonly aspect: number | null }[] = [
  { name: "Camera Default", aspect: null },
  { name: "16:9", aspect: 16 / 9 },
  { name: "4:3", aspect: 4 / 3 },
  { name: "1.85:1", aspect: 1.85 },
  { name: "2.39:1", aspect: 2.39 },
  { name: "1:1", aspect: 1 },
  { name: "9:16", aspect: 9 / 16 },
  { name: "Custom Aspect", aspect: null },
];

export const STANDS = ["Tripod", "Pedestal", "None"] as const;
export type Stand = (typeof STANDS)[number];

/** Pan, tilt and roll limits, ±°, as Vectorworks sets them */
export const PAN_LIMIT = 90;
export const TILT_LIMIT = 90;
export const ROLL_LIMIT = 20;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const bodyNamed = (name: string): CameraBody => BODIES.find((b) => b.name === name) ?? BODIES[0];
export const lensNamed = (name: string): Lens => LENSES.find((l) => l.name === name) ?? LENSES[0];

/** The focal length a lens can be set to nearest `f`. */
export const focalOn = (lens: Lens, f: number): number => clamp(Number.isFinite(f) ? f : lens.min, lens.min, lens.max);

/** The diagonal angle of view (°) of focal length `f` on `body`. */
export function diagonalAngle(body: CameraBody, f: number): number {
  return (2 * Math.atan(Math.hypot(body.width, body.height) / (2 * f))) / DEG;
}

/** The focal length that gives diagonal angle `deg` on `body`. */
export function focalForDiagonal(body: CameraBody, deg: number): number {
  return Math.hypot(body.width, body.height) / (2 * Math.tan((clamp(deg, 0.1, 179) * DEG) / 2));
}

/** The width over height of format `name` on `body` (`custom` for Custom Aspect). */
export function aspectOf(name: string, body: CameraBody, custom: number): number {
  if (name === "Custom Aspect") return custom > 0 ? custom : body.width / body.height;
  return FORMATS.find((f) => f.name === name)?.aspect ?? body.width / body.height;
}

/**
 * The picture: the part of the sensor the format uses, the widest of that aspect, and the angles it
 * sees across and up (°) at focal length `f`.
 */
export function picture(body: CameraBody, f: number, aspect: number): { width: number; height: number; across: number; up: number } {
  const wide = aspect >= body.width / body.height;
  const width = wide ? body.width : body.height * aspect;
  const height = wide ? body.width / aspect : body.height;
  return { width, height, across: (2 * Math.atan(width / (2 * f))) / DEG, up: (2 * Math.atan(height / (2 * f))) / DEG };
}

/** How the camera is set on its object: pan, tilt and roll (°) and the lens's height over the object. */
export interface Aim {
  readonly pan: number;
  readonly tilt: number;
  readonly roll: number;
  readonly height: number;
}

/** The way it looks, in its own frame: panned about z from x, tilted up from level. */
export function lookOf(a: Aim): Point3 {
  const p = clamp(a.pan, -PAN_LIMIT, PAN_LIMIT) * DEG;
  const t = clamp(a.tilt, -TILT_LIMIT, TILT_LIMIT) * DEG;
  return [Math.cos(t) * Math.cos(p), Math.cos(t) * Math.sin(p), Math.sin(t)];
}

/** body: how far behind and ahead of the pivot, its width and height; lens: its length and radius (mm) */
const BODY_BACK = 260;
const BODY_FRONT = 90;
const BODY_WIDTH = 160;
const BODY_HEIGHT = 220;
const LENS_LENGTH = 220;
const LENS_RADIUS = 55;
/** the head sits this far under the lens's axis */
const HEAD_DROP = 150;
const TRIPOD_REACH = 650;
const PEDESTAL_RADIUS = 420;

/** Where the front of the lens is, in the object's frame: the eye of the camera view. */
export function lensFront(a: Aim): Point3 {
  const d = lookOf(a);
  const k = BODY_FRONT + LENS_LENGTH;
  return [d[0] * k, d[1] * k, a.height + d[2] * k];
}

/** A point of the camera head (x along the lens, y to its left, z up) turned by roll, tilt and pan and set on the pivot. */
function headPoint(a: Aim, [x, y, z]: Point3): Point3 {
  const r = clamp(a.roll, -ROLL_LIMIT, ROLL_LIMIT) * DEG;
  const t = clamp(a.tilt, -TILT_LIMIT, TILT_LIMIT) * DEG;
  const p = clamp(a.pan, -PAN_LIMIT, PAN_LIMIT) * DEG;
  // roll about x, then tilt (x toward z), then pan about z
  const y1 = y * Math.cos(r) - z * Math.sin(r);
  const z1 = y * Math.sin(r) + z * Math.cos(r);
  const x2 = x * Math.cos(t) - z1 * Math.sin(t);
  const z2 = x * Math.sin(t) + z1 * Math.cos(t);
  return [x2 * Math.cos(p) - y1 * Math.sin(p), x2 * Math.sin(p) + y1 * Math.cos(p), a.height + z2];
}

const box = (x0: number, x1: number, w: number, h: number): Solid =>
  prism(
    [
      [
        { x: x0, y: -w / 2 },
        { x: x1, y: -w / 2 },
        { x: x1, y: w / 2 },
        { x: x0, y: w / 2 },
      ],
    ],
    -h / 2,
    h / 2,
  );

/** The parts of the camera's plan, each a closed outline or a line, in its own frame. */
export interface CameraPlan {
  readonly stand: readonly Pt[][];
  readonly standLines: readonly (readonly [Pt, Pt])[];
  readonly body: readonly Pt[];
  readonly lens: readonly Pt[];
  /** the field of view: the lens's front and the two far corners, reaching `reach` along the plan */
  readonly field: readonly Pt[] | null;
}

/** The plan: the stand, the body and lens as the head turns them seen from above, and the field of view `across`° wide. */
export function cameraPlan(a: Aim, stand: Stand, across: number, reach: number): CameraPlan {
  const flat = (pts: readonly Point3[]): Pt[] => pts.map(([x, y]) => ({ x, y }));
  const outline = (x0: number, x1: number, w: number, h: number): Pt[] => {
    // the box's corners from above: its top or bottom face, whichever shows more, is near enough for a tilted head
    const corners: Point3[] = [
      [x0, -w / 2, h / 2],
      [x1, -w / 2, h / 2],
      [x1, w / 2, h / 2],
      [x0, w / 2, h / 2],
    ];
    return flat(corners.map((c) => headPoint({ ...a, roll: 0 }, c)));
  };
  const standOutlines: Pt[][] = [];
  const standLines: [Pt, Pt][] = [];
  if (stand === "Tripod") {
    for (const deg of [60, 180, 300]) standLines.push([{ x: 0, y: 0 }, { x: TRIPOD_REACH * Math.cos(deg * DEG), y: TRIPOD_REACH * Math.sin(deg * DEG) }]);
  } else if (stand === "Pedestal") {
    standOutlines.push(circleOutline({ x: 0, y: 0 }, PEDESTAL_RADIUS, 36));
  }
  const front = lensFront(a);
  const look = lookOf(a);
  const along = Math.atan2(look[1], look[0]);
  const half = (clamp(across, 0.1, 179) * DEG) / 2;
  const tip = { x: front[0], y: front[1] };
  const ray = (turn: number): Pt => ({ x: tip.x + (reach / Math.cos(half)) * Math.cos(along + turn), y: tip.y + (reach / Math.cos(half)) * Math.sin(along + turn) });
  return {
    stand: standOutlines,
    standLines,
    body: outline(-BODY_BACK, BODY_FRONT, BODY_WIDTH, BODY_HEIGHT),
    lens: outline(BODY_FRONT, BODY_FRONT + LENS_LENGTH, 2 * LENS_RADIUS, 2 * LENS_RADIUS),
    field: reach > 0 ? [tip, ray(-half), ray(half)] : null,
  };
}

/** The camera as solids, in its own frame on its layer (z from the layer): body, lens and stand. */
export function cameraSolids(a: Aim, stand: Stand): { head: Solid; lens: Solid; stand: Solid } {
  const head = mapSolid(box(-BODY_BACK, BODY_FRONT, BODY_WIDTH, BODY_HEIGHT), (p) => headPoint(a, p));
  const lens = mapSolid(tube([[BODY_FRONT, 0, 0], [BODY_FRONT + LENS_LENGTH, 0, 0]], LENS_RADIUS, false, 16), (p) => headPoint(a, p));
  const top = Math.max(0, a.height - HEAD_DROP);
  const legs: Solid = [];
  if (stand === "Tripod" && top > 0) {
    for (const deg of [60, 180, 300]) legs.push(...tube([[0, 0, top], [TRIPOD_REACH * Math.cos(deg * DEG), TRIPOD_REACH * Math.sin(deg * DEG), 0]], 15, false, 8));
  } else if (stand === "Pedestal" && top > 0) {
    legs.push(...prism([circleOutline({ x: 0, y: 0 }, PEDESTAL_RADIUS, 36)], 0, 60));
    legs.push(...tube([[0, 0, 60], [0, 0, top]], 70, false, 16));
  }
  return { head, lens, stand: legs };
}

/** The pan (°) that faces the camera at `p` in its own frame, within its limits; null when it's beyond them or on the pivot. */
export function panToward(p: Pt): number | null {
  if (Math.hypot(p.x, p.y) < 1e-6) return null;
  const pan = Math.atan2(p.y, p.x) / DEG;
  return Math.abs(pan) <= PAN_LIMIT + 1e-9 ? pan : null;
}

/** The tilt (°) that looks from a lens `height` over the object at a point `distance` away along the plan at height `z`. */
export function tiltToward(height: number, distance: number, z: number): number {
  return clamp(Math.atan2(z - height, Math.max(distance, 1e-6)) / DEG, -TILT_LIMIT, TILT_LIMIT);
}
