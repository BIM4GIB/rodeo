// A venue's plan for New Venue…: the walls, stage, seating and notes of one of five kinds (proscenium,
// thrust, arena, black box, traverse), laid out in stage terms (across: + stage left; up: + upstage of
// the plaster line) so newVenue.ts places each point through fromStage. Seats come as blocks
// (audienceOf): rows are drawn as one line each, never one per seat. Pure: no drawing, no page. Leaves
// out the structure above the stage, the rigging and the doors' heights, which the section shows.

import type { Audience, SeatBlock, VenueInfo } from "../showTypes.ts";
import type { StagePoint } from "../stage.ts";

export type VenueKind = VenueInfo["kind"];

/** The kinds, in the order New Venue offers them. */
export const VENUE_KINDS: readonly { readonly value: VenueKind; readonly label: string }[] = [
  { value: "proscenium", label: "Proscenium" },
  { value: "thrust", label: "Thrust" },
  { value: "arena", label: "Arena (in the round)" },
  { value: "blackbox", label: "Black Box" },
  { value: "traverse", label: "Traverse" },
];

/** The dimensions New Venue asks for, mm. Wings are the space each side of the stage floor. */
export interface VenueSpec {
  readonly kind: VenueKind;
  readonly stageWidthMm: number;
  readonly stageDepthMm: number;
  readonly prosWidthMm: number;
  readonly prosHeightMm: number;
  readonly apronMm: number;
  readonly wingMm: number;
  readonly gridHeightMm: number;
  readonly houseDepthMm: number;
  readonly rows: number;
  readonly seatsPerRow: number;
  readonly rowSpacingMm: number;
  readonly doorWidthMm: number;
  readonly doorHeightMm: number;
  readonly ironUpMm: number;
}

/** A plan's shapes: closed outlines, open lines, circles, solid fills and texts, the points of type P. */
export interface Sketch<P> {
  readonly outlines: P[][];
  readonly lines: P[][];
  readonly circles: { readonly center: P; readonly radius: number }[];
  readonly filled: P[][];
  texts: { readonly at: P; readonly text: string; readonly height: number; readonly justify: "left" | "centre" | "right"; readonly angle?: number }[];
}

export type StageSketch = Sketch<StagePoint>;

/** The venue's parts by class: walls (solid grey), the stage, the seating and the notes. */
export interface VenueParts {
  readonly walls: StageSketch;
  readonly stage: StageSketch;
  readonly seating: StageSketch;
  readonly notes: StageSketch;
}

/** A proscenium house of 10 m by 6 m, a 14 m by 10 m stage, 16 m grid: a sensible start. */
export const DEFAULT_VENUE: VenueSpec = {
  kind: "proscenium",
  stageWidthMm: 14000,
  stageDepthMm: 10000,
  prosWidthMm: 10000,
  prosHeightMm: 6000,
  apronMm: 1500,
  wingMm: 4000,
  gridHeightMm: 16000,
  houseDepthMm: 16000,
  rows: 10,
  seatsPerRow: 14,
  rowSpacingMm: 900,
  doorWidthMm: 2400,
  doorHeightMm: 2400,
  ironUpMm: 300,
};

/** A seat's width along its row, mm. */
const SEAT_MM = 500;
/** a seated eye above the floor it sits on, mm */
const EYE_MM = 1100;
/** clear floor between the front row and the stage's edge (or the walls), mm */
const AISLE_MM = 2000;
/** a wall's thickness, mm */
const WALL_MM = 300;
/** segments of the apron's curved lip */
const APRON_SEGMENTS = 24;
/** points along a curved row of seats */
const ROW_POINTS = 9;
/** how much each row's eye rises over the one in front, mm, by kind (raked seating) */
const RISE_MM: Readonly<Record<VenueKind, number>> = { proscenium: 120, thrust: 120, arena: 150, blackbox: 0, traverse: 0 };

const sp = (across: number, up: number): StagePoint => ({ across, up });
const rad = (deg: number): number => (deg * Math.PI) / 180;
const count = (n: number): number => Math.max(0, Math.round(n));

