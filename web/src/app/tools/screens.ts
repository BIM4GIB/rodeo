// Event Design's Soft Goods, Television, Video Screen, Blended Screen, LED Screen and Speaker
// (softGoodsShapes.ts, screenShapes.ts, mepShapes.ts). Vectorworks makes plug-in objects of them,
// with 3D; these draw what those objects draw in Top/Plan, as plain 2D objects grouped in the
// active class. Heights, trims, materials, weights, images, labels and 3D aren't drawn.
//
// Soft Goods clicks a path as Railing/Fence does: a curtain or border along it, or a
// pipe-and-drape run. Television, Video Screen, Blended Screen and LED Screen take a click, or a
// press dragged to turn them (Shift in 15° steps), facing the drag (down the screen for a click):
// a television with the middle of its back on the point, a screen or LED array with the middle of
// its face.
// Speaker does the same with the speaker's middle on the point, its dispersion lines and coverage
// shadow thrown from its front.
// Centre lines and a curtain's open stretch are drawn in the drawing's first dashed line type, and
// left out in a drawing without one; coverage zones are drawn unfilled.

import type { NewShape, Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import { MAX_ARRAY_BOXES, speaker, speakerArray, type ArraySpeaker, type Speaker, type SpeakerArray, type SpeakerPlan } from "../mepShapes.ts";
import { blendAreas, blendedScreen, ledScreen, MAX_AREAS, MAX_MODULES, television, videoScreen, type BlendedScreen, type Coverage, type LedBase, type LedBasis, type LedScreen, type LedShape, type MultipleProjector, type ScreenFeet, type ScreenFrame, type ScreenPlan, type ScreenSupport, type ScreenType, type Television, type TvType, type VideoScreen, type ZoneReference } from "../screenShapes.ts";
import { MAX_UPRIGHTS, PIPE_DIAMETER, softGoods, type CurtainOpening, type EndMarks, type SoftGoods, type SoftGoodsFunction } from "../softGoodsShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import type { ToolModes } from "../tools.ts";
import { placedDrawing } from "./circulation.ts";
import { PlaceTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a drag points a screen's face (its own −y), a quarter turn from its +x */
const FACING = Math.PI / 2;

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const FUNCTIONS: Options<SoftGoodsFunction> = [
  { value: "curtain", label: "Curtain" },
  { value: "border", label: "Border" },
  { value: "pipeDrape", label: "Pipe-and-Drape" },
];
const MARKS: Options<EndMarks> = [
  { value: "none", label: "None" },
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "both", label: "Both" },
];
const OPENINGS: Options<CurtainOpening> = [
  { value: "none", label: "None" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "centre", label: "Center" },
];
const TV_TYPES: Options<TvType> = [
  { value: "flat", label: "Flat Panel" },
  { value: "crt", label: "CRT" },
  { value: "crtCurved", label: "CRT Curved" },
];
const TV_ASPECTS: Options<"4:3" | "16:9"> = [
  { value: "4:3", label: "4:3 (Standard)" },
  { value: "16:9", label: "16:9 (Wide screen)" },
];
const REFERENCES: Options<ZoneReference> = [
  { value: "width", label: "Width" },
  { value: "height", label: "Height" },
  { value: "diagonal", label: "Diagonal" },
];
const SCREEN_TYPES: Options<ScreenType> = [
  { value: "front", label: "Front Projection" },
  { value: "rear", label: "Rear Projection" },
  { value: "led", label: "LED Screen" },
];
const SCREEN_ASPECTS: Options<string> = [
  { value: "1.3333", label: "4:3" },
  { value: "1.6", label: "16:10" },
  { value: "1.7778", label: "16:9" },
  { value: "1.85", label: "1.85:1" },
  { value: "2.39", label: "2.39:1" },
  { value: "custom", label: "Custom (Width and Height)" },
];
const FRAMES: Options<ScreenFrame> = [
  { value: "none", label: "No Frame" },
  { value: "frame", label: "Frame" },
  { value: "border", label: "Border Only" },
];
const SUPPORTS: Options<ScreenSupport> = [
  { value: "none", label: "None" },
  { value: "goalpost", label: "Goalpost Legs" },
  { value: "tripod", label: "Tripod" },
  { value: "rollDown", label: "Roll-Down Case" },
  { value: "rollUp", label: "Roll-Up Case" },
];
const FEET: Options<ScreenFeet> = [
  { value: "both", label: "Both" },
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "none", label: "None" },
];
const MOTORS: Options<"left" | "right" | "none"> = [
  { value: "none", label: "None" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];
const LED_SHAPES: Options<LedShape> = [
  { value: "tileFlat", label: "Tile Flat" },
  { value: "tileCap", label: "Tile Cap" },
  { value: "diskFlat", label: "Disk Flat" },
  { value: "diskCap", label: "Disk Cap" },
  { value: "tube", label: "Tube" },
  { value: "dome", label: "Dome" },
];
const LED_BASES: Options<LedBasis> = [
  { value: "countsSpacing", label: "Module Counts and Spacing" },
  { value: "dimsSpacing", label: "Overall Dimensions and Spacing" },
  { value: "dimsCounts", label: "Overall Dimensions and Module Counts" },
];
const LED_STRUCTURES: Options<LedBase> = [
  { value: "blocks", label: "Blocks" },
  { value: "frame", label: "Frame" },
  { value: "curtain", label: "Curtain" },
  { value: "web", label: "Web" },
  { value: "vertStrips", label: "Vert. Strips" },
  { value: "horizStrips", label: "Horiz. Strips" },
  { value: "none", label: "None" },
];

/** The drawing's first dashed line type, for what's drawn dashed. */
const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

/** A screen plan's parts placed at `at`, turned by `angle`: its own, and its coverage zone unfilled. */
export function screenParts(plan: ScreenPlan, at: Pt, angle: number): Part[] {
  return [
    ...markerParts(placedDrawing(plan, at, angle)),
    ...plan.zone.map((z): Part => ({ shape: { kind: "polygon", points: placed(z, at, angle), closed: true }, attrs: { fillPattern: 0 } })),
  ];
}

const DASHED_NOTE = "drawn in the drawing's first dashed line type, and left out in a drawing without one";

export class SoftGoodsTool extends PathTool {
  readonly id = "softgoods";
  protected readonly label = "Soft Goods";
  private g: SoftGoods = {
    fn: "curtain",
    centreline: false,
    markers: "none",
    pipe: false,
    track: false,
    trackWidth: 100,
    opening: "none",
    openingWidth: 2000,
    centreOverlap: 300,
    ghost: true,
    reverse: false,
    adjustStart: 0,
    adjustEnd: 0,
    stockWidth: 1500,
    minOverlap: 150,
    fullness: 50,
    breaks: false,
    overlaps: false,
    simple: false,
    pleatWidth: 300,
    pleatDepth: 150,
    flip: false,
    doubleWall: false,
    sliders: true,
    sliderLength: 2440,
    baseSize: 457,
    baseRound: false,
    endHardware: "both",
  };

  async preferences(): Promise<void> {
    const g = this.g;
    const v = await toolPrefs(
      "Soft Goods Preferences",
      [
        { kind: "choice", key: "fn", label: "Function", value: g.fn, options: FUNCTIONS },
        { kind: "check", key: "centreline", label: "Show centerline", value: g.centreline },
        { kind: "choice", key: "markers", label: "Show Markers", value: g.markers, options: MARKS },
        { kind: "check", key: "pipe", label: "Add pipe", value: g.pipe },
        { kind: "check", key: "track", label: "Add track", value: g.track },
        { kind: "length", key: "trackWidth", label: "Track Width", value: g.trackWidth },
        { kind: "choice", key: "opening", label: "Open From", value: g.opening, options: OPENINGS },
        { kind: "length", key: "openingWidth", label: "Opening Width", value: g.openingWidth, zero: true },
        { kind: "length", key: "centreOverlap", label: "Center Overlap", value: g.centreOverlap, zero: true },
        { kind: "check", key: "ghost", label: "Show ghost curtain", value: g.ghost },
        { kind: "check", key: "reverse", label: "Reverse side (border)", value: g.reverse },
        { kind: "length", key: "adjustStart", label: "Adjust Starting (border)", value: g.adjustStart, zero: true },
        { kind: "length", key: "adjustEnd", label: "Adjust Ending (border)", value: g.adjustEnd, zero: true },
        { kind: "length", key: "stock", label: "Stock Drape Width", value: g.stockWidth },
        { kind: "length", key: "minOverlap", label: "Minimum Overlap", value: g.minOverlap, zero: true },
        { kind: "number", key: "fullness", label: "Vertical Tied Fullness", value: g.fullness, min: 0, max: 1000, unit: "%" },
        { kind: "check", key: "breaks", label: "Show drape breaks", value: g.breaks },
        { kind: "check", key: "overlaps", label: "Show overlap", value: g.overlaps },
        { kind: "check", key: "simple", label: "Simple 2D", value: g.simple },
        { kind: "length", key: "pleatWidth", label: "Pleat Width (Visual Only)", value: g.pleatWidth },
        { kind: "length", key: "pleatDepth", label: "Pleat Depth (Visual Only)", value: g.pleatDepth },
        { kind: "check", key: "flip", label: "Flip pleats", value: g.flip },
        { kind: "check", key: "doubleWall", label: "Double wall (pipe-and-drape)", value: g.doubleWall },
        { kind: "check", key: "sliders", label: "Show slider(s)", value: g.sliders },
        { kind: "length", key: "sliderLength", label: "Slider Target Length", value: g.sliderLength },
        { kind: "check", key: "baseRound", label: "Round boom base", value: g.baseRound },
        { kind: "length", key: "baseSize", label: "Base Size/Diameter", value: g.baseSize },
        { kind: "choice", key: "endHardware", label: "End Hardware", value: g.endHardware, options: MARKS },
      ],
      `A curtain's pleats wave about the path, a border's to its left (its right with Reverse side), each a Pleat Width long and Pleat Depth deep. A curtain open from the left, right or center leaves that much of its run open, ${DASHED_NOTE} as its ghost, as is the centerline. Stock drapes, each covering its width over 1 + the fullness of the run and overlapping the next by at least the Minimum Overlap, are counted to mark where they break and overlap. The pipe is ${PIPE_DIAMETER} mm across. Pipe-and-drape stands uprights on base plates at each corner and evenly between, about a slider length apart (up to ${MAX_UPRIGHTS}), End Hardware choosing which open ends get one; a double wall hangs a drape either side.`,
    );
    if (!v) return;
    this.g = {
      fn: pick(FUNCTIONS, v.choice("fn"), "curtain"),
      centreline: v.flag("centreline"),
      markers: pick(MARKS, v.choice("markers"), "none"),
      pipe: v.flag("pipe"),
      track: v.flag("track"),
      trackWidth: v.num("trackWidth"),
      opening: pick(OPENINGS, v.choice("opening"), "none"),
      openingWidth: v.num("openingWidth"),
      centreOverlap: v.num("centreOverlap"),
      ghost: v.flag("ghost"),
      reverse: v.flag("reverse"),
      adjustStart: v.num("adjustStart"),
      adjustEnd: v.num("adjustEnd"),
      stockWidth: v.num("stock"),
      minOverlap: v.num("minOverlap"),
      fullness: v.num("fullness"),
      breaks: v.flag("breaks"),
      overlaps: v.flag("overlaps"),
      simple: v.flag("simple"),
      pleatWidth: v.num("pleatWidth"),
      pleatDepth: v.num("pleatDepth"),
      flip: v.flag("flip"),
      doubleWall: v.flag("doubleWall"),
      sliders: v.flag("sliders"),
      sliderLength: v.num("sliderLength"),
      baseRound: v.flag("baseRound"),
      baseSize: v.num("baseSize"),
      endHardware: pick(MARKS, v.choice("endHardware"), "both"),
    };
  }

  protected startHint(): string {
    return "Click the soft goods' start";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = softGoods(points, closed, this.g);
    if (typeof plan === "string") return plan;
    const dashed = dashedStyle();
    const line = (pts: Pt[]): Part => ({ shape: { kind: "polyline", points: pts, closed: false } satisfies NewShape, attrs: { lineStyle: dashed! } });
    return [...markerParts(plan), ...(dashed === undefined ? [] : plan.hidden.map(line))];
  }
}

const coverageFields = (z: Coverage): PrefField[] => [
  { kind: "check", key: "zone", label: "Show Coverage Zone", value: z.show },
  { kind: "choice", key: "reference", label: "Zone Reference", value: z.reference, options: REFERENCES },
  { kind: "number", key: "maxAngle", label: "Max Horiz. Angle", value: z.maxAngle, min: 1, max: 89, unit: "°" },
  { kind: "number", key: "near", label: "Near Multiplier", value: z.near, min: 0, max: 1000 },
  { kind: "number", key: "far", label: "Far Multiplier", value: z.far, min: 0, max: 1000 },
];

const coverageFrom = (v: PrefValues): Coverage => ({
  show: v.flag("zone"),
  reference: pick(REFERENCES, v.choice("reference"), "width"),
  maxAngle: v.num("maxAngle"),
  near: v.num("near"),
  far: v.num("far"),
});

const ZONE_NOTE = "The coverage zone reaches from Near to Far times the reference dimension in front of the screen's middle, the Max Horiz. Angle either side of dead on; its vertical angle and viewing height aren't drawn.";

/** A screen tool's shared gesture: placed facing the drag, its plan or why it can't draw. */
abstract class ScreenTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected readonly clickAngle = -FACING;
  protected abstract plan(): ScreenPlan | string;

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = this.plan();
    return typeof plan === "string" ? null : screenParts(plan, at, angle + FACING);
  }

  protected refusal(): string {
    const plan = this.plan();
    return typeof plan === "string" ? plan : `The ${this.label.toLowerCase()} can't be drawn.`;
  }
}

