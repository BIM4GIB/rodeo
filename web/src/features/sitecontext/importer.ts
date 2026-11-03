// Site Context's import, without the dialog: fetches what was asked for, turns it into features in
// world millimetres (the area's centre at `offset`), and keeps the buildings and terrain for the 3D
// overlay. The pure parts (terrain features, the overlay's grid and building bases) are exported for
// check.ts.

import type { Pt } from "../../core/index.ts";
import {
  boxCentre,
  boxSizeM,
  fromMetres,
  pixelOf,
  projectionAt,
  terrainGridSize,
  terrainZoom,
  tilesCovering,
  toMetres,
  type GeoBox,
} from "./geo.ts";
import { clipFeatures } from "./clip.ts";
import { featuresFromOverpass, OSM_KINDS, overpassQuery, type OsmKind } from "./osm.ts";
import type { ContextBuilding, ContextImport, ContextTerrain, SiteCategory, SiteFeature } from "./model.ts";
import { fetchOverpass, fetchTerrainTile } from "./services.ts";
import { contours, gridHeightAt, gridRange, Mosaic, sampleGrid, simplifyContour } from "./terrain.ts";
import { polygonCentroid } from "./shapes.ts";

/** The terrain grid's frame: its size in metres, and how many samples it has across and up. */
export interface GridFrame {
  readonly nx: number;
  readonly ny: number;
  readonly widthM: number;
  readonly heightM: number;
}

/** Tolerance for simplifying a contour, in grid cells: the staircase of the samples is smoothed to this. */
const CONTOUR_TOLERANCE = 0.4;

/** The drawing point of a grid position (in cells), with the area's centre at `offset`. */
export function gridPoint(frame: GridFrame, offset: Pt, gx: number, gy: number): Pt {
  return {
    x: offset.x + (-frame.widthM / 2 + (gx * frame.widthM) / (frame.nx - 1)) * 1000,
    y: offset.y + (-frame.heightM / 2 + (gy * frame.heightM) / (frame.ny - 1)) * 1000,
  };
}

/** The grid position (in cells) of a drawing point: the inverse of gridPoint. */
export function gridCoordOf(frame: GridFrame, offset: Pt, p: Pt): { gx: number; gy: number } {
  const xm = (p.x - offset.x) / 1000;
  const ym = (p.y - offset.y) / 1000;
  return {
    gx: ((xm + frame.widthM / 2) * (frame.nx - 1)) / frame.widthM,
    gy: ((ym + frame.heightM / 2) * (frame.ny - 1)) / frame.heightM,
  };
}

/**
 * Contour lines for a grid of heights in metres. Every fifth height (a major contour) is labelled
 * once with its height, on its longest piece: a contour the edge of the area breaks into pieces
 * still gets one label.
 */
export function terrainFeatures(grid: Float32Array, frame: GridFrame, offset: Pt, interval: number): SiteFeature[] {
  const lines = contours(grid, frame.nx, frame.ny, interval).map((c) => ({
    c,
    pts: simplifyContour(c.points, c.closed, CONTOUR_TOLERANCE),
  }));
  const labelled = new Map<number, number>();
  lines.forEach(({ c, pts }, k) => {
    if (!c.major || pts.length < 2) return;
    const best = labelled.get(c.level);
    if (best === undefined || (lines[best].pts.length < pts.length)) labelled.set(c.level, k);
  });
  const out: SiteFeature[] = [];
  lines.forEach(({ c, pts }, k) => {
    if (pts.length < 2) return;
    const world = pts.map((p) => gridPoint(frame, offset, p.x, p.y));
    out.push({ cat: "terrain", geom: { kind: "polyline", points: world, closed: c.closed && pts.length >= 3 } });
    if (labelled.get(c.level) === k) {
      out.push({ cat: "terrain", geom: { kind: "label", at: world[Math.floor(world.length / 2)], text: `${c.level} m` } });
    }
  });
  return out;
}

/** The terrain grid for the 3D overlay: heights above its lowest sample, in mm. */
export function contextTerrain(grid: Float32Array, frame: GridFrame, offset: Pt): ContextTerrain {
  const min = gridRange(grid).min;
  const z = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) z[i] = Number.isFinite(grid[i]) ? (grid[i] - min) * 1000 : 0;
  const origin = gridPoint(frame, offset, 0, 0);
  const far = gridPoint(frame, offset, frame.nx - 1, frame.ny - 1);
  return {
    x0: origin.x,
    y0: origin.y,
    dx: (far.x - origin.x) / (frame.nx - 1),
    dy: (far.y - origin.y) / (frame.ny - 1),
    nx: frame.nx,
    ny: frame.ny,
    z,
  };
}

/**
 * The buildings for the 3D overlay: their footprints and heights, standing on the terrain under
 * their centre (measured above the lowest point of the terrain). With no terrain they stand at 0.
 */
