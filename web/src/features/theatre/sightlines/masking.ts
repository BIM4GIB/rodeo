// The masking a stage needs so that a critical seat sees no wing and no gap over the fly. Legs (side
// masking) and borders (across the top) are placed where the seat's sightline past the proscenium edge,
// or past the piece in front, is stopped: in plan for the legs, in section for the borders, from a low
// eye over the proscenium top. One seat and one eye serve both sides, as the stage is symmetrical. Pure:
// lengths in mm; plan across is positive toward stage left and up upstage; the section's house is
// positive into the house. It draws nothing and leaves out the rigging's loads and the cloth's hanging.

import type { StagePoint } from "../stage.ts";

/** The last leg sits this far before the back wall, mm. */
export const LEG_CLEAR_MM = 1000;
/** How far a leg may reach past the wing before it is flagged, mm. */
export const OVERLAP_MM = 300;
/** A pleat's depth, and about how wide a pleat is, in model mm. */
export const PLEAT_DEPTH_MM = 150;
const PLEAT_MM = 600;

export interface MaskingInput {
  readonly prosWidthMm: number;
  readonly prosHeightMm: number;
  readonly stageDepthMm: number;
  /** leg pairs */
  readonly legs: number;
  /** the first leg's depth upstage of the plaster line */
  readonly firstLegUpMm: number;
  /** the clear opening wanted */
  readonly performingWidthMm: number;
  /** the height the performers need clear */
  readonly performingHeightMm: number;
  /** how far off stage the masking must reach */
  readonly wingWidthMm: number;
  readonly minLegWidthMm: number;
  /** the bottom of the first border wanted (the bottoms come down from it when a sightline asks) */
  readonly wantedTrimMm: number;
  /** the grid, or fly height at most */
  readonly gridHeightMm: number;
  /** the critical seat: how far off CL (the seat on stage right is worked; the other side mirrors it), and how far into the house from PL */
  readonly seatAcrossMm: number;
  readonly seatDownMm: number;
  /** the front row's centre eye above the stage floor */
  readonly frontEyeMm: number;
}

/** A point in the section: `house` positive into the house from PL, `height` above the stage floor, mm. */
export interface SectionPoint {
  readonly house: number;
  readonly height: number;
}

export interface LegPiece {
  /** 1 for the leg nearest the proscenium */
  readonly pair: number;
  readonly upMm: number;
  /** how far off CL its edge nearest CL sits, mm */
  readonly onstageMm: number;
  /** how far off CL its outer edge reaches, mm */
  readonly offstageMm: number;
  readonly widthMm: number;
  readonly flags: readonly string[];
}

export interface BorderPiece {
  readonly pair: number;
  readonly upMm: number;
  /** the bottom of the cloth, mm above the stage floor */
  readonly trimMm: number;
  /** the top of the cloth: the sightline past the piece in front, or the grid */
  readonly topMm: number;
  readonly clothMm: number;
  readonly flags: readonly string[];
}

export interface Solution {
  readonly legs: readonly LegPiece[];
  readonly borders: readonly BorderPiece[];
  readonly plan: {
    readonly seat: StagePoint;
    /** the sightline past each leg's onstage edge, to the back wall */
    readonly rays: readonly { readonly pair: number; readonly to: StagePoint }[];
    /** each leg as a pleated line on stage left, and on stage right (mirrored) */
    readonly legs: readonly { readonly pair: number; readonly left: readonly StagePoint[]; readonly right: readonly StagePoint[] }[];
  };
  readonly section: {
    readonly eye: SectionPoint;
    /** the sightline past each border's bottom, to the back wall */
    readonly rays: readonly { readonly pair: number; readonly to: SectionPoint }[];
  };
}

/** Across (mm) where the sightline from the seat at (-sx, -sd) through `pivot` crosses depth `up`. */
export function acrossAt(sx: number, sd: number, pivot: StagePoint, up: number): number {
  return -sx + ((pivot.across + sx) * (up + sd)) / (pivot.up + sd);
}

/** Height (mm) where the sightline from the eye (at depth -sd, height `e`) through `pivot` crosses depth `up`. */
export function heightAt(sd: number, e: number, pivot: { readonly up: number; readonly height: number }, up: number): number {
  return e + ((pivot.height - e) * (up + sd)) / (pivot.up + sd);
}

