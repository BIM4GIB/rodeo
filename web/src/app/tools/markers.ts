// The Dims/Notes tool set's markers. Vectorworks makes plug-in objects of them that follow the
// viewports they name; these draw what those objects draw, as plain 2D objects grouped in the
// active class, the arrows and a benchmark's quarters filled in the pen's colour. Sizes are on
// paper (times the layer scale); numbers and titles are set in Preferences. Esc cancels.
//
// Section-Elevation Marker: Section draws a line (a drag or two clicks, Shift in 15° steps) with a
// bubble past each end looking to its left or right; Elevation a bubble at the first point looking
// toward the second.
// Interior Elevation Marker: a circle with an arrow each way and each look's number; a click places
// it, a press dragged turns it.
// Detail Callout: a drag from a detail's centre to its edge circles it, and a leader carries on to
// the detail's bubble.
// Drawing Label: a click places the bubble with the title on a line beside it and the scale under.
// Elevation Benchmark: a click places a quartered circle and a leader with the point's Y (from the
// drawing's origin, in its units) over a label.
// North Arrow: a circle with a needle and an N; a click points it up, a press dragged points it at
// the pointer.
// Scale Bar: a click places four segments of a round length at the layer's scale, alternately
// filled, labelled in the drawing's units.
// Data Tag: press on an object and drag (or click it, then click) to where the tag goes: a leader
// to a box round the object's name, class, area or length, as it is when tagged.
// Graphic Legend: a click places a swatch per class used on the active layer (not hidden), each
// drawn in its class's attributes, with the class's name beside it.
// Symmetry Label: a drag or two clicks draws the axis, crossed near each end by two short bars.
// Slope Dimension: a drag or two clicks along a slope labels it, against the drawing's level: Rise
// over Run sets a right triangle on the line, its sides labelled with the base and the rise; Ratio,
// Percent and Degrees set the value over the line. Draw Roof Surface adds the line itself, dashed
// in the drawing's first dashed line type (solid in a drawing that has none).
// Feature Control Frame: a click places a GD&T frame, its left end there, or a press dragged turns
// it; the characteristic, tolerance, modifiers and datums are set in Preferences.
// Center Mark: a click on a circle, oval, rectangle or rounded rectangle crosses its centre with two
// lines along its sides, reaching a little past it; Option/Alt on a rounded rectangle marks the
// centre of the corner nearest the pointer.

