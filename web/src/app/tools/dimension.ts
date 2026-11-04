// Dimension: linear, chain and baseline dimensions are Vectorworks dimension objects when the
// drawing has a linear one to copy (its standard: spacing, text and markers), a chain's or
// baseline's grouped; otherwise, and for the other kinds, a group of plain objects, the way an
// exploded Vectorworks dimension looks. Seven kinds, chosen with the number keys 1 to 7 while the tool is active (the kind is
// kept when the tool is reselected):
//   1 linear: click two points, move to place the dimension line, then click. Shift
//     while placing makes it aligned to the two points; otherwise it is horizontal or
//     vertical, as the cursor lies.
//   2 chain: as linear, then each further click dimensions on along the same line from
//     the last point; Enter or a double-click finishes.
//   3 baseline: as chain, but every dimension measures from the first point, their lines
//     stacked outwards.
//   4 ordinate: click the datum, click to place the line (dragged up or down, the
//     ordinates measure across; dragged sideways, up), then click each point; Enter or a
//     double-click finishes. Each point gets its distance from the datum, the datum 0.
//   5 radial: click a circle or arc, then click to place its radius leader.
//   6 diameter: click a circle or arc, then click to set the direction of its diameter.
//   7 angular: click two straight lines, then click to place the arc between them.
// Esc cancels the dimension in progress; Backspace takes back a chain's, baseline's or
// ordinate's last point.
// Arc Length Dimension, a tool of its own as in Vectorworks, measures along a circle or arc
// between two clicks on it; see ArcLengthTool.

import type { Attributes, EditSession, NewShape, ObjectInfo, Pt, VwxDocument } from "../../core/index.ts";
import { associateDimension } from "../assocDimensions.ts";
import { attempt, setEditGroup } from "../commands.ts";
import {
  angularLayout,
  arcLengthLayout,
  dimensionFrame,
  dimensionLayout,
  dimensionValue,
  diameterLayout,
  frameLayout,
  linearDrawing,
  ordinateDrawing,
  ordinateFrame,
  ordinateLength,
  radialLayout,
  seriesLayouts,
  withoutCovered,
  type CircleGeom,
  type DimensionDrawing,
  type DimensionFrame,
  type WitnessLines,
} from "../dimension.ts";
import { degToRad, dist, ellipsePoints, linesParallel, type LineSeg } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";

const MIN_WORLD = 1e-9;
const TAU = 2 * Math.PI;
/** the class new dimensions go to when the document has one of this name */
const CLASS_NAME = "Dimension";
/** text justification: centred on the origin across the text (hAlign 2), bottom baseline on it (vAlign 4) */
const TEXT_H_CENTRE = 2;
const TEXT_V_BASELINE = 4;
const FONT = `Arial, "Helvetica Neue", Helvetica, sans-serif`;
const MIN_ARC_STEPS = 16;
const ARC_STEP_DEG = 2;
const RADIUS_PREFIX = "R";
const DIAMETER_PREFIX = "⌀";
const NOT_CIRCLE = "Radius and diameter work on circles and arcs.";
const NOT_LINE = "Angular dimensions work on straight lines.";
const PARALLEL = "Lines are parallel";

/** The kinds of dimension, in the order the number keys 1 to 7 choose them. */
type DimensionMode = "linear" | "chain" | "baseline" | "ordinate" | "radial" | "diameter" | "angular";
const MODES: readonly DimensionMode[] = ["linear", "chain", "baseline", "ordinate", "radial", "diameter", "angular"];
const MODE_NAME: Record<DimensionMode, string> = {
  linear: "Linear",
  chain: "Chain",
  baseline: "Baseline",
  ordinate: "Ordinate",
  radial: "Radial",
  diameter: "Diameter",
  angular: "Angular",
};

/** The kinds made from clicked points rather than from picked objects. */
function measuresPoints(mode: DimensionMode): boolean {
  return mode === "linear" || mode === "chain" || mode === "baseline" || mode === "ordinate";
}

export class DimensionTool extends BaseTool {
  readonly id = "dimension";
  readonly cursor = "crosshair";

