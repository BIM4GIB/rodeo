// npx tsx src/features/theatre/connectcad/ccadReports.check.ts
import { cablePullRows, circuitRows, connectionRows, deviceRows, freeName, natural, partRows, RACK_COLUMNS, rackRows, reportSheet, type RackEntry, type ReportCircuit, type ReportDevice, type ReportRow } from "./ccadReports.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const values = (r: ReportRow): (string | number | null)[] => r.map((c) => c?.value ?? null);
const circ = (number: string, from: string, to: string, layer = "Schematic"): ReportCircuit => ({
  layer,
  number,
  signal: "SDI",
  cable: "",
  type: "Polyline",
  length: number === "V2" ? "5m" : "",
  calculated: number === "V2" ? "" : "3.25 m",
  sourceDevice: from.split(":")[0],
  sourceSocket: from.split(":")[1],
  destinationDevice: to.split(":")[0],
  destinationSocket: to.split(":")[1],
});
const dev = (name: string, description: string, power: number, sockets: ReportDevice["sockets"] = []): ReportDevice => ({
  layer: "Schematic",
  name,
  tag: name,
  description,
  maker: "Acme",
  power,
  btu: power * 3.41,
  weight: 1.5,
  ru: 1,
  room: "",
  rack: "",
  sockets,
});

ok(natural("DEV2", "DEV10") < 0 && natural("C9", "C10") < 0, "names with numbers sort counting");

// circuits by number, unnumbered last; the all-layers report has a Layer column first
const rows = circuitRows([circ("", "DEV1:OUT3", "DEV2:IN3"), circ("V10", "DEV1:OUT2", "DEV2:IN2"), circ("V2", "DEV1:OUT1", "DEV2:IN1")], false);
ok(rows.length === 4 && rows[0][0]?.value === "Number" && rows[0][0]?.bold === true, "a bold header row, then a row each");
ok(values(rows[1])[0] === "V2" && values(rows[2])[0] === "V10" && values(rows[3])[0] === null && values(rows[3])[3] === "DEV1", "by number, unnumbered last");
const layered = circuitRows([circ("V1", "A:1", "B:1", "Wiring")], true);
ok(values(rows[0]).slice(7, 9).join() === "Cable Length,Calculated Length" && values(rows[1]).slice(7, 9).join() === "5m," && values(rows[2])[8] === "3.25 m", "the length typed and the one worked out, side by side");
ok(values(layered[0])[0] === "Layer" && values(layered[1])[0] === "Wiring" && values(layered[1])[1] === "V1", "a Layer column first");

// devices then a summary by description and maker, totals at the foot
const devices = [dev("DEV10", "Camera", 20), dev("DEV2", "Camera", 30), dev("DEV3", "Switcher", 100.5)];
const d = deviceRows(devices);
ok(values(d[1])[0] === "DEV2" && values(d[2])[0] === "DEV3" && values(d[3])[0] === "DEV10", "devices by name");
const summary = d.findIndex((r) => r[0]?.value === "Summary");
ok(summary === 5 && values(d[summary + 2]).join() === "Camera,Acme,2,50,170.5,3" && values(d[summary + 3])[2] === 1, "summed by description and maker");
const total = d[d.length - 1];
ok(values(total)[0] === "Total" && values(total)[2] === 3 && values(total)[3] === 150.5 && total[3]?.accuracy === 2, "totals, with decimals where they have them");

// connections: a row per circuit on each socket, "Not connected" for the free ones
const wired = dev("DEV1", "Camera", 20, [
  { name: "OUT1", type: "OUT", signal: "SDI", connector: "BNC", circuits: [{ number: "V1", to: "DEV2 : IN1" }] },
  { name: "OUT2", type: "OUT", signal: "SDI", connector: "BNC", circuits: [] },
]);
const c = connectionRows([dev("DEV2", "Monitor", 10), wired]);
ok(values(c[0])[0] === "DEV1" && c[0][0]?.bold === true && values(c[1])[0] === "Socket", "each device's title then its header");
ok(values(c[2]).join() === "OUT1,OUT,SDI,BNC,V1,DEV2 : IN1" && values(c[3])[5] === "Not connected", "where each socket goes");
ok(c[4].length === 0 && values(c[5])[0] === "DEV2" && values(c[7])[0] === "No sockets", "a blank row between devices");

// parts: each name once, then quantities
const p = partRows([dev("DEV1", "Camera", 20), dev("DEV1", "Camera", 20), dev("DEV2", "Camera", 20), dev("SW1", "Switcher", 50)]);
ok(p.filter((r) => r[0]?.value === "DEV1").length === 1 && values(p[1])[3] === 1, "a device drawn twice is one part");
const q = p.findIndex((r) => r[2]?.value === "Quantity");
ok(values(p[q + 1]).join() === "Camera,Acme,2" && values(p[q + 2]).join() === "Switcher,Acme,1", "quantities by description");

