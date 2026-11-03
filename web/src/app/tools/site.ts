// Site Planning's and Building Shell's plan tools. Vectorworks makes plug-in objects of them;
// these draw what those objects draw in plan, as plain 2D objects grouped in the active class.
//
// Hardscape, Landscape Area and Property Line draw from an outline, Rectangle or Polygon, as Space
// does (planning.ts): a hardscape's border inside its outline and paving joints laid square from
// the drawing's origin; a landscape area's boundary as a cloud (or as drawn), with its name and
// area; a property line with each side's bearing and length beside it.
// Parking Space: a row of stalls to the left of a line dragged along the curb, at 90°, 60° or 45°.
// Column: a click places one, rectangular or round, a press dragged turns it.
// Pilaster: a click puts the middle of its shaft on a wall's face, a press dragged turns it along
// the wall (the shaft standing out to the drag's right); its structural part, centre marks and
// column ID as Vectorworks Architect's pilaster draws them.
// Stair: a straight stair dragged from its foot to its head, its treads, walk line and break line.

import type { Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import { degToRad } from "../geom.ts";
import { columnPlan, hardscape, MAX_STALLS, parkingRow, pilasterPlan, propertyLabels, straightStair, type Pilaster, type PilasterStruct, type PilasterUse, type PlacedText } from "../siteShapes.ts";
import { spaceOf } from "../planShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import type { ToolModes } from "../tools.ts";
import { formatArea, formatLength } from "../units.ts";
import { cloudOutline } from "./cloud.ts";
import { addPieces, drawn, PlaceTool, TwoPointTool, type Part } from "./detailing.ts";
import { areaLabel, OutlineTool } from "./planning.ts";

/** a landscape area's cloud arcs, a property line's labels, a stair's "UP" and a pilaster's column ID, on paper, mm */
const CLOUD_MM = 4;
const LABEL_MM = 2.5;
const UP_MM = 2.5;
const ID_MM = 2.5;
/** Vectorworks' centre justification and vertical centre */
const H_CENTRE = 2;
const V_CENTRE = 3;

function textPart(t: PlacedText): Part {
  return { kind: "text", at: t.at, text: t.text, height: t.height, hAlign: H_CENTRE, vAlign: V_CENTRE, angle: t.angle };
}

function units(): string | undefined {
  return store.session?.doc.info.units;
}

export class HardscapeTool extends OutlineTool {
  readonly id = "hardscape";
  protected readonly modeLabel = "Hardscape";
  private border = 300;
  private joints = true;
  private spacing = 600;
  /** degrees */
  private angle = 0;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Hardscape Preferences",
      [
        { kind: "length", key: "border", label: "Border width", value: this.border },
        { kind: "check", key: "joints", label: "Paving joints", value: this.joints },
        { kind: "length", key: "spacing", label: "Joint spacing", value: this.spacing },
        { kind: "number", key: "angle", label: "Joint angle", value: this.angle, min: -180, max: 180, unit: "°" },
      ],
      "The border runs inside the outline (0 for none). Joints are laid square from the drawing's origin, so neighbouring areas line up.",
    );
    if (!v) return;
    this.border = v.num("border");
    this.joints = v.flag("joints");
    this.spacing = v.num("spacing");
    this.angle = v.num("angle");
  }

  protected made(corners: Pt[]): void {
    const h = hardscape(corners, this.border, this.joints ? this.spacing : 0, degToRad(this.angle));
    if (!h) {
      toast("Draw a hardscape with room inside its border, or set wider joints in Preferences.", "info");
      return;
    }
    addPieces("Hardscape", [
      [
        { kind: "polygon", points: h.outline, closed: true },
        ...(h.inner ? [{ kind: "polygon", points: h.inner, closed: true } as const] : []),
        ...h.joints.map(([a, b]): Part => ({ kind: "polyline", points: [a, b], closed: false })),
      ],
    ]);
  }
}

