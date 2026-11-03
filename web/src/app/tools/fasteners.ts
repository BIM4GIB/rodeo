// The Fasteners tool set's pins (pinShapes.ts draws them), rivets (rivetShapes.ts) and nuts
// (nutShapes.ts). A click places one, a press dragged turns it; side views put the pin's left end
// (a clevis pin's head, a cotter pin's eye, a taper pin's large end, a tubular rivet's head) on the
// click with its axis running right, end views centre it there; a solid rivet stands head up, its
// head's bearing face on the click, and a nut crown or head up on its bearing face. The view is on
// keys 1 to 5. Clevis Pin (Inch), (Metric) and (DIN); Cotter Pin (Inch); Dowel Pin (Inch); Parallel
// Pin (DIN); Taper Pin (Inch) and (DIN); Large Rivet (Inch), Small Rivet (Inch), Rivet (DIN) and
// Tubular Rivet (DIN); Acorn Nut (Inch), Hex Cap Nut (DIN), Knurled Thumb Nut (DIN) and (Inch),
// and Wing Nut (DIN) and Type A to D (Inch); Retaining Ring (ASME) and (DIN) and Retaining Washer
// (DIN) (ringShapes.ts), centred on the click with their gap down; Eye Bolt, Swing Bolt, Swing Eye
// Bolt, T-Bolt, U-Bolt and J-Bolt (boltShapes.ts), on any UNC or ISO coarse thread; Thumb Screw
// (Inch), ASME B18.17's four types, head up on its bearing face; the Fastener tool's screws, with
// their washers and nut, shoulder screws and set screws (screwShapes.ts), nuts and washers
// (fastenerShapes.ts); and Detailing's Carriage Bolt, Lag Screw, Wood Screw and Sheet Metal Screw
// (detailScrewTables.ts), head up on the bearing face under the head (a countersunk head's top).

import type { Pt } from "../../core/index.ts";
import {
  CLEVIS_INCH,
  CLEVIS_METRIC,
  clevisPin,
  clevisProblem,
  COTTER_INCH,
  cotterPin,
  cotterProblem,
  DOWEL_INCH,
  dowelPin,
  dowelProblem,
  dinTaper,
  inchTaper,
  nearestLength,
  PARALLEL_DIN,
  parallelPin,
  parallelProblem,
  TAPER_DIN,
  TAPER_INCH,
  taperPin,
  taperProblem,
  type ClevisHead,
  type ClevisView,
  type CotterType,
  type CotterView,
  type DowelType,
  type ParallelForm,
  type PinEndView,
  type PinSideView,
} from "../pinShapes.ts";
import type { HoleDrawing } from "../machineShapes.ts";
import { axisProfile, bored, circleOutline, lathe, onEdge, onLayer, prism, type Solid } from "../solids3d.ts";
import { as3D } from "./solidTool.ts";
import { scaledWing, WING_A, WING_B, WING_DIN, wingNut, wingNutSolid, wingProblem, type Wing, type WingSize, type WingView } from "../wingShapes.ts";
import { ACORN_INCH, acornNut, crownedNut, crownedNutSolid, HEX_CAP_DIN, hexCapNut, KNURLED_DIN, KNURLED_INCH, knurledNut, type CrownStyle, type HexView, type KnurledSize } from "../nutShapes.ts";
import {
  DIN_HEAD_STANDARD,
  DIN_RIVET_SIZES,
  dinHead,
  largeHead,
  rivet,
  rivetProblem,
  setAllowance,
  smallHead,
  TUBULAR_DIN,
  tubularProblem,
  tubularRivet,
  type FastenerDrawing,
  type Head,
  type HeadType,
  type RivetView,
  type TubularForm,
  type TubularView,
} from "../rivetShapes.ts";
import { ASME_RINGS, DIN_RINGS, RETAINING_WASHERS, retainingRing, ringProblem, type Ring, type RingSize, type RingView } from "../ringShapes.ts";
import {
  BOLT_THREADS,
  boltThreadLength,
  EYE_THREADS,
  eyeBolt,
  eyeProblem,
  eyeSizes,
  jBolt,
  jBoltProblem,
  SWING_EYE_THREADS,
  swingBolt,
  swingEyeBolt,
  swingEyeProblem,
  swingEyeSizes,
  swingProblem,
  tBolt,
  tBoltProblem,
  THUMB_SIZES,
  thumbLength,
  thumbProblem,
  thumbScrew,
  uBolt,
  uBoltProblem,
  type BoltDrawing,
  type BoltThread,
  type BoltView,
  type EyeBolt,
  type EyeType,
  type JBolt,
  type JNut,
  type JWasher,
  type Shank,
  type SwingBolt,
  type SwingEyeBolt,
  type TBolt,
  type ThumbPoint,
  type ThumbType,
  type ThumbView,
  type UBolt,
  eyeBoltSolid,
  jBoltSolid,
  swingBoltSolid,
  swingEyeSolid,
  tBoltSolid,
  thumbScrewSolid,
  uBoltSolid,
} from "../boltShapes.ts";
import { placed } from "../detailShapes.ts";
import { lockProblem, lockWasher, nut, nutBody, nutProblem, plainWasher, washerProblem, type FastenerStandard, type FastenerView, type NutSize, type NutType, type PlainWasher, type WasherType } from "../fastenerShapes.ts";
import { LOCK_TYPES, NUT_TYPES, WASHER_TYPES } from "../fastenerTables.ts";
import { combination, combinationProblem, combinationSolid, itemHeight, screw, screwProblem, underHead, type Combination, type Screw, type ScrewHead, type StackItem } from "../screwShapes.ts";
import { SCREW_TYPES, screwThread, standardScrewLength, type ScrewSize, type ScrewType } from "../screwTables.ts";
import {
  SET_POINT_CHOICES,
  SET_POINTS,
  SET_SCREW_TYPES,
  SHOULDER_TYPES,
  standardSetLength,
  standardShoulderLength,
  type SetHead,
  type SetPoint,
  type SetScrewSize,
  type SetScrewType,
  type ShoulderSize,
  type ShoulderStyle,
} from "../setScrewTables.ts";
import {
  CARRIAGE_BOLTS,
  CARRIAGE_TYPES,
  carriageThreadLength,
  gimletTaper,
  LAG_SCREWS,
  lagThreadLength,
  SLOT_TYPES,
  standardWoodLength,
  TAP_HEADS,
  TAP_POINTS,
  TAP_SIZES,
  tapHead,
  tapThread,
  WOOD_HEADS,
  WOOD_SIZES,
  woodHead,
  woodThread,
  woodThreadLength,
  type CarriageBolts,
  type CarriageType,
  type DetailSize,
  type LagHead,
  type LagSize,
  type ScrewNominal,
  type SlotType,
  type TapHead,
  type TapPoint,
  type WoodHead,
} from "../detailScrewTables.ts";
import { THREAD_DISPLAYS } from "../shaftDialog.ts";
import type { ThreadDisplay } from "../shaftShapes.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import type { ToolModes } from "../tools.ts";
import { PlaceTool, type Part } from "./detailing.ts";
import { CENTRE_BEYOND_MM, drawingParts, hiddenParts } from "./machine.ts";

type View<T extends string> = { readonly id: T; readonly label: string };

const INCH = 25.4;
const ref = (n: number): string => String(Math.round(n * 1000) / 1000);

/** A pin in one of its views on keys 1 to n, with or without centre lines. */
abstract class PinTool<V extends string> extends PlaceTool {
  readonly cursor = "crosshair";
  protected abstract view: V;
  protected abstract readonly views: readonly View<V>[];
  /** what the refusal calls it */
  protected abstract readonly noun: string;
  protected centreLines = true;
  protected problem: string | null = null;

  /** the pin in `view`, centre lines `beyond` past it, or null with the reason kept in `problem` */
  protected abstract drawing(view: V, beyond: number | null): (HoleDrawing & { readonly hidden?: Pt[][] }) | null;

  /** What its 3D twin places (solidTool.ts), standing on the layer; null where it has none or its sizes don't make one. */
  solid(): Solid | null {
    return null;
  }

  /** The outlines of a drawing turned about its axis. */
  protected turned(view: V, axis: "x" | "y", bore = 0): Solid | null {
    const d = this.drawing(view, null);
    return d && d.outlines.flatMap((o) => lathe(bored(axisProfile(o, axis), bore)));
  }

  modes(): readonly ToolModes[] {
    return [{ label: "View", options: this.views.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.view }];
  }

  setMode(id: string): void {
    const view = this.views.find((m) => m.id === id);
    if (view) this.view = view.id;
  }

  hint(): string {
    return `${super.hint()} · 1–${this.views.length} view`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const d = this.drawing(this.view, this.centreLines ? CENTRE_BEYOND_MM * scale : null);
    return d ? [...drawingParts(d, at, angle), ...hiddenParts(d.hidden ?? [], scale, at, angle)] : null;
  }

  protected refusal(): string {
    return `The ${this.noun}'s Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

const CLEVIS_VIEWS: readonly View<ClevisView>[] = [
  { id: "top", label: "Top" },
  { id: "side", label: "Side" },
  { id: "head", label: "Head End" },
  { id: "body", label: "Body End" },
];
const HEAD_STYLES = [
  { value: "chamfered", label: "Chamfered" },
  { value: "rounded", label: "Rounded" },
];
const CLEVIS_NOTE = "Top looks down the split pin hole; Side shows the pin without it; Head End and Body End look along the axis.";

export class ClevisPinInchTool extends PinTool<ClevisView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  readonly id = "clevisinch";
  protected readonly label = "Clevis Pin (Inch)";
  protected readonly noun = "clevis pin";
  protected view: ClevisView = "top";
  protected readonly views = CLEVIS_VIEWS;
  private size = CLEVIS_INCH[3];
  private standardLength = true;
  private length = CLEVIS_INCH[3].standardLength!;
  private head: ClevisHead = "chamfered";

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Clevis Pin (Inch) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: CLEVIS_INCH.map((c) => ({ value: c.id, label: c.label })) },
        { kind: "check", key: "standard", label: "Use Standard Length", value: this.standardLength },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "head", label: "Head Style", value: this.head, options: HEAD_STYLES },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.label} (ASME B18.8.1), head ${ref(s.head / INCH)} in across, split pin hole ${ref(s.hole / INCH)} in, ${ref(s.holeFromEnd / INCH)} in from the end; standard length ${ref(s.standardLength! / INCH)} in under the head. Use Standard Length takes ASME's length for the size; clear it to use Length. ${CLEVIS_NOTE}`,
    );
    if (!v) return;
    this.size = CLEVIS_INCH.find((c) => c.id === v.choice("size")) ?? this.size;
    this.standardLength = v.flag("standard");
    this.length = v.num("length");
    this.head = v.choice("head") === "rounded" ? "rounded" : "chamfered";
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: ClevisView, beyond: number | null): HoleDrawing | null {
    const pin = { size: this.size, length: this.standardLength ? this.size.standardLength! : this.length, head: this.head, holes: true };
    this.problem = clevisProblem(pin);
    return this.problem ? null : clevisPin(pin, view, beyond);
  }
}

/** Clevis Pin (Metric) and (DIN): the same ISO 2341 sizes, their types named as each standard does. */
abstract class MetricClevisTool extends PinTool<ClevisView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  protected readonly noun = "clevis pin";
  protected view: ClevisView = "top";
  protected readonly views = CLEVIS_VIEWS;
  protected abstract readonly standard: string;
  protected abstract readonly types: readonly [string, string];
  private size = CLEVIS_METRIC[5];
  private holes = true;
  private increments = true;
  private length = 30;
  private head: ClevisHead = "chamfered";

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: CLEVIS_METRIC.map((c) => ({ value: c.id, label: c.label })) },
        { kind: "choice", key: "type", label: "Pin Type", value: this.holes ? "b" : "a", options: [{ value: "a", label: this.types[0] }, { value: "b", label: this.types[1] }] },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "head", label: "Head Style", value: this.head, options: [...HEAD_STYLES, { value: "headless", label: "Headless" }] },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.label} (${this.standard}), head ${ref(s.head)} × ${ref(s.headHeight)} mm, split pin hole ${ref(s.hole)} mm, ${ref(s.holeFromEnd)} mm from the end. Length is under the head (a headless pin's overall, as ISO 2340); Use Standard Length Increments rounds it to the nearest preferred length. A headless pin with holes has one at each end. ${CLEVIS_NOTE}`,
    );
    if (!v) return;
    this.size = CLEVIS_METRIC.find((c) => c.id === v.choice("size")) ?? this.size;
    this.holes = v.choice("type") === "b";
    this.increments = v.flag("increments");
    this.length = v.num("length");
    const head = v.choice("head");
    this.head = head === "rounded" || head === "headless" ? head : "chamfered";
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: ClevisView, beyond: number | null): HoleDrawing | null {
    const pin = { size: this.size, length: this.increments ? nearestLength(this.length) : this.length, head: this.head, holes: this.holes };
    this.problem = clevisProblem(pin);
    return this.problem ? null : clevisPin(pin, view, beyond);
  }
}

export class ClevisPinMetricTool extends MetricClevisTool {
  readonly id = "clevismetric";
  protected readonly label = "Clevis Pin (Metric)";
  protected readonly standard = "ISO 2341";
  protected readonly types = ["Type A (No Holes)", "Type B (With Holes)"] as const;
}

export class ClevisPinDinTool extends MetricClevisTool {
  readonly id = "clevisdin";
  protected readonly label = "Clevis Pin (DIN)";
  protected readonly standard = "DIN 1444, now DIN EN 22341";
  protected readonly types = ["Form A (No Holes)", "Form B (With Holes)"] as const;
}

const COTTER_VIEWS: readonly View<CotterView>[] = [
  { id: "front", label: "Front" },
  { id: "left", label: "Left Side" },
  { id: "right", label: "Right Side" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

export class CotterPinTool extends PinTool<CotterView> {
  readonly id = "cotterpin";
  protected readonly label = "Cotter Pin (Inch)";
  protected readonly noun = "cotter pin";
  protected view: CotterView = "front";
  protected readonly views = COTTER_VIEWS;
  private type: CotterType = "square";
  private size = COTTER_INCH[6];
  private grip = 0.75 * INCH;
  private length = INCH;
  private bendTop = 0;
  private bendBottom = 0;

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Cotter Pin (Inch) Preferences",
      [
        { kind: "choice", key: "type", label: "Cotter Pin Type", value: this.type, options: [{ value: "square", label: "Square Cut" }, { value: "hammer", label: "Hammer Lock" }] },
        { kind: "choice", key: "size", label: "Nominal Size", value: s.id, options: COTTER_INCH.map((c) => ({ value: c.id, label: `${c.id} in` })) },
        { kind: "length", key: "grip", label: "Grip Length", value: this.grip },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "number", key: "top", label: "Bend Angle (Top)", value: this.bendTop, min: 0, max: 180, unit: "°" },
        { kind: "number", key: "bottom", label: "Bend Angle (Bottom)", value: this.bendBottom, min: 0, max: 180, unit: "°" },
      ],
      `Now: ${s.id} in (ASME B18.8.1), for a ${ref(s.hole / INCH)} in hole: legs ${ref(s.shank / INCH)} in across, eye ${ref(s.eye / INCH)} in, extended prong ${ref(s.prong / INCH)} in longer. Length runs from under the eye to the shorter prong's end; the prongs bend apart at the Grip Length. A square cut pin's lower prong is the extended one; a hammer lock's upper prong is, its end turned down. The bends show from the front, top and bottom.`,
    );
    if (!v) return;
    this.type = v.choice("type") === "hammer" ? "hammer" : "square";
    this.size = COTTER_INCH.find((c) => c.id === v.choice("size")) ?? this.size;
    this.grip = v.num("grip");
    this.length = v.num("length");
    this.bendTop = v.num("top");
    this.bendBottom = v.num("bottom");
  }

  protected drawing(view: CotterView): HoleDrawing | null {
    const pin = { type: this.type, size: this.size, length: this.length, grip: this.grip, bendTop: this.bendTop, bendBottom: this.bendBottom };
    this.problem = cotterProblem(pin);
    return this.problem ? null : cotterPin(pin, view);
  }

  /** On its side, the wire's flat section all along. */
  override solid(): Solid | null {
    const across = (o: readonly Pt[]): number => Math.max(...o.map((p) => p.x)) - Math.min(...o.map((p) => p.x));
    const front = this.drawing("front");
    return front && onLayer(onEdge(prism([...front.outlines].sort((a, b) => across(b) - across(a)), -this.size.width / 2, this.size.width / 2)));
  }
}

