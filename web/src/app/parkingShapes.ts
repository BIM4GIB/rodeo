// What Site Planning's Parking Along Path and Parking Area draw (tools/paths.ts), as plain
// geometry. Along a path: square stalls either side of each straight run, their dividers, the line
// along their far ends, and the path itself. In an area: double rows of stalls back to back about
// a header stripe, at the space angle, with a lane between rows, laid square to the row angle and
// kept where they fit inside the outline. Both number their stalls. Kept apart from the tools so it
// runs without the page.

import type { Pt } from "../core/index.ts";
import { pointInPolygon } from "./geom.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";
import { prism, type Solid } from "./solids3d.ts";

export interface AlongPath {
  readonly width: number;
  readonly length: number;
  readonly left: boolean;
  readonly right: boolean;
  readonly numbering: boolean;
  readonly startAt: number;
}

export interface Area {
  /** degrees the header stripes run at, counter-clockwise from level */
  readonly rowAngle: number;
  readonly lane: number;
  readonly width: number;
  readonly length: number;
  /** degrees between a stall and its stripe, over 0 and up to 90 */
  readonly spaceAngle: number;
  readonly stripe: boolean;
  readonly perimeter: boolean;
  readonly numbering: boolean;
  readonly startAt: number;
}

/** what parking draws, and how many stalls */
export interface ParkingPlan extends MarkerDrawing {
  readonly stalls: number;
}

/** stalls a parking object draws at most, so a tiny stall in a large area can't stall the page */
export const MAX_PARKING_STALLS = 2000;

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const turn = (p: Pt, angle: number): Pt => ({ x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) });

/** Text turned `angle` radians, as degrees the right way up. */
export function upright(angle: number): number {
  const deg = (((angle * 180) / Math.PI) % 360 + 360) % 360;
  return deg > 90 && deg <= 270 ? deg - 180 : deg;
}

/**
 * Stalls along a path of straight runs (closed: back round to its start), `width` along it and
 * `length` out from it, on its left (the way it's drawn) and its right as asked. Where it turns
 * towards a side, that side's stalls start and stop short of the corner by as much as they'd
 * overlap; where it turns away, a wedge is left. Each run's stalls are centred in the room it has.
 * Numbered from `startAt`, the left side first, each in the path's order, text `h` high. A message
 * when nothing fits.
 */
export function parkingAlongPath(path: readonly Pt[], closed: boolean, p: AlongPath, h: number): ParkingPlan | string {
  const pts = path.filter((q, i) => i === 0 || q.x !== path[i - 1].x || q.y !== path[i - 1].y);
  if (closed && pts.length > 1 && pts[0].x === pts.at(-1)!.x && pts[0].y === pts.at(-1)!.y) pts.pop();
  if (pts.length < 2 || !(p.width > 0 && p.length > 0)) return "Draw a path of two corners or more, with Space Width and Space Length over 0.";
  if (!p.left && !p.right) return "Choose Spaces on Left of Poly or Spaces on Right of Poly in Preferences.";
  const runs = closed ? pts.length : pts.length - 1;
  const at = (i: number): Pt => pts[((i % pts.length) + pts.length) % pts.length];
  /** how far the path turns left (positive) or right at corner `i`, radians; 0 at an open path's ends */
  const bend = (i: number): number => {
    if (!closed && (i === 0 || i === pts.length - 1)) return 0;
    const d0 = sub(at(i), at(i - 1));
    const d1 = sub(at(i + 1), at(i));
    return Math.atan2(cross(d0, d1), d0.x * d1.x + d0.y * d1.y);
  };
  const lines: Pt[][] = [closed ? [...pts, pts[0]] : [...pts]];
  const texts: MarkerText[] = [];
  const centres: { side: number; run: number; at: Pt; angle: number }[] = [];
  for (const side of [1, -1]) {
    if ((side === 1 && !p.left) || (side === -1 && !p.right)) continue;
    for (let r = 0; r < runs; r++) {
      const a = at(r);
      const b = at(r + 1);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const out = { x: -u.y * side, y: u.x * side };
      // a corner turning towards this side brings the neighbouring run's stalls over these
      const inset = (angle: number): number => (angle * side > 0 ? p.length * Math.tan(Math.min(Math.abs(angle), Math.PI * 0.499) / 2) : 0);
      const from = inset(bend(r));
      const room = len - from - inset(bend(r + 1));
      const n = Math.floor(room / p.width + 1e-9);
      if (n < 1) continue;
      const start = from + (room - n * p.width) / 2;
      const foot = (k: number): Pt => add(a, u, start + k * p.width);
      for (let k = 0; k <= n; k++) lines.push([foot(k), add(foot(k), out, p.length)]);
      lines.push([add(foot(0), out, p.length), add(foot(n), out, p.length)]);
      for (let k = 0; k < n; k++) centres.push({ side, run: r, at: add(add(foot(k), u, p.width / 2), out, p.length / 2), angle: Math.atan2(u.y, u.x) });
    }
  }
  if (centres.length === 0) return "No space fits along this path: draw longer runs, or set a narrower Space Width.";
  if (centres.length > MAX_PARKING_STALLS) return `This path would hold more than ${MAX_PARKING_STALLS} spaces: set a wider Space Width.`;
  if (p.numbering) centres.forEach((c, i) => texts.push({ at: c.at, text: String(Math.round(p.startAt) + i), height: h, justify: "centre", angle: upright(c.angle) }));
  return { outlines: [], lines, circles: [], filled: [], texts, stalls: centres.length };
}

