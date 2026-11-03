// Worms and worm gears. A worm is a screw of one to four starts, its thread a trapezoid in the axial
// section (addendum one module, dedendum 1.25, flanks at the pressure angle), a hub standing out of
// either end (or set into it) and a keyed bore; seen from the front with its threads' helices, from
// either end, cut across its threads or cut along its axis. A worm gear is a wheel with involute
// teeth whose rim is hollowed to wrap round its worm: the rim's edge is an arc about the worm's axis
// at the throat, its outside as a worm gear's (the throat diameter plus 0.4775 of the pitch for one
// or two starts, 0.3183 for three or four). Pure geometry in mm, centred on the origin.

import type { Pt } from "../core/index.ts";
import { keyway, type HoleDrawing } from "./machineShapes.ts";
import { empty, MAX_GEAR_TEETH, MIN_GEAR_TEETH, spurGearFront, wheelProblem, wheelSide, type Wheel } from "./gearShapes.ts";
import { MAX_SPOKES, spokeOpenings } from "./pulleyShapes.ts";

/** points along a thread's helix seen from the front, along the rim's throat, and round a rounded corner */
const HELIX_STEPS = 16;
const THROAT_STEPS = 24;
const CORNER_STEPS = 8;
export const MAX_STARTS = 4;

export type WormView = "front" | "right" | "left" | "sideSection" | "frontSection";
export type WormGearView = "front" | "sideSection" | "sideSolid" | "sideHidden" | "back";
export type WormProfile = "detailed" | "schematic";

/** A worm's or worm gear's hub: its diameter, and how far it stands out of the left and right faces (less than 0: set into them). */
export interface WormHub {
  readonly diameter: number;
  readonly left: number;
  readonly right: number;
}

type Bore = Wheel["bore"];

export interface Worm {
  readonly pitchDiameter: number;
  readonly axialPitch: number;
  /** degrees */
  readonly pressureAngle: number;
  readonly starts: number;
  /** the threaded length */
  readonly faceWidth: number;
  readonly profile: WormProfile;
  readonly hub: WormHub | null;
  readonly bore: Bore;
}

export interface WormGear extends Wheel {
  readonly circularPitch: number;
  readonly teeth: number;
  /** degrees */
  readonly pressureAngle: number;
  /** the worm's starts and pitch diameter, which shape the rim */
  readonly starts: number;
  readonly wormPitchDiameter: number;
  readonly profile: WormProfile;
  readonly radii: { readonly recessCorner: number; readonly recessFillet: number; readonly hubCorner: number; readonly hubFillet: number };
  readonly spokes: { readonly count: number; readonly share: number } | null;
}

/** A worm's module (mm), lead, outside and root diameters, and lead angle (radians). */
export function wormSizes(w: Pick<Worm, "pitchDiameter" | "axialPitch" | "starts">): { module: number; lead: number; outside: number; root: number; leadAngle: number } {
  const module = w.axialPitch / Math.PI;
  const lead = w.starts * w.axialPitch;
  return { module, lead, outside: w.pitchDiameter + 2 * module, root: w.pitchDiameter - 2.5 * module, leadAngle: Math.atan(lead / (Math.PI * w.pitchDiameter)) };
}

