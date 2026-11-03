// Double Line tool: draws two parallel lines or polylines a set width apart along
// the path clicked. Click the start, then each corner; double-click or Enter
// finishes, Esc cancels. Corners are mitred, so the two outlines meet cleanly. Shift
// constrains each segment to 15-degree steps. Tab opens the data bar for the width
// in mm. The mode bar sets where the path runs (the top line, the centre or the
// bottom line, keys 1-3) and what is made (keys 4-6): the two lines, the polygon
// between them, or both. A path of one segment gives two lines; a longer one gives
// two open polylines. Everything is made in one step, grouped, and selected.
//
// Double Line Polygon is the same tool closed back to its start (a click on the
// first corner closes it too): two closed outlines, or the ring between them.

import type { NewShape, Pt } from "../../core/index.ts";
import { addAndSelect, attempt, setEditGroup } from "../commands.ts";
import { dataBar, type BarField, type BarStage, type BarValues } from "../databar.ts";
import { ANGLE_STEP_DEG, dist, offsetPolyline, signedArea, snapAngle, unitVector } from "../geom.ts";
import { store, type ToolId } from "../state.ts";
import { joinHoles } from "../surfaces.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

const DEFAULT_WIDTH = 100;
const FIELD_WIDTH: BarField = { key: "width", label: "Width", digits: 2 };
const WIDTH_STAGE: BarStage = { key: "doubleline", caption: "Double line", fields: [FIELD_WIDTH] };
/** a click this close (CSS px) to the first corner closes a Double Line Polygon */
const CLOSE_PX = 6;
/** a corner whose direction reverses to within this of straight back is refused */
const FOLD_COS_TOLERANCE = 1e-6;

/** Where the clicked path runs: along the top (left-hand) line, the centre, or the bottom line. */
export type ControlLine = "top" | "centre" | "bottom";
/** What a double line makes: its two lines, the polygon between them, or both. */
export type DoubleLineCreate = "lines" | "polygon" | "both";

const CONTROLS: readonly { readonly id: ControlLine; readonly label: string }[] = [
  { id: "top", label: "Top" },
  { id: "centre", label: "Centre" },
  { id: "bottom", label: "Bottom" },
];
const CREATES: readonly { readonly id: DoubleLineCreate; readonly label: string }[] = [
  { id: "lines", label: "Lines" },
  { id: "polygon", label: "Polygon" },
  { id: "both", label: "Both" },
];
/** the modes in key order: 1-3 the control line, 4-6 what is made */
const MODE_KEYS: readonly string[] = [...CONTROLS, ...CREATES].map((m) => m.id);

export class DoubleLineTool extends BaseTool {
  readonly id: ToolId = "doubleline";
  readonly cursor = "crosshair";
  /** true for Double Line Polygon: the path closes back to its start */
  protected readonly closed: boolean = false;
  protected readonly title: string = "Double Line";

