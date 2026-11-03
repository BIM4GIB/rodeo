// Spotlight's Distributor and Electrical Component (powerShapes.ts). Vectorworks places a
// distributor from a library symbol, a rectangle when none is chosen, as an object power patching,
// paperwork and Braceworks loads read; this draws that rectangle with its outputs numbered along
// it, its ID and name over it and its output length as a circle round it. An electrical component
// marks a connection inside a device's symbol; this draws its glyph from above. Each is plain 2D
// objects grouped in the active class. A click places one; a press dragged turns it (Shift: 15°
// steps). Automatic Numbering counts the distributor's ID on after each one. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { countOn } from "../lightingDeviceShapes.ts";
import { colorMatcher } from "../pdfImport.ts";
import { COMPONENT_MM, componentGlyph, distributor, MAX_OUTPUTS, type ComponentKind } from "../powerShapes.ts";
import { toolPrefs } from "../toolPrefs.ts";
import type { ToolModes } from "../tools.ts";
import { PlaceTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

export class DistributorTool extends PlaceTool {
  readonly id = "distributor";
  readonly cursor = "crosshair";
  protected readonly label = "Distributor";
  private width = 600;
  private depth = 150;
  private outputs = 6;
  private name = "";
  private showName = true;
  private distId = "D1";
  private auto = true;
  private step = 1;
  private drawLengths = false;
  private outputLength = 10000;
  /** paper mm */
  private textMm = 2.5;
  private problem = "";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Distributor Preferences",
      [
        { kind: "text", key: "id", label: "ID", value: this.distId },
        { kind: "text", key: "name", label: "Name", value: this.name },
        { kind: "check", key: "showName", label: "Show Name", value: this.showName },
        { kind: "check", key: "auto", label: "Automatic Numbering", value: this.auto },
        { kind: "number", key: "step", label: "Increment by", value: this.step, min: -1000, max: 1000 },
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "depth", label: "Depth", value: this.depth },
        { kind: "number", key: "outputs", label: "Outputs", value: this.outputs, min: 0, max: MAX_OUTPUTS },
        { kind: "check", key: "drawLengths", label: "Draw output lengths", value: this.drawLengths },
        { kind: "length", key: "outputLength", label: "Output Length", value: this.outputLength },
        { kind: "number", key: "text", label: "Label Size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "A click places the distributor centred on it (a drag turns it): the rectangle Vectorworks places when no distributor symbol is chosen, Width by Depth, its outputs numbered along it, its ID with its name over it (level on the page, the Label Size on paper) and, with Draw output lengths, a circle the Output Length round it. Automatic Numbering counts the last number in the ID on by the increment after each one. Distributor symbols, power patching, connectors, voltages and payloads, Braceworks loads, attaching to rigging, data tags and paperwork aren't kept.",
    );
    if (!v) return;
    this.distId = v.choice("id");
    this.name = v.choice("name");
    this.showName = v.flag("showName");
    this.auto = v.flag("auto");
    this.step = Math.round(v.num("step"));
    this.width = v.num("width");
    this.depth = v.num("depth");
    this.outputs = Math.round(v.num("outputs"));
    this.drawLengths = v.flag("drawLengths");
    this.outputLength = v.num("outputLength");
    this.textMm = v.num("text");
  }

  hint(): string {
    return `${super.hint()} · ID ${this.distId.trim() || "—"}`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) {
      this.problem = "Make a design layer active to place a distributor.";
      return null;
    }
    const d = distributor(
      { width: this.width, depth: this.depth, outputs: this.outputs, id: this.distId, name: this.showName ? this.name : "", outputLength: this.drawLengths ? this.outputLength : null },
      this.textMm * scale,
      angle,
    );
    if (typeof d === "string") {
      this.problem = d;
      return null;
    }
    const move = (p: Pt): Pt => ({ x: at.x + p.x, y: at.y + p.y });
    return markerParts({
      outlines: d.outlines.map((o) => o.map(move)),
      lines: [],
      circles: d.circles.map((c) => ({ center: move(c.center), radius: c.radius })),
      filled: [],
      texts: d.texts.map((t) => ({ ...t, at: move(t.at) })),
    });
  }

  protected afterPlacing(): void {
    if (this.auto) this.distId = countOn(this.distId, this.step);
  }

  protected refusal(): string {
    return this.problem;
  }
}

const COMPONENTS: readonly { readonly id: ComponentKind; readonly label: string; readonly colour: { r: number; g: number; b: number } }[] = [
  { id: "source", label: "Power Source", colour: { r: 1, g: 1, b: 0 } },
  { id: "input", label: "Input", colour: { r: 0, g: 1, b: 0 } },
  { id: "protector", label: "Overcurrent Protector", colour: { r: 1, g: 0.67, b: 0.2 } },
  { id: "output", label: "Output", colour: { r: 0, g: 0, b: 1 } },
  { id: "consumer", label: "Consumer", colour: { r: 1, g: 0, b: 1 } },
];
const GREY = { r: 0.54, g: 0.55, b: 0.54 };

export class ElectricalComponentTool extends PlaceTool {
  readonly id = "eleccomponent";
  readonly cursor = "crosshair";
  protected readonly label = "Electrical Component";
  private kind: ComponentKind = "output";
  private sx = 1;
  private sy = 1;

  modes(): readonly ToolModes[] {
    return [{ label: "Component", options: COMPONENTS.map((c, i) => ({ id: c.id, label: c.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    this.kind = COMPONENTS.find((c) => c.id === id)?.id ?? this.kind;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Electrical Component Preferences",
      [
        { kind: "number", key: "sx", label: "Scale X", value: this.sx, min: 0.01, max: 100 },
        { kind: "number", key: "sy", label: "Scale Y", value: this.sy, min: 0.01, max: 100 },
      ],
      `The component on keys 1 to 5 (power source, input, overcurrent protector, output, consumer) is drawn from above, centred on the click (a drag turns it): ${COMPONENT_MM / 10} cm square at a scale of 1, a coloured drum on a grey base, or a narrow box with an orange cap for an overcurrent protector. Vectorworks places these inside a device's symbol so it can be power patched; Rodeo doesn't power patch, so names, connectors, sockets, ratings, power and voltages aren't kept.`,
    );
    if (!v) return;
    this.sx = v.num("sx");
    this.sy = v.num("sy");
  }

  hint(): string {
    return `${super.hint()} · 1–5 component`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    if (this.scale() === null) return null;
    const g = componentGlyph(this.kind, this.sx, this.sy, angle);
    const match = colorMatcher();
    const fill = (colour: { r: number; g: number; b: number }) => {
      const c = match(colour);
      return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 };
    };
    const move = (pts: Pt[]): Pt[] => pts.map((p) => ({ x: at.x + p.x, y: at.y + p.y }));
    const colour = COMPONENTS.find((c) => c.id === this.kind)!.colour;
    return [
      { shape: { kind: "polygon", points: move(g.base), closed: true }, attrs: fill(GREY) },
      { shape: { kind: "polygon", points: move(g.top), closed: true }, attrs: fill(colour) },
    ];
  }

  protected refusal(): string {
    return "Make a design layer active to place an electrical component.";
  }
}
