// Zoom tool: in its Zoom In mode (1) a click zooms in two times about the click and
// a dragged box fits the window to it; in Zoom Out (2) a click zooms out two times
// and the whole window shrinks into the dragged box. Option (Alt) does the other
// mode's click. The point under the cursor stays put on a click zoom. Zooming
// changes only the view, never the drawing, and the tool stays active afterwards.

import type { BBox, Pt } from "../../core/index.ts";
import { dist, normalizeRect } from "../geom.ts";
import { glide } from "../glide.ts";
import type { View } from "../view.ts";
import { ALT_KEY, BaseTool, modeForKey, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

/** pointer travel (CSS px) that counts as a drag rather than a click */
const CLICK_PX = 4;
/** scale change per click */
const CLICK_ZOOM = 2;
/** share of the window left empty around a fitted box */
const FIT_MARGIN = 0.05;

/** The world bounds of the box dragged between two screen points. */
export function boxToWorld(view: View, a: Pt, b: Pt): BBox {
  return normalizeRect(view.toWorld(a.x, a.y), view.toWorld(b.x, b.y));
}

export class ZoomTool extends BaseTool {
  readonly id = "zoom";
  /** the press that began the gesture in progress; null when idle */
  private press: PointerInfo | null = null;
  /** latest pointer position (CSS px) while the button is held */
  private current: Pt | null = null;
  private mode: "in" | "out" = "in";

  get cursor(): string {
    return this.mode === "in" ? "zoom-in" : "zoom-out";
  }

  modes(): ToolModes {
    return {
      options: [
        { id: "in", label: "Zoom In", key: "1" },
        { id: "out", label: "Zoom Out", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id === "in" || id === "out") this.mode = id;
  }

  hint(): string {
    if (this.press) return this.mode === "in" ? "Release to zoom to the box" : "Release to shrink the window into the box";
    return this.mode === "in"
      ? `Click to zoom in or drag a box · ${ALT_KEY} zooms out · 1–2 mode`
      : `Click to zoom out or drag a box · ${ALT_KEY} zooms in · 1–2 mode`;
  }

  down(p: PointerInfo): void {
    this.press = p;
    this.current = p.screen;
  }

  move(p: PointerInfo): void {
    if (this.press) this.current = p.screen;
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.reset();
    if (!press) return;
    const view = this.env.view;
    const zoomIn = (this.mode === "in") !== press.alt;
    glide(view, () => {
      if (dist(p.screen, press.screen) <= CLICK_PX) {
        view.zoomAt(press.screen.x, press.screen.y, zoomIn ? CLICK_ZOOM : 1 / CLICK_ZOOM);
      } else if (view.rotation !== 0) {
        // the box lies along the screen, so it is a turned box in the drawing: it zooms by its size on screen
        const wide = view.width / Math.max(Math.abs(p.screen.x - press.screen.x), 1);
        const tall = view.height / Math.max(Math.abs(p.screen.y - press.screen.y), 1);
        const k = this.mode === "in" ? Math.min(wide, tall) * (1 - 2 * FIT_MARGIN) : 1 / Math.max(wide, tall);
        const mid = view.toWorld((p.screen.x + press.screen.x) / 2, (p.screen.y + press.screen.y) / 2);
        view.setCenterAndScale(mid.x, mid.y, view.scale * k);
      } else if (this.mode === "in") {
        view.fit(boxToWorld(view, press.screen, p.screen), FIT_MARGIN);
      } else {
        // the whole window comes to fill the box: a box a quarter of the window zooms out four times
        const box = boxToWorld(view, press.screen, p.screen);
        const seen = view.visibleRect();
        const k = Math.max((seen.x1 - seen.x0) / Math.max(box.x1 - box.x0, 1e-9), (seen.y1 - seen.y0) / Math.max(box.y1 - box.y0, 1e-9));
        const cx = (box.x0 + box.x1) / 2;
        const cy = (box.y0 + box.y1) / 2;
        const w = ((seen.x1 - seen.x0) * k) / 2;
        const h = ((seen.y1 - seen.y0) * k) / 2;
        view.fit({ x0: cx - w, y0: cy - h, x1: cx + w, y1: cy + h }, 0);
      }
    });
    this.env.requestDraw();
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.press) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const press = this.press;
    const current = this.current;
    if (!press || !current || dist(press.screen, current) <= CLICK_PX) return;
    const a = press.screen;
    const b = current;
    withPreview(g, () =>
      g.ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)),
    );
  }

  private reset(): void {
    this.press = null;
    this.current = null;
  }
}
