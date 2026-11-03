// Chamfer tool: cuts the corner between two straight lines with a straight line.
// Click the first line, then the second: the corner is the one the two clicks
// point into. Each line is trimmed back to its end of the cut, and the cut takes
// the first line's class and attributes. Tab opens the data bar for the two
// distances in mm, measured along each line from the corner; Esc drops the first
// line. Only straight lines for now: other objects are refused, and parallel lines
// have no corner. Its modes (1–3, see corner.ts) leave the lines as they are,
// split them at the cut's ends or trim them back to them.

import type { ObjectInfo, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { dataBar, type BarField, type BarStage, type BarValues } from "../databar.ts";
import { dist, intersectLines, linesParallel, unitVector, type LineSeg } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { cornerModes, isCornerMode, shapeCornerLine, type CornerMode } from "./corner.ts";

const DEFAULT_DISTANCE = 300;
const FIELD_D1: BarField = { key: "d1", label: "D1", digits: 2 };
const FIELD_D2: BarField = { key: "d2", label: "D2", digits: 2 };
const CHAMFER_STAGE: BarStage = { key: "chamfer", caption: "Chamfer", fields: [FIELD_D1, FIELD_D2] };

/** Lengths below this (document units) count as zero. */
const EPS = 1e-9;

/** A line picked in the drawing: its object, its end points, and the point clicked on it. */
interface Picked {
  readonly obj: ObjectInfo;
  readonly seg: LineSeg;
  readonly at: Pt;
}

export class ChamferTool extends BaseTool {
  readonly id = "chamfer";
  readonly cursor = "crosshair";

  /** distances in mm along the first and second line from the corner; typed values replace them once placed or entered */
  private d1 = DEFAULT_DISTANCE;
  private d2 = DEFAULT_DISTANCE;
  /** the first line by id, and the point clicked on it; null before the first click */
  private first: { readonly id: string; readonly at: Pt } | null = null;
  /** object under the pointer */
  private hover: string | null = null;
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  private readonly barHandlers = {
    commit: (values: BarValues) => this.onBarCommit(values),
    edit: () => this.env.requestDraw(),
  };

  private mode: CornerMode = "trim";

  modes(): ToolModes {
    return cornerModes("Chamfer", this.mode);
  }

  setMode(id: string): void {
    if (isCornerMode(id)) this.mode = id;
  }

  hint(): string {
    return this.first
      ? "Click the second line · Tab distances · Lines only"
      : "Click the first line · Tab distances · Lines only · 1–3 mode";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
    if (this.first && !this.firstLine()) this.first = null;
    const hit = this.pick(p.screen);
    if (!hit) return;
    if (!straightSeg(hit)) {
      toast("Chamfer works on straight lines only for now.", "info");
      return;
    }
    if (!this.first) {
      this.first = { id: hit.id, at: p.raw };
      return;
    }
    if (hit.id !== this.first.id) this.join(hit, p.raw);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
    this.hover = this.pick(p.screen)?.id ?? null;
  }

  cancel(): void {
    this.first = null;
    this.hover = null;
    this.pointer = null;
    dataBar.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key === "Tab") {
      if (!this.pointer) return false;
      dataBar.show();
      this.syncBar();
      return dataBar.focusField(e.shiftKey);
    }
    if (e.key === "Escape" && this.first !== null) {
      this.first = null;
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    dataBar.position(g.toScreen(p.pos), g);
    const hit = this.hover ? this.object(this.hover) : null;
    const hitSeg = hit ? straightSeg(hit) : null;
    const first = this.firstLine();
    if (!first) {
      if (hitSeg) highlight(g, () => strokeScreen(g, [hitSeg.a, hitSeg.b], false));
      return;
    }
    highlight(g, () => strokeScreen(g, [first.seg.a, first.seg.b], false));
    if (!hit || !hitSeg || hit.id === first.obj.id) return;
    highlight(g, () => strokeScreen(g, [hitSeg.a, hitSeg.b], false));
    const d = this.liveDistances();
    if (!d) return;
    const c = chamferLines(first.seg, first.at, hitSeg, p.raw, d.d1, d.d2);
    if (!c) return;
    withPreview(g, () => {
      if (this.mode !== "keep") {
        strokeScreen(g, [c.line1.a, c.line1.b], false);
        strokeScreen(g, [c.line2.a, c.line2.b], false);
      }
      strokeScreen(g, [c.a, c.b], false);
    });
  }

  /** Cuts the corner between the first line and `second`, which the click at `at` picked. */
  private join(second: ObjectInfo, at: Pt): void {
    const first = this.firstLine();
    const seg2 = straightSeg(second);
    const layerId = store.activeLayerId;
    if (!first || !seg2 || !layerId) return;
    const d = this.liveDistances();
    if (!d || !(d.d1 > 0) || !(d.d2 > 0)) {
      toast("Enter distances greater than 0.", "info");
      return;
    }
    if (linesParallel(first.seg.a, first.seg.b, seg2.a, seg2.b)) {
      toast("Lines are parallel", "info");
      return;
    }
    const c = chamferLines(first.seg, first.at, seg2, at, d.d1, d.d2);
    if (!c) {
      toast("The distances do not fit these lines.", "info");
      return;
    }
    // one undo step: the cut line is added, then each line as the mode says
    const cut = attempt("Chamfer", (s) =>
      s.batch(() => {
        const id = s.addObject(layerId, { kind: "line", a: c.a, b: c.b }, first.obj.classIndex, first.obj.attrs ?? undefined);
        shapeCornerLine(s, layerId, first.obj, first.seg, c.line1, this.mode);
        shapeCornerLine(s, layerId, second, seg2, c.line2, this.mode);
        return id;
      }),
    );
    if (!cut) return;
    setEditGroup(null, [cut.value]);
    this.first = null;
    this.adopt(d.d1, d.d2);
  }

  private onBarCommit(values: BarValues): void {
    const { d1, d2 } = values;
    if (!(d1 > 0) || !(d2 > 0)) {
      toast("Enter distances greater than 0.", "info");
      return;
    }
    this.adopt(d1, d2);
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Chamfer Preferences", [
      { kind: "length", key: "d1", label: "First line distance", value: this.d1 },
      { kind: "length", key: "d2", label: "Second line distance", value: this.d2 },
    ]);
    if (v) this.adopt(v.num("d1"), v.num("d2"));
  }

  /** Makes `d1` and `d2` the distances and drops any typed lock, so the bar shows them again. */
  private adopt(d1: number, d2: number): void {
    this.d1 = d1;
    this.d2 = d2;
    dataBar.update({ d1, d2 });
    dataBar.release();
  }

  /** The distances the bar holds: typed values while locked, else the stored ones. Null when a typed text is not a number. */
  private liveDistances(): { readonly d1: number; readonly d2: number } | null {
    const v = dataBar.resolve({ d1: this.d1, d2: this.d2 });
    return v ? { d1: v.d1, d2: v.d2 } : null;
  }

  private syncBar(): void {
    dataBar.setStage(CHAMFER_STAGE, this.barHandlers);
    dataBar.update({ d1: this.d1, d2: this.d2 });
    const p = this.pointer;
    if (p) dataBar.position(this.env.view.toScreen(p.pos), this.env.view);
  }

  /** Topmost object of the active layer under `screen`; contents of symbol instances are never picked. */
  private pick(screen: Pt): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], (o) => !isDerivedId(o.id));
  }

  private object(id: string): ObjectInfo | null {
    return store.session?.doc.object(id) ?? null;
  }

  /** The first line as it is now, or null when none is picked or it is gone or no longer straight. */
  private firstLine(): Picked | null {
    const pick = this.first;
    if (!pick) return null;
    const obj = this.object(pick.id);
    const seg = obj ? straightSeg(obj) : null;
    return obj && seg ? { obj, seg, at: pick.at } : null;
  }
}

