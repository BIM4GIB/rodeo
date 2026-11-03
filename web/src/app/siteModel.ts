// AEC > Terrain's site model: a surface triangulated through 3D loci and 3D polygons, or a flat one in a boundary,
// shown as contours and analysis colours in plan and as a mesh, grid or layer cake in 3D. It keeps its source
// points in its record and stands at the origin, drawn in the drawing's own coordinates. The existing surface comes
// from the source; the proposed one from the site modifiers, closed polygons carrying a Site Modifier record that
// the Site Modifiers tool draws. As in Vectorworks, a changed modifier takes effect when the model is updated, and
// the model wears a striped border until then. Heights are above the model's layer. It is its own plug-in, so
// Vectorworks' site models in a drawing are left alone.

import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordFieldSpec, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection, turnAbout, zoomToSelection } from "./commands.ts";
import { appContext, followEdits, otherSiteModifiers, registerPluginDrivers, siteModelsUpdated, type PluginDriver, type PluginWidget, sentToSurface } from "./ext.ts";
import { distToSegment, offsetPolyline } from "./geom.ts";
import { isDerivedId } from "./scene.ts";
import {
  clippedSurface,
  editedPoints,
  SLOPE_CATEGORIES,
  nearestOnContours,
  placedStations,
  type ContourLine,
  type PlacedLabel,
  SURFACE_EDITS,
  type SculptReach,
  type SwaleShape,
  alignedHeights,
  drapedFaces,
  bandPieces,
  borderRings,
  boundaryPoints,
  boxOf,
  cellFace,
  cellHeight,
  columnFaces,
  contourLevels,
  contourLines,
  cutAndFill,
  differenceSurface,
  ELEVATION_BANDS,
  facesByBand,
  flowArrows,
  gappedLine,
  gridCells,
  heightLookup,
  heightRange,
  labelPlace,
  labelStations,
  lineLength,
  niceInterval,
  packPoints,
  proposedPoints,
  skirtFaces,
  slopeBand,
  smoothed,
  surfaceFigures,
  surfaceOf,
  terracedFaces,
  unpackPoints,
  volumeAbove,
  type HeightAt,
  type ModifierKind,
  type Pt3,
  type SiteModifier,
  type Surface,
} from "./siteModelShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { createSnapshot } from "./siteSnapshot.ts";
import { simplifyPath } from "./trace.ts";
import { store } from "./state.ts";
import { closedOutline } from "./surfaces.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { formatArea, formatLength, formatLengthValue, formatVolume, parseLength } from "./units.ts";

export const SITE_MODEL = "Rodeo Site Model";
export const MODIFIER_FORMAT = "Site Modifier";
export const MODIFIER_CLASS = "Site-Modifiers";

const PLUGIN = 86;
const GROUP = 11;
const LOCUS3D = 9;
const POLY3D = 25;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  source: "Source Points",
  border: "Site Border Points",
  applied: "Applied Modifiers",
  sourceGroup: "Source Group",
  stale: "Needs Update",
  parts: "Drawn Parts",
  max: "Maximum Elevation",
  min: "Minimum Elevation",
  extend: "Extend Min/Max when Needed",
  datum: "Datum Elevation",
  interval: "Minor Contour Interval",
  multiplier: "Major Contour Multiplier",
  offset: "Start Contour Offset",
  scope: "Use Site Modifiers on",
  display2d: "2D Display",
  style2d: "2D Style",
  drawBorder: "Draw Site Border",
  labels: "Show Contour Labels",
  maxLabels: "Maximum Labels per Contour",
  minDistance: "Minimum Distance Between Labels",
  flow: "Show Flow Arrows",
  flowSpacing: "Flow Arrow Spacing",
  flowScaled: "Scaled to Slope",
  cutFill: "2D Cut and Fill Area",
  display3d: "3D Display",
  style3d: "3D Style",
  skirt: "Show Skirt",
  contour3d: "Show 3D Contour",
  gridSpacing: "3D Grid Spacing",
  projected: "Projected Area",
  areaExisting: "Surface Area (Existing)",
  areaProposed: "Surface Area (Proposed)",
  volumeExisting: "Volume (Existing)",
  volumeProposed: "Volume (Proposed)",
  cut: "Cut Volume",
  fill: "Fill Volume",
  net: "Net C&F Volume",
  total: "Total C&F Volume",
} as const;

const SCOPES = ["All Layers", "Visible Layers Only", "Same Layer as Site Model only"] as const;
const DISPLAYS_2D = ["Existing Only", "Proposed Only", "Proposed + Existing"] as const;
const STYLES_2D = ["2D Contours", "2D Contours (Smoothed)", "2D Contours (Colored Elevations)", "2D Contours (Colored Slopes)", "2D Triangle", "2D Triangle (Colored Slopes)"] as const;
const LABELS = ["None", "Major contours", "Major and minor contours"] as const;
const DISPLAYS_3D = ["No 3D Display", "Existing Only", "Proposed Only", "Cut and Fill"] as const;
const STYLES_3D = [
  "3D Mesh",
  "3D Mesh (Colored Elevation)",
  "3D Mesh (Colored Slope)",
  "3D Grid",
  "3D Grid (Colored Elevation)",
  "3D Grid (Colored Slope)",
  "3D Vertical Grid",
  "3D Contours",
  "3D Extruded Contours",
  "3D Extruded Contours (Colored Elevation)",
] as const;

const POPUPS: Readonly<Record<string, readonly string[]>> = {
  [FIELD.scope]: SCOPES,
  [FIELD.display2d]: DISPLAYS_2D,
  [FIELD.style2d]: STYLES_2D,
  [FIELD.labels]: LABELS,
  [FIELD.display3d]: DISPLAYS_3D,
  [FIELD.style3d]: STYLES_3D,
};

/** the fields kept up by the object itself, and only shown */
const FIGURES: readonly string[] = [FIELD.projected, FIELD.areaExisting, FIELD.areaProposed, FIELD.volumeExisting, FIELD.volumeProposed, FIELD.cut, FIELD.fill, FIELD.net, FIELD.total];

/** how close to a contour's height a label counts as on it, mm */
const LEVEL_TOLERANCE = 0.5;
/** a contour label's height on paper, mm */
const LABEL_MM = 2;
/** how wide a character of a label is, as a share of its height */
const LABEL_WIDTH = 0.62;
/** the weights of minor and major contours and the site's border, mils */
const MINOR_MILS = 2;
const MAJOR_MILS = 10;
const BORDER_MILS = 14;
const ARROW_MILS = 3;
/** the striped border's weight, mils, and the length of its stripes on paper, mm */
const STRIPE_MILS = 28;
const STRIPE_MM = 4;
const MAX_STRIPES = 600;
/** the most cells a 3D grid draws: past this they're wider than asked */
const MAX_GRID_CELLS = 40000;
/** the most points a model from a boundary takes */
const MAX_BOUNDARY_POINTS = 150000;
/** how far apart heights must be, mm, for a 2D cut and fill area to show */
const CUT_FILL_TOLERANCE = 1;

const COLOUR = {
  line: "#000000",
  faint: "#808080",
  terrain: "#9db57d",
  cut: "#e06666",
  fill: "#6fa8dc",
  skirt: "#8c7355",
  stale: "#ff0000",
  back: "#ffffff",
  limits: "#2e8b3d",
  pad: "#2f6fd0",
} as const;
const ELEVATION_COLOURS: readonly string[] = ["#2f7d4f", "#57a05a", "#8fbf5f", "#c8d66a", "#e6cf6b", "#d9a557", "#b57a45", "#8a5a36"];
const SLOPE_COLOURS: readonly string[] = ["#57a05a", "#c8d66a", "#f0b840", "#e8743b", "#b5392f"];

export type Look = Partial<Attributes>;