export class TelevisionTool extends ScreenTool {
  readonly id = "television";
  protected readonly label = "Television";
  private aspect: "4:3" | "16:9" = "16:9";
  private t: Television = { type: "flat", aspect: 16 / 9, diagonal: 1397, stand: false, coverage: { show: false, reference: "width", maxAngle: 45, near: 1.5, far: 6 } };

  async preferences(): Promise<void> {
    const t = this.t;
    const v = await toolPrefs(
      "Television Preferences",
      [
        { kind: "choice", key: "type", label: "TV Type", value: t.type, options: TV_TYPES },
        { kind: "choice", key: "aspect", label: "Screen Aspect", value: this.aspect, options: TV_ASPECTS },
        { kind: "length", key: "size", label: "Size (diagonal)", value: t.diagonal },
        { kind: "check", key: "stand", label: "Add Adjustable Stand (flat panel)", value: t.stand },
        ...coverageFields(t.coverage),
      ],
      `The middle of its back goes on the click, its screen facing the drag (down the screen for a click). A flat panel's casing is 60 mm deep with a narrow bezel round the image, its stand's base under it; a CRT is about as deep as it's wide, tapering back from its bezel (a curved CRT's face bulging), and can't be 16:9 when curved. ${ZONE_NOTE} Casing models from a library aren't offered.`,
    );
    if (!v) return;
    this.aspect = v.choice("aspect") === "4:3" ? "4:3" : "16:9";
    this.t = { type: pick(TV_TYPES, v.choice("type"), "flat"), aspect: this.aspect === "4:3" ? 4 / 3 : 16 / 9, diagonal: v.num("size"), stand: v.flag("stand"), coverage: coverageFrom(v) };
  }

