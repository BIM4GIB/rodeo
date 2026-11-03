// The sums behind Event Design's Create Lectern (lectern.ts): Rodeo's lecterns, each a few parts
// drawn in plan and built as solids, the faces the dialog's preview shows, the turn a second click
// gives one, and how high the stage under it stands. A lectern's own frame has its insertion point
// on the floor under the middle of its reading desk, its front (the audience's side) toward −y and
// the speaker behind it at +y. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { circleOutline, mapSolid, type Point3, type Solid } from "../../../app/solids3d.ts";

export type LecternRole = "base" | "body" | "desk" | "trim";

export interface LecternPart {
  readonly role: LecternRole;
  /** its outline from above, drawn in plan; null for a part out of sight under another */
  readonly plan: readonly Pt[] | null;
  readonly solid: Solid;
}

export interface LecternKind {
  readonly name: string;
  /** its own look: the fill of each part, the pen of all, and how opaque the fills are (%) */
  readonly fills: Readonly<Record<LecternRole, string>>;
  readonly pen: string;
  readonly opacity: number;
  readonly parts: readonly LecternPart[];
}

/** degrees the reading desk falls toward the speaker */
export const DESK_SLOPE = 15;
const TAN = Math.tan((DESK_SLOPE * Math.PI) / 180);
/** the book stop along the desk's back edge: how deep and how far it stands up, mm */
const STOP_DEPTH = 25;
const STOP_RISE = 20;

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * A convex, counter-clockwise `outline` from z0 to z1, each cap one face (prism cuts them into
 * triangles, whose seams the preview would draw), its faces turned outward.
 */
function slab(outline: readonly Pt[], z0: number, z1: number): Solid {
  const ring = (z: number): number[] => outline.flatMap((p) => [p.x, p.y, z]);
  const sides = outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    return [a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1, a.x, a.y, z1];
  });
  return [ring(z1), [...outline].reverse().flatMap((p) => [p.x, p.y, z0]), ...sides];
}

/** A block from z0 to z1 over `outline`. */
const block = (role: LecternRole, outline: Pt[], z0: number, z1: number, shown: boolean): LecternPart => ({ role, plan: shown ? outline : null, solid: slab(outline, z0, z1) });

/**
 * The reading desk, `half` either side of the middle from `front` to `back` (y), level underneath at
 * z0, `thick` at its back and rising toward the audience by the slope; and its book stop.
 */
function desk(half: number, front: number, back: number, z0: number, thick: number): LecternPart[] {
  const top = (y: number): number => z0 + thick + TAN * (back - y);
  const outline = rect(-half, front, half, back);
  const wedge = mapSolid(slab(outline, z0, z0 + thick), ([x, y, z]): Point3 => [x, y, z > z0 + 1e-6 ? top(y) : z]);
  const stop = rect(-half + 20, back - STOP_DEPTH, half - 20, back);
  return [
    { role: "desk", plan: outline, solid: wedge },
    { role: "trim", plan: stop, solid: slab(stop, top(back) - 2, top(back - STOP_DEPTH) + STOP_RISE) },
  ];
}

const WOOD = { base: "#5c3a24", body: "#8a5a3b", desk: "#a0704a", trim: "#5c3a24" };

/** Rodeo's lecterns: generic shapes, not Vectorworks' own symbols. */
export const LECTERNS: readonly LecternKind[] = [
  {
    name: "Classic Wood Lectern",
    fills: WOOD,
    pen: "#2b1b10",
    opacity: 100,
    parts: [block("base", rect(-330, -290, 330, 290), 0, 80, true), block("body", rect(-300, -260, 300, 250), 80, 1000, false), ...desk(320, -270, 270, 1000, 30)],
  },
  {
    name: "Modern Panel Lectern",
    fills: { base: "#2e3238", body: "#3d4249", desk: "#c8ccd1", trim: "#2e3238" },
    pen: "#1b1e22",
    opacity: 100,
    parts: [block("base", rect(-280, -240, 280, 220), 0, 20, true), block("body", rect(-300, -250, 300, -210), 20, 1000, false), ...desk(310, -260, 200, 1000, 30)],
  },
  {
    name: "Acrylic Lectern",
    fills: { base: "#cfe8f3", body: "#cfe8f3", desk: "#cfe8f3", trim: "#a9cfe0" },
    pen: "#7fa7b8",
    opacity: 45,
    parts: [block("base", rect(-300, -250, 300, 250), 0, 15, true), block("body", rect(-280, -240, 280, -220), 15, 1000, false), ...desk(300, -250, 180, 1000, 20)],
  },
  {
    name: "Column Lectern",
    fills: { base: "#3a3f45", body: "#9aa3ad", desk: "#2b2f36", trim: "#9aa3ad" },
    pen: "#15181b",
    opacity: 100,
    parts: [block("base", circleOutline({ x: 0, y: 0 }, 260, 36), 0, 30, true), block("body", circleOutline({ x: 0, y: 0 }, 60, 24), 30, 1000, false), ...desk(280, -210, 210, 1000, 30)],
  },
  {
    name: "Tabletop Lectern",
    fills: WOOD,
    pen: "#2b1b10",
    opacity: 100,
    parts: desk(280, -200, 200, 0, 40),
  },
];

