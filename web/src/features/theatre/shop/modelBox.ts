// The Scene Shop's model box cut sheet: each flat and platform scaled down to a model (1:24, 1:25, 1:48 or 1:50)
// and laid out on card for a laser cutter, in true mm. A flat is one scaled rectangle, its openings not modelled.
// A platform is a box with no bottom: its top and four walls are separate pieces, each joint edge carries comb
// tabs of the card's thickness on one piece and matching notches on its partner, so it goes together without
// fillets. The SVG has red hairline cut paths and blue engraved names as text, one group per sheet. A tab is
// the card's thickness deep, not a tuned glue gap.

import type { Pt } from "../../../core/index.ts";
import type { ShopPiece } from "../showTypes.ts";
import { nestSheets, type NestRect, type Placed } from "./cutlist.ts";

export const MODEL_SCALES: readonly number[] = [24, 25, 48, 50];

/** The sheets of card the laser takes, mm. */
export const MODEL_SHEETS: readonly { readonly name: string; readonly widthMm: number; readonly heightMm: number }[] = [
  { name: "A3", widthMm: 420, heightMm: 297 },
  { name: "A2", widthMm: 594, heightMm: 420 },
  { name: "A1", widthMm: 841, heightMm: 594 },
];

/** the space kept clear at each sheet's edge, and between pieces, model mm */
const MARGIN_MM = 5;
const GAP_MM = 4;

export interface ModelOptions {
  readonly scale: number;
  /** the card's thickness, model mm: a tab's depth */
  readonly thickMm: number;
  readonly sheetWidthMm: number;
  readonly sheetHeightMm: number;
}

/** One cut piece in model mm: its outline from its top left corner, and the name engraved on it. */
export interface ModelPiece {
  readonly name: string;
  readonly outline: readonly Pt[];
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface ModelSheets {
  /** one SVG per sheet, in mm, with one group */
  readonly svgs: readonly string[];
  /** names of pieces too big for a sheet at this scale */
  readonly tooBig: readonly string[];
  readonly pieceCount: number;
}

/** A joint edge: plain, or with tabs out of the piece, or notches into it. */
type Joint = "flat" | "tab" | "slot";

interface Edges {
  readonly top: Joint;
  readonly right: Joint;
  readonly bottom: Joint;
  readonly left: Joint;
}

const PLAIN: Edges = { top: "flat", right: "flat", bottom: "flat", left: "flat" };
const ALL_TABS: Edges = { top: "tab", right: "tab", bottom: "tab", left: "tab" };

/** Joint segments along an edge of `len` mm: an odd count, so the ends stay square; one (no joint) when too short. */
function segments(len: number, t: number, joint: Joint): number {
  if (joint === "flat" || !(t > 0)) return 1;
  const n = 2 * Math.round((len / t - 1) / 2) + 1;
  return n >= 3 ? n : 1;
}

/** Drops points that repeat the one before (and the first again at the end). */
function dedupe(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
  }
  const first = out[0];
  const end = out[out.length - 1];
  if (out.length > 1 && first && end && Math.hypot(first.x - end.x, first.y - end.y) < 1e-6) out.pop();
  return out;
}

/**
 * A w x h rectangle from 0,0, its edges plain, with tabs (out) or notches (in) of depth t. Every joint edge
 * alternates square ends with joint segments, the tabs on the odd ones, so a tab and its notch line up.
 */