import type { NewShape, ObjectInfo, Pt, Shape } from "../../core/index.ts";
import { pickObject } from "../hittest.ts";
import { dist, signedArea } from "../geom.ts";
import { isDerivedId } from "../scene.ts";
import { toast } from "../toast.ts";
import { formatArea, formatLength, formatLengthValue, millimetresPerUnit } from "../units.ts";
import {
  centreMark,
  dataTag,
  detailCallout,
  drawingLabel,
  elevationBenchmark,
  elevationMarker,
  interiorElevation,
  legendLayout,
  northArrow,
  scaleBar,
  scaleBarStep,
  sectionMarker,
  slopeDimension,
  symmetryLabel,
  type Look,
  type MarkerDrawing,
  type SlopeStyle,
} from "../markerShapes.ts";
import { CHARACTERISTICS, featureControlFrame, type FeatureControl, type MaterialCondition } from "../gdtShapes.ts";
import { store } from "../state.ts";
import { toolPrefs, type PrefField } from "../toolPrefs.ts";
import { ALT_KEY, BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { addPieces, drawn, layerScale, PlaceTool, TwoPointTool, type Part } from "./detailing.ts";

/** a bubble's diameter on paper, mm, until Preferences change it */
const BUBBLE_MM = 10;
/** an interior elevation mark's diameter on paper, mm */
const INTERIOR_MM = 12;
/** a benchmark's circle on paper, mm */
const BENCHMARK_MM = 4;
/** a drawing label's line, at least, on paper, mm */
const LABEL_LINE_MM = 50;
/** Vectorworks' justification values, and vertical centre */
const JUSTIFY = { left: 1, centre: 2, right: 3 } as const;
const V_CENTRE = 3;
/** the colour index of black (FORMAT.md: 257 in the document colour table) */
export const BLACK = 257;

/** A marker's lines and circles in the drawing's attributes, its arrows filled in the pen's colour, its texts centred on their lines. */
export function markerParts(d: MarkerDrawing): Part[] {
  const ink = store.drawAttrs.penFore ?? BLACK;
  return [
    ...drawn(d),
    ...d.filled.map((points): Part => ({ shape: { kind: "polygon", points, closed: true }, attrs: { fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 100 } })),
    ...d.texts.map((t): Part => ({ kind: "text", at: t.at, text: t.text, height: t.height, hAlign: JUSTIFY[t.justify], vAlign: V_CENTRE, angle: t.angle })),
  ];
}

/** The bubble's numbers fields, for Preferences. */
const numberFields = (number: string, sheet: string) =>
  [
    { kind: "text", key: "number", label: "Drawing number", value: number },
    { kind: "text", key: "sheet", label: "Sheet number", value: sheet },
  ] as const;

type MarkerKind = "section" | "elevation";

const MARKERS: readonly { readonly id: MarkerKind; readonly label: string }[] = [
  { id: "section", label: "Section" },
  { id: "elevation", label: "Elevation" },
];
const LOOKS: readonly { readonly id: Look; readonly label: string }[] = [
  { id: "left", label: "Look Left" },
  { id: "right", label: "Look Right" },
];

export class SectionMarkerTool extends TwoPointTool {
  readonly id = "secmarker";
  readonly cursor = "crosshair";
  protected readonly label = "Section-Elevation Marker";
  private kind: MarkerKind = "section";
  private look: Look = "left";
  private number = "1";
  private sheet = "A-301";
  private bubbleMm = BUBBLE_MM;

  modes(): readonly ToolModes[] {
    return [
      { label: "Marker", options: MARKERS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind },
      { label: "Look", options: LOOKS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + MARKERS.length) })), active: this.look },
    ];
  }

  setMode(id: string): void {
    const kind = MARKERS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
    const look = LOOKS.find((m) => m.id === id);
    if (look) this.look = look.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Section-Elevation Marker Preferences",
      [...numberFields(this.number, this.sheet), { kind: "number", key: "size", label: "Bubble diameter", value: this.bubbleMm, min: 2, max: 50, unit: "mm" }],
      "On paper: a layer at 1:n draws the bubbles n times larger. A section looks to the left or right of the line as drawn.",
    );
    if (!v) return;
    this.number = v.choice("number");
    this.sheet = v.choice("sheet");
    this.bubbleMm = v.num("size");
  }

  hint(): string {
    const keys = "1–2 section or elevation · 3–4 look";
    if (this.kind === "section") return `${super.hint()} · ${keys}`;
    return `${this.start() ? "Click or release toward what it looks at" : "Click the marker, then toward what it looks at"} · ${keys}`;
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const r = (this.bubbleMm / 2) * scale;
    const d = this.kind === "section" ? sectionMarker(a, b, this.look, r, this.number, this.sheet) : elevationMarker(a, b, r, this.number, this.sheet);
    return d ? markerParts(d) : null;
  }

  protected refusal(): string {
    return this.kind === "section" ? "Drag a section line longer than its bubble." : "Drag from the marker toward what it looks at.";
  }
}

