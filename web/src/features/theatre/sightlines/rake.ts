// The seating rake by the isoptic (C-value) method: each row's eye is set so that the sightline from the
// stage's focal point, over the head of the row in front, clears it by C. The risers are then rounded up to
// whole steps, so the clearance actually given is never less than C. Distances run from the focal point
// along the stage's front edge; heights are above the first row's floor unless a name says otherwise.
// Pure: lengths in mm, angles in degrees. It draws nothing; the section drawing is built from `rakeSection`.

/** A step riser over this needs an intermediate step for safe access, mm. */
export const RISER_LIMIT_MM = 190;
/** A floor steeper than this warns, degrees. */
export const RAKE_LIMIT_DEG = 35;
/** How far the stage block runs behind its front edge in the section sketch, mm. */
const STAGE_SKETCH_MM = 2000;

export interface RakeInput {
  /** the first row's distance from the focal point, mm */
  readonly firstRowMm: number;
  readonly spacingMm: number;
  readonly rows: number;
  /** a seated eye above its own floor, mm */
  readonly seatedEyeMm: number;
  /** the stage floor above the first row's floor, mm */
  readonly stageHeightMm: number;
  /** the focal point above the stage floor, mm (0 at the front edge) */
  readonly focalHeightMm: number;
  /** the clearance over each row's head, mm */
  readonly clearanceMm: number;
  /** the riser step: each riser is a whole number of these, mm */
  readonly stepMm: number;
}

export interface RakeRow {
  /** 1 for the row nearest the stage */
  readonly row: number;
  readonly distanceMm: number;
  /** the floor's rise above the first row's floor, mm */
  readonly riseMm: number;
  /** the step up into this row from the row in front (0 for the first), mm */
  readonly riserMm: number;
  /** the eye above the first row's floor, mm */
  readonly eyeMm: number;
  /** the eye above the focal point, mm (may be negative) */
  readonly eyeAboveFocalMm: number;
  /** the clearance over this row's head for the sightline to the next row's eye, mm; null for the last row */
  readonly clearanceMm: number | null;
  readonly flags: readonly string[];
}

export interface Rake {
  readonly rows: readonly RakeRow[];
  /** the average riser, mm (0 for a single row) */
  readonly averageRiserMm: number;
  /** the steepest floor between two rows, degrees */
  readonly steepestDeg: number;
  /** the floor's rise from the first row to the last, mm */
  readonly totalRiseMm: number;
  /** the least clearance any row gets, mm (null with one row) */
  readonly lowestClearanceMm: number | null;
}

/** A point in the section: `x` positive into the house from the stage's front edge, `y` above the first row's floor, mm. */
export interface SectionPoint {
  readonly x: number;
  readonly y: number;
}

/** The section's pieces, in section terms: the audience floor, the stage block, the focal point, each eye and its sightline. */
export interface RakeSection {
  readonly floor: readonly SectionPoint[];
  readonly stage: readonly SectionPoint[];
  readonly focal: SectionPoint;
  readonly eyes: readonly { readonly row: number; readonly at: SectionPoint }[];
  readonly rays: readonly { readonly row: number; readonly from: SectionPoint; readonly to: SectionPoint }[];
}

/** The eye (above the focal point) of the next row, so its sightline clears this row's eye by `clearance`: (R + C)(D + T) / D. */
export function nextEye(eye: number, clearance: number, distance: number, spacing: number): number {
  return ((eye + clearance) * (distance + spacing)) / distance;
}

/** The clearance a row's eye gets from the sightline to the next row's eye, which is `next` above the focal point: next D / (D + T) - eye. */
export function clearanceOf(eye: number, next: number, distance: number, spacing: number): number {
  return (next * distance) / (distance + spacing) - eye;
}

/** The rake: each row's riser, eye and clearance, with the flags a row needs. */
export function solveRake(input: RakeInput): Rake {
  const rows = Math.max(1, Math.floor(input.rows));
  const T = input.spacingMm;
  const step = Math.max(1, input.stepMm);
  const focalAbove = input.stageHeightMm + input.focalHeightMm;
  const distance = (n: number): number => input.firstRowMm + n * T;
  // the eyes above the focal point, one per row, from the risers each row needs rounded up to a step
  const eyes = [input.seatedEyeMm - focalAbove];
  const risers = [0];
  const clearances: (number | null)[] = [];
  for (let n = 0; n < rows - 1; n++) {
    const want = nextEye(eyes[n], input.clearanceMm, distance(n), T) - eyes[n];
    const riser = Math.ceil(want / step - 1e-9) * step;
    risers.push(riser);
    eyes.push(eyes[n] + riser);
    clearances.push(clearanceOf(eyes[n], eyes[n + 1], distance(n), T));
  }
  clearances.push(null);
  const out: RakeRow[] = [];
  for (let n = 0; n < rows; n++) {
    const flags: string[] = [];
    const slope = (Math.atan2(risers[n], T) * 180) / Math.PI;
    if (risers[n] > RISER_LIMIT_MM) flags.push("Riser over 190 mm: stair aisle needs intermediate tread");
    if (slope > RAKE_LIMIT_DEG) flags.push("Rake over 35°");
    out.push({
      row: n + 1,
      distanceMm: distance(n),
      riseMm: eyes[n] - eyes[0],
      riserMm: risers[n],
      eyeMm: eyes[n] + focalAbove,
      eyeAboveFocalMm: eyes[n],
      clearanceMm: clearances[n],
      flags,
    });
  }
  const totalRiseMm = eyes[rows - 1] - eyes[0];
  const known = clearances.filter((c): c is number => c !== null);
  return {
    rows: out,
    averageRiserMm: rows > 1 ? totalRiseMm / (rows - 1) : 0,
    steepestDeg: risers.reduce((m, r) => Math.max(m, (Math.atan2(r, T) * 180) / Math.PI), 0),
    totalRiseMm,
    lowestClearanceMm: known.length ? Math.min(...known) : null,
  };
}

/** The section's pieces for a solved rake: the floor stepping up under each row, the stage block with its front edge at x = 0, and each eye's sightline from the focal point. */
export function rakeSection(rake: Rake, input: RakeInput): RakeSection {
  const T = input.spacingMm;
  const focalY = input.stageHeightMm + input.focalHeightMm;
  const last = rake.rows[rake.rows.length - 1];
  const floor: SectionPoint[] = [{ x: 0, y: 0 }];
  rake.rows.forEach((r, n) => {
    floor.push({ x: r.distanceMm - T / 2, y: r.riseMm }, { x: r.distanceMm + T / 2, y: r.riseMm });
    const next = rake.rows[n + 1];
    if (next) floor.push({ x: r.distanceMm + T / 2, y: next.riseMm });
  });
  const stage = [
    { x: -STAGE_SKETCH_MM, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: input.stageHeightMm },
    { x: -STAGE_SKETCH_MM, y: input.stageHeightMm },
  ];
  const focal = { x: 0, y: focalY };
  const far = last.distanceMm + T;
  const eyes = rake.rows.map((r) => ({ row: r.row, at: { x: r.distanceMm, y: r.eyeMm } }));
  const rays = eyes.map((e) => ({
    row: e.row,
    from: focal,
    to: { x: far, y: focalY + ((e.at.y - focalY) * far) / e.at.x },
  }));
  return { floor, stage, focal, eyes, rays };
}
