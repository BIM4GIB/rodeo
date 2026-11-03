// Rotate tool: click the centre, click a reference direction, then click again
// to turn the selection by the angle between the reference and the pointer.
// Shift snaps the angle to 15-degree steps. Its modes (1, 2) turn the selection
// itself or a copy, leaving the originals in place. Esc starts over; a commit
// keeps the selection (the copy, after a copy) and the tool. The helpers at the bottom (outlines, affine maps,
// markers and labels) are shared with the mirror and arc tools.

import type { Affine, BBox, Pt, Shape } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { dist, ellipsePoints } from "../geom.ts";
import type { Scene } from "../scene.ts";
import { ACCENT } from "../renderer.ts";
import { arcRadii, isClosedShape } from "../shapes.ts";
import { store } from "../state.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

/** Shift snaps angles to this step, radians. */
const STEP = Math.PI / 12;
const MIN_WORLD = 1e-9;
/** radius of the protractor arc on screen, CSS px */
const PROTRACTOR_PX = 44;
/** angle step used when sampling arcs for previews, degrees */
const SAMPLE_DEG = 2;
const LABEL_FONT = `12px "Helvetica Neue", Arial, system-ui, sans-serif`;

export class RotateTool extends BaseTool {
  readonly id = "rotate";
  readonly cursor = "crosshair";

  /** rotation centre; null before the first click */
  private centre: Pt | null = null;
  /** second click: its direction from the centre is the zero angle */
  private reference: Pt | null = null;
  /** selection when the gesture started; a change under the gesture drops it */
  private ids: readonly string[] = [];
  /** last snapped pointer position */
  private pointer: Pt | null = null;
  /** rotation for the current pointer, radians, counter-clockwise positive */
  private angle = 0;
  private mode: "turn" | "copy" = "turn";

