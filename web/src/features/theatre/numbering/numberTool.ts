// Spotlight Numbering's Manual direction (and numbering with nothing selected): a click on an object of
// the type gives it the next values, each click its own undo step; a Shift-click gives the values the
// last click gave, without counting on. A double-click on empty space, Enter or Esc ends, the objects
// numbered then selected. The type's object under the pointer is outlined with the values it would take.

import type { BBox, Pt } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../../../app/tools.ts";
import { sequence } from "./numberingShapes.ts";
import { clickNumbering, footprintOf, numberTypes, universeOf, valuesAt, writeNumbers, type NumberingRun } from "./numbering.ts";

/** how near the pointer an object's box counts as under it, px */
const NEAR_PX = 4;

interface Clicking {
  readonly run: NumberingRun;
  /** the type's objects when the numbering began */
  readonly ids: ReadonlySet<string>;
  /** the objects that have counted the numbering on, in turn, and their footprints */
  readonly counted: string[];
  readonly prints: number[];
  /** every object numbered, for the selection at the end */
  readonly numbered: string[];
  /** what the last click gave, for a Shift-click */
  last: Record<string, string | number | boolean> | null;
}

let clicking: Clicking | null = null;

clickNumbering.start = (run) => {
  const ids = new Set(numberTypes().find((t) => t.type.key === run.type.key)?.ids ?? []);
  clicking = { run, ids, counted: [], prints: [], numbered: [], last: null };
  appContext()?.show2d();
  appContext()?.setTool("spotnumber");
};

/** The values the next object counted on takes (`id` that object), or null past a Stop at limit. */
function nextValues(c: Clicking, id: string): Record<string, string | number | boolean> | null {
  const prints = c.run.fields.some((f) => f.o.footprint) ? [...c.prints, footprintOf(id)] : [];
  const k = c.counted.length;
  const seqs = c.run.fields.map((f) => sequence(f.o, k + 1, prints, universeOf(c.counted[0] ?? id)));
  return seqs.some((q) => q.stopped !== null) ? null : valuesAt(c.run, seqs, k);
}

const shown = (values: Record<string, string | number | boolean>, c: Clicking): string => c.run.fields.map((f) => `${f.field.label} ${values[f.field.name]}`).join(", ");

export class SpotNumberTool extends BaseTool {
  readonly id = "spotnumber";
  readonly cursor = "crosshair";
  private pointer: { at: Pt; shift: boolean } | null = null;

  hint(): string {
    const c = clicking;
    if (!c) return "Spotlight Numbering: choose Stage > Lighting > Spotlight Numbering… first";
    return `Spotlight Numbering: click the ${c.run.type.label} objects in turn · Shift-click gives the last values again · double-click empty space, Enter or Esc ends`;
  }

  /** The object of the type under `p`, the smallest when boxes overlap. */
  private objectAt(p: Pt): { id: string; box: BBox } | null {
    const c = clicking;
    const doc = store.session?.doc;
    const scene = appContext()?.scene;
    if (!c || !doc || !scene) return null;
    const near = NEAR_PX / Math.max(this.env.view.scale, 1e-9);
    let best: { id: string; box: BBox; area: number } | null = null;
    for (const layer of doc.layers()) {
      if (layer.kind !== "design" || layer.visibility === "hidden") continue;
      for (const e of scene.topLevelEntries(layer.id, null)) {
        const b = e.bbox;
        if (!b || !e.visible || !c.ids.has(e.id)) continue;
        if (p.x < b.x0 - near || p.x > b.x1 + near || p.y < b.y0 - near || p.y > b.y1 + near) continue;
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (!best || area < best.area) best = { id: e.id, box: b, area };
      }
    }
    return best && { id: best.id, box: best.box };
  }

  move(p: PointerInfo): void {
    this.pointer = { at: p.raw, shift: p.shift };
  }

  down(p: PointerInfo): void {
    const c = clicking;
    if (!c || p.button !== 0) return;
    const hit = this.objectAt(p.raw);
    if (!hit) {
      if (p.detail >= 2) this.finish();
      return;
    }
    const again = p.shift && c.last;
    const values = again ? c.last : nextValues(c, hit.id);
    if (!values) {
      toast("Spotlight Numbering: the Stop at limit is reached.", "info");
      this.finish();
      return;
    }
    const r = attempt("Spotlight Numbering", (s) => s.batch(() => writeNumbers(s, c.run.type, hit.id, values)));
    if (!r) return;
    if (!again) {
      c.counted.push(hit.id);
      c.prints.push(footprintOf(hit.id));
    }
    c.last = values;
    if (!c.numbered.includes(hit.id)) c.numbered.push(hit.id);
    this.env.requestDraw();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" && e.key !== "Enter") return false;
    this.finish();
    return true;
  }

  cancel(): void {
    clicking = null;
  }

  /** Ends the numbering: the objects numbered are selected, and the Selection tool is back. */
  private finish(): void {
    const c = clicking;
    clicking = null;
    if (c?.numbered.length) {
      setSelection(c.numbered);
      toast(`Numbered ${c.numbered.length} ${c.run.type.label} object${c.numbered.length === 1 ? "" : "s"}.`, "info");
    }
    appContext()?.setTool("select");
  }

  overlay(g: Painter): void {
    const c = clicking;
    const p = this.pointer;
    if (!c || !p) return;
    const hit = this.objectAt(p.at);
    if (!hit) return;
    const b = hit.box;
    withPreview(g, () => strokeScreen(g, [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }], true));
    const values = p.shift && c.last ? c.last : nextValues(c, hit.id);
    const at = g.toScreen({ x: b.x1, y: b.y1 });
    const { ctx } = g;
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    const text = values ? shown(values, c) : "Stop at limit reached";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(at.x + 4, at.y - 18, w, 16);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(text, at.x + 8, at.y - 6);
    ctx.restore();
  }
}
