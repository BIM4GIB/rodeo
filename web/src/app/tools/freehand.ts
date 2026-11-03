// Freehand tool: press, drag and release to draw a hand-drawn stroke. The pointer
// path is kept as it is dragged (unsnapped), then simplified with Ramer-Douglas-Peucker
// into an open polyline. A stroke whose end comes back to its start closes into a
// polygon. Esc while dragging cancels the stroke. The modes set the smoothing, as
// Vectorworks' Freehand smoothing does: None keeps the simplified corners; Low,
// Medium and High simplify further and draw the vertices as bezier control
// points, so the stroke comes out as a smooth curve.

import { polylineOutline, type NewShape, type Pt, type VertexKind } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dist, distToSegment } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, strokeScreen, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

type Smoothing = "none" | "low" | "medium" | "high";

/** how far (CSS px) the simplified stroke may stray from the pointer path, for each smoothing */
const SIMPLIFY_PX: Readonly<Record<Smoothing, number>> = { none: 1.5, low: 3, medium: 6, high: 12 };

const SMOOTHING: readonly { readonly id: Smoothing; readonly label: string }[] = [
  { id: "none", label: "No Smoothing" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];
/** how close (CSS px) the end of a stroke must come to its start to close it */
const CLOSE_PX = 6;
/** pointer travel (CSS px) that counts as a drag rather than a click */
const CLICK_PX = 4;
const NO_LAYER = "Make a layer active to draw freehand.";

/**
 * Ramer-Douglas-Peucker: drops the points that lie within `tolerance` (document
 * units) of the path through their neighbours. The first and last points are kept.
 */
export function simplifyPath(pts: readonly Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const spans: Array<[number, number]> = [[0, pts.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [i, j] = span;
    let worst = -1;
    let worstDist = tolerance;
    for (let k = i + 1; k < j; k++) {
      const d = distToSegment(pts[k], pts[i], pts[j]);
      if (d > worstDist) {
        worst = k;
        worstDist = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      spans.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * The shape a stroke makes: an open polyline, or a closed polygon when the end
 * lands within CLOSE_PX of the start; smooth (its vertices bezier control points)
 * unless `smoothing` is none. Null when fewer than two points survive. `scale` is
 * CSS pixels per document unit.
 */
export function strokeShape(raw: readonly Pt[], scale: number, smoothing: Smoothing = "none"): NewShape | null {
  const pts = simplifyPath(raw, SIMPLIFY_PX[smoothing] / scale);
  const smooth = smoothing === "none" ? {} : { smooth: true };
  // a press that never travelled far enough is a click, not a stroke
  if (pts.length < 2 || pts.every((p) => dist(p, pts[0]) * scale <= CLICK_PX)) return null;
  // the repeated end point is dropped when closing; a polygon needs three vertices left
  if (pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) * scale <= CLOSE_PX) {
    return { kind: "polyline", points: pts.slice(0, -1), closed: true, ...smooth };
  }
  return { kind: "polyline", points: pts, closed: false, ...smooth };
}

export class FreehandTool extends BaseTool {
  readonly id = "freehand";
  readonly cursor = "crosshair";
  /** raw world points of the stroke being drawn; empty between strokes */
  private path: Pt[] = [];
  private smoothing: Smoothing = "none";

  modes(): ToolModes {
    return {
      label: "Smoothing",
      options: SMOOTHING.map((m, i) => ({ ...m, key: String(i + 1) })),
      active: this.smoothing,
    };
  }

  setMode(id: string): void {
    const m = SMOOTHING.find((s) => s.id === id);
    if (m) this.smoothing = m.id;
  }

  hint(): string {
    return this.path.length > 0
      ? "Release to finish the stroke"
      : "Drag to draw a stroke · 1–4 smoothing";
  }

  down(p: PointerInfo): void {
    if (!store.activeLayerId) {
      toast(NO_LAYER, "info");
      return;
    }
    this.path = [p.raw];
  }

  move(p: PointerInfo): void {
    if (this.path.length > 0) this.path.push(p.raw);
  }

  up(p: PointerInfo): void {
    if (this.path.length === 0) return;
    const raw = [...this.path, p.raw];
    this.path = [];
    const shape = strokeShape(raw, this.env.view.scale, this.smoothing);
    if (shape) addAndSelect(shape);
  }

  cancel(): void {
    this.path = [];
  }

  key(e: KeyboardEvent): boolean {
    const mode = this.path.length === 0 ? modeForKey(e, this.modes()) : null;
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || this.path.length === 0) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    if (this.path.length < 2) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    const pts = simplifyPath(this.path, SIMPLIFY_PX[this.smoothing] / g.scale);
    const curve = this.smoothing === "none" ? pts : polylineOutline(pts, pts.map((): VertexKind => "bezier"), false);
    strokeScreen(g, curve, false);
    ctx.restore();
  }
}
