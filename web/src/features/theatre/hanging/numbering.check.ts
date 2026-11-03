// Run with: npx tsx src/features/theatre/hanging/numbering.check.ts
import assert from "node:assert/strict";
import { freeName, hungWeight, numberOrder, positionUnder, unitNumbers, within } from "./numbering.ts";

const at = (name: string, x: number, y: number) => ({ name, at: { x, y } });
const names = (list: readonly { name: string }[]): string => list.map((i) => i.name).join("");
const row = [at("b", 2000, 0), at("c", 3000, 0), at("a", 1000, 0)];
const column = [at("b", 0, 2000), at("a", 0, 1000), at("c", 0, 3000)];

// each way the page runs
assert.equal(names(numberOrder(row, "Left to Right")), "abc");
assert.equal(names(numberOrder(row, "Right to Left")), "cba");
assert.equal(names(numberOrder(column, "Bottom to Top")), "abc");
assert.equal(names(numberOrder(column, "Top to Bottom")), "cba");

// a plan turned a quarter on the page: its x runs up the page, so a row reads bottom to top
assert.equal(names(numberOrder(row, "Bottom to Top", Math.PI / 2)), "abc");
assert.equal(names(numberOrder(row, "Top to Bottom", Math.PI / 2)), "cba");
assert.equal(names(numberOrder(column, "Left to Right", Math.PI / 2)), "cba");

// level with each other: left to right, or bottom to top, whichever way it's numbered
const ladder = [at("c", 1000, 500), at("a", 0, 0), at("b", 1000, 0), at("d", 2000, 0.5)];
assert.equal(names(numberOrder(ladder, "Left to Right")), "abcd");
assert.equal(names(numberOrder(ladder, "Right to Left")), "dbca");
assert.equal(names(numberOrder([at("b", 900, 0), at("a", 100, 0.2)], "Top to Bottom")), "ab");

// the numbers
assert.deepEqual(unitNumbers(1, 1, 3), ["1", "2", "3"]);
assert.deepEqual(unitNumbers(101, 2, 2), ["101", "103"]);
assert.deepEqual(unitNumbers(0.1, 0.2, 3), ["0.1", "0.3", "0.5"]);
assert.deepEqual(unitNumbers(10, -5, 3), ["10", "5", "0"]);
assert.deepEqual(unitNumbers(1, 1, 0), []);

// over a position
const pipe = { name: "pipe", box: { x0: 0, y0: 0, x1: 5000, y1: 50 } };
const truss = { name: "truss", box: { x0: 0, y0: -500, x1: 8000, y1: 500 } };
assert.ok(within({ x: 5100, y: 0 }, pipe.box, 150));
assert.ok(!within({ x: 5200, y: 0 }, pipe.box, 150));
assert.equal(positionUnder([truss, pipe], { x: 100, y: 20 }, 100), pipe);
assert.equal(positionUnder([truss, pipe], { x: 7000, y: 20 }, 100), truss);
assert.equal(positionUnder([truss, pipe], { x: 0, y: 2000 }, 100), null);

// the weight, and a free name
assert.equal(hungWeight([{ weightKg: 5.5 }, { weightKg: 2.25 }, { weightKg: Number.NaN }]), "7.8 kg");
assert.equal(hungWeight([]), "0 kg");
assert.equal(freeName("A-Sym", new Set()), "A-Sym");
assert.equal(freeName("A-Sym", new Set(["A-Sym", "A-Sym 2"])), "A-Sym 3");

console.log("hanging numbering ok");
