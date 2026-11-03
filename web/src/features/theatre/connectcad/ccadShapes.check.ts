// npx tsx src/features/theatre/connectcad/ccadShapes.check.ts
import type { Pt } from "../../../core/index.ts";
import {
  crossings,
  hopped,
  arrowEnd,
  cleanLoops,
  flowOf,
  rowSlots,
  loopArc,
  loopPlan,
  boxFor,
  cableNumbers,
  circuitEnds,
  connectorsFor,
  nextName,
  numberPlaces,
  route,
  signalsMatch,
  slotEnd,
  slotFor,
  socketAt,
  socketMarks,
  socketName,
  type Socket,
} from "./ccadShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const same = (a: Pt, b: Pt): boolean => near(a.x, b.x) && near(a.y, b.y);
const square = (pts: readonly Pt[]): boolean => pts.slice(1).every((p, i) => near(p.x, pts[i].x) || near(p.y, pts[i].y));

const P = 10;
const sock = (id: number, type: Socket["type"], side: Socket["side"], slot: number, terminated = false): Socket => ({ id, name: `S${id}`, tag: `S${id}`, type, side, slot, signal: "SDI", connector: "BNC", terminated });

// the box grows to hold its sockets, and no smaller than asked
const asked = { width: 80, height: 40 };
ok(boxFor(asked, [], P).height === 40 && boxFor(asked, [], P).width === 80, "an empty device keeps the box asked");
const deep = boxFor(asked, [sock(1, "IN", "L", 5)], P);
ok(near(deep.height, (1 + 6) * P + P / 2), `a socket on the sixth row deepens the box (${deep.height})`);
ok(boxFor(asked, [sock(1, "IN", "T", 11)], P).width === 120, "a socket far along the top widens it");

// where circuits leave: left and right sockets at the row's middle, below the description row
const box = { width: 80, height: 60 };
const left = slotEnd(box, "L", 0, P);
const right = slotEnd(box, "R", 2, P);
ok(same(left.tip, { x: 0, y: -15 }) && same(left.out, { x: -1, y: 0 }), "the first left socket's end");
ok(same(right.tip, { x: 80, y: -35 }) && same(right.out, { x: 1, y: 0 }), "the third right socket's end");
ok(same(slotEnd(box, "B", 1, P).tip, { x: 15, y: -60 }), "a bottom socket's end");

// finding a socket at a point, and the slot a click asks for
const sockets = [sock(1, "IN", "L", 0), sock(2, "OUT", "R", 2), sock(3, "IO", "R", 0, true)];
ok(socketAt(sockets, box, { x: 3, y: -14 }, P)?.id === 1, "a click on the input finds it");
ok(socketAt(sockets, box, { x: 85, y: -36 }, P)?.id === 2, "a click just outside the output finds it");
ok(socketAt(sockets, box, { x: 40, y: -45 }, P) === null, "the middle of the box is no socket");
ok(JSON.stringify(slotFor(box, { x: 2, y: -27 }, P, "auto")) === JSON.stringify({ side: "L", slot: 1 }), "Automatic puts it on the nearest side, on the row clicked");
ok(JSON.stringify(slotFor(box, { x: 77, y: -3 }, P, "R")) === JSON.stringify({ side: "R", slot: 0 }), "a side chosen wins, and the description row gives the first slot");
ok(slotFor(box, { x: 200, y: -20 }, P, "auto") === null, "far off the box is no slot");

// marks: the input's triangle points in, the output's out, IO has both; a terminator sits outside
const inMarks = socketMarks(sockets[0], box, P);
ok(inMarks.triangles.length === 1 && inMarks.triangles[0].flow === "in" && Math.max(...inMarks.triangles[0].points.map((p) => p.x)) > 0 && inMarks.label.hAlign === 1, "an input's mark points into the box, its label after it");
const outMarks = socketMarks(sockets[1], box, P);
ok(outMarks.triangles[0].flow === "out" && same(outMarks.triangles[0].points[2], { x: 80, y: -35 }) && outMarks.label.hAlign === 3, "an output's mark points out at the edge, its label right-aligned");
const io = socketMarks(sockets[2], box, P);
ok(io.triangles.length === 2 && io.terminator !== null && Math.min(...io.terminator.map((p) => p.x)) >= 80 - 1e-9, "IO has both marks, its terminator outside the edge");
ok(inMarks.terminator === null, "no terminator unless terminated");

