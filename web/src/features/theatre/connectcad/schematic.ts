// ConnectCAD's schematic objects as Rodeo plug-in objects: the device ('Rodeo Device'), a box with its
// sockets down its sides, each an input, an output or both, with a signal and a connector; and the
// circuit ('Rodeo Circuit'), a line from one device's socket to another's, coloured by its signal and
// numbered at its ends, or a pair of arrows naming the other end. ccadShapes.ts has the sums. A
// device keeps its sockets in a field of its own (they aren't objects of their own, as Vectorworks'
// are); a circuit keeps the device and socket at each end. After each edit, circuits whose devices
// have moved, turned or changed are drawn again in the same undo step, their corners where they were;
// one whose socket has gone keeps its last run and shows a warning triangle at the loose end. An
// external ('Rodeo External'), the system's link to equipment outside it, reads as a device of a few
// sockets alike, drawn as a pointed box (externalShapes.ts), its sockets set from its Object Info. A
// distribution amplifier ('Rodeo Distribution Amplifier') is a device whose input and outputs are set
// from its Object Info (daShapes.ts); placed on a circuit, it splits the circuit in two. A panel
// device ('Rodeo Panel', panelShapes.ts) is one port of a term panel or jackfield, splitting a
// circuit alike; devices of one panel share its name. An adapter ('Rodeo Adapter', adapterShapes.ts)
// sits on a device's socket and gives circuits sockets of its own; it follows its device, and one
// dragged off its socket shows a warning triangle until it's dropped on another. ReRoute Circuits
// (rerouteShapes.ts) runs circuits along another's run; breakout nodes where a bussed circuit joins
// and leaves the run are kept with its corners, as ["node", x, y], and so are the circuits it hops
// (HopOver), as ["hop", circuit id, radius, 1 when it bows down]. The Device tool's eyedropper picks
// a device up and transfers its sockets, make, model, physical and location data, class, attributes
// and (asked) records onto others (transferShapes.ts).

import type { Attributes, ByClassGroup, EditSession, NewShape, PluginFieldSpec, Pt, RecordValue } from "../../../core/index.ts";
import { transferredSockets, type MissingSockets } from "./transferShapes.ts";
import { endKey, type DrawnCircuit } from "./listShapes.ts";
import { kindKey, type DeviceColumn, type DevicePlan, type HadDevice, type ListedDevice } from "./deviceListShapes.ts";
import { fingerprint } from "../../../app/adjacencyShapes.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { followEdits, registerPluginDrivers, type PluginDriver, type PluginHop, type PluginWidget } from "../../../app/ext.ts";
import { hopArc, hopPoints, hopRefusal } from "../../../app/hopOver.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { rotationAbout } from "../../../app/tools/rotate.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import {
  arrowEnd,
  boxFor,
  canReceive,
  canSource,
  circuitEnds,
  cleanLoops,
  crossings,
  hopped,
  connectorsFor,
  DEFAULT_ROWS,
  DEFAULT_WIDTH,
  deviceWriting,
  flowOf,
  LABEL_MM,
  loopArc,
  loopPlan,
  nextName,
  NUMBER_DISPLAYS,
  numberPlaces,
  PASSIVE,
  PITCH_MM,
  route,
  settingsNow,
  signalInk,
  signalNames,
  signalsMatch,
  slotEnd,
  slotFor,
  SOCKET_TYPES,
  socketAt,
  socketMarks,
  socketName,
  TAG_MM,
  UNKNOWN,
  warningTriangle,
  along,
  pathLength,
  type Bounds,
  type Box,
  type End,
  type NumberDisplay,
  type Side,
  type Socket,
  type SocketType,
} from "./ccadShapes.ts";
import type { ReportCircuit, ReportDevice } from "./ccadReports.ts";
import { routeLetter, routeRank } from "./cableRouteShapes.ts";
import { ADAPTER_WIDTH, adapterCorner, adapterNames, adapterNear, adapterRefusal, adapterSockets } from "./adapterShapes.ts";
import { busCorners, busSteps, offsetPath } from "./rerouteShapes.ts";
import { DA_DEFAULTS, DA_WIDTH, daCarries, daDescription, daSockets, daTypeOf, nearestOnPath, outputCount, type DaType } from "./daShapes.ts";
import { afterPort, connectorPort, connectorSockets, groupOf, linkedThrough, MAX_PORTS, nextConnectorPorts, nextPorts, PANEL_PREFIX, panelPlaceOf, rowsLost, PANEL_WIDTH, panelCarries, panelName, panelSockets, panelSize, panelTag, panelTypeOf, panelTypes, portKey, portsIn, type PanelKind, type PanelType, type PortPlace } from "./panelShapes.ts";
import { arrayNames, arrayPlaces, EXTERNAL_WIDTH, externalOutline, externalSockets, FACINGS, type ExternalField, type ExternalFields, type Facing } from "./externalShapes.ts";

export const DEVICE = "Rodeo Device";
export const CIRCUIT = "Rodeo Circuit";
export const EXTERNAL = "Rodeo External";
export const DA = "Rodeo Distribution Amplifier";
export const PANEL = "Rodeo Panel";
export const ADAPTER = "Rodeo Adapter";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const DEV = {
  name: "Device Name",
  tag: "Display Tag",
  description: "Description",
  maker: "Manufacturer",
  boxWidth: "Box Width",
  boxHeight: "Box Height",
  height: "Height",
  width: "Width",
  depth: "Depth",
  power: "Power (W)",
  autoBtu: "Auto BTU calculation",
  btu: "BTU",
  weight: "Weight (kg)",
  ru: "Height RU",
  rackWidth: "Rack Width",
  room: "Room",
  rack: "Rack",
  rackU: "Rack U",
  sockets: "Sockets",
  drawn: "Drawn From",
} as const;

/** A distribution amplifier's own fields; the rest are a device's. */
const DAF = {
  type: "Device Type",
  outputs: "Number of Outputs",
  loop: "Loop-thru",
} as const;

/** A panel device's own fields, with a DA's Device Type. */
const PNL = {
  group: "Group",
  panel: "Panel",
  port: "Port",
  /** a connector panel's */
  code: "Port Code",
} as const;

/** An adapter's own fields; its box, sockets and Drawn From are a device's. */
const ADP = {
  make: "Make/Model",
  connector: "Connector",
  names: "Adapter Sockets",
  host: "Host Device Id",
  hostSocket: "Host Socket Id",
  placed: "Placed At",
} as const;

/** An external's own fields; its name, tag, box, sockets and Drawn From are a device's. */
const EXT = {
  facing: "Facing",
  type: "Socket Type",
  signal: "Signal",
  connector: "Connector",
  circuits: "External Circuits",
} as const;

const CIR = {
  number: "Number",
  cable: "Cable",
  signal: "Signal",
  type: "Circuit Type",
  display: "Number Display",
  length: "Cable Length",
  calculated: "Calculated Cable Length",
  source: "Source",
  destination: "Destination",
  sourceId: "Source Device Id",
  sourceSocket: "Source Socket Id",
  destinationId: "Destination Device Id",
  destinationSocket: "Destination Socket Id",
  corners: "Corners",
  path: "Last Path",
  drawn: "Drawn From",
  /** the route kept for its cable, by letter (Select Alternative Route): empty or A for the shortest */
  route: "Cable Route",
  /** a spare cable's drop points, as JSON: Edit Cabling's pre-cabling */
  spare: "Spare Drop Points",
} as const;

export const CIRCUIT_TYPES = ["Polyline", "Arrow"] as const;
export type CircuitType = (typeof CIRCUIT_TYPES)[number];
const RACK_WIDTHS = ["Full", "Half", "Non-rack"];
/** watts to BTU an hour, as Vectorworks reckons it */
const BTU_PER_WATT = 3.41;
/** a circuit's line, mils */
const CIRCUIT_MILS = 7;

/** what the tools place next */
export const ccadSettings = {
  deviceName: "DEV1",
  description: "",
  maker: "",
  socketName: "",
  socketType: "IN" as SocketType,
  side: "auto" as Side | "auto",
  signal: "SDI",
  connector: "BNC",
  circuitType: "Polyline" as CircuitType,
  display: "Auto" as NumberDisplay,
  loopType: "IN" as SocketType,
  externalName: "EXT1",
  externalType: "OUT" as SocketType,
  facing: "Left" as Facing,
  daType: "Video" as DaType,
  videoDaName: DA_DEFAULTS.Video.name,
  audioDaName: DA_DEFAULTS.Audio.name,
  videoSignal: DA_DEFAULTS.Video.signal,
  audioSignal: DA_DEFAULTS.Audio.signal,
  daOutputs: 4,
  daLoop: false,
  daMaker: "",
  panelType: { term: "Video Term Panel", jack: "Video Jack", linked: "U-Linked Video Jack", connector: "Connector Panel Input" } as Record<PanelKind, string>,
  panelPrefix: { ...PANEL_PREFIX } as Record<PanelKind, string>,
  /** the Connector asked of each tool; empty for its type's own */
  panelConnector: { term: "", jack: "", linked: "", connector: "" } as Record<PanelKind, string>,
  /** where each tool's next port goes; a connector panel's port 0 is one of no number */
  panelNext: { term: { group: "A", panel: 1, port: 1 }, jack: { group: "A", panel: 1, port: 1 }, linked: { group: "A", panel: 1, port: 1 }, connector: { group: "BOX", panel: 1, port: 1 } } as Record<PanelKind, PortPlace>,
  /** the Connector Panel tool's port code (MIC of MIC01) */
  connectorCode: "",
  panelMaker: "",
  adapterMake: "Adapter",
  adapterConnector: "HDMI",
  /** the adapter's socket names, a comma between: none for one socket of no name */
  adapterNames: "",
  /** the Device tool's eyedropper: Apply only onto devices of the same make and model, what it does with sockets the device picked up hasn't, and whether records go too */
  transferSameMaker: false,
  transferSameModel: false,
  transferMissing: "keep" as MissingSockets,
  transferRecords: false,
};

interface Rec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function recOf(s: EditSession, id: string, plugin: string): Rec | null {
  const obj = s.doc.object(id);
  const rec = obj?.type === PLUGIN ? s.doc.records(id).find((r) => r.parametric && r.name === plugin) : undefined;
  return obj && rec ? { id, layerId: obj.layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const num = (v: RecordValue | undefined): number => (typeof v === "number" ? v : Number(v) || 0);
/** A layer's socket pitch on the drawing: PITCH_MM on paper. */
export const pitchOn = (layerId: string): number => PITCH_MM * layerScaleOf(layerId);

const SIDE_SET = new Set(["L", "R", "T", "B"]);
const TYPE_SET = new Set(["IN", "OUT", "IO"]);

/** A device's sockets as its field keeps them; anything malformed is left out. */
export function readSockets(text: string): Socket[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): Socket[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "number" || !TYPE_SET.has(String(o.type)) || !SIDE_SET.has(String(o.side))) return [];
    const loop = typeof o.loop === "number" ? { loop: o.loop } : {};
    return [{ id: o.id, name: String(o.name ?? ""), tag: String(o.tag ?? ""), type: o.type as SocketType, side: o.side as Side, slot: Math.max(0, Math.floor(Number(o.slot) || 0)), signal: String(o.signal ?? PASSIVE), connector: String(o.connector ?? PASSIVE), terminated: o.terminated === true, ...loop }];
  });
}

export interface Device {
  readonly rec: Rec;
  readonly kind: "device" | "external" | "adapter";
  readonly at: Pt;
  /** degrees */
  readonly angle: number;
  readonly pitch: number;
  readonly box: Box;
  readonly sockets: readonly Socket[];
  readonly name: string;
  readonly tag: string;
}

export function deviceOf(s: EditSession, id: string): Device | null {
  const device = recOf(s, id, DEVICE) ?? recOf(s, id, DA) ?? recOf(s, id, PANEL);
  const external = device ? null : recOf(s, id, EXTERNAL);
  const rec = device ?? external ?? recOf(s, id, ADAPTER);
  const at = s.doc.object(id)?.insertion;
  if (!rec || !at) return null;
  const kind = device ? "device" : external ? "external" : "adapter";
  const pitch = pitchOn(rec.layerId);
  const sockets = readSockets(str(rec.value(DEV.sockets)));
  const box = boxFor({ width: num(rec.value(DEV.boxWidth)), height: num(rec.value(DEV.boxHeight)) }, sockets, pitch);
  // an adapter goes by its make and model
  const name = str(rec.value(kind === "adapter" ? ADP.make : DEV.name));
  return { rec, kind, at, angle: s.pluginAngle(id), pitch, box, sockets, name, tag: str(rec.value(DEV.tag)) || name };
}

/** The devices on a layer, or on every layer. */
export function devicesOn(s: EditSession, layerId?: string): Device[] {
  if (![DEVICE, DA, PANEL, EXTERNAL, ADAPTER].some((name) => s.doc.hasPluginFormat(name))) return [];
  const out: Device[] = [];
  for (const layer of s.doc.layers()) {
    if (layerId && layer.id !== layerId) continue;
    for (const o of s.doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const d = deviceOf(s, o.id);
      if (d) out.push(d);
    }
  }
  return out;
}

const turn = (p: Pt, deg: number): Pt => {
  const t = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) };
};
export const toWorld = (d: Device, p: Pt): Pt => {
  const q = turn(p, d.angle);
  return { x: d.at.x + q.x, y: d.at.y + q.y };
};
export const toLocal = (d: Device, p: Pt): Pt => turn({ x: p.x - d.at.x, y: p.y - d.at.y }, -d.angle);

/** Where a circuit leaves a device's socket, on the drawing. */
export function endOf(d: Device, socket: Socket): End {
  const e = slotEnd(d.box, socket.side, socket.slot, d.pitch);
  return { tip: toWorld(d, e.tip), out: turn(e.out, d.angle) };
}

/** The device under a point on a layer, topmost first, and its socket there if any. */
export function deviceAt(s: EditSession, layerId: string, p: Pt): { device: Device; socket: Socket | null } | null {
  const devices = devicesOn(s, layerId);
  for (let i = devices.length - 1; i >= 0; i--) {
    const d = devices[i];
    const q = toLocal(d, p);
    const socket = socketAt(d.sockets, d.box, q, d.pitch);
    if (socket) return { device: d, socket };
    if (q.x >= 0 && q.x <= d.box.width && q.y <= 0 && q.y >= -d.box.height) return { device: d, socket: null };
  }
  return null;
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const inkOf = (): ((hex: string) => number) => {
  const match = colorMatcher();
  return (hex) => match(hexToRgb(hex));
};

type Add = (shape: NewShape, look: Partial<Attributes>) => void;

function drawn(s: EditSession, id: string, layerId: string, build: (add: Add) => void): void {
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  build((shape, look) => {
    shapes.push(shape);
    looks.push(look);
  });
  s.setPluginDrawing(id, s.addObjects(layerId, shapes, classIndex, looks));
}

const text = (at: Pt, value: string, height: number, hAlign: number, vAlign: number): NewShape => ({ kind: "text", at, text: value, height, hAlign, vAlign, angle: 0 }) as NewShape;

const deviceDrawn = (d: Device): string => fingerprint([d.pitch]);
const facingOf = (d: Device): Facing => (str(d.rec.value(EXT.facing)) === "Right" ? "Right" : "Left");

/** Draws device `id` from its parameters, in the session's open batch. */
function drawDevice(s: EditSession, id: string): void {
  const d = deviceOf(s, id);
  if (!d) throw new Error("That isn't a ConnectCAD device.");
  const ink = inkOf();
  const black = ink("#1f2328");
  const scale = layerScaleOf(d.rec.layerId);
  const writing = deviceWriting(d.box, d.pitch);
  const panel = isPanel(d) ? panelTypeFor(d) : null;
  const line: Partial<Attributes> = { penFore: black, fillPattern: 0 };
  const filled = (hex: string): Partial<Attributes> => ({ penFore: ink(hex), fillPattern: 1, fillFore: ink(hex), fillBack: ink(hex), fillOpacity: 100 });
  drawn(s, id, d.rec.layerId, (add) => {
    const { width: w, height: h } = d.box;
    const outline = d.kind === "external" ? externalOutline(d.box, facingOf(d), d.pitch) : [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: -h }, { x: 0, y: -h }];
    add({ kind: "polygon", points: outline, closed: true }, { penFore: black, fillPattern: 1, fillFore: ink("#ffffff"), fillBack: ink("#ffffff"), fillOpacity: 100, lineWeight: 10 });
    if (d.kind !== "device") {
      // an external's name, an adapter's make, in its top row
      if (d.tag) add(text({ x: w / 2, y: -d.pitch / 2 }, d.tag, TAG_MM * scale, 2, 3), line);
    } else {
      if (d.tag) add(text(writing.tag, d.tag, TAG_MM * scale, 2, 5), line);
      // a panel's port in its first row, unless it's described
      const description = str(d.rec.value(DEV.description)) || (panel ? (d.sockets[0]?.tag ?? "") : "");
      if (description) add(text(writing.description, description, LABEL_MM * scale, 2, 3), line);
      const rack = str(d.rec.value(DEV.rack)).trim();
      const u = str(d.rec.value(DEV.rackU)).trim();
      if (rack || u) add(text(writing.rack, [rack && `Rack ${rack}`, u && `U${u}`].filter(Boolean).join("  "), LABEL_MM * scale, 2, 1), line);
    }
    // an external's sockets are numbered only when it has more than one; a panel's port is written once
    const labelled = (d.kind === "device" && !panel) || (d.kind === "external" && d.sockets.length > 1) || d.kind === "adapter";
    const through = panel && linkedThrough(panel) ? d.sockets.filter((k) => k.slot === 0 && (k.side === "L" || k.side === "R")) : [];
    if (through.length === 2) {
      // linked through: a line between the two sockets' marks
      const inner = through.map((k) => socketMarks(k, d.box, d.pitch).triangles.flatMap((t) => t.points));
      const left = Math.max(...inner[through[0].side === "L" ? 0 : 1].map((q) => q.x));
      const right = Math.min(...inner[through[0].side === "L" ? 1 : 0].map((q) => q.x));
      const y = slotEnd(d.box, "L", 0, d.pitch).tip.y;
      add({ kind: "line", a: { x: left, y }, b: { x: right, y } }, { penFore: black, fillPattern: 0, lineWeight: 10 });
    }
    for (const socket of d.sockets) {
      const marks = socketMarks(socket, d.box, d.pitch);
      for (const t of marks.triangles) add({ kind: "polygon", points: [...t.points], closed: true }, filled(t.flow === "in" ? "#2da44e" : "#cf222e"));
      if (labelled && marks.label.text) add(text(marks.label.at, marks.label.text, LABEL_MM * scale, marks.label.hAlign, 3), line);
      if (marks.terminator) add({ kind: "polygon", points: [...marks.terminator], closed: true }, filled("#1f2328"));
      // a loop once, from the socket of the lower id
      const partner = socket.loop !== undefined && socket.loop > socket.id ? d.sockets.find((k) => k.id === socket.loop) : undefined;
      if (partner) add({ kind: "polyline", points: loopArc(socket, partner, d.box, d.pitch), closed: false } as NewShape, { penFore: black, fillPattern: 0, lineWeight: 10 });
    }
    if (d.kind === "adapter" && !str(d.rec.value(ADP.host))) {
      // off its socket: a warning where it goes on one
      const at = adapterNear(d.sockets[0]?.side ?? "R", d.box, d.pitch);
      add({ kind: "polygon", points: warningTriangle(at, d.pitch), closed: true }, { ...filled("#f2c94c"), penFore: black });
      add(text({ x: at.x, y: at.y - 0.05 * d.pitch }, "!", LABEL_MM * scale, 2, 3), line);
    }
  });
  s.setRecordField(id, d.rec.format, DEV.drawn, deviceDrawn(d));
}

