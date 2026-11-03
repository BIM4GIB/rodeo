// The reference line Modify > Align > Align/Distribute Leader Lines… asks for (leaderLines.ts), as
// Vectorworks takes it: click its start, then its end, which must not be level with the start. The
// line shows as the second click is sought, and where each leader's shoulder and label points
// would go. The tool is taken up by the command alone and hands back to the tool before it; Esc
// gives up.

import type { Pt } from "../../core/index.ts";
import { alignLeaders } from "../leaderAlign.ts";
import { endLeaderJob, finishAlignLeaders, leaderJob } from "../leaderLines.ts";
import { ACCENT } from "../renderer.ts";
import { toast } from "../toast.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

export class AlignLeadersTool extends BaseTool {
  readonly id = "alignleaders";
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
    if (!leaderJob()) return "Leader Lines: select callouts or leader lines and choose Modify > Align > Align/Distribute Leader Lines…";
    if (!this.start) return "Click the start of the reference line the points go onto · Esc cancels";
    return "Click its end (not level with its start) · Esc cancels";
  }

  down(p: PointerInfo): void {
    const j = leaderJob();
    if (!j) {
      this.finish();
      return;
    }
    if (!this.start) {
      this.start = p.pos;
      return;
    }
    const start = this.start;
    // a level line can't take the points: keep the first click and ask again
    if (Math.abs(p.pos.y - start.y) <= 1e-9 * Math.max(1, Math.abs(p.pos.x - start.x))) {
      toast("The reference line must not be horizontal: click its end above or below its start.", "info");
      return;
    }
    this.cancel();
    this.done();
    finishAlignLeaders(j, start, p.pos);
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
    const j = leaderJob();
    if (!j || !this.start || !this.live) return;
    const { ctx } = g;
    const line = (a: Pt, b: Pt): void => {
      const p = g.toScreen(a);
      const q = g.toScreen(b);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    };
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    line(this.start, this.live);
    ctx.setLineDash([]);
    const moved = alignLeaders(
      j.targets.map((t) => t.leader),
      j.options,
      [this.start, this.live],
    );
    if (typeof moved !== "string") {
      j.targets.forEach((t, k) => {
        line(t.leader.target, moved[k].shoulder);
        line(moved[k].shoulder, moved[k].label);
      });
    }
    ctx.restore();
  }

  private finish(): void {
    this.cancel();
    endLeaderJob();
    this.done();
  }
}
