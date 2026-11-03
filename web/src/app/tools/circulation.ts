// Building Shell's Elevator, Escalator, Ramp and Simple Stair (circulationShapes.ts). Vectorworks
// makes plug-in objects of them; these draw what those objects draw in Top/Plan, as plain 2D
// objects grouped in the active class. Each takes a click, or a press dragged to turn it (Shift in
// 15° steps): an elevator with the middle of its hoistway's front on the point and the hoistway to
// the drag's right; an escalator, ramp or stair with the middle of its bottom on the point, rising
// toward the drag. Their heights and 3D aren't drawn.

import type { Pt } from "../../core/index.ts";
import {
  CUT_HEIGHT,
  elevator,
  elevatorProblem,
  escalator,
  HEADROOM,
  LANDING_PLATE,
  MAX_RISERS,
  ramp,
  rampProblem,
  simpleStair,
  simpleStairProblem,
  STEP_DEPTH,
  type Balustrade,
  type Elevator,
  type ElevatorDoors,
  type ElevatorDoorType,
  type Escalator,
  type EscalatorCut,
  type FlightConfig,
  type Ramp,
  type SimpleStair,
  type StairConfig,
  type TravelArrow,
} from "../circulationShapes.ts";
import { placed } from "../detailShapes.ts";
import type { MarkerDrawing } from "../markerShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatLengthValue } from "../units.ts";
import { PlaceTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** the text on a stair, on paper, mm */
const TEXT_MM = 2.5;

/** `d` placed at `at`, turned by `angle` radians, its texts kept the right way up. */
export function placedDrawing(d: MarkerDrawing, at: Pt, angle: number): MarkerDrawing {
  const move = (pts: readonly Pt[]): Pt[] => placed(pts, at, angle);
  const deg = (angle * 180) / Math.PI;
  return {
    outlines: d.outlines.map(move),
    lines: d.lines.map(move),
    circles: d.circles.map((c) => ({ center: move([c.center])[0], radius: c.radius })),
    filled: d.filled.map(move),
    texts: d.texts.map((t) => {
      // turned to read left to right or upward: within (−90°, 90°]
      let a = ((((t.angle ?? 0) + deg) % 360) + 360) % 360;
      if (a > 270) a -= 360;
      else if (a > 90) a -= 180;
      return { ...t, at: move([t.at])[0], angle: a };
    }),
  };
}

const FRONT_DOORS: readonly { readonly value: Exclude<ElevatorDoors, "none">; readonly label: string }[] = [
  { value: "both", label: "Cab and Wall Doors" },
  { value: "cab", label: "Cab Door Only" },
];
const REAR_DOORS: readonly { readonly value: ElevatorDoors; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "cab", label: "Cab Door Only" },
  { value: "both", label: "Cab and Wall Doors" },
];
const DOOR_TYPES: readonly { readonly value: ElevatorDoorType; readonly label: string }[] = [
  { value: "single", label: "Single Slide" },
  { value: "bipass", label: "Side Bi-pass" },
  { value: "bipart", label: "Bi-part" },
  { value: "bipart2", label: "Two-Speed Bi-part" },
];

export class ElevatorTool extends PlaceTool {
  readonly id = "elevator";
  readonly cursor = "crosshair";
  protected readonly label = "Elevator";
  private e: Elevator = {
    hoistwayWidth: 2100,
    hoistwayDepth: 1800,
    front: "both",
    rear: "none",
    doorType: "bipart",
    doorWidth: 1000,
    doorOffset: 0,
    cab: true,
    cabWidth: 1700,
    cabDepth: 1300,
    cabWall: 25,
    cabOffset: 0,
    clearance: 75,
  };