export class LandscapeAreaTool extends OutlineTool {
  readonly id = "landscape";
  protected readonly modeLabel = "Landscape Area";
  private name = "Planting";
  private cloud = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Landscape Area Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: this.name },
        { kind: "check", key: "cloud", label: "Cloud boundary", value: this.cloud },
      ],
      "The area is the outline's as drawn, in the drawing's units.",
    );
    if (!v) return;
    this.name = v.choice("name");
    this.cloud = v.flag("cloud");
  }

  protected made(corners: Pt[]): void {
    const area = spaceOf(corners);
    const scale = this.layerScale();
    const boundary = area && scale !== null ? (this.cloud ? cloudOutline(area.outline, CLOUD_MM * scale) : area.outline) : null;
    if (!area || scale === null || !boundary) {
      toast("Draw a landscape area with some area.", "info");
      return;
    }
    addPieces("Landscape Area", [[{ kind: "polygon", points: boundary, closed: true }, ...areaLabel(area.labelAt, this.name, formatArea(area.area, units()), scale)]]);
  }
}

export class PropertyLineTool extends OutlineTool {
  readonly id = "propline";
  protected readonly modeLabel = "Property Line";

  protected made(corners: Pt[]): void {
    const scale = this.layerScale();
    const p = scale === null ? null : propertyLabels(corners, LABEL_MM * scale, (mm) => formatLength(mm, units()));
    if (!p) {
      toast("Draw a property line round some area.", "info");
      return;
    }
    addPieces("Property Line", [[{ kind: "polygon", points: p.outline, closed: true }, ...p.labels.map(textPart)]]);
  }
}

const PARKING_ANGLES = [90, 60, 45] as const;
type ParkingAngle = (typeof PARKING_ANGLES)[number];

export class ParkingTool extends TwoPointTool {
  readonly id = "parking";
  readonly cursor = "crosshair";
  protected readonly label = "Parking Space";
  private degrees: ParkingAngle = 90;
  private width = 2500;
  private depth = 5000;

  modes(): readonly ToolModes[] {
    return [{ label: "Angle", options: PARKING_ANGLES.map((d, i) => ({ id: String(d), label: `${d}°`, key: String(i + 1) })), active: String(this.degrees) }];
  }

  setMode(id: string): void {
    const d = PARKING_ANGLES.find((x) => String(x) === id);
    if (d) this.degrees = d;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Parking Space Preferences",
      [
        { kind: "length", key: "width", label: "Stall width", value: this.width },
        { kind: "length", key: "depth", label: "Stall depth", value: this.depth },
      ],
      "The width is square to the stall and the depth square to the curb; the stalls run to the left of the line drawn.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.depth = v.num("depth");
  }

  hint(): string {
    return `${super.hint()} · stalls to the left · 1–3 angle`;
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const row = parkingRow(a, b, this.width, this.depth, this.degrees);
    return row ? row.lines.map((points): Part => ({ kind: "polyline", points, closed: false })) : null;
  }

  protected refusal(): string {
    return `Drag a curb long enough for a stall (and for no more than ${MAX_STALLS}).`;
  }
}

type ColumnKind = "rect" | "round";

const COLUMNS: readonly { readonly id: ColumnKind; readonly label: string }[] = [
  { id: "rect", label: "Rectangular" },
  { id: "round", label: "Round" },
];

export class ColumnTool extends PlaceTool {
  readonly id = "column";
  readonly cursor = "crosshair";
  protected readonly label = "Column";
  private kind: ColumnKind = "rect";
  private width = 400;
  private depth = 400;
  private diameter = 400;

  modes(): readonly ToolModes[] {
    return [{ label: "Column", options: COLUMNS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = COLUMNS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Column Preferences", [
      { kind: "length", key: "width", label: "Rectangular width", value: this.width },
      { kind: "length", key: "depth", label: "Rectangular depth", value: this.depth },
      { kind: "length", key: "diameter", label: "Round diameter", value: this.diameter },
    ]);
    if (!v) return;
    this.width = v.num("width");
    this.depth = v.num("depth");
    this.diameter = v.num("diameter");
  }

