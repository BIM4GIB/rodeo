// Checks for schedules.ts, with each expected figure worked out by hand in the comments. Run with:
//   npx tsx src/features/theatre/paperwork/schedules.check.ts

import assert from "node:assert/strict";
import type { NewSheetCell } from "../../../core/index.ts";
import { fixtureType, type Fixture } from "../fixture.ts";
import {
  colorCutSheet,
  columnWidths,
  defaultFormat,
  headerRow,
  paperSheet,
  ROW_HEIGHT,
  scheduleOrder,
  scheduleSheet,
  shopOrderSheet,
  type PaperworkPage,
} from "./schedules.ts";

/** An instrument as readFixtures makes one from a catalogue type, with `over` set. */
function fx(id: string, type: string, over: Partial<Fixture> = {}): Fixture {
  const t = fixtureType(type)!;
  return {
    id,
    layerId: "layer",
    classIndex: 0,
    native: true,
    at: { x: 0, y: 0 },
    type: t.key,
    label: t.label,
    glyph: t.glyph,
    position: "",
    unit: "",
    channel: "",
    universe: 0,
    address: 0,
    footprint: t.footprint,
    dimmer: "",
    circuit: "",
    color: "",
    gobo: "",
    purpose: "",
    accessory: "",
    notes: "",
    watts: t.watts,
    weightKg: t.weightKg,
    beamDeg: t.beamDeg,
    fieldDeg: t.fieldDeg,
    lumens: t.lumens,
    heightMm: 6000,
    focus: null,
    aimDeg: -90,
    ...over,
  };
}

const texts = (row: readonly (NewSheetCell | null)[]): string[] => row.map((c) => (c ? String(c.value) : ""));
const info = { designer: "A. Designer", event: "Test Show", date: "4 November 2026" };
const paper = (heightPt = 1000): PaperworkPage => ({ header: { left: "designer", center: "event", right: "date" }, info, page: { widthPt: 540, heightPt } });

const list = [
  fx("a", "profile26", { position: "2nd Electric", unit: "1", channel: "10", dimmer: "5" }),
  fx("b", "profile26", { position: "1st Electric", unit: "10", channel: "2", dimmer: "" }),
  fx("c", "fresnel650", { position: "1st Electric", unit: "2", channel: "", dimmer: "12" }),
  fx("d", "fresnel650", { position: "", unit: "", channel: "2", dimmer: "3" }),
];

// Instrument Schedule: by position (1st, 2nd, then the blank), unit in natural order (2 before 10).
assert.deepEqual(
  scheduleOrder("instrument", list).map((f) => f.id),
  ["c", "b", "a", "d"],
);
// Channel Hookup: 2 (b on 1st Electric before d with no position), 10, then c with no channel.
assert.deepEqual(
  scheduleOrder("channel", list).map((f) => f.id),
  ["b", "d", "a", "c"],
);
// Dimmer Hookup: 3, 5, 12; b has no dimmer and is left out.
assert.deepEqual(
  scheduleOrder("dimmer", list).map((f) => f.id),
  ["d", "a", "c"],
);

// Widths share the page: wide 3, medium 2, narrow 1. 3 + 2 + 1 = 6 parts of 540 pt: 270, 180, 90.
assert.deepEqual(columnWidths(["wide", "medium", "narrow"], 540), [270, 180, 90]);

// The header line: left in the first column, centre in the middle ((5 - 1) / 2 = 2) and right in the last.
assert.deepEqual(texts(headerRow(5, paper().header, info)!), ["A. Designer", "", "Test Show", "", "4 November 2026"]);
// One column: all three share it. Nothing chosen: no header line.
assert.deepEqual(texts(headerRow(1, paper().header, info)!), ["A. Designer   Test Show   4 November 2026"]);
assert.equal(headerRow(3, { left: "", center: "", right: "" }, info), null);
// A place whose text is blank shows nothing: the designer left out.
assert.deepEqual(texts(headerRow(3, paper().header, { ...info, designer: " " })!), ["", "Test Show", "4 November 2026"]);

