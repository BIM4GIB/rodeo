// ConnectCAD's report commands: Current Layer and All Layers Circuit Report, Current Layer Device
// Report, Device Connections Report and ConnectCAD Parts Report, each a new worksheet listing the
// schematic as it is now (ccadReports.ts has the rows); externals are only in the connections
// report. A worksheet is made from one the drawing has, so in a drawing with none the report shows
// in a dialog instead.

import "./connectcad.css";
import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { editWorksheet } from "../../../app/worksheetEditor.ts";
import { circuitRows, connectionRows, deviceRows, freeName, partRows, reportSheet, type ReportRow } from "./ccadReports.ts";
import { reportFacts } from "./schematic.ts";

/** Without a worksheet to make one from, the report in a dialog. */
async function showReport(name: string, rows: readonly ReportRow[]): Promise<void> {
  const cell = (tag: "th" | "td", c: ReportRow[number]): HTMLElement => h(tag, { text: c === null ? "" : String(c.value) });
  const cols = String(Math.max(1, ...rows.map((r) => r.length)));
  // an empty row parts one section from the next
  const row = (r: ReportRow): HTMLElement => (r.length ? h("tr", {}, ...r.map((c) => cell(c?.bold ? "th" : "td", c))) : h("tr", { cls: "ccad-gap" }, h("td", { attrs: { colspan: cols } })));
  await showDialog<boolean>({
    title: name,
    okLabel: "Close",
    cls: "ccad-dialog",
    body: [
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table ccad-report" }, ...rows.map(row))),
      h("p", { cls: "muted", text: "This drawing has no worksheet to make the report from, so it shows here." }),
    ],
    check: () => ({ value: true }),
  });
}

/** Makes worksheet `name` of `rows` and opens it, or shows them when the drawing can't hold one. */
export async function report(name: string, rows: readonly ReportRow[]): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const resources = doc.resources();
  if (!resources.some((r) => r.kind === "worksheet")) return showReport(name, rows);
  const sheet = reportSheet(freeName(name, new Set(resources.map((r) => r.name))), rows);
  const made = attempt(name, (s) => s.createWorksheet(sheet));
  if (made) await editWorksheet(made.value);
}

const facts = (current: boolean) => {
  const s = store.session;
  return s ? reportFacts(s, current ? (store.activeLayerId ?? undefined) : undefined) : null;
};

export async function circuitReport(current: boolean): Promise<void> {
  const f = facts(current);
  if (!f) return;
  if (!f.circuits.length) return toast(current ? "There are no ConnectCAD circuits on the active layer." : "There are no ConnectCAD circuits in this drawing.", "info");
  await report(current ? "Current Layer Circuit Report" : "All Layers Circuit Report", circuitRows(f.circuits, !current));
}

export async function deviceReport(): Promise<void> {
  const devices = facts(true)?.devices.filter((d) => !d.external);
  if (!devices) return;
  if (!devices.length) return toast("There are no ConnectCAD devices on the active layer.", "info");
  await report("Current Layer Device Report", deviceRows(devices));
}

export async function connectionsReport(): Promise<void> {
  const f = facts(false);
  if (!f) return;
  if (!f.devices.length) return toast("There are no ConnectCAD devices in this drawing.", "info");
  await report("Device Connections Report", connectionRows(f.devices));
}

export async function partsReport(): Promise<void> {
  const devices = facts(false)?.devices.filter((d) => !d.external);
  if (!devices) return;
  if (!devices.length) return toast("There are no ConnectCAD devices in this drawing.", "info");
  await report("ConnectCAD Parts Report", partRows(devices));
}
