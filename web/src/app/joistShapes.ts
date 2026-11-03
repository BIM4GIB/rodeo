// Create Joists' sums (createJoists.ts draws them): a floor's outline framed by members round its
// edge and joists across it, each opening in it ringed by headers. Plain data in and out, lengths in
// mm, heights above the layer.

import type { Pt } from "../core/index.ts";
import { intersectLines, signedArea } from "./geom.ts";

export type EndCondition = "inside" | "centre" | "outside";
export type CornerCondition = "lapped" | "mitred";

export interface MemberSize {
  readonly width: number;
  readonly height: number;
  /** its top, above the layer */
  readonly top: number;
}

export interface JoistSpec {
  readonly joists: (MemberSize & { readonly spacing: number }) | null;
  readonly perimeter: MemberSize | null;
  /** where the joists stop at the perimeter's members and at the headers */
  readonly end: EndCondition;
  readonly corner: CornerCondition;
}

export type MemberKind = "joist" | "perimeter" | "header";

export interface Member {
  readonly kind: MemberKind;
  readonly outline: Pt[];
  /** along its middle, end to end */
  readonly centre: [Pt, Pt];
  readonly width: number;
  readonly height: number;
  readonly top: number;
  /** its longest side */
  readonly length: number;
}

const EPS = 1e-6;
const at = (x: number, y: number): Pt => ({ x, y });
const plus = (p: Pt, d: Pt, k: number): Pt => at(p.x + d.x * k, p.y + d.y * k);
const mid = (a: Pt, b: Pt): Pt => at((a.x + b.x) / 2, (a.y + b.y) / 2);
const len = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
const dirOf = (a: Pt, b: Pt): Pt => {
  const l = len(a, b);
  return at((b.x - a.x) / l, (b.y - a.y) / l);
};
const leftOf = (d: Pt): Pt => at(-d.y, d.x);

/** The ring without repeats, the way round asked for. */
function wound(ring: readonly Pt[], ccw: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) if (!out.length || len(out[out.length - 1], p) > EPS) out.push(p);
  while (out.length > 1 && len(out[0], out[out.length - 1]) <= EPS) out.pop();
  return signedArea(out) > 0 === ccw ? out : out.reverse();
}

/** Each corner moved `d` to the left of the edges either side (inward, round a counter-clockwise ring). */
export function insetRing(ring: readonly Pt[], d: number): Pt[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const [prev, next] = [ring[(i + n - 1) % n], ring[(i + 1) % n]];
    const [du, dv] = [dirOf(prev, p), dirOf(p, next)];
    const meet = intersectLines(plus(prev, leftOf(du), d), du, plus(p, leftOf(dv), d), dv);
    return meet ?? plus(p, leftOf(dv), d);
  });
}

/** Which of two edges meeting at a corner runs through it, by index. */
type Through = (a: number, b: number) => number;

/**
 * Members `size.width` deep to the left of each edge of `ring` (counter-clockwise for a floor's edge,
 * clockwise round an opening): their corners mitred, or lapped with the edge `through` picks running
 * on to the corner and the other stopping at its face.
 */
