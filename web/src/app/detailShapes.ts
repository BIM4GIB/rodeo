// What the Detailing and Site Planning tools draw (tools/detailing.ts), as plain geometry: a break
// line's zigzag, batt insulation's loops and rigid insulation's crossed band, brick courses, steel
// and lumber sections, a bolt, a welding symbol and a plant. Kept apart from the tools so it runs
// without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";

/** Where insulation lies against the line drawn: to its left, centred on it, or to its right. */
export type InsulationSide = "left" | "centre" | "right";

/** a batt's loops: how far each one runs along the band, as a share of its thickness */
const BATT_PITCH = 0.5;
/** points along each loop */
const LOOP_STEPS = 24;

/** The line from `a` to `b` with a zigzag break `size` high at its middle; null when too short for one. */
export function breakLine(a: Pt, b: Pt, size: number): Pt[] | null {
  const len = dist(a, b);
  if (!(size > 0) || len < size) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // the zigzag is as wide as it is high, kept small on a short line
  const h = Math.min(size, len / 6);
  const at = (s: number, t: number): Pt => ({ x: m.x + u.x * s + n.x * t, y: m.y + u.y * s + n.y * t });
  return [a, at(-h / 2, 0), at(-h / 6, h), at(h / 6, -h), at(h / 2, 0), b];
}

/** Where a band `thickness` thick runs beside the line from `a` (length, direction, and its centre line's offset to the left). */
function band(a: Pt, b: Pt, thickness: number, side: InsulationSide): { len: number; u: Pt; n: Pt; off: number } | null {
  const len = dist(a, b);
  if (!(thickness > 0) || len < thickness / 4) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const off = side === "left" ? thickness / 2 : side === "right" ? -thickness / 2 : 0;
  return { len, u, n: { x: -u.y, y: u.x }, off };
}

/**
 * Batt insulation's loops along the line from `a` to `b`: a prolate cycloid (s = kθ − r sin θ,
 * t = −r cos θ) touching both faces of a band `thickness` thick, a whole number of loops long. It
 * starts and ends where a loop reaches furthest back and forward, which sit on the line's ends.
 */
export function battLoops(a: Pt, b: Pt, thickness: number, side: InsulationSide): Pt[] | null {
  const f = band(a, b, thickness, side);
  if (!f) return null;
  const r = thickness / 2;
  const loops = Math.max(1, Math.round(f.len / (thickness * BATT_PITCH)));
  // k, the advance per radian, so that the curve spans the line: the loop's ends are where
  // ds/dθ = k − r cos θ is 0, at θ0 = acos(k / r), and the span is k(2πn − 2θ0) + 2r sin θ0
  let k = f.len / (2 * Math.PI * loops);
  let th0 = 0;
  for (let i = 0; i < 8 && k < r; i++) {
    th0 = Math.acos(k / r);
    k = Math.max(0, (f.len - 2 * r * Math.sin(th0)) / (2 * Math.PI * loops - 2 * th0));
  }
  if (!(k > 0) || k >= r) return null;
  th0 = Math.acos(k / r);
  const s0 = k * th0 - r * Math.sin(th0);
  const end = 2 * Math.PI * loops - th0;
  const n = loops * LOOP_STEPS;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((end - th0) * i) / n;
    const s = k * th - r * Math.sin(th) - s0;
    const t = f.off - r * Math.cos(th);
    pts.push({ x: a.x + f.u.x * s + f.n.x * t, y: a.y + f.u.y * s + f.n.y * t });
  }
  return pts;
}

/**
 * Rigid insulation along the line from `a` to `b`: the band's outline, and two zigzags between its
 * faces, a thickness apart, that cross into a row of Xs.
 */
export function rigidInsulation(a: Pt, b: Pt, thickness: number, side: InsulationSide): { outline: Pt[]; crosses: Pt[][] } | null {
  const f = band(a, b, thickness, side);
  if (!f) return null;
  const at = (s: number, t: number): Pt => ({ x: a.x + f.u.x * s + f.n.x * (f.off + t), y: a.y + f.u.y * s + f.n.y * (f.off + t) });
  const r = thickness / 2;
  const outline = [at(0, -r), at(f.len, -r), at(f.len, r), at(0, r)];
  const steps = Math.max(1, Math.round(f.len / thickness));
  const pitch = f.len / steps;
  const zig = (phase: number): Pt[] => Array.from({ length: steps + 1 }, (_, k) => at(k * pitch, (k + phase) % 2 === 0 ? -r : r));
  return { outline, crosses: [zig(0), zig(1)] };
}

