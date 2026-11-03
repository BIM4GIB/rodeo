// ConnectCAD Schematics' tools: Device (click the box's corners, or click once for a box of the usual
// size; its eyedropper picks a device up and applies it to others), External (click to place one, or in Linear Array two clicks for a numbered row), Distribution
// Amplifier, Term Panel, Jackfield, Linked Jackfield and Connector Panel (the same, a click on a circuit splitting it),
// Adapter (click a device's socket to put an adapter on it), Socket (click a device's box where the
// socket goes) and Socket Loop (two sockets side by side looped),
// each also in a Linear Array down a side, Terminator (click a socket to terminate it, or to take
// its terminator off), Connect (click a socket, any corners, then the socket to connect it to;
// Multi Connect joins every free socket of the signal clicked) and Legend (a click, then a click for
// its rotation) and ReRoute Circuits (the circuits selected follow the one clicked, bussed on it, or
// a drag's distance apart). What they make is in schematic.ts and legend.ts.

import type { Pt } from "../../../core/index.ts";
import { ACCENT } from "../../../app/renderer.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../../../app/tools.ts";
import { connectorsFor, loopPlan, rowSlots, SIDES, signalNames, signalNamed, slotEnd, slotFor, slotOn, type Side, type Socket, type SocketType } from "./ccadShapes.ts";
import { DA_TYPES, MAX_OUTPUTS, type DaType } from "./daShapes.ts";
import { groupOf, panelPlaceOf, panelTypes, type PanelKind } from "./panelShapes.ts";
import { arrayPlaces, externalOutline, FACINGS, type Facing } from "./externalShapes.ts";
import { legendSettings, legendSize, placeLegend } from "./legend.ts";
import { adapterRefusalAt, addSocket, addSocketRow, allConnectors, ccadSettings, circuitNear, circuitsIn, rerouteCircuits, reroutes, connectMany, connectSockets, daBox, daSplitAt, deviceAt, nextPanelLabel, panelBox, panelSplitAt, panelTypeNow, placeAdapter, placePanels, PANEL_TOOLS, endOf, externalBox, loopSockets, pitchOn, placeDAs, placeDevice, placeExternals, socketEditor, socketRefusal, toggleTerminator, toLocal, toWorld, type CircuitType, type Device, type SocketRef } from "./schematic.ts";
import { connectorPanelsIn, pickUpDevice, plainDevice, transferDevice, transferRefusal, type DeviceCopy } from "./schematic.ts";
import { MISSING_SOCKETS, type MissingSockets } from "./transferShapes.ts";
import { attempt, setEditGroup, setSelection } from "../../../app/commands.ts";
import { formatLength } from "../../../app/units.ts";
import { nearestOnPath } from "./daShapes.ts";

/** a press dragged further than this (CSS px) is a drag */
const DRAG_PX = 4;

const outline = (g: Painter, d: Device): void => {
  const { width: w, height: h } = d.box;
  strokeScreen(
    g,
    [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: -h }, { x: 0, y: -h }].map((p) => toWorld(d, p)),
    true,
  );
};

const ring = (g: Painter, at: Pt, px: number): void => {
  const q = g.toScreen(at);
  g.ctx.beginPath();
  g.ctx.arc(q.x, q.y, px, 0, Math.PI * 2);
  g.ctx.stroke();
};

const under = (p: Pt): ReturnType<typeof deviceAt> => {
  const s = store.session;
  const layerId = store.activeLayerId;
  return s && layerId ? deviceAt(s, layerId, p) : null;
};

const DEVICE_MODES = [
  { id: "draw", label: "Device", key: "1" },
  { id: "pickup", label: "Pick Up", key: "2" },
  { id: "apply", label: "Apply", key: "3" },
] as const;
type DeviceMode = (typeof DEVICE_MODES)[number]["id"];

/** the device the eyedropper picked up, kept while the tool changes */
let picked: DeviceCopy | null = null;

