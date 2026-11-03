// Protractor (Dims/Notes): measures an angle, as Vectorworks' tool does. Click the angle's vertex,
// then a point along its first side, then move to see the angle to the second side, drawn as an
// arc between them with its size (the smaller way round) and the larger one; click again to
// freeze it, and the next click measures anew. Shift holds a side to 15° steps. Esc clears.
// Nothing is drawn into the document.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, clamp, dist, snapAngle } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";

const MIN_WORLD = 1e-9;
/** the arc between the sides, CSS px from the vertex */
const ARC_PX = 36;
const LABEL_GAP_PX = 10;
const EDGE_PX = 4;
const PILL_RADIUS = 6;
const PAD_X = 7;
const PAD_Y = 5;
const LINE_H = 14;
const MAIN_FONT = `12px "Helvetica Neue", Arial, system-ui, sans-serif`;
const DETAIL_FONT = `11px "Helvetica Neue", Arial, system-ui, sans-serif`;

/** Degrees to two decimals. */
function degText(deg: number): string {
  return String(Math.round(deg * 100) / 100);
}

/** A direction's angle in degrees, counter-clockwise from +x, in [0, 360). */
function heading(from: Pt, to: Pt): number {
  const a = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return ((a % 360) + 360) % 360;
}

/** The angle between the sides from the vertex to `a` and to `b`: the smaller way round, and which way it turns. */
export function protractorAngle(vertex: Pt, a: Pt, b: Pt): { angle: number; ccw: boolean; from: number; to: number } {
  const from = heading(vertex, a);
  const to = heading(vertex, b);
  const turn = (((to - from) % 360) + 360) % 360;
  return turn <= 180 ? { angle: turn, ccw: true, from, to } : { angle: 360 - turn, ccw: false, from, to };
}

export class ProtractorTool extends BaseTool {
  readonly id = "protractor";
  readonly cursor = "crosshair";

  /** the vertex, then the first side's point, as clicked */
  private clicked: Pt[] = [];
  /** the point following the pointer: the first side's, then the second's */
  private live: Pt | null = null;
  private frozen = false;

  snapFrom(): Pt | null {
    return this.clicked[0] ?? null;
  }

  hint(): string {
    if (this.clicked.length === 0) return "Click the angle's vertex";
    if (this.frozen) return "Click to measure again · Esc clears";
    if (this.clicked.length === 1) return `Click a point along the first side · Shift ${ANGLE_STEP_DEG}° · Esc clears`;
    return `Click a point along the second side · Shift ${ANGLE_STEP_DEG}° · Esc clears`;
  }

  down(p: PointerInfo): void {
    if (this.clicked.length === 0 || this.frozen) {
      this.clicked = [p.pos];
      this.live = null;
      this.frozen = false;
      return;
    }
    const at = this.sideAt(p);
    // a side needs a length
    if (dist(at, this.clicked[0]) < MIN_WORLD) return;
    if (this.clicked.length === 1) {
      this.clicked.push(at);
      this.live = null;
      return;
    }
    this.live = at;
    this.frozen = true;
  }

  move(p: PointerInfo): void {
    if (this.clicked.length > 0 && !this.frozen) this.live = this.sideAt(p);
  }

  cancel(): void {
    this.clear();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || this.clicked.length === 0) return false;
    this.clear();
    return true;
  }

  /** The vertex and the two sides' points, while an angle is shown. */
  measured(): { vertex: Pt; a: Pt; b: Pt } | null {
    const [vertex, a] = this.clicked;
    const b = this.live;
    if (!vertex || !a || !b || dist(b, vertex) < MIN_WORLD) return null;
    return { vertex, a, b };
  }

  overlay(g: Painter): void {
    const [vertex] = this.clicked;
    if (!vertex) return;
    const first = this.clicked[1] ?? this.live;
    if (!first) return;
    const { ctx } = g;
    const v = g.toScreen(vertex);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.lineWidth = 1;
    // each side runs from the vertex through its point and on past it
    const side = (to: Pt, live: boolean): void => {
      const s = g.toScreen(to);
      const len = Math.hypot(s.x - v.x, s.y - v.y);
      if (len < 1) return;
      const reach = Math.max(len, ARC_PX * 1.6);
      ctx.setLineDash(live ? [5, 3] : []);
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x + ((s.x - v.x) / len) * reach, v.y + ((s.y - v.y) / len) * reach);
      ctx.stroke();
    };
    side(first, this.clicked.length < 2);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(v.x, v.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    const m = this.measured();
    if (m) {
      side(m.b, !this.frozen);
      ctx.setLineDash([]);
      const { angle, ccw, from } = protractorAngle(m.vertex, m.a, m.b);
      // screen y runs down, so world counter-clockwise is the canvas's anticlockwise
      const start = (-from * Math.PI) / 180;
      const end = (-(ccw ? from + angle : from - angle) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(v.x, v.y, ARC_PX, start, end, ccw);
      ctx.stroke();
      const mid = (start + end) / 2;
      this.drawLabel(g, { x: v.x + Math.cos(mid) * ARC_PX, y: v.y + Math.sin(mid) * ARC_PX }, { x: Math.cos(mid), y: Math.sin(mid) }, m);
    }
    ctx.restore();
  }

  /** Accent pill with the angle and, under it, the larger angle and the sides' directions. */
  private drawLabel(g: Painter, at: Pt, out: Pt, m: { vertex: Pt; a: Pt; b: Pt }): void {
    const { ctx } = g;
    const { angle, from, to } = protractorAngle(m.vertex, m.a, m.b);
    const main = `${degText(angle)}°`;
    const detail = `${degText(360 - angle)}° the other way · sides at ${degText(from)}° and ${degText(to)}°`;
    ctx.font = MAIN_FONT;
    const mainW = ctx.measureText(main).width;
    ctx.font = DETAIL_FONT;
    const detailW = ctx.measureText(detail).width;
    const w = Math.max(mainW, detailW) + PAD_X * 2;
    const h = PAD_Y * 2 + LINE_H * 2;
    // off to the side the arc faces: a corner of the pill at the arc, centred where it faces straight out
    const lean = (d: number): number => clamp(d * 2, -1, 1);
    const x = clamp(at.x + out.x * LABEL_GAP_PX + (lean(out.x) - 1) * (w / 2), EDGE_PX, g.width - w - EDGE_PX);
    const y = clamp(at.y + out.y * LABEL_GAP_PX + (lean(out.y) - 1) * (h / 2), EDGE_PX, g.height - h - EDGE_PX);
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

  /** The side's point for the pointer: snapped, and on a 15° line from the vertex under Shift. */
  private sideAt(p: PointerInfo): Pt {
    const vertex = this.clicked[0];
    return p.shift && vertex ? snapAngle(vertex, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private clear(): void {
    this.clicked = [];
    this.live = null;
    this.frozen = false;
  }
}
