// MEP's HVAC tools: Straight Duct, Elbow Duct, Flex Duct, Vertical Duct, Transition, Splitter, Damper,
// Diffuser and Outlet (hvacShapes.ts). Vectorworks' are hybrid plug-in objects from its libraries, with
// a label and an elevation marker tag you can drag; these place the plan and a solid as a group, the
// label and tag drawn beside the duct as text, at the sizes Preferences give. A straight duct is drawn
// from end to end, a flex duct click by click, and the others by a click (a press dragged turns them).

import type { Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import {
  damper,
  damperSolid,
  diffuser,
  diffuserProblem,
  diffuserSolid,
  elbow,
  elbowProblem,
  elbowSolid,
  flexDuct,
  flexDuctSolid,
  flexPath,
  outlet,
  outletProblem,
  outletSolid,
  sectionHigh,
  sectionProblem,
  splitter,
  splitterProblem,
  splitterSolid,
  straightDuct,
  straightDuctSolid,
  transition,
  transitionProblem,
  transitionSolid,
  verticalDuct,
  verticalDuctSolid,
  type Diffuser,
  type DuctSection,
  type DuctShape,
  type Elbow,
  type HvacDrawing,
  type Outlet,
  type RiserSymbol,
  type Splitter,
  type Transition,
  type TransitionAlign,
} from "../hvacShapes.ts";
import { upright } from "../parkingShapes.ts";
import { placedSolid, type Solid } from "../solids3d.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { toast } from "../toast.ts";
import { formatLength } from "../units.ts";
import { PlaceTool, TwoPointTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";
import { addHybrid } from "./solidTool.ts";

const SHAPES: readonly { readonly value: DuctShape; readonly label: string }[] = [
  { value: "rect", label: "Rectangular" },
  { value: "round", label: "Round" },
];
/** what a label says when left as it comes; a round duct's says its diameter */
const LABEL = "{W}x{H}";
const LABEL_ROUND = "Ø{W}";
/** the label's and tag's height on paper, mm, and how far they stand off the duct */
const TEXT_MM = 2.5;
const TEXT_OFF = 1.5;
/** how high a duct's centre runs by default, mm: over a ceiling */
const RUN_HEIGHT = 2700;

/** What every duct piece asks for: its section, how high it runs, and its label and tag. */
interface Duct {
  section: DuctSection;
  elevation: number;
  showLabel: boolean;
  label: string;
  showTag: boolean;
  textMm: number;
}

const firstDuct = (width = 400, height = 300): Duct => ({ section: { shape: "rect", width, height }, elevation: RUN_HEIGHT, showLabel: false, label: LABEL, showTag: false, textMm: TEXT_MM });

const sectionFields = (s: DuctSection, width = "Width", height = "Height"): PrefField[] => [
  { kind: "choice", key: "shape", label: "Shape", value: s.shape, options: SHAPES },
  { kind: "length", key: "width", label: `${width} (a round one's diameter)`, value: s.width },
  { kind: "length", key: "height", label: height, value: s.height },
];
const noteFields = (d: Duct): PrefField[] => [
  { kind: "check", key: "showLabel", label: "Show Label", value: d.showLabel },
  { kind: "text", key: "label", label: "Label ({W} width, {H} height)", value: d.label },
  { kind: "check", key: "showTag", label: "Show Elevation Marker", value: d.showTag },
  { kind: "number", key: "text", label: "Text size", value: d.textMm, min: 0.5, max: 50, unit: "mm" },
];
const elevationField = (d: Duct, label = "Center Elevation"): PrefField => ({ kind: "length", key: "elevation", label, value: d.elevation, zero: true });

function readNotes(v: PrefValues): Pick<Duct, "showLabel" | "label" | "showTag" | "textMm"> {
  return { showLabel: v.flag("showLabel"), label: v.choice("label"), showTag: v.flag("showTag"), textMm: v.num("text") };
}

function readDuct(v: PrefValues): Duct {
  return { ...readNotes(v), section: { shape: v.choice("shape") as DuctShape, width: v.num("width"), height: v.num("height") }, elevation: v.num("elevation") };
}

const units = (): string | undefined => store.session?.doc.info.units;

/** The label's text, its width and height in the drawing's units. */
function labelText(d: Duct): string {
  const s = d.section;
  const template = s.shape === "round" && d.label === LABEL ? LABEL_ROUND : d.label;
  return template.replaceAll("{W}", formatLength(s.width, units())).replaceAll("{H}", formatLength(sectionHigh(s), units()));
}

/** The label under the duct at `along` in its own coordinates and the marker over it, with the height of its top and its bottom above the floor. */
function notes(d: Duct, along: number, half: number, scale: number, at: Pt, angle: number): Part[] {
  const height = d.textMm * scale;
  const off = half + TEXT_OFF * d.textMm * scale;
  const high = sectionHigh(d.section) / 2;
  const texts = [
    ...(d.showLabel && d.label ? [{ local: { x: along, y: -off }, text: labelText(d) }] : []),
    ...(d.showTag ? [{ local: { x: along, y: off }, text: `T ${formatLength(d.elevation + high, units())}\rB ${formatLength(d.elevation - high, units())}` }] : []),
  ];
  return markerParts({
    outlines: [],
    lines: [],
    circles: [],
    filled: [],
    texts: texts.map((t) => ({ at: placed([t.local], at, angle)[0], text: t.text, height, justify: "centre" as const, angle: upright(angle) })),
  });
}

/** A drawing's parts at a place. */
function drawingParts(d: HvacDrawing, at: Pt, angle: number): Part[] {
  return markerParts({
    outlines: d.outlines.map((o) => placed(o, at, angle)),
    lines: d.lines.map((l) => placed(l, at, angle)),
    circles: d.circles.map((c) => ({ center: placed([c.center], at, angle)[0], radius: c.radius })),
    filled: [],
    texts: [],
  });
}

/** A fitting placed by a click. */
abstract class FittingTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected problem: string | null = null;
  private last: { at: Pt; angle: number } | null = null;

  /** its plan, or null with the reason kept in `problem` */
  protected abstract drawing(): HvacDrawing | null;
  protected abstract body(): Solid | null;
  /** its label's and tag's text, its width, and where along it they stand; null for a part with none */
  protected abstract note(): { duct: Duct; along: number; half: number } | null;

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const d = this.drawing();
    if (scale === null || !d) return null;
    this.last = { at, angle };
    const n = this.note();
    return [...drawingParts(d, at, angle), ...(n ? notes(n.duct, n.along, n.half, scale, at, angle) : [])];
  }

  protected override place(parts: readonly Part[]): void {
    const { at, angle } = this.last ?? { at: { x: 0, y: 0 }, angle: 0 };
    const solid = this.body();
    if (solid) addHybrid(this.label, parts, placedSolid(solid, at, angle));
  }

  protected override refusal(): string {
    return `The ${this.label}'s Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}

export class HvacStraightDuctTool extends TwoPointTool {
  readonly id = "hvacduct";
  readonly cursor = "crosshair";
  protected readonly label = "HVAC Straight Duct";
  private duct = firstDuct();

  async preferences(): Promise<void> {
    const v = await toolPrefs("HVAC Straight Duct Preferences", [...sectionFields(this.duct.section), elevationField(this.duct), ...noteFields(this.duct)], "Drag the duct, or click each end. Center Elevation is its middle above the layer; the marker gives its top and bottom.");
    if (v) this.duct = readDuct(v);
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (scale === null || !(length > 0) || sectionProblem(this.duct.section)) return null;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return [...drawingParts(straightDuct(length, this.duct.section), a, angle), ...notes(this.duct, length / 2, this.duct.section.width / 2, scale, a, angle)];
  }

  protected override add(pieces: readonly (readonly Part[])[], a: Pt, b: Pt): void {
    const solid = straightDuctSolid(Math.hypot(b.x - a.x, b.y - a.y), this.duct.section, this.duct.elevation);
    addHybrid(this.label, pieces.flat(), placedSolid(solid, a, Math.atan2(b.y - a.y, b.x - a.x)));
  }

  protected override refusal(): string {
    return sectionProblem(this.duct.section) ? `The HVAC Straight Duct's Preferences don't make one: ${sectionProblem(this.duct.section)}.` : "Drag a longer line for the duct.";
  }
}

export class HvacElbowTool extends FittingTool {
  readonly id = "hvacelbow";
  protected readonly label = "HVAC Elbow Duct";
  private duct = firstDuct();
  private inner = 200;
  private turn = 90;
  private right = false;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HVAC Elbow Duct Preferences",
      [
        ...sectionFields(this.duct.section),
        { kind: "length", key: "inner", label: "Inner Radius", value: this.inner, zero: true },
        { kind: "number", key: "angle", label: "Angle", value: this.turn, min: 1, max: 180, unit: "°" },
        { kind: "choice", key: "turn", label: "Turn", value: this.right ? "right" : "left", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
        elevationField(this.duct),
        ...noteFields(this.duct),
      ],
      "It starts at the click, heading along the way it's turned, and bends to the side Turn says.",
    );
    if (!v) return;
    this.duct = readDuct(v);
    this.inner = v.num("inner");
    this.turn = v.num("angle");
    this.right = v.choice("turn") === "right";
  }

  private elbow(): Elbow {
    return { section: this.duct.section, inner: this.inner, angle: this.turn, right: this.right };
  }

  protected drawing(): HvacDrawing | null {
    this.problem = elbowProblem(this.elbow());
    return this.problem ? null : elbow(this.elbow());
  }

  protected body(): Solid | null {
    return elbowProblem(this.elbow()) ? null : elbowSolid(this.elbow(), this.duct.elevation);
  }

  protected note(): { duct: Duct; along: number; half: number } {
    return { duct: this.duct, along: 0, half: this.duct.section.width / 2 };
  }
}

export class HvacVerticalDuctTool extends FittingTool {
  readonly id = "hvacvertical";
  protected readonly label = "HVAC Vertical Duct";
  private duct: Duct = { ...firstDuct(), elevation: 0 };
  private rise = RUN_HEIGHT;
  private symbol: RiserSymbol = "cross";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HVAC Vertical Duct Preferences",
      [
        ...sectionFields(this.duct.section, "Width", "Depth"),
        elevationField(this.duct, "Bottom Elevation"),
        { kind: "length", key: "rise", label: "Rise", value: this.rise },
        { kind: "choice", key: "symbol", label: "Plan Symbol", value: this.symbol, options: [{ value: "cross", label: "Cross (supply)" }, { value: "diagonal", label: "Single diagonal (return)" }] },
        ...noteFields(this.duct).filter((f) => f.key !== "showTag"),
      ],
      "A click places its centre. It rises from Bottom Elevation by Rise.",
    );
    if (!v) return;
    this.duct = { ...readDuct(v), showTag: false };
    this.rise = v.num("rise");
    this.symbol = v.choice("symbol") === "diagonal" ? "diagonal" : "cross";
  }

  protected drawing(): HvacDrawing | null {
    this.problem = sectionProblem(this.duct.section) ?? (this.rise > 0 ? null : "it needs a rise");
    return this.problem ? null : verticalDuct(this.duct.section, this.symbol);
  }

  protected body(): Solid | null {
    return this.drawing() && verticalDuctSolid(this.duct.section, this.duct.elevation, this.rise);
  }

  protected note(): { duct: Duct; along: number; half: number } {
    const s = this.duct.section;
    return { duct: this.duct, along: 0, half: (s.shape === "round" ? s.width : s.height) / 2 };
  }
}

export class HvacFlexDuctTool extends PathTool {
  readonly id = "hvacflex";
  protected readonly label = "HVAC Flex Duct";
  private diameter = 200;
  private elevation = RUN_HEIGHT;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HVAC Flex Duct Preferences",
      [{ kind: "length", key: "diameter", label: "Diameter", value: this.diameter }, { kind: "length", key: "elevation", label: "Center Elevation", value: this.elevation, zero: true }],
      "Click the points it curves through; a double-click or Enter ends it. It stays level, at Center Elevation, in plan and in 3D.",
    );
    if (!v) return;
    this.diameter = v.num("diameter");
    this.elevation = v.num("elevation");
  }

  protected startHint(): string {
    return "Click the flex duct's start";
  }

  protected parts(points: Pt[]): Part[] | string {
    if (!(this.diameter > 0)) return "The flex duct needs a diameter.";
    return drawingParts(flexDuct(flexPath(points), this.diameter, this.diameter / 2), { x: 0, y: 0 }, 0);
  }

  protected override finish(points: Pt[]): void {
    const parts = this.parts(points);
    if (typeof parts === "string") toast(parts, "info");
    else addHybrid(this.label, parts, flexDuctSolid(flexPath(points), this.diameter, this.elevation));
  }
}

export class HvacTransitionTool extends FittingTool {
  readonly id = "hvactransition";
  protected readonly label = "HVAC Transition";
  private duct = firstDuct();
  private to: DuctSection = { shape: "rect", width: 300, height: 200 };
  private length = 400;
  private align: TransitionAlign = "centre";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HVAC Transition Preferences",
      [
        ...sectionFields(this.duct.section, "Start Width", "Start Height"),
        { kind: "choice", key: "toShape", label: "End Shape", value: this.to.shape, options: SHAPES },
        { kind: "length", key: "toWidth", label: "End Width (a round one's diameter)", value: this.to.width },
        { kind: "length", key: "toHeight", label: "End Height", value: this.to.height },
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "choice", key: "align", label: "Alignment", value: this.align, options: [{ value: "centre", label: "Centered" }, { value: "left", label: "Flat on left" }, { value: "right", label: "Flat on right" }] },
        elevationField(this.duct),
        ...noteFields(this.duct),
      ],
      "It starts at the click, heading along the way it's turned. The label gives its start's size.",
    );
    if (!v) return;
    this.duct = readDuct(v);
    this.to = { shape: v.choice("toShape") as DuctShape, width: v.num("toWidth"), height: v.num("toHeight") };
    this.length = v.num("length");
    this.align = v.choice("align") as TransitionAlign;
  }

  private transition(): Transition {
    return { from: this.duct.section, to: this.to, length: this.length, align: this.align };
  }

  protected drawing(): HvacDrawing | null {
    this.problem = transitionProblem(this.transition());
    return this.problem ? null : transition(this.transition());
  }

  protected body(): Solid | null {
    return transitionProblem(this.transition()) ? null : transitionSolid(this.transition(), this.duct.elevation);
  }

  protected note(): { duct: Duct; along: number; half: number } {
    return { duct: this.duct, along: this.length / 2, half: Math.max(this.duct.section.width, this.to.width) / 2 };
  }
}

export class HvacSplitterTool extends FittingTool {
  readonly id = "hvacsplitter";
  protected readonly label = "HVAC Splitter";
  private duct = firstDuct();
  private lead = 200;
  private left = 300;
  private right = 300;
  private branch = 500;
  private lean = 45;

  async preferences(): Promise<void> {
    const s = this.duct.section;
    const v = await toolPrefs(
      "HVAC Splitter Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: s.width },
        { kind: "length", key: "height", label: "Height", value: s.height },
        { kind: "length", key: "lead", label: "Length to Fork", value: this.lead, zero: true },
        { kind: "length", key: "left", label: "Left Branch Width", value: this.left },
        { kind: "length", key: "right", label: "Right Branch Width", value: this.right },
        { kind: "length", key: "branch", label: "Branch Length", value: this.branch },
        { kind: "number", key: "angle", label: "Branch Angle (90: a tee)", value: this.lean, min: 15, max: 90, unit: "°" },
        elevationField(this.duct),
        ...noteFields(this.duct),
      ],
      "It starts at the click, heading along the way it's turned, and forks to either side. Rectangular only.",
    );
    if (!v) return;
    this.duct = { ...readNotes(v), section: { shape: "rect", width: v.num("width"), height: v.num("height") }, elevation: v.num("elevation") };
    this.lead = v.num("lead");
    this.left = v.num("left");
    this.right = v.num("right");
    this.branch = v.num("branch");
    this.lean = v.num("angle");
  }

  private splitter(): Splitter {
    const s = this.duct.section;
    return { width: s.width, height: s.height, lead: this.lead, left: this.left, right: this.right, branch: this.branch, angle: this.lean };
  }

  protected drawing(): HvacDrawing | null {
    this.problem = splitterProblem(this.splitter());
    return this.problem ? null : splitter(this.splitter());
  }

  protected body(): Solid | null {
    return splitterProblem(this.splitter()) ? null : splitterSolid(this.splitter(), this.duct.elevation);
  }

  protected note(): { duct: Duct; along: number; half: number } {
    return { duct: this.duct, along: this.lead / 2, half: this.duct.section.width / 2 };
  }
}

export class HvacDamperTool extends FittingTool {
  readonly id = "hvacdamper";
  protected readonly label = "HVAC Damper";
  private duct = firstDuct();
  private length = 200;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "HVAC Damper Preferences",
      [...sectionFields(this.duct.section), { kind: "length", key: "length", label: "Length", value: this.length }, elevationField(this.duct), ...noteFields(this.duct)],
      "It starts at the click, heading along the way it's turned: the duct's section with a blade and handle.",
    );
    if (!v) return;
    this.duct = readDuct(v);
    this.length = v.num("length");
  }

  protected drawing(): HvacDrawing | null {
    this.problem = sectionProblem(this.duct.section) ?? (this.length > 0 ? null : "it needs a length");
    return this.problem ? null : damper(this.duct.section, this.length);
  }

  protected body(): Solid | null {
    return this.drawing() && damperSolid(this.duct.section, this.length, this.duct.elevation);
  }

  protected note(): { duct: Duct; along: number; half: number } {
    return { duct: this.duct, along: this.length / 2, half: this.duct.section.width / 2 };
  }
}

export class HvacDiffuserTool extends FittingTool {
  readonly id = "hvacdiffuser";
  protected readonly label = "HVAC Diffuser";
  private unit: Diffuser = { shape: "rect", face: 600, neck: 250, height: 300 };
  private elevation = RUN_HEIGHT;

  async preferences(): Promise<void> {
    const u = this.unit;
    const v = await toolPrefs(
      "HVAC Diffuser Preferences",
      [
        { kind: "choice", key: "shape", label: "Shape", value: u.shape, options: [{ value: "rect", label: "Square" }, { value: "round", label: "Round" }] },
        { kind: "length", key: "face", label: "Face Size", value: u.face },
        { kind: "length", key: "neck", label: "Neck Size", value: u.neck },
        { kind: "length", key: "height", label: "Height", value: u.height },
        { kind: "length", key: "elevation", label: "Face Elevation", value: this.elevation, zero: true },
      ],
      "A click places its centre, seen from below. Its face sits at Face Elevation, usually the ceiling, and its neck rises from there.",
    );
    if (!v) return;
    this.unit = { shape: v.choice("shape") as DuctShape, face: v.num("face"), neck: v.num("neck"), height: v.num("height") };
    this.elevation = v.num("elevation");
  }

  protected drawing(): HvacDrawing | null {
    this.problem = diffuserProblem(this.unit);
    return this.problem ? null : diffuser(this.unit);
  }

  protected body(): Solid | null {
    return diffuserProblem(this.unit) ? null : diffuserSolid(this.unit, this.elevation);
  }

  protected note(): null {
    return null;
  }
}

export class HvacOutletTool extends FittingTool {
  readonly id = "hvacoutlet";
  protected readonly label = "HVAC Outlet";
  private unit: Outlet = { width: 400, height: 200, depth: 50 };
  private elevation = 2400;

  async preferences(): Promise<void> {
    const u = this.unit;
    const v = await toolPrefs(
      "HVAC Outlet Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: u.width },
        { kind: "length", key: "height", label: "Height", value: u.height },
        { kind: "length", key: "depth", label: "Depth", value: u.depth },
        { kind: "length", key: "elevation", label: "Center Elevation", value: this.elevation, zero: true },
      ],
      "A grille on a wall or a duct's side: a click places its face's middle, the air leaving down the screen until a drag turns it.",
    );
    if (!v) return;
    this.unit = { width: v.num("width"), height: v.num("height"), depth: v.num("depth") };
    this.elevation = v.num("elevation");
  }

  protected drawing(): HvacDrawing | null {
    this.problem = outletProblem(this.unit);
    return this.problem ? null : outlet(this.unit);
  }

  protected body(): Solid | null {
    return outletProblem(this.unit) ? null : outletSolid(this.unit, this.elevation);
  }

  protected note(): null {
    return null;
  }
}
