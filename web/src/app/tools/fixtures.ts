// Furniture/Fixtures' Countertop and Spotlight's Focus Point. Vectorworks makes plug-in objects of
// them; these draw what those objects draw in plan, as plain 2D objects in the active class. Esc
// cancels.
//
// Countertop (Vertex mode): click its corners; a double-click, Enter or a click on the first corner
// closes it. Corner Vertex keeps them sharp, Arc Vertex rounds those away from the backsplash with
// the Fillet Radius. The backsplash stands on the first Backsplash Edges edges from the first
// corner: a line its thickness inside them.
// Focus Point: a click asks for the focus point's name (offering the next after the last one) and
// places an octagon there with its name beside it, or a 2D locus for the Standard 3D and Locus Points
// Only shapes.

import type { Pt } from "../../core/index.ts";
import { pathLength } from "../cableShapes.ts";
import { backsplashLine, countertopProblem, focusPoint } from "../fixtureShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { BENDS, bendModes, bentPolyline, type Bend } from "./cables.ts";
import { placedDrawing } from "./circulation.ts";
import { addPieces, layerScale, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a countertop's fillet radius and backsplash, until Preferences change them, mm */
const FILLET = 50;
const BACKSPLASH = 20;
/** a focus point's octagon across and its name's height on paper, mm */
const FOCUS_MM = 4;
const FOCUS_TEXT_MM = 2.5;

/** The name offered after `name`: its last number counted on (keeping its width), else the name with 2 after it. */
function nextName(name: string): string {
  const num = /^(.*?)(\d+)$/.exec(name);
  return num ? num[1] + String(Number(num[2]) + 1).padStart(num[2].length, "0") : `${name} 2`;
}

const pick = <T extends string>(list: readonly { readonly id: T }[], id: string, fallback: T): T => list.find((o) => o.id === id)?.id ?? fallback;

export class CountertopTool extends PathTool {
  readonly id = "countertop";
  protected readonly label = "Countertop";
  private bend: Bend = "corner";
  private radius = FILLET;
  private splashEdges = 1;
  private splash = BACKSPLASH;

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
      "Countertop Preferences",
      [
        { kind: "number", key: "edges", label: "Backsplash Edges", value: this.splashEdges, min: 0, max: 100 },
        { kind: "length", key: "splash", label: "Backsplash Thickness", value: this.splash },
        { kind: "length", key: "radius", label: "Fillet Radius", value: this.radius },
      ],
      "Vertex mode: click the countertop's corners; a double-click, Enter or a click on the first corner closes it. Its backsplash stands on the first Backsplash Edges edges from the corner clicked first (0 for none), drawn as a line its thickness inside them. Arc Vertex mode rounds the corners away from the backsplash with the Fillet Radius. The outline takes the drawing's attributes. Marquee, Pick and Bridge modes (from cabinets), elevations, thicknesses, overhangs, edge and trim profiles, waterfall edges, insertions, materials, styles and 3D aren't offered.",
    );
    if (!v) return;
    this.splashEdges = Math.max(0, Math.round(v.num("edges")));
    this.splash = Math.max(0, v.num("splash"));
    this.radius = Math.max(0, v.num("radius"));
  }

  protected startHint(): string {
    return `Click the countertop's first corner${this.splashEdges > 0 ? " · its backsplash runs on from it" : ""} · 1–2 vertex`;
  }

  protected parts(points: Pt[]): Part[] | string {
    const made = this.made(points);
    return typeof made === "string" ? made : [made.outline.shape, ...made.splash];
  }

  protected previewParts(points: Pt[]): Part[] | string {
    // the arcs as they'll be drawn, not their corners
    const made = this.made(points);
    return typeof made === "string" ? made : [{ kind: "polyline", points: made.outline.outline, closed: false }, ...made.splash];
  }

  /** The countertop clicked: its outline (always closed) and its backsplash line. */
  private made(points: Pt[]): { outline: ReturnType<typeof bentPolyline>; splash: Part[] } | string {
    const problem = countertopProblem(points);
    if (problem) return problem;
    const edges = Math.min(this.splashEdges, points.length);
    const line = this.splash > 0 ? backsplashLine(points, edges, this.splash) : [];
    if (typeof line === "string") return line;
    // corners on the backsplash stay sharp
    const round = points.map((_, i) => edges === 0 || (edges < points.length && i > edges));
    const outline = bentPolyline(points, true, round, this.bend === "arc" ? this.radius : 0);
    if (!(pathLength(outline.outline) > 0)) return "Click points apart for the countertop.";
    return { outline, splash: line.length >= 2 ? [{ kind: "polyline", points: line, closed: false }] : [] };
  }
}

type FocusShape = "hybrid" | "2d" | "3d" | "locus";
const FOCUS_SHAPES: readonly { readonly id: FocusShape; readonly label: string }[] = [
  { id: "hybrid", label: "Standard Hybrid" },
  { id: "2d", label: "Standard 2D" },
  { id: "3d", label: "Standard 3D" },
  { id: "locus", label: "Locus Points Only" },
];

export class FocusPointTool extends BaseTool {
  readonly id = "focuspoint";
  readonly cursor = "crosshair";
  private shape: FocusShape = "hybrid";
  private showName = true;
  private name = "FP1";
  private asking = false;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Focus Point Preferences",
      [
        { kind: "check", key: "show", label: "Show Focus Point Name", value: this.showName },
        { kind: "choice", key: "shape", label: "Focus Point Shape", value: this.shape, options: FOCUS_SHAPES.map((s) => ({ value: s.id, label: s.label })) },
      ],
      `Click where the focus point goes, then name it. In plan, Standard Hybrid and Standard 2D draw an octagon ${FOCUS_MM} mm across on paper, Standard 3D and Locus Points Only a 2D locus; Show Focus Point Name puts its name to the right, ${FOCUS_TEXT_MM} mm high. Focus heights, assigning lighting devices to it, focus shape symbols and 3D aren't kept.`,
    );
    if (!v) return;
    this.showName = v.flag("show");
    this.shape = pick(FOCUS_SHAPES, v.choice("shape"), this.shape);
  }

  hint(): string {
    return "Click where the focus point goes, then name it";
  }

  down(p: PointerInfo): void {
    if (this.asking || p.detail > 1) return;
    void this.place(p.pos);
  }

  private async place(at: Pt): Promise<void> {
    const scale = layerScale(this.env);
    if (scale === null) {
      toast("Make a design layer active to place a focus point.", "info");
      return;
    }
    this.asking = true;
    const v = await toolPrefs("Place Focus Point", [{ kind: "text", key: "name", label: "Focus Point Name", value: this.name }], "Lighting devices are focused on a focus point by its name.");
    this.asking = false;
    if (!v) return;
    const name = v.choice("name").trim();
    if (!name) {
      toast("Name the focus point: lighting devices are focused on it by name.", "info");
      return;
    }
    const octagon = this.shape === "hybrid" || this.shape === "2d";
    const drawing = placedDrawing(focusPoint(FOCUS_MM * scale, octagon, this.showName ? name : "", FOCUS_TEXT_MM * scale), at, 0);
    addPieces("Focus Point", [[...(octagon ? [] : [{ kind: "locus", at } as const]), ...markerParts(drawing)]]);
    this.name = nextName(name);
  }
}
