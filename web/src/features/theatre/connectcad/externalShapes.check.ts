// npx tsx src/features/theatre/connectcad/externalShapes.check.ts
import type { Socket } from "./ccadShapes.ts";
import { arrayNames, arrayPlaces, circuitCount, externalOutline, externalSockets, socketSide, type ExternalFields } from "./externalShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const P = 5;
const box = { width: 30, height: 12.5 };

// the pointed end is away from the sockets
const left = externalOutline(box, "Left", P);
ok(left.length === 5 && left[4].x === 0 && left[4].y === -6.25 && left[1].x === 30, "a left external points left");
const right = externalOutline(box, "Right", P);
ok(right[2].x === 30 && right[2].y === -6.25 && right[0].x === 0, "a right external points right");
ok(socketSide("Left") === "R" && socketSide("Right") === "L", "its sockets face the drawing");

// sockets after an edit
const fields: ExternalFields = { type: "OUT", signal: "SDI", connector: "BNC", facing: "Left", circuits: 1 };
const one = externalSockets([], fields, new Set());
ok(one.length === 1 && one[0].id === 1 && one[0].name === "1" && one[0].side === "R" && one[0].slot === 0 && one[0].type === "OUT", "a new external's one socket");
const three = externalSockets(one, { ...fields, circuits: 3 }, new Set());
ok(three.length === 3 && three.map((k) => k.id).join() === "1,2,3" && three.map((k) => k.slot).join() === "0,1,2" && three[2].name === "3", "more circuits add sockets, numbered on");
const renamed: Socket[] = three.map((k) => (k.id === 2 ? { ...k, name: "B", signal: "HDMI" } : k));
const turned = externalSockets(renamed, { ...fields, circuits: 3, facing: "Right" }, new Set(["facing"]));
ok(turned.every((k) => k.side === "L") && turned[1].name === "B" && turned[1].signal === "HDMI", "facing moves every socket and keeps their own edits");
const resignal = externalSockets(renamed, { ...fields, circuits: 3, signal: "Analog Audio", connector: "XLR" }, new Set(["signal"]));
ok(resignal.every((k) => k.signal === "Analog Audio" && k.connector === "XLR"), "a new signal and its connector on every socket");
const cut = externalSockets(three, { ...fields, circuits: 2 }, new Set());
ok(cut.map((k) => k.id).join() === "1,2", "fewer circuits cut the last");
const regrow = externalSockets(cut, { ...fields, circuits: 3 }, new Set());
ok(regrow[2].id === 3 && regrow[2].name === "3", "a socket added again takes the next id");
ok(circuitCount(0) === 1 && circuitCount(2.6) === 3 && circuitCount(500) === 64 && circuitCount(NaN) === 1, "a whole number of circuits");

// a linear array
const down = arrayPlaces({ x: 0, y: 0 }, { x: 0, y: -60 }, box, P);
ok(down.length === 4 && down[1].y === -17.5 && down[3].y === -52.5, "a box and a pitch apart down the line");
const across = arrayPlaces({ x: 0, y: 0 }, { x: 100, y: 0 }, box, P);
ok(across.length === 3 && across[1].x === 35, "across by their width");
ok(arrayPlaces({ x: 1, y: 1 }, { x: 1, y: 1 }, box, P).length === 1, "no line: one");
ok(arrayNames("EXT", 3, new Set()).join() === "EXT1,EXT2,EXT3", "numbered from 1");
ok(arrayNames("FEED07", 3, new Set(["FEED08"])).join() === "FEED07,FEED09,FEED10", "counting on from its own number, skipping taken");

console.log(failed ? `${failed} failed` : "all passed");
