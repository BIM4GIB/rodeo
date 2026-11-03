// npx tsx src/features/theatre/connectcad/transferShapes.check.ts
import type { Socket } from "./ccadShapes.ts";
import { transferredSockets } from "./transferShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const sock = (id: number, name: string, side: Socket["side"], slot: number, more: Partial<Socket> = {}): Socket => ({ id, name, tag: name, type: side === "L" ? "IN" : "OUT", side, slot, signal: "SDI", connector: "BNC", terminated: false, ...more });
const at = (list: readonly Socket[], name: string): Socket | undefined => list.find((k) => k.name === name);

// the source: IN1, IN2 on the left, OUT1 on the right, a new LTC socket; IN1 and IN2 looped
const source = [sock(1, "IN1", "L", 0, { loop: 2, type: "IO" }), sock(2, "IN2", "L", 1, { loop: 1, type: "IO" }), sock(3, "OUT1", "R", 0, { signal: "HD-SDI" }), sock(4, "LTC", "L", 2, { signal: "Timecode", connector: "XLR" })];
// the target: IN1 lower down, OUT1, its own GPI at the left's third row (where LTC goes), and a spare
const target = [sock(7, "IN1", "L", 3), sock(5, "OUT1", "R", 1), sock(9, "GPI", "L", 2, { signal: "GPI" }), sock(6, "SPARE", "R", 4)];

const kept = transferredSockets(source, target, "keep", new Set([6]));
ok(kept.deleted.length === 0 && kept.sockets.length === 6, `every socket kept, two added (${kept.sockets.map((k) => k.name).join()})`);
ok(at(kept.sockets, "IN1")?.id === 7 && at(kept.sockets, "IN1")?.slot === 0 && at(kept.sockets, "IN1")?.type === "IO", "IN1 keeps its number, takes the source's place and settings");
ok(at(kept.sockets, "OUT1")?.id === 5 && at(kept.sockets, "OUT1")?.slot === 0 && at(kept.sockets, "OUT1")?.signal === "HD-SDI", "OUT1 too");
const in2 = at(kept.sockets, "IN2");
ok(in2 !== undefined && in2.id === 10 && in2.loop === 7 && at(kept.sockets, "IN1")?.loop === in2.id, "IN2 added with a new number, looped with IN1 by its number on the target");
ok(at(kept.sockets, "GPI")?.slot === 2, "the target's own GPI stays where it was");
const ltc = at(kept.sockets, "LTC");
ok(ltc !== undefined && ltc.slot === 3 && ltc.connector === "XLR" && ltc.id === 11, `LTC added, moved down a row past GPI (${JSON.stringify(ltc)})`);
ok(new Set(kept.sockets.map((k) => k.id)).size === kept.sockets.length && new Set(kept.sockets.map((k) => `${k.side}${k.slot}`)).size === kept.sockets.length, "numbers and places all different");

const unconnected = transferredSockets(source, target, "unconnected", new Set([6]));
ok(unconnected.deleted.join() === "9" && !at(unconnected.sockets, "GPI") && at(unconnected.sockets, "SPARE") !== undefined, "the target's own: GPI (not connected) deleted, SPARE (connected) kept");
ok(at(unconnected.sockets, "LTC")?.slot === 2, "LTC in its own place once GPI's gone");

const all = transferredSockets(source, target, "all", new Set([6]));
ok(all.deleted.sort().join() === "6,9" && all.sockets.length === 4, "both deleted even if connected");

// a target socket named twice: the first takes the source's, the second is the target's own
const twice = transferredSockets([sock(1, "A", "L", 0)], [sock(1, "A", "L", 0), sock(2, "A", "L", 1)], "unconnected", new Set());
ok(twice.sockets.length === 1 && twice.deleted.join() === "2", "a second socket of the same name is the target's own");
// nothing on the target
const fresh = transferredSockets(source, [], "keep", new Set());
ok(fresh.sockets.map((k) => k.id).join() === "1,2,3,4" && fresh.sockets[0].loop === 2, "an empty target takes the source's sockets");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
