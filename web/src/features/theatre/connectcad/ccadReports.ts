// The sums behind ConnectCAD's report commands (reports.ts): the rows of the circuit, device,
// device connections and parts reports, from plain facts about a schematic's circuits and
// devices, the rows of a rack's contents worksheet (rackWorksheet.ts), and the worksheet they
// make. Kept apart so it runs without the page.

import type { NewSheetCell, NewWorksheet } from "../../../core/index.ts";
import { widthOf } from "../../../app/reportRows.ts";

export interface ReportCircuit {
  /** the circuit object, when it's in the drawing */
  readonly id?: string;
  readonly layer: string;
  readonly number: string;
  readonly signal: string;
  readonly cable: string;
  readonly type: string;
  readonly length: string;
  /** what Calculate Cable Lengths made of it */
  readonly calculated: string;
  readonly sourceDevice: string;
  readonly sourceSocket: string;
  readonly destinationDevice: string;
  readonly destinationSocket: string;
}

export interface ReportSocket {
  readonly name: string;
  readonly type: string;
  readonly signal: string;
  readonly connector: string;
  /** the circuits joined to it: each one's number and the device and socket at its other end */
  readonly circuits: readonly { readonly number: string; readonly to: string }[];
}

export interface ReportDevice {
  /** an external connection, not equipment: in the connections report, not the device or parts reports */
  readonly external?: boolean;
  readonly layer: string;
  readonly name: string;
  readonly tag: string;
  readonly description: string;
  readonly maker: string;
  readonly power: number;
  readonly btu: number;
  readonly weight: number;
  readonly ru: number;
  readonly room: string;
  readonly rack: string;
  readonly sockets: readonly ReportSocket[];
}

export type ReportRow = (NewSheetCell | null)[];

/** points, as Create Report's rows */
const ROW_HEIGHT = 18;

/** Names with numbers in them in counting order: DEV2 before DEV10. */
export const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const text = (value: string): NewSheetCell | null => (value ? { value } : null);
const bold = (value: string): NewSheetCell => ({ value, bold: true });
const amount = (value: number): NewSheetCell => ({ value, format: 0, accuracy: Number.isInteger(value) ? 0 : 2 });
const heads = (...names: string[]): ReportRow => names.map(bold);
const sum = (list: readonly ReportDevice[], of: (d: ReportDevice) => number): number => Math.round(list.reduce((n, d) => n + of(d), 0) * 100) / 100;

/** A row per circuit by number (unnumbered last), then by where it starts; `layers` adds a Layer column first. */
export function circuitRows(circuits: readonly ReportCircuit[], layers: boolean): ReportRow[] {
  const sorted = [...circuits].sort(
    (a, b) => Number(!a.number) - Number(!b.number) || natural(a.number, b.number) || natural(a.sourceDevice, b.sourceDevice) || natural(a.sourceSocket, b.sourceSocket),
  );
  const head = heads("Number", "Signal", "Cable", "Source Device", "Source Socket", "Destination Device", "Destination Socket", "Cable Length", "Calculated Length", "Circuit Type");
  return [
    layers ? [bold("Layer"), ...head] : head,
    ...sorted.map((c) => {
      const row = [c.number, c.signal, c.cable, c.sourceDevice, c.sourceSocket, c.destinationDevice, c.destinationSocket, c.length, c.calculated, c.type].map(text);
      return layers ? [text(c.layer), ...row] : row;
    }),
  ];
}

/** Devices by Description and Manufacturer, in the order of their first. */
function kinds(devices: readonly ReportDevice[]): ReportDevice[][] {
  const by = new Map<string, ReportDevice[]>();
  for (const d of devices) {
    const k = `${d.description}\n${d.maker}`;
    by.set(k, [...(by.get(k) ?? []), d]);
  }
  return [...by.values()].sort((a, b) => natural(a[0].description, b[0].description) || natural(a[0].maker, b[0].maker));
}

/** A row per device by name, then a summary of them by Description and Manufacturer with their totals. */
export function deviceRows(devices: readonly ReportDevice[]): ReportRow[] {
  const sorted = [...devices].sort((a, b) => natural(a.name, b.name));
  return [
    heads("Device Name", "Display Tag", "Description", "Manufacturer", "Sockets", "Power (W)", "BTU", "Weight (kg)", "Room", "Rack"),
    ...sorted.map((d) => [text(d.name), text(d.tag), text(d.description), text(d.maker), amount(d.sockets.length), amount(d.power), amount(d.btu), amount(d.weight), text(d.room), text(d.rack)]),
    [],
    [bold("Summary")],
    heads("Description", "Manufacturer", "Count", "Power (W)", "BTU", "Weight (kg)"),
    ...kinds(sorted).map((g) => [text(g[0].description || "(no description)"), text(g[0].maker), amount(g.length), amount(sum(g, (d) => d.power)), amount(sum(g, (d) => d.btu)), amount(sum(g, (d) => d.weight))]),
    [bold("Total"), null, amount(sorted.length), amount(sum(sorted, (d) => d.power)), amount(sum(sorted, (d) => d.btu)), amount(sum(sorted, (d) => d.weight))],
  ];
}

