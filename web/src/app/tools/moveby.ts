// Move by Points tool: click a point, then the point it should go to, and the
// selection moves by the distance between them. In Copy mode, or with Option
// (Alt) held on the second click, a copy moves and the originals stay. Shift
// constrains the move to 45-degree steps. Esc starts over; a move keeps the
// selection and the tool, so the next pair of clicks moves it again.

import type { Pt } from "../../core/index.ts";
import { attempt, moveObjects, setSelection } from "../commands.ts";
import { constrainAngle, dist } from "../geom.ts";
import { store } from "../state.ts";
import { formatLength } from "../units.ts";
import { ALT_KEY, BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { drawLabel, drawMarker, mapOutlines, selectionOutlines, selectionUnchanged } from "./rotate.ts";

const MIN_WORLD = 1e-9;

type MoveMode = "move" | "copy";
const MODES: readonly MoveMode[] = ["move", "copy"];
const MODE_NAME: Record<MoveMode, string> = { move: "Move", copy: "Copy" };

export class MoveByPointsTool extends BaseTool {
  readonly id = "moveby";
  readonly cursor = "crosshair";

  private mode: MoveMode = "move";
  /** the point picked up; null before the first click */
  private from: Pt | null = null;
  /** where it goes, under the pointer, shift-constrained */
  private to: Pt | null = null;
  /** selection when the gesture started; a change under the gesture drops it */
  private ids: readonly string[] = [];
  /** Option/Alt state; PointerInfo carries no alt flag, so it is read from window events */
  private altHeld = false;

  constructor(env: ToolEnv) {
    super(env);
    const track = (e: KeyboardEvent | PointerEvent): void => {
      this.altHeld = e.altKey;
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    // capture phase: the flag is set before the canvas delivers the click
    window.addEventListener("pointerdown", track, true);
    window.addEventListener("blur", () => {
      this.altHeld = false;
    });
  }

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
    if (store.selection.size === 0) return "Select objects first";
    if (!this.from) return "Click the point to move from · 1–2 mode";
    return `Click the point to move to · Shift 45° · ${ALT_KEY} copy`;
  }

  down(p: PointerInfo): void {
    this.sync();
    if (store.selection.size === 0) return;
    if (!this.from) {
      this.from = p.pos;
      this.to = p.pos;
      this.ids = [...store.selection];
      return;
    }
    const to = p.shift ? constrainAngle(this.from, p.pos) : p.pos;
    const dx = to.x - this.from.x;
    const dy = to.y - this.from.y;
    const ids = [...store.selection];
    this.reset();
    if (Math.hypot(dx, dy) < MIN_WORLD) return;
    if (this.mode === "copy" || this.altHeld) {
      const copies = attempt("Move copy", (s) => s.duplicateObjects(ids, dx, dy));
      if (copies) setSelection(copies.value);
    } else {
      moveObjects(ids, dx, dy);
    }
  }

  move(p: PointerInfo): void {
    this.sync();
    if (this.from) this.to = p.shift ? constrainAngle(this.from, p.pos) : p.pos;
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (!e.metaKey && !e.ctrlKey && (e.key === "1" || e.key === "2")) {
      this.setMode(MODES[Number(e.key) - 1]);
      return true;
    }
    if (e.key !== "Escape" || !this.from) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const a = this.from;
    const b = this.to;
    if (!a || !b || !selectionUnchanged(this.ids)) return;
    const moved = mapOutlines(selectionOutlines(this.env.scene, this.ids), {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: b.x - a.x,
      f: b.y - a.y,
    });
    withPreview(g, () => {
      strokeScreen(g, [a, b], false);
      for (const line of moved) strokeScreen(g, line, false);
    });
    drawMarker(g, a);
    drawMarker(g, b);
    const len = dist(a, b);
    if (len > MIN_WORLD) {
      const B = g.toScreen(b);
      drawLabel(g, { x: B.x + 12, y: B.y - 22 }, formatLength(len, store.session?.doc.info.units));
    }
  }

  /** Drops the gesture when the selection changed under it. */
  private sync(): void {
    if (this.from && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    this.from = null;
    this.to = null;
    this.ids = [];
  }
}