  hint(): string {
    return `${super.hint()} · the middle of its back on the point, facing the drag`;
  }

  protected plan(): ScreenPlan | string {
    return television(this.t);
  }
}

export class VideoScreenTool extends ScreenTool {
  readonly id = "videoscreen";
  protected readonly label = "Video Screen";
  private aspect = "1.3333";
  private s: VideoScreen = {
    type: "front",
    width: 3658,
    height: 2743,
    frame: "border",
    borderLeft: 150,
    borderRight: 150,
    frameDepth: 75,
    support: "goalpost",
    feet: "both",
    caseDepth: 200,
    motor: "none",
    centreline: false,
    projector: true,
    cone: true,
    throwRatio: 1.5,
    coverage: { show: false, reference: "height", maxAngle: 45, near: 2, far: 6 },
  };

  async preferences(): Promise<void> {
    const s = this.s;
    const v = await toolPrefs(
      "Video Screen Preferences",
      [
        { kind: "choice", key: "type", label: "Screen Type", value: s.type, options: SCREEN_TYPES },
        { kind: "choice", key: "aspect", label: "Aspect", value: this.aspect, options: SCREEN_ASPECTS },
        { kind: "length", key: "width", label: "Width (image)", value: s.width },
        { kind: "length", key: "height", label: "Height (image, custom)", value: s.height },
        { kind: "choice", key: "frame", label: "Frame", value: s.frame, options: FRAMES },
        { kind: "length", key: "left", label: "Border Width Left", value: s.borderLeft, zero: true },
        { kind: "length", key: "right", label: "Border Width Right", value: s.borderRight, zero: true },
        { kind: "length", key: "depth", label: "Frame Depth", value: s.frameDepth },
        { kind: "choice", key: "support", label: "Screen Support", value: s.support, options: SUPPORTS },
        { kind: "choice", key: "feet", label: "Show Feet (goalpost)", value: s.feet, options: FEET },
        { kind: "length", key: "caseDepth", label: "Case Depth", value: s.caseDepth },
        { kind: "choice", key: "motor", label: "Case Motor", value: s.motor, options: MOTORS },
        { kind: "check", key: "centreline", label: "Show Centerline", value: s.centreline },
        { kind: "check", key: "projector", label: "Show Projector", value: s.projector },
        { kind: "check", key: "cone", label: "Show Projection Cone", value: s.cone },
        { kind: "number", key: "throw", label: "Throw Ratio", value: s.throwRatio, min: 0.1, max: 20 },
        ...coverageFields(s.coverage),
      ],
      `The middle of the image's face goes on the click, the screen facing the drag (down the screen for a click). The image is the Width across and, unless Custom, as high as the Aspect makes it; a frame or border adds its left and right widths, a frame its depth behind. Goalpost legs stand at its sides with feet front and back, a tripod behind it, a case along it (a motor adding room at one end). A front projector stands in front of it, a rear one behind, the Throw Ratio times the image's width away, its cone reaching the image's edges; an LED screen has none. ${ZONE_NOTE} Dress kits, stock sizes and projector models aren't offered.`,
    );
    if (!v) return;
    this.aspect = SCREEN_ASPECTS.find((a) => a.value === v.choice("aspect"))?.value ?? "1.3333";
    const width = v.num("width");
    this.s = {
      type: pick(SCREEN_TYPES, v.choice("type"), "front"),
      width,
      height: this.aspect === "custom" ? v.num("height") : width / Number(this.aspect),
      frame: pick(FRAMES, v.choice("frame"), "border"),
      borderLeft: v.num("left"),
      borderRight: v.num("right"),
      frameDepth: v.num("depth"),
      support: pick(SUPPORTS, v.choice("support"), "none"),
      feet: pick(FEET, v.choice("feet"), "both"),
      caseDepth: v.num("caseDepth"),
      motor: pick(MOTORS, v.choice("motor"), "none"),
      centreline: v.flag("centreline"),
      projector: v.flag("projector"),
      cone: v.flag("cone"),
      throwRatio: v.num("throw"),
      coverage: coverageFrom(v),
    };
  }

