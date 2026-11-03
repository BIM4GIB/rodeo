// Roller chains and their sprockets: standard ANSI (B29.1) and ISO (606, B series) chain sizes,
// sprocket teeth in the ISO 606 tooth form, chains drawn from the side as their link plates and
// pins, and an offset link from the side or above. Pure geometry in mm, centred on the origin (a
// chain starts there and runs right).

import type { Pt } from "../core/index.ts";
import { empty, wheelFront, wheelProblem, wheelSide, type Wheel } from "./gearShapes.ts";
import type { HoleDrawing } from "./machineShapes.ts";

export interface ChainSize {
  readonly id: string;
  readonly label: string;
  /** mm */
  readonly pitch: number;
  /** the roller's diameter (a bushing's, for ANSI 25 and 35) */
  readonly roller: number;
  /** the width between the inner plates */
  readonly width: number;
  /** a link plate's height */
  readonly plate: number;
  /** the distance between strands of a multi-strand chain */
  readonly transverse: number;
}

const inch = (id: string, pitch: number, roller: number, width: number, plate: number, transverse: number): ChainSize => ({
  id: `ansi${id}`,
  label: `ANSI ${id} (${pitch}")`,
  pitch: pitch * 25.4,
  roller: roller * 25.4,
  width: width * 25.4,
  plate: plate * 25.4,
  transverse: transverse * 25.4,
});
const metric = (id: string, pitch: number, roller: number, width: number, plate: number, transverse: number): ChainSize => ({
  id: `iso${id}`,
  label: `ISO ${id} (${pitch} mm)`,
  pitch,
  roller,
  width,
  plate,
  transverse,
});

/** Chain sizes from ANSI B29.1 and ISO 606 (B series) catalogue tables. */
export const CHAINS: readonly ChainSize[] = [
  inch("25", 0.25, 0.13, 0.125, 0.237, 0.252),
  inch("35", 0.375, 0.2, 0.188, 0.356, 0.399),
  inch("40", 0.5, 0.312, 0.312, 0.472, 0.566),
  inch("50", 0.625, 0.4, 0.375, 0.591, 0.713),
  inch("60", 0.75, 0.469, 0.5, 0.713, 0.897),
  inch("80", 1, 0.625, 0.625, 0.949, 1.153),
  inch("100", 1.25, 0.75, 0.75, 1.185, 1.409),
  inch("120", 1.5, 0.875, 1, 1.425, 1.789),
  inch("140", 1.75, 1, 1, 1.663, 1.924),
  inch("160", 2, 1.125, 1.25, 1.899, 2.305),
  metric("06B", 9.525, 6.35, 5.72, 8.26, 10.24),
  metric("08B", 12.7, 8.51, 7.75, 11.81, 13.92),
  metric("10B", 15.875, 10.16, 9.65, 14.73, 16.59),
  metric("12B", 19.05, 12.07, 11.68, 16.13, 19.46),
  metric("16B", 25.4, 15.88, 17.02, 21.08, 31.88),
  metric("20B", 31.75, 19.05, 19.56, 26.42, 36.45),
  metric("24B", 38.1, 25.4, 25.4, 33.4, 48.36),
];

/** fewest and most teeth a sprocket may have; most strands; most links a chain may have */
export const MIN_SPROCKET_TEETH = 6;
export const MAX_SPROCKET_TEETH = 150;
export const MAX_ROWS = 8;
export const MAX_LINKS = 2000;
/** points along a seating curve, a flank and a tip */
const SEAT_STEPS = 8;
const FLANK_STEPS = 6;
const TIP_STEPS = 3;
/** points round each end of a link plate */
const PLATE_STEPS = 10;
/** a pin's diameter, as a share of the roller's */
const PIN_SHARE = 0.5;
/** a plate's height at its waist, as a share of its height */
const WAIST = 0.86;

/** A sprocket's pitch diameter: the circle its rollers' centres sit on. */
export function sprocketPitchDiameter(chain: ChainSize, teeth: number): number {
  return chain.pitch / Math.sin(Math.PI / teeth);
}

