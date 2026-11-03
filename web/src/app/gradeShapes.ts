// The sums behind the Grade tool: a slope between two elevations, worked out from any two of its figures, how it
// reads, and how grades meet. Plain data in and out (grade.ts draws them).

import type { Pt } from "../core/index.ts";

export const GRADE_PARAMETERS = ["Elevation 1", "Elevation 2", "Downward Grade in %", "Upward Grade in %", "Downward Ratio (rise/run)", "Upward Ratio (rise/run)", "Elevation Change"] as const;
export type GradeParameter = (typeof GRADE_PARAMETERS)[number];

const isElevation = (p: GradeParameter): boolean => p === "Elevation 1" || p === "Elevation 2";

/** What can go with a first figure: an elevation fixes where the slope is, so one of the two has to be one. */
export const secondParameters = (first: GradeParameter): GradeParameter[] => GRADE_PARAMETERS.filter((p) => p !== first && (isElevation(first) || isElevation(p)));

/** How much a figure rises going from the first point to the second, over this length; null for an elevation. */
function riseOf(p: GradeParameter, value: number, length: number): number | null {
  if (p === "Downward Grade in %") return (-value / 100) * length;
  if (p === "Upward Grade in %") return (value / 100) * length;
  if (p === "Downward Ratio (rise/run)") return -value * length;
  if (p === "Upward Ratio (rise/run)") return value * length;
  if (p === "Elevation Change") return value;
  return null;
}

/** The two elevations from two figures; null when they don't fix them. */
export function solveGrade(first: GradeParameter, firstValue: number, second: GradeParameter, secondValue: number, length: number): { readonly e1: number; readonly e2: number } | null {
  if (first === second) return null;
  if (isElevation(first) && isElevation(second)) return first === "Elevation 1" ? { e1: firstValue, e2: secondValue } : { e1: secondValue, e2: firstValue };
  const [elevation, elevationValue, other, otherValue] = isElevation(first) ? [first, firstValue, second, secondValue] : [second, secondValue, first, firstValue];
  if (!isElevation(elevation)) return null;
  const rise = riseOf(other, otherValue, length);
  if (rise === null) return null;
  return elevation === "Elevation 1" ? { e1: elevationValue, e2: elevationValue + rise } : { e1: elevationValue - rise, e2: elevationValue };
}

export interface GradeFigures {
  /** the second less the first */
  readonly change: number;
  /** always positive, as a rise over the run */
  readonly slope: number;
  readonly surface: number;
}

export const gradeFigures = (e1: number, e2: number, length: number): GradeFigures => ({
  change: e2 - e1,
  slope: length > 0 ? Math.abs(e2 - e1) / length : 0,
  surface: Math.hypot(length, e2 - e1),
});

export const GRADE_DEFINITIONS = ["Percent", "Permille", "Run/Rise Ratio", "Rise/Run Ratio", "Angle"] as const;
export type GradeDefinition = (typeof GRADE_DEFINITIONS)[number];

/** A slope as it reads on the drawing. */
export function slopeLabel(slope: number, definition: GradeDefinition, precision: number): string {
  const fixed = (v: number): string => v.toFixed(precision);
  if (definition === "Percent") return `${fixed(slope * 100)}%`;
  if (definition === "Permille") return `${fixed(slope * 1000)}‰`;
  if (definition === "Angle") return `${fixed((Math.atan(slope) * 180) / Math.PI)}°`;
  if (!(slope > 0)) return "Level";
  return definition === "Run/Rise Ratio" ? `${fixed(1 / slope)}:1` : `1:${fixed(1 / slope)}`;
}

/** Where on a line a point falls closest: how far along (0 to 1), there, and how far off. */
export function closestOn(p: Pt, a: Pt, b: Pt): { readonly t: number; readonly at: Pt; readonly off: number } {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const at = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, at, off: Math.hypot(p.x - at.x, p.y - at.y) };
}

/** Whether two lines cross, away from their ends. */
export function linesCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const turn = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const near = 1e-6 * (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(d.x - c.x) + Math.abs(d.y - c.y)) ** 2;
  const [t1, t2, t3, t4] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];
  if (Math.abs(t1) <= near || Math.abs(t2) <= near || Math.abs(t3) <= near || Math.abs(t4) <= near) return false;
  return t1 * t2 < 0 && t3 * t4 < 0;
}

export interface GradeLine {
  readonly id: string;
  readonly a: Pt;
  readonly b: Pt;
  readonly e1: number;
  readonly e2: number;
  readonly detached?: boolean;
}

export interface GradeChecks {
  /** percent, the slope kept to this range, or null for no check */
  readonly slope: { readonly min: number; readonly max: number } | null;
  /** the elevations kept to this range, or null for no check */
  readonly elevation: { readonly min: number; readonly max: number } | null;
  readonly intersections: boolean;
}

/** The grades that fail the checks. */
export function criticalGrades(lines: readonly GradeLine[], checks: GradeChecks): Set<string> {
  const out = new Set<string>();
  for (const g of lines) {
    const percent = gradeFigures(g.e1, g.e2, Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y)).slope * 100;
    if (checks.slope && (percent < checks.slope.min - 1e-9 || percent > checks.slope.max + 1e-9)) out.add(g.id);
    if (checks.elevation && [g.e1, g.e2].some((e) => e < (checks.elevation as { min: number }).min - 1e-6 || e > (checks.elevation as { max: number }).max + 1e-6)) out.add(g.id);
  }
  if (checks.intersections) {
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (linesCross(lines[i].a, lines[i].b, lines[j].a, lines[j].b)) {
          out.add(lines[i].id);
          out.add(lines[j].id);
        }
      }
    }
  }
  return out;
}

const SAME = 1;

const samePlace = (p: Pt, q: Pt): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= SAME;

/** The grades joined to one, by ends in the same place: its network, itself among them. */
export function networkOf(lines: readonly GradeLine[], id: string): GradeLine[] {
  const start = lines.find((g) => g.id === id);
  if (!start || start.detached) return start ? [start] : [];
  const found = new Set([start.id]);
  const out = [start];
  for (let i = 0; i < out.length; i++) {
    const g = out[i];
    for (const other of lines) {
      if (found.has(other.id) || other.detached) continue;
      if (samePlace(g.a, other.a) || samePlace(g.a, other.b) || samePlace(g.b, other.a) || samePlace(g.b, other.b)) {
        found.add(other.id);
        out.push(other);
      }
    }
  }
  return out;
}

/** The other grades' ends in this place: each grade's id and which end. */
export function endsAt(lines: readonly GradeLine[], at: Pt, except: string): { readonly id: string; readonly end: 1 | 2 }[] {
  const out: { id: string; end: 1 | 2 }[] = [];
  for (const g of lines) {
    if (g.id === except || g.detached) continue;
    if (samePlace(g.a, at)) out.push({ id: g.id, end: 1 });
    if (samePlace(g.b, at)) out.push({ id: g.id, end: 2 });
  }
  return out;
}
