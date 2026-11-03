// What the live renderer (live.ts, loaded with the 3D view) tells the Render palette (loaded with the
// editor): the model's materials and how far the picture has come. No three.js here.

import type { MaterialPresetId } from "./settings.ts";

/** One material of the model, as the palette lists it. */
export interface MaterialItem {
  /** materialKey: what its finish is kept under */
  readonly key: string;
  readonly label: string;
  /** CSS colour of its faces */
  readonly color: string;
  /** its texture's preview, when it has one */
  readonly preview: { readonly bytes: Uint8Array; readonly mime: string } | null;
  /** the finish "auto" gives it */
  readonly guess: Exclude<MaterialPresetId, "auto">;
  /** face groups using it */
  readonly count: number;
}

let materials: readonly MaterialItem[] = [];
let status = "";
const materialListeners = new Set<() => void>();
const statusListeners = new Set<(text: string) => void>();

/** The model's materials, as the live renderer last built them (empty before the first realistic frame). */
export function materialList(): readonly MaterialItem[] {
  return materials;
}

export function onMaterials(fn: () => void): () => void {
  materialListeners.add(fn);
  return () => materialListeners.delete(fn);
}

/** e.g. "Path traced · 128 of 256 samples", or "" when no realistic mode is drawing. */
export function renderStatus(): string {
  return status;
}

export function onStatus(fn: (text: string) => void): () => void {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

// ---- for live.ts ----

export function publishMaterials(items: readonly MaterialItem[]): void {
  materials = items;
  for (const fn of materialListeners) fn();
}

export function publishStatus(text: string): void {
  if (text === status) return;
  status = text;
  for (const fn of statusListeners) fn(text);
}