const SIDE_VIEWS: readonly View<PinSideView>[] = [
  { id: "side", label: "Side" },
  { id: "left", label: "Left End" },
  { id: "right", label: "Right End" },
];

export class DowelPinTool extends PinTool<PinSideView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  readonly id = "dowelpin";
  protected readonly label = "Dowel Pin (Inch)";
  protected readonly noun = "dowel pin";
  protected view: PinSideView = "side";
  protected readonly views = SIDE_VIEWS;
  private type: DowelType = "machine";
  private size = DOWEL_INCH[6];
  private length = INCH;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Dowel Pin (Inch) Preferences",
      [
        {
          kind: "choice",
          key: "type",
          label: "Dowel Pin Type",
          value: this.type,
          options: [
            { value: "machine", label: "ANSI Hardened Ground Machine" },
            { value: "production", label: "ANSI Hardened Ground Production" },
            { value: "unhardened", label: "ANSI Unhardened Ground" },
          ],
        },
        { kind: "choice", key: "size", label: "Nominal Size", value: this.size.id, options: DOWEL_INCH.map((d) => ({ value: d.id, label: `${d.id} in` })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      "A machine dowel pin is crowned at one end (the left) and pointed at the other, to ASME B18.8.2's crown height and point diameter; production pins' corners are rounded and unhardened pins' ends chamfered, each a tenth of the diameter (Rodeo's proportion).",
    );
    if (!v) return;
    const type = v.choice("type");
    this.type = type === "production" || type === "unhardened" ? type : "machine";
    this.size = DOWEL_INCH.find((d) => d.id === v.choice("size")) ?? this.size;
    this.length = v.num("length");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: PinSideView, beyond: number | null): HoleDrawing | null {
    const pin = { type: this.type, size: this.size, length: this.length };
    this.problem = dowelProblem(pin);
    return this.problem ? null : dowelPin(pin, view, beyond);
  }
}

const END_VIEWS: readonly View<PinEndView>[] = [
  { id: "side", label: "Top View" },
  { id: "end", label: "End View" },
];

export class ParallelPinTool extends PinTool<PinEndView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  readonly id = "parallelpin";
  protected readonly label = "Parallel Pin (DIN)";
  protected readonly noun = "parallel pin";
  protected view: PinEndView = "side";
  protected readonly views = END_VIEWS;
  private size = PARALLEL_DIN[10];
  private form: ParallelForm = "a";
  private increments = true;
  private length = 30;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Parallel Pin (DIN) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: String(this.size.diameter), options: PARALLEL_DIN.map((p) => ({ value: String(p.diameter), label: `${p.diameter} mm` })) },
        { kind: "choice", key: "form", label: "Pin Type", value: this.form, options: [{ value: "a", label: "Form A (Chamfer and Domed End)" }, { value: "b", label: "Form B (Chamfers Only)" }] },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${this.size.diameter} mm, its ends chamfered ${this.size.chamfer} mm at 15° (DIN 7 / ISO 2338's c). Form A's other end is domed, a sphere as wide as the pin. Use Standard Length Increments rounds the length to the nearest preferred length.`,
    );
    if (!v) return;
    this.size = PARALLEL_DIN.find((p) => String(p.diameter) === v.choice("size")) ?? this.size;
    this.form = v.choice("form") === "b" ? "b" : "a";
    this.increments = v.flag("increments");
    this.length = v.num("length");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: PinEndView, beyond: number | null): HoleDrawing | null {
    const pin = { diameter: this.size.diameter, chamfer: this.size.chamfer, form: this.form, length: this.increments ? nearestLength(this.length) : this.length };
    this.problem = parallelProblem(pin);
    return this.problem ? null : parallelPin(pin, view, beyond);
  }
}

export class TaperPinInchTool extends PinTool<PinSideView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  readonly id = "taperpininch";
  protected readonly label = "Taper Pin (Inch)";
  protected readonly noun = "taper pin";
  protected view: PinSideView = "side";
  protected readonly views = SIDE_VIEWS;
  private size = TAPER_INCH[10];
  private range = true;
  private length = 1.5 * INCH;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Taper Pin (Inch) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: this.size.id, options: TAPER_INCH.map((t) => ({ value: t.id, label: `No. ${t.id} (${ref(t.large / INCH)} in)` })) },
        { kind: "check", key: "range", label: "Use Standard Length Range", value: this.range },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      "Sizes are ASME B18.8.2's large end diameters; the pin tapers 1/4 in per foot on its diameter toward the right, each end crowned. Use Standard Length Range keeps the length to the 1/4 to 8 in that taper pins are sold in (the standard's range for each size isn't published freely).",
    );
    if (!v) return;
    this.size = TAPER_INCH.find((t) => t.id === v.choice("size")) ?? this.size;
    this.range = v.flag("range");
    this.length = v.num("length");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: PinSideView, beyond: number | null): HoleDrawing | null {
    const length = this.range ? Math.min(Math.max(this.length, 0.25 * INCH), 8 * INCH) : this.length;
    const pin = inchTaper(this.size.large, length);
    this.problem = taperProblem(pin);
    return this.problem ? null : taperPin(pin, view, beyond);
  }
}

export class TaperPinDinTool extends PinTool<PinEndView> {
  override solid(): Solid | null {
    return this.turned("side", "x");
  }

  readonly id = "taperpindin";
  protected readonly label = "Taper Pin (DIN)";
  protected readonly noun = "taper pin";
  protected view: PinEndView = "side";
  protected readonly views: readonly View<PinEndView>[] = [
    { id: "side", label: "Side View" },
    { id: "end", label: "End View" },
  ];
  private size = TAPER_DIN[10];
  private range = true;
  private length = 40;

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Taper Pin (DIN) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: String(s.diameter), options: TAPER_DIN.map((t) => ({ value: String(t.diameter), label: `${t.diameter} mm` })) },
        { kind: "check", key: "range", label: "Use Standard Length Range and Increments", value: this.range },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.diameter} mm at the small end (DIN 1 / ISO 2339), tapering 1:50, its ends crowned. Use Standard Length Range and Increments keeps the length to ${s.min}–${s.max} mm for this size and rounds it to the nearest preferred length. The large end is at the left; End View looks at it.`,
    );
    if (!v) return;
    this.size = TAPER_DIN.find((t) => String(t.diameter) === v.choice("size")) ?? this.size;
    this.range = v.flag("range");
    this.length = v.num("length");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: PinEndView, beyond: number | null): HoleDrawing | null {
    const s = this.size;
    const pin = dinTaper(s.diameter, s.a, this.range ? nearestLength(this.length, s.min, s.max) : this.length);
    this.problem = taperProblem(pin);
    return this.problem ? null : taperPin(pin, view === "side" ? "side" : "left", beyond);
  }
}

const RIVET_VIEWS: readonly View<RivetView>[] = [
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];
type RivetSize = { readonly id: string; readonly label: string; readonly mm: number };
type HeadChoice = { readonly value: HeadType; readonly label: string };

const inchSizes = (ids: readonly string[]): readonly RivetSize[] =>
  ids.map((id) => {
    const [whole, frac] = id.includes("-") ? id.split("-") : id.includes("/") ? ["0", id] : [id, "0/1"];
    const [n, dd] = frac.split("/").map(Number);
    return { id, label: `${id} in`, mm: (Number(whole) + n / dd) * INCH };
  });

/** Large Rivet (Inch), Small Rivet (Inch) and Rivet (DIN): a diameter, a head at each end (the second optional), the length between. */
abstract class SolidRivetTool extends PinTool<RivetView> {
  override solid(): Solid | null {
    return this.turned("front", "y");
  }

  protected readonly noun = "rivet";
  protected view: RivetView = "front";
  protected readonly views = RIVET_VIEWS;
  protected abstract readonly sizes: readonly RivetSize[];
  protected abstract readonly heads: readonly HeadChoice[];
  protected abstract size: RivetSize;
  protected abstract length: number;
  protected abstract head: HeadType;
  private second: HeadType | null = null;

  /** the Preferences' note on the sizes now set */
  protected abstract note(): string;
  /** a head of `type` on this shank, or null with the reason kept in `problem` */
  protected abstract headOf(type: HeadType, d: number): Head | null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "size", label: "Diameter", value: this.size.id, options: this.sizes.map((s) => ({ value: s.id, label: s.label })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "head", label: "Head Type #1", value: this.head, options: this.heads },
        { kind: "choice", key: "second", label: "Head Type #2", value: this.second ?? "none", options: [{ value: "none", label: "None" }, ...this.heads] },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `${this.note()} Length is under the head, or overall from a countersunk head's top; Head Type #2 sets the other end, if any, bearing on the far face. Front shows the rivet head up; Top looks down on its head.`,
    );
    if (!v) return;
    this.size = this.sizes.find((s) => s.id === v.choice("size")) ?? this.size;
    this.length = v.num("length");
    this.head = this.heads.find((h) => h.value === v.choice("head"))?.value ?? this.head;
    this.second = this.heads.find((h) => h.value === v.choice("second"))?.value ?? null;
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: RivetView, beyond: number | null): HoleDrawing | null {
    this.problem = null;
    const d = this.size.mm;
    const head = this.headOf(this.head, d);
    if (!head) return null;
    const second = this.second ? this.headOf(this.second, d) : null;
    if (this.second && !second) return null;
    const r = { diameter: d, length: this.length, head, second };
    this.problem = rivetProblem(r);
    return this.problem ? null : rivet(r, view, beyond);
  }
}

const LARGE_RIVETS = inchSizes(["1/2", "5/8", "3/4", "7/8", "1", "1-1/8", "1-1/4", "1-3/8", "1-1/2", "1-5/8", "1-3/4"]);

export class LargeRivetTool extends SolidRivetTool {
  readonly id = "rivetlarge";
  protected readonly label = "Large Rivet (Inch)";
  protected readonly sizes = LARGE_RIVETS;
  protected readonly heads: readonly HeadChoice[] = [
    { value: "button", label: "Button Head" },
    { value: "highbutton", label: "High Button Head" },
    { value: "cone", label: "Cone Head" },
    { value: "pan", label: "Pan Head" },
    { value: "countersunk", label: "Flat Countersunk Head" },
    { value: "oval", label: "Oval Countersunk Head" },
  ];
  protected size = LARGE_RIVETS[2];
  protected length = 2 * INCH;
  protected head: HeadType = "button";

  protected note(): string {
    return `Now: ${this.size.label} (ASME B18.1.2). Heads take the standard's proportions of the diameter D: button 1.75D across × 0.75D high, high button (acorn) 1.5D + 1/32 in × 0.75D + 1/8 in, cone 1.75D × 0.875D, pan 1.6D × 0.7D, flat and oval countersunk 1.81D at 78°.`;
  }

  protected headOf(type: HeadType, d: number): Head {
    return largeHead(type, d);
  }
}

const SMALL_RIVETS = inchSizes(["1/16", "3/32", "1/8", "5/32", "3/16", "7/32", "1/4", "9/32", "5/16", "11/32", "3/8", "13/32", "7/16"]);

export class SmallRivetTool extends SolidRivetTool {
  readonly id = "rivetsmall";
  protected readonly label = "Small Rivet (Inch)";
  protected readonly sizes = SMALL_RIVETS;
  protected readonly heads: readonly HeadChoice[] = [
    { value: "button", label: "Button Head" },
    { value: "flat", label: "Flat Head" },
    { value: "smallpan", label: "Pan Head" },
    { value: "truss", label: "Truss Head" },
    { value: "countersunk", label: "Flat Countersunk Head" },
  ];
  protected size = SMALL_RIVETS[6];
  protected length = INCH;
  protected head: HeadType = "button";

  protected note(): string {
    return `Now: ${this.size.label} (ASME B18.1.1). Heads take the standard's proportions of the diameter D: button 1.8D across × 0.75D high, flat 2D × 0.33D, pan 1.72D × 0.57D, truss 2.3D × 0.33D, flat countersunk 1.81D at 90°.`;
  }

  protected headOf(type: HeadType, d: number): Head {
    return smallHead(type, d);
  }
}

const DIN_RIVETS: readonly RivetSize[] = DIN_RIVET_SIZES.map((d) => ({ id: String(d), label: `${d} mm`, mm: d }));
const DIN_HEADS: readonly (HeadChoice & { readonly value: keyof typeof DIN_HEAD_STANDARD })[] = [
  { value: "round", label: "Round Head" },
  { value: "flatround", label: "Flat Round Head" },
  { value: "mushroom", label: "Mushroom Head" },
  { value: "countersunk", label: "Flat Countersunk Head" },
];

export class RivetDinTool extends SolidRivetTool {
  readonly id = "rivetdin";
  protected readonly label = "Rivet (DIN)";
  protected readonly sizes = DIN_RIVETS;
  protected readonly heads = DIN_HEADS;
  protected size = DIN_RIVETS[8];
  protected length = 12;
  protected head: HeadType = "round";

  protected note(): string {
    const head = dinHead(this.head, this.size.mm);
    const std = DIN_HEAD_STANDARD[DIN_HEADS.find((h) => h.value === this.head)?.value ?? "round"];
    const now = head ? `, its head ${ref(head.across)} × ${ref(head.height)} mm (${std.name})` : "";
    return `Now: ${this.size.label}${now}. Heads are DIN 660 round (1–8 mm), DIN 674 flat round (1.4–6 mm), DIN 662 mushroom (1.6–6 mm) and DIN 661 flat countersunk at 75° (1–8 mm).`;
  }

  protected headOf(type: HeadType, d: number): Head | null {
    const head = dinHead(type, d);
    if (!head) {
      const choice = DIN_HEADS.find((h) => h.value === type);
      const std = DIN_HEAD_STANDARD[choice?.value ?? "round"];
      this.problem = `${std.name}'s ${choice?.label.toLowerCase() ?? "head"}s come ${std.from} to ${std.to} mm across the shank, not ${d} mm`;
    }
    return head;
  }
}

const TUBULAR_VIEWS: readonly View<TubularView>[] = [
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];

export class TubularRivetTool extends PinTool<TubularView> {
  override solid(): Solid | null {
    return this.turned("side", "x", this.size.outside / 2 - this.size.wall);
  }

