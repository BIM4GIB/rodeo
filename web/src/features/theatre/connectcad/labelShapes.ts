// The sums behind Create Labels' label sheets (labels.ts): a label format lays labels out on pages
// (labels across and down, margins, label size and pitch, copies of each), one label for each row of a
// worksheet, and draws on each what its items say: text with {n} standing for the row's column n,
// a QR code of a column, and a column's digits in the resistor colour code. In mm from a page's or a
// label's top left, y down. The formats are Rodeo's, common Avery sheets, not Vectorworks' own. Kept
// apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { hyperlinkQr } from "../../../app/hyperlinkShapes.ts";

export const LABEL_TYPES = ["Cable", "Equipment", "Device", "Lighting Device"] as const;
export type LabelType = (typeof LABEL_TYPES)[number];

export const CUSTOM_PAGE = "Custom";
export const PAGE_SIZES: readonly { readonly name: string; readonly width: number; readonly height: number }[] = [
  { name: "Letter", width: 215.9, height: 279.4 },
  { name: "Legal", width: 215.9, height: 355.6 },
  { name: "Tabloid", width: 279.4, height: 431.8 },
  { name: "A4", width: 210, height: 297 },
  { name: "A3", width: 297, height: 420 },
];

export type Align = "left" | "center" | "right";
export const ALIGNS: readonly Align[] = ["left", "center", "right"];

/** What a label format draws on each label, from its top left. */
export type LabelItem =
  /** text, {n} standing for column n of the row (1 first); with none it's the same on every label */
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly size: number; readonly text: string; readonly align: Align; readonly bold: boolean }
  /** a QR code of column n, `size` square with its margin */
  | { readonly kind: "qr"; readonly x: number; readonly y: number; readonly size: number; readonly column: number }
  /** the last `digits` digits of column n, each on its colour */
  | { readonly kind: "color"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly column: number; readonly digits: number };
export type ItemKind = LabelItem["kind"];

/** How labels lie on a page. */
export interface LabelSheet {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly across: number;
  readonly down: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly left: number;
  readonly top: number;
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly hPitch: number;
  readonly vPitch: number;
  readonly copies: number;
}

export interface LabelFormat extends LabelSheet {
  readonly name: string;
  readonly description: string;
  readonly type: LabelType;
  readonly page: string;
  readonly items: readonly LabelItem[];
}

const IN = 25.4;
const PAD = 2.5;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** A cable label's items: its number large, where it runs from and to, its signal and cable, a QR code of its number, and its number's colours when there's room. */
function cableItems(w: number, h: number, colours: boolean): LabelItem[] {
  const q = r1(Math.min(h - 2 * PAD, w * 0.3));
  const big = r1(Math.min(5, h * 0.18));
  const small = r1(Math.min(2.5, h * 0.088));
  const gap = small * 1.6;
  const y = PAD + big + small;
  const items: LabelItem[] = [
    { kind: "text", x: PAD, y: PAD, size: big, text: "{1}", align: "left", bold: true },
    { kind: "text", x: PAD, y, size: small, text: "From {4} : {5}", align: "left", bold: false },
    { kind: "text", x: PAD, y: r1(y + gap), size: small, text: "To {6} : {7}", align: "left", bold: false },
    { kind: "text", x: PAD, y: r1(y + 2 * gap), size: small, text: "{2} {3}", align: "left", bold: false },
    { kind: "qr", x: r1(w - PAD - q), y: r1((h - q) / 2), size: q, column: 1 },
  ];
  if (colours) items.push({ kind: "color", x: PAD, y: r1(h - PAD - big), width: r1(big * 4.5), height: big, column: 1, digits: 3 });
  return items;
}

/** An equipment or device label's items: its name large, the next two columns, and a QR code of its name. */
function namedItems(w: number, h: number): LabelItem[] {
  const q = r1(Math.min(h - 2 * PAD, w * 0.3));
  const big = r1(Math.min(6, h * 0.2));
  const small = r1(Math.min(3, h * 0.1));
  return [
    { kind: "text", x: PAD, y: PAD, size: big, text: "{1}", align: "left", bold: true },
    { kind: "text", x: PAD, y: r1(PAD + big + small), size: small, text: "{2}", align: "left", bold: false },
    { kind: "text", x: PAD, y: r1(PAD + big + 2.6 * small), size: small, text: "{3}", align: "left", bold: false },
    ...(q >= 10 ? [{ kind: "qr", x: r1(w - PAD - q), y: r1((h - q) / 2), size: q, column: 1 } as const] : []),
  ];
}

