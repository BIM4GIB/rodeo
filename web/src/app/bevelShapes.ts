// Straight bevel gears: a gear and its pinion on shafts at an angle, their pitch cones meeting at
// the apex. Each is drawn cut through its axis (its teeth' tip, root and back cone, the blank's front
// face, recess, hub with its fillet, and the bore with its keyway in the upper half), or seen down
// its axis from the apex. Teeth are proportioned as a standard full-depth bevel gear: addendum one
// module, dedendum 1.25 modules at the heel, tapering to the apex. Pure geometry in mm.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";
import { keyway } from "./machineShapes.ts";

/** points round the fillet's quarter circle */
const FILLET_STEPS = 8;
/** fewest teeth a bevel gear may have, and most */
export const MIN_BEVEL_TEETH = 5;
export const MAX_BEVEL_TEETH = 400;

export interface BevelMember {
  readonly teeth: number;
  /** from the back of the hub to the pitch apex */
  readonly mounting: number;
  readonly hubDiameter: number;
  readonly hubProjection: number;
  readonly bore: number;
  /** the keyway's width and depth into the hub */
  readonly key: { readonly width: number; readonly depth: number } | null;
  /** how deep the front face is cut back between the hub and the rim, or 0 */
  readonly recess: number;
  /** the hub's fillet into the back face, or 0 */
  readonly fillet: number;
}

export interface BevelPair {
  readonly module: number;
  /** radians */
  readonly shaftAngle: number;
  readonly faceWidth: number;
  readonly gear: BevelMember;
  readonly pinion: BevelMember;
}

export type BevelWhich = "gear" | "pinion";

/** The pitch cone angles (radians) and pitch diameters at the heel, and the cone distance they share. */
export function bevelCones(p: BevelPair): { gear: { delta: number; d: number }; pinion: { delta: number; d: number }; R: number } {
  const z1 = p.pinion.teeth;
  const z2 = p.gear.teeth;
  const d1 = p.module * z1;
  const d2 = p.module * z2;
  const delta1 = Math.atan2(Math.sin(p.shaftAngle), z2 / z1 + Math.cos(p.shaftAngle));
  const delta2 = p.shaftAngle - delta1;
  return { gear: { delta: delta2, d: d2 }, pinion: { delta: delta1, d: d1 }, R: d2 / (2 * Math.sin(delta2)) };
}

/** A member's points in its own frame: the apex at the origin, its axis along x, its body toward -x. */
function memberPoints(p: BevelPair, which: BevelWhich) {
  const cones = bevelCones(p);
  const { delta } = cones[which];
  const R = cones.R;
  const m = p.module;
  const b = p.faceWidth;
  const k = (R - b) / R;
  const u = { x: -Math.cos(delta), y: Math.sin(delta) };
  const n = { x: Math.sin(delta), y: Math.cos(delta) };
  const along = (s: number, h: number): Pt => ({ x: s * u.x + h * n.x, y: s * u.y + h * n.y });
  const ha = m;
  const hf = 1.25 * m;
  return {
    delta,
    R,
    n,
    pitchHeel: along(R, 0),
    tipHeel: along(R, ha),
    tipToe: along(R - b, k * ha),
    rootHeel: along(R, -hf),
    rootToe: along(R - b, -k * hf),
    /** the rim's inside under the recess, a toe's rim of two modules */
    rimInside: along(R - b, -k * hf).y - 2 * m * k,
  };
}

