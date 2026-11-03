// Tape measure: click a start point, move to see a live dimension line to the
// cursor with its length, angle (counter-clockwise from +x) and dX/dY. Click
// again to freeze it; the next click starts a new measurement. Shift constrains
// the line to 15-degree steps. Esc clears. Lengths are shown in the document's units.
// Multiple Segment mode measures a path instead: each click adds a segment, the
// label shows the last segment and the running total, and a double-click or
// Enter ends it.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, clamp, dist, polarOf, snapAngle } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength } from "../units.ts";

const MIN_WORLD = 1e-9;
/** half the length of the slash-shaped tick at each end, CSS px */
const TICK_PX = 5;
/** clearance between the dimension line and its label, CSS px */
const LABEL_GAP_PX = 8;
const EDGE_PX = 4;
const PILL_RADIUS = 6;
const PAD_X = 7;
const PAD_Y = 5;
const LINE_H = 14;
const MAIN_FONT = `12px "Helvetica Neue", Arial, system-ui, sans-serif`;
const DETAIL_FONT = `11px "Helvetica Neue", Arial, system-ui, sans-serif`;

/** Angle in degrees, in [0, 360), to two decimals. */
function angleText(deg: number): string {
  const r = Math.round((((deg % 360) + 360) % 360) * 100) / 100;
  return String(r % 360);
}

export class MeasureTool extends BaseTool {
  readonly id = "measure";
  readonly cursor = "crosshair";

  /** the points clicked so far; empty when no measurement is in progress */
  private path: Pt[] = [];
  /** the measured end: follows the pointer until frozen */
  private end: Pt | null = null;
  private frozen = false;
  private mode: "single" | "multiple" = "single";

  modes(): ToolModes {
    return {
      options: [
        { id: "single", label: "Single Segment", key: "1" },
        { id: "multiple", label: "Multiple Segment", key: "2" },
      ],
      active: this.mode,
    };
  }

  setMode(id: string): void {
    if (id !== "single" && id !== "multiple") return;
    this.mode = id;
    this.clear();
  }

  snapFrom(): Pt | null {
    return this.path.at(-1) ?? null;
  }

  hint(): string {
    if (this.path.length === 0) return "Click the start point · 1–2 mode";
    if (this.frozen) return "Click to measure again · Esc clears";
    if (this.mode === "single") return `Click the end point · Shift ${ANGLE_STEP_DEG}° · Esc clears`;
    return `Click the next point · Double-click or Enter ends · Shift ${ANGLE_STEP_DEG}° · Esc clears`;
  }

  down(p: PointerInfo): void {
    const last = this.path.at(-1);
    if (last && !this.frozen) {
      const to = this.endAt(p);
      if (dist(to, last) < MIN_WORLD) {
        // a double-click on the last point ends a path; on the start it keeps measuring
        if (this.mode === "multiple" && p.detail >= 2 && this.path.length >= 2) this.freeze();
        return;
      }
      this.end = to;
      if (this.mode === "single") this.frozen = true;
      else this.path.push(to);
      return;
    }
    this.path = [p.pos];
    this.end = p.pos;
    this.frozen = false;
  }

  move(p: PointerInfo): void {
    if (this.path.length > 0 && !this.frozen) this.end = this.endAt(p);
  }

  cancel(): void {
    this.clear();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key === "Enter" && this.mode === "multiple" && !this.frozen && this.path.length >= 2) {
      this.freeze();
      return true;
    }
    if (e.key !== "Escape" || this.path.length === 0) return false;
    this.clear();
    return true;
  }

  overlay(g: Painter): void {
    const pts = this.measured();
    if (pts.length < 2) return;
    const screen = pts.map((p) => g.toScreen(p));
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash(this.frozen ? [] : [5, 3]);
    ctx.beginPath();
    screen.forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
    ctx.stroke();

    // dimension ticks: short slashes at 45 degrees to each segment, at both its ends
    ctx.setLineDash([]);
    ctx.beginPath();
    let lastDir: Pt | null = null;
    for (let i = 1; i < screen.length; i++) {
      const a = screen[i - 1];
      const b = screen[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      lastDir = { x: ux, y: uy };
      const tx = ((ux - uy) * TICK_PX) / Math.SQRT2;
      const ty = ((ux + uy) * TICK_PX) / Math.SQRT2;
      for (const p of [a, b]) {
        ctx.moveTo(p.x - tx, p.y - ty);
        ctx.lineTo(p.x + tx, p.y + ty);
      }
    }
    ctx.stroke();

    if (lastDir) {
      const a = screen[screen.length - 2];
      const b = screen[screen.length - 1];
      const from = pts[pts.length - 2];
      const to = pts[pts.length - 1];
      this.drawLabel(g, from, to, pts, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: -lastDir.y, y: lastDir.x });
    }
    ctx.restore();
  }

  /** The points measured: those clicked, and the end following the pointer until frozen. */
  private measured(): Pt[] {
    const end = this.end;
    if (this.path.length === 0 || !end) return [];
    if (this.mode === "single") return [this.path[0], end];
    return this.frozen ? this.path : [...this.path, end];
  }

  private freeze(): void {
    this.frozen = true;
    this.end = this.path.at(-1) ?? null;
  }

  /** The measured end for the pointer: snapped, and on a 15-degree line from the last point under Shift. */
  private endAt(p: PointerInfo): Pt {
    const from = this.path.at(-1);
    return p.shift && from ? snapAngle(from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  /**
   * Accent pill with the last segment's length and angle, then its dX and dY (or, measuring a
   * path, the total), set off the segment on the side facing up.
   */
  private drawLabel(g: Painter, from: Pt, to: Pt, pts: readonly Pt[], mid: Pt, normal: Pt): void {
    const { ctx } = g;
    const { length, angle } = polarOf(from, to);
    const units = store.session?.doc.info.units;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const main = `${formatLength(length, units)} · ${angleText(angle)}°`;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    const detail =
      this.mode === "multiple"
        ? `Total ${formatLength(total, units)} · ${pts.length - 1} segment${pts.length === 2 ? "" : "s"}`
        : `ΔX ${formatLength(dx, units)} · ΔY ${formatLength(dy, units)}`;

    ctx.font = MAIN_FONT;
    const mainW = ctx.measureText(main).width;
    ctx.font = DETAIL_FONT;
    const detailW = ctx.measureText(detail).width;
    const w = Math.max(mainW, detailW) + PAD_X * 2;
    const h = PAD_Y * 2 + LINE_H * 2;

    // normal pointing up the screen (y down), so horizontal lines get their label above
    const n = normal.y > 0 ? { x: -normal.x, y: -normal.y } : normal;
    const reach = Math.abs(n.x) * (w / 2) + Math.abs(n.y) * (h / 2) + LABEL_GAP_PX;
    const x = clamp(mid.x + n.x * reach - w / 2, EDGE_PX, g.width - w - EDGE_PX);
    const y = clamp(mid.y + n.y * reach - h / 2, EDGE_PX, g.height - h - EDGE_PX);

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, PILL_RADIUS);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = MAIN_FONT;
    ctx.fillText(main, x + PAD_X, y + PAD_Y + LINE_H / 2);
    ctx.font = DETAIL_FONT;
    ctx.fillText(detail, x + PAD_X, y + PAD_Y + LINE_H * 1.5);
  }

  private clear(): void {
    this.path = [];
    this.end = null;
    this.frozen = false;
  }
}