  hint(): string {
    return `${super.hint()} · 1–2 rectangular or round`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const round = this.kind === "round";
    const d = columnPlan(round, round ? this.diameter : this.width, this.depth);
    if (!d) return null;
    return drawn({
      outlines: d.outlines.map((o) => placed(o, at, angle)),
      lines: d.lines.map((l) => placed(l, at, angle)),
      circles: d.circles.map((c) => ({ center: placed([c.center], at, angle)[0], radius: c.radius })),
    });
  }

  protected refusal(): string {
    return "Set the column's size in its Preferences.";
  }
}

const PILASTER_USES: readonly { readonly id: PilasterUse; readonly label: string }[] = [
  { id: "arch", label: "Architectural Only" },
  { id: "struct", label: "Structural Only" },
  { id: "both", label: "Architectural and Structural" },
];
const STRUCT_TYPES: readonly { readonly id: PilasterStruct; readonly label: string }[] = [
  { id: "concrete", label: "Concrete" },
  { id: "wood", label: "Wood" },
  { id: "steel", label: "Steel" },
];
const SHAPES = [
  { value: "rect", label: "Rectangular" },
  { value: "oval", label: "Oval" },
] as const;

export class PilasterTool extends PlaceTool {
  readonly id = "pilaster";
  readonly cursor = "crosshair";
  protected readonly label = "Pilaster";
  private pilaster: Pilaster = {
    use: "both",
    shaftOval: false,
    shaftWidth: 600,
    shaftDepth: 300,
    shaftRadius: 0,
    base: { width: 700, depth: 350 },
    capital: null,
    structType: "concrete",
    structOval: false,
    structWidth: 300,
    structDepth: 200,
    structOffset: { x: 0, y: 150 },
    structRotation: 0,
    clearance: 0,
    centerMark: 200,
  };
  /** what a base or capital turned off last measured, for turning it on again */
  private baseSize = { width: 700, depth: 350 };
  private capitalSize = { width: 700, depth: 350 };
  private columnId = "C-1";
  private showId = false;

  async preferences(): Promise<void> {
    const p = this.pilaster;
    const v = await toolPrefs(
      "Pilaster Preferences",
      [
        { kind: "choice", key: "use", label: "Use Component", value: p.use, options: PILASTER_USES.map((u) => ({ value: u.id, label: u.label })) },
        { kind: "choice", key: "shaft", label: "Shaft Type", value: p.shaftOval ? "oval" : "rect", options: SHAPES },
        { kind: "length", key: "shaftWidth", label: "Shaft Width", value: p.shaftWidth },
        { kind: "length", key: "shaftDepth", label: "Shaft Depth", value: p.shaftDepth },
        { kind: "length", key: "shaftRadius", label: "Shaft Corner Radius", value: p.shaftRadius, zero: true },
        { kind: "check", key: "base", label: "Use Base", value: p.base !== null },
        { kind: "length", key: "baseWidth", label: "Base Width", value: this.baseSize.width },
        { kind: "length", key: "baseDepth", label: "Base Depth", value: this.baseSize.depth },
        { kind: "check", key: "capital", label: "Use Capital", value: p.capital !== null },
        { kind: "length", key: "capitalWidth", label: "Capital Width", value: this.capitalSize.width },
        { kind: "length", key: "capitalDepth", label: "Capital Depth", value: this.capitalSize.depth },
        { kind: "choice", key: "structType", label: "Struct Type", value: p.structType, options: STRUCT_TYPES.map((t) => ({ value: t.id, label: t.label })) },
        { kind: "choice", key: "structShape", label: "Struct Shape (concrete or wood)", value: p.structOval ? "oval" : "rect", options: SHAPES },
        { kind: "length", key: "structWidth", label: "Struct Width", value: p.structWidth },
        { kind: "length", key: "structDepth", label: "Struct Depth", value: p.structDepth },
        { kind: "length", key: "structX", label: "Struct Offset X", value: p.structOffset.x, signed: true, zero: true },
        { kind: "length", key: "structY", label: "Struct Offset Y", value: p.structOffset.y, signed: true, zero: true },
        { kind: "number", key: "structRotation", label: "Struct Rotation", value: (p.structRotation * 180) / Math.PI, min: -360, max: 360, unit: "°" },
        { kind: "length", key: "clearance", label: "Struct Clearance", value: p.clearance, zero: true },
        { kind: "check", key: "marks", label: "Use Center Marks", value: p.centerMark > 0 },
        { kind: "length", key: "markSize", label: "Center Mark Size", value: p.centerMark > 0 ? p.centerMark : 200 },
        { kind: "text", key: "columnId", label: "Column ID", value: this.columnId },
        { kind: "check", key: "showId", label: "Display Column ID", value: this.showId },
      ],
      "The click is the middle of the shaft on the wall's face; the shaft stands out from it to the drag's right. The structural part and centre marks sit at the offsets from that point, Y out from the wall. A steel part is drawn as a wide flange. The base and capital are outlined round the shaft; the column ID goes in front of it.",
    );
    if (!v) return;
    this.baseSize = { width: v.num("baseWidth"), depth: v.num("baseDepth") };
    this.capitalSize = { width: v.num("capitalWidth"), depth: v.num("capitalDepth") };
    this.pilaster = {
      use: PILASTER_USES.find((u) => u.id === v.choice("use"))?.id ?? "both",
      shaftOval: v.choice("shaft") === "oval",
      shaftWidth: v.num("shaftWidth"),
      shaftDepth: v.num("shaftDepth"),
      shaftRadius: v.num("shaftRadius"),
      base: v.flag("base") ? this.baseSize : null,
      capital: v.flag("capital") ? this.capitalSize : null,
      structType: STRUCT_TYPES.find((t) => t.id === v.choice("structType"))?.id ?? "concrete",
      structOval: v.choice("structShape") === "oval",
      structWidth: v.num("structWidth"),
      structDepth: v.num("structDepth"),
      structOffset: { x: v.num("structX"), y: v.num("structY") },
      structRotation: degToRad(v.num("structRotation")),
      clearance: v.num("clearance"),
      centerMark: v.flag("marks") ? v.num("markSize") : 0,
    };
    this.columnId = v.choice("columnId");
    this.showId = v.flag("showId");
  }