/** A sprocket's tip diameter, ISO 606's midway one: how far its teeth reach. */
export function sprocketTipDiameter(chain: ChainSize, teeth: number): number {
  return toothForm(chain, teeth).tip;
}

/** ISO 606's tooth sizes for `teeth` teeth, each midway between its least and most: the tip and root diameters, and the seating and flank radii and seating angle. */
function toothForm(chain: ChainSize, teeth: number): { tip: number; root: number; seat: number; flank: number; seatAngle: number } {
  const d = sprocketPitchDiameter(chain, teeth);
  const d1 = chain.roller;
  const p = chain.pitch;
  return {
    tip: d - d1 + p * (1.125 - 0.8 / teeth),
    root: d - d1,
    seat: 0.505 * d1 + 0.0345 * Math.cbrt(d1),
    flank: (0.12 * d1 * (teeth + 2) + 0.008 * d1 * (teeth * teeth + 180)) / 2,
    seatAngle: ((130 - 90 / teeth) * Math.PI) / 180,
  };
}

/** Where the circle about `c` of radius `r` meets the circle about the origin of radius `R`; the meeting nearer `near`, or null. */
function meetOrigin(c: Pt, r: number, R: number, near: Pt): Pt | null {
  const dd = Math.hypot(c.x, c.y);
  if (!(dd > 0) || dd > R + r || dd < Math.abs(R - r)) return null;
  const a = (R * R - r * r + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const ux = c.x / dd;
  const uy = c.y / dd;
  const m = { x: ux * a, y: uy * a };
  const p1 = { x: m.x - uy * h, y: m.y + ux * h };
  const p2 = { x: m.x + uy * h, y: m.y - ux * h };
  return Math.hypot(p1.x - near.x, p1.y - near.y) <= Math.hypot(p2.x - near.x, p2.y - near.y) ? p1 : p2;
}

/** Points along the arc about `c` from `from` to `to`, the shorter way round, ends included. */
function arcBetween(c: Pt, from: Pt, to: Pt, steps: number): Pt[] {
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  let sweep = Math.atan2(to.y - c.y, to.x - c.x) - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + (sweep * i) / steps), y: c.y + r * Math.sin(a0 + (sweep * i) / steps) }));
}

/** A sprocket's outline in the ISO 606 tooth form, a gap to the right (so a circular chain round the same centre sits in its seats): round each gap, the flank, the roller's seat and the other flank, the tips between. */
function sprocketOutline(chain: ChainSize, teeth: number): Pt[] {
  const f = toothForm(chain, teeth);
  const rp = sprocketPitchDiameter(chain, teeth) / 2;
  const ra = f.tip / 2;
  const pts: Pt[] = [];
  let lastTip: number | null = null;
  for (let k = 0; k < teeth; k++) {
    const at = (2 * Math.PI * k) / teeth;
    const c = { x: rp * Math.cos(at), y: rp * Math.sin(at) };
    const inward = at + Math.PI;
    const seatEnd = (side: number): Pt => ({ x: c.x + f.seat * Math.cos(inward + (side * f.seatAngle) / 2), y: c.y + f.seat * Math.sin(inward + (side * f.seatAngle) / 2) });
    // the seat's clockwise end is turned anticlockwise about the roller, being on the gap's far side from it
    const cw = seatEnd(1);
    const ccw = seatEnd(-1);
    // each flank bends about a centre on the far side of the roller, so it meets the seat smoothly
    const flankCentre = (j: Pt): Pt => ({ x: c.x + ((j.x - c.x) / f.seat) * (f.seat - f.flank), y: c.y + ((j.y - c.y) / f.seat) * (f.seat - f.flank) });
    const cwCentre = flankCentre(cw);
    const ccwCentre = flankCentre(ccw);
    const cwTop = meetOrigin(cwCentre, f.flank, ra, cw) ?? { x: (cw.x / Math.hypot(cw.x, cw.y)) * ra, y: (cw.y / Math.hypot(cw.x, cw.y)) * ra };
    const ccwTop = meetOrigin(ccwCentre, f.flank, ra, ccw) ?? { x: (ccw.x / Math.hypot(ccw.x, ccw.y)) * ra, y: (ccw.y / Math.hypot(ccw.x, ccw.y)) * ra };
    const topAngle = Math.atan2(cwTop.y, cwTop.x);
    if (lastTip !== null) {
      let span = topAngle - lastTip;
      while (span < 0) span += 2 * Math.PI;
      while (span > 2 * Math.PI) span -= 2 * Math.PI;
      // past a half turn the flanks crossed: the tooth comes to a point
      if (span < Math.PI) for (let i = 1; i < TIP_STEPS; i++) pts.push({ x: ra * Math.cos(lastTip + (span * i) / TIP_STEPS), y: ra * Math.sin(lastTip + (span * i) / TIP_STEPS) });
    }
    pts.push(...arcBetween(cwCentre, cwTop, cw, FLANK_STEPS));
    // the seat, under a half turn, runs round the roller's inner side
    pts.push(...arcBetween(c, cw, ccw, SEAT_STEPS).slice(1, -1));
    pts.push(...arcBetween(ccwCentre, ccw, ccwTop, FLANK_STEPS));
    lastTip = Math.atan2(ccwTop.y, ccwTop.x);
  }
  // the tip from the last gap round to the first
  const first = pts[0];
  if (lastTip !== null) {
    let span = Math.atan2(first.y, first.x) - lastTip;
    while (span < 0) span += 2 * Math.PI;
    if (span < Math.PI) for (let i = 1; i < TIP_STEPS; i++) pts.push({ x: ra * Math.cos(lastTip + (span * i) / TIP_STEPS), y: ra * Math.sin(lastTip + (span * i) / TIP_STEPS) });
  }
  return pts;
}

