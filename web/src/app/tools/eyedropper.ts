// Eyedropper tool: picks up attributes from one object and applies them to
// others (Vectorworks' Eyedropper). A click picks up the pen and fill colours,
// fill style, opacities, line weight and line style, and the class of the object
// under the cursor (its leaf object, not its group). Option (Alt) click applies
// the pick to the object clicked, or to the selection when the click is on a
// selected object; Shift+Option also applies the class. Cmd (Ctrl) click picks up
// and also makes the attributes those of new objects. A plain click on empty space
// clears the pick, and so does Esc. In the Put Down mode (2; Pick Up is 1) a plain
// click applies and Option picks up, once something is picked up.

import type { Attributes, ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { clamp } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId, type Scene } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { ALT_KEY, BaseTool, MOD_KEY, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

/** Attributes.lineWeight is in mils (1/1000 inch) */
const MM_PER_MIL = 0.0254;
/** the swatch pill sits this far from the pointer, CSS px */
const CURSOR_GAP_PX = 16;
/** the swatch pill keeps this far from the canvas edges, CSS px */
const EDGE_PX = 4;
const PILL_H = 22;
const PILL_PAD = 8;
const CHIP_GAP = 12;
const SWATCH_PX = 11;
const PILL_FONT = `11px "Helvetica Neue", Arial, system-ui, sans-serif`;
const INK = "#1d1d1f";
const RULE = "#8e8e93";

/** What a pick-up keeps: the attributes and the class of one object. */
interface Picked {
  readonly attrs: Attributes;
  readonly classIndex: number;
  readonly className: string;
}

/** Layers a click picks from: the active layer inside a group being edited, else every pickable layer. */
function pickLayers(scene: Scene): string[] {
  const active = store.activeLayerId;
  if (!active) return [];
  return store.editGroupId ? [active] : scene.pickableLayers(active);
}

export class EyedropperTool extends BaseTool {
  readonly id = "eyedropper";
  readonly cursor = "crosshair";

  /** attributes and class picked up, or null when nothing is picked */
  private picked: Picked | null = null;
  /** last pointer position in CSS px; the swatch pill follows it */
  private pointer: Pt | null = null;
  /** Pick Up: a click picks up, Option applies; Put Down: the other way round */
  private mode: "pick" | "put" = "pick";

  modes(): ToolModes {
    return {
      options: [
        { id: "pick", label: "Pick Up", key: "1" },
        { id: "put", label: "Put Down", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id === "pick" || id === "put") this.mode = id;
  }

  hint(): string {
    const defaults = `${MOD_KEY} set defaults`;
    if (!this.picked) return `Click an object to pick up attributes · ${defaults} · 1–2 mode`;
    const from = this.picked.className ? `Picked up from class "${this.picked.className}"` : "Picked up";
    if (this.mode === "put") return `${from} · Click to apply · Shift with class · ${ALT_KEY} pick up · Esc clears`;
    return `${from} · ${ALT_KEY} apply · Shift+${ALT_KEY} with class · ${defaults} · Esc clears`;
  }

  down(p: PointerInfo): void {
    this.pointer = p.screen;
    const { scene, view } = this.env;
    if (!scene.document) return;
    const hit = pickObject(scene, view, p.screen, pickLayers(scene));
    // nothing picked up yet: the first click picks up in either mode
    const applying = this.picked !== null && (this.mode === "put") !== p.alt;
    if (applying) {
      this.apply(hit, p.shift);
      return;
    }
    if (!hit) {
      if (!p.mod) this.picked = null;
      return;
    }
    const picked = this.pickUp(hit);
    if (picked && p.mod) {
      store.drawAttrs = { ...picked.attrs };
      store.emit("attrs");
    }
  }

  move(p: PointerInfo): void {
    this.pointer = p.screen;
  }

  cancel(): void {
    this.picked = null;
    this.pointer = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.picked) return false;
    this.picked = null;
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!this.picked || !p) return;
    this.drawSwatch(g, p, this.picked.attrs);
  }

  /** Remembers the attributes and class of `obj`; null when it has no attributes to take. */
  private pickUp(obj: ObjectInfo): Picked | null {
    if (!obj.attrs) {
      toast("That object has no attributes to pick up.", "info");
      return null;
    }
    this.picked = { attrs: { ...obj.attrs }, classIndex: obj.classIndex, className: obj.className };
    return this.picked;
  }

  /** Applies the pick to the clicked object, or to the selection when the click is on it. */
  private apply(hit: ObjectInfo | null, withClass: boolean): void {
    const picked = this.picked;
    if (!picked) {
      toast("Click an object first to pick up its attributes.", "info");
      return;
    }
    if (!hit) {
      toast("Option-click an object to apply the picked attributes.", "info");
      return;
    }
    if (isDerivedId(hit.id)) {
      toast("Symbol contents can't be changed with the eyedropper.", "info");
      return;
    }
    const ids = this.targets(hit);
    attempt(withClass ? "Apply attributes and class" : "Apply attributes", (s) => {
      s.setAttributes(ids, picked.attrs);
      if (withClass) s.setObjectClass(ids, picked.classIndex);
    });
  }

  /**
   * The clicked object, or every drawable object of the selection when the click
   * is on a selected object (or inside a selected group). Group records carry no
   * attributes of their own, so the objects inside them are the ones written.
   */
  private targets(hit: ObjectInfo): string[] {
    const { scene } = this.env;
    if (!scene.within(hit, store.selection)) return [hit.id];
    return scene.expand(store.selection).map((s) => s.obj.id).filter((id) => !isDerivedId(id));
  }

  /** Pill beside the pointer: pen and fill colour swatches, then the line weight. */
  private drawSwatch(g: Painter, at: Pt, attrs: Attributes): void {
    const { ctx } = g;
    const { scene } = this.env;
    const pen = scene.color(attrs.penFore);
    const fill = attrs.fillPattern === 0 ? null : scene.color(attrs.fillBack);
    const weight = attrs.lineWeight === 0 ? "Hairline" : `${(attrs.lineWeight * MM_PER_MIL).toFixed(2)} mm`;
    ctx.save();
    ctx.font = PILL_FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const chipW = (label: string): number => SWATCH_PX + 4 + ctx.measureText(label).width;
    const w = PILL_PAD * 2 + chipW("Pen") + CHIP_GAP + chipW("Fill") + CHIP_GAP + ctx.measureText(weight).width;
    const x = clamp(at.x + CURSOR_GAP_PX, EDGE_PX, g.width - w - EDGE_PX);
    const y = clamp(at.y + CURSOR_GAP_PX, EDGE_PX, g.height - PILL_H - EDGE_PX);
    ctx.beginPath();
    ctx.roundRect(x, y, w, PILL_H, PILL_H / 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    const mid = y + PILL_H / 2;
    let cx = x + PILL_PAD;
    cx = swatchChip(ctx, cx, mid, pen, "Pen") + CHIP_GAP;
    cx = swatchChip(ctx, cx, mid, fill, "Fill") + CHIP_GAP;
    ctx.fillStyle = INK;
    ctx.fillText(weight, cx, mid);
    ctx.restore();
  }
}

/** A colour swatch (hollow with a slash when null) then its label; returns the x after the label. */
function swatchChip(ctx: CanvasRenderingContext2D, x: number, mid: number, colour: string | null, label: string): number {
  const top = mid - SWATCH_PX / 2;
  ctx.fillStyle = colour ?? "#ffffff";
  ctx.fillRect(x, top, SWATCH_PX, SWATCH_PX);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, top + 0.5, SWATCH_PX - 1, SWATCH_PX - 1);
  if (colour === null) {
    ctx.beginPath();
    ctx.moveTo(x, top + SWATCH_PX);
    ctx.lineTo(x + SWATCH_PX, top);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  const textX = x + SWATCH_PX + 4;
  ctx.fillText(label, textX, mid);
  return textX + ctx.measureText(label).width;
}
