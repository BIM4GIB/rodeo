// The Detailing tool set's machine components, as plain 2D objects grouped in the active class
// (where Vectorworks makes plug-in objects). Sizes are real (mm in Preferences); centre lines reach past
// what they cross by a distance on paper (times the layer scale). Esc cancels.
//
// Hole - Drilled: a click places a hole seen from the top (key 1) or cut through its axis from the
// side (key 2), a press dragged turns it; plain, counterbored or countersunk (keys 3 to 5), through
// or blind in Preferences.
// Hole - Tapped (Metric) and (Inch): the same for a coarse thread chosen in Preferences, drawn as
// ISO 6410 shows threads.
// Slot: click one end, then the other (Shift in 15° steps), then click as far from the line as the
// slot is half wide; its ends half-round, with a centre line if Preferences say so.
// Hole Pattern: a click places round, tapped or slotted holes (keys 3 to 5) in rows and columns
// (key 1) or round a bolt circle (key 2), seen from the top, centred on the click.
// Screw Threads: a click places an external thread from the side, its end on the click and its
// axis running right (a press dragged turns it), simplified, schematic or detailed (keys 1 to 3).
// Keyway: a click places a shaft (key 1) or bore (key 2) cut across with its keyway at the top,
// the key a standard size for the diameter (DIN 6885 or ASME B17.1) or one set in Preferences.
// Spur Gear and Spur Gear Rack (the Machine Components set): a click places a gear seen from the
// front (key 1: involute or simplified teeth, keys 3 and 4) or cut through its axis from the side
// (key 2), or a rack from the front, top or side (keys 1 to 3), a press dragged turns it; sizes,
// hub, bore, keyway, recess and web holes in Preferences.
// Sprocket: the same for a roller chain's sprocket, front or side (keys 1 and 2), its teeth in the
// ISO 606 form for the chain chosen in Preferences.
// Roller Chain - Linear: a click places a run of links starting on the click and running right.
// Roller Chain - Circular: a click places links round a sprocket's pitch circle centred on the click.
// Ball, Roller and Needle Bearing: a click places a bearing seen down its axis (key 1) or cut through
// it from the side (key 2), centred on the click, a press dragged turns it; its type and sizes in
// Preferences, drawn in detail or simplified (ISO 8826-1). Tapered Roller Bearing and Thrust Bearing
// the same, sized by their rings' widths or their thickness; Bearing Lock Nut a KM nut by its size.
// Pulley: placed like a gear, front or side (keys 1 and 2), with up to ten V or round grooves and
// a plain, holed or spoked web.
// Key and Woodruff Key: a click places a key centred on it, from the front, top or side (keys 1 to
// 3), a press dragged turns it; a standard size or (Key) one set in Preferences.
// Compression Spring 1 and 2, Conical Compression Spring, Die Spring and Extension Spring - Front: a
// click places a spring's end, its axis running right (a press dragged turns it) for the working
// length; solid, sectioned or simplified (keys 1 to 5). Extension Spring - End: the spring seen down
// its axis, centred on the click. Belleville Spring: a stack cut through its axis running right from
// the click (key 1), or one seen down its axis centred on it (key 2). Pillow Block and Flanged
// Bearing - 2 Hole and - 4 Hole: a mounted ball bearing unit seen down the shaft centred on the click
// (key 1), across it (key 2) or, a pillow block, from above (key 3); a standard size or custom one.
// Roller Chain - Offset Link: one offset link from its roller end, from the side or above (keys 1
// and 2). Bevel Gears: a gear and pinion cut through their axes from the pitch apex on the click
// (key 1), or one seen down its axis (key 2). Worm and Worm Gear: a worm centred on the click with
// its axis running right, from the front, either end, or cut across or along it (keys 1 to 5); its
// gear centred on the click from the front or back, cut through its axis or seen from the side
// (keys 1 to 5); either with Detailed or Schematic teeth (keys 6 and 7). Shaft: segments built in
// its Configuration dialog, from the left end on the click with the axis running right.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { placed } from "../detailShapes.ts";
import {
  drilledHole,
  holePattern,
  holeReach,
  keyway,
  MAX_PATTERN_HOLES,
  screwThread,
  slotOutline,
  tappedHole,
  type DrilledHole,
  type HoleDrawing,
  type HolePattern,
  type HoleStyle,
  type HoleView,
  type PatternHole,
  type PatternKind,
  type ThreadStyle,
} from "../machineShapes.ts";
import {
  gearProblem,
  gearSizes,
  MAX_GEAR_TEETH,
  MAX_RACK_TEETH,
  MIN_GEAR_TEETH,
  rackProblem,
  spurGearFront,
  spurGearSide,
  spurRack,
  type GearProfile,
  type GearView,
  type RackView,
  type SpurGear,
  type SpurRack,
  type Wheel,
} from "../gearShapes.ts";
import {
  activeFromSolid,
  bellevilleFront,
  bellevilleProblem,
  bellevilleSide,
  coilPath,
  coilsProblem,
  compressionCoils,
  extensionCoils,
  extensionEnd,
  extensionFront,
  extensionProblem,
  MAX_COILS,
  MAX_DISCS,
  springDrawing,
  type Belleville,
  type Coils,
  type ExtensionSpring,
  type HookStyle,
  type HookView,
  type SpringDisplay,
  type SpringDrawing,
  type SpringEnds,
} from "../springShapes.ts";
import {
  collarFor,
  flangedBearing,
  flangedProblem,
  pillowBlock,
  pillowBlockProblem,
  SET_SCREWS,
  UC_INSERTS,
  UCF,
  UCFL,
  UCP,
  type FlangedBearing,
  type PillowBlock,
  type UnitDrawing,
  type UnitShow,
  type UnitView,
} from "../mountedBearingShapes.ts";
import { bevelCones, bevelFront, bevelProblem, bevelSide, bevelTurnings, MAX_BEVEL_TEETH, MIN_BEVEL_TEETH, type BevelMember, type BevelPair, type BevelWhich } from "../bevelShapes.ts";
import { bevelSolid, chainSolid, coilSolid, extensionSolid, offsetLinkSolid, toothedSolid, torsionSolid, wormSolid } from "../machineSolids.ts";
import { bored, circleOutline, lathe, lying, onEdge, onLayer, prism, sectionProfile, turnedSection, mapSolid, type Solid } from "../solids3d.ts";
import { store, type ToolId } from "../state.ts";
import { torsionEnd, torsionEndProblem, torsionFront, torsionFrontProblem, type EndLeg, type EndStyle, type FrontLeg, type Leg, type LegDirection, type LegOrientation, type TorsionEnd, type TorsionFront } from "../torsionShapes.ts";
import { MAX_STARTS, wormDrawing, wormGearDrawing, wormGearProblem, wormGearSizes, wormProblem, wormSizes, type Worm, type WormGear, type WormGearView, type WormProfile, type WormView } from "../wormShapes.ts";
import { inchText, parallelKey, parallelKeyProblem, WOODRUFF_KEYS, woodruffKey, woodruffLength, type KeyView } from "../keyShapes.ts";
import { MAX_GROOVES, pulleyFaceWidth, pulleyFront, pulleyProblem, pulleyRoot, pulleySide, type Pulley } from "../pulleyShapes.ts";
import {
  CHAINS,
  circularChain,
  circularPins,
  linearChain,
  linearPins,
  MAX_LINKS,
  MAX_ROWS,
  MAX_SPROCKET_TEETH,
  MIN_SPROCKET_TEETH,
  offsetLinkSide,
  offsetLinkTop,
  sprocketFront,
  sprocketPitchDiameter,
  sprocketProblem,
  sprocketSide,
  sprocketWidth,
  standardToothWidth,
  type ChainSize,
  type Sprocket,
  type SprocketView,
} from "../chainShapes.ts";
import {
  bearingFront,
  bearingProblem,
  bearingSide,
  LOCK_NUTS,
  lockNutFront,
  lockNutSide,
  MAX_NEEDLE_ROWS,
  taperedFront,
  taperedProblem,
  taperedSide,
  thrustFront,
  thrustProblem,
  thrustSide,
  type BallType,
  type Bearing,
  type BearingView,
  type NeedleType,
  type RacewayStyle,
  type RollerType,
  type TaperedType,
  type ThrustType,
} from "../bearingShapes.ts";
import { takeHandedSpring } from "../springHandoff.ts";
import { toast } from "../toast.ts";
import { INCH_THREADS, METRIC_THREADS, shaftDrawing, shaftProblem, type Shaft, type ShaftKeyway, type ShaftSegment, type ThreadForm } from "../shaftShapes.ts";
import { defaultShaftConfig, shaftConfigDialog, type ShaftConfig } from "../shaftDialog.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { addPieces, layerScale, PlaceTool, preview, type Part } from "./detailing.ts";
import { as3D } from "./solidTool.ts";

/** how far centre lines reach past what they cross, on paper, mm */
export const CENTRE_BEYOND_MM = 3;
/** pointer travel (CSS px) below which a press is a click, not a drag */
const CLICK_PX = 4;
/** a drill's point, degrees */
const DRILL_POINT = 118;

const VIEWS: readonly { readonly id: HoleView; readonly label: string }[] = [
  { id: "top", label: "Top View" },
  { id: "side", label: "Side View" },
];
const STYLES: readonly { readonly id: HoleStyle; readonly label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "counterbored", label: "Counterbored" },
  { id: "countersunk", label: "Countersunk" },
];
const HOLE_TYPES = [
  { value: "through", label: "Through" },
  { value: "blind", label: "Blind" },
] as const;

/** A drawing as parts at `at`, turned by `angle` radians. */
export function drawingParts(d: HoleDrawing, at: Pt, angle: number): Part[] {
  const move = (p: Pt): Pt => placed([p], at, angle)[0];
  const deg = (angle * 180) / Math.PI;
  return [
    ...d.outlines.map((points): Part => ({ kind: "polygon", points: placed(points, at, angle), closed: true })),
    ...d.lines.map((points): Part => ({ kind: "polyline", points: placed(points, at, angle), closed: false })),
    ...d.circles.map((c): Part => ({ kind: "arc", center: move(c.center), radius: c.radius, startAngle: 0, sweepAngle: 360 })),
    ...d.arcs.map((c): Part => ({ kind: "arc", center: move(c.center), radius: c.radius, startAngle: c.start + deg, sweepAngle: c.sweep })),
  ];
}

/**
 * A hole's drawing as parts at `at`, turned by `angle` radians, with its centre lines: from the
 * top, two across it reaching `beyond` past its widest circle; from the side, its axis from
 * `beyond` above the mouth to `beyond` below `reach`.
 */
function holeParts(d: HoleDrawing, view: HoleView, widest: number, reach: number, beyond: number | null, at: Pt, angle: number): Part[] {
  const centre: Pt[][] =
    beyond === null
      ? []
      : view === "top"
        ? [
            [{ x: -widest - beyond, y: 0 }, { x: widest + beyond, y: 0 }],
            [{ x: 0, y: -widest - beyond }, { x: 0, y: widest + beyond }],
          ]
        : [[{ x: 0, y: beyond }, { x: 0, y: -reach - beyond }]];
  return drawingParts({ ...d, lines: [...d.lines, ...centre] }, at, angle);
}

/** A hole's half section for a sweep: x from its axis, down from its mouth at y = 0 through `walls`, a blind one ending in its drill's point. */
const holeProfile = (walls: readonly Pt[], radius: number, depth: number, blind: boolean, pointAngle: number): Pt[] => [
  { x: 0, y: 0 },
  ...walls,
  { x: 0, y: -depth - (blind ? radius / Math.tan((pointAngle * Math.PI) / 360) : 0) },
];

export class DrilledHoleTool extends PlaceTool {
  readonly id = "drilledhole";
  readonly cursor = "crosshair";
  protected readonly label = "Hole - Drilled";
  private view: HoleView = "top";
  /** an M6 clearance hole, counterbored and countersunk for M6 socket and flat heads */
  private hole: DrilledHole = { diameter: 6.6, depth: 20, blind: false, pointAngle: DRILL_POINT, style: "plain", mouthDiameter: 11, counterboreDepth: 6.4, countersinkAngle: 90 };
  private centreLine = true;

  modes(): readonly ToolModes[] {
    return [
      { label: "View", options: VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view },
      { label: "Style", options: STYLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + VIEWS.length) })), active: this.hole.style },
    ];
  }

  setMode(id: string): void {
    const view = VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
    const style = STYLES.find((m) => m.id === id);
    if (style) this.hole = { ...this.hole, style: style.id };
  }

  async preferences(): Promise<void> {
    const h = this.hole;
    const v = await toolPrefs(
      "Hole - Drilled Preferences",
      [
        { kind: "length", key: "diameter", label: "Hole diameter", value: h.diameter },
        { kind: "length", key: "depth", label: "Total depth", value: h.depth },
        { kind: "choice", key: "type", label: "Hole type", value: h.blind ? "blind" : "through", options: HOLE_TYPES },
        { kind: "number", key: "point", label: "Drill point angle", value: h.pointAngle, min: 1, max: 179, unit: "°" },
        { kind: "length", key: "mouth", label: "Counterbore or countersink diameter", value: h.mouthDiameter },
        { kind: "length", key: "cbore", label: "Counterbore depth", value: h.counterboreDepth },
        { kind: "number", key: "csink", label: "Countersink angle", value: h.countersinkAngle, min: 1, max: 179, unit: "°" },
        { kind: "check", key: "centre", label: "Show center line", value: this.centreLine },
      ],
      "The style (Plain, Counterbored or Countersunk) is chosen in the mode bar. Blind holes end in the drill's point.",
    );
    if (!v) return;
    this.hole = {
      ...h,
      diameter: v.num("diameter"),
      depth: v.num("depth"),
      blind: v.choice("type") === "blind",
      pointAngle: v.num("point"),
      mouthDiameter: v.num("mouth"),
      counterboreDepth: v.num("cbore"),
      countersinkAngle: v.num("csink"),
    };
    this.centreLine = v.flag("centre");
  }

  hint(): string {
    return `${super.hint()} · 1–2 view · 3–5 style`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const h = this.hole;
    const d = drilledHole(h, this.view);
    const scale = this.scale();
    if (!d || scale === null) return null;
    const widest = h.style === "plain" ? h.diameter / 2 : h.mouthDiameter / 2;
    const reach = holeReach(h.diameter / 2, h.depth, h.blind, h.pointAngle);
    return holeParts(d, this.view, widest, reach, this.centreLine ? CENTRE_BEYOND_MM * scale : null, at, angle);
  }

  /** What the 3D twin turns into a sweep to subtract. */
  sweepProfile(): Pt[] | null {
    const h = this.hole;
    if (!drilledHole(h, "top")) return null;
    const r = h.diameter / 2;
    const R = h.mouthDiameter / 2;
    const sink = h.style === "countersunk" ? (R - r) / Math.tan((h.countersinkAngle * Math.PI) / 360) : h.counterboreDepth;
    const mouth = h.style === "counterbored" ? [{ x: R, y: 0 }, { x: R, y: -sink }, { x: r, y: -sink }] : h.style === "countersunk" ? [{ x: R, y: 0 }, { x: r, y: -sink }] : [{ x: r, y: 0 }];
    return holeProfile([...mouth, { x: r, y: -h.depth }], r, h.depth, h.blind, h.pointAngle);
  }

  protected refusal(): string {
    return "The hole's sizes in its Preferences don't make a hole: a counterbore or countersink must be wider than the hole and shallower than its depth.";
  }
}

/** A coarse thread: its name, its (major) diameter and its tap drill's, mm. */
interface Thread {
  readonly name: string;
  readonly diameter: number;
  readonly tapDrill: number;
}

/** ISO metric coarse threads (ISO 261), each tapped with a drill its pitch smaller. */
const METRIC: readonly Thread[] = [
  ["M2 × 0.4", 2, 1.6],
  ["M2.5 × 0.45", 2.5, 2.05],
  ["M3 × 0.5", 3, 2.5],
  ["M4 × 0.7", 4, 3.3],
  ["M5 × 0.8", 5, 4.2],
  ["M6 × 1", 6, 5],
  ["M8 × 1.25", 8, 6.8],
  ["M10 × 1.5", 10, 8.5],
  ["M12 × 1.75", 12, 10.2],
  ["M14 × 2", 14, 12],
  ["M16 × 2", 16, 14],
  ["M20 × 2.5", 20, 17.5],
  ["M24 × 3", 24, 21],
].map(([name, diameter, tapDrill]) => ({ name: name as string, diameter: diameter as number, tapDrill: tapDrill as number }));

/** Unified coarse threads (UNC), inches, each with its usual tap drill for a 75% thread. */
const INCH: readonly Thread[] = [
  ["#4-40", 0.112, 0.089],
  ["#6-32", 0.138, 0.1065],
  ["#8-32", 0.164, 0.136],
  ["#10-24", 0.19, 0.1495],
  ["1/4-20", 0.25, 0.201],
  ["5/16-18", 0.3125, 0.257],
  ["3/8-16", 0.375, 0.3125],
  ["7/16-14", 0.4375, 0.368],
  ["1/2-13", 0.5, 0.4219],
  ["5/8-11", 0.625, 0.5313],
  ["3/4-10", 0.75, 0.6563],
  ["1-8", 1, 0.875],
].map(([name, diameter, tapDrill]) => ({ name: name as string, diameter: (diameter as number) * 25.4, tapDrill: (tapDrill as number) * 25.4 }));

/** Hole - Tapped (Metric) and (Inch): one tool over each standard's threads. */
export class TappedHoleTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected readonly label: string;
  private view: HoleView = "top";
  private thread: Thread;
  private threadDepth: number;
  private drillDepth: number;
  private blind = true;
  private pointAngle = DRILL_POINT;
  private centreLine = true;
  private readonly metric: boolean;

  constructor(
    env: ToolEnv,
    readonly id: ToolId,
  ) {
    super(env);
    const metric = id === "tappedmm";
    this.metric = metric;
    this.label = metric ? "Hole - Tapped (Metric)" : "Hole - Tapped (Inch)";
    this.thread = metric ? METRIC[5] : INCH[4];
    // a thread one and a half diameters deep in a drilled hole two
    this.threadDepth = 1.5 * this.thread.diameter;
    this.drillDepth = 2 * this.thread.diameter;
  }

  private threads(): readonly Thread[] {
    return this.metric ? METRIC : INCH;
  }

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  async preferences(): Promise<void> {
    const metric = this.metric;
    const drill = (t: Thread): string => (metric ? `${t.tapDrill} mm` : `${+(t.tapDrill / 25.4).toFixed(4)}"`);
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "thread", label: "Screw thread", value: this.thread.name, options: this.threads().map((t) => ({ value: t.name, label: `${t.name} (tap drill ${drill(t)})` })) },
        { kind: "choice", key: "type", label: "Hole type", value: this.blind ? "blind" : "through", options: HOLE_TYPES },
        { kind: "length", key: "thread depth", label: "Thread depth", value: this.threadDepth },
        { kind: "length", key: "drill depth", label: "Tap drill depth", value: this.drillDepth },
        { kind: "number", key: "point", label: "Drill point angle", value: this.pointAngle, min: 1, max: 179, unit: "°" },
        { kind: "check", key: "centre", label: "Show center line", value: this.centreLine },
      ],
      "Drawn as ISO 6410 shows threads. A through hole's tap drill runs its whole depth.",
    );
    if (!v) return;
    this.thread = this.threads().find((t) => t.name === v.choice("thread")) ?? this.thread;
    this.blind = v.choice("type") === "blind";
    this.threadDepth = v.num("thread depth");
    this.drillDepth = v.num("drill depth");
    this.pointAngle = v.num("point");
    this.centreLine = v.flag("centre");
  }

  hint(): string {
    return `${super.hint()} · ${this.thread.name} · 1–2 view`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const t = this.thread;
    const d = tappedHole({ diameter: t.diameter, tapDrill: t.tapDrill, threadDepth: this.threadDepth, drillDepth: this.drillDepth, blind: this.blind, pointAngle: this.pointAngle }, this.view);
    const scale = this.scale();
    if (!d || scale === null) return null;
    const reach = holeReach(t.tapDrill / 2, this.drillDepth, this.blind, this.pointAngle);
    return holeParts(d, this.view, t.diameter / 2, reach, this.centreLine ? CENTRE_BEYOND_MM * scale : null, at, angle);
  }

  /** The tap drill's hole, with no thread cut in it, that the 3D twin turns into a sweep to subtract. */
  sweepProfile(): Pt[] | null {
    const t = this.thread;
    const r = t.tapDrill / 2;
    if (!tappedHole({ diameter: t.diameter, tapDrill: t.tapDrill, threadDepth: this.threadDepth, drillDepth: this.drillDepth, blind: this.blind, pointAngle: this.pointAngle }, "top")) return null;
    return holeProfile([{ x: r, y: 0 }, { x: r, y: -this.drillDepth }], r, this.drillDepth, this.blind, this.pointAngle);
  }

  protected refusal(): string {
    return "The thread can't run deeper than its tap drill: change the Preferences.";
  }
}

