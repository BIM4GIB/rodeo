// Checks the object index kept across edits (objectIndex.ts) under Node. Run from web/:
//   npx tsx src/core/objectIndex.check.ts
// A blank drawing gets objects on two layers, then a run of edits. After each, every layer's
// objects and every lookup by id read the same as the saved file reopened (indexed whole), and
// an edit to one layer's objects leaves the other layer's list, and its own objects the edit
// did not touch, as the very same objects. Symbols are left out: a blank drawing has no
// definition to make one from.

import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { NewShape, ObjectInfo, VwxDocument } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const json = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x as Uint8Array) : x instanceof Map ? [...x] : x));

/** Every layer's objects, and each object looked up by its id. */
function read(doc: VwxDocument): string {
  const out: string[] = [];
  for (const l of doc.layers()) {
    out.push(l.id);
    for (const o of doc.objects(l.id)) out.push(json(o), json(doc.object(o.id)));
  }
  return out.join("\n");
}

const shapes = (dx: number, n: number): NewShape[] =>
  Array.from({ length: n }, (_, i): NewShape => {
    const x = dx + 40 * i;
    switch (i % 4) {
      case 0:
        return { kind: "rect", x0: x, y0: 0, x1: x + 30, y1: 20 };
      case 1:
        return { kind: "line", a: { x, y: 0 }, b: { x: x + 30, y: 25 } };
      case 2:
        return { kind: "polygon", points: [{ x, y: 0 }, { x: x + 30, y: 0 }, { x: x + 15, y: 30 }], closed: true };
      default:
        return { kind: "arc", center: { x: x + 15, y: 15 }, radius: 10, startAngle: 0, sweepAngle: 360 };
    }
  });

const s = openVwx(blankDrawing("mm"), "index-check.vwx");
const a = s.doc.layers()[0].id;
const b = s.createLayer("Second", "design", 50);
const onA = s.addObjects(a, shapes(0, 24));
const onB = s.addObjects(b, shapes(0, 8));
const tops = (layer: string) => s.doc.objects(layer).filter((o) => o.parentId === null);

/**
 * Runs an edit and checks the index against the file reopened. `only`: the one layer the edit
 * changes objects on, whose other objects (all but `changed` top-level ones) stay the same.
 */
function step(what: string, edit: () => void, only?: { layer: string; changed: number }): void {
  const before = new Map(s.doc.layers().map((l) => [l.id, s.doc.objects(l.id)] as const));
  edit();
  check(read(s.doc) === read(openVwx(s.doc.toBytes(), "again.vwx").doc), `${what}: reads as the file reopened`);
  if (!only) return;
  const others = [...before].filter(([id]) => id !== only.layer && s.doc.layers().some((l) => l.id === id));
  check(others.every(([id, list]) => s.doc.objects(id) === list), `${what}: the other layer's objects are the same list`);
  const had = new Set<ObjectInfo>(before.get(only.layer));
  const kept = tops(only.layer).filter((o) => had.has(o)).length;
  check(kept === tops(only.layer).length - only.changed, `${what}: ${kept} of ${tops(only.layer).length} top-level objects kept`);
}

step("move one", () => s.moveObjects([onA[5]], 3, 4), { layer: a, changed: 1 });
step("move one on the other layer", () => s.moveObjects([onB[2]], -2, 1), { layer: b, changed: 1 });
let group = "";
step("group three", () => (group = s.groupObjects(onA.slice(8, 11))), { layer: a, changed: 1 });
step("move the group", () => s.moveObjects([group], 5, 5), { layer: a, changed: 1 });
step("delete one", () => s.deleteObjects([onA[0]]), { layer: a, changed: 0 });
let copies: string[] = [];
step("duplicate one", () => (copies = s.duplicateObjects([onA[3]], 10, 10)), { layer: a, changed: 1 });
step("move the copy", () => s.moveObjects(copies, 1, 1), { layer: a, changed: 1 });
step("pen colour", () => s.setAttributes([onA[12], onA[13]], { penFore: 3 }), { layer: a, changed: 2 });
const walls = s.createClass("Walls");
step("class", () => s.setObjectClass([onA[14]], walls), { layer: a, changed: 1 });
step("send to back", () => s.arrangeObjects([onA[20]], "back"));
step("drop shadow", () => s.setDropShadow([onA[15]], { offset: 0.1, angle: 315, blur: 0.05, opacity: 50, color: 0 }), {
  layer: a,
  changed: 1,
});
step("undo twice", () => {
  s.undo();
  s.undo();
});
step("redo", () => s.redo());
step("move on both layers", () => s.moveObjects([onA[16], onB[4]], 2, -2));
step("add to the other layer", () => s.addObjects(b, shapes(400, 3)), { layer: b, changed: 3 });
step("ungroup", () => s.ungroupObjects([group]));
step("delete two apart", () => s.deleteObjects([onA[17], onA[22]]));
step("layer scale", () => s.setLayerScale(a, 20));
step("rename layer", () => s.renameLayer(b, "Other"));
step("move after the layer changes", () => s.moveObjects([onA[21]], -4, 0), { layer: a, changed: 1 });
step("delete the other layer's objects", () => s.deleteObjects(tops(b).map((o) => o.id)), { layer: b, changed: 0 });
step("add to the emptied layer", () => s.addObjects(b, shapes(0, 2)));

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
