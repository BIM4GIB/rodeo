// ConnectCAD's connector panel layouts: a panel drawn at its actual size on a design layer ('Rodeo
// Panel Layout'), its connectors linked by name to the sockets of the schematic device it's named
// for. Stage > ConnectCAD > Create Panel View makes one for each panel device asked for; in Object
// Info, the Panel Builder lays out a new set of connectors, Edit Connectors (or a double-click) edits
// them, Create Schematic Devices makes the device a custom layout stands for, and Update From
// Schematic brings its connectors in line with the device's sockets. The Panel Connector tool
// (panelTools.ts) adds connectors to a layout, or starts one. What each connector is connected to
// follows the schematic as it changes. panelLayoutShapes.ts has the sums.

import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext, followEdits, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import { nextName, UNKNOWN, type Socket } from "./ccadShapes.ts";
import { natural } from "./ccadReports.ts";
import {
  appendConnectors,
  ARRANGEMENTS,
  buildPanel,
  connectedTo,
  connectorWriting,
  footprint,
  LAYOUT_TYPES,
  layoutBox,
  panelMarks,
  RACK_OPENINGS,
  unitsNeeded,
  type Arrangement,
  type BuilderRow,
  type LayoutType,
  type Mark,
  type PanelConnector,
  type PanelSpec,
  type PortEnd,
} from "./panelLayoutShapes.ts";
import { panelTypeOf } from "./panelShapes.ts";
import { addDevice, allConnectors, deviceNames, deviceRackOf, devicesOn, deviceTypeOf, isPanel, renameDevice, reportFacts, setSockets } from "./schematic.ts";

export const PANEL_LAYOUT = "Rodeo Panel Layout";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const F = {
  name: "Device Name",
  type: "Device Type",
  layout: "Panel Type",
  ru: "Rack Units",
  opening: "Rack Opening",
  width: "Width",
  height: "Height",
  holes: "Mounting Holes",
  offset: "Text Vertical Offset",
  showTag: "Show Display Tag",
  showDevice: "Show Connected Device",
  showSocket: "Show Connected Socket",
  /** its connectors, [x, y, tag, socket, connector] from its insertion: kept out of Object Info */
  connectors: "Connectors",
  /** what each connector is connected to, [device, socket] or null, as the schematic last had it */
  connected: "Connected To",
} as const;

/** the writing's height and line spacing, at actual size, mm */
const TEXT_MM = 2.5;
const LINE_MM = 3;
const OUTLINE_MILS = 7;

interface Rec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function recOf(doc: VwxDocument, id: string): Rec | null {
  const rec = doc.object(id)?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === PANEL_LAYOUT) : undefined;
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

function recsIn(doc: VwxDocument): Rec[] {
  if (!doc.hasPluginFormat(PANEL_LAYOUT)) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).flatMap((o) => (o.type === PLUGIN ? [recOf(doc, o.id)].filter((r): r is Rec => !!r) : [])));
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const num = (v: RecordValue | undefined, or = 0): number => (typeof v === "number" ? v : Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : or);
const ink = (hex: string): number => colorMatcher()({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4;
const connectorsText = (list: readonly PanelConnector[]): string => JSON.stringify(list.map((c) => [round(c.x), round(c.y), c.tag, c.socket, c.connector]));

function readConnectors(text: string): PanelConnector[] {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw)
      ? raw.flatMap((c): PanelConnector[] => (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [{ x: Number(c[0]), y: Number(c[1]), tag: String(c[2] ?? ""), socket: String(c[3] ?? ""), connector: String(c[4] ?? UNKNOWN) }] : []))
      : [];
  } catch {
    return [];
  }
}

type To = { device: string; socket: string } | null;
function readConnected(text: string): To[] {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.map((t): To => (Array.isArray(t) ? { device: String(t[0] ?? ""), socket: String(t[1] ?? "") } : null)) : [];
  } catch {
    return [];
  }
}
const connectedText = (list: readonly To[]): string => JSON.stringify(list.map((t) => (t ? [t.device, t.socket] : null)));

/** A layout as its fields have it. */
interface Layout {
  readonly rec: Rec;
  readonly name: string;
  readonly spec: PanelSpec;
  readonly connectors: PanelConnector[];
  readonly connected: To[];
  readonly show: { tag: boolean; device: boolean; socket: boolean };
  readonly offset: number;
}

function layoutOf(doc: VwxDocument, id: string): Layout | null {
  const r = recOf(doc, id);
  if (!r) return null;
  const type = str(r.value(F.layout)) as LayoutType;
  return {
    rec: r,
    name: str(r.value(F.name)).trim(),
    spec: {
      type: LAYOUT_TYPES.includes(type) ? type : "No Graphics",
      ru: num(r.value(F.ru), 1),
      opening: str(r.value(F.opening)) || RACK_OPENINGS[0],
      width: num(r.value(F.width), 200),
      height: num(r.value(F.height), 100),
      holes: r.value(F.holes) === true,
    },
    connectors: readConnectors(str(r.value(F.connectors))),
    connected: readConnected(str(r.value(F.connected))),
    show: { tag: r.value(F.showTag) !== false, device: r.value(F.showDevice) !== false, socket: r.value(F.showSocket) === true },
    offset: num(r.value(F.offset), 1),
  };
}