export function nearColour(doc: VwxDocument): (css: string) => number {
  const palette = doc.colors().map((c) => {
    const n = parseInt(c.css.slice(1, 7), 16);
    return { index: c.index, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  });
  const seen = new Map<string, number>();
  return (css) => {
    const had = seen.get(css);
    if (had !== undefined) return had;
    const n = parseInt(css.slice(1, 7), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let best = palette[0]?.index ?? 0;
    let least = Number.POSITIVE_INFINITY;
    for (const c of palette) {
      const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
      if (d < least) {
        least = d;
        best = c.index;
      }
    }
    seen.set(css, best);
    return best;
  };
}

export interface Model {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

/** Where a model's labels are kept: a plug-in's own fields can't be added to once it's in a drawing. */
const LABEL_FORMAT = "Site Model Labels";
const PLACED_FIELD = "Placed Labels";

function modelOf(doc: VwxDocument, id: string, layerId: string): Model | null {
  const records = doc.records(id);
  const rec = records.find((r) => r.parametric && r.name === SITE_MODEL && r.fields.some((f) => f.name === FIELD.source));
  if (!rec) return null;
  const labels = records.find((r) => r.name === LABEL_FORMAT);
  return { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value ?? labels?.fields.find((f) => f.name === field)?.value };
}

export function modelsIn(doc: VwxDocument): Model[] {
  if (!doc.hasPluginFormat(SITE_MODEL)) return [];
  const out: Model[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const m = modelOf(doc, o.id, layer.id);
      if (m) out.push(m);
    }
  }
  return out;
}

const numberOf = (m: Model, field: string): number => Number(m.value(field)) || 0;
export const datumOf = (m: Model): number => numberOf(m, FIELD.datum);
const elevationOf = (doc: VwxDocument, layerId: string): number => doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;

/** The modifiers the tool makes: what each is called, what it does and how it looks. */
const MODIFIER_TYPES: Readonly<Record<ModifierMode, { readonly type: string; readonly kind: ModifierKind; readonly colour: string; readonly dashed?: boolean }>> = {
  limits: { type: "Grade Limits", kind: "limits", colour: COLOUR.limits, dashed: true },
  pad: { type: "Planar Pad", kind: "pad", colour: COLOUR.pad },
  retaining: { type: "Pad with Retaining Edge", kind: "pad", colour: COLOUR.pad },
  edge: { type: "Retaining Edge", kind: "limits", colour: COLOUR.limits, dashed: true },
  aligned: { type: "Aligned", kind: "aligned", colour: "#7a4fc0" },
  line: { type: "Open Edge Line", kind: "line", colour: "#d0752f" },
  bed: { type: "Texture Bed", kind: "bed", colour: "#6f9a4d" },
  crop: { type: "Site Border", kind: "crop", colour: "#555555", dashed: true },
  contour: { type: "Site Model Contour", kind: "contour", colour: "#b0651f" },
  sculpt: { type: "Surface Sculpt", kind: "sculpt", colour: "#8a5fb5", dashed: true },
  swale: { type: "Swale/Berm", kind: "swale", colour: "#3f7fb5" },
  vertex: { type: "Surface Vertex", kind: "vertex", colour: "#8a5fb5" },
  spoil: { type: "Spoil Pile", kind: "spoil", colour: COLOUR.skirt },
};

/** setObjectTexture's part for all of an object */
const WHOLE_OBJECT = 3;

/** How close to something an aligned modifier's corner counts as touching it, mm. */
const ALIGN_REACH = 300;

/** A line's corners; a closed one comes back to its first. */
const openOutline = (shape: NonNullable<ObjectInfo["shape"]>): Pt[] | null => {
  const { points, closed } = shape as { points?: readonly Pt[]; closed?: boolean };
  return points && points.length >= 2 ? (closed ? [...points, points[0]] : [...points]) : null;
};

/** The extra shape a modifier has, in its Options field. */
interface ModifierOptions {
  sculpt?: SculptReach;
  swale?: SwaleShape;
  old?: Pt[];
}

const optionsOf = (text: RecordValue | undefined): ModifierOptions => {
  try {
    return text ? (JSON.parse(String(text)) as ModifierOptions) : {};
  } catch {
    return {};
  }
};

const circleOf = (ring: readonly Pt[]): { centre: Pt; radius: number } => {
  const centre = { x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length, y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length };
  return { centre, radius: ring.reduce((sum, p) => sum + Math.hypot(p.x - centre.x, p.y - centre.y), 0) / ring.length };
};

const LINE_KINDS: ReadonlySet<ModifierKind> = new Set<ModifierKind>(["line", "contour", "swale"]);

/** What an object is as a site modifier, if it's one. */
export function modifierOf(doc: VwxDocument, o: ObjectInfo): SiteModifier | null {
  if (!o.shape) return null;
  const rec = doc.records(o.id).find((r) => r.name === MODIFIER_FORMAT);
  if (!rec) return null;
  const value = (name: string): RecordValue | undefined => rec.fields.find((f) => f.name === name)?.value;
  const type = String(value("Type") ?? "");
  const kind = Object.values(MODIFIER_TYPES).find((t) => t.type === type)?.kind ?? "pad";
  const ring = o.shape.kind === "locus" ? [...o.shape.points] : LINE_KINDS.has(kind) ? openOutline(o.shape) : closedOutline(o.shape);
  if (!ring) return null;
  const options = optionsOf(value("Options"));
  const elevationText = String(value("Elevation") ?? "");
  const elevation = parseLength(elevationText || "0", doc.info.units) ?? 0;
  return {
    kind,
    ring: ring.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
    elevation,
    slope: (Number(value("Slope")) || 0) / 100,
    slopeAngle: Number(value("Slope Direction")) || 0,
    ...(value("Apply To") === "Existing" ? { existing: true } : {}),
    ...(type === MODIFIER_TYPES.edge.type && elevationText.trim() ? { level: elevation } : {}),
    ...(kind === "bed" ? { classIndex: o.classIndex, ...(o.attrs?.fillPattern ? { colour: o.attrs.fillFore } : {}) } : {}),
    ...options,
    // a sculpt goes where its circle has been moved or reshaped to
    ...(options.sculpt && !options.sculpt.elements ? { sculpt: { ...options.sculpt, ...circleOf(ring) } } : {}),
  };
}

/** The modifiers a model takes, as they stand in the drawing. */
function readModifiers(doc: VwxDocument, modelLayer: string, scope: string): SiteModifier[] {
  const others = otherSiteModifiers(doc, modelLayer, scope);
  if (!doc.recordFormats().some((f) => f.name === MODIFIER_FORMAT)) return others;
  const out: SiteModifier[] = [...others];
  for (const layer of doc.layers()) {
    if (layer.kind !== "design") continue;
    if (scope === "Same Layer as Site Model only" && layer.id !== modelLayer) continue;
    if (scope === "Visible Layers Only" && layer.visibility !== "visible") continue;
    for (const o of doc.objects(layer.id)) {
      const modifier = modifierOf(doc, o);
      if (modifier) out.push(modifier);
    }
  }
  return out.map((m) => (m.kind === "aligned" ? { ...m, heights: alignedHeights(m.ring, out, m.elevation, ALIGN_REACH) } : m));
}

const modifiersNow = (doc: VwxDocument, m: Model): string => JSON.stringify(readModifiers(doc, m.layerId, String(m.value(FIELD.scope))));

export interface Terrain {
  readonly existing: Surface;
  readonly existingAt: HeightAt;
  readonly proposed: Surface;
  readonly proposedAt: HeightAt;
  readonly modified: boolean;
  readonly border: readonly Pt[] | null;
}

export function terrainOf(m: Model): Terrain {
  const source = unpackPoints(String(m.value(FIELD.source) ?? "")) as unknown as Pt3[];
  const border = unpackPoints(String(m.value(FIELD.border) ?? "")).map(([x, y]) => ({ x, y }));
  const edge = border.length >= 3 ? border : null;
  const whole = surfaceOf(source, edge);
  if (!whole) throw new Error("The source points don't make a surface: it takes three not in a line.");
  const applied = JSON.parse(String(m.value(FIELD.applied) || "[]")) as SiteModifier[];
  // cropped by the last site border, which leaves the source as it was
  const crop = applied.filter((x) => x.kind === "crop").at(-1);
  const base = (crop ? clippedSurface(whole, heightLookup(whole), crop.ring) : null) ?? whole;
  const bounds = crop && base !== whole ? crop.ring : edge;
  const shaped = (surface: Surface, on: readonly SiteModifier[]): Surface | null => {
    if (!on.length) return null;
    const edits = on.filter((x) => SURFACE_EDITS.has(x.kind));
    const others = on.filter((x) => !SURFACE_EDITS.has(x.kind));
    const edited = (edits.length ? surfaceOf(editedPoints(surface, heightLookup(surface), edits), bounds) : null) ?? surface;
    return others.length ? surfaceOf(proposedPoints(edited, heightLookup(edited), others), bounds) : edited;
  };
  const working = applied.filter((x) => x.kind !== "bed" && x.kind !== "crop");
  const existing = shaped(base, working.filter((x) => x.existing)) ?? base;
  const existingAt = heightLookup(existing);
  const proposed = shaped(existing, working.filter((x) => !x.existing));
  return proposed ? { existing, existingAt, proposed, proposedAt: heightLookup(proposed), modified: true, border: bounds } : { existing, existingAt, proposed: existing, proposedAt: existingAt, modified: false, border: bounds };
}

export const pen = (colour: number, mils: number, lineStyle = 2): Look => ({ ...store.drawAttrs, fillPattern: 0, lineStyle, lineWeight: mils, penFore: colour });
export const solid = (colour: number, opacity = 100): Look => ({ ...store.drawAttrs, fillPattern: 1, fillFore: colour, fillBack: colour, fillOpacity: opacity, lineStyle: 0 });

const planeRing = (ring: readonly Pt3[]): Pt[] => ring.map((p) => ({ x: p[0], y: p[1] }));

const elevationLevels = (min: number, max: number): number[] => Array.from({ length: ELEVATION_BANDS - 1 }, (_, i) => min + ((max - min) * (i + 1)) / ELEVATION_BANDS);

const levelsOf = (m: Model): readonly { readonly z: number; readonly major: boolean }[] =>
  contourLevels(numberOf(m, FIELD.min), numberOf(m, FIELD.max), numberOf(m, FIELD.interval), numberOf(m, FIELD.multiplier), numberOf(m, FIELD.offset));

/** A surface's contours at a height, as the model draws them. */
const linesAt = (m: Model, surface: Surface, z: number): ContourLine[] => {
  const lines = contourLines(surface, z);
  return String(m.value(FIELD.style2d)) === "2D Contours (Smoothed)" ? lines.map(smoothed) : lines;
};

/** How far along a contour its labels go when they're left to place themselves. */
function automaticStations(m: Model, line: ContourLine, major: boolean, width: number): number[] {
  const labels = String(m.value(FIELD.labels));
  if (labels !== "Major and minor contours" && !(labels === "Major contours" && major)) return [];
  const length = lineLength(line);
  if (length < width * 3) return [];
  const minDistance = numberOf(m, FIELD.minDistance);
  const most = Math.max(1, Math.floor(numberOf(m, FIELD.maxLabels)));
  return labelStations(line, Math.max(1, Math.min(most, minDistance > 0 ? Math.floor(length / minDistance) : most)));
}

/** The labels a model has been given by hand; null when they place themselves. */
export function placedLabelsOf(m: Model): PlacedLabel[] | null {
  const text = String(m.value(PLACED_FIELD) ?? "");
  if (!text) return null;
  try {
    return JSON.parse(text) as PlacedLabel[];
  } catch {
    return null;
  }
}

/** What the model draws in plan. */
function planParts(s: EditSession, m: Model, t: Terrain, range: { min: number; max: number }): { shapes: NewShape[]; looks: Look[] } {
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const add = (shape: NewShape, look: Look): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const colour = nearColour(s.doc);
  const units = s.doc.info.units;
  const display = String(m.value(FIELD.display2d));
  const style = String(m.value(FIELD.style2d));
  const both = display === "Proposed + Existing" && t.modified;
  const main = display === "Existing Only" ? t.existing : t.proposed;
  const mainAt = display === "Existing Only" ? t.existingAt : t.proposedAt;
  const scale = layerScaleOf(m.layerId);
  const textHeight = LABEL_MM * scale;
  // the analysis colours, under the rest
  if (style === "2D Contours (Colored Elevations)") {
    for (const piece of bandPieces(main, elevationLevels(range.min, range.max))) add({ kind: "polygon", points: planeRing(piece.ring), closed: true }, solid(colour(ELEVATION_COLOURS[piece.band])));
  }
  const triangles = style.startsWith("2D Triangle");
  if (style.includes("Colored Slopes")) {
    for (const [band, faces] of facesByBand(main, slopeBand)) {
      for (const f of faces) add({ kind: "polygon", points: [{ x: f[0], y: f[1] }, { x: f[3], y: f[4] }, { x: f[6], y: f[7] }], closed: true }, solid(colour(SLOPE_COLOURS[band])));
    }
  }
  if (m.value(FIELD.cutFill) === true && t.modified) {
    const diff = differenceSurface(t.existing, t.proposed, t.existingAt, t.proposedAt, t.border);
    if (diff) {
      for (const piece of bandPieces(diff, [-CUT_FILL_TOLERANCE, CUT_FILL_TOLERANCE])) {
        if (piece.band !== 1) add({ kind: "polygon", points: planeRing(piece.ring), closed: true }, solid(colour(piece.band === 0 ? COLOUR.cut : COLOUR.fill), 50));
      }
    }
  }
  if (triangles) {
    for (const surface of both ? [t.existing, t.proposed] : [main]) {
      const look = pen(colour(both && surface === t.existing ? COLOUR.faint : COLOUR.line), MINOR_MILS);
      for (const f of facesByBand(surface, () => 0).get(0) ?? []) add({ kind: "polygon", points: [{ x: f[0], y: f[1] }, { x: f[3], y: f[4] }, { x: f[6], y: f[7] }], closed: true }, look);
    }
  } else {
    const levels = levelsOf(m);
    const dashed = s.doc.lineTypes().find((x) => x.dashes.length > 0)?.style;
    const placed = placedLabelsOf(m);
    const showLabels = String(m.value(FIELD.labels)) !== "None";
    const contours = (surface: Surface, at: HeightAt, faint: boolean, labelled: boolean): void => {
      const look = (major: boolean): Look => pen(colour(faint ? COLOUR.faint : COLOUR.line), major ? MAJOR_MILS : MINOR_MILS, faint ? (dashed ?? 2) : 2);
      for (const level of levels) {
        const text = formatLength(level.z, units);
        const width = text.length * textHeight * LABEL_WIDTH + textHeight;
        const lines = linesAt(m, surface, level.z);
        const byHand = placed && labelled && showLabels ? placedStations(lines, placed.filter((l) => Math.abs(l.z - level.z) < LEVEL_TOLERANCE)) : null;
        lines.forEach((line, i) => {
          const stations = byHand ? byHand[i] : placed || !labelled ? [] : automaticStations(m, line, level.major, width);
          for (const piece of gappedLine(line, stations, width)) add({ kind: "polygon", points: [...piece.points], closed: piece.closed }, look(level.major));
          for (const at2 of stations) {
            const place = labelPlace(line, at2, at);
            add({ kind: "text", at: place.at, text, height: textHeight, hAlign: 2, vAlign: 3, angle: place.angle } as NewShape, { fillPattern: 0 });
          }
        });
      }
    };
    if (display === "Existing Only" || both) contours(t.existing, t.existingAt, both, !both);
    if (display !== "Existing Only") contours(t.proposed, t.proposedAt, false, true);
  }
  if (m.value(FIELD.flow) === true) {
    const look = pen(colour(COLOUR.pad), ARROW_MILS);
    for (const [a, b] of flowArrows(mainAt, boxOf(main), numberOf(m, FIELD.flowSpacing), m.value(FIELD.flowScaled) === true)) add({ kind: "line", a, b }, look);
  }
  if (m.value(FIELD.drawBorder) === true) {
    const look = pen(colour(COLOUR.line), BORDER_MILS);
    for (const ring of borderRings(main)) add({ kind: "polygon", points: ring, closed: true }, look);
  }
  return { shapes, looks };
}

/** Adds what the model draws in 3D, its ids. */
function solidParts(s: EditSession, m: Model, t: Terrain, range: { min: number; max: number }, classIndex: number): string[] {
  const display = String(m.value(FIELD.display3d));
  if (display === "No 3D Display") return [];
  const style = String(m.value(FIELD.style3d));
  const min = numberOf(m, FIELD.min);
  const base = Math.min(min, range.min);
  let surface = display === "Existing Only" ? t.existing : t.proposed;
  if (display === "Cut and Fill") {
    const diff = differenceSurface(t.existing, t.proposed, t.existingAt, t.proposedAt, t.border);
    if (!diff) return [];
    surface = { points: diff.points.map((p): Pt3 => [p[0], p[1], p[2] + base]), triangles: diff.triangles };
  }
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const lift = -elevationOf(s.doc, m.layerId);
  const colour = nearColour(s.doc);
  const parts: number[][][] = [];
  const looks: Look[] = [];
  const part = (faces: number[][], css: string): void => {
    if (!faces.length) return;
    parts.push(faces);
    looks.push(solid(colour(css)));
  };
  const heights = heightRange(surface);
  const levels = elevationLevels(heights.min, heights.max);
  const bandFor = (z: number): number => levels.filter((l) => l <= z).length;
  const byBand = (entries: readonly { band: number; face: number[] }[], colours: readonly string[]): void => {
    const groups = new Map<number, number[][]>();
    for (const e of entries) {
      const list = groups.get(e.band);
      if (list) list.push(e.face);
      else groups.set(e.band, [e.face]);
    }
    for (const [band, faces] of groups) part(faces, colours[band]);
  };
  const mesh = style.startsWith("3D Mesh");
  if (style === "3D Mesh") part(facesByBand(surface, () => 0, lift).get(0) ?? [], COLOUR.terrain);
  else if (style === "3D Mesh (Colored Elevation)") byBand(bandPieces(surface, levels).map((p) => ({ band: p.band, face: p.ring.flatMap((q) => [q[0], q[1], q[2] + lift]) })), ELEVATION_COLOURS);
  else if (style === "3D Mesh (Colored Slope)") for (const [band, faces] of facesByBand(surface, slopeBand, lift)) part(faces, SLOPE_COLOURS[band]);
  else if (style.includes("Grid")) {
    const box = boxOf(surface);
    const spacing = Math.max(numberOf(m, FIELD.gridSpacing), Math.sqrt(((box.x1 - box.x0) * (box.y1 - box.y0)) / MAX_GRID_CELLS));
    const cells = gridCells(heightLookup(surface), box, spacing);
    if (style === "3D Grid") part(cells.map((c) => cellFace(c, lift)), COLOUR.terrain);
    else if (style === "3D Grid (Colored Elevation)") byBand(cells.map((c) => ({ band: bandFor(cellHeight(c)), face: cellFace(c, lift) })), ELEVATION_COLOURS);
    else if (style === "3D Grid (Colored Slope)") byBand(cells.map((c) => ({ band: slopeBand(c.corners[0], c.corners[1], c.corners[2]), face: cellFace(c, lift) })), SLOPE_COLOURS);
    else part(cells.flatMap((c) => columnFaces(c, base, lift)), COLOUR.terrain);
  } else if (style.startsWith("3D Extruded")) {
    const contours = contourLevels(heights.min, heights.max, numberOf(m, FIELD.interval), 0, numberOf(m, FIELD.offset)).map((l) => l.z);
    const faces = terracedFaces(surface, contours, base, lift);
    if (style.includes("Colored")) byBand(faces.map((f) => ({ band: Math.min(ELEVATION_BANDS - 1, Math.floor((f.band / (contours.length + 1)) * ELEVATION_BANDS)), face: f.face })), ELEVATION_COLOURS);
    else part(faces.map((f) => f.face), COLOUR.terrain);
  }
  if (mesh && display !== "Cut and Fill" && m.value(FIELD.skirt) === true) part(skirtFaces(surface, base, lift), COLOUR.skirt);
  const ids = parts.length ? s.addMeshes(m.layerId, parts, classIndex, looks) : [];
  if (mesh && display !== "Cut and Fill") {
    // a little over the ground, in their own class for its texture
    const raised = lift + Math.max((heights.max - heights.min) / 300, 5);
    const at = surface === t.existing ? t.existingAt : t.proposedAt;
    for (const bed of (JSON.parse(String(m.value(FIELD.applied) || "[]")) as SiteModifier[]).filter((x) => x.kind === "bed")) {
      const faces = drapedFaces(surface, at, bed.ring, raised);
      if (!faces.length) continue;
      const [id] = s.addMeshes(m.layerId, [faces], bed.classIndex ?? classIndex, solid(bed.colour ?? colour(MODIFIER_TYPES.bed.colour)));
      s.setObjectTexture(id, WHOLE_OBJECT, { texture: 0 });
      ids.push(id);
    }
  }
  if (style === "3D Contours" || (mesh && m.value(FIELD.contour3d) === true)) {
    const polys: { points: number[]; closed: boolean }[] = [];
    for (const level of contourLevels(heights.min, heights.max, numberOf(m, FIELD.interval), 0, numberOf(m, FIELD.offset))) {
      for (const line of contourLines(surface, level.z)) polys.push({ points: line.points.flatMap((p) => [p.x, p.y, level.z + lift]), closed: line.closed });
    }
    if (polys.length) ids.push(s.add3DPolygons(m.layerId, polys, classIndex));
  }
  return ids;
}

/** A red and white border, to say that the model hasn't caught up with its modifiers. */
function stripes(s: EditSession, m: Model, surface: Surface, classIndex: number): string[] {
  const colour = nearColour(s.doc);
  const rings = borderRings(surface);
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const red = pen(colour(COLOUR.stale), STRIPE_MILS);
  for (const ring of rings) {
    shapes.push({ kind: "polygon", points: ring, closed: true });
    looks.push(pen(colour(COLOUR.back), STRIPE_MILS));
    const line = { points: ring, closed: true };
    const length = lineLength(line);
    const stripe = Math.max(STRIPE_MM * layerScaleOf(m.layerId), length / MAX_STRIPES);
    const count = Math.max(2, Math.floor(length / stripe / 2));
    for (const piece of gappedLine(line, labelStations(line, count), length / count / 2)) {
      shapes.push({ kind: "polygon", points: [...piece.points], closed: false });
      looks.push(red);
    }
  }
  return s.addObjects(m.layerId, shapes, classIndex, looks);
}

function figures(s: EditSession, m: Model, t: Terrain): void {
  const units = s.doc.info.units;
  const datum = numberOf(m, FIELD.datum);
  const was = surfaceFigures(t.existing);
  const now = t.modified ? surfaceFigures(t.proposed) : was;
  const before = volumeAbove(t.existing, datum);
  const after = t.modified ? volumeAbove(t.proposed, datum) : before;
  const { cut, fill } = t.modified ? cutAndFill(t.existingAt, t.proposedAt, boxOf(t.existing)) : { cut: 0, fill: 0 };
  const net = fill - cut;
  const set = (field: string, text: string): void => s.setRecordField(m.id, m.format, field, text);
  set(FIELD.projected, formatArea(was.projected, units));
  set(FIELD.areaExisting, formatArea(was.area, units));
  set(FIELD.areaProposed, formatArea(now.area, units));
  set(FIELD.volumeExisting, formatVolume(before, units));
  set(FIELD.volumeProposed, formatVolume(after, units));
  set(FIELD.cut, formatVolume(cut, units));
  set(FIELD.fill, formatVolume(fill, units));
  set(FIELD.net, net === 0 ? formatVolume(0, units) : `${formatVolume(Math.abs(net), units)} ${net > 0 ? "fill" : "cut"}`);
  set(FIELD.total, formatVolume(cut + fill, units));
}

/** What a model draws, drawn again from its record; true when contours are left out by the elevation range. */
function redraw(s: EditSession, m: Model): boolean {
  const t = terrainOf(m);
  const o = s.doc.object(m.id);
  if (!o) throw new Error("That site model has gone.");
  // it stands at the origin, unturned: moved, it would be away from its own points
  const turned = s.pluginAngle(m.id);
  if (Math.abs(turned) > 1e-9 && o.insertion) s.transformObjects([m.id], turnAbout(o.insertion, -turned));
  const at = s.doc.object(m.id)?.insertion;
  if (at && (at.x !== 0 || at.y !== 0)) s.moveObjects([m.id], -at.x, -at.y);
  const a = heightRange(t.existing);
  const b = heightRange(t.proposed);
  const range = { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
  let min = numberOf(m, FIELD.min);
  let max = numberOf(m, FIELD.max);
  const outside = range.min < min || range.max > max;
  if (outside && m.value(FIELD.extend) === true) {
    const interval = numberOf(m, FIELD.interval) || 1;
    if (range.min < min) min = Math.floor(range.min / interval) * interval;
    if (range.max > max) max = Math.ceil(range.max / interval) * interval;
    s.setRecordField(m.id, m.format, FIELD.min, min);
    s.setRecordField(m.id, m.format, FIELD.max, max);
  }
  const current = modelOf(s.doc, m.id, m.layerId) ?? m;
  const classIndex = o.classIndex;
  const plan = planParts(s, current, t, range);
  const ids = plan.shapes.length ? s.addObjects(m.layerId, plan.shapes, classIndex, plan.looks) : [];
  ids.push(...solidParts(s, current, t, range, classIndex));
  s.setPluginDrawing(m.id, ids);
  s.setRecordField(m.id, m.format, FIELD.parts, ids.length);
  figures(s, current, t);
  const stale = modifiersNow(s.doc, current) !== String(current.value(FIELD.applied) || "[]");
  s.setRecordField(m.id, m.format, FIELD.stale, stale);
  if (stale) s.setPluginDrawing(m.id, stripes(s, current, t.proposed, classIndex), ids.length);
  return outside && m.value(FIELD.extend) !== true;
}

/** Keeps each model's striped border in step with whether its modifiers have changed since it was updated. */
function keepFlags(s: EditSession): void {
  const models = modelsIn(s.doc);
  const changed = models.filter((m) => (modifiersNow(s.doc, m) !== String(m.value(FIELD.applied) || "[]")) !== (m.value(FIELD.stale) === true));
  if (!changed.length) return;
  s.followOn(() => {
    for (const m of changed) {
      const stale = m.value(FIELD.stale) !== true;
      s.setRecordField(m.id, m.format, FIELD.stale, stale);
      const parts = numberOf(m, FIELD.parts);
      s.setPluginDrawing(m.id, stale ? stripes(s, m, terrainOf(m).proposed, s.doc.object(m.id)?.classIndex ?? store.activeClassIndex) : [], parts);
    }
  });
}
followEdits(keepFlags);

/** The settings a new model starts with, for a surface's heights. */
function defaults(s: EditSession, surface: Surface): Record<string, RecordValue> {
  const range = heightRange(surface);
  const units = s.doc.info.units;
  const interval = niceInterval(range.max - range.min, parseLength("1", units) || 1000);
  const box = boxOf(surface);
  const reach = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const min = Math.floor(range.min / interval) * interval - interval;
  return {
    [FIELD.max]: Math.ceil(range.max / interval) * interval,
    [FIELD.min]: min,
    [FIELD.extend]: true,
    [FIELD.datum]: Math.min(0, min),
    [FIELD.interval]: interval,
    [FIELD.multiplier]: 5,
    [FIELD.offset]: 0,
    [FIELD.scope]: SCOPES[0],
    [FIELD.display2d]: DISPLAYS_2D[2],
    [FIELD.style2d]: STYLES_2D[0],
    [FIELD.drawBorder]: true,
    [FIELD.labels]: LABELS[1],
    [FIELD.maxLabels]: 2,
    [FIELD.minDistance]: reach / 4,
    [FIELD.flow]: false,
    [FIELD.flowSpacing]: reach / 15,
    [FIELD.flowScaled]: true,
    [FIELD.cutFill]: false,
    [FIELD.display3d]: DISPLAYS_3D[2],
    [FIELD.style3d]: STYLES_3D[0],
    [FIELD.skirt]: true,
    [FIELD.contour3d]: false,
    [FIELD.gridSpacing]: reach / 40,
  };
}

const TYPE_OF: Readonly<Record<string, number>> = {
  [FIELD.max]: DIMENSION,
  [FIELD.min]: DIMENSION,
  [FIELD.extend]: BOOL,
  [FIELD.datum]: DIMENSION,
  [FIELD.interval]: DIMENSION,
  [FIELD.multiplier]: NUMBER,
  [FIELD.offset]: DIMENSION,
  [FIELD.scope]: POPUP,
  [FIELD.display2d]: POPUP,
  [FIELD.style2d]: POPUP,
  [FIELD.drawBorder]: BOOL,
  [FIELD.labels]: POPUP,
  [FIELD.maxLabels]: NUMBER,
  [FIELD.minDistance]: DIMENSION,
  [FIELD.flow]: BOOL,
  [FIELD.flowSpacing]: DIMENSION,
  [FIELD.flowScaled]: BOOL,
  [FIELD.cutFill]: BOOL,
  [FIELD.display3d]: POPUP,
  [FIELD.style3d]: POPUP,
  [FIELD.skirt]: BOOL,
  [FIELD.contour3d]: BOOL,
  [FIELD.gridSpacing]: DIMENSION,
};

function specsOf(values: Readonly<Record<string, RecordValue>>, source: string, border: string): PluginFieldSpec[] {
  return [
    { name: FIELD.source, type: TEXT, value: source },
    { name: FIELD.border, type: TEXT, value: border },
    { name: FIELD.applied, type: TEXT, value: "[]" },
    { name: FIELD.sourceGroup, type: TEXT, value: "" },
    { name: FIELD.stale, type: BOOL, value: false },
    { name: FIELD.parts, type: NUMBER, value: 0 },
    ...Object.entries(TYPE_OF).map(([name, type]): PluginFieldSpec => ({ name, type, value: values[name] })),
    ...FIGURES.map((name): PluginFieldSpec => ({ name, type: TEXT, value: "" })),
  ];
}

interface Asked {
  readonly name: string;
  readonly keep: boolean;
  readonly values: Record<string, RecordValue>;
}

/** The Site Model Settings dialog, opening on these values; null when cancelled. */
async function settingsDialog(name: string, values: Readonly<Record<string, RecordValue>>, creating: boolean): Promise<Asked | null> {
  const length = (key: string, zero = false, signed = false): PrefField => ({ kind: "length", key, label: key, value: Number(values[key]) || 0, zero, signed });
  const check = (key: string): PrefField => ({ kind: "check", key, label: key, value: values[key] === true });
  const choice = (key: string): PrefField => ({ kind: "choice", key, label: key, value: String(values[key]), options: POPUPS[key].map((value) => ({ value, label: value })) });
  const v = await toolPrefs(
    "Site Model Settings",
    [
      { kind: "text", key: "name", label: "Name", value: name },
      ...(creating ? [{ kind: "check", key: "keep", label: "Keep Source Data", value: true } as PrefField] : []),
      { kind: "heading", key: "", label: "General" },
      length(FIELD.max, true, true),
      length(FIELD.min, true, true),
      check(FIELD.extend),
      length(FIELD.datum, true, true),
      length(FIELD.interval),
      { kind: "number", key: FIELD.multiplier, label: FIELD.multiplier, value: Number(values[FIELD.multiplier]) || 5, min: 1, max: 100, integer: true },
      length(FIELD.offset, true, true),
      choice(FIELD.scope),
      { kind: "heading", key: "", label: "2D Display" },
      choice(FIELD.display2d),
      choice(FIELD.style2d),
      check(FIELD.drawBorder),
      choice(FIELD.labels),
      { kind: "number", key: FIELD.maxLabels, label: FIELD.maxLabels, value: Number(values[FIELD.maxLabels]) || 1, min: 1, max: 20, integer: true },
      length(FIELD.minDistance, true),
      check(FIELD.flow),
      length(FIELD.flowSpacing),
      check(FIELD.flowScaled),
      check(FIELD.cutFill),
      { kind: "heading", key: "", label: "3D Display" },
      choice(FIELD.display3d),
      choice(FIELD.style3d),
      check(FIELD.skirt),
      check(FIELD.contour3d),
      length(FIELD.gridSpacing),
    ],
    "Show Skirt and Show 3D Contour go with the 3D Mesh styles, and 3D Grid Spacing with the 3D Grid ones.",
  );
  if (!v) return null;
  const out: Record<string, RecordValue> = {};
  for (const [key, type] of Object.entries(TYPE_OF)) out[key] = type === BOOL ? v.flag(key) : type === POPUP ? v.choice(key) : v.num(key);
  return { name: v.choice("name"), keep: creating ? v.flag("keep") : true, values: out };
}

/** The object's name, or that with the first number that makes it unique: names can't repeat in a drawing. */
export function uniqueName(doc: VwxDocument, wanted: string, own?: string): string {
  const taken = new Set<string>();
  for (const layer of doc.layers()) for (const o of doc.objects(layer.id)) if (o.name && o.id !== own) taken.add(o.name);
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

function addModel(s: EditSession, layerId: string, asked: Asked, source: readonly Pt3[], border: readonly Pt[] | null): string {
  const specs = specsOf(asked.values, packPoints(source), border ? packPoints(border.map((p) => [p.x, p.y])) : "");
  const id = s.addPluginObject(layerId, SITE_MODEL, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), { x: 0, y: 0 }, 0, store.activeClassIndex);
  const m = modelOf(s.doc, id, layerId);
  if (!m) throw new Error("The site model couldn't be made.");
  s.setObjectName(id, uniqueName(s.doc, asked.name || "Site Model", id));
  // it starts with the modifiers already in the drawing
  bringUp(s, m);
  return id;
}

export function selectedTop(doc: VwxDocument): ObjectInfo[] {
  const out: ObjectInfo[] = [];
  if (!store.selection.size) return out;
  for (const layer of doc.layers()) for (const o of doc.objects(layer.id)) if (store.selection.has(o.id) && !isDerivedId(o.id)) out.push(o);
  return out;
}

/** The 3D loci and 3D polygons in these objects, going into groups. */
function sourceIn(doc: VwxDocument, picked: readonly ObjectInfo[]): string[] {
  const out: string[] = [];
  const childrenOf = new Map<string, ObjectInfo[]>();
  for (const layerId of new Set(picked.filter((o) => o.type === GROUP).map((o) => o.layerId))) {
    for (const o of doc.objects(layerId)) {
      if (!o.parentId) continue;
      const list = childrenOf.get(o.parentId);
      if (list) list.push(o);
      else childrenOf.set(o.parentId, [o]);
    }
  }
  const walk = (o: ObjectInfo): void => {
    if (o.type === LOCUS3D || o.type === POLY3D) out.push(o.id);
    else if (o.type === GROUP) for (const c of childrenOf.get(o.id) ?? []) walk(c);
  };
  picked.forEach(walk);
  return out;
}

/** The points of these objects, as heights above a layer at this elevation. */
function pointsOf(s: EditSession, ids: readonly string[], elevation: number): Pt3[] {
  const out: Pt3[] = [];
  for (const id of ids) for (const p of s.curvePoints(id)?.points ?? []) out.push([p[0], p[1], p[2] - elevation]);
  return out;
}

export const canMakeSiteModel = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && !!store.activeLayerId && selectedTop(doc).some((o) => o.type === LOCUS3D || o.type === POLY3D || o.type === GROUP);
};

function finished(id: string, message: string): void {
  setSelection([id]);
  const A = appContext();
  if (A) {
    zoomToSelection(A.scene, A.view);
    A.requestDraw();
  }
  toast(message, "info");
}

export async function siteModelFromSourceDialog(): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const picked = selectedTop(session.doc);
  const ids = sourceIn(session.doc, picked);
  const source = pointsOf(session, ids, elevationOf(session.doc, layerId));
  const surface = surfaceOf(source);
  if (!surface) {
    toast("A site model takes 3D loci or 3D polygons with at least three points, not all in a line. Select them first.", "error");
    return;
  }
  const asked = await settingsDialog("Site Model", defaults(session, surface), true);
  if (!asked || store.session !== session) return;
  const r = attempt("Site Model from Source Data", (s) =>
    s.batch(() => {
      const id = addModel(s, layerId, asked, source, null);
      if (!asked.keep) s.deleteObjects(picked.map((o) => o.id));
      return id;
    }),
  );
  if (r) finished(r.value, `Site model made of ${surface.points.length} points in ${surface.triangles.length / 3} triangles.`);
}

const boundaryOf = (o: ObjectInfo): Pt[] | null => (o.shape ? closedOutline(o.shape) : null);

export const canMakeBoundaryModel = (): boolean => {
  const doc = store.session?.doc;
  if (!doc || !store.activeLayerId) return false;
  const picked = selectedTop(doc);
  return picked.length === 1 && boundaryOf(picked[0]) !== null;
};

export async function siteModelFromBoundaryDialog(): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const picked = selectedTop(session.doc)[0];
  const ring = picked ? boundaryOf(picked) : null;
  if (!ring) {
    toast("Select a closed polygon or polyline for the site's boundary first.", "error");
    return;
  }
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const origin = { x: Math.min(...xs), y: Math.min(...ys) };
  const reach = Math.max(Math.max(...xs) - origin.x, Math.max(...ys) - origin.y);
  const units = session.doc.info.units;
  const v = await toolPrefs(
    "Site Model from Boundary",
    [
      { kind: "length", key: "spacing", label: "Grid Spacing", value: niceInterval(reach / 3, parseLength("1", units) || 1000) },
      { kind: "length", key: "elevation", label: "Elevation", value: 0, zero: true, signed: true },
    ],
    "The grid starts from the boundary's lower left corner.",
  );
  if (!v || store.session !== session) return;
  const source = boundaryPoints(ring, v.num("spacing"), origin, v.num("elevation"));
  if (source.length > MAX_BOUNDARY_POINTS) {
    toast(`That Grid Spacing makes ${source.length} points, more than a site model takes (${MAX_BOUNDARY_POINTS}): make it wider.`, "error");
    return;
  }
  const surface = surfaceOf(source, ring);
  if (!surface) {
    toast("That Grid Spacing is too wide for this boundary: make it narrower.", "error");
    return;
  }
  const start = defaults(session, surface);
  // flat, so there's nothing to take an interval from but the unit
  start[FIELD.interval] = parseLength("1", units) || 1000;
  start[FIELD.min] = v.num("elevation") - Number(start[FIELD.interval]);
  start[FIELD.max] = v.num("elevation") + Number(start[FIELD.interval]);
  start[FIELD.datum] = Math.min(0, Number(start[FIELD.min]));
  const asked = await settingsDialog("Site Model", start, true);
  if (!asked || store.session !== session) return;
  const r = attempt("Site Model from Boundary", (s) =>
    s.batch(() => {
      const id = addModel(s, layerId, asked, source, ring);
      if (!asked.keep) s.deleteObjects([picked.id]);
      return id;
    }),
  );
  if (r) finished(r.value, `Flat site model made of ${surface.points.length} points in ${surface.triangles.length / 3} triangles.`);
}

