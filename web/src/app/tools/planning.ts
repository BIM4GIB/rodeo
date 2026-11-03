// The Furniture/Fixtures and Space Planning tool sets' tools. Vectorworks makes plug-in objects of
// them; these draw what those objects draw in plan, as plain 2D objects grouped in the active class.
//
// Table and Chairs: a rectangular table with chairs along its long sides (and at its ends, set in
// Preferences), or a round one with chairs evenly round it; a click places it, a press dragged
// turns it (Shift in 15° steps).
// Desk (straight, or with a left or right return, and its chair), Shelving Unit, Clothes Rod,
// Bath-Shower (a bathtub or a shower tray), Grab Bars, Fireplace and Toilet Stall (a row of stalls
// with their partitions, doors, toilets and turning circles): fixtures against a wall, placed the
// same way with the middle of their back on the point; their plan drawings are Rodeo's own.
// Cabinet (base, with its counter and back splash; utility; or wall), Custom Cabinet (its outline,
// crossed) and Compartment Sink (its counter, rolled edge and backsplash with a row of bowls) stand
// against a wall too.
// Ceiling Grid: an outline drawn as for Space, with the lines between its tiles inside it.
// Seating Section: an outline drawn as for Space, filled with rows of chairs facing one way.
// Outlines are drawn Rectangle (a drag or two clicks) or Polygon (each corner; a double-click, Enter or
// a click on the first corner closes it). Esc cancels. Space, tools/space.ts, draws its outline this way too.