export class DeviceTool extends BaseTool {
  readonly id = "ccdevice";
  readonly cursor = "crosshair";
  private mode: DeviceMode = "draw";
  private from: Pt | null = null;
  private fromScreen: Pt | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Mode", options: DEVICE_MODES, active: this.mode }];
  }

  setMode(id: string): void {
    const mode = DEVICE_MODES.find((m) => m.id === id)?.id;
    if (!mode) return;
    this.mode = mode;
    this.from = null;
  }

  async preferences(): Promise<void> {
    if (this.mode !== "draw") return this.eyedropperPreferences();
    const v = await toolPrefs(
      "Device Preferences",
      [
        { kind: "text", key: "name", label: "Device Name", value: ccadSettings.deviceName },
        { kind: "text", key: "description", label: "Description", value: ccadSettings.description },
        { kind: "text", key: "maker", label: "Manufacturer", value: ccadSettings.maker },
      ],
      "Click the box's corners, or click once for a box of the usual size. A name already in the drawing takes the next number (CAM1, CAM2…). Then add sockets with the Socket tool.",
    );
    if (!v) return;
    ccadSettings.deviceName = v.choice("name").trim() || "DEV1";
    ccadSettings.description = v.choice("description");
    ccadSettings.maker = v.choice("maker");
  }

  private async eyedropperPreferences(): Promise<void> {
    const k = ccadSettings;
    const v = await toolPrefs(
      "Device Eyedropper Transfer Preferences",
      [
        { kind: "heading", key: "only", label: "Only apply to devices with the same" },
        { kind: "check", key: "maker", label: "Manufacturer", value: k.transferSameMaker },
        { kind: "check", key: "model", label: "Description (model)", value: k.transferSameModel },
        { kind: "choice", key: "missing", label: "Missing Socket Action", value: k.transferMissing, wide: true, options: MISSING_SOCKETS.map((m) => ({ value: m.id, label: m.label })) },
        { kind: "check", key: "records", label: "Transfer attached records", value: k.transferRecords },
      ],
      "Pick Up a device, then Apply it to others: sockets of the same name take its sockets' settings and places, its other sockets are added, and the device takes its manufacturer, description, box, physical and location data, class and attributes, but not its name or tag. Missing Socket Action says what happens to a device's sockets the one picked up hasn't.",
    );
    if (!v) return;
    k.transferSameMaker = v.flag("maker");
    k.transferSameModel = v.flag("model");
    k.transferMissing = v.choice("missing") as MissingSockets;
    k.transferRecords = v.flag("records");
  }

  hint(): string {
    if (this.mode === "pickup") return "Click the device to pick up";
    if (this.mode === "apply") return picked ? `Click a device, or one of those selected, to give it ${picked.name}'s properties` : "Pick up a device first (Pick Up mode)";
    return this.from ? "Click the box's opposite corner · Esc cancels" : "Click the device's first corner, or click twice in one place for the usual size";
  }

  /** what a click in Apply would change: the device under `p`, or those selected when it's one of them */
  private targets(p: Pt): string[] {
    const s = store.session;
    const hit = under(p);
    if (!s || !hit) return [];
    const id = hit.device.rec.id;
    return store.selection.has(id) ? [...store.selection] : [id];
  }

  private eyedropper(p: PointerInfo): void {
    const s = store.session;
    const hit = under(p.pos);
    if (!s || !hit) return;
    if (this.mode === "pickup") {
      try {
        picked = pickUpDevice(s, hit.device.rec.id);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "info");
        return;
      }
      // on to Apply, as Vectorworks goes
      this.mode = "apply";
      store.emit("modes");
      return;
    }
    const copy = picked;
    if (!copy) {
      toast("Pick up a device first: Pick Up mode, then click it.", "info");
      return;
    }
    const ids = this.targets(p.pos);
    const why = ids.length === 1 ? transferRefusal(s, copy, ids[0]) : "";
    if (why) {
      toast(why, "info");
      return;
    }
    attempt("Transfer Device Properties", (s) =>
      s.batch(() => {
        if (!transferDevice(s, copy, ids).length) throw new Error("None of the devices selected take the properties picked up (Preferences).");
      }),
    );
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    if (this.mode !== "draw") return this.eyedropper(p);
    if (!this.from) {
      this.from = p.pos;
      this.fromScreen = p.screen;
      return;
    }
    this.finish(p);
  }

  up(p: PointerInfo): void {
    if (this.mode === "draw" && this.from && this.fromScreen && Math.hypot(p.screen.x - this.fromScreen.x, p.screen.y - this.fromScreen.y) > DRAG_PX) this.finish(p);
  }

  private finish(p: PointerInfo): void {
    const layerId = store.activeLayerId;
    const from = this.from;
    this.from = null;
    this.fromScreen = null;
    if (!layerId || !from) return;
    const same = Math.hypot(p.pos.x - from.x, p.pos.y - from.y) < 1e-6;
    placeDevice(layerId, from, same ? null : p.pos);
  }

  cancel(): void {
    this.from = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.from) {
      this.from = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  overlay(g: Painter): void {
    const s = store.session;
    if (this.mode !== "draw") {
      // the devices a click would pick up or change
      if (!s || !this.pointer) return;
      const copy = picked;
      const ids = this.mode === "pickup" ? (under(this.pointer) ? [under(this.pointer)!.device.rec.id] : []) : this.targets(this.pointer);
      const eligible = ids.filter((id) => (this.mode === "pickup" ? plainDevice(s, id) !== null : copy !== null && !transferRefusal(s, copy, id)));
      g.ctx.save();
      g.ctx.strokeStyle = ACCENT;
      g.ctx.lineWidth = 2;
      for (const id of eligible) {
        const d = plainDevice(s, id);
        if (d) outline(g, d);
      }
      g.ctx.restore();
      return;
    }
    if (!this.from || !this.pointer) return;
    const a = this.from;
    const b = this.pointer;
    withPreview(g, () =>
      strokeScreen(
        g,
        [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }],
        true,
      ),
    );
  }
}

const PLACEMENT_MODES = [
  { id: "single", label: "Single Click" },
  { id: "array", label: "Linear Array" },
];
const FACING_MODES = FACINGS.map((f) => ({ id: f, label: `${f} External` }));

export class ExternalTool extends BaseTool {
  readonly id = "ccexternal";
  readonly cursor = "crosshair";
  private array = false;
  private from: Pt | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "Placement", options: PLACEMENT_MODES, active: this.array ? "array" : "single" },
      { label: "Type", options: TYPE_MODES, active: ccadSettings.externalType },
      { label: "Facing", options: FACING_MODES, active: ccadSettings.facing },
    ];
  }

  setMode(id: string): void {
    if (PLACEMENT_MODES.some((m) => m.id === id)) {
      this.array = id === "array";
      this.from = null;
    } else if (TYPE_MODES.some((m) => m.id === id)) ccadSettings.externalType = id as SocketType;
    else if (FACINGS.includes(id as Facing)) ccadSettings.facing = id as Facing;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "External Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: ccadSettings.externalName },
        { kind: "choice", key: "signal", label: "Signal", value: ccadSettings.signal, options: signalNames().map((value) => ({ value, label: value })) },
        { kind: "choice", key: "connector", label: "Connector", value: ccadSettings.connector, options: [...new Set([...connectorsFor(ccadSettings.signal), ...connectorsFor("")])].map((value) => ({ value, label: value })) },
      ],
      "An external is the system's link to equipment outside it, such as feeds from a host broadcaster. Click to place one; a name already in the drawing takes the next number. In Linear Array, click where the row starts and again where it ends: the externals go a box apart and are numbered on from the name. Give one more circuits in the Object Info palette.",
    );
    if (!v) return;
    ccadSettings.externalName = v.choice("name").trim() || "EXT1";
    ccadSettings.signal = v.choice("signal");
    const offered = connectorsFor(ccadSettings.signal);
    ccadSettings.connector = offered.includes(v.choice("connector")) ? v.choice("connector") : offered[0];
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.from) {
      this.from = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** where the row ends: Shift keeps it level or plumb */
  private end(p: Pt, shift: boolean): Pt {
    const a = this.from;
    if (!a || !shift) return p;
    return Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
  }

  private places(to: Pt): Pt[] {
    const layerId = store.activeLayerId;
    if (!this.from || !layerId) return [];
    return arrayPlaces(this.from, to, externalBox(layerId), pitchOn(layerId));
  }

  hint(): string {
    if (!this.array) return `Click to place an external (${ccadSettings.externalType}, ${ccadSettings.signal})`;
    if (!this.from) return "Click where the row of externals starts";
    const n = this.pointer ? this.places(this.pointer).length : 1;
    return `Click where the row ends · Count: ${n} · Shift keeps it level or plumb · Esc cancels`;
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  move(p: PointerInfo): void {
    this.pointer = this.end(p.pos, p.shift);
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.array) {
      placeExternals(layerId, p.pos, null);
      return;
    }
    if (!this.from) {
      this.from = p.pos;
      return;
    }
    const from = this.from;
    this.from = null;
    placeExternals(layerId, from, this.end(p.pos, p.shift));
  }

  cancel(): void {
    this.from = null;
  }

  overlay(g: Painter): void {
    const layerId = store.activeLayerId;
    if (!this.pointer || !layerId || (this.array && !this.from)) return;
    const box = externalBox(layerId);
    const pitch = pitchOn(layerId);
    const corners = this.array ? this.places(this.pointer) : [this.pointer];
    withPreview(g, () => {
      for (const c of corners) strokeScreen(g, externalOutline(box, ccadSettings.facing, pitch).map((q) => ({ x: c.x + q.x, y: c.y + q.y })), true);
      if (this.from && this.pointer) strokeScreen(g, [this.from, this.pointer], false);
    });
  }
}

