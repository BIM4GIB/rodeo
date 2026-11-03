// Find Usages: where a symbol definition, class, line type, hatch or other fill,
// or record format is used in the drawing. Symbol instances count wherever they sit,
// in groups, on any layer, and inside other symbol definitions (their parts are
// read-only, so the usage found is the instance that draws them). A class also counts
// viewports on sheet layers that override its visibility. Pure: no DOM.

import type { ObjectInfo, ResourceInfo, VwxDocument } from "../../core/index.ts";
import { anchorId, isDerivedId, labelOf, namesOf, type Names } from "./describe.ts";

/** Something a usage search looks for. */
export type UsageTarget =
  | { readonly kind: "symbol"; readonly index: number; readonly name: string }
  | { readonly kind: "class"; readonly index: number; readonly name: string }
  | { readonly kind: "lineType"; readonly style: number; readonly name: string }
  | { readonly kind: "fill"; readonly resource: number; readonly name: string; readonly fillKind: string }
  | { readonly kind: "record"; readonly format: number; readonly name: string };

/** One place a target is used: a real object (selectable), with where it is. */
export interface Usage {
  /** the real object to select (for a symbol's part, the instance that draws it) */
  readonly id: string;
  readonly layerId: string;
  /** what the object is called */
  readonly label: string;
  /** where the use is, in a few words */
  readonly how: string;
}

/** The fill resources' kinds as the dialogs name them. */
const FILL_KIND: Readonly<Partial<Record<ResourceInfo["kind"], string>>> = {
  hatch: "Hatch",
  tile: "Tile",
  gradient: "Gradient",
  texture: "Texture",
  "image-fill": "Image fill",
};

/** The target's kind and name as a dialog says it: `Symbol "Door"`. */
export function targetLabel(t: UsageTarget): string {
  switch (t.kind) {
    case "symbol":
      return `Symbol "${t.name}"`;
    case "class":
      return `Class "${t.name}"`;
    case "lineType":
      return `Line type "${t.name}"`;
    case "fill":
      return `${t.fillKind} "${t.name}"`;
    case "record":
      return `Record format "${t.name}"`;
  }
}

/** A key that tells two targets apart, for de-duplicating them. */
export function targetKey(t: UsageTarget): string {
  switch (t.kind) {
    case "symbol":
      return `symbol:${t.index}`;
    case "class":
      return `class:${t.index}`;
    case "lineType":
      return `lineType:${t.style}`;
    case "fill":
      return `fill:${t.resource}`;
    case "record":
      return `record:${t.format}`;
  }
}

/** The real objects `ids` name and everything inside them (parts of symbol instances excluded). */
export function objectsWithin(doc: VwxDocument, ids: Iterable<string>): ObjectInfo[] {
  const out: ObjectInfo[] = [];
  const kids = new Map<string, Map<string, ObjectInfo[]>>();
  const childrenOf = (o: ObjectInfo): ObjectInfo[] => {
    let byParent = kids.get(o.layerId);
    if (!byParent) {
      byParent = new Map();
      for (const x of doc.objects(o.layerId)) {
        if (isDerivedId(x.id) || x.parentId === null) continue;
        const list = byParent.get(x.parentId);
        if (list) list.push(x);
        else byParent.set(x.parentId, [x]);
      }
      kids.set(o.layerId, byParent);
    }
    return byParent.get(o.id) ?? [];
  };
  for (const id of ids) {
    const root = doc.object(id);
    if (!root || isDerivedId(id)) continue;
    const stack: ObjectInfo[] = [root];
    for (let o = stack.pop(); o !== undefined; o = stack.pop()) {
      out.push(o);
      stack.push(...childrenOf(o));
    }
  }
  return out;
}

