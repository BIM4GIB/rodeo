// The Snap Loupe, as Vectorworks keeps it: Z over the drawing opens a magnified window at the
// pointer, where snap points too close together to pick at this zoom come apart; Z again magnifies
// further. While the pointer is in the window the tools get the point under it there, snapped as
// finely as the window shows it (ToolController); a click there acts on it and closes the window,
// Escape or a click outside closes it without acting.

import "./loupe.css";
import type { Pt } from "../core/index.ts";
import { h } from "./dom.ts";
import { Renderer } from "./renderer.ts";
import type { Scene } from "./scene.ts";
import type { ToolOverlay } from "./tools.ts";
import { View } from "./view.ts";

/** the window's radius, CSS px */
const RADIUS = 90;
/** how much it magnifies when it opens, and the most Z again takes it to */
const FIRST = 4;
const MOST = 64;

export class SnapLoupe {
  /** what the window shows: the drawing magnified about where it opened, at the window's own size */
  readonly view = new View();
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly badge: HTMLSpanElement;
  private readonly renderer: Renderer;
  /** where it opened, on the drawing's canvas (CSS px); null while closed */
  private at: Pt | null = null;
  private factor = FIRST;
  private frame = 0;

  constructor(
    private readonly main: HTMLCanvasElement,
    private readonly mainView: View,
    scene: Scene,
    overlay: ToolOverlay,
  ) {
    this.canvas = h("canvas", { cls: "snap-loupe-canvas" });
    this.badge = h("span", { cls: "snap-loupe-badge" });
    this.el = h("div", { cls: "snap-loupe", attrs: { "aria-hidden": "true" }, hidden: true }, this.canvas, this.badge);
    this.el.style.width = this.el.style.height = `${2 * RADIUS}px`;
    this.renderer = new Renderer(this.canvas, this.view, scene, overlay);
  }

  get isOpen(): boolean {
    return this.at !== null;
  }

  /** Opens the window at `at` on the drawing's canvas, or magnifies it further when it is open there already. */
  open(at: Pt): void {
    if (this.at) {
      this.factor = Math.min(MOST, this.factor * 2);
    } else {
      this.at = at;
      this.factor = FIRST;
      // over the drawing's canvas, where it is in the panes
      this.main.parentElement?.append(this.el);
      this.el.style.left = `${this.main.offsetLeft + at.x - RADIUS}px`;
      this.el.style.top = `${this.main.offsetTop + at.y - RADIUS}px`;
      this.el.hidden = false;
    }
    const centre = this.mainView.toWorld(this.at.x, this.at.y);
    this.view.setSize(2 * RADIUS, 2 * RADIUS);
    this.view.setCenterAndScale(centre.x, centre.y, this.mainView.scale * this.factor);
    this.badge.textContent = `${this.factor}×`;
    this.requestDraw();
  }

  close(): void {
    if (!this.at) return;
    this.at = null;
    this.el.hidden = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Whether `screen` (on the drawing's canvas, CSS px) is inside the open window. */
  contains(screen: Pt): boolean {
    return this.at !== null && Math.hypot(screen.x - this.at.x, screen.y - this.at.y) <= RADIUS;
  }

  /** The window's own position for `screen` on the drawing's canvas, for its view. */
  local(screen: Pt): Pt {
    const at = this.at ?? screen;
    return { x: screen.x - at.x + RADIUS, y: screen.y - at.y + RADIUS };
  }

  /** Draws the window again on the next frame (the pointer moved, the drawing changed). */
  requestDraw(): void {
    if (!this.at || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.at) this.renderer.renderNow(2 * RADIUS, 2 * RADIUS, window.devicePixelRatio || 1);
    });
  }
}