const DA_MODES = DA_TYPES.map((t, i) => ({ id: t, label: `${t} Distribution Amplifier`, key: String(i + 1) }));
const signalChoices = (category: DaType) => signalNames().filter((n) => signalNamed(n)?.category === category).map((value) => ({ value, label: value }));

export class DistributionAmpTool extends BaseTool {
  readonly id = "ccda";
  readonly cursor = "crosshair";
  private array = false;
  private from: Pt | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "Placement", options: PLACEMENT_MODES, active: this.array ? "array" : "single" },
      { label: "Type", options: DA_MODES, active: ccadSettings.daType },
    ];
  }

  setMode(id: string): void {
    if (PLACEMENT_MODES.some((m) => m.id === id)) {
      this.array = id === "array";
      this.from = null;
    } else if (DA_TYPES.includes(id as DaType)) ccadSettings.daType = id as DaType;
  }

  async preferences(): Promise<void> {
    const k = ccadSettings;
    const v = await toolPrefs(
      "Distribution Amplifier Preferences",
      [
        { kind: "text", key: "video", label: "Video DA Name", value: k.videoDaName },
        { kind: "choice", key: "videoSignal", label: "Video Signal", value: k.videoSignal, options: signalChoices("Video") },
        { kind: "text", key: "audio", label: "Audio DA Name", value: k.audioDaName },
        { kind: "choice", key: "audioSignal", label: "Audio Signal", value: k.audioSignal, options: signalChoices("Audio") },
        { kind: "number", key: "outputs", label: "Number of Outputs", value: k.daOutputs, min: 1, max: MAX_OUTPUTS, integer: true },
        { kind: "check", key: "loop", label: "Loop-thru", value: k.daLoop },
        { kind: "text", key: "maker", label: "Manufacturer", value: k.daMaker },
      ],
      "A distribution amplifier sends one input to several outputs of the same signal. Click to place one, or click on a circuit to put it in the circuit: the circuit runs to its input and on from its first output. A name already in the drawing takes the next number. In Linear Array, click where the row starts and again where it ends.",
    );
    if (!v) return;
    k.videoDaName = v.choice("video").trim() || "VDA1";
    k.audioDaName = v.choice("audio").trim() || "ADA1";
    k.videoSignal = v.choice("videoSignal");
    k.audioSignal = v.choice("audioSignal");
    k.daOutputs = v.num("outputs");
    k.daLoop = v.flag("loop");
    k.daMaker = v.choice("maker");
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.from) {
      this.from = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** where the row ends: Shift keeps it level or plumb */
  private end(p: Pt, shift: boolean): Pt {
    const a = this.from;
    if (!a || !shift) return p;
    return Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
  }

  private places(to: Pt): Pt[] {
    const layerId = store.activeLayerId;
    if (!this.from || !layerId) return [];
    return arrayPlaces(this.from, to, daBox(layerId), pitchOn(layerId));
  }

  private split(): ReturnType<typeof daSplitAt> {
    const s = store.session;
    const layerId = store.activeLayerId;
    return !this.array && s && layerId && this.pointer ? daSplitAt(s, layerId, this.pointer) : null;
  }

  hint(): string {
    const what = `1×${ccadSettings.daOutputs} ${ccadSettings.daType.toLowerCase()} DA`;
    if (!this.array) return this.split() ? `Click to put a ${what} in this circuit` : `Click to place a ${what}, or click on a circuit to split it`;
    if (!this.from) return "Click where the row of DAs starts";
    const n = this.pointer ? this.places(this.pointer).length : 1;
    return `Click where the row ends · Count: ${n} · Shift keeps it level or plumb · Esc cancels`;
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  move(p: PointerInfo): void {
    this.pointer = this.end(p.pos, p.shift);
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.array) {
      placeDAs(layerId, p.pos, null);
      return;
    }
    if (!this.from) {
      this.from = p.pos;
      return;
    }
    const from = this.from;
    this.from = null;
    placeDAs(layerId, from, this.end(p.pos, p.shift));
  }

  cancel(): void {
    this.from = null;
  }

  overlay(g: Painter): void {
    const layerId = store.activeLayerId;
    if (!this.pointer || !layerId || (this.array && !this.from)) return;
    const { width: w, height: h } = daBox(layerId);
    const split = this.split();
    const corners = this.array ? this.places(this.pointer) : [split?.corner ?? this.pointer];
    withPreview(g, () => {
      for (const c of corners) strokeScreen(g, [c, { x: c.x + w, y: c.y }, { x: c.x + w, y: c.y - h }, { x: c.x, y: c.y - h }], true);
      if (this.from && this.pointer) strokeScreen(g, [this.from, this.pointer], false);
    });
    if (split) {
      g.ctx.save();
      g.ctx.strokeStyle = ACCENT;
      g.ctx.lineWidth = 2;
      ring(g, split.at, 6);
      g.ctx.restore();
    }
  }
}

const PANEL_NOTES: Readonly<Record<PanelKind, string>> = {
  term: "A term panel joins rack wiring to the long cables between rooms: each device is one port of a panel, its socket taking a circuit from either side.",
  jack: "A jackfield's jack pairs let a patch cord join any output to any input: each device is one jack pair, the output it's fed on its left and the input it feeds on its right.",
  linked: "A linked jack pair is joined through when no patch cord is in it: each device is one pair, the output it's fed on its left and the input it feeds on its right.",
  connector: "A connector panel is a custom panel at a facilities box, its connectors wired through to the system: each device is one connector, an input or an output, taking the circuit on its left and sending it on from its right.",
};