/** Why `p` can't be drawn showing `which` members, or null when it can. */
export function bevelProblem(p: BevelPair, which: readonly BevelWhich[]): string | null {
  if (!(p.module > 0)) return "the module must be more than 0";
  if (!(p.shaftAngle > 0 && p.shaftAngle < Math.PI)) return "the shaft angle must be between 0° and 180°";
  for (const w of ["gear", "pinion"] as const) {
    const t = p[w].teeth;
    if (!(Number.isInteger(t) && t >= MIN_BEVEL_TEETH && t <= MAX_BEVEL_TEETH)) return `a bevel gear has ${MIN_BEVEL_TEETH} to ${MAX_BEVEL_TEETH} teeth`;
  }
  const { R } = bevelCones(p);
  if (!(p.faceWidth > 0 && p.faceWidth <= R / 2)) return `the face width must be at most half the cone distance (${Math.round((R / 2) * 100) / 100} mm)`;
  for (const w of which) {
    const g = p[w];
    const name = w === "gear" ? "gear's" : "pinion's";
    const pts = memberPoints(p, w);
    if (!(g.bore > 0 && g.bore < g.hubDiameter)) return `the ${name} bore must be narrower than its hub`;
    if (g.key && !keyway(g.bore, g.key.width, g.key.depth, true, null)) return `the ${name} keyway doesn't fit its bore`;
    if (g.key && !(g.bore / 2 + g.key.depth < g.hubDiameter / 2)) return `the ${name} keyway cuts through its hub`;
    if (!(g.hubDiameter / 2 < pts.rootToe.y)) return `the ${name} hub must be smaller than its teeth' roots`;
    const behind = -pts.rootHeel.x;
    if (!(g.mounting - g.hubProjection >= behind - 1e-9)) return `the ${name} mounting distance less its hub projection must reach behind its teeth (at least ${Math.round(behind * 100) / 100} mm)`;
    if (g.recess > 0 && !(pts.rimInside > g.hubDiameter / 2)) return `the ${name} rim leaves no room for a recess`;
  }
  return null;
}

/**
 * Half a member's section, above its axis in its own frame (`keyed`: its bore cut by the keyway),
 * as a closed outline, and its root line.
 */
function halfSection(p: BevelPair, which: BevelWhich, keyed: boolean): { outline: Pt[]; root: [Pt, Pt] } {
  const g = p[which];
  const pts = memberPoints(p, which);
  const { n, rootHeel, rootToe } = pts;
  const back = -g.mounting;
  const rim = back + g.hubProjection;
  const hub = g.hubDiameter / 2;
  const bore = g.bore / 2 + (keyed && g.key ? g.key.depth : 0);
  const out: Pt[] = [
    { x: back, y: bore },
    { x: back, y: hub },
  ];
  // the back cone runs from the heel's root down to the rim's back face, or to the hub
  const toFace = (rootHeel.x - rim) / n.x;
  const atFace = { x: rim, y: rootHeel.y - toFace * n.y };
  if (atFace.y > hub) {
    const f = Math.min(g.fillet, g.hubProjection, atFace.y - hub);
    if (f > 0) {
      for (let i = 0; i <= FILLET_STEPS; i++) {
        const t = -Math.PI / 2 + ((Math.PI / 2) * i) / FILLET_STEPS;
        out.push({ x: rim - f + f * Math.cos(t), y: hub + f + f * Math.sin(t) });
      }
    } else out.push({ x: rim, y: hub });
    out.push(atFace);
  } else {
    const toHub = (rootHeel.y - hub) / n.y;
    out.push({ x: rootHeel.x - toHub * n.x, y: hub });
  }
  out.push(rootHeel, pts.tipHeel, pts.tipToe, rootToe);
  const front = rootToe.x;
  if (g.recess > 0) {
    out.push({ x: front, y: pts.rimInside }, { x: front - g.recess, y: pts.rimInside }, { x: front - g.recess, y: hub }, { x: front, y: hub });
  }
  out.push({ x: front, y: bore });
  return { outline: out, root: [rootHeel, rootToe] };
}

/** `pts` turned from a member's frame into the drawing's: its body toward `body` (a unit vector from the apex). */
function toWorld(pts: readonly Pt[], body: Pt): Pt[] {
  // the frame's +x runs to the apex, against `body`; +y a quarter turn anticlockwise from it
  const ax = { x: -body.x, y: -body.y };
  const ay = { x: -ax.y, y: ax.x };
  return pts.map((q) => ({ x: q.x * ax.x + q.y * ay.x, y: q.x * ax.y + q.y * ay.y }));
}

