// Rigging's Straight Truss, Curved Truss, Lighting Pipe, Lighting Pipe Ladder, House Rigging Point,
// Hoist, Bridle and Mother Grid (rigShapes.ts). Vectorworks makes rigging objects of them, with
// 3D, loads and Braceworks calculations; these draw what they show in Top/Plan, as plain 2D
// objects grouped in the active class. Heights and trims (but a bridle's, which measure its legs),
// rotations out of plan, weights, materials, cross sections, connections, symbols from libraries,
// forces and 3D aren't drawn or kept.
//
// Straight Truss takes a drag or two clicks along it, Curved Truss a click with its arc's middle
// up the screen (a press dragged turns it toward the pointer) round the point, Lighting Pipe a
// clicked path as Railing/Fence does. Lighting Pipe Ladder drags a rectangle for a ladder lying
// flat, or, standing up, a drag from its middle along its face. House Rigging Point and Hoist take
// a click, or a press dragged to turn them, centred on the point. Bridle takes a click for its
// connection and one for each leg (a reversed one its legs first), Mother Grid its two ends and
// its connection. Rigging Load hangs a point load where it's clicked or lays a distributed load
// along a clicked path, labelled with its weights.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { pathLength } from "../cableShapes.ts";
import { colorMatcher } from "../pdfImport.ts";
import {
  alongLine,
  bridle,
  BRIDLE_LEGS,
  curvedTruss,
  distributedLoad,
  distributedWeights,
  flatLadder,
  formatPerLength,
  formatWeight,
  hoist,
  hoistOrigin,
  imperialUnits,
  lightingPipe,
  MAX_RUNGS,
  parseWeight,
  pointLoad,
  riggingPoint,
  standingLadder,
  straightTruss,
  straightTrussProblem,
  type BridleHeights,
  type BridleType,
  type CurvedTruss,
  type HoistPosition,
  type Ladder,
  type LadderGuide,
  type LadderVerticals,
  type Pipe,
  type PipeEnds,
  type StraightTruss,
  type TickKind,
  type TickOrigin,
  type TrussPlan,
  type TrussProfile,
  type TrussSection,
} from "../rigShapes.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength } from "../units.ts";
import { countOn } from "../lightingDeviceShapes.ts";
import { placedDrawing } from "./circulation.ts";
import { addPieces, CLICK_PX, layerScale, PlaceTool, preview, TwoPointTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a click puts a curved truss's middle up the screen: its own +y, a quarter turn from its +x */
const UP = Math.PI / 2;

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const PROFILES: Options<TrussProfile> = [
  { value: "box", label: "Box" },
  { value: "triangle", label: "Triangle" },
  { value: "ladder", label: "Ladder" },
];
const LINE_TYPES: Options<"single" | "double"> = [
  { value: "single", label: "Single" },
  { value: "double", label: "Double" },
];
const ENDS: Options<PipeEnds> = [
  { value: "none", label: "None" },
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "both", label: "Both" },
];
const TICKS: Options<TickKind> = [
  { value: "none", label: "None" },
  { value: "line", label: "Line" },
  { value: "dot", label: "Dot" },
];
const ORIGINS: Options<TickOrigin> = [
  { value: "centre", label: "Center of Pipe" },
  { value: "split", label: "Split from Center" },
];
const VERTICALS: Options<LadderVerticals> = [
  { value: "both", label: "Both Sides" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "none", label: "None" },
];
const GUIDES: Options<LadderGuide> = [
  { value: "centre", label: "Center" },
  { value: "inside", label: "Inside" },
  { value: "outside", label: "Outside" },
];
const POSITIONS: Options<HoistPosition> = [
  { value: "up", label: "Hoist Up" },
  { value: "down", label: "Hoist Down" },
  { value: "none", label: "Not Shown" },
];

/** The drawing's first dashed line type, for what's drawn dashed. */
const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;
/** Highlight's red: the drawing's colour nearest pure red. */
const redIndex = (): number => colorMatcher()({ r: 1, g: 0, b: 0 });

/** A truss plan's parts placed at `at`, turned by `angle`: its short last section in red. */
function trussParts(plan: TrussPlan, at: Pt, angle: number): Part[] {
  const odd = placedDrawing({ ...plan.odd, circles: [], filled: [], texts: [] }, at, angle);
  const red = odd.outlines.length || odd.lines.length ? redIndex() : 0;
  return [
    ...markerParts(placedDrawing(plan, at, angle)),
    ...markerParts(odd).map((part): Part => ("shape" in part ? { ...part, attrs: { ...part.attrs, penFore: red } } : { shape: part, attrs: { penFore: red } })),
  ];
}

const sectionFields = (t: TrussSection): PrefField[] => [
  { kind: "choice", key: "profile", label: "Profile", value: t.profile, options: PROFILES },
  { kind: "length", key: "width", label: "Width", value: t.width },
  { kind: "length", key: "chord", label: "Chord Width", value: t.chord },
  { kind: "length", key: "ladderBar", label: "Top Ladder Bar Diameter", value: t.ladderBar, zero: true },
  { kind: "length", key: "lacing", label: "Top Lacing Diameter", value: t.lacing, zero: true },
  { kind: "check", key: "folding", label: "Folding", value: t.folding },
  { kind: "check", key: "highlight", label: "Highlight", value: t.highlight },
];
const sectionFrom = (v: PrefValues): TrussSection => ({
  profile: pick(PROFILES, v.choice("profile"), "box"),
  width: v.num("width"),
  chord: v.num("chord"),
  ladderBar: v.num("ladderBar"),
  lacing: v.num("lacing"),
  folding: v.flag("folding"),
  highlight: v.flag("highlight"),
});