/** A worm gear's module, pitch, throat, outside and root diameters, its centre distance from the worm, and the radius of its rim's corners. */
export function wormGearSizes(g: WormGear): { module: number; pitchDiameter: number; throat: number; outside: number; root: number; centreDistance: number; throatRadius: number; rimCorner: number } {
  const module = g.circularPitch / Math.PI;
  const pitchDiameter = module * g.teeth;
  const throat = pitchDiameter + 2 * module;
  const outside = throat + (g.starts <= 2 ? 0.4775 : 0.3183) * g.circularPitch;
  const centreDistance = (pitchDiameter + g.wormPitchDiameter) / 2;
  const throatRadius = g.wormPitchDiameter / 2 - module;
  const half = g.faceWidth / 2;
  const rimCorner = Math.min(outside / 2, centreDistance - Math.sqrt(Math.max(0, throatRadius ** 2 - half ** 2)));
  return { module, pitchDiameter, throat, outside, root: pitchDiameter - 2.5 * module, centreDistance, throatRadius, rimCorner };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Why a hub standing `left` and `right` out of a face `faceWidth` wide, set into it no deeper than `floor` from the middle, can't be drawn. */
function hubDepthProblem(hub: WormHub, faceWidth: number, floor: number): string | null {
  const deepest = faceWidth / 2 - floor;
  if (!(hub.left > -deepest && hub.right > -deepest)) return `a hub can be set at most ${round2(deepest)} mm into its face`;
  return null;
}

/** Why the bore and its keyway can't be drawn inside `inside` (a diameter), or null. */
function boreProblem(bore: Bore, inside: number, what: string): string | null {
  if (!bore) return null;
  const across = bore.diameter + 2 * (bore.key?.depth ?? 0);
  if (!(bore.diameter > 0 && across < inside)) return `the bore${bore.key ? " and its keyway" : ""} must fit inside the ${what}`;
  if (bore.key && !keyway(bore.diameter, bore.key.width, bore.key.depth, true, null)) return "the keyway doesn't fit its bore";
  return null;
}

/** Why `w` can't be drawn, or null when it can. */
export function wormProblem(w: Worm): string | null {
  if (!(w.pitchDiameter > 0 && w.axialPitch > 0 && w.faceWidth > 0)) return "it needs a pitch diameter, an axial pitch and a face width";
  if (!(Number.isInteger(w.starts) && w.starts >= 1 && w.starts <= MAX_STARTS)) return `a worm has 1 to ${MAX_STARTS} starts`;
  const { module, root } = wormSizes(w);
  if (!(root > 0)) return `the pitch diameter must be more than 2.5 modules (${round2(2.5 * module)} mm)`;
  if (!(w.axialPitch / 4 > 1.25 * module * Math.tan((w.pressureAngle * Math.PI) / 180))) return "the pressure angle leaves no room between the threads";
  if (w.hub) {
    if (!(w.hub.diameter < root)) return "the hub must be smaller than the threads' root";
    const problem = hubDepthProblem(w.hub, w.faceWidth, 0) ?? boreProblem(w.bore, w.hub.diameter, "hub");
    if (problem) return problem;
  }
  return boreProblem(w.bore, root, "threads' root");
}

/** The thread's height above the axis at `x`, its teeth centred on `offset` and every axial pitch from it. */
function threadHeight(w: Worm, offset: number, x: number): number {
  const { module, outside, root } = wormSizes(w);
  if (w.profile === "schematic") return outside / 2;
  const tan = Math.tan((w.pressureAngle * Math.PI) / 180);
  const tip = w.axialPitch / 4 - module * tan;
  const foot = w.axialPitch / 4 + 1.25 * module * tan;
  const u = Math.abs((((x - offset) % w.axialPitch) + 1.5 * w.axialPitch) % w.axialPitch - w.axialPitch / 2);
  if (u <= tip) return outside / 2;
  if (u >= foot) return root / 2;
  return outside / 2 - ((u - tip) / (foot - tip)) * (outside / 2 - root / 2);
}

/** The thread's edge above the axis from the left face to the right, through every corner of its profile. */
function threadEdge(w: Worm, offset: number): Pt[] {
  const half = w.faceWidth / 2;
  const { module } = wormSizes(w);
  const xs = [-half, half];
  if (w.profile === "detailed") {
    const tan = Math.tan((w.pressureAngle * Math.PI) / 180);
    const corners = [w.axialPitch / 4 - module * tan, w.axialPitch / 4 + 1.25 * module * tan];
    const first = Math.floor((-half - offset) / w.axialPitch) - 1;
    for (let k = first; offset + k * w.axialPitch < half + w.axialPitch; k++) {
      const c = offset + k * w.axialPitch;
      for (const d of corners) for (const x of [c - d, c + d]) if (x > -half && x < half) xs.push(x);
    }
  }
  xs.sort((a, b) => a - b);
  return xs.map((x) => ({ x, y: threadHeight(w, offset, x) }));
}

/** A helix of the thread seen from the front: from the top at `x0` round the near side to the bottom half a lead on, at radius `r`, cut to the face. */
function helix(w: Worm, x0: number, r: number): Pt[][] {
  const { lead } = wormSizes(w);
  const half = w.faceWidth / 2;
  const pts = Array.from({ length: HELIX_STEPS + 1 }, (_, i) => {
    const t = (Math.PI * i) / HELIX_STEPS;
    return { x: x0 + (lead * t) / (2 * Math.PI), y: r * Math.cos(t) };
  });
  return clipX(pts, -half, half);
}

/** `pts` cut to the band from `lo` to `hi` across x: the pieces inside. */
export function clipX(pts: readonly Pt[], lo: number, hi: number): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  const at = (a: Pt, b: Pt, x: number): Pt => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const inside = p.x >= lo && p.x <= hi;
    if (i > 0) {
      const q = pts[i - 1];
      const was = q.x >= lo && q.x <= hi;
      if (was && !inside) {
        run.push(at(q, p, p.x < lo ? lo : hi));
        if (run.length > 1) out.push(run);
        run = [];
      } else if (!was && inside) run.push(at(q, p, q.x < lo ? lo : hi));
    }
    if (inside) run.push(p);
  }
  if (run.length > 1) out.push(run);
  return out;
}