function deviceSpecs(name: string, width: number, height: number): PluginFieldSpec[] {
  const k = ccadSettings;
  return [
    { name: DEV.name, type: TEXT, value: name },
    { name: DEV.tag, type: TEXT, value: name },
    { name: DEV.description, type: TEXT, value: k.description },
    { name: DEV.maker, type: TEXT, value: k.maker },
    { name: DEV.boxWidth, type: DIMENSION, value: width },
    { name: DEV.boxHeight, type: DIMENSION, value: height },
    { name: DEV.height, type: DIMENSION, value: 0 },
    { name: DEV.width, type: DIMENSION, value: 0 },
    { name: DEV.depth, type: DIMENSION, value: 0 },
    { name: DEV.power, type: NUMBER, value: 0 },
    { name: DEV.autoBtu, type: BOOL, value: true },
    { name: DEV.btu, type: NUMBER, value: 0 },
    { name: DEV.weight, type: NUMBER, value: 0 },
    { name: DEV.ru, type: NUMBER, value: 0 },
    { name: DEV.rackWidth, type: POPUP, value: "Non-rack" },
    { name: DEV.room, type: TEXT, value: "" },
    { name: DEV.rack, type: TEXT, value: "" },
    { name: DEV.rackU, type: TEXT, value: "" },
    { name: DEV.sockets, type: TEXT, value: "[]" },
    { name: DEV.drawn, type: TEXT, value: "" },
  ];
}

/** The names of the drawing's devices. */
export const deviceNames = (s: EditSession): Set<string> => new Set(devicesOn(s).map((d) => d.name));

/** Adds a device whose box runs between two corners (or a new device's size at `a` when there's no `b`), as part of a batch; its id. */
export function addDevice(s: EditSession, layerId: string, a: Pt, b: Pt | null): string {
  const pitch = pitchOn(layerId);
  const width = b ? Math.max(Math.abs(b.x - a.x), 2 * pitch) : DEFAULT_WIDTH * pitch;
  const height = b ? Math.max(Math.abs(b.y - a.y), 2 * pitch) : DEFAULT_ROWS * pitch;
  const corner = b ? { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) } : a;
  const name = nextName(ccadSettings.deviceName.trim() || "DEV1", deviceNames(s));
  const specs = deviceSpecs(name, width, height);
  const id = s.addPluginObject(layerId, DEVICE, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), corner, 0, store.activeClassIndex);
  drawDevice(s, id);
  return id;
}

/** A device the Device Builder made, as part of a batch: its make, identification and physical data, its box (in pitches) and sockets, its top left at `at`; its id. */
export interface BuiltDevice {
  readonly name: string;
  readonly tag: string;
  readonly description: string;
  readonly maker: string;
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly ru: number;
  readonly rackWidth: string;
  readonly power: number;
  readonly weight: number;
  readonly box: Box;
  readonly sockets: readonly Socket[];
}

export function addBuiltDevice(s: EditSession, layerId: string, at: Pt, built: BuiltDevice): string {
  const pitch = pitchOn(layerId);
  const asked = built.name.trim() || "DEV1";
  const name = nextName(asked, deviceNames(s));
  const sockets = cleanLoops(built.sockets);
  const box = boxFor({ width: built.box.width * pitch, height: built.box.height * pitch }, sockets, pitch);
  const specs = deviceSpecs(name, box.width, box.height);
  const values: Record<string, RecordValue> = {
    ...Object.fromEntries(specs.map((f) => [f.name, f.value])),
    // a tag that was the name follows it when the name takes the next number
    [DEV.tag]: built.tag.trim() && built.tag.trim() !== asked ? built.tag.trim() : name,
    [DEV.description]: built.description,
    [DEV.maker]: built.maker,
    [DEV.height]: built.height,
    [DEV.width]: built.width,
    [DEV.depth]: built.depth,
    [DEV.ru]: built.ru,
    [DEV.rackWidth]: built.rackWidth,
    [DEV.power]: built.power,
    [DEV.btu]: Math.round(built.power * BTU_PER_WATT * 100) / 100,
    [DEV.weight]: built.weight,
    [DEV.sockets]: JSON.stringify(sockets),
  };
  const id = s.addPluginObject(layerId, DEVICE, specs, values, at, 0, store.activeClassIndex);
  drawDevice(s, id);
  return id;
}

/** The Device tool's last click. */
export function placeDevice(layerId: string, a: Pt, b: Pt | null): void {
  const r = attempt("Device", (s) => s.batch(() => addDevice(s, layerId, a, b)));
  if (r) setEditGroup(null, [r.value]);
}

function externalSpecs(name: string, width: number, height: number, k: ExternalFields): PluginFieldSpec[] {
  return [
    { name: DEV.name, type: TEXT, value: name },
    { name: DEV.tag, type: TEXT, value: name },
    { name: EXT.facing, type: POPUP, value: k.facing },
    { name: EXT.type, type: POPUP, value: k.type },
    { name: EXT.signal, type: POPUP, value: k.signal },
    { name: EXT.connector, type: TEXT, value: k.connector },
    { name: EXT.circuits, type: NUMBER, value: 1 },
    { name: DEV.boxWidth, type: DIMENSION, value: width },
    { name: DEV.boxHeight, type: DIMENSION, value: height },
    { name: DEV.sockets, type: TEXT, value: "[]" },
    { name: DEV.drawn, type: TEXT, value: "" },
  ];
}

const settingsFields = (): ExternalFields => ({ type: ccadSettings.externalType, signal: ccadSettings.signal, connector: ccadSettings.connector, facing: ccadSettings.facing, circuits: 1 });

/** The box of a new external on a layer, of one circuit. */
export function externalBox(layerId: string): Box {
  const pitch = pitchOn(layerId);
  return boxFor({ width: EXTERNAL_WIDTH * pitch, height: 0 }, externalSockets([], settingsFields(), new Set()), pitch);
}

