// The Fastener tool's objects (Vectorworks' Fasteners tool set), in 2D: nuts (hex, hex jam,
// slotted hex and castle, square), plain washers and lock washers, in ASME inch, ASME metric, ISO
// or DIN sizes. Each stands on its bearing face, centred on the origin, axis up: from the front a
// hex nut shows three faces (across its corners) and a square nut two, from the side two and one
// (across their flats); Top looks down on it, two corners left and right, and Bottom up at it,
// mirrored. Chamfered ends are drawn as arcs where they cut the faces. Sizes are mm.

import type { Pt } from "../core/index.ts";
import { hexTop, prismFaces, type Chamfered } from "./nutShapes.ts";
import { arc, type FastenerDrawing } from "./rivetShapes.ts";

type Drawing = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; arcs: FastenerDrawing["arcs"][number][]; hidden: Pt[][] };

export type FastenerView = "front" | "side" | "top" | "bottom";

const ARC_STEPS = 32;
const O: Pt = { x: 0, y: 0 };
const empty = (): Drawing => ({ outlines: [], lines: [], circles: [], arcs: [], hidden: [] });

/** Centre lines: the axis from `beyond` below the bearing face to `beyond` above `top`, or across an end view `half` each way. */
function axis(d: Drawing, view: FastenerView, top: number, half: number, beyond: number | null): void {
  if (beyond === null) return;
  if (view === "top" || view === "bottom") d.lines.push([{ x: -half - beyond, y: 0 }, { x: half + beyond, y: 0 }], [{ x: 0, y: -half - beyond }, { x: 0, y: half + beyond }]);
  else d.lines.push([{ x: 0, y: -beyond }, { x: 0, y: top + beyond }]);
}

/** A tapped hole seen end on: the minor diameter's edge whole, the major diameter three quarters round (ISO 6410). */
function tapped(d: Drawing, major: number, minor: number): void {
  d.circles.push({ center: O, radius: minor / 2 });
  d.arcs.push({ center: O, radius: major / 2, start: 0, sweep: 270 });
}

// ---- nuts ------------------------------------------------------------------------------------

/** A nut: hex or square, its thread's major and minor diameters, across its flats, its height (a washer face's included), which ends are chamfered, a washer face under it, slots in its top. */
export interface NutBody {
  readonly shape: "hex" | "square";
  readonly major: number;
  readonly minor: number;
  readonly flats: number;
  readonly height: number;
  readonly chamfered: Chamfered;
  readonly washer: { readonly diameter: number; readonly height: number } | null;
  /** six slots `width` wide down to `floor` above the bearing face, cut in a round crown `crown` across if it has one */
  readonly slots: { readonly width: number; readonly floor: number; readonly crown: number | null } | null;
}

const sides = (n: NutBody): number => (n.shape === "hex" ? 6 : 4);
const cornersAcross = (n: NutBody): number => n.flats / Math.cos(Math.PI / sides(n));
/** how far the chamfers (to a circle 0.95 of the flats) drop a corner below the face */
const drop = (n: NutBody, height: number): number => Math.min(((cornersAcross(n) - 0.95 * n.flats) / 2) * Math.tan(Math.PI / 6), height / 4);

export function nutProblem(n: NutBody): string | null {
  if (!(n.minor < n.major && n.major < n.flats)) return "the thread must be smaller than the nut";
  if (n.washer && !(n.washer.height < n.height && n.washer.diameter <= cornersAcross(n))) return "the washer face must be lower than the nut and within its corners";
  if (n.slots && !(n.slots.floor > (n.washer?.height ?? 0) && n.slots.floor < n.height)) return "the slots must end within the nut";
  return null;
}