/** Where a worm's hub ends on the left and right, and its outside radius. */
export function hubEnds(w: { faceWidth: number; hub: WormHub | null }): { left: number; right: number } {
  const half = w.faceWidth / 2;
  return { left: -half - Math.max(0, w.hub?.left ?? 0), right: half + Math.max(0, w.hub?.right ?? 0) };
}

/** The bore's radius above (through its keyway) and below the axis. */
function boreRadii(bore: Bore): { above: number; below: number } {
  if (!bore) return { above: 0, below: 0 };
  return { above: bore.diameter / 2 + (bore.key?.depth ?? 0), below: bore.diameter / 2 };
}

/** The worm seen from the front, its axis running left to right: the threads' outline and helices (or, schematic, the outside with root lines), the hubs beyond the faces. */
function wormFront(w: Worm): HoleDrawing {
  const d = empty();
  const half = w.faceWidth / 2;
  const { lead, root } = wormSizes(w);
  const top = threadEdge(w, 0);
  const bottom = threadEdge(w, lead / 2).map((p) => ({ x: p.x, y: -p.y }));
  d.outlines.push([...top, ...bottom.reverse()]);
  if (w.profile === "schematic") {
    for (const s of [1, -1]) d.lines.push([{ x: -half, y: (s * root) / 2 }, { x: half, y: (s * root) / 2 }]);
  } else {
    const { module, outside } = wormSizes(w);
    const tan = Math.tan((w.pressureAngle * Math.PI) / 180);
    const tip = w.axialPitch / 4 - module * tan;
    const foot = w.axialPitch / 4 + 1.25 * module * tan;
    // each thread's crest edges, and the edges of the root between threads, wind round the near side
    for (let c = -Math.ceil((half + lead) / w.axialPitch) * w.axialPitch; c < half + w.axialPitch; c += w.axialPitch) {
      for (const x of [c - tip, c + tip]) d.lines.push(...helix(w, x, outside / 2));
      for (const x of [c + foot, c + w.axialPitch - foot]) d.lines.push(...helix(w, x, root / 2));
    }
  }
  hubsBeyond(d, w.faceWidth, w.hub);
  return d;
}

