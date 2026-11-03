// Oval tool: an ellipse fitted to a box, drawn by press-drag-release or click-click.
// The two points are opposite corners of the box. Shift makes it a circle (the
// larger side sets the radius), and Option draws from the centre, so the first point
// is the centre and the second sets the half-sizes. Tab opens the data bar for exact
// values: the first point takes X and Y, the opposite corner takes ΔX and ΔY (the
// half-sizes with Option), or its own X and Y. Enter places the point the typed
// values define.

import type { NewShape, Pt } from "../../core/index.ts";
import { addAndSelect, inPlan } from "../commands.ts";
import { dataBar, FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y, typedPoint, type BarStage, type BarValues } from "../databar.ts";
import { dist, ellipsePoints } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { ALT_KEY, BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";

/** pointer travel (CSS px) that counts as a drag rather than a click */
const CLICK_PX = 4;
const MIN_WORLD = 1e-9;
/** points per full turn in the dashed preview */
const PREVIEW_STEPS = 96;
const NO_LAYER = "Make a layer active to draw an oval.";

const START_STAGE: BarStage = { key: "oval-start", caption: "Corner", fields: [FIELD_X, FIELD_Y] };
const OPPOSITE_STAGE: BarStage = { key: "oval-end", caption: "Opposite", fields: [FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y] };

export interface OvalBox {
  readonly center: Pt;
  /** x radius */
  readonly rx: number;
  /** y radius */
  readonly ry: number;
}

/**
 * The oval a box makes. `a` and `b` are opposite corners, or the centre and a
 * corner when `fromCentre`. `circle` gives both radii the larger one. Null when
 * the box has no area.
 */
export function ovalBox(a: Pt, b: Pt, circle: boolean, fromCentre: boolean): OvalBox | null {
  let center: Pt;
  let rx: number;
  let ry: number;
  if (fromCentre) {
    center = a;
    rx = Math.abs(b.x - a.x);
    ry = Math.abs(b.y - a.y);
  } else {
    center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    rx = Math.abs(b.x - a.x) / 2;
    ry = Math.abs(b.y - a.y) / 2;
  }
  if (circle) rx = ry = Math.max(rx, ry);
  if (rx <= MIN_WORLD || ry <= MIN_WORLD) return null;
  return { center, rx, ry };
}

/** Equal radii stay a circle, as the circle tool draws them, so radiusY is only set when they differ. */
function ovalShape(box: OvalBox): NewShape {
  return {
    kind: "arc",
    center: box.center,
    radius: box.rx,
    ...(box.ry === box.rx ? {} : { radiusY: box.ry }),
    startAngle: 0,
    sweepAngle: 360,
  };
}

export class OvalTool extends BaseTool {
  readonly id = "oval";
  readonly cursor = "crosshair";
  private start: Pt | null = null;
  private pressScreen: Pt | null = null;
  private dragging = false;
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  hint(): string {
    return this.start
      ? `Click or release at the opposite corner · Tab ΔX, ΔY · Shift circle · ${ALT_KEY} from centre`
      : "Click or drag to draw an oval · Tab X, Y";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (!store.activeLayerId) {
      toast(NO_LAYER, "info");
      return;
    }
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
    // a plain click keeps the first corner and waits for the second click
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

  private reset(): void {
    this.start = null;
    this.pressScreen = null;
    this.dragging = false;
  }

  /** Shift holds the opposite corner on the diagonal, so the box is square. */
  private endPoint(p: PointerInfo, from: Pt): Pt {
    if (!p.shift) return p.pos;
    const { view } = this.env;
    const a = view.toPlan(from);
    const q = view.toPlan(p.pos);
    const dx = q.x - a.x;
    const dy = q.y - a.y;
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return view.fromPlan({ x: a.x + (dx < 0 ? -s : s), y: a.y + (dy < 0 ? -s : s) });
  }

  private valuesAt(cursor: Pt, start: Pt | null): BarValues {
    if (!start) return { x: cursor.x, y: cursor.y };
    return { dx: cursor.x - start.x, dy: cursor.y - start.y, x: cursor.x, y: cursor.y };
  }

  private pointFromValues(values: BarValues, start: Pt | null): Pt {
    if (!start) return { x: values.x, y: values.y };
    return typedPoint(values, start) ?? { x: start.x + values.dx, y: start.y + values.dy };
  }

  /** The oval between two points in the plan's coordinates, with the modifiers of the latest pointer event. */
  private boxFrom(a: Pt, b: Pt): OvalBox | null {
    const { view } = this.env;
    return ovalBox(view.toPlan(a), view.toPlan(b), this.pointer?.shift ?? false, this.pointer?.alt ?? false);
  }

  private commit(a: Pt, b: Pt): void {
    const box = this.boxFrom(a, b);
    if (box) addAndSelect(ovalShape(box), undefined, inPlan(this.env.view));
  }

  private preview(g: Painter, a: Pt, b: Pt): void {
    const box = this.boxFrom(a, b);
    if (!box) return;
    const { view } = this.env;
    const pts = ellipsePoints(box.center, box.rx, box.ry, 0, 360, PREVIEW_STEPS).map((q) => view.fromPlan(q));
    withPreview(g, () => strokeScreen(g, pts, true));
  }

  /** Places a point. The first starts the oval; the second completes it. */
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
    this.apply(this.pointFromValues(values, this.start), true);
  }

  /** The point a click or Enter places: the typed values while the bar holds any, else the cursor. */
  private placement(p: PointerInfo): Pt {
    const cursor = this.cursorPoint(p);
    if (!dataBar.hasLocks()) return cursor;
    const values = dataBar.resolve(this.valuesAt(cursor, this.start));
    return values ? this.pointFromValues(values, this.start) : cursor;
  }

  /** The cursor point: snapped, and square to the first corner once it is set. */
  private cursorPoint(p: PointerInfo): Pt {
    return this.start ? this.endPoint(p, this.start) : p.pos;
  }

  private syncBar(): void {
    dataBar.setStage(this.start ? OPPOSITE_STAGE : START_STAGE, this.barHandlers);
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