/** `top`, left to right, with notches `cuts` cut down to `floor` */
function notched(top: readonly Pt[], cuts: readonly { x0: number; x1: number }[], floor: number): Pt[] {
  const yAt = (x: number): number => {
    for (let i = 0; i + 1 < top.length; i++) {
      const [a, b] = [top[i], top[i + 1]];
      if (x >= a.x - 1e-9 && x <= b.x + 1e-9) return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
    return top[top.length - 1].y;
  };
  const sorted = cuts.map((c) => ({ x0: Math.max(c.x0, top[0].x), x1: Math.min(c.x1, top[top.length - 1].x) })).sort((a, b) => a.x0 - b.x0);
  const out: Pt[] = [];
  let k = 0;
  for (const p of top) {
    while (k < sorted.length && sorted[k].x0 <= p.x) {
      const c = sorted[k++];
      out.push({ x: c.x0, y: yAt(c.x0) }, { x: c.x0, y: floor }, { x: c.x1, y: floor }, { x: c.x1, y: yAt(c.x1) });
    }
    if (!sorted.some((c) => p.x > c.x0 - 1e-9 && p.x < c.x1 + 1e-9)) out.push(p);
  }
  return out;
}

/** The slots facing the viewer, as spans across the view: six, one on each flat, `radius` out, `width` wide. */
function slotSpans(view: "front" | "side", radius: number, width: number): { x0: number; x1: number }[] {
  const out: { x0: number; x1: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const phi = Math.PI / 6 + (i * Math.PI) / 3;
    // front looks from -y, side from +x
    const toward = view === "front" ? -Math.sin(phi) : Math.cos(phi);
    const across = view === "front" ? Math.cos(phi) : -Math.sin(phi);
    if (toward < 1e-6) continue;
    const c = radius * across;
    const w = (width * toward) / 2;
    out.push({ x0: c - w, x1: c + w });
  }
  return out;
}

/** A nut from the front, side, top or bottom. */
export function nut(n: NutBody, view: FastenerView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const G = cornersAcross(n);
  const base = n.washer?.height ?? 0;
  const crown = n.slots?.crown ?? null;
  // a castle nut's body ends where its slots do; the crown stands on it
  const bodyTop = crown !== null && n.slots ? n.slots.floor : n.height;
  const body = bodyTop - base;
  if (view === "top" || view === "bottom") {
    const R = G / 2;
    const polygon = n.shape === "hex" ? hexTop({ flats: n.flats, height: n.height }) : Array.from({ length: 4 }, (_, i) => ({ x: R * Math.cos((i * Math.PI) / 2), y: R * Math.sin((i * Math.PI) / 2) }));
    d.outlines.push(view === "bottom" ? polygon.map((p) => ({ x: p.x, y: -p.y })) : polygon);
    const chamferedHere = view === "top" ? n.chamfered !== "none" && crown === null : n.chamfered === "both" && !n.washer;
    if (chamferedHere) d.circles.push({ center: O, radius: (0.95 * n.flats) / 2 });
    if (view === "bottom" && n.washer) d.circles.push({ center: O, radius: n.washer.diameter / 2 });
    if (view === "top" && crown !== null) d.circles.push({ center: O, radius: crown / 2 });
    if (view === "top" && n.slots) {
      const out = (crown ?? n.flats) / 2;
      const w = n.slots.width / 2;
      for (let i = 0; i < 6; i++) {
        const phi = Math.PI / 6 + (i * Math.PI) / 3;
        const [u, v] = [{ x: Math.cos(phi), y: Math.sin(phi) }, { x: -Math.sin(phi), y: Math.cos(phi) }];
        for (const s of [-w, w]) {
          const r0 = Math.sqrt(Math.max(0, (n.major / 2) ** 2 - s * s));
          d.lines.push([{ x: u.x * r0 + v.x * s, y: u.y * r0 + v.y * s }, { x: u.x * out + v.x * s, y: u.y * out + v.y * s }]);
        }
      }
    }
    tapped(d, n.major, n.minor);
    axis(d, view, 0, G / 2, beyond);
    return d;
  }
  // a square, corners front and back as in its top view, shows the same two faces from the side
  const xs = n.shape === "hex" ? (view === "front" ? [-G / 2, -G / 4, G / 4, G / 2] : [-n.flats / 2, 0, n.flats / 2]) : [-G / 2, 0, G / 2];
  const chamfered: Chamfered = n.washer && n.chamfered === "both" ? "top" : n.chamfered;
  const f = prismFaces(xs, body, drop(n, body), chamfered);
  const lift = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: p.x, y: p.y + base }));
  const top = n.slots && crown === null ? notched(lift(f.top), slotSpans(view, n.flats / 2, n.slots.width), n.slots.floor) : lift(f.top);
  d.outlines.push([...lift(f.bottom), ...top.reverse()]);
  d.lines.push(...f.lines.map(lift));
  if (n.washer) {
    const w = n.washer.diameter / 2;
    d.outlines.push([{ x: -w, y: 0 }, { x: w, y: 0 }, { x: w, y: base }, { x: -w, y: base }]);
  }
  if (crown !== null && n.slots) {
    const r = crown / 2;
    const rim = notched([{ x: -r, y: n.height }, { x: r, y: n.height }], slotSpans(view, r, n.slots.width), bodyTop);
    d.outlines.push([{ x: -r, y: bodyTop }, ...rim, { x: r, y: bodyTop }]);
  }
  axis(d, view, n.height, xs[xs.length - 1], beyond);
  return d;
}

// ---- washers ---------------------------------------------------------------------------------

/** A plain washer: its hole, outside diameter and thickness. */
export interface PlainWasher {
  readonly inside: number;
  readonly outside: number;
  readonly thickness: number;
}

export function washerProblem(w: PlainWasher): string | null {
  if (!(w.inside > 0 && w.inside < w.outside)) return "the hole must be smaller than the washer";
  if (!(w.thickness > 0)) return "the washer must have a thickness";
  return null;
}

