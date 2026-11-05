// Checks the three-way merge and blame on a drawing, in node, with no browser:
//
//   cd web && npx tsx src/features/branches/check.ts ../samples/sample.vwx
//
// Both sides edit one copy of the drawing, in memory. A clean merge must equal applying both sides'
// edits, a unit both sides changed must be a conflict until the user picks, and merged bytes must
// reopen unchanged. Blame reads three saved versions. Only the sample is read, never written; it
// prints counts and timings, never the sample's names.

import { existsSync, readFileSync } from "node:fs";
import { blankDrawing } from "../../core/blank.ts";
import { type EditSession, openVwx } from "../../core/index.ts";
import { blameFrom, type VersionPrints } from "./blame.ts";
import { type DiffItem, diffDocuments } from "./diff.ts";
import { type Choice, type Conflict, mergeDocuments } from "./merge.ts";
import { prints, readUnits } from "./units.ts";

const path = process.argv[2] ?? "../samples/sample.vwx";
let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

/** True when two lists hold the same values in any order, counting repeats. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/** True when two maps hold the same keys with the same values. */
function sameMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** The first design layer with drawable objects, and up to n of its top-level object ids. */
function pick(s: EditSession, n: number): { layer: string; ids: string[] } {
  const layer = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.parentId === null && o.shape !== null));
  if (!layer) throw new Error("no design layer with objects");
  const ids = s.doc.objects(layer.id).filter((o) => o.parentId === null && o.shape !== null).map((o) => o.id);
  return { layer: layer.id, ids: ids.slice(0, n) };
}

/** A blank drawing with sixteen rectangles, and a second design layer so that one can be deleted. */
function blankWithRects(): Uint8Array {
  const s = openVwx(blankDrawing("mm"), "check.vwx");
  const layer = s.doc.layers().find((l) => l.kind === "design");
  if (!layer) throw new Error("the blank drawing has no design layer");
  for (let i = 0; i < 16; i++) s.addObject(layer.id, { kind: "rect", x0: i * 100, y0: 0, x1: i * 100 + 50, y1: 50 });
  s.createLayer("Second layer");
  return s.doc.toBytes();
}

/** The layer an object is on. */
function layerOf(s: EditSession, id: string): string {
  const o = s.doc.object(id);
  if (!o) throw new Error(`object ${id} is missing`);
  return o.layerId;
}

/** The class with this name, made when the drawing has none: one name is one class, on both sides. */
function classNamed(s: EditSession, name: string): number {
  const have = s.doc.classes().find((c) => c.name === name);
  return have ? have.index : s.createClass(name);
}

type Edit = (s: EditSession, ids: readonly string[]) => void;

// Main's edits: a move, an addition, a deletion, two class changes, a rename and a class shared with the branch.
const oursEdits: Edit = (s, ids) => {
  s.moveObjects([ids[0]], 100, 0);
  s.addObject(layerOf(s, ids[0]), { kind: "rect", x0: 0, y0: 0, x1: 10, y1: 10 });
  s.deleteObjects([ids[2]]);
  s.setObjectClass([ids[3]], s.createClass("CheckA"));
  s.setObjectName(ids[8], "Ours name");
  s.setObjectClass([ids[12]], classNamed(s, "Shared"));
};

// The branch's edits: the same kinds, a new layer, and the same class name as Main's.
const theirsEdits: Edit = (s, ids) => {
  s.moveObjects([ids[4]], 0, 55);
  s.addObject(layerOf(s, ids[4]), { kind: "rect", x0: 50, y0: 50, x1: 60, y1: 60 });
  s.deleteObjects([ids[5]]);
  s.setObjectClass([ids[6]], s.createClass("CheckB"));
  s.setObjectName(ids[7], "Check name");
  const l = s.createLayer("Check layer");
  s.addObject(l, { kind: "rect", x0: 200, y0: 200, x1: 220, y1: 210 });
  s.setObjectClass([ids[13]], classNamed(s, "Shared"));
};

