// Describes a drawing read by readAny: its units, layers, classes, symbols, objects counted by type,
// extent in plan and in 3D, and what the reader left out. summaryLine gives the one-line form the
// converter page shows under a file; summaryText gives the lines the command line's info prints.
// Only objects on their own are counted: groups are counted through, and what sits inside another
// object (a mesh's faces, a symbol's contents) is not, since it is that object's making.

import type { BBox, ObjectInfo, VwxDocument } from "../core/types.ts";
import { shapeBounds, unionBounds } from "../export/svg.ts";
import { formatById } from "./formats.ts";
import type { DrawingSummary, HeadlessDrawing, LayerSummary } from "./types.ts";

/** Layers listed in summaryText before "and N more". */
const LAYERS_LISTED = 12;
/** Object types listed in summaryText's Objects line before "N other". */
const TYPES_LISTED = 6;

/** What a drawing holds, for people and tools. Lengths are millimetres. */
export function describe(drawing: HeadlessDrawing): DrawingSummary {
  const doc = drawing.session.doc;
  const layers = doc.layers();
  const design = new Set(layers.filter((l) => l.kind === "design").map((l) => l.id));

  const objects: Record<string, number> = {};
  const perLayer = new Map<string, number>();
  const boxes: BBox[] = [];
  for (const layer of layers) {
    for (const o of doc.objects(layer.id)) {
      if (!isCounted(doc, o)) continue;
      objects[o.typeName] = (objects[o.typeName] ?? 0) + 1;
      perLayer.set(layer.id, (perLayer.get(layer.id) ?? 0) + 1);
      if (design.has(layer.id)) {
        const b = o.shape ? shapeBounds(o.shape) : (o.bounds ?? null);
        if (b) boxes.push(b);
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(objects).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  const totalObjects = Object.values(objects).reduce((a, b) => a + b, 0);

  const { bounds3d, triangles } = extent3d(doc, design);
  return {
    name: drawing.name,
    from: drawing.from,
    fromName: formatById(drawing.from)?.name ?? drawing.from,
    units: doc.info.units,
    layers: layers.map((l): LayerSummary => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visibility !== "hidden",
      scale: l.scale,
      // counted as the totals are, so a mesh's faces (its own records) don't count as objects
      objects: perLayer.get(l.id) ?? 0,
    })),
    classes: doc.classes().length,
    symbols: doc.symbolDefs().length,
    objects: sorted,
    totalObjects,
    bounds2d: unionBounds(boxes),
    bounds3d,
    triangles,
    skipped: drawing.skipped,
    notes: drawing.notes,
  };
}

/** Whether an object is counted: not a group, and inside nothing but groups (see the top of this file). */
function isCounted(doc: VwxDocument, o: ObjectInfo): boolean {
  if (o.kind === "group") return false;
  let parent = o.parentId;
  while (parent) {
    const p = doc.object(parent);
    if (!p || p.kind !== "group") return false;
    parent = p.parentId;
  }
  return true;
}

/** The 3D model's extent over the design layers, hidden ones included, and its triangle count. */
function extent3d(doc: VwxDocument, design: ReadonlySet<string>): { bounds3d: DrawingSummary["bounds3d"]; triangles: number } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  let triangles = 0;
  for (const m of doc.model3d()) {
    if (!design.has(m.layerId)) continue;
    triangles += m.triangles.length / 9;
    const t = m.triangles;
    for (let i = 0; i + 2 < t.length; i += 3) {
      const x = t[i], y = t[i + 1], z = t[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
  }
  if (x0 > x1) return { bounds3d: null, triangles };
  return { bounds3d: { x0, y0, z0, x1, y1, z1 }, triangles };
}

/** One line: "Revit · 14 layers · 3,402 objects · 48.2 × 32.0 × 41.5 m", the extent in metres when it is 10 m or more. */
export function summaryLine(s: DrawingSummary): string {
  const parts = [s.fromName, `${s.layers.length} ${s.layers.length === 1 ? "layer" : "layers"}`, `${fmt(s.totalObjects)} ${s.totalObjects === 1 ? "object" : "objects"}`];
  if (s.bounds3d) {
    const b = s.bounds3d;
    parts.push(extentText([b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0]));
  } else if (s.bounds2d) {
    const b = s.bounds2d;
    parts.push(extentText([b.x1 - b.x0, b.y1 - b.y0]));
  }
  return parts.join(" · ");
}

/** The lines the command line's info prints: units, layers, counts, extent, 3D, what was left out and notes. */
export function summaryText(s: DrawingSummary): string[] {
  const out: string[] = [`${s.name}  (${s.fromName})`];
  const row = (label: string, value: string | readonly string[]): void => {
    const lines = typeof value === "string" ? [value] : value;
    lines.forEach((v, i) => out.push(`${(i === 0 ? label : "").padEnd(11)}${v}`));
  };

  row("Units", s.units);
  const layers = s.layers.slice(0, LAYERS_LISTED).map((l, i) => {
    const scale = l.kind === "design" ? `1:${l.scale}, ` : "";
    return `${i + 1}: ${l.name} (${l.kind}, ${scale}${l.visible ? "visible" : "hidden"}, ${fmt(l.objects)} ${l.objects === 1 ? "object" : "objects"})`;
  });
  if (s.layers.length > LAYERS_LISTED) layers.push(`… and ${s.layers.length - LAYERS_LISTED} more`);
  row("Layers", layers.length ? layers : ["none"]);
  row("Classes", fmt(s.classes));
  row("Symbols", fmt(s.symbols));

  const types = Object.entries(s.objects);
  const top = types.slice(0, TYPES_LISTED).map(([name, n]) => `${capitalised(name)} ${fmt(n)}`);
  const otherObjects = types.slice(TYPES_LISTED).reduce((a, [, n]) => a + n, 0);
  if (otherObjects > 0) top.push(`${fmt(otherObjects)} other`);
  row("Objects", top.length ? `${fmt(s.totalObjects)}: ${top.join(" · ")}` : "0");

  row("Extent", s.bounds2d ? `${mmText([s.bounds2d.x1 - s.bounds2d.x0, s.bounds2d.y1 - s.bounds2d.y0])} mm` : "none");
  if (s.bounds3d) {
    const b = s.bounds3d;
    row("3D", `${fmt(s.triangles)} triangles, ${extentText([b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0])}`);
  } else {
    row("3D", "none");
  }

  const left = Object.entries(s.skipped).filter(([, n]) => n > 0).map(([kind, n]) => `${kind} ${fmt(n)}`);
  if (left.length) row("Left out", left.join(" · "));
  if (s.notes.length) row("Note", s.notes);
  return out;
}

/** A type name with a capital first letter, as the summary shows it: "Line", "Rectangle". */
function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A thousands-separated count, in English. */
function fmt(n: number): string {
  return n.toLocaleString("en");
}

/** The extent in millimetres, whole numbers: "48,200 × 32,000". */
function mmText(dims: readonly number[]): string {
  return dims.map((d) => fmt(Math.round(d))).join(" × ");
}

/** The extent in metres to one decimal place when its largest side is 10 m or more, else in millimetres. */
function extentText(dims: readonly number[]): string {
  const largest = Math.max(...dims);
  if (largest >= 10000) {
    return `${dims.map((d) => (d / 1000).toLocaleString("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 })).join(" × ")} m`;
  }
  return `${mmText(dims)} mm`;
}
