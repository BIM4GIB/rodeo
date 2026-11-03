// npx tsx src/features/theatre/connectcad/rackShapes.check.ts
import { RACK_UNIT } from "../../../app/rackRulerShapes.ts";
import { equipmentSolid, firstFreeSlot, firstFreeUnit, frameFront, frameSolid, runRect, slotRun, MIN_POST, mountFace, mountHeight, openingLabel, overallSet, FACE_PLATE, rackDrawing, rackOverall, unitAt, type RackSize } from "./rackShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

const rack: RackSize = { style: "Rack (4-post)", units: 42, enclosureHeight: 2000, opening: 482.6, depth: 800, postWidth: 58.7, postDepth: 50, top: 50, base: 100, slope: 20, panel: 20 };
const all = rackOverall(rack);
ok(near(all.height, 42 * RACK_UNIT + 150) && near(all.width, 600) && near(all.depth, 900), `overall (${JSON.stringify(all)})`);

// height: whole units, the base making up the rest
const taller = overallSet(rack, "height", 2100);
ok(taller.units === 43 && near(taller.base, 2100 - 50 - 43 * RACK_UNIT) && near(rackOverall(taller).height, 2100), `taller (${taller.units}, ${taller.base})`);
let threw = false;
try {
  overallSet(rack, "height", 180);
} catch {
  threw = true;
}
ok(threw, "no room for a unit refused");

// width: the posts first, then the opening drops to a standard one that leaves room
const wider = overallSet(rack, "width", 700);
ok(near(wider.postWidth, (700 - 482.6) / 2) && wider.opening === 482.6, "wider: thicker posts");
const narrow = overallSet(rack, "width", 495);
ok(narrow.opening === 254 && near(narrow.postWidth, (495 - 254) / 2) && openingLabel(narrow.opening) === '10"', `narrower than the posts allow: a 10" opening (${narrow.opening})`);
const tiny = overallSet(rack, "width", 200);
ok(near(tiny.opening, 200 - 2 * MIN_POST) && openingLabel(tiny.opening) === "Custom", "narrower than any standard: a custom opening");
ok(overallSet(rack, "depth", 1000).depth === 900, "depth less the posts");

// an enclosure's height is its own; a console's units run up its slope
const enclosure: RackSize = { ...rack, style: "Enclosure" };
ok(near(mountHeight(enclosure), 1850) && overallSet(enclosure, "height", 2400).enclosureHeight === 2400, "an enclosure");
const console1: RackSize = { ...rack, style: "Console", units: 10, slope: 60, panel: 25 };
ok(near(rackOverall(console1).height, 100 + 10 * RACK_UNIT * 0.5 + 50) && near(rackOverall(console1).width, 532.6) && rackOverall(console1).depth === 800, `a console (${JSON.stringify(rackOverall(console1))})`);

// what's drawn
const full = rackDrawing(rack, { rails: true, sidePanels: true, frontDoor: true, rearDoor: false });
ok(full.posts.length === 4 && full.solids.map((s) => s.part).join() === "frame,rail,panel,door", `4-post parts (${full.solids.map((s) => s.part)})`);
const zs = full.solids.flatMap((s) => s.faces.flatMap((f) => f.filter((_, i) => i % 3 === 2)));
const ys = full.solids.flatMap((s) => s.faces.flatMap((f) => f.filter((_, i) => i % 3 === 1)));
ok(near(Math.min(...zs), 0) && near(Math.max(...zs), all.height) && near(Math.min(...ys), 0) && near(Math.max(...ys), 900), "within its overall size");
const two = rackDrawing({ ...rack, style: "Rack (2-post)", depth: 400 }, { rails: true, sidePanels: true, frontDoor: true, rearDoor: true });
ok(two.posts.length === 2 && two.solids.map((s) => s.part).join() === "frame,rail", "2-post: no covers or doors");
const desk = rackDrawing(console1, { rails: true, sidePanels: true, frontDoor: true, rearDoor: true });
const deskZ = desk.solids[0].faces.flatMap((f) => f.filter((_, i) => i % 3 === 2));
const deskX = desk.solids[0].faces.flatMap((f) => f.filter((_, i) => i % 3 === 0));
ok(desk.solids.length === 1 && near(Math.max(...deskZ), rackOverall(console1).height) && near(Math.max(...deskX), 266.3) && desk.lines.length === 1, "a console's profile carried across its width");
const box = rackDrawing(enclosure, { rails: false, sidePanels: false, frontDoor: true, rearDoor: false });
ok(box.solids.map((s) => s.part).join() === "panel,door" && box.lines.length === 3, "an enclosure's walls and door");