/**
 * The steel sections Steel Section draws: wide flange, channel, angle, tee, I-beam, rectangular,
 * square and round tubing, and Z-section.
 */
export type SteelShape = "w" | "c" | "l" | "t" | "i" | "rt" | "st" | "rd" | "z";

/**
 * A steel section's size, mm: `depth` and `width` its overall height and breadth; `web` and
 * `flange` the thicknesses (an angle's legs are both `web` thick; an I-beam's `flange` is its mean
 * thickness; a Z-section's `width` is each flange's, the web's thickness in it). Tubing's wall is `web` thick; square tubing is `depth` both ways, and round tubing's
 * `depth` is its outside diameter.
 */
export interface SteelSize {
  readonly depth: number;
  readonly width: number;
  readonly web: number;
  readonly flange: number;
}

/** an I-beam's flanges thicken toward the web 1 in 6 (Vectorworks' and the AISC's S shapes) */
const I_BEAM_SLOPE = 1 / 6;
/** points along each quarter turn of a tube's corners (a round tube's quarter) */
const TUBE_CORNER_STEPS = 16;

/**
 * A steel section's outline (no root fillets), centred on its bounding box at the origin, its depth
 * up y: the wide flange's and I-beam's flanges top and bottom, the channel's web and the angle's
 * upright leg on the left, the tee's flange on top, the Z-section's top flange to the right and its
 * bottom one to the left; tubing's outside with its inside joined in as a hole. Null when the thicknesses don't fit inside the size.
 */
export function steelOutline(shape: SteelShape, size: SteelSize): Pt[] | null {
  const { depth: d, width: b, web: tw, flange: tf } = size;
  if (shape === "rt" || shape === "st" || shape === "rd") return tube(shape === "rt" ? b : d, d, tw, shape === "rd");
  const x = b / 2;
  const y = d / 2;
  if (!(d > 0 && b > 0 && tw > 0 && tw < b && (shape === "l" || (tf > 0 && 2 * tf < d)))) return null;
  const p = (px: number, py: number): Pt => ({ x: px, y: py });
  switch (shape) {
    case "w":
      return [p(-x, -y), p(x, -y), p(x, -y + tf), p(tw / 2, -y + tf), p(tw / 2, y - tf), p(x, y - tf), p(x, y), p(-x, y), p(-x, y - tf), p(-tw / 2, y - tf), p(-tw / 2, -y + tf), p(-x, -y + tf)];
    case "c":
      return [p(-x, -y), p(x, -y), p(x, -y + tf), p(-x + tw, -y + tf), p(-x + tw, y - tf), p(x, y - tf), p(x, y), p(-x, y)];
    case "l":
      return tw < d ? [p(-x, -y), p(x, -y), p(x, -y + tw), p(-x + tw, -y + tw), p(-x + tw, y), p(-x, y)] : null;
    case "t":
      return [p(-x, y), p(-x, y - tf), p(-tw / 2, y - tf), p(-tw / 2, -y), p(tw / 2, -y), p(tw / 2, y - tf), p(x, y - tf), p(x, y)];
    case "z": {
      const w = b - tw / 2;
      return [p(-w, -y), p(tw / 2, -y), p(tw / 2, y - tf), p(w, y - tf), p(w, y), p(-tw / 2, y), p(-tw / 2, -y + tf), p(-w, -y + tf)];
    }
    case "i": {
      // the mean thickness is halfway along the flange from its toe to the web
      const taper = (I_BEAM_SLOPE * (b - tw)) / 4;
      const toe = tf - taper;
      const root = tf + taper;
      if (!(toe > 0 && 2 * root < d)) return null;
      return [p(-x, -y), p(x, -y), p(x, -y + toe), p(tw / 2, -y + root), p(tw / 2, y - root), p(x, y - toe), p(x, y), p(-x, y), p(-x, y - toe), p(-tw / 2, y - root), p(-tw / 2, -y + root), p(-x, -y + toe)];
    }
  }
}

