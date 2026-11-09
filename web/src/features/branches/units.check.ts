// Checks the units and diff modules on a drawing, in node, with no browser:
//
//   cd web && npx tsx src/features/branches/units.check.ts ../samples/sample.vwx
//
// It works on copies in memory and only reads the sample. The emitter must write a drawing back
// byte for byte, the diff must find exactly the edits made to a copy, and a unit taken from
// another copy must re-save unchanged and keep its fingerprint. Prints counts and timings only.

import { existsSync, readFileSync } from "node:fs";
import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type EditSession } from "../../core/index.ts";
import { diffDocuments, unitLabel } from "./diff.ts";
import { identityPlan, keepOnly, readUnits, renumberNames, writeDocument } from "./units.ts";

const path = process.argv[2] ?? "../samples/sample.vwx";
let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

/** True when two lists of ids hold the same ids, each once. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
}

/** The first design layer with drawable objects, and up to n of its top-level object ids. */
function pick(s: EditSession, n: number): { layer: string; ids: string[] } {
  const layer = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.parentId === null && o.shape !== null));
  if (!layer) throw new Error("no design layer with objects");
  const ids = s.doc.objects(layer.id).filter((o) => o.parentId === null && o.shape !== null).map((o) => o.id);
  return { layer: layer.id, ids: ids.slice(0, n) };
}

/** A blank drawing with sixteen rectangles on its first design layer, for when there is no sample. */
function blankWithRects(): Uint8Array {
  const s = openVwx(blankDrawing("mm"), "check.vwx");
  const layer = s.doc.layers().find((l) => l.kind === "design");
  if (!layer) throw new Error("the blank drawing has no design layer");
  for (let i = 0; i < 16; i++) s.addObject(layer.id, { kind: "rect", x0: i * 100, y0: 0, x1: i * 100 + 50, y1: 50 });
  return s.doc.toBytes();
}

const src = existsSync(path) ? new Uint8Array(readFileSync(path)) : blankWithRects();
const base = openVwx(src, "check.vwx").doc.toBytes();
const session = openVwx(base, "check.vwx");
const { layer, ids } = pick(session, 4);
if (ids.length < 4) throw new Error("the drawing needs four top-level objects to check");

// 1. the emitter writes a drawing back byte for byte
const units = readUnits(base);
expect("units re-emit byte for byte", same(writeDocument(identityPlan(units)), base));

// 2. a drawing against itself has no changes
const none = diffDocuments(base, base);
expect("a drawing against itself has no changes", none.added.length === 0 && none.removed.length === 0 && none.changed.length === 0, `${none.unchanged} objects unchanged`);

// 3. the diff finds exactly the edits made to a copy
const edit = openVwx(base, "check.vwx");
edit.moveObjects([ids[0]], 100, 0);
const added = edit.addObject(layer, { kind: "rect", x0: 0, y0: 0, x1: 10, y1: 10 });
edit.deleteObjects([ids[2]]);
edit.setObjectName(ids[3], "Check name");
const edited = edit.doc.toBytes();
const d = diffDocuments(base, edited);
const objectIds = (items: readonly { id: string; what: string }[]): string[] => items.filter((i) => i.what === "object").map((i) => i.id);
expect("the one new object is the only object added", sameSet(objectIds(d.added), [added]));
expect("the one deleted object is the only object removed", sameSet(objectIds(d.removed), [ids[2]]));
expect("the moved and renamed objects are the only objects changed", sameSet(objectIds(d.changed), [ids[0], ids[3]]));

const moved = d.changed.find((i) => i.id === ids[0]);
const shift = moved?.boundsBefore && moved.bounds ? moved.bounds.x0 - moved.boundsBefore.x0 : NaN;
expect("a moved object's bounds shift by the move", Math.abs(shift - 100) < 1e-6, `shift ${shift}`);

const fresh = d.added.find((i) => i.id === added);
const b = fresh?.bounds;
expect("the new rectangle's bounds are (0, 0, 10, 10)", !!b && Math.abs(b.x0) < 1e-6 && Math.abs(b.y0) < 1e-6 && Math.abs(b.x1 - 10) < 1e-6 && Math.abs(b.y1 - 10) < 1e-6);
expect("the new rectangle reads as one", !!fresh && unitLabel(fresh).startsWith("Rectangle"));

