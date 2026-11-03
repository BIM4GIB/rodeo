// Event Design's Stage Deck, Stage Plug, Stage Steps, Stage Ramp and Rope and Stanchion
// (stageShapes.ts). Vectorworks makes plug-in objects of them, with 3D; these draw what those
// objects draw in Top/Plan, as plain 2D objects grouped in the active class. Their heights,
// thicknesses, trims, casters, colours, labels and 3D aren't drawn.
//
// Stage Deck, Stage Steps and Stage Ramp take a click, or a press dragged to turn them (Shift in
// 15° steps): a deck with its middle on the point, its front toward the drag; steps or a ramp with
// the middle of their top (where they meet the stage) on the point, coming down toward the drag.
// A click alone faces them down the screen. Stage Plug and Rope and Stanchion click a path as
// Railing/Fence does: a plug's outline (closed even when ended open), a barrier's line.
//
// Legs and inside stringers stand out of sight under a deck or steps: they're drawn in the
// drawing's first dashed line type, and left out in a drawing without one (a deck-only
// structure's legs are loci, and Hide Deck shows a braced deck's legs and braces plainly).

import type { NewShape, Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import {
  MAX_LEGS,
  MAX_STANCHIONS,
  RAIL_WIDTH,
  ropeAndStanchion,
  stageDeck,
  stagePlug,
  stageRamp,
  stageSteps,
  TOE_THICKNESS,
  type DeckRail,
  type EndStanchions,
  type LegProfile,
  type Legs,
  type RampBasis,
  type RopeStanchion,
  type StageDeck,
  type StagePlan,
  type StageRamp,
  type StageSteps,
  type StageStructure,
  type StepStructure,
  type StringerKind,
  type StringerType,
  type TravelArrow,
} from "../stageShapes.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { placedDrawing } from "./circulation.ts";
import { layerScale, PlaceTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** the UP or DN by steps' and ramps' arrows, on paper, mm */
const TEXT_MM = 2.5;
/** a drag points a deck's front (its own −y), a quarter turn from its +x; steps and ramps come down their own +x */
const FACING = Math.PI / 2;

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const DECK_STRUCTURES: Options<StageStructure> = [
  { value: "simple", label: "Simple" },
  { value: "border", label: "Border" },
  { value: "deckOnly", label: "Deck Only" },
  { value: "legsBasic", label: "Legs-Basic" },
  { value: "legsBraced", label: "Legs-Braced" },
];
const LEG_PROFILES: Options<LegProfile> = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "octagon", label: "Octagonal" },
];
const RAILS: Options<DeckRail> = [
  { value: "none", label: "None" },
  { value: "straight", label: "Straight" },
  { value: "toe", label: "Toe" },
  { value: "straightToe", label: "Straight + Toe" },
];
const STEP_STRUCTURES: Options<StepStructure> = [
  { value: "simple", label: "Simple" },
  { value: "solid", label: "Solid Free-Standing" },
  { value: "open", label: "Open Free-Standing" },
  { value: "frame", label: "Frame Free-Standing" },
  { value: "selfAdjusting", label: "Self-Adjusting" },
];
const STRINGER_TYPES: Options<StringerType> = [
  { value: "inside", label: "Inside (under the treads)" },
  { value: "outside", label: "Outside (beside the treads)" },
];
const ARROWS: Options<TravelArrow> = [
  { value: "none", label: "None" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const RAMP_STRUCTURES: Options<"simple" | "legsBasic"> = [
  { value: "simple", label: "Simple" },
  { value: "legsBasic", label: "Legs-Basic" },
];
const RAMP_BASES: Options<RampBasis> = [
  { value: "rampLength", label: "Ramp Length" },
  { value: "floorLength", label: "Floor Length" },
  { value: "angle", label: "Pitch Angle" },
  { value: "ratio", label: "Pitch Ratio" },
  { value: "percent", label: "Pitch Percent" },
];
const STRINGERS: Options<StringerKind> = [
  { value: "belt", label: "Belt" },
  { value: "rope", label: "Rope" },
  { value: "chain", label: "Chain" },
];
const ENDS: Options<EndStanchions> = [
  { value: "both", label: "Both" },
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "none", label: "None" },
];

/** A stage plan's parts placed at `at`, turned by `angle`: what shows, what's out of sight under it (dashed, or left out without a dashed line type), and its loci. */
function stageParts(plan: StagePlan, at: Pt, angle: number): Part[] {
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  const place = (pts: readonly Pt[]): Pt[] => placed(pts, at, angle);
  const hidden = (pts: Pt[]): Part => {
    const shape: NewShape = pts.length > 2 ? { kind: "polygon", points: place(pts), closed: true } : { kind: "polyline", points: place(pts), closed: false };
    return { shape, attrs: { lineStyle: dashed!.style } };
  };
  return [
    ...markerParts(placedDrawing(plan, at, angle)),
    ...(dashed ? plan.hidden.map(hidden) : []),
    ...plan.loci.map((p): Part => ({ kind: "locus", at: place([p])[0] })),
  ];
}

const HIDDEN_NOTE = "Legs and inside stringers stand out of sight underneath: they're drawn in the drawing's first dashed line type, and left out in a drawing without one.";

const legFields = (l: Legs): PrefField[] => [
  { kind: "length", key: "legDiameter", label: "Leg Diameter", value: l.diameter },
  { kind: "choice", key: "legProfile", label: "Leg Profile", value: l.profile, options: LEG_PROFILES },
  { kind: "length", key: "spacing", label: "Reference Spacing", value: l.spacing },
];

const legsFrom = (v: PrefValues, structure: StageStructure, hideDeck: boolean): Legs => ({
  structure,
  diameter: v.num("legDiameter"),
  profile: pick(LEG_PROFILES, v.choice("legProfile"), "round"),
  spacing: v.num("spacing"),
  hideDeck,
});

const railFields = (r: { left: boolean; right: boolean; extraRails: number }): PrefField[] => [
  { kind: "check", key: "left", label: "Show Left Railing", value: r.left },
  { kind: "check", key: "right", label: "Show Right Railing", value: r.right },
  { kind: "number", key: "extraRails", label: "Add'l Railings", value: r.extraRails, min: 0, max: 50, integer: true },
];

const arrowFields = (arrow: TravelArrow, size: number): PrefField[] => [
  { kind: "choice", key: "arrow", label: "Draw Arrow", value: arrow, options: ARROWS },
  { kind: "length", key: "arrowSize", label: "Arrow Size", value: size },
];

export class StageDeckTool extends PlaceTool {
  readonly id = "stagedeck";
  readonly cursor = "crosshair";
  protected readonly label = "Stage Deck";
  protected readonly clickAngle = -FACING;
  private d: StageDeck = {
    shape: "rect",
    width: 2440,
    depth: 1220,
    radius: 1220,
    sweep: 180,
    rails: ["none", "none", "none", "none"],
    structure: "simple",
    diameter: 50,
    profile: "round",
    spacing: 1220,
    hideDeck: false,
  };

  async preferences(): Promise<void> {
    const d = this.d;
    const rail = (key: string, label: string, i: number): PrefField => ({ kind: "choice", key, label, value: d.rails[i] ?? "none", options: RAILS });
    const v = await toolPrefs(
      "Stage Deck Preferences",
      [
        {
          kind: "choice",
          key: "shape",
          label: "Deck Shape",
          value: d.shape,
          options: [
            { value: "rect", label: "Rectangular" },
            { value: "round", label: "Round" },
          ],
        },
        { kind: "length", key: "width", label: "Width", value: d.width },
        { kind: "length", key: "depth", label: "Depth", value: d.depth },
        { kind: "length", key: "radius", label: "Radius", value: d.radius },
        { kind: "number", key: "sweep", label: "Sweep Angle", value: d.sweep, min: 1, max: 360, unit: "°" },
        { kind: "choice", key: "structure", label: "Structure", value: d.structure, options: DECK_STRUCTURES },
        { kind: "check", key: "hideDeck", label: "Hide Deck (Legs-Braced)", value: d.hideDeck },
        ...legFields(d),
        rail("rail0", "Front / Start Radius Railing", 0),
        rail("rail1", "Right / Arc Railing", 1),
        rail("rail2", "Back / End Radius Railing", 2),
        rail("rail3", "Left Railing", 3),
      ],
      `The deck's middle goes on the click, its front toward the drag (down the screen for a click). A round deck sweeps its angle about its centre, centred on its front. A rectangular deck's railings are its front, right, back and left; a round one's its start radius, arc and end radius. Legs stand half a diameter in from the edge, at the corners and evenly between no further apart than the Reference Spacing, then on a grid that far apart inside; up to ${MAX_LEGS}. A deck-only structure marks them with loci. ${HIDDEN_NOTE} Railings run inside each side: a top rail ${RAIL_WIDTH} mm wide from above (hiding a toe board under it), a toe board alone ${TOE_THICKNESS} mm.`,
    );
    if (!v) return;
    const shape = v.choice("shape") === "round" ? "round" : "rect";
    const structure = pick(DECK_STRUCTURES, v.choice("structure"), "simple");
    this.d = {
      ...legsFrom(v, structure, v.flag("hideDeck")),
      shape,
      width: v.num("width"),
      depth: v.num("depth"),
      radius: v.num("radius"),
      sweep: v.num("sweep"),
      rails: [0, 1, 2, 3].map((i) => pick(RAILS, v.choice(`rail${i}`), "none")),
    };
  }

  hint(): string {
    return `${super.hint()} · the deck's middle on the point, its front toward the drag`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = stageDeck(this.d);
    return typeof plan === "string" ? null : stageParts(plan, at, angle + FACING);
  }

  protected refusal(): string {
    const plan = stageDeck(this.d);
    return typeof plan === "string" ? plan : "The stage deck can't be drawn.";
  }
}

export class StagePlugTool extends PathTool {
  readonly id = "stageplug";
  protected readonly label = "Stage Plug";
  private legs: Legs = { structure: "simple", diameter: 50, profile: "round", spacing: 1220, hideDeck: false };

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Stage Plug Preferences",
      [{ kind: "choice", key: "structure", label: "Structure", value: this.legs.structure, options: DECK_STRUCTURES.filter((s) => s.value !== "legsBraced") }, ...legFields(this.legs)],
      `The plug fills the outline clicked, closed even when ended open. Legs stand as a deck's do: at its corners and evenly along its sides no further apart than the Reference Spacing, then on a grid inside. A deck-only structure marks them with loci. ${HIDDEN_NOTE}`,
    );
    if (!v) return;
    this.legs = legsFrom(v, pick(DECK_STRUCTURES, v.choice("structure"), "simple"), false);
  }

  protected startHint(): string {
    return "Click the stage plug's first corner";
  }

  protected parts(points: Pt[]): Part[] | string {
    if (points.length < 3) return "Click three corners or more for the stage plug's outline.";
    const plan = stagePlug(points, this.legs);
    return typeof plan === "string" ? plan : stageParts(plan, { x: 0, y: 0 }, 0);
  }
}

