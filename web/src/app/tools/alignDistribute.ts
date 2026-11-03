// Lighting's Align and Distribute (in Rigging here): with lighting devices or other objects
// selected, click the guide line's start and its end (Shift in 45° steps) and the selection moves
// onto it, each object by its insertion point (symbols and plug-in objects) or the middle of its
// box. Align moves each straight across onto the line (or the line run on past its ends), keeping
// their order and spacing along it. Distribute lays them along the line in their order along it
// (ties from the top of the screen down): Evenly between points puts the first at the start and the
// last at the end, Evenly inside points leaves a space at each end as between them, At Interval
// steps them the Interval (Preferences) apart from the start. One undo step; the selection and the
// tool stay. Esc starts over.

import type { Pt } from "../../core/index.ts";
import { attempt, selectionEntries } from "../commands.ts";
import { constrainAngle, dist } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { drawMarker, mapOutlines, selectionOutlines, selectionUnchanged } from "./rotate.ts";

const MIN_WORLD = 1e-9;

export type AlignMode = "align" | "distribute";
export type Spread = "between" | "inside" | "interval";

const MODES: readonly { readonly id: AlignMode; readonly label: string }[] = [
  { id: "align", label: "Align" },
  { id: "distribute", label: "Distribute" },
];
const SPREADS: readonly { readonly id: Spread; readonly label: string }[] = [
  { id: "between", label: "Evenly between points" },
  { id: "inside", label: "Evenly inside points" },
  { id: "interval", label: "At Interval" },
];

/** An object to move: its id and the point it moves by. */
export interface AlignItem {
  readonly id: string;
  readonly at: Pt;
}

/**
 * Where each item's point goes on the guide line from `a` to `b`, by id: Align moves each square onto
 * the line, Distribute lays them along it by `spread` (`interval` apart for At Interval).
 */
export function alignTargets(items: readonly AlignItem[], a: Pt, b: Pt, mode: AlignMode, spread: Spread, interval: number): Map<string, Pt> {
  const len = dist(a, b);
  const out = new Map<string, Pt>();
  if (len < MIN_WORLD || items.length === 0) return out;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const along = (p: Pt): number => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  const on = (t: number): Pt => ({ x: a.x + u.x * t, y: a.y + u.y * t });
  if (mode === "align") {
    for (const it of items) out.set(it.id, on(along(it.at)));
    return out;
  }
  // their order along the line, then from the top of the screen down, then left to right
  const order = [...items].sort((p, q) => along(p.at) - along(q.at) || q.at.y - p.at.y || p.at.x - q.at.x);
  const n = order.length;
  order.forEach((it, i) => {
    const t = spread === "interval" ? i * interval : spread === "inside" ? ((i + 1) * len) / (n + 1) : n === 1 ? 0 : (i * len) / (n - 1);
    out.set(it.id, on(t));
  });
  return out;
}

export class AlignDistributeTool extends BaseTool {
  readonly id = "aligndistribute";
  readonly cursor = "crosshair";

  private mode: AlignMode = "distribute";
  private spread: Spread = "between";
  /** At Interval's spacing, mm */
  private interval = 500;
  /** the guide line's start; null before the first click */
  private first: Pt | null = null;
  /** its end under the pointer, Shift-constrained */
  private end: Pt | null = null;
  /** the selection when the guide line was started; a change under it drops the line */
  private ids: readonly string[] = [];

  modes(): readonly ToolModes[] {
    return [
      { label: "Mode", options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode },
      { label: "Distribute", options: SPREADS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 3) })), active: this.spread },
    ];
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m.id === id);
    if (mode) this.mode = mode.id;
    const spread = SPREADS.find((m) => m.id === id);
    if (spread) {
      // choosing how to distribute chooses Distribute
      this.spread = spread.id;
      this.mode = "distribute";
    }
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Align and Distribute Preferences",
      [{ kind: "length", key: "interval", label: "Interval", value: this.interval }],
      "How far apart At Interval sets the selected objects along the guide line, from its start.",
    );
    if (v) this.interval = v.num("interval");
  }

  hint(): string {
    if (store.selection.size === 0) return "Select the lighting devices or other objects to align first";
    const how = this.mode === "align" ? "Align" : SPREADS.find((m) => m.id === this.spread)!.label;
    if (!this.first) return `Click to start the guide line · ${how} · 1–2 mode · 3–5 distribute`;
    return "Click to end the guide line · Shift 45°";
  }

  down(p: PointerInfo): void {
    this.sync();
    if (p.button !== 0 || store.selection.size === 0) return;
    if (!this.first) {
      this.first = p.pos;
      this.end = p.pos;
      this.ids = [...store.selection];
      return;
    }
    const a = this.first;
    const b = p.shift ? constrainAngle(a, p.pos) : p.pos;
    if (dist(a, b) < MIN_WORLD) return;
    if (this.mode === "distribute" && this.spread === "interval" && !(this.interval > 0)) {
      toast("Set an Interval over 0 in Align and Distribute Preferences.", "info");
      return;
    }
    const items = this.items();
    const targets = alignTargets(items, a, b, this.mode, this.spread, this.interval);
    const moves = items.flatMap((it) => {
      const to = targets.get(it.id);
      return to && dist(to, it.at) > MIN_WORLD ? [{ id: it.id, dx: to.x - it.at.x, dy: to.y - it.at.y }] : [];
    });
    if (moves.length) {
      attempt(this.mode === "align" ? "Align" : "Distribute", (s) =>
        s.batch(() => {
          for (const m of moves) s.moveObjects([m.id], m.dx, m.dy);
        }),
      );
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
    const items = this.items();
    const targets = alignTargets(items, a, b, this.mode, this.spread, this.interval);
    withPreview(g, () => {
      strokeScreen(g, [a, b], false);
      for (const it of items) {
        const to = targets.get(it.id);
        if (!to) continue;
        const m = { a: 1, b: 0, c: 0, d: 1, e: to.x - it.at.x, f: to.y - it.at.y };
        for (const line of mapOutlines(selectionOutlines(this.env.scene, [it.id]), m)) strokeScreen(g, line, false);
      }
    });
    drawMarker(g, a);
  }

  /** The selected objects and the points they move by: an insertion point, or the middle of the box. */
  private items(): AlignItem[] {
    const doc = store.session?.doc;
    return selectionEntries(this.env.scene).map((e) => ({
      id: e.id,
      at: doc?.object(e.id)?.insertion ?? { x: (e.box.x0 + e.box.x1) / 2, y: (e.box.y0 + e.box.y1) / 2 },
    }));
  }

  /** Drops the guide line when the selection changed under it. */
  private sync(): void {
    if (this.first && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    this.first = null;
    this.end = null;
    this.ids = [];
  }
}
