// Polygon and polyline tools: click to add vertices; double-click or Enter
// finishes, Backspace removes the last vertex, Esc cancels. Shift constrains
// each new vertex to 15-degree steps from the previous one. Tab opens the data
// bar: the first vertex takes X and Y, later ones length and angle from the
// previous vertex. Enter adds the typed vertex and keeps focus in the bar.
// The Polyline tool's modes set the kind of each vertex as it is placed, as
// Vectorworks' do: Corner, Bezier (a control point the curve bends towards),
// Cubic (a point the curve passes through), Arc (the corner rounded as much as
// fits) and Point on Arc (an arc from the previous vertex to the next passes
// through it). The ends stay corners.
// The Polygon tool's boundary modes draw no vertices: a click inside an area
// that the active layer's visible objects enclose makes a polygon of its
// boundary, the area's own (Inner Boundary) or the outside of the outlines
// round it (Outer Boundary); pausing over an area previews it.

import { polylineOutline, type Pt, type VertexKind } from "../../core/index.ts";
import { innerBoundary, layerGraph, outerBoundary } from "../boundary.ts";
import { addAndSelect } from "../commands.ts";
import {
  dataBar,
  FIELD_ANGLE,
  FIELD_DX,
  FIELD_DY,
  FIELD_LENGTH,
  FIELD_X,
  FIELD_Y,
  typedPoint,
  type BarStage,
  type BarValues,
} from "../databar.ts";
import { ANGLE_STEP_DEG, dist, pointInPolygon, polar, polarOf, snapAngle } from "../geom.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

const FIRST_VERTEX: BarStage = { key: "poly-first", caption: "Vertex", fields: [FIELD_X, FIELD_Y] };
const NEXT_VERTEX: BarStage = { key: "poly-next", caption: "Segment", fields: [FIELD_LENGTH, FIELD_ANGLE, FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y], secondary: ["dx", "dy"] };

abstract class PolyTool extends BaseTool {
  protected points: Pt[] = [];
  /** each point's kind, as the mode was when it was placed */
  protected kinds: VertexKind[] = [];
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  protected abstract readonly minPoints: number;
  /** whether the preview shows the closing edge back to the first vertex */
  protected abstract readonly closes: boolean;

  protected abstract commit(points: Pt[], kinds: VertexKind[]): void;

  /** the kind a vertex placed now takes */
  protected vertexKind(): VertexKind {
    return "corner";
  }

  /** the line drawn through `pts` while placing them */
  protected outline(pts: readonly Pt[], _kinds: readonly VertexKind[]): readonly Pt[] {
    return pts;
  }

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  hint(): string {
    return this.points.length === 0
      ? "Click the first point · Tab X, Y"
      : `Click the next point · Tab length, angle · Enter finishes · Backspace undo point · Shift ${ANGLE_STEP_DEG}°`;
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.place(this.placement(p));
    if (p.detail >= 2) this.finish();
    this.syncBar();
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
  }

  cancel(): void {
    this.reset();
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Tab") return this.focusBar(e.shiftKey);
    if (this.points.length === 0) return false;
    switch (e.key) {
      case "Enter":
        this.finish();
        break;
      case "Escape":
        this.reset();
        break;
      case "Backspace":
        this.points.pop();
        this.kinds.pop();
        break;
      default:
        return false;
    }
    this.syncBar();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (p) dataBar.position(g.toScreen(this.cursorPoint(p)), g);
    const pts = p ? [...this.points, this.placement(p)] : this.points;
    if (pts.length === 0) return;
    const line = this.outline(pts, [...this.kinds, this.vertexKind()]);
    withPreview(g, () => {
      strokeScreen(g, line, false);
      if (this.closes && pts.length >= 3) strokeScreen(g, [pts[pts.length - 1], pts[0]], false);
    });
  }

