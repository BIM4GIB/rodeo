// The GIS tool set, each opening File > Document Settings > Georeferencing first in a drawing that
// isn't placed on the Earth. Vectorworks makes plug-in objects of them; these draw plain objects, so
// their figures are as they were when placed.
//
// Great Circle: a drag or two clicks between two points draws the shortest way over the Earth between
// them, with its length and direction. Constrained Line keeps to level, plumb and 30° and 45° off them.
// Graticule: a rectangle or a clicked outline fills with lines of latitude and longitude, every so
// many of them major and labelled.
// Survey Point: a click says what the point's coordinates are, which places the drawing, and marks it.
// There's one to a drawing. GIS Stake: a click marks a point with its coordinates, without placing
// the drawing; in Vertex each click of a path marks a point until a double-click ends it.

import type { Attributes, Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { bearingText, constrainedEnd, drawingToGeo, eastNorth, formatDegrees, geodesic, geoToDrawing, graticuleLines, graticuleProblem, greatCirclePath, parseDegrees, type DegreeStyle, type Georef, type Graticule } from "../geoShapes.ts";
import { documentGeoref, ensureGeoref, setDocumentGeoref, surveyPointSetup } from "../georef.ts";
import { colorMatcher } from "../pdfImport.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength } from "../units.ts";
import { addPart, addPieces, layerScale, preview, TwoPointTool, type Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

/** text and marks on paper, mm */
const TEXT_MM = 2.5;
const MARK_MM = 2;
const END_MM = 0.6;
/** a great circle's segments */
const STEPS = 48;
const CLICK_PX = 4;
const GREY = { r: 0.55, g: 0.55, b: 0.55 };
const H_LEFT = 1;
const H_CENTRE = 2;
const V_CENTRE = 3;
const SURVEY_NAME = "Survey Point";

type DistanceUnit = "km" | "m" | "mi" | "ft" | "nmi";
const DISTANCE_UNITS: readonly { readonly value: DistanceUnit; readonly label: string; readonly metres: number }[] = [
  { value: "km", label: "Kilometres", metres: 1000 },
  { value: "m", label: "Metres", metres: 1 },
  { value: "mi", label: "Miles", metres: 1609.344 },
  { value: "ft", label: "Feet", metres: 0.3048 },
  { value: "nmi", label: "Nautical Miles", metres: 1852 },
];

const polyline = (points: readonly Pt[], attrs?: Partial<Attributes>): Part => {
  const shape = { kind: "polyline" as const, points: [...points], closed: false, vertices: points.map(() => "corner" as const), radii: points.map(() => 0) };
  return attrs ? { shape, attrs } : shape;
};
const circle = (center: Pt, radius: number, attrs: Partial<Attributes>): Part => ({ shape: { kind: "arc", center, radius, startAngle: 0, sweepAngle: 360 }, attrs });
const label = (at: Pt, t: string, height: number, angle = 0, hAlign = H_CENTRE): Part => ({ kind: "text", at, text: t, height, hAlign, vAlign: V_CENTRE, angle });

/** The filled look of a small dot, in the pen's colour. */
function ink(): Partial<Attributes> {
  const c = store.drawAttrs.penFore ?? colorMatcher()({ r: 0, g: 0, b: 0 });
  return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 };
}

/** A line's text upright: its angle in degrees, turned a half turn if it would read upside down. */
function upright(a: Pt, b: Pt): number {
  const d = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return d > 90 ? d - 180 : d <= -90 ? d + 180 : d;
}

export class GreatCircleTool extends TwoPointTool {
  readonly id = "greatcircle";
  readonly cursor = "crosshair";
  protected readonly label = "Great Circle";
  private constrained = false;
  private showDistance = true;
  private unit: DistanceUnit = "km";
  private showAngle = true;
  private format: "azimuth" | "bearing" = "azimuth";
  private reverse = false;

  override modes(): readonly ToolModes[] {
    return [
      {
        options: [
          { id: "constrained", label: "Constrained Line", key: "1" },
          { id: "free", label: "Unconstrained Line", key: "2" },
        ],
        active: this.constrained ? "constrained" : "free",
      },
    ];
  }

  override setMode(id: string): void {
    this.constrained = id === "constrained";
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Great Circle Properties",
      [
        { kind: "check", key: "distance", label: "Show Distance", value: this.showDistance },
        { kind: "choice", key: "unit", label: "Distance Unit", value: this.unit, options: DISTANCE_UNITS.map(({ value, label }) => ({ value, label })) },
        { kind: "check", key: "angle", label: "Show Angle", value: this.showAngle },
        {
          kind: "choice",
          key: "format",
          label: "Angle Format",
          value: this.format,
          options: [
            { value: "azimuth", label: "Azimuth" },
            { value: "bearing", label: "Bearing" },
          ],
        },
        { kind: "check", key: "reverse", label: "Reverse", value: this.reverse },
      ],
      "The distance and direction are worked out over the WGS 84 ellipsoid when it's placed, and don't change if the line is moved.",
    );
    if (!v) return;
    this.showDistance = v.flag("distance");
    this.unit = v.choice("unit") as DistanceUnit;
    this.showAngle = v.flag("angle");
    this.format = v.choice("format") as "azimuth" | "bearing";
    this.reverse = v.flag("reverse");
  }

  override down(p: PointerInfo): void {
    if (documentGeoref()) super.down(p);
    else void ensureGeoref();
  }

  protected shapes(a: Pt, raw: Pt): Part[] | null {
    const g = documentGeoref();
    const scale = this.scale();
    if (!g || scale === null) return null;
    const b = this.constrained ? constrainedEnd(a, raw) : raw;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return null;
    const from = drawingToGeo(g, a);
    const to = drawingToGeo(g, b);
    const path = greatCirclePath(from, to, STEPS).map((p) => geoToDrawing(g, p));
    if (path.length !== STEPS + 1) return null;
    path[0] = a;
    path[STEPS] = b;
    const way = this.reverse ? geodesic(to, from) : geodesic(from, to);
    const unit = DISTANCE_UNITS.find((u) => u.value === this.unit) ?? DISTANCE_UNITS[0];
    const figure = way.distance / unit.metres;
    const height = TEXT_MM * scale;
    const mid = STEPS / 2;
    const angle = upright(path[mid - 1], path[mid + 1]);
    const rad = (angle * Math.PI) / 180;
    const place = (off: number): Pt => ({ x: path[mid].x - Math.sin(rad) * off, y: path[mid].y + Math.cos(rad) * off });
    const parts: Part[] = [polyline(path, { fillPattern: 0 }), circle(a, END_MM * scale, ink()), circle(b, END_MM * scale, ink())];
    if (this.showDistance) parts.push(label(place(height), `${figure.toFixed(figure >= 100 ? 1 : 3)} ${this.unit}`, height, angle));
    if (this.showAngle) parts.push(label(place(this.showDistance ? -height : height), this.format === "bearing" ? bearingText(way.azimuth) : `${way.azimuth.toFixed(2)}°`, height, angle));
    return parts;
  }

  protected override refusal(): string {
    return "Drag a longer line for the great circle.";
  }
}

