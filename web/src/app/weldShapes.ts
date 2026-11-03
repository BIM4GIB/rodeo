// What Dims/Notes' Welding Sym- tools (tools/welding.ts) draw, as plain geometry: AWS A2.4's and
// ISO 2553's welding symbol, a reference line with the arrow from its end to the joint, and on the
// arrow side, the other side or both the weld's symbol with its sizes before it, its lengths and
// pitch after it and its root opening, angle or count beyond it; a finish contour and method; ISO's
// dashed identification line; weld all around, a field weld flag and a tail with a note. Vectorworks
// shows the symbols only as pictures in its help (Annotation1/Welding_symbols.htm and the five pages
// under it), so the proportions are Rodeo's reading of those and of the standards' symbols. Kept
// apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";
import { CHAR_WIDTH, type MarkerDrawing, type MarkerText } from "./markerShapes.ts";

export type WeldStandard = "aws" | "iso";
export type FinishContour = "none" | "flush" | "convex" | "concave";
/** Unspecified, or the letter for chipping, grinding, hammering, machining or rolling */
export type FinishMethod = "U" | "C" | "G" | "H" | "M" | "R";
export type GrooveSymbol =
  | "none"
  | "bevel"
  | "flareBevel"
  | "flareV"
  | "scarf"
  | "square"
  | "j"
  | "u"
  | "v"
  | "back"
  | "meltThrough"
  | "backing"
  | "backingRemove"
  | "insert";

/** The weld's symbol on its side of the reference line. */
export type WeldGlyph =
  | { readonly kind: "fillet" }
  | { readonly kind: "groove"; readonly symbol: GrooveSymbol }
  | { readonly kind: "flange"; readonly corner: boolean }
  | { readonly kind: "spot" | "seam" | "stud" | "surfacing" }
  | { readonly kind: "plug" | "slot"; readonly filling: string };

/** What one side of the reference line says. */
export interface WeldSideData {
  readonly glyph: WeldGlyph;
  /** before the symbol, the first level with its middle and the rest on away from the line */
  readonly before: readonly string[];
  /** after the symbol in a row, level with the first of `before`; ISO's stagger mark goes between the first two */
  readonly after: readonly string[];
  /** beyond the symbol, away from the line, the first nearest it */
  readonly beyond: readonly string[];
  readonly contour: FinishContour;
  readonly method: FinishMethod;
  /** a flange weld's complete joint penetration: a melt-through mark on the line's far side */
  readonly penetration?: boolean;
}

/**
 * Where the sides go. AWS: the arrow side below the line, the other side above. ISO: symmetrical
 * welds on the line both ways; otherwise the arrow side on the continuous line, below or above it,
 * and the other side on a dashed identification line the other way.
 */
export type WeldLayout = "aws" | "symmetrical" | "arrowBelow" | "arrowAbove";
export type FieldFlag = "topRight" | "topLeft" | "bottomRight" | "bottomLeft";

export interface WeldingSymbol {
  readonly standard: WeldStandard;
  readonly layout: WeldLayout;
  readonly arrowSide: WeldSideData | null;
  readonly otherSide: WeldSideData | null;
  /** a symbol across the line, neither side's (a spot, seam or stud weld with no side significance) */
  readonly across: WeldSideData | null;
  /** intermittent welds staggered: AWS moves the other side along; ISO marks it with a Z */
  readonly stagger: boolean;
  readonly arrowhead: boolean;
  readonly allAround: boolean;
  readonly field: FieldFlag | null;
  /** the tail's note, a line each; no tail when null */
  readonly reference: readonly string[] | null;
}

/** room between texts and what they sit beside, as a share of the text height */
const GAP = 0.35;
/** a text line's step, as a share of its height */
const LEADING = 1.2;
/** ISO's dashed identification line, off the continuous line, as a share of the text height */
const DASH_OFF = 0.4;
/** a dash and the gap after it, as shares of the symbol size */
const DASH = 0.6;
const DASH_GAP = 0.3;
/** points along a drawn arc */
const ARC_STEPS = 12;

