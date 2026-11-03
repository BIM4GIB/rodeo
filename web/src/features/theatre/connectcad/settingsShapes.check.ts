// npx tsx src/features/theatre/connectcad/settingsShapes.check.ts
import { allSignals, connectorsFor, padNumber, readSettingsFrom, signalInk, signalLetter, signalNamed, signalNames, socketName, NO_FILE_SETTINGS } from "./ccadShapes.ts";
import { arrayNames } from "./externalShapes.ts";
import { panelSize, panelTypeOf } from "./panelShapes.ts";
import { connectorList, defaultSettings, fileSettingsOf, IMPERIAL_LENGTHS, METRIC_LENGTHS, panelSizesOf, settingsFrom, signalProblems } from "./settingsShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

// the defaults: Rodeo's sizes, prefixes and the drawing's units' lengths
const d = defaultSettings(true);
ok(!d.autoHop && d.digits === 1 && d.prefixes.jack === "J" && d.prefixes.term === "TP" && d.prefixes.connector === "CTP_", "defaults");
ok(d.sizes.jack.Audio === 48 && d.sizes.term.Network === 24 && d.sizes.din === 32 && d.lengths === METRIC_LENGTHS && defaultSettings(false).lengths === IMPERIAL_LENGTHS, "default sizes and lengths");

// whatever the JSON holds comes back as settings
ok(JSON.stringify(settingsFrom(null, true)) === JSON.stringify(d) && JSON.stringify(settingsFrom("junk", true)) === JSON.stringify(d), "nothing kept: the defaults");
const read = settingsFrom(
  {
    autoHop: true,
    digits: 9,
    prefixes: { jack: "JF", term: 4 },
    sizes: { jack: { Video: 16, Audio: -1 }, din: 12.4 },
    numbering: "Sequence",
    signals: [{ name: " 12G-SDI ", category: "Video", letter: "vv12", connectors: ["BNC", "BNC", " ", 3] }, { name: "" }, { name: "12G-SDI" }],
    connectors: [{ name: "Neutrik XLR", description: "panel mount" }, { name: "" }, "x"],
    cables: [{ name: "Belden 1694A" }],
    lengths: ["2 m", " ", "2 m", 7],
  },
  true,
);
ok(read.autoHop && read.digits === 4 && read.prefixes.jack === "JF" && read.prefixes.term === "TP" && read.numbering === "Sequence", "flags, digits capped at 4, a wrong prefix the default's");
ok(read.sizes.jack.Video === 16 && read.sizes.jack.Audio === 48 && read.sizes.din === 12 && read.sizes.custom === 999, "sizes: a wrong one the default's");
ok(read.signals.length === 1 && read.signals[0].name === "12G-SDI" && read.signals[0].letter === "VV" && read.signals[0].connectors.join() === "BNC", "signals: trimmed, the first of a name kept");
ok(read.connectors.length === 1 && read.connectors[0].description === "panel mount" && read.cables[0].description === "" && read.lengths.join() === "2 m", "named lists and lengths");

// panel sizes by device type
const sizes = panelSizesOf(read.sizes);
ok(sizes["Video Jack"] === 16 && sizes["U-Linked Video Jack"] === 16 && sizes["Video Term Panel"] === 32 && sizes["DIN Rail Term Panel"] === 12 && sizes["Connector Panel Input"] === 999, "sizes by device type");

// the schematic tools follow the drawing's settings
const before = signalNames().length;
ok(signalNamed("12G-SDI") === null && panelSize(panelTypeOf("Video Jack")!) === 32, "built-in before");
const changedSdi = { name: "SDI", category: "Video", letter: "Q", connectors: ["BNC", "HD-BNC"] };
readSettingsFrom(() => ({ ...fileSettingsOf({ ...read, signals: [...read.signals, changedSdi] }), connectors: ["Neutrik XLR"] }));
ok(signalNames().length === before + 1 && signalNames()[0] === "SDI" && signalNamed("12G-SDI")?.letter === "VV" && signalLetter("SDI") === "Q", "a new signal added, a built-in one changed in its place");
ok(connectorsFor("SDI").join() === "BNC,HD-BNC,---,???" && connectorsFor("Mystery").includes("Neutrik XLR"), "connectors: a signal's own, or every one with the drawing's");
ok(signalInk("12G-SDI") === signalInk("HDMI") && allSignals().filter((s) => s.name === "SDI").length === 1, "a new signal's colour is its category's");
ok(panelSize(panelTypeOf("Video Jack")!) === 16, "a panel's size from the settings");
readSettingsFrom(() => NO_FILE_SETTINGS);
ok(signalNames().length === before && signalLetter("SDI") === "V", "back to the built-in ones");

// Number Format on a Linear Array's names
ok(arrayNames("EXT1", 3, new Set(), 2).join() === "EXT01,EXT02,EXT03" && arrayNames("EXT", 2, new Set(["EXT01"]), 2).join() === "EXT02,EXT03" && arrayNames("EXT001", 1, new Set(), 2).join() === "EXT001", "external arrays");
ok(socketName("", "IN", new Set(), 3) === "IN001" && socketName("OUT7", "OUT", new Set(), 2) === "OUT07" && socketName("", "IN", new Set(["IN1"])) === "IN2" && padNumber("A9", 2) === "A09", "socket names");

ok(signalProblems([changedSdi, { ...changedSdi }, { name: " ", category: "Video", letter: "V", connectors: [] }]).join("; ") === "there are two signals named SDI; a signal has no name", "signal problems");
ok(connectorList(" BNC, ,HD-BNC,BNC ").join() === "BNC,HD-BNC", "connector lists");

console.log(failed ? `${failed} failed` : "all passed");