import type { NewShape, Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import { degToRad, dist } from "../geom.ts";
import {
  bath,
  cabinet,
  ceilingGrid,
  clothesRod,
  compartmentSink,
  desk,
  DRAIN_RADIUS,
  fireplace,
  grabBar,
  MAX_CHAIRS,
  MAX_SEATS,
  MAX_TOILET_STALLS,
  rectTable,
  roundTable,
  seatingSection,
  shelving,
  toiletStalls,
  type BathKind,
  type CabinetKind,
  type CompartmentSink,
  type DeskConfig,
  type DoorSwing,
  type SeatAlignment,
  type StallOptions,
  type TableSet,
} from "../planShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { addPieces, PlaceTool, type Part } from "./detailing.ts";

type TableKind = "rect" | "round";

const TABLES: readonly { readonly id: TableKind; readonly label: string }[] = [
  { id: "rect", label: "Rectangular" },
  { id: "round", label: "Round" },
];

export class TableChairsTool extends PlaceTool {
  readonly id = "tablechairs";
  readonly cursor = "crosshair";
  protected readonly label = "Table and Chairs";
  private kind: TableKind = "rect";
  private length = 1800;
  private width = 900;
  private ends = false;
  private diameter = 1200;
  private count = 5;

  modes(): readonly ToolModes[] {
    return [{ label: "Table", options: TABLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = TABLES.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Table and Chairs Preferences",
      [
        { kind: "length", key: "length", label: "Rectangular length", value: this.length },
        { kind: "length", key: "width", label: "Rectangular width", value: this.width },
        { kind: "check", key: "ends", label: "Chairs at the ends", value: this.ends },
        { kind: "length", key: "diameter", label: "Round diameter", value: this.diameter },
        { kind: "number", key: "count", label: "Round chairs", value: this.count, min: 1, max: MAX_CHAIRS, integer: true },
      ],
      "A rectangular table seats a chair for each 600 mm of its length along both long sides.",
    );
    if (!v) return;
    this.length = v.num("length");
    this.width = v.num("width");
    this.ends = v.flag("ends");
    this.diameter = v.num("diameter");
    this.count = v.num("count");
  }

  hint(): string {
    return `${super.hint()} · 1–2 rectangular or round`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set: TableSet | null = this.kind === "rect" ? rectTable(this.length, this.width, this.ends) : roundTable(this.diameter, this.count);
    if (!set) return null;
    const poly = (pts: Pt[]): NewShape => ({ kind: "polygon", points: placed(pts, at, angle), closed: true });
    const table: NewShape =
      "radius" in set.table ? { kind: "arc", center: at, radius: set.table.radius, startAngle: 0, sweepAngle: 360 } : poly(set.table);
    // the table over its chairs, so it hides the seats' fronts tucked under its edge
    return [...set.chairs.flatMap((c) => [poly(c.seat), poly(c.back)]), table];
  }

  protected refusal(): string {
    return `Table and Chairs seats up to ${MAX_CHAIRS}: set a shorter table in Preferences.`;
  }
}

/** A closed outline placed at `at`, turned by `angle`. */
function outlineAt(pts: readonly Pt[], at: Pt, angle: number): NewShape {
  return { kind: "polygon", points: placed(pts, at, angle), closed: true };
}

/** A fixture that stands against a wall: a click puts the middle of its back on the point, a drag turns it along the wall, its front to the drag's right. */
abstract class WallFixtureTool extends PlaceTool {
  readonly cursor = "crosshair";

  hint(): string {
    return `${super.hint()} · its back's middle on the point`;
  }
}

const DESK_CONFIGS: readonly { readonly id: DeskConfig; readonly label: string }[] = [
  { id: "straight", label: "Straight" },
  { id: "left", label: "Left Return" },
  { id: "right", label: "Right Return" },
];

export class DeskTool extends WallFixtureTool {
  readonly id = "desk";
  protected readonly label = "Desk";
  private config: DeskConfig = "straight";
  private width = 1500;
  private depth = 750;
  private returnWidth = 900;
  private returnDepth = 500;
  private withChair = true;

  modes(): readonly ToolModes[] {
    return [{ label: "Config", options: DESK_CONFIGS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.config }];
  }

  setMode(id: string): void {
    const config = DESK_CONFIGS.find((m) => m.id === id);
    if (config) this.config = config.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Desk Preferences",
      [
        { kind: "length", key: "width", label: "Top width", value: this.width },
        { kind: "length", key: "depth", label: "Top depth", value: this.depth },
        { kind: "length", key: "returnWidth", label: "Return width", value: this.returnWidth },
        { kind: "length", key: "returnDepth", label: "Return depth", value: this.returnDepth },
        { kind: "check", key: "chair", label: "Chair", value: this.withChair },
      ],
      "A return runs forward from the left or right end of the desk's front, its width measured from that front.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.depth = v.num("depth");
    this.returnWidth = v.num("returnWidth");
    this.returnDepth = v.num("returnDepth");
    this.withChair = v.flag("chair");
  }

  hint(): string {
    return `${super.hint()} · 1–3 config`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set = desk(this.width, this.depth, this.config, this.returnWidth, this.returnDepth, this.withChair);
    if (!set) return null;
    // the top over the chair, so it hides the seat's front tucked under its edge
    return [...(set.chair ? [outlineAt(set.chair.seat, at, angle), outlineAt(set.chair.back, at, angle)] : []), outlineAt(set.top, at, angle)];
  }

  protected refusal(): string {
    return "A desk's return must be narrower than the desk, and leave a chair's width (450 mm) of its front open: change the Desk Preferences.";
  }
}

export class ShelvingTool extends WallFixtureTool {
  readonly id = "shelving";
  protected readonly label = "Shelving Unit";
  private width = 900;
  private depth = 300;
  private thickness = 19;
  private back = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Shelving Unit Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "depth", label: "Depth", value: this.depth },
        { kind: "length", key: "thickness", label: "Thickness", value: this.thickness },
        { kind: "check", key: "back", label: "Back", value: this.back },
      ],
      "Drawn as cut in plan: the sides, the back and the shelf between them.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.depth = v.num("depth");
    this.thickness = v.num("thickness");
    this.back = v.flag("back");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    return shelving(this.width, this.depth, this.thickness, this.back)?.map((pts) => outlineAt(pts, at, angle)) ?? null;
  }

  protected refusal(): string {
    return "The shelving unit's panels are too thick for its size: change the Shelving Unit Preferences.";
  }
}

