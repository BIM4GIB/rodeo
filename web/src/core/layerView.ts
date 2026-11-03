// A design layer's view, saved with the layer: Top/Plan, or a 3D view with its projection, render
// mode and camera. Layout (fixed offsets in every version seen, 2023 to 2026):
//   +0x168  3 × 3 f64 matrix M whose columns are the screen's right, up and toward-the-viewer
//           directions in the model, so model = M · (screen − t); the identity for Top/Plan
//   +0x1b0  f64 × 3 t, in mm: the screen origin is −M·t in the model, a perspective view's eye
//           or the point an orthogonal view is centred on (0 in Top/Plan)
//   +0x1c8  u8 projection: 6 Top/Plan (every sheet layer), 0 orthogonal, 1 perspective
//   +0x1ca  u8 render mode, as Vectorworks numbers them: 0 wireframe (Top/Plan always), 11 OpenGL
// Every demo file has design layers saved in 3D views (perspectives at eye height, a left
// isometric, elevations); their eyes and centres sit in and around the model.

import { f64, setF64 } from "./bytes.ts";
import type { LayerView, Vec3 } from "./types.ts";

const MATRIX = 0x168;
const ORIGIN = 0x1b0;
const PROJECTION = 0x1c8;
const RENDER_MODE = 0x1ca;
const END = RENDER_MODE + 1;

const PLAN = 6;
const ORTHOGONAL = 0;
const PERSPECTIVE = 1;

const PROJECTIONS: Record<LayerView["projection"], number | null> = { plan: PLAN, orthogonal: ORTHOGONAL, perspective: PERSPECTIVE, other: null };

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A layer record's view, or null when the record is too short to hold one. */
export function readLayerView(d: Uint8Array): LayerView | null {
  if (d.length < END) return null;
  const m = Array.from({ length: 9 }, (_, k) => f64(d, MATRIX + 8 * k));
  if (!m.every(Number.isFinite)) return null;
  const column = (j: number): Vec3 => [m[j], m[3 + j], m[6 + j]];
  const t = [0, 1, 2].map((k) => f64(d, ORIGIN + 8 * k));
  // −M·t
  const at = (i: number): number => -(m[3 * i] * t[0] + m[3 * i + 1] * t[1] + m[3 * i + 2] * t[2]);
  const p = d[PROJECTION];
  return {
    projection: p === PLAN ? "plan" : p === ORTHOGONAL ? "orthogonal" : p === PERSPECTIVE ? "perspective" : "other",
    renderMode: d[RENDER_MODE],
    right: column(0),
    up: column(1),
    toward: column(2),
    at: [at(0), at(1), at(2)],
  };
}

/** A copy of a layer record holding `view`; its right, up and toward must be at right angles and of length 1. */
export function writeLayerView(d: Uint8Array, view: LayerView): Uint8Array {
  if (d.length < END) throw new Error("this layer's record is too short to hold a view");
  const axes = [view.right, view.up, view.toward];
  const unit = axes.every((a) => a.length === 3 && a.every(Number.isFinite) && Math.abs(dot(a, a) - 1) < 1e-6);
  if (!unit || Math.abs(dot(view.right, view.up)) > 1e-6 || Math.abs(dot(view.right, view.toward)) > 1e-6 || Math.abs(dot(view.up, view.toward)) > 1e-6) {
    throw new Error("a view's axes must be unit length and at right angles");
  }
  const projection = PROJECTIONS[view.projection];
  if (projection === null) throw new Error("only Top/Plan, orthogonal and perspective views are written");
  if (!(Number.isInteger(view.renderMode) && view.renderMode >= 0 && view.renderMode <= 0xff) || !view.at.every(Number.isFinite)) {
    throw new Error("no such render mode or view point");
  }
  const out = d.slice();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) setF64(out, MATRIX + 8 * (3 * i + j), axes[j][i]);
  // t = −Mᵀ·at, M's columns being the axes
  for (let k = 0; k < 3; k++) setF64(out, ORIGIN + 8 * k, view.projection === "plan" ? 0 : -dot(axes[k], view.at));
  out[PROJECTION] = projection;
  out[RENDER_MODE] = view.renderMode;
  return out;
}

/** Top/Plan, as Vectorworks saves a layer in it. */
export const PLAN_VIEW: LayerView = { projection: "plan", renderMode: 0, right: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1], at: [0, 0, 0] };