  /** Adds a vertex unless it repeats the last one (a double-click's second press lands on the first). */
  private place(at: Pt): void {
    const last = this.points.at(-1);
    if (!last || dist(last, at) > this.tolerance()) {
      this.points.push(at);
      this.kinds.push(this.vertexKind());
    }
    dataBar.unlock();
  }

  private onBarCommit(values: BarValues): void {
    if (!this.pointer) return;
    if (!dataBar.hasLocks() && this.points.length >= this.minPoints) {
      // Enter with nothing typed finishes the shape, as it does on the canvas
      dataBar.release();
      this.finish();
      this.syncBar();
      return;
    }
    this.place(this.pointFromValues(values));
    this.syncBar();
    dataBar.keepFocus();
  }

  /** The point a click or Enter places: the typed values while the bar holds any, else the cursor. */
  private placement(p: PointerInfo): Pt {
    const cursor = this.cursorPoint(p);
    if (!dataBar.hasLocks()) return cursor;
    const values = dataBar.resolve(this.valuesAt(cursor));
    return values ? this.pointFromValues(values) : cursor;
  }

  /** The cursor point: snapped, and constrained by Shift once there is a previous vertex. */
  private cursorPoint(p: PointerInfo): Pt {
    const last = this.points.at(-1);
    return last && p.shift ? snapAngle(last, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private valuesAt(cursor: Pt): BarValues {
    const last = this.points.at(-1);
    if (!last) return { x: cursor.x, y: cursor.y };
    const { length, angle } = polarOf(last, cursor);
    return { length, angle, dx: cursor.x - last.x, dy: cursor.y - last.y, x: cursor.x, y: cursor.y };
  }

  private pointFromValues(values: BarValues): Pt {
    const last = this.points.at(-1);
    if (!last) return { x: values.x, y: values.y };
    return typedPoint(values, last) ?? polar(last, values.length, values.angle);
  }

  private syncBar(): void {
    dataBar.setStage(this.points.length === 0 ? FIRST_VERTEX : NEXT_VERTEX, this.barHandlers);
    const p = this.pointer;
    if (!p) return;
    const cursor = this.cursorPoint(p);
    dataBar.update(this.valuesAt(cursor));
    // placed here as well as in overlay, so a freshly shown bar never flashes at its default spot
    dataBar.position(this.env.view.toScreen(cursor), this.env.view);
  }

  private focusBar(backwards: boolean): boolean {
    if (!this.pointer) return false;
    dataBar.show();
    this.syncBar();
    return dataBar.focusField(backwards);
  }

  private tolerance(): number {
    return 2 / this.env.view.scale;
  }

  private finish(): void {
    if (this.points.length < this.minPoints) return;
    const pts = this.points;
    const kinds = this.kinds;
    this.reset();
    this.commit(pts, kinds);
  }

  private reset(): void {
    this.points = [];
    this.kinds = [];
  }
}

type PolygonMode = "vertices" | "inner" | "outer";

const POLYGON_MODES: readonly { readonly id: PolygonMode; readonly label: string }[] = [
  { id: "vertices", label: "Vertices" },
  { id: "inner", label: "Inner Boundary" },
  { id: "outer", label: "Outer Boundary" },
];

/** how long the pointer rests before the area under it is previewed, ms */
const PREVIEW_DELAY = 120;

export class PolygonTool extends PolyTool {
  readonly id: ToolId = "polygon";
  readonly cursor = "crosshair";
  protected readonly minPoints = 3;
  protected readonly closes = true;
  private mode: PolygonMode = "vertices";
  /** the boundary previewed under the pointer, in a boundary mode */
  private found: Pt[] | null = null;
  private timer = 0;

  modes(): ToolModes {
    return {
      label: "Mode",
      options: POLYGON_MODES.map((m, i) => ({ ...m, key: String(i + 1) })),
      active: this.mode,
    };
  }

  setMode(id: string): void {
    const m = POLYGON_MODES.find((v) => v.id === id);
    if (!m) return;
    this.cancel();
    this.mode = m.id;
  }

  hint(): string {
    if (this.mode === "vertices") return `${super.hint()} · 1–3 mode`;
    const which = this.mode === "inner" ? "its boundary" : "the outside of the outlines round it";
    return `Click inside an area the active layer's objects enclose for ${which} · 1–3 mode`;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return this.mode === "vertices" ? super.key(e) : false;
  }

  down(p: PointerInfo): void {
    if (this.mode === "vertices") {
      super.down(p);
      return;
    }
    this.clearPreview();
    const boundary = this.boundaryAt(p.pos);
    if (boundary) this.commit(boundary);
    else toast("No outline on the active layer encloses that point.", "info");
  }

  move(p: PointerInfo): void {
    if (this.mode === "vertices") {
      super.move(p);
      return;
    }
    const at = p.pos;
    // still over the area shown: keep it
    if (this.found && pointInPolygon(at, this.found)) return;
    this.clearPreview();
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.found = this.boundaryAt(at);
      this.env.requestDraw();
    }, PREVIEW_DELAY);
  }