const TRUSS_NOTE =
  "From above: the top chords (a triangle's apex chord between its sides), ladder bars across and lacing corner to corner in each bay, the bays as near the spacing as divides each section evenly. A section shorter than the rest comes last, drawn red with Highlight. The truss must be wider than three chord widths, its bars and lacing no thicker than its chords, a folding truss unlaced.";

export class StraightTrussTool extends TwoPointTool {
  readonly id = "trussstraight";
  readonly cursor = "crosshair";
  protected readonly label = "Straight Truss";
  private t: StraightTruss = { profile: "box", width: 290, chord: 51, ladderBar: 20, lacing: 16, folding: false, highlight: true, interval: 3000, ladderSpacing: 500, direction: false };
  private problem = "";

  async preferences(): Promise<void> {
    const t = this.t;
    const v = await toolPrefs(
      "Straight Truss Preferences",
      [
        ...sectionFields(t),
        { kind: "length", key: "interval", label: "Connection Interval", value: t.interval },
        { kind: "length", key: "spacing", label: "Ladder Bar Spacing", value: t.ladderSpacing },
        { kind: "check", key: "direction", label: "Show Direction", value: t.direction },
      ],
      `The truss runs from the first point to the second, centred on the line, in sections a Connection Interval long. ${TRUSS_NOTE} Show Direction puts an arrowhead at its middle pointing from start to end.`,
    );
    if (!v) return;
    this.t = { ...sectionFrom(v), interval: v.num("interval"), ladderSpacing: v.num("spacing"), direction: v.flag("direction") };
  }

  hint(): string {
    return this.start() ? super.hint() : "Drag the truss, or click its start";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const plan = straightTruss(this.t, dist(a, b));
    if (typeof plan === "string") {
      this.problem = plan;
      return null;
    }
    return trussParts(plan, a, Math.atan2(b.y - a.y, b.x - a.x));
  }

  protected refusal(): string {
    return this.problem || (straightTrussProblem(this.t, 1) ?? "Drag a longer truss.");
  }
}

export class CurvedTrussTool extends PlaceTool {
  readonly id = "trusscurved";
  readonly cursor = "crosshair";
  protected readonly label = "Curved Truss";
  protected readonly clickAngle = UP;
  private t: CurvedTruss = { profile: "box", width: 290, chord: 51, ladderBar: 20, lacing: 16, folding: false, highlight: true, diameter: 6000, totalArc: 180, segmentArc: 45, ladderArc: 7.5 };

  async preferences(): Promise<void> {
    const t = this.t;
    const v = await toolPrefs(
      "Curved Truss Preferences",
      [
        ...sectionFields(t),
        { kind: "length", key: "diameter", label: "Diameter", value: t.diameter },
        { kind: "number", key: "totalArc", label: "Total Arc", value: t.totalArc, min: 0, max: 360, unit: "°" },
        { kind: "number", key: "segmentArc", label: "Segment Arc", value: t.segmentArc, min: 0, max: 360, unit: "°" },
        { kind: "number", key: "ladderArc", label: "Ladder Spacing Arc", value: t.ladderArc, min: 0, max: 360, unit: "°" },
      ],
      `The arc is centred on the click, its middle up the screen (toward the drag), the Diameter outside to outside, in sections a Segment Arc long. ${TRUSS_NOTE} The Diameter must be more than twice the width.`,
    );
    if (!v) return;
    this.t = { ...sectionFrom(v), diameter: v.num("diameter"), totalArc: v.num("totalArc"), segmentArc: v.num("segmentArc"), ladderArc: v.num("ladderArc") };
  }

  hint(): string {
    return `${super.hint()} · the arc round the point, its middle toward the drag`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = curvedTruss(this.t);
    return typeof plan === "string" ? null : trussParts(plan, at, angle - UP);
  }

  protected refusal(): string {
    const plan = curvedTruss(this.t);
    return typeof plan === "string" ? plan : "The curved truss can't be drawn.";
  }
}

export class LightingPipeTool extends PathTool {
  readonly id = "lightingpipe";
  protected readonly label = "Lighting Pipe";
  private p: Pipe = { double: true, diameter: 48, ends: "both", centreline: false, direction: false, ticks: "none", centers: 500, tickSize: 150, offset: 0, origin: "centre" };