/** Where the level line at height `y` crosses the outline's edges, left to right. */
function crossings(outline: readonly Pt[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a.y > y === b.y > y) continue;
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs.sort((p, q) => p - q);
}

/** Whether the segment from `a` to `b` crosses an edge of the outline. */
function crossesOutline(a: Pt, b: Pt, outline: readonly Pt[]): boolean {
  const d = sub(b, a);
  for (let i = 0; i < outline.length; i++) {
    const c = outline[i];
    const e = sub(outline[(i + 1) % outline.length], c);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(sub(c, a), e) / den;
    const s = cross(sub(c, a), d) / den;
    if (t > 1e-9 && t < 1 - 1e-9 && s > 1e-9 && s < 1 - 1e-9) return true;
  }
  return false;
}

/**
 * A parking area inside a closed outline: double rows of stalls back to back about header stripes
 * running at the row angle, lanes between them and along the area's two sides the rows face, as
 * many double rows as fit, centred across the area. A stall is `width` wide and `length` long at
 * the space angle to its stripe (the rows on both sides of a stripe lean the same way, as one
 * line through it); stalls are laid along each stripe from the area's end and kept where they fit
 * inside the outline. Numbered from `startAt` left to right and top to bottom, text `h` high. A
 * message when nothing fits.
 */
export function parkingArea(outline: readonly Pt[], p: Area, h: number): ParkingPlan | string {
  if (outline.length < 3) return "Draw the parking area's outline with three corners or more.";
  const a = (Math.min(90, Math.max(0, p.spaceAngle)) * Math.PI) / 180;
  if (!(p.width > 0 && p.length > 0 && p.lane >= 0 && a > 0)) return "Set Space Width, Space Length and a Space Angle over 0 in Preferences.";
  const rot = (p.rowAngle * Math.PI) / 180;
  // in the rows' own terms: stripes level, origin at the outline's first corner
  const origin = outline[0];
  const local = outline.map((q) => turn(sub(q, origin), -rot));
  const ys = local.map((q) => q.y);
  const xs = local.map((q) => q.x);
  const [minY, maxY, minX, maxX] = [Math.min(...ys), Math.max(...ys), Math.min(...xs), Math.max(...xs)];
  const depth = p.length * Math.sin(a);
  const lean = p.length * Math.cos(a);
  const pitch = p.width / Math.sin(a);
  const module = 2 * depth + p.lane;
  const rows = Math.floor((maxY - minY - p.lane) / module + 1e-9);
  if (rows < 1) return "The area isn't deep enough for a double row of spaces and lanes either side: draw it deeper, or set a shorter Space Length or Lane Width.";
  const first = minY + (maxY - minY - (rows * module + p.lane)) / 2 + p.lane + depth;
  const inside = (corners: Pt[]): boolean =>
    corners.every((c) => pointInPolygon(c, local)) && corners.every((c, i) => !crossesOutline(c, corners[(i + 1) % corners.length], local)) && !local.some((v) => pointInPolygon(v, corners));
  const back = (pt: Pt): Pt => add(origin, turn(pt, rot));

  const lines: Pt[][] = [];
  const stalls: { row: number; x: number; centre: Pt }[] = [];
  const dividers = new Set<string>();
  for (let j = 0; j < rows; j++) {
    const y = first + j * module;
    let kept = 0;
    // the upper row leans forward from the stripe, the lower one back, so each divider is one line through it
    for (const up of [1, -1]) {
      const reach = { x: up * lean, y: up * depth };
      for (let k = Math.floor((minX - lean - minX) / pitch) - 1; minX + k * pitch <= maxX + lean; k++) {
        const x0 = minX + k * pitch;
        const corners = [{ x: x0, y }, { x: x0 + pitch, y }, add({ x: x0 + pitch, y }, reach), add({ x: x0, y }, reach)];
        if (!inside(corners)) continue;
        kept++;
        stalls.push({ row: 2 * j + (up === 1 ? 1 : 0), x: x0, centre: add({ x: x0 + pitch / 2, y }, reach, 0.5) });
        for (const xd of [x0, x0 + pitch]) {
          const key = `${j}:${up}:${Math.round(xd * 1000)}`;
          if (dividers.has(key)) continue;
          dividers.add(key);
          lines.push([back({ x: xd, y }), back(add({ x: xd, y }, reach))]);
        }
        if (stalls.length > MAX_PARKING_STALLS) return `This area would hold more than ${MAX_PARKING_STALLS} spaces: set a wider Space Width.`;
      }
    }
    if (p.stripe && kept > 0) {
      const cuts = crossings(local, y);
      for (let i = 0; i + 1 < cuts.length; i += 2) lines.push([back({ x: cuts[i], y }), back({ x: cuts[i + 1], y })]);
    }
  }
  if (stalls.length === 0) return "No space fits inside this outline: draw it larger, or set smaller spaces in Preferences.";
  const texts: MarkerText[] = [];
  if (p.numbering) {
    // top row first, each left to right
    stalls.sort((s, t) => t.row - s.row || s.x - t.x);
    stalls.forEach((s, i) => texts.push({ at: back(s.centre), text: String(Math.round(p.startAt) + i), height: h, justify: "centre", angle: upright(rot) }));
  }
  return { outlines: p.perimeter ? [[...outline]] : [], lines, circles: [], filled: [], texts, stalls: stalls.length };
}

