// npx tsx src/features/theatre/connectcad/rackElevationShapes.check.ts
import type { Pt } from "../../../core/index.ts";
import { RACK_UNIT } from "../../../app/rackRulerShapes.ts";
import { detailScale, equipmentDetail, rackElevation, rackRows, viewNames, type PickedRack, type RowRack } from "./rackElevationShapes.ts";
import type { RackSize } from "./rackShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** a 600 wide, 900 deep rack with its front's middle at (x, y), facing `angle` */
const picked = (id: string, x: number, y: number, angle = 0): PickedRack => {
  const t = (angle * Math.PI) / 180;
  const at: Pt = { x, y };
  const ring = [
    { x: -300, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 900 },
    { x: -300, y: 900 },
  ].map((q) => ({ x: x + q.x * Math.cos(t) - q.y * Math.sin(t), y: y + q.x * Math.sin(t) + q.y * Math.cos(t) }));
  return { id, ring, at, angle };
};

// rows: side by side and facing the same way, left to right seen from the front
const rows = rackRows([picked("B", 600, 0), picked("A", 0, 0), picked("C", 3000, 0)]);
ok(rows.length === 2, `two rows (${rows.length})`);
ok(rows[0].map((r) => r.id).join() === "A,B" && near(rows[0][0].offset, -600) && near(rows[0][1].offset, 0), `A then B along the row (${JSON.stringify(rows[0])})`);
ok(rows[1].length === 1 && rows[1][0].id === "C", "a rack away from the row is its own");
const facing = rackRows([picked("A", 0, 0), picked("B", 600, 0, 180)]);
ok(facing.length === 2, "side by side but facing the other way: apart");
const turned = rackRows([picked("A", 0, 0, 90), picked("B", 0, 600, 90)]);
ok(turned.length === 1 && turned[0].map((r) => r.id).join() === "A,B" && near(turned[0][1].offset, 600), `turned a quarter, along its own across (${JSON.stringify(turned)})`);
const chain = rackRows([picked("A", 0, 0), picked("C", 1200, 0), picked("B", 600, 0)]);
ok(chain.length === 1 && chain[0].map((r) => r.id).join() === "A,B,C", "joined through the rack between, picked last");

const rack: RackSize = { style: "Rack (4-post)", units: 42, enclosureHeight: 2000, opening: 482.6, depth: 800, postWidth: 58.7, postDepth: 50, top: 50, base: 100, slope: 20, panel: 20 };
const H = 42 * RACK_UNIT + 150;
const u40 = { z0: 100 + 39 * RACK_UNIT, z1: 100 + 40 * RACK_UNIT };
const one: RowRack = { rackId: "R1", size: rack, rails: true, offset: 0, pieces: [{ kind: "item", name: "SW1", x0: -241.3, x1: 241.3, ...u40 }, { kind: "item", name: "HALF", x0: -241.3, x1: 0, z0: 100, z1: 100 + RACK_UNIT }] };
const text = 50;
const front = rackElevation([one], "Front", text);
const r1 = front.racks[0];
ok(r1.rects.filter((q) => q.part === "frame").length === 4 && r1.rects.filter((q) => q.part === "rail").length === 2, "a 4-post rack: base, top, two posts, two rails");
ok(r1.rects.some((q) => q.part === "frame" && near(q.x0, -300) && near(q.x1, 300) && near(q.z0, H - 50) && near(q.z1, H)), "its top");
ok(r1.rects.some((q) => q.part === "item" && near(q.x0, -241.3) && near(q.z0, u40.z0)), "SW1 at unit 40");
const numbers = r1.texts.filter((t) => /^\d+$/.test(t.text));
ok(numbers.length === 42 && numbers.every((t) => near(t.at.x, (-300 + -221.3) / 2)) && near(numbers[0].at.y, 100 + RACK_UNIT / 2), `unit numbers up the left post and rail (${numbers.length}, ${numbers[0]?.at.x})`);
ok(numbers.every((t) => t.height <= 0.6 * RACK_UNIT + 1e-9), "unit numbers fit a unit");
const sw1 = r1.texts.find((t) => t.text === "SW1");
ok(!!sw1 && near(sw1.at.x, 0) && near(sw1.height, 0.6 * RACK_UNIT), `SW1's name in its middle, as high as the unit lets it (${sw1?.height})`);
const id = r1.texts.find((t) => t.text === "R1");
ok(!!id && id.at.y < 0 && near(id.height, 1.25 * text), "the Rack ID below");
ok(near(front.box.x0, -300) && near(front.box.x1, 300) && near(front.box.y1, H) && near(front.box.y0, -1.75 * 1.25 * text), `the box (${JSON.stringify(front.box)})`);

// from behind, mirrored: the half-width item on the front's left is on the right
const rear = rackElevation([one], "Rear", text);
const half = rear.racks[0].rects.find((q) => q.part === "item" && near(q.z0, 100));
ok(!!half && near(half.x0, 0) && near(half.x1, 241.3), `mirrored from behind (${JSON.stringify(half)})`);
const rearNumbers = rear.racks[0].texts.filter((t) => /^\d+$/.test(t.text));
ok(rearNumbers.every((t) => near(t.at.x, (-300 + -221.3) / 2)), "unit numbers still on the left as seen");