// the worksheet: as many columns as the widest row, each as wide as its widest entry
const sheet = reportSheet("Current Layer Circuit Report", rows);
ok(sheet.widths.length === 10 && sheet.widths[3] >= sheet.widths[9] - 30 && sheet.rows.length === 4 && sheet.rowHeight === 18, "a column each, widths from the entries");

ok(freeName("Parts", new Set()) === "Parts" && freeName("Parts", new Set(["Parts", "Parts-2"])) === "Parts-3", "a free name");

// a rack's contents: by position from the top, free runs between, modules after their frame
const piece = (name: string, kind: RackEntry["kind"], u: number, ru: number, mounting = "Front", slots: number[] = []): RackEntry => ({ name, make: "Acme", model: "M", kind, u, ru, mounting, slots, rackWidth: kind === "module" ? "" : "Full", depth: "300", power: 10, btu: 34.1, weight: 2 });
const rack = rackRows(
  10,
  [piece("AMP1", "item", 9, 2), piece("CARD2", "module", 5, 3, "Front", [2]), piece("FRAME1", "frame", 5, 3), piece("CARD1", "module", 5, 3, "Front", [1]), piece("CARD3", "module", 5, 3, "Front", [3, 4]), piece("REAR1", "item", 10, 1, "Rear"), piece("LOW1", "item", -1, 1), piece("COL1", "module", 5, 3, "Front", [5, 9])],
  RACK_COLUMNS,
);
const rv = rack.map(values);
ok(rv[0].join() === RACK_COLUMNS.join(), "the chosen columns as headings");
const order = rv.slice(1, rv.findIndex((r) => !r.length)).map((r) => `${r[0]} ${r[1]} ${r[3]}${r[2] ? "#" + r[2] : ""}`);
ok(order.join(" | ") === "9–10 Front AMP1 | 8 Front Free | 5–7 Front FRAME1 | 5–7 Front CARD1#1 | 5–7 Front CARD2#2 | 5–7 Front CARD3#3–4 | 5–7 Front COL1#5, 9 | 1–4 Front Free | 10 Rear REAR1 | 1–9 Rear Free | Below Front LOW1", `by position, the front then the rear (${order.join(" | ")})`);
const totals = rv[rv.findIndex((r) => !r.length) + 1];
ok(totals[0] === "Total" && totals[RACK_COLUMNS.indexOf("Power (W)")] === 80 && totals[RACK_COLUMNS.indexOf("Weight (kg)")] === 16 && totals[RACK_COLUMNS.indexOf("BTU")] === 272.8, `totals (${totals})`);
ok(rv.slice(-2).map((r) => r.join()).join(" ") === "Free units (Front),5 Free units (Rear),9", `free units per side (${rv.slice(-2).map((r) => r.join())})`);
ok(rv.find((r) => r[3] === "CARD1")![6] === null && rv.find((r) => r[3] === "FRAME1")![6] === 3, "a module has no Height RU of its own");
// only some columns, in another order, and no totals without a totalled column
const few = rackRows(4, [piece("A", "item", 4, 1)], ["Name", "Rack U"]).map(values);
ok(few.map((r) => r.join("/")).join(" ") === "Name/Rack U A/4 Free/1–3  Free units/3", `few columns (${few.map((r) => r.join("/")).join(" ")})`);

// the Cable Pull Report: A–B both ways round one route, by cable type; another way between them its own route
const pull = cablePullRows(
  [
    { from: "A", to: "B", way: "1,2", cable: "RG6", mm: 10000 },
    { from: "B", to: "A", way: "1,2", cable: "RG6", mm: 12000 },
    { from: "A", to: "B", way: "1,2", cable: "", mm: 9000 },
    { from: "A", to: "B", way: "3,4,5", cable: "RG6", mm: 20000 },
    { from: "C", to: "A", way: "6", cable: "CAT6", mm: 5000 },
  ],
  (mm) => `${mm / 1000} m`,
).map(values);
const pulled = pull.map((r) => r.join("/")).join(" | ");
ok(
  pulled === "Route/From/To/Cable/Quantity/Length/Total Length | 1/A/B/(no cable type)/1/9 m/9 m | 1/A/B/RG6/2/12 m/22 m | 2/A/B/RG6/1/20 m/20 m | 3/A/C/CAT6/1/5 m/5 m |  | Cable/Quantity/Total Length | (no cable type)/1/9 m | CAT6/1/5 m | RG6/3/42 m",
  `cable pull (${pulled})`,
);

console.log(failed ? `${failed} failed` : "all passed");
