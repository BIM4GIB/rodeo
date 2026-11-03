// Scene Shop flats and platforms, worked out as parts: each piece's cut list of framing and skin (or lid),
// its front and back views (a platform's front and side) as lines and labels in a local frame, and its plan
// mark. A Hollywood flat has its stock on edge, its face the flat's depth; a Broadway flat has it flat, its
// face in the flat's plane. Pure: sizes in mm, and labels are written by the caller's `format`. Leaves out
// joinery (halving, dados, screws, cleats), the skin's grain, and the stock's waste (cutlist.ts packs these).

import type { MarkerDrawing } from "../../../app/markerShapes.ts";
import type { Pt } from "../../../core/index.ts";

/** Solid stock, mm: its thickness and its face (the wider side). A 1x3 is 19 x 64. */
export interface Stock {
  readonly thickMm: number;
  readonly faceMm: number;
}

/** The stock a shop offers, by the name it's sold under. */
export const STOCK: Readonly<Record<string, Stock>> = {
  "1x3": { thickMm: 19, faceMm: 64 },
  "1x4": { thickMm: 19, faceMm: 89 },
  "2x4": { thickMm: 38, faceMm: 89 },
  "4x4": { thickMm: 89, faceMm: 89 },
};

/** A stock's name and size as a cut list writes it: "1x3 (19 x 64 mm)". */
export function stockText(s: Stock): string {
  const name = Object.keys(STOCK).find((k) => STOCK[k].thickMm === s.thickMm && STOCK[k].faceMm === s.faceMm);
  const size = `${s.thickMm} x ${s.faceMm} mm`;
  return name ? `${name} (${size})` : size;
}

/** A sheet of ply or lauan, mm: 4 by 8 feet. */
export const SHEET_WIDTH_MM = 1219;
export const SHEET_LENGTH_MM = 2438;
/** Toggles keep at most 4 feet between them; a Hollywood flat wider than that gets a centre stile. */
const TOGGLE_MAX_MM = 1219;
const CENTRE_STILE_OVER_MM = 1219;
/** A platform's joists are at most 406 mm (16 in) apart, its legs at most 2438 mm (8 ft), and it has braces over 600 mm high. */
const JOIST_MAX_MM = 406;
const LEG_SPAN_MAX_MM = 2438;
const BRACE_OVER_MM = 600;
/** a guard rail is normally required from 760 mm (30 in) up */
const GUARD_RAIL_MM = 760;
const LID_MM = 19;

export interface FlatSpec {
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly style: "hollywood" | "broadway";
  readonly stock: Stock;
  readonly skin: "lauan" | "none";
  readonly skinThickMm: number;
  /** the most the toggles may be apart, mm (1219 when not set) */
  readonly toggleMaxMm?: number;
}

export interface PlatformSpec {
  readonly name: string;
  /** along the front */
  readonly widthMm: number;
  /** front to back */
  readonly depthMm: number;
  /** the lid's top above the floor */
  readonly standMm: number;
  /** mm (406 when not set) */
  readonly joistMaxMm?: number;
  /** mm (19 when not set) */
  readonly lidThickMm?: number;
  readonly frameStock: Stock;
  readonly legStock: Stock;
  readonly legsPer: "corners" | "grid";
}

export type ShopSpec = FlatSpec | PlatformSpec;

export const isFlat = (s: ShopSpec): s is FlatSpec => "style" in s;

/** One line of a cut list: `qty` pieces of one length. A sheet part also has a width; its length is its height. */
export interface ShopPart {
  readonly mark: string;
  readonly name: string;
  readonly material: string;
  readonly lengthMm: number;
  readonly widthMm?: number;
  readonly qty: number;
}

/** Adds a stock line when it has pieces and a length. */
function line(out: ShopPart[], mark: string, name: string, material: string, lengthMm: number, qty: number): void {
  if (qty > 0 && lengthMm > 0) out.push({ mark, name, material, lengthMm: Math.round(lengthMm), qty });
}

/** Sheets a w x h panel needs: one sheet where it fits either way round, else pieces no bigger than a sheet. */
export function sheetPieces(w: number, h: number): { widthMm: number; lengthMm: number }[] {
  if (!(w > 0 && h > 0)) return [];
  const fits = (a: number, b: number): boolean => a <= SHEET_WIDTH_MM && b <= SHEET_LENGTH_MM;
  if (fits(w, h) || fits(h, w)) return [{ widthMm: w, lengthMm: h }];
  const out: { widthMm: number; lengthMm: number }[] = [];
  for (let x = 0; x < w; x += SHEET_WIDTH_MM) {
    for (let y = 0; y < h; y += SHEET_LENGTH_MM) out.push({ widthMm: Math.min(SHEET_WIDTH_MM, w - x), lengthMm: Math.min(SHEET_LENGTH_MM, h - y) });
  }
  return out;
}

