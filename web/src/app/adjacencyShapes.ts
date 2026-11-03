// The figures behind Space Planning's adjacency tools: a link's ends and weight, the adjacency score, the
// adjacency matrix's diamond grid, the stacking diagram's rows, and reading an adjacency matrix spreadsheet.

import type { Pt } from "../core/index.ts";

export const MIN_STRENGTH = 1;
export const MAX_STRENGTH = 18;

export const clampStrength = (n: number): number => Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, Math.round(n) || MIN_STRENGTH));

/** A link's line weight in mils: 7 for the weakest, 126 (3.2 mm) for the strongest. */
export const linkWeight = (strength: number): number => clampStrength(strength) * 7;

const H_LEFT = 1;
const H_CENTRE = 2;
const H_RIGHT = 3;
/** how wide a character reads, of the text's height */
const CHAR_WIDTH = 0.62;
const textWidth = (text: string, height: number): number => text.length * CHAR_WIDTH * height;

/** Where the line from a to b crosses the ring's edges, as fractions along it. */
function crossings(a: Pt, b: Pt, ring: readonly Pt[]): number[] {
  const out: number[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const under = dx * ey - dy * ex;
    if (Math.abs(under) < 1e-9) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / under;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / under;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push(t);
  }
  return out;
}

/**
 * The part of a link drawn between its spaces: the line between their centres, from where it leaves the first
 * boundary to where it reaches the second. Spaces that overlap are joined centre to centre.
 */