/** The depths of the leg pairs (and the borders beside them): evenly from the first to LEG_CLEAR_MM short of the back wall. */
export function legDepths(count: number, firstUp: number, depth: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [firstUp];
  const last = Math.max(firstUp, depth - LEG_CLEAR_MM);
  return Array.from({ length: n }, (_, i) => firstUp + (i * (last - firstUp)) / (n - 1));
}

/** A leg's pleated line across depth `up` from `from` to `to` (both off CL, on the same side): zig-zags PLEAT_DEPTH_MM either way about once every PLEAT_MM. */
export function pleatedLine(from: number, to: number, up: number): StagePoint[] {
  const pleats = Math.min(30, Math.max(2, Math.round(Math.abs(to - from) / PLEAT_MM)));
  const out: StagePoint[] = [];
  for (let k = 0; k <= 2 * pleats; k++) {
    const offset = k === 0 || k === 2 * pleats ? 0 : k % 2 === 1 ? PLEAT_DEPTH_MM : -PLEAT_DEPTH_MM;
    out.push({ across: from + ((to - from) * k) / (2 * pleats), up: up + offset });
  }
  return out;
}

/**
 * The masking for one critical seat. In plan each leg's onstage edge is where the sightline past the
 * piece before it crosses (the proscenium edge for the first), or the performing edge where that's nearer
 * CL; the leg's outer edge reaches the same sightline, so nothing shows past it. In section each border's
 * bottom is where the sightline over the piece before it crosses (the proscenium top for the first), at
 * most the wanted trim, and its top reaches that sightline or the grid.
 */
export function solveMasking(input: MaskingInput): Solution {
  const w = Math.max(0, input.prosWidthMm);
  const depth = Math.max(0, input.stageDepthMm);
  const sx = Math.abs(input.seatAcrossMm);
  const sd = Math.max(1, input.seatDownMm);
  const e = input.frontEyeMm;
  const minLeg = Math.max(0, input.minLegWidthMm);
  const depths = legDepths(input.legs, input.firstLegUpMm, depth);

  let pivot: StagePoint = { across: w / 2, up: 0 };
  const legs: LegPiece[] = [];
  const planRays: { pair: number; to: StagePoint }[] = [];
  const planLegs: { pair: number; left: StagePoint[]; right: StagePoint[] }[] = [];
  depths.forEach((up, i) => {
    const ray = acrossAt(sx, sd, pivot, up);
    const onstage = Math.min(input.performingWidthMm / 2, ray);
    const offstage = Math.max(onstage + minLeg, ray);
    const width = offstage - onstage;
    const flags: string[] = [];
    if (width > input.wingWidthMm + OVERLAP_MM) flags.push("Wider than the wing allows");
    legs.push({ pair: i + 1, upMm: up, onstageMm: onstage, offstageMm: offstage, widthMm: width, flags });
    planLegs.push({ pair: i + 1, left: pleatedLine(onstage, offstage, up), right: pleatedLine(-onstage, -offstage, up) });
    planRays.push({ pair: i + 1, to: { across: acrossAt(sx, sd, { across: onstage, up }, depth), up: depth } });
    pivot = { across: onstage, up };
  });

  let past = { up: 0, height: input.prosHeightMm };
  const borders: BorderPiece[] = [];
  const sectionRays: { pair: number; to: SectionPoint }[] = [];
  depths.forEach((up, i) => {
    const ray = heightAt(sd, e, past, up);
    const trim = Math.min(input.wantedTrimMm, ray);
    const top = Math.min(input.gridHeightMm, ray);
    const flags: string[] = [];
    if (ray > input.gridHeightMm) flags.push("The sightline is above the grid: the seat sees over it");
    if (trim < input.performingHeightMm) flags.push("Hangs under the performing height");
    borders.push({ pair: i + 1, upMm: up, trimMm: trim, topMm: top, clothMm: Math.max(0, top - trim), flags });
    past = { up, height: trim };
    sectionRays.push({ pair: i + 1, to: { house: -depth, height: heightAt(sd, e, past, depth) } });
  });

  return {
    legs,
    borders,
    plan: { seat: { across: -sx, up: -sd }, rays: planRays, legs: planLegs },
    section: { eye: { house: sd, height: e }, rays: sectionRays },
  };
}
