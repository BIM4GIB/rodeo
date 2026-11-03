// Door and Window tools (Building Shell): set a door or window in a straight wall by copying one the
// drawing has, with its opening. Preferences chooses which (one per size and parameters, and per
// style and thickness of the wall it is set in); a click on a wall of that style and thickness sets
// the copy there, its middle at the point clicked (EditSession.insertInWall). Rodeo can't cut an
// opening, so the wall is redrawn as a copy of the one the door or window is copied from, laid
// along its line; a wall it can't redraw so (another style or thickness, a door in it already,
// sloping, a cleaned-up joint) is refused, saying why. The copy faces as the copied one does in its
// wall, from the wall's start to its end, and keeps its class, parameters and drawing. It is
// selected afterwards (its parameters in Object Info), and the tool stays active for more.

import type { ObjectInfo, Pt, WallInsertKind } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";
import { formatLength } from "../units.ts";

const WALL = 68;

/** A wall's line on the plan, as the tool places along it. */
interface WallLine {
  readonly start: Pt;
  readonly u: Pt;
  readonly length: number;
}

export class WallInsertTool extends BaseTool {
  readonly cursor = "crosshair";
  /** the door or window a new one copies (WallInsertKind.id), once one has been chosen */
  private kind: string | null = null;
  /** the wall under the pointer and the pointer on the plan */
  private hover: { readonly wall: string; readonly at: Pt } | null = null;

  constructor(
    env: ToolEnv,
    readonly id: "door" | "window",
    /** the plug-in it sets: "Door" or "Window" */
    private readonly plugin: string,
  ) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.hover = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const kinds = this.kinds();
    if (!kinds.length) return;
    const v = await toolPrefs(
      `${this.plugin} Preferences`,
      [{ kind: "choice", key: "kind", label: this.plugin, value: this.current()?.id ?? kinds[0].id, options: labelled(kinds) }],
      `A new ${this.noun()} copies one the drawing has set in a wall, with its opening: it goes in walls of that style and thickness.`,
    );
    if (v) this.kind = v.choice("kind");
  }

  /** Create Similar Object: new ones copy one with this one's parameters, for walls of its wall's style and thickness. */
  takeFrom(obj: ObjectInfo): boolean {
    const doc = store.session?.doc;
    if (!doc) return false;
    const params = (id: string): string => JSON.stringify(doc.records(id).find((r) => r.parametric)?.fields.map((f) => f.value) ?? []);
    const wall = obj.parentId ? doc.wall(obj.parentId) : null;
    const own = params(obj.id);
    const kind = this.kinds().find(
      (k) => k.id === obj.id || (wall !== null && k.style === wall.style && k.thickness.toFixed(2) === wall.thickness.toFixed(2) && params(k.id) === own),
    );
    if (kind) this.kind = kind.id;
    return kind !== undefined;
  }

  hint(): string {
    const k = this.current();
    if (!k) return `This drawing has no ${this.noun()} set alone in a straight wall to copy`;
    const wall = this.hover && this.lineOf(this.hover.wall);
    if (this.hover && !wall) return `A ${this.noun()} like this goes in a ${this.wallLabel(k)} wall`;
    return `Click a ${this.wallLabel(k)} wall where the ${this.noun()}'s middle goes · Preferences picks the ${this.noun()}`;
  }

  move(p: PointerInfo): void {
    const wall = this.wallAt(p.screen);
    this.hover = wall ? { wall, at: p.pos } : null;
  }

  down(p: PointerInfo): void {
    const k = this.current();
    if (!k) {
      toast(`This drawing has no ${this.noun()} set alone in a straight wall to copy.`, "info");
      return;
    }
    const wall = this.wallAt(p.screen);
    if (!wall) {
      if (this.pickWith(p.screen, (o) => this.unit(o) !== null)) toast(`The ${this.plugin} tool sets a ${this.noun()} in a wall: click a wall.`, "info");
      return;
    }
    const r = attempt(`Insert ${this.plugin}`, (s) => s.insertInWall(k.id, wall, p.pos));
    if (r) setSelection([r.value.insert]);
  }

  cancel(): void {
    this.hover = null;
  }

  overlay(g: Painter): void {
    const k = this.current();
    const hover = this.hover;
    if (!k || !hover) return;
    const line = this.lineOf(hover.wall);
    this.outline(g, hover.wall, line ? 0.5 : 0.2);
    if (!line) return;
    // the copy's drawing box, its middle where the pointer lies along the wall
    const t = (hover.at.x - line.start.x) * line.u.x + (hover.at.y - line.start.y) * line.u.y;
    const n = { x: -line.u.y, y: line.u.x };
    const outline = k.outline.map((q) => ({
      x: line.start.x + line.u.x * (t + q.x) + n.x * q.y,
      y: line.start.y + line.u.y * (t + q.x) + n.y * q.y,
    }));
    withPreview(g, () => strokeScreen(g, outline, true));
  }

  private noun(): string {
    return this.plugin.toLowerCase();
  }

  private wallLabel(k: WallInsertKind): string {
    return `${k.style ?? "unstyled"} ${formatLength(k.thickness, store.session?.doc.info.units)}`;
  }

  /** The doors or windows a new one can copy. */
  private kinds(): WallInsertKind[] {
    return (store.session?.wallInsertKinds() ?? []).filter((k) => k.name === this.plugin);
  }

  /** The kind a new one copies: the one chosen, while the drawing still has it, else the first. */
  private current(): WallInsertKind | null {
    const kinds = this.kinds();
    return kinds.find((k) => k.id === this.kind) ?? kinds[0] ?? null;
  }

  /** The line of `wallId` when it is a straight wall of the chosen kind's style and thickness, else null. */
  private lineOf(wallId: string): WallLine | null {
    const k = this.current();
    const w = store.session?.doc.wall(wallId);
    if (!k || !w || w.style !== k.style || Math.abs(w.thickness - k.thickness) > 1e-6) return null;
    const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (!(length > 0)) return null;
    return { start: w.start, u: { x: (w.end.x - w.start.x) / length, y: (w.end.y - w.start.y) / length }, length };
  }

  /** Strokes a wall's plan drawing in the accent, as the tool's hover shows it. */
  private outline(g: Painter, wallId: string, alpha: number): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha;
    for (const o of this.env.scene.index(layerId).objects) {
      if (o.parentId !== wallId || !o.shape || o.shape.kind === "text") continue;
      strokeScreen(g, o.shape.points, o.shape.closed);
    }
    ctx.restore();
  }

  /** The wall of the active layer (or of the group being edited) whose plan drawing is under `screen`. */
  private wallAt(screen: Pt): string | null {
    const hit = this.pickWith(screen, (o) => {
      const unit = this.unit(o);
      return unit !== null && store.session?.doc.object(unit)?.type === WALL;
    });
    return hit ? this.unit(hit) : null;
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

/** Choices for Preferences: each kind's width and the wall it goes in, told apart by number when alike. */
function labelled(kinds: readonly WallInsertKind[]): { value: string; label: string }[] {
  const units = store.session?.doc.info.units;
  const seen = new Map<string, number>();
  return kinds.map((k) => {
    const base = `${formatLength(k.width, units)} wide · in ${k.style ?? "unstyled"} ${formatLength(k.thickness, units)} walls (${k.count})`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { value: k.id, label: n > 1 ? `${base} #${n}` : base };
  });
}
