// What the HopOver tool (tools/hopOver.ts) makes of a line: a half-circle hop where it crosses another,
// as ConnectCAD draws one on a circuit that has priority. The hop is three vertices put into the
// line's straight piece there: a corner a radius before the crossing, a point the arc passes through
// a radius off it, and a corner a radius after, so the hop stays a true arc. A line or open polygon
// comes back as a polyline; a polyline keeps its other vertices as they were. Kept apart from the
// tool so it runs without the page.

import type { NewShape, Pt, Shape, VertexKind } from "../core/index.ts";

export interface HopVertex {
  readonly p: Pt;
  readonly kind: VertexKind;
  readonly radius: number;
}

/** A straight piece of the line: from vertex `i` to the next. */
export interface HopPiece {
  readonly i: number;
  readonly a: Pt;
  readonly b: Pt;
}

const EPS = 1e-9;

/** The vertices of a line, open polygon or open polyline, as a hop rebuilds it; null for anything else. */
export function hopVertices(shape: Shape): HopVertex[] | null {
  const corner = (p: Pt): HopVertex => ({ p, kind: "corner", radius: 0 });
  if (shape.kind === "line" && shape.points.length === 2) return shape.points.map(corner);
  if (shape.closed) return null;
  if (shape.kind === "polygon") return shape.points.length >= 2 ? shape.points.map(corner) : null;
  if (shape.kind !== "polyline") return null;
  const v = shape.vertices;
  if (!v || v.length < 2) return shape.points.length >= 2 ? shape.points.map(corner) : null;
  // an open polyline's ends are corners whatever their kind
  return v.map((x, k) => (k === 0 || k === v.length - 1 ? corner(x.p) : { p: x.p, kind: x.kind, radius: x.radius }));
}

/** The straight pieces: between two corners, each long enough to have a direction. */
export function straightPieces(verts: readonly HopVertex[]): HopPiece[] {
  const out: HopPiece[] = [];
  for (let i = 0; i + 1 < verts.length; i++) {
    const [a, b] = [verts[i], verts[i + 1]];
    if (a.kind === "corner" && b.kind === "corner" && Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > EPS) out.push({ i, a: a.p, b: b.p });
  }
  return out;
}

/** How far `p` lies from the piece from `a` to `b`. */
export function distanceToPiece(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The hop's three points over `at` on `piece`, rising up the screen (or left on an upright piece) unless `down`. */
export function hopPoints(piece: HopPiece, at: Pt, radius: number, down: boolean): [Pt, Pt, Pt] {
  const len = Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y);
  const d = { x: (piece.b.x - piece.a.x) / len, y: (piece.b.y - piece.a.y) / len };
  let n = { x: -d.y, y: d.x };
  const up = n.y > EPS || (Math.abs(n.y) <= EPS && n.x < 0);
  if (up === down) n = { x: -n.x, y: -n.y };
  return [
    { x: at.x - radius * d.x, y: at.y - radius * d.y },
    { x: at.x + radius * n.x, y: at.y + radius * n.y },
    { x: at.x + radius * d.x, y: at.y + radius * d.y },
  ];
}

/** Why a hop can't go over `at` on `piece`, or "" when it can: it must keep clear of the piece's ends. */
export function hopRefusal(piece: HopPiece, at: Pt, radius: number): string {
  const fromA = Math.hypot(at.x - piece.a.x, at.y - piece.a.y);
  const fromB = Math.hypot(at.x - piece.b.x, at.y - piece.b.y);
  return Math.min(fromA, fromB) < radius - EPS ? "The crossing is too near the end of the line's straight piece for a hop that size." : "";
}

/** The line rebuilt as a polyline with the hop put into `piece`. */
export function withHop(verts: readonly HopVertex[], piece: HopPiece, hop: readonly [Pt, Pt, Pt]): NewShape {
  const added: HopVertex[] = [
    { p: hop[0], kind: "corner", radius: 0 },
    { p: hop[1], kind: "through", radius: 0 },
    { p: hop[2], kind: "corner", radius: 0 },
  ];
  const all = [...verts.slice(0, piece.i + 1), ...added, ...verts.slice(piece.i + 1)];
  return { kind: "polyline", points: all.map((v) => v.p), closed: false, vertices: all.map((v) => v.kind), radii: all.map((v) => v.radius) };
}

/** Points along the hop's half circle, for showing it before the click. */
export function hopArc(hop: readonly [Pt, Pt, Pt], steps = 16): Pt[] {
  const c = { x: (hop[0].x + hop[2].x) / 2, y: (hop[0].y + hop[2].y) / 2 };
  const u = { x: hop[0].x - c.x, y: hop[0].y - c.y };
  const v = { x: hop[1].x - c.x, y: hop[1].y - c.y };
  return Array.from({ length: steps + 1 }, (_, k) => {
    const a = (k / steps) * Math.PI;
    return { x: c.x + u.x * Math.cos(a) + v.x * Math.sin(a), y: c.y + u.y * Math.cos(a) + v.y * Math.sin(a) };
  });
}