export class StageStepsTool extends PlaceTool {
  readonly id = "stagesteps";
  readonly cursor = "crosshair";
  protected readonly label = "Stage Steps";
  protected readonly clickAngle = -FACING;
  private s: Omit<StageSteps, "textHeight"> = {
    structure: "simple",
    stageHeight: 1000,
    width: 1220,
    steps: 3,
    topStep: false,
    depth: 280,
    stringerLength: 1600,
    stringerWidth: 40,
    stringerType: "inside",
    extraStringers: 0,
    indent: 0,
    left: true,
    right: true,
    extraRails: 0,
    arrow: "up",
    arrowSize: 150,
  };

  async preferences(): Promise<void> {
    const s = this.s;
    const v = await toolPrefs(
      "Stage Steps Preferences",
      [
        { kind: "choice", key: "structure", label: "Structure", value: s.structure, options: STEP_STRUCTURES },
        { kind: "length", key: "height", label: "Stage Height", value: s.stageHeight },
        { kind: "length", key: "width", label: "Step Unit Width", value: s.width },
        { kind: "number", key: "steps", label: "Number of Steps", value: s.steps, min: 1, max: 200, integer: true },
        { kind: "check", key: "topStep", label: "Add Top Step at Stage Height", value: s.topStep },
        { kind: "length", key: "depth", label: "Single Step Depth", value: s.depth },
        { kind: "length", key: "stringerLength", label: "Stringer Length (self-adjusting)", value: s.stringerLength },
        { kind: "length", key: "stringerWidth", label: "Stringer Width", value: s.stringerWidth },
        { kind: "choice", key: "stringerType", label: "Stringer Type (open)", value: s.stringerType, options: STRINGER_TYPES },
        { kind: "number", key: "extraStringers", label: "Add'l Stringers (open, inside)", value: s.extraStringers, min: 0, max: 50, integer: true },
        { kind: "length", key: "indent", label: "Side Stringer Indent", value: s.indent, zero: true },
        ...arrowFields(s.arrow, s.arrowSize),
        ...railFields(s),
      ],
      `The middle of the top goes on the click (where the steps meet the stage), the steps coming down toward the drag (down the screen for a click). Each step is the Single Step Depth deep; self-adjusting steps instead spread their steps over the floor their Stringer Length reaches from the Stage Height. Self-adjusting steps have stringers beside the treads, open free-standing ones inside or outside. ${HIDDEN_NOTE} Railings are ${RAIL_WIDTH} mm wide from above, at the sides (on outside stringers), with Add'l Railings evenly between when both show; the arrow points up to the stage or down to the floor, "UP" or "DN" past its tail.`,
    );
    if (!v) return;
    this.s = {
      structure: pick(STEP_STRUCTURES, v.choice("structure"), "simple"),
      stageHeight: v.num("height"),
      width: v.num("width"),
      steps: v.num("steps"),
      topStep: v.flag("topStep"),
      depth: v.num("depth"),
      stringerLength: v.num("stringerLength"),
      stringerWidth: v.num("stringerWidth"),
      stringerType: pick(STRINGER_TYPES, v.choice("stringerType"), "inside"),
      extraStringers: v.num("extraStringers"),
      indent: v.num("indent"),
      left: v.flag("left"),
      right: v.flag("right"),
      extraRails: v.num("extraRails"),
      arrow: pick(ARROWS, v.choice("arrow"), "up"),
      arrowSize: v.num("arrowSize"),
    };
  }