  async preferences(): Promise<void> {
    const e = this.e;
    const v = await toolPrefs(
      "Elevator Preferences",
      [
        { kind: "length", key: "width", label: "Hoistway Width", value: e.hoistwayWidth },
        { kind: "length", key: "depth", label: "Hoistway Depth", value: e.hoistwayDepth },
        { kind: "choice", key: "front", label: "Front Door", value: e.front, options: FRONT_DOORS },
        { kind: "choice", key: "rear", label: "Rear Door", value: e.rear, options: REAR_DOORS },
        { kind: "choice", key: "type", label: "Door Type", value: e.doorType, options: DOOR_TYPES },
        { kind: "length", key: "doorWidth", label: "Door Width", value: e.doorWidth },
        { kind: "length", key: "doorOffset", label: "Door Offset", value: e.doorOffset, signed: true },
        { kind: "check", key: "cab", label: "Cab Display", value: e.cab },
        { kind: "length", key: "cabWidth", label: "Internal Cab Width", value: e.cabWidth },
        { kind: "length", key: "cabDepth", label: "Internal Cab Depth", value: e.cabDepth },
        { kind: "length", key: "cabWall", label: "Cab Wall Thickness", value: e.cabWall },
        { kind: "length", key: "cabOffset", label: "Cab Offset X", value: e.cabOffset, signed: true },
        { kind: "length", key: "clearance", label: "Front Cab Clearance", value: e.clearance, zero: true },
      ],
      "The hoistway's front middle goes on the click, the hoistway behind it to the drag's right. The doors stand open beside their openings, each leaf 25 mm thick: the cab's in front of the cab, the wall's just outside the hoistway. Door Offset moves the opening from the cab's middle, Cab Offset X the cab from the hoistway's. The door and cab heights and the 3D aren't drawn.",
    );
    if (!v) return;
    this.e = {
      hoistwayWidth: v.num("width"),
      hoistwayDepth: v.num("depth"),
      front: FRONT_DOORS.find((d) => d.value === v.choice("front"))?.value ?? "both",
      rear: REAR_DOORS.find((d) => d.value === v.choice("rear"))?.value ?? "none",
      doorType: DOOR_TYPES.find((d) => d.value === v.choice("type"))?.value ?? "bipart",
      doorWidth: v.num("doorWidth"),
      doorOffset: v.num("doorOffset"),
      cab: v.flag("cab"),
      cabWidth: v.num("cabWidth"),
      cabDepth: v.num("cabDepth"),
      cabWall: v.num("cabWall"),
      cabOffset: v.num("cabOffset"),
      clearance: v.num("clearance"),
    };
  }

