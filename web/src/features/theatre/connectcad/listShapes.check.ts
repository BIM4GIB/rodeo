// npx tsx src/features/theatre/connectcad/listShapes.check.ts
import { checkedRows, checkText, compareList, delimiterOf, endKey, listCircuits, listHeader, type DrawnCircuit } from "./listShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

// a circuit report as Rodeo writes it, a title row above
const rows = [
  ["Cable list", "", ""],
  ["Number", "Signal", "Cable", "Source Device", "Source Socket", "Destination Device", "Destination Socket", "Cable Length", "Circuit Type"],
  ["V001", "SDI", "", "CAM1", "OUT1", "SW1", "IN1", "", "Polyline"],
  ["V002", "SDI", "", "CAM2", "OUT1", "SW1", "IN2", "", "Polyline"],
  ["V003", "SDI", "", "SW1", "OUT1", "MON1", "IN1", "", "Arrow"],
  ["", "", "", "", "", "", "", "", ""],
  ["V009", "SDI", "", "CAM9", "OUT1", "SW1", "IN9", "", "Polyline"],
];
const found = listHeader(rows);
ok(found !== null && found.header === 1 && found.columns.number === 0 && found.columns.sourceDevice === 3 && found.columns.destinationSocket === 6 && found.columns.cable === 2, `the header row and its columns (${JSON.stringify(found)})`);
ok(listHeader([["From", "Src Port", "To", "Dest Port", "No."]])?.columns.sourceSocket === 1 && listHeader([["From", "Src Port", "To", "Dest Port", "No."]])?.columns.number === 4, "other headings near enough");
ok(listHeader([["Device", "Socket"]]) === null, "no list without both ends");
const list = listCircuits(rows, found!.header, found!.columns);
ok(list.length === 4 && list[0].row === 2 && list[3].row === 6 && list[1].source.device === "CAM2", "a circuit for each row naming both devices");

const mid = { x: 0, y: 0 };
const drawn: DrawnCircuit[] = [
  { id: "a", number: "V001", source: { device: "cam1", socket: "OUT1" }, destination: { device: "SW1", socket: "in1" }, mid },
  // drawn the other way round, and numbered differently
  { id: "b", number: "V020", source: { device: "SW1", socket: "IN2" }, destination: { device: "CAM2", socket: "OUT1" }, mid },
  { id: "c", number: "V004", source: { device: "SW1", socket: "OUT2" }, destination: { device: "MON2", socket: "IN1" }, mid },
];
const present = new Set(["CAM1\nOUT1", "SW1\nIN1", "CAM2\nOUT1", "SW1\nIN2", "SW1\nOUT1", "MON1\nIN1"].map((k) => k.toLowerCase()));
const r = compareList(list, drawn, (e) => present.has(endKey(e)));
ok(r.checks.map((c) => c.kind).join() === "ok,number,missing,absent", `checks (${JSON.stringify(r.checks)})`);
ok(r.checks[1].kind === "number" && r.checks[1].drawn === "V020", "the drawing's number given");
ok(r.unlisted.map((c) => c.id).join() === "c", "the drawing's circuit not in the list");
ok(checkText(r.checks[3]) === "Not on the drawing: CAM9 : OUT1 isn't on the layer", checkText(r.checks[3]));

// two circuits between the same sockets pair up by number
const twice = compareList(
  [
    { row: 0, number: "", cable: "", source: { device: "A", socket: "1" }, destination: { device: "B", socket: "1" } },
    { row: 1, number: "X2", cable: "", source: { device: "A", socket: "1" }, destination: { device: "B", socket: "1" } },
  ],
  [
    { id: "p", number: "X2", source: { device: "A", socket: "1" }, destination: { device: "B", socket: "1" }, mid },
    { id: "q", number: "X1", source: { device: "A", socket: "1" }, destination: { device: "B", socket: "1" }, mid },
  ],
  () => true,
);
ok(twice.checks[1].kind === "ok" && (twice.checks[1] as { id: string }).id === "p" && twice.checks[0].kind === "ok" && (twice.checks[0] as { id: string }).id === "q", "a row with no number takes the other circuit, and doesn't differ");

const checked = checkedRows(rows, found!.header, list, r.checks);
ok(checked[1][9] === "Check" && checked[2][9] === "OK" && checked[3][9].startsWith("Number differs") && checked[0][9] === "" && checked[0].length === 10 && checked[5][9] === "", "a Check column after the last");

ok(delimiterOf("a;b;c\n1;2;3") === ";" && delimiterOf("a\tb\n") === "\t" && delimiterOf("a,b") === "," && delimiterOf("one") === ",", "delimiters");

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
