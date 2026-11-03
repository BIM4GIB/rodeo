// ConnectCAD's windows and commands: Edit Sockets (a device's sockets in a table, the one clicked first
// in view), Number Cables, Clear Cable Numbers, Connect Selected and Renumber ConnectCAD Objects (Stage >
// ConnectCAD), and a connector panel's Edit Device Array.

import "./connectcad.css";
import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { panelTypes } from "./panelShapes.ts";
import { cableNumbers, connectorsFor, NUMBERING_DIRECTIONS, NUMBERING_SYSTEMS, SIDES, signalNames, SOCKET_TYPES, type NumberingDirection, type NumberingSystem, type Side, type Socket, type SocketType } from "./ccadShapes.ts";
import { labelAt, renamed, renumberOrder, type Labeling } from "./ccadChecks.ts";
import { allConnectors, ccadSettings, circuitsIn, connectorPanelsOf, deviceArrayOf, setDeviceArray, connectOpposite, connectToDevice, deviceAt, deviceOf, numberingOf, renameDevice, setCircuitNumbers, setSockets } from "./schematic.ts";

const options = (select: HTMLSelectElement, values: readonly string[], value: string): void => {
  select.replaceChildren(...values.map((v) => h("option", { value: v, text: v })));
  select.value = values.includes(value) ? value : values[0];
};

interface Row {
  readonly id: number;
  readonly el: HTMLTableRowElement;
  readonly name: HTMLInputElement;
  read(): Socket;
  readonly gone: HTMLInputElement;
}