  modes(): ToolModes {
    return {
      options: [
        { id: "turn", label: "Rotate", key: "1" },
        { id: "copy", label: "Rotate a copy", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id === "turn" || id === "copy") this.mode = id;
  }

  hint(): string {
    if (store.selection.size === 0) return "Select objects first";
    if (!this.centre) return "Click the centre of rotation · 1–2 mode";
    if (!this.reference) return "Click a reference direction";
    return "Click to set the angle · Shift 15°";
  }

  down(p: PointerInfo): void {
    this.sync();
    if (store.selection.size === 0) return;
    if (!this.centre) {
      this.centre = p.pos;
      this.ids = [...store.selection];
      this.pointer = p.pos;
      return;
    }
    if (!this.reference) {
      if (dist(p.pos, this.centre) < MIN_WORLD) return;
      this.reference = p.pos;
      this.pointer = p.pos;
      return;
    }
    const angle = this.angleAt(p);
    if (angle === 0) return;
    const m = rotationAbout(this.centre, angle);
    const ids = [...store.selection];
    if (this.mode === "copy") {
      // one undo step: the copy and its turn
      const copies = attempt("Rotate copy", (s) =>
        s.batch(() => {
          const made = s.duplicateObjects(ids, 0, 0);
          s.transformObjects(made, m);
          return made;
        }),
      );
      if (copies) setSelection(copies.value);
    } else {
      attempt("Rotate", (s) => s.transformObjects(ids, m));
    }
    this.reset();
  }

  move(p: PointerInfo): void {
    this.sync();
    this.pointer = p.pos;
    if (this.reference) this.angle = this.angleAt(p);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.centre) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const c = this.centre;
    const p = this.pointer;
    if (!c || !p || !selectionUnchanged(this.ids)) return;
    if (!this.reference) {
      withPreview(g, () => strokeScreen(g, [c, p], false));
      drawMarker(g, c);
      return;
    }
    const m = rotationAbout(c, this.angle);
    const turned = mapOutlines(selectionOutlines(this.env.scene, this.ids), m);
    withPreview(g, () => {
      for (const line of turned) strokeScreen(g, line, false);
    });
    this.drawProtractor(g, c, this.reference, p);
  }

  /** Reference and pointer directions, the protractor arc and the angle beside the pointer. */
  private drawProtractor(g: Painter, c: Pt, ref: Pt, p: Pt): void {
    const { ctx } = g;
    const C = g.toScreen(c);
    const start = Math.atan2(ref.y - c.y, ref.x - c.x);
    withPreview(g, () => strokeScreen(g, [c, p], false));
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(C.x, C.y);
    const R = g.toScreen(ref);
    ctx.lineTo(R.x, R.y);
    ctx.stroke();
    // screen y points down, so world angles are negated for the canvas arc
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(C.x, C.y, PROTRACTOR_PX, -start, -(start + this.angle), this.angle > 0);
    ctx.stroke();
    ctx.restore();
    drawMarker(g, c);
    const P = g.toScreen(p);
    drawLabel(g, { x: P.x + 14, y: P.y - 22 }, degLabel((this.angle * 180) / Math.PI));
  }

  /** Rotation for the pointer: the angle from the reference direction, shift-snapped. */
  private angleAt(p: PointerInfo): number {
    const c = this.centre;
    const r = this.reference;
    if (!c || !r || dist(p.pos, c) < MIN_WORLD) return 0;
    const raw = Math.atan2(p.pos.y - c.y, p.pos.x - c.x) - Math.atan2(r.y - c.y, r.x - c.x);
    const wrapped = Math.atan2(Math.sin(raw), Math.cos(raw));
    return p.shift ? Math.round(wrapped / STEP) * STEP : wrapped;
  }

  /** Drops the gesture when the selection changed under it. */
  private sync(): void {
    if (this.centre && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    this.centre = null;
    this.reference = null;
    this.ids = [];
    this.angle = 0;
  }
}

/** True when the selection still holds exactly `ids`. */
export function selectionUnchanged(ids: readonly string[]): boolean {
  const sel = store.selection;
  return sel.size === ids.length && ids.every((id) => sel.has(id));
}

/** Rotation by `rad` about `c`, counter-clockwise positive with y up. */
export function rotationAbout(c: Pt, rad: number): Affine {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: c.x - cos * c.x + sin * c.y,
    f: c.y - sin * c.x - cos * c.y,
  };
}

export function applyAffine(m: Affine, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function mapOutlines(outlines: readonly (readonly Pt[])[], m: Affine): Pt[][] {
  return outlines.map((line) => line.map((p) => applyAffine(m, p)));
}

/**
 * Outlines of the selection in document units, one polyline per drawable
 * object (group contents included). Closed shapes repeat their first point.
 */
export function selectionOutlines(scene: Scene, ids: Iterable<string>): Pt[][] {
  const out: Pt[][] = [];
  for (const { obj } of scene.expand(ids)) {
    if (!obj.shape) continue;
    const line = outlineOf(obj.shape, scene.geometry(obj)?.bbox ?? null);
    if (line) out.push(line);
  }
  return out;
}

function outlineOf(shape: Shape, bbox: BBox | null): Pt[] | null {
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    if (!shape.center || !r) return null;
    const sweep = shape.sweepAngle ?? 360;
    const steps = Math.max(8, Math.ceil(Math.abs(sweep) / SAMPLE_DEG));
    return ellipsePoints(shape.center, r.rx, r.ry, shape.startAngle ?? 0, sweep, steps);
  }
  if (shape.points.length >= 2) {
    const pts = shape.points;
    return isClosedShape(shape) ? [...pts, pts[0]] : [...pts];
  }
  // text and images: their bounding box
  if (!bbox) return null;
  const { x0, y0, x1, y1 } = bbox;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
}

/** Small accent dot marking a point. */
export function drawMarker(g: Painter, p: Pt): void {
  const s = g.toScreen(p);
  const { ctx } = g;
  ctx.save();
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Accent pill with white text. `at` is the left edge, vertically centred, in screen px. */
export function drawLabel(g: Painter, at: Pt, text: string): void {
  const { ctx } = g;
  ctx.save();
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.roundRect(at.x, at.y - 10, w, 20, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at.x + 6, at.y);
  ctx.restore();
}

/** Signed angle in degrees to one decimal, e.g. "47.5°" or "-15°". */
export function degLabel(deg: number): string {
  return `${Math.round(deg * 10) / 10}°`;
}
