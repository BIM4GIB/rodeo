// What Spotlight's Lighting Device tool (tools/lightingDevice.ts) draws in Top/Plan, as plain
// geometry on the device's hanging point, aimed where it points: a generic outline for each
// instrument type (Vectorworks draws a library symbol here), and its label legend: the channel in
// a circle in front of it, the unit number on its body, its colour behind it and its purpose beside
// it. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { layoutLegend, type LegendItem } from "./labelLegend.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";

export type Instrument = "ellipsoidal" | "fresnel" | "par" | "moving" | "wash";

/** Each instrument type's outline at full size, mm, its front along +x from its hanging point before it's aimed. */
interface Glyph {
  readonly outlines: readonly (readonly [number, number, number, number])[];
  readonly circles: readonly (readonly [number, number, number])[];
  /** its front, back and half its width, for the legend */
  readonly front: number;
  readonly back: number;
  readonly half: number;
}

const GLYPHS: Readonly<Record<Instrument, Glyph>> = {
  // a lamp housing behind a narrower barrel, its gel frame across the front
  ellipsoidal: { outlines: [[-300, -130, -60, 130], [-60, -85, 300, 85], [300, -110, 330, 110]], circles: [], front: 330, back: -300, half: 130 },
  // a box housing, its lens frame across the front
  fresnel: { outlines: [[-180, -150, 140, 150], [140, -140, 170, 140]], circles: [], front: 170, back: -180, half: 150 },
  // a can, its front ring a little wider
  par: { outlines: [[-200, -120, 180, 120], [180, -135, 210, 135]], circles: [], front: 210, back: -200, half: 135 },
  // the yoke's round base under the head, its lens at the head's front
  moving: { outlines: [[-140, -130, 230, 130]], circles: [[0, 0, 210], [150, 0, 70]], front: 230, back: -210, half: 210 },
  // a flat panel, three emitters along its face
  wash: { outlines: [[-140, -180, 140, 180]], circles: [[95, -110, 40], [95, 0, 40], [95, 110, 40]], front: 140, back: -140, half: 180 },
};

export interface DeviceLabels {
  readonly channel: string;
  readonly unit: string;
  readonly color: string;
  readonly purpose: string;
  /** the accessories to draw on it, by name */
  readonly accessories?: readonly string[];
}

/** A generic accessory: the part it goes on, and its size at full size, mm. Vectorworks has a symbol for each. */
export interface Accessory {
  readonly name: string;
  readonly part: "lens" | "body" | "yoke" | "base";
  readonly weightKg: number;
  /** along the beam, or a yoke one's radius */
  readonly depth: number;
  /** its width as a share of the device's, or a base one's half width in mm */
  readonly width: number;
  /** what the width opens out to at its front */
  readonly flare?: number;
}

export const ACCESSORIES: readonly Accessory[] = [
  { name: "Barn Doors", part: "lens", weightKg: 1.4, depth: 170, width: 1, flare: 1.5 },
  { name: "Top Hat", part: "lens", weightKg: 0.5, depth: 170, width: 0.75 },
  { name: "Half Hat", part: "lens", weightKg: 0.3, depth: 110, width: 0.75 },
  { name: "Gel Frame", part: "lens", weightKg: 0.2, depth: 15, width: 1 },
  { name: "Donut", part: "lens", weightKg: 0.1, depth: 15, width: 1 },
  { name: "Color Scroller", part: "lens", weightKg: 3.5, depth: 120, width: 1.25 },
  { name: "Iris", part: "body", weightKg: 0.5, depth: 30, width: 1.1 },
  { name: "Gobo Holder", part: "body", weightKg: 0.2, depth: 20, width: 1.1 },
  { name: "Gobo Rotator", part: "body", weightKg: 1.2, depth: 60, width: 1.2 },
  { name: "Safety Cable", part: "yoke", weightKg: 0.2, depth: 40, width: 0 },
  { name: "C-Clamp", part: "base", weightKg: 1, depth: 100, width: 60 },
  { name: "Side Arm", part: "base", weightKg: 2, depth: 250, width: 40 },
];

/** The names in an Accessory field. */
export function accessoryNames(value: string): string[] {
  return value.split(/[,\n]/).map((n) => n.trim()).filter(Boolean);
}

export const withAccessory = (value: string, name: string): string => [...accessoryNames(value), name].join(", ");

/** The field without `name`: its last one, if it's there more than once. */
export function withoutAccessory(value: string, name: string): string {
  const names = accessoryNames(value);
  const k = names.lastIndexOf(name);
  return (k < 0 ? names : [...names.slice(0, k), ...names.slice(k + 1)]).join(", ");
}

/** What an accessory weighs, kg; 0 for one that isn't in the list. */
export const accessoryWeight = (name: string): number => ACCESSORIES.find((a) => a.name === name)?.weightKg ?? 0;

const at = (x: number, y: number): Pt => ({ x, y });

/** How far a body drawn by something else (a symbol) reaches along the aim, in front and behind, and across it each side. */
export interface DeviceBody {
  readonly front: number;
  readonly back: number;
  readonly half: number;
}