const modelById = (doc: VwxDocument, id: string): Model | null => {
  const layerId = doc.object(id)?.layerId;
  return layerId ? modelOf(doc, id, layerId) : null;
};

/** Brings a model up to date with its modifiers, as part of a batch; true when the elevation range left contours out. */
function bringUp(s: EditSession, m: Model): boolean {
  s.setRecordField(m.id, m.format, FIELD.applied, modifiersNow(s.doc, m));
  const live = modelById(s.doc, m.id);
  return live ? redraw(s, live) : false;
}

const OUTSIDE = "Some of the surface is outside the Minimum and Maximum Elevation, so its contours aren't drawn: widen them, or turn on Extend Min/Max when Needed.";

function updateModels(ids: readonly string[]): void {
  const r = attempt("Update Site Model", (s) =>
    s.batch(() => {
      let outside = false;
      for (const id of ids) {
        const m = modelById(s.doc, id);
        if (m && bringUp(s, m)) outside = true;
      }
      siteModelsUpdated(s);
      return outside;
    }),
  );
  if (!r) return;
  appContext()?.requestDraw();
  if (r.value) toast(OUTSIDE, "info");
  else toast(ids.length === 1 ? "Site model updated." : `${ids.length} site models updated.`, "info");
}

/** The surface a model's labels are on, as it's shown. */
const labelledSurface = (m: Model, t: Terrain): { surface: Surface; at: HeightAt } =>
  String(m.value(FIELD.display2d)) === "Existing Only" ? { surface: t.existing, at: t.existingAt } : { surface: t.proposed, at: t.proposedAt };