/** The Term Panel, Jackfield and Linked Jackfield tools: a panel device at a click (in a circuit there), or a row of them, their ports counting on. */
abstract class PanelTool extends BaseTool {
  readonly cursor = "crosshair";
  protected abstract readonly kind: PanelKind;
  private array = false;
  private from: Pt | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "Placement", options: PLACEMENT_MODES, active: this.array ? "array" : "single" },
      { label: "Type", options: panelTypes(this.kind).map((t, i) => ({ id: t.device, label: t.device, key: String(i + 1) })), active: panelTypeNow(this.kind).device },
    ];
  }

  setMode(id: string): void {
    if (PLACEMENT_MODES.some((m) => m.id === id)) {
      this.array = id === "array";
      this.from = null;
    } else if (panelTypes(this.kind).some((t) => t.device === id)) ccadSettings.panelType[this.kind] = id;
  }

  async preferences(): Promise<void> {
    const k = ccadSettings;
    const t = panelTypeNow(this.kind);
    const next = k.panelNext[this.kind];
    const v = await toolPrefs(
      `${PANEL_TOOLS[this.kind]} Preferences`,
      [
        { kind: "text", key: "prefix", label: "Prefix", value: k.panelPrefix[this.kind] },
        { kind: "text", key: "group", label: "Group", value: next.group },
        { kind: "number", key: "panel", label: "Panel", value: next.panel, min: 1, max: 999, integer: true },
        { kind: "number", key: "port", label: "Port", value: next.port, min: 1, max: 999, integer: true },
        { kind: "choice", key: "connector", label: `Connector (${t.device})`, value: k.panelConnector[this.kind] || t.connector, options: connectorsFor(t.signal).map((value) => ({ value, label: value })) },
        { kind: "text", key: "maker", label: "Manufacturer", value: k.panelMaker },
      ],
      `${PANEL_NOTES[this.kind]} Devices of one panel share its name: the prefix, group and panel (JA1). Ports count on as you place them, to the panel's size and on to the next panel; with one of these devices selected, the next follows it. Click on a circuit to put the device in it.`,
    );
    if (!v) return;
    k.panelPrefix[this.kind] = v.choice("prefix").trim();
    k.panelNext[this.kind] = { group: groupOf(v.choice("group")), panel: v.num("panel"), port: v.num("port") };
    k.panelConnector[this.kind] = v.choice("connector") === t.connector ? "" : v.choice("connector");
    k.panelMaker = v.choice("maker");
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.from) {
      this.from = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** where the row ends: Shift keeps it level or plumb */
  private end(p: Pt, shift: boolean): Pt {
    const a = this.from;
    if (!a || !shift) return p;
    return Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
  }

  private places(to: Pt): Pt[] {
    const layerId = store.activeLayerId;
    if (!this.from || !layerId) return [];
    return arrayPlaces(this.from, to, panelBox(layerId), pitchOn(layerId));
  }

  private split(): ReturnType<typeof panelSplitAt> {
    const s = store.session;
    const layerId = store.activeLayerId;
    return !this.array && s && layerId && this.pointer ? panelSplitAt(s, layerId, this.pointer) : null;
  }

  hint(): string {
    const what = `${panelTypeNow(this.kind).device.toLowerCase()}, ${nextPanelLabel(this.kind)}`;
    if (!this.array) return this.split() ? `Click to put a ${what}, in this circuit` : `Click to place a ${what}, or click on a circuit to split it`;
    if (!this.from) return `Click where the row starts (${what})`;
    const n = this.pointer ? this.places(this.pointer).length : 1;
    return `Click where the row ends · Count: ${n} · Shift keeps it level or plumb · Esc cancels`;
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  move(p: PointerInfo): void {
    this.pointer = this.end(p.pos, p.shift);
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.array) {
      placePanels(this.kind, layerId, p.pos, null);
      return;
    }
    if (!this.from) {
      this.from = p.pos;
      return;
    }
    const from = this.from;
    this.from = null;
    placePanels(this.kind, layerId, from, this.end(p.pos, p.shift));
  }

  cancel(): void {
    this.from = null;
  }

  overlay(g: Painter): void {
    const layerId = store.activeLayerId;
    if (!this.pointer || !layerId || (this.array && !this.from)) return;
    const { width: w, height: h } = panelBox(layerId);
    const split = this.split();
    const corners = this.array ? this.places(this.pointer) : [split?.corner ?? this.pointer];
    withPreview(g, () => {
      for (const c of corners) strokeScreen(g, [c, { x: c.x + w, y: c.y }, { x: c.x + w, y: c.y - h }, { x: c.x, y: c.y - h }], true);
      if (this.from && this.pointer) strokeScreen(g, [this.from, this.pointer], false);
    });
    if (split) {
      g.ctx.save();
      g.ctx.strokeStyle = ACCENT;
      g.ctx.lineWidth = 2;
      ring(g, split.at, 6);
      g.ctx.restore();
    }
  }
}

export class TermPanelTool extends PanelTool {
  readonly id = "cctermpanel";
  protected readonly kind = "term";
}

export class JackfieldTool extends PanelTool {
  readonly id = "ccjack";
  protected readonly kind = "jack";
}

export class LinkedJackfieldTool extends PanelTool {
  readonly id = "cclinkedjack";
  protected readonly kind = "linked";
}

const NEW_PANEL = "New…";

/** The Connector Panel tool: a Term Panel's placing, with a panel picked by name and ports of a code and number. */
export class ConnectorPanelTool extends PanelTool {
  readonly id = "ccconnectorpanel";
  protected readonly kind = "connector";

