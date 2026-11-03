// The clicks Modify > Drafting Aids > Create Dividing Lines… asks for (dividingLines.ts), as
// Vectorworks takes them: click where the dividing lines start, then where they end. A circle round
// the lines' crossing (or a line across parallel lines) shows where they would start or end through
// the pointer, and the lines show as the second click is sought. The tool is taken up by the command
// alone and hands back to the tool before it, which the settings dialog then follows; Esc gives up.

import type { Pt } from "../../core/index.ts";
import { dividingGuide, dividingJob, dividingShapes, endDividingJob, finishDividingLines, previewCount, type DividingGuide } from "../dividingLines.ts";
import { pickPx } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

export class DividingTool extends BaseTool {
  readonly id = "dividing";
  readonly cursor = "crosshair";

  private start: Pt | null = null;
  private live: Pt | null = null;

  constructor(
    env: ToolEnv,
    private readonly done: () => void,
  ) {
    super(env);
  }

  snapFrom(): Pt | null {
    return this.start;
  }

  hint(): string {
    if (!dividingJob()) return "Dividing Lines: select two lines and choose Modify > Drafting Aids > Create Dividing Lines…";
    if (!this.start) return "Click where the dividing lines start · Esc cancels";
    return "Click where they end (on the same guide for loci) · Esc cancels";
  }

  down(p: PointerInfo): void {
    const j = dividingJob();
    if (!j) {
      this.finish();
      return;
    }
    if (!this.start) {
      this.start = p.pos;
      return;
    }
    const start = this.start;
    this.finish();
    void finishDividingLines(j, start, p.pos, this.same());
  }

  move(p: PointerInfo): void {
    this.live = p.pos;
  }

  cancel(): void {
    this.start = null;
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.finish();
    return true;
  }

  overlay(g: Painter): void {
    const j = dividingJob();
    if (!j) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    const guide = (at: Pt): void => {
      const gd = dividingGuide(j, at);
      if (gd) this.strokeGuide(g, gd);
    };
    if (this.start) guide(this.start);
    if (this.live) guide(this.live);
    ctx.setLineDash([]);
    if (this.start && this.live) {
      for (const s of dividingShapes(j, this.start, this.live, previewCount(), this.same())) {
        if (s.kind === "line") {
          const a = g.toScreen(s.a);
          const b = g.toScreen(s.b);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        } else if (s.kind === "locus") {
          const c = g.toScreen(s.at);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  private strokeGuide(g: Painter, gd: DividingGuide): void {
    const { ctx } = g;
    ctx.beginPath();
    if (gd.kind === "circle") {
      const c = g.toScreen(gd.center);
      const e = g.toScreen({ x: gd.center.x + gd.radius, y: gd.center.y });
      ctx.arc(c.x, c.y, Math.hypot(e.x - c.x, e.y - c.y), 0, Math.PI * 2);
    } else {
      const a = g.toScreen(gd.a);
      const b = g.toScreen(gd.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /** How near (document units) the end must be to the start's guide to count as on it: the pick distance. */
  private same(): number {
    return pickPx() / this.env.view.scale;
  }

  private finish(): void {
    this.cancel();
    endDividingJob();
    this.done();
  }
}
