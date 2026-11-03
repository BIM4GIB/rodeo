// 2D Locus tool: each click places a locus, a reference point that snaps and doesn't print, at the
// snapped cursor on the active layer in the active class, and selects it, as Vectorworks' 2D Locus
// tool does. A cross shows where it will go. The tool stays active for more.

import type { Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** arm length of the cross at the cursor, CSS px (the renderer draws placed loci the same size) */
const CROSS_PX = 6;

export class LocusTool extends BaseTool {
  readonly id = "locus";
  readonly cursor = "crosshair";
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the cross goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  hint(): string {
    return "Click to place a 2D locus";
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const at = p.pos;
    // loci take no attributes, so the drawing attributes and effects other tools apply are left off
    const r = attempt("Add locus", (s) => s.addObject(layerId, { kind: "locus", at }, store.activeClassIndex));
    // the new locus goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  overlay(p: Painter): void {
    if (this.at) paintCross(p, this.at);
  }
}

/** The cross at a locus tool's cursor. */
export function paintCross(p: Painter, at: Pt): void {
  const { ctx } = p;
  const o = p.toScreen(at);
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x - CROSS_PX, o.y);
  ctx.lineTo(o.x + CROSS_PX, o.y);
  ctx.moveTo(o.x, o.y - CROSS_PX);
  ctx.lineTo(o.x, o.y + CROSS_PX);
  ctx.stroke();
  ctx.restore();
}
