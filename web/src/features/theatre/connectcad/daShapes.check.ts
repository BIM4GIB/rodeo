// npx tsx src/features/theatre/connectcad/daShapes.check.ts
import type { Socket } from "./ccadShapes.ts";
import { daCarries, daDescription, daSockets, daTypeOf, nearestOnPath, outputCount } from "./daShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const fields = { outputs: 4, loop: false, signal: "SDI", connector: "BNC" };
const fresh = daSockets([], fields) as Socket[];
ok(fresh.map((k) => `${k.name}:${k.side}${k.slot}`).join() === "IN1:L0,OUT1:R0,OUT2:R1,OUT3:R2,OUT4:R3", "an input on the left, four outputs down the right");
ok(fresh.every((k) => k.signal === "SDI" && k.connector === "BNC") && new Set(fresh.map((k) => k.id)).size === 5, "the signal asked, each its own id");

const looped = daSockets(fresh, { ...fields, loop: true }) as Socket[];
const [i1, i2] = looped;
ok(i1.id === fresh[0].id && i2.name === "IN2" && i2.slot === 1 && i1.loop === i2.id && i2.loop === i1.id, "a loop-thru: the input looped to a new one below it");
ok(looped.filter((k) => k.type === "OUT").map((k) => k.id).join() === fresh.slice(1).map((k) => k.id).join(), "the outputs kept, ids and all");

const fewer = daSockets(looped, { ...fields, outputs: 2, loop: false }) as Socket[];
ok(fewer.map((k) => k.name).join() === "IN1,OUT1,OUT2" && fewer[0].loop === undefined, "two outputs, the loop-thru taken off");
const more = daSockets(fewer, { ...fields, outputs: 3 }) as Socket[];
ok(more.map((k) => `${k.name}:${k.slot}`).join() === "IN1:0,OUT1:0,OUT2:1,OUT3:2" && more[3].id > Math.max(...fewer.map((k) => k.id)), "a new output in the next free row, a new id");

// a socket of its own given in Edit Sockets is left alone; one in the row below the input blocks a loop
const extra: Socket = { id: 99, name: "REF", tag: "REF", type: "IN", side: "L", slot: 1, signal: "Reference", connector: "BNC", terminated: false };
const kept = daSockets([...fresh, extra], { ...fields, outputs: 2 }) as Socket[];
ok(kept.some((k) => k.id === 99) && kept.filter((k) => k.type === "OUT").length === 2, "its own socket kept");
ok(typeof daSockets([...fresh, extra], { ...fields, loop: true }) === "string", "the row below the input taken: no loop");

ok(outputCount(0) === 1 && outputCount(100) === 32 && outputCount(Number.NaN) === 1 && outputCount(5.4) === 5, "outputs from 1 to 32");
ok(daDescription("Video", 4) === "1×4 Video DA" && daTypeOf("Audio DA") === "Audio" && daTypeOf("") === null, "description and type");
ok(daCarries("Video", "HDMI") && daCarries("Audio", "AES/EBU") && !daCarries("Video", "Analog Audio") && daCarries("Audio", "---"), "a DA carries its own category's signals");

const near = nearestOnPath(
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: -10 },
  ],
  { x: 12, y: -4 },
)!;
ok(Math.abs(near.at.x - 10) < 1e-9 && Math.abs(near.at.y + 4) < 1e-9 && Math.abs(near.distance - 2) < 1e-9, "the nearest point of a run");
ok(nearestOnPath([{ x: 0, y: 0 }], { x: 1, y: 1 }) === null, "no run, no point");

console.log(failed ? `${failed} failed` : "all passed");
