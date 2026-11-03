// Triangle tool, as Vectorworks' (Basic, sharing the 2D Polygon's place): click the two ends of
// the first side, enter the rest in Triangle Settings by the mode (Three Sides; Two Sides and
// Included Angle; Two Angles and Common Side), then click on the side of the first one where the
// triangle goes: both possible triangles show until then. Esc cancels. The triangle is a polygon.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { triangleApex, type TriangleMode } from "../basicShapes.ts";
import { dist } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";

/** a press dragged further than this (CSS px) is a drag, and clicks closer count as one */
const CLICK_PX = 4;

const MODES: readonly { readonly id: TriangleMode; readonly label: string }[] = [
  { id: "sides", label: "Three Sides" },
  { id: "sidesAngle", label: "Two Sides and Included Angle" },
  { id: "anglesSide", label: "Two Angles and Common Side" },
];

export class TriangleTool extends BaseTool {
  readonly id = "triangle";
  readonly cursor = "crosshair";
  private mode: TriangleMode = "sides";
  private points: Pt[] = [];
  private pressScreen: Pt | null = null;
  private pointer: Pt | null = null;
  /** the first side and the values entered, while the triangle's side is chosen */
  private choosing: { a: Pt; b: Pt; first: number; second: number } | null = null;
  /** what Triangle Settings last took, by mode */
  private last: Record<TriangleMode, [number, number]> = { sides: [1000, 1000], sidesAngle: [1000, 60], anglesSide: [60, 60] };

  modes(): readonly ToolModes[] {
    return [{ label: "Triangle", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (!mode) return;
    this.mode = mode.id;
    this.reset();
  }

  snapFrom(): Pt | null {
    return this.choosing ? null : (this.points[0] ?? null);
  }

  hint(): string {
    if (this.choosing) return "Click the triangle to keep";
    return this.points.length ? "Click the first side's other end" : "Click the first side's start · 1–3 mode";
  }

  down(p: PointerInfo): void {
    this.pointer = p.pos;
    if (this.choosing) {
      const { a, b, first, second } = this.choosing;
      const left = (b.x - a.x) * (p.pos.y - a.y) - (b.y - a.y) * (p.pos.x - a.x) >= 0;
      const apex = triangleApex(this.mode, a, b, first, second, left);
      this.reset();
      if (typeof apex !== "string") addAndSelect({ kind: "polygon", points: [a, b, apex], closed: true });
      return;
    }
    this.pressScreen = p.screen;
    if (this.points.length === 0) this.points = [p.pos];
    else this.side(p.pos);
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.points.length === 1 && press && dist(p.screen, press) > CLICK_PX) this.side(p.pos);
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
    if (e.key !== "Escape" || (!this.points.length && !this.choosing)) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const at = this.pointer;
    if (this.choosing) {
      const { a, b, first, second } = this.choosing;
      withPreview(g, () => {
        for (const left of [true, false]) {
          const apex = triangleApex(this.mode, a, b, first, second, left);
          if (typeof apex !== "string") strokeScreen(g, [a, b, apex], true);
        }
      });
      return;
    }
    if (at && this.points.length === 1) withPreview(g, () => strokeScreen(g, [this.points[0], at], false));
  }

  /** Takes the first side's end and asks for the rest. */
  private async side(end: Pt): Promise<void> {
    await this.ask(end);
    // the dialog closed without a pointer event: show the triangles to choose from (or the first prompt again) now
    if (store.tool === this.id) store.setHint(this.hint());
    this.env.requestDraw();
  }

  private async ask(end: Pt): Promise<void> {
    const a = this.points[0];
    this.points = [];
    if (!(dist(a, end) > 0)) return;
    const mode = this.mode;
    const [first, second] = this.last[mode];
    const v = await toolPrefs(`Triangle Settings (${MODES.find((m) => m.id === mode)!.label})`, [
      { kind: "length", key: "side1", label: "Side 1", value: dist(a, end) },
      mode === "anglesSide"
        ? { kind: "number", key: "first", label: "Angle 1 (at the first click)", value: first, min: 0, max: 180, unit: "°" }
        : { kind: "length", key: "first", label: "Side 2", value: first },
      mode === "sides"
        ? { kind: "length", key: "second", label: "Side 3", value: second }
        : { kind: "number", key: "second", label: mode === "sidesAngle" ? "Included Angle (between sides 1 and 2)" : "Angle 2 (at the second click)", value: second, min: 0, max: 180, unit: "°" },
    ]);
    if (!v || mode !== this.mode) return;
    const len = v.num("side1");
    const u = { x: (end.x - a.x) / dist(a, end), y: (end.y - a.y) / dist(a, end) };
    const b = { x: a.x + u.x * len, y: a.y + u.y * len };
    const values: [number, number] = [v.num("first"), v.num("second")];
    this.last[mode] = values;
    const check = triangleApex(mode, a, b, values[0], values[1], true);
    if (typeof check === "string") {
      toast(check, "info");
      return;
    }
    this.choosing = { a, b, first: values[0], second: values[1] };
  }

  private reset(): void {
    this.points = [];
    this.pressScreen = null;
    this.choosing = null;
  }
}