/** the room the writing over a connector takes */
const writingRoom = (l: Pick<Layout, "show" | "offset">): number => [l.show.tag, l.show.device, l.show.socket].filter(Boolean).length * LINE_MM + l.offset;

const specsFor = (v: Partial<Record<string, RecordValue>>): PluginFieldSpec[] => [
  { name: F.name, type: TEXT, value: v[F.name] ?? "" },
  { name: F.type, type: TEXT, value: v[F.type] ?? "" },
  { name: F.layout, type: POPUP, value: v[F.layout] ?? "Rack-mount" },
  { name: F.ru, type: NUMBER, value: v[F.ru] ?? 1 },
  { name: F.opening, type: POPUP, value: v[F.opening] ?? RACK_OPENINGS[0] },
  { name: F.width, type: DIMENSION, value: v[F.width] ?? 200 },
  { name: F.height, type: DIMENSION, value: v[F.height] ?? 100 },
  { name: F.holes, type: BOOL, value: v[F.holes] ?? true },
  { name: F.offset, type: DIMENSION, value: v[F.offset] ?? 1 },
  { name: F.showTag, type: BOOL, value: v[F.showTag] ?? true },
  { name: F.showDevice, type: BOOL, value: v[F.showDevice] ?? true },
  { name: F.showSocket, type: BOOL, value: v[F.showSocket] ?? false },
  { name: F.connectors, type: TEXT, value: v[F.connectors] ?? "[]" },
  { name: F.connected, type: TEXT, value: v[F.connected] ?? "[]" },
];

// ---- the schematic, as layouts read it

/** A device name's sockets (a panel's ports), each once with its connector, and its Device Type. */
interface Named {
  readonly type: string;
  readonly sockets: readonly { readonly name: string; readonly connector: string }[];
}

/** What layouts take from the schematic: each device name's sockets, and the far ends of the circuits at each socket. */
interface Schematic {
  readonly devices: ReadonlyMap<string, Named>;
  readonly ends: ReadonlyMap<string, PortEnd[]>;
}

const endKey = (device: string, socket: string): string => `${device}\u0000${socket}`;

function schematicOf(s: EditSession): Schematic {
  const devices = new Map<string, { type: string; sockets: Map<string, string>; panel: boolean; jack: boolean; rack: boolean }>();
  for (const d of devicesOn(s)) {
    if (d.kind === "adapter" || !d.name) continue;
    const type = deviceTypeOf(d);
    const kind = panelTypeOf(type)?.kind;
    const had = devices.get(d.name) ?? { type, sockets: new Map<string, string>(), panel: isPanel(d), jack: kind === "jack" || kind === "linked", rack: false };
    for (const k of [...d.sockets].sort((a, b) => a.side.localeCompare(b.side) || a.slot - b.slot)) if (!had.sockets.has(k.name)) had.sockets.set(k.name, k.connector);
    devices.set(d.name, { ...had, rack: had.rack || !!deviceRackOf(d) });
  }
  const ends = new Map<string, PortEnd[]>();
  const add = (at: string, socket: string, end: Omit<PortEnd, "rack" | "jack" | "panel">): void => {
    const d = devices.get(end.device);
    const k = endKey(at, socket);
    ends.set(k, [...(ends.get(k) ?? []), { ...end, rack: !!d?.rack, jack: !!d?.jack, panel: !!d?.panel && !d.jack }]);
  };
  for (const c of reportFacts(s).circuits) {
    if (!c.sourceSocket || !c.destinationSocket) continue;
    add(c.sourceDevice, c.sourceSocket, { device: c.destinationDevice, socket: c.destinationSocket, source: false });
    add(c.destinationDevice, c.destinationSocket, { device: c.sourceDevice, socket: c.sourceSocket, source: true });
  }
  const named = new Map<string, Named>();
  for (const [name, d] of devices) {
    const sockets = [...d.sockets].map(([n, connector]) => ({ name: n, connector }));
    named.set(name, { type: d.type, sockets: d.panel ? sockets.sort((a, b) => natural(a.name, b.name)) : sockets });
  }
  return { devices: named, ends };
}

/** What each connector of a layout is connected to, as the schematic has it. */
const connectedFor = (l: Pick<Layout, "name" | "connectors">, sch: Schematic): To[] =>
  l.connectors.map((c) => {
    const e = c.socket ? connectedTo(sch.ends.get(endKey(l.name, c.socket)) ?? []) : null;
    return e ? { device: e.device, socket: e.socket } : null;
  });

// ---- drawing

const circle = (at: Pt, r: number): Pt[] => Array.from({ length: 24 }, (_, k) => ({ x: at.x + r * Math.cos((k * Math.PI) / 12), y: at.y + r * Math.sin((k * Math.PI) / 12) }));

