// Spotlight's Cable Path and Cable tools. Vectorworks makes plug-in objects of them; these draw what
// those objects draw in plan, as plain 2D objects in the active class. Esc cancels.
//
// Cable Path: click each corner of the path, a double-click or Enter ending it, a click on the first
// corner closing it. Corner mode keeps the corners sharp; Arc Vertex rounds each one with the Fillet
// Radius, as a polyline's arc vertices. It is one polyline, in the drawing's attributes.
// Cable (Single Connection): click the cable's corners as for a cable path. With Follow Paths on, a
// click on a polyline or line (a cable path) is where the cable joins it; it runs along it and leaves
// it at the point nearest the next click (a second click on the path itself is where it leaves).
// The cable is sized into stock cable parts, the fewest that cover it, with a connector marker where
// each part meets the next; its middle label shows the Cable Run ID and its length. Its line weight
// follows the Cable Type.

import type { NewShape, Pt } from "../../core/index.ts";
import { WHITE } from "../../core/attrs.ts";
import { between, cable, cableParts, nearestAlong, pathLength, roundCorners, type CableType, type ConnectorMarker, type EndMarker } from "../cableShapes.ts";
import { dist } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength, formatLengthValue, millimetresPerUnit, parseLength } from "../units.ts";
import { addPieces, layerScale, preview, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a press dragged further than this (CSS px) is a drag, and clicks closer count as one */
const CLICK_PX = 4;
/** a cable's connector and end markers across, and its label's height, on paper, mm */
const MARK_MM = 1.5;
const LABEL_MM = 2;
/** a fillet radius, until Preferences change it, mm */
const FILLET = 500;
/** stock cable parts, longest first, mm: metric drawings', and those in feet and inches */
const METRIC_PARTS = [20000, 10000, 5000, 3000, 2000, 1000];
const IMPERIAL_PARTS = [30480, 15240, 7620, 3048, 1524];

export type Bend = "corner" | "arc";
export const BENDS: readonly { readonly id: Bend; readonly label: string }[] = [
  { id: "corner", label: "Corner Vertex" },
  { id: "arc", label: "Arc Vertex" },
];
const TYPES: readonly { readonly id: CableType; readonly label: string; readonly weight: number }[] = [
  { id: "feeder", label: "Feeder", weight: 50 },
  { id: "multi", label: "Multi", weight: 35 },
  { id: "jumper", label: "Jumper", weight: 25 },
  { id: "data", label: "Data", weight: 14 },
];
const CONNECTORS: readonly { readonly id: ConnectorMarker; readonly label: string }[] = [
  { id: "chevron", label: "Chevron" },
  { id: "tick", label: "Tick" },
  { id: "dot", label: "Dot" },
  { id: "none", label: "None" },
];
const ENDS: readonly { readonly id: EndMarker; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "arrow", label: "Arrow" },
  { id: "dot", label: "Dot" },
];

const units = (): string | undefined => store.session?.doc.info.units;
const options = <T extends string>(list: readonly { readonly id: T; readonly label: string }[]) => list.map((o) => ({ value: o.id, label: o.label }));
const pick = <T extends string>(list: readonly { readonly id: T }[], id: string, fallback: T): T => list.find((o) => o.id === id)?.id ?? fallback;
export const bendModes = (active: Bend): ToolModes => ({ label: "Vertex", options: BENDS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active });

/** The stock parts for the drawing's units: in feet in a drawing measured in inches, feet or yards. */
const defaultParts = (): number[] => ([25.4, 304.8, 914.4].includes(millimetresPerUnit(units())) ? IMPERIAL_PARTS : METRIC_PARTS);

/** A path's points as a polyline: the corners in `round` arc vertices of the radius that fits, the rest corners. */
export function bentPolyline(points: readonly Pt[], closed: boolean, round: readonly boolean[], radius: number): { shape: NewShape; outline: Pt[] } {
  const r = roundCorners(points, closed, round, radius);
  const shape: NewShape = r.radii.some((x) => x > 0)
    ? { kind: "polyline", points: [...points], closed, vertices: r.radii.map((x) => (x > 0 ? "arc" : "corner")), radii: r.radii }
    : { kind: "polyline", points: [...points], closed };
  return { shape, outline: r.outline };
}

export class CablePathTool extends PathTool {
  readonly id = "cablepath";
  protected readonly label = "Cable Path";
  private bend: Bend = "corner";
  private radius = FILLET;

  modes(): readonly ToolModes[] {
    return [bendModes(this.bend)];
  }

