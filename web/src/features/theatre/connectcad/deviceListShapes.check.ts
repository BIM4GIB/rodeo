// npx tsx src/features/theatre/connectcad/deviceListShapes.check.ts
import { assignmentOf, columnNames, deviceHeader, devicePlan, listedDevices, numberedNames } from "./deviceListShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

ok(JSON.stringify(assignmentOf("Manufacturer")) === '{"kind":"device","field":"Make"}' && JSON.stringify(assignmentOf(" Qty ")) === '{"kind":"device","field":"Quantity"}' && JSON.stringify(assignmentOf("Rack U")) === '{"kind":"device","field":"Rack U"}', "headings to device fields");
ok(JSON.stringify(assignmentOf("Asset Tag No")) === '{"kind":"record","field":"Asset Tag No"}' && assignmentOf("  ").kind === "none", "others to record fields, none for an empty heading");

const rows = [
  ["Equipment list", "", "", "", "", ""],
  ["Name", "Make", "Model", "Qty", "Room", "Serial", ""],
  ["", "Acme", "Router 8x8", "2", "Control", "S-1"],
  ["CAM", "Lens Co", "Camera", "3", "Studio", ""],
  ["MIXER", "Acme", "Mixer", "", "Control", ""],
  ["note", "", "", "", "", ""],
  ["", "Acme", "Router 8x8", "two", "", ""],
  ["", "", "", "", "", ""],
];
const header = deviceHeader(rows);
ok(header === 1, "the header row is the one naming make and model");
const names = columnNames(rows, header);
ok(names.join() === "Name,Make,Model,Qty,Room,Serial,Field7", `columns named (${names})`);
const assigned = names.map((n, i) => (rows[header][i] ? assignmentOf(n) : assignmentOf("")));
const { devices, skipped } = listedDevices(rows, header, assigned);
ok(devices.length === 3 && devices[0].quantity === 2 && devices[2].quantity === 1 && devices[0].record.Serial === "S-1" && devices[1].fields.Room === "Studio", `rows read (${JSON.stringify(devices)})`);
ok(skipped.map((k) => `${k.row}:${k.why}`).join() === "5:no make or model,6:quantity two isn't a number", `rows passed by (${JSON.stringify(skipped)})`);

// the drawing has one Acme Router 8x8 and a device named CAM 2
const plan = devicePlan(devices, [{ id: "r1", make: "acme", model: "ROUTER 8X8" }], new Set(["CAM 2", "Router 8x8"]));
ok(plan.update.length === 1 && plan.update[0].id === "r1", "the router the drawing has counts towards the two");
ok(plan.make.map((m) => m.name).join() === "Router 8x8 1,CAM 1,CAM 3,CAM 4,MIXER", `names (${plan.make.map((m) => m.name)})`);
ok(plan.make.every((m) => m.tag === m.name), "tags follow names");

ok(numberedNames("DEV", 1, new Set()).join() === "DEV" && numberedNames("DEV", 2, new Set(["DEV 1"])).join() === "DEV 2,DEV 3", "numbered names");
const tagged = devicePlan([{ row: 0, quantity: 2, make: "A", model: "B", fields: { Name: "X", "Display Tag": "T" }, record: {} }], [], new Set());
ok(tagged.make.map((m) => `${m.name}/${m.tag}`).join() === "X 1/T 1,X 2/T 2", "a tag numbered with the names");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
