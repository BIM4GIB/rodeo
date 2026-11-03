// What the Furniture/Fixtures and Space Planning tools draw (tools/planning.ts), as plain geometry:
// a table with its chairs; a desk, shelving unit, clothes rod, bathtub or shower, grab bar,
// fireplace, row of toilet stalls, cabinet and compartment sink; a ceiling grid's tiles and a
// seating section's chairs; and a space's outline with where its label goes. Kept apart from the
// tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { pointInPolygon, signedArea } from "./geom.ts";
import { gridLines } from "./siteShapes.ts";

/** A chair in plan: its seat, and the back on the side away from the table. */
export interface Chair {
  readonly seat: Pt[];
  readonly back: Pt[];
}

export interface TableSet {
  readonly table: Pt[] | { readonly center: Pt; readonly radius: number };
  readonly chairs: Chair[];
}

/** a seat's width and depth, a back's thickness, mm */
const SEAT = 450;
const BACK = 60;
/** how far a seat's front edge reaches under the table's edge, mm */
const TUCK = 50;
/** each place's width along a table's edge, mm */
const PLACE = 600;
/** points round a round table's edge, as a polygon */
const ROUND_STEPS = 48;
/** most chairs round one table */
export const MAX_CHAIRS = 40;

/** A chair at `edge` on the table's edge facing back along `n` (pointing away from the table). */
function chair(edge: Pt, n: Pt): Chair {
  const t = { x: -n.y, y: n.x };
  const at = (out: number, side: number): Pt => ({ x: edge.x + n.x * out + t.x * side, y: edge.y + n.y * out + t.y * side });
  const rect = (o0: number, o1: number): Pt[] => [at(o0, -SEAT / 2), at(o1, -SEAT / 2), at(o1, SEAT / 2), at(o0, SEAT / 2)];
  return { seat: rect(-TUCK, SEAT - TUCK), back: rect(SEAT - TUCK, SEAT - TUCK + BACK) };
}

/**
 * A rectangular table `length` by `width` centred on the origin, its length along x, with as many
 * chairs along each long side as places fit (600 mm each, at least one), and one at each end when
 * `ends`. Null for a table too small for a chair or more than MAX_CHAIRS.
 */
export function rectTable(length: number, width: number, ends: boolean): TableSet | null {
  if (!(length > 0) || !(width > 0)) return null;
  const perSide = Math.max(1, Math.floor(length / PLACE));
  if (2 * perSide + (ends ? 2 : 0) > MAX_CHAIRS) return null;
  const chairs: Chair[] = [];
  for (let i = 0; i < perSide; i++) {
    const x = -length / 2 + (length * (i + 0.5)) / perSide;
    chairs.push(chair({ x, y: width / 2 }, { x: 0, y: 1 }), chair({ x, y: -width / 2 }, { x: 0, y: -1 }));
  }
  if (ends) chairs.push(chair({ x: length / 2, y: 0 }, { x: 1, y: 0 }), chair({ x: -length / 2, y: 0 }, { x: -1, y: 0 }));
  const l = length / 2;
  const w = width / 2;
  return { table: [{ x: -l, y: -w }, { x: l, y: -w }, { x: l, y: w }, { x: -l, y: w }], chairs };
}

/** A round table `diameter` across centred on the origin with `count` chairs evenly round it, the first on +x. Null for none or more than MAX_CHAIRS. */
export function roundTable(diameter: number, count: number): TableSet | null {
  if (!(diameter > 0) || !(count >= 1) || count > MAX_CHAIRS) return null;
  const r = diameter / 2;
  const chairs: Chair[] = [];
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count;
    const n = { x: Math.cos(a), y: Math.sin(a) };
    chairs.push(chair({ x: n.x * r, y: n.y * r }, n));
  }
  return { table: { center: { x: 0, y: 0 }, radius: r }, chairs };
}

/** A round table's edge as a polygon, for turning it with the rest. */
export function roundOutline(radius: number): Pt[] {
  return Array.from({ length: ROUND_STEPS }, (_, i) => {
    const a = (2 * Math.PI * i) / ROUND_STEPS;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
  });
}