function bandMembers(ring: readonly Pt[], kind: MemberKind, size: MemberSize, corner: CornerCondition, through: Through): Member[] {
  const n = ring.length;
  const inner = insetRing(ring, size.width);
  const dirs = ring.map((p, i) => dirOf(p, ring[(i + 1) % n]));
  const outerLine = (i: number): [Pt, Pt] => [ring[(i + n) % n], dirs[(i + n) % n]];
  const innerLine = (i: number): [Pt, Pt] => [inner[(i + n) % n], dirs[(i + n) % n]];
  const meet = (a: [Pt, Pt], b: [Pt, Pt], fallback: Pt): Pt => intersectLines(a[0], a[1], b[0], b[1]) ?? fallback;
  // at a corner the member running through reaches the farther of the other's faces, and the other stops at the nearer of its
  const reach = (p: Pt, q: Pt, d: Pt, far: boolean): Pt => ((q.x - p.x) * d.x + (q.y - p.y) * d.y > 0 === far ? q : p);
  const out: Member[] = [];
  for (let i = 0; i < n; i++) {
    const [h, j] = [(i + n - 1) % n, (i + 1) % n];
    let [so, si, eo, ei] = [ring[i], inner[i], ring[j], inner[j]];
    if (corner === "lapped") {
      const [back, on] = [at(-dirs[i].x, -dirs[i].y), dirs[i]];
      const [first, last] = [through(h, i) === i, through(i, j) === i];
      so = reach(ring[i], meet(outerLine(i), innerLine(h), so), back, first);
      si = reach(meet(innerLine(i), outerLine(h), si), inner[i], back, first);
      eo = reach(ring[j], meet(outerLine(i), innerLine(j), eo), on, last);
      ei = reach(meet(innerLine(i), outerLine(j), ei), inner[j], on, last);
    }
    const outline = [so, eo, ei, si];
    if (Math.abs(signedArea(outline)) <= EPS) continue;
    out.push({ kind, outline, centre: [mid(so, si), mid(eo, ei)], width: size.width, height: size.height, top: size.top, length: Math.max(len(so, eo), len(si, ei)) });
  }
  return out;
}

/** A stretch of a line inside an area, and the edges it crosses at its ends. */
interface Stretch {
  readonly s0: number;
  readonly s1: number;
  readonly e0: readonly [Pt, Pt];
  readonly e1: readonly [Pt, Pt];
}

/** Where the line `o + s·u` is inside the rings (the first round the outside, the rest round holes), as stretches of s. */
function spans(o: Pt, u: Pt, rings: readonly (readonly Pt[])[]): Stretch[] {
  const side = (p: Pt): boolean => u.x * (p.y - o.y) - u.y * (p.x - o.x) >= 0;
  const hits: { s: number; edge: [Pt, Pt] }[] = [];
  for (const ring of rings)
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      if (side(p) === side(q)) return;
      const [dx, dy] = [q.x - p.x, q.y - p.y];
      const den = u.x * dy - u.y * dx;
      if (Math.abs(den) < 1e-12) return;
      hits.push({ s: ((p.x - o.x) * dy - (p.y - o.y) * dx) / den, edge: [p, q] });
    });
  hits.sort((x, y) => x.s - y.s);
  const out: Stretch[] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) out.push({ s0: hits[i].s, s1: hits[i + 1].s, e0: hits[i].edge, e1: hits[i + 1].edge });
  return out;
}

const overlaps = (a: readonly Stretch[], b: readonly Stretch[]): [number, number][] =>
  a.flatMap((x) => b.map((y): [number, number] => [Math.max(x.s0, y.s0), Math.min(x.s1, y.s1)]).filter(([s0, s1]) => s1 - s0 > EPS));

/** Where the line `o + s·u` meets an edge's line. */
const cutAt = (o: Pt, u: Pt, edge: readonly [Pt, Pt]): Pt | null => intersectLines(o, u, edge[0], dirOf(edge[0], edge[1]));

/**
 * A floor's framing: its outline, the openings in it, and the line its joists run along (a to b),
 * from which they're laid out the spacing apart either way. A joist goes wherever both its sides stay
 * on the floor clear of the perimeter's members and the headers, and runs on to the end condition's
 * face, cut to it. Members, or why there are none.
 */