/** A rectangle over the stage's points, across from a0 to a1 and up from u0 to u1. */
function rect(a0: number, a1: number, u0: number, u1: number): StagePoint[] {
  return [sp(a0, u0), sp(a1, u0), sp(a1, u1), sp(a0, u1)];
}

/** A seat block straight across: its first row's middle `acrossMm` and `downMm` (into the house) from the plaster line. */
function straight(name: string, v: VenueSpec, acrossMm: number, downMm: number): SeatBlock {
  return {
    name,
    acrossMm,
    downMm,
    rows: count(v.rows),
    seatsPerRow: count(v.seatsPerRow),
    rowSpacingMm: v.rowSpacingMm,
    seatWidthMm: SEAT_MM,
    curveUpMm: 0,
    eyeMm: EYE_MM,
    riseMm: RISE_MM[v.kind],
  };
}

/** A seat block curved about the centre-line point `centreUp` upstage of the plaster line, its middle at `phiDeg` from the house (+ toward stage left). */
function ring(name: string, v: VenueSpec, centreUp: number, phiDeg: number, radiusMm: number): SeatBlock {
  const phi = rad(phiDeg);
  return {
    name,
    acrossMm: radiusMm * Math.sin(phi),
    downMm: -(centreUp - radiusMm * Math.cos(phi)),
    rows: count(v.rows),
    seatsPerRow: count(v.seatsPerRow),
    rowSpacingMm: v.rowSpacingMm,
    seatWidthMm: SEAT_MM,
    curveUpMm: centreUp,
    eyeMm: EYE_MM,
    riseMm: RISE_MM[v.kind],
  };
}

/** The blocks of a venue's audience, by kind. */
function blocksOf(v: VenueSpec): SeatBlock[] {
  const D = v.stageDepthMm;
  const A = v.apronMm;
  const last = Math.max(0, count(v.rows) - 1) * v.rowSpacingMm;
  const seatsWidth = count(v.seatsPerRow) * SEAT_MM;
  switch (v.kind) {
    case "proscenium":
      return [straight("Stalls", v, 0, A + AISLE_MM)];
    case "thrust": {
      const cu = Math.max(1, (D - A) / 2);
      const radius = cu + A + AISLE_MM;
      return [ring("Front", v, cu, 0, radius), ring("Stage left", v, cu, 90, radius), ring("Stage right", v, cu, -90, radius)];
    }
    case "arena": {
      const cu = Math.max(1, D / 2);
      const radius = Math.max(v.stageWidthMm, D) / 2 + AISLE_MM;
      return [ring("Downstage", v, cu, 0, radius), ring("Stage left", v, cu, 90, radius), ring("Upstage", v, cu, 180, radius), ring("Stage right", v, cu, -90, radius)];
    }
    case "blackbox": {
      // two loose blocks side by side at the far end of the room, away from the stage
      const down = Math.max(AISLE_MM, v.houseDepthMm - AISLE_MM - last);
      const half = seatsWidth / 2 + 500;
      return [straight("Stage left block", v, half, down), straight("Stage right block", v, -half, down)];
    }
    case "traverse":
      // the stage is seen from both long sides: rows in front, and rows behind (the far row first)
      return [straight("Downstage side", v, 0, AISLE_MM), straight("Upstage side", v, 0, -(D + AISLE_MM + last))];
  }
}

/** The seat blocks of a venue, in stage terms: the Audience the seating and the lighting section read. */
export function audienceOf(spec: VenueSpec): Audience {
  return { blocks: blocksOf(spec) };
}

/** The apron's lip: an arc through (±half, 0) and (0, -apron), its ends on the plaster line; straight when there's no apron. */
function apronLip(half: number, apron: number): StagePoint[] {
  if (apron <= 0 || half <= 0) return [sp(-half, 0), sp(half, 0)];
  const R = (half * half + apron * apron) / (2 * apron);
  const cy = -apron + R;
  const end = Math.asin(Math.min(1, half / R));
  const out: StagePoint[] = [];
  for (let i = 0; i <= APRON_SEGMENTS; i++) {
    const t = -end + (2 * end * i) / APRON_SEGMENTS;
    out.push(sp(R * Math.sin(t), cy - R * Math.cos(t)));
  }
  return out;
}