// The fixtures below stand against a wall: each is drawn with its back on the x axis, its length
// along x centred on the origin, and its front toward −y.

/** The rectangle from (x0, y0) to (x1, y1), anticlockwise. */
function box(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** points round each rounded corner */
const CORNER_STEPS = 8;

/** The rectangle from (x0, y0) to (x1, y1) with its corners rounded to `r`, anticlockwise. */
function roundedBox(x0: number, y0: number, x1: number, y1: number, r: number): Pt[] {
  const corners = [
    { x: x1 - r, y: y0 + r, from: -Math.PI / 2 },
    { x: x1 - r, y: y1 - r, from: 0 },
    { x: x0 + r, y: y1 - r, from: Math.PI / 2 },
    { x: x0 + r, y: y0 + r, from: Math.PI },
  ];
  return corners.flatMap((c) =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, i) => {
      const a = c.from + (Math.PI / 2) * (i / CORNER_STEPS);
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    }),
  );
}

export type DeskConfig = "straight" | "left" | "right";

export interface DeskSet {
  readonly top: Pt[];
  readonly chair: Chair | null;
}

/**
 * A desk `width` by `depth`; a left or right return (as seen from the chair, facing the wall) runs
 * forward from that end of its front, `returnWidth` long and `returnDepth` across, the top drawn
 * as one L-shaped outline. The chair, when `withChair`, faces the middle of the front left open.
 * Null for a return as wide as the desk, or an open front narrower than a chair.
 */
export function desk(width: number, depth: number, config: DeskConfig, returnWidth: number, returnDepth: number, withChair: boolean): DeskSet | null {
  if (!(width > 0) || !(depth > 0)) return null;
  const l = width / 2;
  if (config === "straight") return { top: box(-l, -depth, l, 0), chair: withChair ? chair({ x: 0, y: -depth }, { x: 0, y: -1 }) : null };
  if (!(returnWidth > 0) || !(returnDepth > 0) || returnDepth >= width) return null;
  if (withChair && width - returnDepth < SEAT) return null;
  const front = -depth - returnWidth;
  const top =
    config === "left"
      ? [{ x: -l, y: front }, { x: -l + returnDepth, y: front }, { x: -l + returnDepth, y: -depth }, { x: l, y: -depth }, { x: l, y: 0 }, { x: -l, y: 0 }]
      : [{ x: l - returnDepth, y: front }, { x: l, y: front }, { x: l, y: 0 }, { x: -l, y: 0 }, { x: -l, y: -depth }, { x: l - returnDepth, y: -depth }];
  const open = config === "left" ? returnDepth / 2 : -returnDepth / 2;
  return { top, chair: withChair ? chair({ x: open, y: -depth }, { x: 0, y: -1 }) : null };
}

/**
 * A shelving unit `width` by `depth` as cut in plan: its shelf, its two sides and, when `back`,
 * its back, the panels `thickness` thick. Null when the panels leave no shelf.
 */
export function shelving(width: number, depth: number, thickness: number, back: boolean): Pt[][] | null {
  if (!(width > 0) || !(depth > 0) || !(thickness > 0) || 2 * thickness >= width || (back && thickness >= depth)) return null;
  const l = width / 2;
  const t = thickness;
  return [box(-l + t, -depth, l - t, back ? -t : 0), box(-l, -depth, -l + t, 0), box(l - t, -depth, l, 0), ...(back ? [box(-l + t, -t, l - t, 0)] : [])];
}

/**
 * A clothes rod `length` long, its centre line `rodFrom` out from the wall, under a shelf
 * `shelfDepth` deep when that's given. Null for a rod beyond the shelf's front.
 */
export function clothesRod(length: number, rodFrom: number, shelfDepth: number | null): { shelf: Pt[] | null; rod: [Pt, Pt] } | null {
  if (!(length > 0) || !(rodFrom > 0)) return null;
  if (shelfDepth !== null && !(shelfDepth > rodFrom)) return null;
  const l = length / 2;
  return {
    shelf: shelfDepth === null ? null : box(-l, -shelfDepth, l, 0),
    rod: [
      { x: -l, y: -rodFrom },
      { x: l, y: -rodFrom },
    ],
  };
}

