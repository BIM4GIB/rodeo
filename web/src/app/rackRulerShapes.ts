// What ConnectCAD's Rack Ruler tool draws (tools/rackRuler.ts), as plain geometry: a ruler up the
// side of an equipment rack, laid out upright from where it's placed (x across, y up). One column
// counts rack units (1.75 in each) with a tick at each; beside it the other gives their height in the
// drawing's units every five. The ruler's zero sits Base Offset above where it's placed. Kept apart
// from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { CHAR_WIDTH, type MarkerDrawing } from "./markerShapes.ts";

/** one rack unit, mm (EIA-310: 1.75 in) */
export const RACK_UNIT = 44.45;

export interface RackRuler {
  /** Height (RU) */
  readonly units: number;
  /** Base Offset, in the drawing: the ruler's zero above where it's placed */
  readonly baseOffset: number;
  /** the labels' text height, in the drawing */
  readonly textHeight: number;
  /** a height (mm) as the drawing's units show it, without the unit */
  readonly length: (mm: number) => string;
  /** the drawing units' column heading */
  readonly unitName: string;
}

/** steps the unit numbers may be labelled at, the smallest whose labels don't crowd */
const LABEL_STEPS = [1, 2, 5, 10, 20, 50, 100];
/** a unit tick's length, and every fifth unit's, against the text height */
const TICK = 0.3;
const LONG_TICK = 0.6;
/** room either side of a column's labels, against the text height */
const PAD = 0.25;

/** The ruler, its foot on the origin and running up from it, or why it can't be drawn. */
export function rackRuler(r: RackRuler): MarkerDrawing | string {
  if (!Number.isInteger(r.units) || r.units < 1) return "Give the rack ruler a Height of at least 1 RU.";
  if (!(r.textHeight > 0)) return "Set the rack ruler's text height more than 0.";
  const h = r.textHeight;
  const out: MarkerDrawing = { outlines: [], lines: [], circles: [], filled: [], texts: [] };
  const y0 = r.baseOffset;
  const yAt = (u: number): number => y0 + u * RACK_UNIT;
  const top = yAt(r.units);
  const step = LABEL_STEPS.find((s) => s * RACK_UNIT >= 1.25 * h) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
  const lengthStep = Math.max(5, step);
  const numbered = (every: number): number[] => Array.from({ length: Math.floor(r.units / every) + 1 }, (_, k) => k * every);
  const width = (texts: readonly string[]): number => Math.max(...texts.map((t) => t.length)) * CHAR_WIDTH * h;

  // the rack units' column, against the rack (x ≤ 0): a tick at every unit, longer every fifth
  const units = numbered(step);
  const uWide = LONG_TICK * h + width(units.map(String)) + 2 * PAD * h;
  out.outlines.push(box(-uWide, 0, y0, top));
  for (let u = 0; u <= r.units; u++) {
    const tick = (u % 5 === 0 ? LONG_TICK : TICK) * h;
    out.lines.push([{ x: 0, y: yAt(u) }, { x: -tick, y: yAt(u) }]);
  }
  for (const u of units) out.texts.push({ at: { x: -(LONG_TICK + PAD) * h, y: yAt(u) }, text: String(u), height: h, justify: "right" });

  // the drawing units' column outside it: every fifth unit's height
  const heights = numbered(lengthStep).map((u) => ({ u, text: r.length(u * RACK_UNIT) }));
  const lWide = LONG_TICK * h + width(heights.map((v) => v.text)) + 2 * PAD * h;
  out.outlines.push(box(-uWide - lWide, -uWide, y0, top));
  for (const { u, text } of heights) {
    out.lines.push([{ x: -uWide, y: yAt(u) }, { x: -uWide - LONG_TICK * h, y: yAt(u) }]);
    out.texts.push({ at: { x: -uWide - (LONG_TICK + PAD) * h, y: yAt(u) }, text, height: h, justify: "right" });
  }

  // the columns' headings
  const above = top + 1.3 * h;
  out.texts.push({ at: { x: -uWide / 2, y: above }, text: "U", height: h, justify: "centre" });
  out.texts.push({ at: { x: -uWide - lWide / 2, y: above }, text: r.unitName, height: h, justify: "centre" });
  return out;
}

function box(x0: number, x1: number, y0: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}
