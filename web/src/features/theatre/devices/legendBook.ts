// A drawing's label legends (Spotlight's Label Legend Manager): each a name, whether it turns with its
// devices, and the labels it shows in order, each an instrument field at a spot round the device in a
// container, right-reading or not, at a size against the device's Label Size. The active one goes on
// devices as they're placed. Kept as show data (show.ts) under KEY; this file is the pure part.

import { LABEL_BOXES, LABEL_SPOTS, type LabelBox, type LabelSpot } from "../../../app/labelLegend.ts";

export const LEGEND_KEY = "labelLegends";

/** The instrument fields a label can show, in the order the legend editor lists them. */
export const LEGEND_FIELDS = [
  { id: "channel", label: "Channel" },
  { id: "unit", label: "Unit Number" },
  { id: "type", label: "Instrument Type" },
  { id: "position", label: "Position" },
  { id: "purpose", label: "Purpose" },
  { id: "color", label: "Color" },
  { id: "gobo", label: "Gobo" },
  { id: "dimmer", label: "Dimmer" },
  { id: "circuit", label: "Circuit" },
  { id: "patch", label: "Universe/Address" },
  { id: "universe", label: "Universe" },
  { id: "address", label: "Address" },
  { id: "watts", label: "Wattage" },
  { id: "accessory", label: "Accessories" },
  { id: "notes", label: "Notes" },
] as const;

export type LegendField = (typeof LEGEND_FIELDS)[number]["id"];

export interface LegendLabel {
  readonly field: LegendField;
  readonly spot: LabelSpot;
  readonly box: LabelBox;
  readonly rightReading: boolean;
  /** its text's height, percent of the device's Label Size */
  readonly size: number;
}

export interface Legend {
  readonly name: string;
  /** laid out as for a device aimed down the page however the device turns */
  readonly nonRotating: boolean;
  /** the labels shown, in order */
  readonly labels: readonly LegendLabel[];
}

export interface LegendBook {
  /** the legend new devices take; "" for Rodeo's own labels */
  readonly active: string;
  readonly legends: readonly Legend[];
}

export const EMPTY_BOOK: LegendBook = { active: "", legends: [] };

/** A new legend's labels: Rodeo's own four, channel in a circle in front, unit on the body, colour behind, purpose to the right. */
export const STARTER_LABELS: readonly LegendLabel[] = [
  { field: "channel", spot: "front", box: "circle", rightReading: true, size: 100 },
  { field: "unit", spot: "body", box: "none", rightReading: true, size: 80 },
  { field: "color", spot: "back", box: "none", rightReading: true, size: 100 },
  { field: "purpose", spot: "right", box: "none", rightReading: true, size: 100 },
];

const has = <T extends string>(list: readonly { readonly id: T }[], v: unknown): v is T => list.some((x) => x.id === v);

/** A book as saved, made safe to use: unknown fields, spots and containers dropped or defaulted, names unique, the active one existing. */
export function cleanBook(raw: unknown): LegendBook {
  if (!raw || typeof raw !== "object") return EMPTY_BOOK;
  const r = raw as { active?: unknown; legends?: unknown };
  const legends: Legend[] = [];
  for (const l of Array.isArray(r.legends) ? r.legends : []) {
    if (!l || typeof l !== "object") continue;
    const name = typeof l.name === "string" ? l.name.trim() : "";
    if (!name || legends.some((x) => x.name === name)) continue;
    const labels: LegendLabel[] = [];
    for (const x of Array.isArray(l.labels) ? l.labels : []) {
      if (!x || typeof x !== "object" || !has(LEGEND_FIELDS, x.field) || labels.some((y) => y.field === x.field)) continue;
      const size = Number(x.size);
      labels.push({
        field: x.field,
        spot: has(LABEL_SPOTS, x.spot) ? x.spot : "right",
        box: has(LABEL_BOXES, x.box) ? x.box : "none",
        rightReading: x.rightReading !== false,
        size: Number.isFinite(size) && size > 0 ? Math.min(size, 1000) : 100,
      });
    }
    legends.push({ name, nonRotating: l.nonRotating === true, labels });
  }
  const active = typeof r.active === "string" && legends.some((l) => l.name === r.active) ? r.active : "";
  return { active, legends };
}

/** `base`, or `base 2`, `base 3`… while a legend has that name. */
export function freeLegendName(base: string, taken: readonly string[]): string {
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base} ${n}`;
  return name;
}

/** The labels' fields as a short list: "Channel, Unit Number, Color". */
export function labelSummary(legend: Legend): string {
  return legend.labels.length ? legend.labels.map((l) => LEGEND_FIELDS.find((f) => f.id === l.field)!.label).join(", ") : "No labels";
}
