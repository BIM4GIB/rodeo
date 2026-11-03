// npx tsx src/features/theatre/connectcad/legendShapes.check.ts
import { signalInk } from "./ccadShapes.ts";
import { legendLayout, legendRows } from "./legendShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const rows = legendRows(["Analog Audio", "SDI", "SDI", "Made Up", "HDMI", "SDI"]);
ok(rows.map((r) => `${r.signal}:${r.count}`).join() === "SDI:3,HDMI:1,Analog Audio:1,Made Up:1", "each signal once with its count, in the list's order, others last");
ok(rows[0].ink === signalInk("SDI") && rows[0].letter === "V" && rows[3].letter === "X", "each with its colour and letter");
ok(legendRows([]).length === 0, "no circuits, no rows");

const at48 = legendLayout("Signal Legend", rows, true, 48);
const at1 = legendLayout("Signal Legend", rows, true, 1);
ok(Math.abs(at48.width - 48 * at1.width) < 1e-6 && Math.abs(at48.height - 48 * at1.height) < 1e-6, "sized on paper, scaled by the layer");
ok(at1.rows.length === 4 && at1.rows[0].from.x < at1.rows[0].to.x && at1.rows[0].to.x < at1.rows[0].name.x && at1.rows[0].name.x < at1.rows[0].count.x, "sample, name, count across");
ok(at1.rows[1].from.y < at1.rows[0].from.y && at1.title.y > at1.rows[0].from.y && at1.rows[3].from.y > -at1.height, "the title above the rows, all inside");
const noCount = legendLayout("Signal Legend", rows, false, 1);
ok(noCount.width <= at1.width, "no count, no wider");
ok(legendLayout("A very long legend title indeed", [], true, 1).width > legendLayout("Key", [], true, 1).width && legendLayout("Key", [], true, 1).height > 0, "wide enough for its title; one row's room when empty");

console.log(failed ? `${failed} failed` : "all passed");
