// What Dims/Notes' Redline and General Notes tools (tools/notes.ts) lay out, as plain geometry: a
// redline's outline rounded at its corners, as an oval or evened out for a cloud, its tag (the date
// and who authorised and was assigned it over a line, the notation wrapped under it) and the leader
// from the outline to the tag; and a general notes block, a title over numbered notes with hanging
// indents in one or more columns. Text widths are estimated from character counts (the font's own
// widths are not known here). Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";
import { CHAR_WIDTH, type MarkerText } from "./markerShapes.ts";

/** a line of text's pitch against its height */
export const LINE_PITCH = 1.5;

/** `text` broken at spaces into lines no wider than `width` at text height `height`; a word longer than a line stands alone. */
export function wrapText(text: string, width: number, height: number): string[] {
  const most = Math.max(1, Math.floor(width / (CHAR_WIDTH * height)));
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > most) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

/** points along an oval's quarter */
const OVAL_STEPS = 16;

/** The oval inside the box two corners span, anticlockwise. Null when the box has no area. */
export function ovalOutline(a: Pt, b: Pt): Pt[] | null {
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  if (!(rx > 0 && ry > 0)) return null;
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return Array.from({ length: 4 * OVAL_STEPS }, (_, i) => {
    const t = (i * Math.PI) / (2 * OVAL_STEPS);
    return { x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) };
  });
}

/**
 * A closed outline walked round and cut into `n` (3 at the least) equal steps of about `step` along
 * it: an oval's or a freehand stroke's many short sides made into sides long enough to cloud.
 */