// names
ok(nextName("CAM1", new Set(["CAM1"])) === "CAM2" && nextName("DEV", new Set(["DEV"])) === "DEV2" && nextName("CAM09", new Set(["CAM09"])) === "CAM10", "devices number on");
ok(nextName("VTR", new Set()) === "VTR", "a free name is kept");
ok(socketName("", "IN", new Set(["IN1"])) === "IN2" && socketName("SDI", "OUT", new Set()) === "SDI1" && socketName("PORT3", "IO", new Set()) === "PORT3", "sockets number on their device");

// which end is which
ok(JSON.stringify(circuitEnds("OUT", "IN")) === '{"reversed":false}' && JSON.stringify(circuitEnds("IN", "OUT")) === '{"reversed":true}', "an input clicked first becomes the destination");
ok(JSON.stringify(circuitEnds("IO", "IO")) === '{"reversed":false}' && JSON.stringify(circuitEnds("IN", "IO")) === '{"reversed":true}', "IO goes either way");
ok(typeof circuitEnds("IN", "IN") === "string" && typeof circuitEnds("OUT", "OUT") === "string", "two inputs or two outputs can't connect");
ok(signalsMatch("SDI", "SDI") && signalsMatch("---", "HDMI") && !signalsMatch("SDI", "HDMI"), "signals match");
ok(connectorsFor("SDI")[0] === "BNC" && connectorsFor("SDI").slice(-2).join() === "---,???", "a signal's connectors");

// routing: forward, with a square elbow halfway; leaving and arriving along the sockets
const a = { tip: { x: 100, y: -10 }, out: { x: 1, y: 0 } };
const b = { tip: { x: 300, y: -50 }, out: { x: -1, y: 0 } };
const fwd = route(a, b, [], P);
ok(fwd.length === 4 && square(fwd) && same(fwd[1], { x: 200, y: -10 }) && same(fwd[3], b.tip), `a forward run elbows halfway (${JSON.stringify(fwd)})`);
const level = route(a, { tip: { x: 300, y: -10 }, out: { x: -1, y: 0 } }, [], P);
ok(level.length === 2, "level sockets join straight");
// backward: out of the source, across between the rows, into the destination from its own side
const back = route({ tip: { x: 300, y: -10 }, out: { x: 1, y: 0 } }, { tip: { x: 100, y: -50 }, out: { x: -1, y: 0 } }, [], P);
ok(square(back) && same(back[1], { x: 310, y: -10 }) && same(back[back.length - 2], { x: 90, y: -50 }), `a backward run leaves and arrives along its sockets (${JSON.stringify(back)})`);
const under = route({ tip: { x: 300, y: -10 }, out: { x: 1, y: 0 } }, { tip: { x: 100, y: -10 }, out: { x: -1, y: 0 } }, [], P);
ok(square(under) && Math.min(...under.map((p) => p.y)) < -10, "a backward run between level sockets goes under");
const both = route(a, { tip: { x: 50, y: -60 }, out: { x: 1, y: 0 } }, [], P);
ok(square(both) && Math.max(...both.map((p) => p.x)) >= 110 - 1e-9, "two right-hand sockets join out past the further");
const turned = route(a, { tip: { x: 250, y: 50 }, out: { x: 0, y: -1 } }, [], P);
ok(square(turned) && turned.length === 3, "a level stub meets an upright one with one corner");
const via = route(a, b, [{ x: 150, y: 40 }], P);
ok(via.some((p) => same(p, { x: 150, y: 40 })) && same(via[0], a.tip) && same(via[via.length - 1], b.tip), "corners drawn are kept");