export type BathKind = "tub" | "shower";

/** a drain's radius, mm (a 50 mm waste) */
export const DRAIN_RADIUS = 25;
/** most a tub's basin's corners are rounded, mm */
const BASIN_RADIUS = 150;

export interface BathSet {
  readonly outline: Pt[];
  readonly basin: Pt[];
  readonly drain: { readonly center: Pt; readonly radius: number };
  /** a shower tray's falls: lines from its basin's corners to the drain */
  readonly falls: [Pt, Pt][];
}

/**
 * A bathtub or a shower tray `width` by `depth`: its outline, and its basin `side` in from it. A
 * tub's basin has rounded corners and its drain `drainFrom` in from the basin's left end; a
 * shower's drain is in the middle, with falls to it from the basin's corners. Null when the sides
 * leave no basin or the drain doesn't fit in it.
 */
export function bath(kind: BathKind, width: number, depth: number, side: number, drainFrom: number): BathSet | null {
  if (!(width > 0) || !(depth > 0) || !(side > 0)) return null;
  const l = width / 2;
  const x0 = -l + side;
  const x1 = l - side;
  const y0 = -depth + side;
  const y1 = -side;
  if (x1 - x0 <= 2 * DRAIN_RADIUS || y1 - y0 <= 2 * DRAIN_RADIUS) return null;
  const outline = box(-l, -depth, l, 0);
  if (kind === "shower") {
    const center = { x: 0, y: -depth / 2 };
    const falls = box(x0, y0, x1, y1).map((c): [Pt, Pt] => {
      const d = Math.hypot(c.x - center.x, c.y - center.y);
      return [c, { x: center.x + ((c.x - center.x) * DRAIN_RADIUS) / d, y: center.y + ((c.y - center.y) * DRAIN_RADIUS) / d }];
    });
    return { outline, basin: box(x0, y0, x1, y1), drain: { center, radius: DRAIN_RADIUS }, falls };
  }
  if (!(drainFrom >= DRAIN_RADIUS) || drainFrom > x1 - x0 - DRAIN_RADIUS) return null;
  const r = Math.min(BASIN_RADIUS, (x1 - x0) / 2, (y1 - y0) / 2);
  return { outline, basin: roundedBox(x0, y0, x1, y1, r), drain: { center: { x: x0 + drainFrom, y: (y0 + y1) / 2 }, radius: DRAIN_RADIUS }, falls: [] };
}

/** a grab bar's flange plates' width and thickness, mm */
const FLANGE = 75;
const FLANGE_THICK = 10;

/**
 * A grab bar `length` long overall and `diameter` thick, `clearance` out from the wall, its ends
 * turning back to the wall: its outline, and a flange plate on the wall at each end. Null when the
 * ends would meet.
 */
export function grabBar(length: number, diameter: number, clearance: number): { bar: Pt[]; flanges: Pt[][] } | null {
  if (!(length > 0) || !(diameter > 0) || !(clearance > 0) || 2 * diameter >= length) return null;
  const l = length / 2;
  const d = diameter;
  const out = -clearance - d;
  const bar = [
    { x: -l, y: 0 },
    { x: -l, y: out },
    { x: l, y: out },
    { x: l, y: 0 },
    { x: l - d, y: 0 },
    { x: l - d, y: -clearance },
    { x: -l + d, y: -clearance },
    { x: -l + d, y: 0 },
  ];
  const flange = (x: number): Pt[] => box(x - FLANGE / 2, -FLANGE_THICK, x + FLANGE / 2, 0);
  return { bar, flanges: [flange(-l + d / 2), flange(l - d / 2)] };
}

/**
 * A fireplace `width` across its front and `rearWidth` across its back (on the wall), `depth` deep:
 * its outline; its firebox, `openingWidth` across at the front and `fireboxDepth` deep, its back
 * narrowed as the unit narrows; and, when `flue` is given, the top flue's circle `flue.diameter`
 * across, its centre `flue.offset` in from the back. Null when the opening, firebox or flue doesn't
 * fit inside the unit.
 */
