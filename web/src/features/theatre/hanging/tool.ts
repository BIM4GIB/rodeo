// Spotlight's Hanging Position tool: click to insert a position showing a symbol from the drawing, click
// again to set its rotation, and name it. Position Symbol and Automatic Numbering are in its Preferences; a
// symbol picked in Resources is used until one is chosen there.

import type { Pt } from "../../../core/index.ts";
import { dist } from "../../../app/geom.ts";
import { countOn } from "../../../app/lightingDeviceShapes.ts";
import { symbolDefsOf, symbolGeometry } from "../../../app/panels/resources.ts";
import { ACCENT } from "../../../app/renderer.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../../../app/tools.ts";
import { askName, placePosition } from "./hangingPosition.ts";

/** Shift turns it in steps of this, radians */
const ANGLE_STEP = Math.PI / 12;

const NO_SYMBOL = "Draw the position's geometry and use Stage > Lighting > Convert to Hanging Position, or make a symbol for this tool to place.";

export class HangingPositionTool extends BaseTool {
  readonly id = "hangingposition";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private pointer: Pt | null = null;
  private angle = 0;
  private symbolName = "";
  private auto = false;
  private next = "Position 1";
  private step = 1;

  private chosen(): { index: number; name: string } | null {
    const doc = store.session?.doc;
    if (!doc) return null;
    const defs = symbolDefsOf(doc);
    return defs.find((d) => d.name === this.symbolName) ?? defs.find((d) => d.index === store.activeSymbol) ?? null;
  }

  async preferences(): Promise<void> {
    const doc = store.session?.doc;
    const names = doc ? symbolDefsOf(doc).map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
    if (!names.length) {
      toast(NO_SYMBOL, "info");
      return;
    }
    const v = await toolPrefs(
      "Hanging Position Preferences",
      [
        { kind: "choice", key: "symbol", label: "Position Symbol", value: this.chosen()?.name ?? names[0], options: names.map((value) => ({ value, label: value })) },
        { kind: "check", key: "auto", label: "Automatic Numbering", value: this.auto },
        { kind: "text", key: "next", label: "Next Name", value: this.next },
        { kind: "number", key: "step", label: "Increment", value: this.step, min: -1000, max: 1000 },
      ],
      "Click where it goes, then click to set its rotation; Shift keeps it to 15° steps. With Automatic Numbering each position takes the next name, its last number counting on, without asking.",
    );
    if (!v) return;
    this.symbolName = v.choice("symbol");
    this.auto = v.flag("auto");
    this.next = v.choice("next");
    this.step = Math.round(v.num("step"));
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    const symbol = this.chosen();
    if (!symbol) return store.session && symbolDefsOf(store.session.doc).length ? "Choose the position's symbol in Preferences, or pick one in Resources" : NO_SYMBOL;
    return this.from ? "Click to set the rotation · Shift 15° · Esc cancels" : `Click to place a position showing ${symbol.name}`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    if (this.from) this.angle = this.angleTo(p);
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    this.pointer = p.pos;
    const symbol = this.chosen();
    const layerId = store.activeLayerId;
    if (!symbol || !layerId) {
      if (store.session && symbolDefsOf(store.session.doc).length) void this.preferences().catch((err: unknown) => toast(errorMessage(err)));
      else toast(NO_SYMBOL, "info");
      return;
    }
    if (!this.from) {
      this.from = p.pos;
      this.angle = -this.env.view.rotation;
      return;
    }
    const at = this.from;
    const angle = this.angleTo(p);
    this.from = null;
    void this.finish(layerId, at, (angle * 180) / Math.PI, symbol.index).catch((err: unknown) => toast(errorMessage(err)));
  }

  private async finish(layerId: string, at: Pt, angle: number, index: number): Promise<void> {
    const session = store.session;
    const name = this.auto ? this.next : await askName(this.next);
    if (!name || store.session !== session) return;
    placePosition(layerId, at, angle, name, index);
    this.next = countOn(name, this.step);
  }

  cancel(): void {
    this.from = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.from) return false;
    this.from = null;
    return true;
  }

  private angleTo(p: PointerInfo): number {
    const c = this.from;
    if (!c || dist(c, p.pos) === 0) return this.angle;
    const a = Math.atan2(p.pos.y - c.y, p.pos.x - c.x);
    const level = -this.env.view.rotation;
    return p.shift ? Math.round((a - level) / ANGLE_STEP) * ANGLE_STEP + level : a;
  }

  overlay(g: Painter): void {
    const doc = store.session?.doc;
    const symbol = this.chosen();
    const at = this.from ?? this.pointer;
    if (!doc || !symbol || !at) return;
    const { ctx } = g;
    const k = g.scale;
    const origin = g.toScreen(at);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    if (this.from && this.pointer) {
      const to = g.toScreen(this.pointer);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.translate(origin.x, origin.y);
    if (this.from) ctx.rotate(-this.angle);
    ctx.scale(k, -k);
    ctx.lineWidth = 1 / k;
    ctx.setLineDash([5 / k, 3 / k]);
    ctx.stroke(symbolGeometry(doc, symbol.index).path);
    ctx.restore();
  }
}