// ---- Parking Spaces --------------------------------------------------------------------------

export type SpaceStyle = "single" | "double" | "parallel";
export type AisleSide = "left" | "right" | "both";
export type AisleFill = "none" | "solid" | "stripes";

/** Vectorworks' Parking Spaces object: a row of stalls, or two back to back, along a header stripe. */
export interface ParkingSpaces {
  readonly style: SpaceStyle;
  /** standard spaces in a row */
  readonly count: number;
  readonly width: number;
  /** along each stall; a parallel space's along the curb */
  readonly length: number;
  /** degrees from the header stripe; parallel spaces ignore it */
  readonly angle: number;
  /** the header stays square to each stall, in a sawtooth, instead of straight */
  readonly angledHeader: boolean;
  /** accessible spaces in a row */
  readonly accessible: number;
  readonly accessibleWidth: number;
  readonly accessibleAtEnd: boolean;
  readonly accessibleSymbol: boolean;
  readonly aisles: boolean;
  readonly aisleWidth: number;
  readonly aisleSide: AisleSide;
  readonly aisleFill: AisleFill;
  readonly header: boolean;
  readonly startStripe: boolean;
  readonly endStripe: boolean;
  readonly numbering: boolean;
  readonly startAt: number;
  readonly bumpers: boolean;
}

export interface ParkingSpacesPlan {
  /** the header, each divider */
  readonly stripes: readonly Pt[][];
  /** an aisle's outline each, for its fill */
  readonly aisles: readonly Pt[][];
  /** the stripes across an aisle */
  readonly hatch: readonly Pt[][];
  readonly bumpers: readonly Pt[][];
  /** the accessible symbols, as filled pieces */
  readonly symbols: readonly Pt[][];
  /** each number's place, left to right, the upper row first */
  readonly numbers: readonly { readonly at: Pt; readonly text: string }[];
  readonly stalls: number;
}

interface Cell {
  readonly kind: "stall" | "accessible" | "aisle";
  /** square to the stall */
  readonly width: number;
  /** along the stall */
  readonly depth: number;
}

/** how high a painted stripe and a bumper stand */
const STRIPE_HIGH = 5;
const BUMPER_HIGH = 120;
/** a bumper's place back from the header, its length as a part of the stall's width and its thickness, all at most */
const BUMPER_BACK = 600;
const BUMPER_LENGTH = 0.7;
const BUMPER_THICK = 150;
/** across an aisle, the distance between its stripes */
const HATCH_STEP = 500;

const flip = (p: Pt): Pt => ({ x: p.x, y: -p.y });

