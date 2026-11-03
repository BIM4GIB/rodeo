// Arc tool, in four modes (keys 1 to 4 or the Mode bar):
// - By Radius: click the centre, click the start point (sets the radius and the
//   start angle), then move to choose the end and click. The sweep is
//   counter-clockwise positive and follows the pointer, past 180 degrees up to
//   a full circle.
// - Three Points: click the start, a point on the arc, and the end.
// - Quarter Arc: click the start and the end; the arc is the quarter of the
//   ellipse they span, bulging one way or, with Option (Alt) held, the other.
// - Tangent Arc: click the start, a point along the direction the arc leaves
//   it in, and the end; the arc runs from the start along that direction.
// In By Radius mode Shift snaps angles to 15 degrees. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { clamp, dist, ellipsePoints } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { ALT_KEY, BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { degLabel, drawLabel, drawMarker } from "./rotate.ts";

const SNAP_DEG = 15;
const MIN_WORLD = 1e-9;
/** sweeps smaller than this (degrees) are not committed */
const MIN_SWEEP = 0.01;
const CIRCLE_STEPS = 96;

type ArcMode = "radius" | "three" | "quarter" | "tangent";
const MODES: readonly ArcMode[] = ["radius", "three", "quarter", "tangent"];
const MODE_NAME: Record<ArcMode, string> = { radius: "By Radius", three: "Three Points", quarter: "Quarter Arc", tangent: "Tangent Arc" };

/** An arc as the core stores one: counter-clockwise from its start. */
interface ArcSpec {
  readonly center: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly start: number;
  readonly sweep: number;
}

/** Angle of `p` seen from `c`, degrees in (-180, 180], counter-clockwise from +x. */
function angleOf(c: Pt, p: Pt): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

/** Wraps a degree difference into [-180, 180). */
function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function snapDeg(deg: number): number {
  return Math.round(deg / SNAP_DEG) * SNAP_DEG;
}