export class InteriorElevationTool extends PlaceTool {
  readonly id = "intelev";
  readonly cursor = "crosshair";
  protected readonly label = "Interior Elevation Marker";
  private numbers = ["1", "2", "3", "4"];
  private sheet = "A-401";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Interior Elevation Marker Preferences",
      [
        { kind: "text", key: "numbers", label: "Drawing numbers", value: this.numbers.join(", ") },
        { kind: "text", key: "sheet", label: "Sheet number", value: this.sheet },
      ],
      "The numbers of the four looks, separated by commas, from the one the mark turns to and on anticlockwise; leave one out for no number.",
    );
    if (!v) return;
    this.numbers = v.choice("numbers").split(",").map((n) => n.trim()).slice(0, 4);
    this.sheet = v.choice("sheet");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const d = scale === null ? null : interiorElevation(at, angle, (INTERIOR_MM / 2) * scale, this.numbers, this.sheet);
    return d ? markerParts(d) : null;
  }
}

export class DetailCalloutTool extends TwoPointTool {
  readonly id = "detailcallout";
  readonly cursor = "crosshair";
  protected readonly label = "Detail Callout";
  private number = "1";
  private sheet = "A-501";
  private bubbleMm = BUBBLE_MM;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Detail Callout Preferences",
      [...numberFields(this.number, this.sheet), { kind: "number", key: "size", label: "Bubble diameter", value: this.bubbleMm, min: 2, max: 50, unit: "mm" }],
      "On paper: a layer at 1:n draws the bubble n times larger.",
    );
    if (!v) return;
    this.number = v.choice("number");
    this.sheet = v.choice("sheet");
    this.bubbleMm = v.num("size");
  }

  hint(): string {
    return this.start() ? "Click or release at the detail's edge, toward the callout" : "Drag from the detail's centre to its edge, or click there";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    const d = scale === null ? null : detailCallout(a, b, (this.bubbleMm / 2) * scale, this.number, this.sheet);
    return d ? markerParts(d) : null;
  }

  protected refusal(): string {
    return "Drag a detail boundary bigger than the callout's bubble.";
  }
}

export class DrawingLabelTool extends PlaceTool {
  readonly id = "drawlabel";
  readonly cursor = "crosshair";
  protected readonly label = "Drawing Label";
  private number = "1";
  private sheet = "A-101";
  private title = "Drawing Title";

  async preferences(): Promise<void> {
    const v = await toolPrefs("Drawing Label Preferences", [
      ...numberFields(this.number, this.sheet),
      { kind: "text", key: "title", label: "Title", value: this.title },
    ]);
    if (!v) return;
    this.number = v.choice("number");
    this.sheet = v.choice("sheet");
    this.title = v.choice("title");
  }

  hint(): string {
    return "Click to place the label: the scale is the active layer's";
  }

  protected shapes(at: Pt): Part[] | null {
    const scale = this.scale();
    const d = scale === null ? null : drawingLabel(at, (BUBBLE_MM / 2) * scale, this.number, this.sheet, this.title, `Scale 1:${scale}`, LABEL_LINE_MM * scale);
    return d ? markerParts(d) : null;
  }
}

export class BenchmarkTool extends PlaceTool {
  readonly id = "benchmark";
  readonly cursor = "crosshair";
  protected readonly label = "Elevation Benchmark";
  private name = "FFL";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Elevation Benchmark Preferences",
      [{ kind: "text", key: "name", label: "Label", value: this.name }],
      "The elevation is the point's Y from the drawing's origin, in its units: for elevations and sections drawn in 2D.",
    );
    if (v) this.name = v.choice("name");
  }

  hint(): string {
    return "Click the point to mark its elevation";
  }

  protected shapes(at: Pt): Part[] | null {
    const scale = this.scale();
    const value = `${at.y < 0 ? "-" : "+"}${formatLengthValue(Math.abs(at.y), store.session?.doc.info.units)}`;
    const d = scale === null ? null : elevationBenchmark(at, (BENCHMARK_MM / 2) * scale, value, this.name);
    return d ? markerParts(d) : null;
  }
}

/** a north arrow's circle on paper, mm */
const NORTH_MM = 12;

export class NorthArrowTool extends PlaceTool {
  readonly id = "northarrow";
  readonly cursor = "crosshair";
  protected readonly label = "North Arrow";
  protected readonly clickAngle = Math.PI / 2;