  setMode(id: string): void {
    this.bend = pick(BENDS, id, this.bend);
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
      "Cable Path Preferences",
      [{ kind: "length", key: "radius", label: "Fillet Radius", value: this.radius }],
      "Click the path's corners. Arc Vertex mode rounds each corner with the Fillet Radius, as large as fits halfway along the edges beside it. Cables drawn with Follow Paths on run along it from where they're clicked onto it. Its ID, Location, cable count, 3D heights and attachment to rigging aren't kept.",
    );
    if (!v) return;
    this.radius = Math.max(0, v.num("radius"));
  }

  protected startHint(): string {
    return "Click the cable path's start · 1–2 vertex";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    if (pathLength(closed ? [...points, points[0]] : points) === 0) return "Click points apart for the cable path.";
    return [bentPolyline(points, closed, points.map(() => true), this.bend === "arc" ? this.radius : 0).shape];
  }

  protected previewParts(points: Pt[], closed: boolean): Part[] | string {
    // the arcs as they'll be drawn, not their corners
    return [{ kind: "polyline", points: bentPolyline(points, closed, points.map(() => true), this.bend === "arc" ? this.radius : 0).outline, closed: false }];
  }
}

/** A path the cable runs along: its points, whether it's closed, and how far along it the cable joined it. */
interface Joined {
  readonly id: string;
  readonly points: readonly Pt[];
  readonly closed: boolean;
  readonly d: number;
}