/** The room's walls: the back wall with a gap for the load-in door, both sides and the front, as solid rectangles. */
function roomWalls(x: number, front: number, back: number, door: { readonly across: number; readonly width: number }): StagePoint[][] {
  const lo = -x - WALL_MM;
  const hi = x + WALL_MM;
  const gapLo = door.across - door.width / 2;
  const gapHi = door.across + door.width / 2;
  const walls: StagePoint[][] = [];
  if (gapLo > lo) walls.push(rect(lo, Math.min(gapLo, hi), back, back + WALL_MM));
  if (gapHi < hi) walls.push(rect(Math.max(gapHi, lo), hi, back, back + WALL_MM));
  walls.push(rect(x, x + WALL_MM, front - WALL_MM, back + WALL_MM), rect(-x - WALL_MM, -x, front - WALL_MM, back + WALL_MM));
  walls.push(rect(lo, hi, front - WALL_MM, front));
  return walls;
}

/** A dashed line from `from` to `to` at height `up`: 20 dashes, each half the length of its gap pair. */
function dashes(from: number, to: number, up: number): StagePoint[][] {
  const step = (to - from) / 40;
  const out: StagePoint[][] = [];
  for (let i = 0; i < 40; i += 2) out.push([sp(from + i * step, up), sp(from + (i + 1) * step, up)]);
  return out;
}

/** The row of a block furthest from the plaster line: its last, or its first for a block upstage. */
function outermostRow(b: SeatBlock): number {
  if (b.curveUpMm !== 0) return b.rows - 1;
  return Math.abs(b.downMm) >= Math.abs(b.downMm + (b.rows - 1) * b.rowSpacingMm) ? 0 : b.rows - 1;
}

/** A row of seats as a polyline: straight across, or along an arc about the block's centre. */
function rowLine(b: SeatBlock, r: number, seats: number): StagePoint[] {
  const half = (seats * SEAT_MM) / 2;
  if (b.curveUpMm === 0) {
    const up = -(b.downMm + r * b.rowSpacingMm);
    return [sp(b.acrossMm + half, up), sp(b.acrossMm - half, up)];
  }
  const R0 = Math.hypot(b.acrossMm, b.downMm + b.curveUpMm);
  const phi = Math.atan2(b.acrossMm, b.downMm + b.curveUpMm);
  const R = R0 + r * b.rowSpacingMm;
  const a = half / R;
  const out: StagePoint[] = [];
  for (let i = 0; i < ROW_POINTS; i++) {
    const th = phi - a + (2 * a * i) / (ROW_POINTS - 1);
    out.push(sp(R * Math.sin(th), b.curveUpMm - R * Math.cos(th)));
  }
  return out;
}