/** A slot as parts: its outline and, when `beyond` is given, its centre line reaching that far past each end. */
function slotParts(a: Pt, b: Pt, width: number, beyond: number | null): Part[] | null {
  const outline = slotOutline(a, b, width);
  if (!outline) return null;
  const parts: Part[] = [{ kind: "polygon", points: outline, closed: true }];
  if (beyond !== null) {
    const len = dist(a, b);
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    parts.push({
      kind: "polyline",
      points: [
        { x: a.x - u.x * beyond, y: a.y - u.y * beyond },
        { x: b.x + u.x * beyond, y: b.y + u.y * beyond },
      ],
      closed: false,
    });
  }
  return parts;
}

/** How far `p` is from the line through `a` and `b`. */
function offLine(p: Pt, a: Pt, b: Pt): number {
  const len = dist(a, b);
  return len > 0 ? Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len : 0;
}

export class SlotTool extends BaseTool {
  readonly id = "slot";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private to: Pt | null = null;
  /** where the first end was pressed, to tell a drag to the second end from a click */
  private pressScreen: Pt | null = null;
  private pointer: PointerInfo | null = null;
  private centreLine = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs("Slot Preferences", [{ kind: "check", key: "centre", label: "Show center line", value: this.centreLine }], "The slot's length and width are set by its clicks.");
    if (v) this.centreLine = v.flag("centre");
  }

  snapFrom(): Pt | null {
    return this.to ?? this.from;
  }

  hint(): string {
    if (!this.from) return "Click the slot's first end";
    if (!this.to) return `Click its other end · Shift ${ANGLE_STEP_DEG}°`;
    return "Click to set its width";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (!this.from) {
      this.from = p.pos;
      this.pressScreen = p.screen;
      return;
    }
    if (!this.to) {
      this.to = this.end(p);
      return;
    }
    const a = this.from;
    const b = this.to;
    this.reset();
    const parts = this.parts(a, b, 2 * offLine(p.pos, a, b));
    if (!parts) {
      toast("A slot must be longer than it is wide, and have a width: click further from its line, or make it longer.", "info");
      return;
    }
    addPieces("Slot", [parts]);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    // a drag from the first end sets the second where it is released
    if (this.from && !this.to && press && dist(p.screen, press) > CLICK_PX) this.to = this.end(p);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.from) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    const a = this.from;
    if (!p || !a) return;
    if (!this.to) {
      preview(g, [{ kind: "polyline", points: [a, this.end(p)], closed: false }]);
      return;
    }
    preview(g, this.parts(a, this.to, 2 * offLine(p.pos, a, this.to)) ?? [{ kind: "polyline", points: [a, this.to], closed: false }]);
  }

  private parts(a: Pt, b: Pt, width: number): Part[] | null {
    const scale = layerScale(this.env);
    return scale === null ? null : slotParts(a, b, width, this.centreLine ? CENTRE_BEYOND_MM * scale : null);
  }

  /** The second end at the pointer, kept to 15° steps from the first while Shift is held. */
  private end(p: PointerInfo): Pt {
    return this.from && p.shift ? snapAngle(this.from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private reset(): void {
    this.from = null;
    this.to = null;
    this.pressScreen = null;
  }
}

const PATTERNS: readonly { readonly id: PatternKind; readonly label: string }[] = [
  { id: "rectangular", label: "Rectangular" },
  { id: "circle", label: "Bolt Circle" },
];
const PATTERN_HOLES: readonly { readonly id: PatternHole; readonly label: string }[] = [
  { id: "round", label: "Round" },
  { id: "tapped", label: "Tapped" },
  { id: "slotted", label: "Slotted" },
];

export class HolePatternTool extends PlaceTool {
  readonly id = "holepattern";
  readonly cursor = "crosshair";
  protected readonly label = "Hole Pattern";
  /** six M8 clearance holes, two rows of three or round a 100 mm circle */
  private pattern: HolePattern = {
    kind: "rectangular",
    rows: 2,
    columns: 3,
    rowSpacing: 40,
    columnSpacing: 50,
    count: 6,
    circleDiameter: 100,
    hole: "round",
    diameter: 9,
    tapDrill: 6.8,
    slotWidth: 9,
    slotLength: 20,
    mouth: null,
  };
  private thread = METRIC[6];
  private mouthDiameter = 15;
  private centreLines = true;

  modes(): readonly ToolModes[] {
    return [
      { label: "Pattern", options: PATTERNS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.pattern.kind },
      { label: "Hole", options: PATTERN_HOLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + PATTERNS.length) })), active: this.pattern.hole },
    ];
  }

  setMode(id: string): void {
    const kind = PATTERNS.find((m) => m.id === id);
    if (kind) this.pattern = { ...this.pattern, kind: kind.id };
    const hole = PATTERN_HOLES.find((m) => m.id === id);
    if (hole) this.pattern = { ...this.pattern, hole: hole.id };
  }

  async preferences(): Promise<void> {
    const p = this.pattern;
    const v = await toolPrefs(
      "Hole Pattern Preferences",
      [
        { kind: "number", key: "rows", label: "Number of rows", value: p.rows, min: 1, max: 100, integer: true },
        { kind: "length", key: "row spacing", label: "Vertical spacing", value: p.rowSpacing },
        { kind: "number", key: "columns", label: "Number of columns", value: p.columns, min: 1, max: 100, integer: true },
        { kind: "length", key: "column spacing", label: "Horizontal spacing", value: p.columnSpacing },
        { kind: "number", key: "count", label: "Number of holes", value: p.count, min: 1, max: 360, integer: true },
        { kind: "length", key: "circle", label: "Bolt circle diameter", value: p.circleDiameter },
        { kind: "length", key: "size", label: "Hole size", value: p.diameter },
        { kind: "choice", key: "thread", label: "Screw thread", value: this.thread.name, options: METRIC.map((t) => ({ value: t.name, label: t.name })) },
        { kind: "length", key: "slot width", label: "Slot width", value: p.slotWidth },
        { kind: "length", key: "slot length", label: "Slot length", value: p.slotLength },
        { kind: "check", key: "mouth", label: "Counterbore/countersunk", value: p.mouth !== null },
        { kind: "length", key: "mouth diameter", label: "Diameter", value: this.mouthDiameter },
        { kind: "check", key: "centre", label: "Show centerlines", value: this.centreLines },
      ],
      `Rows and columns make a rectangular pattern; the number of holes and the circle a bolt circle. Round holes take the hole size, tapped ones the thread, slotted ones the slot's size. At most ${MAX_PATTERN_HOLES} holes.`,
    );
    if (!v) return;
    this.thread = METRIC.find((t) => t.name === v.choice("thread")) ?? this.thread;
    this.mouthDiameter = v.num("mouth diameter");
    this.centreLines = v.flag("centre");
    this.pattern = {
      ...p,
      rows: v.num("rows"),
      rowSpacing: v.num("row spacing"),
      columns: v.num("columns"),
      columnSpacing: v.num("column spacing"),
      count: v.num("count"),
      circleDiameter: v.num("circle"),
      diameter: v.num("size"),
      slotWidth: v.num("slot width"),
      slotLength: v.num("slot length"),
      mouth: v.flag("mouth") ? this.mouthDiameter : null,
    };
  }

  hint(): string {
    return `${super.hint()} · 1–2 pattern · 3–5 hole`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const p = this.pattern;
    const tapped = p.hole === "tapped";
    const scale = this.scale();
    const d =
      scale === null
        ? null
        : holePattern({ ...p, diameter: tapped ? this.thread.diameter : p.diameter, tapDrill: this.thread.tapDrill }, this.centreLines ? CENTRE_BEYOND_MM * scale : null);
    return d ? drawingParts(d, at, angle) : null;
  }

  protected refusal(): string {
    return `The pattern's Preferences don't make one: at most ${MAX_PATTERN_HOLES} holes, a counterbore wider than its holes, and a slot longer than it is wide.`;
  }
}

const THREAD_STYLES: readonly { readonly id: ThreadStyle; readonly label: string }[] = [
  { id: "simplified", label: "Simplified" },
  { id: "schematic", label: "Schematic" },
  { id: "detailed", label: "Detailed" },
];

export class ScrewThreadTool extends PlaceTool {
  readonly id = "screwthread";
  readonly cursor = "crosshair";
  protected readonly label = "Screw Threads";
  private style: ThreadStyle = "simplified";
  /** an M10 × 1.5 thread 26 long on a 40 long end */
  private diameter = 10;
  private length = 40;
  private threadLength = 26;
  private pitch = 1.5;
  private shankAtPitch = false;
  private chamfered = true;
  private centreLine = true;

  modes(): readonly ToolModes[] {
    return [{ label: "Style", options: THREAD_STYLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.style }];
  }

  setMode(id: string): void {
    const style = THREAD_STYLES.find((m) => m.id === id);
    if (style) this.style = style.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Screw Threads Preferences",
      [
        { kind: "length", key: "diameter", label: "Diameter", value: this.diameter },
        { kind: "length", key: "length", label: "Overall length", value: this.length },
        { kind: "length", key: "thread length", label: "Thread length", value: this.threadLength },
        { kind: "length", key: "pitch", label: "Thread pitch", value: this.pitch },
        {
          kind: "choice",
          key: "shank",
          label: "Shank diameter",
          value: this.shankAtPitch ? "pitch" : "thread",
          options: [
            { value: "thread", label: "Thread diameter" },
            { value: "pitch", label: "Pitch diameter" },
          ],
        },
        {
          kind: "choice",
          key: "bottom",
          label: "Thread bottom",
          value: this.chamfered ? "chamfered" : "flat",
          options: [
            { value: "chamfered", label: "Chamfered" },
            { value: "flat", label: "Flat" },
          ],
        },
        { kind: "check", key: "centre", label: "Show center line", value: this.centreLine },
      ],
      "ISO metric proportions. The thread runs from the end; past it the shank is the thread's diameter, or its pitch diameter for a rolled thread.",
    );
    if (!v) return;
    this.diameter = v.num("diameter");
    this.length = v.num("length");
    this.threadLength = v.num("thread length");
    this.pitch = v.num("pitch");
    this.shankAtPitch = v.choice("shank") === "pitch";
    this.chamfered = v.choice("bottom") === "chamfered";
    this.centreLine = v.flag("centre");
  }

  hint(): string {
    return `${super.hint()} · 1–3 style`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const d =
      scale === null
        ? null
        : screwThread(
            { diameter: this.diameter, length: this.length, threadLength: this.threadLength, pitch: this.pitch, style: this.style, shankAtPitch: this.shankAtPitch, chamfered: this.chamfered },
            this.centreLine ? CENTRE_BEYOND_MM * scale : null,
          );
    return d ? drawingParts(d, at, angle) : null;
  }

  protected refusal(): string {
    return "The thread's Preferences don't make one: it must be no longer than the whole length, longer than its chamfer, and at most 2,000 pitches.";
  }
}

/** DIN 6885-1 parallel keys: up to this shaft diameter, the key's width and height and its seats' depths in the shaft and the hub, mm. */
const DIN_6885: readonly (readonly [number, number, number, number, number])[] = [
  [8, 2, 2, 1.2, 1],
  [10, 3, 3, 1.8, 1.4],
  [12, 4, 4, 2.5, 1.8],
  [17, 5, 5, 3, 2.3],
  [22, 6, 6, 3.5, 2.8],
  [30, 8, 7, 4, 3.3],
  [38, 10, 8, 5, 3.3],
  [44, 12, 8, 5, 3.3],
  [50, 14, 9, 5.5, 3.8],
  [58, 16, 10, 6, 4.3],
  [65, 18, 11, 7, 4.4],
  [75, 20, 12, 7.5, 4.9],
  [85, 22, 14, 9, 5.4],
  [95, 25, 14, 9, 5.4],
  [110, 28, 16, 10, 6.4],
  [130, 32, 18, 11, 7.4],
];
/** the smallest shaft DIN 6885-1 keys, mm */
const DIN_FROM = 6;

/** ASME B17.1 keys: up to this shaft diameter, the key's width and a rectangular key's height, inches. */
const ASME_B17_1: readonly (readonly [number, number, number])[] = [
  [7 / 16, 3 / 32, 3 / 32],
  [9 / 16, 1 / 8, 3 / 32],
  [7 / 8, 3 / 16, 1 / 8],
  [1.25, 1 / 4, 3 / 16],
  [1.375, 5 / 16, 1 / 4],
  [1.75, 3 / 8, 1 / 4],
  [2.25, 1 / 2, 3 / 8],
  [2.75, 5 / 8, 7 / 16],
  [3.25, 3 / 4, 1 / 2],
  [3.75, 7 / 8, 5 / 8],
  [4.5, 1, 3 / 4],
  [5.5, 1.25, 7 / 8],
  [6.5, 1.5, 1],
];
/** the smallest shaft ASME B17.1 keys, inches */
const ASME_FROM = 5 / 16;

type KeyStandard = "metric" | "inch";
type KeyShape = "square" | "rectangular";

/**
 * The standard key for a shaft `diameter` mm round: its width, and its seat's depth in the shaft
 * and the hub, mm. Square keys are as tall as wide, seated half in each; ASME's keys too. Null
 * outside the standard's range.
 */
function standardKey(diameter: number, standard: KeyStandard, shape: KeyShape): { width: number; shaft: number; hub: number } | null {
  if (standard === "metric") {
    const row = diameter > DIN_FROM ? DIN_6885.find(([upTo]) => diameter <= upTo) : undefined;
    if (!row) return null;
    const [, b, , t1, t2] = row;
    return shape === "rectangular" ? { width: b, shaft: t1, hub: t2 } : { width: b, shaft: b / 2, hub: b / 2 };
  }
  const inches = diameter / 25.4;
  const row = inches >= ASME_FROM ? ASME_B17_1.find(([upTo]) => inches <= upTo + 1e-9) : undefined;
  if (!row) return null;
  const [, w, h] = row;
  const height = shape === "square" ? w : h;
  return { width: w * 25.4, shaft: (height * 25.4) / 2, hub: (height * 25.4) / 2 };
}

const KEYWAYS = [
  { id: "shaft", label: "Shaft" },
  { id: "hub", label: "Hub" },
] as const;

export class KeywayTool extends PlaceTool {
  readonly id = "keyway";
  readonly cursor = "crosshair";
  protected readonly label = "Keyway";
  private hub = false;
  private diameter = 40;
  private standard: KeyStandard = "metric";
  private shape: KeyShape = "rectangular";
  private recommended = true;
  private keyWidth = 12;
  private keyHeight = 8;
  private centreLine = true;

  modes(): readonly ToolModes[] {
    return [{ label: "Keyway", options: KEYWAYS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.hub ? "hub" : "shaft" }];
  }

  setMode(id: string): void {
    if (id === "shaft" || id === "hub") this.hub = id === "hub";
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Keyway Preferences",
      [
        { kind: "length", key: "diameter", label: "Shaft/bore diameter", value: this.diameter },
        {
          kind: "choice",
          key: "standard",
          label: "Key size standard",
          value: this.standard,
          options: [
            { value: "metric", label: "Metric (DIN 6885)" },
            { value: "inch", label: "Inch (ASME B17.1)" },
          ],
        },
        {
          kind: "choice",
          key: "shape",
          label: "Type of key",
          value: this.shape,
          options: [
            { value: "square", label: "Square" },
            { value: "rectangular", label: "Rectangular" },
          ],
        },
        { kind: "check", key: "recommended", label: "Use recommended key size", value: this.recommended },
        { kind: "length", key: "width", label: "Key width", value: this.keyWidth },
        { kind: "length", key: "height", label: "Key height", value: this.keyHeight },
        { kind: "check", key: "centre", label: "Show center line", value: this.centreLine },
      ],
      "A custom key is seated half its height in the shaft and half in the hub. Depths are measured from the circle on the keyway's middle.",
    );
    if (!v) return;
    this.diameter = v.num("diameter");
    this.standard = v.choice("standard") === "inch" ? "inch" : "metric";
    this.shape = v.choice("shape") === "square" ? "square" : "rectangular";
    this.recommended = v.flag("recommended");
    this.keyWidth = v.num("width");
    this.keyHeight = v.num("height");
    this.centreLine = v.flag("centre");
  }

  hint(): string {
    return `${super.hint()} · 1–2 shaft or hub`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const key = this.recommended ? standardKey(this.diameter, this.standard, this.shape) : { width: this.keyWidth, shaft: this.keyHeight / 2, hub: this.keyHeight / 2 };
    const scale = this.scale();
    const d = !key || scale === null ? null : keyway(this.diameter, key.width, this.hub ? key.hub : key.shaft, this.hub, this.centreLine ? CENTRE_BEYOND_MM * scale : null);
    return d ? drawingParts(d, at, angle) : null;
  }

  protected refusal(): string {
    return this.recommended
      ? `The ${this.standard === "metric" ? "DIN 6885" : "ASME B17.1"} keys don't cover a shaft that size: turn off Use recommended key size and set the key.`
      : "The key must be narrower than the shaft and shallower than its middle.";
  }
}

const GEAR_VIEWS: readonly { readonly id: GearView; readonly label: string }[] = [
  { id: "front", label: "Front View" },
  { id: "side", label: "Side View" },
];
const GEAR_PROFILES: readonly { readonly id: GearProfile; readonly label: string }[] = [
  { id: "involute", label: "Involute" },
  { id: "simplified", label: "Simplified" },
];
const PRESSURE_ANGLES = [
  { value: "14.5", label: "14.5°" },
  { value: "20", label: "20°" },
  { value: "25", label: "25°" },
];
type GearKey = "none" | KeyShape | "custom";

/** A number for a reference note: at most three decimal places. */
const ref = (n: number): string => String(Math.round(n * 1000) / 1000);

type WebStyle = "plain" | "percent" | "holes" | "spokes";
const WEB_STYLES: readonly { readonly value: WebStyle; readonly label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "percent", label: "Holes (Percent)" },
  { value: "holes", label: "Holes (Diameter)" },
  { value: "spokes", label: "Spokes" },
];

/**
 * What a gear's, a sprocket's and a pulley's Preferences share: the recess, hub, bore and keyway,
 * web holes and centre lines. A pulley's (`styled`) web is plain, has holes sized by a share of the
 * room across the recess or by their diameter, or has spokes.
 */
class WheelPrefs {
  drawRecess = false;
  web = 8;
  recessDiameter: number;
  drawHub = true;
  hubDiameter = 40;
  hubProjection = 10;
  hubSides: "both" | "left" | "right" = "both";
  drawBore = true;
  boreDiameter = 20;
  keyway: GearKey = "square";
  keyWidth = 5;
  keyDepth = 2.5;
  holes = 0;
  holeCentres = 58;
  holeDiameter = 10;
  webStyle: WebStyle = "plain";
  webSize = 50;
  centreLines = true;