/** Adds an external of one circuit named `name`, its top left at `at`, of the tool's settings or `fields`, as part of a batch; its id. */
export function addExternal(s: EditSession, layerId: string, at: Pt, name: string, fields = settingsFields()): string {
  const box = externalBox(layerId);
  const specs = externalSpecs(name, box.width, box.height, fields);
  const id = s.addPluginObject(layerId, EXTERNAL, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  const d = deviceOf(s, id);
  if (!d) throw new Error("The external wasn't made.");
  writeSockets(s, d, externalSockets([], fields, new Set()));
  return id;
}

/** The External tool's clicks: one external at `a`, or a linear array of them from `a` toward `b`, numbered on. */
export function placeExternals(layerId: string, a: Pt, b: Pt | null): void {
  const r = attempt("External", (s) =>
    s.batch(() => {
      const taken = deviceNames(s);
      const places = b ? arrayPlaces(a, b, externalBox(layerId), pitchOn(layerId)) : [a];
      const names = b ? arrayNames(ccadSettings.externalName, places.length, taken, settingsNow().digits) : [nextName(ccadSettings.externalName.trim() || "EXT1", taken)];
      return places.map((p, i) => addExternal(s, layerId, p, names[i]));
    }),
  );
  if (r) setEditGroup(null, r.value);
}

const daSignal = (type: DaType): string => (type === "Video" ? ccadSettings.videoSignal : ccadSettings.audioSignal);
const daName = (type: DaType): string => (type === "Video" ? ccadSettings.videoDaName : ccadSettings.audioDaName).trim() || DA_DEFAULTS[type].name;
/** whether a device is a distribution amplifier */
const isDa = (d: Device): boolean => d.rec.value(DAF.outputs) !== undefined;

/** The sockets and box of a new DA of the tool's settings carrying `signal`. */
function newDa(signal: string, pitch: number): { sockets: Socket[]; box: Box } {
  const sockets = daSockets([], { outputs: ccadSettings.daOutputs, loop: ccadSettings.daLoop, signal, connector: connectorsFor(signal)[0] }) as Socket[];
  return { sockets, box: boxFor({ width: DA_WIDTH * pitch, height: 0 }, sockets, pitch) };
}

/** The box of a new DA on a layer, for the tool's preview. */
export const daBox = (layerId: string): Box => newDa(daSignal(ccadSettings.daType), pitchOn(layerId)).box;

function daSpecs(name: string, box: Box): PluginFieldSpec[] {
  const type = ccadSettings.daType;
  const own = (f: PluginFieldSpec): PluginFieldSpec => (f.name === DEV.description ? { ...f, value: daDescription(type, ccadSettings.daOutputs) } : f.name === DEV.maker ? { ...f, value: ccadSettings.daMaker } : f);
  return [
    ...deviceSpecs(name, box.width, box.height).map(own),
    { name: DAF.type, type: TEXT, value: DA_DEFAULTS[type].device },
    { name: DAF.outputs, type: NUMBER, value: outputCount(ccadSettings.daOutputs) },
    { name: DAF.loop, type: BOOL, value: ccadSettings.daLoop },
  ];
}

/** Adds a DA of the tool's settings named `name` carrying `signal`, its top left at `at`, as part of a batch; its id. */
export function addDA(s: EditSession, layerId: string, at: Pt, name: string, signal: string): string {
  const { sockets, box } = newDa(signal, pitchOn(layerId));
  const specs = daSpecs(name, box);
  const values = { ...Object.fromEntries(specs.map((f) => [f.name, f.value])), [DEV.sockets]: JSON.stringify(sockets) };
  const id = s.addPluginObject(layerId, DA, specs, values, at, 0, store.activeClassIndex);
  drawDevice(s, id);
  return id;
}

export interface Split {
  readonly id: string;
  readonly signal: string;
  readonly type: CircuitType;
  /** where its input goes, on the circuit */
  readonly at: Pt;
  /** the top left of the device for that */
  readonly corner: Pt;
}

/**
 * Where a device of `box` with its input in its left's first row, placed at `p` on a layer, splits a
 * circuit: the circuit whose run passes nearest, within half a pitch, with both its ends joined; the
 * point of it nearest `p`, where the input goes. Null when no circuit is that near.
 */
function splitAt(s: EditSession, layerId: string, p: Pt, box: Box): Split | null {
  const pitch = pitchOn(layerId);
  const devices: Devices = new Map();
  let best: { id: string; signal: string; type: CircuitType; at: Pt; distance: number } | null = null;
  for (const c of circuitsIn(s, layerId)) {
    const plan = planOf(s, c, devices);
    if (!plan.source || !plan.destination || plan.type === "Arrow") continue;
    const near = nearestOnPath(plan.points, p);
    if (near && near.distance <= pitch / 2 && (!best || near.distance < best.distance)) best = { id: c.id, signal: str(c.value(CIR.signal)), type: plan.type, ...near };
  }
  if (!best) return null;
  const tip = slotEnd(box, "L", 0, pitch).tip;
  return { id: best.id, signal: best.signal, type: best.type, at: best.at, corner: { x: best.at.x - tip.x, y: best.at.y - tip.y } };
}

/** Where a DA placed at `p` on a layer splits a circuit, or null. */
export const daSplitAt = (s: EditSession, layerId: string, p: Pt): Split | null => splitAt(s, layerId, p, daBox(layerId));

/** Splits a circuit at a device, as part of a batch: the circuit ends at its input, and a new one runs from its first output to where it went. */
function splitCircuit(s: EditSession, circuitId: string, daId: string, type: CircuitType): void {
  const c = circuitOf(s, circuitId);
  const d = deviceOf(s, daId);
  const input = d?.sockets.find((k) => k.side === "L" && k.type !== "OUT");
  const output = d?.sockets.find((k) => k.side === "R" && k.type !== "IN");
  if (!c || !d || !input || !output) throw new Error("That circuit or device has gone.");
  const to: SocketRef = { deviceId: str(c.value(CIR.destinationId)), socketId: num(c.value(CIR.destinationSocket)) };
  const set = (field: string, value: RecordValue): void => s.setRecordField(circuitId, c.format, field, value);
  set(CIR.destinationId, daId);
  set(CIR.destinationSocket, input.id);
  set(CIR.corners, "[]");
  set(CIR.path, "[]");
  drawCircuit(s, circuitId);
  addCircuit(s, { deviceId: daId, socketId: output.id }, to, [], type);
}

/** The Distribution Amplifier tool's clicks: one DA at `a`, splitting a circuit there, or a linear array of them from `a` toward `b`, numbered on. */
export function placeDAs(layerId: string, a: Pt, b: Pt | null): void {
  const type = ccadSettings.daType;
  const r = attempt("Distribution Amplifier", (s) =>
    s.batch(() => {
      const taken = deviceNames(s);
      if (b) {
        const places = arrayPlaces(a, b, daBox(layerId), pitchOn(layerId));
        const names = arrayNames(daName(type), places.length, taken, settingsNow().digits);
        return places.map((p, i) => addDA(s, layerId, p, names[i], daSignal(type)));
      }
      const name = nextName(daName(type), taken);
      const split = daSplitAt(s, layerId, a);
      if (!split) return [addDA(s, layerId, a, name, daSignal(type))];
      const signal = [PASSIVE, UNKNOWN].includes(split.signal) ? daSignal(type) : split.signal;
      if (!daCarries(type, signal)) throw new Error(`That circuit carries ${signal}, and a ${type.toLowerCase()} DA carries ${type.toLowerCase()} signals: choose the other DA type, or click clear of the circuit.`);
      const id = addDA(s, layerId, split.corner, name, signal);
      splitCircuit(s, split.id, id, split.type);
      return [id];
    }),
  );
  if (r) setEditGroup(null, r.value);
}

/** A DA's sockets made again from its Number of Outputs and Loop-thru, its description following while it's the one it was given. */
function refitDa(s: EditSession, id: string, outputsBefore: number): void {
  const d = deviceOf(s, id);
  if (!d) return;
  const type = daTypeOf(str(d.rec.value(DAF.type))) ?? "Video";
  const outputs = outputCount(num(d.rec.value(DAF.outputs)));
  const input = d.sockets.find((k) => k.side === "L" && k.type !== "OUT");
  const signal = input?.signal ?? daSignal(type);
  const sockets = daSockets(d.sockets, { outputs, loop: d.rec.value(DAF.loop) === true, signal, connector: input?.connector ?? connectorsFor(signal)[0] });
  if (typeof sockets === "string") throw new Error(sockets);
  if (str(d.rec.value(DEV.description)) === daDescription(type, outputsBefore)) s.setRecordField(id, d.rec.format, DEV.description, daDescription(type, outputs));
  writeSockets(s, deviceOf(s, id)!, sockets);
}

/** whether a device is a panel's port */
export const isPanel = (d: Device): boolean => d.rec.value(PNL.port) !== undefined;
/** A device's Device Type as Object Info shows it: a panel's or distribution amplifier's own, else Device (or External). */
export const deviceTypeOf = (d: Device): string => str(d.rec.value(DAF.type)) || (d.kind === "external" ? "External" : "Device");
/** The rack a device's Rack field names; "" for none. */
export const deviceRackOf = (d: Device): string => str(d.rec.value(DEV.rack)).trim();
const panelTypeFor = (d: Device): PanelType | null => panelTypeOf(str(d.rec.value(DAF.type)));
/** A panel device's ports, or undefined for another device. */
export const portsOf = (d: Device): string[] | undefined => (isPanel(d) ? portsIn(d.sockets) : undefined);
const placeOf = (d: Device): PortPlace => ({ group: groupOf(str(d.rec.value(PNL.group))), panel: Math.max(1, Math.round(num(d.rec.value(PNL.panel)))), port: Math.max(1, Math.round(num(d.rec.value(PNL.port)))) });
const panelPrefix = (kind: PanelKind): string => ccadSettings.panelPrefix[kind].trim() || PANEL_PREFIX[kind];
export const PANEL_TOOLS: Readonly<Record<PanelKind, string>> = { term: "Term Panel", jack: "Jackfield", linked: "Linked Jackfield", connector: "Connector Panel" };
/** a connector panel's port number as kept: 0 for none */
const portOf = (d: Device): number => Math.max(0, Math.round(num(d.rec.value(PNL.port))));
const isConnectorPanel = (d: Device): boolean => isPanel(d) && panelTypeFor(d)?.kind === "connector";
/** the type each tool places now */
export const panelTypeNow = (kind: PanelKind): PanelType => panelTypeOf(ccadSettings.panelType[kind]) ?? panelTypes(kind)[0];

/** The box of a new panel device on a layer. */
export function panelBox(layerId: string): Box {
  const pitch = pitchOn(layerId);
  return boxFor({ width: PANEL_WIDTH * pitch, height: 0 }, panelSockets(panelTypes("term")[0], 1, PASSIVE, PASSIVE), pitch);
}

/** The connector a panel of type `t` carrying `signal` has: the one asked of its tool, or its type's, or the signal's first; a connector panel's whatever the signal. */
function panelConnectorFor(t: PanelType, signal: string): string {
  if (t.kind === "connector") return ccadSettings.panelConnector.connector || t.connector;
  const offered = connectorsFor(signal);
  return [ccadSettings.panelConnector[t.kind], t.connector].find((c) => c && offered.includes(c)) ?? offered[0];
}

/** Adds a panel device of type `t` for the port at `place`, carrying `signal`, its top left at `at`, as part of a batch; its id. */
export function addPanel(s: EditSession, layerId: string, at: Pt, t: PanelType, place: PortPlace, signal: string, code = ""): string {
  const connector = panelConnectorFor(t, signal);
  const sockets = t.kind === "connector" ? connectorSockets(connectorPort(code, place.port), 1, signal, connector) : panelSockets(t, place.port, signal, connector);
  return newPanel(s, layerId, at, t, place, sockets, { name: panelName(panelPrefix(t.kind), place), tag: panelTag(place), maker: ccadSettings.panelMaker }, 0, code);
}

/** Adds a panel device with the sockets given, as part of a batch; its id. */
function newPanel(s: EditSession, layerId: string, at: Pt, t: PanelType, place: PortPlace, sockets: readonly Socket[], names: { name: string; tag: string; maker: string }, angle = 0, code = ""): string {
  const box = panelBox(layerId);
  const own = (f: PluginFieldSpec): PluginFieldSpec => (f.name === DEV.tag ? { ...f, value: names.tag } : f.name === DEV.description ? { ...f, value: "" } : f.name === DEV.maker ? { ...f, value: names.maker } : f);
  const specs: PluginFieldSpec[] = [
    ...deviceSpecs(names.name, box.width, box.height).map(own),
    { name: DAF.type, type: TEXT, value: t.device },
    { name: PNL.group, type: TEXT, value: place.group },
    { name: PNL.panel, type: NUMBER, value: place.panel },
    { name: PNL.port, type: NUMBER, value: place.port },
    ...(t.kind === "connector" ? [{ name: PNL.code, type: TEXT, value: code }] : []),
  ];
  const values = { ...Object.fromEntries(specs.map((f) => [f.name, f.value])), [DEV.sockets]: JSON.stringify(sockets) };
  const id = s.addPluginObject(layerId, PANEL, specs, values, at, angle, store.activeClassIndex);
  drawDevice(s, id);
  return id;
}

/** Where a panel device placed at `p` on a layer splits a circuit, or null. */
export const panelSplitAt = (s: EditSession, layerId: string, p: Pt): Split | null => splitAt(s, layerId, p, panelBox(layerId));

/** Where a tool's next ports go: on from the one panel device of its kind selected, or from where it left off. */
function panelStart(s: EditSession, kind: PanelKind): PortPlace {
  const picked = [...store.selection].map((id) => deviceOf(s, id)).filter((d): d is Device => !!d && isPanel(d) && panelTypeFor(d)?.kind === kind);
  const t = picked.length === 1 ? panelTypeFor(picked[0]) : null;
  return t ? afterPort(placeOf(picked[0]), panelSize(t)) : ccadSettings.panelNext[kind];
}

/** The ports a tool places next, `count` of them: past ports taken, and past panels of another type. */
export function panelPlaces(s: EditSession, kind: PanelKind, count: number): PortPlace[] {
  const t = panelTypeNow(kind);
  const panels = devicesOn(s).filter(isPanel);
  const taken = new Set(panels.flatMap((d) => portsIn(d.sockets).map((p) => portKey(d.name, Number(p)))));
  const others = new Set(panels.filter((d) => panelTypeFor(d)?.device !== t.device).map((d) => d.name));
  return nextPorts(panelPrefix(kind), panelStart(s, kind), count, panelSize(t), taken, others);
}

/**
 * The Connector Panel tool's next `count` ports and their code: on from the one connector panel device
 * selected, or from where it left off, past the ports of that code its panel has already.
 */
export function connectorPlaces(s: EditSession, count: number): { code: string; places: PortPlace[] } {
  const picked = [...store.selection].map((id) => deviceOf(s, id)).filter((d): d is Device => !!d && isConnectorPanel(d));
  const one = picked.length === 1 ? picked[0] : null;
  const code = one ? str(one.rec.value(PNL.code)) : ccadSettings.connectorCode;
  const start = one ? { ...placeOf(one), port: portOf(one) && portOf(one) + 1 } : ccadSettings.panelNext.connector;
  const name = panelName(panelPrefix("connector"), start);
  const taken = new Set(devicesOn(s).filter((d) => isConnectorPanel(d) && d.name === name).map((d) => connectorPort(str(d.rec.value(PNL.code)), portOf(d))));
  return { code, places: nextConnectorPorts(code, start.port, count, taken).map((port) => ({ group: start.group, panel: start.panel, port })) };
}

/** The connector panels in the drawing, by their panel's name (BOX1). */
export const connectorPanelsIn = (s: EditSession): string[] => [...new Set(devicesOn(s).filter(isConnectorPanel).map((d) => panelTag(placeOf(d))))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

/** The name and port the next panel device of a tool would have, for its hint. */
export function nextPanelLabel(kind: PanelKind): string {
  const s = store.session;
  if (kind === "connector") {
    const next = s ? connectorPlaces(s, 1) : { code: ccadSettings.connectorCode, places: [ccadSettings.panelNext.connector] };
    return `${panelName(panelPrefix(kind), next.places[0])} port ${connectorPort(next.code, next.places[0].port)}`;
  }
  const p = s ? panelPlaces(s, kind, 1)[0] : ccadSettings.panelNext[kind];
  return `${panelName(panelPrefix(kind), p)} port ${p.port}`;
}

/** The Term Panel and Jackfield tools' clicks: one panel device at `a`, splitting a circuit there, or a linear array of them from `a` toward `b`, its ports counting on. */
export function placePanels(kind: PanelKind, layerId: string, a: Pt, b: Pt | null): void {
  const t = panelTypeNow(kind);
  const r = attempt(PANEL_TOOLS[kind], (s) =>
    s.batch(() => {
      const box = panelBox(layerId);
      const corners = b ? arrayPlaces(a, b, box, pitchOn(layerId)).slice(0, MAX_PORTS) : [a];
      const connector = kind === "connector" ? connectorPlaces(s, corners.length) : null;
      const places = connector?.places ?? panelPlaces(s, kind, corners.length);
      const code = connector?.code ?? "";
      const split = b ? null : panelSplitAt(s, layerId, a);
      let ids: string[];
      if (split) {
        const signal = [PASSIVE, UNKNOWN].includes(split.signal) ? t.signal : split.signal;
        if (!panelCarries(t, signal)) throw new Error(`That circuit carries ${signal}, and a ${t.device} carries ${t.category} signals: choose another type, or click clear of the circuit.`);
        const id = addPanel(s, layerId, split.corner, t, places[0], signal, code);
        splitCircuit(s, split.id, id, split.type);
        ids = [id];
      } else ids = corners.map((c, i) => addPanel(s, layerId, c, t, places[i], t.signal, code));
      const last = places[places.length - 1];
      ccadSettings.panelNext[kind] = connector ? { ...last, port: last.port && last.port + 1 } : afterPort(last, panelSize(t));
      return ids;
    }),
  );
  if (r) setEditGroup(null, r.value);
}

/** Re-points the circuits joined at the sockets of `moved` ("device/socket" to its new end), as part of a batch, and draws them again. */
function repoint(s: EditSession, moved: ReadonlyMap<string, SocketRef>): void {
  for (const c of circuitsIn(s)) {
    const ends = [
      [CIR.sourceId, CIR.sourceSocket],
      [CIR.destinationId, CIR.destinationSocket],
    ] as const;
    const to = ends.map(([device, socket]) => moved.get(`${str(c.value(device))}/${num(c.value(socket))}`));
    if (!to.some(Boolean)) continue;
    ends.forEach(([device, socket], i) => {
      const end = to[i];
      if (!end) return;
      s.setRecordField(c.id, c.format, device, end.deviceId);
      s.setRecordField(c.id, c.format, socket, end.socketId);
    });
    drawCircuit(s, c.id);
  }
}

const portNumber = (k: Socket, fallback: number): number => {
  const n = parseInt(k.name, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Combine Panels: the selected panel devices of one name and type on a layer made one device, a row for
 * each port in their order, in the place of the one of the lowest port; their circuits stay joined.
 * As part of a batch; the devices made.
 */
export function combinePanels(s: EditSession, ids: readonly string[]): string[] {
  const groups = new Map<string, Device[]>();
  for (const id of ids) {
    const d = deviceOf(s, id);
    if (!d || !isPanel(d)) continue;
    const key = `${d.rec.layerId}/${d.name}/${str(d.rec.value(DAF.type))}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const made: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const rows = (d: Device): Socket[][] => [...new Set(d.sockets.map((k) => k.slot))].sort((a, b) => a - b).map((slot) => d.sockets.filter((k) => k.slot === slot));
    const ordered = [...group].sort((a, b) => portNumber(rows(a)[0][0], 0) - portNumber(rows(b)[0][0], 0));
    const [keeper] = ordered;
    const moved = new Map<string, SocketRef>();
    let id = Math.max(0, ...keeper.sockets.map((k) => k.id));
    let slot = 0;
    const sockets = ordered.flatMap((d) =>
      rows(d).flatMap((row) => {
        const at = slot++;
        return row.map((k): Socket => {
          const next = d === keeper ? k.id : ++id;
          moved.set(`${d.rec.id}/${k.id}`, { deviceId: keeper.rec.id, socketId: next });
          return { ...k, id: next, slot: at };
        });
      }),
    );
    writeSockets(s, keeper, sockets);
    s.setRecordField(keeper.rec.id, keeper.rec.format, PNL.port, portNumber(sockets[0], placeOf(keeper).port));
    s.deleteObjects(ordered.slice(1).map((d) => d.rec.id));
    repoint(s, moved);
    made.push(keeper.rec.id);
  }
  if (!made.length) throw new Error("Select two or more panel devices of one name and type, on one layer, to combine them.");
  return made;
}

/**
 * Split Panels: each selected panel device of more than one port made a device for each, of its name
 * and type, the first in its place and the rest below it; circuits stay joined. As part of a batch;
 * the devices made.
 */
export function splitPanels(s: EditSession, ids: readonly string[]): string[] {
  const made: string[] = [];
  for (const id of ids) {
    const d = deviceOf(s, id);
    const t = d && isPanel(d) ? panelTypeFor(d) : null;
    if (!d || !t) continue;
    const slots = [...new Set(d.sockets.map((k) => k.slot))].sort((a, b) => a - b);
    if (slots.length < 2) continue;
    const place = placeOf(d);
    const step = panelBox(d.rec.layerId).height + d.pitch;
    const moved = new Map<string, SocketRef>();
    const names = { name: d.name, tag: str(d.rec.value(DEV.tag)), maker: str(d.rec.value(DEV.maker)) };
    slots.slice(1).forEach((slot, i) => {
      const row = d.sockets.filter((k) => k.slot === slot);
      const port = portNumber(row[0], place.port + i + 1);
      const fresh = row.map((k, j): Socket => ({ ...k, id: j + 1, slot: 0 }));
      const at = toWorld(d, { x: 0, y: -(i + 1) * step });
      const nid = newPanel(s, d.rec.layerId, at, t, { ...place, port }, fresh, names, d.angle, str(d.rec.value(PNL.code)));
      row.forEach((k, j) => moved.set(`${d.rec.id}/${k.id}`, { deviceId: nid, socketId: j + 1 }));
      made.push(nid);
    });
    const first = d.sockets.filter((k) => k.slot === slots[0]).map((k) => ({ ...k, slot: 0 }));
    writeSockets(s, d, first);
    s.setRecordField(d.rec.id, d.rec.format, PNL.port, portNumber(first[0], place.port));
    repoint(s, moved);
    made.push(d.rec.id);
  }
  if (!made.length) throw new Error("Select a panel device of more than one port to split it.");
  return made;
}

/** A panel device after its Group, Panel or Port changed: its name and tag following while they're its own, its sockets named by its port. */
function refitPanel(s: EditSession, id: string, was: PortPlace): void {
  const d = deviceOf(s, id);
  const t = d ? panelTypeFor(d) : null;
  if (!d || !t) return;
  const now = t.kind === "connector" ? { ...placeOf(d), port: portOf(d) } : placeOf(d);
  const set = (field: string, value: RecordValue): void => {
    if (d.rec.value(field) !== value) s.setRecordField(id, d.rec.format, field, value);
  };
  set(PNL.group, now.group);
  set(PNL.panel, now.panel);
  set(PNL.port, now.port);
  const oldTag = panelTag(was);
  if (d.name.endsWith(oldTag)) set(DEV.name, d.name.slice(0, -oldTag.length) + panelTag(now));
  if (str(d.rec.value(DEV.tag)) === oldTag) set(DEV.tag, panelTag(now));
  if (t.kind !== "connector") {
    writeSockets(s, deviceOf(s, id)!, panelSockets(t, now.port, t.signal, t.connector, d.sockets));
    return;
  }
  const rows = new Set(d.sockets.map((k) => k.slot)).size;
  writeSockets(s, deviceOf(s, id)!, connectorSockets(connectorPort(str(d.rec.value(PNL.code)), now.port), rows, d.sockets[0]?.signal ?? t.signal, d.sockets[0]?.connector ?? t.connector, d.sockets));
}

/** What Edit Device Array gives the connector panels selected. */
export interface DeviceArray {
  readonly type: string;
  /** the panel's name (BOX1) */
  readonly panel: string;
  readonly code: string;
  /** the first port's number, 0 for none; null to keep each device's */
  readonly number: number | null;
  readonly connector: string;
  readonly circuits: number;
}

/**
 * Edit Device Array: connector panel devices given a type (input or output), a panel, a port code,
 * a connector and a number of circuits, and their ports numbered on from `number` in the order given,
 * their names and tags following. As part of a batch; refuses to take away rows holding circuits.
 */
export function setDeviceArray(s: EditSession, ids: readonly string[], v: DeviceArray): void {
  const t = panelTypeOf(v.type);
  if (t?.kind !== "connector") throw new Error("Choose Connector Panel Input or Output.");
  const devices = ids.map((id) => deviceOf(s, id)).filter((d): d is Device => !!d && isConnectorPanel(d));
  const joined = new Set(circuitsIn(s).flatMap((c) => [`${str(c.value(CIR.sourceId))}/${num(c.value(CIR.sourceSocket))}`, `${str(c.value(CIR.destinationId))}/${num(c.value(CIR.destinationSocket))}`]));
  for (const d of devices) {
    const lost = rowsLost(d.sockets, v.circuits, new Set(d.sockets.filter((k) => joined.has(`${d.rec.id}/${k.id}`)).map((k) => k.id)));
    if (lost.length) throw new Error(`${d.name} ${lost.join(", ")} ${lost.length > 1 ? "hold circuits" : "holds a circuit"}: disconnect ${lost.length > 1 ? "them" : "it"} before giving it fewer circuits.`);
  }
  const place = panelPlaceOf(v.panel);
  devices.forEach((d, i) => {
    const was = placeOf(d);
    const set = (field: string, value: RecordValue): void => {
      if (d.rec.value(field) !== value) s.setRecordField(d.rec.id, d.rec.format, field, value);
    };
    set(DAF.type, t.device);
    set(PNL.group, place.group);
    set(PNL.panel, place.panel);
    set(PNL.code, v.code.trim());
    if (v.number !== null) set(PNL.port, v.number > 0 ? Math.round(v.number) + i : 0);
    refitPanel(s, d.rec.id, was);
    const now = deviceOf(s, d.rec.id)!;
    const port = connectorPort(v.code, portOf(now));
    writeSockets(s, now, connectorSockets(port, v.circuits, now.sockets[0]?.signal ?? t.signal, v.connector, now.sockets).map((k) => ({ ...k, connector: v.connector })));
  });
}

/** A connector panel device's settings, for Edit Device Array. */
export function deviceArrayOf(s: EditSession, id: string): DeviceArray | null {
  const d = deviceOf(s, id);
  if (!d || !isConnectorPanel(d)) return null;
  return { type: str(d.rec.value(DAF.type)), panel: panelTag(placeOf(d)), code: str(d.rec.value(PNL.code)), number: portOf(d), connector: d.sockets[0]?.connector ?? "XLR3", circuits: Math.max(1, new Set(d.sockets.map((k) => k.slot)).size) };
}

/** The connector panel devices of `ids`, for Edit Device Array: top to bottom, then left to right. */
export function connectorPanelsOf(s: EditSession, ids: Iterable<string>): string[] {
  const devices = [...ids].map((id) => deviceOf(s, id)).filter((d): d is Device => !!d && isConnectorPanel(d));
  const at = (d: Device): Pt => toWorld(d, { x: 0, y: 0 });
  return devices.sort((a, b) => at(b).y - at(a).y || at(a).x - at(b).x).map((d) => d.rec.id);
}

/** An adapter's place on the drawing: its top left and its angle. */
interface Place {
  readonly at: Pt;
  readonly angle: number;
}
const placeText = (p: Place): string => [p.at.x, p.at.y, p.angle].join(",");
function placeIn(text: string): Place | null {
  const [x, y, angle] = text.split(",").map(Number);
  return [x, y, angle].every(Number.isFinite) ? { at: { x, y }, angle } : null;
}
const samePlace = (p: Place, q: Place): boolean => Math.hypot(p.at.x - q.at.x, p.at.y - q.at.y) < 1e-4 && Math.abs(((((p.angle - q.angle) % 360) + 540) % 360) - 180) < 1e-4;
const sockKey = (deviceId: string, socketId: number): string => `${deviceId}/${socketId}`;
const hostKey = (a: Device): string | null => (str(a.rec.value(ADP.host)) ? sockKey(str(a.rec.value(ADP.host)), num(a.rec.value(ADP.hostSocket))) : null);

interface Host {
  readonly device: Device;
  readonly socket: Socket;
}

/** The device and socket an adapter is on, while both are there and the socket can take it; null for one off its socket. */
function hostOf(s: EditSession, a: Device, devices: Devices = new Map()): Host | null {
  const id = str(a.rec.value(ADP.host));
  if (!id) return null;
  if (!devices.has(id)) devices.set(id, deviceOf(s, id));
  const device = devices.get(id);
  const socket = device?.sockets.find((k) => k.id === num(a.rec.value(ADP.hostSocket)));
  return device && socket && device.kind !== "adapter" && !adapterRefusal(socket) ? { device, socket } : null;
}

/** Whether an adapter is on a socket, for Check Drawing. */
export const adapterOnSocket = (s: EditSession, a: Device): boolean => hostOf(s, a) !== null;

/** The adapter on a device's socket, if any. */
function adapterOn(s: EditSession, deviceId: string, socketId: number): Device | null {
  const key = sockKey(deviceId, socketId);
  return devicesOn(s).find((a) => a.kind === "adapter" && hostKey(a) === key) ?? null;
}

/** Where an adapter of `box` goes on a host's socket. */
function adapterPlace(host: Host, box: Box, pitch: number): Place {
  const tip = slotEnd(host.device.box, host.socket.side, host.socket.slot, host.device.pitch).tip;
  return { at: toWorld(host.device, adapterCorner(tip, host.socket.side, box, pitch)), angle: host.device.angle };
}

/** An adapter's sockets on a host socket: its own names and connector, the host's way, side and signal. */
const socketsOn = (a: Device, host: Socket): Socket[] => a.sockets.map((k) => ({ ...k, type: host.type, side: host.side, signal: host.signal }));

/** The socket an adapter dropped where it is goes on: a free left or right socket of another device on its layer, under the edge that goes on it. */
function socketUnder(a: Device, devices: readonly Device[], taken: ReadonlyMap<string, string>): Host | null {
  let best: (Host & { gap: number }) | null = null;
  for (const d of devices) {
    if (d.kind === "adapter" || d.rec.layerId !== a.rec.layerId) continue;
    for (const k of d.sockets) {
      if (adapterRefusal(k) || (taken.get(sockKey(d.rec.id, k.id)) ?? a.rec.id) !== a.rec.id) continue;
      const near = toWorld(a, adapterNear(k.side, a.box, a.pitch));
      const tip = endOf(d, k).tip;
      const gap = Math.hypot(near.x - tip.x, near.y - tip.y);
      if (gap <= a.pitch / 2 && (!best || gap < best.gap)) best = { device: d, socket: k, gap };
    }
  }
  return best && { device: best.device, socket: best.socket };
}

interface AdapterMove {
  readonly adapter: Device;
  readonly host: Host | null;
  readonly place: Place;
  readonly sockets: Socket[] | null;
}

/**
 * What keeps adapters on their sockets after an edit: one whose device moved or turned follows it; one
 * moved itself goes on the socket it was dropped on, or is off any; one whose device or socket has gone
 * is off. Only the adapters that change.
 */
function adapterMoves(s: EditSession, all: readonly Device[]): AdapterMove[] {
  const adapters = all.filter((d) => d.kind === "adapter");
  if (!adapters.length) return [];
  const taken = new Map(adapters.flatMap((a) => (hostKey(a) ? [[hostKey(a)!, a.rec.id] as const] : [])));
  const devices: Devices = new Map();
  const moves: AdapterMove[] = [];
  for (const a of adapters) {
    const now: Place = { at: a.at, angle: a.angle };
    const placed = placeIn(str(a.rec.value(ADP.placed)));
    const had = hostOf(s, a, devices);
    let host = had;
    // moved itself, not with its device: onto the socket it's dropped on
    if (!placed || !samePlace(placed, now)) if (!had || !samePlace(adapterPlace(had, a.box, a.pitch), now)) host = socketUnder(a, all, taken);
    const place = host ? adapterPlace(host, a.box, a.pitch) : now;
    const sockets = host ? socketsOn(a, host.socket) : null;
    const key = host ? sockKey(host.device.rec.id, host.socket.id) : null;
    const resocketed = sockets !== null && JSON.stringify(sockets) !== JSON.stringify(a.sockets);
    if (key === hostKey(a) && placed && samePlace(placed, place) && samePlace(now, place) && !resocketed) continue;
    const old = hostKey(a);
    if (old && taken.get(old) === a.rec.id) taken.delete(old);
    if (key) taken.set(key, a.rec.id);
    moves.push({ adapter: a, host, place, sockets: resocketed ? sockets : null });
  }
  return moves;
}

/** Puts adapters where adapterMoves says, as part of a batch: a socket an adapter goes on gives its circuits to the adapter's first socket while that's free. */
function moveAdapters(s: EditSession, moves: readonly AdapterMove[]): void {
  for (const { adapter: a, host, place, sockets } of moves) {
    const id = a.rec.id;
    const by = place.angle - a.angle;
    if (Math.abs(by) > 1e-9) s.transformObjects([id], rotationAbout(a.at, (by * Math.PI) / 180));
    if (Math.hypot(place.at.x - a.at.x, place.at.y - a.at.y) > 1e-9) s.moveObjects([id], place.at.x - a.at.x, place.at.y - a.at.y);
    const set = (field: string, value: RecordValue): void => {
      if (a.rec.value(field) !== value) s.setRecordField(id, a.rec.format, field, value);
    };
    const newHost = host && hostKey(a) !== sockKey(host.device.rec.id, host.socket.id) ? host : null;
    set(ADP.host, host?.device.rec.id ?? "");
    set(ADP.hostSocket, host?.socket.id ?? 0);
    set(ADP.placed, placeText(place));
    const d = deviceOf(s, id)!;
    if (sockets) writeSockets(s, d, sockets);
    else drawDevice(s, id);
    const first = d.sockets[0];
    if (newHost && first && !circuitsAt(s, id, first.id).length) repoint(s, new Map([[sockKey(newHost.device.rec.id, newHost.socket.id), { deviceId: id, socketId: first.id }]]));
  }
}

/** every connector, for an adapter's */
/** every connector there is: each signal's, and the drawing's own */
export const allConnectors = (): string[] => connectorsFor(UNKNOWN);

function adapterSpecs(box: Box): PluginFieldSpec[] {
  const k = ccadSettings;
  return [
    { name: ADP.make, type: TEXT, value: k.adapterMake.trim() || "Adapter" },
    { name: ADP.connector, type: POPUP, value: k.adapterConnector },
    { name: ADP.names, type: TEXT, value: adapterNames(k.adapterNames).join(", ") },
    { name: DEV.boxWidth, type: DIMENSION, value: box.width },
    { name: DEV.boxHeight, type: DIMENSION, value: box.height },
    { name: DEV.sockets, type: TEXT, value: "[]" },
    { name: ADP.host, type: TEXT, value: "" },
    { name: ADP.hostSocket, type: NUMBER, value: 0 },
    { name: ADP.placed, type: TEXT, value: "" },
    { name: DEV.drawn, type: TEXT, value: "" },
  ];
}

/** Why a socket can't take an adapter, or null. */
export function adapterRefusalAt(s: EditSession, ref: SocketRef): string | null {
  const d = deviceOf(s, ref.deviceId);
  const socket = d?.sockets.find((k) => k.id === ref.socketId);
  if (!d || !socket) return "That socket has gone.";
  if (d.kind === "adapter") return "That's an adapter's socket: put an adapter on a device's socket.";
  if (adapterOn(s, d.rec.id, socket.id)) return `${d.name} : ${socket.name} has an adapter already.`;
  return adapterRefusal(socket);
}

/** Adds an adapter of the tool's settings on a device's socket, as part of a batch: the socket's circuits move to its first socket; its id. */
export function addAdapter(s: EditSession, ref: SocketRef): string {
  const why = adapterRefusalAt(s, ref);
  if (why) throw new Error(why);
  const device = deviceOf(s, ref.deviceId)!;
  const socket = device.sockets.find((k) => k.id === ref.socketId)!;
  const sockets = adapterSockets(adapterNames(ccadSettings.adapterNames), socket, ccadSettings.adapterConnector);
  const box = boxFor({ width: ADAPTER_WIDTH * device.pitch, height: 0 }, sockets, device.pitch);
  const place = adapterPlace({ device, socket }, box, device.pitch);
  const specs = adapterSpecs(box);
  const values: Record<string, RecordValue> = { ...Object.fromEntries(specs.map((f) => [f.name, f.value])), [DEV.sockets]: JSON.stringify(sockets), [ADP.host]: device.rec.id, [ADP.hostSocket]: socket.id, [ADP.placed]: placeText(place) };
  const id = s.addPluginObject(device.rec.layerId, ADAPTER, specs, values, place.at, place.angle, s.doc.object(device.rec.id)?.classIndex ?? store.activeClassIndex);
  drawDevice(s, id);
  repoint(s, new Map([[sockKey(device.rec.id, socket.id), { deviceId: id, socketId: sockets[0].id }]]));
  return id;
}

/** The Adapter tool's click on a socket. */
export function placeAdapter(ref: SocketRef): void {
  const r = attempt("Adapter", (s) => s.batch(() => addAdapter(s, ref)));
  if (r) setEditGroup(null, [r.value]);
}

/** An Object Info edit of an adapter: its sockets made again from its names and connector, circuits kept by place. */
function editAdapter(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Adapter", (s) =>
    s.batch(() => {
      const rec = recOf(s, id, ADAPTER);
      if (!rec) throw new Error("That isn't a ConnectCAD adapter.");
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      const a = deviceOf(s, id)!;
      const like = hostOf(s, a)?.socket ?? a.sockets[0];
      if (!like) return drawDevice(s, id);
      const names = adapterNames(str(a.rec.value(ADP.names)));
      s.setRecordField(id, rec.format, ADP.names, names.join(", "));
      writeSockets(s, a, adapterSockets(names, like, str(a.rec.value(ADP.connector)), a.sockets));
    }),
  );
}

/** Writes a device's sockets, its box grown to hold them, and draws it again, as part of a batch. */
function writeSockets(s: EditSession, d: Device, asked: readonly Socket[]): void {
  const sockets = cleanLoops(asked);
  // an external, a DA, a panel or an adapter is just as tall as its sockets need
  const box = boxFor({ width: num(d.rec.value(DEV.boxWidth)), height: d.kind !== "device" || isDa(d) || isPanel(d) ? 0 : num(d.rec.value(DEV.boxHeight)) }, sockets, d.pitch);
  s.setRecordField(d.rec.id, d.rec.format, DEV.sockets, JSON.stringify(sockets));
  if (d.kind === "external" && num(d.rec.value(EXT.circuits)) !== sockets.length) s.setRecordField(d.rec.id, d.rec.format, EXT.circuits, sockets.length);
  if (isDa(d)) {
    // its Object Info follows what Edit Sockets did
    const outputs = sockets.filter((k) => k.side === "R" && k.type === "OUT").length;
    const looped = sockets.some((k) => k.side === "L" && k.loop !== undefined);
    if (num(d.rec.value(DAF.outputs)) !== outputs) s.setRecordField(d.rec.id, d.rec.format, DAF.outputs, outputs);
    if ((d.rec.value(DAF.loop) === true) !== looped) s.setRecordField(d.rec.id, d.rec.format, DAF.loop, looped);
  }
  if (box.height !== num(d.rec.value(DEV.boxHeight))) s.setRecordField(d.rec.id, d.rec.format, DEV.boxHeight, box.height);
  if (box.width !== num(d.rec.value(DEV.boxWidth))) s.setRecordField(d.rec.id, d.rec.format, DEV.boxWidth, box.width);
  drawDevice(s, d.rec.id);
}

export interface NewSocket {
  readonly name: string;
  readonly type: SocketType;
  readonly side: Side | "auto";
  readonly signal: string;
  readonly connector: string;
}

/** Adds a socket to a device where `p` (on the drawing) falls, as part of a batch: the new socket, or why not. */
export function addSocket(s: EditSession, deviceId: string, p: Pt, asked: NewSocket): Socket | string {
  const d = deviceOf(s, deviceId);
  if (!d) return "That isn't a ConnectCAD device.";
  const place = slotFor(d.box, toLocal(d, p), d.pitch, asked.side);
  if (!place) return "Click on the device's box, where the socket goes.";
  if (d.sockets.some((x) => x.side === place.side && x.slot === place.slot)) return "There's a socket there already: click a free row.";
  const name = socketName(asked.name, asked.type, new Set(d.sockets.map((x) => x.name)));
  const socket: Socket = { id: Math.max(0, ...d.sockets.map((x) => x.id)) + 1, name, tag: name, type: asked.type, side: place.side, slot: place.slot, signal: asked.signal, connector: asked.connector, terminated: false };
  writeSockets(s, d, [...d.sockets, socket]);
  return socket;
}

const unlooped = (k: Socket): Socket => {
  const { loop: _gone, ...rest } = k;
  return rest;
};

/**
 * A Socket Loop click on a device at `p`, as part of a batch: a looped socket's loop taken off, or the
 * socket there looped with its neighbour, any missing added (taking the signal of one there already);
 * what was done.
 */
export function loopSockets(s: EditSession, deviceId: string, p: Pt, asked: NewSocket): string {
  const d = deviceOf(s, deviceId);
  if (!d) throw new Error("That isn't a ConnectCAD device.");
  const q = toLocal(d, p);
  const hit = socketAt(d.sockets, d.box, q, d.pitch);
  const place = hit ? { side: hit.side, slot: hit.slot } : slotFor(d.box, q, d.pitch, asked.side);
  if (!place) throw new Error("Click on the device's box, where the loop goes.");
  const plan = loopPlan(d.sockets, place.side, place.slot);
  if (typeof plan === "string") throw new Error(plan);
  if (plan.kind === "unloop") {
    writeSockets(s, d, d.sockets.map((k) => (plan.ids.includes(k.id) ? unlooped(k) : k)));
    const [a, b] = plan.ids.map((id) => d.sockets.find((k) => k.id === id)?.name ?? "");
    return `${d.name} : ${a} no longer loops to ${b}`;
  }
  const joined = plan.join.map((id) => d.sockets.find((k) => k.id === id)).filter((k): k is Socket => k !== undefined);
  const taken = new Set(d.sockets.map((k) => k.name));
  let id = Math.max(0, ...d.sockets.map((k) => k.id));
  const added = plan.add.map((slot): Socket => {
    const name = socketName(asked.name, asked.type, taken);
    taken.add(name);
    return { id: ++id, name, tag: name, type: asked.type, side: place.side, slot, signal: joined[0]?.signal ?? asked.signal, connector: joined[0]?.connector ?? asked.connector, terminated: false };
  });
  const [a, b] = [...joined, ...added].sort((x, y) => x.slot - y.slot);
  const partner = new Map([
    [a.id, b.id],
    [b.id, a.id],
  ]);
  writeSockets(
    s,
    d,
    [...d.sockets, ...added].map((k) => {
      const loop = partner.get(k.id);
      return loop === undefined ? k : { ...k, loop };
    }),
  );
  return `${d.name} : ${a.name} loops to ${b.name}`;
}

/**
 * A Linear Array of sockets on one side of a device, as part of a batch: a socket in each row of
 * `rows` (rowSlots), the two of a pair looped; the sockets made, named on from the name asked.
 */
export function addSocketRow(s: EditSession, deviceId: string, side: Side, rows: readonly (readonly number[])[], asked: NewSocket): Socket[] {
  const d = deviceOf(s, deviceId);
  if (!d) throw new Error("That isn't a ConnectCAD device.");
  if (!rows.length) throw new Error("There's no free row there.");
  const taken = new Set(d.sockets.map((k) => k.name));
  let id = Math.max(0, ...d.sockets.map((k) => k.id));
  const made: Socket[] = [];
  for (const row of rows) {
    const group = row.map((slot): Socket => {
      const name = socketName(asked.name, asked.type, taken, settingsNow().digits);
      taken.add(name);
      return { id: ++id, name, tag: name, type: asked.type, side, slot, signal: asked.signal, connector: asked.connector, terminated: false };
    });
    if (group.length === 2) made.push({ ...group[0], loop: group[1].id }, { ...group[1], loop: group[0].id });
    else made.push(...group);
  }
  writeSockets(s, d, [...d.sockets, ...made]);
  return made;
}

/** Replaces a device's sockets (the Edit Sockets dialog), as part of a batch. */
export function setSockets(s: EditSession, deviceId: string, sockets: readonly Socket[]): void {
  const d = deviceOf(s, deviceId);
  if (!d) throw new Error("That isn't a ConnectCAD device.");
  writeSockets(s, d, sockets);
}

/** What the Device tool's Pick Up takes from a device: what its Apply transfers onto others. */
export interface DeviceCopy {
  readonly id: string;
  readonly name: string;
  readonly fields: Readonly<Record<string, RecordValue>>;
  readonly sockets: readonly Socket[];
  readonly classIndex: number;
  readonly attrs: Attributes | null;
  readonly byClass: readonly ByClassGroup[];
  readonly records: readonly { readonly format: number; readonly fields: readonly { readonly name: string; readonly value: RecordValue }[] }[];
}

/** what the eyedropper transfers of a device's own fields: its make and model, box, physical and location data, not its name or tag */
const TRANSFERRED = [DEV.description, DEV.maker, DEV.boxWidth, DEV.boxHeight, DEV.height, DEV.width, DEV.depth, DEV.power, DEV.autoBtu, DEV.btu, DEV.weight, DEV.ru, DEV.rackWidth, DEV.room, DEV.rack, DEV.rackU];

/** A device the eyedropper takes, or null: not a distribution amplifier, panel, external or adapter. */
export function plainDevice(s: EditSession, id: string): Device | null {
  const d = deviceOf(s, id);
  return d && d.kind === "device" && !isDa(d) && !isPanel(d) ? d : null;
}

/** The drawing's devices (not distribution amplifiers, panels, externals or adapters) named `name`. */
export const devicesNamed = (s: EditSession, name: string): Device[] => (name ? devicesOn(s).filter((d) => d.name === name && plainDevice(s, d.rec.id)) : []);

/**
 * The socket named `socket` in the devices named `device`, for an adapter slot of equipment of that
 * name (adapterSlots.ts): the make and model of the adapter on it, or null when it has none; undefined
 * when no such device has such a socket.
 */
export function slotSocket(s: EditSession, device: string, socket: string): { adapter: string | null } | undefined {
  if (!socket) return undefined;
  for (const d of devicesNamed(s, device)) {
    const k = d.sockets.find((q) => q.name === socket);
    if (k) return { adapter: adapterOn(s, d.rec.id, k.id)?.name ?? null };
  }
  return undefined;
}

/** The names of the sockets in the devices named `device`, in their order, once each. */
export const socketNamesOf = (s: EditSession, device: string): string[] => [...new Set(devicesNamed(s, device).flatMap((d) => d.sockets.map((k) => k.name).filter(Boolean)))];

/** Whether equipment stands for the devices of a name (equipmentItem.ts says), which greys the data it keeps on them. */
export const equipmentFor = { linked: (_s: EditSession, _name: string): boolean => false };

/** Equipment's data put on a device of its name (equipmentItem.ts), as part of a batch: the fields that differ, the device drawn again if any did. */
export function setDeviceData(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const d = plainDevice(s, id);
  if (!d) return;
  const changed = Object.entries(values).filter(([field, value]) => d.rec.value(field) !== value);
  for (const [field, value] of changed) s.setRecordField(id, d.rec.format, field, value);
  if (changed.length) drawDevice(s, id);
}

/** Pick Up: what's transferred of a device. */
export function pickUpDevice(s: EditSession, id: string): DeviceCopy {
  const d = plainDevice(s, id);
  const o = s.doc.object(id);
  if (!d || !o) throw new Error("Pick up a device: distribution amplifiers, panels, externals and adapters aren't transferred.");
  return {
    id,
    name: d.name,
    fields: Object.fromEntries(TRANSFERRED.map((f) => [f, d.rec.value(f) ?? ""])),
    sockets: d.sockets,
    classIndex: o.classIndex,
    attrs: o.attrs,
    byClass: o.byClass ?? [],
    records: s.doc
      .records(id)
      .filter((r) => !r.parametric)
      .map((r) => ({ format: r.format, fields: r.fields.map((f) => ({ name: f.name, value: f.value })) })),
  };
}

/** Why Apply leaves a device as it is, or "" when it doesn't. */
export function transferRefusal(s: EditSession, copy: DeviceCopy, id: string): string {
  const d = plainDevice(s, id);
  if (!d) return "Apply onto a device: distribution amplifiers, panels, externals and adapters aren't transferred.";
  if (id === copy.id) return `That's ${copy.name}, the device picked up.`;
  const make = str(copy.fields[DEV.maker]);
  const model = str(copy.fields[DEV.description]);
  if (ccadSettings.transferSameMaker && str(d.rec.value(DEV.maker)) !== make) return `Only devices made by ${make || "no manufacturer"} take ${copy.name}'s properties (Preferences).`;
  if (ccadSettings.transferSameModel && str(d.rec.value(DEV.description)) !== model) return model ? `Only devices described as ${model} take ${copy.name}'s properties (Preferences).` : `Only devices with no description take ${copy.name}'s properties (Preferences).`;
  return "";
}

/**
 * Apply: transfers a device picked up onto others, as part of a batch, as the Preferences ask; the
 * devices changed. Circuits of a socket deleted go with it; the rest keep to their sockets and are
 * drawn again where those have moved.
 */
export function transferDevice(s: EditSession, copy: DeviceCopy, ids: readonly string[]): string[] {
  const done: string[] = [];
  for (const id of ids) {
    if (transferRefusal(s, copy, id)) continue;
    const d = plainDevice(s, id)!;
    const ends = circuitsAt(s, id).flatMap((c) => [
      ...(str(c.value(CIR.sourceId)) === id ? [num(c.value(CIR.sourceSocket))] : []),
      ...(str(c.value(CIR.destinationId)) === id ? [num(c.value(CIR.destinationSocket))] : []),
    ]);
    // a socket with an adapter on it is in use too
    const connected = new Set([...ends, ...d.sockets.filter((k) => adapterOn(s, id, k.id)).map((k) => k.id)]);
    const { sockets, deleted } = transferredSockets(copy.sockets, d.sockets, ccadSettings.transferMissing, connected);
    const gone = deleted.flatMap((n) => circuitsAt(s, id, n).map((c) => c.id));
    if (gone.length) s.deleteObjects(gone);
    for (const f of TRANSFERRED) if (d.rec.value(f) !== copy.fields[f]) s.setRecordField(id, d.rec.format, f, copy.fields[f]);
    writeSockets(s, deviceOf(s, id)!, sockets);
    if (s.doc.object(id)?.classIndex !== copy.classIndex) s.setObjectClass([id], copy.classIndex);
    if (copy.attrs) s.setAttributes([id], copy.attrs);
    for (const g of copy.byClass) s.setAttributesByClass([id], g, true);
    if (ccadSettings.transferRecords)
      for (const r of copy.records) {
        if (!s.doc.records(id).some((x) => x.format === r.format)) s.attachRecord([id], r.format);
        for (const f of r.fields) s.setRecordField(id, r.format, f.name, f.value);
      }
    done.push(id);
  }
  return done;
}

interface CircuitRec extends Rec {
  readonly at: Pt;
  readonly angle: number;
}

function circuitOf(s: EditSession, id: string): CircuitRec | null {
  const rec = recOf(s, id, CIRCUIT);
  const at = s.doc.object(id)?.insertion;
  return rec && at ? { ...rec, at, angle: s.pluginAngle(id) } : null;
}

export function circuitsIn(s: EditSession, layerId?: string): CircuitRec[] {
  if (!s.doc.hasPluginFormat(CIRCUIT)) return [];
  const out: CircuitRec[] = [];
  for (const layer of s.doc.layers()) {
    if (layerId && layer.id !== layerId) continue;
    for (const o of s.doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const c = circuitOf(s, o.id);
      if (c) out.push(c);
    }
  }
  return out;
}

/** The circuits joined to a device, or to one of its sockets. */
export function circuitsAt(s: EditSession, deviceId: string, socketId?: number): CircuitRec[] {
  return circuitsIn(s).filter(
    (c) =>
      (str(c.value(CIR.sourceId)) === deviceId && (socketId === undefined || num(c.value(CIR.sourceSocket)) === socketId)) ||
      (str(c.value(CIR.destinationId)) === deviceId && (socketId === undefined || num(c.value(CIR.destinationSocket)) === socketId)),
  );
}

const pointsOf = (text: string): Pt[] => {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.flatMap((p): Pt[] => (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [{ x: Number(p[0]), y: Number(p[1]) }] : [])) : [];
  } catch {
    return [];
  }
};
const rounded = (p: Pt): [number, number] => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4];
const pointsText = (points: readonly Pt[]): string => JSON.stringify(points.map(rounded));
/** A circuit it hops: that circuit, the hop's radius, and whether it bows down. */
interface HopOf {
  readonly id: string;
  readonly radius: number;
  readonly down: boolean;
}
/** A circuit's Corners: its corners, then its breakout nodes, each ["node", x, y], and the circuits it hops, each ["hop", id, radius, 0 or 1] (pointsOf passes them by). */
const cornersText = (corners: readonly Pt[], nodes: readonly Pt[] = [], hops: readonly HopOf[] = []): string =>
  JSON.stringify([...corners.map(rounded), ...nodes.map((p) => ["node", ...rounded(p)]), ...hops.map((h) => ["hop", h.id, Math.round(h.radius * 1e4) / 1e4, h.down ? 1 : 0])]);
const hopsOf = (text: string): HopOf[] => {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.flatMap((p): HopOf[] => (Array.isArray(p) && p[0] === "hop" && typeof p[1] === "string" && Number(p[2]) > 0 ? [{ id: p[1], radius: Number(p[2]), down: p[3] === 1 }] : [])) : [];
  } catch {
    return [];
  }
};
const nodesOf = (text: string): Pt[] => {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.flatMap((p): Pt[] => (Array.isArray(p) && p[0] === "node" && Number.isFinite(p[1]) && Number.isFinite(p[2]) ? [{ x: Number(p[1]), y: Number(p[2]) }] : [])) : [];
  } catch {
    return [];
  }
};

interface Joined {
  readonly device: Device;
  readonly socket: Socket;
  readonly end: End;
  /** for an adapter's socket: the device and socket it's on */
  readonly host?: { readonly device: Device; readonly socket: Socket };
}

type Devices = Map<string, Device | null>;

function joined(s: EditSession, devices: Devices, deviceId: string, socketId: number): Joined | null {
  if (!devices.has(deviceId)) devices.set(deviceId, deviceOf(s, deviceId));
  const device = devices.get(deviceId);
  const socket = device?.sockets.find((x) => x.id === socketId);
  if (!device || !socket) return null;
  const host = device.kind === "adapter" ? hostOf(s, device, devices) : null;
  return { device, socket, end: endOf(device, socket), ...(host ? { host } : {}) };
}

/** A device's extent on the drawing, for its circuits to run round. */
function boundsOf(d: Device): Bounds {
  const outline = deviceOutline(d);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return { lo: { x: Math.min(...xs), y: Math.min(...ys) }, hi: { x: Math.max(...xs), y: Math.max(...ys) } };
}

/** What a circuit is drawn from: its two ends (null when gone), its corners and last run on the drawing. */
function planOf(s: EditSession, c: CircuitRec, devices: Devices) {
  const world = (p: Pt): Pt => {
    const q = turn(p, c.angle);
    return { x: c.at.x + q.x, y: c.at.y + q.y };
  };
  const source = joined(s, devices, str(c.value(CIR.sourceId)), num(c.value(CIR.sourceSocket)));
  const destination = joined(s, devices, str(c.value(CIR.destinationId)), num(c.value(CIR.destinationSocket)));
  const corners = pointsOf(str(c.value(CIR.corners))).map(world);
  const nodes = nodesOf(str(c.value(CIR.corners))).map(world);
  const hops = hopsOf(str(c.value(CIR.corners)));
  const last = pointsOf(str(c.value(CIR.path))).map(world);
  const pitch = pitchOn(c.layerId);
  const type: CircuitType = str(c.value(CIR.type)) === "Arrow" ? "Arrow" : "Polyline";
  let points: Pt[];
  if (source && destination) points = type === "Arrow" ? [source.end.tip, destination.end.tip] : route(source.end, destination.end, corners, pitch, [boundsOf(source.device), boundsOf(destination.device)]);
  else {
    points = last.length >= 2 ? [...last] : [c.at, c.at];
    if (source) points[0] = source.end.tip;
    if (destination) points[points.length - 1] = destination.end.tip;
  }
  return { source, destination, corners, nodes, hops, points, pitch, type };
}

/** A circuit's last run on the drawing. */
function runOf(c: CircuitRec): Pt[] {
  return pointsOf(str(c.value(CIR.path))).map((p) => {
    const q = turn(p, c.angle);
    return { x: c.at.x + q.x, y: c.at.y + q.y };
  });
}

/** The hops of a circuit's run over the circuits it hops, where their last runs cross it. */
function hopsOn(s: EditSession, layerId: string, points: readonly Pt[], hops: readonly HopOf[]) {
  return hops.flatMap((h) => {
    const other = circuitOf(s, h.id);
    return other && other.layerId === layerId ? crossings(points, runOf(other)).map((x) => ({ ...x, radius: h.radius, down: h.down })) : [];
  });
}

/** The device an end is on, and its socket's name: an adapter's socket by its device's socket and its own (IN1-R). */
const endDevice = (j: Joined): Device => j.host?.device ?? j.device;
const endSocket = (j: Joined, tags = false): string => {
  const own = tags ? j.socket.tag || j.socket.name : j.socket.name;
  return j.host ? [tags ? j.host.socket.tag || j.host.socket.name : j.host.socket.name, own].filter(Boolean).join("-") : own;
};
const describe = (j: Joined | null): string => (j ? `${endDevice(j).name} : ${endSocket(j)}` : "(not connected)");
const shortName = (j: Joined | null): string => (j ? `${endDevice(j).tag} ${endSocket(j, true)}` : "?");

/** A fingerprint of everything a circuit is drawn from, rounded so that moving its insertion back doesn't change it. */
function circuitDrawn(s: EditSession, c: CircuitRec, devices: Devices): string {
  const p = planOf(s, c, devices);
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  const pts = (list: readonly Pt[]): number[] => list.flatMap((q) => [r(q.x), r(q.y)]);
  const end = (j: Joined | null) => (j ? [pts([j.end.tip, j.end.out]), j.device.tag, j.device.name, j.socket.name, j.socket.tag, j.host ? [j.host.device.tag, j.host.device.name, j.host.socket.name, j.host.socket.tag] : null] : null);
  const hopTargets = p.hops.map((h) => {
    const other = circuitOf(s, h.id);
    return [h.id, h.radius, h.down, pts(other ? runOf(other) : [])];
  });
  return fingerprint([end(p.source), end(p.destination), pts(p.corners), pts(p.points), ...(p.nodes.length ? [pts(p.nodes)] : []), ...(hopTargets.length ? [hopTargets] : []), p.pitch, [CIR.number, CIR.cable, CIR.signal, CIR.type, CIR.display].map((f) => str(c.value(f)))]);
}

/** Draws circuit `id` again, at its source socket, in the session's open batch. */
function drawCircuit(s: EditSession, id: string, devices: Devices = new Map()): void {
  let c = circuitOf(s, id);
  if (!c) throw new Error("That isn't a ConnectCAD circuit.");
  const p = planOf(s, c, devices);
  // it stands at its source socket's end, its corners staying where they are on the drawing
  const target = p.points[0];
  if (Math.hypot(target.x - c.at.x, target.y - c.at.y) > 1e-9) {
    s.moveObjects([id], target.x - c.at.x, target.y - c.at.y);
    c = circuitOf(s, id)!;
  }
  const here = c;
  const local = (q: Pt): Pt => turn({ x: q.x - here.at.x, y: q.y - here.at.y }, -here.angle);
  const ink = inkOf();
  const signal = str(c.value(CIR.signal));
  const pen: Partial<Attributes> = { ...store.drawAttrs, penFore: ink(signalInk(signal)), fillPattern: 0, lineStyle: 2, lineWeight: CIRCUIT_MILS };
  const writing: Partial<Attributes> = { penFore: ink("#1f2328"), fillPattern: 0 };
  const filled = (hex: string): Partial<Attributes> => ({ penFore: ink("#1f2328"), fillPattern: 1, fillFore: ink(hex), fillBack: ink(hex), fillOpacity: 100 });
  const height = LABEL_MM * layerScaleOf(c.layerId);
  const number = str(c.value(CIR.number)).trim();
  const cable = str(c.value(CIR.cable)).trim();
  const points = p.points.map(local);
  drawn(s, id, c.layerId, (add) => {
    if (p.type === "Arrow") {
      for (const [j, other, source] of [
        [p.source, p.destination, true],
        [p.destination, p.source, false],
      ] as const) {
        if (!j) continue;
        const e = { tip: local(j.end.tip), out: turn(j.end.out, -here.angle) };
        const a = arrowEnd(e, p.pitch, source);
        add({ kind: "line", a: a.line[0], b: a.line[1] }, pen);
        add({ kind: "polygon", points: a.head, closed: true }, { ...pen, fillPattern: 1, fillFore: pen.penFore, fillBack: pen.penFore, fillOpacity: 100 });
        add(text(a.note.at, [number, shortName(other)].filter(Boolean).join("\r"), height, a.note.hAlign, a.note.vAlign), writing);
      }
    } else if (points.length >= 2) {
      // hopping the circuits it hops where they cross it
      const run = hopped(p.points, hopsOn(s, c.layerId, p.points, p.hops));
      add({ kind: "polyline", points: run.points.map(local), closed: false, vertices: run.vertices, radii: run.vertices.map(() => 0) } as NewShape, pen);
      // breakout nodes: a dot where it joins and leaves a bus
      for (const n of p.nodes) add({ kind: "polygon", points: Array.from({ length: 12 }, (_, i) => ({ x: local(n).x + 0.15 * p.pitch * Math.cos((i * Math.PI) / 6), y: local(n).y + 0.15 * p.pitch * Math.sin((i * Math.PI) / 6) })), closed: true }, { ...pen, lineStyle: 2, fillPattern: 1, fillFore: pen.penFore, fillBack: pen.penFore, fillOpacity: 100 });
      if (number) for (const w of numberPlaces(points, (NUMBER_DISPLAYS as readonly string[]).includes(str(c.value(CIR.display))) ? (str(c.value(CIR.display)) as NumberDisplay) : "Auto", p.pitch)) add(text(w.at, number, height, w.hAlign, w.vAlign), writing);
      if (cable) {
        const mid = along(points, pathLength(points) / 2).at;
        add(text({ x: mid.x, y: mid.y - 0.15 * p.pitch }, cable, height, 2, 1), writing);
      }
    }
    for (const [j, at] of [
      [p.source, points[0]],
      [p.destination, points[points.length - 1]],
    ] as const) {
      if (j || !at) continue;
      add({ kind: "polygon", points: warningTriangle(at, p.pitch), closed: true }, filled("#f2c94c"));
      add(text({ x: at.x, y: at.y - 0.05 * p.pitch }, "!", height, 2, 3), writing);
    }
  });
  const set = (field: string, value: RecordValue): void => {
    if (here.value(field) !== value) s.setRecordField(id, here.format, field, value);
  };
  set(CIR.corners, cornersText(p.corners.map(local), p.nodes.map(local), p.hops));
  set(CIR.path, pointsText(points));
  if (p.source) set(CIR.source, describe(p.source));
  if (p.destination) set(CIR.destination, describe(p.destination));
  set(CIR.drawn, circuitDrawn(s, circuitOf(s, id)!, devices));
  if (!hopping && p.type !== "Arrow" && settingsNow().autoHop) autoHop(s, id, devices);
}

/** an automatic hop's radius on paper, mm, as the HopOver tool's */
const AUTO_HOP_MM = 1.5;
/** set while autoHop draws the circuits it changed, which mustn't hop again */
let hopping = false;

/**
 * Automatic hopover (ConnectCAD Settings), as part of a batch: circuit `id` hops the polyline circuits
 * on its layer before it in the drawing that its run crosses, and those after it that cross it hop it;
 * hops the other way round are taken off. The circuits whose hops changed are drawn again.
 */
function autoHop(s: EditSession, id: string, devices: Devices): void {
  const layerId = circuitOf(s, id)?.layerId;
  const all = layerId ? circuitsIn(s, layerId).filter((c) => str(c.value(CIR.type)) !== "Arrow") : [];
  const at = all.findIndex((c) => c.id === id);
  if (at < 0) return;
  const me = all[at];
  const run = runOf(me);
  const radius = AUTO_HOP_MM * layerScaleOf(me.layerId);
  const changed: string[] = [];
  const setHops = (c: CircuitRec, hops: readonly HopOf[]): void => {
    const was = str(c.value(CIR.corners));
    const now = cornersText(pointsOf(was), nodesOf(was), hops);
    if (now === was) return;
    s.setRecordField(c.id, c.format, CIR.corners, now);
    changed.push(c.id);
  };
  const own = hopsOf(str(me.value(CIR.corners)));
  const mine: HopOf[] = [];
  all.forEach((o, i) => {
    if (i === at) return;
    const cross = crossings(run, runOf(o)).length > 0;
    const theirs = hopsOf(str(o.value(CIR.corners)));
    const hopsMe = theirs.some((h) => h.id === id);
    if (i < at) {
      if (cross) mine.push(own.find((h) => h.id === o.id) ?? { id: o.id, radius, down: false });
      if (hopsMe) setHops(o, theirs.filter((h) => h.id !== id));
    } else if (cross && !hopsMe) setHops(o, [...theirs, { id, radius, down: false }]);
    else if (!cross && hopsMe) setHops(o, theirs.filter((h) => h.id !== id));
  });
  // hops of circuits elsewhere (another layer, an arrow) stay
  setHops(me, [...mine, ...own.filter((h) => !all.some((o) => o.id === h.id))]);
  hopping = true;
  try {
    for (const c of changed) drawCircuit(s, c, devices);
  } finally {
    hopping = false;
  }
}

/** Automatic hopover turned on: every polyline circuit hops the ones before it it crosses, as part of a batch. */
export function hopAllCircuits(s: EditSession): void {
  const devices: Devices = new Map();
  for (const c of circuitsIn(s)) if (str(c.value(CIR.type)) !== "Arrow") autoHop(s, c.id, devices);
}

/** The circuit whose run passes nearest a point on a layer, within `within`, or null. */
export function circuitNear(s: EditSession, layerId: string, p: Pt, within: number): { id: string; points: Pt[] } | null {
  const devices: Devices = new Map();
  let best: { id: string; points: Pt[]; distance: number } | null = null;
  for (const c of circuitsIn(s, layerId)) {
    const points = planOf(s, c, devices).points;
    const near = nearestOnPath(points, p);
    if (near && near.distance <= within && (!best || near.distance < best.distance)) best = { id: c.id, points, distance: near.distance };
  }
  return best && { id: best.id, points: best.points };
}

/** A circuit re-routed: its new corners and breakout nodes, and its run through them, on the drawing. */
export interface Rerouted {
  readonly id: string;
  readonly corners: Pt[];
  readonly nodes: Pt[];
  readonly points: Pt[];
}

/**
 * ReRoute Circuits' runs: circuits `ids` along the run of circuit `referenceId`: bussed on it (`gap`
 * 0, with breakout nodes where each joins and leaves it when `nodes`), or each `gap` further from it.
 * Circuits on another layer or loose at an end are left.
 */
export function reroutes(s: EditSession, ids: readonly string[], referenceId: string, gap: number, nodes: boolean): Rerouted[] {
  const devices: Devices = new Map();
  const ref = circuitOf(s, referenceId);
  if (!ref) throw new Error("That isn't a ConnectCAD circuit.");
  const bus = planOf(s, ref, devices);
  if (bus.type === "Arrow" || !bus.source || !bus.destination) throw new Error("Circuits follow a polyline circuit joined at both ends: an arrow circuit has no run to follow.");
  const plans = ids
    .filter((id) => id !== referenceId)
    .map((id) => circuitOf(s, id))
    .filter((c): c is CircuitRec => c !== null && c.layerId === ref.layerId)
    .flatMap((c) => {
      const p = planOf(s, c, devices);
      return p.source && p.destination ? [{ id: c.id, source: p.source, destination: p.destination }] : [];
    });
  const stubEnd = (e: End): Pt => ({ x: e.tip.x + e.out.x * bus.pitch, y: e.tip.y + e.out.y * bus.pitch });
  const steps = gap > 0 ? busSteps(bus.points, plans.map((p) => stubEnd(p.source.end))) : plans.map(() => 0);
  const ends = [bus.points[0], bus.points[bus.points.length - 1]];
  return plans.map((p, i) => {
    const run = busCorners(offsetPath(bus.points, steps[i] * gap), p.source.end, p.destination.end, bus.pitch);
    // a node only where it branches off the bus, not at its ends
    const kept = nodes && gap === 0 ? run.nodes.filter((n) => ends.every((e) => Math.hypot(n.x - e.x, n.y - e.y) > 1e-6)) : [];
    return { id: p.id, corners: run.corners, nodes: kept, points: route(p.source.end, p.destination.end, run.corners, bus.pitch) };
  });
}

/** Re-routes circuits as reroutes says, as part of a batch, each a polyline circuit after; the ids re-routed. */
export function rerouteCircuits(s: EditSession, ids: readonly string[], referenceId: string, gap: number, nodes: boolean): string[] {
  const runs = reroutes(s, ids, referenceId, gap, nodes);
  if (!runs.length) throw new Error("Select the circuits to re-route (on the reference circuit's layer, joined at both ends), then click the circuit they follow.");
  for (const r of runs) {
    const c = circuitOf(s, r.id)!;
    const local = (q: Pt): Pt => turn({ x: q.x - c.at.x, y: q.y - c.at.y }, -c.angle);
    const set = (field: string, value: RecordValue): void => {
      if (c.value(field) !== value) s.setRecordField(c.id, c.format, field, value);
    };
    set(CIR.type, "Polyline");
    set(CIR.corners, cornersText(r.corners.map(local), r.nodes.map(local), hopsOf(str(c.value(CIR.corners)))));
    set(CIR.path, "[]");
    drawCircuit(s, c.id);
  }
  return runs.map((r) => r.id);
}

/** The devices and circuits whose drawing is out of date: circuits whose devices have moved or changed. */
function staleIn(s: EditSession, all: readonly Device[]): { devices: Device[]; circuits: CircuitRec[] } {
  const devices = all.filter((d) => str(d.rec.value(DEV.drawn)) !== deviceDrawn(d));
  const known: Devices = new Map();
  return { devices, circuits: circuitsIn(s).filter((c) => str(c.value(CIR.drawn)) !== circuitDrawn(s, c, known)) };
}

/** Keeps adapters on their sockets and draws again what's out of date, after each edit, in its undo step. */
function keepSchematics(s: EditSession): void {
  const all = devicesOn(s);
  const moves = adapterMoves(s, all);
  const stale = moves.length ? null : staleIn(s, all);
  if (stale && !stale.devices.length && !stale.circuits.length) return;
  s.followOn(() => {
    if (moves.length) moveAdapters(s, moves);
    const { devices, circuits } = stale ?? staleIn(s, devicesOn(s));
    for (const d of devices) drawDevice(s, d.rec.id);
    const fresh: Devices = new Map();
    for (const c of circuits) drawCircuit(s, c.id, fresh);
    // a circuit hopping one drawn again follows where it now crosses
    if (circuits.length) for (const c of circuitsIn(s)) if (hopsOf(str(c.value(CIR.corners))).length && str(c.value(CIR.drawn)) !== circuitDrawn(s, c, fresh)) drawCircuit(s, c.id, fresh);
  });
}

/**
 * HopOver on a circuit near `at`: it hops the circuit crossing it nearest there (every crossing of
 * the two), or stops hopping it when it does; an arrow circuit has no run to hop.
 */
function hopCircuit(id: string, at: Pt, radius: number, down: boolean): PluginHop {
  const nothing = (reason: string, where: Pt | null = null): PluginHop => ({ arc: null, at: where, reason, apply: () => {} });
  const s = store.session;
  const c = s ? circuitOf(s, id) : null;
  if (!s || !c) return nothing("That circuit has gone.");
  if (settingsNow().autoHop) return nothing("Automatic hopover is on in ConnectCAD Settings: circuits hop the ones drawn before them as they're drawn.");
  const p = planOf(s, c, new Map());
  if (p.type === "Arrow") return nothing("An arrow circuit has no run to hop: make it a polyline circuit first.");
  let best: { other: string; piece: number; at: Pt; d: number } | null = null;
  for (const o of circuitsIn(s, c.layerId)) {
    if (o.id === id) continue;
    for (const x of crossings(p.points, runOf(o))) {
      const d = Math.hypot(x.at.x - at.x, x.at.y - at.y);
      if (!best || d < best.d) best = { other: o.id, ...x, d };
    }
  }
  if (!best) return nothing("No circuit crosses this one: click a circuit where another crosses it.");
  const { other, piece: i } = best;
  const piece = { i, a: p.points[i], b: p.points[i + 1] };
  const had = p.hops.some((h) => h.id === other);
  const why = had ? "" : hopRefusal(piece, best.at, radius);
  if (why) return nothing("The crossing is too near the circuit's corner for a hop that size.", best.at);
  const hops = had ? p.hops.filter((h) => h.id !== other) : [...p.hops, { id: other, radius, down }];
  return {
    arc: had ? null : hopArc(hopPoints(piece, best.at, radius, down)),
    at: best.at,
    reason: "",
    apply: () =>
      void attempt("HopOver", (s) =>
        s.batch(() => {
          const now = circuitOf(s, id)!;
          const local = (q: Pt): Pt => turn({ x: q.x - now.at.x, y: q.y - now.at.y }, -now.angle);
          s.setRecordField(id, now.format, CIR.corners, cornersText(p.corners.map(local), p.nodes.map(local), hops));
          drawCircuit(s, id);
        }),
      ),
  };
}
followEdits(keepSchematics);

function circuitSpecs(signal: string, type: CircuitType): PluginFieldSpec[] {
  return [
    { name: CIR.number, type: TEXT, value: "" },
    { name: CIR.cable, type: TEXT, value: "" },
    { name: CIR.signal, type: POPUP, value: signal },
    { name: CIR.type, type: POPUP, value: type },
    { name: CIR.display, type: POPUP, value: ccadSettings.display },
    { name: CIR.length, type: TEXT, value: "" },
    { name: CIR.calculated, type: TEXT, value: "" },
    { name: CIR.source, type: TEXT, value: "" },
    { name: CIR.destination, type: TEXT, value: "" },
    { name: CIR.sourceId, type: TEXT, value: "" },
    { name: CIR.sourceSocket, type: NUMBER, value: 0 },
    { name: CIR.destinationId, type: TEXT, value: "" },
    { name: CIR.destinationSocket, type: NUMBER, value: 0 },
    { name: CIR.corners, type: TEXT, value: "[]" },
    { name: CIR.path, type: TEXT, value: "[]" },
    { name: CIR.drawn, type: TEXT, value: "" },
    { name: CIR.route, type: TEXT, value: "" },
    { name: CIR.spare, type: TEXT, value: "" },
  ];
}

export interface SocketRef {
  readonly deviceId: string;
  readonly socketId: number;
}

/** Why a socket can't take a circuit, or null. */
export function socketRefusal(s: EditSession, ref: SocketRef): string | null {
  const d = deviceOf(s, ref.deviceId);
  const socket = d?.sockets.find((x) => x.id === ref.socketId);
  if (!d || !socket) return "That socket has gone.";
  if (d.kind !== "adapter" && adapterOn(s, d.rec.id, socket.id)) return `${d.name} : ${socket.name} has an adapter: connect to the adapter's sockets.`;
  return socket.terminated ? `${d.name} : ${socket.name} is terminated, and a terminated socket can't be connected.` : null;
}

/**
 * Adds a circuit from one socket to another, through corners on the drawing, as part of a batch; its id.
 * Drawn from an input it runs the other way, its corners turned round.
 */
export function addCircuit(s: EditSession, first: SocketRef, second: SocketRef, corners: readonly Pt[], type: CircuitType): string {
  if (first.deviceId === second.deviceId && first.socketId === second.socketId) throw new Error("That's the same socket: click another to connect it to.");
  for (const ref of [first, second]) {
    const why = socketRefusal(s, ref);
    if (why) throw new Error(why);
  }
  const a = deviceOf(s, first.deviceId)!;
  const b = deviceOf(s, second.deviceId)!;
  if (a.rec.layerId !== b.rec.layerId) throw new Error("Both devices must be on the same layer.");
  const sa = a.sockets.find((x) => x.id === first.socketId)!;
  const sb = b.sockets.find((x) => x.id === second.socketId)!;
  const ends = circuitEnds(flowOf(sa), flowOf(sb));
  if (typeof ends === "string") throw new Error(ends);
  const [src, dst, srcSocket, dstSocket] = ends.reversed ? [second, first, sb, sa] : [first, second, sa, sb];
  const run = ends.reversed ? [...corners].reverse() : [...corners];
  const signal = [PASSIVE, UNKNOWN].includes(srcSocket.signal) ? dstSocket.signal : srcSocket.signal;
  const specs = circuitSpecs(signal, type);
  const at = endOf(ends.reversed ? b : a, srcSocket).tip;
  const values: Record<string, RecordValue> = {
    ...Object.fromEntries(specs.map((f) => [f.name, f.value])),
    [CIR.sourceId]: src.deviceId,
    [CIR.sourceSocket]: src.socketId,
    [CIR.destinationId]: dst.deviceId,
    [CIR.destinationSocket]: dst.socketId,
    [CIR.corners]: pointsText(run.map((p) => ({ x: p.x - at.x, y: p.y - at.y }))),
  };
  const id = s.addPluginObject(a.rec.layerId, CIRCUIT, specs, values, at, 0, store.activeClassIndex);
  drawCircuit(s, id);
  return id;
}

/** The Connect tool's last click: a circuit between two sockets; its id. */
export function connectSockets(first: SocketRef, second: SocketRef, corners: readonly Pt[], type: CircuitType): string | null {
  const r = attempt("Connect", (s) => s.batch(() => addCircuit(s, first, second, corners, type)));
  if (r) setEditGroup(null, [r.value]);
  return r?.value ?? null;
}

/**
 * Multi Connect: from the source socket clicked, its device's free sockets of the same signal, in their
 * order, joined to the target device's free sockets of that signal from the one clicked; the ids made.
 */
export function connectMany(first: SocketRef, second: SocketRef, type: CircuitType): string[] {
  const r = attempt("Connect", (s) =>
    s.batch(() => {
      const a = deviceOf(s, first.deviceId);
      const b = deviceOf(s, second.deviceId);
      if (!a || !b) throw new Error("That device has gone.");
      if (a.rec.id === b.rec.id) throw new Error("Multi Connect joins two devices: click a socket on the other device.");
      const sa = a.sockets.find((x) => x.id === first.socketId)!;
      const sb = b.sockets.find((x) => x.id === second.socketId)!;
      const ends = circuitEnds(sa.type, sb.type);
      if (typeof ends === "string") throw new Error(ends);
      const [from, to, fromSocket, toSocket] = ends.reversed ? [b, a, sb, sa] : [a, b, sa, sb];
      const used = new Set(circuitsIn(s).flatMap((c) => [`${str(c.value(CIR.sourceId))}/${num(c.value(CIR.sourceSocket))}`, `${str(c.value(CIR.destinationId))}/${num(c.value(CIR.destinationSocket))}`]));
      const order = (list: readonly Socket[], start: Socket): Socket[] => {
        const sorted = [...list].sort((x, y) => x.side.localeCompare(y.side) || x.slot - y.slot);
        return sorted.slice(Math.max(0, sorted.findIndex((x) => x.id === start.id)));
      };
      const free = (d: Device, x: Socket, start: Socket, ok: (t: SocketType) => boolean): boolean => !x.terminated && ok(x.type) && x.signal === start.signal && (x.id === start.id || !used.has(`${d.rec.id}/${x.id}`));
      const outs = order(from.sockets, fromSocket).filter((x) => free(from, x, fromSocket, (t) => t !== "IN"));
      const ins = order(to.sockets, toSocket).filter((x) => free(to, x, toSocket, (t) => t !== "OUT"));
      const n = Math.min(outs.length, ins.length);
      if (!n) throw new Error("Nothing to connect: the two devices have no free sockets of that signal.");
      return Array.from({ length: n }, (_, i) => addCircuit(s, { deviceId: from.rec.id, socketId: outs[i].id }, { deviceId: to.rec.id, socketId: ins[i].id }, [], type));
    }),
  );
  if (r) setEditGroup(null, r.value);
  return r?.value ?? [];
}

/** A socket's terminator on or off; a socket with a circuit can't take one. */
export function toggleTerminator(ref: SocketRef): void {
  attempt("Terminator", (s) =>
    s.batch(() => {
      const d = deviceOf(s, ref.deviceId);
      const socket = d?.sockets.find((x) => x.id === ref.socketId);
      if (!d || !socket) throw new Error("That socket has gone.");
      if (!socket.terminated && circuitsAt(s, d.rec.id, socket.id).length) throw new Error(`${d.name} : ${socket.name} has a circuit: a terminated socket can't be connected.`);
      writeSockets(
        s,
        d,
        d.sockets.map((x) => (x.id === socket.id ? { ...x, terminated: !x.terminated } : x)),
      );
    }),
  );
}

/** Sets circuits' numbers and draws them again, as part of a batch. */
export function setCircuitNumbers(s: EditSession, numbers: ReadonlyMap<string, string>): void {
  for (const [id, number] of numbers) {
    const c = circuitOf(s, id);
    if (!c) continue;
    s.setRecordField(id, c.format, CIR.number, number);
    drawCircuit(s, id);
  }
}

/** What numbering needs of a circuit: its number, signal, source device and socket, and where its source is. */
export function numberingOf(s: EditSession, c: CircuitRec): { id: string; number: string; signal: string; sourceDevice: string; sourceSocket: string; at: Pt } {
  const p = planOf(s, c, new Map());
  return { id: c.id, number: str(c.value(CIR.number)).trim(), signal: str(c.value(CIR.signal)), sourceDevice: p.source ? endDevice(p.source).name : "", sourceSocket: p.source ? endSocket(p.source) : "", at: p.points[0] };
}

/** What Check Drawing needs of a circuit: its number, whether each end is joined, their signals, and its middle. */
export function circuitFacts(s: EditSession, c: CircuitRec) {
  const p = planOf(s, c, new Map());
  return {
    id: c.id,
    layerId: c.layerId,
    number: str(c.value(CIR.number)).trim(),
    sourceJoined: p.source !== null,
    destinationJoined: p.destination !== null,
    sourceSignal: p.source?.socket.signal ?? "",
    destinationSignal: p.destination?.socket.signal ?? "",
    source: p.source ? describe(p.source) : str(c.value(CIR.source)) || "(not connected)",
    destination: p.destination ? describe(p.destination) : str(c.value(CIR.destination)) || "(not connected)",
    mid: along(p.points, pathLength(p.points) / 2).at,
    pitch: p.pitch,
  };
}

/** A device at a circuit's end, for Calculate Cable Lengths: its name, and whether it's a patch panel. */
export interface CableDevice {
  readonly name: string;
  readonly panel: boolean;
  /** an external, or a device with <EXT> in its name: outside the system */
  readonly external: boolean;
}

/** A circuit's ends for Calculate Cable Lengths: the device at each (for an adapter's socket, the device it's on), null where it's disconnected; and its Cable Length as typed. */
export function cableEndsOf(s: EditSession, c: CircuitRec): { source: CableDevice | null; destination: CableDevice | null; length: string } {
  const devices: Devices = new Map();
  const end = (deviceId: string, socketId: number): CableDevice | null => {
    const j = joined(s, devices, deviceId, socketId);
    const d = j ? endDevice(j) : null;
    return d ? { name: d.name.trim(), panel: isPanel(d), external: d.kind === "external" || d.name.includes("<EXT>") } : null;
  };
  return { source: end(str(c.value(CIR.sourceId)), num(c.value(CIR.sourceSocket))), destination: end(str(c.value(CIR.destinationId)), num(c.value(CIR.destinationSocket))), length: str(c.value(CIR.length)).trim() };
}

/** Writes circuits' Calculated Cable Length (by circuit), as part of a batch; the circuits' format takes the field first in a drawing made before it had it. */
export function setCalculatedLengths(s: EditSession, lengths: ReadonlyMap<string, string>): void {
  if (!lengths.size) return;
  s.growPluginFields(CIRCUIT, circuitSpecs("", "Polyline"));
  for (const [id, text] of lengths) {
    const c = circuitOf(s, id);
    if (c && str(c.value(CIR.calculated)) !== text) s.setRecordField(id, c.format, CIR.calculated, text);
  }
}

/** the layer Edit Cabling puts spare cables on, made when there's none */
export const SPARE_LAYER = "Spare Cabling";
/** a spare cable's length on the drawing, in pitches */
const SPARE_SPAN = 24;

/** A circuit's kept route (0 the shortest way, 1 the next…) and, for a spare cable joined to nothing but externals, the drop points it runs between. */
export function routeChoiceOf(s: EditSession, c: CircuitRec): { rank: number; spare: readonly [string, string] | null } {
  let spare: [string, string] | null = null;
  try {
    const raw: unknown = JSON.parse(str(c.value(CIR.spare)) || "null");
    if (Array.isArray(raw) && raw.length === 2 && raw.every((x) => typeof x === "string" && x.trim())) spare = [String(raw[0]).trim(), String(raw[1]).trim()];
  } catch {
    // not a spare
  }
  // joined to a device since, it's a cable like any other
  if (spare) {
    const ends = cableEndsOf(s, c);
    if ([ends.source, ends.destination].some((d) => d && !d.external)) spare = null;
  }
  return { rank: routeRank(str(c.value(CIR.route))), spare };
}

/** Keeps circuits' routes (by circuit: 0 the shortest), as part of a batch; the circuits' format takes the field first in a drawing made before it had it. */
export function setCircuitRoutes(s: EditSession, ranks: ReadonlyMap<string, number>): void {
  if (!ranks.size) return;
  s.growPluginFields(CIRCUIT, circuitSpecs("", "Polyline"));
  for (const [id, rank] of ranks) {
    const c = circuitOf(s, id);
    const letter = rank > 0 ? routeLetter(rank) : "";
    if (c && str(c.value(CIR.route)) !== letter) s.setRecordField(id, c.format, CIR.route, letter);
  }
}

/** Sets a circuit's Cable and draws it again, as part of a batch. */
export function setCircuitCable(s: EditSession, id: string, cable: string): void {
  const c = circuitOf(s, id);
  if (!c || str(c.value(CIR.cable)) === cable) return;
  s.setRecordField(id, c.format, CIR.cable, cable);
  drawCircuit(s, id);
}

/** Where the next spare cable goes on a layer: under the externals already there, or at the origin. */
export function nextSpareAt(s: EditSession, layerId: string): Pt {
  const at = devicesOn(s).flatMap((d) => (d.kind === "external" && d.rec.layerId === layerId ? [s.doc.object(d.rec.id)?.insertion].filter((p): p is Pt => !!p) : []));
  return at.length ? { x: Math.min(...at.map((p) => p.x)), y: Math.min(...at.map((p) => p.y)) - 2 * pitchOn(layerId) } : { x: 0, y: 0 };
}

/**
 * A spare cable (Edit Cabling's pre-cabling), as part of a batch: an external for each drop point, the
 * first's top left at `at`, joined by a circuit numbered `number` of cable `cable` that keeps route
 * `rank` between them; the circuit's id.
 */
export function addSpareCable(s: EditSession, layerId: string, at: Pt, drops: readonly [string, string], number: string, cable: string, rank: number): string {
  const signal = ccadSettings.signal;
  const connector = connectorsFor(signal)[0] ?? "";
  const end = (p: Pt, drop: string, type: SocketType, facing: Facing): { deviceId: string; socketId: number } => {
    const id = addExternal(s, layerId, p, `${drop} (${number})`, { type, signal, connector, facing, circuits: 1 });
    return { deviceId: id, socketId: deviceOf(s, id)!.sockets[0].id };
  };
  const a = end(at, drops[0], "OUT", "Left");
  const b = end({ x: at.x + SPARE_SPAN * pitchOn(layerId), y: at.y }, drops[1], "IN", "Right");
  s.growPluginFields(CIRCUIT, circuitSpecs("", "Polyline"));
  const id = addCircuit(s, a, b, [], "Polyline");
  const c = circuitOf(s, id)!;
  const values: Record<string, RecordValue> = { [CIR.number]: number, [CIR.cable]: cable, [CIR.spare]: JSON.stringify(drops), [CIR.route]: rank > 0 ? routeLetter(rank) : "" };
  for (const [field, value] of Object.entries(values)) s.setRecordField(id, c.format, field, value);
  drawCircuit(s, id);
  return id;
}

/** Takes circuits out with the externals at their ends that join nothing else, as part of a batch (a spare cable deleted in Edit Cabling). */
export function deleteSpareCables(s: EditSession, ids: readonly string[]): void {
  const gone = new Set<string>();
  for (const id of ids) {
    const c = circuitOf(s, id);
    if (!c) continue;
    gone.add(id);
    for (const d of [str(c.value(CIR.sourceId)), str(c.value(CIR.destinationId))]) if (deviceOf(s, d)?.kind === "external" && circuitsAt(s, d).every((x) => ids.includes(x.id))) gone.add(d);
  }
  if (gone.size) s.deleteObjects([...gone]);
}

/** The circuits joined at both ends on a layer, as a cable list names them (Compare Cable List and Drawing). */
export function drawnCircuits(s: EditSession, layerId: string): DrawnCircuit[] {
  const devices: Devices = new Map();
  return circuitsIn(s, layerId).flatMap((c): DrawnCircuit[] => {
    const p = planOf(s, c, devices);
    if (!p.source || !p.destination) return [];
    return [
      {
        id: c.id,
        number: str(c.value(CIR.number)).trim(),
        source: { device: endDevice(p.source).name, socket: endSocket(p.source) },
        destination: { device: endDevice(p.destination).name, socket: endSocket(p.destination) },
        mid: along(p.points, pathLength(p.points) / 2).at,
      },
    ];
  });
}

/** Every socket on a layer by the names a cable list gives it (listShapes.ts endKey; an adapter's by its host's): where a circuit joins it, and its tip. */
export function socketsByName(s: EditSession, layerId: string): Map<string, { ref: SocketRef; tip: Pt }> {
  const devices: Devices = new Map();
  const out = new Map<string, { ref: SocketRef; tip: Pt }>();
  for (const d of devicesOn(s, layerId))
    for (const k of d.sockets) {
      const j = joined(s, devices, d.rec.id, k.id);
      const key = j && endKey({ device: endDevice(j).name, socket: endSocket(j) });
      if (j && key && !out.has(key)) out.set(key, { ref: { deviceId: d.rec.id, socketId: k.id }, tip: j.end.tip });
    }
  return out;
}

/** The drawing's devices (not distribution amplifiers, panels, externals or adapters) by make and model, for Create Devices from Worksheet. */
export function hadDevices(s: EditSession): HadDevice[] {
  return devicesOn(s)
    .filter((d) => d.kind === "device" && !isDa(d) && !isPanel(d))
    .map((d) => ({ id: d.rec.id, make: str(d.rec.value(DEV.maker)), model: str(d.rec.value(DEV.description)) }));
}

/** the record Create Devices from Worksheet puts a list's other columns in */
export const IMPORTED_DEVICE_DATA = "Imported Device Data";
/** the device fields a device list's columns fill */
const LIST_FIELDS: Partial<Record<DeviceColumn, string>> = { Make: DEV.maker, Model: DEV.description, Room: DEV.room, Rack: DEV.rack, "Rack U": DEV.rackU, "Power (W)": DEV.power, "Weight (kg)": DEV.weight, "Height RU": DEV.ru };
const NUMERIC_FIELDS = new Set<string>([DEV.power, DEV.weight, DEV.ru]);
/** devices made from a list go this many to a row */
const LIST_ROW = 8;

/** what a device made from a list takes from one of its make and model the drawing has: all the eyedropper does but where that one is */
const LIKE_FIELDS = TRANSFERRED.filter((f) => f !== DEV.room && f !== DEV.rack && f !== DEV.rackU);

/** A device made like another of its make and model, as part of a batch: its sockets, box and physical data, class and look. */
function likeDevice(s: EditSession, copy: DeviceCopy, id: string): void {
  const rec = deviceOf(s, id)!.rec;
  for (const f of LIKE_FIELDS) if (rec.value(f) !== copy.fields[f]) s.setRecordField(id, rec.format, f, copy.fields[f]);
  writeSockets(s, deviceOf(s, id)!, copy.sockets);
  if (s.doc.object(id)?.classIndex !== copy.classIndex) s.setObjectClass([id], copy.classIndex);
  if (copy.attrs) s.setAttributes([id], copy.attrs);
  for (const g of copy.byClass) s.setAttributesByClass([id], g, true);
}

/** A record field's value from a list's text, as its kind takes it. */
const valueAs = (kind: string | undefined, text: string): RecordValue => (kind === "integer" || kind === "number" ? Number(text.replace(/,/g, "")) || 0 : kind === "boolean" ? /^(true|yes|y|1)$/i.test(text) : text);

/**
 * Create Devices from Worksheet, as part of a batch: the devices planned made in rows from `origin`
 * (their top-left corners) and filled in, and those the drawing had brought up to date; the list's
 * other columns put in the Imported Device Data record, made or given the fields it lacks.
 */
export function devicesFromList(s: EditSession, layerId: string, plan: DevicePlan, origin: Pt): { made: string[]; updated: string[] } {
  const pitch = pitchOn(layerId);
  const rows = [...plan.make.map((m) => m.from), ...plan.update.map((u) => u.from)];
  const columns = [...new Set(rows.flatMap((d) => Object.keys(d.record)))];
  let format: number | null = null;
  if (columns.length) {
    const had = s.doc.recordFormats().find((f) => f.name === IMPORTED_DEVICE_DATA);
    if (!had) format = s.createRecordFormat(IMPORTED_DEVICE_DATA, columns.map((name) => ({ name, kind: "text", value: "" })));
    else {
      format = had.format;
      const now = s.doc.recordFormatFields(format) ?? [];
      const missing = columns.filter((n) => !now.some((f) => f.name === n));
      if (missing.length) s.editRecordFormat(format, [...now.map((f) => ({ name: f.name, kind: f.kind, value: f.value, from: f.name })), ...missing.map((name) => ({ name, kind: "text" as const, value: "" }))]);
    }
  }
  const kinds = new Map((format === null ? [] : (s.doc.recordFormatFields(format) ?? [])).map((f) => [f.name, f.kind]));
  const fill = (id: string, d: ListedDevice): void => {
    const rec = recOf(s, id, DEVICE);
    if (!rec) return;
    for (const [column, field] of Object.entries(LIST_FIELDS)) {
      const text = d.fields[column as DeviceColumn];
      if (text === undefined) continue;
      const value = NUMERIC_FIELDS.has(field) ? Number(text.replace(/,/g, "")) || 0 : text;
      if (rec.value(field) !== value) s.setRecordField(id, rec.format, field, value);
    }
    // the BTU its power gives off, as Object Info reckons it
    if (d.fields["Power (W)"] !== undefined && rec.value(DEV.autoBtu) !== false) s.setRecordField(id, rec.format, DEV.btu, Math.round((Number(d.fields["Power (W)"].replace(/,/g, "")) || 0) * BTU_PER_WATT * 100) / 100);
    if (format !== null && Object.keys(d.record).length) {
      if (!s.doc.records(id).some((r) => r.format === format)) s.attachRecord([id], format);
      for (const [name, text] of Object.entries(d.record)) s.setRecordField(id, format, name, valueAs(kinds.get(name), text));
    }
    drawDevice(s, id);
  };
  // the first device the drawing has of a make and model is the pattern for more of them
  const patterns = new Map<string, string>();
  for (const d of hadDevices(s)) if (!patterns.has(kindKey(d.make, d.model))) patterns.set(kindKey(d.make, d.model), d.id);
  const made: string[] = [];
  let x = origin.x;
  let y = origin.y;
  let tallest = 0;
  plan.make.forEach((m, i) => {
    if (i && i % LIST_ROW === 0) {
      x = origin.x;
      y -= tallest + 4 * pitch;
      tallest = 0;
    }
    const id = addDevice(s, layerId, { x, y }, null);
    renameDevice(s, id, m.name, m.tag);
    const like = patterns.get(kindKey(m.from.make, m.from.model));
    if (like) likeDevice(s, pickUpDevice(s, like), id);
    fill(id, m.from);
    const box = deviceOf(s, id)!.box;
    x += box.width + 4 * pitch;
    tallest = Math.max(tallest, box.height);
    made.push(id);
  });
  for (const u of plan.update) fill(u.id, u.from);
  return { made, updated: plan.update.map((u) => u.id) };
}

/** a circuit made from a list whose ends are further apart than this, in pitches, is an arrow circuit */
const LIST_ARROW_PITCHES = 40;

/**
 * Make Connections from List: a circuit between each pair of sockets asked, as part of a batch, a
 * polyline when its ends are near enough and an arrow when not, numbered and cabled as asked; the
 * ids made, and why any couldn't be (`label` names it).
 */
export function connectFromList(s: EditSession, asked: readonly { from: SocketRef; to: SocketRef; number: string; cable: string; label: string }[]): { made: string[]; failed: string[] } {
  const made: string[] = [];
  const failed: string[] = [];
  for (const a of asked) {
    const [x, y] = [deviceOf(s, a.from.deviceId), deviceOf(s, a.to.deviceId)];
    const [kx, ky] = [x?.sockets.find((k) => k.id === a.from.socketId), y?.sockets.find((k) => k.id === a.to.socketId)];
    if (!x || !y || !kx || !ky) {
      failed.push(`${a.label}: a socket has gone`);
      continue;
    }
    const [tx, ty] = [endOf(x, kx).tip, endOf(y, ky).tip];
    const far = Math.hypot(tx.x - ty.x, tx.y - ty.y) > LIST_ARROW_PITCHES * x.pitch;
    try {
      const id = addCircuit(s, a.from, a.to, [], far ? "Arrow" : "Polyline");
      const c = circuitOf(s, id)!;
      if (a.number) s.setRecordField(id, c.format, CIR.number, a.number);
      if (a.cable) s.setRecordField(id, c.format, CIR.cable, a.cable);
      if (a.number || a.cable) drawCircuit(s, id);
      made.push(id);
    } catch (e) {
      failed.push(`${a.label}: ${errorMessage(e)}`);
    }
  }
  return { made, failed };
}

/** What the report commands list of the circuits and devices on a layer, or on every layer. */
export function reportFacts(s: EditSession, layerId?: string): { circuits: ReportCircuit[]; devices: ReportDevice[] } {
  const layerName = new Map(s.doc.layers().map((l) => [l.id, l.name]));
  const devices: Devices = new Map();
  /** "device:socket" to the circuits joined there */
  const joins = new Map<string, { number: string; to: string }[]>();
  const join = (deviceId: string, socketId: number, number: string, to: string): void => {
    const k = `${deviceId}:${socketId}`;
    joins.set(k, [...(joins.get(k) ?? []), { number, to }]);
  };
  const all = circuitsIn(s);
  const circuits: ReportCircuit[] = [];
  for (const c of all) {
    const p = planOf(s, c, devices);
    const number = str(c.value(CIR.number)).trim();
    const source = p.source ? describe(p.source) : str(c.value(CIR.source)) || "(not connected)";
    const destination = p.destination ? describe(p.destination) : str(c.value(CIR.destination)) || "(not connected)";
    // a circuit at an adapter is listed at the socket it's on
    const at = (j: Joined): [string, number] => (j.host ? [j.host.device.rec.id, j.host.socket.id] : [j.device.rec.id, j.socket.id]);
    if (p.source) join(...at(p.source), number, destination);
    if (p.destination) join(...at(p.destination), number, source);
    if (layerId && c.layerId !== layerId) continue;
    circuits.push({
      id: c.id,
      layer: layerName.get(c.layerId) ?? "",
      number,
      signal: str(c.value(CIR.signal)),
      cable: str(c.value(CIR.cable)),
      type: str(c.value(CIR.type)),
      length: str(c.value(CIR.length)),
      calculated: str(c.value(CIR.calculated)),
      sourceDevice: p.source ? endDevice(p.source).name : "(not connected)",
      sourceSocket: p.source ? endSocket(p.source) : "",
      destinationDevice: p.destination ? endDevice(p.destination).name : "(not connected)",
      destinationSocket: p.destination ? endSocket(p.destination) : "",
    });
  }
  const list = devicesOn(s, layerId)
    .filter((d) => d.kind !== "adapter")
    .map(
    (d): ReportDevice => ({
      external: d.kind === "external",
      layer: layerName.get(d.rec.layerId) ?? "",
      name: d.name,
      tag: d.tag,
      description: str(d.rec.value(DEV.description)),
      maker: str(d.rec.value(DEV.maker)),
      power: num(d.rec.value(DEV.power)),
      btu: num(d.rec.value(DEV.btu)),
      weight: num(d.rec.value(DEV.weight)),
      ru: num(d.rec.value(DEV.ru)),
      room: str(d.rec.value(DEV.room)),
      rack: str(d.rec.value(DEV.rack)),
      sockets: d.sockets.map((k) => ({ name: k.name, type: k.type, signal: k.signal, connector: k.connector, circuits: joins.get(`${d.rec.id}:${k.id}`) ?? [] })),
    }),
  );
  return { circuits, devices: list };
}

/** A device's box on the drawing. */
export const deviceOutline = (d: Device): Pt[] =>
  [
    { x: 0, y: 0 },
    { x: d.box.width, y: 0 },
    { x: d.box.width, y: -d.box.height },
    { x: 0, y: -d.box.height },
  ].map((p) => toWorld(d, p));

/** The sockets with a circuit, as device id / socket id. */
function usedSockets(s: EditSession): Set<string> {
  return new Set(circuitsIn(s).flatMap((c) => [`${str(c.value(CIR.sourceId))}/${num(c.value(CIR.sourceSocket))}`, `${str(c.value(CIR.destinationId))}/${num(c.value(CIR.destinationSocket))}`]));
}

/**
 * Connect Selected for devices side by side: each free output on a device's right side joined to the free
 * input of its signal directly opposite on the nearest selected device to its right; the ids made.
 */
export function connectOpposite(s: EditSession, ids: readonly string[], type: CircuitType): string[] {
  const devices = ids.map((id) => deviceOf(s, id)).filter((d): d is Device => d !== null);
  const used = usedSockets(s);
  const free = (d: Device, k: Socket): boolean => !k.terminated && !used.has(`${d.rec.id}/${k.id}`);
  const made: string[] = [];
  for (const a of devices) {
    for (const out of a.sockets) {
      if (!canSource(out.type) || !free(a, out)) continue;
      const ea = endOf(a, out);
      if (ea.out.x < 0.5) continue;
      let best: { d: Device; k: Socket; gap: number } | null = null;
      for (const b of devices) {
        if (b === a || b.rec.layerId !== a.rec.layerId) continue;
        for (const k of b.sockets) {
          if (!canReceive(k.type) || !free(b, k) || !signalsMatch(out.signal, k.signal)) continue;
          const eb = endOf(b, k);
          const gap = eb.tip.x - ea.tip.x;
          if (eb.out.x > -0.5 || gap <= 0 || Math.abs(eb.tip.y - ea.tip.y) > a.pitch / 4) continue;
          if (!best || gap < best.gap) best = { d: b, k, gap };
        }
      }
      if (!best) continue;
      made.push(addCircuit(s, { deviceId: a.rec.id, socketId: out.id }, { deviceId: best.d.rec.id, socketId: best.k.id }, [], type));
      used.add(`${a.rec.id}/${out.id}`);
      used.add(`${best.d.rec.id}/${best.k.id}`);
    }
  }
  return made;
}

/**
 * Connect Selected toward one device: each selected device's free sockets joined, in their order, to the
 * target's free ones of the same signal: its outputs to the target's inputs when the target is to its
 * right, the target's outputs to its inputs when it's to the left; the ids made.
 */
export function connectToDevice(s: EditSession, ids: readonly string[], targetId: string, type: CircuitType): string[] {
  const target = deviceOf(s, targetId);
  if (!target) throw new Error("That isn't a ConnectCAD device.");
  const used = usedSockets(s);
  const made: string[] = [];
  const middle = (d: Device): number => toWorld(d, { x: d.box.width / 2, y: 0 }).x;
  const ordered = (d: Device): Socket[] => [...d.sockets].sort((x, y) => x.side.localeCompare(y.side) || x.slot - y.slot);
  for (const id of ids) {
    const d = deviceOf(s, id);
    if (!d || d.rec.id === target.rec.id || d.rec.layerId !== target.rec.layerId) continue;
    const [from, to] = middle(target) >= middle(d) ? [d, target] : [target, d];
    for (const out of ordered(from)) {
      if (!canSource(out.type) || out.terminated || used.has(`${from.rec.id}/${out.id}`)) continue;
      const into = ordered(to).find((k) => canReceive(k.type) && !k.terminated && !used.has(`${to.rec.id}/${k.id}`) && signalsMatch(out.signal, k.signal));
      if (!into) continue;
      made.push(addCircuit(s, { deviceId: from.rec.id, socketId: out.id }, { deviceId: to.rec.id, socketId: into.id }, [], type));
      used.add(`${from.rec.id}/${out.id}`);
      used.add(`${to.rec.id}/${into.id}`);
    }
  }
  return made;
}

/** Renames a device and its display tag, as part of a batch. */
export function renameDevice(s: EditSession, id: string, name: string, tag: string): void {
  const rec = recOf(s, id, DEVICE) ?? recOf(s, id, DA) ?? recOf(s, id, PANEL) ?? recOf(s, id, EXTERNAL);
  if (!rec) return;
  s.setRecordField(id, rec.format, DEV.name, name);
  s.setRecordField(id, rec.format, DEV.tag, tag);
  drawDevice(s, id);
}

function settleDevice(s: EditSession, id: string, before: { name: string; tag: string }): void {
  const rec = recOf(s, id, DEVICE) ?? recOf(s, id, DA) ?? recOf(s, id, PANEL) ?? recOf(s, id, EXTERNAL);
  if (!rec) return;
  const set = (field: string, value: RecordValue): void => {
    if (rec.value(field) !== value) s.setRecordField(id, rec.format, field, value);
  };
  // the tag follows the name when it was the name
  const name = str(rec.value(DEV.name));
  if (name !== before.name && (before.tag === before.name || !before.tag)) set(DEV.tag, name);
  // an external has no power to reckon
  const auto = rec.value(DEV.autoBtu);
  if (auto !== undefined && auto !== false) set(DEV.btu, Math.round(num(rec.value(DEV.power)) * BTU_PER_WATT * 100) / 100);
}

function editDevice(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Device", (s) =>
    s.batch(() => {
      const rec = recOf(s, id, DEVICE) ?? recOf(s, id, DA) ?? recOf(s, id, PANEL);
      if (!rec) throw new Error("That isn't a ConnectCAD device.");
      const before = { name: str(rec.value(DEV.name)), tag: str(rec.value(DEV.tag)) };
      const outputsBefore = num(rec.value(DAF.outputs));
      const d0 = deviceOf(s, id);
      const placeBefore = d0 && isPanel(d0) ? placeOf(d0) : null;
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      settleDevice(s, id, before);
      if (DAF.outputs in values || DAF.loop in values) refitDa(s, id, outputsBefore);
      if (placeBefore && (PNL.group in values || PNL.panel in values || PNL.port in values || PNL.code in values)) refitPanel(s, id, placeBefore);
      drawDevice(s, id);
    }),
  );
}

