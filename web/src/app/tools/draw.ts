// Two-point drawing tools: line, rectangle, rounded rectangle, circle. Each takes either
// press-drag-release or click-click. Shift constrains the second point (lines to
// 15-degree steps, rectangles to squares). Tab opens the data bar for exact
// values: the first point takes X and Y (or the centre), the second takes L and
// A, dX and dY, or R, with the second point's X and Y (and a line's ΔX and ΔY)
// as the data bar's other fields. Enter places the point the typed values define.

import { roundedRectPoints, type BBox, type Pt } from "../../core/index.ts";
import { addAndSelect, inPlan } from "../commands.ts";
import {
  dataBar,
  FIELD_ANGLE,
  FIELD_DX,
  FIELD_DY,
  FIELD_LENGTH,
  FIELD_RADIUS,
  FIELD_X,
  FIELD_Y,
  type BarStage,
  type BarValues,
  typedPoint,
} from "../databar.ts";
import { ANGLE_STEP_DEG, dist, normalizeRect, polar, polarOf, snapAngle } from "../geom.ts";
import { store, type ToolId } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

/** pointer travel (CSS px) that counts as a drag rather than a click */
const CLICK_PX = 4;
const MIN_WORLD = 1e-9;
/** a rounded rectangle's corner radius as a share of its shorter side, until its preferences change it */
const CORNER_SHARE = 0.25;
/** a rounded rectangle's fixed corner radius in mm, until its preferences change it */
const CORNER_RADIUS = 300;

const LINE_START: BarStage = { key: "line-start", caption: "Start", fields: [FIELD_X, FIELD_Y] };
const LINE_END: BarStage = { key: "line-end", caption: "Segment", fields: [FIELD_LENGTH, FIELD_ANGLE, FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y], secondary: ["dx", "dy"] };
const RECT_START: BarStage = { key: "rect-start", caption: "Corner", fields: [FIELD_X, FIELD_Y] };
const RECT_END: BarStage = { key: "rect-end", caption: "Opposite", fields: [FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y] };
const CIRCLE_START: BarStage = { key: "circle-start", caption: "Centre", fields: [FIELD_X, FIELD_Y] };
const CIRCLE_END: BarStage = { key: "circle-end", caption: "Radius", fields: [FIELD_RADIUS, FIELD_X, FIELD_Y] };

abstract class TwoPointTool extends BaseTool {
  protected start: Pt | null = null;
  private pressScreen: Pt | null = null;
  private dragging = false;
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  protected abstract readonly firstStage: BarStage;
  protected abstract readonly secondStage: BarStage;

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.apply(this.placement(p), false, p.screen);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
  }

  up(p: PointerInfo): void {
    this.pointer = p;
    const wasDragging = this.dragging;
    this.dragging = false;
    if (!wasDragging || this.start === null || this.pressScreen === null) return;
    // a plain click keeps the start point and waits for the second click
    if (dist(p.screen, this.pressScreen) < CLICK_PX) return;
    this.apply(this.placement(p), false);
  }

  cancel(): void {
    this.reset();
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Tab") return this.focusBar(e.shiftKey);
    if (e.key === "Escape" && this.start !== null) {
      this.reset();
      this.syncBar();
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    dataBar.position(g.toScreen(this.cursorPoint(p)), g);
    if (this.start) this.preview(g, this.start, this.placement(p));
  }

  protected reset(): void {
    this.start = null;
    this.pressScreen = null;
    this.dragging = false;
  }

  protected endPoint(p: PointerInfo, _from: Pt): Pt {
    return p.pos;
  }

  /** Bar values for a cursor point; `start` is null while the first point is being placed. */
  protected abstract valuesAt(cursor: Pt, start: Pt | null): BarValues;
  /** The point that bar values define, given the cursor point (for directions). */
  protected abstract pointFromValues(values: BarValues, start: Pt | null, cursor: Pt): Pt;
  protected abstract commit(a: Pt, b: Pt): void;
  protected abstract preview(g: Painter, a: Pt, b: Pt): void;

  /** Places a point. The first starts the shape; the second completes it. */
  private apply(at: Pt, keyboard: boolean, press: Pt | null = null): void {
    if (this.start === null) {
      this.start = at;
      this.pressScreen = press;
      this.dragging = press !== null;
      this.syncBar();
      if (keyboard) dataBar.keepFocus();
      return;
    }
    const a = this.start;
    this.reset();
    dataBar.release();
    this.commit(a, at);
    this.syncBar();
  }

  private onBarCommit(values: BarValues): void {
    const p = this.pointer;
    if (!p) return;
    this.apply(this.pointFromValues(values, this.start, this.cursorPoint(p)), true);
  }

  /** The point a click or Enter places: the typed values while the bar holds any, else the cursor. */
  private placement(p: PointerInfo): Pt {
    const cursor = this.cursorPoint(p);
    if (!dataBar.hasLocks()) return cursor;
    const values = dataBar.resolve(this.valuesAt(cursor, this.start));
    return values ? this.pointFromValues(values, this.start, cursor) : cursor;
  }

  /** The cursor point: snapped, and constrained once the first point is set. */
  private cursorPoint(p: PointerInfo): Pt {
    return this.start ? this.endPoint(p, this.start) : p.pos;
  }

  private syncBar(): void {
    dataBar.setStage(this.start ? this.secondStage : this.firstStage, this.barHandlers);
    const p = this.pointer;
    if (!p) return;
    const cursor = this.cursorPoint(p);
    dataBar.update(this.valuesAt(cursor, this.start));
    // placed here as well as in overlay, so a freshly shown bar never flashes at its default spot
    dataBar.position(this.env.view.toScreen(cursor), this.env.view);
  }

  private focusBar(backwards: boolean): boolean {
    if (!this.pointer) return false;
    dataBar.show();
    this.syncBar();
    return dataBar.focusField(backwards);
  }
}

