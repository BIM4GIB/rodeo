// The sums behind ConnectCAD's panel layouts (panelLayout.ts): a connector panel at its actual size,
// as Create Panel View, the Panel Builder and the Panel Connector tool make it. The panel itself (a
// rack-mount panel so many rack units high, a custom plate, or no graphics at all), each connector's
// footprint by its type, where the Panel Builder puts connectors (from the top left, block after
// block), where an array of them goes and the tags it numbers on, and which of the circuits at a
// port a connector names as connected to. Sizes are in mm; a layout's frame has its origin at the
// panel's top left corner, y up, so the panel lies below it. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";

export const LAYOUT_TYPES = ["No Graphics", "Rack-mount", "Custom"] as const;
export type LayoutType = (typeof LAYOUT_TYPES)[number];
export const RACK_OPENINGS = ["19 in", "10 in"] as const;
export const ARRANGEMENTS = ["Horizontal", "Vertical", "Square"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/** a rack unit, a panel's width for each opening, its ears, and the panel's height short of its units (EIA-310), mm */
export const RACK_UNIT = 44.45;
const RACK_WIDTH: Readonly<Record<string, number>> = { "19 in": 482.6, "10 in": 254 };
const EAR = 15.875;
const SHORT = 0.79;
/** a rack panel's mounting holes: in from its sides, across, and up from each unit's bottom */
const HOLE_IN = 8.75;
const HOLE_D = 6.5;
const HOLE_UP = [6.35, 38.1];
/** a custom plate's corner holes: in from its corners, across */
const PLATE_HOLE_IN = 6;
const PLATE_HOLE_D = 4;

/** What a layout's panel is. */
export interface PanelSpec {
  readonly type: LayoutType;
  readonly ru: number;
  readonly opening: string;
  /** a custom plate's size and whether it has corner holes */
  readonly width: number;
  readonly height: number;
  readonly holes: boolean;
}

/** A mark of a drawing: a circle (filled, for a pin), a rectangle, or an outline. */
export type Mark =
  | { readonly kind: "ring"; readonly at: Pt; readonly r: number; readonly fill?: boolean }
  | { readonly kind: "box"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly fill?: boolean }
  | { readonly kind: "outline"; readonly points: readonly Pt[] };

const units = (ru: number): number => Math.max(1, Math.round(Number.isFinite(ru) ? ru : 1));

/** A panel's width and height; null for no graphics. */
export function panelSize(spec: PanelSpec): { width: number; height: number } | null {
  if (spec.type === "Rack-mount") return { width: RACK_WIDTH[spec.opening] ?? RACK_WIDTH["19 in"], height: units(spec.ru) * RACK_UNIT - SHORT };
  if (spec.type === "Custom") return { width: Math.max(1, spec.width), height: Math.max(1, spec.height) };
  return null;
}

/** The panel's outline and mounting holes. */
export function panelMarks(spec: PanelSpec): Mark[] {
  const size = panelSize(spec);
  if (!size) return [];
  const { width: w, height: h } = size;
  const marks: Mark[] = [{ kind: "box", x0: 0, y0: -h, x1: w, y1: 0 }];
  if (spec.type === "Rack-mount") {
    // the ears' edges, and two holes in each ear for each unit (the panel sits centred in its units)
    marks.push({ kind: "outline", points: [{ x: EAR, y: 0 }, { x: EAR, y: -h }] }, { kind: "outline", points: [{ x: w - EAR, y: 0 }, { x: w - EAR, y: -h }] });
    for (let u = 0; u < units(spec.ru); u++)
      for (const up of HOLE_UP)
        for (const x of [HOLE_IN, w - HOLE_IN]) marks.push({ kind: "ring", at: { x, y: -h - SHORT / 2 + u * RACK_UNIT + up }, r: HOLE_D / 2 });
  } else if (spec.holes)
    for (const x of [PLATE_HOLE_IN, w - PLATE_HOLE_IN]) for (const y of [-PLATE_HOLE_IN, -h + PLATE_HOLE_IN]) marks.push({ kind: "ring", at: { x, y }, r: PLATE_HOLE_D / 2 });
  return marks;
}

/** Where connectors may go on a panel: between x0 and x1, down from top (to bottom, when the panel doesn't grow). */
export function panelRoom(spec: PanelSpec): { x0: number; x1: number; top: number; bottom: number | null } {
  const size = panelSize(spec);
  if (!size) return { x0: 0, x1: Infinity, top: 0, bottom: null };
  if (spec.type === "Rack-mount") return { x0: EAR + 4, x1: size.width - EAR - 4, top: -2, bottom: null };
  const m = spec.holes ? PLATE_HOLE_IN * 2 : 4;
  return { x0: m, x1: size.width - m, top: -m / 2, bottom: -size.height + m / 2 };
}

/** A connector's footprint: its size, the spacing the Panel Builder gives it, and its marks about `at`. */
export interface Footprint {
  readonly family: string;
  readonly width: number;
  readonly height: number;
  readonly pitch: number;
  marks(at: Pt): Mark[];
}

const box = (at: Pt, w: number, h: number, fill = false): Mark => ({ kind: "box", x0: at.x - w / 2, y0: at.y - h / 2, x1: at.x + w / 2, y1: at.y + h / 2, fill });
const ring = (at: Pt, x: number, y: number, r: number, fill = false): Mark => ({ kind: "ring", at: { x: at.x + x, y: at.y + y }, r, fill });
/** a D-series flange (26 × 31) with its two diagonal screw holes */
const flange = (at: Pt): Mark[] => [box(at, 26, 31), ring(at, -9.5, 12, 1.6), ring(at, 9.5, -12, 1.6)];
const trapezoid = (at: Pt, top: number, bottom: number, h: number): Mark => ({
  kind: "outline",
  points: [{ x: at.x - top / 2, y: at.y + h / 2 }, { x: at.x + top / 2, y: at.y + h / 2 }, { x: at.x + bottom / 2, y: at.y - h / 2 }, { x: at.x - bottom / 2, y: at.y - h / 2 }, { x: at.x - top / 2, y: at.y + h / 2 }],
});

const FOOTPRINTS: readonly { readonly match: RegExp; readonly print: Footprint }[] = [
  { match: /speakon|powercon/i, print: { family: "speakON", width: 26, height: 31, pitch: 27, marks: (at) => [...flange(at), ring(at, 0, 0, 12), box({ x: at.x, y: at.y + 10 }, 4, 3, true)] } },
  { match: /xlr|neutrik/i, print: { family: "XLR", width: 26, height: 31, pitch: 27, marks: (at) => [...flange(at), ring(at, 0, 0, 12), ring(at, -4, 2, 1, true), ring(at, 4, 2, 1, true), ring(at, 0, -4, 1, true)] } },
  { match: /hdmi/i, print: { family: "HDMI", width: 26, height: 31, pitch: 27, marks: (at) => [...flange(at), trapezoid(at, 14, 10.5, 5)] } },
  { match: /usb/i, print: { family: "USB", width: 26, height: 31, pitch: 27, marks: (at) => [...flange(at), box(at, 12, 4.5)] } },
  { match: /displayport|dvi|vga|d-?sub|\bdb\d/i, print: { family: "D-Sub", width: 26, height: 31, pitch: 27, marks: (at) => [...flange(at), trapezoid(at, 16, 13, 8)] } },
  { match: /ethercon|rj ?45|cat ?\d|ethernet/i, print: { family: "RJ45", width: 15, height: 19.5, pitch: 18, marks: (at) => [box(at, 15, 19.5), box(at, 11.7, 10), box({ x: at.x, y: at.y - 6 }, 4, 2, true)] } },
  { match: /bnc|sdi/i, print: { family: "BNC", width: 12, height: 12, pitch: 18, marks: (at) => [ring(at, 0, 0, 6), ring(at, 0, 0, 2.5), ring(at, 0, 0, 0.6, true)] } },
  { match: /\blc\b|\bsc\b|\bst\b|fib(er|re)|optic|mpo/i, print: { family: "Fiber", width: 13, height: 10, pitch: 16, marks: (at) => [box(at, 13, 10), box({ x: at.x - 3, y: at.y }, 4, 4), box({ x: at.x + 3, y: at.y }, 4, 4)] } },
  { match: /phoenix|euro|terminal|screw/i, print: { family: "Terminal", width: 7.5, height: 10, pitch: 9, marks: (at) => [box(at, 7.5, 10), ring(at, 0, 1.5, 1.5)] } },
  { match: /trs|\bts\b|jack|1\/4|bantam|\btt\b|mini/i, print: { family: "TRS", width: 11, height: 11, pitch: 16, marks: (at) => [ring(at, 0, 0, 5.5), ring(at, 0, 0, 3.2)] } },
];
const OTHER: Footprint = { family: "Other", width: 20, height: 20, pitch: 26, marks: (at) => [ring(at, 0, 0, 10), { kind: "outline", points: [{ x: at.x - 4, y: at.y - 4 }, { x: at.x + 4, y: at.y + 4 }] }, { kind: "outline", points: [{ x: at.x - 4, y: at.y + 4 }, { x: at.x + 4, y: at.y - 4 }] }] };

/** A connector type's footprint (by the family its name reads as); a ring with a cross for one it doesn't know. */
export const footprint = (connector: string): Footprint => FOOTPRINTS.find((f) => f.match.test(connector))?.print ?? OTHER;

/** A connector in a layout: where it is (its middle), its display tag, the socket it's linked to ("" for none) and its type. */
export interface PanelConnector {
  readonly x: number;
  readonly y: number;
  readonly tag: string;
  readonly socket: string;
  readonly connector: string;
}

/** A Panel Builder row: so many connectors of a type, tagged with a prefix and a number, arranged in a line across, down, or a square. */
export interface BuilderRow {
  readonly qty: number;
  readonly connector: string;
  readonly prefix: string;
  readonly arrange: Arrangement;
}

/** a connector's cell: its spacing across, and down with the writing over it */
const cellOf = (f: Footprint, writing: number): { w: number; h: number } => ({ w: f.pitch, h: Math.max(f.pitch, f.height + writing + 3) });
/** the gap between blocks */
const BLOCK_GAP = 6;

/**
 * The Panel Builder's connectors on a panel, from its top left: each row a block (a line across that
 * wraps at the panel's side, a column, or a square), block after block across and on down below when
 * one doesn't fit; `writing` is the room the writing over each connector takes. A rack-mount panel
 * grows to the units its connectors need.
 */
export function buildPanel(rows: readonly BuilderRow[], spec: PanelSpec, writing: number): { connectors: PanelConnector[]; ru: number } {
  const room = panelRoom(spec);
  const across = room.x1 - room.x0;
  const out: PanelConnector[] = [];
  let x = room.x0;
  let y = room.top;
  let band = 0;
  let n = 0;
  for (const row of rows) {
    const qty = Math.max(0, Math.round(row.qty));
    if (!qty) continue;
    const f = footprint(row.connector);
    const cell = cellOf(f, writing);
    const fit = Number.isFinite(across) ? Math.max(1, Math.floor((across + 1e-6) / cell.w)) : qty;
    const cols = row.arrange === "Vertical" ? 1 : row.arrange === "Square" ? Math.min(fit, Math.ceil(Math.sqrt(qty))) : Math.min(fit, qty);
    const down = Math.ceil(qty / cols);
    const width = cols * cell.w;
    if (x > room.x0 && x + width > room.x1 + 1e-6) {
      x = room.x0;
      y -= band + BLOCK_GAP;
      band = 0;
    }
    for (let i = 0; i < qty; i++) {
      const [col, line] = row.arrange === "Vertical" ? [Math.floor(i / down), i % down] : [i % cols, Math.floor(i / cols)];
      const cx = x + col * cell.w + cell.w / 2;
      const cy = y - line * cell.h - writing - f.height / 2 - 1.5;
      n++;
      out.push({ x: cx, y: cy, tag: row.prefix ? `${row.prefix}${i + 1}` : String(n), socket: "", connector: row.connector });
    }
    x += width + BLOCK_GAP;
    band = Math.max(band, down * cell.h);
  }
  return { connectors: out, ru: unitsNeeded(out, spec) };
}

/** The rack units a rack-mount panel needs to hold its connectors: its own, or more. */
export function unitsNeeded(connectors: readonly PanelConnector[], spec: PanelSpec): number {
  if (spec.type !== "Rack-mount") return units(spec.ru);
  const lowest = Math.min(0, ...connectors.map((c) => c.y - footprint(c.connector).height / 2));
  return Math.max(units(spec.ru), Math.ceil((-lowest + 2 + SHORT) / RACK_UNIT - 1e-9));
}

/** New connectors after a layout's last, cell by cell across its panel, and on below its lowest when a line is full. */
export function appendConnectors(existing: readonly PanelConnector[], add: readonly Omit<PanelConnector, "x" | "y">[], spec: PanelSpec, writing: number): PanelConnector[] {
  const room = panelRoom(spec);
  const out = [...existing];
  const last = existing[existing.length - 1];
  let x = last ? last.x + cellOf(footprint(last.connector), writing).w / 2 : room.x0;
  let y = last ? last.y : null;
  for (const c of add) {
    const f = footprint(c.connector);
    const cell = cellOf(f, writing);
    if (y === null || x + cell.w > room.x1 + 1e-6) {
      const bottom = Math.min(room.top, ...out.map((k) => k.y - footprint(k.connector).height / 2));
      y = bottom - (out.length ? 3 : 0) - writing - f.height / 2 - 1.5;
      x = room.x0;
    }
    out.push({ ...c, x: x + cell.w / 2, y });
    x += cell.w;
  }
  return out;
}

/** The tags an array numbers on from `tag`: its number counted on (keeping its digits), or 1, 2… after it. */
export function nextTags(tag: string, count: number): string[] {
  const m = /^(.*?)(\d+)$/.exec(tag);
  const head = m ? m[1] : tag;
  const first = m ? Number(m[2]) : 1;
  const digits = m ? m[2].length : 0;
  return Array.from({ length: Math.max(0, count) }, (_, i) => `${head}${String(first + i).padStart(digits, "0")}`);
}

/** Connectors along a line from `a` toward `b`, `spacing` apart: as many as fit, one at `a` at least. */
export function arrayAlong(a: Pt, b: Pt, spacing: number): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1e-9 || spacing <= 0) return [a];
  const n = Math.floor(d / spacing + 1e-9) + 1;
  return Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) / d) * spacing * i, y: a.y + ((b.y - a.y) / d) * spacing * i }));
}