  async preferences(): Promise<void> {
    const p = this.p;
    const v = await toolPrefs(
      "Lighting Pipe Preferences",
      [
        { kind: "choice", key: "lineType", label: "Line Type", value: p.double ? "double" : "single", options: LINE_TYPES },
        { kind: "length", key: "diameter", label: "Diameter", value: p.diameter },
        { kind: "choice", key: "ends", label: "End Marker", value: p.ends, options: ENDS },
        { kind: "check", key: "centreline", label: "Show Centerline Guide", value: p.centreline },
        { kind: "check", key: "direction", label: "Show Direction", value: p.direction },
        { kind: "choice", key: "ticks", label: "Display ticks as", value: p.ticks, options: TICKS },
        { kind: "length", key: "centers", label: "Centers", value: p.centers },
        { kind: "choice", key: "origin", label: "Origin", value: p.origin, options: ORIGINS },
        { kind: "length", key: "tickSize", label: "Size", value: p.tickSize },
        { kind: "length", key: "offset", label: "Offset", value: p.offset, zero: true, signed: true },
      ],
      "Click the pipe's path. A single line, or a double line the Diameter across (its centre line, with the guide shown, in the drawing's first dashed line type, left out in a drawing without one); an end marker is a bar across an open end four diameters long. Tick marks run every Centers from the middle of the whole pipe, or split either side of it, shifted by the Offset, as lines the Size long or dots the Size across. Smooth corners, arc radii, gaps round the ticks, snap points, materials and weights aren't offered.",
    );
    if (!v) return;
    this.p = {
      double: v.choice("lineType") === "double",
      diameter: v.num("diameter"),
      ends: pick(ENDS, v.choice("ends"), "both"),
      centreline: v.flag("centreline"),
      direction: v.flag("direction"),
      ticks: pick(TICKS, v.choice("ticks"), "none"),
      centers: v.num("centers"),
      origin: pick(ORIGINS, v.choice("origin"), "centre"),
      tickSize: v.num("tickSize"),
      offset: v.num("offset"),
    };
  }

  protected startHint(): string {
    return "Click the pipe's start";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = lightingPipe(points, closed, this.p);
    if (typeof plan === "string") return plan;
    const dashed = dashedStyle();
    return [...markerParts(plan), ...(dashed === undefined ? [] : plan.hidden.map((pts): Part => ({ shape: { kind: "polyline", points: pts, closed: false }, attrs: { lineStyle: dashed } })))];
  }
}

type LadderMode = "point" | "rect";

const LADDER_MODES: readonly { readonly id: LadderMode; readonly label: string }[] = [
  { id: "point", label: "Point Insertion" },
  { id: "rect", label: "Rectangle Insertion" },
];

export class PipeLadderTool extends TwoPointTool {
  readonly id = "pipeladder";
  readonly cursor = "crosshair";
  protected readonly label = "Lighting Pipe Ladder";
  private mode: LadderMode = "rect";
  private width = 1000;
  private l: Ladder = { rungs: 4, double: true, rungDiameter: 48, sideDiameter: 48, verticals: "both", guides: "centre" };
  private problem = "";