/** Adds the sheets a panel needs, one line per size; the marks number the sizes when there are several. */
function sheetLines(out: ShopPart[], mark: string, name: string, material: string, w: number, h: number): void {
  const sizes = new Map<string, { widthMm: number; lengthMm: number; qty: number }>();
  for (const p of sheetPieces(w, h)) {
    const widthMm = Math.round(p.widthMm);
    const lengthMm = Math.round(p.lengthMm);
    const key = `${widthMm}x${lengthMm}`;
    const found = sizes.get(key);
    if (found) found.qty++;
    else sizes.set(key, { widthMm, lengthMm, qty: 1 });
  }
  const many = sizes.size > 1;
  let n = 0;
  for (const s of sizes.values()) {
    n++;
    out.push({ mark: many ? `${mark}${n}` : mark, name, material, lengthMm: s.lengthMm, widthMm: s.widthMm, qty: s.qty });
  }
}

/** Toggles that keep the clear height's spaces at most `max` apart: the spaces are one more than the toggles. */
function togglesIn(clearMm: number, maxMm: number): number {
  return Math.max(0, Math.ceil(clearMm / maxMm) - 1);
}

/**
 * A flat's cut list. Hollywood (stock on edge): two stiles the full height, two rails between them, toggles
 * between the rails, and over 1219 mm wide a centre stile cut in pieces between the toggles. Broadway (stock
 * flat, face out): two rails the full width, two stiles between them, toggles between the stiles, and four
 * corner blocks. A lauan skin covers the face, in sheets.
 */
export function flatParts(spec: FlatSpec): ShopPart[] {
  const W = spec.widthMm;
  const H = spec.heightMm;
  const { thickMm: t, faceMm: f } = spec.stock;
  const material = stockText(spec.stock);
  const max = spec.toggleMaxMm ?? TOGGLE_MAX_MM;
  const out: ShopPart[] = [];
  if (spec.style === "hollywood") {
    const clear = H - 2 * t;
    const toggles = togglesIn(clear, max);
    line(out, "S", "Stile", material, H, 2);
    line(out, "R", "Rail", material, W - 2 * t, 2);
    line(out, "T", "Toggle", material, W - 2 * t, toggles);
    if (W > CENTRE_STILE_OVER_MM) line(out, "C", "Centre stile piece", material, (clear - toggles * t) / (toggles + 1), toggles + 1);
  } else {
    const clear = H - 2 * f;
    line(out, "R", "Rail", material, W, 2);
    line(out, "S", "Stile", material, clear, 2);
    line(out, "T", "Toggle", material, W - 2 * f, togglesIn(clear, max));
    line(out, "B", "Corner block", material, f, 4);
  }
  if (spec.skin === "lauan") sheetLines(out, "K", "Skin sheet", `lauan ${spec.skinThickMm} mm`, W, H);
  return out;
}

/** The height of a platform's legs: the stand less its lid and its frame's depth. */
function legLength(s: PlatformSpec): number {
  return s.standMm - (s.lidThickMm ?? LID_MM) - s.frameStock.faceMm;
}

/** Joists between the long rails, spaced at most `maxMm` apart along the depth. */
function joistCount(depthMm: number, maxMm: number): number {
  return Math.max(0, Math.ceil(depthMm / maxMm) - 1);
}

/** Where the legs stand along a long rail, from its front end: the corners, the spans cut to at most 2438 mm, and (on a grid) under each joist. */
export function legPositions(legsPer: "corners" | "grid", depthMm: number, joists: number): number[] {
  if (!(depthMm > 0)) return [];
  const at = new Set<number>([0, depthMm]);
  const spans = Math.max(1, Math.ceil(depthMm / LEG_SPAN_MAX_MM));
  for (let k = 1; k < spans; k++) at.add((depthMm * k) / spans);
  if (legsPer === "grid") for (let k = 1; k <= joists; k++) at.add((depthMm * k) / (joists + 1));
  return [...at].sort((a, b) => a - b);
}

/**
 * A platform's cut list. The long rails run the depth at each side; the end rails and the joists run across
 * between them, the joists spaced along the depth. The lid is sheets; the legs stand under the long rails at
 * the corners and wherever a span would pass 2438 mm (or under each joist on a grid). Over 600 mm high, one
 * diagonal brace per bay on each long side.
 */