  hint(): string {
    return `${super.hint()} · the hoistway's front middle on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const d = elevator(this.e);
    return d && markerParts(placedDrawing(d, at, angle));
  }

  protected refusal(): string {
    return elevatorProblem(this.e) ?? "The elevator can't be drawn.";
  }
}

const SLOPES = ["27.3", "30", "35"].map((v) => ({ value: v, label: `${v}°` }));
const STEP_WIDTHS = ["600", "800", "1000"].map((v) => ({ value: v, label: `${v} mm` }));
const LEAD_INS = ["2", "3", "4"].map((v) => ({ value: v, label: `${v} steps` }));
const BALUSTRADES: readonly { readonly value: Balustrade; readonly label: string }[] = [
  { value: "glass", label: "Glass" },
  { value: "solid", label: "Solid" },
];
const CUTS: readonly { readonly value: EscalatorCut; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

export class EscalatorTool extends PlaceTool {
  readonly id = "escalator";
  readonly cursor = "crosshair";
  protected readonly label = "Escalator";
  private e: Escalator = { height: 4500, slope: 30, stepWidth: 1000, leadIn: 2, balustrade: "glass", cut: "none", floorDepth: 500, pit: true, headroom: true };

  async preferences(): Promise<void> {
    const e = this.e;
    const v = await toolPrefs(
      "Escalator Preferences",
      [
        { kind: "length", key: "height", label: "Height", value: e.height },
        { kind: "choice", key: "slope", label: "Slope angle", value: String(e.slope), options: SLOPES },
        { kind: "choice", key: "step", label: "Step width", value: String(e.stepWidth), options: STEP_WIDTHS },
        { kind: "choice", key: "lead", label: "Horizontal lead in", value: String(e.leadIn), options: LEAD_INS },
        { kind: "choice", key: "balustrade", label: "Balustrade type", value: e.balustrade, options: BALUSTRADES },
        { kind: "choice", key: "cut", label: "Section cut", value: e.cut, options: CUTS },
        { kind: "length", key: "floor", label: "Floor depth above", value: e.floorDepth, zero: true },
        { kind: "check", key: "pit", label: "Show pit", value: e.pit },
        { kind: "check", key: "headroom", label: "Show headroom", value: e.headroom },
      ],
      `The bottom end's middle goes on the click, the escalator rising toward the drag. Rodeo draws ${STEP_DEPTH} mm steps between ${LANDING_PLATE} mm landing plates, glass balustrades 300 mm and solid ones 350 mm beside the steps. Up shows what's below a cut ${CUT_HEIGHT} mm above the lower floor, Down what's above it. The pit is the bottom landing and the truss that dips below the floor; the headroom outline is the opening the upper floor needs where the steps come within ${HEADROOM} mm of its underside.`,
    );
    if (!v) return;
    this.e = {
      height: v.num("height"),
      slope: Number(v.choice("slope")) || 30,
      stepWidth: Number(v.choice("step")) || 1000,
      leadIn: Number(v.choice("lead")) || 2,
      balustrade: BALUSTRADES.find((b) => b.value === v.choice("balustrade"))?.value ?? "glass",
      cut: CUTS.find((c) => c.value === v.choice("cut"))?.value ?? "none",
      floorDepth: v.num("floor"),
      pit: v.flag("pit"),
      headroom: v.flag("headroom"),
    };
  }

  hint(): string {
    return `${super.hint()} · the bottom end's middle on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const d = escalator(this.e);
    return d && markerParts(placedDrawing(d, at, angle));
  }

  protected refusal(): string {
    return "The escalator needs a height more than 0.";
  }
}

const CONFIGS: readonly { readonly value: FlightConfig; readonly label: string }[] = [
  { value: "straight", label: "Straight" },
  { value: "landing", label: "Straight with Landing" },
  { value: "left", label: "Left Landing" },
  { value: "right", label: "Right Landing" },
  { value: "backLeft", label: "Left Double-back" },
  { value: "backRight", label: "Right Double-back" },
];
const ARROWS: readonly { readonly value: TravelArrow; readonly label: string }[] = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "none", label: "None" },
];

/** A rise over run typed as a fraction ("1/12") or a number; null when it's neither. */
function ratio(text: string): number | null {
  const m = /^\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*$/.exec(text);
  if (!m) return null;
  const v = m[2] === undefined ? Number(m[1]) : Number(m[1]) / Number(m[2]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** A ratio as the fraction 1/n when it is one, else as a number. */
function ratioText(v: number): string {
  const n = 1 / v;
  return Math.abs(n - Math.round(n)) < 1e-9 ? `1/${Math.round(n)}` : String(Number(v.toFixed(6)));
}

export class RampTool extends PlaceTool {
  readonly id = "ramp";
  readonly cursor = "crosshair";
  protected readonly label = "Ramp";
  private r: Omit<Ramp, "textHeight"> = {
    width: 1200,
    height: 750,
    slope: 1 / 12,
    config: "straight",
    landingHeight: 375,
    offset1: 0,
    offset2: 0,
    curved: false,
    stairBreak: false,
    leftRail: true,
    rightRail: true,
    railWidth: 50,
    arrow: "up",
  };

  async preferences(): Promise<void> {
    const r = this.r;
    const v = await toolPrefs(
      "Ramp Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: r.width },
        { kind: "length", key: "height", label: "Height", value: r.height },
        { kind: "text", key: "slope", label: "Rise over Run", value: ratioText(r.slope) },
        { kind: "choice", key: "config", label: "Config", value: r.config, options: CONFIGS },
        { kind: "length", key: "landing", label: "Landing Height", value: r.landingHeight },
        { kind: "length", key: "offset1", label: "Offset 1", value: r.offset1, signed: true },
        { kind: "length", key: "offset2", label: "Offset 2", value: r.offset2, zero: true },
        { kind: "check", key: "curved", label: "Curved landing", value: r.curved },
        { kind: "check", key: "break", label: "2D Stair Break", value: r.stairBreak },
        { kind: "check", key: "left", label: "Left Rail", value: r.leftRail },
        { kind: "check", key: "right", label: "Right Rail", value: r.rightRail },
        { kind: "length", key: "rail", label: "Rail W", value: r.railWidth },
        { kind: "choice", key: "arrow", label: "Arrows (2D view)", value: r.arrow, options: ARROWS },
      ],
      `The bottom's middle goes on the click, the ramp rising toward the drag; each flight's run is the height it climbs over the rise over run (1/12, or a number). The landing is the width long plus Offset 1; a turning landing reaches Offset 2 further toward the turn. A curved landing rounds its outer side. The stair break crosses where the ramp rises past ${CUT_HEIGHT} mm, ending it there. Rails run along the flights, 50 mm in from their sides. The type, thickness, rail height and 3D aren't drawn.`,
    );
    if (!v) return;
    const slope = ratio(v.choice("slope"));
    if (slope === null || slope > 1) toast("Rise over Run must be a fraction like 1/12 or a number more than 0 and at most 1: it stays as it was.", "info");
    this.r = {
      width: v.num("width"),
      height: v.num("height"),
      slope: slope !== null && slope <= 1 ? slope : r.slope,
      config: CONFIGS.find((c) => c.value === v.choice("config"))?.value ?? "straight",
      landingHeight: v.num("landing"),
      offset1: v.num("offset1"),
      offset2: v.num("offset2"),
      curved: v.flag("curved"),
      stairBreak: v.flag("break"),
      leftRail: v.flag("left"),
      rightRail: v.flag("right"),
      railWidth: v.num("rail"),
      arrow: ARROWS.find((a) => a.value === v.choice("arrow"))?.value ?? "up",
    };
  }

  hint(): string {
    return `${super.hint()} · the bottom's middle on the point`;
  }

  private ramp(): Ramp {
    return { ...this.r, textHeight: TEXT_MM * (this.scale() ?? 1) };
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const d = ramp(this.ramp());
    return d && markerParts(placedDrawing(d, at, angle));
  }

  protected refusal(): string {
    return rampProblem(this.ramp()) ?? "The ramp can't be drawn.";
  }
}

