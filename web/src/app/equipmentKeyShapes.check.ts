// Node check of the Equipment Summary Key. Run from web/: npx tsx src/app/equipmentKeyShapes.check.ts

import assert from "node:assert/strict";
import { keyDrawing, keyRows, VARIES, type KeyFixture, type KeyOptions } from "./equipmentKeyShapes.ts";

const f = (label: string, position: string, color: string, gobo = "", circuit = "", heightMm = 6000): KeyFixture => ({ label, glyph: "fresnel", position, color, gobo, circuit, heightMm });
const list = [f("Fresnel 1K", "1st Electric", "R80", "G1", "A1"), f("Fresnel 1K", "1st Electric", "R80", "", "A2"), f("Par 64", "2nd Electric", "L201", "", "B1", 7000), f("Par 64", "1st Electric", "", "", "")];
const opts: KeyOptions = { title: "Equipment Summary", position: "", columnHeaders: true, total: true, colors: true, gobos: true, circuits: true, positionHeight: true, leftOut: new Set() };
const height = (mm: number): string => `${mm} mm`;

const rows = keyRows(list, [["Truss", 3]], opts, height);
assert.deepEqual(rows.map((r) => r.kind), ["title", "headers", "item", "item", "item", "total", "section", "summary", "summary", "section", "summary", "section", "summary", "summary", "summary", "note"]);
assert.deepEqual(rows.filter((r) => r.kind === "item").map((r) => (r.kind === "item" ? [r.name, r.count] : [])), [["Fresnel 1K", 2], ["Par 64", 2], ["Truss", 3]]);
assert.deepEqual(rows.find((r) => r.kind === "total"), { kind: "total", count: 7 });
assert.deepEqual(rows.find((r) => r.kind === "note"), { kind: "note", name: "Position Height", value: VARIES });

// filtered to a position: its devices alone, no other equipment, and its one height
const pos = keyRows(list, [["Truss", 3]], { ...opts, position: "1st Electric" }, height);
assert.deepEqual(pos.filter((r) => r.kind === "item").map((r) => (r.kind === "item" ? r.count : 0)), [2, 1]);
assert.deepEqual(pos.find((r) => r.kind === "total"), { kind: "total", count: 3 });
assert.deepEqual(pos.find((r) => r.kind === "note"), { kind: "note", name: "Position Height", value: "6000 mm" });

// items left out aren't counted; summaries turned off go; an empty one has no heading
const some = keyRows(list, [["Truss", 3]], { ...opts, leftOut: new Set(["Truss"]), colors: false, positionHeight: false }, height);
assert.ok(!some.some((r) => r.kind === "item" && r.name === "Truss"));
assert.deepEqual(some.find((r) => r.kind === "total"), { kind: "total", count: 4 });
assert.ok(!some.some((r) => r.kind === "section" && r.text === "Colors"));
// a type left out leaves its gels out too
const noPar = keyRows(list, [], { ...opts, leftOut: new Set(["Par 64"]) }, height);
assert.ok(!noPar.some((r) => r.kind === "summary" && r.name === "L201"));
const noGobos = keyRows([f("Par", "", "")], [], opts, height);
assert.ok(!noGobos.some((r) => r.kind === "section"));
// nothing at all: no rows but the frame's
assert.deepEqual(keyRows([], [], { ...opts, title: "", columnHeaders: false, total: false }, height), []);

// the drawing: every corner puts that corner at the origin
const tl = keyDrawing(rows, 100, "tl", true, true);
assert.ok(tl.width > 0 && tl.height > 0);
assert.deepEqual(tl.border![0], { x: 0, y: 0 });
assert.deepEqual(tl.border![2], { x: tl.width, y: -tl.height });
const br = keyDrawing(rows, 100, "br", true, true);
assert.deepEqual(br.border![2], { x: 0, y: 0 });
const tr = keyDrawing(rows, 100, "tr", true, true);
assert.deepEqual(tr.border![1], { x: 0, y: 0 });
const bl = keyDrawing(rows, 100, "bl", true, true);
assert.deepEqual(bl.border![3], { x: 0, y: 0 });
// no border, no swatches when they're off
assert.equal(keyDrawing(rows, 100, "tl", false, false).border, null);
assert.equal(keyDrawing(rows, 100, "tl", false, false).swatches.length, 0);
assert.equal(tl.swatches.length, 2);
assert.equal(tl.glyphs.length, 2);
// everything's inside the border, and the rows don't overlap
for (const t of tl.texts) assert.ok(t.at.x >= 0 && t.at.x <= tl.width && t.at.y <= 0 && t.at.y >= -tl.height);
const ys = [...new Set(tl.texts.map((t) => t.at.y))];
assert.equal(ys.length, rows.length);
for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1] - ys[i] >= 170 - 1e-6);

console.log("all checks passed");
