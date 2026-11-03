// ConnectCAD's cable list commands (Stage > ConnectCAD): Convert Report to List copies a report
// worksheet's rows as a list worksheet, frozen as it is; Compare Cable List and Drawing marks where a
// list and the active layer's circuits differ; Make Connections from List draws the list's circuits
// the layer hasn't; Create Devices from Worksheet makes the devices a device list asks for that the
// drawing hasn't. A list is one of the drawing's worksheets or, in Rodeo, a spreadsheet file (CSV,
// tab-delimited or Excel), so that a drawing with no worksheet can take one. listShapes.ts and
// deviceListShapes.ts have the sums.

import type { NewSheetCell, VwxDocument } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { chooseFile, loadTable } from "../../../app/surveyInput.ts";
import { toast } from "../../../app/toast.ts";
import { editWorksheet } from "../../../app/worksheetEditor.ts";
import { parseDelimited } from "../../../import/worksheet.ts";
import { ringAround, type Issue } from "./ccadChecks.ts";
import { freeName, reportSheet, type ReportRow } from "./ccadReports.ts";
import { checkedRows, compareList, delimiterOf, endKey, listCircuits, listHeader, type ListCheck, type ListCircuit } from "./listShapes.ts";
import { MARKUP_CLASS, markIssues } from "./markup.ts";
import { report } from "./reports.ts";
import { connectFromList, deviceOutline, devicesFromList, devicesOn, drawnCircuits, hadDevices, IMPORTED_DEVICE_DATA, pitchOn, socketsByName } from "./schematic.ts";
import { assignmentOf, columnNames, DEVICE_COLUMNS, deviceHeader, devicePlan, listedDevices, type Assignment } from "./deviceListShapes.ts";

const FILE = "file";

interface ListSource {
  readonly name: string;
  /** the worksheet it is, or null for a file */
  readonly sheet: number | null;
  readonly cells: ReportRow[];
  readonly rows: string[][];
  /** rows that list objects, which aren't read */
  readonly databaseRows: number;
}

/** A worksheet's plain rows, a cell's number kept a number; its database rows left empty. */
function sheetCells(doc: VwxDocument, index: number): { cells: ReportRow[]; databaseRows: number } {
  const c = doc.worksheetContents(index);
  if (!c) return { cells: [], databaseRows: 0 };
  const cells: ReportRow[] = Array.from({ length: c.rows }, () => Array.from({ length: c.cols }, () => null));
  for (const cell of c.cells) {
    if (c.database[cell.row] || cell.row >= c.rows || cell.col >= c.cols) continue;
    const value: NewSheetCell["value"] = cell.kind !== "text" && cell.value !== null ? cell.value : cell.display;
    if (value !== "") cells[cell.row][cell.col] = { value };
  }
  return { cells, databaseRows: c.database.filter(Boolean).length };
}

const textOf = (cells: readonly ReportRow[]): string[][] => cells.map((r) => r.map((c) => (c === null ? "" : String(c.value))));

/** The Select Worksheet dialog: one of the drawing's worksheets, or (`files`) a spreadsheet file; null when cancelled. */
async function chooseList(title: string, files: boolean): Promise<ListSource | null> {
  const doc = store.session?.doc;
  if (!doc) return null;
  const sheets = doc.resources().filter((r) => r.kind === "worksheet");
  if (!sheets.length && !files) {
    toast("This drawing has no worksheet: make one with a report command first.", "info");
    return null;
  }
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Worksheet" } },
    ...sheets.map((r) => h("option", { value: String(r.index), text: r.name })),
    ...(files ? [h("option", { value: FILE, text: "A spreadsheet file (CSV or Excel)…" })] : []),
  );
  // the worksheet made last, most likely the report just run
  select.value = sheets.length ? String(sheets[sheets.length - 1].index) : FILE;
  const chosen = await showDialog<string>({
    title: `${title}: Select Worksheet`,
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Worksheet" }), select),
      ...(files ? [h("p", { cls: "muted", text: "A list's columns are found by their headings: Source Device, Source Socket, Destination Device and Destination Socket, and Number and Cable if it has them, as the circuit reports write them." })] : []),
    ],
    check: () => ({ value: select.value }),
  });
  if (chosen === null) return null;
  if (chosen === FILE) {
    const file = await chooseFile(".csv,.tsv,.txt,.xlsx,.xlsm,.xls", "Cable list file");
    const t = file && (await loadTable(file, title));
    if (!file || !t) return null;
    const rows = t.sheetRows ?? parseDelimited(t.text, delimiterOf(t.text));
    return { name: file.name.replace(/\.[^.]+$/, ""), sheet: null, cells: rows.map((r) => r.map((value) => (value ? { value } : null))), rows, databaseRows: 0 };
  }
  const index = Number(chosen);
  const { cells, databaseRows } = sheetCells(doc, index);
  return { name: sheets.find((r) => r.index === index)?.name ?? "Worksheet", sheet: index, cells, rows: textOf(cells), databaseRows };
}