  /** distance between the two lines in mm; a typed value replaces it once entered */
  private width = DEFAULT_WIDTH;
  private control: ControlLine = "centre";
  private create: DoubleLineCreate = "lines";
  /** the corners clicked so far, in document units */
  private points: Pt[] = [];
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  modes(): readonly ToolModes[] {
    return [
      {
        label: "Control line",
        options: CONTROLS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })),
        active: this.control,
      },
      {
        label: "Create",
        options: CREATES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + CONTROLS.length) })),
        active: this.create,
      },
    ];
  }

  setMode(id: string): void {
    const control = CONTROLS.find((m) => m.id === id);
    if (control) this.control = control.id;
    const create = CREATES.find((m) => m.id === id);
    if (create) this.create = create.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(`${this.title} Preferences`, [
      { kind: "length", key: "width", label: "Width", value: this.width },
      { kind: "choice", key: "control", label: "Control line", value: this.control, options: CONTROLS.map((m) => ({ value: m.id, label: m.label })) },
      { kind: "choice", key: "create", label: "Create", value: this.create, options: CREATES.map((m) => ({ value: m.id, label: m.label })) },
    ]);
    if (!v) return;
    this.adopt(v.num("width"));
    this.setMode(v.choice("control"));
    this.setMode(v.choice("create"));
  }

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  hint(): string {
    const finish = this.closed ? "Enter closes" : "Enter finishes";
    return this.points.length === 0
      ? "Click the start · Tab width · 1–3 control line · 4–6 create"
      : `Click the next corner · Tab width · ${finish} · Shift ${ANGLE_STEP_DEG}°`;
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    const at = this.cursorPoint(p);
    const first = this.points[0];
    if (this.closed && this.points.length >= this.minPoints() && dist(at, first) * this.env.view.scale <= CLOSE_PX) {
      this.finish();
    } else {
      this.place(at);
      if (p.detail >= 2) this.finish();
    }
    this.syncBar();
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
  }

  cancel(): void {
    this.reset();
    this.pointer = null;
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Tab") {
      if (!this.pointer) return false;
      dataBar.show();
      this.syncBar();
      return dataBar.focusField(e.shiftKey);
    }
    const mode = /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey ? MODE_KEYS[Number(e.key) - 1] : undefined;
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.points.length === 0) return false;
    if (e.key === "Enter") this.finish();
    else if (e.key === "Escape") this.reset();
    else return false;
    this.syncBar();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    const cursor = this.cursorPoint(p);
    dataBar.position(g.toScreen(cursor), g);
    const pts = [...this.points, cursor];
    if (pts.length < 2) return;
    const width = this.liveWidth();
    // a Double Line Polygon shows closed once it has the corners to close
    const closed = this.closed && pts.length >= this.minPoints();
    const paths = width === null ? null : doubleLinePaths(pts, width, this.control, closed);
    if (!paths) return;
    withPreview(g, () => {
      for (const path of paths) strokeScreen(g, path, closed);
    });
  }

  /** Adds a corner, unless it repeats the last one (a double-click's second press lands on the first). */
  private place(at: Pt): void {
    const last = this.points.at(-1);
    if (!last || dist(last, at) > this.tolerance()) this.points.push(at);
  }

  private onBarCommit(values: BarValues): void {
    if (!dataBar.hasLocks()) {
      // Enter with nothing typed finishes the path, as it does on the canvas
      this.finish();
      this.syncBar();
      return;
    }
    const w = values.width;
    if (!(w > 0)) {
      toast("Enter a width greater than 0.", "info");
      return;
    }
    this.adopt(w);
    this.env.requestDraw();
  }

  /** Draws the path as two outlines, grouped, and selects the group. The path is kept when the outlines cannot be made. */
  private finish(): void {
    if (this.points.length < this.minPoints()) return;
    if (this.commit(this.points)) this.reset();
  }

  /** corners a path needs: one segment, or a triangle when it closes */
  private minPoints(): number {
    return this.closed ? 3 : 2;
  }

  /** Makes the shapes of `pts` as one undo step and selects them (several as a group). False when nothing was made. */
  private commit(pts: readonly Pt[]): boolean {
    const layerId = store.activeLayerId;
    if (!layerId) return false;
    const width = this.liveWidth();
    if (width === null || !(width > 0)) {
      toast("Enter a width greater than 0.", "info");
      return false;
    }
    const shapes = doubleLineShapes(pts, width, this.control, this.create, this.closed);
    if (!shapes) {
      toast("This path cannot be doubled.", "info");
      return false;
    }
    if (shapes.length === 1) {
      if (!addAndSelect(shapes[0])) return false;
      this.adopt(width);
      return true;
    }
    const classIndex = store.activeClassIndex;
    const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
    const r = attempt("Double line", (s) =>
      s.batch(() => s.groupObjects(shapes.map((shape) => s.addObject(layerId, shape, classIndex, attrs)))),
    );
    if (!r) return false;
    // the group goes on the layer, not into the group being edited, as addAndSelect does
    setEditGroup(null, [r.value]);
    this.adopt(width);
    return true;
  }

  /** Makes `w` the width and drops any typed lock, so the bar shows it again. */
  private adopt(w: number): void {
    this.width = w;
    dataBar.update({ width: w });
    dataBar.release();
  }

  /** The width the bar holds: a typed value while one is locked, else the stored one. Null when the typed text is not a number. */
  private liveWidth(): number | null {
    return dataBar.resolve({ width: this.width })?.width ?? null;
  }

  private syncBar(): void {
    dataBar.setStage(WIDTH_STAGE, this.barHandlers);
    dataBar.update({ width: this.width });
    const p = this.pointer;
    if (p) dataBar.position(this.env.view.toScreen(this.cursorPoint(p)), this.env.view);
  }

  /** The cursor point: snapped, and constrained by Shift once there is a previous corner. */
  private cursorPoint(p: PointerInfo): Pt {
    const last = this.points.at(-1);
    return last && p.shift ? snapAngle(last, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private tolerance(): number {
    return 2 / this.env.view.scale;
  }

  private reset(): void {
    this.points = [];
  }
}

/** How far each line sits from the path (left positive), by where the path runs. */
const SIDES: Record<ControlLine, readonly [number, number]> = { top: [0, -1], centre: [0.5, -0.5], bottom: [1, 0] };

/**
 * The two outlines of a double line: `pts` offset to each side so they are `width`
 * apart, with the path on the control line, mitred at the corners. Null when the
 * width is not positive, the path turns straight back on itself, or the width
 * collapses a segment.
 */
export function doubleLinePaths(pts: readonly Pt[], width: number, control: ControlLine = "centre", closed = false): [Pt[], Pt[]] | null {
  if (!(width > 0) || foldsBack(pts, closed)) return null;
  const [l, r] = SIDES[control];
  const left = offsetPolyline(pts, closed, l * width);
  const right = offsetPolyline(pts, closed, r * width);
  return left && right && left.length >= (closed ? 3 : 2) ? [left, right] : null;
}

/** True when a corner turns straight back along the segment before it (no mitre exists there). */
function foldsBack(pts: readonly Pt[], closed: boolean): boolean {
  const n = pts.length;
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const a = unitVector(pts[(i - 1 + n) % n], pts[i]);
    const b = unitVector(pts[i], pts[(i + 1) % n]);
    if (a.x * b.x + a.y * b.y < -1 + FOLD_COS_TOLERANCE) return true;
  }
  return false;
}

