// The sums behind ConnectCAD's ReRoute Circuits tool (tools.ts, schematic.ts): circuits re-routed to
// follow a reference circuit's run, the bus. Each joins the bus square from its source's stub, runs
// along it and leaves it square to its destination's; bussed, they share the run (breakout nodes
// marking where each joins and leaves), or each runs a fixed distance from the last, those on one side
// of the bus one way and those on the other the other, nearest first. Kept apart so it runs without
// the page.

import type { Pt } from "../../../core/index.ts";
import type { End } from "./ccadShapes.ts";

const EPS = 1e-9;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Pt): Pt => {
  const n = Math.hypot(v.x, v.y);
  return n < EPS ? { x: 1, y: 0 } : { x: v.x / n, y: v.y / n };
};
/** the normal on a run's left */
const left = (d: Pt): Pt => ({ x: -d.y, y: d.x });

/** A path without its repeated points. */
const distinct = (points: readonly Pt[]): Pt[] => points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > EPS);

/** The point of a path nearest `p`: where, on which piece (from 0), and how far along the path. */
export function nearestOn(points: readonly Pt[], p: Pt): { at: Pt; piece: number; along: number; distance: number } {
  let best = { at: points[0], piece: 0, along: 0, distance: Math.hypot(p.x - points[0].x, p.y - points[0].y) };
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const d = sub(points[i], a);
    const len = Math.hypot(d.x, d.y);
    const t = len < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (len * len)));
    const at = { x: a.x + d.x * t, y: a.y + d.y * t };
    const distance = Math.hypot(p.x - at.x, p.y - at.y);
    if (distance < best.distance - EPS) best = { at, piece: i - 1, along: run + t * len, distance };
    run += len;
  }
  return best;
}

/** Which side of a path a point is: 1 on its left, -1 on its right (0 on it), by the piece nearest it. */
export function sideOf(points: readonly Pt[], p: Pt): number {
  const path = distinct(points);
  if (path.length < 2) return 0;
  const near = nearestOn(path, p);
  const d = sub(path[near.piece + 1], path[near.piece]);
  const cross = d.x * (p.y - near.at.y) - d.y * (p.x - near.at.x);
  return Math.abs(cross) < EPS ? 0 : Math.sign(cross);
}

/** A path moved `by` to its left (to its right when negative), its corners mitred. */
export function offsetPath(points: readonly Pt[], by: number): Pt[] {
  const path = distinct(points);
  if (path.length < 2 || Math.abs(by) < EPS) return path;
  const normals = path.slice(1).map((p, i) => left(unit(sub(p, path[i]))));
  return path.map((p, i) => {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    const dot = a.x * b.x + a.y * b.y;
    // a turn back on itself can't be mitred: out square to the piece before
    const k = 1 + dot < 1e-6 ? 1 : 1 / (1 + dot);
    const m = 1 + dot < 1e-6 ? a : { x: (a.x + b.x) * k, y: (a.y + b.y) * k };
    return { x: p.x + m.x * by, y: p.y + m.y * by };
  });
}

const horizontal = (v: Pt): boolean => Math.abs(v.x) >= Math.abs(v.y);

/**
 * The corners of a circuit from `source` to `destination` (their socket ends) re-routed along `bus`,
 * stubs of `stub`: square from its source's stub onto the bus where it's nearest, along it, and square
 * off it to its destination's stub where that's nearest; and the two points it joins and leaves the
 * bus, for breakout nodes.
 */
export function busCorners(bus: readonly Pt[], source: End, destination: End, stub: number): { corners: Pt[]; nodes: [Pt, Pt] } {
  const path = distinct(bus);
  const s1 = { x: source.tip.x + source.out.x * stub, y: source.tip.y + source.out.y * stub };
  const d1 = { x: destination.tip.x + destination.out.x * stub, y: destination.tip.y + destination.out.y * stub };
  const on = nearestOn(path, s1);
  const off = nearestOn(path, d1);
  // the bus's corners between, in the way the circuit runs
  const between = on.along <= off.along ? path.slice(on.piece + 1, off.piece + 1) : path.slice(off.piece + 1, on.piece + 1).reverse();
  const square = (from: Pt, out: Pt, to: Pt): Pt => (horizontal(out) ? { x: to.x, y: from.y } : { x: from.x, y: to.y });
  const corners = [square(s1, source.out, on.at), on.at, ...between, off.at, square(d1, destination.out, off.at)];
  return { corners: distinct(corners), nodes: [on.at, off.at] };
}

/**
 * How far from the bus each circuit runs, in steps of the distance between: those whose sources are on
 * the bus's left take 1, 2…, those on its right -1, -2…, nearest the bus first (so they don't cross).
 */
export function busSteps(bus: readonly Pt[], sources: readonly Pt[]): number[] {
  const path = distinct(bus);
  const facts = sources.map((p, i) => ({ i, side: sideOf(path, p) || 1, distance: nearestOn(path, p).distance }));
  const steps = new Array<number>(sources.length).fill(0);
  for (const side of [1, -1]) {
    facts
      .filter((f) => f.side === side)
      .sort((a, b) => a.distance - b.distance || a.i - b.i)
      .forEach((f, n) => (steps[f.i] = side * (n + 1)));
  }
  return steps;
}
