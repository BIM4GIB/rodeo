// The sums behind Stage > Event's Create Stage and Create Stair (eventStage.ts) and Create Room
// (eventRoom.ts): a closed shape laid with standard stage decks on a grid square to its longest
// side, the decks clipped by its edge becoming smaller decks where they stay rectangular and stage
// plugs where they don't; legs that stand beside a neighbour's dropped (Minimize Leg Count); the
// stage's 3D from its plan; steps fitted to a stage's height, with their 3D; and a room's walls
// round a shape, their inner faces on its edge. Kept apart so it runs without the page.

import polygonClipping, { type Pair, type Polygon } from "polygon-clipping";
import type { Pt } from "../../../core/index.ts";
import { placed } from "../../../app/detailShapes.ts";
import { offsetPolyline } from "../../../app/geom.ts";
import { prism, type Solid } from "../../../app/solids3d.ts";
import type { StagePlan, StageStructure } from "../../../app/stageShapes.ts";

/** decks and plugs a stage may hold */
export const MAX_PIECES = 2000;
/** a piece of a deck smaller than this (mm²) is left out: a sliver where the shape meets a grid line */
export const MIN_AREA = 100;
/** the tallest riser Create Stair makes, mm */
export const MAX_RISER = 180;
const EPS = 1e-6;

/** A standard deck (or one cut smaller, still rectangular) with its middle at `at`, its width along `angle`; or a plug filling `outline`. */
export type StagePiece =
  | { readonly kind: "deck"; readonly at: Pt; readonly angle: number; readonly width: number; readonly depth: number }
  | { readonly kind: "plug"; readonly outline: Pt[] };

const area2 = (pts: readonly Pt[]): number => pts.reduce((a, p, i) => a + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0);

/** The ring without its closing point, repeats and points in a straight line. */
function tidy(ring: readonly Pt[]): Pt[] {
  let pts = ring.filter((p, i) => i === 0 || Math.hypot(p.x - ring[i - 1].x, p.y - ring[i - 1].y) > EPS);
  if (pts.length > 1 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= EPS) pts.pop();
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const [a, b, c] = [pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) <= 1e-6 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** The direction of the outline's longest side, as an angle. */
export function longestSide(outline: readonly Pt[]): number {
  let best = -1;
  let angle = 0;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best + EPS) {
      best = len;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  });
  // a side running left or down lays the same grid as one running right or up
  const turned = ((angle % Math.PI) + Math.PI) % Math.PI;
  return turned > Math.PI / 2 + EPS ? turned - Math.PI : turned;
}

/**
 * The decks and plugs laying `outline` (a closed shape's points): a grid of `width` × `depth`
 * decks from the corner of its extent nearest the start of its longest side's direction, square
 * to that side. Each cell wholly inside is a deck; a cell the edge cuts keeps what is inside,
 * as a smaller deck when that is still a rectangle, else as a plug (or several, where the edge
 * cuts it in pieces). A message when it can't.
 */
export function stageLayout(outline: readonly Pt[], width: number, depth: number): StagePiece[] | string {
  if (!(width > 0 && depth > 0)) return "Set the Standard Stage Deck Width and Depth over 0.";
  const ring = tidy(outline);
  if (ring.length < 3 || Math.abs(area2(ring)) / 2 < MIN_AREA) return "Select a closed shape with an area for the stage.";
  const angle = longestSide(ring);
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  const o = ring[0];
  const local = ring.map((p) => ({ x: (p.x - o.x) * u.x + (p.y - o.y) * u.y, y: (p.x - o.x) * v.x + (p.y - o.y) * v.y }));
  const world = (p: Pt): Pt => ({ x: o.x + p.x * u.x + p.y * v.x, y: o.y + p.x * u.y + p.y * v.y });
  const [s0, s1] = [Math.min(...local.map((p) => p.x)), Math.max(...local.map((p) => p.x))];
  const [t0, t1] = [Math.min(...local.map((p) => p.y)), Math.max(...local.map((p) => p.y))];
  const cols = Math.max(1, Math.ceil((s1 - s0) / width - 1e-6));
  const rows = Math.max(1, Math.ceil((t1 - t0) / depth - 1e-6));
  if (cols * rows > MAX_PIECES * 4) return `The stage would take more than ${MAX_PIECES} decks: set a larger Standard Stage Deck Width or Depth.`;
  const shape: Polygon = [local.map((p): Pair => [p.x, p.y])];
  const pieces: StagePiece[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [x0, y0] = [s0 + i * width, t0 + j * depth];
      const [x1, y1] = [Math.min(x0 + width, s1), Math.min(y0 + depth, t1)];
      const cell: Polygon = [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
      ];
      for (const poly of polygonClipping.intersection(shape, cell)) {
        const part = tidy(poly[0].map(([x, y]) => ({ x, y })));
        if (part.length < 3 || Math.abs(area2(part)) / 2 < MIN_AREA) continue;
        const xs = part.map((p) => p.x);
        const ys = part.map((p) => p.y);
        const [a0, a1, b0, b1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        const square = part.length === 4 && part.every((p) => (Math.abs(p.x - a0) < 1e-3 || Math.abs(p.x - a1) < 1e-3) && (Math.abs(p.y - b0) < 1e-3 || Math.abs(p.y - b1) < 1e-3));
        if (square) pieces.push({ kind: "deck", at: world({ x: (a0 + a1) / 2, y: (b0 + b1) / 2 }), angle, width: a1 - a0, depth: b1 - b0 });
        else pieces.push({ kind: "plug", outline: part.map(world) });
        if (pieces.length > MAX_PIECES) return `The stage would take more than ${MAX_PIECES} decks: set a larger Standard Stage Deck Width or Depth.`;
      }
    }
  }
  return pieces.length ? pieces : "The shape is too small for a stage.";
}

