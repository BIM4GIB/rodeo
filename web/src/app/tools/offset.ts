// Offset tool: copies a line, polyline, polygon, rectangle, circle or arc at a
// distance, like Vectorworks' Offset tool. Click an object, then click the side to
// offset it towards; the copy is previewed under the cursor and a click places it.
// Closed shapes offset inwards when the cursor is inside them and outwards
// otherwise, open ones to the side of the nearest segment, and circles and arcs go
// concentric. Tab opens the data bar for the distance in mm. Esc drops the picked
// object. The tool stays active, and each copy takes the source's class and
// attributes. Its modes: Offset by Distance (1) or by Point (2), where the copy
// passes through the click and the distance follows the cursor; Duplicate (3)
// leaves the original where it is, Offset Original (4) moves it instead.

import type { NewShape, ObjectInfo, Pt, Shape, ShapeKind } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { dataBar, type BarField, type BarStage, type BarValues } from "../databar.ts";
import { distToPolyline, ellipsePoints, offsetPolyline, offsetRadius, offsetSide, dist } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { arcRadii, isClosedShape } from "../shapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

const DEFAULT_DISTANCE = 500;
const FIELD_DISTANCE: BarField = { key: "distance", label: "Distance", digits: 2 };
const OFFSET_STAGE: BarStage = { key: "offset", caption: "Offset", fields: [FIELD_DISTANCE] };
const OFFSETTABLE: ReadonlySet<ShapeKind> = new Set<ShapeKind>(["line", "polyline", "polygon", "rect", "arc"]);
const ARC_STEP_DEG = 2;
const MIN_ARC_STEPS = 16;

export class OffsetTool extends BaseTool {
  readonly id = "offset";
  readonly cursor = "crosshair";

  /** distance in mm; a typed value replaces it once it is placed or entered */
  private distance = DEFAULT_DISTANCE;
  /** the picked object, by id; null while choosing one */
  private source: string | null = null;
  /** object under the pointer while choosing */
  private hover: string | null = null;
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };
  /** the copy lies the set distance away, or passes through the click */
  private by: "distance" | "point" = "distance";
  /** a copy is placed, or the original is moved there */
  private keep: "duplicate" | "original" = "duplicate";

  modes(): readonly ToolModes[] {
    return [
      {
        label: "Offset",
        options: [
          { id: "distance", label: "By Distance", key: "1" },
          { id: "point", label: "By Point", key: "2" },
        ],
        active: this.by,
      },
      {
        label: "Original",
        options: [
          { id: "duplicate", label: "Duplicate", key: "3" },
          { id: "original", label: "Offset Original", key: "4" },
        ],
        active: this.keep,
      },
    ];
  }

  setMode(id: string): void {
    if (id === "distance" || id === "point") this.by = id;
    else if (id === "duplicate" || id === "original") this.keep = id;
  }

  hint(): string {
    if (!this.current()) return `Click an object to offset${this.by === "distance" ? " · Tab distance" : ""} · 1–4 modes`;
    return this.by === "distance" ? "Click the side to offset towards · Tab distance" : "Click the point the offset passes through";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
    const src = this.current();
    if (src) {
      this.place(src, p);
      return;
    }
    this.source = null;
    const hit = this.pick(p.screen);
    if (!hit?.shape) return;
    if (!OFFSETTABLE.has(hit.shape.kind)) {
      toast("Offset works on lines, polylines, polygons, rectangles, circles and arcs.", "info");
      return;
    }
    this.source = hit.id;
    this.hover = null;
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
    this.hover = this.current() ? null : (this.pick(p.screen)?.id ?? null);
  }

  cancel(): void {
    this.source = null;
    this.hover = null;
    this.pointer = null;
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key === "Tab") {
      if (!this.pointer) return false;
      dataBar.show();
      this.syncBar();
      return dataBar.focusField(e.shiftKey);
    }
    if (e.key === "Escape" && this.source !== null) {
      this.source = null;
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    dataBar.position(g.toScreen(p.pos), g);
    const src = this.current();
    const shape = src?.shape ?? null;
    if (!src || !shape) {
      const hit = this.hover ? this.object(this.hover) : null;
      if (hit?.shape && OFFSETTABLE.has(hit.shape.kind)) {
        const outline = hit.shape;
        highlight(g, () => strokeShape(g, outline));
      }
      return;
    }
    highlight(g, () => strokeShape(g, shape));
    const at = this.by === "point" ? p.pos : p.raw;
    const d = this.distanceFor(shape, at);
    if (d === null || !(d > 0)) return;
    const next = offsetOf(shape, at, d);
    if (next) withPreview(g, () => strokeNew(g, next));
  }

  /** The offset distance: the one set, or, by point, the distance from `at` to the shape. */
  private distanceFor(shape: Shape, at: Pt): number | null {
    return this.by === "point" ? distanceTo(shape, at) : this.liveDistance();
  }

  /** Places the copy of `src` on the side the click is on. */
  private place(src: ObjectInfo, p: PointerInfo): void {
    const shape = src.shape;
    const layerId = store.activeLayerId;
    if (!shape || !layerId) return;
    const at = this.by === "point" ? p.pos : p.raw;
    const d = this.distanceFor(shape, at);
    if (d === null || !(d > 0)) {
      toast(this.by === "point" ? "Click a point off the object." : "Enter an offset distance greater than 0.", "info");
      return;
    }
    const next = offsetOf(shape, at, d);
    if (!next) {
      toast("No offset at that distance on this side.", "info");
      return;
    }
    if (this.keep === "original") {
      // the original takes the offset shape, keeping its id, class and attributes
      if (!attempt("Offset", (s) => s.replaceObjects([src.id], [next]))) return;
      setEditGroup(null, [src.id]);
    } else {
      // one undo step: the copy takes the source's attributes as overrides
      const r = attempt("Offset", (s) => s.addObject(layerId, next, src.classIndex, src.attrs ?? undefined));
      if (!r) return;
      setEditGroup(null, [r.value]);
    }
    this.source = null;
    if (this.by === "distance") this.adopt(d);
  }

  private onBarCommit(values: BarValues): void {
    const d = values.distance;
    if (!(d > 0)) {
      toast("Enter an offset distance greater than 0.", "info");
      return;
    }
    this.adopt(d);
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Offset Preferences", [{ kind: "length", key: "distance", label: "Distance", value: this.distance }]);
    if (v) this.adopt(v.num("distance"));
  }

  /** Makes `d` the distance and drops any typed lock, so the bar shows it again. */
  private adopt(d: number): void {
    this.distance = d;
    dataBar.update({ distance: d });
    dataBar.release();
  }

  /** The distance the bar holds: a typed value while one is locked, else the stored one. Null when the typed text is not a number. */
  private liveDistance(): number | null {
    return dataBar.resolve({ distance: this.distance })?.distance ?? null;
  }

  private syncBar(): void {
    dataBar.setStage(OFFSET_STAGE, this.barHandlers);
    dataBar.update({ distance: this.distance });
    const p = this.pointer;
    if (p) dataBar.position(this.env.view.toScreen(p.pos), this.env.view);
  }

  /** Topmost object of the active layer under `screen`; contents of symbol instances are never picked. */
  private pick(screen: Pt): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], (o) => !isDerivedId(o.id));
  }

  private object(id: string): ObjectInfo | null {
    return store.session?.doc.object(id) ?? null;
  }

  /** The picked object, or null when it is gone or has left the active layer. */
  private current(): ObjectInfo | null {
    if (this.source === null) return null;
    const obj = this.object(this.source);
    return obj?.shape && obj.layerId === store.activeLayerId ? obj : null;
  }
}