export function fireplace(
  width: number,
  rearWidth: number,
  depth: number,
  openingWidth: number,
  fireboxDepth: number,
  flue: { readonly diameter: number; readonly offset: number } | null,
): { outline: Pt[]; firebox: Pt[]; flue: { center: Pt; radius: number } | null } | null {
  if (!(width > 0) || !(rearWidth > 0) || !(depth > 0) || !(openingWidth > 0) || !(fireboxDepth > 0)) return null;
  if (openingWidth >= width || fireboxDepth >= depth) return null;
  const taper = rearWidth / width;
  const backWidth = openingWidth * taper;
  // the firebox's back sits inside the unit's sides at its depth
  const sideAt = (y: number): number => (width + ((rearWidth - width) * (y + depth)) / depth) / 2;
  const backY = -depth + fireboxDepth;
  if (backWidth / 2 >= sideAt(backY)) return null;
  const outline = [
    { x: -width / 2, y: -depth },
    { x: width / 2, y: -depth },
    { x: rearWidth / 2, y: 0 },
    { x: -rearWidth / 2, y: 0 },
  ];
  const firebox = [
    { x: -openingWidth / 2, y: -depth },
    { x: openingWidth / 2, y: -depth },
    { x: backWidth / 2, y: backY },
    { x: -backWidth / 2, y: backY },
  ];
  if (!flue) return { outline, firebox, flue: null };
  const r = flue.diameter / 2;
  if (!(r > 0) || !(flue.offset >= r) || flue.offset + r > depth || r >= sideAt(-flue.offset)) return null;
  return { outline, firebox, flue: { center: { x: 0, y: -flue.offset }, radius: r } };
}

export type DoorSwing = "in" | "out";

/** most stalls in one row */
export const MAX_TOILET_STALLS = 20;
/** a toilet's tank (width, depth) and bowl (half-width, half-length), mm */
const TANK = { w: 460, d: 200 };
const BOWL = { rx: 180, ry: 230 };
/** a wheelchair turning circle's radius, mm (60 in across) */
const TURNING_RADIUS = 762;

export interface StallOptions {
  readonly count: number;
  readonly width: number;
  readonly depth: number;
  readonly thickness: number;
  readonly left: boolean;
  readonly dividing: boolean;
  readonly right: boolean;
  readonly front: boolean;
  /** each stall's door, in its front partition */
  readonly door: { readonly width: number; readonly offset: number; readonly swing: DoorSwing } | null;
  readonly fixture: boolean;
  readonly turningCircle: boolean;
}

export interface StallSet {
  /** the partitions, and the front's pieces either side of each door */
  readonly panels: Pt[][];
  /** each door leaf drawn open, its swing from `hinge`, degrees anticlockwise from +x */
  readonly doors: { readonly leaf: Pt[]; readonly hinge: Pt; readonly radius: number; readonly start: number; readonly sweep: number }[];
  /** each toilet's tank and bowl */
  readonly fixtures: Pt[][];
  readonly circles: { readonly center: Pt; readonly radius: number }[];
}

/**
 * A row of `count` toilet stalls each `width` wide and `depth` deep, their back on the wall: the
 * partitions (`thickness` thick, centred on the lines between stalls, the outer ones and those
 * between set apart), the front partition with a door `door.offset` in from each stall's left
 * partition, swinging in or out from its left jamb; a toilet against the back wall in each
 * stall's middle; and a turning circle in each. Null when a door doesn't fit its stall's front,
 * the stall is too shallow for its toilet, or a turning circle doesn't fit.
 */
