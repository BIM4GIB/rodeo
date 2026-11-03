// What the Stake tool draws in plan (tools/paths.ts), as plain geometry: the stake's indicator in
// one of Vectorworks' eight styles, and its label beside it in one of six bubbles, with a leader
// line to the indicator once the label is moved off it. Kept apart from the tool so it runs
// without the page.

import type { Pt } from "../core/index.ts";
import { CHAR_WIDTH, type MarkerDrawing, type MarkerText } from "./markerShapes.ts";
import { LINE_PITCH, roundCorners } from "./noteShapes.ts";

export type StakeStyle = "none" | "triangle" | "filledTriangle" | "circle" | "dot" | "cross" | "circleCross" | "tick";
export type StakeBubble = "none" | "box" | "roundRect" | "cloud" | "hexagonal" | "circle";
export type StakeLabelPosition = "auto" | "right" | "left" | "center";

export interface StakeLook {
  readonly style: StakeStyle;
  readonly bubble: StakeBubble;
  /** the indicator's size across, in drawing units */
  readonly markSize: number;
  /** the indicator's centre from the stake's point */
  readonly markOffset: Pt;
  /** the indicator's turn, radians */
  readonly markRotation: number;
  readonly textHeight: number;
  /** between the bubble and the text */
  readonly margin: number;
  /** a Round Rect bubble's corners */
  readonly cornerRadius: number;
  readonly position: StakeLabelPosition;
  readonly leader: boolean;
}

export interface StakeDrawing extends MarkerDrawing {
  /** a Cloud bubble's outline, for the tool to draw as a cloud */
  readonly cloud: Pt[] | null;
}

/** points round a dot or a Circle bubble */
const ROUND_STEPS = 32;
/** a Circle Cross's circle against the cross's reach */
const CIRCLE_CROSS_SHARE = 0.7;

const turn = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const move = (pts: readonly Pt[], by: Pt): Pt[] => pts.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));

function roundOutline(c: Pt, r: number): Pt[] {
  return Array.from({ length: ROUND_STEPS }, (_, k) => {
    const t = (2 * Math.PI * k) / ROUND_STEPS;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

/**
 * A stake at `at`, its label's `lines` beside it: by default just right of the indicator, else
 * with its control point at `labelAt` (the bubble's near side for Right and Left, its middle for
 * Center; Auto takes Right when the point is right of the indicator, else Left), and a leader line
 * from there to the indicator when the label lies off it.
 */
export function stake(at: Pt, labelAt: Pt | null, lines: readonly string[], look: StakeLook): StakeDrawing {
  const d: { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[] } = { outlines: [], lines: [], circles: [], filled: [], texts: [] };
  const mark = { x: at.x + look.markOffset.x, y: at.y + look.markOffset.y };
  const r = look.markSize / 2;
  const placed = (pts: readonly Pt[]): Pt[] => move(pts.map((p) => turn(p, look.markRotation)), mark);
  const cross = (reach: number): void => {
    d.lines.push(placed([{ x: -reach, y: 0 }, { x: reach, y: 0 }]), placed([{ x: 0, y: -reach }, { x: 0, y: reach }]));
  };
  if (look.style === "triangle" || look.style === "filledTriangle") {
    const tri = placed([90, 210, 330].map((deg) => ({ x: r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) })));
    (look.style === "triangle" ? d.outlines : d.filled).push(tri);
  } else if (look.style === "circle") d.circles.push({ center: mark, radius: r });
  else if (look.style === "dot") d.filled.push(roundOutline(mark, r));
  else if (look.style === "cross") cross(r);
  else if (look.style === "circleCross") {
    d.circles.push({ center: mark, radius: r * CIRCLE_CROSS_SHARE });
    cross(r);
  } else if (look.style === "tick") d.lines.push(placed([{ x: -r, y: 0 }, { x: r, y: 0 }]));

  if (lines.length === 0) return { ...d, cloud: null };
  // the text block and its bubble, centred on the origin first
  const h = look.textHeight;
  const pitch = h * LINE_PITCH;
  const hw = (Math.max(...lines.map((l) => l.length)) * CHAR_WIDTH * h) / 2;
  const hh = (h + (lines.length - 1) * pitch) / 2;
  const m = look.bubble === "none" ? 0 : look.margin;
  const bx = hw + m;
  const by = hh + m;
  const box = [{ x: -bx, y: -by }, { x: bx, y: -by }, { x: bx, y: by }, { x: -bx, y: by }];
  let outline: Pt[] | null = null;
  let reach = bx;
  if (look.bubble === "box" || look.bubble === "cloud") outline = box;
  else if (look.bubble === "roundRect") outline = roundCorners(box, Math.min(look.cornerRadius, bx, by));
  else if (look.bubble === "hexagonal") {
    reach = bx + by;
    outline = [{ x: -reach, y: 0 }, { x: -bx, y: by }, { x: bx, y: by }, { x: reach, y: 0 }, { x: bx, y: -by }, { x: -bx, y: -by }];
  } else if (look.bubble === "circle") {
    reach = Math.hypot(hw, hh) + look.margin;
    outline = roundOutline({ x: 0, y: 0 }, reach);
  }

  const point = labelAt ?? { x: mark.x + look.markSize, y: mark.y };
  const side = look.position === "auto" ? (point.x >= mark.x ? "right" : "left") : look.position;
  const centre = { x: side === "right" ? point.x + reach : side === "left" ? point.x - reach : point.x, y: point.y };
  const bubble = outline ? move(outline, centre) : null;
  if (bubble && look.bubble !== "cloud") d.outlines.push(bubble);
  const justify = side === "right" ? "left" : side === "left" ? "right" : "centre";
  const tx = side === "right" ? centre.x - hw : side === "left" ? centre.x + hw : centre.x;
  lines.forEach((text, i) => d.texts.push({ at: { x: tx, y: centre.y + hh - h / 2 - i * pitch }, text, height: h, justify }));

  // a leader once the label lies off the indicator, from the control point (a centred label's
  // bubble edge) to the indicator's edge
  const off = Math.hypot(point.x - mark.x, point.y - mark.y);
  if (look.leader && labelAt && off > 1.5 * look.markSize) {
    const u = { x: (mark.x - point.x) / off, y: (mark.y - point.y) / off };
    const edge = side !== "center" ? 0 : look.bubble === "circle" ? reach : Math.min(Math.abs(u.x) > 1e-9 ? bx / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? by / Math.abs(u.y) : Infinity);
    if (off - r > edge) d.lines.push([{ x: point.x + u.x * edge, y: point.y + u.y * edge }, { x: mark.x - u.x * r, y: mark.y - u.y * r }]);
  }
  return { ...d, cloud: bubble && look.bubble === "cloud" ? bubble : null };
}
