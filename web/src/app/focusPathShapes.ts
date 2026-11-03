// Where Focus Lighting Devices Along Path lands each beam: at the path's closest point to the device, or
// spaced evenly along it, with a beam at each end (Evenly Between) or half a space in from them (Evenly
// Inside). On a closed path Evenly Between puts a beam on the first vertex and Evenly Inside one to either
// side of it, at the same spacing. Devices take their spots in the order they lie along the path, so the
// beams don't cross. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";

export type FocusDistribution = "closest" | "between" | "inside";

const segments = (path: readonly Pt[], closed: boolean): [Pt, Pt][] => {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < path.length; i++) out.push([path[i], path[i + 1]]);
  const last = path.at(-1);
  if (closed && path.length > 2 && last && Math.hypot(last.x - path[0].x, last.y - path[0].y) > 1e-9) out.push([last, path[0]]);
  return out;
};

const size = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/** The path's length. */
export function pathLength(path: readonly Pt[], closed: boolean): number {
  return segments(path, closed).reduce((sum, [a, b]) => sum + size(a, b), 0);
}

/** The point `s` along the path from its start. */
export function pointAlong(path: readonly Pt[], closed: boolean, s: number): Pt {
  let left = s;
  const segs = segments(path, closed);
  for (const [a, b] of segs) {
    const d = size(a, b);
    if (left <= d && d > 0) return { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d };
    left -= d;
  }
  return segs.at(-1)?.[1] ?? path[0];
}

/** The path's closest point to `p`, and how far along it that is. */
export function closestOnPath(p: Pt, path: readonly Pt[], closed: boolean): { at: Pt; along: number } {
  let best = { at: path[0], along: 0 };
  let bestD = Infinity;
  let walked = 0;
  for (const [a, b] of segments(path, closed)) {
    const d = size(a, b);
    const t = d > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (d * d))) : 0;
    const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const away = size(p, at);
    if (away < bestD) {
      bestD = away;
      best = { at, along: walked + d * t };
    }
    walked += d;
  }
  return best;
}

/** Where each device's beam lands, in the devices' order; empty for a path with no length unless it's by closest point. */
export function focusTargets(devices: readonly Pt[], path: readonly Pt[], closed: boolean, mode: FocusDistribution): Pt[] {
  if (path.length === 0) return [];
  if (mode === "closest") return devices.map((d) => closestOnPath(d, path, closed).at);
  const length = pathLength(path, closed);
  const n = devices.length;
  if (!(length > 0)) return devices.map(() => path[0]);
  const spot = (i: number): number => {
    if (mode === "inside") return ((i + 0.5) * length) / n;
    if (closed) return (i * length) / n;
    return n === 1 ? length / 2 : (i * length) / (n - 1);
  };
  const order = devices.map((d, i) => ({ i, along: closestOnPath(d, path, closed).along, x: d.x, y: d.y })).sort((a, b) => a.along - b.along || a.x - b.x || a.y - b.y);
  const out: Pt[] = new Array<Pt>(n);
  order.forEach((d, rank) => {
    out[d.i] = pointAlong(path, closed, spot(rank));
  });
  return out;
}