/** The arc from `a` through `m` to `b`, or null when the three points are in a line. */
export function arcThrough(a: Pt, m: Pt, b: Pt): ArcSpec | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  const size = Math.max(dist(a, m), dist(m, b), dist(a, b));
  if (!(size > MIN_WORLD) || Math.abs(d) < 1e-9 * size * size) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const center = {
    x: (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d,
    y: (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d,
  };
  const r = dist(center, a);
  const s = angleOf(center, a);
  const span = normDeg(angleOf(center, b) - s);
  // counter-clockwise from a when that way passes m, else counter-clockwise from b
  if (normDeg(angleOf(center, m) - s) <= span) return { center, rx: r, ry: r, start: normDeg(s), sweep: span };
  return { center, rx: r, ry: r, start: normDeg(s + span), sweep: 360 - span };
}

/**
 * The arc that leaves `a` heading towards `t` and ends at `b`: its centre is on
 * the normal to that direction at `a`, as far from `b` as from `a`. Null when `b`
 * lies on the line the arc leaves along (it would be straight).
 */
export function arcTangent(a: Pt, t: Pt, b: Pt): ArcSpec | null {
  const len = dist(a, t);
  if (!(len > MIN_WORLD) || !(dist(a, b) > MIN_WORLD)) return null;
  const u = { x: (t.x - a.x) / len, y: (t.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const d = { x: b.x - a.x, y: b.y - a.y };
  const across = d.x * n.x + d.y * n.y;
  const d2 = d.x * d.x + d.y * d.y;
  if (Math.abs(across) < 1e-9 * Math.sqrt(d2)) return null;
  // signed distance from a to the centre along n: positive turns left (counter-clockwise)
  const k = d2 / (2 * across);
  const center = { x: a.x + n.x * k, y: a.y + n.y * k };
  const r = Math.abs(k);
  const sa = angleOf(center, a);
  const sb = angleOf(center, b);
  return k > 0
    ? { center, rx: r, ry: r, start: normDeg(sa), sweep: normDeg(sb - sa) }
    : { center, rx: r, ry: r, start: normDeg(sb), sweep: normDeg(sa - sb) };
}

/** The quarter of the ellipse that `a` and `b` span; `flip` bulges it the other way. */
export function quarterArc(a: Pt, b: Pt, flip: boolean): ArcSpec | null {
  const rx = Math.abs(b.x - a.x);
  const ry = Math.abs(b.y - a.y);
  if (rx < MIN_WORLD || ry < MIN_WORLD) return null;
  // the centre is the box corner level with one end and plumb with the other
  const [h, v] = flip ? [b, a] : [a, b];
  const center = { x: v.x, y: h.y };
  const ah = h.x > center.x ? 0 : 180;
  const av = v.y > center.y ? 90 : 270;
  const turn = wrap180(av - ah);
  return { center, rx, ry, start: turn > 0 ? ah : av, sweep: 90 };
}

function arcPoints(s: ArcSpec): Pt[] {
  return ellipsePoints(s.center, s.rx, s.ry, s.start, s.sweep, Math.max(2, Math.ceil(s.sweep / 2)));
}

function commitArc(s: ArcSpec): void {
  addAndSelect({
    kind: "arc",
    center: s.center,
    radius: s.rx,
    ...(s.ry !== s.rx ? { radiusY: s.ry } : {}),
    startAngle: s.start,
    sweepAngle: s.sweep,
  });
}

function strokeArc(g: Painter, pts: readonly Pt[]): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  strokeScreen(g, pts, false);
  ctx.restore();
}

export class ArcTool extends BaseTool {
  readonly id = "arc";
  readonly cursor = "crosshair";

  private mode: ArcMode = "radius";
  /** points placed in the Three Points and Quarter Arc modes */
  private placed: Pt[] = [];
  /** Option/Alt state; PointerInfo carries no alt flag, so it is read from window events */
  private altHeld = false;

  /** centre; null before the first click */
  private centre: Pt | null = null;
  private radius = 0;
  /** start angle in degrees, fixed by the second click */
  private startAngle = 0;
  /** whether the start point has been placed */
  private hasStart = false;
  /** unwrapped sweep in degrees, counter-clockwise positive; may exceed 360 while tracking */
  private sweep = 0;
  /** previous cursor angle, used to unwrap the sweep */
  private lastAngle = 0;
  /** last snapped pointer position */
  private pointer: Pt | null = null;

  constructor(env: ToolEnv) {
    super(env);
    const track = (e: KeyboardEvent | PointerEvent): void => {
      if (this.altHeld === e.altKey) return;
      this.altHeld = e.altKey;
      if (this.mode === "quarter") env.requestDraw();
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    // capture phase: the flag is set before the canvas delivers the click
    window.addEventListener("pointerdown", track, true);
    window.addEventListener("blur", () => {
      this.altHeld = false;
    });
  }

  modes(): ToolModes {
    return {
      options: MODES.map((m, i) => ({ id: m, label: MODE_NAME[m], key: String(i + 1) })),
      active: this.mode,
    };
  }

  /** Switches the way arcs are drawn; a gesture in progress is dropped. */
  setMode(id: string): void {
    const mode = MODES.find((m) => m === id);
    if (!mode || mode === this.mode) return;
    this.mode = mode;
    this.reset();
  }

  hint(): string {
    if (this.mode === "three") {
      if (this.placed.length === 0) return "Click the start of the arc · 1–4 mode";
      if (this.placed.length === 1) return "Click a point on the arc";
      return "Click the end of the arc";
    }
    if (this.mode === "tangent") {
      if (this.placed.length === 0) return "Click the start of the arc · 1–4 mode";
      if (this.placed.length === 1) return "Click to set the start direction";
      return "Click the end of the arc";
    }
    if (this.mode === "quarter") {
      if (this.placed.length === 0) return "Click the start of the arc · 1–4 mode";
      return `Click the end of the arc · ${ALT_KEY} flips bulge`;
    }
    if (!this.centre) return "Click the centre · 1–4 mode";
    if (!this.hasStart) return "Click the start to set the radius · Shift 15°";
    return "Click to set the end angle · Shift 15°";
  }

  down(p: PointerInfo): void {
    if (this.mode !== "radius") {
      this.pointer = p.pos;
      this.placed.push(p.pos);
      const spec = this.pending(p.pos);
      if (this.placed.length < (this.mode === "quarter" ? 2 : 3)) return;
      this.reset();
      if (spec) commitArc(spec);
      return;
    }
    if (!this.centre) {
      this.centre = p.pos;
      this.pointer = p.pos;
      return;
    }
    if (!this.hasStart) {
      const r = dist(this.centre, p.pos);
      if (r < MIN_WORLD) return;
      const a = angleOf(this.centre, p.pos);
      this.radius = r;
      this.startAngle = p.shift ? snapDeg(a) : a;
      this.lastAngle = this.startAngle;
      this.sweep = 0;
      this.hasStart = true;
      this.pointer = p.pos;
      return;
    }
    this.track(p);
    const sweep = clamp(this.sweep, -360, 360);
    if (Math.abs(sweep) < MIN_SWEEP) return;
    const c = this.centre;
    // a clockwise sweep is stored as the counter-clockwise arc it covers, so the
    // start angle moves to the other end; a full turn is a circle
    let start = this.startAngle;
    let span = sweep;
    if (Math.abs(span) >= 360) span = 360;
    else if (span < 0) {
      start += span;
      span = -span;
    }
    addAndSelect({ kind: "arc", center: c, radius: this.radius, startAngle: normDeg(start), sweepAngle: span });
    this.reset();
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    if (this.hasStart) this.track(p);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (!e.metaKey && !e.ctrlKey && e.key >= "1" && e.key <= String(MODES.length)) {
      this.setMode(MODES[Number(e.key) - 1]);
      return true;
    }
    if (e.key !== "Escape" || (!this.centre && this.placed.length === 0)) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    if (this.mode !== "radius") {
      this.overlayPlaced(g);
      return;
    }
    const c = this.centre;
    const p = this.pointer;
    if (!c || !p) return;
    if (!this.hasStart) {
      drawCircle(g, c, dist(c, p));
      withPreview(g, () => strokeScreen(g, [c, p], false));
      drawMarker(g, c);
      return;
    }
    drawCircle(g, c, this.radius);
    const sweep = clamp(this.sweep, -360, 360);
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 2));
    const arc = ellipsePoints(c, this.radius, this.radius, this.startAngle, sweep, steps);
    strokeArc(g, arc);
    const end = arc[arc.length - 1];
    withPreview(g, () => {
      strokeScreen(g, [c, arc[0]], false);
      strokeScreen(g, [c, end], false);
    });
    drawMarker(g, c);
    const E = g.toScreen(end);
    drawLabel(g, { x: E.x + 12, y: E.y - 22 }, degLabel(sweep));
  }

  /** Follows the pointer: adds the change in angle since the last sample, shift-snapped when held. */
  private track(p: PointerInfo): void {
    const c = this.centre;
    if (!c || dist(p.pos, c) < MIN_WORLD) return;
    let a = angleOf(c, p.pos);
    if (p.shift) a = snapDeg(a);
    this.sweep += wrap180(a - this.lastAngle);
    this.lastAngle = a;
  }

  /** The arc the placed points and `at` define (Three Points, Quarter Arc, Tangent Arc). */
  private pending(at: Pt): ArcSpec | null {
    const [a, m] = this.placed;
    if (this.mode === "quarter") return a ? quarterArc(a, at, this.altHeld) : null;
    if (!a || !m || (this.placed.length !== 2 && this.placed[2] !== at)) return null;
    return this.mode === "tangent" ? arcTangent(a, m, at) : arcThrough(a, m, at);
  }

  private overlayPlaced(g: Painter): void {
    const p = this.pointer;
    const [a, m] = this.placed;
    if (!p || !a) return;
    const spec = this.pending(p);
    if (spec) {
      strokeArc(g, arcPoints(spec));
      if (this.mode === "quarter") {
        const box = [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
        withPreview(g, () => {
          g.ctx.globalAlpha = 0.35;
          strokeScreen(g, box, true);
        });
      }
    } else {
      withPreview(g, () => strokeScreen(g, m ? [a, m, p] : [a, p], false));
    }
    // the direction a tangent arc leaves its start
    if (this.mode === "tangent" && m) withPreview(g, () => strokeScreen(g, [a, m], false));
    for (const q of this.placed) drawMarker(g, q);
  }

  private reset(): void {
    this.placed = [];
    this.centre = null;
    this.radius = 0;
    this.hasStart = false;
    this.sweep = 0;
    this.lastAngle = 0;
  }
}

/** Faint dashed circle of radius `r` around `c`. */
function drawCircle(g: Painter, c: Pt, r: number): void {
  const pts = ellipsePoints(c, r, r, 0, 360, CIRCLE_STEPS);
  withPreview(g, () => {
    g.ctx.globalAlpha = 0.35;
    strokeScreen(g, pts, true);
  });
}
