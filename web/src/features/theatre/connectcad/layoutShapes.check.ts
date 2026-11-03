// npx tsx src/features/theatre/connectcad/layoutShapes.check.ts
import { insideRing, ringArea, roomLabelAt, roomPath, roomWireframe, roundDrawing, roundRoom } from "./layoutShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const square = (x0: number, y0: number, size: number) => [
  { x: x0, y: y0 },
  { x: x0 + size, y: y0 },
  { x: x0 + size, y: y0 + size },
  { x: x0, y: y0 + size },
];
ok(ringArea(square(0, 0, 10)) === 100 && ringArea([...square(0, 0, 10)].reverse()) === 100, "area either way round");
const ell = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 20 },
  { x: 0, y: 20 },
];
ok(ringArea(ell) === 300 && insideRing({ x: 5, y: 15 }, ell) && !insideRing({ x: 15, y: 15 }, ell), "an L-shaped room");

const rooms = [
  { id: "AV1", ring: square(10, 10, 20) },
  { id: "MAIN", ring: square(0, 0, 100) },
  { id: "AV2", ring: square(50, 50, 20) },
  { id: "", ring: square(12, 12, 5) },
];
ok(roomPath(rooms, { x: 15, y: 15 }) === "MAIN.AV1", `nested, the outer first (${roomPath(rooms, { x: 15, y: 15 })})`);
ok(roomPath(rooms, { x: 60, y: 60 }) === "MAIN.AV2" && roomPath(rooms, { x: 90, y: 5 }) === "MAIN" && roomPath(rooms, { x: 200, y: 5 }) === "", "in one, the other, the outer only, none");

ok(JSON.stringify(roomLabelAt(square(0, 0, 10), 1)) === '{"x":1,"y":9}', "the label at the top left");
const wire = roomWireframe(square(0, 0, 10), 0, 3);
ok(wire.length === 6 && wire[0].points.length === 15 && wire[1].points[2] === 3 && wire[2].points.join() === "0,0,0,0,0,3", "the wireframe: foot, top and four corners");

// round a 10 x 6 room, pieces 3 wide and 1 deep, 0.5 apart: clear of the corners by 1.5
const placed = roundRoom(square(0, 0, 10).map((p) => ({ x: p.x, y: p.y * 0.6 })), [3, 3, 3, 3].map((width) => ({ width, depth: 1 })), 0.5);
const r1 = placed.map((q) => `${+q.at.x.toFixed(3)},${+q.at.y.toFixed(3)},${+(((q.angle % 360) + 360) % 360).toFixed(3)}`);
ok(r1[0] === "3,1,180" && r1[1] === "6.5,1,180", `along the first wall, facing in (${r1})`);
ok(r1[2] === "9,3,270", `the third goes on round the corner (${r1[2]})`);
ok(r1[3] === "7,5,0", `the fourth on to the third wall, the second full (${r1[3]})`);
const back = roundRoom([...square(0, 0, 10)].reverse(), [{ width: 2, depth: 1 }], 0);
ok(Math.abs(back[0].at.y - 1) < 1e-9, `a ring running clockwise is turned round (${JSON.stringify(back[0])})`);
const drawn = roundDrawing({ x0: 0, y0: 0, x1: 100, y1: 50 }, [{ width: 10, depth: 4, rack: true }, { width: 6, depth: 2, rack: false }, { width: 10, depth: 4, rack: true }, { width: 6, depth: 2, rack: false }], 1);
ok(JSON.stringify(drawn.map((q) => [q.at.x, q.at.y])) === "[[-6,46],[3,51],[-6,41],[10,51]]", `rack ones down the left, the rest along the top (${JSON.stringify(drawn.map((q) => [q.at.x, q.at.y]))})`);

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