export function toiletStalls(o: StallOptions): StallSet | null {
  const { count, width: w, depth: d, thickness: t } = o;
  if (!(count >= 1) || count > MAX_TOILET_STALLS || !(w > 0) || !(d > 0) || !(t > 0) || t >= w) return null;
  if (o.fixture && (w < TANK.w + t || d < TANK.d + 2 * BOWL.ry + t)) return null;
  if (o.turningCircle && (w < 2 * TURNING_RADIUS + t || d < 2 * TURNING_RADIUS + t)) return null;
  const door = o.front ? o.door : null;
  if (door && (!(door.width > 0) || !(door.offset >= 0) || t / 2 + door.offset + door.width > w - t / 2)) return null;
  const x0 = (-count * w) / 2;
  const panels: Pt[][] = [];
  for (let k = 0; k <= count; k++) {
    const on = k === 0 ? o.left : k === count ? o.right : o.dividing;
    const x = x0 + k * w;
    if (on) panels.push(box(x - t / 2, -d, x + t / 2, 0));
  }
  const doors: StallSet["doors"][number][] = [];
  const fixtures: Pt[][] = [];
  const circles: StallSet["circles"][number][] = [];
  for (let i = 0; i < count; i++) {
    const a = x0 + i * w + t / 2;
    const b = x0 + (i + 1) * w - t / 2;
    if (o.front) {
      if (!door) panels.push(box(a, -d - t / 2, b, -d + t / 2));
      else {
        const hinge = a + door.offset;
        const end = hinge + door.width;
        if (hinge > a) panels.push(box(a, -d - t / 2, hinge, -d + t / 2));
        if (end < b) panels.push(box(end, -d - t / 2, b, -d + t / 2));
        const inward = door.swing === "in";
        doors.push({
          leaf: inward ? box(hinge, -d, hinge + t, -d + door.width) : box(hinge, -d - door.width, hinge + t, -d),
          hinge: { x: hinge, y: -d },
          radius: door.width,
          start: inward ? 0 : -90,
          sweep: 90,
        });
      }
    }
    const cx = (a + b) / 2;
    if (o.fixture) {
      const cy = -TANK.d - BOWL.ry;
      const bowl = Array.from({ length: ROUND_STEPS }, (_, j) => {
        const ang = (2 * Math.PI * j) / ROUND_STEPS;
        return { x: cx + BOWL.rx * Math.cos(ang), y: cy + BOWL.ry * Math.sin(ang) };
      });
      fixtures.push(box(cx - TANK.w / 2, -TANK.d, cx + TANK.w / 2, 0), bowl);
    }
    if (o.turningCircle) circles.push({ center: { x: cx, y: -d / 2 }, radius: TURNING_RADIUS });
  }
  return { panels, doors, fixtures, circles };
}

export type CabinetKind = "base" | "utility" | "wall";

export interface CabinetSet {
  readonly carcass: Pt[];
  /** a utility cabinet's two diagonals, a wall cabinet's one */
  readonly lines: [Pt, Pt][];
  readonly counter: Pt[] | null;
  readonly splash: Pt[] | null;
}

/**
 * A cabinet `length` by `depth`: its carcass; a base cabinet's counter, when given, reaching
 * `overhang` past its front, with a backsplash `splash` thick along the back when that's given;
 * a utility (tall) cabinet crossed corner to corner, a wall cabinet with one diagonal (Rodeo's
 * marks, since a blank drawing has no dashed line type to show a wall cabinet above the cut).
 * Null when the backsplash is as deep as the counter.
 */
export function cabinet(
  kind: CabinetKind,
  length: number,
  depth: number,
  counter: { readonly overhang: number; readonly splash: number | null } | null,
): CabinetSet | null {
  if (!(length > 0) || !(depth > 0)) return null;
  const l = length / 2;
  const carcass = box(-l, -depth, l, 0);
  const [a, b, c, d] = carcass;
  if (kind === "utility") return { carcass, lines: [[a, c], [b, d]], counter: null, splash: null };
  if (kind === "wall") return { carcass, lines: [[d, b]], counter: null, splash: null };
  if (!counter) return { carcass, lines: [], counter: null, splash: null };
  const front = -depth - Math.max(0, counter.overhang);
  if (counter.splash !== null && !(counter.splash > 0 && counter.splash < -front)) return null;
  return { carcass, lines: [], counter: box(-l, front, l, 0), splash: counter.splash === null ? null : box(-l, -counter.splash, l, 0) };
}

/** A compartment sink's settings, in millimetres. */
export interface CompartmentSink {
  readonly length: number;
  /** the counter's depth, back to front */
  readonly width: number;
  /** the counter's rolled front and ends */
  readonly edge: number;
  readonly splash: number;
  /** 0 for none */
  readonly bowls: number;
  readonly bowlLength: number;
  readonly bowlWidth: number;
  readonly bowlRadius: number;
  /** the bowls' offsets from the middle of the counter, to the right and toward the back */
  readonly offsetLength: number;
  readonly offsetWidth: number;
  readonly between: number;
}