const EXTERNAL_FIELDS: readonly [string, ExternalField][] = [
  [EXT.facing, "facing"],
  [EXT.type, "type"],
  [EXT.signal, "signal"],
  [EXT.connector, "connector"],
];

/** An Object Info edit of an external: what changed given to all its sockets, and as many as its circuits. */
function editExternal(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit External", (s) =>
    s.batch(() => {
      const rec = recOf(s, id, EXTERNAL);
      if (!rec) throw new Error("That isn't a ConnectCAD external.");
      const before = { name: str(rec.value(DEV.name)), tag: str(rec.value(DEV.tag)) };
      const next: Record<string, RecordValue> = { ...values };
      // a new signal brings its first connector, unless the one it has is one of its own
      if (EXT.signal in values && !(EXT.connector in values)) {
        const offered = connectorsFor(str(values[EXT.signal]));
        if (!offered.includes(str(rec.value(EXT.connector)))) next[EXT.connector] = offered[0] ?? PASSIVE;
      }
      for (const [field, value] of Object.entries(next)) s.setRecordField(id, rec.format, field, value);
      settleDevice(s, id, before);
      const d = deviceOf(s, id);
      if (!d) return;
      const v = (field: string): string => str(d.rec.value(field));
      const type = SOCKET_TYPES.find((t) => t === v(EXT.type)) ?? "OUT";
      const fields: ExternalFields = { type, signal: v(EXT.signal), connector: v(EXT.connector), facing: facingOf(d), circuits: num(d.rec.value(EXT.circuits)) };
      writeSockets(s, d, externalSockets(d.sockets, fields, new Set(EXTERNAL_FIELDS.filter(([f]) => f in next).map(([, k]) => k))));
    }),
  );
}