/** The copy of `shape` at distance `d` (mm) on the side of `cursor`, or null when there is none. */
function offsetOf(shape: Shape, cursor: Pt, d: number): NewShape | null {
  if (shape.kind === "arc") {
    const centre = shape.center;
    const r = arcRadii(shape);
    if (!centre || !r || r.rx !== r.ry) return null;
    const inside = dist(cursor, centre) < r.rx;
    const radius = offsetRadius(r.rx, inside ? -d : d);
    if (radius === null) return null;
    return { kind: "arc", center: centre, radius, startAngle: shape.startAngle ?? 0, sweepAngle: shape.sweepAngle ?? 360 };
  }
  if (shape.kind !== "line" && shape.kind !== "polyline" && shape.kind !== "polygon" && shape.kind !== "rect") return null;
  const closed = isClosedShape(shape);
  const pts = offsetPolyline(shape.points, closed, offsetSide(cursor, shape.points, closed) * d);
  if (!pts) return null;
  if (shape.kind === "line") return { kind: "line", a: pts[0], b: pts[1] };
  return { kind: closed ? "polygon" : "polyline", points: pts, closed };
}

/** How far `p` is from the outline of `shape` (a circle's or arc's whole circle). */
function distanceTo(shape: Shape, p: Pt): number | null {
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    return shape.center && r && r.rx === r.ry ? Math.abs(dist(p, shape.center) - r.rx) : null;
  }
  return shape.points.length ? distToPolyline(p, shape.points, isClosedShape(shape)) : null;
}

function arcSteps(sweepDeg: number): number {
  return Math.max(MIN_ARC_STEPS, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
}

/** Solid accent outline of the object the tool is using or hovering over. */
function highlight(g: Painter, draw: () => void): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  draw();
  ctx.restore();
}

/** Strokes the outline of an existing shape in its current place. */
function strokeShape(g: Painter, shape: Shape): void {
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    if (!shape.center || !r) return;
    const sweep = shape.sweepAngle ?? 360;
    strokeScreen(g, ellipsePoints(shape.center, r.rx, r.ry, shape.startAngle ?? 0, sweep, arcSteps(sweep)), false);
    return;
  }
  strokeScreen(g, shape.points, isClosedShape(shape));
}

/** Strokes the copy the tool would place. */
function strokeNew(g: Painter, shape: NewShape): void {
  switch (shape.kind) {
    case "line":
      strokeScreen(g, [shape.a, shape.b], false);
      return;
    case "polygon":
    case "polyline":
      strokeScreen(g, shape.points, shape.closed);
      return;
    case "arc":
      strokeScreen(
        g,
        ellipsePoints(shape.center, shape.radius, shape.radius, shape.startAngle, shape.sweepAngle, arcSteps(shape.sweepAngle)),
        false,
      );
      return;
    default:
      return;
  }
}