const P = (x: number, y: number): Pt => ({ x, y });

/** How wide `text` runs at height `h`. */
const textWidth = (text: string, h: number): number => text.length * CHAR_WIDTH * h;

/** A glyph's width along the line and its reach away from it, at symbol size `s`. */
function glyphSize(g: WeldGlyph, s: number): { w: number; reach: number } {
  switch (g.kind) {
    case "fillet":
      return { w: s, reach: s };
    case "flange":
      return { w: 0.9 * s, reach: s };
    case "spot":
    case "stud":
      return { w: 0.8 * s, reach: 0.8 * s };
    case "seam":
      return { w: 1.1 * s, reach: 0.8 * s };
    case "surfacing":
      return { w: 1.2 * s, reach: 0.3 * s };
    case "plug":
    case "slot":
      return { w: Math.max(s, textWidth(g.filling, s) + 0.5 * s), reach: LEADING * s };
    case "groove":
      switch (g.symbol) {
        case "none":
          return { w: 0, reach: 0 };
        case "bevel":
          return { w: 0.7 * s, reach: s };
        case "flareBevel":
          return { w: 0.55 * s, reach: s };
        case "flareV":
          return { w: 0.9 * s, reach: s };
        case "scarf":
          return { w: 0.8 * s, reach: s };
        case "square":
          return { w: 0.4 * s, reach: s };
        case "j":
          return { w: 0.6 * s, reach: s };
        case "u":
          return { w: 0.8 * s, reach: s };
        case "v":
          return { w: s, reach: s };
        case "back":
        case "meltThrough":
          return { w: 0.8 * s, reach: 0.4 * s };
        case "backing":
          return { w: s, reach: 0.5 * s };
        case "backingRemove":
          return { w: s, reach: 0.6 * s };
        case "insert":
          return { w: 0.5 * s, reach: 0.5 * s };
      }
  }
}

/** Points along the arc round `c` of radius `r` from `from` to `to` radians. */
function arcPts(c: Pt, r: number, from: number, to: number, steps = ARC_STEPS): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps;
    return P(c.x + r * Math.cos(t), c.y + r * Math.sin(t));
  });
}

/** Points along the circular arc from `a` to `b` bowing `bow` to the left of a→b (negative: to the right). */
function bowPts(a: Pt, b: Pt, bow: number): Pt[] {
  const len = dist(a, b);
  if (Math.abs(bow) < 1e-9 || len === 0) return [a, b];
  const u = P((b.x - a.x) / len, (b.y - a.y) / len);
  const n = P(-u.y, u.x);
  return Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
    const t = i / ARC_STEPS;
    // a parabola close enough to the arc at these shallow bows
    const off = 4 * bow * t * (1 - t);
    return P(a.x + (b.x - a.x) * t + n.x * off, a.y + (b.y - a.y) * t + n.y * off);
  });
}

/** What a drawing collects. */
interface Into {
  readonly outlines: Pt[][];
  readonly lines: Pt[][];
  readonly circles: { center: Pt; radius: number }[];
  readonly filled: Pt[][];
  readonly texts: MarkerText[];
}

/**
 * Draws glyph `g` from `x0` along the line, standing on `yb` and reaching `side` (1 up, -1 down);
 * for a symbol across the line, `yb` is its middle.
 */
