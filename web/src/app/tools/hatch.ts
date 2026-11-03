// The clicks Modify > Hatch… asks for (hatchCommand.ts), as Vectorworks' paint bucket takes them:
// click where the hatch starts, then move to turn it and click again; the hatch shows over the
// object as it turns. Shift holds the turn to 15° steps. The tool is taken up by the command alone
// and hands back to the tool before it when done; Esc gives up.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { endHatchJob, hatchJob, hatchSegments, placeHatch } from "../hatchCommand.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

const MIN_WORLD = 1e-9;
/** the most lines the preview draws as the hatch turns */
const PREVIEW_LINES = 4000;

export class HatchTool extends BaseTool {
  readonly id = "hatch";
  readonly cursor = "crosshair";

  /** where the hatch starts, once clicked */
  private origin: Pt | null = null;
  private live: Pt | null = null;

  constructor(
    env: ToolEnv,
    private readonly done: () => void,
  ) {
    super(env);
  }

  snapFrom(): Pt | null {
    return this.origin;
  }

  hint(): string {
    const job = hatchJob();
    if (!job) return "Hatch: select a closed object and choose Modify > Hatch…";
    if (!this.origin) return `${job.name}: click where the hatch starts · Esc cancels`;
    return `Move to turn the hatch, then click · Shift ${ANGLE_STEP_DEG}° · Esc cancels`;
  }

  down(p: PointerInfo): void {
    if (!hatchJob()) {
      this.finish();
      return;
    }
    if (!this.origin) {
      this.origin = p.pos;
      this.live = null;
      return;
    }
    const at = this.turnAt(p);
    if (dist(at, this.origin) < MIN_WORLD) return;
    placeHatch(this.origin, this.angleTo(at));
    this.finish();
  }

  move(p: PointerInfo): void {
    if (this.origin) this.live = this.turnAt(p);
  }

  cancel(): void {
    this.origin = null;
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.finish();
    return true;
  }

  overlay(g: Painter): void {
    const job = hatchJob();
    if (!job || !this.origin) return;
    const { ctx } = g;
    const o = g.toScreen(this.origin);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (this.live && dist(this.live, this.origin) >= MIN_WORLD) {
      const l = g.toScreen(this.live);
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(l.x, l.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // the hatch as it would be drawn, while it isn't too dense to show
      const lines = hatchSegments(job.outline, job.hatch, this.origin, this.angleTo(this.live), job.scale, PREVIEW_LINES);
      if (lines) {
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        for (const s of lines) {
          const a = g.toScreen(s.a);
          const b = g.toScreen(s.b);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The turn's point for the pointer: snapped, and on a 15° line from the origin under Shift. */
  private turnAt(p: PointerInfo): Pt {
    return p.shift && this.origin ? snapAngle(this.origin, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  /** The hatch's turn toward `at`, degrees counter-clockwise from +x. */
  private angleTo(at: Pt): number {
    return (Math.atan2(at.y - this.origin!.y, at.x - this.origin!.x) * 180) / Math.PI;
  }

  private finish(): void {
    this.cancel();
    endHatchJob();
    this.done();
  }
}