/**
 * The shapes of a double line: its lines (two lines for a single segment, else two
 * polylines, closed for a Double Line Polygon), the polygon between them, or both
 * with the polygon behind.
 */
function doubleLineShapes(
  pts: readonly Pt[],
  width: number,
  control: ControlLine,
  create: DoubleLineCreate,
  closed: boolean,
): NewShape[] | null {
  const paths = doubleLinePaths(pts, width, control, closed);
  if (!paths) return null;
  const [a, b] = paths;
  const lines = paths.map((path): NewShape =>
    closed
      ? { kind: "polygon", points: path, closed: true }
      : path.length === 2
        ? { kind: "line", a: path[0], b: path[1] }
        : { kind: "polyline", points: path, closed: false },
  );
  if (create === "lines") return lines;
  const band: NewShape = { kind: "polygon", points: closed ? ring(a, b) : [...a, ...[...b].reverse()], closed: true };
  return create === "polygon" ? [band] : [band, ...lines];
}

/** The area between two nested closed outlines as one polygon: the outer one with the inner joined in as a hole. */
function ring(a: readonly Pt[], b: readonly Pt[]): Pt[] {
  const [outer, inner] = Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? [a, b] : [b, a];
  // the hole runs the other way round, so it stays empty however the outline is filled
  const hole = Math.sign(signedArea(inner)) === Math.sign(signedArea(outer)) ? [...inner].reverse() : [...inner];
  return joinHoles(outer, [hole]);
}

/** Double Line Polygon: a double line closed back to its start. */
export class DoubleLinePolygonTool extends DoubleLineTool {
  override readonly id: ToolId = "dlpolygon";
  protected override readonly closed = true;
  protected override readonly title = "Double Line Polygon";
}
