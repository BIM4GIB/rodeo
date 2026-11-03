// What Detailing's Linear Material tool (tools/linearMaterial.ts) draws: sheet material along a
// clicked path, as plain geometry in the drawing's coordinates. The material lies on the path's
// left (above a path drawn left to right), from its baseline (the path moved by the Offset) out to
// its thickness. Kept apart from the tool so it runs without the page.
//
// Board: its two edges with the space between filled. Gyp. Bd. (detail): a board with a line for
// the facing near its face, stippled. Plaster/Stucco: a rough face (detail: stippled). Plywood/OSB:
// a board split into four plies (detail: slashes across it in threes). Built-up Roof: a solid band
// under coarse gravel. Corrugated Deck: its profile, pans down from the top flats (w/fill: the
// topping filled down into the pans to a face the thickness above the flats; detail: stippled).

import type { Pt } from "../core/index.ts";
import { pathLength, pointAlong } from "./cableShapes.ts";
import { offsetPolyline } from "./geom.ts";

export type LinearType = "board" | "gyp" | "stucco" | "stuccoDetail" | "plywood" | "plywoodDetail" | "roof" | "deck" | "deckFill" | "deckFillDetail";
export type Closure = "none" | "start" | "end" | "both";

/** most stipple dots and gravel stones one material places */
export const MAX_DOTS = 4000;
/** plies a plywood board is drawn in */
const PLIES = 4;
/** a corrugated deck's top flat, web and pan as shares of its pitch: flat, web, pan, web */
const DECK = [0.4, 0.1, 0.4, 0.1];

const at = (x: number, y: number): Pt => ({ x, y });

export interface LinearMaterial {
  readonly type: LinearType;
  /** the baseline's distance to the path's left, mm (negative: its right) */
  readonly offset: number;
  readonly thickness: number;
  /** a corrugated deck's spacing and depth */
  readonly pitch: number;
  readonly depth: number;
  readonly closure: Closure;
  /** stipple dots per square unit of the drawing */
  readonly density: number;
}

export interface LinearDrawing {
  /** filled in the drawing's fill, unstroked */
  readonly fills: Pt[][];
  /** filled solid in the pen's colour */
  readonly solid: Pt[][];
  /** stones: outlined and filled white */
  readonly stones: Pt[][];
  readonly lines: Pt[][];
  readonly dots: Pt[];
}