  hint(): string {
    return "Click to place it pointing up, or press and drag toward north";
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const d = scale === null ? null : northArrow(at, angle, (NORTH_MM / 2) * scale);
    return d ? markerParts(d) : null;
  }
}

/** a scale bar's segments at the least, its height and its labels' height, on paper, mm */
const SCALE_SEGMENT_MM = 10;
const SCALE_BAR_MM = 2;
const SCALE_SEGMENTS = 4;

export class ScaleBarTool extends PlaceTool {
  readonly id = "scalebar";
  readonly cursor = "crosshair";
  protected readonly label = "Scale Bar";

  hint(): string {
    return "Click to place a scale bar for the active layer's scale";
  }

  protected shapes(at: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const units = store.session?.doc.info.units;
    // inches, feet, yards and miles are whole numbers of inches
    const inches = millimetresPerUnit(units) / 25.4;
    const imperial = Math.abs(inches - Math.round(inches)) < 1e-9;
    const step = scaleBarStep(SCALE_SEGMENT_MM * scale, imperial);
    const labels = Array.from({ length: SCALE_SEGMENTS + 1 }, (_, k) => (k === SCALE_SEGMENTS ? formatLength(k * step, units) : formatLengthValue(k * step, units)));
    const d = scaleBar(at, step, SCALE_BAR_MM * scale, labels);
    return d ? markerParts(d) : null;
  }
}

type TagField = "name" | "class" | "area" | "length";

const TAG_FIELDS: readonly { readonly id: TagField; readonly label: string }[] = [
  { id: "name", label: "Name" },
  { id: "class", label: "Class" },
  { id: "area", label: "Area" },
  { id: "length", label: "Length" },
];
/** a tag's text height on paper, mm */
const TAG_MM = 2.5;

/** The length round a shape (its perimeter when closed) and its area when closed, in mm and mm². */
export function measure(shape: Shape | null): { length: number | null; area: number | null } {
  if (!shape) return { length: null, area: null };
  if (shape.kind === "arc" && shape.center && shape.rx !== undefined) {
    const rx = shape.rx;
    const ry = shape.ry ?? rx;
    const sweep = Math.abs(shape.sweepAngle ?? 360);
    if (sweep >= 360) {
      // Ramanujan's perimeter of an ellipse
      const h = ((rx - ry) / (rx + ry)) ** 2;
      return { length: Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))), area: Math.PI * rx * ry };
    }
    return { length: rx === ry ? (rx * sweep * Math.PI) / 180 : null, area: null };
  }
  const pts = shape.points;
  if (!["line", "rect", "polygon", "polyline"].includes(shape.kind) || pts.length < 2) return { length: null, area: null };
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const closed = shape.kind === "rect" || shape.closed;
  if (closed) length += Math.hypot(pts[0].x - pts.at(-1)!.x, pts[0].y - pts.at(-1)!.y);
  return { length, area: closed && pts.length >= 3 ? Math.abs(signedArea(pts)) : null };
}

