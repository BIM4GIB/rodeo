// The roof's axis AEC > Roof Face… asks for (roofFace.ts), as Vectorworks takes it: click (or press
// and drag) across the shape for the axis, then click the side the roof rises to; with 2nd Click
// Height, that click is where the roof is that high. The axis shows as it's drawn, then an arrow
// to the rising side. The tool is taken up by the command alone and hands back to the tool before
// it; Esc gives up.

import type { Pt } from "../../core/index.ts";
import { ACCENT } from "../renderer.ts";
import { endRoofFaceJob, finishRoofFace, roofFaceJob, slopeOf } from "../roofFace.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** a press dragged this far, CSS pixels, draws the axis */
const DRAG_PX = 4;
/** the rising side's arrow, CSS pixels */
const ARROW_PX = 36;

export class RoofFaceAxisTool extends BaseTool {
  readonly id = "roofaxis";
  readonly cursor = "crosshair";

  private start: Pt | null = null;
  private end: Pt | null = null;
  private pressed: Pt | null = null;
  private live: Pt | null = null;

  constructor(
    env: ToolEnv,
    private readonly done: () => void,
  ) {
    super(env);
  }

  snapFrom(): Pt | null {
    return this.end ?? this.start;
  }

  hint(): string {
    const job = roofFaceJob();
    if (!job) return "Roof Face: select a closed shape and choose AEC > Roof Face…";
    if (!this.start) return "Click (or drag across the shape) the start of the roof's axis · Esc cancels";
    if (!this.end) return "Click the axis' end · Esc cancels";
    if (job.settings.slope === "2nd Click Height") return "Click where the roof's underside is the 2nd click's height · Esc cancels";
    return "Click the side the roof rises to · Esc cancels";
  }

  down(p: PointerInfo): void {
    if (!roofFaceJob()) {
      this.finish();
      return;
    }
    if (!this.start) {
      this.start = p.pos;
      this.pressed = p.screen;
      return;
    }
    if (!this.end) {
      if (Math.hypot(p.pos.x - this.start.x, p.pos.y - this.start.y) > 1e-6) this.end = p.pos;
      return;
    }
    const [a, b] = [this.start, this.end];
    this.cancel();
    this.done();
    finishRoofFace(a, b, p.pos);
  }

  up(p: PointerInfo): void {
    // a press dragged across the shape is the axis
    if (this.start && !this.end && this.pressed && Math.hypot(p.screen.x - this.pressed.x, p.screen.y - this.pressed.y) > DRAG_PX) this.end = p.pos;
    this.pressed = null;
  }

  move(p: PointerInfo): void {
    this.live = p.pos;
  }

  cancel(): void {
    this.start = null;
    this.end = null;
    this.pressed = null;
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.finish();
    return true;
  }

  overlay(g: Painter): void {
    const job = roofFaceJob();
    if (!job || !this.start || !this.live) return;
    const { ctx } = g;
    const a = g.toScreen(this.start);
    const b = g.toScreen(this.end ?? this.live);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1.5;
    if (!this.end) ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const slope = this.end ? slopeOf(job, this.start, this.end, this.live) : null;
    if (this.end && slope) {
      // an arrow from the axis' middle, across it to the side that rises
      const d = { x: b.x - a.x, y: b.y - a.y };
      const l = Math.hypot(d.x, d.y) || 1;
      // the screen's y runs down, so the drawing's left of the axis is the screen's right of it
      const k = slope.side === 1 ? 1 : -1;
      const n = { x: (d.y / l) * k, y: (-d.x / l) * k };
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const tip = { x: m.x + n.x * ARROW_PX, y: m.y + n.y * ARROW_PX };
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      const back = { x: tip.x - n.x * 9, y: tip.y - n.y * 9 };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(back.x + n.y * 5, back.y - n.x * 5);
      ctx.lineTo(back.x - n.y * 5, back.y + n.x * 5);
      ctx.closePath();
      ctx.fill();
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(`${((slope.pitch * 180) / Math.PI).toFixed(1)}°`, tip.x + 6, tip.y - 4);
    }
    ctx.restore();
  }

  private finish(): void {
    this.cancel();
    endRoofFaceJob();
    this.done();
  }
}
