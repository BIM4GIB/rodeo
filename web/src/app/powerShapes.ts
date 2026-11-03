// What Spotlight's Distributor and Electrical Component tools (tools/power.ts) draw, as plain
// geometry in mm on the point placed, turned as placed with its text kept level. A distributor
// with no symbol is the rectangle Vectorworks places, here with its output sockets numbered along
// it, its ID (and name) over it, and its output length as a circle round it. An electrical
// component is its glyph seen from above: a coloured drum on a square base for a power source,
// input, output or consumer, and a narrow box with a cap for an overcurrent protector.

import type { Pt } from "../core/index.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";

/** most output sockets a distributor draws */
export const MAX_OUTPUTS = 48;

export interface Distributor {
  readonly width: number;
  readonly depth: number;
  readonly outputs: number;
  /** its ID and name, each left out when blank */
  readonly id: string;
  readonly name: string;
  /** the longest cable its outputs reach, drawn as a circle round it; null for none */
  readonly outputLength: number | null;
}

const at = (x: number, y: number): Pt => ({ x, y });

/** A turn of `angle` radians about the origin. */
function turner(angle: number): (x: number, y: number) => Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (x, y) => at(x * c - y * s, x * s + y * c);
}

/** A distributor centred on the origin and turned `angle` radians, its labels `textSize` high; or why it can't be drawn. */
export function distributor(d: Distributor, textSize: number, angle: number): MarkerDrawing | string {
  if (!(d.width > 0 && d.depth > 0)) return "Set the distributor's Width and Depth over 0.";
  if (!(d.outputs >= 0 && d.outputs <= MAX_OUTPUTS)) return `Give it from 0 to ${MAX_OUTPUTS} outputs.`;
  if (d.outputLength !== null && !(d.outputLength > 0)) return "Set the Output Length over 0, or turn Draw Output Lengths off.";
  const turn = turner(angle);
  const w = d.width / 2;
  const h = d.depth / 2;
  const outlines = [[turn(-w, -h), turn(w, -h), turn(w, h), turn(-w, h)]];
  const circles: { center: Pt; radius: number }[] = [];
  const texts: MarkerText[] = [];
  // the sockets in a row along it, each numbered
  const pitch = d.width / Math.max(1, d.outputs);
  const r = Math.min(pitch, d.depth) * 0.35;
  for (let i = 0; i < d.outputs; i++) {
    const centre = turn(-w + pitch * (i + 0.5), 0);
    circles.push({ center: centre, radius: r });
    texts.push({ at: centre, text: String(i + 1), height: r, justify: "centre" });
  }
  // the ID and name stacked over it, level on the page, clear of it whichever way it's turned
  const reach = Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle));
  const lines = [d.name.trim(), d.id.trim()].filter(Boolean);
  lines.forEach((text, i) => texts.push({ at: at(0, reach + textSize * (0.9 + 1.3 * i)), text, height: textSize, justify: "centre" }));
  if (d.outputLength !== null) circles.push({ center: at(0, 0), radius: d.outputLength });
  return { outlines, lines: [], circles, filled: [], texts };
}

export type ComponentKind = "source" | "input" | "protector" | "output" | "consumer";

/** a component's size at a scale of 1, mm, as Vectorworks makes it */
export const COMPONENT_MM = 100;

export interface ComponentGlyph {
  /** the base, or the protector's box, filled grey */
  readonly base: Pt[];
  /** the drum, or the protector's cap, filled the component's colour */
  readonly top: Pt[];
}

/** points round a drum */
const DRUM_STEPS = 48;

/** An electrical component's glyph from above, centred on the origin, `sx` and `sy` its scale across and down, turned `angle` radians. */
export function componentGlyph(kind: ComponentKind, sx: number, sy: number, angle: number): ComponentGlyph {
  const turn = turner(angle);
  const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [turn(x0, y0), turn(x1, y0), turn(x1, y1), turn(x0, y1)];
  const half = COMPONENT_MM / 2;
  if (kind === "protector") {
    // a narrow box standing up, its cap across the top
    const bw = half * 0.34 * sx;
    const bd = half * 0.34 * sy;
    return { base: box(-bw, -bd, bw, bd), top: box(-bw * 0.7, -bd * 0.45, bw * 0.7, bd * 0.45) };
  }
  const drum = Array.from({ length: DRUM_STEPS }, (_, i) => {
    const g = (2 * Math.PI * i) / DRUM_STEPS;
    return turn(half * 0.8 * sx * Math.cos(g), half * 0.8 * sy * Math.sin(g));
  });
  return { base: box(-half * sx, -half * sy, half * sx, half * sy), top: drum };
}
