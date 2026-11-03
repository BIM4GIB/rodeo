// Spur gears and racks: standard full-depth involute teeth (addendum one module, dedendum 1.25
// modules), as plain points centred on the origin. A gear is seen from the front, down its axis
// (the teeth round it, or simplified to its outside and pitch circles), or cut through its axis
// from the side; a rack from the front (its teeth), the top or the side. Pure geometry in mm.

import type { Pt } from "../core/index.ts";
import { keyway, type HoleDrawing } from "./machineShapes.ts";

/** fewest and most teeth a gear may have */
export const MIN_GEAR_TEETH = 6;
export const MAX_GEAR_TEETH = 400;
/** most teeth a rack may have */
export const MAX_RACK_TEETH = 1000;
/** a rack's root fillet radius, in modules */
const RACK_FILLET = 0.38;
/** points along each tooth flank, a tip, a root, and a fillet */
const FLANK_STEPS = 8;
const TIP_STEPS = 3;
const ROOT_STEPS = 4;
const FILLET_STEPS = 4;
/** points round a plain circle drawn as an outline */
const CIRCLE_STEPS = 128;

export type GearView = "front" | "side";
export type GearProfile = "involute" | "simplified";

/** What a gear and a sprocket share inside their teeth: the hub, bore, web recess and holes. */
export interface Wheel {
  readonly faceWidth: number;
  /** a thinner web between the hub and the rim */
  readonly recess: { readonly web: number; readonly diameter: number } | null;
  /** how far the hub stands out from the face on the left and on the right (0 for none) */
  readonly hub: { readonly diameter: number; readonly left: number; readonly right: number } | null;
  /** the bore, and its keyway's width and depth into the hub */
  readonly bore: { readonly diameter: number; readonly key: { readonly width: number; readonly depth: number } | null } | null;
  /** holes through the web round a circle */
  readonly holes: { readonly count: number; readonly centreDistance: number; readonly diameter: number } | null;
}

export interface SpurGear extends Wheel {
  readonly pitchDiameter: number;
  readonly teeth: number;
  /** degrees */
  readonly pressureAngle: number;
  readonly profile: GearProfile;
}

/** A gear's reference sizes: its module (mm), diametral pitch (teeth per inch of pitch diameter), and outside, root and base diameters. */
export function gearSizes(pitchDiameter: number, teeth: number, pressureAngle: number): { module: number; diametralPitch: number; outside: number; root: number; base: number } {
  const module = pitchDiameter / teeth;
  return {
    module,
    diametralPitch: 25.4 / module,
    outside: pitchDiameter + 2 * module,
    root: pitchDiameter - 2.5 * module,
    base: pitchDiameter * Math.cos((pressureAngle * Math.PI) / 180),
  };
}

export function empty(): { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: HoleDrawing["arcs"][number][] } {
  return { outlines: [], lines: [], circles: [], arcs: [] };
}

const polar = (r: number, a: number): Pt => ({ x: r * Math.cos(a), y: r * Math.sin(a) });

/** The involute's roll from the base circle (radius `rb`) out to radius `r`: tan α − α, α the pressure angle there. */
function involuteAngle(rb: number, r: number): number {
  const a = Math.acos(Math.min(1, rb / r));
  return Math.tan(a) - a;
}