/** The targets the objects use: their symbol, class, line type, fill and record formats, one each. */
export function usageTargetsOf(doc: VwxDocument, objects: readonly ObjectInfo[]): UsageTarget[] {
  const names = namesOf(doc);
  const found = new Map<string, UsageTarget>();
  const add = (t: UsageTarget): void => {
    const key = targetKey(t);
    if (!found.has(key)) found.set(key, t);
  };
  let lineTypes: ReadonlyMap<number, string> | null = null;
  let resources: ReadonlyMap<number, ResourceInfo> | null = null;
  for (const o of objects) {
    if (o.kind === "symbol" && o.symbol !== undefined) {
      add({ kind: "symbol", index: o.symbol, name: names.symbols.get(o.symbol) ?? `Symbol ${o.symbol}` });
    }
    add({ kind: "class", index: o.classIndex, name: o.className || "None" });
    const attrs = o.attrs;
    if (attrs && attrs.lineStyle < 0) {
      lineTypes ??= new Map(doc.lineTypes().map((t) => [t.style, t.name]));
      add({ kind: "lineType", style: attrs.lineStyle, name: lineTypes.get(attrs.lineStyle) ?? `Line type ${-attrs.lineStyle}` });
    }
    if (attrs && attrs.fillPattern < 0) {
      resources ??= new Map(doc.resources().map((r) => [r.index, r]));
      const r = resources.get(-attrs.fillPattern);
      if (r) add({ kind: "fill", resource: r.index, name: r.name, fillKind: FILL_KIND[r.kind] ?? "Fill" });
    }
    for (const rec of doc.records(o.id)) add({ kind: "record", format: rec.format, name: rec.name });
  }
  const order: Record<UsageTarget["kind"], number> = { symbol: 0, class: 1, lineType: 2, fill: 3, record: 4 };
  return [...found.values()].sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Where `target` is used, in layer order then object order; each real object once. */
export function findUsages(doc: VwxDocument, target: UsageTarget): Usage[] {
  const names = namesOf(doc);
  const out: Usage[] = [];
  const seen = new Set<string>();
  const labelFor = (id: string): string => {
    const o = doc.object(id);
    return o ? labelOf(o, names) : id;
  };
  const add = (id: string, layerId: string, how: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, layerId, label: labelFor(id), how });
  };
  const parentWord = (o: ObjectInfo): string => {
    const parent = o.parentId === null ? null : doc.object(o.parentId);
    if (!parent) return "On the layer";
    return parent.kind === "group" ? `In group "${labelOf(parent, names)}"` : `Inside ${labelOf(parent, names)}`;
  };

  for (const layer of doc.layers()) {
    const objects = doc.objects(layer.id);
    if (target.kind === "symbol") {
      for (const o of objects) {
        if (isDerivedId(o.id)) {
          // a nested instance: a part of it carries the definition it places
          if (o.symbol === target.index) add(anchorId(o.id), layer.id, "Nested inside a symbol instance");
        } else if (o.kind === "symbol" && o.symbol === target.index) {
          add(o.id, layer.id, parentWord(o));
        }
      }
    } else if (target.kind === "class") {
      for (const o of objects) {
        if (!isDerivedId(o.id) && o.classIndex === target.index) add(o.id, layer.id, parentWord(o));
      }
      if (layer.kind === "sheet") {
        for (const vid of doc.viewportIds(layer.id)) {
          const vp = doc.viewport(vid);
          const set = vp?.classes.find((c) => c.index === target.index);
          if (vp && set) {
            const named = vp.name ? `"${vp.name}"` : "Viewport";
            add(vid, layer.id, `${named} sets this class ${set.visibility}`);
          }
        }
      }
    } else if (target.kind === "lineType") {
      for (const o of objects) {
        if (o.attrs?.lineStyle === target.style) add(anchorId(o.id), layer.id, usageHow(o, doc, names));
      }
    } else if (target.kind === "fill") {
      for (const o of objects) {
        if (o.attrs?.fillPattern === -target.resource) add(anchorId(o.id), layer.id, usageHow(o, doc, names));
      }
    } else {
      for (const o of objects) {
        if (isDerivedId(o.id)) continue;
        if (doc.records(o.id).some((r) => r.format === target.format)) add(o.id, layer.id, parentWord(o));
      }
    }
  }
  return out;
}

/** How an object uses a line type or fill: directly, or as a part of a symbol instance (which is the usage listed). */
function usageHow(o: ObjectInfo, doc: VwxDocument, names: Names): string {
  if (isDerivedId(o.id)) return "A part of this symbol instance uses it";
  return o.parentId === null ? "On the layer" : `In group "${labelOf(doc.object(o.parentId) ?? o, names)}"`;
}
