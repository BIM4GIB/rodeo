// npx tsx src/features/theatre/patch/deviceData.check.ts
import type { Fixture } from "../fixture.ts";
import { autoLink, deviceDataText, deviceTable, likelyField, likelyKey, patchTwice, planImport, UID, type LengthText } from "./deviceData.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

const base: Fixture = {
  id: "a",
  layerId: "L",
  classIndex: 0,
  native: true,
  at: { x: 1000, y: 2000 },
  type: "profile26",
  label: "Profile 26°",
  glyph: "ellipsoidal",
  position: "1st Electric",
  unit: "1",
  channel: "11",
  universe: 1,
  address: 101,
  footprint: 1,
  dimmer: "",
  circuit: "",
  color: "L201",
  gobo: "",
  purpose: "Front",
  accessory: "",
  notes: "",
  watts: 750,
  weightKg: 7.7,
  beamDeg: 18,
  fieldDeg: 26,
  lumens: 10500,
  heightMm: 6000,
  focus: null,
  aimDeg: -90,
};
const list: Fixture[] = [base, { ...base, id: "b", unit: "2", channel: "12", address: 102, notes: "needs\ta clamp" }, { ...base, id: "c", unit: "3", channel: "13", universe: 0, address: 0, color: "" }];
const len: LengthText = { format: (mm) => `${mm / 1000}`, parse: (t) => (Number.isFinite(parseFloat(t)) ? parseFloat(t) * 1000 : null) };
const placement = () => ({ layer: "Lighting", cls: "Lights" });

// export
const keys = ["type", "position", "unit", "channel", "universeAddress", "color", "watts", "height", "notes", "layer"];
const out = deviceDataText(list, keys, true, placement, len);
const lines = out.split("\r\n").filter(Boolean).map((l) => l.split("\t"));
ok(lines.length === 4, `a heading row and a row each (${lines.length})`);
ok(lines[0][0] === UID && lines[0][1] === "Instrument Type" && lines[0].length === keys.length + 1, `UID first, then the fields named (${lines[0].join("|")})`);
ok(lines[1][0] === "a" && lines[1][5] === "1/101" && lines[3][5] === "", `a patch as universe/address, none when unpatched (${lines[1][5]}, "${lines[3][5]}")`);
ok(lines[2][9] === "needs a clamp", `a tab in a note is a space (${lines[2][9]})`);
ok(lines[1][8] === "6" && lines[1][10] === "Lighting", "lengths through the formatter, the layer from the placement");
ok(deviceDataText(list, ["channel"], false, placement, len).split("\r\n")[0] === "a\t11", "no heading row when not asked");

// a file read back
const table = deviceTable(lines, false);
ok(table.headings[0] === UID && table.rows.length === 3, "the first row names the columns");
ok(deviceTable(lines, true).rows.length === 4 && deviceTable(lines, true).headings[0] === "Column 1", "unless it holds data");
const key = likelyKey(table.headings);
ok(key === 0, "UID is the key column");
const links = autoLink(table.headings, key);
ok(links.get(1) === "type" && links.get(5) === "universeAddress" && links.get(8) === "height" && !links.has(10), `AutoLink by name, export-only fields left out (${[...links].join(" ")})`);
const changed = table.rows.map((r) => [...r]);
changed[0][4] = "21";
changed[0][6] = "R02";
changed[1][5] = "2/1";
changed[1][7] = "1000W";
changed[2][7] = "lots";
changed.push(["zz", "Fresnel 1 kW", "Box Boom", "9", "31", "", "L117", "1000", "7", "", "", ""]);
const plan = planImport(changed, key, links, list, len);
const of = (id: string) => plan.edits.find((e) => e.id === id)?.edit;
ok(plan.edits.length === 3 && of("a")?.channel === "21" && of("a")?.color === "R02", `edits by UID (${JSON.stringify(of("a"))})`);
ok(of("b")?.universe === 2 && of("b")?.address === 1 && of("b")?.watts === 1000, `universe/address and "1000W" read (${JSON.stringify(of("b"))})`);
ok(of("c")?.watts === undefined && plan.unread === 1, `a cell a field can't read is left (${plan.unread})`);
ok(of("a")?.heightMm === 6000 && of("a")?.type === "profile26", "lengths and types read back as they went out");
ok(plan.orphans.length === 1 && plan.orphans[0].key === "zz" && plan.orphans[0].edit.type === "fresnel1k" && plan.orphans[0].edit.position === "Box Boom", `an unknown UID is an orphan, its type by label (${JSON.stringify(plan.orphans[0])})`);

// a file with the patch both ways links the pair
const both = autoLink([UID, "Universe/Address", "Universe", "Address"], 0);
ok(!patchTwice(both) && both.get(2) === "universe" && both.get(3) === "address" && !both.has(1), `Universe and Address, not Universe/Address too (${[...both].join(" ")})`);

// matching by another field: a file keyed on channel
const byChannel = planImport(
  [
    ["12", "Special"],
    ["99", "Nobody"],
  ],
  0,
  new Map([[1, "purpose"]]),
  list,
  len,
  "channel",
);
ok(byChannel.edits.length === 1 && byChannel.edits[0].id === "b" && byChannel.edits[0].edit.purpose === "Special" && byChannel.orphans.length === 1, "matched by channel");

// names files use
for (const [name, want] of [
  ["Inst Type", "type"],
  ["Chan", "channel"],
  ["U/A", "universeAddress"],
  ["Colour", "color"],
  ["Unit#", "unit"],
  ["Wattage", "watts"],
  ["Purp", "purpose"],
  ["Flavour", null],
] as const)
  ok(likelyField(name) === want, `"${name}" links to ${want} (${likelyField(name)})`);

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
