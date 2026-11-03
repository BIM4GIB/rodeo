// What Spotlight's Equipment Summary Key shows and draws: a table of the equipment in the drawing with
// how many of each, under a title and column headers, with a total and summaries of the gels, gobos and
// circuits in use, and the height of a position's devices. Kept apart from its plug-in object
// (features/theatre/docs/equipmentKey.ts) so it runs without the page. Lengths in mm.

import type { Pt } from "../core/index.ts";
import type { Instrument } from "./lightingDeviceShapes.ts";

export interface KeyFixture {
  readonly label: string;
  readonly glyph: Instrument;
  readonly position: string;
  readonly color: string;
  readonly gobo: string;
  readonly circuit: string;
  readonly heightMm: number;
}

export interface KeyOptions {
  readonly title: string;
  /** only the devices on this position, or "" for everything */
  readonly position: string;
  readonly columnHeaders: boolean;
  readonly total: boolean;
  readonly colors: boolean;
  readonly gobos: boolean;
  readonly circuits: boolean;
  readonly positionHeight: boolean;
  /** items left out, by name */
  readonly leftOut: ReadonlySet<string>;
}

export type KeyRow =
  | { readonly kind: "title"; readonly text: string }
  | { readonly kind: "headers" }
  | { readonly kind: "item"; readonly name: string; readonly count: number; readonly glyph?: Instrument }
  | { readonly kind: "total"; readonly count: number }
  | { readonly kind: "section"; readonly text: string }
  | { readonly kind: "summary"; readonly name: string; readonly count: number; readonly swatch?: boolean }
  | { readonly kind: "note"; readonly name: string; readonly value: string };

/** the words to show when devices stand at different heights, as Vectorworks has it */
export const VARIES = "Varies";