  readonly id = "rivettubular";
  protected readonly label = "Tubular Rivet (DIN)";
  protected readonly noun = "tubular rivet";
  protected view: TubularView = "side";
  protected readonly views = TUBULAR_VIEWS;
  private size = TUBULAR_DIN[10];
  private increments = true;
  private length = 8;
  private form: TubularForm = "a";
  private uncompressed = true;

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Tubular Rivet (DIN) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: TUBULAR_DIN.map((t) => ({ value: t.id, label: `${t.outside} × ${t.wall} mm` })) },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "form", label: "Form", value: this.form, options: [{ value: "a", label: "Form A" }, { value: "b", label: "Form B" }] },
        { kind: "check", key: "uncompressed", label: "Show Uncompressed Length", value: this.uncompressed },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: a ${s.outside} mm tube, its wall ${s.wall} mm, flanged ${s.flange} × ${s.height} mm (DIN 7340). Length is the tube under the head before it's set; setting its far end into a flange like the head takes ${ref(setAllowance(s))} mm of it (Rodeo's reading: the flange's volume as tube), and Show Uncompressed Length dashes the unset tube past it. Use Standard Length Increments rounds the length to the nearest preferred length (ISO's; DIN 7340's own list for each size isn't published freely). Form A's flanges are square, Form B's rounded.`,
    );
    if (!v) return;
    this.size = TUBULAR_DIN.find((t) => t.id === v.choice("size")) ?? this.size;
    this.increments = v.flag("increments");
    this.length = v.num("length");
    this.form = v.choice("form") === "b" ? "b" : "a";
    this.uncompressed = v.flag("uncompressed");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: TubularView, beyond: number | null): (HoleDrawing & { readonly hidden: Pt[][] }) | null {
    const t = { size: this.size, length: this.increments ? nearestLength(this.length) : this.length, form: this.form, uncompressed: this.uncompressed };
    this.problem = tubularProblem(t);
    return this.problem ? null : tubularRivet(t, view, beyond);
  }
}

const HEX_VIEWS: readonly View<HexView>[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];
const HEX_NOTE = "Front looks across the hex's corners (three faces), Side across its flats (two), Top down on the crown.";

export class AcornNutTool extends PinTool<HexView> {
  override solid(): Solid {
    return crownedNutSolid(acornNut(this.size, this.style));
  }

  readonly id = "acornnut";
  protected readonly label = "Acorn Nut (Inch)";
  protected readonly noun = "acorn nut";
  protected view: HexView = "front";
  protected readonly views = HEX_VIEWS;
  private size = ACORN_INCH[4];
  private style: CrownStyle = "low";

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Acorn Nut (Inch) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: ACORN_INCH.map((a) => ({ value: a.id, label: a.label })) },
        { kind: "choice", key: "style", label: "Style", value: this.style, options: [{ value: "low", label: "Low Crown" }, { value: "high", label: "High Crown" }] },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.label} (SAE J483), ${ref(s.flats / INCH)} in across the flats, its crown ${ref(s.crown / INCH)} in across and ${ref(s.low.height / INCH)} in high overall with a low crown, ${ref(s.high.height / INCH)} in with a high one. ${HEX_NOTE}`,
    );
    if (!v) return;
    this.size = ACORN_INCH.find((a) => a.id === v.choice("size")) ?? this.size;
    this.style = v.choice("style") === "high" ? "high" : "low";
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: HexView, beyond: number | null): HoleDrawing {
    return crownedNut(acornNut(this.size, this.style), view, beyond);
  }
}

export class HexCapNutTool extends PinTool<HexView> {
  override solid(): Solid {
    return crownedNutSolid(hexCapNut(this.size));
  }

  readonly id = "hexcapnut";
  protected readonly label = "Hex Cap Nut (DIN)";
  protected readonly noun = "hex cap nut";
  protected view: HexView = "front";
  protected readonly views = HEX_VIEWS;
  private size = HEX_CAP_DIN[4];

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Hex Cap Nut (DIN) Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: HEX_CAP_DIN.map((c) => ({ value: c.id, label: c.label })) },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.label} (DIN 1587, high type), ${ref(s.flats)} mm across the flats, the hex ${ref(s.hex)} mm high, its dome ${ref(s.dome)} mm across and ${ref(s.height)} mm high overall. ${HEX_NOTE}`,
    );
    if (!v) return;
    this.size = HEX_CAP_DIN.find((c) => c.id === v.choice("size")) ?? this.size;
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: HexView, beyond: number | null): HoleDrawing {
    return crownedNut(hexCapNut(this.size), view, beyond);
  }
}

const KNURLED_VIEWS: readonly View<"front" | "top">[] = [
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

/** Knurled Thumb Nut (DIN) and (Inch): a size, Show Detail for the knurl, Front and Top. */
abstract class KnurledNutTool extends PinTool<"front" | "top"> {
  override solid(): Solid | null {
    return this.turned("front", "y", this.size.thread / 2);
  }

  protected readonly noun = "knurled thumb nut";
  protected view: "front" | "top" = "front";
  protected readonly views = KNURLED_VIEWS;
  protected abstract readonly sizes: readonly KnurledSize[];
  protected abstract size: KnurledSize;
  private detail = true;

  /** where the sizes come from */
  protected abstract source(): string;
  /** a size in this tool's units */
  protected abstract unit(mm: number): string;

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "size", label: "Size", value: s.id, options: this.sizes.map((k) => ({ value: k.id, label: k.label })) },
        { kind: "check", key: "detail", label: "Show Detail", value: this.detail },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${s.label}, its knurled head ${this.unit(s.knurl)} across and ${this.unit(s.head)} high on a collar ${this.unit(s.collar)} across, ${this.unit(s.height)} high overall (${this.source()}). Show Detail draws the knurl's ridges; Front stands the nut head up on its collar, Top looks down on the head.`,
    );
    if (!v) return;
    this.size = this.sizes.find((k) => k.id === v.choice("size")) ?? this.size;
    this.detail = v.flag("detail");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: "front" | "top", beyond: number | null): HoleDrawing {
    return knurledNut(this.size, view, this.detail, beyond);
  }
}

export class KnurledNutDinTool extends KnurledNutTool {
  readonly id = "knurleddin";
  protected readonly label = "Knurled Thumb Nut (DIN)";
  protected readonly sizes = KNURLED_DIN;
  protected size = KNURLED_DIN[7];

  protected source(): string {
    return "DIN 466, high type";
  }

  protected unit(mm: number): string {
    return `${ref(mm)} mm`;
  }
}

export class KnurledNutInchTool extends KnurledNutTool {
  readonly id = "knurledinch";
  protected readonly label = "Knurled Thumb Nut (Inch)";
  protected readonly sizes = KNURLED_INCH;
  protected size = KNURLED_INCH[5];

  protected source(): string {
    return "no free standard tabulates inch knurled thumb nuts, so Rodeo takes DIN 466's sizes at the same diameter";
  }

  protected unit(mm: number): string {
    return `${ref(mm / INCH)} in`;
  }
}

const WING_VIEWS: readonly View<WingView>[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];
type WingStyle = { readonly value: string; readonly label: string };

/** Wing Nut (DIN) and Type A to D (Inch): a size, a style where the type has them, Front, Side and Top. */
abstract class WingNutTool extends PinTool<WingView> {
  protected readonly noun = "wing nut";
  protected view: WingView = "front";
  protected readonly views = WING_VIEWS;
  protected abstract readonly styles: readonly WingStyle[];
  protected style = "1";
  protected abstract size: WingSize;
  /** the sizes `style` comes in */
  protected abstract sizes(style: string): readonly WingSize[];
  /** the nut's sizes in `style` */
  protected abstract wing(size: WingSize, style: string): Wing;
  /** the Preferences' note on where the sizes come from */
  protected abstract source(): string;
  /** a size in this tool's units */
  protected abstract unit(mm: number): string;

  async preferences(): Promise<void> {
    const w = this.wing(this.size, this.style);
    const fields = [
      ...(this.styles.length ? [{ kind: "choice" as const, key: "style", label: "Style", value: this.style, options: this.styles }] : []),
      { kind: "choice" as const, key: "size", label: "Size", value: this.size.id, options: this.sizes(this.style).map((s) => ({ value: s.id, label: s.label })) },
      { kind: "check" as const, key: "centre", label: "Show Center Line", value: this.centreLines },
    ];
    const v = await toolPrefs(
      `${this.label} Preferences`,
      fields,
      `Now: ${this.size.label}, its wings spreading ${this.unit(w.spread)} and standing ${this.unit(w.height)} high, ${this.unit(w.boss)} across the boss (${this.source()}). Front shows the wings spread, Side one wing edge on, Top looks down on them.`,
    );
    if (!v) return;
    if (this.styles.length) this.style = this.styles.find((s) => s.value === v.choice("style"))?.value ?? this.style;
    const sizes = this.sizes(this.style);
    this.size = sizes.find((s) => s.id === v.choice("size")) ?? sizes.find((s) => s.id === this.size.id) ?? sizes[0];
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: WingView, beyond: number | null): HoleDrawing | null {
    const w = this.wing(this.size, this.style);
    this.problem = wingProblem(w);
    return this.problem ? null : wingNut(w, view, beyond);
  }

  override solid(): Solid | null {
    const w = this.wing(this.size, this.style);
    return wingProblem(w) ? null : wingNutSolid(w);
  }
}

/** an inch wing nut's sizes in inches */
abstract class InchWingNutTool extends WingNutTool {
  protected unit(mm: number): string {
    return `${ref(mm / INCH)} in`;
  }
}

export class WingNutDinTool extends WingNutTool {
  readonly id = "wingdin";
  protected readonly label = "Wing Nut (DIN)";
  protected readonly styles: readonly WingStyle[] = [];
  protected size = WING_DIN[3];

  protected sizes(): readonly WingSize[] {
    return WING_DIN;
  }

  protected wing(size: WingSize): Wing {
    return { ...size.wing, form: "solid" };
  }

  protected source(): string {
    return "DIN 315, rounded wings; the gap between the wings, which DIN 315 doesn't give, is 0.7 of the boss";
  }

  protected unit(mm: number): string {
    return `${ref(mm)} mm`;
  }
}

export class WingNutATool extends InchWingNutTool {
  readonly id = "winga";
  protected readonly label = "Wing Nut - Type A (Inch)";
  protected readonly styles: readonly WingStyle[] = [];
  protected size = WING_A[13];

  protected sizes(): readonly WingSize[] {
    return WING_A;
  }

  protected wing(size: WingSize): Wing {
    return { ...size.wing, form: "solid" };
  }

  protected source(): string {
    return "ASME B18.6.9 Type A, cold forged, in the light, regular or heavy series each size comes in";
  }
}

export class WingNutBTool extends InchWingNutTool {
  readonly id = "wingb";
  protected readonly label = "Wing Nut - Type B (Inch)";
  protected readonly styles: readonly WingStyle[] = [
    { value: "1", label: "Style 1" },
    { value: "2", label: "Style 2" },
  ];
  protected size = WING_B["1"][2];

  protected sizes(style: string): readonly WingSize[] {
    return WING_B[style === "2" ? "2" : "1"];
  }

  protected wing(size: WingSize, style: string): Wing {
    const s = this.sizes(style).find((x) => x.id === size.id) ?? size;
    return { ...s.wing, form: "solid" };
  }

  protected source(): string {
    return "ASME B18.6.9 Type B, hot forged: Style 1 moderate wings, Style 2 high";
  }
}

const SCALED_STYLES: Record<"C" | "D", readonly WingStyle[]> = {
  C: [
    { value: "1", label: "Style 1" },
    { value: "2", label: "Style 2" },
    { value: "3", label: "Style 3" },
  ],
  D: [
    { value: "1", label: "Style 1" },
    { value: "2", label: "Style 2" },
    { value: "3", label: "Style 3" },
  ],
};

export class WingNutCTool extends InchWingNutTool {
  readonly id = "wingc";
  protected readonly label = "Wing Nut - Type C (Inch)";
  protected readonly styles = SCALED_STYLES.C;
  protected size = WING_B["1"][2];

  protected sizes(): readonly WingSize[] {
    return WING_B["1"];
  }

  protected wing(size: WingSize, style: string): Wing {
    return scaledWing(size, "C", style === "2" ? "2" : style === "3" ? "3" : "1");
  }

  protected source(): string {
    return "die cast, hollow wings: Style 1 regular, Style 2 low, Style 3 high; ASME's Type C table isn't published freely, so Rodeo scales Type B Style 1's sizes";
  }
}

export class WingNutDTool extends InchWingNutTool {
  readonly id = "wingd";
  protected readonly label = "Wing Nut - Type D (Inch)";
  protected readonly styles = SCALED_STYLES.D;
  protected size = WING_B["1"][2];

  protected sizes(): readonly WingSize[] {
    return WING_B["1"];
  }

  protected wing(size: WingSize, style: string): Wing {
    return scaledWing(size, "D", style === "2" ? "2" : style === "3" ? "3" : "1");
  }

  protected source(): string {
    return "stamped from strip: Style 1 regular, Style 2 low wings, Style 3 a large base; ASME's Type D table isn't published freely, so Rodeo scales Type B Style 1's sizes";
  }
}

const RING_VIEWS: readonly View<RingView>[] = [
  { id: "front", label: "Front" },
  { id: "section", label: "Side-Section" },
  { id: "solid", label: "Side-Solid" },
];
type RingType = { readonly id: string; readonly label: string; readonly source: string; readonly sizes: readonly RingSize[] };

/** the size in `sizes` nearest `mm` */
const nearestRing = (sizes: readonly RingSize[], mm: number): RingSize =>
  sizes.reduce((best, s) => (Math.abs(Number(s.id) - mm) < Math.abs(Number(best.id) - mm) ? s : best));

function ringNote(r: Ring): string {
  if (r.form === "circlip") return `its free diameter ${ref(r.free)} mm, ${ref(r.thickness)} mm thick, its lugs ${ref(r.lug)} mm high with ${ref(r.hole)} mm holes`;
  if (r.form === "e") return `its prongs reaching ${ref(r.inside)} mm across, ${ref(r.outside)} mm outside, ${ref(r.thickness)} mm thick`;
  return `${ref(r.inside)} mm inside, ${ref(r.outside)} mm outside, ${ref(r.thickness)} mm thick`;
}

/** Retaining rings and washers: a size, Front, Side-Section and Side-Solid, and a locus at the centre if asked. */
abstract class RingTool extends PinTool<RingView> {
  protected readonly noun: string = "retaining ring";
  protected view: RingView = "front";
  protected readonly views: readonly View<RingView>[] = RING_VIEWS;
  protected abstract size: RingSize;
  protected locus = false;

  protected drawing(view: RingView): FastenerDrawing | null {
    this.problem = ringProblem(this.size.ring);
    return this.problem ? null : retainingRing(this.size.ring, view);
  }

  /** Flat, as thick as the ring, with a circlip's holes through its lugs. */
  override solid(): Solid | null {
    const d = this.drawing("front");
    return d && prism([d.outlines[0], ...d.circles.map((c) => circleOutline(c.center, c.radius, 16))], 0, this.size.ring.thickness);
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const parts = super.shapes(at, angle);
    return parts && this.locus ? [...parts, { kind: "locus", at }] : parts;
  }
}

/** Retaining Ring (ASME) and (DIN): a Type, then a size it comes in. */
abstract class TypedRingTool extends RingTool {
  protected abstract readonly types: readonly RingType[];
  protected abstract type: RingType;

  async preferences(): Promise<void> {
    const t = this.type;
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "type", label: "Type", value: t.id, options: this.types.map((x) => ({ value: x.id, label: x.label })) },
        { kind: "choice", key: "size", label: "Size (mm)", value: this.size.id, options: t.sizes.map((s) => ({ value: s.id, label: s.label })) },
        { kind: "check", key: "locus", label: "Place Locus at Center", value: this.locus },
      ],
      `Now: ${t.label}, size ${this.size.label} (${t.source}), ${ringNote(this.size.ring)}. A size is the shaft or bore it fits; another Type takes its size nearest this one, and lists its own sizes when Preferences open again. Where the lugs or prongs sit round the gap is Rodeo's reading. Front shows the ring gap down, Side-Section and Side-Solid edge on.`,
    );
    if (!v) return;
    const type = this.types.find((x) => x.id === v.choice("type")) ?? t;
    this.size = nearestRing(type.sizes, Number(type === t ? v.choice("size") : this.size.id));
    this.type = type;
    this.locus = v.flag("locus");
  }
}

export class RetainingRingAsmeTool extends TypedRingTool {
  readonly id = "ringasme";
  protected readonly label = "Retaining Ring (ASME)";
  protected readonly types = ASME_RINGS;
  protected type: RingType = ASME_RINGS[1];
  protected size = nearestRing(ASME_RINGS[1].sizes, 20);
}

export class RetainingRingDinTool extends TypedRingTool {
  readonly id = "ringdin";
  protected readonly label = "Retaining Ring (DIN)";
  protected readonly types = DIN_RINGS;
  protected type: RingType = DIN_RINGS[2];
  protected size = nearestRing(DIN_RINGS[2].sizes, 20);
}