/**
 * The reach of a symbol whose plan drawing fills `box` (its front toward -y, as a device aimed down
 * the page is drawn), `factor` times its size: what a device showing it lays its labels round.
 */
export const symbolBody = (box: { x0: number; y0: number; x1: number; y1: number }, factor: number): DeviceBody => ({ front: -box.y0 * factor, back: -box.y1 * factor, half: Math.max(Math.abs(box.x0), Math.abs(box.x1)) * factor });

/**
 * A lighting device of `type` on the origin, aimed `aim` radians: its outline `factor` times full
 * size, its legend's labels `textSize` high (blank ones left out), level on the page and set out
 * from the side of the device they label. With `body` the device is drawn by something else (a
 * symbol), so only the labels are, round that body, and accessories aren't drawn. With `legend` its
 * labels are a label legend's (labelLegend.ts) in place of Rodeo's own four.
 */
export function lightingDevice(type: Instrument, factor: number, labels: DeviceLabels, textSize: number, aim: number, body?: DeviceBody, legend?: { readonly items: readonly LegendItem[]; readonly nonRotating: boolean }): MarkerDrawing {
  const g = GLYPHS[type];
  const k = factor;
  const c = Math.cos(aim);
  const s = Math.sin(aim);
  const turn = (x: number, y: number): Pt => at(x * c - y * s, x * s + y * c);
  const outlines = body ? [] : g.outlines.map(([x0, y0, x1, y1]) => [turn(x0 * k, y0 * k), turn(x1 * k, y0 * k), turn(x1 * k, y1 * k), turn(x0 * k, y1 * k)]);
  const circles = body ? [] : g.circles.map(([x, y, r]) => ({ center: turn(x * k, y * k), radius: r * k }));
  const texts: MarkerText[] = [];
  // the accessories: on the lens one in front of another, on the body a third of the way back
  let nose = g.front;
  for (const a of body ? [] : (labels.accessories ?? []).flatMap((n) => ACCESSORIES.find((x) => x.name === n) ?? [])) {
    const box = (x0: number, x1: number, h0: number, h1: number): Pt[] => [turn(x0 * k, -h0 * k), turn(x1 * k, -h1 * k), turn(x1 * k, h1 * k), turn(x0 * k, h0 * k), turn(x0 * k, -h0 * k)];
    const middle = g.front - (g.front - g.back) / 3;
    if (a.part === "lens") {
      outlines.push(box(nose, nose + a.depth, g.half * a.width, g.half * (a.flare ?? a.width)));
      nose += a.depth;
    } else if (a.part === "body") outlines.push(box(middle - a.depth / 2, middle + a.depth / 2, g.half * a.width, g.half * a.width));
    else if (a.part === "yoke") circles.push({ center: at(0, 0), radius: a.depth * k });
    else outlines.push(box(-a.depth / 2, a.depth / 2, a.width, a.width));
  }
  const front = body ? body.front : nose * k;
  const back = body ? body.back : g.back * k;
  const half = body ? body.half : g.half * k;
  const mid = (front + back) / 2;
  if (legend) {
    const laid = layoutLegend(legend.items, { front, back, half }, aim, legend.nonRotating);
    return { outlines: [...outlines, ...laid.outlines], lines: [], circles, filled: [], texts: laid.texts };
  }
  if (labels.channel.trim()) {
    // the channel in a circle just in front of the lens
    const r = textSize * 0.9;
    const centre = turn(front + textSize * 0.4 + r, 0);
    circles.push({ center: centre, radius: r });
    texts.push({ at: centre, text: labels.channel.trim(), height: textSize * 0.8, justify: "centre" });
  }
  if (labels.unit.trim()) texts.push({ at: turn(mid, 0), text: labels.unit.trim(), height: textSize * 0.8, justify: "centre" });
  // a label off a side runs away from it: left or right of a side facing across the page, centred
  // a little further off one facing up or down it
  const off = (x: number, y: number, dx: number, dy: number, text: string): void => {
    const d = turn(dx, dy);
    const across = Math.abs(d.x) > 0.38;
    const gap = textSize * (across ? 0.4 : 0.9);
    const p = turn(x + dx * gap, y + dy * gap);
    texts.push({ at: p, text, height: textSize, justify: !across ? "centre" : d.x > 0 ? "left" : "right" });
  };
  if (labels.color.trim()) off(back, 0, -1, 0, labels.color.trim());
  if (labels.purpose.trim()) off(mid, half, 0, 1, labels.purpose.trim());
  return { outlines, lines: [], circles, filled: [], texts };
}

/** `value` with its last number counted on by `by` (keeping its width); unchanged without one. */
export function countOn(value: string, by: number): string {
  const m = /^(.*?)(\d+)(\D*)$/.exec(value);
  if (!m) return value;
  const n = Math.max(0, Number(m[2]) + by);
  return m[1] + String(n).padStart(m[2].length, "0") + m[3];
}