  modes(): readonly ToolModes[] {
    return [{ label: "Insertion", options: LADDER_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = LADDER_MODES.find((m) => m.id === id);
    if (mode) this.mode = mode.id;
  }

  async preferences(): Promise<void> {
    const l = this.l;
    const v = await toolPrefs(
      "Lighting Pipe Ladder Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "number", key: "rungs", label: "Number of Rungs", value: l.rungs, min: 1, max: MAX_RUNGS, integer: true },
        { kind: "choice", key: "lineType", label: "Line Type", value: l.double ? "double" : "single", options: LINE_TYPES },
        { kind: "length", key: "rungDiameter", label: "Rung Diameter", value: l.rungDiameter },
        { kind: "choice", key: "verticals", label: "Verticals", value: l.verticals, options: VERTICALS },
        { kind: "length", key: "sideDiameter", label: "Side Diameter", value: l.sideDiameter },
        { kind: "choice", key: "guides", label: "Guides", value: l.guides, options: GUIDES },
      ],
      "Rectangle Insertion drags the ladder lying flat: its sides up the rectangle and its rungs across it, evenly spaced from the bottom to the top (one rung at the top), the pipes' centre lines on the rectangle or inside or outside it by the Guides. Point Insertion stands a ladder the Width wide up from the first point, its face along the drag: from above, its top rung and its sides' tops. Curved tops, custom rung spacing, rectangular sides, materials and tick marks aren't offered.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.l = {
      rungs: v.num("rungs"),
      double: v.choice("lineType") === "double",
      rungDiameter: v.num("rungDiameter"),
      verticals: pick(VERTICALS, v.choice("verticals"), "both"),
      sideDiameter: v.num("sideDiameter"),
      guides: pick(GUIDES, v.choice("guides"), "centre"),
    };
  }

  hint(): string {
    if (this.start()) return super.hint();
    return this.mode === "rect" ? "Drag the ladder's rectangle, or click a corner" : "Drag from the ladder's middle along its face, or click its middle";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const plan = this.mode === "rect" ? flatLadder(a, b, this.l) : standingLadder(this.width, this.l);
    if (typeof plan === "string") {
      this.problem = plan;
      return null;
    }
    return this.mode === "rect" ? markerParts(plan) : markerParts(placedDrawing({ ...plan }, a, dist(a, b) > 0 ? Math.atan2(b.y - a.y, b.x - a.x) : 0));
  }

  protected refusal(): string {
    return this.problem || "Drag a larger ladder.";
  }
}

export class RiggingPointTool extends PlaceTool {
  readonly id = "rigpoint";
  readonly cursor = "crosshair";
  protected readonly label = "House Rigging Point";
  private size = 300;
  private name = "";
  private pointId = "";
  private showLabel = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "House Rigging Point Preferences",
      [
        { kind: "length", key: "size", label: "Size", value: this.size },
        { kind: "text", key: "name", label: "Name", value: this.name },
        { kind: "text", key: "id", label: "ID", value: this.pointId },
        { kind: "check", key: "label", label: "Show label", value: this.showLabel },
      ],
      "The schematic a rigging point shows without a symbol: a square the Size across round a circle, crossed through its middle on the point, a drag turning it; its Name and ID beside it. Symbols, baskets, allowable forces, Braceworks forces, the trim height and the element coordinate system aren't kept.",
    );
    if (!v) return;
    this.size = v.num("size");
    this.name = v.choice("name");
    this.pointId = v.choice("id");
    this.showLabel = v.flag("label");
  }

  hint(): string {
    return `${super.hint()} · centred on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = riggingPoint(this.size, this.showLabel ? [this.name, this.pointId] : []);
    return typeof plan === "string" ? null : markerParts(placedDrawing(plan, at, angle));
  }

  protected refusal(): string {
    return "Set a Size over 0.";
  }
}

/** a hoist's schematic across at a Hoist Symbol Scale of 1, mm */
const HOIST_SIZE = 500;

export class HoistTool extends PlaceTool {
  readonly id = "hoist";
  readonly cursor = "crosshair";
  protected readonly label = "Hoist";
  private scaleFactor = 1;
  private position: HoistPosition = "up";
  private hoistId = "H1";
  private showLabel = true;
  private measure = false;
  /** the Name of the hoist origin the measurement label measures from; blank for the drawing's origin */
  private origin = "";
  /** where that origin was found when last looked for */
  private originAt: Pt = { x: 0, y: 0 };

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Hoist Preferences",
      [
        { kind: "text", key: "id", label: "Hoist ID", value: this.hoistId },
        { kind: "choice", key: "position", label: "Hoist Position", value: this.position, options: POSITIONS },
        { kind: "number", key: "scale", label: "Hoist Symbol Scale", value: this.scaleFactor, min: 0.1, max: 20 },
        { kind: "check", key: "label", label: "Show label", value: this.showLabel },
        { kind: "check", key: "measure", label: "Show Measurement Label", value: this.measure },
        { kind: "text", key: "origin", label: "Origin", value: this.origin },
      ],
      `The schematic a hoist shows without its library symbol: its motor a circle ${HOIST_SIZE} mm across times the scale, in quarters, centred on the point (a cross on the point when its position isn't shown), a drag turning it and its labels. The label shows its Hoist ID; the measurement label its X and Y from the hoist origin its Origin names (one the Hoist Origin tool placed), or from the drawing's origin when that's blank, measured when it's placed. Hook heights, chains, pick-up symbols, power, weights, capacities, forces and numbering aren't kept.`,
    );
    if (!v) return;
    this.hoistId = v.choice("id");
    this.position = pick(POSITIONS, v.choice("position"), "up");
    this.scaleFactor = v.num("scale");
    this.showLabel = v.flag("label");
    this.measure = v.flag("measure");
    this.origin = v.choice("origin").trim();
    this.findOrigin();
  }

  hint(): string {
    return `${super.hint()} · centred on the point`;
  }

  down(p: PointerInfo): void {
    if (this.measure && this.origin && !this.findOrigin()) toast(`No hoist origin is named "${this.origin}": measured from the drawing's origin.`, "info");
    super.down(p);
  }

  /** Looks up the named hoist origin; false when there's none (the drawing's origin stands in). */
  private findOrigin(): boolean {
    const at = this.origin ? hoistOriginAt(this.origin) : null;
    this.originAt = at ?? { x: 0, y: 0 };
    return at !== null;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const units = store.session?.doc.info.units;
    const x = at.x - this.originAt.x;
    const y = at.y - this.originAt.y;
    const measure = this.measure ? [`X: ${formatLength(x, units)}`, `Y: ${formatLength(y, units)}`] : [];
    const plan = hoist(HOIST_SIZE * this.scaleFactor, this.position, this.showLabel ? this.hoistId : "", measure);
    return typeof plan === "string" ? null : markerParts(placedDrawing(plan, at, angle));
  }

  protected refusal(): string {
    return "Set a Hoist Symbol Scale over 0.";
  }
}

/** Where the hoist origin named `name` stands: the middle of the circle in the group of that name. */
function hoistOriginAt(name: string): Pt | null {
  const doc = store.session?.doc;
  if (!doc) return null;
  for (const layer of doc.layers()) {
    const objects = doc.objects(layer.id);
    const group = objects.find((o) => o.kind === "group" && o.name === name);
    if (!group) continue;
    for (const o of objects) {
      const c = o.parentId === group.id ? o.shape : null;
      if (c?.kind === "arc" && c.center && Math.abs(c.sweepAngle ?? 0) >= 360) return c.center;
    }
  }
  return null;
}

/** Whether a layer or an object already has `name`, as Vectorworks keeps names to one each. */
function nameTaken(name: string): boolean {
  const doc = store.session?.doc;
  if (!doc) return false;
  return doc.layers().some((l) => l.name === name || doc.objects(l.id).some((o) => o.name === name));
}