/** The stalls and aisles of one row, its beginning first. */
function rowCells(p: ParkingSpaces): Cell[] {
  const parallel = p.style === "parallel";
  // a parallel space's Length runs along the curb, and its Width (an accessible one's too) out from it
  const cell = (kind: Cell["kind"], width: number): Cell => (parallel ? { kind, width: kind === "aisle" ? width : p.length, depth: kind === "aisle" ? p.width : width } : { kind, width, depth: p.length });
  const aisle = (): Cell[] => (p.aisles ? [cell("aisle", p.aisleWidth)] : []);
  const access = Array.from({ length: p.accessible }, (): Cell[] => [
    ...(p.aisleSide !== "right" ? aisle() : []),
    cell("accessible", p.accessibleWidth),
    ...(p.aisleSide !== "left" ? aisle() : []),
  ]).flat();
  const standard = Array.from({ length: p.count }, () => cell("stall", p.width));
  return p.accessibleAtEnd ? [...standard, ...access] : [...access, ...standard];
}

/** The international symbol of access, as filled pieces in a unit square from (0, 0), its head towards +y. */
function accessPieces(): Pt[][] {
  const stroke = (path: readonly Pt[], w: number): Pt[] => {
    const side = (k: 1 | -1): Pt[] =>
      path.map((q, i) => {
        const a = path[Math.max(0, i - 1)];
        const b = path[Math.min(path.length - 1, i + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: q.x - (k * (b.y - a.y) * w) / (2 * len), y: q.y + (k * (b.x - a.x) * w) / (2 * len) };
      });
    return [...side(1), ...side(-1).reverse()];
  };
  const round = (c: Pt, r: number, from: number, to: number, n: number): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    });
  return [
    round({ x: 0.4, y: 0.88 }, 0.09, 0, 345, 15),
    stroke([{ x: 0.4, y: 0.76 }, { x: 0.45, y: 0.44 }, { x: 0.72, y: 0.44 }, { x: 0.86, y: 0.12 }, { x: 0.98, y: 0.17 }], 0.085),
    stroke([{ x: 0.42, y: 0.63 }, { x: 0.66, y: 0.63 }], 0.07),
    stroke(round({ x: 0.4, y: 0.32 }, 0.27, 105, 345, 20), 0.07),
  ];
}

/**
 * The row or rows in the object's own coordinates: its header stripe along x from (0, 0), the lower
 * row below it (a single bay's or a parallel row's only one) and a double bay's upper row mirroring
 * it. A number stands at each stall's middle. A message when its sizes don't work.
 */
