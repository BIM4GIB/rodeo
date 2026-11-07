// The material library at runtime: each library material's textures (its colour, and the normal,
// roughness and metal maps it has), loaded from public/materials the first time a render asks for
// it and kept for the page's life. materials.ts clones them into a face's material at the face's
// real scale, and sceneBuilder.ts gives the faces the UVs and tangents a normal map needs. Under
// Node (the checks) there are no images to decode, so nothing is loaded there.

import * as THREE from "three";
import { LIBRARY, type LibraryEntry } from "./library.data.ts";
import type { RenderSettings } from "./settings.ts";

export { LIBRARY, type LibraryEntry, type LibraryCategory } from "./library.data.ts";

/** One library material's textures once loaded: the colour (sRGB) and the maps it has (linear), null where it has none. */
export interface LibraryTextures {
  readonly entry: LibraryEntry;
  readonly color: THREE.Texture;
  readonly normal: THREE.Texture | null;
  readonly rough: THREE.Texture | null;
  readonly metal: THREE.Texture | null;
}

/** The loaded textures by id, and the loads started (a failed one stays failed: no retry). */
const loaded = new Map<string, LibraryTextures>();
const started = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** The library entry with this id, or null. */
export function libraryEntry(id: string): LibraryEntry | null {
  return LIBRARY.find((entry) => entry.id === id) ?? null;
}

/** `${import.meta.env.BASE_URL}materials/${id}/${map}.webp` */
export function libraryUrl(id: string, map: "color" | "normal" | "rough" | "metal" | "thumb"): string {
  return `${import.meta.env.BASE_URL}materials/${id}/${map}.webp`;
}

/** The textures when loaded; else null, and starts loading them (onLibraryLoaded fires when they are). */
export function libraryTextures(id: string): LibraryTextures | null {
  if (typeof createImageBitmap === "undefined") return null;
  const done = loaded.get(id);
  if (done) return done;
  const entry = libraryEntry(id);
  if (entry) void start(entry);
  return null;
}

/** Loads every library material `settings.materials` names; resolves when each has loaded or failed. */
export async function prepareLibrary(settings: RenderSettings): Promise<void> {
  if (typeof createImageBitmap === "undefined") return;
  const waits: Promise<void>[] = [];
  for (const override of Object.values(settings.materials)) {
    const entry = override?.library ? libraryEntry(override.library) : null;
    if (entry) waits.push(start(entry));
  }
  await Promise.all(waits);
}

/** Calls `fn` each time a library material's textures finish loading; returns a function that stops it. */
export function onLibraryLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Starts loading `entry` once; the promise resolves when it has loaded or failed, and never rejects. */
function start(entry: LibraryEntry): Promise<void> {
  let job = started.get(entry.id);
  if (!job) {
    job = load(entry).then(
      (textures) => {
        loaded.set(entry.id, textures);
        for (const fn of listeners) fn();
      },
      (error: unknown) => {
        console.warn(`openvwx: library material ${entry.id} did not load`, error);
      },
    );
    started.set(entry.id, job);
  }
  return job;
}

/** The entry's maps: the colour, and each of the others it has, decoded side by side. */
async function load(entry: LibraryEntry): Promise<LibraryTextures> {
  const { id, maps } = entry;
  const [color, normal, rough, metal] = await Promise.all([
    decode(libraryUrl(id, "color"), THREE.SRGBColorSpace),
    maps.normal ? decode(libraryUrl(id, "normal"), THREE.NoColorSpace) : null,
    maps.rough ? decode(libraryUrl(id, "rough"), THREE.NoColorSpace) : null,
    maps.metal ? decode(libraryUrl(id, "metal"), THREE.NoColorSpace) : null,
  ]);
  return { entry, color, normal, rough, metal };
}

/**
 * An image as a texture that repeats. Decoded flipped, so v = 0 is the image's bottom row, the GL
 * convention the normal maps and the tangents from the UVs both assume.
 */
async function decode(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const texture = new THREE.Texture(bitmap);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
