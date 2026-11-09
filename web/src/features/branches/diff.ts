// The object-level difference between two versions of a drawing: what was added, removed and
// changed, by unit (objects on layers, classes, symbols, resources, layers, document settings),
// each with its id, what it is, where it is and its stored bounds. Fast on large drawings: it
// compares record fingerprints, never decoded geometry. DOM-free; other features may import it.

import { readBBox } from "../../core/encode.ts";
import { TYPE_NAMES } from "../../core/records.ts";
import type { BBox } from "../../core/types.ts";
import { u16 } from "../../core/bytes.ts";
import { layerName, NAMES_KEY, readUnits, stateOf, type UnitKind, type Units, whatOf } from "./units.ts";

export type { UnitKind } from "./units.ts";

/** How a unit differs between the two drawings. */
export type ChangeKind = "added" | "removed" | "changed";

/** One unit that was added, removed or changed. */
export interface DiffItem {
  /** the unit key: the GUID of an object, layer, class, symbol or resource (ObjectInfo.id for objects) */
  readonly id: string;
  readonly kind: ChangeKind;
  readonly what: UnitKind;
  /** record type and its name ("rectangle", "wall"; "type-N" when unknown) */
  readonly type: number;
  readonly typeName: string;
  /** the name it is given (name table), or null; for a layer, the layer's own name */
  readonly name: string | null;
  /** objects: the layer it is on (in b; in a when removed); null otherwise */
  readonly layerId: string | null;
  /** objects: that layer's name, else "" */
  readonly layerName: string;
  /** stored plan bounds (+0x68) in b (a when removed), or null when the record stores none */
  readonly bounds: BBox | null;
  /** changed only: the bounds in a */
  readonly boundsBefore: BBox | null;
  /** changed only: it moved to another layer */
  readonly moved: boolean;
  /** changed only: its record is the same and only its name in the name table changed */
  readonly renamed: boolean;
}

/** The units that differ between two drawings, with how long the diff took. */
export interface DocumentDiff {
  readonly added: readonly DiffItem[];
  readonly removed: readonly DiffItem[];
  readonly changed: readonly DiffItem[];
  /** objects in b not reported */
  readonly unchanged: number;
  readonly ms: number;
}

/** What changed from drawing a to drawing b. */
export function diffDocuments(a: Uint8Array, b: Uint8Array): DocumentDiff {
  // the time includes splitting both drawings, which is most of it
  const t0 = performance.now();
  const diff = diffUnits(readUnits(a), readUnits(b));
  return { ...diff, ms: performance.now() - t0 };
}

/** diffDocuments on drawings already split into units. */
export function diffUnits(a: Units, b: Units): DocumentDiff {
  const t0 = performance.now();
  const added: DiffItem[] = [];
  const removed: DiffItem[] = [];
  const changed: DiffItem[] = [];
  // keys reported as added or changed, so a rename does not report them twice
  const reported = new Set<string>();

  for (const [k, after] of b.units) {
    if (k === NAMES_KEY) continue;
    const before = a.units.get(k);
    if (!before) {
      added.push(describeUnit(b, k, "added"));
      reported.add(k);
    } else if (stateOf(a, k) !== stateOf(b, k)) {
      changed.push({ ...describeUnit(b, k, "changed"), boundsBefore: boundsOf(a, k), moved: before.parent !== after.parent });
      reported.add(k);
    }
  }
  for (const k of a.units.keys()) {
    if (k !== NAMES_KEY && !b.units.has(k)) removed.push(describeUnit(a, k, "removed"));
  }

  // a name whose entry changed leaves the records that name it the same, so their fingerprints
  // match; they are reported here as renamed
  const renamedIndex = new Set<number>();
  for (const [index, name] of a.names) {
    const now = b.names.get(index);
    if (now !== undefined && now !== name) renamedIndex.add(index);
  }
  if (renamedIndex.size > 0) {
    for (const [k, x] of b.units) {
      if (k === NAMES_KEY || reported.has(k)) continue;
      if (!renamedIndex.has(u16(b.recs[x.start].data, 0x1a))) continue;
      const before = a.units.get(k);
      if (!before) continue;
      changed.push({ ...describeUnit(b, k, "changed"), boundsBefore: boundsOf(a, k), moved: before.parent !== x.parent, renamed: true });
      reported.add(k);
    }
  }

  let objects = 0;
  for (const k of b.units.keys()) if (k !== NAMES_KEY && whatOf(b, k) === "object") objects++;
  let reportedObjects = 0;
  for (const item of added) if (item.what === "object") reportedObjects++;
  for (const item of changed) if (item.what === "object") reportedObjects++;

  return { added, removed, changed, unchanged: objects - reportedObjects, ms: performance.now() - t0 };
}

/** A unit as a DiffItem would describe it (kind set by the caller). */
export function describeUnit(u: Units, key: string, kind: ChangeKind): DiffItem {
  const x = u.units.get(key);
  if (!x) throw new Error(`unit ${key} is missing`);
  const what = whatOf(u, key);
  const root = u.recs[x.start].data;
  const object = what === "object";
  // a layer's name is in its record, not the name table
  const name = what === "layer" ? (layerName(u, key) || null) : (u.names.get(u16(root, 0x1a)) ?? null);
  return {
    id: key,
    kind,
    what,
    type: x.type,
    typeName: TYPE_NAMES[x.type] ?? `type-${x.type}`,
    name,
    layerId: object ? x.parent : null,
    layerName: object ? layerName(u, x.parent) : "",
    bounds: object ? readBBox(root) : null,
    boundsBefore: null,
    moved: false,
    renamed: false,
  };
}

/** The stored bounds of an object unit, or null for any other kind of unit. */
function boundsOf(u: Units, key: string): BBox | null {
  const x = u.units.get(key);
  if (!x || whatOf(u, key) !== "object") return null;
  return readBBox(u.recs[x.start].data);
}

/** A unit in plain words: 'Rectangle "Door 1" on Ground Floor', 'Class "Doors"', 'Layer "Roof"', 'Document settings'. */
export function unitLabel(item: DiffItem): string {
  if (item.what === "settings") return "Document settings";
  if (item.what === "layer") return item.name ? `Layer "${item.name}"` : "Layer";
  if (item.what === "class") return item.name ? `Class "${item.name}"` : "Class";
  if (item.what === "symbol") return item.name ? `Symbol "${item.name}"` : "Symbol";
  const type = item.typeName.startsWith("type-") ? "Object" : capitalise(item.typeName);
  if (item.what === "resource") return item.name ? `${type} "${item.name}"` : type;
  return `${type}${item.name ? ` "${item.name}"` : ""} on ${item.layerName || "a layer"}`;
}

/** "rounded-rectangle" reads "Rounded rectangle": a capital and plain words. */
function capitalise(typeName: string): string {
  const words = typeName.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
