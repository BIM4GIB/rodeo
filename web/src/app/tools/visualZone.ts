// The clicks Zone of Visual Influence asks for (siteView.ts): the observation point on the site model, then one more
// to run the analysis. Taken up by the command alone; Esc hands back the tool before it.

import type { Pt } from "../../core/index.ts";
import { ACCENT } from "../renderer.ts";
import { analyseViewFrom, endViewJob, onJobModel, viewJob } from "../siteView.ts";
import { toast } from "../toast.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";

export class VisualZoneTool extends BaseTool {
  readonly id = "visualzone";
  readonly cursor = "crosshair";

  private from: Pt | null = null;

  hint(): string {
    if (!viewJob()) return "Zone of Visual Influence: choose it from AEC > Terrain";
    return this.from ? "Click again to perform the analysis · Esc cancels" : "Click the site model at the observation point · Esc cancels";
  }

  down(p: PointerInfo): void {
    if (!viewJob()) return;
    if (!this.from) {
      if (onJobModel(p.pos)) this.from = p.pos;
      else toast("Click on the site model.", "error");
      return;
    }
    const from = this.from;
    this.from = null;
    analyseViewFrom(from);
  }

  cancel(): void {
    this.from = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.cancel();
    endViewJob();
    return true;
  }

  overlay(g: Painter): void {
    if (!this.from) return;
    const { ctx } = g;
    const q = g.toScreen(this.from);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
    ctx.moveTo(q.x - 11, q.y);
    ctx.lineTo(q.x + 11, q.y);
    ctx.moveTo(q.x, q.y - 11);
    ctx.lineTo(q.x, q.y + 11);
    ctx.stroke();
    ctx.restore();
  }
}