/** A spur gear's outline with involute teeth, the first tooth pointing up. */
function involuteOutline(g: SpurGear): Pt[] {
  const n = g.teeth;
  const { outside, root, base } = gearSizes(g.pitchDiameter, n, g.pressureAngle);
  const ro = outside / 2;
  const rr = root / 2;
  const rb = base / 2;
  const phi = (g.pressureAngle * Math.PI) / 180;
  // a tooth spans half the circular pitch at the pitch circle; its flanks leave the base circle this far either side of its middle
  const beta = Math.PI / (2 * n) + Math.tan(phi) - phi;
  const from = Math.max(rb, rr);
  const flank = (k: number): { r: number; off: number }[] =>
    Array.from({ length: k + 1 }, (_, i) => {
      const r = from + ((ro - from) * i) / k;
      return { r, off: Math.max(0, beta - involuteAngle(rb, r)) };
    });
  const up = flank(FLANK_STEPS);
  const tipOff = up[up.length - 1].off;
  const rootOff = up[0].off;
  const pts: Pt[] = [];
  for (let t = 0; t < n; t++) {
    const c = Math.PI / 2 + (2 * Math.PI * t) / n;
    // the flank on the clockwise side, from the root out
    if (rr < rb) pts.push(polar(rr, c - beta));
    for (const p of up) pts.push(polar(p.r, c - p.off));
    for (let i = 1; i < TIP_STEPS; i++) pts.push(polar(ro, c - tipOff + (2 * tipOff * i) / TIP_STEPS));
    for (let i = up.length - 1; i >= 0; i--) pts.push(polar(up[i].r, c + up[i].off));
    if (rr < rb) pts.push(polar(rr, c + beta));
    // the root, round to the next tooth
    const a0 = c + (rr < rb ? beta : rootOff);
    const a1 = c + (2 * Math.PI) / n - (rr < rb ? beta : rootOff);
    for (let i = 1; i < ROOT_STEPS; i++) pts.push(polar(rr, a0 + ((a1 - a0) * i) / ROOT_STEPS));
  }
  return pts;
}

export function circlePoints(r: number): Pt[] {
  return Array.from({ length: CIRCLE_STEPS }, (_, i) => polar(r, (2 * Math.PI * i) / CIRCLE_STEPS));
}

/** Why `g` can't be drawn, or null when it can. */
export function gearProblem(g: SpurGear): string | null {
  if (!Number.isInteger(g.teeth) || g.teeth < MIN_GEAR_TEETH || g.teeth > MAX_GEAR_TEETH) return `a gear has ${MIN_GEAR_TEETH} to ${MAX_GEAR_TEETH} teeth`;
  if (!(g.pitchDiameter > 0 && g.faceWidth > 0)) return "it needs a pitch diameter and a face width";
  return wheelProblem(g, gearSizes(g.pitchDiameter, g.teeth, g.pressureAngle).root);
}

/**
 * Why a wheel with teeth down to `root` (a diameter) can't be drawn, or null when it can: the bore,
 * hub, recess and holes must nest inside one another and inside the root circle, the web must be
 * thinner than the face.
 */
export function wheelProblem(g: Wheel, root: number): string | null {
  const bore = g.bore ? g.bore.diameter + 2 * (g.bore.key?.depth ?? 0) : 0;
  const hub = g.hub?.diameter ?? bore;
  const rim = g.recess?.diameter ?? root;
  if (!(bore < root)) return "the bore must be smaller than the root circle";
  if (g.hub && !(g.hub.diameter > bore && g.hub.diameter < rim)) return "the hub must be wider than the bore and inside the recess and the root circle";
  if (g.recess && !(g.recess.diameter > hub && g.recess.diameter < root && g.recess.web > 0 && g.recess.web < g.faceWidth)) {
    return "the recess must lie between the hub and the root circle, its web thinner than the face";
  }
  if (g.holes) {
    const { count, centreDistance, diameter } = g.holes;
    const inner = (centreDistance - diameter) / 2;
    const outer = (centreDistance + diameter) / 2;
    const apart = centreDistance * Math.sin(Math.PI / count);
    if (!(count >= 1 && diameter > 0 && inner > hub / 2 && outer < rim / 2 && (count === 1 || apart > diameter))) {
      return "the web's holes must fit between the hub and the rim without touching";
    }
  }
  if (g.bore?.key && !keyway(g.bore.diameter, g.bore.key.width, g.bore.key.depth, true, null)) return "the keyway doesn't fit its bore";
  return null;
}

/**
 * A spur gear seen down its axis: its outline (involute teeth, or simplified to the outside
 * circle), the bore with its keyway at the top as an outline over it, the hub, recess and web
 * holes as circles; with `beyond`, the pitch circle and centre lines reaching that far past the
 * teeth. The simplified gear always shows its pitch circle.
 */
