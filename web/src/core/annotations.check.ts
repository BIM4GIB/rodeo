// Checks Edit Annotations under Node. Run from web/:
//   npx tsx src/core/annotations.check.ts
// A blank drawing gets a sheet with a 1:50 plan viewport. Its annotations open as a layer of their
// own, take new objects in sheet × scale coordinates, leave the sheet's list while open and come
// back on it placed at 1/scale when closed; an edit to a design layer meanwhile keeps both right;
// undo takes a new annotation away, and the drawing saves and reopens with it. Nothing is drawn.

import { shapeBBox } from "../app/shapes.ts";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { BBox } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const boxOf = (id: string): BBox | null => {
  const shape = s.doc.object(id)?.shape;
  return shape ? shapeBBox(shape) : null;
};

const s = openVwx(blankDrawing("mm"), "annotations.vwx");
const design = s.doc.layers().find((l) => l.kind === "design")!;
const square = s.addObject(design.id, { kind: "rect", x0: 0, y0: 0, x1: 4000, y1: 3000 });
const sheet = s.createLayer("Sheet 1", "sheet");
const none = s.doc.classes().find((c) => c.name === "None")!.index;
const vp = s.createViewport(sheet, {
  scale: 50,
  box: { x0: 100, y0: 100, x1: 200, y1: 180 },
  at: { x: 2000, y: 1500 },
  layers: [{ id: design.id, visibility: "visible" }],
  classes: [{ index: none, visibility: "visible" }],
});
const onSheet = () => s.doc.objects(sheet).map((o) => o.id);

check(s.doc.openAnnotations("no such viewport") === null, "a missing viewport opens nothing");
const notes = s.doc.openAnnotations(vp);
check(!!notes && notes !== sheet, `the viewport's annotations open under an id of their own (${notes})`);
if (!notes) process.exit(1);
check(s.doc.objects(notes).length === 0, "a new viewport has no annotations");
check(onSheet().includes(vp) && !onSheet().includes(notes), "the sheet keeps the viewport, not its open annotation group");

// a label 250 mm right and 125 mm up of the box's middle, as the 1:50 viewport is drawn: sheet × 50
const label = s.addObject(notes, { kind: "rect", x0: 150 * 50 + 100, y0: 140 * 50 - 100, x1: 150 * 50 + 300, y1: 140 * 50 + 100 });
const open = s.doc.object(label);
check(open?.layerId === notes && open.parentId === null, "a new object goes into the annotations, at their top level");
const b0 = boxOf(label);
check(!!b0 && near(b0.x0, 7600) && near(b0.y1, 7100), `in their own coordinates (${JSON.stringify(b0)})`);
check(!onSheet().includes(label), "and not on the sheet while they are open");

// an edit elsewhere while they are open
s.moveObjects([square], 100, 0);
check(s.doc.objects(notes).some((o) => o.id === label), "an edit to a design layer leaves the open annotations listed");
s.moveObjects([label], 50, 0);
check(near(boxOf(label)?.x0 ?? NaN, 7650), "an annotation moves where it is");

s.doc.openAnnotations(null);
const closed = s.doc.object(label);
check(onSheet().includes(label) && closed?.layerId === sheet && closed.parentId === notes, "closed, it is on the sheet in the viewport's annotation group");
const b1 = boxOf(label);
check(!!b1 && near(b1.x0, 7650 / 50) && near(b1.y1, 7100 / 50), `placed at 1/50 on the sheet (${JSON.stringify(b1)})`);
check(s.doc.objects(notes).length === 0 && !s.doc.layers().some((l) => l.id === notes), "and its group is no layer any more");

// undo, while open again
s.doc.openAnnotations(vp);
s.undo();
check(near(boxOf(label)?.x0 ?? NaN, 7600), "undo moves it back");
s.undo();
s.undo();
check(s.doc.object(label) === null && s.doc.objects(notes).length === 0, "and, past the square's move, takes it away");
s.redo();
s.redo();
s.redo();
check(s.doc.objects(notes).length === 1 && near(boxOf(label)?.x0 ?? NaN, 7650), "redo puts it back where it was moved");
s.doc.openAnnotations(null);

const again = openVwx(s.doc.toBytes(), "annotations.vwx");
const kept = again.doc.object(label);
const b2 = kept?.shape ? shapeBBox(kept.shape) : null;
check(!!kept && kept.parentId === notes && !!b2 && near(b2.x0, 7650 / 50), `saved and reopened, the annotation is in its viewport (${JSON.stringify(b2)})`);
check(again.doc.openAnnotations(vp) === notes && again.doc.objects(notes).length === 1, "and opens again with it");

console.log(failures ? `${failures} failed` : "all passed");
if (failures) process.exit(1);
