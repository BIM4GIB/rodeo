// The sums behind ConnectCAD's Create Riser Sheet and Create Cabling Sheet (cableSheets.ts): where a
// cable path's tag goes, with the leader to it; and how the cables between two places are drawn on a
// cabling sheet, as an arc between them or as home runs (a short arrow from each end toward the
// other, tagged with where it goes), the nearest pairs as arcs as far as the slider says. Kept apart
// so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { along, pathLength } from "./ccadShapes.ts";

const EPS = 1e-6;
const at = (p: Pt, d: Pt, k: number): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });

/** Writing placed about `at`, aligned as text's hAlign (1 left, 2 centre, 3 right) and vAlign (1 top, 3 centre, 5 bottom). */
export interface Note {
  readonly at: Pt;
  readonly text: string;
  readonly hAlign: number;
  readonly vAlign: number;
}

/** Writing `gap` out from `p` along `d`, aligned to stand clear of it on that side. */
function noteOut(p: Pt, d: Pt, gap: number, text: string): Note {
  return { at: at(p, d, gap), text, hAlign: d.x > 0.3 ? 1 : d.x < -0.3 ? 3 : 2, vAlign: d.y > 0.3 ? 5 : d.y < -0.3 ? 1 : 3 };
}

/**
 * A cable path's tag: a leader from the middle of its plan, up at 45° and then level, to writing
 * beside it; it leans the way that crosses the path most squarely. `size` is the leader's rise.
 */
export function pathTag(points: readonly Pt[], text: string, size: number): { leader: Pt[]; note: Note } {
  const plan = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > EPS);
  const { at: mid, dir } = along(plan, pathLength(plan) / 2);
  // up and right, unless the path runs that way too
  const side = Math.abs(dir.x + dir.y) > Math.abs(dir.y - dir.x) ? -1 : 1;
  const knee = { x: mid.x + side * size, y: mid.y + size };
  const end = { x: knee.x + (side * size) / 2, y: knee.y };
  return { leader: [mid, knee, end], note: noteOut(end, { x: side, y: 0 }, size / 4, text) };
}

/** One circuit's cable, between the places its ends join the cable paths (named as Edit Cabling names them), whether each is on the sheet, of a kind ("SDI"). */
export interface CableRun {
  readonly ends: readonly [string, string];
  readonly at: readonly [Pt, Pt];
  readonly shown: readonly [boolean, boolean];
  readonly kind: string;
}

/** The cables between two places: how many of each kind, and how far apart the places are. */
export interface EndPair {
  readonly ends: readonly [string, string];
  readonly at: readonly [Pt, Pt];
  readonly shown: readonly [boolean, boolean];
  readonly counts: ReadonlyMap<string, number>;
  readonly span: number;
}

/** Cables gathered by the two places they run between (either way round), nearest first. */
export function endPairs(runs: readonly CableRun[]): EndPair[] {
  const pairs = new Map<string, { ends: [string, string]; at: [Pt, Pt]; shown: [boolean, boolean]; counts: Map<string, number> }>();
  for (const r of runs) {
    const swap = r.ends[1] < r.ends[0];
    const ends: [string, string] = swap ? [r.ends[1], r.ends[0]] : [r.ends[0], r.ends[1]];
    const key = JSON.stringify(ends);
    let p = pairs.get(key);
    if (!p) pairs.set(key, (p = { ends, at: swap ? [r.at[1], r.at[0]] : [r.at[0], r.at[1]], shown: swap ? [r.shown[1], r.shown[0]] : [r.shown[0], r.shown[1]], counts: new Map() }));
    p.counts.set(r.kind, (p.counts.get(r.kind) ?? 0) + 1);
  }
  return [...pairs.values()]
    .map((p) => ({ ...p, span: Math.hypot(p.at[1].x - p.at[0].x, p.at[1].y - p.at[0].y) }))
    .sort((a, b) => a.span - b.span || a.ends[0].localeCompare(b.ends[0]) || a.ends[1].localeCompare(b.ends[1]));
}

/** "3 × SDI, 1 × HDMI": the most first. */
export const cableNote = (counts: ReadonlyMap<string, number>): string =>
  [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, n]) => `${n} × ${kind || "Cable"}`)
    .join(", ");

export type CablingMark =
  | { readonly kind: "arc"; readonly pair: EndPair; readonly line: Pt[]; readonly note: Note }
  | { readonly kind: "home"; readonly pair: EndPair; readonly from: string; readonly line: [Pt, Pt]; readonly head: Pt[]; readonly note: Note };

/** where a home run starts, for its arm */
const START = 0.4;
/** how high an arc bows, for its chord */
export const BOW = 0.2;
const ARC_POINTS = 17;

/**
 * The marks a cabling sheet draws: of the pairs with both places on the sheet, the nearest
 * `arcs` percent as arcs, the rest as home runs from each end; a pair with one place shown, a home
 * run from it. `arm` is how far a home run's tip stands from its place (it starts a little out, clear
 * of the place's name); the arrowhead and the gap to the writing scale with it.
 */
export function cablingMarks(pairs: readonly EndPair[], arcs: number, arm: number): CablingMark[] {
  const marks: CablingMark[] = [];
  const both = pairs.filter((p) => p.span > EPS && p.shown[0] && p.shown[1]);
  const arced = new Set(both.slice(0, Math.round((both.length * Math.min(100, Math.max(0, arcs))) / 100)));
  for (const pair of pairs) {
    if (pair.span <= EPS) continue;
    const [a, b] = pair.at;
    const note = cableNote(pair.counts);
    if (arced.has(pair)) {
      // a bow to the left of the way from the place further left (or lower) to the other
      const [p, q] = a.x < b.x - EPS || (Math.abs(a.x - b.x) <= EPS && a.y < b.y) ? [a, b] : [b, a];
      const d = { x: (q.x - p.x) / pair.span, y: (q.y - p.y) / pair.span };
      const n = { x: -d.y, y: d.x };
      const c = at({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, n, 2 * BOW * pair.span);
      const line = Array.from({ length: ARC_POINTS }, (_, i) => {
        const t = i / (ARC_POINTS - 1);
        const u = 1 - t;
        return { x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y };
      });
      marks.push({ kind: "arc", pair, line, note: noteOut(line[(ARC_POINTS - 1) / 2], n, arm / 4, note) });
      continue;
    }
    for (const k of [0, 1] as const) {
      const from = pair.at[k];
      const to = pair.at[1 - k];
      if (!pair.shown[k]) continue;
      const d = { x: (to.x - from.x) / pair.span, y: (to.y - from.y) / pair.span };
      const n = { x: -d.y, y: d.x };
      const tip = at(from, d, arm);
      const head = arm / 4;
      const back = at(tip, d, -head);
      marks.push({
        kind: "home",
        pair,
        from: pair.ends[k],
        line: [at(from, d, START * arm), tip],
        head: [tip, at(back, n, head / 2.5), at(back, n, -head / 2.5)],
        note: noteOut(tip, d, arm / 8, `To ${pair.ends[1 - k]}: ${note}`),
      });
    }
  }
  return marks;
}
