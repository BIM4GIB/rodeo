// Quarter Arc tool, as Vectorworks' (Basic, sharing the Arc's place): click the start, then click
// (or release a drag) at the end. The arc turns 90° between them, leaving the start the way the
// pointer first moved off it (across or up and down) and meeting the end square to that: a
// circular arc when the two are as far apart across as up and down (Shift keeps them so, at 45°),
// else a quarter ellipse. Either is a polyline, as Vectorworks lists quarter arcs: a circular one
// with an arc vertex, an elliptical one through points on the ellipse. Esc cancels.

import { polylineOutline, type Pt } from "../../core/index.ts";
import { quarterArc } from "../basicShapes.ts";
import { addAndSelect } from "../commands.ts";
import { dist } from "../geom.ts";
import { toast } from "../toast.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";

/** a press dragged further than this (CSS px) is a drag; the pointer this far off the start sets the way the arc leaves */
const CLICK_PX = 4;

export class QuarterArcTool extends BaseTool {
  readonly id = "quarterarc";
  readonly cursor = "crosshair";
  private start: Pt | null = null;
  private pressScreen: Pt | null = null;
  private startScreen: Pt | null = null;
  /** the way the pointer first moved off the start: across, or up and down; null until it has */
  private across: boolean | null = null;
  private pointer: Pt | null = null;

  snapFrom(): Pt | null {
    return this.start;
  }

  hint(): string {
    return this.start ? "Click at the arc's end · Shift 45°" : "Click the arc's start";
  }

  down(p: PointerInfo): void {
    if (!this.start) {
      this.start = p.pos;
      this.startScreen = p.screen;
      this.pressScreen = p.screen;
      this.across = null;
      return;
    }
    this.finish(this.at(p));
  }

  move(p: PointerInfo): void {
    this.pointer = this.at(p);
    if (this.start && this.across === null && this.startScreen && dist(p.screen, this.startScreen) > CLICK_PX) {
      this.across = Math.abs(p.screen.x - this.startScreen.x) >= Math.abs(p.screen.y - this.startScreen.y);
    }
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.start && press && dist(p.screen, press) > CLICK_PX) this.finish(this.at(p));
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.start) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const s = this.start;
    const e = this.pointer;
    if (!s || !e) return;
    const arc = quarterArc(s, e, this.across ?? true);
    withPreview(g, () => strokeScreen(g, arc ? polylineOutline(arc.points, arc.vertices, false) : [s, e], false));
  }

  /** The pointer's point; Shift keeps it as far across from the start as up or down. */
  private at(p: PointerInfo): Pt {
    const s = this.start;
    if (!s || !p.shift) return p.pos;
    const dx = p.pos.x - s.x;
    const dy = p.pos.y - s.y;
    const r = (Math.abs(dx) + Math.abs(dy)) / 2;
    return { x: s.x + Math.sign(dx || 1) * r, y: s.y + Math.sign(dy || 1) * r };
  }

  private finish(e: Pt): void {
    const s = this.start;
    const across = this.across ?? true;
    this.reset();
    if (!s) return;
    const arc = quarterArc(s, e, across);
    if (arc) addAndSelect(arc);
    else toast("Click the end off the start both across and up or down: a quarter arc turns 90° between them.", "info");
  }

  private reset(): void {
    this.start = null;
    this.pressScreen = null;
    this.startScreen = null;
    this.across = null;
  }
}