export class ClothesRodTool extends WallFixtureTool {
  readonly id = "clothesrod";
  protected readonly label = "Clothes Rod";
  private length = 1200;
  private rodFrom = 300;
  private withShelf = true;
  private shelfDepth = 350;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Clothes Rod Preferences",
      [
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "length", key: "rodFrom", label: "Rod from wall", value: this.rodFrom },
        { kind: "check", key: "shelf", label: "Shelf", value: this.withShelf },
        { kind: "length", key: "shelfDepth", label: "Shelf depth", value: this.shelfDepth },
      ],
      "The rod's centre line is drawn over the shelf above it.",
    );
    if (!v) return;
    this.length = v.num("length");
    this.rodFrom = v.num("rodFrom");
    this.withShelf = v.flag("shelf");
    this.shelfDepth = v.num("shelfDepth");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set = clothesRod(this.length, this.rodFrom, this.withShelf ? this.shelfDepth : null);
    if (!set) return null;
    const [a, b] = placed(set.rod, at, angle);
    return [...(set.shelf ? [outlineAt(set.shelf, at, angle)] : []), { kind: "line", a, b }];
  }

  protected refusal(): string {
    return "The rod must be under the shelf: set a shelf deeper than the rod's distance from the wall in the Clothes Rod Preferences.";
  }
}

const BATH_KINDS: readonly { readonly id: BathKind; readonly label: string }[] = [
  { id: "tub", label: "Bathtub" },
  { id: "shower", label: "Shower" },
];

export class BathShowerTool extends WallFixtureTool {
  readonly id = "bathshower";
  protected readonly label = "Bath-Shower";
  private kind: BathKind = "tub";
  private tubWidth = 1700;
  private tubDepth = 750;
  private showerWidth = 900;
  private showerDepth = 900;
  private side = 75;
  private drainFrom = 150;

  modes(): readonly ToolModes[] {
    return [{ label: "Config", options: BATH_KINDS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = BATH_KINDS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Bath-Shower Preferences",
      [
        { kind: "length", key: "tubWidth", label: "Bathtub width", value: this.tubWidth },
        { kind: "length", key: "tubDepth", label: "Bathtub depth", value: this.tubDepth },
        { kind: "length", key: "showerWidth", label: "Shower width", value: this.showerWidth },
        { kind: "length", key: "showerDepth", label: "Shower depth", value: this.showerDepth },
        { kind: "length", key: "side", label: "Side thickness", value: this.side },
        { kind: "length", key: "drainFrom", label: "Bathtub drain offset", value: this.drainFrom },
      ],
      "A bathtub's drain is the offset in from its basin's left end; a shower's is in the middle, with falls to it.",
    );
    if (!v) return;
    this.tubWidth = v.num("tubWidth");
    this.tubDepth = v.num("tubDepth");
    this.showerWidth = v.num("showerWidth");
    this.showerDepth = v.num("showerDepth");
    this.side = v.num("side");
    this.drainFrom = v.num("drainFrom");
  }

  hint(): string {
    return `${super.hint()} · 1–2 bathtub or shower`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const tub = this.kind === "tub";
    const set = bath(this.kind, tub ? this.tubWidth : this.showerWidth, tub ? this.tubDepth : this.showerDepth, this.side, this.drainFrom);
    if (!set) return null;
    const falls = set.falls.map(([p, q]): NewShape => {
      const [a, b] = placed([p, q], at, angle);
      return { kind: "line", a, b };
    });
    const [center] = placed([set.drain.center], at, angle);
    return [outlineAt(set.outline, at, angle), outlineAt(set.basin, at, angle), ...falls, { kind: "arc", center, radius: set.drain.radius, startAngle: 0, sweepAngle: 360 }];
  }

  protected refusal(): string {
    return "The sides leave no room for the basin and its drain: change the Bath-Shower Preferences.";
  }
}

export class GrabBarTool extends WallFixtureTool {
  readonly id = "grabbars";
  protected readonly label = "Grab Bars";
  private length = 900;
  private diameter = 32;
  private clearance = 38;

  async preferences(): Promise<void> {
    const v = await toolPrefs("Grab Bars Preferences", [
      { kind: "length", key: "length", label: "Length", value: this.length },
      { kind: "length", key: "diameter", label: "Diameter", value: this.diameter },
      { kind: "length", key: "clearance", label: "Wall clearance", value: this.clearance },
    ]);
    if (!v) return;
    this.length = v.num("length");
    this.diameter = v.num("diameter");
    this.clearance = v.num("clearance");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set = grabBar(this.length, this.diameter, this.clearance);
    if (!set) return null;
    return [outlineAt(set.bar, at, angle), ...set.flanges.map((f) => outlineAt(f, at, angle))];
  }

