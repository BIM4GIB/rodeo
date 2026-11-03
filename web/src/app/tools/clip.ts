// Clip tool: drag a rectangle across the selected closed shapes to cut them by
// it, as the Vectorworks Clip tool does. Exclusion cuts away what is inside the
// rectangle, Inclusion keeps only what is inside, Split keeps both, as separate
// objects. Open shapes and shapes the rectangle misses are left as they are.

import type { NewShape, Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { dist, normalizeRect } from "../geom.ts";
import { store } from "../state.ts";
import { closedOutline, differenceOf, intersectionOf, resultShapes } from "../surfaces.ts";
import { toast } from "../toast.ts";
import { BaseTool, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

type ClipMode = "exclusion" | "inclusion" | "split";

const MODES: readonly ClipMode[] = ["exclusion", "inclusion", "split"];
const MODE_NAME: Record<ClipMode, string> = { exclusion: "Exclusion", inclusion: "Inclusion", split: "Split" };
/** pointer travel (CSS px) below which a press is a click, not a rectangle */
const CLICK_PX = 4;

export class ClipTool extends BaseTool {
  readonly id = "clip";
  readonly cursor = "crosshair";

  private mode: ClipMode = "exclusion";
  /** the rectangle's first corner, snapped; null when idle */
  private start: Pt | null = null;
  private startScreen: Pt | null = null;
  private corner: Pt | null = null;

  modes(): ToolModes {
    return {
      options: MODES.map((m, i) => ({ id: m, label: MODE_NAME[m], key: String(i + 1) })),
      active: this.mode,
    };
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m === id);
    if (mode) this.mode = mode;
  }

  hint(): string {
    if (store.selection.size === 0) return "Select closed shapes first · 1–3 mode";
    if (!this.start) return "Drag a rectangle across the shapes · 1–3 mode";
    return "Release to clip";
  }

  down(p: PointerInfo): void {
    if (store.selection.size === 0) return;
    this.start = p.pos;
    this.startScreen = p.screen;
    this.corner = p.pos;
  }

  move(p: PointerInfo): void {
    if (this.start) this.corner = p.pos;
  }

  up(p: PointerInfo): void {
    const start = this.start;
    const startScreen = this.startScreen;
    this.reset();
    if (!start || !startScreen || dist(p.screen, startScreen) <= CLICK_PX) return;
    const r = normalizeRect(start, p.pos);
    if (r.x1 - r.x0 <= 0 || r.y1 - r.y0 <= 0) return;
    this.clip([
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ]);
  }

  /** Cuts every selected closed shape the rectangle overlaps; the pieces stay selected. */
  private clip(rect: Pt[]): void {
    const doc = store.session?.doc;
    if (!doc) return;
    const targets = [...store.selection]
      .map((id) => {
        const obj = doc.object(id);
        const outline = obj?.shape ? closedOutline(obj.shape) : null;
        return outline ? { id, outline } : null;
      })
      .filter((t): t is { id: string; outline: Pt[] } => t !== null);
    if (targets.length === 0) {
      toast("Clip works on closed shapes: polygons, rectangles, circles and closed polylines.", "info");
      return;
    }
    const mode = this.mode;
    const r = attempt(`Clip (${MODE_NAME[mode]})`, (s) =>
      s.batch(() => {
        const kept: string[] = [];
        let cut = false;
        for (const t of targets) {
          if (intersectionOf([t.outline, rect]).length === 0) {
            kept.push(t.id);
            continue;
          }
          cut = true;
          const shapes: NewShape[] = [];
          if (mode !== "inclusion") shapes.push(...resultShapes(differenceOf(t.outline, rect)));
          if (mode !== "exclusion") shapes.push(...resultShapes(intersectionOf([t.outline, rect])));
          if (shapes.length === 0) s.deleteObjects([t.id]);
          else kept.push(...s.replaceObjects([t.id], shapes));
        }
        return { kept, cut };
      }),
    );
    if (!r) return;
    if (!r.value.cut) toast("The rectangle doesn't cross the selected shapes.", "info");
    setSelection(r.value.kept);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (!e.metaKey && !e.ctrlKey && ["1", "2", "3"].includes(e.key)) {
      this.setMode(MODES[Number(e.key) - 1]);
      return true;
    }
    if (e.key !== "Escape" || !this.start) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const a = this.start;
    const b = this.corner;
    if (!a || !b) return;
    const A = g.toScreen(a);
    const B = g.toScreen(b);
    withPreview(g, () => g.ctx.strokeRect(Math.min(A.x, B.x), Math.min(A.y, B.y), Math.abs(B.x - A.x), Math.abs(B.y - A.y)));
  }

  private reset(): void {
    this.start = null;
    this.startScreen = null;
    this.corner = null;
  }
}
