// The sums and drawing behind Spotlight's Photometer and Photometric Grid: where a grid's readings lie,
// how a tilted grid faces, which threshold colour a reading takes, and how it reads, footcandles in a
// drawing in feet or inches and lux in a metric one, as Vectorworks shows them. Lengths in mm, angles in
// degrees; a grid's points are in its own frame, about its centre.

import type { NewShape, Pt } from "../core/index.ts";

export interface PhotoThresholds {
  /** in the units the readings show */
  readonly lower: number;
  readonly upper: number;
  /** colours as #rrggbb */
  readonly zero: string;
  readonly below: string;
  readonly between: string;
  readonly above: string;
}

export const DEFAULT_THRESHOLDS: PhotoThresholds = { lower: 150, upper: 350, zero: "#808080", below: "#2e8b57", between: "#c8813c", above: "#1f3fd0" };

export type IllumUnit = "fc" | "lx";

const LUX_PER_FOOTCANDLE = 10.764;
/** the most readings a grid holds */
export const MAX_READINGS = 2500;

/** Footcandles in a drawing in inches, feet, yards or miles, else lux. */
export function illumUnit(units: string | undefined): IllumUnit {
  return /inch|feet|foot|yard|mile/i.test(units ?? "") ? "fc" : "lx";
}

/** Lux in the units shown. */
export function inUnit(lux: number, unit: IllumUnit): number {
  return unit === "fc" ? lux / LUX_PER_FOOTCANDLE : lux;
}

/** A reading as it's shown: 40.62 FC, or 437.24 lx. */
export function illumText(lux: number, unit: IllumUnit): string {
  return `${inUnit(lux, unit).toFixed(2)} ${unit === "fc" ? "FC" : "lx"}`;
}

/** The colour of a reading (in lux) by the thresholds. */
export function thresholdColour(lux: number, unit: IllumUnit, t: PhotoThresholds): string {
  const v = inUnit(lux, unit);
  if (!(v > 0.005)) return t.zero;
  if (v < t.lower) return t.below;
  return v <= t.upper ? t.between : t.above;
}

export interface PhotoGridSpec {
  readonly widthX: number;
  readonly widthY: number;
  readonly spacingX: number;
  readonly spacingY: number;
  /** the height of the grid's low corner, the one at -X, -Y */
  readonly elevation: number;
  readonly tiltX: number;
  readonly tiltY: number;
}

export interface GridPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How many readings fit along a width at a spacing. */
const countAlong = (width: number, spacing: number): number => Math.floor(width / spacing + 1e-9) + 1;

/** Why a grid can't be drawn, or null. */
export function gridProblem(g: PhotoGridSpec): string | null {
  if (!(g.widthX > 0) || !(g.widthY > 0)) return "A photometric grid needs a width in X and in Y.";
  if (!(g.spacingX > 0) || !(g.spacingY > 0)) return "A photometric grid needs a spacing in X and in Y.";
  if (Math.abs(g.tiltX) >= 89 || Math.abs(g.tiltY) >= 89) return "Tilt a photometric grid by less than 89°.";
  const n = countAlong(g.widthX, g.spacingX) * countAlong(g.widthY, g.spacingY);
  return n > MAX_READINGS ? `That's ${n.toLocaleString()} readings, and a grid holds ${MAX_READINGS.toLocaleString()}. Space them further apart.` : null;
}

const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);

/** The readings' places: spaced from the middle of each width, the plane rising from the low corner. */
export function gridPoints(g: PhotoGridSpec): GridPoint[] {
  const nx = countAlong(g.widthX, g.spacingX);
  const ny = countAlong(g.widthY, g.spacingY);
  const out: GridPoint[] = [];
  for (let j = 0; j < ny; j++) {
    const y = (j - (ny - 1) / 2) * g.spacingY;
    for (let i = 0; i < nx; i++) {
      const x = (i - (nx - 1) / 2) * g.spacingX;
      out.push({ x, y, z: g.elevation + (x + g.widthX / 2) * tan(g.tiltX) + (y + g.widthY / 2) * tan(g.tiltY) });
    }
  }
  return out;
}

/** The height a tilt gains across a width, and the tilt that gains a height. */
export const offsetOfTilt = (tilt: number, width: number): number => width * tan(tilt);
export const tiltOfOffset = (offset: number, width: number): number => (width > 0 ? (Math.atan(offset / width) * 180) / Math.PI : 0);

/** The way a grid tilted so, and turned `angle` in plan, faces: a unit vector, upward. */
export function gridNormal(tiltX: number, tiltY: number, angle: number): GridPoint {
  const lx = -tan(tiltX);
  const ly = -tan(tiltY);
  const n = Math.hypot(lx, ly, 1);
  const t = (angle * Math.PI) / 180;
  return { x: (lx * Math.cos(t) - ly * Math.sin(t)) / n, y: (lx * Math.sin(t) + ly * Math.cos(t)) / n, z: 1 / n };
}

/** A point of an object's own frame in the drawing, the object at `at` and turned `angle`. */
export function inDrawing(at: Pt, angle: number, p: Pt): Pt {
  const t = (angle * Math.PI) / 180;
  return { x: at.x + p.x * Math.cos(t) - p.y * Math.sin(t), y: at.y + p.x * Math.sin(t) + p.y * Math.cos(t) };
}

export interface GridPlacement {
  readonly center: Pt;
  readonly angle: number;
  readonly widthX: number;
  readonly widthY: number;
}

/**
 * A grid from the tool's three clicks: the first two run through its centre (Center-line Placement) or
 * along its edge (Edge Placement), and the third sets its width. Null for a grid with no size.
 */
export function gridFromClicks(a: Pt, b: Pt, c: Pt, edge: boolean): GridPlacement | null {
  const widthX = Math.hypot(b.x - a.x, b.y - a.y);
  if (widthX < 1) return null;
  const ux = (b.x - a.x) / widthX;
  const uy = (b.y - a.y) / widthX;
  const off = (c.x - a.x) * -uy + (c.y - a.y) * ux;
  const widthY = edge ? Math.abs(off) : 2 * Math.abs(off);
  if (widthY < 1) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const center = edge ? { x: mid.x - (uy * off) / 2, y: mid.y + (ux * off) / 2 } : mid;
  return { center, angle: (Math.atan2(uy, ux) * 180) / Math.PI, widthX, widthY };
}

/** A reading's dot and its lines of text under it, about (x, y) in the object's frame. */
export function readingParts(x: number, y: number, height: number, lines: readonly string[]): NewShape[] {
  const r = height * 0.35;
  const parts: NewShape[] = [{ kind: "polygon", points: [{ x: x + r, y }, { x, y: y + r }, { x: x - r, y }, { x, y: y - r }], closed: true }];
  lines.forEach((text, i) => parts.push({ kind: "text", at: { x, y: y - r - height * (0.75 + 1.25 * i) }, text, height, hAlign: 2, vAlign: 3, angle: 0 }));
  return parts;
}