export interface CompartmentSinkSet {
  readonly counter: Pt[];
  readonly rim: Pt[] | null;
  readonly splash: Pt[] | null;
  readonly bowls: Pt[][];
  readonly drains: Pt[];
}

/**
 * A compartment sink: its counter `length` by `width`, the rolled edge's inner line `edge` in from
 * its front and ends, a backsplash `splash` thick along the back, and a row of bowls (corners
 * rounded) `between` apart, centred in front of the splash and moved by the offsets, each with a
 * drain at its middle. Null when the bowls don't fit inside the edge and in front of the splash.
 */
export function compartmentSink(s: CompartmentSink): CompartmentSinkSet | null {
  if (!(s.length > 0) || !(s.width > 0) || !(s.edge >= 0) || !(s.splash >= 0) || s.edge + s.splash >= s.width || 2 * s.edge >= s.length) return null;
  const l = s.length / 2;
  const counter = box(-l, -s.width, l, 0);
  const rim = s.edge > 0 ? box(-l + s.edge, -s.width + s.edge, l - s.edge, -s.splash) : null;
  const splash = s.splash > 0 ? box(-l, -s.splash, l, 0) : null;
  const n = Math.round(s.bowls);
  if (n <= 0) return { counter, rim, splash, bowls: [], drains: [] };
  if (!(s.bowlLength > 2 * DRAIN_RADIUS) || !(s.bowlWidth > 2 * DRAIN_RADIUS) || !(s.between >= 0) || !(s.bowlRadius >= 0)) return null;
  const row = n * s.bowlLength + (n - 1) * s.between;
  const x0 = s.offsetLength - row / 2;
  const yc = (-s.width - s.splash) / 2 + s.offsetWidth;
  const tol = 1e-6;
  if (x0 < -l + s.edge - tol || x0 + row > l - s.edge + tol || yc - s.bowlWidth / 2 < -s.width + s.edge - tol || yc + s.bowlWidth / 2 > -s.splash + tol) return null;
  const r = Math.min(s.bowlRadius, s.bowlLength / 2, s.bowlWidth / 2);
  const bowls: Pt[][] = [];
  const drains: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * (s.bowlLength + s.between);
    bowls.push(r > 0 ? roundedBox(a, yc - s.bowlWidth / 2, a + s.bowlLength, yc + s.bowlWidth / 2, r) : box(a, yc - s.bowlWidth / 2, a + s.bowlLength, yc + s.bowlWidth / 2));
    drains.push({ x: a + s.bowlLength / 2, y: yc });
  }
  return { counter, rim, splash, bowls, drains };
}

/** how far inside the outline a seat's corner may lie on it, mm */
const EDGE_TOLERANCE = 0.01;
/** most seats one seating section places */
export const MAX_SEATS = 2000;

export type SeatAlignment = "align" | "offset";

/**
 * A seating section from its outline's corners: the outline anticlockwise and its chairs, in rows
 * square to `facing` (radians, the way the seats look), each `rowSpacing` behind the one in front
 * (front edge to front edge), the first at the outline's front. Along a row the seats are
 * `seatSpacing` apart centre to centre, centred on the outline's middle, every other row shifted
 * half a seat when "offset". A seat is placed where its seat and back lie inside the outline.
 * Null without area, for spacings closer than a chair, or more than MAX_SEATS seats.
 */