  /** the kind of dimension the next click makes; kept when the tool is reselected */
  private mode: DimensionMode = "linear";
  /** linear, chain and baseline: the measured points in click order; ordinate: the datum, then the points */
  private points: Pt[] = [];
  /** chain, baseline and ordinate once the line is placed: where, and which way it runs */
  private placed: { readonly at: Pt; readonly frame: DimensionFrame } | null = null;
  /** radial and diameter: the circle picked (one id); angular: the two lines, in click order */
  private picked: string[] = [];
  /** object under the pointer, highlighted before it is picked */
  private hover: string | null = null;
  /** last pointer event; the preview follows it */
  private pointer: PointerInfo | null = null;

  snapFrom(): Pt | null {
    return this.points[this.points.length - 1] ?? null;
  }

  hint(): string {
    return `${MODE_NAME[this.mode]}: ${this.step()} · 1–7 type`;
  }

  /** What the next click does, for the hint. */
  private step(): string {
    const picks = this.picked.length;
    const points = this.points.length;
    switch (this.mode) {
      case "linear":
      case "chain":
      case "baseline":
        if (points === 0) return "click the first point";
        if (points === 1) return "click the second point";
        if (!this.placed) return "click to place the line · Shift aligned";
        return "click the next point · Enter or double-click finishes · Backspace undo point";
      case "ordinate":
        if (points === 0) return "click the datum";
        if (!this.placed) return "click to place the line";
        return "click the next point · Enter or double-click finishes · Backspace undo point";
      case "radial":
        return picks === 0 ? "click a circle or arc" : "click to place the radius";
      case "diameter":
        return picks === 0 ? "click a circle or arc" : "click to place the diameter";
      case "angular":
        if (picks === 0) return "click the first line";
        return picks === 1 ? "click the second line" : "click to place the arc";
    }
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (measuresPoints(this.mode)) {
      this.downPoint(p);
      return;
    }
    this.prune();
    const need = this.mode === "angular" ? 2 : 1;
    if (this.picked.length < need) this.pickNext(p);
    else this.placePicked(p);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    const accept = this.pickFilter();
    this.hover = accept ? (this.pick(p.screen, accept)?.id ?? null) : null;
  }

  cancel(): void {
    this.clear();
  }

  key(e: KeyboardEvent): boolean {
    if (/^[1-7]$/.test(e.key)) {
      this.setMode(MODES[Number(e.key) - 1]);
      return true;
    }
    if (e.key === "Enter" && this.placed) {
      this.finish();
      return true;
    }
    if (e.key === "Backspace" && this.placed && this.points.length > (this.mode === "ordinate" ? 1 : 2)) {
      this.points = this.points.slice(0, -1);
      return true;
    }
    if (e.key !== "Escape" || !this.inProgress()) return false;
    this.clear();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    if (measuresPoints(this.mode)) {
      this.overlayPoints(g, p);
      return;
    }
    const picked = this.pickedObjects();
    for (const o of picked) highlightObject(g, o);
    const hit = this.hover ? this.object(this.hover) : null;
    if (hit && !picked.some((o) => o.id === hit.id)) highlightObject(g, hit);
    const d = this.drawing(picked, p.pos);
    if (d) drawPreview(g, [d]);
  }

  modes(): ToolModes {
    return {
      options: MODES.map((m, i) => ({ id: m, label: MODE_NAME[m], key: String(i + 1) })),
      active: this.mode,
    };
  }

  /** Switches the kind of dimension. A gesture in progress belongs to the old kind, so it is dropped. */
  setMode(id: string): void {
    const mode = MODES.find((m) => m === id);
    if (!mode || mode === this.mode) return;
    this.mode = mode;
    this.clear();
  }

  private inProgress(): boolean {
    return this.points.length > 0 || this.picked.length > 0;
  }

  // ---- linear, chain, baseline and ordinate: points, the placement, more points ----

