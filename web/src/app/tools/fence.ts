// Site Planning's Fence (fenceShapes.ts): click each corner of its path; a double-click or Enter
// ends it open, a click on the first corner closes it. Vectorworks makes a plug-in object of it;
// this draws what that object draws in Top/Plan, as plain 2D objects grouped in the active class,
// set in Preferences as on Vectorworks' General, Posts, Rails and Infill panes. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { fence, type CornerAlign, type Fence, type FenceDraw, type FenceInfill, type FenceSide, type FooterShape, type PostShape, type PostSpacing, type RailOffset } from "../fenceShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { drawn, type Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

type Option<T extends string> = { readonly value: T; readonly label: string };

const DRAWS: readonly Option<FenceDraw>[] = [
  { value: "line", label: "Simple Line" },
  { value: "squarePosts", label: "Line with Square Posts" },
  { value: "roundPosts", label: "Line with Round Posts" },
  { value: "full", label: "Full Detail" },
];
const FACES: readonly Option<FenceSide>[] = [
  { value: "left", label: "Left of the path" },
  { value: "right", label: "Right of the path" },
];
const ALIGNS: readonly Option<CornerAlign>[] = [
  { value: "previous", label: "Previous segment edge" },
  { value: "next", label: "Next segment edge" },
  { value: "bisect", label: "Angle between segments" },
];
const SPACINGS: readonly Option<PostSpacing>[] = [
  { value: "fixed", label: "Fixed Distance" },
  { value: "equal", label: "Equal Spacing" },
];
const SHAPES: readonly Option<PostShape>[] = [
  { value: "square", label: "Square" },
  { value: "round", label: "Round" },
];
const FOOTERS: readonly Option<FooterShape>[] = [
  { value: "none", label: "None" },
  { value: "square", label: "Square" },
  { value: "round", label: "Round" },
];
const RAIL_OFFSETS: readonly Option<RailOffset>[] = [
  { value: "centre", label: "Centered on Post" },
  { value: "front", label: "Flush with Front of Post" },
  { value: "rear", label: "Flush with Rear of Post" },
  { value: "onFront", label: "Placed on Front of Post" },
  { value: "custom", label: "Custom Offset from Center" },
];
const INFILLS: readonly Option<FenceInfill>[] = [
  { value: "rails", label: "Rails Only" },
  { value: "panel", label: "Panel, Pre-Constructed" },
  { value: "vertical", label: "Vertical Boards" },
  { value: "horizontal", label: "Horizontal Boards" },
];

const pick = <T extends string>(options: readonly Option<T>[], value: string, fallback: T): T => options.find((o) => o.value === value)?.value ?? fallback;
const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

export class FenceTool extends PathTool {
  readonly id = "fence";
  protected readonly label = "Fence";
  private f: Fence = {
    draw: "full",
    offset: 0,
    face: "left",
    startPost: true,
    endPost: true,
    cornerAlign: "bisect",
    spacing: "equal",
    distance: 2400,
    postShape: "square",
    postWidth: 100,
    postDepth: 100,
    footer: "none",
    footerWidth: 300,
    footerDepth: 300,
    drainage: 0,
    rails: 2,
    railWidth: 38,
    continuousRail: false,
    railOffset: "centre",
    railCustom: 0,
    switchSides: false,
    railExtend: 0,
    infill: "vertical",
    continuousInfill: false,
    infillOffset: 0,
    infillWidth: 100,
    infillThickness: 19,
    infillSpacing: 110,
    diagonal: 0,
    gravelBoard: false,
    gravelThickness: 22,
  };