  /** a worm gear's: a projection for each side, which may be negative, and the recess's and hub's corner and fillet radii */
  hubLeft = 0;
  hubRight = 10;
  recessCorner = 1;
  recessFillet = 1;
  hubCorner = 1;
  hubFillet = 1;

  constructor(
    recessDiameter: number,
    private readonly styled = false,
    private readonly worm = false,
  ) {
    this.recessDiameter = recessDiameter;
    if (styled) this.holes = 4;
  }

  fields(centreLabel: string): PrefField[] {
    return [
      { kind: "check", key: "recess", label: "Draw Recess", value: this.drawRecess },
      { kind: "length", key: "web", label: "Web Thickness", value: this.web },
      { kind: "length", key: "recessDiameter", label: "Recess Diameter", value: this.recessDiameter },
      ...(this.worm
        ? ([
            { kind: "length", key: "recessCorner", label: "Recess Corner Radius", value: this.recessCorner, zero: true },
            { kind: "length", key: "recessFillet", label: "Recess Fillet Radius", value: this.recessFillet, zero: true },
          ] satisfies PrefField[])
        : []),
      { kind: "check", key: "hub", label: "Draw Hub", value: this.drawHub },
      { kind: "length", key: "hubDiameter", label: "Hub Diameter", value: this.hubDiameter },
      ...(this.worm
        ? ([
            { kind: "length", key: "hubLeft", label: "Hub Projection (Left)", value: this.hubLeft, signed: true },
            { kind: "length", key: "hubRight", label: "Hub Projection (Right)", value: this.hubRight, signed: true },
            { kind: "length", key: "hubCorner", label: "Hub Corner Radius", value: this.hubCorner, zero: true },
            { kind: "length", key: "hubFillet", label: "Hub Fillet Radius", value: this.hubFillet, zero: true },
          ] satisfies PrefField[])
        : ([
            { kind: "length", key: "hubProjection", label: "Hub Projection", value: this.hubProjection },
            {
              kind: "choice",
              key: "hubSides",
              label: "Hub projects",
              value: this.hubSides,
              options: [
                { value: "both", label: "Both sides" },
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ],
            },
          ] satisfies PrefField[])),
      { kind: "check", key: "bore", label: "Draw Bore", value: this.drawBore },
      { kind: "length", key: "boreDiameter", label: "Bore Diameter", value: this.boreDiameter },
      {
        kind: "choice",
        key: "key",
        label: "Keyway",
        value: this.keyway,
        options: [
          { value: "none", label: "None" },
          { value: "square", label: "Square" },
          { value: "rectangular", label: "Rectangular" },
          { value: "custom", label: "Custom" },
        ],
      },
      { kind: "length", key: "keyWidth", label: "Keyway Width", value: this.keyWidth },
      { kind: "length", key: "keyDepth", label: "Keyway Depth", value: this.keyDepth },
      ...(this.styled
        ? ([
            { kind: "choice", key: "webStyle", label: "Web Configuration", value: this.webStyle, options: WEB_STYLES },
            { kind: "number", key: "holes", label: "Number", value: this.holes, min: 1, max: 36, integer: true },
            { kind: "number", key: "webSize", label: "Size", value: this.webSize, min: 10, max: 100, unit: "%" },
            { kind: "length", key: "holeCentres", label: "Center Distance", value: this.holeCentres },
          ] satisfies PrefField[])
        : ([
            { kind: "number", key: "holes", label: "Number of web holes", value: this.holes, min: 0, max: 36, integer: true },
            { kind: "length", key: "holeCentres", label: "Hole Center Distance", value: this.holeCentres },
          ] satisfies PrefField[])),
      { kind: "length", key: "holeDiameter", label: "Hole Diameter", value: this.holeDiameter },
      { kind: "check", key: "centre", label: centreLabel, value: this.centreLines },
    ];
  }

  read(v: PrefValues): void {
    this.drawRecess = v.flag("recess");
    this.web = v.num("web");
    this.recessDiameter = v.num("recessDiameter");
    this.drawHub = v.flag("hub");
    this.hubDiameter = v.num("hubDiameter");
    if (this.worm) {
      this.recessCorner = v.num("recessCorner");
      this.recessFillet = v.num("recessFillet");
      this.hubLeft = v.num("hubLeft");
      this.hubRight = v.num("hubRight");
      this.hubCorner = v.num("hubCorner");
      this.hubFillet = v.num("hubFillet");
    } else {
      this.hubProjection = v.num("hubProjection");
      const sides = v.choice("hubSides");
      this.hubSides = sides === "left" || sides === "right" ? sides : "both";
    }
    this.drawBore = v.flag("bore");
    this.boreDiameter = v.num("boreDiameter");
    const key = v.choice("key");
    this.keyway = key === "square" || key === "rectangular" || key === "custom" ? key : "none";
    this.keyWidth = v.num("keyWidth");
    this.keyDepth = v.num("keyDepth");
    this.holes = v.num("holes");
    this.holeCentres = v.num("holeCentres");
    this.holeDiameter = v.num("holeDiameter");
    if (this.styled) {
      this.webStyle = WEB_STYLES.find((w) => w.value === v.choice("webStyle"))?.value ?? "plain";
      this.webSize = v.num("webSize");
    }
    this.centreLines = v.flag("centre");
  }

  /** The web's holes: by count, centre distance and diameter; for a pulley by percent, across the recess (or out to `rim`, a diameter) from the hub or bore. */
  private webHoles(key: { width: number; depth: number } | null, rim: number): Wheel["holes"] {
    const style = this.styled ? this.webStyle : this.holes > 0 ? "holes" : "plain";
    if (style === "holes") return { count: this.holes, centreDistance: this.holeCentres, diameter: this.holeDiameter };
    if (style !== "percent") return null;
    const inner = this.drawHub ? this.hubDiameter / 2 : this.drawBore ? this.boreDiameter / 2 + (key?.depth ?? 0) : 0;
    const outer = (this.drawRecess ? this.recessDiameter : rim) / 2;
    return { count: this.holes, centreDistance: inner + outer, diameter: (this.webSize / 100) * (outer - inner) };
  }

  /** A pulley's spokes, when its web has them. */
  spokes(): { count: number; share: number } | null {
    return this.styled && this.webStyle === "spokes" ? { count: this.holes, share: this.webSize / 100 } : null;
  }

  /** The wheel these describe, `faceWidth` wide (`rim` the diameter its web holes may reach without a recess); or why not, when ASME has no key for the bore. */
  wheel(faceWidth: number, rim = 0): Wheel | string {
    let key: { width: number; depth: number } | null = null;
    if (this.drawBore && this.keyway !== "none") {
      const standard = this.keyway === "custom" ? null : standardKey(this.boreDiameter, "inch", this.keyway);
      if (this.keyway !== "custom" && !standard) return "ASME B17.1 has no key for a bore that size: choose a custom keyway";
      key = standard ? { width: standard.width, depth: standard.hub } : { width: this.keyWidth, depth: this.keyDepth };
    }
    return {
      faceWidth,
      recess: this.drawRecess ? { web: this.web, diameter: this.recessDiameter } : null,
      hub: !this.drawHub
        ? null
        : this.worm
          ? { diameter: this.hubDiameter, left: this.hubLeft, right: this.hubRight }
          : { diameter: this.hubDiameter, left: this.hubSides === "right" ? 0 : this.hubProjection, right: this.hubSides === "left" ? 0 : this.hubProjection },
      bore: this.drawBore ? { diameter: this.boreDiameter, key } : null,
      holes: this.webHoles(key, rim),
    };
  }
}

const KEYWAY_NOTE = "Square and rectangular keyways take the ASME B17.1 size for the bore; a custom one's depth is into the hub. Hole Center Distance is the diameter of the circle the holes are on.";

export class SpurGearTool extends PlaceTool {
  readonly id = "spurgear";
  readonly cursor = "crosshair";
  protected readonly label = "Spur Gear";
  private view: GearView = "front";
  private profile: GearProfile = "involute";
  private pitchDiameter = 100;
  private teeth = 40;
  private pressureAngle = 20;
  private faceWidth = 20;
  private readonly parts = new WheelPrefs(75);
  private problem: string | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "View", options: GEAR_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view },
      { label: "Tooth profile", options: GEAR_PROFILES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 3) })), active: this.profile },
    ];
  }

  setMode(id: string): void {
    const view = GEAR_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
    const profile = GEAR_PROFILES.find((m) => m.id === id);
    if (profile) this.profile = profile.id;
  }

  hint(): string {
    return `${super.hint()} · 1–2 view · 3–4 tooth profile`;
  }

  async preferences(): Promise<void> {
    const sizes = gearSizes(this.pitchDiameter, this.teeth, this.pressureAngle);
    const v = await toolPrefs(
      "Spur Gear Preferences",
      [
        { kind: "length", key: "pitch", label: "Pitch Diameter", value: this.pitchDiameter },
        { kind: "number", key: "teeth", label: "Number of Teeth", value: this.teeth, min: MIN_GEAR_TEETH, max: MAX_GEAR_TEETH, integer: true },
        { kind: "choice", key: "pressure", label: "Pressure Angle", value: String(this.pressureAngle), options: PRESSURE_ANGLES },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        ...this.parts.fields("Show Center Lines"),
      ],
      `Now: module ${ref(sizes.module)} mm, diametral pitch ${ref(sizes.diametralPitch)}, outside diameter ${ref(sizes.outside)} mm, root diameter ${ref(sizes.root)} mm. ${KEYWAY_NOTE}`,
    );
    if (!v) return;
    this.pitchDiameter = v.num("pitch");
    this.teeth = v.num("teeth");
    this.pressureAngle = Number(v.choice("pressure")) || 20;
    this.faceWidth = v.num("face");
    this.parts.read(v);
  }

  /** The gear Preferences describe, or null (with the reason kept for the refusal) when they don't make one. */
  private gear(): SpurGear | null {
    const wheel = this.parts.wheel(this.faceWidth);
    if (typeof wheel === "string") {
      this.problem = wheel;
      return null;
    }
    const g: SpurGear = { ...wheel, pitchDiameter: this.pitchDiameter, teeth: this.teeth, pressureAngle: this.pressureAngle, profile: this.profile };
    this.problem = gearProblem(g);
    return this.problem ? null : g;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const g = this.gear();
    if (!g || scale === null) return null;
    const beyond = this.parts.centreLines ? CENTRE_BEYOND_MM * scale : null;
    return drawingParts(this.view === "front" ? spurGearFront(g, beyond) : spurGearSide(g, beyond), at, angle);
  }

  solid(): Solid | null {
    const g = this.gear();
    return g && onLayer(toothedSolid(spurGearFront(g, null).outlines[0], spurGearSide(g, null).outlines));
  }

  protected refusal(): string {
    return `The gear's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

const SPROCKET_VIEWS: readonly { readonly id: SprocketView; readonly label: string }[] = [
  { id: "front", label: "Front View" },
  { id: "side", label: "Side View" },
];
const CHAIN_OPTIONS = CHAINS.map((c) => ({ value: c.id, label: c.label }));
const chainOf = (id: string): ChainSize => CHAINS.find((c) => c.id === id) ?? CHAINS[2];

export class SprocketTool extends PlaceTool {
  readonly id = "sprocket";
  readonly cursor = "crosshair";
  protected readonly label = "Sprocket";
  private view: SprocketView = "front";
  private chain = chainOf("ansi40");
  private teeth = 20;
  private rows = 1;
  private standardWidth = true;
  private toothWidth = 7;
  private spacing = 14.4;
  private readonly parts = new WheelPrefs(60);
  private problem: string | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: SPROCKET_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = SPROCKET_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–2 view`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Sprocket Preferences",
      [
        { kind: "choice", key: "chain", label: "Std. Chain No. (Pitch)", value: this.chain.id, options: CHAIN_OPTIONS },
        { kind: "number", key: "teeth", label: "Number of Teeth", value: this.teeth, min: MIN_SPROCKET_TEETH, max: MAX_SPROCKET_TEETH, integer: true },
        { kind: "number", key: "rows", label: "Number of Rows", value: this.rows, min: 1, max: MAX_ROWS, integer: true },
        { kind: "check", key: "standard", label: "Use Standard Width and Spacing", value: this.standardWidth },
        { kind: "length", key: "toothWidth", label: "Face Width", value: this.toothWidth },
        { kind: "length", key: "spacing", label: "Spacing", value: this.spacing },
        ...this.parts.fields("Draw Center Lines"),
      ],
      `Now: pitch diameter ${ref(sprocketPitchDiameter(this.chain, this.teeth))} mm. Teeth are drawn in the ISO 606 tooth form; the standard width is ANSI B29.1's for the chain's inner width and rows, the spacing its strands'. ${KEYWAY_NOTE}`,
    );
    if (!v) return;
    this.chain = chainOf(v.choice("chain"));
    this.teeth = v.num("teeth");
    this.rows = v.num("rows");
    this.standardWidth = v.flag("standard");
    this.toothWidth = v.num("toothWidth");
    this.spacing = v.num("spacing");
    this.parts.read(v);
  }

  private sprocket(): Sprocket | null {
    const toothWidth = this.standardWidth ? standardToothWidth(this.chain, this.rows) : this.toothWidth;
    const spacing = this.standardWidth ? this.chain.transverse : this.spacing;
    const wheel = this.parts.wheel(sprocketWidth({ toothWidth, spacing, rows: this.rows }));
    if (typeof wheel === "string") {
      this.problem = wheel;
      return null;
    }
    const s: Sprocket = { ...wheel, chain: this.chain, teeth: this.teeth, rows: this.rows, toothWidth, spacing };
    this.problem = sprocketProblem(s);
    return this.problem ? null : s;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const s = this.sprocket();
    if (!s || scale === null) return null;
    const beyond = this.parts.centreLines ? CENTRE_BEYOND_MM * scale : null;
    return drawingParts(this.view === "front" ? sprocketFront(s, beyond) : sprocketSide(s, beyond), at, angle);
  }

  solid(): Solid | null {
    const s = this.sprocket();
    return s && onLayer(toothedSolid(sprocketFront(s, null).outlines[0], sprocketSide(s, null).outlines));
  }

  protected refusal(): string {
    return `The sprocket's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

export class LinearChainTool extends PlaceTool {
  readonly id = "chainlinear";
  readonly cursor = "crosshair";
  protected readonly label = "Roller Chain - Linear";
  private chain = chainOf("ansi40");
  private links = 12;
  private startPin = true;

  hint(): string {
    return `Click to place the chain running right, or press and drag along it · ${this.links} links, ${ref(this.links * this.chain.pitch)} mm`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roller Chain - Linear Preferences",
      [
        { kind: "choice", key: "chain", label: "Std. Chain No. (Pitch)", value: this.chain.id, options: CHAIN_OPTIONS },
        { kind: "number", key: "links", label: "No. of Links", value: this.links, min: 1, max: MAX_LINKS, integer: true },
        { kind: "check", key: "pin", label: "Start with Pin Link", value: this.startPin },
      ],
      "The chain's length is its links times its pitch. Pin links' outer plates are drawn over roller links' inner plates.",
    );
    if (!v) return;
    this.chain = chainOf(v.choice("chain"));
    this.links = v.num("links");
    this.startPin = v.flag("pin");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    return drawingParts(linearChain(this.chain, this.links, this.startPin), at, angle);
  }

  solid(): Solid {
    return chainSolid(this.chain, linearPins(this.chain, this.links), this.startPin);
  }
}

export class CircularChainTool extends PlaceTool {
  readonly id = "chaincircular";
  readonly cursor = "crosshair";
  protected readonly label = "Roller Chain - Circular";
  private chain = chainOf("ansi40");
  private teeth = 20;
  private startAngle = 0;
  private links = 10;
  private clockwise = false;
  private startPin = true;
  private locus = false;

  hint(): string {
    return "Click to place the chain round its sprocket's centre, or press and drag to turn it";
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roller Chain - Circular Preferences",
      [
        { kind: "choice", key: "chain", label: "Standard Chain No. (Pitch)", value: this.chain.id, options: CHAIN_OPTIONS },
        { kind: "number", key: "teeth", label: "No. of Teeth (Sprocket)", value: this.teeth, min: MIN_SPROCKET_TEETH, max: MAX_SPROCKET_TEETH, integer: true },
        { kind: "number", key: "start", label: "Start Angle", value: this.startAngle, min: -360, max: 360, unit: "°" },
        { kind: "number", key: "links", label: "Number of Links", value: this.links, min: 1, max: MAX_SPROCKET_TEETH, integer: true },
        {
          kind: "choice",
          key: "direction",
          label: "Direction",
          value: this.clockwise ? "cw" : "ccw",
          options: [
            { value: "ccw", label: "Counterclockwise" },
            { value: "cw", label: "Clockwise" },
          ],
        },
        { kind: "check", key: "pin", label: "Start with Pin Link", value: this.startPin },
        { kind: "check", key: "locus", label: "Place Locus at Center", value: this.locus },
      ],
      `Now: pitch diameter ${ref(sprocketPitchDiameter(this.chain, this.teeth))} mm. A chain goes round its sprocket at most once: links past the teeth are left off. Placed on a sprocket's centre, its rollers sit in the seats when the Start Angle (plus any turn) is a whole number of teeth (360° over the teeth).`,
    );
    if (!v) return;
    this.chain = chainOf(v.choice("chain"));
    this.teeth = v.num("teeth");
    this.startAngle = v.num("start");
    this.links = v.num("links");
    this.clockwise = v.choice("direction") === "cw";
    this.startPin = v.flag("pin");
    this.locus = v.flag("locus");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const d = circularChain(this.chain, this.teeth, this.links, (this.startAngle * Math.PI) / 180, this.clockwise, this.startPin);
    const parts = drawingParts(d, at, angle);
    return this.locus ? [...parts, { kind: "locus", at }] : parts;
  }

  solid(): Solid {
    return chainSolid(this.chain, circularPins(this.chain, this.teeth, this.links, (this.startAngle * Math.PI) / 180, this.clockwise), this.startPin);
  }
}

const RACK_VIEWS: readonly { readonly id: RackView; readonly label: string }[] = [
  { id: "front", label: "Front View" },
  { id: "top", label: "Top View" },
  { id: "side", label: "Side View" },
];