/**
 * A tube `w` × `h` with walls `t` thick, centred at the origin: its outside, then its inside joined
 * in as a hole across the wall at the right side's middle. Round, or its outside corners rounded to
 * twice the wall and its inside corners to the wall (the AISC's design radius).
 */
function tube(w: number, h: number, t: number, round: boolean): Pt[] | null {
  if (!(w > 0 && h > 0 && t > 0 && 2 * t < Math.min(w, h))) return null;
  const half = Math.min(w, h) / 2;
  const r = round ? half : Math.min(2 * t, half);
  const outside = roundedOutline(w, h, r);
  const inside = roundedOutline(w - 2 * t, h - 2 * t, r - t);
  // the hole runs the other way round, so it stays empty however the outline is filled
  return [...outside, outside[0], inside[0], ...inside.slice(1).reverse(), inside[0]];
}

/** A rectangle `w` × `h` centred at the origin, its corners rounded to `r`: anticlockwise from its right side's middle. */
function roundedOutline(w: number, h: number, r: number): Pt[] {
  const x = w / 2 - r;
  const y = h / 2 - r;
  const corners = [
    { x, y },
    { x: -x, y },
    { x: -x, y: -y },
    { x, y: -y },
  ];
  const pts: Pt[] = [{ x: w / 2, y: 0 }];
  corners.forEach((c, q) => {
    for (let k = 0; k <= TUBE_CORNER_STEPS; k++) {
      const a = (Math.PI / 2) * (q + k / TUBE_CORNER_STEPS);
      const pt = { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
      if (dist(pt, pts.at(-1)!) > 1e-9) pts.push(pt);
    }
  });
  if (dist(pts[0], pts.at(-1)!) <= 1e-9) pts.pop();
  return pts;
}

/** How a lumber section is marked: a continuous member crossed corner to corner, blocking with one diagonal. */
export type LumberMark = "continuous" | "blocking";

/** A lumber section `width` × `depth` centred at the origin: its outline and the lines marking it. */
export function lumberSection(width: number, depth: number, mark: LumberMark): { outline: Pt[]; marks: Pt[][] } | null {
  if (!(width > 0 && depth > 0)) return null;
  const x = width / 2;
  const y = depth / 2;
  const outline = [
    { x: -x, y: -y },
    { x, y: -y },
    { x, y },
    { x: -x, y },
  ];
  const diagonal = [outline[0], outline[2]];
  return { outline, marks: mark === "continuous" ? [diagonal, [outline[1], outline[3]]] : [diagonal] };
}

/** Points turned by `angle` (radians) about the origin and moved to `at`. */
export function placed(pts: readonly Pt[], at: Pt, angle: number): Pt[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map((p) => ({ x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c }));
}

/** A repetitive unit's size, mm, and how many courses run along the line. */
export interface UnitCourse {
  readonly length: number;
  readonly height: number;
  readonly joint: number;
  readonly courses: number;
}

/** most units one line lays, so a slip of the pointer can't fill the drawing */
export const MAX_UNITS = 2000;

/**
 * Units (bricks or blocks) laid in courses along the line from `a` to `b`, the first course on the
 * line and the rest above it to its left, each a joint apart, every other course moved half a unit
 * (stretcher bond); units are cut at the line's ends. Null when the line is shorter than a joint
 * or would take more than MAX_UNITS.
 */
export function unitCourses(a: Pt, b: Pt, c: UnitCourse): Pt[][] | null {
  const len = dist(a, b);
  if (!(c.length > 0 && c.height > 0 && c.joint >= 0 && c.courses >= 1) || len <= c.joint) return null;
  const pitch = c.length + c.joint;
  const courses = Math.floor(c.courses);
  if (Math.ceil(len / pitch + 1) * courses > MAX_UNITS) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const at = (s: number, t: number): Pt => ({ x: a.x + u.x * s + n.x * t, y: a.y + u.y * s + n.y * t });
  const units: Pt[][] = [];
  for (let k = 0; k < courses; k++) {
    const t0 = k * (c.height + c.joint);
    const t1 = t0 + c.height;
    for (let s = k % 2 === 1 ? -pitch / 2 : 0; s < len; s += pitch) {
      const s0 = Math.max(0, s);
      const s1 = Math.min(len, s + c.length);
      // a sliver under a joint's width isn't laid
      if (s1 - s0 < Math.max(c.joint, 1e-6)) continue;
      units.push([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)]);
    }
  }
  return units.length > 0 ? units : null;
}