// numbers: both ends on a long run, the middle on a short one, none for None
ok(numberPlaces(fwd, "Auto", P).length === 2 && numberPlaces(route(a, { tip: { x: 140, y: -20 }, out: { x: -1, y: 0 } }, [], P), "Auto", P).length === 1, "Auto writes both ends on a long run, the middle on a short one");
ok(numberPlaces(fwd, "None", P).length === 0 && numberPlaces(fwd, "Source", P)[0].hAlign === 1 && numberPlaces(fwd, "Destination", P)[0].hAlign === 3, "Source writes after the source, Destination before the destination");
ok(numberPlaces(level, "Mid", P)[0].hAlign === 2 && numberPlaces(fwd, "Mid", P)[0].hAlign === 1, "Mid is centred over a level run, beside an upright one");
const arrow = arrowEnd(a, P, true);
ok(same(arrow.line[1], { x: 130, y: -10 }) && same(arrow.head[0], { x: 130, y: -10 }) && arrow.note.hAlign === 1, "a source arrow points out, its note after it");
const backArrow = arrowEnd(b, P, false);
ok(backArrow.head[0].x > backArrow.head[1].x && backArrow.note.hAlign === 3, "a destination's arrow points back at its socket");

// cable numbers
const circuits = [
  { id: "c", signal: "Analog Audio", sourceDevice: "MIX1", sourceSocket: "OUT1", at: { x: 0, y: -100 } },
  { id: "a", signal: "SDI", sourceDevice: "CAM1", sourceSocket: "SDI1", at: { x: 50, y: 0 } },
  { id: "b", signal: "SDI", sourceDevice: "CAM2", sourceSocket: "SDI1", at: { x: 0, y: 0 } },
];
const bySignal = cableNumbers(circuits, "Signal and Sequence", "Left to Right, then Down", 3, new Set(["V001"]));
ok(bySignal.get("b") === "V002" && bySignal.get("a") === "V003" && bySignal.get("c") === "A001", `by signal, left to right, skipping numbers taken (${JSON.stringify([...bySignal])})`);
const columns = cableNumbers(circuits, "Sequence", "Top to Bottom, then Right", 2, new Set());
ok(columns.get("b") === "01" && columns.get("c") === "02" && columns.get("a") === "03", `top to bottom, then right (${JSON.stringify([...columns])})`);
const bySource = cableNumbers([...circuits, { id: "d", signal: "SDI", sourceDevice: "CAM1", sourceSocket: "SDI1", at: { x: 0, y: 0 } }], "Source Device and Socket", "Drawing Order", 2, new Set());
ok(bySource.get("a") === "CAM1-SDI1" && bySource.get("d") === "CAM1-SDI1-01", `source device and socket, a repeat numbered on (${JSON.stringify([...bySource])})`);
ok(cableNumbers(circuits, "Source Device and Sequence", "Drawing Order", 2, new Set()).get("a") === "CAM1-01", "source device and sequence");