  async preferences(): Promise<void> {
    const k = ccadSettings;
    const s = store.session;
    const next = k.panelNext.connector;
    const panel = `${next.group}${next.panel}`;
    const panels = [...new Set([...(s ? connectorPanelsIn(s) : []), panel])];
    const v = await toolPrefs(
      "Connector Panel Preferences",
      [
        { kind: "text", key: "prefix", label: "Custom Panel Prefix", value: k.panelPrefix.connector },
        { kind: "choice", key: "panel", label: "Panel", value: panel, options: [...panels, NEW_PANEL].map((value) => ({ value, label: value })) },
        { kind: "text", key: "new", label: "New Panel Name", value: "" },
        { kind: "text", key: "code", label: "Port Code", value: k.connectorCode },
        { kind: "number", key: "number", label: "Number (0 for ---)", value: next.port, min: 0, max: 999, integer: true },
        { kind: "choice", key: "connector", label: "Connector", value: k.panelConnector.connector || "XLR3", options: allConnectors().map((value) => ({ value, label: value })) },
        { kind: "text", key: "maker", label: "Manufacturer", value: k.panelMaker },
      ],
      `${PANEL_NOTES.connector} A device is named by the prefix and its panel (CTP_BOX1), and its port by the code and number (MIC01); choose New… and type a name (BOX2) for another panel. The number counts on as you place them; with one connector panel selected, the next follows it. Click on a circuit to put the device in it; Edit Device Array in the Object Info palette changes several at once.`,
    );
    if (!v) return;
    k.panelPrefix.connector = v.choice("prefix").trim();
    const name = v.choice("panel") === NEW_PANEL ? v.choice("new").trim() || panel : v.choice("panel");
    k.panelNext.connector = { ...panelPlaceOf(name), port: v.num("number") };
    k.connectorCode = v.choice("code").trim();
    k.panelConnector.connector = v.choice("connector");
    k.panelMaker = v.choice("maker");
  }
}

/** The Adapter tool: a click on a device's left or right socket puts an adapter on it. */
export class AdapterTool extends BaseTool {
  readonly id = "ccadapter";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;

  async preferences(): Promise<void> {
    const k = ccadSettings;
    const v = await toolPrefs(
      "Adapter Preferences",
      [
        { kind: "text", key: "make", label: "Make/Model", value: k.adapterMake },
        { kind: "choice", key: "connector", label: "Connector", value: k.adapterConnector, options: allConnectors().map((value) => ({ value, label: value })) },
        { kind: "text", key: "names", label: "Sockets (names, a comma between)", value: k.adapterNames },
      ],
      "An adapter changes a socket's connector, or splits it in several (a breakout's L, R): it sits on the socket, and circuits join its own sockets. It follows its device; drag it off and it shows a warning until you drop it on another socket. Leave Sockets empty for one socket of no name.",
    );
    if (!v) return;
    k.adapterMake = v.choice("make").trim() || "Adapter";
    k.adapterConnector = v.choice("connector");
    k.adapterNames = v.choice("names");
  }

  /** the socket under the pointer and why it can't take an adapter, or null */
  private target(): { device: Device; socket: Socket; why: string | null } | null {
    const s = store.session;
    const here = this.pointer ? under(this.pointer) : null;
    if (!s || !here?.socket) return null;
    return { device: here.device, socket: here.socket, why: adapterRefusalAt(s, { deviceId: here.device.rec.id, socketId: here.socket.id }) };
  }

  hint(): string {
    const t = this.target();
    if (!t) return "Click a socket on a device's left or right side to put an adapter on it";
    return t.why ?? `Click to put a ${ccadSettings.adapterMake} (${ccadSettings.adapterConnector}) on ${t.device.name} : ${t.socket.name}`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const here = under(p.pos);
    if (!here?.socket) {
      store.setHint("Click on a socket");
      return;
    }
    placeAdapter({ deviceId: here.device.rec.id, socketId: here.socket.id });
  }

  overlay(g: Painter): void {
    const t = this.target();
    if (!t || t.why) return;
    g.ctx.save();
    g.ctx.strokeStyle = ACCENT;
    g.ctx.lineWidth = 2;
    ring(g, endOf(t.device, t.socket).tip, 7);
    g.ctx.restore();
  }
}

const TYPE_MODES = [
  { id: "IN", label: "Input", key: "1" },
  { id: "OUT", label: "Output", key: "2" },
  { id: "IO", label: "Bi-Directional", key: "3" },
];
/** socket loops are inputs or IO */
const LOOP_TYPE_MODES = [
  { id: "IN", label: "Input", key: "1" },
  { id: "IO", label: "Bi-Directional", key: "2" },
];
const SIDE_MODES = [...SIDES.map((s) => ({ id: s.side, label: s.label })), { id: "auto", label: "Automatic Type" }];

/** Where a Linear Array of sockets starts: a device, a side and a row on it. */
interface RowStart {
  readonly device: Device;
  readonly side: Side;
  readonly slot: number;
}

/** The Socket and Socket Loop tools: a click on a device's box, or in Linear Array two clicks for a row of them. */
abstract class SocketPlacing extends BaseTool {
  readonly cursor = "crosshair";
  protected pointer: Pt | null = null;
  private array = false;
  private start: RowStart | null = null;
  /** the array's sockets are looped in pairs */
  protected abstract readonly looped: boolean;
  protected abstract readonly typeModes: typeof TYPE_MODES;
  protected abstract type(): SocketType;
  protected abstract setType(t: SocketType): void;
  /** a click in Single Click */
  protected abstract placeAt(here: { device: Device; socket: Socket | null }, at: Pt): void;
  protected abstract singleHint(here: ReturnType<typeof under>): string;
  protected abstract singleOverlay(g: Painter, d: Device, socket: Socket | null, at: Pt): void;

  modes(): readonly ToolModes[] {
    return [
      { label: "Placement", options: PLACEMENT_MODES, active: this.array ? "array" : "single" },
      { label: "Type", options: this.typeModes, active: this.type() },
      { label: "Side", options: SIDE_MODES, active: ccadSettings.side },
    ];
  }

  setMode(id: string): void {
    if (PLACEMENT_MODES.some((m) => m.id === id)) {
      this.array = id === "array";
      this.start = null;
    } else if (this.typeModes.some((m) => m.id === id)) this.setType(id as SocketType);
    else if (SIDE_MODES.some((m) => m.id === id)) ccadSettings.side = id as Side | "auto";
  }