export function platformParts(spec: PlatformSpec): ShopPart[] {
  const W = spec.widthMm;
  const D = spec.depthMm;
  const frame = stockText(spec.frameStock);
  const legs = stockText(spec.legStock);
  const legLen = legLength(spec);
  const joists = joistCount(D, spec.joistMaxMm ?? JOIST_MAX_MM);
  const across = W - 2 * spec.frameStock.thickMm;
  const out: ShopPart[] = [];
  line(out, "LR", "Long rail", frame, D, 2);
  line(out, "ER", "End rail", frame, across, 2);
  line(out, "J", "Joist", frame, across, joists);
  sheetLines(out, "LID", "Lid sheet", `plywood ${spec.lidThickMm ?? LID_MM} mm`, W, D);
  const at = legPositions(spec.legsPer, D, joists);
  line(out, "L", "Leg", legs, legLen, 2 * at.length);
  if (spec.standMm > BRACE_OVER_MM) {
    const lengths = new Map<number, number>();
    for (let i = 1; i < at.length; i++) {
      const len = Math.round(Math.hypot(at[i] - at[i - 1], legLen));
      lengths.set(len, (lengths.get(len) ?? 0) + 2);
    }
    for (const [len, qty] of lengths) line(out, "B", "Diagonal brace", legs, len, qty);
  }
  return out;
}

/** What a platform needs a warning for: a guard rail's height, and a stand too low for legs. */
export function platformWarnings(spec: PlatformSpec): string[] {
  const warnings: string[] = [];
  if (spec.standMm >= GUARD_RAIL_MM) warnings.push(`The top is ${Math.round(spec.standMm)} mm high: at 760 mm (30 in) or more a guard rail is normally required.`);
  if (legLength(spec) <= 0) warnings.push("The stand is too low for its lid and frame, so the platform has no legs.");
  return warnings;
}

/** A flat's framing members as boxes [x0, y0, x1, y1], from its bottom left corner. */
export function framing(s: FlatSpec): number[][] {
  const W = s.widthMm;
  const H = s.heightMm;
  const hollywood = s.style === "hollywood";
  const m = hollywood ? s.stock.thickMm : s.stock.faceMm;
  const clear = H - 2 * m;
  const T = togglesIn(clear, s.toggleMaxMm ?? TOGGLE_MAX_MM);
  const gap = (clear - T * m) / (T + 1);
  // toggle k's bottom edge, counting up from the bottom rail
  const toggleY = (k: number): number => m + k * gap + (k - 1) * m;
  const out: number[][] = [];
  if (hollywood) {
    out.push([0, 0, m, H], [W - m, 0, W, H], [m, 0, W - m, m], [m, H - m, W - m, H]);
    for (let k = 1; k <= T; k++) out.push([m, toggleY(k), W - m, toggleY(k) + m]);
    if (W > CENTRE_STILE_OVER_MM) {
      // the centre stile in pieces: from rail to toggle, toggle to toggle, toggle to rail
      let from = m;
      for (let k = 1; k <= T + 1; k++) {
        const to = k <= T ? toggleY(k) : H - m;
        out.push([W / 2 - m / 2, from, W / 2 + m / 2, to]);
        from = k <= T ? to + m : to;
      }
    }
  } else {
    out.push([0, 0, W, m], [0, H - m, W, H], [0, m, m, H - m], [W - m, m, W, H - m]);
    for (let k = 1; k <= T; k++) out.push([m, toggleY(k), W - m, toggleY(k) + m]);
  }
  return out;
}

/** Each drawing is lines, outlines and labels in its own frame, y up, mm. */
function empty(): MarkerDrawing {
  return { outlines: [], lines: [], circles: [], filled: [], texts: [] };
}

function box(d: MarkerDrawing, x0: number, y0: number, x1: number, y1: number): void {
  d.outlines.push([
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]);
}

function label(d: MarkerDrawing, at: Pt, text: string, height: number, angle?: number): void {
  d.texts.push({ at, text, height, justify: "centre", angle });
}

/** The overall width along the bottom and the height up the left, in `format`'s words. */
function overall(d: MarkerDrawing, w: number, h: number, labelMm: number, format: (mm: number) => string): void {
  label(d, { x: w / 2, y: -labelMm * 1.6 }, format(w), labelMm);
  label(d, { x: -labelMm * 1.6, y: h / 2 }, format(h), labelMm, 90);
}

/** Lines where a skin's sheets join, when it takes more than one sheet. */
function seams(d: MarkerDrawing, W: number, H: number): void {
  if (sheetPieces(W, H).length <= 1) return;
  for (let x = SHEET_WIDTH_MM; x < W; x += SHEET_WIDTH_MM) d.lines.push([{ x, y: 0 }, { x, y: H }]);
  for (let y = SHEET_LENGTH_MM; y < H; y += SHEET_LENGTH_MM) d.lines.push([{ x: 0, y }, { x: W, y }]);
}

