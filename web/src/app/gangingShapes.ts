// What Spotlight's Ganging tool draws (tools/ganging.ts), as plain geometry: a two-fer joining two or
// more lighting devices on one circuit, dimmer or channel. A line runs from each device straight
// across (up or down the screen) to the label's height, and one line along there joins them, its
// outer corners square, rounded or curved; the label sits on it, in a circle when it has a container.
// Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { CHAR_WIDTH, type MarkerDrawing } from "./markerShapes.ts";

export type GangCorner = "square" | "arc" | "bezier";
/** what the devices share: the label shows one value, or for Circuit and Dimmer and Channel two, comma-separated */
export type GangBy = "channel" | "dimmer" | "circuit" | "dimmerChannel";

export interface Gang {
  readonly corner: GangCorner;
  readonly by: GangBy;
  readonly value: string;
  readonly showLabel: boolean;
  readonly container: boolean;
  /** the label's text height, in the drawing */
  readonly textHeight: number;
  /** a rounded or curved corner's size, in the drawing (smaller where the lines are shorter) */
  readonly cornerSize: number;
}

/** points along a rounded or curved corner */
const CORNER_STEPS = 8;
/** a container's radius against its text's height, at least */
const CONTAINER_SHARE = 0.9;
const EPS = 1e-9;

/** The label's values: two for Circuit (name and number) and Dimmer and Channel, else one. */
export function gangValues(g: Gang): string[] {
  const parts = g.value.split(",").map((v) => v.trim());
  return g.by === "circuit" || g.by === "dimmerChannel" ? parts.slice(0, 2).filter((v) => v !== "") : [g.value.trim()].filter((v) => v !== "");
}

/** How far the label reaches either side of its point, along the joining line. */
function labelReach(text: string, g: Gang): number {
  const half = (text.length * CHAR_WIDTH * g.textHeight) / 2;
  return g.container ? Math.max(g.textHeight * CONTAINER_SHARE, half + g.textHeight * 0.4) : half + g.textHeight * 0.4;
}

/**
 * The two-fer joining `devices` (where each was clicked) with its label at `label`, or why it
 * can't be drawn.
 */
export function twoFer(devices: readonly Pt[], label: Pt, g: Gang): MarkerDrawing | string {
  if (devices.length < 2) return "Click at least two lighting devices to gang.";
  const values = g.showLabel ? gangValues(g) : [];
  if (g.showLabel && values.length === 0) return "Give the two-fer a Field Value, or turn off Show Label.";
  if (g.showLabel && !(g.textHeight > 0)) return "Set the label's text height more than 0.";
  const y = label.y;
  const out: MarkerDrawing = { outlines: [], lines: [], circles: [], filled: [], texts: [] };
  const reach = values.length ? labelReach(values[0], g) : 0;
  // the stretch of the joining line the label takes
  const gap = values.length ? { x0: label.x - reach, x1: label.x + reach } : null;

  const xs = devices.map((d) => d.x);
  const left = devices[xs.indexOf(Math.min(...xs))];
  const right = devices[xs.indexOf(Math.max(...xs))];
  // an outer device turns a corner into the joining line, unless the line runs on past it to the label
  const turnsLeft = !(gap && gap.x1 < left.x);
  const turnsRight = !(gap && gap.x0 > right.x) && right !== left;
  const room = (right.x - left.x) / 2;

  /** a device's line into the joining line, turning `inward` (+1 right, −1 left) along it */
  const corner = (d: Pt, inward: number): Pt[] => {
    const down = Math.sign(y - d.y);
    const c = { x: d.x, y };
    const r = Math.min(g.cornerSize, Math.abs(y - d.y), room);
    if (g.corner === "square" || r <= EPS || down === 0) return Math.abs(y - d.y) > EPS ? [d, c] : [c];
    const from = { x: d.x, y: y - down * r };
    const to = { x: d.x + inward * r, y };
    const pts: Pt[] = [d];
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const t = i / CORNER_STEPS;
      if (g.corner === "arc") {
        // a quarter circle about (to.x, from.y)
        const a = (t * Math.PI) / 2;
        pts.push({ x: d.x + inward * r * (1 - Math.cos(a)), y: from.y + down * r * Math.sin(a) });
      } else {
        // a quadratic curve with the corner as its control point
        const u = 1 - t;
        pts.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y });
      }
    }
    return pts;
  };

  const into = turnsLeft ? corner(left, 1) : null;
  const outOf = turnsRight ? corner(right, -1).reverse() : null;
  // the joining line from where it starts to where it ends, less the label's stretch
  const a = into ? into.at(-1)!.x : gap!.x1;
  const b = outOf ? outOf[0].x : gap!.x0;
  const pieces: [number, number][] = gap && gap.x0 < b && gap.x1 > a ? [[a, gap.x0], [gap.x1, b]] : [[a, b]];
  const [first, last] = [pieces[0], pieces[pieces.length - 1]];
  const level = ([p, q]: [number, number]): Pt[] => (q - p > EPS ? [{ x: p, y }, { x: q, y }] : []);
  if (pieces.length === 2) {
    // the device's run joins the piece it starts or ends
    out.lines.push(into ? [...into, ...level(first).slice(1)] : level(first));
    out.lines.push(outOf ? [...level(last).slice(0, -1), ...outOf] : level(last));
  } else {
    out.lines.push([...(into ?? []), ...level(first).slice(into ? 1 : 0, outOf ? -1 : undefined), ...(outOf ?? [])]);
  }
  out.lines.splice(0, out.lines.length, ...out.lines.filter((l) => l.length >= 2));

  // the other devices: straight to the joining line, stopping at the label
  for (const d of devices) {
    if ((d === left && turnsLeft) || (d === right && turnsRight)) continue;
    let end = y;
    if (gap && d.x > gap.x0 && d.x < gap.x1) {
      const dx = d.x - label.x;
      const rise = g.container ? Math.sqrt(Math.max(0, reach * reach - dx * dx)) : g.textHeight * 0.7;
      end = d.y > y ? y + rise : y - rise;
    }
    if (Math.abs(end - d.y) > EPS) out.lines.push([d, { x: d.x, y: end }]);
  }

  // the label, a second value below the first
  values.forEach((text, i) => {
    const r = labelReach(text, g);
    const at = { x: label.x, y: y - i * 2.4 * Math.max(reach, r) };
    if (g.container) out.circles.push({ center: at, radius: r });
    out.texts.push({ at, text, height: g.textHeight, justify: "centre" });
  });
  return out;
}
