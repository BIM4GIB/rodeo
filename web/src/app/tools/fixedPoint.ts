// Shear and Fixed Point Resize tools, as Vectorworks has them beside the Clip tool on the Basic
// palette: with objects selected, click a point that stays fixed, then press on the selection and
// drag (or click, move and click again) to reshape it about that point. Each works on rectangles,
// rounded rectangles, polygons, circles and ovals (Shear on polylines too), at the level being
// edited; others in the selection are left as they are.
// - Fixed Point Resize stretches the selection across and up about the fixed point, each by how far
//   the dragged point now lies from it against how far it started: the start can't be level with
//   the fixed point or plumb with it, and dragged past it the selection is reversed. Shift keeps
//   the proportions (one factor, along the drag).
// - Shear skews the selection so the dragged point lands where the pointer is, the fixed point
//   staying put: a drag across slides it across by an amount growing with the height above or
//   below the fixed point, a drag up or down slides it up by one growing with the distance across.
//   Shift keeps the drag across or up, whichever is longer.
// A rectangle, rounded rectangle, circle or oval that can't keep its kind becomes a polygon. Esc
// starts over; a commit keeps the selection and the tool. One undo step.

import type { Affine, Pt } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { dist } from "../geom.ts";
import { isFullArc } from "../shapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";
import { drawLabel, drawMarker, mapOutlines, selectionOutlines, selectionUnchanged } from "./rotate.ts";

/** a drag shorter than this, CSS px, is a click (the second click sets it) */
const DRAG_PX = 4;
/** the dragged point must start this far, CSS px, from the fixed point's level and plumb */
const OFF_AXIS_PX = 2;
const RECT = 3;
const POLYGON = 5;
const ARC = 6;
const ROUND_RECT = 13;
const POLYLINE = 21;

type Which = "shear" | "resize";

const WORKS_ON: Record<Which, ReadonlySet<number>> = {
  shear: new Set([RECT, POLYGON, ARC, ROUND_RECT, POLYLINE]),
  resize: new Set([RECT, POLYGON, ARC, ROUND_RECT]),
};
const KINDS: Record<Which, string> = {
  shear: "rectangles, rounded rectangles, polygons, polylines, circles and ovals",
  resize: "rectangles, rounded rectangles, polygons, circles and ovals",
};
const NAME: Record<Which, string> = { shear: "Shear", resize: "Fixed Point Resize" };

/** The selected objects the tool reshapes: of the kinds it takes, at the level being edited (whole circles and ovals only). */
function reshapeable(which: Which): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && o.parentId === store.editGroupId && WORKS_ON[which].has(o.type) && o.shape && (o.type !== ARC || isFullArc(o.shape)))
    .map((o) => o.id);
}

/** Stretching across by `sx` and up by `sy` about `f`. */
function stretchAbout(f: Pt, sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: f.x * (1 - sx), f: f.y * (1 - sy) };
}

/** Sliding x by `kx` per unit above `f` and y by `ky` per unit right of it. */
function skewAbout(f: Pt, kx: number, ky: number): Affine {
  return { a: 1, b: ky, c: kx, d: 1, e: -kx * f.y, f: -ky * f.x };
}

abstract class FixedPointTool extends BaseTool {
  readonly cursor = "crosshair";
  protected abstract readonly which: Which;

  /** the point that stays put; null before the first click */
  private fixed: Pt | null = null;
  /** where the drag started; null until it does */
  private start: Pt | null = null;
  private startScreen: Pt | null = null;
  /** the pointer, with Shift's constraint */
  private pointer: Pt | null = null;
  private shift = false;
  /** the button is down on the drag's first press */
  private pressed = false;
  /** the selection the gesture reshapes; a change under it drops the gesture */
  private ids: readonly string[] = [];
  private targets: readonly string[] = [];

  hint(): string {
    if (store.selection.size === 0) return "Select objects first";
    if (!this.fixed && reshapeable(this.which).length === 0) return `${NAME[this.which]} works on ${KINDS[this.which]}`;
    if (!this.fixed) return "Click the point that stays fixed";
    if (!this.start) return "Press on the selection and drag, or click it";
    return this.which === "resize" ? "Click to set the size · Shift keeps the proportions" : "Click to set the shear · Shift across or up";
  }

  down(p: PointerInfo): void {
    this.sync();
    if (store.selection.size === 0) return;
    if (!this.fixed) {
      const targets = reshapeable(this.which);
      if (targets.length === 0) {
        toast(`${NAME[this.which]} works on ${KINDS[this.which]}.`, "info");
        return;
      }
      this.fixed = p.pos;
      this.pointer = p.pos;
      this.ids = [...store.selection];
      this.targets = targets;
      return;
    }
    if (!this.start) {
      const fixed = this.fixed;
      const px = OFF_AXIS_PX / this.env.view.scale;
      const offAxis = this.which === "resize" ? Math.abs(p.pos.x - fixed.x) > px && Math.abs(p.pos.y - fixed.y) > px : Math.abs(p.pos.x - fixed.x) > px || Math.abs(p.pos.y - fixed.y) > px;
      if (!offAxis) {
        toast(
          this.which === "resize" ? "Start the drag away from the fixed point's level and plumb: it stretches across and up from there." : "Start the drag away from the fixed point.",
          "info",
        );
        return;
      }
      this.start = p.pos;
      this.startScreen = p.screen;
      this.pointer = p.pos;
      this.pressed = true;
      return;
    }
    this.commit(p);
  }

