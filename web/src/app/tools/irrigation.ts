// Irrigation's Outlet, Drip Outlet, Pipe, Valve, Point of Connection, Controller, System
// Component, Design Zone and Hydrozone (irrigationShapes.ts). Vectorworks makes connected
// irrigation objects of them, with catalog data and hydraulic calculations; these draw what they
// show in Top/Plan, as plain 2D objects in the active class. Catalogs, connections, pressures,
// flows, sizing, labels from tag/labels and 3D aren't kept.
//
// Outlet places one outlet with a click (a press dragged turns its spray toward the pointer), or
// many: at each corner of a clicked path (Poly-Vertex), spaced along it (Poly-Edge), or filling
// the area it outlines in rows (Rectangular and Triangular Array); a double-click or Enter ends
// the path. Each outlet is its own object, its symbol grouped with its coverage. Pipe and Drip
// Outlet click a path as Railing/Fence does: a pipe Main, Lateral or Drip Tubing, a drip line, or
// a drip area's outline filled with rows. Valve, Point of Connection, Controller and System
// Component take a click, or a press dragged to turn them. Design Zone and Hydrozone draw an
// outline as Space does, labelled at its middle. Symbols and labels are sized on paper, times
// their Symbol Scale: a layer at 1:n draws them n times larger.

