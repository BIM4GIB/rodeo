// What Dims/Notes' Title Block Border tool (tools/sheetBorder.ts) draws, as plain geometry on paper
// in mm, centred on the origin: the drawing frame inside the sheet's margins, the sheet's zones
// lettered and numbered in the margins with their marker lines, the frame's lines run out through
// the margins, crop marks and the sheet's outline, and a title block in the frame's bottom right
// corner. Kept apart from the tool so it runs without the page.

import type { Pt } from "../core/index.ts";
import type { MarkerText } from "./markerShapes.ts";

/** A standard sheet, landscape, mm. */
export interface SheetSize {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const inch = (n: number): number => n * 25.4;
export const SHEET_SIZES: readonly SheetSize[] = [
  { id: "a0", label: "ISO A0", width: 1189, height: 841 },
  { id: "a1", label: "ISO A1", width: 841, height: 594 },
  { id: "a2", label: "ISO A2", width: 594, height: 420 },
  { id: "a3", label: "ISO A3", width: 420, height: 297 },
  { id: "a4", label: "ISO A4", width: 297, height: 210 },
  { id: "archA", label: "ARCH A", width: inch(12), height: inch(9) },
  { id: "archB", label: "ARCH B", width: inch(18), height: inch(12) },
  { id: "archC", label: "ARCH C", width: inch(24), height: inch(18) },
  { id: "archD", label: "ARCH D", width: inch(36), height: inch(24) },
  { id: "archE1", label: "ARCH E1", width: inch(42), height: inch(30) },
  { id: "archE", label: "ARCH E", width: inch(48), height: inch(36) },
  { id: "ansiA", label: "ANSI A", width: inch(11), height: inch(8.5) },
  { id: "ansiB", label: "ANSI B", width: inch(17), height: inch(11) },
  { id: "ansiC", label: "ANSI C", width: inch(22), height: inch(17) },
  { id: "ansiD", label: "ANSI D", width: inch(34), height: inch(22) },
  { id: "ansiE", label: "ANSI E", width: inch(44), height: inch(34) },
];

/** a zone's length along the frame when the count is left to Rodeo, as ISO 5457's, mm */
export const ZONE_MM = 50;
/** most zones along a side */
export const MAX_ZONES = 100;
/** a crop mark's arm either side of the sheet's corner, mm */
const CROP_MM = 10;

export type CropMarks = "none" | "crops" | "outline" | "both";

export interface TitleBlock {
  /** the block's size times this */
  readonly factor: number;
  readonly project: string;
  readonly sheetTitle: string;
  readonly drawnBy: string;
  readonly date: string;
  readonly scale: string;
  readonly sheetNumber: string;
}

export interface SheetBorder {
  /** the sheet across and down, mm */
  readonly width: number;
  readonly height: number;
  /** whether the sheet is the margins' outside edge, or the frame inside them */
  readonly fit: "outer" | "inner";
  readonly margins: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  /** zones across (numbered) and down (lettered); 0 for about one every ZONE_MM */
  readonly across: number;
  readonly down: number;
  readonly lettersFrom: "top" | "bottom";
  readonly numbersFrom: "left" | "right";
  readonly labelSize: number;
  readonly markerLength: number;
  readonly showGrids: boolean;
  readonly extensions: boolean;
  readonly crop: CropMarks;
  /** the title block alone, where it would sit in the frame */
  readonly hideBorder: boolean;
  readonly titleBlock: TitleBlock | null;
}

export interface SheetBorderPlan {
  /** the frame and the title block's outline, drawn heavy */
  readonly heavy: Pt[][];
  /** closed outlines drawn thin: the sheet's outline */
  readonly outlines: Pt[][];
  /** open lines drawn thin */
  readonly lines: Pt[][];
  readonly texts: MarkerText[];
}

const at = (x: number, y: number): Pt => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];

/** The `i`th zone letter (from 0): A to Z without I and O, then AA, AB and on. */
export function zoneLetter(i: number): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  let n = i;
  do {
    s = letters[n % letters.length] + s;
    n = Math.floor(n / letters.length) - 1;
  } while (n >= 0);
  return s;
}

/** the title block's columns and rows, mm, before its factor */
const BLOCK_LEFT = 110;
const BLOCK_RIGHT = 60;
const BLOCK_ROW = 14;
const CAPTION = 1.8;
const VALUE = 3.5;
const BIG = 5;