/** Lines, outlines and circles: what the symbol-like tools draw, before they become objects. */
export interface Drawing {
  /** closed outlines */
  readonly outlines: Pt[][];
  /** open lines */
  readonly lines: Pt[][];
  readonly circles: { readonly center: Pt; readonly radius: number }[];
}

/** The frame along the line from `a` to `b`: a point `s` along it and `t` to its left. */
function frame(a: Pt, b: Pt): { len: number; at: (s: number, t: number) => Pt } {
  const len = dist(a, b);
  const u = len > 0 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  return { len, at: (s, t) => ({ x: a.x + u.x * s - u.y * t, y: a.y + u.y * s + u.x * t }) };
}

/**
 * A hex-head bolt `diameter` thick seen from the side, its head behind `a` and its shank to `b`:
 * the head across its corners (1.5 × the diameter across flats) with its faces' edges, the shank
 * chamfered at its tip, and the thread's root lines over its threaded length (twice the diameter
 * and 6 mm, or the whole shank). Null when shorter than its diameter.
 */
export function boltSide(a: Pt, b: Pt, diameter: number): Drawing | null {
  const f = frame(a, b);
  const d = diameter;
  if (!(d > 0) || f.len < d) return null;
  const head = 0.7 * d;
  const corners = (1.5 * d) / Math.cos(Math.PI / 6);
  const chamfer = 0.1 * d;
  const thread = Math.min(f.len - chamfer, 2 * d + 6);
  const root = 0.85 * d;
  const at = f.at;
  const L = f.len;
  return {
    outlines: [
      [at(-head, -corners / 2), at(0, -corners / 2), at(0, corners / 2), at(-head, corners / 2)],
      [at(0, -d / 2), at(L - chamfer, -d / 2), at(L, -d / 2 + chamfer), at(L, d / 2 - chamfer), at(L - chamfer, d / 2), at(0, d / 2)],
    ],
    lines: [
      [at(-head, -corners / 4), at(0, -corners / 4)],
      [at(-head, corners / 4), at(0, corners / 4)],
      [at(L - thread, -d / 2), at(L - thread, d / 2)],
      [at(L - thread, -root / 2), at(L - chamfer, -root / 2)],
      [at(L - thread, root / 2), at(L - chamfer, root / 2)],
    ],
    circles: [],
  };
}

export type WeldKind = "fillet" | "vgroove";
export type WeldSide = "arrow" | "other" | "both";

/**
 * A welding symbol: the arrow from the joint `tip` to the reference line's end at `elbow`, the
 * reference line running level away from the arrow, and the weld's symbol on it: below the line
 * for the arrow side, above for the other side (a fillet's upright leg on the left, as AWS A2.4
 * draws it). `size` is the symbol's height; a circle at the elbow says weld all around. Null when
 * the arrow is shorter than the symbol.
 */
export function weldSymbol(tip: Pt, elbow: Pt, kind: WeldKind, side: WeldSide, size: number, allAround: boolean): Drawing | null {
  const arrow = dist(tip, elbow);
  if (!(size > 0) || arrow < size) return null;
  const dir = tip.x <= elbow.x ? 1 : -1;
  const ref = 5 * size;
  const end = { x: elbow.x + dir * ref, y: elbow.y };
  // the arrowhead: a third of the symbol wide, as long as the symbol
  const u = { x: (tip.x - elbow.x) / arrow, y: (tip.y - elbow.y) / arrow };
  const back = { x: tip.x - u.x * size, y: tip.y - u.y * size };
  const half = size / 6;
  const head = [tip, { x: back.x - u.y * half, y: back.y + u.x * half }, { x: back.x + u.y * half, y: back.y - u.x * half }];
  // the symbol sits on the reference line a third of the way out
  const m = elbow.x + (dir * ref) / 3;
  const symbol = (up: 1 | -1): Pt[] =>
    kind === "fillet"
      ? [
          { x: m, y: elbow.y },
          { x: m, y: elbow.y + up * size },
          { x: m + size, y: elbow.y },
        ]
      : [
          { x: m - size / 2, y: elbow.y + up * size },
          { x: m, y: elbow.y },
          { x: m + size / 2, y: elbow.y + up * size },
        ];
  const sides: (1 | -1)[] = side === "arrow" ? [-1] : side === "other" ? [1] : [-1, 1];
  const marks = sides.map(symbol);
  return {
    outlines: [head, ...(kind === "fillet" ? marks : [])],
    lines: [[back, elbow], [elbow, end], ...(kind === "vgroove" ? marks : [])],
    circles: allAround ? [{ center: elbow, radius: size / 2 }] : [],
  };
}

