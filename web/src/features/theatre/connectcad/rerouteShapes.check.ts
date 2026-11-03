// npx tsx src/features/theatre/connectcad/rerouteShapes.check.ts
import { busCorners, busSteps, nearestOn, offsetPath, sideOf } from "./rerouteShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const same = (a: readonly { x: number; y: number }[], b: readonly [number, number][]): boolean => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i][0]) < 1e-6 && Math.abs(p.y - b[i][1]) < 1e-6);

// a bus right, down and right again: from a socket at (0, 0) to one at (100, -40)
const bus = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: -40 },
  { x: 100, y: -40 },
];
const n = nearestOn(bus, { x: 20, y: -10 });
ok(same([n.at], [[20, 0]]) && n.piece === 0 && n.along === 20 && n.distance === 10, "nearest point, its piece and how far along");
ok(nearestOn(bus, { x: 60, y: -20 }).piece === 1 && nearestOn(bus, { x: 60, y: -20 }).along === 70, "on the upright piece");
ok(sideOf(bus, { x: 20, y: 10 }) === 1 && sideOf(bus, { x: 20, y: -10 }) === -1 && sideOf(bus, { x: 40, y: -20 }) === -1, "left above the first piece, right below it and inside the turn");

// moved to its right by 10: inside the first turn, outside the second, mitred square
ok(same(offsetPath(bus, -10), [[0, -10], [40, -10], [40, -50], [100, -50]]), `offset right (${JSON.stringify(offsetPath(bus, -10))})`);
ok(same(offsetPath(bus, 10), [[0, 10], [60, 10], [60, -30], [100, -30]]), "offset left");
ok(same(offsetPath(bus, 0), bus.map((p) => [p.x, p.y])), "no distance, the bus itself");

// a circuit from a socket below the bus's start to one below its end, stubs of 5
const src = { tip: { x: 0, y: -10 }, out: { x: 1, y: 0 } };
const dst = { tip: { x: 100, y: -50 }, out: { x: -1, y: 0 } };
const shared = busCorners(bus, src, dst, 5);
ok(same(shared.corners, [[5, -10], [5, 0], [50, 0], [50, -40], [95, -40], [95, -50]]), `bussed: up onto the bus, along it, down off it (${JSON.stringify(shared.corners)})`);
ok(same(shared.nodes, [[5, 0], [95, -40]]), "breakout nodes where it joins and leaves");
const parallel = busCorners(offsetPath(bus, -10), src, dst, 5);
ok(same(parallel.corners, [[5, -10], [40, -10], [40, -50], [95, -50]]), `a step to the right: straight along its own rows (${JSON.stringify(parallel.corners)})`);

// a circuit running the other way along the bus takes its corners backwards
const back = busCorners(bus, { tip: { x: 100, y: -45 }, out: { x: -1, y: 0 } }, { tip: { x: 0, y: 5 }, out: { x: 1, y: 0 } }, 5);
ok(same(back.corners, [[95, -45], [95, -40], [50, -40], [50, 0], [5, 0], [5, 5]]), `backwards (${JSON.stringify(back.corners)})`);

// steps: left of the bus 1, 2…, right of it -1, -2…, nearest first
ok(busSteps(bus, [{ x: 5, y: -20 }, { x: 5, y: -10 }, { x: 5, y: 10 }, { x: 5, y: -30 }]).join() === "-2,-1,1,-3", "steps by side, nearest first");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