  protected refusal(): string {
    return "The grab bar is too short for its diameter: change the Grab Bars Preferences.";
  }
}

export class FireplaceTool extends WallFixtureTool {
  readonly id = "fireplace";
  protected readonly label = "Fireplace";
  private width = 1200;
  private rearWidth = 900;
  private depth = 600;
  private openingWidth = 750;
  private fireboxDepth = 400;
  private flue = true;
  private flueDiameter = 250;
  private flueOffset = 200;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Fireplace Preferences",
      [
        { kind: "length", key: "width", label: "Unit width", value: this.width },
        { kind: "length", key: "rearWidth", label: "Rear width", value: this.rearWidth },
        { kind: "length", key: "depth", label: "Unit depth", value: this.depth },
        { kind: "length", key: "openingWidth", label: "Opening width", value: this.openingWidth },
        { kind: "length", key: "fireboxDepth", label: "Firebox depth", value: this.fireboxDepth },
        { kind: "check", key: "flue", label: "Top flue", value: this.flue },
        { kind: "length", key: "flueDiameter", label: "Flue diameter", value: this.flueDiameter },
        { kind: "length", key: "flueOffset", label: "Flue offset", value: this.flueOffset },
      ],
      "The unit width is its front's, the rear width its back's against the wall. The flue's offset is its centre's from the back.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.rearWidth = v.num("rearWidth");
    this.depth = v.num("depth");
    this.openingWidth = v.num("openingWidth");
    this.fireboxDepth = v.num("fireboxDepth");
    this.flue = v.flag("flue");
    this.flueDiameter = v.num("flueDiameter");
    this.flueOffset = v.num("flueOffset");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const flue = this.flue ? { diameter: this.flueDiameter, offset: this.flueOffset } : null;
    const set = fireplace(this.width, this.rearWidth, this.depth, this.openingWidth, this.fireboxDepth, flue);
    if (!set) return null;
    const out: Part[] = [outlineAt(set.outline, at, angle), outlineAt(set.firebox, at, angle)];
    if (set.flue) {
      const [center] = placed([set.flue.center], at, angle);
      out.push({ kind: "arc", center, radius: set.flue.radius, startAngle: 0, sweepAngle: 360 });
    }
    return out;
  }

  protected refusal(): string {
    return "The opening, firebox or flue doesn't fit inside the fireplace: change the Fireplace Preferences.";
  }
}

const CABINETS: readonly { readonly id: CabinetKind; readonly label: string }[] = [
  { id: "base", label: "Base Cabinet" },
  { id: "utility", label: "Utility Cabinet" },
  { id: "wall", label: "Wall Cabinet" },
];

export class CabinetTool extends WallFixtureTool {
  readonly id = "cabinet";
  protected readonly label = "Cabinet";
  private kind: CabinetKind = "base";
  private length = 600;
  private depths: Record<CabinetKind, number> = { base: 600, utility: 600, wall: 330 };
  private counter = true;
  private overhang = 25;
  private splash = true;
  private splashThickness = 20;