  cancel(): void {
    this.clearPreview();
    super.cancel();
  }

  overlay(g: Painter): void {
    if (this.mode === "vertices") {
      super.overlay(g);
      return;
    }
    const found = this.found;
    if (!found) return;
    withPreview(g, () => {
      g.ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
      g.ctx.beginPath();
      found.forEach((pt, i) => {
        const s = g.toScreen(pt);
        if (i === 0) g.ctx.moveTo(s.x, s.y);
        else g.ctx.lineTo(s.x, s.y);
      });
      g.ctx.closePath();
      g.ctx.fill();
      strokeScreen(g, found, true);
    });
  }

  protected commit(points: Pt[]): void {
    addAndSelect({ kind: "polygon", points, closed: true });
  }

  /** The boundary the mode makes around `at` from what the active layer draws on screen; null when nothing encloses it. */
  private boundaryAt(at: Pt): Pt[] | null {
    const layerId = store.activeLayerId;
    if (!layerId || !store.session) return null;
    const graph = layerGraph(this.env.scene, layerId, this.env.view.visibleRect());
    return this.mode === "inner" ? innerBoundary(graph, at) : outerBoundary(graph, at);
  }

  private clearPreview(): void {
    if (this.timer !== 0) window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.found) {
      this.found = null;
      this.env.requestDraw();
    }
  }
}

const VERTEX_MODES: readonly { readonly id: VertexKind; readonly label: string }[] = [
  { id: "corner", label: "Corner" },
  { id: "bezier", label: "Bezier" },
  { id: "cubic", label: "Cubic" },
  { id: "arc", label: "Arc" },
  { id: "through", label: "Point on Arc" },
];

export class PolylineTool extends PolyTool {
  readonly id = "polyline";
  readonly cursor = "crosshair";
  protected readonly minPoints = 2;
  protected readonly closes = false;
  private mode: VertexKind = "corner";

  modes(): ToolModes {
    return {
      label: "Vertex",
      options: VERTEX_MODES.map((m, i) => ({ ...m, key: String(i + 1) })),
      active: this.mode,
    };
  }

  setMode(id: string): void {
    const m = VERTEX_MODES.find((v) => v.id === id);
    if (m) this.mode = m.id;
  }

  hint(): string {
    return `${super.hint()} · 1–5 vertex`;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  protected vertexKind(): VertexKind {
    return this.mode;
  }

  protected outline(pts: readonly Pt[], kinds: readonly VertexKind[]): readonly Pt[] {
    return kinds.every((k) => k === "corner") ? pts : polylineOutline(pts, kinds, false);
  }

  protected commit(points: Pt[], kinds: VertexKind[]): void {
    const curved = kinds.some((k) => k !== "corner");
    addAndSelect({ kind: "polyline", points, closed: false, ...(curved ? { vertices: kinds } : {}) });
  }
}
