// Mounted ball bearing units: a pillow block (a UC insert in a housing on a slotted base) and a
// 2- or 4-bolt flanged unit, each seen down the shaft (front), across it (side) or, for the pillow
// block, from above (top). Sizes are FYH's UCP2, UCF2 and UCFL2 units with UC2 inserts; the collar
// (the insert's inner ring, set screws in its outer end), the flanged housings' boss and the pillow
// block's housing width and round top aren't in those tables and are estimated from them. Hidden
// lines are returned apart so the caller can dash them. Pure geometry in mm.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";

/** points round a full circle drawn as a polygon */
const ROUND = 64;

/** A UC2 insert: bore, outside diameter, inner ring width, set screw (its name and diameter). */
export interface Insert {
  readonly d: number;
  readonly D: number;
  readonly B: number;
  readonly screw: string;
}

/** FYH's UC204 to UC215 inserts, by their number. */
export const UC_INSERTS: Readonly<Record<string, Insert>> = {
  "204": { d: 20, D: 47, B: 31, screw: "M6×0.75" },
  "205": { d: 25, D: 52, B: 34.1, screw: "M6×0.75" },
  "206": { d: 30, D: 62, B: 38.1, screw: "M6×0.75" },
  "207": { d: 35, D: 72, B: 42.9, screw: "M8×1" },
  "208": { d: 40, D: 80, B: 49.2, screw: "M8×1" },
  "209": { d: 45, D: 85, B: 49.2, screw: "M8×1" },
  "210": { d: 50, D: 90, B: 51.6, screw: "M10×1.25" },
  "211": { d: 55, D: 100, B: 55.6, screw: "M10×1.25" },
  "212": { d: 60, D: 110, B: 65.1, screw: "M10×1.25" },
  "213": { d: 65, D: 120, B: 65.1, screw: "M12×1.5" },
  "214": { d: 70, D: 125, B: 74.6, screw: "M12×1.5" },
  "215": { d: 75, D: 130, B: 77.8, screw: "M12×1.5" },
};

/** set screws a collar may have, and their diameters */
export const SET_SCREWS: readonly { readonly value: string; readonly diameter: number }[] = [
  { value: "M6×0.75", diameter: 6 },
  { value: "M8×1", diameter: 8 },
  { value: "M10×1.25", diameter: 10 },
  { value: "M12×1.5", diameter: 12 },
  { value: "1/4-28 UNF", diameter: 6.35 },
  { value: "5/16-24 UNF", diameter: 7.94 },
  { value: "3/8-24 UNF", diameter: 9.53 },
  { value: "7/16-20 UNF", diameter: 11.11 },
];

/** The inner ring's outside, estimated: three tenths of the way from the bore to the bearing's outside. */
export const collarFor = (i: Insert): number => Math.round((i.d + 0.3 * (i.D - i.d)) * 10) / 10;

/** UCP2 pillow blocks: centre height H, base length L and width A, bolt centres J, slot width N and length N1, base thickness H1, overall height H2. */
export const UCP: readonly (readonly [string, number, number, number, number, number, number, number, number])[] = [
  ["204", 33.3, 127, 38, 95, 13, 18, 16, 65],
  ["205", 36.5, 140, 38, 105, 13, 18, 16, 70],
  ["206", 42.9, 165, 48, 121, 17, 21, 17, 84],
  ["207", 47.6, 167, 48, 127, 17, 21, 18, 95],
  ["208", 49.2, 184, 54, 137, 17, 21, 18, 98],
  ["209", 54, 190, 54, 146, 17, 21, 20, 106],
  ["210", 57.2, 206, 60, 159, 20, 22, 21, 113],
  ["211", 63.5, 219, 60, 171, 20, 22, 23, 125],
  ["212", 69.8, 241, 70, 184, 20, 25, 25, 138],
  ["213", 76.2, 265, 70, 203, 25, 30, 27, 150],
  ["214", 79.4, 266, 72, 210, 25, 30, 27, 157],
  ["215", 82.6, 275, 74, 217, 25, 30, 28, 162],
];