export class HoistOriginTool extends PlaceTool {
  readonly id = "hoistorigin";
  readonly cursor = "crosshair";
  protected readonly label = "Hoist Origin";
  private size = 500;
  private name = "Origin 1";
  private showLabel = true;
  private labelX = 0;
  private labelY = -400;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Hoist Origin Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: this.name },
        { kind: "length", key: "size", label: "Size", value: this.size },
        { kind: "check", key: "label", label: "Show label in drawing", value: this.showLabel },
        { kind: "length", key: "labelX", label: "Label Offset X", value: this.labelX, zero: true, signed: true },
        { kind: "length", key: "labelY", label: "Label Offset Y", value: this.labelY, zero: true, signed: true },
      ],
      "The schematic a hoist origin shows without a symbol: a square round a circle, crossed through its middle on the point (the origin), a drag turning it and its label; its Name centred the Label Offset from the point. The group placed takes the Name as its own (Object Info's Name), so a hoist's Origin finds it: a name already given to a layer or another object is refused, and the number at its end counts on after each. Symbols, notes and label classes aren't kept.",
    );
    if (!v) return;
    this.name = v.choice("name").trim();
    this.size = v.num("size");
    this.showLabel = v.flag("label");
    this.labelX = v.num("labelX");
    this.labelY = v.num("labelY");
  }

  hint(): string {
    return `${super.hint()} · centred on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const plan = hoistOrigin(this.size, this.showLabel ? this.name : "", { x: this.labelX, y: this.labelY });
    return typeof plan === "string" ? null : markerParts(placedDrawing(plan, at, angle));
  }

  protected placeProblem(): string | null {
    if (!this.name) return "Give the hoist origin a Name: hoists find it by its name.";
    return nameTaken(this.name) ? `"${this.name}" already names a layer or object: give the hoist origin its own Name.` : null;
  }

  protected objectName(): string {
    return this.name;
  }

  protected afterPlacing(): void {
    this.name = countOn(this.name, 1);
  }

  protected refusal(): string {
    return "Set a Size over 0.";
  }
}

/**
 * A tool placed by a set number of clicks, each previewed to the pointer, the last placing it;
 * Escape cancels.
 */
abstract class ClicksTool extends BaseTool {
  readonly cursor = "crosshair";
  protected abstract readonly label: string;
  protected points: Pt[] = [];
  private pointer: Pt | null = null;

  /** how many clicks place it */
  protected abstract clicks(): number;
  /** What the clicks so far (the pointer last, while previewing) draw, or why they can't. */
  protected abstract parts(points: Pt[], final: boolean): Part[] | string;

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  down(p: PointerInfo): void {
    this.points.push(p.pos);
    if (this.points.length < this.clicks()) return;
    const parts = this.parts(this.points, true);
    this.points = [];
    if (typeof parts === "string") toast(parts, "info");
    else addPieces(this.label, [parts]);
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  cancel(): void {
    this.points = [];
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes?.());
    if (mode) {
      this.setMode?.(mode);
      this.points = [];
      return true;
    }
    if (e.key !== "Escape" || this.points.length === 0) return false;
    this.points = [];
    return true;
  }

  overlay(g: Painter): void {
    if (!this.pointer || this.points.length === 0) return;
    const parts = this.parts([...this.points, this.pointer], false);
    if (typeof parts !== "string") preview(g, parts);
  }

  modes?(): readonly ToolModes[];
  setMode?(id: string): void;
}

const BRIDLE_TYPES: readonly { readonly id: BridleType; readonly label: string }[] = [
  { id: "two", label: "Two Leg Bridle" },
  { id: "three", label: "Three Leg Bridle" },
  { id: "reversed", label: "Reversed Two Leg Bridle" },
];
/** the default colours of a bridle's leg ends (legs 1, 2 and 3) and its connection */
const LEG_COLOURS = [
  { r: 1, g: 0, b: 1 },
  { r: 0, g: 0.8, b: 0 },
  { r: 1, g: 0, b: 0 },
] as const;
const CONNECTION_COLOUR = { r: 0, g: 0.4, b: 1 } as const;
/** a leg end's dot and the connection's square across, and the leg labels' height, on paper, mm */
const DOT_MM = 1.5;
const SQUARE_MM = 2;
const LEG_TEXT_MM = 2;
/** Vectorworks' centre justification and vertical centre */
const H_CENTRE = 2;
const V_CENTRE = 3;

export class BridleTool extends ClicksTool {
  readonly id = "bridle";
  protected readonly label = "Bridle";
  private type: BridleType = "two";
  private h: BridleHeights = { rigging: 12000, apex: 10000, trim: 7000 };
  private labels = true;
  private colours = true;

  modes(): readonly ToolModes[] {
    return [{ label: "Bridle", options: BRIDLE_TYPES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.type }];
  }

  setMode(id: string): void {
    const type = BRIDLE_TYPES.find((m) => m.id === id);
    if (type) this.type = type.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Bridle Preferences",
      [
        { kind: "length", key: "rigging", label: "Rigging Point Height", value: this.h.rigging, zero: true, signed: true },
        { kind: "length", key: "apex", label: "Apex Height", value: this.h.apex, zero: true, signed: true },
        { kind: "length", key: "trim", label: "Trim Height", value: this.h.trim, zero: true, signed: true },
        { kind: "check", key: "labels", label: "Show Leg Labels", value: this.labels },
        { kind: "check", key: "colours", label: "Use default coloring", value: this.colours },
      ],
      `A bridle's first click is its connection on the truss, under its apex, the next ones each leg's rigging point; a reversed two leg bridle's first two clicks are its legs' points on the truss, the last its rigging point over its apex. Each leg is drawn from the apex to its point, a dot at its end (magenta, green and red with default coloring), a square at the connection; its label gives its length and angle from vertical, from how far it reaches and the heights: the rigging points at the Rigging Point Height, the apex at the Apex Height and the truss at the Trim Height, the down leg's length beside the connection. Bridle parts, baskets, hoists for down legs, forces, weights, reports and 3D aren't kept.`,
    );
    if (!v) return;
    this.h = { rigging: v.num("rigging"), apex: v.num("apex"), trim: v.num("trim") };
    this.labels = v.flag("labels");
    this.colours = v.flag("colours");
  }

  hint(): string {
    const n = this.points.length;
    if (this.type === "reversed") return n === 0 ? "Click leg 1's point on the truss · 1–3 type" : n === 1 ? "Click leg 2's point on the truss" : "Click the rigging point the bridle hangs from";
    return n === 0 ? "Click the bridle's connection point on the truss · 1–3 type" : `Click leg ${n}'s rigging point`;
  }

  protected clicks(): number {
    return BRIDLE_LEGS[this.type] + 1;
  }

  protected parts(points: Pt[], final: boolean): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to place a bridle.";
    const reversed = this.type === "reversed";
    const done = points.length === this.clicks();
    // while the legs are still being clicked, a reversed bridle previews its line along the truss
    if (reversed && !done) return [{ kind: "polyline", points, closed: false }];
    const apex = reversed ? points[points.length - 1] : points[0];
    const legs = reversed ? points.slice(0, -1) : points.slice(1);
    const lines = legs.map((to): Part => ({ kind: "line", a: apex, b: to }));
    if (!final && !done) return lines;
    const plan = bridle(this.type, apex, legs, this.h);
    if (typeof plan === "string") return final ? plan : lines;
    const match = colorMatcher();
    const ink = store.drawAttrs.penFore ?? 0;
    const fill = (colour: number) => ({ fillPattern: 1, fillFore: colour, fillBack: colour, penFore: colour, fillOpacity: 100 });
    const r = (DOT_MM / 2) * scale;
    const half = (SQUARE_MM / 2) * scale;
    const dots = plan.legs.map((leg, i): Part => ({ shape: { kind: "arc", center: leg.to, radius: r, startAngle: 0, sweepAngle: 360 }, attrs: fill(this.colours ? match(LEG_COLOURS[i]) : ink) }));
    const square: Part = {
      shape: { kind: "polygon", points: [{ x: apex.x - half, y: apex.y - half }, { x: apex.x + half, y: apex.y - half }, { x: apex.x + half, y: apex.y + half }, { x: apex.x - half, y: apex.y + half }], closed: true },
      attrs: fill(this.colours ? match(CONNECTION_COLOUR) : ink),
    };
    const units = store.session?.doc.info.units;
    const height = LEG_TEXT_MM * scale;
    const text = (x: number, y: number, value: string): Part => ({ kind: "text", at: { x, y }, text: value, height, hAlign: H_CENTRE, vAlign: V_CENTRE });
    const labels = this.labels
      ? [
          ...plan.legs.map((leg, i) => {
            const mid = { x: (apex.x + leg.to.x) / 2, y: (apex.y + leg.to.y) / 2 };
            const len = dist(apex, leg.to);
            // beside the leg's middle, a label's height off it on its left
            const off = { x: (-(leg.to.y - apex.y) / len) * height, y: ((leg.to.x - apex.x) / len) * height };
            return text(mid.x + off.x, mid.y + off.y, `Leg ${i + 1}: ${formatLength(leg.length, units)} · ${leg.angle.toFixed(1)}°`);
          }),
          text(apex.x, apex.y - half - height, `${reversed ? "Top leg" : "Down leg"}: ${formatLength(plan.single, units)}`),
        ]
      : [];
    return [...lines, ...dots, square, ...labels];
  }
}

