// Mirror tool: click two points for the mirror axis and the selection is
// reflected across it. Shift constrains the axis to 45-degree steps. Its modes
// (1, 2) mirror the selection itself or a copy, leaving the originals in place;
// Option (Alt) on the second click does the other. Esc starts over; a commit
// keeps the selection and the tool.

import type { Affine, Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { constrainAngle, dist } from "../geom.ts";
import { store } from "../state.ts";
import {
  ALT_KEY,
  BaseTool,
  modeForKey,
  strokeScreen,
  withPreview,
  type Painter,
  type PointerInfo,
  type ToolEnv,
  type ToolModes,
} from "../tools.ts";
import { drawMarker, mapOutlines, selectionOutlines, selectionUnchanged } from "./rotate.ts";

const MIN_WORLD = 1e-9;
type Mode = "move" | "copy";

export class MirrorTool extends BaseTool {
  readonly id = "mirror";
  readonly cursor = "crosshair";

  /** first point of the axis; null before the first click */
  private first: Pt | null = null;
  /** axis end under the pointer, shift-constrained */
  private end: Pt | null = null;
  /** selection when the gesture started; a change under the gesture drops it */
  private ids: readonly string[] = [];
  /** Option/Alt state; PointerInfo carries no alt flag, so it is read from window events */
  private altHeld = false;
  private mode: Mode = "move";

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
      options: [
        { id: "move", label: "Mirror", key: "1" },
        { id: "copy", label: "Mirror a copy", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id === "move" || id === "copy") this.mode = id;
  }

  hint(): string {
    if (store.selection.size === 0) return "Select objects first";
    if (!this.first) return "Click the first point of the axis · 1–2 mode";
    return `Click the second point of the axis · Shift 45° · ${ALT_KEY} ${this.mode === "copy" ? "move" : "copy"}`;
  }

  down(p: PointerInfo): void {
    this.sync();
    if (store.selection.size === 0) return;
    if (!this.first) {
      this.first = p.pos;
      this.end = p.pos;
      this.ids = [...store.selection];
      return;
    }
    const end = p.shift ? constrainAngle(this.first, p.pos) : p.pos;
    const len = dist(end, this.first);
    if (len < MIN_WORLD) return;
    const u = { x: (end.x - this.first.x) / len, y: (end.y - this.first.y) / len };
    const m = mirrorAcross(this.first, u);
    const ids = [...store.selection];
    if ((this.mode === "copy") !== this.altHeld) {
      // one undo step: the copy and its mirroring
      const copies = attempt("Mirror copy", (s) =>
        s.batch(() => {
          const made = s.duplicateObjects(ids, 0, 0);
          s.transformObjects(made, m);
          return made;
        }),
      );
      if (copies) setSelection(copies.value);
    } else {
      attempt("Mirror", (s) => s.transformObjects(ids, m));
    }
    this.reset();
  }

  move(p: PointerInfo): void {
    this.sync();
    if (this.first) this.end = p.shift ? constrainAngle(this.first, p.pos) : p.pos;
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
    if (e.key !== "Escape" || !this.first) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const a = this.first;
    const b = this.end;
    if (!a || !b || !selectionUnchanged(this.ids)) return;
    const len = dist(a, b);
    if (len < MIN_WORLD) return;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // the axis runs across the whole viewport
    const reach = Math.hypot(g.width, g.height) / g.scale;
    const axis: Pt[] = [
      { x: a.x - u.x * reach, y: a.y - u.y * reach },
      { x: a.x + u.x * reach, y: a.y + u.y * reach },
    ];
    const mirrored = mapOutlines(selectionOutlines(this.env.scene, this.ids), mirrorAcross(a, u));
    withPreview(g, () => {
      strokeScreen(g, axis, false);
      for (const line of mirrored) strokeScreen(g, line, false);
    });
    drawMarker(g, a);
  }

  /** Drops the gesture when the selection changed under it. */
  private sync(): void {
    if (this.first && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    this.first = null;
    this.end = null;
    this.ids = [];
  }
}

/** Reflection across the line through `p` with unit direction `u`, as an affine map. */
function mirrorAcross(p: Pt, u: Pt): Affine {
  const a = 2 * u.x * u.x - 1;
  const b = 2 * u.x * u.y;
  const c = b;
  const d = 2 * u.y * u.y - 1;
  return { a, b, c, d, e: p.x - (a * p.x + c * p.y), f: p.y - (b * p.x + d * p.y) };
}