export type PlantStyle = "scalloped" | "circle";

/** lobes round a scalloped canopy */
const CANOPY_LOBES = 10;
/** how deep the lobes are, as a share of the radius */
const LOBE_DEPTH = 0.12;
/** points along each lobe */
const LOBE_STEPS = 10;
/** most plants one row places */
export const MAX_PLANTS = 500;

/**
 * A plant in plan at `at`, its canopy `spread` across: a scalloped or round outline, a trunk a
 * twelfth of the canopy across, and a cross through the trunk.
 */
export function plantPlan(at: Pt, spread: number, style: PlantStyle): Drawing | null {
  if (!(spread > 0)) return null;
  const r = spread / 2;
  const trunk = spread / 24;
  const cross = spread / 8;
  const lines = [
    [{ x: at.x - cross, y: at.y }, { x: at.x + cross, y: at.y }],
    [{ x: at.x, y: at.y - cross }, { x: at.x, y: at.y + cross }],
  ];
  if (style === "circle") return { outlines: [], lines, circles: [{ center: at, radius: r }, { center: at, radius: trunk }] };
  const outline: Pt[] = [];
  const n = CANOPY_LOBES * LOBE_STEPS;
  for (let i = 0; i < n; i++) {
    const phi = (2 * Math.PI * i) / n;
    const rho = r * (1 - LOBE_DEPTH + LOBE_DEPTH * Math.abs(Math.sin((CANOPY_LOBES * phi) / 2)));
    outline.push({ x: at.x + rho * Math.cos(phi), y: at.y + rho * Math.sin(phi) });
  }
  return { outlines: [outline], lines, circles: [{ center: at, radius: trunk }] };
}

/** Where a row of plants `spacing` apart stands on the line from `a` to `b`, both ends included when they fall on the spacing. Null for more than MAX_PLANTS. */
export function plantRow(a: Pt, b: Pt, spacing: number): Pt[] | null {
  const f = frame(a, b);
  if (!(spacing > 0)) return null;
  const n = Math.floor(f.len / spacing + 1e-9) + 1;
  if (n > MAX_PLANTS) return null;
  return Array.from({ length: n }, (_, k) => f.at(k * spacing, 0));
}

/**
 * A countersunk wood screw `diameter` thick from the side, its head at `a` and its point at `b`:
 * the head tapering from twice the diameter over half of it, the shank threaded from two fifths
 * of the way down (slanted crests a pitch of 0.45 × the diameter apart) to the point's 1.5
 * diameters. Null when shorter than three diameters.
 */
export function screwSide(a: Pt, b: Pt, diameter: number): Drawing | null {
  const f = frame(a, b);
  const d = diameter;
  if (!(d > 0) || f.len < 3 * d) return null;
  const at = f.at;
  const L = f.len;
  const point = L - 1.5 * d;
  const pitch = 0.45 * d;
  const lines: Pt[][] = [[at(0.5 * d, -d / 2), at(0.5 * d, d / 2)]];
  for (let s = Math.max(0.4 * L, 0.5 * d); s + pitch / 2 <= point; s += pitch) lines.push([at(s, -d / 2), at(s + pitch / 2, d / 2)]);
  return {
    outlines: [[at(0, -d), at(0, d), at(0.5 * d, d / 2), at(point, d / 2), at(L, 0), at(point, -d / 2), at(0.5 * d, -d / 2)]],
    lines,
    circles: [],
  };
}