function labelFormat(s: EditSession): number {
  return s.doc.recordFormats().find((f) => f.name === LABEL_FORMAT)?.format ?? s.createRecordFormat(LABEL_FORMAT, [{ name: PLACED_FIELD, kind: "text", value: "" }]);
}

function writeLabels(s: EditSession, m: Model, labels: readonly PlacedLabel[] | null): void {
  const format = labelFormat(s);
  if (!s.doc.records(m.id).some((r) => r.format === format)) s.attachRecord([m.id], format);
  s.setRecordField(m.id, format, PLACED_FIELD, labels ? JSON.stringify(labels) : "");
  const live = modelById(s.doc, m.id);
  if (live) redraw(s, live);
}

/** The model the label tool works on, what it can hold on to until the drawing changes. */
export interface LabelWork {
  readonly model: Model;
  readonly surface: Surface;
  readonly labels: readonly PlacedLabel[];
  /** where each label is drawn, on its contour */
  readonly spots: readonly Pt[];
}

let labelModel: string | null = null;
/** whether the label tool starts on a line of clicks, for the next time it looks */
let labelsAlongNext: boolean | null = null;
export const takeLabelStart = (): boolean | null => {
  const along = labelsAlongNext;
  labelsAlongNext = null;
  return along;
};

export function labelWork(doc: VwxDocument): LabelWork | null {
  const models = modelsIn(doc);
  const model = models.find((m) => m.id === labelModel) ?? models[0];
  if (!model) return null;
  const { surface } = labelledSurface(model, terrainOf(model));
  const labels = placedLabelsOf(model) ?? [];
  const spots = labels.map((l) => nearestOnContours(linesAt(model, surface, l.z), l)?.at ?? l);
  return { model, surface, labels, spots };
}

