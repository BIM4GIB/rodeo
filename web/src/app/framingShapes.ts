// What Detailing's Framing Member tool (tools/framing.ts) draws in Top/Plan, as plain geometry in
// the drawing's coordinates: the member's outline between its clicks, run back by a rafter's bearing
// inset and on by its overhang, each end cut square or mitred, its centre line, and where its label
// goes. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";

/** the steepest miter offered, degrees either way from a square cut */
export const MAX_MITER = 80;

export interface FramingMember {
  /** across, mm */
  readonly width: number;
  /** each end's cut in plan, degrees from square: positive lengthens the member's left edge at that end */
  readonly startMiter: number;
  readonly endMiter: number;
  /** the member starts this far before its first click (a rafter's bearing inset), mm */
  readonly inset: number;
  /** and runs this far past its second (a rafter's overhang), mm */
  readonly overhang: number;
}

export interface FramingPlan {
  /** start left, start right, end right, end left */
  readonly outline: Pt[];
  /** along the member's middle, end to end */
  readonly centre: [Pt, Pt];
  /** the span clicked, mm */
  readonly span: number;
  /** a label's middle, above the member's middle as it reads, and its turn in degrees, read left to right */
  readonly label: { readonly at: Pt; readonly angle: number };
}

const at = (x: number, y: number): Pt => ({ x, y });

/**
 * A framing member clicked from `a` to `b`, its label `textSize` high: its outline, centre line and
 * label place, or why it can't be drawn.
 */
export function framingMember(a: Pt, b: Pt, m: FramingMember, textSize: number): FramingPlan | string {
  const span = dist(a, b);
  if (!(span > 0)) return "Click two points apart for the framing member.";
  if (!(m.width > 0)) return "Set a Width over 0.";
  if (Math.abs(m.startMiter) > MAX_MITER || Math.abs(m.endMiter) > MAX_MITER) return `Keep the miters within ${MAX_MITER}° of square.`;
  const u = at((b.x - a.x) / span, (b.y - a.y) / span);
  const n = at(-u.y, u.x);
  const s = at(a.x - u.x * m.inset, a.y - u.y * m.inset);
  const e = at(b.x + u.x * m.overhang, b.y + u.y * m.overhang);
  const length = span + m.inset + m.overhang;
  if (!(length > 0)) return "The bearing inset and overhang leave nothing of the framing member.";
  const half = m.width / 2;
  const ts = Math.tan((m.startMiter * Math.PI) / 180) * half;
  const te = Math.tan((m.endMiter * Math.PI) / 180) * half;
  // the left edge runs ts + te longer than the middle, the right edge as much shorter
  if (!(length - Math.abs(ts + te) > 0)) return "The miters cross: make the framing member longer or its miters smaller.";
  const p = (o: Pt, across: number, along: number): Pt => at(o.x + n.x * across + u.x * along, o.y + n.y * across + u.y * along);
  const outline = [p(s, half, -ts), p(s, -half, ts), p(e, -half, -te), p(e, half, te)];
  const mid = at((s.x + e.x) / 2, (s.y + e.y) / 2);
  let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  // above the member as its label reads
  const r = (angle * Math.PI) / 180;
  const off = half + textSize;
  const label = { at: at(mid.x - Math.sin(r) * off, mid.y + Math.cos(r) * off), angle };
  return { outline, centre: [s, e], span, label };
}
