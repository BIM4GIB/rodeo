// Fillet tool: rounds the corner between two straight lines with an arc of a set
// radius and trims both lines back to the arc's tangent points. Click the first
// line, then the second: the corner is the one the two clicks point into. The arc
// takes the first line's class and attributes. Tab opens the data bar for the
// radius in mm; Esc drops the first line. Only straight lines for now: other
// objects are refused, and parallel lines have no corner. Its modes (1–3, see
// corner.ts) leave the lines as they are, split them at the tangent points or
// trim them back to them; each fillet is one undo step.

import type { ObjectInfo, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { dataBar, FIELD_RADIUS, type BarStage, type BarValues } from "../databar.ts";
import { filletRadius, setFilletRadius } from "../filletRadius.ts";
import { ellipsePoints, filletLines, linesParallel, type LineSeg } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { cornerModes, isCornerMode, shapeCornerLine, type CornerMode } from "./corner.ts";

const FILLET_STAGE: BarStage = { key: "fillet", caption: "Fillet", fields: [FIELD_RADIUS] };
const ARC_STEP_DEG = 2;
const MIN_ARC_STEPS = 16;

/** A line picked in the drawing: its object, its end points, and the point clicked on it. */
interface Picked {
  readonly obj: ObjectInfo;
  readonly seg: LineSeg;
  readonly at: Pt;
}

export class FilletTool extends BaseTool {
  readonly id = "fillet";
  readonly cursor = "crosshair";

  /** radius in mm, shared with Join and Fillet; a typed value replaces it once it is placed or entered */
  private get radius(): number {
    return filletRadius();
  }
  private set radius(r: number) {
    setFilletRadius(r);
  }
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
    return cornerModes("Fillet", this.mode);
  }

  setMode(id: string): void {
    if (isCornerMode(id)) this.mode = id;
  }

  hint(): string {
    return this.first
      ? "Click the second line · Tab radius · Lines only"
      : "Click the first line · Tab radius · Lines only · 1–3 mode";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    dataBar.show();
    this.syncBar();
    if (this.first && !this.firstLine()) this.first = null;
    const hit = this.pick(p.screen);
    if (!hit) return;
    if (!straightSeg(hit)) {
      toast("Fillet works on straight lines only for now.", "info");
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
    const r = this.liveRadius();
    if (r === null || !(r > 0)) return;
    const f = filletLines(first.seg, first.at, hitSeg, p.raw, r);
    if (!f) return;
    withPreview(g, () => {
      if (this.mode !== "keep") {
        strokeScreen(g, [f.line1.a, f.line1.b], false);
        strokeScreen(g, [f.line2.a, f.line2.b], false);
      }
      strokeScreen(
        g,
        ellipsePoints(f.centre, f.radius, f.radius, f.startAngle, f.sweepAngle, arcSteps(f.sweepAngle)),
        false,
      );
    });
  }

  /** Rounds the corner between the first line and `second`, which the click at `at` picked. */
  private join(second: ObjectInfo, at: Pt): void {
    const first = this.firstLine();
    const seg2 = straightSeg(second);
    const layerId = store.activeLayerId;
    if (!first || !seg2 || !layerId) return;
    const r = this.liveRadius();
    if (r === null || !(r > 0)) {
      toast("Enter a radius greater than 0.", "info");
      return;
    }
    if (linesParallel(first.seg.a, first.seg.b, seg2.a, seg2.b)) {
      toast("Lines are parallel", "info");
      return;
    }
    const f = filletLines(first.seg, first.at, seg2, at, r);
    if (!f) {
      toast("The radius does not fit these lines.", "info");
      return;
    }
    // one undo step: the arc, then each line as the mode says
    const arc = attempt("Fillet", (s) =>
      s.batch(() => {
        const id = s.addObject(
          layerId,
          { kind: "arc", center: f.centre, radius: f.radius, startAngle: f.startAngle, sweepAngle: f.sweepAngle },
          first.obj.classIndex,
          first.obj.attrs ?? undefined,
        );
        shapeCornerLine(s, layerId, first.obj, first.seg, f.line1, this.mode);
        shapeCornerLine(s, layerId, second, seg2, f.line2, this.mode);
        return id;
      }),
    );
    if (!arc) return;
    setEditGroup(null, [arc.value]);
    this.first = null;
    this.adopt(r);
  }

  private onBarCommit(values: BarValues): void {
    const r = values.radius;
    if (!(r > 0)) {
      toast("Enter a radius greater than 0.", "info");
      return;
    }
    this.adopt(r);
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Fillet Preferences", [{ kind: "length", key: "radius", label: "Radius", value: this.radius }]);
    if (v) this.adopt(v.num("radius"));
  }

  /** Makes `r` the radius and drops any typed lock, so the bar shows it again. */
  private adopt(r: number): void {
    this.radius = r;
    dataBar.update({ radius: r });
    dataBar.release();
  }

  /** The radius the bar holds: a typed value while one is locked, else the stored one. Null when the typed text is not a number. */
  private liveRadius(): number | null {
    return dataBar.resolve({ radius: this.radius })?.radius ?? null;
  }

  private syncBar(): void {
    dataBar.setStage(FILLET_STAGE, this.barHandlers);
    dataBar.update({ radius: this.radius });
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

/** End points of a straight line object; null for anything else. */
function straightSeg(obj: ObjectInfo): LineSeg | null {
  const shape = obj.shape;
  if (shape?.kind !== "line" || shape.points.length < 2) return null;
  return { a: shape.points[0], b: shape.points[1] };
}

function arcSteps(sweepDeg: number): number {
  return Math.max(MIN_ARC_STEPS, Math.ceil(Math.abs(sweepDeg) / ARC_STEP_DEG));
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