export class GraticuleTool extends PathTool {
  readonly id = "graticule";
  protected readonly label = "Graticule";
  private rectangle = true;
  private corner: Pt | null = null;
  private pressScreen: Pt | null = null;
  private hover: Pt | null = null;
  /** the first lines and the spacing: in degrees, or in the drawing (mm) from a point of it */
  private cartesian = false;
  private startLat = "0";
  private startLon = "0";
  private stepLat = 1;
  private stepLon = 1;
  private startX = 0;
  private startY = 0;
  private stepX = 100000;
  private stepY = 100000;
  private majorEvery = 5;
  private labelMajor = true;
  private labelMinor = false;
  private style: DegreeStyle = "decimal";
  private precision = 2;

  modes(): ToolModes {
    return {
      options: [
        { id: "rectangle", label: "Rectangle", key: "1" },
        { id: "vertex", label: "Vertex", key: "2" },
      ],
      active: this.rectangle ? "rectangle" : "vertex",
    };
  }

  setMode(id: string): void {
    this.rectangle = id === "rectangle";
    this.corner = null;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Graticule Preferences",
      [
        {
          kind: "choice",
          key: "kind",
          label: "Grid starts at, and spacing, in",
          value: this.cartesian ? "cartesian" : "geodesic",
          options: [
            { value: "geodesic", label: "Geodesic coordinates" },
            { value: "cartesian", label: "Cartesian coordinates" },
          ],
        },
        { kind: "text", key: "startLat", label: "Start Latitude", value: this.startLat },
        { kind: "text", key: "startLon", label: "Start Longitude", value: this.startLon },
        { kind: "number", key: "stepLat", label: "Latitude Spacing", value: this.stepLat, min: 0.000001, max: 90, unit: "°" },
        { kind: "number", key: "stepLon", label: "Longitude Spacing", value: this.stepLon, min: 0.000001, max: 180, unit: "°" },
        { kind: "length", key: "startX", label: "Start X", value: this.startX, zero: true },
        { kind: "length", key: "startY", label: "Start Y", value: this.startY, zero: true },
        { kind: "length", key: "stepX", label: "X Spacing", value: this.stepX },
        { kind: "length", key: "stepY", label: "Y Spacing", value: this.stepY },
        { kind: "number", key: "major", label: "Major Lines at Count", value: this.majorEvery, min: 1, max: 1000, integer: true },
        { kind: "check", key: "labelMajor", label: "Label Major Lines", value: this.labelMajor },
        { kind: "check", key: "labelMinor", label: "Label Grid Lines", value: this.labelMinor },
        {
          kind: "choice",
          key: "style",
          label: "Label Style",
          value: this.style,
          options: [
            { value: "decimal", label: "Decimal degrees" },
            { value: "dms", label: "Degrees/minutes" },
          ],
        },
        { kind: "number", key: "precision", label: "Label Precision", value: this.precision, min: 0, max: 8, integer: true },
      ],
      "Major lines take the pen you draw with, and grid lines grey. Cartesian spacing is read as degrees where the grid starts, so the lines stay true parallels and meridians.",
    );
    if (!v) return;
    this.cartesian = v.choice("kind") === "cartesian";
    if (parseDegrees(v.choice("startLat")) === null || parseDegrees(v.choice("startLon")) === null) toast("The start's latitude or longitude wasn't degrees, so it stays as it was.", "info");
    else {
      this.startLat = v.choice("startLat");
      this.startLon = v.choice("startLon");
    }
    this.stepLat = v.num("stepLat");
    this.stepLon = v.num("stepLon");
    this.startX = v.num("startX");
    this.startY = v.num("startY");
    this.stepX = v.num("stepX");
    this.stepY = v.num("stepY");
    this.majorEvery = v.num("major");
    this.labelMajor = v.flag("labelMajor");
    this.labelMinor = v.flag("labelMinor");
    this.style = v.choice("style") as DegreeStyle;
    this.precision = v.num("precision");
  }

  /** The graticule's first lines and spacing, in degrees. */
  private settings(g: Georef): Graticule {
    const shared = { majorEvery: this.majorEvery, labelMajor: this.labelMajor, labelMinor: this.labelMinor, style: this.style, precision: this.precision };
    if (!this.cartesian) return { ...shared, start: { lat: parseDegrees(this.startLat) ?? 0, lon: parseDegrees(this.startLon) ?? 0 }, stepLat: this.stepLat, stepLon: this.stepLon };
    const at = { x: this.startX, y: this.startY };
    const start = drawingToGeo(g, at);
    const stepOf = (to: Pt, of: "lat" | "lon"): number => Math.abs(drawingToGeo(g, to)[of] - start[of]);
    return { ...shared, start, stepLat: stepOf({ x: at.x, y: at.y + this.stepY }, "lat") || stepOf({ x: at.x + this.stepY, y: at.y }, "lat"), stepLon: stepOf({ x: at.x + this.stepX, y: at.y }, "lon") || stepOf({ x: at.x, y: at.y + this.stepX }, "lon") };
  }

  protected parts(points: Pt[]): Part[] | string {
    const g = documentGeoref();
    const scale = layerScale(this.env);
    if (!g || scale === null) return "Georeference the drawing first.";
    if (points.length < 3) return "Draw an area for the graticule.";
    const t = this.settings(g);
    const problem = graticuleProblem(t);
    if (problem) return problem;
    const lines = graticuleLines(g, points, t);
    if (!lines) return "That many lines is too many: widen the spacing or draw a smaller area.";
    if (!lines.length) return "No grid lines fall in that area: check the spacing and where the grid starts.";
    const grey = colorMatcher()(GREY);
    const height = TEXT_MM * scale;
    const parts: Part[] = [];
    for (const line of lines) {
      parts.push(polyline(line.points, line.major ? { fillPattern: 0 } : { fillPattern: 0, penFore: grey }));
      if (!line.label) continue;
      const a = line.points[0];
      const b = line.points[1];
      const along = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const inward = { x: a.x + ((b.x - a.x) / along) * height * 0.8, y: a.y + ((b.y - a.y) / along) * height * 0.8 };
      const angle = upright(a, b);
      const rad = (angle * Math.PI) / 180;
      parts.push(label({ x: inward.x - Math.sin(rad) * height * 0.7, y: inward.y + Math.cos(rad) * height * 0.7 }, line.label, height, angle, H_LEFT));
    }
    return parts;
  }

  protected override previewParts(points: Pt[]): Part[] | string {
    return [polyline(points)];
  }

  protected startHint(): string {
    return "Click the area's first corner";
  }

  override hint(): string {
    if (!this.rectangle) return super.hint();
    return this.corner ? "Click or release at the opposite corner" : "Drag a rectangle for the graticule";
  }

  override down(p: PointerInfo): void {
    if (!documentGeoref()) {
      void ensureGeoref();
      return;
    }
    if (!this.rectangle) {
      super.down(p);
      return;
    }
    this.pressScreen = p.screen;
    if (!this.corner) {
      this.corner = p.pos;
      return;
    }
    this.finishRectangle(p.pos);
  }

  override move(p: PointerInfo): void {
    this.hover = p.pos;
    super.move(p);
  }

  override up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.rectangle && this.corner && press && Math.hypot(p.screen.x - press.x, p.screen.y - press.y) > CLICK_PX) this.finishRectangle(p.pos);
  }

  override cancel(): void {
    this.corner = null;
    super.cancel();
  }

  override key(e: KeyboardEvent): boolean {
    if (this.rectangle && this.corner && e.key === "Escape") {
      this.corner = null;
      return true;
    }
    return super.key(e);
  }

  override overlay(g: Painter): void {
    if (!this.rectangle) {
      super.overlay(g);
      return;
    }
    const a = this.corner;
    const b = this.hover;
    if (a && b) withPreview(g, () => strokeScreen(g, corners(a, b), true));
  }

  private finishRectangle(b: Pt): void {
    const a = this.corner;
    this.corner = null;
    if (a) this.finish(corners(a, b), true);
  }
}

