// The previews a hatch, gradient or line type keeps beside it (type-119 records): PNGs drawn anew
// at each size its own have, when an editor changes it, so the Resources tiles and Vectorworks'
// Resource Manager show the change.

import type { ResourceInfo, ResourceKind, VwxDocument } from "../core/index.ts";

export interface PreviewSize {
  readonly width: number;
  readonly height: number;
}

/** the sizes a new resource's previews take when the drawing has none of its kind to go by */
const DEFAULT_SIZES: readonly PreviewSize[] = [
  { width: 256, height: 256 },
  { width: 64, height: 64 },
];

/**
 * The preview sizes for a resource of `kind`: those of `own` (the one edited or copied), else every
 * size the drawing's resources of that kind have (a new one is copied from one of them), else the
 * default squares.
 */
export function previewSizes(doc: VwxDocument, kind: ResourceKind, own?: ResourceInfo): readonly PreviewSize[] {
  if (own?.previewSizes?.length) return own.previewSizes;
  const byWidth = new Map<number, PreviewSize>();
  for (const r of doc.resources()) if (r.kind === kind) for (const z of r.previewSizes ?? []) if (!byWidth.has(z.width)) byWidth.set(z.width, z);
  return byWidth.size ? [...byWidth.values()] : DEFAULT_SIZES;
}

/** PNGs painted by `paint` at each size, keyed by width as the edit session takes them. */
export function previewPngs(sizes: readonly PreviewSize[], paint: (canvas: HTMLCanvasElement, width: number, height: number) => void): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const canvas = document.createElement("canvas");
  for (const { width, height } of sizes) {
    canvas.width = width;
    canvas.height = height;
    paint(canvas, width, height);
    const url = canvas.toDataURL("image/png");
    const bin = atob(url.slice(url.indexOf(",") + 1));
    out.set(width, Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return out;
}
