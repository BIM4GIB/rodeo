// The clicks View > Rotate Plan asks for (planRotation.ts): the centre of the rotation, then a point
// on the line that will become level, snapping to objects as any tool does. The reference line, the
// screen's level and an arrowed arc for the way the plan will turn show as the pointer moves. Taken
// up by the command alone; it ends after the second click, or with Esc, handing back the tool before it.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { endRotatePlan, rotatePlanAlong } from "../planRotation.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";

/** pointer travel (CSS px) that counts as a drag, and the nearest the second point may be */
const CLICK_PX = 4;
/** the arc's radius and the arrowhead's size, CSS px */
const ARC_PX = 64;
const HEAD_PX = 8;
/** how far the reference line and the level run past the centre, CSS px */
const LINE_PX = 4000;

export class RotatePlanTool extends BaseTool {
  readonly id = "rotateplan";
  readonly cursor = "crosshair";
  private centre: Pt | null = null;
  private press: Pt | null = null;
  private live: Pt | null = null;

  hint(): string {
    return this.centre ? `Click on the line that will become level · Shift ${ANGLE_STEP_DEG}° · Esc cancels` : "Click the center of the plan's rotation · Esc cancels";
  }

  snapFrom(): Pt | null {
    return this.centre;
  }

  private target(p: PointerInfo): Pt {
    return this.centre && p.shift ? snapAngle(this.centre, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  down(p: PointerInfo): void {
    this.live = this.target(p);
    if (!this.centre) {
      this.centre = p.pos;
      this.press = p.screen;
      return;
    }
    this.finish(this.target(p));
  }

  move(p: PointerInfo): void {
    this.live = this.target(p);
  }

  up(p: PointerInfo): void {
    // a press dragged from the centre to the line
    const press = this.press;
    this.press = null;
    if (press && this.centre && dist(press, p.screen) >= CLICK_PX) this.finish(this.target(p));
  }

  private finish(along: Pt): void {
    const centre = this.centre;
    if (!centre || dist(this.env.view.toScreen(centre), this.env.view.toScreen(along)) < CLICK_PX) return;
    this.cancel();
    rotatePlanAlong(centre, along);
    endRotatePlan();
  }

  cancel(): void {
    this.centre = null;
    this.press = null;
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape") return false;
    this.cancel();
    endRotatePlan();
    return true;
  }

  overlay(g: Painter): void {
    const { centre, live } = this;
    if (!centre) return;
    const c = g.toScreen(centre);
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1;
    // the screen's level, where the line will come to lie
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(c.x - LINE_PX, c.y);
    ctx.lineTo(c.x + LINE_PX, c.y);
    ctx.stroke();
    const q = live ? g.toScreen(live) : null;
    if (q && dist(c, q) >= CLICK_PX) {
      const a = Math.atan2(q.y - c.y, q.x - c.x);
      // the reference line
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(c.x - Math.cos(a) * LINE_PX, c.y - Math.sin(a) * LINE_PX);
      ctx.lineTo(c.x + Math.cos(a) * LINE_PX, c.y + Math.sin(a) * LINE_PX);
      ctx.stroke();
      // the way it will turn, the short way round to the level on the right
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, ARC_PX, a, 0, a > 0);
      ctx.stroke();
      const ahead = a < 0 ? 1 : -1;
      const tip = { x: c.x + ARC_PX, y: c.y };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - HEAD_PX / 2, tip.y - ahead * HEAD_PX);
      ctx.lineTo(tip.x + HEAD_PX / 2, tip.y - ahead * HEAD_PX);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