/** Draws layout `id` from its fields, in the session's open batch. */
function drawLayout(s: EditSession, id: string): void {
  const l = layoutOf(s.doc, id);
  if (!l) throw new Error("That isn't a panel layout.");
  const black = ink("#000000");
  const face = ink("#e8e8e8");
  const white = ink("#ffffff");
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  const draw = (m: Mark, fill: number | null): void => {
    const filled = m.kind !== "outline" && (m.kind === "ring" || m.kind === "box") && m.fill;
    const look: Partial<Attributes> = filled
      ? { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 1, fillFore: black, fillBack: black, fillOpacity: 100 }
      : fill === null || m.kind === "outline"
        ? { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 0 }
        : { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: 100 };
    if (m.kind === "ring") shapes.push({ kind: "polygon", points: circle(m.at, m.r), closed: true } as NewShape);
    else if (m.kind === "box") shapes.push({ kind: "polygon", points: [{ x: m.x0, y: m.y0 }, { x: m.x1, y: m.y0 }, { x: m.x1, y: m.y1 }, { x: m.x0, y: m.y1 }], closed: true } as NewShape);
    else shapes.push({ kind: "polyline", points: [...m.points], closed: false } as NewShape);
    looks.push(look);
  };
  // the panel's face, then its holes in white
  panelMarks(l.spec).forEach((m, i) => draw(m, i === 0 ? face : white));
  l.connectors.forEach((c, i) => {
    const f = footprint(c.connector);
    f.marks({ x: c.x, y: c.y }).forEach((m, k) => draw(m, k === 0 ? white : null));
    const lines = connectorWriting(c, l.connected[i] ?? null, l.show);
    if (lines.length) {
      shapes.push({ kind: "text", at: { x: c.x, y: c.y + f.height / 2 + l.offset }, text: lines.join("\r"), height: TEXT_MM, hAlign: 2, vAlign: 5, angle: 0 } as NewShape);
      looks.push({ penFore: black, fillPattern: 0 });
    }
  });
  // with no panel and no connectors, a dashed box to find it by
  if (!shapes.length) {
    shapes.push({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: -40 }, { x: 0, y: -40 }], closed: true } as NewShape);
    looks.push({ penFore: black, fillPattern: 0, lineStyle: 2 });
  }
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  s.setPluginDrawing(id, s.addObjects(l.rec.layerId, shapes, classIndex, looks));
}

/** Sets a layout's fields that differ, in the session's open batch. */
function write(s: EditSession, r: Rec, values: Readonly<Record<string, RecordValue>>): void {
  for (const [field, value] of Object.entries(values)) if (r.value(field) !== value) s.setRecordField(r.id, r.format, field, value);
}

/** Gives layout `id` new connectors (with what they're connected to, and the rack units they need) and draws it again, in the session's open batch. */
function setConnectors(s: EditSession, id: string, connectors: readonly PanelConnector[], sch: Schematic = schematicOf(s)): void {
  const l = layoutOf(s.doc, id);
  if (!l) throw new Error("That isn't a panel layout.");
  const next = { ...l, connectors: [...connectors] };
  write(s, l.rec, {
    [F.connectors]: connectorsText(connectors),
    [F.connected]: connectedText(connectedFor(next, sch)),
    [F.ru]: unitsNeeded(connectors, l.spec),
    ...(sch.devices.get(l.name) ? { [F.type]: sch.devices.get(l.name)!.type } : {}),
  });
  drawLayout(s, id);
}