const sheet = (page: string, across: number, down: number, left: number, top: number, w: number, h: number, hPitch: number, vPitch: number, copies: number): Omit<LabelFormat, "name" | "description" | "type" | "items"> => {
  const size = PAGE_SIZES.find((p) => p.name === page)!;
  return { page, pageWidth: size.width, pageHeight: size.height, across, down, offsetX: 0, offsetY: 0, left, top, labelWidth: w, labelHeight: h, hPitch, vPitch, copies };
};

/** Rodeo's label formats: common Avery sheets, their sizes as Avery publishes them. */
export const LABEL_FORMATS: readonly LabelFormat[] = [
  { name: "Avery 5160", description: "Cable labels, 30 to a Letter sheet (2⅝ × 1 in), a pair for each cable", type: "Cable", ...sheet("Letter", 3, 10, 0.1875 * IN, 0.5 * IN, 2.625 * IN, IN, 2.75 * IN, IN, 2), items: cableItems(2.625 * IN, IN, false) },
  { name: "Avery L7160", description: "Cable labels, 21 to an A4 sheet (63.5 × 38.1 mm), a pair for each cable, with colour-coded numbers", type: "Cable", ...sheet("A4", 3, 7, 7.25, 15.15, 63.5, 38.1, 66.04, 38.1, 2), items: cableItems(63.5, 38.1, true) },
  { name: "Avery 5163", description: "Equipment labels, 10 to a Letter sheet (4 × 2 in)", type: "Equipment", ...sheet("Letter", 2, 5, 0.15625 * IN, 0.5 * IN, 4 * IN, 2 * IN, 4.1875 * IN, 2 * IN, 1), items: namedItems(4 * IN, 2 * IN) },
  { name: "Avery L7163", description: "Equipment labels, 14 to an A4 sheet (99.1 × 38.1 mm)", type: "Equipment", ...sheet("A4", 2, 7, 4.65, 15.15, 99.1, 38.1, 101.6, 38.1, 1), items: namedItems(99.1, 38.1) },
  { name: "Avery L7651", description: "Device labels, 65 to an A4 sheet (38.1 × 21.2 mm)", type: "Device", ...sheet("A4", 5, 13, 4.75, 10.7, 38.1, 21.2, 40.64, 21.2, 1), items: namedItems(38.1, 21.2) },
  { name: "Avery 5160 Lighting", description: "Lighting device labels, 30 to a Letter sheet (2⅝ × 1 in)", type: "Lighting Device", ...sheet("Letter", 3, 10, 0.1875 * IN, 0.5 * IN, 2.625 * IN, IN, 2.75 * IN, IN, 1), items: namedItems(2.625 * IN, IN) },
];

/** A format's label type for a worksheet's first row: a circuit report's is Cable. */
export function typeFor(header: readonly string[]): LabelType {
  const h = header.map((c) => c.trim().toLowerCase());
  if (h.includes("source device") || h.includes("destination device")) return "Cable";
  if (h.includes("rack u") || h.includes("height ru")) return "Equipment";
  if (h.some((c) => /^(channel|unit number|instrument type|position|dimmer)$/.test(c))) return "Lighting Device";
  return "Device";
}

/** Text with {n} filled from `row`'s column n (1 first); a column the row hasn't is empty. */
export const fillTemplate = (template: string, row: readonly string[]): string => template.replace(/\{(\d+)\}/g, (_, n: string) => row[Number(n) - 1]?.trim() ?? "");

/** The rows labels are made for: past the `skip` top ones, and not empty. */
export const labelRows = (rows: readonly (readonly string[])[], skip: number): string[][] => rows.slice(Math.max(0, Math.round(skip))).filter((r) => r.some((c) => c.trim())).map((r) => [...r]);

const whole = (n: number): number => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
const perPage = (s: LabelSheet): number => whole(s.across) * whole(s.down);

/** How many pages `count` rows' labels take, copies and all: one at least. */
export const pagesFor = (s: LabelSheet, count: number): number => Math.max(1, Math.ceil((count * whole(s.copies)) / perPage(s)));

