// npx tsx src/features/theatre/connectcad/cableSheetShapes.check.ts
import { cableNote, cablingMarks, endPairs, pathTag, type CableRun } from "./cableSheetShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;
const P = (x: number, y: number) => ({ x, y });

// a path's tag: from the middle of its plan, up and right; up and left when the path runs up and right
const level = pathTag([P(0, 0), P(1000, 0)], "P1", 100);
ok(near(level.leader[0].x, 500) && near(level.leader[0].y, 0) && near(level.leader[1].x, 600) && near(level.leader[1].y, 100) && near(level.leader[2].x, 650), `level (${JSON.stringify(level.leader)})`);
ok(level.note.hAlign === 1 && level.note.vAlign === 3 && near(level.note.at.x, 675) && level.note.text === "P1", "writing to the right of it");
const rising = pathTag([P(0, 0), P(1000, 1000)], "P2", 100);
ok(near(rising.leader[1].x, 400) && near(rising.leader[1].y, 600) && rising.note.hAlign === 3, `crossing a rising path (${JSON.stringify(rising.leader)})`);
// a vertical in the path is one point in plan, so the middle is the plan's
const riser = pathTag([P(0, 0), P(0, 0), P(0, 400)], "P3", 50);
ok(near(riser.leader[0].y, 200), "a rise doesn't count in the plan's middle");

// pairs: either way round, nearest first, counted by kind
const runs: CableRun[] = [
  { ends: ["A", "B"], at: [P(0, 0), P(3000, 0)], shown: [true, true], kind: "SDI" },
  { ends: ["B", "A"], at: [P(3000, 0), P(0, 0)], shown: [true, true], kind: "SDI" },
  { ends: ["A", "B"], at: [P(0, 0), P(3000, 0)], shown: [true, true], kind: "HDMI" },
  { ends: ["A", "C"], at: [P(0, 0), P(0, 1000)], shown: [true, true], kind: "Cat6" },
  { ends: ["A", "D"], at: [P(0, 0), P(0, 50000)], shown: [true, false], kind: "SDI" },
];
const pairs = endPairs(runs);
ok(pairs.map((p) => p.ends.join("-")).join() === "A-C,A-B,A-D", `nearest first (${pairs.map((p) => p.ends.join("-"))})`);
ok(pairs[2].shown.join() === "true,false", "whether each place is on the sheet kept");
ok(pairs[1].counts.get("SDI") === 2 && pairs[1].counts.get("HDMI") === 1 && near(pairs[1].span, 3000), "A–B counted either way round");
ok(cableNote(pairs[1].counts) === "2 × SDI, 1 × HDMI", `the note (${cableNote(pairs[1].counts)})`);

// none as arcs, all, or the nearest half; D is off the sheet, so A–D is a home run from A only, never an arc
const homes = cablingMarks(pairs, 0, 400);
ok(homes.length === 5 && homes.every((m) => m.kind === "home"), "0%: home runs from both ends of each");
const ab = homes.find((m) => m.kind === "home" && m.from === "A" && m.pair.ends[1] === "B");
ok(ab?.kind === "home" && near(ab.line[0].x, 160) && near(ab.line[1].x, 400) && near(ab.line[1].y, 0) && ab.note.text === "To B: 2 × SDI, 1 × HDMI" && ab.note.hAlign === 1, `A's home run toward B (${JSON.stringify(ab?.line)})`);
ok(ab?.kind === "home" && ab.head.length === 3 && near(ab.head[0].x, 400) && near(ab.head[1].x, 300) && near(ab.head[1].y, 40), "its arrowhead");
const ba = homes.find((m) => m.kind === "home" && m.from === "B");
ok(ba?.kind === "home" && near(ba.line[1].x, 2600) && ba.note.text === "To A: 2 × SDI, 1 × HDMI" && ba.note.hAlign === 3, "B's toward A, written to the left");
const arcs = cablingMarks(pairs, 100, 400);
ok(arcs.length === 3 && arcs.filter((m) => m.kind === "arc").length === 2, "100%: all arcs that can be");
const arc = arcs.find((m) => m.pair.ends[1] === "B");
ok(arc?.kind === "arc" && near(arc.line[0].x, 0) && near(arc.line[arc.line.length - 1].x, 3000) && near(arc.line[8].y, 0.2 * 3000) && near(arc.line[8].x, 1500), `bowing up from A to B (${JSON.stringify(arc?.line[8])})`);
ok(arc?.kind === "arc" && arc.note.text === "2 × SDI, 1 × HDMI" && arc.note.vAlign === 5 && near(arc.note.at.y, 700), "its note above the bow");
const half = cablingMarks(pairs, 50, 400);
ok(half.filter((m) => m.kind === "arc").map((m) => m.pair.ends.join("-")).join() === "A-C" && half.filter((m) => m.kind === "home").length === 3, "50%: the nearer of the two that can be, as an arc");
const toD = arcs.filter((m) => m.pair.ends[1] === "D");
ok(toD.length === 1 && toD[0].kind === "home" && toD[0].from === "A" && toD[0].note.text === "To D: 1 × SDI" && toD[0].note.vAlign === 5, "a place off the sheet: a home run toward it");
ok(cablingMarks([{ ends: ["A", "A"], at: [P(0, 0), P(0, 0)], shown: [true, true], counts: new Map([["SDI", 1]]), span: 0 }], 50, 400).length === 0, "both ends at one place: nothing");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
