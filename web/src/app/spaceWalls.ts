// Create Walls from Spaces' geometry: which stretches of spaces' edges are between two spaces (one
// interior wall) and which run round the outside (exterior walls, in loops), and where each wall
// goes for how it's aligned. Kept apart from the command so it runs without the page. Sizes are in mm.

import type { Pt } from "../core/index.ts";
import { signedArea } from "./geom.ts";

/** where an exterior wall's sides lie across its control line, left of it positive: right, then left */
export type WallFaces = readonly [number, number];
export type ExteriorAlign = "outer" | "inner" | "centre" | "control";

export interface WallLine {
  readonly a: Pt;
  readonly b: Pt;
}

export interface SpaceWalls {
  /** each loop's walls in order, each meeting the next, a closed loop's last meeting its first */
  readonly exterior: readonly { readonly walls: readonly WallLine[]; readonly closed: boolean }[];
  /** the walls between spaces, the longest first, to run up to the walls they meet */
  readonly interior: readonly WallLine[];
}

/** points this close are the same point, and edges this close the same edge */
const TOL = 1;

const near = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= TOL;
const len = (s: WallLine): number => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
const unit = (s: WallLine): Pt => {
  const l = len(s);
  return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l };
};
const along = (s: WallLine, t: number): Pt => {
  const u = unit(s);
  return { x: s.a.x + u.x * t, y: s.a.y + u.y * t };
};
/** Square with `s` and on its line: `q`'s way along it, or null when it's off the line. */
function onLine(s: WallLine, q: Pt): number | null {
  const u = unit(s);
  const dx = q.x - s.a.x;
  const dy = q.y - s.a.y;
  return Math.abs(dx * u.y - dy * u.x) <= TOL ? dx * u.x + dy * u.y : null;
}

/** The control line's way out from the edge, along the outside, for how the wall's aligned to it. */
export function controlOffset(faces: WallFaces, align: ExteriorAlign): number {
  if (align === "outer") return faces[0];
  if (align === "inner") return faces[1];
  return align === "centre" ? (faces[0] + faces[1]) / 2 : 0;
}

const shifted = (s: WallLine, d: number): WallLine => {
  const u = unit(s);
  // outside is right of a counter-clockwise edge
  const n = { x: u.y, y: -u.x };
  return { a: { x: s.a.x + n.x * d, y: s.a.y + n.y * d }, b: { x: s.b.x + n.x * d, y: s.b.y + n.y * d } };
};

/** Where two lines cross; null when they run together. */
function crossing(p: WallLine, q: WallLine): Pt | null {
  const u = unit(p);
  const v = unit(q);
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q.a.x - p.a.x) * v.y - (q.a.y - p.a.y) * v.x) / den;
  return { x: p.a.x + u.x * t, y: p.a.y + u.y * t };
}

interface Piece extends WallLine {
  /** the outline it's from */
  readonly owner: number;
  /** for a shared piece, the lowest outline on its other side */
  readonly other: number | null;
}

/** An edge cut where other spaces' edges start and stop along it. */
function piecesOf(edge: WallLine, owner: number, outlines: readonly (readonly Pt[])[]): Piece[] {
  const covers: { from: number; to: number; by: number }[] = [];
  const length = len(edge);
  const u = unit(edge);
  outlines.forEach((outline, by) => {
    if (by === owner) return;
    outline.forEach((c, i) => {
      const d = outline[(i + 1) % outline.length];
      const tc = onLine(edge, c);
      const td = onLine(edge, d);
      if (tc === null || td === null) return;
      // the other space's edge runs the other way, with that space on the far side
      if ((d.x - c.x) * u.x + (d.y - c.y) * u.y >= 0) return;
      const from = Math.max(0, Math.min(tc, td));
      const to = Math.min(length, Math.max(tc, td));
      if (to - from > TOL) covers.push({ from, to, by });
    });
  });
  const cuts = [...new Set([0, length, ...covers.flatMap((c) => [c.from, c.to])])].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [from, to] = [cuts[i], cuts[i + 1]];
    if (to - from <= TOL) continue;
    const mid = (from + to) / 2;
    const over = covers.filter((c) => c.from <= mid && mid <= c.to).map((c) => c.by);
    out.push({ a: along(edge, from), b: along(edge, to), owner, other: over.length ? Math.min(...over) : null });
  }
  return out;
}