const STAIR_CONFIGS: readonly { readonly value: StairConfig; readonly label: string }[] = [
  ...CONFIGS.map((c) => (c.value === "backLeft" || c.value === "backRight" ? { ...c, label: `${c.label} (Even)` } : c)),
  { value: "backLeftOdd", label: "Left Double-back (Irregular)" },
  { value: "backRightOdd", label: "Right Double-back (Irregular)" },
];

export class SimpleStairTool extends PlaceTool {
  readonly id = "simplestair";
  readonly cursor = "crosshair";
  protected readonly label = "Simple Stair";
  private s: Omit<SimpleStair, "textHeight"> = {
    width: 1000,
    height: 2800,
    maxRiser: 180,
    tread: 280,
    config: "straight",
    landingTread: 8,
    separation: 100,
    offset1: 0,
    offset2: 0,
    curved: false,
    stringerWidth: 50,
    stringerOffset: 0,
    lowerBreak: false,
    showData: true,
    topTread: false,
    leftRail: true,
    rightRail: false,
    railWidth: 50,
    arrow: "up",
  };

  async preferences(): Promise<void> {
    const s = this.s;
    const v = await toolPrefs(
      "Simple Stair Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: s.width },
        { kind: "length", key: "height", label: "Flr-Flr Height", value: s.height },
        { kind: "length", key: "riser", label: "Max Riser", value: s.maxRiser },
        { kind: "length", key: "tread", label: "Tread Depth", value: s.tread },
        { kind: "choice", key: "config", label: "Config", value: s.config, options: STAIR_CONFIGS },
        { kind: "number", key: "landingTread", label: "Landing Tread", value: s.landingTread, min: 1, max: MAX_RISERS - 1, integer: true },
        { kind: "length", key: "separation", label: "Separation", value: s.separation, zero: true },
        { kind: "length", key: "offset1", label: "Offset 1", value: s.offset1, signed: true },
        { kind: "length", key: "offset2", label: "Offset 2", value: s.offset2, zero: true },
        { kind: "check", key: "curved", label: "Curved Landing", value: s.curved },
        { kind: "length", key: "stringerWidth", label: "Stringer Width", value: s.stringerWidth, zero: true },
        { kind: "length", key: "stringerOffset", label: "Stringer Offset", value: s.stringerOffset, zero: true },
        { kind: "check", key: "break", label: "Draw Lower Stair Break", value: s.lowerBreak },
        { kind: "check", key: "data", label: "Show Data", value: s.showData },
        { kind: "check", key: "top", label: "Draw Top Tread", value: s.topTread },
        { kind: "check", key: "left", label: "Left Rail", value: s.leftRail },
        { kind: "check", key: "right", label: "Right Rail", value: s.rightRail },
        { kind: "length", key: "rail", label: "Rail Width", value: s.railWidth },
        { kind: "choice", key: "arrow", label: "Arrows", value: s.arrow, options: ARROWS },
      ],
      `The first riser's middle goes on the click, the stair rising toward the drag. The height takes the fewest risers no taller than Max Riser; each flight has a tread fewer than its risers (Draw Top Tread adds one at the top). Landing Tread is the risers before the landing, except doubling back evenly. The landing is the width long plus Offset 1; a turning landing reaches Offset 2 further toward the turn. Stringer Offset is from the treads' side to the stringer's outside. The lower stair break crosses the tread a ${CUT_HEIGHT} mm cut reaches, ending the stair there. Show Data writes each flight's risers and riser height on the arrow; the text is ${TEXT_MM} mm on paper. The style, tread thickness, nosing, rail height and 3D aren't drawn.`,
    );
    if (!v) return;
    this.s = {
      width: v.num("width"),
      height: v.num("height"),
      maxRiser: v.num("riser"),
      tread: v.num("tread"),
      config: STAIR_CONFIGS.find((c) => c.value === v.choice("config"))?.value ?? "straight",
      landingTread: v.num("landingTread"),
      separation: v.num("separation"),
      offset1: v.num("offset1"),
      offset2: v.num("offset2"),
      curved: v.flag("curved"),
      stringerWidth: v.num("stringerWidth"),
      stringerOffset: v.num("stringerOffset"),
      lowerBreak: v.flag("break"),
      showData: v.flag("data"),
      topTread: v.flag("top"),
      leftRail: v.flag("left"),
      rightRail: v.flag("right"),
      railWidth: v.num("rail"),
      arrow: ARROWS.find((a) => a.value === v.choice("arrow"))?.value ?? "up",
    };
  }

  hint(): string {
    return `${super.hint()} · the first riser's middle on the point`;
  }

  private stair(): SimpleStair {
    return { ...this.s, textHeight: TEXT_MM * (this.scale() ?? 1) };
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const units = store.session?.doc.info.units;
    const d = simpleStair(this.stair(), (mm) => formatLengthValue(mm, units));
    return d && markerParts(placedDrawing(d, at, angle));
  }

  protected refusal(): string {
    return simpleStairProblem(this.stair()) ?? "The stair can't be drawn.";
  }
}