/** A new layout on a layer, its top left at `at`, as part of a batch; its id. */
export function addPanelLayout(s: EditSession, layerId: string, at: Pt, values: Partial<Record<string, RecordValue>>, connectors: readonly PanelConnector[]): string {
  s.growPluginFields(PANEL_LAYOUT, specsFor({}));
  const specs = specsFor({ ...values, [F.connectors]: connectorsText(connectors) });
  const id = s.addPluginObject(layerId, PANEL_LAYOUT, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  setConnectors(s, id, connectors);
  return id;
}

/** The layouts on a layer, with their frames, for the Panel Connector tool. */
export function panelLayoutsOn(doc: VwxDocument, layerId: string): { id: string; name: string; panel: boolean; box: { x0: number; y0: number; x1: number; y1: number } | null; toLocal(p: Pt): Pt; toWorld(p: Pt): Pt }[] {
  return recsIn(doc).flatMap((r) => {
    const l = r.layerId === layerId ? layoutOf(doc, r.id) : null;
    const o = doc.object(r.id);
    if (!l || !o) return [];
    return [{ id: r.id, name: l.name, panel: l.spec.type !== "No Graphics", box: layoutBox(l.spec, l.connectors, writingRoom(l)), ...placeOf(o) }];
  });
}

/** The sockets a layout's device has, in order; [] when it has none or isn't linked. */
export function layoutSockets(s: EditSession, id: string): string[] {
  const l = layoutOf(s.doc, id);
  return l ? (schematicOf(s).devices.get(l.name)?.sockets.map((k) => k.name) ?? []) : [];
}

/** Adds connectors to layout `id` at points on the drawing, as part of a batch: each tagged, linked to a socket of its device or not. */
export function addConnectors(s: EditSession, id: string, at: readonly Pt[], made: readonly Omit<PanelConnector, "x" | "y">[]): void {
  const l = layoutOf(s.doc, id);
  const o = s.doc.object(id);
  if (!l || !o) throw new Error("That isn't a panel layout.");
  const { toLocal } = placeOf(o);
  setConnectors(s, id, [...l.connectors, ...at.map((p, i) => ({ ...toLocal(p), ...made[i] }))]);
}

// ---- the Object Info buttons

/** Update From Schematic: connectors linked to sockets the device no longer has are let go, and its sockets without a connector get one each. */
function updateFromSchematic(id: string): void {
  attempt("Update From Schematic", (s) =>
    s.batch(() => {
      const l = layoutOf(s.doc, id);
      if (!l) throw new Error("That isn't a panel layout.");
      const sch = schematicOf(s);
      const d = sch.devices.get(l.name);
      if (!d) throw new Error(l.name ? `No device is named ${l.name}.` : "Give the layout a Device Name first.");
      const names = new Set(d.sockets.map((k) => k.name));
      const kept = l.connectors.map((c) => (c.socket && !names.has(c.socket) ? { ...c, socket: "" } : c));
      const linked = new Set(kept.map((c) => c.socket));
      const missing = d.sockets.filter((k) => !linked.has(k.name)).map((k) => ({ tag: k.name, socket: k.name, connector: k.connector }));
      setConnectors(s, id, appendConnectors(kept, missing, l.spec, writingRoom(l)), sch);
      return missing.length;
    }),
  );
}

const selectOf = (label: string, options: readonly string[], value: string, names: (v: string) => string = (v) => v): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...[...new Set([...options, value])].map((v) => h("option", { value: v, text: names(v) }))) as HTMLSelectElement;
  el.value = value;
  return el;
};
const lengthOf = (label: string, mm: number, units: string | undefined): HTMLInputElement => h("input", { cls: "menu-dialog-input ccad-num", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } }) as HTMLInputElement;
const field = (label: string, control: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);

/** the connector types the dialogs offer */
const connectorChoices = (): string[] => [...new Set([...allConnectors(), "XLR3", "BNC", "RJ45", "TRS", "LC", "HDMI", "USB", "Phoenix"])];