  private downPoint(p: PointerInfo): void {
    const pos = p.pos;
    const points = this.points;
    const last = points[points.length - 1];
    if (!last) {
      this.points = [pos];
      return;
    }
    if (this.mode === "ordinate" && !this.placed) {
      // placing on the datum gives the line no way to run
      if (dist(last, pos) > MIN_WORLD) this.placed = { at: pos, frame: ordinateFrame(last, pos) };
      if (this.placed && p.detail >= 2) this.finish();
      return;
    }
    if (points.length === 1 && this.mode !== "ordinate") {
      // a second click on the first point would measure nothing
      if (dist(last, pos) > MIN_WORLD) this.points = [last, pos];
      return;
    }
    if (!this.placed) {
      const frame = dimensionFrame(points[0], points[1], pos, p.shift);
      if (!frame) return;
      this.placed = { at: pos, frame };
      if (this.mode === "linear" || p.detail >= 2) this.finish();
      return;
    }
    // a double-click's second press lands on the point its first press added
    if (dist(last, pos) > MIN_WORLD) this.points = [...points, pos];
    if (p.detail >= 2) this.finish();
  }

  private overlayPoints(g: Painter, p: PointerInfo): void {
    const points = this.points;
    const first = points[0];
    if (!first) return;
    if (this.mode === "ordinate") {
      const placed = this.placed ?? (dist(first, p.pos) > MIN_WORLD ? { at: p.pos, frame: ordinateFrame(first, p.pos) } : null);
      if (placed) drawPreview(g, this.drawings(this.placed ? [...points, p.pos] : points, placed));
      return;
    }
    if (points.length === 1) {
      withPreview(g, () => strokeScreen(g, [first, p.pos], false));
      return;
    }
    if (this.placed) {
      drawPreview(g, this.drawings([...points, p.pos], this.placed));
      return;
    }
    const layout = dimensionLayout(first, points[1], p.pos, p.shift, this.scale());
    if (layout) drawPreview(g, [linearDrawing(layout, this.value(layout.length))]);
  }

  /** The dimensions the points make, placed: one for linear, one per span for a chain or baseline, one per point for ordinates. */
  private drawings(points: readonly Pt[], placed: { at: Pt; frame: DimensionFrame }): DimensionDrawing[] {
    const scale = this.scale();
    const { at, frame } = placed;
    switch (this.mode) {
      case "ordinate": {
        const origin = points[0];
        return points.map((q) => ordinateDrawing(q, at, frame, scale, this.value(ordinateLength(origin, q, frame))));
      }
      case "chain":
      case "baseline":
        return seriesLayouts(points, this.mode, at, frame, scale).map((l) => linearDrawing(l, this.value(l.length)));
      default: {
        const layout = points.length >= 2 ? frameLayout(points[0], points[1], at, frame, scale) : null;
        return layout ? [linearDrawing(layout, this.value(layout.length))] : [];
      }
    }
  }

  /** Makes the placed dimensions and starts afresh. */
  private finish(): void {
    const placed = this.placed;
    const drawings = placed ? this.drawings(this.points, placed) : [];
    this.clear();
    if (drawings.length) commit(drawings);
  }

  private value(length: number): string {
    return dimensionValue(length, store.session?.doc.info.units);
  }

  // ---- radial, diameter and angular: picks, then the placement --------------

  /** What a click would pick now; null when the next click places rather than picks (or is linear). */
  private pickFilter(): ((o: ObjectInfo) => boolean) | null {
    if (measuresPoints(this.mode)) return null;
    if (this.mode === "angular") return this.picked.length < 2 ? isLine : null;
    return this.picked.length < 1 ? isCircle : null;
  }

  /** Adds the object under the click to the picks, when it is the kind this mode picks next. */
  private pickNext(p: PointerInfo): void {
    const angular = this.mode === "angular";
    const hit = this.pick(p.screen, angular ? isLine : isCircle);
    if (!hit) {
      // a click on something else says why, so it is not silent
      if (this.pick(p.screen, () => true)) toast(angular ? NOT_LINE : NOT_CIRCLE, "info");
      return;
    }
    if (this.picked.includes(hit.id)) return;
    if (angular && this.picked.length === 1) {
      const first = this.pickedObjects()[0];
      const a = first ? straightSeg(first) : null;
      const b = straightSeg(hit);
      if (a && b && linesParallel(a.a, a.b, b.a, b.b)) {
        toast(PARALLEL, "info");
        return;
      }
    }
    this.picked = [...this.picked, hit.id];
  }