export function parkingSpaces(p: ParkingSpaces): ParkingSpacesPlan | string {
  if (!(p.width > 0 && p.length > 0)) return "its spaces need a width and a length";
  if (p.count < 0 || p.accessible < 0 || p.count + p.accessible < 1) return "it needs a space";
  if (p.accessible > 0 && !(p.accessibleWidth > 0)) return "its accessible spaces need a width";
  if (p.accessible > 0 && p.aisles && !(p.aisleWidth > 0)) return "its aisles need a width";
  const parallel = p.style === "parallel";
  if (!parallel && !(p.angle > 0 && p.angle <= 90)) return "its Space Angle must be more than 0° and at most 90°";
  const cells = rowCells(p);
  if (cells.length * (p.style === "double" ? 2 : 1) > MAX_PARKING_STALLS) return `it can draw at most ${MAX_PARKING_STALLS} spaces`;
  const a = parallel ? Math.PI / 2 : (p.angle * Math.PI) / 180;
  const sin = Math.sin(a);
  const cos = Math.abs(Math.cos(a)) < 1e-9 ? 0 : Math.cos(a);
  const d = { x: cos, y: -sin };
  const u = { x: sin, y: cos };
  const angled = p.angledHeader && !parallel;
  // an angled header's teeth meet the other row's at y = 0, instead of running through them
  const y = angled && p.style === "double" ? -Math.max(...cells.map((c) => c.width * cos)) : 0;
  let x = 0;
  const heads = cells.map((c) => {
    const at = { x, y };
    x += c.width / sin;
    return at;
  });
  const end = { x, y };
  // where each stall's head reaches: the next one's divider, where the header's angled, or simply its neighbour
  const corner = cells.map((c, i): Pt => (angled ? add(heads[i], u, c.width) : (heads[i + 1] ?? end)));
  const stripes: Pt[][] = [];
  const aisles: Pt[][] = [];
  const hatch: Pt[][] = [];
  const bumpers: Pt[][] = [];
  const places: { at: Pt; middle: Pt; up: Pt; kind: Cell["kind"]; size: number }[] = [];
  const header = angled ? [heads[0], ...corner.flatMap((c, i) => (i + 1 < cells.length ? [c, heads[i + 1]] : [c]))] : [heads[0], end];
  cells.forEach((c, i) => {
    const left = heads[i];
    const across = sub(corner[i], left);
    if (i === 0 && p.startStripe) stripes.push([left, add(left, d, c.depth)]);
    const last = i === cells.length - 1;
    if (!last) stripes.push([corner[i], add(heads[i + 1], d, Math.max(c.depth, cells[i + 1].depth))]);
    else if (p.endStripe) stripes.push([corner[i], add(corner[i], d, c.depth)]);
    if (c.kind === "aisle") {
      aisles.push([left, corner[i], add(corner[i], d, c.depth), add(left, d, c.depth)]);
      if (p.aisleFill === "stripes") {
        const w = Math.hypot(across.x, across.y);
        for (let k = HATCH_STEP; k < w + c.depth; k += HATCH_STEP) {
          const on = (s: number, t: number): Pt => add(add(left, across, s / w), d, t);
          hatch.push([on(Math.min(k, w), k - Math.min(k, w)), on(k - Math.min(k, c.depth), Math.min(k, c.depth))]);
        }
      }
      return;
    }
    const middle = add(left, across, 0.5);
    places.push({ at: add(middle, d, 0.5 * c.depth), middle, up: { x: -d.x, y: -d.y }, kind: c.kind, size: Math.min(c.width, c.depth) });
    if (p.bumpers && !parallel) {
      const half = (c.width * BUMPER_LENGTH) / 2;
      const thick = Math.min(BUMPER_THICK, c.depth / 8) / 2;
      // clear of a straight header, however the stall leans
      const clear = angled ? 0 : (half * cos) / sin + thick;
      const back = add(middle, d, Math.min(Math.max(BUMPER_BACK, clear), c.depth / 2));
      const q = (s: number, t: number): Pt => add(add(back, u, s), d, t);
      bumpers.push([q(-half, -thick), q(half, -thick), q(half, thick), q(-half, thick)]);
    }
  });
  const double = p.style === "double";
  const both = <T>(row: readonly T[], f: (t: T) => T): T[] => (double ? [...row.map(f), ...row] : [...row]);
  const line = (pts: Pt[]): Pt[] => pts.map(flip);
  const places2 = both(places, (s) => ({ ...s, at: flip(s.at), middle: flip(s.middle), up: flip(s.up) }));
  const pieces = accessPieces();
  const symbols = !p.accessibleSymbol
    ? []
    : places2.flatMap((s) => {
        if (s.kind !== "accessible") return [];
        const size = 0.6 * s.size;
        const right = { x: s.up.y, y: -s.up.x };
        return pieces.map((piece) => piece.map((q) => add(add(s.at, right, (q.x - 0.5) * size), s.up, (q.y - 0.5) * size)));
      });
  // a symbol takes a stall's middle, so its number goes further out
  const numbered = (s: (typeof places2)[number]): Pt => (p.accessibleSymbol && s.kind === "accessible" ? add(s.at, s.up, -0.35 * s.size) : s.at);
  return {
    // a straight header is both rows' at once
    stripes: [...(p.header ? (angled && double ? [line(header), header] : [header]) : []), ...both(stripes, line)],
    aisles: both(aisles, line),
    hatch: both(hatch, line),
    bumpers: both(bumpers, line),
    symbols,
    numbers: p.numbering ? places2.map((s, i) => ({ at: numbered(s), text: String(Math.round(p.startAt) + i) })) : [],
    stalls: places2.length,
  };
}

/** What Show 3D Stripes shows: the stripes painted flat on the layer and bumpers standing on it, as a solid in the object's coordinates. */
export function parkingSpacesSolid(plan: ParkingSpacesPlan, stripeWidth: number): Solid {
  const segment = (a: Pt, b: Pt): Solid => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return [];
    const n = { x: (-(b.y - a.y) / len) * (stripeWidth / 2), y: ((b.x - a.x) / len) * (stripeWidth / 2) };
    return prism([[add(a, n), add(b, n), add(b, n, -1), add(a, n, -1)]], 0, STRIPE_HIGH);
  };
  return [...plan.stripes.flatMap((l) => l.slice(1).flatMap((q, i) => segment(l[i], q))), ...plan.bumpers.flatMap((o) => prism([o], 0, BUMPER_HIGH))];
}