/** A nail `diameter` thick from the side, its flat head (2.6 diameters across) at `a` and its point at `b`. Null when shorter than three diameters. */
export function nailSide(a: Pt, b: Pt, diameter: number): Drawing | null {
  const f = frame(a, b);
  const d = diameter;
  if (!(d > 0) || f.len < 3 * d) return null;
  const at = f.at;
  const L = f.len;
  const head = 0.3 * d;
  const w = 1.3 * d;
  const point = L - 1.2 * d;
  return {
    outlines: [[at(0, -w), at(0, w), at(head, w), at(head, d / 2), at(point, d / 2), at(L, 0), at(point, -d / 2), at(head, -d / 2), at(head, -w)]],
    lines: [],
    circles: [],
  };
}

/**
 * A wedge anchor `diameter` thick from the side, the rod's top at `a` and its tip at `b`: the rod's
 * end over a hex nut and a washer, the rod threaded under them, the expansion sleeve round it
 * (split along its middle) and the flared expander at its tip; each piece drawn where it shows.
 * Null when shorter than five diameters.
 */
export function anchorSide(a: Pt, b: Pt, diameter: number): Drawing | null {
  const f = frame(a, b);
  const d = diameter;
  if (!(d > 0) || f.len < 5 * d) return null;
  const at = f.at;
  const L = f.len;
  const rect = (s0: number, s1: number, half: number): Pt[] => [at(s0, -half), at(s1, -half), at(s1, half), at(s0, half)];
  const nut = (1.5 * d) / Math.cos(Math.PI / 6) / 2;
  const chamfer = 0.1 * d;
  const root = 0.85 * d;
  const sleeve = [L - 3.2 * d, L - 0.6 * d];
  const thread = Math.min(1.4 * d + 2.5 * d, sleeve[0]);
  return {
    outlines: [
      [at(0, -d / 2 + chamfer), at(chamfer, -d / 2), at(0.4 * d, -d / 2), at(0.4 * d, d / 2), at(chamfer, d / 2), at(0, d / 2 - chamfer)],
      rect(0.4 * d, 1.2 * d, nut),
      rect(1.2 * d, 1.4 * d, 1.1 * d),
      rect(1.4 * d, sleeve[0], d / 2),
      rect(sleeve[0], sleeve[1], 0.6 * d),
      [at(sleeve[1], -0.45 * d), at(L, -0.6 * d), at(L, 0.6 * d), at(sleeve[1], 0.45 * d)],
    ],
    lines: [
      [at(0.4 * d, -nut / 2), at(1.2 * d, -nut / 2)],
      [at(0.4 * d, nut / 2), at(1.2 * d, nut / 2)],
      [at(1.4 * d, -root / 2), at(thread, -root / 2)],
      [at(1.4 * d, root / 2), at(thread, root / 2)],
      [at(sleeve[0], 0), at(sleeve[1], 0)],
    ],
    circles: [],
  };
}

/** most dots one stipple places */
export const MAX_DOTS = 4000;

/**
 * Stipple dots in the rectangle with corners `a` and `b`, `perArea` dots per square unit on
 * average, placed by a seeded pseudo-random sequence (the same rectangle gives the same dots); a
 * gradient thins them from `a`'s side to none at `b`'s. Null for no area or more than MAX_DOTS.
 */
export function stippleDots(a: Pt, b: Pt, perArea: number, gradient: boolean): Pt[] | null {
  const w = b.x - a.x;
  const h = b.y - a.y;
  const n = Math.round(Math.abs(w * h) * perArea * (gradient ? 2 : 1));
  if (!(n > 0) || n > MAX_DOTS * (gradient ? 2 : 1)) return null;
  // mulberry32, seeded by the rectangle
  let seed = (Math.round(a.x * 7 + a.y * 13 + w * 17 + h * 19) | 0) >>> 0;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const dots: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const s = random();
    const t = random();
    // twice the candidates for a gradient, kept the more often the nearer a's side
    if (gradient && random() > 1 - s) continue;
    dots.push({ x: a.x + s * w, y: a.y + t * h });
  }
  return dots.length > 0 ? dots : null;
}
