// An existing tree in plan, as Site Planning's Existing Tree tool draws it. Kept apart from the tool
// so it runs without the page. Sizes are in mm.

import type { Pt } from "../core/index.ts";

export type TreeAction = "retain" | "remove" | "transplant-original" | "transplant-proposed";
export type RootDisplay = "none" | "zones" | "ball";
export type TreeProtection = "none" | "circle" | "dbh";

export interface ExistingTree {
  readonly action: TreeAction;
  /** the canopy's widest diameter */
  readonly canopyMax: number;
  /** its narrowest, across the widest; the same makes it round */
  readonly canopyMin: number;
  /** the canopy's turn, radians, on top of the tree's */
  readonly canopyRotate: number;
  /** the trunk's diameter at breast height */
  readonly dbh: number;
  readonly roots: RootDisplay;
  /** the critical and primary root zones' diameters; 0 goes by the DBH, 2.5 and 5 times it */
  readonly critical: number;
  readonly primary: number;
  readonly ball: number;
  readonly protection: TreeProtection;
  /** the protection zone's radius when it's a set circle */
  readonly tpzRadius: number;
}

export interface Circle {
  readonly center: Pt;
  readonly radius: number;
}

export interface TreePlan {
  /** the canopy's outline */
  readonly canopy: Pt[];
  /** the canopy's own ring inside a proposed transplant's */
  readonly inner: Pt[] | null;
  /** the trunk, drawn solid */
  readonly trunk: Circle;
  /** the cross a tree to be removed takes */
  readonly cross: Pt[][];
  /** dashed: the zones round the roots */
  readonly rootZones: readonly Circle[];
  /** dashed: the protection zone */
  readonly protection: Circle | null;
}

/** points round a canopy */
const CANOPY_STEPS = 72;
/** a proposed transplant's inner ring, as a share of its canopy */
const INNER_RING = 0.8;

export const criticalDiameter = (t: Pick<ExistingTree, "critical" | "dbh">): number => t.critical || 2.5 * t.dbh;
export const primaryDiameter = (t: Pick<ExistingTree, "primary" | "dbh">): number => t.primary || 5 * t.dbh;

/** The protection zone's radius; 0 for none. */
export function protectionRadius(t: Pick<ExistingTree, "protection" | "dbh" | "tpzRadius">): number {
  return t.protection === "circle" ? t.tpzRadius : t.protection === "dbh" ? 12 * t.dbh : 0;
}

/** The tree at `at`, turned by `angle` radians; null when its sizes don't make one. */
export function existingTree(t: ExistingTree, at: Pt, angle: number): TreePlan | null {
  if (!(t.canopyMax > 0) || !(t.canopyMin > 0) || t.canopyMin > t.canopyMax || !(t.dbh > 0)) return null;
  const a = angle + t.canopyRotate;
  const ring = (k: number): Pt[] =>
    Array.from({ length: CANOPY_STEPS }, (_, i) => {
      const phi = (2 * Math.PI * i) / CANOPY_STEPS;
      const x = ((t.canopyMax / 2) * k * Math.cos(phi));
      const y = ((t.canopyMin / 2) * k * Math.sin(phi));
      return { x: at.x + x * Math.cos(a) - y * Math.sin(a), y: at.y + x * Math.sin(a) + y * Math.cos(a) };
    });
  const r = t.canopyMax / 2;
  const q = (r * Math.SQRT1_2 * t.canopyMin) / t.canopyMax;
  // from side to side of the oval, on its diagonals
  const corner = (sx: number, sy: number): Pt => {
    const x = (r * Math.SQRT1_2) * sx;
    const y = q * sy;
    return { x: at.x + x * Math.cos(a) - y * Math.sin(a), y: at.y + x * Math.sin(a) + y * Math.cos(a) };
  };
  const radius = protectionRadius(t);
  const zones: Circle[] =
    t.roots === "zones"
      ? [
          { center: at, radius: criticalDiameter(t) / 2 },
          { center: at, radius: primaryDiameter(t) / 2 },
        ]
      : t.roots === "ball" && t.ball > 0
        ? [{ center: at, radius: t.ball / 2 }]
        : [];
  return {
    canopy: ring(1),
    inner: t.action === "transplant-proposed" ? ring(INNER_RING) : null,
    trunk: { center: at, radius: t.dbh / 2 },
    cross:
      t.action === "remove"
        ? [
            [corner(-1, -1), corner(1, 1)],
            [corner(-1, 1), corner(1, -1)],
          ]
        : [],
    rootZones: zones,
    protection: radius > 0 ? { center: at, radius } : null,
  };
}

/** A tree's number as Tag and Number Options sets it: the prefix, then the number with its leading zeros. */
export function treeNumber(prefix: string, n: number, zeros: number): string {
  return `${prefix}${String(n).padStart(zeros + 1, "0")}`;
}
