// What Site Planning's Curb tool draws in plan (tools/curb.ts), as plain geometry: the curb's front
// edge, its back edge, the joints between its units, its mitred corners and the foundation hidden
// under it. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist, offsetPolyline } from "./geom.ts";

/** Draw 2D: the front edge alone, front and back lines (the back dashed), or full detail */
export type CurbDraw = "line" | "frontBack" | "full";

export interface Curb {
  readonly draw: CurbDraw;
  /** the side of the clicked path (its front edge) the curb lies */
  readonly side: "left" | "right";
  /** the main component's width, front to back */
  readonly width: number;
  /** a unit's length along the curb; 0 for one piece between corners */
  readonly unitLength: number;
  /** the joint between units */
  readonly joint: number;
  readonly foundation: boolean;
  /** how far the foundation reaches in front of the curb, and behind it */
  readonly frontOverhang: number;
  readonly backOverhang: number;
}

export interface CurbPlan {
  /** open lines drawn solid */
  readonly lines: Pt[][];
  /** closed outlines drawn solid */
  readonly outlines: Pt[][];
  /** Front and Back Lines' back edge: drawn in another line type */
  readonly back: Pt[][];
  /** the foundation, below grade: drawn dashed */
  readonly dashed: Pt[][];
}

/** most joints one curb draws */
export const MAX_CURB_JOINTS = 5000;

const EPS = 1e-6;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** Why the curb can't be drawn as set, or null. */
export function curbProblem(c: Curb): string | null {
  if (c.draw === "line") return null;
  if (!(c.width > 0)) return "Set the curb's width more than 0.";
  if (c.draw === "frontBack") return null;
  if (!(c.unitLength >= 0)) return "Set a unit length of 0 (one piece) or more.";
  if (!(c.joint >= 0)) return "Set a joint width of 0 or more.";
  if (c.unitLength > 0 && !(c.joint < c.unitLength)) return "Set a joint narrower than the units.";
  if (c.foundation && !(c.frontOverhang >= 0 && c.backOverhang >= 0)) return "Set the foundation's overhangs to 0 or more.";
  return null;
}

/**
 * A curb along `path` (closed: round it) in plan, or why it can't be drawn. The path is its front
 * edge, the back edge its width to the set side. In full detail it is a piece between each pair
 * of corners, mitred where they meet, cut into units the unit length long from each piece's start
 * (its last unit shorter) with a joint between, joints that would cross a mitre left out; the
 * foundation reaches its overhangs in front and behind, dashed.
 */
export function curb(path: readonly Pt[], closed: boolean, c: Curb): CurbPlan | string {
  const problem = curbProblem(c);
  if (problem) return problem;
  const front = offsetPolyline(path, closed, 0);
  if (!front || front.length < 2) return "Draw a curb longer than 0.";
  const ring = (pts: Pt[]): Pt[] => (closed ? [...pts, pts[0]] : pts);
  const plan: CurbPlan = { lines: [], outlines: [], back: [], dashed: [] };
  if (c.draw === "line") {
    plan.lines.push(ring(front));
    return plan;
  }
  // offsetPolyline's positive side is the left
  const toward = c.side === "left" ? 1 : -1;
  const back = offsetPolyline(front, closed, toward * c.width);
  if (!back || back.length !== front.length) return "The curb is too wide for the path's corners: set a narrower curb or draw longer segments.";
  if (c.draw === "frontBack") {
    plan.lines.push(ring(front));
    plan.back.push(ring(back));
    return plan;
  }

  if (closed) plan.lines.push(ring(front), ring(back));
  else plan.outlines.push([...front, ...[...back].reverse()]);
  const n = front.length;
  // the mitres where pieces meet
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) plan.lines.push([front[i], back[i]]);
  // joints across each piece
  let joints = 0;
  if (c.unitLength > 0) {
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = front[i];
      const b = front[(i + 1) % n];
      const len = dist(a, b);
      if (!(len > EPS)) continue;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const across = { x: -u.y * toward, y: u.x * toward };
      // where the back edge's ends fall along the piece: joints before or after them would cross a mitre
      const start = Math.max(0, (back[i].x - a.x) * u.x + (back[i].y - a.y) * u.y);
      const end = Math.min(len, (back[(i + 1) % n].x - a.x) * u.x + (back[(i + 1) % n].y - a.y) * u.y);
      const pitch = c.unitLength + c.joint;
      for (let s = c.unitLength + c.joint / 2; s < len - EPS; s += pitch) {
        if (s - c.joint / 2 < start + EPS || s + c.joint / 2 > end - EPS) continue;
        joints++;
        if (joints > MAX_CURB_JOINTS) return `A curb draws at most ${MAX_CURB_JOINTS} joints: set longer units or draw a shorter curb.`;
        for (const at of c.joint > 0 ? [s - c.joint / 2, s + c.joint / 2] : [s]) {
          const p = add(a, u, at);
          plan.lines.push([p, add(p, across, c.width)]);
        }
      }
    }
  }
  if (c.foundation && c.frontOverhang + c.backOverhang > 0) {
    const near = offsetPolyline(front, closed, -toward * c.frontOverhang);
    const far = offsetPolyline(front, closed, toward * (c.width + c.backOverhang));
    if (!near || !far) return "The foundation is too wide for the path's corners: set smaller overhangs.";
    if (closed) plan.dashed.push(ring(near), ring(far));
    else plan.dashed.push([...near, ...[...far].reverse(), near[0]]);
  }
  return plan;
}