/** Interior walls running straight on from each other as one. */
function combined(lines: WallLine[]): WallLine[] {
  const out = [...lines];
  for (let i = 0; i < out.length; i++) {
    for (let j = out.length - 1; j > i; j--) {
      const p = out[i];
      const q = out[j];
      const ta = onLine(p, q.a);
      const tb = onLine(p, q.b);
      if (ta === null || tb === null) continue;
      const from = Math.min(ta, tb);
      const to = Math.max(ta, tb);
      const length = len(p);
      if (from > length + TOL || to < -TOL) continue;
      out[i] = { a: along(p, Math.min(0, from)), b: along(p, Math.max(length, to)) };
      out.splice(j, 1);
      j = out.length;
    }
  }
  return out;
}

/** The walls for these outlines, exterior ones placed for `align`, interior ones centred on their edges. */
export function spaceWalls(outlines: readonly (readonly Pt[])[], exterior: WallFaces, interior: WallFaces, align: ExteriorAlign, combine: boolean): SpaceWalls {
  const rings = outlines.map((o) => (signedArea(o) > 0 ? o : [...o].reverse()));
  const pieces = rings.flatMap((ring, owner) =>
    ring.flatMap((p, i) => {
      const edge = { a: p, b: ring[(i + 1) % ring.length] };
      return len(edge) > TOL ? piecesOf(edge, owner, rings) : [];
    }),
  );
  const shared = pieces.filter((p) => p.other !== null && p.owner < p.other).map((p): WallLine => ({ a: p.a, b: p.b }));
  const free = pieces.filter((p) => p.other === null);
  // follow the outside round, across spaces, into loops
  const used = new Set<Piece>();
  const loops: { lines: WallLine[]; closed: boolean }[] = [];
  for (const start of free) {
    if (used.has(start)) continue;
    const lines: WallLine[] = [];
    let at: Piece | undefined = start;
    let closed = false;
    while (at && !used.has(at)) {
      used.add(at);
      const last = lines.at(-1);
      // straight on is the same wall
      if (last && onLine(last, at.b) !== null) lines[lines.length - 1] = { a: last.a, b: at.b };
      else lines.push({ a: at.a, b: at.b });
      const end: Pt = at.b;
      const next: Piece | undefined = free.find((q) => near(q.a, end) && !used.has(q));
      if (!next) closed = near(end, start.a);
      at = next;
    }
    if (closed && lines.length > 1 && onLine(lines[0], lines[lines.length - 1].a) !== null) {
      lines[0] = { a: lines[lines.length - 1].a, b: lines[0].b };
      lines.pop();
    }
    loops.push({ lines, closed });
  }
  const offset = controlOffset(exterior, align);
  const placed = loops.map(({ lines, closed }) => {
    const out = lines.map((l) => shifted(l, offset));
    const n = out.length;
    const walls = out.map((w, i): WallLine => {
      const before = i > 0 || closed ? out[(i + n - 1) % n] : null;
      const after = i < n - 1 || closed ? out[(i + 1) % n] : null;
      return { a: (before && crossing(before, w)) ?? w.a, b: (after && crossing(w, after)) ?? w.b };
    });
    return { walls, closed };
  });
  const inner = (combine ? combined(shared) : shared).map((l) => shifted(l, controlOffset(interior, "centre")));
  return { exterior: placed, interior: inner.sort((p, q) => len(q) - len(p)) };
}

/** A wall's end carried on along its line to `other`'s control line, for a tee; null when they don't meet. */
export function meetLine(wall: WallLine, end: "a" | "b", other: WallLine, reach: number): Pt | null {
  const p = crossing(wall, other);
  if (!p) return null;
  const was = wall[end];
  if (Math.hypot(p.x - was.x, p.y - was.y) > reach) return null;
  const t = onLine(other, p);
  return t !== null && t >= -TOL && t <= len(other) + TOL ? p : null;
}