function editCircuit(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Circuit", (s) =>
    s.batch(() => {
      const c = circuitOf(s, id);
      if (!c) throw new Error("That isn't a ConnectCAD circuit.");
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, c.format, field, value);
      drawCircuit(s, id);
    }),
  );
}

/** Flip: an IO-to-IO circuit's source becomes its destination. */
function flipCircuit(id: string): void {
  attempt("Flip Circuit", (s) =>
    s.batch(() => {
      const c = circuitOf(s, id);
      if (!c) throw new Error("That isn't a ConnectCAD circuit.");
      const p = planOf(s, c, new Map());
      if (!p.source || !p.destination || p.source.socket.type !== "IO" || p.destination.socket.type !== "IO") throw new Error("Only a circuit between two IO sockets can be flipped.");
      const set = (field: string, value: RecordValue): void => s.setRecordField(id, c.format, field, value);
      set(CIR.sourceId, p.destination.device.rec.id);
      set(CIR.sourceSocket, p.destination.socket.id);
      set(CIR.destinationId, p.source.device.rec.id);
      set(CIR.destinationSocket, p.source.socket.id);
      const local = (q: Pt): Pt => turn({ x: q.x - c.at.x, y: q.y - c.at.y }, -c.angle);
      set(CIR.corners, cornersText([...p.corners].reverse().map(local), p.nodes.map(local), p.hops));
      set(CIR.path, "[]");
      drawCircuit(s, id);
    }),
  );
}

