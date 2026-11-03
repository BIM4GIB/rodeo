// The sums behind ConnectCAD's Legend (legend.ts): the signals a layer's circuits use, each with its
// colour and how many circuits carry it, and where a legend's title, rows, line samples and counts
// go. Paper sizes in mm, scaled by the layer's scale; the legend's frame has its insertion at its
// top-left corner, x across and y up, as a device's has. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { signalNames, signalInk, signalLetter } from "./ccadShapes.ts";

export interface LegendRow {
  readonly signal: string;
  readonly letter: string;
  /** "#rrggbb" */
  readonly ink: string;
  readonly count: number;
}

/** The signals of `signals` (one a circuit), each once with its count, in the signal list's order. */
export function legendRows(signals: readonly string[]): LegendRow[] {
  const counts = new Map<string, number>();
  for (const s of signals) counts.set(s, (counts.get(s) ?? 0) + 1);
  const names = signalNames();
  const rank = (s: string): number => {
    const i = names.indexOf(s);
    return i < 0 ? names.length : i;
  };
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([signal, count]) => ({ signal, letter: signalLetter(signal), ink: signalInk(signal), count }));
}

/** paper mm */
const PAD = 2;
const TITLE_ROW = 6;
const ROW = 5;
const SAMPLE = 12;
const GAP = 3;
/** a character of the legend's writing, roughly, on paper */
const CHAR = 1.5;
const COUNT = 8;
export const LEGEND_TEXT_MM = 2.5;
export const LEGEND_TITLE_MM = 3;

export interface LegendLayout {
  readonly width: number;
  readonly height: number;
  readonly title: Pt;
  /** where "No circuits" goes when it has no rows */
  readonly blank: Pt;
  readonly rows: readonly { readonly from: Pt; readonly to: Pt; readonly name: Pt; readonly count: Pt }[];
}

/** Where a legend of `rows` under `title` puts each part, at `scale` (drawing units per paper mm). */
export function legendLayout(title: string, rows: readonly LegendRow[], showCount: boolean, scale: number): LegendLayout {
  const longest = Math.max(0, ...rows.map((r) => r.signal.length));
  const width = Math.max(2 * PAD + title.length * CHAR * (LEGEND_TITLE_MM / LEGEND_TEXT_MM), 2 * PAD + SAMPLE + GAP + longest * CHAR + (showCount ? GAP + COUNT : 0));
  const height = PAD + TITLE_ROW + Math.max(1, rows.length) * ROW + PAD;
  const y = (i: number): number => -(PAD + TITLE_ROW + (i + 0.5) * ROW);
  const at = (x: number, yy: number): Pt => ({ x: x * scale, y: yy * scale });
  return {
    width: width * scale,
    height: height * scale,
    title: at(width / 2, -(PAD + TITLE_ROW / 2)),
    blank: at(width / 2, y(0)),
    rows: rows.map((_, i) => ({ from: at(PAD, y(i)), to: at(PAD + SAMPLE, y(i)), name: at(PAD + SAMPLE + GAP, y(i)), count: at(width - PAD, y(i)) })),
  };
}