  hint(): string {
    return `${super.hint()} · the shaft's middle on the wall's face`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const p = this.pilaster;
    const d = pilasterPlan(p);
    const scale = this.scale();
    if (!d || scale === null) return null;
    const parts: Part[] = drawn({ outlines: d.outlines.map((o) => placed(o, at, angle)), lines: d.lines.map((l) => placed(l, at, angle)), circles: [] });
    if (this.showId && this.columnId && p.use !== "arch") {
      const h = ID_MM * scale;
      const front = p.use === "struct" ? p.structOffset.y + p.structDepth / 2 : Math.max(p.shaftDepth, p.base?.depth ?? 0, p.capital?.depth ?? 0);
      // the ID reads level or turned up to a quarter turn, never upside down
      let deg = (angle * 180) / Math.PI;
      deg = ((((deg + 90) % 360) + 360) % 360) - 90;
      if (deg > 90) deg -= 180;
      parts.push(textPart({ at: placed([{ x: 0, y: -front - h }], at, angle)[0], text: this.columnId, height: h, angle: deg }));
    }
    return parts;
  }

  protected refusal(): string {
    return "Set the pilaster's shaft and structural sizes more than 0 in its Preferences, and make a design layer active.";
  }
}

export class StairTool extends TwoPointTool {
  readonly id = "stair";
  readonly cursor = "crosshair";
  protected readonly label = "Stair";
  private width = 1000;
  private going = 280;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Stair Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: this.width },
        { kind: "length", key: "going", label: "Tread depth (going)", value: this.going },
      ],
      "The run is divided into the whole number of treads nearest this depth.",
    );
    if (!v) return;
    this.width = v.num("width");
    this.going = v.num("going");
  }

  hint(): string {
    return this.start() ? "Click or release at the stair's head" : "Drag from the stair's foot to its head";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    const st = scale === null ? null : straightStair(a, b, this.width, this.going, UP_MM * scale);
    return st ? [...drawn(st.drawing), textPart(st.up)] : null;
  }

  protected refusal(): string {
    return "Drag a run long enough for two treads at the depth in Preferences.";
  }
}
