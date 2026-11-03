// Checks walls an import makes whole (EditSession.addPlainWalls), with their openings. Run from web/:
//   npx tsx src/core/wallProfile.check.ts
// A 5 m wall 3 m high and 200 mm thick, with a door from its foot and a window, on a layer 3 m up:
// its line, heights and class; its plan broken at both (cut 1.2 m up); its 3D's faces covering
// exactly the wall less the two holes, with their reveals; the same once saved and opened again; a
// wall the openings leave nothing of, and one with no length, made as ""; and the usual edits
// (heights, ends) working on it.

import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { VwxDocument } from "./types.ts";
import { wallProfile } from "./wallProfile.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number | undefined, b: number, slack = 0.5): boolean => a !== undefined && Math.abs(a - b) <= slack;

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// the profile alone
const alone = wallProfile(5000, 3000, [rect(1000, 0, 2000, 2100), rect(3000, 900, 4000, 2100)]);
check(alone?.rings.length === 2, `a door notches the outline and a window is a hole (${alone?.rings.length} rings)`);
check(JSON.stringify(alone?.plan) === "[[0,1000],[2000,3000],[4000,5000]]", `the plan is cut where both are (${JSON.stringify(alone?.plan)})`);
check(JSON.stringify(wallProfile(5000, 3000, [rect(1000, 1500, 2000, 2900)])?.plan) === "[[0,5000]]", "a window above the cut doesn't break the plan");
check(wallProfile(5000, 3000, [rect(-10, -10, 5010, 3010)]) === null, "an opening over the whole wall leaves nothing");

/** The area of an object's shaded faces, mm². */
function area(doc: VwxDocument, id: string): number {
  let sum = 0;
  for (const m of doc.model3d().filter((m) => m.objectId === id)) {
    const t = m.triangles;
    for (let i = 0; i + 8 < t.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(t.subarray(i, i + 9));
      const [ux, uy, uz, vx, vy, vz] = [bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az];
      sum += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
  }
  return sum;
}
/** z range of an object's faces */
function zs(doc: VwxDocument, id: string): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of doc.model3d().filter((m) => m.objectId === id))
    for (let i = 2; i < m.triangles.length; i += 3) {
      lo = Math.min(lo, m.triangles[i]);
      hi = Math.max(hi, m.triangles[i]);
    }
  return [lo, hi];
}

const s = openVwx(blankDrawing("mm"));
const layer = s.createLayer("First Model", "design", 100);
s.setLayerElevation(layer, 3000);
const cls = s.createClass("Walls");
const ids = s.addPlainWalls(layer, [
  { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, thickness: 200, bottom: 0, top: 3000, classIndex: cls, openings: [rect(1000, 0, 2000, 2100), rect(3000, 900, 4000, 2100)] },
  { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, thickness: 200, bottom: 0, top: 3000 },
  { start: { x: 0, y: 1000 }, end: { x: 4000, y: 1000 }, thickness: 100, bottom: 0, top: 2700, openings: [rect(-1, -1, 4001, 2701)] },
  { start: { x: 6000, y: 0 }, end: { x: 6000, y: 4000 }, thickness: 150, bottom: 100, top: 2800 },
]);
check(ids[0] !== "" && ids[1] === "" && ids[2] === "" && ids[3] !== "", `a wall of no length or nothing left isn't made (${ids.map((i) => (i ? "made" : '""')).join(", ")})`);

// faces: two sides less both holes, top, bottom less the door, ends, and the holes' reveals
const expected = 2 * (15 - 2.1 - 1.2) * 1e6 + 5000 * 200 + 4000 * 200 + 2 * 3000 * 200 + (2 * 2100 + 1000) * 200 + (2 * 1200 + 2 * 1000) * 200;
for (const [label, doc] of [
  ["made", s.doc],
  ["saved and opened again", openVwx(s.doc.toBytes()).doc],
] as const) {
  const w = doc.wall(ids[0]);
  check(!!w && near(w.start.x, 0) && near(w.end.x, 5000) && near(w.thickness, 200) && near(w.bottom, 0) && near(w.top, 3000), `${label}: its line, thickness and heights above the layer (${JSON.stringify(w)})`);
  const o = doc.objects(layer).find((x) => x.id === ids[0]);
  check(o?.typeName === "wall" && o.className === "Walls", `${label}: a wall in its class (${o?.typeName}, ${o?.className})`);
  const pieces = doc.objects(layer).filter((x) => x.parentId === ids[0] && x.typeName === "polygon");
  check(pieces.length === 3, `${label}: its plan in three pieces (${pieces.length})`);
  const a = area(doc, ids[0]);
  check(near(a, expected, expected * 1e-6), `${label}: its faces cover the wall less its holes, reveals and all (${(a / 1e6).toFixed(3)} m², want ${(expected / 1e6).toFixed(3)})`);
  const [lo, hi] = zs(doc, ids[0]);
  check(near(lo, 3000) && near(hi, 6000), `${label}: in 3D at the layer's height (${lo} to ${hi})`);
  const plain = doc.wall(ids[3]);
  check(!!plain && near(plain.bottom, 100) && near(plain.top, 2800), `${label}: a wall without openings stands from its foot to its top (${plain?.bottom} to ${plain?.top})`);
}

// the edits a wall takes
let edited = true;
try {
  s.setWallHeights(ids[3], 0, 3000);
  s.setWallLine(ids[3], { x: 6000, y: 0 }, { x: 6000, y: 5000 });
} catch (err) {
  edited = false;
  console.log(String(err));
}
const after = s.doc.wall(ids[3]);
check(edited && near(after?.top, 3000) && near(after?.end.y, 5000), `its heights and ends can be edited (${after?.top}, ${after?.end.y})`);
const [lo3, hi3] = zs(s.doc, ids[3]);
check(near(lo3, 3000) && near(hi3, 6000), `and its 3D follows (${lo3} to ${hi3})`);

console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
