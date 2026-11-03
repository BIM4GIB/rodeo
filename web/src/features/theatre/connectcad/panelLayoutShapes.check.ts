// npx tsx src/features/theatre/connectcad/panelLayoutShapes.check.ts
import { appendConnectors, arrayAlong, arrayGrid, buildPanel, connectedTo, connectorWriting, footprint, layoutBox, nextTags, panelMarks, panelRoom, panelSize, type PanelSpec, type PortEnd } from "./panelLayoutShapes.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number | undefined, b: number, e = 1e-6): boolean => a !== undefined && Math.abs(a - b) < e;
const rack = (ru: number, opening = "19 in"): PanelSpec => ({ type: "Rack-mount", ru, opening, width: 0, height: 0, holes: false });

// panels: a 1U 19" panel, a 2U one, a 10" one, a custom plate, none
ok(near(panelSize(rack(1))?.width, 482.6) && near(panelSize(rack(1))?.height, 43.66), `1U (${JSON.stringify(panelSize(rack(1)))})`);
ok(near(panelSize(rack(2))?.height, 88.11) && near(panelSize(rack(1, "10 in"))?.width, 254), "2U, and 10 in");
ok(panelSize({ type: "No Graphics", ru: 1, opening: "19 in", width: 0, height: 0, holes: false }) === null, "no graphics, no size");
const holes = panelMarks(rack(1)).filter((m) => m.kind === "ring");
ok(holes.length === 4 && holes.every((m) => m.kind === "ring" && (near(m.at.x, 8.75) || near(m.at.x, 473.85))), `four ear holes (${holes.length})`);
ok(holes.some((m) => m.kind === "ring" && near(m.at.y, -5.955)) && holes.some((m) => m.kind === "ring" && near(m.at.y, -37.705)), "the same in from top and bottom");
ok(panelMarks(rack(3)).filter((m) => m.kind === "ring").length === 12, "two a side for each unit");
const plate: PanelSpec = { type: "Custom", ru: 1, opening: "19 in", width: 100, height: 60, holes: true };
ok(panelMarks(plate).filter((m) => m.kind === "ring").length === 4 && near(panelRoom(plate).x0, 12) && near(panelRoom(plate).bottom ?? NaN, -54), "a custom plate's corner holes and room");
ok(panelMarks({ ...plate, holes: false }).length === 1, "a plate without holes: its outline");

// footprints by connector name
ok(footprint("XLR3").family === "XLR" && footprint("XLR5 Male").family === "XLR" && footprint("BNC").family === "BNC" && footprint("RJ45").family === "RJ45" && footprint("etherCON").family === "RJ45", "families");
ok(footprint("TRS").family === "TRS" && footprint("LC").family === "Fiber" && footprint("HDMI").family === "HDMI" && footprint("Phoenix").family === "Terminal" && footprint("???").family === "Other", "more families");
ok(footprint("XLR3").marks({ x: 0, y: 0 }).filter((m) => m.kind === "ring" && m.fill).length === 3, "an XLR's three pins");

// the Panel Builder: 16 XLRs across a 1U panel fit one line; 32 need a second unit
const one = buildPanel([{ qty: 16, connector: "XLR3", prefix: "IN", arrange: "Horizontal" }], rack(1), 5);
ok(one.connectors.length === 16 && one.ru === 1 && one.connectors.every((c) => near(c.y, -24)), `16 across 1U (${one.ru}, ${one.connectors[0]?.y})`);
ok(near(one.connectors[0].x, 19.875 + 13.5) && near(one.connectors[1].x - one.connectors[0].x, 27) && one.connectors[0].tag === "IN1" && one.connectors[15].tag === "IN16", "from the left, 27 apart, tagged");
const two = buildPanel([{ qty: 32, connector: "XLR3", prefix: "", arrange: "Horizontal" }], rack(1), 5);
ok(two.ru === 2 && two.connectors.filter((c) => near(c.y, -24)).length === 16 && two.connectors[31].tag === "32", `32 wrap to a second unit (${two.ru})`);
const blocks = buildPanel([{ qty: 4, connector: "BNC", prefix: "V", arrange: "Square" }, { qty: 3, connector: "RJ45", prefix: "N", arrange: "Vertical" }], rack(1), 5);
const v = blocks.connectors.filter((c) => c.tag.startsWith("V"));
const n = blocks.connectors.filter((c) => c.tag.startsWith("N"));
ok(new Set(v.map((c) => c.x)).size === 2 && new Set(v.map((c) => c.y)).size === 2, "a square of four: two by two");
ok(new Set(n.map((c) => c.x)).size === 1 && new Set(n.map((c) => c.y)).size === 3 && n[0].x > Math.max(...v.map((c) => c.x)), "a column of three, beside it");
ok(blocks.ru === 2, `the rack panel grows to hold the column (${blocks.ru})`);
const free = buildPanel([{ qty: 3, connector: "BNC", prefix: "", arrange: "Horizontal" }], { type: "No Graphics", ru: 1, opening: "19 in", width: 0, height: 0, holes: false }, 0);
ok(near(free.connectors[0].x, 9) && near(free.connectors[2].x, 45), "no graphics: from the origin");

