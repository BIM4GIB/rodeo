// npx tsx src/features/theatre/connectcad/adapterSlotShapes.check.ts
import { readSlots, slotLabel, slotNames, slotPlaces, slotProblem, slotRect, slotsText, type AdapterSlot } from "./adapterSlotShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const slot = (name: string, x: number, z: number, side: "Front" | "Rear" = "Front", type = ""): AdapterSlot => ({ name, type, side, x, z, width: 80, height: 30 });

// kept and read back
const kept = [slot("SLOT1", -100.123, 20, "Front", "HDMI card"), slot("B", 50, 22.5, "Rear")];
const back = readSlots(slotsText(kept));
ok(back.length === 2 && back[0].name === "SLOT1" && back[0].type === "HDMI card" && back[0].x === -100.12 && back[1].side === "Rear" && back[1].width === 80, "kept and read back, to a hundredth");
ok(slotsText([]) === "" && readSlots("").length === 0, "none: an empty field");
ok(readSlots("not json").length === 0 && readSlots('{"n":1}').length === 0, "unreadable: none");
ok(readSlots('[{"n":"A","w":0,"h":10},{"n":"B","w":10,"h":10,"s":"Side"}]').map((k) => `${k.name}${k.side}`).join() === "BFront", "no size dropped; an unknown side is the front");

// names
ok(slotNames("SLOT1", 1).join() === "SLOT1", "one: the name");
ok(slotNames("SLOT1", 1, new Set(["SLOT1"])).join() === "SLOT2", "one taken: numbered on");
ok(slotNames("IN1", 3).join() === "IN1,IN2,IN3", "a row numbered on");
ok(slotNames("CARD", 3).join() === "CARD1,CARD2,CARD3", "a name with no number takes 1, 2, 3");
ok(slotNames("A01", 3, new Set(["A02"])).join() === "A01,A03,A04", "digits kept, taken skipped");
ok(slotNames("", 2).join() === "1,2", "no name: numbers");

// places
const at = (ps: { x: number; y: number }[]): string => ps.map((p) => `${p.x}:${p.y}`).join(" ");
ok(at(slotPlaces("single", { x: 5, y: 6 }, { x: 500, y: 6 }, 80, 30)) === "5:6", "single: the click");
ok(at(slotPlaces("linear", { x: 0, y: 20 }, { x: 170, y: 25 }, 80, 30)) === "0:20 80:20 160:20", "a level row, as many as reach the pointer");
ok(at(slotPlaces("linear", { x: 160, y: 20 }, { x: 0, y: 10 }, 80, 30)) === "0:20 80:20 160:20", "leftward: still left to right");
ok(at(slotPlaces("linear", { x: 0, y: 0 }, { x: 10, y: 65 }, 80, 30)) === "0:60 0:30 0:0", "plumb: top first");
ok(at(slotPlaces("linear", { x: 0, y: 0 }, { x: 20, y: 0 }, 80, 30)) === "0:0", "short of the next: one");
ok(at(slotPlaces("rect", { x: 0, y: 0 }, { x: 85, y: -31 }, 80, 30)) === "0:0 80:0 0:-30 80:-30", "a block: rows from the top, left to right");
ok(slotPlaces("rect", { x: 0, y: 0 }, { x: 1e6, y: 1e6 }, 1, 1).length <= 200, "a block is capped");

// fit
const face = { x0: -200, x1: 200, z0: 0, z1: 88.9 };
ok(slotProblem(slot("A", 0, 44), face, []) === null, "fits");
ok(slotProblem(slot("A", 170, 44), face, []) === "runs off the front", "off the side");
ok(slotProblem(slot("A", 0, 80, "Rear"), face, []) === "runs off the rear", "off the top, at the rear");
ok(slotProblem(slot("A", 0, 44), face, [slot("B", 60, 44)]) === "overlaps B", "overlaps one");
ok(slotProblem(slot("A", 0, 44), face, [slot("B", 80, 44)]) === null, "side by side is fine");
ok(slotProblem(slot("A", 0, 44), face, [slot("B", 0, 44, "Rear")]) === null, "the other side is apart");
const r = slotRect(slot("A", 10, 20));
ok(r.x0 === -30 && r.x1 === 50 && r.z0 === 5 && r.z1 === 35, "a slot's rectangle about its middle");

// what it shows
ok(JSON.stringify(slotLabel(slot("A", 0, 0), undefined)) === '{"text":"","cross":true}', "not linked, no type: crossed");
ok(slotLabel(slot("A", 0, 0, "Front", "Quad SDI"), undefined).text === "Quad SDI", "not linked: its type");
ok(slotLabel(slot("A", 0, 0, "Front", "Quad SDI"), null).text === "Quad SDI", "linked with no adapter: its type");
ok(slotLabel(slot("A", 0, 0, "Front", "Quad SDI"), "HDMI-SDI").text === "HDMI-SDI", "an adapter on its socket: the adapter");
ok(slotLabel(slot("A", 0, 0), " ").text === "<Unknown>", "an adapter of no make: <Unknown>");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