export class DataTagTool extends TwoPointTool {
  readonly id = "datatag";
  readonly cursor = "crosshair";
  protected readonly label = "Data Tag";
  private field: TagField = "name";
  /** the object being tagged, from the first click */
  private target: ObjectInfo | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Field", options: TAG_FIELDS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.field }];
  }

  setMode(id: string): void {
    const field = TAG_FIELDS.find((m) => m.id === id);
    if (field) this.field = field.id;
  }

  hint(): string {
    return `${this.start() ? "Click or release where the tag goes" : "Press on an object and drag to where its tag goes"} · 1–4 field`;
  }

  down(p: PointerInfo): void {
    if (!this.start()) {
      const layerId = store.activeLayerId;
      const layers = !layerId ? [] : store.editGroupId ? [layerId] : this.env.scene.pickableLayers(layerId);
      this.target = pickObject(this.env.scene, this.env.view, p.screen, layers);
      if (!this.target) {
        toast("Press on an object to tag it.", "info");
        return;
      }
    }
    super.down(p);
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    const text = this.value();
    const d = scale === null || text === null ? null : dataTag(a, b, text, TAG_MM * scale);
    return d ? markerParts(d) : null;
  }

  protected refusal(): string {
    return this.value() === null ? `The object has no ${this.field} to tag.` : "Drag the tag clear of the object's point.";
  }

  /** The tagged object's field as the tag shows it, or null when it has none. */
  private value(): string | null {
    const o = this.target;
    if (!o) return null;
    const units = store.session?.doc.info.units;
    if (this.field === "name") return o.name || null;
    if (this.field === "class") return store.session?.doc.classes().find((c) => c.index === o.classIndex)?.name ?? null;
    const m = measure(o.shape);
    if (this.field === "area") return m.area === null ? null : formatArea(m.area, units);
    return m.length === null ? null : formatLength(m.length, units);
  }
}

/** a legend's swatch height on paper, mm */
const SWATCH_MM = 5;

export class LegendTool extends PlaceTool {
  readonly id = "legend";
  readonly cursor = "crosshair";
  protected readonly label = "Graphic Legend";
  private title = "Legend";

  async preferences(): Promise<void> {
    const v = await toolPrefs("Graphic Legend Preferences", [{ kind: "text", key: "title", label: "Title", value: this.title }], "The classes used on the active layer and not hidden, each swatch drawn in its class's attributes.");
    if (v) this.title = v.choice("title");
  }

  hint(): string {
    return "Click to place a legend of the active layer's classes";
  }

  protected shapes(at: Pt): Part[] | null {
    const scale = this.scale();
    const doc = store.session?.doc;
    const layerId = store.activeLayerId;
    if (scale === null || !doc || !layerId) return null;
    const used = new Set(doc.objects(layerId).filter((o) => o.shape).map((o) => o.classIndex));
    const classes = doc
      .classes()
      .filter((c) => used.has(c.index) && c.visibility !== "hidden" && c.name !== "None")
      .sort((x, y) => x.name.localeCompare(y.name));
    if (classes.length === 0) return null;
    const { swatches, texts } = legendLayout(at, this.title, classes.map((c) => c.name), SWATCH_MM * scale);
    return [
      ...swatches.map((points, i): Part => ({ shape: { kind: "polygon", points, closed: true }, classIndex: classes[i].index, byClass: true })),
      ...texts.map((t): Part => ({ kind: "text", at: t.at, text: t.text, height: t.height, hAlign: JUSTIFY[t.justify], vAlign: V_CENTRE })),
    ];
  }

  protected refusal(): string {
    return "The active layer has no objects in a shown class other than None to list.";
  }
}

/** a symmetry label's bars on paper, mm, until Preferences change them */
const SYMMETRY_BAR_MM = 6;

export class SymmetryLabelTool extends TwoPointTool {
  readonly id = "symmetry";
  readonly cursor = "crosshair";
  protected readonly label = "Symmetry Label";
  private barMm = SYMMETRY_BAR_MM;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Symmetry Label Preferences",
      [{ kind: "number", key: "bar", label: "Bar length", value: this.barMm, min: 1, max: 50, unit: "mm" }],
      "On paper: a layer at 1:n draws the bars n times larger. They are a quarter of their length apart.",
    );
    if (v) this.barMm = v.num("bar");
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    const lines = scale === null ? null : symmetryLabel(a, b, this.barMm * scale);
    return lines ? lines.map((points): Part => ({ kind: "polyline", points, closed: false })) : null;
  }

  protected refusal(): string {
    return "Drag a longer axis: a symmetry label needs room for its bars at each end.";
  }
}