export class LineTool extends TwoPointTool {
  readonly id = "line";
  readonly cursor = "crosshair";
  protected readonly firstStage = LINE_START;
  protected readonly secondStage = LINE_END;

  hint(): string {
    return this.start
      ? `Click or release at the end point · Tab length, angle · Shift ${ANGLE_STEP_DEG}°`
      : "Click or drag to draw a line · Tab X, Y";
  }

  snapFrom(): Pt | null {
    return this.start;
  }

  protected endPoint(p: PointerInfo, from: Pt): Pt {
    return p.shift ? snapAngle(from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  protected valuesAt(cursor: Pt, start: Pt | null): BarValues {
    if (!start) return { x: cursor.x, y: cursor.y };
    const { length, angle } = polarOf(start, cursor);
    return { length, angle, dx: cursor.x - start.x, dy: cursor.y - start.y, x: cursor.x, y: cursor.y };
  }

  protected pointFromValues(values: BarValues, start: Pt | null): Pt {
    if (!start) return { x: values.x, y: values.y };
    return typedPoint(values, start) ?? polar(start, values.length, values.angle);
  }

  protected commit(a: Pt, b: Pt): void {
    if (dist(a, b) > MIN_WORLD) addAndSelect({ kind: "line", a, b });
  }

  protected preview(g: Painter, a: Pt, b: Pt): void {
    withPreview(g, () => strokeScreen(g, [a, b], false));
  }
}

export class RectTool extends TwoPointTool {
  readonly id: ToolId = "rect";
  readonly cursor = "crosshair";
  protected readonly firstStage = RECT_START;
  protected readonly secondStage = RECT_END;

  hint(): string {
    return this.start
      ? "Click or release at the opposite corner · Tab ΔX, ΔY · Shift square"
      : "Click or drag to draw a rectangle · Tab X, Y";
  }

  protected endPoint(p: PointerInfo, from: Pt): Pt {
    if (!p.shift) return p.pos;
    // square on screen, in a rotated plan too
    const { view } = this.env;
    const a = view.toPlan(from);
    const q = view.toPlan(p.pos);
    const dx = q.x - a.x;
    const dy = q.y - a.y;
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return view.fromPlan({ x: a.x + (dx < 0 ? -s : s), y: a.y + (dy < 0 ? -s : s) });
  }

  protected valuesAt(cursor: Pt, start: Pt | null): BarValues {
    if (!start) return { x: cursor.x, y: cursor.y };
    return { dx: cursor.x - start.x, dy: cursor.y - start.y, x: cursor.x, y: cursor.y };
  }

  protected pointFromValues(values: BarValues, start: Pt | null): Pt {
    if (!start) return { x: values.x, y: values.y };
    return typedPoint(values, start) ?? { x: start.x + values.dx, y: start.y + values.dy };
  }

  protected commit(a: Pt, b: Pt): void {
    const { view } = this.env;
    const box = boxOf(view.toPlan(a), view.toPlan(b));
    if (box) addAndSelect({ kind: "rect", ...box }, undefined, inPlan(view));
  }

  protected preview(g: Painter, a: Pt, b: Pt): void {
    const A = g.toScreen(a);
    const B = g.toScreen(b);
    withPreview(g, () => g.ctx.strokeRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y)));
  }
}

/** The box two corners span, or null when it has no area. */
export function boxOf(a: Pt, b: Pt): BBox | null {
  const box = normalizeRect(a, b);
  return box.x1 - box.x0 > MIN_WORLD && box.y1 - box.y0 > MIN_WORLD ? box : null;
}

function roundedOutline(box: BBox, rx: number, ry: number): Pt[] {
  const frame = { o: { x: box.x0, y: box.y0 }, u: { x: 1, y: 0 }, w: box.x1 - box.x0, h: box.y1 - box.y0 };
  return roundedRectPoints(frame, rx, ry);
}

type CornerMode = "proportional" | "fixed";

/**
 * A rectangle with rounded corners. Proportional corners round by a share of the
 * shorter side (a quarter at first); fixed ones by a set radius across and up,
 * kept to half the side. The mode bar switches them (keys 1, 2); Preferences sets
 * the share and the radii.
 */