import type { Pt } from "../../core/index.ts";
import { dist } from "../geom.ts";
import {
  controller,
  dripRows,
  irrigationPipe,
  MAX_OUTLETS,
  nextZoneId,
  outletProblem,
  outlets,
  outletsAlong,
  outletsArray,
  pointOfConnection,
  valve,
  zoneProblem,
  type IrrigationPipe,
  type Outlet,
  type OutletAt,
  type OutletType,
  type PipeKind,
  type Spacing,
  type SpacingMode,
  type SymbolRotation,
} from "../irrigationShapes.ts";
import type { MarkerDrawing } from "../markerShapes.ts";
import { spaceOf } from "../planShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatArea } from "../units.ts";
import { placedDrawing } from "./circulation.ts";
import { addPieces, layerScale, PlaceTool, preview, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { ClickedPath, PathTool } from "./paths.ts";
import { OutlineTool } from "./planning.ts";

/** a press dragged further than this (CSS px) is a drag */
const CLICK_PX = 4;
/** an outlet's symbol, a valve's, a point of connection's, a controller's and a system component's across on paper, and a pipe's label height, mm */
const OUTLET_MM = 2;
const VALVE_MM = 3;
const POC_MM = 4;
const CONTROLLER_MM = 4;
const COMPONENT_MM = 3;
const PIPE_TEXT_MM = 2;
/** line weights, mils: a main line heavier than a lateral, drip tubing finer */
const WEIGHTS: Record<PipeKind, number> = { main: 20, lateral: 10, drip: 7 };

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const OUTLET_TYPES: Options<OutletType> = [
  { value: "spray", label: "Spray" },
  { value: "rotor", label: "Rotor" },
  { value: "emitter", label: "Emitter" },
];
const ROTATIONS: Options<SymbolRotation> = [
  { value: "none", label: "No Rotation" },
  { value: "coverage", label: "Toward Coverage" },
];
const SPACINGS: Options<SpacingMode> = [
  { value: "overlap", label: "Overlap" },
  { value: "fixed", label: "Fixed" },
  { value: "fitDistance", label: "Best Fit (by distance)" },
  { value: "fitOverlap", label: "Best Fit (by overlap)" },
  { value: "count", label: "By Count" },
];

type OutletMode = "single" | "vertex" | "edge" | "rect" | "tri";

const OUTLET_MODES: readonly { readonly id: OutletMode; readonly label: string }[] = [
  { id: "single", label: "Single Outlet Placement" },
  { id: "vertex", label: "Poly-Vertex Placement" },
  { id: "edge", label: "Poly-Edge Placement" },
  { id: "rect", label: "Rectangular Array" },
  { id: "tri", label: "Triangular Array" },
];

/** The drawing's first dashed line type, or undefined in a drawing without one. */
const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

/** The active layer's scale times a symbol scale: paper mm to drawing mm. */
const paper = (env: BaseTool["env"], factor: number): number | null => {
  const scale = layerScale(env);
  return scale === null ? null : scale * factor;
};

export class OutletTool extends BaseTool {
  readonly id = "outlet";
  readonly cursor = "crosshair";
  private mode: OutletMode = "single";
  private readonly path = new ClickedPath();
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;
  private o: Outlet = { type: "spray", radius: 3700, arc: 360, coverage: true, rotation: "coverage" };
  private spacing: Spacing = { mode: "overlap", value: 100, offset: 0 };
  private offsetOn = false;
  private symbolScale = 1;

  modes(): readonly ToolModes[] {
    return [{ label: "Placement", options: OUTLET_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = OUTLET_MODES.find((m) => m.id === id);
    if (!mode || mode.id === this.mode) return;
    this.mode = mode.id;
    this.cancel();
  }

  async preferences(): Promise<void> {
    const o = this.o;
    const s = this.spacing;
    const v = await toolPrefs(
      "Outlet Preferences",
      [
        { kind: "choice", key: "type", label: "Outlet Type", value: o.type, options: OUTLET_TYPES },
        { kind: "length", key: "radius", label: "Radius", value: o.radius },
        { kind: "number", key: "arc", label: "Arc", value: o.arc, min: 1, max: 360, unit: "°" },
        { kind: "choice", key: "mode", label: "Mode", value: s.mode, options: SPACINGS },
        { kind: "number", key: "value", label: "Value", value: s.value, min: 0, max: 1e9 },
        { kind: "check", key: "offsetOn", label: "Offset Along Spray Direction", value: this.offsetOn },
        { kind: "length", key: "offset", label: "Offset", value: s.offset, zero: true, signed: true },
        { kind: "number", key: "symbolScale", label: "Symbol Scale", value: this.symbolScale, min: 0.1, max: 20 },
        { kind: "choice", key: "rotation", label: "Symbol Rotation", value: o.rotation, options: ROTATIONS },
        { kind: "check", key: "coverage", label: "Show Coverage", value: o.coverage },
      ],
      `A spray's symbol is a square, a rotor's a circle, an emitter's a dot, ${OUTLET_MM} mm across on paper times the Symbol Scale; Toward Coverage turns a spray's square a corner toward its spray. The coverage is a circle of the throw Radius, or a wedge over the Arc; an emitter has none, its Radius its spacing. Single placement sprays up the screen, or toward a drag. Placing many: Overlap spaces them by a share of the radius (100% puts each throw on the next outlet), Fixed by the Value, Best Fit spreads them evenly at least the distance apart or with at least the overlap, By Count spreads that many (to a row, in an array); along a path they spray to its left (above a path drawn left to right), moved by the Offset when it's on; arrays fill the area in rows from its lower left, keeping those inside it. Catalogs, pressures, flows, manual radii and strips, symbol offsets and labels aren't offered.`,
    );
    if (!v) return;
    this.o = { type: pick(OUTLET_TYPES, v.choice("type"), "spray"), radius: v.num("radius"), arc: v.num("arc"), rotation: pick(ROTATIONS, v.choice("rotation"), "coverage"), coverage: v.flag("coverage") };
    this.offsetOn = v.flag("offsetOn");
    this.spacing = { mode: pick(SPACINGS, v.choice("mode"), "overlap"), value: v.num("value"), offset: v.num("offset") };
    this.symbolScale = v.num("symbolScale");
  }

  snapFrom(): Pt | null {
    return this.mode === "single" ? (this.press?.at ?? null) : (this.path.points.at(-1) ?? null);
  }

  hint(): string {
    if (this.mode === "single") return this.press ? "Release to place · drag turns its spray" : "Click to place an outlet, or press and drag to turn its spray · 1–5 mode";
    if (this.path.points.length) return this.mode === "vertex" || this.mode === "edge" ? "Click the next corner · double-click or Enter ends it" : "Click the next corner · double-click, Enter or a click on the first corner ends it";
    return this.mode === "vertex" || this.mode === "edge" ? "Click the path's start · 1–5 mode" : "Click the area's first corner · 1–5 mode";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (this.mode === "single") {
      this.press = { at: p.pos, screen: p.screen };
      return;
    }
    const done = this.path.click(p, this.env.view.scale, this.mode === "rect" || this.mode === "tri");
    if (done) this.finish(done.points);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    this.place([{ at: press.at, dir: this.dirOf(press, p) }]);
  }

  cancel(): void {
    this.press = null;
    this.path.points = [];
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (!this.press && this.path.points.length === 0) return false;
    if (e.key === "Enter" && this.path.points.length) this.finish(this.path.end(false).points);
    else if (e.key === "Escape") this.cancel();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    const k = paper(this.env, OUTLET_MM * this.symbolScale);
    if (!p || k === null) return;
    const list = this.mode === "single" ? [{ at: this.press?.at ?? p.pos, dir: this.press ? this.dirOf(this.press, p) : Math.PI / 2 }] : this.path.points.length ? this.layout([...this.path.points, p.pos]) : null;
    if (list && typeof list !== "string" && !outletProblem(this.o)) preview(g, markerParts(outlets(list, this.o, k)));
  }

  /** Which way a press dragged to `p` sprays: up the screen for a click, else toward the pointer. */
  private dirOf(press: { at: Pt; screen: Pt }, p: PointerInfo): number {
    return dist(p.screen, press.screen) <= CLICK_PX ? Math.PI / 2 : Math.atan2(p.pos.y - press.at.y, p.pos.x - press.at.x);
  }

  /** Where the path's outlets go, by the mode. */
  private layout(points: Pt[]): OutletAt[] | string {
    const spacing = this.offsetOn ? this.spacing : { ...this.spacing, offset: 0 };
    if (this.mode === "vertex") return outletProblem(this.o) ?? points.slice(0, MAX_OUTLETS).map((at) => ({ at, dir: Math.PI / 2 }));
    if (this.mode === "edge") return outletsAlong(points, this.o, spacing);
    return outletsArray(points, this.o, spacing, this.mode === "tri");
  }

  private finish(points: Pt[]): void {
    const list = this.layout(points);
    if (typeof list === "string") toast(list, "info");
    else this.place(list);
  }

  private place(list: OutletAt[]): void {
    const k = paper(this.env, OUTLET_MM * this.symbolScale);
    const problem = k === null ? "Make a design layer active to place outlets." : outletProblem(this.o);
    if (problem || k === null) {
      toast(problem ?? "", "info");
      return;
    }
    addPieces("Outlet", list.map((one) => markerParts(outlets([one], this.o, k))));
  }
}

const PIPE_MODES: readonly { readonly id: PipeKind; readonly label: string }[] = [
  { id: "main", label: "Main" },
  { id: "lateral", label: "Lateral" },
  { id: "drip", label: "Drip Tubing" },
];

export class IrrigationPipeTool extends PathTool {
  readonly id = "irrpipe";
  protected readonly label = "Pipe";
  private kind: PipeKind = "main";
  private p: Omit<IrrigationPipe, "kind"> = { flowDirection: true, diameter: "" };

  modes(): readonly ToolModes[] {
    return [{ label: "Pipe", options: PIPE_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const mode = PIPE_MODES.find((m) => m.id === id);
    if (mode) this.kind = mode.id;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Pipe Preferences",
      [
        { kind: "text", key: "diameter", label: "Nominal Diameter", value: this.p.diameter },
        { kind: "check", key: "flow", label: "Show Flow Direction", value: this.p.flowDirection },
      ],
      `Click the pipe's path. A main line is drawn heavier than a lateral, drip tubing finer and, when the drawing has a dashed line type, dashed. Show Flow Direction puts an arrowhead at its middle pointing on from its start; a Nominal Diameter (1/2 in, 25 mm…) labels it there, ${PIPE_TEXT_MM} mm high on paper. Autoconnect, catalog pipes, sizing, elevations, sleeves, trench depths, flows and jumps over other pipes aren't kept.`,
    );
    if (!v) return;
    this.p = { diameter: v.choice("diameter"), flowDirection: v.flag("flow") };
  }

  protected startHint(): string {
    return `Click the ${PIPE_MODES.find((m) => m.id === this.kind)?.label.toLowerCase() ?? "pipe"}'s start · 1–3 pipe`;
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const k = paper(this.env, PIPE_TEXT_MM);
    if (k === null) return "Make a design layer active to draw a pipe.";
    const plan = irrigationPipe(closed ? [...points, points[0]] : points, { ...this.p, kind: this.kind }, k);
    if (typeof plan === "string") return plan;
    const dashed = this.kind === "drip" ? dashedStyle() : undefined;
    const attrs = { lineWeight: WEIGHTS[this.kind], ...(dashed === undefined ? {} : { lineStyle: dashed }) };
    return markerParts(plan).map((part): Part => ("shape" in part ? part : part.kind === "polyline" ? { shape: part, attrs } : part));
  }
}

/** A symbol tool: one symbol on the point, `MM` across on paper times its Symbol Scale, a drag turning it, its label above. */
abstract class SymbolTool extends PlaceTool {
  readonly cursor = "crosshair";
  protected symbolScale = 1;
  protected name = "";
  protected abstract readonly mm: number;
  protected abstract drawing(size: number, label: string): MarkerDrawing;

  hint(): string {
    return `${super.hint()} · centred on the point`;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const k = paper(this.env, this.mm * this.symbolScale);
    return k === null ? null : markerParts(placedDrawing(this.drawing(k, this.name), at, angle));
  }

  protected refusal(): string {
    return `Make a design layer active to place a ${this.label.toLowerCase()}.`;
  }

  /** Asks for the symbol's name label and scale, with `note`. */
  protected async ask(title: string, nameLabel: string, note: string): Promise<void> {
    const v = await toolPrefs(
      title,
      [
        { kind: "text", key: "name", label: nameLabel, value: this.name },
        { kind: "number", key: "symbolScale", label: "Symbol Scale", value: this.symbolScale, min: 0.1, max: 20 },
      ],
      `The default symbol, ${this.mm} mm across on paper times the Symbol Scale, centred on the click (a drag turns it), the ${nameLabel} above it. ${note}`,
    );
    if (!v) return;
    this.name = v.choice("name");
    this.symbolScale = v.num("symbolScale");
  }
}

export class ValveTool extends SymbolTool {
  readonly id = "valve";
  protected readonly label = "Valve";
  protected readonly mm = VALVE_MM;

  async preferences(): Promise<void> {
    await this.ask("Valve Preferences", "Zone ID", "Valve types' own symbols, catalog data, pressures and flows aren't kept.");
  }

  protected drawing(size: number, label: string): MarkerDrawing {
    return valve(size, label);
  }
}

export class PointOfConnectionTool extends SymbolTool {
  readonly id = "poc";
  protected readonly label = "Point of Connection";
  protected readonly mm = POC_MM;

  async preferences(): Promise<void> {
    await this.ask("Point of Connection Preferences", "POC Name", "Water sources, service lines, pressures and flows aren't kept.");
  }

  protected drawing(size: number, label: string): MarkerDrawing {
    return pointOfConnection(size, label);
  }
}

export class ControllerTool extends SymbolTool {
  readonly id = "controller";
  protected readonly label = "Controller";
  protected readonly mm = CONTROLLER_MM;

  async preferences(): Promise<void> {
    await this.ask("Controller Preferences", "Controller Name", "Catalog data and the valves it controls aren't kept.");
  }

  protected drawing(size: number, label: string): MarkerDrawing {
    return controller(size, label);
  }
}

export class SystemComponentTool extends SymbolTool {
  readonly id = "syscomponent";
  protected readonly label = "System Component";
  protected readonly mm = COMPONENT_MM;

  async preferences(): Promise<void> {
    await this.ask("System Component Preferences", "Component Name", "Component types and their library symbols, catalog data, pressures, pressure losses and flows aren't kept.");
  }

  protected drawing(size: number, label: string): MarkerDrawing {
    return controller(size, label);
  }
}

const DRIP_MODES: readonly { readonly id: "line" | "area"; readonly label: string }[] = [
  { id: "line", label: "Drip Line" },
  { id: "area", label: "Drip Area" },
];
export class DripOutletTool extends PathTool {
  readonly id = "dripoutlet";
  protected readonly label = "Drip Outlet";
  private mode: "line" | "area" = "line";
  private rowSpacing = 450;
  private showLines = true;

  modes(): readonly ToolModes[] {
    return [{ label: "Drip Outlet", options: DRIP_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = DRIP_MODES.find((m) => m.id === id);
    if (mode) this.mode = mode.id;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Drip Outlet Preferences",
      [
        { kind: "length", key: "spacing", label: "Row Spacing", value: this.rowSpacing },
        { kind: "check", key: "lines", label: "Show Drip Lines", value: this.showLines },
      ],
      "Drip Line draws the line along the clicked path. Drip Area fills the outline clicked (closed by a double-click, Enter or a click on its first corner) with parallel rows of drip line the Row Spacing apart, running along its first edge and centred across the area; without Show Drip Lines the area takes the fill from Attributes instead. Catalog outlets, the snaking or branching configuration (for Vectorworks' calculations), connections, pressures, flows, estimated lengths and labels aren't kept.",
    );
    if (!v) return;
    this.rowSpacing = v.num("spacing");
    this.showLines = v.flag("lines");
  }

  protected startHint(): string {
    return this.mode === "line" ? "Click the drip line's start · 1–2 mode" : "Click the drip area's first corner · its rows run along the first edge · 1–2 mode";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    if (this.mode === "line") {
      if (points.length < 2) return "Click at least two points for the drip line.";
      return [{ kind: "polyline", points: closed ? [...points, points[0]] : points, closed: false }];
    }
    const outline: Part = { kind: "polygon", points, closed: true };
    if (!this.showLines) return points.length < 3 ? "Click at least three corners round the drip area." : [outline];
    const rows = dripRows(points, this.rowSpacing);
    if (typeof rows === "string") return rows;
    return [{ shape: outline, attrs: { fillPattern: 0 } }, ...rows.map((row): Part => ({ kind: "line", a: row[0], b: row[1] }))];
  }
}

/** Vectorworks' centre justification and vertical centre */
const H_CENTRE = 2;
const V_CENTRE = 3;
/** a zone label's first line and the rest, high on paper, mm */
const ZONE_TITLE_MM = 3.5;
const ZONE_TEXT_MM = 2.5;

/** Lines of text centred on `at`, one under another, the first `title` high and the rest `text` high; blank lines left out. */
function zoneLabel(at: Pt, lines: readonly string[], title: number, text: number): Part[] {
  const kept = lines.map((l) => l.trim()).filter(Boolean);
  const heights = kept.map((_, i) => (i === 0 ? title : text));
  const total = heights.reduce((a, b) => a + b * 1.4, 0);
  let y = at.y + total / 2;
  return kept.map((value, i): Part => {
    y -= heights[i] * 0.7;
    const part: Part = { kind: "text", at: { x: at.x, y }, text: value, height: heights[i], hAlign: H_CENTRE, vAlign: V_CENTRE };
    y -= heights[i] * 0.7;
    return part;
  });
}

export class DesignZoneTool extends OutlineTool {
  readonly id = "designzone";
  protected readonly modeLabel = "Design Zone";
  private zoneId = "1";
  private zoneName = "";
  private showId = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Design Zone Preferences",
      [
        { kind: "text", key: "id", label: "Zone ID", value: this.zoneId },
        { kind: "text", key: "name", label: "Zone Name", value: this.zoneName },
        { kind: "check", key: "showId", label: "Show Zone ID", value: this.showId },
      ],
      "The zone's outline, unfilled, labelled at its middle with its Zone ID and Zone Name. Each zone placed counts the Zone ID on (1, 2, 3… or A, B, C…). Outlet types, POCs, flows, coverage analysis and tags aren't kept.",
    );
    if (!v) return;
    this.zoneId = v.choice("id");
    this.zoneName = v.choice("name");
    this.showId = v.flag("showId");
  }

  protected made(corners: Pt[]): void {
    const zone = spaceOf(corners);
    const scale = this.layerScale();
    const problem = scale === null ? "Make a design layer active to draw a design zone." : (zoneProblem(corners) ?? (zone ? null : "Draw a design zone with some area."));
    if (problem || !zone || scale === null) {
      toast(problem ?? "", "info");
      return;
    }
    const label = zoneLabel(zone.labelAt, [this.showId ? this.zoneId : "", this.zoneName], ZONE_TITLE_MM * scale, ZONE_TEXT_MM * scale);
    addPieces("Design Zone", [[{ shape: { kind: "polygon", points: zone.outline, closed: true }, attrs: { fillPattern: 0 } }, ...label]]);
    this.zoneId = nextZoneId(this.zoneId);
  }
}

type WaterUse = "veryLow" | "low" | "moderate" | "high" | "custom";

const WATER_USES: Options<WaterUse> = [
  { value: "veryLow", label: "Very Low" },
  { value: "low", label: "Low" },
  { value: "moderate", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "custom", label: "Custom" },
];
/** each level's suggested water use value (High's is Vectorworks'; the others the top of their WUCOLS range) */
const WATER_USE_VALUE: Record<Exclude<WaterUse, "custom">, number> = { veryLow: 0.1, low: 0.3, moderate: 0.6, high: 0.9 };

export class HydrozoneTool extends OutlineTool {
  readonly id = "hydrozone";
  protected readonly modeLabel = "Hydrozone";
  private name = "Hydrozone";
  private method = "Drip";
  private use: WaterUse = "high";
  private useValue = WATER_USE_VALUE.high;
  private plantType = "";
  private showLabel = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Hydrozone Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: this.name },
        { kind: "text", key: "method", label: "Method", value: this.method },
        { kind: "choice", key: "use", label: "Water Use", value: this.use, options: WATER_USES },
        { kind: "number", key: "value", label: "Water Use Value", value: this.useValue, min: 0, max: 10 },
        { kind: "text", key: "plant", label: "Plant Type", value: this.plantType },
        { kind: "check", key: "label", label: "Show Label", value: this.showLabel },
      ],
      "The hydrozone's outline, filled from Attributes, labelled at its middle with its Name, Water Use and area. Choosing another Water Use level sets its suggested value (Very Low 0.1, Low 0.3, Moderate 0.6, High 0.9); keep the level to set your own. Classes by water use, site areas and their percentages, method lists and water budget worksheets aren't kept.",
    );
    if (!v) return;
    const use = pick(WATER_USES, v.choice("use"), "high");
    this.useValue = use !== this.use && use !== "custom" ? WATER_USE_VALUE[use] : v.num("value");
    this.use = use;
    this.name = v.choice("name");
    this.method = v.choice("method");
    this.plantType = v.choice("plant");
    this.showLabel = v.flag("label");
  }

  protected made(corners: Pt[]): void {
    const zone = spaceOf(corners);
    const scale = this.layerScale();
    const problem = scale === null ? "Make a design layer active to draw a hydrozone." : (zoneProblem(corners) ?? (zone ? null : "Draw a hydrozone with some area."));
    if (problem || !zone || scale === null) {
      toast(problem ?? "", "info");
      return;
    }
    const use = `${WATER_USES.find((w) => w.value === this.use)?.label ?? ""} water use (${this.useValue})`;
    const lines = [this.name, this.method, this.plantType, use, formatArea(zone.area, store.session?.doc.info.units)];
    const label = this.showLabel ? zoneLabel(zone.labelAt, lines, ZONE_TITLE_MM * scale, ZONE_TEXT_MM * scale) : [];
    addPieces("Hydrozone", [[{ kind: "polygon", points: zone.outline, closed: true }, ...label]]);
  }
}
