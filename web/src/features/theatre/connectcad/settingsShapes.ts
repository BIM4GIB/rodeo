// The sums behind ConnectCAD Settings (settings.ts): what a drawing keeps, read back whatever its JSON
// holds, and what that changes in the schematic tools (ccadShapes.ts's FileSettings). Kept apart so it
// runs without the page.

import { NUMBERING_SYSTEMS, SIGNALS, type FileSettings, type NumberingSystem, type Signal } from "./ccadShapes.ts";
import { PANEL_PREFIX, PANEL_TYPES, type PanelKind } from "./panelShapes.ts";

/** the signal categories panels are sized by, and what Panel Settings calls them */
export const PANEL_CATEGORIES: readonly { readonly category: string; readonly label: string }[] = [
  { category: "Video", label: "Video" },
  { category: "Audio", label: "Audio" },
  { category: "Network", label: "Data" },
  { category: "Optical", label: "Optical" },
];
/** a signal's category: the built-in signals' and Other */
export const SIGNAL_CATEGORIES: readonly string[] = [...new Set([...SIGNALS.map((s) => s.category), "Other"])];
/** Number Format: a Linear Array's numbers with this many digits at least */
export const NUMBER_FORMATS: readonly { readonly digits: number; readonly label: string }[] = [1, 2, 3, 4].map((digits) => ({ digits, label: "1".padStart(digits, "0") }));

export const METRIC_LENGTHS: readonly string[] = ["0.5 m", "1 m", "2 m", "3 m", "5 m", "10 m", "15 m", "20 m", "30 m", "50 m", "100 m"];
export const IMPERIAL_LENGTHS: readonly string[] = ["3'", "6'", "10'", "15'", "25'", "50'", "75'", "100'", "150'", "200'"];

export interface Named {
  readonly name: string;
  readonly description: string;
}

/** Panel Settings' sizes: a jackfield's and a term panel's ports by category, a DIN rail term panel's and a custom panel's */
export interface PanelSizes {
  readonly jack: Readonly<Record<string, number>>;
  readonly term: Readonly<Record<string, number>>;
  readonly din: number;
  readonly custom: number;
}

export interface CcadSettings {
  readonly autoHop: boolean;
  readonly digits: number;
  /** Jackfield Prefix (linked jacks too), Term Panel Prefix and Custom Panel Prefix */
  readonly prefixes: { readonly jack: string; readonly term: string; readonly connector: string };
  readonly sizes: PanelSizes;
  readonly numbering: NumberingSystem;
  /** the drawing's own signals: new ones, and built-in ones changed */
  readonly signals: readonly Signal[];
  readonly connectors: readonly Named[];
  readonly cables: readonly Named[];
  readonly lengths: readonly string[];
}

const DIN = "DIN Rail Term Panel";
const sizeOf = (kind: PanelKind, category: string | null): number => PANEL_TYPES.find((t) => t.kind === kind && t.category === category)?.size ?? 32;

export function defaultSizes(): PanelSizes {
  const by = (kind: PanelKind) => Object.fromEntries(PANEL_CATEGORIES.map((c) => [c.category, sizeOf(kind, c.category)]));
  return { jack: by("jack"), term: by("term"), din: PANEL_TYPES.find((t) => t.device === DIN)?.size ?? 32, custom: sizeOf("connector", null) };
}