const UNREAD = "its database rows, which list objects, can't be read yet";

/** Convert Report to List: a worksheet's rows copied into a new worksheet named as its list, which then opens. */
export async function convertReportToList(): Promise<void> {
  const src = await chooseList("Convert Report to List", false);
  const doc = store.session?.doc;
  if (!src || !doc) return;
  if (!src.cells.some((r) => r.some((c) => c !== null))) return toast(`${src.name} has nothing to list${src.databaseRows ? `: ${UNREAD}` : ""}.`, "info");
  const name = freeName(`${src.name} List`, new Set(doc.resources().map((r) => r.name)));
  const made = attempt("Convert Report to List", (s) => s.createWorksheet(reportSheet(name, src.cells)));
  if (!made) return;
  if (src.databaseRows) toast(`${name} has ${src.name}'s plain rows; ${UNREAD}.`, "info");
  await editWorksheet(made.value);
}

const NONE = "none";
const RECORD = "record";

/** The Worksheet Columns Assignment dialog: the header row, and what each column goes to; null when cancelled. */
async function assignColumns(src: ListSource): Promise<{ header: number; assigned: Assignment[] } | null> {
  const rows = src.rows;
  const count = Math.min(rows.length, 40);
  const header = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Header Row" } },
    ...Array.from({ length: count }, (_, i) => h("option", { value: String(i), text: `${i + 1}: ${rows[i].filter((c) => c.trim()).slice(0, 4).join(", ") || "(empty)"}` })),
  );
  header.value = String(Math.min(deviceHeader(rows), count - 1));
  const table = h("tbody", {});
  let selects: HTMLSelectElement[] = [];
  const fill = (): void => {
    const at = Number(header.value);
    const names = columnNames(rows, at);
    selects = names.map((name, i) => {
      const a = assignmentOf(rows[at]?.[i] ?? "");
      const select = h(
        "select",
        { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Assign ${name} to` } },
        h("option", { value: NONE, text: "— (not used)" }),
        ...DEVICE_COLUMNS.map((f) => h("option", { value: f, text: f })),
        h("option", { value: RECORD, text: `${IMPORTED_DEVICE_DATA}: ${name}` }),
      ) as HTMLSelectElement;
      select.value = a.kind === "device" ? a.field : a.kind === "record" ? RECORD : NONE;
      return select;
    });
    table.replaceChildren(...names.map((name, i) => h("tr", {}, h("td", { text: name }), h("td", {}, selects[i]))));
  };
  fill();
  header.addEventListener("change", fill);
  return showDialog<{ header: number; assigned: Assignment[] }>({
    title: "Worksheet Columns Assignment",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Header Row" }), header),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Worksheet Column" }), h("th", { text: "Assign To" }))), table)),
      h("p", { cls: "muted", text: `Each row below the header makes its Quantity of devices (one without), unless the drawing has devices of that make and model already. A column given to ${IMPORTED_DEVICE_DATA} becomes a field of that record, attached to each device.` }),
    ],
    check: () => {
      const at = Number(header.value);
      const names = columnNames(rows, at);
      const assigned = selects.map((sel, i): Assignment => (sel.value === NONE ? { kind: "none" } : sel.value === RECORD ? { kind: "record", field: names[i] } : { kind: "device", field: sel.value as (typeof DEVICE_COLUMNS)[number] }));
      if (!assigned.some((a) => a.kind === "device" && (a.field === "Make" || a.field === "Model"))) return { error: "Assign a column to Make or Model: a row's devices are found by them.", focus: selects[0] ?? header };
      return { value: { header: at, assigned } };
    },
  });
}

/**
 * Create Devices from Worksheet: the devices a device list asks for, the drawing's own of each make
 * and model counted first, made in rows below the active layer's devices and selected.
 */
export async function createDevicesFromWorksheet(): Promise<void> {
  const layerId = store.activeLayerId;
  if (!store.session || !layerId) return;
  const src = await chooseList("Create Devices from Worksheet", true);
  if (!src || !src.rows.length) return;
  const asked = await assignColumns(src);
  const s = store.session;
  if (!asked || !s) return;
  const { devices, skipped } = listedDevices(src.rows, asked.header, asked.assigned);
  if (!devices.length) return toast(`${src.name} asks for no devices: no row below its header has a make or model.`, "info");
  const plan = devicePlan(devices, hadDevices(s), new Set(devicesOn(s).map((d) => d.name)));
  // below what the layer has already
  const pitch = pitchOn(layerId);
  const corners = devicesOn(s, layerId).flatMap(deviceOutline);
  const origin = corners.length ? { x: Math.min(...corners.map((p) => p.x)), y: Math.min(...corners.map((p) => p.y)) - 6 * pitch } : { x: 0, y: 0 };
  const r = attempt("Create Devices from Worksheet", (session) => session.batch(() => devicesFromList(session, layerId, plan, origin)));
  if (!r) return;
  if (r.value.made.length) setEditGroup(null, r.value.made);
  const notes = [
    r.value.updated.length && `${many(r.value.updated.length, "device")} the drawing had brought up to date`,
    skipped.length && `${many(skipped.length, "row")} passed by (${skipped.slice(0, 3).map((k) => `row ${k.row + 1}: ${k.why}`).join("; ")}${skipped.length > 3 ? "…" : ""})`,
  ].filter(Boolean);
  toast(`Create Devices from Worksheet: ${many(r.value.made.length, "device")} made${notes.length ? `; ${notes.join("; ")}` : ""}.`, "info");
}

/** A list chosen and read: its circuits, or null having said why there are none. */
async function readList(title: string): Promise<{ src: ListSource; header: number; list: ListCircuit[] } | null> {
  const src = await chooseList(title, true);
  if (!src) return null;
  const found = listHeader(src.rows);
  if (!found) {
    toast(`${src.name} isn't a cable list: no row heads columns Source Device, Source Socket, Destination Device and Destination Socket.`, "info");
    return null;
  }
  const list = listCircuits(src.rows, found.header, found.columns);
  if (!list.length) {
    toast(`${src.name} lists no circuits under its headings.`, "info");
    return null;
  }
  return { src, header: found.header, list };
}

/** The list compared with the active layer's circuits. */
function compared(layerId: string, list: readonly ListCircuit[]) {
  const s = store.session!;
  const sockets = socketsByName(s, layerId);
  const drawn = drawnCircuits(s, layerId);
  return { sockets, drawn, ...compareList(list, drawn, (e) => sockets.has(endKey(e))) };
}

const many = (n: number, one: string, more = `${one}s`): string => `${n} ${n === 1 ? one : more}`;

/**
 * Compare Cable List and Drawing: markup on the active layer where a list and its circuits differ (a
 * number, a circuit only in the list whose sockets are there, a circuit only on the drawing), and
 * the list with a Check column saying what was found for each row.
 */
export async function compareCableList(): Promise<void> {
  const layerId = store.activeLayerId;
  if (!store.session || !layerId) return;
  const read = await readList("Compare Cable List and Drawing");
  if (!read || !store.session) return;
  const { src, header, list } = read;
  const { sockets, drawn, checks, unlisted } = compared(layerId, list);
  const pitch = pitchOn(layerId);
  const byId = new Map(drawn.map((c) => [c.id, c]));
  const named = (c: ListCircuit): string => `${c.number || "(no number)"}: ${c.source.device} : ${c.source.socket} to ${c.destination.device} : ${c.destination.socket}`;
  const issues: Issue[] = [];
  checks.forEach((check: ListCheck, i) => {
    const c = list[i];
    if (check.kind === "number") {
      issues.push({ severity: "Warning", kind: "Cable List", problem: `Circuit number differs: the list has ${c.number}`, information: `${check.drawn || "(no number)"} on the drawing; ${named(c)}`, group: `list:number:${check.id}`, outline: ringAround(byId.get(check.id)!.mid, 0.8 * pitch), layerId });
    } else if (check.kind === "missing") {
      for (const e of [c.source, c.destination]) {
        const at = sockets.get(endKey(e))!.tip;
        issues.push({ severity: "Error", kind: "Cable List", problem: "Circuit in the list isn't on the drawing", information: named(c), group: `list:missing:${c.row}`, outline: ringAround(at, 0.6 * pitch), layerId });
      }
    }
  });
  for (const d of unlisted) issues.push({ severity: "Warning", kind: "Cable List", problem: "Circuit isn't in the list", information: `${d.number || "(no number)"}: ${d.source.device} : ${d.source.socket} to ${d.destination.device} : ${d.destination.socket}`, group: `list:unlisted:${d.id}`, outline: ringAround(d.mid, 0.8 * pitch), layerId });
  const marked = attempt("Compare Cable List and Drawing", (s) => s.batch(() => markIssues(s, layerId, "Cable List", issues)));
  if (!marked) return;
  const count = (kind: ListCheck["kind"]): number => checks.filter((c) => c.kind === kind).length;
  const parts = [
    `${count("ok")} the same`,
    count("number") && many(count("number"), "number differs", "numbers differ"),
    count("missing") && `${many(count("missing"), "circuit")} not on the drawing`,
    count("absent") && `${many(count("absent"), "row")} naming a socket the layer hasn't`,
    unlisted.length && `${many(unlisted.length, "circuit")} not in the list`,
  ].filter(Boolean);
  toast(`Compare Cable List and Drawing: ${parts.join(", ")}${issues.length ? `; marked in the class ${MARKUP_CLASS}` : ""}.`, "info");
  // the list with its Check column: a worksheet when the drawing can hold one, else a dialog
  const rows = checkedRows(src.rows, header, list, checks).map((r, i) => {
    const kept = src.cells[i] ?? [];
    return r.map((text, j): NewSheetCell | null => (j < kept.length ? kept[j] : text ? (i === header ? { value: text, bold: true } : { value: text }) : null));
  });
  await report(`${src.name} Check`, rows);
}

/** Make Connections from List: the list's circuits the active layer hasn't, between sockets it has, drawn and selected. */
export async function makeConnectionsFromList(): Promise<void> {
  const layerId = store.activeLayerId;
  if (!store.session || !layerId) return;
  const read = await readList("Make Connections from List");
  if (!read || !store.session) return;
  const { list } = read;
  const { sockets, checks } = compared(layerId, list);
  const asked = list.flatMap((c, i) =>
    checks[i].kind === "missing" ? [{ from: sockets.get(endKey(c.source))!.ref, to: sockets.get(endKey(c.destination))!.ref, number: c.number, cable: c.cable, label: `${c.source.device} : ${c.source.socket} to ${c.destination.device} : ${c.destination.socket}` }] : [],
  );
  const absent = checks.filter((c) => c.kind === "absent").length;
  if (!asked.length) {
    toast(`Make Connections from List: nothing to connect: ${absent ? `${many(absent, "row")} name${absent === 1 ? "s" : ""} a socket the layer hasn't, and ` : ""}the layer has the rest.`, "info");
    return;
  }
  const r = attempt("Make Connections from List", (s) => s.batch(() => connectFromList(s, asked)));
  if (!r) return;
  setEditGroup(null, r.value.made);
  const notes = [absent && `${many(absent, "row")} named a socket the layer hasn't`, r.value.failed.length && `${r.value.failed.length} couldn't be made (${r.value.failed.slice(0, 3).join("; ")}${r.value.failed.length > 3 ? "…" : ""})`].filter(Boolean);
  toast(`Make Connections from List: ${many(r.value.made.length, "circuit")} made${notes.length ? `; ${notes.join("; ")}` : ""}.`, "info");
}
