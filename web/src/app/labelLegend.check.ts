// npx tsx src/app/labelLegend.check.ts
import { cleanBook, freeLegendName, labelSummary } from "../features/theatre/devices/legendBook.ts";
import { labelSize, layoutLegend, type LegendItem } from "./labelLegend.ts";
import { lightingDevice } from "./lightingDeviceShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const reach = { front: 300, back: -200, half: 150 };
const DOWN = -Math.PI / 2;
const item = (text: string, spot: LegendItem["spot"], box: LegendItem["box"] = "none", rightReading = true, height = 100): LegendItem => ({ text, spot, box, rightReading, height });
const gap = 40;

// aimed down the page: a channel in a circle in front, centred below the body
{
  const d = layoutLegend([item("12", "front", "circle")], reach, DOWN, false);
  const size = labelSize("12", "circle", 100);
  ok(d.texts.length === 1 && d.outlines.length === 1, "one text in one container");
  ok(near(d.texts[0].at.x, 0) && near(d.texts[0].at.y, -(300 + gap + size.h / 2)), `in front, clear of the body: ${JSON.stringify(d.texts[0].at)}`);
  ok(d.texts[0].angle === undefined && d.texts[0].justify === "centre", "level and centred");
  const ys = d.outlines[0].map((p) => p.y);
  ok(near(Math.max(...ys), -(300 + gap)), "the circle stops a gap short of the body's front");
}

// aimed right: a level label in front runs its length clear of the body
{
  const d = layoutLegend([item("ABCDEFGH", "front")], reach, 0, false);
  ok(near(d.texts[0].at.x, 300 + gap + 240) && near(d.texts[0].at.y, 0), `a level label in front of a device aimed right: ${JSON.stringify(d.texts[0].at)}`);
  ok(d.texts[0].angle === undefined, "still level");
  const r = layoutLegend([item("ABCDEFGH", "front", "none", false)], reach, 0, false);
  ok(near(r.texts[0].at.x, 300 + gap + 50) && r.texts[0].angle === 90, `one that turns with it reads up the page, its height clear: ${JSON.stringify(r.texts[0])}`);
}

// aimed up the page, a label that turns with the device isn't upside down
{
  const d = layoutLegend([item("A1", "back", "none", false)], reach, Math.PI / 2, false);
  ok(d.texts[0].angle === undefined || near(d.texts[0].angle, 0), `aimed up, level not upside down: ${d.texts[0].angle}`);
  ok(near(d.texts[0].at.y, -(200 + gap + 50)), `the back is below a device aimed up: ${JSON.stringify(d.texts[0].at)}`);
}

// labels at one spot stack outward in order; on the body they're centred on it
{
  const d = layoutLegend([item("1", "front"), item("2", "front")], reach, DOWN, false);
  ok(d.texts[0].text === "1" && near(d.texts[0].at.y, -(300 + gap + 50)) && near(d.texts[1].at.y, -(300 + gap + 100 + gap + 50)), `stacked: ${d.texts.map((t) => t.at.y)}`);
  const b = layoutLegend([item("U1", "body"), item("U2", "body")], reach, DOWN, false);
  const mid = (-300 + 200) / 2;
  ok(near((b.texts[0].at.y + b.texts[1].at.y) / 2, mid) && b.texts[0].at.y > b.texts[1].at.y, `on the body, the first above, centred on it: ${b.texts.map((t) => t.at.y)}`);
}

// the sides and corners, as a device aimed down the page shows them
{
  const d = layoutLegend([item("L", "left"), item("R", "right"), item("FR", "frontRight"), item("BL", "backLeft")], reach, DOWN, false);
  const at = (t: string) => d.texts.find((x) => x.text === t)!.at;
  ok(at("L").x < -150 && near(at("L").y, -50), `left of the body: ${JSON.stringify(at("L"))}`);
  ok(at("R").x > 150 && near(at("R").y, -50), `right of it: ${JSON.stringify(at("R"))}`);
  ok(at("FR").x > 150 && at("FR").y < -300, `front right corner: ${JSON.stringify(at("FR"))}`);
  ok(at("BL").x < -150 && at("BL").y > 200, `back left corner: ${JSON.stringify(at("BL"))}`);
}

