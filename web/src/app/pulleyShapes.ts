// Pulleys for V-belts and round belts: a wheel (hub, bore and keyway, recess and web holes as a
// gear's) with up to ten grooves round its rim, seen down its axis or cut through it from the side.
// A groove is a V of its angle, its width at the outside and its depth, the corners at its bottom
// rounded to the groove radius; a round belt's groove is a small angle with the radius half the
// width. The web may be spoked instead of solid. Pure geometry in mm, centred on the origin.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";
import { circlePoints, wheelFront, wheelProblem, wheelSide, type Wheel } from "./gearShapes.ts";

export const MAX_GROOVES = 10;
export const MAX_SPOKES = 36;
/** points round each rounded corner of a groove, and along each arc of a spoked web's opening */
const FILLET_STEPS = 6;
const OPENING_STEPS = 24;

export interface Groove {
  readonly depth: number;
  readonly width: number;
  /** the angle between its flanks, degrees */
  readonly angle: number;
  readonly radius: number;
}

export interface Pulley extends Wheel {
  readonly outside: number;
  readonly groove: Groove;
  readonly grooves: number;
  /** from the left face to the first groove's middle, and between the grooves' middles */
  readonly first: number;
  readonly between: number;
  /** spokes from the hub to the recess in place of a solid web: how many, and their width as a share of the room between them at the hub */
  readonly spokes: { readonly count: number; readonly share: number } | null;
}

/** A pulley's face width: as given for one groove; for more, the first groove's distance from each face and the spacing between them. */
export function pulleyFaceWidth(grooves: number, first: number, between: number, single: number): number {
  return grooves > 1 ? 2 * first + (grooves - 1) * between : single;
}

export function pulleyRoot(p: { outside: number; groove: Groove }): number {
  return p.outside - 2 * p.groove.depth;
}

/** A groove's half width at its bottom, and how far each rounded corner reaches along the bottom and up the flank. */
function grooveSizes(g: Groove): { half: number; tangent: number; flank: number; slope: number } {
  const slope = (g.angle * Math.PI) / 360;
  const half = g.width / 2 - g.depth * Math.tan(slope);
  // the flank meets the bottom at 90° plus the half angle
  const tangent = g.radius / Math.tan((Math.PI / 2 + slope) / 2);
  return { half, tangent, flank: g.depth / Math.cos(slope), slope };
}

/** Why `p` can't be drawn, or null when it can. */
export function pulleyProblem(p: Pulley): string | null {
  const g = p.groove;
  if (!Number.isInteger(p.grooves) || p.grooves < 1 || p.grooves > MAX_GROOVES) return `a pulley has 1 to ${MAX_GROOVES} grooves`;
  if (!(g.depth > 0 && g.width > 0 && g.radius >= 0 && g.angle >= 0 && g.angle < 120)) return "a groove needs a depth and a width, an angle under 120° and no negative radius";
  const s = grooveSizes(g);
  if (s.half < -1e-9) return "the groove's flanks meet above its depth: widen it, or make it shallower or its angle smaller";
  if (s.tangent > s.half + 1e-9 || s.tangent > s.flank + 1e-9) return "the groove radius is too big for the groove";
  if (p.grooves === 1 ? !(p.faceWidth >= g.width) : !(p.between >= g.width && p.first >= g.width / 2)) {
    return "the grooves must fit on the face without overlapping";
  }
  if (!(pulleyRoot(p) > 0)) return "the grooves are deeper than the pulley";
  if (p.spokes) {
    const { count, share } = p.spokes;
    if (!p.hub || !p.recess) return "spokes run from the hub to the recess: draw both";
    if (!(Number.isInteger(count) && count >= 2 && count <= MAX_SPOKES)) return `a pulley has 2 to ${MAX_SPOKES} spokes`;
    if (!(share > 0 && share <= 1)) return "the spokes' size is a share of the room between them, up to 100%";
  }
  return wheelProblem(p, pulleyRoot(p));
}