/** A seeded pseudo-random sequence (mulberry32): the same path gives the same roughness and dots. */
function seeded(path: readonly Pt[]): () => number {
  let seed = (Math.round(path.reduce((s, p, i) => s + p.x * (7 + i) + p.y * (13 + i), 0)) | 0) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ring = (pts: readonly Pt[], closed: boolean): Pt[] => (closed ? [...pts, pts[0]] : [...pts]);

/**
 * The material along `path` (closed when it goes round), or a message when the material can't be
 * drawn there.
 */
export function linearMaterial(path: readonly Pt[], closed: boolean, m: LinearMaterial): LinearDrawing | string {
  if (path.length < 2 || !(pathLength(ring(path, closed)) > 0)) return "Click points apart for the material.";
  if (!(m.thickness > 0) && m.type !== "deck") return "Set a Thickness over 0.";
  const deck = m.type === "deck" || m.type === "deckFill" || m.type === "deckFillDetail";
  if (deck && (!(m.pitch > 0) || !(m.depth > 0))) return "Set a Pitch and Corrugation Depth over 0.";
  // the lines parallel to the path, by their height over the baseline, and their lengths
  const lines = new Map<number, Pt[] | null>();
  const level = (h: number): Pt[] | null => {
    const key = Math.round(h * 1000) / 1000;
    if (!lines.has(key)) {
      const l = key + m.offset === 0 ? [...path] : offsetPolyline(path, closed, key + m.offset);
      lines.set(key, l ? ring(l, closed) : null);
    }
    return lines.get(key) ?? null;
  };
  const base = level(0);
  const top = deck ? level(m.depth + (m.type === "deck" ? 0 : m.thickness)) : level(m.thickness);
  if (!base || !top || (deck && !level(m.depth))) return "The material's too thick for the path's corners.";
  const length = pathLength(base);
  // how far along the baseline each of its corners is
  const corner = [0];
  for (let i = 1; i < base.length; i++) corner.push(corner[i - 1] + Math.hypot(base[i].x - base[i - 1].x, base[i].y - base[i - 1].y));
  /** a point `s` along the baseline and `h` over it: as far through the same stretch of the line at that height (so it keeps to the corners) */
  const point = (s: number, h: number): Pt | null => {
    const l = level(h);
    if (!l) return null;
    if (l.length !== base.length) return pointAlong(l, (s / length) * pathLength(l)).at;
    let k = 0;
    while (k < corner.length - 2 && s > corner[k + 1]) k++;
    const span = corner[k + 1] - corner[k];
    const f = span > 0 ? Math.max(0, Math.min(1, (s - corner[k]) / span)) : 0;
    return at(l[k].x + (l[k + 1].x - l[k].x) * f, l[k].y + (l[k + 1].y - l[k].y) * f);
  };
  /** the distances along the baseline to sample: every `step`, and its corners */
  const samples = (step: number, more: readonly number[] = []): number[] => {
    const n = Math.max(1, Math.ceil(length / step));
    const all = [...Array.from({ length: n + 1 }, (_, i) => (length * i) / n), ...corner, ...more.filter((x) => x >= 0 && x <= length)].sort((a, b) => a - b);
    return all.filter((x, i) => i === 0 || x - all[i - 1] > length * 1e-9);
  };
  const random = seeded(path);
  const d: { fills: Pt[][]; solid: Pt[][]; stones: Pt[][]; lines: Pt[][]; dots: Pt[] } = { fills: [], solid: [], stones: [], lines: [], dots: [] };
  /** a line along the material through the heights `h` gives at the distances `at` */
  const profile = (h: (s: number) => number, where: readonly number[]): Pt[] | null => {
    const pts: Pt[] = [];
    for (const s of where) {
      const q = point(s, h(s));
      if (!q) return null;
      pts.push(q);
    }
    return pts;
  };
  /** the band between a lower and an upper line (each running from the start to the end), filled; closed paths round both */
  const fillBetween = (lower: Pt[], upper: Pt[]): void => {
    d.fills.push(closed ? [...upper, ...[...lower].reverse()] : [...lower, ...[...upper].reverse()]);
  };
  const ends = (lower: Pt[], upper: Pt[]): void => {
    if (closed) return;
    if (m.closure === "start" || m.closure === "both") d.lines.push([lower[0], upper[0]]);
    if (m.closure === "end" || m.closure === "both") d.lines.push([lower[lower.length - 1], upper[upper.length - 1]]);
  };
  /** stipple dots between heights `lo` and `hi`, each stretch of the baseline a quad mapped from a rectangle */
  const stipple = (lo: number, hi: number): string | null => {
    const count = Math.round(length * (hi - lo) * m.density);
    if (count > MAX_DOTS) return `The stipple needs over ${MAX_DOTS} dots: set a lower Density or draw a shorter path.`;
    for (let i = 0; i < count; i++) {
      const s = random() * length;
      const a = point(s, lo);
      const b = point(s, hi);
      const f = random();
      if (a && b) d.dots.push(at(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f));
    }
    return null;
  };

  const t = m.thickness;
  switch (m.type) {
    case "board":
    case "gyp":
    case "plywood":
    case "plywoodDetail": {
      fillBetween(base, top);
      d.lines.push(base, top);
      ends(base, top);
      if (m.type === "gyp") {
        // the facing, near the board's face
        const facing = level(t * 0.85);
        if (facing) d.lines.push(facing);
        const err = stipple(0, t);
        if (err) return err;
      }
      if (m.type === "plywood" || m.type === "plywoodDetail") {
        for (let k = 1; k < PLIES; k++) {
          const ply = level((t * k) / PLIES);
          if (ply) d.lines.push(ply);
        }
      }
      if (m.type === "plywoodDetail") {
        // slashes across the board in threes, a board's thickness apart
        const groups = Math.floor(length / t);
        if (groups * 3 > MAX_DOTS) return "Too many slashes: draw a shorter path or a thicker board.";
        for (let g = 0; g < groups; g++) {
          for (let k = 0; k < 3; k++) {
            const s = (g + 0.2) * t + k * 0.12 * t;
            const a = point(s, 0);
            const b = point(s + 0.5 * t, t);
            if (a && b) d.lines.push([a, b]);
          }
        }
      }
      return d;
    }
    case "stucco":
    case "stuccoDetail": {
      // a rough face: small rises and dips every half thickness
      const bumps = Array.from({ length: Math.ceil(length / (t / 2)) + 2 }, () => (random() < 0.35 ? (random() - 0.5) * 0.16 : 0));
      const face = profile((s) => t * (1 + bumps[Math.round(s / (t / 2))]), samples(t / 2));
      if (!face) return "The material's too thick for the path's corners.";
      fillBetween(base, face);
      d.lines.push(base, face);
      ends(base, face);
      if (m.type === "stuccoDetail") {
        const err = stipple(0, t * 0.92);
        if (err) return err;
      }
      return d;
    }
    case "roof": {
      // a solid band, coarse gravel over it
      const band = level(t * 0.35);
      if (!band) return "The material's too thick for the path's corners.";
      d.solid.push(closed ? [...band, ...[...base].reverse()] : [...base, ...[...band].reverse()]);
      const stones = Math.round((length / (t * 0.22)) * 1.6);
      if (stones > MAX_DOTS) return `The gravel needs over ${MAX_DOTS} stones: draw a shorter path or a thicker roof.`;
      for (let i = 0; i < stones; i++) {
        const s = random() * length;
        const h = t * (0.3 + random() * 0.3);
        const c = point(s, h);
        const along = point(Math.min(length, s + 1), h);
        if (!c || !along) continue;
        const turn = Math.atan2(along.y - c.y, along.x - c.x) + (random() - 0.5) * 1.2;
        const rx = t * (0.1 + random() * 0.1);
        const ry = rx * (0.55 + random() * 0.3);
        d.stones.push(Array.from({ length: 12 }, (_, k) => {
          const a = (k * Math.PI) / 6;
          const x = rx * Math.cos(a);
          const y = ry * Math.sin(a);
          return at(c.x + x * Math.cos(turn) - y * Math.sin(turn), c.y + x * Math.sin(turn) + y * Math.cos(turn));
        }));
      }
      return d;
    }
    default: {
      // the deck: pans dropping from its top flats (at the depth) to the baseline, a pitch apart
      const turns: number[] = [];
      for (let p = 0; p <= length; p += m.pitch) {
        let edge = p;
        for (const share of DECK) {
          turns.push(edge);
          edge += share * m.pitch;
        }
      }
      if (turns.length > MAX_DOTS) return "Too many corrugations: set a wider Pitch or draw a shorter path.";
      const height = (s: number): number => {
        const phase = (s % m.pitch) / m.pitch;
        if (phase <= DECK[0]) return m.depth;
        if (phase <= DECK[0] + DECK[1]) return m.depth * (1 - (phase - DECK[0]) / DECK[1]);
        if (phase <= DECK[0] + DECK[1] + DECK[2]) return 0;
        return (m.depth * (phase - DECK[0] - DECK[1] - DECK[2])) / DECK[3];
      };
      const deckLine = profile(height, samples(length, turns));
      if (!deckLine) return "The material's too thick for the path's corners.";
      d.lines.push(deckLine);
      if (m.type === "deck") return d;
      fillBetween(deckLine, top);
      d.lines.push(top);
      ends(deckLine, top);
      if (m.type === "deckFillDetail") {
        // stipple in the topping and down into the pans
        const err = stipple(m.depth, m.depth + t);
        if (err) return err;
        const pans = Math.round((DECK[2] + DECK[1]) * length * m.depth * m.density);
        if (d.dots.length + pans > MAX_DOTS) return `The stipple needs over ${MAX_DOTS} dots: set a lower Density or draw a shorter path.`;
        for (let i = 0; i < pans; i++) {
          // a point in a pan: between its webs, narrowing toward the bottom
          const p = Math.floor(random() * Math.ceil(length / m.pitch)) * m.pitch;
          const h = random() * m.depth;
          const web = DECK[1] * m.pitch * (1 - h / m.depth);
          const s = p + DECK[0] * m.pitch + web + random() * (DECK[2] * m.pitch + 2 * (DECK[1] * m.pitch - web));
          if (s > length) continue;
          const a = point(s, 0);
          const b = point(s, m.depth);
          if (a && b) d.dots.push(at(a.x + ((b.x - a.x) * h) / m.depth, a.y + ((b.y - a.y) * h) / m.depth));
        }
      }
      return d;
    }
  }
}