  hint(): string {
    return `${super.hint()} · the middle of its face on the point, facing the drag`;
  }

  protected plan(): ScreenPlan | string {
    return videoScreen(this.s);
  }
}

const PROJECTION_TYPES = SCREEN_TYPES.filter((t) => t.value !== "led");
const BLENDED_SUPPORTS = SUPPORTS.filter((t) => t.value === "none" || t.value === "goalpost" || t.value === "rollDown");
const PROJECTOR_ASPECTS: Options<string> = [
  { value: "1.3333", label: "4:3" },
  { value: "1.6", label: "16:10" },
  { value: "1.7778", label: "16:9" },
];
const MULTIPLES: Options<MultipleProjector> = [
  { value: "single", label: "Single" },
  { value: "stacked", label: "Stacked" },
  { value: "sideBySide", label: "Side-by-Side" },
];
const BLENDED_MODES = [
  { id: "screen", label: "Place Screen" },
  { id: "both", label: "Place Screen and Projector" },
] as const;

export class BlendedScreenTool extends ScreenTool {
  readonly id = "blendedscreen";
  protected readonly label = "Blended Screen";
  private b: BlendedScreen = {
    screen: {
      type: "front",
      width: 15000,
      height: 3375,
      frame: "border",
      borderLeft: 150,
      borderRight: 150,
      frameDepth: 75,
      support: "goalpost",
      feet: "both",
      caseDepth: 200,
      motor: "none",
      centreline: false,
      projector: false,
      cone: false,
      throwRatio: 1.5,
      coverage: { show: false, reference: "width", maxAngle: 45, near: 1, far: 3 },
    },
    projectorAspect: 16 / 9,
    overshoot: 0,
    areas: 3,
    throwRatio: 1.5,
    projectors: true,
    multiple: "single",
    horizSpace: 100,
    cones: true,
    centrelines: false,
  };
  private aspect = "1.7778";