export type SprocketView = "front" | "side";

export interface Sprocket extends Wheel {
  readonly chain: ChainSize;
  readonly teeth: number;
  readonly rows: number;
  /** each row of teeth's width, and the distance between rows' middles */
  readonly toothWidth: number;
  readonly spacing: number;
}

/** A sprocket's standard tooth width for its chain and rows, as ANSI B29.1 gives it: 0.93, 0.91 or 0.88 times the chain's inner width, less 0.006". */
export function standardToothWidth(chain: ChainSize, rows: number): number {
  const share = rows === 1 ? 0.93 : rows <= 3 ? 0.91 : 0.88;
  return share * chain.width - 0.006 * 25.4;
}

/** The width of a sprocket's toothed rim: its rows of teeth side by side. */
export function sprocketWidth(s: { toothWidth: number; spacing: number; rows: number }): number {
  return (s.rows - 1) * s.spacing + s.toothWidth;
}

/** Why `s` can't be drawn, or null when it can. */
export function sprocketProblem(s: Sprocket): string | null {
  if (!Number.isInteger(s.teeth) || s.teeth < MIN_SPROCKET_TEETH || s.teeth > MAX_SPROCKET_TEETH) return `a sprocket has ${MIN_SPROCKET_TEETH} to ${MAX_SPROCKET_TEETH} teeth`;
  if (!Number.isInteger(s.rows) || s.rows < 1 || s.rows > MAX_ROWS) return `a sprocket has 1 to ${MAX_ROWS} rows of teeth`;
  if (!(s.toothWidth > 0) || (s.rows > 1 && !(s.spacing > s.toothWidth))) return "its rows of teeth must be wider than nothing and spaced wider than they are";
  return wheelProblem(s, toothForm(s.chain, s.teeth).root);
}

/** A sprocket seen down its axis: its teeth, and the hub, bore, recess and holes as a gear's; centre lines and the pitch circle with `beyond`. */
export function sprocketFront(s: Sprocket, beyond: number | null): HoleDrawing {
  const f = toothForm(s.chain, s.teeth);
  return wheelFront(s, sprocketOutline(s.chain, s.teeth), sprocketPitchDiameter(s.chain, s.teeth), f.tip, beyond, false);
}