  /** Places the dimension for the picks at the click; a click that cannot place it keeps the picks. */
  private placePicked(p: PointerInfo): void {
    const d = this.drawing(this.pickedObjects(), p.pos);
    if (!d) return;
    this.clear();
    commit([d]);
  }

  /** The dimension the picks make with the cursor placing it; null while the picks are incomplete or it cannot go there. */
  private drawing(picked: readonly ObjectInfo[], cursor: Pt): DimensionDrawing | null {
    const scale = this.scale();
    const units = store.session?.doc.info.units;
    if (measuresPoints(this.mode)) return null;
    if (this.mode === "angular") {
      if (picked.length !== 2) return null;
      const a = straightSeg(picked[0]);
      const b = straightSeg(picked[1]);
      return a && b ? angularLayout(a, b, cursor, scale) : null;
    }
    const circle = picked.length === 1 ? circleOf(picked[0]) : null;
    if (!circle) return null;
    if (this.mode === "radial") {
      return radialLayout(circle, cursor, scale, RADIUS_PREFIX + dimensionValue(circle.radius, units));
    }
    return diameterLayout(circle, cursor, scale, DIAMETER_PREFIX + dimensionValue(2 * circle.radius, units));
  }

  // ---- shared -----------------------------------------------------------------

  /** Topmost object of the active layer under `screen` that `accept` takes; contents of symbol instances are never picked. */
  private pick(screen: Pt, accept: (o: ObjectInfo) => boolean): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], (o) => !isDerivedId(o.id) && accept(o));
  }

  /** Drops picks that are gone (undo, a delete) or are no longer the kind this mode picks. */
  private prune(): void {
    const ok = this.mode === "angular" ? isLine : isCircle;
    const kept = this.picked.filter((id) => {
      const o = this.object(id);
      return o !== null && ok(o);
    });
    if (kept.length !== this.picked.length) this.picked = kept;
  }

  private pickedObjects(): ObjectInfo[] {
    const out: ObjectInfo[] = [];
    for (const id of this.picked) {
      const o = this.object(id);
      if (o) out.push(o);
    }
    return out;
  }

  private object(id: string): ObjectInfo | null {
    return store.session?.doc.object(id) ?? null;
  }

  /** Active layer's scale (world units per paper mm); 1 when there is no layer. */
  private scale(): number {
    return layerScaleOf(this.env.scene);
  }

  private clear(): void {
    this.points = [];
    this.placed = null;
    this.picked = [];
    this.hover = null;
  }
}

/** Arc Length Dimension's choices: its witness lines, and whether an arc sits over the value. */
const WITNESS: readonly { readonly id: WitnessLines; readonly label: string }[] = [
  { id: "chord", label: "Perpendicular to Chord" },
  { id: "tangent", label: "Perpendicular to Tangent" },
];
const INDICATOR: readonly { readonly id: string; readonly label: string }[] = [
  { id: "visible", label: "Arc Indicator Visible" },
  { id: "invisible", label: "Arc Indicator Invisible" },
];
const NOT_ARC = "Arc length dimensions measure circles and arcs: click one where the dimension starts.";
const TOO_CLOSE = "Chord witness lines can't reach a dimension that close to the centre: place it further out.";

/** A circle or circular arc with the stretch it covers: from `start` counter-clockwise through `sweep`, radians; a circle's sweep is a whole turn. */
interface ArcGeom extends CircleGeom {
  readonly start: number;
  readonly sweep: number;
}

/**
 * Arc Length Dimension (the Dims/Notes set): click a circle or arc where the measured stretch
 * starts, click where it ends (the clicks are taken onto the arc along its radii), then move to set
 * the dimension's distance from it and click to place it. On a circle the stretch is the side the
 * cursor is on when placing. Keys 1–2 choose the witness lines, 3–4 the arc indicator. The pieces
 * are grouped in the Dimension class, as other dimensions' are.
 */