  async preferences(): Promise<void> {
    const f = this.f;
    const v = await toolPrefs(
      "Fence Preferences",
      [
        { kind: "choice", key: "draw", label: "Draw 2D", value: f.draw, options: DRAWS },
        { kind: "length", key: "offset", label: "Offset from Path", value: f.offset, zero: true, signed: true },
        { kind: "choice", key: "face", label: "Fence Face", value: f.face, options: FACES },
        { kind: "check", key: "startPost", label: "Use post at start", value: f.startPost },
        { kind: "check", key: "endPost", label: "Use post at end", value: f.endPost },
        { kind: "choice", key: "cornerAlign", label: "Corner Post Alignment", value: f.cornerAlign, options: ALIGNS },
        { kind: "choice", key: "spacing", label: "Post Spacing", value: f.spacing, options: SPACINGS },
        { kind: "length", key: "distance", label: "Distance", value: f.distance },
        { kind: "choice", key: "postShape", label: "Post Profile", value: f.postShape, options: SHAPES },
        { kind: "length", key: "postWidth", label: "Post Width", value: f.postWidth },
        { kind: "length", key: "postDepth", label: "Post Depth", value: f.postDepth },
        { kind: "choice", key: "footer", label: "Add footer", value: f.footer, options: FOOTERS },
        { kind: "length", key: "footerWidth", label: "Footer Width or Diameter", value: f.footerWidth },
        { kind: "length", key: "footerDepth", label: "Footer Depth", value: f.footerDepth },
        { kind: "length", key: "drainage", label: "Drainage Layer", value: f.drainage, zero: true },
        { kind: "number", key: "rails", label: "Number of Rails Vertically", value: f.rails, min: 0, max: 20, integer: true },
        { kind: "length", key: "railWidth", label: "Rail Width", value: f.railWidth },
        { kind: "check", key: "continuousRail", label: "Continuous rail", value: f.continuousRail },
        { kind: "choice", key: "railOffset", label: "Rail Offset to Post", value: f.railOffset, options: RAIL_OFFSETS },
        { kind: "length", key: "railCustom", label: "Custom Offset", value: f.railCustom, zero: true, signed: true },
        { kind: "check", key: "switchSides", label: "Switch side for the offset every other segment", value: f.switchSides },
        { kind: "length", key: "railExtend", label: "Rail extends beyond post side", value: f.railExtend, zero: true },
        { kind: "choice", key: "infill", label: "Infill Type", value: f.infill, options: INFILLS },
        { kind: "check", key: "continuousInfill", label: "Continuous coverage", value: f.continuousInfill },
        { kind: "length", key: "infillOffset", label: "Infill Offset", value: f.infillOffset, zero: true, signed: true },
        { kind: "length", key: "infillWidth", label: "Infill Width", value: f.infillWidth },
        { kind: "length", key: "infillThickness", label: "Infill Thickness", value: f.infillThickness },
        { kind: "length", key: "infillSpacing", label: "Optimal Spacing", value: f.infillSpacing },
        { kind: "number", key: "diagonal", label: "Rotate vertical infill diagonally by", value: f.diagonal, min: -90, max: 90, unit: "°" },
        { kind: "check", key: "gravelBoard", label: "Add gravel board", value: f.gravelBoard },
        { kind: "length", key: "gravelThickness", label: "Gravel Board Thickness", value: f.gravelThickness },
      ],
      "Drawn in plan along the clicked path, the Offset from Path to its right (negative: left). Each segment has a post at both ends, the fence's own ends only when used, and posts between: Fixed Distance steps the Distance from the segment's start (its last bay shorter), Equal Spacing divides it evenly near the Distance; a panel's Infill Width spaces them between faces instead. Corner posts line up with the segment before, after, or between. Rails meet the posts' faces (or run past them by the extension); rails one over another fall in one place in plan, so the number only turns them off at 0. Infill sits on the rails' front, the Fence Face side (a panel and the gravel board centred on the posts), between posts unless continuous. Footers and drainage lie below grade in the drawing's first dashed line type, left out in a drawing without one. Styles, profile and gate symbols, heights, raked or stepped slopes, sending to the surface, classes and 3D aren't offered.",
    );
    if (!v) return;
    this.f = {
      draw: pick(DRAWS, v.choice("draw"), "full"),
      offset: v.num("offset"),
      face: pick(FACES, v.choice("face"), "left"),
      startPost: v.flag("startPost"),
      endPost: v.flag("endPost"),
      cornerAlign: pick(ALIGNS, v.choice("cornerAlign"), "bisect"),
      spacing: pick(SPACINGS, v.choice("spacing"), "equal"),
      distance: v.num("distance"),
      postShape: pick(SHAPES, v.choice("postShape"), "square"),
      postWidth: v.num("postWidth"),
      postDepth: v.num("postDepth"),
      footer: pick(FOOTERS, v.choice("footer"), "none"),
      footerWidth: v.num("footerWidth"),
      footerDepth: v.num("footerDepth"),
      drainage: v.num("drainage"),
      rails: v.num("rails"),
      railWidth: v.num("railWidth"),
      continuousRail: v.flag("continuousRail"),
      railOffset: pick(RAIL_OFFSETS, v.choice("railOffset"), "centre"),
      railCustom: v.num("railCustom"),
      switchSides: v.flag("switchSides"),
      railExtend: v.num("railExtend"),
      infill: pick(INFILLS, v.choice("infill"), "vertical"),
      continuousInfill: v.flag("continuousInfill"),
      infillOffset: v.num("infillOffset"),
      infillWidth: v.num("infillWidth"),
      infillThickness: v.num("infillThickness"),
      infillSpacing: v.num("infillSpacing"),
      diagonal: v.num("diagonal"),
      gravelBoard: v.flag("gravelBoard"),
      gravelThickness: v.num("gravelThickness"),
    };
  }

  protected startHint(): string {
    return "Click the fence's start";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = fence(points, closed, this.f);
    if (typeof plan === "string") return plan;
    const dashed = dashedStyle();
    const hidden = dashed === undefined ? [] : drawn(plan.hidden).map((shape): Part => ({ shape, attrs: { lineStyle: dashed } }));
    const line = plan.line.map((points): Part => ({ kind: "polyline", points, closed: false }));
    return [...hidden, ...drawn(plan.infill), ...drawn(plan.rails), ...drawn(plan.posts), ...line];
  }
}