/** A sprocket cut through its axis: the body to its root circle as a gear's, and each row of teeth on it out to the tips. */
export function sprocketSide(s: Sprocket, beyond: number | null): HoleDrawing {
  const f = toothForm(s.chain, s.teeth);
  const d = wheelSide(s, f.root, sprocketPitchDiameter(s.chain, s.teeth), beyond);
  const first = -s.faceWidth / 2 + s.toothWidth / 2;
  for (let i = 0; i < s.rows; i++) {
    const x = first + i * s.spacing;
    for (const sign of [1, -1]) {
      const r0 = (sign * f.root) / 2;
      const r1 = (sign * f.tip) / 2;
      d.lines.push([
        { x: x - s.toothWidth / 2, y: r0 },
        { x: x - s.toothWidth / 2, y: r1 },
        { x: x + s.toothWidth / 2, y: r1 },
        { x: x + s.toothWidth / 2, y: r0 },
      ]);
    }
  }
  return d;
}

/** A link plate between pins `a` and `b`, `height` tall, its ends round about the pins and its waist drawn in. */
function plate(a: Pt, b: Pt, height: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const v = { x: -u.y, y: u.x };
  const r = height / 2;
  // each end runs a little past a half circle, so the sides dip to the waist
  const lean = (15 * Math.PI) / 180;
  const at = (o: Pt, t: number): Pt => ({ x: o.x + r * (Math.cos(t) * u.x + Math.sin(t) * v.x), y: o.y + r * (Math.cos(t) * u.y + Math.sin(t) * v.y) });
  const pts: Pt[] = [];
  for (let i = 0; i <= PLATE_STEPS; i++) pts.push(at(b, -Math.PI / 2 - lean + ((Math.PI + 2 * lean) * i) / PLATE_STEPS));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  pts.push({ x: mid.x + v.x * r * WAIST, y: mid.y + v.y * r * WAIST });
  for (let i = 0; i <= PLATE_STEPS; i++) pts.push(at(a, Math.PI / 2 - lean + ((Math.PI + 2 * lean) * i) / PLATE_STEPS));
  pts.push({ x: mid.x - v.x * r * WAIST, y: mid.y - v.y * r * WAIST });
  return pts;
}

/**
 * A chain seen from the side through `pins` (each link from one to the next): the roller links'
 * inner plates, then the pin links' outer plates over them, alternating from the first (a pin link
 * when `startPin`), and a pin at every joint.
 */
function chainThrough(chain: ChainSize, pins: readonly Pt[], startPin: boolean): HoleDrawing {
  const d = empty();
  const links = chainLinks(chain, pins, startPin);
  for (const l of links) if (!l.pin) d.outlines.push(l.plate);
  for (const l of links) if (l.pin) d.outlines.push(l.plate);
  for (const p of pins) d.circles.push({ center: p, radius: (chain.roller * PIN_SHARE) / 2 });
  return d;
}

/** Each link from one pin to the next: its plate's outline, and whether it's a pin link (outer plates) or a roller link (inner). */
export function chainLinks(chain: ChainSize, pins: readonly Pt[], startPin: boolean): { plate: Pt[]; pin: boolean }[] {
  return pins.slice(1).map((b, i) => ({ plate: plate(pins[i], b, chain.plate), pin: (i % 2 === 0) === startPin }));
}

/** The pins of a straight chain `links` links long, from the origin to the right. */
export function linearPins(chain: ChainSize, links: number): Pt[] {
  return Array.from({ length: links + 1 }, (_, i) => ({ x: i * chain.pitch, y: 0 }));
}

/** The pins of a chain `links` links round a sprocket of `teeth` teeth (at most a whole turn), on its pitch circle. */
export function circularPins(chain: ChainSize, teeth: number, links: number, startAngle: number, clockwise: boolean): Pt[] {
  const r = sprocketPitchDiameter(chain, teeth) / 2;
  const step = ((clockwise ? -2 : 2) * Math.PI) / teeth;
  const n = Math.min(links, teeth);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: r * Math.cos(startAngle + i * step), y: r * Math.sin(startAngle + i * step) }));
}

/** A straight roller chain `links` links long, from the origin to the right. */
export function linearChain(chain: ChainSize, links: number, startPin: boolean): HoleDrawing {
  return chainThrough(chain, linearPins(chain, links), startPin);
}

/**
 * A roller chain wrapped round a sprocket of `teeth` teeth centred on the origin: `links` links (at
 * most a whole turn) from `startAngle` (radians), anticlockwise or clockwise, pins on the pitch
 * circle.
 */
