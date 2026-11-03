// Site Planning's Roadway (Straight), Roadway (Curved), Roadway (Tee) and Roadway (Poly) (roadShapes.ts).
// Vectorworks makes plug-in objects of them that can modify the site model; these draw what they
// draw in plan, as plain 2D objects grouped in the active class: the paving without a pen (in the
// drawing's fill, so none in a drawing without one), its curbs, and the joints where sections meet.
//
// Straight: a drag, or a click at each end of its centre line (Shift in 15° steps). Curved: a
// click at the start of its centre line, a press dragged setting the way it leaves, turning left
// (a negative sweep turns right). Tee: a click at the middle of its throat's open end, a press
// dragged pointing it into the tee. Poly: click each corner of its centre line, a double-click or
// Enter ending it open, a click on the first corner closing it into a ring.

import type { NewShape, Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import { dist } from "../geom.ts";
import { curvedRoad, polyRoad, straightRoad, teeRoad, type RoadPlan } from "../roadShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { PlaceTool, TwoPointTool, type Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

/** A road plan's parts placed at `at`, turned by `angle`: the paving under its curbs, edges and joints (in the drawing's first dashed line type when it has one), and its arcs' loci. */
function roadParts(r: RoadPlan, at: Pt, angle: number): Part[] {
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  const line = (l: Pt[]): NewShape => ({ kind: "polyline", points: placed(l, at, angle), closed: false });
  return [
    { shape: { kind: "polygon", points: placed(r.paving, at, angle), closed: true }, attrs: { lineStyle: 0 } },
    ...r.bands.map((b): Part => ({ shape: { kind: "polygon", points: placed(b, at, angle), closed: true }, attrs: { lineStyle: 0 } })),
    ...r.curbs.map((c): Part => ({ kind: "polygon", points: placed(c, at, angle), closed: true })),
    ...r.edges.map(line),
    ...r.joints.map((j): Part => (dashed ? { shape: line(j), attrs: { lineStyle: dashed.style } } : line(j))),
    ...r.loci.map((p): Part => ({ kind: "locus", at: placed([p], at, angle)[0] })),
  ];
}

const JOINTS_NOTE =
  "The paving takes the Attributes palette's fill, without a pen. Joints are the paving's ends where it meets the next section, in the drawing's first dashed line type (solid in a drawing without one).";

export class RoadStraightTool extends TwoPointTool {
  readonly id = "roadstraight";
  readonly cursor = "crosshair";
  protected readonly label = "Roadway (Straight)";
  private paving = 7300;
  private curb = 150;
  private joints = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roadway (Straight) Preferences",
      [
        { kind: "length", key: "paving", label: "Paving Width", value: this.paving },
        { kind: "length", key: "curb", label: "Curb Width", value: this.curb, zero: true },
        { kind: "check", key: "joints", label: "Show Joints", value: this.joints },
      ],
      `Drawn along the centre line from the first click to the second, a curb outside each side. ${JOINTS_NOTE}`,
    );
    if (!v) return;
    this.paving = v.num("paving");
    this.curb = v.num("curb");
    this.joints = v.flag("joints");
  }

  hint(): string {
    return this.start() ? super.hint() : "Drag the road's centre line or click its start";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const r = straightRoad(dist(a, b), this.paving, this.curb, this.joints);
    return r ? roadParts(r, a, Math.atan2(b.y - a.y, b.x - a.x)) : null;
  }

  protected refusal(): string {
    return "Drag a longer roadway.";
  }
}

