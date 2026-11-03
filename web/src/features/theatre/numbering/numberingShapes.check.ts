// npx tsx src/features/theatre/numbering/numberingShapes.check.ts
import { lettersValue, numberingOrder, numberingProblem, secondaries, sequence, startOf, valueLetters, type FieldNumbering } from "./numberingShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const plain: FieldNumbering = { start: "1", prefix: "", suffix: "", same: false, step: 1, limit: "No Limit", limitAt: 0, perValue: 1 };
const run = (o: Partial<FieldNumbering>, count: number, footprints?: number[], universe?: number) => sequence({ ...plain, ...o }, count, footprints, universe);

// letters
ok(lettersValue("A") === 1 && lettersValue("Z") === 26 && lettersValue("AA") === 27 && lettersValue("ab") === 28, "letters as counts");
ok(valueLetters(1) === "A" && valueLetters(26) === "Z" && valueLetters(27) === "AA" && valueLetters(28, true) === "ab", "counts as letters");
ok(startOf("007")?.kind === "number" && (startOf("007") as { digits: number }).digits === 3 && startOf("b")?.kind === "letters" && startOf("1A") === null, "what a start is");

// values
ok(run({}, 4).values.join() === "1,2,3,4", "1 on");
ok(run({ start: "2", step: 2, suffix: "A" }, 3).values.join() === "2A,4A,6A", "the help's example: 2A, 4A, 6A");
ok(run({ start: "001", prefix: "U" }, 3).values.join() === "U001,U002,U003", "leading zeros kept, a prefix");
ok(run({ start: "A" }, 4).values.join() === "A,B,C,D" && run({ start: "y" }, 3).values.join() === "y,z,aa", "letters on, lower case kept");
ok(run({ same: true, start: "5" }, 3).values.join() === "5,5,5", "the same for all");
ok(run({ perValue: 5 }, 10).values.join() === "1,1,1,1,1,2,2,2,2,2", "the help's example: five a circuit");
ok(run({ start: "10", step: -3 }, 4).values.join() === "10,7,4,1", "counting down");
ok(run({ limit: "Restart at", limitAt: 3 }, 7).values.join() === "1,2,3,1,2,3,1", "restart at 3");
const stop = run({ limit: "Stop at", limitAt: 3 }, 7);
ok(stop.values.join() === "1,2,3" && stop.stopped === 3, "stop at 3: three numbered, stopped at the fourth");
ok(run({}, 3).stopped === null, "no limit: not stopped");

// DMX footprints into the next universe
const dmx = run({ footprint: true }, 4, [200, 200, 200, 16], 2);
ok(dmx.values.join() === "1,201,1,201" && dmx.universes.join() === "2,2,3,3", `addresses by footprint, the third into universe 3 (${dmx.values} / ${dmx.universes})`);
ok(run({ footprint: true, start: "500" }, 3, [13, 20, 1]).values.join() === "500,1,21", "a device that just fits stays; one past 512 starts the next universe at 1");
ok(startOf("007")?.kind === "number" && startOf("10") !== null && (startOf("10") as { digits: number }).digits === 1, "only leading zeros set a width");

// problems
ok(numberingProblem(plain) === null, "fine");
ok(numberingProblem({ ...plain, start: "1-2" }) !== null, "a start that isn't a number or letters");
ok(numberingProblem({ ...plain, step: 0 }) !== null && numberingProblem({ ...plain, same: true, step: 0 }) === null, "a step of 0, unless the same for all");
ok(numberingProblem({ ...plain, perValue: 0 }) !== null, "units per increment 0");
ok(numberingProblem({ ...plain, start: "10", limit: "Stop at", limitAt: 5 }) !== null, "a limit before the start");

// order
const at = [
  { x: 0, y: 10 },
  { x: 10, y: 10.4 },
  { x: 20, y: 9.7 },
  { x: 0, y: 0 },
  { x: 10, y: 0.2 },
  { x: 20, y: 0 },
];
ok(numberingOrder(at, "Left to Right", "Top to Bottom", false, 1).join() === "0,1,2,3,4,5", "rows left to right, the top row first");
ok(numberingOrder(at, "Left to Right", "Top to Bottom", true, 1).join() === "0,1,2,5,4,3", "zigzag: the second row back");
ok(numberingOrder(at, "Right to Left", "Bottom to Top", false, 1).join() === "5,4,3,2,1,0", "from the bottom right");
ok(numberingOrder(at, "Top to Bottom", "Left to Right", false, 1).join() === "0,3,1,4,2,5", "columns top to bottom, left to right");
ok(numberingOrder(at, "Left to Right", "Top to Bottom", false, 0.1).length === 6, "a tight tolerance still numbers them all");
ok(numberingOrder(at, "Left to Right", "Left to Right", false, 1).join() === "0,1,2,3,4,5", "a secondary along the primary: the first across it");
ok(secondaries("Top to Bottom").join() === "Left to Right,Right to Left", "secondaries go across");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
