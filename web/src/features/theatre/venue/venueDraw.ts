// What the Venue tools share on the drawing: the active design layer's scale, the Venue classes, and adding
// a sketch of plan points as objects inside the caller's batch. Labels are 3.5 mm on paper, so their height
// in the drawing is that times the layer's scale (a 1:48 layer draws them 168 mm high).

import type { Attributes, EditSession, Pt } from "../../../core/index.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { fromStage, type StageFrame, type StagePoint } from "../stage.ts";
import type { Sketch, StageSketch } from "./venueShapes.ts";

/** A label's height on paper, mm. */
export const LABEL_PAPER_MM = 3.5;

/** The active design layer's scale (1:n), or null when no design layer is active. */
export function activeScale(): number | null {
  const id = store.activeLayerId;
  const layer = id && store.session ? store.session.doc.layers().find((l) => l.id === id) : undefined;
  return layer && layer.kind === "design" ? layer.scale || 1 : null;
}

/** The drawing's class called `name`, made in session `s` when it isn't there yet. */
export function classIndexOf(s: EditSession, name: string): number {
  return s.doc.classes().find((c) => c.name === name)?.index ?? s.createClass(name);
}

/** A stage sketch as drawing points, placed through the stage's frame. */
export function drawingOf(frame: StageFrame, d: StageSketch): Sketch<Pt> {
  const at = (q: StagePoint): Pt => fromStage(frame, q);
  return {
    outlines: d.outlines.map((o) => o.map(at)),
    lines: d.lines.map((l) => l.map(at)),
    circles: d.circles.map((c) => ({ center: at(c.center), radius: c.radius })),
    filled: d.filled.map((f) => f.map(at)),
    texts: d.texts.map((t) => ({ at: at(t.at), text: t.text, height: t.height, justify: t.justify, angle: t.angle })),
  };
}

/** A solid fill in one palette colour. */
export function solid(colour: number): Partial<Attributes> {
  return { fillPattern: 1, fillFore: colour, fillBack: colour, fillOpacity: 100 };
}

/** The palette's mid-grey, for walls. */
export function midGrey(): number {
  return colorMatcher()({ r: 0.55, g: 0.55, b: 0.55 });
}

const JUSTIFY = { left: 1, centre: 2, right: 3 } as const;
/** Vectorworks' vertical centre for a text */
const V_CENTRE = 3;

/**
 * Adds a sketch's shapes to `layerId` in class `classIndex`, inside the caller's batch: its filled
 * shapes in `fill` (a palette colour) when given. Returns the new objects' ids.
 */
export function addSketch(s: EditSession, layerId: string, d: Sketch<Pt>, classIndex: number, fill?: number): string[] {
  const ids: string[] = [];
  for (const points of d.outlines) ids.push(s.addObject(layerId, { kind: "polygon", points, closed: true }, classIndex));
  for (const points of d.lines) ids.push(s.addObject(layerId, { kind: "polyline", points, closed: false }, classIndex));
  for (const c of d.circles) ids.push(s.addObject(layerId, { kind: "arc", center: c.center, radius: c.radius, startAngle: 0, sweepAngle: 360 }, classIndex));
  const attrs = fill === undefined ? undefined : solid(fill);
  for (const points of d.filled) ids.push(s.addObject(layerId, { kind: "polygon", points, closed: true }, classIndex, attrs));
  for (const t of d.texts) {
    ids.push(s.addObject(layerId, { kind: "text", at: t.at, text: t.text, height: t.height, hAlign: JUSTIFY[t.justify], vAlign: V_CENTRE, angle: t.angle }, classIndex));
  }
  return ids;
}