  modes(): readonly ToolModes[] {
    return [{ label: "Cabinet", options: CABINETS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = CABINETS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Cabinet Preferences",
      [
        { kind: "length", key: "length", label: "Length", value: this.length },
        { kind: "length", key: "base", label: "Base cabinet depth", value: this.depths.base },
        { kind: "length", key: "utility", label: "Utility cabinet depth", value: this.depths.utility },
        { kind: "length", key: "wall", label: "Wall cabinet depth", value: this.depths.wall },
        { kind: "check", key: "counter", label: "Draw counter", value: this.counter },
        { kind: "length", key: "overhang", label: "Counter overhang", value: this.overhang },
        { kind: "check", key: "splash", label: "Back splash", value: this.splash },
        { kind: "length", key: "splashThickness", label: "Splash thickness", value: this.splashThickness },
      ],
      "A base cabinet's counter reaches the overhang past its front. A utility cabinet is drawn crossed, a wall cabinet with one diagonal.",
    );
    if (!v) return;
    this.length = v.num("length");
    this.depths = { base: v.num("base"), utility: v.num("utility"), wall: v.num("wall") };
    this.counter = v.flag("counter");
    this.overhang = v.num("overhang");
    this.splash = v.flag("splash");
    this.splashThickness = v.num("splashThickness");
  }

  hint(): string {
    return `${super.hint()} · 1–3 base, utility or wall`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const counter = this.counter ? { overhang: this.overhang, splash: this.splash ? this.splashThickness : null } : null;
    const set = cabinet(this.kind, this.length, this.depths[this.kind], counter);
    if (!set) return null;
    const lines = set.lines.map(([p, q]): Part => {
      const [a, b] = placed([p, q], at, angle);
      return { kind: "line", a, b };
    });
    return [outlineAt(set.carcass, at, angle), ...lines, ...[set.counter, set.splash].flatMap((pts) => (pts ? [outlineAt(pts, at, angle)] : []))];
  }

  protected refusal(): string {
    return "The back splash must be thinner than the counter is deep: change the Cabinet Preferences.";
  }
}

export class CustomCabinetTool extends WallFixtureTool {
  readonly id = "customcab";
  protected readonly label = "Custom Cabinet";
  private width = 900;
  private depth = 600;
  private height = 2100;
  private diagonals = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Custom Cabinet Preferences",
      [
        { kind: "length", key: "height", label: "Height", value: this.height },
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "depth", label: "Depth", value: this.depth },
        { kind: "check", key: "diagonals", label: "Show Diagonals in Top/Plan view", value: this.diagonals },
      ],
      "Drawn in plan as its outline, crossed with Show Diagonals. Its columns, boxes, doors, drawers, plinth and scribe show only in Vectorworks' front and 3D views, which Rodeo doesn't draw for it; the height is kept for the next one.",
    );
    if (!v) return;
    this.height = v.num("height");
    this.width = v.num("width");
    this.depth = v.num("depth");
    this.diagonals = v.flag("diagonals");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const w = this.width / 2;
    const d = this.depth;
    const box = [{ x: -w, y: -d }, { x: w, y: -d }, { x: w, y: 0 }, { x: -w, y: 0 }];
    const diagonals = this.diagonals
      ? [
          [box[0], box[2]],
          [box[1], box[3]],
        ].map(([p, q]): Part => {
          const [a, b] = placed([p, q], at, angle);
          return { kind: "line", a, b };
        })
      : [];
    return [outlineAt(box, at, angle), ...diagonals];
  }
}

export class CompartmentSinkTool extends WallFixtureTool {
  readonly id = "compsink";
  protected readonly label = "Compartment Sink";
  private s: CompartmentSink = {
    length: 1800,
    width: 600,
    edge: 40,
    splash: 20,
    bowls: 3,
    bowlLength: 450,
    bowlWidth: 450,
    bowlRadius: 25,
    offsetLength: 0,
    offsetWidth: 0,
    between: 50,
  };
  private showBowls = true;

  async preferences(): Promise<void> {
    const s = this.s;
    const v = await toolPrefs(
      "Compartment Sink Preferences",
      [
        { kind: "length", key: "length", label: "Ctr Length", value: s.length },
        { kind: "length", key: "width", label: "Ctr Width", value: s.width },
        { kind: "length", key: "edge", label: "Ctr Edge Dia", value: s.edge, zero: true },
        { kind: "length", key: "splash", label: "Splash Thk", value: s.splash, zero: true },
        { kind: "check", key: "show", label: "Show Bowls", value: this.showBowls },
        { kind: "number", key: "bowls", label: "Num Bowls", value: s.bowls, min: 1, max: 20, integer: true },
        { kind: "length", key: "bowlLength", label: "Bowl Length", value: s.bowlLength },
        { kind: "length", key: "bowlWidth", label: "Bowl Width", value: s.bowlWidth },
        { kind: "length", key: "radius", label: "Bowl Corner Radii", value: s.bowlRadius, zero: true },
        { kind: "length", key: "offLength", label: "Bowl Offset Length", value: s.offsetLength, signed: true },
        { kind: "length", key: "offWidth", label: "Bowl Offset Width", value: s.offsetWidth, signed: true },
        { kind: "length", key: "between", label: "Dim Between Bowls", value: s.between, zero: true },
      ],
      "The counter's back stands on the wall, the backsplash along it; the rolled edge's inner line runs Ctr Edge Dia in from its front and ends. The bowls sit in a row centred in front of the splash, moved by the offsets (to the right, and toward the back), each with a drain at its middle. Heights, depths, legs and braces are 3D and aren't drawn.",
    );
    if (!v) return;
    this.showBowls = v.flag("show");
    this.s = {
      length: v.num("length"),
      width: v.num("width"),
      edge: v.num("edge"),
      splash: v.num("splash"),
      bowls: v.num("bowls"),
      bowlLength: v.num("bowlLength"),
      bowlWidth: v.num("bowlWidth"),
      bowlRadius: v.num("radius"),
      offsetLength: v.num("offLength"),
      offsetWidth: v.num("offWidth"),
      between: v.num("between"),
    };
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set = compartmentSink({ ...this.s, bowls: this.showBowls ? this.s.bowls : 0 });
    if (!set) return null;
    const outlines = [set.counter, set.rim, set.splash, ...set.bowls].flatMap((pts): Part[] => (pts ? [outlineAt(pts, at, angle)] : []));
    const drains = set.drains.map((c): Part => ({ kind: "arc", center: placed([c], at, angle)[0], radius: DRAIN_RADIUS, startAngle: 0, sweepAngle: 360 }));
    return [...outlines, ...drains];
  }