export class GearRackTool extends PlaceTool {
  readonly id = "gearrack";
  readonly cursor = "crosshair";
  protected readonly label = "Spur Gear Rack";
  private view: RackView = "front";
  private method: "module" | "pitch" = "module";
  /** the module (mm) or diametral pitch (teeth per inch), as the method says */
  private size = 2.5;
  private pressureAngle = 20;
  private teeth = 12;
  private thickness = 15;
  private faceWidth = 20;
  private allTeeth = true;
  private fillet = false;
  private pitchLine = true;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: RACK_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = RACK_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–3 view`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Spur Gear Rack Preferences",
      [
        {
          kind: "choice",
          key: "method",
          label: "Method",
          value: this.method,
          options: [
            { value: "module", label: "Module (metric)" },
            { value: "pitch", label: "Diametral Pitch (inch)" },
          ],
        },
        { kind: "number", key: "size", label: "Diametral Pitch or Module (mm)", value: this.size, min: 0.05, max: 200 },
        { kind: "choice", key: "pressure", label: "Pressure Angle", value: String(this.pressureAngle), options: PRESSURE_ANGLES },
        { kind: "number", key: "teeth", label: "Number of Teeth", value: this.teeth, min: 1, max: MAX_RACK_TEETH, integer: true },
        { kind: "length", key: "thickness", label: "Thickness", value: this.thickness },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        { kind: "check", key: "all", label: "Show All Teeth", value: this.allTeeth },
        { kind: "check", key: "fillet", label: "Draw Fillet", value: this.fillet },
        { kind: "check", key: "pitchLine", label: "Show Pitch Line", value: this.pitchLine },
      ],
      "Thickness is the body under the teeth' roots. A diametral pitch is teeth per inch of pitch diameter (module = 25.4 / pitch).",
    );
    if (!v) return;
    this.method = v.choice("method") === "pitch" ? "pitch" : "module";
    this.size = v.num("size");
    this.pressureAngle = Number(v.choice("pressure")) || 20;
    this.teeth = v.num("teeth");
    this.thickness = v.num("thickness");
    this.faceWidth = v.num("face");
    this.allTeeth = v.flag("all");
    this.fillet = v.flag("fillet");
    this.pitchLine = v.flag("pitchLine");
  }

  private rack(): SpurRack {
    return {
      module: this.method === "pitch" ? 25.4 / this.size : this.size,
      pressureAngle: this.pressureAngle,
      teeth: this.teeth,
      thickness: this.thickness,
      faceWidth: this.faceWidth,
      allTeeth: this.allTeeth,
      fillet: this.fillet,
      pitchLine: this.pitchLine,
    };
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const r = this.rack();
    if (scale === null || rackProblem(r)) return null;
    return drawingParts(spurRack(r, this.view, CENTRE_BEYOND_MM * scale), at, angle);
  }

  solid(): Solid | null {
    const r = this.rack();
    if (rackProblem(r)) return null;
    return onLayer(onEdge(prism([spurRack({ ...r, allTeeth: true }, "front", 0).outlines[0]], -r.faceWidth, 0)));
  }

  protected refusal(): string {
    return `The rack's Preferences don't make one: ${rackProblem(this.rack()) ?? "check its sizes"}.`;
  }
}

const BEARING_VIEWS: readonly { readonly id: BearingView; readonly label: string }[] = [
  { id: "front", label: "Front View" },
  { id: "side", label: "Side View" },
];
const BEARING_NOTE =
  "The rings, rolling elements, grooves and ribs are proportioned from the three sizes. Show Detail off draws ISO 8826-1's simplified bearing: the section's outline with an upright cross.";

/** What every bearing tool shares: a front and a side view, centre lines, and a refusal giving the reason. */
abstract class TwoViewBearingTool extends PlaceTool {
  readonly cursor = "crosshair";
  private view: BearingView = "front";
  protected centreLines = true;
  protected problem: string | null = null;

  /** the bearing in `view`, or null with the reason kept in `problem` */
  protected abstract drawing(view: BearingView, beyond: number | null): HoleDrawing | null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: BEARING_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = BEARING_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–2 view`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const d = this.drawing(this.view, this.centreLines ? CENTRE_BEYOND_MM * scale : null);
    return d ? drawingParts(d, at, angle) : null;
  }

  /** The side view's section turned about its axis, the balls as rings. */
  solid(): Solid | null {
    const d = this.drawing("side", null);
    return d && onLayer(turnedSection([...d.outlines, ...d.circles.map((c) => circleOutline(c.center, c.radius, 16))]));
  }

  protected refusal(): string {
    return `The bearing's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** What the ball, roller and needle bearing tools share: the sizes and the detail switch. */
abstract class BearingTool extends TwoViewBearingTool {
  protected inside = 20;
  protected outside = 47;
  protected width = 14;
  private detail = true;
  /** the Bearing Type field */
  protected abstract typeField(): PrefField;
  /** any fields between the sizes and Show Detail */
  protected extraFields(): PrefField[] {
    return [];
  }
  protected abstract read(v: PrefValues): void;
  protected abstract bearing(sizes: { inside: number; outside: number; width: number; detail: boolean }): Bearing;
  protected abstract readonly note: string;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        this.typeField(),
        { kind: "length", key: "inside", label: "Inside Diameter", value: this.inside },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "width", label: "Width", value: this.width },
        ...this.extraFields(),
        { kind: "check", key: "detail", label: "Show Detail", value: this.detail },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `${this.note} ${BEARING_NOTE}`,
    );
    if (!v) return;
    this.read(v);
    this.inside = v.num("inside");
    this.outside = v.num("outside");
    this.width = v.num("width");
    this.detail = v.flag("detail");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: BearingView, beyond: number | null): HoleDrawing | null {
    const b = this.bearing({ inside: this.inside, outside: this.outside, width: this.width, detail: this.detail });
    this.problem = bearingProblem(b);
    if (this.problem) return null;
    return view === "front" ? bearingFront(b, beyond) : bearingSide(b, beyond);
  }
}

const BALL_TYPES: readonly { readonly value: BallType; readonly label: string }[] = [
  { value: "single-radial", label: "Single Row, Radial" },
  { value: "single-angular", label: "Single Row, Angular" },
  { value: "double-radial", label: "Double Row, Radial" },
  { value: "double-angular", label: "Double Row, Angular" },
];

export class BallBearingTool extends BearingTool {
  readonly id = "ballbearing";
  protected readonly label = "Ball Bearing";
  protected readonly note = "A 6204 is 20 × 47 × 14 mm. Angular bearings show their contact lines, a double row's back to back.";
  private type: BallType = "single-radial";

  protected typeField(): PrefField {
    return { kind: "choice", key: "type", label: "Bearing Type", value: this.type, options: BALL_TYPES };
  }

  protected read(v: PrefValues): void {
    this.type = BALL_TYPES.find((t) => t.value === v.choice("type"))?.value ?? "single-radial";
  }

  protected bearing(sizes: { inside: number; outside: number; width: number; detail: boolean }): Bearing {
    return { kind: "ball", type: this.type, ...sizes };
  }
}

const ROLLER_TYPES: readonly { readonly value: RollerType; readonly label: string }[] = [
  { value: "single-separable", label: "Single Row, Separable" },
  { value: "single", label: "Single Row" },
  { value: "single-self", label: "Single Row, Self Aligning" },
  { value: "double", label: "Double Row" },
  { value: "double-self", label: "Double Row, Self-Aligning" },
];

export class RollerBearingTool extends BearingTool {
  readonly id = "rollerbearing";
  protected readonly label = "Roller Bearing";
  protected readonly note =
    "An NU 204 is 20 × 47 × 14 mm. Separable: cylindrical rollers, the inner ring plain; Single Row: both rings ribbed; Double Row: the outer ring ribbed at its sides and between the rows; Self Aligning: barrel rollers in a spherical outer ring.";
  private type: RollerType = "single-separable";

  protected typeField(): PrefField {
    return { kind: "choice", key: "type", label: "Bearing Type", value: this.type, options: ROLLER_TYPES };
  }

  protected read(v: PrefValues): void {
    this.type = ROLLER_TYPES.find((t) => t.value === v.choice("type"))?.value ?? "single-separable";
  }

  protected bearing(sizes: { inside: number; outside: number; width: number; detail: boolean }): Bearing {
    return { kind: "roller", type: this.type, ...sizes };
  }
}

const NEEDLE_TYPES: readonly { readonly value: NeedleType; readonly label: string }[] = [
  { value: "machined", label: "Machined Ring" },
  { value: "drawn", label: "Drawn Cup" },
];

export class NeedleBearingTool extends BearingTool {
  readonly id = "needlebearing";
  protected readonly label = "Needle Bearing";
  protected readonly note =
    "An NA 4904 is 20 × 37 × 17 mm. Machined Ring: a ribbed outer ring; Drawn Cup: a thin shell with turned-in lips. Without the inner ring the needles run on the shaft, the inside diameter.";
  private type: NeedleType = "machined";
  private rows = 1;
  private innerRing = true;

  constructor(env: ToolEnv) {
    super(env);
    this.outside = 37;
    this.width = 17;
  }

  protected typeField(): PrefField {
    return { kind: "choice", key: "type", label: "Bearing Type", value: this.type, options: NEEDLE_TYPES };
  }

  protected extraFields(): PrefField[] {
    return [
      { kind: "number", key: "rows", label: "Number of Rows", value: this.rows, min: 1, max: MAX_NEEDLE_ROWS, integer: true },
      { kind: "check", key: "inner", label: "Show Inner Ring", value: this.innerRing },
    ];
  }

  protected read(v: PrefValues): void {
    this.type = v.choice("type") === "drawn" ? "drawn" : "machined";
    this.rows = v.num("rows");
    this.innerRing = v.flag("inner");
  }

  protected bearing(sizes: { inside: number; outside: number; width: number; detail: boolean }): Bearing {
    return { kind: "needle", type: this.type, rows: this.rows, innerRing: this.innerRing, ...sizes };
  }
}

const TAPERED_TYPES: readonly { readonly value: TaperedType; readonly label: string }[] = [
  { value: "single", label: "Single Row" },
  { value: "double", label: "Double Row" },
];

export class TaperedBearingTool extends TwoViewBearingTool {
  readonly id = "taperedbearing";
  protected readonly label = "Tapered Roller Bearing";
  private type: TaperedType = "single";
  /** a 30204 */
  private inside = 20;
  private outside = 47;
  private innerWidth = 14;
  private outerWidth = 12;
  private space = 2;
  private projection = 3.25;
  private retainers = true;
  private detail = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Tapered Roller Bearing Preferences",
      [
        { kind: "choice", key: "type", label: "Bearing Type", value: this.type, options: TAPERED_TYPES },
        { kind: "length", key: "inside", label: "Inside Diameter", value: this.inside },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "innerWidth", label: "Width of Inner Ring", value: this.innerWidth },
        { kind: "length", key: "outerWidth", label: "Width of Outer Ring", value: this.outerWidth },
        { kind: "number", key: "space", label: "Space Between Rows", value: this.space, min: 0, max: 10000, unit: "mm" },
        { kind: "number", key: "projection", label: "Inner Ring Projection", value: this.projection, min: 0, max: 10000, unit: "mm" },
        { kind: "check", key: "retainers", label: "Show Retainers", value: this.retainers },
        { kind: "check", key: "detail", label: "Show Detail", value: this.detail },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      "A 30204 is 20 × 47 mm, its inner ring 14 mm wide and its outer ring 12 mm, the inner ring standing 3.25 mm out past the outer at the rollers' large ends. Double Row is one outer ring over two inner rings back to back, the Space Between Rows apart; its Width of Outer Ring is the whole ring's, and the projection follows from the widths. The front view looks at the rollers' large ends. " +
        BEARING_NOTE,
    );
    if (!v) return;
    this.type = v.choice("type") === "double" ? "double" : "single";
    this.inside = v.num("inside");
    this.outside = v.num("outside");
    this.innerWidth = v.num("innerWidth");
    this.outerWidth = v.num("outerWidth");
    this.space = v.num("space");
    this.projection = v.num("projection");
    this.retainers = v.flag("retainers");
    this.detail = v.flag("detail");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: BearingView, beyond: number | null): HoleDrawing | null {
    const t = {
      type: this.type,
      inside: this.inside,
      outside: this.outside,
      innerWidth: this.innerWidth,
      outerWidth: this.outerWidth,
      space: this.space,
      projection: this.projection,
      retainers: this.retainers,
      detail: this.detail,
    };
    this.problem = taperedProblem(t);
    if (this.problem) return null;
    return view === "front" ? taperedFront(t, beyond) : taperedSide(t, beyond);
  }
}

const THRUST_TYPES: readonly { readonly value: ThrustType; readonly label: string }[] = [
  { value: "single-ball", label: "Single Ball" },
  { value: "double-ball", label: "Double Ball" },
  { value: "roller", label: "Cylindrical Roller" },
];
const RACEWAYS: readonly { readonly value: RacewayStyle; readonly label: string }[] = [
  { value: "grooved", label: "Grooved" },
  { value: "flat", label: "Flat" },
];

export class ThrustBearingTool extends TwoViewBearingTool {
  readonly id = "thrustbearing";
  protected readonly label = "Thrust Bearing";
  private type: ThrustType = "single-ball";
  private raceway: RacewayStyle = "grooved";
  /** a 51204 */
  private inside = 20;
  private outside = 40;
  private thickness = 14;
  private retainers = true;
  private detail = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Thrust Bearing Preferences",
      [
        { kind: "choice", key: "type", label: "Bearing Type", value: this.type, options: THRUST_TYPES },
        { kind: "choice", key: "raceway", label: "Raceway Style", value: this.raceway, options: RACEWAYS },
        { kind: "length", key: "inside", label: "Inside Diameter", value: this.inside },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "thickness", label: "Thickness", value: this.thickness },
        { kind: "check", key: "retainers", label: "Show Retainer(s)", value: this.retainers },
        { kind: "check", key: "detail", label: "Show Detail", value: this.detail },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      "A 51204 is 20 × 40 × 14 mm. The shaft washer is on the left (a double bearing's between its rows), the housing washer on the right; the front view looks at the housing washer. Grooved washers hold the balls in grooves, or a roller between lips. " +
        BEARING_NOTE,
    );
    if (!v) return;
    this.type = THRUST_TYPES.find((t) => t.value === v.choice("type"))?.value ?? "single-ball";
    this.raceway = v.choice("raceway") === "flat" ? "flat" : "grooved";
    this.inside = v.num("inside");
    this.outside = v.num("outside");
    this.thickness = v.num("thickness");
    this.retainers = v.flag("retainers");
    this.detail = v.flag("detail");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: BearingView, beyond: number | null): HoleDrawing | null {
    const t = { type: this.type, raceway: this.raceway, inside: this.inside, outside: this.outside, thickness: this.thickness, retainers: this.retainers, detail: this.detail };
    this.problem = thrustProblem(t);
    if (this.problem) return null;
    return view === "front" ? thrustFront(t, beyond) : thrustSide(t, beyond);
  }
}

const LOCK_NUT_SIZES = LOCK_NUTS.map((n) => ({ value: n.id, label: `${n.id} (M${n.thread} × ${n.pitch})` }));

export class LockNutTool extends TwoViewBearingTool {
  readonly id = "locknut";
  protected readonly label = "Bearing Lock Nut";
  private size = LOCK_NUTS[4];
  private washer = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Bearing Lock Nut Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: this.size.id, options: LOCK_NUT_SIZES },
        { kind: "check", key: "washer", label: "Show Washer", value: this.washer },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      "KM nuts (DIN 981) from catalogue tables, the front view on their chamfered face with four slots, the thread drawn as ISO 6410 shows a tapped hole; Show Washer adds the MB tab washer's outer tabs round it. The side view, cut through the axis, shows no washer.",
    );
    if (!v) return;
    this.size = LOCK_NUTS.find((n) => n.id === v.choice("size")) ?? LOCK_NUTS[4];
    this.washer = v.flag("washer");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: BearingView, beyond: number | null): HoleDrawing | null {
    this.problem = null;
    return view === "front" ? lockNutFront(this.size, this.washer, beyond) : lockNutSide(this.size, beyond);
  }
}

export class PulleyTool extends PlaceTool {
  readonly id = "pulley";
  readonly cursor = "crosshair";
  protected readonly label = "Pulley";
  private view: GearView = "front";
  private outside = 125;
  private groove = { depth: 11, width: 13, angle: 38, radius: 1 };
  private grooves = 1;
  private first = 10;
  private between = 15;
  private faceWidth = 20;
  private rootCircle = false;
  private readonly parts = new WheelPrefs(85, true);
  private problem: string | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: GEAR_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = GEAR_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–2 view`;
  }

  async preferences(): Promise<void> {
    const face = pulleyFaceWidth(this.grooves, this.first, this.between, this.faceWidth);
    const v = await toolPrefs(
      "Pulley Preferences",
      [
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "depth", label: "Groove Depth", value: this.groove.depth },
        { kind: "length", key: "width", label: "Groove Width", value: this.groove.width },
        { kind: "number", key: "angle", label: "Groove Angle", value: this.groove.angle, min: 0, max: 119, unit: "°" },
        { kind: "length", key: "radius", label: "Groove Radius", value: this.groove.radius, zero: true },
        { kind: "number", key: "grooves", label: "Number of Grooves", value: this.grooves, min: 1, max: MAX_GROOVES, integer: true },
        { kind: "length", key: "first", label: "Dist. to First Groove", value: this.first },
        { kind: "length", key: "between", label: "Distance Between Grooves", value: this.between },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        ...this.parts.fields("Show Center Lines"),
        { kind: "check", key: "root", label: "Show Root Diameter", value: this.rootCircle },
      ],
      `Now: root diameter ${ref(pulleyRoot({ outside: this.outside, groove: this.groove }))} mm, face width ${ref(face)} mm. A groove is a V of its angle, width at the outside and depth, the corners at its bottom rounded to the groove radius; for a round belt give a small angle and a radius half the width. Face Width is for one groove, centred on it; with more, the face is the distance to the first groove on each side plus the spacing between them. Holes (Percent) and Spokes size themselves across the recess, Size a share of the room there (spokes need the hub and the recess drawn); Center Distance and Hole Diameter are for Holes (Diameter). The root diameter is drawn in the front view. ${KEYWAY_NOTE}`,
    );
    if (!v) return;
    this.outside = v.num("outside");
    this.groove = { depth: v.num("depth"), width: v.num("width"), angle: v.num("angle"), radius: v.num("radius") };
    this.grooves = v.num("grooves");
    this.first = v.num("first");
    this.between = v.num("between");
    this.faceWidth = v.num("face");
    this.parts.read(v);
    this.rootCircle = v.flag("root");
  }

  private pulley(): Pulley | null {
    const wheel = this.parts.wheel(pulleyFaceWidth(this.grooves, this.first, this.between, this.faceWidth), pulleyRoot({ outside: this.outside, groove: this.groove }));
    if (typeof wheel === "string") {
      this.problem = wheel;
      return null;
    }
    const p: Pulley = { ...wheel, outside: this.outside, groove: this.groove, grooves: this.grooves, first: this.first, between: this.between, spokes: this.parts.spokes() };
    this.problem = pulleyProblem(p);
    return this.problem ? null : p;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const p = this.pulley();
    if (!p || scale === null) return null;
    const beyond = this.parts.centreLines ? CENTRE_BEYOND_MM * scale : null;
    return drawingParts(this.view === "front" ? pulleyFront(p, beyond, this.rootCircle) : pulleySide(p, beyond), at, angle);
  }

  solid(): Solid | null {
    const p = this.pulley();
    return p && onLayer(turnedSection(pulleySide(p, null).outlines));
  }

  protected refusal(): string {
    return `The pulley's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

const KEY_VIEWS: readonly { readonly id: KeyView; readonly label: string }[] = [
  { id: "front", label: "Front View" },
  { id: "top", label: "Top View" },
  { id: "side", label: "Side View" },
];

/** What the Key and Woodruff Key tools share: three views on keys 1 to 3, and a refusal. */
abstract class KeyViewTool extends PlaceTool {
  readonly cursor = "crosshair";
  private view: KeyView = "front";
  protected problem: string | null = null;

  /** the key in `view`, or null with the reason kept in `problem` */
  protected abstract drawing(view: KeyView): HoleDrawing | null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: KEY_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = KEY_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–3 view`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const d = this.drawing(this.view);
    return d ? drawingParts(d, at, angle) : null;
  }

  protected refusal(): string {
    return `The key's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** DIN 6885-1's smallest chamfer on a key's long edges, by its width, mm. */
const dinChamfer = (b: number): number => (b <= 6 ? 0.16 : b <= 14 ? 0.25 : b <= 22 ? 0.4 : 0.6);

/** Parallel keys' standard sizes: DIN 6885-1's, and ASME B17.1's square and rectangular keys, mm. */
const KEY_SIZES: readonly { readonly id: string; readonly label: string; readonly width: number; readonly height: number; readonly chamfer: number }[] = [
  ...DIN_6885.map(([, b, h]) => ({ id: `m${b}x${h}`, label: `${b} × ${h} mm (DIN 6885-1)`, width: b, height: h, chamfer: dinChamfer(b) })),
  ...ASME_B17_1.flatMap(([, w, h]) => [
    { id: `i${w}sq`, label: `${inchText(w)} × ${inchText(w)} in, square (ASME B17.1)`, width: w * 25.4, height: w * 25.4, chamfer: 0 },
    ...(h < w ? [{ id: `i${w}x${h}`, label: `${inchText(w)} × ${inchText(h)} in, rectangular (ASME B17.1)`, width: w * 25.4, height: h * 25.4, chamfer: 0 }] : []),
  ]),
];

export class KeyTool extends KeyViewTool {
  readonly id = "key";
  protected readonly label = "Key";
  private size = "m8x7";
  private width = 8;
  private height = 7;
  private length = 40;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Key Preferences",
      [
        {
          kind: "choice",
          key: "size",
          label: "Nom. Size",
          value: this.size,
          options: [...KEY_SIZES.map((k) => ({ value: k.id, label: k.label })), { value: "custom", label: "Custom (the Width and Height below)" }],
        },
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "height", label: "Height", value: this.height },
        { kind: "length", key: "length", label: "Length", value: this.length },
      ],
      "The size picks the standard: DIN 6885-1's keys (metric), their long edges chamfered by its smallest chamfer, or ASME B17.1's square and rectangular keys (imperial), square-edged. Width and Height follow the size; choose Custom to set them. The front view is the key's end.",
    );
    if (!v) return;
    this.size = v.choice("size");
    const k = KEY_SIZES.find((s) => s.id === this.size);
    this.width = k ? k.width : v.num("width");
    this.height = k ? k.height : v.num("height");
    this.length = v.num("length");
  }

  protected drawing(view: KeyView): HoleDrawing | null {
    const chamfer = KEY_SIZES.find((s) => s.id === this.size)?.chamfer ?? 0;
    this.problem = parallelKeyProblem(this.width, this.height, chamfer);
    return this.problem ? null : parallelKey(this.width, this.height, this.length, chamfer, view);
  }

  solid(): Solid | null {
    const d = this.drawing("front");
    return d && onLayer(lying(prism([d.outlines[0]], -this.length / 2, this.length / 2)));
  }
}

export class WoodruffKeyTool extends KeyViewTool {
  readonly id = "woodruffkey";
  protected readonly label = "Woodruff Key";
  private woodruff = WOODRUFF_KEYS.find((k) => k.id === "m4x6.5") ?? WOODRUFF_KEYS[0];

  async preferences(): Promise<void> {
    const k = this.woodruff;
    const inch = (mm: number): string => `${ref(mm / 25.4)} in`;
    const seat = k.metric
      ? `keyseat ${ref(k.shaft)} mm deep in the shaft (t1) and ${ref(k.hub)} mm in the hub (t2)`
      : `keyseat ${inch(k.shaft)} deep in the shaft, the key standing ${inch(k.hub)} above it`;
    const v = await toolPrefs(
      "Woodruff Key Preferences",
      [{ kind: "choice", key: "size", label: "Nom. Size", value: k.id, options: WOODRUFF_KEYS.map((w) => ({ value: w.id, label: w.label })) }],
      `Now: ${k.label}, ${ref(woodruffLength(k))} mm long, ${seat}. The size picks the standard: DIN 6888 (metric) or ASME B17.2 (imperial), full-radius keys; ASME's flat-bottom keys aren't here. The front view is the key's half-moon face, the top its flat, the side its end.`,
    );
    if (!v) return;
    this.woodruff = WOODRUFF_KEYS.find((w) => w.id === v.choice("size")) ?? this.woodruff;
  }

  protected drawing(view: KeyView): HoleDrawing | null {
    this.problem = null;
    return woodruffKey(this.woodruff, view);
  }

  solid(): Solid {
    const half = this.woodruff.width / 2;
    return onLayer(onEdge(prism([woodruffKey(this.woodruff, "front").outlines[0]], -half, half)));
  }
}