export function joistFraming(outline: readonly Pt[], openings: readonly (readonly Pt[])[], a: Pt, b: Pt, spec: JoistSpec): Member[] | string {
  const ring = wound(outline, true);
  if (ring.length < 3 || Math.abs(signedArea(ring)) <= EPS) return "Select a closed shape to frame.";
  if (!spec.joists && !spec.perimeter) return "Choose Draw Joists, Draw Perimeter Framing Members or both.";
  const holes = openings.map((h) => wound(h, false)).filter((h) => h.length >= 3);
  const u = len(a, b) > EPS ? dirOf(a, b) : null;
  if (spec.joists && !u) return "Click two points apart for the joists' direction.";
  // rim members across the joists run through their corners, and round an opening the trimmers alongside them
  const across = (d: Pt): boolean => !!u && Math.abs(d.x * u.y - d.y * u.x) >= Math.abs(d.x * u.x + d.y * u.y);
  const picker = (r: readonly Pt[], runAcross: boolean): Through => {
    const n = r.length;
    const d = (i: number): Pt => dirOf(r[i], r[(i + 1) % n]);
    const l = (i: number): number => len(r[i], r[(i + 1) % n]);
    return (i, j) => {
      const [ai, aj] = [across(d(i)) === runAcross, across(d(j)) === runAcross];
      if (u && ai !== aj) return ai ? i : j;
      return l(i) > l(j) + EPS ? i : j;
    };
  };
  const members: Member[] = [];
  if (spec.perimeter) members.push(...bandMembers(ring, "perimeter", spec.perimeter, spec.corner, picker(ring, true)));
  const j = spec.joists;
  if (j) {
    if (!(j.width > 0) || !(j.height > 0)) return "Give the joists a Width and Height over 0.";
    if (!(j.spacing > j.width)) return "Set a Center-to-Center Spacing wider than a joist.";
    for (const h of holes) members.push(...bandMembers(h, "header", j, spec.corner, picker(h, false)));
  }
  if (!j || !u) return members.length ? members : "Nothing to frame.";
  const pw = spec.perimeter?.width ?? 0;
  const endBy = (w: number): number => (spec.end === "inside" ? w : spec.end === "centre" ? w / 2 : 0);
  const fit = [pw ? insetRing(ring, pw) : ring, ...holes.map((h) => insetRing(h, j.width))];
  const end = [pw ? insetRing(ring, endBy(pw)) : ring, ...holes.map((h) => insetRing(h, endBy(j.width)))];
  const n = leftOf(u);
  const across0 = ring.map((p) => (p.x - a.x) * n.x + (p.y - a.y) * n.y);
  const [t0, t1] = [Math.min(...across0), Math.max(...across0)];
  const half = j.width / 2;
  const tiny = Math.min(half / 100, 0.01);
  for (let k = Math.ceil(t0 / j.spacing); k * j.spacing <= t1; k++) {
    const t = k * j.spacing;
    const line = plus(a, n, t);
    const room = overlaps(spans(plus(line, n, -half + tiny), u, fit), spans(plus(line, n, half - tiny), u, fit));
    if (!room.length) continue;
    const runs = spans(line, u, end);
    const [right, left] = [plus(line, n, -half), plus(line, n, half)];
    const used = new Set<Stretch>();
    for (const [r0, r1] of room) {
      const m = (r0 + r1) / 2;
      const run = runs.find((r) => r.s0 <= m && m <= r.s1);
      if (!run || used.has(run)) continue;
      used.add(run);
      // each end cut along the edge its middle reaches
      const corners = [cutAt(right, u, run.e0), cutAt(right, u, run.e1), cutAt(left, u, run.e1), cutAt(left, u, run.e0)];
      if (corners.some((c) => !c)) continue;
      const outline = corners as Pt[];
      const length = Math.max(len(outline[0], outline[1]), len(outline[3], outline[2]));
      members.push({ kind: "joist", outline, centre: [plus(line, u, run.s0), plus(line, u, run.s1)], width: j.width, height: j.height, top: j.top, length });
    }
  }
  return members.length ? members : "The joists don't fit: make the spacing smaller or the floor bigger.";
}

export interface TakeOffRow {
  readonly kind: MemberKind;
  readonly width: number;
  readonly height: number;
  readonly length: number;
  readonly count: number;
}

/** Members alike in kind, section and length (to the mm), counted, longest first in each kind. */
export function takeOff(members: readonly Member[]): TakeOffRow[] {
  const order: MemberKind[] = ["joist", "perimeter", "header"];
  const rows = new Map<string, TakeOffRow>();
  for (const m of members) {
    const length = Math.round(m.length);
    const key = [m.kind, m.width, m.height, length].join("|");
    const was = rows.get(key);
    rows.set(key, { kind: m.kind, width: m.width, height: m.height, length, count: (was?.count ?? 0) + 1 });
  }
  return [...rows.values()].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || y.length - x.length);
}
