// npx tsx src/features/theatre/connectcad/ccadChecks.check.ts
import { CHECK_KINDS, findIssues, grown, issueKey, issueObject, labelAt, letterIndex, letters, renamed, renumberOrder, statusRows, stemOf, type CheckedCircuit, type CheckedDevice } from "./ccadChecks.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const box = (x: number, y: number) => [
  { x, y },
  { x: x + 80, y },
  { x: x + 80, y: y - 40 },
  { x, y: y - 40 },
];
const dev = (id: string, name: string, tag: string, x: number, socketNames: string[] = []): CheckedDevice => ({ id, name, tag, outline: box(x, 0), sockets: socketNames.map((n, i) => ({ id: i + 1, name: n, tip: { x: x + 80, y: -15 - 10 * i } })) });
const circ = (id: string, number: string, a: string, b: string, joined = [true, true]): CheckedCircuit => ({ id, number, sourceJoined: joined[0], destinationJoined: joined[1], sourceSignal: a, destinationSignal: b, source: "DEV1 : OUT1", destination: "DEV2 : IN1", mid: { x: 100, y: -15 } });
const all = new Set(CHECK_KINDS);

// a clean schematic has nothing to mark
ok(findIssues([dev("a", "DEV1", "DEV1", 0, ["OUT1"]), dev("b", "DEV2", "DEV2", 200, ["IN1"])], [circ("c", "V001", "SDI", "SDI")], all, 10).length === 0, "a clean schematic has no issues");

// a socket name twice: an error at each
const twice = findIssues([dev("a", "DEV1", "DEV1", 0, ["OUT1", "OUT1", "OUT2"])], [], all, 10);
ok(twice.length === 2 && twice.every((i) => i.severity === "Error" && i.kind === "Sockets" && i.group === "socket:a:OUT1"), `duplicate socket names (${JSON.stringify(twice.map((i) => i.problem))})`);

// a device name twice: warnings, and its tag twice isn't marked again; a tag twice with different names is a note
const names = findIssues([dev("a", "CAM1", "CAM1", 0), dev("b", "CAM1", "CAM1", 200), dev("c", "CAM2", "X", 400), dev("d", "CAM3", "X", 600)], [], all, 10);
ok(names.filter((i) => i.problem === "Duplicate device name").length === 2 && names.filter((i) => i.problem === "Duplicate display tag").length === 2 && names.filter((i) => i.severity === "Notify").every((i) => i.group === "tag:X"), `device names and tags (${JSON.stringify(names.map((i) => [i.severity, i.problem, i.information]))})`);
ok(findIssues([dev("a", "", "", 0)], [], all, 10)[0]?.problem === "Device has no name", "a device with no name");
// panel devices share their panel's name and tag, and a port is on both their sides; a port twice is marked
const port = (id: string, n: number, x: number): CheckedDevice => ({ ...dev(id, "JA1", "A1", x), ports: [String(n).padStart(2, "0")], sockets: ["L", "R"].map((side, i) => ({ id: i + 1, name: String(n).padStart(2, "0"), tip: { x, y: -15 }, side })) });
const panels = findIssues([port("a", 1, 0), port("b", 2, 200), port("c", 2, 400)], [], all, 10);
ok(panels.length === 2 && panels.every((i) => i.problem === "Duplicate panel port" && i.information === "JA1 port 02"), `panels (${JSON.stringify(panels.map((i) => i.problem))})`);
// adapters share their make and have no name of their own; one off its socket is marked
const adapter = (id: string, onSocket: boolean, x: number): CheckedDevice => ({ ...dev(id, "Adapter", "Adapter", x), adapter: { onSocket } });
const adapters = findIssues([adapter("a", true, 0), adapter("b", false, 200), { ...adapter("c", true, 400), name: "" }], [], all, 10);
ok(adapters.length === 1 && adapters[0].problem === "Adapter is not on a socket" && adapters[0].group === "adapter:b", `adapters (${JSON.stringify(adapters.map((i) => i.problem))})`);