function corners(a: Pt, b: Pt): Pt[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

type CoordinateUnit = "document" | "m" | "ft" | "decimal" | "dms";
const COORDINATE_UNITS: readonly { readonly value: CoordinateUnit; readonly label: string }[] = [
  { value: "m", label: "Metres" },
  { value: "ft", label: "Feet" },
  { value: "document", label: "Document Units" },
  { value: "decimal", label: "Decimal Degrees" },
  { value: "dms", label: "Degrees/Minutes/Seconds" },
];

/** What a stake's label shows. */
interface CoordinateFormat {
  /** northing first, as latitude comes before longitude */
  order: "ne" | "en" | "xy";
  unit: CoordinateUnit;
  precision: number;
  mark: boolean;
}

/** The lines of a point's coordinates. */
function coordinateLines(g: Georef, at: Pt, f: CoordinateFormat): string[] {
  if (f.order === "xy") {
    const units = store.session?.doc.info.units;
    return [`X ${formatLength(at.x, units)}`, `Y ${formatLength(at.y, units)}`];
  }
  const northFirst = f.order === "ne";
  if (f.unit === "decimal" || f.unit === "dms") {
    const place = drawingToGeo(g, at);
    const style: DegreeStyle = f.unit === "dms" ? "dms" : "decimal";
    const lat = formatDegrees(place.lat, style, f.precision, "NS");
    const lon = formatDegrees(place.lon, style, f.precision, "EW");
    return northFirst ? [lat, lon] : [lon, lat];
  }
  const en = eastNorth(g, at);
  const figure = (metres: number): string => {
    if (f.unit === "document") return formatLength(metres * 1000, store.session?.doc.info.units);
    const v = f.unit === "ft" ? metres / 0.3048 : metres;
    return `${v.toFixed(f.precision)}${f.mark ? (f.unit === "ft" ? " ft" : " m") : ""}`;
  };
  const n = `N ${figure(en.y)}`;
  const e = `E ${figure(en.x)}`;
  return northFirst ? [n, e] : [e, n];
}

function coordinateFields(prefix: string, labelPrefix: string, f: CoordinateFormat): PrefField[] {
  return [
    { kind: "choice", key: `${prefix}unit`, label: `${labelPrefix}Units`, value: f.unit, options: COORDINATE_UNITS },
    {
      kind: "choice",
      key: `${prefix}order`,
      label: `${labelPrefix}Order`,
      value: f.order,
      options: [
        { value: "ne", label: "Coordinate Point (NE)" },
        { value: "en", label: "Coordinate Point (EN)" },
        { value: "xy", label: "Coordinate Point (XY)" },
      ],
    },
    { kind: "number", key: `${prefix}precision`, label: `${labelPrefix}Decimal Precision`, value: f.precision, min: 0, max: 8, integer: true },
    { kind: "check", key: `${prefix}mark`, label: `${labelPrefix}Show Unit Mark`, value: f.mark },
  ];
}

function readFormat(v: PrefValues, prefix: string): CoordinateFormat {
  return { unit: v.choice(`${prefix}unit`) as CoordinateUnit, order: v.choice(`${prefix}order`) as CoordinateFormat["order"], precision: v.num(`${prefix}precision`), mark: v.flag(`${prefix}mark`) };
}

/** A stake's mark: a circle crossed past its edge, and its lines of text to its right. */
function stakeParts(at: Pt, lines: readonly string[], scale: number): Part[] {
  const r = MARK_MM * scale;
  const height = TEXT_MM * scale;
  const reach = r * 1.6;
  const parts: Part[] = [circle(at, r, { fillPattern: 0 }), { kind: "line", a: { x: at.x - reach, y: at.y }, b: { x: at.x + reach, y: at.y } }, { kind: "line", a: { x: at.x, y: at.y - reach }, b: { x: at.x, y: at.y + reach } }];
  const top = at.y + ((lines.length - 1) * height * 1.3) / 2;
  lines.forEach((line, i) => parts.push(label({ x: at.x + reach + height * 0.5, y: top - i * height * 1.3 }, line, height, 0, H_LEFT)));
  return parts;
}

export class SurveyPointTool extends BaseTool {
  readonly id = "surveypoint";
  readonly cursor = "crosshair";
  private hover: Pt | null = null;
  private main: CoordinateFormat = { order: "ne", unit: "m", precision: 3, mark: true };
  private secondary: CoordinateFormat = { order: "ne", unit: "decimal", precision: 6, mark: true };
  private showSecondary = true;
  private showNorth = true;
  private useElevation = false;
  private elevation = 0;
  private busy = false;

  hint(): string {
    return "Click where you know the coordinates";
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Survey Point Preferences",
      [
        ...coordinateFields("main", "Main: ", this.main),
        { kind: "check", key: "showSecondary", label: "Show Secondary Coordinates", value: this.showSecondary },
        ...coordinateFields("second", "Secondary: ", this.secondary),
        { kind: "check", key: "north", label: "Show Angle to True North", value: this.showNorth },
        { kind: "check", key: "useElevation", label: "Use Project Elevation", value: this.useElevation },
        { kind: "length", key: "elevation", label: "Project Elevation", value: this.elevation, zero: true },
      ],
      "There are no reference points for triangulation, and the label doesn't change if the survey point is moved or the drawing is placed again.",
    );
    if (!v) return;
    this.main = readFormat(v, "main");
    this.secondary = readFormat(v, "second");
    this.showSecondary = v.flag("showSecondary");
    this.showNorth = v.flag("north");
    this.useElevation = v.flag("useElevation");
    this.elevation = v.num("elevation");
  }

  move(p: PointerInfo): void {
    this.hover = p.pos;
  }

  overlay(g: Painter): void {
    const scale = layerScale(this.env);
    if (this.hover && scale !== null) preview(g, stakeParts(this.hover, [], scale));
  }

  down(p: PointerInfo): void {
    if (!this.busy) void this.placeAt(p.pos);
  }

  private async placeAt(at: Pt): Promise<void> {
    this.busy = true;
    try {
      const base = await ensureGeoref();
      if (!base) return;
      const g = await surveyPointSetup(at, base);
      const layer = store.activeLayerId;
      const scale = layerScale(this.env);
      if (!g || !layer || scale === null) return;
      const lines = [...coordinateLines(g, at, this.main)];
      if (this.showSecondary) lines.push(...coordinateLines(g, at, this.secondary));
      if (this.showNorth && g.north !== 0) lines.push(`True North ${g.north}°`);
      if (this.useElevation) lines.push(`Elev. ${formatLength(this.elevation, store.session?.doc.info.units)}`);
      const made = attempt("Survey Point", (s) =>
        s.batch(() => {
          const old = s.doc.layers().flatMap((l) => s.doc.objects(l.id)).filter((o) => o.name === SURVEY_NAME);
          if (old.length) s.deleteObjects(old.map((o) => o.id));
          const group = s.groupObjects(stakeParts(at, lines, scale).map((part) => addPart(s, layer, part)));
          s.setObjectName(group, SURVEY_NAME);
          return { group, replaced: old.length > 0 };
        }),
      );
      if (!made) return;
      setDocumentGeoref(g);
      setSelection([made.value.group]);
      if (made.value.replaced) toast("There's one survey point to a drawing, so this one replaced the last.", "info");
    } finally {
      this.busy = false;
    }
  }
}