// loops
{
  const sk = (id: number, slot: number, type: "IN" | "OUT" | "IO" = "IN", loop?: number) => ({ id, name: `${type}${id}`, tag: "", type, side: "L" as const, slot, signal: "SDI", connector: "BNC", terminated: false, ...(loop !== undefined ? { loop } : {}) });
  ok(flowOf(sk(1, 0, "IN", 2)) === "IO" && flowOf(sk(1, 0)) === "IN" && flowOf(sk(1, 0, "IO", 2)) === "IO", "a looped input connects either way");
  const kept = cleanLoops([sk(1, 0, "IN", 2), sk(2, 1, "IN", 1), sk(3, 3, "IN", 9), sk(4, 4, "IN", 5), sk(5, 6, "IN", 4)]);
  ok(kept[0].loop === 2 && kept[1].loop === 1 && kept[2].loop === undefined && kept[3].loop === undefined && kept[4].loop === undefined, "a loop stays only between neighbours naming each other");
  const box = { width: 40, height: 30 };
  const arc = loopArc(sk(1, 0), sk(2, 1), box, 5);
  const at = (p: Pt, x: number, y: number): boolean => near(p.x, x) && near(p.y, y);
  ok(at(arc[0], 0, -7.5) && at(arc[arc.length - 1], 0, -12.5) && at(arc[6], -2.5, -10), "a half circle outside the edge, tip to tip");
  const empty = loopPlan([], "L", 2);
  ok(typeof empty !== "string" && empty.kind === "loop" && empty.join.length === 0 && empty.add.join() === "2,3", "on a free row: two new sockets");
  const two = loopPlan([sk(1, 0), sk(2, 1)], "L", 0);
  ok(typeof two !== "string" && two.kind === "loop" && two.join.join() === "1,2" && two.add.length === 0, "two inputs there: looped");
  const lower = loopPlan([sk(1, 0), sk(2, 1)], "L", 1);
  ok(typeof lower !== "string" && lower.kind === "loop" && lower.join.join() === "1,2", "the lower one clicked loops with the one above");
  const one = loopPlan([sk(1, 0)], "L", 0);
  ok(typeof one !== "string" && one.kind === "loop" && one.join.join() === "1" && one.add.join() === "1", "one there: a second added below");
  const off = loopPlan([sk(1, 0, "IN", 2), sk(2, 1, "IN", 1)], "L", 1);
  ok(typeof off !== "string" && off.kind === "unloop" && off.ids.join() === "2,1", "a looped socket loses its loop");
  ok(typeof loopPlan([sk(1, 0, "OUT")], "L", 0) === "string", "an output can't be looped");
  ok(rowSlots([sk(1, 2)], "L", 0, 4, false).map((r) => r.join()).join("|") === "0|1|3|4", "an array of sockets fills the free rows");
  ok(rowSlots([sk(1, 2)], "L", 5, 0, true).map((r) => r.join()).join("|") === "0,1|3,4", "an array of loops, two free rows side by side");
  ok(rowSlots([], "R", 3, 3, true).length === 0, "a loop needs two rows");
  // a loop-thru's second socket on a device's left feeding a device to its right runs round its own device
  const leftSide = { x: -1, y: 0 };
  const dev = { lo: { x: 0, y: -30 }, hi: { x: 40, y: 0 } };
  const round = route({ tip: { x: 0, y: -12.5 }, out: leftSide }, { tip: { x: 100, y: -7.5 }, out: leftSide }, [], 2.5, [dev]);
  const crossing = round.slice(1).some((p, i) => { const a = round[i]; return Math.abs(a.y - p.y) < 1e-9 && a.y > dev.lo.y && a.y < dev.hi.y && Math.min(a.x, p.x) < dev.hi.x && Math.max(a.x, p.x) > dev.lo.x; });
  ok(!crossing && round.some((p) => near(p.y, 2.5)), "round the top of its own device, not through it");
  const clear = route({ tip: { x: 0, y: -12.5 }, out: leftSide }, { tip: { x: 100, y: -7.5 }, out: leftSide }, [], 2.5, []);
  ok(clear.length === 4 && near(clear[2].y, -7.5), "with nothing in the way, back along the other's row");
}

// crossings, and hops over them
{
  const across = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -50 }];
  const upright = [{ x: 40, y: 20 }, { x: 40, y: -80 }];
  const x = crossings(across, upright);
  ok(x.length === 1 && x[0].piece === 0 && near(x[0].at.x, 40) && near(x[0].at.y, 0), "an upright crossing the first piece");
  ok(crossings(across, [{ x: 100, y: 0 }, { x: 150, y: 0 }]).length === 0 && crossings(across, [{ x: 10, y: 0 }, { x: 60, y: 0 }]).length === 0, "meeting at an end, or running along, isn't crossing");
  ok(crossings(across, [{ x: -10, y: -20 }, { x: 130, y: -20 }]).length === 1 && crossings(across, [{ x: -10, y: -20 }, { x: 130, y: -20 }])[0].piece === 1, "on the second piece");
  const h = hopped(across, [{ ...x[0], radius: 5, down: false }]);
  ok(h.points.length === 6 && h.vertices.join() === "corner,corner,through,corner,corner,corner" && near(h.points[1].x, 35) && near(h.points[2].y, 5) && near(h.points[3].x, 45), `a hop up over x 40 (${JSON.stringify(h.points)})`);
  ok(hopped(across, [{ piece: 0, at: { x: 97, y: 0 }, radius: 5, down: false }]).points.length === 3, "a hop past the corner left out");
  ok(hopped(across, [{ piece: 0, at: { x: 40, y: 0 }, radius: 5, down: false }, { piece: 0, at: { x: 46, y: 0 }, radius: 5, down: false }]).points.length === 6, "one hop where two would overlap");
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