/** A sheet's border, or why it can't be drawn. */
export function sheetBorder(s: SheetBorder): SheetBorderPlan | string {
  const m = s.margins;
  if (![m.left, m.right, m.top, m.bottom].every((v) => v >= 0)) return "Set the margins to 0 or more.";
  if (!(s.width > 0 && s.height > 0)) return "Set the sheet's Width and Height over 0.";
  // the sheet's outside edge and the frame inside its margins
  const outerW = s.fit === "outer" ? s.width : s.width + m.left + m.right;
  const outerH = s.fit === "outer" ? s.height : s.height + m.top + m.bottom;
  const x0 = -outerW / 2;
  const y0 = -outerH / 2;
  const x1 = outerW / 2;
  const y1 = outerH / 2;
  const fx0 = x0 + m.left;
  const fx1 = x1 - m.right;
  const fy0 = y0 + m.bottom;
  const fy1 = y1 - m.top;
  if (!(fx1 > fx0 && fy1 > fy0)) return "The margins leave no room for the drawing.";
  const across = s.across > 0 ? Math.round(s.across) : Math.max(1, Math.round((fx1 - fx0) / ZONE_MM));
  const down = s.down > 0 ? Math.round(s.down) : Math.max(1, Math.round((fy1 - fy0) / ZONE_MM));
  if (across > MAX_ZONES || down > MAX_ZONES) return `Keep each side to ${MAX_ZONES} zones or fewer.`;
  const heavy: Pt[][] = [];
  const outlines: Pt[][] = [];
  const lines: Pt[][] = [];
  const texts: MarkerText[] = [];
  if (s.titleBlock) {
    const k = s.titleBlock.factor;
    if (!(k > 0)) return "Set the title block's Scale Factor over 0.";
    const w = (BLOCK_LEFT + BLOCK_RIGHT) * k;
    const h = BLOCK_ROW * 4 * k;
    if (w > fx1 - fx0 || h > fy1 - fy0) return "The title block is bigger than the drawing frame: make its Scale Factor smaller.";
    const bx = fx1 - w;
    const by = fy0;
    heavy.push(rect(bx, by, fx1, by + h));
    const row = BLOCK_ROW * k;
    const split = bx + BLOCK_LEFT * k;
    for (let r = 1; r < 4; r++) lines.push([at(bx, by + row * r), at(fx1, by + row * r)]);
    lines.push([at(split, by), at(split, by + row * 2)]);
    const t = s.titleBlock;
    // each cell: its caption at its top left, its value under it
    const cell = (x: number, top: number, caption: string, value: string, big: boolean): void => {
      const pad = 1.5 * k;
      texts.push({ at: at(x + pad, top - pad - (CAPTION * k) / 2), text: caption, height: CAPTION * k, justify: "left" });
      if (value.trim()) texts.push({ at: at(x + pad, top - row / 2 - CAPTION * k * 0.4), text: value.trim(), height: (big ? BIG : VALUE) * k, justify: "left" });
    };
    cell(bx, by + row * 4, "PROJECT", t.project, true);
    cell(bx, by + row * 3, "SHEET TITLE", t.sheetTitle, false);
    cell(bx, by + row * 2, "DRAWN BY", t.drawnBy, false);
    cell(split, by + row * 2, "DATE", t.date, false);
    cell(bx, by + row, "SCALE", t.scale, false);
    cell(split, by + row, "SHEET", t.sheetNumber, true);
  }
  if (s.hideBorder) return { heavy, outlines, lines, texts };
  heavy.push(rect(fx0, fy0, fx1, fy1));
  if (s.extensions) {
    // the frame's lines run on through the margins to the sheet's edge
    lines.push([at(x0, fy0), at(fx0, fy0)], [at(fx1, fy0), at(x1, fy0)], [at(x0, fy1), at(fx0, fy1)], [at(fx1, fy1), at(x1, fy1)]);
    lines.push([at(fx0, y0), at(fx0, fy0)], [at(fx0, fy1), at(fx0, y1)], [at(fx1, y0), at(fx1, fy0)], [at(fx1, fy1), at(fx1, y1)]);
  }
  if (s.showGrids) {
    const stepX = (fx1 - fx0) / across;
    const stepY = (fy1 - fy0) / down;
    // a marker reaches out from the frame, no further than the margin
    const reach = (margin: number): number => Math.min(s.markerLength, margin);
    for (let i = 1; i < across; i++) {
      const x = fx0 + stepX * i;
      if (reach(m.top) > 0) lines.push([at(x, fy1), at(x, fy1 + reach(m.top))]);
      if (reach(m.bottom) > 0) lines.push([at(x, fy0), at(x, fy0 - reach(m.bottom))]);
    }
    for (let j = 1; j < down; j++) {
      const y = fy0 + stepY * j;
      if (reach(m.left) > 0) lines.push([at(fx0, y), at(fx0 - reach(m.left), y)]);
      if (reach(m.right) > 0) lines.push([at(fx1, y), at(fx1 + reach(m.right), y)]);
    }
    for (let i = 0; i < across; i++) {
      const x = fx0 + stepX * (i + 0.5);
      const label = String(s.numbersFrom === "left" ? i + 1 : across - i);
      if (m.top > 0) texts.push({ at: at(x, fy1 + m.top / 2), text: label, height: s.labelSize, justify: "centre" });
      if (m.bottom > 0) texts.push({ at: at(x, fy0 - m.bottom / 2), text: label, height: s.labelSize, justify: "centre" });
    }
    for (let j = 0; j < down; j++) {
      const y = fy1 - stepY * (j + 0.5);
      const label = zoneLetter(s.lettersFrom === "top" ? j : down - 1 - j);
      if (m.left > 0) texts.push({ at: at(fx0 - m.left / 2, y), text: label, height: s.labelSize, justify: "centre" });
      if (m.right > 0) texts.push({ at: at(fx1 + m.right / 2, y), text: label, height: s.labelSize, justify: "centre" });
    }
  }
  if (s.crop === "outline" || s.crop === "both") outlines.push(rect(x0, y0, x1, y1));
  if (s.crop === "crops" || s.crop === "both") {
    for (const [cx, cy] of [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]) {
      // a cross on the sheet's corner
      lines.push([at(cx - CROP_MM, cy), at(cx + CROP_MM, cy)], [at(cx, cy - CROP_MM), at(cx, cy + CROP_MM)]);
    }
  }
  return { heavy, outlines, lines, texts };
}
