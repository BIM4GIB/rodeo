// Trim: click the part of an object to cut away. The piece under the cursor, between the
// two nearest crossings with the other visible objects on the active layer, is previewed
// in the accent colour and removed on click. An open object is cut back to the nearest
// crossing on each side, or runs to its end where nothing crosses. A closed shape needs
// two crossings and is left as one open shape running the long way round. Rectangles and
// polygons become open polygons, arcs stay arcs, and an object with nothing left is deleted.

import type { NewShape, ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import {
  cutPieces,
  distanceToPath,
  intersections,
  keepOutside,
  nearestParam,
  pathOf,
  pathOutline,
  shapeOutline,
  trimRange,
  type CutPath,
} from "../cutting.ts";
import { pickObject, pickPx } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, strokeScreen, type Painter, type PointerInfo } from "../tools.ts";

const UNSUPPORTED = "Trim works on lines, polylines, polygons, rectangles and arcs.";
const NEEDS_TWO = "Needs two intersections to trim a closed shape";
const SYMBOL = "Trim can't cut symbols.";

/** What a click on an object would do: the piece it removes and what stays, or why nothing happens. */
interface Plan {
  /** the object's path, null when it cannot be trimmed */
  readonly path: CutPath | null;
  /** the piece a click removes, as shapes (empty when there is none) */
  readonly cut: readonly NewShape[];
  /** what stays of the object (empty: the object goes) */
  readonly keep: readonly NewShape[];
  /** why a click does nothing; "" when it trims */
  readonly reason: string;
}

export class TrimTool extends BaseTool {
  readonly id = "trim";
  readonly cursor = "crosshair";

  /** the object under the pointer and what a click would do to it */
  private target: Plan | null = null;

  hint(): string {
    return "Click the part to cut away";
  }

  down(p: PointerInfo): void {
    const obj = this.pick(p);
    if (!obj) {
      if (this.overSymbol(p)) toast(SYMBOL, "info");
      return;
    }
    const plan = this.plan(obj, p.raw);
    if (plan.reason) {
      toast(plan.reason, "info");
      return;
    }
    // one undo step; an object with nothing left goes away
    const id = obj.id;
    const keep = plan.keep;
    attempt("Trim", (s) => (keep.length === 0 ? s.deleteObjects([id]) : s.replaceObjects([id], [...keep])));
    this.target = null;
  }

  move(p: PointerInfo): void {
    const obj = this.pick(p);
    this.target = obj ? this.plan(obj, p.raw) : null;
  }

  cancel(): void {
    this.target = null;
  }

  overlay(g: Painter): void {
    const t = this.target;
    if (!t) return;
    if (t.cut.length > 0) {
      highlight(g, () => t.cut.forEach((s) => strokeNew(g, s)));
    } else if (t.path) {
      // can't be trimmed there: outline the object so the hover is still visible
      const outline = pathOutline(t.path);
      highlight(g, () => strokeScreen(g, outline.pts, outline.closed));
    }
  }

  /** What trimming `obj` at `at` would do. */
  private plan(obj: ObjectInfo, at: Pt): Plan {
    const path = obj.shape ? pathOf(obj.shape) : null;
    if (!path) return { path: null, cut: [], keep: [], reason: UNSUPPORTED };
    const hits = intersections(path, this.boundaries(obj.id));
    const range = trimRange(path, nearestParam(path, at), hits);
    if (!range) return { path, cut: [], keep: [], reason: NEEDS_TWO };
    return {
      path,
      cut: cutPieces(path, range.t0, range.t1),
      keep: keepOutside(path, range.t0, range.t1),
      reason: "",
    };
  }

  /** Paths of the other visible objects on the active layer: what a trim cuts against. */
  private boundaries(skip: string): CutPath[] {
    const layerId = store.activeLayerId;
    if (!layerId) return [];
    const scene = this.env.scene;
    const out: CutPath[] = [];
    for (const o of scene.index(layerId).objects) {
      if (o.id === skip || !o.shape || isDerivedId(o.id) || !scene.isObjectVisible(o)) continue;
      const path = pathOf(o.shape);
      if (path) out.push(path);
    }
    return out;
  }

  /** True when the pointer is over symbol contents: they are never picked, but a click says why nothing happens. */
  private overSymbol(p: PointerInfo): boolean {
    const layerId = store.activeLayerId;
    if (!layerId) return false;
    const { scene, view } = this.env;
    return pickObject(scene, view, p.screen, [layerId], (o) => isDerivedId(o.id)) !== null;
  }

  /**
   * Topmost object of the active layer under the pointer that a click can trim: top-level
   * objects, or the children of the group being edited. Symbol contents are never picked.
   * A filled shape is also hit from inside, but trimming works on its outline only.
   */
  private pick(p: PointerInfo): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const { scene, view } = this.env;
    const scope = store.editGroupId;
    const hit = pickObject(scene, view, p.screen, [layerId], (o) => {
      if (isDerivedId(o.id)) return false;
      return scope ? scene.unitOf(o, scope) !== null : o.parentId === null;
    });
    const path = hit?.shape ? pathOf(hit.shape) : null;
    if (path && distanceToPath(path, p.raw) > pickPx() / view.scale) return null;
    return hit;
  }
}

/** Solid accent stroke for the piece a click would remove. */
function highlight(g: Painter, draw: () => void): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.7;
  draw();
  ctx.restore();
}

/** Strokes the outline of a new shape in its place. */
function strokeNew(g: Painter, shape: NewShape): void {
  const o = shapeOutline(shape);
  if (o) strokeScreen(g, o.pts, o.closed);
}