  modes(): readonly ToolModes[] {
    return [{ label: "Blended Screen", options: BLENDED_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.b.projectors ? "both" : "screen" }];
  }

  setMode(id: string): void {
    if (id === "screen" || id === "both") this.b = { ...this.b, projectors: id === "both" };
  }

  async preferences(): Promise<void> {
    const b = this.b;
    const s = b.screen;
    const v = await toolPrefs(
      "Blended Screen Preferences",
      [
        { kind: "choice", key: "type", label: "Screen Type", value: s.type, options: PROJECTION_TYPES },
        { kind: "length", key: "width", label: "Width (image)", value: s.width },
        { kind: "length", key: "height", label: "Height (image)", value: s.height },
        { kind: "choice", key: "frame", label: "Frame", value: s.frame, options: FRAMES },
        { kind: "length", key: "left", label: "Border Width Left", value: s.borderLeft, zero: true },
        { kind: "length", key: "right", label: "Border Width Right", value: s.borderRight, zero: true },
        { kind: "length", key: "depth", label: "Frame Depth", value: s.frameDepth },
        { kind: "choice", key: "support", label: "Screen Support", value: s.support, options: BLENDED_SUPPORTS },
        { kind: "choice", key: "feet", label: "Show Feet (goalpost)", value: s.feet, options: FEET },
        { kind: "length", key: "caseDepth", label: "Case Depth", value: s.caseDepth },
        { kind: "choice", key: "motor", label: "Case Motor", value: s.motor, options: MOTORS },
        { kind: "check", key: "centreline", label: "Show Centerline", value: s.centreline },
        { kind: "choice", key: "aspect", label: "Projector Aspect", value: this.aspect, options: PROJECTOR_ASPECTS },
        { kind: "number", key: "overshoot", label: "Overshoot %", value: b.overshoot, min: 0, max: 99, unit: "%" },
        { kind: "number", key: "areas", label: "Area Horiz. Count", value: b.areas, min: 1, max: MAX_AREAS },
        { kind: "number", key: "throw", label: "Throw Ratio", value: b.throwRatio, min: 0.1, max: 20 },
        { kind: "choice", key: "multiple", label: "Multiple Projector", value: b.multiple, options: MULTIPLES },
        { kind: "length", key: "space", label: "Horiz Space", value: b.horizSpace, zero: true },
        { kind: "check", key: "cones", label: "Show Projection Cones", value: b.cones },
        { kind: "check", key: "centrelines", label: "Show Centerline (Area)", value: b.centrelines },
        ...coverageFields(s.coverage),
      ],
      `The middle of the image's face goes on the click, the screen facing the drag (down the screen for a click), drawn as Video Screen draws it. Projectors share its image in areas as high as the image plus the Overshoot and as wide as the Projector Aspect makes that: as many as Area Horiz. Count asks (never fewer than cover the width), overlapping evenly. Each stands the Throw Ratio times its area's width in front of the screen (behind it, rear projected), its cone reaching its area's edges; Stacked pairs are drawn as one from above, Side-by-Side pairs the Horiz Space apart. Place Screen (key 1) leaves the projectors out. ${ZONE_NOTE} Curved screens, dress kits, projector models and lenses, stands, heights, blend references, labels and loads aren't offered.`,
    );
    if (!v) return;
    this.aspect = PROJECTOR_ASPECTS.find((a) => a.value === v.choice("aspect"))?.value ?? "1.7778";
    this.b = {
      ...b,
      screen: {
        ...s,
        type: pick(PROJECTION_TYPES, v.choice("type"), "front"),
        width: v.num("width"),
        height: v.num("height"),
        frame: pick(FRAMES, v.choice("frame"), "border"),
        borderLeft: v.num("left"),
        borderRight: v.num("right"),
        frameDepth: v.num("depth"),
        support: pick(BLENDED_SUPPORTS, v.choice("support"), "none"),
        feet: pick(FEET, v.choice("feet"), "both"),
        caseDepth: v.num("caseDepth"),
        motor: pick(MOTORS, v.choice("motor"), "none"),
        centreline: v.flag("centreline"),
        coverage: coverageFrom(v),
      },
      projectorAspect: Number(this.aspect),
      overshoot: v.num("overshoot"),
      areas: v.num("areas"),
      throwRatio: v.num("throw"),
      multiple: pick(MULTIPLES, v.choice("multiple"), "single"),
      horizSpace: v.num("space"),
      cones: v.flag("cones"),
      centrelines: v.flag("centrelines"),
    };
    const blend = blendAreas(this.b.screen.width, this.b.screen.height, this.b.projectorAspect, this.b.overshoot, this.b.areas);
    if (typeof blend !== "string" && blend.count !== Math.round(this.b.areas)) toast(`${blend.count} projector areas are the fewest that cover the screen's width.`, "info");
  }