/** Hubs standing out of the faces, as three sides each. */
function hubsBeyond(d: HoleDrawing, faceWidth: number, hub: WormHub | null): void {
  if (!hub) return;
  const half = faceWidth / 2;
  const r = hub.diameter / 2;
  for (const [s, p] of [[-1, hub.left], [1, hub.right]] as const) {
    if (p > 0) d.lines.push([{ x: s * half, y: r }, { x: s * (half + p), y: r }, { x: s * (half + p), y: -r }, { x: s * half, y: -r }]);
  }
}

/** One half of a section along a worm's axis (`sign` 1 above, -1 below), its outer edge through `edge` (left to right, above the axis). */
function wormHalf(w: Worm, sign: number, edge: readonly Pt[]): Pt[] {
  const half = w.faceWidth / 2;
  const b = sign > 0 ? boreRadii(w.bore).above : boreRadii(w.bore).below;
  const pts: Pt[] = [];
  const add = (x: number, y: number): void => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - x) > 1e-9 || Math.abs(last.y - y * sign) > 1e-9) pts.push({ x, y: y * sign });
  };
  if (w.hub) {
    const left = -half - w.hub.left;
    const right = half + w.hub.right;
    const r = w.hub.diameter / 2;
    add(left, b);
    add(right, b);
    add(right, r);
    add(half, r);
    for (let i = edge.length - 1; i >= 0; i--) add(edge[i].x, edge[i].y);
    add(-half, r);
    add(left, r);
  } else {
    add(-half, b);
    add(half, b);
    for (let i = edge.length - 1; i >= 0; i--) add(edge[i].x, edge[i].y);
  }
  return pts;
}

/** The worm cut along its axis: above and below, the thread's teeth (or, schematic, the outside with root lines), the hubs, and the bore (above, through its keyway). */
function wormFrontSection(w: Worm): HoleDrawing {
  const d = empty();
  const { lead, root } = wormSizes(w);
  d.outlines.push(wormHalf(w, 1, threadEdge(w, 0)), wormHalf(w, -1, threadEdge(w, lead / 2)));
  if (w.profile === "schematic") {
    const half = w.faceWidth / 2;
    for (const s of [1, -1]) d.lines.push([{ x: -half, y: (s * root) / 2 }, { x: half, y: (s * root) / 2 }]);
  }
  return d;
}

/** The bore with its keyway at the top, or a plain bore, as a drawing's outline or circle. */
function boreFront(d: HoleDrawing, bore: Bore): void {
  if (!bore) return;
  const k = bore.key ? keyway(bore.diameter, bore.key.width, bore.key.depth, true, null) : null;
  if (k) d.outlines.push(...k.outlines);
  else d.circles.push({ center: { x: 0, y: 0 }, radius: bore.diameter / 2 });
}

/**
 * A worm in `view`, its axis running left to right through the origin (the face's middle): from the
 * front, from its right or left end, cut across its threads, or cut along its axis; with `beyond`,
 * the axis and pitch lines (or circle) and centre lines reaching that far past it.
 */
export function wormDrawing(w: Worm, view: WormView, beyond: number | null): HoleDrawing {
  const { outside, root } = wormSizes(w);
  const o = { x: 0, y: 0 };
  if (view === "front" || view === "frontSection") {
    const d = view === "front" ? wormFront(w) : wormFrontSection(w);
    if (beyond !== null) {
      const ends = hubEnds(w);
      const half = w.faceWidth / 2;
      d.lines.push([{ x: ends.left - beyond, y: 0 }, { x: ends.right + beyond, y: 0 }]);
      for (const s of [1, -1]) d.lines.push([{ x: -half - beyond, y: (s * w.pitchDiameter) / 2 }, { x: half + beyond, y: (s * w.pitchDiameter) / 2 }]);
    }
    return d;
  }
  const d = empty();
  d.circles.push({ center: o, radius: outside / 2 });
  if (view === "sideSection") d.circles.push({ center: o, radius: root / 2 });
  else if (w.hub && (view === "right" ? w.hub.right : w.hub.left) !== 0) d.circles.push({ center: o, radius: w.hub.diameter / 2 });
  boreFront(d, w.bore);
  if (beyond !== null) {
    d.circles.push({ center: o, radius: w.pitchDiameter / 2 });
    const reach = outside / 2 + beyond;
    d.lines.push([{ x: -reach, y: 0 }, { x: reach, y: 0 }], [{ x: 0, y: -reach }, { x: 0, y: reach }]);
  }
  return d;
}

