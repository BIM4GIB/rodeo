// The wash planner's arithmetic: the instruments of one type that light an area of stage from one pipe,
// how far apart their focus points sit across and up it, where each hangs and aims, and the light they
// give on the focus plane. Pure, in stage terms: mm across from the centre line (+ stage left) and up
// from the plaster line. Spacing uses each pool's first-order size (its field across, stretched along
// the throw for depth), and the predicted light is worked out through photometry.ts. It leaves out what
// else hangs on the pipe and whether the pipe is long enough; Wash Planner places what this returns.

import { DEFAULT_TYPE, fixtureType } from "../fixture.ts";
import { coverage, type LuxStats, type Photometric } from "./photometry.ts";

/** A point in stage terms, mm. */
export interface StagePt {
  /** positive toward stage left */
  readonly across: number;
  /** positive upstage of the plaster line */
  readonly up: number;
}

export interface WashSpec {
  /** the catalogue type of the instrument */
  readonly typeKey: string;
  /** the area to cover, across, centred on the centre line; mm */
  readonly width: number;
  /** the area's size up the stage; mm */
  readonly depth: number;
  /** the area's downstage edge, up from the plaster line (negative for an apron); mm */
  readonly upFront: number;
  /** the pipe's position, up from the plaster line; mm */
  readonly hangUp: number;
  /** the lens height above the stage floor; mm */
  readonly heightMm: number;
  /** the focus plane's height above the stage floor; mm */
  readonly planeMm: number;
  /** how far neighbouring pools overlap, 0 to 0.8 */
  readonly overlap: number;
  readonly color: string;
  /** the colour of the McCandless units from stage right */
  readonly color2: string;
  /** the hanging position's name */
  readonly position: string;
  readonly purpose: string;
  readonly startUnit: number;
  readonly startChannel: number;
  /** every unit in a cell shares one channel, else each unit has its own */
  readonly oneChannelPerCell: boolean;
  /** two units per cell, half from each side, their beams about 45° from each side */
  readonly mccandless: boolean;
}

export interface WashFixture {
  /** the index of the focus point it lights in `cells` */
  readonly cell: number;
  /** where it hangs on the pipe, across from the centre line; mm */
  readonly across: number;
  readonly hangUp: number;
  readonly focus: StagePt;
  /** straight on, or from stage left or right for a McCandless unit */
  readonly side: "front" | "left" | "right";
  readonly color: string;
}

export interface WashPlan {
  /** the focus points, rows from downstage to upstage, each row from stage left across */
  readonly cells: readonly StagePt[];
  readonly fixtures: readonly WashFixture[];
  readonly rows: number;
  readonly cols: number;
  readonly count: number;
  /** the distance between focus points; mm */
  readonly spacing: { readonly across: number; readonly up: number };
  readonly watts: number;
  readonly weightKg: number;
  /** the light on the focus plane across the area (an estimate); null when there's no area */
  readonly predicted: LuxStats | null;
  readonly warnings: readonly string[];
}

/** rows of focus points the planner will make, most that one pipe can hold */
const MAX_ROWS = 12;
/** the grid the predicted light is worked out on */
const PREDICT_COLS = 48;
const PREDICT_ROWS = 32;
/** beams steeper than this, or flatter than the second, get a warning, degrees from the floor */
const STEEP_DEG = 60;
const FLAT_DEG = 30;

const radians = (deg: number): number => (deg * Math.PI) / 180;
const degrees = (rad: number): number => (rad * 180) / Math.PI;

/** The number of columns that cover `width` with focus points no further apart than `spacingMax`, and their even spacing. */
export function columnsFor(width: number, spacingMax: number): { readonly n: number; readonly spacing: number } {
  if (!(width > 0)) return { n: 1, spacing: 0 };
  if (!(spacingMax > 0)) return { n: 1, spacing: width };
  const n = Math.max(1, Math.ceil(width / spacingMax));
  return { n, spacing: width / n };
}

/**
 * Half of one unit's pool on the plane, across and up, mm. `horizA` and `horizU` are the unit's
 * horizontal distances from its hang to its focus, and `lift` the lens's height above the plane. The
 * pool is the field's half width across the throw, stretched by 1 / cos(angle from the vertical) along
 * the tilt.
 */
function poolHalves(horizA: number, horizU: number, lift: number, halfField: number): { readonly across: number; readonly up: number } {
  const tilt = Math.hypot(horizA, horizU);
  const throwLen = Math.hypot(lift, tilt);
  const b = throwLen * Math.tan(halfField);
  if (tilt < 1e-9) return { across: b, up: b };
  const a = b * (throwLen / lift);
  const tA = horizA / tilt;
  const tU = horizU / tilt;
  return { across: Math.sqrt(a * a * tA * tA + b * b * tU * tU), up: Math.sqrt(a * a * tU * tU + b * b * tA * tA) };
}