/** The bytes of a drawing after `edit`, which runs on a copy opened from `bytes`. */
function apply(bytes: Uint8Array, edit: Edit, ids: readonly string[]): Uint8Array {
  const s = openVwx(bytes, "check.vwx");
  edit(s, ids);
  return s.doc.toBytes();
}

/** A rounded box as numbers, or null; the stored bounds, else the shape's. */
function box(b: { x0: number; y0: number; x1: number; y1: number } | null | undefined): number[] | null {
  return b ? [b.x0, b.y0, b.x1, b.y1].map((v) => Math.round(v * 1e6) / 1e6) : null;
}

/** The bounds of an object in a drawing, or null. */
function boxOf(bytes: Uint8Array, id: string): number[] | null {
  const o = openVwx(bytes, "check.vwx").doc.object(id);
  return box(o?.bounds ?? o?.shape?.bbox);
}

/** The ids of the top-level objects on a layer. */
function topIdsOn(bytes: Uint8Array, layer: string): string[] {
  return openVwx(bytes, "check.vwx").doc.objects(layer).filter((o) => o.parentId === null).map((o) => o.id);
}

/** The top-level objects of each layer, in order, in plain text: what a merge must reproduce. */
function describe(bytes: Uint8Array): Map<string, string[]> {
  const doc = openVwx(bytes, "check.vwx").doc;
  const out = new Map<string, string[]>();
  for (const layer of doc.layers()) {
    out.set(
      layer.name,
      doc
        .objects(layer.id)
        .filter((o) => o.parentId === null)
        .map((o) => JSON.stringify([o.typeName, o.className, o.name ?? "", box(o.bounds ?? o.shape?.bbox)])),
    );
  }
  return out;
}

/** The first place two descriptions differ, by position, without any name in it. */
function firstDifference(a: Map<string, string[]>, b: Map<string, string[]>): string {
  if (a.size !== b.size) return `${a.size} layers against ${b.size}`;
  let layerNo = 0;
  for (const [name, list] of a) {
    layerNo++;
    const other = b.get(name);
    if (!other) return `layer ${layerNo} is missing`;
    if (other.length !== list.length) return `layer ${layerNo} holds ${list.length} objects against ${other.length}`;
    const at = list.findIndex((v, i) => v !== other[i]);
    if (at >= 0) return `layer ${layerNo}, object ${at + 1} differs`;
  }
  return "";
}

/** True when the bytes reopen and write out to themselves. */
function reopens(bytes: Uint8Array | null): boolean {
  return bytes !== null && same(openVwx(bytes, "check.vwx").doc.toBytes(), bytes);
}

const sample = existsSync(path) ? openVwx(new Uint8Array(readFileSync(path)), "check.vwx") : null;
const usable = sample !== null && pick(sample, 14).ids.length === 14;
const base = usable && sample ? sample.doc.toBytes() : blankWithRects();
const { layer, ids } = pick(openVwx(base, "check.vwx"), 14);
if (ids.length < 14) throw new Error("the drawing needs fourteen top-level objects to check");

const ours = apply(base, oursEdits, ids);
const theirs = apply(base, theirsEdits, ids);

// 1. the diff finds exactly the edits
const d = diffDocuments(base, ours);
const objectsOf = (items: readonly DiffItem[]): string[] => items.filter((i) => i.what === "object").map((i) => i.id);
const addedObjects = d.added.filter((i) => i.what === "object");
expect("ours adds exactly one object", addedObjects.length === 1, `${addedObjects.length} added`);
const fresh = addedObjects[0];
const fb = fresh?.bounds;
expect("the added rectangle is at (0, 0) to (10, 10)", !!fb && Math.abs(fb.x0) < 1e-6 && Math.abs(fb.y0) < 1e-6 && Math.abs(fb.x1 - 10) < 1e-6 && Math.abs(fb.y1 - 10) < 1e-6);
expect("ours removes exactly the one object it deleted", sameSet(objectsOf(d.removed), [ids[2]]));
expect("ours changes exactly the four objects it touched", sameSet(objectsOf(d.changed), [ids[0], ids[3], ids[8], ids[12]]));
const addedClasses = d.added.filter((i) => i.what === "class").map((i) => i.name ?? "");
expect("ours adds exactly the two classes it made", sameSet(addedClasses, ["CheckA", "Shared"]), `${addedClasses.length} classes`);