export class RetainingWasherDinTool extends RingTool {
  readonly id = "washerdin";
  protected readonly label = "Retaining Washer (DIN)";
  protected readonly noun = "retaining washer";
  protected readonly views: readonly View<RingView>[] = [
    { id: "front", label: "Front" },
    { id: "section", label: "Side Section" },
    { id: "solid", label: "Side Solid" },
  ];
  protected size = nearestRing(RETAINING_WASHERS, 6);

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Retaining Washer (DIN) Preferences",
      [
        { kind: "choice", key: "size", label: "Groove Size (mm)", value: this.size.id, options: RETAINING_WASHERS.map((s) => ({ value: s.id, label: s.label })) },
        { kind: "check", key: "locus", label: "Place Locus at Center", value: this.locus },
      ],
      `Now: groove ${this.size.label} mm (DIN 6799), ${ringNote(this.size.ring)}. Its prongs are drawn on the groove; DIN 6799 gives no band outside the cut-outs, so Rodeo takes a tenth of the outside. Front shows the washer open side down, Side Section and Side Solid edge on.`,
    );
    if (!v) return;
    this.size = RETAINING_WASHERS.find((s) => s.id === v.choice("size")) ?? this.size;
    this.locus = v.flag("locus");
  }
}

const BOLT_VIEWS: readonly View<BoltView>[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];
/** a length in Preferences; `late` ones come after the tool's own choices */
type BoltField = { readonly key: string; readonly label: string; readonly late?: boolean };
type Lengths = Record<string, number>;
const NONE = { value: "none", label: "None" };

/** Bolts: a thread size and the bolt's lengths, which follow a new size unless typed over, the thread's style, the views, and a locus at the eye's or bend's centre if asked. */
abstract class BoltTool extends PinTool<BoltView> {
  protected view: BoltView = "front";
  protected readonly views: readonly View<BoltView>[] = BOLT_VIEWS;
  protected abstract readonly threads: readonly BoltThread[];
  protected abstract thread: BoltThread;
  protected abstract readonly fields: readonly BoltField[];
  protected display: ThreadDisplay = "asme";
  protected readonly hasLocus: boolean = true;
  protected locus = false;
  private lengths: Lengths | null = null;
  private centre: Pt = { x: 0, y: 0 };

  /** the lengths' defaults for thread `t` */
  protected abstract defaults(t: BoltThread): Lengths;
  /** the bolt, or null with the reason kept in `problem` */
  protected abstract bolt(view: BoltView, beyond: number | null): BoltDrawing | null;
  /** the Preferences' note */
  protected abstract note(): string;

  /** the tool's own choices: before the lengths (a Type) and after the thread's style */
  protected choices(): { readonly before: PrefField[]; readonly after: PrefField[] } {
    return { before: [], after: [] };
  }

  /** reads back the tool's own choices */
  protected read(_v: PrefValues): void {}

  /** the length `key` now */
  protected len(key: string): number {
    this.lengths ??= this.defaults(this.thread);
    return this.lengths[key];
  }

  async preferences(): Promise<void> {
    const shown: Lengths = Object.fromEntries(this.fields.map((f) => [f.key, this.len(f.key)]));
    const length = (f: BoltField): PrefField => ({ kind: "length", key: f.key, label: f.label, value: shown[f.key] });
    const own = this.choices();
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        { kind: "choice", key: "size", label: "Size", value: this.thread.id, options: this.threads.map((t) => ({ value: t.id, label: t.id })) },
        ...own.before,
        ...this.fields.filter((f) => !f.late).map(length),
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        ...own.after,
        ...this.fields.filter((f) => f.late).map(length),
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
        ...(this.hasLocus ? [{ kind: "check" as const, key: "locus", label: "Place Locus at Center", value: this.locus }] : []),
      ],
      this.note(),
    );
    if (!v) return;
    const thread = this.threads.find((t) => t.id === v.choice("size")) ?? this.thread;
    const fresh = this.defaults(thread);
    // a length left as shown follows a new size
    this.lengths = Object.fromEntries(this.fields.map((f) => [f.key, thread !== this.thread && v.num(f.key) === shown[f.key] ? fresh[f.key] : v.num(f.key)]));
    this.thread = thread;
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    this.read(v);
    this.centreLines = v.flag("centre");
    if (this.hasLocus) this.locus = v.flag("locus");
  }

  /** the shank: `length` long, threaded `thread length` */
  protected shank(): Shank {
    return { thread: this.thread, length: this.len("length"), threadLength: this.len("threadLength"), display: this.display };
  }

  /** a size in the thread's units */
  protected unit(mm: number): string {
    return this.thread.inch ? `${ref(mm / INCH)} in` : `${ref(mm)} mm`;
  }

  protected drawing(view: BoltView, beyond: number | null): BoltDrawing | null {
    const d = this.bolt(view, beyond);
    if (d) this.centre = d.locus;
    return d;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const parts = super.shapes(at, angle);
    return parts && this.hasLocus && this.locus ? [...parts, { kind: "locus", at: placed([this.centre], at, angle)[0] }] : parts;
  }
}

const SHANK_FIELDS: readonly BoltField[] = [
  { key: "length", label: "Length" },
  { key: "threadLength", label: "Thread Length" },
];
const BOLT_NOTE = "Lengths left as shown follow a new Size. Front and Side look across the shank, Top and Bottom down and up it.";
/** the standard lengths of a bolt with a head: five diameters under it, threaded as ISO 4014 or ASME B18.2.1 */
const headed = (t: BoltThread): Lengths => ({ length: 5 * t.diameter, threadLength: boltThreadLength(t, 5 * t.diameter) });
const EYE_TYPES = [
  { value: "plain", label: "Plain" },
  { value: "shoulder", label: "Shoulder" },
  { value: "bent", label: "Bent" },
];

export class EyeBoltTool extends BoltTool {
  readonly id = "eyebolt";
  protected readonly label = "Eye Bolt";
  protected readonly noun = "eye bolt";
  protected readonly threads = EYE_THREADS;
  protected thread = EYE_THREADS.find((t) => t.id === "1/2-13 UNC") ?? EYE_THREADS[0];
  protected readonly fields: readonly BoltField[] = [{ key: "inside", label: "Eye Inside Dia" }, ...SHANK_FIELDS];
  private type: EyeType = "plain";

  protected defaults(t: BoltThread): Lengths {
    const s = eyeSizes(t);
    return { inside: s.inside, length: s.length, threadLength: s.threadLength };
  }

  protected choices(): { before: PrefField[]; after: PrefField[] } {
    return { before: [{ kind: "choice", key: "type", label: "Type", value: this.type, options: EYE_TYPES }], after: [] };
  }

  protected read(v: PrefValues): void {
    const type = v.choice("type");
    this.type = type === "shoulder" || type === "bent" ? type : "plain";
  }

  protected note(): string {
    const s = eyeSizes(this.thread);
    const eye = this.type === "bent" ? "bent from rod as thick as the shank" : `its eye's section ${this.unit(s.section)} round${this.type === "shoulder" ? `, on a shoulder ${this.unit(s.shoulder)} across and ${this.unit(s.shoulderHeight)} high` : ""}`;
    return `Now: ${this.thread.id}, ${eye}. Sizes are ASME B18.15's forged eye bolts (Style A) for inch threads and, as no free table gives metric ones, the same interpolated by diameter for metric threads; the bent eye's S-bend is Rodeo's. Length is under the eye (or shoulder); the bearing face goes on the click. ${BOLT_NOTE}`;
  }

  private eye(): EyeBolt {
    const s = eyeSizes(this.thread);
    return { type: this.type, shank: this.shank(), inside: this.len("inside"), section: s.section, shoulder: s.shoulder, shoulderHeight: s.shoulderHeight };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const e = this.eye();
    this.problem = eyeProblem(e);
    return this.problem ? null : eyeBolt(e, view, beyond);
  }

  override solid(): Solid | null {
    const e = this.eye();
    return eyeProblem(e) ? null : onLayer(eyeBoltSolid(e));
  }
}

export class SwingBoltTool extends BoltTool {
  readonly id = "swingbolt";
  protected readonly label = "Swing Bolt";
  protected readonly noun = "swing bolt";
  protected readonly threads = BOLT_THREADS;
  protected thread = BOLT_THREADS.find((t) => t.id === "1/2-13 UNC") ?? BOLT_THREADS[0];
  protected readonly fields: readonly BoltField[] = [
    { key: "width", label: "Head Width" },
    { key: "shoulder", label: "Shoulder Length" },
    { key: "thickness", label: "Head Thickness" },
    ...SHANK_FIELDS,
  ];

  protected defaults(t: BoltThread): Lengths {
    const D = t.diameter;
    return { width: 2 * D, shoulder: 1.3 * D, thickness: D, ...headed(t) };
  }

  protected note(): string {
    return `Now: ${this.thread.id}, its pin hole ${this.unit(this.len("width") / 2)} across. No standard tabulates swing bolts, so the head starts twice the thread's diameter wide and as thick as it, its pin hole half its width; Shoulder Length runs from the bearing face (on the click) to the hole's centre. Thread length is ISO 4014's or ASME B18.2.1's. ${BOLT_NOTE}`;
  }

  private swing(): SwingBolt {
    return { shank: this.shank(), width: this.len("width"), shoulder: this.len("shoulder"), thickness: this.len("thickness") };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const s = this.swing();
    this.problem = swingProblem(s);
    return this.problem ? null : swingBolt(s, view, beyond);
  }

  override solid(): Solid | null {
    const s = this.swing();
    return swingProblem(s) ? null : onLayer(swingBoltSolid(s));
  }
}

export class SwingEyeBoltTool extends BoltTool {
  readonly id = "swingeyebolt";
  protected readonly label = "Swing Eye Bolt";
  protected readonly noun = "swing eye bolt";
  protected readonly threads = SWING_EYE_THREADS;
  protected thread = SWING_EYE_THREADS.find((t) => t.id === "M10 × 1.5") ?? SWING_EYE_THREADS[0];
  protected readonly fields: readonly BoltField[] = [{ key: "inside", label: "Eye Inside Dia" }, { key: "outside", label: "Outside Diameter" }, ...SHANK_FIELDS];

  protected defaults(t: BoltThread): Lengths {
    const s = swingEyeSizes(t);
    return { inside: s.inside, outside: s.outside, length: 5 * t.diameter, threadLength: Math.min(s.threadLength, 5 * t.diameter) };
  }

  protected note(): string {
    return `Now: ${this.thread.id}, its eye ${this.unit(swingEyeSizes(this.thread).thickness)} thick. Sizes are DIN 444 form B's for metric threads, interpolated by diameter for inch ones. Length is under the eye, whose bottom goes on the click. ${BOLT_NOTE}`;
  }

  private swing(): SwingEyeBolt {
    return { shank: this.shank(), inside: this.len("inside"), outside: this.len("outside"), thickness: swingEyeSizes(this.thread).thickness };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const s = this.swing();
    this.problem = swingEyeProblem(s);
    return this.problem ? null : swingEyeBolt(s, view, beyond);
  }

  override solid(): Solid | null {
    const s = this.swing();
    return swingEyeProblem(s) ? null : onLayer(swingEyeSolid(s));
  }
}

export class TBoltTool extends BoltTool {
  readonly id = "tbolt";
  protected readonly label = "T-Bolt";
  protected readonly noun = "T-bolt";
  protected readonly views: readonly View<BoltView>[] = BOLT_VIEWS.filter((v) => v.id !== "side");
  protected readonly threads = BOLT_THREADS;
  protected thread = BOLT_THREADS.find((t) => t.id === "1/2-13 UNC") ?? BOLT_THREADS[0];
  protected readonly hasLocus = false;
  protected readonly fields: readonly BoltField[] = [{ key: "head", label: "Head Size" }, { key: "thickness", label: "Head Thickness" }, ...SHANK_FIELDS];

  protected defaults(t: BoltThread): Lengths {
    return { head: 2 * t.diameter, thickness: 0.7 * t.diameter, ...headed(t) };
  }

  protected note(): string {
    return `Now: ${this.thread.id}. The head is square; no standard tabulates T-bolts' heads, so Head Size starts at twice the thread's diameter and Head Thickness at 0.7 of it. Thread length is ISO 4014's or ASME B18.2.1's; the bearing face goes on the click. Front looks across the shank, Top and Bottom down and up it; lengths left as shown follow a new Size.`;
  }

  private tee(): TBolt {
    return { shank: this.shank(), head: this.len("head"), thickness: this.len("thickness") };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const b = this.tee();
    this.problem = tBoltProblem(b);
    return this.problem ? null : tBolt(b, view, beyond);
  }

  override solid(): Solid | null {
    const b = this.tee();
    return tBoltProblem(b) ? null : onLayer(tBoltSolid(b));
  }
}

export class UBoltTool extends BoltTool {
  readonly id = "ubolt";
  protected readonly label = "U-Bolt";
  protected readonly noun = "U-bolt";
  protected readonly threads = BOLT_THREADS;
  protected thread = BOLT_THREADS.find((t) => t.id === "3/8-16 UNC") ?? BOLT_THREADS[0];
  protected readonly fields: readonly BoltField[] = [{ key: "inside", label: "Inside Distance" }, ...SHANK_FIELDS];

  protected defaults(t: BoltThread): Lengths {
    return { inside: 6 * t.diameter, length: 9 * t.diameter, threadLength: boltThreadLength(t, 6 * t.diameter) };
  }

  protected note(): string {
    return `Now: ${this.thread.id}. Inside Distance is between the legs, Length from the inside of the bend to the legs' ends; the bend's centre goes on the click. Lengths start at six and nine diameters, the thread ISO 4014's or ASME B18.2.1's. ${BOLT_NOTE}`;
  }

  private u(): UBolt {
    return { thread: this.thread, inside: this.len("inside"), length: this.len("length"), threadLength: this.len("threadLength"), display: this.display };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const u = this.u();
    this.problem = uBoltProblem(u);
    return this.problem ? null : uBolt(u, view, beyond);
  }

  override solid(): Solid | null {
    const u = this.u();
    return uBoltProblem(u) ? null : onLayer(uBoltSolid(u));
  }
}

export class JBoltTool extends BoltTool {
  readonly id = "jbolt";
  protected readonly label = "J-Bolt";
  protected readonly noun = "J-bolt";
  protected readonly threads = BOLT_THREADS;
  protected thread = BOLT_THREADS.find((t) => t.id === "1/2-13 UNC") ?? BOLT_THREADS[0];
  protected readonly hasLocus = false;
  protected readonly fields: readonly BoltField[] = [
    ...SHANK_FIELDS,
    { key: "bend", label: "Bend Radius" },
    { key: "anchor", label: "Anchor Length" },
    { key: "bearing", label: "Bearing Length", late: true },
  ];
  private nut: JNut = "none";
  private washer: JWasher = "none";
  private lockWasher = false;
  private right = false;

  protected defaults(t: BoltThread): Lengths {
    const D = t.diameter;
    return { length: 16 * D, threadLength: boltThreadLength(t, 14 * D), bend: D, anchor: 4 * D, bearing: 1.5 * D };
  }

  protected choices(): { before: PrefField[]; after: PrefField[] } {
    return {
      before: [],
      after: [
        { kind: "choice", key: "nut", label: "Add Nut", value: this.nut, options: [NONE, { value: "hex", label: "Hex Nut" }, { value: "square", label: "Square Nut" }] },
        { kind: "check", key: "lock", label: "Add Lock Washer", value: this.lockWasher },
        { kind: "choice", key: "washer", label: "Add Washer", value: this.washer, options: [NONE, { value: "narrow", label: "Narrow" }, { value: "regular", label: "Regular" }, { value: "wide", label: "Wide" }] },
        { kind: "check", key: "right", label: "Anchor to the right", value: this.right },
      ],
    };
  }

