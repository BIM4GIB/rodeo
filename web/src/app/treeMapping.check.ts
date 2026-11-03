// Run with: npx tsx src/app/treeMapping.check.ts
import assert from "node:assert/strict";
import type { RecordField } from "../core/index.ts";
import { fieldLength, guessParameter, mappedTree, type FieldMapping, type TreeValues } from "./treeMapping.ts";

const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
const base: TreeValues = {
  tree: { action: "retain", canopyMax: 6000, canopyMin: 6000, canopyRotate: 0, dbh: 400, roots: "none", critical: 0, primary: 0, ball: 1200, protection: "none", tpzRadius: 4800 },
  botanical: "",
  common: "",
  significance: "none",
  number: null,
};
const field = (name: string, kind: RecordField["kind"], value: RecordField["value"]): RecordField => ({ name, kind, value });

for (const [name, wanted] of [
  ["Tree No", "number"],
  ["TAG", "number"],
  ["Species", "botanical"],
  ["Common Name", "common"],
  ["DBH (in)", "dbh"],
  ["Canopy", "canopyMax"],
  ["Spread", "canopyMax"],
  ["Min Canopy", "canopyMin"],
  ["Canopy Rotation", "canopyRotate"],
  ["Height", "none"],
  ["Surveyor", "none"],
] as const) assert.equal(guessParameter(name), wanted, name);

// lengths: Automatic goes by the drawing's units, a named unit by its own
near(fieldLength(field("a", "number", 12), "in", "mm")!, 304.8);
near(fieldLength(field("a", "text", "12"), "ft", "mm")!, 3657.6);
near(fieldLength(field("a", "text", "1200"), "auto", "mm")!, 1200);
near(fieldLength(field("a", "dimension", 500), "auto", "mm")!, 500);
assert.equal(fieldLength(field("a", "text", ""), "in", "mm"), null);
assert.equal(fieldLength(field("a", "text", "big"), "auto", "mm"), null);
assert.equal(fieldLength(field("a", "boolean", true), "auto", "mm"), null);

const maps: FieldMapping[] = [
  { field: "Tag", parameter: "number", unit: "auto" },
  { field: "Species", parameter: "botanical", unit: "auto" },
  { field: "Common", parameter: "common", unit: "auto" },
  { field: "DBH", parameter: "dbh", unit: "in" },
  { field: "Spread", parameter: "canopyMax", unit: "ft" },
  { field: "Do", parameter: "action", unit: "auto" },
  { field: "Risk", parameter: "significance", unit: "auto" },
  { field: "Turn", parameter: "canopyRotate", unit: "auto" },
  { field: "Note", parameter: "none", unit: "auto" },
];
const made = mappedTree(
  base,
  [
    field("Tag", "text", "T-7"),
    field("Species", "text", "Quercus robur"),
    field("Common", "text", "English Oak"),
    field("DBH", "number", 20),
    field("Spread", "number", 30),
    field("Do", "text", "To be Removed"),
    field("Risk", "text", "HIGH"),
    field("Turn", "number", 90),
    field("Note", "text", "x"),
  ],
  maps,
  "mm",
);
assert.equal(made.number, "T-7");
assert.equal(made.botanical, "Quercus robur");
assert.equal(made.common, "English Oak");
near(made.tree.dbh, 508);
near(made.tree.canopyMax, 9144);
near(made.tree.canopyMin, 9144);
assert.equal(made.tree.action, "remove");
assert.equal(made.significance, "high");
near(made.tree.canopyRotate, Math.PI / 2);

// nothing in a field: the setting stands; a word it doesn't know, the same
const blank = mappedTree(base, [field("DBH", "number", 0), field("Do", "text", "maybe"), field("Species", "text", "")], maps, "mm");
near(blank.tree.dbh, 400);
assert.equal(blank.tree.action, "retain");
assert.equal(blank.botanical, "");
assert.equal(blank.number, null);

// a minimum over the maximum comes down to it, and one given stays
const min = (v: number): TreeValues => mappedTree(base, [field("Min", "number", v)], [{ field: "Min", parameter: "canopyMin", unit: "mm" }], "mm");
near(min(4000).tree.canopyMin, 4000);
near(min(4000).tree.canopyMax, 6000);
near(min(9000).tree.canopyMin, 6000);
// an oval's settings with a smaller record stay no wider than the maximum
const oval: TreeValues = { ...base, tree: { ...base.tree, canopyMax: 6000, canopyMin: 4000 } };
const small = mappedTree(oval, [field("Spread", "number", 3000)], [{ field: "Spread", parameter: "canopyMax", unit: "mm" }], "mm");
near(small.tree.canopyMax, 3000);
near(small.tree.canopyMin, 3000);
near(mappedTree(oval, [], [], "mm").tree.canopyMin, 4000);

for (const [text, action] of [["Retain", "retain"], ["Transplant - Original location", "transplant-original"], ["Transplant - Proposed location", "transplant-proposed"]] as const) {
  assert.equal(mappedTree(base, [field("Do", "text", text)], maps, "mm").tree.action, action);
}

console.log("treeMapping ok");
