// The sums behind Create Devices from Worksheet (lists.ts): a device list's columns assigned to a
// device's fields by their headings (or to fields of the Imported Device Data record), its rows read
// as so many devices of a make and model, and the plan: devices the drawing already has of each make
// and model count towards a row's quantity (their data brought up to date), and the rest are made,
// named from the row's Name, numbered when there's more than one, or else from their model. Kept
// apart so it runs without the page.

import type { Table } from "./listShapes.ts";

export const DEVICE_COLUMNS = ["Name", "Display Tag", "Make", "Model", "Quantity", "Room", "Rack", "Rack U", "Power (W)", "Weight (kg)", "Height RU"] as const;
export type DeviceColumn = (typeof DEVICE_COLUMNS)[number];

/** What a column goes to: a device's field, a field of the Imported Device Data record, or nothing. */
export type Assignment = { readonly kind: "device"; readonly field: DeviceColumn } | { readonly kind: "record"; readonly field: string } | { readonly kind: "none" };

const HEADINGS: Readonly<Record<DeviceColumn, readonly string[]>> = {
  Name: ["name", "devicename"],
  "Display Tag": ["tag", "displaytag"],
  Make: ["make", "manufacturer", "maker", "brand"],
  Model: ["model", "description"],
  Quantity: ["quantity", "qty", "count"],
  Room: ["room"],
  Rack: ["rack"],
  "Rack U": ["racku", "rackunit", "u"],
  "Power (W)": ["power", "powerw", "watts"],
  "Weight (kg)": ["weight", "weightkg"],
  "Height RU": ["heightru", "ru", "rackunits"],
};

const plain = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A column's assignment by its heading: the device field it names, else a record field of its name; none for no heading. */
export function assignmentOf(heading: string): Assignment {
  const p = plain(heading);
  if (!p) return { kind: "none" };
  const field = DEVICE_COLUMNS.find((f) => HEADINGS[f].includes(p));
  return field ? { kind: "device", field } : { kind: "record", field: heading.trim() };
}

/** The row taken as the header: the first with a make or model heading, else the first. */
export function deviceHeader(rows: Table): number {
  const k = rows.findIndex((r) => r.some((c) => {
    const a = assignmentOf(c);
    return a.kind === "device" && (a.field === "Make" || a.field === "Model");
  }));
  return Math.max(0, k);
}

/** The header's columns as the dialog names them: a heading, or Field and its number for an empty one. */
export const columnNames = (rows: Table, header: number): string[] => {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => (rows[header]?.[i] ?? "").trim() || `Field${i + 1}`);
};

/** A row of a device list: how many of a make and model, its name, other fields and record fields. */
export interface ListedDevice {
  readonly row: number;
  readonly quantity: number;
  readonly make: string;
  readonly model: string;
  readonly fields: Partial<Readonly<Record<DeviceColumn, string>>>;
  readonly record: Readonly<Record<string, string>>;
}

/** The devices a list's rows below its header ask for, and the rows passed by and why (a row with no make or model, none said). */
export function listedDevices(rows: Table, header: number, assigned: readonly Assignment[]): { devices: ListedDevice[]; skipped: { row: number; why: string }[] } {
  const devices: ListedDevice[] = [];
  const skipped: { row: number; why: string }[] = [];
  rows.forEach((r, row) => {
    if (row <= header) return;
    const fields: Partial<Record<DeviceColumn, string>> = {};
    const record: Record<string, string> = {};
    assigned.forEach((a, i) => {
      const v = (r[i] ?? "").trim();
      if (a.kind === "device" && v) fields[a.field] = v;
      else if (a.kind === "record") record[a.field] = v;
    });
    const make = fields.Make ?? "";
    const model = fields.Model ?? "";
    if (!make && !model) {
      if (r.some((c) => c.trim())) skipped.push({ row, why: "no make or model" });
      return;
    }
    const q = fields.Quantity === undefined ? 1 : Number(fields.Quantity.replace(/,/g, ""));
    if (!Number.isFinite(q) || q < 0) {
      skipped.push({ row, why: `quantity ${fields.Quantity} isn't a number` });
      return;
    }
    devices.push({ row, quantity: Math.floor(q), make, model, fields, record });
  });
  return { devices, skipped };
}

/** A device the drawing has, as the plan matches it. */
export interface HadDevice {
  readonly id: string;
  readonly make: string;
  readonly model: string;
}

export interface DevicePlan {
  /** the devices to make, each with its name and tag */
  readonly make: readonly { readonly from: ListedDevice; readonly name: string; readonly tag: string }[];
  /** the drawing's devices counted towards a row, their data to bring up to date */
  readonly update: readonly { readonly from: ListedDevice; readonly id: string }[];
}

/** a make and model as the plan matches them, whatever their case */
export const kindKey = (make: string, model: string): string => `${make.trim().toLowerCase()}\n${model.trim().toLowerCase()}`;

/** Names for `n` devices from `base`: as it is for one not taken, else numbered from 1 past those taken. */
export function numberedNames(base: string, n: number, taken: Set<string>): string[] {
  if (n === 1 && !taken.has(base)) {
    taken.add(base);
    return [base];
  }
  const out: string[] = [];
  for (let k = 1; out.length < n; k++) {
    const name = `${base} ${k}`;
    if (taken.has(name)) continue;
    taken.add(name);
    out.push(name);
  }
  return out;
}

/** What Create Devices from Worksheet does: for each row, the drawing's devices of its make and model first, then new ones. */
export function devicePlan(list: readonly ListedDevice[], had: readonly HadDevice[], names: ReadonlySet<string>): DevicePlan {
  const free = new Map<string, string[]>();
  for (const d of had) {
    const k = kindKey(d.make, d.model);
    free.set(k, [...(free.get(k) ?? []), d.id]);
  }
  const taken = new Set(names);
  const make: { from: ListedDevice; name: string; tag: string }[] = [];
  const update: { from: ListedDevice; id: string }[] = [];
  for (const d of list) {
    const pool = free.get(kindKey(d.make, d.model)) ?? [];
    const kept = pool.splice(0, d.quantity);
    for (const id of kept) update.push({ from: d, id });
    const n = d.quantity - kept.length;
    if (n <= 0) continue;
    const made = numberedNames(d.fields.Name ?? (d.model || d.make), n, taken);
    const tag = d.fields["Display Tag"];
    const tags = tag ? (n === 1 ? [tag] : made.map((_, i) => `${tag} ${i + 1}`)) : made;
    made.forEach((name, i) => make.push({ from: d, name, tag: tags[i] }));
  }
  return { make, update };
}