export class GisStakeTool extends PathTool {
  readonly id = "gisstake";
  protected readonly label = "GIS Stake";
  private vertex = false;
  private hover: Pt | null = null;
  private format: CoordinateFormat = { order: "ne", unit: "m", precision: 3, mark: true };

  modes(): ToolModes {
    return {
      options: [
        { id: "standard", label: "Standard Insertion", key: "1" },
        { id: "vertex", label: "Vertex", key: "2" },
      ],
      active: this.vertex ? "vertex" : "standard",
    };
  }

  setMode(id: string): void {
    this.vertex = id === "vertex";
    super.cancel();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("GIS Stake Preferences", coordinateFields("", "", this.format), "There's no background map, and no Set Geolocation afterwards: a stake's label is as it was when placed.");
    if (v) this.format = readFormat(v, "");
  }

  protected parts(points: Pt[]): Part[] | string {
    const g = documentGeoref();
    const scale = layerScale(this.env);
    if (!g || scale === null) return "Georeference the drawing first.";
    return points.flatMap((at) => stakeParts(at, coordinateLines(g, at, this.format), scale));
  }

  protected override previewParts(points: Pt[]): Part[] | string {
    const scale = layerScale(this.env);
    return scale === null ? [] : points.flatMap((at) => stakeParts(at, [], scale));
  }

  protected startHint(): string {
    return "Click where the first stake goes";
  }

  override hint(): string {
    return this.vertex ? super.hint() : "Click to place a stake with its coordinates";
  }

  override move(p: PointerInfo): void {
    this.hover = p.pos;
    super.move(p);
  }

  override overlay(g: Painter): void {
    if (this.vertex) {
      super.overlay(g);
      return;
    }
    const scale = layerScale(this.env);
    if (this.hover && scale !== null) preview(g, stakeParts(this.hover, [], scale));
  }

  override down(p: PointerInfo): void {
    const g = documentGeoref();
    if (!g) {
      void ensureGeoref();
      return;
    }
    if (this.vertex) {
      super.down(p);
      return;
    }
    const scale = layerScale(this.env);
    if (scale !== null) addPieces(this.label, [stakeParts(p.pos, coordinateLines(g, p.pos, this.format), scale)]);
  }

  /** Each point of the path is a stake of its own. */
  protected override finish(points: Pt[], _closed: boolean): void {
    const g = documentGeoref();
    const scale = layerScale(this.env);
    if (g && scale !== null) addPieces(this.label, points.map((at) => stakeParts(at, coordinateLines(g, at, this.format), scale)));
  }
}