// connectors added after the last: on along its line, then a line below
const more = appendConnectors(one.connectors.slice(0, 14), [3, 4, 5].map((k) => ({ tag: `N${k}`, socket: `N${k}`, connector: "XLR3" })), rack(1), 5);
ok(more.length === 17 && near(more[14].x, one.connectors[14].x) && near(more[15].x, one.connectors[15].x) && near(more[14].y, -24), "two more fit on the line");
ok(near(more[16].x, 19.875 + 13.5) && near(more[16].y, -24 - 15.5 - 3 - 5 - 15.5 - 1.5), `the next goes on a line below (${more[16].y})`);
const first = appendConnectors([], [{ tag: "1", socket: "", connector: "BNC" }], rack(1), 5);
ok(first.length === 1 && near(first[0].x, 19.875 + 9) && near(first[0].y, -2 - 5 - 6 - 1.5), `the first on an empty panel at its top left (${JSON.stringify(first[0])})`);

// arrays and their tags
ok(nextTags("IN07", 3).join() === "IN07,IN08,IN09" && nextTags("A", 2).join() === "A1,A2" && nextTags("", 2).join() === "1,2", `tags (${nextTags("IN07", 3)})`);
ok(arrayAlong({ x: 0, y: 0 }, { x: 100, y: 0 }, 27).length === 4 && near(arrayAlong({ x: 0, y: 0 }, { x: 0, y: -60 }, 20)[3].y, -60), "a line of them");
const grid = arrayGrid({ x: 0, y: 0 }, { x: 40, y: -20 }, 20);
ok(grid.length === 6 && near(grid[2].x, 40) && near(grid[3].y, -20), "a grid, row by row");

// connected to: a rack device first, its source end before its destination
const e = (device: string, source: boolean, kind: "rack" | "jack" | "panel" | "loose"): PortEnd => ({ device, socket: "1", source, rack: kind === "rack", jack: kind === "jack", panel: kind === "panel" });
ok(connectedTo([e("TP2", true, "panel"), e("CAM", true, "loose"), e("RTR", false, "rack")])?.device === "RTR", "a rack device first");
ok(connectedTo([e("CAM", false, "loose"), e("J1", false, "jack")])?.device === "J1" && connectedTo([e("A", false, "loose"), e("B", true, "loose")])?.device === "B" && connectedTo([]) === null, "a jack before a loose device; source before destination");
const c = { x: 0, y: 0, tag: "01", socket: "01", connector: "XLR3" };
ok(connectorWriting(c, { device: "MIX", socket: "IN 3" }, { tag: true, device: true, socket: true }).join("|") === "MIX|IN 3|01" && connectorWriting(c, null, { tag: true, device: true, socket: false }).join() === "01", "the writing over a connector");
const lb = layoutBox({ type: "No Graphics", ru: 1, opening: "19 in", width: 0, height: 0, holes: false }, [c, { ...c, x: 27 }], 5);
ok(!!lb && near(lb.x0, -13) && near(lb.x1, 40) && near(lb.y1, 20.5), `a layout without a panel covers its connectors (${JSON.stringify(lb)})`);

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
