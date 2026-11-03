// What Building Shell's Structural Member tool (tools/members.ts) draws in Top/Plan, as plain
// geometry in the drawing's coordinates: a linear or polylinear member's body its breadth wide along
// its path, aligned on it, run on or cut back at its ends and mitred there, with its caps and centre
// marks; and a column's section where it stands. Kept apart from the tool so it runs without the
// page.

import type { Pt } from "../core/index.ts";
import { steelOutline, type SteelShape, type SteelSize } from "./detailShapes.ts";
import { dist, offsetPolyline } from "./geom.ts";

/** the steepest miter Vectorworks allows, degrees either way from a square cut */
export const MAX_MEMBER_MITER = 70;
/** points round a circular column */
const CIRCLE_STEPS = 64;

export type MemberShape = { readonly kind: "steel"; readonly shape: SteelShape } | { readonly kind: "rect" } | { readonly kind: "circle" };
export type AxisAlign = "left" | "centre" | "right";

export interface MemberProfile {
  readonly shape: MemberShape;
  /** a steel section's size; a rectangle's or circle's `depth` and `width` (a circle's its diameter) */
  readonly size: SteelSize;
}

export interface LinearMember {
  /** where the clicked path lies across the member, seen along it */
  readonly align: AxisAlign;
  /** the member moved this far left of that (right when negative), mm */
  readonly offset: number;
  /** each end run on past its click (cut back when negative), mm */
  readonly startOffset: number;
  readonly endOffset: number;
  /** each end's cut in plan, degrees from square: positive lengthens the member's left edge at that end */
  readonly startMiter: number;
  readonly endMiter: number;
  readonly startCap: boolean;
  readonly endCap: boolean;
  /** a centre mark this long beyond each end, the gap from it; none when null */
  readonly mark: { readonly length: number; readonly gap: number } | null;
}

export interface MemberPlan {
  /** the body: its left edge then its right edge back */
  readonly body: Pt[];
  readonly left: Pt[];
  readonly right: Pt[];
  /** each end's cap, when drawn */
  readonly caps: Pt[][];
  /** the centre marks beyond its ends */
  readonly marks: Pt[][];
}

const at = (x: number, y: number): Pt => ({ x, y });

/** A member's breadth seen from above: its section's width, a square or round tube's size. */
export function memberBreadth(p: MemberProfile): number {
  if (p.shape.kind === "circle") return p.size.width;
  if (p.shape.kind === "steel" && (p.shape.shape === "st" || p.shape.shape === "rd")) return p.size.depth;
  return p.size.width;
}

/** A column's section on the origin, its depth up its own y: an outline, or why it can't be drawn. */
export function columnSection(p: MemberProfile): Pt[] | string {
  const { depth, width } = p.size;
  if (p.shape.kind === "steel") return steelOutline(p.shape.shape, p.size) ?? "Set the steel section's sizes: its thicknesses less than half its depth and width.";
  if (p.shape.kind === "circle") {
    if (!(width > 0)) return "Set a Breadth over 0 for the column's diameter.";
    return Array.from({ length: CIRCLE_STEPS }, (_, i) => at((width / 2) * Math.cos((2 * Math.PI * i) / CIRCLE_STEPS), (width / 2) * Math.sin((2 * Math.PI * i) / CIRCLE_STEPS)));
  }
  if (!(depth > 0 && width > 0)) return "Set a Depth and Breadth over 0.";
  return [at(-width / 2, -depth / 2), at(width / 2, -depth / 2), at(width / 2, depth / 2), at(-width / 2, depth / 2)];
}

/**
 * A member `breadth` wide along `path` (two or more points, open): its body's edges cut at its ends
 * and its caps and centre marks, or why it can't be drawn.
 */
export function linearMember(path: readonly Pt[], breadth: number, m: LinearMember): MemberPlan | string {
  const pts: Pt[] = [];
  for (const p of path) if (!pts.length || dist(pts[pts.length - 1], p) > 1e-6) pts.push(p);
  if (pts.length < 2) return "Click two points apart for the member.";
  if (!(breadth > 0)) return "Set the member's Breadth over 0.";
  if (Math.abs(m.startMiter) > MAX_MEMBER_MITER || Math.abs(m.endMiter) > MAX_MEMBER_MITER) return `Keep the miters within ${MAX_MEMBER_MITER}° of square.`;
  const n = pts.length;
  const u0 = unit(pts[0], pts[1]);
  const u1 = unit(pts[n - 2], pts[n - 1]);
  // the path run on (or cut back) at its ends
  pts[0] = at(pts[0].x - u0.x * m.startOffset, pts[0].y - u0.y * m.startOffset);
  pts[n - 1] = at(pts[n - 1].x + u1.x * m.endOffset, pts[n - 1].y + u1.y * m.endOffset);
  // its first and last stretches still run the way they were clicked
  const forward = (q: readonly Pt[]): boolean => dot(q[0], q[1], u0) > 0 && dot(q[n - 2], q[n - 1], u1) > 0;
  if (!forward(pts)) return "The end offsets leave nothing of the member.";
  // the body's middle, left of the path by the alignment and offset
  const middle = (m.align === "left" ? -breadth / 2 : m.align === "right" ? breadth / 2 : 0) + m.offset;
  const half = breadth / 2;
  const left = offsetPolyline(pts, false, middle + half);
  const right = offsetPolyline(pts, false, middle - half);
  const centre = offsetPolyline(pts, false, middle);
  if (!left || !right || !centre || left.length !== n || right.length !== n || centre.length !== n) return "The member's path turns back on itself too tightly for its breadth.";
  const ts = Math.tan((m.startMiter * Math.PI) / 180);
  const te = Math.tan((m.endMiter * Math.PI) / 180);
  // each edge's ends slide along the path by how far it lies left of the middle times the miter's tangent
  const cut = (edge: Pt[], across: number): Pt[] | null => {
    const out = [...edge];
    out[0] = at(edge[0].x - u0.x * across * ts, edge[0].y - u0.y * across * ts);
    out[n - 1] = at(edge[n - 1].x + u1.x * across * te, edge[n - 1].y + u1.y * across * te);
    return forward(out) ? out : null;
  };
  const l = cut(left, half);
  const r = cut(right, -half);
  if (!l || !r) return "The miters cross: make the member longer or its miters smaller.";
  const caps = [...(m.startCap ? [[l[0], r[0]]] : []), ...(m.endCap ? [[l[n - 1], r[n - 1]]] : [])];
  const marks: Pt[][] = [];
  if (m.mark && m.mark.length > 0) {
    const { length, gap } = m.mark;
    const s = centre[0];
    const e = centre[n - 1];
    marks.push([at(s.x - u0.x * gap, s.y - u0.y * gap), at(s.x - u0.x * (gap + length), s.y - u0.y * (gap + length))]);
    marks.push([at(e.x + u1.x * gap, e.y + u1.y * gap), at(e.x + u1.x * (gap + length), e.y + u1.y * (gap + length))]);
  }
  return { body: [...l, ...[...r].reverse()], left: l, right: r, caps, marks };
}

function unit(a: Pt, b: Pt): Pt {
  const d = dist(a, b);
  return at((b.x - a.x) / d, (b.y - a.y) / d);
}

/** how far `b` lies past `a` along `u` */
function dot(a: Pt, b: Pt, u: Pt): number {
  return (b.x - a.x) * u.x + (b.y - a.y) * u.y;
}