/** Why `g` can't be drawn, or null when it can. */
export function wormGearProblem(g: WormGear): string | null {
  if (!Number.isInteger(g.teeth) || g.teeth < MIN_GEAR_TEETH || g.teeth > MAX_GEAR_TEETH) return `a gear has ${MIN_GEAR_TEETH} to ${MAX_GEAR_TEETH} teeth`;
  if (!(g.circularPitch > 0 && g.faceWidth > 0 && g.wormPitchDiameter > 0)) return "it needs a circular pitch, a face width and the worm's pitch diameter";
  if (!(Number.isInteger(g.starts) && g.starts >= 1 && g.starts <= MAX_STARTS)) return `a worm has 1 to ${MAX_STARTS} starts`;
  const s = wormGearSizes(g);
  if (!(g.wormPitchDiameter / 2 > 1.25 * s.module)) return `the worm's pitch diameter must be more than 2.5 modules (${round2(2.5 * s.module)} mm)`;
  if (!(s.throatRadius > g.faceWidth / 2)) return `the face must be narrower than the worm's pitch diameter less two modules (${round2(2 * s.throatRadius)} mm)`;
  if (g.hub) {
    const problem = hubDepthProblem({ diameter: g.hub.diameter, left: g.hub.left, right: g.hub.right }, g.faceWidth, g.recess ? g.recess.web / 2 : 0);
    if (problem) return problem;
  }
  if (g.spokes) {
    if (!g.hub || !g.recess) return "spokes run from the hub to the recess: draw both";
    if (!(Number.isInteger(g.spokes.count) && g.spokes.count >= 2 && g.spokes.count <= MAX_SPOKES)) return `a gear has 2 to ${MAX_SPOKES} spokes`;
    if (!(g.spokes.share > 0 && g.spokes.share <= 1)) return "the spokes' size is a share of the room between them, up to 100%";
  }
  return wheelProblem(g, s.root);
}

/** The rim's edge above the axis from the right face to the left: the throat's arc about the worm's axis, cut off at the outside diameter. */
function throatEdge(g: WormGear): Pt[] {
  const s = wormGearSizes(g);
  const half = g.faceWidth / 2;
  return Array.from({ length: THROAT_STEPS + 1 }, (_, i) => {
    const x = half - (g.faceWidth * i) / THROAT_STEPS;
    return { x, y: Math.min(s.outside / 2, s.centreDistance - Math.sqrt(s.throatRadius ** 2 - x * x)) };
  });
}

/** An arc about the worm's axis of radius `r` from the left face to the right, above the axis (`sign` 1) or below. */
function wormArc(g: WormGear, r: number, sign: number, reach = g.faceWidth / 2): Pt[] {
  const a = wormGearSizes(g).centreDistance;
  return Array.from({ length: THROAT_STEPS + 1 }, (_, i) => {
    const x = -reach + (2 * reach * i) / THROAT_STEPS;
    return { x, y: sign * (a - Math.sqrt(r * r - x * x)) };
  });
}

/** `pts` (a closed outline) with its corner at `at` rounded to radius `r`, kept to half of each side it touches. */
function roundCorner(pts: Pt[], at: Pt, r: number): Pt[] {
  return roundVertex(
    pts,
    pts.findIndex((p) => Math.abs(p.x - at.x) < 1e-6 && Math.abs(p.y - at.y) < 1e-6),
    r,
  );
}