// a row: from the front the second to the right, from behind to the left
const two = rackElevation([one, { ...one, rackId: "R2", offset: 600, pieces: [] }], "Front", text);
ok(near(two.box.x1, 900) && two.racks[1].texts.some((t) => t.text === "R2" && near(t.at.x, 600)), "R2 to the right from the front");
const twoRear = rackElevation([one, { ...one, rackId: "R2", offset: 600, pieces: [] }], "Rear", text);
ok(near(twoRear.box.x0, -900) && twoRear.racks[1].texts.some((t) => t.text === "R2" && near(t.at.x, -600)), "and to the left from behind");

// a long name shrinks to fit across
const long = rackElevation([{ ...one, pieces: [{ kind: "item", name: "A VERY LONG EQUIPMENT NAME INDEED", x0: -100, x1: 100, ...u40 }] }], "Front", text);
const lt = long.racks[0].texts.find((t) => t.text.startsWith("A VERY"));
ok(!!lt && lt.height * 0.6 * lt.text.length <= 0.9 * 200 + 1e-9, "a long name narrowed to fit");

// slots aren't named; a frame's power supply is
const framed = rackElevation([{ ...one, pieces: [{ kind: "module", name: "M1", x0: -50, x1: 0, ...u40 }, { kind: "frame", name: "F1", x0: -241.3, x1: 241.3, ...u40 }, { kind: "slot", name: "", x0: -50, x1: 0, ...u40 }, { kind: "psu", name: "PSU", x0: -200, x1: -150, ...u40 }] }], "Front", text);
const order = framed.racks[0].rects.filter((q) => q.part !== "frame" && q.part !== "rail").map((q) => q.part);
ok(order.join() === "frame-item,psu,slot,module", `the frame first, its module last (${order.join()})`);
ok(framed.racks[0].texts.some((t) => t.text === "M1") && framed.racks[0].texts.some((t) => t.text === "PSU") && !framed.racks[0].texts.some((t) => t.text === "F1"), "the module and power supply named, not the frame over them");

// a console from the front: its base, cladding and top round the sloping face; from behind, its back
const consoleK: RackSize = { ...rack, style: "Console", units: 10, panel: 25, top: 50, base: 700 };
const cf = rackElevation([{ ...one, size: consoleK, pieces: [] }], "Front", text);
ok(cf.racks[0].rects.length === 4 && !cf.racks[0].texts.some((t) => /^\d+$/.test(t.text)), "a console: four pieces, no unit numbers");
const cr = rackElevation([{ ...one, size: consoleK, pieces: [] }], "Rear", text);
ok(cr.racks[0].rects.length === 1, "a console's back");
const enclosure = rackElevation([{ ...one, size: { ...rack, style: "Enclosure" }, pieces: [] }], "Front", text);
ok(!enclosure.racks[0].rects.some((q) => q.part === "rail") && !enclosure.racks[0].texts.some((t) => /^\d+$/.test(t.text)), "an enclosure: no rails or unit numbers");

// a detail view: the panel, its ears unnamed, a frame's modules named but not the frame, the name below
const detail = equipmentDetail("AMP1", [{ kind: "ear", name: "", x0: -241.3, x1: -216.3, z0: 0, z1: 88.9 }, { kind: "item", name: "AMP1", x0: -241.3, x1: 241.3, z0: 0, z1: 88.9 }, { kind: "ear", name: "", x0: 216.3, x1: 241.3, z0: 0, z1: 88.9 }], 17.5);
const dr = detail.racks[0];
ok(dr.rects.map((q) => q.part).join() === "item,ear,ear", `the panel under its ears (${dr.rects.map((q) => q.part).join()})`);
ok(dr.texts.length === 2 && dr.texts[0].text === "AMP1" && near(dr.texts[0].at.y, 44.45) && dr.texts[1].text === "AMP1" && dr.texts[1].at.y < 0, "named on its face and below");
ok(near(detail.box.x0, -241.3) && near(detail.box.x1, 241.3) && near(detail.box.y1, 88.9) && near(detail.box.y0, -1.75 * 1.25 * 17.5), `its box (${JSON.stringify(detail.box)})`);
const frameDetail = equipmentDetail("F1", [{ kind: "frame", name: "F1", x0: -241.3, x1: 241.3, z0: 0, z1: 133.35 }, { kind: "module", name: "C1", x0: -100, x1: -50, z0: 2, z1: 130 }], 17.5);
ok(frameDetail.racks[0].texts.map((x) => x.text).join() === "C1,F1", "a frame: its module named on it, its own name below only");
ok(detailScale(482.6, 88.9) === 5 && detailScale(100, 44.45) === 1 && detailScale(2000, 600) === 20 && detailScale(1e6, 1) === 50, "detail scales: 1:5 for 19-inch gear, 1:1 for a small piece, the largest that fits");

// names
ok(viewNames("R1", ["Front", "Rear"], new Set()).join() === "R1/F,R1/R", "R1/F and R1/R");
ok(viewNames("R1", ["Front", "Rear"], new Set(["R1/R"])).join() === "R1 2/F,R1 2/R", "taken: numbered");
ok(viewNames("R1", ["Rear"], new Set(["R1/F"])).join() === "R1/R", "only the rear asked for");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