/** Each device by name with its sockets, and on each socket the circuits joined to it and where they go. */
export function connectionRows(devices: readonly ReportDevice[]): ReportRow[] {
  const out: ReportRow[] = [];
  for (const d of [...devices].sort((a, b) => natural(a.name, b.name))) {
    if (out.length) out.push([]);
    out.push([bold(d.name || "(no name)"), text(d.description), text(d.layer)]);
    out.push(heads("Socket", "Type", "Signal", "Connector", "Circuit", "Connected To"));
    for (const k of d.sockets) {
      const start = [text(k.name), text(k.type), text(k.signal), text(k.connector)];
      if (!k.circuits.length) out.push([...start, null, text("Not connected")]);
      for (const c of k.circuits) out.push([...start, text(c.number), text(c.to)]);
    }
    if (!d.sockets.length) out.push([text("No sockets")]);
  }
  return out;
}

/** Each device name once, with what it is, then a count of the parts by Description and Manufacturer. */
export function partRows(devices: readonly ReportDevice[]): ReportRow[] {
  const once = new Map<string, ReportDevice>();
  for (const d of [...devices].sort((a, b) => natural(a.name, b.name))) if (!once.has(d.name)) once.set(d.name, d);
  const parts = [...once.values()];
  return [
    heads("Device Name", "Description", "Manufacturer", "Height RU", "Weight (kg)", "Power (W)"),
    ...parts.map((d) => [text(d.name), text(d.description), text(d.maker), d.ru ? amount(d.ru) : null, amount(d.weight), amount(d.power)]),
    [],
    heads("Description", "Manufacturer", "Quantity"),
    ...kinds(parts).map((g) => [text(g[0].description || "(no description)"), text(g[0].maker), amount(g.length)]),
  ];
}

/** A cable for the Cable Pull Report: what it joins the cable paths at, at each end, the way it takes between (its pieces, as a key), its cable type and length in mm. */
export interface PulledCable {
  readonly from: string;
  readonly to: string;
  readonly way: string;
  readonly cable: string;
  readonly mm: number;
}

/**
 * The Cable Pull Report's rows: for each cable route (the places at its ends, whichever way round, and
 * the way between), the cables of each type to pull along it, how many, the longest and their length
 * in all; then each type's count and length over every route. `length` writes a length.
 */
export function cablePullRows(cables: readonly PulledCable[], length: (mm: number) => string): ReportRow[] {
  const groups = new Map<string, { from: string; to: string; way: string; cable: string; list: PulledCable[] }>();
  for (const c of cables) {
    const [from, to] = natural(c.from, c.to) <= 0 ? [c.from, c.to] : [c.to, c.from];
    const key = [from, to, c.way, c.cable].join("\u0000");
    const g = groups.get(key) ?? groups.set(key, { from, to, way: c.way, cable: c.cable, list: [] }).get(key)!;
    g.list.push(c);
  }
  const rows = [...groups.values()].sort((a, b) => natural(a.from, b.from) || natural(a.to, b.to) || a.way.localeCompare(b.way) || natural(a.cable, b.cable));
  // a route is its two ends and its way: numbered in the order listed
  const routes = new Map<string, number>();
  const total = (list: readonly PulledCable[]): number => list.reduce((n, c) => n + c.mm, 0);
  const types = new Map<string, PulledCable[]>();
  for (const c of cables) (types.get(c.cable) ?? types.set(c.cable, []).get(c.cable)!).push(c);
  const typeName = (cable: string): string => cable || "(no cable type)";
  return [
    heads("Route", "From", "To", "Cable", "Quantity", "Length", "Total Length"),
    ...rows.map((g) => {
      const key = [g.from, g.to, g.way].join("\u0000");
      if (!routes.has(key)) routes.set(key, routes.size + 1);
      return [amount(routes.get(key)!), text(g.from), text(g.to), text(typeName(g.cable)), amount(g.list.length), text(length(Math.max(...g.list.map((c) => c.mm)))), text(length(total(g.list)))];
    }),
    [],
    heads("Cable", "Quantity", "Total Length"),
    ...[...types.entries()].sort((a, b) => natural(a[0], b[0])).map(([cable, list]) => [text(typeName(cable)), amount(list.length), text(length(total(list)))]),
  ];
}

/** A piece of equipment in a rack, for the rack's contents worksheet. */
export interface RackEntry {
  readonly name: string;
  readonly make: string;
  readonly model: string;
  /** equipment on its own units, a rack frame, or a module in a frame's slots */
  readonly kind: "item" | "frame" | "module";
  /** its lowest unit (a module's frame's), 0 or less below the rack */
  readonly u: number;
  /** the units it takes (a module's frame's) */
  readonly ru: number;
  readonly mounting: string;
  /** the frame slots a module takes */
  readonly slots: readonly number[];
  readonly rackWidth: string;
  /** in the drawing's units */
  readonly depth: string;
  readonly power: number;
  readonly btu: number;
  readonly weight: number;
}

