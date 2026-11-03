// Wall tool (Building Shell): click the start, then each corner; every click past the first places
// a straight wall from the corner before, as Vectorworks' Wall tool does, mitred to meet the wall
// before it. Clicking the run's start again closes it, mitring that corner too, and ends it;
// double-click, Enter or Esc ends it anywhere. A click on the end of a wall already drawn starts or
// ends the run there, the two mitred at the corner; one on a wall's side starts or ends it at that
// wall's face (a tee). A run ends at a wall it joins. Shift constrains each wall to 15-degree steps. A new
// wall is a copy of a straight wall the drawing has, square-ended with nothing set in it, stretched
// along the new line: its style, thickness, heights and components are that wall's (Preferences
// chooses which, one per style). It goes on the active layer in the active class, each wall one
// undo step, and the last placed is selected.

import type { ObjectInfo, Pt, WallJoin, WallTemplate } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";
import { formatLength } from "../units.ts";

/** a click this close (CSS px) to a run's start closes it */
const CLOSE_PX = 6;

export class WallTool extends BaseTool {
  readonly id = "wall";
  readonly cursor = "crosshair";
  /** the wall a new one copies (WallTemplate.id), once one has been chosen */
  private template: string | null = null;
  /** that wall's style and size, as last seen */
  private chosen: WallTemplate | null = null;
  /** the corners clicked in this run, in document units */
  private points: Pt[] = [];
  /** the walls this run has placed, in order: the next one joins the last, a closing one the first too */
  private walls: string[] = [];
  /** a wall already drawn that the run's start is on, which its first wall joins */
  private startJoin: string | null = null;
  /** last pointer event; the preview follows it */
  private pointer: PointerInfo | null = null;

  async preferences(): Promise<void> {
    const kinds = store.session?.wallTemplates() ?? [];
    if (!kinds.length) return;
    const units = store.session?.doc.info.units;
    const v = await toolPrefs(
      "Wall Preferences",
      [{ kind: "choice", key: "style", label: "Style", value: this.current()?.id ?? kinds[0].id, options: kinds.map((k) => ({ value: k.id, label: wallLabel(k, units) })) }],
      "A new wall copies one the drawing has in that style, stretched to the length drawn: straight, square-ended, with no doors or windows in it.",
    );
    if (v) this.template = v.choice("style");
  }

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  /** Create Similar Object: new walls copy one of this wall's style, thickness and height. */
  takeFrom(obj: ObjectInfo): boolean {
    const w = store.session?.doc.wall(obj.id);
    if (!w) return false;
    const height = (w.top - w.bottom).toFixed(2);
    const kind = (store.session?.wallTemplates() ?? []).find(
      (k) => k.id === obj.id || (k.style === w.style && k.thickness.toFixed(2) === w.thickness.toFixed(2) && k.height.toFixed(2) === height),
    );
    if (kind) this.template = kind.id;
    return kind !== undefined;
  }

  hint(): string {
    const k = this.current();
    if (!k) return "This drawing has no straight, square-ended wall to copy";
    const what = wallLabel(k, store.session?.doc.info.units);
    return this.points.length === 0
      ? `Click the wall's start, or a wall's end or side to join it · ${what}`
      : `Click the next corner, or a wall to join · the start closes · double-click, Enter or Esc ends · Shift ${ANGLE_STEP_DEG}°`;
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    const k = this.current();
    const layerId = store.activeLayerId;
    if (!k || !layerId) return;
    let at = this.cursorPoint(p);
    const last = this.points.at(-1);
    const first = this.points[0];
    // back on the run's start, once it has two walls, closes it
    const closes = this.walls.length >= 2 && dist(at, first) * this.env.view.scale <= CLOSE_PX;
    if (closes) at = first;
    // a wall already drawn there: its end (a corner) or its side (a tee)
    const join = closes ? null : this.joinAt(layerId, at);
    if (join) at = join.at;
    // a double-click's second press lands on the corner the first placed
    if (last && dist(last, at) > this.tolerance()) {
      const joins = { before: this.walls.at(-1) ?? this.startJoin ?? undefined, after: closes ? this.walls[0] : join?.id };
      const r = attempt("Add Wall", (s) => s.addWall(layerId, last, at, k.id, store.activeClassIndex, joins));
      if (!r) return;
      setEditGroup(null, [r.value]);
      this.points.push(at);
      this.walls.push(r.value);
    } else if (!last) {
      this.points.push(at);
      this.startJoin = join?.id ?? null;
    }
    if (closes || p.detail >= 2 || (last && join)) this.reset();
  }

  cancel(): void {
    this.reset();
    this.pointer = null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.points.length === 0 || (e.key !== "Enter" && e.key !== "Escape")) return false;
    this.reset();
    this.env.requestDraw();
    return true;
  }

  overlay(g: Painter): void {
    const last = this.points.at(-1);
    const k = this.current();
    if (!last || !k || !this.pointer) return;
    const at = this.cursorPoint(this.pointer);
    const length = dist(last, at);
    if (!(length > 0)) return;
    // the wall's outline as the copy will lie: its faces either side of the line it runs along
    const n = { x: -(at.y - last.y) / length, y: (at.x - last.x) / length };
    const side = (p: Pt, f: number): Pt => ({ x: p.x + n.x * f, y: p.y + n.y * f });
    const [right, left] = k.faces;
    withPreview(g, () => {
      strokeScreen(g, [side(last, right), side(at, right), side(at, left), side(last, left)], true);
      strokeScreen(g, [last, at], false);
    });
  }

  /** The wall a new one copies: the one chosen, or one of its style and size since the id can change as walls join; else the first. */
  private current(): WallTemplate | null {
    const kinds = store.session?.wallTemplates() ?? [];
    const was = this.chosen;
    const kind =
      kinds.find((k) => k.id === this.template) ??
      kinds.find((k) => was && k.style === was.style && Math.abs(k.thickness - was.thickness) < 0.01 && Math.abs(k.height - was.height) < 0.01) ??
      kinds[0] ??
      null;
    this.chosen = kind;
    return kind;
  }

  private cursorPoint(p: PointerInfo): Pt {
    const last = this.points.at(-1);
    return last && p.shift ? snapAngle(last, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private tolerance(): number {
    return 2 / this.env.view.scale;
  }

  /** The wall already drawn that a click at `at` joins: not one of this run's, which join by its corners. */
  private joinAt(layerId: string, at: Pt): WallJoin | null {
    const join = store.session?.wallJoinAt(layerId, at, CLOSE_PX / this.env.view.scale) ?? null;
    return join && !this.walls.includes(join.id) ? join : null;
  }

  private reset(): void {
    this.points = [];
    this.walls = [];
    this.startJoin = null;
  }
}

/** A wall kind as Preferences and the hint name it: its style, thickness and height. */
export function wallLabel(k: WallTemplate, units: string | undefined): string {
  return `${k.style ?? "Unstyled"} · ${formatLength(k.thickness, units)} thick · ${formatLength(k.height, units)} high`;
}
