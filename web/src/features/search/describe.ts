// Names and labels of objects, for lists and dialogs. Pure: no DOM, so the check
// script can use it. An object id with a "/" in it is a part drawn by a symbol
// instance (read-only); the instance it belongs to is the real object to select.

import type { ObjectInfo, VwxDocument } from "../../core/index.ts";

/** True for the read-only parts of a symbol instance or worksheet image. */
export function isDerivedId(id: string): boolean {
  return id.includes("/");
}

/** The real object a part belongs to (the instance it is drawn by); an id that is real is returned as it is. */
export function anchorId(id: string): string {
  const i = id.indexOf("/");
  return i < 0 ? id : id.slice(0, i);
}

/** The top-level object a real object sits in (itself when it is top-level), so the selection can hold it. */
export function topLevelId(doc: VwxDocument, id: string): string {
  let cur = doc.object(anchorId(id));
  for (let guard = 0; cur && cur.parentId !== null && guard < 256; guard++) {
    const parent = doc.object(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur?.id ?? anchorId(id);
}

/** Names the lists show: layer names and symbol definition names, read once per use. */
export interface Names {
  readonly layers: ReadonlyMap<string, string>;
  readonly symbols: ReadonlyMap<number, string>;
}

export function namesOf(doc: VwxDocument): Names {
  return {
    layers: new Map(doc.layers().map((l) => [l.id, l.name])),
    symbols: new Map(doc.symbolDefs().map((s) => [s.index, s.name])),
  };
}

const KIND_NAMES: Readonly<Record<ObjectInfo["kind"], string>> = {
  line: "Line",
  rect: "Rectangle",
  polygon: "Polygon",
  polyline: "Polyline",
  arc: "Arc",
  text: "Text",
  image: "Image",
  locus: "2D Locus",
  light: "Light",
  group: "Group",
  symbol: "Symbol",
  other: "Object",
};

/** The kind as a person says it: "Line", "Rectangle", "Symbol". */
export function kindName(o: ObjectInfo): string {
  return KIND_NAMES[o.kind] ?? "Object";
}

/** Text of a text object, cut to `max` characters with an ellipsis. */
export function snippet(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What an object is called in a list: its name, else its symbol's name, else its text, else its kind. */
export function labelOf(o: ObjectInfo, names: Names): string {
  if (o.name) return o.name;
  if (o.kind === "symbol" && o.symbol !== undefined) return names.symbols.get(o.symbol) ?? `Symbol ${o.symbol}`;
  if (o.kind === "text" && o.shape?.text) return `"${snippet(o.shape.text)}"`;
  return kindName(o);
}

/** The text an object holds, "" for none. */
export function textOf(o: ObjectInfo): string {
  return o.kind === "text" && o.shape?.text ? o.shape.text : "";
}