/** a slope dimension's labels on paper, mm, before Rise over Run's Scale Factor */
const SLOPE_TEXT_MM = 2.5;
/** a Rise over Run triangle's level side on paper, mm, before its Scale Factor */
const SLOPE_RUN_MM = 10;
const SLOPE_STYLES: readonly { readonly id: SlopeStyle; readonly label: string }[] = [
  { id: "riserun", label: "Rise over Run" },
  { id: "ratio", label: "Ratio" },
  { id: "percent", label: "Percent" },
  { id: "degrees", label: "Degrees" },
];

export class SlopeDimensionTool extends TwoPointTool {
  readonly id = "slopedim";
  readonly cursor = "crosshair";
  protected readonly label = "Slope Dimension";
  private style: SlopeStyle = "riserun";
  private roof = false;
  private scaleFactor = 1;
  /** Rise over Run's run (a roof pitch's 12), and Ratio's rise */
  private runBase = 12;
  private riseBase = 1;

  modes(): readonly ToolModes[] {
    return [{ label: "Style", options: SLOPE_STYLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.style }];
  }

  setMode(id: string): void {
    const style = SLOPE_STYLES.find((m) => m.id === id);
    if (style) this.style = style.id;
  }

  hint(): string {
    return `${this.start() ? "Click or release at the slope's end" : "Drag along a slope or click its start"} · 1–4 style`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Slope Dimension Preferences",
      [
        { kind: "check", key: "roof", label: "Draw Roof Surface", value: this.roof },
        { kind: "number", key: "scale", label: "Scale Factor (Rise over Run)", value: this.scaleFactor, min: 0.1, max: 20 },
        { kind: "number", key: "run", label: "Base: the run (Rise over Run)", value: this.runBase, min: 0.01, max: 10000 },
        { kind: "number", key: "rise", label: "Base: the rise (Ratio)", value: this.riseBase, min: 0.01, max: 10000 },
      ],
      "Rise over Run labels its triangle with the base and the rise over it (12 and 6 for a half pitch); Ratio shows the base rise against its run (1:2). Sizes are on paper: a layer at 1:n draws them n times larger.",
    );
    if (!v) return;
    this.roof = v.flag("roof");
    this.scaleFactor = v.num("scale");
    this.runBase = v.num("run");
    this.riseBase = v.num("rise");
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const riseRun = this.style === "riserun";
    const factor = riseRun ? this.scaleFactor : 1;
    const d = slopeDimension(a, b, {
      style: this.style,
      base: riseRun ? this.runBase : this.riseBase,
      run: SLOPE_RUN_MM * factor * scale,
      text: SLOPE_TEXT_MM * factor * scale,
    });
    if (!d) return null;
    return this.roof ? [roofSurface(a, b), ...markerParts(d)] : markerParts(d);
  }

  protected refusal(): string {
    return this.style === "ratio"
      ? "Ratio needs a sloping line: a level one has no rise to set against its run, and an upright one no run."
      : "A slope dimension needs a line that isn't upright: an upright line has no run.";
  }
}

/** The slope's line, in the drawing's first dashed line type when it has one. */
function roofSurface(a: Pt, b: Pt): Part {
  const shape: NewShape = { kind: "line", a, b };
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  return dashed ? { shape, attrs: { lineStyle: dashed.style } } : shape;
}

/** a feature control frame's text on paper, mm, until Preferences change it */
const FCF_TEXT_MM = 2.5;
const CONDITIONS: readonly { readonly value: MaterialCondition; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "M", label: "Maximum material (M)" },
  { value: "L", label: "Least material (L)" },
  { value: "S", label: "Regardless of feature size (S)" },
];
const DATUMS = ["Primary", "Secondary", "Tertiary"] as const;

export class FeatureControlFrameTool extends PlaceTool {
  readonly id = "fcf";
  readonly cursor = "crosshair";
  protected readonly label = "Feature Control Frame";
  private textMm = FCF_TEXT_MM;
  private frame: FeatureControl = {
    characteristic: "position",
    composite: false,
    tolerance: "0.1",
    diameter: true,
    condition: "M",
    statistical: false,
    projected: false,
    zoneHeight: "",
    projectedOutside: false,
    datums: [
      { letter: "A", condition: "none" },
      { letter: "B", condition: "none" },
      { letter: "C", condition: "none" },
    ],
  };

