// npx tsx src/features/theatre/connectcad/labelShapes.check.ts
import { colourDigits, digitInk, fillTemplate, labelMarks, labelPlaces, labelRows, LABEL_FORMATS, pagesFor, RESISTOR_COLOURS, sheetProblems, typeFor, type LabelItem } from "./labelShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

// every format's labels fit its page without overlapping, and its items sit inside its label
for (const f of LABEL_FORMATS) {
  ok(sheetProblems(f).length === 0, `${f.name} fits its page: ${sheetProblems(f).join(", ")}`);
  for (const it of f.items) {
    const right = it.kind === "qr" ? it.x + it.size : it.kind === "color" ? it.x + it.width : it.x;
    const bottom = it.kind === "qr" ? it.y + it.size : it.kind === "color" ? it.y + it.height : it.y + it.size;
    ok(it.x >= 0 && it.y >= 0 && right <= f.labelWidth + 1e-6 && bottom <= f.labelHeight + 1e-6, `${f.name}'s ${it.kind} item inside its label`);
  }
}
const avery = LABEL_FORMATS.find((f) => f.name === "Avery 5160")!;
ok(avery.across * avery.down === 30 && near(avery.pageWidth, 215.9) && near(avery.labelWidth, 66.675) && avery.copies === 2, "Avery 5160: 30 to a Letter sheet, a pair each");

ok(typeFor(["Number", "Signal", "Cable", "Source Device"]) === "Cable" && typeFor(["Rack U", "Mounting"]) === "Equipment" && typeFor(["Device Name", "Display Tag"]) === "Device" && typeFor(["Channel", "Unit Number"]) === "Lighting Device", "a worksheet's label type by its header");
ok(fillTemplate("From {4} : {5}", ["1", "", "", "CAM1", "SDI OUT"]) === "From CAM1 : SDI OUT" && fillTemplate("{9}!", ["a"]) === "!", "templates fill from columns");
ok(labelRows([["Number"], ["A1"], ["", ""], ["A2"]], 1).map((r) => r[0]).join() === "A1,A2", "rows past the header, empty ones skipped");

// 5 rows, 2 copies each, on a 3 × 2 sheet: 10 labels, 2 pages; copies side by side
const s = { pageWidth: 100, pageHeight: 60, across: 3, down: 2, offsetX: 1, offsetY: 0, left: 5, top: 10, labelWidth: 28, labelHeight: 20, hPitch: 30, vPitch: 22, copies: 2 };
const places = labelPlaces(s, 5);
ok(places.length === 10 && pagesFor(s, 5) === 2 && pagesFor(s, 0) === 1, "10 labels on 2 pages");
ok(places[0].row === 0 && places[1].row === 0 && places[2].row === 1 && near(places[1].x, 36) && near(places[3].y, 32) && places[6].page === 1 && near(places[6].x, 6) && near(places[6].y, 10), "laid across then down, copies together, the next page from its top left");
ok(sheetProblems({ ...s, across: 4 }).join() === "the labels run off the page" && sheetProblems({ ...s, hPitch: 20 }).some((p) => /overlap/.test(p)), "sheets that don't fit");

ok(colourDigits("C-0457", 3) === "457" && colourDigits("12", 3) === "012" && colourDigits("none", 3) === "", "colour-coded digits");
ok(RESISTOR_COLOURS[0] === "#000000" && RESISTOR_COLOURS[9] === "#ffffff" && digitInk(0) === "#ffffff" && digitInk(4) === "#000000", "resistor colours and their inks");

const items: LabelItem[] = [
  { kind: "text", x: 2, y: 2, size: 5, text: "{1}", align: "left", bold: true },
  { kind: "text", x: 2, y: 9, size: 2, text: "{8}", align: "left", bold: false },
  { kind: "qr", x: 40, y: 2, size: 20, column: 1 },
  { kind: "color", x: 2, y: 15, width: 15, height: 5, column: 1, digits: 3 },
];
const marks = labelMarks(items, ["C102", "SDI"]);
ok(marks[0].kind === "text" && marks[0].text === "C102" && marks[0].bold, "the number's text");
ok(!marks.some((m) => m.kind === "text" && m.text === ""), "empty text left out");
const qr = marks.find((m) => m.kind === "qr");
ok(!!qr && qr.kind === "qr" && qr.back.every((p) => p.x >= 40 - 1e-6 && p.x <= 60 + 1e-6 && p.y >= 2 - 1e-6 && p.y <= 22 + 1e-6) && qr.dark.length > 10, "the QR code in its square");
const boxes = marks.filter((m) => m.kind === "box");
ok(boxes.length === 3 && boxes.every((b) => b.kind === "box" && near(b.x1 - b.x0, 5)) && boxes.map((b) => (b.kind === "box" ? b.fill : "")).join() === [RESISTOR_COLOURS[1], RESISTOR_COLOURS[0], RESISTOR_COLOURS[2]].join(), "1, 0, 2 in brown, black, red");
ok(labelMarks(items, ["", ""]).length === 0, "an empty row draws nothing");

console.log(failed ? `${failed} failed` : "all passed");
