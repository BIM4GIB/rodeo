// Spotlight's Inventory and Equipment List, its sums (inventoryDialog.ts shows them): inventories of the
// equipment a vendor, venue or warehouse has, each item's stock by its name, and the equipment in the
// drawing (lighting devices by type, plug-in objects and symbols by name) set against them: what each
// item's assigned source holds and has left, and what every inventory in use holds and has left between
// them. Inventories are kept on this machine, as Vectorworks keeps them in the user folder, and go to and
// from .xml files to share; which ones a drawing uses, its items' sources and its categories are kept in
// the drawing. Plain data in and out.

export interface Inventory {
  readonly name: string;
  readonly vendor: string;
  readonly contact: string;
  readonly notes: string;
  /** stock by item name */
  readonly stock: Readonly<Record<string, number>>;
  /** each item's part type and category, as the drawing it was made from had them */
  readonly types: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
}

/** What a drawing keeps: the inventories it uses, each item's source and category, and the categories' order. */
export interface DrawingInventory {
  readonly use: readonly string[];
  readonly sources: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  readonly order: readonly string[];
}

/** An item of equipment in the drawing and how many. */
export interface InUse {
  readonly name: string;
  readonly partType: string;
  readonly count: number;
}

export interface EquipmentRow {
  readonly name: string;
  readonly partType: string;
  readonly category: string;
  readonly inUse: number;
  /** its assigned inventory, "" for none */
  readonly source: string;
  /** what the source holds of it and has left after what's in use; null with no source */
  readonly totalSource: number | null;
  readonly remainingSource: number | null;
  /** what the inventories in use hold of it between them, and have left */
  readonly totalAll: number;
  readonly remainingAll: number;
}

export const LIGHTING_DEVICE = "Lighting Device";
export const SYMBOL = "Symbol";
export const NO_DRAWING_INVENTORY: DrawingInventory = { use: [], sources: {}, categories: {}, order: [] };

/** The category an item comes in before one is chosen: lighting devices, symbols, and each plug-in object type in its own. */
export function defaultCategory(partType: string): string {
  return partType === LIGHTING_DEVICE ? "Lighting Devices" : partType === SYMBOL ? "Symbols" : partType;
}

/** An item's category: the drawing's, else the first inventory in use that has one for it, else by its part type. */
export function categoryOf(name: string, partType: string, d: DrawingInventory, inventories: readonly Inventory[]): string {
  return d.categories[name] ?? inventories.find((i) => d.use.includes(i.name) && i.categories[name])?.categories[name] ?? defaultCategory(partType);
}

/** The categories in order: the drawing's order first, then any others the rows use, alphabetically. */
export function categoryList(rows: readonly { readonly category: string }[], d: DrawingInventory): string[] {
  const rest = [...new Set(rows.map((r) => r.category))].filter((c) => !d.order.includes(c)).sort((a, b) => a.localeCompare(b));
  return [...d.order, ...rest];
}

/** The equipment in use set against the inventories, by category then name. */
export function equipmentRows(inUse: readonly InUse[], inventories: readonly Inventory[], d: DrawingInventory): EquipmentRow[] {
  const using = inventories.filter((i) => d.use.includes(i.name));
  const rows = inUse.map((u): EquipmentRow => {
    const assigned = d.sources[u.name] ?? "";
    const source = inventories.find((i) => i.name === assigned);
    const totalSource = source ? (source.stock[u.name] ?? 0) : null;
    const totalAll = using.reduce((n, i) => n + (i.stock[u.name] ?? 0), 0);
    return {
      name: u.name,
      partType: u.partType,
      category: categoryOf(u.name, u.partType, d, inventories),
      inUse: u.count,
      source: source ? source.name : "",
      totalSource,
      remainingSource: totalSource === null ? null : totalSource - u.count,
      totalAll,
      remainingAll: totalAll - u.count,
    };
  });
  const order = categoryList(rows, d);
  return rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** A new inventory of what the drawing holds: each item's count in use as its stock. */
export function inventoryFrom(name: string, details: Pick<Inventory, "vendor" | "contact" | "notes">, inUse: readonly InUse[], d: DrawingInventory, others: readonly Inventory[]): Inventory {
  return {
    name,
    ...details,
    stock: Object.fromEntries(inUse.map((u) => [u.name, u.count])),
    types: Object.fromEntries(inUse.map((u) => [u.name, u.partType])),
    categories: Object.fromEntries(inUse.map((u) => [u.name, categoryOf(u.name, u.partType, d, others)])),
  };
}

/** A name not among `taken`: `name`, else with a number after it. */
export function freeName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) if (!taken.includes(`${name} ${n}`)) return `${name} ${n}`;
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
const unescape = (s: string): string =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
  );

/** An inventory as Rodeo writes it to a .xml file. */
export function inventoryXml(inv: Inventory): string {
  const items = Object.keys(inv.stock)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `  <Item name="${escape(name)}" type="${escape(inv.types[name] ?? "")}" category="${escape(inv.categories[name] ?? "")}" stock="${inv.stock[name]}"/>`);
  return [`<?xml version="1.0" encoding="UTF-8"?>`, `<Inventory name="${escape(inv.name)}" vendor="${escape(inv.vendor)}" contact="${escape(inv.contact)}" notes="${escape(inv.notes)}">`, ...items, `</Inventory>`, ""].join("\n");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = unescape(m[3] ?? m[4] ?? "");
  return out;
}

/** An inventory read from a .xml file Rodeo wrote, or what's wrong with it. */
export function readInventoryXml(text: string): Inventory | string {
  const head = /<Inventory\b([^>]*)>/.exec(text);
  if (!head) return "it isn't an inventory Rodeo saved: there's no Inventory element";
  const top = attrs(head[1]);
  if (!top.name?.trim()) return "the inventory has no name";
  const stock: Record<string, number> = {};
  const types: Record<string, string> = {};
  const categories: Record<string, string> = {};
  for (const m of text.matchAll(/<Item\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    const n = Number(a.stock);
    if (!a.name || !Number.isFinite(n)) continue;
    stock[a.name] = Math.max(0, Math.round(n));
    if (a.type) types[a.name] = a.type;
    if (a.category) categories[a.name] = a.category;
  }
  return { name: top.name.trim(), vendor: top.vendor ?? "", contact: top.contact ?? "", notes: top.notes ?? "", stock, types, categories };
}

/** Inventories read back from storage, dropping anything malformed. */
export function inventoriesOf(raw: unknown): Inventory[] {
  if (!Array.isArray(raw)) return [];
  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const strings = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(rec(v)).filter((e): e is [string, string] => typeof e[1] === "string"));
  return raw.flatMap((x): Inventory[] => {
    const o = rec(x);
    if (typeof o.name !== "string" || !o.name) return [];
    const stock = Object.fromEntries(Object.entries(rec(o.stock)).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])));
    const text = (v: unknown): string => (typeof v === "string" ? v : "");
    return [{ name: o.name, vendor: text(o.vendor), contact: text(o.contact), notes: text(o.notes), stock, types: strings(o.types), categories: strings(o.categories) }];
  });
}

/** A drawing's inventory data read back, dropping anything malformed. */
export function drawingInventoryOf(raw: unknown): DrawingInventory {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const map = (v: unknown): Record<string, string> => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")) : {});
  return { use: list(o.use), sources: map(o.sources), categories: map(o.categories), order: list(o.order) };
}