  protected asked() {
    const k = ccadSettings;
    return { name: k.socketName, type: this.type(), side: k.side, signal: k.signal, connector: k.connector };
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.start) {
      this.start = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** the rows an array to `to` fills */
  private rows(to: Pt): number[][] {
    const st = this.start;
    if (!st) return [];
    return rowSlots(st.device.sockets, st.side, st.slot, slotOn(st.side, toLocal(st.device, to), st.device.pitch), this.looped);
  }

  hint(): string {
    if (!this.array) return this.singleHint(this.pointer ? under(this.pointer) : null);
    if (!this.start) return "Click a device's box where the row starts";
    const n = this.pointer ? this.rows(this.pointer).length : 0;
    return `Click where the row ends on ${this.start.device.name} · Count: ${n} · Esc cancels`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    if (this.array && this.start) {
      const st = this.start;
      const rows = this.rows(p.pos);
      this.start = null;
      const r = attempt(this.looped ? "Socket Loop" : "Socket", (s) => s.batch(() => addSocketRow(s, st.device.rec.id, st.side, rows, this.asked())));
      if (r) setEditGroup(null, [st.device.rec.id]);
      return;
    }
    const here = under(p.pos);
    if (!here) {
      store.setHint("That isn't a device: click on one's box (draw one with the Device tool)");
      return;
    }
    if (!this.array) {
      this.placeAt(here, p.pos);
      return;
    }
    const d = here.device;
    const place = here.socket ? { side: here.socket.side, slot: here.socket.slot } : slotFor(d.box, toLocal(d, p.pos), d.pitch, ccadSettings.side);
    if (place) this.start = { device: d, side: place.side, slot: place.slot };
  }

  cancel(): void {
    this.start = null;
  }

  overlay(g: Painter): void {
    if (!this.pointer) return;
    g.ctx.save();
    g.ctx.strokeStyle = ACCENT;
    g.ctx.lineWidth = 2;
    const st = this.start;
    if (this.array && st) {
      outline(g, st.device);
      for (const row of this.rows(this.pointer)) for (const slot of row) ring(g, toWorld(st.device, slotEnd(st.device.box, st.side, slot, st.device.pitch).tip), 5);
    } else {
      const here = under(this.pointer);
      if (here) {
        outline(g, here.device);
        this.singleOverlay(g, here.device, here.socket, this.pointer);
      }
    }
    g.ctx.restore();
  }
}

async function socketPreferences(title: string, note: string): Promise<void> {
  const v = await toolPrefs(
    title,
    [
      { kind: "text", key: "name", label: "Name", value: ccadSettings.socketName },
      { kind: "choice", key: "signal", label: "Signal", value: ccadSettings.signal, options: signalNames().map((value) => ({ value, label: value })) },
      { kind: "choice", key: "connector", label: "Connector", value: ccadSettings.connector, options: [...new Set([...connectorsFor(ccadSettings.signal), ...connectorsFor("")])].map((value) => ({ value, label: value })) },
    ],
    note,
  );
  if (!v) return;
  ccadSettings.socketName = v.choice("name").trim();
  ccadSettings.signal = v.choice("signal");
  const offered = connectorsFor(ccadSettings.signal);
  ccadSettings.connector = offered.includes(v.choice("connector")) ? v.choice("connector") : offered[0];
}

export class SocketTool extends SocketPlacing {
  readonly id = "ccsocket";
  protected readonly looped = false;
  protected readonly typeModes = TYPE_MODES;

  protected type(): SocketType {
    return ccadSettings.socketType;
  }

  protected setType(t: SocketType): void {
    ccadSettings.socketType = t;
  }

  async preferences(): Promise<void> {
    await socketPreferences(
      "Socket Preferences",
      "Click a device's box where the socket goes: inputs normally go down the left side and outputs down the right. In Linear Array, click where the row starts and where it ends: each free row gets a socket. The name takes the next free number on its device (IN1, IN2…); with no name the socket's type names it. A connector that isn't one of the signal's own is changed to the signal's first.",
    );
  }

  protected singleHint(here: ReturnType<typeof under>): string {
    if (here?.socket) return `${here.device.name} : ${here.socket.name} · click to edit it`;
    return here ? `Click to add a ${ccadSettings.socketType} socket (${ccadSettings.signal}) to ${here.device.name}` : "Click a device's box where the socket goes";
  }

  protected placeAt(here: { device: Device; socket: Socket | null }, at: Pt): void {
    if (here.socket) {
      socketEditor.open(here.device.rec.id, here.socket.id);
      return;
    }
    const r = attempt("Socket", (s) =>
      s.batch(() => {
        const made = addSocket(s, here.device.rec.id, at, this.asked());
        if (typeof made === "string") throw new Error(made);
        return made;
      }),
    );
    if (r) setEditGroup(null, [here.device.rec.id]);
  }

  protected singleOverlay(g: Painter, d: Device, socket: Socket | null, at: Pt): void {
    if (socket) ring(g, endOf(d, socket).tip, 7);
    else {
      const place = slotFor(d.box, toLocal(d, at), d.pitch, ccadSettings.side);
      if (place) ring(g, toWorld(d, slotEnd(d.box, place.side, place.slot, d.pitch).tip), 5);
    }
  }
}

export class SocketLoopTool extends SocketPlacing {
  readonly id = "ccsocketloop";
  protected readonly looped = true;
  protected readonly typeModes = LOOP_TYPE_MODES;

  protected type(): SocketType {
    return ccadSettings.loopType;
  }

  protected setType(t: SocketType): void {
    ccadSettings.loopType = t;
  }

  async preferences(): Promise<void> {
    await socketPreferences(
      "Socket Loop Preferences",
      "A loop passes the signal coming into one socket on to the socket beside it, which can then feed the next device (a loop-thru). Click a socket to loop it with the one below (or above), adding any socket missing; click a looped socket to take its loop off. In Linear Array, each two free rows from where the row starts to where it ends get a looped pair.",
    );
  }

  protected singleHint(here: ReturnType<typeof under>): string {
    if (here?.socket?.loop !== undefined) return `Click to take ${here.device.name} : ${here.socket.name}'s loop off`;
    return here ? `Click to loop two ${ccadSettings.loopType} sockets on ${here.device.name}` : "Click a device's box where the loop goes";
  }

  protected placeAt(here: { device: Device; socket: Socket | null }, at: Pt): void {
    const r = attempt("Socket Loop", (s) => s.batch(() => loopSockets(s, here.device.rec.id, at, this.asked())));
    if (r) {
      store.setHint(r.value);
      setEditGroup(null, [here.device.rec.id]);
    }
  }