const SPRING_DISPLAYS: readonly { readonly id: SpringDisplay; readonly label: string }[] = [
  { id: "front", label: "Solid - Front Coils Only" },
  { id: "rear", label: "Solid - Rear Coils Only" },
  { id: "both", label: "Solid - Front and Rear Coils" },
  { id: "section", label: "Section" },
  { id: "simple", label: "Simplified" },
];
const SPRING_ENDS: readonly { readonly value: SpringEnds; readonly label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "plainground", label: "Plain and Ground" },
  { value: "squared", label: "Squared (Closed)" },
  { value: "squaredground", label: "Squared and Ground" },
];
const SPIRALS = [
  { value: "right", label: "Right Hand" },
  { value: "left", label: "Left Hand" },
];
const SPRING_NOTE =
  "Each half coil is drawn as a straight band of wire. The display is on keys 1 to 5: Solid - Front Coils Only and Solid - Rear Coils Only are named in Vectorworks' help; Front and Rear Coils, Section (the wire cut on the axis's plane, over the coils behind) and Simplified (ISO 2162-1's zigzag along the wire) are Rodeo's.";
/** colour indices of white, the paper solid coils are filled with so those in front hide those behind, and black */
const WHITE = 256;
const BLACK = 257;

/** A spring's drawing as parts at `at`, turned by `angle` radians: its bands filled white in order, its wire cuts filled in the pen's colour, its lines. */
function springParts(d: SpringDrawing, at: Pt, angle: number): Part[] {
  const ink = store.drawAttrs.penFore ?? BLACK;
  const filled = (points: Pt[], colour: number): Part => ({
    shape: { kind: "polygon", points: placed(points, at, angle), closed: true },
    attrs: { fillPattern: 1, fillFore: colour, fillBack: colour, fillOpacity: 100 },
  });
  return [
    ...d.solid.map((points) => filled(points, WHITE)),
    ...d.cuts.map((points) => filled(points, ink)),
    ...d.lines.map((points): Part => ({ kind: "polyline", points: placed(points, at, angle), closed: false })),
  ];
}

/** What the coiled springs share: the display, the working length, the spiral and the centre line. */
abstract class SpringTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected display: SpringDisplay = "both";
  protected length = 50;
  protected leftHand = false;
  protected centreLine = true;
  protected problem: string | null = null;

  /** the spring in `display` with its axis reaching `beyond` its ends, or null with the reason kept in `problem` */
  protected abstract drawing(display: SpringDisplay, beyond: number | null): SpringDrawing | null;

  modes(): readonly ToolModes[] {
    return [{ label: "Display", options: SPRING_DISPLAYS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.display }];
  }

  setMode(id: string): void {
    const display = SPRING_DISPLAYS.find((m) => m.id === id);
    if (display) this.display = display.id;
  }

  hint(): string {
    return `${super.hint()} · the spring runs right from the click · 1–5 display`;
  }

  /** Working Length, Spiral and Draw Center Line, after a tool's own fields. */
  protected commonFields(): PrefField[] {
    return [
      { kind: "length", key: "length", label: "Working Length", value: this.length },
      { kind: "choice", key: "spiral", label: "Spiral", value: this.leftHand ? "left" : "right", options: SPIRALS },
      { kind: "check", key: "centre", label: "Draw Center Line", value: this.centreLine },
    ];
  }

  protected readCommon(v: PrefValues): void {
    // a spring without a working length (a torsion spring's) leaves it out of its fields
    const length = v.num("length");
    if (Number.isFinite(length)) this.length = length;
    this.leftHand = v.choice("spiral") === "left";
    this.centreLine = v.flag("centre");
  }

  /** `c` if it can be drawn, else null with the reason kept. */
  protected checked(c: Coils): Coils | null {
    this.problem = coilsProblem(c);
    return this.problem ? null : c;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    this.problem = null;
    if (scale === null) return null;
    const d = this.drawing(this.display, this.centreLine ? CENTRE_BEYOND_MM * scale : null);
    return d ? springParts(d, at, angle) : null;
  }

  protected refusal(): string {
    return `The spring's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** A compression spring: its coils from its Preferences. */
abstract class CoilSpringTool extends SpringTool {
  /** the spring's coils with this length and hand, or null with the reason kept in `problem` */
  protected abstract coils(length: number, leftHand: boolean): Coils | null;

  /** before the coils are worked out */
  protected ready(): void {}

  protected drawing(display: SpringDisplay, beyond: number | null): SpringDrawing | null {
    this.ready();
    const c = this.coils(this.length, this.leftHand);
    return c ? springDrawing(c, display, beyond) : null;
  }

  solid(): Solid | null {
    this.ready();
    const c = this.coils(this.length, this.leftHand);
    return c && coilSolid(c);
  }
}

const TOO_SHORT = "the working length must be more than the solid height";
const springEnds = (v: PrefValues): SpringEnds => SPRING_ENDS.find((e) => e.value === v.choice("ends"))?.value ?? "squaredground";

/** A round-wire spring's coils: `active` of them with `ends`, the mean radius from `r0` to `r1`. */
function roundCoils(ends: SpringEnds, active: number, wire: number, r0: number, r1: number, length: number, leftHand: boolean): Coils | string {
  const path = coilPath(ends, active, wire, length);
  if (!path) return TOO_SHORT;
  return { wire: { kind: "round", width: wire }, ...path, r0, r1, length, leftHand };
}

export class CompressionSpring1Tool extends CoilSpringTool {
  readonly id = "compspring1";
  protected readonly label = "Compression Spring 1";
  private ends: SpringEnds = "squaredground";
  private wire = 2;
  private outside = 20;
  private solidHeight = 20;

  async preferences(): Promise<void> {
    const active = activeFromSolid(this.ends, this.solidHeight, this.wire);
    const v = await toolPrefs(
      "Compression Spring 1 Preferences",
      [
        { kind: "choice", key: "ends", label: "Type of Ends", value: this.ends, options: SPRING_ENDS },
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "solid", label: "Solid Height", value: this.solidHeight },
        ...this.commonFields(),
      ],
      `Now: ${ref(active)} active coils of ${ref(compressionCoils(this.ends, active, this.wire).total)}. The solid height and the ends give the coils: ground ends lose a wire's width. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.ends = springEnds(v);
    this.wire = v.num("wire");
    this.outside = v.num("outside");
    this.solidHeight = v.num("solid");
    this.readCommon(v);
  }

  protected coils(length: number, leftHand: boolean): Coils | null {
    const active = activeFromSolid(this.ends, this.solidHeight, this.wire);
    if (!(active > 0)) {
      this.problem = "the solid height leaves no active coils";
      return null;
    }
    const r = (this.outside - this.wire) / 2;
    const c = roundCoils(this.ends, active, this.wire, r, r, length, leftHand);
    if (typeof c === "string") {
      this.problem = c;
      return null;
    }
    return this.checked(c);
  }
}

export class CompressionSpring2Tool extends CoilSpringTool {
  readonly id = "compspring2";
  protected readonly label = "Compression Spring 2";
  private ends: SpringEnds = "squaredground";
  private wire = 2;
  private mean = 18;
  private active = 8;

  /** takes a spring the Spring Calculator handed over, keeping the working length unless the spring won't fit it */
  private takeHanded(): void {
    const s = takeHandedSpring(this.id);
    if (!s) return;
    this.ends = s.ends;
    this.wire = s.wire;
    this.mean = s.mean;
    this.active = s.active;
    if (!(this.length > s.solid * 1.2)) this.length = s.solid * 1.5;
  }

  async preferences(): Promise<void> {
    this.takeHanded();
    const v = await toolPrefs(
      "Compression Spring 2 Preferences",
      [
        { kind: "choice", key: "ends", label: "Type of Ends", value: this.ends, options: SPRING_ENDS },
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "mean", label: "Mean Diameter", value: this.mean },
        { kind: "number", key: "active", label: "Number of Active Coils", value: this.active, min: 0.5, max: MAX_COILS - 2 },
        ...this.commonFields(),
      ],
      `Now: solid height ${ref(compressionCoils(this.ends, this.active, this.wire).solid)} mm. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.ends = springEnds(v);
    this.wire = v.num("wire");
    this.mean = v.num("mean");
    this.active = v.num("active");
    this.readCommon(v);
  }

  protected override ready(): void {
    this.takeHanded();
  }

  protected coils(length: number, leftHand: boolean): Coils | null {
    const c = roundCoils(this.ends, this.active, this.wire, this.mean / 2, this.mean / 2, length, leftHand);
    if (typeof c === "string") {
      this.problem = c;
      return null;
    }
    return this.checked(c);
  }
}

export class ConicalSpringTool extends CoilSpringTool {
  readonly id = "conicalspring";
  protected readonly label = "Conical Compression Spring";
  private wire = 2;
  private small = 12;
  private large = 30;
  private active = 6;

  constructor(env: ToolEnv) {
    super(env);
    this.length = 40;
  }

  hint(): string {
    return `${super.hint()} from its large end`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Conical Compression Spring Preferences",
      [
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "small", label: "OD - Small End", value: this.small },
        { kind: "length", key: "large", label: "OD - Large End", value: this.large },
        { kind: "number", key: "active", label: "No. of Active Coils", value: this.active, min: 0.5, max: MAX_COILS - 2 },
        ...this.commonFields(),
      ],
      `The large end is on the click; the ends are squared and ground, as conical springs' usually are. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.wire = v.num("wire");
    this.small = v.num("small");
    this.large = v.num("large");
    this.active = v.num("active");
    this.readCommon(v);
  }

  protected coils(length: number, leftHand: boolean): Coils | null {
    const c = roundCoils("squaredground", this.active, this.wire, (this.large - this.wire) / 2, (this.small - this.wire) / 2, length, leftHand);
    if (typeof c === "string") {
      this.problem = c;
      return null;
    }
    return this.checked(c);
  }
}

export class DieSpringTool extends CoilSpringTool {
  readonly id = "diespring";
  protected readonly label = "Die Spring";
  private hole = 25;
  private shaft = 12.5;
  private wireWidth = 4;
  private wireHeight = 5;
  private solidHeight = 30;

  constructor(env: ToolEnv) {
    super(env);
    this.length = 51;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Die Spring Preferences",
      [
        { kind: "length", key: "hole", label: "Fits into Hole", value: this.hole },
        { kind: "length", key: "shaft", label: "Fits over Shaft", value: this.shaft },
        { kind: "length", key: "wireWidth", label: "Wire Width", value: this.wireWidth },
        { kind: "length", key: "wireHeight", label: "Wire Height", value: this.wireHeight },
        { kind: "length", key: "solid", label: "Solid Height", value: this.solidHeight },
        ...this.commonFields(),
      ],
      `Rectangular wire, Wire Width along the axis and Wire Height across it, coiled midway between the hole and the shaft; the ends are closed and ground, as die springs' are. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.hole = v.num("hole");
    this.shaft = v.num("shaft");
    this.wireWidth = v.num("wireWidth");
    this.wireHeight = v.num("wireHeight");
    this.solidHeight = v.num("solid");
    this.readCommon(v);
  }

  protected coils(length: number, leftHand: boolean): Coils | null {
    if (!((this.hole - this.shaft) / 2 >= this.wireHeight)) {
      this.problem = "the wire's height must fit between the hole and the shaft";
      return null;
    }
    const active = this.solidHeight / this.wireWidth - 2;
    if (!(active > 0)) {
      this.problem = "the solid height leaves no active coils";
      return null;
    }
    const path = coilPath("squaredground", active, this.wireWidth, length);
    if (!path) {
      this.problem = TOO_SHORT;
      return null;
    }
    const r = (this.hole + this.shaft) / 4;
    return this.checked({ wire: { kind: "rect", width: this.wireWidth, height: this.wireHeight }, ...path, r0: r, r1: r, length, leftHand });
  }
}

const HOOK_STYLES: readonly { readonly value: HookStyle; readonly label: string }[] = [
  { value: "loop", label: "Full Loop" },
  { value: "hook", label: "Open Hook" },
];
const HOOK_VIEWS: readonly { readonly value: HookView; readonly label: string }[] = [
  { value: "facing", label: "Loops Facing" },
  { value: "edgewise", label: "Loops Edgewise" },
];

export class ExtensionSpringFrontTool extends SpringTool {
  readonly id = "extspringfront";
  protected readonly label = "Extension Spring - Front";
  private outside = 20;
  private wire = 2;
  private free = 80;
  private style: HookStyle = "loop";
  private hook = 18;
  private view: HookView = "facing";
  private freeIsWorking = false;
  private allCoils = true;

  constructor(env: ToolEnv) {
    super(env);
    this.length = 100;
  }

  async preferences(): Promise<void> {
    const [working, spiral, centre] = this.commonFields();
    const v = await toolPrefs(
      "Extension Spring - Front Preferences",
      [
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "free", label: "Free Length", value: this.free },
        working,
        { kind: "choice", key: "style", label: "End Style", value: this.style, options: HOOK_STYLES },
        { kind: "length", key: "hook", label: "Hook Length", value: this.hook },
        spiral,
        { kind: "choice", key: "view", label: "View", value: this.view, options: HOOK_VIEWS },
        { kind: "check", key: "freeIsWorking", label: "Set Free Length to Working Length", value: this.freeIsWorking },
        { kind: "check", key: "allCoils", label: "Show All Coils", value: this.allCoils },
        centre,
      ],
      `Now: ${ref(extensionCoils(this.spring()))} coils, close wound at the free length and spread over the working length. Lengths run over the loops; Hook Length runs from the coils' end to a loop's outside. Show All Coils off draws three coils at each end with lines across the rest. End Style and View show Vectorworks' choices as pictures, so their names here are Rodeo's. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.outside = v.num("outside");
    this.wire = v.num("wire");
    this.free = v.num("free");
    this.style = HOOK_STYLES.find((h) => h.value === v.choice("style"))?.value ?? this.style;
    this.hook = v.num("hook");
    this.view = HOOK_VIEWS.find((h) => h.value === v.choice("view"))?.value ?? this.view;
    this.freeIsWorking = v.flag("freeIsWorking");
    this.allCoils = v.flag("allCoils");
    this.readCommon(v);
  }

  private spring(): ExtensionSpring {
    return {
      outside: this.outside,
      wire: this.wire,
      free: this.freeIsWorking ? this.length : this.free,
      length: this.length,
      hook: this.hook,
      style: this.style,
      view: this.view,
      allCoils: this.allCoils,
      leftHand: this.leftHand,
    };
  }

  protected drawing(display: SpringDisplay, beyond: number | null): SpringDrawing | null {
    const e = this.spring();
    this.problem = extensionProblem(e);
    return this.problem ? null : extensionFront(e, display, beyond);
  }

  solid(): Solid | null {
    const e = this.spring();
    this.problem = extensionProblem(e);
    return this.problem ? null : extensionSolid(e);
  }
}

export class ExtensionSpringEndTool extends PlaceTool {
  readonly id = "extspringend";
  readonly cursor = "crosshair";
  protected readonly label = "Extension Spring - End";
  private wire = 2;
  private outside = 20;
  private rightAngles = false;
  private centreLines = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Extension Spring - End Preferences",
      [
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "check", key: "rightAngles", label: "Ends at Right Angles", value: this.rightAngles },
        { kind: "check", key: "centre", label: "Draw Center Lines", value: this.centreLines },
      ],
      "The spring seen down its axis, centred on the click: the coils' ring, the near loop across it and, at right angles, the far loop seen through the bore. A spiral doesn't show from the end, so it isn't asked.",
    );
    if (!v) return;
    this.wire = v.num("wire");
    this.outside = v.num("outside");
    this.rightAngles = v.flag("rightAngles");
    this.centreLines = v.flag("centre");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null || !(this.outside > 3 * this.wire)) return null;
    return springParts(extensionEnd(this.outside, this.wire, this.rightAngles, this.centreLines ? CENTRE_BEYOND_MM * scale : null), at, angle);
  }

  protected refusal(): string {
    return "The spring's Preferences don't make one: the wire is too thick for the spring's diameter.";
  }
}

/** A torsion spring leg's band: filled white without its edge, so it hides what it crosses, then its outline. */
function legParts(l: Leg, at: Pt, angle: number): Part[] {
  return [
    { shape: { kind: "polygon", points: placed(l.fill, at, angle), closed: true }, attrs: { lineStyle: 0, fillPattern: 1, fillFore: WHITE, fillBack: WHITE, fillOpacity: 100 } },
    { kind: "polyline", points: placed(l.outline, at, angle), closed: false },
  ];
}

