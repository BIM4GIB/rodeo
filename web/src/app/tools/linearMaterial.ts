// Detailing's Linear Material tool. Vectorworks makes a plug-in object of it; this draws what that
// object draws, as plain 2D objects grouped in the active class. Click the path's corners (Arc
// Vertex mode rounds them with the Fillet Radius); a double-click or Enter ends it open, a click on
// the first corner closes it. The material lies on the path's left, its type and sizes set in
// Preferences (linearMaterialShapes.ts). Esc cancels.

import type { Pt } from "../../core/index.ts";
import { WHITE } from "../../core/attrs.ts";
import { linearMaterial, type Closure, type LinearMaterial, type LinearType } from "../linearMaterialShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { modeForKey, type ToolModes } from "../tools.ts";
import { BENDS, bendModes, bentPolyline, type Bend } from "./cables.ts";
import { layerScale, type Part } from "./detailing.ts";
import { BLACK } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a stipple dot's radius on paper, mm, as the Stipple tool's */
const DOT_MM = 0.15;

const TYPES: readonly { readonly id: LinearType; readonly label: string }[] = [
  { id: "board", label: "Board (generic)" },
  { id: "gyp", label: "Gyp. Bd. (detail)" },
  { id: "stucco", label: "Plaster/Stucco" },
  { id: "stuccoDetail", label: "Plaster/Stucco (detail)" },
  { id: "plywood", label: "Plywood/OSB" },
  { id: "plywoodDetail", label: "Plywood/OSB (detail)" },
  { id: "roof", label: "Built-up Roof" },
  { id: "deck", label: "Corrugated Deck" },
  { id: "deckFill", label: "Corrugated Deck w/fill" },
  { id: "deckFillDetail", label: "Corrugated Deck w/fill (detail)" },
];
const CLOSURES: readonly { readonly id: Closure; readonly label: string }[] = [
  { id: "both", label: "Both Ends" },
  { id: "start", label: "Start" },
  { id: "end", label: "End" },
  { id: "none", label: "None" },
];

const pick = <T extends string>(list: readonly { readonly id: T }[], id: string, fallback: T): T => list.find((o) => o.id === id)?.id ?? fallback;

export class LinearMaterialTool extends PathTool {
  readonly id = "linearmaterial";
  protected readonly label = "Linear Material";
  private bend: Bend = "corner";
  private radius = 100;
  /** the material, its density in dots per cm² on paper */
  private m: Omit<LinearMaterial, "density"> = { type: "board", offset: 0, thickness: 13, pitch: 305, depth: 51, closure: "both" };
  private density = 25;

  modes(): readonly ToolModes[] {
    return [bendModes(this.bend)];
  }

  setMode(id: string): void {
    this.bend = pick(BENDS, id, this.bend);
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Linear Material Preferences",
      [
        { kind: "choice", key: "type", label: "Type", value: this.m.type, options: TYPES.map((t) => ({ value: t.id, label: t.label })) },
        { kind: "length", key: "offset", label: "Offset", value: this.m.offset, signed: true },
        { kind: "length", key: "thickness", label: "Thickness", value: this.m.thickness },
        { kind: "length", key: "pitch", label: "Pitch", value: this.m.pitch },
        { kind: "length", key: "depth", label: "Corrugation Depth", value: this.m.depth },
        { kind: "choice", key: "closure", label: "Closure", value: this.m.closure, options: CLOSURES.map((c) => ({ value: c.id, label: c.label })) },
        { kind: "number", key: "density", label: "Density", value: this.density, min: 1, max: 200, unit: "per cm²" },
        { kind: "length", key: "radius", label: "Fillet Radius", value: this.radius },
      ],
      "Click the path's corners; the material lies on its left (above a path drawn left to right), from the path moved by the Offset (to its right when negative) out to its Thickness. Board: two edges, the space between in the drawing's fill. Gyp. Bd. (detail): a facing line near its face, stippled. Plaster/Stucco: a rough face (detail: stippled). Plywood/OSB: four plies (detail: slashes in threes). Built-up Roof: a solid band under gravel. Corrugated Deck: its profile at the Pitch and Corrugation Depth (w/fill: a topping the Thickness over the flats, filled into the pans; detail: stippled). Closure closes the ends; Density sets the stipple per cm² on paper; Arc Vertex mode rounds the corners with the Fillet Radius.",
    );
    if (!v) return;
    this.m = {
      type: pick(TYPES, v.choice("type"), this.m.type),
      offset: v.num("offset"),
      thickness: Math.max(0, v.num("thickness")),
      pitch: Math.max(0, v.num("pitch")),
      depth: Math.max(0, v.num("depth")),
      closure: pick(CLOSURES, v.choice("closure"), this.m.closure),
    };
    this.density = v.num("density");
    this.radius = Math.max(0, v.num("radius"));
  }

  protected startHint(): string {
    return "Click the material's start · it lies on the path's left · 1–2 vertex";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to draw linear material.";
    // the path with its corners rounded in Arc Vertex mode, as the points the arcs are drawn with
    const path = bentPolyline(points, closed, points.map(() => true), this.bend === "arc" ? this.radius : 0).outline;
    const d = linearMaterial(closed ? path.slice(0, -1) : path, closed, { ...this.m, density: this.density / (100 * scale * scale) });
    if (typeof d === "string") return d;
    const ink = store.drawAttrs.penFore ?? BLACK;
    const r = DOT_MM * scale;
    return [
      ...d.fills.map((points): Part => ({ shape: { kind: "polygon", points, closed: true }, attrs: { lineStyle: 0 } })),
      ...d.solid.map((points): Part => ({ shape: { kind: "polygon", points, closed: true }, attrs: { lineStyle: 0, fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 100 } })),
      ...d.lines.map((points): Part => ({ shape: { kind: "polyline", points, closed: false }, attrs: { fillPattern: 0 } })),
      ...d.stones.map((points): Part => ({ shape: { kind: "polygon", points, closed: true }, attrs: { fillPattern: 1, fillFore: WHITE, fillBack: WHITE, fillOpacity: 100 } })),
      ...d.dots.map((center): Part => ({ kind: "arc", center, radius: r, startAngle: 0, sweepAngle: 360 })),
    ];
  }

  protected previewParts(points: Pt[], closed: boolean): Part[] | string {
    // the stipple and gravel left out while the path grows
    const parts = this.parts(points, closed);
    return typeof parts === "string" ? parts : parts.filter((p) => ("shape" in p ? p.shape.kind : p.kind) !== "arc" && !("shape" in p && p.attrs?.fillFore === WHITE));
  }
}