/** `pts` (a closed outline) with its `i`th point rounded to radius `r`, kept to half of each side it touches. */
export function roundVertex(pts: Pt[], i: number, r: number): Pt[] {
  if (i < 0 || !(r > 0)) return pts;
  const v = pts[i];
  const prev = pts[(i + pts.length - 1) % pts.length];
  const next = pts[(i + 1) % pts.length];
  const l1 = Math.hypot(prev.x - v.x, prev.y - v.y);
  const l2 = Math.hypot(next.x - v.x, next.y - v.y);
  if (l1 < 1e-9 || l2 < 1e-9) return pts;
  const u = { x: (prev.x - v.x) / l1, y: (prev.y - v.y) / l1 };
  const w = { x: (next.x - v.x) / l2, y: (next.y - v.y) / l2 };
  const theta = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
  if (theta < 1e-6 || Math.PI - theta < 1e-6) return pts;
  const t = Math.min(r / Math.tan(theta / 2), l1 / 2, l2 / 2);
  const radius = t * Math.tan(theta / 2);
  const a = { x: v.x + u.x * t, y: v.y + u.y * t };
  const b = { x: v.x + w.x * t, y: v.y + w.y * t };
  const bis = { x: u.x + w.x, y: u.y + w.y };
  const bl = Math.hypot(bis.x, bis.y);
  const c = { x: v.x + (bis.x / bl) * (radius / Math.sin(theta / 2)), y: v.y + (bis.y / bl) * (radius / Math.sin(theta / 2)) };
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  let sweep = Math.atan2(b.y - c.y, b.x - c.x) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc = Array.from({ length: CORNER_STEPS + 1 }, (_, k) => ({ x: c.x + radius * Math.cos(a0 + (sweep * k) / CORNER_STEPS), y: c.y + radius * Math.sin(a0 + (sweep * k) / CORNER_STEPS) }));
  return [...pts.slice(0, i), ...arc, ...pts.slice(i + 1)];
}

/** The worm gear cut through its axis: the gear's section out to its rim's throat with the recess, hub and their corners rounded, and the root's arc. */
function wormGearSection(g: WormGear, beyond: number | null): HoleDrawing {
  const s = wormGearSizes(g);
  const d = wheelSide(g, 2 * s.rimCorner, null, beyond, throatEdge(g));
  const half = g.faceWidth / 2;
  const web = g.recess ? g.recess.web / 2 : half;
  d.outlines.forEach((outline, n) => {
    const sign = n === 0 ? 1 : -1;
    let pts = outline;
    for (const side of [-1, 1]) {
      if (g.recess) {
        pts = roundCorner(pts, { x: side * half, y: (sign * g.recess.diameter) / 2 }, g.radii.recessCorner);
        pts = roundCorner(pts, { x: side * web, y: (sign * g.recess.diameter) / 2 }, g.radii.recessFillet);
      }
      const projection = side < 0 ? (g.hub?.left ?? 0) : (g.hub?.right ?? 0);
      if (g.hub && projection > 0) {
        pts = roundCorner(pts, { x: side * (half + projection), y: (sign * g.hub.diameter) / 2 }, g.radii.hubCorner);
        pts = roundCorner(pts, { x: side * web, y: (sign * g.hub.diameter) / 2 }, g.radii.hubFillet);
      }
    }
    d.outlines[n] = pts;
  });
  for (const sign of [1, -1]) d.lines.push(wormArc(g, g.wormPitchDiameter / 2 + 1.25 * s.module, sign));
  if (beyond !== null) for (const sign of [1, -1]) d.lines.push(wormArc(g, g.wormPitchDiameter / 2, sign));
  return d;
}

