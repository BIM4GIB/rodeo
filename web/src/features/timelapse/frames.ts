// Draws one timelapse frame: the drawing at a Shown state, through the editor's own Renderer and
// Scene, onto a canvas of its own. The renderer reads the editor's store (the active layer, the
// selection, the grid, the display modes), so each draw sets what the frame needs inside one
// synchronous block and puts the editor's values back before anything else runs. Nothing is
// awaited inside that block, so the editor's own frames never see the timelapse's settings.

import { Renderer } from "../../app/renderer.ts";
import { Scene } from "../../app/scene.ts";
import { store, type DisplayMode } from "../../app/state.ts";
import type { ToolOverlay } from "../../app/tools.ts";
import { View } from "../../app/view.ts";
import type { BBox } from "../../core/index.ts";
import type { Shown } from "./timeline.ts";

/** One layer ("design" or "sheet" by id), or "visible": every visible design layer. */
export type LayerChoice = "visible" | string;

/** The editor's view, as the export maps it: its centre, its scale and its width in CSS px. */
export interface ViewState {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  readonly cssWidth: number;
}

/** How the drawing is placed in the frame: fitted to a box, or at the editor's view. */
export interface Plan {
  readonly layer: LayerChoice;
  readonly fitBox: BBox | null;
  readonly current: ViewState | null;
}

/** The frame's size, paper and what it says. */
export interface Look {
  readonly width: number;
  readonly height: number;
  readonly dark: boolean;
  readonly date: boolean;
  readonly watermark: boolean;
}

const NO_TOOLS: ToolOverlay = { moveDelta: () => null, fillPreview: () => null, drawOverlay: () => {} };
const NONE: ReadonlySet<string> = new Set<string>();
const NOOP = (): void => {};
/** View > Dark Canvas: the drawing's ink and paper swap, as the editor's canvas does it */
const INVERT = "invert(1) hue-rotate(180deg)";
const FONT = `Arial, "Helvetica Neue", Helvetica, sans-serif`;
/** frames wait this long (in tries of 25 ms) for images to decode, then go on without them */
const IMAGE_TRIES = 8;

/** whether canvas filters work here (Safari older than 18 ignores them) */
const FILTERS = (() => {
  try {
    const c = document.createElement("canvas").getContext("2d");
    if (!c || !("filter" in c)) return false;
    c.filter = "invert(1)";
    return c.filter === "invert(1)";
  } catch {
    return false;
  }
})();

/** the layers a frame draws, and the display mode that draws them (what the editor's layer options set) */
export function layerState(scene: Scene, choice: LayerChoice): { active: string | null; mode: DisplayMode } {
  if (choice !== "visible") return { active: scene.layer(choice) ? choice : null, mode: "active-only" };
  const design = scene.layers().filter((l) => l.kind === "design");
  const first = design.find((l) => l.visibility === "visible") ?? design.find((l) => l.visibility === "grayed");
  return { active: first?.id ?? null, mode: "show-others" };
}