export function circularChain(chain: ChainSize, teeth: number, links: number, startAngle: number, clockwise: boolean, startPin: boolean): HoleDrawing {
  return chainThrough(chain, circularPins(chain, teeth, links, startAngle, clockwise), startPin);
}

/** An offset link's plate thickness: a strand's share of the room between strands, past its inner width. */
export const plateThickness = (chain: ChainSize): number => (chain.transverse - chain.width) / 4;

/**
 * An offset link from the side, from its roller end at the origin to its pin end a pitch to the
 * right: its cranked plate, the bushing's end, and the pin with its cotter across it; with `beyond`,
 * the line through its joints and across each.
 */
export function offsetLinkSide(chain: ChainSize, beyond: number | null): HoleDrawing {
  const d = empty();
  const p = chain.pitch;
  const pin = chain.roller * PIN_SHARE;
  d.outlines.push(plate({ x: 0, y: 0 }, { x: p, y: 0 }, chain.plate));
  d.circles.push({ center: { x: 0, y: 0 }, radius: (chain.roller * (1 + PIN_SHARE)) / 4 }, { center: { x: p, y: 0 }, radius: pin / 2 });
  d.outlines.push([
    { x: p - 0.65 * pin, y: -0.15 * pin },
    { x: p + 0.65 * pin, y: -0.15 * pin },
    { x: p + 0.65 * pin, y: 0.15 * pin },
    { x: p - 0.65 * pin, y: 0.15 * pin },
  ]);
  if (beyond !== null) {
    const r = chain.plate / 2;
    d.lines.push([{ x: -r - beyond, y: 0 }, { x: p + r + beyond, y: 0 }], [{ x: 0, y: -r - beyond }, { x: 0, y: r + beyond }], [{ x: p, y: -r - beyond }, { x: p, y: r + beyond }]);
  }
  return d;
}

/**
 * An offset link from above, the same way along: its two plates cranked from the inner width at the
 * roller end to outside an inner link's plates at the pin end, the roller between them, and the pin
 * through the wide end, its head below and its cotter above; with `beyond`, the line along the link
 * and through each joint.
 */
export function offsetLinkTop(chain: ChainSize, beyond: number | null): HoleDrawing {
  const d = empty();
  const p = chain.pitch;
  const t = plateThickness(chain);
  const w = chain.width / 2;
  const e = chain.plate / 2;
  const pin = chain.roller * PIN_SHARE;
  for (const s of [1, -1]) {
    d.outlines.push(
      [
        { x: -e, y: w },
        { x: 0.4 * p, y: w },
        { x: 0.6 * p, y: w + t },
        { x: p + e, y: w + t },
        { x: p + e, y: w + 2 * t },
        { x: 0.6 * p, y: w + 2 * t },
        { x: 0.4 * p, y: w + t },
        { x: -e, y: w + t },
      ].map((q) => ({ x: q.x, y: s * q.y })),
    );
  }
  const r = chain.roller / 2;
  d.outlines.push([
    { x: -r, y: -w },
    { x: r, y: -w },
    { x: r, y: w },
    { x: -r, y: w },
  ]);
  const head = w + 2.6 * t;
  const tail = w + 3.8 * t;
  d.outlines.push([
    { x: p - pin / 2, y: -head },
    { x: p + pin / 2, y: -head },
    { x: p + pin / 2, y: tail },
    { x: p - pin / 2, y: tail },
  ]);
  const cotter = w + 3 * t;
  d.outlines.push([
    { x: p - 0.75 * pin, y: cotter - 0.25 * t },
    { x: p + 0.75 * pin, y: cotter - 0.25 * t },
    { x: p + 0.75 * pin, y: cotter + 0.25 * t },
    { x: p - 0.75 * pin, y: cotter + 0.25 * t },
  ]);
  if (beyond !== null) {
    d.lines.push([{ x: -e - beyond, y: 0 }, { x: p + e + beyond, y: 0 }], [{ x: 0, y: -head - beyond }, { x: 0, y: tail + beyond }], [{ x: p, y: -head - beyond }, { x: p, y: tail + beyond }]);
  }
  return d;
}
