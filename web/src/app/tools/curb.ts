// Site Planning's Curb (curbShapes.ts): click each corner of its front edge; a double-click or Enter
// ends it open, a click on the first corner closes it. Vectorworks makes a plug-in object of it from
// a curb style's profiles and symbols; this draws what an extruded curb shows in Top/Plan, as plain
// 2D objects grouped in the active class. Esc cancels.

import type { NewShape, Pt } from "../../core/index.ts";
import { curb, type Curb, type CurbDraw } from "../curbShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import type { Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

const DRAWS: readonly { readonly value: CurbDraw; readonly label: string }[] = [
  { value: "line", label: "Simple Line" },
  { value: "frontBack", label: "Front and Back Lines" },
  { value: "full", label: "Full Detail" },
];
const SIDES: readonly { readonly value: Curb["side"]; readonly label: string }[] = [
  { value: "left", label: "Left of the path" },
  { value: "right", label: "Right of the path" },
];

const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

export class CurbTool extends PathTool {
  readonly id = "curb";
  protected readonly label = "Curb";
  private c: Curb = { draw: "full", side: "left", width: 150, unitLength: 915, joint: 10, foundation: true, frontOverhang: 100, backOverhang: 150 };

  async preferences(): Promise<void> {
    const c = this.c;
    const v = await toolPrefs(
      "Curb Preferences",
      [
        { kind: "choice", key: "draw", label: "Draw 2D", value: c.draw, options: DRAWS },
        { kind: "choice", key: "side", label: "Curb lies", value: c.side, options: SIDES },
        { kind: "length", key: "width", label: "Width", value: c.width },
        { kind: "length", key: "unit", label: "Unit Length", value: c.unitLength, zero: true },
        { kind: "length", key: "joint", label: "Paver Joint Width", value: c.joint, zero: true },
        { kind: "check", key: "foundation", label: "Show foundation", value: c.foundation },
        { kind: "length", key: "front", label: "Foundation in front", value: c.frontOverhang, zero: true },
        { kind: "length", key: "back", label: "Foundation behind", value: c.backOverhang, zero: true },
      ],
      "The clicked path is the curb's front edge, the curb its Width to the side it lies. Simple Line draws the front edge; Front and Back Lines adds the back edge in the drawing's first dashed line type (solid in a drawing without one); Full Detail draws a piece between each pair of corners, mitred where they meet, cut into units the Unit Length long from each piece's start (0 for one piece) with a joint between, and the foundation under it dashed (left out in a drawing without a dashed line type), reaching in front and behind. Styles, profiles, path and corner symbols, border rows, insertions, elevations, site modifiers, slope annotations and 3D aren't offered.",
    );
    if (!v) return;
    this.c = {
      draw: DRAWS.find((d) => d.value === v.choice("draw"))?.value ?? "full",
      side: v.choice("side") === "right" ? "right" : "left",
      width: v.num("width"),
      unitLength: v.num("unit"),
      joint: v.num("joint"),
      foundation: v.flag("foundation"),
      frontOverhang: v.num("front"),
      backOverhang: v.num("back"),
    };
  }

  protected startHint(): string {
    return "Click the start of the curb's front edge";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = curb(points, closed, this.c);
    if (typeof plan === "string") return plan;
    const dashed = dashedStyle();
    const line = (pts: Pt[]): NewShape => ({ kind: "polyline", points: pts, closed: false });
    const inDashes = (pts: Pt[]): Part => ({ shape: line(pts), attrs: { lineStyle: dashed } });
    return [
      ...(dashed === undefined ? [] : plan.dashed.map(inDashes)),
      ...plan.back.map((pts) => (dashed === undefined ? line(pts) : inDashes(pts))),
      ...plan.outlines.map((points): Part => ({ kind: "polygon", points, closed: true })),
      ...plan.lines.map(line),
    ];
  }
}