const LEG_DIRECTIONS: readonly { readonly value: LegDirection; readonly label: string }[] = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];
const LEG_ORIENTATIONS: readonly { readonly value: LegOrientation; readonly label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "forward", label: "Facing Forward" },
  { value: "rearward", label: "Facing Rearward" },
];

export class TorsionSpringFrontTool extends SpringTool {
  readonly id = "torsionfront";
  protected readonly label = "Torsion Spring - Front";
  private outside = 20;
  private wire = 2;
  private coils = 8;
  private legs: Record<"left" | "right", { on: boolean } & FrontLeg> = {
    left: { on: true, length: 40, direction: "up", orientation: "normal" },
    right: { on: true, length: 30, direction: "down", orientation: "normal" },
  };

  async preferences(): Promise<void> {
    const [, spiral, centre] = this.commonFields();
    const legFields = (side: "left" | "right", name: string): PrefField[] => {
      const leg = this.legs[side];
      return [
        { kind: "check", key: `${side}On`, label: `${name} End`, value: leg.on },
        { kind: "length", key: `${side}Length`, label: `${name} End Length`, value: leg.length },
        { kind: "choice", key: `${side}Direction`, label: `${name} End Direction`, value: leg.direction, options: LEG_DIRECTIONS },
        { kind: "choice", key: `${side}Orientation`, label: `${name} End Orientation`, value: leg.orientation, options: LEG_ORIENTATIONS },
      ];
    };
    const v = await toolPrefs(
      "Torsion Spring - Front Preferences",
      [
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "number", key: "coils", label: "Number of Active Coils", value: this.coils, min: 1, max: MAX_COILS },
        ...legFields("left", "Left"),
        ...legFields("right", "Right"),
        spiral,
        centre,
      ],
      `The coils run right from the click along their axis, close wound: the active coils plus one wire's width long. Each end's leg runs across the axis at its end coil, up or down to its length from the axis: Normal leaves the coils' side, Facing Forward crosses in front of them from their far side and Facing Rearward behind them. ${SPRING_NOTE}`,
    );
    if (!v) return;
    this.outside = v.num("outside");
    this.wire = v.num("wire");
    this.coils = v.num("coils");
    for (const side of ["left", "right"] as const) {
      this.legs[side] = {
        on: v.flag(`${side}On`),
        length: v.num(`${side}Length`),
        direction: LEG_DIRECTIONS.find((d) => d.value === v.choice(`${side}Direction`))?.value ?? this.legs[side].direction,
        orientation: LEG_ORIENTATIONS.find((o) => o.value === v.choice(`${side}Orientation`))?.value ?? this.legs[side].orientation,
      };
    }
    this.readCommon(v);
  }

  private spring(): TorsionFront {
    const leg = (side: "left" | "right"): FrontLeg | null => (this.legs[side].on ? this.legs[side] : null);
    return { outside: this.outside, wire: this.wire, coils: this.coils, left: leg("left"), right: leg("right"), leftHand: this.leftHand };
  }

  protected drawing(display: SpringDisplay, beyond: number | null): SpringDrawing | null {
    const t = this.spring();
    this.problem = torsionFrontProblem(t);
    return this.problem ? null : torsionFront(t, display, beyond).spring;
  }

  solid(): Solid | null {
    const t = this.spring();
    this.problem = torsionFrontProblem(t);
    return this.problem ? null : torsionSolid(t);
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    this.problem = null;
    if (scale === null) return null;
    const t = this.spring();
    this.problem = torsionFrontProblem(t);
    if (this.problem) return null;
    const d = torsionFront(t, this.display, this.centreLine ? CENTRE_BEYOND_MM * scale : null);
    return [...d.behind.flatMap((l) => legParts(l, at, angle)), ...springParts(d.spring, at, angle), ...d.front.flatMap((l) => legParts(l, at, angle))];
  }
}

const END_STYLES: readonly { readonly value: string; readonly label: string; readonly style: EndStyle; readonly clockwise: boolean }[] = [
  { value: "plain", label: "Plain", style: "plain", clockwise: false },
  ...(["quarter", "half", "threequarter", "loop"] as const).flatMap((style) =>
    [true, false].map((clockwise) => {
      const name = { quarter: "1/4 Bend", half: "1/2 Bend", threequarter: "3/4 Bend", loop: "Full Loop" }[style];
      return { value: `${style}-${clockwise ? "cw" : "ccw"}`, label: `${name} ${clockwise ? "CW" : "CCW"}`, style, clockwise };
    }),
  ),
];

export class TorsionSpringEndTool extends PlaceTool {
  readonly id = "torsionend";
  readonly cursor = "crosshair";
  protected readonly label = "Torsion Spring - End";
  private wire = 2;
  private outside = 20;
  private leftHand = false;
  private centreLines = true;
  private ends: Record<"end1" | "end2", { on: boolean } & EndLeg> = {
    end1: { on: true, length: 40, deflection: 30, style: "quarter", clockwise: true, bendRadius: 2, bendLength: 6 },
    end2: { on: true, length: 30, deflection: 270, style: "quarter", clockwise: false, bendRadius: 2, bendLength: 4 },
  };
  private problem: string | null = null;

  async preferences(): Promise<void> {
    const endFields = (key: "end1" | "end2", name: string): PrefField[] => {
      const e = this.ends[key];
      const style = END_STYLES.find((s) => s.style === e.style && (s.style === "plain" || s.clockwise === e.clockwise))!.value;
      return [
        { kind: "check", key: `${key}On`, label: name, value: e.on },
        { kind: "length", key: `${key}Length`, label: `${name} Length`, value: e.length },
        { kind: "number", key: `${key}Deflection`, label: `${name} Deflection`, value: e.deflection, min: 0, max: 360, unit: "°" },
        { kind: "choice", key: `${key}Style`, label: `${name} End Style`, value: style, options: END_STYLES.map((s) => ({ value: s.value, label: s.label })) },
        { kind: "length", key: `${key}Radius`, label: `${name} Bend Radius`, value: e.bendRadius },
        { kind: "length", key: `${key}BendLength`, label: `${name} Bend Length`, value: e.bendLength, zero: true },
      ];
    };
    const v = await toolPrefs(
      "Torsion Spring - End Preferences",
      [
        { kind: "length", key: "wire", label: "Wire Diameter", value: this.wire },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        ...endFields("end1", "End #1"),
        ...endFields("end2", "End #2"),
        { kind: "choice", key: "spiral", label: "Spiral", value: this.leftHand ? "left" : "right", options: SPIRALS },
        { kind: "check", key: "centre", label: "Draw Center Lines", value: this.centreLines },
      ],
      "The spring seen down its axis, centred on the click: the coils' ring, and each end a leg leaving it on a tangent, End #1's turned its deflection clockwise from straight up and End #2's anticlockwise, out to its length from the centre to the bend's outside. A bend turns a quarter, half or three-quarter turn, clockwise (CW) or anticlockwise (CCW), round its bend radius and runs on its bend length; a full loop curls right round. A left-hand spiral mirrors it. Number of Active Coils only shapes the 3D spring, which isn't drawn.",
    );
    if (!v) return;
    this.wire = v.num("wire");
    this.outside = v.num("outside");
    for (const key of ["end1", "end2"] as const) {
      const style = END_STYLES.find((s) => s.value === v.choice(`${key}Style`));
      this.ends[key] = {
        on: v.flag(`${key}On`),
        length: v.num(`${key}Length`),
        deflection: v.num(`${key}Deflection`),
        style: style?.style ?? this.ends[key].style,
        clockwise: style?.clockwise ?? this.ends[key].clockwise,
        bendRadius: v.num(`${key}Radius`),
        bendLength: v.num(`${key}BendLength`),
      };
    }
    this.leftHand = v.choice("spiral") === "left";
    this.centreLines = v.flag("centre");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    this.problem = null;
    if (scale === null) return null;
    const end = (key: "end1" | "end2"): EndLeg | null => (this.ends[key].on ? this.ends[key] : null);
    const t: TorsionEnd = { outside: this.outside, wire: this.wire, end1: end("end1"), end2: end("end2"), leftHand: this.leftHand };
    this.problem = torsionEndProblem(t);
    if (this.problem) return null;
    const d = torsionEnd(t, this.centreLines ? CENTRE_BEYOND_MM * scale : null);
    const centre = placed([{ x: 0, y: 0 }], at, angle)[0]!;
    return [
      ...d.lines.map((points): Part => ({ kind: "polyline", points: placed(points, at, angle), closed: false })),
      ...d.circles.map((c): Part => ({ shape: { kind: "arc", center: centre, radius: c.radius, startAngle: 0, sweepAngle: 360 }, attrs: { fillPattern: 1, fillFore: WHITE, fillBack: WHITE, fillOpacity: 100 } })),
      ...d.legs.flatMap((l) => legParts(l, at, angle)),
    ];
  }

  protected refusal(): string {
    return `The spring's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

const BELLEVILLE_VIEWS = [
  { id: "section", label: "Section" },
  { id: "front", label: "Front" },
] as const;
type BellevilleView = (typeof BELLEVILLE_VIEWS)[number]["id"];
const BELLEVILLE_CONFIGS = [
  { value: "up", label: "All Up" },
  { value: "down", label: "All Down" },
  { value: "alternate", label: "Alternate Down and Up" },
];
const HEIGHT_IS = [
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];

export class BellevilleSpringTool extends PlaceTool {
  readonly id = "belleville";
  readonly cursor = "crosshair";
  protected readonly label = "Belleville Spring";
  private view: BellevilleView = "section";
  private inside = 20.4;
  private outside = 40;
  private thickness = 2.25;
  private height = 3.15;
  private heightOutside = true;
  private count = 4;
  private config = "alternate";
  private downCount = 1;
  private upCount = 1;
  private firstUp = false;
  private centreLine = true;
  private problem: string | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: BELLEVILLE_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = BELLEVILLE_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–2 view`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Belleville Spring Preferences",
      [
        { kind: "length", key: "inside", label: "Inside Diameter", value: this.inside },
        { kind: "length", key: "outside", label: "Outside Diameter", value: this.outside },
        { kind: "length", key: "thickness", label: "Thickness", value: this.thickness },
        { kind: "length", key: "height", label: "Height", value: this.height },
        { kind: "choice", key: "heightIs", label: "Height Is", value: this.heightOutside ? "outside" : "inside", options: HEIGHT_IS },
        { kind: "number", key: "count", label: "Number of Springs", value: this.count, min: 1, max: MAX_DISCS, integer: true },
        { kind: "choice", key: "config", label: "Configuration", value: this.config, options: BELLEVILLE_CONFIGS },
        { kind: "number", key: "down", label: "Number Down", value: this.downCount, min: 1, max: MAX_DISCS, integer: true },
        { kind: "number", key: "up", label: "Number Up", value: this.upCount, min: 1, max: MAX_DISCS, integer: true },
        { kind: "check", key: "firstUp", label: "Draw First Spring Up", value: this.firstUp },
        { kind: "check", key: "centre", label: "Draw Center Line", value: this.centreLine },
      ],
      "Height is each spring's: Outside over the whole spring, Inside the cone's rise between its faces (the outside less the thickness). Number Down, Number Up and Draw First Spring Up are for Alternate Down and Up, which stacks groups of that many nested springs, each group facing the other way. A spring faces up with its inside edge toward the stack's far end. Configuration and View show Vectorworks' choices as pictures, so their names here, but Alternate Down and Up, are Rodeo's. The section is drawn outlined, not hatched.",
    );
    if (!v) return;
    this.inside = v.num("inside");
    this.outside = v.num("outside");
    this.thickness = v.num("thickness");
    this.height = v.num("height");
    this.heightOutside = v.choice("heightIs") === "outside";
    this.count = v.num("count");
    this.config = v.choice("config");
    this.downCount = v.num("down");
    this.upCount = v.num("up");
    this.firstUp = v.flag("firstUp");
    this.centreLine = v.flag("centre");
  }

  private spring(): Belleville {
    const alternate = this.config === "alternate";
    return {
      inside: this.inside,
      outside: this.outside,
      thickness: this.thickness,
      rise: this.heightOutside ? this.height - this.thickness : this.height,
      count: this.count,
      stack: alternate ? "alternate" : "nested",
      down: this.downCount,
      up: this.upCount,
      firstUp: alternate ? this.firstUp : this.config === "up",
    };
  }

  solid(): Solid | null {
    const b = this.spring();
    this.problem = bellevilleProblem(b);
    return this.problem ? null : onLayer(turnedSection(bellevilleSide(b, null).solid));
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const b = this.spring();
    this.problem = bellevilleProblem(b);
    if (this.problem) return null;
    const beyond = this.centreLine ? CENTRE_BEYOND_MM * scale : null;
    return springParts(this.view === "section" ? bellevilleSide(b, beyond) : bellevilleFront(b, beyond), at, angle);
  }

  protected refusal(): string {
    return `The spring's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** a hidden line's dashes and the gaps between them on paper, mm, in a drawing with no dashed line type */
const HIDDEN_DASH_MM = 3;
const HIDDEN_GAP_MM = 1.5;

/** Hidden lines at `at`, turned by `angle`: in the drawing's first dashed line type, or cut into dashes `scale` sizes up when it has none. */
export function hiddenParts(lines: readonly Pt[][], scale: number, at: Pt, angle: number): Part[] {
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  if (dashed) return lines.map((points): Part => ({ shape: { kind: "polyline", points: placed(points, at, angle), closed: false }, attrs: { lineStyle: dashed.style } }));
  const dash = HIDDEN_DASH_MM * scale;
  const period = dash + HIDDEN_GAP_MM * scale;
  const out: Part[] = [];
  for (const line of lines) {
    let along = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const len = dist(a, b);
      const at2 = (t: number): Pt => ({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      // dashes start every period along the whole line
      for (let t = -(along % period); t < len; t += period) {
        const from = Math.max(0, t);
        const to = Math.min(len, t + dash);
        if (to - from > 1e-9) out.push({ kind: "polyline", points: placed([at2(from), at2(to)], at, angle), closed: false });
      }
      along += len;
    }
  }
  return out;
}

const UNIT_VIEWS: readonly { readonly id: UnitView; readonly label: string }[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];
const SCREW_CHOICES = SET_SCREWS.map((s) => ({ value: s.value, label: s.value }));
const screwDiameter = (name: string): number => SET_SCREWS.find((s) => s.value === name)?.diameter ?? 6;
const UNIT_NOTE =
  "Sizes are FYH's mounted units with UC2 inserts (catalogue 3330), UC204 to UC215; with Use Custom Dimensions off they come from the size, on they're as typed. The views are on keys; Show Set Screws draws the screw facing you in the collar, Show Center Lines and Hidden Lines dashes the bore and the bolt holes.";

/** a mounted unit's drawing with only its body */
const BARE: UnitShow = { screws: false, fitting: false, beyond: null };

/** What the mounted bearing units share: their views, the set screw, the grease fitting, centre and hidden lines. */
abstract class MountedBearingTool extends PlaceTool {
  readonly cursor = "crosshair";
  private view: UnitView = "front";
  protected custom = false;
  protected screw = "M6×0.75";
  private screws = true;
  private fitting = true;
  private centreLines = true;
  protected problem: string | null = null;
  protected abstract readonly views: readonly UnitView[];

  /** the unit in `view`, or null with the reason kept in `problem` */
  protected abstract drawing(view: UnitView, show: UnitShow): UnitDrawing | null;

  modes(): readonly ToolModes[] {
    const views = UNIT_VIEWS.filter((m) => this.views.includes(m.id));
    return [{ label: "View", options: views.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = UNIT_VIEWS.find((m) => m.id === id && this.views.includes(m.id));
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–${this.views.length} view`;
  }

  /** Set Screw Size and the Show checks, after a tool's sizes. */
  protected showFields(): PrefField[] {
    return [
      { kind: "choice", key: "screw", label: "Set Screw Size", value: this.screw, options: SCREW_CHOICES },
      { kind: "check", key: "screws", label: "Show Set Screws", value: this.screws },
      { kind: "check", key: "fitting", label: "Show Grease Fitting", value: this.fitting },
      { kind: "check", key: "centre", label: "Show Center Lines and Hidden Lines", value: this.centreLines },
    ];
  }

  /** the Show checks, and the set screw when the sizes are custom (a size brings its own) */
  protected readShow(v: PrefValues): void {
    if (this.custom) this.screw = v.choice("screw");
    this.screws = v.flag("screws");
    this.fitting = v.flag("fitting");
    this.centreLines = v.flag("centre");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    this.problem = null;
    const d = this.drawing(this.view, { screws: this.screws, fitting: this.fitting, beyond: this.centreLines ? CENTRE_BEYOND_MM * scale : null });
    return d ? [...drawingParts(d, at, angle), ...hiddenParts(d.hidden, scale, at, angle)] : null;
  }

  protected refusal(): string {
    return `The bearing's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** A UC size's choice label: the unit's number and its bore. */
const unitSizes = (prefix: string, ids: readonly string[]) => ids.map((id) => ({ value: id, label: `${prefix}${id} (${UC_INSERTS[id].d} mm bore)` }));

/** a pillow block of UCP2 size `id`, its housing's width and round top estimated */
function pillowSize(id: string): { block: PillowBlock; screw: string } {
  const [, H, L, A, J, N, N1, H1, H2] = UCP.find((r) => r[0] === id) ?? UCP[2];
  const ins = UC_INSERTS[id] ?? UC_INSERTS["206"];
  return {
    block: {
      bore: ins.d,
      centre: H,
      housingWidth: Math.round(6 * A) / 10,
      top: H2 - H,
      baseLength: L,
      baseWidth: A,
      baseThickness: H1,
      holeCentres: J,
      slotWidth: N,
      slotLength: N1,
      collarWidth: ins.B,
      collarDiameter: collarFor(ins),
      screw: screwDiameter(ins.screw),
    },
    screw: ins.screw,
  };
}

export class PillowBlockTool extends MountedBearingTool {
  readonly id = "pillowblock";
  protected readonly label = "Pillow Block";
  protected readonly views: readonly UnitView[] = ["front", "side", "top"];
  private size = "206";
  private block = pillowSize("206").block;

  constructor(env: ToolEnv) {
    super(env);
    this.screw = pillowSize(this.size).screw;
  }

  async preferences(): Promise<void> {
    const b = this.block;
    const v = await toolPrefs(
      "Pillow Block Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: this.size, options: unitSizes("UCP", UCP.map((r) => r[0])) },
        { kind: "check", key: "custom", label: "Use Custom Dimensions", value: this.custom },
        { kind: "length", key: "bore", label: "Bore Size", value: b.bore },
        { kind: "length", key: "centreDistance", label: "Center Distance", value: b.centre },
        { kind: "length", key: "housingWidth", label: "Housing Width", value: b.housingWidth },
        { kind: "length", key: "baseLength", label: "Base Length", value: b.baseLength },
        { kind: "length", key: "baseThickness", label: "Base Thickness", value: b.baseThickness },
        { kind: "length", key: "holeCentres", label: "Hole Centers", value: b.holeCentres },
        { kind: "length", key: "slotWidth", label: "Slot Width", value: b.slotWidth },
        { kind: "length", key: "slotLength", label: "Slot Length", value: b.slotLength },
        { kind: "length", key: "baseWidth", label: "Base Width", value: b.baseWidth },
        { kind: "length", key: "collarWidth", label: "Collar Width", value: b.collarWidth },
        { kind: "length", key: "collarDiameter", label: "Collar Diameter", value: b.collarDiameter },
        ...this.showFields(),
      ],
      `${UNIT_NOTE} Center Distance runs from the bore's centre to the base's underside; Collar Width is the insert's inner ring, which starts at the housing's face and stands out on the set-screw side. Housing Width (six tenths of the base's width), Collar Diameter (three tenths of the way from the bore to the bearing's outside) and the housing's round top (as FYH's overall height has it, in proportion to the center distance) are Rodeo's estimates. Front, Side and Top on keys 1 to 3.`,
    );
    if (!v) return;
    const size = v.choice("size");
    this.custom = v.flag("custom");
    const table = pillowSize(size);
    if (this.custom) {
      const centre = v.num("centreDistance");
      this.block = {
        bore: v.num("bore"),
        centre,
        housingWidth: v.num("housingWidth"),
        top: (table.block.top / table.block.centre) * centre,
        baseLength: v.num("baseLength"),
        baseWidth: v.num("baseWidth"),
        baseThickness: v.num("baseThickness"),
        holeCentres: v.num("holeCentres"),
        slotWidth: v.num("slotWidth"),
        slotLength: v.num("slotLength"),
        collarWidth: v.num("collarWidth"),
        collarDiameter: v.num("collarDiameter"),
        screw: 0,
      };
    } else {
      this.block = table.block;
      this.screw = table.screw;
    }
    this.size = size;
    this.readShow(v);
  }

  /** On the layer: the base from above with its slots, the housing from the front along the shaft's axis (which runs across the base), the collar turned on that axis. */
  solid(): Solid | null {
    const [front, side, top] = [this.drawing("front", BARE), this.drawing("side", BARE), this.drawing("top", BARE)];
    if (!front || !side || !top) return null;
    const [base, housing] = front.outlines;
    const low = Math.min(...base.map((p) => p.y));
    const high = Math.max(...base.map((p) => p.y));
    const bore = Math.min(...front.circles.map((c) => c.radius));
    const half = Math.max(...side.outlines[1].map((p) => p.x));
    const collar = side.outlines[2];
    const reach = Math.max(...collar.map((p) => p.x));
    const hub = Math.max(...collar.map((p) => p.y));
    const body = onEdge([
      ...prism([housing, circleOutline({ x: 0, y: 0 }, bore)], -half, half),
      ...lathe([
        { x: bore, y: -half },
        { x: hub, y: -half },
        { x: hub, y: -reach },
        { x: bore, y: -reach },
      ]),
    ]);
    return [...prism([top.outlines[0], ...top.outlines.filter((o) => o.length > 4)], 0, high - low), ...mapSolid(body, ([x, y, z]) => [x, y, z - low])];
  }

  protected drawing(view: UnitView, show: UnitShow): UnitDrawing | null {
    const b = { ...this.block, screw: screwDiameter(this.screw) };
    this.problem = pillowBlockProblem(b);
    return this.problem ? null : pillowBlock(b, view, show);
  }
}