const MOTHER_HOIST_SIZE = 500;

export class MotherGridTool extends ClicksTool {
  readonly id = "mothergrid";
  protected readonly label = "Mother Grid";
  private t: StraightTruss = { profile: "box", width: 290, chord: 51, ladderBar: 20, lacing: 16, folding: false, highlight: true, interval: 3000, ladderSpacing: 500, direction: false };

  async preferences(): Promise<void> {
    const t = this.t;
    const v = await toolPrefs(
      "Mother Grid Preferences",
      [...sectionFields(t), { kind: "length", key: "interval", label: "Connection Interval", value: t.interval }, { kind: "length", key: "spacing", label: "Ladder Bar Spacing", value: t.ladderSpacing }],
      `Click the mother grid's start and end, a hoist at each, then the connection point where its third hoist hangs to carry what's below (put on the truss's line, between its ends). The truss is drawn as Straight Truss draws it. ${TRUSS_NOTE} Each hoist is the Hoist tool's ${MOTHER_HOIST_SIZE} mm schematic, turned with the truss. Truss and hoist symbols, trim heights, chains, connections, forces and 3D aren't kept.`,
    );
    if (!v) return;
    this.t = { ...sectionFrom(v), interval: v.num("interval"), ladderSpacing: v.num("spacing"), direction: false };
  }

  hint(): string {
    const n = this.points.length;
    return n === 0 ? "Click the mother grid's start, its first hoist" : n === 1 ? "Click its end, the second hoist" : "Click the connection point, where the third hoist hangs";
  }

  protected clicks(): number {
    return 3;
  }

