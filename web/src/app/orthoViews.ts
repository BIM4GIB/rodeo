// The views View > Create Multiple Viewports draws (multipleViewports.ts) and how it lays them out:
// Front, Top, Right, Left, Bottom and Back looked at square on, and an isometric, each a frame for
// sectionView (sectionCut.ts) standing outside the model so nothing is cut and all of it is seen.
// Every view is centred on the model's centre, so views that share an axis with Front share its
// coordinates along it, and the layout lines them up: third angle projection puts Top above Front
// and Right to its right, first angle puts Top below and Left to its right; Back is at the far
// right either way. The isometric is Right Isometric in third angle and Left Isometric in first, in
// the corner the three usual views leave empty (top right in third angle, bottom right in first).

import type { BBox, Pt } from "../core/index.ts";
import type { SectionFrame } from "./sectionCut.ts";

type V = readonly [number, number, number];

export type OrthoView = "front" | "top" | "right" | "left" | "bottom" | "back" | "iso";
export type Method = "first" | "third";

export const ORTHO_VIEWS: readonly OrthoView[] = ["front", "top", "right", "left", "bottom", "back", "iso"];

/** each view's name, as Vectorworks' View menu has it */
export function viewName(view: OrthoView, method: Method): string {
  if (view === "iso") return method === "third" ? "Right Isometric" : "Left Isometric";
  return view[0].toUpperCase() + view.slice(1);
}

const R2 = Math.SQRT1_2;
const R3 = 1 / Math.sqrt(3);
const R6 = 1 / Math.sqrt(6);

/** across the view, up it and the way it looks; across × up points back at the viewer */
const AXES: Record<Exclude<OrthoView, "iso">, readonly [V, V, V]> = {
  front: [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
  back: [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  right: [[0, 1, 0], [0, 0, 1], [-1, 0, 0]],
  left: [[0, -1, 0], [0, 0, 1], [1, 0, 0]],
  top: [[1, 0, 0], [0, 1, 0], [0, 0, -1]],
  // seen from below with its front edge at the top, toward Front above it in third angle
  bottom: [[1, 0, 0], [0, -1, 0], [0, 0, 1]],
};
/** the eye front right and above (Right Isometric) or front left and above (Left Isometric) */
const RIGHT_ISO: readonly [V, V, V] = [[R2, R2, 0], [-R6, R6, 2 * R6], [-R3, R3, -R3]];
const LEFT_ISO: readonly [V, V, V] = [[R2, -R2, 0], [R6, R6, 2 * R6], [R3, R3, -R3]];

export function viewAxes(view: OrthoView, method: Method): readonly [V, V, V] {
  if (view === "iso") return method === "third" ? RIGHT_ISO : LEFT_ISO;
  return AXES[view];
}

/** The frame `view` is drawn in: through the middle of the model's box `lo`–`hi`, set back from all of it. */
export function orthoFrame(view: OrthoView, method: Method, lo: V, hi: V): SectionFrame {
  const [right, up, toward] = viewAxes(view, method);
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + 1;
  const origin: V = [c[0] - toward[0] * reach * 2, c[1] - toward[1] * reach * 2, c[2] - toward[2] * reach * 2];
  return { origin, right, up, toward, depth: Infinity, across: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity } };
}

/** The model's box `lo`–`hi` as `view` sees it: centred on 0, as wide and high as the box looks from there. */
export function seenBox(view: OrthoView, method: Method, lo: V, hi: V): BBox {
  const [right, up] = viewAxes(view, method);
  const half = (a: V): number => (Math.abs(a[0]) * (hi[0] - lo[0]) + Math.abs(a[1]) * (hi[1] - lo[1]) + Math.abs(a[2]) * (hi[2] - lo[2])) / 2;
  const w = half(right);
  const h = half(up);
  return { x0: -w, y0: -h, x1: w, y1: h };
}

/** column and row of each view (rows go down the sheet), Front in the middle */
const CELLS: Record<Method, Record<OrthoView, readonly [number, number]>> = {
  third: { top: [1, 0], iso: [2, 0], left: [0, 1], front: [1, 1], right: [2, 1], back: [3, 1], bottom: [1, 2] },
  first: { bottom: [1, 0], right: [0, 1], front: [1, 1], left: [2, 1], back: [3, 1], top: [1, 2], iso: [2, 2] },
};

/**
 * Where the middle of each view goes on the sheet, in mm, the views being `half` their size wide
 * and high: in a grid by `method`, `gap` apart, columns as wide and rows as high as their biggest
 * view, each view centred in its cell and the whole centred on (0, 0). Empty rows and columns take
 * no room.
 */
export function layOut(views: readonly { readonly view: OrthoView; readonly halfW: number; readonly halfH: number }[], method: Method, gap: number): Map<OrthoView, Pt> {
  const colW = new Map<number, number>();
  const rowH = new Map<number, number>();
  for (const v of views) {
    const [c, r] = CELLS[method][v.view];
    colW.set(c, Math.max(colW.get(c) ?? 0, v.halfW * 2));
    rowH.set(r, Math.max(rowH.get(r) ?? 0, v.halfH * 2));
  }
  const centres = (sizes: Map<number, number>): Map<number, number> => {
    const out = new Map<number, number>();
    let at = 0;
    for (const k of [...sizes.keys()].sort((a, b) => a - b)) {
      const size = sizes.get(k) ?? 0;
      out.set(k, at + size / 2);
      at += size + gap;
    }
    const total = at - gap;
    for (const [k, v] of out) out.set(k, v - total / 2);
    return out;
  };
  const xs = centres(colW);
  const ys = centres(rowH);
  const out = new Map<OrthoView, Pt>();
  for (const v of views) {
    const [c, r] = CELLS[method][v.view];
    out.set(v.view, { x: xs.get(c) ?? 0, y: -(ys.get(r) ?? 0) });
  }
  return out;
}