/** The cut of a chamfer: its line and both lines trimmed to its ends. */
export interface Chamfer {
  /** the cut's ends: a on the first line, b on the second */
  readonly a: Pt;
  readonly b: Pt;
  /** each line with the end nearer the corner moved to its cut end; the far end is kept */
  readonly line1: LineSeg;
  readonly line2: LineSeg;
}

/**
 * Chamfer of two straight lines: a straight cut across their corner, `d1` along
 * the first line and `d2` along the second, both measured from the corner (where
 * the infinite lines meet). `click1` and `click2` (points on each line) choose the
 * part of each line the corner sits on. Null when the lines are parallel, a
 * distance is not positive, or a line would be trimmed to nothing.
 */
export function chamferLines(l1: LineSeg, click1: Pt, l2: LineSeg, click2: Pt, d1: number, d2: number): Chamfer | null {
  if (!(d1 > 0) || !(d2 > 0) || linesParallel(l1.a, l1.b, l2.a, l2.b)) return null;
  const u1 = unitVector(l1.a, l1.b);
  const u2 = unitVector(l2.a, l2.b);
  const corner = intersectLines(l1.a, u1, l2.a, u2);
  if (!corner) return null;
  // unit rays from the corner along each line, towards the clicked part
  const r1 = scaleBy(u1, dot(sub(click1, corner), u1) < 0 ? -1 : 1);
  const r2 = scaleBy(u2, dot(sub(click2, corner), u2) < 0 ? -1 : 1);
  const line1 = trimEnd(l1, corner, r1, d1);
  const line2 = trimEnd(l2, corner, r2, d2);
  if (dist(line1.a, line1.b) <= EPS || dist(line2.a, line2.b) <= EPS) return null;
  return { a: add(corner, scaleBy(r1, d1)), b: add(corner, scaleBy(r2, d2)), line1, line2 };
}

/**
 * `seg` with its end nearer the corner moved to the cut point `reach` along `dir`
 * from `corner`; the far end stays. When the segment does not reach that far, its
 * end nearer the cut point is moved there instead, so the line is extended to it
 * (as the fillet does).
 */
function trimEnd(seg: LineSeg, corner: Pt, dir: Pt, reach: number): LineSeg {
  const cut = add(corner, scaleBy(dir, reach));
  const sa = dot(sub(seg.a, corner), dir);
  const sb = dot(sub(seg.b, corner), dir);
  const aIsLow = sa < sb;
  const hi = aIsLow ? sb : sa;
  const replaceA = hi >= reach ? aIsLow : !aIsLow;
  return replaceA ? { a: cut, b: seg.b } : { a: seg.a, b: cut };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scaleBy(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

/** End points of a straight line object; null for anything else. */
function straightSeg(obj: ObjectInfo): LineSeg | null {
  const shape = obj.shape;
  if (shape?.kind !== "line" || shape.points.length < 2) return null;
  return { a: shape.points[0], b: shape.points[1] };
}

/** Solid accent outline of the line the tool is using or hovering over. */
function highlight(g: Painter, draw: () => void): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5;
  draw();
  ctx.restore();
}
