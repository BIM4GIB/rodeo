// The clicks Add Dimension(s) on a chain dimension's right-click menu asks for (chainDimension.ts):
// each is where a new witness line ends. The witness line it would draw, and the chain's line run
// out to it past an end, show as the pointer moves. Taken up by the command alone; a double-click
// or Enter ends, Backspace takes back the last, Esc ends, each handing back the tool before it.

import type { Pt } from "../../core/index.ts";
import { addDimensionAt, addingTo, endAddDimensions, takeBackDimension } from "../chainDimension.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;

export class AddDimensionsTool extends BaseTool {
  readonly id = "adddims";
  readonly cursor = "crosshair";

  private live: Pt | null = null;

  hint(): string {
    if (!addingTo()) return "Add Dimensions: right-click a chain or linear dimension and choose Add Dimension(s)";
    return "Click where each new witness line ends · double-click or Enter ends · Backspace takes back the last · Esc ends";
  }

  down(p: PointerInfo): void {
    // the second press of a double-click ends: the first has added its dimension
    if (p.detail >= 2) return endAddDimensions();
    addDimensionAt(p.pos);
  }

  move(p: PointerInfo): void {
    this.live = p.pos;
  }

  cancel(): void {
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Backspace") {
      takeBackDimension();
      return true;
    }
    if (e.key !== "Escape" && e.key !== "Enter") return false;
    this.cancel();
    endAddDimensions();
    return true;
  }

  overlay(g: Painter): void {
    const chain = addingTo();
    const p = this.live;
    if (!chain || !p) return;
    const { points, u, n, line } = chain;
    const along = (t: number): Pt => ({ x: u.x * t + n.x * line, y: u.y * t + n.y * line });
    const t = dot(p, u);
    const first = dot(points[0], u);
    const last = dot(points[points.length - 1], u);
    const { ctx } = g;
    const stroke = (a: Pt, b: Pt): void => {
      const q = g.toScreen(a);
      const r = g.toScreen(b);
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(r.x, r.y);
    };
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    stroke(p, along(t));
    if (t < first) stroke(along(t), along(first));
    if (t > last) stroke(along(last), along(t));
    ctx.stroke();
    ctx.restore();
  }
}
