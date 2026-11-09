// Checks reading Landmark's objects and the rows of their schedules, on a blank drawing with plug-in
// objects named as Landmark names them. Run from web/:
//   npx tsx src/features/landmark/landmark.check.ts
// Parameters read in any case, Landmark's "TRUE" popups as flags; plants counted by their Plant
// Record's quantity, or one for each without, summed by ID, Laubwerk plants by botanical name; trees one
// a row in number order with their layer; an outline's area; CSV quoting; area units; and the 3D shapes
// a redraw makes: a canopy closed and inside its box, a slab's faces, a flat bed facing up.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx } from "../../core/index.ts";
import type { PluginFieldSpec, RecordValue } from "../../core/index.ts";
import { areaUnit, EXISTING_TREE, LAUBWERK, paramsOf, PLANT, PLANT_RECORD } from "./read.ts";
import { areaQuantities, plantSchedule, scheduleCsv, treeSchedule } from "./scheduleRows.ts";
import { bedFace, canopyFaces, perimeter, prismFaces, signedArea } from "./shapes.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const TEXT = 4;
const BOOL = 2;
const DIMENSION = 7;
const fieldsOf = (values: Readonly<Record<string, RecordValue>>): PluginFieldSpec[] =>
  Object.entries(values).map(([name, value]) => ({ name, type: typeof value === "number" ? DIMENSION : typeof value === "boolean" ? BOOL : TEXT, value }));

const s = openVwx(blankDrawing("mm"));
const layer = s.createLayer("Planting", "design", 100);
const add = (name: string, values: Readonly<Record<string, RecordValue>>, x = 0): string => s.addPluginObject(layer, name, fieldsOf(values), values, { x, y: 0 }, 0);

// three plants of one ID, one counted in its Plant Record
const plantValues = { "plant ID": "AC", "latin name": "Acer campestre", "common name": "Field maple", spread: 4000, height: 6000, onPlantList: "TRUE" };
const counted = add(PLANT, plantValues);
add(PLANT, plantValues, 5000);
add(PLANT, { ...plantValues, "plant ID": "BX", "latin name": "Buxus", "common name": "Box", spread: 300, height: 300 }, 9000);
const record = s.createRecordFormat(PLANT_RECORD, [
  { name: "ID", kind: "text", value: "" },
  { name: "Quantity", kind: "integer", value: 0 },
  { name: "Scheduled Size", kind: "text", value: "" },
]);
s.attachRecord([counted], record);
s.setRecordField(counted, record, "Quantity", 12);
s.setRecordField(counted, record, "Scheduled Size", "Extra heavy standard");
add(LAUBWERK, { "botanical name": "Acer campestre", "common name": "Field maple" }, 12000);
add(LAUBWERK, { "botanical name": "Acer campestre", "common name": "Field maple" }, 14000);

const p = paramsOf(s.doc, counted, PLANT);
check(p !== null && p.num("Spread") === 4000 && p.text("LATIN NAME") === "Acer campestre", "parameters are read in any case");
check(p !== null && p.flag("onPlantList") && !p.flag("latin name") && !p.flag("missing"), 'a popup kept as "TRUE" reads as a flag');
check(paramsOf(s.doc, counted, EXISTING_TREE) === null, "an object isn't read as another plug-in");

const plants = plantSchedule(s.doc);
const row = (id: string, latin: string) => plants.rows.find((r) => r[0] === id && r[1] === latin);
check(plants.head.join() === "ID,Latin Name,Common Name,Spread,Height,Size,Quantity", "a plant schedule's columns");
check(row("AC", "Acer campestre")?.[6] === 13, `plants of one ID are summed, by their Plant Record's quantity where they have one (${row("AC", "Acer campestre")?.[6]})`);
check(row("AC", "Acer campestre")?.[5] === "Extra heavy standard", "its scheduled size comes from its Plant Record");
check(row("BX", "Buxus")?.[6] === 1 && row("BX", "Buxus")?.[3] === "300 mm", `a plant without a record counts one, its spread in the drawing's units (${row("BX", "Buxus")?.[3]})`);
check(row("", "Acer campestre")?.[6] === 2, "Laubwerk plants are counted by botanical name");
check(plants.rows[0][0] === "" && plants.rows[1][0] === "AC" && plants.rows[2][0] === "BX", "rows go by ID");