/** The nearest place on a model's contours of one height. */
export const onContoursAt = (w: LabelWork, z: number, p: Pt): Pt | null => nearestOnContours(linesAt(w.model, w.surface, z), p)?.at ?? null;

/** Every contour height of a label tool's model. */
export const labelLevels = (w: LabelWork): number[] => levelsOf(w.model).map((l) => l.z);

/** A change to a model's labels, as one undo step. */
export function setPlacedLabels(label: string, id: string, labels: readonly PlacedLabel[] | null): void {
  const r = attempt(label, (s) =>
    s.batch(() => {
      const m = modelById(s.doc, id);
      if (m) writeLabels(s, m, labels);
    }),
  );
  if (r) appContext()?.requestDraw();
}

/** Add Contour Labels and Edit Contour Labels: takes up the tool, the labels so far now each with a place of its own. */
export function startLabelEdit(along: boolean, modelId: string | null = null): void {
  const ctx = appContext();
  const doc = store.session?.doc;
  if (!ctx || !doc) return;
  const models = modelsIn(doc);
  const m = models.find((x) => x.id === modelId || store.selection.has(x.id)) ?? models[0];
  if (!m) return;
  labelModel = m.id;
  if (!placedLabelsOf(m) || String(m.value(FIELD.labels)) === "None") {
    const r = attempt("Custom Label Placement", (s) =>
      s.batch(() => {
        if (String(m.value(FIELD.labels)) === "None") s.setRecordField(m.id, m.format, FIELD.labels, LABELS[1]);
        const live = modelById(s.doc, m.id);
        if (!live) return;
        const { surface, at } = labelledSurface(live, terrainOf(live));
        const textHeight = LABEL_MM * layerScaleOf(live.layerId);
        const seeded: PlacedLabel[] = placedLabelsOf(live) ?? [];
        if (!placedLabelsOf(live)) {
          for (const level of levelsOf(live)) {
            const width = formatLength(level.z, s.doc.info.units).length * textHeight * LABEL_WIDTH + textHeight;
            for (const line of linesAt(live, surface, level.z)) {
              for (const station of automaticStations(live, line, level.major, width)) seeded.push({ ...labelPlace(line, station, at).at, z: level.z });
            }
          }
        }
        writeLabels(s, live, seeded);
      }),
    );
    if (!r) return;
  }
  labelsAlongNext = along;
  ctx.show2d();
  ctx.setTool("sitelabels");
}

