// The show data several parts of the Stage menu read, under their keys in show.ts. Pure types.

/** What hangs on a lineset. */
export type LinesetKind = "empty" | "electric" | "border" | "leg" | "drop" | "scenery" | "truss";

/** One fly line (or fixed pipe), in the stage's frame. An instrument hangs on it when its Position is the lineset's name. */
export interface Lineset {
  readonly id: string;
  /** its number or name, as paperwork calls it: "12", "1st Electric" */
  readonly name: string;
  /** upstage of the plaster line, mm */
  readonly upMm: number;
  readonly battenMm: number;
  /** what it can lift beyond its pipe, kg */
  readonly capacityKg: number;
  /** the batten's height when in at show trim, mm above the stage floor */
  readonly inTrimMm: number;
  /** the batten's height when flown out, mm above the stage floor */
  readonly outTrimMm: number;
  readonly kind: LinesetKind;
  /** what's on it, in words: "Black border 40' x 8'" */
  readonly hung: string;
  /** the weight of what's hung besides instruments, kg */
  readonly weightKg: number;
  /** a hung cloth's own height, mm, for borders, legs and drops (0 for none) */
  readonly clothMm: number;
}
export const LINESETS_KEY = "linesets";

/** One hanging position's limits, by its name (Fixture.position). Length and supports are for the load check. */
export interface PositionInfo {
  readonly name: string;
  /** rated load, kg (0 for not set) */
  readonly capacityKg: number;
  /** its length, mm (0 for worked out from what hangs on it) */
  readonly lengthMm: number;
  /** where it hangs from, mm along it from its stage-right end */
  readonly supportsMm: readonly number[];
  /** what one hoist or support may carry, kg (0 for not set) */
  readonly supportCapacityKg: number;
}
export const POSITIONS_KEY = "positions";

/** A block of audience seats in the stage's frame: rows straight across, or curved about the point `curveUpMm` upstage of the plaster line on the centre line (0 for straight). */
export interface SeatBlock {
  readonly name: string;
  /** the block's middle in the first row, stage terms: across from CL (+ stage left), down from PL (mm, positive into the house) */
  readonly acrossMm: number;
  readonly downMm: number;
  readonly rows: number;
  readonly seatsPerRow: number;
  readonly rowSpacingMm: number;
  readonly seatWidthMm: number;
  readonly curveUpMm: number;
  /** first row's eye above the stage floor (may be below 0 with a stage above the house floor), mm */
  readonly eyeMm: number;
  /** how much each row's eye rises over the one in front, mm */
  readonly riseMm: number;
}
export interface Audience {
  readonly blocks: readonly SeatBlock[];
}
export const AUDIENCE_KEY = "audience";

/** The venue's main dimensions, kept by New Venue… and Audit; mm. */
export interface VenueInfo {
  readonly kind: "proscenium" | "thrust" | "arena" | "blackbox" | "traverse";
  readonly prosWidthMm: number;
  readonly prosHeightMm: number;
  readonly stageDepthMm: number;
  readonly stageWidthMm: number;
  readonly apronMm: number;
  readonly gridHeightMm: number;
  /** the fire curtain's line, upstage of the plaster line (0 when on it) */
  readonly ironUpMm: number;
  /** the load-in door's clear size, for what must fit through it */
  readonly doorWidthMm: number;
  readonly doorHeightMm: number;
}
export const VENUE_KEY = "venue";

/** One piece of scenery built in the Scene Shop, for the cut list and the audit. */
export interface ShopPiece {
  readonly id: string;
  readonly kind: "flat" | "platform";
  readonly name: string;
  readonly widthMm: number;
  /** a flat's height; a platform's depth */
  readonly heightMm: number;
  /** a platform's top above the floor (0 for a flat) */
  readonly standMm: number;
  readonly count: number;
}
export const SHOP_KEY = "shop";

/** A named lighting state: levels 0 to 1 by channel, with its fade in seconds. */
export interface Look {
  readonly id: string;
  readonly name: string;
  readonly levels: Readonly<Record<string, number>>;
  readonly fadeSeconds: number;
}
export const LOOKS_KEY = "looks";