export function spurGearFront(g: SpurGear, beyond: number | null): HoleDrawing {
  const { outside } = gearSizes(g.pitchDiameter, g.teeth, g.pressureAngle);
  const outline = g.profile === "involute" ? involuteOutline(g) : circlePoints(outside / 2);
  return wheelFront(g, outline, g.pitchDiameter, outside, beyond, g.profile === "simplified");
}

/**
 * A wheel seen down its axis: `outline`, the bore with its keyway at the top as an outline over
 * it, the hub, recess and web holes as circles; the pitch circle (if it has one) with `beyond` or
 * `pitch`, and with `beyond` centre lines reaching that far past the `outside` diameter.
 */
export function wheelFront(g: Wheel, outline: Pt[], pitchDiameter: number | null, outside: number, beyond: number | null, pitch: boolean): HoleDrawing {
  const d = empty();
  d.outlines.push(outline);
  if (g.bore) {
    const k = g.bore.key;
    const bore = k ? keyway(g.bore.diameter, k.width, k.depth, true, null) : null;
    if (bore) d.outlines.push(...bore.outlines);
    else d.circles.push({ center: { x: 0, y: 0 }, radius: g.bore.diameter / 2 });
  }
  if (g.hub) d.circles.push({ center: { x: 0, y: 0 }, radius: g.hub.diameter / 2 });
  if (g.recess) d.circles.push({ center: { x: 0, y: 0 }, radius: g.recess.diameter / 2 });
  if (g.holes) {
    for (let i = 0; i < g.holes.count; i++) {
      d.circles.push({ center: polar(g.holes.centreDistance / 2, Math.PI / 2 + (2 * Math.PI * i) / g.holes.count), radius: g.holes.diameter / 2 });
    }
  }
  if (pitchDiameter !== null && (beyond !== null || pitch)) d.circles.push({ center: { x: 0, y: 0 }, radius: pitchDiameter / 2 });
  if (beyond !== null) {
    const reach = outside / 2 + beyond;
    d.lines.push([{ x: -reach, y: 0 }, { x: reach, y: 0 }], [{ x: 0, y: -reach }, { x: 0, y: reach }]);
  }
  return d;
}

/** A radial band of a gear's section: from radius `r0` to `r1`, reaching from `left` to `right` along the axis. */
interface Band {
  readonly r0: number;
  readonly r1: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The outline of the half of a section above the axis made of `bands`, inside out; `sign` -1 turns
 * it below. `edge` (points above the axis, right to left) runs along the last band's outer edge.
 */
function halfSection(bands: readonly Band[], sign: number, edge: readonly Pt[]): Pt[] {
  const pts: Pt[] = [];
  const add = (x: number, y: number): void => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - x) > 1e-9 || Math.abs(last.y - y * sign) > 1e-9) pts.push({ x, y: y * sign });
  };
  add(bands[0].left, bands[0].r0);
  add(bands[0].right, bands[0].r0);
  bands.forEach((b, i) => {
    add(b.right, b.r1);
    if (i + 1 < bands.length) add(bands[i + 1].right, b.r1);
  });
  for (const p of edge) add(p.x, p.y);
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    add(b.left, b.r1);
    add(b.left, b.r0);
    if (i > 0) add(bands[i - 1].left, b.r0);
  }
  return pts;
}

/**
 * A spur gear cut through its axis, which runs left to right: above and below the axis, the hub
 * standing out from the face, the web between the hub and the rim and the rim the face's width,
 * the bore between them (above, through its keyway); root lines across the rim; with `beyond`,
 * the pitch lines and the axis reaching that far past it.
 */
export function spurGearSide(g: SpurGear, beyond: number | null): HoleDrawing {
  const { outside, root } = gearSizes(g.pitchDiameter, g.teeth, g.pressureAngle);
  const half = g.faceWidth / 2;
  const d = wheelSide(g, outside, g.pitchDiameter, beyond);
  for (const sign of [1, -1]) d.lines.push([{ x: -half, y: (sign * root) / 2 }, { x: half, y: (sign * root) / 2 }]);
  return d;
}

