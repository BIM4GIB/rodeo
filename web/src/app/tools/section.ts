// The clicks Model > Cut 2D Section and Cut 3D Section ask for, as Vectorworks does: the section
// line's start and end (Shift holds it to 15° steps), then a click on the side of it to keep. The
// tool is taken up by the commands alone and hands back to the tool before it when done; Esc gives
// up.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

const MIN_WORLD = 1e-9;
/** the arrow to the kept side, CSS px */
const ARROW_PX = 28;
const HEAD_PX = 7;

/** The line and the side kept, or null when given up. */
export type SectionLine = { a: Pt; b: Pt; keepLeft: boolean } | null;

export class SectionTool extends BaseTool {
  readonly id = "section2d";
  readonly cursor = "crosshair";

  /** the line's start, then its end, as clicked */
  private clicked: Pt[] = [];
  private live: Pt | null = null;

  constructor(
    env: ToolEnv,
    private readonly done: (line: SectionLine) => void,
  ) {
    super(env);
  }

  snapFrom(): Pt | null {
    return this.clicked.length === 1 ? this.clicked[0] : null;
  }

  hint(): string {
    if (this.clicked.length === 0) return "Section: click the section line's start · Esc cancels";
    if (this.clicked.length === 1) return `Click the section line's end · Shift ${ANGLE_STEP_DEG}° · Esc cancels`;
    return "Click the side of the line to keep · Esc cancels";
  }

  down(p: PointerInfo): void {
    if (this.clicked.length === 2) {
      const [a, b] = this.clicked;
      const side = this.sideOf(p.raw);
      // a click on the line itself says nothing
      if (side === 0) return;
      this.clicked = [];
      this.live = null;
      this.done({ a, b, keepLeft: side > 0 });
      return;
    }
    const at = this.clicked.length === 1 && p.shift ? snapAngle(this.clicked[0], p.pos, ANGLE_STEP_DEG) : p.pos;
    if (this.clicked.length === 1 && dist(at, this.clicked[0]) < MIN_WORLD) return;
    this.clicked.push(at);
    this.live = this.clicked.length === 2 ? p.raw : null;
  }

  move(p: PointerInfo): void {
    if (this.clicked.length === 1) this.live = p.shift ? snapAngle(this.clicked[0], p.pos, ANGLE_STEP_DEG) : p.pos;
    else if (this.clicked.length === 2) this.live = p.raw;
  }

  cancel(): void {
    this.clicked = [];
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.cancel();
    this.done(null);
    return true;
  }

  /** Which side of the line `p` lies: 1 left of start → end, -1 right, 0 on it. */
  private sideOf(p: Pt): number {
    const [a, b] = this.clicked;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    return Math.abs(cross) < MIN_WORLD ? 0 : Math.sign(cross);
  }

  overlay(g: Painter): void {
    const [a] = this.clicked;
    const b = this.clicked[1] ?? this.live;
    if (!a || !b) return;
    const { ctx } = g;
    const sa = g.toScreen(a);
    const sb = g.toScreen(b);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(this.clicked.length < 2 ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const s of [sa, sb]) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // choosing the side: an arrow from the line's middle to the side under the pointer
    const len = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    if (this.clicked.length === 2 && this.live && len >= 1) {
      const side = this.sideOf(this.live);
      if (side !== 0) {
        // world left of a → b is the screen's left too (both turn the same way, y flipped)
        const nx = ((sb.y - sa.y) / len) * side;
        const ny = (-(sb.x - sa.x) / len) * side;
        const m = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
        const tip = { x: m.x + nx * ARROW_PX, y: m.y + ny * ARROW_PX };
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        const bx = -nx;
        const by = -ny;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + bx * HEAD_PX - by * HEAD_PX * 0.6, tip.y + by * HEAD_PX + bx * HEAD_PX * 0.6);
        ctx.lineTo(tip.x + bx * HEAD_PX + by * HEAD_PX * 0.6, tip.y + by * HEAD_PX - bx * HEAD_PX * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