  hint(): string {
    return `${super.hint()} · the middle of its face on the point, facing the drag · 1–2 mode`;
  }

  protected plan(): ScreenPlan | string {
    return blendedScreen(this.b);
  }
}

export class LedScreenTool extends ScreenTool {
  readonly id = "ledscreen";
  protected readonly label = "LED Screen";
  private l: LedScreen = { shape: "tileFlat", width: 500, capDepth: 30, tubeVertical: true, tubeLength: 1000, basis: "countsSpacing", arrayWidth: 4000, spacing: 0, count: 8, base: "frame" };

  async preferences(): Promise<void> {
    const l = this.l;
    const v = await toolPrefs(
      "LED Screen Preferences",
      [
        { kind: "choice", key: "shape", label: "Module Shape", value: l.shape, options: LED_SHAPES },
        { kind: "length", key: "width", label: "Module Width", value: l.width },
        { kind: "length", key: "cap", label: "Cap Depth", value: l.capDepth },
        {
          kind: "choice",
          key: "tube",
          label: "Tube Orientation",
          value: l.tubeVertical ? "vertical" : "horizontal",
          options: [
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
          ],
        },
        { kind: "length", key: "tubeLength", label: "Tube Length", value: l.tubeLength },
        { kind: "choice", key: "basis", label: "Build Array Based On", value: l.basis, options: LED_BASES },
        { kind: "length", key: "arrayWidth", label: "Array Width", value: l.arrayWidth },
        { kind: "length", key: "spacing", label: "Horizontal Spacing", value: l.spacing, zero: true },
        { kind: "number", key: "count", label: "Horizontal Count", value: l.count, min: 1, max: MAX_MODULES, integer: true },
        { kind: "choice", key: "base", label: "Base Structure", value: l.base, options: LED_STRUCTURES },
      ],
      `The middle of the modules' faces goes on the click, facing the drag (down the screen for a click). From above the top row shows: tiles 80 mm deep, disks 40 mm, tubes and domes their width (a horizontal tube its length along the row), caps in front; the row's count and spacing come from what it's built on, the array width filled with as many as fit or the count spread across it. The base structure stands behind. Heights, vertical counts and pixels aren't drawn.`,
    );
    if (!v) return;
    this.l = {
      shape: pick(LED_SHAPES, v.choice("shape"), "tileFlat"),
      width: v.num("width"),
      capDepth: v.num("cap"),
      tubeVertical: v.choice("tube") !== "horizontal",
      tubeLength: v.num("tubeLength"),
      basis: pick(LED_BASES, v.choice("basis"), "countsSpacing"),
      arrayWidth: v.num("arrayWidth"),
      spacing: v.num("spacing"),
      count: v.num("count"),
      base: pick(LED_STRUCTURES, v.choice("base"), "frame"),
    };
  }

  hint(): string {
    return `${super.hint()} · the middle of its face on the point, facing the drag`;
  }

  protected plan(): ScreenPlan | string {
    return ledScreen(this.l);
  }
}

export class SpeakerTool extends ScreenTool {
  readonly id = "speaker";
  protected readonly label = "Speaker";
  private s: Speaker = {
    ceiling: false,
    frontWidth: 380,
    frontHeight: 600,
    backWidth: 300,
    backHeight: 500,
    depth: 380,
    grill: 250,
    cutout: 210,
    flip: false,
    asymmetric: false,
    horizFull: 90,
    horizLeft: 45,
    horizRight: 45,
    vertical: 60,
    throwDistance: 15000,
    elevation: 4000,
    listening: 1200,
    tilt: 10,
    dispersion: true,
  };