  protected read(v: PrefValues): void {
    const nut = v.choice("nut");
    this.nut = nut === "hex" || nut === "square" ? nut : "none";
    const washer = v.choice("washer");
    this.washer = washer === "narrow" || washer === "regular" || washer === "wide" ? washer : "none";
    this.lockWasher = v.flag("lock");
    this.right = v.flag("right");
  }

  protected note(): string {
    return `Now: ${this.thread.id}. Length runs from the threaded end (on the click) to the bottom of the bend, Bend Radius is the bend's inside, Anchor Length from the shank's back to the anchor's end. Bearing Length runs from the threaded end down to the face the washers or nut bear on, and stays as they're added or taken away; Vectorworks also drags them by a control point. Nuts and washers are drawn in proportion to the thread: hex and square nuts 1.5 and 1.625 diameters across their flats and 0.875 high (ASME B18.2.2), plain washers 2, 2.5 or 3 across and 0.2 thick, a spring lock washer 1.75 across and 0.25 thick. ${BOLT_NOTE}`;
  }

  private j(): JBolt {
    return {
      thread: this.thread,
      length: this.len("length"),
      threadLength: this.len("threadLength"),
      bend: this.len("bend"),
      anchor: this.len("anchor"),
      display: this.display,
      right: this.right,
      nut: this.nut,
      lockWasher: this.lockWasher,
      washer: this.washer,
      bearing: this.len("bearing"),
    };
  }

  protected bolt(view: BoltView, beyond: number | null): BoltDrawing | null {
    const j = this.j();
    this.problem = jBoltProblem(j);
    return this.problem ? null : jBolt(j, view, beyond);
  }

  override solid(): Solid | null {
    const j = this.j();
    return jBoltProblem(j) ? null : onLayer(jBoltSolid(j));
  }
}

const THUMB_VIEWS: readonly View<ThumbView>[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
];
const THUMB_TYPES: readonly { value: ThumbType; label: string }[] = [
  { value: "aRegular", label: "Type A Regular" },
  { value: "aHeavy", label: "Type A Heavy" },
  { value: "bRegular", label: "Type B Regular" },
  { value: "bHeavy", label: "Type B Heavy" },
];
const THUMB_POINTS: readonly { value: ThumbPoint; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "cup", label: "Cup/Flat" },
  { value: "dog", label: "Dog" },
  { value: "oval", label: "Oval" },
  { value: "cone", label: "Cone" },
];
/** every thread a type comes in, smallest first */
const THUMB_THREADS = [...new Map(Object.values(THUMB_SIZES).flat().map((s) => [s.thread.id, s.thread])).values()].sort((a, b) => a.diameter - b.diameter);

export class ThumbScrewTool extends PinTool<ThumbView> {
  readonly id = "thumbscrew";
  protected readonly label = "Thumb Screw (Inch)";
  protected readonly noun = "thumb screw";
  protected view: ThumbView = "front";
  protected readonly views = THUMB_VIEWS;
  private type: ThumbType = "aRegular";
  private size = THUMB_SIZES.aRegular[4];
  private point: ThumbPoint = "plain";
  private length = 0.75 * INCH;
  private increments = true;
  private display: ThreadDisplay = "asme";

  async preferences(): Promise<void> {
    const s = this.size;
    const v = await toolPrefs(
      "Thumb Screw (Inch) Preferences",
      [
        { kind: "choice", key: "type", label: "Screw Type", value: this.type, options: THUMB_TYPES },
        { kind: "choice", key: "size", label: "Size", value: s.thread.id, options: THUMB_THREADS.map((t) => ({ value: t.id, label: t.id })) },
        { kind: "choice", key: "point", label: "Point Type", value: this.point, options: THUMB_POINTS },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${THUMB_TYPES.find((t) => t.value === this.type)!.label} ${s.thread.id} (ASME B18.17), head ${ref(s.head / INCH)} in across and ${ref(s.height / INCH)} in high, lengths ${ref(s.shortest / INCH)} to ${ref(s.longest / INCH)} in. Type A Regular comes in #6 to 3/8, Type A Heavy and Type B Heavy #10 to 1/2, Type B Regular #6 to 1/2: a size the type doesn't come in moves to its nearest. Length is under the head; Use Standard Length Increments rounds it to ASME B18.6.3's steps within the size's lengths. Points are in proportion to the thread, as ASME B18.3's set screws'. Front faces the head, Side looks at its edge, Top down on it.`,
    );
    if (!v) return;
    const type = THUMB_TYPES.find((t) => t.value === v.choice("type"))?.value ?? this.type;
    const sizes = THUMB_SIZES[type];
    const thread = THUMB_THREADS.find((t) => t.id === v.choice("size")) ?? s.thread;
    this.type = type;
    this.size = sizes.reduce((best, c) => (Math.abs(c.thread.diameter - thread.diameter) < Math.abs(best.thread.diameter - thread.diameter) ? c : best));
    this.point = THUMB_POINTS.find((p) => p.value === v.choice("point"))?.value ?? this.point;
    this.length = v.num("length");
    this.increments = v.flag("increments");
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: ThumbView, beyond: number | null): FastenerDrawing | null {
    const length = this.increments ? thumbLength(this.size, this.length) : this.length;
    this.problem = thumbProblem(this.size, length, this.point);
    return this.problem ? null : thumbScrew(this.type, this.size, length, this.point, this.display, view, beyond);
  }

  override solid(): Solid | null {
    const length = this.increments ? thumbLength(this.size, this.length) : this.length;
    return thumbProblem(this.size, length, this.point) ? null : onLayer(thumbScrewSolid(this.type, this.size, length, this.point, this.display));
  }
}

const FASTENER_OBJECTS: readonly { id: FastenerObject; label: string }[] = [
  { id: "screw", label: "Screw" },
  { id: "shoulder", label: "Shoulder Screw" },
  { id: "set", label: "Set Screw" },
  { id: "nut", label: "Nut" },
  { id: "washer", label: "Plain Washer" },
  { id: "lock", label: "Lock Washer" },
];
const FASTENER_STANDARDS: readonly { id: FastenerStandard; label: string }[] = [
  { id: "asmeInch", label: "ASME Inch" },
  { id: "asmeMetric", label: "ASME Metric" },
  { id: "iso", label: "ISO" },
  { id: "din", label: "DIN" },
];
const FASTENER_VIEWS: readonly View<FastenerView>[] = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];
type FastenerObject = "screw" | "shoulder" | "set" | "nut" | "washer" | "lock";
/** what the Preferences chose for an object in a standard: its type or series, size and (ISO nuts) form */
type FastenerChoice = { type: string; size: string; washerFace: boolean };
/** what the Preferences chose for a screw in a standard: its type, head style, size and pitch, lengths, and the washers and nut on it (type ids, "" for none) */
type ScrewChoice = {
  type: string;
  rounded: boolean;
  size: string;
  fine: boolean;
  length: number;
  increments: boolean;
  adjust: boolean;
  bearing: number;
  topLock: string;
  topWasher: string;
  bottomWasher: string;
  bottomLock: string;
  nut: string;
  nutFace: boolean;
};
const HEAD_STYLE_OPTIONS = [
  { value: "chamfered", label: "Chamfered" },
  { value: "rounded", label: "Rounded" },
];
const PITCH_OPTIONS = [
  { value: "unc", label: "UNC" },
  { value: "unf", label: "UNF" },
];
/** a screw's first choices in a standard: a 1/2 in or M10 hex bolt 4 in or 50 mm long, nothing on it */
const firstScrew = (standard: FastenerStandard): ScrewChoice => ({
  type: "hexBolt",
  rounded: false,
  size: standard === "asmeInch" ? "1/2" : "M10 × 1.5",
  fine: false,
  length: standard === "asmeInch" ? 2 * INCH : 50,
  increments: true,
  adjust: true,
  bearing: standard === "asmeInch" ? 1.25 * INCH : 30,
  topLock: "",
  topWasher: "",
  bottomWasher: "",
  bottomLock: "",
  nut: "",
  nutFace: false,
});
/** what the Preferences chose for a set screw in a standard: its head and point type, size and pitch, and length */
type SetChoice = { head: SetHead; point: SetPoint; size: string; fine: boolean; length: number; increments: boolean };
/** a set screw's first choices in a standard: a 1/4 in or M6 hex socket cup point 1/2 in or 10 mm long */
const firstSet = (standard: FastenerStandard): SetChoice => ({
  head: "hex",
  point: standard === "asmeInch" || standard === "asmeMetric" ? "cupFlat" : "cup",
  size: standard === "asmeInch" ? "1/4" : "M6 × 1",
  fine: false,
  length: standard === "asmeInch" ? 0.5 * INCH : 10,
  increments: true,
});
/** what the Preferences chose for a shoulder screw in a standard: its head style, size and shoulder length */
type ShoulderChoice = { style: ShoulderStyle; size: string; length: number; increments: boolean };
/** a shoulder screw's first choices in a standard: a 3/8 in or 10 mm shoulder 1 in or 20 mm long */
const firstShoulder = (standard: FastenerStandard): ShoulderChoice => ({ style: "chamfered", size: standard === "asmeInch" ? "3/8" : "10", length: standard === "asmeInch" ? INCH : 20, increments: true });
const SHOULDER_STYLES: readonly { value: ShoulderStyle; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "chamfered", label: "Chamfered" },
  { value: "rounded", label: "Rounded" },
];

/** the size of a washer type that fits a screw: the one named as it is, or the smallest whose hole takes it */
function washerFor(t: WasherType, s: ScrewSize): (PlainWasher & { readonly id: string }) | null {
  return t.sizes.find((w) => w.id === s.nominal) ?? [...t.sizes].sort((a, b) => a.inside - b.inside).find((w) => w.inside >= s.diameter - 1e-6) ?? null;
}
/** the size of a nut type on a screw's thread: the one of its diameter */
function nutFor(t: NutType, s: ScrewSize): NutSize | null {
  const best = t.sizes.reduce((a, b) => (Math.abs(b.major - s.diameter) < Math.abs(a.major - s.diameter) ? b : a));
  return Math.abs(best.major - s.diameter) <= 0.02 * s.diameter ? best : null;
}

/** the size of `sizes` nearest `id` by its diameter, read from the size's name as the table lists it */
function nearestSize<S extends { readonly id: string }>(sizes: readonly S[], all: readonly { readonly id: string; readonly diameter: number }[], id: string): S {
  const want = all.find((s) => s.id === id)?.diameter ?? 0;
  const across = (s: S): number => all.find((a) => a.id === s.id)?.diameter ?? 0;
  return sizes.find((s) => s.id === id) ?? sizes.reduce((best, s) => (Math.abs(across(s) - want) < Math.abs(across(best) - want) ? s : best));
}

/** The screw, washers and nut a choice makes in a standard, or why they don't come together. */
function screwCombination(standard: FastenerStandard, c: ScrewChoice, type: ScrewType, size: ScrewSize, display: ThreadDisplay, fillet: boolean): Combination | string {
  const head = size.head.kind === "socket" && c.rounded ? { ...size.head, rounded: true } : size.head;
  const thread = screwThread(size, type.inch, c.fine);
  // the washers and nut, sized for the screw
  const missing: string[] = [];
  const washer = (kind: "washer" | "lock", id: string): StackItem[] => {
    const t = (kind === "lock" ? LOCK_TYPES : WASHER_TYPES)[standard].find((w) => w.id === id);
    if (!t) return [];
    const w = washerFor(t, size);
    if (!w) missing.push(`${t.label} ${kind === "lock" ? "lock washers" : "washers"}`);
    return w ? [{ kind, washer: w }] : [];
  };
  const nutType = NUT_TYPES[standard].find((t) => t.id === c.nut);
  const nutSize = nutType ? nutFor(nutType, size) : null;
  if (nutType && !nutSize) missing.push(`${nutType.label} nuts`);
  const top = [...washer("lock", c.topLock), ...washer("washer", c.topWasher)];
  const bottom: StackItem[] = [...washer("washer", c.bottomWasher), ...washer("lock", c.bottomLock), ...(nutType && nutSize ? [{ kind: "nut" as const, nut: nutBody(nutType, nutSize, c.nutFace) }] : [])];
  if (missing.length) return `${missing.join(" and ")} don't come in ${size.nominal}`;
  // the length: what carries the bottom stack (and two threads past a nut), in the standard's steps
  const stack = bottom.reduce((sum, i) => sum + itemHeight(i), 0);
  const needed = bottom.length ? c.bearing + stack + (nutType ? 2 * thread.pitch : 0) : c.length;
  const adjusted = c.adjust && (nutType !== undefined || needed > c.length);
  const raw = adjusted ? needed : c.length;
  const length = c.increments ? standardScrewLength(raw, type.inch, adjusted) : raw;
  return {
    screw: { head, thread, length, threadLength: Math.min(size.threadLength(length), length - underHead(head, thread)), point: "plain" as const, shoulder: null, display, fillet },
    top,
    bearing: c.bearing,
    bottom,
  };
}

/**
 * The Fastener tool: a nut, plain washer or lock washer (the Object modes) in ASME inch, ASME
 * metric, ISO or DIN sizes (the Standard modes), from the front, side, top or bottom (the View
 * modes, keys 1 to 4), each object and standard keeping its own type and size. A size the type
 * doesn't come in moves to its nearest.
 */
export class FastenerTool extends PinTool<FastenerView> {
  readonly id = "fastener";
  protected readonly label = "Fastener";
  protected readonly noun = "fastener";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  private object: FastenerObject = "screw";
  private standard: FastenerStandard = "asmeInch";
  private readonly chosen = new Map<string, FastenerChoice>();
  private readonly screws = new Map<FastenerStandard, ScrewChoice>();
  private readonly setScrews = new Map<FastenerStandard, SetChoice>();
  private readonly shoulders = new Map<FastenerStandard, ShoulderChoice>();
  private display: ThreadDisplay = "asme";
  private fillet = true;

  modes(): readonly ToolModes[] {
    return [
      { label: "Object", options: FASTENER_OBJECTS.map((o) => ({ id: o.id, label: o.label })), active: this.object },
      ...super.modes(),
      { label: "Standard", options: FASTENER_STANDARDS.map((s) => ({ id: s.id, label: s.label })), active: this.standard },
    ];
  }

  setMode(id: string): void {
    const object = FASTENER_OBJECTS.find((o) => o.id === id);
    const standard = FASTENER_STANDARDS.find((s) => s.id === id);
    if (object) this.object = object.id;
    else if (standard) this.standard = standard.id;
    else super.setMode(id);
  }

  /** the types the object comes in, in the standard (screws' are their own) */
  private types(): readonly (NutType | WasherType)[] {
    return (this.object === "nut" ? NUT_TYPES : this.object === "washer" ? WASHER_TYPES : LOCK_TYPES)[this.standard];
  }

  /** the type and size chosen for the object in the standard (its first type's middle size at first) */
  private choice(): { type: NutType | WasherType; size: NutSize | (PlainWasher & { readonly id: string }); washerFace: boolean } {
    const types = this.types();
    const c = this.chosen.get(`${this.object}:${this.standard}`);
    const type = types.find((t) => t.id === c?.type) ?? types[0];
    const sizes: readonly (NutSize | (PlainWasher & { readonly id: string }))[] = type.sizes;
    const size = sizes.find((s) => s.id === c?.size) ?? sizes[Math.floor(sizes.length / 2)];
    return { type, size, washerFace: c?.washerFace ?? false };
  }

