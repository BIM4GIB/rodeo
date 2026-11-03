// What Dims/Notes' Dimension Tape draws (tools/dimTape.ts), as plain geometry: the tape's line,
// hash marks at a set distance apart with subdivision marks between them, both centred on the
// line, and each hash mark's distance from the tape's 0 as a number beside it. Kept apart from the
// tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { placed } from "./detailShapes.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";

/** Which side of the tape its numbers go: above a level tape (right of an upright one), or below (left). */
export type TapeNumbers = "above" | "below";

export interface DimensionTape {
  /** between hash marks, mm */
  readonly spacing: number;
  /** evenly spaced marks between neighbouring hash marks */
  readonly subdivisions: number;
  readonly hashHeight: number;
  readonly subdivisionHeight: number;
  /** the numbers grow against the way the tape was drawn */
  readonly negative: boolean;
  readonly numbers: TapeNumbers;
  /** 0 at the tape's middle, moved along it by `centreOffset`, rather than at its start; the numbers run both ways from it */
  readonly fromCentre: boolean;
  readonly centreOffset: number;
}

/** marks no further than this share of a mark's spacing past the tape's ends still count as on it */
const END_SLACK = 1e-6;
/** the gap between a hash mark's end and its number, in text heights */
const NUMBER_GAP = 0.4;
/** hash marks a tape draws at most, so a tiny spacing can't stall the page */
const MAX_HASHES = 2000;

/**
 * A dimension tape from `a` to `b` with its numbers `h` high, each written by `label` from its
 * distance (mm, signed) from the tape's 0. Null when the tape has no length, the hash marks no
 * spacing, or they'd be more than MAX_HASHES.
 */
export function dimensionTape(a: Pt, b: Pt, t: DimensionTape, h: number, label: (mm: number) => string): MarkerDrawing | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0 && t.spacing > 0 && h > 0) || length / t.spacing > MAX_HASHES) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const zero = t.fromCentre ? length / 2 + t.centreOffset : 0;
  const sign = t.negative ? -1 : 1;
  // the side the numbers go, in the tape's own terms (+1 to the left of the way it runs)
  const left = { x: -Math.sin(angle), y: Math.cos(angle) };
  const leftIsAbove = left.y > 1e-9 || (Math.abs(left.y) <= 1e-9 && left.x > 0);
  const side = (t.numbers === "above") === leftIsAbove ? 1 : -1;
  // numbers read along the tape, turned the right way up
  const textAngle = (Math.cos(angle) < -1e-9 || (Math.abs(Math.cos(angle)) <= 1e-9 && Math.sin(angle) < 0) ? angle + Math.PI : angle) * (180 / Math.PI);

  const lines: Pt[][] = [[{ x: 0, y: 0 }, { x: length, y: 0 }]];
  const texts: MarkerText[] = [];
  const mark = (x: number, height: number): void => void lines.push([{ x, y: -height / 2 }, { x, y: height / 2 }]);
  const onTape = (x: number): boolean => x >= -END_SLACK * t.spacing && x <= length + END_SLACK * t.spacing;
  const subs = Math.max(0, Math.round(t.subdivisions));
  const first = Math.ceil((0 - zero) / t.spacing - END_SLACK);
  const last = Math.floor((length - zero) / t.spacing + END_SLACK);
  // subdivisions before the first hash mark and after the last count too
  for (let k = first - 1; k <= last; k++) {
    const x = zero + k * t.spacing;
    if (k >= first) {
      mark(x, t.hashHeight);
      // counted in whole spacings, so 0 reads as 0 and not a rounding error either side of it
      const value = k === 0 ? 0 : sign * k * t.spacing;
      texts.push({ at: { x, y: side * (t.hashHeight / 2 + (NUMBER_GAP + 0.5) * h) }, text: label(value), height: h, justify: "centre" });
    }
    for (let j = 1; j <= subs; j++) {
      const s = x + (j * t.spacing) / (subs + 1);
      if (onTape(s)) mark(s, t.subdivisionHeight);
    }
  }
  return {
    outlines: [],
    lines: lines.map((l) => placed(l, a, angle)),
    circles: [],
    filled: [],
    texts: texts.map((x) => ({ ...x, at: placed([x.at], a, angle)[0], angle: textAngle })),
  };
}