  protected parts(points: Pt[], final: boolean): Part[] | string {
    const [a, b, c] = points;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const plan = straightTruss(this.t, dist(a, b));
    if (typeof plan === "string") return plan;
    const motor = (at: Pt): Part[] => {
      const h = hoist(MOTHER_HOIST_SIZE, "up", "", []);
      return typeof h === "string" ? [] : markerParts(placedDrawing(h, at, angle));
    };
    const parts = [...trussParts(plan, a, angle), ...motor(a), ...motor(b)];
    if (!c) return parts;
    const t = alongLine(a, b, c);
    if (!(t > 0 && t < 1)) return final ? "Click the connection point between the mother grid's ends." : parts;
    return [...parts, ...motor({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })];
  }
}

type LoadKind = "point" | "distributed";
type LabelTurn = "level" | "across" | "angled";
type Spread = "distributed" | "total";

const LOAD_KINDS: Options<LoadKind> = [
  { value: "point", label: "Point Load" },
  { value: "distributed", label: "Distributed Load" },
];
const LABEL_TURNS: Options<LabelTurn> = [
  { value: "level", label: "Non-Rotated" },
  { value: "across", label: "Perpendicular" },
  { value: "angled", label: "Angled" },
];
const SPREADS: Options<Spread> = [
  { value: "distributed", label: "Distributed Weight" },
  { value: "total", label: "Total Weight" },
];

/** a point load's circle across on paper, mm */
const LOAD_MM = 5;
/** mm in a point of text size */
const POINT_MM = 25.4 / 72;
/** a distributed load's line weight, mils */
const LOAD_WEIGHT = 70;
const LOAD_GREEN = { r: 0.2, g: 0.8, b: 0.2 };
const LOAD_YELLOW = { r: 1, g: 0.8, b: 0 };

/** A point load's label turn in degrees, for rigging running `rig` radians: level, across it or 45° to it, read left to right. */
function labelTurn(turn: LabelTurn, rig: number): number {
  if (turn === "level") return 0;
  const a = ((((rig * 180) / Math.PI + (turn === "across" ? 90 : 45)) % 360) + 360) % 360;
  return a > 90 && a <= 270 ? a - 180 : a > 270 ? a - 360 : a;
}

/**
 * Braceworks' Rigging Load. Point Load mode hangs a load where it's clicked: its generic circle
 * (green) with its legend over it and its label beside it, a press dragged along the rigging
 * turning the label across it (Perpendicular) or 45° to it (Angled). Distributed Load mode lays a
 * load along a clicked path, a heavy yellow line labelled with its weights and length.
 */
export class RiggingLoadTool extends PathTool {
  readonly id = "riggingload";
  protected readonly label = "Rigging Load";
  private kind: LoadKind = "point";
  private turn: LabelTurn = "level";
  private spread: Spread = "distributed";
  private loadName = "Load";
  private loadId = "";
  private category = "Light";
  private pointWeight = "50";
  private spreadWeight = "20";
  private legend = "";
  private showName = true;
  private showCategory = true;
  private showLabel = true;
  private textSize = 10;
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;

  modes(): readonly ToolModes[] {
    const kinds = { label: "Load", options: LOAD_KINDS.map((k, i) => ({ id: k.value, label: k.label, key: String(i + 1) })), active: this.kind };
    return this.kind === "point"
      ? [kinds, { label: "Label", options: LABEL_TURNS.map((t, i) => ({ id: t.value, label: t.label, key: String(i + 3) })), active: this.turn }]
      : [kinds, { label: "Weight", options: SPREADS.map((s, i) => ({ id: s.value, label: s.label, key: String(i + 3) })), active: this.spread }];
  }