/** What's counted of `pick` over the devices, by name, skipping empties. */
function tally(list: readonly KeyFixture[], pick: (f: KeyFixture) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const f of list) {
    const k = pick(f).trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

/** The key's rows; `others` is the other equipment in the drawing and how many, and `formatHeight` a height as the drawing shows it. */
export function keyRows(fixtures: readonly KeyFixture[], others: readonly (readonly [string, number])[], o: KeyOptions, formatHeight: (mm: number) => string): KeyRow[] {
  const list = o.position ? fixtures.filter((f) => f.position.trim() === o.position) : fixtures;
  const rows: KeyRow[] = [];
  if (o.title.trim()) rows.push({ kind: "title", text: o.title.trim() });
  if (o.columnHeaders) rows.push({ kind: "headers" });
  const glyphs = new Map(list.map((f) => [f.label, f.glyph]));
  const items: { name: string; count: number; glyph?: Instrument }[] = tally(list, (f) => f.label).map(([name, count]) => ({ name, count, glyph: glyphs.get(name) }));
  if (!o.position) for (const [name, count] of others) items.push({ name, count });
  const shown = items.filter((i) => !o.leftOut.has(i.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const i of shown) rows.push({ kind: "item", ...i });
  if (o.total) rows.push({ kind: "total", count: shown.reduce((a, i) => a + i.count, 0) });
  // the summaries go by what's listed
  const counted = list.filter((f) => !o.leftOut.has(f.label));
  const section = (on: boolean, text: string, pick: (f: KeyFixture) => string, swatch: boolean): void => {
    const t = on ? tally(counted, pick) : [];
    if (!t.length) return;
    rows.push({ kind: "section", text });
    for (const [name, count] of t) rows.push({ kind: "summary", name, count, swatch });
  };
  section(o.colors, "Colors", (f) => f.color, true);
  section(o.gobos, "Gobos", (f) => f.gobo, false);
  section(o.circuits, "Circuits", (f) => f.circuit, false);
  if (o.positionHeight && counted.length) {
    const first = counted[0].heightMm;
    const same = o.position !== "" && counted.every((f) => Math.abs(f.heightMm - first) < 0.5);
    rows.push({ kind: "note", name: "Position Height", value: same ? formatHeight(first) : VARIES });
  }
  return rows;
}

export type KeyCorner = "tl" | "bl" | "tr" | "br";

export interface KeyText {
  readonly at: Pt;
  readonly text: string;
  readonly height: number;
  /** 1 left, 3 right */
  readonly hAlign: 1 | 3;
}

export interface KeyDrawing {
  readonly texts: readonly KeyText[];
  readonly lines: readonly (readonly [Pt, Pt])[];
  /** the border's corners, when it has one */
  readonly border: readonly Pt[] | null;
  /** a device's outline to draw, this high, in the middle of a row's first column */
  readonly glyphs: readonly { readonly glyph: Instrument; readonly at: Pt; readonly size: number }[];
  readonly swatches: readonly { readonly name: string; readonly points: readonly Pt[] }[];
  readonly width: number;
  readonly height: number;
}

/** how wide a character of text is against its height, for laying out the columns */
const CHAR_WIDTH = 0.62;
const ROW = 1.7;
const PAD = 0.7;
const TITLE = 1.25;

/** The rows laid out as a table, with the corner `corner` at the origin; `height` is the text's height. */
export function keyDrawing(rows: readonly KeyRow[], height: number, corner: KeyCorner, swatch: boolean, border: boolean): KeyDrawing {
  const widthOf = (text: string, h = height): number => text.length * h * CHAR_WIDTH;
  const thumbs = rows.some((r) => r.kind === "item" && r.glyph) || (swatch && rows.some((r) => r.kind === "summary" && r.swatch));
  const thumbW = thumbs ? height * 3 : 0;
  let nameW = 0;
  let countW = widthOf("Count");
  let wholeW = 0;
  for (const r of rows) {
    if (r.kind === "title") wholeW = Math.max(wholeW, widthOf(r.text, height * TITLE));
    if (r.kind === "section") nameW = Math.max(nameW, widthOf(r.text));
    if (r.kind === "headers") nameW = Math.max(nameW, widthOf("Description"));
    if (r.kind === "item" || r.kind === "summary") {
      nameW = Math.max(nameW, widthOf(r.name));
      countW = Math.max(countW, widthOf(String(r.count)));
    }
    if (r.kind === "total") {
      nameW = Math.max(nameW, widthOf("Total"));
      countW = Math.max(countW, widthOf(String(r.count)));
    }
    if (r.kind === "note") {
      nameW = Math.max(nameW, widthOf(r.name));
      countW = Math.max(countW, widthOf(r.value));
    }
  }
  const pad = height * PAD;
  const gap = height * 2;
  const inner = Math.max(thumbW + nameW + gap + countW, wholeW);
  const width = inner + 2 * pad;
  const rowH = height * ROW;
  const tall = rows.reduce((a, r) => a + (r.kind === "title" ? rowH * TITLE : rowH), 0) + 2 * pad;
  // the top left corner's frame, then moved to the corner asked for
  const dx = corner === "tr" || corner === "br" ? -width : 0;
  const dy = corner === "bl" || corner === "br" ? tall : 0;
  const pt = (x: number, y: number): Pt => ({ x: x + dx, y: y + dy });
  const texts: KeyText[] = [];
  const lines: [Pt, Pt][] = [];
  const glyphs: { glyph: Instrument; at: Pt; size: number }[] = [];
  const swatches: { name: string; points: Pt[] }[] = [];
  const left = pad;
  const name = pad + thumbW;
  const right = width - pad;
  let y = -pad;
  const rule = (at: number): void => {
    lines.push([pt(pad, at), pt(width - pad, at)]);
  };
  for (const r of rows) {
    const h = r.kind === "title" ? rowH * TITLE : rowH;
    const mid = y - h / 2;
    switch (r.kind) {
      case "title":
        texts.push({ at: pt(left, mid), text: r.text, height: height * TITLE, hAlign: 1 });
        rule(y - h);
        break;
      case "headers":
        texts.push({ at: pt(name, mid), text: "Description", height, hAlign: 1 }, { at: pt(right, mid), text: "Count", height, hAlign: 3 });
        rule(y - h);
        break;
      case "item":
        if (r.glyph) glyphs.push({ glyph: r.glyph, at: pt(left + thumbW / 2, mid), size: height * 1.3 });
        texts.push({ at: pt(name, mid), text: r.name, height, hAlign: 1 }, { at: pt(right, mid), text: String(r.count), height, hAlign: 3 });
        break;
      case "total":
        rule(y);
        texts.push({ at: pt(name, mid), text: "Total", height, hAlign: 1 }, { at: pt(right, mid), text: String(r.count), height, hAlign: 3 });
        break;
      case "section":
        rule(y);
        texts.push({ at: pt(left, mid), text: r.text, height, hAlign: 1 });
        break;
      case "summary":
        if (r.swatch && swatch) {
          const s = height * 0.6;
          const cx = left + thumbW / 2;
          swatches.push({ name: r.name, points: [pt(cx - s, mid - s), pt(cx + s, mid - s), pt(cx + s, mid + s), pt(cx - s, mid + s)] });
        }
        texts.push({ at: pt(name, mid), text: r.name, height, hAlign: 1 }, { at: pt(right, mid), text: String(r.count), height, hAlign: 3 });
        break;
      case "note":
        rule(y);
        texts.push({ at: pt(name, mid), text: r.name, height, hAlign: 1 }, { at: pt(right, mid), text: r.value, height, hAlign: 3 });
        break;
    }
    y -= h;
  }
  return {
    texts,
    lines,
    border: border ? [pt(0, 0), pt(width, 0), pt(width, -tall), pt(0, -tall)] : null,
    glyphs,
    swatches,
    width,
    height: tall,
  };
}