  async preferences(): Promise<void> {
    const s = this.s;
    const v = await toolPrefs(
      "Speaker Preferences",
      [
        { kind: "check", key: "ceiling", label: "Ceiling speaker", value: s.ceiling },
        { kind: "length", key: "frontWidth", label: "Front Width", value: s.frontWidth },
        { kind: "length", key: "frontHeight", label: "Front Height", value: s.frontHeight },
        { kind: "length", key: "backWidth", label: "Back Width", value: s.backWidth, zero: true },
        { kind: "length", key: "backHeight", label: "Back Height", value: s.backHeight, zero: true },
        { kind: "length", key: "depth", label: "Depth", value: s.depth },
        { kind: "length", key: "grill", label: "Grill Diameter", value: s.grill },
        { kind: "length", key: "cutout", label: "Cutout Diameter", value: s.cutout, zero: true },
        { kind: "check", key: "flip", label: "Flip orientation", value: s.flip },
        { kind: "check", key: "dispersion", label: "Show dispersion", value: s.dispersion },
        { kind: "check", key: "asymmetric", label: "Asymmetrical horizontal dispersion", value: s.asymmetric },
        { kind: "number", key: "horizFull", label: "Horiz. Dispersion Full", value: s.horizFull, min: 0, max: 180, unit: "°" },
        { kind: "number", key: "horizLeft", label: "Horiz. Dispersion Left", value: s.horizLeft, min: 0, max: 90, unit: "°" },
        { kind: "number", key: "horizRight", label: "Horiz. Dispersion Right", value: s.horizRight, min: 0, max: 90, unit: "°" },
        { kind: "number", key: "vertical", label: "Vert. Dispersion", value: s.vertical, min: 0, max: 180, unit: "°" },
        { kind: "length", key: "throw", label: "Throw Distance", value: s.throwDistance },
        { kind: "length", key: "elevation", label: "Elevation", value: s.elevation, zero: true, signed: true },
        { kind: "length", key: "listening", label: "Listening Height", value: s.listening, zero: true, signed: true },
        { kind: "number", key: "tilt", label: "Actual Tilt Angle", value: s.tilt, min: -90, max: 90, unit: "°" },
      ],
      `The speaker's middle goes on the click, its front facing the drag (down the screen for a click). A box tapers from its front face to its back (a back of 0 matches the front), its heights across the plan when flipped on its side; a ceiling speaker's grill is a circle, its housing's cutout ${DASHED_NOTE}. Dispersion lines run left, right and down the middle from the front, their length the throw distance tilted down (positive tilts down); the coverage shadow, drawn unfilled, is where the vertical dispersion meets the listening height within the throw. A ceiling speaker's shadow is the circle its horizontal spread covers below it. Catalog and symbol speakers, arrays, supports, labels, hatches, power and load data and 3D aren't offered.`,
    );
    if (!v) return;
    this.s = {
      ceiling: v.flag("ceiling"),
      frontWidth: v.num("frontWidth"),
      frontHeight: v.num("frontHeight"),
      backWidth: v.num("backWidth"),
      backHeight: v.num("backHeight"),
      depth: v.num("depth"),
      grill: v.num("grill"),
      cutout: v.num("cutout"),
      flip: v.flag("flip"),
      dispersion: v.flag("dispersion"),
      asymmetric: v.flag("asymmetric"),
      horizFull: v.num("horizFull"),
      horizLeft: v.num("horizLeft"),
      horizRight: v.num("horizRight"),
      vertical: v.num("vertical"),
      throwDistance: v.num("throw"),
      elevation: v.num("elevation"),
      listening: v.num("listening"),
      tilt: v.num("tilt"),
    };
  }

  hint(): string {
    return `${super.hint()} · its middle on the point, its front facing the drag`;
  }

  protected plan(): SpeakerPlan | string {
    return speaker(this.s);
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = this.plan();
    return typeof plan === "string" ? null : speakerParts(plan, at, angle);
  }
}

/** A speaker plan's parts, its hidden outlines dashed. */
function speakerParts(plan: SpeakerPlan, at: Pt, angle: number): Part[] {
  const dashed = dashedStyle();
  const turn = angle + FACING;
  const hidden = (pts: Pt[]): Part => ({ shape: { kind: "polygon", points: placed(pts, at, turn), closed: true }, attrs: { lineStyle: dashed! } });
  return [...screenParts(plan, at, turn), ...(dashed === undefined ? [] : plan.hidden.map(hidden))];
}

const ARRAY_KINDS = ["A", "B", "C"] as const;

/** Speaker Array: a column of line-array boxes hung from a bumper, in plan with its coverage. */
export class SpeakerArrayTool extends ScreenTool {
  readonly id = "speakerarray";
  protected readonly label = "Speaker Array";
  private a: Omit<SpeakerArray, "textHeight"> = {
    columnId: "L",
    bumperWidth: 1100,
    bumperDepth: 600,
    bumperHeight: 150,
    trim: 9000,
    bumperTilt: 0,
    kinds: [
      { count: 8, width: 1000, height: 300, depth: 500, horizontal: 110, vertical: 10, splay: 2 },
      { count: 4, width: 1000, height: 300, depth: 500, horizontal: 110, vertical: 10, splay: 5 },
      { count: 0, width: 1000, height: 300, depth: 500, horizontal: 110, vertical: 10, splay: 0 },
    ],
    listening: 1200,
    throwDistance: 40000,
    arrayAngles: false,
    dispersion: true,
    hoists: 2,
    guides: true,
  };