function caption(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export class FrameRenderer {
  private readonly canvas = document.createElement("canvas");
  private readonly scene = new Scene();
  private readonly view = new View();
  private readonly renderer = new Renderer(this.canvas, this.view, this.scene, NO_TOOLS);
  /** the document and state the scene holds now */
  private sceneDoc: Shown["doc"] | null = null;
  private sceneKey = -1;
  /** the last frame drawn, and the settings it was drawn with */
  private drawn: { out: HTMLCanvasElement; doc: Shown["doc"]; key: number; sig: string } | null = null;
  /** images that did not decode in time: frames go on without them */
  private readonly giveUp = new Set<string>();

  /** The drawing's extent in the layers a plan shows (for fitting), at a state. */
  extent(shown: Shown, layer: LayerChoice): BBox | null {
    this.adopt(shown);
    const s = store;
    const saved = { activeLayerId: s.activeLayerId, layerMode: s.layerMode, classMode: s.classMode };
    try {
      const { active, mode } = layerState(this.scene, layer);
      s.activeLayerId = active;
      s.layerMode = mode;
      s.classMode = "show-others";
      return this.scene.drawnBounds(active);
    } finally {
      Object.assign(s, saved);
    }
  }

  /**
   * Draws `shown` onto `out`, sized to the look, unless `out` already shows it. Resolves once the
   * images in the frame have decoded (or after a short wait for those that will not).
   */
  async show(shown: Shown, plan: Plan, look: Look, out: HTMLCanvasElement): Promise<void> {
    this.adopt(shown);
    const text = look.date && shown.time !== null ? caption(shown.time) : null;
    const sig = JSON.stringify([plan, look, text]);
    const d = this.drawn;
    if (d && d.out === out && d.doc === shown.doc && d.key === shown.key && d.sig === sig) return;
    let pending = this.paint(plan, look, out, text);
    for (let tries = 0; pending.length > 0 && tries < IMAGE_TRIES; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      pending = this.paint(plan, look, out, text);
    }
    for (const id of pending) this.giveUp.add(id);
    this.drawn = { out, doc: shown.doc, key: shown.key, sig };
  }

  /**
   * Makes the scene hold the state `shown` is: a new document, or the changes since the state the
   * scene holds (frames the caller skipped are included).
   */
  private adopt(shown: Shown): void {
    if (shown.doc !== this.sceneDoc) {
      this.sceneDoc = shown.doc;
      this.scene.setDocument(shown.doc);
    } else if (shown.key !== this.sceneKey) {
      const change = shown.changesSince(this.sceneKey);
      if (change) this.scene.invalidate(change);
    }
    this.sceneKey = shown.key;
  }

  /** Draws the frame; returns the ids of images still waiting to decode. */
  private paint(plan: Plan, look: Look, out: HTMLCanvasElement, text: string | null): string[] {
    const { width: W, height: H } = look;
    const s = store;
    const saved = { activeLayerId: s.activeLayerId, layerMode: s.layerMode, classMode: s.classMode, selection: s.selection, editGroupId: s.editGroupId, editVertex: s.editVertex, showGrid: s.showGrid };
    let pending: string[] = [];
    try {
      const { active, mode } = layerState(this.scene, plan.layer);
      s.activeLayerId = active;
      s.layerMode = mode;
      s.classMode = "show-others";
      s.selection = NONE;
      s.editGroupId = null;
      s.editVertex = null;
      s.showGrid = false;
      if (plan.current) {
        this.view.setSize(W, H);
        this.view.setCenterAndScale(plan.current.cx, plan.current.cy, (plan.current.scale * W) / plan.current.cssWidth);
      } else if (plan.fitBox) {
        this.view.setSize(W, H);
        this.view.fit(plan.fitBox, 0.08);
      } else {
        this.view.setSize(W, H);
        this.view.setCenterAndScale(0, 0, 1);
      }
      this.renderer.renderNow(W, H, 1);
      pending = this.pendingImages(active);
    } finally {
      Object.assign(s, saved);
    }
    this.copy(out, W, H, look.dark, text, look.watermark);
    return pending;
  }

  /** Images in the frame's layers that are not decoded yet (and not given up on). */
  private pendingImages(active: string | null): string[] {
    const pending: string[] = [];
    for (const layer of this.scene.drawnLayers(active)) {
      for (const obj of this.scene.index(layer.id).objects) {
        const shape = obj.shape;
        if (shape?.kind !== "image" || !shape.image || !shape.imageMime || this.giveUp.has(obj.id)) continue;
        if (!this.scene.bitmap(obj, shape, NOOP)) pending.push(obj.id);
      }
    }
    return pending;
  }

  /** Copies the frame to `out`, swapping ink and paper for a dark paper, then writes its captions. */
  private copy(out: HTMLCanvasElement, W: number, H: number, dark: boolean, text: string | null, watermark: boolean): void {
    if (out.width !== W) out.width = W;
    if (out.height !== H) out.height = H;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("openvwx: 2D canvas is not available");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = dark && FILTERS ? INVERT : "none";
    ctx.drawImage(this.canvas, 0, 0, W, H);
    ctx.restore();
    if (dark && !FILTERS) invertPixels(ctx, W, H);
    if (!text && !watermark) return;
    const size = Math.max(10, Math.round(H * 0.026));
    const pad = Math.round(H * 0.03);
    ctx.save();
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = dark ? "rgba(255, 255, 255, 0.72)" : "rgba(0, 0, 0, 0.55)";
    ctx.textBaseline = "alphabetic";
    if (text) {
      ctx.textAlign = "left";
      ctx.fillText(text, pad, H - pad);
    }
    if (watermark) {
      ctx.textAlign = "right";
      ctx.fillText("Made with Rodeo", W - pad, H - pad);
    }
    ctx.restore();
  }
}

/**
 * Invert with hue kept, as invert(1) hue-rotate(180deg) does, for canvases without filters: the
 * CSS colour matrix of hue-rotate(180deg) applied to the inverted colour.
 */
function invertPixels(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    d[i] = 255 - (-0.574 * r + 1.43 * g + 0.144 * b);
    d[i + 1] = 255 - (0.426 * r + 0.43 * g + 0.144 * b);
    d[i + 2] = 255 - (0.426 * r + 1.43 * g - 0.856 * b);
  }
  ctx.putImageData(img, 0, 0);
}