// mounting
const front = mountFace(rack, "Front");
const rear = mountFace(rack, "Rear");
ok(front.y === 50 && !front.rear && rear.y === 850 && rear.rear && front.units === 42 && front.z === 100, "a 4-post rack's faces");
ok(near(unitAt(front, 3).z, 100 + 2 * RACK_UNIT) && unitAt(front, 43).z === all.height && unitAt(front, 0).z === all.height, "units up from the base, past them on top");
const slopeFace = mountFace(console1, "Rear");
const u2 = unitAt(slopeFace, 2);
ok(!slopeFace.rear && slopeFace.slope === 60 && near(u2.y, RACK_UNIT * Math.sin(Math.PI / 3)) && near(u2.z, 100 + RACK_UNIT * 0.5), "a console's units run up its slope, its front only");
ok(mountFace(enclosure, "Front").units === Math.floor(1850 / RACK_UNIT), "an enclosure's units from its height");
ok(firstFreeUnit(42, [], 2) === 41 && firstFreeUnit(42, [{ u: 41, units: 2 }], 1) === 40 && firstFreeUnit(4, [{ u: 1, units: 1 }, { u: 3, units: 2 }], 1) === 2 && firstFreeUnit(4, [{ u: 1, units: 4 }], 1) === 5, "the first free unit from the top, on top when full");
const piece = equipmentSolid(482.6, 2 * RACK_UNIT, 400, true, 0);
const px = [...piece.panel, ...piece.body].flatMap((f) => f.filter((_, i) => i % 3 === 0));
ok(near(Math.max(...px), 241.3) && near(piece.outline[0].y, -FACE_PLATE) && near(piece.outline[2].y, 400), "a racked piece: panel and body");
const leaning = equipmentSolid(400, 100, 300, false, 90);
ok(leaning.panel.length === 0, "a piece not racked has no front panel");
const lz = leaning.body.flatMap((f) => f.filter((_, i) => i % 3 === 2));
ok(near(Math.max(...lz), 0) && near(Math.min(...lz), -300) && near(leaning.outline[2].y, 100), "leaning back 90°, a piece lies on its back");

const module = equipmentSolid(100, 50, 200, true, 0, 0);
const mx = module.body.flatMap((f) => f.filter((_, i) => i % 3 === 0));
ok(module.panel.length > 0 && near(Math.max(...mx), 50), "a module: a panel and a body as wide, no ears");

// a 4 x 2 frame 3 units tall, one power supply on the left a quarter of a slot wide
const face = frameFront(482.6, 3 * RACK_UNIT, 4, 2, 1, "Left", 25);
const inside = 482.6 - 2 * (25 + 2);
const sw = inside / 4.25;
ok(face.slots.length === 8 && face.psus.length === 1 && near(face.psus[0].x1 - face.psus[0].x0, sw / 4) && near(face.slots[0].x0, face.psus[0].x1), "slots after the power supply");
ok(near(face.slots[0].z1, 3 * RACK_UNIT - 2) && near(face.slots[4].z1, face.slots[0].z0) && near(face.slots[3].x1, 482.6 / 2 - 27), "numbered left to right from the top row");
ok(JSON.stringify(slotRun(4, 2, 3, 2, "Horizontal")) === "[3,4]" && slotRun(4, 2, 4, 2, "Horizontal") === null && JSON.stringify(slotRun(4, 2, 2, 2, "Vertical")) === "[2,6]" && slotRun(4, 2, 6, 2, "Vertical") === null, "runs along a row, down a column");
const span = runRect(face.slots, [2, 6]);
ok(near(span.z0, 2) && near(span.z1, 3 * RACK_UNIT - 2) && near(span.x1 - span.x0, sw), "a run's rectangle");
ok(firstFreeSlot(4, 2, new Set([1, 2]), 2, "Horizontal") === 3 && firstFreeSlot(4, 2, new Set([1, 3]), 2, "Horizontal") === 5 && firstFreeSlot(2, 1, new Set([1]), 2, "Horizontal") === 0, "the first free slot");
const tray = frameSolid("Tray", 482.6, RACK_UNIT, 300, [], true, 0);
const tz = tray.body.flatMap((f) => f.filter((_, i) => i % 3 === 2));
ok(near(Math.max(...tz), RACK_UNIT * 0.25) && tray.door.length > 0 && near(tray.outline[0].y, -6), "a tray: a bottom and low back lip, a door in front, clear of the fronts behind it");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