/** Edit Sockets: every socket of a device, its name, tag, type, side, row, signal, connector and terminator. */
export async function editSockets(deviceId: string, focus?: number): Promise<void> {
  const s = store.session;
  const d = s ? deviceOf(s, deviceId) : null;
  if (!s || !d) return;
  const rows: Row[] = [];
  const body = h("tbody");
  let nextId = Math.max(0, ...d.sockets.map((x) => x.id)) + 1;

  const addRow = (socket: Socket): Row => {
    const cell = (el: HTMLElement): HTMLTableCellElement => h("td", {}, el);
    const name = h("input", { cls: "menu-dialog-input", value: socket.name, attrs: { type: "text", "aria-label": `Name of socket ${socket.id}` } });
    const tag = h("input", { cls: "menu-dialog-input", value: socket.tag, attrs: { type: "text", "aria-label": `Display Tag of socket ${socket.id}` } });
    const type = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Type of socket ${socket.id}` } });
    options(type, SOCKET_TYPES, socket.type);
    const side = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Side of socket ${socket.id}` } }, ...SIDES.map((x) => h("option", { value: x.side, text: x.label })));
    side.value = socket.side;
    const slot = h("input", { cls: "menu-dialog-input ccad-num", value: String(socket.slot + 1), attrs: { type: "number", min: "1", step: "1", "aria-label": `Row of socket ${socket.id}` } });
    const signal = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Signal of socket ${socket.id}` } });
    options(signal, signalNames(), socket.signal);
    const connector = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `Connector of socket ${socket.id}` } });
    options(connector, connectorsFor(signal.value), socket.connector);
    signal.addEventListener("change", () => options(connector, connectorsFor(signal.value), connector.value));
    const terminated = h("input", { checked: socket.terminated, attrs: { type: "checkbox", "aria-label": `Terminated socket ${socket.id}` } });
    const gone = h("input", { attrs: { type: "checkbox", "aria-label": `Delete socket ${socket.id}` } });
    let typedTag = socket.tag !== socket.name;
    tag.addEventListener("input", () => (typedTag = true));
    name.addEventListener("input", () => {
      if (!typedTag) tag.value = name.value;
    });
    const el = h("tr", {}, cell(name), cell(tag), cell(type), cell(side), cell(slot), cell(signal), cell(connector), h("td", { cls: "ccad-centre" }, terminated), h("td", { cls: "ccad-centre" }, gone));
    gone.addEventListener("change", () => el.classList.toggle("ccad-gone", gone.checked));
    body.append(el);
    const row: Row = {
      id: socket.id,
      el,
      name,
      gone,
      read: () => ({ ...socket, id: socket.id, name: name.value.trim(), tag: tag.value.trim(), type: type.value as SocketType, side: side.value as Side, slot: Math.max(0, Math.round(Number(slot.value) || 1) - 1), signal: signal.value, connector: connector.value, terminated: terminated.checked }),
    };
    rows.push(row);
    return row;
  };
  for (const socket of [...d.sockets].sort((a, b) => a.side.localeCompare(b.side) || a.slot - b.slot)) addRow(socket);

  const add = h("button", { cls: "btn", text: "Add Socket", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    const kept = rows.filter((r) => !r.gone.checked).map((r) => r.read());
    const slot = Math.max(-1, ...kept.filter((x) => x.side === "L").map((x) => x.slot)) + 1;
    const names = new Set(kept.map((x) => x.name));
    let n = 1;
    while (names.has(`IN${n}`)) n++;
    const row = addRow({ id: nextId++, name: `IN${n}`, tag: `IN${n}`, type: "IN", side: "L", slot, signal: "SDI", connector: "BNC", terminated: false });
    row.name.focus();
    row.name.select();
  });

  const table = h(
    "table",
    { cls: "ccad-table" },
    h("thead", {}, h("tr", {}, ...["Name", "Display Tag", "Type", "Side", "Row", "Signal", "Connector on Cable", "Terminated", "Delete"].map((t) => h("th", { text: t })))),
    body,
  );
  const opened = showDialog<Socket[]>({
    title: `Edit Sockets: ${d.name}`,
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("div", { cls: "ccad-scroll" }, table),
      h("div", { cls: "ccad-actions" }, add),
      h("p", { cls: "muted", text: "Socket names must be unique on the device. A circuit stays with its socket through a rename or a move; one whose socket is deleted keeps its run and shows a warning triangle. A terminated socket can't be connected." }),
    ],
    check: () => {
      const kept = rows.filter((r) => !r.gone.checked);
      const sockets = kept.map((r) => r.read());
      const seen = new Map<string, Row>();
      const places = new Set<string>();
      for (const [i, socket] of sockets.entries()) {
        if (!socket.name) return { error: "Every socket needs a name.", focus: kept[i].name };
        if (seen.has(socket.name)) return { error: `Two sockets are named ${socket.name}: socket names must be unique on a device.`, focus: kept[i].name };
        seen.set(socket.name, kept[i]);
        const place = `${socket.side}${socket.slot}`;
        if (places.has(place)) return { error: `Two sockets are on row ${socket.slot + 1} of the ${SIDES.find((x) => x.side === socket.side)!.label.toLowerCase()} side.`, focus: kept[i].name };
        places.add(place);
      }
      return { value: sockets.map((x) => (x.tag ? x : { ...x, tag: x.name })) };
    },
  });
  const focused = rows.find((r) => r.id === focus);
  if (focused) {
    focused.el.classList.add("ccad-focus");
    focused.el.scrollIntoView({ block: "nearest" });
    focused.name.focus();
    focused.name.select();
  }
  const sockets = await opened;
  if (!sockets) return;
  attempt("Edit Sockets", (session) => session.batch(() => setSockets(session, deviceId, sockets)));
}

/** Number Cables' choices; its system starts as the drawing's ConnectCAD Settings say (settings.ts) */
export const numbering = {
  system: NUMBERING_SYSTEMS[0] as NumberingSystem,
  direction: NUMBERING_DIRECTIONS[0] as NumberingDirection,
  digits: 3,
};

/** The circuits a command works on: those selected, or every one on the active layer. */
function scope(selectedOnly: boolean): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return [];
  const all = circuitsIn(s, layerId).map((c) => c.id);
  return selectedOnly ? all.filter((id) => store.selection.has(id)) : all;
}

/** Number Cables: numbers for the layer's circuits that have none, or the selected ones'. */
export async function numberCables(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const select = (label: string, values: readonly string[], value: string): HTMLSelectElement => {
    const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } });
    options(el, values, value);
    return el;
  };
  const anySelected = scope(true).length > 0;
  const system = select("Numbering System", NUMBERING_SYSTEMS, numbering.system);
  const which = select("Number", ["All circuits in the layer", "Only selected circuits"], anySelected ? "Only selected circuits" : "All circuits in the layer");
  const direction = select("Numbering Direction", NUMBERING_DIRECTIONS, numbering.direction);
  const digits = h("input", { cls: "menu-dialog-input", value: String(numbering.digits), attrs: { type: "number", min: "1", max: "6", step: "1", "aria-label": "Number Format (digits)" } });
  const chosen = await showDialog<{ ids: string[] }>({
    title: "Number Cables",
    okLabel: "OK",
    body: [
      field("Numbering System", system),
      field("Number", which),
      field("Numbering Direction", direction),
      field("Number Format (digits)", digits),
      h("p", { cls: "muted", text: "Circuits that have a number keep it, and no new number repeats one in the drawing. Signal and Sequence numbers by the signal's letter (V001, A001…); the others by the source device and its socket, or one sequence. Drawing Order numbers circuits in the order they were drawn." }),
    ],
    check: () => {
      const n = Math.round(Number(digits.value));
      if (!(n >= 1 && n <= 6)) return { error: "Number Format: from 1 to 6 digits.", focus: digits };
      const ids = scope(which.value === "Only selected circuits");
      if (!ids.length) return { error: which.value === "Only selected circuits" ? "No circuits are selected." : "The active layer has no circuits.", focus: which };
      numbering.system = system.value as NumberingSystem;
      numbering.direction = direction.value as NumberingDirection;
      numbering.digits = n;
      return { value: { ids } };
    },
  });
  if (!chosen) return;
  const r = attempt("Number Cables", (session) =>
    session.batch(() => {
      const wanted = new Set(chosen.ids);
      const all = circuitsIn(session).map((c) => numberingOf(session, c));
      const taken = new Set(all.map((c) => c.number).filter(Boolean));
      const numbers = cableNumbers(
        all.filter((c) => wanted.has(c.id) && !c.number),
        numbering.system,
        numbering.direction,
        numbering.digits,
        taken,
      );
      setCircuitNumbers(session, numbers);
      return numbers.size;
    }),
  );
  if (r) toast(r.value ? `${r.value} circuit${r.value === 1 ? "" : "s"} numbered.` : "Every circuit there has a number already: Clear Cable Numbers first to number them again.", "info");
}

/** Clear Cable Numbers: the selected circuits' numbers, or every one's on the active layer, after a yes. */
export async function clearCableNumbers(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const selected = scope(true);
  const ids = selected.length ? selected : scope(false);
  if (!ids.length) {
    toast("The active layer has no circuits.", "info");
    return;
  }
  const ok = await showDialog<true>({
    title: "Clear Cable Numbers",
    okLabel: "Clear",
    body: [h("p", { text: `Clear the numbers of ${selected.length ? "the" : "all"} ${ids.length} ${selected.length ? "selected " : ""}circuit${ids.length === 1 ? "" : "s"}${selected.length ? "" : " on this layer"}?` })],
    check: () => ({ value: true }),
  });
  if (!ok) return;
  attempt("Clear Cable Numbers", (session) => session.batch(() => setCircuitNumbers(session, new Map(ids.map((id) => [id, ""])))));
}

/** Connect Selected: devices side by side joined socket to opposite socket; otherwise, the next click picks the device to join them to. */
export function connectSelected(): void {
  const s = store.session;
  if (!s) return;
  const ids = [...store.selection].filter((id) => deviceOf(s, id));
  if (!ids.length) {
    toast("Select the devices to connect.", "info");
    return;
  }
  const done = (n: number): void => toast(n ? `${n} circuit${n === 1 ? "" : "s"} connected.` : "Nothing to connect: no free sockets of the same signal face each other.", "info");
  if (ids.length >= 2) {
    const r = attempt("Connect Selected", (session) => session.batch(() => connectOpposite(session, ids, ccadSettings.circuitType)));
    if (!r) return;
    if (r.value.length) {
      setSelection(r.value);
      done(r.value.length);
      return;
    }
  }
  placeAtNextClick({
    what: "the device to connect the selected devices to",
    place(at) {
      const session = store.session;
      const layerId = store.activeLayerId;
      const here = session && layerId ? deviceAt(session, layerId, at) : null;
      if (!here || ids.includes(here.device.rec.id)) {
        toast("That isn't another device: run Connect Selected again and click the device to connect to.", "info");
        return;
      }
      const r = attempt("Connect Selected", (x) => x.batch(() => connectToDevice(x, ids, here.device.rec.id, ccadSettings.circuitType)));
      if (!r) return;
      if (r.value.length) setSelection(r.value);
      done(r.value.length);
    },
  });
}

const renumbering: Labeling & { namePrefix: string; tagPrefix: string; direction: (typeof NUMBERING_DIRECTIONS)[number] } = {
  style: "Numeric",
  start: "1",
  increment: 1,
  digits: 1,
  upper: true,
  delimiter: "",
  namePrefix: "",
  tagPrefix: "",
  direction: "Drawing Order",
};
const DELIMITERS: readonly { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "-", label: "-" },
  { value: "_", label: "_" },
  { value: ".", label: "." },
  { value: " ", label: "Space" },
];

/** Renumber ConnectCAD Objects: the selected devices' names and display tags numbered, or lettered, in order. */
export async function renumberObjects(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const selected = [...store.selection];
  const devices = selected.map((id) => deviceOf(s, id)).filter((d) => d !== null);
  if (!devices.length || devices.length !== selected.length) {
    toast(devices.length ? "Select only devices: objects of different types can't be renumbered together." : "Select the devices to renumber.", "info");
    return;
  }
  const field = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const select = (label: string, values: readonly { value: string; label: string }[], value: string): HTMLSelectElement => {
    const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...values.map((v) => h("option", { value: v.value, text: v.label })));
    el.value = value;
    return el;
  };
  const input = (label: string, value: string, type = "text"): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type, "aria-label": label } });
  const r0 = renumbering;
  const style = select("Labeling", ["Numeric", "Alpha"].map((v) => ({ value: v, label: v })), r0.style);
  const start = input("Start", r0.start);
  const increment = input("Increment by", String(r0.increment), "number");
  const digits = input("Format (digits)", String(r0.digits), "number");
  const letterCase = select("Case", ["Upper", "Lower"].map((v) => ({ value: v, label: v })), r0.upper ? "Upper" : "Lower");
  const delimiter = select("Delimiter", DELIMITERS, r0.delimiter);
  const namePrefix = input("Prefix Name", r0.namePrefix);
  const tagPrefix = input("Prefix Display Tag", r0.tagPrefix);
  const direction = select("Numbering Direction", NUMBERING_DIRECTIONS.map((v) => ({ value: v, label: v })), r0.direction);
  const example = h("p", { cls: "muted" });
  const digitsRow = field("Format (digits)", digits);
  const caseRow = field("Case", letterCase);
  const read = (): (Labeling & { namePrefix: string; tagPrefix: string; direction: (typeof NUMBERING_DIRECTIONS)[number] }) | string => {
    const alpha = style.value === "Alpha";
    const startText = start.value.trim();
    if (alpha ? !/^[A-Za-z]+$/.test(startText) : !/^-?\d+$/.test(startText)) return alpha ? "Start: letters, A to Z." : "Start: a whole number.";
    const inc = Math.round(Number(increment.value));
    if (!(inc >= 1)) return "Increment by: 1 or more.";
    const n = Math.round(Number(digits.value));
    if (!alpha && !(n >= 1 && n <= 6)) return "Format: from 1 to 6 digits.";
    return { style: alpha ? "Alpha" : "Numeric", start: startText, increment: inc, digits: alpha ? 1 : n, upper: letterCase.value === "Upper", delimiter: delimiter.value, namePrefix: namePrefix.value.trim(), tagPrefix: tagPrefix.value.trim(), direction: direction.value as (typeof NUMBERING_DIRECTIONS)[number] };
  };
  const ordered = (r: { direction: (typeof NUMBERING_DIRECTIONS)[number] }) => renumberOrder(devices, r.direction);
  const sync = (): void => {
    const alpha = style.value === "Alpha";
    digitsRow.hidden = alpha;
    caseRow.hidden = !alpha;
    const r = read();
    if (typeof r === "string") {
      example.textContent = r;
      return;
    }
    const first = ordered(r).slice(0, 3);
    example.textContent = `Example: ${first.map((d, k) => renamed(d.name, r.namePrefix, labelAt(k, r), r.delimiter)).join(", ")}${devices.length > 3 ? "…" : ""}`;
  };
  for (const el of [style, start, increment, digits, letterCase, delimiter, namePrefix, tagPrefix, direction]) el.addEventListener("input", sync);
  style.addEventListener("change", () => {
    start.value = style.value === "Alpha" ? "A" : "1";
    sync();
  });
  sync();
  const chosen = await showDialog<Exclude<ReturnType<typeof read>, string>>({
    title: "Renumber ConnectCAD Objects",
    okLabel: "OK",
    body: [field("Labeling", style), field("Start", start), field("Increment by", increment), digitsRow, caseRow, field("Delimiter", delimiter), field("Prefix Name", namePrefix), field("Prefix Display Tag", tagPrefix), field("Numbering Direction", direction), example, h("p", { cls: "muted", text: "Each device's name keeps its own stem (the name without its number) unless Prefix Name gives one, and its display tag likewise. Circuits read the new names." })],
    check: () => {
      const r = read();
      if (typeof r === "string") return { error: r, focus: start };
      return { value: r };
    },
  });
  if (!chosen) return;
  Object.assign(renumbering, chosen);
  attempt("Renumber ConnectCAD Objects", (session) =>
    session.batch(() => {
      ordered(chosen).forEach((d, k) => {
        const label = labelAt(k, chosen);
        renameDevice(session, d.rec.id, renamed(d.name, chosen.namePrefix, label, chosen.delimiter), renamed(d.tag, chosen.tagPrefix, label, chosen.delimiter));
      });
    }),
  );
}

/**
 * Edit Device Array (Connector Panel Settings): the connector panels selected, or the one whose Object
 * Info button was pressed, given a type, panel, port code, connector and number of circuits; one's
 * Port/# set, several's ports renumbered from the number when asked, in order down the drawing.
 */
export async function editDeviceArray(deviceId: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  const picked = connectorPanelsOf(s, store.selection.has(deviceId) ? store.selection : [deviceId]);
  const ids = picked.length ? picked : [deviceId];
  const now = deviceArrayOf(s, ids[0]);
  if (!now) return;
  const several = ids.length > 1;
  const v = await toolPrefs(
    "Connector Panel Settings",
    [
      { kind: "choice", key: "type", label: "Connector Type", value: now.type, options: panelTypes("connector").map((t) => ({ value: t.device, label: t.device.replace("Connector Panel ", "") })) },
      { kind: "text", key: "panel", label: "Panel", value: now.panel },
      { kind: "text", key: "code", label: "Port Code", value: now.code },
      ...(several ? [{ kind: "check" as const, key: "renumber", label: "Renumber ports", value: false }] : []),
      { kind: "number", key: "number", label: several ? "From Number (0 for ---)" : "Number (0 for ---)", value: now.number ?? 1, min: 0, max: 999, integer: true },
      { kind: "choice", key: "connector", label: "Connector", value: now.connector, options: [...new Set([...allConnectors(), now.connector])].map((value) => ({ value, label: value })) },
      { kind: "number", key: "circuits", label: "# Circuits", value: now.circuits, min: 1, max: 100, integer: true },
    ],
    several
      ? `${ids.length} connector panels. Each takes the type, panel, port code, connector and number of circuits; Renumber ports numbers them on from the number, top to bottom and then left to right. A multi-circuit connector has a row for each circuit.`
      : "The device takes the type, panel, port and connector; a multi-circuit connector has a row for each circuit. Its name and tag follow the panel while they're its own.",
  );
  if (!v) return;
  const number = several && !v.flag("renumber") ? null : v.num("number");
  const r = attempt("Edit Device Array", (session) =>
    session.batch(() => setDeviceArray(session, ids, { type: v.choice("type"), panel: v.choice("panel").trim() || now.panel, code: v.choice("code"), number, connector: v.choice("connector"), circuits: v.num("circuits") })),
  );
  if (r) toast(`Edit Device Array: ${ids.length} connector panel${ids.length > 1 ? "s" : ""} set.`);
}