export const lecternNamed = (name: string): LecternKind => LECTERNS.find((k) => k.name === name) ?? LECTERNS[0];

/** How wide, deep and high a lectern is, mm. */
export function lecternSize(kind: LecternKind): { width: number; depth: number; height: number } {
  let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const part of kind.parts) {
    for (const face of part.solid) {
      for (let i = 0; i + 2 < face.length; i += 3) {
        x0 = Math.min(x0, face[i]);
        x1 = Math.max(x1, face[i]);
        y0 = Math.min(y0, face[i + 1]);
        y1 = Math.max(y1, face[i + 1]);
        z0 = Math.min(z0, face[i + 2]);
        z1 = Math.max(z1, face[i + 2]);
      }
    }
  }
  return { width: x1 - x0, depth: y1 - y0, height: z1 - z0 };
}

/** What the plan draws, in the order it's drawn: the parts that show from above, lowest first. */
export function planOutlines(kind: LecternKind): { role: LecternRole; outline: readonly Pt[] }[] {
  return kind.parts.flatMap((p) => (p.plan ? [{ role: p.role, outline: p.plan }] : []));
}

export type PreviewView = "front" | "side" | "top";

/**
 * A lectern's faces as a view sees them, farthest first so nearer ones paint over them: from the
 * audience (x across, z up), from its left (y across, the front at the left), or from above (x, y).
 */
export function viewFaces(kind: LecternKind, view: PreviewView): { role: LecternRole; points: Pt[] }[] {
  const out: { role: LecternRole; points: Pt[]; depth: number }[] = [];
  for (const part of kind.parts) {
    for (const face of part.solid) {
      const points: Pt[] = [];
      let depth = 0;
      const n = face.length / 3;
      for (let i = 0; i < n; i++) {
        const [x, y, z] = [face[i * 3], face[i * 3 + 1], face[i * 3 + 2]];
        points.push(view === "front" ? { x, y: z } : view === "side" ? { x: y, y: z } : { x, y });
        // the audience looks toward +y, the side view toward +x, the top down
        depth += view === "front" ? -y : view === "side" ? -x : z;
      }
      out.push({ role: part.role, points, depth: depth / n });
    }
  }
  return out.sort((a, b) => a.depth - b.depth).map(({ role, points }) => ({ role, points }));
}

/**
 * The turn (°, counter-clockwise) that faces a lectern standing at `at` toward `to`: its front, −y
 * of its own, toward the point; 0 when they meet.
 */
export function facing(at: Pt, to: Pt): number {
  if (Math.hypot(to.x - at.x, to.y - at.y) < 1e-9) return 0;
  const deg = (Math.atan2(to.y - at.y, to.x - at.x) * 180) / Math.PI + 90;
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * The highest point where the plumb line through `at` meets one of `triangles` (x, y, z each corner)
 * that isn't upright, no higher than `below`; null when it meets none. Winding doesn't matter, so a
 * stage's top is found whichever way its faces turn.
 */
export function highestAt(triangles: ArrayLike<number>, at: Pt, below: number): number | null {
  let best: number | null = null;
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from({ length: 9 }, (_, k) => triangles[i + k]);
    const ux = bx - ax;
    const uy = by - ay;
    const vx = cx - ax;
    const vy = cy - ay;
    const det = ux * vy - uy * vx;
    // upright faces (and slivers) have next to no area from above
    const across = Math.hypot(uy * (cz - az) - (bz - az) * vy, (bz - az) * vx - ux * (cz - az), det);
    if (!(across > 0) || Math.abs(det) / across < 0.3) continue;
    const s = ((at.x - ax) * vy - (at.y - ay) * vx) / det;
    const t = (ux * (at.y - ay) - uy * (at.x - ax)) / det;
    if (s < -1e-9 || t < -1e-9 || s + t > 1 + 1e-9) continue;
    const z = az + s * (bz - az) + t * (cz - az);
    if (z <= below + 1e-6 && (best === null || z > best)) best = z;
  }
  return best;
}
