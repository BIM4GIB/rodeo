// Stage > Spike Mark (on the toolbar): a click drops a small L of tape where the pointer is, with its number
// and its place in stage terms beside it, in the current scene's colour when there is one. Each mark is a
// group named "Spike n" on the active design layer, one undo step.

import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { addPieces, preview, type Part } from "../../../app/tools/detailing.ts";
import { BaseTool, type Painter, type PointerInfo } from "../../../app/tools.ts";
import type { Attributes, NewShape, Pt } from "../../../core/index.ts";
import { colorOf } from "../gels.ts";
import { fromStage, stageText, toStage, type StagePoint } from "../stage.ts";
import { lengthText, stageFrame, stageHint } from "../stageTool.ts";
import { currentScene, sceneData } from "./scenesData.ts";

const SPIKE_NAME = /^Spike (\d+)$/;

/** The next spike's number: one more than the highest "Spike n" in the drawing. */
function nextNumber(): number {
  const doc = store.session?.doc;
  if (!doc) return 1;
  let top = 0;
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      const m = SPIKE_NAME.exec(o.name ?? "");
      if (m) top = Math.max(top, Number(m[1]));
    }
  }
  return top + 1;
}

/** The L of tape at drawing point `at`: arms of `arm` mm running upstage and stage left from it. */
function legsAt(at: Pt, arm: number): Pt[] {
  const f = stageFrame();
  const s = toStage(f, at);
  return [fromStage(f, { across: s.across, up: s.up + arm }), at, fromStage(f, { across: s.across + arm, up: s.up })];
}

/** The mark's parts: the tape, its number and its stage place, in `attrs` when there are some. */
function markParts(at: Pt, n: number, arm: number, textMm: number, attrs: Partial<Attributes> | undefined): Part[] {
  const f = stageFrame();
  const s: StagePoint = toStage(f, at);
  const beside = (across: number, up: number): Pt => fromStage(f, { across: s.across + across, up: s.up + up });
  const note = stageText(s, lengthText);
  const shapes: NewShape[] = [
    { kind: "polyline", points: legsAt(at, arm), closed: false },
    { kind: "text", at: beside(arm * 1.3, arm * 1.3), text: String(n), height: textMm * 1.2, hAlign: 1, vAlign: 3 },
    { kind: "text", at: beside(arm * 1.3, arm * 1.3 - textMm * 2.2), text: note, height: textMm * 0.8, hAlign: 1, vAlign: 3 },
  ];
  return attrs ? shapes.map((shape) => ({ shape, attrs })) : shapes;
}

export class SpikeMarkTool extends BaseTool {
  readonly id = "spikemark";
  readonly cursor = "crosshair";
  private at: Pt | null = null;
  private tapeMm = 3;
  private textMm = 2.5;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Spike Mark Preferences",
      [
        { kind: "number", key: "tape", label: "Tape Length on Paper", value: this.tapeMm, min: 0.5, max: 30, unit: "mm" },
        { kind: "number", key: "text", label: "Text Height on Paper", value: this.textMm, min: 0.5, max: 20, unit: "mm" },
      ],
      "A click drops a small L of tape with its spike number and its place on stage beside it. The mark takes the current scene's colour when the set has scenes.",
    );
    if (!v) return;
    this.tapeMm = v.num("tape");
    this.textMm = v.num("text");
  }

  hint(): string {
    return this.at ? `Click to drop a spike mark · ${stageHint(this.at)}` : "Click to drop a spike mark";
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    this.drop(p.pos);
  }

  overlay(g: Painter): void {
    if (!this.at) return;
    const scale = this.scale();
    preview(g, [{ kind: "polyline", points: legsAt(this.at, this.tapeMm * scale), closed: false }]);
  }

  /** The active design layer's scale, 1 when there is none. */
  private scale(): number {
    const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
    return layer?.kind === "design" ? layer.scale || 1 : 1;
  }

  private drop(at: Pt): void {
    const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
    if (!layer || layer.kind !== "design") {
      toast("Make a design layer active to drop spike marks on it.", "info");
      return;
    }
    const scene = currentScene(sceneData());
    const attrs = scene ? { penFore: colorMatcher()(colorOf(scene.color)) } : undefined;
    const n = nextNumber();
    const scale = layer.scale || 1;
    addPieces("Spike Mark", [markParts(at, n, this.tapeMm * scale, this.textMm * scale, attrs)], `Spike ${n}`);
  }
}
