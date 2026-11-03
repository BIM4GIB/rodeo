// Linesets: the fly lines (battens) a show hangs instruments and cloth from, as data, and the checks
// Stage > Linesets… and its hang plot read. A lineset's load is its own weight plus the instruments whose
// Position is its name; the other checks flag what sits too close to another line, to heat or to the
// grid, or a cloth that reaches below the floor at trim. Pure: lengths in mm, weights in kg. Leaves out
// the hoists and the rigging's own limits (PositionInfo) and anything the drawing doesn't say.

import type { Lineset, LinesetKind, VenueInfo } from "../showTypes.ts";
import type { Fixture } from "../fixture.ts";

/** The kinds a lineset can be, in the order the window lists them. */
export const LINESET_KINDS: readonly { readonly value: LinesetKind; readonly label: string }[] = [
  { value: "empty", label: "Empty" },
  { value: "electric", label: "Electric" },
  { value: "border", label: "Border" },
  { value: "leg", label: "Leg" },
  { value: "drop", label: "Drop" },
  { value: "scenery", label: "Scenery" },
  { value: "truss", label: "Truss" },
];

/** A kind as typed: its name in any case; anything else is "empty". */
export function kindOf(text: string): LinesetKind {
  const t = text.trim().toLowerCase();
  return LINESET_KINDS.find((k) => k.value === t)?.value ?? "empty";
}

/** The distances the checks use, mm. */
export const CLEARANCE = {
  /** two linesets closer than this are flagged */
  closeMm: 150,
  /** an electric within this of a drop or leg is flagged (heat and clearance) */
  heatMm: 300,
  /** an out trim this close to the grid is flagged */
  outGridMm: 1000,
} as const;

/** A new lineset's trim heights, mm: hung in at 6 m, flown out to 13 m. */
const IN_TRIM_MM = 6000;
const OUT_TRIM_MM = 13000;

/** A fresh id for a lineset. */
export function newLinesetId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "ls" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * `count` linesets from `firstUp` (upstage of the plaster line), `spacing` apart, numbered from `firstName`.
 * Each is an electric hung in at 6 m and flown out to 13 m, with no cloth and nothing on it yet.
 */
export function newLinesets(count: number, firstUp: number, spacing: number, battenMm: number, capacityKg: number, firstName = 1): Lineset[] {
  const out: Lineset[] = [];
  for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
    out.push({
      id: newLinesetId(),
      name: String(firstName + i),
      upMm: firstUp + i * spacing,
      battenMm,
      capacityKg,
      inTrimMm: IN_TRIM_MM,
      outTrimMm: OUT_TRIM_MM,
      kind: "electric",
      hung: "",
      weightKg: 0,
      clothMm: 0,
    });
  }
  return out;
}

/** What one lineset carries and what's wrong with it. */
export interface LinesetCheck {
  readonly id: string;
  /** the instruments whose Position is this lineset's name */
  readonly instruments: number;
  readonly instrumentKg: number;
  /** its own weight plus the instruments', kg */
  readonly usedKg: number;
  /** its capacity beyond its pipe, kg; 0 when not set (no limit) */
  readonly capacityKg: number;
  readonly overweight: boolean;
  readonly flags: readonly string[];
}

const kg = (n: number): string => `${Math.round(n * 10) / 10} kg`;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Each lineset's load and flags. The venue's checks (upstage of the stage depth, a batten wider than
 * the stage, trims above the grid) run only when there's a venue to check against.
 */
export function linesetProblems(linesets: readonly Lineset[], fixtures: readonly Fixture[], venue: VenueInfo | null): LinesetCheck[] {
  return linesets.map((ls) => {
    const hung = fixtures.filter((f) => f.position.trim() === ls.name.trim());
    const instrumentKg = sum(hung.map((f) => f.weightKg));
    const usedKg = ls.weightKg + instrumentKg;
    const overweight = ls.capacityKg > 0 && usedKg > ls.capacityKg;
    const flags: string[] = [];
    if (overweight) flags.push(`Overweight: ${kg(usedKg)} on ${kg(ls.capacityKg)}`);

    const close = linesets.filter((o) => o.id !== ls.id && Math.abs(o.upMm - ls.upMm) < CLEARANCE.closeMm);
    if (close.length) flags.push(`Within ${CLEARANCE.closeMm} mm of ${close.map((o) => o.name).join(", ")}`);

    if (ls.kind === "electric") {
      const near = linesets.filter((o) => (o.kind === "drop" || o.kind === "leg") && Math.abs(o.upMm - ls.upMm) < CLEARANCE.heatMm);
      if (near.length) flags.push(`Within ${CLEARANCE.heatMm} mm of ${near.map((o) => `${o.kind} ${o.name}`).join(", ")}`);
    }

    if (venue) {
      if (ls.upMm > venue.stageDepthMm) flags.push("Upstage of the stage depth");
      if (ls.battenMm > venue.stageWidthMm) flags.push("Batten wider than the stage");
      if (ls.inTrimMm > venue.gridHeightMm) flags.push("In trim above the grid");
      if (ls.outTrimMm > venue.gridHeightMm - CLEARANCE.outGridMm) flags.push(`Out trim within ${CLEARANCE.outGridMm / 1000} m of the grid`);
    }

    if ((ls.kind === "border" || ls.kind === "leg") && ls.clothMm > 0 && ls.inTrimMm - ls.clothMm < 0) flags.push("Cloth reaches below the floor at trim");

    return { id: ls.id, instruments: hung.length, instrumentKg, usedKg, capacityKg: ls.capacityKg, overweight, flags };
  });
}