export class ArcLengthTool extends BaseTool {
  readonly id = "arclength";
  readonly cursor = "crosshair";

  private witness: WitnessLines = "chord";
  private indicator = true;
  /** the circle or arc measured, once its first point is clicked */
  private arcId: string | null = null;
  /** where the clicks met the arc, radians counter-clockwise from its start */
  private ends: number[] = [];
  private hover: string | null = null;
  private pointer: PointerInfo | null = null;

  hint(): string {
    const step =
      this.ends.length === 0
        ? "click a circle or arc where the dimension starts"
        : this.ends.length === 1
          ? "click where it ends"
          : "click to place the dimension";
    return `Arc Length: ${step} · 1–2 witness lines · 3–4 arc indicator`;
  }

  modes(): readonly ToolModes[] {
    return [
      { label: "Witness lines", options: WITNESS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.witness },
      {
        label: "Arc indicator",
        options: INDICATOR.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 3) })),
        active: this.indicator ? "visible" : "invisible",
      },
    ];
  }

  setMode(id: string): void {
    const witness = WITNESS.find((m) => m.id === id);
    if (witness) this.witness = witness.id;
    if (INDICATOR.some((m) => m.id === id)) this.indicator = id === "visible";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    const arc = this.arc();
    if (!arc) {
      this.ends = [];
      const hit = this.pick(p.screen);
      const picked = hit ? arcOf(hit) : null;
      if (!hit || !picked) {
        toast(NOT_ARC, "info");
        return;
      }
      this.arcId = hit.id;
      this.ends = [onArc(picked, p.pos)];
      return;
    }
    if (this.ends.length === 1) {
      const end = onArc(arc, p.pos);
      // an end on the start measures nothing
      if (Math.abs(end - this.ends[0]) * arc.radius > MIN_WORLD) this.ends = [this.ends[0], end];
      return;
    }
    const d = this.drawing(arc, this.ends[1], p.pos);
    if (!d) {
      toast(TOO_CLOSE, "info");
      return;
    }
    this.clear();
    commit([d]);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    this.hover = this.arcId ? null : (this.pick(p.screen)?.id ?? null);
  }

  cancel(): void {
    this.clear();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.arcId) return false;
    this.clear();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    const obj = this.arcId ? this.object(this.arcId) : this.hover ? this.object(this.hover) : null;
    if (obj) highlightObject(g, obj);
    const arc = this.arc();
    if (!arc) return;
    if (this.ends.length === 1) {
      // the stretch so far, from the first click to where the pointer meets the arc
      const { start, sweep } = stretch(arc, this.ends[0], onArc(arc, p.pos), p.pos);
      const pts = ellipsePoints(arc.centre, arc.radius, arc.radius, (start * 180) / Math.PI, (sweep * 180) / Math.PI, arcSteps((sweep * 180) / Math.PI));
      withPreview(g, () => strokeScreen(g, pts, false));
      return;
    }
    const d = this.drawing(arc, this.ends[1], p.pos);
    if (d) drawPreview(g, [d]);
  }

  /** The dimension of the stretch between the first click and `end`, placed at `cursor`. */
  private drawing(arc: ArcGeom, end: number, cursor: Pt): DimensionDrawing | null {
    const { start, sweep } = stretch(arc, this.ends[0], end, cursor);
    const value = dimensionValue(arc.radius * sweep, store.session?.doc.info.units);
    return arcLengthLayout(arc, start, sweep, cursor, this.witness, this.indicator, layerScaleOf(this.env.scene), value);
  }

  /** The circle or arc being measured, while it is still there and still one. */
  private arc(): ArcGeom | null {
    const obj = this.arcId ? this.object(this.arcId) : null;
    const arc = obj ? arcOf(obj) : null;
    if (!arc && this.arcId) this.clear();
    return arc;
  }

  private pick(screen: Pt): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], (o) => !isDerivedId(o.id) && isCircle(o));
  }

  private object(id: string): ObjectInfo | null {
    return store.session?.doc.object(id) ?? null;
  }

  private clear(): void {
    this.arcId = null;
    this.ends = [];
    this.hover = null;
  }
}