export function defaultSettings(metric: boolean): CcadSettings {
  return {
    autoHop: false,
    digits: 1,
    prefixes: { jack: PANEL_PREFIX.jack, term: PANEL_PREFIX.term, connector: PANEL_PREFIX.connector },
    sizes: defaultSizes(),
    numbering: NUMBERING_SYSTEMS[0],
    signals: [],
    connectors: [],
    cables: [],
    lengths: metric ? METRIC_LENGTHS : IMPERIAL_LENGTHS,
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, or: string): string => (typeof v === "string" ? v : or);
const count = (v: unknown, or: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.min(999, Math.round(v)) : or);
const names = (v: unknown): Named[] => {
  if (!Array.isArray(v)) return [];
  const out: Named[] = [];
  for (const x of v) {
    const o = obj(x);
    const name = text(o.name, "").trim();
    if (name && !out.some((n) => n.name === name)) out.push({ name, description: text(o.description, "") });
  }
  return out;
};

/** A signal as kept: a name, a category, a letter of one or two and its connectors; null for anything less. */
export function signalFrom(v: unknown): Signal | null {
  const o = obj(v);
  const name = text(o.name, "").trim();
  if (!name) return null;
  const category = text(o.category, "Other").trim() || "Other";
  const letter = text(o.letter, "").trim().toUpperCase().slice(0, 2) || "X";
  const connectors = Array.isArray(o.connectors) ? [...new Set(o.connectors.filter((c): c is string => typeof c === "string").map((c) => c.trim()).filter(Boolean))] : [];
  return { name, category, letter, connectors };
}

/** A drawing's settings from what it keeps, each part checked; the defaults for whatever's missing or wrong. */
export function settingsFrom(raw: unknown, metric: boolean): CcadSettings {
  const d = defaultSettings(metric);
  const o = obj(raw);
  const p = obj(o.prefixes);
  const z = obj(o.sizes);
  const byCategory = (v: unknown, or: Readonly<Record<string, number>>) => Object.fromEntries(PANEL_CATEGORIES.map((c) => [c.category, count(obj(v)[c.category], or[c.category])]));
  const signals: Signal[] = [];
  for (const s of Array.isArray(o.signals) ? o.signals.map(signalFrom) : []) if (s && !signals.some((x) => x.name === s.name)) signals.push(s);
  const lengths = Array.isArray(o.lengths) ? [...new Set(o.lengths.filter((l): l is string => typeof l === "string").map((l) => l.trim()).filter(Boolean))] : d.lengths;
  return {
    autoHop: o.autoHop === true,
    digits: Math.min(4, count(o.digits, d.digits)),
    prefixes: { jack: text(p.jack, d.prefixes.jack), term: text(p.term, d.prefixes.term), connector: text(p.connector, d.prefixes.connector) },
    sizes: { jack: byCategory(z.jack, d.sizes.jack), term: byCategory(z.term, d.sizes.term), din: count(z.din, d.sizes.din), custom: count(z.custom, d.sizes.custom) },
    numbering: (NUMBERING_SYSTEMS as readonly string[]).includes(text(o.numbering, "")) ? (o.numbering as NumberingSystem) : d.numbering,
    signals,
    connectors: names(o.connectors),
    cables: names(o.cables),
    lengths,
  };
}

/** Ports on a panel by its Device Type: a jack's and a linked jack's by its category's jackfield size, and so on. */
export function panelSizesOf(sizes: PanelSizes): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of PANEL_TYPES) {
    if (t.device === DIN) out[t.device] = sizes.din;
    else if (t.kind === "connector") out[t.device] = sizes.custom;
    else if (t.category) out[t.device] = (t.kind === "term" ? sizes.term : sizes.jack)[t.category] ?? t.size;
  }
  return out;
}

/** What the settings change in the schematic tools. */
export function fileSettingsOf(c: CcadSettings): FileSettings {
  return {
    signals: c.signals,
    connectors: c.connectors.map((n) => n.name),
    digits: c.digits,
    panelSizes: panelSizesOf(c.sizes),
    cables: c.cables.map((n) => n.name),
    lengths: c.lengths,
    autoHop: c.autoHop,
  };
}

/** What's wrong with a list of the drawing's signals, to say before keeping it. */
export function signalProblems(list: readonly Signal[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    if (!s.name.trim()) out.push("a signal has no name");
    else if (seen.has(s.name)) out.push(`there are two signals named ${s.name}`);
    seen.add(s.name);
  }
  return [...new Set(out)];
}

/** "BNC, DIN 1.0/2.3" → its connectors */
export const connectorList = (t: string): string[] => [...new Set(t.split(",").map((c) => c.trim()).filter(Boolean))];
