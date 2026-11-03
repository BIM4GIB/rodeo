// npx tsx src/features/theatre/connectcad/builderShapes.check.ts
import { BUILDER_DEFAULTS, designBox, designFrom, designKey, designProblems, designsFrom, designSockets, designSvg, NEW_DESIGN, newRow, rackWidthOf, truncated, withDesign, type DeviceDesign } from "./builderShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

// a switcher: 4 SDI inputs and a reference in on the left, 2 programme outputs on the right
const sw: DeviceDesign = {
  ...NEW_DESIGN,
  make: "Acme",
  model: "SW-4",
  name: "SW1",
  rows: [
    { ...newRow("IN", "SDI"), count: 4 },
    { ...newRow("IN", "Reference"), name: "REF" },
    { ...newRow("OUT", "SDI"), count: 2, name: "PGM" },
    { ...newRow("IO", "Ethernet"), use: false },
  ],
};
const sockets = designSockets(sw, BUILDER_DEFAULTS);
ok(sockets.length === 7 && sockets.map((k) => k.name).join() === "IN1,IN2,IN3,IN4,REF,PGM1,PGM2", "names: numbered, a single one as typed, an unused row left out");
ok(sockets.filter((k) => k.side === "L").map((k) => k.slot).join() === "0,1,2,3,5" && sockets.filter((k) => k.side === "R").map((k) => k.slot).join() === "0,1", "rows down their sides, a gap after each");
ok(sockets.every((k, i) => k.id === i + 1) && sockets[4].signal === "Reference" && sockets[4].connector === "BNC" && sockets[5].type === "OUT", "ids, signals and connectors");
const spaced = designSockets(sw, { ...BUILDER_DEFAULTS, top: 2, groupGap: 0 });
ok(spaced.filter((k) => k.side === "L").map((k) => k.slot).join() === "2,3,4,5,6", "space at top, no gap");

const box = designBox(sockets, BUILDER_DEFAULTS);
ok(box.width === 8 && box.height === 1 + 6 + 0.5, "box: the minimum width, as deep as the sockets");
ok(designBox(sockets, { ...BUILDER_DEFAULTS, bottom: 2, minWidth: 12 }).height === 9.5 && designBox(sockets, { ...BUILDER_DEFAULTS, minWidth: 12 }).width === 12, "space at the bottom, a wider minimum");
const long = designSockets({ ...sw, rows: [{ ...newRow("IN", "SDI"), name: "CAMERA RETURN FEED" }, { ...newRow("OUT", "SDI"), name: "MULTIVIEWER OUTPUT" }] }, BUILDER_DEFAULTS);
ok(designBox(long, BUILDER_DEFAULTS).width > 8, "long names widen the box");

ok(truncated("CONTROL ROOM SWITCHER") === "CONTR…TCHER" && truncated("SW1") === "SW1", "truncated tags");
ok(rackWidthOf(sw) === "Full" && rackWidthOf({ ...sw, halfRack: true }) === "Half" && rackWidthOf({ ...sw, physical: false }) === "Non-rack" && rackWidthOf({ ...sw, ru: 0 }) === "Non-rack", "rack width");
ok(designProblems(sw).length === 0 && designProblems({ ...sw, name: " ", rows: [] }).join("; ") === "the device needs a name; no socket rows are used" && designProblems({ ...sw, rows: [{ ...newRow("IN", "SDI"), count: 300 }] }).length === 1, "problems");

// the user's list
const kept = designsFrom([sw, { ...sw, model: "SW-8" }, { make: "", model: "" }, "junk", { ...sw, name: "SW9" }]);
ok(kept.length === 2 && kept[0].name === "SW9" && designKey(kept[1]) === "Acme SW-8", "kept: one of each make and model, the last one");
ok(withDesign(kept, { ...sw, power: 40 }).find((d) => d.model === "SW-4")?.power === 40 && withDesign(kept, sw, true).length === 1, "put in, taken out");
const back = designFrom(JSON.parse(JSON.stringify({ ...sw, rows: [...sw.rows, { type: "XX" }], power: -3 })));
ok(!!back && back.rows.length === 4 && back.power === 0 && back.rows[3].use === false, "read back: a bad row dropped, a bad number nothing");

const svg = designSvg(sw, BUILDER_DEFAULTS);
ok(svg.startsWith("<svg") && svg.includes(">PGM2<") && svg.includes(">SW1<") && (svg.match(/<line /g) ?? []).length === 7, "a picture of it");
ok(designSvg({ ...sw, tag: "CONTROL ROOM SWITCHER" }, { ...BUILDER_DEFAULTS, truncate: true }).includes(">CONTR…TCHER<") && designSvg({ ...sw, name: "<b>" }, BUILDER_DEFAULTS).includes("&lt;b&gt;"), "truncated in the picture, escaped");

console.log(failed ? `${failed} failed` : "all passed");