/** Connectors in a grid from `a` toward `b`, `spacing` apart both ways, row by row. */
export function arrayGrid(a: Pt, b: Pt, spacing: number): Pt[] {
  if (spacing <= 0) return [a];
  const cols = Math.floor(Math.abs(b.x - a.x) / spacing + 1e-9) + 1;
  const rows = Math.floor(Math.abs(b.y - a.y) / spacing + 1e-9) + 1;
  const sx = b.x >= a.x ? 1 : -1;
  const sy = b.y >= a.y ? 1 : -1;
  return Array.from({ length: rows * cols }, (_, i) => ({ x: a.x + sx * spacing * (i % cols), y: a.y + sy * spacing * Math.floor(i / cols) }));
}

/** The far end of a circuit at a port: its device and socket, whether it's the circuit's source, and what sort of device it is. */
export interface PortEnd {
  readonly device: string;
  readonly socket: string;
  readonly source: boolean;
  readonly rack: boolean;
  readonly jack: boolean;
  readonly panel: boolean;
}

/**
 * The end a connector names as connected to, by Vectorworks' order: a rack device as source, then as
 * destination; a jackfield; a device not in a rack; then a term or connector panel.
 */
export function connectedTo(ends: readonly PortEnd[]): PortEnd | null {
  const rank = (e: PortEnd): number => (e.jack ? 2 : e.panel ? 6 : e.rack ? 0 : 4) + (e.source ? 0 : 1);
  return [...ends].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** The writing over a connector, top first: what it's connected to (device, then socket) and its tag, as shown. */
export function connectorWriting(c: PanelConnector, to: { device: string; socket: string } | null, show: { tag: boolean; device: boolean; socket: boolean }): string[] {
  return [show.device && to?.device ? to.device : "", show.socket && to?.socket ? to.socket : "", show.tag ? c.tag : ""].filter(Boolean);
}

/** What a layout covers, in its frame: its panel, or its connectors (with their writing) when it has none. */
export function layoutBox(spec: PanelSpec, connectors: readonly PanelConnector[], writing: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const size = panelSize(spec);
  if (size) return { x0: 0, y0: -size.height, x1: size.width, y1: 0 };
  if (!connectors.length) return null;
  const f = connectors.map((c) => ({ c, f: footprint(c.connector) }));
  return {
    x0: Math.min(...f.map(({ c, f }) => c.x - f.width / 2)),
    y0: Math.min(...f.map(({ c, f }) => c.y - f.height / 2)),
    x1: Math.max(...f.map(({ c, f }) => c.x + f.width / 2)),
    y1: Math.max(...f.map(({ c, f }) => c.y + f.height / 2 + writing)),
  };
}