/** Each label to draw: its row, its page, and its top left on that page. */
export function labelPlaces(s: LabelSheet, count: number): { row: number; page: number; x: number; y: number }[] {
  const copies = whole(s.copies);
  const across = whole(s.across);
  const n = perPage(s);
  return Array.from({ length: count * copies }, (_, i) => {
    const j = i % n;
    const col = j % across;
    const line = Math.floor(j / across);
    return { row: Math.floor(i / copies), page: Math.floor(i / n), x: s.left + s.offsetX + col * s.hPitch, y: s.top + s.offsetY + line * s.vPitch };
  });
}

/** Where problems with a sheet lie: labels that run off the page, or overlap. */
export function sheetProblems(s: LabelSheet): string[] {
  const out: string[] = [];
  const right = s.left + s.offsetX + (whole(s.across) - 1) * s.hPitch + s.labelWidth;
  const bottom = s.top + s.offsetY + (whole(s.down) - 1) * s.vPitch + s.labelHeight;
  if (right > s.pageWidth + 0.01 || bottom > s.pageHeight + 0.01) out.push("the labels run off the page");
  if ((whole(s.across) > 1 && s.hPitch < s.labelWidth - 0.01) || (whole(s.down) > 1 && s.vPitch < s.labelHeight - 0.01)) out.push("the labels overlap: a pitch is less than the label");
  return out;
}

/** The resistor colour code, 0 to 9. */
export const RESISTOR_COLOURS = ["#000000", "#8b4513", "#e00000", "#ff8c00", "#ffd700", "#00a050", "#1f5fff", "#8a2be2", "#808080", "#ffffff"] as const;
/** the digit's ink on its colour: white on the dark ones */
export const digitInk = (d: number): string => ([0, 1, 2, 5, 6, 7, 8].includes(d) ? "#ffffff" : "#000000");

/** The last `count` digits of `value`, padded with 0 in front; "" when it has none. */
export function colourDigits(value: string, count: number): string {
  const digits = value.replace(/\D/g, "");
  return digits ? digits.slice(-whole(count)).padStart(whole(count), "0") : "";
}

/** What a label draws, in mm from its top left, y down. */
export type LabelMark =
  | { readonly kind: "text"; readonly x: number; readonly y: number; readonly size: number; readonly text: string; readonly align: Align; readonly bold: boolean; readonly ink: string }
  | { readonly kind: "box"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly fill: string }
  | { readonly kind: "qr"; readonly back: Pt[]; readonly dark: Pt[] };

/** A label's marks for `row`; a QR code or colour code of an empty column draws nothing, an empty text nothing. */
export function labelMarks(items: readonly LabelItem[], row: readonly string[]): LabelMark[] {
  const out: LabelMark[] = [];
  for (const it of items) {
    if (it.kind === "text") {
      const text = fillTemplate(it.text, row).trim();
      if (text) out.push({ kind: "text", x: it.x, y: it.y, size: it.size, text, align: it.align, bold: it.bold, ink: "#000000" });
    } else if (it.kind === "qr") {
      const value = row[it.column - 1]?.trim() ?? "";
      const qr = value ? hyperlinkQr(value, it.size) : null;
      if (!qr || typeof qr === "string" || !qr.qr) continue;
      // centred on the origin, y up, to the label's top-left frame
      const c = { x: it.x + it.size / 2, y: it.y + it.size / 2 };
      const to = (p: Pt): Pt => ({ x: c.x + p.x, y: c.y - p.y });
      out.push({ kind: "qr", back: qr.qr.back.map(to), dark: qr.qr.dark.map(to) });
    } else {
      const digits = colourDigits(row[it.column - 1] ?? "", it.digits);
      const w = it.width / Math.max(1, digits.length);
      [...digits].forEach((ch, i) => {
        const d = Number(ch);
        const x0 = it.x + i * w;
        out.push({ kind: "box", x0, y0: it.y, x1: x0 + w, y1: it.y + it.height, fill: RESISTOR_COLOURS[d] });
        out.push({ kind: "text", x: x0 + w / 2, y: it.y + it.height * 0.2, size: it.height * 0.6, text: ch, align: "center", bold: true, ink: digitInk(d) });
      });
    }
  }
  return out;
}

/** An item described for the Edit Label table and the tools' hints. */
export function itemSummary(it: LabelItem): string {
  if (it.kind === "text") return it.text;
  return it.kind === "qr" ? `QR code of column ${it.column}` : `${it.digits} colour-coded digits of column ${it.column}`;
}