export const RACK_COLUMNS = ["Rack U", "Mounting", "Slot", "Name", "Make", "Model", "Height RU", "Rack Width", "Depth", "Power (W)", "BTU", "Weight (kg)"] as const;
export type RackColumn = (typeof RACK_COLUMNS)[number];
/** the columns a rack's contents worksheet uses until others are chosen */
export const RACK_COLUMNS_SHOWN: readonly RackColumn[] = ["Rack U", "Mounting", "Slot", "Name", "Make", "Model", "Height RU", "Power (W)", "Weight (kg)"];
const TOTALLED: ReadonlySet<RackColumn> = new Set(["Power (W)", "BTU", "Weight (kg)"]);

const span = (low: number, high: number): string => (low === high ? String(low) : `${low}–${high}`);
/** A run of slots: 3–4 along a row, 3, 7 down a column. */
const slotsText = (slots: readonly number[]): string => (slots.length > 1 && slots.every((n, k) => k === 0 || n === slots[k - 1] + 1) ? span(slots[0], slots[slots.length - 1]) : slots.join(", "));

/**
 * A rack's contents in `columns`, a row for each position from the top of its `units`, the front's
 * and then the rear's: the equipment whose units start there (a frame before its modules, them by
 * slot) and each run of free units between; equipment below the rack after; then the totals and
 * the free units on each side.
 */
export function rackRows(units: number, entries: readonly RackEntry[], columns: readonly RackColumn[]): ReportRow[] {
  const sides = ["Front", ...(entries.some((e) => e.mounting === "Rear") ? ["Rear"] : [])];
  const taken = new Map(sides.map((m) => [m, new Set<number>()]));
  for (const e of entries) if (e.kind !== "module" && e.u >= 1) for (let k = 0; k < e.ru; k++) taken.get(e.mounting)?.add(e.u + k);
  type Line = { readonly top: number; readonly side: number; readonly order: number; readonly cell: (c: RackColumn) => NewSheetCell | null };
  const lines: Line[] = entries.map((e, k) => ({
    top: e.u >= 1 ? e.u + e.ru - 1 : e.u,
    side: Math.max(0, sides.indexOf(e.mounting)),
    order: e.kind === "frame" ? -1 : e.kind === "module" ? (e.slots[0] ?? 0) : k,
    cell: (c) => {
      switch (c) {
        case "Rack U":
          return text(e.u >= 1 ? span(e.u, e.u + e.ru - 1) : "Below");
        case "Mounting":
          return text(e.mounting);
        case "Slot":
          return text(slotsText(e.slots));
        case "Name":
          return text(e.name);
        case "Make":
          return text(e.make);
        case "Model":
          return text(e.model);
        case "Height RU":
          return e.kind === "module" ? null : amount(e.ru);
        case "Rack Width":
          return text(e.rackWidth);
        case "Depth":
          return text(e.depth);
        case "Power (W)":
          return amount(e.power);
        case "BTU":
          return amount(e.btu);
        case "Weight (kg)":
          return amount(e.weight);
      }
    },
  }));
  // each run of free units on a side, from the top
  const free = new Map<string, number>();
  sides.forEach((side, s) => {
    const used = taken.get(side)!;
    free.set(side, units - [...used].filter((u) => u <= units).length);
    for (let u = units; u >= 1; ) {
      if (used.has(u)) {
        u--;
        continue;
      }
      let low = u;
      while (low > 1 && !used.has(low - 1)) low--;
      const high = u;
      lines.push({ top: high, side: s, order: 0, cell: (c) => (c === "Rack U" ? text(span(low, high)) : c === "Mounting" ? text(side) : c === "Name" ? text("Free") : null) });
      u = low - 1;
    }
  });
  const below = (l: Line): number => Number(l.top < 1);
  lines.sort((a, b) => below(a) - below(b) || a.side - b.side || b.top - a.top || a.order - b.order);
  const total = (c: RackColumn): number => Math.round(entries.reduce((n, e) => n + (c === "Power (W)" ? e.power : c === "BTU" ? e.btu : e.weight), 0) * 100) / 100;
  const totals: ReportRow = columns.map((c) => (TOTALLED.has(c) ? amount(total(c)) : null));
  const label = columns.findIndex((c) => !TOTALLED.has(c));
  if (label >= 0) totals[label] = bold("Total");
  return [
    heads(...columns),
    ...lines.map((l) => columns.map(l.cell)),
    [],
    ...(columns.some((c) => TOTALLED.has(c)) ? [totals] : []),
    ...sides.map((side): ReportRow => [bold(sides.length > 1 ? `Free units (${side})` : "Free units"), amount(free.get(side)!)]),
  ];
}

/** `rows` as a worksheet named `name`, each column as wide as its widest entry. */
export function reportSheet(name: string, rows: readonly ReportRow[]): NewWorksheet {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => widthOf(rows.map((r) => (r[c] ? String(r[c]?.value) : ""))));
  return { name, widths, rowHeight: ROW_HEIGHT, rows: rows.map((r) => [...r]) };
}

/** `name`, or with a number after it when the drawing has a resource of that name already. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}-${n}`)) n++;
  return `${name}-${n}`;
}