// 4. keepOnly keeps the two objects, and every class
const kept = openVwx(keepOnly(readUnits(base), new Set([ids[0], ids[1]])), "check.vwx");
const keptTop = kept.doc.layers().flatMap((l) => kept.doc.objects(l.id)).filter((o) => o.parentId === null).map((o) => o.id);
expect("keepOnly keeps exactly the two objects", sameSet(keptTop, [ids[0], ids[1]]), `${keptTop.length} objects`);
expect("keepOnly keeps every class", kept.doc.classes().length === openVwx(base, "check.vwx").doc.classes().length);

// 5. a unit taken from another copy lands with fresh addresses, re-saves unchanged, and keeps its fingerprint
const editedUnits = readUnits(edited);
const plan = identityPlan(units);
const parent = units.units.get(ids[1])?.parent ?? "";
const lists = new Map(plan.lists);
lists.set(parent, (plan.lists.get(parent) ?? []).map((p) => (p.key === ids[1] ? { key: ids[1], from: editedUnits } : p)));
const mixed = writeDocument({ ...plan, lists });
const mixedSession = openVwx(mixed, "check.vwx");
expect("a unit taken from another copy reopens", mixedSession.doc.object(ids[1]) !== null);
expect("that drawing re-saves unchanged", same(mixedSession.doc.toBytes(), mixed));
const mixedDiff = diffDocuments(base, mixed);
expect("the re-addressed unit keeps its fingerprint", mixedDiff.added.length === 0 && mixedDiff.removed.length === 0 && mixedDiff.changed.length === 0);

// 5b. a whole layer (a split container) taken from another copy keeps its objects, and the name
// table written from its own entries comes back unchanged
const layerPlan = identityPlan(units);
const layerLists = new Map(layerPlan.lists);
layerLists.set("", (layerPlan.lists.get("") ?? []).map((p) => (p.key === layer ? { key: layer, from: editedUnits } : p)));
layerLists.set(layer, (editedUnits.lists.get(layer) ?? []).map((key) => ({ key, from: editedUnits })));
const withLayer = writeDocument({ ...layerPlan, lists: layerLists });
const layerDiff = diffDocuments(edited, withLayer);
expect("a layer taken from another copy re-saves unchanged", same(openVwx(withLayer, "check.vwx").doc.toBytes(), withLayer));
expect("a layer taken from another copy keeps its objects", objectIds([...layerDiff.added, ...layerDiff.removed, ...layerDiff.changed]).length === 0);
const namesBack = writeDocument({ ...identityPlan(units), names: new Map(units.names) });
expect("the name table written from its entries comes back unchanged", same(namesBack, base));

// 6. renumberNames rewrites each reference it knows, and leaves 0 (unnamed) alone
const rec = new Uint8Array(0x100);
const rv = new DataView(rec.buffer);
rec[0x19] = 3; // a rectangle
rv.setUint16(0x1a, 5, true); // its name index
rv.setUint32(0x20, 6, true); // its class index
rv.setInt32(0x50, -7, true); // its line type
renumberNames(rec, new Map([[5, 50], [6, 60], [7, 70]]));
expect("renumberNames rewrites the name and class indices", rv.getUint16(0x1a, true) === 50 && rv.getUint32(0x20, true) === 60);
expect("renumberNames rewrites a line type as a negative reference", rv.getInt32(0x50, true) === -70);
rv.setUint16(0x1a, 0, true);
renumberNames(rec, new Map([[0, 99]]));
expect("renumberNames leaves unnamed (0) alone", rv.getUint16(0x1a, true) === 0);

// 7. timings on the input
const t0 = performance.now();
readUnits(base);
const readMs = performance.now() - t0;
console.log(`readUnits: ${readMs.toFixed(0)} ms for ${units.recs.length} records`);
console.log(`diffDocuments: ${none.ms.toFixed(0)} ms for two copies of the input`);

console.log(failures === 0 ? "\nall passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
