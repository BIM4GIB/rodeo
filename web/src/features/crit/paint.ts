// Draws crit mode over the 2D drawing: numbered pins, the redlines of the
// threads on the active layer, and the drafts being made. It draws on its own
// canvas above the drawing (so View > Dark Canvas, which inverts the drawing's
// canvas, leaves the colours of the comments as chosen), and answers the hit
// tests of pin clicks.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import type { Painter } from "../../app/tools.ts";
import type { Pt } from "../../core/index.ts";
import type { Anchor, Stroke } from "../../platform/protocol.ts";
import { repositionPopover } from "./popover.ts";
import { crit, STROKE_WIDTH_PX, type Thread } from "./state.ts";

const ACCENT = "#2f6fdb";
const GREY = "#8d8d93";
const HEAD_R = 10;
/** the head of a pin sits this far above its point */
const HEAD_LIFT = 16;
const TAU = Math.PI * 2;
const FONT = "600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

let layer: HTMLCanvasElement | null = null;

/** Adds the crit canvas over the drawing (called once the editor runs), and redraws it whenever crit state changes. */
export function mountPaint(frame: HTMLElement): void {
  layer = h("canvas", { cls: "crit-canvas", attrs: { "aria-hidden": "true" } });
  frame.append(layer);
  crit.subscribe(() => appContext()?.requestDraw());
}

/** Whether `a` is a pin on the active 2D layer, the only pins the drawing shows. */
function onActiveLayer(a: Anchor | null): a is Extract<Anchor, { kind: "2d" }> {
  return !!a && a.kind === "2d" && a.layerId === store.activeLayerId;
}

/** The screen point of a pin's tip (where the tail ends) and of its head's centre. */
function pinPoints(p: Painter, a: Extract<Anchor, { kind: "2d" }>): { tip: Pt; head: Pt } {
  const tip = p.toScreen({ x: a.x, y: a.y });
  return { tip, head: { x: tip.x, y: tip.y - HEAD_LIFT } };
}

/** The thread whose pin is at `screen` (within 10 px of its head or its tip), or null. */
export function threadAt(screen: Pt): Thread | null {
  const ctx = appContext();
  if (!ctx || store.view3d) return null;
  let best: Thread | null = null;
  let bestD = 10;
  for (const t of crit.threads()) {
    if (!onActiveLayer(t.root.anchor)) continue;
    const tip = ctx.view.toScreen({ x: t.root.anchor.x, y: t.root.anchor.y });
    const head = { x: tip.x, y: tip.y - HEAD_LIFT };
    const d = Math.min(Math.hypot(screen.x - head.x, screen.y - head.y), Math.hypot(screen.x - tip.x, screen.y - tip.y));
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function strokePath(c: CanvasRenderingContext2D, p: Painter, s: Stroke | { points: readonly (readonly [number, number])[] }): void {
  c.beginPath();
  s.points.forEach((pt, i) => {
    const q = p.toScreen({ x: pt[0], y: pt[1] });
    if (i === 0) c.moveTo(q.x, q.y);
    else c.lineTo(q.x, q.y);
  });
  // a single point is a dot: a zero-length line with round caps
  if (s.points.length === 1) {
    const q = p.toScreen({ x: s.points[0][0], y: s.points[0][1] });
    c.lineTo(q.x, q.y);
  }
  c.stroke();
}

function drawRedline(c: CanvasRenderingContext2D, p: Painter, s: Stroke, alpha: number, selected: boolean): void {
  c.lineJoin = "round";
  c.lineCap = "round";
  if (selected) {
    // a soft halo under the selected thread's redline
    c.globalAlpha = alpha * 0.22;
    c.strokeStyle = s.color;
    c.lineWidth = s.width + 6;
    strokePath(c, p, s);
  }
  c.globalAlpha = alpha;
  c.strokeStyle = s.color;
  c.lineWidth = s.width;
  strokePath(c, p, s);
  c.globalAlpha = 1;
}

function drawPin(c: CanvasRenderingContext2D, p: Painter, a: Extract<Anchor, { kind: "2d" }>, label: string, opts: { colour: string; alpha: number; selected: boolean; dashed?: boolean }): void {
  const { tip, head } = pinPoints(p, a);
  c.globalAlpha = opts.alpha;
  // the tail from the head down to the point it marks
  c.strokeStyle = opts.colour;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(tip.x, tip.y);
  c.lineTo(head.x, head.y + HEAD_R - 2);
  c.stroke();
  c.beginPath();
  c.arc(tip.x, tip.y, 2.5, 0, TAU);
  c.fillStyle = opts.colour;
  c.fill();
  if (opts.selected) {
    c.beginPath();
    c.arc(head.x, head.y, HEAD_R + 4, 0, TAU);
    c.strokeStyle = "rgba(47, 111, 219, 0.45)";
    c.lineWidth = 3;
    c.stroke();
  }
  c.beginPath();
  c.arc(head.x, head.y, HEAD_R, 0, TAU);
  c.fillStyle = opts.colour;
  c.fill();
  c.strokeStyle = "#ffffff";
  c.lineWidth = 1.5;
  if (opts.dashed) c.setLineDash([3, 2]);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = "#ffffff";
  c.font = FONT;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, head.x, head.y + 0.5);
  c.globalAlpha = 1;
}

function draw(c: CanvasRenderingContext2D, p: Painter): void {
  const threads = crit.threads();
  const selected = crit.selected;
  // redlines of the threads on this layer, then the ones being drawn
  for (const t of threads) {
    const dim = t.root.resolved ? 0.4 : 0.95;
    for (const s of t.root.strokes) {
      if (s.layerId === store.activeLayerId) drawRedline(c, p, s, dim, t.root.id === selected);
    }
  }
  for (const s of crit.strokes) {
    if (s.layerId === store.activeLayerId) drawRedline(c, p, s, 0.95, false);
  }
  const drawing = crit.stroke;
  if (drawing && drawing.layerId === store.activeLayerId) {
    drawRedline(c, p, { layerId: drawing.layerId, points: drawing.points, color: drawing.colour, width: STROKE_WIDTH_PX }, 0.95, false);
  }
  // pins
  for (const t of threads) {
    const a = t.root.anchor;
    if (!onActiveLayer(a)) continue;
    drawPin(c, p, a, String(t.number), {
      colour: t.root.resolved ? GREY : ACCENT,
      alpha: t.root.resolved ? 0.85 : 1,
      selected: t.root.id === selected,
    });
  }
  // the pin being placed
  const draft = crit.pinDraft;
  if (onActiveLayer(draft)) {
    drawPin(c, p, draft, String(threads.length + 1), { colour: ACCENT, alpha: 0.55, selected: false, dashed: true });
  }
}

/** The overlay: draws crit mode on its canvas, and keeps an open popover beside its anchor. */
export function paintCrit(p: Painter): void {
  const canvas = layer;
  if (!canvas) return;
  const on = crit.active && !store.view3d;
  canvas.style.display = on ? "" : "none";
  if (on) {
    const dpr = p.ctx.canvas.width / p.width;
    const w = Math.round(p.width * dpr);
    const h = Math.round(p.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const c = canvas.getContext("2d");
    if (c) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(c, p);
    }
  }
  repositionPopover();
}