  protected refusal(): string {
    return "The bowls don't fit on the counter inside its edge and in front of the splash, or the edge and splash leave no counter: change the Compartment Sink Preferences.";
  }
}

const SWINGS: readonly { readonly value: DoorSwing; readonly label: string }[] = [
  { value: "in", label: "In" },
  { value: "out", label: "Out" },
];

export class ToiletStallTool extends WallFixtureTool {
  readonly id = "toiletstall";
  protected readonly label = "Toilet Stall";
  private stalls: StallOptions = {
    count: 1,
    width: 900,
    depth: 1500,
    thickness: 25,
    left: true,
    dividing: true,
    right: true,
    front: true,
    door: { width: 600, offset: 50, swing: "in" },
    fixture: true,
    turningCircle: false,
  };
  private doorWidth = 600;
  private doorOffset = 50;
  private swing: DoorSwing = "in";

  async preferences(): Promise<void> {
    const s = this.stalls;
    const v = await toolPrefs(
      "Toilet Stall Preferences",
      [
        { kind: "number", key: "count", label: "Number of stalls", value: s.count, min: 1, max: MAX_TOILET_STALLS, integer: true },
        { kind: "length", key: "width", label: "Stall width", value: s.width },
        { kind: "length", key: "depth", label: "Stall depth", value: s.depth },
        { kind: "length", key: "thickness", label: "Partition thickness", value: s.thickness },
        { kind: "check", key: "left", label: "Left partition", value: s.left },
        { kind: "check", key: "dividing", label: "Dividing partitions", value: s.dividing },
        { kind: "check", key: "right", label: "Right partition", value: s.right },
        { kind: "check", key: "front", label: "Front partition", value: s.front },
        { kind: "check", key: "door", label: "Door", value: s.door !== null },
        { kind: "length", key: "doorWidth", label: "Door width", value: this.doorWidth },
        { kind: "length", key: "doorOffset", label: "Door offset", value: this.doorOffset },
        { kind: "choice", key: "swing", label: "Door swing", value: this.swing, options: SWINGS },
        { kind: "check", key: "fixture", label: "Show fixture", value: s.fixture },
        { kind: "check", key: "turningCircle", label: "Show turning circle", value: s.turningCircle },
      ],
      "The door is in the front partition, its offset measured from the stall's left partition; without the front partition there is no door. The turning circle is 60 in (1524 mm) across.",
    );
    if (!v) return;
    this.doorWidth = v.num("doorWidth");
    this.doorOffset = v.num("doorOffset");
    this.swing = v.choice("swing") === "out" ? "out" : "in";
    this.stalls = {
      count: v.num("count"),
      width: v.num("width"),
      depth: v.num("depth"),
      thickness: v.num("thickness"),
      left: v.flag("left"),
      dividing: v.flag("dividing"),
      right: v.flag("right"),
      front: v.flag("front"),
      door: v.flag("door") ? { width: this.doorWidth, offset: this.doorOffset, swing: this.swing } : null,
      fixture: v.flag("fixture"),
      turningCircle: v.flag("turningCircle"),
    };
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const set = toiletStalls(this.stalls);
    if (!set) return null;
    const deg = (angle * 180) / Math.PI;
    const doors = set.doors.flatMap((d): Part[] => {
      const [center] = placed([d.hinge], at, angle);
      return [outlineAt(d.leaf, at, angle), { kind: "arc", center, radius: d.radius, startAngle: d.start + deg, sweepAngle: d.sweep }];
    });
    const circles = set.circles.map((c): Part => {
      const [center] = placed([c.center], at, angle);
      return { kind: "arc", center, radius: c.radius, startAngle: 0, sweepAngle: 360 };
    });
    return [...set.panels.map((p) => outlineAt(p, at, angle)), ...doors, ...set.fixtures.map((f) => outlineAt(f, at, angle)), ...circles];
  }