export function seatingSection(
  corners: readonly Pt[],
  facing: number,
  seatSpacing: number,
  rowSpacing: number,
  alignment: SeatAlignment,
): { outline: Pt[]; chairs: Chair[] } | null {
  if (corners.length < 3 || !(seatSpacing >= SEAT) || !(rowSpacing >= SEAT + BACK)) return null;
  const signed = signedArea(corners);
  if (Math.abs(signed) < 1e-9) return null;
  const outline = signed > 0 ? [...corners] : [...corners].reverse();
  const f = { x: Math.cos(facing), y: Math.sin(facing) };
  // along a row, and the way to a seat's back
  const u = { x: -f.y, y: f.x };
  const n = { x: -f.x, y: -f.y };
  const fs = outline.map((p) => p.x * f.x + p.y * f.y);
  const us = outline.map((p) => p.x * u.x + p.y * u.y);
  const front = Math.max(...fs);
  const back = Math.min(...fs);
  const mid = (Math.min(...us) + Math.max(...us)) / 2;
  const half = (Math.max(...us) - Math.min(...us)) / 2;
  const rows = Math.floor((front - back - SEAT - BACK) / rowSpacing + 1e-9) + 1;
  const across = Math.ceil(half / seatSpacing) + 1;
  if (rows < 1) return { outline, chairs: [] };
  if (rows * (2 * across + 1) > 50 * MAX_SEATS) return null;
  // corners pulled a hair toward the middle, so a seat whose edge lies on the outline counts as inside
  const inside = (pts: readonly Pt[]): boolean => {
    const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
    const cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
    return pts.every((p) => {
      const d = Math.hypot(p.x - cx, p.y - cy) || 1;
      return pointInPolygon({ x: p.x + ((cx - p.x) * EDGE_TOLERANCE) / d, y: p.y + ((cy - p.y) * EDGE_TOLERANCE) / d }, outline);
    });
  };
  const chairs: Chair[] = [];
  for (let r = 0; r < rows; r++) {
    const along = front - r * rowSpacing;
    const shift = alignment === "offset" && r % 2 === 1 ? seatSpacing / 2 : 0;
    for (let j = -across; j <= across; j++) {
      const at = mid + shift + j * seatSpacing;
      const p = { x: f.x * along + u.x * at, y: f.y * along + u.y * at };
      const c = chair({ x: p.x + n.x * TUCK, y: p.y + n.y * TUCK }, n);
      if (!inside(c.seat) || !inside(c.back)) continue;
      chairs.push(c);
      if (chairs.length > MAX_SEATS) return null;
    }
  }
  return { outline, chairs };
}

/**
 * A ceiling grid from its outline's corners: the outline anticlockwise, and the lines between
 * tiles `width` by `length`, turned `angle` radians, with a tile centred on the outline's middle
 * (its bounding box's, square to the tiles) when `centred`, else laid from the drawing's origin.
 * Null without area or with more lines than a hardscape draws.
 */
export function ceilingGrid(corners: readonly Pt[], width: number, length: number, angle: number, centred: boolean): { outline: Pt[]; lines: [Pt, Pt][] } | null {
  if (corners.length < 3 || !(width > 0) || !(length > 0)) return null;
  const signed = signedArea(corners);
  if (Math.abs(signed) < 1e-9) return null;
  const outline = signed > 0 ? [...corners] : [...corners].reverse();
  let origin: Pt = { x: 0, y: 0 };
  if (centred) {
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -u.y, y: u.x };
    const us = outline.map((p) => p.x * u.x + p.y * u.y);
    const vs = outline.map((p) => p.x * v.x + p.y * v.y);
    // a grid line half a tile from the middle each way, so a tile sits on it
    const mu = (Math.min(...us) + Math.max(...us)) / 2 + width / 2;
    const mv = (Math.min(...vs) + Math.max(...vs)) / 2 + length / 2;
    origin = { x: u.x * mu + v.x * mv, y: u.y * mu + v.y * mv };
  }
  const lines = gridLines(outline, width, length, angle, origin);
  return lines ? { outline, lines } : null;
}

/** A space from its corners: the outline anticlockwise, its area, and the point its label sits on (the outline's centroid). Null for fewer than three corners or no area. */
export function spaceOf(corners: readonly Pt[]): { outline: Pt[]; area: number; labelAt: Pt } | null {
  if (corners.length < 3) return null;
  const signed = signedArea(corners);
  if (Math.abs(signed) < 1e-9) return null;
  const outline = signed > 0 ? [...corners] : [...corners].reverse();
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  const area = Math.abs(signed);
  return { outline, area, labelAt: { x: cx / (6 * area), y: cy / (6 * area) } };
}