/** Which surface the sculpting and contour tools work on, as the command says. */
let editingExisting = false;
export const siteEditOnExisting = (): boolean => editingExisting;
export function setSiteEditOnExisting(existing: boolean): void {
  editingExisting = existing;
}

/** Edit Existing or Proposed Surface or Contours: takes up the tool for it, on the 2D drawing. */
export function startSiteEdit(tool: "sitesculpt" | "sitecontour", existing: boolean): void {
  // the tool shows which it is
  const ctx = appContext();
  if (!ctx) return;
  editingExisting = existing;
  ctx.show2d();
  ctx.setTool(tool);
}

/** The first model and the surface the tools are working on, as of now. */
export function siteEditSurface(doc: VwxDocument, at?: Pt): { model: Model; terrain: Terrain; surface: Surface; heightAt: HeightAt } | null {
  for (const model of modelsIn(doc)) {
    const terrain = terrainOf(model);
    const [surface, heightAt] = editingExisting ? [terrain.existing, terrain.existingAt] : [terrain.proposed, terrain.proposedAt];
    if (!at || heightAt(at.x, at.y) !== null) return { model, terrain, surface, heightAt };
  }
  return null;
}

/** The contour of a model's surface nearest a place, within reach: its height and its corners. */
export function siteContourAt(m: Model, surface: Surface, p: Pt, reach: number): { level: number; points: Pt[] } | null {
  const heights = heightRange(surface);
  let best: { level: number; points: Pt[]; off: number } | null = null;
  for (const l of contourLevels(heights.min, heights.max, numberOf(m, FIELD.interval), 0, numberOf(m, FIELD.offset))) {
    for (const line of contourLines(surface, l.z)) {
      const points = line.closed ? [...line.points, line.points[0]] : [...line.points];
      for (let i = 0; i + 1 < points.length; i++) {
        const off = distToSegment(p, points[i], points[i + 1]);
        if (off <= reach && (!best || off < best.off)) best = { level: l.z, points, off };
      }
    }
  }
  if (!best) return null;
  // without the corners it has only from crossing each triangle
  const box = boxOf(surface);
  return { level: best.level, points: simplifyPath(best.points, Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2000) };
}

/** A surface edit and the site models brought up to date with it, as one undo step; what's made stays selected. */
export function addSurfaceEdit(label: string, layerId: string, ring: readonly Pt[], k: ModifierSettings): void {
  const r = attempt(label, (s) =>
    s.batch(() => {
      const id = modifierObject(s, layerId, ring, k);
      for (const m of modelsIn(s.doc)) bringUp(s, m);
      siteModelsUpdated(s);
      return id;
    }),
  );
  if (r) appContext()?.requestDraw();
}

/** AEC > Terrain's and Object Info's Edit Crop: reshapes the site border, making one round the surface if there's none. */
export function editSiteCrop(modelId: string | null = null): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const m = modelsIn(doc).find((x) => x.id === modelId || store.selection.has(x.id)) ?? modelsIn(doc)[0];
  if (!m) return;
  const had = doc.objects(m.layerId).find((o) => doc.records(o.id).some((r) => r.name === MODIFIER_FORMAT && r.fields.some((f) => f.name === "Type" && f.value === MODIFIER_TYPES.crop.type)));
  let id = had?.id;
  if (!id) {
    const r = attempt("Edit Crop", (s) =>
      s.batch(() => {
        const t = terrainOf(m);
        const box = boxOf(t.existing);
        const ring = t.border ?? [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
        return modifierObject(s, m.layerId, ring, { kind: "crop", elevation: 0, useSurface: false, slope: 0, direction: 0 });
      }),
    );
    if (!r) return;
    id = r.value;
  }
  setSelection([id]);
  appContext()?.setTool("reshape");
  toast("Reshape the site border, then update the site model. Delete it to take the crop away.", "info");
}

/** Whether an object, or the selection, is a site model, for Edit Crop. */
export const isSiteModel = (id: string): boolean => {
  const doc = store.session?.doc;
  return !!doc && modelsIn(doc).some((m) => m.id === id);
};
export const siteModelSelected = (): boolean => [...store.selection].some(isSiteModel);

/** A model's values, for a snapshot to keep. */
export function modelValues(doc: VwxDocument, m: Model): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const r of doc.records(m.id)) if (r.format === m.format || r.name === LABEL_FORMAT) for (const f of r.fields) out[f.name] = f.value;
  return out;
}

/** A model made of values kept, for a snapshot to draw. */
export const copiedModel = (values: Readonly<Record<string, RecordValue>>, layerId: string): Model => ({ id: "", layerId, format: -1, value: (field) => values[field] });

const rangeOf = (t: Terrain): { min: number; max: number } => {
  const [a, b] = [heightRange(t.existing), heightRange(t.proposed)];
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
};

/** What a model draws, added to its layer: the plan and the solids, their ids. */
export function drawnParts(s: EditSession, m: Model, classIndex: number): string[] {
  const t = terrainOf(m);
  const range = rangeOf(t);
  const plan = planParts(s, m, t, range);
  const ids = plan.shapes.length ? s.addObjects(m.layerId, plan.shapes, classIndex, plan.looks) : [];
  ids.push(...solidParts(s, m, t, range, classIndex));
  return ids;
}

export interface SiteLegend {
  readonly title: string;
  readonly rows: readonly { readonly colour: string; readonly text: string }[];
  /** the top right of the surface */
  readonly corner: Pt;
}