export function combRect(w: number, h: number, e: Edges, t: number): Pt[] {
  if (!(w > 0 && h > 0)) return [];
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // outward, as the screen's y runs down: top is up the page
  const outward: Pt[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  const joints = [e.top, e.right, e.bottom, e.left];
  const out: Pt[] = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side];
    const b = corners[(side + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = segments(len, t, joints[side]);
    const step = len / n;
    const normal = outward[side];
    const odd = joints[side] === "tab" ? t : joints[side] === "slot" ? -t : 0;
    for (let i = 0; i < n; i++) {
      const off = i % 2 === 1 ? odd : 0;
      const p0 = { x: a.x + dir.x * step * i, y: a.y + dir.y * step * i };
      const p1 = { x: a.x + dir.x * step * (i + 1), y: a.y + dir.y * step * (i + 1) };
      out.push({ x: p0.x + normal.x * off, y: p0.y + normal.y * off }, { x: p1.x + normal.x * off, y: p1.y + normal.y * off });
    }
  }
  return dedupe(out);
}

/** A piece from its size and edges, its outline moved so its box starts at 0,0. */
function piece(name: string, w: number, h: number, e: Edges, t: number): ModelPiece {
  const raw = combRect(w, h, e, t);
  if (raw.length === 0) return { name, outline: [], widthMm: 0, heightMm: 0 };
  const minX = Math.min(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  const outline = raw.map((p) => ({ x: p.x - minX, y: p.y - minY }));
  return {
    name,
    outline,
    widthMm: Math.max(...outline.map((p) => p.x)),
    heightMm: Math.max(...outline.map((p) => p.y)),
  };
}

/**
 * The model's pieces at `scale`, each shop piece as many times as it is built. A flat is one rectangle. A
 * platform is five: the top, then front, back, left and right walls (left and right run the depth), with the
 * walls' joints matched so the front's left tab goes in the left wall's front notch, and so on round.
 */
export function modelPieces(pieces: readonly ShopPiece[], scale: number, thickMm: number): ModelPiece[] {
  const k = (mm: number): number => mm / scale;
  const out: ModelPiece[] = [];
  for (const p of pieces) {
    for (let copy = 0; copy < p.count; copy++) {
      if (p.kind === "flat") {
        out.push(piece(p.name, k(p.widthMm), k(p.heightMm), PLAIN, thickMm));
        continue;
      }
      const W = k(p.widthMm);
      const D = k(p.heightMm);
      const S = k(p.standMm);
      out.push(
        piece(`${p.name} top`, W, D, ALL_TABS, thickMm),
        piece(`${p.name} front`, W, S, { top: "slot", right: "slot", bottom: "flat", left: "tab" }, thickMm),
        piece(`${p.name} back`, W, S, { top: "slot", right: "tab", bottom: "flat", left: "slot" }, thickMm),
        piece(`${p.name} left`, D, S, { top: "slot", right: "tab", bottom: "flat", left: "slot" }, thickMm),
        piece(`${p.name} right`, D, S, { top: "slot", right: "slot", bottom: "flat", left: "tab" }, thickMm),
      );
    }
  }
  return out.filter((m) => m.widthMm > 0 && m.heightMm > 0);
}

/** A number to three places, as SVG writes it. */
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Text escaped for an XML element. */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** An SVG as an image's source, for a preview. */
export function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** One sheet as SVG: each piece's outline in red, its name in blue, positions in mm with the margin kept clear. */
function sheetSvg(placed: readonly Placed[], parts: readonly ModelPiece[], n: number, o: ModelOptions): string {
  const body: string[] = [];
  for (const p of placed) {
    const part = parts[Number(p.mark)];
    // a turned piece is its outline rotated a quarter turn clockwise: its height becomes its width
    const pts = p.turned ? part.outline.map((q) => ({ x: part.heightMm - q.y, y: q.x })) : part.outline;
    const dx = MARGIN_MM + p.xMm;
    const dy = MARGIN_MM + p.yMm;
    const d = `M ${pts.map((q) => `${num(q.x + dx)} ${num(q.y + dy)}`).join(" L ")} Z`;
    body.push(`<path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`);
    const size = Math.min(3, (p.widthMm - 2) / Math.max(1, part.name.length * 0.6), p.heightMm * 0.4);
    if (size >= 1.5) {
      body.push(
        `<text x="${num(dx + p.widthMm / 2)}" y="${num(dy + p.heightMm / 2 + size * 0.35)}" font-size="${num(size)}" fill="#0000ff" stroke="none" text-anchor="middle" font-family="sans-serif">${xmlEscape(part.name)}</text>`,
      );
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.sheetWidthMm}mm" height="${o.sheetHeightMm}mm" viewBox="0 0 ${o.sheetWidthMm} ${o.sheetHeightMm}">`,
    `<g id="sheet-${n}">`,
    ...body,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

/** The model box's sheets, each piece placed by nestSheets, as SVG text; the names of any too big for a sheet. */
export function modelBoxSheets(pieces: readonly ShopPiece[], o: ModelOptions): ModelSheets {
  const parts = modelPieces(pieces, o.scale, o.thickMm);
  const nest = nestSheets(
    parts.map((p, i): NestRect => ({ mark: String(i), widthMm: p.widthMm, heightMm: p.heightMm })),
    o.sheetWidthMm - 2 * MARGIN_MM,
    o.sheetHeightMm - 2 * MARGIN_MM,
    GAP_MM,
  );
  return {
    svgs: nest.sheets.map((placed, i) => sheetSvg(placed, parts, i + 1, o)),
    tooBig: nest.tooBig.map((r) => parts[Number(r.mark)].name),
    pieceCount: parts.length,
  };
}