  hint(): string {
    return `${super.hint()} · the top's middle on the point, coming down toward the drag`;
  }

  private steps(): StagePlan | string {
    return stageSteps({ ...this.s, textHeight: TEXT_MM * (layerScale(this.env) ?? 1) });
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = this.steps();
    return typeof plan === "string" ? null : stageParts(plan, at, angle);
  }

  protected refusal(): string {
    const plan = this.steps();
    return typeof plan === "string" ? plan : "The stage steps can't be drawn.";
  }
}

export class StageRampTool extends PlaceTool {
  readonly id = "stageramp";
  readonly cursor = "crosshair";
  protected readonly label = "Stage Ramp";
  protected readonly clickAngle = -FACING;
  private r: Omit<StageRamp, "textHeight"> = {
    structure: "simple",
    top: 600,
    bottom: 0,
    width: 1220,
    basis: "ratio",
    value: 12,
    legs: { structure: "legsBasic", diameter: 50, profile: "round", spacing: 1220, hideDeck: false },
    left: true,
    right: true,
    extraRails: 0,
    arrow: "up",
    arrowSize: 300,
  };

  async preferences(): Promise<void> {
    const r = this.r;
    const v = await toolPrefs(
      "Stage Ramp Preferences",
      [
        { kind: "choice", key: "structure", label: "Structure", value: r.structure, options: RAMP_STRUCTURES },
        { kind: "length", key: "top", label: "Top Height", value: r.top, zero: true, signed: true },
        { kind: "length", key: "bottom", label: "Bottom Height", value: r.bottom, zero: true, signed: true },
        { kind: "length", key: "width", label: "Width", value: r.width },
        { kind: "choice", key: "basis", label: "Create Based On", value: r.basis, options: RAMP_BASES },
        { kind: "number", key: "value", label: "Length, Angle, Ratio or Percent", value: r.value, min: 0, max: 1e7 },
        ...legFields(r.legs),
        ...arrowFields(r.arrow, r.arrowSize),
        ...railFields(r),
      ],
      `The middle of the top goes on the click (where the ramp meets the stage), the ramp coming down toward the drag (down the screen for a click). Its length on the floor comes from its rise (Top Height less Bottom Height) and what it's based on: a Ramp Length along the slope or a Floor Length in mm, a pitch Angle in degrees, a Ratio's run for each unit of rise (12 for 1:12), or a Percent grade. ${HIDDEN_NOTE} Railings are ${RAIL_WIDTH} mm wide from above, along the sides, with Add'l Railings evenly between when both show.`,
    );
    if (!v) return;
    const structure = pick(RAMP_STRUCTURES, v.choice("structure"), "simple");
    this.r = {
      structure,
      top: v.num("top"),
      bottom: v.num("bottom"),
      width: v.num("width"),
      basis: pick(RAMP_BASES, v.choice("basis"), "ratio"),
      value: v.num("value"),
      legs: legsFrom(v, "legsBasic", false),
      left: v.flag("left"),
      right: v.flag("right"),
      extraRails: v.num("extraRails"),
      arrow: pick(ARROWS, v.choice("arrow"), "up"),
      arrowSize: v.num("arrowSize"),
    };
  }