/** a flanged unit of UCF2 (4 holes) or UCFL2 (2 holes) size `id`, its collar and housing boss estimated */
function flangedSize(holes: 2 | 4, id: string): { unit: FlangedBearing; screw: string } {
  const ins = UC_INSERTS[id] ?? UC_INSERTS["206"];
  const [length, width, A, J, N, A1, A0] =
    holes === 4
      ? (([, L, A, J, N, A1, A0]) => [L, L, A, J, N, A1, A0])(UCF.find((r) => r[0] === id) ?? UCF[2])
      : (([, H, L, A, J, N, A1, A0]) => [H, L, A, J, N, A1, A0])(UCFL.find((r) => r[0] === id) ?? UCFL[2]);
  return {
    unit: {
      holes,
      bore: ins.d,
      collarDiameter: collarFor(ins),
      housingDiameter: Math.round(12.5 * ins.D) / 10,
      baseLength: length,
      baseWidth: width,
      holeCentres: J,
      holeSize: N,
      baseThickness: A1,
      housingThickness: A,
      overall: A0,
      screw: screwDiameter(ins.screw),
    },
    screw: ins.screw,
  };
}

abstract class FlangedBearingTool extends MountedBearingTool {
  protected readonly views: readonly UnitView[] = ["front", "side"];
  protected abstract readonly holes: 2 | 4;
  private size = "206";
  private unit: FlangedBearing | null = null;

  /** the flange's size fields, in Vectorworks' order for the tool */
  protected abstract flangeFields(f: FlangedBearing): PrefField[];

  private current(): FlangedBearing {
    if (!this.unit) {
      const t = flangedSize(this.holes, this.size);
      this.unit = t.unit;
      this.screw = t.screw;
    }
    return this.unit;
  }

  async preferences(): Promise<void> {
    const f = this.current();
    const prefix = this.holes === 4 ? "UCF" : "UCFL";
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "size", label: "Nominal Size", value: this.size, options: unitSizes(prefix, (this.holes === 4 ? UCF : UCFL).map((r) => r[0])) },
        { kind: "check", key: "custom", label: "Use Custom Dimensions", value: this.custom },
        { kind: "length", key: "bore", label: "Bore Size", value: f.bore },
        { kind: "length", key: "collarDiameter", label: "Collar Diameter", value: f.collarDiameter },
        { kind: "length", key: "housingDiameter", label: "Housing Diameter", value: f.housingDiameter },
        ...this.flangeFields(f),
        { kind: "length", key: "holeSize", label: "Hole Size", value: f.holeSize },
        { kind: "length", key: "baseThickness", label: "Base Thickness", value: f.baseThickness },
        { kind: "length", key: "housingThickness", label: "Housing Thickness", value: f.housingThickness },
        { kind: "length", key: "overall", label: "Overall Thickness", value: f.overall },
        ...this.showFields(),
      ],
      `${UNIT_NOTE} The thicknesses run from the mounting face: the base (the flange), the housing to its front, and Overall to the collar's end. Collar Diameter (three tenths of the way from the bore to the bearing's outside) and Housing Diameter (the round boss, 1.25 times the bearing's outside) are Rodeo's estimates. Front and Side on keys 1 and 2; the side view's mounting face is on the click.`,
    );
    if (!v) return;
    const size = v.choice("size");
    this.custom = v.flag("custom");
    if (this.custom) {
      const side = this.holes === 4 ? v.num("baseSize") : v.num("baseLength");
      this.unit = {
        holes: this.holes,
        bore: v.num("bore"),
        collarDiameter: v.num("collarDiameter"),
        housingDiameter: v.num("housingDiameter"),
        baseLength: side,
        baseWidth: this.holes === 4 ? side : v.num("baseWidth"),
        holeCentres: v.num("holeCentres"),
        holeSize: v.num("holeSize"),
        baseThickness: v.num("baseThickness"),
        housingThickness: v.num("housingThickness"),
        overall: v.num("overall"),
        screw: 0,
      };
    } else {
      const t = flangedSize(this.holes, size);
      this.unit = t.unit;
      this.screw = t.screw;
    }
    this.size = size;
    this.readShow(v);
  }

  /** On the layer, flange down: the flange from the front with its bolt holes, and the housing and collar turned on it. */
  solid(): Solid | null {
    const [front, side] = [this.drawing("front", BARE), this.drawing("side", BARE)];
    if (!front || !side) return null;
    const bore = Math.min(...front.circles.map((c) => c.radius));
    const bolts = front.circles.filter((c) => c.center.x !== 0 || c.center.y !== 0).map((c) => circleOutline(c.center, c.radius, 24));
    const [flange, ...rest] = side.outlines;
    const thick = Math.max(...flange.map((p) => p.x));
    const start = Math.min(...flange.map((p) => p.x));
    return onLayer([...prism([front.outlines[0], ...bolts, circleOutline({ x: 0, y: 0 }, bore)], start, thick), ...rest.flatMap((o) => lathe(bored(sectionProfile(o), bore)))]);
  }

  protected drawing(view: UnitView, show: UnitShow): UnitDrawing | null {
    const f = { ...this.current(), screw: screwDiameter(this.screw) };
    this.problem = flangedProblem(f);
    return this.problem ? null : flangedBearing(f, view, show);
  }
}

export class FlangedBearing4Tool extends FlangedBearingTool {
  readonly id = "flanged4";
  protected readonly label = "Flanged Bearing - 4 Hole";
  protected readonly holes = 4;

  protected flangeFields(f: FlangedBearing): PrefField[] {
    return [
      { kind: "length", key: "baseSize", label: "Base Size (Sq.)", value: f.baseLength },
      { kind: "length", key: "holeCentres", label: "Hole Centers (Sq.)", value: f.holeCentres },
    ];
  }
}

export class FlangedBearing2Tool extends FlangedBearingTool {
  readonly id = "flanged2";
  protected readonly label = "Flanged Bearing - 2 Hole";
  protected readonly holes = 2;

  protected flangeFields(f: FlangedBearing): PrefField[] {
    return [
      { kind: "length", key: "baseWidth", label: "Base Width", value: f.baseWidth },
      { kind: "length", key: "baseLength", label: "Base Length", value: f.baseLength },
      { kind: "length", key: "holeCentres", label: "Hole Centers", value: f.holeCentres },
    ];
  }
}

const LINK_VIEWS = [
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
] as const;

export class OffsetLinkTool extends PlaceTool {
  readonly id = "offsetlink";
  readonly cursor = "crosshair";
  protected readonly label = "Roller Chain - Offset Link";
  private view: (typeof LINK_VIEWS)[number]["id"] = "side";
  private chain = chainOf("ansi40");
  private centreLines = true;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: LINK_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = LINK_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · the roller end on the click, the pin end a pitch right · 1–2 view`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Roller Chain - Offset Link Preferences",
      [
        { kind: "choice", key: "chain", label: "Standard Chain No. (Pitch)", value: this.chain.id, options: CHAIN_OPTIONS },
        { kind: "check", key: "centre", label: "Draw Center Lines", value: this.centreLines },
      ],
      "One offset link, which joins a roller link to a pin link: from the side (key 1) its plate, the bushing's end and the pin with its cotter; from above (key 2) its plates cranked from inside to outside width, the roller and the pin. Show Pins is 3D only in Vectorworks; the views and Draw Center Lines are Rodeo's, and the plates' thickness is a quarter of the room between strands past the inner width.",
    );
    if (!v) return;
    this.chain = chainOf(v.choice("chain"));
    this.centreLines = v.flag("centre");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const beyond = this.centreLines ? CENTRE_BEYOND_MM * scale : null;
    return drawingParts(this.view === "side" ? offsetLinkSide(this.chain, beyond) : offsetLinkTop(this.chain, beyond), at, angle);
  }

  solid(): Solid {
    return offsetLinkSolid(this.chain, offsetLinkTop(this.chain, null).outlines);
  }
}

const BEVEL_VIEWS = [
  { id: "side", label: "Side (Section)" },
  { id: "front", label: "Front" },
] as const;
type BevelConfig = "both" | "gear" | "pinion" | "miter";
const BEVEL_CONFIGS: readonly { readonly value: BevelConfig; readonly label: string }[] = [
  { value: "both", label: "Gear and Pinion" },
  { value: "gear", label: "Gear Only" },
  { value: "pinion", label: "Pinion Only" },
  { value: "miter", label: "Miter Gears (Pinion as Gear)" },
];
const KEY_TYPES = [
  { value: "none", label: "None" },
  { value: "square", label: "Square (ASME)" },
  { value: "rectangular", label: "Rectangular (ASME)" },
  { value: "custom", label: "Custom" },
];

/** A bevel gear's or pinion's Preferences, besides its teeth. */
class BevelMemberPrefs {
  keyType: GearKey = "square";

  constructor(
    public teeth: number,
    public mounting: number,
    public hubDiameter: number,
    public hubProjection: number,
    public bore: number,
    public keyWidth: number,
    public keyHeight: number,
    public recess: number,
    public fillet: number,
  ) {}

  fields(prefix: string, name: string): PrefField[] {
    return [
      { kind: "number", key: `${prefix}Teeth`, label: `${name}: No. of Teeth`, value: this.teeth, min: MIN_BEVEL_TEETH, max: MAX_BEVEL_TEETH, integer: true },
      { kind: "length", key: `${prefix}Mounting`, label: `${name}: Mounting Distance`, value: this.mounting },
      { kind: "length", key: `${prefix}Hub`, label: `${name}: Hub Diameter`, value: this.hubDiameter },
      { kind: "length", key: `${prefix}Projection`, label: `${name}: Hub Projection`, value: this.hubProjection, zero: true },
      { kind: "length", key: `${prefix}Bore`, label: `${name}: Bore Diameter`, value: this.bore },
      { kind: "choice", key: `${prefix}Key`, label: `${name}: Key Type`, value: this.keyType, options: KEY_TYPES },
      { kind: "length", key: `${prefix}KeyWidth`, label: `${name}: Kwy Width`, value: this.keyWidth },
      { kind: "length", key: `${prefix}KeyHeight`, label: `${name}: Kwy Height`, value: this.keyHeight },
      { kind: "length", key: `${prefix}Recess`, label: `${name}: Recess`, value: this.recess, zero: true },
      { kind: "length", key: `${prefix}Fillet`, label: `${name}: Fillet Radius`, value: this.fillet, zero: true },
    ];
  }

  read(v: PrefValues, prefix: string): void {
    this.teeth = v.num(`${prefix}Teeth`);
    this.mounting = v.num(`${prefix}Mounting`);
    this.hubDiameter = v.num(`${prefix}Hub`);
    this.hubProjection = v.num(`${prefix}Projection`);
    this.bore = v.num(`${prefix}Bore`);
    const key = v.choice(`${prefix}Key`);
    this.keyType = key === "square" || key === "rectangular" || key === "custom" ? key : "none";
    this.keyWidth = v.num(`${prefix}KeyWidth`);
    this.keyHeight = v.num(`${prefix}KeyHeight`);
    this.recess = v.num(`${prefix}Recess`);
    this.fillet = v.num(`${prefix}Fillet`);
  }

  /** the member these describe, or why not when ASME has no key for its bore */
  member(): BevelMember | string {
    let key: BevelMember["key"] = null;
    if (this.keyType === "custom") key = { width: this.keyWidth, depth: this.keyHeight };
    else if (this.keyType !== "none") {
      const standard = standardKey(this.bore, "inch", this.keyType);
      if (!standard) return "ASME B17.1 has no key for a bore that size: choose a custom keyway";
      key = { width: standard.width, depth: standard.hub };
    }
    return { teeth: this.teeth, mounting: this.mounting, hubDiameter: this.hubDiameter, hubProjection: this.hubProjection, bore: this.bore, key, recess: this.recess, fillet: this.fillet };
  }
}

export class BevelGearTool extends PlaceTool {
  readonly id = "bevelgear";
  readonly cursor = "crosshair";
  protected readonly label = "Bevel Gears";
  private view: (typeof BEVEL_VIEWS)[number]["id"] = "side";
  private method: "module" | "pitch" = "module";
  private diametralPitch = 8;
  private module = 3;
  private shaftAngle = 90;
  private faceWidth = 15;
  private config: BevelConfig = "both";
  private readonly gear = new BevelMemberPrefs(30, 40, 40, 10, 20, 5, 2.5, 0, 2);
  private readonly pinion = new BevelMemberPrefs(15, 58, 24, 8, 12, 3, 1.5, 0, 1);
  private pinionLeft = false;
  private centreLines = true;
  private problem: string | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: BEVEL_VIEWS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = BEVEL_VIEWS.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · ${this.view === "side" ? "the pitch apex" : "the axis"} on the click · 1–2 view`;
  }

  /** the pair these describe, or why not */
  private pair(): BevelPair | string {
    const gear = this.gear.member();
    if (typeof gear === "string") return `the gear's: ${gear}`;
    const pinion = this.config === "miter" ? gear : this.pinion.member();
    if (typeof pinion === "string") return `the pinion's: ${pinion}`;
    const module = this.method === "module" ? this.module : 25.4 / this.diametralPitch;
    return { module, shaftAngle: (this.shaftAngle * Math.PI) / 180, faceWidth: this.faceWidth, gear, pinion };
  }

  async preferences(): Promise<void> {
    const p = this.pair();
    const cones = typeof p === "string" || bevelProblem(p, []) ? null : bevelCones(p);
    const v = await toolPrefs(
      "Bevel Gears Preferences",
      [
        {
          kind: "choice",
          key: "method",
          label: "Value to Use",
          value: this.method,
          options: [
            { value: "pitch", label: "Diametral Pitch" },
            { value: "module", label: "Module" },
          ],
        },
        { kind: "number", key: "pitch", label: "Diametral Pitch", value: this.diametralPitch, min: 0.1, max: 200 },
        { kind: "number", key: "module", label: "Module (mm)", value: this.module, min: 0.05, max: 200 },
        { kind: "number", key: "shaft", label: "Shaft Angle (deg.)", value: this.shaftAngle, min: 1, max: 179, unit: "°" },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        { kind: "choice", key: "config", label: "Configuration", value: this.config, options: BEVEL_CONFIGS },
        ...this.gear.fields("gear", "Gear"),
        ...this.pinion.fields("pinion", "Pinion"),
        { kind: "check", key: "left", label: "Show Pinion at Left", value: this.pinionLeft },
        { kind: "check", key: "centre", label: "Draw Center Lines", value: this.centreLines },
      ],
      `${cones ? `Now: Pitch Dia. (Ref.) ${ref(cones.gear.d)} mm for the gear and ${ref(cones.pinion.d)} mm for the pinion, cone distance ${ref(cones.R)} mm. ` : ""}Straight teeth of full depth (addendum a module, dedendum 1.25), tapering to the pitch apex; the side view cuts both through their axes, the front view shows the gear (the pinion when it's alone) from the apex. Mounting Distance runs from the back of the hub to the pitch apex; a diametral pitch is teeth per inch of pitch diameter. Square and rectangular keyways take the ASME B17.1 size for the bore; a custom one's Kwy Height is its depth into the hub. Configuration's names are Rodeo's; Miter Gears gives the pinion the gear's values. Show Teeth and Spiral Angle are 3D only in Vectorworks.`,
    );
    if (!v) return;
    this.method = v.choice("method") === "pitch" ? "pitch" : "module";
    this.diametralPitch = v.num("pitch");
    this.module = v.num("module");
    this.shaftAngle = v.num("shaft");
    this.faceWidth = v.num("face");
    this.config = BEVEL_CONFIGS.find((c) => c.value === v.choice("config"))?.value ?? "both";
    this.gear.read(v, "gear");
    this.pinion.read(v, "pinion");
    this.pinionLeft = v.flag("left");
    this.centreLines = v.flag("centre");
  }

  /** The pair laid on their side as the side view cuts them, its plane level, each turned about its axis. */
  solid(): Solid | null {
    const p = this.pair();
    if (typeof p === "string") {
      this.problem = p;
      return null;
    }
    const which: BevelWhich[] = this.config === "gear" ? ["gear"] : this.config === "pinion" ? ["pinion"] : ["gear", "pinion"];
    this.problem = bevelProblem(p, which);
    return this.problem ? null : bevelSolid(bevelTurnings(p, which, this.pinionLeft));
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const p = this.pair();
    if (typeof p === "string") {
      this.problem = p;
      return null;
    }
    const front: BevelWhich = this.config === "pinion" ? "pinion" : "gear";
    const which: BevelWhich[] = this.view === "front" ? [front] : this.config === "gear" ? ["gear"] : this.config === "pinion" ? ["pinion"] : ["gear", "pinion"];
    this.problem = bevelProblem(p, which);
    if (this.problem) return null;
    const beyond = this.centreLines ? CENTRE_BEYOND_MM * scale : null;
    return drawingParts(this.view === "front" ? bevelFront(p, front, beyond) : bevelSide(p, which, this.pinionLeft, beyond), at, angle);
  }

  protected refusal(): string {
    return `The bevel gears' Preferences don't make them: ${this.problem ?? "check their sizes"}.`;
  }
}

