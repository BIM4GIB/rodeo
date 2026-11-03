// What Machine Components' Torsion Spring - Front and Torsion Spring - End tools (tools/machine.ts)
// draw, as plain geometry in mm. From the front, the close-wound coils run right from the origin
// along their axis (springShapes.ts draws them) and each end's leg is a straight band of wire
// across the axis at its end coil, up or down to its length from the axis: leaving the coils' side,
// or crossing in front of them or behind them from their far side. From the end, the coils are a
// ring round the origin and each end is a leg leaving it on a tangent at its deflection, out to its
// length from the centre, then bent a quarter, half or three-quarter turn and on its bend length,
// or curled into a full loop. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { MAX_COILS, springDrawing, type SpringDisplay, type SpringDrawing } from "./springShapes.ts";

/** A leg's band: its outline without the end it leaves the coils at (so it runs into them), and its area to fill. */
export interface Leg {
  readonly outline: Pt[];
  readonly fill: Pt[];
}

export type LegDirection = "up" | "down";
export type LegOrientation = "normal" | "forward" | "rearward";

export interface FrontLeg {
  /** from the coils' axis to its tip */
  readonly length: number;
  readonly direction: LegDirection;
  readonly orientation: LegOrientation;
}

export interface TorsionFront {
  readonly outside: number;
  readonly wire: number;
  readonly coils: number;
  readonly left: FrontLeg | null;
  readonly right: FrontLeg | null;
  readonly leftHand: boolean;
}

export interface TorsionFrontDrawing {
  /** legs behind the coils, drawn first so the coils cover them */
  readonly behind: Leg[];
  readonly spring: SpringDrawing;
  readonly front: Leg[];
}

/** Why `t` can't be drawn, or null when it can. */
export function torsionFrontProblem(t: TorsionFront): string | null {
  if (!(t.wire > 0)) return "the wire diameter must be more than 0";
  if (!(t.outside > 2 * t.wire)) return "the wire is too thick for the spring's diameter";
  if (!(t.coils >= 1 && t.coils <= MAX_COILS)) return `the active coils must be from 1 to ${MAX_COILS}`;
  for (const leg of [t.left, t.right]) if (leg && !(leg.length > t.outside / 2)) return "each end's length must reach past the coils' outside";
  return null;
}

/** A straight band `half` each side of x, from y0 (left open) to y1 (closed square). */
function straightLeg(x: number, half: number, y0: number, y1: number): Leg {
  const outline = [
    { x: x - half, y: y0 },
    { x: x - half, y: y1 },
    { x: x + half, y: y1 },
    { x: x + half, y: y0 },
  ];
  return { outline, fill: outline };
}

/**
 * A torsion spring from the front, its axis running right from the origin, `beyond` the centre line's
 * reach past the coils (null for none): close wound, the active coils plus one wire's width long.
 */
export function torsionFront(t: TorsionFront, display: SpringDisplay, beyond: number | null): TorsionFrontDrawing {
  const r = (t.outside - t.wire) / 2;
  const half = t.wire / 2;
  const spring = springDrawing(
    {
      wire: { kind: "round", width: t.wire },
      total: t.coils,
      along: [
        { u: 0, s: half },
        { u: t.coils, s: half + t.coils * t.wire },
      ],
      r0: r,
      r1: r,
      length: (t.coils + 1) * t.wire,
      ground: false,
      leftHand: t.leftHand,
    },
    display,
    beyond,
  );
  const behind: Leg[] = [];
  const front: Leg[] = [];
  for (const [leg, x] of [
    [t.left, half],
    [t.right, half + t.coils * t.wire],
  ] as const) {
    if (!leg) continue;
    const dir = leg.direction === "up" ? 1 : -1;
    // a normal leg leaves the coils' side at the axis; one facing forward or rearward crosses from their far side
    const from = leg.orientation === "normal" ? 0 : -dir * r;
    (leg.orientation === "rearward" ? behind : front).push(straightLeg(x, half, from, dir * leg.length));
  }
  return { behind, spring, front };
}

export type EndStyle = "plain" | "quarter" | "half" | "threequarter" | "loop";
/** each end style's turn, in quarter turns */
const TURNS: Readonly<Record<EndStyle, number>> = { plain: 0, quarter: 1, half: 2, threequarter: 3, loop: 4 };

export interface EndLeg {
  /** from the coils' centre to the bend's outside, along the leg */
  readonly length: number;
  /** degrees: End #1's leg turned clockwise from straight up, End #2's anticlockwise */
  readonly deflection: number;
  readonly style: EndStyle;
  readonly clockwise: boolean;
  readonly bendRadius: number;
  /** from the bend to the wire's end */
  readonly bendLength: number;
}

export interface TorsionEnd {
  readonly outside: number;
  readonly wire: number;
  readonly end1: EndLeg | null;
  readonly end2: EndLeg | null;
  readonly leftHand: boolean;
}

export interface TorsionEndDrawing {
  /** the ring's two circles */
  readonly circles: { readonly centre: Pt; readonly radius: number }[];
  readonly legs: Leg[];
  readonly lines: Pt[][];
}

/** points round each quarter turn of a bend, and round a leg's rounded end */
const BEND_STEPS = 12;
const CAP_STEPS = 8;