/** A leg's middle: the outlines out of sight under a deck with more than two points are its legs. */
const middle = (pts: readonly Pt[]): Pt => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });

/**
 * Minimize Leg Count: the plans (placed where they stand) with each leg dropped that stands within
 * one and a half diameters of a leg kept under another piece, as where two decks meet; the first
 * piece's legs are kept. Braces (two-point lines) stay.
 */
export function minimizeLegs(plans: readonly StagePlan[], diameter: number): StagePlan[] {
  const kept: { at: Pt; piece: number }[] = [];
  const near = (p: Pt, piece: number): boolean => kept.some((k) => k.piece !== piece && Math.hypot(k.at.x - p.x, k.at.y - p.y) < diameter * 1.5 - EPS);
  return plans.map((plan, piece) => {
    const keep = (p: Pt): boolean => {
      if (near(p, piece)) return false;
      kept.push({ at: p, piece });
      return true;
    };
    const hidden = plan.hidden.filter((pts) => pts.length <= 2 || keep(middle(pts)));
    const loci = plan.loci.filter(keep);
    return { ...plan, hidden, loci, count: hidden.filter((pts) => pts.length > 2).length + loci.length };
  });
}

/**
 * A piece's 3D (z above its layer) from its plan placed where it stands, `outline` its top: a
 * Simple or Border deck a block from the floor to `height`; a Deck Only deck its top alone,
 * `top` thick; a legged deck its top on its legs.
 */
export function pieceSolid(outline: readonly Pt[], plan: StagePlan, structure: StageStructure, height: number, top: number): Solid {
  if (structure === "simple" || structure === "border") return prism([outline], 0, height);
  const under = Math.max(0, height - Math.min(top, height));
  const deck = prism([outline], under, height);
  if (structure === "deckOnly" || under <= EPS) return deck;
  return [...deck, ...plan.hidden.filter((pts) => pts.length > 2).flatMap((leg) => prism([leg], 0, under))];
}

/** How many steps come down from a stage `height` high: risers no taller than MAX_RISER, the stage the top one; at least one. */
export const stepsFor = (height: number): number => Math.max(1, Math.ceil(height / MAX_RISER - 1e-9) - 1);

/**
 * Steps' 3D at `at` turned by `angle` (the frame stageSteps draws in: the stage's edge along x = 0,
 * coming down along +x): each tread a block from the floor, `steps` of them `depth` deep (and one
 * more level with the stage with `topStep`), rising evenly to `height`.
 */
export function stepsSolid(at: Pt, angle: number, width: number, steps: number, depth: number, topStep: boolean, height: number): Solid {
  const risers = steps + 1;
  const treads = steps + (topStep ? 1 : 0);
  return Array.from({ length: treads }, (_, k) => {
    const z = (height * (risers - k - (topStep ? 0 : 1))) / risers;
    return prism([placed([{ x: k * depth, y: -width / 2 }, { x: (k + 1) * depth, y: -width / 2 }, { x: (k + 1) * depth, y: width / 2 }, { x: k * depth, y: width / 2 }], at, angle)], 0, z);
  }).flat();
}

/**
 * A room round `outline` (its inside): the outline counter-clockwise without repeats or points in
 * a straight line, and the ring `offset` outside it, corner for corner; null when the offset folds
 * a side away.
 */
export function roomRing(outline: readonly Pt[], offset: number): { inside: Pt[]; outside: Pt[] } | null {
  const ring = tidy(outline);
  if (ring.length < 3 || Math.abs(area2(ring)) / 2 < MIN_AREA) return null;
  const inside = area2(ring) < 0 ? ring.reverse() : ring;
  const outside = offset > 0 ? offsetPolyline(inside, true, -offset) : inside.map((p) => ({ ...p }));
  return outside && outside.length === inside.length && area2(outside) > area2(inside) ? { inside, outside } : null;
}