export class CableTool extends BaseTool {
  readonly id = "cable";
  readonly cursor = "crosshair";
  private bend: Bend = "corner";
  private radius = FILLET;
  private type: CableType = "feeder";
  private runId = "";
  private stock: number[] | null = null;
  private connector: ConnectorMarker = "chevron";
  private startMark: EndMarker = "none";
  private endMark: EndMarker = "none";
  private showLabel = true;
  private labelFill = true;
  private follow = true;
  /** the cable so far, and which of its points were clicked (and so may be rounded) */
  private route: Pt[] = [];
  private clicked: boolean[] = [];
  private joined: Joined | null = null;
  private cursorAt: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [bendModes(this.bend)];
  }

  setMode(id: string): void {
    this.bend = pick(BENDS, id, this.bend);
  }

  async preferences(): Promise<void> {
    const u = units();
    const stock = this.stock ?? defaultParts();
    const v = await toolPrefs(
      "Cable Preferences",
      [
        { kind: "choice", key: "type", label: "Cable Type", value: this.type, options: options(TYPES) },
        { kind: "text", key: "run", label: "Cable Run ID", value: this.runId },
        { kind: "text", key: "parts", label: "Cable Parts (lengths, ; between)", value: stock.map((s) => formatLengthValue(s, u)).join("; ") },
        { kind: "choice", key: "connector", label: "Connector Marker", value: this.connector, options: options(CONNECTORS) },
        { kind: "choice", key: "start", label: "Line Start Marker", value: this.startMark, options: options(ENDS) },
        { kind: "choice", key: "end", label: "Line End Marker", value: this.endMark, options: options(ENDS) },
        { kind: "check", key: "label", label: "Show Middle Label", value: this.showLabel },
        { kind: "check", key: "fill", label: "Middle Text Fill", value: this.labelFill },
        { kind: "length", key: "radius", label: "Fillet Radius", value: this.radius },
        { kind: "check", key: "follow", label: "Automatically follow paths", value: this.follow },
      ],
      `Single Connection: click the cable's corners, double-click or Enter to end it. A click on a cable path (any polyline or line) joins it there with Automatically follow paths on: the cable runs along it and leaves at the point nearest the next click. The cable is made of the fewest stock Cable Parts that cover its length (the least spare among those), longest first, with a connector marker where each meets the next; the parts are listed when it's placed. A feeder is drawn heaviest, then multi, jumper and data. The middle label shows the Cable Run ID and the length, ${LABEL_MM} mm high on paper, over a white box when Middle Text Fill is on. Distributor, Schematic Distributor and Daisy Chain modes, cable styles and inventories, outputs, connectors by name, heights, loads and data tags aren't offered.`,
    );
    if (!v) return;
    const parsed = v
      .choice("parts")
      .split(/;|,\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => parseLength(t, u));
    if (parsed.length === 0 || parsed.some((p) => p === null || !(p > 0))) toast("Cable Parts: give lengths over 0, with ; between them. They're kept as they were.", "info");
    else this.stock = parsed as number[];
    this.type = pick(TYPES, v.choice("type"), this.type);
    this.runId = v.choice("run").trim();
    this.connector = pick(CONNECTORS, v.choice("connector"), this.connector);
    this.startMark = pick(ENDS, v.choice("start"), this.startMark);
    this.endMark = pick(ENDS, v.choice("end"), this.endMark);
    this.showLabel = v.flag("label");
    this.labelFill = v.flag("fill");
    this.radius = Math.max(0, v.num("radius"));
    this.follow = v.flag("follow");
  }

  snapFrom(): Pt | null {
    return this.route.at(-1) ?? null;
  }

  hint(): string {
    if (this.joined) return "Click where the cable leaves the path: it leaves at the point nearest the click";
    if (this.route.length) return `Click the next corner${this.follow ? " or a path to follow" : ""} · double-click or Enter ends it`;
    return `Click the cable's start${this.follow ? ", or a path to follow" : ""} · 1–2 vertex`;
  }

  down(p: PointerInfo): void {
    // a third press of a double-click that ended a cable starts no new one
    if (p.detail > 2 && this.route.length === 0) return;
    const scale = this.env.view.scale;
    const hit = this.follow ? this.pathAt(p) : null;
    const joined = this.joined;
    if (joined) {
      const onIt = hit?.id === joined.id;
      const exit = nearestAlong(joined.points, joined.closed, onIt ? hit.at : p.pos);
      const along = between(joined.points, joined.closed, joined.d, exit.d).slice(1);
      along.forEach((q, i) => this.add(q, i === along.length - 1, scale));
      if (!onIt) this.add(p.pos, true, scale);
      this.joined = null;
    } else {
      this.add(hit ? hit.at : p.pos, true, scale);
      if (hit) this.joined = { id: hit.id, points: hit.points, closed: hit.closed, d: hit.d };
    }
    if (p.detail >= 2 && this.route.length >= 2) this.finish();
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.route = [];
    this.clicked = [];
    this.joined = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.route.length === 0) return false;
    if (e.key === "Enter" && this.route.length >= 2) this.finish();
    else if (e.key === "Escape") this.cancel();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at || this.route.length === 0) return;
    const route = [...this.route];
    const clicked = [...this.clicked];
    if (this.joined) {
      const exit = nearestAlong(this.joined.points, this.joined.closed, at);
      const along = between(this.joined.points, this.joined.closed, this.joined.d, exit.d).slice(1);
      route.push(...along);
      clicked.push(...along.map((_, i) => i === along.length - 1));
    }
    route.push(at);
    clicked.push(true);
    const made = this.made(route, clicked, true);
    if (typeof made !== "string") preview(g, made.parts);
  }

  /** Adds a point to the cable, unless it's on the last one. */
  private add(q: Pt, click: boolean, scale: number): void {
    const last = this.route.at(-1);
    if (last && dist(last, q) * scale <= CLICK_PX) {
      if (click) this.clicked[this.clicked.length - 1] = true;
      return;
    }
    this.route.push(q);
    this.clicked.push(click);
  }

  /** The polyline or line under the pointer to follow: its points and where on it the pointer is nearest. */
  private pathAt(p: PointerInfo): { id: string; points: Pt[]; closed: boolean; at: Pt; d: number } | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const layers = store.editGroupId ? [layerId] : this.env.scene.pickableLayers(layerId);
    const o = pickObject(this.env.scene, this.env.view, p.screen, layers, (obj) => (obj.kind === "polyline" || obj.kind === "line") && (obj.shape?.points.length ?? 0) >= 2);
    if (!o?.shape) return null;
    const closed = o.shape.kind === "polyline" && o.shape.closed;
    const near = nearestAlong(o.shape.points, closed, p.pos);
    return { id: o.id, points: o.shape.points, closed, at: near.at, d: near.d };
  }

  /** What the cable along `route` draws, its parts and length; with `flat`, its rounded corners flattened (for the preview). */
  private made(route: readonly Pt[], clicked: readonly boolean[], flat: boolean): { parts: Part[]; run: number[]; length: number } | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to draw a cable.";
    const bent = bentPolyline(route, false, clicked, this.bend === "arc" ? this.radius : 0);
    const length = pathLength(bent.outline);
    const run = cableParts(length, this.stock ?? defaultParts());
    if (typeof run === "string") return run;
    const label = this.showLabel ? [this.runId, formatLength(length, units())].filter(Boolean).join(" · ") : "";
    const drawn = cable(bent.outline, run, { connector: this.connector, start: this.startMark, end: this.endMark, label, labelFill: this.labelFill }, MARK_MM * scale, LABEL_MM * scale);
    const weight = TYPES.find((t) => t.id === this.type)?.weight ?? 25;
    const line: Part = { shape: flat ? { kind: "polyline", points: bent.outline, closed: false } : bent.shape, attrs: { lineWeight: weight } };
    const marks = markerParts({ ...drawn.drawing, texts: [] });
    // the label over a white box, the cable stopping at it
    const box: Part[] = drawn.box ? [{ shape: { kind: "polygon", points: drawn.box, closed: true }, attrs: { fillPattern: 1, fillFore: WHITE, fillBack: WHITE, penFore: WHITE, fillOpacity: 100, penOpacity: 100 } }] : [];
    const texts = markerParts({ outlines: [], lines: [], circles: [], filled: [], texts: drawn.drawing.texts });
    return { parts: [line, ...marks, ...box, ...texts], run, length };
  }

  private finish(): void {
    const route = this.route;
    const clicked = this.clicked;
    this.cancel();
    const made = this.made(route, clicked, false);
    if (typeof made === "string") {
      toast(made, "info");
      return;
    }
    addPieces("Cable", [made.parts]);
    const u = units();
    const total = made.run.reduce((a, b) => a + b, 0);
    toast(`Cable ${formatLength(made.length, u)}: ${made.run.map((r) => formatLength(r, u)).join(" + ")}${made.run.length > 1 ? ` = ${formatLength(total, u)}` : ""}.`, "info");
  }
}