  protected refusal(): string {
    return "The stalls don't fit their doors, toilets or turning circles: change the Toilet Stall Preferences.";
  }
}

type OutlineMode = "rectangle" | "polygon";

const OUTLINE_MODES: readonly { readonly id: OutlineMode; readonly label: string }[] = [
  { id: "rectangle", label: "Rectangle" },
  { id: "polygon", label: "Polygon" },
];
/** the name's and the area's heights on paper, mm */
const NAME_MM = 3.5;
const AREA_MM = 2.5;
/** pointer travel (CSS px) below which a press is a click; clicks this close to the first corner close a polygon */
const CLICK_PX = 4;
const CLOSE_PX = 6;
/** Vectorworks' centre justification and vertical centre */
const H_CENTRE = 2;
const V_CENTRE = 3;

/**
 * A tool that draws an area from its outline, Rectangle (a drag or two clicks) or Polygon (each
 * corner; a double-click, Enter or a click on the first corner closes it): Space here, and
 * Hardscape, Landscape Area and Property Line (site.ts). Esc cancels.
 */
export abstract class OutlineTool extends BaseTool {
  readonly cursor = "crosshair";
  /** the Mode bar's name for the two modes */
  protected abstract readonly modeLabel: string;
  private mode: OutlineMode = "rectangle";
  /** corners placed so far (a rectangle's first corner, or the polygon's) */
  private points: Pt[] = [];
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  /** Adds what the tool makes of an outline's corners (as drawn, either way round). */
  protected abstract made(corners: Pt[]): void;

  modes(): readonly ToolModes[] {
    return [{ label: this.modeLabel, options: OUTLINE_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = OUTLINE_MODES.find((m) => m.id === id);
    if (!mode || mode.id === this.mode) return;
    this.mode = mode.id;
    this.reset();
  }

  hint(): string {
    if (this.mode === "rectangle") return this.points.length === 0 ? "Drag a rectangle or click two corners · 1–2 mode" : "Click or release at the opposite corner";
    return this.points.length === 0 ? "Click the first corner · 1–2 mode" : "Click the next corner · Enter closes";
  }

  down(p: PointerInfo): void {
    this.pressScreen = p.screen;
    if (this.mode === "rectangle") {
      if (this.points.length === 0) this.points = [p.pos];
      else this.finish(this.corners([...this.points, p.pos]));
      return;
    }
    const first = this.points[0];
    if (this.points.length >= 3 && dist(p.pos, first) * this.env.view.scale <= CLOSE_PX) {
      this.finish(this.points);
      return;
    }
    const last = this.points.at(-1);
    if (!last || dist(last, p.pos) * this.env.view.scale > CLICK_PX) this.points.push(p.pos);
    if (p.detail >= 2) this.finish(this.points);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  up(p: PointerInfo): void {
    // a drag in rectangle mode places the opposite corner where it is released
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.mode !== "rectangle" || this.points.length !== 1 || !press) return;
    if (dist(p.screen, press) > CLICK_PX) this.finish(this.corners([this.points[0], p.pos]));
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.points.length === 0) return false;
    if (e.key === "Enter" && this.mode === "polygon") this.finish(this.points);
    else if (e.key === "Escape") this.reset();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at || this.points.length === 0) return;
    const pts = this.mode === "rectangle" ? this.corners([this.points[0], at]) : [...this.points, at];
    withPreview(g, () => strokeScreen(g, pts, this.mode === "rectangle"));
  }

  /** The active layer's scale (1:n gives n), or null without a layer. */
  protected layerScale(): number | null {
    const layerId = store.activeLayerId;
    const layer = layerId ? this.env.scene.layer(layerId) : undefined;
    return layer ? layer.scale || 1 : null;
  }

  /** A rectangle's four corners from two opposite ones. */
  private corners([a, b]: Pt[]): Pt[] {
    return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  }

  private finish(corners: Pt[]): void {
    this.reset();
    this.made(corners);
  }

  private reset(): void {
    this.points = [];
    this.pressScreen = null;
  }
}