  move(p: PointerInfo): void {
    this.sync();
    this.shift = p.shift;
    this.pointer = this.constrained(p);
  }

  up(p: PointerInfo): void {
    if (!this.pressed) return;
    this.pressed = false;
    // a press and drag sets it as the button comes up; a click waits for the second click
    if (this.startScreen && dist(p.screen, this.startScreen) > DRAG_PX) this.commit(p);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.fixed) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const f = this.fixed;
    if (!f || !selectionUnchanged(this.ids)) return;
    const s = this.start;
    const p = this.pointer;
    if (s && p) {
      const m = this.transform(p, this.shift);
      if (m) {
        const moved = mapOutlines(selectionOutlines(this.env.scene, this.targets), m);
        withPreview(g, () => {
          for (const line of moved) strokeScreen(g, line, false);
          strokeScreen(g, [s, p], false);
        });
        const P = g.toScreen(p);
        drawLabel(g, { x: P.x + 14, y: P.y - 22 }, this.label(m));
      }
      drawMarker(g, s);
    }
    drawMarker(g, f);
  }

  /** The map the drag gives with the pointer at `p`, or null when it gives none (or a flat one). */
  private transform(p: Pt, shift: boolean): Affine | null {
    const f = this.fixed;
    const s = this.start;
    if (!f || !s) return null;
    let m: Affine;
    if (this.which === "resize") {
      const sx = (p.x - f.x) / (s.x - f.x);
      const sy = (p.y - f.y) / (s.y - f.y);
      if (shift) {
        // one factor: how far along the line from the fixed point the pointer has come
        const ux = s.x - f.x;
        const uy = s.y - f.y;
        const k = ((p.x - f.x) * ux + (p.y - f.y) * uy) / (ux * ux + uy * uy);
        m = stretchAbout(f, k, k);
      } else {
        m = stretchAbout(f, sx, sy);
      }
    } else {
      // a start level with the fixed point slides nothing across, one plumb with it nothing up
      const px = OFF_AXIS_PX / this.env.view.scale;
      const across = s.y - f.y;
      const up = s.x - f.x;
      const kx = Math.abs(across) > px ? (p.x - s.x) / across : 0;
      const ky = Math.abs(up) > px ? (p.y - s.y) / up : 0;
      m = skewAbout(f, kx, ky);
    }
    const det = m.a * m.d - m.b * m.c;
    if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) || Math.abs(det) < 1e-6) return null;
    return m;
  }

  /** The pointer, Shift held: for Shear, kept level or plumb with where the drag started. */
  private constrained(p: PointerInfo): Pt {
    const s = this.start;
    if (!p.shift || !s || this.which !== "shear") return p.pos;
    return Math.abs(p.pos.x - s.x) >= Math.abs(p.pos.y - s.y) ? { x: p.pos.x, y: s.y } : { x: s.x, y: p.pos.y };
  }

  /** What the preview shows beside the pointer: the factors, or the shear angles. */
  private label(m: Affine): string {
    const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
    const deg = (k: number): string => `${Math.round((Math.atan(k) * 180) / Math.PI * 10) / 10}°`;
    if (this.which === "resize") return m.a === m.d ? pct(m.a) : `${pct(m.a)} × ${pct(m.d)}`;
    if (m.b === 0) return `across ${deg(m.c)}`;
    if (m.c === 0) return `up ${deg(m.b)}`;
    return `${deg(m.c)} · ${deg(m.b)}`;
  }

  private commit(p: PointerInfo): void {
    const m = this.transform(this.constrained(p), p.shift);
    if (!m || (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1)) return;
    const targets = [...this.targets];
    const skipped = this.ids.length - targets.length;
    const r = attempt(NAME[this.which], (s) => s.transformObjects(targets, m));
    if (r && skipped > 0) toast(`${skipped === 1 ? "1 selected object isn't" : `${skipped} selected objects aren't`} one of the ${KINDS[this.which]} ${NAME[this.which]} works on: left as it was.`, "info");
    this.reset();
  }

  /** Drops the gesture when the selection changed under it. */
  private sync(): void {
    if (this.fixed && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    this.fixed = null;
    this.start = null;
    this.startScreen = null;
    this.pointer = null;
    this.pressed = false;
    this.ids = [];
    this.targets = [];
  }
}

export class ShearTool extends FixedPointTool {
  readonly id = "shear";
  protected readonly which = "shear";
}

export class FixedPointResizeTool extends FixedPointTool {
  readonly id = "fpresize";
  protected readonly which = "resize";
}
