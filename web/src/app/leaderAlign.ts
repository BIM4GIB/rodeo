// Modify > Align > Align/Distribute Leader Lines…, as plain geometry: where each leader's shoulder
// point and label point go. A leader runs from its target point (where it points) along its target
// line to its shoulder point, then level along its shoulder line to its label point. The topmost
// leader (highest shoulder point) is the one the others follow. Kept apart from the command so it
// runs without the page.

import type { Pt } from "../core/index.ts";

export interface Leader {
  readonly target: Pt;
  readonly shoulder: Pt;
  readonly label: Pt;
}

export type LeaderSpacing = "none" | "parallel" | "equal";

export interface LeaderAlign {
  /** the shoulder points onto the reference line, the shoulder lines kept */
  readonly shoulders: boolean;
  /** the label points onto the reference line, or with `shoulders` onto the topmost's */
  readonly labels: boolean;
  /** with `labels` alone: the shoulder points move with the label points */
  readonly moveShoulders: boolean;
  /** parallel: each target line turned parallel to the topmost's; equal: the shoulder lines as far apart as the top two */
  readonly spacing: LeaderSpacing;
}

const EPS = 1e-9;

/** True when the options need a reference line drawn. */
export const needsReference = (o: LeaderAlign): boolean => o.shoulders || o.labels;

/**
 * Each leader's new shoulder and label points, in the order given, or why it can't be done.
 * `ref` is the reference line the shoulder or label points go onto (needed when they do).
 */
export function alignLeaders(leaders: readonly Leader[], o: LeaderAlign, ref: readonly [Pt, Pt] | null): { shoulder: Pt; label: Pt }[] | string {
  if (leaders.length === 0) return "Select callouts or leader lines with a shoulder.";
  if (needsReference(o)) {
    if (!ref) return "Draw the reference line the points go onto.";
    if (Math.abs(ref[1].y - ref[0].y) <= EPS * Math.max(1, Math.abs(ref[1].x - ref[0].x))) return "The reference line must not be horizontal.";
  }
  const refX = (y: number): number => (ref ? ref[0].x + ((y - ref[0].y) * (ref[1].x - ref[0].x)) / (ref[1].y - ref[0].y) : 0);
  const order = leaders.map((_, i) => i).sort((a, b) => leaders[b].shoulder.y - leaders[a].shoulder.y);
  const top = leaders[order[0]];
  // the shoulder points' heights for equal spacing: the top two's gap, down from the top
  const ys = leaders.map((l) => l.shoulder.y);
  if (o.spacing === "equal" && order.length > 1) {
    const gap = top.shoulder.y - leaders[order[1]].shoulder.y;
    order.forEach((k, i) => (ys[k] = top.shoulder.y - i * gap));
  }
  const place = (l: Leader, y: number, dir: Pt | null): { shoulder: Pt; label: Pt } => {
    const rise = l.label.y - l.shoulder.y;
    const length = l.label.x - l.shoulder.x;
    let s: Pt = { x: l.shoulder.x, y };
    // dir: the target line through this target, parallel to the topmost's (not upright)
    const onTarget = (x: number): number => (dir ? l.target.y + ((x - l.target.x) * dir.y) / dir.x : y);
    // where that target line meets the reference line, a shoulder line's `length` and `rise` short of it
    const meet = (length: number, rise: number): number => {
      const [a, b] = ref!;
      const dxdy = (b.x - a.x) / (b.y - a.y);
      const slope = dir!.y / dir!.x;
      const den = 1 - dxdy * slope;
      return Math.abs(den) > EPS ? (a.x + dxdy * (l.target.y - slope * l.target.x + rise - a.y) - length) / den : s.x;
    };
    if (o.shoulders) {
      const x = dir ? meet(0, 0) : refX(s.y);
      s = { x, y: onTarget(x) };
    } else if (o.labels && o.moveShoulders) {
      const x = dir ? meet(length, rise) : refX(s.y + rise) - length;
      s = { x, y: onTarget(x) };
    } else if (dir) s = { x: s.x, y: onTarget(s.x) };
    const label = o.labels && !o.shoulders && !o.moveShoulders ? { x: refX(s.y + rise), y: s.y + rise } : { x: s.x + length, y: s.y + rise };
    return { shoulder: s, label };
  };
  const first = place(top, ys[order[0]], null);
  // the topmost's target line as it now runs, which parallel spacing turns the others' to
  const d = { x: first.shoulder.x - top.target.x, y: first.shoulder.y - top.target.y };
  const dir = o.spacing === "parallel" && Math.abs(d.x) > EPS ? d : null;
  const out = leaders.map((l, k) => (k === order[0] ? first : place(l, ys[k], dir)));
  // with both, every label point lines up under the topmost's
  if (o.shoulders && o.labels) {
    const x = out[order[0]].label.x;
    for (const p of out) p.label = { x, y: p.label.y };
  }
  return out;
}