/** A plain washer from the front or side (alike: a band its thickness high, the hole hidden) or the top or bottom (two circles). */
export function plainWasher(w: PlainWasher, view: FastenerView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const R = w.outside / 2;
  if (view === "top" || view === "bottom") {
    d.circles.push({ center: O, radius: R }, { center: O, radius: w.inside / 2 });
    axis(d, view, 0, R, beyond);
    return d;
  }
  d.outlines.push([{ x: -R, y: 0 }, { x: R, y: 0 }, { x: R, y: w.thickness }, { x: -R, y: w.thickness }]);
  d.hidden.push([{ x: -w.inside / 2, y: 0 }, { x: -w.inside / 2, y: w.thickness }], [{ x: w.inside / 2, y: 0 }, { x: w.inside / 2, y: w.thickness }]);
  axis(d, view, w.thickness, R, beyond);
  return d;
}

/** A helical spring lock washer: its hole, outside diameter and section thickness. */
export type LockWasher = PlainWasher;

/** The split's gap across the ring, as a share of the section thickness */
const SPLIT = 0.5;

/**
 * A lock washer from the front (its split facing the viewer, a gap slanting through the band), the
 * side (a plain band) or the top or bottom (the ring cut through at the bottom, slanting the other
 * way seen from below).
 */
export function lockWasher(w: LockWasher, view: FastenerView, beyond: number | null): FastenerDrawing {
  const d = empty();
  const R = w.outside / 2;
  const r = w.inside / 2;
  const t = w.thickness;
  const gap = SPLIT * t;
  if (view === "top" || view === "bottom") {
    const s = view === "top" ? 1 : -1;
    // the split slants as the coil does: its outer end ahead of its inner by half the section
    const lean = (s * (R - r)) / 2;
    const at = (radius: number, x: number): number => -Math.PI / 2 + Math.asin(x / radius);
    const outer = arc(O, R, at(R, gap / 2 + lean), at(R, -gap / 2 + lean) + 2 * Math.PI, ARC_STEPS * 2);
    const inner = arc(O, r, at(r, -gap / 2) + 2 * Math.PI, at(r, gap / 2), ARC_STEPS * 2);
    d.outlines.push([...outer, ...inner]);
    axis(d, view, 0, R, beyond);
    return d;
  }
  if (view === "side") {
    d.outlines.push([{ x: -R, y: 0 }, { x: R, y: 0 }, { x: R, y: t }, { x: -R, y: t }]);
    axis(d, view, t, R, beyond);
    return d;
  }
  // from the front the split's two faces slant across the band, the gap between them
  const lean = t / 2;
  const left = [{ x: -gap / 2 - lean / 2, y: 0 }, { x: -gap / 2 + lean / 2, y: t }];
  const right = [{ x: gap / 2 - lean / 2, y: 0 }, { x: gap / 2 + lean / 2, y: t }];
  d.outlines.push([{ x: -R, y: 0 }, left[0], left[1], { x: -R, y: t }]);
  d.outlines.push([right[0], { x: R, y: 0 }, { x: R, y: t }, right[1]]);
  axis(d, view, t, R, beyond);
  return d;
}

export const lockProblem = (w: LockWasher): string | null => washerProblem(w) ?? (w.outside - w.inside < SPLIT * w.thickness ? "the washer is too narrow for its split" : null);

// ---- sizes -----------------------------------------------------------------------------------

export type FastenerStandard = "asmeInch" | "asmeMetric" | "iso" | "din";

/** A nut size: its thread's name and diameters, across its flats, its height, the washer face a washer-faced form stands on, its slots. */
export interface NutSize {
  readonly id: string;
  readonly major: number;
  readonly minor: number;
  readonly flats: number;
  readonly height: number;
  readonly face: { readonly diameter: number; readonly height: number } | null;
  readonly slots: NutBody["slots"];
}

/** A nut type of a standard: its shape and chamfers, whether it comes washer faced, its sizes. */
export interface NutType {
  readonly id: string;
  readonly label: string;
  readonly standard: string;
  readonly shape: NutBody["shape"];
  readonly chamfered: Chamfered;
  /** offered in a washer-faced form (ISO's Hex Style 1 and 2) */
  readonly forms: boolean;
  readonly sizes: readonly NutSize[];
}

/** A washer type or series of a standard and its sizes. */
export interface WasherType {
  readonly id: string;
  readonly label: string;
  readonly standard: string;
  readonly sizes: readonly (PlainWasher & { readonly id: string })[];
}

/** The nut a size and type make, washer faced if asked and the type comes so. */
export const nutBody = (t: NutType, s: NutSize, washerFace: boolean): NutBody => ({
  shape: t.shape,
  major: s.major,
  minor: s.minor,
  flats: s.flats,
  height: s.height,
  chamfered: t.chamfered,
  washer: washerFace && t.forms ? s.face : null,
  slots: s.slots,
});
