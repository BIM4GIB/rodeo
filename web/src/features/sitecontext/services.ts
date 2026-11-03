// The network side of Site Context: Nominatim place search, the Overpass API, and AWS terrarium
// terrain tiles, decoded on an offscreen canvas. Each call takes an AbortSignal, so Cancel stops it.

import { TILE_PX, type GeoBox } from "./geo.ts";
import type { OverpassResponse } from "./osm.ts";
import { decodeTerrarium } from "./terrain.ts";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export interface Place {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** the place's extent, when Nominatim gives one */
  readonly box: GeoBox | null;
}

/** Places matching a search, best first. */
export async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const res = await fetch(`${NOMINATIM_URL}?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`);
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string; boundingbox?: string[] }[];
  return rows.map((r) => {
    const bb = r.boundingbox;
    const box: GeoBox | null =
      bb && bb.length === 4 ? { south: Number(bb[0]), north: Number(bb[1]), west: Number(bb[2]), east: Number(bb[3]) } : null;
    return { name: r.display_name, lat: Number(r.lat), lon: Number(r.lon), box };
  });
}

/** The Overpass answer to a query (one request). Throws with a reason the user can act on. */
export async function fetchOverpass(query: string, signal: AbortSignal): Promise<OverpassResponse> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429 || res.status === 504
        ? `The OpenStreetMap server is busy (HTTP ${res.status}). Try again in a minute, or pick a smaller area.`
        : `OpenStreetMap data could not be fetched (HTTP ${res.status}).`,
    );
  }
  const data = (await res.json()) as OverpassResponse;
  if (data.remark && /error/i.test(data.remark)) throw new Error(`OpenStreetMap could not answer: ${data.remark}`);
  return data;
}

/** One terrain tile as metres, row by row (256 × 256), decoded from its terrarium PNG. */
export async function fetchTerrainTile(zoom: number, x: number, y: number, signal: AbortSignal): Promise<Float32Array> {
  const res = await fetch(`${TERRARIUM_URL}/${zoom}/${x}/${y}.png`, { signal });
  if (!res.ok) throw new Error(`Terrain tile ${zoom}/${x}/${y} could not be fetched (HTTP ${res.status}).`);
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none" });
  try {
    const ctx = offscreenCanvas(TILE_PX).getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("A canvas is needed to read the terrain tiles.");
    ctx.drawImage(bitmap, 0, 0, TILE_PX, TILE_PX);
    return decodeTerrarium(ctx.getImageData(0, 0, TILE_PX, TILE_PX).data);
  } finally {
    bitmap.close();
  }
}

interface PixelContext {
  drawImage(image: ImageBitmap, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageData;
}

interface PixelCanvas {
  getContext(id: "2d", options?: { willReadFrequently?: boolean }): PixelContext | null;
}

/** A canvas that is never shown: an OffscreenCanvas where the browser has one. */
function offscreenCanvas(size: number): PixelCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(size, size) as unknown as PixelCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas as unknown as PixelCanvas;
}
