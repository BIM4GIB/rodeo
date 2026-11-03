// Space Planning's Space Link tool (click one space, then the other) and its Adjacency Matrix, Adjacency Score
// and Stacking Diagram tools (click to place, click again to set the rotation). What they make is in
// ../adjacency.ts, and stays up with the spaces.

import type { Pt } from "../../core/index.ts";
import { ADJACENCY_MATRIX, ADJACENCY_SCORE, adjacencySettings, linkSpaces, placeDiagram, spaceAt, STACKING_DIAGRAM, type SpaceNode } from "../adjacency.ts";
import { MAX_STRENGTH, MIN_STRENGTH } from "../adjacencyShapes.ts";
import { dist } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";

/** Shift turns it in steps of this, radians */
const ANGLE_STEP = Math.PI / 12;

const strokeRing = (g: Painter, ring: readonly Pt[], dashed: boolean): void => {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [5, 3] : []);
  ctx.beginPath();
  ring.forEach((p, i) => {
    const q = g.toScreen(p);
    if (i) ctx.lineTo(q.x, q.y);
    else ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
};

export class SpaceLinkTool extends BaseTool {
  readonly id = "spacelink";
  readonly cursor = "crosshair";
  private first: SpaceNode | null = null;
  private under: SpaceNode | null = null;
  private pointer: Pt | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Space Link Preferences",
      [{ kind: "number", key: "strength", label: "Strength", value: adjacencySettings.strength, min: MIN_STRENGTH, max: MAX_STRENGTH, integer: true }],
      "Click a space, then the one to link it to. The stronger the link, the heavier its line; change a link's strength in Object Info.",
    );
    if (v) adjacencySettings.strength = v.num("strength");
  }

  hint(): string {
    return this.first ? `Click the space to link to ${this.first.name} · Esc cancels` : "Click the first space to link";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    this.under = spaceAt(p.pos);
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const space = spaceAt(p.pos);
    if (!space) {
      store.setHint("That isn't a space: click inside one");
      return;
    }
    if (!this.first) {
      this.first = space;
      return;
    }
    if (space.id === this.first.id) return;
    const from = this.first.id;
    this.first = null;
    linkSpaces(from, space.id);
  }

  cancel(): void {
    this.first = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.first) return false;
    this.first = null;
    return true;
  }

  overlay(g: Painter): void {
    if (this.under && this.under.id !== this.first?.id) strokeRing(g, this.under.ring, true);
    if (!this.first) return;
    strokeRing(g, this.first.ring, false);
    if (!this.pointer) return;
    const { ctx } = g;
    const a = g.toScreen(this.first.at);
    const b = g.toScreen(this.pointer);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

/** Click to place, click again to set the rotation. */
abstract class DiagramTool extends BaseTool {
  readonly cursor = "crosshair";
  protected abstract readonly plugin: string;
  private from: Pt | null = null;
  private pointer: Pt | null = null;

  protected abstract fields(): PrefField[];
  protected abstract read(v: Awaited<ReturnType<typeof toolPrefs>> & object): void;

  async preferences(): Promise<void> {
    const v = await toolPrefs(`${this.plugin} Preferences`, this.fields(), "Click to place it, then click to set its rotation. It's drawn from the spaces in the drawing and keeps up with them.");
    if (v) this.read(v);
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from ? "Click to set the rotation · Shift 15° · Esc cancels" : `Click to place the ${this.plugin}`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.from) {
      this.from = p.pos;
      return;
    }
    const at = this.from;
    this.from = null;
    placeDiagram(this.plugin, layerId, at, dist(at, p.pos) === 0 ? (-this.env.view.rotation * 180) / Math.PI : (this.angleTo(at, p) * 180) / Math.PI);
  }

  private angleTo(at: Pt, p: PointerInfo): number {
    const a = Math.atan2(p.pos.y - at.y, p.pos.x - at.x);
    const level = -this.env.view.rotation;
    return p.shift ? Math.round((a - level) / ANGLE_STEP) * ANGLE_STEP + level : a;
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
    if (!this.from || !this.pointer) return;
    const { ctx } = g;
    const a = g.toScreen(this.from);
    const b = g.toScreen(this.pointer);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

const sizeField = (): PrefField => ({ kind: "number", key: "size", label: "Text Size (mm on paper)", value: adjacencySettings.textSize, min: 0.5, max: 50 });
const scaleField = (key: string, label: string, value: number): PrefField => ({ kind: "number", key, label, value, min: 0.05, max: 100 });

export class AdjacencyMatrixTool extends DiagramTool {
  readonly id = "adjacencymatrix";
  protected readonly plugin = ADJACENCY_MATRIX;

  protected fields(): PrefField[] {
    return [scaleField("height", "Height Scale", adjacencySettings.heightScale), scaleField("width", "Width Scale", adjacencySettings.widthScale), sizeField()];
  }

  protected read(v: Awaited<ReturnType<typeof toolPrefs>> & object): void {
    adjacencySettings.heightScale = v.num("height");
    adjacencySettings.widthScale = v.num("width");
    adjacencySettings.textSize = v.num("size");
  }
}

export class AdjacencyScoreTool extends DiagramTool {
  readonly id = "adjacencyscore";
  protected readonly plugin = ADJACENCY_SCORE;

  protected fields(): PrefField[] {
    return [sizeField()];
  }

  protected read(v: Awaited<ReturnType<typeof toolPrefs>> & object): void {
    adjacencySettings.textSize = v.num("size");
  }
}

export class StackingDiagramTool extends DiagramTool {
  readonly id = "stackingdiagram";
  protected readonly plugin = STACKING_DIAGRAM;

  protected fields(): PrefField[] {
    return [
      scaleField("height", "Height Scale", adjacencySettings.heightScale),
      scaleField("width", "Width Scale", adjacencySettings.widthScale),
      scaleField("gap", "Gap Scale", adjacencySettings.gapScale),
      { kind: "check", key: "totals", label: "Show Totals", value: adjacencySettings.showTotals },
      sizeField(),
    ];
  }

  protected read(v: Awaited<ReturnType<typeof toolPrefs>> & object): void {
    adjacencySettings.heightScale = v.num("height");
    adjacencySettings.widthScale = v.num("width");
    adjacencySettings.gapScale = v.num("gap");
    adjacencySettings.showTotals = v.flag("totals");
    adjacencySettings.textSize = v.num("size");
  }
}
