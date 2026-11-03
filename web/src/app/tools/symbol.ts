// Symbol tool: places instances of store.activeSymbol (picked in Navigation >
// Resources). A dashed ghost of the symbol follows the snapped cursor, with its
// insertion point at the cursor. In Click mode each click places one instance on
// the active layer in the active class and selects it; in Click and Rotate mode
// the first click places it and the second sets its rotation (Shift: 15° steps),
// as Vectorworks' Symbol Insertion tool does. The tool stays active for more. Esc
// drops a placement under way, then the chosen symbol.

import type { ObjectInfo, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { dist } from "../geom.ts";
import { symbolGeometry, symbolNameOf } from "../panels/resources.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { rotationAbout } from "./rotate.ts";

/** arm length of the insertion-point cross, CSS px */
const CROSS_PX = 6;
/** Shift turns the symbol in steps of this, radians */
const ANGLE_STEP = Math.PI / 12;

export class SymbolTool extends BaseTool {
  readonly id = "symbol";
  readonly cursor = "crosshair";
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;
  private mode: "click" | "rotate" = "click";
  /** Click and Rotate: the insertion point clicked, waiting for the rotation */
  private placed: Pt | null = null;
  /** the rotation for the pointer, radians counter-clockwise */
  private angle = 0;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the ghost goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
    // the controller refreshes the hint on session, selection and layer changes only,
    // so a symbol picked in Resources while this tool is active updates it here
    store.on("symbol", () => {
      if (store.tool === "symbol" && !this.layerHidden()) store.setHint(this.hint());
    });
  }

  modes(): ToolModes {
    return {
      label: "Placement",
      options: [
        { id: "click", label: "Click", key: "1" },
        { id: "rotate", label: "Click and Rotate", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id !== "click" && id !== "rotate") return;
    this.mode = id;
    this.placed = null;
  }

  /** Create Similar Object: places more of this instance's symbol. */
  takeFrom(obj: ObjectInfo): boolean {
    if (obj.symbol === undefined) return false;
    store.activeSymbol = obj.symbol;
    store.emit("symbol");
    return true;
  }

  hint(): string {
    const doc = store.session?.doc;
    if (!doc || store.activeSymbol === null) {
      return "Pick a symbol in Resources";
    }
    if (this.placed) return "Click to set the rotation · Shift 15° · Esc cancels";
    return `Click to place ${symbolNameOf(doc, store.activeSymbol)} · 1–2 mode · Esc stops placing`;
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
    if (this.placed) this.angle = this.angleTo(p);
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    const index = store.activeSymbol;
    const layerId = store.activeLayerId;
    // without a chosen symbol the click does nothing; the hint says what to pick
    if (index === null || !layerId) return;
    if (this.mode === "rotate" && !this.placed) {
      this.placed = p.pos;
      this.angle = 0;
      return;
    }
    const at = this.placed ?? p.pos;
    // a click's symbol shows the same way up on screen, in a rotated plan too
    const angle = this.placed ? this.angleTo(p) : -this.env.view.rotation;
    this.placed = null;
    const r = attempt("Place symbol", (s) =>
      s.batch(() => {
        const id = s.insertSymbol(layerId, index, at, store.activeClassIndex);
        if (angle !== 0) s.transformObjects([id], rotationAbout(at, angle));
        return id;
      }),
    );
    // the new instance goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  cancel(): void {
    this.placed = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape") return false;
    if (this.placed) {
      this.placed = null;
      return true;
    }
    if (store.activeSymbol === null) return false;
    store.activeSymbol = null;
    store.emit("symbol");
    return true;
  }

  /** The rotation from the placed insertion point to the pointer; Shift keeps it to 15° steps. */
  private angleTo(p: PointerInfo): number {
    const c = this.placed;
    if (!c || dist(c, p.pos) === 0) return this.angle;
    const a = Math.atan2(p.pos.y - c.y, p.pos.x - c.x);
    const level = -this.env.view.rotation;
    return p.shift ? Math.round((a - level) / ANGLE_STEP) * ANGLE_STEP + level : a;
  }

  overlay(p: Painter): void {
    const doc = store.session?.doc;
    const index = store.activeSymbol;
    const at = this.placed ?? this.at;
    if (!doc || index === null || !at || this.layerHidden()) return;
    const { ctx } = p;
    const k = p.scale;
    const origin = p.toScreen(at);
    const path = symbolGeometry(doc, index).path;

    if (this.placed && this.at) {
      // the line the rotation follows
      const to = p.toScreen(this.at);
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    }

    // symbol coordinates (y up) to CSS pixels about the insertion point, turned as it will be
    // (screen y runs down, so the turn is negated); one CSS pixel wide, dashed like other previews
    ctx.save();
    ctx.translate(origin.x, origin.y);
    if (this.placed) ctx.rotate(-this.angle);
    ctx.scale(k, -k);
    ctx.lineWidth = 1 / k;
    ctx.setLineDash([5 / k, 3 / k]);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = ACCENT;
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(origin.x - CROSS_PX, origin.y);
    ctx.lineTo(origin.x + CROSS_PX, origin.y);
    ctx.moveTo(origin.x, origin.y - CROSS_PX);
    ctx.lineTo(origin.x, origin.y + CROSS_PX);
    ctx.stroke();
    ctx.restore();
  }

  /** The controller refuses clicks on a hidden active layer, so no ghost is shown there either. */
  private layerHidden(): boolean {
    const id = store.activeLayerId;
    return id !== null && this.env.scene.layer(id)?.visibility === "hidden";
  }
}