// Non-Rotating: as aimed down the page whatever the aim, round the body's reach
{
  const a = layoutLegend([item("12", "front")], reach, 0.7, true);
  ok(near(a.texts[0].at.x, 0) && near(a.texts[0].at.y, -(300 + gap + 50)) && a.texts[0].angle === undefined, `stays below, level: ${JSON.stringify(a.texts[0])}`);
  const b = layoutLegend([item("12", "right", "none", false)], reach, 2.1, true);
  ok(near(b.texts[0].at.x, 300 + gap + labelSize("12", "none", 100).w / 2) && b.texts[0].angle === undefined, `right of its reach, level: ${JSON.stringify(b.texts[0])}`);
}

// blank labels are left out; each container is closed round its text
{
  const d = layoutLegend([item(" ", "front"), item("", "back", "circle"), item("7", "right", "rectangle"), item("G", "left", "hexagon"), item("D", "back", "diamond"), item("O", "body", "oval")], reach, DOWN, false);
  ok(d.texts.length === 4 && d.outlines.length === 4, `blanks dropped: ${d.texts.length} texts, ${d.outlines.length} containers`);
  ok(d.outlines.map((o) => o.length).join() === "4,6,4,32", `rectangle, hexagon, diamond, oval: ${d.outlines.map((o) => o.length)}`);
  for (const [i, t] of d.texts.entries()) {
    const o = d.outlines[i];
    const xs = o.map((p) => p.x);
    const ys = o.map((p) => p.y);
    ok(t.at.x > Math.min(...xs) && t.at.x < Math.max(...xs) && t.at.y > Math.min(...ys) && t.at.y < Math.max(...ys), `${t.text}'s container round it`);
  }
}

// a device drawn with a legend shows its labels in place of Rodeo's own
{
  const labels = { channel: "5", unit: "3", color: "R02", purpose: "wash" };
  const own = lightingDevice("fresnel", 1, labels, 100, DOWN);
  const legend = lightingDevice("fresnel", 1, labels, 100, DOWN, undefined, { items: [item("5", "back", "rectangle"), item("R02", "front")], nonRotating: false });
  ok(own.texts.length === 4 && own.circles.length > legend.circles.length, "Rodeo's own: four labels and the channel's bubble");
  ok(legend.texts.map((t) => t.text).join() === "5,R02" && legend.outlines.length === own.outlines.length + 1, `the legend's two, the rectangle among the outlines: ${legend.texts.map((t) => t.text)}`);
}

// a saved book made safe
{
  const b = cleanBook({
    active: "Gone",
    legends: [
      { name: " A ", nonRotating: true, labels: [{ field: "channel", spot: "front", box: "circle", rightReading: true, size: 120 }, { field: "channel", spot: "back" }, { field: "nope" }, { field: "color", spot: "up", box: "star", size: -3 }] },
      { name: "A", labels: [] },
      { name: "", labels: [] },
      { name: "B" },
    ],
  });
  ok(b.legends.map((l) => l.name).join() === "A,B", `names trimmed, blank and repeated ones dropped: ${b.legends.map((l) => l.name)}`);
  ok(b.active === "", "an active legend that isn't there falls back to Rodeo's own");
  const a = b.legends[0];
  ok(a.nonRotating && a.labels.length === 2 && a.labels[0].size === 120, `a field once, unknown ones dropped: ${JSON.stringify(a.labels)}`);
  ok(a.labels[1].spot === "right" && a.labels[1].box === "none" && a.labels[1].size === 100 && a.labels[1].rightReading, "unknown spots, containers and sizes defaulted");
  ok(cleanBook({ active: "B", legends: [{ name: "B", labels: [] }] }).active === "B", "an active one that's there stays");
  ok(cleanBook(null).legends.length === 0 && cleanBook("x").active === "", "nothing saved is no legends");
  ok(freeLegendName("Legend", ["Legend", "Legend 2"]) === "Legend 3" && freeLegendName("New", ["Legend"]) === "New", "free names");
  ok(labelSummary(a) === "Channel, Color" && labelSummary(b.legends[1]) === "No labels", "summaries");
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