const WORM_VIEWS: readonly { readonly id: WormView; readonly label: string }[] = [
  { id: "front", label: "Front" },
  { id: "right", label: "Right Side" },
  { id: "left", label: "Left Side" },
  { id: "sideSection", label: "Side - Section" },
  { id: "frontSection", label: "Front - Section" },
];
const WORM_GEAR_VIEWS: readonly { readonly id: WormGearView; readonly label: string }[] = [
  { id: "front", label: "Front" },
  { id: "sideSection", label: "Side - Section" },
  { id: "sideSolid", label: "Side - Solid" },
  { id: "sideHidden", label: "Side - Solid with Hidden Lines" },
  { id: "back", label: "Back" },
];
const WORM_PROFILES: readonly { readonly id: WormProfile; readonly label: string }[] = [
  { id: "detailed", label: "Detailed" },
  { id: "schematic", label: "Schematic" },
];
const WORM_PRESSURE_ANGLES = [...PRESSURE_ANGLES, { value: "30", label: "30°" }];
const WORM_STARTS = ["Single", "Double", "Triple", "Quad"].slice(0, MAX_STARTS).map((label, i) => ({ value: String(i + 1), label }));
const WORM_NOTE = "Worm and Worm Gear mesh when the gear's Circular Pitch is the worm's Axial Pitch and their Number of Starts, Pressure Angle and the worm's Pitch Diameter agree.";

/** The views and tooth profiles a worm or worm gear is drawn in, on keys 1 to 5 and 6 to 7. */
abstract class WormToolBase<View extends string> extends PlaceTool {
  readonly cursor = "crosshair";
  protected abstract view: View;
  protected profile: WormProfile = "detailed";
  protected abstract readonly views: readonly { readonly id: View; readonly label: string }[];

  modes(): readonly ToolModes[] {
    return [
      { label: "View", options: this.views.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view },
      { label: "Tooth Profile", options: WORM_PROFILES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 6) })), active: this.profile },
    ];
  }

  setMode(id: string): void {
    const view = this.views.find((m) => m.id === id);
    if (view) this.view = view.id;
    const profile = WORM_PROFILES.find((m) => m.id === id);
    if (profile) this.profile = profile.id;
  }

  hint(): string {
    return `${super.hint()} · 1–5 view · 6–7 tooth profile`;
  }
}

export class WormTool extends WormToolBase<WormView> {
  readonly id = "worm";
  protected readonly label = "Worm";
  protected view: WormView = "front";
  protected readonly views = WORM_VIEWS;
  private pitchDiameter = 40;
  private axialPitch = 10;
  private pressureAngle = 20;
  private starts = 1;
  private faceWidth = 60;
  private drawHub = true;
  private hubDiameter = 25;
  private hubLeft = 0;
  private hubRight = 15;
  private drawBore = true;
  private boreDiameter = 16;
  private keyway: GearKey = "square";
  private keyWidth = 5;
  private keyHeight = 2.5;
  private centreLines = true;
  private problem: string | null = null;

  async preferences(): Promise<void> {
    const sizes = wormSizes({ pitchDiameter: this.pitchDiameter, axialPitch: this.axialPitch, starts: this.starts });
    const v = await toolPrefs(
      "Worm Preferences",
      [
        { kind: "length", key: "pitch", label: "Pitch Diameter", value: this.pitchDiameter },
        { kind: "length", key: "axial", label: "Axial Pitch", value: this.axialPitch },
        { kind: "choice", key: "pressure", label: "Pressure Angle (deg.)", value: String(this.pressureAngle), options: WORM_PRESSURE_ANGLES },
        { kind: "choice", key: "starts", label: "Number of Starts", value: String(this.starts), options: WORM_STARTS },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        { kind: "check", key: "hub", label: "Draw Hub(s)", value: this.drawHub },
        { kind: "length", key: "hubDiameter", label: "Hub Diameter", value: this.hubDiameter },
        { kind: "length", key: "hubLeft", label: "Hub Projection (Left)", value: this.hubLeft, signed: true },
        { kind: "length", key: "hubRight", label: "Hub Projection (Right)", value: this.hubRight, signed: true },
        { kind: "check", key: "bore", label: "Draw Bore", value: this.drawBore },
        { kind: "length", key: "boreDiameter", label: "Bore Diameter", value: this.boreDiameter },
        { kind: "choice", key: "key", label: "Keyway", value: this.keyway, options: KEY_TYPES },
        { kind: "length", key: "keyWidth", label: "Keyway Width", value: this.keyWidth },
        { kind: "length", key: "keyHeight", label: "Keyway Height", value: this.keyHeight },
        { kind: "check", key: "centre", label: "Show Center Lines", value: this.centreLines },
      ],
      `Now: module ${ref(sizes.module)} mm, lead ${ref(sizes.lead)} mm, outside diameter ${ref(sizes.outside)} mm, root diameter ${ref(sizes.root)} mm, lead angle ${ref((sizes.leadAngle * 180) / Math.PI)}°. The threads are right hand, a trapezoid in the axial section (addendum a module, dedendum 1.25); Side - Section cuts across the threads, showing the outside and root circles. A negative Hub Projection sets the hub into the face. Square and rectangular keyways take the ASME B17.1 size for the bore; Keyway Height is a custom keyway's depth. ${WORM_NOTE}`,
    );
    if (!v) return;
    this.pitchDiameter = v.num("pitch");
    this.axialPitch = v.num("axial");
    this.pressureAngle = Number(v.choice("pressure")) || 20;
    this.starts = Number(v.choice("starts")) || 1;
    this.faceWidth = v.num("face");
    this.drawHub = v.flag("hub");
    this.hubDiameter = v.num("hubDiameter");
    this.hubLeft = v.num("hubLeft");
    this.hubRight = v.num("hubRight");
    this.drawBore = v.flag("bore");
    this.boreDiameter = v.num("boreDiameter");
    const key = v.choice("key");
    this.keyway = key === "square" || key === "rectangular" || key === "custom" ? key : "none";
    this.keyWidth = v.num("keyWidth");
    this.keyHeight = v.num("keyHeight");
    this.centreLines = v.flag("centre");
  }

  /** The worm Preferences describe, or null (with the reason kept for the refusal) when they don't make one. */
  private worm(): Worm | null {
    let key: { width: number; depth: number } | null = null;
    if (this.drawBore && this.keyway !== "none") {
      const standard = this.keyway === "custom" ? null : standardKey(this.boreDiameter, "inch", this.keyway);
      if (this.keyway !== "custom" && !standard) {
        this.problem = "ASME B17.1 has no key for a bore that size: choose a custom keyway";
        return null;
      }
      key = standard ? { width: standard.width, depth: standard.hub } : { width: this.keyWidth, depth: this.keyHeight };
    }
    const w: Worm = {
      pitchDiameter: this.pitchDiameter,
      axialPitch: this.axialPitch,
      pressureAngle: this.pressureAngle,
      starts: this.starts,
      faceWidth: this.faceWidth,
      profile: this.profile,
      hub: this.drawHub ? { diameter: this.hubDiameter, left: this.hubLeft, right: this.hubRight } : null,
      bore: this.drawBore ? { diameter: this.boreDiameter, key } : null,
    };
    this.problem = wormProblem(w);
    return this.problem ? null : w;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const w = this.worm();
    if (!w || scale === null) return null;
    return drawingParts(wormDrawing(w, this.view, this.centreLines ? CENTRE_BEYOND_MM * scale : null), at, angle);
  }

  solid(): Solid | null {
    const w = this.worm();
    return w && wormSolid(w);
  }

  protected refusal(): string {
    return `The worm's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

export class WormGearTool extends WormToolBase<WormGearView> {
  readonly id = "wormgear";
  protected readonly label = "Worm Gear";
  protected view: WormGearView = "front";
  protected readonly views = WORM_GEAR_VIEWS;
  private circularPitch = 10;
  private teeth = 30;
  private pressureAngle = 20;
  private starts = 1;
  private wormPitchDiameter = 40;
  private faceWidth = 20;
  private readonly parts = new WheelPrefs(70, true, true);
  private problem: string | null = null;

  async preferences(): Promise<void> {
    const g = this.gear();
    const sizes = g ? wormGearSizes(g) : null;
    const v = await toolPrefs(
      "Worm Gear Preferences",
      [
        { kind: "length", key: "circular", label: "Circular Pitch", value: this.circularPitch },
        { kind: "number", key: "teeth", label: "Number of Teeth", value: this.teeth, min: MIN_GEAR_TEETH, max: MAX_GEAR_TEETH, integer: true },
        { kind: "choice", key: "pressure", label: "Pressure Angle (deg.)", value: String(this.pressureAngle), options: WORM_PRESSURE_ANGLES },
        { kind: "choice", key: "starts", label: "Number of Starts (Worm)", value: String(this.starts), options: WORM_STARTS },
        { kind: "length", key: "wormPitch", label: "Pitch Dia (Worm)", value: this.wormPitchDiameter },
        { kind: "length", key: "face", label: "Face Width", value: this.faceWidth },
        ...this.parts.fields("Show Center Lines"),
      ],
      `${sizes ? `Now: Pitch Diameter (Ref.) ${ref(sizes.pitchDiameter)} mm, module ${ref(sizes.module)} mm, throat diameter ${ref(sizes.throat)} mm, outside diameter ${ref(sizes.outside)} mm, ${ref(sizes.centreDistance)} mm from the worm's axis. ` : ""}Involute teeth (addendum a module, dedendum 1.25); the front and back show them at the throat, the side views hollow the rim to an arc about the worm's axis. A negative Hub Projection sets the hub into the face. ${KEYWAY_NOTE} ${WORM_NOTE}`,
    );
    if (!v) return;
    this.circularPitch = v.num("circular");
    this.teeth = v.num("teeth");
    this.pressureAngle = Number(v.choice("pressure")) || 20;
    this.starts = Number(v.choice("starts")) || 1;
    this.wormPitchDiameter = v.num("wormPitch");
    this.faceWidth = v.num("face");
    this.parts.read(v);
  }

  /** The gear Preferences describe, or null (with the reason kept for the refusal) when they don't make one. */
  private gear(): WormGear | null {
    const root = (this.circularPitch / Math.PI) * (this.teeth - 2.5);
    const wheel = this.parts.wheel(this.faceWidth, root);
    if (typeof wheel === "string") {
      this.problem = wheel;
      return null;
    }
    const p = this.parts;
    const g: WormGear = {
      ...wheel,
      circularPitch: this.circularPitch,
      teeth: this.teeth,
      pressureAngle: this.pressureAngle,
      starts: this.starts,
      wormPitchDiameter: this.wormPitchDiameter,
      profile: this.profile,
      radii: { recessCorner: p.recessCorner, recessFillet: p.recessFillet, hubCorner: p.hubCorner, hubFillet: p.hubFillet },
      spokes: p.spokes(),
    };
    this.problem = wormGearProblem(g);
    return this.problem ? null : g;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const g = this.gear();
    if (!g || scale === null) return null;
    const d = wormGearDrawing(g, this.view, this.parts.centreLines ? CENTRE_BEYOND_MM * scale : null);
    return [...drawingParts(d, at, angle), ...hiddenParts(d.hidden, scale, at, angle)];
  }

  solid(): Solid | null {
    const g = this.gear();
    return g && onLayer(toothedSolid(wormGearDrawing(g, "front", null).outlines[0], wormGearDrawing(g, "sideSection", null).outlines));
  }

  protected refusal(): string {
    return `The worm gear's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

/** ISO and Unified threads' basic flats: an eighth of the pitch at the crest, a quarter at the root. */
const UNIFIED_FLATS = { angle: 60, flatTop: 0.125, flatBottom: 0.25 };

/** A trapezoidal thread `angle`° across, half a pitch deep, with equal flats at crest and root. */
const trapezoidFlats = (angle: number): { angle: number; flatTop: number; flatBottom: number } => {
  const flat = (1 - Math.tan((angle * Math.PI) / 360)) / 2;
  return { angle, flatTop: flat, flatBottom: flat };
};

/** The shaft a Shaft Configuration describes, or why it doesn't make one. */
function shaftOf(c: ShaftConfig): Shaft | string {
  const segments: ShaftSegment[] = [];
  for (const [i, s] of c.segments.entries()) {
    const at = `segment ${i + 1}`;
    let thread: ThreadForm | null = null;
    if (s.type === "threaded") {
      const t = s.thread;
      const hand = { starts: 1, leftHand: t.leftHand, relief: "none" as const };
      if (t.type === "inch" || t.type === "metric") {
        const size = t.type === "inch" ? INCH_THREADS.find((z) => z.name === t.inch) : METRIC_THREADS.find((z) => z.name === t.metric);
        if (!size) return `${at} needs a thread size`;
        thread = { ...hand, ...UNIFIED_FLATS, outside: size.diameter, pitch: size.pitch };
      } else if (t.type === "custom") {
        thread = { ...hand, outside: t.outside, pitch: t.pitch, angle: t.angle, flatTop: t.flatTop, flatBottom: t.flatBottom, starts: t.starts };
      } else if (t.type === "acme") {
        thread = { ...hand, ...trapezoidFlats(t.acmeAngle), outside: t.acmeOutside, pitch: t.acmePitch };
      } else {
        const nut = LOCK_NUTS.find((n) => n.id === t.locknut);
        if (!nut) return `${at} needs a lock nut size`;
        thread = { ...hand, ...UNIFIED_FLATS, outside: nut.thread, pitch: nut.pitch, relief: t.relief };
      }
    }
    const straight = s.type === "straight";
    let keyway: ShaftKeyway | null = null;
    if (straight && s.keyway.on) {
      const k = s.keyway;
      const place = { from: k.from, distance: k.distance, position: k.position };
      if (k.kind === "parallel") {
        const key = standardKey(s.left.diameter, k.standard === "metric" ? "metric" : "inch", k.shape);
        if (!key) return `${at}: ${k.standard === "metric" ? "DIN 6885" : "ASME B17.1"} has no key for a ${ref(s.left.diameter)} mm shaft`;
        keyway = { ...place, width: key.width, depth: key.shaft, length: k.length, cutter: null };
      } else {
        const w = WOODRUFF_KEYS.find((z) => z.id === k.woodruff);
        if (!w) return `${at} needs a Woodruff key size`;
        keyway = { ...place, width: w.width, depth: w.shaft, length: 0, cutter: w.diameter };
      }
    }
    segments.push({
      type: s.type,
      length: s.length,
      left: s.left,
      right: straight ? { ...s.right, diameter: s.left.diameter } : s.right,
      thread,
      keyway,
      groove: straight && s.groove.on ? { from: s.groove.from, distance: s.groove.distance, type: s.groove.type, width: s.groove.width, depth: s.groove.depth } : null,
      flats: straight && s.flats.on ? { from: s.flats.from, distance: s.flats.distance, type: s.flats.type, length: s.flats.length, across: s.flats.across } : null,
    });
  }
  const shaft: Shaft = { segments, threads: c.threads, centreDrill: c.drill.on ? { style: c.drill.style, size: c.drill.size, ends: c.drill.ends } : null };
  return shaftProblem(shaft) ?? shaft;
}

/** A shaft of straight, tapered and threaded segments, its left end on the click and its axis running right; Preferences opens the Shaft Configuration. */
export class ShaftTool extends PlaceTool {
  readonly id = "shaft";
  readonly cursor = "crosshair";
  protected readonly label = "Shaft";
  private config = defaultShaftConfig();
  private problem: string | null = null;

  async preferences(): Promise<void> {
    const config = await shaftConfigDialog(this.config, shaftOf);
    if (config) this.config = config;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const shaft = shaftOf(this.config);
    this.problem = typeof shaft === "string" ? shaft : null;
    if (typeof shaft === "string" || scale === null) return null;
    const d = shaftDrawing(shaft, this.config.centreLine ? CENTRE_BEYOND_MM * scale : null);
    return [...drawingParts(d, at, angle), ...hiddenParts(d.hidden, scale, at, angle)];
  }

  solid(): Solid | null {
    const shaft = shaftOf(this.config);
    this.problem = typeof shaft === "string" ? shaft : null;
    return typeof shaft === "string" ? null : onLayer(lying(lathe(sectionProfile(shaftDrawing(shaft, null).outlines[0]))));
  }

  protected refusal(): string {
    return `The shaft's Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

class TappedHoleMetric extends TappedHoleTool {
  constructor(env: ToolEnv) {
    super(env, "tappedmm");
  }
}

class TappedHoleInch extends TappedHoleTool {
  constructor(env: ToolEnv) {
    super(env, "tappedin");
  }
}

export const DrilledHole3DTool = as3D(DrilledHoleTool, "drilledhole3d", "Hole - Drilled - 3D", undefined, true);
export const TappedMm3DTool = as3D(TappedHoleMetric, "tappedmm3d", "Hole - Tapped (Metric) - 3D", undefined, true);
export const TappedIn3DTool = as3D(TappedHoleInch, "tappedin3d", "Hole - Tapped (Inch) - 3D", undefined, true);
export const SpurGear3DTool = as3D(SpurGearTool, "spurgear3d", "Spur Gear - 3D", "front");
export const GearRack3DTool = as3D(GearRackTool, "gearrack3d", "Spur Gear Rack - 3D", "top");
export const Sprocket3DTool = as3D(SprocketTool, "sprocket3d", "Sprocket - 3D", "front");
export const LinearChain3DTool = as3D(LinearChainTool, "chainlinear3d", "Roller Chain - Linear - 3D");
export const CircularChain3DTool = as3D(CircularChainTool, "chaincircular3d", "Roller Chain - Circular - 3D");
export const OffsetLink3DTool = as3D(OffsetLinkTool, "offsetlink3d", "Roller Chain - Offset Link - 3D", "top");
export const Pulley3DTool = as3D(PulleyTool, "pulley3d", "Pulley - 3D", "front");
export const BevelGear3DTool = as3D(BevelGearTool, "bevelgear3d", "Bevel Gears - 3D", "side");
export const Worm3DTool = as3D(WormTool, "worm3d", "Worm - 3D", "front");
export const WormGear3DTool = as3D(WormGearTool, "wormgear3d", "Worm Gear - 3D", "front");
export const Key3DTool = as3D(KeyTool, "key3d", "Key - 3D", "top");
export const WoodruffKey3DTool = as3D(WoodruffKeyTool, "woodruffkey3d", "Woodruff Key - 3D", "top");
export const Shaft3DTool = as3D(ShaftTool, "shaft3d", "Shaft - 3D");
export const BallBearing3DTool = as3D(BallBearingTool, "ballbearing3d", "Ball Bearing - 3D", "front");
export const RollerBearing3DTool = as3D(RollerBearingTool, "rollerbearing3d", "Roller Bearing - 3D", "front");
export const NeedleBearing3DTool = as3D(NeedleBearingTool, "needlebearing3d", "Needle Bearing - 3D", "front");
export const TaperedBearing3DTool = as3D(TaperedBearingTool, "taperedbearing3d", "Tapered Roller Bearing - 3D", "front");
export const ThrustBearing3DTool = as3D(ThrustBearingTool, "thrustbearing3d", "Thrust Bearing - 3D", "front");
export const LockNut3DTool = as3D(LockNutTool, "locknut3d", "Bearing Lock Nut - 3D", "front");
export const PillowBlock3DTool = as3D(PillowBlockTool, "pillowblock3d", "Pillow Block - 3D", "top");
export const FlangedBearing23DTool = as3D(FlangedBearing2Tool, "flanged23d", "Flanged Bearing - 2 Hole - 3D", "front");
export const FlangedBearing43DTool = as3D(FlangedBearing4Tool, "flanged43d", "Flanged Bearing - 4 Hole - 3D", "front");
export const CompressionSpring13DTool = as3D(CompressionSpring1Tool, "compspring13d", "Compression Spring 1 - 3D");
export const CompressionSpring23DTool = as3D(CompressionSpring2Tool, "compspring23d", "Compression Spring 2 - 3D");
export const ConicalSpring3DTool = as3D(ConicalSpringTool, "conicalspring3d", "Conical Comp Spring - 3D");
export const DieSpring3DTool = as3D(DieSpringTool, "diespring3d", "Die Spring - 3D");
export const ExtensionSpring3DTool = as3D(ExtensionSpringFrontTool, "extspring3d", "Extension Spring - 3D");
export const TorsionSpring3DTool = as3D(TorsionSpringFrontTool, "torsion3d", "Torsion Spring - 3D");
export const BellevilleSpring3DTool = as3D(BellevilleSpringTool, "belleville3d", "Belleville Spring - 3D", "front");