/** UCF2 square flanged units: flange size L, housing thickness A, bolt centres J, bolt holes N, flange thickness A1, overall thickness A0. */
export const UCF: readonly (readonly [string, number, number, number, number, number, number])[] = [
  ["204", 86, 25.5, 64, 12, 11, 33.3],
  ["205", 95, 27, 70, 12, 13, 35.8],
  ["206", 108, 31, 83, 12, 13, 40.2],
  ["207", 117, 34, 92, 14, 15, 44.4],
  ["208", 130, 36, 102, 16, 15, 51.2],
  ["209", 137, 38, 105, 16, 16, 52.2],
  ["210", 143, 40, 111, 16, 16, 54.6],
  ["211", 162, 43, 130, 19, 18, 58.4],
  ["212", 175, 48, 143, 19, 18, 68.7],
  ["213", 187, 50, 149, 19, 22, 69.7],
  ["214", 193, 54, 152, 19, 22, 75.4],
  ["215", 200, 56, 159, 19, 22, 78.5],
];

/** UCFL2 oval flanged units: flange length H and width L, housing thickness A, bolt centres J, bolt holes N, flange thickness A1, overall thickness A0. */
export const UCFL: readonly (readonly [string, number, number, number, number, number, number, number])[] = [
  ["204", 113, 60, 25.5, 90, 12, 11, 33.3],
  ["205", 130, 68, 27, 99, 16, 13, 35.8],
  ["206", 148, 80, 31, 117, 16, 13, 40.2],
  ["207", 161, 90, 34, 130, 16, 14, 44.4],
  ["208", 175, 100, 36, 144, 16, 14, 51.2],
  ["209", 188, 108, 38, 148, 19, 15, 52.2],
  ["210", 197, 115, 40, 157, 19, 15, 54.6],
  ["211", 224, 130, 43, 184, 19, 18, 58.4],
  ["212", 250, 140, 48, 202, 23, 18, 68.7],
  ["213", 258, 155, 50, 210, 23, 20, 69.7],
  ["214", 265, 160, 54, 216, 23, 20, 75.4],
  ["215", 275, 165, 56, 225, 23, 20, 78.5],
];

export type UnitView = "front" | "side" | "top";

/** What a unit shows besides itself: its set screw, its grease fitting, and centre lines reaching `beyond` (hidden lines with them), or none. */
export interface UnitShow {
  readonly screws: boolean;
  readonly fitting: boolean;
  readonly beyond: number | null;
}

/** A unit's drawing: its visible lines, and its hidden ones apart. */
export interface UnitDrawing extends HoleDrawing {
  readonly hidden: Pt[][];
}

export interface PillowBlock {
  readonly bore: number;
  /** from the bore's centre down to the base's underside */
  readonly centre: number;
  /** the housing across the shaft's axis, and its round top's radius */
  readonly housingWidth: number;
  readonly top: number;
  readonly baseLength: number;
  readonly baseWidth: number;
  readonly baseThickness: number;
  readonly holeCentres: number;
  readonly slotWidth: number;
  readonly slotLength: number;
  readonly collarWidth: number;
  readonly collarDiameter: number;
  readonly screw: number;
}