function emptyPlan(warnings: readonly string[]): WashPlan {
  return { cells: [], fixtures: [], rows: 0, cols: 0, count: 0, spacing: { across: 0, up: 0 }, watts: 0, weightKg: 0, predicted: null, warnings };
}

/**
 * Plans a wash: focus points in rows across the area, each lit by an instrument on the pipe straight
 * on (or, McCandless, one from each side at about 45°). The columns are set by the narrowest pool
 * across, the rows by the shallowest pool up, so every neighbour overlaps by at least `overlap`.
 */
export function planWash(spec: WashSpec): WashPlan {
  const type = fixtureType(spec.typeKey) ?? fixtureType(DEFAULT_TYPE)!;
  const lift = spec.heightMm - spec.planeMm;
  if (!(lift > 0)) return emptyPlan(["The lens must be higher than the focus height."]);
  const share = 1 - Math.min(0.8, Math.max(0, spec.overlap));
  const width = Math.max(0, spec.width);
  const depth = Math.max(0, spec.depth);
  const halfField = radians(type.fieldDeg) / 2;
  // a McCandless unit hangs across from its focus by the lift, so its beam comes in at 45°
  const offset = spec.mccandless ? lift : 0;
  const warnings: string[] = [];

  const rowsOf = (m: number): number[] => Array.from({ length: m }, (_, r) => spec.upFront + ((r + 0.5) * depth) / m);
  let rows = 1;
  let ups = rowsOf(1);
  // the widest spacing across that the narrowest pool allows, and whether the rows so far are close enough up
  let maxAcross = 0;
  let fits = false;
  for (let m = 1; m <= MAX_ROWS && !fits; m++) {
    ups = rowsOf(m);
    rows = m;
    const pools = ups.map((u) => poolHalves(offset, u - spec.hangUp, lift, halfField));
    maxAcross = Math.min(...pools.map((p) => 2 * p.across)) * share;
    const maxUp = Math.min(...pools.map((p) => 2 * p.up)) * share;
    fits = depth / m <= maxUp;
  }
  if (!fits) warnings.push(`The area is deeper than ${MAX_ROWS} rows of this pool, so only ${MAX_ROWS} are planned.`);
  const { n: cols, spacing: spacingAcross } = columnsFor(width, maxAcross);
  const across = Array.from({ length: cols }, (_, k) => -width / 2 + (k + 0.5) * spacingAcross);

  const cells: StagePt[] = [];
  for (const up of ups) for (const x of across) cells.push({ across: x, up });

  const fixtures: WashFixture[] = [];
  cells.forEach((cell, i) => {
    if (spec.mccandless) {
      fixtures.push({ cell: i, across: cell.across + offset, hangUp: spec.hangUp, focus: cell, side: "left", color: spec.color });
      fixtures.push({ cell: i, across: cell.across - offset, hangUp: spec.hangUp, focus: cell, side: "right", color: spec.color2 });
    } else fixtures.push({ cell: i, across: cell.across, hangUp: spec.hangUp, focus: cell, side: "front", color: spec.color });
  });

  // how steep the beams come down to the floor, from each unit's hang to its focus
  const angles = cells.map((cell) => degrees(Math.atan2(lift, Math.hypot(offset, cell.up - spec.hangUp))));
  const steepest = Math.max(...angles);
  const flattest = Math.min(...angles);
  if (steepest > STEEP_DEG) {
    warnings.push(
      `Some beams reach the floor at ${Math.round(steepest)}°, steeper than ${STEEP_DEG}°. ` + "A lower pipe, or one further from the area, flattens them.",
    );
  }
  if (flattest < FLAT_DEG) {
    warnings.push(
      `Some beams reach the floor at only ${Math.round(flattest)}°, under ${FLAT_DEG}°, so shadows will be long. ` +
        "A higher pipe, or one nearer the area, steepens them.",
    );
  }
  if (rows > 1) {
    warnings.push(
      `The area needs ${rows} rows of focus points, and each row's instruments hang at the same spots on this pipe. ` + "Each row needs a pipe of its own.",
    );
  }

  const predicted =
    width > 0 && depth > 0
      ? coverage(
          fixtures.map(
            (f): Photometric => ({
              at: { x: f.across, y: f.hangUp },
              heightMm: spec.heightMm,
              focus: { x: f.focus.across, y: f.focus.up, z: spec.planeMm },
              beamDeg: type.beamDeg,
              fieldDeg: type.fieldDeg,
              lumens: type.lumens,
              channel: "",
              color: f.color,
            }),
          ),
          () => 1,
          { x0: -width / 2, y0: spec.upFront, x1: width / 2, y1: spec.upFront + depth },
          PREDICT_COLS,
          PREDICT_ROWS,
          spec.planeMm,
        ).stats
      : null;

  return {
    cells,
    fixtures,
    rows,
    cols,
    count: fixtures.length,
    spacing: { across: spacingAcross, up: depth / rows },
    watts: fixtures.length * type.watts,
    weightKg: fixtures.length * type.weightKg,
    predicted,
    warnings,
  };
}