const param = (id: number, field: string, level = 0): PluginWidget => ({ id, kind: "param", field, label: "", level });
const EDIT_SOCKETS = 30;
const EDIT_ARRAY = 31;
const CODE_ROW = 26;
const BTU_ROW = 13;
const FLIP = 40;

const DEVICE_LAYOUT: readonly PluginWidget[] = [
  param(1, DEV.name),
  param(2, DEV.tag),
  param(3, DEV.description),
  param(4, DEV.maker),
  { id: EDIT_SOCKETS, kind: "button", label: "Edit Sockets…", level: 0 },
  { id: 50, kind: "divider", label: "Box", level: 0 },
  param(5, DEV.boxWidth),
  param(6, DEV.boxHeight),
  { id: 51, kind: "divider", label: "Physical", level: 0 },
  param(7, DEV.height),
  param(8, DEV.width),
  param(9, DEV.depth),
  param(10, DEV.power),
  param(11, DEV.autoBtu),
  param(BTU_ROW, DEV.btu, 1),
  param(14, DEV.weight),
  param(15, DEV.ru),
  param(16, DEV.rackWidth),
  { id: 52, kind: "divider", label: "Location", level: 0 },
  param(17, DEV.room),
  param(18, DEV.rack),
  param(19, DEV.rackU),
];