  hint(): string {
    return "Click to place a feature control frame, or press and drag to turn it · its contents are in Preferences";
  }

  async preferences(): Promise<void> {
    const f = this.frame;
    const v = await toolPrefs(
      "Feature Control Frame Preferences",
      [
        { kind: "choice", key: "kind", label: "Geometric Characteristic", value: f.characteristic, options: CHARACTERISTICS.map((c) => ({ value: c.id, label: c.label })) },
        { kind: "check", key: "composite", label: "Composite Box", value: f.composite },
        { kind: "text", key: "tolerance", label: "Tolerance", value: f.tolerance },
        { kind: "check", key: "diameter", label: "Show Diameter Symbol", value: f.diameter },
        { kind: "choice", key: "condition", label: "Material Condition", value: f.condition, options: CONDITIONS },
        { kind: "check", key: "statistical", label: "Statistical Tolerance", value: f.statistical },
        { kind: "check", key: "projected", label: "Projected Tolerance Zone", value: f.projected },
        { kind: "text", key: "zone", label: "Zone Height", value: f.zoneHeight },
        { kind: "check", key: "outside", label: "Place the PTZ symbol outside the FCF", value: f.projectedOutside },
        ...DATUMS.flatMap((name, i): PrefField[] => [
          { kind: "text", key: `datum${i}`, label: `${name} Datum Reference`, value: f.datums[i]?.letter ?? "" },
          { kind: "choice", key: `datumCondition${i}`, label: `${name} Material Condition`, value: f.datums[i]?.condition ?? "none", options: CONDITIONS },
        ]),
        { kind: "number", key: "text", label: "Text size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "A datum with no letter is left out. Text size is on paper: a layer at 1:n draws it n times larger.",
    );
    if (!v) return;
    const condition = (key: string): MaterialCondition => CONDITIONS.find((c) => c.value === v.choice(key))?.value ?? "none";
    this.frame = {
      characteristic: CHARACTERISTICS.find((c) => c.id === v.choice("kind"))?.id ?? "none",
      composite: v.flag("composite"),
      tolerance: v.choice("tolerance").trim(),
      diameter: v.flag("diameter"),
      condition: condition("condition"),
      statistical: v.flag("statistical"),
      projected: v.flag("projected"),
      zoneHeight: v.choice("zone").trim(),
      projectedOutside: v.flag("outside"),
      datums: DATUMS.map((_, i) => ({ letter: v.choice(`datum${i}`).trim(), condition: condition(`datumCondition${i}`) })),
    };
    this.textMm = v.num("text");
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const d = scale === null ? null : featureControlFrame(this.frame, at, angle, this.textMm * scale);
    return d ? markerParts(d) : null;
  }

  protected refusal(): string {
    return "The frame's Preferences leave it empty: choose a characteristic, a tolerance or a datum.";
  }
}

/** how far a centre mark reaches past its object on paper, mm, until Preferences change it */
const CENTRE_BEYOND_MM = 3;

/** A centre Center Mark marks: where it is, the way the object's sides run, and its half-sizes along and across them. */
interface Centre {
  readonly at: Pt;
  readonly u: Pt;
  readonly halfU: number;
  readonly halfV: number;
}

/** A rectangle's frame from its corners (counter-clockwise from its origin): the way its first side runs, and its sides. */
function frameOf(corners: readonly Pt[]): { u: Pt; w: number; h: number } | null {
  if (corners.length !== 4) return null;
  const w = dist(corners[0], corners[1]);
  const h = dist(corners[0], corners[3]);
  if (!(w > 0 && h > 0)) return null;
  return { u: { x: (corners[1].x - corners[0].x) / w, y: (corners[1].y - corners[0].y) / w }, w, h };
}

/**
 * The centre Center Mark marks on `o`: a circle's, oval's, rectangle's or rounded rectangle's
 * middle; with `corner`, the centre of the rounded rectangle's corner nearest `pos`. Null for
 * anything else.
 */
function centreOf(o: ObjectInfo, pos: Pt, corner: boolean): Centre | null {
  const s = o.shape;
  if (!s) return null;
  if (corner) {
    const r = s.roundRect;
    const f = r && r.rx > 0 && r.ry > 0 ? frameOf(r.corners) : null;
    if (!r || !f) return null;
    const v = { x: -f.u.y, y: f.u.x };
    // each corner's arc centre, in from the frame's corner by the radii
    const centres = ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([su, sv], i) => ({
      x: r.corners[i].x + su * r.rx * f.u.x + sv * r.ry * v.x,
      y: r.corners[i].y + su * r.rx * f.u.y + sv * r.ry * v.y,
    }));
    const at = centres.reduce((best, c) => (dist(c, pos) < dist(best, pos) ? c : best));
    return { at, u: f.u, halfU: r.rx, halfV: r.ry };
  }
  if (s.kind === "arc") {
    if (!s.center || !(s.rx !== undefined && s.rx > 0) || !(Math.abs(s.sweepAngle ?? 0) >= 360)) return null;
    return { at: s.center, u: { x: 1, y: 0 }, halfU: s.rx, halfV: s.ry ?? s.rx };
  }
  const corners = s.roundRect?.corners ?? (s.kind === "rect" ? s.points : null);
  const f = corners ? frameOf(corners) : null;
  if (!corners || !f) return null;
  return { at: { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }, u: f.u, halfU: f.w / 2, halfV: f.h / 2 };
}

export class CenterMarkTool extends BaseTool {
  readonly id = "centermark";
  readonly cursor = "crosshair";
  private beyondMm = CENTRE_BEYOND_MM;
  /** the mark a click would place where the pointer is, previewed */
  private hover: Pt[][] | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Center Mark Preferences",
      [{ kind: "number", key: "beyond", label: "Reach past the object", value: this.beyondMm, min: 0, max: 50, unit: "mm" }],
      "On paper: a layer at 1:n reaches n times further.",
    );
    if (v) this.beyondMm = v.num("beyond");
  }

  hint(): string {
    return `Click a circle, oval or rectangle to mark its centre · ${ALT_KEY} a rounded rectangle's corner`;
  }

  move(p: PointerInfo): void {
    this.hover = this.mark(p);
  }

  down(p: PointerInfo): void {
    const lines = this.mark(p);
    if (!lines) {
      toast(p.alt ? "Click near a rounded rectangle's corner to mark that corner's centre." : "Click a circle, oval, rectangle or rounded rectangle to mark its centre.", "info");
      return;
    }
    addPieces("Center Mark", [lines.map((l): Part => ({ kind: "line", a: l[0], b: l[1] }))]);
  }

  cancel(): void {
    this.hover = null;
  }

  overlay(g: Painter): void {
    const lines = this.hover;
    if (lines) withPreview(g, () => lines.forEach((l) => strokeScreen(g, l, false)));
  }

  /** The lines a click at `p` places on the active layer's object under it, or null over nothing it marks. */
  private mark(p: PointerInfo): Pt[][] | null {
    const layerId = store.activeLayerId;
    const scale = layerScale(this.env);
    if (!layerId || scale === null) return null;
    const o = pickObject(this.env.scene, this.env.view, p.screen, [layerId], (obj) => !isDerivedId(obj.id) && centreOf(obj, p.pos, p.alt) !== null);
    const c = o ? centreOf(o, p.pos, p.alt) : null;
    return c ? centreMark(c.at, c.u, c.halfU, c.halfV, this.beyondMm * scale) : null;
  }
}