// A Channel Hookup with three columns: header line, printed name, blank row, heads, then the rows.
{
  const format = { ...defaultFormat("channel"), columns: [{ field: "channel" as const, width: "narrow" as const }, { field: "position" as const, width: "wide" as const }, { field: "watts" as const, width: "narrow" as const }] };
  const sheet = scheduleSheet("Channel Hookup", "channel", list, format, paper());
  assert.equal(sheet.name, "Channel Hookup");
  assert.equal(sheet.rowHeight, ROW_HEIGHT);
  // 1 + 3 + 1 = 5 parts: 108, 324, 108
  assert.deepEqual(sheet.widths, [108, 324, 108]);
  assert.deepEqual(sheet.rows.map(texts), [
    ["A. Designer", "Test Show", "4 November 2026"],
    ["Channel Hookup"],
    [],
    ["Channel", "Position", "Wattage"],
    ["2", "1st Electric", "750"],
    ["2", "", "650"],
    ["10", "2nd Electric", "750"],
    ["", "1st Electric", "650"],
  ]);
  assert.equal(sheet.rows[3][0]?.bold, true);
  assert.equal(sheet.rows[4][2]?.align, "right");
}

// Pages: 98 pt high takes 98 / 14 = 7 rows; the top is 4 (header, name, blank, heads), so 3 instruments a page.
// 4 instruments: page 1 has 3, page 2 repeats the top and has the last: 4 + 3 + 4 + 1 = 12 rows.
{
  const sheet = scheduleSheet("Instrument Schedule", "instrument", list, defaultFormat("instrument"), paper(98));
  assert.equal(sheet.rows.length, 12);
  assert.deepEqual(texts(sheet.rows[7]), texts(sheet.rows[0]));
  assert.deepEqual(texts(sheet.rows[10]), texts(sheet.rows[3]));
  assert.equal(sheet.rows[11][0], null); // d has no position
}

// A printed name changed in Schedule Formatting heads the sheet; the worksheet keeps the schedule's name.
{
  const sheet = scheduleSheet("Dimmer Hookup", "dimmer", list, { ...defaultFormat("dimmer"), printed: "Dimmers, Act 1" }, paper());
  assert.equal(sheet.name, "Dimmer Hookup");
  assert.deepEqual(texts(sheet.rows[1]), ["Dimmers, Act 1"]);
}

// An empty schedule still has its top.
assert.equal(paperSheet("X", "X", [{ value: "A" }], [], ["wide"], paper()).rows.length, 4);

// Color Cut List by position. 1st Electric: two profiles in L201 (6.25 in frames, 9 a sheet): 2 cuts, 1 sheet.
// 2nd Electric: a fresnel in R80 (8 in frames, 6 a sheet): 1 cut, 1 sheet. Positions part by a blank row.
{
  const cuts = [
    fx("p", "profile26", { position: "1st Electric", color: "L201" }),
    fx("q", "profile26", { position: "1st Electric", color: "L201" }),
    fx("r", "fresnel650", { position: "2nd Electric", color: "R80" }),
  ];
  const byPosition = colorCutSheet("Color Cut List", cuts, true, paper());
  assert.deepEqual(byPosition.rows.slice(4).map(texts), [["1st Electric"], ["L201", "Full CT Blue", '6.25"', "2", "1"], [], ["2nd Electric"], ["R80", texts(byPosition.rows[8])[1], '8"', "1", "1"]]);
  const whole = colorCutSheet("Color Cut List", cuts, false, paper());
  assert.equal(whole.rows.length, 4 + 2);
}

// Shop Order: two Profile 26° at 750 W and 7.7 kg (1500 W, 15.4 kg), a Fresnel 650 W at 4.5 kg; totals 3, 2150 W, 19.9 kg.
{
  const sheet = shopOrderSheet("Shop Order", [fx("a", "profile26"), fx("b", "profile26"), fx("c", "fresnel650")], paper());
  const body = sheet.rows.slice(4).map(texts);
  assert.deepEqual(body[0], ["Fresnel 650 W", "1", "650", "650", "4.5", "4.5"]);
  assert.deepEqual(body[1], ["Profile 26°", "2", "750", "1500", "7.7", "15.4"]);
  assert.deepEqual(body[3], ["Total", "3", "", "2150", "", "19.9"]);
}

console.log("schedules.check: all passed");