const DA_LAYOUT: readonly PluginWidget[] = [
  param(1, DEV.name),
  param(20, DAF.type),
  param(2, DEV.tag),
  param(3, DEV.description),
  param(4, DEV.maker),
  param(21, DAF.outputs),
  param(22, DAF.loop),
  ...DEVICE_LAYOUT.slice(DEVICE_LAYOUT.findIndex((w) => w.id === EDIT_SOCKETS)),
];

const PANEL_LAYOUT: readonly PluginWidget[] = [
  param(1, DEV.name),
  param(20, DAF.type),
  param(2, DEV.tag),
  param(3, DEV.description),
  param(4, DEV.maker),
  param(23, PNL.group),
  param(24, PNL.panel),
  param(25, PNL.port),
  param(CODE_ROW, PNL.code),
  { id: EDIT_ARRAY, kind: "button", label: "Edit Device Array…", level: 0 },
  ...DEVICE_LAYOUT.slice(DEVICE_LAYOUT.findIndex((w) => w.id === EDIT_SOCKETS)),
];

const EXTERNAL_LAYOUT: readonly PluginWidget[] = [
  param(1, DEV.name),
  param(2, EXT.facing),
  param(3, EXT.type),
  param(4, EXT.signal),
  param(5, EXT.connector),
  param(6, EXT.circuits),
  param(7, DEV.boxWidth),
  { id: EDIT_SOCKETS, kind: "button", label: "Edit Sockets…", level: 0 },
];