  async preferences(): Promise<void> {
    if (this.object === "screw") return this.screwPreferences();
    if (this.object === "set") return this.setPreferences();
    if (this.object === "shoulder") return this.shoulderPreferences();
    const types = this.types();
    const { type, size, washerFace } = this.choice();
    const all = [...new Map(types.flatMap((t) => t.sizes.map((s) => [s.id, s] as const))).values()];
    const diameter = (s: (typeof all)[number]): number => ("major" in s ? s.major : s.inside);
    const sizes = all.map((s) => ({ id: s.id, diameter: diameter(s) })).sort((a, b) => a.diameter - b.diameter);
    const nutType = this.object === "nut" ? (type as NutType) : null;
    const standardLabel = FASTENER_STANDARDS.find((s) => s.id === this.standard)!.label;
    const objectLabel = FASTENER_OBJECTS.find((o) => o.id === this.object)!.label;
    const v = await toolPrefs(
      `${objectLabel} Preferences`,
      [
        ...(types.length > 1 ? [{ kind: "choice" as const, key: "type", label: this.object === "nut" ? "Type" : this.object === "washer" ? "Type/Series" : "Series", value: type.id, options: types.map((t) => ({ value: t.id, label: t.label })) }] : []),
        { kind: "choice", key: "size", label: "Size", value: size.id, options: sizes.map((s) => ({ value: s.id, label: s.id })) },
        ...(types.some((t) => "forms" in t && t.forms) ? [{ kind: "choice" as const, key: "form", label: "Form", value: washerFace ? "washer" : "regular", options: [{ value: "regular", label: "Regular" }, { value: "washer", label: "Washer Face" }] }] : []),
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${type.label.startsWith(standardLabel) ? "" : `${standardLabel} `}${type.label} ${size.id} (${type.standard}), ${this.describe(type, size, washerFace)}. A size the type doesn't come in moves to its nearest${nutType && types.some((t) => "forms" in t && t.forms) ? "; Form applies to the hex styles that come washer faced" : ""}. Front and Side look across the axis${nutType ? " (a hex nut's corners and flats)" : ""}, Top and Bottom along it.`,
    );
    if (!v) return;
    const chosenType = types.find((t) => t.id === v.choice("type")) ?? type;
    const typeSizes: readonly { readonly id: string }[] = chosenType.sizes;
    this.chosen.set(`${this.object}:${this.standard}`, { type: chosenType.id, size: nearestSize(typeSizes, sizes, v.choice("size") || size.id).id, washerFace: v.choice("form") === "washer" });
    this.centreLines = v.flag("centre");
  }

  /** the size's main dimensions, in its standard's units */
  private describe(type: NutType | WasherType, size: NutSize | (PlainWasher & { readonly id: string }), washerFace: boolean): string {
    const u = (mm: number): string => (this.standard === "asmeInch" ? `${ref(mm / INCH)} in` : `${ref(mm)} mm`);
    if ("major" in size) {
      const face = washerFace && "forms" in type && type.forms && size.face ? `, washer face ${u(size.face.diameter)} across` : "";
      return `${u(size.flats)} across the flats, ${u(size.height)} high${face}${size.slots ? `, slots ${u(size.slots.width)} wide` : ""}`;
    }
    return `${u(size.inside)} inside, ${u(size.outside)} outside, ${u(size.thickness)} thick`;
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    if (this.object === "screw") return this.screwDrawing(view, beyond);
    if (this.object === "set") return this.setDrawing(view, beyond);
    if (this.object === "shoulder") return this.shoulderDrawing(view, beyond);
    const { type, size, washerFace } = this.choice();
    if ("major" in size) {
      const n = nutBody(type as NutType, size, washerFace);
      this.problem = nutProblem(n);
      return this.problem ? null : nut(n, view, beyond);
    }
    if (this.object === "lock") {
      this.problem = lockProblem(size);
      return this.problem ? null : lockWasher(size, view, beyond);
    }
    this.problem = washerProblem(size);
    return this.problem ? null : plainWasher(size, view, beyond);
  }

  /** the screw chosen in the standard: its choices, type, size (its type's nearest to the one asked for) and thread */
  private screwNow(): { c: ScrewChoice; type: ScrewType; size: ScrewSize } {
    const c = this.screws.get(this.standard) ?? firstScrew(this.standard);
    const types = SCREW_TYPES[this.standard];
    const type = types.find((t) => t.id === c.type) ?? types[0];
    const want = types.flatMap((t) => t.sizes).find((s) => s.id === c.size)?.diameter ?? 0;
    const size = type.sizes.find((s) => s.id === c.size) ?? type.sizes.reduce((a, b) => (Math.abs(b.diameter - want) < Math.abs(a.diameter - want) ? b : a));
    return { c, type, size };
  }

  private async screwPreferences(): Promise<void> {
    const { c, type, size } = this.screwNow();
    const types = SCREW_TYPES[this.standard];
    const inch = this.standard === "asmeInch";
    const sizes = [...new Map(types.flatMap((t) => t.sizes.map((s) => [s.id, s] as const))).values()].sort((a, b) => a.diameter - b.diameter);
    const none = { value: "", label: "None" };
    const list = (ts: readonly { id: string; label: string }[]) => [none, ...ts.map((t) => ({ value: t.id, label: t.label }))];
    const nutTypes = NUT_TYPES[this.standard];
    const standardLabel = FASTENER_STANDARDS.find((s) => s.id === this.standard)!.label;
    const thread = screwThread(size, type.inch, c.fine);
    const v = await toolPrefs(
      "Screw Preferences",
      [
        { kind: "choice", key: "type", label: "Screw/Bolt Type", value: type.id, options: types.map((t) => ({ value: t.id, label: t.label })) },
        ...(inch ? [] : [{ kind: "choice" as const, key: "style", label: "Head Style", value: c.rounded ? "rounded" : "chamfered", options: HEAD_STYLE_OPTIONS }]),
        { kind: "choice", key: "size", label: "Size", value: size.id, options: sizes.map((s) => ({ value: s.id, label: s.id })) },
        ...(inch ? [{ kind: "choice" as const, key: "pitch", label: "Thread Pitch", value: c.fine ? "unf" : "unc", options: PITCH_OPTIONS }] : []),
        { kind: "length", key: "length", label: "Screw Length", value: c.length },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: c.increments },
        { kind: "check", key: "adjust", label: "Adjust Screw Length Automatically", value: c.adjust },
        { kind: "choice", key: "topLock", label: "Top Lock Washer", value: c.topLock, options: list(LOCK_TYPES[this.standard]) },
        { kind: "choice", key: "topWasher", label: "Top Washer", value: c.topWasher, options: list(WASHER_TYPES[this.standard]) },
        { kind: "length", key: "bearing", label: "Bearing Length", value: c.bearing },
        { kind: "choice", key: "bottomWasher", label: "Bottom Washer", value: c.bottomWasher, options: list(WASHER_TYPES[this.standard]) },
        { kind: "choice", key: "bottomLock", label: "Bottom Lock Washer", value: c.bottomLock, options: list(LOCK_TYPES[this.standard]) },
        { kind: "choice", key: "nut", label: "Nut", value: c.nut, options: list(nutTypes) },
        ...(nutTypes.some((t) => t.forms) ? [{ kind: "choice" as const, key: "nutForm", label: "Nut Form", value: c.nutFace ? "washer" : "regular", options: [{ value: "regular", label: "Regular" }, { value: "washer", label: "Washer Face" }] }] : []),
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        { kind: "check", key: "fillet", label: "Draw Underhead Fillet", value: this.fillet },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${standardLabel} ${type.label} ${thread.id} (${type.standard}), ${this.screwHead(type, size)}. A size the type doesn't come in moves to its nearest. Screw Length is under the head (a countersunk head's overall); the thread is the standard's length for it. Top washers sit under the head, the lock washer nearest it; Bearing Length runs from the head's bearing face to where the bottom washer, lock washer and nut stack. Use Standard Length Increments rounds the length to the standard's steps; Adjust Screw Length Automatically lengthens it to carry the nut and two threads past it (or the bottom washers), and never leaves Bearing Length longer than the screw. Washers and nuts take the screw's size. Front and Side look across the shank (a hex head's corners and flats), Top and Bottom along it.`,
    );
    if (!v) return;
    const chosen = types.find((t) => t.id === v.choice("type")) ?? type;
    const pick = (key: string, from: readonly { id: string }[]): string => (from.some((t) => t.id === v.choice(key)) ? v.choice(key) : "");
    this.screws.set(this.standard, {
      type: chosen.id,
      rounded: v.choice("style") === "rounded",
      size: nearestSize(chosen.sizes, sizes, v.choice("size") || size.id).id,
      fine: v.choice("pitch") === "unf",
      length: v.num("length"),
      increments: v.flag("increments"),
      adjust: v.flag("adjust"),
      bearing: v.num("bearing"),
      topLock: pick("topLock", LOCK_TYPES[this.standard]),
      topWasher: pick("topWasher", WASHER_TYPES[this.standard]),
      bottomWasher: pick("bottomWasher", WASHER_TYPES[this.standard]),
      bottomLock: pick("bottomLock", LOCK_TYPES[this.standard]),
      nut: pick("nut", nutTypes),
      nutFace: v.choice("nutForm") === "washer",
    });
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    this.fillet = v.flag("fillet");
    this.centreLines = v.flag("centre");
  }

  /** a screw head's main dimensions, in its standard's units */
  private screwHead(type: ScrewType, size: ScrewSize): string {
    const u = (mm: number): string => (type.inch ? `${ref(mm / INCH)} in` : `${ref(mm)} mm`);
    const h = size.head;
    const across = h.kind === "hex" || h.kind === "hexFlange" || h.kind === "square" ? "across the flats" : "across";
    return `head ${u(h.width)} ${across}, ${u(h.height)} high${h.flange ? `, flange ${u(h.flange.diameter)}` : ""}${h.socket ? `, ${u(h.socket.flats)} socket` : ""}${h.slot ? `, slot ${u(h.slot.width)} wide` : ""}`;
  }