/**
 * A piece's two views in a local frame, its bottom left corner at 0,0: for a flat its front (the skin, or the
 * framing when it has none) and back (the framing); for a platform its front (the end, with its corner legs)
 * and side (the long side, with its legs and braces). Each is titled and has its overall size, in `format`.
 */
export function elevation(spec: ShopSpec, labelMm: number, format: (mm: number) => string): { front: MarkerDrawing; back: MarkerDrawing } {
  if (isFlat(spec)) return flatElevation(spec, labelMm, format);
  return platformElevation(spec, labelMm, format);
}

function flatElevation(s: FlatSpec, labelMm: number, format: (mm: number) => string): { front: MarkerDrawing; back: MarkerDrawing } {
  const W = s.widthMm;
  const H = s.heightMm;
  const front = empty();
  const back = empty();
  const members = framing(s);
  for (const [x0, y0, x1, y1] of members) box(back, x0, y0, x1, y1);
  if (s.skin === "lauan") {
    box(front, 0, 0, W, H);
    seams(front, W, H);
  } else {
    for (const [x0, y0, x1, y1] of members) box(front, x0, y0, x1, y1);
  }
  overall(front, W, H, labelMm, format);
  overall(back, W, H, labelMm, format);
  label(front, { x: W / 2, y: H + labelMm * 1.6 }, "Front", labelMm);
  label(back, { x: W / 2, y: H + labelMm * 1.6 }, "Back", labelMm);
  return { front, back };
}

function platformElevation(s: PlatformSpec, labelMm: number, format: (mm: number) => string): { front: MarkerDrawing; back: MarkerDrawing } {
  const W = s.widthMm;
  const D = s.depthMm;
  const stand = s.standMm;
  const lid = s.lidThickMm ?? LID_MM;
  const legLen = legLength(s);
  const top = legLen + s.frameStock.faceMm;
  const front = empty();
  const side = empty();
  box(front, 0, top, W, top + lid);
  box(front, 0, legLen, W, top);
  box(side, 0, top, D, top + lid);
  box(side, 0, legLen, D, top);
  if (legLen > 0) {
    const legW = s.legStock.thickMm;
    box(front, 0, 0, legW, legLen);
    box(front, W - legW, 0, W, legLen);
    const legF = s.legStock.faceMm;
    const at = legPositions(s.legsPer, D, joistCount(D, s.joistMaxMm ?? JOIST_MAX_MM));
    const centres = at.map((p) => Math.min(Math.max(p - legF / 2, 0), D - legF) + legF / 2);
    for (const c of centres) box(side, c - legF / 2, 0, c + legF / 2, legLen);
    if (stand > BRACE_OVER_MM) {
      for (let i = 1; i < centres.length; i++) side.lines.push([{ x: centres[i - 1], y: legLen }, { x: centres[i], y: 0 }]);
    }
  }
  overall(front, W, stand, labelMm, format);
  overall(side, D, stand, labelMm, format);
  label(front, { x: W / 2, y: stand + labelMm * 1.6 }, "Front", labelMm);
  label(side, { x: D / 2, y: stand + labelMm * 1.6 }, "Side", labelMm);
  return { front, back: side };
}

/** A piece's plan mark: its footprint as a double line (two long sides and two ends), its name below. */
export function planMark(spec: ShopSpec, labelMm: number): MarkerDrawing {
  const d = empty();
  const W = spec.widthMm;
  const depth = isFlat(spec) ? (spec.style === "hollywood" ? spec.stock.faceMm : spec.stock.thickMm) : spec.depthMm;
  box(d, 0, 0, W, depth);
  label(d, { x: W / 2, y: -labelMm * 1.6 }, spec.name, labelMm);
  return d;
}

/** The notes that go with a piece's drawing: each part as a line of its mark, count, name, length and material. */
export function noteLines(parts: readonly ShopPart[], format: (mm: number) => string): string[] {
  return parts.map((p) => `${p.mark}  ${p.qty} x ${p.name}, ${format(p.lengthMm)}${p.widthMm ? ` x ${format(p.widthMm)}` : ""}, ${p.material}`);
}

/** A drawing moved by (dx, dy): its points and label anchors. */
export function moved(d: MarkerDrawing, dx: number, dy: number): MarkerDrawing {
  const p = (q: Pt): Pt => ({ x: q.x + dx, y: q.y + dy });
  return {
    outlines: d.outlines.map((o) => o.map(p)),
    lines: d.lines.map((l) => l.map(p)),
    circles: d.circles.map((c) => ({ center: p(c.center), radius: c.radius })),
    filled: d.filled.map((o) => o.map(p)),
    texts: d.texts.map((t) => ({ at: p(t.at), text: t.text, height: t.height, justify: t.justify, angle: t.angle })),
  };
}