/** The Panel Builder: rows of connectors and the panel they go on; the layout's connectors replaced. */
async function panelBuilder(id: string): Promise<void> {
  const s = store.session;
  const l = s ? layoutOf(s.doc, id) : null;
  if (!s || !l) return;
  if (l.connectors.length) {
    const sure = await showDialog<boolean>({ title: "Panel Builder", okLabel: "Build", body: [h("p", { text: "Build a new panel? Its connectors will be replaced by the ones you build." })], check: () => ({ value: true }) });
    if (!sure) return;
  }
  const units = s.doc.info.units;
  const body = h("tbody");
  const addRow = (r: BuilderRow): void => {
    const qty = h("input", { cls: "menu-dialog-input ccad-num", value: String(r.qty), attrs: { type: "number", min: "1", step: "1", "aria-label": "Qty" } }) as HTMLInputElement;
    const connector = selectOf("Panel Connector Symbol", connectorChoices(), r.connector);
    const prefix = h("input", { cls: "menu-dialog-input", value: r.prefix, attrs: { type: "text", "aria-label": "Name Prefix" } }) as HTMLInputElement;
    const arrange = selectOf("Layout", ARRANGEMENTS, r.arrange);
    const dup = h("button", { cls: "btn", text: "Duplicate", attrs: { type: "button" } });
    const del = h("button", { cls: "btn", text: "Delete", attrs: { type: "button" } });
    const tr = h("tr", {}, h("td", {}, qty), h("td", {}, connector), h("td", {}, prefix), h("td", {}, arrange), h("td", {}, dup, del)) as HTMLTableRowElement & { read?: () => BuilderRow };
    tr.read = () => ({ qty: Math.max(0, Math.round(Number(qty.value) || 0)), connector: connector.value, prefix: prefix.value.trim(), arrange: arrange.value as Arrangement });
    dup.addEventListener("click", () => addRow(tr.read!()));
    del.addEventListener("click", () => tr.remove());
    body.append(tr);
  };
  addRow({ qty: 8, connector: "XLR3", prefix: "IN", arrange: "Horizontal" });
  const add = h("button", { cls: "btn", text: "Add", attrs: { type: "button" } });
  add.addEventListener("click", () => addRow({ qty: 1, connector: "XLR3", prefix: "", arrange: "Horizontal" }));
  const type = selectOf("Panel Type", ["No Graphics", "Rack-mount", "Custom"], l.spec.type, (v) => (v === "No Graphics" ? "Create no graphics" : v));
  const ru = h("input", { cls: "menu-dialog-input ccad-num", value: String(l.spec.ru), attrs: { type: "number", min: "1", step: "1", "aria-label": "Rack Units" } }) as HTMLInputElement;
  const opening = selectOf("Rack Opening", RACK_OPENINGS, l.spec.opening);
  const width = lengthOf("Width", l.spec.width, units);
  const height = lengthOf("Height", l.spec.height, units);
  const holes = h("input", { checked: l.spec.holes, attrs: { type: "checkbox", "aria-label": "Mounting Holes" } }) as HTMLInputElement;
  const suffix = lengthSuffix(units);
  const v = await showDialog<{ rows: BuilderRow[]; spec: PanelSpec }>({
    title: "Panel Builder",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("p", { cls: "menu-dialog-label", text: "Connector Configuration" }),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Qty", "Panel Connector Symbol", "Name Prefix", "Layout", ""].map((t) => h("th", { text: t })))), body)),
      h("div", { cls: "ccad-actions" }, add),
      field("Panel Type", type),
      field("Rack Units (Rack-mount)", ru),
      field("Rack Opening (Rack-mount)", opening),
      field("Width (Custom)", width, suffix),
      field("Height (Custom)", height, suffix),
      h("label", { cls: "menu-dialog-check" }, holes, h("span", { text: "Mounting holes (Custom)" })),
      h("p", { cls: "muted", text: "Connectors go on from the top left, each row a block: a line across (wrapping at the panel's side), a column, or a square. A rack-mount panel grows to the units they need." }),
    ],
    check: () => {
      const rows = [...body.querySelectorAll("tr")].map((tr) => (tr as HTMLTableRowElement & { read?: () => BuilderRow }).read?.()).filter((r): r is BuilderRow => !!r && r.qty > 0);
      if (!rows.length) return { error: "Add a row of connectors.", focus: add };
      const w = parseLength(width.value, units);
      const hh = parseLength(height.value, units);
      if (type.value === "Custom" && (w === null || w <= 0)) return { error: "Enter the panel's width.", focus: width };
      if (type.value === "Custom" && (hh === null || hh <= 0)) return { error: "Enter the panel's height.", focus: height };
      return { value: { rows, spec: { type: type.value as LayoutType, ru: Math.max(1, Math.round(Number(ru.value) || 1)), opening: opening.value, width: w ?? l.spec.width, height: hh ?? l.spec.height, holes: holes.checked } } };
    },
  });
  if (!v || store.session !== s) return;
  attempt("Panel Builder", (session) =>
    session.batch(() => {
      const now = layoutOf(session.doc, id);
      if (!now) throw new Error("That isn't a panel layout.");
      write(session, now.rec, { [F.layout]: v.spec.type, [F.ru]: v.spec.ru, [F.opening]: v.spec.opening, [F.width]: v.spec.width, [F.height]: v.spec.height, [F.holes]: v.spec.holes });
      const built = buildPanel(v.rows, v.spec, writingRoom(now));
      setConnectors(session, id, built.connectors);
    }),
  );
}

/** Edit Connectors: each connector's tag, linked socket, type and place, or its deletion. */
async function editConnectors(id: string): Promise<void> {
  const s = store.session;
  const l = s ? layoutOf(s.doc, id) : null;
  if (!s || !l) return;
  const units = s.doc.info.units;
  const sockets = layoutSockets(s, id);
  const body = h("tbody");
  const reads: (() => PanelConnector | null | string)[] = [];
  for (const c of l.connectors) {
    const tag = h("input", { cls: "menu-dialog-input", value: c.tag, attrs: { type: "text", "aria-label": `Display Tag of ${c.tag}` } }) as HTMLInputElement;
    const socket = selectOf(`Linked to Socket of ${c.tag}`, ["", ...sockets], c.socket, (v) => v || "None");
    const connector = selectOf(`Connector of ${c.tag}`, connectorChoices(), c.connector);
    const x = lengthOf(`X of ${c.tag}`, c.x, units);
    const y = lengthOf(`Y of ${c.tag}`, c.y, units);
    const gone = h("input", { attrs: { type: "checkbox", "aria-label": `Delete ${c.tag}` } }) as HTMLInputElement;
    // linking a socket gives the connector its name for a tag, unless one was typed
    let typed = c.tag !== c.socket && c.tag !== "";
    tag.addEventListener("input", () => (typed = true));
    socket.addEventListener("change", () => {
      if (!typed && socket.value) tag.value = socket.value;
    });
    const tr = h("tr", {}, h("td", {}, tag), h("td", {}, socket), h("td", {}, connector), h("td", {}, x), h("td", {}, y), h("td", { cls: "ccad-centre" }, gone));
    gone.addEventListener("change", () => tr.classList.toggle("ccad-gone", gone.checked));
    body.append(tr);
    reads.push(() => {
      if (gone.checked) return null;
      const px = parseLength(x.value, units);
      const py = parseLength(y.value, units);
      if (px === null || py === null) return "Enter each connector's X and Y.";
      return { x: px, y: py, tag: tag.value.trim(), socket: socket.value, connector: connector.value };
    });
  }
  const v = await showDialog<PanelConnector[]>({
    title: "Edit Connectors",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("p", { text: `${l.name || "Panel layout"} · ${l.connectors.length} connector${l.connectors.length === 1 ? "" : "s"}${sockets.length ? "" : " · no device of that name, so none can be linked"}` }),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Display Tag", "Linked to Socket", "Connector", "X", "Y", "Delete"].map((t) => h("th", { text: t })))), body)),
      h("p", { cls: "muted", text: "X and Y are from the layout's top left corner. The Panel Connector tool adds connectors; the Panel Builder lays out a new set." }),
    ],
    check: () => {
      const out: PanelConnector[] = [];
      for (const read of reads) {
        const c = read();
        if (typeof c === "string") return { error: c, focus: body };
        if (c) out.push(c);
      }
      return { value: out };
    },
  });
  if (!v || store.session !== s) return;
  attempt("Edit Connectors", (session) => session.batch(() => setConnectors(session, id, v)));
}