/** The parts of a venue's plan by class, in stage terms, with its labels `labelMm` high. */
export function venueParts(v: VenueSpec, labelMm: number): VenueParts {
  const W = v.stageWidthMm;
  const D = v.stageDepthMm;
  const A = v.apronMm;
  const PW = v.prosWidthMm;
  const seats = count(v.seatsPerRow);
  const last = Math.max(0, count(v.rows) - 1) * v.rowSpacingMm;
  const cu = Math.max(1, D / 2);
  const door = { across: -W / 4, width: v.doorWidthMm };
  const wingX = W / 2 + v.wingMm;

  // the room's outer walls: the house and stage's ends and sides
  let x = wingX;
  let front = -v.houseDepthMm;
  let back = D;
  if (v.kind === "traverse") {
    front = -(2 * AISLE_MM + last);
    back = D + 2 * AISLE_MM + last;
  } else if (v.kind === "arena") {
    x = Math.max(W, D) / 2 + AISLE_MM + last + AISLE_MM;
    front = cu - x;
    back = cu + x;
  }
  const walls: StagePoint[][] = roomWalls(x, front, back, door);

  const stageOutlines: StagePoint[][] = [];
  const stageLines: StagePoint[][] = [];
  const texts: StageSketch["texts"][number][] = [];

  if (v.kind === "proscenium") {
    // the proscenium wall: two thick pieces either side of the opening; the apron's curved lip in the house
    walls.push(rect(PW / 2, wingX, -WALL_MM / 2, WALL_MM / 2), rect(-wingX, -PW / 2, -WALL_MM / 2, WALL_MM / 2));
    stageOutlines.push(apronLip(PW / 2, A));
    stageLines.push(...dashes(-PW / 2, PW / 2, v.ironUpMm));
    texts.push({ at: sp(PW / 2 + labelMm * 2, v.ironUpMm), text: "Iron", height: labelMm, justify: "left" });
  }
  // the stage floor: a thrust's runs out into the house by its apron
  const floorFront = v.kind === "thrust" ? -A : 0;
  stageOutlines.push(rect(-W / 2, W / 2, floorFront, D));

  // seating: one line per row, and each block's seat count beyond its last row
  const seatRows: StagePoint[][] = [];
  const seatCounts: StageSketch["texts"][number][] = [];
  const audience = audienceOf(v);
  for (const b of audience.blocks) {
    for (let r = 0; r < b.rows; r++) seatRows.push(rowLine(b, r, seats));
    if (b.rows === 0) continue;
    // the seat count sits beyond the block's outermost row, away from the stage
    const mid = rowLine(b, outermostRow(b), seats);
    const m = mid[Math.floor(mid.length / 2)];
    const dx = m.across;
    const dy = m.up - b.curveUpMm;
    const L = Math.hypot(dx, dy) || 1;
    const at = b.curveUpMm === 0 ? sp(m.across, m.up + Math.sign(m.up || -1) * labelMm * 2) : sp(m.across + (dx / L) * labelMm * 2, m.up + (dy / L) * labelMm * 2);
    seatCounts.push({ at, text: `${b.name}: ${b.rows * seats} seats`, height: labelMm, justify: "centre" });
  }

  // the arena's four vomitories: gaps between the blocks, two radial lines and a label each
  if (v.kind === "arena") {
    const R0 = Math.max(W, D) / 2 + AISLE_MM;
    const outer = R0 + last + labelMm;
    for (const deg of [45, 135, 225, 315]) {
      const phi = rad(deg);
      for (const side of [-1, 1]) {
        const d = Math.asin(Math.min(1, (side * 600) / R0));
        const along = (R: number): StagePoint => sp(R * Math.sin(phi + d), cu - R * Math.cos(phi + d));
        seatRows.push([along(R0 - 1000), along(outer)]);
      }
      texts.push({ at: sp((outer + labelMm * 2) * Math.sin(phi), cu - (outer + labelMm * 2) * Math.cos(phi)), text: "Vomitory", height: labelMm, justify: "centre" });
    }
  }

  // labels
  texts.push({ at: sp(0, (D + floorFront) / 2), text: "STAGE", height: labelMm * 1.5, justify: "centre" });
  if (v.kind === "traverse" || v.kind === "arena") texts.push({ at: sp(0, front - labelMm * 2), text: "HOUSE", height: labelMm * 1.5, justify: "centre" });
  else texts.push({ at: sp(0, -v.houseDepthMm / 2), text: "HOUSE", height: labelMm * 1.5, justify: "centre" });
  texts.push({ at: sp(x + WALL_MM + labelMm * 2, D / 2), text: "SL", height: labelMm, justify: "left" });
  texts.push({ at: sp(-(x + WALL_MM + labelMm * 2), D / 2), text: "SR", height: labelMm, justify: "right" });
  texts.push({ at: sp(door.across, back + WALL_MM + labelMm * 1.5), text: "Load-in door", height: labelMm, justify: "centre" });

  const none: Pick<StageSketch, "circles" | "filled"> = { circles: [], filled: [] };
  return {
    walls: { outlines: [], lines: [], texts: [], ...none, filled: walls },
    stage: { outlines: stageOutlines, lines: stageLines, texts: [], ...none },
    seating: { outlines: [], lines: seatRows, texts: seatCounts, ...none },
    notes: { outlines: [], lines: [], texts, ...none },
  };
}