function drawGlyph(into: Into, g: WeldGlyph, x0: number, yb: number, side: 1 | -1, s: number, across: boolean): void {
  const { w, reach } = glyphSize(g, s);
  const y = (k: number) => yb + side * k;
  const xc = x0 + w / 2;
  switch (g.kind) {
    case "fillet":
      // the upright leg on the left, as both standards draw it
      into.lines.push([P(x0, yb), P(x0, y(s)), P(x0 + s, yb)]);
      return;
    case "flange": {
      const r = 0.3 * s;
      const left = x0 + r;
      const right = x0 + w - r;
      // each stem meets the line with a quarter turn outward; a corner flange's left stem meets it square
      const toLine = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (g.corner) into.lines.push([P(left, yb), P(left, y(s))]);
      else into.lines.push([...arcPts(P(left - r, y(r)), r, toLine, 0), P(left, y(s))]);
      into.lines.push([...arcPts(P(right + r, y(r)), r, toLine, side > 0 ? -Math.PI : Math.PI), P(right, y(s))]);
      return;
    }
    case "spot":
    case "seam":
    case "stud": {
      const r = 0.4 * s;
      const c = P(xc, across ? yb : y(r));
      into.circles.push({ center: c, radius: r });
      if (g.kind === "seam") {
        const half = w / 2;
        into.lines.push([P(xc - half, c.y + 0.35 * r), P(xc + half, c.y + 0.35 * r)]);
        into.lines.push([P(xc - half, c.y - 0.35 * r), P(xc + half, c.y - 0.35 * r)]);
      }
      if (g.kind === "stud") {
        const k = r * Math.SQRT1_2;
        into.lines.push([P(c.x - k, c.y - k), P(c.x + k, c.y + k)]);
        into.lines.push([P(c.x - k, c.y + k), P(c.x + k, c.y - k)]);
      }
      return;
    }
    case "surfacing": {
      const r = w / 4;
      const start = side > 0 ? Math.PI : -Math.PI;
      into.lines.push(arcPts(P(x0 + r, yb), r, start, 0));
      into.lines.push(arcPts(P(x0 + 3 * r, yb), r, start, 0));
      return;
    }
    case "plug":
    case "slot":
      into.outlines.push([P(x0, yb), P(x0 + w, yb), P(x0 + w, y(reach)), P(x0, y(reach))]);
      if (g.filling) into.texts.push({ at: P(xc, y(reach / 2)), text: g.filling, height: s, justify: "centre" });
      return;
    case "groove":
      switch (g.symbol) {
        case "none":
          return;
        case "bevel":
          into.lines.push([P(x0, y(s)), P(x0, yb), P(x0 + w, y(s))]);
          return;
        case "flareBevel":
          into.lines.push([P(x0, yb), P(x0, y(s))]);
          into.lines.push(bowPts(P(x0 + w, yb), P(x0 + w, y(s)), side * 0.35 * s));
          return;
        case "flareV":
          into.lines.push(bowPts(P(x0, yb), P(x0, y(s)), -side * 0.35 * s));
          into.lines.push(bowPts(P(x0 + w, yb), P(x0 + w, y(s)), side * 0.35 * s));
          return;
        case "scarf":
          into.lines.push([P(x0, yb), P(x0 + 0.5 * s, y(s))]);
          into.lines.push([P(x0 + 0.3 * s, yb), P(x0 + w, y(s))]);
          return;
        case "square":
          into.lines.push([P(x0, yb), P(x0, y(s))]);
          into.lines.push([P(x0 + w, yb), P(x0 + w, y(s))]);
          return;
        case "j":
          // the upright leg, and a U's right half cupped against it
          into.lines.push([P(x0, yb), P(x0, y(s))]);
          into.lines.push(arcPts(P(x0, y(s)), w, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
          return;
        case "u": {
          const r = w / 2;
          const stem = s - r;
          into.lines.push([P(xc, yb), P(xc, y(stem))]);
          into.lines.push(arcPts(P(xc, y(s)), r, Math.PI, side > 0 ? 2 * Math.PI : 0));
          return;
        }
        case "v":
          into.lines.push([P(x0, y(s)), P(xc, yb), P(x0 + w, y(s))]);
          return;
        case "back":
        case "meltThrough": {
          const half = arcPts(P(xc, yb), w / 2, side > 0 ? 0 : Math.PI, side > 0 ? Math.PI : 2 * Math.PI);
          if (g.symbol === "back") into.lines.push(half);
          else into.filled.push(half);
          return;
        }
        case "backing":
        case "backingRemove":
        case "insert":
          into.outlines.push([P(x0, yb), P(x0 + w, yb), P(x0 + w, y(reach)), P(x0, y(reach))]);
          if (g.symbol === "backingRemove") into.texts.push({ at: P(xc, y(reach / 2)), text: "R", height: 0.5 * s, justify: "centre" });
          return;
      }
  }
}

/** A side placed: what it says, the line its glyph stands on and the way it reaches, how far along it moves, and whether it sits across the line. */
interface Placed {
  readonly data: WeldSideData;
  readonly base: number;
  readonly side: 1 | -1;
  readonly shift: number;
  readonly across: boolean;
}

/** `text` with a degree sign when it is a bare number. */
export function degrees(text: string): string {
  return /^\d+(\.\d+)?$/.test(text) ? `${text}°` : text;
}

/** `text` in brackets, unless it is empty or bracketed already. */
export function bracketed(text: string): string {
  return !text || text.startsWith("(") ? text : `(${text})`;
}

/**
 * The welding symbol `w` with its arrow from the joint `tip` to the reference line's end at
 * `shoulder`, the line running level away from the arrow; `s` is the symbol's size and its texts'
 * height. Null when the arrow is shorter than the symbol or there is nothing to draw.
 */
export function weldingSymbol(tip: Pt, shoulder: Pt, w: WeldingSymbol, s: number): MarkerDrawing | null {
  if (!(s > 0) || dist(tip, shoulder) < s) return null;
  const h = s;
  const g = GAP * h;
  const off = DASH_OFF * h;
  const placed: Placed[] = [];
  const otherShift = w.stagger && w.standard === "aws" ? s : 0;
  if (w.across) placed.push({ data: w.across, base: 0, side: 1, shift: 0, across: true });
  const [arrowWay, otherBase]: [1 | -1, number] =
    w.layout === "arrowBelow" ? [-1, off] : w.layout === "arrowAbove" ? [1, -off] : [-1, 0];
  if (w.arrowSide) placed.push({ data: w.arrowSide, base: 0, side: arrowWay, shift: 0, across: false });
  if (w.otherSide) placed.push({ data: w.otherSide, base: otherBase, side: arrowWay === -1 ? 1 : -1, shift: otherShift, across: false });

  const into: Into = { outlines: [], lines: [], circles: [], filled: [], texts: [] };
  let minX = 0;
  let maxX = 0;
  const reach = (x0: number, x1: number) => {
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
  };
  // the after texts line up across the sides, piece by piece (each side then moved by its shift),
  // with ISO's stagger mark, a Z across the line, between the first two
  const afterAt: number[] = [];
  const pieces = Math.max(0, ...placed.map((p) => p.data.after.length));
  const zMark = w.stagger && w.standard === "iso" && placed.some((p) => p.data.after[1]);
  const zReach = off + LEADING * h;
  let x = Math.max(0, ...placed.map((p) => glyphSize(p.data.glyph, s).w + g + afterExtra(p.data, s, h)));
  for (let k = 0; k < pieces; k++) {
    if (k > 0) x += g;
    afterAt.push(x);
    x += Math.max(0, ...placed.map((p) => textWidth(p.data.after[k] ?? "", h)));
    if (zMark && k === 0) {
      x += g;
      into.lines.push([P(x - 0.3 * h, zReach), P(x, zReach), P(x, -zReach), P(x + 0.3 * h, -zReach)]);
    }
  }

  for (const p of placed) {
    const { w: gw, reach: gr } = glyphSize(p.data.glyph, s);
    const x0 = p.shift;
    const textY = p.across ? 0.6 * h : p.base + p.side * 0.6 * h;
    drawGlyph(into, p.data.glyph, x0, p.base, p.side, s, p.across);
    reach(x0, x0 + gw);
    const before = p.data.before.filter((t) => t);
    before.forEach((t, i) => {
      const at = P(x0 - g, textY + (p.across ? 1 : p.side) * i * LEADING * h);
      into.texts.push({ at, text: t, height: h, justify: "right" });
      reach(at.x - textWidth(t, h), at.x);
    });
    p.data.after.forEach((t, k) => {
      if (!t) return;
      const at = P(afterAt[k] + p.shift, textY);
      into.texts.push({ at, text: t, height: h, justify: "left" });
      reach(at.x, at.x + textWidth(t, h));
    });
    // beyond the glyph and clear of the texts beside it: the texts, then the contour and the method's letter
    const way: 1 | -1 = p.across ? -1 : p.side;
    const besideText = before.length > 0 || p.data.after.some((t) => t);
    const band = besideText ? 0.6 * h + (Math.max(1, before.length) - 1) * LEADING * h + 0.5 * h : 0;
    let far = p.across ? -gr / 2 : p.base + p.side * Math.max(gr, band);
    const xc = x0 + gw / 2;
    for (const t of p.data.beyond) {
      if (!t) continue;
      const at = P(xc, far + way * (0.15 * h + 0.5 * h));
      into.texts.push({ at, text: t, height: h, justify: "centre" });
      reach(xc - textWidth(t, h) / 2, xc + textWidth(t, h) / 2);
      far = at.y + way * 0.5 * h;
    }
    if (p.data.contour !== "none") {
      if (p.data.glyph.kind === "fillet") {
        filletContour(into, p.data, x0, p.base, p.side, s, h);
        reach(x0, x0 + 1.6 * s);
      } else {
        const half = Math.max(gw, 0.8 * s) / 2;
        const yc = far + way * 0.3 * h;
        const bow = p.data.contour === "flush" ? 0 : (p.data.contour === "convex" ? 1 : -1) * way * 0.15 * s;
        // bowPts bows to the left of a→b; a→b runs in +x, so left is +y
        into.lines.push(bowPts(P(xc - half, yc), P(xc + half, yc), bow));
        reach(xc - half, xc + half);
        if (p.data.method !== "U") into.texts.push({ at: P(xc, yc + way * (0.2 * s + 0.6 * h)), text: p.data.method, height: h, justify: "centre" });
      }
    }
    if (p.data.penetration) {
      const r = 0.4 * s;
      into.filled.push(arcPts(P(xc, 0), r, p.side > 0 ? Math.PI : 0, p.side > 0 ? 2 * Math.PI : Math.PI));
    }
  }

  // the reference line, room left at each end, at least four symbols long
  let L0 = minX - g;
  let L1 = maxX + g;
  if (L1 - L0 < 4 * s) {
    const grow = (4 * s - (L1 - L0)) / 2;
    L0 -= grow;
    L1 += grow;
  }
  const arrowRight = tip.x >= shoulder.x;
  // a flag or all-around circle at the shoulder wants room from the texts
  if (w.allAround || w.field) {
    if (arrowRight) L1 += 0.6 * s;
    else L0 -= 0.6 * s;
  }
  const dx = shoulder.x - (arrowRight ? L1 : L0);
  const dy = shoulder.y;
  const at = (p: Pt): Pt => P(p.x + dx, p.y + dy);
  const out: Into = {
    outlines: into.outlines.map((pts) => pts.map(at)),
    lines: into.lines.map((pts) => pts.map(at)),
    circles: into.circles.map((c) => ({ center: at(c.center), radius: c.radius })),
    filled: into.filled.map((pts) => pts.map(at)),
    texts: into.texts.map((t) => ({ ...t, at: at(t.at) })),
  };
  out.lines.push([at(P(L0, 0)), at(P(L1, 0))]);
  // ISO's identification line, dashed, on the other side's side of the continuous one
  if (w.standard === "iso" && (w.layout === "arrowBelow" || w.layout === "arrowAbove") && !w.across) {
    const yd = otherBase;
    for (let x0 = L0; x0 < L1 - DASH_GAP * s; x0 += (DASH + DASH_GAP) * s) out.lines.push([at(P(x0, yd)), at(P(Math.min(L1, x0 + DASH * s), yd))]);
  }
  // the arrow from the shoulder to the joint
  const len = dist(tip, shoulder);
  const u = P((tip.x - shoulder.x) / len, (tip.y - shoulder.y) / len);
  if (w.arrowhead) {
    const back = P(tip.x - u.x * s, tip.y - u.y * s);
    const half = s / 5;
    out.filled.push([tip, P(back.x - u.y * half, back.y + u.x * half), P(back.x + u.y * half, back.y - u.x * half)]);
    out.lines.push([shoulder, back]);
  } else out.lines.push([shoulder, tip]);
  if (w.allAround) out.circles.push({ center: shoulder, radius: 0.4 * s });
  if (w.field) {
    const up = w.field.startsWith("top") ? 1 : -1;
    const right = w.field.endsWith("Right") ? 1 : -1;
    const top = P(shoulder.x, shoulder.y + up * 1.6 * s);
    out.lines.push([shoulder, top]);
    out.filled.push([top, P(top.x, top.y - up * 0.6 * s), P(top.x + right * 0.8 * s, top.y - up * 0.3 * s)]);
  }
  // the tail at the line's far end, its note beyond the fork
  if (w.reference) {
    const left = arrowRight;
    const xe = left ? L0 : L1;
    const out1 = left ? -1 : 1;
    out.lines.push([at(P(xe + out1 * s, s)), at(P(xe, 0)), at(P(xe + out1 * s, -s))]);
    const notes = w.reference.filter((t) => t);
    notes.forEach((t, i) => {
      const y = ((notes.length - 1) / 2 - i) * LEADING * h;
      out.texts.push({ at: at(P(xe + out1 * (s + g), y)), text: t, height: h, justify: left ? "right" : "left" });
    });
  }
  return out;
}

/** How far after a fillet its after texts start, to clear its contour and method. */
function afterExtra(d: WeldSideData, s: number, h: number): number {
  if (d.glyph.kind !== "fillet" || d.contour === "none") return 0;
  return 0.5 * s + (d.method !== "U" ? 0.6 * h : 0);
}

/** A fillet's finish contour, along its slope a little off it, and the method's letter beyond. */
function filletContour(into: Into, d: WeldSideData, x0: number, yb: number, side: 1 | -1, s: number, h: number): void {
  const a = P(x0, yb + side * s);
  const b = P(x0 + s, yb);
  const n = P(Math.SQRT1_2, side * Math.SQRT1_2);
  const t = P(Math.SQRT1_2, -side * Math.SQRT1_2);
  const off = 0.35 * s;
  const inset = 0.1 * s;
  const p = P(a.x + n.x * off + t.x * inset, a.y + n.y * off + t.y * inset);
  const q = P(b.x + n.x * off - t.x * inset, b.y + n.y * off - t.y * inset);
  // bowPts bows to the left of p→q: left of t is (-t.y, t.x), which is n when side is 1 and -n when -1
  const out = d.contour === "convex" ? 1 : d.contour === "concave" ? -1 : 0;
  into.lines.push(bowPts(p, q, out * side * 0.15 * s));
  if (d.method !== "U") {
    const m = P((a.x + b.x) / 2 + n.x * (off + 0.15 * s + 0.55 * h), (a.y + b.y) / 2 + n.y * (off + 0.15 * s + 0.55 * h));
    into.texts.push({ at: m, text: d.method, height: h, justify: "centre" });
  }
}