  hint(): string {
    return `${super.hint()} · the top's middle on the point, coming down toward the drag`;
  }

  private ramp(): StagePlan | string {
    return stageRamp({ ...this.r, textHeight: TEXT_MM * (layerScale(this.env) ?? 1) });
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = this.ramp();
    return typeof plan === "string" ? null : stageParts(plan, at, angle);
  }

  protected refusal(): string {
    const plan = this.ramp();
    return typeof plan === "string" ? plan : "The stage ramp can't be drawn.";
  }
}

export class RopeStanchionTool extends PathTool {
  readonly id = "ropestanchion";
  protected readonly label = "Rope and Stanchion";
  private r: RopeStanchion = {
    postDiameter: 63,
    base: "round",
    baseWidth: 350,
    stringer: "belt",
    stringerLength: 2000,
    ropeDiameter: 38,
    linkLength: 50,
    idealSpacing: 1500,
    ends: "both",
  };

  async preferences(): Promise<void> {
    const r = this.r;
    const v = await toolPrefs(
      "Rope and Stanchion Preferences",
      [
        { kind: "length", key: "post", label: "Post Diameter", value: r.postDiameter },
        {
          kind: "choice",
          key: "base",
          label: "Base Type",
          value: r.base,
          options: [
            { value: "round", label: "Round" },
            { value: "square", label: "Square" },
          ],
        },
        { kind: "length", key: "baseWidth", label: "Base Width", value: r.baseWidth },
        { kind: "choice", key: "stringer", label: "Stringer Type", value: r.stringer, options: STRINGERS },
        { kind: "length", key: "length", label: "Belt/Rope/Chain Length", value: r.stringerLength },
        { kind: "length", key: "rope", label: "Rope Diameter", value: r.ropeDiameter },
        { kind: "length", key: "link", label: "Single Link Length", value: r.linkLength },
        { kind: "length", key: "spacing", label: "Ideal Spacing", value: r.idealSpacing },
        { kind: "choice", key: "ends", label: "End Stanchions", value: r.ends, options: ENDS },
      ],
      `Stanchions stand at each corner of the path and evenly between, no further apart than the Ideal Spacing or the belt's, rope's or chain's length; up to ${MAX_STANCHIONS}. End Stanchions leaves the open path's first or last one off (a closed path has no ends). A belt shows edge on as a line, a rope as a band its diameter wide, a chain as links lying flat and on edge by turns.`,
    );
    if (!v) return;
    this.r = {
      postDiameter: v.num("post"),
      base: v.choice("base") === "square" ? "square" : "round",
      baseWidth: v.num("baseWidth"),
      stringer: pick(STRINGERS, v.choice("stringer"), "belt"),
      stringerLength: v.num("length"),
      ropeDiameter: v.num("rope"),
      linkLength: v.num("link"),
      idealSpacing: v.num("spacing"),
      ends: pick(ENDS, v.choice("ends"), "both"),
    };
  }

  protected startHint(): string {
    return "Click the barrier's start";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = ropeAndStanchion(points, closed, this.r);
    return typeof plan === "string" ? plan : stageParts(plan, { x: 0, y: 0 }, 0);
  }
}