  private screwDrawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const { c, type, size } = this.screwNow();
    const combo = screwCombination(this.standard, c, type, size, this.display, this.fillet);
    this.problem = typeof combo === "string" ? combo : combinationProblem(combo);
    return this.problem || typeof combo === "string" ? null : combination(combo, view, beyond);
  }

  /** the set screw chosen in the standard: its choices, head type and size (the type's nearest to the one asked for) */
  private setNow(): { c: SetChoice; type: SetScrewType; size: SetScrewSize } {
    const c = this.setScrews.get(this.standard) ?? firstSet(this.standard);
    const types = SET_SCREW_TYPES[this.standard];
    const type = types.find((t) => t.id === c.head) ?? types[0];
    const want = types.flatMap((t) => t.sizes).find((s) => s.id === c.size)?.diameter ?? 0;
    const size = type.sizes.find((s) => s.id === c.size) ?? type.sizes.reduce((a, b) => (Math.abs(b.diameter - want) < Math.abs(a.diameter - want) ? b : a));
    return { c, type, size };
  }

  private async setPreferences(): Promise<void> {
    const { c, type, size } = this.setNow();
    const types = SET_SCREW_TYPES[this.standard];
    const points = SET_POINT_CHOICES[this.standard];
    const inch = this.standard === "asmeInch";
    const sizes = [...new Map(types.flatMap((t) => t.sizes.map((s) => [s.id, s] as const))).values()].sort((a, b) => a.diameter - b.diameter);
    const standardLabel = FASTENER_STANDARDS.find((s) => s.id === this.standard)!.label;
    const thread = screwThread(size, type.inch, c.fine);
    const point = points.includes(c.point) ? c.point : points[0];
    const ranges = types.map((t) => `${t.label} ${t.sizes[0].nominal} to ${t.sizes[t.sizes.length - 1].nominal}`).join(", ");
    const v = await toolPrefs(
      "Set Screw Preferences",
      [
        ...(types.length > 1 ? [{ kind: "choice" as const, key: "head", label: "Head Type", value: type.id, options: types.map((t) => ({ value: t.id, label: t.label })) }] : []),
        { kind: "choice", key: "point", label: "Point Type", value: point, options: points.map((p) => ({ value: p, label: SET_POINTS[p] })) },
        { kind: "choice", key: "size", label: "Size", value: size.id, options: sizes.map((s) => ({ value: s.id, label: s.id })) },
        ...(inch ? [{ kind: "choice" as const, key: "pitch", label: "Thread Pitch", value: c.fine ? "unf" : "unc", options: PITCH_OPTIONS }] : []),
        { kind: "length", key: "length", label: "Length", value: c.length },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: c.increments },
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${standardLabel} ${type.label} ${SET_POINTS[point]} Point ${thread.id} (${type.standard(point)}). The head types come in ${ranges}: a size the type doesn't come in moves to its nearest. Length is overall (a square head's under the head); Use Standard Length Increments rounds it to the standard's steps. Sockets, slots and points are the standard's sizes for the length: a short screw has a shallower socket and a blunter cone. Front looks along a slot, Side across it, Top at the socket or slot end, Bottom at the point.`,
    );
    if (!v) return;
    const chosen = types.find((t) => t.id === v.choice("head")) ?? type;
    this.setScrews.set(this.standard, {
      head: chosen.id,
      point: points.find((p) => p === v.choice("point")) ?? point,
      size: nearestSize(chosen.sizes, sizes, v.choice("size") || size.id).id,
      fine: v.choice("pitch") === "unf",
      length: v.num("length"),
      increments: v.flag("increments"),
    });
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    this.centreLines = v.flag("centre");
  }

  private setDrawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const { c, type, size } = this.setNow();
    const points = SET_POINT_CHOICES[this.standard];
    const pointType = points.includes(c.point) ? c.point : points[0];
    const length = c.increments ? standardSetLength(c.length, type.inch) : c.length;
    const point = size.point(pointType, length);
    if (!point) {
      this.problem = `${type.label} set screws don't come in ${size.nominal} with a ${SET_POINTS[pointType]} point`;
      return null;
    }
    const thread = screwThread(size, type.inch, c.fine);
    const head = size.head(length, pointType);
    // a square head's length is under it, its neck relief first
    const shank = size.neck ? length - size.neck.width : length;
    const s: Screw = {
      head,
      thread,
      length: shank,
      threadLength: shank - underHead(head, thread),
      point: point.shape,
      pointSize: point.size,
      shoulder: size.neck ? { diameter: size.neck.diameter, length: size.neck.width } : null,
      display: this.display,
      fillet: false,
    };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }

  /** the shoulder screw chosen in the standard: its choices and size */
  private shoulderNow(): { c: ShoulderChoice; size: ShoulderSize } {
    const c = this.shoulders.get(this.standard) ?? firstShoulder(this.standard);
    const sizes = SHOULDER_TYPES[this.standard].sizes;
    return { c, size: sizes.find((s) => s.id === c.size) ?? sizes[Math.floor(sizes.length / 2)] };
  }

  private async shoulderPreferences(): Promise<void> {
    const { c, size } = this.shoulderNow();
    const type = SHOULDER_TYPES[this.standard];
    const u = (mm: number): string => (type.inch ? `${ref(mm / INCH)} in` : `${ref(mm)} mm`);
    const standardLabel = FASTENER_STANDARDS.find((s) => s.id === this.standard)!.label;
    const v = await toolPrefs(
      "Shoulder Screw Preferences",
      [
        ...(type.styles ? [{ kind: "choice" as const, key: "style", label: "Head Style", value: c.style, options: SHOULDER_STYLES }] : []),
        { kind: "choice", key: "size", label: "Size", value: size.id, options: type.sizes.map((s) => ({ value: s.id, label: s.label })) },
        { kind: "length", key: "length", label: "Length", value: c.length },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: c.increments },
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        ...(type.fillet ? [{ kind: "check" as const, key: "fillet", label: "Draw Underhead Fillet", value: this.fillet }] : []),
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${standardLabel} shoulder screw, ${u(size.shoulder)} shoulder on ${size.thread.id} (${type.standard}), head ${u(size.head.width)} across and ${u(size.head.height)} high, ${u(size.head.socket!.flats)} socket, thread ${u(size.threadLength)} long. Size is the shoulder's diameter, Length the shoulder's, from under the head; Use Standard Length Increments rounds it to the standard's steps. Front and Side look across the shank, Top at the head, Bottom at the thread's end.`,
    );
    if (!v) return;
    const style = SHOULDER_STYLES.find((s) => s.value === v.choice("style"))?.value ?? c.style;
    this.shoulders.set(this.standard, { style, size: v.choice("size") || size.id, length: v.num("length"), increments: v.flag("increments") });
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    if (type.fillet) this.fillet = v.flag("fillet");
    this.centreLines = v.flag("centre");
  }

  private shoulderDrawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const { c, size } = this.shoulderNow();
    const type = SHOULDER_TYPES[this.standard];
    const length = c.increments ? standardShoulderLength(c.length, type.inch) : c.length;
    // ISO's head edge is plain, chamfered or rounded as Head Style says
    const head = type.styles ? { ...size.head, edge: c.style === "plain" ? 0 : size.head.edge, rounded: c.style === "rounded" } : size.head;
    const s: Screw = {
      head,
      thread: size.thread,
      length: size.threadLength,
      threadLength: size.threadLength - size.undercut.width,
      point: "plain",
      shoulder: { diameter: size.shoulder, length, undercut: size.undercut },
      display: this.display,
      fillet: type.fillet && this.fillet,
    };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }
}

const SERIES = [
  { value: "inch", label: "Inch" },
  { value: "metric", label: "Metric" },
];
/** the size of `sizes` nearest `diameter` across */
const nearestDetail = <S extends DetailSize>(sizes: readonly S[], diameter: number): S =>
  sizes.reduce((a, b) => (Math.abs(b.thread.diameter - diameter) < Math.abs(a.thread.diameter - diameter) ? b : a));
const inchesOrMm = (inch: boolean) => (mm: number): string => (inch ? `${ref(mm / INCH)} in` : `${ref(mm)} mm`);

const BOLT_NUT_WASHERS: readonly { readonly value: string; readonly label: string; readonly inch: string; readonly mm: string }[] = [
  { value: "narrow", label: "Narrow", inch: "bNarrow", mm: "small" },
  { value: "regular", label: "Regular", inch: "bRegular", mm: "normal" },
  { value: "wide", label: "Wide", inch: "bWide", mm: "large" },
];
const BOLT_NUT_THREADS: readonly { readonly value: ThreadDisplay; readonly label: string }[] = [
  { value: "asme", label: "Simplified" },
  { value: "schematic", label: "Schematic" },
  { value: "detailed", label: "Detailed" },
];

/**
 * Detailing's Bolt and Nut: a bolt through a joint of its Bearing Length, with the washers and nut
 * chosen, its length following them or typed, drawn in the view chosen; its 3D twin (at the end of
 * this file) adds the solid. The head's bearing face is on the click. The inch tool's bolt and nut
 * are hex or square, the mm tool's hex.
 */
abstract class BoltAndNutTool extends PinTool<FastenerView> {
  protected readonly noun = "bolt and nut";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  protected abstract readonly standard: FastenerStandard;
  private choice: ScrewChoice | null = null;
  private square = false;
  private squareNut = false;
  private washerType = "regular";
  private topWasher = true;
  private topLock = false;
  private bottomWasher = true;
  private bottomLock = false;
  private withNut = true;
  private display: ThreadDisplay = "asme";

  private inch(): boolean {
    return this.standard === "asmeInch";
  }

  private type(): ScrewType {
    const types = SCREW_TYPES[this.standard];
    return types.find((t) => t.id === (this.square ? "squareBolt" : "hexBolt")) ?? types[0];
  }

  /** what's chosen, as the Fastener tool keeps a screw's choices */
  private now(): { c: ScrewChoice; size: ScrewSize } {
    const base = (this.choice ??= firstScrew(this.standard));
    const type = this.type();
    const size = type.sizes.find((s) => s.id === base.size) ?? type.sizes[Math.floor(type.sizes.length / 2)];
    const series = BOLT_NUT_WASHERS.find((w) => w.value === this.washerType) ?? BOLT_NUT_WASHERS[1];
    const washer = this.inch() ? series.inch : series.mm;
    return {
      size,
      c: {
        ...base,
        type: type.id,
        size: size.id,
        topWasher: this.topWasher ? washer : "",
        topLock: this.topLock ? "regular" : "",
        bottomWasher: this.bottomWasher ? washer : "",
        bottomLock: this.bottomLock ? "regular" : "",
        nut: !this.withNut ? "" : !this.inch() ? "style1" : this.squareNut ? "square" : "hex",
      },
    };
  }

  private combo(): Combination | null {
    const { c, size } = this.now();
    const combo = screwCombination(this.standard, c, this.type(), size, this.display, false);
    this.problem = typeof combo === "string" ? combo : combinationProblem(combo);
    return this.problem || typeof combo === "string" ? null : combo;
  }

  async preferences(): Promise<void> {
    const { c, size } = this.now();
    const inch = this.inch();
    const shapes = (noun: string) => [
      { value: "hex", label: `Hex ${noun}` },
      { value: "square", label: `Square ${noun}` },
    ];
    const v = await toolPrefs(
      `${this.label} Preferences`,
      [
        ...(inch
          ? [
              { kind: "choice" as const, key: "bolt", label: "Bolt Type", value: this.square ? "square" : "hex", options: shapes("Bolt") },
              { kind: "choice" as const, key: "nutType", label: "Nut Type", value: this.squareNut ? "square" : "hex", options: shapes("Nut") },
            ]
          : []),
        { kind: "choice", key: "washer", label: "Washer Type", value: this.washerType, options: BOLT_NUT_WASHERS.map(({ value, label }) => ({ value, label })) },
        { kind: "choice", key: "size", label: "Bolt Size", value: size.id, options: this.type().sizes.map((s) => ({ value: s.id, label: s.id })) },
        { kind: "length", key: "bearing", label: "Bearing Length", value: c.bearing },
        { kind: "length", key: "length", label: "Bolt Length", value: c.length },
        { kind: "choice", key: "threads", label: "Thread Style", value: this.display, options: BOLT_NUT_THREADS },
        { kind: "check", key: "topWasher", label: "Top Washer", value: this.topWasher },
        { kind: "check", key: "topLock", label: "Top Lock Washer", value: this.topLock },
        { kind: "check", key: "bottomWasher", label: "Bottom Washer", value: this.bottomWasher },
        { kind: "check", key: "bottomLock", label: "Bottom Lock Washer", value: this.bottomLock },
        { kind: "check", key: "nut", label: "Nut", value: this.withNut },
        { kind: "check", key: "standard", label: "Use Standard Lengths", value: c.increments },
        { kind: "check", key: "adjust", label: "Adjust Bolt Length", value: c.adjust },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Sizes are ${inch ? "ASME B18.2.1's bolts, B18.2.2's nuts, B18.22.1's Type B washers and B18.21.1's lock washers" : "ISO 4014's bolts, ISO 4032's nuts, ISO 7092, 7089 and 7093-1's washers and ASME B18.21.2M's lock washers"}. Adjust Bolt Length makes the bolt carry the joint, its washers and nut and two threads past it; Use Standard Lengths takes the next standard length.`,
    );
    if (!v) return;
    if (inch) {
      this.square = v.choice("bolt") === "square";
      this.squareNut = v.choice("nutType") === "square";
    }
    this.washerType = v.choice("washer");
    const threads = v.choice("threads");
    this.display = threads === "schematic" || threads === "detailed" ? threads : "asme";
    this.topWasher = v.flag("topWasher");
    this.topLock = v.flag("topLock");
    this.bottomWasher = v.flag("bottomWasher");
    this.bottomLock = v.flag("bottomLock");
    this.withNut = v.flag("nut");
    this.centreLines = v.flag("centre");
    this.choice = { ...c, size: v.choice("size"), bearing: v.num("bearing"), length: v.num("length"), increments: v.flag("standard"), adjust: v.flag("adjust") };
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const combo = this.combo();
    return combo && combination(combo, view, beyond);
  }

  override solid(): Solid | null {
    const combo = this.combo();
    return combo && combinationSolid(combo);
  }
}

class BoltAndNutInch extends BoltAndNutTool {
  readonly id = "boltnutinch";
  protected readonly label = "Bolt and Nut - inch";
  protected readonly standard = "asmeInch";
}

class BoltAndNutMm extends BoltAndNutTool {
  readonly id = "boltnutmm";
  protected readonly label = "Bolt and Nut - mm";
  protected readonly standard = "iso";
}

/** Detailing's Carriage Bolt: ASME B18.5's round head bolts, inch, and B18.5.2.2M's and DIN 603's round head square neck bolts, metric. */
export class CarriageBoltTool extends PinTool<FastenerView> {
  readonly id = "carriagebolt";
  protected readonly label = "Carriage Bolt";
  protected readonly noun = "carriage bolt";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  private inch = true;
  private type: CarriageType = "squareNeck";
  private size = "1/2";
  private length = 2 * INCH;
  private increments = true;
  private display: ThreadDisplay = "asme";

  /** the series' type (Round Head Square Neck where the series lacks the one chosen) and its size nearest the one chosen */
  private now(): { bolts: CarriageBolts; size: DetailSize } {
    const bolts = CARRIAGE_BOLTS.find((b) => b.inch === this.inch && b.type === this.type) ?? CARRIAGE_BOLTS.find((b) => b.inch === this.inch && b.type === "squareNeck")!;
    const want = CARRIAGE_BOLTS.flatMap((b) => b.sizes).find((s) => s.id === this.size)?.thread.diameter ?? 0;
    return { bolts, size: bolts.sizes.find((s) => s.id === this.size) ?? nearestDetail(bolts.sizes, want) };
  }

  private lengthNow(inch: boolean): number {
    return this.increments ? standardScrewLength(this.length, inch) : this.length;
  }

