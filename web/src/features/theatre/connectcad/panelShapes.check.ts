// npx tsx src/features/theatre/connectcad/panelShapes.check.ts
import { afterPort, connectorPort, connectorSockets, groupOf, linkedThrough, nextConnectorPorts, nextPorts, panelCarries, panelName, panelPlaceOf, panelSockets, panelTag, panelTypeOf, panelTypes, portKey, portLabel, portsIn, rowsLost } from "./panelShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

ok(panelTypes("term").length === 5 && panelTypes("jack").length === 4 && panelTypes("linked").length === 5, "the Tool bar's types of each tool");
const video = panelTypeOf("Video Jack")!;
const term = panelTypeOf("Video Term Panel")!;
const din = panelTypeOf("DIN Rail Term Panel")!;
ok(panelName("J", { group: "A", panel: 3 }) === "JA3" && panelTag({ group: "B", panel: 12 }) === "B12" && portLabel(7) === "07" && portLabel(112) === "112", "names, tags and port labels");
ok(groupOf("b2") === "B" && groupOf("") === "A", "a group is letters");

const run = nextPorts("J", { group: "A", panel: 1, port: 31 }, 4, 32, new Set([portKey("JA2", 1)]));
ok(run.map((p) => `${p.group}${p.panel}-${p.port}`).join() === "A1-31,A1-32,A2-2,A2-3", "ports count on to the panel's size, then the next panel, skipping ports taken");
ok(nextPorts("J", { group: "A", panel: 1, port: 1 }, 2, 32, new Set(), new Set(["JA1"])).map((p) => `${p.panel}-${p.port}`).join() === "2-1,2-2", "a panel of another type is passed over");
ok(afterPort({ group: "A", panel: 1, port: 32 }, 32).panel === 2 && afterPort({ group: "A", panel: 1, port: 5 }, 32).port === 6, "the next place");
ok(nextPorts("J", { group: "A", panel: 1, port: 40 }, 1, 32, new Set())[0].panel === 2, "a port past the size starts the next panel");

const jack = panelSockets(video, 5, "SDI", "BNC");
ok(jack.map((k) => `${k.name}:${k.type}:${k.side}${k.slot}`).join() === "05:IN:L0,05:OUT:R0" && jack[0].id !== jack[1].id, "a jack: in at the left, out at the right, named by its port");
const tp = panelSockets(term, 1, "SDI", "BNC");
ok(tp.every((k) => k.type === "IO"), "a term panel takes a circuit either way");
const moved = panelSockets(video, 9, "SDI", "BNC", [{ ...jack[0], signal: "HDMI" }, jack[1]]);
ok(moved[0].id === jack[0].id && moved[1].id === jack[1].id && moved[0].name === "09" && moved[0].signal === "HDMI", "a new port renames the sockets it had, keeping their ids and signals");

const two = panelSockets(video, 3, "SDI", "BNC", [...jack, ...panelSockets(video, 6, "SDI", "BNC").map((k, i) => ({ ...k, id: 10 + i, slot: 4 }))]);
ok(two.map((k) => `${k.id}:${k.name}:${k.side}${k.slot}`).join() === `${jack[0].id}:03:L0,${jack[1].id}:03:R0,10:04:L1,11:04:R1`, "a panel of two ports: numbered on, its rows closed up, ids kept");
ok(portsIn(two).join() === "03,04", "its ports");
ok(panelCarries(video, "HDMI") && !panelCarries(video, "Analog Audio") && panelCarries(din, "DMX") && panelCarries(video, "---"), "a panel carries its own category's signals; a DIN rail anything");
ok(linkedThrough(term) && linkedThrough(panelTypeOf("Full-Normal Audio Jack")!) && !linkedThrough(video), "term panels and linked jacks are linked through");


// connector panels
const input = panelTypeOf("Connector Panel Input")!;
ok(panelTypes("connector").map((t) => t.device).join() === "Connector Panel Input,Connector Panel Output" && panelCarries(input, "SDI") && panelCarries(input, "DMX"), "connector panels: input and output, carrying anything");
ok(linkedThrough(input), "a connector panel is wired through");
const box = panelPlaceOf("BOX1");
const foh = panelPlaceOf("foh-b12");
ok(box.group === "BOX" && box.panel === 1 && foh.group === "FOHB" && foh.panel === 12 && panelPlaceOf("Stage").panel === 1, "a panel's name as a group and number");
ok(panelName("CTP_", box) === "CTP_BOX1" && panelTag(box) === "BOX1", "named by the prefix and panel");
ok(connectorPort("MIC", 1) === "MIC01" && connectorPort("", 3) === "03" && connectorPort("SPK", 0) === "SPK" && connectorPort("", 0) === "---", "a port: its code and number");
ok(nextConnectorPorts("MIC", 1, 3, new Set(["MIC02"])).join() === "1,3,4" && nextConnectorPorts("MIC", 0, 2, new Set()).join() === "0,0", "numbers count on past ports taken; none stays none");
const cp = connectorSockets("MIC01", 1, "???", "XLR3");
ok(cp.map((k) => `${k.name}:${k.type}:${k.side}${k.slot}:${k.connector}`).join() === "MIC01:IN:L0:XLR3,MIC01:OUT:R0:XLR3", "a connector: in at the left, out at the right");
const multi = connectorSockets("MIC01", 3, "???", "XLR3", cp);
ok(multi.length === 6 && multi[0].id === cp[0].id && multi[1].id === cp[1].id && multi.map((k) => k.name).filter((_, i) => i % 2 === 0).join() === "MIC01.1,MIC01.2,MIC01.3" && new Set(multi.map((k) => k.id)).size === 6, "a multi-circuit connector: a row a circuit, ids kept");
ok(connectorSockets("LINE04", 1, "???", "XLR3", multi).map((k) => `${k.id}:${k.name}`).join() === `${cp[0].id}:LINE04,${cp[1].id}:LINE04`, "back to one circuit: the first row renamed");
ok(rowsLost(multi, 1, new Set([multi[4].id])).join() === "MIC01.3" && rowsLost(multi, 3, new Set([multi[4].id])).length === 0, "rows taken away holding circuits");

console.log(failed ? `${failed} failed` : "all passed");