/**
 * A wheel cut through its axis, which runs left to right: above and below the axis, the hub
 * standing out from the face, the web between the hub and the rim, and the rim out to `rim` (a
 * diameter), the face's width, its outer edge running through `edge` (points above the axis, right
 * to left) if given; the bore between them (above, through its keyway); with `beyond`, the axis
 * and the pitch lines (if it has a pitch circle) reaching that far past it.
 */
export function wheelSide(g: Wheel, rim: number, pitchDiameter: number | null, beyond: number | null, edge: readonly Pt[] = []): HoleDrawing {
  const d = empty();
  const bore = g.bore ? g.bore.diameter / 2 : 0;
  const half = g.faceWidth / 2;
  for (const sign of [1, -1]) {
    const bands: Band[] = [];
    let r = sign > 0 && g.bore?.key ? bore + g.bore.key.depth : bore;
    if (g.hub) {
      bands.push({ r0: r, r1: g.hub.diameter / 2, left: -half - g.hub.left, right: half + g.hub.right });
      r = g.hub.diameter / 2;
    }
    if (g.recess) {
      bands.push({ r0: r, r1: g.recess.diameter / 2, left: -g.recess.web / 2, right: g.recess.web / 2 });
      r = g.recess.diameter / 2;
    }
    bands.push({ r0: r, r1: rim / 2, left: -half, right: half });
    d.outlines.push(halfSection(bands, sign, edge));
  }
  if (beyond !== null) {
    const left = -half - (g.hub?.left ?? 0) - beyond;
    const right = half + (g.hub?.right ?? 0) + beyond;
    d.lines.push([{ x: left, y: 0 }, { x: right, y: 0 }]);
    if (pitchDiameter !== null) {
      for (const sign of [1, -1]) d.lines.push([{ x: -half - beyond, y: (sign * pitchDiameter) / 2 }, { x: half + beyond, y: (sign * pitchDiameter) / 2 }]);
    }
  }
  return d;
}

export type RackView = "front" | "top" | "side";

export interface SpurRack {
  /** mm */
  readonly module: number;
  /** degrees */
  readonly pressureAngle: number;
  readonly teeth: number;
  /** the rack's body under the teeth' roots */
  readonly thickness: number;
  readonly faceWidth: number;
  /** every tooth, or only the end ones with the tips' and roots' lines between */
  readonly allTeeth: boolean;
  readonly fillet: boolean;
  readonly pitchLine: boolean;
}

/** Why `r` can't be drawn, or null when it can. */
export function rackProblem(r: SpurRack): string | null {
  if (!Number.isInteger(r.teeth) || r.teeth < 1 || r.teeth > MAX_RACK_TEETH) return `a rack has 1 to ${MAX_RACK_TEETH.toLocaleString("en")} teeth`;
  if (!(r.module > 0 && r.thickness > 0 && r.faceWidth > 0)) return "it needs a module or pitch, a thickness and a face width";
  return null;
}

/** Points rounding the corner at `b` (from `a`, on to `c`) with radius `radius`; the corner itself when it can't. */
function filleted(a: Pt, b: Pt, c: Pt, radius: number): Pt[] {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  const turn = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv))));
  const reach = radius / Math.tan(turn / 2);
  if (!(reach > 0) || reach > lu / 2 || reach > lv / 2) return [b];
  const p = { x: b.x + (u.x / lu) * reach, y: b.y + (u.y / lu) * reach };
  const q = { x: b.x + (v.x / lv) * reach, y: b.y + (v.y / lv) * reach };
  // the arc's centre lies along the corner's bisector
  const bis = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
  const lb = Math.hypot(bis.x, bis.y);
  const centreAt = radius / Math.sin(turn / 2);
  const o = { x: b.x + (bis.x / lb) * centreAt, y: b.y + (bis.y / lb) * centreAt };
  const a0 = Math.atan2(p.y - o.y, p.x - o.x);
  let sweep = Math.atan2(q.y - o.y, q.x - o.x) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return Array.from({ length: FILLET_STEPS + 1 }, (_, i) => polar(radius, a0 + (sweep * i) / FILLET_STEPS)).map((pt) => ({ x: pt.x + o.x, y: pt.y + o.y }));
}