/** What a model's colours in plan stand for, for a legend; null when it isn't showing any. */
export function legendOf(m: Model, units: string): SiteLegend | null {
  const style = String(m.value(FIELD.style2d));
  const t = terrainOf(m);
  const box = boxOf(t.existing);
  const corner = { x: box.x1, y: box.y1 };
  if (style === "2D Contours (Colored Elevations)") {
    const { min, max } = rangeOf(t);
    const levels = [min, ...elevationLevels(min, max), max];
    return { title: "Elevation", corner, rows: ELEVATION_COLOURS.map((colour, i) => ({ colour, text: `${formatLength(levels[i], units)} to ${formatLength(levels[i + 1], units)}` })) };
  }
  if (style.includes("Colored Slopes")) {
    const tops = [0, ...SLOPE_CATEGORIES];
    return { title: "Slope", corner, rows: SLOPE_COLOURS.map((colour, i) => ({ colour, text: i < SLOPE_CATEGORIES.length ? `${tops[i]} to ${tops[i + 1]}%` : `Over ${tops[i]}%` })) };
  }
  return null;
}

/** The fields a snapshot shows of the model it came from. */
export const SHOWN_FIELDS: readonly string[] = [FIELD.display2d, FIELD.style2d, FIELD.display3d, FIELD.style3d, ...FIGURES];

export const hasSiteModel = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && modelsIn(doc).length > 0;
};

/** AEC > Terrain > Update Site Model: the ones selected, or else them all. */
export function updateSiteModels(): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const models = modelsIn(doc);
  const chosen = models.filter((m) => store.selection.has(m.id));
  updateModels((chosen.length ? chosen : models).map((m) => m.id));
}

function currentValues(m: Model): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const key of Object.keys(TYPE_OF)) out[key] = m.value(key) as RecordValue;
  return out;
}

async function openSettings(id: string): Promise<void> {
  const session = store.session;
  const m = session ? modelById(session.doc, id) : null;
  if (!session || !m) return;
  const asked = await settingsDialog(session.doc.object(id)?.name ?? "Site Model", currentValues(m), false);
  if (!asked || store.session !== session) return;
  const r = attempt("Site Model Settings", (s) =>
    s.batch(() => {
      for (const [field, value] of Object.entries(asked.values)) s.setRecordField(id, m.format, field, value);
      if (asked.name) s.setObjectName(id, uniqueName(s.doc, asked.name, id));
      const live = modelById(s.doc, id);
      return live ? redraw(s, live) : false;
    }),
  );
  if (r?.value) toast(OUTSIDE, "info");
}

/** Recreate from Source Data: lays the source out as 3D loci to change, and the next press takes them back. */
function recreate(id: string): void {
  const session = store.session;
  const m = session ? modelById(session.doc, id) : null;
  if (!session || !m) return;
  const out = String(m.value(FIELD.sourceGroup) ?? "");
  if (out && session.doc.object(out)) {
    const r = attempt("Recreate from Source Data", (s) =>
      s.batch(() => {
        const group = s.doc.object(out);
        if (!group) throw new Error("The source data has gone.");
        const elevation = elevationOf(s.doc, m.layerId);
        const source = pointsOf(s, sourceIn(s.doc, [group]), elevation);
        if (!surfaceOf(source, null)) throw new Error("what's left of the source data doesn't make a surface: it takes three points not in a line");
        s.deleteObjects([out]);
        s.setRecordField(id, m.format, FIELD.source, packPoints(source));
        s.setRecordField(id, m.format, FIELD.sourceGroup, "");
        const live = modelById(s.doc, id);
        if (live) redraw(s, live);
        return source.length;
      }),
    );
    if (r) {
      setSelection([id]);
      toast(`Site model recreated from ${r.value} points.`, "info");
    }
    return;
  }
  const r = attempt("Recreate from Source Data", (s) =>
    s.batch(() => {
      const points = unpackPoints(String(m.value(FIELD.source) ?? ""));
      const group = s.add3DLoci(m.layerId, points, s.doc.object(id)?.classIndex, true)[0];
      s.setObjectName(group, uniqueName(s.doc, `${s.doc.object(id)?.name ?? "Site Model"} Source Data`, group));
      s.setRecordField(id, m.format, FIELD.sourceGroup, group);
      return group;
    }),
  );
  if (r) {
    setSelection([r.value]);
    toast("The source data is out on the layer as a group of 3D loci. Change it (Enter Group), then select the site model and click Recreate from Source Data again.", "info");
  }
}

function resetRange(id: string): void {
  attempt("Reset to Min/Max of Surface Geometry", (s) =>
    s.batch(() => {
      const m = modelById(s.doc, id);
      if (!m) return;
      const t = terrainOf(m);
      const [a, b] = [heightRange(t.existing), heightRange(t.proposed)];
      s.setRecordField(id, m.format, FIELD.min, Math.min(a.min, b.min));
      s.setRecordField(id, m.format, FIELD.max, Math.max(a.max, b.max));
      const live = modelById(s.doc, id);
      if (live) redraw(s, live);
    }),
  );
}

function edit(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Site Model", (s) =>
    s.batch(() => {
      const m = modelById(s.doc, id);
      if (!m) throw new Error("That isn't a site model.");
      // Geometry Lowest Z moves the whole model up or down, its source with it
      if (FIELD.min in values && !Object.is(Number(values[FIELD.min]), numberOf(m, FIELD.min))) {
        const by = Number(values[FIELD.min]) - numberOf(m, FIELD.min);
        const source = unpackPoints(String(m.value(FIELD.source) ?? "")).map((p) => [p[0], p[1], p[2] + by]);
        s.setRecordField(id, m.format, FIELD.source, packPoints(source));
        s.setRecordField(id, m.format, FIELD.max, numberOf(m, FIELD.max) + by);
      }
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, m.format, field, value);
      const live = modelById(s.doc, id);
      if (live) redraw(s, live);
    }),
  );
}

const BUTTON = { settings: 1, update: 2, reset: 3, recreate: 4, crop: 5, surfaceExisting: 6, surfaceProposed: 7, contoursExisting: 8, contoursProposed: 9, addLabels: 40, editLabels: 41, autoLabels: 42, snapshot: 43 } as const;
const param = (id: number, field: string, label = ""): PluginWidget => ({ id, kind: "param", field, label, level: 0 });
const button = (id: number, label: string): PluginWidget => ({ id, kind: "button", label, level: 0 });
const divider = (id: number, label: string): PluginWidget => ({ id, kind: "divider", label, level: 0 });

const WIDGETS: readonly PluginWidget[] = [
  button(BUTTON.settings, "Site Model Settings"),
  button(BUTTON.update, "Update"),
  button(BUTTON.crop, "Edit Crop"),
  button(BUTTON.contoursExisting, "Edit Existing Contours"),
  button(BUTTON.contoursProposed, "Edit Proposed Contours"),
  button(BUTTON.surfaceExisting, "Edit Existing Surface"),
  button(BUTTON.surfaceProposed, "Edit Proposed Surface"),
  button(BUTTON.addLabels, "Add Contour Labels"),
  button(BUTTON.editLabels, "Edit Contour Labels"),
  button(BUTTON.autoLabels, "Place Labels Automatically"),
  button(BUTTON.snapshot, "Create a Snapshot"),
  param(10, FIELD.min, "Geometry Lowest Z"),
  divider(11, "Display"),
  param(12, FIELD.display2d),
  param(13, FIELD.style2d),
  param(14, FIELD.drawBorder),
  param(15, FIELD.labels),
  param(16, FIELD.flow),
  param(17, FIELD.cutFill),
  param(18, FIELD.display3d),
  param(19, FIELD.style3d),
  param(20, FIELD.skirt),
  param(21, FIELD.contour3d),
  param(22, FIELD.gridSpacing),
  divider(23, "Figures"),
  param(24, FIELD.projected),
  param(25, FIELD.areaExisting),
  param(26, FIELD.areaProposed),
  param(27, FIELD.datum),
  param(28, FIELD.volumeExisting),
  param(29, FIELD.volumeProposed),
  param(30, FIELD.cut),
  param(31, FIELD.fill),
  param(32, FIELD.net),
  param(33, FIELD.total),
  divider(34, "Data"),
  button(BUTTON.reset, "Reset to Min/Max of Surface Geometry"),
  button(BUTTON.recreate, "Recreate from Source Data"),
];

const driver: PluginDriver = {
  name: SITE_MODEL,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => FIGURES.includes(field),
  choices: (field) => POPUPS[field]?.map((value) => ({ value, label: value })),
  place: () => toast("Select 3D loci or 3D polygons, then use AEC > Terrain > Site Model from Source Data.", "info"),
  edit,
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const m = modelById(s.doc, id);
        if (m) redraw(s, m);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const m = store.session ? modelById(store.session.doc, id) : null;
    if (!m) return;
    const style = String(m.value(FIELD.style3d));
    const shows = (widget: number, visible: boolean): [number, { enabled: boolean; visible: boolean }] => [widget, { enabled: true, visible }];
    apply(
      new Map([
        shows(20, style.startsWith("3D Mesh")),
        shows(21, style.startsWith("3D Mesh")),
        shows(22, style.includes("Grid")),
        shows(BUTTON.autoLabels, placedLabelsOf(m) !== null),
      ]),
    );
  },
  open: (id) => void openSettings(id),
  press(id, widget) {
    if (widget === BUTTON.settings) void openSettings(id);
    else if (widget === BUTTON.update) updateModels([id]);
    else if (widget === BUTTON.reset) resetRange(id);
    else if (widget === BUTTON.recreate) recreate(id);
    else if (widget === BUTTON.crop) editSiteCrop(id);
    else if (widget === BUTTON.surfaceExisting) startSiteEdit("sitesculpt", true);
    else if (widget === BUTTON.surfaceProposed) startSiteEdit("sitesculpt", false);
    else if (widget === BUTTON.contoursExisting) startSiteEdit("sitecontour", true);
    else if (widget === BUTTON.contoursProposed) startSiteEdit("sitecontour", false);
    else if (widget === BUTTON.addLabels) startLabelEdit(true, id);
    else if (widget === BUTTON.editLabels) startLabelEdit(false, id);
    else if (widget === BUTTON.autoLabels) setPlacedLabels("Place Labels Automatically", id, null);
    else if (widget === BUTTON.snapshot) createSnapshot(id);
  },
};
registerPluginDrivers(() => [driver]);