/** Create Schematic Devices: a device on a layer chosen, its sockets the layout's connectors (IO, by their tags), the layout linked to it. */
async function createSchematicDevices(id: string): Promise<void> {
  const s = store.session;
  const l = s ? layoutOf(s.doc, id) : null;
  if (!s || !l) return;
  if (!l.connectors.length) return toast("The layout has no connectors to make sockets of.", "info");
  if (l.name && schematicOf(s).devices.has(l.name)) return toast(`A device is named ${l.name} already; Update From Schematic links the layout to it.`, "info");
  const designs = s.doc.layers().filter((x) => x.kind !== "sheet");
  const withDevices = designs.find((x) => devicesOn(s, x.id).length);
  const layer = selectOf("Layer", designs.map((x) => x.id), withDevices?.id ?? store.activeLayerId ?? designs[0].id, (v) => designs.find((x) => x.id === v)?.name ?? v);
  const chosen = await showDialog<string>({
    title: "Select Layer",
    okLabel: "OK",
    body: [field("Layer", layer), h("p", { cls: "muted", text: "The panel goes on it as one device, a socket (IO) for each connector, where the layout is." })],
    check: () => ({ value: layer.value }),
  });
  if (!chosen || store.session !== s) return;
  const r = attempt("Create Schematic Devices", (session) =>
    session.batch(() => {
      const now = layoutOf(session.doc, id);
      const at = session.doc.object(id)?.insertion;
      if (!now || !at) throw new Error("That isn't a panel layout.");
      const name = now.name || nextName("PANEL1", deviceNames(session));
      const device = addDevice(session, chosen, at, null);
      renameDevice(session, device, name, name);
      const taken = new Set<string>();
      const named = now.connectors.map((c, i) => {
        const base = c.tag || String(i + 1);
        const n = taken.has(base) ? nextName(`${base}-1`, taken) : base;
        taken.add(n);
        return n;
      });
      const sockets: Socket[] = now.connectors.map((c, i) => ({ id: i + 1, name: named[i], tag: named[i], type: "IO", side: "L", slot: i, signal: UNKNOWN, connector: c.connector || UNKNOWN, terminated: false }));
      setSockets(session, device, sockets);
      write(session, now.rec, { [F.name]: name });
      setConnectors(session, id, now.connectors.map((c, i) => ({ ...c, socket: named[i] })));
      return { device, name, count: sockets.length };
    }),
  );
  if (r) toast(`Create Schematic Devices: ${r.value.name} made with ${r.value.count} socket${r.value.count === 1 ? "" : "s"}.`, "info");
}

// ---- Create Panel View

/** a panel device of the schematic, as Create Panel View lists it */
interface PanelDevice {
  readonly name: string;
  readonly type: string;
  readonly layerId: string;
  readonly ids: readonly string[];
}

/** The panel devices in the drawing (one for each name and layer), with the ids of their devices. */
function panelDevices(s: EditSession): PanelDevice[] {
  const out = new Map<string, { name: string; type: string; layerId: string; ids: string[] }>();
  for (const d of devicesOn(s)) {
    if (!isPanel(d) || !d.name) continue;
    const k = `${d.rec.layerId}\u0000${d.name}`;
    const had = out.get(k) ?? { name: d.name, type: deviceTypeOf(d), layerId: d.rec.layerId, ids: [] };
    had.ids.push(d.rec.id);
    out.set(k, had);
  }
  return [...out.values()].sort((a, b) => natural(a.name, b.name));
}

const NEW_LAYER = "new";
/** the scale a new layer of panel views is drawn at */
const NEW_LAYER_SCALE = 5;
/** the space between panel views, mm */
const VIEW_GAP = 50;

