// The audience's seats in the stage's frame, from its seat blocks (showTypes.ts). A straight block has
// rows across the house, each further row a row-spacing deeper into it. A curved block has rows as arcs
// about its centre (curveUpMm upstage of the plaster line; 0 means straight). Each row's eye rises by
// riseMm over the row in front. Row 1 is nearest the stage; seat 1 is on the audience's left (stage
// right, the lowest across). Pure: lengths in mm, across positive toward stage left, up upstage.

import type { Audience, SeatBlock } from "../showTypes.ts";

/** One seat, in the stage's frame. */
export interface Seat {
  /** the block's name */
  readonly block: string;
  /** 1 for the row nearest the stage */
  readonly row: number;
  /** 1 on the audience's left (stage right) */
  readonly seat: number;
  /** positive toward stage left, mm */
  readonly across: number;
  /** positive upstage of the plaster line, mm (negative in the house) */
  readonly up: number;
  /** the eye above the stage floor, mm */
  readonly eyeMm: number;
}

/** Whether a block's rows are arcs (its curve centre is off the plaster line). */
export function isCurved(b: SeatBlock): boolean {
  return b.curveUpMm !== 0;
}

/** A block's seats, row by row from the stage, each row seat by seat. */
export function blockSeats(b: SeatBlock): Seat[] {
  const rows = Math.max(0, Math.floor(b.rows));
  const perRow = Math.max(0, Math.floor(b.seatsPerRow));
  const first = { across: b.acrossMm, up: -b.downMm };
  const centre = { across: 0, up: b.curveUpMm };
  const radius = Math.hypot(first.across - centre.across, first.up - centre.up);
  const curved = isCurved(b) && radius > 0;
  // the first row's middle, as an angle about the centre (-90 degrees is straight downstage of it)
  const middle = Math.atan2(first.up - centre.up, first.across - centre.across);
  const out: Seat[] = [];
  for (let r = 0; r < rows; r++) {
    const eyeMm = b.eyeMm + r * b.riseMm;
    const R = radius + r * b.rowSpacingMm;
    for (let s = 0; s < perRow; s++) {
      // seats centred on the block's middle, spaced along the row (on the arc for a curve)
      const along = (s - (perRow - 1) / 2) * b.seatWidthMm;
      const at = curved
        ? { across: centre.across + R * Math.cos(middle + along / R), up: centre.up + R * Math.sin(middle + along / R) }
        : { across: b.acrossMm + along, up: first.up - r * b.rowSpacingMm };
      out.push({ block: b.name, row: r + 1, seat: s + 1, across: at.across, up: at.up, eyeMm });
    }
  }
  return out;
}

/** Every seat in the audience, block by block. */
export function seatsOf(audience: Audience): Seat[] {
  return audience.blocks.flatMap((b) => blockSeats(b));
}

/** How many seats the audience has. */
export function seatCount(audience: Audience): number {
  return audience.blocks.reduce((n, b) => n + Math.max(0, Math.floor(b.rows)) * Math.max(0, Math.floor(b.seatsPerRow)), 0);
}