export function linkEnds(a: Pt, ringA: readonly Pt[], b: Pt, ringB: readonly Pt[]): [Pt, Pt] {
  const from = Math.max(0, ...crossings(a, b, ringA));
  const to = Math.min(1, ...crossings(a, b, ringB));
  if (from >= to) return [a, b];
  const at = (t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return [at(from), at(to)];
}

/** The sum over the links of length × strength: the lower, the closer the strongly related spaces lie. */
export const adjacencyScore = (links: readonly { readonly length: number; readonly strength: number }[]): number => links.reduce((sum, l) => sum + l.length * l.strength, 0);

export interface DiagramText {
  readonly at: Pt;
  readonly text: string;
  readonly height: number;
  readonly hAlign: 1 | 2 | 3;
}

export interface MatrixCell {
  /** rows of the two spaces, i before j */
  readonly i: number;
  readonly j: number;
  readonly strength: number;
}

export interface MatrixDrawing {
  readonly boxes: readonly (readonly Pt[])[];
  readonly lines: readonly (readonly [Pt, Pt])[];
  readonly texts: readonly DiagramText[];
  readonly width: number;
  readonly height: number;
}

/**
 * An adjacency matrix from its top left corner: a box for each space's name, and to the right of them a
 * triangle of diamonds, the one where two spaces' rows meet holding their link's strength.
 */
export function matrixDrawing(names: readonly string[], cells: readonly MatrixCell[], textHeight: number, heightScale: number, widthScale: number): MatrixDrawing {
  const n = names.length;
  const rowHeight = textHeight * 2 * heightScale;
  const pad = textHeight * 0.5;
  const nameWidth = (Math.max(...names.map((name) => textWidth(name, textHeight)), textHeight * 6) + 2 * pad) * widthScale;
  const halfCell = (rowHeight / 2) * widthScale;
  const rowTop = (k: number): number => -k * rowHeight;
  const boxes: Pt[][] = [];
  const texts: DiagramText[] = [];
  names.forEach((name, i) => {
    boxes.push([
      { x: 0, y: rowTop(i) },
      { x: nameWidth, y: rowTop(i) },
      { x: nameWidth, y: rowTop(i + 1) },
      { x: 0, y: rowTop(i + 1) },
    ]);
    texts.push({ at: { x: pad, y: rowTop(i) - rowHeight / 2 }, text: name, height: textHeight, hAlign: H_LEFT });
  });
  const lines: [Pt, Pt][] = [];
  for (let k = 0; k <= n; k++) {
    const start = { x: nameWidth, y: rowTop(k) };
    if (k < n) lines.push([start, { x: nameWidth + (n - k) * halfCell, y: rowTop(k) - ((n - k) * rowHeight) / 2 }]);
    if (k > 0) lines.push([start, { x: nameWidth + k * halfCell, y: rowTop(k) + (k * rowHeight) / 2 }]);
  }
  for (const c of cells) {
    texts.push({ at: { x: nameWidth + (c.j - c.i) * halfCell, y: -((c.i + c.j) / 2 + 0.5) * rowHeight }, text: String(c.strength), height: textHeight, hAlign: H_CENTRE });
  }
  return { boxes, lines, texts, width: nameWidth + n * halfCell, height: n * rowHeight };
}

export interface StackSpace<F> {
  readonly name: string;
  readonly department: string;
  /** in the unit areaText reads */
  readonly area: number;
  readonly fill: F;
}

export interface StackRow<F> {
  readonly name: string;
  readonly elevation: number;
  readonly spaces: readonly StackSpace<F>[];
}

export interface StackOptions {
  readonly textHeight: number;
  readonly heightScale: number;
  readonly widthScale: number;
  readonly gapScale: number;
  readonly showTotals: boolean;
  readonly areaText: (area: number) => string;
}

export interface StackDrawing<F> {
  readonly segments: readonly { readonly points: readonly Pt[]; readonly fill: F }[];
  readonly outlines: readonly (readonly Pt[])[];
  /** between spaces of different departments */
  readonly heavy: readonly (readonly [Pt, Pt])[];
  /** between neighbours in one department */
  readonly thin: readonly (readonly [Pt, Pt])[];
  readonly texts: readonly DiagramText[];
  readonly width: number;
  readonly height: number;
}

/** Spaces with a department come together, in the order the first of each is met; the rest stay in order. */
function byDepartment<T extends { readonly department: string }>(spaces: readonly T[]): T[] {
  const order = new Map<string, number>();
  for (const s of spaces) if (!order.has(s.department)) order.set(s.department, order.size);
  return spaces.map((s, i) => ({ s, i })).sort((a, b) => (order.get(a.s.department) ?? 0) - (order.get(b.s.department) ?? 0) || a.i - b.i).map((x) => x.s);
}

/**
 * A stacking diagram from its top left corner: a row for each floor, the highest on top, its name and area to
 * the left and its spaces across it, as wide as their areas. A name that doesn't fit its space goes above or
 * below it, by turns.
 */
export function stackDrawing<F>(rows: readonly StackRow<F>[], options: StackOptions): StackDrawing<F> {
  const { textHeight, heightScale, widthScale, gapScale, showTotals, areaText } = options;
  const floors = [...rows].sort((a, b) => b.elevation - a.elevation);
  const totals = floors.map((r) => r.spaces.reduce((sum, s) => sum + s.area, 0));
  const titles = floors.map((r, i) => `${r.name}  ${areaText(totals[i])}`);
  const grand = totals.reduce((a, b) => a + b, 0);
  const grandTitle = `Total  ${areaText(grand)}`;
  const titleWidth = Math.max(...titles.map((t) => textWidth(t, textHeight)), showTotals ? textWidth(grandTitle, textHeight) : 0, 0);
  const rowHeight = textHeight * 3 * heightScale;
  const gap = textHeight * 4 * gapScale;
  const left = titleWidth + textHeight * 2;
  const across = textHeight * 60 * widthScale;
  const most = Math.max(...totals, 0);
  const perArea = most > 0 ? across / most : 0;
  const segments: { points: Pt[]; fill: F }[] = [];
  const outlines: Pt[][] = [];
  const heavy: [Pt, Pt][] = [];
  const thin: [Pt, Pt][] = [];
  const texts: DiagramText[] = [];
  let top = -textHeight * 2 * gapScale;
  floors.forEach((row, r) => {
    const bottom = top - rowHeight;
    const right = left + totals[r] * perArea;
    outlines.push([
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]);
    texts.push({ at: { x: titleWidth, y: (top + bottom) / 2 }, text: titles[r], height: textHeight, hAlign: H_RIGHT });
    let x = left;
    let above = true;
    let before: StackSpace<F> | null = null;
    for (const s of byDepartment(row.spaces)) {
      const next = x + s.area * perArea;
      segments.push({
        points: [
          { x, y: top },
          { x: next, y: top },
          { x: next, y: bottom },
          { x, y: bottom },
        ],
        fill: s.fill,
      });
      if (before) (before.department && before.department === s.department ? thin : heavy).push([{ x, y: top }, { x, y: bottom }]);
      if (textWidth(s.name, textHeight) <= next - x) texts.push({ at: { x: (x + next) / 2, y: (top + bottom) / 2 }, text: s.name, height: textHeight, hAlign: H_CENTRE });
      else {
        texts.push({ at: { x: (x + next) / 2, y: above ? top + textHeight : bottom - textHeight }, text: s.name, height: textHeight, hAlign: H_CENTRE });
        above = !above;
      }
      before = s;
      x = next;
    }
    top = bottom - gap;
  });
  let height = -top - gap;
  if (showTotals) {
    texts.push({ at: { x: titleWidth, y: -height - textHeight * 2 }, text: grandTitle, height: textHeight, hAlign: H_RIGHT });
    height += textHeight * 3;
  }
  return { segments, outlines, heavy, thin, texts, width: left + across, height };
}

/** A whole file's rows and fields, by a delimiter, with "quoted" fields as a spreadsheet writes them. */
export function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && !field) quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface AdjacencyColumns {
  /** column numbers, from 1; 0 for a department means there's none */
  readonly department: number;
  readonly space: number;
  readonly area: number;
  /** the first of the columns holding relationships */
  readonly relationships: number;
}

