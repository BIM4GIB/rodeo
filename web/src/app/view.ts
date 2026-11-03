// World <-> screen mapping. World is y-up document units; screen is CSS pixels
// with the origin at the canvas top-left and y pointing down. A rotated plan (View > Rotate Plan)
// turns the drawing on screen about the view's centre; its plan coordinates are measured from the
// pivot along the screen's own axes.

import type { Affine, BBox, Pt } from "../core/index.ts";
import { clamp } from "./geom.ts";

const MIN_SCALE = 1e-6;
const MAX_SCALE = 1e6;

export class View {
  /** world point shown at the centre of the canvas */
  cx = 0;
  cy = 0;
  /** CSS pixels per document unit */
  scale = 1;
  /** canvas size in CSS pixels */
  width = 1;
  height = 1;
  /** what the docked palettes cover of the canvas's sides, in CSS pixels; fitting leaves it clear */
  insets = { left: 0, right: 0 };
  /** the plan's rotation, radians counter-clockwise: how far the drawing is turned on screen (0: not rotated) */
  rotation = 0;
  /** the rotated plan's origin, in world coordinates */
  pivot: Pt = { x: 0, y: 0 };

  /** A world vector as it lies on screen, before scaling (y up). */
  private turn(dx: number, dy: number): Pt {
    if (this.rotation === 0) return { x: dx, y: dy };
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    return { x: c * dx - s * dy, y: s * dx + c * dy };
  }

  /** A vector on screen (y up, before scaling) as it lies in the world. */
  private unturn(dx: number, dy: number): Pt {
    if (this.rotation === 0) return { x: dx, y: dy };
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    return { x: c * dx + s * dy, y: -s * dx + c * dy };
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  toScreen(p: Pt): Pt {
    const r = this.turn(p.x - this.cx, p.y - this.cy);
    return {
      x: r.x * this.scale + this.width / 2,
      y: this.height / 2 - r.y * this.scale,
    };
  }

  toWorld(sx: number, sy: number): Pt {
    const d = this.unturn((sx - this.width / 2) / this.scale, (this.height / 2 - sy) / this.scale);
    return { x: d.x + this.cx, y: d.y + this.cy };
  }

  /** How far a world move of (dx, dy) goes on screen, in CSS pixels (y down). */
  screenDelta(dx: number, dy: number): Pt {
    const r = this.turn(dx, dy);
    return { x: r.x * this.scale, y: -r.y * this.scale };
  }

  /** The canvas transform that draws world coordinates in this view, at `dpr` device pixels per CSS pixel. */
  matrix(dpr: number): [number, number, number, number, number, number] {
    const k = dpr * this.scale;
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const o = this.turn(this.cx, this.cy);
    return [k * c, -k * s, -k * s, -k * c, dpr * (this.width / 2) - k * o.x, dpr * (this.height / 2) + k * o.y];
  }

  /** A world point in the rotated plan's coordinates: from the pivot, along the screen's axes (the point itself, not rotated). */
  toPlan(p: Pt): Pt {
    if (this.rotation === 0) return p;
    return this.turn(p.x - this.pivot.x, p.y - this.pivot.y);
  }

  /** A point in the rotated plan's coordinates in the world. */
  fromPlan(q: Pt): Pt {
    if (this.rotation === 0) return q;
    const d = this.unturn(q.x, q.y);
    return { x: d.x + this.pivot.x, y: d.y + this.pivot.y };
  }

  /** What takes the rotated plan's coordinates to the drawing's, as fromPlan does. */
  planAffine(): Affine {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    return { a: c, b: -s, c: s, d: c, e: this.pivot.x, f: this.pivot.y };
  }

  /** What a change `m` in the rotated plan's coordinates does in the drawing's. */
  planChange(m: Affine): Affine {
    if (this.rotation === 0) return m;
    const at = (x: number, y: number): Pt => {
      const q = this.toPlan({ x, y });
      return this.fromPlan({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
    };
    const o = at(0, 0);
    const ex = at(1, 0);
    const ey = at(0, 1);
    return { a: ex.x - o.x, b: ex.y - o.y, c: ey.x - o.x, d: ey.y - o.y, e: o.x, f: o.y };
  }

  /** Zooms by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const under = this.toWorld(sx, sy);
    this.scale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    this.keepAt(under, sx, sy);
  }

  /** Moves the view so the world point `p` shows at (sx, sy). */
  keepAt(p: Pt, sx: number, sy: number): void {
    const d = this.unturn((sx - this.width / 2) / this.scale, (this.height / 2 - sy) / this.scale);
    this.cx = p.x - d.x;
    this.cy = p.y - d.y;
  }

  /** Pans by a screen-space delta in CSS pixels (content follows the pointer). */
  pan(dxPx: number, dyPx: number): void {
    const d = this.unturn(dxPx / this.scale, -dyPx / this.scale);
    this.cx -= d.x;
    this.cy -= d.y;
  }

  /** Puts a world point at the centre of the canvas at the given scale (saved views use this). */
  setCenterAndScale(cx: number, cy: number, scale: number): void {
    this.cx = cx;
    this.cy = cy;
    this.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
  }

  /** Centres and scales so that `b` fills the canvas between the docked palettes, with a margin. */
  fit(b: BBox, margin = 0.08): void {
    // in a narrow window the palettes cover most of it: fit to the whole canvas instead
    const covered = this.insets.left + this.insets.right < this.width * 0.6;
    const left = covered ? this.insets.left : 0;
    const right = covered ? this.insets.right : 0;
    // in a rotated plan, the box as it lies on screen
    const corners = [this.turn(b.x0, b.y0), this.turn(b.x1, b.y0), this.turn(b.x1, b.y1), this.turn(b.x0, b.y1)];
    const bw = Math.max(Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x)), 1e-6);
    const bh = Math.max(Math.max(...corners.map((p) => p.y)) - Math.min(...corners.map((p) => p.y)), 1e-6);
    const usableW = (this.width - left - right) * (1 - 2 * margin);
    const usableH = this.height * (1 - 2 * margin);
    this.scale = clamp(Math.min(usableW / bw, usableH / bh), MIN_SCALE, MAX_SCALE);
    // the middle of the clear part of the canvas, not of the whole canvas
    const shift = this.unturn(-(left - right) / (2 * this.scale), 0);
    this.cx = (b.x0 + b.x1) / 2 + shift.x;
    this.cy = (b.y0 + b.y1) / 2 + shift.y;
  }

  /** The world-space rectangle currently visible on the canvas (in a rotated plan, the box round what shows). */
  visibleRect(): BBox {
    if (this.rotation === 0) {
      const a = this.toWorld(0, this.height);
      const b = this.toWorld(this.width, 0);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    }
    const pts = [this.toWorld(0, 0), this.toWorld(this.width, 0), this.toWorld(this.width, this.height), this.toWorld(0, this.height)];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
}
