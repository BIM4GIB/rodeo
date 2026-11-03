// What the Basic palette's Triangle and Quarter Arc tools draw (tools/triangle.ts,
// tools/quarterArc.ts), as plain geometry. Kept apart from the tools so it runs without the page.

import type { NewShape, Pt, VertexKind } from "../core/index.ts";
import { dist } from "./geom.ts";

export type TriangleMode = "sides" | "sidesAngle" | "anglesSide";

/** points along a quarter ellipse, ends included */
const ELLIPSE_POINTS = 13;
/** across and up-and-down this close (as a share) make a circular arc */
const CIRCULAR = 1e-6;

/**
 * The third corner of the triangle on side `a`→`b` to its left (`left`) or right: Three Sides
 * takes the second side (from `b`) and third (from `a`); Two Sides and Included Angle the second
 * side and the angle between it and the first at `b`, degrees; Two Angles and Common Side the
 * angles at `a` and `b`. A string says why there is none, as Vectorworks says it.
 */
export function triangleApex(mode: TriangleMode, a: Pt, b: Pt, first: number, second: number, left: boolean): Pt | string {
  const len = dist(a, b);
  if (!(len > 0)) return "Click two different points for the first side.";
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = left ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
  // a point `d` from `from` at `angle` radians off the way `dir` runs (along the first side), turned toward the chosen side
  const off = (from: Pt, dir: Pt, angle: number, d: number): Pt => ({
    x: from.x + d * (Math.cos(angle) * dir.x + Math.sin(angle) * n.x),
    y: from.y + d * (Math.cos(angle) * dir.y + Math.sin(angle) * n.y),
  });
  const back = { x: -u.x, y: -u.y };
  if (mode === "sides") {
    const [s2, s3] = [first, second];
    if (!(s2 > 0 && s3 > 0) || !(len + s2 > s3 && len + s3 > s2 && s2 + s3 > len)) return "The sum of the lengths of any two sides of the triangle must be greater than the remaining side.";
    const cos = (len * len + s3 * s3 - s2 * s2) / (2 * len * s3);
    return off(a, u, Math.acos(Math.max(-1, Math.min(1, cos))), s3);
  }
  if (mode === "sidesAngle") {
    if (!(first > 0)) return "Enter a second side longer than 0.";
    if (!(second > 0 && second < 180)) return "The angle must be less than 180 degrees.";
    return off(b, back, (second * Math.PI) / 180, first);
  }
  if (!(first > 0 && second > 0) || !(first + second < 180)) return "The sum of the two angles must be less than 180 degrees.";
  const alpha = (first * Math.PI) / 180;
  const beta = (second * Math.PI) / 180;
  return off(a, u, alpha, (len * Math.sin(beta)) / Math.sin(alpha + beta));
}

/**
 * The quarter arc from `s` to `e` as a polyline, leaving `s` across (`across`) or up and down;
 * null when they don't differ both ways.
 */
export function quarterArc(s: Pt, e: Pt, across: boolean): Extract<NewShape, { kind: "polyline" }> | null {
  const rx = Math.abs(e.x - s.x);
  const ry = Math.abs(e.y - s.y);
  if (!(rx > 0 && ry > 0)) return null;
  // where the tangents at the ends meet, and the ellipse's centre across from it
  const corner = across ? { x: e.x, y: s.y } : { x: s.x, y: e.y };
  if (Math.abs(rx - ry) <= CIRCULAR * Math.max(rx, ry)) return { kind: "polyline", points: [s, corner, e], closed: false, vertices: ["corner", "arc", "corner"] };
  const c = across ? { x: s.x, y: e.y } : { x: e.x, y: s.y };
  const points: Pt[] = [];
  for (let k = 0; k < ELLIPSE_POINTS; k++) {
    const t = ((Math.PI / 2) * k) / (ELLIPSE_POINTS - 1);
    // from the start's side of the centre round to the end's
    const fromStart = { x: s.x - c.x, y: s.y - c.y };
    const toEnd = { x: e.x - c.x, y: e.y - c.y };
    points.push({ x: c.x + fromStart.x * Math.cos(t) + toEnd.x * Math.sin(t), y: c.y + fromStart.y * Math.cos(t) + toEnd.y * Math.sin(t) });
  }
  const vertices: VertexKind[] = points.map((_, k) => (k === 0 || k === ELLIPSE_POINTS - 1 ? "corner" : "cubic"));
  return { kind: "polyline", points, closed: false, vertices };
}
