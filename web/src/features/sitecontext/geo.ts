// Geography for Site Context: the local equirectangular projection about the area's centre (the
// metres per degree the spec gives), the area's size, the terrain zoom and grid, and the web-tile
// arithmetic the terrain service uses. No DOM, so check.ts can run it.

export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/** A rectangle in degrees, as Overpass and Nominatim describe boxes. */
export interface GeoBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Metres per degree of latitude, and of longitude at the equator (scaled by the cosine of the latitude). */
export const METRES_PER_DEG_LAT = 110540;
export const METRES_PER_DEG_LON = 111320;
/** The longest side a drawn area may have, metres. */
export const MAX_SIDE_M = 2000;

/** Web-mercator metres per pixel at zoom 0 (256-pixel tiles). */
const METRES_PER_PIXEL_Z0 = 156543.03392;
export const TILE_PX = 256;
export const MIN_TERRAIN_ZOOM = 10;
export const MAX_TERRAIN_ZOOM = 15;
/** Terrain samples across the area's longer side, at most. */
export const MAX_SAMPLES = 512;

const RAD = Math.PI / 180;

export interface Projection {
  readonly lat0: number;
  readonly lon0: number;
  readonly cos0: number;
}

/** The projection whose origin is `centre`. */
export function projectionAt(centre: GeoPoint): Projection {
  return { lat0: centre.lat, lon0: centre.lon, cos0: Math.cos(centre.lat * RAD) };
}

/** Metres east (x) and north (y) of the projection's origin. */
export function toMetres(p: Projection, pt: GeoPoint): { x: number; y: number } {
  return {
    x: (pt.lon - p.lon0) * p.cos0 * METRES_PER_DEG_LON,
    y: (pt.lat - p.lat0) * METRES_PER_DEG_LAT,
  };
}

/** The point `x` metres east and `y` metres north of the projection's origin. */
export function fromMetres(p: Projection, x: number, y: number): GeoPoint {
  return {
    lat: p.lat0 + y / METRES_PER_DEG_LAT,
    lon: p.lon0 + x / (p.cos0 * METRES_PER_DEG_LON),
  };
}

/** The box between two corners, whichever way round they are given. */
export function boxFromCorners(a: GeoPoint, b: GeoPoint): GeoBox {
  return {
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
    west: Math.min(a.lon, b.lon),
    east: Math.max(a.lon, b.lon),
  };
}

export function boxCentre(box: GeoBox): GeoPoint {
  return { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 };
}

/** The box's width (west to east) and height (south to north), in metres. */
export function boxSizeM(box: GeoBox): { width: number; height: number } {
  const c = boxCentre(box);
  return {
    width: (box.east - box.west) * Math.cos(c.lat * RAD) * METRES_PER_DEG_LON,
    height: (box.north - box.south) * METRES_PER_DEG_LAT,
  };
}

/** True when a side is longer than `max` metres (MAX_SIDE_M by default). */
export function boxTooLarge(box: GeoBox, max = MAX_SIDE_M): boolean {
  const { width, height } = boxSizeM(box);
  return width > max || height > max;
}

/** Metres across one pixel of web-mercator tiles at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (METRES_PER_PIXEL_Z0 * Math.cos(lat * RAD)) / 2 ** zoom;
}

/**
 * The terrain zoom: the coarsest zoom whose pixels are no larger than the spacing of MAX_SAMPLES
 * samples across the box's longer side. Areas up to 2 km square come out at 14 or 15.
 */
export function terrainZoom(box: GeoBox): number {
  const { width, height } = boxSizeM(box);
  const longest = Math.max(width, height, 1);
  const lat = boxCentre(box).lat;
  const z = Math.ceil(Math.log2((METRES_PER_PIXEL_Z0 * Math.cos(lat * RAD)) / (longest / MAX_SAMPLES)));
  return Math.min(MAX_TERRAIN_ZOOM, Math.max(MIN_TERRAIN_ZOOM, z));
}

/** Samples across (nx) and up (ny) the terrain grid: about one per pixel at `zoom`, at most MAX_SAMPLES. */
export function terrainGridSize(box: GeoBox, zoom: number): { nx: number; ny: number } {
  const { width, height } = boxSizeM(box);
  const m = metresPerPixel(boxCentre(box).lat, zoom);
  const count = (len: number): number => Math.min(MAX_SAMPLES, Math.max(3, Math.round(len / m) + 1));
  return { nx: count(width), ny: count(height) };
}

/** The global pixel position of a point at a zoom (web mercator, 256-pixel tiles). */
export function pixelOf(pt: GeoPoint, zoom: number): { px: number; py: number } {
  const scale = 2 ** zoom * TILE_PX;
  const r = pt.lat * RAD;
  return {
    px: ((pt.lon + 180) / 360) * scale,
    py: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale,
  };
}

/** The tiles that cover a box at a zoom: the first tile and the count across and down. */
export interface TileRange {
  readonly x0: number;
  readonly y0: number;
  readonly cols: number;
  readonly rows: number;
}

/** Tiles covering the box, one pixel past its edges each way so the samples can interpolate. */
export function tilesCovering(box: GeoBox, zoom: number): TileRange {
  const nw = pixelOf({ lat: box.north, lon: box.west }, zoom);
  const se = pixelOf({ lat: box.south, lon: box.east }, zoom);
  const x0 = Math.floor(nw.px / TILE_PX);
  const y0 = Math.floor(nw.py / TILE_PX);
  const x1 = Math.floor((se.px + 1) / TILE_PX);
  const y1 = Math.floor((se.py + 1) / TILE_PX);
  return { x0, y0, cols: x1 - x0 + 1, rows: y1 - y0 + 1 };
}