/** Why `t` can't be drawn, or null when it can. */
export function torsionEndProblem(t: TorsionEnd): string | null {
  if (!(t.wire > 0)) return "the wire diameter must be more than 0";
  if (!(t.outside > 2 * t.wire)) return "the wire is too thick for the spring's diameter";
  for (const leg of [t.end1, t.end2]) {
    if (!leg) continue;
    const bent = leg.style !== "plain";
    if (bent && !(leg.bendRadius >= t.wire / 2)) return "each bend radius must be at least half the wire's diameter";
    if (bent && leg.style !== "loop" && !(leg.bendLength >= 0)) return "each bend length must be 0 or more";
    if (!(straightReach(leg, t.wire) > 0)) return "each end's length must reach past its bend";
  }
  return null;
}

/** How far a leg runs straight from the tangent before its bend (or to its end). */
function straightReach(leg: EndLeg, wire: number): number {
  return leg.style === "plain" ? leg.length - wire / 2 : leg.length - wire / 2 - leg.bendRadius;
}

/** The band `half` each side of a path's centreline: down its left side, round its end, back up its right. */
function band(path: readonly Pt[], half: number): Leg {
  const n = path.length;
  const normal = (i: number): Pt => {
    // averaged across the vertex, so bends keep their width
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(n - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  const side = (k: number): Pt[] => path.map((p, i) => ({ x: p.x + k * half * normal(i).x, y: p.y + k * half * normal(i).y }));
  const left = side(1);
  const right = side(-1).reverse();
  const end = path[n - 1]!;
  const t = Math.atan2(end.y - path[n - 2]!.y, end.x - path[n - 2]!.x);
  const cap = Array.from({ length: CAP_STEPS - 1 }, (_, i) => {
    const g = t + Math.PI / 2 - (Math.PI * (i + 1)) / CAP_STEPS;
    return { x: end.x + half * Math.cos(g), y: end.y + half * Math.sin(g) };
  });
  const outline = [...left, ...cap, ...right];
  return { outline, fill: outline };
}

/** A leg's centreline from its tangent on the ring of radius `r`; `first` for End #1. */
function legPath(leg: EndLeg, r: number, wire: number, first: boolean): Pt[] {
  const a = (leg.deflection * Math.PI) / 180;
  // straight up turned clockwise (End #1) or anticlockwise (End #2)
  const dir = first ? { x: Math.sin(a), y: Math.cos(a) } : { x: -Math.sin(a), y: Math.cos(a) };
  // the tangent point: a quarter turn anticlockwise from the leg's way for End #1, clockwise for End #2
  const n = first ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x };
  const start = { x: r * n.x, y: r * n.y };
  const reach = straightReach(leg, wire);
  const bendAt = { x: start.x + reach * dir.x, y: start.y + reach * dir.y };
  const path = [start, bendAt];
  const turns = TURNS[leg.style];
  if (turns === 0) return path;
  const s = leg.clockwise ? -1 : 1;
  const rb = leg.bendRadius;
  const centre = { x: bendAt.x - s * rb * dir.y, y: bendAt.y + s * rb * dir.x };
  const from = Math.atan2(bendAt.y - centre.y, bendAt.x - centre.x);
  const steps = turns * BEND_STEPS;
  for (let i = 1; i <= steps; i++) {
    const g = from + (s * (Math.PI / 2) * turns * i) / steps;
    path.push({ x: centre.x + rb * Math.cos(g), y: centre.y + rb * Math.sin(g) });
  }
  if (leg.style !== "loop" && leg.bendLength > 0) {
    const g = (s * Math.PI * turns) / 2;
    const out = { x: dir.x * Math.cos(g) - dir.y * Math.sin(g), y: dir.x * Math.sin(g) + dir.y * Math.cos(g) };
    const last = path[path.length - 1]!;
    path.push({ x: last.x + leg.bendLength * out.x, y: last.y + leg.bendLength * out.y });
  }
  return path;
}

/** A torsion spring seen down its axis round the origin, `beyond` the centre lines' reach past the ring (null for none). */
export function torsionEnd(t: TorsionEnd, beyond: number | null): TorsionEndDrawing {
  const r = (t.outside - t.wire) / 2;
  const half = t.wire / 2;
  const mirror = (p: Pt): Pt => (t.leftHand ? { x: -p.x, y: p.y } : p);
  const legs: Leg[] = [];
  for (const [leg, first] of [
    [t.end1, true],
    [t.end2, false],
  ] as const) {
    if (!leg) continue;
    const b = band(legPath(leg, r, t.wire, first), half);
    // mirrored, a band runs the other way round, which doesn't matter to its outline
    legs.push({ outline: b.outline.map(mirror), fill: b.fill.map(mirror) });
  }
  const ro = t.outside / 2;
  const lines: Pt[][] = beyond === null ? [] : [
    [{ x: -ro - beyond, y: 0 }, { x: ro + beyond, y: 0 }],
    [{ x: 0, y: -ro - beyond }, { x: 0, y: ro + beyond }],
  ];
  return { circles: [{ centre: { x: 0, y: 0 }, radius: ro }, { centre: { x: 0, y: 0 }, radius: ro - t.wire }], legs, lines };
}
