// Site Context's writer: puts the features into the drawing as a new design layer, with the Context
// classes (reused by name when they exist) and the look each kind is drawn with. It runs inside the
// caller's session.batch, so the import is one undo step. A kind the file has no object to copy
// settings from is drawn another way (a circle as a polygon, a polygon as a closed line, a line as
// lines), and every such change is counted for the report.

import type { Attributes, EditSession, NewShape, Pt } from "../../core/index.ts";
import type { SiteCategory, SiteFeature } from "./model.ts";

/** The class each kind of context goes into; created when the drawing has none of that name. */
export const CLASS_NAME: Readonly<Record<SiteCategory, string>> = {
  terrain: "Context-Terrain",
  buildings: "Context-Buildings",
  roads: "Context-Roads",
  paths: "Context-Paths",
  rail: "Context-Rail",
  water: "Context-Water",
  green: "Context-Green",
  trees: "Context-Trees",
  facilities: "Context-Facilities",
};

/** How each kind is drawn: its fill (none for lines), and its pen colour and weight in millimetres. */
interface Look {
  readonly fill?: string;
  readonly pen: string;
  readonly penMm: number;
}

const LOOK: Readonly<Record<SiteCategory, Look>> = {
  terrain: { pen: "#8b5e34", penMm: 0.1 },
  buildings: { fill: "#d9d9d9", pen: "#404040", penMm: 0.25 },
  roads: { pen: "#555555", penMm: 0.25 },
  paths: { pen: "#7d7d7d", penMm: 0.13 },
  rail: { pen: "#2f2f2f", penMm: 0.18 },
  water: { fill: "#b8dcf2", pen: "#3b82b5", penMm: 0.18 },
  green: { fill: "#cbe8b5", pen: "#6a9d55", penMm: 0.13 },
  trees: { fill: "#5d9a4b", pen: "#2c5a25", penMm: 0.18 },
  facilities: { pen: "#1f1f1f", penMm: 0.18 },
};

const WHITE = "#ffffff";
const BLACK = "#000000";
/** the labels' text size, typographic points, at the layer's scale */
const LABEL_PT = 9;
/** the credit's text size, points */
const CREDIT_PT = 6;
/** a typographic point, millimetres */
const POINT_MM = 0.3528;
/** the credit OpenStreetMap asks for (ODbL) */
export const CREDIT_TEXT = "© OpenStreetMap contributors";

export interface WriteOptions {
  /** the layer's name before numbering: "Site Context" */
  readonly layerName: string;
  /** the south-west corner of the area, world millimetres: where the credit goes */
  readonly corner: Pt;
  /** the class for the credit and for anything with no class of its own to go in */
  readonly fallbackClass: number;
}

export interface WriteReport {
  readonly layerId: string;
  readonly layerName: string;
  readonly placed: Partial<Record<SiteCategory, number>>;
  /** circles drawn as 24-sided polygons (the file has no arc to copy) */
  readonly circlesAsPolygons: number;
  /** closed outlines drawn as closed lines or as edges (the file has no polygon or polyline to copy) */
  readonly outlinesSimplified: number;
  /** labels left out (the file has no text to copy) and objects the file refused */
  readonly skipped: number;
}