export interface AdjacencyOptions {
  readonly headerRows: number;
  /** 1 for a space name on every other row, 0 for one on every row */
  readonly rowSpacing: 0 | 1;
  readonly columns: AdjacencyColumns;
}

export interface ImportedSpace {
  readonly name: string;
  readonly department: string;
  /** 0 when the file gives none */
  readonly area: number;
}

export interface ImportedLink {
  /** rows of the two spaces in `spaces` */
  readonly a: number;
  readonly b: number;
  readonly strength: number;
}

export interface AdjacencyTable {
  readonly spaces: readonly ImportedSpace[];
  readonly links: readonly ImportedLink[];
  /** relationships that fall on no two spaces */
  readonly leftOut: number;
}

const cellOf = (row: readonly string[], column: number): string => (column > 0 ? (row[column - 1] ?? "").trim() : "");

/** The data rows of a file: without its header, or the empty rows at its end. */
function dataRows(rows: readonly (readonly string[])[], headerRows: number): (readonly string[])[] {
  const data = rows.slice(headerRows);
  while (data.length && data[data.length - 1].every((c) => !c.trim())) data.pop();
  return data;
}

/**
 * Reads an adjacency matrix. With a space on every other row the relationships lie in a diamond, as a Vectorworks
 * worksheet has them: n columns along, on the row n rows below the one space and n above the other. With a
 * space on every row, n columns along is the space n rows below. A strength reads from a number, from 1 to 18
 * (anything higher is 18); a "-", or anything else, is no relationship. A string says what's wrong.
 */
export function parseAdjacency(rows: readonly (readonly string[])[], options: AdjacencyOptions): AdjacencyTable | string {
  const { columns, rowSpacing, headerRows } = options;
  const data = dataRows(rows, headerRows);
  const step = rowSpacing + 1;
  const spaces: ImportedSpace[] = [];
  for (let r = 0; r < data.length; r += step) {
    const name = cellOf(data[r], columns.space);
    if (!name) return `Row ${r + headerRows + 1} has no space name: check Header Rows, Row Spacing and the Space column.`;
    const area = Number.parseFloat(cellOf(data[r], columns.area).replace(/,/g, ""));
    spaces.push({ name, department: cellOf(data[r], columns.department), area: Number.isFinite(area) && area > 0 ? area : 0 });
  }
  if (!spaces.length) return "That file has no spaces after its header rows.";
  const links: ImportedLink[] = [];
  let leftOut = 0;
  const taken = new Set([columns.department, columns.space, columns.area]);
  data.forEach((row, r) => {
    for (let c = columns.relationships; c <= row.length; c++) {
      if (taken.has(c)) continue;
      const text = cellOf(row, c);
      if (!/^\d+(\.\d+)?$/.test(text) || Number(text) < 1) continue;
      const n = c - columns.relationships + 1;
      const first = rowSpacing ? r - n : r;
      const second = r + n;
      if (first < 0 || first % step || second % step || second >= data.length) {
        leftOut++;
        continue;
      }
      links.push({ a: first / step, b: second / step, strength: clampStrength(Number(text)) });
    }
  });
  return { spaces, links, leftOut };
}

/** Squares with these areas, in rows from the top left corner: each one's corners, and how far they reach. */
export function bubbleGrid(areas: readonly number[], origin: Pt): { rings: Pt[][]; width: number; height: number } {
  const sides = areas.map((a) => Math.sqrt(a));
  const cell = Math.max(...sides, 0) * 1.5;
  const across = Math.ceil(Math.sqrt(areas.length));
  const rings = sides.map((side, i) => {
    const x = origin.x + (i % across) * cell + (cell - side) / 2;
    const y = origin.y - Math.floor(i / across) * cell - (cell - side) / 2;
    return [
      { x, y },
      { x, y: y - side },
      { x: x + side, y: y - side },
      { x: x + side, y },
    ];
  });
  return { rings, width: across * cell, height: Math.ceil(areas.length / across) * cell };
}

/** A short fingerprint of what a diagram was drawn from. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