// circuits: a number twice, a loose end, signals that differ; errors first
const circuits = findIssues([], [circ("1", "V001", "SDI", "SDI"), circ("2", "V001", "SDI", "SDI"), circ("3", "V002", "SDI", "HDMI"), circ("4", "", "SDI", "SDI", [true, false]), circ("5", "", "---", "HDMI")], all, 10);
ok(circuits[0].severity === "Error" && /destination/.test(circuits[0].problem), `a loose circuit is an error, listed first (${circuits[0].problem})`);
ok(circuits.filter((i) => i.problem === "Duplicate circuit number").length === 2, "a circuit number twice");
ok(circuits.filter((i) => i.kind === "Signals").length === 1 && circuits.find((i) => i.kind === "Signals")!.severity === "Notify", "signals that differ are a note; a passive socket goes with anything");
ok(findIssues([], [circ("1", "V001", "SDI", "SDI"), circ("2", "V001", "SDI", "HDMI")], new Set(["Signals" as const]), 10).length === 1, "only the checks asked run");

// markup outlines: a box grows square
const g = grown(box(0, 0), 5);
ok(g[0].x === -5 && g[0].y === 5 && g[2].x === 85 && g[2].y === -45, "a box's markup is the box grown");

// the status palette: errors first, ignored ones at the foot, a duplicate's others found
{
  const found = findIssues([dev("a", "CAM1", "C1", 0, ["OUT"]), dev("b", "CAM1", "C2", 200, ["OUT", "OUT"])], [circ("1", "V001", "SDI", "HDMI")], new Set(CHECK_KINDS), 10);
  const rows = statusRows(found, new Set());
  ok(rows[0].issue.severity === "Error" && rows[rows.length - 1].issue.severity === "Notify", "errors first, notes last");
  const dupe = rows.find((r) => r.issue.problem === "Duplicate device name")!;
  ok(dupe.others.length === 2 && issueObject(dupe.issue) === "Device", "a name twice: both devices to step between");
  ok(issueObject(rows[0].issue) === "Socket" && issueObject(rows.find((r) => r.issue.kind === "Signals")!.issue) === "Circuit", "objects named");
  const quiet = statusRows(found, new Set([issueKey(rows[0].issue)]));
  ok(quiet[quiet.length - 1].ignored && quiet[quiet.length - 1].key === rows[0].key && !quiet[0].ignored, "an ignored error goes to the foot");
}

// labels
ok(letters(0) === "A" && letters(25) === "Z" && letters(26) === "AA" && letters(27) === "AB" && letterIndex("AA") === 26 && letterIndex("c") === 2, "letters count on past Z");
ok(labelAt(2, { style: "Numeric", start: "1", increment: 1, digits: 3, upper: true, delimiter: "" }) === "003", "numbers with leading zeros");
ok(labelAt(1, { style: "Numeric", start: "10", increment: 5, digits: 1, upper: true, delimiter: "" }) === "15", "a start and an increment");
ok(labelAt(1, { style: "Alpha", start: "B", increment: 2, digits: 1, upper: false, delimiter: "" }) === "d", "letters, lower case");
ok(stemOf("CAM12") === "CAM" && stemOf("CAM-3") === "CAM" && stemOf("Mixer") === "Mixer", "a name's stem");
ok(renamed("CAM12", "", "01", "-") === "CAM-01" && renamed("CAM12", "VTR", "A", "") === "VTRA" && renamed("7", "", "2", "") === "2", "renamed with the stem or a prefix");
const order = renumberOrder([{ at: { x: 50, y: 0 }, n: "a" }, { at: { x: 0, y: 0 }, n: "b" }, { at: { x: 0, y: -100 }, n: "c" }], "Left to Right, then Down").map((t) => t.n).join("");
ok(order === "bac", `rows from the top, left to right (${order})`);

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