/** The first of `base`, `base 2`, `base 3`, ... that no name in `taken` has (any case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

/** The palette index whose colour is nearest to `hex` (by RGB distance); 0 when the palette is empty. */
export function nearestColor(colors: readonly { index: number; css: string }[], hex: string): number {
  const target = rgb(hex);
  let best = colors[0]?.index ?? 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of colors) {
    const v = rgb(c.css);
    const d = (v[0] - target[0]) ** 2 + (v[1] - target[1]) ** 2 + (v[2] - target[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** A pen weight in mils (1/1000 inch), as Attributes keeps it, for a weight in millimetres. */
export function milsOf(mm: number): number {
  return Math.max(1, Math.round(mm / 0.0254));
}

/** The height of text of `points` at 1:`scale`, in world millimetres (the size Shape.textSize uses). */
export function labelHeightMm(points: number, scale: number): number {
  return points * POINT_MM * scale;
}

/** The class index for each kind used, reusing a class of the same name (any case). */
function classesFor(s: EditSession, cats: Iterable<SiteCategory>, fallback: number): Map<SiteCategory, number> {
  const existing = s.doc.classes();
  const out = new Map<SiteCategory, number>();
  for (const cat of cats) {
    const name = CLASS_NAME[cat];
    let index = existing.find((c) => c.name.toLowerCase() === name.toLowerCase())?.index;
    if (index === undefined) {
      try {
        index = s.createClass(name);
      } catch {
        // the name is taken by a layer or a symbol: the fallback class
        index = fallback;
      }
    }
    out.set(cat, index);
  }
  return out;
}

/**
 * Writes the features into the drawing: one design layer named after `layerName` (numbered when the
 * name is taken), the Context classes and the objects. Call it inside session.batch.
 */
export function writeSiteContext(s: EditSession, features: readonly SiteFeature[], options: WriteOptions): WriteReport {
  const layerName = uniqueName(
    options.layerName,
    s.doc.layers().map((l) => l.name),
  );
  const layerId = s.createLayer(layerName, "design");
  const scale = s.doc.layers().find((l) => l.id === layerId)?.scale ?? 100;
  const classes = classesFor(s, new Set(features.map((f) => f.cat)), options.fallbackClass);
  const colors = s.doc.colors();
  const white = nearestColor(colors, WHITE);
  const black = nearestColor(colors, BLACK);
  const noneClass = s.doc.classes().find((c) => c.name === "None")?.index ?? options.fallbackClass;
  const labelMm = labelHeightMm(LABEL_PT, scale);

  const placed: Partial<Record<SiteCategory, number>> = {};
  let circlesAsPolygons = 0;
  let outlinesSimplified = 0;
  let skipped = 0;

  const attrsFor = (cat: SiteCategory, filled: boolean): Partial<Attributes> => {
    const look = LOOK[cat];
    const fill = filled && look.fill !== undefined;
    return {
      lineStyle: 2,
      lineWeight: milsOf(look.penMm),
      penFore: nearestColor(colors, look.pen),
      fillPattern: fill ? 1 : 0,
      fillFore: fill ? nearestColor(colors, look.fill ?? WHITE) : white,
      fillOpacity: 100,
      penOpacity: 100,
    };
  };

  /** Adds one object; false (and counted) when the file refuses it. */
  const put = (classIndex: number, shape: NewShape, attrs: Partial<Attributes>): boolean => {
    try {
      s.addObject(layerId, shape, classIndex, attrs);
      return true;
    } catch {
      skipped++;
      return false;
    }
  };

  /** A closed outline: a polygon, else a closed polyline, else its edges as lines. */
  const outline = (cat: SiteCategory, pts: readonly Pt[], filled: boolean): void => {
    const attrs = attrsFor(cat, filled);
    const cls = classes.get(cat) ?? options.fallbackClass;
    if (s.canAdd("polygon")) {
      put(cls, { kind: "polygon", points: [...pts], closed: true }, attrs);
    } else if (s.canAdd("polyline")) {
      outlinesSimplified++;
      put(cls, { kind: "polyline", points: [...pts], closed: true }, attrs);
    } else if (s.canAdd("line")) {
      outlinesSimplified++;
      for (let i = 0; i < pts.length; i++) put(cls, { kind: "line", a: pts[i], b: pts[(i + 1) % pts.length] }, attrs);
    } else {
      skipped++;
    }
  };

  for (const f of features) {
    const cat = f.cat;
    const cls = classes.get(cat) ?? options.fallbackClass;
    const g = f.geom;
    let ok = true;
    switch (g.kind) {
      case "polygon":
        outline(cat, g.points, true);
        break;
      case "polyline": {
        const attrs = attrsFor(cat, false);
        if (s.canAdd("polyline")) {
          ok = put(cls, { kind: "polyline", points: [...g.points], closed: g.closed === true }, attrs);
        } else if (s.canAdd("line")) {
          outlinesSimplified++;
          for (let i = 0; i + 1 < g.points.length; i++) put(cls, { kind: "line", a: g.points[i], b: g.points[i + 1] }, attrs);
        } else {
          ok = false;
          skipped++;
        }
        break;
      }
      case "circle": {
        const attrs = attrsFor(cat, true);
        if (s.canAdd("arc")) {
          ok = put(cls, { kind: "arc", center: g.at, radius: g.radius, startAngle: 0, sweepAngle: 360 }, attrs);
        } else {
          circlesAsPolygons++;
          const sides = 24;
          const pts = Array.from({ length: sides }, (_, k) => {
            const a = (2 * Math.PI * k) / sides;
            return { x: g.at.x + g.radius * Math.cos(a), y: g.at.y + g.radius * Math.sin(a) };
          });
          outline(cat, pts, true);
        }
        break;
      }
      case "label":
        if (s.canAdd("text")) ok = put(cls, { kind: "text", at: g.at, text: g.text, height: labelMm }, attrsFor(cat, false));
        else {
          ok = false;
          skipped++;
        }
        break;
    }
    if (ok) placed[cat] = (placed[cat] ?? 0) + 1;
  }

  // the credit, just inside the area's south-west corner
  if (s.canAdd("text")) {
    put(
      noneClass,
      {
        kind: "text",
        at: { x: options.corner.x, y: options.corner.y },
        text: CREDIT_TEXT,
        height: labelHeightMm(CREDIT_PT, scale),
      },
      { lineStyle: 2, lineWeight: milsOf(0.1), penFore: black, fillPattern: 0, penOpacity: 100 },
    );
  }

  return { layerId, layerName, placed, circlesAsPolygons, outlinesSimplified, skipped };
}
