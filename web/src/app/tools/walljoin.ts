// Wall Join (Building Shell), with Vectorworks' T, L and X modes: click a wall on the part to keep,
// then the wall to join it to. T Join runs the first wall's end to the second's face, cut along
// it, the second staying as it is; L Join takes an end of each to where their lines cross and
// mitres the corner; X Join, for walls crossing, breaks the first where they cross and runs each
// part to the second's face. Where a wall crosses the other, the part clicked stays and the rest
// goes; otherwise the end nearer the crossing moves. Each join is one undo step. Esc drops the
// first pick. Walls that never meet, or an end another wall meets already, are refused, saying why.

import type { ObjectInfo, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, strokeScreen, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

const WALL = 68;

type JoinMode = "T" | "L" | "X";

const NOT_A_WALL = "Wall Join joins walls: click a wall.";

export class WallJoinTool extends BaseTool {
  readonly id = "walljoin";
  readonly cursor = "crosshair";

  /** the first wall once picked, and where it was clicked; null while choosing one */
  private first: { readonly id: string; readonly at: Pt } | null = null;
  /** the wall under the pointer */
  private hover: string | null = null;
  private mode: JoinMode = "T";

  modes(): ToolModes {
    return {
      options: [
        { id: "T", label: "T Join", key: "1" },
        { id: "L", label: "L Join", key: "2" },
        { id: "X", label: "X Join", key: "3" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id === "T" || id === "L" || id === "X") this.mode = id;
  }

  hint(): string {
    if (!this.first) {
      if (this.mode === "X") return "Click the wall to break where it crosses another · 1–3 mode";
      return this.mode === "T" ? "Click the wall that runs into another, on the part to keep · 1–3 mode" : "Click a wall on the part to keep · 1–3 mode";
    }
    return this.mode === "L" ? "Click the other wall on the part to keep" : this.mode === "X" ? "Click the wall it crosses" : "Click the wall it meets";
  }

  down(p: PointerInfo): void {
    const id = this.wallAt(p.screen);
    if (!id) {
      if (this.anyAt(p.screen)) toast(NOT_A_WALL, "info");
      return;
    }
    if (!this.first || !this.exists(this.first.id)) {
      this.first = { id, at: p.raw };
      return;
    }
    if (id === this.first.id) return;
    const first = this.first;
    const r = attempt("Wall Join", (s) => s.joinWallPair(first.id, id, this.mode, { first: first.at, second: p.raw }));
    if (r) this.first = null;
  }

  move(p: PointerInfo): void {
    this.hover = this.wallAt(p.screen);
  }

  cancel(): void {
    this.first = null;
    this.hover = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || this.first === null) return false;
    this.first = null;
    return true;
  }

  overlay(g: Painter): void {
    const first = this.first && this.exists(this.first.id) ? this.first.id : null;
    for (const id of new Set([first, this.hover])) if (id) this.outline(g, id);
  }

  /** Strokes a wall's plan drawing in the accent, as the tool's picks and hover show. */
  private outline(g: Painter, wallId: string): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    for (const o of this.env.scene.index(layerId).objects) {
      if (o.parentId !== wallId || !o.shape || o.shape.kind === "text") continue;
      strokeScreen(g, o.shape.points, o.shape.closed);
    }
    ctx.restore();
  }

  private exists(id: string): boolean {
    const obj = store.session?.doc.object(id);
    return !!obj && obj.type === WALL && obj.layerId === store.activeLayerId;
  }

  /** The wall of the active layer (or of the group being edited) whose plan drawing is under `screen`. */
  private wallAt(screen: Pt): string | null {
    const hit = this.pickWith(screen, (o) => {
      const unit = this.unit(o);
      return unit !== null && store.session?.doc.object(unit)?.type === WALL;
    });
    return hit ? this.unit(hit) : null;
  }

  /** True when anything that could be picked is under `screen`. */
  private anyAt(screen: Pt): boolean {
    return this.pickWith(screen, (o) => this.unit(o) !== null) !== null;
  }

  private unit(o: ObjectInfo): string | null {
    return isDerivedId(o.id) ? null : this.env.scene.unitOf(o, store.editGroupId);
  }

  private pickWith(screen: Pt, accept: (o: ObjectInfo) => boolean): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], accept);
  }
}