export function resampleOutline(outline: readonly Pt[], step: number): Pt[] {
  const sides = outline.map((p, i) => dist(p, outline[(i + 1) % outline.length]));
  const perimeter = sides.reduce((s, d) => s + d, 0);
  if (outline.length < 3 || !(perimeter > 0) || !(step > 0)) return [...outline];
  const n = Math.max(3, Math.round(perimeter / step));
  const out: Pt[] = [];
  let side = 0;
  let before = 0;
  for (let k = 0; k < n; k++) {
    const at = (k * perimeter) / n;
    while (side < sides.length - 1 && before + sides[side] < at) before += sides[side++];
    const a = outline[side];
    const b = outline[(side + 1) % outline.length];
    const t = sides[side] > 0 ? (at - before) / sides[side] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** points along each rounded corner */
const CORNER_STEPS = 6;

/**
 * A closed outline with each corner rounded to `r`, or less where its sides are too short for it
 * (half the shorter side at most).
 */
export function roundCorners(outline: readonly Pt[], r: number): Pt[] {
  const pts = outline.filter((p, i) => dist(p, outline[(i + 1) % outline.length]) > 0);
  if (pts.length < 3 || !(r > 0)) return [...pts];
  const out: Pt[] = [];
  pts.forEach((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const a = { x: (prev.x - p.x) / dist(prev, p), y: (prev.y - p.y) / dist(prev, p) };
    const b = { x: (next.x - p.x) / dist(next, p), y: (next.y - p.y) / dist(next, p) };
    const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
    // a straight run or a reversal has no corner to round
    if (turn < 1e-6 || Math.PI - turn < 1e-6) {
      out.push(p);
      return;
    }
    const most = Math.min(dist(prev, p), dist(next, p)) / 2;
    const back = Math.min(r / Math.tan(turn / 2), most);
    const radius = back * Math.tan(turn / 2);
    const from = { x: p.x + a.x * back, y: p.y + a.y * back };
    const to = { x: p.x + b.x * back, y: p.y + b.y * back };
    const bis = { x: a.x + b.x, y: a.y + b.y };
    const bl = Math.hypot(bis.x, bis.y);
    const c = { x: p.x + (bis.x / bl) * (radius / Math.sin(turn / 2)), y: p.y + (bis.y / bl) * (radius / Math.sin(turn / 2)) };
    const a0 = Math.atan2(from.y - c.y, from.x - c.x);
    let sweep = Math.atan2(to.y - c.y, to.x - c.x) - a0;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    for (let k = 0; k <= CORNER_STEPS; k++) {
      const t = a0 + (sweep * k) / CORNER_STEPS;
      out.push({ x: c.x + radius * Math.cos(t), y: c.y + radius * Math.sin(t) });
    }
  });
  return out;
}

export type TagAlign = "auto" | "left" | "right";

/** A redline's tag: what it says and its sizes, in drawing units. */
export interface RedlineTag {
  /** the lines over the separator, top first: the date, who authorised it, who is assigned it */
  readonly info: readonly string[];
  readonly notation: string;
  readonly align: TagAlign;
  /** the separator's length, which the notation wraps to */
  readonly length: number;
  readonly height: number;
  /** how far up and out past the outline's top corner the tag's point stands */
  readonly offset: number;
}

/** A redline's tag laid out: its point, the leader to it, the separator and the texts. */
export interface RedlineLayout {
  readonly point: Pt;
  readonly leader: Pt[];
  readonly separator: Pt[];
  readonly texts: MarkerText[];
}

/**
 * The tag beside a redline round `outline`: its point up and out past the outline's top corner on
 * the side alignment picks (Auto: right), a leader from the outline's nearest point to it, the
 * separator running from the point away from the outline (Left: to the left), the info over it and
 * the notation wrapped under it. Null for an outline with no size.
 */
export function redlineTag(outline: readonly Pt[], tag: RedlineTag): RedlineLayout | null {
  if (outline.length < 3 || !(tag.height > 0) || !(tag.length > 0)) return null;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const left = tag.align === "left";
  const point = { x: (left ? Math.min(...xs) - tag.offset : Math.max(...xs) + tag.offset), y: Math.max(...ys) + tag.offset };
  const near = outline.reduce((best, p) => (dist(p, point) < dist(best, point) ? p : best), outline[0]);
  const end = { x: point.x + (left ? -tag.length : tag.length), y: point.y };
  const h = tag.height;
  const pitch = LINE_PITCH * h;
  const x = point.x + (left ? -0.3 * h : 0.3 * h);
  const justify = left ? "right" : "left";
  const texts: MarkerText[] = [];
  const info = tag.info.filter(Boolean);
  info.forEach((text, i) => texts.push({ at: { x, y: point.y + 0.5 * pitch + (info.length - 1 - i) * pitch }, text, height: h, justify }));
  wrapText(tag.notation, tag.length, h)
    .filter(Boolean)
    .forEach((text, i) => texts.push({ at: { x, y: point.y - 0.5 * pitch - i * pitch }, text, height: h, justify }));
  return { point, leader: [near, point], separator: [point, end], texts };
}

export type NoteNumbers = "1" | "1." | "A" | "A." | "a" | "a.";
export type BodyAlign = "left" | "centre" | "right";

/** A general notes block's settings, sizes in drawing units. */
export interface GeneralNotesLook {
  readonly title: string;
  readonly numbers: NoteNumbers;
  readonly prefix: string;
  readonly suffix: string;
  /** each column's width */
  readonly width: number;
  /** the hanging indent: where a note's text starts past its number */
  readonly indent: number;
  /** blank lines between notes */
  readonly spacing: number;
  readonly columns: number;
  readonly gutter: number;
  /** whether a note may run on into the next column */
  readonly breakAcross: boolean;
  readonly align: BodyAlign;
  readonly titleHeight: number;
  readonly height: number;
}

/** A note's mark: its count as a number or letters (27 → AA), with the prefix and suffix. */
function noteMark(i: number, look: GeneralNotesLook): string {
  let mark = String(i + 1);
  if (look.numbers.startsWith("A") || look.numbers.startsWith("a")) {
    mark = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) mark = String.fromCharCode(65 + ((n - 1) % 26)) + mark;
    if (look.numbers.startsWith("a")) mark = mark.toLowerCase();
  }
  return `${look.prefix}${mark}${look.numbers.endsWith(".") ? "." : ""}${look.suffix}`;
}

/** A general notes block laid out: its texts and the title's underline. */
export interface GeneralNotesLayout {
  readonly texts: MarkerText[];
  readonly lines: Pt[][];
}

/**
 * A general notes block with its top left at `at`: the title, underlined, then each note's mark
 * with its text wrapped beside it at the hanging indent, `spacing` lines between notes, filling
 * columns left to right to about the same depth. Null without notes or with no room for text.
 */
export function generalNotes(at: Pt, notes: readonly string[], look: GeneralNotesLook): GeneralNotesLayout | null {
  const body = look.width - look.indent;
  if (notes.length === 0 || !(body > 0) || !(look.height > 0) || !(look.columns >= 1)) return null;
  const h = look.height;
  const pitch = LINE_PITCH * h;
  const texts: MarkerText[] = [];
  const lines: Pt[][] = [];
  let top = at.y;
  if (look.title) {
    const th = look.titleHeight;
    texts.push({ at: { x: at.x, y: top - th / 2 }, text: look.title, height: th, justify: "left" });
    const under = top - th - 0.25 * th;
    lines.push([{ x: at.x, y: under }, { x: at.x + Math.min(look.width, CHAR_WIDTH * th * look.title.length), y: under }]);
    top = under - 0.6 * pitch;
  }
  // every row the notes take, with `spacing` blank rows between notes
  type Row = { note: number; first: boolean; text: string } | null;
  const blocks: Row[][] = notes.map((n, i) => wrapText(n, body, h).map((text, k) => ({ note: i, first: k === 0, text })));
  const gap = Math.max(0, Math.round(look.spacing));
  const total = blocks.reduce((s, b) => s + b.length, 0) + gap * (blocks.length - 1);
  const depth = Math.ceil(total / look.columns);
  const columns: Row[][] = [[]];
  blocks.forEach((block) => {
    let col = columns[columns.length - 1];
    // a whole note moves on when it would overrun the column; one broken across moves on row by row
    if (!look.breakAcross && col.length > 0 && columns.length < look.columns && col.length + gap + block.length > depth) {
      col = [];
      columns.push(col);
    }
    if (col.length > 0) for (let g = 0; g < gap; g++) col.push(null);
    for (const row of block) {
      if (look.breakAcross && col.length >= depth && columns.length < look.columns) {
        col = [];
        columns.push(col);
      }
      col.push(row);
    }
  });
  columns.forEach((col, c) => {
    const x0 = at.x + c * (look.width + look.gutter);
    col.forEach((row, k) => {
      if (!row) return;
      const y = top - pitch / 2 - k * pitch;
      if (row.first) texts.push({ at: { x: x0, y }, text: noteMark(row.note, look), height: h, justify: "left" });
      const x = look.align === "left" ? x0 + look.indent : look.align === "right" ? x0 + look.width : x0 + look.indent + body / 2;
      if (row.text) texts.push({ at: { x, y }, text: row.text, height: h, justify: look.align });
    });
  });
  return { texts, lines };
}
