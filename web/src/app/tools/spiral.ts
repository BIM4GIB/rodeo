// Spiral tool: click the centre, then move out from it. Each turn of the
// pointer around the centre adds a loop; the spiral's outer end follows the
// pointer, and a click draws it as a smooth polyline. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dist } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, strokeScreen, type Painter, type PointerInfo } from "../tools.ts";
import { degLabel, drawLabel, drawMarker } from "./rotate.ts";

const MIN_WORLD = 1e-9;
/** degrees between the polyline's control points */
const CONTROL_STEP = 15;
/** degrees between the preview's points */
const PREVIEW_STEP = 4;
/** spirals of less than this many degrees are not committed */
const MIN_SWEEP = 30;

function angleOf(c: Pt, p: Pt): number {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

/** Wraps a degree difference into [-180, 180). */
function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Points along an Archimedean spiral from `c` out to radius `r`, ending at `end` degrees after `sweep`. */
export function spiralPoints(c: Pt, r: number, end: number, sweep: number, step: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = ((end - sweep * (1 - t)) * Math.PI) / 180;
    out.push({ x: c.x + r * t * Math.cos(a), y: c.y + r * t * Math.sin(a) });
  }
  return out;
}

export class SpiralTool extends BaseTool {
  readonly id = "spiral";
  readonly cursor = "crosshair";

  private centre: Pt | null = null;
  private pointer: Pt | null = null;
  /** degrees the pointer has turned about the centre, counter-clockwise positive */
  private sweep = 0;
  /** the pointer's last angle about the centre, null until it leaves the centre */
  private lastAngle: number | null = null;

  hint(): string {
    if (!this.centre) return "Click the centre";
    return "Click at the outer end · Circle adds loops";
  }

  down(p: PointerInfo): void {
    if (!this.centre) {
      this.centre = p.pos;
      this.pointer = p.pos;
      return;
    }
    this.track(p.pos);
    const r = dist(this.centre, p.pos);
    if (r > MIN_WORLD && Math.abs(this.sweep) >= MIN_SWEEP) {
      const points = spiralPoints(this.centre, r, angleOf(this.centre, p.pos), this.sweep, CONTROL_STEP);
      addAndSelect({ kind: "polyline", points, closed: false, smooth: true });
    }
    this.reset();
  }

  move(p: PointerInfo): void {
    if (this.centre) this.track(p.pos);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.centre) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const c = this.centre;
    const p = this.pointer;
    if (!c || !p) return;
    drawMarker(g, c);
    const r = dist(c, p);
    if (r <= MIN_WORLD || this.sweep === 0) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    strokeScreen(g, spiralPoints(c, r, angleOf(c, p), this.sweep, PREVIEW_STEP), false);
    ctx.restore();
    const P = g.toScreen(p);
    drawLabel(g, { x: P.x + 12, y: P.y - 22 }, `${(Math.abs(this.sweep) / 360).toFixed(1)} turns · ${degLabel(this.sweep)}`);
  }

  /** Adds the pointer's turn about the centre since the last sample. */
  private track(at: Pt): void {
    const c = this.centre;
    this.pointer = at;
    if (!c || dist(c, at) < MIN_WORLD) return;
    const a = angleOf(c, at);
    if (this.lastAngle !== null) this.sweep += wrap180(a - this.lastAngle);
    this.lastAngle = a;
  }

  private reset(): void {
    this.centre = null;
    this.pointer = null;
    this.sweep = 0;
    this.lastAngle = null;
  }
}