  async preferences(): Promise<void> {
    const a = this.a;
    const kindFields = (k: ArraySpeaker, n: string): PrefField[] => [
      { kind: "number", key: `${n}count`, label: `Speaker ${n} Count`, value: k.count, min: 0, max: MAX_ARRAY_BOXES, integer: true },
      { kind: "length", key: `${n}width`, label: `Speaker ${n} Width`, value: k.width },
      { kind: "length", key: `${n}height`, label: `Speaker ${n} Height`, value: k.height },
      { kind: "length", key: `${n}depth`, label: `Speaker ${n} Depth`, value: k.depth },
      { kind: "number", key: `${n}horizontal`, label: `Speaker ${n} Horiz. Dispersion`, value: k.horizontal, min: 0, max: 180, unit: "°" },
      { kind: "number", key: `${n}vertical`, label: `Speaker ${n} Vert. Dispersion`, value: k.vertical, min: 0, max: 180, unit: "°" },
      { kind: "number", key: `${n}splay`, label: `Speaker ${n} Angle Relative to Preceding`, value: k.splay, min: -90, max: 90, unit: "°" },
    ];
    const v = await toolPrefs(
      "Speaker Array Preferences",
      [
        { kind: "text", key: "columnId", label: "Column ID", value: a.columnId },
        { kind: "length", key: "bumperWidth", label: "Bumper Width", value: a.bumperWidth },
        { kind: "length", key: "bumperDepth", label: "Bumper Depth", value: a.bumperDepth },
        { kind: "length", key: "bumperHeight", label: "Bumper Height", value: a.bumperHeight, zero: true },
        { kind: "length", key: "trim", label: "Trim Height", value: a.trim, zero: true, signed: true },
        { kind: "number", key: "bumperTilt", label: "Bumper Tilt", value: a.bumperTilt, min: -90, max: 90, unit: "°" },
        ...a.kinds.flatMap((k, i) => kindFields(k, ARRAY_KINDS[i]!)),
        { kind: "length", key: "listening", label: "Listening Height", value: a.listening, zero: true, signed: true },
        { kind: "length", key: "throw", label: "Throw Distance", value: a.throwDistance },
        { kind: "check", key: "arrayAngles", label: "Override dispersion with array angles", value: a.arrayAngles },
        { kind: "check", key: "dispersion", label: "Show dispersion", value: a.dispersion },
        {
          kind: "choice",
          key: "hoists",
          label: "Hanging Support",
          value: String(a.hoists),
          options: [
            { value: "1", label: "One hoist" },
            { value: "2", label: "Two hoists" },
          ],
        },
        { kind: "check", key: "guides", label: "Show rigging guides", value: a.guides },
      ],
      `The bumper's middle goes on the click, its front facing the drag (down the screen for a click). Speakers A, then B, then C hang under it from the Trim Height (the bumper's underside), each tilting down its Angle Relative to Preceding from the one above (the first from the Bumper Tilt); a count of 0 leaves a kind out, ${MAX_ARRAY_BOXES} at most in all. Boxes the bumper covers are ${DASHED_NOTE}. Dispersion lines run left, right and down the middle from the front, the widest spread and the throw tilted by the shallowest box; a tick crosses the middle where each box aims at the Listening Height, and the coverage shadow, drawn unfilled, is where the boxes' vertical spreads together meet it within the throw. With array angles, a box's vertical spread is its angle from the one above. Rigging guides cross the bumper where its hoists pick it up. Catalog speakers and bumpers, 3D, weights and loads, hatches, text styles and classes aren't offered.`,
    );
    if (!v) return;
    this.a = {
      columnId: v.choice("columnId"),
      bumperWidth: v.num("bumperWidth"),
      bumperDepth: v.num("bumperDepth"),
      bumperHeight: v.num("bumperHeight"),
      trim: v.num("trim"),
      bumperTilt: v.num("bumperTilt"),
      kinds: ARRAY_KINDS.map((n) => ({
        count: v.num(`${n}count`),
        width: v.num(`${n}width`),
        height: v.num(`${n}height`),
        depth: v.num(`${n}depth`),
        horizontal: v.num(`${n}horizontal`),
        vertical: v.num(`${n}vertical`),
        splay: v.num(`${n}splay`),
      })),
      listening: v.num("listening"),
      throwDistance: v.num("throw"),
      arrayAngles: v.flag("arrayAngles"),
      dispersion: v.flag("dispersion"),
      hoists: v.choice("hoists") === "1" ? 1 : 2,
      guides: v.flag("guides"),
    };
  }

  hint(): string {
    return `${super.hint()} · the bumper's middle on the point, its front facing the drag`;
  }

  protected plan(): SpeakerPlan | string {
    return speakerArray({ ...this.a, textHeight: 2.5 * (this.scale() ?? 1) });
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = this.plan();
    return typeof plan === "string" ? null : speakerParts(plan, at, angle);
  }
}