const other = s.createLayer("Survey", "design", 100);
for (const [no, x] of [["T10", 0], ["T2", 3000], ["T1", 6000]] as const) {
  const values = { "Tree No": no, "Genus Species": "Quercus robur", "Common Name": "Oak", Height: 15000, Canopy: 9000, Calliper: 600, ActionComment: "Retain", Comments: "" };
  s.addPluginObject(no === "T2" ? other : layer, EXISTING_TREE, fieldsOf(values), values, { x, y: 0 }, 0);
}
const trees = treeSchedule(s.doc);
check(trees.rows.map((r) => r[0]).join() === "T1,T2,T10", `trees go in number order (${trees.rows.map((r) => r[0]).join()})`);
check(trees.rows[1][11] === "Survey" && trees.rows[0][11] === "Planting", "each tree's layer is listed");
check(trees.rows[0][5] === "600 mm" && trees.rows[0][3] === "15000 mm", `sizes in the drawing's units (${trees.rows[0][3]}, ${trees.rows[0][5]})`);

add("Landscape Area", { name: "Meadow", ID: "" });
const areas = areaQuantities(s.doc);
check(areas.rows.length === 1 && areas.rows[0][1] === "Meadow" && areas.rows[0][2] === 1, "landscape areas are listed by name");

const csv = scheduleCsv({ title: "T", head: ["Name", "Count"], rows: [['Acer "Elsrijk", standard', 3]] });
check(csv === 'Name,Count\r\n"Acer ""Elsrijk"", standard",3\r\n', "CSV quotes text with commas and quotes, numbers as they are");

check(areaUnit("Square Feet") === 92903.04 && areaUnit("Square Meters") === 1e6 && areaUnit("Square Metres") === 1e6 && areaUnit("Acres") === 4046856422.4 && areaUnit("Hectares") === 1e10, "Landmark's area units");
check(areaUnit("") === 1e6, "an area unit not given is square metres");

// the 3D a redraw makes
const canopy = canopyFaces({ x: 100, y: 200 }, 3000, 2000, Math.PI / 6, 1000, 5000);
const zs = canopy.flatMap((f) => f.filter((_, i) => i % 3 === 2));
const reach = Math.max(...canopy.flatMap((f) => f.flatMap((_, i) => (i % 3 === 0 ? [Math.hypot(f[i] - 100, f[i + 1] - 200)] : []))));
check(canopy.length === 16 * 8 && Math.min(...zs) === 1000 && Math.abs(Math.max(...zs) - 5000) < 1e-6, `a canopy's faces span its heights (${canopy.length} faces)`);
check(Math.abs(reach - 3000) < 1e-6, "a canopy reaches its widest radius and no further");
check(canopyFaces({ x: 0, y: 0 }, 0, 1000, 0, 0, 1000).length === 0 && canopyFaces({ x: 0, y: 0 }, 1000, 1000, 0, 10, 10).length === 0, "a canopy with no size has no faces");
const square = [{ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 0 }];
const slab = prismFaces(square, -300, 0);
check(slab.length === 6 && slab[0].every((v, i) => i % 3 !== 2 || v === 0) && slab[1].every((v, i) => i % 3 !== 2 || v === -300), "a slab has a top, a bottom and four sides");
const top = slab[0];
const topRing = [0, 3, 6, 9].map((i) => ({ x: top[i], y: top[i + 1] }));
check(signedArea(topRing) > 0, "a slab drawn clockwise has its top facing up");
check(bedFace(square, 10)[0].length === 12 && signedArea([0, 3, 6, 9].map((i) => ({ x: bedFace(square, 10)[0][i], y: bedFace(square, 10)[0][i + 1] }))) > 0, "a bed is one face, facing up");
check(perimeter(square) === 4000 && Math.abs(signedArea(square)) === 1e6, "a ring's perimeter and area");

console.log(failures ? `${failures} failed` : "all passed");
if (failures) process.exit(1);
