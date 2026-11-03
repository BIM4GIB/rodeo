// The shared types of Site Context: what an import yields (features in world millimetres, with the
// y axis up), and the in-memory copy of the buildings and terrain the 3D overlay shows.

import type { Pt } from "../../core/index.ts";

/** The kinds of context: terrain, and the OpenStreetMap kinds. */
export type SiteCategory = "terrain" | "buildings" | "roads" | "paths" | "rail" | "water" | "green" | "trees" | "facilities";

export type SiteGeom =
  /** a closed outline */
  | { readonly kind: "polygon"; readonly points: readonly Pt[] }
  /** a line: open, or a loop when `closed` (a contour that closes on itself) */
  | { readonly kind: "polyline"; readonly points: readonly Pt[]; readonly closed?: boolean }
  /** a circle (a tree's canopy, a facility's marker) */
  | { readonly kind: "circle"; readonly at: Pt; readonly radius: number }
  /** a text label, at its anchor */
  | { readonly kind: "label"; readonly at: Pt; readonly text: string };

export interface SiteFeature {
  readonly cat: SiteCategory;
  readonly geom: SiteGeom;
  /** buildings: the height, metres */
  readonly heightM?: number;
}

/** A building in the 3D overlay: its footprint and where it stands, world millimetres. */
export interface ContextBuilding {
  readonly ring: readonly Pt[];
  readonly heightMm: number;
  /** height of its ground above the lowest point of the terrain, mm */
  readonly baseMm: number;
}

/** The terrain grid in the 3D overlay: samples from (x0, y0) every (dx, dy), row-major, heights above the lowest sample in mm. */
export interface ContextTerrain {
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly nx: number;
  readonly ny: number;
  readonly z: Float32Array;
}

/** One import's context, kept for the 3D view while its drawing is open. */
export interface ContextImport {
  readonly name: string;
  /** the design layer it was imported onto: the 3D view shows it while that layer is shown */
  readonly layer: string;
  readonly buildings: readonly ContextBuilding[];
  readonly terrain: ContextTerrain | null;
}