/** A circle or circular arc and its stretch, the sweep made positive; null for anything else. */
function arcOf(obj: ObjectInfo): ArcGeom | null {
  const circle = circleOf(obj);
  const s = obj.shape;
  if (!circle || s?.kind !== "arc") return null;
  let start = degToRad(s.startAngle ?? 0);
  let sweep = degToRad(s.sweepAngle ?? 360);
  if (sweep < 0) {
    start += sweep;
    sweep = -sweep;
  }
  return { ...circle, start: turnedRad(start), sweep: Math.min(sweep, TAU) };
}

/** Where `pos` meets the arc along its radius, radians from the arc's start; past an end of an arc, that end. */
function onArc(arc: ArcGeom, pos: Pt): number {
  const rel = turnedRad(Math.atan2(pos.y - arc.centre.y, pos.x - arc.centre.x) - arc.start);
  if (arc.sweep >= TAU || rel <= arc.sweep) return rel;
  // beyond the arc: the end it is nearer, going round
  return rel - arc.sweep < TAU - rel ? arc.sweep : 0;
}

/**
 * The stretch between two points on the arc (radians from its start), counter-clockwise from
 * `start` through `sweep`: along the arc between them, or on a circle the side holding `cursor`.
 */
function stretch(arc: ArcGeom, a: number, b: number, cursor: Pt): { start: number; sweep: number } {
  if (arc.sweep < TAU) return { start: arc.start + Math.min(a, b), sweep: Math.abs(b - a) };
  const ab = turnedRad(b - a);
  const towards = turnedRad(Math.atan2(cursor.y - arc.centre.y, cursor.x - arc.centre.x) - arc.start - a);
  return towards <= ab ? { start: arc.start + a, sweep: ab } : { start: arc.start + b, sweep: TAU - ab };
}

/** Angle in [0, 2 pi). */
function turnedRad(rad: number): number {
  return ((rad % TAU) + TAU) % TAU;
}

/** The active layer's scale (world units per paper mm); 1 when there is no layer. */
function layerScaleOf(scene: ToolEnv["scene"]): number {
  const id = store.activeLayerId;
  const layer = id ? scene.layer(id) : undefined;
  return layer && layer.scale > 0 ? layer.scale : 1;
}

/**
 * Creates the dimensions on the active layer in one batch: linear ones as dimension objects when
 * the drawing has one to copy, else as plain pieces; grouped (a chain, baseline or set of
 * ordinates as one group, a lone dimension's pieces as one), and selects the result.
 */
function commit(drawings: readonly DimensionDrawing[]): void {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const classIndex = dimensionClass(session.doc) ?? store.activeClassIndex;
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const r = attempt("Dimension", (s) =>
    s.batch(() => {
      const id = addDimensionDrawings(s, layerId, drawings, classIndex, attrs);
      // a lone linear dimension between two vertices follows them
      if (drawings.length === 1) associateDimension(s, id, layerId, drawings[0]);
      return id;
    }),
  );
  // the group goes on the layer, not into the group being edited, as addAndSelect does
  if (r) setEditGroup(null, [r.value]);
}

/**
 * Makes the dimensions on `layerId`, in the caller's batch: linear ones as dimension objects when
 * the drawing has one to copy (a lone one, or a chain grouped), else as plain pieces grouped; the id.
 */