  setMode(id: string): void {
    const kind = pick(LOAD_KINDS, id, this.kind);
    if (kind !== this.kind) this.cancel();
    this.kind = kind;
    this.turn = pick(LABEL_TURNS, id, this.turn);
    this.spread = pick(SPREADS, id, this.spread);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Rigging Load Preferences",
      [
        { kind: "text", key: "name", label: "Load Name", value: this.loadName },
        { kind: "text", key: "id", label: "Load ID", value: this.loadId },
        { kind: "text", key: "category", label: "Load Category", value: this.category },
        { kind: "text", key: "point", label: "Point Load Weight", value: this.pointWeight },
        { kind: "text", key: "spread", label: "Distributed Load Weight", value: this.spreadWeight },
        { kind: "text", key: "legend", label: "Legend Entry", value: this.legend },
        { kind: "check", key: "showName", label: "Show Name", value: this.showName },
        { kind: "check", key: "showCategory", label: "Show Load Category", value: this.showCategory },
        { kind: "check", key: "showLabel", label: "Show Label", value: this.showLabel },
        { kind: "number", key: "text", label: "Text Size", value: this.textSize, min: 1, max: 200, unit: "pt" },
      ],
      `Weights are in pounds in an imperial drawing, kilograms otherwise, unless lb or kg follows them. Point Load mode: click where the load hangs, or press there and drag along the rigging to turn the label across it (Perpendicular) or 45° to it (Angled). It's drawn as a green circle ${LOAD_MM} mm across on paper, the Legend Entry over it, its label beside it: the name, weight and #ID, its category under them. Distributed Load mode: click the load's path along the rigging; a double-click or Enter ends it. Its weight is per foot or metre (500/10 spreads 500 over 10 of the drawing's units), or its whole weight in Total Weight mode. It's drawn as a heavy yellow line, labelled with its name, category, total weight, weight per length and length. Load sets, attaching to rigging objects, symbols, classes and Braceworks calculations aren't offered.`,
    );
    if (!v) return;
    this.loadName = v.choice("name");
    this.loadId = v.choice("id");
    this.category = v.choice("category");
    this.legend = v.choice("legend");
    this.showName = v.flag("showName");
    this.showCategory = v.flag("showCategory");
    this.showLabel = v.flag("showLabel");
    this.textSize = v.num("text");
    const imperial = imperialUnits(store.session?.doc.info.units);
    const point = v.choice("point");
    const spread = v.choice("spread");
    if (parseWeight(point, imperial) === null) toast("Point Load Weight: give a number, lb or kg after it if you like. It's kept as it was.", "info");
    else this.pointWeight = point;
    if (typeof distributedWeights(spread, false, 1, store.session?.doc.info.units) === "string")
      toast("Distributed Load Weight: give a weight, or a weight / the length it's spread over (500/10). It's kept as it was.", "info");
    else this.spreadWeight = spread;
  }

  hint(): string {
    if (this.kind === "distributed") return super.hint();
    return this.press ? `Release to place · drag along the rigging to turn the label · Shift ${ANGLE_STEP_DEG}°` : "Click where the load hangs, or press and drag along the rigging · 1–2 load, 3–5 label";
  }

  protected startHint(): string {
    return "Click the load's start along the rigging · 1–2 load, 3–4 weight";
  }

  snapFrom(): Pt | null {
    return this.kind === "point" ? (this.press?.at ?? null) : super.snapFrom();
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (this.kind === "point") this.press = { at: p.pos, screen: p.screen };
    else super.down(p);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    super.move(p);
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (this.kind !== "point" || !press) return;
    const parts = this.pointParts(press.at, this.rigAngle(press, p));
    if (typeof parts === "string") toast(parts, "info");
    else addPieces(this.label, [parts]);
  }

  cancel(): void {
    this.press = null;
    super.cancel();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.kind === "distributed") return super.key(e);
    if (e.key !== "Escape" || !this.press) return false;
    this.press = null;
    return true;
  }

  overlay(g: Painter): void {
    if (this.kind === "distributed") {
      super.overlay(g);
      return;
    }
    const p = this.pointer;
    if (!p) return;
    const parts = this.press ? this.pointParts(this.press.at, this.rigAngle(this.press, p)) : this.pointParts(p.pos, 0);
    if (typeof parts !== "string") preview(g, parts);
  }

  /** The way the rigging runs from a press dragged to `p`: left to right for a click, else toward the pointer (Shift: 15° steps). */
  private rigAngle(press: { at: Pt; screen: Pt }, p: PointerInfo): number {
    if (dist(p.screen, press.screen) <= CLICK_PX) return 0;
    const to = p.shift ? snapAngle(press.at, p.pos, ANGLE_STEP_DEG) : p.pos;
    return Math.atan2(to.y - press.at.y, to.x - press.at.x);
  }

  private textHeight(scale: number): number {
    return this.textSize * POINT_MM * scale;
  }

  /** A point load hung at `at` on rigging running `rig` radians, or why it can't be. */
  private pointParts(at: Pt, rig: number): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to place a load.";
    const imperial = imperialUnits(store.session?.doc.info.units);
    const kg = parseWeight(this.pointWeight, imperial);
    if (kg === null) return "Set the Point Load Weight in Preferences.";
    const first = [this.showName ? this.loadName.trim() : "", formatWeight(kg, imperial), this.loadId.trim() ? `#${this.loadId.trim()}` : ""].filter(Boolean).join(" ");
    const label = this.showLabel ? [first, this.showCategory ? this.category : ""] : [];
    const plan = placedDrawing(pointLoad(LOAD_MM * scale, this.legend, label, this.textHeight(scale), labelTurn(this.turn, rig)), at, 0);
    const green = colorMatcher()(LOAD_GREEN);
    const fill = { fillPattern: 1, fillFore: green, fillBack: green, fillOpacity: 100 };
    return [
      ...plan.circles.map((c): Part => ({ shape: { kind: "arc", center: c.center, radius: c.radius, startAngle: 0, sweepAngle: 360 }, attrs: fill })),
      ...markerParts({ ...plan, circles: [] }),
    ];
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to place a load.";
    const units = store.session?.doc.info.units;
    const imperial = imperialUnits(units);
    const path = closed ? [...points, points[0]] : points;
    const length = pathLength(path);
    const w = distributedWeights(this.spreadWeight, this.spread === "total", length, units);
    if (typeof w === "string") return w;
    const label = this.showLabel
      ? [this.showName ? this.loadName : "", this.showCategory ? this.category : "", formatWeight(w.total, imperial), formatPerLength(w.perMm, imperial), formatLength(length, units)]
      : [];
    const plan = distributedLoad(path, label, this.textHeight(scale));
    if (typeof plan === "string") return plan;
    const line: Part = { shape: { kind: "polyline", points, closed }, attrs: { lineWeight: LOAD_WEIGHT, penFore: colorMatcher()(LOAD_YELLOW) } };
    return [line, ...markerParts({ ...plan, lines: [] })];
  }
}
