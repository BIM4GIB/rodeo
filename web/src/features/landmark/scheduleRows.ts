// The rows of Landmark's schedules (schedules.ts): plants counted by ID (their Plant Record's
// quantity, else the plants each places) and Laubwerk plants by botanical name; existing trees one a
// row; landscape areas, hardscapes and massing models' footprints by name, their areas worked out
// from each outline. Kept apart from the page so they run in a check (landmark.check.ts).

import type { VwxDocument } from "../../core/index.ts";
import { formatArea, formatLength } from "../../app/units.ts";
import { EXISTING_TREE, HARDSCAPE, LANDSCAPE_AREA, LAUBWERK, MASSING, PLANT, PLANT_RECORD, pathOf, paramsOf, plantSpots, type Params } from "./read.ts";
import { signedArea } from "./shapes.ts";

const PLUGIN = 86;

export interface Schedule {
  readonly title: string;
  readonly head: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

/** Each object of plug-in `name` on the drawing's design layers, wherever it is (in groups, in other plug-ins). */
function objectsOf(doc: VwxDocument, name: string): Params[] {
  const out: Params[] = [];
  for (const l of doc.layers()) {
    if (l.kind !== "design") continue;
    for (const o of doc.objects(l.id)) {
      if (o.type !== PLUGIN) continue;
      const p = paramsOf(doc, o.id, name);
      if (p) out.push(p);
    }
  }
  return out;
}

const byText = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export function plantSchedule(doc: VwxDocument): Schedule {
  const units = doc.info.units;
  const rows = new Map<string, { id: string; latin: string; common: string; spread: number; height: number; size: string; quantity: number }>();
  for (const p of objectsOf(doc, PLANT)) {
    const rec = doc.records(p.id).find((r) => !r.parametric && r.name === PLANT_RECORD);
    const field = (name: string) => rec?.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.value;
    const counted = Number(field("Quantity"));
    const quantity = counted > 0 ? counted : plantSpots(p, doc).length;
    const id = p.text("plant ID");
    const latin = p.text("latin name");
    const key = `${id}\u0000${latin}`;
    const row = rows.get(key);
    if (row) row.quantity += quantity;
    else rows.set(key, { id, latin, common: p.text("common name"), spread: p.num("spread"), height: p.num("height"), size: String(field("Scheduled Size") ?? p.text("__ScheduledSize")), quantity });
  }
  for (const p of objectsOf(doc, LAUBWERK)) {
    const latin = p.text("botanical name");
    const key = `\u0000${latin}`;
    const row = rows.get(key);
    if (row) row.quantity++;
    else rows.set(key, { id: "", latin, common: p.text("common name"), spread: 0, height: 0, size: "", quantity: 1 });
  }
  const length = (mm: number): string => (mm > 0 ? formatLength(mm, units) : "");
  return {
    title: "Plant Schedule",
    head: ["ID", "Latin Name", "Common Name", "Spread", "Height", "Size", "Quantity"],
    rows: [...rows.values()].sort((a, b) => byText(a.id, b.id) || byText(a.latin, b.latin)).map((r) => [r.id, r.latin, r.common, length(r.spread), length(r.height), r.size, r.quantity]),
  };
}

export function treeSchedule(doc: VwxDocument): Schedule {
  const units = doc.info.units;
  const length = (mm: number): string => (mm > 0 ? formatLength(mm, units) : "");
  const layers = new Map(doc.layers().map((l): [string, string] => [l.id, l.name]));
  const trees = objectsOf(doc, EXISTING_TREE).sort((a, b) => byText(a.text("Tree No"), b.text("Tree No")));
  return {
    title: "Existing Tree Schedule",
    head: ["Tree No", "Botanical Name", "Common Name", "Height", "Canopy", "DBH", "Condition", "Significance", "Life Expectancy", "Action", "Comments", "Layer"],
    rows: trees.map((p) => [
      p.text("Tree No"),
      p.text("Genus Species"),
      p.text("Common Name"),
      length(p.num("Height")),
      length(p.num("Canopy")),
      length(p.num("Calliper")),
      p.text("Condition"),
      p.text("Significance"),
      p.text("SULE"),
      p.text("ActionComment"),
      p.text("Comments"),
      layers.get(p.layerId) ?? "",
    ]),
  };
}

export function areaQuantities(doc: VwxDocument): Schedule {
  const units = doc.info.units;
  const rows = new Map<string, { kind: string; name: string; count: number; area: number }>();
  const add = (kind: string, name: string, area: number): void => {
    const key = `${kind}\u0000${name}`;
    const row = rows.get(key) ?? { kind, name, count: 0, area: 0 };
    row.count++;
    row.area += area;
    rows.set(key, row);
  };
  const areaOf = (p: Params): number => Math.abs(signedArea(pathOf(doc, p.id) ?? []));
  for (const p of objectsOf(doc, LANDSCAPE_AREA)) add("Landscape Area", p.text("name") || p.text("ID"), areaOf(p));
  for (const p of objectsOf(doc, HARDSCAPE)) add("Hardscape", p.text("ID"), areaOf(p));
  for (const p of objectsOf(doc, MASSING)) add("Massing Model (footprint)", p.text("Name"), areaOf(p));
  return {
    title: "Landscape Quantities",
    head: ["Kind", "Name", "Count", "Area"],
    rows: [...rows.values()].sort((a, b) => byText(a.kind, b.kind) || byText(a.name, b.name)).map((r) => [r.kind, r.name, r.count, formatArea(r.area, units)]),
  };
}

export function scheduleCsv(s: Schedule): string {
  const cell = (v: string | number): string => (typeof v === "number" ? String(v) : /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [s.head, ...s.rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