/** The worm gear from the side, not cut: the rim with its throat, the hubs beyond the faces; hidden edges (bore, keyway, recess, a set-in hub) in `hidden`. */
function wormGearSolid(g: WormGear, beyond: number | null): HoleDrawing & { hidden: Pt[][] } {
  const half = g.faceWidth / 2;
  const edge = throatEdge(g);
  const d = { ...empty(), hidden: [] as Pt[][] };
  d.outlines.push([...[...edge].reverse(), ...edge.map((p) => ({ x: p.x, y: -p.y }))]);
  if (g.hub) {
    const r = g.hub.diameter / 2;
    for (const [side, p] of [[-1, g.hub.left], [1, g.hub.right]] as const) {
      if (!(p > 0)) continue;
      let pts: Pt[] = [{ x: side * half, y: r }, { x: side * (half + p), y: r }, { x: side * (half + p), y: -r }, { x: side * half, y: -r }];
      for (const y of [r, -r]) pts = roundCorner(pts, { x: side * (half + p), y }, g.radii.hubCorner);
      d.lines.push(pts);
    }
  }
  const ends = hubEnds(g);
  const bore = boreRadii(g.bore);
  if (g.bore) {
    const ys = g.bore.key ? [bore.above, bore.below, -bore.below] : [bore.below, -bore.below];
    for (const y of ys) d.hidden.push([{ x: ends.left, y }, { x: ends.right, y }]);
  }
  for (const side of [-1, 1]) {
    for (const sign of [1, -1]) {
      const boreR = sign > 0 ? bore.above : bore.below;
      const inner = g.hub ? g.hub.diameter / 2 : boreR;
      const projection = side < 0 ? (g.hub?.left ?? 0) : (g.hub?.right ?? 0);
      // a hub set into the face ends at `end`, its end face hidden down to the bore
      const end = side * (half + Math.min(0, projection));
      if (g.hub && projection < 0) d.hidden.push([{ x: end, y: sign * inner }, { x: end, y: sign * boreR }]);
      if (g.recess) {
        const web = g.recess.web / 2;
        d.hidden.push([{ x: side * half, y: (sign * g.recess.diameter) / 2 }, { x: side * web, y: (sign * g.recess.diameter) / 2 }, { x: side * web, y: sign * inner }]);
        if (g.hub) d.hidden.push([{ x: end, y: sign * inner }, { x: side * web, y: sign * inner }]);
      } else if (g.hub && projection < 0) d.hidden.push([{ x: side * half, y: sign * inner }, { x: end, y: sign * inner }]);
    }
  }
  if (beyond !== null) d.lines.push([{ x: ends.left - beyond, y: 0 }, { x: ends.right + beyond, y: 0 }]);
  return d;
}

/**
 * A worm gear in `view`, centred on the origin: from the front or back down its axis (involute
 * teeth at the throat, or schematic outside and pitch circles), cut through its axis, or from the
 * side not cut, with or without its hidden edges in `hidden`; with `beyond`, the centre lines.
 */
export function wormGearDrawing(g: WormGear, view: WormGearView, beyond: number | null): HoleDrawing & { hidden: Pt[][] } {
  const s = wormGearSizes(g);
  if (view === "front" || view === "back") {
    const d = spurGearFront({ ...g, pitchDiameter: s.pitchDiameter, profile: g.profile === "detailed" ? "involute" : "simplified" }, beyond);
    d.outlines.push(...spokeOpenings(g));
    const flip = (p: Pt): Pt => (view === "back" ? { x: -p.x, y: p.y } : p);
    return {
      outlines: d.outlines.map((o) => o.map(flip)),
      lines: d.lines.map((l) => l.map(flip)),
      circles: d.circles.map((c) => ({ ...c, center: flip(c.center) })),
      arcs: [],
      hidden: [],
    };
  }
  if (view === "sideSection") return { ...wormGearSection(g, beyond), hidden: [] };
  const d = wormGearSolid(g, beyond);
  return view === "sideHidden" ? d : { ...d, hidden: [] };
}
