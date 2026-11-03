// Stage Origin: click where the centre line crosses the plaster line, then a point upstage. It draws the
// two lines with their labels and saves the frame (show.ts), which Stage's other tools measure from.
// With Stage > Show Stage Coordinates on, foot marks run along the two lines and the pointer's place
// reads in stage terms in the drawing's corner.

import { appContext, onReady, registerOverlay } from "../../app/ext.ts";
import { attempt } from "../../app/commands.ts";
import type { Part } from "../../app/tools/detailing.ts";
import { addPieces, layerScale, preview } from "../../app/tools/detailing.ts";
import { markerParts } from "../../app/tools/markers.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { toolPrefs } from "../../app/toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../../app/tools.ts";
import { formatLength } from "../../app/units.ts";
import type { Pt } from "../../core/index.ts";
import { readShow, writeShowIn } from "./show.ts";
import { DEFAULT_STAGE, fromStage, STAGE_KEY, stageText, toStage, type StageFrame } from "./stage.ts";

/** The drawing's stage frame, set or the stand-in. */
export function stageFrame(): StageFrame {
  return readShow<StageFrame>(STAGE_KEY, DEFAULT_STAGE);
}

/** Whether the drawing has had its stage origin set. */
export function hasStageFrame(): boolean {
  return readShow<StageFrame | null>(STAGE_KEY, null) !== null;
}

/** A length in the drawing's units. */
export function lengthText(mm: number): string {
  return formatLength(mm, store.session?.doc.info.units);
}

/** The pointer's place in stage terms for a tool's hint: "1.20 m SL · 3.00 m US". */
export function stageHint(p: Pt): string {
  return stageText(toStage(stageFrame(), p), lengthText);
}

let showCoordinates = false;
let pointer: Pt | null = null;

export const stageCoordinates = {
  on: (): boolean => showCoordinates,
  toggle(): void {
    showCoordinates = !showCoordinates;
    appContext()?.requestDraw();
  },
};

/** the lines' labels on paper, mm */
const LABEL_MM = 3.5;

/** The lines and labels of a frame, as drawing parts. */
function originParts(f: StageFrame, lengthMm: number, widthMm: number, scale: number): Part[] {
  const a = fromStage(f, { across: 0, up: -lengthMm * 0.1 });
  const b = fromStage(f, { across: 0, up: lengthMm * 0.9 });
  const c = fromStage(f, { across: -widthMm / 2, up: 0 });
  const d = fromStage(f, { across: widthMm / 2, up: 0 });
  const text = LABEL_MM * scale;
  return markerParts({
    outlines: [],
    lines: [
      [a, b],
      [c, d],
    ],
    circles: [],
    filled: [],
    texts: [
      { at: fromStage(f, { across: 0, up: lengthMm * 0.9 + text * 1.4 }), text: "CL", height: text, justify: "centre" },
      { at: fromStage(f, { across: widthMm / 2 + text * 1.2, up: 0 }), text: "PL", height: text, justify: "centre" },
    ],
  });
}

export class StageOriginTool extends BaseTool {
  readonly id = "stageorigin";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private cursorAt: Pt | null = null;
  private lengthMm = 12000;
  private widthMm = 20000;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Stage Origin Preferences",
      [
        { kind: "length", key: "length", label: "Centre Line Length", value: this.lengthMm },
        { kind: "length", key: "width", label: "Plaster Line Length", value: this.widthMm },
      ],
      "Click where the centre line crosses the plaster line, then click a point upstage. Rodeo draws the two lines and measures Stage's tools and paperwork from them: stage left and right of the centre line, up and down of the plaster line.",
    );
    if (!v) return;
    this.lengthMm = v.num("length");
    this.widthMm = v.num("width");
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from ? "Click a point upstage of the plaster line · Esc cancels" : "Click where the centre line crosses the plaster line";
  }

  private frame(a: Pt, b: Pt): StageFrame {
    const far = Math.hypot(b.x - a.x, b.y - a.y) > 1e-6;
    return { x: a.x, y: a.y, upDeg: far ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : 90 };
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (!this.from) {
      this.from = p.pos;
      return;
    }
    const scale = layerScale(this.env);
    if (scale === null) {
      toast("Make a design layer active to set the stage origin.", "info");
      return;
    }
    const frame = this.frame(this.from, p.pos);
    this.from = null;
    addPieces("Stage Origin", [originParts(frame, this.lengthMm, this.widthMm, scale)], "Stage Origin");
    attempt("Stage Origin", (s) => s.batch(() => writeShowIn(s, STAGE_KEY, frame)));
    toast("Stage origin set. Stage > Show Stage Coordinates reads the pointer's place from it.", "info");
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.from = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.from) return false;
    this.from = null;
    return true;
  }

  overlay(g: Painter): void {
    if (!this.from || !this.cursorAt) return;
    preview(g, originParts(this.frame(this.from, this.cursorAt), this.lengthMm, this.widthMm, layerScale(this.env) ?? 1));
  }
}

/** A round spacing for foot marks, near `wanted` mm: metres or feet by the drawing's units. */
function markStep(wanted: number): number {
  const imperial = /ft|feet|inch|"|'/i.test(store.session?.doc.info.units ?? "");
  const unit = imperial ? 304.8 : 1000;
  for (const n of [1, 2, 5, 10, 20, 50]) if (n * unit >= wanted) return n * unit;
  return 100 * unit;
}

function drawCoordinates(g: Painter): void {
  if (!showCoordinates || !store.session) return;
  const f = stageFrame();
  const ctx = g.ctx;
  const step = markStep(40 / g.scale);
  const reach = 200;
  ctx.font = "10px var(--font, sans-serif)";
  ctx.lineWidth = 1;
  ctx.strokeStyle = ctx.fillStyle = "rgba(43, 153, 255, 0.9)";
  const mark = (a: Pt, b: Pt, label: string, at: Pt): void => {
    const p = g.toScreen(a);
    const q = g.toScreen(b);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    const t = g.toScreen(at);
    ctx.fillText(label, t.x, t.y);
  };
  const tick = 6 / g.scale;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = -reach; i <= reach; i++) {
    const d = i * step;
    if (i !== 0) {
      mark(fromStage(f, { across: d, up: -tick }), fromStage(f, { across: d, up: tick }), lengthText(Math.abs(d)), fromStage(f, { across: d, up: -tick * 3 }));
      if (i > 0) mark(fromStage(f, { across: -tick, up: d }), fromStage(f, { across: tick, up: d }), lengthText(d), fromStage(f, { across: tick * 5, up: d }));
    }
  }
  if (!pointer) return;
  // beside the pointer, as the app's own readouts sit over the canvas's corners
  const text = stageText(toStage(f, pointer), lengthText);
  ctx.font = "12px var(--font, sans-serif)";
  ctx.textAlign = "left";
  const w = ctx.measureText(text).width + 16;
  const at = g.toScreen(pointer);
  const x = at.x + 16 + w > g.width ? at.x - 16 - w : at.x + 16;
  const y = at.y + 38 > g.height ? at.y - 38 : at.y + 16;
  ctx.fillStyle = "#1d1d1d";
  ctx.fillRect(x, y, w, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 8, y + 11);
}

registerOverlay(drawCoordinates);

onReady((ctx) => {
  ctx.canvas.addEventListener("pointermove", (e) => {
    if (!showCoordinates) return;
    const r = ctx.canvas.getBoundingClientRect();
    pointer = ctx.view.toWorld(e.clientX - r.left, e.clientY - r.top);
    ctx.requestDraw();
  });
});