/** Stage > ConnectCAD > Create Panel View: a layout for each panel device chosen, on a design layer, one under another. */
export async function createPanelView(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const all = panelDevices(s);
  if (!all.length) return toast("Create Panel View: the drawing has no panel devices (term panels or jackfields).", "info");
  const sch = schematicOf(s);
  const layerName = new Map(s.doc.layers().map((l) => [l.id, l.name]));
  const where = selectOf("Search for panel-type devices in", ["selected", "layer", "all"], store.selection.size ? "selected" : "all", (v) => (v === "selected" ? "Selected objects" : v === "layer" ? "The current design layer" : "All layers"));
  const types = [...new Set(all.map((p) => p.type))];
  const pick = selectOf("Select Type", ["", ...types], "", (v) => v || "All types");
  const body = h("tbody");
  const rows = all.map((p) => {
    const use = h("input", { attrs: { type: "checkbox", "aria-label": `Use ${p.name}` } }) as HTMLInputElement;
    use.checked = true;
    const tr = h("tr", {}, h("td", { cls: "ccad-centre" }, use), h("td", { text: p.name }), h("td", { text: p.type }), h("td", { text: String(sch.devices.get(p.name)?.sockets.length ?? 0) }), h("td", { text: layerName.get(p.layerId) ?? "" }));
    body.append(tr);
    return { p, use, tr };
  });
  const inScope = (p: PanelDevice): boolean => (where.value === "selected" ? p.ids.some((id) => store.selection.has(id)) : where.value === "layer" ? p.layerId === store.activeLayerId : true);
  const refresh = (): void => {
    for (const r of rows) r.tr.hidden = !inScope(r.p);
  };
  where.addEventListener("change", refresh);
  pick.addEventListener("change", () => {
    for (const r of rows) r.use.checked = !pick.value || r.p.type === pick.value;
  });
  refresh();
  const button = (text: string, on: boolean): HTMLButtonElement => {
    const el = h("button", { cls: "btn", text, attrs: { type: "button" } }) as HTMLButtonElement;
    el.addEventListener("click", () => rows.forEach((r) => (r.use.checked = on)));
    return el;
  };
  const designs = s.doc.layers().filter((l) => l.kind !== "sheet");
  const layer = selectOf("Select Layer to use for Panel Views", [...designs.map((l) => l.id), NEW_LAYER], NEW_LAYER, (v) => (v === NEW_LAYER ? "New Design Layer" : (layerName.get(v) ?? v)));
  const panel = selectOf("Panel", ["19 in", "10 in", "none"], "19 in", (v) => (v === "none" ? "No graphics" : `Rack-mount, ${v}`));
  const v = await showDialog<{ panels: PanelDevice[]; layer: string; panel: string }>({
    title: "Create Panel View",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      field("Search for panel-type devices in", where),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, ...["Use", "Device", "Type", "Ports", "Layer"].map((t) => h("th", { text: t })))), body)),
      h("div", { cls: "ccad-actions" }, button("Select All", true), button("Deselect All", false)),
      field("Select Type", pick),
      field("Panel", panel),
      field("Select Layer to use for Panel Views", layer),
      h("p", { cls: "muted", text: "A layout is made for each panel chosen, at its actual size, a connector for each port, one layout under another." }),
    ],
    check: () => {
      const panels = rows.filter((r) => r.use.checked && inScope(r.p)).map((r) => r.p);
      if (!panels.length) return { error: "Choose a panel device.", focus: body };
      return { value: { panels, layer: layer.value, panel: panel.value } };
    },
  });
  if (!v || store.session !== s) return;
  const r = attempt("Create Panel View", (session) =>
    session.batch(() => {
      const layerId = v.layer === NEW_LAYER ? session.createLayer(nextName("Panel Views 1", new Set(session.doc.layers().map((l) => l.name))), "design", NEW_LAYER_SCALE) : v.layer;
      const now = schematicOf(session);
      // under the layouts on the layer already
      let top = Math.min(0, ...panelLayoutsOn(session.doc, layerId).flatMap((x) => (x.box ? [x.toWorld({ x: x.box.x0, y: x.box.y0 }).y] : []))) - (panelLayoutsOn(session.doc, layerId).length ? VIEW_GAP : 0);
      const made: string[] = [];
      for (const p of v.panels) {
        const d = now.devices.get(p.name);
        if (!d) continue;
        const spec: PanelSpec = { type: v.panel === "none" ? "No Graphics" : "Rack-mount", ru: 1, opening: v.panel === "none" ? "19 in" : v.panel, width: 200, height: 100, holes: true };
        // the tag and the device it's connected to fit over a D-series connector on a 1U panel; the socket too needs 2U
        const writing = writingRoom({ show: { tag: true, device: true, socket: false }, offset: 1 });
        // a block for each run of one connector type, tagged by port
        const blocks: BuilderRow[] = [];
        for (const k of d.sockets) {
          const last = blocks[blocks.length - 1];
          if (last && last.connector === k.connector) blocks[blocks.length - 1] = { ...last, qty: last.qty + 1 };
          else blocks.push({ qty: 1, connector: k.connector, prefix: "", arrange: "Horizontal" });
        }
        const built = buildPanel(blocks, spec, writing);
        const connectors = built.connectors.map((c, i) => ({ ...c, tag: d.sockets[i].name, socket: d.sockets[i].name }));
        const id = addPanelLayout(session, layerId, { x: 0, y: top }, { [F.name]: p.name, [F.type]: d.type, [F.layout]: spec.type, [F.ru]: built.ru, [F.opening]: spec.opening }, connectors);
        made.push(id);
        const l = layoutOf(session.doc, id);
        const box = l ? layoutBox(l.spec, l.connectors, writingRoom(l)) : null;
        top += (box ? box.y0 : -100) - VIEW_GAP;
      }
      return { layerId, made };
    }),
  );
  if (!r) return;
  if (store.activeLayerId !== r.value.layerId) setActiveLayer(r.value.layerId);
  setSelection(r.value.made);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  toast(`Create Panel View: ${r.value.made.length} panel layout${r.value.made.length === 1 ? "" : "s"} made on ${s.doc.layers().find((l) => l.id === r.value.layerId)?.name ?? "the layer"}.`, "info");
}