export class RoadCurvedTool extends PlaceTool {
  readonly id = "roadcurved";
  readonly cursor = "crosshair";
  protected readonly label = "Roadway (Curved)";
  private radius = 15000;
  private width = 7300;
  private curb = 150;
  /** degrees, positive turning left */
  private sweep = 90;
  private joints = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roadway (Curved) Preferences",
      [
        { kind: "length", key: "radius", label: "Radius", value: this.radius },
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "curb", label: "Curb Width", value: this.curb, zero: true },
        { kind: "number", key: "sweep", label: "Sweep", value: this.sweep, min: -359, max: 359, unit: "°" },
        { kind: "check", key: "joints", label: "Show Joints", value: this.joints },
      ],
      `The radius is to the road's centre line; a locus marks the arc's centre. A positive sweep turns left from the way it's dragged, a negative one right. ${JOINTS_NOTE}`,
    );
    if (!v) return;
    this.radius = v.num("radius");
    this.width = v.num("width");
    this.curb = v.num("curb");
    this.sweep = v.num("sweep");
    this.joints = v.flag("joints");
  }

  hint(): string {
    return `${super.hint()} · the centre line's start on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const r = curvedRoad(this.radius, this.width, this.curb, this.sweep, this.joints);
    return r ? roadParts(r, at, angle) : null;
  }

  protected refusal(): string {
    return "The radius must be more than half the width plus the curb, and the sweep not 0: change the Roadway (Curved) Preferences.";
  }
}

export class RoadTeeTool extends PlaceTool {
  readonly id = "roadtee";
  readonly cursor = "crosshair";
  protected readonly label = "Roadway (Tee)";
  private radius = 6000;
  private throat = 7300;
  private gutter = 7300;
  private curb = 150;
  private gutterCurb = true;
  private joints = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roadway (Tee) Preferences",
      [
        { kind: "length", key: "radius", label: "Radius", value: this.radius },
        { kind: "length", key: "throat", label: "Throat Width", value: this.throat },
        { kind: "length", key: "gutter", label: "Gutter Width", value: this.gutter },
        { kind: "length", key: "curb", label: "Curb Width", value: this.curb, zero: true },
        { kind: "check", key: "gutterCurb", label: "Draw Gutter Curb", value: this.gutterCurb },
        { kind: "check", key: "joints", label: "Show Joints", value: this.joints },
      ],
      `The throat widens through a fillet of the radius either side into the road across it, the gutter width wide; loci mark the fillets' centres. ${JOINTS_NOTE}`,
    );
    if (!v) return;
    this.radius = v.num("radius");
    this.throat = v.num("throat");
    this.gutter = v.num("gutter");
    this.curb = v.num("curb");
    this.gutterCurb = v.flag("gutterCurb");
    this.joints = v.flag("joints");
  }

  hint(): string {
    return `${super.hint()} · the throat's open end on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const r = teeRoad(this.radius, this.throat, this.gutter, this.curb, this.gutterCurb, this.joints);
    return r ? roadParts(r, at, angle) : null;
  }

  protected refusal(): string {
    return "The curb must be narrower than the radius: change the Roadway (Tee) Preferences.";
  }
}

export class RoadPolyTool extends PathTool {
  readonly id = "roadpoly";
  protected readonly label = "Roadway (Poly)";
  private paving = 7300;
  private curb = 150;
  private joints = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roadway (Poly) Preferences",
      [
        { kind: "length", key: "paving", label: "Paving Width", value: this.paving },
        { kind: "length", key: "curb", label: "Curb Width", value: this.curb, zero: true },
        { kind: "check", key: "joints", label: "Show Joints", value: this.joints },
      ],
      `Drawn along the centre line clicked, mitred at its corners, a curb outside each side; a closed path makes a ring road. ${JOINTS_NOTE}`,
    );
    if (!v) return;
    this.paving = v.num("paving");
    this.curb = v.num("curb");
    this.joints = v.flag("joints");
  }

  protected startHint(): string {
    return "Click the start of the road's centre line";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const r = polyRoad(points, closed, this.paving, this.curb, this.joints);
    return r ? roadParts(r, { x: 0, y: 0 }, 0) : "The path turns too tightly for the road's width, or a width isn't over 0: draw wider corners or change the Roadway (Poly) Preferences.";
  }
}