export function addDimensionDrawings(s: EditSession, layerId: string, drawings: readonly DimensionDrawing[], classIndex: number, attrs?: Partial<Attributes>): string {
  const template = s.dimensionTemplate();
  const linear = drawings.flatMap((d) => (d.linear ? [{ ...d.linear, value: d.text.value }] : []));
  if (template && linear.length === drawings.length) {
    const dims = linear.map((m) => s.addDimension(layerId, m.a, m.b, m.at, m.u, m.value, template, classIndex));
    return dims.length > 1 ? s.groupObjects(dims) : dims[0];
  }
  const ids: string[] = [];
  for (const l of withoutCovered(drawings.flatMap((d) => d.lines))) {
    ids.push(s.addObject(layerId, { kind: "line", a: l.a, b: l.b }, classIndex, attrs));
  }
  for (const arc of drawings.flatMap((d) => d.arcs)) {
    const shape: NewShape = {
      kind: "arc",
      center: arc.centre,
      radius: arc.radius,
      startAngle: arc.startAngle,
      sweepAngle: arc.sweepAngle,
    };
    ids.push(s.addObject(layerId, shape, classIndex, attrs));
  }

  for (const { text: t } of drawings) {
    const text: NewShape = { kind: "text", at: t.at, text: t.value, height: t.height };
    const id = s.addObject(layerId, text, classIndex, attrs);
    // turning and justifying the text moves its origin, so the origin goes back on the anchor after
    s.setTextStyle([id], { hAlign: TEXT_H_CENTRE, vAlign: TEXT_V_BASELINE, angle: t.angle });
    s.setGeometry(id, text);
    ids.push(id);
  }
  return s.groupObjects(ids);
}

/** The document's "Dimension" class, or null when it has none. */
export function dimensionClass(doc: VwxDocument): number | null {
  return doc.classes().find((c) => c.name === CLASS_NAME)?.index ?? null;
}

/** A circle or circular arc: centre and radius. Ellipses and everything else are not circles. */
function circleOf(obj: ObjectInfo): CircleGeom | null {
  const s = obj.shape;
  if (s?.kind !== "arc" || !s.center || s.rx === undefined || !(s.rx > 0) || (s.ry ?? s.rx) !== s.rx) return null;
  return { centre: s.center, radius: s.rx };
}

/** End points of a straight line object; null for anything else. */
function straightSeg(obj: ObjectInfo): LineSeg | null {
  const s = obj.shape;
  if (s?.kind !== "line" || s.points.length < 2) return null;
  return { a: s.points[0], b: s.points[1] };
}

function isCircle(obj: ObjectInfo): boolean {
  return circleOf(obj) !== null;
}

function isLine(obj: ObjectInfo): boolean {
  return straightSeg(obj) !== null;
}

function arcSteps(sweepDeg: number): number {
  return Math.max(MIN_ARC_STEPS, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
}

/** Dashed preview of every piece, and each value turned to its line. */
function drawPreview(g: Painter, drawings: readonly DimensionDrawing[]): void {
  withPreview(g, () => {
    for (const d of drawings) {
      for (const l of d.lines) strokeScreen(g, [l.a, l.b], false);
      for (const arc of d.arcs) {
        const pts = ellipsePoints(arc.centre, arc.radius, arc.radius, arc.startAngle, arc.sweepAngle, arcSteps(arc.sweepAngle));
        strokeScreen(g, pts, false);
      }
    }
  });
  for (const d of drawings) drawValue(g, d.text);
}

/** The value as it will sit: its bottom baseline on the anchor, turned to the line. */
function drawValue(g: Painter, text: DimensionDrawing["text"]): void {
  const { ctx } = g;
  const at = g.toScreen(text.at);
  ctx.save();
  ctx.translate(at.x, at.y);
  // world angles run counter-clockwise, and screen y points down
  ctx.rotate((-text.angle * Math.PI) / 180);
  ctx.fillStyle = ACCENT;
  ctx.font = `${text.height * g.scale}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text.value, 0, 0);
  ctx.restore();
}

/** Points that trace an object for highlighting: a line's ends, or an arc sampled along its sweep. */
function outlineOf(obj: ObjectInfo): Pt[] | null {
  const s = obj.shape;
  if (!s) return null;
  if (s.kind === "line") return s.points.length >= 2 ? [s.points[0], s.points[1]] : null;
  if (s.kind !== "arc" || !s.center || s.rx === undefined) return null;
  const sweep = s.sweepAngle ?? 360;
  return ellipsePoints(s.center, s.rx, s.ry ?? s.rx, s.startAngle ?? 0, sweep, arcSteps(sweep));
}

/** Solid accent outline of an object the tool has picked or is hovering over. */
function highlightObject(g: Painter, obj: ObjectInfo): void {
  const pts = outlineOf(obj);
  if (!pts) return;
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  strokeScreen(g, pts, false);
  ctx.restore();
}
