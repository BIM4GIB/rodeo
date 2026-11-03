// Run with: npx tsx src/app/classLayerMappingShapes.check.ts
import assert from "node:assert/strict";
import { mappingPlan, mappingText, parseMapping, type MappingRow } from "./classLayerMappingShapes.ts";

const rows = (...pairs: [string, string][]): MappingRow[] => pairs.map(([existing, proposed]) => ({ existing, proposed }));

// nothing changes
assert.deepEqual(mappingPlan(rows(["A", "A"], ["B", "B"])), { merges: [], deletes: [], renames: [] });
// a rename, a delete, a blank with spaces
assert.deepEqual(mappingPlan(rows(["A", "New"], ["B", " "], ["C", " C "])), { merges: [], deletes: ["B"], renames: [{ from: "A", to: "New" }] });
// merging into one that keeps its name, whichever comes first
assert.deepEqual(mappingPlan(rows(["A", "B"], ["B", "B"])), { merges: [{ from: "A", into: "B" }], deletes: [], renames: [] });
// merging under a new name: the first takes it
assert.deepEqual(mappingPlan(rows(["A", "X"], ["B", "X"], ["C", "X"])), { merges: [{ from: "B", into: "A" }, { from: "C", into: "A" }], deletes: [], renames: [{ from: "A", to: "X" }] });
// a swap, and a chain
assert.deepEqual(mappingPlan(rows(["A", "B"], ["B", "A"])).renames, [{ from: "A", to: "B" }, { from: "B", to: "A" }]);
assert.deepEqual(mappingPlan(rows(["A", "B"], ["B", "C"])).renames, [{ from: "A", to: "B" }, { from: "B", to: "C" }]);

// the file, as the help sets it out
const file = mappingText("class", rows(["Walls", "Walls"], ["Wall-Ext", "A-WALL"], ["Wall-Int", "A-WALL"], ["Junk", ""]));
assert.equal(file, "This is the class mapping file\nSame\tWalls\tWalls\nRenamed\tWall-Ext\tA-WALL\nMerged\tWall-Int\tA-WALL\nEnd of class mapping\n");
const read = parseMapping("class", file);
assert.ok(read instanceof Map);
assert.deepEqual([...read], [["Walls", "Walls"], ["Wall-Ext", "A-WALL"], ["Wall-Int", "A-WALL"]]);
// and back to the same plan, those unlisted to be deleted
const back = ["Walls", "Wall-Ext", "Wall-Int", "Junk"].map((existing) => ({ existing, proposed: read.get(existing) ?? "" }));
assert.deepEqual(mappingPlan(back).deletes, ["Junk"]);
assert.deepEqual(mappingPlan(back).merges, [{ from: "Wall-Int", into: "Wall-Ext" }]);
// other line endings, and blank lines
assert.ok(parseMapping("layer", "This is the layer mapping file\r\n\r\nSame\tL\tL\r\nEnd of layer mapping\r\n") instanceof Map);
// not one, the other kind, no end, a bad line
assert.equal(typeof parseMapping("class", "hello"), "string");
assert.equal(typeof parseMapping("layer", file), "string");
assert.equal(typeof parseMapping("class", "This is the class mapping file\nSame\tA\tA\n"), "string");
assert.equal(typeof parseMapping("class", "This is the class mapping file\nMoved\tA\tB\nEnd of class mapping"), "string");

console.log("classLayerMappingShapes ok");