/** The grooves round the rim, as the section's outer edge above the axis from the right face to the left. */
function grooveEdge(p: Pulley): Pt[] {
  const R = p.outside / 2;
  const g = p.groove;
  const { half, tangent, slope } = grooveSizes(g);
  const left = -p.faceWidth / 2;
  const first = p.grooves === 1 ? 0 : left + p.first;
  const bottom = R - g.depth;
  const pts: Pt[] = [];
  for (let k = p.grooves - 1; k >= 0; k--) {
    const c = first + k * p.between;
    pts.push({ x: c + g.width / 2, y: R });
    if (g.radius > 0) {
      // round the corner on the right from the flank to the bottom, then the one on the left from the bottom to the flank
      const right = { x: c + half - tangent, y: bottom + g.radius };
      for (let i = 0; i <= FILLET_STEPS; i++) {
        const a = -slope - ((Math.PI / 2 - slope) * i) / FILLET_STEPS;
        pts.push({ x: right.x + g.radius * Math.cos(a), y: right.y + g.radius * Math.sin(a) });
      }
      const leftCentre = { x: c - half + tangent, y: bottom + g.radius };
      for (let i = 0; i <= FILLET_STEPS; i++) {
        const a = -Math.PI / 2 - ((Math.PI / 2 - slope) * i) / FILLET_STEPS;
        pts.push({ x: leftCentre.x + g.radius * Math.cos(a), y: leftCentre.y + g.radius * Math.sin(a) });
      }
    } else {
      pts.push({ x: c + half, y: bottom }, { x: c - half, y: bottom });
    }
    pts.push({ x: c - g.width / 2, y: R });
  }
  return pts;
}

/** The openings between spokes, each bounded by the hub, two spokes' edges and the recess; the first spoke points up. */
export function spokeOpenings(p: Pick<Pulley, "spokes" | "hub" | "recess">): Pt[][] {
  if (!p.spokes || !p.hub || !p.recess) return [];
  const { count, share } = p.spokes;
  const rh = p.hub.diameter / 2;
  const rr = p.recess.diameter / 2;
  const w = share * 2 * rh * Math.sin(Math.PI / count);
  const at = (r: number, a: number): Pt => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const s0 = Math.PI / 2 + (2 * Math.PI * i) / count;
    const s1 = s0 + (2 * Math.PI) / count;
    const outer = [s0 + Math.asin(w / 2 / rr), s1 - Math.asin(w / 2 / rr)];
    const inner = [s0 + Math.asin(Math.min(1, w / 2 / rh)), s1 - Math.asin(Math.min(1, w / 2 / rh))];
    const pts: Pt[] = [];
    for (let k = 0; k <= OPENING_STEPS; k++) pts.push(at(rr, outer[0] + ((outer[1] - outer[0]) * k) / OPENING_STEPS));
    for (let k = 0; k <= OPENING_STEPS; k++) pts.push(at(rh, inner[1] - ((inner[1] - inner[0]) * k) / OPENING_STEPS));
    out.push(pts);
  }
  return out;
}

/** A pulley seen down its axis: its outside, and the hub, bore, recess and holes as a gear's, or the openings between its spokes; the root circle with `root`, centre lines with `beyond`. */
export function pulleyFront(p: Pulley, beyond: number | null, root: boolean): HoleDrawing {
  const d = wheelFront(p, circlePoints(p.outside / 2), null, p.outside, beyond, false);
  d.outlines.push(...spokeOpenings(p));
  if (root) d.circles.push({ center: { x: 0, y: 0 }, radius: pulleyRoot(p) / 2 });
  return d;
}

/** A pulley cut through its axis: the body as a gear's out to the outside diameter, its grooves cut into the rim; the axis with `beyond`. */
export function pulleySide(p: Pulley, beyond: number | null): HoleDrawing {
  return wheelSide(p, p.outside, null, beyond, grooveEdge(p));
}
