// Visualization's Render Bitmap tool (renderBitmap.ts does the drawing): drag a marquee round the area
// to render, in Top/Plan or over the 3D view; a click without dragging takes the whole window. Its
// Preferences are the Render Bitmap Options. Over the 3D view the tool lays a pane on it that takes
// the drag, so the view doesn't turn; Esc gives up a drag.

import type { Pt } from "../../core/index.ts";
import { h } from "../dom.ts";
import { ACCENT } from "../renderer.ts";
import { renderBitmapOptions, renderPlanArea, renderViewArea } from "../renderBitmap.ts";
import { store } from "../state.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** a press moved less than this, CSS pixels, is a click */
const CLICK_PX = 4;

export class RenderBitmapTool extends BaseTool {
  readonly id = "renderbitmap";
  readonly cursor = "crosshair";

  private start: { pos: Pt; screen: Pt } | null = null;
  private live: Pt | null = null;
  private pane: HTMLElement | null = null;

  constructor(env: ToolEnv) {
    super(env);
    store.on(["tool", "view3d"], () => this.coverView());
  }

  hint(): string {
    return this.start ? "Release to render the area · Esc cancels" : "Drag round the area to render as a bitmap, or click for the whole window · Preferences sets the mode and resolution";
  }

  preferences(): Promise<void> {
    return renderBitmapOptions();
  }

  down(p: PointerInfo): void {
    this.start = { pos: p.pos, screen: p.screen };
    this.live = p.pos;
  }

  move(p: PointerInfo): void {
    if (this.start) this.live = p.pos;
  }

  up(p: PointerInfo): void {
    const start = this.start;
    this.cancel();
    if (!start) return;
    const dragged = Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) > CLICK_PX;
    const view = this.env.view;
    const area = dragged ? { x0: start.pos.x, y0: start.pos.y, x1: p.pos.x, y1: p.pos.y } : (() => {
      const a = view.toWorld(0, view.height);
      const b = view.toWorld(view.width, 0);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    })();
    void renderPlanArea(area);
  }

  cancel(): void {
    this.start = null;
    this.live = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.start) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    if (!this.start || !this.live) return;
    const a = g.toScreen(this.start.pos);
    const b = g.toScreen(this.live);
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }

  /** While the tool is in use over the 3D view, a pane on the view takes its drags. */
  private coverView(): void {
    const want = store.tool === this.id && store.view3d;
    if (!want) {
      this.pane?.remove();
      this.pane = null;
      return;
    }
    const host = document.getElementById("view3d-host");
    if (!host || (this.pane && this.pane.parentElement === host)) return;
    const box = h("div", { cls: "render-bitmap-marquee", attrs: { style: `position:absolute;border:1px dashed ${ACCENT};pointer-events:none;display:none` } });
    const pane = h("div", { cls: "render-bitmap-pane", attrs: { style: "position:absolute;inset:0;cursor:crosshair;z-index:5;touch-action:none", "aria-label": "Render Bitmap area" } }, box);
    let from: Pt | null = null;
    const at = (e: PointerEvent): Pt => {
      const r = pane.getBoundingClientRect();
      return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
    };
    const show = (a: Pt, b: Pt): void => {
      box.style.display = "block";
      box.style.left = `${Math.min(a.x, b.x)}px`;
      box.style.top = `${Math.min(a.y, b.y)}px`;
      box.style.width = `${Math.abs(b.x - a.x)}px`;
      box.style.height = `${Math.abs(b.y - a.y)}px`;
    };
    pane.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pane.setPointerCapture(e.pointerId);
      from = at(e);
      show(from, from);
    });
    pane.addEventListener("pointermove", (e) => {
      if (from) show(from, at(e));
    });
    pane.addEventListener("pointerup", (e) => {
      if (!from) return;
      const a = from;
      const b = at(e);
      from = null;
      box.style.display = "none";
      const r = pane.getBoundingClientRect();
      const whole = Math.hypot(b.x - a.x, b.y - a.y) <= CLICK_PX;
      const area = whole ? { left: 0, top: 0, right: r.width, bottom: r.height } : { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
      void renderViewArea(area, r.width, r.height);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && from) {
        from = null;
        box.style.display = "none";
      }
    });
    host.append(pane);
    this.pane = pane;
  }
}