/** where each member's body lies from the apex: the gear's straight down, the pinion's turned the shaft angle from it, right (or left) */
function bodies(p: BevelPair, pinionLeft: boolean): Record<BevelWhich, Pt> {
  const t = pinionLeft ? -p.shaftAngle : p.shaftAngle;
  return { gear: { x: 0, y: -1 }, pinion: { x: Math.sin(t), y: -Math.cos(t) } };
}

/**
 * The members in `which` as profiles to turn, without their keyways: x from the axis and y along it
 * toward the pitch apex at 0; and `body`, the way the member's axis runs from the apex in the side
 * view, as a unit vector.
 */
export function bevelTurnings(p: BevelPair, which: readonly BevelWhich[], pinionLeft: boolean): { profile: Pt[]; body: Pt }[] {
  const body = bodies(p, pinionLeft);
  return which.map((w) => ({ profile: halfSection(p, w, false).outline.map((q) => ({ x: q.y, y: q.x })), body: body[w] }));
}

/**
 * The members in `which` cut through their axes, the pitch apex at the origin: the gear's axis
 * upright with its body below, the pinion's turned the shaft angle from it to the right (or left).
 * With `beyond`, each axis from past its back to the apex, and the pitch cone's line from past the
 * heel to the apex.
 */
export function bevelSide(p: BevelPair, which: readonly BevelWhich[], pinionLeft: boolean, beyond: number | null): HoleDrawing {
  const d: HoleDrawing = { outlines: [], lines: [], circles: [], arcs: [] };
  const body = bodies(p, pinionLeft);
  for (const w of which) {
    const g = p[w];
    for (const sign of [1, -1]) {
      const half = halfSection(p, w, sign > 0);
      const flip = (q: Pt): Pt => ({ x: q.x, y: sign * q.y });
      d.outlines.push(toWorld(half.outline.map(flip), body[w]));
      d.lines.push(toWorld(half.root.map(flip), body[w]));
      if (beyond !== null) {
        const pts = memberPoints(p, w);
        const reach = Math.hypot(pts.pitchHeel.x, pts.pitchHeel.y) + beyond;
        d.lines.push(toWorld([{ x: 0, y: 0 }, flip({ x: -reach * Math.cos(pts.delta), y: reach * Math.sin(pts.delta) })], body[w]));
      }
    }
    if (beyond !== null) d.lines.push(toWorld([{ x: -g.mounting - beyond, y: 0 }, { x: beyond, y: 0 }], body[w]));
  }
  return d;
}

/**
 * One member seen down its axis from the apex, centred on the origin: its outside and the teeth'
 * toe, the recess, and the bore with its keyway at the top; with `beyond`, the pitch circle and
 * centre lines reaching that far past the outside.
 */
export function bevelFront(p: BevelPair, which: BevelWhich, beyond: number | null): HoleDrawing {
  const d: HoleDrawing = { outlines: [], lines: [], circles: [], arcs: [] };
  const g = p[which];
  const pts = memberPoints(p, which);
  const c = { x: 0, y: 0 };
  d.circles.push({ center: c, radius: pts.tipHeel.y }, { center: c, radius: pts.tipToe.y }, { center: c, radius: pts.rootToe.y });
  if (g.recess > 0) d.circles.push({ center: c, radius: pts.rimInside }, { center: c, radius: g.hubDiameter / 2 });
  const bore = g.key ? keyway(g.bore, g.key.width, g.key.depth, true, null) : null;
  if (bore) d.outlines.push(...bore.outlines);
  else d.circles.push({ center: c, radius: g.bore / 2 });
  if (beyond !== null) {
    d.circles.push({ center: c, radius: pts.pitchHeel.y });
    const reach = pts.tipHeel.y + beyond;
    d.lines.push([{ x: -reach, y: 0 }, { x: reach, y: 0 }], [{ x: 0, y: -reach }, { x: 0, y: reach }]);
  }
  return d;
}