export class RoundRectTool extends RectTool {
  override readonly id: ToolId = "roundrect";
  private corners: CornerMode = "proportional";
  private share = CORNER_SHARE;
  private rx = CORNER_RADIUS;
  private ry = CORNER_RADIUS;

  hint(): string {
    const corners =
      this.corners === "proportional"
        ? `${Math.round(this.share * 100)}% corners`
        : "Fixed corners";
    return this.start
      ? `Click or release at the opposite corner · ${corners} · Shift square`
      : "Click or drag to draw a rounded rectangle · Tab X, Y · 1–2 corners";
  }

  modes(): ToolModes {
    return {
      label: "Corners",
      options: [
        { id: "proportional", label: "Proportional", key: "1" },
        { id: "fixed", label: "Fixed", key: "2" },
      ],
      active: this.corners,
    };
  }

  setMode(id: string): void {
    if (id === "proportional" || id === "fixed") this.corners = id;
  }

  override key(e: KeyboardEvent): boolean {
    if ((e.key === "1" || e.key === "2") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.setMode(e.key === "1" ? "proportional" : "fixed");
      return true;
    }
    return super.key(e);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Rounded Rectangle Preferences", [
      { kind: "check", key: "proportional", label: "Proportional corners", value: this.corners === "proportional" },
      { kind: "number", key: "share", label: "Share of the shorter side", value: Math.round(this.share * 100), min: 1, max: 50, unit: "%" },
      { kind: "length", key: "rx", label: "Corner radius across", value: this.rx },
      { kind: "length", key: "ry", label: "Corner radius up", value: this.ry },
    ]);
    if (!v) return;
    this.corners = v.flag("proportional") ? "proportional" : "fixed";
    this.share = v.num("share") / 100;
    this.rx = v.num("rx");
    this.ry = v.num("ry");
  }

  /** The corner radii for `box`: a share of its shorter side, or the fixed radii kept to half of each side. */
  private radii(box: BBox): { readonly rx: number; readonly ry: number } {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (this.corners === "proportional") {
      const r = this.share * Math.min(w, h);
      return { rx: r, ry: r };
    }
    return { rx: Math.min(this.rx, w / 2), ry: Math.min(this.ry, h / 2) };
  }

  protected commit(a: Pt, b: Pt): void {
    const { view } = this.env;
    const box = boxOf(view.toPlan(a), view.toPlan(b));
    if (!box) return;
    const { rx, ry } = this.radii(box);
    // new objects copy their settings from one in the file; without a rounded rectangle there, its outline
    if (store.session?.canAdd("roundrect")) addAndSelect({ kind: "roundrect", ...box, rx, ry }, undefined, inPlan(view));
    else addAndSelect({ kind: "polygon", points: roundedOutline(box, rx, ry), closed: true }, undefined, inPlan(view));
  }

  protected preview(g: Painter, a: Pt, b: Pt): void {
    const { view } = this.env;
    const box = boxOf(view.toPlan(a), view.toPlan(b));
    if (!box) return;
    const { rx, ry } = this.radii(box);
    withPreview(g, () => strokeScreen(g, roundedOutline(box, rx, ry).map((q) => view.fromPlan(q)), true));
  }
}

export class CircleTool extends TwoPointTool {
  readonly id: ToolId = "circle";
  readonly cursor = "crosshair";
  protected readonly firstStage = CIRCLE_START;
  protected readonly secondStage = CIRCLE_END;

  hint(): string {
    return this.start
      ? "Click or release to set the radius · Tab radius"
      : "Click or drag from the centre · Tab X, Y";
  }

  protected valuesAt(cursor: Pt, start: Pt | null): BarValues {
    if (!start) return { x: cursor.x, y: cursor.y };
    return { radius: dist(start, cursor), x: cursor.x, y: cursor.y };
  }

  /** The radius is typed; its direction is the cursor's, so the circle still follows the mouse (a point typed on it decides both). */
  protected pointFromValues(values: BarValues, start: Pt | null, cursor: Pt): Pt {
    if (!start) return { x: values.x, y: values.y };
    const at = typedPoint(values, start);
    if (at) return at;
    const len = dist(start, cursor);
    const ux = len > MIN_WORLD ? (cursor.x - start.x) / len : 1;
    const uy = len > MIN_WORLD ? (cursor.y - start.y) / len : 0;
    return { x: start.x + ux * values.radius, y: start.y + uy * values.radius };
  }

  protected commit(center: Pt, edge: Pt): void {
    const radius = dist(center, edge);
    if (radius <= MIN_WORLD) return;
    addAndSelect({ kind: "arc", center, radius, startAngle: 0, sweepAngle: 360 });
  }

  protected preview(g: Painter, center: Pt, edge: Pt): void {
    const C = g.toScreen(center);
    const R = dist(C, g.toScreen(edge));
    withPreview(g, () => {
      g.ctx.beginPath();
      g.ctx.arc(C.x, C.y, R, 0, Math.PI * 2);
      g.ctx.stroke();
    });
  }
}