  protected singleOverlay(g: Painter, d: Device, socket: Socket | null, at: Pt): void {
    const place = socket ? { side: socket.side, slot: socket.slot } : slotFor(d.box, toLocal(d, at), d.pitch, ccadSettings.side);
    if (!place) return;
    const plan = loopPlan(d.sockets, place.side, place.slot);
    if (typeof plan === "string") return;
    const slots = plan.kind === "unloop" ? plan.ids.map((id) => d.sockets.find((k) => k.id === id)?.slot ?? 0) : [...plan.join.map((id) => d.sockets.find((k) => k.id === id)?.slot ?? 0), ...plan.add];
    for (const slot of slots) ring(g, toWorld(d, slotEnd(d.box, place.side, slot, d.pitch).tip), 6);
  }
}

export class TerminatorTool extends BaseTool {
  readonly id = "ccterminator";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;

  hint(): string {
    const here = this.pointer ? under(this.pointer) : null;
    if (here?.socket) return here.socket.terminated ? `Click to take ${here.socket.name}'s terminator off` : `Click to terminate ${here.device.name} : ${here.socket.name}`;
    return "Click a socket to terminate it, or a terminated one to take its terminator off";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const here = under(p.pos);
    if (!here?.socket) {
      store.setHint("Click on a socket");
      return;
    }
    toggleTerminator({ deviceId: here.device.rec.id, socketId: here.socket.id });
  }

  overlay(g: Painter): void {
    const here = this.pointer ? under(this.pointer) : null;
    if (!here?.socket) return;
    g.ctx.save();
    g.ctx.strokeStyle = ACCENT;
    g.ctx.lineWidth = 2;
    ring(g, endOf(here.device, here.socket).tip, 7);
    g.ctx.restore();
  }
}

const CONNECT_MODES = [
  { id: "single", label: "Single Connect" },
  { id: "multi", label: "Multi Connect" },
];
const CIRCUIT_MODES = [
  { id: "Polyline", label: "Polyline", key: "1" },
  { id: "Arrow", label: "Arrow", key: "2" },
];

interface Picked extends SocketRef {
  readonly device: Device;
  readonly socket: Socket;
}

export class ConnectTool extends BaseTool {
  readonly id = "ccconnect";
  readonly cursor = "crosshair";
  private multi = false;
  private first: Picked | null = null;
  private corners: Pt[] = [];
  private pointer: Pt | null = null;
  private shift = false;

  modes(): readonly ToolModes[] {
    return [
      { label: "Connect", options: CONNECT_MODES, active: this.multi ? "multi" : "single" },
      { label: "Circuit", options: CIRCUIT_MODES, active: ccadSettings.circuitType },
    ];
  }

  setMode(id: string): void {
    if (id === "single" || id === "multi") this.multi = id === "multi";
    else if (CIRCUIT_MODES.some((m) => m.id === id)) ccadSettings.circuitType = id as CircuitType;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (!this.first) return false;
    if (e.key === "Escape") {
      this.reset();
      return true;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      this.corners.pop();
      return true;
    }
    return false;
  }

  hint(): string {
    if (!this.first) return this.multi ? "Click a socket on the first device: its free sockets of that signal are joined" : "Click the socket to connect from";
    const what = `${this.first.device.name} : ${this.first.socket.name}`;
    if (this.multi) return `Click the first socket to join on the other device, from ${what} · Esc cancels`;
    return ccadSettings.circuitType === "Arrow" ? `Click the socket to connect ${what} to · Esc cancels` : `Click corners, then the socket to connect ${what} to · Shift squares a corner · Backspace takes one off · Esc cancels`;
  }

  snapFrom(): Pt | null {
    if (!this.first) return null;
    return this.corners[this.corners.length - 1] ?? endOf(this.first.device, this.first.socket).tip;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    this.shift = p.shift;
  }

  /** Shift keeps a corner level with or plumb over the one before. */
  private square(at: Pt, shift: boolean): Pt {
    const last = this.snapFrom();
    if (!shift || !last) return at;
    return Math.abs(at.x - last.x) >= Math.abs(at.y - last.y) ? { x: at.x, y: last.y } : { x: last.x, y: at.y };
  }

  private reset(): void {
    this.first = null;
    this.corners = [];
  }

  cancel(): void {
    this.reset();
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const s = store.session;
    if (!s) return;
    const here = under(p.raw) ?? under(p.pos);
    const picked: Picked | null = here?.socket ? { deviceId: here.device.rec.id, socketId: here.socket.id, device: here.device, socket: here.socket } : null;
    if (!this.first) {
      if (!picked) {
        store.setHint("Click on a socket: add sockets to a device with the Socket tool");
        return;
      }
      const why = socketRefusal(s, picked);
      if (why) {
        toast(why, "info");
        return;
      }
      this.first = picked;
      return;
    }
    if (!picked) {
      if (this.multi || ccadSettings.circuitType === "Arrow") store.setHint("Click on a socket");
      else this.corners.push(this.square(p.pos, p.shift));
      return;
    }
    if (picked.deviceId === this.first.deviceId && picked.socketId === this.first.socketId) return;
    const first = this.first;
    const corners = this.corners;
    this.reset();
    if (this.multi) connectMany(first, picked, ccadSettings.circuitType);
    else connectSockets(first, picked, corners, ccadSettings.circuitType);
  }