export function contextBuildings(features: readonly SiteFeature[], frame: GridFrame | null, offset: Pt, grid: Float32Array | null): ContextBuilding[] {
  const out: ContextBuilding[] = [];
  const min = grid ? gridRange(grid).min : 0;
  for (const f of features) {
    if (f.cat !== "buildings" || f.geom.kind !== "polygon" || f.heightM === undefined) continue;
    const ring = f.geom.points.map((p) => ({ x: p.x, y: p.y }));
    let baseMm = 0;
    if (grid && frame) {
      const c = polygonCentroid(ring);
      const { gx, gy } = gridCoordOf(frame, offset, c);
      const h = gridHeightAt(grid, frame.nx, frame.ny, gx, gy);
      baseMm = Number.isFinite(h) ? (h - min) * 1000 : 0;
    }
    out.push({ ring, heightMm: f.heightM * 1000, baseMm });
  }
  return out;
}

export interface ImportRequest {
  readonly box: GeoBox;
  readonly kinds: ReadonlySet<SiteCategory>;
  readonly contourInterval: number;
  readonly labelHeights: boolean;
  readonly centreLines: boolean;
  /** where the area's centre goes, world millimetres */
  readonly offset: Pt;
}

export interface ImportResult {
  readonly features: SiteFeature[];
  readonly context: Omit<ContextImport, "name" | "layer">;
  /** how many terrain tiles were read (0 without terrain) */
  readonly tiles: number;
}

/** Reports a step of the import: a new step, or (sameStep) the progress of the current one. */
export type StepReport = (label: string, sameStep?: boolean) => void;

/**
 * Runs the import: one Overpass request for the OpenStreetMap kinds, the terrain tiles and the
 * contours. Throws on failure (an AbortError when the signal is aborted).
 */
export async function runImport(req: ImportRequest, signal: AbortSignal, step: StepReport): Promise<ImportResult> {
  const { box } = req;
  const proj = projectionAt(boxCentre(box));
  const { width, height } = boxSizeM(box);
  const toWorld = (lat: number, lon: number): Pt => {
    const m = toMetres(proj, { lat, lon });
    return { x: req.offset.x + m.x * 1000, y: req.offset.y + m.y * 1000 };
  };

  const features: SiteFeature[] = [];
  const osmKinds = OSM_KINDS.filter((k) => req.kinds.has(k));
  if (osmKinds.length > 0) {
    step("Fetching OpenStreetMap data");
    const kinds = new Set<OsmKind>(osmKinds);
    const data = await fetchOverpass(overpassQuery(box, kinds), signal);
    step("Reading the features");
    const area = {
      x0: req.offset.x - (width / 2) * 1000,
      y0: req.offset.y - (height / 2) * 1000,
      x1: req.offset.x + (width / 2) * 1000,
      y1: req.offset.y + (height / 2) * 1000,
    };
    const found = featuresFromOverpass(data, kinds, toWorld, { centreLines: req.centreLines, labelHeights: req.labelHeights });
    features.push(...clipFeatures(found, area));
  }

  let grid: Float32Array | null = null;
  let frame: GridFrame | null = null;
  let tileCount = 0;
  if (req.kinds.has("terrain")) {
    const zoom = terrainZoom(box);
    const { nx, ny } = terrainGridSize(box, zoom);
    frame = { nx, ny, widthM: width, heightM: height };
    const tiles = tilesCovering(box, zoom);
    tileCount = tiles.cols * tiles.rows;
    const mosaic = new Mosaic(zoom, tiles.x0, tiles.y0, tiles.cols, tiles.rows);
    step(`Fetching terrain tiles (zoom ${zoom})`);
    let done = 0;
    const jobs: Promise<void>[] = [];
    for (let ty = tiles.y0; ty < tiles.y0 + tiles.rows; ty++) {
      for (let tx = tiles.x0; tx < tiles.x0 + tiles.cols; tx++) {
        jobs.push(
          fetchTerrainTile(zoom, tx, ty, signal).then((heights) => {
            mosaic.setTile(tx, ty, heights);
            done++;
            step(`Fetching terrain tiles: ${done} of ${tileCount}`, true);
          }),
        );
      }
    }
    await Promise.all(jobs);
    step("Sampling the terrain");
    grid = sampleGrid(mosaic, nx, ny, (i, j) => {
      const g = fromMetres(proj, -width / 2 + (i * width) / (nx - 1), -height / 2 + (j * height) / (ny - 1));
      return pixelOf(g, zoom);
    });
    if (grid.some((v) => Number.isNaN(v))) throw new Error("The terrain tiles did not cover the whole area.");
    step("Drawing the contours");
    features.push(...terrainFeatures(grid, frame, req.offset, req.contourInterval));
  }

  const buildings = contextBuildings(features, frame, req.offset, grid);
  const terrain = grid && frame ? contextTerrain(grid, frame, req.offset) : null;
  return { features, context: { buildings, terrain }, tiles: tileCount };
}