/**
 * The tops of a rack's teeth from the left end to the right, the pitch line at y = 0: each tooth's
 * root, flank, tip and flank, and the root between it and the next.
 */
function rackTeeth(r: SpurRack): Pt[] {
  const m = r.module;
  const p = Math.PI * m;
  const tan = Math.tan((r.pressureAngle * Math.PI) / 180);
  const tip = m;
  const root = -1.25 * m;
  const atTip = p / 4 - tip * tan;
  const atRoot = p / 4 - root * tan;
  const pts: Pt[] = [];
  for (let i = 0; i < r.teeth; i++) {
    const c = (i + 0.5) * p;
    pts.push({ x: c - atRoot, y: root }, { x: c - atTip, y: tip }, { x: c + atTip, y: tip }, { x: c + atRoot, y: root });
  }
  return pts;
}

/**
 * A spur rack, its pitch line's left end at the origin and its teeth up. From the front: its
 * outline (every tooth, or two at each end with the tips' line between and the roots' line under
 * it), the roots filleted if asked; from the top: its face, a line across it at each edge of a
 * tip and a root; from the side: the end of its body and teeth. With `pitchLine`, the pitch line
 * reaching `beyond` past it.
 */
export function spurRack(r: SpurRack, view: RackView, beyond: number): HoleDrawing {
  const d = empty();
  const m = r.module;
  const length = r.teeth * Math.PI * m;
  const top = m;
  const bottom = -1.25 * m - r.thickness;
  const teeth = rackTeeth(r);
  if (view === "front") {
    const some = !r.allTeeth && r.teeth > 3;
    // two teeth at each end: the first whole, the second's near flank up to the tips' line
    let profile = some ? [...teeth.slice(0, 6), ...teeth.slice(-6)] : teeth;
    if (r.fillet) {
      const body = [{ x: 0, y: -1.25 * m }, ...profile, { x: length, y: -1.25 * m }];
      profile = body.slice(1, -1).flatMap((pt, i) => (pt.y < 0 ? filleted(body[i], pt, body[i + 2], RACK_FILLET * m) : [pt]));
    }
    d.outlines.push([{ x: 0, y: bottom }, { x: length, y: bottom }, { x: length, y: -1.25 * m }, ...[...profile].reverse(), { x: 0, y: -1.25 * m }]);
    // under the tips' line, the roots' line where teeth are left out
    if (some) d.lines.push([{ x: teeth[4].x, y: -1.25 * m }, { x: teeth[teeth.length - 5].x, y: -1.25 * m }]);
    if (r.pitchLine) d.lines.push([{ x: -beyond, y: 0 }, { x: length + beyond, y: 0 }]);
    return d;
  }
  if (view === "top") {
    const w = r.faceWidth;
    d.outlines.push([{ x: 0, y: 0 }, { x: length, y: 0 }, { x: length, y: w }, { x: 0, y: w }]);
    for (const pt of teeth) if (pt.x > 1e-9 && pt.x < length - 1e-9) d.lines.push([{ x: pt.x, y: 0 }, { x: pt.x, y: w }]);
    return d;
  }
  const w = r.faceWidth;
  d.outlines.push([{ x: 0, y: bottom }, { x: w, y: bottom }, { x: w, y: top }, { x: 0, y: top }]);
  d.lines.push([{ x: 0, y: -1.25 * m }, { x: w, y: -1.25 * m }]);
  if (r.pitchLine) d.lines.push([{ x: -beyond, y: 0 }, { x: w + beyond, y: 0 }]);
  return d;
}
