// Site model contour labels by hand: Add Contour Labels (a label wherever a line of clicks crosses a contour) and Edit
// Contour Labels, as Vectorworks' Reshape modes for them are: move a label along its contour, add one, or delete one.

import type { Pt } from "../../core/index.ts";
import { ACCENT } from "../renderer.ts";
import { labelLevels, labelWork, onContoursAt, setPlacedLabels, siteContourAt, takeLabelStart, type LabelWork } from "../siteModel.ts";
import { labelsAlong } from "../siteModelShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { modeForKey, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { OutlineTool } from "./planning.ts";

const ACTIONS = [
  { id: "move", label: "Move Label", key: "1" },
  { id: "add", label: "Add Label", key: "2" },
  { id: "delete", label: "Delete Label", key: "3" },
  { id: "along", label: "Add Along Line", key: "4" },
] as const;
type Action = (typeof ACTIONS)[number]["id"];

/** How close to a label or a contour a click counts, px. */
const REACH_PX = 10;
const HANDLE = 4;

export class SiteLabelTool extends OutlineTool {
  readonly id = "sitelabels";
  protected readonly modeLabel = "Line";
  private action: Action = "move";
  private work: LabelWork | null = null;
  private dragging: { index: number; at: Pt } | null = null;

  constructor(env: ToolEnv) {
    super(env);
    super.setMode("polygon");
    store.on("session", () => {
      this.work = null;
    });
  }

  modes(): readonly ToolModes[] {
    // the command that took up the tool says where it starts
    const along = takeLabelStart();
    if (along !== null) this.action = along ? "along" : "move";
    return [{ label: "Tool", options: ACTIONS.map((a) => ({ id: a.id, label: a.label, key: a.key })), active: this.action }];
  }

  setMode(id: string): void {
    if (ACTIONS.some((a) => a.id === id)) this.action = id as Action;
    this.dragging = null;
  }

  hint(): string {
    if (this.action === "along") return "Add Contour Labels: click along a line, a label where it crosses a contour · Enter finishes";
    if (this.action === "add") return "Click a contour to add a label · 1–4 mode";
    if (this.action === "delete") return "Click a label to delete it · 1–4 mode";
    return "Drag a label along its contour · 1–4 mode";
  }

  private current(): LabelWork | null {
    const doc = store.session?.doc;
    if (!doc) return null;
    this.work ??= labelWork(doc);
    return this.work;
  }

  private labelAt(w: LabelWork, p: PointerInfo): number {
    const reach = REACH_PX / this.env.view.scale;
    let best = -1;
    let least = reach;
    w.spots.forEach((q, i) => {
      const off = Math.hypot(q.x - p.pos.x, q.y - p.pos.y);
      if (off <= least) [best, least] = [i, off];
    });
    return best;
  }

  down(p: PointerInfo): void {
    if (this.action === "along") {
      super.down(p);
      return;
    }
    const w = this.current();
    if (!w) return;
    if (this.action === "add") {
      const found = siteContourAt(w.model, w.surface, p.pos, REACH_PX / this.env.view.scale);
      const at = found ? onContoursAt(w, found.level, p.pos) : null;
      if (!found || !at) {
        toast("Click on a contour.", "error");
        return;
      }
      setPlacedLabels("Add Contour Label", w.model.id, [...w.labels, { ...at, z: found.level }]);
      return;
    }
    const index = this.labelAt(w, p);
    if (index < 0) {
      toast("Click on a label's handle.", "error");
      return;
    }
    if (this.action === "delete") setPlacedLabels("Delete Contour Label", w.model.id, w.labels.filter((_, i) => i !== index));
    else this.dragging = { index, at: w.spots[index] };
  }

  move(p: PointerInfo): void {
    super.move(p);
    const w = this.work;
    if (!this.dragging || !w) return;
    this.dragging.at = onContoursAt(w, w.labels[this.dragging.index].z, p.pos) ?? this.dragging.at;
  }

  up(p: PointerInfo): void {
    if (this.action === "along") {
      super.up(p);
      return;
    }
    const drag = this.dragging;
    const w = this.work;
    this.dragging = null;
    if (!drag || !w) return;
    const at = onContoursAt(w, w.labels[drag.index].z, p.pos);
    if (at) setPlacedLabels("Move Contour Label", w.model.id, w.labels.map((l, i) => (i === drag.index ? { ...at, z: l.z } : l)));
  }

  cancel(): void {
    this.dragging = null;
    super.cancel();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.dragging) {
      this.dragging = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  overlay(g: Painter): void {
    super.overlay(g);
    const w = this.current();
    if (!w) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    w.spots.forEach((spot, i) => {
      const q = g.toScreen(this.dragging?.index === i ? this.dragging.at : spot);
      ctx.fillRect(q.x - HANDLE, q.y - HANDLE, HANDLE * 2, HANDLE * 2);
      ctx.strokeRect(q.x - HANDLE, q.y - HANDLE, HANDLE * 2, HANDLE * 2);
    });
    ctx.restore();
  }

  protected made(corners: Pt[]): void {
    if (corners.length < 2) return;
    const w = this.current();
    if (!w) return;
    const added = labelsAlong(w.surface, labelLevels(w), corners);
    if (!added.length) {
      toast("That line doesn't cross a contour.", "error");
      return;
    }
    setPlacedLabels("Add Contour Labels", w.model.id, [...w.labels, ...added]);
    toast(added.length === 1 ? "1 contour label added." : `${added.length} contour labels added.`, "info");
  }
}
