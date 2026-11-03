// npx tsx src/features/theatre/connectcad/adapterShapes.check.ts
import { adapterCorner, adapterNames, adapterNear, adapterRefusal, adapterSockets } from "./adapterShapes.ts";
import type { Socket } from "./ccadShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

ok(adapterNames(" L, R ,").join() === "L,R" && adapterNames("").join() === "" && adapterNames("").length === 1, "names from a list; one of no name for none");

const host: Socket = { id: 4, name: "OUT1", tag: "OUT1", type: "OUT", side: "R", slot: 2, signal: "Analog Audio", connector: "XLR3", terminated: false };
const two = adapterSockets(["L", "R"], host, "RCA");
ok(two.map((k) => `${k.id}${k.name}:${k.type}:${k.side}${k.slot}:${k.signal}:${k.connector}`).join() === "1L:OUT:R0:Analog Audio:RCA,2R:OUT:R1:Analog Audio:RCA", "a socket a name, of the host's way and signal, on its side");
const one = adapterSockets(["X"], host, "TRS", two);
ok(one.length === 1 && one[0].id === 1 && one[0].connector === "TRS", "ids kept by place");
const three = adapterSockets(["A", "B", "C"], host, "RCA", two);
ok(three.map((k) => k.id).join() === "1,2,3", "a new socket a new id");

ok(adapterRefusal(host) === null && adapterRefusal({ ...host, side: "T" }) !== null && adapterRefusal({ ...host, loop: 5 }) !== null && adapterRefusal({ ...host, terminated: true }) !== null, "left or right sockets only, not looped or terminated");

const box = { width: 30, height: 25 };
const r = adapterCorner({ x: 80, y: -25 }, "R", box, 10);
const l = adapterCorner({ x: 0, y: -25 }, "L", box, 10);
ok(r.x === 80 && r.y === -10 && l.x === -30 && l.y === -10, "outside the device on the socket's side, its first row level with it");
const nr = adapterNear("R", box, 10);
const nl = adapterNear("L", box, 10);
ok(r.x + nr.x === 80 && r.y + nr.y === -25 && l.x + nl.x === 0 && l.y + nl.y === -25, "its near point on the socket's tip");

console.log(failed ? `${failed} failed` : "all passed");