  async preferences(): Promise<void> {
    const { bolts, size } = this.now();
    const u = inchesOrMm(bolts.inch);
    const h = size.head;
    const neck = h.neck ? `, square neck ${u(h.neck.flats)} across and ${u(h.neck.depth)} deep` : "";
    const sizes = [...new Map(CARRIAGE_BOLTS.flatMap((b) => b.sizes).map((s) => [s.id, s] as const)).values()].sort((a, b) => Number(b.thread.inch) - Number(a.thread.inch) || a.thread.diameter - b.thread.diameter);
    const length = this.lengthNow(bolts.inch);
    const v = await toolPrefs(
      "Carriage Bolt Preferences",
      [
        { kind: "choice", key: "series", label: "Series", value: this.inch ? "inch" : "metric", options: SERIES },
        { kind: "choice", key: "type", label: "Bolt Type", value: this.type, options: CARRIAGE_TYPES },
        { kind: "choice", key: "size", label: "Size", value: size.id, options: sizes.map((s) => ({ value: s.id, label: s.thread.id })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "choice", key: "display", label: "Thread Style", value: this.display, options: THREAD_DISPLAYS },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${CARRIAGE_TYPES.find((t) => t.value === bolts.type)!.label} ${size.thread.id} (${bolts.standard}), head ${u(h.width)} across and ${u(h.height)} high${neck}, thread ${u(Math.min(length - (h.neck?.depth ?? 0), carriageThreadLength(size.thread, length)))} long. Inch bolts come as Round Head (#10 to 7/8), Round Head Short Square Neck (1/4 to 3/4) and Round Head Square Neck (#10 to 1); metric ones as Round Head Square Neck (M5 to M24) and with Large Head (M5 to M20): a type the series doesn't have becomes Round Head Square Neck, and a size the type doesn't come in moves to its nearest. Length is under the head; Use Standard Length Increments rounds it to the inch steps of 1/4 in to 4 in, 1/2 in to 6 in and inches past, or ISO's lengths. Front and Side look across the neck's corners, Top at the head, Bottom at the thread's end.`,
    );
    if (!v) return;
    this.inch = v.choice("series") !== "metric";
    this.type = CARRIAGE_TYPES.find((t) => t.value === v.choice("type"))?.value ?? this.type;
    this.size = v.choice("size") || size.id;
    this.length = v.num("length");
    this.increments = v.flag("increments");
    const display = v.choice("display");
    this.display = display === "iso" || display === "schematic" || display === "detailed" ? display : "asme";
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const { bolts, size } = this.now();
    const length = this.lengthNow(bolts.inch);
    const neck = size.head.neck?.depth ?? 0;
    const s: Screw = {
      head: size.head,
      thread: size.thread,
      length,
      threadLength: Math.min(length - neck, carriageThreadLength(size.thread, length)),
      point: "plain",
      shoulder: null,
      display: this.display,
      fillet: false,
    };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }

  /** Its head and shank turned, the square neck between them cut to the square. */
  override solid(): Solid | null {
    const front = this.drawing("front", null);
    const bottom = this.drawing("bottom", null);
    if (!front || !bottom) return null;
    return onLayer(
      front.outlines.flatMap((o) => {
        const ys = o.map((p) => p.y);
        return o.length === 4 ? prism([bottom.outlines[0]], Math.min(...ys), Math.max(...ys)) : lathe(axisProfile(o, "y"));
      }),
    );
  }
}

const LAG_HEADS = [
  { value: "hex", label: "Hex" },
  { value: "square", label: "Square" },
];

/** Detailing's Lag Screw: ASME B18.2.1's hex and square lag screws, inch, and B18.2.3.8M's hex ones, metric, threaded to a gimlet point. */
export class LagScrewTool extends PinTool<FastenerView> {
  readonly id = "lagscrew";
  protected readonly label = "Lag Screw";
  protected readonly noun = "lag screw";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  private inch = true;
  private head: LagHead = "hex";
  private size = "3/8";
  private length = 3 * INCH;
  private threads = false;

  /** the series' sizes (hex where Square is chosen for metric) and the one nearest the size chosen */
  private now(): { sizes: readonly LagSize[]; size: LagSize } {
    const sizes = this.inch ? LAG_SCREWS.inch[this.head] : LAG_SCREWS.metric;
    const want = [...LAG_SCREWS.inch.hex, ...LAG_SCREWS.metric].find((s) => s.id === this.size)?.thread.diameter ?? 0;
    return { sizes, size: sizes.find((s) => s.id === this.size) ?? nearestDetail(sizes, want) };
  }

  async preferences(): Promise<void> {
    const { size } = this.now();
    const u = inchesOrMm(this.inch);
    const h = size.head;
    const v = await toolPrefs(
      "Lag Screw Preferences",
      [
        { kind: "choice", key: "series", label: "Series", value: this.inch ? "inch" : "metric", options: SERIES },
        { kind: "choice", key: "head", label: "Head Type", value: this.head, options: LAG_HEADS },
        { kind: "choice", key: "size", label: "Nominal Size", value: size.id, options: [...LAG_SCREWS.inch.hex, ...LAG_SCREWS.metric].map((s) => ({ value: s.id, label: s.id })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "threads", label: "Show Threads", value: this.threads },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${this.inch ? LAG_HEADS.find((l) => l.value === this.head)!.label : "Hex"} lag screw ${size.id} (${this.inch ? "ASME B18.2.1" : "ASME B18.2.3.8M"}), head ${u(h.width)} across the flats and ${u(h.height)} high, ${this.inch ? `${ref(INCH / size.thread.pitch)} threads per inch` : `pitch ${ref(size.thread.pitch)} mm`}, threaded ${u(lagThreadLength(size, this.length))} of the length. Inch sizes are #10 to 1-1/4, metric M5 to M24; square heads come in inch only, so metric ones are hex, and a size of the other series moves to its nearest. Length is under the head; the thread is half the length and 1/2 in, at most 6 in, leaving at least the standard's shoulder plain. The gimlet point tapers over 1.25 diameters, as Vectorworks pictures it. Show Threads draws the thread's crests and roots; without it the root is hidden. Front and Side look across the head's corners and flats, Top at the head, Bottom at the point.`,
    );
    if (!v) return;
    this.inch = v.choice("series") !== "metric";
    this.head = v.choice("head") === "square" ? "square" : "hex";
    this.size = v.choice("size") || size.id;
    this.length = v.num("length");
    this.threads = v.flag("threads");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const { size } = this.now();
    const D = size.thread.diameter;
    const s: Screw = {
      head: size.head,
      thread: size.thread,
      length: this.length,
      threadLength: lagThreadLength(size, this.length),
      point: "plain",
      shoulder: null,
      display: "asme",
      fillet: false,
      wood: { root: size.root, pitch: size.thread.pitch, taper: gimletTaper(D), point: "gimlet", threads: this.threads },
    };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }

  /** Its shank turned, its head cut to its flats. */
  override solid(): Solid | null {
    const front = this.drawing("front", null);
    const top = this.drawing("top", null);
    if (!front || !top) return null;
    return onLayer(front.outlines.flatMap((o) => lathe(axisProfile(o, "y"), Math.min(...o.map((p) => p.y)) >= 0 ? top.outlines[0] : undefined)));
  }
}

/** the size of `sizes` with `id`, or the one nearest across to the size `id` names in `all` */
const nearestNominal = (sizes: readonly ScrewNominal[], all: readonly ScrewNominal[], id: string): ScrewNominal => {
  const want = all.find((s) => s.id === id)?.diameter ?? 0;
  return sizes.find((s) => s.id === id) ?? sizes.reduce((a, b) => (Math.abs(b.diameter - want) < Math.abs(a.diameter - want) ? b : a));
};
const recessNote = (h: ScrewHead, u: (mm: number) => string): string =>
  h.slot ? `, slot ${u(h.slot.width)} wide and ${u(h.slot.depth)} deep` : h.recess ? `, ${h.recess.kind} recess ${u(h.recess.width)} across and ${u(h.recess.depth)} deep` : "";

/** Detailing's Wood Screw: ASME B18.6.1's inch wood screws and DIN's metric ones, threaded to a gimlet point. */
export class WoodScrewTool extends PinTool<FastenerView> {
  readonly id = "woodscrew";
  protected readonly label = "Wood Screw";
  protected readonly noun = "wood screw";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  private inch = true;
  private head: WoodHead = "flat";
  private slot: SlotType = "regular";
  private size = "#8";
  private length = 1.25 * INCH;
  private increments = true;
  private threads = true;

  private now(): ScrewNominal {
    return nearestNominal(this.inch ? WOOD_SIZES.inch : WOOD_SIZES.metric, [...WOOD_SIZES.inch, ...WOOD_SIZES.metric], this.size);
  }

  private lengthNow(): number {
    return this.increments ? standardWoodLength(this.length, this.inch) : this.length;
  }

  async preferences(): Promise<void> {
    const size = this.now();
    const u = inchesOrMm(this.inch);
    const h = woodHead(size, this.head, this.slot);
    const t = woodThread(size);
    const headNote = typeof h === "string" ? `${h}.` : `head ${u(h.width)} across and ${u(h.height + (h.kind === "oval" ? h.crown : 0))} high${recessNote(h, u)}.`;
    const v = await toolPrefs(
      "Wood Screw Preferences",
      [
        { kind: "choice", key: "series", label: "Series", value: this.inch ? "inch" : "metric", options: SERIES },
        { kind: "choice", key: "head", label: "Head Type", value: this.head, options: WOOD_HEADS },
        { kind: "choice", key: "size", label: "Nominal Size", value: size.id, options: [...WOOD_SIZES.inch, ...WOOD_SIZES.metric].map((s) => ({ value: s.id, label: s.label })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "slot", label: "Slot Type", value: this.slot, options: SLOT_TYPES },
        { kind: "check", key: "increments", label: "Use Standard Length Increments", value: this.increments },
        { kind: "check", key: "threads", label: "Show Threads", value: this.threads },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${WOOD_HEADS.find((w) => w.value === this.head)!.label} ${size.label} wood screw (${this.inch ? "ASME B18.6.1" : "DIN 95, 96 and 97, cross recessed DIN 7995, 7996 and 7997"}), ${headNote} Thread ${this.inch ? `${ref(INCH / t.pitch)} per inch` : `${ref(t.pitch)} mm pitch`}, root ${u(t.root)} across, ${this.inch ? "two thirds" : "0.6"} of the length. Inch sizes are #0 to #24 (round heads #2 to #14), metric 1.6 to 10 mm; a size of the other series moves to its nearest. Length is under the head, a flat or oval head's overall from its rim; Use Standard Length Increments rounds it to inch steps or DIN's lengths. DIN gives no pan head or thread pitch, so a metric pan head and thread take the inch ones' proportions at the nearest diameter; a square recess is ASME B18.6.3's for pan heads, scaled to the size. The gimlet point tapers over 1.25 diameters, as Vectorworks pictures it.`,
    );
    if (!v) return;
    this.inch = v.choice("series") !== "metric";
    this.head = WOOD_HEADS.find((w) => w.value === v.choice("head"))?.value ?? this.head;
    this.slot = SLOT_TYPES.find((s) => s.value === v.choice("slot"))?.value ?? this.slot;
    this.size = v.choice("size") || size.id;
    this.length = v.num("length");
    this.increments = v.flag("increments");
    this.threads = v.flag("threads");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const size = this.now();
    const head = woodHead(size, this.head, this.slot);
    if (typeof head === "string") {
      this.problem = head;
      return null;
    }
    const t = woodThread(size);
    const thread: BoltThread = { id: size.label, diameter: size.diameter, pitch: t.pitch, inch: size.inch };
    const length = this.lengthNow();
    const s: Screw = {
      head,
      thread,
      length,
      threadLength: Math.min(woodThreadLength(size, length), length - underHead(head, thread)),
      point: "plain",
      shoulder: null,
      display: "asme",
      fillet: false,
      wood: { root: t.root, pitch: t.pitch, taper: gimletTaper(size.diameter), point: "gimlet", threads: this.threads },
    };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }

  override solid(): Solid | null {
    const turned = this.turned("front", "y");
    return turned && onLayer(turned);
  }
}

/** Detailing's Sheet Metal Screw: ASME B18.6.4's inch tapping screws and ISO's metric ones, with Type A, AB or B points. */
export class SheetMetalScrewTool extends PinTool<FastenerView> {
  readonly id = "sheetmetalscrew";
  protected readonly label = "Sheet Metal Screw";
  protected readonly noun = "sheet metal screw";
  protected view: FastenerView = "front";
  protected readonly views = FASTENER_VIEWS;
  private inch = true;
  private head: TapHead = "pan";
  private slot: SlotType = "cross";
  private point: TapPoint = "ab";
  private size = "#8";
  private length = 0.75 * INCH;
  private threads = true;

  private now(): ScrewNominal {
    return nearestNominal(this.inch ? TAP_SIZES.inch : TAP_SIZES.metric, [...TAP_SIZES.inch, ...TAP_SIZES.metric], this.size);
  }

  /** Type A comes in inch only: metric ones take AB */
  private pointNow(): TapPoint {
    return !this.inch && this.point === "a" ? "ab" : this.point;
  }

  async preferences(): Promise<void> {
    const size = this.now();
    const u = inchesOrMm(this.inch);
    const h = tapHead(size, this.head, this.slot);
    const t = tapThread(size, this.pointNow(), this.threads);
    const headNote = typeof h === "string" ? `${h}.` : `head ${u(h.width)} across${h.kind === "hex" || h.kind === "hexFlange" ? " the flats" : ""} and ${u(h.height + (h.kind === "oval" ? h.crown : 0))} high${recessNote(h, u)}.`;
    const threadNote = typeof t === "string" ? `${t}.` : `Thread ${u(t.diameter)} across, root ${u(t.wood.root)}, ${this.inch ? `${ref(INCH / t.wood.pitch)} per inch` : `${ref(t.wood.pitch)} mm pitch`}, its point tapering over ${u(t.wood.taper)}.`;
    const v = await toolPrefs(
      "Sheet Metal Screw Preferences",
      [
        { kind: "choice", key: "series", label: "Series", value: this.inch ? "inch" : "metric", options: SERIES },
        { kind: "choice", key: "head", label: "Head Type", value: this.head, options: TAP_HEADS },
        { kind: "choice", key: "slot", label: "Slot Type", value: this.slot, options: SLOT_TYPES },
        { kind: "choice", key: "point", label: "Point Type", value: this.point, options: TAP_POINTS },
        { kind: "choice", key: "size", label: "Nominal Size", value: size.id, options: [...TAP_SIZES.inch, ...TAP_SIZES.metric].map((s) => ({ value: s.id, label: s.label })) },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "check", key: "threads", label: "Show Threads", value: this.threads },
        { kind: "check", key: "centre", label: "Show Center Line", value: this.centreLines },
      ],
      `Now: ${TAP_HEADS.find((w) => w.value === this.head)!.label} ${size.label} Type ${this.pointNow().toUpperCase()} (${this.inch ? "ASME B18.6.4" : "ISO 1478"}), ${headNote} ${threadNote} Inch sizes are #0 to 1/2 in, metric ST2.2 to ST9.5; a size of the other series moves to its nearest, and a head or point a size doesn't come in is refused. Type A comes in inch only, so metric screws take AB; metric AB is ISO's pointed type C and B its flat-ended type F. ISO has no truss head, so a metric one takes the inch truss head's proportions; a square recess is ASME B18.6.3's for pan heads, scaled to the size; hex heads take no recess (and ISO's no slot), so they're drawn plain. Length is under the head, a flat or oval head's overall from its rim; the thread runs to the head. A and AB points taper over 1.25 diameters, as Vectorworks pictures them.`,
    );
    if (!v) return;
    this.inch = v.choice("series") !== "metric";
    this.head = TAP_HEADS.find((w) => w.value === v.choice("head"))?.value ?? this.head;
    this.slot = SLOT_TYPES.find((s) => s.value === v.choice("slot"))?.value ?? this.slot;
    this.point = TAP_POINTS.find((p) => p.value === v.choice("point"))?.value ?? this.point;
    this.size = v.choice("size") || size.id;
    this.length = v.num("length");
    this.threads = v.flag("threads");
    this.centreLines = v.flag("centre");
  }

  protected drawing(view: FastenerView, beyond: number | null): FastenerDrawing | null {
    const size = this.now();
    const head = tapHead(size, this.head, this.slot);
    const t = tapThread(size, this.pointNow(), this.threads);
    if (typeof head === "string" || typeof t === "string") {
      this.problem = typeof head === "string" ? head : (t as string);
      return null;
    }
    const thread: BoltThread = { id: size.label, diameter: t.diameter, pitch: t.wood.pitch, inch: size.inch };
    const s: Screw = { head, thread, length: this.length, threadLength: this.length - underHead(head, thread), point: "plain", shoulder: null, display: "asme", fillet: false, wood: t.wood };
    this.problem = screwProblem(s);
    return this.problem ? null : screw(s, view, beyond);
  }

  override solid(): Solid | null {
    const turned = this.turned("front", "y");
    return turned && onLayer(turned);
  }
}

export const ClevisPinInch3DTool = as3D(ClevisPinInchTool, "clevisinch3d", "Clevis Pin (Inch) - 3D", "head");
export const ClevisPinMetric3DTool = as3D(ClevisPinMetricTool, "clevismetric3d", "Clevis Pin (Metric) - 3D", "head");
export const ClevisPinDin3DTool = as3D(ClevisPinDinTool, "clevisdin3d", "Clevis Pin (DIN) - 3D", "head");
export const DowelPin3DTool = as3D(DowelPinTool, "dowelpin3d", "Dowel Pin (Inch) - 3D", "left");
export const ParallelPin3DTool = as3D(ParallelPinTool, "parallelpin3d", "Parallel Pin (DIN) - 3D", "end");
export const TaperPinInch3DTool = as3D(TaperPinInchTool, "taperpininch3d", "Taper Pin (Inch) - 3D", "left");
export const TaperPinDin3DTool = as3D(TaperPinDinTool, "taperpindin3d", "Taper Pin (DIN) - 3D", "end");
export const LargeRivet3DTool = as3D(LargeRivetTool, "rivetlarge3d", "Large Rivet (Inch) - 3D", "top");
export const SmallRivet3DTool = as3D(SmallRivetTool, "rivetsmall3d", "Small Rivet (Inch) - 3D", "top");
export const RivetDin3DTool = as3D(RivetDinTool, "rivetdin3d", "Rivet (DIN) - 3D", "top");
export const TubularRivet3DTool = as3D(TubularRivetTool, "rivettubular3d", "Tubular Rivet (DIN) - 3D", "top");
export const AcornNut3DTool = as3D(AcornNutTool, "acornnut3d", "Acorn Nut (Inch) - 3D", "top");
export const HexCapNut3DTool = as3D(HexCapNutTool, "hexcapnut3d", "Hex Cap Nut (DIN) - 3D", "top");
export const KnurledNutDin3DTool = as3D(KnurledNutDinTool, "knurleddin3d", "Knurled Thumb Nut (DIN) - 3D", "top");
export const KnurledNutInch3DTool = as3D(KnurledNutInchTool, "knurledinch3d", "Knurled Thumb Nut (Inch) - 3D", "top");
export const CotterPin3DTool = as3D(CotterPinTool, "cotterpin3d", "Cotter Pin (Inch) - 3D", "top");
export const WingNutDin3DTool = as3D(WingNutDinTool, "wingdin3d", "Wing Nut (DIN) - 3D", "top");
export const WingNutA3DTool = as3D(WingNutATool, "winga3d", "Wing Nut - Type A (Inch) - 3D", "top");
export const WingNutB3DTool = as3D(WingNutBTool, "wingb3d", "Wing Nut - Type B (Inch) - 3D", "top");
export const WingNutC3DTool = as3D(WingNutCTool, "wingc3d", "Wing Nut - Type C (Inch) - 3D", "top");
export const WingNutD3DTool = as3D(WingNutDTool, "wingd3d", "Wing Nut - Type D (Inch) - 3D", "top");
export const RetainingRingAsme3DTool = as3D(RetainingRingAsmeTool, "ringasme3d", "Retaining Ring (ASME) - 3D", "front");
export const RetainingRingDin3DTool = as3D(RetainingRingDinTool, "ringdin3d", "Retaining Ring (DIN) - 3D", "front");
export const RetainingWasherDin3DTool = as3D(RetainingWasherDinTool, "washerdin3d", "Retaining Washer (DIN) - 3D", "front");
export const EyeBolt3DTool = as3D(EyeBoltTool, "eyebolt3d", "Eye Bolt - 3D", "top");
export const SwingBolt3DTool = as3D(SwingBoltTool, "swingbolt3d", "Swing Bolt - 3D", "top");
export const SwingEyeBolt3DTool = as3D(SwingEyeBoltTool, "swingeyebolt3d", "Swing Eye Bolt - 3D", "top");
export const TBolt3DTool = as3D(TBoltTool, "tbolt3d", "T-Bolt - 3D", "top");
export const UBolt3DTool = as3D(UBoltTool, "ubolt3d", "U-Bolt - 3D", "top");
export const JBolt3DTool = as3D(JBoltTool, "jbolt3d", "J-Bolt - 3D", "top");
export const ThumbScrew3DTool = as3D(ThumbScrewTool, "thumbscrew3d", "Thumb Screw (Inch) - 3D", "top");
export const CarriageBolt3DTool = as3D(CarriageBoltTool, "carriagebolt3d", "Carriage Bolt - 3D", "top");
export const LagScrew3DTool = as3D(LagScrewTool, "lagscrew3d", "Lag Screw - 3D", "top");
export const WoodScrew3DTool = as3D(WoodScrewTool, "woodscrew3d", "Wood Screw - 3D", "top");
export const SheetMetalScrew3DTool = as3D(SheetMetalScrewTool, "sheetmetalscrew3d", "Sheet Metal Screw - 3D", "top");
export const BoltAndNutInchTool = as3D(BoltAndNutInch, "boltnutinch", "Bolt and Nut - inch", undefined, true);
export const BoltAndNutMmTool = as3D(BoltAndNutMm, "boltnutmm", "Bolt and Nut - mm", undefined, true);