// what a layout's connectors are connected to, and its Device Type, follow the schematic
followEdits((s) => {
  const recs = recsIn(s.doc);
  if (!recs.length) return;
  const sch = schematicOf(s);
  const stale = recs.flatMap((r) => {
    const l = layoutOf(s.doc, r.id);
    if (!l) return [];
    const connected = connectedText(connectedFor(l, sch));
    const type = sch.devices.get(l.name)?.type ?? str(r.value(F.type));
    return connected !== str(r.value(F.connected)) || type !== str(r.value(F.type)) ? [{ r, connected, type }] : [];
  });
  if (stale.length)
    s.followOn(() =>
      stale.forEach(({ r, connected, type }) => {
        write(s, r, { [F.connected]: connected, [F.type]: type });
        drawLayout(s, r.id);
      }),
    );
});

// ---- Object Info

const param = (id: number, field: string, level = 0): PluginWidget => ({ id, kind: "param", field, label: "", level });
const UPDATE = 30;
const CREATE_DEVICES = 31;
const BUILDER = 32;
const EDIT = 33;

const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "divider", label: "General", level: 0 },
  param(2, F.type),
  param(3, F.name),
  { id: UPDATE, kind: "button", label: "Update From Schematic", level: 0 },
  { id: CREATE_DEVICES, kind: "button", label: "Create Schematic Devices…", level: 0 },
  { id: BUILDER, kind: "button", label: "Panel Builder…", level: 0 },
  { id: EDIT, kind: "button", label: "Edit Connectors…", level: 0 },
  { id: 10, kind: "divider", label: "Panel", level: 0 },
  param(11, F.layout),
  param(12, F.ru, 1),
  param(13, F.opening, 1),
  param(14, F.width, 1),
  param(15, F.height, 1),
  param(16, F.holes, 1),
  { id: 20, kind: "divider", label: "Display", level: 0 },
  param(21, F.offset),
  param(22, F.showTag),
  param(23, F.showDevice),
  param(24, F.showSocket),
];

const driver: PluginDriver = {
  name: PANEL_LAYOUT,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === F.type,
  choices: (field) => (field === F.layout ? LAYOUT_TYPES.map((value) => ({ value, label: value })) : field === F.opening ? RACK_OPENINGS.map((value) => ({ value, label: value })) : undefined),
  place: () => toast("Make one with Stage > ConnectCAD > Create Panel View, or the Panel Connector tool in ConnectCAD Layout.", "info"),
  edit(id, values) {
    attempt("Edit Panel Layout", (s) =>
      s.batch(() => {
        const l = layoutOf(s.doc, id);
        if (!l) throw new Error("That isn't a panel layout.");
        write(s, l.rec, values);
        // a rack-mount panel keeps to the units its connectors need, and a new name links it again
        const now = layoutOf(s.doc, id)!;
        setConnectors(s, id, now.connectors);
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const l = layoutOf(s.doc, id);
        if (l) setConnectors(s, id, l.connectors);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const s = store.session;
    const l = s ? layoutOf(s.doc, id) : null;
    if (!s || !l) return;
    const linked = !!l.name && schematicOf(s).devices.has(l.name);
    const rack = l.spec.type === "Rack-mount";
    const custom = l.spec.type === "Custom";
    apply(
      new Map([
        [UPDATE, { enabled: linked, visible: true }],
        [CREATE_DEVICES, { enabled: !linked && l.connectors.length > 0, visible: true }],
        [12, { enabled: rack, visible: true }],
        [13, { enabled: rack, visible: true }],
        [14, { enabled: custom, visible: true }],
        [15, { enabled: custom, visible: true }],
        [16, { enabled: custom, visible: true }],
      ]),
    );
  },
  press(id, widget) {
    if (widget === UPDATE) updateFromSchematic(id);
    else if (widget === CREATE_DEVICES) void createSchematicDevices(id);
    else if (widget === BUILDER) void panelBuilder(id);
    else if (widget === EDIT) void editConnectors(id);
  },
  open: (id) => void editConnectors(id),
};

registerPluginDrivers(() => [driver]);