/** A name and an area, `name` above `area`, centred on `at`, at the heights given on paper times `scale`; the name left out when empty. */
export function areaLabel(at: Pt, name: string, area: string, scale: number): Part[] {
  const nameH = NAME_MM * scale;
  const areaH = AREA_MM * scale;
  const text = (y: number, value: string, height: number): Part => ({ kind: "text", at: { x: at.x, y }, text: value, height, hAlign: H_CENTRE, vAlign: V_CENTRE });
  return [...(name ? [text(at.y + 0.6 * nameH, name, nameH)] : []), text(name ? at.y - 0.6 * nameH : at.y, area, areaH)];
}

export class CeilingGridTool extends OutlineTool {
  readonly id = "ceilinggrid";
  protected readonly modeLabel = "Ceiling Grid";
  private width = 600;
  private length = 1200;
  /** degrees */
  private angle = 0;
  private centred = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Ceiling Grid Preferences",
      [
        { kind: "length", key: "width", label: "Tile width", value: this.width },
        { kind: "length", key: "length", label: "Tile length", value: this.length },
        { kind: "number", key: "angle", label: "Angle", value: this.angle, min: -180, max: 180, unit: "°" },
        { kind: "check", key: "centred", label: "Centre the tiles", value: this.centred },
      ],
      "A tile's width runs along the angle. Centred, a tile sits in the middle of the ceiling; otherwise the grid is laid from the drawing's origin, so neighbouring ceilings line up.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.length = v.num("length");
    this.angle = v.num("angle");
    this.centred = v.flag("centred");
  }

  protected made(corners: Pt[]): void {
    const grid = ceilingGrid(corners, this.width, this.length, degToRad(this.angle), this.centred);
    if (!grid) {
      toast("Draw a ceiling with some area, or set larger tiles in Preferences.", "info");
      return;
    }
    addPieces("Ceiling Grid", [
      [{ kind: "polygon", points: grid.outline, closed: true }, ...grid.lines.map(([a, b]): Part => ({ kind: "polyline", points: [a, b], closed: false }))],
    ]);
  }
}

const ALIGNMENTS: readonly { readonly value: SeatAlignment; readonly label: string }[] = [
  { value: "align", label: "Align Rows" },
  { value: "offset", label: "Offset Rows" },
];

export class SeatingSectionTool extends OutlineTool {
  readonly id = "seating";
  protected readonly modeLabel = "Seating Section";
  private seatSpacing = 550;
  private rowSpacing = 900;
  /** degrees: the way the seats look, −90 toward the bottom of the drawing */
  private facing = -90;
  private alignment: SeatAlignment = "align";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Seating Section Preferences",
      [
        { kind: "length", key: "seatSpacing", label: "Seat spacing", value: this.seatSpacing },
        { kind: "length", key: "rowSpacing", label: "Row spacing", value: this.rowSpacing },
        { kind: "number", key: "facing", label: "Seats face", value: this.facing, min: -180, max: 180, unit: "°" },
        { kind: "choice", key: "alignment", label: "Alignment", value: this.alignment, options: ALIGNMENTS },
      ],
      "Seat spacing is centre to centre along a row, row spacing front to front. The first row is at the section's front; seats are placed where they fit inside its outline. −90° faces the bottom of the drawing.",
    );
    if (!v) return;
    this.seatSpacing = v.num("seatSpacing");
    this.rowSpacing = v.num("rowSpacing");
    this.facing = v.num("facing");
    this.alignment = v.choice("alignment") === "offset" ? "offset" : "align";
  }

  protected made(corners: Pt[]): void {
    const section = seatingSection(corners, degToRad(this.facing), this.seatSpacing, this.rowSpacing, this.alignment);
    if (!section) {
      toast(`Draw a seating section with some area, with spacings no closer than a chair, for up to ${MAX_SEATS} seats.`, "info");
      return;
    }
    const seats = section.chairs.flatMap((c): Part[] => [
      { kind: "polygon", points: c.seat, closed: true },
      { kind: "polygon", points: c.back, closed: true },
    ]);
    addPieces("Seating Section", [[{ kind: "polygon", points: section.outline, closed: true }, ...seats]]);
    toast(`${section.chairs.length} seat${section.chairs.length === 1 ? "" : "s"}`, "info");
  }
}