  overlay(g: Painter): void {
    const here = this.pointer ? under(this.pointer) : null;
    g.ctx.save();
    g.ctx.strokeStyle = ACCENT;
    g.ctx.lineWidth = 2;
    if (here?.socket) ring(g, endOf(here.device, here.socket).tip, 7);
    if (this.first) {
      ring(g, endOf(this.first.device, this.first.socket).tip, 5);
      if (this.multi && here && here.device.rec.id !== this.first.deviceId) outline(g, here.device);
    }
    g.ctx.restore();
    if (!this.first || !this.pointer) return;
    const start = endOf(this.first.device, this.first.socket).tip;
    withPreview(g, () => strokeScreen(g, [start, ...this.corners, here?.socket ? endOf(here.device, here.socket).tip : this.square(this.pointer!, this.shift)], false));
  }
}

export class LegendTool extends BaseTool {
  readonly id = "cclegend";
  readonly cursor = "crosshair";
  private at: Pt | null = null;
  private pointer: Pt | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Legend Preferences",
      [
        { kind: "text", key: "title", label: "Title", value: legendSettings.title },
        { kind: "check", key: "count", label: "Show Count", value: legendSettings.count },
      ],
      "A legend is a key to the signals of the circuits on the active layer: a sample of each one's line in its colour, its name and how many circuits carry it. Click where its top left goes, then click again to set its rotation. If the circuits change, click Refresh Legend in its Object Info.",
    );
    if (!v) return;
    legendSettings.title = v.choice("title");
    legendSettings.count = v.flag("count");
  }

  hint(): string {
    return this.at ? "Click to set the legend's rotation · Esc cancels" : "Click where the legend's top left goes";
  }

  snapFrom(): Pt | null {
    return this.at;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  /** degrees, from the first click toward `p` */
  private angle(p: Pt): number {
    const a = this.at;
    if (!a || Math.hypot(p.x - a.x, p.y - a.y) < 1e-6) return 0;
    return (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.at) {
      this.at = p.pos;
      return;
    }
    const at = this.at;
    const angle = this.angle(p.pos);
    this.at = null;
    placeLegend(layerId, at, angle);
  }

  cancel(): void {
    this.at = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.at) return false;
    this.at = null;
    return true;
  }

  overlay(g: Painter): void {
    const layerId = store.activeLayerId;
    const at = this.at ?? this.pointer;
    if (!layerId || !at) return;
    const { width: w, height: h } = legendSize(layerId);
    const t = (this.at && this.pointer ? this.angle(this.pointer) : 0) * (Math.PI / 180);
    const turn = (q: Pt): Pt => ({ x: at.x + q.x * Math.cos(t) - q.y * Math.sin(t), y: at.y + q.x * Math.sin(t) + q.y * Math.cos(t) });
    withPreview(g, () => {
      strokeScreen(
        g,
        [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: -h },
          { x: 0, y: -h },
        ].map(turn),
        true,
      );
      if (this.at && this.pointer) strokeScreen(g, [this.at, this.pointer], false);
    });
  }
}

const NODE_MODES = [
  { id: "plain", label: "No Breakout Nodes", key: "1" },
  { id: "nodes", label: "Display Breakout Nodes", key: "2" },
];

/** ReRoute Circuits: the circuits selected (Shift-click adds or takes off one) follow the circuit clicked, bussed on it, or a drag's distance apart (in quarter pitches). */
export class ReRouteTool extends BaseTool {
  readonly id = "ccreroute";
  readonly cursor = "crosshair";
  private nodes = false;
  private pointer: Pt | null = null;
  private press: { ref: string; screen: Pt; points: Pt[]; dragged: boolean } | null = null;
  private gap = 0;

  modes(): readonly ToolModes[] {
    return [{ label: "Breakout Nodes", options: NODE_MODES, active: this.nodes ? "nodes" : "plain" }];
  }

  setMode(id: string): void {
    if (NODE_MODES.some((m) => m.id === id)) this.nodes = id === "nodes";
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.press) {
      this.press = null;
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** the circuits selected */
  private selected(): string[] {
    const s = store.session;
    if (!s) return [];
    const circuits = new Set(circuitsIn(s).map((c) => c.id));
    return [...store.selection].filter((id) => circuits.has(id));
  }

  private near(p: Pt | null): ReturnType<typeof circuitNear> {
    const s = store.session;
    const layerId = store.activeLayerId;
    return s && layerId && p ? circuitNear(s, layerId, p, pitchOn(layerId) / 2) : null;
  }

  /** the circuit the selected ones would follow, and their runs */
  private preview(): { ref: string; points: Pt[]; runs: Pt[][] } | null {
    const s = store.session;
    const ref = this.press ?? this.near(this.pointer);
    const id = ref ? ("ref" in ref ? ref.ref : ref.id) : null;
    const chosen = this.selected().filter((c) => c !== id);
    if (!s || !ref || !id || !chosen.length || (!this.press && this.selected().includes(id))) return null;
    try {
      return { ref: id, points: ref.points, runs: reroutes(s, chosen, id, this.gap, this.nodes).map((r) => r.points) };
    } catch {
      return null;
    }
  }

  hint(): string {
    const n = this.selected().length;
    const what = `${n} circuit${n === 1 ? "" : "s"}`;
    if (this.press) return this.press.dragged ? `Distance between: ${formatLength(this.gap)} · release to re-route · Esc cancels` : `Release to bus ${what} on this circuit, or drag for a distance between them`;
    if (!n) return this.near(this.pointer) ? "Click to select this circuit to re-route; Shift-click adds more" : "Select the circuits to re-route: click one, Shift-click to add more";
    if (this.preview()) return `Click to re-route ${what} along this circuit, or drag for a distance between them · Shift-click adds or takes off a circuit`;
    return `${what} selected: click the circuit they follow · Shift-click adds or takes off a circuit`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    const press = this.press;
    if (!press) return;
    press.dragged ||= Math.hypot(p.screen.x - press.screen.x, p.screen.y - press.screen.y) > DRAG_PX;
    // in quarter pitches, so circuits a pitch apart sit on their sockets' rows
    const step = pitchOn(store.activeLayerId ?? "") / 4;
    this.gap = press.dragged ? Math.max(step, Math.round((nearestOnPath(press.points, p.raw)?.distance ?? 0) / step) * step) : 0;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = this.near(p.raw);
    if (!hit) {
      store.setHint("Click on a circuit");
      return;
    }
    const chosen = this.selected();
    if (p.shift) setSelection(chosen.includes(hit.id) ? chosen.filter((id) => id !== hit.id) : [...chosen, hit.id]);
    else if (chosen.some((id) => id !== hit.id)) {
      this.press = { ref: hit.id, screen: p.screen, points: hit.points, dragged: false };
      this.gap = 0;
    } else setSelection([hit.id]);
  }

  up(): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const ids = this.selected();
    const gap = press.dragged ? this.gap : 0;
    const r = attempt("ReRoute Circuits", (s) => s.batch(() => rerouteCircuits(s, ids, press.ref, gap, this.nodes)));
    this.gap = 0;
    if (r) setSelection(r.value);
  }

  cancel(): void {
    this.press = null;
  }

  overlay(g: Painter): void {
    const view = this.preview();
    const hit = view ? null : this.near(this.pointer);
    const ref = view?.points ?? hit?.points;
    if (ref) {
      g.ctx.save();
      g.ctx.strokeStyle = ACCENT;
      g.ctx.lineWidth = 3;
      strokeScreen(g, ref, false);
      g.ctx.restore();
    }
    if (view) withPreview(g, () => view.runs.forEach((run) => strokeScreen(g, run, false)));
  }
}
