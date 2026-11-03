// Split: click a point on an object to split it there. A line, arc, open polyline or open
// polygon becomes two objects that meet at the point. A closed polygon, rectangle or circle is
// opened there into one open shape that starts and ends at the point (the Vectorworks point
// split). The point is the snapped position, moved onto the object. Text, images and ellipses
// are refused. Splitting a full circle leaves it looking the same: it is still a full sweep.
// Line Split mode: drag (or click, click) a line across objects, and each one it crosses on the
// active layer is split wherever it crosses; a closed polygon or rectangle cut across becomes
// two closed polygons (a closed shape the line only reaches into is left alone). Shift constrains the line to 15° steps; Esc drops it.
// Line Trim mode draws the line the same way, then a click on one side of it removes every piece
// of the objects it crosses that lies on that side.
// A straight wall is split in two where the point lies along its line, or where the split line
// crosses it (Line Split), each part a wall of its own, square there; Line Trim leaves walls be.

import type { NewShape, ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import {
  distanceToPath,
  intersections,
  nearestParam,
  pathOf,
  pathOutline,
  pointAt,
  shapeOutline,
  splitAt,
  splitAtAll,
  type CutPath,
} from "../cutting.ts";
import { ANGLE_STEP_DEG, bboxIntersects, dist, normalizeRect, sideOf, snapAngle } from "../geom.ts";
import { pickObject, pickPx } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import {
  BaseTool,
  modeForKey,
  strokeScreen,
  withPreview,
  type Painter,
  type PointerInfo,
  type ToolModes,
} from "../tools.ts";

const UNSUPPORTED = "Split works on lines, arcs, polylines, polygons, rectangles and circles.";
const AT_END = "Click along the object, not at its end, to split it.";
const SYMBOL = "Split can't cut symbols.";
const CROSSES_NOTHING = "The line crosses nothing on the active layer to split.";
const NOTHING_THERE = "Nothing the line crosses lies on that side.";
const MARK_PX = 4;
const WALL = 68;
/** a press dragged this far draws the split line; a shorter one is its first click */
const DRAG_PX = 3;

/** A wall the split line crosses (or the pointer is over), and where on its line it would split. */
interface WallSplit {
  readonly id: string;
  readonly at: Pt;
}

/** An object the split line crosses: its path, where along it, and the shapes it becomes. */
interface Crossed {
  readonly id: string;
  readonly path: CutPath;
  readonly hits: readonly number[];
  readonly shapes: readonly NewShape[];
}

export class SplitTool extends BaseTool {
  readonly id = "split";
  readonly cursor = "crosshair";

  /** the object under the pointer, and the point a click would split it at */
  private target: { readonly path: CutPath; readonly at: Pt } | null = null;
  /** the wall under the pointer, and the point a click would split it at */
  private wallTarget: WallSplit | null = null;
  private mode: "point" | "line" | "trim" = "point";
  /** Line Trim: the drawn line and what it crosses, waiting for the side to trim */
  private cut: { readonly a: Pt; readonly b: Pt; readonly crossed: readonly Crossed[] } | null = null;
  /** the side of the cut the pointer is on (sideOf), which a click trims */
  private side = 0;
  /** Line Split: the line's start once pressed, its end following the pointer */
  private start: Pt | null = null;
  private startScreen: Pt = { x: 0, y: 0 };
  private end: Pt = { x: 0, y: 0 };
  private dragging = false;
  private crossed: readonly Crossed[] = [];
  private wallsCrossed: readonly WallSplit[] = [];

  modes(): ToolModes {
    return {
      options: [
        { id: "point", label: "Point Split", key: "1" },
        { id: "line", label: "Line Split", key: "2" },
        { id: "trim", label: "Line Trim", key: "3" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id !== "point" && id !== "line" && id !== "trim") return;
    this.mode = id;
    this.cancel();
  }

  hint(): string {
    if (this.mode === "point") return "Click the point to split at · 1–3 mode";
    if (this.cut) return "Click the side to trim away · Esc drops the line";
    if (!this.start) {
      const verb = this.mode === "trim" ? "trim" : "split";
      return `Drag or click a line across the objects to ${verb} · 1–3 mode`;
    }
    if (this.dragging) return `Release to ${this.mode === "trim" ? "end the line" : "split what the line crosses"} · Shift ${ANGLE_STEP_DEG}°`;
    return `Click the line's end · Shift ${ANGLE_STEP_DEG}° · Esc drops it`;
  }

  down(p: PointerInfo): void {
    if (this.cut) {
      this.trimSide(sideOf(p.pos, this.cut.a, this.cut.b));
      return;
    }
    if (this.mode !== "point") {
      if (this.start) {
        this.finishLine(this.lineEnd(p));
        return;
      }
      this.start = p.pos;
      this.startScreen = p.screen;
      this.end = p.pos;
      this.dragging = true;
      this.crossed = [];
      return;
    }
    const obj = this.pick(p);
    if (!obj) {
      if (this.overSymbol(p)) toast(SYMBOL, "info");
      return;
    }
    const wall = this.wallSplit(obj, p.pos);
    if (wall) {
      attempt("Split", (s) => s.splitWall(wall.id, wall.at));
      this.wallTarget = null;
      return;
    }
    const path = obj.shape ? pathOf(obj.shape) : null;
    if (!path) {
      toast(UNSUPPORTED, "info");
      return;
    }
    const shapes = splitAt(path, nearestParam(path, p.pos));
    if (!path.closed && shapes.length < 2) {
      toast(AT_END, "info");
      return;
    }
    // one undo step: the object becomes its pieces, or one open shape for a closed object
    const id = obj.id;
    attempt("Split", (s) => s.replaceObjects([id], shapes));
    this.target = null;
  }

  move(p: PointerInfo): void {
    if (this.cut) {
      this.side = sideOf(p.pos, this.cut.a, this.cut.b);
      return;
    }
    if (this.mode !== "point") {
      if (!this.start) return;
      this.end = this.lineEnd(p);
      this.crossed = this.crossings(this.start, this.end);
      this.wallsCrossed = this.mode === "line" ? this.wallCrossings(this.start, this.end) : [];
      return;
    }
    const obj = this.pick(p);
    this.wallTarget = obj ? this.wallSplit(obj, p.pos) : null;
    const path = obj?.shape && !this.wallTarget ? pathOf(obj.shape) : null;
    this.target = path ? { path, at: pointAt(path, nearestParam(path, p.pos)) } : null;
  }

  up(p: PointerInfo): void {
    if (this.mode === "point" || !this.dragging) return;
    this.dragging = false;
    // a press dragged out is the whole line; a click leaves it waiting for its end
    if (this.start && dist(p.screen, this.startScreen) >= DRAG_PX) this.finishLine(this.lineEnd(p));
  }

  cancel(): void {
    this.target = null;
    this.wallTarget = null;
    this.start = null;
    this.dragging = false;
    this.crossed = [];
    this.wallsCrossed = [];
    this.cut = null;
    this.side = 0;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || (!this.start && !this.cut)) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    if (this.cut) {
      this.drawTrim(g);
      return;
    }
    if (this.mode !== "point") {
      this.drawLine(g);
      return;
    }
    const t = this.target ?? this.wallTarget;
    if (!t) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    if ("path" in t) {
      const outline = pathOutline(t.path);
      strokeScreen(g, outline.pts, outline.closed);
    } else this.outlineWall(g, t.id);
    // the point the object would be split at
    const s = g.toScreen(t.at);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, MARK_PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** The split line, the objects it crosses and where it cuts them. */
  private drawLine(g: Painter): void {
    const start = this.start;
    if (!start) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    for (const c of this.crossed) {
      const outline = pathOutline(c.path);
      strokeScreen(g, outline.pts, outline.closed);
    }
    for (const w of this.wallsCrossed) this.outlineWall(g, w.id);
    ctx.restore();
    withPreview(g, () => strokeScreen(g, [start, this.end], false));
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    const marks = [...this.crossed.flatMap((c) => c.hits.map((t) => pointAt(c.path, t))), ...this.wallsCrossed.map((w) => w.at)];
    for (const at of marks) {
      const s = g.toScreen(at);
      ctx.beginPath();
      ctx.arc(s.x, s.y, MARK_PX, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The line's end at the pointer: snapped, and in 15° steps from the start with Shift. */
  private lineEnd(p: PointerInfo): Pt {
    return this.start && p.shift ? snapAngle(this.start, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  /** Splits everything the line from the start to `end` crosses, as one undo step. */
  private finishLine(end: Pt): void {
    const start = this.start;
    this.cancel();
    if (!start || dist(start, end) === 0) return;
    const crossed = this.crossings(start, end);
    const walls = this.mode === "line" ? this.wallCrossings(start, end) : [];
    if (crossed.length === 0 && walls.length === 0) {
      toast(CROSSES_NOTHING, "info");
      return;
    }
    if (this.mode === "trim") {
      // the side to trim is the next click's
      this.cut = { a: start, b: end, crossed };
      return;
    }
    attempt("Split", (s) =>
      s.batch(() => {
        for (const c of crossed) s.replaceObjects([c.id], [...c.shapes]);
        for (const w of walls) s.splitWall(w.id, w.at);
      }),
    );
  }

  /** Line Trim: removes the pieces on `side` of the cut from everything it crosses, as one undo step. */
  private trimSide(side: number): void {
    const cut = this.cut;
    if (!cut || side === 0) return;
    const edits = cut.crossed.map((c) => ({ id: c.id, keep: c.shapes.filter((s) => sideOfShape(s, cut.a, cut.b) !== side) }));
    if (edits.every((e, i) => e.keep.length === cut.crossed[i].shapes.length)) {
      toast(NOTHING_THERE, "info");
      return;
    }
    this.cancel();
    attempt("Trim", (s) =>
      s.batch(() => {
        for (const e of edits) {
          if (e.keep.length === 0) s.deleteObjects([e.id]);
          else s.replaceObjects([e.id], [...e.keep]);
        }
      }),
    );
  }

  /** Line Trim waiting for its side: the line, and the pieces a click on the pointer's side removes. */
  private drawTrim(g: Painter): void {
    const cut = this.cut;
    if (!cut) return;
    withPreview(g, () => strokeScreen(g, [cut.a, cut.b], false));
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;
    for (const c of cut.crossed) {
      for (const s of c.shapes) {
        if (this.side === 0 || sideOfShape(s, cut.a, cut.b) !== this.side) continue;
        const outline = shapeOutline(s);
        if (outline) strokeScreen(g, outline.pts, outline.closed);
      }
    }
    ctx.restore();
  }

  /**
   * The objects of the active layer (top-level, or inside the group being edited) that the line
   * from `a` to `b` crosses, with the shapes each becomes. Symbol contents are never cut.
   */
  private crossings(a: Pt, b: Pt): Crossed[] {
    const layerId = store.activeLayerId;
    const doc = this.env.scene.document;
    if (!layerId || !doc) return [];
    const line: CutPath = { kind: "chain", source: "line", pts: [a, b], closed: false };
    const box = normalizeRect(a, b);
    const out: Crossed[] = [];
    for (const e of this.env.scene.topLevelEntries(layerId, store.editGroupId)) {
      if (!e.visible || !e.bbox || !bboxIntersects(e.bbox, box) || isDerivedId(e.id)) continue;
      const obj = doc.object(e.id);
      const path = obj?.shape ? pathOf(obj.shape) : null;
      if (!path) continue;
      const hits = intersections(path, [line]);
      // a line that only reaches into a closed shape leaves it closed
      if (path.closed && hits.length < 2) continue;
      const shapes = splitAtAll(path, hits);
      // a cut at an open object's very end leaves it whole
      if (shapes.length > (path.closed ? 0 : 1)) out.push({ id: e.id, path, hits, shapes });
    }
    return out;
  }

  /** The walls of the active layer (or of the group being edited) whose line the line from `a` to `b` crosses, and where. */
  private wallCrossings(a: Pt, b: Pt): WallSplit[] {
    const layerId = store.activeLayerId;
    const doc = this.env.scene.document;
    if (!layerId || !doc) return [];
    const box = normalizeRect(a, b);
    const out: WallSplit[] = [];
    for (const e of this.env.scene.topLevelEntries(layerId, store.editGroupId)) {
      if (!e.visible || !e.bbox || !bboxIntersects(e.bbox, box) || isDerivedId(e.id) || doc.object(e.id)?.type !== WALL) continue;
      const w = doc.wall(e.id);
      if (!w) continue;
      // where the two segments cross, as fractions along each
      const d = { x: w.end.x - w.start.x, y: w.end.y - w.start.y };
      const l = { x: b.x - a.x, y: b.y - a.y };
      const den = d.x * l.y - d.y * l.x;
      if (den === 0) continue;
      const t = ((a.x - w.start.x) * l.y - (a.y - w.start.y) * l.x) / den;
      const u = ((a.x - w.start.x) * d.y - (a.y - w.start.y) * d.x) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push({ id: e.id, at: { x: w.start.x + d.x * t, y: w.start.y + d.y * t } });
    }
    return out;
  }

  /** When `obj` is part of a wall: the wall, and the point of its line nearest `pos`. */
  private wallSplit(obj: ObjectInfo, pos: Pt): WallSplit | null {
    const id = this.wallOf(obj);
    const w = id ? this.env.scene.document?.wall(id) : null;
    if (!id || !w) return null;
    const d = { x: w.end.x - w.start.x, y: w.end.y - w.start.y };
    const t = Math.max(0, Math.min(1, ((pos.x - w.start.x) * d.x + (pos.y - w.start.y) * d.y) / (d.x * d.x + d.y * d.y)));
    return { id, at: { x: w.start.x + d.x * t, y: w.start.y + d.y * t } };
  }

  /** The wall `o` draws (it, or a part of its plan drawing), else null. */
  private wallOf(o: ObjectInfo): string | null {
    if (isDerivedId(o.id)) return null;
    const unit = this.env.scene.unitOf(o, store.editGroupId);
    return unit !== null && this.env.scene.document?.object(unit)?.type === WALL ? unit : null;
  }

  /** Strokes a wall's plan drawing, in the style the caller has set. */
  private outlineWall(g: Painter, wallId: string): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    for (const o of this.env.scene.index(layerId).objects) {
      if (o.parentId !== wallId || !o.shape || o.shape.kind === "text") continue;
      strokeScreen(g, o.shape.points, o.shape.closed);
    }
  }

  /** True when the pointer is over symbol contents: they are never picked, but a click says why nothing happens. */
  private overSymbol(p: PointerInfo): boolean {
    const layerId = store.activeLayerId;
    if (!layerId) return false;
    const { scene, view } = this.env;
    return pickObject(scene, view, p.screen, [layerId], (o) => isDerivedId(o.id)) !== null;
  }

  /**
   * Topmost object of the active layer under the pointer that a click can split: top-level
   * objects, or the children of the group being edited, or a wall's drawing (anywhere on it).
   * Symbol contents are never picked. A filled shape is also hit from inside, but splitting works
   * on its outline only.
   */
  private pick(p: PointerInfo): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const { scene, view } = this.env;
    const scope = store.editGroupId;
    const hit = pickObject(scene, view, p.screen, [layerId], (o) => {
      if (isDerivedId(o.id)) return false;
      return (scope ? scene.unitOf(o, scope) !== null : o.parentId === null) || this.wallOf(o) !== null;
    });
    // a wall is split wherever its drawing is clicked
    if (hit && this.wallOf(hit)) return hit;
    const path = hit?.shape ? pathOf(hit.shape) : null;
    if (path && distanceToPath(path, p.raw) > pickPx() / view.scale) return null;
    return hit;
  }
}

/**
 * Which side of the line a–b a piece lies on (sideOf): judged by the middle of an open piece's
 * length, or the average of a closed piece's vertices (whose outline runs along the line).
 */
function sideOfShape(shape: NewShape, a: Pt, b: Pt): number {
  const outline = shapeOutline(shape);
  if (!outline || outline.pts.length === 0) return 0;
  const pts = outline.pts;
  if (outline.closed) {
    const c = pts.reduce((m, p) => ({ x: m.x + p.x / pts.length, y: m.y + p.y / pts.length }), { x: 0, y: 0 });
    return sideOf(c, a, b);
  }
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (d >= left && d > 0) {
      const t = left / d;
      return sideOf({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }, a, b);
    }
    left -= d;
  }
  return sideOf(pts[pts.length - 1], a, b);
}