// 2. a clean merge equals applying both sides
const started = performance.now();
const m = mergeDocuments(base, ours, theirs);
const mergeMs = performance.now() - started;
expect("a clean merge has no conflicts", m.conflicts.length === 0, `${m.conflicts.length} conflicts`);
expect("a clean merge gives bytes", m.bytes !== null);
const merged = m.bytes ?? new Uint8Array(0);
const expected = apply(ours, theirsEdits, ids);
const mergedDescription = describe(merged);
const expectedDescription = describe(expected);
const sameLayout = mergedDescription.size === expectedDescription.size && [...expectedDescription].every(([name, list]) => {
  const got = mergedDescription.get(name);
  return !!got && got.length === list.length && got.every((v, i) => v === list[i]);
});
expect("the merge equals applying the branch's edits to Main", sameLayout, sameLayout ? "" : firstDifference(mergedDescription, expectedDescription));
const mergedClasses = openVwx(merged, "check.vwx").doc.classes().map((c) => c.name);
const expectedClasses = openVwx(expected, "check.vwx").doc.classes().map((c) => c.name);
expect("the merged classes are the same as applying both sides", sameSet([...new Set(mergedClasses)], [...new Set(expectedClasses)]));
expect("Shared is one class in the merge", mergedClasses.filter((n) => n === "Shared").length === 1, `${mergedClasses.filter((n) => n === "Shared").length} named Shared`);
expect("the merge says the shared class was kept once", m.notes.some((n) => n.includes('Class "Shared"')), `${m.notes.length} notes`);

// 3. an object both sides changed is a conflict until the user picks
const o2 = apply(base, (s, ids) => s.moveObjects([ids[10]], 10, 0), ids);
const t2 = apply(base, (s, ids) => s.moveObjects([ids[10]], 0, 10), ids);
const c2 = mergeDocuments(base, o2, t2);
const only = (c: readonly Conflict[]): Conflict | undefined => (c.length === 1 ? c[0] : undefined);
const c2only = only(c2.conflicts);
expect("a move on both sides is one conflict, on that object", c2only?.key === ids[10], `${c2.conflicts.length} conflicts`);
expect("both sides changed it, and nothing is written yet", c2only?.ours === "changed" && c2only?.theirs === "changed" && c2.bytes === null);
const takeTheirs = mergeDocuments(base, o2, t2, new Map<string, Choice>([[ids[10], "theirs"]]));
expect("picking theirs gives the branch's position", takeTheirs.bytes !== null && JSON.stringify(boxOf(takeTheirs.bytes, ids[10])) === JSON.stringify(boxOf(t2, ids[10])));
const takeOurs = mergeDocuments(base, o2, t2, new Map<string, Choice>([[ids[10], "ours"]]));
expect("picking ours gives Main's position", takeOurs.bytes !== null && JSON.stringify(boxOf(takeOurs.bytes, ids[10])) === JSON.stringify(boxOf(o2, ids[10])));

// 3b. one side deletes an object the other moves
const o3 = apply(base, (s, ids) => s.deleteObjects([ids[11]]), ids);
const t3 = apply(base, (s, ids) => s.moveObjects([ids[11]], 0, 20), ids);
const c3 = mergeDocuments(base, o3, t3);
const c3only = only(c3.conflicts);
expect("a delete against a move is one conflict", c3only?.key === ids[11], `${c3.conflicts.length} conflicts`);
expect("Main removed it and the branch changed it", c3only?.ours === "removed" && c3only?.theirs === "changed");
const back = mergeDocuments(base, o3, t3, new Map<string, Choice>([[ids[11], "theirs"]]));
expect("picking theirs brings the moved object back", back.bytes !== null && JSON.stringify(boxOf(back.bytes, ids[11])) === JSON.stringify(boxOf(t3, ids[11])));