export type ModifierMode = "limits" | "pad" | "retaining" | "edge" | "aligned" | "line" | "bed" | "spoil" | "crop" | "contour" | "sculpt" | "swale" | "vertex";

export interface ModifierSettings {
  kind: ModifierMode;
  /** a retaining edge's distance outside its pad */
  edgeOffset?: number;
  applyTo?: "Proposed" | "Existing";
  /** what else it holds */
  options?: ModifierOptions;
  elevation: number;
  useSurface: boolean;
  /** percent */
  slope: number;
  /** degrees, counter-clockwise from +x */
  direction: number;
}

const NEWER_FIELDS: readonly RecordFieldSpec[] = [
  { name: "Apply To", kind: "text", value: "Proposed" },
  { name: "Options", kind: "text", value: "" },
];

function modifierFormat(s: EditSession): number {
  const had = s.doc.recordFormats().find((f) => f.name === MODIFIER_FORMAT);
  if (had) {
    // a drawing from before these
    const fields = s.doc.recordFormatFields(had.format) ?? [];
    const missing = NEWER_FIELDS.filter((n) => !fields.some((f) => f.name === n.name));
    if (missing.length) s.editRecordFormat(had.format, [...fields.map((f): RecordFieldSpec => ({ name: f.name, kind: f.kind, value: f.value, from: f.name })), ...missing]);
    return had.format;
  }
  return s.createRecordFormat(MODIFIER_FORMAT, [
    { name: "Type", kind: "text", value: "Planar Pad" },
    { name: "Elevation", kind: "text", value: "0" },
    { name: "Slope", kind: "number", value: 0 },
    { name: "Slope Direction", kind: "number", value: 0 },
    ...NEWER_FIELDS,
  ]);
}

export function modifierClass(s: EditSession): number {
  return s.doc.classes().find((c) => c.name === MODIFIER_CLASS)?.index ?? s.createClass(MODIFIER_CLASS);
}

/** How high the first model's proposed surface is at a place, or null with none there. */
export function surfaceHeightAt(doc: VwxDocument, p: Pt): number | null {
  for (const m of modelsIn(doc)) {
    const z = terrainOf(m).proposedAt(p.x, p.y);
    if (z !== null) return z;
  }
  return null;
}

/** A modifier's outline as a polygon carrying its record, as part of a batch. */
export function modifierObject(s: EditSession, layerId: string, ring: readonly Pt[], k: ModifierSettings): string {
  const units = s.doc.info.units;
  const centre = { x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length, y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length };
  // a spoil pile's elevation is how much it adds
  const elevation = k.useSurface && k.kind !== "spoil" ? (surfaceHeightAt(s.doc, centre) ?? k.elevation) : k.elevation;
  const colour = nearColour(s.doc);
  const dashed = s.doc.lineTypes().find((x) => x.dashes.length > 0)?.style;
  const kind = MODIFIER_TYPES[k.kind];
  const look = pen(colour(kind.colour), BORDER_MILS, kind.dashed ? (dashed ?? 2) : 2);
  const shape: NewShape = k.kind === "vertex" ? ({ kind: "locus", at: ring[0] } as NewShape) : { kind: "polygon", points: [...ring], closed: !LINE_KINDS.has(kind.kind) };
  const id = s.addObject(layerId, shape, modifierClass(s), look);
  const format = modifierFormat(s);
  const sloped = kind.kind === "pad" || kind.kind === "line";
  s.attachRecord([id], format);
  s.setRecordFields(format, [
    {
      id,
      fields: {
        Type: kind.type,
        // a retaining edge follows the ground till it's given a height
        Elevation: k.kind === "edge" ? "" : formatLengthValue(elevation, units),
        Slope: sloped ? k.slope : 0,
        "Slope Direction": sloped ? k.direction : 0,
        "Apply To": k.applyTo ?? "Proposed",
        Options: k.options ? JSON.stringify(k.options) : "",
      },
    },
  ]);
  s.setObjectName(id, uniqueName(s.doc, kind.type, id));
  return id;
}

/** The Site Modifiers tool's outline or line; a pad with a retaining edge gets its edge around it as well. */
export function addSiteModifier(layerId: string, ring: readonly Pt[], k: ModifierSettings): void {
  const r = attempt("Site Modifiers", (s) =>
    s.batch(() => {
      const id = modifierObject(s, layerId, ring, k);
      if (k.kind !== "retaining") return [id];
      const area = ring.reduce((sum, p, i) => sum + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0);
      const offset = k.edgeOffset ?? 914.4;
      const around = offsetPolyline(ring, true, area > 0 ? -offset : offset);
      if (!around) throw new Error("That pad has no room for a retaining edge at this offset.");
      return [id, modifierObject(s, layerId, around, { ...k, kind: "edge" })];
    }),
  );
  if (r) setSelection(r.value);
}

interface ChosenSurface {
  readonly at: HeightAt;
  readonly elevation: number;
}

async function chooseSurface(doc: VwxDocument): Promise<ChosenSurface | null> {
  const models = modelsIn(doc);
  const terrains = new Map(models.map((m) => [m.id, terrainOf(m)]));
  const options: { value: string; label: string; surface: ChosenSurface }[] = [];
  for (const m of models) {
    const t = terrains.get(m.id) as Terrain;
    const name = doc.object(m.id)?.name ?? "Site Model";
    const elevation = elevationOf(doc, m.layerId);
    if (t.modified) options.push({ value: `${m.id}:p`, label: `${name}: Proposed`, surface: { at: t.proposedAt, elevation } });
    options.push({ value: `${m.id}:e`, label: t.modified ? `${name}: Existing` : name, surface: { at: t.existingAt, elevation } });
  }
  if (options.length < 2) return options[0]?.surface ?? null;
  const v = await toolPrefs("Choose Surface", [{ kind: "choice", key: "surface", label: "Surface", value: options[0].value, options }]);
  return v ? (options.find((o) => o.value === v.choice("surface"))?.surface ?? null) : null;
}

export const canSendToSurface = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && store.selection.size > 0 && modelsIn(doc).length > 0;
};

/** AEC > Terrain > Send to Surface. */
export async function sendToSurface(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const picked = selectedTop(session.doc).filter((o) => !modelOf(session.doc, o.id, o.layerId));
  if (!picked.length) {
    toast("Select what to send to the surface first.", "error");
    return;
  }
  const chosen = await chooseSurface(session.doc);
  if (!chosen || store.session !== session) return;
  const height = (x: number, y: number): number | null => {
    const z = chosen.at(x, y);
    return z === null ? null : z + chosen.elevation;
  };
  let off = 0;
  let flat = 0;
  const r = attempt("Send to Surface", (s) =>
    s.batch(() => {
      const moved: string[] = [];
      for (const o of picked) {
        const layerAt = elevationOf(s.doc, o.layerId);
        const above = (x: number, y: number): number | null => {
          const z = height(x, y);
          return z === null ? null : z - layerAt;
        };
        if (sentToSurface(s, o, above)) {
          moved.push(o.id);
          continue;
        }
        if (o.shape?.kind === "locus" && o.type !== LOCUS3D) {
          const p = o.shape.points[0];
          const z = height(p.x, p.y);
          if (z === null) off++;
          else {
            moved.push(s.add3DLoci(o.layerId, [[p.x, p.y, z - layerAt]], o.classIndex)[0]);
            s.deleteObjects([o.id]);
          }
          continue;
        }
        const curve = o.type === LOCUS3D ? null : s.curvePoints(o.id);
        if (curve && curve.points.length >= 2) {
          const zs = curve.points.map((p) => height(p[0], p[1]));
          if (zs.every((z) => z === null)) {
            off++;
            continue;
          }
          const points = curve.points.flatMap((p, i) => [p[0], p[1], (zs[i] ?? p[2]) - layerAt]);
          const id = s.add3DPolygons(o.layerId, [{ points, closed: curve.closed }], o.classIndex);
          if (o.attrs) s.setAttributes([id], o.attrs);
          s.deleteObjects([o.id]);
          moved.push(id);
          continue;
        }
        const tris = o.type === LOCUS3D ? null : s.faceTriangles(o.id);
        if (o.type === LOCUS3D) {
          const p = s.curvePoints(o.id)?.points[0];
          const z = p ? height(p[0], p[1]) : null;
          if (!p || z === null) off++;
          else {
            s.moveObjects3D([o.id], 0, 0, z - p[2]);
            moved.push(o.id);
          }
          continue;
        }
        if (!tris?.length) {
          flat++;
          continue;
        }
        let [x0, y0, x1, y1, low] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
        for (let i = 0; i + 2 < tris.length; i += 3) {
          x0 = Math.min(x0, tris[i]);
          x1 = Math.max(x1, tris[i]);
          y0 = Math.min(y0, tris[i + 1]);
          y1 = Math.max(y1, tris[i + 1]);
          low = Math.min(low, tris[i + 2]);
        }
        const z = height((x0 + x1) / 2, (y0 + y1) / 2);
        if (z === null) {
          off++;
          continue;
        }
        s.moveObjects3D([o.id], 0, 0, z - low);
        moved.push(o.id);
      }
      return moved;
    }),
  );
  if (!r) return;
  if (r.value.length) setSelection(r.value);
  appContext()?.requestDraw();
  const notes = [off ? `${off} off the surface's edge` : "", flat ? `${flat} with nothing in 3D to place` : ""].filter(Boolean);
  toast(`Sent ${r.value.length} to the surface${notes.length ? `; left ${notes.join(" and ")}` : ""}.`, r.value.length ? "info" : "error");
}
