// Node check of the Inventory and Equipment List's sums. Run from web/: npx tsx src/features/theatre/docs/inventory.check.ts

import assert from "node:assert/strict";
import { categoryList, drawingInventoryOf, equipmentRows, freeName, inventoriesOf, inventoryFrom, inventoryXml, LIGHTING_DEVICE, readInventoryXml, SYMBOL, type DrawingInventory, type InUse, type Inventory } from "./inventory.ts";

const inUse: InUse[] = [
  { name: "Fresnel 1kW", partType: LIGHTING_DEVICE, count: 6 },
  { name: "Profile 750W", partType: LIGHTING_DEVICE, count: 4 },
  { name: "Truss 2m", partType: SYMBOL, count: 5 },
  { name: "Hoist", partType: "Hoist", count: 2 },
];
const shop: Inventory = { name: "Shop", vendor: "Hire Co", contact: "0123", notes: "", stock: { "Fresnel 1kW": 4, "Truss 2m": 5, Hoist: 1 }, types: {}, categories: { Hoist: "Rigging" } };
const venue: Inventory = { name: "Venue", vendor: "", contact: "", notes: "", stock: { "Fresnel 1kW": 4, "Profile 750W": 2 }, types: {}, categories: {} };
const d: DrawingInventory = { use: ["Shop", "Venue"], sources: { "Fresnel 1kW": "Shop", "Truss 2m": "Shop", "Profile 750W": "Gone" }, categories: { "Truss 2m": "Rigging" }, order: ["Rigging"] };

const rows = equipmentRows(inUse, [shop, venue], d);
assert.deepEqual(rows.map((r) => r.name), ["Hoist", "Truss 2m", "Fresnel 1kW", "Profile 750W"], "Rigging first, then the rest by name");
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
assert.equal(by.Hoist.category, "Rigging", "from an inventory in use");
assert.equal(by["Fresnel 1kW"].category, "Lighting Devices");
assert.deepEqual([by["Fresnel 1kW"].totalSource, by["Fresnel 1kW"].remainingSource, by["Fresnel 1kW"].totalAll, by["Fresnel 1kW"].remainingAll], [4, -2, 8, 2]);
assert.deepEqual([by["Truss 2m"].remainingSource, by["Truss 2m"].remainingAll], [0, 0]);
assert.equal(by["Profile 750W"].source, "", "a source that's gone counts as none");
assert.equal(by["Profile 750W"].totalSource, null);
assert.equal(by["Profile 750W"].remainingAll, -2);
// only inventories in use count toward all
const only = equipmentRows(inUse, [shop, venue], { ...d, use: ["Venue"] });
assert.equal(only.find((r) => r.name === "Fresnel 1kW")!.totalAll, 4);
assert.equal(only.find((r) => r.name === "Fresnel 1kW")!.totalSource, 4, "an assigned source counts even when not in use");
assert.deepEqual(categoryList(rows, d), ["Rigging", "Lighting Devices"]);
assert.deepEqual(categoryList([...rows, { category: "Audio" }], d), ["Rigging", "Audio", "Lighting Devices"], "the drawing's order, then the rest by name");

// an inventory made from a drawing
const made = inventoryFrom("Warehouse", { vendor: "W & Sons <Ltd>", contact: "", notes: "two\nlines" }, inUse, d, [shop]);
assert.deepEqual(made.stock, { "Fresnel 1kW": 6, "Profile 750W": 4, "Truss 2m": 5, Hoist: 2 });
assert.equal(made.categories["Truss 2m"], "Rigging");
assert.equal(made.types.Hoist, "Hoist");
// to XML and back
const xml = inventoryXml(made);
assert.ok(xml.includes('vendor="W &amp; Sons &lt;Ltd&gt;"'), xml);
assert.deepEqual(readInventoryXml(xml), made);
assert.match(String(readInventoryXml("<Other/>")), /no Inventory element/);
assert.match(String(readInventoryXml('<Inventory vendor="x"></Inventory>')), /no name/);
// storage read back
assert.deepEqual(inventoriesOf(JSON.parse(JSON.stringify([made, { name: 3 }, null]))), [made]);
assert.deepEqual(drawingInventoryOf({ use: ["A", 2], sources: { x: "A", y: 3 } }), { use: ["A"], sources: { x: "A" }, categories: {}, order: [] });
assert.equal(freeName("Shop", ["Shop", "Shop 2"]), "Shop 3");
console.log("inventory: all passed");