const ADAPTER_LAYOUT: readonly PluginWidget[] = [param(1, ADP.make), param(2, ADP.connector), param(3, ADP.names)];

const CIRCUIT_LAYOUT: readonly PluginWidget[] = [
  { id: FLIP, kind: "button", label: "Flip", level: 0 },
  param(1, CIR.number),
  param(2, CIR.cable),
  param(3, CIR.signal),
  param(4, CIR.type),
  param(5, CIR.display),
  param(6, CIR.length),
  param(9, CIR.calculated),
  param(7, CIR.source),
  param(8, CIR.destination),
];

const choices = (list: readonly string[]) => list.map((value) => ({ value, label: value }));
/** a ConnectCAD Settings list as a field's choices, none first; none at all leaves the field to type in */
const listChoices = (list: readonly string[]) => (list.length ? [{ value: "", label: "None" }, ...choices(list)] : undefined);

/** Set by index.ts: the Edit Sockets dialog, kept apart so this file doesn't build windows. */
export const socketEditor: { open: (deviceId: string, socketId?: number) => void } = { open: () => {} };
/** Set by index.ts: the Edit Device Array dialog, likewise. */
export const deviceArrayEditor: { open: (deviceId: string) => void } = { open: () => {} };

const deviceDriver: PluginDriver = {
  name: DEVICE,
  shape: "rect",
  builtIn: true,
  label: () => undefined,
  readOnly: () => false,
  choices: (field) => (field === DEV.rackWidth ? choices(RACK_WIDTHS) : undefined),
  place(layerId, at, _angle, size) {
    placeDevice(layerId, at, size ? { x: at.x + size.width, y: at.y - size.height } : null);
  },
  edit: (id, values) => editDevice(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawDevice(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => DEVICE_LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    const rec = s ? (recOf(s, id, DEVICE) ?? recOf(s, id, DA) ?? recOf(s, id, PANEL)) : null;
    if (!s || !rec) return;
    // the make, model, physical and location data equipment keeps on a device of its name
    const kept = plainDevice(s, id) && equipmentFor.linked(s, str(rec.value(DEV.name)).trim()) ? [3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19] : [];
    apply(new Map([[BTU_ROW, { enabled: !kept.length && rec.value(DEV.autoBtu) === false, visible: true }], ...kept.map((row): [number, { enabled: boolean; visible: boolean }] => [row, { enabled: false, visible: true }])]));
  },
  press(id, widget) {
    if (widget === EDIT_SOCKETS) socketEditor.open(id);
  },
  open: (id) => socketEditor.open(id),
};

const daDriver: PluginDriver = {
  ...deviceDriver,
  name: DA,
  shape: "point",
  readOnly: (field) => field === DAF.type,
  place: (layerId, at) => placeDAs(layerId, at, null),
  layout: () => DA_LAYOUT,
};

const panelDriver: PluginDriver = {
  ...deviceDriver,
  name: PANEL,
  shape: "point",
  readOnly: (field) => field === DAF.type,
  place: (layerId, at) => placePanels("jack", layerId, at, null),
  layout: () => PANEL_LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    const d = s ? deviceOf(s, id) : null;
    const own = !!d && isConnectorPanel(d);
    let states = new Map<number, { enabled: boolean; visible: boolean }>();
    deviceDriver.widgetStates?.(id, (m) => (states = new Map(m)));
    for (const row of [CODE_ROW, EDIT_ARRAY]) states.set(row, { enabled: own, visible: own });
    apply(states);
  },
  press(id, widget) {
    if (widget === EDIT_ARRAY) deviceArrayEditor.open(id);
    else deviceDriver.press?.(id, widget);
  },
};

const externalDriver: PluginDriver = {
  name: EXTERNAL,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: () => false,
  choices: (field) => (field === EXT.facing ? choices(FACINGS) : field === EXT.type ? choices(SOCKET_TYPES) : field === EXT.signal ? choices(signalNames()) : undefined),
  place: (layerId, at) => placeExternals(layerId, at, null),
  edit: (id, values) => editExternal(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawDevice(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => EXTERNAL_LAYOUT,
  widgetStates: () => {},
  press(id, widget) {
    if (widget === EDIT_SOCKETS) socketEditor.open(id);
  },
  open: (id) => socketEditor.open(id),
};

const adapterDriver: PluginDriver = {
  name: ADAPTER,
  shape: "point",
  builtIn: true,
  label: (field) => (field === ADP.names ? "Sockets" : undefined),
  readOnly: () => false,
  choices: (field) => (field === ADP.connector ? choices(allConnectors()) : undefined),
  place: () => toast("Use the Adapter tool: click a device's socket.", "info"),
  edit: (id, values) => editAdapter(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawDevice(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => ADAPTER_LAYOUT,
  widgetStates: () => {},
  press: () => {},
};

const circuitDriver: PluginDriver = {
  name: CIRCUIT,
  shape: "linear",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === CIR.source || field === CIR.destination || field === CIR.calculated,
  choices: (field) =>
    field === CIR.signal
      ? choices(signalNames())
      : field === CIR.type
        ? choices(CIRCUIT_TYPES)
        : field === CIR.display
          ? choices(NUMBER_DISPLAYS)
          : field === CIR.cable
            ? listChoices(settingsNow().cables)
            : field === CIR.length
              ? listChoices(settingsNow().lengths)
              : undefined,
  place: () => toast("Use the Connect tool: click one socket, then the other.", "info"),
  edit: (id, values) => editCircuit(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawCircuit(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => CIRCUIT_LAYOUT,
  widgetStates(id, apply) {
    const s = store.session;
    const c = s ? circuitOf(s, id) : null;
    if (!s || !c) return;
    const p = planOf(s, c, new Map());
    apply(new Map([[FLIP, { enabled: true, visible: p.source?.socket.type === "IO" && p.destination?.socket.type === "IO" }]]));
  },
  press(id, widget) {
    if (widget === FLIP) flipCircuit(id);
  },
  path(id) {
    const s = store.session;
    const c = s ? circuitOf(s, id) : null;
    if (!s || !c || str(c.value(CIR.type)) === "Arrow") return null;
    return { points: planOf(s, c, new Map()).points, closed: false };
  },
  hopOver: (id, at, radius, down) => hopCircuit(id, at, radius, down),
  setPath(s, id, corners) {
    const c = circuitOf(s, id);
    if (!c) return;
    // the ends stay on their sockets: what's between becomes the circuit's corners (its breakout nodes dropped, its hops kept)
    s.setRecordField(id, c.format, CIR.corners, cornersText(corners.slice(1, -1).map((q) => turn({ x: q.x - c.at.x, y: q.y - c.at.y }, -c.angle)), [], hopsOf(str(c.value(CIR.corners)))));
    drawCircuit(s, id);
  },
};

registerPluginDrivers(() => [deviceDriver, daDriver, panelDriver, externalDriver, adapterDriver, circuitDriver]);