// 4. a container one side removed, with a change inside it on the other side
const o4 = apply(base, (s) => s.deleteLayer(layer), ids);
const t4 = apply(base, (s, ids) => s.moveObjects([ids[1]], 5, 5), ids);
const c4 = mergeDocuments(base, o4, t4);
const c4only = only(c4.conflicts);
expect("a layer Main deleted and the branch changed in is one conflict, on the layer", c4only?.key === layer, `${c4.conflicts.length} conflicts`);
const dropLayer = mergeDocuments(base, o4, t4, new Map<string, Choice>([[layer, "ours"]]));
expect("ours deletes the layer with its objects", dropLayer.bytes !== null && !openVwx(dropLayer.bytes, "check.vwx").doc.layers().some((l) => l.id === layer));
const keepLayer = mergeDocuments(base, o4, t4, new Map<string, Choice>([[layer, "theirs"]]));
expect("theirs keeps the layer with ids[1] moved", keepLayer.bytes !== null && JSON.stringify(boxOf(keepLayer.bytes, ids[1])) === JSON.stringify(boxOf(t4, ids[1])));
expect("theirs keeps every object on the layer", keepLayer.bytes !== null && sameSet(topIdsOn(keepLayer.bytes, layer), topIdsOn(t4, layer)), `${topIdsOn(t4, layer).length} objects`);

// 5. identity cases
const same1 = mergeDocuments(base, ours, base);
expect("merging the base into Main changes nothing", same1.bytes !== null && sameMap(prints(readUnits(same1.bytes)), prints(readUnits(ours))));
const same2 = mergeDocuments(base, base, theirs);
expect("merging the branch onto the base gives the branch's objects", same2.bytes !== null && sameMap(prints(readUnits(same2.bytes)), prints(readUnits(theirs))));

// 6. every merged drawing reopens to the same bytes
const outputs = [m.bytes, takeTheirs.bytes, takeOurs.bytes, back.bytes, dropLayer.bytes, keepLayer.bytes, same1.bytes, same2.bytes];
expect("every merged drawing reopens to the same bytes", outputs.every((b) => b === null || reopens(b)));

// 7. blame from three saved versions: base by A, Main by B, the merge by C
const theirsRect = diffDocuments(base, theirs).added.find((i) => i.what === "object" && i.bounds !== null && Math.abs(i.bounds.x0 - 50) < 1e-6);
const version = (versionId: string, author: string, bytes: Uint8Array): VersionPrints => ({
  versionId,
  authorId: author,
  authorName: author,
  at: "2026-11-04T00:00:00Z",
  label: null,
  prints: prints(readUnits(bytes)),
});
const versions = [version("v1", "A", base), version("v2", "B", ours), version("v3", "C", merged)];
const blame = blameFrom(versions, true);
expect("an object Main moved is blamed on B", blame.get(ids[0])?.authorName === "B");
expect("an object the branch added is blamed on C", !!theirsRect && blame.get(theirsRect.id)?.authorName === "C");
expect("an object nobody changed is blamed on A, not as 'or earlier'", blame.get(ids[9])?.authorName === "A" && blame.get(ids[9])?.orEarlier === false);
const incomplete = blameFrom(versions, false);
expect("with an older history than the first version, an unchanged object is 'or earlier'", incomplete.get(ids[9])?.orEarlier === true);

// 8. timing on the input
console.log(`merge: ${mergeMs.toFixed(0)} ms for the input and its branch`);
if (mergeMs > 3000) console.warn("warning: the merge took more than three seconds");

console.log(failures === 0 ? "\nall passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