export interface FlangedBearing {
  readonly holes: 2 | 4;
  readonly bore: number;
  readonly collarDiameter: number;
  readonly housingDiameter: number;
  /** a 4-hole flange's side (both of these), or a 2-hole flange's length and width */
  readonly baseLength: number;
  readonly baseWidth: number;
  readonly holeCentres: number;
  readonly holeSize: number;
  readonly baseThickness: number;
  /** from the mounting face to the housing's front, and to the collar's end */
  readonly housingThickness: number;
  readonly overall: number;
  readonly screw: number;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function arcPoints(c: Pt, r: number, from: number, to: number, steps = ROUND): Pt[] {
  const n = Math.max(2, Math.ceil((steps * Math.abs(to - from)) / (2 * Math.PI)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

function hexagon(c: Pt, acrossFlats: number): Pt[] {
  const r = acrossFlats / 2 / Math.cos(Math.PI / 6);
  return Array.from({ length: 6 }, (_, i) => ({ x: c.x + r * Math.cos((Math.PI * i) / 3), y: c.y + r * Math.sin((Math.PI * i) / 3) }));
}

/** a grease fitting's size: one for small units, larger for those over a 50 mm bore */
const fittingScale = (bore: number): number => (bore > 50 ? 1.4 : 1);

/** A grease fitting standing up from `at` (on the housing), seen from the side: its thread, hex, stem and ball head. */
function fittingSide(d: UnitDrawing, at: Pt, s: number): void {
  const { x, y } = at;
  d.outlines.push(rect(x - 2 * s, y, x + 2 * s, y + 2 * s), rect(x - 3.5 * s, y + 2 * s, x + 3.5 * s, y + 6 * s), rect(x - 1.75 * s, y + 6 * s, x + 1.75 * s, y + 8 * s));
  d.lines.push([{ x: x - 1.75 * s, y: y + 2 * s }, { x: x - 1.75 * s, y: y + 6 * s }], [{ x: x + 1.75 * s, y: y + 2 * s }, { x: x + 1.75 * s, y: y + 6 * s }]);
  d.circles.push({ center: { x, y: y + 10 * s }, radius: 2.5 * s });
}

/** A grease fitting seen from above: its hex and ball head. */
function fittingTop(d: UnitDrawing, at: Pt, s: number): void {
  d.outlines.push(hexagon(at, 7 * s));
  d.circles.push({ center: at, radius: 2.5 * s });
}

/** A set screw seen end on in the collar: its thread and hex socket. */
function setScrew(d: UnitDrawing, at: Pt, diameter: number): void {
  d.circles.push({ center: at, radius: diameter / 2 });
  d.outlines.push(hexagon(at, diameter / 2));
}

/** Why `p` can't be drawn, or null when it can. */
export function pillowBlockProblem(p: PillowBlock): string | null {
  if (!(p.collarDiameter > p.bore)) return "the collar must be wider than the bore";
  if (!(p.top > p.collarDiameter / 2)) return "the housing must be wider than the collar";
  if (!(p.centre > p.baseThickness)) return "the center distance must be more than the base's thickness";
  if (!(p.holeCentres / 2 - p.slotLength / 2 > p.top)) return "the slots must clear the housing: space them wider or make the base longer";
  if (!(p.holeCentres + p.slotLength < p.baseLength)) return "the slots must fit in the base";
  if (!(p.slotWidth < p.baseWidth)) return "the slots must be narrower than the base";
  if (!(p.housingWidth <= p.baseWidth)) return "the housing can't be wider than the base";
  if (!(p.collarWidth > 0)) return "the collar needs a width";
  return null;
}

/**
 * A pillow block, the bore's centre at the origin. Front: down the shaft, the base along x under
 * the housing's round top and the sides running down to the base, the slots hidden. Side: across
 * the shaft, its axis along x, the base, the housing and the collar standing out on the set-screw
 * side (the inner ring starts at the housing's other face). Top: from above, the shaft's axis
 * along y, the base with its slots, the housing and the collar.
 */
export function pillowBlock(p: PillowBlock, view: UnitView, show: UnitShow): UnitDrawing {
  const d: UnitDrawing = { outlines: [], lines: [], circles: [], arcs: [], hidden: [] };
  const R = p.top;
  const bottom = -p.centre;
  const baseTop = bottom + p.baseThickness;
  // the housing's sides meet the base this far either side of the shaft
  const foot = Math.min(1.15 * R, p.holeCentres / 2 - p.slotLength / 2 - 0.5);
  const near = -p.housingWidth / 2;
  const far = near + p.collarWidth;
  const s = fittingScale(p.bore);
  const beyond = show.beyond;
  if (view === "front") {
    d.outlines.push(rect(-p.baseLength / 2, bottom, p.baseLength / 2, baseTop));
    const dist = Math.hypot(foot, baseTop);
    const a = Math.atan2(baseTop, foot) + Math.acos(Math.min(1, R / dist));
    d.outlines.push([{ x: -foot, y: baseTop }, { x: foot, y: baseTop }, ...arcPoints({ x: 0, y: 0 }, R, a, Math.PI - a)]);
    d.circles.push({ center: { x: 0, y: 0 }, radius: p.collarDiameter / 2 }, { center: { x: 0, y: 0 }, radius: p.bore / 2 });
    if (show.fitting) fittingSide(d, { x: 0, y: R }, s);
    if (beyond !== null) {
      for (const side of [-1, 1]) {
        const x = (side * p.holeCentres) / 2;
        for (const e of [-p.slotLength / 2, p.slotLength / 2]) d.hidden.push([{ x: x + e, y: bottom }, { x: x + e, y: baseTop }]);
        d.lines.push([{ x, y: bottom - beyond }, { x, y: baseTop + beyond }]);
      }
      d.lines.push([{ x: -R - beyond, y: 0 }, { x: R + beyond, y: 0 }], [{ x: 0, y: bottom - beyond }, { x: 0, y: R + beyond }]);
    }
  } else if (view === "side") {
    d.outlines.push(rect(-p.baseWidth / 2, bottom, p.baseWidth / 2, baseTop), rect(near, baseTop, -near, R));
    const c = p.collarDiameter / 2;
    if (far > -near) d.outlines.push(rect(-near, -c, far, c));
    if (show.screws && far > -near) setScrew(d, { x: (far - near) / 2, y: 0 }, p.screw);
    if (show.fitting) fittingSide(d, { x: 0, y: R }, s);
    if (beyond !== null) {
      for (const y of [-p.bore / 2, p.bore / 2]) d.hidden.push([{ x: near, y }, { x: far, y }]);
      for (const x of [-p.slotWidth / 2, p.slotWidth / 2]) d.hidden.push([{ x, y: bottom }, { x, y: baseTop }]);
      d.lines.push([{ x: -p.baseWidth / 2 - beyond, y: 0 }, { x: Math.max(far, p.baseWidth / 2) + beyond, y: 0 }], [{ x: 0, y: bottom - beyond }, { x: 0, y: R + beyond }]);
    }
  } else {
    d.outlines.push(rect(-p.baseLength / 2, -p.baseWidth / 2, p.baseLength / 2, p.baseWidth / 2), rect(-foot, near, foot, -near));
    for (const side of [-1, 1]) {
      // an obround slot along the base
      const x = (side * p.holeCentres) / 2;
      const r = p.slotWidth / 2;
      const h = Math.max(0, p.slotLength / 2 - r);
      d.outlines.push([...arcPoints({ x: x + h, y: 0 }, r, -Math.PI / 2, Math.PI / 2, 32), ...arcPoints({ x: x - h, y: 0 }, r, Math.PI / 2, (3 * Math.PI) / 2, 32)]);
    }
    const c = p.collarDiameter / 2;
    if (far > -near) d.outlines.push(rect(-c, -near, c, far));
    if (show.screws && far > -near) setScrew(d, { x: 0, y: (far - near) / 2 }, p.screw);
    if (show.fitting) fittingTop(d, { x: 0, y: 0 }, s);
    if (beyond !== null) {
      for (const x of [-p.bore / 2, p.bore / 2]) d.hidden.push([{ x, y: near }, { x, y: far }]);
      for (const side of [-1, 1]) {
        const x = (side * p.holeCentres) / 2;
        d.lines.push([{ x, y: -p.baseWidth / 2 - beyond }, { x, y: p.baseWidth / 2 + beyond }], [{ x: x - p.slotLength / 2 - beyond, y: 0 }, { x: x + p.slotLength / 2 + beyond, y: 0 }]);
      }
      d.lines.push([{ x: 0, y: -p.baseWidth / 2 - beyond }, { x: 0, y: Math.max(far, p.baseWidth / 2) + beyond }]);
    }
  }
  return d;
}

/** Why `f` can't be drawn, or null when it can. */
export function flangedProblem(f: FlangedBearing): string | null {
  if (!(f.collarDiameter > f.bore)) return "the collar must be wider than the bore";
  if (!(f.housingDiameter > f.collarDiameter)) return "the housing must be wider than the collar";
  if (!(f.baseThickness < f.housingThickness && f.housingThickness < f.overall)) return "the base must be thinner than the housing, and the housing than the whole bearing";
  if (!(f.holeCentres + f.holeSize < f.baseLength)) return "the holes must fit in the base";
  if (f.holes === 4) {
    if (!(f.holeCentres / Math.SQRT2 - f.holeSize / 2 > f.housingDiameter / 2)) return "the holes must clear the housing: space them wider";
  } else {
    if (!(f.baseLength > f.baseWidth)) return "the base must be longer than it is wide";
    if (!(f.holeCentres / 2 - f.holeSize / 2 > f.baseWidth / 2)) return "the holes must lie beyond the base's round middle: space them wider";
  }
  return null;
}

/** A 4-hole flange's outline: a square, its corners rounded about the holes. */
function squareFlange(side: number, centres: number): Pt[] {
  const r = (side - centres) / 2;
  const h = centres / 2;
  return [
    ...arcPoints({ x: h, y: h }, r, 0, Math.PI / 2, 32),
    ...arcPoints({ x: -h, y: h }, r, Math.PI / 2, Math.PI, 32),
    ...arcPoints({ x: -h, y: -h }, r, Math.PI, (3 * Math.PI) / 2, 32),
    ...arcPoints({ x: h, y: -h }, r, (3 * Math.PI) / 2, 2 * Math.PI, 32),
  ];
}

/** A 2-hole flange's outline: its round middle, `width` across, and a lobe round each hole reaching `length`, joined by tangents. */
function ovalFlange(length: number, width: number, centres: number): Pt[] {
  const R = width / 2;
  const c = centres / 2;
  const r = (length - centres) / 2;
  const t = Math.acos(Math.min(1, (R - r) / c));
  return [
    ...arcPoints({ x: c, y: 0 }, r, -t, t, 48),
    ...arcPoints({ x: 0, y: 0 }, R, t, Math.PI - t),
    ...arcPoints({ x: -c, y: 0 }, r, Math.PI - t, Math.PI + t, 48),
    ...arcPoints({ x: 0, y: 0 }, R, Math.PI + t, 2 * Math.PI - t),
  ];
}

/**
 * A flanged bearing. Front: down the shaft, centred on it, the flange with its holes (a 2-hole
 * flange's along x), the housing's boss, the collar and the bore. Side: across the shaft, its axis
 * along x from the mounting face at the origin, the flange, the housing and the collar standing out
 * past it, the bore and holes hidden.
 */
export function flangedBearing(f: FlangedBearing, view: UnitView, show: UnitShow): UnitDrawing {
  const d: UnitDrawing = { outlines: [], lines: [], circles: [], arcs: [], hidden: [] };
  const s = fittingScale(f.bore);
  const beyond = show.beyond;
  const h = f.holeCentres / 2;
  const holes: Pt[] =
    f.holes === 4
      ? [
          { x: h, y: h },
          { x: -h, y: h },
          { x: -h, y: -h },
          { x: h, y: -h },
        ]
      : [
          { x: h, y: 0 },
          { x: -h, y: 0 },
        ];
  if (view === "side") {
    // seen with the holes above and below the shaft
    const half = f.baseLength / 2;
    d.outlines.push(rect(0, -half, f.baseThickness, half), rect(f.baseThickness, -f.housingDiameter / 2, f.housingThickness, f.housingDiameter / 2), rect(f.housingThickness, -f.collarDiameter / 2, f.overall, f.collarDiameter / 2));
    if (show.screws) setScrew(d, { x: (f.housingThickness + f.overall) / 2, y: 0 }, f.screw);
    if (show.fitting) fittingSide(d, { x: (f.baseThickness + f.housingThickness) / 2, y: f.housingDiameter / 2 }, s);
    if (beyond !== null) {
      for (const y of [-f.bore / 2, f.bore / 2]) d.hidden.push([{ x: 0, y }, { x: f.overall, y }]);
      for (const y of [-h, h]) {
        for (const e of [-f.holeSize / 2, f.holeSize / 2]) d.hidden.push([{ x: 0, y: y + e }, { x: f.baseThickness, y: y + e }]);
        d.lines.push([{ x: -beyond, y }, { x: f.baseThickness + beyond, y }]);
      }
      d.lines.push([{ x: -beyond, y: 0 }, { x: f.overall + beyond, y: 0 }]);
    }
    return d;
  }
  d.outlines.push(f.holes === 4 ? squareFlange(f.baseLength, f.holeCentres) : ovalFlange(f.baseLength, f.baseWidth, f.holeCentres));
  for (const c of holes) d.circles.push({ center: c, radius: f.holeSize / 2 });
  d.circles.push({ center: { x: 0, y: 0 }, radius: f.housingDiameter / 2 }, { center: { x: 0, y: 0 }, radius: f.collarDiameter / 2 }, { center: { x: 0, y: 0 }, radius: f.bore / 2 });
  if (show.fitting) fittingSide(d, { x: 0, y: f.housingDiameter / 2 }, s);
  if (beyond !== null) {
    const reach = f.baseLength / 2 + beyond;
    const up = f.holes === 4 ? reach : f.housingDiameter / 2 + beyond;
    d.lines.push([{ x: -reach, y: 0 }, { x: reach, y: 0 }], [{ x: 0, y: -up }, { x: 0, y: up }]);
    for (const c of holes) {
      const r = f.holeSize / 2 + beyond;
      d.lines.push([{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }], [{ x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }]);
    }
  }
  return d;
}
